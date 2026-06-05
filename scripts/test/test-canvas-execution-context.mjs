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
    'createNextState',
    'normalizeState',
    'preserveRootLocalLiveRuntimeReconnectState',
    'reconcileDefaultExecutionMetadataCwd',
    'resolveTerminalShellPathForConfigurationCwd'
  ];

  await esbuild.build({
    stdin: {
      contents: `export { ${exportedHelpers.join(', ')} } from './src/panel/CanvasPanelManager';`,
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
    createNextState,
    normalizeState,
    preserveRootLocalLiveRuntimeReconnectState,
    reconcileDefaultExecutionMetadataCwd,
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

  const preservedRootStates = preserveRootLocalLiveRuntimeReconnectState(
    [
      {
        rootPath: workspaceRoot,
        state: {
          ...emptyState,
          nodes: [
            {
              id: 'agent-live',
              kind: 'agent',
              title: 'Agent Live',
              status: 'live',
              summary: '',
              position: { x: 0, y: 0 },
              size: { width: 160, height: 120 },
              metadata: {
                agent: {
                  provider: 'claude',
                  lifecycle: 'live',
                  shellPath: 'claude',
                  cwd: path.join(workspaceRoot, 'old-agent-cwd'),
                  persistenceMode: 'live-runtime',
                  runtimeSessionId: 'agent-runtime-1',
                  attachmentState: 'attached-live',
                  liveSession: true
                }
              }
            },
            {
              id: 'terminal-live',
              kind: 'terminal',
              title: 'Terminal Live',
              status: 'live',
              summary: '',
              position: { x: 240, y: 0 },
              size: { width: 160, height: 120 },
              metadata: {
                terminal: {
                  lifecycle: 'live',
                  cwd: path.join(workspaceRoot, 'old-terminal-cwd'),
                  persistenceMode: 'live-runtime',
                  runtimeSessionId: 'terminal-runtime-1',
                  attachmentState: 'reattaching',
                  liveSession: false
                }
              }
            }
          ]
        }
      }
    ],
    [
      {
        rootPath: workspaceRoot,
        state: {
          ...emptyState,
          nodes: [
            {
              id: 'agent-live',
              kind: 'agent',
              title: 'Agent Live',
              status: 'history-restored',
              summary: '',
              position: { x: 0, y: 0 },
              size: { width: 160, height: 120 },
              metadata: {
                agent: {
                  provider: 'codex',
                  lifecycle: 'live',
                  shellPath: 'codex',
                  cwd: path.join(workspaceRoot, 'new-agent-cwd'),
                  persistenceMode: 'live-runtime',
                  runtimeSessionId: 'agent-runtime-1',
                  attachmentState: 'history-restored',
                  liveSession: false
                }
              }
            },
            {
              id: 'terminal-live',
              kind: 'terminal',
              title: 'Terminal Live',
              status: 'history-restored',
              summary: '',
              position: { x: 240, y: 0 },
              size: { width: 160, height: 120 },
              metadata: {
                terminal: {
                  lifecycle: 'live',
                  cwd: path.join(workspaceRoot, 'new-terminal-cwd'),
                  persistenceMode: 'live-runtime',
                  runtimeSessionId: 'terminal-runtime-1',
                  attachmentState: 'history-restored',
                  liveSession: false
                }
              }
            }
          ]
        }
      }
    ]
  );
  assert.equal(
    preservedRootStates[0].state.nodes.find((candidate) => candidate.id === 'agent-live').metadata.agent.liveSession,
    true,
    'multi-root restore skip 不应把 root-local Agent live runtime 恢复信号持久化改成 history-restored。'
  );
  assert.equal(
    preservedRootStates[0].state.nodes.find((candidate) => candidate.id === 'terminal-live').metadata.terminal.attachmentState,
    'reattaching',
    'multi-root restore skip 不应覆盖 root-local Terminal 的 reattach 信号。'
  );
  assert.equal(
    preservedRootStates[0].state.nodes.find((candidate) => candidate.id === 'agent-live').metadata.agent.cwd,
    path.join(workspaceRoot, 'new-agent-cwd'),
    'multi-root restore skip 只应恢复 reattach 信号，不应覆盖 root-local Agent 的非 runtime 字段。'
  );
  assert.equal(
    preservedRootStates[0].state.nodes.find((candidate) => candidate.id === 'agent-live').metadata.agent.provider,
    'codex',
    'multi-root restore skip 不应把旧 root-local Agent provider 覆盖回去。'
  );
  assert.equal(
    preservedRootStates[0].state.nodes.find((candidate) => candidate.id === 'terminal-live').metadata.terminal.cwd,
    path.join(workspaceRoot, 'new-terminal-cwd'),
    'multi-root restore skip 只应恢复 Terminal reattach 信号，不应覆盖 cwd 等非 runtime 字段。'
  );

  const managerSource = await readFile('src/panel/CanvasPanelManager.ts', 'utf8');
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
    'workspace folder 变化后必须重新执行 live runtime restore 调度；multi-root 会按显式策略跳过。'
  );
  assert.match(
    managerSource,
    /'multi-root-workspace'/u,
    'multi-root live runtime restore 必须有显式 block reason，而不是复用单根恢复路径。'
  );
  assert.match(
    managerSource,
    /runtime\/restoreSkipped[\s\S]*multiRootWorkspace/u,
    'multi-root live runtime restore skip 必须记录诊断事件，便于追踪。'
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
    /(?:^|[^A-Za-z])fork(?:[^A-Za-z]|$)/i,
    'origin/main 新实现不应保留 multi-root fork 语义。'
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
