import assert from 'assert';
import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';

import { buildVSCodeChildEnv, prepareRuntime } from './vscode-smoke-runner.mjs';

const originalElectronRunAsNode = process.env.ELECTRON_RUN_AS_NODE;
const originalVscodeIpcHookCli = process.env.VSCODE_IPC_HOOK_CLI;
const originalPath = process.env.PATH;

try {
  process.env.ELECTRON_RUN_AS_NODE = '1';
  process.env.VSCODE_IPC_HOOK_CLI = '/tmp/parent-hook.sock';
  process.env.PATH = originalPath ?? '';

  const env = buildVSCodeChildEnv({
    DEV_SESSION_CANVAS_SMOKE_SCENARIO: 'real-reopen'
  });

  assert.strictEqual(env.ELECTRON_RUN_AS_NODE, undefined);
  assert.strictEqual(env.VSCODE_IPC_HOOK_CLI, undefined);
  assert.strictEqual(env.DEV_SESSION_CANVAS_SMOKE_SCENARIO, 'real-reopen');
  assert.strictEqual(env.PATH, process.env.PATH);

  const debugRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dsc-smoke-runner-env-'));
  try {
    const runtime = await prepareRuntime({
      debugRoot,
      runtimeDirName: 'dsc-smoke-runner-env-runtime'
    });
    assert.strictEqual(runtime.environment.XDG_STATE_HOME, path.join(runtime.runtimeDir, 'state'));
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

  if (originalPath === undefined) {
    delete process.env.PATH;
  } else {
    process.env.PATH = originalPath;
  }
}
