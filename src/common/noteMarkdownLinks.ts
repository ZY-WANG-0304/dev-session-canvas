import * as path from 'path';

const NOTE_MARKDOWN_ALLOWED_EXTERNAL_LINK_SCHEMES = ['http', 'https', 'mailto'] as const;
const NOTE_MARKDOWN_FILE_LINE_FRAGMENT_PATTERN = /^L(?<line>\d+)(?:C(?<column>\d+))?(?:-L?\d+(?:C\d+)?)?$/u;
const NOTE_MARKDOWN_FILE_LINE_COLON_FRAGMENT_PATTERN = /^(?<line>\d+)(?::(?<column>\d+))?$/u;

type NoteMarkdownAllowedExternalLinkScheme = (typeof NOTE_MARKDOWN_ALLOWED_EXTERNAL_LINK_SCHEMES)[number];

const noteMarkdownAllowedExternalLinkSchemeSet = new Set<string>(NOTE_MARKDOWN_ALLOWED_EXTERNAL_LINK_SCHEMES);

export interface NoteMarkdownWorkspaceRoot {
  name: string;
  path: string;
}

export interface NoteMarkdownFileSelection {
  line: number;
  column?: number;
}

export type ResolvedNoteMarkdownLinkTarget =
  | {
      kind: 'external';
      href: string;
    }
  | {
      kind: 'workspace-file';
      filePath: string;
      selection?: NoteMarkdownFileSelection;
    };

export { NOTE_MARKDOWN_ALLOWED_EXTERNAL_LINK_SCHEMES };
export type { NoteMarkdownAllowedExternalLinkScheme };

export function normalizeOpenableNoteMarkdownHref(href: string): string | null {
  const trimmedHref = href.trim();
  if (!trimmedHref) {
    return null;
  }

  let parsedHref: URL;
  try {
    parsedHref = new URL(trimmedHref);
  } catch {
    return null;
  }

  const scheme = parsedHref.protocol.slice(0, -1).toLowerCase();
  if (!noteMarkdownAllowedExternalLinkSchemeSet.has(scheme)) {
    return null;
  }

  return parsedHref.toString();
}

export function resolveNoteMarkdownLinkTarget(params: {
  href: string;
  workspaceRoots: NoteMarkdownWorkspaceRoot[];
}): ResolvedNoteMarkdownLinkTarget | null {
  const externalHref = normalizeOpenableNoteMarkdownHref(params.href);
  if (externalHref) {
    return {
      kind: 'external',
      href: externalHref
    };
  }

  return resolveWorkspaceNoteMarkdownFileLink(params.href, params.workspaceRoots);
}

function resolveWorkspaceNoteMarkdownFileLink(
  href: string,
  workspaceRoots: NoteMarkdownWorkspaceRoot[]
): ResolvedNoteMarkdownLinkTarget | null {
  const trimmedHref = href.trim();
  if (!trimmedHref || trimmedHref.startsWith('#')) {
    return null;
  }

  const normalizedRoots = workspaceRoots
    .map((root) => ({
      ...root,
      normalizedName: normalizeWorkspaceRootName(root.name),
      normalizedPath: root.path.trim()
    }))
    .filter((root) => Boolean(root.normalizedName) && Boolean(root.normalizedPath));
  if (normalizedRoots.length === 0) {
    return null;
  }

  const [rawPathPart, rawFragmentPart] = splitNoteMarkdownHref(trimmedHref);
  if (!rawPathPart || rawPathPart.includes('?')) {
    return null;
  }

  let decodedPathPart: string;
  try {
    decodedPathPart = decodeURIComponent(rawPathPart);
  } catch {
    return null;
  }

  if (!decodedPathPart) {
    return null;
  }

  const normalizedMarkdownPath = decodedPathPart.replace(/\\/g, '/');
  if (
    path.posix.isAbsolute(normalizedMarkdownPath) ||
    path.win32.isAbsolute(decodedPathPart)
  ) {
    return null;
  }

  const { rootPath, relativePath } = resolveWorkspaceRootForMarkdownPath(
    normalizedMarkdownPath,
    normalizedRoots.map((root) => ({ name: root.normalizedName, path: root.normalizedPath }))
  );
  if (!rootPath || !relativePath) {
    return null;
  }

  const filePath = resolveContainedWorkspaceFilePath(rootPath, relativePath);
  if (!filePath) {
    return null;
  }

  return {
    kind: 'workspace-file',
    filePath,
    selection: parseNoteMarkdownFileSelection(rawFragmentPart)
  };
}

function splitNoteMarkdownHref(href: string): [string, string] {
  const hashIndex = href.indexOf('#');
  if (hashIndex < 0) {
    return [href, ''];
  }

  return [href.slice(0, hashIndex), href.slice(hashIndex + 1)];
}

function resolveWorkspaceRootForMarkdownPath(
  markdownPath: string,
  workspaceRoots: { name: string; path: string }[]
): { rootPath: string | null; relativePath: string | null } {
  if (workspaceRoots.length === 1) {
    return {
      rootPath: workspaceRoots[0].path,
      relativePath: markdownPath
    };
  }

  const normalizedSegments = markdownPath.split('/').filter((segment) => segment.length > 0);
  if (normalizedSegments.length < 2) {
    return {
      rootPath: null,
      relativePath: null
    };
  }

  const candidateRootName = normalizeWorkspaceRootName(normalizedSegments[0]);
  const matchingRoot = workspaceRoots.find((root) => root.name === candidateRootName);
  if (!matchingRoot) {
    return {
      rootPath: null,
      relativePath: null
    };
  }

  return {
    rootPath: matchingRoot.path,
    relativePath: normalizedSegments.slice(1).join('/')
  };
}

function resolveContainedWorkspaceFilePath(rootPath: string, relativePath: string): string | null {
  const normalizedRelativePath = relativePath.replace(/\\/g, '/');
  if (!normalizedRelativePath) {
    return null;
  }

  const resolvedPath = path.join(rootPath, normalizedRelativePath.split('/').join(path.sep));
  const containmentRelativePath = path.relative(rootPath, resolvedPath);
  if (
    !containmentRelativePath ||
    containmentRelativePath.startsWith('..') ||
    path.isAbsolute(containmentRelativePath)
  ) {
    return null;
  }

  return resolvedPath;
}

function parseNoteMarkdownFileSelection(fragment: string): NoteMarkdownFileSelection | undefined {
  const trimmedFragment = fragment.trim();
  if (!trimmedFragment) {
    return undefined;
  }

  const matchedGroups =
    NOTE_MARKDOWN_FILE_LINE_FRAGMENT_PATTERN.exec(trimmedFragment)?.groups ??
    NOTE_MARKDOWN_FILE_LINE_COLON_FRAGMENT_PATTERN.exec(trimmedFragment)?.groups;
  if (!matchedGroups?.line) {
    return undefined;
  }

  const line = Number.parseInt(matchedGroups.line, 10);
  const column = matchedGroups.column ? Number.parseInt(matchedGroups.column, 10) : undefined;
  if (!Number.isSafeInteger(line) || line < 1) {
    return undefined;
  }
  if (column !== undefined && (!Number.isSafeInteger(column) || column < 1)) {
    return undefined;
  }

  return column !== undefined ? { line, column } : { line };
}

function normalizeWorkspaceRootName(value: string): string {
  return value.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}
