import { execFile } from 'child_process';
import { createHash } from 'crypto';
import * as path from 'path';
import { promisify } from 'util';

import { assertExecutionCandidateProfile } from '../common/executionLifecycle';
import type { RuntimeHostBackendKind } from '../common/protocol';
import { createRuntimeOwnerCompatibilityFingerprint, parseRuntimeOwnerDescriptor,
  resolveRootRuntimeSupervisorGeneration, resolveRuntimeRootOwnerGlobalStoragePath } from '../common/runtimeRootOwnership';
import { resolveLegacyRuntimeSupervisorPathsFromStorageDir,
  resolveSystemdUserRuntimeSupervisorPathsFromStorageDir } from '../common/runtimeSupervisorPaths';
import { createNativeExecutionOwnerOptions } from '../panel/executionOwnerFactory';
import { readRuntimeExecutionEnvironment } from '../panel/runtimeExecutionEnvironment';
import type { RuntimeHostBackend } from '../panel/runtimeHostBackend';
import type { RootPreparationRequest, RootPreparationResult } from '../panel/runtimeRootSupervisorPreparation';
import { ExecutionCandidateHandshakeError, RuntimeSupervisorClient } from '../panel/runtimeSupervisorClient';
import { inspectRuntimeSystemdEnvironment } from '../panel/runtimeSystemdEnvironment';
import { ensureRuntimeRootSocketDirectory, prepareRuntimeRootOwnerDirectories,
  publishRuntimeRootOwner, readRuntimeRootOwner } from './runtimeRootOwner';
import { createRuntimeRootStartupIntent, inspectRuntimeRootStartup, writeRuntimeRootStartupIntent } from './runtimeRootStartup';
import { acquireRuntimeSupervisorNamespace } from './runtimeSupervisorNamespace';
import { startRuntimeSupervisor } from './runtimeSupervisorStart';

const execFileAsync = promisify(execFile);
const DISCOVERY_TIMEOUT_MS = 1500;
const WAIT_TIMEOUT_MS = 5000;
const RETRY_MS = 100;

// This function runs only in the short-lived launcher: native preparation claims live until its exit.
export async function prepareRuntimeRootSupervisor(
  input: RootPreparationRequest,
  isCancelled: () => boolean
): Promise<RootPreparationResult> {
  let request: RootPreparationRequest;
  try { request = validateRequest(input); }
  catch { return { kind: 'rejected', reason: 'Invalid root runtime preparation request.' }; }
  const unconfirmed = (reason: string): RootPreparationResult => ({ kind: 'unconfirmed', reason });
  let preparingStorage = true;
  try {
    const { preparationDir } = await prepareRuntimeRootOwnerDirectories(request.storageDir, request.owner);
    preparingStorage = false;
    if (isCancelled()) return unconfirmed('Root runtime preparation was cancelled.');
    await ensureRuntimeRootSocketDirectory(backend(request, 'legacy-detached').paths, 'legacy-detached', true);
    if (isCancelled()) return unconfirmed('Root runtime preparation was cancelled.');
    const native = createNativeExecutionOwnerOptions({ extensionRoot: path.dirname(path.dirname(request.supervisorScriptPath)),
      profile: request.executionProfile, mode: 'live-runtime' });
    const claim = native.kind === 'linux-provider' || native.kind === 'macos-provider' ? native.claimNamespace : undefined;
    const deadline = Date.now() + WAIT_TIMEOUT_MS;
    let acquired = false;
    while (!isCancelled()) {
      try {
        await acquireRuntimeSupervisorNamespace(preparationDir, claim);
        acquired = true;
        break;
      } catch {
        const discovered = await discoverOwner(request);
        if (discovered.kind === 'ready' || discovered.kind === 'rejected') return discovered;
        if (Date.now() >= deadline) break;
        await delay(RETRY_MS);
      }
    }
    if (!acquired || isCancelled()) return unconfirmed('Root runtime preparation ownership is unconfirmed.');
    const discovered = await discoverOwner(request);
    if (discovered.kind !== 'absent') return discovered;
    if (isCancelled()) return unconfirmed('Root runtime preparation was cancelled.');
    const previous = await inspectRuntimeRootStartup(request.storageDir, request.owner);
    if (previous.kind === 'unknown') return unconfirmed('The previous root runtime launch is unconfirmed.');
    await publishRuntimeRootOwner(request.storageDir, request.owner);

    // Endpoint refusal is not proof of absence. A separate process positively claims the runtime namespace.
    if (!await probeRuntimeUnowned(request)) return unconfirmed('Root runtime ownership is not available.');
    if (isCancelled()) return unconfirmed('Root runtime preparation was cancelled.');
    let selected: RuntimeHostBackendKind | undefined;
    for (const kind of request.preferredBackends) {
      if (kind === 'systemd-user') {
        const environment = await readRuntimeExecutionEnvironment();
        const scope = await inspectRuntimeSystemdEnvironment({ supervisorLauncherScriptPath: request.supervisorLauncherScriptPath,
          environmentKey: environment.environmentKey,
          userIdentityKey: createHash('sha256').update(environment.userIdentity).digest('hex') });
        if (scope.kind === 'unknown') return unconfirmed('The systemd execution environment is unconfirmed.');
        if (scope.kind === 'unavailable') continue;
      }
      selected = kind;
      break;
    }
    if (!selected) return { kind: 'rejected', reason: 'No compatible runtime backend is available.' };
    if (isCancelled()) return unconfirmed('Root runtime preparation was cancelled.');
    const intent = createRuntimeRootStartupIntent(request.owner, selected,
      createRuntimeOwnerCompatibilityFingerprint(request.owner.generation, request.executionProfile, native.admissionLimits));
    await writeRuntimeRootStartupIntent(request.storageDir, intent);
    if (isCancelled()) return unconfirmed('Root runtime submission was cancelled with a pending intent.');
    // From this point no error, timeout, or cancellation permits a second submit or another backend.
    await startRuntimeSupervisor(backend(request, selected), { supervisorScriptPath: request.supervisorScriptPath,
      supervisorLauncherScriptPath: request.supervisorLauncherScriptPath, executionProfile: request.executionProfile,
      runtimeLaunchToken: intent.token });
    const readyDeadline = Date.now() + WAIT_TIMEOUT_MS;
    do {
      const observed = await discoverOwner(request);
      if (observed.kind === 'ready' || observed.kind === 'rejected') return observed;
      if (isCancelled()) break;
      await delay(RETRY_MS);
    } while (Date.now() < readyDeadline);
    return unconfirmed('Root runtime was submitted but readiness is unconfirmed.');
  } catch {
    if (preparingStorage) return { kind: 'rejected',
      reason: 'Root runtime storage preparation failed. Check directory ownership, permissions, and runtime owner identity.' };
    return unconfirmed('Root runtime preparation or submission did not complete.');
  }
}

// A zero exit status is sent only after claiming; process exit releases the one-shot native claim.
export async function claimRootRuntimeForProbe(storageDir: string, profile: unknown, extensionRoot: string): Promise<void> {
  assertExecutionCandidateProfile(profile);
  const owner = await readRuntimeRootOwner(storageDir, profile);
  if (!owner) throw new Error('Only a root runtime namespace may be probed.');
  const native = createNativeExecutionOwnerOptions({ extensionRoot, profile, mode: 'live-runtime' });
  await acquireRuntimeSupervisorNamespace(storageDir,
    native.kind === 'linux-provider' || native.kind === 'macos-provider' ? native.claimNamespace : undefined);
}

function validateRequest(input: RootPreparationRequest): RootPreparationRequest {
  if (!input || input.type !== 'prepare-root-runtime') throw new Error('Invalid request.');
  const owner = parseRuntimeOwnerDescriptor(input.owner);
  assertExecutionCandidateProfile(input.executionProfile);
  if (owner.generation !== resolveRootRuntimeSupervisorGeneration(input.executionProfile)) throw new Error('Profile mismatch.');
  resolveRuntimeRootOwnerGlobalStoragePath(input.storageDir, owner);
  for (const filename of [input.supervisorScriptPath, input.supervisorLauncherScriptPath]) {
    if (typeof filename !== 'string' || !path.isAbsolute(filename) || filename.includes('\0')) throw new Error('Invalid script.');
  }
  if (!Array.isArray(input.preferredBackends) || input.preferredBackends.length < 1 || input.preferredBackends.length > 2 ||
      new Set(input.preferredBackends).size !== input.preferredBackends.length ||
      input.preferredBackends.some(kind => kind !== 'legacy-detached' && kind !== 'systemd-user')) throw new Error('Invalid backends.');
  return { ...input, owner };
}

function backend(request: RootPreparationRequest, kind: RuntimeHostBackendKind): RuntimeHostBackend {
  return { kind, guarantee: kind === 'systemd-user' ? 'strong' : 'best-effort', label: kind,
    paths: kind === 'systemd-user' ? resolveSystemdUserRuntimeSupervisorPathsFromStorageDir(request.storageDir)
      : resolveLegacyRuntimeSupervisorPathsFromStorageDir(request.storageDir),
    startSupervisor: async () => { throw new Error('Discovery cannot start a Supervisor.'); } };
}

async function discoverOwner(request: RootPreparationRequest): Promise<RootPreparationResult | { kind: 'absent' }> {
  const kinds: RuntimeHostBackendKind[] = process.platform === 'linux' ? ['systemd-user', 'legacy-detached'] : ['legacy-detached'];
  let ready: RootPreparationResult | undefined;
  for (const kind of kinds) {
    const client = new RuntimeSupervisorClient({ backend: backend(request, kind), executionProfile: request.executionProfile,
      expectedRuntimeOwner: request.owner, supervisorScriptPath: request.supervisorScriptPath,
      supervisorLauncherScriptPath: request.supervisorLauncherScriptPath });
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([client.ensureConnected({ allowRestart: false }), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Discovery deadline exceeded.')), DISCOVERY_TIMEOUT_MS);
      })]);
      if (ready) return { kind: 'rejected', reason: 'More than one root runtime endpoint is active.' };
      ready = { kind: 'ready', backend: kind };
    } catch (error) {
      if (error instanceof ExecutionCandidateHandshakeError) return { kind: 'rejected', reason: 'Runtime owner compatibility conflict.' };
      if (!['ECONNREFUSED', 'ENOENT'].includes((error as NodeJS.ErrnoException).code ?? '')) {
        return { kind: 'unconfirmed', reason: 'An existing runtime endpoint could not be confirmed.' };
      }
    } finally {
      clearTimeout(timer);
      client.dispose();
    }
  }
  return ready ?? { kind: 'absent' };
}

async function probeRuntimeUnowned(request: RootPreparationRequest): Promise<boolean> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [request.supervisorLauncherScriptPath,
      '--probe-root-runtime', '--storage-dir', request.storageDir, '--execution-profile', request.executionProfile], {
      timeout: 15_000, maxBuffer: 4096, encoding: 'utf8', windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', ELECTRON_NO_ATTACH_CONSOLE: '1' }
    });
    return stdout === 'root-runtime-unowned\n' && stderr === '';
  } catch { return false; }
}

function delay(ms: number): Promise<void> { return new Promise(resolve => setTimeout(resolve, ms)); }
