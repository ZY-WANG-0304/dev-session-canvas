import { SerializeAddon } from '@xterm/addon-serialize';
import { Terminal as HeadlessTerminal } from '@xterm/headless';

import { DEFAULT_TERMINAL_SCROLLBACK, normalizeTerminalScrollback } from './terminalScrollback';

export const SERIALIZED_TERMINAL_STATE_FORMAT = 'xterm-serialize-v1';
const XTERM_HEADLESS_PACKAGE_VERSION = readPackageVersion(
  (require('@xterm/headless/package.json') as { version?: unknown }).version,
  '@xterm/headless'
);
const XTERM_SERIALIZE_PACKAGE_VERSION = readPackageVersion(
  (require('@xterm/addon-serialize/package.json') as { version?: unknown }).version,
  '@xterm/addon-serialize'
);
export const SERIALIZED_TERMINAL_CHECKPOINT_PRODUCER_PROFILE = [
  `xterm-headless@${XTERM_HEADLESS_PACKAGE_VERSION}`,
  `addon-serialize@${XTERM_SERIALIZE_PACKAGE_VERSION}`,
  'safe-fingerprint-v1',
  'cell-data=exact-u32',
  'allowProposedApi=true',
  'unicode=default'
].join(';');
export const SERIALIZED_TERMINAL_CHECKPOINT_PROFILES: Readonly<Record<string, string>> = Object.freeze({
  [SERIALIZED_TERMINAL_STATE_FORMAT]: SERIALIZED_TERMINAL_CHECKPOINT_PRODUCER_PROFILE
});
const MAX_SERIALIZED_TERMINAL_STATE_DATA_LENGTH = 5 * 1024 * 1024;
const MAX_VALIDATED_TERMINAL_CHECKPOINT_DATA_LENGTH = 256 * 1024;
const SERIALIZED_TERMINAL_STATE_WRITE_BATCH_DELAY_MS = 16;
const SERIALIZED_TERMINAL_STATE_WRITE_CHUNK_CHARS = 32 * 1024;
const SERIALIZED_TERMINAL_STATE_CACHE_REFRESH_INTERVAL_MS = 1000;

export interface SerializedTerminalState {
  format: typeof SERIALIZED_TERMINAL_STATE_FORMAT;
  data: string;
  viewportY?: number;
  outputSequence?: number;
}

export interface SerializedTerminalStateTrackerOptions {
  scrollback?: number;
  initialState?: SerializedTerminalState;
  initialOutput?: string;
  initialOutputSequence?: number;
}

export type SerializedTerminalCheckpointRejectionReason =
  | 'tracker-disposed'
  | 'pending-write'
  | 'unsupported-xterm-internals'
  | 'parser-not-ground'
  | 'parser-paused'
  | 'utf16-decoder-carry'
  | 'utf8-decoder-carry'
  | 'osc8-state'
  | 'color-state'
  | 'serialized-state-too-large'
  | 'hydrate-failed'
  | 'state-mismatch'
  | 'validation-failed';

export type SerializedTerminalCheckpointValidationResult =
  | { eligible: true; state: SerializedTerminalState }
  | { eligible: false; reason: SerializedTerminalCheckpointRejectionReason };

export function normalizeSerializedTerminalState(value: unknown): SerializedTerminalState | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const format =
    'format' in value && value.format === SERIALIZED_TERMINAL_STATE_FORMAT ? value.format : undefined;
  const data = 'data' in value && typeof value.data === 'string' ? value.data : undefined;
  const viewportY =
    'viewportY' in value && typeof value.viewportY === 'number' && Number.isInteger(value.viewportY) && value.viewportY >= 0
      ? value.viewportY
      : undefined;
  const outputSequence =
    'outputSequence' in value &&
    typeof value.outputSequence === 'number' &&
    Number.isInteger(value.outputSequence) &&
    value.outputSequence >= 0
      ? value.outputSequence
      : undefined;
  if (!format || data === undefined || data.length > MAX_SERIALIZED_TERMINAL_STATE_DATA_LENGTH) {
    return undefined;
  }

  return {
    format,
    data,
    viewportY,
    outputSequence
  };
}

export function cloneSerializedTerminalState(
  value: SerializedTerminalState | undefined
): SerializedTerminalState | undefined {
  if (!value) {
    return undefined;
  }

  return {
    format: value.format,
    data: value.data,
    viewportY: value.viewportY,
    outputSequence: value.outputSequence
  };
}

export class SerializedTerminalStateTracker {
  private terminal: HeadlessTerminal;
  private serializeAddon: SerializeAddon;
  private scrollback: number;
  private operationChain: Promise<void> = Promise.resolve();
  private pendingWriteData = '';
  private pendingWriteOutputSequence: number | undefined;
  private outputSequence: number | undefined;
  private pendingWriteDrainTimer: ReturnType<typeof setTimeout> | undefined;
  private cachedStateDirty = false;
  private lastCachedStateRefreshAtMs = Date.now();
  private terminalStateVersion = 0;
  private checkpointValidationCache:
    | { version: number; result: SerializedTerminalCheckpointValidationResult }
    | undefined;
  private operationError: Error | undefined;
  private readonly colorStateSubscription: { dispose(): void } | undefined;
  private colorStateTouched = false;
  private disposed = false;
  private bottomScreenActivityTrackingEnabled = false;
  private bottomScreenSignature = '';
  private bottomScreenChangeVersion = 0;
  private cachedState: SerializedTerminalState = {
    format: SERIALIZED_TERMINAL_STATE_FORMAT,
    data: ''
  };

  public constructor(cols: number, rows: number, options: SerializedTerminalStateTrackerOptions = {}) {
    this.scrollback = normalizeTerminalScrollback(options.scrollback, DEFAULT_TERMINAL_SCROLLBACK);
    const runtime = this.createRuntime(cols, rows, this.scrollback);
    this.terminal = runtime.terminal;
    this.serializeAddon = runtime.serializeAddon;
    this.colorStateSubscription = subscribeToTerminalColorRequests(this.terminal, (event) => {
      // xterm reports OSC color queries separately from mutations. Only mutations
      // make the renderer palette impossible to prove from serialized terminal data.
      if (terminalColorEventMayChangeRendererState(event)) {
        this.colorStateTouched = true;
      }
    });
    this.refreshCachedState();

    const normalizedInitialState = normalizeSerializedTerminalState(options.initialState);
    const initialOutput = options.initialOutput;
    const initialOutputSequence = normalizeSerializedTerminalOutputSequence(options.initialOutputSequence);
    this.outputSequence = initialOutputSequence;
    this.refreshCachedState();
    const hasInitialOutput = initialOutput !== undefined;
    const canTrustInitialState =
      normalizedInitialState !== undefined &&
      (!hasInitialOutput ||
        (
          normalizedInitialState.outputSequence !== undefined &&
          initialOutputSequence !== undefined &&
          normalizedInitialState.outputSequence === initialOutputSequence
        ));

    if (canTrustInitialState && normalizedInitialState) {
      this.cachedState = cloneSerializedTerminalState(normalizedInitialState) ?? this.cachedState;
      if (normalizedInitialState.data) {
        this.enqueueOperation(() => this.writeInternal(normalizedInitialState.data));
      }
      return;
    }

    if (initialOutput) {
      this.enqueueOperation(() => this.drainWriteData(initialOutput, true, initialOutputSequence));
      return;
    }

  }

  public write(chunk: string, options: { outputSequence?: number } = {}): void {
    if (!chunk || this.disposed) {
      return;
    }

    this.pendingWriteData += chunk;
    this.pendingWriteOutputSequence = maxSerializedTerminalOutputSequence(
      this.pendingWriteOutputSequence,
      options.outputSequence
    );
    this.schedulePendingWriteDrain();
  }

  public markOutputSequence(outputSequence: number | undefined): void {
    if (this.disposed) {
      return;
    }

    const wasDirty = this.cachedStateDirty;
    const hasPendingWrite = this.pendingWriteData.length > 0;
    const changed = this.applyOutputSequence(outputSequence);
    if (!changed || wasDirty || hasPendingWrite) {
      return;
    }

    this.cachedState = {
      ...this.cachedState,
      outputSequence: this.outputSequence
    };
    this.cachedStateDirty = false;
  }

  public resize(cols: number, rows: number, options: { outputSequence?: number } = {}): void {
    if (this.disposed) {
      return;
    }

    this.clearPendingWriteDrainTimer();
    const pendingWriteBatch = this.takePendingWriteBatch();
    this.enqueueOperation(async () => {
      await this.drainWriteData(pendingWriteBatch.data, true, pendingWriteBatch.outputSequence);
      this.terminal.resize(cols, rows);
      this.markTerminalStateChanged();
      this.applyOutputSequence(options.outputSequence);
      this.refreshCachedState();
    });
  }

  public getScrollback(): number {
    return this.scrollback;
  }

  public async setScrollback(scrollback: number, options: { outputSequence?: number } = {}): Promise<void> {
    if (this.disposed) {
      await this.operationChain;
      return;
    }

    const normalizedScrollback = normalizeTerminalScrollback(scrollback, DEFAULT_TERMINAL_SCROLLBACK);
    if (normalizedScrollback === this.scrollback) {
      this.clearPendingWriteDrainTimer();
      const pendingWriteBatch = this.takePendingWriteBatch();
      this.enqueueOperation(async () => {
        await this.drainWriteData(pendingWriteBatch.data, true, pendingWriteBatch.outputSequence);
        if (this.applyOutputSequence(options.outputSequence)) {
          this.refreshCachedState();
        }
      });
      await this.operationChain;
      return;
    }

    this.clearPendingWriteDrainTimer();
    const pendingWriteBatch = this.takePendingWriteBatch();
    this.enqueueOperation(async () => {
      await this.drainWriteData(pendingWriteBatch.data, true, pendingWriteBatch.outputSequence);
      this.terminal.options.scrollback = normalizedScrollback;
      this.scrollback = normalizedScrollback;
      this.markTerminalStateChanged();
      this.applyOutputSequence(options.outputSequence);
      this.refreshCachedState();
    });

    await this.operationChain;
  }

  public getSerializedState(): SerializedTerminalState {
    return cloneSerializedTerminalState(this.cachedState) ?? {
      format: SERIALIZED_TERMINAL_STATE_FORMAT,
      data: ''
    };
  }

  public getBottomScreenSignature(rowCount = 8): string {
    return this.computeBottomScreenSignature(rowCount);
  }

  public getBottomScreenActivityToken(): string {
    return `${this.bottomScreenChangeVersion}:${this.bottomScreenSignature}`;
  }

  public enableBottomScreenActivityTracking(): void {
    if (this.bottomScreenActivityTrackingEnabled || this.disposed) {
      return;
    }
    this.bottomScreenActivityTrackingEnabled = true;
    this.refreshBottomScreenActivity();
  }

  private computeBottomScreenSignature(rowCount = 8): string {
    const buffer = this.terminal.buffer.active;
    const rows = Math.min(Math.max(1, Math.floor(rowCount)), this.terminal.rows);
    const screenStart = buffer.baseY;
    let contentBottom = screenStart;
    // TUI content can occupy only part of the physical viewport, so anchor to its lowest visible row.
    for (let row = screenStart + this.terminal.rows - 1; row >= screenStart; row -= 1) {
      if ((buffer.getLine(row)?.translateToString(true) ?? '').length > 0) {
        contentBottom = row;
        break;
      }
    }
    const start = Math.max(screenStart, contentBottom - rows + 1);
    const signatureParts = [
      `${this.terminal.cols}x${this.terminal.rows}:${rows}:${contentBottom - screenStart}`
    ];

    for (let row = start; row < start + rows; row += 1) {
      const line = buffer.getLine(row);
      if (!line) {
        signatureParts.push('missing');
        continue;
      }
      signatureParts.push(line.isWrapped ? 'wrapped' : 'line');
      for (let column = 0; column < line.length; column += 1) {
        const cell = line.getCell(column);
        if (!cell) {
          continue;
        }
        const chars = cell.getChars();
        const styled =
          cell.getFgColorMode() !== 0 ||
          cell.getBgColorMode() !== 0 ||
          cell.isBold() !== 0 ||
          cell.isItalic() !== 0 ||
          cell.isDim() !== 0 ||
          cell.isUnderline() !== 0 ||
          cell.isBlink() !== 0 ||
          cell.isInverse() !== 0 ||
          cell.isInvisible() !== 0 ||
          cell.isStrikethrough() !== 0 ||
          cell.isOverline() !== 0;
        if (!chars && !styled) {
          continue;
        }
        signatureParts.push(
          JSON.stringify([
            row - start,
            column,
            chars,
            cell.getWidth(),
            cell.getFgColorMode(),
            cell.getFgColor(),
            cell.getBgColorMode(),
            cell.getBgColor(),
            cell.isBold(),
            cell.isItalic(),
            cell.isDim(),
            cell.isUnderline(),
            cell.isBlink(),
            cell.isInverse(),
            cell.isInvisible(),
            cell.isStrikethrough(),
            cell.isOverline()
          ])
        );
      }
    }

    return signatureParts.join('|');
  }

  public async flush(): Promise<SerializedTerminalState> {
    if (this.disposed) {
      await this.operationChain;
      this.throwIfOperationFailed();
      return this.getSerializedState();
    }

    this.clearPendingWriteDrainTimer();
    const pendingWriteBatch = this.takePendingWriteBatch();
    this.enqueueOperation(() => this.drainWriteData(pendingWriteBatch.data, true, pendingWriteBatch.outputSequence));
    await this.operationChain;
    this.throwIfOperationFailed();
    if (this.cachedStateDirty) {
      this.refreshCachedState();
    }
    return this.getSerializedState();
  }

  public async flushValidatedCheckpoint(): Promise<SerializedTerminalCheckpointValidationResult> {
    if (this.disposed) {
      await this.operationChain;
      this.throwIfOperationFailed();
      return rejectCheckpoint('tracker-disposed');
    }

    this.clearPendingWriteDrainTimer();
    const pendingWriteBatch = this.takePendingWriteBatch();
    let result: SerializedTerminalCheckpointValidationResult | undefined;
    this.enqueueOperation(async () => {
      await this.drainWriteData(pendingWriteBatch.data, true, pendingWriteBatch.outputSequence);
      if (this.pendingWriteData || this.pendingWriteDrainTimer) {
        result = rejectCheckpoint('pending-write');
        return;
      }
      if (this.checkpointValidationCache?.version === this.terminalStateVersion) {
        result = cloneCheckpointValidationResult(this.checkpointValidationCache.result);
        return;
      }
      try {
        result = await this.validateCheckpoint();
      } catch {
        result = rejectCheckpoint('validation-failed');
      }
      this.checkpointValidationCache = {
        version: this.terminalStateVersion,
        result: cloneCheckpointValidationResult(result)
      };
    });
    await this.operationChain;
    this.throwIfOperationFailed();
    return result ?? rejectCheckpoint(this.disposed ? 'tracker-disposed' : 'validation-failed');
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.clearPendingWriteDrainTimer();
    this.pendingWriteData = '';
    this.pendingWriteOutputSequence = undefined;
    this.checkpointValidationCache = undefined;
    this.colorStateSubscription?.dispose();
    this.disposeRuntime();
  }

  private enqueueOperation(operation: () => Promise<void> | void): void {
    this.operationChain = this.operationChain
      .then(() => {
        if (this.disposed || this.operationError) {
          return;
        }

        return operation();
      })
      .catch((error) => {
        this.operationError = error instanceof Error ? error : new Error(String(error));
      });
  }

  private schedulePendingWriteDrain(): void {
    if (this.pendingWriteDrainTimer) {
      return;
    }

    this.pendingWriteDrainTimer = setTimeout(() => {
      this.pendingWriteDrainTimer = undefined;
      const pendingWriteBatch = this.takePendingWriteBatch();
      this.enqueueOperation(() => this.drainWriteData(pendingWriteBatch.data, false, pendingWriteBatch.outputSequence));
    }, SERIALIZED_TERMINAL_STATE_WRITE_BATCH_DELAY_MS);
  }

  private clearPendingWriteDrainTimer(): void {
    if (!this.pendingWriteDrainTimer) {
      return;
    }

    clearTimeout(this.pendingWriteDrainTimer);
    this.pendingWriteDrainTimer = undefined;
  }

  private takePendingWriteBatch(): { data: string; outputSequence?: number } {
    const batch = {
      data: this.pendingWriteData,
      outputSequence: this.pendingWriteOutputSequence
    };
    this.pendingWriteData = '';
    this.pendingWriteOutputSequence = undefined;
    return batch;
  }

  private async drainWriteData(
    data: string,
    forceRefresh: boolean,
    outputSequence?: number
  ): Promise<void> {
    const hadData = data.length > 0;
    let remainingData = data;
    let refreshedDuringDrain = false;
    while (remainingData && !this.disposed) {
      const chunk = remainingData.slice(0, SERIALIZED_TERMINAL_STATE_WRITE_CHUNK_CHARS);
      remainingData = remainingData.slice(chunk.length);
      await this.writeInternal(chunk, {
        refreshCachedState: false
      });
      this.cachedStateDirty = true;
      // Forced drains serialize once after all chunks settle; per-chunk snapshots make large finalization quadratic.
      if (
        !forceRefresh &&
        Date.now() - this.lastCachedStateRefreshAtMs >= SERIALIZED_TERMINAL_STATE_CACHE_REFRESH_INTERVAL_MS
      ) {
        this.refreshCachedState();
        refreshedDuringDrain = true;
      }
      if (remainingData) {
        await delay(0);
      }
    }

    this.applyOutputSequence(outputSequence);
    if ((forceRefresh || refreshedDuringDrain) && this.cachedStateDirty) {
      this.refreshCachedState();
    }
    if (hadData && this.bottomScreenActivityTrackingEnabled) {
      this.refreshBottomScreenActivity();
    }
  }

  private refreshBottomScreenActivity(): void {
    const signature = this.computeBottomScreenSignature();
    if (signature === this.bottomScreenSignature) {
      return;
    }
    // The version preserves intermediate frame changes even if a later poll sees the same final cells.
    this.bottomScreenSignature = signature;
    this.bottomScreenChangeVersion += 1;
  }

  private applyOutputSequence(outputSequence: number | undefined): boolean {
    const normalizedOutputSequence = normalizeSerializedTerminalOutputSequence(outputSequence);
    if (normalizedOutputSequence === undefined) {
      return false;
    }

    const nextOutputSequence =
      this.outputSequence === undefined
        ? normalizedOutputSequence
        : Math.max(this.outputSequence, normalizedOutputSequence);
    if (nextOutputSequence === this.outputSequence) {
      return false;
    }

    this.outputSequence = nextOutputSequence;
    this.markTerminalStateChanged();
    this.cachedStateDirty = true;
    return true;
  }

  private async writeInternal(
    data: string,
    options: {
      refreshCachedState?: boolean;
    } = {}
  ): Promise<void> {
    if (this.disposed) {
      return;
    }

    await new Promise<void>((resolve) => {
      this.terminal.write(data, () => resolve());
    });
    this.markTerminalStateChanged();
    if (options.refreshCachedState !== false) {
      this.refreshCachedState();
    } else {
      this.cachedStateDirty = true;
    }
  }

  private refreshCachedState(): void {
    this.cachedState = this.serializeState();
    this.cachedStateDirty = false;
    this.lastCachedStateRefreshAtMs = Date.now();
  }

  private markTerminalStateChanged(): void {
    this.terminalStateVersion += 1;
    this.checkpointValidationCache = undefined;
  }

  private throwIfOperationFailed(): void {
    if (this.operationError) {
      throw this.operationError;
    }
  }

  private createRuntime(
    cols: number,
    rows: number,
    scrollback: number
  ): {
    terminal: HeadlessTerminal;
    serializeAddon: SerializeAddon;
  } {
    const terminal = new HeadlessTerminal({
      allowProposedApi: true,
      cols,
      rows,
      scrollback
    });
    const serializeAddon = new SerializeAddon();
    terminal.loadAddon(serializeAddon as never);
    return {
      terminal,
      serializeAddon
    };
  }

  private disposeRuntime(): void {
    this.terminal.dispose();
    this.serializeAddon.dispose();
  }

  private serializeState(): SerializedTerminalState {
    return {
      format: SERIALIZED_TERMINAL_STATE_FORMAT,
      data: this.serializeAddon.serialize({
        scrollback: this.scrollback,
        excludeAltBuffer: false,
        excludeModes: false
      }),
      viewportY: this.terminal.buffer.active.viewportY >= 0 ? this.terminal.buffer.active.viewportY : undefined,
      outputSequence: this.outputSequence
    };
  }

  private async validateCheckpoint(): Promise<SerializedTerminalCheckpointValidationResult> {
    if (!this.colorStateSubscription) {
      return rejectCheckpoint('unsupported-xterm-internals');
    }
    if (this.colorStateTouched) {
      return rejectCheckpoint('color-state');
    }
    const sourceRuntime = readXtermRuntime(this.terminal);
    if (!sourceRuntime) {
      return rejectCheckpoint('unsupported-xterm-internals');
    }
    const sourceRejection = inspectCheckpointBoundary(sourceRuntime);
    if (sourceRejection) {
      return rejectCheckpoint(sourceRejection);
    }

    const state = this.getSerializedState();
    if (state.data.length > MAX_VALIDATED_TERMINAL_CHECKPOINT_DATA_LENGTH) {
      return rejectCheckpoint('serialized-state-too-large');
    }
    const sourceFingerprint = fingerprintTerminal(this.terminal, sourceRuntime);
    if (!sourceFingerprint) {
      return rejectCheckpoint('unsupported-xterm-internals');
    }

    const target = this.createRuntime(this.terminal.cols, this.terminal.rows, this.scrollback);
    try {
      try {
        await writeTerminalData(target.terminal, state.data);
        if (state.viewportY !== undefined) {
          target.terminal.scrollToLine(state.viewportY);
        }
      } catch {
        return rejectCheckpoint('hydrate-failed');
      }
      const targetRuntime = readXtermRuntime(target.terminal);
      if (!targetRuntime) {
        return rejectCheckpoint('unsupported-xterm-internals');
      }
      const targetRejection = inspectCheckpointBoundary(targetRuntime);
      if (targetRejection) {
        return rejectCheckpoint(targetRejection);
      }
      const targetFingerprint = fingerprintTerminal(target.terminal, targetRuntime);
      if (!targetFingerprint) {
        return rejectCheckpoint('unsupported-xterm-internals');
      }
      return semanticFingerprintsEqual(sourceFingerprint, targetFingerprint)
        ? { eligible: true, state: cloneSerializedTerminalState(state) ?? state }
        : rejectCheckpoint('state-mismatch');
    } finally {
      target.serializeAddon.dispose();
      target.terminal.dispose();
    }
  }
}

type XtermRecord = Record<string, unknown>;

interface XtermRuntime {
  input: XtermRecord;
  parser: XtermRecord;
  writes: XtermRecord;
  bufferService: XtermRecord;
  buffers: XtermRecord;
  normal: XtermRecord;
  alternate: XtermRecord;
  charset: XtermRecord;
  coreService: XtermRecord;
  mouse: XtermRecord;
  oscLinks: XtermRecord;
  unicode: XtermRecord;
  options: XtermRecord;
}

const INVALID_FINGERPRINT = Symbol('invalid-terminal-fingerprint');

function rejectCheckpoint(
  reason: SerializedTerminalCheckpointRejectionReason
): SerializedTerminalCheckpointValidationResult {
  return { eligible: false, reason };
}

function cloneCheckpointValidationResult(
  result: SerializedTerminalCheckpointValidationResult
): SerializedTerminalCheckpointValidationResult {
  return result.eligible
    ? { eligible: true, state: cloneSerializedTerminalState(result.state) ?? result.state }
    : { eligible: false, reason: result.reason };
}

function readXtermRuntime(terminal: HeadlessTerminal): XtermRuntime | undefined {
  const core = asRecord(asRecord(terminal)?._core);
  const input = asRecord(core?._inputHandler);
  const parser = asRecord(input?._parser);
  const writes = asRecord(core?._writeBuffer);
  const bufferService = asRecord(core?._bufferService);
  const buffers = asRecord(bufferService?.buffers);
  const normal = asRecord(buffers?._normal);
  const alternate = asRecord(buffers?._alt);
  const charset = asRecord(core?._charsetService);
  const coreService = asRecord(core?.coreService);
  const mouse = asRecord(core?.coreMouseService);
  const oscLinks = asRecord(core?._oscLinkService);
  const unicode = asRecord(core?.unicodeService);
  const options = asRecord(asRecord(core?.optionsService)?.rawOptions);
  return core && input && parser && writes && bufferService && buffers && normal && alternate && charset &&
    coreService && mouse && oscLinks && unicode && options
    ? { input, parser, writes, bufferService, buffers, normal, alternate, charset, coreService, mouse, oscLinks, unicode, options }
    : undefined;
}

function subscribeToTerminalColorRequests(
  terminal: HeadlessTerminal,
  listener: (event: unknown) => void
): { dispose(): void } | undefined {
  const core = asRecord(asRecord(terminal)?._core);
  const input = asRecord(core?._inputHandler);
  if (typeof input?.onColor !== 'function') {
    return undefined;
  }
  const subscription = input.onColor.call(input, listener);
  return subscription && typeof subscription.dispose === 'function'
    ? subscription as { dispose(): void }
    : undefined;
}

function terminalColorEventMayChangeRendererState(value: unknown): boolean {
  if (!Array.isArray(value) || value.length === 0) {
    return true;
  }

  // @xterm/xterm 6 emits ColorRequestType.REPORT as numeric value 0. Do not
  // trust an unrecognised private event shape to be a harmless query.
  return value.some((request) => asRecord(request)?.type !== 0);
}

function inspectCheckpointBoundary(
  runtime: XtermRuntime
): SerializedTerminalCheckpointRejectionReason | undefined {
  const writeQueue = runtime.writes._writeBuffer;
  const callbacks = runtime.writes._callbacks;
  if (
    !Array.isArray(writeQueue) ||
    !Array.isArray(callbacks) ||
    typeof runtime.writes._pendingData !== 'number' ||
    typeof runtime.writes._bufferOffset !== 'number' ||
    typeof runtime.writes._isSyncWriting !== 'boolean' ||
    typeof runtime.writes._syncCalls !== 'number' ||
    typeof runtime.writes._didUserInput !== 'boolean'
  ) {
    return 'unsupported-xterm-internals';
  }
  if (
    writeQueue.length ||
    callbacks.length ||
    runtime.writes._pendingData !== 0 ||
    runtime.writes._bufferOffset !== 0 ||
    runtime.writes._isSyncWriting ||
    runtime.writes._syncCalls !== 0 ||
    runtime.writes._didUserInput
  ) {
    return 'pending-write';
  }

  const inputStack = asRecord(runtime.input._parseStack);
  const parserStack = asRecord(runtime.parser._parseStack);
  const oscParser = asRecord(runtime.parser._oscParser);
  const dcsParser = asRecord(runtime.parser._dcsParser);
  const oscStack = asRecord(oscParser?._stack);
  const dcsStack = asRecord(dcsParser?._stack);
  if (!inputStack || !parserStack || !oscParser || !dcsParser || !oscStack || !dcsStack) {
    return 'unsupported-xterm-internals';
  }
  if (inputStack.paused !== false || parserStack.state !== 0 || oscStack.paused !== false || dcsStack.paused !== false) {
    return 'parser-paused';
  }
  if (
    runtime.parser.initialState !== 0 ||
    runtime.parser.currentState !== 0 ||
    runtime.parser._collect !== 0 ||
    oscParser._state !== 0 ||
    oscParser._id !== -1 ||
    !Array.isArray(oscParser._active) ||
    oscParser._active.length ||
    dcsParser._ident !== 0 ||
    !Array.isArray(dcsParser._active) ||
    dcsParser._active.length
  ) {
    return 'parser-not-ground';
  }

  const specialColors = runtime.input._specialColors;
  if (
    runtime.input._activeBuffer !== runtime.buffers._activeBuffer ||
    !Array.isArray(specialColors) ||
    specialColors.length !== 3 ||
    specialColors[0] !== 256 ||
    specialColors[1] !== 257 ||
    specialColors[2] !== 258
  ) {
    return 'unsupported-xterm-internals';
  }

  const stringDecoder = asRecord(runtime.input._stringDecoder);
  const utf8Decoder = asRecord(runtime.input._utf8Decoder);
  if (!stringDecoder || !utf8Decoder || !(utf8Decoder.interim instanceof Uint8Array)) {
    return 'unsupported-xterm-internals';
  }
  if (stringDecoder._interim !== 0) {
    return 'utf16-decoder-carry';
  }
  if (utf8Decoder.interim.some((value) => value !== 0)) {
    return 'utf8-decoder-carry';
  }

  const linkEntries = runtime.oscLinks._entriesWithId;
  const linksById = runtime.oscLinks._dataByLinkId;
  const attributes = [
    runtime.input._curAttrData,
    runtime.input._eraseAttrDataInternal,
    runtime.normal.savedCurAttrData,
    runtime.alternate.savedCurAttrData
  ].map(fingerprintAttributes);
  if (
    !(linkEntries instanceof Map) ||
    !(linksById instanceof Map) ||
    attributes.some((value) => value === undefined)
  ) {
    return 'unsupported-xterm-internals';
  }
  if (
    linkEntries.size ||
    linksById.size ||
    attributes.some((value) => value?.urlId !== 0)
  ) {
    return 'osc8-state';
  }
  const iconStack = runtime.input._iconNameStack;
  const titleStack = runtime.input._windowTitleStack;
  if (
    runtime.input._iconName !== '' ||
    runtime.input._windowTitle !== '' ||
    !Array.isArray(iconStack) ||
    !Array.isArray(titleStack) ||
    iconStack.length ||
    titleStack.length
  ) {
    return 'unsupported-xterm-internals';
  }
  return undefined;
}

function fingerprintTerminal(terminal: HeadlessTerminal, runtime: XtermRuntime): unknown | undefined {
  const normal = fingerprintBuffer(runtime.normal);
  const alternate = fingerprintBuffer(runtime.alternate);
  const currentAttributes = fingerprintAttributes(runtime.input._curAttrData);
  const eraseAttributes = fingerprintAttributes(runtime.input._eraseAttrDataInternal);
  const charset = fingerprintCharsetService(runtime.charset);
  const unicode = fingerprintUnicodeService(runtime.unicode);
  const options = fingerprintTerminalOptions(runtime.options);
  const coreModes = asRecord(runtime.coreService.modes);
  const privateModes = asRecord(runtime.coreService.decPrivateModes);
  const activeBuffer = runtime.buffers._activeBuffer === runtime.normal
    ? 'normal'
    : runtime.buffers._activeBuffer === runtime.alternate
      ? 'alternate'
      : undefined;
  if (
    normal === undefined ||
    alternate === undefined ||
    !currentAttributes ||
    !eraseAttributes ||
    charset === INVALID_FINGERPRINT ||
    unicode === INVALID_FINGERPRINT ||
    options === INVALID_FINGERPRINT ||
    !coreModes ||
    !privateModes ||
    !activeBuffer ||
    typeof runtime.parser.precedingJoinState !== 'number' ||
    typeof runtime.coreService.isCursorHidden !== 'boolean' ||
    typeof runtime.coreService.isCursorInitialized !== 'boolean' ||
    typeof runtime.mouse._activeProtocol !== 'string' ||
    typeof runtime.mouse._activeEncoding !== 'string' ||
    typeof runtime.mouse._wheelPartialScroll !== 'number' ||
    runtime.mouse._lastEvent !== null ||
    typeof runtime.bufferService.isUserScrolling !== 'boolean' ||
    nonNegativeInteger(runtime.bufferService.cols) === undefined ||
    nonNegativeInteger(runtime.bufferService.rows) === undefined ||
    nonNegativeInteger(runtime.oscLinks._nextId) === undefined
  ) {
    return undefined;
  }

  return {
    buffers: { active: activeBuffer, alternate, normal },
    bufferService: [runtime.bufferService.cols, runtime.bufferService.rows, runtime.bufferService.isUserScrolling],
    charset,
    dimensions: [terminal.cols, terminal.rows],
    currentAttributes,
    cursor: [runtime.coreService.isCursorHidden, runtime.coreService.isCursorInitialized],
    eraseAttributes,
    modes: { core: coreModes, private: privateModes, public: terminal.modes },
    mouse: [runtime.mouse._activeEncoding, runtime.mouse._activeProtocol, runtime.mouse._wheelPartialScroll],
    options,
    oscLinkNextId: runtime.oscLinks._nextId,
    parserJoinState: runtime.parser.precedingJoinState,
    unicode
  };
}

function fingerprintBuffer(buffer: XtermRecord): unknown | undefined {
  const lines = asRecord(buffer.lines);
  const lineCount = nonNegativeInteger(lines?.length);
  const maxLength = nonNegativeInteger(lines?.maxLength);
  const getLine = lines?.get;
  const markers = buffer.markers;
  const tabs = fingerprintTabs(buffer.tabs);
  const savedAttributes = fingerprintAttributes(buffer.savedCurAttrData);
  const savedCharset = fingerprintCharset(buffer.savedCharset);
  const cleanupQueue = asRecord(buffer._memoryCleanupQueue);
  const cleanupTasks = cleanupQueue?._tasks;
  const cleanupPosition = nonNegativeInteger(buffer._memoryCleanupPosition);
  const nullCell = fingerprintCellTemplate(buffer._nullCell);
  const whitespaceCell = fingerprintCellTemplate(buffer._whitespaceCell);
  const numericFields = [
    buffer._cols,
    buffer._rows,
    buffer.x,
    buffer.y,
    buffer.ybase,
    buffer.ydisp,
    buffer.scrollTop,
    buffer.scrollBottom,
    buffer.savedX,
    buffer.savedY
  ];
  if (
    !lines ||
    lineCount === undefined ||
    maxLength === undefined ||
    typeof getLine !== 'function' ||
    !Array.isArray(markers) ||
    markers.length !== 0 ||
    tabs === INVALID_FINGERPRINT ||
    !savedAttributes ||
    savedCharset === INVALID_FINGERPRINT ||
    !cleanupQueue ||
    !Array.isArray(cleanupTasks) ||
    cleanupTasks.length ||
    cleanupQueue._i !== 0 ||
    cleanupPosition === undefined ||
    !nullCell ||
    !whitespaceCell ||
    buffer._isClearing !== false ||
    typeof buffer._hasScrollback !== 'boolean' ||
    numericFields.some((value) => nonNegativeInteger(value) === undefined)
  ) {
    return undefined;
  }

  const lineFingerprints: unknown[] = [];
  for (let index = 0; index < lineCount; index += 1) {
    const line = fingerprintBufferLine(getLine.call(lines, index));
    if (!line) {
      return undefined;
    }
    lineFingerprints.push(line);
  }
  return {
    cursor: [buffer.x, buffer.y, buffer.savedX, buffer.savedY],
    dimensions: [buffer._cols, buffer._rows],
    hasScrollback: buffer._hasScrollback,
    lines: lineFingerprints,
    memoryCleanupPosition: cleanupPosition,
    nullCell,
    savedAttributes,
    savedCharset,
    scroll: [buffer.ybase, buffer.ydisp, buffer.scrollTop, buffer.scrollBottom, maxLength],
    tabs,
    whitespaceCell
  };
}

function fingerprintBufferLine(value: unknown): unknown | undefined {
  const line = asRecord(value);
  const length = nonNegativeInteger(line?.length);
  const data = line?._data;
  const combined = asRecord(line?._combined);
  const extended = asRecord(line?._extendedAttrs);
  if (
    !line ||
    length === undefined ||
    typeof line.isWrapped !== 'boolean' ||
    !(data instanceof Uint32Array) ||
    data.length !== length * 3 ||
    !combined ||
    !extended
  ) {
    return undefined;
  }
  const validIndex = (key: string): boolean => {
    const index = nonNegativeInteger(Number(key));
    return index !== undefined && index < length && String(index) === key;
  };
  if (
    Object.entries(combined).some(([key, entry]) => !validIndex(key) || typeof entry !== 'string') ||
    Object.entries(extended).some(([key, entry]) =>
      !validIndex(key) || (entry !== undefined && !fingerprintExtendedAttributes(entry)))
  ) {
    return undefined;
  }
  return [line.isWrapped, length, data, combined, extended];
}

function fingerprintAttributes(value: unknown): { fg: number; bg: number; ext: number; urlId: number } | undefined {
  const attributes = asRecord(value);
  const extended = fingerprintExtendedAttributes(attributes?.extended);
  return attributes && typeof attributes.fg === 'number' && typeof attributes.bg === 'number' && extended
    ? { fg: attributes.fg, bg: attributes.bg, ...extended }
    : undefined;
}

function fingerprintCellTemplate(
  value: unknown
): { content: number; combinedData: string; fg: number; bg: number; ext: number; urlId: number } | undefined {
  const cell = asRecord(value);
  const attributes = fingerprintAttributes(cell);
  return cell && attributes && typeof cell.content === 'number' && typeof cell.combinedData === 'string'
    ? { content: cell.content, combinedData: cell.combinedData, ...attributes }
    : undefined;
}

function fingerprintExtendedAttributes(value: unknown): { ext: number; urlId: number } | undefined {
  const extended = asRecord(value);
  return extended && typeof extended._ext === 'number' && typeof extended._urlId === 'number'
    ? { ext: extended._ext, urlId: extended._urlId }
    : undefined;
}

function fingerprintCharsetService(value: XtermRecord): unknown | typeof INVALID_FINGERPRINT {
  const charsets = value._charsets;
  const current = fingerprintCharset(value.charset);
  if (!Array.isArray(charsets) || nonNegativeInteger(value.glevel) === undefined || current === INVALID_FINGERPRINT) {
    return INVALID_FINGERPRINT;
  }
  const entries = charsets.map(fingerprintCharset);
  return entries.some((entry) => entry === INVALID_FINGERPRINT)
    ? INVALID_FINGERPRINT
    : { current, entries, glevel: value.glevel };
}

function fingerprintCharset(value: unknown): null | Array<[string, string]> | typeof INVALID_FINGERPRINT {
  if (value === undefined) {
    return null;
  }
  const charset = asRecord(value);
  const entries = charset && Object.entries(charset).sort(([left], [right]) => left.localeCompare(right));
  return entries?.every((entry): entry is [string, string] => typeof entry[1] === 'string')
    ? entries
    : INVALID_FINGERPRINT;
}

function fingerprintUnicodeService(value: XtermRecord): unknown | typeof INVALID_FINGERPRINT {
  const providers = asRecord(value._providers);
  const activeProvider = asRecord(value._activeProvider);
  if (!providers || typeof value._active !== 'string' || typeof activeProvider?.version !== 'string') {
    return INVALID_FINGERPRINT;
  }
  const available = Object.entries(providers)
    .map(([key, provider]) => [key, asRecord(provider)?.version] as const)
    .sort(([left], [right]) => left.localeCompare(right));
  return available.every((entry): entry is readonly [string, string] => typeof entry[1] === 'string')
    ? { active: value._active, activeVersion: activeProvider.version, available }
    : INVALID_FINGERPRINT;
}

function fingerprintTerminalOptions(value: XtermRecord): unknown | typeof INVALID_FINGERPRINT {
  const options = {
    allowProposedApi: value.allowProposedApi,
    convertEol: value.convertEol,
    cursorBlink: value.cursorBlink,
    reflowCursorLine: value.reflowCursorLine,
    scrollOnEraseInDisplay: value.scrollOnEraseInDisplay,
    scrollOnUserInput: value.scrollOnUserInput,
    scrollback: value.scrollback,
    tabStopWidth: value.tabStopWidth,
    windowsMode: value.windowsMode
  };
  return (
    typeof options.allowProposedApi === 'boolean' &&
    typeof options.convertEol === 'boolean' &&
    typeof options.cursorBlink === 'boolean' &&
    typeof options.reflowCursorLine === 'boolean' &&
    typeof options.scrollOnEraseInDisplay === 'boolean' &&
    typeof options.scrollOnUserInput === 'boolean' &&
    nonNegativeInteger(options.scrollback) !== undefined &&
    nonNegativeInteger(options.tabStopWidth) !== undefined &&
    typeof options.windowsMode === 'boolean'
  )
    ? options
    : INVALID_FINGERPRINT;
}

function fingerprintTabs(value: unknown): XtermRecord | typeof INVALID_FINGERPRINT {
  const tabs = asRecord(value);
  if (!tabs) {
    return INVALID_FINGERPRINT;
  }
  return Object.entries(tabs).every(([key, entry]) =>
    nonNegativeInteger(Number(key)) !== undefined && String(Number(key)) === key && (entry === true || entry === undefined))
    ? tabs
    : INVALID_FINGERPRINT;
}

function semanticFingerprintsEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (left instanceof Uint32Array || right instanceof Uint32Array) {
    if (!(left instanceof Uint32Array) || !(right instanceof Uint32Array) || left.length !== right.length) {
      return false;
    }
    for (let index = 0; index < left.length; index += 1) {
      if (left[index] !== right[index]) {
        return false;
      }
    }
    return true;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length &&
      left.every((entry, index) => semanticFingerprintsEqual(entry, right[index]));
  }
  const leftRecord = asRecord(left);
  const rightRecord = asRecord(right);
  if (!leftRecord || !rightRecord) {
    return false;
  }
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  return leftKeys.length === rightKeys.length && leftKeys.every((key, index) =>
    key === rightKeys[index] && semanticFingerprintsEqual(leftRecord[key], rightRecord[key]));
}

function asRecord(value: unknown): XtermRecord | undefined {
  return value !== null && typeof value === 'object' ? value as XtermRecord : undefined;
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function writeTerminalData(terminal: HeadlessTerminal, data: string): Promise<void> {
  return data
    ? new Promise((resolve) => terminal.write(data, () => resolve()))
    : Promise.resolve();
}

function normalizeSerializedTerminalOutputSequence(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function maxSerializedTerminalOutputSequence(...values: unknown[]): number | undefined {
  return values.reduce<number | undefined>((currentMax, value) => {
    const normalized = normalizeSerializedTerminalOutputSequence(value);
    if (normalized === undefined) {
      return currentMax;
    }
    return currentMax === undefined ? normalized : Math.max(currentMax, normalized);
  }, undefined);
}

function readPackageVersion(value: unknown, packageName: string): string {
  if (typeof value !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(value)) {
    throw new Error(`Could not determine ${packageName} version for terminal checkpoint compatibility.`);
  }
  return value;
}

function delay(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, timeoutMs);
  });
}
