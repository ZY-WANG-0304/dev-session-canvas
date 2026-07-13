import { createHash } from 'crypto';
import * as os from 'os';
import * as path from 'path';

import {
  RUNTIME_SUPERVISOR_ERROR_CODES,
  createRuntimeSupervisorProtocolError,
  type RuntimeSupervisorPaths
} from './runtimeSupervisorProtocol';

const MAX_UNIX_SOCKET_PATH_BYTES = 104;
const STORAGE_SOCKET_FILE_NAME = 'supervisor.sock';
const SYSTEMD_CONTROL_SOCKET_FILE_NAME = 's.sock';
const XDG_RUNTIME_SUBDIR_NAME = 'dev-session-canvas';
const TMP_RUNTIME_DIR_PREFIX = 'dev-session-canvas-';
const SHORT_TMP_RUNTIME_DIR_PREFIX = 'dsc-';
const SHORT_FALLBACK_SOCKET_DIGEST_LENGTH = 16;
const SYSTEMD_STATE_SUBDIR = path.posix.join('dsc', 'rh');
const SYSTEMD_HOME_SUBDIR = path.posix.join('.dsc', 'rh');
const SYSTEMD_USER_SERVICE_PREFIX = 'dev-session-canvas-runtime-supervisor-';
const RUNTIME_SUPERVISOR_GENERATIONS_SUBDIR = 'runtime-supervisor-generations';

export const CURRENT_RUNTIME_SUPERVISOR_GENERATION = 'terminal-stream-v1';

type PathModuleLike = typeof path.posix | typeof path.win32;

export interface RuntimeSupervisorPathResolutionOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  tmpDir?: string;
  userId?: number | string;
  homeDir?: string;
}

export function resolveCurrentRuntimeSupervisorBaseStoragePath(baseStorageDir: string): string {
  return path.join(
    baseStorageDir,
    RUNTIME_SUPERVISOR_GENERATIONS_SUBDIR,
    CURRENT_RUNTIME_SUPERVISOR_GENERATION
  );
}

export function resolveRuntimeSupervisorPaths(
  baseStorageDir: string,
  options: RuntimeSupervisorPathResolutionOptions = {}
): RuntimeSupervisorPaths {
  return resolveLegacyRuntimeSupervisorPaths(baseStorageDir, options);
}

export function resolveRuntimeSupervisorPathsFromStorageDir(
  storageDir: string,
  options: RuntimeSupervisorPathResolutionOptions = {}
): RuntimeSupervisorPaths {
  return resolveLegacyRuntimeSupervisorPathsFromStorageDir(storageDir, options);
}

export function resolveLegacyRuntimeSupervisorPaths(
  baseStorageDir: string,
  options: RuntimeSupervisorPathResolutionOptions = {}
): RuntimeSupervisorPaths {
  return resolveLegacyRuntimeSupervisorPathsFromStorageDir(
    path.join(baseStorageDir, 'runtime-supervisor'),
    options
  );
}

export function resolveLegacyRuntimeSupervisorPathsFromStorageDir(
  storageDir: string,
  options: RuntimeSupervisorPathResolutionOptions = {}
): RuntimeSupervisorPaths {
  const platform = options.platform ?? process.platform;
  const pathModule = resolveRuntimeSupervisorPathModule(platform);
  const registryPath = pathModule.join(storageDir, 'registry.json');
  const digest = createHash('sha1').update(storageDir).digest('hex').slice(0, 24);

  if (platform === 'win32') {
    return {
      storageDir,
      socketPath: `\\\\.\\pipe\\dev-session-canvas-${digest}`,
      registryPath,
      socketLocation: 'named-pipe'
    };
  }

  const storageSocketPath = pathModule.join(storageDir, STORAGE_SOCKET_FILE_NAME);
  if (isUnixSocketPathWithinLimit(storageSocketPath)) {
    return {
      storageDir,
      runtimeDir: storageDir,
      socketPath: storageSocketPath,
      registryPath,
      socketLocation: 'storage'
    };
  }

  const tmpDir = pathModule.resolve(options.tmpDir ?? os.tmpdir());
  for (const runtimeDir of resolvePrivateRuntimeDirCandidates(options, platform, pathModule, tmpDir)) {
    for (const socketFileName of resolveLegacyRuntimePrivateSocketFileNames(digest)) {
      const socketPath = pathModule.join(runtimeDir, socketFileName);
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
  }

  for (const runtimeDir of resolveFallbackRuntimeDirCandidates(options, platform, pathModule, tmpDir)) {
    for (const socketFileName of resolveLegacyRuntimeFallbackSocketFileNames(digest)) {
      const socketPath = pathModule.join(runtimeDir, socketFileName);
      if (!isUnixSocketPathWithinLimit(socketPath)) {
        continue;
      }

      return {
        storageDir,
        runtimeDir,
        socketPath,
        registryPath,
        socketLocation: 'runtime-fallback'
      };
    }
  }

  throw createRuntimeSupervisorProtocolError({
    id: 'legacySocketPathUnavailable'
  }, RUNTIME_SUPERVISOR_ERROR_CODES.legacySocketPathUnavailable);
}

export function resolveSystemdUserRuntimeSupervisorPaths(
  baseStorageDir: string,
  options: RuntimeSupervisorPathResolutionOptions = {}
): RuntimeSupervisorPaths {
  return resolveSystemdUserRuntimeSupervisorPathsFromStorageDir(
    path.join(baseStorageDir, 'runtime-supervisor'),
    options
  );
}

export function resolveSystemdUserRuntimeSupervisorPathsFromStorageDir(
  storageDir: string,
  options: RuntimeSupervisorPathResolutionOptions = {}
): RuntimeSupervisorPaths {
  const platform = options.platform ?? process.platform;
  if (platform === 'win32') {
    throw createRuntimeSupervisorProtocolError({
      id: 'systemdUserUnsupportedOnWindows'
    }, RUNTIME_SUPERVISOR_ERROR_CODES.systemdUserUnsupportedOnWindows);
  }

  const pathModule = resolveRuntimeSupervisorPathModule(platform);
  const digest = createHash('sha1').update(storageDir).digest('hex').slice(0, 24);
  const registryPath = pathModule.join(storageDir, 'registry.json');
  const homeDir = resolveHomeDirectory(options, pathModule);
  const configHome = resolveConfigHome(options, pathModule, homeDir);
  const controlPath = resolveSystemdControlPath(options, pathModule, homeDir, digest);

  return {
    storageDir,
    controlDir: controlPath.controlDir,
    socketPath: controlPath.socketPath,
    registryPath,
    socketLocation: 'control-dir',
    unitName: `${SYSTEMD_USER_SERVICE_PREFIX}${digest}.service`,
    unitFilePath: pathModule.join(
      configHome,
      'systemd',
      'user',
      `${SYSTEMD_USER_SERVICE_PREFIX}${digest}.service`
    )
  };
}

function resolvePrivateRuntimeDirCandidates(
  options: RuntimeSupervisorPathResolutionOptions,
  platform: NodeJS.Platform,
  pathModule: PathModuleLike,
  tmpDir: string
): string[] {
  const env = options.env ?? process.env;
  const userId = normalizeUserId(options.userId ?? process.getuid?.());
  const candidates: string[] = [];
  const xdgRuntimeDir = normalizeAbsoluteDirectory(env.XDG_RUNTIME_DIR, pathModule);
  if (xdgRuntimeDir) {
    candidates.push(pathModule.join(xdgRuntimeDir, XDG_RUNTIME_SUBDIR_NAME));
  }

  candidates.push(pathModule.join(tmpDir, `${TMP_RUNTIME_DIR_PREFIX}${userId}`));
  candidates.push(pathModule.join(tmpDir, `${SHORT_TMP_RUNTIME_DIR_PREFIX}${userId}`));

  return Array.from(new Set(candidates));
}

function resolveLegacyRuntimePrivateSocketFileNames(digest: string): string[] {
  return Array.from(
    new Set([
      `supervisor-${digest}.sock`,
      `${digest}.sock`,
      `${digest.slice(0, SHORT_FALLBACK_SOCKET_DIGEST_LENGTH)}.sock`
    ])
  );
}

function resolveLegacyRuntimeFallbackSocketFileNames(digest: string): string[] {
  return Array.from(
    new Set([
      `${digest}.sock`,
      `${digest.slice(0, SHORT_FALLBACK_SOCKET_DIGEST_LENGTH)}.sock`
    ])
  );
}

function resolveFallbackRuntimeDirCandidates(
  options: RuntimeSupervisorPathResolutionOptions,
  platform: NodeJS.Platform,
  pathModule: PathModuleLike,
  tmpDir: string
): string[] {
  const candidates = [tmpDir];
  if (platform !== 'win32') {
    candidates.push('/tmp', '/private/tmp', '/var/tmp');
  }

  const homeDir = resolveHomeDirectory(options, pathModule);
  candidates.push(pathModule.join(homeDir, '.dsc'));
  return Array.from(new Set(candidates.map((candidate) => pathModule.resolve(candidate))));
}

function resolveSystemdControlPath(
  options: RuntimeSupervisorPathResolutionOptions,
  pathModule: PathModuleLike,
  homeDir: string,
  digest: string
): { controlDir: string; socketPath: string } {
  const stateHome = resolveStateHome(options, pathModule, homeDir);
  const candidates = [
    {
      controlDir: pathModule.join(stateHome, SYSTEMD_STATE_SUBDIR, digest),
      socketName: SYSTEMD_CONTROL_SOCKET_FILE_NAME
    },
    {
      controlDir: pathModule.join(homeDir, SYSTEMD_HOME_SUBDIR, digest),
      socketName: SYSTEMD_CONTROL_SOCKET_FILE_NAME
    },
    {
      controlDir: pathModule.join(homeDir, '.dsc'),
      socketName: `${digest}.sock`
    }
  ];

  for (const candidate of candidates) {
    const socketPath = pathModule.join(candidate.controlDir, candidate.socketName);
    if (!isUnixSocketPathWithinLimit(socketPath)) {
      continue;
    }

    return {
      controlDir: candidate.controlDir,
      socketPath
    };
  }

  throw createRuntimeSupervisorProtocolError({
    id: 'systemdControlPathUnavailable'
  }, RUNTIME_SUPERVISOR_ERROR_CODES.systemdControlPathUnavailable);
}

function resolveHomeDirectory(options: RuntimeSupervisorPathResolutionOptions, pathModule: PathModuleLike): string {
  const configuredHome = normalizeAbsoluteDirectory(options.homeDir, pathModule);
  if (configuredHome) {
    return configuredHome;
  }

  const homeDir = normalizeAbsoluteDirectory(os.homedir(), pathModule);
  if (!homeDir) {
    throw createRuntimeSupervisorProtocolError({
      id: 'homeDirectoryUnavailable'
    }, RUNTIME_SUPERVISOR_ERROR_CODES.homeDirectoryUnavailable);
  }

  return homeDir;
}

function resolveConfigHome(
  options: RuntimeSupervisorPathResolutionOptions,
  pathModule: PathModuleLike,
  homeDir: string
): string {
  const env = options.env ?? process.env;
  return normalizeAbsoluteDirectory(env.XDG_CONFIG_HOME, pathModule) ?? pathModule.join(homeDir, '.config');
}

function resolveStateHome(
  options: RuntimeSupervisorPathResolutionOptions,
  pathModule: PathModuleLike,
  homeDir: string
): string {
  const env = options.env ?? process.env;
  return normalizeAbsoluteDirectory(env.XDG_STATE_HOME, pathModule) ?? pathModule.join(homeDir, '.local', 'state');
}

function isUnixSocketPathWithinLimit(value: string): boolean {
  return Buffer.byteLength(value, 'utf8') <= MAX_UNIX_SOCKET_PATH_BYTES;
}

function normalizeAbsoluteDirectory(value: string | undefined, pathModule: PathModuleLike): string | undefined {
  const normalized = value?.trim();
  if (!normalized) {
    return undefined;
  }

  return pathModule.isAbsolute(normalized) ? pathModule.normalize(normalized) : undefined;
}

function resolveRuntimeSupervisorPathModule(platform: NodeJS.Platform): PathModuleLike {
  return platform === 'win32' ? path.win32 : path.posix;
}

function normalizeUserId(value: number | string | undefined): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || 'shared';
}
