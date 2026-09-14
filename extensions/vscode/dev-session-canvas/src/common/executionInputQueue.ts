export interface ExecutionInputQueueState {
  pendingCount: number;
  inFlightCount: number;
}

export type ReleaseExecutionInput = () => void;

/** Preserves terminal control-byte dispatch order without response-gating later input. */
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

  public enqueue<T>(
    operation: (
      state: ExecutionInputQueueState,
      release: ReleaseExecutionInput
    ) => Promise<T> | T
  ): Promise<T> {
    this.pendingCount += 1;
    const previous = this.chain;
    let releaseAdmission!: () => void;
    const admission = new Promise<void>((resolve) => {
      releaseAdmission = resolve;
    });
    let released = false;
    const release = (): void => {
      if (released) {
        return;
      }
      released = true;
      this.inFlightCount = Math.max(0, this.inFlightCount - 1);
      releaseAdmission();
    };
    const result = previous.then(async () => {
      this.pendingCount = Math.max(0, this.pendingCount - 1);
      this.inFlightCount += 1;
      try {
        return await operation({
          pendingCount: this.pendingCount,
          inFlightCount: this.inFlightCount
        }, release);
      } finally {
        release();
      }
    });
    this.chain = previous.then(
      () => admission,
      () => admission
    );
    return result;
  }
}
