import {
  normalizeSerializedTerminalState,
  type SerializedTerminalState
} from './serializedTerminalState';

export const TERMINAL_SESSION_STREAM_VERSION = 1 as const;
const TERMINAL_STREAM_NORMALIZATION_EVENT_BATCH_SIZE = 512;

export type TerminalStreamRevision = number;

interface TerminalStreamEventBase {
  revision: TerminalStreamRevision;
  createdAtMs: number;
}

export interface TerminalStreamOutputEvent extends TerminalStreamEventBase {
  type: 'output';
  data: string;
}

export interface TerminalStreamResizeEvent extends TerminalStreamEventBase {
  type: 'resize';
  cols: number;
  rows: number;
}

export interface TerminalStreamScrollbackEvent extends TerminalStreamEventBase {
  type: 'scrollback';
  scrollback: number;
}

export type TerminalStreamEvent =
  | TerminalStreamOutputEvent
  | TerminalStreamResizeEvent
  | TerminalStreamScrollbackEvent;

export interface TerminalStreamCheckpoint {
  version: typeof TERMINAL_SESSION_STREAM_VERSION;
  sessionId: string;
  authorityId: string;
  revision: TerminalStreamRevision;
  cols: number;
  rows: number;
  scrollback: number;
  createdAtMs: number;
  serializedState: SerializedTerminalState;
}

export interface TerminalStreamAttachPayload {
  version: typeof TERMINAL_SESSION_STREAM_VERSION;
  sessionId: string;
  authorityId: string;
  revision: TerminalStreamRevision;
  checkpoint: TerminalStreamCheckpoint;
  events: TerminalStreamEvent[];
}

export interface TerminalStreamProjectionMergeResult {
  payload: TerminalStreamAttachPayload;
  preservedLiveTailEventCount: number;
}

interface TerminalStreamAttachPayloadNormalizationContext {
  sessionId: string;
  authorityId: string;
  revision: TerminalStreamRevision;
  checkpoint: TerminalStreamCheckpoint;
  rawEvents: unknown[];
}

export function normalizeTerminalStreamRevision(value: unknown): TerminalStreamRevision | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

export function normalizeTerminalStreamEvent(value: unknown): TerminalStreamEvent | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const revision = normalizeTerminalStreamRevision(value.revision);
  const createdAtMs = normalizeTimestamp(value.createdAtMs);
  if (revision === undefined || revision === 0 || createdAtMs === undefined) {
    return undefined;
  }

  if (value.type === 'output') {
    return typeof value.data === 'string' && value.data.length > 0
      ? {
          type: 'output',
          revision,
          createdAtMs,
          data: value.data
        }
      : undefined;
  }

  if (value.type === 'resize') {
    const cols = normalizeTerminalDimension(value.cols, 2);
    const rows = normalizeTerminalDimension(value.rows, 1);
    return cols !== undefined && rows !== undefined
      ? {
          type: 'resize',
          revision,
          createdAtMs,
          cols,
          rows
        }
      : undefined;
  }

  if (value.type === 'scrollback') {
    const scrollback = normalizeTerminalStreamRevision(value.scrollback);
    return scrollback !== undefined
      ? {
          type: 'scrollback',
          revision,
          createdAtMs,
          scrollback
        }
      : undefined;
  }

  return undefined;
}

export function normalizeTerminalStreamCheckpoint(value: unknown): TerminalStreamCheckpoint | undefined {
  if (!isRecord(value) || value.version !== TERMINAL_SESSION_STREAM_VERSION) {
    return undefined;
  }

  const sessionId = normalizeIdentity(value.sessionId);
  const authorityId = normalizeIdentity(value.authorityId);
  const revision = normalizeTerminalStreamRevision(value.revision);
  const cols = normalizeTerminalDimension(value.cols, 2);
  const rows = normalizeTerminalDimension(value.rows, 1);
  const scrollback = normalizeTerminalStreamRevision(value.scrollback);
  const createdAtMs = normalizeTimestamp(value.createdAtMs);
  const serializedState = normalizeSerializedTerminalState(value.serializedState);
  if (
    !sessionId ||
    !authorityId ||
    revision === undefined ||
    cols === undefined ||
    rows === undefined ||
    scrollback === undefined ||
    createdAtMs === undefined ||
    !serializedState ||
    serializedState.outputSequence !== revision
  ) {
    return undefined;
  }

  return {
    version: TERMINAL_SESSION_STREAM_VERSION,
    sessionId,
    authorityId,
    revision,
    cols,
    rows,
    scrollback,
    createdAtMs,
    serializedState
  };
}

export function normalizeTerminalStreamAttachPayload(value: unknown): TerminalStreamAttachPayload | undefined {
  const context = createTerminalStreamAttachPayloadNormalizationContext(value);
  if (!context) {
    return undefined;
  }
  const events: TerminalStreamEvent[] = [];
  let expectedRevision = context.checkpoint.revision + 1;
  for (const rawEvent of context.rawEvents) {
    const event = normalizeTerminalStreamEvent(rawEvent);
    if (!event || event.revision !== expectedRevision || event.revision > context.revision) {
      return undefined;
    }
    events.push(event);
    expectedRevision += 1;
  }
  if (expectedRevision !== context.revision + 1) {
    return undefined;
  }

  return {
    version: TERMINAL_SESSION_STREAM_VERSION,
    sessionId: context.sessionId,
    authorityId: context.authorityId,
    revision: context.revision,
    checkpoint: context.checkpoint,
    events
  };
}

/**
 * Validates and clones large event arrays in bounded turns. Archive migration
 * uses this path so thousands of small records cannot monopolize the Host.
 */
export async function normalizeTerminalStreamAttachPayloadAsync(
  value: unknown
): Promise<TerminalStreamAttachPayload | undefined> {
  const context = createTerminalStreamAttachPayloadNormalizationContext(value);
  if (!context) {
    return undefined;
  }
  const events: TerminalStreamEvent[] = [];
  let expectedRevision = context.checkpoint.revision + 1;
  for (let index = 0; index < context.rawEvents.length; index += 1) {
    const event = normalizeTerminalStreamEvent(context.rawEvents[index]);
    if (!event || event.revision !== expectedRevision || event.revision > context.revision) {
      return undefined;
    }
    events.push(event);
    expectedRevision += 1;
    if (
      (index + 1) % TERMINAL_STREAM_NORMALIZATION_EVENT_BATCH_SIZE === 0 &&
      index + 1 < context.rawEvents.length
    ) {
      await yieldTerminalStreamNormalization();
    }
  }
  if (expectedRevision !== context.revision + 1) {
    return undefined;
  }
  return {
    version: TERMINAL_SESSION_STREAM_VERSION,
    sessionId: context.sessionId,
    authorityId: context.authorityId,
    revision: context.revision,
    checkpoint: context.checkpoint,
    events
  };
}

function createTerminalStreamAttachPayloadNormalizationContext(
  value: unknown
): TerminalStreamAttachPayloadNormalizationContext | undefined {
  if (!isRecord(value) || value.version !== TERMINAL_SESSION_STREAM_VERSION) {
    return undefined;
  }
  const sessionId = normalizeIdentity(value.sessionId);
  const authorityId = normalizeIdentity(value.authorityId);
  const revision = normalizeTerminalStreamRevision(value.revision);
  const checkpoint = normalizeTerminalStreamCheckpoint(value.checkpoint);
  if (
    !sessionId ||
    !authorityId ||
    revision === undefined ||
    !checkpoint ||
    checkpoint.sessionId !== sessionId ||
    checkpoint.authorityId !== authorityId ||
    checkpoint.revision > revision
  ) {
    return undefined;
  }
  return {
    sessionId,
    authorityId,
    revision,
    checkpoint,
    rawEvents: Array.isArray(value.events) ? value.events : []
  };
}

function yieldTerminalStreamNormalization(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof setImmediate === 'function') {
      setImmediate(resolve);
      return;
    }
    setTimeout(resolve, 0);
  });
}

export function cloneTerminalStreamEvent(event: TerminalStreamEvent): TerminalStreamEvent {
  if (event.type === 'output') {
    return { ...event };
  }
  if (event.type === 'resize') {
    return { ...event };
  }
  return { ...event };
}

export function cloneTerminalStreamCheckpoint(checkpoint: TerminalStreamCheckpoint): TerminalStreamCheckpoint {
  return {
    ...checkpoint,
    serializedState: {
      ...checkpoint.serializedState
    }
  };
}

export function cloneTerminalStreamAttachPayload(
  payload: TerminalStreamAttachPayload | undefined
): TerminalStreamAttachPayload | undefined {
  return payload
    ? {
        ...payload,
        checkpoint: cloneTerminalStreamCheckpoint(payload.checkpoint),
        events: payload.events.map(cloneTerminalStreamEvent)
      }
    : undefined;
}

export function buildTerminalStreamAttachPayload(options: {
  sessionId: string;
  authorityId: string;
  revision: TerminalStreamRevision;
  checkpoint: TerminalStreamCheckpoint;
  events: readonly TerminalStreamEvent[];
}): TerminalStreamAttachPayload | undefined {
  return normalizeTerminalStreamAttachPayload({
    version: TERMINAL_SESSION_STREAM_VERSION,
    sessionId: options.sessionId,
    authorityId: options.authorityId,
    revision: options.revision,
    checkpoint: options.checkpoint,
    events: options.events
  });
}

export function mergeTerminalStreamProjectionWithLiveTail(
  freshValue: unknown,
  currentValue: unknown
): TerminalStreamProjectionMergeResult | undefined {
  const fresh = normalizeTerminalStreamAttachPayload(freshValue);
  const current = normalizeTerminalStreamAttachPayload(currentValue);
  if (
    !fresh ||
    !current ||
    fresh.sessionId !== current.sessionId ||
    fresh.authorityId !== current.authorityId
  ) {
    return undefined;
  }

  const liveTail = current.events.filter((event) => event.revision > fresh.revision);
  const payload = buildTerminalStreamAttachPayload({
    sessionId: fresh.sessionId,
    authorityId: fresh.authorityId,
    revision: Math.max(fresh.revision, current.revision),
    checkpoint: fresh.checkpoint,
    events: [...fresh.events, ...liveTail]
  });
  return payload
    ? {
        payload,
        preservedLiveTailEventCount: liveTail.length
      }
    : undefined;
}

function normalizeIdentity(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim();
  return normalized && normalized.length <= 256 ? normalized : undefined;
}

function normalizeTimestamp(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function normalizeTerminalDimension(value: unknown, minimum: number): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= minimum ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
