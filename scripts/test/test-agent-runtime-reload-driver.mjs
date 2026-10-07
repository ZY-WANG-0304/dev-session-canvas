import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';
import contract from '../../tests/vscode-smoke/runtime-reload-contract.cjs';
import windows from '../../tests/vscode-smoke/agent-candidate-windows-observer.cjs';
import processObserver from '../../tests/vscode-smoke/agent-candidate-process-observer.cjs';

const source = await fs.readFile('tests/vscode-smoke/agent-runtime-reload-driver.cjs', 'utf8');
const ast = ts.createSourceFile('agent-runtime-reload-driver.cjs', source, ts.ScriptTarget.Latest, true);
const functions = new Map(ast.statements.filter(ts.isFunctionDeclaration).map(node => [node.name.text, node.getText(ast)]));
const resourceFunctions = ['startProcessObserver', 'releaseProcessObserver', 'assertOriginalResourcesLive', 'originalResourcesExited'];
const compile = (names, context) => new Function(...Object.keys(context),
  `${names.map(name => functions.get(name)).join('\n')}\nreturn { ${names.join(',')} };`)(...Object.values(context));
const identity = (pid, role, parent = 0, wrapperKind) => ({ pid, ppid: parent, startTicks: `win32:${pid}00`,
  executable: `/isolated/${role}-${pid}.exe`, role, wrapperKind, firstPpid: parent,
  firstParentStartTicks: parent ? `win32:${parent}00` : null, platform: 'win32', active: true,
  observationUnknown: false, hasExited: false, exitConfirmed: false, exitCode: null });
const ended = entry => ({ ...entry, active: false, hasExited: true, exitConfirmed: true, exitCode: 0 });
const chain = () => [identity(10, 'host'), identity(20, 'supervisor'), identity(30, 'provider', 20),
  identity(40, 'wrapper', 30, 'cmd'), identity(50, 'wrapper', 40, 'node'), identity(60, 'cli', 50)];
const resources = entries => entries.filter(entry => ['cli', 'wrapper', 'provider'].includes(entry.role));

test('Codex loading composer is not model readiness, and late onboarding still receives confirmation', async () => {
  const loading = 'model: loading /model to change\n\u203a Ask Codex to do anything\n? for shortcuts';
  const ready = 'DeepSeek-Flash high\n\u203a Ask Codex to do anything';
  const trust = 'Folder access\nTrust this folder?\n1. Trust and continue\n2. Quit';
  let clock = 0;
  let cursor = 0;
  const inputs = [];
  const screens = [loading, ready, trust, trust, ready, ready];
  const api = compile(['hasLoadedAgentComposer', 'waitForAgentReady'], {
    stripVt: value => value, control: { deadlineAt: 100000 }, currentNodeId: 'node',
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

function fixture({ resetFails = false, nonemptyRegistry = false, platform = 'win32' } = {}) {
  const events = [];
  const writes = new Map();
  let entries = chain();
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
    config: { cli: { entry: '/codex.cmd' }, launchArguments: [], permittedStorageRoots: ['/isolated'], workspacePath: '/isolated/workspace' },
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
