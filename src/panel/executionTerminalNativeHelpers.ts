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
import {
  detectExecutionTerminalPathLinks,
  inferExecutionTerminalPathStyle,
  getExecutionTerminalLinkSuffix,
  normalizeExecutionTerminalWordSeparators,
  removeExecutionTerminalLinkQueryString,
  removeExecutionTerminalLinkSuffix
} from '../common/executionTerminalLinks';

export interface ExecutionTerminalPathContext {
  shellPath?: string;
  cwd: string;
  pathStyle: ExecutionTerminalPathStyle;
  userHome?: string;
  resolveCwdForBufferLine?: (bufferStartLine: number) => Promise<string | undefined> | string | undefined;
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
  | 'vscode.openFolder'
  | 'workbench.action.quickOpen';

export interface OpenExecutionTerminalLinkResult {
  opened: boolean;
  openerKind?: ExecutionTerminalHostOpenerKind;
  targetUri?: string;
}

interface ResolveExecutionFileLinkOptions {
  allowPartialBasenameWorkspaceMatch?: boolean;
}

export function normalizeEditorMultiCursorModifier(value: unknown): 'ctrlCmd' | 'alt' {
  return value === 'ctrlCmd' ? 'ctrlCmd' : 'alt';
}

export { normalizeExecutionTerminalWordSeparators };

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
  const isPowerShell = executableName === 'pwsh' || executableName === 'powershell';

  if (isPowerShell && shouldQuotePowerShellDroppedPath(originalPath)) {
    return quotePowerShellDroppedPath(originalPath);
  }

  if (context.pathStyle === 'windows') {
    if (executableName === 'bash' && lowerExecutable.includes('git')) {
      return escapeNonWindowsPath(originalPath.replace(/\\/g, '/'), 'gitbash');
    }

    if (executableName === 'wsl' || lowerExecutable.includes('wsl')) {
      return prepareWindowsDroppedPathForUnixShell(originalPath);
    }

    if (lowerExecutable.includes('bash.exe') && !lowerExecutable.includes('git')) {
      return prepareWindowsDroppedPathForUnixShell(originalPath);
    }

    return originalPath.includes(' ') ? `"${originalPath}"` : originalPath;
  }

  return escapeNonWindowsPath(originalPath, executableName);
}

export async function resolveExecutionFileLink(
  link: Extract<ExecutionTerminalOpenLink, { linkKind: 'file' }>,
  context: ExecutionTerminalPathContext,
  options?: ResolveExecutionFileLinkOptions
): Promise<ResolvedExecutionFileLink | undefined> {
  const sanitizedPath = sanitizeExecutionFileLinkPath(link.path, context);
  if (!sanitizedPath) {
    return undefined;
  }

  const resolvedCwd = await resolveExecutionLinkCwd(link, context);
  const directCandidates = new Map<string, vscode.Uri>();
  if (sanitizedPath.startsWith('file://')) {
    const uri = vscode.Uri.parse(sanitizedPath);
    directCandidates.set(uri.toString(), uri);
  } else {
    const absolutePath = resolveAbsoluteExecutionPath(sanitizedPath, {
      ...context,
      cwd: resolvedCwd
    });
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

  if (link.source === 'fallback') {
    const fallbackResolved = await resolveExecutionWorkspaceFallbackLink(
      sanitizedPath,
      link,
      context,
      options
    );
    if (fallbackResolved) {
      return fallbackResolved;
    }
  }

  return undefined;
}

export async function resolveExecutionTerminalFileLinkCandidates(
  candidates: ExecutionTerminalFileLinkCandidate[],
  context: ExecutionTerminalPathContext,
  createResolvedId: () => string
): Promise<PreparedExecutionTerminalResolvedFileLink[]> {
  const highConfidenceCandidates = candidates.filter((candidate) => candidate.source !== 'fallback');
  const fallbackCandidates = candidates.filter((candidate) => candidate.source === 'fallback');
  const resolvedHighConfidence = await resolveExecutionTerminalFileLinkCandidateGroup(
    highConfidenceCandidates,
    context,
    createResolvedId
  );
  if (resolvedHighConfidence.length > 0 || fallbackCandidates.length === 0) {
    return resolvedHighConfidence;
  }

  return resolveExecutionTerminalFileLinkCandidateGroup(fallbackCandidates, context, createResolvedId);
}

async function resolveExecutionTerminalFileLinkCandidateGroup(
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
        columnEnd: candidate.columnEnd,
        bufferStartLine: candidate.bufferStartLine,
        source: candidate.source
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
        bufferStartLine: candidate.bufferStartLine,
        resolvedId: createResolvedId(),
        targetKind: resolved.targetKind,
        source: candidate.source
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
    if (!(await ensureExecutionTerminalUrlSchemeAllowed(link.url))) {
      return { opened: false };
    }
    const uri = vscode.Uri.parse(link.url);
    await vscode.commands.executeCommand('vscode.open', uri);
    return {
      opened: true,
      openerKind: 'vscode.open',
      targetUri: uri.toString()
    };
  }

  if (link.linkKind === 'search') {
    return openExecutionTerminalSearchLink(link, context);
  }

  const cachedResolved =
    typeof link.resolvedId === 'string' ? readResolvedFileLink?.(link.resolvedId) : undefined;
  const resolved = cachedResolved ?? (await resolveExecutionFileLink(link, context));
  if (!resolved) {
    return { opened: false };
  }

  return openResolvedExecutionTerminalLink(resolved);
}

async function ensureExecutionTerminalUrlSchemeAllowed(url: string): Promise<boolean> {
  const uri = vscode.Uri.parse(url);
  const scheme = uri.scheme;
  if (!scheme) {
    return false;
  }

  const terminalConfiguration = vscode.workspace.getConfiguration('terminal.integrated');
  const allowedSchemes = terminalConfiguration.get<string[]>('allowedLinkSchemes') ?? [];
  if (allowedSchemes.includes(scheme)) {
    return true;
  }

  const allowLabel = `Allow ${scheme}`;
  const selection = await vscode.window.showWarningMessage(
    `Opening URIs can be insecure. Do you want to allow opening links with the scheme ${scheme}?`,
    { modal: true },
    allowLabel
  );
  if (selection !== allowLabel) {
    return false;
  }

  await terminalConfiguration.update(
    'allowedLinkSchemes',
    [...allowedSchemes, scheme],
    vscode.ConfigurationTarget.Global
  );
  return true;
}

async function openExecutionTerminalSearchLink(
  link: Extract<ExecutionTerminalOpenLink, { linkKind: 'search' }>,
  context: ExecutionTerminalPathContext
): Promise<OpenExecutionTerminalLinkResult> {
  const quickOpenText = normalizeExecutionTerminalSearchLinkText(link, context);
  if (!quickOpenText) {
    return { opened: false };
  }

  for (const candidateText of collectExecutionTerminalSearchExactOpenCandidates(quickOpenText, context)) {
    const resolved = await resolveExecutionFileLink(
      toExecutionTerminalSearchFileLink(candidateText, link),
      context,
      {
        allowPartialBasenameWorkspaceMatch: true
      }
    );
    if (!resolved) {
      continue;
    }

    return openResolvedExecutionTerminalLink(resolved);
  }

  await vscode.commands.executeCommand('workbench.action.quickOpen', quickOpenText);
  return {
    opened: true,
    openerKind: 'workbench.action.quickOpen',
    targetUri: quickOpenText
  };
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

function normalizeExecutionTerminalSearchLinkText(
  link: Extract<ExecutionTerminalOpenLink, { linkKind: 'search' }>,
  context: ExecutionTerminalPathContext
): string | undefined {
  const pathModule = context.pathStyle === 'windows' ? path.win32 : path.posix;
  let text = (link.searchText || link.text).trim();
  if (!text) {
    return undefined;
  }

  text = text.replace(/^file:\/\/\/?/, '');
  text = pathModule.normalize(text).replace(/^(\.+[\\/])+/, '');
  const parsedContextText = normalizeExecutionTerminalSearchLinkTextFromContextLine(link, context.pathStyle);
  if (parsedContextText) {
    text = parsedContextText;
  }
  text = text.replace(/:[^\\/\d][^\d]*$/, '');
  text = text.replace(/\.$/, '');

  const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
  const pathSeparator = context.pathStyle === 'windows' ? '\\' : '/';
  for (const workspaceFolder of workspaceFolders) {
    if (text.substring(0, workspaceFolder.name.length + 1) === `${workspaceFolder.name}${pathSeparator}`) {
      text = text.substring(workspaceFolder.name.length + 1);
      break;
    }
  }

  return text.trim() || undefined;
}

function normalizeExecutionTerminalSearchLinkTextFromContextLine(
  link: Extract<ExecutionTerminalOpenLink, { linkKind: 'search' }>,
  pathStyle: ExecutionTerminalPathStyle
): string | undefined {
  const contextLine = link.contextLine?.trim();
  if (!contextLine) {
    return undefined;
  }

  // Preserve plain timestamps as plain words instead of treating their trailing `:MM`
  // segments like file line numbers.
  const iso8601Pattern = /:\d{2}:\d{2}[+-]\d{2}:\d{2}\.[a-z]+/;
  if (iso8601Pattern.test(link.text)) {
    return undefined;
  }

  const parsedLink = detectExecutionTerminalPathLinks(contextLine, pathStyle).find(
    (candidate) => candidate.line !== undefined && link.text.startsWith(candidate.path)
  );
  if (!parsedLink || parsedLink.line === undefined) {
    return undefined;
  }

  let text = `${parsedLink.path}:${parsedLink.line}`;
  if (parsedLink.column !== undefined) {
    text += `:${parsedLink.column}`;
  }

  return text;
}

function collectExecutionTerminalSearchExactOpenCandidates(
  normalizedText: string,
  context: ExecutionTerminalPathContext
): string[] {
  const candidates = new Set<string>();
  candidates.add(normalizedText);

  const trimmedWorkspacePrefix = trimWorkspacePrefixFromExecutionTerminalSearchText(normalizedText, context.pathStyle);
  if (trimmedWorkspacePrefix && trimmedWorkspacePrefix !== normalizedText) {
    candidates.add(trimmedWorkspacePrefix);
  }

  return [...candidates].filter((candidate) => candidate.trim().length > 0);
}

function trimWorkspacePrefixFromExecutionTerminalSearchText(
  candidate: string,
  pathStyle: ExecutionTerminalPathStyle
): string | undefined {
  const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
  const pathSeparator = pathStyle === 'windows' ? '\\' : '/';
  for (const workspaceFolder of workspaceFolders) {
    if (candidate.substring(0, workspaceFolder.name.length + 1) === `${workspaceFolder.name}${pathSeparator}`) {
      return candidate.substring(workspaceFolder.name.length + 1);
    }
  }

  return undefined;
}

function toExecutionTerminalSearchFileLink(
  text: string,
  searchLink: Extract<ExecutionTerminalOpenLink, { linkKind: 'search' }>
): Extract<ExecutionTerminalOpenLink, { linkKind: 'file' }> {
  const suffix = getExecutionTerminalLinkSuffix(text);
  return {
    linkKind: 'file',
    text,
    path: removeExecutionTerminalLinkSuffix(text),
    line: suffix?.row,
    column: suffix?.col,
    lineEnd: suffix?.rowEnd,
    columnEnd: suffix?.colEnd,
    bufferStartLine: searchLink.bufferStartLine,
    source: 'fallback'
  };
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

async function resolveExecutionLinkCwd(
  link: Extract<ExecutionTerminalOpenLink, { linkKind: 'file' }>,
  context: ExecutionTerminalPathContext
): Promise<string> {
  if (
    link.bufferStartLine === undefined ||
    typeof context.resolveCwdForBufferLine !== 'function'
  ) {
    return context.cwd;
  }

  const lineScopedCwd = await context.resolveCwdForBufferLine(link.bufferStartLine);
  return typeof lineScopedCwd === 'string' && lineScopedCwd.trim() ? lineScopedCwd : context.cwd;
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

async function resolveExecutionWorkspaceFallbackLink(
  sanitizedPath: string,
  link: Extract<ExecutionTerminalOpenLink, { linkKind: 'file' }>,
  context: ExecutionTerminalPathContext,
  options?: ResolveExecutionFileLinkOptions
): Promise<ResolvedExecutionFileLink | undefined> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    return undefined;
  }

  if (sanitizedPath.startsWith('file://') || isAbsoluteExecutionPath(sanitizedPath, context.pathStyle)) {
    return undefined;
  }

  const normalizedSearchPath = normalizeWorkspaceSearchPath(sanitizedPath, context.pathStyle);
  if (!normalizedSearchPath) {
    return undefined;
  }

  const exactMatches = await collectExecutionWorkspaceFallbackMatches(
    workspaceFolders,
    normalizedSearchPath,
    false
  );
  if (exactMatches.length === 1) {
    return statExecutionLinkTarget(exactMatches[0], link);
  }

  if (!options?.allowPartialBasenameWorkspaceMatch) {
    return undefined;
  }

  const partialMatches = await collectExecutionWorkspaceFallbackMatches(
    workspaceFolders,
    normalizedSearchPath,
    true
  );
  if (partialMatches.length !== 1) {
    return undefined;
  }

  return statExecutionLinkTarget(partialMatches[0], link);
}

async function collectExecutionWorkspaceFallbackMatches(
  workspaceFolders: readonly vscode.WorkspaceFolder[],
  normalizedSearchPath: string,
  allowPartialBasenameMatch: boolean
): Promise<vscode.Uri[]> {
  const matches = new Map<string, vscode.Uri>();
  const searchGlob = allowPartialBasenameMatch
    ? `**/${escapeExecutionWorkspaceGlobSegment(path.posix.basename(normalizedSearchPath))}*`
    : `**/${escapeExecutionWorkspaceGlobPath(normalizedSearchPath)}`;
  const maxPerWorkspace = allowPartialBasenameMatch ? 2 : 64;
  for (const workspaceFolder of workspaceFolders) {
    const candidates = await vscode.workspace.findFiles(
      new vscode.RelativePattern(workspaceFolder, searchGlob),
      undefined,
      maxPerWorkspace
    );
    for (const uri of candidates) {
      const relativePath = path
        .relative(workspaceFolder.uri.fsPath, uri.fsPath)
        .split(path.sep)
        .join('/');
      const matchesSearch = allowPartialBasenameMatch
        ? relativePathMatchesPartialFallbackSearch(relativePath, normalizedSearchPath)
        : relativePathMatchesFallbackSearch(relativePath, normalizedSearchPath);
      if (!matchesSearch) {
        continue;
      }

      matches.set(uri.toString(), uri);
      if (allowPartialBasenameMatch && matches.size > 1) {
        return [...matches.values()];
      }
    }
  }

  return [...matches.values()];
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

function normalizeWorkspaceSearchPath(
  candidate: string,
  style: ExecutionTerminalPathStyle
): string | undefined {
  const normalized = normalizeExecutionPath(candidate, style).replace(/\\/g, '/').replace(/^\.\/+/, '');
  if (!normalized || normalized === '.') {
    return undefined;
  }

  return normalized.replace(/^\/+/, '');
}

function relativePathMatchesFallbackSearch(relativePath: string, normalizedSearchPath: string): boolean {
  const normalizedRelativePath = relativePath.replace(/\\/g, '/');
  return (
    normalizedRelativePath === normalizedSearchPath ||
    normalizedRelativePath.endsWith(`/${normalizedSearchPath}`)
  );
}

function relativePathMatchesPartialFallbackSearch(relativePath: string, normalizedSearchPath: string): boolean {
  const normalizedRelativePath = relativePath.replace(/\\/g, '/');
  const normalizedRelativeDir = path.posix.dirname(normalizedRelativePath);
  const normalizedSearchDir = path.posix.dirname(normalizedSearchPath);
  if (
    normalizedSearchDir !== '.' &&
    normalizedRelativeDir !== normalizedSearchDir &&
    !normalizedRelativeDir.endsWith(`/${normalizedSearchDir}`)
  ) {
    return false;
  }

  return path.posix.basename(normalizedRelativePath).startsWith(path.posix.basename(normalizedSearchPath));
}

function escapeExecutionWorkspaceGlobSegment(value: string): string {
  return value.replace(/([\*\?\[\]\{\}])/g, '[$1]');
}

function escapeExecutionWorkspaceGlobPath(value: string): string {
  return value
    .split('/')
    .map((segment) => escapeExecutionWorkspaceGlobSegment(segment))
    .join('/');
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
        bothQuotes: quotePosixSingleQuotedPath,
        singleQuotes: quotePosixSingleQuotedPath,
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
        bothQuotes: quotePosixSingleQuotedPath,
        singleQuotes: quotePosixSingleQuotedPath,
        noSingleQuotes: (pathValue) => `'${pathValue}'`
      };
  }
}

function quotePosixSingleQuotedPath(pathValue: string): string {
  return `'${pathValue.replace(/'/g, "'\\''")}'`;
}

function getExecutionShellBasename(shellPath: string): string {
  return shellPath
    .replace(/\\/g, '/')
    .split('/')
    .pop()
    ?.replace(/\.exe$/i, '')
    .toLowerCase() ?? '';
}

function shouldQuotePowerShellDroppedPath(pathValue: string): boolean {
  return /[\s'()&]/.test(pathValue);
}

function quotePowerShellDroppedPath(pathValue: string): string {
  return `'${pathValue.replace(/'/g, '\'\'')}'`;
}

function prepareWindowsDroppedPathForUnixShell(originalPath: string): string {
  const unixPath = toWslPath(originalPath);
  return shouldQuoteUnixShellDroppedPath(unixPath) ? escapeNonWindowsPath(unixPath, 'bash') : unixPath;
}

function shouldQuoteUnixShellDroppedPath(pathValue: string): boolean {
  return /[^A-Za-z0-9_./:-]/.test(pathValue);
}

function toWslPath(originalPath: string): string {
  const normalizedPath = originalPath.replace(/\\/g, '/');
  const driveLetterMatch = normalizedPath.match(/^([a-zA-Z]):\/(.*)$/);
  if (driveLetterMatch) {
    return `/mnt/${driveLetterMatch[1].toLowerCase()}/${driveLetterMatch[2]}`;
  }

  return normalizedPath;
}
