import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

function vscodeServices(directory) {
  class Disposable { dispose() {} }
  class EventEmitter { event = () => new Disposable(); fire() {} dispose() {} }
  class ThemeIcon { constructor(id) { this.id = id; } }
  class TreeItem {}
  const folder = { name: 's12', uri: { fsPath: directory } };
  return {
    Disposable, EventEmitter, ThemeIcon, TreeItem,
    ExtensionMode: { Production: 1, Development: 2, Test: 3 },
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    l10n: { t: (message, values = {}) => message.replace(/\{([^}]+)\}/g,
      (placeholder, key) => Object.hasOwn(values, key) ? String(values[key]) : placeholder) },
    env: { appName: 'S12 Node Host authority', shell: process.execPath },
    workspace: {
      isTrusted: true, workspaceFolders: [folder],
      getWorkspaceFolder: uri => uri.fsPath === directory || uri.fsPath.startsWith(`${directory}${path.sep}`)
        ? folder : undefined,
      getConfiguration: () => ({ get: (_key, fallback) => fallback, inspect: () => undefined })
    },
    window: { showErrorMessage: async () => undefined },
    Uri: { file: fsPath => ({ fsPath, path: fsPath, scheme: 'file', toString: () => fsPath }) }
  };
}

export async function createLifecycleHost(context, { label, runtimePersistenceEnabled = false, mocks = {} }) {
  const { directory } = context;
  assert.ok(path.isAbsolute(directory));
  const spec = context.launchSpec(label);
  assert.equal(spec.file, process.execPath);
  assert.equal(spec.args[0], context.subjectPath);
  const { CanvasPanelManager } = await context.load(
    'extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts', { mocks: {
      ...mocks,
      vscode: vscodeServices(directory),
      'node-pty': { spawn() { assert.fail('S12 must not acquire a legacy node-pty process.'); } }
    } });
  const { ExecutionOwnerLifecycle } = await context.load(
    'extensions/vscode/dev-session-canvas/src/panel/executionOwnerLifecycle.ts');
  const { RuntimeTerminalReadRelay } = await context.load(
    'extensions/vscode/dev-session-canvas/src/panel/runtimeTerminalReadRelay.ts');
  const { TerminalProjectionRefreshScheduler } = await context.load(
    'extensions/vscode/dev-session-canvas/src/common/terminalProjectionRefreshScheduler.ts');
  const options = context.ownerOptions('snapshot-only');
  assert.equal(options.kind, 'linux-provider');
  assert.equal(options.profileMode, 'snapshot-only');
  let acquisitions = 0;
  let acquisitionForbidden = false;
  const owner = new ExecutionOwnerLifecycle({
    ...options,
    createTransport(identity) {
      assert.equal(acquisitionForbidden, false, 'This Host must not acquire a local execution.');
      acquisitions += 1;
      return options.createTransport(identity);
    }
  });
  context.trackOwner(owner);
  const posted = [];
  const diagnostics = [];
  const workspaceState = new Map();
  const configuration = { defaultSurface: 'editor', runtimePersistenceEnabled, filesFeatureEnabled: false };
  const storage = path.join(directory, 'workspace-storage');
  const nodeId = 's12-terminal';
  // Keep the actual business methods; only VS Code services and launch configuration are controlled.
  const host = Object.create(CanvasPanelManager.prototype);
  Object.assign(host, {
    context: {
      extensionMode: 3, globalStorageUri: { fsPath: path.join(directory, 'global-storage') },
      workspaceState: {
        get: key => workspaceState.get(key),
        async update(key, value) { workspaceState.set(key, structuredClone(value)); }
      }
    },
    nonNativeExecutionOwner: owner, executionCandidateProfile: options.profile,
    nonNativeHostExecutions: new Map(), agentSessions: new Map(), terminalSessions: new Map(),
    runtimeSessionBindings: new Map(), runtimeSupervisorClients: new Map(), pendingRuntimeSupervisorOperations: new Set(),
    executionSessionOperationTokens: new Map(), activeAssociatedNoteMarkdownEdits: new Map(),
    executionPerformanceDiagnostics: [],
    pendingTerminalInitialInputs: new Map(), pendingTerminalInitialInputDispatches: new Map(),
    pendingTerminalProjectionRefreshes: new Map(), scheduledExecutionOutputPosts: new Map(),
    agentFileActivitySessions: new Map(), terminalReadRelay: new RuntimeTerminalReadRelay(),
    terminalProjectionRefreshScheduler: new TerminalProjectionRefreshScheduler({ intervalMs: 10000, spreadMs: 2000 }),
    activeSurface: undefined, surfaceLifecycle: {},
    state: { version: 1, updatedAt: new Date().toISOString(), nextGroupSequence: 1,
      nodes: [{ id: nodeId, kind: 'terminal', title: 'S12 Terminal', status: 'idle',
        position: { x: 10, y: 20 }, size: { width: 640, height: 360 }, metadata: {} }],
      edges: [], groups: [], fileReferences: [], suppressedFileActivityEdgeIds: [],
      suppressedAutomaticFileArtifactNodeIds: [] },
    rawExtensionStoragePath: storage, storageRecoverySelection: { sourcePath: storage, writePath: storage },
    appliedStartupConfiguration: configuration, readStartupConfiguration: () => configuration,
    fileFilterState: { includeGlobs: [], excludeGlobs: [] }, canvasTemplateInitialized: true,
    pendingWorkspaceStateUpdate: Promise.resolve(), lastLoadedRootLocalStates: [],
    getMultiRootWorkspaceFoldersForComposition: () => [{ path: directory, name: 's12' }],
    getExecutionNodeCwd: () => spec.cwd,
    getTerminalShellPath: () => spec.file, getTerminalShellArgs: () => [...spec.args],
    getTerminalScrollback: () => 100, isRuntimePersistenceEnabled: () => runtimePersistenceEnabled,
    resolveExecutionEnvironment: async () => ({ ...spec.env }),
    getAgentCliConfig: () => ({ defaultProvider: 'codex' }),
    syncNoteMarkdownFileWatchers() {}, cleanupUnreferencedNoteMarkdownRecoverableDraftFiles() {},
    recordStatePersistPerformance() {}, notifySidebarStateChanged() {},
    postState() {}, postMessage: message => posted.push(message),
    recordDiagnosticEvent: (name, detail) => diagnostics.push({ name, detail })
  });
  context.addCleanup(() => {
    host.clearDeferredCanvasStatePersistTimer();
    host.terminalProjectionRefreshScheduler.dispose();
  });
  return {
    host, owner, nodeId, posted, diagnostics,
    get acquisitions() { return acquisitions; },
    forbidAcquisitions() { acquisitionForbidden = true; }
  };
}

export async function runHostLifecycleScenario(context) {
  const label = 'host-deactivation';
  const fixture = await createLifecycleHost(context, { label });
  const { host, owner, nodeId, posted, diagnostics } = fixture;
  await context.before(host.persistState({ workspaceStateMode: 'full', requireRootLocalDurability: true }), 'S12 initial Host save');
  await context.before(host.startTerminalSession(nodeId, 107, 33), 'S12 actual Host Terminal start');
  const record = host.nonNativeHostExecutions.get(`terminal:${nodeId}`);
  assert.ok(record);
  const execution = record.execution;
  context.trackExecution(execution);
  assert.equal(fixture.acquisitions, 1);
  assert.equal(record.localReaders.size, 0);
  await context.until(() => context.output(execution).includes('READY:107x33'), 'S12 initial PTY dimensions');
  assert.equal(await context.before(host.writeExecutionInput('terminal', nodeId, `nonce:${context.nonce}\n`), 'S12 nonce write'), true);
  await context.until(() => context.output(execution).includes(`HASH:${context.expectedHash}`), 'S12 computed nonce response');
  host.resizeExecutionSession('terminal', nodeId, 119, 41);
  await context.until(() => record.cols === 119 && record.rows === 41, 'S12 committed Host resize');
  assert.equal(await context.before(host.writeExecutionInput('terminal', nodeId, 'size\n'), 'S12 size request'), true);
  await context.until(() => context.output(execution).includes('SIZE:119x41'), 'S12 actual resized PTY dimensions');
  const beforeClose = execution.snapshot();
  assert.equal(beforeClose.adapter.process, undefined);
  assert.equal(beforeClose.adapter.source, undefined);
  assert.equal(beforeClose.adapter.seal, undefined);
  assert.equal(beforeClose.stopRequested, false);
  assert.equal(owner.snapshot().pending, 1);
  const saving = record.persistence.promise;
  // The subject only writes its final tail after the actual Host stop sends SIGHUP.
  const closing = host.prepareForDeactivation();
  assert.equal(owner.snapshot().permanent, true);
  await assert.rejects(host.startTerminalSession(nodeId, 107, 33), /admission is closed/i);
  const report = await context.before(closing, 'S12 active Host deactivation', 25000);
  assert.equal(report.kind, 'settled');
  for (const domain of ['local', 'canvasSnapshot', 'remoteDetach']) assert.equal(report[domain].kind, 'settled');
  assert.equal(report.deadline, report.startedAt + 20000);
  assert.ok(Object.isFrozen(report));
  assert.strictEqual(await host.prepareForDeactivation(), report);
  assert.equal(owner.tryResume(), false);
  const persistence = await context.before(saving, 'S12 original final Host persistence');
  assert.equal(persistence.kind, 'saved', persistence.reason);
  const written = await context.verifyWritten(label, execution);
  const signal = JSON.parse(await readFile(path.join(context.directory, `${label}-signal.json`), 'utf8'));
  assert.deepEqual(signal, { signal: 'SIGHUP' });
  const final = execution.snapshot();
  assert.equal(final.adapter.process.kind, 'exited');
  assert.equal(final.adapter.process.exitCode, 7);
  assert.equal(final.adapter.source.kind, 'eof');
  assert.equal(final.adapter.acceptedThrough, final.adapter.consumedThrough);
  assert.equal(final.adapter.seal.lastDataSequence, record.lastDataSequence);
  assert.equal(final.terminal.kind, 'applied');
  assert.equal(final.terminal.finalRevision, record.finalRevision);
  assert.equal(final.terminal.throughDataSequence, record.lastDataSequence);
  assert.equal(final.stopRequested, true);
  assert.equal(final.retired, true);
  assert.equal(final.closeObservation.trigger, 'stop');
  assert.equal(final.closeObservation.reason, 'host-deactivation');
  assert.equal(final.closeObservation.first.kind, 'settled');
  assert.equal(final.closeObservation.current.kind, 'settled');
  assert.deepEqual(Object.keys(final.adapter.resources).sort(), ['provider-control', 'pty-child', 'pty-master', 'pty-source']);
  for (const resource of Object.values(final.adapter.resources)) {
    assert.equal(resource.first.kind, 'released');
    assert.equal(resource.current.kind, 'released');
  }
  assert.equal(owner.snapshot().pending, 0);
  assert.equal(host.nonNativeHostExecutions.size, 0);
  assert.equal(record.mutationError, undefined);
  assert.equal(posted.some(message => message.type === 'host/error'), false);
  const savedAt = diagnostics.findIndex(event => event.name === 'execution/localFinalPersistence');
  const reportedAt = diagnostics.findIndex(event => event.name === 'execution/hostDeactivationBoundary');
  assert.ok(savedAt >= 0 && reportedAt > savedAt, 'Final persistence must precede the successful Host report.');

  const workspaceFile = host.getPersistedCanvasSnapshotPath();
  const rootFile = host.getRootLocalCanvasSnapshotPath(context.directory);
  const workspaceDisk = JSON.parse(await readFile(workspaceFile, 'utf8'));
  const rootDisk = JSON.parse(await readFile(rootFile, 'utf8'));
  const metadata = workspaceDisk.state.nodes.find(node => node.id === nodeId).metadata.terminal;
  assert.deepEqual(rootDisk.state.nodes.find(node => node.id === nodeId).metadata.terminal, metadata);
  assert.deepEqual(metadata.serializedTerminalState, record.finalTerminal);
  assert.equal(metadata.outputSequence, record.finalRevision);
  assert.equal(metadata.lastExitCode, 7);
  assert.equal(metadata.lifecycle, 'closed');
  assert.equal(metadata.persistenceMode, 'snapshot-only');
  assert.equal(metadata.liveSession, false);
  assert.equal(metadata.pendingLaunch, undefined);
  assert.equal(metadata.runtimeSessionId, undefined);
  assert.equal(metadata.lastCols, 119); assert.equal(metadata.lastRows, 41);
  const { SerializedTerminalStateTracker } = await context.load(
    'extensions/vscode/dev-session-canvas/src/common/serializedTerminalState.ts');
  const recoveredTracker = new SerializedTerminalStateTracker(metadata.lastCols, metadata.lastRows, {
    scrollback: 100, initialState: metadata.serializedTerminalState, initialOutputSequence: metadata.outputSequence
  });
  context.addCleanup(() => recoveredTracker.dispose());
  await context.before(recoveredTracker.flush(), 'S12 saved terminal reconstruction');
  const screen = await context.assertScreen(recoveredTracker);

  fixture.forbidAcquisitions();
  const recovery = await createLifecycleHost(context, { label });
  recovery.forbidAcquisitions();
  recovery.host.state = recovery.host.loadReconciledState();
  const restored = recovery.host.state.nodes.find(node => node.id === nodeId).metadata.terminal;
  assert.deepEqual(restored.serializedTerminalState, metadata.serializedTerminalState);
  assert.equal(restored.liveSession, false);
  assert.equal(restored.pendingLaunch, undefined);
  await context.before(recovery.host.restoreLiveRuntimeSessions(), 'S12 reopen runtime restoration');
  recovery.host.attachExecutionSession('terminal', nodeId);
  await context.until(() => recovery.posted.some(message => message.type === 'host/executionSnapshot'), 'S12 saved terminal attachment');
  const attachment = recovery.posted.find(message => message.type === 'host/executionSnapshot').payload;
  assert.equal(attachment.liveSession, false);
  assert.equal(attachment.executionSessionId, undefined);
  assert.deepEqual(attachment.serializedTerminalState, metadata.serializedTerminalState);
  assert.equal(attachment.cols, 119); assert.equal(attachment.rows, 41);
  assert.equal(fixture.acquisitions, 1);
  assert.equal(recovery.acquisitions, 0);
  assert.equal(recovery.owner.snapshot().pending, 0);
  return {
    scenario: label, actualWebview: false, activeHostApiDeactivationValidated: true,
    actualVSCodeDeactivationValidated: false, report, beforeClose,
    process: final.adapter.process, source: final.adapter.source, terminal: final.terminal,
    resources: final.adapter.resources, closeObservation: final.closeObservation,
    acceptedThrough: final.adapter.acceptedThrough, consumedThrough: final.adapter.consumedThrough,
    signal, written, screen, persistence: { ...persistence, workspaceFile, rootFile, lifecycle: metadata.lifecycle,
      lastExitCode: metadata.lastExitCode, revision: metadata.outputSequence },
    reopened: { liveSession: attachment.liveSession, cols: attachment.cols, rows: attachment.rows,
      outputSequence: attachment.outputSequence, acquisitions: recovery.acquisitions },
    diagnostics, reopenedDiagnostics: recovery.diagnostics
  };
}
