import * as path from 'path';

const NOTE_MARKDOWN_FILE_EXTENSIONS = new Set(['.md', '.markdown']);
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
