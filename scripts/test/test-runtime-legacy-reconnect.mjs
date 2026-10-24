import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
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
      from './extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager';
      export { RuntimeSupervisorClient }
        from './extensions/vscode/dev-session-canvas/src/panel/runtimeSupervisorClient';
      export { RUNTIME_SUPERVISOR_ERROR_CODES }
        from './extensions/vscode/dev-session-canvas/src/common/runtimeSupervisorProtocol';`,
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
const { CanvasPanelManager, reconcileAgentNodesInArray, RuntimeSupervisorClient,
  RUNTIME_SUPERVISOR_ERROR_CODES } = loaded.exports;

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
      await assert.rejects(f.host.restoreLiveRuntimeSessions(), error => error === failure);
    } else if (failurePoint === 'attach') {
      await assert.rejects(f.host.attachPersistedRuntimeSession(kind, f.node.id, original.sessionId,
        async () => { throw failure; }, { originalBinding: original }), error => error === failure);
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
  assert.deepEqual(healthy.calls.subscribed[0].slice(0, 3), [snapshot, binding.runtimeStoragePath, undefined]);
  assert.equal(typeof healthy.calls.subscribed[0][3], 'function');
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
      await assert.rejects(f.host.restoreLiveRuntimeSessions(), /Original connection failed/);
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
for (const outcomes of [['success', 'success'], ['success', 'sessionNotFound'],
  ['sessionNotFound', 'success'], ['sessionNotFound', 'sessionNotFound']]) {
  const f = makeHost('agent');
  f.node.status = 'history-restored';
  f.node.metadata.agent.attachmentState = 'history-restored';
  const sibling = structuredClone(f.node);
  sibling.id = 'agent-sibling';
  sibling.metadata.agent.runtimeSessionId = 'sibling-session';
  f.host.state.nodes.push(sibling);
  const originals = f.host.state.nodes.map(node => f.host.getPersistedLiveRuntimeSessionForNode(node));
  const backend = f.host.getRuntimeHostBackend(originals[0].backendKind, originals[0].runtimeStoragePath);
  const key = f.host.buildRuntimeSupervisorClientKey(backend);
  const socket = new EventEmitter();
  socket.destroyed = false;
  socket.setEncoding = () => undefined;
  socket.destroy = () => { socket.destroyed = true; socket.emit('close'); };
  const requests = [];
  socket.write = line => {
    const request = JSON.parse(line);
    if (request.method === 'hello') {
      queueMicrotask(() => socket.emit('data', `${JSON.stringify({ type: 'response', id: request.id,
        ok: true, result: { serverVersion: 1, pid: 123, runtimeBackend: 'legacy-detached',
          runtimeGuarantee: 'best-effort' } })}\n`));
    } else {
      assert.equal(request.method, 'deleteSession');
      requests.push(request);
    }
    return true;
  };
  const client = new RuntimeSupervisorClient({ backend,
    supervisorScriptPath: '/never', supervisorLauncherScriptPath: '/never' });
  const disposals = [];
  const dispose = client.dispose.bind(client);
  client.dispose = () => {
    disposals.push(originals.map(original => f.host.strictRuntimeDeletes.get(
      f.host.strictRuntimeDeleteKey(original)).observation.attemptSettled));
    dispose();
  };
  f.host.runtimeSupervisorClients.set(key, client);
  f.host.retireLegacyRuntimeSupervisorClientIfUnused = CanvasPanelManager.prototype.retireLegacyRuntimeSupervisorClientIfUnused;
  f.host.getRuntimeSupervisorClientForBackend = async () => client;
  f.host.prepareStoppedLegacyHistoryRetirement = async () => undefined;
  f.host.getExecutionCandidateScheduler = () => ({ now: () => 0,
    scheduleDeadline: () => () => undefined });
  try {
    client.attachSocket(socket);
    await client.performHelloHandshake();
    const deletion = f.host.deleteRuntimeSupervisorSessionsWithCandidate(originals);
    await new Promise(resolve => setImmediate(resolve));
    const first = originals.map(original => f.host.strictRuntimeDeletes.get(f.host.strictRuntimeDeleteKey(original)).first);
    assert.deepEqual(requests.map(request => request.params.sessionId), originals.map(original => original.sessionId));
    assert.deepEqual(disposals, [], 'Both original deletion attempts keep their shared client alive.');
    // One data event settles both RPCs before either strict observation consumes its response.
    socket.emit('data', requests.map((request, index) => JSON.stringify({ type: 'response', id: request.id,
      ...(outcomes[index] === 'success' ? { ok: true, result: { ok: true } }
        : { ok: false, error: { code: RUNTIME_SUPERVISOR_ERROR_CODES.sessionNotFound, message: 'Original session absent' } })
    })).join('\n') + '\n');
    const [, firstResults] = await Promise.all([deletion, Promise.all(first)]);
    const expected = outcomes.map(outcome => outcome === 'success' ? 'legacy-acknowledged' : 'legacy-absent');
    assert.deepEqual(firstResults.map(result => result.kind), expected,
      `${outcomes}: one settled attempt cannot retire the socket before its sibling observes the original response.`);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(disposals, [[true, true]], 'Retirement waits for both strict observations, not just an empty RPC map.');
    assert.equal(f.host.runtimeSupervisorClients.has(key), false);
    const again = await Promise.all(originals.map(original => f.host.observeStrictRuntimeDelete(original, 1000)));
    assert.deepEqual(again.map(result => result.kind), expected, 'Later Host operations reuse the confirmed original outcomes.');
    await f.host.deleteRuntimeSupervisorSessionsWithCandidate(originals);
    assert.deepEqual(firstResults.map(result => result.kind), expected, 'Client retirement does not rewrite first outcomes.');
    assert.equal(requests.length, 2, 'Rechecking settled results does not submit replacement deletion attempts.');
  } finally { dispose(); }
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
assert.equal(resumable.metadata.agent.pendingLaunch, undefined);
for (const lifecycle of ['resume-ready', 'stopped']) {
  for (const pendingLaunch of ['resume', 'start', undefined]) {
    const history = structuredClone(snapshotOnly.node);
    Object.assign(history.metadata.agent, { liveSession: false, lifecycle, pendingLaunch });
    const [restored] = reconcileAgentNodesInArray([history]);
    assert.equal(restored.status, lifecycle, 'Historical explicit stops must not be upgraded.');
    assert.equal(restored.metadata.agent.pendingLaunch, pendingLaunch === 'start' ? 'start' : undefined);
    assert.deepEqual(reconcileAgentNodesInArray([restored]), [restored], 'Repeated reads do not recreate a resume intent.');
  }
}
assert.deepEqual(reconcileAgentNodesInArray([resumable]), [resumable]);

console.log('Legacy reconnect tests passed: original bindings, healthy attach, no automatic resume, explicit startup, strict replacement, shared deletion retirement.');

function deferredRestore() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
for (const kind of ['agent', 'terminal']) {
  const f = makeHost(kind), acquired = deferredRestore(), subscribed = deferredRestore(), entered = deferredRestore();
  let connects = 0, attaches = 0, subscriptions = 0;
  const client = {};
  f.host.getRuntimeSupervisorClientForKind = async () => { connects++; await acquired.promise; return client; };
  f.host.requestRuntimeSupervisorSessionAttach = async () => {
    attaches++;
    return { snapshot: { sessionId: f.node.metadata[kind].runtimeSessionId, kind, live: true,
      runtimeBackend: 'legacy-detached' }, terminalProjectionMode: 'legacy-interactive' };
  };
  f.host.applyRuntimeSupervisorSnapshot = async () => { f.node.metadata[kind].attachmentState = 'attached-live'; };
  f.host.subscribeRuntimeSupervisorTerminalStream = async () => { subscriptions++; entered.resolve(); await subscribed.promise; };
  const first = f.host.restoreLiveRuntimeSessions();
  const second = f.host.restoreLiveRuntimeSessions();
  await Promise.resolve(); await Promise.resolve();
  acquired.resolve(); await entered.promise;
  let lateSettled = false;
  const late = f.host.restoreLiveRuntimeSessions().then(() => { lateSettled = true; });
  await Promise.resolve(); await Promise.resolve();
  try {
    assert.equal(connects, 1, 'same-binding callers must share recovery before client acquisition');
    assert.equal(attaches, 1, 'a duplicate recovery must not cancel the established subscription');
    assert.equal(lateSettled, false, 'attached metadata does not complete recovery before subscription');
  } finally { subscribed.resolve(); await Promise.all([first, second, late]); }
  assert.equal(subscriptions, 1);
  await f.host.restoreLiveRuntimeSessions();
  assert.equal(attaches, 1);
}
console.log('concurrent full recovery regression passed');

for (const kind of ['agent', 'terminal']) {
  for (const stage of ['attach', 'snapshot', 'subscribe']) {
    const f = makeHost(kind), gate = deferredRestore(), entered = deferredRestore();
    const failure = new Error(`shared ${stage} failure`);
    f.host.applyRuntimeSupervisorSnapshot = async () => {
      if (stage === 'snapshot') { entered.resolve(); await gate.promise; throw failure; }
      f.node.metadata[kind].attachmentState = 'attached-live';
    };
    f.host.subscribeRuntimeSupervisorTerminalStream = async () => {
      if (stage === 'subscribe') { entered.resolve(); await gate.promise; throw failure; }
    };
    let attachCount = 0;
    const attach = async () => {
      attachCount++;
      if (stage === 'attach') { entered.resolve(); await gate.promise; throw failure; }
      return { snapshot: { kind, sessionId: f.node.metadata[kind].runtimeSessionId, live: true,
        runtimeBackend: 'legacy-detached' }, terminalProjectionMode: 'legacy-interactive' };
    };
    const binding = f.host.getPersistedLiveRuntimeSessionForNode(f.node);
    const first = f.host.attachPersistedRuntimeSession(kind, f.node.id, binding.sessionId, attach);
    await entered.promise;
    const second = f.host.attachPersistedRuntimeSession(kind, f.node.id, binding.sessionId, attach);
    const settled = Promise.allSettled([first, second]);
    gate.resolve(); const results = await settled;
    assert.equal(attachCount, 1);
    assert.ok(results.every(result => result.status === 'rejected' && result.reason === failure));
    assert.equal(f.host.runtimeSessionRestoreTasks.size, 0);
    assert.equal(f.host.state.nodes[0].metadata[kind].lastRuntimeError, failure.message);
  }
  for (const mutation of ['delete', 'replace', 'closed', 'disconnect']) {
    const f = makeHost(kind), gate = deferredRestore(), entered = deferredRestore();
    const disconnectFailure = new Error('Original restore connection lost');
    let dispatches = 0;
    const client = { supportsTerminalSessionStream: () => false, attachSession: async () => {
      dispatches++; return { kind, sessionId: `${kind}-original-session`, live: true };
    } };
    const binding = f.host.getPersistedLiveRuntimeSessionForNode(f.node);
    const request = async isCurrent => { entered.resolve(); await gate.promise;
      return f.host.requestRuntimeSupervisorSessionAttach(client, binding.sessionId, isCurrent); };
    const first = f.host.attachPersistedRuntimeSession(kind, f.node.id, binding.sessionId, request);
    await entered.promise;
    const second = f.host.attachPersistedRuntimeSession(kind, f.node.id, binding.sessionId, request);
    if (mutation === 'delete') f.host.state.nodes = [];
    if (mutation === 'replace') f.node.metadata[kind].runtimeSessionId = 'new-session';
    if (mutation === 'closed') f.host.closeRuntimeSupervisorEventAdmission();
    if (mutation === 'disconnect') f.host.handleRuntimeSupervisorDisconnected('legacy-detached', binding.runtimeStoragePath, disconnectFailure);
    gate.resolve();
    if (mutation === 'disconnect') {
      const results = await Promise.allSettled([first, second]);
      assert.ok(results.every(result => result.status === 'rejected' && result.reason === disconnectFailure));
    } else assert.deepEqual(await Promise.all([first, second]), ['ignored', 'ignored']);
    assert.equal(dispatches, 0, `${mutation}: late attach must not dispatch`);
    assert.equal(f.calls.applied.length, 0);
    assert.equal(f.calls.subscribed.length, 0);
  }
}
for (const method of ['attachSession', 'subscribeSession']) {
  const gate = deferredRestore(); let current = true, dispatched = 0;
  const client = Object.create(RuntimeSupervisorClient.prototype);
  client.ensureConnected = async () => gate.promise;
  client.requestOnConnectedSocket = async () => { dispatched++; };
  const request = client[method]({ sessionId: 'old', terminalStreamMode: 'paged' }, () => current);
  current = false; gate.resolve();
  await assert.rejects(request, /changed before/);
  assert.equal(dispatched, 0, `${method} must recheck after its internal connection await`);
}
console.log('recovery shared failures, deletion/replacement/disconnect and RPC dispatch guards passed (16 cases)');

// A disconnected leader cannot remove the registration of its replacement generation.
{
  const f = makeHost('terminal'), oldGate = deferredRestore(), newGate = deferredRestore();
  const oldEntered = deferredRestore(), newEntered = deferredRestore();
  const binding = f.host.getPersistedLiveRuntimeSessionForNode(f.node);
  const result = { snapshot: { kind: 'terminal', sessionId: binding.sessionId, live: true,
    runtimeBackend: 'legacy-detached' }, terminalProjectionMode: 'legacy-interactive' };
  const first = f.host.attachPersistedRuntimeSession('terminal', f.node.id, binding.sessionId, async () => {
    oldEntered.resolve(); await oldGate.promise; return result;
  });
  await oldEntered.promise;
  f.host.terminalSessions.set(f.node.id, { owner: 'supervisor', runtimeSessionId: binding.sessionId,
    runtimeBackend: 'legacy-detached', runtimeStoragePath: binding.runtimeStoragePath, terminalStreamPaged: true });
  f.host.reconnectPagedRuntimeSession = () => {};
  f.host.handleRuntimeSupervisorDisconnected('legacy-detached', binding.runtimeStoragePath);
  const second = f.host.attachPersistedRuntimeSession('terminal', f.node.id, binding.sessionId, async () => {
    newEntered.resolve(); await newGate.promise; return result;
  });
  await newEntered.promise;
  oldGate.resolve(); assert.equal(await first, 'ignored');
  assert.equal(f.host.runtimeSessionRestoreTasks.size, 1, 'old cleanup must retain the new generation');
  newGate.resolve(); assert.equal(await second, 'restored');
  assert.equal(f.calls.applied.length, 1);
  assert.equal(f.calls.subscribed.length, 1);
  assert.equal(f.host.runtimeSessionRestoreTasks.size, 0);
}
for (const mutation of ['delete', 'replace']) {
  const f = makeHost('terminal'), gate = deferredRestore(), entered = deferredRestore();
  const binding = f.host.getPersistedLiveRuntimeSessionForNode(f.node);
  f.host.applyRuntimeSupervisorSnapshot = async () => { f.node.metadata.terminal.attachmentState = 'attached-live'; };
  let subscriptions = 0;
  f.host.subscribeRuntimeSupervisorTerminalStream = async () => { subscriptions++; entered.resolve(); await gate.promise; };
  const attach = async () => ({ snapshot: { kind: 'terminal', sessionId: binding.sessionId, live: true,
    runtimeBackend: 'legacy-detached' }, terminalProjectionMode: 'legacy-interactive' });
  const first = f.host.attachPersistedRuntimeSession('terminal', f.node.id, binding.sessionId, attach);
  await entered.promise;
  const second = f.host.attachPersistedRuntimeSession('terminal', f.node.id, binding.sessionId, attach);
  if (mutation === 'delete') f.host.state.nodes = [];
  else f.node.metadata.terminal.runtimeSessionId = 'new-session';
  const successor = { owner: 'supervisor', runtimeSessionId: 'new-session' };
  f.host.terminalSessions.set(f.node.id, successor);
  gate.resolve(); assert.deepEqual(await Promise.all([first, second]), ['ignored', 'ignored']);
  assert.equal(subscriptions, 1);
  assert.strictEqual(f.host.terminalSessions.get(f.node.id), successor);
}
console.log('new recovery generation and deletion during dispatched subscription passed (3 cases)');

for (const kind of ['agent', 'terminal']) {
  const f = makeHost(kind), entered = deferredRestore(), acquired = deferredRestore();
  const failure = new Error('Original connection closed before a managed session existed');
  let dispatched = 0;
  f.host.getRuntimeSupervisorClientForKind = async () => { entered.resolve(); await acquired.promise; return {}; };
  f.host.requestRuntimeSupervisorSessionAttach = async () => { dispatched++; assert.fail('Disconnected restore must not attach'); };
  const first = f.host.restoreLiveRuntimeSessions();
  await entered.promise;
  const second = f.host.restoreLiveRuntimeSessions();
  await Promise.resolve(); await Promise.resolve();
  const settled = Promise.allSettled([first, second]);
  f.host.handleRuntimeSupervisorDisconnected('legacy-detached', '/controlled/legacy-slot', failure);
  try {
    assert.equal(f.host.state.nodes[0].metadata[kind].attachmentState, 'history-restored',
      'initial restore disconnect must not leave a node permanently reattaching');
    assert.equal(f.host.state.nodes[0].metadata[kind].lastRuntimeError, failure.message);
  } finally { acquired.resolve(); await settled; }
  const results = await settled;
  assert.ok(results.every(result => result.status === 'rejected' && result.reason === failure));
  assert.equal(dispatched, 0);
  assert.equal(f.host.runtimeSessionRestoreTasks.size, 0);
}
console.log('disconnect before initial session creation preserves the original error for all waiters (2 cases)');

{
  const f = makeHost('terminal'), entered = deferredRestore(), blocked = deferredRestore();
  const secondNode = structuredClone(f.node);
  secondNode.id = 'independent-node';
  secondNode.metadata.terminal.runtimeSessionId = 'independent-session';
  f.host.state.nodes.push(secondNode);
  const snapshot = node => ({ snapshot: { kind: 'terminal', sessionId: node.metadata.terminal.runtimeSessionId,
    live: true, runtimeBackend: 'legacy-detached' }, terminalProjectionMode: 'legacy-interactive' });
  const first = f.host.attachPersistedRuntimeSession('terminal', f.node.id, f.node.metadata.terminal.runtimeSessionId,
    async () => { entered.resolve(); await blocked.promise; return snapshot(f.node); });
  await entered.promise;
  try {
    const second = await f.host.attachPersistedRuntimeSession('terminal', secondNode.id,
      secondNode.metadata.terminal.runtimeSessionId, async () => snapshot(secondNode));
    assert.equal(second, 'restored');
    assert.equal(f.calls.applied[0][0], secondNode.id, 'another session must not wait for a blocked recovery');
  } finally { blocked.resolve(); await first; }
}
console.log('independent session recovery remains concurrent');
