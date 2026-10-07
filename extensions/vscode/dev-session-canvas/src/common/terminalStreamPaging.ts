import {
  normalizeTerminalStreamCheckpoint,
  normalizeTerminalStreamEvent,
  normalizeTerminalStreamRevision,
  type TerminalStreamCheckpoint,
  type TerminalStreamEvent
} from './terminalSessionStream';
export { normalizeTerminalReadOutcome } from './protocol';

// Keep each journal page short enough that one xterm write cannot monopolize
// the Webview event loop while another execution is receiving input.
export const TERMINAL_STREAM_PAGE_MAX_BYTES = 64 * 1024;
export const TERMINAL_STREAM_PAGE_MAX_EVENTS = 256;
export const TERMINAL_CURRENT_STATE_CHUNK_MAX_CHARS = 8192;

export interface TerminalStreamReadDescriptor {
  readId: string;
  sessionId: string;
  authorityId: string;
  checkpoint: TerminalStreamCheckpoint;
  headRevision: number;
  settlementMode?: 'final-application-v1';
  currentState?: { format: 'xterm-current-state-v1'; length: number };
}

export interface TerminalStreamPage {
  readId: string;
  sessionId: string;
  authorityId: string;
  afterRevision: number;
  revision: number;
  headRevision: number;
  events: TerminalStreamEvent[];
  stateChunk?: { offset: number; data: string };
}

export function normalizeTerminalStreamRead(value: unknown): TerminalStreamReadDescriptor | undefined {
  if (!isRecord(value) || !validId(value.readId) ||
      (value.settlementMode !== undefined && value.settlementMode !== 'final-application-v1')) {
    return undefined;
  }
  const checkpoint = normalizeTerminalStreamCheckpoint(value.checkpoint);
  const headRevision = normalizeTerminalStreamRevision(value.headRevision);
  if (!checkpoint || headRevision === undefined || checkpoint.revision > headRevision ||
      value.sessionId !== checkpoint.sessionId || value.authorityId !== checkpoint.authorityId) {
    return undefined;
  }
  const currentState = value.currentState;
  if (currentState !== undefined && (!isRecord(currentState) ||
      currentState.format !== 'xterm-current-state-v1' || !Number.isSafeInteger(currentState.length) ||
      (currentState.length as number) <= 0 ||
      checkpoint.serializedState.data !== '')) return undefined;
  return { readId: value.readId, sessionId: checkpoint.sessionId, authorityId: checkpoint.authorityId,
    checkpoint, headRevision,
    ...(isRecord(currentState) ? { currentState: {
      format: 'xterm-current-state-v1' as const, length: currentState.length as number } } : {}),
    ...(value.settlementMode === 'final-application-v1' ? { settlementMode: value.settlementMode } : {}) };
}

export function normalizeTerminalStreamPage(value: unknown): TerminalStreamPage | undefined {
  if (!isRecord(value) || !validId(value.readId) || !validId(value.sessionId) || !validId(value.authorityId)) {
    return undefined;
  }
  const afterRevision = normalizeTerminalStreamRevision(value.afterRevision);
  const revision = normalizeTerminalStreamRevision(value.revision);
  const headRevision = normalizeTerminalStreamRevision(value.headRevision);
  if (afterRevision === undefined || revision === undefined || headRevision === undefined ||
      afterRevision > revision || revision > headRevision || !Array.isArray(value.events) ||
      value.events.length > TERMINAL_STREAM_PAGE_MAX_EVENTS) {
    return undefined;
  }
  if (value.stateChunk !== undefined) {
    const chunk = value.stateChunk;
    if (!isRecord(chunk) || !Number.isSafeInteger(chunk.offset) || (chunk.offset as number) < 0 ||
        typeof chunk.data !== 'string' || chunk.data.length === 0 ||
        chunk.data.length > TERMINAL_CURRENT_STATE_CHUNK_MAX_CHARS || value.events.length !== 0 ||
        afterRevision !== revision) return undefined;
    const page: TerminalStreamPage = { readId: value.readId, sessionId: value.sessionId, authorityId: value.authorityId,
      afterRevision, revision, headRevision, events: [], stateChunk: { offset: chunk.offset as number, data: chunk.data } };
    return new TextEncoder().encode(JSON.stringify(page)).length <= TERMINAL_STREAM_PAGE_MAX_BYTES ? page : undefined;
  }
  const events: TerminalStreamEvent[] = [];
  for (const rawEvent of value.events) {
    const event = normalizeTerminalStreamEvent(rawEvent);
    if (!event || event.revision !== afterRevision + events.length + 1) {
      return undefined;
    }
    events.push(event);
  }
  if (afterRevision + events.length !== revision ||
      (events.length === 0 && revision !== headRevision) ||
      (events.length > 1 && new TextEncoder().encode(JSON.stringify(events)).length > TERMINAL_STREAM_PAGE_MAX_BYTES)) {
    return undefined;
  }
  return { readId: value.readId, sessionId: value.sessionId, authorityId: value.authorityId,
    afterRevision, revision, headRevision, events };
}

export function takeTerminalStreamPage(events: readonly TerminalStreamEvent[], startIndex: number): TerminalStreamEvent[] {
  const page: TerminalStreamEvent[] = [];
  const encoder = new TextEncoder();
  let bytes = 2;
  for (let index = startIndex; index < events.length && page.length < TERMINAL_STREAM_PAGE_MAX_EVENTS; index += 1) {
    const event = events[index];
    const eventBytes = encoder.encode(JSON.stringify(event)).length + (page.length > 0 ? 1 : 0);
    if (page.length > 0 && bytes + eventBytes > TERMINAL_STREAM_PAGE_MAX_BYTES) {
      break;
    }
    page.push(event);
    bytes += eventBytes;
  }
  return page;
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
