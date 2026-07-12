export interface TerminalProjectionRefreshSchedulerOptions {
  intervalMs: number;
  spreadMs: number;
  scheduleTimeout?: (callback: () => void, delayMs: number) => unknown;
  cancelTimeout?: (handle: unknown) => void;
}

export function resolveTerminalProjectionRefreshDelayMs(
  key: string,
  intervalMs: number,
  spreadMs: number
): number {
  let keyHash = 0;
  for (let index = 0; index < key.length; index += 1) {
    keyHash = ((keyHash * 31) + key.charCodeAt(index)) >>> 0;
  }

  const normalizedIntervalMs = Number.isFinite(intervalMs) ? Math.max(0, Math.floor(intervalMs)) : 0;
  const normalizedSpreadMs = Number.isFinite(spreadMs) ? Math.max(0, Math.floor(spreadMs)) : 0;
  return normalizedIntervalMs + (normalizedSpreadMs > 0 ? keyHash % normalizedSpreadMs : 0);
}

export class TerminalProjectionRefreshScheduler {
  private readonly timers = new Map<string, unknown>();
  private readonly scheduleTimeout: (callback: () => void, delayMs: number) => unknown;
  private readonly cancelTimeout: (handle: unknown) => void;
  private disposed = false;

  public constructor(private readonly options: TerminalProjectionRefreshSchedulerOptions) {
    this.scheduleTimeout = options.scheduleTimeout ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.cancelTimeout = options.cancelTimeout ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  }

  public has(key: string): boolean {
    return this.timers.has(key);
  }

  public schedule(key: string, callback: () => void): boolean {
    if (this.disposed || this.timers.has(key)) {
      return false;
    }

    const delayMs = resolveTerminalProjectionRefreshDelayMs(
      key,
      this.options.intervalMs,
      this.options.spreadMs
    );
    const timer = this.scheduleTimeout(() => {
      if (this.disposed || this.timers.get(key) !== timer) {
        return;
      }
      this.timers.delete(key);
      callback();
    }, delayMs);
    this.timers.set(key, timer);
    return true;
  }

  public clearMatching(predicate: (key: string) => boolean): void {
    for (const [key, timer] of this.timers) {
      if (!predicate(key)) {
        continue;
      }
      this.cancelTimeout(timer);
      this.timers.delete(key);
    }
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const timer of this.timers.values()) {
      this.cancelTimeout(timer);
    }
    this.timers.clear();
  }
}
