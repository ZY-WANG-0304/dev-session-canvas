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
    'buildExecutionAttentionNotificationTitleForWorkspace',
    'createNextState',
    'downgradeLiveRuntimeNodesMissingRuntimeStoragePath',
    'hydrateRuntimeStoragePaths',
    'normalizeState',
    'reconcileDefaultExecutionMetadataCwd',
    'reconcileRuntimeNodesInArray',
    'resolveTerminalShellPathForConfigurationCwd'
  ];

  await esbuild.build({
    stdin: {
      contents: `
        export { CanvasPanelManager, ${exportedHelpers.join(', ')} } from './extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager';
        export { createRuntimeOwnerDescriptor, resolveRootRuntimeSupervisorGeneration, resolveRuntimeRootOwnerBaseStoragePath }
          from './extensions/vscode/dev-session-canvas/src/common/runtimeRootOwnership';
        export { namespaceCanvasObjectId } from './extensions/vscode/dev-session-canvas/src/common/canvasMultiRootComposition';
        export { workspace as vscodeWorkspace } from 'vscode';
      `,
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
    buildExecutionAttentionNotificationTitleForWorkspace,
    createNextState,
    createRuntimeOwnerDescriptor,
    downgradeLiveRuntimeNodesMissingRuntimeStoragePath,
    hydrateRuntimeStoragePaths,
    normalizeState,
    namespaceCanvasObjectId,
    reconcileDefaultExecutionMetadataCwd,
    reconcileRuntimeNodesInArray,
    resolveRootRuntimeSupervisorGeneration,
    resolveRuntimeRootOwnerBaseStoragePath,
    resolveTerminalShellPathForConfigurationCwd,
    vscodeWorkspace
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
    downgradedRuntimeState.state.nodes.find((candidate) => candidate.id === 'agent-live-missing-storage').metadata.agent.lastRuntimeError,
    missingRuntimeStoragePathReason
  );
  assert.equal(
    downgradedRuntimeState.state.nodes.find((candidate) => candidate.id === 'agent-live-with-storage').metadata.agent.attachmentState,
    'reattaching',
    '带有 root-local runtimeStoragePath 的 Agent 应继续保留 multi-root reattach 资格。'
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

  const profile = ({ linux: 'linux-owner-v1-candidate', darwin: 'macos-owner-v1-candidate',
    win32: 'windows-owner-v1-candidate' })[process.platform];
  const runtimeOwner = createRuntimeOwnerDescriptor({
    environmentKey: 'a'.repeat(64), userStorageScopeKey: 'b'.repeat(64), rootPath: workspaceRoot,
    generation: resolveRootRuntimeSupervisorGeneration(profile)
  });
  const runtimeStoragePath = resolveRuntimeRootOwnerBaseStoragePath(path.join(tempDir, 'global-storage'), runtimeOwner);
  const legacyRuntimeStoragePath = path.join(tempDir, 'original-workspace-slot');
  const currentWorkspaceSlot = path.join(tempDir, 'different-workspace-slot');
  function runtimeNode(kind, binding) {
    const source = kind === 'agent' ? createdAgentState.nodes[0] : createdTerminalState.nodes[0];
    return {
      ...source, id: `${kind}-runtime-owner`, status: 'reattaching',
      metadata: { [kind]: {
        ...source.metadata[kind], persistenceMode: 'live-runtime', attachmentState: 'reattaching',
        runtimeBackend: 'legacy-detached', runtimeSessionId: `${kind}-original-session`, liveSession: false,
        ...binding
      } }
    };
  }
  for (const kind of ['agent', 'terminal']) {
    const initial = { ...emptyState, nodes: [runtimeNode(kind, { runtimeOwner, runtimeStoragePath })] };
    const normalized = normalizeState(initial, 'codex');
    const restored = normalizeState(JSON.parse(JSON.stringify(normalized)), 'codex');
    for (const state of [normalized, restored, hydrateRuntimeStoragePaths(restored, currentWorkspaceSlot)]) {
      const metadata = state.nodes[0].metadata[kind];
      assert.deepEqual(metadata.runtimeOwner, runtimeOwner, `${kind} retains its complete owner across persistence.`);
      assert.equal(metadata.runtimeStoragePath, runtimeStoragePath);
      assert.equal(metadata.runtimeBackend, 'legacy-detached');
      assert.equal(metadata.runtimeSessionId, `${kind}-original-session`);
      assert.equal(metadata.attachmentState, 'reattaching');
    }

    const missingPath = normalizeState({ ...emptyState, nodes: [runtimeNode(kind, { runtimeOwner })] }, 'codex');
    const retainedMissingPath = hydrateRuntimeStoragePaths(missingPath, currentWorkspaceSlot).nodes[0].metadata[kind];
    assert.deepEqual(retainedMissingPath.runtimeOwner, runtimeOwner);
    assert.equal(retainedMissingPath.runtimeStoragePath, undefined, `${kind} owner cannot inherit a workspace slot.`);
    assert.equal(retainedMissingPath.runtimeSessionId, `${kind}-original-session`);
    assert.equal(retainedMissingPath.runtimeBackend, 'legacy-detached');

    for (const owner of [runtimeOwner, null]) {
      const original = normalizeState({ ...emptyState, nodes: [runtimeNode(kind, { runtimeOwner: owner })] }, 'codex');
      const result = downgradeLiveRuntimeNodesMissingRuntimeStoragePath(original, missingRuntimeStoragePathReason);
      assert.equal(result.downgradedCount, 0, `${kind} owner binding without a path must remain available for validation.`);
      assert.deepEqual(result.state, original);
    }
    for (const owner of [runtimeOwner, null, undefined]) {
      const node = runtimeNode(kind, { runtimeOwner: owner, runtimeStoragePath });
      for (const reason of ['runtime-persistence-disabled', 'workspace-untrusted']) {
        const [reconciled] = reconcileRuntimeNodesInArray([node], new Map(), new Map(), {
          allowLiveRuntimeReconnect: false, liveRuntimeReconnectBlockReason: reason
        });
        const mayReconnect = owner !== undefined && reason === 'runtime-persistence-disabled';
        assert.equal(reconciled.status, mayReconnect ? 'reattaching' : 'history-restored');
        assert.equal(reconciled.metadata[kind].attachmentState,
          mayReconnect || reason === 'workspace-untrusted' ? 'reattaching' : 'history-restored');
        assert.deepEqual(reconciled.metadata[kind].runtimeOwner, owner);
        assert.equal(reconciled.metadata[kind].runtimeSessionId, `${kind}-original-session`);
      }
    }

    const liveSession = {
      owner: 'supervisor', runtimeOwner, runtimeBackend: 'legacy-detached', runtimeStoragePath,
      runtimeSessionId: `${kind}-live-session`, buffer: '', terminalStateTrusted: false,
      lifecycleStatus: kind === 'agent' ? 'running' : 'live', displayLabel: kind,
      cwd: workspaceRoot, shellPath: '/bin/bash', outputSequence: 0, cols: 80, rows: 24
    };
    for (const sessionOwner of ['supervisor', 'local']) {
      const session = { ...liveSession, owner: sessionOwner };
      const sessions = new Map([[initial.nodes[0].id, session]]);
      const reconciled = reconcileRuntimeNodesInArray(
        initial.nodes, kind === 'agent' ? sessions : new Map(), kind === 'terminal' ? sessions : new Map()
      )[0].metadata[kind];
      assert.deepEqual(reconciled.runtimeOwner, sessionOwner === 'supervisor' ? runtimeOwner : undefined);
      assert.equal(reconciled.runtimeStoragePath, sessionOwner === 'supervisor' ? runtimeStoragePath : undefined);
      assert.equal(reconciled.runtimeBackend, sessionOwner === 'supervisor' ? 'legacy-detached' : undefined);
      assert.equal(reconciled.runtimeSessionId, `${kind}-live-session`);
    }

    const missingOwner = normalizeState({ ...emptyState, nodes: [runtimeNode(kind, { runtimeStoragePath })] }, 'codex');
    const retainedMissingOwner = hydrateRuntimeStoragePaths(missingOwner, currentWorkspaceSlot).nodes[0].metadata[kind];
    assert.equal(retainedMissingOwner.runtimeOwner, undefined);
    assert.equal(retainedMissingOwner.runtimeStoragePath, runtimeStoragePath);
    assert.equal(retainedMissingOwner.runtimeSessionId, `${kind}-original-session`);
    assert.equal(retainedMissingOwner.runtimeBackend, 'legacy-detached');

    for (const invalidOwner of [null, { ...runtimeOwner, schema: 2 }, { ...runtimeOwner, environmentKey: '' }]) {
      for (const originalPath of [undefined, runtimeStoragePath, legacyRuntimeStoragePath]) {
        const invalid = normalizeState({ ...emptyState, nodes: [runtimeNode(kind, {
          runtimeOwner: invalidOwner, runtimeStoragePath: originalPath
        })] }, 'codex');
        const readBack = normalizeState(JSON.parse(JSON.stringify(invalid)), 'codex');
        for (const state of [invalid, readBack, hydrateRuntimeStoragePaths(readBack, currentWorkspaceSlot)]) {
          const metadata = state.nodes[0].metadata[kind];
          assert.equal(metadata.runtimeOwner, null, `${kind} retains the invalid-owner marker instead of becoming legacy.`);
          assert.equal(metadata.runtimeStoragePath, originalPath);
          assert.equal(metadata.runtimeBackend, 'legacy-detached');
          assert.equal(metadata.runtimeSessionId, `${kind}-original-session`);
          assert.equal(metadata.persistenceMode, 'live-runtime');
          assert.equal(metadata.attachmentState, 'reattaching');
          assert.equal(metadata.terminalHistoryDiscarded, undefined);
        }
      }
    }

    for (const runtimeBackend of ['legacy-detached', 'systemd-user']) {
      const legacy = normalizeState({ ...emptyState, nodes: [runtimeNode(kind, {
        runtimeBackend, runtimeStoragePath: legacyRuntimeStoragePath
      })] }, 'codex');
      const metadata = hydrateRuntimeStoragePaths(legacy, currentWorkspaceSlot).nodes[0].metadata[kind];
      assert.equal(metadata.runtimeOwner, undefined);
      assert.equal(metadata.runtimeStoragePath, legacyRuntimeStoragePath);
      assert.equal(metadata.runtimeBackend, runtimeBackend);
      assert.equal(metadata.runtimeSessionId, `${kind}-original-session`);
      assert.equal(metadata.attachmentState, 'reattaching');
    }
    const legacyMissingPath = normalizeState({ ...emptyState, nodes: [runtimeNode(kind, {})] }, 'codex');
    const hydratedLegacy = hydrateRuntimeStoragePaths(legacyMissingPath, currentWorkspaceSlot).nodes[0].metadata[kind];
    assert.equal(hydratedLegacy.runtimeStoragePath, currentWorkspaceSlot);
    assert.equal(hydratedLegacy.runtimeOwner, undefined);
    assert.equal(hydratedLegacy.runtimeSessionId, `${kind}-original-session`);
  }

  const rootA = process.platform === 'win32' ? workspaceRoot.toLowerCase() : workspaceRoot;
  const rootB = path.join(path.dirname(rootA), 'other-root');
  const removedRoot = path.join(path.dirname(rootA), 'removed-root');
  const originalWorkspaceFolders = vscodeWorkspace.workspaceFolders;
  function setRootFolders(roots) {
    vscodeWorkspace.workspaceFolders = roots.map((root, index) => ({ name: `root-${index}`, uri: { fsPath: root } }));
  }
  const rootGroups = [
    { id: 'root-a-group', role: 'workspace-root', workspaceRootPath: rootA },
    { id: 'root-b-group', role: 'workspace-root', workspaceRootPath: rootB },
    { id: 'nested-a-group', parentGroupId: 'root-a-group' }
  ];
  const rootHost = Object.create(CanvasPanelManager.prototype);
  rootHost.state = { ...emptyState, groups: rootGroups };
  rootHost.executionSessionOperationTokens = new Map();
  try {
    for (const kind of ['agent', 'terminal']) {
      const plainNode = runtimeNode(kind, { cwd: removedRoot });
      const rootANode = { ...plainNode, id: namespaceCanvasObjectId(rootA, plainNode.id), groupId: 'nested-a-group' };
      setRootFolders([rootA]);
      assert.equal(rootHost.resolveExecutionNodeRuntimeRoot(plainNode), rootA, `${kind} single-root ownership ignores cwd.`);
      assert.equal(rootHost.resolveExecutionNodeRuntimeRoot(rootANode), rootA);
      setRootFolders([rootA, rootB]);
      assert.equal(rootHost.resolveExecutionNodeRuntimeRoot(rootANode), rootA, `${kind} keeps the same root in a multi-root canvas.`);
      assert.equal(rootHost.resolveExecutionNodeRuntimeRoot({ ...plainNode, groupId: 'nested-a-group' }), rootA);
      assert.equal(rootHost.resolveExecutionNodeRuntimeRoot({
        ...plainNode, id: namespaceCanvasObjectId(rootB, plainNode.id)
      }), rootB);
      assert.throws(() => rootHost.resolveExecutionNodeRuntimeRoot({
        ...rootANode, id: namespaceCanvasObjectId(rootB, plainNode.id)
      }), /disagree/, `${kind} conflicting namespace and group cannot choose an owner.`);
      assert.throws(() => rootHost.resolveExecutionNodeRuntimeRoot(plainNode), /no confirmed runtime root/,
        `${kind} cannot infer a multi-root owner from cwd.`);
      assert.throws(() => rootHost.resolveExecutionNodeRuntimeRoot({
        ...plainNode, id: namespaceCanvasObjectId(removedRoot, plainNode.id)
      }), /missing or ambiguous/);
      setRootFolders([rootB]);
      assert.throws(() => rootHost.resolveExecutionNodeRuntimeRoot({ ...plainNode, groupId: 'nested-a-group' }),
        /no longer in this workspace/);
      assert.throws(() => rootHost.resolveExecutionNodeRuntimeRoot(rootANode), /missing or ambiguous/);

      setRootFolders([]);
      assert.equal(rootHost.resolveExecutionNodeRuntimeRoot(plainNode), undefined,
        `${kind} is rootless only with no folders or root identity evidence.`);
      assert.throws(() => rootHost.resolveExecutionNodeRuntimeRoot(rootANode), /missing or ambiguous/);
      assert.throws(() => rootHost.resolveExecutionNodeRuntimeRoot({ ...plainNode, groupId: 'nested-a-group' }),
        /no longer in this workspace/);

      for (const whitespaceRoot of [` ${rootA}`, `${rootA} `]) {
        setRootFolders([whitespaceRoot]);
        assert.throws(() => rootHost.resolveExecutionNodeRuntimeRoot(plainNode), /root|identit/i,
          `${kind} must reject whitespace-boundary workspace paths before normalization.`);
        setRootFolders([rootA]);
        rootHost.state.groups = [{ ...rootGroups[0], workspaceRootPath: whitespaceRoot }];
        assert.throws(() => rootHost.resolveExecutionNodeRuntimeRoot({ ...plainNode, groupId: 'root-a-group' }),
          /no longer in this workspace/);
        rootHost.state.groups = rootGroups;
      }
      setRootFolders(['relative-root']);
      assert.throws(() => rootHost.resolveExecutionNodeRuntimeRoot(plainNode), /unambiguous/);
      setRootFolders([rootA]);
      rootHost.state.groups = [{ ...rootGroups[0], workspaceRootPath: undefined }];
      assert.throws(() => rootHost.resolveExecutionNodeRuntimeRoot({ ...plainNode, groupId: 'root-a-group' }),
        /no longer in this workspace/);
      setRootFolders([process.cwd()]);
      rootHost.state.groups = [{ ...rootGroups[0], workspaceRootPath: '.' }];
      assert.throws(() => rootHost.resolveExecutionNodeRuntimeRoot({ ...plainNode, groupId: 'root-a-group' }),
        /root|identit/i, `${kind} cannot resolve a relative persisted root group against the Host cwd.`);
      for (const folders of [[], [rootA], [rootA, rootB]]) {
        setRootFolders(folders);
        for (const groups of [
          [],
          [{ id: 'broken-group', parentGroupId: 'removed-parent' }],
          [{ id: 'broken-group', parentGroupId: 'broken-group' }],
          [{ id: 'broken-group', parentGroupId: 'cycle-peer' }, { id: 'cycle-peer', parentGroupId: 'broken-group' }]
        ]) {
          rootHost.state.groups = groups;
          assert.throws(() => rootHost.resolveExecutionNodeRuntimeRoot({ ...plainNode, groupId: 'broken-group' }),
            /group|root|identit/i, `${kind} dangling or cyclic group identity cannot fall back to another root.`);
        }
      }
      setRootFolders([]);
      rootHost.state.groups = [{ id: 'ordinary-group' }];
      assert.equal(rootHost.resolveExecutionNodeRuntimeRoot({ ...plainNode, groupId: 'ordinary-group' }), undefined,
        `${kind} an ordinary rootless group provides no workspace-root identity.`);
      rootHost.state.groups = rootGroups;
      setRootFolders([rootA, rootA]);
      assert.throws(() => rootHost.resolveExecutionNodeRuntimeRoot(plainNode), /unambiguous/);

      setRootFolders([rootA, rootB]);
      const movingNode = { ...plainNode, groupId: 'root-a-group' };
      rootHost.state.nodes = [movingNode];
      const operationKey = rootHost.getExecutionSessionOperationKey(kind, movingNode.id);
      rootHost.executionSessionOperationTokens.set(operationKey, 1);
      const capturedRoot = rootHost.resolveExecutionNodeRuntimeRoot(movingNode);
      rootHost.assertExecutionRuntimeRootCurrent(kind, movingNode.id, 1, capturedRoot);
      await Promise.resolve();
      rootHost.state.nodes = [{ ...movingNode, groupId: 'root-b-group' }];
      assert.throws(() => rootHost.assertExecutionRuntimeRootCurrent(kind, movingNode.id, 1, capturedRoot),
        /runtime root changed/, `${kind} rejects a changed root after an asynchronous boundary.`);
      rootHost.state.nodes = [movingNode];
      rootHost.executionSessionOperationTokens.set(operationKey, 2);
      assert.throws(() => rootHost.assertExecutionRuntimeRootCurrent(kind, movingNode.id, 1, capturedRoot), /changed/);
      rootHost.executionSessionOperationTokens.set(operationKey, 1);
      setRootFolders([rootB]);
      assert.throws(() => rootHost.assertExecutionRuntimeRootCurrent(kind, movingNode.id, 1, capturedRoot),
        /no longer in this workspace/);
      rootHost.state.nodes = [];
      assert.throws(() => rootHost.assertExecutionRuntimeRootCurrent(kind, movingNode.id, 1, capturedRoot), /Could not find/);
    }
  } finally {
    vscodeWorkspace.workspaceFolders = originalWorkspaceFolders;
  }

  function makePreferenceHost(nodes, enabled = false) {
    return Object.assign(Object.create(CanvasPanelManager.prototype), {
      state: { ...emptyState, nodes },
      appliedStartupConfiguration: { runtimePersistenceEnabled: enabled, filesFeatureEnabled: true, defaultSurface: 'panel' },
      agentSessions: new Map(), terminalSessions: new Map(), runtimeSessionBindings: new Map(),
      preferredRootRuntimeBackends: new Map(), runtimeSupervisorClients: new Map(),
      context: { workspaceState: { get: () => undefined } },
      getExtensionStoragePath: () => currentWorkspaceSlot,
      recordDiagnosticEvent() {}, getAgentCliConfig: () => ({ defaultProvider: 'codex' }),
      reconcileCanvasFileArtifacts: state => state,
      materializeNoteMarkdownRecoverableDraftFiles: state => state
    });
  }
  const originalWorkspaceTrusted = vscodeWorkspace.isTrusted;
  try {
    for (const kind of ['agent', 'terminal']) {
      const rootNode = runtimeNode(kind, { runtimeOwner, runtimeStoragePath });
      const legacyNode = { ...runtimeNode(kind, { runtimeStoragePath: legacyRuntimeStoragePath }), id: `${kind}-legacy` };
      const host = makePreferenceHost([rootNode, legacyNode]);
      assert.equal(host.getLiveRuntimeReconnectBlockReason(rootNode.metadata[kind]), undefined);
      assert.equal(host.getLiveRuntimeReconnectBlockReason({ runtimeOwner: null }), undefined);
      assert.equal(host.getLiveRuntimeReconnectBlockReason(legacyNode.metadata[kind]), 'runtime-persistence-disabled');
      vscodeWorkspace.isTrusted = false;
      assert.equal(host.getLiveRuntimeReconnectBlockReason(rootNode.metadata[kind]), 'workspace-untrusted');
      assert.equal(host.getLiveRuntimeReconnectBlockReason(), 'workspace-untrusted');
      vscodeWorkspace.isTrusted = true;

      const deleted = [];
      const attached = [];
      host.deleteRuntimeSupervisorSessions = async sessions => deleted.push(...sessions);
      host.getRuntimeSupervisorClientForKind = async (backend, _options, storage, owner) => {
        assert.equal(backend, 'legacy-detached');
        assert.equal(storage, runtimeStoragePath);
        assert.deepEqual(owner, runtimeOwner);
        return {};
      };
      host.requestRuntimeSupervisorSessionAttach = async (_client, sessionId) => ({ sessionId });
      host.attachPersistedRuntimeSession = async (nodeKind, nodeId, sessionId, request) => {
        attached.push({ nodeKind, nodeId, sessionId, result: await request() });
      };
      await host.restoreLiveRuntimeSessions();
      assert.deepEqual(deleted.map(session => session.nodeId), [legacyNode.id]);
      assert.deepEqual(attached.map(session => session.nodeId), [rootNode.id]);
      assert.deepEqual(host.state.nodes, [rootNode, legacyNode], 'Default persistence settings do not rewrite original bindings.');
      vscodeWorkspace.isTrusted = false;
      await host.restoreLiveRuntimeSessions();
      assert.equal(deleted.length, 1);
      assert.equal(attached.length, 1, 'Untrusted workspaces neither attach nor delete root sessions.');
      vscodeWorkspace.isTrusted = true;

      Object.assign(host, {
        getCanvasFileViewConfiguration: () => ({}),
        loadPersistedCanvasSnapshot: () => undefined,
        loadPersistedRootLocalCanvasSnapshot: rootPath => ({
          state: { ...emptyState, nodes: rootPath === rootA ? [rootNode] : [] }, runtimePersistenceEnabled: true
        }),
        getRootLocalCanvasSnapshotPath: () => path.join(tempDir, 'root-local-snapshot.json')
      });
      for (const roots of [[rootA], [rootA, rootB]]) {
        setRootFolders(roots);
        const loaded = host.loadReconciledState();
        const restored = loaded.nodes.find(node => node.kind === kind);
        assert.ok(restored, `${kind} shared root-local snapshot is loaded by a new default-false workspace slot.`);
        assert.equal(restored.status, 'reattaching');
        assert.deepEqual(restored.metadata[kind].runtimeOwner, runtimeOwner);
        assert.equal(restored.metadata[kind].runtimeStoragePath, runtimeStoragePath);
      }
    }

    for (const kind of ['agent', 'terminal']) {
      for (const connectionFails of [false, true]) {
        for (const changed of ['none', 'backend', 'storage', 'owner', 'session', 'removed']) {
          const node = runtimeNode(kind, { runtimeOwner, runtimeStoragePath });
          const host = makePreferenceHost([node], true);
          const requested = [];
          const applied = [];
          const restored = [];
          const retired = [];
          let resolveConnection;
          let rejectConnection;
          const connection = new Promise((resolve, reject) => {
            resolveConnection = resolve;
            rejectConnection = reject;
          });
          const originalClient = {};
          Object.assign(host, {
            executionSessionOperationTokens: new Map(),
            getRuntimeSupervisorClientForKind: (_backend, _options, storage, owner) => {
              assert.equal(storage, runtimeStoragePath);
              assert.deepEqual(owner, runtimeOwner);
              return connection;
            },
            requestRuntimeSupervisorSessionAttach: async (client, sessionId) => {
              assert.equal(client, originalClient);
              requested.push(sessionId);
              return { snapshot: { kind, sessionId, live: true }, terminalProjectionMode: 'terminal-stream-v1' };
            },
            bindRuntimeSession() {},
            applyRuntimeSupervisorSnapshot: async (_nodeId, _kind, snapshot) => { applied.push(snapshot.sessionId); },
            subscribeRuntimeSupervisorTerminalStream: async () => {},
            markExecutionNodeAsHistoryRestored: nodeId => restored.push(nodeId),
            maybeFallbackAgentLiveRuntimeToResume: () => false,
            retireLegacyRuntimeSupervisorClientIfUnused: (_backend, client) => retired.push(client)
          });
          const restoring = host.restoreLiveRuntimeSessions();
          const patch = changed === 'backend' ? { runtimeBackend: 'systemd-user' }
            : changed === 'storage' ? { runtimeStoragePath: `${runtimeStoragePath}-replacement` }
              : changed === 'owner' ? { runtimeOwner: { ...runtimeOwner, environmentKey: 'b'.repeat(64) } }
                : changed === 'session' ? { runtimeSessionId: 'replacement-session' } : {};
          if (changed === 'removed') host.state.nodes = [];
          else if (changed !== 'none') host.state.nodes = [{ ...node,
            metadata: { ...node.metadata, [kind]: { ...node.metadata[kind], ...patch } } }];
          const currentState = host.state;
          if (connectionFails) rejectConnection(new Error('The original owner is unavailable.'));
          else resolveConnection(originalClient);
          await restoring;
          const label = `${kind}/${connectionFails ? 'failed' : 'ready'}/${changed}`;
          assert.deepEqual(requested, changed === 'none' && !connectionFails ? [node.metadata[kind].runtimeSessionId] : [],
            `${label}: a superseded bucket must not dispatch an attach to its original client.`);
          assert.deepEqual(applied, requested, `${label}: only the unchanged original binding accepts its snapshot.`);
          assert.deepEqual(restored, changed === 'none' && connectionFails ? [node.id] : [],
            `${label}: the original connection failure must not downgrade a replacement binding.`);
          if (!connectionFails) assert.ok(retired.includes(originalClient),
            `${label}: even a fully superseded bucket reaches the original client's retirement check.`);
          assert.equal(host.state, currentState, `${label}: stale connection settlement leaves current state untouched.`);
        }
      }
    }

    for (const [enabled, nextEnabled, expectedDeleted, rejectDeletion = false] of [
      [false, false, ['legacy-terminal']], [false, true, ['legacy-terminal']],
      [true, true, []], [true, false, ['agent-runtime-owner', 'legacy-terminal']],
      [true, false, ['agent-runtime-owner', 'legacy-terminal'], true]
    ]) {
      const rootNode = runtimeNode('agent', { runtimeOwner, runtimeStoragePath });
      const legacyNode = { ...runtimeNode('terminal', { runtimeStoragePath: legacyRuntimeStoragePath }), id: 'legacy-terminal' };
      const host = makePreferenceHost([rootNode, legacyNode], enabled);
      const deleted = [];
      let disposed = 0;
      Object.assign(host, {
        executionCandidateProfile: profile,
        readStartupConfiguration: () => ({ runtimePersistenceEnabled: nextEnabled }),
        terminalProjectionRefreshScheduler: { clearMatching() {} },
        waitForPendingRuntimeSupervisorOperations: async () => undefined,
        flushAllExecutionSessionStatesForHostBoundary: async () => undefined,
        flushDeferredCanvasStatePersist: async () => undefined,
        waitForPendingWorkspaceStateUpdates: async () => undefined,
        clearPendingTerminalInitialInputs() {},
        deleteRuntimeSupervisorSessions: async (sessions, options) => {
          assert.equal(options.allowRestart, false);
          assert.equal(options.requireExistingClient, true);
          deleted.push(...sessions);
          if (rejectDeletion) throw new Error('Original binding deletion is unconfirmed.');
        },
        disposeRuntimeSupervisorClients: () => { disposed += 1; }
      });
      if (rejectDeletion) {
        await assert.rejects(host.prepareOrdinaryDeactivation(), /Original binding deletion is unconfirmed/);
      } else {
        await host.prepareOrdinaryDeactivation();
      }
      assert.deepEqual(deleted.map(session => session.nodeId), expectedDeleted,
        'Ordinary boundaries preserve root bindings by actual ownership without changing legacy deletion rules.');
      assert.equal(disposed, rejectDeletion ? 0 : 1);
      assert.deepEqual(host.state.nodes, [rootNode, legacyNode]);
    }
  } finally {
    vscodeWorkspace.workspaceFolders = originalWorkspaceFolders;
    vscodeWorkspace.isTrusted = originalWorkspaceTrusted;
  }

  const managerSource = await readFile('extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts', 'utf8');
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
    .replace(/'fork-layer'/gu, "'agent-placement-layer'")
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
    /buildRuntimeSessionBindingKey\([\s\S]*kind:[\s\S]*runtimeSessionId:[\s\S]*runtimeStoragePath:[\s\S]*runtimeBackend/u,
    'runtime binding key 必须包含 execution kind、runtimeStoragePath、runtimeSessionId 和 backend，不能只按 root 或 display node 绑定。'
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
