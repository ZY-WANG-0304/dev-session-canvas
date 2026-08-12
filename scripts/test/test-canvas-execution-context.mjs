import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

import esbuild from 'esbuild';

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'dsc-canvas-execution-context-'));
const previousHome = process.env.HOME;
const previousUserProfile = process.env.USERPROFILE;

try {
  const workspaceRoot = path.join(tempDir, 'workspace');
  const homeRoot = path.join(tempDir, 'home');
  process.env.HOME = homeRoot;
  process.env.USERPROFILE = homeRoot;

  const outfile = path.join(tempDir, 'canvas-execution-context.cjs');
  const exportedHelpers = [
    'CanvasPanelManager',
    'areCompletedTerminalHistoryArchiveDescriptorsEqual',
    'arePendingArchiveProjectionAttachRequestsEquivalent',
    'buildExecutionAttentionNotificationTitleForWorkspace',
    'captureTerminalStreamAttachPayloadIdentity',
    'coalesceExecutionStateSyncRequest',
    'createNextState',
    'downgradeLiveRuntimeNodesMissingRuntimeStoragePath',
    'hasInlineCompletedTerminalHistoryArchiveMigrationCandidate',
    'isSurfaceExecutionProjectionCompleteForArchive',
    'normalizeState',
    'reconcileDefaultExecutionMetadataCwd',
    'reconcileRuntimeNodes',
    'matchesTerminalStreamAttachPayloadIdentity',
    'retireDisconnectedRuntimeSupervisorProjectionClient',
    'resolveTerminalShellPathForConfigurationCwd'
  ];

  await esbuild.build({
    stdin: {
      contents: `export { ${exportedHelpers.join(', ')} } from './extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager';`,
      resolveDir: process.cwd(),
      sourcefile: 'canvas-execution-context-entry.ts'
    },
    bundle: true,
    format: 'cjs',
    outfile,
    platform: 'node',
    target: 'node18',
    external: ['node-pty'],
    plugins: [
      {
        name: 'mock-vscode',
        setup(build) {
          build.onResolve({ filter: /^vscode$/ }, () => ({ path: 'vscode', namespace: 'mock-vscode' }));
          build.onLoad({ filter: /.*/, namespace: 'mock-vscode' }, () => ({
            loader: 'js',
            contents: `
              class Disposable { dispose() {} }
              class EventEmitter { constructor() { this.event = () => new Disposable(); } fire() {} dispose() {} }
              class ThemeIcon { constructor(id) { this.id = id; } }
              class TreeItem { constructor(label, collapsibleState) { this.label = label; this.collapsibleState = collapsibleState; } }
              const workspaceRoot = ${JSON.stringify(workspaceRoot)};
              const terminalShellPath = './tooling/dev-shell';
              const Uri = {
                file: (fsPath) => ({ fsPath, path: fsPath, scheme: 'file', with(change) { return { ...this, ...change }; } }),
                joinPath: (base, ...segments) => ({ fsPath: [base?.fsPath, ...segments].filter(Boolean).join('/'), path: [base?.path, ...segments].filter(Boolean).join('/'), scheme: base?.scheme ?? 'file' }),
                parse: (value) => ({ fsPath: value, path: value, scheme: String(value).split(':', 1)[0], with(change) { return { ...this, ...change }; } })
              };
              const workspaceFolders = [{ name: 'workspace', uri: Uri.file(workspaceRoot) }];
              function inspectConfiguration(key) {
                if (key === 'devSessionCanvas.terminal.shellPath') {
                  return { defaultValue: '', workspaceValue: terminalShellPath };
                }
                if (key === 'devSessionCanvas.terminal.shell') {
                  return { defaultValue: 'default' };
                }
                return undefined;
              }
              module.exports = {
                Disposable,
                EventEmitter,
                ThemeIcon,
                TreeItem,
                TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
                Uri,
                l10n: {
                  t: (message, args) => {
                    if (!args || typeof args !== 'object') {
                      return message;
                    }
                    return String(message).replace(/\{([A-Za-z0-9_]+)\}/g, (_, key) =>
                      Object.prototype.hasOwnProperty.call(args, key) ? String(args[key]) : '{' + key + '}'
                    );
                  }
                },
                ViewColumn: { One: 1, Beside: -2 },
                commands: { executeCommand: async () => undefined, registerCommand: () => new Disposable() },
                env: { appName: 'VS Code Test', remoteName: undefined, shell: '/bin/bash' },
                window: {
                  showInformationMessage: async () => undefined,
                  showWarningMessage: async () => undefined,
                  showErrorMessage: async () => undefined,
                  registerTreeDataProvider: () => new Disposable(),
                  registerWebviewViewProvider: () => new Disposable(),
                  createOutputChannel: () => ({ appendLine() {}, dispose() {} })
                },
                workspace: {
                  isTrusted: true,
                  workspaceFolders,
                  workspaceFile: undefined,
                  name: 'workspace',
                  getWorkspaceFolder: (uri) => workspaceFolders.find((folder) => String(uri?.fsPath ?? '').startsWith(folder.uri.fsPath)),
                  getConfiguration: () => ({ get: () => undefined, inspect: inspectConfiguration, update: async () => undefined }),
                  onDidChangeConfiguration: () => new Disposable(),
                  onDidChangeWorkspaceFolders: () => new Disposable(),
                  onDidGrantWorkspaceTrust: () => new Disposable(),
                  onDidSaveTextDocument: () => new Disposable(),
                  fs: { writeFile: async () => undefined, readFile: async () => new Uint8Array(), createDirectory: async () => undefined, stat: async () => ({ type: 1 }) }
                }
              };
            `
          }));
        }
      },
      {
        name: 'export-execution-context-helpers',
        setup(build) {
          build.onLoad({ filter: /src\/panel\/CanvasPanelManager\.ts$/ }, async (args) => {
            let contents = await readFile(args.path, 'utf8');
            for (const helper of exportedHelpers) {
              contents = contents.replace(`function ${helper}(`, `export function ${helper}(`);
            }
            return { contents, loader: 'ts' };
          });
        }
      }
    ]
  });

  const require = createRequire(import.meta.url);
  const {
    CanvasPanelManager,
    areCompletedTerminalHistoryArchiveDescriptorsEqual,
    arePendingArchiveProjectionAttachRequestsEquivalent,
    buildExecutionAttentionNotificationTitleForWorkspace,
    captureTerminalStreamAttachPayloadIdentity,
    coalesceExecutionStateSyncRequest,
    createNextState,
    downgradeLiveRuntimeNodesMissingRuntimeStoragePath,
    hasInlineCompletedTerminalHistoryArchiveMigrationCandidate,
    isSurfaceExecutionProjectionCompleteForArchive,
    normalizeState,
    reconcileDefaultExecutionMetadataCwd,
    reconcileRuntimeNodes,
    matchesTerminalStreamAttachPayloadIdentity,
    retireDisconnectedRuntimeSupervisorProjectionClient,
    resolveTerminalShellPathForConfigurationCwd
  } = require(outfile);

  const emptyState = {
    version: 1,
    updatedAt: '2026-05-31T00:00:00.000Z',
    nodes: [],
    edges: [],
    groups: [],
    fileReferences: [],
    suppressedFileActivityEdgeIds: [],
    suppressedAutomaticFileArtifactNodeIds: [],
    nextGroupSequence: 1
  };

  assert.deepEqual(
    coalesceExecutionStateSyncRequest(undefined, false, 1_500, false),
    { dueAtMs: 1_500, postState: false, resetTimer: true },
    'the first execution state sync request must arm its bounded timer.'
  );
  assert.deepEqual(
    coalesceExecutionStateSyncRequest(1_500, false, 1_700, true),
    { dueAtMs: 1_500, postState: true, resetTimer: false },
    'a later lifecycle sync must upgrade an existing output timer without extending its deadline.'
  );
  assert.deepEqual(
    coalesceExecutionStateSyncRequest(1_500, true, 1_200, false),
    { dueAtMs: 1_200, postState: true, resetTimer: true },
    'an earlier sync may shorten the deadline but must retain the pending full-state post.'
  );

  const stateSyncManager = Object.create(CanvasPanelManager.prototype);
  const stateSyncSession = {};
  const siblingStateSyncSession = {};
  stateSyncManager.agentSessions = new Map([
    ['state-sync-agent', stateSyncSession],
    ['state-sync-agent-2', siblingStateSyncSession]
  ]);
  stateSyncManager.terminalSessions = new Map();
  stateSyncManager.pendingExecutionStateSyncs = new Map();
  stateSyncManager.executionStateSyncTimer = undefined;
  stateSyncManager.executionStateSyncDueAtMs = undefined;
  const stateSyncFlushes = [];
  stateSyncManager.flushLiveExecutionStateBatch = (entries, options) => {
    stateSyncFlushes.push({
      entries: entries.map(({ kind, nodeId, session }) => ({ kind, nodeId, session })),
      options
    });
    return true;
  };
  stateSyncManager.runtimeRestoreBatchDepth = 0;
  const scheduledStateSyncTimers = [];
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const originalDateNow = Date.now;
  globalThis.setTimeout = (callback, delay) => {
    const timer = { callback, delay, cleared: false };
    scheduledStateSyncTimers.push(timer);
    return timer;
  };
  globalThis.clearTimeout = (timer) => {
    timer.cleared = true;
  };
  Date.now = () => 1_000;
  try {
    stateSyncManager.queueExecutionStateSync('agent', 'state-sync-agent', 500, { postState: false });
    stateSyncManager.queueExecutionStateSync('agent', 'state-sync-agent', 700, { postState: true });
    stateSyncManager.queueExecutionStateSync('agent', 'state-sync-agent-2', 600, { postState: true });
    assert.equal(
      scheduledStateSyncTimers.filter((timer) => !timer.cleared).length,
      1,
      'all node output/lifecycle sync requests must share one manager timer.'
    );
    const coalescedStateSyncTimer = scheduledStateSyncTimers.find((timer) => !timer.cleared);
    coalescedStateSyncTimer.cleared = true;
    coalescedStateSyncTimer.callback();
    assert.deepEqual(
      stateSyncFlushes,
      [{
        entries: [
          { kind: 'agent', nodeId: 'state-sync-agent', session: stateSyncSession },
          { kind: 'agent', nodeId: 'state-sync-agent-2', session: siblingStateSyncSession }
        ],
        options: { postState: true, persist: true }
      }],
      'the manager timer must flush multiple nodes in one Canvas persist/post batch.'
    );
    assert.equal(stateSyncManager.pendingExecutionStateSyncs.size, 0);
    assert.equal(stateSyncManager.executionStateSyncTimer, undefined);
    assert.equal(stateSyncManager.executionStateSyncDueAtMs, undefined);

    stateSyncManager.queueExecutionStateSync('agent', 'state-sync-agent', 500, { postState: true });
    const staleLiveTimer = scheduledStateSyncTimers.find((timer) => !timer.cleared);
    stateSyncManager.flushExecutionStateSyncTimer('agent', 'state-sync-agent');
    assert.equal(staleLiveTimer.cleared, true);
    assert.equal(stateSyncManager.pendingExecutionStateSyncs.size, 0);
    staleLiveTimer.callback();
    assert.equal(
      stateSyncFlushes.length,
      1,
      'a final lifecycle boundary must cancel a queued live-state post instead of replaying stale state.'
    );
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
    Date.now = originalDateNow;
  }

  const handoffManager = Object.create(CanvasPanelManager.prototype);
  const handoffJob = {
    sourceKey: 'panel:terminal:handoff-terminal',
    controllerGeneration: 'handoff-generation'
  };
  const handoffSession = {
    runtimeSessionId: 'handoff-session',
    terminalAuthorityId: 'handoff-authority',
    supervisorKnownTerminalRevision: 0,
    observedTerminalRevision: 0,
    controlTailRevision: 0,
    outputSequence: 0
  };
  const handoffRecord = {
    attemptId: 'handoff-generation',
    source: 'supervisor',
    session: handoffSession,
    phase: 'restoring',
    supervisorProjectionId: 'handoff-projection',
    initialTargetRevision: 0,
    latestTargetRevision: 0,
    deliveredRevision: 0,
    projectionAppliedRevision: 0,
    appliedRevision: 0
  };
  handoffManager.surfaceExecutionProjections = new Map([
    [handoffJob.sourceKey, handoffRecord]
  ]);
  handoffManager.executionProjectionCoordinator = {
    getJobsForSession: () => [handoffJob]
  };
  handoffManager.isCurrentProjectionJob = () => true;
  handoffManager.applyRuntimeSupervisorOutputChunk = () => undefined;
  handoffManager.flushExecutionOutputImmediately = () => undefined;
  handoffManager.queueExecutionStateSync = () => undefined;
  const handoffFailures = [];
  handoffManager.handleProjectionCoordinatorFailure = (_job, error) => {
    handoffFailures.push(error.message);
  };
  handoffManager.recordDiagnosticEvent = () => undefined;
  const handoffSurfaceOrder = [];
  handoffManager.postProjectionState = (_record, state) => {
    handoffSurfaceOrder.push(`state:${state}`);
  };
  handoffManager.postProjectionLiveEvent = (_record, payload) => {
    handoffSurfaceOrder.push(`event:${payload.event.revision}`);
  };
  for (let revision = 1; revision <= 600; revision += 1) {
    handoffManager.handleBulkRuntimeSupervisorTerminalEvent(
      { nodeId: 'handoff-terminal', kind: 'terminal' },
      {
        supervisorInstanceId: 'handoff-supervisor',
        sessionId: 'handoff-session',
        kind: 'terminal',
        authorityId: 'handoff-authority',
        event: {
          type: 'output',
          revision,
          createdAtMs: revision,
          data: `shared-${revision}`
        }
      },
      handoffSession
    );
  }
  assert.deepEqual(
    handoffFailures,
    [],
    'more than the former 512-event cap must not fail a restoring surface before follow target growth.'
  );
  assert.deepEqual(
    handoffSurfaceOrder,
    [],
    'shared-socket observations must not bypass the credit-driven projection while restoring.'
  );
  assert.equal(
    Object.hasOwn(handoffRecord, 'pendingLiveEvents'),
    false,
    'restoring surfaces must not retain an unbounded duplicate payload queue.'
  );
  handoffManager.handleProjectionCoordinatorTargetAdvanced(handoffJob, 600);
  handoffManager.handleProjectionCoordinatorReady(handoffJob, 600, true);
  handoffManager.handleBulkRuntimeSupervisorTerminalEvent(
    { nodeId: 'handoff-terminal', kind: 'terminal' },
    {
      supervisorInstanceId: 'handoff-supervisor',
      sessionId: 'handoff-session',
      kind: 'terminal',
      authorityId: 'handoff-authority',
      event: {
        type: 'output',
        revision: 601,
        createdAtMs: 601,
        data: 'post-handoff'
      }
    },
    handoffSession
  );
  assert.deepEqual(
    handoffSurfaceOrder,
    ['state:ready', 'event:601'],
    'the ready barrier must precede the first contiguous post-handoff live event.'
  );

  const resumableHistoryState = reconcileRuntimeNodes({
    ...emptyState,
    nodes: [{
      id: 'resume-ready-agent',
      kind: 'agent',
      title: 'Resume-ready Agent',
      status: 'history-restored',
      summary: 'The original live runtime ended.',
      position: { x: 0, y: 0 },
      metadata: {
        agent: {
          lifecycle: 'resume-ready',
          persistenceMode: 'live-runtime',
          attachmentState: 'history-restored',
          liveSession: false,
          resumeSupported: true,
          resumeStrategy: 'codex-session-id',
          resumeSessionId: 'trusted-provider-session',
          pendingLaunch: undefined
        }
      }
    }]
  });
  assert.equal(
    resumableHistoryState.nodes[0]?.status,
    'resume-ready',
    'reload reconciliation must preserve explicit Resume availability without requiring an auto-launch marker.'
  );
  assert.equal(resumableHistoryState.nodes[0]?.metadata?.agent?.lifecycle, 'resume-ready');
  assert.equal(resumableHistoryState.nodes[0]?.metadata?.agent?.pendingLaunch, undefined);

  const nonResumableHistoryState = reconcileRuntimeNodes({
    ...emptyState,
    nodes: [{
      ...resumableHistoryState.nodes[0],
      id: 'history-only-agent',
      metadata: {
        agent: {
          ...resumableHistoryState.nodes[0].metadata.agent,
          resumeSessionId: undefined
        }
      }
    }]
  });
  assert.equal(
    nonResumableHistoryState.nodes[0]?.status,
    'history-restored',
    'history-only Agents without a trusted provider identity must not advertise Resume.'
  );

  const unavailableTerminalState = reconcileRuntimeNodes({
    ...emptyState,
    nodes: [{
      id: 'unavailable-terminal',
      kind: 'terminal',
      title: 'Unavailable Terminal',
      status: 'history-restored',
      summary: 'The original Terminal runtime ended.',
      position: { x: 0, y: 0 },
      metadata: {
        terminal: {
          lifecycle: 'closed',
          persistenceMode: 'snapshot-only',
          attachmentState: 'history-restored',
          liveSession: false,
          pendingLaunch: undefined
        }
      }
    }]
  });
  assert.equal(
    unavailableTerminalState.nodes[0]?.status,
    'history-restored',
    'reload reconciliation must preserve the explicit history display status for an unavailable Terminal.'
  );
  assert.equal(unavailableTerminalState.nodes[0]?.metadata?.terminal?.lifecycle, 'closed');

  const completedTerminalState = reconcileRuntimeNodes({
    ...emptyState,
    nodes: [{
      ...unavailableTerminalState.nodes[0],
      id: 'completed-terminal',
      status: 'closed'
    }]
  });
  assert.equal(
    completedTerminalState.nodes[0]?.status,
    'closed',
    'a normally completed Terminal must keep its lifecycle display status after reload.'
  );

  const terminalStreamIdentityPayload = {
    revision: 1,
    checkpoint: { serializedState: { data: 'checkpoint' } },
    events: [{ revision: 1, data: 'output' }]
  };
  const terminalStreamIdentity = captureTerminalStreamAttachPayloadIdentity(
    terminalStreamIdentityPayload
  );
  assert.equal(
    matchesTerminalStreamAttachPayloadIdentity(
      terminalStreamIdentityPayload,
      terminalStreamIdentity
    ),
    true
  );
  terminalStreamIdentityPayload.events.push({ revision: 2, data: 'later output' });
  assert.equal(
    matchesTerminalStreamAttachPayloadIdentity(
      terminalStreamIdentityPayload,
      terminalStreamIdentity
    ),
    false,
    'an in-place event-array change must invalidate the migration identity fast path.'
  );

  const projectionControlClient = {};
  const disconnectedProjectionClient = {
    disposeCalls: 0,
    dispose() {
      this.disposeCalls += 1;
    }
  };
  const replacementProjectionClient = {
    disposeCalls: 0,
    dispose() {
      this.disposeCalls += 1;
    }
  };
  const projectionClients = new Map([
    [projectionControlClient, replacementProjectionClient]
  ]);
  assert.equal(
    retireDisconnectedRuntimeSupervisorProjectionClient(
      projectionClients,
      projectionControlClient,
      disconnectedProjectionClient
    ),
    false,
    'a late bulk disconnect must not evict a replacement projection client.'
  );
  assert.equal(projectionClients.get(projectionControlClient), replacementProjectionClient);
  assert.equal(disconnectedProjectionClient.disposeCalls, 1);
  assert.equal(replacementProjectionClient.disposeCalls, 0);
  projectionClients.set(projectionControlClient, disconnectedProjectionClient);
  assert.equal(
    retireDisconnectedRuntimeSupervisorProjectionClient(
      projectionClients,
      projectionControlClient,
      disconnectedProjectionClient
    ),
    true,
    'the exact disconnected projection client must be retired from the cache.'
  );
  assert.equal(projectionClients.has(projectionControlClient), false);
  assert.equal(disconnectedProjectionClient.disposeCalls, 2);

  assert.equal(
    hasInlineCompletedTerminalHistoryArchiveMigrationCandidate({
      ...emptyState,
      nodes: [{
        id: 'completed-agent-with-inline-history',
        kind: 'agent',
        title: 'Completed agent',
        status: 'completed',
        summary: 'Completed',
        position: { x: 0, y: 0 },
        metadata: {
          agent: {
            persistenceMode: 'history-only',
            liveSession: false,
            terminalStream: { events: new Array(90_000).fill(null) }
          }
        }
      }]
    }),
    true,
    'legacy inline history detection must be a cheap structural check so constructor persist can be gated before normalization/stringify.'
  );
  assert.equal(
    hasInlineCompletedTerminalHistoryArchiveMigrationCandidate({
      ...emptyState,
      nodes: [{
        id: 'archived-agent',
        kind: 'agent',
        title: 'Archived agent',
        status: 'completed',
        summary: 'Completed',
        position: { x: 0, y: 0 },
        metadata: {
          agent: {
            persistenceMode: 'history-only',
            liveSession: false,
            terminalHistoryArchive: { archiveId: 'sha256:test' }
          }
        }
      }]
    }),
    false,
    'archive-only completed nodes must not delay ordinary canvas persistence.'
  );

  const lifecycle = {
    surface: 'panel',
    mode: 'active',
    generation: 3,
    frameId: 'frame-current'
  };
  const webview = {};
  const archiveProjectionRequest = {
    sourceKey: 'panel:agent:completed-agent',
    materializationKey: 'archive:sha256-current',
    surface: 'panel',
    lifecycle,
    webview,
    kind: 'agent',
    nodeId: 'completed-agent',
    controllerGeneration: 'controller-current',
    priority: 'background',
    source: { kind: 'archive', archiveId: 'sha256-current' }
  };
  assert.equal(
    arePendingArchiveProjectionAttachRequestsEquivalent(
      archiveProjectionRequest,
      { ...archiveProjectionRequest, priority: 'selected' }
    ),
    true,
    'a duplicate attach for the same surface/controller/materialization must reuse its pending callback.'
  );
  assert.equal(
    arePendingArchiveProjectionAttachRequestsEquivalent(
      archiveProjectionRequest,
      { ...archiveProjectionRequest, controllerGeneration: 'controller-reloaded' }
    ),
    false,
    'a reloaded controller generation must replace the pending archive attach request.'
  );
  assert.equal(
    arePendingArchiveProjectionAttachRequestsEquivalent(
      archiveProjectionRequest,
      { ...archiveProjectionRequest, lifecycle: { ...lifecycle, frameId: 'frame-reloaded' } }
    ),
    false,
    'a new Webview frame must not consume the previous frame materialization callback.'
  );
  assert.equal(
    arePendingArchiveProjectionAttachRequestsEquivalent(
      archiveProjectionRequest,
      { ...archiveProjectionRequest, webview: {} }
    ),
    false,
    'a replacement Webview object must not consume the previous Webview materialization callback.'
  );

  const canonicalArchiveDescriptor = {
    version: 1,
    archiveId: 'sha256-current',
    codec: 'terminal-stream-attach-json-v1',
    sessionId: 'session-current',
    authorityId: 'authority-current',
    finalRevision: 5,
    byteLength: 100,
    sha256: 'a'.repeat(64)
  };
  const boundedArchiveDescriptor = {
    ...canonicalArchiveDescriptor,
    projectionCodec: 'terminal-stream-projection-ndjson-v1',
    projectionByteLength: 200,
    projectionSha256: 'b'.repeat(64)
  };
  assert.equal(
    areCompletedTerminalHistoryArchiveDescriptorsEqual(
      canonicalArchiveDescriptor,
      boundedArchiveDescriptor
    ),
    false,
    'adding a bounded sidecar must update metadata even when the canonical archive id is unchanged.'
  );
  assert.equal(
    areCompletedTerminalHistoryArchiveDescriptorsEqual(
      structuredClone(boundedArchiveDescriptor),
      boundedArchiveDescriptor
    ),
    true
  );
  assert.equal(
    isSurfaceExecutionProjectionCompleteForArchive(
      { phase: 'ready', appliedRevision: 5, projectionAppliedRevision: 3 },
      5
    ),
    true,
    'a surface that applied the final live revision must not replay the completed archive.'
  );
  assert.equal(
    isSurfaceExecutionProjectionCompleteForArchive(
      { phase: 'restoring', appliedRevision: 5, projectionAppliedRevision: 5 },
      5
    ),
    false,
    'an in-flight surface must switch to the archive even if its aggregate revision was advanced by live events.'
  );
  assert.equal(
    isSurfaceExecutionProjectionCompleteForArchive(
      { phase: 'ready', appliedRevision: 4, projectionAppliedRevision: 4 },
      5
    ),
    false,
    'a ready projection below the final revision must switch to the completed archive.'
  );

  const createdAgentState = createNextState(emptyState, 'agent');
  assert.equal(
    createdAgentState.nodes[0].metadata.agent.cwd,
    workspaceRoot,
    '默认 Agent metadata cwd 应使用当前 workspace root，而不是 HOME。'
  );

  const createdTerminalState = createNextState(emptyState, 'terminal');
  assert.equal(
    createdTerminalState.nodes[0].metadata.terminal.cwd,
    workspaceRoot,
    '默认 Terminal metadata cwd 应使用当前 workspace root，而不是 HOME。'
  );
  assert.equal(
    createdTerminalState.nodes[0].metadata.terminal.shellPath,
    path.join(workspaceRoot, 'tooling', 'dev-shell'),
    'workspace-relative terminal.shellPath 应先按 workspace/configuration cwd 解析，再写入 Terminal metadata。'
  );

  assert.equal(
    resolveTerminalShellPathForConfigurationCwd('./tooling/dev-shell', workspaceRoot),
    path.join(workspaceRoot, 'tooling', 'dev-shell')
  );
  assert.equal(resolveTerminalShellPathForConfigurationCwd('bash', workspaceRoot), 'bash');
  assert.equal(resolveTerminalShellPathForConfigurationCwd('/bin/bash', workspaceRoot), '/bin/bash');

  assert.equal(
    buildExecutionAttentionNotificationTitleForWorkspace('agent', {
      workspaceName: 'workspace',
      workspaceFolders: [{ name: 'workspace', path: workspaceRoot }],
      cwd: path.join(workspaceRoot, 'src')
    }),
    'DSCanvas · workspace · Agent',
    '单根 workspace 的系统通知标题应保持 workspace 和节点类型。'
  );
  assert.equal(
    buildExecutionAttentionNotificationTitleForWorkspace('agent', {
      workspaceName: 'workspace',
      workspaceFolders: [
        { name: 'web', path: workspaceRoot },
        { name: 'api', path: path.join(tempDir, 'api') }
      ],
      cwd: path.join(tempDir, 'api', 'src')
    }),
    'DSCanvas · workspace · api · Agent',
    '多根 workspace 的系统通知标题应在 workspace 和节点类型之间加入 root。'
  );
  assert.equal(
    buildExecutionAttentionNotificationTitleForWorkspace('terminal', {
      workspaceName: '',
      workspaceFolders: [
        { name: 'web', path: workspaceRoot },
        { name: 'api', path: path.join(tempDir, 'api') }
      ],
      cwd: path.join(workspaceRoot, 'tools')
    }),
    'DSCanvas · web · web · Terminal',
    '没有 workspace name 时仍应使用首个 root 作为 workspace 标签，并在多根下补当前 root。'
  );

  const normalizedLegacyState = normalizeState(
    {
      ...emptyState,
      nodes: [
        {
          id: 'agent-legacy',
          kind: 'agent',
          title: 'Agent Legacy',
          status: 'idle',
          summary: '',
          position: { x: 0, y: 0 },
          metadata: { agent: { provider: 'codex', cwd: homeRoot } }
        },
        {
          id: 'terminal-legacy',
          kind: 'terminal',
          title: 'Terminal Legacy',
          status: 'idle',
          summary: '',
          position: { x: 320, y: 0 },
          metadata: { terminal: { cwd: homeRoot, shellPath: './tooling/dev-shell' } }
        }
      ]
    },
    'codex'
  );
  assert.equal(normalizedLegacyState.nodes[0].metadata.agent.cwd, workspaceRoot);
  assert.equal(normalizedLegacyState.nodes[1].metadata.terminal.cwd, workspaceRoot);

  const archiveSha256 = 'a'.repeat(64);
  const normalizedArchivedHistoryState = normalizeState(
    {
      ...emptyState,
      nodes: [
        {
          id: 'terminal-archived-history',
          kind: 'terminal',
          title: 'Archived Terminal',
          status: 'closed',
          summary: '',
          position: { x: 0, y: 0 },
          metadata: {
            terminal: {
              persistenceMode: 'snapshot-only',
              liveSession: false,
              outputSequence: 42,
              serializedTerminalState: { format: 'xterm-serialize-v1', data: 'legacy inline', outputSequence: 42 },
              terminalStream: {
                version: 1,
                sessionId: 'archived-session',
                authorityId: 'archived-authority',
                revision: 42,
                checkpoint: {
                  version: 1,
                  sessionId: 'archived-session',
                  authorityId: 'archived-authority',
                  revision: 42,
                  cols: 80,
                  rows: 24,
                  scrollback: 1000,
                  createdAtMs: 100,
                  serializedState: {
                    format: 'xterm-serialize-v1',
                    data: 'inline checkpoint',
                    outputSequence: 42
                  }
                },
                events: []
              },
              terminalHistoryArchive: {
                version: 1,
                archiveId: `sha256-${archiveSha256}`,
                codec: 'terminal-stream-attach-json-v1',
                sessionId: 'archived-session',
                authorityId: 'archived-authority',
                finalRevision: 42,
                byteLength: 4096,
                sha256: archiveSha256
              }
            }
          }
        }
      ]
    },
    'codex'
  );
  const archivedHistoryMetadata = normalizedArchivedHistoryState.nodes[0].metadata.terminal;
  assert.equal(archivedHistoryMetadata.terminalHistoryArchive?.sessionId, 'archived-session');
  // A descriptor may have been persisted before the inline copy was removed.
  // Normalization must retain that fallback until the archive blob is verified
  // and the second durable Canvas write succeeds.
  assert.equal(archivedHistoryMetadata.serializedTerminalState?.data, 'legacy inline');
  assert.equal(archivedHistoryMetadata.terminalStream?.checkpoint.serializedState.data, 'inline checkpoint');

  const reconciledState = reconcileDefaultExecutionMetadataCwd({
    ...emptyState,
    nodes: [
      createdAgentState.nodes[0],
      {
        ...createdTerminalState.nodes[0],
        metadata: {
          terminal: {
            ...createdTerminalState.nodes[0].metadata.terminal,
            cwd: homeRoot,
            shellPath: './tooling/dev-shell'
          }
        }
      }
    ]
  });
  assert.notEqual(reconciledState, emptyState);
  assert.equal(reconciledState.nodes[0].metadata.agent.cwd, workspaceRoot);
  assert.equal(reconciledState.nodes[1].metadata.terminal.cwd, workspaceRoot);
  assert.equal(reconciledState.nodes[1].metadata.terminal.shellPath, path.join(workspaceRoot, 'tooling', 'dev-shell'));

  const missingRuntimeStoragePathReason = 'missing runtime storage path';
  const downgradedRuntimeState = downgradeLiveRuntimeNodesMissingRuntimeStoragePath(
    {
      ...emptyState,
      nodes: [
        {
          id: 'agent-live-missing-storage',
          kind: 'agent',
          title: 'Agent Live Missing Storage',
          status: 'running',
          summary: '',
          position: { x: 0, y: 0 },
          size: { width: 160, height: 120 },
          metadata: {
            agent: {
              provider: 'codex',
              lifecycle: 'running',
              persistenceMode: 'live-runtime',
              supervisorInstanceId: 'supervisor-agent-missing-storage',
              runtimeSessionId: 'agent-runtime-missing-storage',
              attachmentState: 'reattaching',
              liveSession: false
            }
          }
        },
        {
          id: 'agent-live-with-storage',
          kind: 'agent',
          title: 'Agent Live With Storage',
          status: 'running',
          summary: '',
          position: { x: 240, y: 0 },
          size: { width: 160, height: 120 },
          metadata: {
            agent: {
              provider: 'codex',
              lifecycle: 'running',
              persistenceMode: 'live-runtime',
              runtimeBackend: 'legacy-detached',
              runtimeStoragePath: path.join(workspaceRoot, '.runtime-storage'),
              supervisorInstanceId: 'supervisor-agent-with-storage',
              runtimeSessionId: 'agent-runtime-with-storage',
              attachmentState: 'reattaching',
              liveSession: false
            }
          }
        },
        {
          id: 'terminal-live-missing-storage',
          kind: 'terminal',
          title: 'Terminal Live Missing Storage',
          status: 'live',
          summary: '',
          position: { x: 480, y: 0 },
          size: { width: 160, height: 120 },
          metadata: {
            terminal: {
              lifecycle: 'live',
              persistenceMode: 'live-runtime',
              supervisorInstanceId: 'supervisor-terminal-missing-storage',
              runtimeSessionId: 'terminal-runtime-missing-storage',
              attachmentState: 'reattaching',
              liveSession: false
            }
          }
        }
      ]
    },
    missingRuntimeStoragePathReason
  );
  assert.equal(downgradedRuntimeState.downgradedCount, 2);
  assert.equal(
    downgradedRuntimeState.state.nodes.find((candidate) => candidate.id === 'agent-live-missing-storage').metadata.agent.attachmentState,
    'history-restored',
    'multi-root 恢复不能把缺少 runtimeStoragePath 的 Agent 隐式连到当前 workspace storage。'
  );
  assert.equal(
    downgradedRuntimeState.state.nodes.find((candidate) => candidate.id === 'agent-live-missing-storage').metadata.agent.liveSession,
    false
  );
  assert.equal(
    downgradedRuntimeState.state.nodes.find((candidate) => candidate.id === 'agent-live-missing-storage').metadata.agent.runtimeSessionId,
    undefined,
    '缺少 runtimeStoragePath 的 Agent 降级后不应继续参与 runtime cleanup 或后续 attach。'
  );
  assert.equal(
    downgradedRuntimeState.state.nodes.find((candidate) => candidate.id === 'agent-live-missing-storage').metadata.agent.supervisorInstanceId,
    undefined,
    'Agent runtime session 降级时必须同步清除 Supervisor instance identity。'
  );
  assert.equal(
    downgradedRuntimeState.state.nodes.find((candidate) => candidate.id === 'agent-live-missing-storage').metadata.agent.lastRuntimeError,
    missingRuntimeStoragePathReason
  );
  assert.equal(
    downgradedRuntimeState.state.nodes.find((candidate) => candidate.id === 'agent-live-with-storage').metadata.agent.attachmentState,
    'reattaching',
    '带有 root-local runtimeStoragePath 的 Agent 应继续保留 multi-root reattach 资格。'
  );
  assert.equal(
    downgradedRuntimeState.state.nodes.find((candidate) => candidate.id === 'agent-live-with-storage').metadata.agent.supervisorInstanceId,
    'supervisor-agent-with-storage',
    '仍可 reattach 的 Agent 必须保留 Supervisor instance identity。'
  );
  assert.equal(
    downgradedRuntimeState.state.nodes.find((candidate) => candidate.id === 'terminal-live-missing-storage').metadata.terminal.attachmentState,
    'history-restored',
    'multi-root 恢复不能把缺少 runtimeStoragePath 的 Terminal 隐式连到当前 workspace storage。'
  );
  assert.equal(
    downgradedRuntimeState.state.nodes.find((candidate) => candidate.id === 'terminal-live-missing-storage').metadata.terminal.runtimeSessionId,
    undefined,
    '缺少 runtimeStoragePath 的 Terminal 降级后不应继续参与 runtime cleanup 或后续 attach。'
  );
  assert.equal(
    downgradedRuntimeState.state.nodes.find((candidate) => candidate.id === 'terminal-live-missing-storage').metadata.terminal.supervisorInstanceId,
    undefined,
    'Terminal runtime session 降级时必须同步清除 Supervisor instance identity。'
  );

  const managerSource = await readFile('extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts', 'utf8');
  const controlClientFactory = managerSource.match(
    /private async getRuntimeSupervisorClientForBackend\([\s\S]*?\n  private async getRuntimeSupervisorClientForKind/u
  )?.[0] ?? '';
  assert.match(
    controlClientFactory,
    /onSessionState: \(snapshot\) => \{[\s\S]*handleRuntimeSupervisorState/u,
    'the control socket must remain the sole compact lifecycle authority.'
  );
  const projectionClientFactory = managerSource.match(
    /private async getRuntimeSupervisorProjectionClient\([\s\S]*?\n  private handleRuntimeSupervisorProjectionDisconnected/u
  )?.[0] ?? '';
  assert.doesNotMatch(
    projectionClientFactory,
    /onSessionState|handleRuntimeSupervisorState/u,
    'the bulk projection socket must not apply the same compact lifecycle a second time.'
  );
  const supervisorStateHandler = managerSource.match(
    /private async handleRuntimeSupervisorState\([\s\S]*?\n  private async finalizeBulkRuntimeSupervisorSession/u
  )?.[0] ?? '';
  assert.match(
    supervisorStateHandler,
    /!snapshot\.live[\s\S]*flushExecutionStateSyncTimer[\s\S]*deferLiveStateSync: true/u,
    'control lifecycle updates must defer live persist/render work while final states cancel stale live work.'
  );
  const completedBulkFinalization = managerSource.match(
    /private async finalizeBulkRuntimeSupervisorSession\([\s\S]*?\n  private async notifyRuntimeSupervisorSessionEnded/u
  )?.[0] ?? '';
  assert.match(
    completedBulkFinalization,
    /archiveCompletedRuntimeSupervisorProjection\([\s\S]*completedTerminalHistoryArchive: terminalHistoryArchive/u,
    'bulk death finalization must persist only the streamed archive descriptor into Canvas state.'
  );
  const completedProjectionArchive = managerSource.match(
    /private async archiveCompletedRuntimeSupervisorProjection\([\s\S]*?\n  private handleRuntimeSupervisorDisconnected/u
  )?.[0] ?? '';
  assert.match(
    completedProjectionArchive,
    /writeProjectionStream\([\s\S]*open: async \(\)[\s\S]*read: async function\* \(opened\)[\s\S]*yield \{[\s\S]*creditBytes:[\s\S]*result/u,
    'completed projections must wait for archive admission before open and stream one credit-bounded result at a time.'
  );
  assert.match(
    completedProjectionArchive,
    /CompletedTerminalHistoryArchiveError\([\s\S]*'invalid-payload'[\s\S]*projection identity does not match/u,
    'a mismatched fixed projection must retain invalid-payload attribution instead of being reported as archive I/O.'
  );
  assert.doesNotMatch(
    completedProjectionArchive,
    /createTerminalProjectionAssembler|assembler\.finish\(\)|TerminalStreamAttachPayload/u,
    'completed projection finalization must not assemble an unbounded in-memory terminal payload.'
  );
  const liveSnapshotHandler = managerSource.match(
    /private async applyRuntimeSupervisorSnapshot\([\s\S]*?\n  private async applyCompletedRuntimeSupervisorSnapshot/u
  )?.[0] ?? '';
  assert.match(
    liveSnapshotHandler,
    /runtimeRestoreBatchDepth > 0[\s\S]*options\.deferLiveStateSync[\s\S]*queueExecutionStateSync\([\s\S]*EXECUTION_INTERACTION_STATE_SYNC_INTERVAL_MS[\s\S]*postState: true[\s\S]*runtime-supervisor-live-snapshot/u,
    'healthy control lifecycle updates must use the bounded manager queue without weakening restore boundaries.'
  );
  const executionStateSyncQueue = managerSource.match(
    /private queueExecutionStateSync\([\s\S]*?\n  private flushExecutionStateSyncTimer/u
  )?.[0] ?? '';
  assert.match(
    executionStateSyncQueue,
    /pendingExecutionStateSyncs[\s\S]*coalesceExecutionStateSyncRequest\([\s\S]*scheduleExecutionStateSyncTimer[\s\S]*flushQueuedExecutionStateSyncs\([\s\S]*flushLiveExecutionStateBatch/u,
    'the manager queue must retain lifecycle posts while collapsing multiple node updates into one Canvas flush.'
  );
  assert.match(
    managerSource,
    /private flushLiveExecutionStateBatch\([\s\S]*const patches = new Map[\s\S]*this\.state\.nodes\.map[\s\S]*this\.persistState\([\s\S]*this\.postState\('host\/stateUpdated'\)/u,
    'one manager batch must perform one node-array update, one persist preparation, and at most one state post.'
  );
  const projectionDisconnectHandler = managerSource.match(
    /private handleRuntimeSupervisorProjectionDisconnected\([\s\S]*?\n  private handleProjectionCoordinatorState/u
  )?.[0] ?? '';
  assert.match(
    projectionDisconnectHandler,
    /retireDisconnectedRuntimeSupervisorProjectionClient\([\s\S]*?record\.projectionClient !== disconnectedProjectionClient[\s\S]*?record\.projectionClient = undefined;/u,
    'bulk disconnect cleanup must retire and fail only records owned by the exact disconnected client.'
  );
  const inlineHistoryMigration = managerSource.match(
    /private async migrateInlineCompletedTerminalHistories\(\)[\s\S]*?\n  private getExtensionStoragePath/u
  )?.[0] ?? '';
  assert.doesNotMatch(
    inlineHistoryMigration,
    /normalizeTerminalStreamAttachPayload\(/u,
    'legacy history migration must not synchronously walk every inline event array.'
  );
  assert.match(
    inlineHistoryMigration,
    /matchesTerminalStreamAttachPayloadIdentity\(/u,
    'unchanged inline history must reuse its validated descriptor instead of being re-materialized.'
  );
  const persistStateFunction = managerSource.match(
    /private persistState\([\s\S]*?\n  private reconcileCanvasFileArtifacts/u
  )?.[0] ?? '';
  assert.match(
    managerSource,
    /completedTerminalHistoryArchiveMigrationPending =\s*\n\s*hasInlineCompletedTerminalHistoryArchiveMigrationCandidate\(this\.state\);[\s\S]*?this\.persistState\(\{ reason: 'state-initialized' \}\);/u,
    'constructor must arm the legacy-history gate before its initial persist.'
  );
  assert.match(
    persistStateFunction,
    /completedTerminalHistoryArchiveMigrationPending[\s\S]*queueCompletedTerminalHistoryArchiveMigrationPersist\(options\)[\s\S]*const startedAt = Date\.now\(\);/u,
    'ordinary persist must return through the migration gate before clone/hash/stringify work starts.'
  );
  assert.match(
    managerSource,
    /private queuePersistedCanvasSnapshotWrite\([\s\S]*completedTerminalHistoryArchiveMigrationPending[\s\S]*queueCompletedTerminalHistoryArchiveMigrationPersist\([\s\S]*private scheduleDeferredCanvasStatePersist/u,
    'direct snapshot writes such as active-surface persistence must share the legacy-history gate.'
  );
  assert.match(
    managerSource,
    /completed-terminal-history-archive-reference-migration[\s\S]*bypassCompletedTerminalHistoryArchiveMigrationGate: true[\s\S]*completed-terminal-history-inline-payload-removed[\s\S]*bypassCompletedTerminalHistoryArchiveMigrationGate: true/u,
    'both COW migration durability barriers must explicitly bypass the ordinary persist gate.'
  );
  assert.match(
    managerSource,
    /migrateInlineCompletedTerminalHistories\(\)[\s\S]*flushQueuedCompletedTerminalHistoryArchiveMigrationPersist\('migration-settled'\)/u,
    'migration settlement must flush the latest coalesced canvas state.'
  );
  const managerSourceWithoutProviderNativeSessionBranching = managerSource
    .replace(
      /  public async forkAgentSessionFromHistory\([\s\S]*?\n  public getSessionHistoryRestoreBlockReason\(\)/u,
      '\n  public getSessionHistoryRestoreBlockReason()'
    )
    .replace(
      /The current workspace is not trusted\. You can browse session history, but cannot resume or fork sessions into new Agent nodes\./gu,
      'Session history restore is unavailable.'
    )
    .replace(/\nfunction createBranchAgentUserEdge\([\s\S]*?\n\}/u, '\n')
    .replace(/\nfunction isClaudeForkSessionLaunch\([\s\S]*?\n\}/u, '\n')
    .replace(/\nfunction formatForkTitle\([\s\S]*?\n\}/u, '\n')
    .replace(/\nfunction formatHistoryForkTitle\([\s\S]*?\n\}/u, '\n')
    .replace(/fork-layer/gu, 'branch-layer')
    .replace(/forkSourceNode/gu, 'branchSourceNode')
    .replace(/label: 'fork'/gu, "label: 'branch'")
    .replace(/Claude Agent nodes do not support Ctrl-Z\/fg\. Use stop, resume, or fork instead\./gu, 'Claude Agent Ctrl-Z unsupported');
  const runtimeBindingKeyFunction = managerSource.match(
    /private buildRuntimeSessionBindingKey\([\s\S]*?\n  \}/u
  )?.[0] ?? '';
  assert.ok(runtimeBindingKeyFunction, '必须能定位 runtime binding key 构造函数。');
  const workspaceFoldersListener = managerSource.match(
    /vscode\.workspace\.onDidChangeWorkspaceFolders\(\(\) => \{[\s\S]*?\n      \}\)\n    \);/u
  )?.[0] ?? '';
  assert.match(
    workspaceFoldersListener,
    /this\.postState\('host\/stateUpdated'\);/u,
    'workspace folder 变化必须无条件发布 host/stateUpdated，刷新 Webview runtime.workspaceFolders。'
  );
  assert.match(
    workspaceFoldersListener,
    /this\.notifySidebarStateChanged\(\);/u,
    'workspace folder 变化必须刷新侧栏上下文。'
  );
  assert.match(
    workspaceFoldersListener,
    /this\.state = this\.loadReconciledState\(\);/u,
    'workspace folder 变化必须重新加载 root-local / multi-root 组合状态。'
  );
  assert.match(
    workspaceFoldersListener,
    /this\.scheduleRestoreLiveRuntimeSessions\(\);/u,
    'workspace folder 变化后必须重新执行 live runtime restore 调度；multi-root 也会按 root-local runtime metadata 恢复。'
  );
  assert.doesNotMatch(
    managerSource,
    /'multi-root-workspace'/u,
    'multi-root live runtime restore 不应再被整体 block。'
  );
  assert.doesNotMatch(
    managerSource,
    /runtime\/restoreSkipped[\s\S]*multiRootWorkspace/u,
    'multi-root live runtime restore 不应再记录整体 skip 诊断。'
  );
  assert.match(
    runtimeBindingKeyFunction,
    /buildRuntimeSessionBindingKey\([\s\S]*kind:[\s\S]*runtimeSessionId:[\s\S]*runtimeStoragePath:[\s\S]*runtimeBackend:[\s\S]*supervisorInstanceId:/u,
    'runtime binding key 必须包含 execution kind、runtimeStoragePath、runtimeSessionId、backend 和 Supervisor instance，不能只按 root 或 display node 绑定。'
  );
  assert.match(
    runtimeBindingKeyFunction,
    /instanceId[\s\S]*supervisorInstanceId[\s\S]*return `\$\{backendKind\}::\$\{this\.resolveRuntimeStoragePath\(runtimeStoragePath\)\}::\$\{instanceId\}/u,
    'runtime binding key 的实际返回值必须纳入 Supervisor instance identity。'
  );
  assert.doesNotMatch(
    runtimeBindingKeyFunction,
    /workspaceRoot|rootPath/u,
    'runtime binding key 不能使用 workspace root 作为身份；同一个 root 的不同 VS Code storage slot 必须是不同 runtime。'
  );
  assert.match(
    managerSource,
    /collectRuntimeSupervisorStoragePathsForTest[\s\S]*this\.getExtensionStoragePath\(\)[\s\S]*this\.getPersistedRuntimeStoragePath\(metadata\)/u,
    'runtime supervisor diagnostics 必须枚举当前 slot 和 persisted runtimeStoragePath，覆盖同 root 多 slot 的 registry。'
  );
  assert.match(
    managerSource,
    /workspaceFolders\.length === 1[\s\S]*downgradeRootLocalLiveRuntimeNodesMissingRuntimeStoragePath/u,
    '单根 root-local snapshot 缺少 runtimeStoragePath 时也必须降级，不能用当前同 root 但不同 slot 的 storage path 回填。'
  );
  assert.match(
    managerSource,
    /downgradeRootLocalLiveRuntimeNodesMissingRuntimeStoragePath/u,
    '加载 root-local state 时必须显式处理缺失 runtimeStoragePath 的旧 live-runtime snapshot。'
  );
  assert.match(
    managerSource,
    /handleRuntimeSupervisorOutput\(backend\.kind, runtimeStoragePath, event\)/u,
    'supervisor output 绑定必须使用事件里的 execution kind，避免同 session id 不同 kind 串线。'
  );
  assert.match(
    managerSource,
    /snapshot\.kind !== kind[\s\S]*runtime\/sessionKindMismatch/u,
    'attach 原 live runtime 时必须校验 supervisor snapshot kind，避免错误 sessionId 绑定到不同 execution kind。'
  );
  assert.match(
    managerSource,
    /restoreLiveRuntimeSessions\([\s\S]*\{ allowRestart: false \}[\s\S]*persistedSupervisorInstanceId !== currentSupervisorInstanceId[\s\S]*runtime\/supervisorInstanceMismatch/u,
    '恢复旧 runtime 必须只连接现有 Supervisor，并在实例不匹配时不执行 attach。'
  );
  assert.match(
    managerSource,
    /runtime\/legacySupervisorInstanceProbe[\s\S]*attachPersistedRuntimeSession\([\s\S]*currentSupervisorInstanceId/u,
    '旧 metadata 缺少 instance identity 时必须只走一次兼容 attach，并把当前 identity 作为结果 guard。'
  );
  assert.doesNotMatch(
    managerSource,
    /shouldDeferSessionNotFoundWhileRecovering|sessionAttachDeferredForRecovery|handleRuntimeSupervisorRecoveryState/u,
    'Host 不应再等待 Supervisor namespace recovery 或在 ready 后二次 attach。'
  );
  assert.match(
    managerSource,
    /markExecutionNodeAsHistoryRestored[\s\S]*supervisorInstanceId: undefined[\s\S]*runtimeSessionId: undefined/u,
    'dead runtime 转历史态时必须同时清除 runtime session 与 Supervisor instance identity。'
  );
  assert.match(
    managerSource,
    /maybeFallbackAgentLiveRuntimeToResume[\s\S]*supervisorInstanceId: undefined[\s\S]*runtimeSessionId: undefined[\s\S]*pendingLaunch: undefined/u,
    'Agent dead runtime 转 resume-ready 时必须清除实例绑定且不能自动 Resume。'
  );
  assert.match(
    managerSource,
    /private finishRuntimeRestoreStateMutation\([\s\S]*runtimeRestoreBatchDepth > 0[\s\S]*runtimeRestoreBatchDirty = true[\s\S]*scheduleRuntimeRestoreBatchStatePost[\s\S]*persistRuntimeRestoreStateSafely\(reason\)/u,
    'restore batch 中的失败/降级状态也必须合并持久化和 stateUpdated，不能按节点触发全量写入。'
  );
  assert.match(
    managerSource,
    /private persistRuntimeRestoreStateSafely\([\s\S]*const recordFailure[\s\S]*try \{[\s\S]*this\.persistState\(\{ reason \}\)\.catch\(recordFailure\)[\s\S]*catch \(error\)[\s\S]*recordFailure\(error\)/u,
    'runtime restore 持久化 helper 必须同时捕获 persistState 的同步异常和 Promise rejection。'
  );
  assert.match(
    managerSource,
    /restoreLiveRuntimeSessions\([\s\S]*finally \{[\s\S]*if \(shouldPersist\) \{\s*this\.persistRuntimeRestoreStateSafely\('runtime-supervisor-restore-batch'\)/u,
    'restore batch finally 必须复用安全持久化 helper，不能让同步写入异常跳过批次收口。'
  );
  assert.match(
    managerSource,
    /launchMode === 'resume'[\s\S]*resumeContext\.strategy !== 'fake-provider'[\s\S]*this\.resolveAgentHistoryResumeLaunch\([\s\S]*provider,[\s\S]*resumeContext\.sessionId,[\s\S]*currentMetadata\.launchPreset,[\s\S]*this\.buildAgentLaunchIntent\(currentMetadata\)/u,
    'Codex / Claude 显式恢复当前节点原会话时必须复用 history resume 命令构造，并传入当前节点启动意图以保留 YOLO / 沙盒 / 自定义等偏好。'
  );
  assert.match(
    managerSource,
    /const validationDefaults = launchIntent[\s\S]*\{ command: defaults\.command, defaultArgs: '' \}[\s\S]*: defaults;[\s\S]*validateAgentCommandLine\(commandLine, provider, validationDefaults\)/u,
    '当前节点显式恢复传入启动意图后，命令校验必须跳过当前 Default args 解析，避免 Default args 中的会话目标拦截当前节点重启。'
  );
  assert.match(
    managerSource,
    /branchCommandLine = this\.buildAgentBranchCommandLine\([\s\S]*metadata\.provider,[\s\S]*sessionId,[\s\S]*this\.buildAgentLaunchIntent\(metadata\)/u,
    '当前节点分叉必须传入当前节点启动意图，不能只继承当前 Default args。'
  );
  assert.match(
    managerSource,
    /agentSkipFreshLaunchDefaultArgsValidation: true/u,
    '当前节点分叉创建出的 custom fork 节点必须记录 command-only 校验策略，不能在 applyCreateNode 或自动启动时被当前 Default args 拦截。'
  );
  assert.match(
    managerSource,
    /skipDefaultArgsValidation: metadata\.customLaunchCommandDefaultArgsPolicy === 'command-only'/u,
    '当前节点分叉创建出的 custom fork 节点自动启动时必须复用 command-only 校验策略。'
  );
  assert.match(
    managerSource,
    /historyResumeCommandLine = this\.buildHistoryResumeCommandLine\(params\.provider, sessionId\);/u,
    '历史会话恢复只能使用历史项 session id 与当前 Default args；provider 历史未提供原始启动意图。'
  );
  assert.match(
    managerSource,
    /historyForkCommandLine = this\.buildAgentBranchCommandLine\(params\.provider, sessionId\);/u,
    '历史会话分叉只能使用历史项 session id 与当前 Default args；不能误用当前节点启动意图。'
  );
  assert.match(
    managerSource,
    /const explicitLaunchCommandLine = params\.freshLaunchCommandLine\?\.trim\(\);[\s\S]*if \(explicitLaunchCommandLine\) \{[\s\S]*return explicitLaunchCommandLine;/u,
    'Agent resume/fork 的标题副标题和诊断命令必须显示完整显式命令，而不是只显示裸 resume 目标。'
  );
  assert.match(
    managerSource,
    /const hasExplicitLaunchArgs = launchArgs\.length > 0;[\s\S]*launchMode === 'resume' && resumeContext\.sessionId && !hasExplicitLaunchArgs[\s\S]*launchMode === 'resume' && !hasExplicitLaunchArgs/u,
    'Agent 显式恢复命令已包含 argv 时，buildAgentLaunchSpec 不应再次追加裸 resume 参数。'
  );
  assert.match(
    managerSource,
    /composeMultiRootCanvasState/u,
    'CanvasPanelManager 必须使用 root-local multi-root composition，而不是 fork 画布状态。'
  );
  assert.match(
    managerSource,
    /decomposeMultiRootCanvasState/u,
    'CanvasPanelManager 必须在持久化时把 multi-root 组合视图拆回 root-local 状态。'
  );
  assert.match(
    managerSource,
    /if \(workspaceFolders\.length === 1 && !resetDueToRuntimePersistenceModeChange\) \{[\s\S]*?if \(rootLocalSnapshot\?\.state !== undefined\) \{/u,
    '单根 workspace 必须优先读取当前 root-local state，避免从 multi-root 移除 root 后继续显示 workspace 级组合快照里的旧 root section。'
  );
  assert.doesNotMatch(
    managerSource,
    /rootLocalTimestamp|workspaceTimestamp/u,
    '单根 workspace 不应再用时间戳决定是否读取 workspace 级快照；否则 multi-root 移除 root 后可能残留被移除 root 的视图内容。'
  );
  assert.doesNotMatch(
    managerSource,
    /multi-root\s+fork|fork\s+(?:canvas|画布)|fork(?:ed)?(?:Canvas|MultiRoot)/i,
    'origin/main 新实现不应保留 multi-root fork 语义，同时允许 Agent 会话 Fork 功能独立存在。'
  );
  assert.doesNotMatch(
    managerSourceWithoutProviderNativeSessionBranching,
    /(?:^|[^A-Za-z])fork(?:[^A-Za-z]|$)/i,
    'origin/main 新实现不应保留 multi-root fork 语义；Claude Code 原生 session fork 路径不属于 multi-root canvas fork。'
  );
  assert.match(
    managerSource,
    /session\.agentProvider === 'claude' && containsTerminalSuspendInput\(data\)[\s\S]*claude-agent-ctrl-z-unsupported[\s\S]*Claude Agent nodes do not support Ctrl-Z\/fg/u,
    '宿主输入路径必须拒绝 Claude Agent Ctrl-Z，避免 Webview 或旧客户端绕过前端拦截。'
  );
  assert.doesNotMatch(
    managerSource,
    /maybeMarkClaudeAgentSuspended|detectNewClaudeCodeSuspendOutput|agentSuspendSignals|reactivateSuspendedExecutionSession/u,
    '宿主不应再保留 Claude suspend 文案识别或恢复挂起会话链路。'
  );

  console.log('canvas execution context tests passed');
} finally {
  if (previousHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = previousHome;
  }
  if (previousUserProfile === undefined) {
    delete process.env.USERPROFILE;
  } else {
    process.env.USERPROFILE = previousUserProfile;
  }
  await rm(tempDir, { recursive: true, force: true });
}
