import { constants } from 'node:os';
import { isAbsolute } from 'node:path';
import { StringDecoder } from 'node:string_decoder';

import {
  assertCandidateLaunchSpec, encodeOutputFrame, EXECUTION_INTERACTION_LIMITS, S1_LIMITS,
  type ExecutionIdentity, type ExecutionInteractionResult, type ExecutionStopStrategy,
  type ProcessResult, type ProviderMessage, type SourceDisposition
} from '../common/executionLifecycle';
import { createExecutionProviderChannel, type ExecutionProviderCommand } from './executionProviderChannel';

export interface LinuxExecutionWaitStatus {
  kind: 'not-started' | 'pending' | 'exited' | 'signaled' | 'unknown';
  exitCode: number | null;
  signalCode: number | null;
  rawStatus: number | null;
  errno: number | null;
}

export interface LinuxExecutionNativeSnapshot {
  token: string;
  configured: boolean;
  forkAttempted: boolean;
  pid: number | null;
  masterFd: number | null;
  forkErrno: number | null;
  childAcquired: boolean;
  masterAcquired: boolean;
  nonblockConfirmed: boolean;
  nonblockErrno: number | null;
  waitStatus: LinuxExecutionWaitStatus;
  closeAttempted: boolean;
  closeResult: number | null;
  closeErrno: number | null;
  readCalls: number;
  readBytes: number;
  lastReadKind: 'data' | 'retry' | 'eof' | 'error' | null;
  lastReadErrno: number | null;
  eofReason: 'zero' | 'eio' | null;
  pollCalls: number;
  termCalls: number;
  killCalls: number;
  creationResources?: readonly {
    resourceId: string;
    acquired: boolean;
    releaseAttempted: boolean;
    releaseResult: number | null;
    releaseErrno: number | null;
  }[];
}

export interface LinuxExecutionBinding {
  executionConfigure(token: string): void;
  fork(file: string, args: readonly string[], env: string[], cwd: string,
    cols: number, rows: number, uid: number, gid: number, utf8: boolean,
    helperPath: string, callback: () => void): { pid: number; fd: number };
  executionSnapshot(token: string): LinuxExecutionNativeSnapshot;
  executionRead(token: string, buffer: Buffer):
    | { kind: 'data'; bytes: number }
    | { kind: 'retry' }
    | { kind: 'eof'; reason: 'zero' | 'eio' }
    | { kind: 'error'; errno: number };
  executionPollWait(token: string): LinuxExecutionWaitStatus;
  executionSignal(token: string, signal: 'SIGHUP' | 'SIGTERM' | 'SIGKILL'):
    { kind: 'sent' | 'already-attempted' | 'not-running' | 'unknown' | 'error'; errno: number | null };
  executionClose(token: string):
    { kind: 'closed' | 'already-attempted' | 'not-acquired' | 'error'; errno: number | null };
}

type LinuxMutationFailure =
  | { kind: 'retry'; errno: number }
  | { kind: 'rejected' | 'error'; reason: string; errno: number | null };

export interface LinuxInteractiveExecutionBinding extends LinuxExecutionBinding {
  executionWrite(token: string, bytes: Buffer): { kind: 'written'; bytes: number } | LinuxMutationFailure;
  executionResize(token: string, cols: number, rows: number): { kind: 'resized' } | LinuxMutationFailure;
}

export interface LinuxExecutionProviderOptions {
  identity: ExecutionIdentity;
  binding: LinuxExecutionBinding;
  cols: number;
  rows: number;
  pollIntervalMs: number;
  interactionV1?: true;
  platform?: 'linux' | 'darwin';
  helperPath?: string;
}

export interface LinuxExecutionProviderResult {
  kind: 'closed' | 'failed';
  reason?: string;
  native?: LinuxExecutionNativeSnapshot;
  source?: SourceDisposition;
  sourceEndEvidence?: 'zero' | 'eio' | 'cancelled' | 'read-error' | 'not-established';
  resourcesSettled: boolean;
}

const READ_BYTES = 4096;
const MASTER = 'pty-master';
const CHILD = 'pty-child';
const SOURCE = 'pty-source';

export function validateLinuxExecutionReadBudget(identity: ExecutionIdentity): void {
  const envelope = encodeOutputFrame({ version: 1, identity, frameId: Number.MAX_SAFE_INTEGER, text: 'x' });
  if (envelope.byteLength - 5 + 6 * (READ_BYTES + 3) > S1_LIMITS.payloadBytes) {
    throw new Error('Execution identity leaves insufficient room for a bounded PTY read.');
  }
}

export function runLinuxExecutionProvider(options: LinuxExecutionProviderOptions): Promise<LinuxExecutionProviderResult> {
  return runUnixExecutionProvider({ ...options, platform: 'linux' });
}

export function runUnixExecutionProvider(options: LinuxExecutionProviderOptions): Promise<LinuxExecutionProviderResult> {
  const platform = options.platform ?? 'linux';
  if (!['linux', 'darwin'].includes(platform) || process.platform !== platform || options.pollIntervalMs !== 5
    || !Number.isInteger(options.cols) || options.cols < 1 || options.cols > 1000
    || !Number.isInteger(options.rows) || options.rows < 1 || options.rows > 1000) {
    throw new Error('Invalid Linux execution provider configuration.');
  }
  if (platform === 'darwin' && (!options.helperPath || !isAbsolute(options.helperPath))) {
    throw new Error('Darwin execution requires its verified absolute spawn helper path.');
  }
  validateLinuxExecutionReadBudget(options.identity);
  const { binding, identity } = options;
  const interactive = binding as LinuxInteractiveExecutionBinding;
  if (options.interactionV1 && (typeof interactive.executionWrite !== 'function' || typeof interactive.executionResize !== 'function')) {
    throw new Error('The Linux execution binding does not support terminal interaction.');
  }
  const token = identity.executionId;
  const buffer = Buffer.alloc(READ_BYTES);
  const decoder = new StringDecoder('utf8');
  const acquired = new Set<string>();
  let configured = false;
  let started = false;
  let finished = false;
  let cancelled = false;
  let subjectReady = false;
  let subjectEnded = false;
  let sourceEnded = false;
  let inputClosed = false;
  let forceRequested = false;
  let stopStrategy: ExecutionStopStrategy | undefined;
  type Interaction = Extract<ExecutionProviderCommand, { type: 'input' | 'resize' }>;
  const interactions: { command: Interaction; bytes?: Buffer; offset: number }[] = [];
  let pendingInputBytes = 0;
  let interactionTask: Promise<void> | undefined;
  let resizeTask: Promise<void> | undefined;
  let interruptTask: Promise<boolean> | undefined;
  let firstFailure: string | undefined;
  let source: SourceDisposition | undefined;
  let sourceEndEvidence: LinuxExecutionProviderResult['sourceEndEvidence'];
  let resolve!: (result: LinuxExecutionProviderResult) => void;
  const completed = new Promise<LinuxExecutionProviderResult>(done => { resolve = done; });

  const channel = createExecutionProviderChannel(identity, {
    ...(options.interactionV1 ? { interactionV1: true as const } : {}),
    onCommand(command) { void commandReceived(command).catch(error => fail(error)); },
    onFault(reason) { fail(reason); },
    onOwnerLost() { fail('Execution authority disconnected.'); }
  });

  const delay = () => new Promise<void>(done => setTimeout(done, options.pollIntervalMs));
  const snapshot = () => configured ? binding.executionSnapshot(token) : undefined;

  function fail(error: unknown): void {
    firstFailure ??= error instanceof Error ? error.message : String(error);
    cancelled = true;
    inputClosed = true;
    if (configured) {
      try { binding.executionSignal(token, 'SIGTERM'); } catch { /* Ownership stays in the native snapshot. */ }
    }
    if (!started) void finish();
  }

  async function send(message: ProviderMessage): Promise<void> {
    try { await channel.send(message); }
    catch (error) { fail(error); }
  }

  async function acquire(resourceId: string): Promise<void> {
    acquired.add(resourceId);
    await send({ type: 'resourceAcquired', identity, resourceId });
  }

  async function release(resourceId: string, released: boolean, reason: string): Promise<void> {
    if (!acquired.has(resourceId)) return;
    await send({ type: 'resourceResult', identity, resourceId, operationId: `release-${resourceId}`,
      result: released ? { kind: 'released' } : { kind: 'unknown', reason } });
  }

  async function commandReceived(command: ExecutionProviderCommand): Promise<void> {
    if (command.type === 'start') {
      started = true;
      await start(command);
      return;
    }
    if (command.type === 'cancelOutput') {
      cancelled = true;
      inputClosed = true;
      await send({ type: 'operationObservation', identity, operationId: command.operationId, result: { kind: 'accepted' } });
      return;
    }
    if (command.type === 'input' || command.type === 'resize') {
      const bytes = command.type === 'input' ? Buffer.from(command.data, 'utf8') : undefined;
      if (!options.interactionV1 || !canInteract() || interactions.length >= EXECUTION_INTERACTION_LIMITS.pendingOperations ||
          pendingInputBytes + (bytes?.length ?? 0) > EXECUTION_INTERACTION_LIMITS.pendingInputBytes) {
        await send({ type: 'interactionObservation', identity, interactionId: command.interactionId,
          result: { kind: 'cancelled', reason: 'Terminal interaction admission is closed or full.',
            ...(bytes ? { writtenBytes: 0 } : {}) } });
        return;
      }
      pendingInputBytes += bytes?.length ?? 0;
      interactions.push({ command, bytes, offset: 0 });
      if (command.type === 'resize' && !resizeTask) {
        // Resize must not wait for stdin to become writable while output consumption waits for resize.
        resizeTask = Promise.resolve().then(() => pumpInteractions('resize'));
        void resizeTask.then(() => { resizeTask = undefined; }, error => { resizeTask = undefined; fail(error); });
      } else if (command.type === 'input' && !interactionTask) {
        interactionTask = Promise.resolve().then(() => pumpInteractions('input'));
        void interactionTask.then(() => { interactionTask = undefined; }, error => { interactionTask = undefined; fail(error); });
      }
      return;
    }
    inputClosed = true;
    if (command.mode === 'force') forceRequested = true;
    if (options.interactionV1 && stopStrategy === 'interrupt-then-hangup' && command.mode === 'graceful') {
      interruptTask ??= writeInterrupt();
      const written = await interruptTask;
      await send({ type: 'operationObservation', identity, operationId: command.operationId,
        result: written ? { kind: 'accepted' } : { kind: 'failed', reason: 'Subject interrupt was not written.' } });
      return;
    }
    const signal = options.interactionV1 ? 'SIGHUP' : command.mode === 'force' ? 'SIGKILL' : 'SIGTERM';
    const result = configured && !subjectEnded ? binding.executionSignal(token, signal) : undefined;
    await send({ type: 'operationObservation', identity, operationId: command.operationId,
      result: subjectEnded || (result && !['unknown', 'error'].includes(result.kind))
        ? { kind: 'accepted' } : { kind: 'failed', reason: 'Subject signal ownership or result is unconfirmed.' } });
  }

  function canInteract(): boolean {
    return subjectReady && !inputClosed && !subjectEnded && !sourceEnded && !firstFailure;
  }

  async function pumpInteractions(kind: Interaction['type']): Promise<void> {
    while (true) {
      const entry = interactions.find(candidate => candidate.command.type === kind);
      if (!entry) return;
      let result: ExecutionInteractionResult;
      try {
        result = { kind: 'cancelled', reason: 'Terminal interaction closed before completion.',
          ...(entry.bytes ? { writtenBytes: entry.offset } : {}) };
        while (canInteract()) {
          const command = entry.command;
          if (command.type === 'input' && entry.offset === entry.bytes!.length) {
            result = { kind: 'written', writtenBytes: entry.offset };
            break;
          }
          const mutation = command.type === 'input'
            ? interactive.executionWrite(token, entry.bytes!.subarray(entry.offset, entry.offset + READ_BYTES))
            : interactive.executionResize(token, command.cols, command.rows);
          if (mutation.kind === 'written') {
            if (!Number.isInteger(mutation.bytes) || mutation.bytes <= 0 ||
              mutation.bytes > Math.min(READ_BYTES, entry.bytes!.length - entry.offset)) throw new Error('Invalid native input progress.');
            entry.offset += mutation.bytes;
            if (entry.offset === entry.bytes!.length) {
              result = { kind: 'written', writtenBytes: entry.offset };
              break;
            }
          } else if (mutation.kind === 'resized') {
            result = { kind: 'resized' };
            break;
          } else if (mutation.kind !== 'retry') {
            result = { kind: mutation.kind === 'rejected' ? 'cancelled' : 'failed',
              reason: `Native terminal interaction ${mutation.reason} (${mutation.errno}).`,
              ...(entry.bytes ? { writtenBytes: entry.offset } : {}) };
            break;
          }
          await delay();
          result = { kind: 'cancelled', reason: 'Terminal interaction closed before completion.',
            ...(entry.bytes ? { writtenBytes: entry.offset } : {}) };
        }
      } catch (error) {
        result = { kind: 'failed', reason: error instanceof Error ? error.message : String(error),
          ...(entry.bytes ? { writtenBytes: entry.offset } : {}) };
      }
      await send({ type: 'interactionObservation', identity, interactionId: entry.command.interactionId, result });
      pendingInputBytes -= entry.bytes?.length ?? 0;
      interactions.splice(interactions.indexOf(entry), 1);
    }
  }

  async function writeInterrupt(): Promise<boolean> {
    while (subjectReady && !subjectEnded && !sourceEnded && !forceRequested && !cancelled && !firstFailure) {
      const result = interactive.executionWrite(token, Buffer.from([3]));
      if (result.kind === 'written') return result.bytes === 1;
      if (result.kind !== 'retry') return false;
      await delay();
    }
    return subjectEnded;
  }

  async function start(command: Extract<ExecutionProviderCommand, { type: 'start' }>): Promise<void> {
    let creationError: unknown;
    try {
      if (options.interactionV1) assertCandidateLaunchSpec(command.spec);
      stopStrategy = command.spec.stopStrategy;
      binding.executionConfigure(token);
      configured = true;
      const env = Object.entries(command.spec.env ?? process.env)
        .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
        .map(([key, value]) => `${key}=${value}`);
      binding.fork(command.spec.file, command.spec.args, env, command.spec.cwd ?? process.cwd(),
        command.spec.cols ?? options.cols, command.spec.rows ?? options.rows, -1, -1, true,
        platform === 'darwin' ? options.helperPath! : '', () => {});
    } catch (error) { creationError = error; }

    try {
      const initial = snapshot();
      if (initial?.masterAcquired) await acquire(MASTER);
      if (initial?.childAcquired) await acquire(CHILD);
      if (platform === 'darwin' && initial?.forkAttempted) {
        await acquire('pty-creation');
        const released = Array.isArray(initial.creationResources) && initial.creationResources.every(resource =>
          !resource.acquired || (resource.releaseAttempted && resource.releaseResult === 0));
        await release('pty-creation', released, 'PTY creation resource release is unconfirmed.');
        if (!released) creationError ??= new Error('PTY creation resources were not fully released.');
      }
      const readable = !creationError && initial?.nonblockConfirmed === true;
      if (readable) await acquire(SOURCE);
      if (!creationError && initial?.childAcquired && initial.pid !== null && readable) {
        subjectReady = true;
        await send({ type: 'operationObservation', identity, operationId: command.operationId,
          result: { kind: 'started', pid: initial.pid } });
      } else {
        fail(creationError ?? 'PTY creation did not establish a readable execution.');
        await send({ type: 'operationObservation', identity, operationId: command.operationId,
          result: { kind: 'failed', stage: 'pty-create', reason: 'PTY creation failed; acquired ownership is retained.' } });
      }

      // Process observation must continue while the output writer waits for credit.
      const processTask = observeProcess();
      if (readable) {
        try {
          source = await readOutput();
          if (source.kind === 'error') fail(source.reason);
        }
        catch (error) { fail(error); source = { kind: 'error', reason: 'PTY output could not be transferred.' }; }
      } else {
        source = { kind: 'unknown', reason: 'PTY output source was not established.' };
        sourceEndEvidence = 'not-established';
      }
      inputClosed = true;
      sourceEnded = true;
      await interactionTask;
      await resizeTask;
      await interruptTask;
      await release(SOURCE, true, 'PTY source settlement is incomplete.');
      if (initial?.masterAcquired) {
        try { binding.executionClose(token); } catch (error) { fail(error); }
        await release(MASTER, snapshot()?.closeResult === 0, 'PTY master close is unconfirmed.');
      }
      await processTask;
      try { await channel.end(source); } catch (error) { fail(error); }
    } catch (error) { fail(error); }
    await finish();
  }

  async function observeProcess(): Promise<void> {
    let observed: LinuxExecutionWaitStatus | undefined;
    try {
      observed = snapshot()?.waitStatus;
      while (observed && (observed.kind === 'pending' || observed.kind === 'not-started') && snapshot()?.childAcquired) {
        observed = binding.executionPollWait(token);
        if (observed.kind === 'pending') await delay();
      }
    } catch (error) { fail(error); observed = undefined; }
    const result = processResult(observed);
    subjectEnded = result.kind !== 'unconfirmed';
    inputClosed = true;
    await send({ type: 'processResult', identity, result });
    await release(CHILD, observed?.kind === 'exited' || observed?.kind === 'signaled', 'Subject wait did not confirm a terminal state.');
  }

  async function readOutput(): Promise<SourceDisposition> {
    let disposition: SourceDisposition | undefined;
    while (!disposition) {
      if (cancelled) {
        disposition = { kind: 'interrupted', reason: firstFailure ?? 'Output was explicitly cancelled.' };
        sourceEndEvidence = 'cancelled';
        break;
      }
      const read = binding.executionRead(token, buffer);
      if (read.kind === 'retry') {
        await delay();
      } else if (read.kind === 'data') {
        if (!Number.isInteger(read.bytes) || read.bytes < 1 || read.bytes > READ_BYTES) throw new Error('Invalid PTY read size.');
        const text = decoder.write(buffer.subarray(0, read.bytes));
        if (text) await channel.write(text);
      } else if (read.kind === 'eof') {
        if (platform === 'darwin' && read.reason !== 'zero') throw new Error('Darwin EOF requires an actual zero-length read.');
        sourceEnded = true;
        sourceEndEvidence = read.reason;
        disposition = { kind: 'eof' };
      } else {
        sourceEnded = true;
        sourceEndEvidence = 'read-error';
        disposition = { kind: 'error', reason: `PTY read failed with errno ${read.errno}.` };
      }
    }
    const tail = decoder.end();
    if (tail) await channel.write(tail);
    return disposition;
  }

  async function finish(): Promise<void> {
    if (finished) return;
    finished = true;
    try { await channel.close(); } catch (error) { firstFailure ??= String(error); }
    let native: LinuxExecutionNativeSnapshot | undefined;
    try { native = snapshot(); } catch (error) { firstFailure ??= String(error); }
    const resourcesSettled = configured && Boolean(native)
      && (!native!.masterAcquired || native!.closeResult === 0)
      && (!native!.childAcquired || native!.waitStatus.kind === 'exited' || native!.waitStatus.kind === 'signaled')
      && (platform !== 'darwin' || Array.isArray(native!.creationResources))
      && (native!.creationResources ?? []).every(resource => !resource.acquired ||
        (resource.releaseAttempted && resource.releaseResult === 0));
    resolve({ kind: !firstFailure && resourcesSettled ? 'closed' : 'failed',
      ...(firstFailure ? { reason: firstFailure } : {}), native, source, sourceEndEvidence, resourcesSettled });
  }

  void channel.ready().catch(error => fail(error));
  return completed;
}

function processResult(status: LinuxExecutionWaitStatus | undefined): ProcessResult {
  if (status?.kind === 'exited' && Number.isInteger(status.exitCode)) {
    return { kind: 'exited', exitCode: status.exitCode! };
  }
  if (status?.kind === 'signaled' && Number.isInteger(status.signalCode)) {
    const signal = Object.entries(constants.signals).find(([, code]) => code === status.signalCode)?.[0];
    if (signal) return { kind: 'signaled', signal };
    return { kind: 'terminated', reason: `Subject terminated by signal ${status.signalCode}.` };
  }
  return { kind: 'unconfirmed', reason: 'No confirmed native subject wait result.' };
}
