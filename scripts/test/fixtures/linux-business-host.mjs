import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

function vscodeServices(directory) {
  class Disposable { dispose() {} }
  class EventEmitter { event = () => new Disposable(); fire() {} dispose() {} }
  class ThemeIcon { constructor(id) { this.id = id; } }
  class TreeItem {}
  return {
    Disposable, EventEmitter, ThemeIcon, TreeItem,
    ExtensionMode: { Production: 1, Development: 2, Test: 3 },
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    l10n: { t: (message, values = {}) => message.replace(/\{([^}]+)\}/g,
      (placeholder, key) => Object.hasOwn(values, key) ? String(values[key]) : placeholder) },
    env: { appName: 'S11 Node Host authority', shell: process.execPath },
    workspace: {
      isTrusted: true, workspaceFolders: [{ name: 's11', uri: { fsPath: directory } }],
      getWorkspaceFolder: uri => uri.fsPath === directory || uri.fsPath.startsWith(`${directory}${path.sep}`)
        ? { name: 's11', uri: { fsPath: directory } } : undefined,
      getConfiguration: () => ({ get: (_key, fallback) => fallback, inspect: () => undefined })
    },
    window: { showErrorMessage: async () => undefined },
    Uri: { file: fsPath => ({ fsPath, path: fsPath, scheme: 'file', toString: () => fsPath }) }
  };
}

export async function runHostScenario(context) {
  const { directory, nonce, expectedHash } = context;
  assert.ok(path.isAbsolute(directory));
  const label = 'host-natural';
  const spec = context.launchSpec(label);
  assert.equal(spec.file, process.execPath);
  assert.equal(spec.args[0], context.subjectPath);
  const mocks = {
    vscode: vscodeServices(directory),
    'node-pty': { spawn() { assert.fail('The S11 Host must not acquire a legacy node-pty process.'); } }
  };
  const { CanvasPanelManager } = await context.load(
    'extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts', { mocks });
  const { ExecutionOwnerLifecycle } = await context.load(
    'extensions/vscode/dev-session-canvas/src/panel/executionOwnerLifecycle.ts');
  const { SerializedTerminalStateTracker } = await context.load(
    'extensions/vscode/dev-session-canvas/src/common/serializedTerminalState.ts');
  const options = context.ownerOptions('snapshot-only');
  assert.equal(options.kind, 'linux-provider');
  assert.equal(options.profileMode, 'snapshot-only');
  let acquisitions = 0;
  let reopened = false;
  const guardedOptions = {
    ...options,
    createTransport(identity) {
      assert.equal(reopened, false, 'Reopening saved Host state must not acquire an execution.');
      acquisitions += 1;
      return options.createTransport(identity);
    }
  };
  const updates = new Map();
  const posted = [];
  const diagnostics = [];
  const configuration = { defaultSurface: 'editor', runtimePersistenceEnabled: false, filesFeatureEnabled: false };
  const storage = path.join(directory, 'workspace-storage');
  const nodeId = 's11-terminal';

  function makeHost() {
    const owner = new ExecutionOwnerLifecycle(guardedOptions);
    context.trackOwner(owner);
    // Use the unchanged business methods without activating VS Code UI, watchers or services.
    const host = Object.create(CanvasPanelManager.prototype);
    Object.assign(host, {
      context: {
        extensionMode: 3, globalStorageUri: { fsPath: path.join(directory, 'global-storage') },
        workspaceState: {
          get: key => updates.get(key),
          async update(key, value) { updates.set(key, structuredClone(value)); }
        }
      },
      nonNativeExecutionOwner: owner, executionCandidateProfile: options.profile,
      nonNativeHostExecutions: new Map(), agentSessions: new Map(), terminalSessions: new Map(),
      runtimeSessionBindings: new Map(), runtimeSupervisorClients: new Map(), pendingRuntimeSupervisorOperations: new Set(),
      executionSessionOperationTokens: new Map(), activeAssociatedNoteMarkdownEdits: new Map(),
      pendingTerminalInitialInputs: new Map(), pendingTerminalInitialInputDispatches: new Map(),
      activeSurface: undefined, surfaceLifecycle: {},
      state: { version: 1, updatedAt: new Date().toISOString(), nextGroupSequence: 1,
        nodes: [{ id: nodeId, kind: 'terminal', title: 'S11 Terminal', status: 'idle',
          position: { x: 10, y: 20 }, size: { width: 640, height: 360 }, metadata: {} }],
        edges: [], groups: [], fileReferences: [], suppressedFileActivityEdgeIds: [],
        suppressedAutomaticFileArtifactNodeIds: [] },
      rawExtensionStoragePath: storage, storageRecoverySelection: { sourcePath: storage, writePath: storage },
      appliedStartupConfiguration: configuration, readStartupConfiguration: () => configuration,
      fileFilterState: { includeGlobs: [], excludeGlobs: [] }, canvasTemplateInitialized: true,
      pendingWorkspaceStateUpdate: Promise.resolve(), lastLoadedRootLocalStates: [],
      getMultiRootWorkspaceFoldersForComposition: () => [{ path: directory, name: 's11' }],
      getExecutionNodeCwd: () => spec.cwd,
      getTerminalShellPath: () => spec.file, getTerminalShellArgs: () => [...spec.args],
      getTerminalScrollback: () => 100, isRuntimePersistenceEnabled: () => false,
      resolveExecutionEnvironment: async () => ({ ...spec.env }),
      getAgentCliConfig: () => ({ defaultProvider: 'codex' }),
      syncNoteMarkdownFileWatchers() {}, cleanupUnreferencedNoteMarkdownRecoverableDraftFiles() {},
      recordStatePersistPerformance() {}, notifySidebarStateChanged() {},
      postState() {}, postMessage: message => posted.push(message),
      recordDiagnosticEvent: (name, detail) => diagnostics.push({ name, detail })
    });
    context.addCleanup(() => host.clearDeferredCanvasStatePersistTimer());
    return { host, owner };
  }

  const { host, owner } = makeHost();
  await context.before(host.persistState({ workspaceStateMode: 'full', requireRootLocalDurability: true }), 'Host initial canvas save');
  const starting = host.startTerminalSession(nodeId, spec.cols, spec.rows);
  void starting.catch(() => {});
  await context.before(starting, 'Host actual Terminal start');
  const record = host.nonNativeHostExecutions.get(`terminal:${nodeId}`);
  assert.ok(record, 'Actual Host must retain the original owned execution.');
  const execution = record.execution;
  context.trackExecution(execution);
  assert.equal(acquisitions, 1);
  assert.equal(record.process, undefined);
  assert.equal(record.localReaders.size, 0, 'No Webview reader is invented for this Node authority.');
  await context.until(() => context.output(execution).includes('READY:107x33'), 'Host subject initial dimensions');
  assert.equal(await context.before(host.writeExecutionInput('terminal', nodeId, `nonce:${nonce}\n`), 'Host nonce write'), true);
  await context.until(() => context.output(execution).includes(`HASH:${expectedHash}`), 'Host subject computed nonce hash');
  host.resizeExecutionSession('terminal', nodeId, 119, 41);
  await context.until(() => record.cols === 119 && record.rows === 41, 'Host confirmed resize authority commit');
  assert.equal(await context.before(host.writeExecutionInput('terminal', nodeId, 'size\n'), 'Host size request write'), true);
  await context.until(() => context.output(execution).includes('SIZE:119x41'), 'Host subject actual PTY dimensions');
  assert.equal(await context.before(host.writeExecutionInput('terminal', nodeId, 'finish\n'), 'Host finish request write'), true);
  const persistence = await context.before(record.persistence.promise, 'Host actual final snapshot save');
  assert.equal(persistence.kind, 'saved', persistence.reason);
  await context.until(() => execution.snapshot().retired, 'Host original execution retirement');
  const written = await context.verifyWritten(label, execution);
  const final = execution.snapshot();
  assert.equal(final.adapter.process.kind, 'exited');
  assert.equal(final.adapter.process.exitCode, 7);
  assert.equal(final.adapter.source.kind, 'eof');
  assert.equal(final.adapter.acceptedThrough, final.adapter.consumedThrough);
  assert.equal(final.terminal.kind, 'applied');
  assert.equal(final.terminal.finalRevision, record.finalRevision);
  assert.equal(final.terminal.throughDataSequence, record.lastDataSequence);
  assert.equal(owner.snapshot().pending, 0);
  assert.equal(host.nonNativeHostExecutions.size, 0);
  assert.equal(record.mutationError, undefined);
  assert.equal(posted.some(message => message.type === 'host/error'), false);

  const workspaceFile = host.getPersistedCanvasSnapshotPath();
  const rootFile = host.getRootLocalCanvasSnapshotPath(directory);
  const workspaceDisk = JSON.parse(await readFile(workspaceFile, 'utf8'));
  const rootDisk = JSON.parse(await readFile(rootFile, 'utf8'));
  const metadata = workspaceDisk.state.nodes.find(node => node.id === nodeId).metadata.terminal;
  assert.deepEqual(rootDisk.state.nodes.find(node => node.id === nodeId).metadata.terminal, metadata);
  assert.deepEqual(metadata.serializedTerminalState, record.finalTerminal);
  assert.equal(metadata.outputSequence, record.finalRevision);
  assert.equal(metadata.lastExitCode, 7);
  assert.equal(metadata.lifecycle, 'error');
  assert.equal(metadata.persistenceMode, 'snapshot-only');
  assert.equal(metadata.liveSession, false);
  assert.equal(metadata.pendingLaunch, undefined);
  assert.equal(metadata.runtimeSessionId, undefined);
  assert.equal(metadata.lastCols, 119); assert.equal(metadata.lastRows, 41);

  // The live tracker has been retired; validate the actual saved serialization in a fresh real tracker.
  const recoveredTracker = new SerializedTerminalStateTracker(metadata.lastCols, metadata.lastRows, {
    scrollback: 100, initialState: metadata.serializedTerminalState, initialOutputSequence: metadata.outputSequence
  });
  context.addCleanup(() => recoveredTracker.dispose());
  await context.before(recoveredTracker.flush(), 'Host saved terminal projection');
  const screen = await context.assertScreen(recoveredTracker);

  reopened = true;
  const recovery = makeHost();
  recovery.host.state = recovery.host.loadReconciledState();
  const restoredMetadata = recovery.host.state.nodes.find(node => node.id === nodeId).metadata.terminal;
  assert.deepEqual(restoredMetadata.serializedTerminalState, metadata.serializedTerminalState);
  assert.equal(restoredMetadata.liveSession, false);
  assert.equal(restoredMetadata.pendingLaunch, undefined);
  await context.before(recovery.host.restoreLiveRuntimeSessions(), 'Host reopen runtime restore admission');
  const beforeAttach = posted.length;
  recovery.host.attachExecutionSession('terminal', nodeId);
  await context.until(() => posted.slice(beforeAttach).some(message => message.type === 'host/executionSnapshot'), 'Host actual saved snapshot attachment');
  const attachment = posted.slice(beforeAttach).find(message => message.type === 'host/executionSnapshot').payload;
  assert.equal(attachment.liveSession, false);
  assert.equal(attachment.executionSessionId, undefined);
  assert.deepEqual(attachment.serializedTerminalState, metadata.serializedTerminalState);
  assert.equal(attachment.cols, 119); assert.equal(attachment.rows, 41);
  assert.equal(acquisitions, 1, 'Load, restore and attachment cannot silently create another execution.');
  assert.equal(recovery.owner.snapshot().pending, 0);
  return {
    scenario: label, authority: 'actual CanvasPanelManager under Node with stubbed VS Code services',
    actualWebview: false, activeDeactivationValidated: false, process: final.adapter.process,
    source: final.adapter.source, terminal: final.terminal, resources: final.adapter.resources,
    acceptedThrough: final.adapter.acceptedThrough, consumedThrough: final.adapter.consumedThrough,
    written, screen, persistence: { ...persistence, workspaceFile, rootFile, revision: metadata.outputSequence },
    reopened: { liveSession: attachment.liveSession, cols: attachment.cols, rows: attachment.rows,
      outputSequence: attachment.outputSequence, acquisitions, newExecutions: recovery.owner.snapshot().pending },
    diagnostics
  };
}
