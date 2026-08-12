export const COMPLETED_TERMINAL_HISTORY_ARCHIVE_VERSION = 1 as const;
export const COMPLETED_TERMINAL_HISTORY_ARCHIVE_CODEC = 'terminal-stream-attach-json-v1' as const;
/**
 * A line-delimited projection sidecar.  The canonical v1 JSON blob remains
 * the durable source of truth; this optional sidecar only controls reload
 * transport and can be regenerated from that blob.
 */
export const COMPLETED_TERMINAL_HISTORY_ARCHIVE_PROJECTION_CODEC =
  'terminal-stream-projection-ndjson-v1' as const;

const COMPLETED_TERMINAL_HISTORY_ARCHIVE_ID_PATTERN = /^sha256-[a-f0-9]{64}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export interface CompletedTerminalHistoryArchiveDescriptor {
  version: typeof COMPLETED_TERMINAL_HISTORY_ARCHIVE_VERSION;
  archiveId: string;
  codec: typeof COMPLETED_TERMINAL_HISTORY_ARCHIVE_CODEC;
  sessionId: string;
  authorityId: string;
  finalRevision: number;
  byteLength: number;
  sha256: string;
  projectionCodec?: typeof COMPLETED_TERMINAL_HISTORY_ARCHIVE_PROJECTION_CODEC;
  projectionByteLength?: number;
  projectionSha256?: string;
}

export function normalizeCompletedTerminalHistoryArchiveDescriptor(
  value: unknown
): CompletedTerminalHistoryArchiveDescriptor | undefined {
  if (
    !isRecord(value) ||
    value.version !== COMPLETED_TERMINAL_HISTORY_ARCHIVE_VERSION ||
    value.codec !== COMPLETED_TERMINAL_HISTORY_ARCHIVE_CODEC
  ) {
    return undefined;
  }

  const archiveId = normalizeArchiveId(value.archiveId);
  const sessionId = normalizeIdentity(value.sessionId);
  const authorityId = normalizeIdentity(value.authorityId);
  const finalRevision = normalizeFinalRevision(value.finalRevision);
  const byteLength = normalizeByteLength(value.byteLength);
  const sha256 = normalizeSha256(value.sha256);
  const projectionCodec = value.projectionCodec === undefined
    ? undefined
    : value.projectionCodec === COMPLETED_TERMINAL_HISTORY_ARCHIVE_PROJECTION_CODEC
      ? value.projectionCodec
      : undefined;
  const projectionByteLength = value.projectionByteLength === undefined
    ? undefined
    : normalizeByteLength(value.projectionByteLength);
  const projectionSha256 = value.projectionSha256 === undefined
    ? undefined
    : normalizeSha256(value.projectionSha256);
  if (
    !archiveId ||
    !sessionId ||
    !authorityId ||
    finalRevision === undefined ||
    byteLength === undefined ||
    !sha256 ||
    archiveId !== createCompletedTerminalHistoryArchiveId(sha256) ||
    (value.projectionCodec !== undefined && projectionCodec === undefined) ||
    (value.projectionByteLength !== undefined && projectionByteLength === undefined) ||
    (value.projectionSha256 !== undefined && projectionSha256 === undefined) ||
    (projectionCodec !== undefined &&
      (projectionByteLength === undefined || projectionSha256 === undefined)) ||
    (projectionCodec === undefined &&
      (projectionByteLength !== undefined || projectionSha256 !== undefined))
  ) {
    return undefined;
  }

  return {
    version: COMPLETED_TERMINAL_HISTORY_ARCHIVE_VERSION,
    archiveId,
    codec: COMPLETED_TERMINAL_HISTORY_ARCHIVE_CODEC,
    sessionId,
    authorityId,
    finalRevision,
    byteLength,
    sha256,
    ...(projectionCodec !== undefined
      ? { projectionCodec, projectionByteLength, projectionSha256 }
      : {})
  };
}

export function createCompletedTerminalHistoryArchiveId(sha256: string): string {
  return `sha256-${sha256}`;
}

function normalizeArchiveId(value: unknown): string | undefined {
  return typeof value === 'string' && COMPLETED_TERMINAL_HISTORY_ARCHIVE_ID_PATTERN.test(value)
    ? value
    : undefined;
}

function normalizeSha256(value: unknown): string | undefined {
  return typeof value === 'string' && SHA256_PATTERN.test(value) ? value : undefined;
}

function normalizeIdentity(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim();
  return normalized && normalized.length <= 256 ? normalized : undefined;
}

function normalizeByteLength(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function normalizeFinalRevision(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
