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
    resolveExecutionCandidateRuntimeSupervisorBaseStoragePath,
    resolveRootRuntimeSupervisorGeneration,
    resolveRootRuntimeSupervisorExecutionProfile,
    isRootOwnerRuntimeSupervisorStorageDir,
    resolveRuntimeSupervisorExecutionProfile,
    assertExecutionCandidateRuntimeSupervisorStorageDir,
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

  const candidateProfile = 'linux-owner-v1-candidate';
  const candidateBase = resolveExecutionCandidateRuntimeSupervisorBaseStoragePath(extensionStorageDir, candidateProfile);
  const candidateStorageDir = path.join(candidateBase, 'runtime-supervisor');
  assert.equal(candidateBase, path.join(extensionStorageDir, 'runtime-supervisor-generations', 'terminal-current-state-linux-v1'));
  assert.equal(resolveRuntimeSupervisorExecutionProfile(candidateStorageDir), candidateProfile);
  assert.equal(resolveRuntimeSupervisorExecutionProfile(path.join(candidateStorageDir, '.')), candidateProfile);
  assert.doesNotThrow(() => assertExecutionCandidateRuntimeSupervisorStorageDir(candidateStorageDir, candidateProfile));
  const macProfile = 'macos-owner-v1-candidate';
  const windowsProfile = 'windows-owner-v1-candidate';
  const windowsBase = resolveExecutionCandidateRuntimeSupervisorBaseStoragePath(extensionStorageDir, windowsProfile);
  const windowsStorage = path.join(windowsBase, 'runtime-supervisor');
  assert.equal(windowsBase, path.join(extensionStorageDir, 'runtime-supervisor-generations', 'terminal-current-state-windows-v1'));
  assert.equal(resolveRuntimeSupervisorExecutionProfile(windowsStorage), windowsProfile);
  assert.doesNotThrow(() => assertExecutionCandidateRuntimeSupervisorStorageDir(windowsStorage, windowsProfile));
  assert.throws(() => assertExecutionCandidateRuntimeSupervisorStorageDir(candidateStorageDir, windowsProfile));
  assert.throws(() => assertExecutionCandidateRuntimeSupervisorStorageDir(windowsStorage, macProfile));
  const macBase = resolveExecutionCandidateRuntimeSupervisorBaseStoragePath(extensionStorageDir, macProfile);
  const macStorage = path.join(macBase, 'runtime-supervisor');
  assert.equal(macBase, path.join(extensionStorageDir, 'runtime-supervisor-generations', 'terminal-current-state-macos-v1'));
  assert.equal(resolveRuntimeSupervisorExecutionProfile(macStorage), macProfile);
  assert.doesNotThrow(() => assertExecutionCandidateRuntimeSupervisorStorageDir(macStorage, macProfile));
  assert.throws(() => assertExecutionCandidateRuntimeSupervisorStorageDir(candidateStorageDir, macProfile), /isolated/);
  assert.throws(() => assertExecutionCandidateRuntimeSupervisorStorageDir(macStorage, candidateProfile), /isolated/);
  for (const [profile, generation, next] of [[candidateProfile, 'terminal-exit-v1', candidateStorageDir],
    [macProfile, 'terminal-exit-macos-v1', macStorage], [windowsProfile, 'terminal-exit-windows-v1', windowsStorage]]) {
    const previous = path.join(extensionStorageDir, 'runtime-supervisor-generations', generation, 'runtime-supervisor');
    assert.equal(resolveRuntimeSupervisorExecutionProfile(previous), profile, 'Existing binding must still resolve its provider.');
    assert.doesNotThrow(() => assertExecutionCandidateRuntimeSupervisorStorageDir(previous, profile));
    for (const resolver of [resolveRuntimeSupervisorPathsFromStorageDir, resolveSystemdUserRuntimeSupervisorPathsFromStorageDir]) {
      const previousPaths = resolver(previous, { platform: 'linux', env: {}, homeDir: '/home/test' });
      const nextPaths = resolver(next, { platform: 'linux', env: {}, homeDir: '/home/test' });
      assert.notEqual(previousPaths.socketPath, nextPaths.socketPath);
      assert.notEqual(previousPaths.registryPath, nextPaths.registryPath);
      if (previousPaths.unitName) assert.notEqual(previousPaths.unitName, nextPaths.unitName);
    }
  }
  for (const invalidStorage of [shortStorageDir, currentGenerationStorageDir, candidateBase,
    path.join(extensionStorageDir, 'terminal-exit-v1', 'runtime-supervisor'),
    path.join(candidateStorageDir, '..', '..', 'terminal-stream-v1', 'runtime-supervisor')]) {
    assert.equal(resolveRuntimeSupervisorExecutionProfile(invalidStorage), undefined);
    assert.throws(() => assertExecutionCandidateRuntimeSupervisorStorageDir(invalidStorage, candidateProfile), /isolated/);
  }
  for (const invalidProfile of ['', 'future-profile', undefined, null]) {
    assert.throws(() => resolveExecutionCandidateRuntimeSupervisorBaseStoragePath(extensionStorageDir, invalidProfile), /Unsupported/);
    assert.throws(() => assertExecutionCandidateRuntimeSupervisorStorageDir(candidateStorageDir, invalidProfile), /Unsupported/);
  }
  for (const [platform, profile, generation] of [
    ['linux', candidateProfile, 'terminal-root-owner-linux-v1'],
    ['darwin', macProfile, 'terminal-root-owner-macos-v1'],
    ['win32', windowsProfile, 'terminal-root-owner-windows-v1']
  ]) {
    const paths = platform === 'win32' ? path.win32 : path.posix;
    const globalStorage = platform === 'win32' ? 'C:\\Users\\Test\\Global' : '/private/user/global';
    assert.equal(resolveRootRuntimeSupervisorGeneration(profile), generation);
    const base = paths.join(globalStorage, 'runtime-roots-v1', 'a'.repeat(64), 'b'.repeat(64),
      'runtime-supervisor-generations', generation);
    const storageDir = paths.join(base, 'runtime-supervisor');
    assert.equal(resolveRootRuntimeSupervisorExecutionProfile(storageDir, platform), profile);
    assert.equal(resolveRuntimeSupervisorExecutionProfile(storageDir, platform), profile);
    assert.equal(isRootOwnerRuntimeSupervisorStorageDir(storageDir, platform), true);
    for (const invalidStorage of [base, paths.join(base, 'registry.json'),
      paths.join(base, '..', `${generation}-unknown`, 'runtime-supervisor'),
      paths.join(globalStorage, generation, 'runtime-supervisor')]) {
      assert.equal(resolveRootRuntimeSupervisorExecutionProfile(invalidStorage, platform), undefined);
      assert.equal(isRootOwnerRuntimeSupervisorStorageDir(invalidStorage, platform), false);
    }
    for (const oldGeneration of [
      platform === 'linux' ? 'terminal-exit-v1' : `terminal-exit-${platform === 'darwin' ? 'macos' : 'windows'}-v1`,
      `terminal-current-state-${platform === 'darwin' ? 'macos' : platform === 'win32' ? 'windows' : 'linux'}-v1`
    ]) {
      const previous = paths.join(globalStorage, 'runtime-supervisor-generations', oldGeneration, 'runtime-supervisor');
      assert.equal(resolveRuntimeSupervisorExecutionProfile(previous, platform), profile);
      assert.equal(isRootOwnerRuntimeSupervisorStorageDir(previous, platform), false);
      const options = { platform, env: {}, homeDir: '/home/test', tmpDir: '/tmp', userId: 1000 };
      const previousPaths = resolveRuntimeSupervisorPathsFromStorageDir(previous, options);
      const rootPaths = resolveRuntimeSupervisorPathsFromStorageDir(storageDir, options);
      assert.notEqual(rootPaths.socketPath, previousPaths.socketPath);
      assert.notEqual(rootPaths.registryPath, previousPaths.registryPath);
      if (platform === 'linux') {
        assert.notEqual(resolveSystemdUserRuntimeSupervisorPathsFromStorageDir(storageDir, options).unitName,
          resolveSystemdUserRuntimeSupervisorPathsFromStorageDir(previous, options).unitName);
      }
    }
  }
  const isolatedPathOptions = { platform: 'linux', env: {}, tmpDir: '/tmp', userId: 1000, homeDir: '/home/test' };
  for (const resolvePaths of [resolveRuntimeSupervisorPathsFromStorageDir, resolveSystemdUserRuntimeSupervisorPathsFromStorageDir]) {
    const candidate = resolvePaths(candidateStorageDir, isolatedPathOptions);
    const stock = resolvePaths(currentGenerationStorageDir, isolatedPathOptions);
    assert.notEqual(candidate.storageDir, stock.storageDir);
    assert.notEqual(candidate.socketPath, stock.socketPath);
    assert.notEqual(candidate.registryPath, stock.registryPath);
    if (candidate.unitName) {
      assert.notEqual(candidate.unitName, stock.unitName);
      assert.notEqual(candidate.unitFilePath, stock.unitFilePath);
    }
  }

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
