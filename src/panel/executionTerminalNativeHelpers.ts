import * as path from 'path';
import * as vscode from 'vscode';

import type {
  ExecutionTerminalFileLinkCandidate,
  ExecutionTerminalFileLinkTargetKind,
  ExecutionTerminalOpenLink,
  ExecutionTerminalDroppedResource,
  ExecutionTerminalPathStyle,
  ExecutionTerminalResolvedFileLink
} from '../common/executionTerminalLinks';
import { removeExecutionTerminalLinkQueryString } from '../common/executionTerminalLinks';

export interface ExecutionTerminalPathContext {
  shellPath?: string;
  cwd: string;
  pathStyle: ExecutionTerminalPathStyle;
  userHome?: string;
}

export interface ResolvedExecutionFileLink {
  uri: vscode.Uri;
  selection?: vscode.Range;
  targetKind: ExecutionTerminalFileLinkTargetKind;
}

export interface PreparedExecutionTerminalResolvedFileLink {
  candidateId: string;
  openLink: ExecutionTerminalResolvedFileLink['link'];
  resolved: ResolvedExecutionFileLink;
}

export type ExecutionTerminalHostOpenerKind =
  | 'vscode.open'
  | 'showTextDocument'
  | 'revealInExplorer'
  | 'vscode.openFolder';

export interface OpenExecutionTerminalLinkResult {
  opened: boolean;
  openerKind?: ExecutionTerminalHostOpenerKind;
  targetUri?: string;
}

export function normalizeEditorMultiCursorModifier(value: unknown): 'ctrlCmd' | 'alt' {
  return value === 'ctrlCmd' ? 'ctrlCmd' : 'alt';
}

export function inferExecutionTerminalPathStyle(
  shellPath: string | undefined,
  cwd: string | undefined
): ExecutionTerminalPathStyle {
  const cwdValue = cwd?.trim() ?? '';
  const shellValue = shellPath?.trim() ?? '';
  if (
    /^[a-zA-Z]:[\\/]/.test(cwdValue) ||
    cwdValue.startsWith('\\\\') ||
    /^[a-zA-Z]:/.test(shellValue) ||
    shellValue.includes('\\')
  ) {
    return 'windows';
  }

  return 'posix';
}

export function prepareExecutionTerminalDroppedPath(
  resource: ExecutionTerminalDroppedResource,
  context: ExecutionTerminalPathContext
): string {
  const originalPath = resource.valueKind === 'uri' ? vscode.Uri.parse(resource.value).fsPath : resource.value;
  const shellPath = context.shellPath?.trim();
  if (!shellPath) {
    return originalPath;
  }

  const executableName = getExecutionShellBasename(shellPath);
  const lowerExecutable = shellPath.toLowerCase();
  const hasSpace = originalPath.includes(' ');
  const hasParens = originalPath.includes('(') || originalPath.includes(')');
  const isPowerShell = executableName === 'pwsh' || executableName === 'powershell';

  if (isPowerShell && (hasSpace || originalPath.includes('\''))) {
    return `& '${originalPath.replace(/'/g, '\'\'')}'`;
  }

  if (hasParens && isPowerShell) {
    return `& '${originalPath}'`;
  }

  if (context.pathStyle === 'windows') {
    if (executableName === 'bash' && lowerExecutable.includes('git')) {
      return escapeNonWindowsPath(originalPath.replace(/\\/g, '/'), 'gitbash');
    }

    if (executableName === 'wsl' || lowerExecutable.includes('wsl')) {
      return toWslPath(originalPath);
    }

    if (lowerExecutable.includes('bash.exe') && !lowerExecutable.includes('git')) {
      return toWslPath(originalPath);
    }

    return hasSpace ? `"${originalPath}"` : originalPath;
  }

  return escapeNonWindowsPath(originalPath, executableName);
}

export async function resolveExecutionFileLink(
  link: Extract<ExecutionTerminalOpenLink, { linkKind: 'file' }>,
  context: ExecutionTerminalPathContext
): Promise<ResolvedExecutionFileLink | undefined> {
  const sanitizedPath = sanitizeExecutionFileLinkPath(link.path, context);
  if (!sanitizedPath) {
    return undefined;
  }

  const directCandidates = new Map<string, vscode.Uri>();
  if (sanitizedPath.startsWith('file://')) {
    const uri = vscode.Uri.parse(sanitizedPath);
    directCandidates.set(uri.toString(), uri);
  } else {
    const absolutePath = resolveAbsoluteExecutionPath(sanitizedPath, context);
    if (absolutePath) {
      const uri = vscode.Uri.file(absolutePath);
      directCandidates.set(uri.toString(), uri);
    }
  }

  for (const uri of directCandidates.values()) {
    const resolved = await statExecutionLinkTarget(uri, link);
    if (resolved) {
      return resolved;
    }
  }

  return undefined;
}

export async function resolveExecutionTerminalFileLinkCandidates(
  candidates: ExecutionTerminalFileLinkCandidate[],
  context: ExecutionTerminalPathContext,
  createResolvedId: () => string
): Promise<PreparedExecutionTerminalResolvedFileLink[]> {
  const results: PreparedExecutionTerminalResolvedFileLink[] = [];
  for (const candidate of candidates) {
    const resolved = await resolveExecutionFileLink(
      {
        linkKind: 'file',
        text: candidate.text,
        path: candidate.path,
        line: candidate.line,
        column: candidate.column,
        lineEnd: candidate.lineEnd,
        columnEnd: candidate.columnEnd
      },
      context
    );
    if (!resolved) {
      continue;
    }

    results.push({
      candidateId: candidate.candidateId,
      openLink: {
        linkKind: 'file',
        text: candidate.text,
        path: candidate.path,
        line: candidate.line,
        column: candidate.column,
        lineEnd: candidate.lineEnd,
        columnEnd: candidate.columnEnd,
        resolvedId: createResolvedId(),
        targetKind: resolved.targetKind
      },
      resolved
    });
  }

  return results;
}

export async function openExecutionTerminalLink(
  link: ExecutionTerminalOpenLink,
  context: ExecutionTerminalPathContext,
  readResolvedFileLink?: (resolvedId: string) => ResolvedExecutionFileLink | undefined
): Promise<OpenExecutionTerminalLinkResult> {
  if (link.linkKind === 'url') {
    const uri = vscode.Uri.parse(link.url);
    await vscode.commands.executeCommand('vscode.open', uri);
    return {
      opened: true,
      openerKind: 'vscode.open',
      targetUri: uri.toString()
    };
  }

  const cachedResolved =
    typeof link.resolvedId === 'string' ? readResolvedFileLink?.(link.resolvedId) : undefined;
  const resolved = cachedResolved ?? (await resolveExecutionFileLink(link, context));
  if (!resolved) {
    return { opened: false };
  }

  return openResolvedExecutionTerminalLink(resolved);
}

export async function openResolvedExecutionTerminalLink(
  resolved: ResolvedExecutionFileLink
): Promise<OpenExecutionTerminalLinkResult> {
  if (resolved.targetKind === 'directory-in-workspace') {
    await vscode.commands.executeCommand('revealInExplorer', resolved.uri);
    return {
      opened: true,
      openerKind: 'revealInExplorer',
      targetUri: resolved.uri.toString()
    };
  }

  if (resolved.targetKind === 'directory-outside-workspace') {
    await vscode.commands.executeCommand('vscode.openFolder', resolved.uri, true);
    return {
      opened: true,
      openerKind: 'vscode.openFolder',
      targetUri: resolved.uri.toString()
    };
  }

  const document = await vscode.workspace.openTextDocument(resolved.uri);
  await vscode.window.showTextDocument(document, {
    preview: false,
    preserveFocus: false,
    selection: resolved.selection
  });
  return {
    opened: true,
    openerKind: 'showTextDocument',
    targetUri: resolved.uri.toString()
  };
}

function sanitizeExecutionFileLinkPath(
  rawPath: string,
  context: ExecutionTerminalPathContext
): string | undefined {
  const trimmed = removeExecutionTerminalLinkQueryString(rawPath.trim());
  if (!trimmed) {
    return undefined;
  }

  if (trimmed.startsWith('~')) {
    const home = context.userHome?.trim();
    if (!home) {
      return undefined;
    }

    return joinExecutionPath(context.pathStyle, home, trimmed.slice(1));
  }

  return trimmed;
}

function resolveAbsoluteExecutionPath(
  candidate: string,
  context: ExecutionTerminalPathContext
): string | undefined {
  if (isAbsoluteExecutionPath(candidate, context.pathStyle)) {
    return normalizeExecutionPath(candidate, context.pathStyle);
  }

  if (!context.cwd.trim()) {
    return undefined;
  }

  return joinExecutionPath(context.pathStyle, context.cwd, candidate);
}

function normalizeExecutionPath(
  candidate: string,
  style: ExecutionTerminalPathStyle
): string {
  return style === 'windows' ? path.win32.normalize(candidate) : path.posix.normalize(candidate);
}

function joinExecutionPath(
  style: ExecutionTerminalPathStyle,
  basePath: string,
  nextPath: string
): string {
  if (style === 'windows') {
    return path.win32.normalize(path.win32.join(basePath, nextPath));
  }

  return path.posix.normalize(path.posix.join(basePath, nextPath));
}

function isAbsoluteExecutionPath(
  candidate: string,
  style: ExecutionTerminalPathStyle
): boolean {
  return style === 'windows'
    ? path.win32.isAbsolute(candidate) || candidate.startsWith('\\\\')
    : path.posix.isAbsolute(candidate);
}

async function statExecutionLinkTarget(
  uri: vscode.Uri,
  link: Extract<ExecutionTerminalOpenLink, { linkKind: 'file' }>
): Promise<ResolvedExecutionFileLink | undefined> {
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    return {
      uri,
      targetKind: classifyExecutionFileLinkTarget(uri, stat.type),
      selection: toExecutionLinkSelection(link)
    };
  } catch {
    return undefined;
  }
}

function classifyExecutionFileLinkTarget(
  uri: vscode.Uri,
  fileType: vscode.FileType
): ExecutionTerminalFileLinkTargetKind {
  if ((fileType & vscode.FileType.Directory) === 0) {
    return 'file';
  }

  return vscode.workspace.getWorkspaceFolder(uri) ? 'directory-in-workspace' : 'directory-outside-workspace';
}

function toExecutionLinkSelection(
  link: Extract<ExecutionTerminalOpenLink, { linkKind: 'file' }>
): vscode.Range | undefined {
  if (link.line === undefined) {
    return undefined;
  }

  const startLine = Math.max(0, link.line - 1);
  const startCharacter = Math.max(0, (link.column ?? 1) - 1);
  const endLine = Math.max(startLine, (link.lineEnd ?? link.line) - 1);
  const endCharacter = Math.max(
    startCharacter,
    link.columnEnd !== undefined ? link.columnEnd - 1 : startCharacter
  );
  return new vscode.Range(startLine, startCharacter, endLine, endCharacter);
}

function escapeNonWindowsPath(pathValue: string, shellKind: string): string {
  let escapedPath = pathValue;
  if (escapedPath.includes('\\')) {
    escapedPath = escapedPath.replace(/\\/g, '\\\\');
  }

  const bannedChars = /[\`\$\|\&\>\~\#\!\^\*\;\<]/g;
  escapedPath = escapedPath.replace(bannedChars, '');

  const shellEscaper = selectNonWindowsShellEscaper(shellKind);
  if (escapedPath.includes('\'') && escapedPath.includes('"')) {
    return shellEscaper.bothQuotes(escapedPath);
  }

  if (escapedPath.includes('\'')) {
    return shellEscaper.singleQuotes(escapedPath);
  }

  return shellEscaper.noSingleQuotes(escapedPath);
}

function selectNonWindowsShellEscaper(shellKind: string): {
  bothQuotes: (pathValue: string) => string;
  singleQuotes: (pathValue: string) => string;
  noSingleQuotes: (pathValue: string) => string;
} {
  switch (shellKind) {
    case 'bash':
    case 'sh':
    case 'zsh':
    case 'gitbash':
      return {
        bothQuotes: (pathValue) => `$'${pathValue.replace(/'/g, '\\\'')}'`,
        singleQuotes: (pathValue) => `'${pathValue.replace(/'/g, '\\\'')}'`,
        noSingleQuotes: (pathValue) => `'${pathValue}'`
      };
    case 'fish':
      return {
        bothQuotes: (pathValue) => `"${pathValue.replace(/"/g, '\\"')}"`,
        singleQuotes: (pathValue) => `'${pathValue.replace(/'/g, '\\\'')}'`,
        noSingleQuotes: (pathValue) => `'${pathValue}'`
      };
    case 'pwsh':
    case 'powershell':
      return {
        bothQuotes: (pathValue) => `"${pathValue.replace(/"/g, '`"')}"`,
        singleQuotes: (pathValue) => `'${pathValue.replace(/'/g, '\'\'')}'`,
        noSingleQuotes: (pathValue) => `'${pathValue}'`
      };
    default:
      return {
        bothQuotes: (pathValue) => `$'${pathValue.replace(/'/g, '\\\'')}'`,
        singleQuotes: (pathValue) => `'${pathValue.replace(/'/g, '\\\'')}'`,
        noSingleQuotes: (pathValue) => `'${pathValue}'`
      };
  }
}

function getExecutionShellBasename(shellPath: string): string {
  return shellPath
    .replace(/\\/g, '/')
    .split('/')
    .pop()
    ?.replace(/\.exe$/i, '')
    .toLowerCase() ?? '';
}

function toWslPath(originalPath: string): string {
  const normalizedPath = originalPath.replace(/\\/g, '/');
  const driveLetterMatch = normalizedPath.match(/^([a-zA-Z]):\/(.*)$/);
  if (driveLetterMatch) {
    return `/mnt/${driveLetterMatch[1].toLowerCase()}/${driveLetterMatch[2]}`;
  }

  return normalizedPath;
}
