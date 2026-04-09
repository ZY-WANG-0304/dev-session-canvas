import { createHash } from 'crypto';
import * as os from 'os';
import * as path from 'path';

import type { RuntimeSupervisorPaths } from './runtimeSupervisorProtocol';

const MAX_UNIX_SOCKET_PATH_BYTES = 104;
const STORAGE_SOCKET_FILE_NAME = 'supervisor.sock';
const XDG_RUNTIME_SUBDIR_NAME = 'dev-session-canvas';
const TMP_RUNTIME_DIR_PREFIX = 'dev-session-canvas-';
const SHORT_TMP_RUNTIME_DIR_PREFIX = 'dsc-';

export interface RuntimeSupervisorPathResolutionOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  tmpDir?: string;
  userId?: number | string;
}

export function resolveRuntimeSupervisorPaths(
  baseStorageDir: string,
  options: RuntimeSupervisorPathResolutionOptions = {}
): RuntimeSupervisorPaths {
  return resolveRuntimeSupervisorPathsFromStorageDir(path.join(baseStorageDir, 'runtime-supervisor'), options);
}

export function resolveRuntimeSupervisorPathsFromStorageDir(
  storageDir: string,
  options: RuntimeSupervisorPathResolutionOptions = {}
): RuntimeSupervisorPaths {
  const platform = options.platform ?? process.platform;
  const registryPath = path.join(storageDir, 'registry.json');
  const digest = createHash('sha1').update(storageDir).digest('hex').slice(0, 24);

  if (platform === 'win32') {
    return {
      storageDir,
      socketPath: `\\\\.\\pipe\\dev-session-canvas-${digest}`,
      registryPath,
      socketLocation: 'named-pipe'
    };
  }

  const storageSocketPath = path.join(storageDir, STORAGE_SOCKET_FILE_NAME);
  if (isUnixSocketPathWithinLimit(storageSocketPath)) {
    return {
      storageDir,
      runtimeDir: storageDir,
      socketPath: storageSocketPath,
      registryPath,
      socketLocation: 'storage'
    };
  }

  const tmpDir = path.resolve(options.tmpDir ?? os.tmpdir());
  for (const runtimeDir of resolvePrivateRuntimeDirCandidates(options, tmpDir)) {
    const socketPath = path.join(runtimeDir, `supervisor-${digest}.sock`);
    if (!isUnixSocketPathWithinLimit(socketPath)) {
      continue;
    }

    return {
      storageDir,
      runtimeDir,
      socketPath,
      registryPath,
      socketLocation: 'runtime-private'
    };
  }

  return {
    storageDir,
    runtimeDir: tmpDir,
    socketPath: path.join(tmpDir, `${digest}.sock`),
    registryPath,
    socketLocation: 'runtime-fallback'
  };
}

function resolvePrivateRuntimeDirCandidates(
  options: RuntimeSupervisorPathResolutionOptions,
  tmpDir: string
): string[] {
  const env = options.env ?? process.env;
  const userId = normalizeUserId(options.userId ?? process.getuid?.());
  const candidates: string[] = [];
  const xdgRuntimeDir = normalizeAbsoluteDirectory(env.XDG_RUNTIME_DIR);
  if (xdgRuntimeDir) {
    candidates.push(path.join(xdgRuntimeDir, XDG_RUNTIME_SUBDIR_NAME));
  }

  candidates.push(path.join(tmpDir, `${TMP_RUNTIME_DIR_PREFIX}${userId}`));
  candidates.push(path.join(tmpDir, `${SHORT_TMP_RUNTIME_DIR_PREFIX}${userId}`));

  return Array.from(new Set(candidates));
}

function isUnixSocketPathWithinLimit(value: string): boolean {
  return Buffer.byteLength(value, 'utf8') <= MAX_UNIX_SOCKET_PATH_BYTES;
}

function normalizeAbsoluteDirectory(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized) {
    return undefined;
  }

  return path.isAbsolute(normalized) ? path.normalize(normalized) : undefined;
}

function normalizeUserId(value: number | string | undefined): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || 'shared';
}
