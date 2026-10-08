import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { constants } from 'node:fs';
import { createDeepSeekConfiguration } from './agent-candidate-deepseek.mjs';
import { installCandidateVsix, prepareInstalledVsixInput } from './installed-execution-candidate.mjs';
import { prepareRuntime, runInsideXvfb, shouldReRunInsideXvfb, spawnPreparedVSCodeScenario,
  snapshotVSCodeLogs } from './vscode-smoke-runner.mjs';
import cliHelpers from '../../tests/vscode-smoke/agent-candidate-cli.cjs';

const require = createRequire(import.meta.url);
let resolveSpawnSpec;

const { values } = parseArgs({ options: { output: { type: 'string' }, 'installed-vsix': { type: 'string' },
  backend: { type: 'string', default: 'deepseek' }, provider: { type: 'string', default: 'codex' },
  'root-owner': { type: 'boolean', default: false } } });
const provider = selectAgentReloadProvider(values.provider);
assert(['linux', 'darwin', 'win32'].includes(process.platform), 'Unsupported Agent Reload Window platform.');
assert(process.platform !== 'win32' || process.arch === 'x64', 'Windows reload acceptance requires the x64 runner.');
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
      'devSessionCanvas.agent.claudeCommand': '',
      'terminal.integrated.scrollback': 100000 } });
  const workspacePath = path.join(runtime.debugRoot, 'workspace');
  await fs.mkdir(workspacePath);
  const windowsWorkspace = provider === 'codex'
    ? await configureWindowsReloadWorkspace({ backend, workspacePath, runtimeRoot: runtime.debugRoot }) : undefined;
  const driverRoot = path.join(runtime.debugRoot, 'activation-driver');
  await fs.mkdir(driverRoot, { recursive: true });
  await fs.writeFile(path.join(driverRoot, 'package.json'), `${JSON.stringify({
    name: 'agent-runtime-reload-driver', publisher: 'devsessioncanvas-tests', version: '0.0.0',
    engines: { vscode: '^1.117.0' }, main: './agent-runtime-reload-driver.cjs',
    activationEvents: ['onStartupFinished'], extensionKind: ['workspace'] }, null, 2)}\n`);
  const staged = ['agent-runtime-reload-driver.cjs', 'test-helpers.cjs', 'installed-execution-candidate.cjs',
    'agent-candidate-process-observer.cjs', 'agent-candidate-windows-observer.cjs',
    'agent-candidate-process-observer.py', 'agent-candidate-process-observer.ps1', 'runtime-reload-contract.cjs',
    'runtime-storage-containment.cjs'];
  for (const file of staged) await fs.copyFile(path.join(projectRoot, 'tests/vscode-smoke', file), path.join(driverRoot, file));
  const runtimePaths = path.join(driverRoot, 'runtime-reload-paths.cjs');
  await build({ entryPoints: [path.join(projectRoot,
    'extensions/vscode/dev-session-canvas/src/common/runtimeSupervisorPaths.ts')], outfile: runtimePaths,
    bundle: true, platform: 'node', format: 'cjs', target: 'node22', write: true, metafile: true, logLevel: 'silent' });
  const ownershipPath = path.join(driverRoot, 'runtime-root-ownership.cjs');
  const ownership = await build({ entryPoints: [path.join(projectRoot,
    'extensions/vscode/dev-session-canvas/src/common/runtimeRootOwnership.ts')], outfile: ownershipPath,
    bundle: true, platform: 'node', format: 'cjs', target: 'node22', write: true, metafile: true, logLevel: 'silent' });
  const spawnSpec = await build({ entryPoints: [path.join(projectRoot,
    'extensions/vscode/dev-session-canvas/src/panel/executionSessionBridge.ts')], bundle: true,
    platform: 'node', format: 'cjs', target: 'node22', write: false, logLevel: 'silent' });
  await fs.writeFile(path.join(driverRoot, 'execution-session-spawn-spec.cjs'), spawnSpec.outputFiles[0].contents);
  const sourceHashes = {};
  sourceHashes['scripts/smoke/run-vscode-agent-runtime-reload-candidate.mjs'] = createHash('sha256')
    .update(await fs.readFile(fileURLToPath(import.meta.url))).digest('hex');
  sourceHashes['tests/vscode-smoke/agent-candidate-cli.cjs'] = createHash('sha256')
    .update(await fs.readFile(path.join(projectRoot, 'tests/vscode-smoke/agent-candidate-cli.cjs'))).digest('hex');
  for (const file of staged) sourceHashes[`tests/vscode-smoke/${file}`] = createHash('sha256')
    .update(await fs.readFile(path.join(projectRoot, 'tests/vscode-smoke', file))).digest('hex');
  sourceHashes['staged-runtime-reload-paths.cjs'] = createHash('sha256')
    .update(await fs.readFile(runtimePaths)).digest('hex');
  for (const file of Object.keys(ownership.metafile.inputs)) sourceHashes[file] = createHash('sha256')
    .update(await fs.readFile(path.resolve(file))).digest('hex');
  sourceHashes['staged-runtime-root-ownership.cjs'] = createHash('sha256')
    .update(await fs.readFile(ownershipPath)).digest('hex');
  sourceHashes['staged-execution-session-spawn-spec.cjs'] = createHash('sha256')
    .update(await fs.readFile(path.join(driverRoot, 'execution-session-spawn-spec.cjs'))).digest('hex');
  const installedVsixExpectation = path.join(runtime.artifactsDir, 'installed-vsix-expectation.json');
  await fs.writeFile(installedVsixExpectation, `${JSON.stringify({ ...input,
    extensionsDir: await fs.realpath(runtime.extensionsDir) }, null, 2)}\n`);
  const cli = await findAgentCli(provider);
  const codexIsolation = provider === 'codex'
    ? await inspectCodexIsolation({ codex: cli, workspacePath, authReferences: backend.authReferences }) : undefined;
  const processObserver = await prepareProcessObserver();
  const controlPath = path.join(runtime.artifactsDir, 'control.json');
  const configPath = path.join(runtime.artifactsDir, 'config.json');
  const config = { schemaVersion: 1, provider, rootOwner: values['root-owner'], backend: 'deepseek', nonce, workspacePath,
    userDataDir: runtime.userDataDir, runtimeDir: runtime.runtimeDir, artifactDir: runtime.artifactsDir,
    installedVsixExpectation, processObserver, cli,
    launchArguments: buildAgentReloadLaunchArguments(provider, { codexIsolation, claudeSettingsPath: backend.claudeSettingsPath }),
    permittedStorageRoots: [runtime.userDataDir, runtime.runtimeDir, runtime.homeDir] };
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  await fs.writeFile(controlPath, `${JSON.stringify({ schemaVersion: 1, phase: 'setup', nonce, deadlineAt }, null, 2)}\n`);
  const platformName = process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'macOS' : 'Linux';
  await fs.writeFile(path.join(output, 'input.json'), `${JSON.stringify({ schemaVersion: 1, scope:
    `One ${platformName} installed real ${provider} live-runtime Reload Window${values['root-owner'] ? ' with root owner identity' : ''}; DeepSeek backend; no fixed-eight claim.`,
    provider, rootOwner: values['root-owner'], plannedModelTurns: 2,
    backend: { backend: 'deepseek', model: 'deepseek-flash', credentialContentsRecorded: false }, nonce,
    ...(windowsWorkspace ? { windowsWorkspace } : {}),
    deadlineAt, vsixSha256: input.vsixSha256, vscodeExecutablePath: executable, sourceHashes,
    automaticRetries: 0 }, null, 2)}\n`);
  await installCandidateVsix({ vscodeExecutablePath: executable, runtime, input });
  const workspace = workspacePath;
  const extensionTestsEnv = { DEV_SESSION_CANVAS_SMOKE_TEST_MODE: '1',
    DEV_SESSION_CANVAS_AGENT_RELOAD_CONTROL: controlPath, DEV_SESSION_CANVAS_AGENT_RELOAD_CONFIG: configPath,
    DEV_SESSION_CANVAS_INSTALLED_VSIX_EXPECTATION: installedVsixExpectation, ...backend.authReferences,
    [provider === 'codex' ? 'DEV_SESSION_CANVAS_TEST_CODEX_COMMAND' : 'DEV_SESSION_CANVAS_TEST_CLAUDE_COMMAND']: cli.entry,
    CODEX_UPDATE_ON_STARTUP: 'false' };
  handle = await spawnPreparedVSCodeScenario({ projectRoot, runtime, workspacePath: workspace,
    vscodeExecutablePath: executable, extensionDevelopmentPath: driverRoot, disableExtensions: false,
    disableWorkspaceTrust: true, extensionTestsEnv });
  const completion = handle.completed.then(() => ({ code: handle.child.exitCode, signal: handle.child.signalCode }),
    error => ({ error: String(error), code: handle.child.exitCode, signal: handle.child.signalCode }));
  const exit = await Promise.race([completion, new Promise(resolve => setTimeout(() => resolve({ timeout: true }), 220000))]);
  assert(!exit.timeout, 'Agent Reload Window UI did not exit within the fixed budget.');
  assert.equal(exit.code, 0, `Agent Reload Window exited unsuccessfully: ${JSON.stringify(exit)}`);
  const finished = JSON.parse(await fs.readFile(path.join(runtime.artifactsDir, 'driver-finished.json'), 'utf8'));
  assert.equal(finished.pass, true, 'The phaseful Agent Reload driver did not complete successfully.');
  const setup = JSON.parse(await fs.readFile(path.join(runtime.artifactsDir, 'setup.json'), 'utf8'));
  const verify = JSON.parse(await fs.readFile(path.join(runtime.artifactsDir, 'verify.json'), 'utf8'));
  assert.equal(verify.pass, true);
  const result = { pass: true, nonce, exit, elapsedMs: Date.now() - startedAt, setup, verify };
  await fs.writeFile(path.join(output, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(`Finite real ${provider} live Agent Reload Window acceptance passed: ${output}`);
} catch (error) {
  await fs.writeFile(path.join(output, 'first-failure.json'), `${JSON.stringify({ error: String(error), stack: error.stack,
    elapsedMs: Date.now() - startedAt }, null, 2)}\n`).catch(() => {});
  if (runtime) await snapshotVSCodeLogs(runtime.userDataDir, runtime.artifactsDir).catch(() => {});
  throw error;
} finally { await backend?.dispose?.(); }

async function configureWindowsReloadWorkspace({ backend, workspacePath, runtimeRoot }) {
  if (process.platform !== 'win32') return undefined;
  assert.equal(backend?.descriptor?.backend, 'deepseek', 'Windows reload requires the isolated backend.');
  for (const value of [backend.directory, backend.authReferences?.CODEX_HOME, workspacePath, runtimeRoot]) {
    assert(typeof value === 'string' && path.isAbsolute(value), 'Windows reload isolation paths must be absolute.');
  }
  const workspace = await fs.realpath(workspacePath);
  const root = await fs.realpath(runtimeRoot);
  assert.equal(workspace, path.join(root, 'workspace'), 'Only the new isolated reload workspace may be trusted.');
  assert.deepEqual(await fs.readdir(workspace), [], 'The reload workspace must be newly created and empty.');
  const backendRoot = await fs.realpath(backend.directory);
  const home = await fs.realpath(backend.authReferences.CODEX_HOME);
  assert.equal(home, path.join(backendRoot, 'codex'), 'CODEX_HOME must belong to this isolated backend.');
  const configPath = path.join(home, 'config.toml');
  assert.equal(await fs.realpath(configPath), configPath, 'The isolated Codex config must not redirect elsewhere.');
  // Configure only this owned fixture; interactive CLI readiness and the read-only/no-tools policy remain required.
  const quotedWorkspace = JSON.stringify(workspace).replace(/\x7f/gu, '\\u007f');
  await fs.appendFile(configPath, `\n[projects.${quotedWorkspace}]\ntrust_level = "trusted"\n\n[windows]\nsandbox = "unelevated"\n`);
  return { workspacePath: workspace, trustLevel: 'trusted', windowsSandbox: 'unelevated', source: 'isolated-CODEX_HOME' };
}

function selectAgentReloadProvider(value = 'codex') {
  assert(['codex', 'claude'].includes(value), 'Choose codex or claude for the one-provider reload acceptance.');
  return value;
}

function buildAgentReloadLaunchArguments(provider, { codexIsolation, claudeSettingsPath }) {
  selectAgentReloadProvider(provider);
  if (provider === 'codex') {
    assert.equal(codexIsolation.configuredServersVerifiedDisabled, true);
    return [...codexIsolation.arguments, '--no-daemon', '--no-alt-screen', '--sandbox', 'read-only', '-a', 'never'];
  }
  assert(path.isAbsolute(claudeSettingsPath), 'Claude reload requires its private isolated settings file.');
  return cliHelpers.buildClaudeCandidateArguments({ lifecycle: 'stop',
    configurationArguments: ['--settings', claudeSettingsPath] });
}

async function findAgentCli(provider) {
  const entry = await cliHelpers.findExecutable(provider);
  const spawnBundle = await build({ entryPoints: [path.join(projectRoot,
    'extensions/vscode/dev-session-canvas/src/panel/executionSessionBridge.ts')], bundle: true,
    platform: 'node', format: 'cjs', target: 'node22', write: false, logLevel: 'silent' });
  const spawnModule = { exports: {} };
  new Function('require', 'module', 'exports', spawnBundle.outputFiles[0].text)(require, spawnModule, spawnModule.exports);
  resolveSpawnSpec = spawnModule.exports.resolveExecutionSessionSpawnSpec;
  const version = cliHelpers.invokeCLI(resolveSpawnSpec, entry, ['--version'], {
    encoding: 'utf8', timeout: 10000,
    env: { ...process.env, PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH ?? ''}` }
  });
  assert.equal(version.status, 0);
  assert.match(version.stdout.trim(), provider === 'codex' ? /^codex-cli \d+\.\d+\.\d+$/ : /^2\.1\.280 \(Claude Code\)$/);
  const result = { entry, realpath: await fs.realpath(entry), version: version.stdout.trim() };
  if (process.platform === 'win32') Object.assign(result, await cliHelpers.windowsCliManifest(provider, entry,
    { realpath: await fs.realpath(process.execPath) }));
  return result;
}

async function prepareProcessObserver() {
  if (process.platform === 'darwin') {
    const python = process.env.DEV_SESSION_CANVAS_AGENT_OBSERVER_PYTHON;
    assert(python && path.isAbsolute(python), 'Darwin Agent reload requires its pinned observer Python.');
    await fs.access(python, constants.X_OK);
    const check = spawnSync(python, ['-c', 'import sys, psutil; assert sys.platform == "darwin"; assert psutil.__version__ == "7.0.0"; print(sys.version.split()[0])'],
      { encoding: 'utf8', timeout: 10000, maxBuffer: 4096 });
    assert.equal(check.status, 0, 'Darwin process identity dependency is unavailable.');
    assert.equal(check.stdout.trim(), '3.12.10');
    return { python, pythonVersion: check.stdout.trim(), psutilVersion: '7.0.0' };
  }
  if (process.platform === 'win32') {
    const powershell = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    await fs.access(powershell, constants.X_OK);
    return { backend: 'windows-safehandle-v1', powershell };
  }
  return undefined;
}

async function inspectCodexIsolation({ codex, workspacePath, authReferences }) {
  const args = [...['hooks', 'plugins', 'apps', 'shell_tool', 'skill_mcp_dependency_install']
    .flatMap(feature => ['--disable', feature]), '-c', 'web_search="disabled"'];
  const invoke = command => cliHelpers.invokeCLI(resolveSpawnSpec, codex.entry, [...args, ...command], {
    encoding: 'utf8', timeout: 10000, cwd: workspacePath,
    env: { ...process.env, CODEX_HOME: authReferences.CODEX_HOME }
  });
  const features = invoke(['features', 'list']);
  assert.equal(features.status, 0);
  return { arguments: args, configuredServersVerifiedDisabled: true,
    disabledFeatures: ['hooks', 'plugins', 'apps', 'shell_tool', 'skill_mcp_dependency_install'],
    source: 'isolated DeepSeek Codex acceptance' };
}
