import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { createDeepSeekConfiguration } from './agent-candidate-deepseek.mjs';
import { installCandidateVsix, prepareInstalledVsixInput } from './installed-execution-candidate.mjs';
import { prepareRuntime, runInsideXvfb, shouldReRunInsideXvfb, spawnPreparedVSCodeScenario,
  snapshotVSCodeLogs } from './vscode-smoke-runner.mjs';

const { values } = parseArgs({ options: { output: { type: 'string' }, 'installed-vsix': { type: 'string' },
  backend: { type: 'string', default: 'deepseek' } } });
assert.equal(process.platform, 'linux', 'Agent Reload Window acceptance is currently Linux-only.');
assert.equal(process.arch, 'x64');
assert.equal(values.backend, 'deepseek', 'Only the isolated DeepSeek backend is supported by this entry point.');
assert(values.output && values['installed-vsix'], 'Specify --output NEW_DIRECTORY --installed-vsix FROZEN_PACKAGE.');
if (shouldReRunInsideXvfb()) process.exit(runInsideXvfb(fileURLToPath(import.meta.url), process.cwd()));

const projectRoot = process.cwd();
const output = path.resolve(values.output);
const startedAt = Date.now();
const nonce = randomUUID();
const deadlineAt = startedAt + 240000;
await fs.mkdir(output);
let backend;
let runtime;
let handle;
try {
  backend = await createDeepSeekConfiguration({ apiKey: process.env.DEEPSEEK_API_KEY });
  const input = await prepareInstalledVsixInput(values['installed-vsix'], output);
  const executable = await fs.realpath(process.env.DEV_SESSION_CANVAS_VSCODE_EXECUTABLE ??
    path.join(projectRoot, '.vscode-test/vscode-linux-x64-1.117.0', 'code'));
  runtime = await prepareRuntime({ projectRoot, debugRoot: path.join(output, 'runtime'),
    runtimeDirName: `dsc-agent-reload-${nonce}`, userSettings: {
      'security.workspace.trust.enabled': false,
      'devSessionCanvas.runtimePersistence.enabled': true,
      'devSessionCanvas.agent.codexCommand': '',
      'terminal.integrated.scrollback': 100000 } });
  const workspacePath = path.join(runtime.debugRoot, 'workspace');
  await fs.mkdir(workspacePath);
  const driverRoot = path.join(runtime.debugRoot, 'activation-driver');
  await fs.mkdir(driverRoot, { recursive: true });
  await fs.writeFile(path.join(driverRoot, 'package.json'), `${JSON.stringify({
    name: 'agent-runtime-reload-driver', publisher: 'devsessioncanvas-tests', version: '0.0.0',
    engines: { vscode: '^1.117.0' }, main: './agent-runtime-reload-driver.cjs',
    activationEvents: ['onStartupFinished'], extensionKind: ['workspace'] }, null, 2)}\n`);
  const staged = ['agent-runtime-reload-driver.cjs', 'test-helpers.cjs', 'installed-execution-candidate.cjs',
    'agent-candidate-process-observer.cjs', 'agent-candidate-windows-observer.cjs', 'runtime-reload-contract.cjs'];
  for (const file of staged) await fs.copyFile(path.join(projectRoot, 'tests/vscode-smoke', file), path.join(driverRoot, file));
  const runtimePaths = path.join(driverRoot, 'runtime-reload-paths.cjs');
  const bundledPaths = await build({ entryPoints: [path.join(projectRoot,
    'extensions/vscode/dev-session-canvas/src/common/runtimeSupervisorPaths.ts')], outfile: runtimePaths,
    bundle: true, platform: 'node', format: 'cjs', target: 'node22', write: true, metafile: true, logLevel: 'silent' });
  const sourceHashes = {};
  for (const file of staged) sourceHashes[`tests/vscode-smoke/${file}`] = createHash('sha256')
    .update(await fs.readFile(path.join(projectRoot, 'tests/vscode-smoke', file))).digest('hex');
  sourceHashes['staged-runtime-reload-paths.cjs'] = createHash('sha256')
    .update(await fs.readFile(runtimePaths)).digest('hex');
  const installedVsixExpectation = path.join(runtime.artifactsDir, 'installed-vsix-expectation.json');
  await fs.writeFile(installedVsixExpectation, `${JSON.stringify({ ...input,
    extensionsDir: await fs.realpath(runtime.extensionsDir) }, null, 2)}\n`);
  const codex = await findCodex();
  const codexIsolation = await inspectCodexIsolation({ codex, workspacePath, authReferences: backend.authReferences });
  const controlPath = path.join(runtime.artifactsDir, 'control.json');
  const configPath = path.join(runtime.artifactsDir, 'config.json');
  const config = { schemaVersion: 1, provider: 'codex', backend: 'deepseek', nonce, workspacePath,
    userDataDir: runtime.userDataDir, runtimeDir: runtime.runtimeDir, artifactDir: runtime.artifactsDir,
    installedVsixExpectation, processObserver: undefined, cli: codex,
    launchArguments: [...codexIsolation.arguments, '--no-daemon', '--no-alt-screen', '--sandbox', 'read-only', '-a', 'never'],
    permittedStorageRoots: [runtime.userDataDir, runtime.runtimeDir, runtime.homeDir] };
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  await fs.writeFile(controlPath, `${JSON.stringify({ schemaVersion: 1, phase: 'setup', nonce, deadlineAt }, null, 2)}\n`);
  await fs.writeFile(path.join(output, 'input.json'), `${JSON.stringify({ schemaVersion: 1, scope:
    'One Linux installed real Codex live-runtime Reload Window; DeepSeek backend; no fixed-eight or other-platform claim.',
    backend: { backend: 'deepseek', model: 'deepseek-flash', credentialContentsRecorded: false }, nonce,
    deadlineAt, vsixSha256: input.vsixSha256, vscodeExecutablePath: executable, sourceHashes,
    automaticRetries: 0 }, null, 2)}\n`);
  await installCandidateVsix({ vscodeExecutablePath: executable, runtime, input });
  const workspace = workspacePath;
  const extensionTestsEnv = { DEV_SESSION_CANVAS_SMOKE_TEST_MODE: '1',
    DEV_SESSION_CANVAS_AGENT_RELOAD_CONTROL: controlPath, DEV_SESSION_CANVAS_AGENT_RELOAD_CONFIG: configPath,
    DEV_SESSION_CANVAS_INSTALLED_VSIX_EXPECTATION: installedVsixExpectation, ...backend.authReferences,
    DEV_SESSION_CANVAS_TEST_CODEX_COMMAND: codex.entry, CODEX_UPDATE_ON_STARTUP: 'false' };
  handle = await spawnPreparedVSCodeScenario({ projectRoot, runtime, workspacePath: workspace,
    vscodeExecutablePath: executable, extensionDevelopmentPath: driverRoot, disableExtensions: false,
    disableWorkspaceTrust: true, extensionTestsEnv });
  const completion = handle.completed.then(() => ({ code: handle.child.exitCode, signal: handle.child.signalCode }),
    error => ({ error: String(error), code: handle.child.exitCode, signal: handle.child.signalCode }));
  const exit = await Promise.race([completion, new Promise(resolve => setTimeout(() => resolve({ timeout: true }), 220000))]);
  assert(!exit.timeout, 'Agent Reload Window UI did not exit within the fixed budget.');
  const result = { pass: true, nonce, exit, elapsedMs: Date.now() - startedAt,
    setup: JSON.parse(await fs.readFile(path.join(runtime.artifactsDir, 'setup.json'), 'utf8')),
    verify: JSON.parse(await fs.readFile(path.join(runtime.artifactsDir, 'verify.json'), 'utf8')) };
  await fs.writeFile(path.join(output, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(`Finite real Codex live Agent Reload Window acceptance passed: ${output}`);
} catch (error) {
  await fs.writeFile(path.join(output, 'first-failure.json'), `${JSON.stringify({ error: String(error), stack: error.stack,
    elapsedMs: Date.now() - startedAt }, null, 2)}\n`).catch(() => {});
  if (runtime) await snapshotVSCodeLogs(runtime.userDataDir, runtime.artifactsDir).catch(() => {});
  throw error;
} finally { await backend?.dispose?.(); }

async function findCodex() {
  const { findExecutable } = await import('../../tests/vscode-smoke/agent-candidate-cli.cjs');
  const entry = await findExecutable('codex');
  const version = spawnSync(entry, ['--version'], { encoding: 'utf8', timeout: 10000, shell: false });
  assert.equal(version.status, 0);
  assert.match(version.stdout.trim(), /^codex-cli \d+\.\d+\.\d+$/);
  return { entry, realpath: await fs.realpath(entry), version: version.stdout.trim() };
}

async function inspectCodexIsolation({ codex, workspacePath, authReferences }) {
  const args = [...['hooks', 'plugins', 'apps', 'shell_tool', 'skill_mcp_dependency_install']
    .flatMap(feature => ['--disable', feature]), '-c', 'web_search="disabled"'];
  const invoke = command => spawnSync(codex.entry, [...args, ...command], {
    encoding: 'utf8', timeout: 10000, cwd: workspacePath,
    env: { ...process.env, CODEX_HOME: authReferences.CODEX_HOME }, shell: false });
  const features = invoke(['features', 'list']);
  assert.equal(features.status, 0);
  return { arguments: args, configuredServersVerifiedDisabled: true,
    disabledFeatures: ['hooks', 'plugins', 'apps', 'shell_tool', 'skill_mcp_dependency_install'],
    source: 'isolated DeepSeek Codex acceptance' };
}
