import * as vscode from 'vscode';

import {
  extractClaudeResumeSessionId,
  extractCodexResumeSessionId,
  locateClaudeSessionId,
  locateCodexSessionId
} from './common/codexSessionIdLocator';
import { COMMAND_IDS, CONFIG_KEYS, EXTENSION_DISPLAY_NAME, TEST_COMMAND_IDS, VIEW_IDS } from './common/extensionIdentity';
import {
  isAgentProviderKind,
  isCanvasCreatableNodeKind,
  isWebviewDomAction,
  type AgentLaunchPresetKind,
  type AgentProviderKind,
  type AgentProviderLaunchDefaults,
  type CanvasCreatableNodeKind,
  type CanvasNodeKind
} from './common/protocol';
import {
  buildAgentPresetCommandLine,
  classifyAgentLaunchPreset,
  validateAgentCommandLine
} from './common/agentLaunchPresets';
import { CanvasPanelManager, type CanvasSurfaceLocation } from './panel/CanvasPanelManager';
import { CanvasSidebarActionsView } from './sidebar/CanvasSidebarActionsView';
import {
  CanvasSidebarNodeListView,
  getCanvasSidebarNodeListItems,
  isSidebarNodeListTestAction
} from './sidebar/CanvasSidebarNodeListView';
import {
  CanvasSidebarSessionHistoryView,
  isSidebarSessionHistoryTestAction
} from './sidebar/CanvasSidebarSessionHistoryView';
import { CanvasSidebarView, getCanvasSidebarSummaryItems } from './sidebar/CanvasSidebarView';

let activePanelManager: CanvasPanelManager | undefined;
let queuedQuickPickSelectionIds: CreateNodeQuickPickSelectionId[] = [];

type CreateNodeRequest = {
  kind: CanvasCreatableNodeKind;
  agentProvider?: AgentProviderKind;
  agentLaunchPreset?: AgentLaunchPresetKind;
  agentCustomLaunchCommand?: string;
};

type CreateNodeQuickPickSelectionId =
  | 'create-agent-default'
  | 'create-terminal'
  | 'create-note'
  | 'create-agent-codex'
  | 'create-agent-claude'
  | 'agent-launch-accept-current'
  | 'agent-launch-apply-default'
  | 'agent-launch-apply-resume'
  | 'agent-launch-apply-yolo'
  | 'agent-launch-apply-sandbox';

interface CreateNodeQuickPickItem extends vscode.QuickPickItem {
  selectionId?: CreateNodeQuickPickSelectionId;
  request?: CreateNodeRequest;
}

export function activate(context: vscode.ExtensionContext): void {
  const panelManager = new CanvasPanelManager(context);
  activePanelManager = panelManager;
  const sidebarSummaryView = new CanvasSidebarView(panelManager);
  const sidebarActionsView = new CanvasSidebarActionsView(panelManager);
  const sidebarNodeListView = new CanvasSidebarNodeListView(panelManager);
  const sidebarSessionHistoryView = new CanvasSidebarSessionHistoryView(panelManager);

  registerCommand(context, COMMAND_IDS.dumpHostDiagnostics, async () => {
    const dumpResult = await panelManager.dumpCurrentHostDiagnostics();
    const revealAction = '在资源管理器中显示';
    const selection = await vscode.window.showInformationMessage(
      `当前宿主诊断已写入 ${dumpResult.outputDir}`,
      revealAction
    );
    if (selection === revealAction) {
      await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(dumpResult.summaryPath));
    }
  });

  context.subscriptions.push(
    sidebarSummaryView,
    sidebarActionsView,
    sidebarNodeListView,
    sidebarSessionHistoryView,
    vscode.window.registerTreeDataProvider(VIEW_IDS.sidebarTree, sidebarSummaryView),
    vscode.window.registerWebviewViewProvider(VIEW_IDS.sidebarFilters, sidebarActionsView, {
      webviewOptions: {
        retainContextWhenHidden: true
      }
    }),
    vscode.window.registerWebviewViewProvider(VIEW_IDS.sidebarNodes, sidebarNodeListView, {
      webviewOptions: {
        retainContextWhenHidden: true
      }
    }),
    vscode.window.registerWebviewViewProvider(VIEW_IDS.sidebarSessions, sidebarSessionHistoryView, {
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
      agentProvider: createRequest.agentProvider,
      agentLaunchPreset: createRequest.agentLaunchPreset,
      agentCustomLaunchCommand: createRequest.agentCustomLaunchCommand
    });
  });

  registerCommand(context, COMMAND_IDS.showNodeList, async () => {
    await showSidebarNodeListQuickPick(panelManager);
  });

  registerCommand(context, COMMAND_IDS.showSessionHistory, async () => {
    await showSessionHistoryQuickPick(sidebarSessionHistoryView, panelManager);
  });

  registerCommand(context, COMMAND_IDS.refreshSessionHistory, async () => {
    await sidebarSessionHistoryView.refresh();
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
    vscode.commands.registerCommand(COMMAND_IDS.focusSidebarNode, async (nodeId?: unknown) => {
      if (typeof nodeId !== 'string' || nodeId.trim().length === 0) {
        return;
      }

      const focused = await panelManager.focusNodeById(nodeId);
      if (!focused) {
        await vscode.window.showWarningMessage('目标节点已不存在，或当前无法定位到画布中的该节点。');
      }
    }),
    vscode.commands.registerCommand(
      COMMAND_IDS.restoreSidebarSessionHistoryEntry,
      async (provider?: unknown, sessionId?: unknown, title?: unknown) => {
        if (!isAgentProviderKind(provider) || typeof sessionId !== 'string' || sessionId.trim().length === 0) {
          return;
        }

        const result = await panelManager.restoreAgentSessionFromHistory({
          provider,
          sessionId,
          title: typeof title === 'string' ? title : undefined
        });
        if (!result.restored && result.errorMessage) {
          await vscode.window.showWarningMessage(result.errorMessage);
        }
      }
    ),
    vscode.commands.registerCommand(COMMAND_IDS.editFileIncludeFilter, async (value?: unknown) => {
      await updateCanvasFileFilterFromCommand(panelManager, 'include', value);
    }),
    vscode.commands.registerCommand(COMMAND_IDS.editFileExcludeFilter, async (value?: unknown) => {
      await updateCanvasFileFilterFromCommand(panelManager, 'exclude', value);
    }),
    vscode.commands.registerCommand(COMMAND_IDS.clearFileIncludeFilter, async () => {
      if (!(await ensureFilesFeatureEnabled(panelManager))) {
        return;
      }
      panelManager.updateCanvasFileFilterState('include', []);
    }),
    vscode.commands.registerCommand(COMMAND_IDS.clearFileExcludeFilter, async () => {
      if (!(await ensureFilesFeatureEnabled(panelManager))) {
        return;
      }
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

  registerTestCommands(context, panelManager, sidebarNodeListView, sidebarSessionHistoryView);
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
  while (true) {
    const picked = await showQuickPickWithTestOverride(
      buildCreateNodeQuickPickItems(creatableKinds, getDefaultAgentProvider()),
      {
        placeHolder: '选择要创建的对象或 Agent 类型'
      }
    );

    if (!picked?.request) {
      return undefined;
    }

    if (picked.request.kind !== 'agent') {
      return picked.request;
    }

    const launchRequest = await promptAgentLaunchRequest(picked.request.agentProvider ?? getDefaultAgentProvider());
    if (!launchRequest) {
      return undefined;
    }
    if (launchRequest === 'back') {
      continue;
    }
    return launchRequest;
  }
}

interface SidebarNodeQuickPickItem extends vscode.QuickPickItem {
  nodeId: string;
}

interface SidebarSessionQuickPickItem extends vscode.QuickPickItem {
  provider: AgentProviderKind;
  sessionId: string;
  titleOverride?: string;
}

async function showSidebarNodeListQuickPick(panelManager: CanvasPanelManager): Promise<void> {
  const items = getCanvasSidebarNodeListItems(panelManager.getCanvasNodes());
  if (items.length === 0) {
    await vscode.window.showInformationMessage('当前画布还没有可定位的非文件节点。');
    return;
  }

  const picked = await vscode.window.showQuickPick<SidebarNodeQuickPickItem>(
    items.map((item) => ({
      label: item.label,
      description: item.description,
      detail: item.tooltip.replace(/\n/g, ' · '),
      nodeId: item.nodeId
    })),
    {
      placeHolder: '选择一个节点并定位到画布'
    }
  );
  if (!picked) {
    return;
  }

  const focused = await panelManager.focusNodeById(picked.nodeId);
  if (!focused) {
    await vscode.window.showWarningMessage('目标节点已不存在，或当前无法定位到画布中的该节点。');
  }
}

async function showSessionHistoryQuickPick(
  sidebarSessionHistoryView: CanvasSidebarSessionHistoryView,
  panelManager: CanvasPanelManager
): Promise<void> {
  const restoreBlockReason = panelManager.getSessionHistoryRestoreBlockReason();
  if (restoreBlockReason) {
    await vscode.window.showWarningMessage(restoreBlockReason);
    return;
  }

  const items = await sidebarSessionHistoryView.getSessionHistoryItems();
  if (items.length === 0) {
    await vscode.window.showInformationMessage('当前 workspace 还没有可恢复的 Codex / Claude Code 会话。');
    return;
  }

  const picked = await vscode.window.showQuickPick<SidebarSessionQuickPickItem>(
    items.map((item) => ({
      label: item.title,
      description: `${item.providerLabel} · ${item.sessionId}`,
      detail: item.tooltip.replace(/\n/g, ' · '),
      provider: item.provider,
      sessionId: item.sessionId,
      titleOverride: item.title
    })),
    {
      placeHolder: '选择一条历史会话并恢复为新节点',
      matchOnDescription: true,
      matchOnDetail: true
    }
  );
  if (!picked) {
    return;
  }

  const result = await panelManager.restoreAgentSessionFromHistory({
    provider: picked.provider,
    sessionId: picked.sessionId,
    title: picked.titleOverride
  });
  if (!result.restored && result.errorMessage) {
    await vscode.window.showWarningMessage(result.errorMessage);
  }
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
      detail: '下一步确认完整启动命令，并按默认 provider 创建 Agent',
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
        detail: `下一步确认完整启动命令，并创建一个 ${providerLabel(provider)} 会话窗口`,
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

interface AgentLaunchQuickPickItem extends vscode.QuickPickItem {
  selectionId?: CreateNodeQuickPickSelectionId;
  launchPreset?: Exclude<AgentLaunchPresetKind, 'custom'>;
}

async function promptAgentLaunchRequest(
  provider: AgentProviderKind
): Promise<CreateNodeRequest | 'back' | undefined> {
  const launchDefaults = getAgentLaunchDefaults(provider);
  let presetCommandLines: Record<Exclude<AgentLaunchPresetKind, 'custom'>, string>;
  try {
    presetCommandLines = buildAgentLaunchPresetCommandLines(provider, launchDefaults);
  } catch (error) {
    await vscode.window.showErrorMessage(
      error instanceof Error ? error.message : `无法读取 ${providerLabel(provider)} 默认启动参数。`
    );
    return undefined;
  }

  const scriptedResult = consumeQueuedAgentLaunchRequest(provider, launchDefaults, presetCommandLines);
  if (scriptedResult !== null) {
    return scriptedResult;
  }

  return promptAgentLaunchRequestWithQuickPick(provider, launchDefaults, presetCommandLines);
}

function consumeQueuedAgentLaunchRequest(
  provider: AgentProviderKind,
  launchDefaults: AgentProviderLaunchDefaults,
  presetCommandLines: Record<Exclude<AgentLaunchPresetKind, 'custom'>, string>
): CreateNodeRequest | 'back' | undefined | null {
  if (queuedQuickPickSelectionIds.length === 0) {
    return null;
  }

  let commandLine = presetCommandLines.default;
  while (queuedQuickPickSelectionIds.length > 0) {
    const nextSelectionId = queuedQuickPickSelectionIds[0];
    if (!nextSelectionId?.startsWith('agent-launch-')) {
      break;
    }

    queuedQuickPickSelectionIds.shift();
    if (nextSelectionId === 'agent-launch-accept-current') {
      return createAgentRequestFromCommandLine(provider, launchDefaults, commandLine);
    }
    if (nextSelectionId === 'agent-launch-apply-default') {
      commandLine = presetCommandLines.default;
      continue;
    }
    if (nextSelectionId === 'agent-launch-apply-resume') {
      commandLine = presetCommandLines.resume;
      continue;
    }
    if (nextSelectionId === 'agent-launch-apply-yolo') {
      commandLine = presetCommandLines.yolo;
      continue;
    }
    if (nextSelectionId === 'agent-launch-apply-sandbox') {
      commandLine = presetCommandLines.sandbox;
      continue;
    }
  }

  return undefined;
}

function promptAgentLaunchRequestWithQuickPick(
  provider: AgentProviderKind,
  launchDefaults: AgentProviderLaunchDefaults,
  presetCommandLines: Record<Exclude<AgentLaunchPresetKind, 'custom'>, string>
): Promise<CreateNodeRequest | 'back' | undefined> {
  return new Promise((resolve) => {
    const quickPick = vscode.window.createQuickPick<AgentLaunchQuickPickItem>();
    const baseTitle = `配置 ${providerLabel(provider)} 启动命令`;
    let resolved = false;
    let suppressNextAcceptAfterPresetSelection = false;
    let presetSelectionAcceptResetTimer: ReturnType<typeof setTimeout> | undefined;

    const finish = (result: CreateNodeRequest | 'back' | undefined): void => {
      if (resolved) {
        return;
      }
      resolved = true;
      if (presetSelectionAcceptResetTimer) {
        clearTimeout(presetSelectionAcceptResetTimer);
      }
      quickPick.hide();
      quickPick.dispose();
      resolve(result);
    };

    const armPresetSelectionAcceptSuppression = (): void => {
      suppressNextAcceptAfterPresetSelection = true;
      if (presetSelectionAcceptResetTimer) {
        clearTimeout(presetSelectionAcceptResetTimer);
      }
      // VS Code may emit onDidAccept immediately after a mouse-click selection.
      presetSelectionAcceptResetTimer = setTimeout(() => {
        suppressNextAcceptAfterPresetSelection = false;
        presetSelectionAcceptResetTimer = undefined;
      }, 0);
    };

    const updateTitle = (): void => {
      const validation = validateAgentCommandLine(quickPick.value, provider, launchDefaults);
      quickPick.title = validation.valid ? baseTitle : `${baseTitle} · ${validation.error}`;
    };

    quickPick.title = baseTitle;
    quickPick.placeholder = '编辑本次创建将使用的完整启动命令；按 Enter 直接创建';
    quickPick.matchOnDescription = true;
    quickPick.matchOnDetail = true;
    quickPick.value = presetCommandLines.default;
    quickPick.items = buildAgentLaunchQuickPickItems(presetCommandLines);
    quickPick.buttons = [vscode.QuickInputButtons.Back];
    quickPick.ignoreFocusOut = true;

    quickPick.onDidChangeSelection((items) => {
      const selectedItem = items[0];
      if (!selectedItem?.launchPreset) {
        return;
      }
      quickPick.value = presetCommandLines[selectedItem.launchPreset];
      quickPick.activeItems = [];
      armPresetSelectionAcceptSuppression();
      updateTitle();
    });

    quickPick.onDidChangeValue(() => {
      updateTitle();
    });

    quickPick.onDidAccept(() => {
      const activeItem = quickPick.activeItems[0];
      if (activeItem?.launchPreset) {
        quickPick.value = presetCommandLines[activeItem.launchPreset];
        quickPick.activeItems = [];
        updateTitle();
        return;
      }

      if (suppressNextAcceptAfterPresetSelection) {
        return;
      }

      const validation = validateAgentCommandLine(quickPick.value, provider, launchDefaults);
      if (!validation.valid) {
        updateTitle();
        return;
      }

      finish(createAgentRequestFromCommandLine(provider, launchDefaults, quickPick.value));
    });

    quickPick.onDidTriggerButton((button) => {
      if (button === vscode.QuickInputButtons.Back) {
        finish('back');
      }
    });

    quickPick.onDidHide(() => {
      finish(undefined);
    });

    updateTitle();
    quickPick.show();
    quickPick.activeItems = [];
  });
}

function buildAgentLaunchQuickPickItems(
  presetCommandLines: Record<Exclude<AgentLaunchPresetKind, 'custom'>, string>
): AgentLaunchQuickPickItem[] {
  return [
    {
      label: '启动方式快捷替换',
      kind: vscode.QuickPickItemKind.Separator,
      alwaysShow: true
    },
    {
      label: '默认',
      detail: presetCommandLines.default,
      selectionId: 'agent-launch-apply-default',
      launchPreset: 'default',
      alwaysShow: true
    },
    {
      label: 'Resume',
      detail: presetCommandLines.resume,
      selectionId: 'agent-launch-apply-resume',
      launchPreset: 'resume',
      alwaysShow: true
    },
    {
      label: 'YOLO',
      detail: presetCommandLines.yolo,
      selectionId: 'agent-launch-apply-yolo',
      launchPreset: 'yolo',
      alwaysShow: true
    },
    {
      label: '沙盒',
      detail: presetCommandLines.sandbox,
      selectionId: 'agent-launch-apply-sandbox',
      launchPreset: 'sandbox',
      alwaysShow: true
    }
  ];
}

function buildAgentLaunchPresetCommandLines(
  provider: AgentProviderKind,
  launchDefaults: AgentProviderLaunchDefaults
): Record<Exclude<AgentLaunchPresetKind, 'custom'>, string> {
  return {
    default: buildAgentPresetCommandLine(provider, launchDefaults, 'default'),
    resume: buildAgentPresetCommandLine(provider, launchDefaults, 'resume'),
    yolo: buildAgentPresetCommandLine(provider, launchDefaults, 'yolo'),
    sandbox: buildAgentPresetCommandLine(provider, launchDefaults, 'sandbox')
  };
}

function createAgentRequestFromCommandLine(
  provider: AgentProviderKind,
  launchDefaults: AgentProviderLaunchDefaults,
  commandLine: string
): CreateNodeRequest {
  const classification = classifyAgentLaunchPreset(provider, commandLine, launchDefaults);
  return {
    kind: 'agent',
    agentProvider: provider,
    agentLaunchPreset: classification.launchPreset,
    agentCustomLaunchCommand: classification.customLaunchCommand
  };
}

async function showQuickPickWithTestOverride<T extends vscode.QuickPickItem & { selectionId?: CreateNodeQuickPickSelectionId }>(
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

function getAgentLaunchDefaults(provider: AgentProviderKind): AgentProviderLaunchDefaults {
  const configuration = vscode.workspace.getConfiguration();
  const configuredCommand = configuration
    .get<string>(provider === 'claude' ? CONFIG_KEYS.agentClaudeCommand : CONFIG_KEYS.agentCodexCommand, provider)
    ?.trim();
  const configuredDefaultArgs = configuration
    .get<string>(
      provider === 'claude' ? CONFIG_KEYS.agentClaudeDefaultArgs : CONFIG_KEYS.agentCodexDefaultArgs,
      ''
    )
    ?.trim();

  const testOverrideCommand =
    provider === 'claude'
      ? process.env.DEV_SESSION_CANVAS_TEST_CLAUDE_COMMAND?.trim()
      : process.env.DEV_SESSION_CANVAS_TEST_CODEX_COMMAND?.trim();

  return {
    command: testOverrideCommand || configuredCommand || provider,
    defaultArgs: configuredDefaultArgs || ''
  };
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
  if (!(await ensureFilesFeatureEnabled(panelManager))) {
    return;
  }

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

async function ensureFilesFeatureEnabled(panelManager: CanvasPanelManager): Promise<boolean> {
  if (panelManager.isFilesFeatureEnabled()) {
    return true;
  }

  await vscode.window.showInformationMessage(
    '文件功能当前已关闭；重新加载窗口并启用 `devSessionCanvas.files.enabled` 后才能使用文件活动与文件过滤。'
  );
  return false;
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

function registerTestCommands(
  context: vscode.ExtensionContext,
  panelManager: CanvasPanelManager,
  sidebarNodeListView: CanvasSidebarNodeListView,
  sidebarSessionHistoryView: CanvasSidebarSessionHistoryView
): void {
  if (context.extensionMode !== vscode.ExtensionMode.Test) {
    return;
  }

  context.subscriptions.push(
    vscode.commands.registerCommand(TEST_COMMAND_IDS.getDebugState, () => panelManager.getDebugSnapshot()),
    vscode.commands.registerCommand(TEST_COMMAND_IDS.getSidebarSummaryItems, () =>
      getCanvasSidebarSummaryItems(panelManager.getSidebarState())
    ),
    vscode.commands.registerCommand(TEST_COMMAND_IDS.getSidebarNodeListItems, () =>
      getCanvasSidebarNodeListItems(panelManager.getCanvasNodes())
    ),
    vscode.commands.registerCommand(
      TEST_COMMAND_IDS.getSidebarSessionHistoryItems,
      async (homeDir?: unknown) =>
        sidebarSessionHistoryView.getSessionHistoryItems({
          homeDir: typeof homeDir === 'string' && homeDir.trim().length > 0 ? homeDir : undefined
        })
    ),
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
      TEST_COMMAND_IDS.locateClaudeSessionId,
      async (cwd?: unknown, sessionId?: unknown, homeDir?: unknown, timeoutMs?: unknown) => {
        if (typeof cwd !== 'string' || cwd.trim().length === 0) {
          throw new Error('测试命令 devSessionCanvas.__test.locateClaudeSessionId 需要有效的 cwd。');
        }
        if (typeof sessionId !== 'string' || sessionId.trim().length === 0) {
          throw new Error('测试命令 devSessionCanvas.__test.locateClaudeSessionId 需要有效的 sessionId。');
        }

        const normalizedHomeDir = typeof homeDir === 'string' && homeDir.trim().length > 0 ? homeDir : undefined;
        const env = normalizedHomeDir
          ? {
              ...process.env,
              HOME: normalizedHomeDir,
              USERPROFILE: normalizedHomeDir
            }
          : process.env;

        return locateClaudeSessionId({
          cwd,
          sessionId,
          timeoutMs: typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : undefined,
          env
        });
      }
    ),
    vscode.commands.registerCommand(TEST_COMMAND_IDS.extractCodexResumeSessionId, (output?: unknown) => {
      if (typeof output !== 'string') {
        throw new Error('测试命令 devSessionCanvas.__test.extractCodexResumeSessionId 需要有效的输出字符串。');
      }

      return extractCodexResumeSessionId(output);
    }),
    vscode.commands.registerCommand(TEST_COMMAND_IDS.extractClaudeResumeSessionId, (output?: unknown) => {
      if (typeof output !== 'string') {
        throw new Error('测试命令 devSessionCanvas.__test.extractClaudeResumeSessionId 需要有效的输出字符串。');
      }

      return extractClaudeResumeSessionId(output);
    }),
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
    vscode.commands.registerCommand(
      TEST_COMMAND_IDS.performSidebarNodeListAction,
      async (action?: unknown, timeoutMs?: unknown) => {
        if (!isSidebarNodeListTestAction(action)) {
          throw new Error('测试命令 devSessionCanvas.__test.performSidebarNodeListAction 需要有效的侧栏 DOM 动作。');
        }

        const normalizedTimeoutMs = typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : 5000;
        await vscode.commands.executeCommand(`workbench.view.extension.${VIEW_IDS.activityBarContainer}`);
        await vscode.commands.executeCommand(`${VIEW_IDS.sidebarNodes}.focus`);
        await sidebarNodeListView.waitForReady(normalizedTimeoutMs);
        return sidebarNodeListView.performTestAction(action, normalizedTimeoutMs);
      }
    ),
    vscode.commands.registerCommand(
      TEST_COMMAND_IDS.performSidebarSessionHistoryAction,
      async (action?: unknown, timeoutMs?: unknown) => {
        if (!isSidebarSessionHistoryTestAction(action)) {
          throw new Error('测试命令 devSessionCanvas.__test.performSidebarSessionHistoryAction 需要有效的侧栏 DOM 动作。');
        }

        const normalizedTimeoutMs = typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : 5000;
        await vscode.commands.executeCommand(`workbench.view.extension.${VIEW_IDS.activityBarContainer}`);
        await vscode.commands.executeCommand(`${VIEW_IDS.sidebarSessions}.focus`);
        await sidebarSessionHistoryView.waitForReady(normalizedTimeoutMs);
        return sidebarSessionHistoryView.performTestAction(action, normalizedTimeoutMs);
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
            value !== 'create-agent-claude' &&
            value !== 'agent-launch-accept-current' &&
            value !== 'agent-launch-apply-default' &&
            value !== 'agent-launch-apply-resume' &&
            value !== 'agent-launch-apply-yolo' &&
            value !== 'agent-launch-apply-sandbox'
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
