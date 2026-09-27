import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';

import esbuild from 'esbuild';

const cwd = process.cwd();
const vscodeStub = String.raw`class Disposable { dispose() {} }
class EventEmitter { event = () => new Disposable(); fire() {} dispose() {} }
class ThemeIcon { constructor(id) { this.id = id; } }
class TreeItem {}
module.exports = {
  Disposable, EventEmitter, ThemeIcon, TreeItem,
  ExtensionMode: { Production: 1, Development: 2, Test: 3 },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  l10n: { t: message => message },
  env: { appName: 'VS Code Test', shell: '/controlled/shell' },
  workspace: { isTrusted: true, workspaceFolders: [],
    getConfiguration: () => ({ get: (_key, fallback) => fallback, inspect: () => undefined }) },
  window: { showErrorMessage: async () => undefined },
  Uri: { file: fsPath => ({ fsPath, path: fsPath, scheme: 'file' }) }
};`;
const processStub = String.raw`function blocked() {
  throw new Error('Native process creation is forbidden in the Host deactivation test');
}
module.exports = { spawn: blocked, spawnSync: blocked, fork: blocked,
  exec: blocked, execSync: blocked, execFile: blocked, execFileSync: blocked };`;

const bundled = await esbuild.build({
  stdin: {
    contents: `
      export { CanvasPanelManager } from './extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager';
      export { RuntimeSupervisorClient } from './extensions/vscode/dev-session-canvas/src/panel/runtimeSupervisorClient';
    `,
    resolveDir: cwd,
    sourcefile: 'runtime-host-deactivation-integrity.ts'
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  external: ['node-pty'],
  plugins: [{
    name: 'host-boundaries-only',
    setup(build) {
      build.onResolve({ filter: /^(vscode|node-pty|(?:node:)?child_process)$/ }, args => ({
        path: args.path,
        namespace: 'host-boundary'
      }));
      build.onLoad({ filter: /.*/, namespace: 'host-boundary' }, args => ({
        loader: 'js',
        contents: args.path === 'vscode' ? vscodeStub : processStub
      }));
    }
  }]
});

const loaded = { exports: {} };
new Function('require', 'module', 'exports', '__filename', '__dirname', bundled.outputFiles[0].text)(
  createRequire(import.meta.url), loaded, loaded.exports,
  path.resolve('scripts/test/runtime-host-deactivation-integrity.cjs'), path.resolve('scripts/test')
);
const { CanvasPanelManager, RuntimeSupervisorClient } = loaded.exports;

function sleep(ms = 0) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function makeSession() {
  return {
    owner: 'supervisor',
    sessionId: 'session-1',
    runtimeSessionId: 'session-1',
    runtimeBackend: 'legacy-detached',
    runtimeGuarantee: 'best-effort',
    runtimeStoragePath: '/controlled/runtime',
    terminalProjectionMode: 'legacy-interactive',
    lifecycleStatus: 'running',
    displayLabel: 'controlled',
    shellPath: '/controlled/shell',
    cwd: '/controlled',
    cols: 119,
    rows: 41,
    buffer: 'live output',
    outputSequence: 2,
    pendingOutput: '',
    terminalTitle: undefined,
    stopRequested: false,
    terminalStateTrusted: false,
    terminalStateTracker: { dispose() {}, flush: async () => undefined },
    lineContextTracker: { dispose() {}, resize() {}, write() {} },
    syncTimer: undefined,
    syncDueAtMs: undefined,
    reconnectTimer: undefined,
    lifecycleTimer: undefined,
    outputFlushTimer: undefined,
    terminalStreamPaged: false
  };
}

function makeHost() {
  const session = makeSession();
  const terminalSessions = new Map([['terminal-1', session]]);
  const persisted = [];
  const diagnostics = [];
  const remoteCalls = [];
  const node = {
    id: 'terminal-1',
    kind: 'terminal',
    title: 'Controlled terminal',
    position: { x: 1, y: 2 },
    size: { width: 640, height: 360 },
    status: 'running',
    summary: 'running',
    metadata: {
      terminal: {
        persistenceMode: 'live-runtime',
        attachmentState: 'attached-live',
        liveSession: true,
        runtimeBackend: 'legacy-detached',
        runtimeSessionId: 'session-1',
        runtimeStoragePath: '/controlled/runtime',
        lastCols: 107,
        lastRows: 33
      }
    }
  };
  const host = Object.create(CanvasPanelManager.prototype);
  Object.assign(host, {
    context: { extensionMode: 3, extensionUri: { fsPath: cwd } },
    state: { version: 1, nodes: [node], edges: [], groups: [] },
    activeSurface: 'editor',
    agentSessions: new Map(),
    terminalSessions,
    runtimeSessionBindings: new Map([['terminal:session-1:/controlled/runtime:legacy-detached', {
      kind: 'terminal', nodeId: 'terminal-1', runtimeSessionId: 'session-1'
    }]]),
    runtimeSupervisorClients: new Map(),
    runtimeSupervisorEventAdmissionOpen: true,
    runtimeSupervisorClientEpochs: new Map(),
    pendingRuntimeSupervisorOperations: new Set(),
    nonNativeHostExecutions: new Map(),
    terminalProjectionRefreshScheduler: { clearMatching() {} },
    terminalReadRelay: { closeMatching() {} },
    scheduledExecutionOutputPosts: new Map(),
    pendingTerminalInitialInputs: new Map(),
    pendingWorkspaceStateUpdate: Promise.resolve(),
    hasActiveExecutionSessions: () => terminalSessions.size > 0,
    getExecutionSessions: kind => kind === 'terminal' ? terminalSessions : host.agentSessions,
    persistState: options => {
      persisted.push({ options, state: structuredClone(host.state) });
      return Promise.resolve();
    },
    postState() {},
    flushDeferredCanvasStatePersist: async () => undefined,
    waitForPendingWorkspaceStateUpdates: async () => undefined,
    clearPendingTerminalInitialInputs() {},
    clearExecutionTerminalProjectionRefreshTimers() {},
    clearScheduledExecutionOutputPost() {},
    recordDiagnosticEvent: (name, details) => diagnostics.push({ name, details }),
    postMessage() {},
    stopSession() { remoteCalls.push('stop'); },
    deleteSession() { remoteCalls.push('delete'); }
  });
  // Keep the direct map reference used by the test fixture and the Host methods aligned.
  host.runtimeSessionBindings = new Map([[
    host.buildRuntimeSessionBindingKey('terminal', 'session-1', '/controlled/runtime', 'legacy-detached'),
    { kind: 'terminal', nodeId: 'terminal-1', runtimeSessionId: 'session-1' }
  ]]);
  return { host, session, persisted, diagnostics, remoteCalls, node };
}

async function testFinalFlushProjectsResizeAndKeepsRemoteAlive() {
  const f = makeHost();
  f.host.closeRuntimeSupervisorEventAdmission();
  let disposed = 0;
  f.host.runtimeSupervisorClients.set('original', {
    dispose() { disposed += 1; },
    stopSession() { f.remoteCalls.push('stop'); },
    deleteSession() { f.remoteCalls.push('delete'); }
  });
  f.session.syncTimer = setTimeout(() => assert.fail('sync timer was not cancelled'), 1000);
  await f.host.flushAndDetachSupervisorExecutionSessionsForHostBoundary();
  assert.equal(f.persisted.length, 1, 'boundary performs one immediate live-state flush');
  const metadata = f.persisted[0].state.nodes[0].metadata.terminal;
  assert.equal(f.persisted[0].options.mode, 'immediate');
  assert.equal(metadata.lastCols, 119);
  assert.equal(metadata.lastRows, 41);
  assert.equal(metadata.liveSession, true);
  assert.equal(f.host.terminalSessions.size, 1, 'remote session binding remains available after Host detach');
  assert.equal(f.host.runtimeSessionBindings.size, 1);
  assert.equal(f.session.syncTimer, undefined, 'the old Host timer is closed after final projection');
  assert.equal(disposed, 0, 'state flush does not stop or dispose the remote Supervisor');
  assert.deepEqual(f.remoteCalls, []);
  assert.equal(f.session.stopRequested, false);
}

async function testAdmissionRejectsLateTimerAndEvents() {
  const f = makeHost();
  let flushes = 0;
  f.host.flushLiveExecutionState = () => { flushes += 1; };
  f.host.queueExecutionStateSync('terminal', 'terminal-1', 0);
  f.host.closeRuntimeSupervisorEventAdmission();
  await sleep(10);
  assert.equal(flushes, 0, 'a timer already queued at the boundary cannot flush stale state');
  assert.equal(f.session.syncTimer, undefined);

  const before = {
    buffer: f.session.buffer,
    outputSequence: f.session.outputSequence,
    cols: f.session.cols,
    rows: f.session.rows,
    lifecycleStatus: f.session.lifecycleStatus,
    syncTimer: f.session.syncTimer,
    syncDueAtMs: f.session.syncDueAtMs
  };
  await f.host.handleRuntimeSupervisorState('legacy-detached', '/controlled/runtime', {
    kind: 'terminal', sessionId: 'session-1', live: true, lifecycle: 'running', output: ''
  });
  f.host.handleRuntimeSupervisorOutput('legacy-detached', '/controlled/runtime', {
    kind: 'terminal', sessionId: 'session-1', chunk: 'late output', outputSequence: 3
  });
  f.host.handleRuntimeSupervisorTerminalEvent('legacy-detached', '/controlled/runtime', {
    kind: 'terminal', sessionId: 'session-1', authorityId: 'authority',
    event: { type: 'resize', revision: 3, createdAtMs: 1, cols: 80, rows: 24 }
  });
  assert.deepEqual({
    buffer: f.session.buffer,
    outputSequence: f.session.outputSequence,
    cols: f.session.cols,
    rows: f.session.rows,
    lifecycleStatus: f.session.lifecycleStatus,
    syncTimer: f.session.syncTimer,
    syncDueAtMs: f.session.syncDueAtMs
  }, before, 'late Runtime events do not mutate a detached Host session');
}

async function testCompletedStateCannotBeReplacedByOldTimer() {
  const f = makeHost();
  let writes = 0;
  f.host.persistState = () => { writes += 1; };
  f.host.flushLiveExecutionState = () => { writes += 100; };
  f.host.queueExecutionStateSync('terminal', 'terminal-1', 0);
  f.host.closeRuntimeSupervisorEventAdmission();
  f.host.state = {
    ...f.host.state,
    nodes: [{ ...f.node, status: 'closed', summary: 'Session ended.', metadata: {
      terminal: { persistenceMode: 'snapshot-only', attachmentState: 'history-restored', liveSession: false }
    }}]
  };
  f.host.persistState({ mode: 'immediate', reason: 'completed-host' });
  await sleep(10);
  assert.equal(writes, 1, 'the completed Host write is not followed by an old live flush');
  assert.equal(f.host.state.nodes[0].metadata.terminal.liveSession, false);
  assert.equal(f.host.state.nodes[0].metadata.terminal.runtimeSessionId, undefined);
}

async function testStateCallbacksAreTrackedAndBoundaryIsIdempotent() {
  const f = makeHost();
  const gate = {};
  gate.promise = new Promise(resolve => { gate.resolve = resolve; });
  f.host.handleRuntimeSupervisorState = async () => gate.promise;
  f.host.getRuntimeStoragePathFromBackend = () => '/controlled/runtime';
  f.host.buildRuntimeSupervisorClientKey = backend => `${backend.kind}:${backend.paths.storageDir}`;
  f.host.getRuntimeSupervisorScriptPath = () => '/controlled/supervisor.js';
  f.host.getRuntimeSupervisorLauncherScriptPath = () => '/controlled/launcher.js';
  RuntimeSupervisorClient.prototype.ensureConnected = async function ensureConnected() {};
  const backend = {
    kind: 'legacy-detached', guarantee: 'best-effort', label: 'controlled',
    paths: { storageDir: '/controlled/runtime/storage', socketPath: '/controlled/runtime/socket' },
    startSupervisor: async () => undefined
  };
  const client = await f.host.getRuntimeSupervisorClientForBackend(backend, { deferConnection: true });
  let outputCallbacks = 0;
  f.host.handleRuntimeSupervisorOutput = () => { outputCallbacks += 1; };
  f.host.runtimeSupervisorClients.delete(f.host.buildRuntimeSupervisorClientKey(backend));
  const replacement = await f.host.getRuntimeSupervisorClientForBackend(backend, { deferConnection: true });
  const outputEvent = { kind: 'terminal', sessionId: 'session-1', chunk: 'late output', outputSequence: 3 };
  client.options.onSessionOutput(outputEvent);
  replacement.options.onSessionOutput(outputEvent);
  assert.equal(outputCallbacks, 1, 'a replacement client epoch rejects the old client callback');
  replacement.options.onSessionState({ kind: 'terminal', sessionId: 'session-1', live: true, lifecycle: 'running' });
  await sleep();
  assert.equal(f.host.pendingRuntimeSupervisorStateCallbacks.size, 1);
  f.host.closeRuntimeSupervisorEventAdmission();
  replacement.options.onSessionState({ kind: 'terminal', sessionId: 'session-1', live: true, lifecycle: 'running' });
  assert.equal(f.host.pendingRuntimeSupervisorStateCallbacks.size, 1, 'late callback is rejected');
  gate.resolve();
  await f.host.waitForPendingRuntimeSupervisorStateCallbacks();
  assert.equal(f.host.pendingRuntimeSupervisorStateCallbacks.size, 0);
}

async function testDisposedClientEpochRejectsCallbacksBeforeReplacement() {
  const f = makeHost();
  f.host.getRuntimeStoragePathFromBackend = () => '/controlled/runtime';
  f.host.buildRuntimeSupervisorClientKey = backend => `${backend.kind}:${backend.paths.storageDir}`;
  f.host.getRuntimeSupervisorScriptPath = () => '/controlled/supervisor.js';
  f.host.getRuntimeSupervisorLauncherScriptPath = () => '/controlled/launcher.js';
  RuntimeSupervisorClient.prototype.ensureConnected = async function ensureConnected() {};
  const backend = {
    kind: 'legacy-detached', guarantee: 'best-effort', label: 'controlled',
    paths: { storageDir: '/controlled/runtime/storage', socketPath: '/controlled/runtime/socket' },
    startSupervisor: async () => undefined
  };
  const original = await f.host.getRuntimeSupervisorClientForBackend(backend, { deferConnection: true });
  let callbacks = 0;
  f.host.handleRuntimeSupervisorOutput = () => { callbacks += 1; };
  f.host.disposeRuntimeSupervisorClients();
  original.options.onSessionOutput({ kind: 'terminal', sessionId: 'session-1', chunk: 'stale', outputSequence: 3 });
  assert.equal(callbacks, 0, 'disposing a client invalidates its epoch before a replacement exists');

  const replacement = await f.host.getRuntimeSupervisorClientForBackend(backend, { deferConnection: true });
  replacement.options.onSessionOutput({ kind: 'terminal', sessionId: 'session-1', chunk: 'current', outputSequence: 4 });
  assert.equal(callbacks, 1, 'the replacement client receives callbacks after a new epoch is assigned');

  f.host.closeRuntimeSupervisorEventAdmission();
  assert.strictEqual(
    await f.host.getRuntimeSupervisorClientForBackend(backend, {
      deferConnection: true,
      allowClosedAdmission: true,
      requireExistingClient: true
    }),
    replacement,
    'an existing client remains available for an accepted boundary cleanup'
  );
  f.host.disposeRuntimeSupervisorClients();
  await assert.rejects(
    f.host.getRuntimeSupervisorClientForBackend(backend, { deferConnection: true }),
    /closed runtime client admission/
  );
}

async function testNonPermanentBoundaryKeepsAdmissionOpen() {
  const f = makeHost();
  await f.host.prepareForHostBoundary({
    preserveLiveRuntime: true,
    allowRuntimeSupervisorRestart: false
  });
  assert.equal(f.host.runtimeSupervisorEventAdmissionOpen, true,
    'non-permanent reset/reload boundaries keep Runtime admission available');
}

async function testDeactivationIsIdempotentAndDoesNotStopRemoteSession() {
  const f = makeHost();
  let now = 0;
  let disposed = 0;
  let closeAdmissionCalls = 0;
  const client = {
    dispose() { disposed += 1; },
    stopSession() { f.remoteCalls.push('stop'); },
    deleteSession() { f.remoteCalls.push('delete'); }
  };
  f.host.runtimeSupervisorClients = new Map([['original', client]]);
  f.host.nonNativeExecutionOwner = {
    options: {
      capabilities: ['execution-owner-boundary-v1'],
      scheduler: { now: () => now, scheduleDeadline: () => () => {} },
      budgets: { boundaryMs: 100 }
    },
    closeAdmission() { closeAdmissionCalls += 1; },
    snapshot: () => ({ pending: 0 })
  };
  f.host.hasNonNativeHostPersistence = () => false;
  f.host.beginNonNativeHostExecutionClose = async () => ({ kind: 'settled', pending: [] });
  const first = f.host.prepareForDeactivation();
  const second = f.host.prepareForDeactivation();
  const [report, repeatedReport] = await Promise.all([first, second]);
  assert.strictEqual(report, repeatedReport);
  assert.equal(report.kind, 'settled');
  assert.equal(closeAdmissionCalls, 1);
  assert.equal(disposed, 1);
  assert.deepEqual(f.remoteCalls, []);
  now = 100;
  assert.strictEqual(await f.host.prepareForDeactivation(), report);
}

async function testOrdinaryDeactivationClosesAdmissionBeforeCoreFlush() {
  const f = makeHost();
  let disposed = 0;
  f.host.isRuntimePersistenceEnabled = () => true;
  f.host.readStartupConfiguration = () => ({ runtimePersistenceEnabled: true });
  f.host.runtimeSupervisorClients.set('original', { dispose() { disposed += 1; } });
  let flushes = 0;
  const originalFlushLiveExecutionState = f.host.flushLiveExecutionState.bind(f.host);
  f.host.flushLiveExecutionState = (...args) => {
    flushes += 1;
    return originalFlushLiveExecutionState(...args);
  };
  f.host.queueExecutionStateSync('terminal', 'terminal-1', 1000);
  f.session.reconnectTimer = setTimeout(() => assert.fail('reconnect timer was not cancelled'), 1000);
  f.session.outputFlushTimer = setTimeout(() => assert.fail('output timer was not cancelled'), 1000);
  f.session.pendingOutput = 'queued output';

  let releaseCallback;
  const acceptedCallback = new Promise(resolve => { releaseCallback = resolve; });
  f.host.trackRuntimeSupervisorStateCallback(acceptedCallback);
  let settled = false;
  const boundary = f.host.prepareForDeactivation();
  void boundary.then(() => { settled = true; });
  await sleep();
  assert.equal(settled, false, 'ordinary boundary waits for an accepted Runtime state callback');
  releaseCallback();
  await boundary;
  assert.equal(f.host.runtimeSupervisorEventAdmissionOpen, false);
  assert.equal(disposed, 1, 'ordinary boundary still detaches the original Host client');
  assert.equal(f.host.terminalSessions.size, 0, 'ordinary boundary retires Host session maps');
  assert.equal(f.host.runtimeSessionBindings.size, 0);
  assert.equal(flushes, 1, 'ordinary boundary flushes the active Runtime session once');
  assert.equal(f.persisted.length, 1, 'ordinary boundary writes one final immediate snapshot');
  assert.equal(f.persisted[0].options.mode, 'immediate');
  const metadata = f.persisted[0].state.nodes[0].metadata.terminal;
  assert.equal(metadata.lastCols, 119);
  assert.equal(metadata.lastRows, 41);
  assert.equal(metadata.liveSession, true);
  assert.equal(metadata.runtimeSessionId, 'session-1');
  assert.equal(f.session.reconnectTimer, undefined);
  assert.equal(f.session.outputFlushTimer, undefined);
  assert.equal(f.session.pendingOutput, '');

  f.host.queueExecutionStateSync('terminal', 'terminal-1', 0);
  await sleep(10);
  assert.equal(flushes, 1, 'late ordinary-boundary timer cannot revive the old session');
}

async function testOrdinaryDeactivationSharesInFlightBoundary() {
  const f = makeHost();
  f.host.isRuntimePersistenceEnabled = () => true;
  f.host.readStartupConfiguration = () => ({ runtimePersistenceEnabled: true });
  let disposed = 0;
  f.host.runtimeSupervisorClients.set('original', { dispose() { disposed += 1; } });
  let flushes = 0;
  const originalFlushLiveExecutionState = f.host.flushLiveExecutionState.bind(f.host);
  f.host.flushLiveExecutionState = (...args) => {
    flushes += 1;
    return originalFlushLiveExecutionState(...args);
  };
  let releaseCallback;
  const acceptedCallback = new Promise(resolve => { releaseCallback = resolve; });
  f.host.trackRuntimeSupervisorStateCallback(acceptedCallback);

  const first = f.host.prepareForDeactivation();
  const second = f.host.prepareForDeactivation();
  await sleep();
  releaseCallback();
  await Promise.all([first, second]);

  assert.equal(disposed, 1, 'concurrent ordinary deactivation shares one client detach');
  assert.equal(flushes, 1, 'concurrent ordinary deactivation performs one final live-state flush');
  assert.equal(f.persisted.length, 1, 'concurrent ordinary deactivation performs one final snapshot');
}

async function testOrdinaryDeactivationRetainsSuccess(preserveLiveRuntime) {
  const f = makeHost();
  let configuredPersistence = preserveLiveRuntime;
  let configurationReads = 0;
  let acquisitions = 0;
  let disposals = 0;
  const deletes = [];
  const client = {
    async deleteSession(request) { deletes.push(request.sessionId); },
    dispose() { disposals += 1; }
  };
  f.host.runtimeSupervisorClients.set('original', client);
  f.host.isRuntimePersistenceEnabled = () => true;
  f.host.readStartupConfiguration = () => {
    configurationReads += 1;
    return { runtimePersistenceEnabled: configuredPersistence };
  };
  f.host.getRuntimeSupervisorClientForKind = async (_kind, options) => {
    acquisitions += 1;
    assert.equal(f.host.runtimeSupervisorEventAdmissionOpen, false);
    assert.equal(options.allowRestart, false);
    assert.equal(options.allowClosedAdmission, true);
    assert.equal(options.requireExistingClient, true);
    return client;
  };

  const first = f.host.prepareForDeactivation();
  assert.equal(f.host.runtimeSupervisorEventAdmissionOpen, false,
    'the first permanent call closes admission before returning to the caller');
  configuredPersistence = !preserveLiveRuntime;
  const second = f.host.prepareForDeactivation();
  await Promise.all([first, second]);
  await f.host.prepareForDeactivation();
  assert.equal(configurationReads, 1, 'all repeated calls keep the first shutdown policy');
  assert.equal(disposals, 1);
  assert.equal(f.persisted.length, 1);
  assert.equal(acquisitions, preserveLiveRuntime ? 0 : 1);
  assert.deepEqual(deletes, preserveLiveRuntime ? [] : ['session-1'],
    'detach never becomes delete and accepted cleanup never runs twice');
  assert.equal(f.host.runtimeSupervisorEventAdmissionOpen, false,
    'a completed permanent boundary does not reopen admission');
}

async function testOrdinaryDeactivationRetainsFailure() {
  const f = makeHost();
  f.host.isRuntimePersistenceEnabled = () => true;
  let configurationReads = 0;
  f.host.readStartupConfiguration = () => {
    configurationReads += 1;
    return { runtimePersistenceEnabled: true };
  };
  const failure = new Error('controlled boundary flush failure');
  let shouldFail = true;
  let flushAttempts = 0;
  f.host.flushDeferredCanvasStatePersist = async () => {
    flushAttempts += 1;
    if (shouldFail) throw failure;
  };
  let disposals = 0;
  f.host.runtimeSupervisorClients.set('original', { dispose() { disposals += 1; } });

  const results = await Promise.allSettled([
    f.host.prepareForDeactivation(), f.host.prepareForDeactivation()
  ]);
  for (const result of results) {
    assert.equal(result.status, 'rejected');
    assert.strictEqual(result.reason, failure);
  }
  shouldFail = false;
  await assert.rejects(f.host.prepareForDeactivation(), error => error === failure,
    'a later call cannot turn the first failed permanent boundary into success');
  assert.equal(configurationReads, 1);
  assert.equal(flushAttempts, 1, 'failure does not schedule a second cleanup');
  assert.equal(f.persisted.length, 1);
  assert.equal(disposals, 0, 'the failure is preserved at its original cleanup step');
  assert.equal(f.host.runtimeSupervisorEventAdmissionOpen, false);
}

async function testOrdinaryDeactivationRetainsConfigurationFailure() {
  const f = makeHost();
  const failure = new Error('controlled configuration failure');
  let configurationReads = 0;
  f.host.readStartupConfiguration = () => {
    configurationReads += 1;
    throw failure;
  };
  await assert.rejects(f.host.prepareForDeactivation(), error => error === failure);
  await assert.rejects(f.host.prepareForDeactivation(), error => error === failure);
  assert.equal(configurationReads, 1, 'a synchronous setup error is also retained');
  assert.equal(f.persisted.length, 0);
}

async function makeRootHost() {
  const f = makeHost();
  const rootA = { id: 'root-a', role: 'workspace-root', workspaceRootPath: '/controlled/root-a',
    title: 'Root A', position: { x: 0, y: 0 }, size: { width: 900, height: 700 } };
  const rootB = { ...rootA, id: 'root-b', workspaceRootPath: '/controlled/root-b', title: 'Root B',
    position: { x: 1000, y: 0 } };
  f.node.groupId = rootA.id;
  const nodeB = structuredClone(f.node);
  nodeB.id = 'terminal-2';
  nodeB.groupId = rootB.id;
  nodeB.metadata.terminal.runtimeSessionId = 'session-2';
  const sessionB = { ...makeSession(), sessionId: 'session-2', runtimeSessionId: 'session-2' };
  f.host.terminalSessions.set(nodeB.id, sessionB);
  f.host.runtimeSessionBindings.set(
    f.host.buildRuntimeSessionBindingKey('terminal', 'session-2', '/controlled/runtime', 'legacy-detached'),
    { kind: 'terminal', nodeId: nodeB.id, runtimeSessionId: 'session-2' }
  );
  f.host.state = { ...f.host.state, nodes: [f.node, nodeB], groups: [rootA, rootB] };
  const snapshots = [];
  const deletes = [];
  let disposals = 0;
  Object.assign(f.host, {
    activeSurface: undefined,
    executionSessionOperationTokens: new Map(),
    pendingTerminalInitialInputDispatches: new Map(),
    activeAssociatedNoteMarkdownEdits: new Map(),
    getMultiRootWorkspaceFoldersForComposition: () => [
      { path: rootA.workspaceRootPath, name: rootA.title },
      { path: rootB.workspaceRootPath, name: rootB.title }
    ],
    getRuntimeHostBaseStoragePath: () => '/controlled/runtime',
    getRuntimeStoragePathFromBackend: () => '/controlled/runtime',
    getRuntimeSupervisorScriptPath: () => '/controlled/supervisor.js',
    getRuntimeSupervisorLauncherScriptPath: () => '/controlled/launcher.js',
    writeRootLocalCanvasSnapshot: (rootPath, state) => snapshots.push({ rootPath, state }),
    reconcileCanvasFileArtifacts: state => state,
    notifySidebarStateChanged() {},
    bridgeExecutionAttentionSignals: async () => undefined,
    queueExecutionStateSync() {},
    queueExecutionOutput() {},
    recordExecutionPerformanceDiagnostics() {},
    postExecutionExitWithFinalSnapshot: async () => undefined
  });
  const backend = {
    kind: 'legacy-detached', guarantee: 'best-effort', label: 'controlled',
    paths: { storageDir: '/controlled/runtime/storage', socketPath: '/controlled/runtime/socket' },
    startSupervisor: async () => undefined
  };
  f.host.getRuntimeHostBackend = () => backend;
  const client = await f.host.getRuntimeSupervisorClientForBackend(backend, { deferConnection: true });
  client.ensureConnected = async () => undefined;
  client.deleteSession = async request => { deletes.push(request.sessionId); };
  client.dispose = () => { disposals += 1; };
  const emitRootBOutput = chunk => client.options.onSessionOutput({
    kind: 'terminal', sessionId: 'session-2', chunk, outputSequence: sessionB.outputSequence + 1
  });
  return { ...f, rootA, rootB, nodeB, sessionB, client, snapshots, deletes, emitRootBOutput,
    getDisposals: () => disposals };
}

async function testRootBoundaryPreservesOtherRootAndStrictFailure(mode, failDelete) {
  const f = await makeRootHost();
  const deletion = deferred();
  const deletionStarted = deferred();
  const failure = new Error('controlled strict root deletion failure');
  f.client.deleteSession = async request => {
    f.deletes.push(request.sessionId);
    deletionStarted.resolve();
    await deletion.promise;
  };
  const stateBefore = structuredClone(f.host.state);
  const bindingBefore = [...f.host.runtimeSessionBindings.entries()];
  const operation = mode === 'clear'
    ? f.host.clearWorkspaceRootCanvas(f.rootA.workspaceRootPath)
    : f.host.prepareWorkspaceRootCanvasForTemplateReset(f.rootA, f.rootA.workspaceRootPath);
  const observed = operation.then(value => ({ value }), error => ({ error }));
  await Promise.race([deletionStarted.promise, observed.then(result => {
    if (result.error) throw result.error;
    assert.fail('root cleanup returned before issuing the controlled strict delete');
  })]);
  f.emitRootBOutput(' during root A cleanup');
  assert.equal(f.sessionB.buffer, 'live output during root A cleanup');
  assert.equal(f.sessionB.outputSequence, 3);
  assert.equal(f.host.runtimeSupervisorEventAdmissionOpen, true);
  assert.strictEqual(f.host.terminalSessions.get(f.nodeB.id), f.sessionB);
  assert.equal(f.sessionB.stopRequested, false);
  assert.equal(f.getDisposals(), 0, 'root A cleanup does not dispose the shared Supervisor client');

  if (failDelete) deletion.reject(failure);
  else deletion.resolve();
  const result = await observed;
  assert.deepEqual(f.deletes, ['session-1'], 'root cleanup only deletes its original session');
  if (failDelete) {
    if (mode === 'clear') assert.equal(result.value, false);
    else assert.equal(result.error?.message, failure.message);
    assert.deepEqual(f.host.state, stateBefore, 'strict delete failure preserves the composed state');
    assert.strictEqual(f.host.terminalSessions.get(f.node.id), f.session);
    assert.equal(f.session.stopRequested, false);
    assert.deepEqual([...f.host.runtimeSessionBindings.entries()], bindingBefore);
    assert.deepEqual(f.snapshots, [], 'strict delete failure never saves an empty root');
    assert.deepEqual(f.persisted, []);
  } else {
    assert.equal(result.error, undefined);
    assert.equal(f.host.terminalSessions.has(f.node.id), false);
    if (mode === 'clear') {
      assert.equal(result.value, true);
      assert.deepEqual(f.host.state.nodes.map(node => node.id), [f.nodeB.id]);
      assert.deepEqual(f.snapshots.map(snapshot => snapshot.rootPath), [f.rootA.workspaceRootPath]);
    } else {
      assert.deepEqual(f.host.state, stateBefore, 'template preparation leaves replacement to the caller');
      assert.deepEqual(f.snapshots, []);
    }
  }
  f.emitRootBOutput(' after root A cleanup');
  assert.equal(f.sessionB.buffer, 'live output during root A cleanup after root A cleanup');
  assert.equal(f.sessionB.stopRequested, false);
  assert.equal(f.getDisposals(), 0);
}

async function startDelayedCompletedCallback(f) {
  const completedPersistence = deferred();
  const callbackEnteredPersistence = deferred();
  const persist = f.host.persistState;
  f.host.persistState = options => {
    if (options.reason === 'runtime-supervisor-completed-snapshot') {
      callbackEnteredPersistence.resolve();
      return completedPersistence.promise;
    }
    return persist(options);
  };
  f.client.options.onSessionState({
    kind: f.node.kind, sessionId: 'session-1', live: false,
    lifecycle: f.node.kind === 'agent' ? 'stopped' : 'closed',
    runtimeBackend: 'legacy-detached', output: 'tail', cols: 119, rows: 41
  });
  await Promise.race([
    callbackEnteredPersistence.promise,
    f.host.waitForPendingRuntimeSupervisorStateCallbacks().then(() => {
      assert.fail(`completed callback did not reach persistence: ${JSON.stringify(f.diagnostics)}`);
    })
  ]);
  assert.equal(f.host.pendingRuntimeSupervisorStateCallbacks.size, 1);
  return completedPersistence;
}

async function testAcceptedCallbackCannotRollbackClearedRoot() {
  const f = await makeRootHost();
  const completedPersistence = await startDelayedCompletedCallback(f);
  assert.equal(await f.host.clearWorkspaceRootCanvas(f.rootA.workspaceRootPath), true);
  assert.deepEqual(f.host.state.nodes.map(node => node.id), [f.nodeB.id]);
  f.host.state = { ...f.host.state, nodes: f.host.state.nodes.map(node => ({ ...node, title: 'Root B edited' })) };
  f.emitRootBOutput(' while root A callback waits');
  completedPersistence.reject(new Error('controlled delayed completed persistence failure'));
  await f.host.waitForPendingRuntimeSupervisorStateCallbacks();
  assert.deepEqual(f.host.state.nodes.map(node => node.id), [f.nodeB.id],
    'an accepted callback failure must not restore root A after clear completed');
  assert.equal(f.host.state.nodes[0].title, 'Root B edited');
  assert.equal(f.sessionB.buffer, 'live output while root A callback waits');
  assert.equal(f.host.terminalSessions.has(f.node.id), false);
}

async function testCompletedFailureOnlyRollsBackOriginalExecution() {
  const f = await makeRootHost();
  const originalExecution = structuredClone(f.node);
  const completedPersistence = await startDelayedCompletedCallback(f);
  const groups = f.host.state.groups.map(group => ({ ...group, title: `${group.title} edited` }));
  f.host.state = {
    ...f.host.state,
    groups,
    nodes: f.host.state.nodes.map(node => ({
      ...node, title: `${node.id} edited`, position: { x: 250, y: 350 },
      metadata: { ...node.metadata, annotation: 'edited during completion' }
    }))
  };
  const changedNodeB = structuredClone(f.host.state.nodes.find(node => node.id === f.nodeB.id));
  const rootLocalStates = [{ rootPath: f.rootB.workspaceRootPath, state: { marker: 'latest root cache' } }];
  const overlay = { marker: 'latest overlay' };
  f.host.lastLoadedRootLocalStates = rootLocalStates;
  f.host.multiRootOverlay = overlay;
  completedPersistence.reject(new Error('controlled completed persistence failure'));
  await f.host.waitForPendingRuntimeSupervisorStateCallbacks();

  const nodeA = f.host.state.nodes.find(node => node.id === f.node.id);
  assert.equal(nodeA.status, originalExecution.status);
  assert.equal(nodeA.summary, originalExecution.summary);
  assert.deepEqual(nodeA.metadata.terminal, originalExecution.metadata.terminal,
    'failed completion restores only its original execution fields');
  assert.equal(nodeA.title, `${f.node.id} edited`);
  assert.deepEqual(nodeA.position, { x: 250, y: 350 });
  assert.equal(nodeA.metadata.annotation, 'edited during completion');
  assert.deepEqual(f.host.state.nodes.find(node => node.id === f.nodeB.id), changedNodeB);
  assert.strictEqual(f.host.state.groups, groups);
  assert.strictEqual(f.host.lastLoadedRootLocalStates, rootLocalStates);
  assert.strictEqual(f.host.multiRootOverlay, overlay);
  assert.strictEqual(f.host.terminalSessions.get(f.node.id), f.session);
  assert.equal(f.host.runtimeSessionBindings.size, 2);
  assert.deepEqual(f.deletes, [], 'failed completion cannot delete the original live binding');
}

async function testCompletedContinuationCannotChangeReplacement(failPersistence) {
  const f = await makeRootHost();
  const completedPersistence = await startDelayedCompletedCallback(f);
  const successor = { ...makeSession(), sessionId: 'successor', runtimeSessionId: 'successor' };
  const successorNode = {
    ...structuredClone(f.node), title: 'Replacement execution',
    metadata: { terminal: { ...f.node.metadata.terminal, runtimeSessionId: 'successor' } }
  };
  f.host.state = { ...f.host.state, nodes: f.host.state.nodes.map(node => node.id === f.node.id ? successorNode : node) };
  f.host.terminalSessions.set(f.node.id, successor);
  f.host.unbindRuntimeSession('session-1', '/controlled/runtime', 'terminal', 'legacy-detached');
  const successorBindingKey = f.host.buildRuntimeSessionBindingKey(
    'terminal', 'successor', '/controlled/runtime', 'legacy-detached'
  );
  const successorBinding = { kind: 'terminal', nodeId: f.node.id, runtimeSessionId: 'successor' };
  f.host.runtimeSessionBindings.set(successorBindingKey, successorBinding);
  if (failPersistence) completedPersistence.reject(new Error('controlled stale completion failure'));
  else completedPersistence.resolve();
  await f.host.waitForPendingRuntimeSupervisorStateCallbacks();

  assert.strictEqual(f.host.state.nodes.find(node => node.id === f.node.id), successorNode,
    'an old completed continuation cannot replace the successor node');
  assert.strictEqual(f.host.terminalSessions.get(f.node.id), successor,
    'an old completed continuation cannot dispose the successor session');
  assert.strictEqual(f.host.runtimeSessionBindings.get(successorBindingKey), successorBinding);
  assert.equal(successor.stopRequested, false);
  assert.equal(f.deletes.includes('successor'), false);
}

function makeRootAAgent(f) {
  f.host.terminalSessions.delete(f.node.id);
  f.host.unbindRuntimeSession('session-1', '/controlled/runtime', 'terminal', 'legacy-detached');
  f.node.kind = 'agent';
  f.node.metadata = { agent: {
    ...f.node.metadata.terminal, provider: 'codex', resumeStrategy: 'none', lifecycle: 'running'
  } };
  f.session.agentProvider = 'codex';
  f.host.agentSessions.set(f.node.id, f.session);
  f.host.runtimeSessionBindings.set(
    f.host.buildRuntimeSessionBindingKey('agent', 'session-1', '/controlled/runtime', 'legacy-detached'),
    { kind: 'agent', nodeId: f.node.id, runtimeSessionId: 'session-1' }
  );
}

async function testAgentCompletedFailurePreservesConcurrentEdits() {
  const f = await makeRootHost();
  makeRootAAgent(f);
  const originalAgent = structuredClone(f.node);
  const completedPersistence = await startDelayedCompletedCallback(f);
  f.host.state = { ...f.host.state, nodes: f.host.state.nodes.map(node => ({
    ...node, title: `${node.id} concurrently edited`, position: { x: 425, y: 525 }
  })) };
  const editedRootB = structuredClone(f.host.state.nodes.find(node => node.id === f.nodeB.id));
  f.emitRootBOutput(' during agent finalization');
  completedPersistence.reject(new Error('controlled Agent completed persistence failure'));
  await f.host.waitForPendingRuntimeSupervisorStateCallbacks();

  const agent = f.host.state.nodes.find(node => node.id === f.node.id);
  assert.equal(agent.status, originalAgent.status);
  assert.equal(agent.summary, originalAgent.summary);
  assert.deepEqual(agent.metadata.agent, originalAgent.metadata.agent);
  assert.equal(agent.title, `${f.node.id} concurrently edited`);
  assert.deepEqual(agent.position, { x: 425, y: 525 });
  assert.deepEqual(f.host.state.nodes.find(node => node.id === f.nodeB.id), editedRootB);
  assert.equal(f.sessionB.buffer, 'live output during agent finalization');
  assert.strictEqual(f.host.agentSessions.get(f.node.id), f.session);
  assert.equal(f.host.runtimeSessionBindings.size, 2);
  assert.deepEqual(f.deletes, []);
}

async function testAgentCompletedSuccessCannotDisposeReplacement() {
  const f = await makeRootHost();
  makeRootAAgent(f);
  const completedPersistence = await startDelayedCompletedCallback(f);
  const successor = { ...makeSession(), sessionId: 'agent-successor', runtimeSessionId: 'agent-successor',
    agentProvider: 'codex' };
  const successorNode = {
    ...structuredClone(f.node), title: 'Replacement Agent',
    metadata: { agent: { ...f.node.metadata.agent, runtimeSessionId: 'agent-successor' } }
  };
  f.host.state = { ...f.host.state, nodes: f.host.state.nodes.map(node => node.id === f.node.id ? successorNode : node) };
  f.host.agentSessions.set(f.node.id, successor);
  f.host.unbindRuntimeSession('session-1', '/controlled/runtime', 'agent', 'legacy-detached');
  const successorBindingKey = f.host.buildRuntimeSessionBindingKey(
    'agent', 'agent-successor', '/controlled/runtime', 'legacy-detached'
  );
  const successorBinding = { kind: 'agent', nodeId: f.node.id, runtimeSessionId: 'agent-successor' };
  f.host.runtimeSessionBindings.set(successorBindingKey, successorBinding);
  let fileActivityDisposals = 0;
  let exits = 0;
  f.host.disposeAgentFileActivitySession = async () => { fileActivityDisposals += 1; };
  f.host.postExecutionExitWithFinalSnapshot = async () => { exits += 1; };
  completedPersistence.resolve();
  await f.host.waitForPendingRuntimeSupervisorStateCallbacks();

  assert.strictEqual(f.host.state.nodes.find(node => node.id === f.node.id), successorNode);
  assert.strictEqual(f.host.agentSessions.get(f.node.id), successor);
  assert.strictEqual(f.host.runtimeSessionBindings.get(successorBindingKey), successorBinding);
  assert.equal(successor.stopRequested, false);
  assert.equal(fileActivityDisposals, 0, 'stale Agent completion cannot dispose successor file activity');
  assert.equal(exits, 0, 'stale Agent completion cannot post an exit for its replacement');
  assert.equal(f.deletes.includes('agent-successor'), false);
}

async function testReaderWaitCannotPersistOrNotifyAfterRootChanges(mode) {
  const f = await makeRootHost();
  const readers = deferred();
  const readerWaitStarted = deferred();
  const readerKeys = [];
  f.host.terminalReadRelay.completeRemote = async key => {
    readerKeys.push(key);
    if (readerKeys.length === 2) readerWaitStarted.resolve();
    await readers.promise;
  };
  let exits = 0;
  f.host.postExecutionExitWithFinalSnapshot = async () => { exits += 1; };
  f.client.options.onSessionState({
    kind: 'terminal', sessionId: 'session-1', live: false, lifecycle: 'closed',
    runtimeBackend: 'legacy-detached', output: 'tail', cols: 119, rows: 41,
    terminalStreamPaged: true, terminalAuthorityId: 'controlled-authority',
    terminalRevision: 2, outputSequence: 2
  });
  await Promise.race([
    readerWaitStarted.promise,
    f.host.waitForPendingRuntimeSupervisorStateCallbacks().then(() => {
      assert.fail(`completed callback did not wait for readers: ${JSON.stringify(f.diagnostics)}`);
    })
  ]);
  assert.deepEqual(readerKeys, [`editor:terminal:${f.node.id}`, `panel:terminal:${f.node.id}`]);
  assert.equal(f.host.pendingRuntimeSupervisorStateCallbacks.size, 1);
  assert.equal(f.persisted.length, 0, 'completed persistence waits for both readers');
  let successor;
  let successorNode;
  let successorBindingKey;
  if (mode === 'clear') {
    assert.equal(await f.host.clearWorkspaceRootCanvas(f.rootA.workspaceRootPath), true);
  } else {
    successor = { ...makeSession(), sessionId: 'reader-successor', runtimeSessionId: 'reader-successor' };
    successorNode = {
      ...structuredClone(f.node), title: 'Replacement during reader wait',
      metadata: { terminal: { ...f.node.metadata.terminal, runtimeSessionId: 'reader-successor' } }
    };
    f.host.state = { ...f.host.state, nodes: f.host.state.nodes.map(node => node.id === f.node.id ? successorNode : node) };
    f.host.terminalSessions.set(f.node.id, successor);
    f.host.unbindRuntimeSession('session-1', '/controlled/runtime', 'terminal', 'legacy-detached');
    successorBindingKey = f.host.buildRuntimeSessionBindingKey(
      'terminal', 'reader-successor', '/controlled/runtime', 'legacy-detached'
    );
    f.host.runtimeSessionBindings.set(successorBindingKey,
      { kind: 'terminal', nodeId: f.node.id, runtimeSessionId: 'reader-successor' });
  }
  f.emitRootBOutput(' during reader finalization');
  readers.resolve();
  await f.host.waitForPendingRuntimeSupervisorStateCallbacks();

  assert.equal(f.persisted.filter(entry => entry.options.reason === 'runtime-supervisor-completed-snapshot').length, 0,
    'a stale completed callback cannot begin persistence after its reader wait');
  assert.equal(exits, 0, 'a stale completed callback cannot post an exit after its reader wait');
  assert.equal(f.sessionB.buffer, 'live output during reader finalization');
  if (mode === 'clear') {
    assert.deepEqual(f.host.state.nodes.map(node => node.id), [f.nodeB.id]);
    assert.equal(f.host.terminalSessions.has(f.node.id), false);
    assert.deepEqual(f.deletes, ['session-1']);
  } else {
    assert.strictEqual(f.host.state.nodes.find(node => node.id === f.node.id), successorNode);
    assert.strictEqual(f.host.terminalSessions.get(f.node.id), successor);
    assert.equal(f.host.runtimeSessionBindings.get(successorBindingKey).runtimeSessionId, 'reader-successor');
    assert.equal(successor.stopRequested, false);
    assert.deepEqual(f.deletes, []);
  }
}

await testFinalFlushProjectsResizeAndKeepsRemoteAlive();
await testAdmissionRejectsLateTimerAndEvents();
await testCompletedStateCannotBeReplacedByOldTimer();
await testStateCallbacksAreTrackedAndBoundaryIsIdempotent();
await testDisposedClientEpochRejectsCallbacksBeforeReplacement();
await testDeactivationIsIdempotentAndDoesNotStopRemoteSession();
await testOrdinaryDeactivationClosesAdmissionBeforeCoreFlush();
await testOrdinaryDeactivationSharesInFlightBoundary();
await testOrdinaryDeactivationRetainsSuccess(true);
await testOrdinaryDeactivationRetainsSuccess(false);
await testOrdinaryDeactivationRetainsFailure();
await testOrdinaryDeactivationRetainsConfigurationFailure();
await testNonPermanentBoundaryKeepsAdmissionOpen();
await testRootBoundaryPreservesOtherRootAndStrictFailure('clear', false);
await testRootBoundaryPreservesOtherRootAndStrictFailure('clear', true);
await testRootBoundaryPreservesOtherRootAndStrictFailure('template', false);
await testRootBoundaryPreservesOtherRootAndStrictFailure('template', true);
await testAcceptedCallbackCannotRollbackClearedRoot();
await testCompletedFailureOnlyRollsBackOriginalExecution();
await testCompletedContinuationCannotChangeReplacement(false);
await testCompletedContinuationCannotChangeReplacement(true);
await testAgentCompletedFailurePreservesConcurrentEdits();
await testAgentCompletedSuccessCannotDisposeReplacement();
await testReaderWaitCannotPersistOrNotifyAfterRootChanges('clear');
await testReaderWaitCannotPersistOrNotifyAfterRootChanges('replace');
console.log('runtime Host deactivation integrity tests passed (flush, admission, stale overwrite, callback tracking, idempotence)');
