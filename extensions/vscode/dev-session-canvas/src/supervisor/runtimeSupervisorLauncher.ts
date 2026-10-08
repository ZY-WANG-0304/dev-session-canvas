import { spawn } from 'child_process';
import * as path from 'path';

import { assertExecutionCandidateRuntimeSupervisorStorageDir } from '../common/runtimeSupervisorPaths';
import {
  RUNTIME_SUPERVISOR_ERROR_CODES,
  createRuntimeSupervisorProtocolError
} from '../common/runtimeSupervisorProtocol';

async function main(): Promise<void> {
  if (process.argv.includes('--probe-root-environment')) {
    const nonce = readCliFlag('--probe-root-environment');
    if (!nonce || !/^[a-f0-9-]{36}$/.test(nonce)) throw new Error('Invalid environment probe nonce.');
    const { readRuntimeExecutionEnvironment } = await import('../panel/runtimeExecutionEnvironment');
    const { createHash } = await import('crypto');
    const environment = await readRuntimeExecutionEnvironment();
    process.stdout.write(`${JSON.stringify({ schema: 1, nonce, environmentKey: environment.environmentKey,
      userIdentityKey: createHash('sha256').update(environment.userIdentity).digest('hex') })}\n`);
    return;
  }
  if (process.argv.includes('--prepare-root-runtime')) {
    if (!process.send || !process.connected) throw new Error('Root preparation requires a live Host IPC channel.');
    let accepted = false;
    const watchdog = setTimeout(() => process.exit(1), 30_000);
    process.once('message', async (request: import('../panel/runtimeRootSupervisorPreparation').RootPreparationRequest) => {
      accepted = true;
      try {
        const { prepareRuntimeRootSupervisor } = await import('./runtimeRootPreparation');
        const result = await prepareRuntimeRootSupervisor(request, () => !process.connected);
        if (process.connected) process.send!(result, () => process.exit(0));
        else process.exit(0);
      } catch { process.exit(1); }
    });
    process.once('disconnect', () => { if (!accepted) process.exit(0); });
    watchdog.unref();
    return;
  }
  if (process.argv.includes('--probe-root-runtime')) {
    const { claimRootRuntimeForProbe } = await import('./runtimeRootPreparation');
    await claimRootRuntimeForProbe(readCliPathFlag('--storage-dir')!, readCliFlag('--execution-profile'), path.dirname(__dirname));
    process.stdout.write('root-runtime-unowned\n', () => process.exit(0));
    return;
  }
  const supervisorScriptPath = readCliPathFlag('--supervisor-script');
  const storageDir = readCliPathFlag('--storage-dir');
  if (!supervisorScriptPath) {
    throw createRuntimeSupervisorProtocolError({
      id: 'launcherMissingSupervisorScript'
    }, RUNTIME_SUPERVISOR_ERROR_CODES.launcherMissingSupervisorScript);
  }

  if (!storageDir) {
    throw createRuntimeSupervisorProtocolError({
      id: 'launcherMissingStorageDir'
    }, RUNTIME_SUPERVISOR_ERROR_CODES.launcherMissingStorageDir);
  }

  const args = [supervisorScriptPath, '--storage-dir', storageDir];
  const socketPath = readCliPathFlag('--socket-path');
  if (socketPath) {
    args.push('--socket-path', socketPath);
  }

  const runtimeDir = readCliPathFlag('--runtime-dir');
  if (runtimeDir) {
    args.push('--runtime-dir', runtimeDir);
  }

  const controlDir = readCliPathFlag('--control-dir');
  if (controlDir) {
    args.push('--control-dir', controlDir);
  }

  const runtimeBackend = readCliFlag('--runtime-backend');
  if (runtimeBackend) {
    args.push('--runtime-backend', runtimeBackend);
  }

  const runtimeGuarantee = readCliFlag('--runtime-guarantee');
  if (runtimeGuarantee) {
    args.push('--runtime-guarantee', runtimeGuarantee);
  }

  const executionProfileIndex = process.argv.indexOf('--execution-profile');
  if (executionProfileIndex >= 0) {
    const executionProfile = process.argv[executionProfileIndex + 1];
    assertExecutionCandidateRuntimeSupervisorStorageDir(storageDir, executionProfile);
    args.push('--execution-profile', executionProfile);
  }

  const runtimeLaunchToken = readCliFlag('--runtime-launch-token');
  if (runtimeLaunchToken) {
    args.push('--runtime-launch-token', runtimeLaunchToken);
  }

  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  });
  child.unref();
}

function readCliFlag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) {
    return undefined;
  }

  const value = process.argv[index + 1];
  return value?.trim() || undefined;
}

function readCliPathFlag(name: string): string | undefined {
  const value = readCliFlag(name);
  return value ? path.resolve(value) : undefined;
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
