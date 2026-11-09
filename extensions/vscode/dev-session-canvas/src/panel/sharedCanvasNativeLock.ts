export interface SharedCanvasNativeLockHandle {
  readonly opaque: unique symbol;
}

export interface SharedCanvasNativeLock {
  open(filename: string): Promise<SharedCanvasNativeLockHandle>;
  tryAcquire(handle: SharedCanvasNativeLockHandle): Promise<'acquired' | 'busy'>;
  close(handle: SharedCanvasNativeLockHandle): Promise<void>;
}
