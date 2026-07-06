import assert from 'assert';
import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';

import {
  buildVSCodeArgs,
  buildVSCodeChildEnv,
  prepareRuntime,
  resolveVSCodeSmokeDebugRoot
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

  const args = buildVSCodeArgs({
    workspacePath: '/workspace/project',
    userDataDir: '/tmp/dsc-smoke/trusted/user-data',
    extensionsDir: '/tmp/dsc-smoke/trusted/extensions',
    extensionTestsPath: '/workspace/project/tests/vscode-smoke/extension-tests.cjs',
    extensionDevelopmentPath: '/workspace/project',
    extraLaunchArgs: ['--locale=zh-cn']
  });
  assert.ok(args.includes('--password-store=basic'));
  if (process.platform === 'linux') {
    assert.ok(args.includes('--disable-gpu'));
    assert.ok(args.includes('--disable-dev-shm-usage'));
  }
  assert.ok(args.includes('--locale=zh-cn'));

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
