import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import esbuild from 'esbuild';

/** Actual Host deletion, strict client and shared store; VS Code rendering/activation are not started. */
export async function deleteDisconnectedRuntimeNode({ directory, backend, owner, sessionId, kind, client }) {
  const require = createRequire(import.meta.url);
  const built = await esbuild.build({ stdin: { contents: `
    export { CanvasPanelManager } from './extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager';
    export { SharedRootCanvasStore } from './extensions/vscode/dev-session-canvas/src/panel/sharedRootCanvasStore';
    export { createNodeExecutionScheduler } from './extensions/vscode/dev-session-canvas/src/panel/executionProviderTransport';
  `, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false,
    external: ['vscode', 'node-pty'] });
  const module = { exports: {} };
  class Disposable { dispose() {} }
  class EventEmitter { event = () => new Disposable(); fire() {} dispose() {} }
  const vscode = { Disposable, EventEmitter, ThemeIcon: class {}, TreeItem: class {},
    ExtensionMode: { Test: 3, Development: 2, Production: 1 }, TreeItemCollapsibleState: { None: 0 },
    l10n: { t: message => message }, window: {}, workspace: { workspaceFolders: [], isTrusted: true },
    Uri: { file: fsPath => ({ fsPath, scheme: 'file' }) } };
  new Function('require', 'module', 'exports', '__dirname', '__filename', built.outputFiles[0].text)(
    name => name === 'vscode' ? vscode : require(name), module, module.exports, directory, path.join(directory, 'host.cjs'));
  const { CanvasPanelManager, SharedRootCanvasStore, createNodeExecutionScheduler } = module.exports;
  const root = owner.root.normalizedPath;
  const storage = path.dirname(backend.paths.storageDir);
  const node = { id: 'disconnected-node', kind, title: 'Disconnected node', status: 'history-restored', summary: '',
    position: { x: 0, y: 0 }, size: { width: 640, height: 480 }, metadata: { [kind]: {
      runtimeSessionId: sessionId, runtimeStoragePath: storage, runtimeBackend: backend.kind, runtimeOwner: owner,
      persistenceMode: 'live-runtime', attachmentState: 'history-restored', liveSession: false
    } } };
  const initial = { version: 1, updatedAt: '', nodes: [node], groups: [], edges: [], nextGroupSequence: 1, fileReferences: [] };
  const filename = path.join(directory, 'shared-canvas', 'canvas-state.json');
  const messages = [], events = [];
  const host = Object.create(CanvasPanelManager.prototype);
  let peerState;
  const store = new SharedRootCanvasStore(filename, initial, state => { host.state = state; }, error => { throw error; });
  const peer = new SharedRootCanvasStore(filename, initial, state => { peerState = state; }, error => { throw error; });
  let reopened;
  try {
    await store.ready; await peer.ready; await store.publish(initial); await peer.publish(initial);
    Object.assign(host, {
      context: { extensionMode: 3, globalStorageUri: { fsPath: path.join(directory, 'host-global') } },
      state: structuredClone(initial), sharedRootCanvasStores: new Map([[root, store]]),
      nonNativeHostExecutions: new Map(), executionSessionOperationTokens: new Map(),
      activeAssociatedNoteMarkdownEdits: new Map(), pendingTerminalProjectionRefreshes: new Map(),
      agentSessions: new Map(), terminalSessions: new Map(), runtimeSessionBindings: new Map(),
      runtimeSupervisorClients: new Map(), terminalReadRelay: { usesSession: () => false, closeMatching() {} },
      isRuntimePersistenceEnabled: () => true, getExecutionCandidateProfile: () => 'linux-owner-v1-candidate',
      getExecutionCandidateScheduler: () => createNodeExecutionScheduler(),
      getCanvasPersistenceWorkspaceFolders: () => [{ path: root, name: 'fixture' }],
      resolveExecutionNodeRuntimeRoot: () => root, getPersistedRuntimeStoragePath: metadata => metadata.runtimeStoragePath,
      resolveRuntimeStoragePath: value => value ?? storage, getRuntimeHostBackend: () => backend,
      getRuntimeSupervisorClientForBackend: async (_backend, options) => {
        assert.equal(options.allowRestart, false); assert.equal(options.deferConnection, true); return client;
      },
      retireLegacyRuntimeSupervisorClientIfUnused() {}, dropPendingTerminalInitialInput() {},
      reconcileCanvasFileArtifacts: value => value, postMessage: value => messages.push(value), postState() {},
      recordDiagnosticEvent: (name, detail) => events.push({ name, detail }),
      persistState: async () => {
        await store.publish(host.state);
        await writeFile(path.join(directory, 'workspace-canvas.json'), JSON.stringify(host.state));
      }
    });
    host.bindRuntimeSession(node.id, kind, sessionId, storage, backend.kind);
    await host.deleteNode(node.id);
    assert.equal(host.state.nodes.length, 0, JSON.stringify(messages));
    assert(messages.some(message => message.payload?.message?.startsWith('Node removed.')));
    const prepared = events.find(event => event.name === 'runtime/disconnectedNodeRemovalPrepared');
    assert(prepared);
    const receipt = JSON.parse(await readFile(prepared.detail.receiptPath, 'utf8'));
    assert.equal(receipt.sessionId, sessionId); assert.deepEqual(receipt.runtimeOwner, owner);
    assert.equal(receipt.status, 'runtime-stop-unconfirmed');
    assert.equal(JSON.parse(await readFile(path.join(directory, 'workspace-canvas.json'), 'utf8')).nodes.length, 0);
    const stale = structuredClone(initial); stale.nodes[0].title = 'late peer edit';
    await peer.publish(stale); await peer.flush();
    assert.equal(JSON.parse(await readFile(filename, 'utf8')).state.nodes.length, 0);
    reopened = new SharedRootCanvasStore(filename, initial, state => { peerState = state; }, error => { throw error; });
    await reopened.ready;
    assert.equal(peerState.nodes.length, 0, 'reopened window must observe durable deletion');
    return { actualHostDelete: true, strictClientConnectionFailure: true, durableStopUnconfirmedReceipt: true,
      sharedStaleEditCannotResurrect: true, reopenedCanvasHasNoNode: true };
  } finally { reopened?.dispose(); peer.dispose(); store.dispose(); }
}
