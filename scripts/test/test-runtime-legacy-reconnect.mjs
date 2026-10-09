import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

import esbuild from 'esbuild';

const cwd = process.cwd();
const vscodeStub = `class Disposable { dispose() {} }
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
const blockedProcessStub = `function blocked() {
  throw new Error('Native process creation is forbidden in the legacy reconnect test');
}
module.exports = { spawn: blocked, spawnSync: blocked, fork: blocked,
  exec: blocked, execSync: blocked, execFile: blocked, execFileSync: blocked };`;
const bundle = await esbuild.build({
  stdin: {
    contents: `export { CanvasPanelManager, reconcileAgentNodesInArray }
      from './extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager';`,
    resolveDir: cwd,
    loader: 'ts'
  },
  bundle: true, write: false, platform: 'node', format: 'cjs', target: 'node18', external: ['node-pty'],
  plugins: [{
    name: 'legacy-reconnect-host-boundaries',
    setup(build) {
      build.onResolve({ filter: /^(vscode|node-pty|(?:node:)?child_process)$/ }, args => ({
        path: args.path, namespace: 'legacy-reconnect-boundary'
      }));
      build.onLoad({ filter: /.*/, namespace: 'legacy-reconnect-boundary' }, args => ({
        loader: 'js', contents: args.path === 'vscode' ? vscodeStub : blockedProcessStub
      }));
      build.onLoad({ filter: /src\/panel\/CanvasPanelManager\.ts$/ }, async args => ({
        loader: 'ts', contents: `${await readFile(args.path, 'utf8')}\nexport { reconcileAgentNodesInArray };`
      }));
    }
  }]
});
const loaded = { exports: {} };
new Function('require', 'module', 'exports', '__filename', '__dirname', bundle.outputFiles[0].text)(
  createRequire(import.meta.url), loaded, loaded.exports,
  path.resolve('scripts/test/runtime-legacy-reconnect.cjs'), path.resolve('scripts/test')
);
const { CanvasPanelManager, reconcileAgentNodesInArray } = loaded.exports;

function makeHost(kind = 'agent') {
  const node = {
    id: `${kind}-original`, kind, title: 'Original execution', status: 'reattaching', summary: 'Reconnecting',
    position: { x: 0, y: 0 }, size: { width: 640, height: 360 },
    metadata: { [kind]: {
      persistenceMode: 'live-runtime', attachmentState: 'reattaching', liveSession: false,
      runtimeBackend: 'legacy-detached', runtimeStoragePath: '/controlled/legacy-slot',
      runtimeSessionId: `${kind}-original-session`, runtimeGuarantee: 'best-effort',
      lifecycle: kind === 'agent' ? 'waiting-input' : 'live', provider: 'codex',
      runtimeKind: 'pty-cli', resumeSupported: true, resumeStrategy: 'codex-session-id',
      resumeSessionId: '11111111-1111-4111-8111-111111111111',
      shellPath: '/controlled/shell', cwd: '/controlled', recentOutput: 'Original output', outputSequence: 3,
      lastCols: 80, lastRows: 24
    } }
  };
  const calls = { disposed: [], saved: [], retired: [], applied: [], subscribed: [] };
  const host = Object.create(CanvasPanelManager.prototype);
  Object.assign(host, {
    context: { extensionMode: 3 },
    state: { version: 1, nodes: [node], edges: [], groups: [] },
    agentSessions: new Map(), terminalSessions: new Map(), runtimeSessionBindings: new Map(),
    executionSessionOperationTokens: new Map(), runtimeSupervisorEventAdmissionOpen: true,
    runtimeSupervisorClientEpochs: new Map(), runtimeSupervisorClients: new Map(),
    preferredRootRuntimeBackends: new Map(), pendingRuntimeSupervisorOperations: new Set(),
    terminalReadRelay: { closeMatching() {}, usesClient: () => false },
    getLiveRuntimeReconnectBlockReason: () => undefined,
    getExecutionCandidateProfile: () => undefined,
    resolveRuntimeStoragePath: value => value ?? '/controlled/original-workspace-slot',
    getRuntimeHostBaseStoragePath: value => value ?? '/controlled/current-generation',
    getMultiRootWorkspaceFoldersForComposition: () => [],
    clearExecutionTerminalProjectionRefreshTimers() {},
    disposeManagedExecutionSession: session => { if (session) calls.disposed.push(session); },
    disposeAgentFileActivitySession: async () => undefined,
    persistState: options => { calls.saved.push(options); return Promise.resolve(); },
    postState() {}, recordDiagnosticEvent() {},
    retireLegacyRuntimeSupervisorClientIfUnused: (backend, client) => calls.retired.push({ backend, client }),
    applyRuntimeSupervisorSnapshot: async (...args) => calls.applied.push(args),
    subscribeRuntimeSupervisorTerminalStream: async (...args) => calls.subscribed.push(args)
  });
  return { host, node, calls };
}

function assertOriginalHistory(fixture, original) {
  const node = fixture.host.state.nodes[0];
  const metadata = node.metadata[node.kind];
  assert.equal(node.status, 'history-restored');
  assert.equal(metadata.attachmentState, 'history-restored');
  assert.equal(metadata.liveSession, false);
  assert.equal(metadata.pendingLaunch, undefined, 'Reconnect failure cannot authorize an automatic CLI resume.');
  assert.deepEqual(fixture.host.getPersistedLiveRuntimeSessionForNode(node), original,
    'Reconnect failure retains the original binding for a later attach or strict replacement.');
  assert.equal(metadata.resumeSessionId, '11111111-1111-4111-8111-111111111111',
    'Provider identity remains available for an explicit user resume.');
}

for (const kind of ['agent', 'terminal']) {
  for (const failurePoint of ['connect', 'attach', 'disconnect']) {
    const f = makeHost(kind);
    const original = f.host.getPersistedLiveRuntimeSessionForNode(f.node);
    const failure = new Error(`Original ${failurePoint} unavailable`);
    if (failurePoint === 'connect') {
      f.host.getRuntimeSupervisorClientForKind = async () => { throw failure; };
      await f.host.restoreLiveRuntimeSessions();
    } else if (failurePoint === 'attach') {
      await f.host.attachPersistedRuntimeSession(kind, f.node.id, original.sessionId,
        async () => { throw failure; }, { originalBinding: original });
    } else {
      const session = { owner: 'supervisor', runtimeBackend: original.backendKind,
        runtimeStoragePath: original.runtimeStoragePath, runtimeSessionId: original.sessionId,
        terminalProjectionMode: 'legacy-interactive', terminalStreamPaged: false };
      f.host.getExecutionSessions(kind).set(f.node.id, session);
      f.host.handleRuntimeSupervisorDisconnected(original.backendKind, original.runtimeStoragePath, failure);
      assert.deepEqual(f.calls.disposed, [session], 'Only the original local projection is disposed.');
    }
    assertOriginalHistory(f, original);
    assert.equal(f.host.state.nodes[0].metadata[kind].lastRuntimeError, failure.message);
    assert.equal(f.calls.applied.length, 0);
    assert.equal(f.calls.subscribed.length, 0);
  }

  const healthy = makeHost(kind);
  const binding = healthy.host.getPersistedLiveRuntimeSessionForNode(healthy.node);
  const snapshot = { sessionId: binding.sessionId, kind, live: true, runtimeBackend: binding.backendKind };
  await healthy.host.attachPersistedRuntimeSession(kind, healthy.node.id, binding.sessionId,
    async () => ({ snapshot, terminalProjectionMode: 'legacy-interactive' }), { originalBinding: binding });
  assert.equal(healthy.calls.applied.length, 1, 'A healthy original legacy runtime still attaches.');
  assert.strictEqual(healthy.calls.applied[0][2], snapshot);
  assert.deepEqual(healthy.calls.subscribed[0], [snapshot, binding.runtimeStoragePath, undefined]);
  assert.equal(healthy.host.runtimeSessionBindings.size, 1);

  const staleIntent = makeHost(kind);
  staleIntent.node.metadata[kind].pendingLaunch = 'resume';
  const retained = staleIntent.host.getPersistedLiveRuntimeSessionForNode(staleIntent.node);
  staleIntent.host.markExecutionNodeAsHistoryRestored(staleIntent.node.id, kind, 'unavailable');
  assertOriginalHistory(staleIntent, retained);

  const boundClient = makeHost(kind);
  const options = [];
  const client = {};
  boundClient.host.getRuntimeSupervisorClientForBackend = async (_backend, value) => { options.push(value); return client; };
  assert.strictEqual(await boundClient.host.getRuntimeSupervisorClientForKind('legacy-detached',
    { allowRestart: true }, '/controlled/legacy-slot'), client);
  assert.equal(options[0].allowRestart, false, 'Original binding lookup never starts a replacement Supervisor.');

  const deletion = makeHost(kind);
  const originalDeletion = deletion.host.getPersistedLiveRuntimeSessionForNode(deletion.node);
  const deletionCalls = [];
  deletion.host.getRuntimeSupervisorClientForBackend = async (_backend, deleteOptions) => {
    assert.equal(deleteOptions.allowRestart, false, 'Legacy deletion never receives Supervisor startup permission.');
    return { deleteSession: async params => { deletionCalls.push(params); } };
  };
  await deletion.host.deleteRuntimeSupervisorSessionStrict(originalDeletion, { allowRestart: true });
  assert.deepEqual(deletionCalls, [{ sessionId: originalDeletion.sessionId }]);

  const replacement = makeHost(kind);
  replacement.host.assertExecutionCandidateAdmission = () => undefined;
  const token = replacement.host.beginExecutionSessionOperation(kind, replacement.node.id);
  const key = replacement.host.getExecutionSessionOperationKey(kind, replacement.node.id);
  replacement.host.candidateRuntimeStarts = new Map([[key, {
    originalMetadata: replacement.node.metadata[kind], currentMetadata: replacement.node.metadata[kind]
  }]]);
  let deleted;
  replacement.host.deleteRuntimeSupervisorSessionStrict = async (value, deleteOptions) => {
    deleted = { value, deleteOptions };
    throw new Error('Original deletion unconfirmed');
  };
  await assert.rejects(replacement.host.prepareExecutionCandidateReplacement(replacement.node, kind, token),
    /Original deletion unconfirmed/);
  assert.deepEqual(deleted.value, replacement.host.getPersistedLiveRuntimeSessionForNode(replacement.node));
  assert.equal(deleted.deleteOptions.allowRestart, false);
  assert.equal(replacement.host.state.nodes[0].metadata[kind].runtimeSessionId, `${kind}-original-session`);

  const creation = makeHost(kind);
  Object.assign(creation.host, {
    resolveExecutionNodeRuntimeRoot: () => undefined,
    assertExecutionRuntimeRootCurrent() {}, getExecutionNodeCwd: () => '/controlled',
    getTerminalShellPath: () => '/controlled/shell', resolveExecutionEnvironment: async () => ({}),
    resolveRuntimeCreationTarget: async () => ({ runtimeStoragePath: '/controlled/new-generation' }),
    getPreferredRuntimeSupervisorClient: async (_target, createOptions) => {
      assert.equal(createOptions.allowRestart, true, 'Only explicit new-session preparation grants Supervisor startup.');
      throw new Error('Creation connection boundary observed');
    }
  });
  await assert.rejects(kind === 'agent'
    ? creation.host.startAgentSessionWithSupervisorCore(creation.node.id, 80, 24,
      'codex', { command: '/controlled/codex' }, 'codex resume', [], {}, 'resume')
    : creation.host.startTerminalSessionWithSupervisorCore(creation.node.id, 80, 24),
  /Creation connection boundary observed/);
}

for (const hasBinding of [false, true]) {
  const f = makeHost('agent');
  Object.assign(f.node.metadata.agent, { attachmentState: 'history-restored', pendingLaunch: 'resume',
    lifecycle: 'resume-ready', ...(hasBinding ? {} : { runtimeSessionId: undefined }) });
  const [node] = reconcileAgentNodesInArray([f.node]);
  assert.equal(node.metadata.agent.pendingLaunch, undefined, 'Persisted legacy fallback intent is not a new user action.');
  assert.equal(node.metadata.agent.resumeSessionId, f.node.metadata.agent.resumeSessionId);
  assert.equal(node.metadata.agent.runtimeSessionId, f.node.metadata.agent.runtimeSessionId);
  assert.equal(node.status, 'history-restored');
  assert.match(node.summary, /history results were restored/);
  f.node.metadata.agent.lastRuntimeError = 'Original endpoint unavailable';
  assert.equal(reconcileAgentNodesInArray([f.node])[0].summary, 'Original endpoint unavailable');
}
for (const mode of ['failed-connect', 'disconnected']) {
  for (const keepSibling of [false, true]) {
    const f = makeHost('agent');
    const original = f.host.getPersistedLiveRuntimeSessionForNode(f.node);
    const backend = f.host.getRuntimeHostBackend(original.backendKind, original.runtimeStoragePath);
    const key = f.host.buildRuntimeSupervisorClientKey(backend);
    let disposals = 0;
    const client = { hasPendingRequests: () => false, dispose: () => { disposals++; } };
    f.host.runtimeSupervisorClients.set(key, client);
    f.host.retireLegacyRuntimeSupervisorClientIfUnused = CanvasPanelManager.prototype.retireLegacyRuntimeSupervisorClientIfUnused;
    if (keepSibling) {
      const sibling = { ...structuredClone(f.node), id: 'agent-sibling' };
      sibling.metadata.agent.runtimeSessionId = 'sibling-session';
      sibling.metadata.agent.attachmentState = mode === 'failed-connect' ? 'attached-live' : 'reattaching';
      f.host.state.nodes.push(sibling);
      if (mode === 'failed-connect') f.host.agentSessions.set(sibling.id, {
        owner: 'supervisor', runtimeBackend: original.backendKind, runtimeStoragePath: original.runtimeStoragePath,
        runtimeSessionId: sibling.metadata.agent.runtimeSessionId
      });
    }
    if (mode === 'failed-connect') {
      f.host.getRuntimeSupervisorClientForKind = async () => { throw new Error('Original connection failed'); };
      await f.host.restoreLiveRuntimeSessions();
    } else {
      f.host.agentSessions.set(f.node.id, { owner: 'supervisor', runtimeBackend: original.backendKind,
        runtimeStoragePath: original.runtimeStoragePath, runtimeSessionId: original.sessionId });
      f.host.handleRuntimeSupervisorDisconnected(original.backendKind, original.runtimeStoragePath,
        new Error('Original socket closed'));
    }
    assertOriginalHistory(f, original);
    assert.equal(disposals, keepSibling ? 0 : 1,
      `${mode}/${keepSibling}/${key}: only shared attached or reattaching sessions pin the failed client.`);
    assert.equal(f.host.runtimeSupervisorClients.has(key), keepSibling);
    if (keepSibling) {
      f.host.state.nodes = [f.host.state.nodes[0]];
      f.host.agentSessions.clear();
      f.host.retireLegacyRuntimeSupervisorClientIfUnused(backend, client);
      assert.equal(disposals, 1, 'Retirement follows the last shared responsibility instead of force-stopping it.');
    }
  }
}
for (const withFinalization of [false, true]) {
  const f = makeHost('agent');
  f.node.metadata.agent.attachmentState = 'history-restored';
  const original = f.host.getPersistedLiveRuntimeSessionForNode(f.node);
  const backend = f.host.getRuntimeHostBackend(original.backendKind, original.runtimeStoragePath);
  const key = f.host.buildRuntimeSupervisorClientKey(backend);
  let now = 0;
  let expire;
  let pending = true;
  let disposals = 0;
  let observedOptions;
  let finishObservation;
  let finishFinalization;
  let currentResult;
  const observationFirst = new Promise(resolve => { finishObservation = resolve; });
  const finalization = new Promise(resolve => { finishFinalization = resolve; });
  const client = {
    hasPendingRequests: () => pending,
    dispose: () => { disposals++; },
    deleteSessionStrict: (params, options) => {
      assert.equal(params.sessionId, original.sessionId);
      observedOptions = options;
      return { first: observationFirst, current: () => currentResult };
    }
  };
  f.host.runtimeSupervisorClients.set(key, client);
  f.host.retireLegacyRuntimeSupervisorClientIfUnused = CanvasPanelManager.prototype.retireLegacyRuntimeSupervisorClientIfUnused;
  f.host.getRuntimeSupervisorClientForBackend = async () => client;
  f.host.getExecutionCandidateScheduler = () => ({ now: () => now,
    scheduleDeadline: (_deadline, action) => { expire = action; return () => undefined; } });
  const first = f.host.observeStrictRuntimeDelete(original, 10);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(typeof observedOptions.onSettled, 'function');
  const record = f.host.strictRuntimeDeletes.get(f.host.strictRuntimeDeleteKey(original));
  if (withFinalization) record.finalization = finalization;
  now = 10;
  expire();
  const frozenFirst = await first;
  assert.equal(frozenFirst.kind, 'unconfirmed');
  finishObservation({ kind: 'unconfirmed', reason: 'Original request timed out while still pending.' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(disposals, 0, 'A first timeout is not permission to retire the original in-flight request.');
  assert.equal(f.host.runtimeSupervisorClients.has(key), true);
  pending = false;
  currentResult = { kind: 'legacy-acknowledged' };
  observedOptions.onSettled();
  if (withFinalization) {
    assert.equal(disposals, 0, 'The original Host finalization must finish before its client retires.');
    finishFinalization();
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.equal(disposals, 1, 'The original attempt retirement notification releases an otherwise unused client.');
  assert.equal(f.host.runtimeSupervisorClients.has(key), false);
  assert.equal(frozenFirst.kind, 'unconfirmed', 'Late retirement does not rewrite the first timeout as success.');
  assert.deepEqual(f.host.getPersistedLiveRuntimeSessionForNode(f.host.state.nodes[0]), original);
}
for (const liveSession of [false, true]) {
  for (const attachmentState of ['attached-live', 'reattaching', 'history-restored']) {
    const incomplete = makeHost('agent');
    Object.assign(incomplete.node.metadata.agent, { runtimeSessionId: undefined, liveSession,
      attachmentState, pendingLaunch: 'resume' });
    const [node] = reconcileAgentNodesInArray([incomplete.node]);
    assert.equal(node.status, 'history-restored');
    assert.equal(node.metadata.agent.attachmentState, 'history-restored');
    assert.equal(node.metadata.agent.liveSession, false);
    assert.equal(node.metadata.agent.pendingLaunch, undefined,
      'An incomplete live-runtime identity cannot fall through to snapshot-only automatic resume.');
    assert.equal(node.metadata.agent.resumeSessionId, incomplete.node.metadata.agent.resumeSessionId);
  }
}
const newIntent = makeHost('agent');
Object.assign(newIntent.node.metadata.agent, { runtimeSessionId: undefined, liveSession: false,
  attachmentState: 'attached-live', lifecycle: 'starting', pendingLaunch: 'start' });
assert.equal(reconcileAgentNodesInArray([newIntent.node])[0].metadata.agent.pendingLaunch, 'start',
  'A new explicit launch remains distinct from a failed reconnect.');
const snapshotOnly = makeHost('agent');
Object.assign(snapshotOnly.node.metadata.agent, { persistenceMode: 'snapshot-only', liveSession: true,
  runtimeSessionId: undefined, runtimeBackend: undefined, runtimeStoragePath: undefined });
const [resumable] = reconcileAgentNodesInArray([snapshotOnly.node]);
assert.equal(resumable.status, 'resume-ready', 'Existing snapshot-only resume behavior remains separate.');
assert.equal(resumable.metadata.agent.pendingLaunch, 'resume');

console.log('Legacy reconnect tests passed: original bindings, healthy attach, no automatic resume, explicit startup, strict replacement.');
