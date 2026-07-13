import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import esbuild from 'esbuild';

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'dsc-runtime-supervisor-paths-'));
const posixPath = path.posix;

try {
  const outfile = path.join(tempDir, 'runtimeSupervisorPaths.cjs');
  await esbuild.build({
    entryPoints: [path.resolve('extensions/vscode/dev-session-canvas/src/common/runtimeSupervisorPaths.ts')],
    bundle: true,
    format: 'cjs',
    outfile,
    platform: 'node',
    target: 'node18'
  });

  const require = createRequire(import.meta.url);
  const {
    CURRENT_RUNTIME_SUPERVISOR_GENERATION,
    resolveCurrentRuntimeSupervisorBaseStoragePath,
    resolveRuntimeSupervisorPathsFromStorageDir,
    resolveSystemdUserRuntimeSupervisorPathsFromStorageDir
  } = require(outfile);

  const shortStorageDir = '/tmp/dev-session-canvas/runtime-supervisor';
  const shortPaths = resolveRuntimeSupervisorPathsFromStorageDir(shortStorageDir, {
    platform: 'linux',
    env: {},
    tmpDir: '/tmp',
    userId: 1000
  });
  assert.equal(shortPaths.storageDir, shortStorageDir);
  assert.equal(shortPaths.runtimeDir, shortStorageDir);
  assert.equal(shortPaths.socketLocation, 'storage');
  assert.equal(shortPaths.socketPath, posixPath.join(shortStorageDir, 'supervisor.sock'));
  assert.equal(shortPaths.registryPath, posixPath.join(shortStorageDir, 'registry.json'));

  const extensionStorageDir = '/tmp/dev-session-canvas/workspace-storage';
  const currentGenerationBase = resolveCurrentRuntimeSupervisorBaseStoragePath(extensionStorageDir);
  const currentGenerationStorageDir = posixPath.join(currentGenerationBase, 'runtime-supervisor');
  assert.equal(CURRENT_RUNTIME_SUPERVISOR_GENERATION, 'terminal-stream-v1');
  assert.equal(
    currentGenerationBase,
    posixPath.join(extensionStorageDir, 'runtime-supervisor-generations', 'terminal-stream-v1')
  );
  const currentGenerationPaths = resolveRuntimeSupervisorPathsFromStorageDir(currentGenerationStorageDir, {
    platform: 'linux',
    env: {},
    tmpDir: '/tmp',
    userId: 1000
  });
  assert.notEqual(currentGenerationPaths.storageDir, shortPaths.storageDir);
  assert.notEqual(currentGenerationPaths.socketPath, shortPaths.socketPath);

  const longStorageDir =
    '/home/users/example/.vscode-server/data/User/workspaceStorage/' +
    '397c84f32ea9258537d0e11446c43f02/devsessioncanvas.dev-session-canvas/runtime-supervisor';
  const digest = createHash('sha1').update(longStorageDir).digest('hex').slice(0, 24);

  const xdgPaths = resolveRuntimeSupervisorPathsFromStorageDir(longStorageDir, {
    platform: 'linux',
    env: {
      XDG_RUNTIME_DIR: '/run/user/1000'
    },
    tmpDir: '/tmp',
    userId: 1000
  });
  assert.equal(xdgPaths.storageDir, longStorageDir);
  assert.equal(xdgPaths.runtimeDir, posixPath.join('/run/user/1000', 'dev-session-canvas'));
  assert.equal(xdgPaths.socketLocation, 'runtime-private');
  assert.equal(
    xdgPaths.socketPath,
    posixPath.join('/run/user/1000', 'dev-session-canvas', `supervisor-${digest}.sock`)
  );
  assert.ok(Buffer.byteLength(xdgPaths.socketPath, 'utf8') <= 104);

  const tmpPaths = resolveRuntimeSupervisorPathsFromStorageDir(longStorageDir, {
    platform: 'linux',
    env: {},
    tmpDir: '/tmp',
    userId: 1000
  });
  assert.equal(tmpPaths.storageDir, longStorageDir);
  assert.equal(tmpPaths.runtimeDir, '/tmp/dev-session-canvas-1000');
  assert.equal(tmpPaths.socketLocation, 'runtime-private');
  assert.equal(
    tmpPaths.socketPath,
    posixPath.join('/tmp', 'dev-session-canvas-1000', `supervisor-${digest}.sock`)
  );
  assert.ok(Buffer.byteLength(tmpPaths.socketPath, 'utf8') <= 104);

  const relativeXdgPaths = resolveRuntimeSupervisorPathsFromStorageDir(longStorageDir, {
    platform: 'linux',
    env: {
      XDG_RUNTIME_DIR: 'relative/runtime'
    },
    tmpDir: '/tmp',
    userId: 1000
  });
  assert.equal(relativeXdgPaths.socketPath, tmpPaths.socketPath);

  const windowsPaths = resolveRuntimeSupervisorPathsFromStorageDir(longStorageDir, {
    platform: 'win32'
  });
  assert.equal(windowsPaths.storageDir, longStorageDir);
  assert.equal(windowsPaths.runtimeDir, undefined);
  assert.equal(windowsPaths.socketLocation, 'named-pipe');
  assert.equal(windowsPaths.socketPath, `\\\\.\\pipe\\dev-session-canvas-${digest}`);

  assert.throws(
    () =>
      resolveSystemdUserRuntimeSupervisorPathsFromStorageDir(longStorageDir, {
        platform: 'win32'
      }),
    (error) =>
      error?.code === 'DEV_SESSION_CANVAS_RUNTIME_SYSTEMD_USER_UNSUPPORTED_ON_WINDOWS' &&
      error?.descriptor?.id === 'systemdUserUnsupportedOnWindows' &&
      error?.message === 'The systemd-user backend does not support Windows.'
  );

  const systemdPaths = resolveSystemdUserRuntimeSupervisorPathsFromStorageDir(longStorageDir, {
    platform: 'linux',
    env: {},
    homeDir: '/home/users/example'
  });
  assert.equal(systemdPaths.storageDir, longStorageDir);
  assert.equal(systemdPaths.runtimeDir, undefined);
  assert.equal(systemdPaths.controlDir, posixPath.join('/home/users/example', '.local', 'state', 'dsc', 'rh', digest));
  assert.equal(systemdPaths.socketLocation, 'control-dir');
  assert.equal(systemdPaths.socketPath, posixPath.join(systemdPaths.controlDir, 's.sock'));
  assert.equal(
    systemdPaths.unitFilePath,
    posixPath.join(
      '/home/users/example',
      '.config',
      'systemd',
      'user',
      `dev-session-canvas-runtime-supervisor-${digest}.service`
    )
  );
  assert.equal(systemdPaths.unitName, `dev-session-canvas-runtime-supervisor-${digest}.service`);
  assert.ok(Buffer.byteLength(systemdPaths.socketPath, 'utf8') <= 104);

  const currentSystemdStorageDir = posixPath.join(
    resolveCurrentRuntimeSupervisorBaseStoragePath(posixPath.dirname(longStorageDir)),
    'runtime-supervisor'
  );
  const currentSystemdPaths = resolveSystemdUserRuntimeSupervisorPathsFromStorageDir(currentSystemdStorageDir, {
    platform: 'linux',
    env: {},
    homeDir: '/home/users/example'
  });
  assert.notEqual(currentSystemdPaths.socketPath, systemdPaths.socketPath);
  assert.notEqual(currentSystemdPaths.unitName, systemdPaths.unitName);

  const xdgSystemdPaths = resolveSystemdUserRuntimeSupervisorPathsFromStorageDir(longStorageDir, {
    platform: 'linux',
    env: {
      XDG_CONFIG_HOME: '/home/users/example/.config-alt',
      XDG_STATE_HOME: '/home/users/example/.state-alt'
    },
    homeDir: '/home/users/example'
  });
  assert.equal(xdgSystemdPaths.controlDir, posixPath.join('/home/users/example', '.state-alt', 'dsc', 'rh', digest));
  assert.equal(
    xdgSystemdPaths.unitFilePath,
    posixPath.join(
      '/home/users/example',
      '.config-alt',
      'systemd',
      'user',
      `dev-session-canvas-runtime-supervisor-${digest}.service`
    )
  );

  const fallbackHome = '/home/' + 'x'.repeat(60);
  const fallbackSystemdPaths = resolveSystemdUserRuntimeSupervisorPathsFromStorageDir(longStorageDir, {
    platform: 'linux',
    env: {},
    homeDir: fallbackHome
  });
  assert.equal(fallbackSystemdPaths.socketLocation, 'control-dir');
  assert.ok(Buffer.byteLength(fallbackSystemdPaths.socketPath, 'utf8') <= 104);
  assert.ok(fallbackSystemdPaths.socketPath.endsWith('.sock'));

  console.log('runtimeSupervisorPaths tests passed');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
