import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { build } from 'esbuild';
import { ensureVSCodeExecutable, launchPreparedVSCodeScenario, prepareMainSmokeHostExtension,
  prepareRuntime, resolveStagedSmokeTestPath, runInsideXvfb, shouldReRunInsideXvfb } from './vscode-smoke-runner.mjs';

const projectRoot = process.cwd();
const { values } = parseArgs({ options: { output: { type: 'string' }, 'auth-only': { type: 'boolean' } } });
const authOnly = values['auth-only'] === true;
assert.equal(process.platform, 'linux');
assert(values.output, 'Specify a new --output evidence directory.');
if (shouldReRunInsideXvfb()) process.exit(runInsideXvfb(fileURLToPath(import.meta.url), projectRoot));
const output = path.resolve(values.output);
await fs.mkdir(output);
const runId = randomUUID();
const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dsc-real-agent-'));
const authReferences = { CODEX_HOME: process.env.CODEX_HOME || path.join(os.homedir(), '.codex'),
  CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude') };
const nodeInterpreter = { entry: process.execPath, realpath: await fs.realpath(process.execPath), version: process.version };
assert.equal(nodeInterpreter.version, 'v25.6.0', 'This fixed Agent input requires the installed Node 25.6.0.');
const codexEnvironment = { ...process.env, PATH: `${path.dirname(nodeInterpreter.entry)}${path.delimiter}${process.env.PATH ?? ''}` };
const cli = {};
for (const [provider, version] of [['codex', '0.157.1'], ['claude', '2.1.280']]) {
  const entry = await findExecutable(provider);
  const realpath = await fs.realpath(entry);
  const result = spawnSync(entry, ['--version'], { encoding: 'utf8', timeout: 10000,
    ...(provider === 'codex' ? { env: codexEnvironment } : {}) });
  assert.equal(result.status, 0, `${provider} version query failed.`);
  const versionPattern = provider === 'codex' ? /^codex-cli \d+\.\d+\.\d+$/ : /^\d+\.\d+\.\d+ \(Claude Code\)$/;
  assert(versionPattern.test(result.stdout.trim()) && result.stdout.includes(version),
    `This fixed input requires ${provider} ${version}; unexpected output is not recorded.`);
  cli[provider] = { entry, realpath, version: result.stdout.trim() };
}
assert.equal(path.dirname(cli.codex.entry), path.dirname(nodeInterpreter.entry),
  'This fixed Codex wrapper and its Node interpreter must share the installed command directory.');
const testCommandReferences = { DEV_SESSION_CANVAS_TEST_CODEX_COMMAND: cli.codex.entry,
  DEV_SESSION_CANVAS_TEST_CLAUDE_COMMAND: cli.claude.entry };
const codexIsolation = authOnly ? undefined : inspectCodexIsolation();
const dist = path.join(projectRoot, 'extensions/vscode/dev-session-canvas/dist');
const assetManifest = JSON.parse(await fs.readFile(path.join(dist,
  'native/linux-execution-candidate/linux-x64-glibc/manifest.json'), 'utf8'));
assert.equal(assetManifest.profile, 'linux-owner-v1-candidate');
assert.equal(assetManifest.runtime.name, 'electron');
const hashes = {};
for (const file of ['extensions/vscode/dev-session-canvas/dist/extension.js',
  'extensions/vscode/dev-session-canvas/dist/runtime-supervisor.js',
  'extensions/vscode/dev-session-canvas/dist/linux-execution-provider.js',
  'extensions/vscode/dev-session-canvas/dist/webview.js',
  'scripts/smoke/run-vscode-agent-candidate.mjs', 'tests/vscode-smoke/agent-candidate-tests.cjs',
  'tests/vscode-smoke/agent-candidate-process-observer.cjs',
  'extensions/vscode/dev-session-canvas/src/common/runtimeSupervisorPaths.ts']) {
  hashes[file] = createHash('sha256').update(await fs.readFile(path.join(projectRoot, file))).digest('hex');
}
const runtimePaths = await build({ entryPoints: [path.join(projectRoot,
  'extensions/vscode/dev-session-canvas/src/common/runtimeSupervisorPaths.ts')],
  bundle: true, platform: 'node', format: 'cjs', target: 'node22', write: false });
const scenarios = authOnly ? [{ name: 'auth-only', authOnly: true, state: 'not-run' }]
  : ['codex', 'claude'].flatMap(provider => ['live-runtime', 'snapshot-only'].flatMap(mode =>
  ['natural', 'stop'].map(lifecycle => ({ name: `${provider}-${mode}-${lifecycle}`, provider, mode, lifecycle,
    nonce: `DSC_A4_${randomUUID().replaceAll('-', '')}`, state: 'not-run' }))));
const writeJson = (file, data) => fs.writeFile(path.join(output, file), `${JSON.stringify(data, null, 2)}\n`);
await writeJson('input.json', { schemaVersion: 1,
  scope: authOnly ? 'Real Host auth-only diagnosis; not A4 product acceptance'
    : 'A4 finite Linux real CLI acceptance; not A3/A5 closure',
  runId, cli, nodeInterpreter, authReferences, testCommandReferences, codexIsolation, workspaceRoot, assetManifest, hashes,
  scenarioCount: scenarios.length, plannedModelTurns: authOnly ? 0 : 4,
  retryScope: 'No harness retries; provider-internal transport attempts are not inferred from invocation count.',
  naturalTimeoutMs: 120000, stopTimeoutMs: 30000,
  environmentPolicy: 'Existing smoke secret filtering and isolated HOME; CLI authentication directory references only.',
  interpreterPolicy: 'Real CLI test command references preserve command-directory PATH priority; Codex retains its original npm wrapper.' });
await writeJson('schedule.json', scenarios);
const vscodeExecutablePath = await ensureVSCodeExecutable(projectRoot);

for (const [index, scenario] of scenarios.entries()) {
  const debugRoot = path.join(output, scenario.name);
  const workspacePath = path.join(workspaceRoot, scenario.name);
  await fs.mkdir(workspacePath);
  const runtime = await prepareRuntime({ projectRoot, debugRoot,
    runtimeDirName: `dsc-agent-${runId}-${index}`, userSettings: {
      'security.workspace.trust.enabled': false,
      'devSessionCanvas.runtimePersistence.enabled': scenario.mode === 'live-runtime',
      'devSessionCanvas.agent.codexCommand': cli.codex.entry,
      'devSessionCanvas.agent.claudeCommand': cli.claude.entry,
      'devSessionCanvas.agent.codexDefaultArgs': '', 'devSessionCanvas.agent.claudeDefaultArgs': '',
      'terminal.integrated.scrollback': 10000 } });
  const smokeHostRoot = await prepareMainSmokeHostExtension({ projectRoot, targetRoot: path.join(debugRoot, 'smoke-host') });
  await fs.writeFile(resolveStagedSmokeTestPath(smokeHostRoot, 'agent-candidate-runtime-paths.cjs'),
    runtimePaths.outputFiles[0].contents);
  const config = { ...scenario, cli: cli[scenario.provider], nodeInterpreter, testCommandReferences, workspacePath,
    ...(authOnly ? { cliCandidates: cli, expectedAuthReferences: authReferences } : {}),
    ...(scenario.provider === 'codex' ? { codexIsolation } : {}),
    surface: scenario.mode === 'live-runtime' ? 'editor' : 'panel', artifactDir: runtime.artifactsDir,
    smokeHostRoot, permittedStorageRoots: [runtime.userDataDir, runtime.runtimeDir, runtime.homeDir] };
  const configPath = path.join(debugRoot, 'scenario.json');
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  scenario.state = 'started';
  await writeJson('schedule.json', scenarios);
  try {
    await launchPreparedVSCodeScenario({ projectRoot, runtime, vscodeExecutablePath, workspacePath,
      extensionDevelopmentPath: smokeHostRoot,
      extensionTestsPath: resolveStagedSmokeTestPath(smokeHostRoot, 'agent-candidate-tests.cjs'),
      disableExtensions: false, disableWorkspaceTrust: true,
      extensionTestsEnv: { ...authReferences, ...testCommandReferences,
        DEV_SESSION_CANVAS_AGENT_CANDIDATE_CONFIG: configPath } });
    scenario.state = 'passed';
    await writeJson('schedule.json', scenarios);
  } catch (error) {
    scenario.state = 'failed';
    await writeJson('schedule.json', scenarios);
    await writeJson('first-failure.json', { scenario: scenario.name, error: String(error), automaticHarnessRetries: 0 });
    throw error;
  }
}
console.log(`${authOnly ? 'Real Host auth-only diagnosis completed; not A4 product acceptance'
  : 'Finite real Agent candidate acceptance passed'}: ${output}`);

function inspectCodexIsolation() {
  const disabledFeatures = ['hooks', 'plugins', 'apps', 'shell_tool', 'skill_mcp_dependency_install'];
  const args = [...disabledFeatures.flatMap(feature => ['--disable', feature]), '-c', 'web_search="disabled"'];
  const invoke = command => {
    const result = spawnSync(cli.codex.entry, [...args, ...command], { encoding: 'utf8', timeout: 10000,
      maxBuffer: 1024 * 1024, cwd: workspaceRoot, env: { ...codexEnvironment, CODEX_HOME: authReferences.CODEX_HOME } });
    assert.equal(result.status, 0, 'Codex read-only isolation inspection failed; raw output is not recorded.');
    return result.stdout;
  };
  const readServers = () => {
    let rows;
    try { rows = JSON.parse(invoke(['mcp', 'list', '--json'])); }
    catch { throw new Error('Codex MCP configuration inspection failed; raw output is not recorded.'); }
    assert(Array.isArray(rows), 'Expected a configured-server list.');
    return rows.map(row => {
      assert(typeof row.name === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(row.name),
        'Configured MCP server ID is outside this fixed experiment input.');
      assert.equal(typeof row.enabled, 'boolean');
      return { name: row.name, enabled: row.enabled };
    }).sort((a, b) => a.name.localeCompare(b.name));
  };
  const servers = readServers();
  for (const { name } of servers) args.push('-c', `mcp_servers.${name}.enabled=false`);
  const disabledServers = readServers();
  assert.deepEqual(disabledServers, servers.map(({ name }) => ({ name, enabled: false })),
    'All configured MCP servers must be disabled before launching this experiment.');
  const features = invoke(['features', 'list']).split('\n');
  for (const feature of disabledFeatures) {
    assert(features.some(line => {
      const fields = line.trim().split(/\s+/);
      return fields[0] === feature && fields.at(-1) === 'false';
    }), `Codex experiment feature must be disabled: ${feature}`);
  }
  return { arguments: args, disabledFeatures, mcpServerNames: servers.map(({ name }) => name),
    configuredServersVerifiedDisabled: true, modelProviderConfigurationPreserved: true,
    rawMcpConfigurationRecorded: false, modelRequestsDuringInspection: 0,
    basis: ['https://developers.openai.com/codex/mcp/', 'https://learn.chatgpt.com/docs/hooks',
      'https://learn.chatgpt.com/docs/config-file/config-reference',
      'Installed Codex 0.157.1 mcp list --help: Output the configured servers as JSON'] };
}

async function findExecutable(name) {
  for (const directory of (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(directory, name);
    try { await fs.access(candidate, constants.X_OK); return candidate; }
    catch (error) { if (!['ENOENT', 'EACCES', 'ENOTDIR'].includes(error.code)) throw error; }
  }
  throw new Error(`Required real CLI is missing: ${name}`);
}
