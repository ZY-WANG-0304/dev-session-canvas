import { spawn } from 'child_process';
import * as path from 'path';

import {
  RUNTIME_SUPERVISOR_ERROR_CODES,
  createRuntimeSupervisorProtocolError
} from '../common/runtimeSupervisorProtocol';

async function main(): Promise<void> {
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
