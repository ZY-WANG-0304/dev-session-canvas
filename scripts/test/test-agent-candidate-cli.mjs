import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import cliHelpers from '../../tests/vscode-smoke/agent-candidate-cli.cjs';

const bundled = await build({ entryPoints: ['extensions/vscode/dev-session-canvas/src/panel/executionSessionBridge.ts'],
  bundle: true, platform: 'node', format: 'cjs', write: false, external: ['node-pty'] });
const module = { exports: {} };
new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const resolve = module.exports.resolveExecutionSessionSpawnSpec;
const ordinary = cliHelpers.invokeCLI(resolve, process.execPath, ['-e', 'process.stdout.write(JSON.stringify(process.argv.slice(1)))',
  'space and quote " retained', 'x&y'], { encoding: 'utf8', timeout: 5000 });
assert.equal(ordinary.status, 0);
assert.deepEqual(JSON.parse(ordinary.stdout), ['space and quote " retained', 'x&y']);

const command = 'C:\\Pinned CLI\\codex.cmd';
const args = ['-c', 'web_search="disabled"', 'prompt with spaces', 'x&y'];
const spec = resolve({ file: command, args, env: { ComSpec: 'C:\\Windows\\System32\\cmd.exe' } }, 'win32');
assert.equal(spec.file, 'C:\\Windows\\System32\\cmd.exe');
assert.equal(typeof spec.args, 'string');
assert(spec.args.startsWith('/d /s /c "'));
assert(spec.args.includes('Pinned^ CLI'));
let observed;
const noSpawn = cliHelpers.invokeCLI((input, platform) => {
  observed = { input, platform };
  return { file: process.execPath, args: ['-e', 'process.stdout.write("resolver-used")'] };
}, command, args, { encoding: 'utf8', timeout: 5000 }, 'win32');
assert.equal(noSpawn.stdout, 'resolver-used');
assert.equal(observed.input.file, command);
assert.deepEqual(observed.input.args, args);
assert.equal(observed.platform, 'win32');

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-cli-path-'));
try {
  const shim = path.join(directory, 'codex.cmd');
  await fs.writeFile(shim, '@echo off\r\necho fixed-wrapper\r\n', { mode: 0o700 });
  assert.equal(await cliHelpers.findExecutable('codex', 'win32', { Path: `${path.join(directory, 'missing')};${directory}` }), shim);
  await assert.rejects(cliHelpers.findExecutable('claude', 'win32', { PATH: directory }), /Required real CLI is missing/);
  if (process.platform === 'win32') {
    const launched = cliHelpers.invokeCLI(resolve, shim, [], { encoding: 'utf8', timeout: 5000 });
    assert.equal(launched.status, 0);
    assert.equal(launched.stdout.trim(), 'fixed-wrapper');
  }
} finally { await fs.rm(directory, { recursive: true, force: true }); }
console.log('Agent CLI: product spawn resolver and explicit Windows shim selection passed; native cmd launch only runs on Windows.');
