import assert from 'assert';
import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';
import { PassThrough } from 'node:stream';

import {
  buildVSCodeArgs,
  buildVSCodeChildEnv,
  normalizeVSCodeExecutablePath,
  prepareRuntime,
  resolveVSCodeAppRoot,
  resolveVSCodeSmokeDebugRoot,
  spawnPreparedVSCodeScenario
} from '../smoke/vscode-smoke-runner.mjs';
import { resolveSmokeRuntimePaths } from '../smoke/vscode-smoke-runner.mjs';
import { buildRemoteHostEnvironment } from '../smoke/vscode-remote-ssh-fixture.mjs';

const originalElectronRunAsNode = process.env.ELECTRON_RUN_AS_NODE;
const originalVscodeIpcHookCli = process.env.VSCODE_IPC_HOOK_CLI;
const originalCloudflareApiToken = process.env.CLOUDFLARE_API_TOKEN;
const originalCustomToolchainToken = process.env.CUSTOM_TOOLCHAIN_TOKEN;
const originalSmokeDebugRoot = process.env.DEV_SESSION_CANVAS_SMOKE_DEBUG_ROOT;
const originalPath = process.env.PATH;

try {
  process.env.ELECTRON_RUN_AS_NODE = '1';
  process.env.VSCODE_IPC_HOOK_CLI = '/tmp/parent-hook.sock';
  process.env.CLOUDFLARE_API_TOKEN = 'must-not-leak';
  process.env.CUSTOM_TOOLCHAIN_TOKEN = 'must-not-leak';
  process.env.DEV_SESSION_CANVAS_SMOKE_DEBUG_ROOT = path.join(os.tmpdir(), 'dsc-smoke-debug-root');
  process.env.PATH = originalPath ?? '';

  const env = buildVSCodeChildEnv({
    DEV_SESSION_CANVAS_SMOKE_SCENARIO: 'real-reopen'
  });

  assert.strictEqual(env.ELECTRON_RUN_AS_NODE, undefined);
  assert.strictEqual(env.VSCODE_IPC_HOOK_CLI, undefined);
  assert.strictEqual(env.CLOUDFLARE_API_TOKEN, undefined);
  assert.strictEqual(env.CUSTOM_TOOLCHAIN_TOKEN, undefined);
  assert.strictEqual(env.DEV_SESSION_CANVAS_SMOKE_SCENARIO, 'real-reopen');
  assert.strictEqual(env.PATH, process.env.PATH);

  assert.strictEqual(
    resolveVSCodeSmokeDebugRoot('/workspace/project'),
    path.join(os.tmpdir(), 'dsc-smoke-debug-root')
  );

  const argsOptions = {
    workspacePath: '/workspace/project',
    userDataDir: '/tmp/dsc-smoke/trusted/user-data',
    extensionsDir: '/tmp/dsc-smoke/trusted/extensions',
    extensionTestsPath: '/workspace/project/tests/vscode-smoke/extension-tests.cjs',
    extensionDevelopmentPath: '/workspace/project',
    extraLaunchArgs: ['--locale=zh-cn']
  };
  for (const platform of ['linux', 'darwin', 'win32']) {
    assert.deepStrictEqual(buildVSCodeArgs(argsOptions, platform), [
      argsOptions.workspacePath,
      '--disable-extensions',
      '--log=debug',
      `--user-data-dir=${argsOptions.userDataDir}`,
      `--extensions-dir=${argsOptions.extensionsDir}`,
      '--no-sandbox',
      '--disable-gpu-sandbox',
      ...(platform === 'linux' ? ['--disable-gpu', '--disable-dev-shm-usage'] : []),
      '--password-store=basic',
      '--disable-crash-reporter',
      ...(platform === 'darwin' ? ['--use-inmemory-secretstorage'] : []),
      '--disable-updates',
      '--skip-welcome',
      '--skip-release-notes',
      '--locale=zh-cn',
      `--extensionTestsPath=${argsOptions.extensionTestsPath}`,
      `--extensionDevelopmentPath=${argsOptions.extensionDevelopmentPath}`
    ], `${platform} smoke launch arguments`);
  }
  assert.deepStrictEqual(buildVSCodeArgs(argsOptions), buildVSCodeArgs(argsOptions, process.platform));

  const darwinDownload = await fs.mkdtemp(path.join(os.tmpdir(), 'dsc-official-darwin-entry-'));
  try {
    const contents = path.join(darwinDownload, 'Visual Studio Code.app', 'Contents');
    await fs.mkdir(path.join(contents, 'MacOS'), { recursive: true });
    await fs.mkdir(path.join(contents, 'Resources', 'app'), { recursive: true });
    await fs.writeFile(path.join(contents, 'Resources', 'app', 'package.json'), '{"version":"1.142.0"}');
    const staleLibraryPath = path.join(contents, 'MacOS', 'Electron');
    const actual = path.join(contents, 'MacOS', 'Code');
    await fs.writeFile(path.join(contents, 'Info.plist'),
      '<?xml version="1.0"?><plist><dict><key>CFBundleExecutable</key><string>Code</string></dict></plist>');
    await fs.writeFile(actual, 'Official current executable name; fixture is not executed.', { mode: 0o755 });
    assert.equal(normalizeVSCodeExecutablePath(staleLibraryPath, 'darwin'), actual,
      'The pinned download library old Electron path must resolve the executable declared by this same app');
    assert.equal(normalizeVSCodeExecutablePath(darwinDownload, 'darwin'), actual);
    assert.equal(await resolveVSCodeAppRoot(actual, 'darwin'), path.join(contents, 'Resources', 'app'));
    for (const invalid of ['../Code', 'UnknownMissingEntry']) {
      await fs.writeFile(path.join(contents, 'Info.plist'),
        `<plist><dict><key>CFBundleExecutable</key><string>${invalid}</string></dict></plist>`);
      assert.throws(() => normalizeVSCodeExecutablePath(staleLibraryPath, 'darwin'), /valid executable|ENOENT/u);
    }
    await fs.writeFile(path.join(contents, 'Info.plist'), '<plist><dict></dict></plist>');
    assert.throws(() => normalizeVSCodeExecutablePath(staleLibraryPath, 'darwin'), /declare a valid executable/u);
  } finally { await fs.rm(darwinDownload, { recursive: true, force: true }); }

  const remoteOptions = { remoteHomeDir: '/private/remote-home', remoteConfigDir: '/private/config',
    remoteCacheDir: '/private/cache', remoteDataDir: '/private/data', remoteRuntimeDir: '/private/runtime',
    remoteTmpDir: '/private/tmp', remoteAgentDir: '/private/agent', gateStorageRoot: '/private/fixture',
    smokeTestMode: true, realReopenControlFile: '/private/control.json' };
  const remoteEnv = buildRemoteHostEnvironment(remoteOptions, {
    DEV_SESSION_CANVAS_GATE_HOST_RECEIPTS: '/private/receipts', DEV_SESSION_CANVAS_GATE_RUN_NONCE: 'original',
    DEV_SESSION_CANVAS_GATE_CASE_ID: 'remote-ssh-real-reopen-exit', DEV_SESSION_CANVAS_GATE_DEADLINE: '100',
    DEV_SESSION_CANVAS_GATE_CLEANUP_DEADLINE: '160', GH_TOKEN: 'must-not-forward', HOME: '/user-home'
  });
  assert.equal(remoteEnv.HOME, remoteOptions.remoteHomeDir);
  assert.equal(remoteEnv.XDG_STATE_HOME, path.join(remoteOptions.remoteRuntimeDir, 'state'));
  assert.equal(remoteEnv.GH_TOKEN, undefined);
  assert.equal(remoteEnv.DEV_SESSION_CANVAS_GATE_RUN_NONCE, 'original');
  assert.equal(remoteEnv.DEV_SESSION_CANVAS_SMOKE_TEST_MODE, '1');
  assert.deepEqual(JSON.parse(remoteEnv.DEV_SESSION_CANVAS_GATE_STORAGE_ROOTS), ['/private/fixture', '/private/runtime']);
  const remoteArgs = buildVSCodeArgs({ ...argsOptions, remoteAuthority: 'ssh-remote+fixture', extensionHostEnv: remoteEnv });
  const forwarded = remoteArgs.find(arg => arg.startsWith('--extensionEnvironment='));
  assert.deepEqual(JSON.parse(forwarded.slice('--extensionEnvironment='.length)), remoteEnv);
  assert.throws(() => buildVSCodeArgs({ ...argsOptions, extensionHostEnv: remoteEnv }), /declared authority/);
  assert.equal(buildRemoteHostEnvironment({ ...remoteOptions, smokeTestMode: false }, {}).DEV_SESSION_CANVAS_SMOKE_TEST_MODE, undefined);

  const launchRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dsc-original-vscode-process-'));
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  const originalSpawn = childProcess.spawn;
  let spawned;
  let child;
  try {
    const executable = path.join(launchRoot, 'Code.exe');
    await fs.writeFile(executable, 'Controlled launch identity; not executed.');
    await fs.mkdir(path.join(launchRoot, 'bin'));
    await fs.writeFile(path.join(launchRoot, 'bin', 'code.cmd'), 'Controlled non-waiting CLI; not executed.');
    Object.defineProperty(process, 'platform', { ...originalPlatform, value: 'win32' });
    childProcess.spawn = (file, args, options) => {
      spawned = { file, args, options };
      child = new EventEmitter();
      child.stdout = new PassThrough(); child.stderr = new PassThrough();
      return child;
    };
    syncBuiltinESMExports();
    const handle = await spawnPreparedVSCodeScenario({ ...argsOptions, projectRoot: launchRoot,
      vscodeExecutablePath: executable,
      runtime: { userDataDir: argsOptions.userDataDir, extensionsDir: argsOptions.extensionsDir, environment: {} } });
    assert.equal(spawned.file, executable, 'Extension tests must observe Code.exe, not the non-waiting code.cmd CLI');
    assert.equal(spawned.options.shell, false, 'The test process must not be replaced by an intermediate command shell');
    let finished = false;
    const completed = handle.completed.then(() => { finished = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(finished, false, 'Acceptance cannot finish before the original Code process exits');
    child.emit('exit', 0, null);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(finished, false, 'Original process exit must still drain its tail output');
    child.stdout.end(); child.stderr.end(); child.emit('close', 0, null);
    await completed;
    assert.equal(finished, true);
  } finally {
    child?.emit('close', 0, null);
    childProcess.spawn = originalSpawn;
    syncBuiltinESMExports();
    Object.defineProperty(process, 'platform', originalPlatform);
    await fs.rm(launchRoot, { recursive: true, force: true });
  }

  const debugRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dsc-smoke-runner-env-'));
  try {
    const runtime = await prepareRuntime({
      debugRoot,
      runtimeDirName: 'dsc-smoke-runner-env-runtime'
    });
    assert.strictEqual(runtime.environment.XDG_STATE_HOME, path.join(runtime.runtimeDir, 'state'));
    assert.strictEqual(runtime.environment.USERPROFILE, path.join(debugRoot, 'home'));
    assert.strictEqual(runtime.environment.APPDATA, path.join(debugRoot, 'appdata'));
    assert.strictEqual(runtime.environment.LOCALAPPDATA, path.join(debugRoot, 'local-appdata'));
    const expectedTmp = process.platform === 'win32' ? path.join(debugRoot, 'tmp') : path.join(runtime.runtimeDir, 'tmp');
    assert.strictEqual(runtime.environment.TMP, expectedTmp);
    assert.strictEqual(runtime.environment.TEMP, expectedTmp);
  } finally {
    await fs.rm(debugRoot, { recursive: true, force: true });
  }

  // macOS's system TMPDIR itself may exceed the Unix socket budget. Exercise
  // actual full suffixes, not only the short case-name/hash prefix.
  for (const platform of ['darwin', 'linux']) {
    const paths = resolveSmokeRuntimePaths({ debugRoot: `/evidence/${'deep/'.repeat(35)}`,
      runtimeDirName: 'installed-pair', userDataInRuntimeDir: true },
    { platform, temporaryRoot: `/private/${'long/'.repeat(30)}`, runtimeNonce: 'original-run' });
    const limit = platform === 'darwin' ? 103 : 107;
    assert(paths.runtimeDir.startsWith('/tmp/dsc-'));
    for (const socket of [path.join(paths.userDataDir, '1.14-main.sock'),
      path.join(paths.tmpDir, 'vscode-ah-', 'a'.repeat(12), 'b'.repeat(22) + '.sock'),
      path.join(paths.runtimeDir, 'state', 'dsc', 'rh', '0'.repeat(24), 's.sock')])
      assert(Buffer.byteLength(socket) <= limit, `${platform} fixture socket must fit the actual OS budget: ${socket}`);
    assert.throws(() => resolveSmokeRuntimePaths({ debugRoot: '/evidence', runtimeDirName: 'installed-pair',
      userDataInRuntimeDir: true }, { platform, temporaryRoot: '/long'.repeat(40), fallbackRoot: '/long'.repeat(40) }),
    /socket.*(limit|budget)/iu, 'No runnable socket path must fail before the Host starts');
    const prefixOnly = resolveSmokeRuntimePaths({ debugRoot: '/evidence',
      runtimeDirName: 'dsc-file-inspect-' + 'a'.repeat(36) }, { platform, temporaryRoot: '/tmp', runtimeNonce: '' });
    assert(Buffer.byteLength(path.join(prefixOnly.tmpDir, `vscode-ah-${'a'.repeat(12)}`, `${'b'.repeat(22)}.sock`)) <= limit,
      'A runtime name that fits the product socket may still need hashing for the full host agent socket');
  }

  const longRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dsc-long-userdata-'));
  let shortRuntime;
  try {
    const nestedDebugRoot = path.join(longRoot, 'x'.repeat(130), 'systemd-fallback-real-reopen');
    shortRuntime = await prepareRuntime({ debugRoot: nestedDebugRoot,
      runtimeDirName: `dsc-sdf-test-${process.pid}`, userDataInRuntimeDir: true,
      userSettings: { 'security.workspace.trust.enabled': false } });
    assert.strictEqual(shortRuntime.userDataDir, path.join(shortRuntime.runtimeDir, 'user-data'));
    assert.ok(Buffer.byteLength(path.join(nestedDebugRoot, 'user-data', '1.14-main.sock')) > 107);
    assert.ok(Buffer.byteLength(path.join(shortRuntime.userDataDir, '1.14-main.sock')) <= 107);
    assert.deepStrictEqual(JSON.parse(await fs.readFile(path.join(shortRuntime.userDataDir, 'User', 'settings.json'), 'utf8')),
      { 'security.workspace.trust.enabled': false }, 'Runtime cleanup must precede relocated user-data creation');
    const owner = await prepareRuntime({ debugRoot: path.join(nestedDebugRoot, 'owner'),
      runtimeDirName: `dsc-shared-${process.pid}`, userSettings: { role: 'owner' } });
    const attacher = await prepareRuntime({ debugRoot: path.join(nestedDebugRoot, 'attacher'),
      runtimeDirName: `dsc-shared-${process.pid}`, userSettings: { role: 'attacher' } });
    try {
      assert.equal(owner.runtimeDir, attacher.runtimeDir);
      assert.notEqual(owner.userDataDir, attacher.userDataDir);
      assert.deepEqual(JSON.parse(await fs.readFile(path.join(owner.userDataDir, 'User', 'settings.json'), 'utf8')),
        { role: 'owner' }, 'Second shared-window preparation must preserve the original private profile');
      assert.deepEqual(JSON.parse(await fs.readFile(path.join(attacher.userDataDir, 'User', 'settings.json'), 'utf8')),
        { role: 'attacher' });
    } finally {
      await fs.rm(owner.runtimeDir, { recursive: true, force: true });
      await fs.rm(owner.userDataDir, { recursive: true, force: true });
      await fs.rm(attacher.userDataDir, { recursive: true, force: true });
    }
    const fullEnv = buildVSCodeChildEnv({ ...shortRuntime.environment, DBUS_SESSION_BUS_ADDRESS: '', XDG_RUNTIME_DIR: '' });
    assert.strictEqual(fullEnv.DBUS_SESSION_BUS_ADDRESS, '');
    assert.strictEqual(fullEnv.XDG_RUNTIME_DIR, '');
    const namedRuntime = await prepareRuntime({ debugRoot: path.join(longRoot, 'named'),
      runtimeDirName: `dsc-${'x'.repeat(180)}` });
    const systemdSocket = path.join(namedRuntime.environment.XDG_STATE_HOME, 'dsc', 'rh', '0'.repeat(24), 's.sock');
    assert(Buffer.byteLength(systemdSocket) <= 107, 'Named cases must preserve real systemd control-path observation');
    await fs.rm(namedRuntime.runtimeDir, { recursive: true, force: true });
    if (process.platform === 'linux') {
      const net = await import('node:net');
      const socket = path.join(shortRuntime.userDataDir, '1.14-main.sock');
      const server = net.createServer();
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socket, resolve); });
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  } finally {
    if (shortRuntime) await fs.rm(shortRuntime.runtimeDir, { recursive: true, force: true });
    await fs.rm(longRoot, { recursive: true, force: true });
  }

  console.log('vscode smoke runner env sanitization passed');
} finally {
  if (originalElectronRunAsNode === undefined) {
    delete process.env.ELECTRON_RUN_AS_NODE;
  } else {
    process.env.ELECTRON_RUN_AS_NODE = originalElectronRunAsNode;
  }

  if (originalVscodeIpcHookCli === undefined) {
    delete process.env.VSCODE_IPC_HOOK_CLI;
  } else {
    process.env.VSCODE_IPC_HOOK_CLI = originalVscodeIpcHookCli;
  }

  if (originalCloudflareApiToken === undefined) {
    delete process.env.CLOUDFLARE_API_TOKEN;
  } else {
    process.env.CLOUDFLARE_API_TOKEN = originalCloudflareApiToken;
  }

  if (originalCustomToolchainToken === undefined) {
    delete process.env.CUSTOM_TOOLCHAIN_TOKEN;
  } else {
    process.env.CUSTOM_TOOLCHAIN_TOKEN = originalCustomToolchainToken;
  }

  if (originalSmokeDebugRoot === undefined) {
    delete process.env.DEV_SESSION_CANVAS_SMOKE_DEBUG_ROOT;
  } else {
    process.env.DEV_SESSION_CANVAS_SMOKE_DEBUG_ROOT = originalSmokeDebugRoot;
  }

  if (originalPath === undefined) {
    delete process.env.PATH;
  } else {
    process.env.PATH = originalPath;
  }
}
