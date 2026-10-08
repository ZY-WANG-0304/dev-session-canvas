import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import esbuild from 'esbuild';
import ts from 'typescript';

const sourceRoot = path.resolve('extensions/vscode/dev-session-canvas/src');
const filename = path.join(sourceRoot, 'panel/CanvasPanelManager.ts');
const source = await readFile(filename, 'utf8');
const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
const manager = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'CanvasPanelManager');
const methods = ['applyCompletedRuntimeSupervisorSnapshot', 'postExecutionExitWithFinalSnapshot',
  'assertRuntimeBindingOwner', 'deleteRuntimeSupervisorSessionStrict',
  'isRuntimeSupervisorEventAdmitted', 'invalidateRuntimeSupervisorClientEpoch', 'postCompletedTerminalAvailable',
  'flushLiveExecutionState', 'flushExecutionStateSyncTimer',
  'readExecutionTerminalPage', 'retireLegacyRuntimeSupervisorClientIfUnused',
  'postExecutionSnapshot', 'postPagedExecutionSnapshot', 'writePersistedCanvasSnapshotToDisk'].map(name => {
  const method = manager.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(ast) === name);
  assert.ok(method, name);
  return method.getText(ast);
});
const functions = ['getCompleteRuntimeSupervisorTerminalStream', 'normalizeExecutionOutputSequence',
  'buildExecutionMetadataPatch', 'buildAgentMetadataPatch', 'buildTerminalMetadataPatch', 'normalizeRuntimeStoragePath',
  'normalizeWorkspaceRootPathForComposition'].map(name => {
  const fn = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(fn, name);
  return fn.getText(ast);
});
const bundle = await esbuild.build({ stdin: { contents: `
  import fs from 'node:fs';
  import path from 'node:path';
  import { normalizeCompletedRuntimeHistory } from './common/completedRuntimeHistory';
  import { createRuntimeOwnerDescriptor, parseRuntimeOwnerDescriptor, resolveRootRuntimeSupervisorGeneration,
    resolveRuntimeRootOwnerBaseStoragePath, resolveRuntimeRootOwnerGlobalStoragePath } from './common/runtimeRootOwnership';
  import { isRootOwnerRuntimeSupervisorStorageDir, isRuntimeRootStorageNamespace } from './common/runtimeSupervisorPaths';
  import { cloneTerminalStreamAttachPayload, normalizeTerminalStreamAttachPayload, normalizeTerminalStreamRevision } from './common/terminalSessionStream';
  import { RuntimeTerminalReadRelay } from './panel/runtimeTerminalReadRelay';
  import { TerminalAvailableNotifications } from './panel/terminalAvailableNotifications';
  const vscode = { l10n: { t: (text) => text } };
  const ensureAgentMetadata = (node) => node.metadata.agent;
  const ensureTerminalMetadata = (node) => node.metadata.terminal;
  const normalizeRuntimeHostBackendKind = (kind) => kind;
  const localizeRuntimeSupervisorSnapshotExitMessage = (snapshot) => snapshot.exitMessage;
  const doesAgentResumeStrategyRequireSupport = (strategy) => strategy !== 'none';
  const formatUnknownError = (error) => String(error);
  const cloneFreshSerializedTerminalState = (state) => state;
  const DEFAULT_TERMINAL_COLS = 80;
  const DEFAULT_TERMINAL_ROWS = 24;
  const updateExecutionNode = (state, id, kind, patch) => ({ ...state,
    nodes: state.nodes.map(node => node.id === id ? { ...node, ...patch } : node) });
  ${functions.join('\n')}
  class Harness { ${methods.join('\n')} }
  export { Harness, RuntimeTerminalReadRelay, TerminalAvailableNotifications, normalizeCompletedRuntimeHistory, buildExecutionMetadataPatch,
    createRuntimeOwnerDescriptor, resolveRootRuntimeSupervisorGeneration, resolveRuntimeRootOwnerBaseStoragePath };
`, resolveDir: sourceRoot, loader: 'ts' }, bundle: true, write: false, format: 'cjs', platform: 'node' });
const module = { exports: {} };
new Function('module', 'exports', 'require', bundle.outputFiles[0].text)(module, module.exports, createRequire(import.meta.url));
const { Harness, RuntimeTerminalReadRelay, TerminalAvailableNotifications, normalizeCompletedRuntimeHistory, buildExecutionMetadataPatch,
  createRuntimeOwnerDescriptor, resolveRootRuntimeSupervisorGeneration, resolveRuntimeRootOwnerBaseStoragePath } = module.exports;
const tempDir = await mkdtemp(path.join(os.tmpdir(), 'dsc-completed-history-'));
try {
  for (const kind of ['terminal', 'agent']) {
    const lifecycle = kind === 'terminal' ? 'closed' : 'stopped';
    const stream = makeStream('ENDED-HISTORY');
    const legacy = { persistenceMode: 'snapshot-only', attachmentState: 'history-restored', liveSession: false,
      lifecycle, terminalStream: stream, recentOutput: 'ENDED-HISTORY', serializedTerminalState: stream.checkpoint.serializedState,
      pendingLaunch: 'resume', resumeSessionId: 'provider-session', cwd: '/project', shellPath: '/bin/sh' };
    const migrated = normalizeCompletedRuntimeHistory(kind, legacy);
    assert.equal(migrated.terminalHistoryDiscarded, true);
    assertNoHistory(migrated);
    assert.equal(migrated.resumeSessionId, 'provider-session', 'provider identity remains available for explicit actions');
    assert.deepEqual(normalizeCompletedRuntimeHistory(kind, migrated), migrated);
    for (const excluded of [
      { ...legacy, liveSession: true },
      { ...legacy, persistenceMode: 'live-runtime', attachmentState: 'reattaching' },
      { ...legacy, terminalStream: undefined },
      { ...legacy, lifecycle: 'waiting-input' }
    ]) assert.equal(normalizeCompletedRuntimeHistory(kind, excluded), excluded, 'live and ambiguous snapshot-only records remain intact');

    const small = await complete(kind, 'ENDED-HISTORY');
    const large = await complete(kind, 'ENDED-HISTORY'.repeat(160000));
    assert.equal(large.bytes, small.bytes, 'persisted size must not depend on completed output');
    large.host.state.nodes[0].position.x = 1;
    assert.equal(large.host.writePersistedCanvasSnapshotToDisk(large.file, large.host.state), large.bytes);
    assert.ok(large.bytes < 2048);
    const stored = JSON.parse(await readFile(large.file, 'utf8'));
    assertNoHistory(stored.nodes[0].metadata[kind]);
    assert.ok(!JSON.stringify(stored).includes('ENDED-HISTORY'));
    const restart = buildExecutionMetadataPatch(large.host.state, 'node', kind,
      { lifecycle: kind === 'agent' ? 'starting' : 'launching', pendingLaunch: 'start' });
    assert.equal(restart[kind].terminalHistoryDiscarded, undefined, 'explicit new execution clears the completion marker');

    const failed = harness(kind, makeStream('not saved'));
    const before = failed.host.state;
    failed.host.persistState = async () => { throw new Error('disk full'); };
    await assert.rejects(failed.host.applyCompletedRuntimeSupervisorSnapshot('node', kind, failed.snapshot), /disk full/u);
    assert.equal(failed.host.state, before);
    assert.equal(failed.calls.deleted, false, 'failed node save must not remove the Supervisor source');

    // No current reader means no Host archive, even if the server returns a complete stream.
    const offline = await complete(kind, 'offline');
    assert.equal(offline.host.terminalReadRelay.getCompleted(`editor:${kind}:node`), undefined);
    console.log(`${kind} completed canvas: ${large.bytes} bytes independent of output size; no history or automatic launch`);
  }
  await verifyTransientReaders();
  await verifyReopenDuringSave();
  await verifyRemoteCompletion();
  await verifyCompletedBindingOwner();
  await verifyReaderClientRetirement();
  await verifyReaderClientRetirement(true);
  console.log('runtime completed history tests passed (production handoff, save failure, migration, lifecycle and transient drain)');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

function makeStream(data) {
  return { version: 1, sessionId: 'session', authorityId: 'authority', revision: 2,
    checkpoint: { version: 1, sessionId: 'session', authorityId: 'authority', revision: 0,
      cols: 80, rows: 24, scrollback: 1000, createdAtMs: 1,
      serializedState: { format: 'xterm-serialize-v1', data: '', outputSequence: 0 } },
    events: [1, 2].map(revision => ({ type: 'output', revision, createdAtMs: 1, data })) };
}

function assertNoHistory(metadata) {
  assert.equal(metadata.liveSession, false);
  for (const key of ['terminalStream', 'serializedTerminalState', 'recentOutput', 'runtimeSessionId', 'pendingLaunch']) {
    assert.equal(metadata[key], undefined, key);
  }
}

function harness(kind, stream) {
  const host = new Harness();
  host.surfaceLifecycle = { editor: {}, panel: {} };
  host.terminalAvailableNotifications = new TerminalAvailableNotifications();
  host.resolveRuntimeStoragePath = value => value;
  const lifecycle = kind === 'agent' ? 'stopped' : 'closed';
  const metadata = { lifecycle: kind === 'agent' ? 'running' : 'live', liveSession: true,
    runtimeSessionId: 'session', runtimeStoragePath: '/original-runtime', runtimeBackend: 'legacy-detached',
    pendingLaunch: 'resume', recentOutput: 'old-output', terminalStream: stream,
    resumeStrategy: 'codex-session-id', resumeSessionId: 'provider-session' };
  host.state = { nodes: [{ id: 'node', kind, title: 'Saved title', position: { x: 0, y: 0 }, metadata: { [kind]: metadata } }] };
  const calls = { saved: false, deleted: false, messages: [] };
  const sessions = new Map([['node', { owner: 'supervisor', terminalProjectionMode: 'terminal-stream-v1' }]]);
  host.requireNode = () => host.state.nodes[0];
  host.getExecutionSessions = () => sessions;
  host.getPersistedRuntimeStoragePath = () => '/original-runtime';
  host.persistState = async (options) => { assert.equal(options.requireRootLocalDurability, true); calls.saved = true; };
  host.terminalReadRelay = new RuntimeTerminalReadRelay();
  host.unbindRuntimeSession = () => { assert.equal(calls.saved, true); };
  host.clearExecutionTerminalProjectionRefreshTimers = () => {};
  host.disposeManagedExecutionSession = () => {};
  host.disposeAgentFileActivitySession = async () => {};
  host.postState = () => {};
  host.recordDiagnosticEvent = () => {};
  host.getRuntimeHostBackend = () => ({});
  host.retireLegacyRuntimeSupervisorClientIfUnused = () => {};
  host.deleteRuntimeSupervisorSessionStrict = async (session, options) => {
    assert.equal(calls.saved, true); calls.deleted = true; calls.deleteOptions = options;
  };
  host.isInteractiveSurface = () => true;
  host.getSurfaceMessageWebview = () => ({});
  host.getSurfaceLifecycleIdentity = () => ({ generation: 1, frameId: 'current' });
  host.postMessage = message => calls.messages.push(message);
  host.postExecutionSnapshot = async () => calls.messages.push({ type: 'paged-completion' });
  const snapshot = { kind, sessionId: 'session', terminalAuthorityId: 'authority', terminalRevision: 2,
    outputSequence: 2, terminalStream: stream, live: false, lifecycle, output: stream.events[0].data,
    shellPath: '/bin/sh', cwd: '/project', cols: 80, rows: 24, runtimeBackend: 'legacy-detached',
    lastExitCode: 0, exitMessage: 'Session ended.' };
  return { host, snapshot, calls };
}

async function complete(kind, output) {
  const result = harness(kind, makeStream(output));
  const file = path.join(tempDir, `${kind}.json`);
  result.host.persistState = async options => {
    assert.equal(options.requireRootLocalDurability, true);
    result.calls.saved = true;
    result.bytes = result.host.writePersistedCanvasSnapshotToDisk(file, result.host.state);
  };
  await result.host.applyCompletedRuntimeSupervisorSnapshot('node', kind, result.snapshot);
  assertNoHistory(result.host.state.nodes[0].metadata[kind]);
  assert.equal(result.calls.deleted, true);
  return { ...result, file };
}

async function verifyCompletedBindingOwner() {
  const profile = { linux: 'linux-owner-v1-candidate', darwin: 'macos-owner-v1-candidate',
    win32: 'windows-owner-v1-candidate' }[process.platform];
  const rootOwner = createRuntimeOwnerDescriptor({ environmentKey: 'a'.repeat(64), userStorageScopeKey: 'b'.repeat(64),
    rootPath: path.join(tempDir, 'root'), generation: resolveRootRuntimeSupervisorGeneration(profile) });
  const rootStorage = resolveRuntimeRootOwnerBaseStoragePath(path.join(tempDir, 'global-storage'), rootOwner);
  for (const kind of ['terminal', 'agent']) {
    for (const ownership of ['legacy', 'root']) {
      const { host, snapshot, calls } = harness(kind, makeStream('completed-owned-source'));
      const binding = { backendKind: 'legacy-detached', sessionId: snapshot.sessionId, kind,
        runtimeStoragePath: ownership === 'root' ? rootStorage : path.join(tempDir, 'original-workspace-slot'),
        runtimeOwner: ownership === 'root' ? rootOwner : undefined };
      Object.assign(host.state.nodes[0].metadata[kind], {
        runtimeStoragePath: binding.runtimeStoragePath, runtimeOwner: binding.runtimeOwner
      });
      const dispatched = [], diagnostics = [];
      host.getPersistedRuntimeStoragePath = metadata => metadata.runtimeStoragePath;
      host.getExecutionCandidateProfile = () => profile;
      host.recordDiagnosticEvent = (name, detail) => diagnostics.push({ name, detail });
      host.deleteRuntimeSupervisorSessionStrict = Harness.prototype.deleteRuntimeSupervisorSessionStrict;
      host.deleteRuntimeSupervisorSessionsWithCandidate = async sessions => {
        assert.equal(calls.saved, true, 'The original binding cleanup follows the completed node save.');
        dispatched.push(...sessions);
      };
      if (ownership === 'root') {
        await assert.rejects(host.deleteRuntimeSupervisorSessionStrict({ ...binding, runtimeOwner: undefined },
          { allowRestart: false }), /storage and owner descriptor do not match/,
        'The production strict-delete entry must reject root storage when its owner is omitted.');
        assert.equal(dispatched.length, 0);
      }
      await host.applyCompletedRuntimeSupervisorSnapshot('node', kind, snapshot);
      assert.deepEqual(diagnostics, [], `${kind} ${ownership} completion cleanup must not lose its original owner.`);
      assert.equal(dispatched.length, 1);
      assert.deepEqual({ ...dispatched[0], runtimeOwner: dispatched[0].runtimeOwner }, binding,
        `${kind} ${ownership} completion dispatches the exact original binding.`);
      assertNoHistory(host.state.nodes[0].metadata[kind]);
      assert.equal(host.state.nodes[0].metadata[kind].runtimeOwner, undefined);
    }
  }
}

async function verifyTransientReaders() {
  const stream = makeStream('final-page');
  const { host, snapshot, calls } = harness('terminal', stream);
  let remoteDeleted = false;
  const client = {
    openTerminalRead: async () => ({ readId: 'reader', sessionId: 'session', authorityId: 'authority',
      checkpoint: stream.checkpoint, headRevision: 2 }),
    closeTerminalRead: async () => {},
    readTerminalPage: async params => {
      if (remoteDeleted) throw new Error('source removed');
      return { ...params, events: [stream.events[0]], revision: 1, headRevision: 2 };
    }
  };
  const key = 'editor:terminal:node';
  const params = { sessionId: 'session', authorityId: 'authority', readId: 'reader', afterRevision: 0 };
  await host.terminalReadRelay.open(key, client, 'session', 'authority', 'editor');
  await host.terminalReadRelay.read(key, params);
  await host.applyCompletedRuntimeSupervisorSnapshot('node', 'terminal', snapshot);
  remoteDeleted = true;
  const tail = await host.terminalReadRelay.read(key, { ...params, afterRevision: 1 });
  assert.deepEqual(tail.events, [stream.events[1]]);
  assertNoHistory(host.state.nodes[0].metadata.terminal);
  const final = { snapshot, surface: 'editor', lifecycle: host.getSurfaceLifecycleIdentity() };
  await host.postExecutionExitWithFinalSnapshot('terminal', 'node', 'ended', 'session', final);
  assert.deepEqual(calls.messages.map(message => message.type), ['paged-completion', 'host/executionExit']);
  host.terminalReadRelay.close(key, 'reader');
  assert.equal(host.terminalReadRelay.getCompleted(key), undefined);
  await assert.rejects(host.terminalReadRelay.read(key, { ...params, afterRevision: 1 }));
  calls.messages.length = 0;
  await host.postExecutionExitWithFinalSnapshot('terminal', 'node', 'ended', 'session', final);
  assert.deepEqual(calls.messages.map(message => message.type), ['host/executionSnapshot', 'host/executionExit']);
  calls.messages.length = 0;
  host.getSurfaceLifecycleIdentity = () => ({ generation: 2, frameId: 'reopened' });
  await host.postExecutionExitWithFinalSnapshot('terminal', 'node', 'ended', 'session', final);
  assert.equal(calls.messages.length, 0, 'old final data must not enter a reopened Webview');
  const unacknowledged = new RuntimeTerminalReadRelay();
  await unacknowledged.open(key, client, 'session', 'authority', 'editor');
  unacknowledged.complete(key, stream);
  assert.equal(unacknowledged.getCompleted(key), undefined);
  assert.equal(unacknowledged.has(key, 'session'), false);
}

async function verifyReopenDuringSave() {
  const { host, snapshot, calls } = harness('terminal', makeStream('old-page-only'));
  let finishSave;
  host.persistState = () => new Promise(resolve => { finishSave = () => { calls.saved = true; resolve(); }; });
  const session = host.getExecutionSessions().get('node');
  Object.assign(session, { sessionId: 'session', terminalStreamPaged: true,
    terminalStreamHealthy: true, terminalAuthorityId: 'authority' });
  const key = 'editor:terminal:node';
  let finishOpen;
  host.getRuntimeSupervisorClientForKind = async () => ({
    openTerminalRead: () => new Promise(resolve => { finishOpen = () => resolve({
      readId: 'pending-reader', sessionId: 'session', authorityId: 'authority',
      checkpoint: snapshot.terminalStream.checkpoint, headRevision: 2
    }); }),
    closeTerminalRead: async () => {}
  });
  const open = host.postPagedExecutionSnapshot('terminal', 'node', session, { surface: 'editor' });
  await Promise.resolve();
  assert.equal(typeof finishOpen, 'function');
  const save = host.applyCompletedRuntimeSupervisorSnapshot('node', 'terminal', snapshot);
  const endedState = host.state;
  host.flushLiveExecutionState('terminal', 'node');
  assert.equal(host.state, endedState, 'a delayed live-state flush must not overwrite the saved terminal completion');
  finishOpen();
  await open;
  assert.equal(calls.messages.length, 0, 'pending open must not publish a live reader after completion begins');
  assert.equal(host.terminalReadRelay.has(key, 'session'), false);

  // A reopened page gets empty ended metadata while the original source is still awaiting durable cleanup.
  host.getSurfaceLifecycleIdentity = () => ({ generation: 2, frameId: 'reopened' });
  await Harness.prototype.postExecutionSnapshot.call(host, 'terminal', 'node', { surface: 'editor' });
  const message = calls.messages.at(-1);
  assert.equal(message.type, 'host/executionSnapshot');
  assert.equal(message.payload.liveSession, false);
  assert.equal(message.payload.output, '');
  assert.equal(message.payload.terminalRead, undefined);
  assert.equal(message.payload.terminalStream, undefined);
  finishSave();
  await save;
  assert.equal(host.terminalReadRelay.getCompleted(key), undefined);
}

async function verifyRemoteCompletion() {
  for (const kind of ['terminal', 'agent']) {
    for (const pendingOpen of [false, true]) {
      const { host, snapshot, calls } = harness(kind, makeStream('remote-only'));
      const checkpoint = snapshot.terminalStream.checkpoint;
      snapshot.terminalStream = undefined;
      snapshot.terminalStreamPaged = true;
      snapshot.output = '';
      const session = host.getExecutionSessions().get('node');
      Object.assign(session, { sessionId: 'session', terminalStreamPaged: true,
        terminalStreamHealthy: true, terminalAuthorityId: 'authority' });
      let finishOpen;
      let reads = 0;
      let closes = 0;
      const client = {
        openTerminalRead: () => new Promise(resolve => {
          finishOpen = () => resolve({ readId: 'remote-reader', sessionId: 'session', authorityId: 'authority',
            checkpoint, headRevision: 2 });
          if (!pendingOpen) finishOpen();
        }),
        readTerminalPage: async params => {
          reads += 1;
          return { ...params, events: makeStream('remote-only').events, revision: 2, headRevision: 2 };
        },
        closeTerminalRead: async () => { closes += 1; }
      };
      host.getRuntimeSupervisorClientForKind = async () => client;
      host.postExecutionSnapshot = Harness.prototype.postExecutionSnapshot;
      const opening = host.postPagedExecutionSnapshot(kind, 'node', session, { surface: 'editor' });
      await Promise.resolve();
      if (!pendingOpen) await opening;
      calls.messages.length = 0;
      const completion = host.applyCompletedRuntimeSupervisorSnapshot('node', kind, snapshot);
      assert.equal(host.terminalReadRelay.usesClient(client), true, 'reader keeps the original client alive');
      if (pendingOpen) {
        assert.equal(calls.deleted, false, 'cleanup waits for the in-flight open to settle');
        finishOpen();
        await opening;
      }
      await completion;
      assert.equal(calls.deleteOptions.preserveTerminalReads, true);
      assert.equal(reads, 0, 'completion must not eagerly collect pages');
      assertNoHistory(host.state.nodes[0].metadata[kind]);
      const key = `editor:${kind}:node`;
      assert.equal(host.terminalReadRelay.reads.get(key).completed, undefined, 'no Host full-stream fallback');
      await host.postExecutionExitWithFinalSnapshot(kind, 'node', 'ended', 'session', {
        snapshot, surface: 'editor', lifecycle: host.getSurfaceLifecycleIdentity()
      });
      assert.deepEqual(calls.messages.map(message => message.type),
        ['host/executionSnapshot', 'host/executionTerminalAvailable', 'host/executionExit']);
      assert.equal(calls.messages[0].payload.terminalRead.readId, 'remote-reader');
      assert.equal(calls.messages[0].payload.terminalStream, undefined);
      const page = await host.terminalReadRelay.read(key,
        { sessionId: 'session', authorityId: 'authority', readId: 'remote-reader', afterRevision: 0 });
      assert.equal(page.events.length, 2);
      assert.equal(reads, 1);
      const originalReader = host.terminalReadRelay.reads.get(key);
      if (pendingOpen) {
        client.readTerminalPage = async () => { throw new Error('completed reader disconnected'); };
        await host.readExecutionTerminalPage('editor', { nodeId: 'node', kind, executionSessionId: 'session',
          authorityId: 'authority', readId: 'remote-reader', requestId: 'failed-read', afterRevision: 2 });
        assert.equal(calls.messages.at(-1).payload.readClosed, true);
        assert.match(calls.messages.at(-1).payload.error, /completed reader disconnected/u);
      } else {
        host.terminalReadRelay.close(key);
      }
      assert(originalReader.releasing, 'the original reader owns the asynchronous close');
      await originalReader.releasing;
      assert.equal(closes, 1);
      assert.equal(host.terminalReadRelay.usesClient(client), false);
    }
    const failed = harness(kind, makeStream('not saved'));
    failed.snapshot.terminalStream = undefined;
    failed.snapshot.terminalStreamPaged = true;
    failed.host.persistState = async () => { throw new Error('disk full'); };
    await assert.rejects(failed.host.applyCompletedRuntimeSupervisorSnapshot('node', kind, failed.snapshot), /disk full/u);
    assert.equal(failed.calls.deleted, false);
    for (const invalid of [
      { terminalRevision: 1 },
      { terminalAuthorityId: 'different-authority' },
      { terminalRevision: -1, outputSequence: -1 }
    ]) {
      const rejected = harness(kind, makeStream('invalid'));
      rejected.host.getExecutionSessions().get('node').terminalAuthorityId = 'authority';
      await assert.rejects(rejected.host.applyCompletedRuntimeSupervisorSnapshot('node', kind,
        { ...rejected.snapshot, terminalStream: undefined, terminalStreamPaged: true, ...invalid }), /inconsistent/u);
      assert.equal(rejected.calls.saved, false);
      assert.equal(rejected.calls.deleted, false);
    }
  }
}

async function verifyReaderClientRetirement(withRootOwner = false) {
  const { host } = harness('terminal', makeStream('reader'));
  host.state = { nodes: [] };
  host.agentSessions = new Map();
  host.terminalSessions = new Map();
  host.getRuntimeStoragePathFromBackend = () => '/old-generation';
  host.getRuntimeHostBaseStoragePath = () => '/current-generation';
  host.getMultiRootWorkspaceFoldersForComposition = () => [];
  host.preferredRootRuntimeBackends = new Map();
  host.resolveRuntimeStoragePath = value => value;
  host.buildRuntimeSupervisorClientKey = () => 'old-client';
  let pending = false;
  let disposed = false;
  let finishClose;
  const client = {
    hasPendingRequests: () => pending,
    dispose: () => { disposed = true; },
    openTerminalRead: async () => ({ readId: 'reader', sessionId: 'session', authorityId: 'authority',
      checkpoint: makeStream('').checkpoint, headRevision: 2 }),
    closeTerminalRead: () => new Promise(resolve => {
      pending = true;
      finishClose = () => { pending = false; resolve(); };
    })
  };
  host.runtimeSupervisorClients = new Map([['old-client', client]]);
  const retire = () => Harness.prototype.retireLegacyRuntimeSupervisorClientIfUnused.call(host,
    { kind: 'legacy-detached' }, client);
  let rootClient, rootNode, rootSession;
  if (withRootOwner) {
    const profile = { linux: 'linux-owner-v1-candidate', darwin: 'macos-owner-v1-candidate',
      win32: 'windows-owner-v1-candidate' }[process.platform];
    const owner = createRuntimeOwnerDescriptor({ environmentKey: 'a'.repeat(64), userStorageScopeKey: 'b'.repeat(64),
      rootPath: path.join(tempDir, 'root-c'), generation: resolveRootRuntimeSupervisorGeneration(profile) });
    const storage = resolveRuntimeRootOwnerBaseStoragePath(path.join(tempDir, 'global-storage'), owner);
    rootNode = { id: 'root-c', kind: 'terminal', metadata: { terminal: {
      runtimeBackend: 'legacy-detached', runtimeStoragePath: storage, runtimeOwner: owner,
      runtimeSessionId: 'root-session', persistenceMode: 'live-runtime', attachmentState: 'attached-live'
    } } };
    rootSession = { owner: 'supervisor', runtimeBackend: 'legacy-detached', runtimeStoragePath: storage,
      runtimeOwner: owner, runtimeSessionId: 'root-session' };
    rootClient = { hasPendingRequests: () => false,
      dispose: () => assert.fail('Old slot retirement cannot dispose the current root owner client.') };
    const rootBackend = { kind: 'legacy-detached', runtimeStoragePath: storage };
    host.getRuntimeStoragePathFromBackend = backend => backend.runtimeStoragePath ?? '/old-generation';
    host.buildRuntimeSupervisorClientKey = backend => backend.runtimeStoragePath === storage ? 'root-client' : 'old-client';
    host.getMultiRootWorkspaceFoldersForComposition = () => [{ path: owner.root.normalizedPath }];
    host.preferredRootRuntimeBackends.set(storage, { owner, kind: rootBackend.kind });
    host.getPersistedRuntimeStoragePath = metadata => metadata.runtimeStoragePath;
    host.runtimeSupervisorClients.set('root-client', rootClient);
    host.state.nodes.push(rootNode);
    host.terminalSessions.set(rootNode.id, rootSession);
    host.terminalSessions.set('old-root-b', { owner: 'supervisor', runtimeBackend: 'legacy-detached',
      runtimeStoragePath: '/old-generation', runtimeSessionId: 'old-b-session' });
    retire();
    assert.equal(disposed, false, 'An old slot session in root B pins the client after root A is removed.');
    host.terminalSessions.delete('old-root-b');
    host.state.nodes.push({ id: 'old-root-b', kind: 'terminal', metadata: { terminal: {
      runtimeBackend: 'legacy-detached', runtimeStoragePath: '/old-generation',
      runtimeSessionId: 'old-b-session', persistenceMode: 'live-runtime', attachmentState: 'reattaching'
    } } });
    retire();
    assert.equal(disposed, false, 'A pending old-slot reattach still pins only its original client.');
    host.state.nodes = [rootNode];
    Harness.prototype.retireLegacyRuntimeSupervisorClientIfUnused.call(host, rootBackend, rootClient);
  }
  await host.terminalReadRelay.open('editor:terminal:node', client, 'session', 'authority', 'editor', retire);
  retire();
  assert.equal(disposed, false, 'an existing terminal reader pins the old generation client');
  host.terminalReadRelay.close('editor:terminal:node');
  retire();
  assert.equal(disposed, false, 'reader close RPC must settle before disconnecting');
  finishClose();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(disposed, true);
  assert.equal(host.runtimeSupervisorClients.size, withRootOwner ? 1 : 0);
  if (withRootOwner) {
    assert.strictEqual(host.runtimeSupervisorClients.get('root-client'), rootClient);
    assert.strictEqual(host.state.nodes[0], rootNode);
    assert.strictEqual(host.terminalSessions.get(rootNode.id), rootSession);
  }
}
