import * as path from 'path';

const NOTE_MARKDOWN_FILE_EXTENSIONS = new Set(['.md', '.markdown']);
const VSCODE_REMOTE_SCHEME = 'vscode-remote';
const WEBVIEW_RESOURCE_AUTHORITY_SUFFIX = '.vscode-resource.vscode-cdn.net';
const WINDOWS_RESERVED_FILE_NAMES = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  'com1',
  'com2',
  'com3',
  'com4',
  'com5',
  'com6',
  'com7',
  'com8',
  'com9',
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
  'lpt5',
  'lpt6',
  'lpt7',
  'lpt8',
  'lpt9'
]);

export type NoteMarkdownFileStatus =
  | 'ok'
  | 'missing'
  | 'not-file'
  | 'unsupported-extension'
  | 'unreadable'
  | 'dirty-conflict';

export interface EmbeddedNoteContentSource {
  kind: 'embedded';
}

export interface MarkdownFileNoteContentSource {
  kind: 'markdown-file';
  resourceUri: string;
  displayPath: string;
  fullDisplayPath?: string;
  contentRevision?: string;
  status: NoteMarkdownFileStatus;
  lastError?: string;
  conflictDraft?: NoteMarkdownConflictDraft;
  webviewResourceBaseUri?: string;
}

export type NoteContentSource = EmbeddedNoteContentSource | MarkdownFileNoteContentSource;

export interface NoteMarkdownConflictDraft {
  draftId?: string;
  content?: string;
  baseContentRevision?: string;
  remoteContentRevision?: string;
  updatedAt: string;
}

export interface NoteMarkdownUriIdentity {
  scheme: string;
  authority?: string;
}

export interface DroppedNoteMarkdownTitleOptions {
  stripExtension?: boolean;
}

export function isSupportedNoteMarkdownFilePath(value: string): boolean {
  return NOTE_MARKDOWN_FILE_EXTENSIONS.has(resolveNoteMarkdownFileExtension(value));
}

export function resolveNoteMarkdownFileExtension(value: string): string {
  const normalized = stripUriQueryAndFragment(extractPathLikePart(value.trim())).replace(/\\/g, '/');
  return path.posix.extname(normalized).toLowerCase();
}

export function sanitizeNoteMarkdownFileName(title: string): string {
  const rawStem = stripKnownMarkdownExtension(title)
    .trim()
    .replace(/[\u0000-\u001f\u007f]/gu, ' ')
    .replace(/[\\/:*?"<>|]/gu, '-')
    .replace(/\s+/gu, ' ')
    .replace(/[. ]+$/u, '')
    .replace(/^[. ]+/u, '')
    .trim();
  const normalizedStem = rawStem || 'note';
  const safeStem = WINDOWS_RESERVED_FILE_NAMES.has(normalizedStem.toLowerCase())
    ? `${normalizedStem}-note`
    : normalizedStem;
  return `${safeStem}.md`;
}

export function createDefaultNoteMarkdownFileName(title: string): string {
  return sanitizeNoteMarkdownFileName(title);
}

export function createDroppedNoteMarkdownTitle(
  value: string,
  options: DroppedNoteMarkdownTitleOptions = {}
): string {
  const normalizedPath = stripUriQueryAndFragment(extractPathLikePart(value.trim())).replace(/\\/g, '/');
  const baseName = path.posix.basename(normalizedPath);
  const title = options.stripExtension ? stripKnownMarkdownExtension(baseName) : baseName;
  return title.trim() || 'Markdown Note';
}

export function formatNoteMarkdownRemoteAuthorityPrefix(
  scheme: string,
  authority: string
): string | undefined {
  const normalizedAuthority = safeDecodeURIComponent(authority.trim());
  if (!scheme || !normalizedAuthority) {
    return undefined;
  }

  if (scheme === 'vscode-remote') {
    const separatorIndex = normalizedAuthority.indexOf('+');
    if (separatorIndex > 0 && separatorIndex < normalizedAuthority.length - 1) {
      const kind = normalizedAuthority.slice(0, separatorIndex).replace(/-remote$/u, '');
      const target = normalizedAuthority.slice(separatorIndex + 1);
      return `${kind}:${target}`;
    }
  }

  return `${scheme}:${normalizedAuthority}`;
}

export function shouldShowNoteMarkdownRemoteAuthorityPrefixForDisplay(
  resource: NoteMarkdownUriIdentity,
  workspaceRoots: readonly NoteMarkdownUriIdentity[],
  currentRemoteAuthority?: string
): boolean {
  if (resource.scheme === 'file') {
    return false;
  }

  const normalizedCurrentRemoteAuthority = normalizeNoteMarkdownAuthority(currentRemoteAuthority);
  if (resource.scheme === VSCODE_REMOTE_SCHEME && normalizedCurrentRemoteAuthority) {
    if (normalizeNoteMarkdownAuthority(resource.authority) === normalizedCurrentRemoteAuthority) {
      return false;
    }
  }

  return !workspaceRoots.some((workspaceRoot) =>
    isNoteMarkdownResourceOnSameDisplayHost(resource, workspaceRoot, currentRemoteAuthority)
  );
}

export function canCompareNoteMarkdownResourceWithWorkspaceRoot(
  resource: NoteMarkdownUriIdentity,
  workspaceRoot: NoteMarkdownUriIdentity,
  currentRemoteAuthority?: string
): boolean {
  return isNoteMarkdownResourceOnSameDisplayHost(resource, workspaceRoot, currentRemoteAuthority);
}

export function extractNoteMarkdownCurrentRemoteAuthorityFromWebviewResourceUri(
  value: string
): string | undefined {
  const authorityMatch = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/([^/?#]+)/u.exec(value.trim());
  const authority = authorityMatch?.[1];
  if (!authority) {
    return undefined;
  }

  if (!authority.endsWith(WEBVIEW_RESOURCE_AUTHORITY_SUFFIX)) {
    return undefined;
  }

  const resourceIdentity = safeDecodeURIComponent(authority.slice(0, -WEBVIEW_RESOURCE_AUTHORITY_SUFFIX.length));
  const separatorIndex = resourceIdentity.indexOf('+');
  if (separatorIndex <= 0 || separatorIndex >= resourceIdentity.length - 1) {
    return undefined;
  }

  if (resourceIdentity.slice(0, separatorIndex) !== VSCODE_REMOTE_SCHEME) {
    return undefined;
  }

  const decodedAuthority = decodeNoteMarkdownWebviewResourceAuthority(
    resourceIdentity.slice(separatorIndex + 1)
  ).trim();
  return decodedAuthority || undefined;
}

function isNoteMarkdownResourceOnSameDisplayHost(
  resource: NoteMarkdownUriIdentity,
  workspaceRoot: NoteMarkdownUriIdentity,
  currentRemoteAuthority?: string
): boolean {
  if (resource.scheme === workspaceRoot.scheme) {
    return (
      normalizeNoteMarkdownAuthority(resource.authority) ===
      normalizeNoteMarkdownAuthority(workspaceRoot.authority)
    );
  }

  const normalizedCurrentRemoteAuthority = normalizeNoteMarkdownAuthority(currentRemoteAuthority);
  if (!normalizedCurrentRemoteAuthority) {
    return false;
  }

  if (resource.scheme === VSCODE_REMOTE_SCHEME && workspaceRoot.scheme === 'file') {
    return normalizeNoteMarkdownAuthority(resource.authority) === normalizedCurrentRemoteAuthority;
  }

  if (resource.scheme === 'file' && workspaceRoot.scheme === VSCODE_REMOTE_SCHEME) {
    return normalizeNoteMarkdownAuthority(workspaceRoot.authority) === normalizedCurrentRemoteAuthority;
  }

  return false;
}

export function normalizeNoteMarkdownAuthority(authority: string | undefined): string {
  return safeDecodeURIComponent(authority?.trim() ?? '');
}

function decodeNoteMarkdownWebviewResourceAuthority(value: string): string {
  return value.replace(/-([0-9a-f]{4})/giu, (_, code: string) =>
    String.fromCharCode(parseInt(code, 16))
  );
}

function stripKnownMarkdownExtension(value: string): string {
  const trimmed = value.trim();
  const extension = path.posix.extname(trimmed.replace(/\\/g, '/')).toLowerCase();
  if (!NOTE_MARKDOWN_FILE_EXTENSIONS.has(extension)) {
    return trimmed;
  }

  return trimmed.slice(0, -extension.length);
}

function extractPathLikePart(value: string): string {
  if (!value) {
    return '';
  }

  try {
    const parsed = new URL(value);
    return parsed.pathname || value;
  } catch {
    return value;
  }
}

function stripUriQueryAndFragment(value: string): string {
  const hashIndex = value.indexOf('#');
  const queryIndex = value.indexOf('?');
  const cutIndexes = [hashIndex, queryIndex].filter((index) => index >= 0);
  if (cutIndexes.length === 0) {
    return value;
  }

  return value.slice(0, Math.min(...cutIndexes));
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
