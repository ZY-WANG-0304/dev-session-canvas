import {
  normalizeSerializedTerminalState,
  type SerializedTerminalState
} from './serializedTerminalState';

export const TERMINAL_SESSION_STREAM_VERSION = 1 as const;

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
  if (!isRecord(value) || value.version !== TERMINAL_SESSION_STREAM_VERSION) {
    return undefined;
  }

  const sessionId = normalizeIdentity(value.sessionId);
  const authorityId = normalizeIdentity(value.authorityId);
  const revision = normalizeTerminalStreamRevision(value.revision);
  const checkpoint = normalizeTerminalStreamCheckpoint(value.checkpoint);
  if (!sessionId || !authorityId || revision === undefined || !checkpoint) {
    return undefined;
  }
  if (checkpoint.sessionId !== sessionId || checkpoint.authorityId !== authorityId || checkpoint.revision > revision) {
    return undefined;
  }

  const rawEvents = Array.isArray(value.events) ? value.events : [];
  const events: TerminalStreamEvent[] = [];
  let expectedRevision = checkpoint.revision + 1;
  for (const rawEvent of rawEvents) {
    const event = normalizeTerminalStreamEvent(rawEvent);
    if (!event || event.revision !== expectedRevision || event.revision > revision) {
      return undefined;
    }
    events.push(event);
    expectedRevision += 1;
  }
  if (expectedRevision !== revision + 1) {
    return undefined;
  }

  return {
    version: TERMINAL_SESSION_STREAM_VERSION,
    sessionId,
    authorityId,
    revision,
    checkpoint,
    events
  };
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
