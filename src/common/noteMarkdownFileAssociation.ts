import * as path from 'path';

const NOTE_MARKDOWN_FILE_EXTENSIONS = new Set(['.md', '.markdown']);
const DEFAULT_DISPLAY_PATH_MAX_LENGTH = 56;
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
}

export type NoteContentSource = EmbeddedNoteContentSource | MarkdownFileNoteContentSource;

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

export function compactNoteMarkdownDisplayPath(
  value: string,
  maxLength = DEFAULT_DISPLAY_PATH_MAX_LENGTH
): string {
  const normalizedMaxLength = Math.max(16, Math.floor(maxLength));
  if (value.length <= normalizedMaxLength) {
    return value;
  }

  const remoteSeparator = ' · ';
  const remoteSeparatorIndex = value.indexOf(remoteSeparator);
  if (remoteSeparatorIndex > 0) {
    const prefix = value.slice(0, remoteSeparatorIndex + remoteSeparator.length);
    const pathPart = value.slice(remoteSeparatorIndex + remoteSeparator.length);
    return `${prefix}${compactPathTail(pathPart, normalizedMaxLength - prefix.length)}`;
  }

  return compactPathTail(value, normalizedMaxLength);
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

function compactPathTail(value: string, maxLength: number): string {
  const normalizedMaxLength = Math.max(16, maxLength);
  if (value.length <= normalizedMaxLength) {
    return value;
  }

  const normalized = value.replace(/\\/g, '/');
  const parts = normalized.split('/').filter((part) => part.length > 0);
  const fileName = parts[parts.length - 1] ?? normalized;
  const parentName = parts.length >= 2 ? parts[parts.length - 2] : undefined;
  const tail = parentName ? `${parentName}/${fileName}` : fileName;
  const compactTail = `…/${tail}`;
  if (compactTail.length <= normalizedMaxLength) {
    return compactTail;
  }

  const fileTail = `…/${fileName}`;
  if (fileTail.length <= normalizedMaxLength) {
    return fileTail;
  }

  return `…${fileName.slice(-(normalizedMaxLength - 1))}`;
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
