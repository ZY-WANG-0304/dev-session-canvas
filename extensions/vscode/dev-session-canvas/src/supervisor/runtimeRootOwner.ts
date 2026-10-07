import * as fs from 'fs/promises';
import * as path from 'path';

import type { ExecutionCandidateProfile } from '../common/executionLifecycle';
import {
  assertRuntimeOwnerDescriptor,
  createRuntimeUserStorageScopeKey,
  resolveRuntimeRootOwnerGlobalStoragePath,
  type RuntimeOwnerDescriptorV1
} from '../common/runtimeRootOwnership';
import {
  isRootOwnerRuntimeSupervisorStorageDir,
  isRuntimeRootStorageNamespace,
  resolveRootRuntimeSupervisorExecutionProfile
} from '../common/runtimeSupervisorPaths';
import { readRuntimeExecutionEnvironment } from '../panel/runtimeExecutionEnvironment';

export async function readRuntimeRootOwner(
  storageDir: string,
  executionProfile: ExecutionCandidateProfile | undefined
): Promise<RuntimeOwnerDescriptorV1 | undefined> {
  if (!isRootOwnerRuntimeSupervisorStorageDir(storageDir)) {
    if (isRuntimeRootStorageNamespace(storageDir)) {
      throw new Error('Reserved root runtime storage requires a supported root owner generation.');
    }
    try {
      const canonicalStorageDir = await fs.realpath(storageDir);
      if (isRuntimeRootStorageNamespace(canonicalStorageDir) || isRootOwnerRuntimeSupervisorStorageDir(canonicalStorageDir)) {
        throw new Error('Root runtime owner cannot be opened through a legacy storage alias.');
      }
    } catch (error) {
      if (!(error instanceof Error) || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return undefined;
  }
  if (executionProfile === undefined || resolveRootRuntimeSupervisorExecutionProfile(storageDir) !== executionProfile) {
    throw new Error('Root runtime owner requires its matching execution profile.');
  }

  const baseStoragePath = path.dirname(path.resolve(storageDir));
  const canonicalBaseStoragePath = await fs.realpath(baseStoragePath);
  if (!samePath(canonicalBaseStoragePath, baseStoragePath)) {
    throw new Error('Root runtime owner generation must use its canonical storage path.');
  }
  assertPrivateStorage(await fs.stat(baseStoragePath), 0o700);
  const ownerPath = path.join(baseStoragePath, 'owner.json');
  const ownerStat = await fs.lstat(ownerPath);
  if (!ownerStat.isFile() || ownerStat.size > 16 * 1024) {
    throw new Error('Root runtime owner descriptor must be a bounded regular file.');
  }
  assertPrivateStorage(ownerStat, 0o600);
  const descriptor: unknown = JSON.parse(await fs.readFile(ownerPath, 'utf8'));
  assertRuntimeOwnerDescriptor(descriptor);
  const globalStoragePath = resolveRuntimeRootOwnerGlobalStoragePath(storageDir, descriptor);
  const canonicalGlobalStoragePath = await fs.realpath(globalStoragePath);
  if (!samePath(globalStoragePath, canonicalGlobalStoragePath)) {
    throw new Error('Root runtime owner must belong to canonical global storage.');
  }
  await fs.access(canonicalGlobalStoragePath, fs.constants.R_OK | fs.constants.W_OK);
  const environment = await readRuntimeExecutionEnvironment();
  if (descriptor.environmentKey !== environment.environmentKey) {
    throw new Error('Root runtime owner execution environment does not match this process.');
  }
  if (descriptor.userStorageScopeKey !== createRuntimeUserStorageScopeKey(
    environment.userIdentity, canonicalGlobalStoragePath
  )) {
    throw new Error('Root runtime owner user storage scope does not match this process.');
  }

  // Validate existing session storage before the caller can claim or clean it.
  try {
    const canonicalStorageDir = await fs.realpath(storageDir);
    if (!samePath(canonicalStorageDir, storageDir)) {
      throw new Error('Root runtime owner session storage must not redirect to another directory.');
    }
    assertPrivateStorage(await fs.stat(storageDir), 0o700);
  } catch (error) {
    if (!(error instanceof Error) || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return Object.freeze({ ...descriptor, root: Object.freeze({ ...descriptor.root }) });
}

function assertPrivateStorage(stat: { uid: number; mode: number }, mode: number): void {
  if (process.platform === 'win32') return;
  if (typeof process.getuid !== 'function' || stat.uid !== process.getuid() || (stat.mode & 0o777) !== mode) {
    throw new Error('Root runtime owner storage must be private to the current OS user.');
  }
}

function samePath(left: string, right: string): boolean {
  return process.platform === 'win32'
    ? path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase()
    : path.resolve(left) === path.resolve(right);
}
