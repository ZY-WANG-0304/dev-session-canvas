import { spawn, type ChildProcess } from 'node:child_process';
import * as path from 'node:path';
import { performance } from 'node:perf_hooks';

import type { ExecutionCandidateProfile } from '../common/executionLifecycle';
import type { RuntimeHostBackendKind } from '../common/protocol';
import {
  parseRuntimeOwnerDescriptor,
  resolveRootRuntimeSupervisorGeneration,
  resolveRuntimeRootOwnerGlobalStoragePath,
  type RuntimeOwnerDescriptorV1
} from '../common/runtimeRootOwnership';

const PREPARATION_BUDGET_MS = 30_000;
const HELPER_EXIT_BUDGET_MS = 1_000;
const STDERR_LIMIT_BYTES = 64 * 1024;
const RESULT_REASON_LIMIT_CHARS = 1_024;

export interface RootPreparationRequest {
  readonly type: 'prepare-root-runtime';
  readonly storageDir: string;
  readonly owner: RuntimeOwnerDescriptorV1;
  readonly executionProfile: ExecutionCandidateProfile;
  readonly preferredBackends: readonly RuntimeHostBackendKind[];
  readonly supervisorScriptPath: string;
  readonly supervisorLauncherScriptPath: string;
}

export type RootPreparationResult =
  | Readonly<{ kind: 'ready'; backend: RuntimeHostBackendKind }>
  | Readonly<{ kind: 'unconfirmed' | 'rejected'; reason: string }>;

export async function prepareRootRuntimeSupervisor(
  options: Omit<RootPreparationRequest, 'type'>
): Promise<RootPreparationResult> {
  let request: RootPreparationRequest;
  try {
    const owner = parseRuntimeOwnerDescriptor(options.owner);
    if (owner.generation !== resolveRootRuntimeSupervisorGeneration(options.executionProfile)) {
      throw new Error('Mismatched execution profile.');
    }
    resolveRuntimeRootOwnerGlobalStoragePath(options.storageDir, owner);
    if (![options.supervisorScriptPath, options.supervisorLauncherScriptPath].every(value =>
      typeof value === 'string' && path.isAbsolute(value) && !value.includes('\0'))
      || !Array.isArray(options.preferredBackends) || options.preferredBackends.length < 1
      || options.preferredBackends.length > 2 || new Set(options.preferredBackends).size !== options.preferredBackends.length
      || !options.preferredBackends.every(isBackend)) throw new Error('Invalid preparation arguments.');
    request = { type: 'prepare-root-runtime', storageDir: options.storageDir, owner,
      executionProfile: options.executionProfile, preferredBackends: [...options.preferredBackends],
      supervisorScriptPath: options.supervisorScriptPath, supervisorLauncherScriptPath: options.supervisorLauncherScriptPath };
  } catch {
    return { kind: 'rejected', reason: 'Invalid root runtime preparation request.' };
  }

  const deadline = performance.now() + PREPARATION_BUDGET_MS;
  let child: ChildProcess;
  try {
    child = spawn(process.execPath, [request.supervisorLauncherScriptPath, '--prepare-root-runtime'], {
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'], shell: false, detached: false, windowsHide: true,
      serialization: 'json', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', ELECTRON_NO_ATTACH_CONSOLE: '1' }
    });
  } catch {
    return unconfirmed('Root runtime preparation helper could not be started.');
  }

  return new Promise(resolve => {
    let submitted = false;
    let settled = false;
    let result: RootPreparationResult | undefined;
    let processExited = false;
    let ipcDisconnected = false;
    let stderrClosed = child.stderr === null;
    let stderrBytes = 0;
    let exitTimer: NodeJS.Timeout | undefined;
    const budgetTimer = setTimeout(() => finish(unconfirmed('Root runtime preparation deadline expired.')),
      Math.max(0, Math.ceil(deadline - performance.now())));

    const disconnect = (): void => {
      if (!child.connected) return;
      try { child.disconnect(); } catch { /* IPC closure cannot prove whether startup was submitted. */ }
    };
    const finish = (outcome: RootPreparationResult): void => {
      if (settled) return;
      settled = true;
      if (performance.now() >= deadline) outcome = unconfirmed('Root runtime preparation deadline expired.');
      clearTimeout(budgetTimer);
      if (exitTimer) clearTimeout(exitTimer);
      child.removeListener('spawn', onSpawn);
      child.removeListener('message', onMessage);
      child.removeListener('error', onError);
      child.removeListener('disconnect', onDisconnect);
      child.removeListener('exit', onExit);
      child.removeListener('close', onClose);
      child.stderr?.removeListener('data', onStderr);
      child.stderr?.removeListener('error', onStderrError);
      child.stderr?.removeListener('close', onStderrClose);
      disconnect();
      child.stderr?.destroy();
      child.unref();
      resolve(Object.freeze(outcome));
    };
    const beginClose = (outcome: RootPreparationResult): void => {
      if (settled || result) return;
      if (performance.now() >= deadline) { finish(unconfirmed('Root runtime preparation deadline expired.')); return; }
      result = outcome;
      exitTimer = setTimeout(() => finish(unconfirmed('Root runtime preparation helper exit was not confirmed.')),
        Math.max(0, Math.min(HELPER_EXIT_BUDGET_MS, Math.ceil(deadline - performance.now()))));
      disconnect();
    };
    const onSpawn = (): void => {
      if (settled || result || submitted) return;
      if (performance.now() >= deadline) { finish(unconfirmed('Root runtime preparation deadline expired.')); return; }
      submitted = true;
      try {
        child.send(request, error => {
          if (error) beginClose(unconfirmed('Root runtime preparation request delivery was not confirmed.'));
        });
      } catch {
        beginClose(unconfirmed('Root runtime preparation request delivery was not confirmed.'));
      }
    };
    const onMessage = (value: unknown): void => {
      if (settled || result) return;
      const response = submitted ? parseResult(value) : undefined;
      beginClose(response ?? unconfirmed('Root runtime preparation helper returned an invalid result.'));
    };
    const onError = (): void => beginClose(unconfirmed('Root runtime preparation helper failed.'));
    // Node may omit aggregate close after parent-initiated disconnect. All three facts are still required.
    const maybeClosed = (): void => {
      if (processExited && ipcDisconnected && stderrClosed) onClose();
    };
    const onDisconnect = (): void => {
      ipcDisconnected = true;
      beginClose(unconfirmed('Root runtime preparation IPC disconnected without a result.'));
      maybeClosed();
    };
    const onExit = (): void => {
      processExited = true;
      beginClose(unconfirmed('Root runtime preparation helper exited without a result.'));
      maybeClosed();
    };
    const onClose = (): void => finish(result ?? unconfirmed('Root runtime preparation helper closed without a result.'));
    const onStderrClose = (): void => { stderrClosed = true; maybeClosed(); };
    const onStderr = (chunk: Buffer): void => {
      // Drain diagnostics without retaining payload or including it in returned errors.
      stderrBytes = Math.min(STDERR_LIMIT_BYTES + 1, stderrBytes + chunk.byteLength);
      if (stderrBytes > STDERR_LIMIT_BYTES) {
        beginClose(unconfirmed('Root runtime preparation helper exceeded its diagnostic output limit.'));
      }
    };
    const onStderrError = (): void => beginClose(unconfirmed('Root runtime preparation diagnostic pipe failed.'));

    child.once('spawn', onSpawn);
    child.on('message', onMessage);
    child.on('error', onError);
    child.on('disconnect', onDisconnect);
    child.on('exit', onExit);
    child.once('close', onClose);
    child.stderr?.on('data', onStderr);
    child.stderr?.on('error', onStderrError);
    child.stderr?.once('close', onStderrClose);
  });
}

function parseResult(value: unknown): RootPreparationResult | undefined {
  if (typeof value !== 'object' || value === null ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) return undefined;
  const fields = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(fields);
  if (keys.length !== 2 || keys.some(key => typeof key !== 'string'
    || !fields[key]?.enumerable || !('value' in fields[key]))) return undefined;
  const kind = fields.kind?.value;
  if (kind === 'ready' && isBackend(fields.backend?.value)) return { kind, backend: fields.backend.value };
  const reason = fields.reason?.value;
  if ((kind === 'unconfirmed' || kind === 'rejected') && typeof reason === 'string'
    && reason.length > 0 && reason.length <= RESULT_REASON_LIMIT_CHARS) return { kind, reason };
  return undefined;
}

function isBackend(value: unknown): value is RuntimeHostBackendKind {
  return value === 'legacy-detached' || value === 'systemd-user';
}

function unconfirmed(reason: string): RootPreparationResult {
  return { kind: 'unconfirmed', reason };
}
