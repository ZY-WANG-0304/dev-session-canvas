import { createHash } from 'crypto';
import * as path from 'path';

import {
  EXECUTION_CANDIDATE_BUDGETS,
  EXECUTION_CANDIDATE_PROFILE,
  EXECUTION_INTERACTION_LIMITS,
  EXECUTION_PRODUCTION_ADMISSION,
  MACOS_EXECUTION_CANDIDATE_PROFILE,
  S1_LIMITS,
  WINDOWS_EXECUTION_CANDIDATE_PROFILE,
  assertExecutionCandidateProfile,
  normalizeExecutionAdmissionLimits,
  type ExecutionAdmissionLimits,
  type ExecutionCandidateProfile
} from './executionLifecycle';

const ROOT_STORAGE_SUBDIR = 'runtime-roots-v1';
const GENERATIONS_SUBDIR = 'runtime-supervisor-generations';
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;

const ROOT_GENERATIONS = Object.freeze({
  [EXECUTION_CANDIDATE_PROFILE]: 'terminal-root-owner-linux-v1',
  [MACOS_EXECUTION_CANDIDATE_PROFILE]: 'terminal-root-owner-macos-v1',
  [WINDOWS_EXECUTION_CANDIDATE_PROFILE]: 'terminal-root-owner-windows-v1'
} as const);

export interface RuntimeOwnerDescriptorV1 {
  readonly schema: 1;
  readonly environmentKey: string;
  readonly userStorageScopeKey: string;
  readonly root: Readonly<{
    kind: 'folder';
    pathPolicy: 'canvas-path-v1';
    normalizedPath: string;
  }>;
  readonly generation: string;
}

export function resolveRootRuntimeSupervisorGeneration(profile: ExecutionCandidateProfile): string {
  assertExecutionCandidateProfile(profile);
  return ROOT_GENERATIONS[profile];
}

export function resolveRootRuntimeSupervisorProfileFromGeneration(generation: unknown): ExecutionCandidateProfile | undefined {
  return (Object.keys(ROOT_GENERATIONS) as ExecutionCandidateProfile[])
    .find(profile => ROOT_GENERATIONS[profile] === generation);
}

export function createRuntimeOwnerDescriptor(input: {
  environmentKey: string;
  userStorageScopeKey: string;
  rootPath: string;
  generation: string;
  platform?: NodeJS.Platform;
}): RuntimeOwnerDescriptorV1 {
  const platform = resolveGenerationPlatform(input.generation);
  if (input.platform !== undefined && input.platform !== platform) {
    throw new Error('Runtime owner generation does not match its execution platform.');
  }
  return parseRuntimeOwnerDescriptor({
    schema: 1,
    environmentKey: input.environmentKey,
    userStorageScopeKey: input.userStorageScopeKey,
    root: { kind: 'folder', pathPolicy: 'canvas-path-v1', normalizedPath: normalizeAbsolutePath(input.rootPath, platform) },
    generation: input.generation
  });
}

export function parseRuntimeOwnerDescriptor(value: unknown): RuntimeOwnerDescriptorV1 {
  assertRuntimeOwnerDescriptor(value);
  return {
    schema: 1,
    environmentKey: value.environmentKey,
    userStorageScopeKey: value.userStorageScopeKey,
    root: { kind: 'folder', pathPolicy: 'canvas-path-v1', normalizedPath: value.root.normalizedPath },
    generation: value.generation
  };
}

export function isRuntimeOwnerDescriptor(value: unknown): value is RuntimeOwnerDescriptorV1 {
  try {
    assertRuntimeOwnerDescriptor(value);
    return true;
  } catch {
    return false;
  }
}

export function assertRuntimeOwnerDescriptor(value: unknown): asserts value is RuntimeOwnerDescriptorV1 {
  if (!hasExactDataFields(value, ['schema', 'environmentKey', 'userStorageScopeKey', 'root', 'generation']) ||
      value.schema !== 1 || typeof value.environmentKey !== 'string' || !DIGEST_PATTERN.test(value.environmentKey) ||
      typeof value.userStorageScopeKey !== 'string' || !DIGEST_PATTERN.test(value.userStorageScopeKey) ||
      !hasExactDataFields(value.root, ['kind', 'pathPolicy', 'normalizedPath']) ||
      value.root.kind !== 'folder' || value.root.pathPolicy !== 'canvas-path-v1' ||
      typeof value.root.normalizedPath !== 'string' || typeof value.generation !== 'string') {
    throw new Error('Invalid runtime owner descriptor.');
  }
  const platform = resolveGenerationPlatform(value.generation);
  if (normalizeAbsolutePath(value.root.normalizedPath, platform) !== value.root.normalizedPath) {
    throw new Error('Runtime owner root path must already be normalized.');
  }
}

export function runtimeOwnerDescriptorsEqual(left: unknown, right: unknown): boolean {
  return isRuntimeOwnerDescriptor(left) && isRuntimeOwnerDescriptor(right) &&
    left.schema === right.schema && left.environmentKey === right.environmentKey &&
    left.userStorageScopeKey === right.userStorageScopeKey && left.root.kind === right.root.kind &&
    left.root.pathPolicy === right.root.pathPolicy && left.root.normalizedPath === right.root.normalizedPath &&
    left.generation === right.generation;
}

export function createRuntimeUserStorageScopeKey(
  userIdentity: string,
  canonicalGlobalStoragePath: string,
  platform: NodeJS.Platform = process.platform
): string {
  if (typeof userIdentity !== 'string' || !userIdentity.trim() || userIdentity.includes('\0')) {
    throw new Error('Runtime owner requires a known OS user identity.');
  }
  return digest(['runtime-user-storage-scope-v1', userIdentity, normalizeAbsolutePath(canonicalGlobalStoragePath, platform)]);
}

export function resolveRuntimeRootOwnerBaseStoragePath(
  canonicalGlobalStoragePath: string,
  descriptor: RuntimeOwnerDescriptorV1,
  platform: NodeJS.Platform = process.platform
): string {
  assertRuntimeOwnerDescriptor(descriptor);
  if (resolveGenerationPlatform(descriptor.generation) !== platform) {
    throw new Error('Runtime owner generation does not match its execution platform.');
  }
  const rootKey = digest(['runtime-root-v1', descriptor.root.kind, descriptor.root.pathPolicy, descriptor.root.normalizedPath]);
  return pathModule(platform).join(normalizeAbsolutePath(canonicalGlobalStoragePath, platform), ROOT_STORAGE_SUBDIR,
    descriptor.environmentKey, rootKey, GENERATIONS_SUBDIR, descriptor.generation);
}

export function resolveRuntimeRootOwnerGlobalStoragePath(
  storageDir: string,
  descriptor: RuntimeOwnerDescriptorV1,
  platform: NodeJS.Platform = process.platform
): string {
  const paths = pathModule(platform);
  const normalizedStorageDir = normalizeAbsolutePath(storageDir, platform);
  const globalStoragePath = paths.resolve(normalizedStorageDir, '..', '..', '..', '..', '..', '..');
  const expectedStorageDir = paths.join(resolveRuntimeRootOwnerBaseStoragePath(globalStoragePath, descriptor, platform),
    'runtime-supervisor');
  if (normalizedStorageDir !== expectedStorageDir) {
    throw new Error('Runtime owner storage directory does not match its descriptor.');
  }
  return globalStoragePath;
}

export function createRuntimeOwnerCompatibilityFingerprint(
  generation: string,
  profile: ExecutionCandidateProfile,
  admission: ExecutionAdmissionLimits = EXECUTION_PRODUCTION_ADMISSION
): string {
  if (resolveRootRuntimeSupervisorGeneration(profile) !== generation) {
    throw new Error('Runtime owner generation does not match its execution profile.');
  }
  const normalized = normalizeExecutionAdmissionLimits(admission);
  return digest(['runtime-root-owner-compatibility-v1', generation, profile, 1,
    [normalized.executions, normalized.starting, normalized.pending ?? null],
    EXECUTION_CANDIDATE_BUDGETS, EXECUTION_INTERACTION_LIMITS, S1_LIMITS]);
}

function resolveGenerationPlatform(generation: string): NodeJS.Platform {
  switch (resolveRootRuntimeSupervisorProfileFromGeneration(generation)) {
    case EXECUTION_CANDIDATE_PROFILE: return 'linux';
    case MACOS_EXECUTION_CANDIDATE_PROFILE: return 'darwin';
    case WINDOWS_EXECUTION_CANDIDATE_PROFILE: return 'win32';
    default: throw new Error('Unsupported runtime root owner generation.');
  }
}

function normalizeAbsolutePath(value: string, platform: NodeJS.Platform): string {
  const paths = pathModule(platform);
  if (typeof value !== 'string' || !value || value.includes('\0') || !paths.isAbsolute(value) ||
      (platform === 'win32' && !/^(?:[a-z]:[\\/]|[\\/]{2}[^\\/]+[\\/][^\\/]+(?:[\\/]|$))/i.test(value))) {
    throw new Error('Runtime owner requires an absolute filesystem path.');
  }
  // Match root-local canvas identity: lexical resolution, with Windows case folding only.
  const normalized = paths.resolve(value);
  return platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function pathModule(platform: NodeJS.Platform): typeof path.posix | typeof path.win32 {
  if (platform !== 'linux' && platform !== 'darwin' && platform !== 'win32') {
    throw new Error('Unsupported runtime root owner platform.');
  }
  return platform === 'win32' ? path.win32 : path.posix;
}

function hasExactDataFields(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) return false;
  const keys = Reflect.ownKeys(value);
  return keys.length === fields.length && keys.every(key => {
    const field = Object.getOwnPropertyDescriptor(value, key);
    return typeof key === 'string' && fields.includes(key) && field?.enumerable && 'value' in field;
  });
}

function digest(value: readonly unknown[]): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
