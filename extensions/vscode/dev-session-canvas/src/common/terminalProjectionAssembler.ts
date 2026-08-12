import { createHash } from 'crypto';

import type {
  RuntimeSupervisorReadTerminalProjectionResult,
  RuntimeSupervisorTerminalProjectionCheckpointDescriptor,
  RuntimeSupervisorTerminalProjectionChunk
} from './runtimeSupervisorProtocol';
import {
  TERMINAL_SESSION_STREAM_VERSION,
  type TerminalStreamAttachPayload,
  type TerminalStreamCheckpoint,
  type TerminalStreamEvent
} from './terminalSessionStream';
import type { SerializedTerminalState } from './serializedTerminalState';

// Keep the in-memory assembly bound aligned with serialized terminal state
// validation; completed output history itself remains intentionally unbounded.
const MAX_ASSEMBLED_CHECKPOINT_DATA_LENGTH = 5 * 1024 * 1024;

/** Reasons a fixed projection cannot be promoted to a complete terminal stream. */
export type TerminalProjectionAssemblyErrorCode =
  | 'invalid-options'
  | 'identity-mismatch'
  | 'invalid-response'
  | 'invalid-checksum'
  | 'invalid-payload-size'
  | 'chunk-order'
  | 'incomplete'
  | 'already-finished';

/** A structured, fail-closed error from the fixed projection assembler. */
export class TerminalProjectionAssemblyError extends Error {
  public constructor(
    public readonly code: TerminalProjectionAssemblyErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'TerminalProjectionAssemblyError';
  }
}

export interface TerminalProjectionAssemblerOptions {
  sessionId: string;
  authorityId: string;
  projectionId: string;
  targetRevision: number;
  checkpoint: RuntimeSupervisorTerminalProjectionCheckpointDescriptor;
  /** Optional expected Supervisor process identity. */
  supervisorInstanceId?: string;
}

export interface TerminalProjectionAssembler {
  /** Consume one credit-bounded Supervisor response. */
  append(result: RuntimeSupervisorReadTerminalProjectionResult): void;
  /**
   * Promote the consumed fixed stream to an attach payload.
   *
   * `append` must have observed a fixed (`live !== true`) done response before
   * this method is called. Calling it more than once is idempotent.
   */
  finish(): TerminalStreamAttachPayload;
  /** True after a terminal done response has been consumed. */
  readonly done: boolean;
}

/**
 * Create an in-memory assembler for one fixed terminal projection.
 *
 * The assembler deliberately keeps only the checkpoint data and the events
 * needed for the final stream. It never writes Canvas state or an archive and
 * can therefore be used by both finalization and focused protocol tests.
 */
export function createTerminalProjectionAssembler(
  options: TerminalProjectionAssemblerOptions
): TerminalProjectionAssembler {
  const normalized = normalizeOptions(options);
  const checkpointDataParts: string[] = [];
  let checkpointDataLength = 0;
  let checkpointLastCodeUnit: number | undefined;
  let checkpointComplete = false;
  let nextRevision = normalized.checkpoint.revision + 1;
  let currentOutput:
    | {
        revision: number;
        createdAtMs: number;
        dataParts: string[];
        dataLength: number;
        lastCodeUnit?: number;
        offset: number;
      }
    | undefined;
  const events: TerminalStreamEvent[] = [];
  let terminalDone = false;
  let finishedPayload: TerminalStreamAttachPayload | undefined;

  const append = (result: RuntimeSupervisorReadTerminalProjectionResult): void => {
    if (terminalDone) {
      throw assemblyError('already-finished', 'A terminal projection response arrived after the stream was complete.');
    }

    validateResponseIdentity(result, normalized);
    const chunk = normalizeProjectionChunk(result.chunk);
    if (result.chunk !== undefined && !chunk) {
      throw assemblyError('invalid-response', 'The terminal projection chunk shape is invalid.');
    }
    validateResponseEnvelope(result, chunk);

    if (!chunk) {
      // A fixed projection normally ends on the final data-bearing response,
      // but accepting an empty done marker makes the reducer robust to a
      // transport that emits a separate completion envelope.
      if (!result.done || result.live === true) {
        throw assemblyError('invalid-response', 'A projection response without a chunk must be a fixed done marker.');
      }
      assertCompleteState();
      terminalDone = true;
      return;
    }

    if (result.live === true) {
      throw assemblyError('invalid-response', 'A fixed projection cannot transition to a live subscription.');
    }
    if (result.done && !chunk.complete) {
      throw assemblyError('incomplete', 'A projection cannot finish in the middle of a data chunk.');
    }

    if (chunk.kind === 'checkpoint') {
      appendCheckpointChunk(chunk);
    } else if (chunk.kind === 'output') {
      appendOutputChunk(chunk);
    } else {
      appendMetadataChunk(chunk);
    }

    if (result.done) {
      assertCompleteState();
      terminalDone = true;
    }
  };

  const finish = (): TerminalStreamAttachPayload => {
    if (finishedPayload) {
      return finishedPayload;
    }
    if (!terminalDone) {
      throw assemblyError('incomplete', 'The fixed terminal projection has not emitted a done response.');
    }
    assertCompleteState();

    const serializedState: SerializedTerminalState = {
      ...normalized.checkpoint.serializedState,
      data: checkpointDataParts.join(''),
      outputSequence: normalized.checkpoint.revision
    };
    const checkpoint: TerminalStreamCheckpoint = {
      version: TERMINAL_SESSION_STREAM_VERSION,
      sessionId: normalized.sessionId,
      authorityId: normalized.authorityId,
      revision: normalized.checkpoint.revision,
      cols: normalized.checkpoint.cols,
      rows: normalized.checkpoint.rows,
      scrollback: normalized.checkpoint.scrollback,
      createdAtMs: normalized.checkpoint.createdAtMs,
      serializedState
    };
    // Every component was normalized as it arrived and the revision barrier
    // was checked above. Avoid re-normalizing/cloning the complete event array
    // synchronously at this completion boundary.
    const payload: TerminalStreamAttachPayload = {
      version: TERMINAL_SESSION_STREAM_VERSION,
      sessionId: normalized.sessionId,
      authorityId: normalized.authorityId,
      revision: normalized.targetRevision,
      checkpoint,
      events
    };
    finishedPayload = payload;
    return payload;
  };

  const appendCheckpointChunk = (
    chunk: Extract<RuntimeSupervisorTerminalProjectionChunk, { kind: 'checkpoint' }>
  ): void => {
    if (checkpointComplete || currentOutput || events.length > 0 || chunk.dataOffset !== checkpointDataLength) {
      throw assemblyError('chunk-order', 'Checkpoint chunks are not contiguous or arrived after terminal events.');
    }
    if (!chunk.data && !chunk.complete) {
      throw assemblyError('chunk-order', 'An incomplete checkpoint chunk must advance its data offset.');
    }
    if (checkpointDataLength + chunk.data.length > MAX_ASSEMBLED_CHECKPOINT_DATA_LENGTH) {
      throw assemblyError('invalid-response', 'Terminal projection checkpoint data exceeds the supported size.');
    }
    assertAppendableText(checkpointLastCodeUnit, chunk.data, 'checkpoint');
    if (chunk.data) {
      checkpointDataParts.push(chunk.data);
      checkpointDataLength += chunk.data.length;
      checkpointLastCodeUnit = chunk.data.charCodeAt(chunk.data.length - 1);
    }
    checkpointComplete = chunk.complete;
  };

  const appendOutputChunk = (
    chunk: Extract<RuntimeSupervisorTerminalProjectionChunk, { kind: 'output' }>
  ): void => {
    if (!checkpointComplete) {
      throw assemblyError('chunk-order', 'Output arrived before the checkpoint was complete.');
    }
    if (!chunk.data && !chunk.complete) {
      throw assemblyError('chunk-order', 'An incomplete output chunk must advance its data offset.');
    }

    if (!currentOutput) {
      if (chunk.revision !== nextRevision || chunk.dataOffset !== 0) {
        throw assemblyError('chunk-order', 'The first output chunk does not start at the next revision or offset zero.');
      }
      currentOutput = {
        revision: chunk.revision,
        createdAtMs: chunk.createdAtMs,
        dataParts: [],
        dataLength: 0,
        offset: 0
      };
    } else if (
      chunk.revision !== currentOutput.revision ||
      chunk.createdAtMs !== currentOutput.createdAtMs ||
      chunk.dataOffset !== currentOutput.offset
    ) {
      throw assemblyError('chunk-order', 'Output chunks for one revision are not contiguous.');
    }

    assertAppendableText(currentOutput.lastCodeUnit, chunk.data, 'output');
    if (chunk.data) {
      currentOutput.dataParts.push(chunk.data);
      currentOutput.dataLength += chunk.data.length;
      currentOutput.lastCodeUnit = chunk.data.charCodeAt(chunk.data.length - 1);
    }
    currentOutput.offset += chunk.data.length;
    if (chunk.complete) {
      if (currentOutput.dataLength === 0) {
        throw assemblyError('chunk-order', 'An output event cannot be empty.');
      }
      events.push({
        type: 'output',
        revision: currentOutput.revision,
        createdAtMs: currentOutput.createdAtMs,
        data: currentOutput.dataParts.join('')
      });
      nextRevision = currentOutput.revision + 1;
      currentOutput = undefined;
    }
  };

  const appendMetadataChunk = (
    chunk:
      | Extract<RuntimeSupervisorTerminalProjectionChunk, { kind: 'resize' }>
      | Extract<RuntimeSupervisorTerminalProjectionChunk, { kind: 'scrollback' }>
  ): void => {
    if (!checkpointComplete || currentOutput || chunk.revision !== nextRevision) {
      throw assemblyError('chunk-order', 'Resize/scrollback revision is not contiguous with the checkpoint stream.');
    }
    events.push(
      chunk.kind === 'resize'
        ? {
            type: 'resize',
            revision: chunk.revision,
            createdAtMs: chunk.createdAtMs,
            cols: chunk.cols,
            rows: chunk.rows
          }
        : {
            type: 'scrollback',
            revision: chunk.revision,
            createdAtMs: chunk.createdAtMs,
            scrollback: chunk.scrollback
          }
    );
    nextRevision += 1;
  };

  const assertCompleteState = (): void => {
    if (!checkpointComplete || currentOutput || nextRevision !== normalized.targetRevision + 1) {
      throw assemblyError('incomplete', 'The fixed terminal projection does not cover the requested final revision.');
    }
  };

  return {
    append,
    finish,
    get done(): boolean {
      return terminalDone;
    }
  };
}

/** Assemble a fixed projection from an iterable of read responses. */
export function assembleTerminalProjection(
  options: TerminalProjectionAssemblerOptions,
  results: Iterable<RuntimeSupervisorReadTerminalProjectionResult>
): TerminalStreamAttachPayload {
  const assembler = createTerminalProjectionAssembler(options);
  for (const result of results) {
    assembler.append(result);
  }
  return assembler.finish();
}

/** Compute the checksum used by the Supervisor for one canonical chunk. */
export function checksumTerminalProjectionChunk(chunk: RuntimeSupervisorTerminalProjectionChunk): string {
  return createHash('sha256').update(JSON.stringify(chunk), 'utf8').digest('hex');
}

function normalizeOptions(options: TerminalProjectionAssemblerOptions): {
  sessionId: string;
  authorityId: string;
  projectionId: string;
  targetRevision: number;
  checkpoint: RuntimeSupervisorTerminalProjectionCheckpointDescriptor;
  supervisorInstanceId?: string;
} {
  if (
    !isIdentity(options.sessionId) ||
    !isIdentity(options.authorityId) ||
    !isIdentity(options.projectionId) ||
    !isRevision(options.targetRevision)
  ) {
    throw assemblyError('invalid-options', 'Terminal projection identity and target revision are invalid.');
  }
  const checkpoint = options.checkpoint;
  if (
    !checkpoint ||
    checkpoint.version !== TERMINAL_SESSION_STREAM_VERSION ||
    checkpoint.sessionId !== options.sessionId ||
    checkpoint.authorityId !== options.authorityId ||
    !isRevision(checkpoint.revision) ||
    checkpoint.revision > options.targetRevision ||
    !isDimension(checkpoint.cols, 2) ||
    !isDimension(checkpoint.rows, 1) ||
    !isRevision(checkpoint.scrollback) ||
    !isTimestamp(checkpoint.createdAtMs) ||
    !checkpoint.serializedState ||
    checkpoint.serializedState.format !== 'xterm-serialize-v1' ||
    (checkpoint.serializedState.viewportY !== undefined &&
      !isRevision(checkpoint.serializedState.viewportY)) ||
    (checkpoint.serializedState.outputSequence !== undefined &&
      checkpoint.serializedState.outputSequence !== checkpoint.revision)
  ) {
    throw assemblyError('invalid-options', 'Terminal projection checkpoint metadata is invalid.');
  }
  if (
    options.supervisorInstanceId !== undefined &&
    !isIdentity(options.supervisorInstanceId)
  ) {
    throw assemblyError('invalid-options', 'The expected Supervisor instance identity is invalid.');
  }
  return {
    sessionId: options.sessionId,
    authorityId: options.authorityId,
    projectionId: options.projectionId,
    targetRevision: options.targetRevision,
    checkpoint: {
      version: TERMINAL_SESSION_STREAM_VERSION,
      sessionId: checkpoint.sessionId,
      authorityId: checkpoint.authorityId,
      revision: checkpoint.revision,
      cols: checkpoint.cols,
      rows: checkpoint.rows,
      scrollback: checkpoint.scrollback,
      createdAtMs: checkpoint.createdAtMs,
      serializedState: {
        format: checkpoint.serializedState.format,
        ...(checkpoint.serializedState.viewportY === undefined
          ? {}
          : { viewportY: checkpoint.serializedState.viewportY }),
        ...(checkpoint.serializedState.outputSequence === undefined
          ? {}
          : { outputSequence: checkpoint.serializedState.outputSequence })
      }
    },
    ...(options.supervisorInstanceId === undefined
      ? {}
      : { supervisorInstanceId: options.supervisorInstanceId })
  };
}

function validateResponseIdentity(
  result: RuntimeSupervisorReadTerminalProjectionResult,
  options: ReturnType<typeof normalizeOptions>
): void {
  if (
    !result ||
    result.projectionId !== options.projectionId ||
    result.sessionId !== options.sessionId ||
    result.authorityId !== options.authorityId ||
    result.targetRevision !== options.targetRevision ||
    (options.supervisorInstanceId !== undefined &&
      result.supervisorInstanceId !== options.supervisorInstanceId)
  ) {
    throw assemblyError('identity-mismatch', 'Terminal projection response identity changed while being read.');
  }
}

function validateResponseEnvelope(
  result: RuntimeSupervisorReadTerminalProjectionResult,
  chunk: RuntimeSupervisorTerminalProjectionChunk | undefined
): void {
  if (
    typeof result.done !== 'boolean' ||
    !isRevision(result.payloadBytes) ||
    result.payloadBytes !== (chunk === undefined ? 0 : utf8ByteLength(JSON.stringify(chunk)))
  ) {
    throw assemblyError('invalid-payload-size', 'Terminal projection payload byte count is invalid.');
  }
  if (chunk === undefined) {
    if (result.chunkChecksum !== undefined || result.payloadBytes !== 0) {
      throw assemblyError('invalid-response', 'An empty projection response must not carry payload metadata.');
    }
    return;
  }
  if (
    typeof result.chunkChecksum !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(result.chunkChecksum) ||
    checksumTerminalProjectionChunk(chunk) !== result.chunkChecksum
  ) {
    throw assemblyError('invalid-checksum', 'Terminal projection chunk checksum verification failed.');
  }
}

function normalizeProjectionChunk(
  value: RuntimeSupervisorTerminalProjectionChunk | undefined
): RuntimeSupervisorTerminalProjectionChunk | undefined {
  if (!value || typeof value !== 'object' || typeof value.kind !== 'string') {
    return undefined;
  }
  const integer = (candidate: unknown): number | undefined =>
    typeof candidate === 'number' && Number.isSafeInteger(candidate) && candidate >= 0
      ? candidate
      : undefined;
  if (value.kind === 'checkpoint') {
    const dataOffset = integer(value.dataOffset);
    return typeof value.data === 'string' && dataOffset !== undefined && typeof value.complete === 'boolean'
      ? { kind: 'checkpoint', dataOffset, data: value.data, complete: value.complete }
      : undefined;
  }
  const revision = integer(value.revision);
  const createdAtMs = typeof value.createdAtMs === 'number' && Number.isFinite(value.createdAtMs)
    ? value.createdAtMs
    : undefined;
  if (value.kind === 'output') {
    const dataOffset = integer(value.dataOffset);
    return typeof value.data === 'string' &&
      dataOffset !== undefined &&
      revision !== undefined &&
      revision > 0 &&
      createdAtMs !== undefined &&
      createdAtMs >= 0 &&
      typeof value.complete === 'boolean'
      ? { kind: 'output', revision, createdAtMs, dataOffset, data: value.data, complete: value.complete }
      : undefined;
  }
  if (value.kind === 'resize') {
    const cols = integer(value.cols);
    const rows = integer(value.rows);
    return revision !== undefined &&
      revision > 0 &&
      createdAtMs !== undefined &&
      createdAtMs >= 0 &&
      cols !== undefined &&
      cols >= 2 &&
      rows !== undefined &&
      rows >= 1 &&
      value.complete === true
      ? { kind: 'resize', revision, createdAtMs, cols, rows, complete: true }
      : undefined;
  }
  if (value.kind === 'scrollback') {
    const scrollback = integer(value.scrollback);
    return revision !== undefined &&
      revision > 0 &&
      createdAtMs !== undefined &&
      createdAtMs >= 0 &&
      scrollback !== undefined &&
      value.complete === true
      ? { kind: 'scrollback', revision, createdAtMs, scrollback, complete: true }
      : undefined;
  }
  return undefined;
}

function assertAppendableText(previousCodeUnit: number | undefined, next: string, label: string): void {
  if (splitsUtf16SurrogatePair(previousCodeUnit, next)) {
    throw assemblyError('chunk-order', `${label} chunks split a UTF-16 surrogate pair.`);
  }
}

function splitsUtf16SurrogatePair(previousCodeUnit: number | undefined, next: string): boolean {
  if (previousCodeUnit === undefined || !next) {
    return false;
  }
  const first = next.charCodeAt(0);
  return previousCodeUnit >= 0xd800 && previousCodeUnit <= 0xdbff && first >= 0xdc00 && first <= 0xdfff;
}

function isIdentity(value: unknown): value is string {
  return typeof value === 'string' &&
    value.trim() === value &&
    value.length > 0 &&
    value.length <= 256;
}

function isRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isDimension(value: unknown, minimum: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function assemblyError(code: TerminalProjectionAssemblyErrorCode, message: string): TerminalProjectionAssemblyError {
  return new TerminalProjectionAssemblyError(code, message);
}
