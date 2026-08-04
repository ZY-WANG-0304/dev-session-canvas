export interface ExecutionInputQueueState {
  pendingCount: number;
  inFlightCount: number;
}

/** Preserves terminal control-byte order while bounding a session to one RPC write. */
export class ExecutionInputQueue {
  private chain: Promise<void> = Promise.resolve();
  private pendingCount = 0;
  private inFlightCount = 0;

  public getPendingCount(): number {
    return this.pendingCount;
  }

  public getInFlightCount(): number {
    return this.inFlightCount;
  }

  public enqueue<T>(operation: (state: ExecutionInputQueueState) => Promise<T> | T): Promise<T> {
    this.pendingCount += 1;
    const result = this.chain.then(async () => {
      this.pendingCount = Math.max(0, this.pendingCount - 1);
      this.inFlightCount += 1;
      try {
        return await operation({
          pendingCount: this.pendingCount,
          inFlightCount: this.inFlightCount
        });
      } finally {
        this.inFlightCount = Math.max(0, this.inFlightCount - 1);
      }
    });
    this.chain = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }
}
