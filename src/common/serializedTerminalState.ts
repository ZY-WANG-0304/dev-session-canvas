import { SerializeAddon } from '@xterm/addon-serialize';
import { Terminal as HeadlessTerminal } from '@xterm/headless';

export const SERIALIZED_TERMINAL_STATE_FORMAT = 'xterm-serialize-v1';
const SERIALIZED_TERMINAL_STATE_SCROLLBACK = 80;
const MAX_SERIALIZED_TERMINAL_STATE_DATA_LENGTH = 200_000;

export interface SerializedTerminalState {
  format: typeof SERIALIZED_TERMINAL_STATE_FORMAT;
  data: string;
  viewportY?: number;
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
  if (!format || data === undefined || data.length > MAX_SERIALIZED_TERMINAL_STATE_DATA_LENGTH) {
    return undefined;
  }

  return {
    format,
    data,
    viewportY
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
    viewportY: value.viewportY
  };
}

export class SerializedTerminalStateTracker {
  private readonly terminal: HeadlessTerminal;
  private readonly serializeAddon = new SerializeAddon();
  private operationChain: Promise<void> = Promise.resolve();
  private cachedState: SerializedTerminalState = {
    format: SERIALIZED_TERMINAL_STATE_FORMAT,
    data: ''
  };

  public constructor(
    cols: number,
    rows: number,
    initialState?: SerializedTerminalState,
    initialOutput?: string
  ) {
    this.terminal = new HeadlessTerminal({
      allowProposedApi: true,
      cols,
      rows,
      scrollback: SERIALIZED_TERMINAL_STATE_SCROLLBACK
    });
    this.terminal.loadAddon(this.serializeAddon as never);
    this.refreshCachedState();

    const normalizedInitialState = normalizeSerializedTerminalState(initialState);
    if (normalizedInitialState) {
      this.cachedState = cloneSerializedTerminalState(normalizedInitialState) ?? this.cachedState;
      if (normalizedInitialState.data) {
        this.enqueueOperation(() => this.writeInternal(normalizedInitialState.data));
      }
      return;
    }

    if (initialOutput) {
      this.enqueueOperation(() => this.writeInternal(initialOutput));
    }
  }

  public write(chunk: string): void {
    if (!chunk) {
      return;
    }

    this.enqueueOperation(() => this.writeInternal(chunk));
  }

  public resize(cols: number, rows: number): void {
    this.enqueueOperation(() => {
      this.terminal.resize(cols, rows);
      this.refreshCachedState();
    });
  }

  public getSerializedState(): SerializedTerminalState {
    return cloneSerializedTerminalState(this.cachedState) ?? {
      format: SERIALIZED_TERMINAL_STATE_FORMAT,
      data: ''
    };
  }

  public async flush(): Promise<SerializedTerminalState> {
    await this.operationChain;
    return this.getSerializedState();
  }

  public dispose(): void {
    this.terminal.dispose();
    this.serializeAddon.dispose();
  }

  private enqueueOperation(operation: () => Promise<void> | void): void {
    this.operationChain = this.operationChain
      .then(() => operation())
      .catch(() => {
        this.refreshCachedState();
      });
  }

  private async writeInternal(data: string): Promise<void> {
    await new Promise<void>((resolve) => {
      this.terminal.write(data, () => resolve());
    });
    this.refreshCachedState();
  }

  private refreshCachedState(): void {
    this.cachedState = {
      format: SERIALIZED_TERMINAL_STATE_FORMAT,
      data: this.serializeAddon.serialize({
        scrollback: SERIALIZED_TERMINAL_STATE_SCROLLBACK,
        excludeAltBuffer: false,
        excludeModes: false
      }),
      viewportY: this.terminal.buffer.active.viewportY >= 0 ? this.terminal.buffer.active.viewportY : undefined
    };
  }
}
