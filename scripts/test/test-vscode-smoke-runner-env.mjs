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
  prepareRuntime,
  resolveVSCodeSmokeDebugRoot,
  spawnPreparedVSCodeScenario
} from '../smoke/vscode-smoke-runner.mjs';

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
      '--log=trace',
      `--user-data-dir=${argsOptions.userDataDir}`,
      `--extensions-dir=${argsOptions.extensionsDir}`,
      '--no-sandbox',
      '--disable-gpu-sandbox',
      ...(platform === 'linux' ? ['--disable-gpu', '--disable-dev-shm-usage'] : []),
      '--password-store=basic',
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
    await completed;
    assert.equal(finished, true);
  } finally {
    child?.emit('exit', 0, null);
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
    assert.strictEqual(runtime.environment.TMP, path.join(debugRoot, 'tmp'));
    assert.strictEqual(runtime.environment.TEMP, path.join(debugRoot, 'tmp'));
  } finally {
    await fs.rm(debugRoot, { recursive: true, force: true });
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
