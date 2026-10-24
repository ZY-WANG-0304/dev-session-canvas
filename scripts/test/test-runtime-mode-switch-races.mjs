import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

import esbuild from 'esbuild';

const cwd = process.cwd();
const baselineRef = process.argv.find(value => value.startsWith('--baseline-ref='))?.slice('--baseline-ref='.length);
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
      export { TerminalAvailableNotifications } from './extensions/vscode/dev-session-canvas/src/panel/terminalAvailableNotifications';
    `,
    resolveDir: cwd,
    sourcefile: 'runtime-mode-switch-races.ts'
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
      if (baselineRef) build.onLoad({ filter: /src\/panel\/CanvasPanelManager\.ts$/ }, args => ({
        loader: 'ts', contents: execFileSync('git', ['show', `${baselineRef}:${path.relative(cwd, args.path)}`], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
      }));
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
  path.resolve('scripts/test/runtime-mode-switch-races.cjs'), path.resolve('scripts/test')
);
const { CanvasPanelManager, TerminalAvailableNotifications } = loaded.exports;

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
  host.terminalAvailableNotifications = new TerminalAvailableNotifications();
  Object.assign(host, {
    context: { extensionMode: 3, extensionUri: { fsPath: cwd } },
    appliedStartupConfiguration: { runtimePersistenceEnabled: false },
    rawExtensionStoragePath: path.join(cwd, 'controlled-workspace-slot'),
    resolveRuntimeCreationTarget: async rootPath => ({ rootPath, runtimeStoragePath: '/controlled/runtime' }),
    state: { version: 1, nodes: [node], edges: [], groups: [] },
    activeSurface: 'editor',
    agentSessions: new Map(),
    terminalSessions,
    runtimeSessionBindings: new Map([['terminal:session-1:/controlled/runtime:legacy-detached', {
      kind: 'terminal', nodeId: 'terminal-1', runtimeSessionId: 'session-1'
    }]]),
    runtimeSupervisorClients: new Map(),
    executionSessionOperationTokens: new Map(),
    preferredRootRuntimeBackends: new Map(),
    runtimeSupervisorEventAdmissionOpen: true,
    runtimeSupervisorClientEpochs: new Map(),
    pendingRuntimeSupervisorOperations: new Set(),
    nonNativeHostExecutions: new Map(),
    terminalProjectionRefreshScheduler: { clearMatching() {} },
    terminalReadRelay: { closeMatching() {}, usesClient: () => false },
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

async function modeSwitchFixture(shared) {
  const f = makeHost();
  f.host.appliedStartupConfiguration = { runtimePersistenceEnabled: true };
  f.host.readStartupConfiguration = () => ({ runtimePersistenceEnabled: false });
  Object.assign(f.host, {
    getExecutionCandidateProfile: () => 'linux-owner-v1-candidate',
    getExecutionCandidateScheduler: () => ({ now: () => Date.now(), scheduleDeadline: (limit, fire) => {
      const timer = setTimeout(fire, Math.max(1, limit - Date.now())); return () => clearTimeout(timer);
    } }),
    flushAllExecutionSessionStatesForHostBoundary: async () => {},
    getCanvasPersistenceWorkspaceFolders: () => [{ path: '/controlled/root-a' }],
    resolveExecutionNodeRuntimeRoot: () => '/controlled/root-a',
    captureSharedSupervisorProcesses: async () => new Set(),
    applySharedRootCanvasState() {},
    getDebugSnapshot: () => ({ state: f.host.state }),
    getSurfaceLifecycleIdentity: () => undefined,
    shouldPreserveLiveRuntimeAcrossHostBoundary: () => false,
    applyStartupConfiguration: config => { f.host.appliedStartupConfiguration = config; f.host.sharedModeSwitchDetachedRoots = undefined; },
    refreshStorageRecoverySelection() {}, loadStoredCanvasFileFilterState: () => ({}),
    loadReconciledState: () => f.host.state, readCanvasTemplateInitializedFlag: () => true,
    loadStoredSurface: () => undefined, applyWorkbenchContextKeys() {}, notifySidebarStateChanged() {},
    scheduleRestoreLiveRuntimeSessions() {}, prepareOrdinaryDeactivation: async () => {}
  });
  const published = [];
  if (shared) f.host.sharedRootCanvasStores = new Map([['/controlled/root-a', {
    admissionPort: 32000, flush: async () => {}, dispose() {}, transferredPids: async () => [],
    depart: async action => action(true, f.host.state, { beginSettlement: () => true, settle() {}, preserved: false }),
    publish: async state => { published.push(structuredClone(state)); }
  }]]);
  const backend = f.host.getRuntimeHostBackend('legacy-detached', '/controlled/runtime');
  const client = await f.host.getRuntimeSupervisorClientForBackend(backend, { deferConnection: true });
  return { ...f, client, published };
}

for (const shared of [false, true]) {
  for (const entry of ['simulateRuntimeReloadForTest', 'prepareForDeactivation']) {
    const f = await modeSwitchFixture(shared);
    const deleteEntered = deferred(), deletion = deferred(), saveEntered = deferred(), saved = deferred();
    let deletes = 0, saves = 0, done = false;
    f.host.deleteRuntimeSupervisorSessions = async bindings => {
      assert.equal(bindings[0].sessionId, 'session-1');
      deletes++; deleteEntered.resolve(); await deletion.promise;
    };
    f.host.applyRuntimeSupervisorSnapshot = async () => {
      saves++; saveEntered.resolve(); await saved.promise;
      await f.host.persistState({ reason: 'original-callback-save' });
    };
    const cleanup = f.host[entry]().then(value => ({ value }), error => ({ error }))
      .then(result => { done = true; return result; });
    try {
      await deleteEntered.promise;
      f.client.options.onSessionState({ kind: 'terminal', sessionId: 'session-1', live: true });
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(saves, 1, JSON.stringify(f.diagnostics));
      await saveEntered.promise;
      deletion.resolve();
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(done, false, `${shared}/${entry}: deletion completion must wait for the accepted original save`);
      assert.equal(f.host.state.nodes.length, 1);
      f.client.options.onSessionState({ kind: 'terminal', sessionId: 'session-1', live: true });
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(saves, 1, 'After deletion confirmation, the original binding accepts no new save');
      saved.resolve();
      const result = await cleanup;
      assert.equal(result.error, undefined, result.error?.stack);
      assert.equal(deletes, 1);
      assert.equal(saves, 1, 'The callback accepted during deletion must finish');
      assert.equal(f.host.state.nodes.length, 0);
      assert.equal(f.host.runtimeSessionBindings.size, 0);
      assert.equal(f.host.pendingRuntimeSupervisorStateCallbacks.size, 0);
      if (shared) assert.equal(f.published.length, 1);
      f.client.options.onSessionState({ kind: 'terminal', sessionId: 'session-1', live: true });
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(saves, 1, 'A retired original callback cannot revive the cleared Canvas');
      console.log(`PASS original callback/save during deletion: shared=${shared}, entry=${entry}`);
    } finally {
      deletion.resolve(); saved.resolve(); await cleanup;
      f.host.disposeRuntimeSupervisorClients();
    }
  }
}

for (const shared of [false, true]) {
  const f = await modeSwitchFixture(shared), gate = deferred(), entered = deferred();
  let deletes = 0, failed = false;
  f.host.deleteRuntimeSupervisorSessions = async () => { deletes++; entered.resolve(); await gate.promise; };
  const persist = f.host.persistState;
  const failure = new Error('Original final canvas save failed');
  f.host.persistState = async options => {
    if (options.reason === 'runtime-persistence-mode-switch-cleanup' && !failed) {
      failed = true; throw failure;
    }
    return persist(options);
  };
  const first = f.host.cleanupRuntimePersistenceModeSwitch();
  await entered.promise;
  const second = f.host.cleanupRuntimePersistenceModeSwitch();
  const results = Promise.allSettled([first, second]);
  gate.resolve();
  assert.ok((await results).every(result => result.status === 'rejected' && result.reason === failure));
  assert.equal(deletes, 1, 'Concurrent callers share the original destructive work');
  await f.host.cleanupRuntimePersistenceModeSwitch();
  assert.equal(deletes, 1, 'Retrying a final save does not replay completed deletion');
  assert.equal(f.host.state.nodes.length, 0);
  assert.strictEqual(f.host.modeSwitchProgress.firstError, failure);
  if (shared) assert.equal(f.published.length, 1, 'Retrying workspace persistence must not clear a root again');
  f.host.disposeRuntimeSupervisorClients();
  console.log(`PASS concurrent cleanup and final-save continuation: shared=${shared}`);
}

{
  const f = await modeSwitchFixture(false);
  f.host.prepareStoppedLegacyHistoryRetirement = async () => undefined;
  let requests = 0;
  let current = { kind: 'unconfirmed', reason: 'Original request has no confirmed result yet' };
  f.client.deleteSessionStrict = () => {
    requests++;
    return { first: Promise.resolve(current), current: () => current, submitted: true, attemptSettled: false };
  };
  await assert.rejects(f.host.cleanupRuntimePersistenceModeSwitch(), /unconfirmed/);
  await assert.rejects(f.host.cleanupRuntimePersistenceModeSwitch(), /unconfirmed/);
  assert.equal(requests, 1, 'Unknown deletion is observed on its original request');
  current = { kind: 'legacy-acknowledged' };
  await f.host.cleanupRuntimePersistenceModeSwitch();
  assert.equal(requests, 1, 'A late result completes the original request without a replacement');
  assert.equal(f.host.state.nodes.length, 0);
  f.host.disposeRuntimeSupervisorClients();
  console.log('PASS unknown delete retains its request and late confirmation allows continuation');
}

{
  const f = await modeSwitchFixture(false), entered = deferred(), deletion = deferred();
  const failure = new Error('Accepted state callback failed to save');
  f.host.deleteRuntimeSupervisorSessions = async () => { entered.resolve(); await deletion.promise; };
  f.host.applyRuntimeSupervisorSnapshot = async () => { throw failure; };
  const cleanup = f.host.cleanupRuntimePersistenceModeSwitch();
  const result = cleanup.then(() => undefined, error => error);
  await entered.promise;
  f.client.options.onSessionState({ kind: 'terminal', sessionId: 'session-1', live: true });
  await new Promise(resolve => setImmediate(resolve));
  deletion.resolve();
  assert.strictEqual(await result, failure, 'A completed but failed callback cannot be reported as settled success');
  assert.equal(f.host.state.nodes.length, 1);
  f.host.disposeRuntimeSupervisorClients();
  console.log('PASS accepted callback save failure remains a cleanup failure');
}

{
  const f = await modeSwitchFixture(true), flush = deferred();
  const writes = [];
  Object.assign(f.host, {
    getCanvasPersistenceWorkspaceFolders: () => [{ path: '/controlled/root' }],
    syncNoteMarkdownFileWatchers() {}, cleanupUnreferencedNoteMarkdownRecoverableDraftFiles() {},
    writeRootLocalCanvasSnapshot() {}, recordStatePersistPerformance() {},
    queuePersistedCanvasSnapshotWrite: async (snapshot, options) => writes.push({ snapshot, options }),
    deleteRuntimeSupervisorSessions: async () => {}
  });
  let flushes = 0;
  f.host.flushSharedRootCanvasStores = async () => { if (++flushes === 1) await flush.promise; };
  const persist = CanvasPanelManager.prototype.persistState.call(f.host, { workspaceStateMode: 'full' });
  await f.host.cleanupRuntimePersistenceModeSwitch();
  const successor = { ...f.host.state, nodes: [{ ...f.node, id: 'new-node' }] };
  f.host.state = successor;
  f.host.lastLoadedRootLocalStates = [{ rootPath: '/controlled/root', state: successor }];
  flush.resolve(); await persist;
  assert.equal(writes.length, 1);
  assert.strictEqual(writes[0].snapshot.state, successor, 'A pre-switch workspace save cannot recreate the old graph');
  assert.strictEqual(writes[0].options.rootLocalStates[0].state, successor);
  f.host.disposeRuntimeSupervisorClients();
  console.log('PASS actual persistence rechecks mode generation before workspace write');
}

{
  const f = await modeSwitchFixture(false), entered = deferred(), deletion = deferred(), flush = deferred();
  const flushing = deferred();
  Object.assign(f.session, { terminalStreamPaged: true, terminalStreamHealthy: true, terminalAuthorityId: 'authority' });
  f.session.lineContextTracker.flush = async () => { flushing.resolve(); await flush.promise; };
  let applied = 0;
  f.host.applyRuntimeSupervisorSnapshot = async () => { applied++; await f.host.persistState({ reason: 'batch-state' }); };
  f.host.deleteRuntimeSupervisorSessions = async () => { entered.resolve(); await deletion.promise; };
  let done = false;
  const cleanup = f.host.cleanupRuntimePersistenceModeSwitch().then(() => { done = true; });
  await entered.promise;
  const batch = f.client.options.onSessionTerminalBatch({ kind: 'terminal', sessionId: 'session-1',
    authorityId: 'authority', batchId: 1, afterRevision: 2, revision: 2, events: [],
    snapshot: { kind: 'terminal', sessionId: 'session-1', live: true, terminalAuthorityId: 'authority', terminalRevision: 2 }
  }, () => true);
  await flushing.promise;
  deletion.resolve(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(done, false, 'Accepted batch consumption remains owned after delete confirmation');
  flush.resolve();
  assert.equal(await batch, 'consumed', 'Deletion must not cancel an already admitted valid batch');
  await cleanup;
  assert.equal(applied, 1);
  assert.equal(f.diagnostics.filter(event => event.name === 'runtime/terminalBatchConsumed').length, 1);
  f.host.disposeRuntimeSupervisorClients();
  console.log('PASS actual batch handler consumes and saves after deletion confirmation');
}

for (const profile of [undefined, 'linux-owner-v1-candidate']) {
  const f = await modeSwitchFixture(false), entered = deferred(), deletion = deferred(), saved = deferred();
  f.host.getExecutionCandidateProfile = () => profile;
  let now = 0, expire;
  f.host.getExecutionCandidateScheduler = () => ({ now: () => now,
    scheduleDeadline: (deadline, callback) => { expire = () => { now = deadline; callback(); }; return () => {}; } });
  f.host.deleteRuntimeSupervisorSessions = async () => { entered.resolve(); await deletion.promise; };
  f.host.applyRuntimeSupervisorSnapshot = async () => saved.promise;
  const first = f.host.cleanupRuntimePersistenceModeSwitch();
  const result = first.then(() => undefined, error => error);
  await entered.promise;
  f.client.options.onSessionState({ kind: 'terminal', sessionId: 'session-1', live: true });
  deletion.resolve(); await new Promise(resolve => setImmediate(resolve));
  expire();
  const failure = await result;
  assert.match(failure.message, /unconfirmed/);
  assert.equal(f.host.state.nodes.length, 1);
  await assert.rejects(f.host.cleanupRuntimePersistenceModeSwitch(), error => error === failure,
    'An expired but still running core must not start a replacement cleanup');
  saved.resolve(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.host.state.nodes.length, 1, 'A late completion after the deadline must not clear the Canvas');
  f.host.disposeRuntimeSupervisorClients();
  console.log('PASS pending callback respects original deadline and late completion cannot commit');
}

for (const enabled of [false, true]) {
  const f = await modeSwitchFixture(false);
  f.host.appliedStartupConfiguration = { runtimePersistenceEnabled: enabled };
  f.host.readStartupConfiguration = () => ({ runtimePersistenceEnabled: !enabled });
  f.host.getExecutionCandidateProfile = () => undefined;
  let strict;
  f.host.deleteRuntimeSupervisorSessions = async (_bindings, options) => { strict = options.strict; };
  f.host.cleanupModeSwitchAfterPageClose();
  await f.host.modeSwitchCleanup;
  assert.equal(strict, true, 'Mode switching also requires strict deletion for the legacy path');
  assert.equal(f.host.state.nodes.length, 0);
  f.host.disposeRuntimeSupervisorClients();
  console.log(`PASS last page closure settles mode switch from enabled=${enabled}`);
}


// An unknown destructive responsibility survives removal/replacement of its projection.
for (const change of ['removed', 'replaced']) {
  const f = await modeSwitchFixture(false);
  f.host.prepareStoppedLegacyHistoryRetirement = async () => undefined;
  let requests = 0;
  f.client.deleteSessionStrict = () => {
    requests++;
    const result = { kind: 'unconfirmed', reason: 'Original deletion has no confirmed result' };
    return { first: Promise.resolve(result), current: () => result, submitted: true, attemptSettled: false };
  };
  await assert.rejects(f.host.cleanupRuntimePersistenceModeSwitch(), /unconfirmed/);
  if (change === 'removed') f.host.state.nodes = [];
  else f.node.id = 'replacement-node';
  await assert.rejects(f.host.cleanupRuntimePersistenceModeSwitch(), /original mode-switch/i);
  assert.equal(requests, 1);
  assert.equal(f.host.modeSwitchProgress.completed, false);
  f.host.disposeRuntimeSupervisorClients();
  console.log(`PASS unknown deletion responsibility survives ${change} projection`);
}

{
  const f = await modeSwitchFixture(false);
  let attempts = 0;
  const failure = new Error('First permanent exit failed');
  f.host.cleanupRuntimePersistenceModeSwitch = async () => { attempts++; throw failure; };
  const first = f.host.prepareForDeactivation();
  await assert.rejects(first, error => error === failure);
  f.host.readStartupConfiguration = () => ({ runtimePersistenceEnabled: true });
  assert.strictEqual(f.host.prepareForDeactivation(), first);
  await assert.rejects(f.host.prepareForDeactivation(), error => error === failure);
  assert.equal(attempts, 1);
  f.host.disposeRuntimeSupervisorClients();
  console.log('PASS permanent exit retains its first failure after configuration changes');
}

{
  const f = await modeSwitchFixture(false), saved = deferred();
  f.host.getExecutionCandidateProfile = () => undefined;
  const binding = f.host.collectPersistedLiveRuntimeSessions()[0];
  const record = { session: binding, finalization: saved.promise };
  f.host.strictRuntimeDeletes = new Map([[f.host.strictRuntimeDeleteKey(binding), record]]);
  let completed = false;
  const operation = f.host.applyCompletedRuntimeSupervisorSnapshot('terminal-1', 'terminal',
    { sessionId: binding.sessionId, kind: 'terminal', live: false }).then(() => { completed = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(completed, false);
  assert.equal(f.node.metadata.terminal.runtimeSessionId, binding.sessionId);
  saved.resolve(); await operation;
  assert.equal(record.finalizationComplete, true);
  f.host.disposeRuntimeSupervisorClients();
  console.log('PASS legacy completion joins the original strict deletion finalization');
}

{
  const f = await modeSwitchFixture(false);
  const node2 = structuredClone(f.node);
  node2.id = 'terminal-2'; node2.metadata.terminal.runtimeSessionId = 'session-2';
  f.host.state.nodes.push(node2);
  f.host.prepareStoppedLegacyHistoryRetirement = async () => undefined;
  const requests = [];
  let second = { kind: 'unconfirmed', reason: 'Second original deletion is unknown' };
  f.client.deleteSessionStrict = ({ sessionId }) => {
    requests.push(sessionId);
    const current = () => sessionId === 'session-1' ? { kind: 'legacy-acknowledged' } : second;
    return { first: Promise.resolve(current()), current, submitted: true, attemptSettled: false };
  };
  await assert.rejects(f.host.cleanupRuntimePersistenceModeSwitch(), /session-2: unconfirmed/);
  await assert.rejects(f.host.cleanupRuntimePersistenceModeSwitch(), /session-2: unconfirmed/);
  second = { kind: 'legacy-acknowledged' };
  await f.host.cleanupRuntimePersistenceModeSwitch();
  assert.deepEqual(requests.sort(), ['session-1', 'session-2']);
  assert.equal(f.host.state.nodes.length, 0);
  f.host.disposeRuntimeSupervisorClients();
  console.log('PASS partial deletion confirmation survives retries without replaying either request');
}

{
  const f = await modeSwitchFixture(false), saved = deferred(), saving = deferred();
  f.host.canPreserveTrustedSupervisorSessionForSnapshot = () => true;
  f.host.updateSupervisorExecutionSessionFromSnapshot = () => {};
  f.host.scheduleExecutionTerminalProjectionRefresh = () => {};
  f.host.persistState = async () => { saving.resolve(); await saved.promise; };
  let done = false;
  const apply = f.host.applyRuntimeSupervisorSnapshot('terminal-1', 'terminal', {
    sessionId: 'session-1', kind: 'terminal', live: true, lifecycle: 'live', outputSequence: 2
  }, { postSnapshot: false }).then(() => { done = true; });
  await saving.promise;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(done, false, 'Actual live snapshot application includes its async persistence');
  saved.resolve(); await apply;
  f.host.disposeRuntimeSupervisorClients();
  console.log('PASS actual live snapshot waits for its persistence responsibility');
}

{
  const f = await modeSwitchFixture(false), saving = deferred(), releaseSave = deferred();
  const failure = new Error('Save accepted before the mode boundary failed');
  f.host.applyRuntimeSupervisorSnapshot = async () => { saving.resolve(); await releaseSave.promise; throw failure; };
  f.host.deleteRuntimeSupervisorSessions = async () => {};
  f.client.options.onSessionState({ sessionId: 'session-1', kind: 'terminal', live: true });
  await saving.promise;
  const cleanup = f.host.cleanupRuntimePersistenceModeSwitch();
  const result = cleanup.then(() => undefined, error => error);
  releaseSave.resolve();
  assert.strictEqual(await result, failure, 'The initial drain must retain failures from already accepted saves');
  assert.equal(f.host.state.nodes.length, 1);
  f.host.disposeRuntimeSupervisorClients();
  console.log('PASS initial callback drain retains an already accepted save failure');
}
