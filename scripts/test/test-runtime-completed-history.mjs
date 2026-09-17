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
  'flushLiveExecutionState', 'flushExecutionStateSyncTimer',
  'postExecutionSnapshot', 'postPagedExecutionSnapshot', 'writePersistedCanvasSnapshotToDisk'].map(name => {
  const method = manager.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(ast) === name);
  assert.ok(method, name);
  return method.getText(ast);
});
const functions = ['getCompleteRuntimeSupervisorTerminalStream', 'normalizeExecutionOutputSequence',
  'buildExecutionMetadataPatch', 'buildAgentMetadataPatch', 'buildTerminalMetadataPatch'].map(name => {
  const fn = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(fn, name);
  return fn.getText(ast);
});
const bundle = await esbuild.build({ stdin: { contents: `
  import fs from 'node:fs';
  import path from 'node:path';
  import { normalizeCompletedRuntimeHistory } from './common/completedRuntimeHistory';
  import { cloneTerminalStreamAttachPayload, normalizeTerminalStreamAttachPayload } from './common/terminalSessionStream';
  import { RuntimeTerminalReadRelay } from './panel/runtimeTerminalReadRelay';
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
  export { Harness, RuntimeTerminalReadRelay, normalizeCompletedRuntimeHistory, buildExecutionMetadataPatch };
`, resolveDir: sourceRoot, loader: 'ts' }, bundle: true, write: false, format: 'cjs', platform: 'node' });
const module = { exports: {} };
new Function('module', 'exports', 'require', bundle.outputFiles[0].text)(module, module.exports, createRequire(import.meta.url));
const { Harness, RuntimeTerminalReadRelay, normalizeCompletedRuntimeHistory, buildExecutionMetadataPatch } = module.exports;
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
  host.deleteRuntimeSupervisorSessionStrict = async () => { assert.equal(calls.saved, true); calls.deleted = true; };
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
