import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import esbuild from 'esbuild';

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'dsc-runtime-supervisor-paths-'));

try {
  const outfile = path.join(tempDir, 'runtimeSupervisorPaths.cjs');
  await esbuild.build({
    entryPoints: [path.resolve('src/common/runtimeSupervisorPaths.ts')],
    bundle: true,
    format: 'cjs',
    outfile,
    platform: 'node',
    target: 'node18'
  });

  const require = createRequire(import.meta.url);
  const {
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
  assert.equal(shortPaths.socketPath, path.join(shortStorageDir, 'supervisor.sock'));
  assert.equal(shortPaths.registryPath, path.join(shortStorageDir, 'registry.json'));

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
  assert.equal(xdgPaths.runtimeDir, path.join('/run/user/1000', 'dev-session-canvas'));
  assert.equal(xdgPaths.socketLocation, 'runtime-private');
  assert.equal(
    xdgPaths.socketPath,
    path.join('/run/user/1000', 'dev-session-canvas', `supervisor-${digest}.sock`)
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
    path.join('/tmp', 'dev-session-canvas-1000', `supervisor-${digest}.sock`)
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

  const systemdPaths = resolveSystemdUserRuntimeSupervisorPathsFromStorageDir(longStorageDir, {
    platform: 'linux',
    env: {},
    homeDir: '/home/users/example'
  });
  assert.equal(systemdPaths.storageDir, longStorageDir);
  assert.equal(systemdPaths.runtimeDir, undefined);
  assert.equal(systemdPaths.controlDir, path.join('/home/users/example', '.local', 'state', 'dsc', 'rh', digest));
  assert.equal(systemdPaths.socketLocation, 'control-dir');
  assert.equal(systemdPaths.socketPath, path.join(systemdPaths.controlDir, 's.sock'));
  assert.equal(
    systemdPaths.unitFilePath,
    path.join(
      '/home/users/example',
      '.config',
      'systemd',
      'user',
      `dev-session-canvas-runtime-supervisor-${digest}.service`
    )
  );
  assert.equal(systemdPaths.unitName, `dev-session-canvas-runtime-supervisor-${digest}.service`);
  assert.ok(Buffer.byteLength(systemdPaths.socketPath, 'utf8') <= 104);

  const xdgSystemdPaths = resolveSystemdUserRuntimeSupervisorPathsFromStorageDir(longStorageDir, {
    platform: 'linux',
    env: {
      XDG_CONFIG_HOME: '/home/users/example/.config-alt',
      XDG_STATE_HOME: '/home/users/example/.state-alt'
    },
    homeDir: '/home/users/example'
  });
  assert.equal(xdgSystemdPaths.controlDir, path.join('/home/users/example', '.state-alt', 'dsc', 'rh', digest));
  assert.equal(
    xdgSystemdPaths.unitFilePath,
    path.join(
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
