import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build, transform } from 'esbuild';
import ts from 'typescript';
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

const presetsBundle = await build({ entryPoints: ['extensions/vscode/dev-session-canvas/src/common/agentLaunchPresets.ts'],
  bundle: true, platform: 'node', format: 'cjs', write: false });
const presetsModule = { exports: {} };
new Function('require', 'module', 'exports', presetsBundle.outputFiles[0].text)(createRequire(import.meta.url), presetsModule, presetsModule.exports);
const presets = presetsModule.exports;
const managerSource = await fs.readFile('extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts', 'utf8');
const managerAst = ts.createSourceFile('CanvasPanelManager.ts', managerSource, ts.ScriptTarget.Latest, true);
const managerClass = managerAst.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'CanvasPanelManager');
// Exercise the real product transformations without loading VS Code or starting an Agent.
const methodNames = ['resolveAgentResumeContext', 'buildAgentLaunchSpec'];
const methods = methodNames.map(name => {
  const method = managerClass.members.find(node => node.name?.getText(managerAst) === name);
  assert(method, `Missing production launch method: ${name}`);
  return method.getText(managerAst);
});
const managerCode = (await transform(`return class LaunchManager { ${methods.join('\n')} }`,
  { loader: 'ts', target: 'node22' })).code;
const fallbackId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const Manager = new Function('randomUUID', 'extractClaudeCommandRuntimeSessionFlag', 'isClaudeForkSessionLaunch',
  'looksLikeFakeAgentProviderCommand', managerCode)(() => fallbackId,
  presets.extractClaudeCommandRuntimeSessionFlag, presets.hasClaudeForkSessionFlag, () => false);
const manager = new Manager();
const fixedSessionId = '12345678-1234-4123-8123-123456789abc';
const claudeCommand = 'C:\\Pinned CLI\\claude.cmd';
const launchEnvironment = { ComSpec: 'C:\\Windows\\System32\\cmd.exe' };
const quote = value => `'${String(value).replaceAll("'", "'\\''")}'`;
const productLaunch = launchArgs => {
  const parsed = presets.parseFullAgentCommandLine([claudeCommand, ...launchArgs].map(quote).join(' '));
  assert.deepEqual(parsed.args, launchArgs, 'The custom command parser must retain JSON, empty args and prompt quoting.');
  const resume = manager.resolveAgentResumeContext('fixture-node', 'claude', 'start', parsed.command, {}, parsed.args);
  return manager.buildAgentLaunchSpec({ provider: 'claude', command: parsed.command }, parsed.args, 'C:\\workspace',
    80, 24, launchEnvironment, 'start', resume, { extraArgs: [], extraEnv: {} });
};
for (const lifecycle of ['natural', 'stop']) {
  const prompt = 'Reply with exactly DSC_FIXED_NONCE.';
  const launchArgs = cliHelpers.buildClaudeCandidateArguments({ lifecycle, sessionId: fixedSessionId,
    configurationArguments: ['--settings', 'C:\\Private Config\\settings.json'], prompt });
  const originalOptions = ['--settings', 'C:\\Private Config\\settings.json', '--safe-mode', '--strict-mcp-config',
    '--mcp-config', '{"mcpServers":{}}', '--tools', '', ...(lifecycle === 'natural'
      ? ['--no-session-persistence', '--permission-prompts', 'none', '--max-budget-usd', '0.25',
        '-p', '--output-format', 'json', prompt] : ['--permission-mode', 'plan'])];
  assert.deepEqual(launchArgs, [...originalOptions, '--session-id', fixedSessionId], 'Retain all original scenario options.');
  assert.equal(launchArgs.filter(value => value === '--session-id').length, 1);
  assert.equal(launchArgs.at(-1), fixedSessionId);
  assert.equal(launchArgs[launchArgs.indexOf('--mcp-config') + 1], '{"mcpServers":{}}');
  assert.equal(launchArgs[launchArgs.indexOf('--tools') + 1], '');
  const actual = productLaunch(launchArgs);
  assert.deepEqual(actual.args, launchArgs, 'An explicit scenario ID must prevent product-only argument injection.');
  const expected = resolve({ file: claudeCommand, args: launchArgs, env: launchEnvironment }, 'win32');
  assert.deepEqual(resolve(actual, 'win32'), expected, 'Observer and actual product cmd tails must match exactly.');
  const oldArgs = launchArgs.slice(0, -2);
  assert.deepEqual(productLaunch(oldArgs).args.slice(oldArgs.length), ['--session-id', fallbackId]);
  assert.notEqual(resolve(productLaunch(oldArgs), 'win32').args,
    resolve({ file: claudeCommand, args: oldArgs, env: launchEnvironment }, 'win32').args,
    'Reproduce the old observer mismatch without a model request or native process.');
}
const generated = [0, 1].map(() => cliHelpers.buildClaudeCandidateArguments({ lifecycle: 'stop' }).at(-1));
assert.notEqual(generated[0], generated[1], 'Each scenario must choose its own ID.');
for (const id of generated) assert.match(id, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
assert.throws(() => cliHelpers.buildClaudeCandidateArguments({ lifecycle: 'stop', sessionId: 'invalid' }));

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
