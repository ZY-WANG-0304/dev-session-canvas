import type { Socket } from 'node:net';
import type { SourceDisposition } from '../common/executionLifecycle';

export const WINDOWS_OUTPUT_READ_BYTES = 4096;
export const WINDOWS_OUTPUT_OWNED_LIMIT = 128 * 1024;

export type WindowsOutputMessage =
  | { type: 'ready' }
  | { type: 'data'; id: number; bytes: Uint8Array }
  | { type: 'source'; disposition: SourceDisposition };

export function attachWindowsOutputReader(
  socket: Socket,
  send: (message: WindowsOutputMessage) => void,
  close: () => void
): { acknowledge(id: number): void; cancel(reason: string): void } {
  let sequence = 0;
  let inFlight: number | undefined;
  let ended = false;
  let closed = false;
  let finished = false;
  let cancellation: string | undefined;
  let failure: string | undefined;
  let owned: Buffer | undefined;
  let ownedOffset = 0;

  function finish(): void {
    if (finished || !closed || inFlight !== undefined || (owned && ownedOffset < owned.length)
      || (!cancellation && socket.readableLength > 0)) return;
    finished = true;
    const disposition: SourceDisposition = failure ? { kind: 'error', reason: failure }
      : cancellation ? { kind: 'interrupted', reason: cancellation }
        : ended ? { kind: 'eof' } : { kind: 'interrupted', reason: 'ConPTY output closed without EOF.' };
    send({ type: 'source', disposition });
    close();
  }

  function pump(): void {
    if (finished || inFlight !== undefined) return;
    let bytes: Buffer | null = null;
    if (owned && ownedOffset < owned.length) {
      bytes = owned.subarray(ownedOffset, ownedOffset + WINDOWS_OUTPUT_READ_BYTES);
      ownedOffset += bytes.length;
    } else if (!cancellation) {
      bytes = socket.read(Math.min(WINDOWS_OUTPUT_READ_BYTES, socket.readableLength) || WINDOWS_OUTPUT_READ_BYTES) as Buffer | null;
    }
    if (bytes?.length) {
      inFlight = ++sequence;
      send({ type: 'data', id: sequence, bytes });
    } else finish();
  }

  function cancel(reason: string): void {
    if (finished || cancellation) return;
    cancellation = reason;
    socket.pause();
    const buffered = socket.readableLength;
    if (buffered > WINDOWS_OUTPUT_OWNED_LIMIT) {
      failure ??= 'ConPTY readable buffer exceeded the owned cancellation limit.';
    }
    // Capture only bytes already owned by this reader before destroying the pipe.
    if (buffered) {
      owned = socket.read(buffered) as Buffer | undefined;
      if (!owned || owned.length !== buffered) failure ??= 'ConPTY cancellation snapshot changed.';
    }
    socket.destroy();
    pump();
  }

  socket.on('connect', () => send({ type: 'ready' }));
  socket.on('readable', pump);
  socket.on('end', () => { ended = true; socket.destroy(); pump(); });
  socket.on('error', () => { failure ??= 'ConPTY output pipe failed.'; });
  socket.on('close', hadError => { closed = true; if (hadError) failure ??= 'ConPTY output pipe failed.'; pump(); });
  return {
    acknowledge(id) {
      if (!Number.isSafeInteger(id) || id !== inFlight) {
        failure ??= 'ConPTY output acknowledgement mismatch.';
        cancel(failure);
        return;
      }
      inFlight = undefined;
      pump();
    },
    cancel
  };
}
