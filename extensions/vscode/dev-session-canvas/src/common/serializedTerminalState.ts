import { SerializeAddon } from '@xterm/addon-serialize';
import { Terminal as HeadlessTerminal } from '@xterm/headless';

import { DEFAULT_TERMINAL_SCROLLBACK, normalizeTerminalScrollback } from './terminalScrollback';

export const SERIALIZED_TERMINAL_STATE_FORMAT = 'xterm-serialize-v1';
const MAX_SERIALIZED_TERMINAL_STATE_DATA_LENGTH = 5 * 1024 * 1024;
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
  private disposed = false;
  private cachedState: SerializedTerminalState = {
    format: SERIALIZED_TERMINAL_STATE_FORMAT,
    data: ''
  };

  public constructor(cols: number, rows: number, options: SerializedTerminalStateTrackerOptions = {}) {
    this.scrollback = normalizeTerminalScrollback(options.scrollback, DEFAULT_TERMINAL_SCROLLBACK);
    const runtime = this.createRuntime(cols, rows, this.scrollback);
    this.terminal = runtime.terminal;
    this.serializeAddon = runtime.serializeAddon;
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
      const currentState = this.serializeState();
      const cols = this.terminal.cols;
      const rows = this.terminal.rows;
      this.replaceRuntime(cols, rows, normalizedScrollback);
      await this.hydrateSerializedState(currentState);
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

  public async flush(): Promise<SerializedTerminalState> {
    if (this.disposed) {
      await this.operationChain;
      return this.getSerializedState();
    }

    this.clearPendingWriteDrainTimer();
    const pendingWriteBatch = this.takePendingWriteBatch();
    this.enqueueOperation(() => this.drainWriteData(pendingWriteBatch.data, true, pendingWriteBatch.outputSequence));
    await this.operationChain;
    if (this.cachedStateDirty) {
      this.refreshCachedState();
    }
    return this.getSerializedState();
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.clearPendingWriteDrainTimer();
    this.pendingWriteData = '';
    this.pendingWriteOutputSequence = undefined;
    this.disposeRuntime();
  }

  private enqueueOperation(operation: () => Promise<void> | void): void {
    this.operationChain = this.operationChain
      .then(() => {
        if (this.disposed) {
          return;
        }

        return operation();
      })
      .catch(() => {
        if (!this.disposed) {
          this.refreshCachedState();
        }
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
    if (options.refreshCachedState !== false) {
      this.refreshCachedState();
    } else {
      this.cachedStateDirty = true;
    }
  }

  private async hydrateSerializedState(state: SerializedTerminalState): Promise<void> {
    if (!state.data) {
      this.refreshCachedState();
      return;
    }

    await this.writeInternal(state.data);
  }

  private refreshCachedState(): void {
    this.cachedState = this.serializeState();
    this.cachedStateDirty = false;
    this.lastCachedStateRefreshAtMs = Date.now();
  }

  private replaceRuntime(cols: number, rows: number, scrollback: number): void {
    this.disposeRuntime();
    const runtime = this.createRuntime(cols, rows, scrollback);
    this.terminal = runtime.terminal;
    this.serializeAddon = runtime.serializeAddon;
    this.scrollback = scrollback;
    this.refreshCachedState();
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

function delay(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, timeoutMs);
  });
}
