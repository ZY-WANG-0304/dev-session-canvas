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
      export { TerminalAvailableNotifications } from './extensions/vscode/dev-session-canvas/src/panel/terminalAvailableNotifications';
      export { RuntimeTerminalReadRelay } from './extensions/vscode/dev-session-canvas/src/panel/runtimeTerminalReadRelay';
      export { namespaceCanvasObjectId } from './extensions/vscode/dev-session-canvas/src/common/canvasMultiRootComposition';
      export { createRuntimeOwnerDescriptor, resolveRootRuntimeSupervisorGeneration, resolveRuntimeRootOwnerBaseStoragePath }
        from './extensions/vscode/dev-session-canvas/src/common/runtimeRootOwnership';
      export { workspace as vscodeWorkspace } from 'vscode';
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
const { CanvasPanelManager, RuntimeSupervisorClient, TerminalAvailableNotifications,
  RuntimeTerminalReadRelay, namespaceCanvasObjectId, vscodeWorkspace, createRuntimeOwnerDescriptor,
  resolveRootRuntimeSupervisorGeneration, resolveRuntimeRootOwnerBaseStoragePath } = loaded.exports;

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
  host.terminalAvailableNotifications = new TerminalAvailableNotifications();
  Object.assign(host, {
    context: { extensionMode: 3, extensionUri: { fsPath: cwd } },
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

async function testOriginalRootBindingValidation() {
  const profile = ({ linux: 'linux-owner-v1-candidate', darwin: 'macos-owner-v1-candidate',
    win32: 'windows-owner-v1-candidate' })[process.platform];
  const owner = createRuntimeOwnerDescriptor({ environmentKey: 'a'.repeat(64), userStorageScopeKey: 'b'.repeat(64),
    rootPath: path.join(cwd, 'controlled-root'), generation: resolveRootRuntimeSupervisorGeneration(profile) });
  const base = resolveRuntimeRootOwnerBaseStoragePath(path.join(cwd, 'controlled-global-storage'), owner);
  const conflictingOwner = { ...owner, userStorageScopeKey: 'c'.repeat(64) };
  for (const kind of ['legacy-detached', 'systemd-user']) {
    const f = makeHost();
    const backend = f.host.getRuntimeHostBackend(kind, base);
    const client = await f.host.getRuntimeSupervisorClientForBackend(backend,
      { deferConnection: true, expectedRuntimeOwner: owner });
    assert.equal(client.matchesRuntimeOwner(owner), true);
    assert.equal(client.matchesRuntimeOwner(undefined), false);
    assert.equal(client.matchesRuntimeOwner(conflictingOwner), false);
    client.ensureConnected = async options => { assert.equal(options.allowRestart, false); };
    assert.equal(await f.host.getRuntimeSupervisorClientForKind(kind, { allowRestart: true }, base, owner), client);
    for (const invalidOwner of [undefined, null, conflictingOwner]) {
      await assert.rejects(f.host.getRuntimeSupervisorClientForBackend(backend,
        { deferConnection: true, expectedRuntimeOwner: invalidOwner }), /owner|storage/i);
      assert.equal(f.host.runtimeSupervisorClients.get(f.host.buildRuntimeSupervisorClientKey(backend)), client,
        'a rejected descriptor cannot replace or dispose the original cached client');
    }
    f.host.disposeRuntimeSupervisorClients();
  }

  const invalidBindings = [
    { runtimeStoragePath: base },
    { runtimeStoragePath: base, runtimeOwner: null },
    { runtimeOwner: owner },
    { runtimeOwner: null },
    { runtimeStoragePath: path.join(cwd, 'legacy-slot'), runtimeOwner: owner },
    { runtimeStoragePath: path.join(cwd, 'legacy-slot'), runtimeOwner: null },
    { runtimeStoragePath: base.replace(owner.generation, 'unsupported-root-generation'), runtimeOwner: owner },
    { runtimeStoragePath: base, runtimeOwner: { ...owner, root: { ...owner.root, normalizedPath: path.join(cwd, 'other-root') } } }
  ];
  for (const invalid of invalidBindings) {
    const f = makeHost();
    Object.assign(f.node.metadata.terminal, { runtimeStoragePath: undefined, ...invalid });
    const originalState = structuredClone(f.host.state);
    const binding = f.host.getPersistedLiveRuntimeSessionForNode(f.node);
    assert.equal(binding.sessionId, 'session-1', 'an invalid owner does not erase the original session identity');
    f.host.getRuntimeHostBackend = () => assert.fail('invalid ownership reached backend resolution');
    await assert.rejects(f.host.getRuntimeSupervisorClientForKind('legacy-detached', {},
      invalid.runtimeStoragePath, invalid.runtimeOwner), /owner|binding|storage/i);
    await assert.rejects(f.host.prepareStoppedLegacyHistoryRetirement(binding, Infinity), /owner|binding|storage/i);
    await assert.rejects(f.host.deleteRuntimeSupervisorSessionStrict(binding, { allowRestart: false }), /owner|binding|storage/i);
    assert.throws(() => f.host.observeStrictRuntimeDelete(binding, Infinity), /owner|binding|storage/i);
    assert.deepEqual(f.host.state, originalState, 'rejection retains the original metadata and is not terminal completion');
  }

  const f = makeHost();
  Object.assign(f.node.metadata.terminal, { runtimeOwner: owner, runtimeStoragePath: base });
  const original = f.host.getPersistedLiveRuntimeSessionForNode(f.node);
  assert.equal(f.host.isStrictRuntimeDeleteBindingCurrent(original), true);
  f.node.metadata.terminal.runtimeOwner = conflictingOwner;
  assert.equal(f.host.isStrictRuntimeDeleteBindingCurrent(original), false);
  f.host.strictRuntimeDeletes = new Map([[f.host.strictRuntimeDeleteKey(original), {
    session: original, result: { kind: 'legacy-absent' }, first: Promise.resolve({ kind: 'legacy-absent' })
  }]]);
  assert.throws(() => f.host.observeStrictRuntimeDelete(f.host.getPersistedLiveRuntimeSessionForNode(f.node), Infinity), /owner/i);
  f.host.state.nodes.push({ ...f.node, id: 'duplicate-binding', metadata: {
    terminal: { ...f.node.metadata.terminal, runtimeOwner: owner }
  } });
  assert.throws(() => f.host.collectPersistedLiveRuntimeSessions(), /owner/i,
    'deduplication cannot discard a conflicting owner for the same original address and session');

  for (const rejected of [false, true]) {
    const attaching = makeHost();
    Object.assign(attaching.node.metadata.terminal, { runtimeOwner: owner, runtimeStoragePath: base,
      attachmentState: 'reattaching', liveSession: false });
    attaching.host.executionSessionOperationTokens = new Map();
    attaching.host.bindRuntimeSession = () => assert.fail('late attach rebound a changed owner');
    attaching.host.applyRuntimeSupervisorSnapshot = () => assert.fail('late attach projected into a changed owner');
    attaching.host.markExecutionNodeAsHistoryRestored = () => assert.fail('late attach error changed a successor binding');
    const gate = deferred();
    const operation = attaching.host.attachPersistedRuntimeSession('terminal', attaching.node.id, 'session-1', () => gate.promise);
    attaching.node.metadata.terminal.runtimeOwner = conflictingOwner;
    const before = structuredClone(attaching.host.state);
    if (rejected) gate.reject(new Error('old handshake failed'));
    else gate.resolve({ snapshot: { kind: 'terminal', sessionId: 'session-1', live: true }, terminalProjectionMode: 'terminal-stream-v1' });
    await operation;
    assert.deepEqual(attaching.host.state, before);
  }

  for (const bindingOwners of [[owner, conflictingOwner], [null, null], [undefined, undefined]]) {
    const restored = makeHost();
    restored.host.appliedStartupConfiguration = { runtimePersistenceEnabled: true };
    restored.host.state.nodes = bindingOwners.map((runtimeOwner, index) => ({
      ...restored.node, id: `restore-${index}`, metadata: { terminal: {
        ...restored.node.metadata.terminal, runtimeOwner, runtimeStoragePath: base,
        attachmentState: 'reattaching', runtimeSessionId: `restore-session-${index}`
      } }
    }));
    const before = structuredClone(restored.host.state);
    const refused = [];
    restored.host.markExecutionNodeAsHistoryRestored = (id, _kind, message) => refused.push({ id, message });
    restored.host.getRuntimeHostBackend = () => assert.fail('conflicting or incomplete restore reached backend resolution');
    await restored.host.restoreLiveRuntimeSessions();
    assert.equal(refused.length, 2);
    assert.ok(refused.every(result => /owner/i.test(result.message)));
    assert.deepEqual(restored.host.state, before);
  }

  for (const runtimeOwner of [owner, null, undefined]) {
    const agent = makeHost();
    agent.host.appliedStartupConfiguration = { runtimePersistenceEnabled: true };
    agent.host.state.nodes = [{ ...agent.node, kind: 'agent', metadata: { agent: {
      ...agent.node.metadata.terminal, runtimeOwner, runtimeStoragePath: base,
      resumeStrategy: 'claude-session-id', resumeSessionId: 'resumable-provider-session'
    } } }];
    const before = structuredClone(agent.host.state);
    assert.equal(agent.host.maybeFallbackAgentLiveRuntimeToResume(agent.node.id, 'unknown root owner'), false);
    assert.deepEqual(agent.host.state, before, 'root discovery failure cannot clear a binding via legacy automatic resume');
  }

  const legacy = makeHost();
  const legacyBackend = legacy.host.getRuntimeHostBackend('legacy-detached', legacy.host.rawExtensionStoragePath);
  const legacyClient = await legacy.host.getRuntimeSupervisorClientForBackend(legacyBackend, { deferConnection: true });
  legacyClient.ensureConnected = async () => undefined;
  assert.equal(await legacy.host.getRuntimeSupervisorClientForKind('legacy-detached'), legacyClient,
    'only legacy metadata without owner may retain the old implicit workspace-slot fallback');
  legacy.host.disposeRuntimeSupervisorClients();
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

async function testCompletedDeleteWaitCannotCloseOrNotifyReplacement(kind, replace, replacementPoint = 'delete', realStart = false) {
  const f = await makeRootHost();
  if (kind === 'agent') makeRootAAgent(f);
  const deletion = deferred();
  const deletionStarted = deferred();
  const messages = [];
  const closedReaders = [];
  const abnormalNotifications = [];
  const readers = new Map();
  const readerKey = `editor:${kind}:${f.node.id}`;
  let successor = { ...makeSession(), sessionId: 'delete-successor', runtimeSessionId: 'delete-successor',
    terminalProjectionMode: 'terminal-stream-v1', terminalStreamPaged: true, terminalAuthorityId: 'successor-authority' };
  let successorNode = {
    ...structuredClone(f.node), title: 'Replacement during completed delete',
    metadata: { [kind]: { ...f.node.metadata[kind], runtimeSessionId: 'delete-successor' } }
  };
  const installReplacement = () => {
    f.host.state = { ...f.host.state, nodes: f.host.state.nodes.map(node => node.id === f.node.id ? successorNode : node) };
    f.host.getExecutionSessions(kind).set(f.node.id, successor);
    f.host.bindRuntimeSession(f.node.id, kind, 'delete-successor', '/controlled/runtime', 'legacy-detached');
    readers.set(readerKey, 'successor-reader');
  };
  const lifecycle = { surface: 'editor', mode: 'active', generation: 1, frameId: 'controlled-frame' };
  Object.assign(f.host, {
    executionCandidateProfile: 'linux-owner-v1-candidate',
    activeSurface: 'editor',
    isInteractiveSurface: () => true,
    getSurfaceMessageWebview: () => ({}),
    getSurfaceLifecycleIdentity: () => lifecycle,
    postExecutionExitWithFinalSnapshot: CanvasPanelManager.prototype.postExecutionExitWithFinalSnapshot,
    postMessage: message => messages.push(message),
    disposeAgentFileActivitySession: async () => undefined,
    markAndNotifyAgentAbnormalInterruption: async nodeId => {
      f.host.setExecutionAttentionPending('agent', nodeId, true);
      abnormalNotifications.push(nodeId);
    },
    terminalReadRelay: {
      closeMatching() {},
      completeRemote: async () => undefined,
      getCompleted: () => replacementPoint === 'after-snapshot'
        ? { sessionId: 'session-1', authorityId: 'original-authority', revision: 2 } : undefined,
      getUnacknowledgedCompletedRead: () => undefined,
      close: key => {
        if (readers.has(key)) closedReaders.push(readers.get(key));
        readers.delete(key);
      }
    }
  });
  f.session.terminalProjectionMode = 'terminal-stream-v1';
  f.session.terminalStreamPaged = true;
  f.session.terminalAuthorityId = 'original-authority';
  f.client.deleteSessionStrict = request => {
    f.deletes.push(request.sessionId);
    deletionStarted.resolve();
    return { first: deletion.promise, current: () => undefined };
  };
  if (replacementPoint === 'after-apply') {
    const applySnapshot = f.host.applyRuntimeSupervisorSnapshot;
    f.host.applyRuntimeSupervisorSnapshot = async (...args) => {
      await applySnapshot.apply(f.host, args);
      installReplacement();
    };
  } else if (replacementPoint === 'after-snapshot') {
    const postSnapshot = f.host.postExecutionSnapshot;
    f.host.postExecutionSnapshot = async (...args) => {
      await postSnapshot.apply(f.host, args);
      installReplacement();
    };
  }
  f.client.options.onSessionState({
    kind, sessionId: 'session-1', live: false, lifecycle: kind === 'agent' ? 'error' : 'closed',
    runtimeBackend: 'legacy-detached', output: '', cols: 119, rows: 41,
    terminalStreamPaged: true, terminalAuthorityId: 'original-authority',
    terminalRevision: 2, outputSequence: 2
  });
  await Promise.race([
    deletionStarted.promise,
    f.host.waitForPendingRuntimeSupervisorStateCallbacks().then(() => {
      assert.fail(`completed callback did not wait for delete: ${JSON.stringify(f.diagnostics)}`);
    })
  ]);
  assert.equal(f.persisted.filter(entry => entry.options.reason === 'runtime-supervisor-completed-snapshot').length, 1);
  assert.equal(f.host.getExecutionSessions(kind).has(f.node.id), false,
    'original session is retired before its remote delete returns');

  if (realStart) {
    const creates = [];
    Object.assign(f.host, {
      getTerminalShellPath: () => '/controlled/shell', getTerminalShellArgs: () => [],
      getTerminalScrollback: () => 1000, getExecutionNodeCwd: () => '/controlled',
      resolveExecutionEnvironment: async () => ({}),
      getPreferredRuntimeSupervisorClient: async () => ({ client: f.client,
        backend: f.host.getRuntimeHostBackend(), runtimeStoragePath: '/controlled/runtime' }),
      createConfiguredAgentFileActivitySession: () => ({ extraArgs: [], extraEnv: {}, dispose: async () => {} }),
      bindAgentFileActivitySession() {}
    });
    f.client.supportsExecutionCandidateProfile = profile => profile === 'linux-owner-v1-candidate';
    f.client.supportsTerminalSessionStream = () => true;
    f.client.supportsTerminalPagedRead = () => true;
    f.client.supportsTerminalPagedCompletion = () => true;
    f.client.subscribeSession = async () => undefined;
    f.client.createSession = async request => {
      creates.push(request);
      return { kind: request.kind, sessionId: request.sessionId, live: true,
        lifecycle: kind === 'agent' ? 'running' : 'live', provider: kind === 'agent' ? 'codex' : undefined,
        runtimeBackend: 'legacy-detached', runtimeGuarantee: 'best-effort',
        displayLabel: request.displayLabel, launchMode: request.launchMode, shellPath: request.launchSpec.file,
        cwd: request.launchSpec.cwd, cols: request.launchSpec.cols, rows: request.launchSpec.rows,
        scrollback: request.scrollback, output: '', outputSequence: 0, terminalStreamPaged: true,
        terminalAuthorityId: 'successor-authority', terminalRevision: 0 };
    };
    // The actual startup owns the node/session/binding; this Host-only test keeps its reader controlled.
    f.host.activeSurface = undefined;
    if (kind === 'terminal') await f.host.startTerminalSessionWithSupervisor(f.node.id, 80, 24);
    else await f.host.startAgentSessionWithSupervisor(f.node.id, 80, 24, 'codex',
      { command: '/controlled/codex', label: 'Controlled Codex', requestedCommand: 'codex' },
      '/controlled/codex', [], { supported: false, strategy: 'none' }, 'start');
    f.host.activeSurface = 'editor';
    successor = f.host.getExecutionSessions(kind).get(f.node.id);
    successorNode = f.host.state.nodes.find(node => node.id === f.node.id);
    assert.equal(creates.length, 1, 'The real startup must create exactly one replacement while old delete waits.');
    assert.equal(successor?.runtimeSessionId, creates[0].sessionId);
    assert.notEqual(successor, f.session);
    assert.notEqual(successor.runtimeSessionId, 'session-1');
    readers.set(readerKey, 'successor-reader');
    console.log(`completed delete real startup observation: ${JSON.stringify({ kind, creates: creates.length,
      originalDeleteStillPending: f.host.pendingRuntimeSupervisorStateCallbacks.size === 1,
      replacementSession: successor.runtimeSessionId,
      replacementSaved: f.persisted.some(entry => entry.state.nodes.some(node => node.id === f.node.id &&
        node.metadata[kind]?.runtimeSessionId === successor.runtimeSessionId)) })}`);
  } else if (replace && replacementPoint === 'delete') installReplacement();
  const continuationMessageIndex = realStart ? messages.length : 0;
  deletion.resolve({ kind: 'legacy-acknowledged' });
  await f.host.waitForPendingRuntimeSupervisorStateCallbacks();

  assert.deepEqual(f.deletes, ['session-1']);
  if (replace) {
    assert.strictEqual(f.host.state.nodes.find(node => node.id === f.node.id), successorNode);
    assert.strictEqual(f.host.getExecutionSessions(kind).get(f.node.id), successor);
    assert.equal(f.host.runtimeSessionBindings.get(f.host.buildRuntimeSessionBindingKey(
      kind, successor.runtimeSessionId, '/controlled/runtime', 'legacy-detached')).runtimeSessionId, successor.runtimeSessionId);
  } else {
    assert.equal(f.host.getExecutionSessions(kind).has(f.node.id), false);
    assert.equal(f.host.state.nodes.find(node => node.id === f.node.id).metadata[kind].terminalHistoryDiscarded, true);
  }
  assert.deepEqual({
    closedReaders,
    abnormalNotifications,
    errorNotifications: messages.slice(continuationMessageIndex).filter(message => message.type === 'host/error').length,
    finalNotifications: messages.slice(continuationMessageIndex).filter(message =>
      message.type === 'host/executionSnapshot' || message.type === 'host/executionExit')
      .map(message => ({ type: message.type, executionSessionId: message.payload.executionSessionId }))
  }, {
    closedReaders: [], abnormalNotifications: kind === 'agent' && !replace ? [f.node.id] : [],
    errorNotifications: kind === 'agent' && !replace ? 1 : 0,
    finalNotifications: replace ? [] : [
      { type: 'host/executionSnapshot', executionSessionId: 'session-1' },
      { type: 'host/executionExit', executionSessionId: 'session-1' }
    ]
  }, 'a completed delete continuation can only finish notifications for its original execution');
  if (replace) assert.equal(readers.get(readerKey), 'successor-reader');
  if (realStart) {
    f.host.disposeManagedExecutionSession(successor);
    f.host.disposeRuntimeSupervisorClients();
  }
}

async function testResetDeleteWaitOverlapsPermanentDeactivation(withOwner = false) {
  const f = await makeRootHost();
  const deletion = deferred();
  const deletionStarted = deferred();
  const events = [];
  const foldersBefore = vscodeWorkspace.workspaceFolders;
  const persist = f.host.persistState;
  f.host.state = { ...f.host.state, nodes: [f.node], groups: [] };
  f.node.groupId = undefined;
  f.host.terminalSessions.delete(f.nodeB.id);
  f.host.unbindRuntimeSession('session-2', '/controlled/runtime', 'terminal', 'legacy-detached');
  Object.assign(f.host, {
    executionCandidateProfile: 'linux-owner-v1-candidate',
    getMultiRootWorkspaceFoldersForComposition: () => [],
    getAgentCliConfig: () => ({ defaultProvider: 'codex' }),
    appliedStartupConfiguration: { runtimePersistenceEnabled: true },
    readStartupConfiguration: () => ({ runtimePersistenceEnabled: true }),
    persistState: options => { events.push({ type: 'persist', reason: options.reason }); return persist(options); },
    postState: type => events.push({ type, nodeIds: f.host.state.nodes.map(node => node.id) })
  });
  if (withOwner) {
    const scheduler = f.host.getExecutionCandidateScheduler();
    f.host.nonNativeExecutionOwner = {
      options: { capabilities: ['execution-owner-boundary-v1'], scheduler, budgets: { boundaryMs: 20000 } },
      closeAdmission: permanent => events.push({ type: 'owner-admission-closed', permanent }),
      list: () => [], get: () => undefined, snapshot: () => ({ pending: 0 }),
      close: async () => ({ kind: 'settled', pending: [] })
    };
  }
  f.client.deleteSessionStrict = request => {
    f.deletes.push(request.sessionId);
    events.push({ type: 'strict-delete', sessionId: request.sessionId });
    deletionStarted.resolve();
    return { first: deletion.promise, current: () => undefined };
  };
  let reset;
  let deactivation;
  try {
    vscodeWorkspace.workspaceFolders = [];
    reset = f.host.resetState().then(() => { events.push({ type: 'reset-returned' }); return {}; }, error => {
      events.push({ type: 'reset-rejected', error: error.message }); return { error };
    });
    await Promise.race([deletionStarted.promise, reset.then(() => assert.fail('Reset did not reach strict delete.'))]);
    deactivation = f.host.prepareForDeactivation().then(report => {
      events.push({ type: 'deactivation-returned', report, nodeIds: f.host.state.nodes.map(node => node.id) }); return { report };
    }, error => { events.push({ type: 'deactivation-rejected', error: error.message }); return { error }; });
    await sleep();
    assert.equal(f.host.runtimeSupervisorEventAdmissionOpen, false);
    f.client.options.onSessionState({ kind: 'terminal', sessionId: 'session-1', live: false,
      lifecycle: 'closed', output: '', cols: 80, rows: 24, outputSequence: 2 });
    assert.equal(f.host.pendingRuntimeSupervisorStateCallbacks?.size ?? 0, 0,
      'The permanent gate must reject a late callback from the original client.');
    events.push({ type: 'release-delete' });
    deletion.resolve({ kind: 'legacy-acknowledged' });
    const [resetResult, deactivationResult] = await Promise.all([reset, deactivation]);
    const permanentIndex = events.findIndex(event => ['deactivation-returned', 'deactivation-rejected'].includes(event.type));
    const lateWrites = permanentIndex < 0 ? [] : events.slice(permanentIndex + 1).filter(event =>
      event.type === 'persist' || event.type === 'host/stateUpdated');
    console.log(`reset/deactivation overlap observation: ${JSON.stringify({ withOwner, events, lateWrites,
      resetError: resetResult.error?.message ?? null, deactivationError: deactivationResult.error?.message ?? null,
      finalNodeIds: f.host.state.nodes.map(node => node.id), deletes: f.deletes })}`);
    assert.match(resetResult.error?.message ?? '', /closed canvas mutation admission/);
    if (withOwner) {
      assert.equal(deactivationResult.error, undefined);
      assert.equal(deactivationResult.report.kind, 'unconfirmed');
      assert.equal(deactivationResult.report.canvasSnapshot.kind, 'unconfirmed');
      assert.equal(deactivationResult.report.local.kind, 'settled');
      assert.equal(deactivationResult.report.remoteDetach.kind, 'settled');
      assert.strictEqual(await f.host.prepareForDeactivation(), deactivationResult.report,
        'The original unconfirmed owner report remains frozen after the delete later acknowledges.');
      assert(events.some(event => event.type === 'owner-admission-closed' && event.permanent === true));
    } else {
      assert.match(deactivationResult.error?.message ?? '', /deactivation is unconfirmed.*mutation is still pending/);
      await assert.rejects(f.host.prepareForDeactivation(), error => error === deactivationResult.error,
        'The first ordinary deactivation rejection remains the same error after mutation settlement.');
    }
    assert.deepEqual(lateWrites, [], 'A frozen permanent boundary cannot be followed by an old reset save or publication.');
    assert.equal(f.host.runtimeSupervisorEventAdmissionOpen, false);
    assert.deepEqual(f.host.state.nodes.map(node => node.id), [f.node.id]);
    assert.strictEqual(f.host.terminalSessions.get(f.node.id), f.session,
      'The stale reset continuation cannot clear the original Host session map.');
    assert.equal(f.host.runtimeSessionBindings.size, 1);
    assert([...f.host.strictRuntimeDeletes.values()].some(record =>
      f.host.currentStrictRuntimeDeleteResult(record)?.kind === 'legacy-acknowledged'),
      'The already-issued delete retains its actual acknowledgment, not an invented cancellation.');
    assert.deepEqual(f.deletes, ['session-1']);
  } finally {
    deletion.resolve({ kind: 'legacy-acknowledged' });
    await Promise.all([reset, deactivation]);
    f.host.disposeRuntimeSupervisorClients();
    vscodeWorkspace.workspaceFolders = foldersBefore;
  }
}

async function testFullRootTemplateResetCannotLoseNewExecutionDuringDelete(mode) {
  const f = await makeRootHost();
  for (const [node, session, root] of [[f.node, f.session, f.rootA], [f.nodeB, f.sessionB, f.rootB]]) {
    f.host.terminalSessions.delete(node.id);
    f.host.unbindRuntimeSession(session.runtimeSessionId, '/controlled/runtime', 'terminal', 'legacy-detached');
    node.id = namespaceCanvasObjectId(root.workspaceRootPath, node.id);
    f.host.terminalSessions.set(node.id, session);
    f.host.bindRuntimeSession(node.id, 'terminal', session.runtimeSessionId, '/controlled/runtime', 'legacy-detached');
  }
  const foldersBefore = vscodeWorkspace.workspaceFolders;
  const deletion = deferred();
  const deletionStarted = deferred();
  const creates = [];
  let operation;
  let admittedNodeId;
  let admittedSession;
  let newRootBNode;
  Object.assign(f.host, {
    executionCandidateProfile: 'linux-owner-v1-candidate',
    getAgentCliConfig: () => ({ defaultProvider: 'codex' }),
    getTerminalShellPath: () => '/controlled/shell',
    getTerminalShellArgs: () => [],
    getTerminalScrollback: () => 1000,
    getExecutionNodeCwd: node => node.metadata.terminal.cwd,
    resolveExecutionEnvironment: async () => ({}),
    getPreferredRuntimeSupervisorClient: async () => ({
      client: f.client, backend: f.host.getRuntimeHostBackend(), runtimeStoragePath: '/controlled/runtime'
    })
  });
  f.client.supportsExecutionCandidateProfile = profile => profile === 'linux-owner-v1-candidate';
  f.client.supportsTerminalSessionStream = () => true;
  f.client.supportsTerminalPagedRead = () => true;
  f.client.supportsTerminalPagedCompletion = () => true;
  f.client.subscribeSession = async () => undefined;
  f.client.deleteSessionStrict = request => {
    f.deletes.push(request.sessionId);
    deletionStarted.resolve();
    return { first: deletion.promise, current: () => undefined };
  };
  f.client.createSession = async request => {
    creates.push(request);
    return {
      kind: request.kind, sessionId: request.sessionId, live: true, lifecycle: 'live',
      runtimeBackend: 'legacy-detached', runtimeGuarantee: 'best-effort',
      displayLabel: request.displayLabel, launchMode: request.launchMode,
      shellPath: request.launchSpec.file, cwd: request.launchSpec.cwd,
      cols: request.launchSpec.cols, rows: request.launchSpec.rows, scrollback: request.scrollback,
      output: '', outputSequence: 0, terminalStreamPaged: true,
      terminalAuthorityId: 'new-root-a-authority', terminalRevision: 0
    };
  };
  const start = async nodeId => {
    await f.host.startTerminalSessionWithSupervisor(nodeId, 80, 24);
    admittedNodeId = nodeId;
    admittedSession = f.host.terminalSessions.get(nodeId);
    assert.equal(creates.length, 1);
    assert.equal(admittedSession?.runtimeSessionId, creates[0].sessionId);
  };
  if (mode === 'same-id-replacement') {
    const prepare = f.host.prepareWorkspaceRootCanvasForTemplateReset;
    f.host.prepareWorkspaceRootCanvasForTemplateReset = async (...args) => {
      await prepare.apply(f.host, args);
      await start(f.node.id);
    };
  }
  const template = {
    id: 'controlled-root-reset', name: 'Controlled root reset', category: 'builtin',
    createdAt: '2026-09-30T00:00:00.000Z', updatedAt: '2026-09-30T00:00:00.000Z',
    nodes: [{ kind: 'note', title: 'Reset note', position: { x: 0, y: 0 },
      size: { width: 320, height: 240 }, metadata: { note: { content: 'Replacement root' } } }],
    edges: []
  };
  try {
    vscodeWorkspace.workspaceFolders = [f.rootA, f.rootB].map(root => ({
      name: root.title, uri: { fsPath: root.workspaceRootPath }
    }));
    operation = f.host.applyCanvasTemplateRecord({ template }, {
      reset: true, targetGroupId: f.rootA.id, visibleCenter: { x: 200, y: 200 }
    }).then(value => ({ value }), error => ({ error }));
    await Promise.race([deletionStarted.promise, operation.then(result => {
      if (result.error) throw result.error;
      assert.fail('full template reset did not wait for its original root execution delete');
    })]);
    f.emitRootBOutput(' during full root A template reset');
    const stateBefore = structuredClone(f.host.state);
    if (mode === 'new-execution') {
      const created = f.host.applyCreateNode('terminal', { x: 100, y: 100 }, { targetGroupId: f.rootA.id });
      assert.equal(created?.kind, 'terminal', 'real Host creation admits a new node while root cleanup waits');
      await start(created.id);
    } else if (mode === 'completed') {
      newRootBNode = f.host.applyCreateNode('note', { x: 100, y: 100 }, { targetGroupId: f.rootB.id });
      assert.equal(newRootBNode?.kind, 'note', 'other roots remain open to actual Host creation');
      f.client.options.onSessionState({
        kind: 'terminal', sessionId: 'session-1', live: false, lifecycle: 'closed',
        runtimeBackend: 'legacy-detached', output: 'original tail', cols: 119, rows: 41
      });
      await f.host.waitForPendingRuntimeSupervisorStateCallbacks();
      assert.equal(f.host.state.nodes.find(node => node.id === f.node.id).metadata.terminal.terminalHistoryDiscarded, true);
    } else if (mode === 'root-replaced') {
      f.host.state = { ...f.host.state, groups: f.host.state.groups.map(group => group.id === f.rootA.id
        ? { ...group, workspaceRootPath: '/controlled/replacement-root' } : group) };
    }

    if (mode === 'strict-failure') deletion.reject(new Error('controlled original root deletion failed'));
    else deletion.resolve({ kind: 'legacy-acknowledged' });
    const result = await operation;
    f.emitRootBOutput(' after full root A template reset');
    assert.equal(f.sessionB.buffer, 'live output during full root A template reset after full root A template reset');
    assert.strictEqual(f.host.terminalSessions.get(f.nodeB.id), f.sessionB);
    assert.equal(f.host.state.nodes.find(node => node.id === f.nodeB.id)?.metadata.terminal.runtimeSessionId, 'session-2');
    assert.deepEqual(f.deletes, ['session-1'], 'only the initially captured execution was deleted');
    const templateWrites = f.persisted.filter(entry => entry.options?.reason === 'template-applied');
    if (mode === 'new-execution' || mode === 'same-id-replacement') {
      const newBindingKey = f.host.buildRuntimeSessionBindingKey(
        'terminal', creates[0].sessionId, '/controlled/runtime', 'legacy-detached');
      assert.deepEqual({
        nodeRetained: f.host.state.nodes.some(node => node.id === admittedNodeId),
        sessionRetained: f.host.terminalSessions.get(admittedNodeId) === admittedSession,
        bindingRetained: f.host.runtimeSessionBindings.get(newBindingKey)?.nodeId === admittedNodeId,
        savedWithoutNewExecution: templateWrites.some(entry => !entry.state.nodes.some(node => node.id === admittedNodeId))
      }, { nodeRetained: true, sessionRetained: true, bindingRetained: true, savedWithoutNewExecution: false },
      `full template reset must not remove an admitted execution without deleting it; reset error: ${result.error?.message ?? 'none'}`);
      assert.match(result.error?.message ?? '', /workspace root changed/);
      assert.equal(templateWrites.length, 0);
    } else if (mode === 'completed') {
      assert.equal(result.error, undefined);
      assert.equal(result.value.length, 1);
      assert.equal(f.host.state.nodes.some(node => node.id === f.node.id), false);
      assert.equal(f.host.terminalSessions.has(f.node.id), false);
      assert.equal(f.host.state.nodes.some(node => node.id === newRootBNode.id), true);
      assert.equal(templateWrites.length, 1);
    } else if (mode === 'strict-failure') {
      assert.match(result.error?.message ?? '', /Runtime deletion did not complete/);
      assert.deepEqual(f.host.state, stateBefore);
      assert.strictEqual(f.host.terminalSessions.get(f.node.id), f.session);
      assert.equal(templateWrites.length, 0);
    } else {
      assert.match(result.error?.message ?? '', /workspace root changed/);
      assert.equal(f.host.state.groups.find(group => group.id === f.rootA.id).workspaceRootPath, '/controlled/replacement-root');
      assert.equal(templateWrites.length, 0);
    }
  } finally {
    deletion.resolve({ kind: 'legacy-acknowledged' });
    if (operation) await operation;
    for (const session of f.host.terminalSessions.values()) f.host.disposeManagedExecutionSession(session);
    vscodeWorkspace.workspaceFolders = foldersBefore;
  }
}

async function testResetCannotSkipCompletionAcceptedAfterInitialCallbackWait() {
  const f = await makeRootHost();
  const storageStarted = deferred();
  const storageReply = deferred();
  const openReply = deferred();
  const authorityId = 'reset-original-authority';
  const readerKey = `editor:terminal:${f.node.id}`;
  f.host.state = { ...f.host.state, nodes: [f.node], groups: [] };
  f.node.groupId = undefined;
  f.host.terminalSessions.delete(f.nodeB.id);
  f.host.unbindRuntimeSession('session-2', '/controlled/runtime', 'terminal', 'legacy-detached');
  Object.assign(f.host, {
    executionCandidateProfile: 'linux-owner-v1-candidate',
    getMultiRootWorkspaceFoldersForComposition: () => [],
    getAgentCliConfig: () => ({ defaultProvider: 'codex' }),
    terminalReadRelay: new RuntimeTerminalReadRelay(),
    flushDeferredCanvasStatePersist: async reason => {
      if (reason === 'host-boundary') {
        storageStarted.resolve();
        await storageReply.promise;
      }
    }
  });
  Object.assign(f.session, {
    terminalProjectionMode: 'terminal-stream-v1', terminalStreamPaged: true,
    terminalAuthorityId: authorityId, terminalStreamHealthy: true
  });
  f.client.openTerminalRead = () => openReply.promise;
  f.client.closeTerminalRead = async () => ({ ok: true, settlement: 'recorded' });
  f.client.deleteSessionStrict = request => {
    f.deletes.push(request.sessionId);
    return { first: Promise.resolve({ kind: 'legacy-acknowledged' }), current: () => undefined };
  };
  const descriptor = {
    readId: 'reset-original-reader', sessionId: 'session-1', authorityId,
    checkpoint: { version: 1, sessionId: 'session-1', authorityId, revision: 0,
      cols: 119, rows: 41, scrollback: 1000, createdAtMs: 1,
      serializedState: { format: 'xterm-serialize-v1', data: '', outputSequence: 0 } },
    headRevision: 2, settlementMode: 'final-application-v1'
  };
  const opening = f.host.terminalReadRelay.open(readerKey, f.client, 'session-1', authorityId,
    'editor', undefined, 'final-application-v1');
  let resetFinished = false;
  let resetError;
  const reset = f.host.resetState().then(() => { resetFinished = true; }, error => {
    resetFinished = true;
    resetError = error;
  });
  try {
    await Promise.race([storageStarted.promise, reset.then(() => {
      throw resetError ?? new Error('reset returned before its controlled storage wait');
    })]);
    assert.equal(f.host.pendingRuntimeSupervisorStateCallbacks?.size ?? 0, 0);
    f.client.options.onSessionState({
      kind: 'terminal', sessionId: 'session-1', live: false, lifecycle: 'closed',
      runtimeBackend: 'legacy-detached', output: '', cols: 119, rows: 41,
      terminalStreamPaged: true, terminalAuthorityId: authorityId,
      terminalRevision: 2, terminalFinalRevision: 2, outputSequence: 2,
      capabilities: { terminalReadSettlementV1: true }
    });
    assert.equal(f.host.pendingRuntimeSupervisorStateCallbacks.size, 1);
    assert.equal(f.host.terminalReadRelay.getCompleted(readerKey)?.finalRevision, 2);
    assert.equal(f.host.state.nodes[0].metadata.terminal.persistenceMode, 'snapshot-only');
    storageReply.resolve();
    await sleep(0);
    const observation = {
      resetFinished, resetError: resetError?.message,
      pendingCallbacks: f.host.pendingRuntimeSupervisorStateCallbacks.size,
      deleteRequests: f.deletes,
      retainedBindings: f.host.runtimeSessionBindings.size,
      nodeCount: f.host.state.nodes.length,
      savedEmpty: f.persisted.some(entry => entry.options?.reason === 'state-reset' && entry.state.nodes.length === 0)
    };
    assert.equal(resetFinished && !resetError && observation.pendingCallbacks > 0 &&
      observation.deleteRequests.length === 0 && observation.savedEmpty, false,
    `reset must not forget an original Runtime whose accepted completion is still pending: ${JSON.stringify(observation)}`);
    assert.equal(resetFinished, true, 'a non-permanent reset reports its abort without draining the new callback');
    assert.match(resetError?.message ?? '', /Runtime session updates are still pending/);
    assert.equal(f.host.state.nodes.length, 1);
    assert.strictEqual(f.host.terminalSessions.get(f.node.id), f.session);
    assert.equal(f.host.runtimeSessionBindings.get(f.host.buildRuntimeSessionBindingKey(
      'terminal', 'session-1', '/controlled/runtime', 'legacy-detached'))?.nodeId, f.node.id);
    assert.equal(f.getDisposals(), 0, 'aborting reset keeps the original client available for its accepted callback');
    assert.equal(observation.savedEmpty, false);
    assert.deepEqual(f.deletes, []);

    openReply.resolve(descriptor);
    await opening;
    await f.host.waitForPendingRuntimeSupervisorStateCallbacks();
    assert.equal(f.host.pendingRuntimeSupervisorStateCallbacks.size, 0);
    assert.deepEqual(f.deletes, ['session-1'], 'the original completion later performs its own original-session cleanup');
    assert.equal(f.host.state.nodes[0].metadata.terminal.terminalHistoryDiscarded, true);
    assert.equal(f.host.runtimeSessionBindings.size, 0);
    assert.equal(f.persisted.some(entry => entry.options?.reason === 'state-reset'), false);

    await f.host.resetState();
    assert.equal(f.host.state.nodes.length, 0);
    assert.equal(f.host.terminalSessions.size, 0);
    assert.equal(f.host.runtimeSessionBindings.size, 0);
    assert.equal(f.persisted.filter(entry => entry.options?.reason === 'state-reset' && entry.state.nodes.length === 0).length, 1);
  } finally {
    storageReply.resolve();
    openReply.resolve(descriptor);
    await opening;
    await reset;
    await f.host.waitForPendingRuntimeSupervisorStateCallbacks();
  }
}

async function testNonRootResetCannotLoseExecutionAdmittedAfterBoundary(mode, outcome = 'same-id-replacement') {
  const f = await makeRootHost();
  const foldersBefore = vscodeWorkspace.workspaceFolders;
  const creates = [];
  const postedStates = [];
  const completionDeletion = deferred();
  const completionDeletionStarted = deferred();
  let admittedSession;
  f.host.state = { ...f.host.state, nodes: [f.node], groups: [] };
  f.node.groupId = undefined;
  f.host.terminalSessions.delete(f.nodeB.id);
  f.host.unbindRuntimeSession('session-2', '/controlled/runtime', 'terminal', 'legacy-detached');
  Object.assign(f.host, {
    executionCandidateProfile: 'linux-owner-v1-candidate',
    getMultiRootWorkspaceFoldersForComposition: () => [],
    getAgentCliConfig: () => ({ defaultProvider: 'codex' }),
    getTerminalShellPath: () => '/controlled/shell',
    getTerminalShellArgs: () => [],
    getTerminalScrollback: () => 1000,
    getExecutionNodeCwd: node => node.metadata.terminal.cwd,
    resolveExecutionEnvironment: async () => ({}),
    getPreferredRuntimeSupervisorClient: async () => ({
      client: f.client, backend: f.host.getRuntimeHostBackend(), runtimeStoragePath: '/controlled/runtime'
    }),
    postState: type => postedStates.push({ type, state: structuredClone(f.host.state) })
  });
  f.client.supportsExecutionCandidateProfile = profile => profile === 'linux-owner-v1-candidate';
  f.client.supportsTerminalSessionStream = () => true;
  f.client.supportsTerminalPagedRead = () => true;
  f.client.supportsTerminalPagedCompletion = () => true;
  f.client.subscribeSession = async () => undefined;
  f.client.deleteSessionStrict = request => {
    f.deletes.push(request.sessionId);
    return {
      first: outcome === 'strict-failure'
        ? Promise.reject(new Error('controlled original execution deletion failed'))
        : Promise.resolve({ kind: 'legacy-acknowledged' }),
      current: () => undefined
    };
  };
  f.client.createSession = async request => {
    creates.push(request);
    return {
      kind: request.kind, sessionId: request.sessionId, live: true, lifecycle: 'live',
      runtimeBackend: 'legacy-detached', runtimeGuarantee: 'best-effort',
      displayLabel: request.displayLabel, launchMode: request.launchMode,
      shellPath: request.launchSpec.file, cwd: request.launchSpec.cwd,
      cols: request.launchSpec.cols, rows: request.launchSpec.rows, scrollback: request.scrollback,
      output: '', outputSequence: 0, terminalStreamPaged: true,
      terminalAuthorityId: 'new-non-root-authority', terminalRevision: 0
    };
  };
  const prepare = f.host.prepareForHostBoundary;
  f.host.prepareForHostBoundary = async (...args) => {
    await prepare.apply(f.host, args);
    if (outcome !== 'same-id-replacement' && outcome !== 'pending-completion') return;
    let replacementClient;
    if (outcome === 'pending-completion') {
      replacementClient = await f.host.getRuntimeSupervisorClientForBackend(
        f.host.getRuntimeHostBackend(), { deferConnection: true });
      assert.notStrictEqual(replacementClient, f.client, 'completed events use the new actual client epoch');
      for (const method of ['ensureConnected', 'supportsExecutionCandidateProfile', 'supportsTerminalSessionStream',
        'supportsTerminalPagedRead', 'supportsTerminalPagedCompletion', 'subscribeSession', 'createSession']) {
        replacementClient[method] = f.client[method];
      }
      replacementClient.deleteSessionStrict = request => {
        f.deletes.push(request.sessionId);
        completionDeletionStarted.resolve();
        return { first: completionDeletion.promise, current: () => undefined };
      };
      f.host.getPreferredRuntimeSupervisorClient = async () => ({
        client: replacementClient, backend: f.host.getRuntimeHostBackend(), runtimeStoragePath: '/controlled/runtime'
      });
      f.host.terminalReadRelay = new RuntimeTerminalReadRelay();
    }
    await f.host.startTerminalSessionWithSupervisor(f.node.id, 80, 24);
    admittedSession = f.host.terminalSessions.get(f.node.id);
    assert.equal(creates.length, 1, 'the real Host startup admits exactly one replacement execution');
    assert.equal(admittedSession?.runtimeSessionId, creates[0].sessionId);
    assert.notEqual(admittedSession, f.session);
    if (replacementClient) {
      replacementClient.options.onSessionState({
        kind: 'terminal', sessionId: admittedSession.runtimeSessionId, live: false, lifecycle: 'closed',
        runtimeBackend: 'legacy-detached', output: '', cols: 80, rows: 24,
        terminalStreamPaged: true, terminalAuthorityId: 'new-non-root-authority',
        terminalRevision: 2, terminalFinalRevision: 2, outputSequence: 2
      });
      await Promise.race([completionDeletionStarted.promise,
        f.host.waitForPendingRuntimeSupervisorStateCallbacks().then(() => {
          assert.fail('the actual completed callback must reach its controlled remote delete wait');
        })]);
      assert.equal(f.host.terminalSessions.size, 0);
      assert.equal(f.host.runtimeSessionBindings.size, 0);
      assert.equal(f.host.pendingRuntimeSupervisorStateCallbacks.size, 1);
    }
  };
  const template = {
    id: 'controlled-non-root-reset', name: 'Controlled non-root reset', category: 'builtin',
    createdAt: '2026-09-30T00:00:00.000Z', updatedAt: '2026-09-30T00:00:00.000Z',
    nodes: [{ kind: 'note', title: 'Reset note', position: { x: 0, y: 0 },
      size: { width: 320, height: 240 }, metadata: { note: { content: 'Replacement canvas' } } }],
    edges: []
  };
  try {
    vscodeWorkspace.workspaceFolders = [];
    const result = await (mode === 'state-reset'
      ? f.host.resetState()
      : f.host.applyCanvasTemplateRecord({ template }, { reset: true, visibleCenter: { x: 200, y: 200 } }))
      .then(value => ({ value }), error => ({ error }));
    const writes = f.persisted.filter(entry => entry.options?.reason === mode);
    if (outcome === 'pending-completion') {
      const observation = {
        mode, error: result.error?.message ?? null,
        pendingCallbacks: f.host.pendingRuntimeSupervisorStateCallbacks.size,
        completedNodeRetained: f.host.state.nodes.some(node => node.id === f.node.id &&
          node.metadata.terminal?.terminalHistoryDiscarded === true),
        savedWithoutCompletedNode: writes.some(entry => !entry.state.nodes.some(node => node.id === f.node.id)),
        notifiedWithoutCompletedNode: postedStates.some(entry => entry.type === 'host/stateUpdated' &&
          !entry.state.nodes.some(node => node.id === f.node.id))
      };
      console.log(`non-root pending completion observation: ${JSON.stringify(observation)}`);
      assert.deepEqual(f.deletes, ['session-1', creates[0].sessionId]);
      assert.deepEqual({
        pendingCallbacks: observation.pendingCallbacks,
        completedNodeRetained: observation.completedNodeRetained,
        savedWithoutCompletedNode: observation.savedWithoutCompletedNode,
        notifiedWithoutCompletedNode: observation.notifiedWithoutCompletedNode
      }, {
        pendingCallbacks: 1, completedNodeRetained: true,
        savedWithoutCompletedNode: false, notifiedWithoutCompletedNode: false
      });
      assert.match(result.error?.message ?? '', /Runtime session updates are still pending/);
      assert.equal(writes.length, 0);
      completionDeletion.resolve({ kind: 'legacy-acknowledged' });
      await f.host.waitForPendingRuntimeSupervisorStateCallbacks();
      assert.equal(f.host.pendingRuntimeSupervisorStateCallbacks.size, 0);
      assert.equal(f.host.state.nodes.find(node => node.id === f.node.id)?.metadata.terminal.terminalHistoryDiscarded, true);
      return;
    }
    assert.deepEqual(f.deletes, ['session-1'], 'the old boundary deletes only its initially captured execution');
    if (outcome !== 'same-id-replacement') {
      assert.equal(creates.length, 0);
      if (outcome === 'strict-failure') {
        assert.match(result.error?.message ?? '', /Runtime deletion did not complete/);
        assert.equal(f.host.state.nodes.find(node => node.id === f.node.id)?.metadata.terminal.runtimeSessionId, 'session-1');
        assert.strictEqual(f.host.terminalSessions.get(f.node.id), f.session);
        assert.equal(f.host.runtimeSessionBindings.get(f.host.buildRuntimeSessionBindingKey(
          'terminal', 'session-1', '/controlled/runtime', 'legacy-detached'))?.nodeId, f.node.id);
        assert.equal(writes.length, 0);
        assert.equal(postedStates.some(entry => entry.type === 'host/stateUpdated' &&
          !entry.state.nodes.some(node => node.id === f.node.id)), false);
      } else {
        assert.equal(result.error, undefined);
        assert.equal(f.host.terminalSessions.size, 0);
        assert.equal(f.host.runtimeSessionBindings.size, 0);
        assert.equal(f.host.state.nodes.some(node => node.id === f.node.id), false);
        assert.equal(f.host.state.nodes.length, mode === 'state-reset' ? 0 : 1);
        if (mode === 'template-applied') {
          assert.equal(f.host.state.nodes[0].metadata.note.content, 'Replacement canvas');
          assert.equal(result.value.length, 1);
        }
        assert.equal(writes.length, 1);
        assert.equal(postedStates.filter(entry => entry.type === 'host/stateUpdated' &&
          !entry.state.nodes.some(node => node.id === f.node.id)).length, 1);
        assert.deepEqual(postedStates.at(-1).state, f.host.state);
      }
      console.log(`non-root reset ${outcome} passed: ${mode}`);
      return;
    }
    assert.equal(creates.length, 1, `replacement startup must run before evaluating the reset: ${result.error?.stack ?? 'none'}`);
    assert.ok(admittedSession, 'the replacement must reach the real session map');
    const newBindingKey = f.host.buildRuntimeSessionBindingKey(
      'terminal', creates[0].sessionId, '/controlled/runtime', 'legacy-detached');
    const observation = {
      mode, error: result.error?.message ?? null,
      creates: creates.length, deletedOriginalOnly: f.deletes.length === 1 && f.deletes[0] === 'session-1',
      nodeRetained: f.host.state.nodes.some(node => node.id === f.node.id &&
        node.metadata.terminal?.runtimeSessionId === admittedSession.runtimeSessionId),
      sessionRetained: f.host.terminalSessions.get(f.node.id) === admittedSession,
      bindingRetained: f.host.runtimeSessionBindings.get(newBindingKey)?.nodeId === f.node.id,
      savedWithoutNewExecution: writes.some(entry => !entry.state.nodes.some(node => node.id === f.node.id)),
      notifiedWithoutNewExecution: postedStates.some(entry => entry.type === 'host/stateUpdated' &&
        !entry.state.nodes.some(node => node.id === f.node.id))
    };
    console.log(`non-root reset replacement observation: ${JSON.stringify(observation)}`);
    assert.deepEqual({
      nodeRetained: observation.nodeRetained,
      sessionRetained: observation.sessionRetained,
      bindingRetained: observation.bindingRetained,
      savedWithoutNewExecution: observation.savedWithoutNewExecution,
      notifiedWithoutNewExecution: observation.notifiedWithoutNewExecution
    }, {
      nodeRetained: true, sessionRetained: true, bindingRetained: true,
      savedWithoutNewExecution: false, notifiedWithoutNewExecution: false
    }, `${mode} must not overwrite a same-ID execution admitted after its cleanup returned`);
    assert.match(result.error?.message ?? '', /canvas changed while its reset was pending/);
    assert.equal(writes.length, 0);
  } finally {
    completionDeletion.resolve({ kind: 'legacy-acknowledged' });
    await f.host.waitForPendingRuntimeSupervisorStateCallbacks();
    for (const session of f.host.terminalSessions.values()) f.host.disposeManagedExecutionSession(session);
    f.host.disposeRuntimeSupervisorClients();
    vscodeWorkspace.workspaceFolders = foldersBefore;
  }
}

await testOriginalRootBindingValidation();
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
await testCompletedDeleteWaitCannotCloseOrNotifyReplacement('terminal', true);
await testCompletedDeleteWaitCannotCloseOrNotifyReplacement('terminal', false);
await testCompletedDeleteWaitCannotCloseOrNotifyReplacement('agent', true);
await testCompletedDeleteWaitCannotCloseOrNotifyReplacement('agent', false);
await testCompletedDeleteWaitCannotCloseOrNotifyReplacement('agent', true, 'after-snapshot');
await testCompletedDeleteWaitCannotCloseOrNotifyReplacement('terminal', true, 'after-apply');
await testCompletedDeleteWaitCannotCloseOrNotifyReplacement('agent', true, 'after-apply');
await testFullRootTemplateResetCannotLoseNewExecutionDuringDelete('new-execution');
await testFullRootTemplateResetCannotLoseNewExecutionDuringDelete('completed');
await testFullRootTemplateResetCannotLoseNewExecutionDuringDelete('same-id-replacement');
await testFullRootTemplateResetCannotLoseNewExecutionDuringDelete('strict-failure');
await testFullRootTemplateResetCannotLoseNewExecutionDuringDelete('root-replaced');
await testResetCannotSkipCompletionAcceptedAfterInitialCallbackWait();
console.log('existing runtime Host deactivation integrity cases passed; checking non-root reset replacement boundaries');
const nonRootResetFailures = [];
for (const outcome of ['same-id-replacement', 'unchanged', 'strict-failure', 'pending-completion']) {
  for (const mode of ['state-reset', 'template-applied']) {
    try {
      await testNonRootResetCannotLoseExecutionAdmittedAfterBoundary(mode, outcome);
    } catch (error) {
      console.error(`${mode} ${outcome} boundary regression: ${error.stack}`);
      nonRootResetFailures.push(error);
    }
  }
}
if (nonRootResetFailures.length > 0) {
  throw new AggregateError(nonRootResetFailures, 'non-root reset identity boundary regressions');
}
const remainingA6Failures = [];
for (const [name, run] of [
  ['terminal-real-start-during-old-delete', () => testCompletedDeleteWaitCannotCloseOrNotifyReplacement('terminal', true, 'delete', true)],
  ['agent-real-start-during-old-delete', () => testCompletedDeleteWaitCannotCloseOrNotifyReplacement('agent', true, 'delete', true)],
  ['reset-delete-and-permanent-deactivation', () => testResetDeleteWaitOverlapsPermanentDeactivation(false)],
  ['reset-delete-and-owner-deactivation', () => testResetDeleteWaitOverlapsPermanentDeactivation(true)]
]) {
  try { await run(); console.log(`finite A6 Host boundary passed: ${name}`); }
  catch (error) { console.error(`finite A6 Host boundary failed: ${name}: ${error.stack}`); remainingA6Failures.push(error); }
}
if (remainingA6Failures.length) throw new AggregateError(remainingA6Failures, 'finite A6 Host boundary regressions');
console.log('runtime Host deactivation integrity tests passed (flush, admission, stale overwrite, callback tracking, idempotence)');
