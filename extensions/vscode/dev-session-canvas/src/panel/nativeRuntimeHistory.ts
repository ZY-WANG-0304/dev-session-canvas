import * as fs from 'fs/promises';
import * as net from 'net';
import * as path from 'path';

import { EXECUTION_CANDIDATE_PROFILE } from '../common/executionLifecycle';
import { assertExecutionCandidateRuntimeSupervisorStorageDir,
  resolveLegacyRuntimeSupervisorPathsFromStorageDir } from '../common/runtimeSupervisorPaths';
import { acquireRuntimeSupervisorNamespace } from '../supervisor/runtimeSupervisorNamespace';
import { linuxRuntimeSocketAbsent, noLinuxRuntimeSupervisor } from './linuxRuntimeHistoryObservation';
import type { RuntimeHostBackend } from './runtimeHostBackend';

export async function inspectRetiredNativeRuntimeNamespace(
  backend: RuntimeHostBackend, signal?: AbortSignal
): Promise<'native-owner-absent' | undefined> {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (process.platform !== 'linux' || backend.kind !== 'legacy-detached' || signal?.aborted
    || !Number.isInteger(major) || !Number.isInteger(minor) || major < 20 || (major === 20 && minor < 8)
    || typeof process.getuid !== 'function') return undefined;
  let claim: net.Server | undefined;
  let absent = false;
  try {
    const storageDir = backend.paths.storageDir;
    if (!path.isAbsolute(storageDir) || path.resolve(storageDir) !== storageDir
      || await fs.realpath(storageDir) !== storageDir || signal?.aborted) return undefined;
    assertExecutionCandidateRuntimeSupervisorStorageDir(storageDir, EXECUTION_CANDIDATE_PROFILE);
    const expected = resolveLegacyRuntimeSupervisorPathsFromStorageDir(storageDir);
    if (['registryPath', 'socketPath', 'runtimeDir', 'socketLocation'].some(key =>
      backend.paths[key as keyof typeof expected] !== expected[key as keyof typeof expected])) return undefined;
    // No native fallback: its one-shot claim cannot be released by a temporary observer.
    claim = await acquireRuntimeSupervisorNamespace(storageDir);
    if (claim && !signal?.aborted && await linuxRuntimeSocketAbsent(backend.paths.socketPath, signal)
      && await noLinuxRuntimeSupervisor(storageDir, signal) && await linuxRuntimeSocketAbsent(backend.paths.socketPath, signal)
      && await fs.realpath(storageDir) === storageDir) absent = true;
  } catch {
    absent = false;
  } finally {
    if (claim) {
      try {
        await new Promise<void>((resolve, reject) => claim!.close(error => error ? reject(error) : resolve()));
      } catch {
        absent = false;
      }
    }
  }
  return absent && !signal?.aborted ? 'native-owner-absent' : undefined;
}
