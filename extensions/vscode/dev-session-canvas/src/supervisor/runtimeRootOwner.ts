import { randomUUID } from 'crypto';
import { constants } from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';

import type { ExecutionCandidateProfile } from '../common/executionLifecycle';
import {
  assertRuntimeOwnerDescriptor,
  createRuntimeUserStorageScopeKey,
  parseRuntimeOwnerDescriptor,
  resolveRuntimeRootOwnerGlobalStoragePath,
  runtimeOwnerDescriptorsEqual,
  type RuntimeOwnerDescriptorV1
} from '../common/runtimeRootOwnership';
import {
  isRootOwnerRuntimeSupervisorStorageDir,
  isRuntimeRootStorageNamespace,
  resolveRootRuntimeSupervisorExecutionProfile
} from '../common/runtimeSupervisorPaths';
import { readRuntimeExecutionEnvironment } from '../panel/runtimeExecutionEnvironment';

const MAX_OWNER_BYTES = 16 * 1024;

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

export async function prepareRuntimeRootOwnerDirectories(
  storageDir: string,
  owner: RuntimeOwnerDescriptorV1
): Promise<{ preparationDir: string }> {
  const descriptor = parseRuntimeOwnerDescriptor(owner);
  const globalStoragePath = resolveRuntimeRootOwnerGlobalStoragePath(storageDir, descriptor);
  if (!samePath(await fs.realpath(globalStoragePath), globalStoragePath)) {
    throw new Error('Root runtime owner must belong to canonical global storage.');
  }
  const globalStat = await fs.lstat(globalStoragePath);
  if (!globalStat.isDirectory() || (process.platform !== 'win32' &&
      (globalStat.uid !== process.getuid?.() || (globalStat.mode & 0o022) !== 0))) {
    throw new Error('Root runtime global storage must be owned by the current OS user and not writable by others.');
  }
  await fs.access(globalStoragePath, constants.R_OK | constants.W_OK);
  const environment = await readRuntimeExecutionEnvironment();
  if (descriptor.environmentKey !== environment.environmentKey ||
      descriptor.userStorageScopeKey !== createRuntimeUserStorageScopeKey(environment.userIdentity, globalStoragePath)) {
    throw new Error('Root runtime owner does not match this execution environment and user storage scope.');
  }

  const baseStoragePath = path.dirname(path.resolve(storageDir));
  let directory = globalStoragePath;
  for (const component of path.relative(globalStoragePath, baseStoragePath).split(path.sep)) {
    directory = path.join(directory, component);
    await ensurePrivateOwnerDirectory(directory);
  }
  await ensurePrivateOwnerDirectory(path.join(baseStoragePath, 'runtime-supervisor'));
  const preparationDir = path.join(baseStoragePath, 'startup-preparation');
  await ensurePrivateOwnerDirectory(preparationDir);
  return { preparationDir };
}

// The caller holds the preparation claim throughout publication and subsequent startup submission.
export async function publishRuntimeRootOwner(storageDir: string, owner: RuntimeOwnerDescriptorV1): Promise<void> {
  const descriptor = parseRuntimeOwnerDescriptor(owner);
  await prepareRuntimeRootOwnerDirectories(storageDir, descriptor);
  const filename = path.join(path.dirname(path.resolve(storageDir)), 'owner.json');
  const existing = await readPublishedOwner(filename);
  if (existing !== undefined) {
    if (!runtimeOwnerDescriptorsEqual(existing, descriptor)) throw new Error('Existing runtime owner descriptor does not match.');
    return;
  }
  const encoded = JSON.stringify(descriptor);
  if (Buffer.byteLength(encoded) > MAX_OWNER_BYTES) throw new Error('Runtime owner descriptor exceeds its byte limit.');
  const temporary = `${filename}.${randomUUID()}.tmp`;
  const handle = await fs.open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(encoded, 'utf8');
    await handle.sync();
    await handle.close();
    await fs.rename(temporary, filename);
  } finally {
    await handle.close();
    await fs.rm(temporary, { force: true });
  }
}

async function ensurePrivateOwnerDirectory(directory: string): Promise<void> {
  try { await fs.mkdir(directory, { mode: 0o700 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory()) throw new Error('Runtime owner directory must not be a symlink or another file type.');
  assertPrivateStorage(stat, 0o700);
  if (process.platform !== 'win32' && (stat.mode & 0o7000) !== 0) {
    throw new Error('Runtime owner directory must not have special permission bits.');
  }
}

async function readPublishedOwner(filename: string): Promise<RuntimeOwnerDescriptorV1 | undefined> {
  let handle: fs.FileHandle | undefined;
  try {
    const before = await fs.lstat(filename);
    if (!before.isFile() || before.nlink !== 1 || before.size > MAX_OWNER_BYTES) {
      throw new Error('Runtime owner descriptor must be a bounded regular private file.');
    }
    assertPrivateStorage(before, 0o600);
    if (process.platform !== 'win32' && (before.mode & 0o7000) !== 0) {
      throw new Error('Runtime owner descriptor must not have special permission bits.');
    }
    handle = await fs.open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = await handle.stat();
    if (opened.dev !== before.dev || opened.ino !== before.ino) throw new Error('Runtime owner descriptor changed while opening.');
    const buffer = Buffer.alloc(MAX_OWNER_BYTES + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await handle.read(buffer, size, buffer.length - size, size);
      if (bytesRead === 0) break;
      size += bytesRead;
    }
    if (size > MAX_OWNER_BYTES) throw new Error('Runtime owner descriptor exceeds its byte limit.');
    return parseRuntimeOwnerDescriptor(JSON.parse(buffer.toString('utf8', 0, size)));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  } finally {
    await handle?.close();
  }
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
