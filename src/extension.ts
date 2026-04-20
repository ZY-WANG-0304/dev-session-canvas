import * as vscode from 'vscode';

import { locateCodexSessionId } from './common/codexSessionIdLocator';
import { COMMAND_IDS, CONFIG_KEYS, EXTENSION_DISPLAY_NAME, TEST_COMMAND_IDS, VIEW_IDS } from './common/extensionIdentity';
import {
  isAgentProviderKind,
  isCanvasCreatableNodeKind,
  isWebviewDomAction,
  type AgentProviderKind,
  type CanvasCreatableNodeKind,
  type CanvasNodeKind
} from './common/protocol';
import { CanvasPanelManager, type CanvasSurfaceLocation } from './panel/CanvasPanelManager';
import { CanvasSidebarActionsView } from './sidebar/CanvasSidebarActionsView';
import { CanvasSidebarView } from './sidebar/CanvasSidebarView';

let activePanelManager: CanvasPanelManager | undefined;
let queuedQuickPickSelectionIds: CreateNodeQuickPickSelectionId[] = [];

type CreateNodeRequest = {
  kind: CanvasCreatableNodeKind;
  agentProvider?: AgentProviderKind;
};

type CreateNodeQuickPickSelectionId =
  | 'create-agent-default'
  | 'create-terminal'
  | 'create-note'
  | 'create-agent-codex'
  | 'create-agent-claude';

interface CreateNodeQuickPickItem extends vscode.QuickPickItem {
  selectionId?: CreateNodeQuickPickSelectionId;
  request?: CreateNodeRequest;
}

export function activate(context: vscode.ExtensionContext): void {
  const panelManager = new CanvasPanelManager(context);
  activePanelManager = panelManager;
  const sidebarSummaryView = new CanvasSidebarView(panelManager);
  const sidebarActionsView = new CanvasSidebarActionsView(panelManager);

  context.subscriptions.push(
    sidebarSummaryView,
    sidebarActionsView,
    vscode.window.registerTreeDataProvider(VIEW_IDS.sidebarTree, sidebarSummaryView),
    vscode.window.registerWebviewViewProvider(VIEW_IDS.sidebarFilters, sidebarActionsView, {
      webviewOptions: {
        retainContextWhenHidden: true
      }
    })
  );

  registerCommand(context, COMMAND_IDS.openCanvas, async () => {
    await panelManager.revealOrCreate();
  });

  registerCommand(context, COMMAND_IDS.openCanvasInEditor, async () => {
    await panelManager.revealInEditor();
  });

  registerCommand(context, COMMAND_IDS.openCanvasInPanel, async () => {
    await panelManager.revealInPanel();
  });

  registerCommand(context, COMMAND_IDS.openSettings, async () => {
    await vscode.commands.executeCommand(
      'workbench.action.openSettings',
      '@ext:devsessioncanvas.dev-session-canvas devSessionCanvas'
    );
  });

  registerCommand(context, COMMAND_IDS.createNode, async () => {
    const createRequest = await promptCreateNodeRequest(panelManager.getSidebarState().creatableKinds);
    if (!createRequest) {
      return;
    }

    await panelManager.revealOrCreate();
    panelManager.createNode(createRequest.kind, {
      agentProvider: createRequest.agentProvider
    });
  });

  registerCommand(context, COMMAND_IDS.resetCanvasState, async () => {
    const confirmed = await vscode.window.showWarningMessage(
      '重置会清空当前 workspace 绑定的画布对象，并终止运行中的 Agent / Terminal 会话。',
      { modal: true },
      '继续重置'
    );
    if (confirmed !== '继续重置') {
      return;
    }

    await panelManager.resetState();
  });

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMAND_IDS.editFileIncludeFilter, async (value?: unknown) => {
      await updateCanvasFileFilterFromCommand(panelManager, 'include', value);
    }),
    vscode.commands.registerCommand(COMMAND_IDS.editFileExcludeFilter, async (value?: unknown) => {
      await updateCanvasFileFilterFromCommand(panelManager, 'exclude', value);
    }),
    vscode.commands.registerCommand(COMMAND_IDS.clearFileIncludeFilter, () => {
      panelManager.updateCanvasFileFilterState('include', []);
    }),
    vscode.commands.registerCommand(COMMAND_IDS.clearFileExcludeFilter, () => {
      panelManager.updateCanvasFileFilterState('exclude', []);
    })
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(CanvasPanelManager.panelViewType, panelManager, {
      webviewOptions: {
        retainContextWhenHidden: true
      }
    }),
    vscode.window.registerWebviewPanelSerializer(CanvasPanelManager.viewType, panelManager)
  );

  registerTestCommands(context, panelManager);
}

export async function deactivate(): Promise<void> {
  const panelManager = activePanelManager;
  activePanelManager = undefined;
  await panelManager?.prepareForDeactivation();
}

function registerCommand(context: vscode.ExtensionContext, commandId: string, handler: () => Promise<void>): void {
  context.subscriptions.push(vscode.commands.registerCommand(commandId, handler));
}

async function promptCreateNodeRequest(
  creatableKinds: CanvasCreatableNodeKind[]
): Promise<CreateNodeRequest | undefined> {
  const picked = await showQuickPickWithTestOverride(
    buildCreateNodeQuickPickItems(creatableKinds, getDefaultAgentProvider()),
    {
      placeHolder: '选择要创建的对象或 Agent 类型'
    }
  );

  return picked?.request;
}

function buildCreateNodeQuickPickItems(
  creatableKinds: CanvasCreatableNodeKind[],
  defaultAgentProvider: AgentProviderKind
): CreateNodeQuickPickItem[] {
  const items: CreateNodeQuickPickItem[] = [];

  const directCreateItems: CreateNodeQuickPickItem[] = [];
  if (creatableKinds.includes('agent')) {
    directCreateItems.push({
      label: `Agent（默认：${providerLabel(defaultAgentProvider)}）`,
      description: '创建对象',
      detail: '最快创建一个默认 provider 的 Agent 会话窗口',
      selectionId: 'create-agent-default',
      request: {
        kind: 'agent',
        agentProvider: defaultAgentProvider
      }
    });
  }
  if (creatableKinds.includes('terminal')) {
    directCreateItems.push({
      label: 'Terminal',
      description: '创建对象',
      detail: describeNodeKind('terminal'),
      selectionId: 'create-terminal',
      request: {
        kind: 'terminal'
      }
    });
  }
  if (creatableKinds.includes('note')) {
    directCreateItems.push({
      label: 'Note',
      description: '创建对象',
      detail: describeNodeKind('note'),
      selectionId: 'create-note',
      request: {
        kind: 'note'
      }
    });
  }

  if (directCreateItems.length > 0) {
    items.push({
      label: '创建对象',
      kind: vscode.QuickPickItemKind.Separator
    });
    items.push(...directCreateItems);
  }

  if (creatableKinds.includes('agent')) {
    items.push({
      label: '按类型创建 Agent',
      kind: vscode.QuickPickItemKind.Separator
    });
    for (const provider of ['codex', 'claude'] as const) {
      items.push({
        label: provider === defaultAgentProvider ? `${providerLabel(provider)}（默认）` : providerLabel(provider),
        description: '按类型创建 Agent',
        detail: `直接创建一个 ${providerLabel(provider)} 会话窗口`,
        selectionId: provider === 'claude' ? 'create-agent-claude' : 'create-agent-codex',
        request: {
          kind: 'agent',
          agentProvider: provider
        }
      });
    }
  }

  return items;
}

async function showQuickPickWithTestOverride<T extends CreateNodeQuickPickItem>(
  items: readonly T[],
  options: vscode.QuickPickOptions
): Promise<T | undefined> {
  if (queuedQuickPickSelectionIds.length > 0) {
    const selectionId = queuedQuickPickSelectionIds.shift();
    if (!selectionId) {
      return undefined;
    }

    const matchedItem = items.find((item) => item.selectionId === selectionId);
    if (!matchedItem) {
      throw new Error(`未找到测试 QuickPick 选择项：${selectionId}`);
    }

    return matchedItem;
  }

  return vscode.window.showQuickPick(items, options);
}

function getDefaultAgentProvider(): AgentProviderKind {
  const configuredProvider = vscode.workspace
    .getConfiguration()
    .get<string>(CONFIG_KEYS.agentDefaultProvider, 'codex');
  return configuredProvider === 'claude' ? 'claude' : 'codex';
}

function humanizeNodeKind(kind: CanvasCreatableNodeKind): string {
  switch (kind) {
    case 'agent':
      return 'Agent';
    case 'terminal':
      return 'Terminal';
    case 'note':
      return 'Note';
  }
}

function describeNodeKind(kind: CanvasCreatableNodeKind): string {
  switch (kind) {
    case 'agent':
      return '画布中的 Codex / Claude Code 会话窗口';
    case 'terminal':
      return '画布中的嵌入式终端窗口';
    case 'note':
      return '可编辑的笔记节点';
  }
}

function providerLabel(provider: AgentProviderKind): string {
  return provider === 'claude' ? 'Claude Code' : 'Codex';
}

async function updateCanvasFileFilterFromCommand(
  panelManager: CanvasPanelManager,
  kind: 'include' | 'exclude',
  value?: unknown
): Promise<void> {
  const providedGlobs = parseCanvasFileFilterCommandValue(value);
  if (providedGlobs) {
    panelManager.updateCanvasFileFilterState(kind, providedGlobs);
    return;
  }

  const currentState = panelManager.getCanvasFileFilterState();
  const currentGlobs = kind === 'include' ? currentState.includeGlobs : currentState.excludeGlobs;
  const input = await vscode.window.showInputBox({
    title: `${EXTENSION_DISPLAY_NAME}: 编辑文件 ${kind === 'include' ? 'Include' : 'Exclude'} 过滤`,
    prompt:
      kind === 'include'
        ? '按 VSCode 搜索视图的写法，用逗号分隔 glob；留空表示不过滤。该过滤只影响文件对象投影，不修改文件引用。'
        : '按 VSCode 搜索视图的写法，用逗号分隔 glob；留空表示不排除。该过滤只影响文件对象投影，不修改文件引用。',
    placeHolder: kind === 'include' ? '例如 src/**/*.ts, docs/**/*.md' : '例如 **/dist/**, **/*.snap',
    value: currentGlobs.join(', ')
  });
  if (input === undefined) {
    return;
  }

  panelManager.updateCanvasFileFilterState(kind, splitCanvasFileFilterInput(input));
}

function parseCanvasFileFilterCommandValue(value: unknown): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === 'string') {
    return splitCanvasFileFilterInput(value);
  }

  if (Array.isArray(value)) {
    return value
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }

  return undefined;
}

function splitCanvasFileFilterInput(value: string): string[] {
  return value
    .split(/[,\n，；;]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function registerTestCommands(context: vscode.ExtensionContext, panelManager: CanvasPanelManager): void {
  if (context.extensionMode !== vscode.ExtensionMode.Test) {
    return;
  }

  context.subscriptions.push(
    vscode.commands.registerCommand(TEST_COMMAND_IDS.getDebugState, () => panelManager.getDebugSnapshot()),
    vscode.commands.registerCommand(TEST_COMMAND_IDS.getRuntimeSupervisorState, () =>
      panelManager.getRuntimeSupervisorStateForTest()
    ),
    vscode.commands.registerCommand(TEST_COMMAND_IDS.getHostMessages, () => panelManager.getHostMessagesForTest()),
    vscode.commands.registerCommand(TEST_COMMAND_IDS.clearHostMessages, () => {
      panelManager.clearHostMessagesForTest();
    }),
    vscode.commands.registerCommand(TEST_COMMAND_IDS.getDiagnosticEvents, () => panelManager.getDiagnosticEventsForTest()),
    vscode.commands.registerCommand(TEST_COMMAND_IDS.clearDiagnosticEvents, () => {
      panelManager.clearDiagnosticEventsForTest();
    }),
    vscode.commands.registerCommand(
      TEST_COMMAND_IDS.locateCodexSessionId,
      async (cwd?: unknown, startedAtMs?: unknown, homeDir?: unknown, timeoutMs?: unknown) => {
        if (typeof cwd !== 'string' || cwd.trim().length === 0) {
          throw new Error('测试命令 devSessionCanvas.__test.locateCodexSessionId 需要有效的 cwd。');
        }
        if (typeof startedAtMs !== 'number' || !Number.isFinite(startedAtMs)) {
          throw new Error('测试命令 devSessionCanvas.__test.locateCodexSessionId 需要有效的 startedAtMs。');
        }

        const normalizedHomeDir = typeof homeDir === 'string' && homeDir.trim().length > 0 ? homeDir : undefined;
        const env = normalizedHomeDir
          ? {
              ...process.env,
              HOME: normalizedHomeDir,
              USERPROFILE: normalizedHomeDir
            }
          : process.env;

        return locateCodexSessionId({
          cwd,
          startedAtMs: Math.round(startedAtMs),
          timeoutMs: typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : undefined,
          env
        });
      }
    ),
    vscode.commands.registerCommand(
      TEST_COMMAND_IDS.getAgentCliResolutionCacheKey,
      (provider?: unknown, requestedCommand?: unknown, workspaceCwd?: unknown) => {
        if (provider !== 'codex' && provider !== 'claude') {
          throw new Error('测试命令 devSessionCanvas.__test.getAgentCliResolutionCacheKey 需要有效的 provider。');
        }
        if (typeof requestedCommand !== 'string' || requestedCommand.trim().length === 0) {
          throw new Error('测试命令 devSessionCanvas.__test.getAgentCliResolutionCacheKey 需要有效的 requestedCommand。');
        }

        return panelManager.getAgentCliResolutionCacheKeyForTest(
          provider,
          requestedCommand,
          typeof workspaceCwd === 'string' && workspaceCwd.trim().length > 0 ? workspaceCwd : undefined
        );
      }
    ),
    vscode.commands.registerCommand(TEST_COMMAND_IDS.waitForCanvasReady, async (surface?: unknown, timeoutMs?: unknown) =>
      panelManager.waitForCanvasReady(
        parseCanvasSurfaceLocation(surface),
        typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : 15000
      )
    ),
    vscode.commands.registerCommand(
      TEST_COMMAND_IDS.captureWebviewProbe,
      async (surface?: unknown, timeoutMs?: unknown, delayMs?: unknown) =>
        panelManager.captureWebviewProbeForTest(
          parseCanvasSurfaceLocation(surface),
          typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : 5000,
          typeof delayMs === 'number' && delayMs >= 0 ? delayMs : 0
        )
    ),
    vscode.commands.registerCommand(
      TEST_COMMAND_IDS.performWebviewDomAction,
      async (action?: unknown, surface?: unknown, timeoutMs?: unknown) => {
        if (!isWebviewDomAction(action)) {
          throw new Error('测试命令 devSessionCanvas.__test.performWebviewDomAction 需要有效的 DOM 动作。');
        }

        return panelManager.performWebviewDomActionForTest(
          action,
          parseCanvasSurfaceLocation(surface),
          typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : 5000
        );
      }
    ),
    vscode.commands.registerCommand(TEST_COMMAND_IDS.setPersistedState, (rawState?: unknown) =>
      panelManager.setPersistedStateForTest(rawState)
    ),
    vscode.commands.registerCommand(TEST_COMMAND_IDS.reloadPersistedState, () => panelManager.reloadPersistedStateForTest()),
    vscode.commands.registerCommand(TEST_COMMAND_IDS.flushPersistedState, () =>
      panelManager.flushPersistedCanvasStateForTest()
    ),
    vscode.commands.registerCommand(TEST_COMMAND_IDS.simulateRuntimeReload, () =>
      panelManager.simulateRuntimeReloadForTest()
    ),
    vscode.commands.registerCommand(
      TEST_COMMAND_IDS.dispatchWebviewMessage,
      (message?: unknown, surface?: unknown) =>
        panelManager.dispatchWebviewMessageForTest(message, parseCanvasSurfaceLocation(surface))
    ),
    vscode.commands.registerCommand(
      TEST_COMMAND_IDS.startExecutionSession,
      async (
        kind?: unknown,
        nodeId?: unknown,
        cols?: unknown,
        rows?: unknown,
        provider?: unknown,
        resumeRequested?: unknown
      ) => {
        if (kind !== 'agent' && kind !== 'terminal') {
          throw new Error('测试命令 devSessionCanvas.__test.startExecutionSession 需要有效的执行节点类型。');
        }
        if (typeof nodeId !== 'string' || !nodeId) {
          throw new Error('测试命令 devSessionCanvas.__test.startExecutionSession 需要有效的节点 ID。');
        }

        return panelManager.startExecutionSessionForTest({
          kind,
          nodeId,
          cols: typeof cols === 'number' ? cols : undefined,
          rows: typeof rows === 'number' ? rows : undefined,
          provider: provider === 'codex' || provider === 'claude' ? provider : undefined,
          resumeRequested: resumeRequested === true
        });
      }
    ),
    vscode.commands.registerCommand(TEST_COMMAND_IDS.setQuickPickSelections, (selectionIds?: unknown) => {
      if (
        !Array.isArray(selectionIds) ||
        selectionIds.some(
          (value) =>
            value !== 'create-agent-default' &&
            value !== 'create-terminal' &&
            value !== 'create-note' &&
            value !== 'create-agent-codex' &&
            value !== 'create-agent-claude'
        )
      ) {
        throw new Error('测试命令 devSessionCanvas.__test.setQuickPickSelections 需要有效的 QuickPick 选择 ID 数组。');
      }

      queuedQuickPickSelectionIds = selectionIds.slice() as CreateNodeQuickPickSelectionId[];
      return queuedQuickPickSelectionIds.slice();
    }),
    vscode.commands.registerCommand(TEST_COMMAND_IDS.createNode, (kind?: unknown, agentProvider?: unknown) => {
      if (!isCanvasCreatableNodeKind(kind)) {
        throw new Error('测试命令 devSessionCanvas.__test.createNode 需要有效的节点类型。');
      }

      panelManager.createNodeForTest(kind, undefined, {
        agentProvider: isAgentProviderKind(agentProvider) ? agentProvider : undefined
      });
      return panelManager.getDebugSnapshot();
    }),
    vscode.commands.registerCommand(TEST_COMMAND_IDS.resetState, async () => {
      await panelManager.resetState();
      return panelManager.getDebugSnapshot();
    })
  );
}

function parseCanvasSurfaceLocation(value: unknown): CanvasSurfaceLocation | undefined {
  return value === 'editor' || value === 'panel' ? value : undefined;
}
