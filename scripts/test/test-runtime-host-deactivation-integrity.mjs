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
    pendingRuntimeSupervisorOperations: new Set(),
    nonNativeHostExecutions: new Map(),
    terminalProjectionRefreshScheduler: { clearMatching() {} },
    terminalReadRelay: { closeMatching() {} },
    scheduledExecutionOutputPosts: new Map(),
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

await testFinalFlushProjectsResizeAndKeepsRemoteAlive();
await testAdmissionRejectsLateTimerAndEvents();
await testCompletedStateCannotBeReplacedByOldTimer();
await testStateCallbacksAreTrackedAndBoundaryIsIdempotent();
await testDeactivationIsIdempotentAndDoesNotStopRemoteSession();
console.log('runtime Host deactivation integrity tests passed (flush, admission, stale overwrite, callback tracking, idempotence)');
