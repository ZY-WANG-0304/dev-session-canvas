import { createHash } from 'crypto';
import * as os from 'os';
import * as path from 'path';

import type { RuntimeSupervisorPaths } from './runtimeSupervisorProtocol';

const MAX_UNIX_SOCKET_PATH_BYTES = 104;
const STORAGE_SOCKET_FILE_NAME = 'supervisor.sock';
const SYSTEMD_CONTROL_SOCKET_FILE_NAME = 's.sock';
const XDG_RUNTIME_SUBDIR_NAME = 'dev-session-canvas';
const TMP_RUNTIME_DIR_PREFIX = 'dev-session-canvas-';
const SHORT_TMP_RUNTIME_DIR_PREFIX = 'dsc-';
const SYSTEMD_STATE_SUBDIR = path.join('dsc', 'rh');
const SYSTEMD_HOME_SUBDIR = path.join('.dsc', 'rh');
const SYSTEMD_USER_SERVICE_PREFIX = 'dev-session-canvas-runtime-supervisor-';

export interface RuntimeSupervisorPathResolutionOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  tmpDir?: string;
  userId?: number | string;
  homeDir?: string;
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
    throw new Error('systemd-user backend 不支持 Windows。');
  }

  const digest = createHash('sha1').update(storageDir).digest('hex').slice(0, 24);
  const registryPath = path.join(storageDir, 'registry.json');
  const homeDir = resolveHomeDirectory(options);
  const configHome = resolveConfigHome(options, homeDir);
  const controlPath = resolveSystemdControlPath(options, homeDir, digest);

  return {
    storageDir,
    controlDir: controlPath.controlDir,
    socketPath: controlPath.socketPath,
    registryPath,
    socketLocation: 'control-dir',
    unitName: `${SYSTEMD_USER_SERVICE_PREFIX}${digest}.service`,
    unitFilePath: path.join(
      configHome,
      'systemd',
      'user',
      `${SYSTEMD_USER_SERVICE_PREFIX}${digest}.service`
    )
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

function resolveSystemdControlPath(
  options: RuntimeSupervisorPathResolutionOptions,
  homeDir: string,
  digest: string
): { controlDir: string; socketPath: string } {
  const stateHome = resolveStateHome(options, homeDir);
  const candidates = [
    {
      controlDir: path.join(stateHome, SYSTEMD_STATE_SUBDIR, digest),
      socketName: SYSTEMD_CONTROL_SOCKET_FILE_NAME
    },
    {
      controlDir: path.join(homeDir, SYSTEMD_HOME_SUBDIR, digest),
      socketName: SYSTEMD_CONTROL_SOCKET_FILE_NAME
    },
    {
      controlDir: path.join(homeDir, '.dsc'),
      socketName: `${digest}.sock`
    }
  ];

  for (const candidate of candidates) {
    const socketPath = path.join(candidate.controlDir, candidate.socketName);
    if (!isUnixSocketPathWithinLimit(socketPath)) {
      continue;
    }

    return {
      controlDir: candidate.controlDir,
      socketPath
    };
  }

  throw new Error('无法为 systemd-user backend 生成符合 Unix socket 限制的控制路径。');
}

function resolveHomeDirectory(options: RuntimeSupervisorPathResolutionOptions): string {
  const configuredHome = normalizeAbsoluteDirectory(options.homeDir);
  if (configuredHome) {
    return configuredHome;
  }

  const homeDir = normalizeAbsoluteDirectory(os.homedir());
  if (!homeDir) {
    throw new Error('无法解析当前用户目录，无法初始化 runtime host backend。');
  }

  return homeDir;
}

function resolveConfigHome(
  options: RuntimeSupervisorPathResolutionOptions,
  homeDir: string
): string {
  const env = options.env ?? process.env;
  return normalizeAbsoluteDirectory(env.XDG_CONFIG_HOME) ?? path.join(homeDir, '.config');
}

function resolveStateHome(
  options: RuntimeSupervisorPathResolutionOptions,
  homeDir: string
): string {
  const env = options.env ?? process.env;
  return normalizeAbsoluteDirectory(env.XDG_STATE_HOME) ?? path.join(homeDir, '.local', 'state');
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
