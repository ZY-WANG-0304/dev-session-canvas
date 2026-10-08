import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import ts from 'typescript';
import contract from '../../tests/vscode-smoke/runtime-reload-contract.cjs';
import windows from '../../tests/vscode-smoke/agent-candidate-windows-observer.cjs';
import processObserver from '../../tests/vscode-smoke/agent-candidate-process-observer.cjs';
import cliHelpers from '../../tests/vscode-smoke/agent-candidate-cli.cjs';
import storageContainment from '../../tests/vscode-smoke/runtime-storage-containment.cjs';
import { createDeepSeekConfiguration } from '../smoke/agent-candidate-deepseek.mjs';

const source = await fs.readFile('tests/vscode-smoke/agent-runtime-reload-driver.cjs', 'utf8');
const ast = ts.createSourceFile('agent-runtime-reload-driver.cjs', source, ts.ScriptTarget.Latest, true);
const functions = new Map(ast.statements.filter(ts.isFunctionDeclaration).map(node => [node.name.text, node.getText(ast)]));
const resourceFunctions = ['startProcessObserver', 'releaseProcessObserver', 'assertOriginalResourcesLive', 'originalResourcesExited',
  'assertRuntimeOwnerBinding'];
const compile = (names, context) => new Function(...Object.keys(context),
  `${names.map(name => functions.get(name)).join('\n')}\nreturn { ${names.join(',')} };`)(...Object.values(context));
const launcherSource = await fs.readFile('scripts/smoke/run-vscode-agent-runtime-reload-candidate.mjs', 'utf8');
const launcherAst = ts.createSourceFile('reload-launcher.mjs', launcherSource, ts.ScriptTarget.Latest, true);
const configureSource = launcherAst.statements.find(node => ts.isFunctionDeclaration(node) &&
  node.name.text === 'configureWindowsReloadWorkspace').getText(launcherAst);
const configureFor = (platform, filesystem = fs, paths = path) => new Function('assert', 'fs', 'path', 'process',
  `${configureSource}\nreturn configureWindowsReloadWorkspace;`)(assert, filesystem, paths, { platform });
const launchFunctions = ['selectAgentReloadProvider', 'buildAgentReloadLaunchArguments'];
const launchApi = new Function('assert', 'path', 'cliHelpers', launcherAst.statements.filter(node =>
  ts.isFunctionDeclaration(node) && launchFunctions.includes(node.name.text)).map(node => node.getText(launcherAst)).join('\n') +
  `\nreturn { ${launchFunctions.join(',')} };`)(assert, path, cliHelpers);
const ownershipBundle = await build({ entryPoints: ['extensions/vscode/dev-session-canvas/src/common/runtimeRootOwnership.ts'],
  bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent' });
const ownershipModule = { exports: {} };
new Function('require', 'module', 'exports', ownershipBundle.outputFiles[0].text)(
  createRequire(import.meta.url), ownershipModule, ownershipModule.exports);
const ownership = ownershipModule.exports;
const identity = (pid, role, parent = 0, wrapperKind) => ({ pid, ppid: parent, startTicks: `win32:${pid}00`,
  executable: `/isolated/${role}-${pid}.exe`, role, wrapperKind, firstPpid: parent,
  firstParentStartTicks: parent ? `win32:${parent}00` : null, platform: 'win32', active: true,
  observationUnknown: false, hasExited: false, exitConfirmed: false, exitCode: null });
const ended = entry => ({ ...entry, active: false, hasExited: true, exitConfirmed: true, exitCode: 0 });
const chain = () => [identity(10, 'host'), identity(20, 'supervisor'), identity(30, 'provider', 20),
  identity(40, 'wrapper', 30, 'cmd'), identity(50, 'wrapper', 40, 'node'), identity(60, 'cli', 50)];
const resources = entries => entries.filter(entry => ['cli', 'wrapper', 'provider'].includes(entry.role));

test('reload provider selection preserves Codex default and rejects unrecognized providers', () => {
  assert.equal(launchApi.selectAgentReloadProvider(), 'codex');
  assert.equal(launchApi.selectAgentReloadProvider('claude'), 'claude');
  for (const provider of ['', 'all', 'other']) assert.throws(() => launchApi.selectAgentReloadProvider(provider));
});

test('Claude reload uses the existing isolated tool-free interactive launch with one fixed session identity', () => {
  const settings = path.resolve('/isolated/claude/settings.json');
  const args = launchApi.buildAgentReloadLaunchArguments('claude', { claudeSettingsPath: settings });
  const id = args.at(-1);
  assert.deepEqual(args, cliHelpers.buildClaudeCandidateArguments({ lifecycle: 'stop',
    configurationArguments: ['--settings', settings], sessionId: id }));
  assert(!args.includes('-p'), 'The reload subject must remain interactive across both model turns.');
  assert.throws(() => launchApi.buildAgentReloadLaunchArguments('claude', { claudeSettingsPath: 'relative.json' }));
  const codexIsolation = { arguments: ['--disable', 'hooks'], configuredServersVerifiedDisabled: true };
  assert.deepEqual(launchApi.buildAgentReloadLaunchArguments('codex', { codexIsolation }),
    ['--disable', 'hooks', '--no-daemon', '--no-alt-screen', '--sandbox', 'read-only', '-a', 'never']);
});

test('Windows reload config trusts only its exact empty workspace and preserves the isolated backend config', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsc-reload-config-test-'));
  let backend;
  try {
    const fakeKey = 'test-only-secret-not-an-artifact';
    backend = await createDeepSeekConfiguration({ apiKey: fakeKey, temporaryRoot: root });
    const runtimeRoot = path.join(root, 'runtime');
    const workspacePath = path.join(runtimeRoot, 'workspace');
    await fs.mkdir(workspacePath, { recursive: true });
    const configPath = path.join(backend.authReferences.CODEX_HOME, 'config.toml');
    const original = await fs.readFile(configPath, 'utf8');
    const claude = await fs.readFile(backend.claudeSettingsPath, 'utf8');
    const models = await fs.readFile(path.join(backend.authReferences.CODEX_HOME, 'models.json'), 'utf8');
    const receipt = await configureFor('win32')({ backend, workspacePath, runtimeRoot });
    const appended = (await fs.readFile(configPath, 'utf8')).slice(original.length);
    const workspace = await fs.realpath(workspacePath);
    assert.equal(await fs.readFile(configPath, 'utf8'), original + appended, 'Do not rewrite provider/auth configuration.');
    assert.equal(appended, `\n[projects.${JSON.stringify(workspace)}]\ntrust_level = "trusted"\n\n[windows]\nsandbox = "unelevated"\n`);
    assert.deepEqual(receipt, { workspacePath: workspace, trustLevel: 'trusted', windowsSandbox: 'unelevated', source: 'isolated-CODEX_HOME' });
    assert(!JSON.stringify(receipt).includes(fakeKey));
    assert(!appended.includes(fakeKey));
    assert.equal(await fs.readFile(backend.claudeSettingsPath, 'utf8'), claude);
    assert.equal(await fs.readFile(path.join(backend.authReferences.CODEX_HOME, 'models.json'), 'utf8'), models);
  } finally { await backend?.dispose(); await fs.rm(root, { recursive: true, force: true }); }
});

test('reload preconfiguration is Windows-only and rejects unowned or unknown paths before writing', async () => {
  const noIo = new Proxy({}, { get() { throw new Error('Non-Windows must not access configuration.'); } });
  for (const platform of ['linux', 'darwin']) assert.equal(await configureFor(platform, noIo)({}), undefined);
  const windowsPaths = path.win32;
  const root = 'D:\\isolated';
  const backend = { directory: `${root}\\backend`, descriptor: { backend: 'deepseek' },
    authReferences: { CODEX_HOME: `${root}\\backend\\codex` } };
  const workspacePath = `${root}\\runtime\\workspace`;
  const runtimeRoot = `${root}\\runtime`;
  const configPath = `${root}\\backend\\codex\\config.toml`;
  for (const problem of ['missing', 'different-workspace', 'nonempty-workspace', 'different-home', 'redirected-config']) {
    let writes = 0;
    const filesystem = { realpath: async value => {
      if (problem === 'missing' && value === workspacePath) throw Object.assign(new Error('Missing workspace'), { code: 'ENOENT' });
      if (problem === 'different-workspace' && value === workspacePath) return 'D:\\other-workspace';
      if (problem === 'different-home' && value === backend.authReferences.CODEX_HOME) return 'D:\\user\\.codex';
      if (problem === 'redirected-config' && value === configPath) return 'D:\\user\\.codex\\config.toml';
      return value;
    }, readdir: async () => problem === 'nonempty-workspace' ? ['unexpected-file'] : [],
    appendFile: async () => { writes++; } };
    await assert.rejects(configureFor('win32', filesystem, windowsPaths)({ backend, workspacePath, runtimeRoot }));
    assert.equal(writes, 0, problem);
  }
  const writes = [];
  const filesystem = { realpath: async value => value, readdir: async () => [],
    appendFile: async (file, text) => writes.push({ file, text }) };
  await configureFor('win32', filesystem, windowsPaths)({ backend, workspacePath, runtimeRoot });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].file, configPath);
  const key = /^\n\[projects\.(.+)\]/u.exec(writes[0].text)[1];
  assert.equal(JSON.parse(key), workspacePath, 'Windows backslashes must remain one exact TOML key.');
});

test('Codex loading composer is not model readiness, and late onboarding still receives confirmation', async () => {
  const loading = 'model: loading /model to change\n\u203a Ask Codex to do anything\n? for shortcuts';
  const ready = 'DeepSeek-Flash high\n\u203a Ask Codex to do anything';
  const trust = 'Folder access\nTrust this folder?\n1. Trust and continue\n2. Quit';
  let clock = 0;
  let cursor = 0;
  const inputs = [];
  const screens = [loading, ready, trust, trust, ready, ready];
  const api = compile(['hasLoadedAgentComposer', 'waitForAgentReady'], {
    config: { provider: 'codex' }, stripVt: value => value, control: { deadlineAt: 100000 }, currentNodeId: 'node',
    Date: { now: () => clock }, sleep: async ms => { clock += ms; },
    probe: async () => { assert(cursor < screens.length, 'Ready must be reached without retrying a model request.'); return screens[cursor++]; },
    textOf: value => value, dom: async action => inputs.push(action)
  });
  for (const notReady of [loading, 'Try Codex', 'Send\n? for shortcuts', '\u203a Ask Codex to do anything']) {
    assert.equal(api.hasLoadedAgentComposer(notReady), false);
  }
  assert.equal(api.hasLoadedAgentComposer(ready), true);
  await api.waitForAgentReady();
  assert.equal(cursor, screens.length, 'Confirmation must recheck readiness after late trust UI.');
  assert.deepEqual(inputs, [{ kind: 'sendExecutionInput', nodeId: 'node', data: '\r' }]);
});

test('Windows sandbox onboarding must be completed before the loaded composer becomes ready', async () => {
  const ready = 'model: DeepSeek-Flash high /model to change\n\u203a Ask Codex to do anything';
  // Text reconstructed from the frozen Windows 37608896439 registry VT at revision 124.
  const sandbox = ['model: DeepSeek-Flash high /model to change',
    'Set up the Codex agent sandbox to protect your files and control network access. Learn more',
    '<https://developers.openai.com/codex/windows>',
    '\u203a 1. Set up default sandbox (requires Administrator permissions)',
    '  2. Use non-admin sandbox (higher risk if prompt injected)', '  3. Quit', 'enter select - esc back'].join('\n');
  for (const selection of ['default', 'non-admin', 'unknown', 'not-dismissed']) {
    const selected = selection === 'non-admin' ? sandbox.replace('\u203a 1.', '  1.').replace('  2.', '\u203a 2.')
      : selection === 'unknown' ? sandbox.replace('\u203a 1.', '  1.').replace('  3.', '\u203a 3.') : sandbox;
    let clock = 0;
    let cursor = 0;
    const inputs = [];
    const screens = [ready, selected, selected, selected, ready, ready];
    const api = compile(['hasLoadedAgentComposer', 'waitForAgentReady'], {
      assert, config: { provider: 'codex' }, process: { platform: 'win32' }, stripVt: value => value,
      control: { deadlineAt: 40000 }, currentNodeId: 'node',
      Date: { now: () => clock }, sleep: async ms => { clock += ms; },
      probe: async () => selection === 'not-dismissed' ? selected : screens[cursor++],
      textOf: value => value, dom: async action => inputs.push(action)
    });
    assert.equal(api.hasLoadedAgentComposer(selected), false, 'The loaded model header alone does not complete onboarding.');
    if (['unknown', 'not-dismissed'].includes(selection)) await assert.rejects(api.waitForAgentReady());
    else { await api.waitForAgentReady(); assert.equal(cursor, screens.length); }
    assert.deepEqual(inputs, selection === 'unknown' ? [] : [{ kind: 'sendExecutionInput', nodeId: 'node',
      data: selection === 'non-admin' ? '\r' : '\u001b[B\r' }]);
  }
});

test('Claude readiness requires its model and composer and confirms known onboarding before a model turn', async () => {
  const ready = 'Claude Code v2.1.280\ndeepseek-flash\n\u276f Try "explain this code"';
  const prompts = ['Choose the text style\n1. Dark mode', 'Trust this folder?\n1. Yes, I trust',
    'Detected a custom API key\nDo you want to use this API key?'];
  let clock = 0;
  let cursor = 0;
  const inputs = [];
  const screens = [ready, prompts[0], ...prompts, ready, ready];
  const context = { assert, config: { provider: 'claude' }, process: { platform: 'linux' },
    stripVt: value => value, control: { deadlineAt: 100000 }, currentNodeId: 'node',
    Date: { now: () => clock }, sleep: async ms => { clock += ms; },
    probe: async () => { assert(cursor < screens.length); return screens[cursor++]; },
    textOf: value => value, dom: async action => inputs.push(action) };
  const api = compile(['hasLoadedAgentComposer', 'waitForAgentReady'], context);
  assert.equal(api.hasLoadedAgentComposer(ready), true);
  for (const text of ['Claude Code', 'Claude Code\n\u276f', 'deepseek-flash\n\u276f',
    'DeepSeek-Flash high\n\u203a Ask Codex to do anything']) assert.equal(api.hasLoadedAgentComposer(text), false);
  await api.waitForAgentReady();
  assert.equal(cursor, screens.length);
  assert.deepEqual(inputs, prompts.map(() => ({ kind: 'sendExecutionInput', nodeId: 'node', data: '\r' })));
  for (const text of ['Select login method:', 'Not logged in', 'Invalid API key']) {
    const rejected = compile(['hasLoadedAgentComposer', 'waitForAgentReady'], { ...context, probe: async () => text });
    await assert.rejects(rejected.waitForAgentReady(), /authenticated surface/);
  }
});

function rootBindingFixture() {
  const profile = { linux: 'linux-owner-v1-candidate', darwin: 'macos-owner-v1-candidate',
    win32: 'windows-owner-v1-candidate' }[process.platform];
  const userDataDir = path.resolve('/isolated/user-data');
  const workspacePath = path.resolve('/isolated/workspace');
  const globalStorage = path.join(userDataDir, 'User', 'globalStorage', 'devsessioncanvas.dev-session-canvas');
  const runtimeOwner = ownership.createRuntimeOwnerDescriptor({ environmentKey: 'a'.repeat(64),
    userStorageScopeKey: 'b'.repeat(64), rootPath: workspacePath,
    generation: ownership.resolveRootRuntimeSupervisorGeneration(profile) });
  const metadata = { runtimeOwner, runtimeBackend: 'legacy-detached', runtimeGuarantee: 'best-effort',
    runtimeStoragePath: ownership.resolveRuntimeRootOwnerBaseStoragePath(globalStorage, runtimeOwner), runtimeSessionId: 'session' };
  const hello = { serverVersion: 1, pid: 20, runtimeOwner: structuredClone(runtimeOwner),
    runtimeBackend: metadata.runtimeBackend, runtimeGuarantee: metadata.runtimeGuarantee, executionProfile: profile,
    ownerCompatibilityFingerprint: ownership.createRuntimeOwnerCompatibilityFingerprint(runtimeOwner.generation, profile),
    capabilities: { terminalCurrentStateV1: true, terminalHostOutputCreditV1: true, executionCandidateProfiles: [profile] } };
  const context = { assert, path, process, ...ownership,
    config: { rootOwner: true, userDataDir, workspacePath, permittedStorageRoots: [userDataDir] },
    fs: { realpath: async value => value },
    runtimePaths: value => ({ storageDir: path.join(value.runtimeStoragePath, 'runtime-supervisor') }),
    assertRuntimeStorageContained: (storage, roots) => storageContainment.assertRuntimeStorageContained(
      storage, roots, process.platform, async value => value) };
  return { metadata, hello, context };
}

test('root reload acceptance requires complete owner storage and hello identity without weakening legacy mode', async () => {
  const baseline = rootBindingFixture();
  await compile(['assertRuntimeOwnerBinding'], baseline.context).assertRuntimeOwnerBinding(baseline.metadata, baseline.hello);
  for (const mutate of [
    f => { delete f.metadata.runtimeOwner; },
    f => { f.metadata.runtimeOwner = null; },
    f => { f.metadata.runtimeOwner.extra = true; },
    f => { f.metadata.runtimeOwner.root.normalizedPath = path.resolve('/other-root'); },
    f => { delete f.metadata.runtimeSessionId; },
    f => { delete f.metadata.runtimeBackend; delete f.hello.runtimeBackend; },
    f => { delete f.metadata.runtimeGuarantee; delete f.hello.runtimeGuarantee; },
    f => { f.metadata.runtimeStoragePath = path.resolve('/other-storage'); },
    f => { f.context.config.userDataDir = path.resolve('/other-user'); },
    f => { f.hello.runtimeOwner.environmentKey = 'c'.repeat(64); },
    f => { f.hello.runtimeOwner.userStorageScopeKey = 'c'.repeat(64); },
    f => { f.hello.runtimeBackend = 'systemd-user'; },
    f => { f.hello.runtimeGuarantee = 'different'; },
    f => { f.hello.serverVersion = 2; },
    f => { f.hello.executionProfile = 'different'; },
    f => { f.hello.ownerCompatibilityFingerprint = 'c'.repeat(64); },
    f => { delete f.hello.capabilities.terminalCurrentStateV1; },
    f => { delete f.hello.capabilities.terminalHostOutputCreditV1; },
    f => { f.hello.capabilities.executionCandidateProfiles = []; }
  ]) {
    const f = rootBindingFixture(); mutate(f);
    await assert.rejects(compile(['assertRuntimeOwnerBinding'], f.context).assertRuntimeOwnerBinding(f.metadata, f.hello));
  }
  baseline.context.config.rootOwner = false;
  await compile(['assertRuntimeOwnerBinding'], baseline.context).assertRuntimeOwnerBinding({}, { pid: 20 });
});

function fixture({ resetFails = false, nonemptyRegistry = false, platform = 'win32', provider = 'codex' } = {}) {
  const events = [];
  const writes = new Map();
  let entries = chain();
  if (provider === 'claude') entries = entries.filter(entry => entry.wrapperKind !== 'node').map(entry =>
    entry.role === 'cli' ? { ...entry, ppid: 40, firstPpid: 40, firstParentStartTicks: 'win32:4000' } : entry);
  let stopped = false;
  const original = resources(structuredClone(entries));
  const supervisor = entries.find(entry => entry.role === 'supervisor');
  const observer = {
    error: undefined, failures: [],
    start() { events.push('observe-start'); }, async stop() { events.push('observe-stop'); },
    async sample() { events.push('sample'); }, async dispose() { events.push('dispose'); },
    async setLaunch(spec) { events.push('set-launch'); assert.equal(spec.args, '/d /s /c fixed'); },
    async addRoot(pid, role) { events.push(`root:${role}`); },
    result() { return { entries, failures: [], error: this.error }; },
    async cleanupKnownExecution() { events.push('fallback'); return [{ action: 'terminated-original-handle' }]; },
    async cleanupSupervisor(expected) {
      assert.equal(expected.pid, supervisor.pid);
      events.push('stop-supervisor');
      entries = entries.map(entry => entry.role === 'supervisor' ? ended(entry) : entry);
      return [{ pid: expected.pid, startTicks: expected.startTicks, action: 'terminated-original-handle' }];
    }
  };
  const binding = { runtimeBackend: 'legacy-detached', runtimeStoragePath: '/isolated/storage', runtimeSessionId: 'session' };
  const reader = { sessionId: 'session', authorityId: 'authority', readId: 'new-reader' };
  const metadata = () => ({ ...binding, liveSession: !stopped, persistenceMode: 'live-runtime', terminalHistoryDiscarded: stopped });
  const node = () => ({ id: 'node', kind: 'agent', status: stopped ? 'stopped' : 'running', position: { x: 0, y: 0 }, metadata: { agent: metadata() } });
  const setup = { host: identity(11, 'host'), nodeId: 'node', binding, supervisor, reader: { ...reader, readId: 'old-reader' },
    resources: original, frameId: 'old-frame' };
  const control = { phase: 'verify', nonce: 'nonce', deadlineAt: Date.now() + 100000, setup };
  const context = {
    assert, path, observer, observerReleased: false, currentNodeId: 'node', reloading: false, phase: 'verify',
    config: { provider, cli: { entry: `/${provider}.cmd` }, launchArguments: [], permittedStorageRoots: ['/isolated'], workspacePath: '/isolated/workspace' },
    control, controlPath: '/control', artifacts: '/artifacts', surface: 'editor',
    process: { pid: 10, platform, env: {}, kill() { throw new Error('Windows cleanup must not signal a PID.'); } },
    AgentProcessObserver: function () { return observer; }, resolveExecutionSessionSpawnSpec: () => ({ args: '/d /s /c fixed' }),
    executionEnded: processObserver.executionEnded, hasLiveWindowsStartupChain: windows.hasLiveWindowsStartupChain,
    sameIdentity: contract.sameIdentity, sameLiveIdentity: contract.sameLiveIdentity, exitedIdentity: contract.exitedIdentity,
    readIdentity: async pid => {
      events.push(`read:${pid}`);
      if (pid === 11) return undefined;
      if (pid === 20) return supervisor;
      if (pid === 10) return entries[0];
      throw new Error('Original Windows execution identities must be read through retained handles.');
    },
    command: async (name, ...args) => {
      events.push(name);
      if (name === 'resetState') { if (resetFails) throw new Error('reset failed'); stopped = true; return; }
      if (name === 'createNode') { stopped = false; return; }
      if (name === 'getRuntimeSupervisorState') return { bindings: [], pendingRuntimeSupervisorOperationCount: 0 };
      if (name === 'getDiagnosticEvents') return stopped ? [{ kind: 'runtime/terminalReadSettled', detail: {
        nodeId: 'node', sessionId: 'session', readId: 'new-reader', outcome: { kind: 'applied' } } }] : [];
      if (name === 'dispatchWebviewMessage' && args[0].type === 'webview/stopExecutionSession') {
        events.push('product-stop'); stopped = true; entries = entries.map(entry => resources([entry]).length ? ended(entry) : entry);
      }
    },
    poll: async (label, get, accept) => { const value = await get(); assert(accept(value), label); return value; },
    snapshot: async () => ({ state: { nodes: stopped ? [] : [node()] }, surfaceLifecycle: { editor: { frameId: 'new-frame' } } }),
    nodeOf: (_state, id) => id === 'node' ? node() : undefined,
    runtimePaths: () => ({ registryPath: '/isolated/registry.json', socketPath: '/isolated/socket' }),
    fs: { readFile: async () => { events.push('read-registry'); return JSON.stringify({ sessions: nonemptyRegistry ? [{}] : [] }); } },
    rpc: async () => { events.push('hello'); return { pid: 20 }; },
    read: async () => ({ host: identity(10, 'host') }),
    write: async (name, value) => { events.push(`write:${name}`); writes.set(name, structuredClone(value)); },
    mountedReader: async () => reader, waitForAgentReady: async () => {}, sendAgentTurn: async () => {},
    probe: async () => ({}), hasAgentMarkerResponse: () => true,
    atomic: async () => {},
    vscode: { commands: { executeCommand: async name => events.push(name) } },
    closeWindowsIdentityObserver: async () => events.push('identity-close'), console
  };
  return { context, observer, events, writes, original, control,
    set entries(value) { entries = value; }, get entries() { return entries; },
    endResources() { entries = entries.map(entry => resources([entry]).length ? ended(entry) : entry); } };
}

test('both reload phases configure the Windows launch before observing its fixed chain', async () => {
  const f = fixture();
  await compile(resourceFunctions, f.context).startProcessObserver({ extensionPath: '/extension' });
  assert(f.events.indexOf('set-launch') < f.events.indexOf('observe-start'));
});

test('actual setup releases retained observer handles before requesting Reload Window', async () => {
  const f = fixture();
  f.context.control.phase = 'setup';
  await compile([...resourceFunctions, 'setup'], f.context).setup({ extensionPath: '/extension' });
  assert(f.events.indexOf('dispose') < f.events.indexOf('workbench.action.reloadWindow'));
  assert.equal(f.writes.get('setup.json').resources.length, 4);
});

test('Claude setup and reload retain the native provider/cmd/CLI chain without inventing a Codex node wrapper', async () => {
  const f = fixture({ provider: 'claude' });
  const command = f.context.command;
  f.context.command = async (name, ...args) => {
    if (name === 'createNode') assert.equal(args[1], 'claude');
    return command(name, ...args);
  };
  await compile([...resourceFunctions, 'setup'], f.context).setup({ extensionPath: '/extension' });
  assert.equal(f.writes.get('setup.json').resources.length, 3);
  assert.equal(f.writes.get('setup.json').provider, 'claude');
  const verified = fixture({ provider: 'claude' });
  await compile([...resourceFunctions, 'verify'], verified.context).verify({ extensionPath: '/extension' });
  assert.equal(verified.writes.get('verify.json').retainedResources.length, 3);
  assert.equal(verified.writes.get('verify.json').provider, 'claude');
});

test('live identity proof rejects empty, missing, replaced and ended originals', () => {
  for (const change of [() => [], entries => entries.filter(entry => entry.role !== 'provider'),
    entries => entries.filter(entry => entry.wrapperKind !== 'cmd'),
    entries => entries.map(entry => entry.role === 'cli' ? { ...entry, startTicks: 'win32:reused' } : entry),
    entries => entries.map(entry => entry.role === 'cli' ? ended(entry) : entry)]) {
    const f = fixture();
    const api = compile(resourceFunctions, f.context);
    assert.equal(api.assertOriginalResourcesLive(f.original).length, 4);
    f.entries = change(f.entries);
    assert.throws(() => api.assertOriginalResourcesLive(f.original));
  }
});

test('Windows resource release uses retained exits and never reopens the execution PIDs', async () => {
  const f = fixture();
  const api = compile(resourceFunctions, f.context);
  assert.equal((await api.originalResourcesExited(f.original)).pass, false);
  f.endResources();
  assert.equal((await api.originalResourcesExited(f.original)).pass, true);
  assert(!f.events.some(value => value.startsWith('read:')));
  f.entries = f.entries.filter(entry => entry.role !== 'cli');
  assert.equal((await api.originalResourcesExited(f.original)).pass, false);
  await assert.rejects(api.originalResourcesExited([]));
});

test('actual verify admits stop only after complete original live identity proof', async () => {
  for (const replaced of [false, true]) {
    const f = fixture();
    if (replaced) f.entries = f.entries.map(entry => entry.role === 'cli' ? { ...entry, startTicks: 'win32:999' } : entry);
    const api = compile([...resourceFunctions, 'verify'], f.context);
    if (replaced) {
      await assert.rejects(api.verify({ extensionPath: '/extension' }));
      assert(!f.events.includes('product-stop'));
    } else {
      await api.verify({ extensionPath: '/extension' });
      assert(f.events.indexOf('set-launch') < f.events.indexOf('product-stop'));
      assert(f.events.indexOf('write:pre-stop-ownership.json') < f.events.indexOf('product-stop'));
      assert.equal(f.writes.get('verify.json').originalResourcesExited, true);
    }
  }
});

test('actual reload verify rejects changed original owner fields before model input or product stop', async () => {
  for (const mutate of [
    owner => { owner.environmentKey = 'c'.repeat(64); },
    owner => { owner.userStorageScopeKey = 'c'.repeat(64); },
    owner => { owner.root.normalizedPath = path.resolve('/other-root'); },
    owner => { owner.generation = 'unsupported'; }
  ]) {
    const f = fixture();
    const { metadata } = rootBindingFixture();
    f.control.setup.binding.runtimeOwner = structuredClone(metadata.runtimeOwner);
    const originalNodeOf = f.context.nodeOf;
    f.context.nodeOf = (...args) => {
      const node = originalNodeOf(...args);
      const owner = structuredClone(metadata.runtimeOwner); mutate(owner);
      return { ...node, metadata: { agent: { ...node.metadata.agent, runtimeOwner: owner } } };
    };
    f.context.sendAgentTurn = async () => assert.fail('An altered original owner must not receive a model turn.');
    await assert.rejects(compile([...resourceFunctions, 'verify'], f.context).verify({ extensionPath: '/extension' }));
    assert(!f.events.includes('hello'));
    assert(!f.events.includes('product-stop'));
  }
});

test('model response gate accepts actual assistant markers and rejects echoed prompts for both providers', () => {
  const declaration = ast.statements.filter(ts.isVariableStatement).flatMap(node => [...node.declarationList.declarations])
    .find(node => node.name.getText(ast) === 'hasAgentMarkerResponse');
  const matches = new Function('currentNodeId', 'stripVt', `return ${declaration.initializer.getText(ast)};`)(
    'node', value => value);
  const marker = 'DSC_AGENT_RELOAD_BEFORE_nonce';
  for (const prefix of ['', '\u2022 ', '\u25cf ', '\u23fa ', '* ']) {
    assert.equal(matches({ nodes: [{ nodeId: 'node', terminalVisibleLines: [`${prefix}${marker}`] }] }, marker), true);
  }
  for (const line of [`Reply with exactly ${marker} and nothing else.`, `\u276f Reply with exactly ${marker}`,
    'Claude Code\ndeepseek-flash', 'Ask Codex to do anything']) {
    assert.equal(matches({ nodes: [{ nodeId: 'node', terminalVisibleLines: [line] }] }, marker), false);
  }
  assert.equal(matches({ nodes: [{ nodeId: 'other-node', terminalVisibleLines: [marker] }] }, marker), false);
});

test('normal cleanup proves empty registry before Supervisor stop and releases observer', async () => {
  const f = fixture(); f.endResources();
  await compile([...resourceFunctions, 'cleanup'], f.context).cleanup();
  assert(f.events.indexOf('read-registry') < f.events.indexOf('stop-supervisor'));
  assert(f.events.indexOf('stop-supervisor') < f.events.indexOf('dispose'));
  assert.deepEqual(f.writes.get('cleanup.json').fallback, []);
  assert.equal(f.writes.get('cleanup.json').pass, true);
});

test('failed reset or nonempty registry cannot stop Supervisor or turn fallback into success', async () => {
  for (const options of [{ resetFails: true }, { nonemptyRegistry: true }]) {
    const f = fixture(options); f.endResources();
    await assert.rejects(compile([...resourceFunctions, 'cleanup'], f.context).cleanup());
    assert(!f.events.includes('stop-supervisor'));
    assert(f.events.includes('fallback'));
    assert(f.events.includes('dispose'));
    assert.equal(f.writes.get('cleanup.json').pass, false);
  }
});

test('observer disposal remains idempotent and runs even when stop fails', async () => {
  const f = fixture();
  f.observer.stop = async () => { throw new Error('stop failed'); };
  const api = compile(resourceFunctions, f.context);
  await assert.rejects(api.releaseProcessObserver());
  await api.releaseProcessObserver();
  assert.equal(f.events.filter(value => value === 'dispose').length, 1);
});

test('actual run quits only the isolated macOS application, leaving other platform commands unchanged', async () => {
  for (const platform of ['darwin', 'linux', 'win32']) {
    const f = fixture({ platform });
    f.context.fs.readFile = async file => JSON.stringify(file === '/control' ? { phase: 'verify', nonce: 'nonce' } : {});
    f.context.process.env.DEV_SESSION_CANVAS_AGENT_RELOAD_CONFIG = '/config';
    Object.assign(f.context, {
      activateVisibleExtension: async () => ({}), waitForCommand: async () => {},
      captureInstalledExtensionReceipt: async () => ({}), verify: async () => {}, cleanup: async () => {},
      setup: async () => { throw new Error('Unexpected setup phase'); }
    });
    await compile(['run'], f.context).run();
    assert(f.events.includes(platform === 'darwin' ? 'workbench.action.quit' : 'workbench.action.closeWindow'));
    assert.equal(f.writes.get('driver-finished.json').pass, true);
  }
});

test('failure captures the actual Webview probe without replacing the original failure', async () => {
  for (const captureFails of [false, true]) {
    const f = fixture();
    const original = new Error('original readiness failure');
    const visible = { nodes: [{ nodeId: 'node', terminalVisibleLines: ['Trust this folder?'] }] };
    f.context.fs.readFile = async file => JSON.stringify(file === '/control' ? { phase: 'verify', nonce: 'nonce' } : {});
    f.context.process.env.DEV_SESSION_CANVAS_AGENT_RELOAD_CONFIG = '/config';
    Object.assign(f.context, {
      activateVisibleExtension: async () => ({}), waitForCommand: async () => {},
      captureInstalledExtensionReceipt: async () => ({}), verify: async () => { throw original; }, cleanup: async () => {},
      probe: async () => { f.events.push('failure-probe'); if (captureFails) throw new Error('secondary probe failure'); return visible; }
    });
    await compile(['run'], f.context).run();
    assert.equal(f.events.filter(value => value === 'failure-probe').length, 1);
    assert.equal(f.writes.get('verify-failure.json').error, String(original));
    assert.equal(f.writes.get('driver-finished.json').pass, false);
    assert.deepEqual(f.writes.get('failure-webview-probe.json'), captureFails ? undefined : visible);
    assert(f.writes.has('failure-getDiagnosticEvents.json'), 'A failed probe must not skip remaining evidence.');
  }
});
