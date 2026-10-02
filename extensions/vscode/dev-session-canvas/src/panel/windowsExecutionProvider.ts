import { randomUUID } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import {
  assertCandidateLaunchSpec, encodeOutputFrame, EXECUTION_INTERACTION_LIMITS, S1_LIMITS,
  type ExecutionIdentity, type ExecutionInteractionResult, type ProcessResult,
  type ProviderMessage, type SourceDisposition
} from '../common/executionLifecycle';
import { createExecutionProviderChannel, type ExecutionProviderCommand } from './executionProviderChannel';
import { createWindowsExecutionPipes, type WindowsExecutionPipes } from './windowsExecutionPipes';
import { WINDOWS_OUTPUT_READ_BYTES } from './windowsExecutionOutput';

export const WINDOWS_EXECUTION_RESOURCE_IDS = Object.freeze([
  'conpty-owner', 'conpty-process', 'conpty-input', 'conpty-source'
]);

export interface WindowsExecutionNativeSnapshot {
  token: string;
  busy: boolean;
  ownerAcquired: boolean;
  ownerReleased: boolean;
  processAcquired: boolean;
  processReleased: boolean;
  processState: 'not-started' | 'pending' | 'exited' | 'unknown';
  pid: number | null;
  exitCode: number | null;
  waitError: number;
  closeRequested: boolean;
  closeCalled: boolean;
  closeReturned: boolean;
  connectAttempted: boolean;
  connected: boolean;
  releaseAttempted: boolean;
  releaseResult: number;
  resizeResult: number;
  error: string | null;
  handles?: Readonly<Record<string, { acquired: boolean; released: boolean; closeAttempted: boolean; closeError: number }>>;
  libraryCloseError?: number;
}

export interface WindowsExecutionBinding {
  executionStart(token: string, pipeName: string, cols: number, rows: number): Promise<{ conin: string; conout: string }>;
  executionConnect(token: string, commandLine: string, cwd: string, env: readonly string[]): Promise<{ pid: number }>;
  executionPollWait(token: string): WindowsExecutionNativeSnapshot;
  executionResize(token: string, cols: number, rows: number): Promise<{ kind: 'resized' }>;
  executionClose(token: string): Promise<{ kind: 'closed' | 'unknown' }>;
  executionSnapshot(token: string): WindowsExecutionNativeSnapshot;
}

export interface WindowsExecutionProviderOptions {
  identity: ExecutionIdentity;
  binding: WindowsExecutionBinding;
  workerPath: string;
  commandLine(file: string, args: readonly string[], env: Readonly<Record<string, string | undefined>>): string;
  createPipes?: typeof createWindowsExecutionPipes;
}

export interface WindowsExecutionProviderResult {
  kind: 'closed' | 'failed';
  reason?: string;
  native?: WindowsExecutionNativeSnapshot;
  source?: SourceDisposition;
  resourcesSettled: boolean;
}

export function runWindowsExecutionProvider(options: WindowsExecutionProviderOptions): Promise<WindowsExecutionProviderResult> {
  if (process.platform !== 'win32' || typeof options.commandLine !== 'function') {
    throw new Error('Windows execution provider requires its explicit Windows launch adapter.');
  }
  const { identity, binding } = options;
  const envelope = encodeOutputFrame({ version: 1, identity, frameId: Number.MAX_SAFE_INTEGER, text: 'x' });
  if (envelope.byteLength - 5 + 6 * (WINDOWS_OUTPUT_READ_BYTES + 3) > S1_LIMITS.payloadBytes) {
    throw new Error('Execution identity leaves insufficient room for a bounded ConPTY read.');
  }
  const token = JSON.stringify([identity.executionId, identity.generation]);
  const acquired = new Set<string>();
  const released = new Set<string>();
  const decoder = new StringDecoder('utf8');
  let startReceived = false;
  let configured = false;
  let ready = false;
  let subjectEnded = false;
  let inputAdmission = false;
  let cancelled = false;
  let stopping = false;
  let finishing = false;
  let firstFailure: string | undefined;
  let source: SourceDisposition | undefined;
  let pipes: WindowsExecutionPipes | undefined;
  let closeTask: Promise<void> | undefined;
  let inputTask = Promise.resolve();
  let resizeTask = Promise.resolve();
  let pendingOperations = 0;
  let pendingInputBytes = 0;
  let stopStrategy: 'hangup' | 'interrupt-then-hangup' = 'hangup';
  let resolve!: (result: WindowsExecutionProviderResult) => void;
  const completed = new Promise<WindowsExecutionProviderResult>(done => { resolve = done; });
  const channel = createExecutionProviderChannel(identity, {
    interactionV1: true,
    onCommand(command) { void receive(command).catch(fail); },
    onFault: fail,
    onOwnerLost() { fail('Execution authority disconnected.'); }
  });
  const delay = () => new Promise<void>(done => setTimeout(done, 5));
  const snapshot = () => configured ? binding.executionSnapshot(token) : undefined;

  function fail(error: unknown): void {
    firstFailure ??= error instanceof Error ? error.message : String(error);
    inputAdmission = false;
    cancelled = true;
    pipes?.cancel(firstFailure);
    pipes?.closeInput();
    if (configured) void closeNative();
    if (!startReceived) void finish();
  }
  async function send(message: ProviderMessage): Promise<void> {
    try { await channel.send(message); } catch (error) { fail(error); }
  }
  async function acquire(resourceId: string): Promise<void> {
    if (acquired.has(resourceId)) return;
    acquired.add(resourceId);
    await send({ type: 'resourceAcquired', identity, resourceId });
  }
  async function release(resourceId: string, confirmed: boolean): Promise<void> {
    if (!acquired.has(resourceId) || released.has(resourceId)) return;
    if (confirmed) released.add(resourceId);
    await send({ type: 'resourceResult', identity, resourceId, operationId: `release-${resourceId}`,
      result: confirmed ? { kind: 'released' } : { kind: 'unknown', reason: `${resourceId} release is unconfirmed.` } });
  }
  async function reportNativeAcquired(): Promise<void> {
    const state = snapshot();
    if (state?.ownerAcquired) await acquire('conpty-owner');
    if (state?.processAcquired) await acquire('conpty-process');
  }
  function closeNative(): Promise<void> {
    if (closeTask) return closeTask;
    if (!configured) return Promise.resolve();
    // Start the native Close now; it waits for native resize without blocking the reader.
    closeTask = Promise.resolve().then(() => binding.executionClose(token)).then(result => {
      if (result.kind !== 'closed') firstFailure ??= 'Owned pseudoconsole close is unconfirmed.';
    }, error => { firstFailure ??= error instanceof Error ? error.message : String(error); });
    return closeTask;
  }
  function canInteract(): boolean {
    return ready && inputAdmission && !subjectEnded && !source && !firstFailure;
  }
  async function receive(command: ExecutionProviderCommand): Promise<void> {
    if (command.type === 'start') {
      startReceived = true;
      await start(command);
      return;
    }
    if (command.type === 'cancelOutput') {
      cancelled = true;
      inputAdmission = false;
      pipes?.cancel(command.reason);
      pipes?.closeInput();
      await send({ type: 'operationObservation', identity, operationId: command.operationId, result: { kind: 'accepted' } });
      return;
    }
    if (command.type === 'requestStop') {
      stopping = true;
      inputAdmission = false;
      if (command.mode === 'graceful' && stopStrategy === 'interrupt-then-hangup' && ready && !subjectEnded && !cancelled) {
        const interrupt = inputTask.then(async () => {
          if (!subjectEnded && !cancelled && !closeTask) await pipes!.write(Buffer.from([3]));
        });
        inputTask = interrupt.catch(() => {});
        try {
          await interrupt;
          await send({ type: 'operationObservation', identity, operationId: command.operationId, result: { kind: 'accepted' } });
        } catch {
          await send({ type: 'operationObservation', identity, operationId: command.operationId,
            result: { kind: 'failed', reason: 'Terminal interrupt could not be written.' } });
        }
      } else {
        pipes?.closeInput();
        if (configured) void closeNative();
        await send({ type: 'operationObservation', identity, operationId: command.operationId,
          result: { kind: 'accepted' } });
      }
      return;
    }
    const bytes = command.type === 'input' ? Buffer.from(command.data, 'utf8') : undefined;
    if (!canInteract() || pendingOperations >= EXECUTION_INTERACTION_LIMITS.pendingOperations
      || pendingInputBytes + (bytes?.length ?? 0) > EXECUTION_INTERACTION_LIMITS.pendingInputBytes) {
      await send({ type: 'interactionObservation', identity, interactionId: command.interactionId,
        result: { kind: 'cancelled', reason: 'Terminal interaction admission is closed or full.',
          ...(bytes ? { writtenBytes: 0 } : {}) } });
      return;
    }
    pendingOperations++;
    pendingInputBytes += bytes?.length ?? 0;
    const interaction = async () => {
      let result: ExecutionInteractionResult;
      if (!canInteract()) result = { kind: 'cancelled', reason: 'Terminal closed before interaction.',
        ...(bytes ? { writtenBytes: 0 } : {}) };
      else {
        try {
          if (command.type === 'input') {
            await pipes!.write(bytes!);
            result = { kind: 'written', writtenBytes: bytes!.length };
          } else {
            await binding.executionResize(token, command.cols, command.rows);
            result = { kind: 'resized' };
          }
        } catch {
          // A failed pipe write does not report an invented partial byte count.
          result = { kind: 'failed', reason: 'Native terminal interaction failed.' };
        }
      }
      await send({ type: 'interactionObservation', identity, interactionId: command.interactionId, result });
      pendingOperations--;
      pendingInputBytes -= bytes?.length ?? 0;
    };
    if (command.type === 'input') inputTask = inputTask.then(interaction);
    else resizeTask = resizeTask.then(interaction);
  }
  async function observeProcess(): Promise<void> {
    let state = snapshot();
    try {
      while (state?.processAcquired && state.processState === 'pending') {
        state = binding.executionPollWait(token);
        if (state.processState === 'pending') await delay();
      }
    } catch (error) { fail(error); state = undefined; }
    const result: ProcessResult = state?.processState === 'exited' && Number.isInteger(state.exitCode)
      ? { kind: 'exited', exitCode: state.exitCode! }
      : { kind: 'unconfirmed', reason: 'No confirmed owned Windows process result.' };
    subjectEnded = result.kind === 'exited';
    inputAdmission = false;
    pipes?.closeInput();
    await send({ type: 'processResult', identity, result });
    await release('conpty-process', state?.processReleased === true);
  }
  async function start(command: Extract<ExecutionProviderCommand, { type: 'start' }>): Promise<void> {
    let outputTask: Promise<SourceDisposition> | undefined;
    let processTask: Promise<void> | undefined;
    try {
      assertCandidateLaunchSpec(command.spec);
      stopStrategy = command.spec.stopStrategy!;
      // A native failure after token registration still owns its partial resources.
      let addresses: { conin: string; conout: string };
      try {
        const task = binding.executionStart(token, `dsc-execution-${randomUUID()}`, command.spec.cols!, command.spec.rows!);
        configured = true;
        addresses = await task;
      } catch (error) {
        try { binding.executionSnapshot(token); configured = true; } catch { /* Rejected before native ownership. */ }
        throw error;
      }
      await reportNativeAcquired();
      if (stopping || cancelled || firstFailure) throw new Error('Execution closed during pseudoconsole creation.');
      pipes = (options.createPipes ?? createWindowsExecutionPipes)({ ...addresses, workerPath: options.workerPath });
      if (pipes.acquired.input) await acquire('conpty-input');
      if (pipes.acquired.source) await acquire('conpty-source');
      outputTask = pipes.output(async bytes => {
        const text = decoder.write(bytes);
        if (text) await channel.write(text);
      });
      void outputTask.catch(() => {});
      await pipes.ready;
      if (stopping || cancelled || firstFailure) throw new Error('Execution closed before process connection.');
      const env = Object.entries(command.spec.env ?? process.env)
        .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
        .sort(([left], [right]) => left.toUpperCase().localeCompare(right.toUpperCase()))
        .map(([key, value]) => `${key}=${value}`);
      const connection = await binding.executionConnect(token,
        options.commandLine(command.spec.file, command.spec.args, command.spec.env ?? process.env),
        command.spec.cwd ?? process.cwd(), env);
      await reportNativeAcquired();
      if (!Number.isSafeInteger(connection.pid) || connection.pid < 1) throw new Error('Invalid Windows subject PID.');
      ready = true;
      inputAdmission = !stopping && !cancelled && !firstFailure;
      processTask = observeProcess();
      await send({ type: 'operationObservation', identity, operationId: command.operationId,
        result: { kind: 'started', pid: connection.pid } });
      source = await outputTask;
      if (source.kind === 'error' || source.kind === 'unknown') fail(source.reason);
    } catch (error) {
      fail(error);
      await reportNativeAcquired().catch(fail);
      if (!ready) {
        await send({ type: 'operationObservation', identity, operationId: command.operationId,
          result: { kind: 'failed', stage: 'conpty-create', reason: 'Windows execution creation failed; acquired ownership is retained.' } });
      }
      if (outputTask) {
        try { source = await outputTask; } catch { source = { kind: 'error', reason: 'ConPTY output transfer failed.' }; }
      } else source = { kind: 'unknown', reason: 'ConPTY output source was not established.' };
      processTask ??= observeProcess();
    }
    inputAdmission = false;
    pipes?.closeInput();
    await Promise.all([inputTask, resizeTask]);
    const tail = decoder.end();
    try {
      if (tail) await channel.write(tail);
      await channel.end(source!);
    } catch (error) { fail(error); }
    if (pipes) {
      const resources = await pipes.closed;
      await release('conpty-input', resources.input);
      await release('conpty-source', resources.source);
    }
    // Natural release follows real source/local handoff; explicit stop may already have closed HPCON.
    if (source?.kind === 'eof' && !stopping && !cancelled && !firstFailure) await processTask;
    await closeNative();
    await release('conpty-owner', snapshot()?.ownerReleased === true);
    await processTask;
    await finish();
  }
  async function finish(): Promise<void> {
    if (finishing) return;
    finishing = true;
    try { await channel.close(); } catch (error) { firstFailure ??= String(error); }
    let native: WindowsExecutionNativeSnapshot | undefined;
    try { native = snapshot(); } catch (error) { firstFailure ??= String(error); }
    const resourcesSettled = [...acquired].every(resource => released.has(resource))
      && (!native?.ownerAcquired || native.ownerReleased) && (!native?.processAcquired || native.processReleased);
    resolve({ kind: !firstFailure && resourcesSettled ? 'closed' : 'failed',
      ...(firstFailure ? { reason: firstFailure } : {}), native, source, resourcesSettled });
  }
  void channel.ready().catch(fail);
  return completed;
}
