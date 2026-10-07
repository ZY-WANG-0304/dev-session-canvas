import { openSync, closeSync } from 'node:fs';
import { Socket } from 'node:net';
import { isAbsolute } from 'node:path';
import { Worker } from 'node:worker_threads';
import type { SourceDisposition } from '../common/executionLifecycle';
import { WINDOWS_OUTPUT_READ_BYTES, type WindowsOutputMessage } from './windowsExecutionOutput';

export interface WindowsExecutionPipes {
  readonly acquired: { input: boolean; source: boolean };
  readonly ready: Promise<void>;
  readonly closed: Promise<{ input: boolean; source: boolean }>;
  output(consume: (bytes: Buffer) => Promise<void>): Promise<SourceDisposition>;
  write(bytes: Buffer): Promise<void>;
  closeInput(): void;
  cancel(reason: string): void;
}

export function createWindowsExecutionPipes(options: {
  conin: string; conout: string; workerPath: string;
}): WindowsExecutionPipes {
  if (process.platform !== 'win32' || !isAbsolute(options.workerPath)
    || !options.conin.startsWith('\\\\.\\pipe\\dsc-execution-')
    || !options.conout.startsWith('\\\\.\\pipe\\dsc-execution-')) {
    throw new Error('Explicit Windows execution pipe assets are required.');
  }
  let input: Socket | undefined;
  let worker: Worker | undefined;
  let descriptor: number | undefined;
  let inputClosed = false;
  let workerClosed = false;
  let workerCode: number | undefined;
  let consumed = 0;
  let ready = false;
  let startedOutput = false;
  let source: SourceDisposition | undefined;
  let firstFailure: Error | undefined;
  let inputFailure: Error | undefined;
  let outputTask: Promise<void> | undefined;
  let pending: Extract<WindowsOutputMessage, { type: 'data' }> | undefined;
  let consume: ((bytes: Buffer) => Promise<void>) | undefined;
  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  let resolveOutput!: (source: SourceDisposition) => void;
  let rejectOutput!: (error: Error) => void;
  let resolveClosed!: (result: { input: boolean; source: boolean }) => void;
  const readyTask = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const output = new Promise<SourceDisposition>((resolve, reject) => { resolveOutput = resolve; rejectOutput = reject; });
  const closed = new Promise<{ input: boolean; source: boolean }>(resolve => { resolveClosed = resolve; });
  // Failures may happen before the provider reaches the corresponding await.
  void readyTask.catch(() => {});
  void output.catch(() => {});

  function finish(): void {
    if (workerClosed && !outputTask && !pending) {
      if (firstFailure) rejectOutput(firstFailure);
      else if (source && workerCode === 0) resolveOutput(source);
      else rejectOutput(new Error('ConPTY reader exited without a settled source.'));
    }
    if (inputClosed && workerClosed) resolveClosed({ input: true, source: true });
  }
  function fail(error: unknown): void {
    firstFailure ??= error instanceof Error ? error : new Error(String(error));
    if (!ready) rejectReady(firstFailure);
    // A failed consumer cannot ACK the retained chunk. Abort only this owned worker,
    // preserving the transfer failure rather than deadlocking its cancellation drain.
    if (worker && !workerClosed) void worker.terminate();
    pending = undefined;
    input?.destroy();
    finish();
  }
  function pump(): void {
    if (!consume || !pending || outputTask) return;
    const item = pending;
    pending = undefined;
    outputTask = consume(Buffer.from(item.bytes));
    void outputTask.then(() => {
      consumed = item.id;
      outputTask = undefined;
      worker?.postMessage({ type: 'ack', id: item.id });
      finish();
    }, error => { outputTask = undefined; fail(error); });
  }
  try {
    descriptor = openSync(options.conin, 'w');
    input = new Socket({ fd: descriptor, readable: false, writable: true });
    descriptor = undefined;
    input.on('error', error => {
      inputFailure ??= error;
      if (!ready) rejectReady(inputFailure);
      // A closed stdin does not revoke ownership of output still waiting for ACK.
      input!.destroy();
    });
    input.on('close', () => { inputClosed = true; finish(); });
    worker = new Worker(options.workerPath, { workerData: { pipe: options.conout } });
    worker.on('error', fail);
    worker.on('exit', code => {
      workerClosed = true;
      workerCode = code;
      if (!ready) rejectReady(new Error('ConPTY reader exited before readiness.'));
      finish();
    });
    worker.on('message', (message: WindowsOutputMessage) => {
      try {
        if (message?.type === 'ready') {
          if (ready) throw new Error('Duplicate ConPTY reader readiness.');
          ready = true;
          resolveReady();
        } else if (message?.type === 'data') {
          if (!ready || source || pending || outputTask || message.id !== consumed + 1
            || !(message.bytes instanceof Uint8Array) || message.bytes.byteLength < 1
            || message.bytes.byteLength > WINDOWS_OUTPUT_READ_BYTES) throw new Error('Invalid ConPTY output delivery.');
          pending = message;
          pump();
        } else if (message?.type === 'source') {
          if (source || pending || outputTask || !['eof', 'interrupted', 'error', 'unknown'].includes(message.disposition?.kind)) {
            throw new Error('Invalid ConPTY source settlement.');
          }
          source = message.disposition;
          finish();
        } else throw new Error('Invalid ConPTY reader message.');
      } catch (error) { fail(error); }
    });
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    if (!input) inputClosed = true;
    if (!worker) workerClosed = true;
    fail(error);
  }
  return {
    acquired: { input: Boolean(input), source: Boolean(worker) }, ready: readyTask, closed,
    output(callback) {
      if (startedOutput) throw new Error('ConPTY output already has a consumer.');
      startedOutput = true;
      consume = callback;
      pump();
      return output;
    },
    write(bytes) {
      if (!input || input.destroyed || firstFailure || inputFailure) {
        return Promise.reject(inputFailure ?? firstFailure ?? new Error('ConPTY input is closed.'));
      }
      return new Promise<void>((resolve, reject) => input!.write(bytes, error => error ? reject(error) : resolve()));
    },
    closeInput() { input?.destroy(); },
    cancel(reason) { worker?.postMessage({ type: 'cancel', reason }); }
  };
}
