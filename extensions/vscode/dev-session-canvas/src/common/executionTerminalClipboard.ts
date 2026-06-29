export type ExecutionTerminalClipboardPlatform = 'mac' | 'windows' | 'linux' | 'other';

export const EXECUTION_IMAGE_PASTE_MAX_BYTES = 10 * 1024 * 1024;
export const EXECUTION_IMAGE_PASTE_MAX_BASE64_LENGTH =
  Math.ceil(EXECUTION_IMAGE_PASTE_MAX_BYTES / 3) * 4 + 4;
export const EXECUTION_IMAGE_PASTE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const EXECUTION_IMAGE_PASTE_TEMP_FILE_TTL_MS = 24 * 60 * 60 * 1000;
export const EXECUTION_IMAGE_PASTE_FILE_PREFIX = 'pasted-screenshot-';
export const EXECUTION_IMAGE_PASTE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp'
] as const;
export const EXECUTION_IMAGE_PASTE_CACHE_FILE_EXTENSIONS = [
  '.png',
  '.jpg',
  '.webp'
] as const;

export type ExecutionImagePasteMimeType = (typeof EXECUTION_IMAGE_PASTE_MIME_TYPES)[number];

export interface ExecutionImagePasteData {
  mimeType: ExecutionImagePasteMimeType;
  dataBase64: string;
  sizeBytes: number;
  name?: string;
}

export type ExecutionImagePasteCacheFileCleanupReason = 'expired-image' | 'expired-temp';

export interface ExecutionImagePasteCacheFileCleanupDecision {
  shouldDelete: boolean;
  reason?: ExecutionImagePasteCacheFileCleanupReason;
}

export type ExecutionTerminalClipboardShortcutAction =
  | 'copy'
  | 'copyAndClearSelection'
  | 'paste'
  | 'passThrough'
  | 'noop';

export interface ExecutionTerminalClipboardKeyEventLike {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

export interface ExecutionTerminalClipboardEnvironment {
  platform?: string;
  userAgent?: string;
}

export type ExecutionTerminalPastePreparation =
  | {
      kind: 'paste';
      text: string;
    }
  | {
      kind: 'confirm';
      text: string;
      lineCount: number;
    }
  | {
      kind: 'cancel';
    };

export function resolveExecutionTerminalClipboardShortcut(
  platform: ExecutionTerminalClipboardPlatform,
  event: ExecutionTerminalClipboardKeyEventLike,
  hasSelection: boolean
): ExecutionTerminalClipboardShortcutAction {
  if (event.altKey) {
    return 'passThrough';
  }

  const key = normalizeClipboardShortcutKey(event.key);
  const ctrl = event.ctrlKey === true;
  const meta = event.metaKey === true;
  const shift = event.shiftKey === true;

  if (platform === 'mac') {
    if (meta && !ctrl && !shift && key === 'c') {
      return hasSelection ? 'copy' : 'passThrough';
    }
    if (meta && !ctrl && !shift && key === 'v') {
      return 'paste';
    }
    return 'passThrough';
  }

  if (platform === 'windows') {
    if (ctrl && !meta && !shift && key === 'c') {
      return hasSelection ? 'copyAndClearSelection' : 'passThrough';
    }
    if (ctrl && !meta && shift && key === 'c') {
      return hasSelection ? 'copy' : 'noop';
    }
    if (ctrl && !meta && key === 'v') {
      return 'paste';
    }
    return 'passThrough';
  }

  if (platform === 'linux') {
    if (ctrl && !meta && shift && key === 'c') {
      return hasSelection ? 'copy' : 'noop';
    }
    if (ctrl && !meta && shift && key === 'v') {
      return 'paste';
    }
    return 'passThrough';
  }

  if ((meta || (ctrl && shift)) && key === 'c') {
    return hasSelection ? 'copy' : 'noop';
  }
  if ((meta || (ctrl && shift)) && key === 'v') {
    return 'paste';
  }
  return 'passThrough';
}

export function inferExecutionTerminalClipboardPlatform(
  environment: ExecutionTerminalClipboardEnvironment
): ExecutionTerminalClipboardPlatform {
  const platform = normalizePlatformText(environment.platform);
  const userAgent = normalizePlatformText(environment.userAgent);
  const combined = `${platform} ${userAgent}`;

  if (combined.includes('mac') || combined.includes('darwin')) {
    return 'mac';
  }
  if (combined.includes('win')) {
    return 'windows';
  }
  if (combined.includes('linux') || combined.includes('x11')) {
    return 'linux';
  }
  return 'other';
}

export function prepareExecutionTerminalPasteText(
  text: string,
  bracketedPasteMode: boolean
): ExecutionTerminalPastePreparation {
  if (text.length === 0) {
    return { kind: 'cancel' };
  }

  const lines = text.split(/\r\n|\r|\n/);
  if (lines.length === 1 || bracketedPasteMode) {
    return {
      kind: 'paste',
      text
    };
  }

  if (lines.length === 2 && lines[1].trim().length === 0) {
    return {
      kind: 'paste',
      text: lines[0]
    };
  }

  return {
    kind: 'confirm',
    text,
    lineCount: lines.length
  };
}

export function isExecutionImagePasteMimeType(value: unknown): value is ExecutionImagePasteMimeType {
  return (
    typeof value === 'string' &&
    EXECUTION_IMAGE_PASTE_MIME_TYPES.includes(value.toLowerCase() as ExecutionImagePasteMimeType)
  );
}

export function normalizeExecutionImagePasteMimeType(
  value: string | undefined
): ExecutionImagePasteMimeType | undefined {
  const normalized = value?.trim().toLowerCase();
  return isExecutionImagePasteMimeType(normalized) ? normalized : undefined;
}

export function isExecutionImagePasteSizeAllowed(
  sizeBytes: unknown,
  maxBytes = EXECUTION_IMAGE_PASTE_MAX_BYTES
): sizeBytes is number {
  return (
    typeof sizeBytes === 'number' &&
    Number.isSafeInteger(sizeBytes) &&
    sizeBytes > 0 &&
    sizeBytes <= maxBytes
  );
}

export function isLikelyExecutionImagePasteBase64Payload(
  value: unknown,
  maxBase64Length = EXECUTION_IMAGE_PASTE_MAX_BASE64_LENGTH
): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maxBase64Length &&
    value.length % 4 === 0 &&
    /^[A-Za-z0-9+/]*={0,2}$/u.test(value)
  );
}

export function getExecutionImagePasteFileExtension(
  mimeType: ExecutionImagePasteMimeType
): 'png' | 'jpg' | 'webp' {
  if (mimeType === 'image/jpeg') {
    return 'jpg';
  }
  if (mimeType === 'image/webp') {
    return 'webp';
  }
  return 'png';
}

export function createExecutionImagePasteFileName(params: {
  mimeType: ExecutionImagePasteMimeType;
  now?: Date;
  randomSuffix?: string;
}): string {
  const now = params.now ?? new Date();
  const timestamp = Number.isNaN(now.getTime())
    ? 'unknown-time'
    : now.toISOString().replace(/[-:.]/g, '');
  const suffix = sanitizeExecutionImagePastePathSegment(params.randomSuffix ?? '', 'image')
    .slice(0, 24);
  return `${EXECUTION_IMAGE_PASTE_FILE_PREFIX}${timestamp}-${suffix}.${getExecutionImagePasteFileExtension(params.mimeType)}`;
}

export function sanitizeExecutionImagePastePathSegment(value: string, fallback: string): string {
  const sanitized = value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[. -]+|[. -]+$/g, '')
    .slice(0, 80);
  return sanitized || fallback;
}

export function hasValidExecutionImagePasteSignature(
  bytes: Uint8Array,
  mimeType: ExecutionImagePasteMimeType
): boolean {
  if (mimeType === 'image/png') {
    return (
      bytes.length >= 8 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
    );
  }

  if (mimeType === 'image/jpeg') {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }

  return (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  );
}

export function formatExecutionImagePasteText(filePath: string): string {
  return `${shellQuoteExecutionImagePastePath(filePath)} `;
}

export function getExecutionImagePasteCacheFileCleanupDecision(params: {
  fileName: string;
  mtimeMs: number;
  nowMs: number;
  imageTtlMs?: number;
  tempFileTtlMs?: number;
}): ExecutionImagePasteCacheFileCleanupDecision {
  const ageMs = params.nowMs - params.mtimeMs;
  if (!Number.isFinite(ageMs) || ageMs < 0) {
    return { shouldDelete: false };
  }

  if (isExecutionImagePasteTempFileName(params.fileName)) {
    const tempFileTtlMs = params.tempFileTtlMs ?? EXECUTION_IMAGE_PASTE_TEMP_FILE_TTL_MS;
    return ageMs > tempFileTtlMs
      ? { shouldDelete: true, reason: 'expired-temp' }
      : { shouldDelete: false };
  }

  if (!isExecutionImagePasteCacheFileName(params.fileName)) {
    return { shouldDelete: false };
  }

  const imageTtlMs = params.imageTtlMs ?? EXECUTION_IMAGE_PASTE_CACHE_TTL_MS;
  return ageMs > imageTtlMs
    ? { shouldDelete: true, reason: 'expired-image' }
    : { shouldDelete: false };
}

export function isExecutionImagePasteCacheFileName(fileName: string): boolean {
  return (
    fileName.startsWith(EXECUTION_IMAGE_PASTE_FILE_PREFIX) &&
    EXECUTION_IMAGE_PASTE_CACHE_FILE_EXTENSIONS.some((extension) => fileName.endsWith(extension))
  );
}

export function isExecutionImagePasteTempFileName(fileName: string): boolean {
  return (
    fileName.startsWith(EXECUTION_IMAGE_PASTE_FILE_PREFIX) &&
    EXECUTION_IMAGE_PASTE_CACHE_FILE_EXTENSIONS.some((extension) =>
      fileName.includes(`${extension}.`)
    ) &&
    fileName.endsWith('.tmp')
  );
}

function normalizeClipboardShortcutKey(key: string): string {
  const normalized = key.trim().toLowerCase();
  if (normalized === 'keyc') {
    return 'c';
  }
  if (normalized === 'keyv') {
    return 'v';
  }
  return normalized;
}

function normalizePlatformText(value: string | undefined): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function shellQuoteExecutionImagePastePath(filePath: string): string {
  return `'${filePath.replace(/'/g, `'\\''`)}'`;
}
