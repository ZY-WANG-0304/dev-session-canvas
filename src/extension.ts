import * as path from 'path';
import { execFile } from 'child_process';
import { mkdir, realpath, stat } from 'fs/promises';
import { promisify } from 'util';
import * as vscode from 'vscode';

import {
  extractClaudeResumeSessionId,
  extractCodexResumeSessionId,
  locateClaudeSessionId,
  locateCodexSessionId
} from './common/codexSessionIdLocator';
import { COMMAND_IDS, CONFIG_KEYS, EXTENSION_DISPLAY_NAME, TEST_COMMAND_IDS, VIEW_IDS } from './common/extensionIdentity';
import {
  isAgentLaunchPresetKind,
  isAgentProviderKind,
  isCanvasCreatableNodeKind,
  isWebviewDomAction,
  type AgentLaunchPresetKind,
  type AgentProviderKind,
  type AgentProviderLaunchDefaults,
  type CanvasCreatableNodeKind,
  type CanvasNodeKind,
  type CanvasNodeSummary
} from './common/protocol';
import { isSupportedNoteMarkdownFilePath } from './common/noteMarkdownFileAssociation';
import {
  buildAgentPresetCommandLine,
  classifyAgentLaunchPreset,
  matchesAgentCommandLinePreset,
  validateAgentCommandLine
} from './common/agentLaunchPresets';
import {
  formatCanvasTemplateStats,
  sanitizeCanvasTemplateFileStem
} from './common/canvasTemplates';
import { CanvasPanelManager, type CanvasSurfaceLocation } from './panel/CanvasPanelManager';
import { showCanvasTemplateSaveForm } from './panel/CanvasTemplateSaveFormPanel';
import type { CanvasStoredTemplate } from './panel/CanvasTemplateStore';
import { getConfiguredTerminalShell, getEffectiveTerminalShellConfiguration } from './panel/configuration';
import {
  discoverAgentCliCandidates,
  getAgentCliDefaultCommand,
  getAgentCliDisplayName,
  getAgentCliInstallationInfo,
  shouldOfferAgentCliInstallation,
  type AgentCliCandidate,
  type AgentCliCandidateSource
} from './panel/agentCliSelection';
import {
  createRestrictedLocalAgentSettingsFile,
  getAgentSettingsFileDescriptor,
  getLocalAgentSettingsFileStatus,
  isNodeFileAlreadyExistsError,
  resolveAgentSettingsFilePath,
  type AgentSettingsFileDescriptor,
  type AgentSettingsFileKind
} from './panel/agentSettingsFiles';
import { buildPersistedTerminalShellSelection, detectAvailableTerminalShells } from './panel/terminalShellConfiguration';
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
import { CanvasSidebarTemplateView } from './sidebar/CanvasSidebarTemplateView';
import { CanvasSidebarView, getCanvasSidebarSummaryItems } from './sidebar/CanvasSidebarView';
import { isTestHarnessMode } from './common/testHarness';

const execFileAsync = promisify(execFile);

let activePanelManager: CanvasPanelManager | undefined;
let queuedQuickPickSelectionIds: CreateNodeQuickPickSelectionId[] = [];

const WORKTREE_BRANCH_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const GIT_WORKTREE_COMMAND_TIMEOUT_MS = 120_000;
const GIT_COMMAND_MAX_BUFFER_BYTES = 1024 * 1024;

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

type WebviewLifecycleDumpStatus =
  | 'healthy'
  | 'standby'
  | 'initializing'
  | 'attention'
  | 'blocked'
  | 'not-attached';

interface CreateNodeQuickPickItem extends vscode.QuickPickItem {
  selectionId?: CreateNodeQuickPickSelectionId;
  request?: CreateNodeRequest;
}

interface TerminalShellQuickPickItem extends vscode.QuickPickItem {
  resolvedPath?: string;
  shellName?: string;
  useDefault?: boolean;
}

interface AgentCliQuickPickItem extends vscode.QuickPickItem {
  command?: string;
  manualInput?: boolean;
  install?: boolean;
}

interface AgentCliInstallQuickPickItem extends vscode.QuickPickItem {
  installMethod: 'command-line' | 'vscode-extension';
}

interface CanvasTemplateQuickPickItem extends vscode.QuickPickItem {
  templateId: string;
}

interface ExplorerExecutionResource {
  cwd: string;
  cwdUri: vscode.Uri;
  resourceKind: 'directory' | 'file-parent';
  workspaceFolder: vscode.WorkspaceFolder;
}

interface ExplorerMarkdownNoteResource {
  uri: vscode.Uri;
}

interface WorkspaceRootQuickPickItem extends vscode.QuickPickItem {
  folder: vscode.WorkspaceFolder;
}

interface WorkspaceWorktreeRequest {
  rootPath?: string;
}

type WorktreeUnavailableReasonCode =
  | 'workspace-untrusted'
  | 'not-file-root'
  | 'not-git-repository'
  | 'no-git-refs'
  | 'not-linked-worktree'
  | 'git-unavailable'
  | 'unknown';

interface WorkspaceWorktreeTarget {
  rootFolder: vscode.WorkspaceFolder;
  branchName?: string;
  checkoutRef?: string;
  startPoint?: string;
  detached?: boolean;
  displayName: string;
  targetPath: string;
}

interface GitWorktreeRef {
  name: string;
  shortSha: string;
  relativeDate?: string;
  author?: string;
  subject?: string;
  kind: 'head' | 'localBranch';
  worktreePath?: string;
  isCurrentWorktree: boolean;
  isCheckedOutInWorktree: boolean;
}

interface GitWorktreeRepositoryInfo {
  rootPath: string;
  topLevelPath: string;
  gitCommonDir: string;
  isLinkedWorktree: boolean;
}

interface WorktreeCreationPlan {
  kind: 'newBranch' | 'existingRef';
  branchName?: string;
  startPoint?: string;
  checkoutRef?: string;
  detached?: boolean;
  defaultPathName: string;
  displayName: string;
}

interface WorktreeActionQuickPickItem extends vscode.QuickPickItem {
  type: 'createNewBranch' | 'createNewBranchFrom';
}

interface WorktreeRefQuickPickItem extends vscode.QuickPickItem {
  type: 'ref';
  ref: GitWorktreeRef;
}

type WorktreeQuickPickItem = WorktreeActionQuickPickItem | WorktreeRefQuickPickItem;

function resolveTerminalShellConfigurationTarget(): vscode.ConfigurationTarget {
  return vscode.workspace.workspaceFile || (vscode.workspace.workspaceFolders?.length ?? 0) > 0
    ? vscode.ConfigurationTarget.Workspace
    : vscode.ConfigurationTarget.Global;
}

function describeTerminalShellConfigurationTarget(target: vscode.ConfigurationTarget): string {
  return target === vscode.ConfigurationTarget.Workspace ? '当前 workspace' : '当前设备';
}

export function activate(context: vscode.ExtensionContext): void {
  const panelManager = new CanvasPanelManager(context);
  activePanelManager = panelManager;
  const sidebarSummaryView = new CanvasSidebarView(panelManager);
  const sidebarActionsView = new CanvasSidebarActionsView(panelManager);
  const sidebarTemplateView = new CanvasSidebarTemplateView(panelManager, context.extensionUri);
  const sidebarNodeListView = new CanvasSidebarNodeListView(panelManager, context.extensionUri, context.workspaceState);
  const sidebarSessionHistoryView = new CanvasSidebarSessionHistoryView(
    panelManager,
    context.extensionUri,
    context.workspaceState
  );

  registerCommand(context, COMMAND_IDS.dumpHostDiagnostics, async () => {
    const dumpResult = await panelManager.dumpCurrentHostDiagnostics();
    const revealAction = '在资源管理器中显示';
    const openLifecycleSummaryAction = '打开 lifecycle 摘要';
    const openPerformanceDiagnosticsAction = '打开性能诊断';
    const lifecycleStatus = formatWebviewLifecycleDumpStatus(dumpResult.webviewLifecycleStatus);
    const panelRestoreHint = dumpResult.webviewLifecyclePanelRestoreLikelyAffected
      ? '；Panel restore 可能仍受 lifecycle 阻塞'
      : '';
    const selection = await vscode.window.showInformationMessage(
      `当前宿主诊断已写入 ${dumpResult.outputDir}。Webview lifecycle：${lifecycleStatus}${panelRestoreHint}`,
      openLifecycleSummaryAction,
      openPerformanceDiagnosticsAction,
      revealAction
    );
    if (selection === openLifecycleSummaryAction) {
      await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(dumpResult.webviewLifecycleSummaryPath));
    } else if (selection === openPerformanceDiagnosticsAction) {
      await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(dumpResult.executionPerformanceDiagnosticsPath));
    } else if (selection === revealAction) {
      await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(dumpResult.summaryPath));
    }
  });

  context.subscriptions.push(
    sidebarSummaryView,
    sidebarActionsView,
    sidebarTemplateView,
    sidebarNodeListView,
    sidebarSessionHistoryView,
    vscode.window.registerTreeDataProvider(VIEW_IDS.sidebarTree, sidebarSummaryView),
    vscode.window.registerWebviewViewProvider(VIEW_IDS.sidebarFilters, sidebarActionsView, {
      webviewOptions: {
        retainContextWhenHidden: true
      }
    }),
    vscode.window.registerWebviewViewProvider(VIEW_IDS.sidebarTemplates, sidebarTemplateView, {
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

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMAND_IDS.applyTemplate, async (templateId?: unknown) => {
      try {
        await applyTemplateFromCommand(panelManager, templateId);
      } catch (error) {
        await showCanvasTemplateError('应用模板失败', error);
      }
    }),
    vscode.commands.registerCommand(COMMAND_IDS.applyDefaultTemplate, async () => {
      try {
        const appliedNodeIds = await panelManager.applyDefaultCanvasTemplate();
        await panelManager.revealOrCreateCurrentCanvasSurface();
        panelManager.focusCanvasTemplateNodeGroup(appliedNodeIds);
      } catch (error) {
        await showCanvasTemplateError('应用默认模板失败', error);
      }
    }),
    vscode.commands.registerCommand(COMMAND_IDS.resetToTemplate, async (templateId?: unknown) => {
      try {
        await resetToTemplateFromCommand(panelManager, templateId);
      } catch (error) {
        await showCanvasTemplateError('重置为模板失败', error);
      }
    }),
    vscode.commands.registerCommand(COMMAND_IDS.resetToDefaultTemplate, async () => {
      try {
        const appliedNodeIds = await panelManager.resetDefaultCanvasTemplateWithConfirmation();
        if (appliedNodeIds) {
          await panelManager.revealOrCreateCurrentCanvasSurface();
          panelManager.focusCanvasTemplateNodeGroup(appliedNodeIds);
        }
      } catch (error) {
        await showCanvasTemplateError('重置为默认模板失败', error);
      }
    }),
    vscode.commands.registerCommand(COMMAND_IDS.saveCanvasAsTemplate, async () => {
      try {
        await saveCurrentCanvasAsTemplateFromCommand(panelManager);
      } catch (error) {
        await showCanvasTemplateError('保存模板失败', error);
      }
    }),
    vscode.commands.registerCommand(COMMAND_IDS.importTemplate, async () => {
      try {
        await importCanvasTemplateFromCommand(panelManager);
      } catch (error) {
        await showCanvasTemplateError('导入模板失败', error);
      }
    }),
    vscode.commands.registerCommand(COMMAND_IDS.exportTemplate, async (templateId?: unknown) => {
      try {
        await exportCanvasTemplateFromCommand(panelManager, templateId);
      } catch (error) {
        await showCanvasTemplateError('导出模板失败', error);
      }
    }),
    vscode.commands.registerCommand(COMMAND_IDS.deleteTemplate, async (templateId?: unknown) => {
      try {
        await deleteCanvasTemplateFromCommand(panelManager, templateId);
      } catch (error) {
        await showCanvasTemplateError('删除模板失败', error);
      }
    }),
    vscode.commands.registerCommand(COMMAND_IDS.setDefaultTemplate, async (templateId?: unknown) => {
      try {
        await setDefaultCanvasTemplateFromCommand(panelManager, templateId);
      } catch (error) {
        await showCanvasTemplateError('设置默认模板失败', error);
      }
    })
  );

  registerCommand(context, COMMAND_IDS.refreshTemplates, async () => {
    await panelManager.refreshCanvasTemplateCatalog();
  });

  registerCommand(context, COMMAND_IDS.selectTerminalShell, async () => {
    await promptTerminalShellSelection();
  });

  registerCommand(context, COMMAND_IDS.selectCodexCli, async () => {
    await promptAgentCliSelection('codex', panelManager);
  });

  registerCommand(context, COMMAND_IDS.selectClaudeCli, async () => {
    await promptAgentCliSelection('claude', panelManager);
  });

  registerCommand(context, COMMAND_IDS.openCodexConfigFile, async () => {
    await openAgentSettingsFile('codex-config', panelManager);
  });

  registerCommand(context, COMMAND_IDS.openCodexAuthFile, async () => {
    await openAgentSettingsFile('codex-auth', panelManager);
  });

  registerCommand(context, COMMAND_IDS.openClaudeSettingsFile, async () => {
    await openAgentSettingsFile('claude-settings', panelManager);
  });

  registerCommand(context, COMMAND_IDS.createNode, async () => {
    const createRequest = await promptCreateNodeRequest(panelManager.getSidebarState().creatableKinds);
    if (!createRequest) {
      return;
    }

    const blockedReason = panelManager.getCreateNodeBlockedReason(createRequest.kind);
    if (blockedReason) {
      await panelManager.showCreateNodeBlockedReasonModal(createRequest.kind);
      return;
    }

    await panelManager.revealOrCreateCurrentCanvasSurface();
    panelManager.createNode(createRequest.kind, {
      agentProvider: createRequest.agentProvider,
      agentLaunchPreset: createRequest.agentLaunchPreset,
      agentCustomLaunchCommand: createRequest.agentCustomLaunchCommand
    });
  });

  registerCommand(context, COMMAND_IDS.addFolderToWorkspace, async () => {
    await addFolderToWorkspaceFromCommand();
  });

  registerCommand(context, COMMAND_IDS.createWorktree, async () => {
    await createWorktreeAndAddToWorkspaceFromCommand({});
  });

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMAND_IDS.createWorktreeForRoot, async (rootPath?: unknown) => {
      await createWorktreeAndAddToWorkspaceFromCommand({
        rootPath: typeof rootPath === 'string' ? rootPath : undefined
      });
    }),
    vscode.commands.registerCommand(COMMAND_IDS.removeFolderFromWorkspace, async (rootPath?: unknown) => {
      if (typeof rootPath !== 'string' || rootPath.trim().length === 0) {
        await vscode.window.showWarningMessage('未找到要从 workspace 移除的 folder。');
        return;
      }

      await removeFolderFromWorkspaceFromCommand(rootPath);
    }),
    vscode.commands.registerCommand(COMMAND_IDS.removeWorktreeFromWorkspace, async (rootPath?: unknown) => {
      if (typeof rootPath !== 'string' || rootPath.trim().length === 0) {
        await vscode.window.showWarningMessage('未找到要移除的 worktree folder。');
        return;
      }

      await removeWorktreeFromWorkspaceFromCommand(rootPath);
    })
  );

  registerCommand(context, COMMAND_IDS.createTerminalFromExplorerResource, async (resource?: unknown) => {
    const resolvedResource = await resolveExplorerExecutionResource(resource);
    if (!resolvedResource) {
      return;
    }

    const blockedReason = panelManager.getCreateNodeBlockedReason('terminal');
    if (blockedReason) {
      await panelManager.showCreateNodeBlockedReasonModal('terminal');
      return;
    }

    await panelManager.revealOrCreateCurrentCanvasSurface();
    panelManager.createNode('terminal', {
      cwdOverride: resolvedResource.cwd
    });
  });

  registerCommand(context, COMMAND_IDS.createAgentFromExplorerResource, async (resource?: unknown) => {
    const resolvedResource = await resolveExplorerExecutionResource(resource);
    if (!resolvedResource) {
      return;
    }

    const blockedReason = panelManager.getCreateNodeBlockedReason('agent');
    if (blockedReason) {
      await panelManager.showCreateNodeBlockedReasonModal('agent');
      return;
    }

    const agentRequest = await promptCreateNodeRequest(['agent']);
    if (!agentRequest || agentRequest.kind !== 'agent') {
      return;
    }

    await panelManager.revealOrCreateCurrentCanvasSurface();
    panelManager.createNode('agent', {
      agentProvider: agentRequest.agentProvider,
      agentLaunchPreset: agentRequest.agentLaunchPreset,
      agentCustomLaunchCommand: agentRequest.agentCustomLaunchCommand,
      cwdOverride: resolvedResource.cwd
    });
  });

  registerCommand(context, COMMAND_IDS.createNoteFromExplorerMarkdown, async (resource?: unknown) => {
    const resolvedResource = await resolveExplorerMarkdownNoteResource(resource);
    if (!resolvedResource) {
      return;
    }

    await panelManager.revealOrCreateCurrentCanvasSurface();
    await panelManager.createNoteFromMarkdownResource(resolvedResource.uri);
  });

  registerCommand(context, COMMAND_IDS.createEmptyGroup, async () => {
    await panelManager.revealOrCreateCurrentCanvasSurface();
    panelManager.createEmptyGroupFromCommand();
  });

  registerCommand(context, COMMAND_IDS.createGroupFromSelection, async () => {
    await panelManager.revealOrCreateCurrentCanvasSurface();
    try {
      await panelManager.waitForCanvasReady(undefined, 15000);
    } catch {
      await vscode.window.showInformationMessage('请先打开画布并选中至少两个同一父级的节点或分组。');
      return;
    }

    const requested = panelManager.createGroupFromSelectionFromCommand();
    if (!requested) {
      await vscode.window.showInformationMessage('请先打开画布并选中至少两个同一父级的节点或分组。');
    }
  });

  registerCommand(context, COMMAND_IDS.saveNoteAsMarkdownFile, async (nodeId?: unknown) => {
    await panelManager.saveNoteAsMarkdownFile(typeof nodeId === 'string' ? nodeId : undefined);
  });

  registerCommand(context, COMMAND_IDS.showNodeList, async () => {
    await showSidebarNodeListQuickPick(panelManager);
  });

  registerCommand(context, COMMAND_IDS.setSidebarNodeListFlatView, async () => {
    await sidebarNodeListView.setViewMode('flat');
  });

  registerCommand(context, COMMAND_IDS.setSidebarNodeListFlatViewChecked, async () => {
    await sidebarNodeListView.setViewMode('flat');
  });

  registerCommand(context, COMMAND_IDS.setSidebarNodeListGroupedView, async () => {
    await sidebarNodeListView.setViewMode('grouped');
  });

  registerCommand(context, COMMAND_IDS.setSidebarNodeListGroupedViewChecked, async () => {
    await sidebarNodeListView.setViewMode('grouped');
  });

  registerCommand(context, COMMAND_IDS.showSessionHistory, async () => {
    await showSessionHistoryQuickPick(sidebarSessionHistoryView, panelManager);
  });

  registerCommand(context, COMMAND_IDS.refreshSessionHistory, async () => {
    await sidebarSessionHistoryView.refresh();
  });

  registerCommand(context, COMMAND_IDS.enableSidebarSessionHistoryRootGrouping, async () => {
    await sidebarSessionHistoryView.setGroupingOption('groupByWorkspaceRoot', true);
  });

  registerCommand(context, COMMAND_IDS.disableSidebarSessionHistoryRootGrouping, async () => {
    await sidebarSessionHistoryView.setGroupingOption('groupByWorkspaceRoot', false);
  });

  registerCommand(context, COMMAND_IDS.enableSidebarSessionHistoryProviderGrouping, async () => {
    await sidebarSessionHistoryView.setGroupingOption('groupByProvider', true);
  });

  registerCommand(context, COMMAND_IDS.disableSidebarSessionHistoryProviderGrouping, async () => {
    await sidebarSessionHistoryView.setGroupingOption('groupByProvider', false);
  });

  registerCommand(context, COMMAND_IDS.enableSidebarSessionHistoryTimeGrouping, async () => {
    await sidebarSessionHistoryView.setGroupingOption('groupByTime', true);
  });

  registerCommand(context, COMMAND_IDS.disableSidebarSessionHistoryTimeGrouping, async () => {
    await sidebarSessionHistoryView.setGroupingOption('groupByTime', false);
  });

  registerCommand(context, COMMAND_IDS.resetCanvasState, async () => {
    const confirmed = await vscode.window.showWarningMessage(
      '清空画板会清空当前 workspace 绑定的画布对象，并终止运行中的 Agent / Terminal 会话。',
      { modal: true },
      '继续清空'
    );
    if (confirmed !== '继续清空') {
      return;
    }

    await panelManager.resetState();
  });

  const focusNodeFromCommand = async (nodeId?: unknown): Promise<void> => {
    if (typeof nodeId !== 'string' || nodeId.trim().length === 0) {
      return;
    }

    const focused = await panelManager.focusNodeById(nodeId);
    if (!focused) {
      await vscode.window.showWarningMessage('目标节点已不存在，或当前无法定位到画布中的该节点。');
    }
  };

  const centerAttentionNodeFromCommand = async (nodeId?: unknown): Promise<void> => {
    if (typeof nodeId !== 'string' || nodeId.trim().length === 0) {
      return;
    }

    const centered = await panelManager.centerAttentionNodeById(nodeId);
    if (!centered) {
      await vscode.window.showWarningMessage('目标节点已不存在，或当前无法定位到画布中的该节点。');
    }
  };

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMAND_IDS.focusNode, focusNodeFromCommand),
    vscode.commands.registerCommand(COMMAND_IDS.focusAttentionNode, centerAttentionNodeFromCommand),
    vscode.commands.registerCommand(COMMAND_IDS.centerAttentionNode, centerAttentionNodeFromCommand),
    vscode.commands.registerCommand(COMMAND_IDS.focusSidebarNode, focusNodeFromCommand),
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

async function promptTerminalShellSelection(): Promise<void> {
  const configuration = vscode.workspace.getConfiguration();
  const effectiveTerminalShellConfiguration = getEffectiveTerminalShellConfiguration();
  const currentConfiguredShellPath = effectiveTerminalShellConfiguration.configuredPath;
  const resolvedConfiguredShell = getConfiguredTerminalShell();
  const detectedShells = await detectAvailableTerminalShells({
    defaultShellPath: vscode.env.shell
  });
  const configurationTarget = resolveTerminalShellConfigurationTarget();
  const targetLabel = describeTerminalShellConfigurationTarget(configurationTarget);

  const picked = await vscode.window.showQuickPick(
    buildTerminalShellQuickPickItems(
      detectedShells,
      currentConfiguredShellPath,
      resolvedConfiguredShell.resolvedPath,
      resolvedConfiguredShell.resolutionSource === 'default-shell'
    ),
    {
      placeHolder: '选择嵌入式 Terminal 要使用的 shell'
    }
  );

  if (!picked) {
    return;
  }

  if (picked.useDefault) {
    await configuration.update(CONFIG_KEYS.terminalShell, 'default', configurationTarget);
    await configuration.update(CONFIG_KEYS.terminalShellPath, '', configurationTarget);
    const defaultShellPath = detectedShells.find((shell) => shell.isDefault)?.resolvedPath ?? vscode.env.shell.trim();
    const detail = defaultShellPath ? `：${defaultShellPath}` : '';
    await vscode.window.showInformationMessage(`已将${targetLabel}的嵌入式 Terminal 改为跟随当前默认 shell${detail}`);
    return;
  }

  if (!picked.resolvedPath) {
    return;
  }

  const persistedSelection = buildPersistedTerminalShellSelection({
    shellName: picked.shellName,
    resolvedPath: picked.resolvedPath,
    useDefault: picked.useDefault
  });
  if (!persistedSelection) {
    return;
  }

  await configuration.update(
    CONFIG_KEYS.terminalShell,
    persistedSelection.configuredShell,
    configurationTarget
  );
  await configuration.update(
    CONFIG_KEYS.terminalShellPath,
    persistedSelection.configuredPath,
    configurationTarget
  );
  const configuredShellDetail =
    persistedSelection.configuredShell === 'default'
      ? ''
      : `（类型：${persistedSelection.configuredShell}；实际启动优先使用该路径）`;
  await vscode.window.showInformationMessage(
    `已将${targetLabel}的嵌入式 Terminal shell 更新为 ${picked.label}：${persistedSelection.configuredPath}${configuredShellDetail}`
  );
}

async function openAgentSettingsFile(kind: AgentSettingsFileKind, panelManager: CanvasPanelManager): Promise<void> {
  const descriptor = getAgentSettingsFileDescriptor(kind);
  const settingsEnvironment = await panelManager.resolveAgentSettingsFileEnvironment();
  const filePath = resolveAgentSettingsFilePath(kind, settingsEnvironment);
  if (!filePath) {
    await vscode.window.showWarningMessage(`无法定位当前执行宿主的配置目录，暂时不能打开 ${descriptor.label}。`);
    return;
  }

  const uri = vscode.Uri.file(filePath);
  try {
    const status = await getLocalAgentSettingsFileStatus(filePath);
    if (status === 'directory') {
      await vscode.window.showWarningMessage(`${descriptor.label} 指向的是目录，不能作为配置文件打开：${filePath}`);
      return;
    }

    if (status === 'missing') {
      const created = await createMissingAgentSettingsFileIfRequested(descriptor, filePath);
      if (!created) {
        return;
      }
    }

    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document, { preview: false });
  } catch (error) {
    await vscode.window.showErrorMessage(
      `打开 ${descriptor.label} 失败：${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function createMissingAgentSettingsFileIfRequested(
  descriptor: AgentSettingsFileDescriptor,
  filePath: string
): Promise<boolean> {
  const picked = await vscode.window.showWarningMessage(
    `未找到 ${descriptor.label}：${filePath}。是否创建后打开？`,
    { modal: true },
    '创建并打开'
  );
  if (picked !== '创建并打开') {
    return false;
  }

  try {
    await createRestrictedLocalAgentSettingsFile(filePath, descriptor.initialContent);
  } catch (error) {
    if (!isNodeFileAlreadyExistsError(error)) {
      throw error;
    }
  }
  return true;
}

async function promptAgentCliSelection(provider: AgentProviderKind, panelManager: CanvasPanelManager): Promise<void> {
  const configuration = vscode.workspace.getConfiguration();
  const providerLabelText = getAgentCliDisplayName(provider);
  const configuredCommand = getConfiguredAgentCliCommand(provider);
  const candidates = await discoverAgentCliCandidates({
    provider,
    configuredCommand,
    env: process.env,
    workspaceCwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
    extensionRoots: vscode.extensions.all.map((extension) => extension.extensionPath)
  });
  const picked = await vscode.window.showQuickPick(buildAgentCliQuickPickItems(provider, candidates, configuredCommand), {
    placeHolder: `选择 ${providerLabelText} CLI 命令或路径`
  });

  if (!picked) {
    return;
  }

  if (picked.install) {
    await promptAgentCliInstallation(provider, panelManager);
    return;
  }

  const selectedCommand = picked.manualInput
    ? await promptManualAgentCliCommand(provider, configuredCommand)
    : picked.command;
  if (!selectedCommand) {
    return;
  }

  const configKey = provider === 'claude' ? CONFIG_KEYS.agentClaudeCommand : CONFIG_KEYS.agentCodexCommand;
  await configuration.update(configKey, selectedCommand, vscode.ConfigurationTarget.Global);
  await vscode.window.showInformationMessage(`已将当前设备的 ${providerLabelText} CLI 更新为：${selectedCommand}`);
}

async function promptAgentCliInstallation(
  provider: AgentProviderKind,
  panelManager: CanvasPanelManager
): Promise<void> {
  const installationInfo = getAgentCliInstallationInfo(provider);
  const picked = await vscode.window.showQuickPick(buildAgentCliInstallQuickPickItems(installationInfo), {
    placeHolder: `选择 ${installationInfo.label} 的安装方式`
  });

  if (!picked) {
    return;
  }

  if (picked.installMethod === 'command-line') {
    const result = await panelManager.createTerminalAndRunCommand(installationInfo.cliInstallCommand, {
      titleOverride: `安装 ${installationInfo.label}`
    });
    if (!result.created) {
      await vscode.window.showWarningMessage(
        result.errorMessage ?? `无法在画布 Terminal 中执行 ${installationInfo.label} 安装命令。`
      );
      return;
    }

    if (!result.commandDispatched) {
      await vscode.window.showWarningMessage(
        result.errorMessage ??
          `已创建画布 Terminal，但尚未确认 ${installationInfo.label} 安装命令已输入；请检查 Terminal 节点状态。`
      );
      return;
    }

    await vscode.window.showInformationMessage(
      `已在画布 Terminal 中输入并执行：${installationInfo.cliInstallCommand}。安装完成后请重新点击 ${installationInfo.label} 命令并选择 CLI。`
    );
    return;
  }

  await openAgentVsCodeExtensionInstallPage(installationInfo);
}

function buildAgentCliInstallQuickPickItems(
  installationInfo: ReturnType<typeof getAgentCliInstallationInfo>
): AgentCliInstallQuickPickItem[] {
  return [
    {
      label: 'npm 全局安装',
      description: installationInfo.cliInstallCommand,
      detail: `在画布 Terminal 中执行安装命令。`,
      installMethod: 'command-line'
    },
    {
      label: '安装 VS Code 插件',
      description: installationInfo.vscodeExtensionId,
      detail: `跳转到 ${installationInfo.label} 扩展安装页，点击 Install 完成安装。`,
      installMethod: 'vscode-extension'
    }
  ];
}

async function openAgentVsCodeExtensionInstallPage(
  installationInfo: ReturnType<typeof getAgentCliInstallationInfo>
): Promise<void> {
  const uri = vscode.Uri.parse(installationInfo.vscodeExtensionUri);
  try {
    const opened = await vscode.env.openExternal(uri);
    if (!opened) {
      await vscode.commands.executeCommand('workbench.extensions.search', `@id:${installationInfo.vscodeExtensionId}`);
    }
    await vscode.window.showInformationMessage(
      `已打开 ${installationInfo.label} VS Code 插件页面，请在扩展页点击 Install 完成安装。`
    );
  } catch {
    await vscode.window.showWarningMessage(
      `无法自动打开 ${installationInfo.label} VS Code 插件页面；请在扩展面板手动搜索 ${installationInfo.vscodeExtensionId}。`
    );
  }
}

function getConfiguredAgentCliCommand(provider: AgentProviderKind): string {
  const defaultCommand = getAgentCliDefaultCommand(provider);
  const configKey = provider === 'claude' ? CONFIG_KEYS.agentClaudeCommand : CONFIG_KEYS.agentCodexCommand;
  return vscode.workspace.getConfiguration().get<string>(configKey, defaultCommand)?.trim() || defaultCommand;
}

async function promptManualAgentCliCommand(
  provider: AgentProviderKind,
  currentCommand: string
): Promise<string | undefined> {
  const providerLabelText = getAgentCliDisplayName(provider);
  const value = await vscode.window.showInputBox({
    title: `选择 ${providerLabelText} CLI`,
    prompt: `输入 ${providerLabelText} CLI 的命令名或绝对路径。`,
    value: currentCommand,
    validateInput: (input) => (input.trim().length > 0 ? undefined : 'CLI 命令不能为空。')
  });
  return value?.trim() || undefined;
}

function buildAgentCliQuickPickItems(
  provider: AgentProviderKind,
  candidates: readonly AgentCliCandidate[],
  currentCommand: string
): AgentCliQuickPickItem[] {
  const providerLabelText = getAgentCliDisplayName(provider);
  const installationInfo = getAgentCliInstallationInfo(provider);
  const items: AgentCliQuickPickItem[] = [];

  if (shouldOfferAgentCliInstallation(candidates)) {
    items.push({
      label: `安装 ${providerLabelText}...`,
      description: '系统中未检测到',
      detail: `通过 npm 全局安装 CLI，或安装对应的 VS Code 插件。`,
      install: true
    });
    items.push({
      label: '',
      kind: vscode.QuickPickItemKind.Separator
    });
  }

  items.push(...candidates.map((candidate) => {
    const sourceLabel = formatAgentCliCandidateSource(candidate.source);
    const isCurrent = agentCliCommandValuesEqual(candidate.command, currentCommand);
    return {
      label: candidate.command,
      description: isCurrent ? `${sourceLabel} · 当前` : sourceLabel,
      detail: buildAgentCliCandidateDetail(candidate),
      command: candidate.command
    } satisfies AgentCliQuickPickItem;
  }));

  if (items.length > 0) {
    items.push({
      label: '',
      kind: vscode.QuickPickItemKind.Separator
    });
  }

  items.push({
    label: '手动输入命令或路径...',
    description: '自定义',
    detail: `输入命令名（如 ${getAgentCliDefaultCommand(provider)}）或 CLI 可执行文件的绝对路径。`,
    manualInput: true
  });

  return items;
}

function formatAgentCliCandidateSource(source: AgentCliCandidateSource): string {
  switch (source) {
    case 'configured':
      return '当前配置';
    case 'default-command':
      return '默认命令';
    case 'path-env':
      return 'PATH';
    case 'login-shell':
      return '登录 shell';
    case 'extension-bundled':
      return '扩展内置';
    case 'common-location':
      return '常见位置';
  }
}

function buildAgentCliCandidateDetail(candidate: AgentCliCandidate): string {
  const lines = [`命令：${candidate.command}`];
  if (candidate.resolvedPath && !agentCliCommandValuesEqual(candidate.resolvedPath, candidate.command)) {
    lines.push(`实际路径：${candidate.resolvedPath}`);
  }
  if (!candidate.resolvedPath) {
    lines.push('未找到可执行文件，可能需要安装或配置 PATH。');
  }
  if (candidate.extensionRoot) {
    lines.push(`扩展目录：${candidate.extensionRoot}`);
    lines.push('注意：路径可能随扩展更新而变化。');
  }
  return lines.join('\n');
}

function agentCliCommandValuesEqual(left: string, right: string): boolean {
  return process.platform === 'win32'
    ? left.trim().toLowerCase() === right.trim().toLowerCase()
    : left.trim() === right.trim();
}

function buildTerminalShellQuickPickItems(
  detectedShells: Awaited<ReturnType<typeof detectAvailableTerminalShells>>,
  currentConfiguredShellPath: string,
  resolvedConfiguredShellPath: string,
  isFollowingDefaultShell: boolean
): TerminalShellQuickPickItem[] {
  const normalizedResolvedConfiguredShellPath = resolvedConfiguredShellPath.trim();
  const items: TerminalShellQuickPickItem[] = [
    {
      label: '跟随当前默认 shell',
      description: isFollowingDefaultShell ? '当前' : undefined,
      detail: normalizedResolvedConfiguredShellPath || '未检测到默认 shell 路径',
      useDefault: true
    }
  ];

  const hasCurrentResolvedShell =
    normalizedResolvedConfiguredShellPath.length > 0 &&
    detectedShells.some((shell) => shellPathsEqual(shell.resolvedPath, normalizedResolvedConfiguredShellPath));
  const shouldShowCurrentConfiguredShell =
    !isFollowingDefaultShell &&
    normalizedResolvedConfiguredShellPath.length > 0 &&
    !hasCurrentResolvedShell;

  if (detectedShells.length > 0 || shouldShowCurrentConfiguredShell) {
    items.push({
      label: '',
      kind: vscode.QuickPickItemKind.Separator
    });
  }

  if (shouldShowCurrentConfiguredShell) {
    items.push({
      label: `当前配置 (${path.basename(normalizedResolvedConfiguredShellPath) || normalizedResolvedConfiguredShellPath})`,
      description: currentConfiguredShellPath ? '当前' : '当前（兼容旧配置）',
      detail: normalizedResolvedConfiguredShellPath,
      resolvedPath: normalizedResolvedConfiguredShellPath,
      shellName: path.basename(normalizedResolvedConfiguredShellPath).toLowerCase()
    });
  }

  for (const shell of detectedShells) {
    items.push({
      label: shell.label,
      description: !isFollowingDefaultShell &&
        shellPathsEqual(shell.resolvedPath, normalizedResolvedConfiguredShellPath)
        ? '当前'
        : shell.isDefault
          ? '默认 shell'
          : undefined,
      detail: shell.detail,
      resolvedPath: shell.resolvedPath,
      shellName: shell.shellName
    });
  }

  return items;
}

function shellPathsEqual(left: string, right: string): boolean {
  return process.platform === 'win32'
    ? left.trim().toLowerCase() === right.trim().toLowerCase()
    : left.trim() === right.trim();
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

async function resolveExplorerMarkdownNoteResource(
  resource: unknown
): Promise<ExplorerMarkdownNoteResource | undefined> {
  const inputUri = resource instanceof vscode.Uri ? resource : undefined;
  if (!inputUri || inputUri.scheme !== 'file') {
    await showExplorerMarkdownNoteResourceWarning();
    return undefined;
  }

  if (!isSupportedNoteMarkdownFilePath(inputUri.fsPath)) {
    await showExplorerMarkdownNoteResourceWarning();
    return undefined;
  }

  let stat: vscode.FileStat;
  try {
    stat = await vscode.workspace.fs.stat(inputUri);
  } catch {
    await showExplorerMarkdownNoteResourceWarning();
    return undefined;
  }

  if ((stat.type & vscode.FileType.File) === 0) {
    await showExplorerMarkdownNoteResourceWarning();
    return undefined;
  }

  return {
    uri: inputUri
  };
}

async function showExplorerMarkdownNoteResourceWarning(): Promise<void> {
  await vscode.window.showWarningMessage('请选择 Markdown 文件（.md / .markdown）来创建关联 Note。');
}

async function resolveExplorerExecutionResource(resource: unknown): Promise<ExplorerExecutionResource | undefined> {
  const inputUri = resource instanceof vscode.Uri ? resource : undefined;
  if (!inputUri || inputUri.scheme !== 'file') {
    await showExplorerExecutionResourceWarning();
    return undefined;
  }

  let stat: vscode.FileStat;
  try {
    stat = await vscode.workspace.fs.stat(inputUri);
  } catch {
    await showExplorerExecutionResourceWarning();
    return undefined;
  }

  let cwdUri: vscode.Uri;
  let resourceKind: ExplorerExecutionResource['resourceKind'];
  if ((stat.type & vscode.FileType.Directory) !== 0) {
    cwdUri = inputUri;
    resourceKind = 'directory';
  } else if ((stat.type & vscode.FileType.File) !== 0) {
    cwdUri = vscode.Uri.file(path.dirname(inputUri.fsPath));
    resourceKind = 'file-parent';
  } else {
    await showExplorerExecutionResourceWarning();
    return undefined;
  }

  let cwdStat: vscode.FileStat;
  try {
    cwdStat = await vscode.workspace.fs.stat(cwdUri);
  } catch {
    await showExplorerExecutionResourceWarning();
    return undefined;
  }

  if ((cwdStat.type & vscode.FileType.Directory) === 0) {
    await showExplorerExecutionResourceWarning();
    return undefined;
  }

  const workspaceFolder = resolveExplorerExecutionWorkspaceFolder(cwdUri);
  if (!workspaceFolder) {
    await showExplorerExecutionResourceWarning();
    return undefined;
  }

  return {
    cwd: cwdUri.fsPath,
    cwdUri,
    resourceKind,
    workspaceFolder
  };
}

async function showExplorerExecutionResourceWarning(): Promise<void> {
  await vscode.window.showWarningMessage('请选择当前 workspace 内的文件夹或普通文件来创建画布 Terminal / Agent。');
}

function resolveExplorerExecutionWorkspaceFolder(cwdUri: vscode.Uri): vscode.WorkspaceFolder | undefined {
  const directWorkspaceFolder = vscode.workspace.getWorkspaceFolder(cwdUri);
  if (directWorkspaceFolder) {
    return directWorkspaceFolder;
  }

  return vscode.workspace.workspaceFolders?.find((workspaceFolder) =>
    isSameOrDescendantFileSystemPath(cwdUri.fsPath, workspaceFolder.uri.fsPath)
  );
}

function isSameOrDescendantFileSystemPath(candidatePath: string, ancestorPath: string): boolean {
  const normalizedCandidate = normalizeComparableFileSystemPath(candidatePath);
  const normalizedAncestor = normalizeComparableFileSystemPath(ancestorPath);
  if (normalizedCandidate === normalizedAncestor) {
    return true;
  }

  const ancestorWithSeparator = normalizedAncestor.endsWith(path.sep)
    ? normalizedAncestor
    : `${normalizedAncestor}${path.sep}`;
  return normalizedCandidate.startsWith(ancestorWithSeparator);
}

function normalizeComparableFileSystemPath(filePath: string): string {
  const resolvedPath = path.resolve(filePath);
  return process.platform === 'win32' ? resolvedPath.toLowerCase() : resolvedPath;
}

async function addFolderToWorkspaceFromCommand(): Promise<void> {
  const selectedUris = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: true,
    openLabel: '添加到 Workspace'
  });
  if (!selectedUris || selectedUris.length === 0) {
    return;
  }

  const existingWorkspaceFolderPaths = new Set(
    (vscode.workspace.workspaceFolders ?? []).map((folder) => normalizeComparableFileSystemPath(folder.uri.fsPath))
  );
  const foldersToAdd: { uri: vscode.Uri }[] = [];
  const pendingPaths = new Set<string>();
  for (const uri of selectedUris) {
    if (uri.scheme !== 'file') {
      continue;
    }
    const normalizedPath = normalizeComparableFileSystemPath(uri.fsPath);
    if (existingWorkspaceFolderPaths.has(normalizedPath) || pendingPaths.has(normalizedPath)) {
      continue;
    }

    pendingPaths.add(normalizedPath);
    foldersToAdd.push({ uri });
  }

  if (foldersToAdd.length === 0) {
    await vscode.window.showInformationMessage('所选文件夹已经在当前 workspace 中。');
    return;
  }

  const inserted = vscode.workspace.updateWorkspaceFolders(
    vscode.workspace.workspaceFolders?.length ?? 0,
    0,
    ...foldersToAdd
  );
  if (!inserted) {
    await vscode.window.showWarningMessage('无法将所选文件夹添加到当前 workspace。');
  }
}

async function removeFolderFromWorkspaceFromCommand(rootPath: string): Promise<void> {
  const workspaceFolder = resolveWorkspaceFolderByFsPath(rootPath);
  if (!workspaceFolder) {
    await vscode.window.showWarningMessage('该 folder 已不在当前 workspace 中。');
    return;
  }

  const confirmed = await vscode.window.showWarningMessage(
    `从当前 workspace 移除 folder「${workspaceFolder.name}」？磁盘文件不会被删除。`,
    { modal: true },
    '移除 Folder'
  );
  if (confirmed !== '移除 Folder') {
    return;
  }

  const removalResult = removeWorkspaceFolderByFsPath(workspaceFolder.uri.fsPath);
  if (removalResult === 'missing') {
    await vscode.window.showWarningMessage('该 folder 已不在当前 workspace 中。');
  } else if (removalResult === 'failed') {
    await vscode.window.showWarningMessage(`无法从当前 workspace 移除 folder：${workspaceFolder.name}`);
  }
}

async function removeWorktreeFromWorkspaceFromCommand(rootPath: string): Promise<void> {
  const workspaceFolder = resolveWorkspaceFolderByFsPath(rootPath);
  if (!workspaceFolder) {
    await vscode.window.showWarningMessage('该 worktree folder 已不在当前 workspace 中。');
    return;
  }

  if (!vscode.workspace.isTrusted) {
    await showWorktreeUnavailableModal({
      code: 'workspace-untrusted',
      rootPath,
      operation: 'remove'
    });
    return;
  }

  if (workspaceFolder.uri.scheme !== 'file') {
    await showWorktreeUnavailableModal({
      code: 'not-file-root',
      rootPath: workspaceFolder.uri.toString(),
      operation: 'remove'
    });
    return;
  }

  let repositoryInfo: GitWorktreeRepositoryInfo;
  try {
    repositoryInfo = await getGitWorktreeRepositoryInfo(workspaceFolder.uri.fsPath);
  } catch (error) {
    await showWorktreeUnavailableModal({
      code: classifyWorktreeRepositoryError(error),
      rootPath: workspaceFolder.uri.fsPath,
      operation: 'remove',
      cause: error
    });
    return;
  }

  if (!repositoryInfo.isLinkedWorktree) {
    await showWorktreeUnavailableModal({
      code: 'not-linked-worktree',
      rootPath: workspaceFolder.uri.fsPath,
      operation: 'remove',
      detail: '当前 folder 是 git 主工作区或普通文件夹，不是可通过 git worktree remove 删除的 linked worktree。'
    });
    return;
  }

  const confirmed = await vscode.window.showWarningMessage(
    `移除 worktree「${workspaceFolder.name}」并从当前 workspace 移除该 folder？磁盘目录会被 git worktree remove 删除。`,
    { modal: true, detail: workspaceFolder.uri.fsPath },
    '移除 Worktree'
  );
  if (confirmed !== '移除 Worktree') {
    return;
  }

  try {
    await execFileAsync('git', ['-C', workspaceFolder.uri.fsPath, 'worktree', 'remove', workspaceFolder.uri.fsPath], {
      timeout: GIT_WORKTREE_COMMAND_TIMEOUT_MS,
      maxBuffer: GIT_COMMAND_MAX_BUFFER_BYTES,
      encoding: 'utf8'
    });
  } catch (error) {
    await vscode.window.showErrorMessage(`移除 git worktree 失败：${formatExecErrorMessage(error)}`, { modal: true });
    return;
  }

  const removalResult = removeWorkspaceFolderByFsPath(workspaceFolder.uri.fsPath);
  if (removalResult === 'failed') {
    await vscode.window.showWarningMessage(
      `Worktree 已移除，但无法自动从当前 workspace 移除 folder：${workspaceFolder.name}`,
      { modal: true }
    );
  }
}

async function createWorktreeAndAddToWorkspaceFromCommand(request: WorkspaceWorktreeRequest): Promise<void> {
  if (!vscode.workspace.isTrusted) {
    await showWorktreeUnavailableModal({
      code: 'workspace-untrusted',
      rootPath: request.rootPath,
      operation: 'create'
    });
    return;
  }

  const target = await promptWorkspaceWorktreeTarget(request);
  if (!target) {
    return;
  }

  const confirmed = await vscode.window.showInformationMessage(
    formatWorktreeConfirmationMessage(target),
    { modal: true, detail: target.targetPath },
    '创建 Worktree'
  );
  if (confirmed !== '创建 Worktree') {
    return;
  }

  try {
    await mkdir(path.dirname(target.targetPath), { recursive: true });
    await execFileAsync(
      'git',
      buildGitWorktreeAddArgs(target),
      {
        timeout: GIT_WORKTREE_COMMAND_TIMEOUT_MS,
        maxBuffer: GIT_COMMAND_MAX_BUFFER_BYTES,
        encoding: 'utf8'
      }
    );
  } catch (error) {
    await vscode.window.showErrorMessage(`创建 git worktree 失败：${formatExecErrorMessage(error)}`);
    return;
  }

  const added = addWorkspaceFolderIfMissing(target.targetPath);
  if (!added) {
    await vscode.window.showWarningMessage(
      `Worktree 已创建，但无法自动加入当前 workspace。请手动添加：${target.targetPath}`
    );
    return;
  }

  await vscode.window.showInformationMessage(`已创建 worktree 并添加到 workspace：${target.displayName}`);
}

async function getGitWorktreeRepositoryInfo(rootPath: string): Promise<GitWorktreeRepositoryInfo> {
  const [topLevelOutput, gitDirOutput, gitCommonDirOutput] = await Promise.all([
    execGit(rootPath, ['rev-parse', '--show-toplevel']),
    execGit(rootPath, ['rev-parse', '--git-dir']),
    execGit(rootPath, ['rev-parse', '--git-common-dir'])
  ]);
  const topLevelPath = path.resolve(topLevelOutput.trim());
  const gitDir = resolveGitMetadataPath(rootPath, gitDirOutput.trim());
  const gitCommonDir = resolveGitMetadataPath(rootPath, gitCommonDirOutput.trim());
  const [realGitDir, realGitCommonDir] = await Promise.all([
    resolveRealPathBestEffort(gitDir),
    resolveRealPathBestEffort(gitCommonDir)
  ]);

  return {
    rootPath: path.resolve(rootPath),
    topLevelPath,
    gitCommonDir,
    isLinkedWorktree: normalizeComparableFileSystemPath(realGitDir) !== normalizeComparableFileSystemPath(realGitCommonDir)
  };
}

async function promptWorkspaceWorktreeTarget(
  request: WorkspaceWorktreeRequest
): Promise<WorkspaceWorktreeTarget | undefined> {
  const rootFolder = request.rootPath
    ? resolveWorkspaceFolderByFsPath(request.rootPath)
    : await promptWorkspaceRootFolderForWorktree();
  if (!rootFolder) {
    await showWorktreeUnavailableModal({
      code: request.rootPath ? 'unknown' : 'not-file-root',
      rootPath: request.rootPath,
      operation: 'create',
      detail: request.rootPath
        ? '指定的 folder 已不在当前 workspace 中。'
        : '当前窗口没有可用于创建 worktree 的本地 workspace folder。'
    });
    return undefined;
  }

  if (rootFolder.uri.scheme !== 'file') {
    await showWorktreeUnavailableModal({
      code: 'not-file-root',
      rootPath: rootFolder.uri.toString(),
      operation: 'create'
    });
    return undefined;
  }

  try {
    await getGitWorktreeRepositoryInfo(rootFolder.uri.fsPath);
  } catch (error) {
    await showWorktreeUnavailableModal({
      code: classifyWorktreeRepositoryError(error),
      rootPath: rootFolder.uri.fsPath,
      operation: 'create',
      cause: error
    });
    return undefined;
  }

  let refs: GitWorktreeRef[];
  try {
    refs = await getGitWorktreeRefs(rootFolder);
  } catch (error) {
    await showWorktreeUnavailableModal({
      code: classifyWorktreeRepositoryError(error),
      rootPath: rootFolder.uri.fsPath,
      operation: 'create',
      cause: error
    });
    return undefined;
  }
  if (refs.length === 0) {
    await showWorktreeUnavailableModal({
      code: 'no-git-refs',
      rootPath: rootFolder.uri.fsPath,
      operation: 'create',
      detail: '当前 git repository 还没有可用于创建 worktree 的 commit 或本地 ref。'
    });
    return undefined;
  }

  const creationPlan = await promptWorktreeCreationPlan(rootFolder, refs);
  if (!creationPlan) {
    return undefined;
  }
  const defaultTargetPath = buildDefaultWorktreeTargetPath(rootFolder.uri.fsPath, creationPlan.defaultPathName);
  const targetPath = await promptWorktreeTargetPath(defaultTargetPath);
  if (!targetPath) {
    return undefined;
  }

  return {
    rootFolder,
    branchName: creationPlan.branchName,
    checkoutRef: creationPlan.checkoutRef,
    startPoint: creationPlan.startPoint,
    detached: creationPlan.detached,
    displayName: creationPlan.displayName,
    targetPath
  };
}

async function getGitWorktreeRefs(rootFolder: vscode.WorkspaceFolder): Promise<GitWorktreeRef[]> {
  const rootPath = rootFolder.uri.fsPath;
  const headShortSha = (await execGit(rootPath, ['rev-parse', '--short', 'HEAD'])).trim();
  const headDetailOutput = (await execGit(rootPath, ['log', '-1', '--format=%an%x09%s'])).trim();
  const [headAuthor, headSubject] = headDetailOutput.split('\t');
  const currentBranchName = (await execGit(rootPath, ['branch', '--show-current']).catch(() => '')).trim();
  const branchOutput = await execGit(rootPath, [
    'for-each-ref',
    '--sort=-committerdate',
    '--format=%(refname:short)%09%(objectname:short)%09%(committerdate:relative)%09%(authorname)%09%(subject)%09%(worktreepath)',
    'refs/heads'
  ]);

  const refs: GitWorktreeRef[] = [
    {
      name: 'HEAD',
      shortSha: headShortSha,
      author: headAuthor || undefined,
      subject: headSubject || undefined,
      kind: 'head',
      worktreePath: rootPath,
      isCurrentWorktree: true,
      isCheckedOutInWorktree: true
    }
  ];

  for (const line of branchOutput.split(/\r?\n/u)) {
    if (!line.trim()) {
      continue;
    }
    const [name, shortSha, relativeDate, author, subject, worktreePath] = line.split('\t');
    if (!name) {
      continue;
    }

    refs.push({
      name,
      shortSha: shortSha || '',
      relativeDate: relativeDate || undefined,
      author: author || undefined,
      subject: subject || undefined,
      kind: 'localBranch',
      worktreePath: worktreePath || undefined,
      isCurrentWorktree: Boolean(currentBranchName && name === currentBranchName),
      isCheckedOutInWorktree: Boolean(worktreePath)
    });
  }

  return refs;
}

async function execGit(rootPath: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', rootPath, ...args], {
    timeout: GIT_WORKTREE_COMMAND_TIMEOUT_MS,
    maxBuffer: GIT_COMMAND_MAX_BUFFER_BYTES,
    encoding: 'utf8'
  });
  return stdout;
}

async function promptWorktreeCreationPlan(
  rootFolder: vscode.WorkspaceFolder,
  refs: GitWorktreeRef[]
): Promise<WorktreeCreationPlan | undefined> {
  const picked = await vscode.window.showQuickPick<WorktreeQuickPickItem>(
    [
      {
        type: 'createNewBranch',
        label: '$(add) Create new branch...',
        alwaysShow: true
      },
      {
        type: 'createNewBranchFrom',
        label: '$(git-branch-create) Create new branch from...',
        alwaysShow: true
      },
      ...refs.map(buildWorktreeRefQuickPickItem)
    ],
    {
      title: `Create Worktree (${abbreviateWorktreeRootPath(rootFolder.uri.fsPath)}) (1/2)`,
      placeHolder: 'Choose a branch to create a new worktree from',
      matchOnDescription: true,
      matchOnDetail: true,
      ignoreFocusOut: true
    }
  );

  if (!picked) {
    return undefined;
  }

  if (picked.type === 'createNewBranch') {
    const branchName = await promptWorktreeBranchName(rootFolder);
    return branchName
      ? {
          kind: 'newBranch',
          branchName,
          defaultPathName: branchName,
          displayName: branchName
        }
      : undefined;
  }

  if (picked.type === 'createNewBranchFrom') {
    const baseRef = await promptWorktreeBaseRef(refs);
    if (!baseRef) {
      return undefined;
    }
    const branchName = await promptWorktreeBranchName(rootFolder, baseRef.name);
    return branchName
      ? {
          kind: 'newBranch',
          branchName,
          startPoint: baseRef.name,
          defaultPathName: branchName,
          displayName: branchName
        }
      : undefined;
  }

  if (picked.type !== 'ref') {
    return undefined;
  }

  const defaultPathName =
    picked.ref.kind === 'head' ? `HEAD-${picked.ref.shortSha || 'detached'}` : picked.ref.name;
  return {
    kind: 'existingRef',
    checkoutRef: picked.ref.name,
    detached: picked.ref.kind === 'head' || picked.ref.isCheckedOutInWorktree,
    defaultPathName,
    displayName: picked.ref.name
  };
}

async function promptWorktreeBaseRef(refs: GitWorktreeRef[]): Promise<GitWorktreeRef | undefined> {
  const picked = await vscode.window.showQuickPick<WorktreeRefQuickPickItem>(
    refs.map(buildWorktreeRefQuickPickItem),
    {
      title: 'Create new branch from...',
      placeHolder: 'Choose a reference to create new branch from',
      matchOnDescription: true,
      matchOnDetail: true,
      ignoreFocusOut: true
    }
  );

  return picked?.ref;
}

function buildWorktreeRefQuickPickItem(ref: GitWorktreeRef): WorktreeRefQuickPickItem {
  const descriptionParts =
    ref.kind === 'head'
      ? ['Current commit hash']
      : [ref.shortSha, ref.relativeDate].filter((part): part is string => Boolean(part));
  if (ref.isCheckedOutInWorktree) {
    descriptionParts.push('worktree');
  }

  return {
    type: 'ref',
    label: ref.kind === 'head' ? `$(worktree) HEAD ${ref.shortSha}` : `${ref.isCurrentWorktree ? '$(check)' : '$(git-branch)'} ${ref.name}`,
    description: descriptionParts.join('  •  '),
    detail: [ref.author, ref.subject].filter((part): part is string => Boolean(part)).join('  •  '),
    ref
  };
}

function buildDefaultWorktreeTargetPath(rootPath: string, pathName: string): string {
  const defaultTargetPath = path.join(
    path.dirname(rootPath),
    `${path.basename(rootPath)}.worktrees`,
    sanitizeWorktreePathSegment(pathName)
  );
  return defaultTargetPath;
}

async function promptWorktreeTargetPath(defaultTargetPath: string): Promise<string | undefined> {
  const targetPathInput = await vscode.window.showInputBox({
    title: '选择 worktree 目录',
    value: defaultTargetPath,
    valueSelection: [defaultTargetPath.length, defaultTargetPath.length],
    prompt: '输入新 worktree 的本地目录；目录不能已经存在。',
    ignoreFocusOut: true,
    validateInput: async (value) => {
      const normalizedValue = value.trim();
      if (!normalizedValue) {
        return '请输入 worktree 目录。';
      }
      if (!path.isAbsolute(normalizedValue)) {
        return '请输入绝对路径。';
      }
      return await pathExists(normalizedValue) ? '该路径已存在，请选择一个尚不存在的目录。' : undefined;
    }
  });
  if (!targetPathInput) {
    return undefined;
  }

  return path.resolve(targetPathInput.trim());
}

async function promptWorkspaceRootFolderForWorktree(): Promise<vscode.WorkspaceFolder | undefined> {
  const workspaceFolders = (vscode.workspace.workspaceFolders ?? []).filter((folder) => folder.uri.scheme === 'file');
  if (workspaceFolders.length === 0) {
    return undefined;
  }

  if (workspaceFolders.length === 1) {
    return workspaceFolders[0];
  }

  const picked = await vscode.window.showQuickPick<WorkspaceRootQuickPickItem>(
    workspaceFolders.map((folder) => ({
      label: `$(repo) ${folder.name}`,
      description: folder.uri.fsPath,
      folder
    })),
    {
      title: 'Select Git repository to create worktree from',
      placeHolder: 'Choose the workspace folder that owns the git repository',
      matchOnDescription: true
    }
  );

  return picked?.folder;
}

async function promptWorktreeBranchName(
  rootFolder: vscode.WorkspaceFolder,
  startPoint?: string
): Promise<string | undefined> {
  const branchName = await vscode.window.showInputBox({
    title: startPoint ? `Create new branch from ${startPoint}` : `Create new branch (${rootFolder.name})`,
    prompt: '输入要创建的新分支名。将执行 git worktree add -b <branch>。',
    placeHolder: 'feature/my-worktree',
    ignoreFocusOut: true,
    validateInput: (value) => validateWorktreeBranchName(value)
  });
  return branchName?.trim() || undefined;
}

function validateWorktreeBranchName(value: string): string | undefined {
  const branchName = value.trim();
  if (!branchName) {
    return '请输入分支名。';
  }
  if (
    branchName.startsWith('/') ||
    branchName.endsWith('/') ||
    branchName.includes('..') ||
    branchName.includes('//') ||
    !WORKTREE_BRANCH_NAME_PATTERN.test(branchName) ||
    /[\\~^:?*[\]\s]/u.test(branchName)
  ) {
    return '分支名只能包含字母、数字、点、下划线、短横线和斜杠，且不能包含空格、.. 或特殊 git ref 字符。';
  }

  return undefined;
}

function buildGitWorktreeAddArgs(target: WorkspaceWorktreeTarget): string[] {
  const args = ['-C', target.rootFolder.uri.fsPath, 'worktree', 'add'];
  if (target.branchName) {
    args.push('-b', target.branchName, target.targetPath);
    if (target.startPoint) {
      args.push(target.startPoint);
    }
    return args;
  }

  if (target.detached) {
    args.push('--detach');
  }
  args.push(target.targetPath, target.checkoutRef ?? target.displayName);
  return args;
}

function formatWorktreeConfirmationMessage(target: WorkspaceWorktreeTarget): string {
  if (target.branchName) {
    const startPointText = target.startPoint ? `，起点为「${target.startPoint}」` : '';
    return `将基于 folder「${target.rootFolder.name}」创建 worktree 分支「${target.branchName}」${startPointText}，并添加到当前 workspace。`;
  }

  const detachedText = target.detached ? '（detached HEAD）' : '';
  return `将基于 folder「${target.rootFolder.name}」为引用「${target.checkoutRef ?? target.displayName}」创建 worktree${detachedText}，并添加到当前 workspace。`;
}

function abbreviateWorktreeRootPath(rootPath: string): string {
  const normalizedPath = path.normalize(rootPath);
  if (normalizedPath.length <= 42) {
    return normalizedPath;
  }

  return `...${normalizedPath.slice(-39)}`;
}

function sanitizeWorktreePathSegment(value: string): string {
  const segments = value
    .trim()
    .split(/[\\/]+/u)
    .map((segment) =>
      segment
        .replace(/[\s:*?"<>|]+/gu, '-')
        .replace(/^\.+/u, '')
        .replace(/\.+$/u, '')
    )
    .filter(Boolean);

  return segments.length > 0 ? path.join(...segments) : 'worktree';
}

function resolveGitMetadataPath(rootPath: string, gitPath: string): string {
  return path.isAbsolute(gitPath) ? path.resolve(gitPath) : path.resolve(rootPath, gitPath);
}

async function resolveRealPathBestEffort(filePath: string): Promise<string> {
  try {
    return await realpath(filePath);
  } catch {
    return path.resolve(filePath);
  }
}

function resolveWorkspaceFolderByFsPath(rootPath: string): vscode.WorkspaceFolder | undefined {
  const normalizedRootPath = normalizeComparableFileSystemPath(rootPath);
  return (vscode.workspace.workspaceFolders ?? []).find(
    (folder) => normalizeComparableFileSystemPath(folder.uri.fsPath) === normalizedRootPath
  );
}

function addWorkspaceFolderIfMissing(folderPath: string): boolean {
  if (resolveWorkspaceFolderByFsPath(folderPath)) {
    return true;
  }

  return vscode.workspace.updateWorkspaceFolders(
    vscode.workspace.workspaceFolders?.length ?? 0,
    0,
    { uri: vscode.Uri.file(folderPath) }
  );
}

function removeWorkspaceFolderByFsPath(folderPath: string): 'removed' | 'missing' | 'failed' {
  const workspaceFolder = resolveWorkspaceFolderByFsPath(folderPath);
  if (!workspaceFolder) {
    return 'missing';
  }

  return vscode.workspace.updateWorkspaceFolders(workspaceFolder.index, 1) ? 'removed' : 'failed';
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (isNodeErrorWithCode(error, 'ENOENT')) {
      return false;
    }
    return true;
  }
}

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

function classifyWorktreeRepositoryError(error: unknown): WorktreeUnavailableReasonCode {
  if (isNodeErrorWithCode(error, 'ENOENT')) {
    return 'git-unavailable';
  }

  if (error instanceof Error) {
    const message = formatExecErrorMessage(error).toLowerCase();
    if (
      message.includes('needed a single revision') ||
      message.includes('ambiguous argument') ||
      message.includes('unknown revision')
    ) {
      return 'no-git-refs';
    }
    if (
      message.includes('not a git repository') ||
      message.includes('not a git work tree')
    ) {
      return 'not-git-repository';
    }
  }

  return 'unknown';
}

async function showWorktreeUnavailableModal(options: {
  code: WorktreeUnavailableReasonCode;
  rootPath?: string;
  operation: 'create' | 'remove';
  detail?: string;
  cause?: unknown;
}): Promise<void> {
  const operationLabel = options.operation === 'create' ? '新建 worktree' : '移除 worktree';
  const reason = formatWorktreeUnavailableReason(options);
  const rootDetail = options.rootPath ? `\n\n目标 folder：${options.rootPath}` : '';
  const causeDetail = options.cause ? `\n\n底层错误：${formatExecErrorMessage(options.cause)}` : '';
  const customDetail = options.detail ? `\n\n${options.detail}` : '';
  await vscode.window.showWarningMessage(
    `${operationLabel} 不可用：${reason}${rootDetail}${customDetail}${causeDetail}`,
    { modal: true }
  );
}

function formatWorktreeUnavailableReason(options: {
  code: WorktreeUnavailableReasonCode;
  operation: 'create' | 'remove';
}): string {
  switch (options.code) {
    case 'workspace-untrusted':
      return '当前 workspace 未受信任。请先信任 workspace 后再执行 git worktree 操作。';
    case 'not-file-root':
      return '当前没有本地文件系统 folder。git worktree 只能作用于本地 folder。';
    case 'not-git-repository':
      return options.operation === 'create'
        ? '当前 folder 还不是 git repository。请先初始化为 repository，或选择已有 git repository folder。'
        : '当前 folder 还不是 git repository。请先选择一个 git repository folder。';
    case 'no-git-refs':
      return '当前 git repository 还没有可用于创建 worktree 的 commit 或本地 ref。请先完成初始提交，或选择已有 commit 的 repository。';
    case 'not-linked-worktree':
      return '当前 folder 不是可移除的 linked git worktree。请确认它是通过 git worktree 创建的 folder。';
    case 'git-unavailable':
      return '当前环境无法找到 git 命令。请先安装 git 并确保 VS Code extension host 能访问 git。';
    case 'unknown':
      return '无法确认当前 folder 是否支持 git worktree。';
  }
}

function formatExecErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const stderrValue = 'stderr' in error ? error.stderr : undefined;
    const stderr = typeof stderrValue === 'string'
      ? stderrValue.trim()
      : Buffer.isBuffer(stderrValue)
        ? stderrValue.toString('utf8').trim()
        : '';
    return stderr || error.message;
  }

  return String(error);
}

interface SidebarNodeQuickPickItem extends vscode.QuickPickItem {
  nodeId: string;
}

interface SidebarSessionQuickPickItem extends vscode.QuickPickItem {
  provider: AgentProviderKind;
  sessionId: string;
  titleOverride?: string;
  action?: 'resume' | 'fork';
}

async function showSidebarNodeListQuickPick(panelManager: CanvasPanelManager): Promise<void> {
  const nodes = panelManager.getCanvasNodes();
  const nodesById = new Map(nodes.map((node) => [node.id, node] as const));
  const items = getCanvasSidebarNodeListItems(
    panelManager.getCanvasSidebarNodeListSnapshot(),
    panelManager.getWorkspaceFoldersForDisplay()
  );
  if (items.length === 0) {
    await vscode.window.showInformationMessage('当前画布还没有可定位的非文件节点。');
    return;
  }

  const picked = await vscode.window.showQuickPick<SidebarNodeQuickPickItem>(
    items.map((item) => ({
      label: item.label,
      description: item.attentionPending ? `${item.description} · 有提醒` : item.description,
      detail: buildSidebarNodeQuickPickDetail(nodesById.get(item.nodeId)),
      nodeId: item.nodeId
    })),
    {
      placeHolder: '选择一个节点并定位到画布',
      matchOnDescription: true,
      matchOnDetail: true
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
  const items = await sidebarSessionHistoryView.getSessionHistoryItems();
  if (items.length === 0) {
    await vscode.window.showInformationMessage('当前 workspace 还没有可恢复的 Codex / Claude Code 会话。');
    return;
  }

  const picked = await vscode.window.showQuickPick<SidebarSessionQuickPickItem>(
    items.flatMap((item) => [
      {
        label: item.title,
        description: '恢复',
        detail: buildSidebarSessionQuickPickDetail(item.timestampLabel),
        provider: item.provider,
        sessionId: item.sessionId,
        titleOverride: item.title,
        action: 'resume' as const
      },
      {
        label: item.title,
        description: '分叉',
        detail: buildSidebarSessionQuickPickDetail(item.timestampLabel),
        provider: item.provider,
        sessionId: item.sessionId,
        titleOverride: item.title,
        action: 'fork' as const
      }
    ]),
    {
      title: restoreBlockReason,
      placeHolder: restoreBlockReason
        ? '当前为只读查看模式；可浏览历史会话，但不能恢复或分叉为新 Agent 节点'
        : '选择一条历史会话并恢复或分叉为新节点',
      matchOnDetail: true
    }
  );
  if (!picked) {
    return;
  }

  if (picked.action === 'fork') {
    const result = await panelManager.forkAgentSessionFromHistory({
      provider: picked.provider,
      sessionId: picked.sessionId,
      title: picked.titleOverride
    });
    if (!result.forked && result.errorMessage) {
      await vscode.window.showWarningMessage(result.errorMessage);
    }
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

function buildSidebarNodeQuickPickDetail(node: CanvasNodeSummary | undefined): string | undefined {
  if (!node || !isCanvasCreatableNodeKind(node.kind)) {
    return undefined;
  }

  const parts = [humanizeNodeKind(node.kind)];
  if (node.kind === 'agent') {
    const provider = node.metadata?.agent?.provider;
    const resumeSessionId = node.metadata?.agent?.resumeSessionId?.trim();
    if (provider) {
      parts.push(providerLabel(provider));
    }
    if (resumeSessionId) {
      parts.push(resumeSessionId);
    }
  }

  return parts.join(' · ');
}

function buildSidebarSessionQuickPickDetail(timestampLabel: string): string {
  return timestampLabel;
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
  action?: 'create-custom';
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
  let explicitPresetSelection: Exclude<AgentLaunchPresetKind, 'custom'> = 'default';
  while (queuedQuickPickSelectionIds.length > 0) {
    const nextSelectionId = queuedQuickPickSelectionIds[0];
    if (!nextSelectionId?.startsWith('agent-launch-')) {
      break;
    }

    queuedQuickPickSelectionIds.shift();
    if (nextSelectionId === 'agent-launch-accept-current') {
      return createAgentRequestFromCommandLine(provider, launchDefaults, commandLine, explicitPresetSelection);
    }
    if (nextSelectionId === 'agent-launch-apply-default') {
      commandLine = presetCommandLines.default;
      explicitPresetSelection = 'default';
      continue;
    }
    if (nextSelectionId === 'agent-launch-apply-resume') {
      commandLine = presetCommandLines.resume;
      explicitPresetSelection = 'resume';
      continue;
    }
    if (nextSelectionId === 'agent-launch-apply-yolo') {
      commandLine = presetCommandLines.yolo;
      explicitPresetSelection = 'yolo';
      continue;
    }
    if (nextSelectionId === 'agent-launch-apply-sandbox') {
      commandLine = presetCommandLines.sandbox;
      explicitPresetSelection = 'sandbox';
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
    const items = buildAgentLaunchQuickPickItems(presetCommandLines);
    const customCreateItem = items.find((item) => item.action === 'create-custom');
    const presetItems = items.filter((item) => item.launchPreset);
    const defaultPresetItem = presetItems.find((item) => item.launchPreset === 'default');
    const baseTitle = `配置 ${providerLabel(provider)} 启动命令`;
    let resolved = false;
    let explicitPresetSelection: Exclude<AgentLaunchPresetKind, 'custom'> = 'default';
    let presetValueChange: Exclude<AgentLaunchPresetKind, 'custom'> | undefined = 'default';

    const finish = (result: CreateNodeRequest | 'back' | undefined): void => {
      if (resolved) {
        return;
      }
      resolved = true;
      quickPick.hide();
      quickPick.dispose();
      resolve(result);
    };

    const updateTitle = (): void => {
      const validation = validateAgentCommandLine(quickPick.value, provider, launchDefaults);
      quickPick.title = validation.valid ? baseTitle : `${baseTitle} · ${validation.error}`;
    };

    const focusCustomCreateItem = (): void => {
      if (customCreateItem) {
        quickPick.activeItems = [customCreateItem];
      }
    };

    const focusPresetItem = (launchPreset: Exclude<AgentLaunchPresetKind, 'custom'>): void => {
      const presetItem = presetItems.find((item) => item.launchPreset === launchPreset);
      if (presetItem) {
        quickPick.activeItems = [presetItem];
      }
    };

    const applyPreset = (launchPreset: Exclude<AgentLaunchPresetKind, 'custom'>): void => {
      explicitPresetSelection = launchPreset;
      presetValueChange = launchPreset;
      quickPick.value = presetCommandLines[launchPreset];
      updateTitle();
      focusPresetItem(launchPreset);
    };

    const createCustomRequest = (): CreateNodeRequest => ({
      kind: 'agent',
      agentProvider: provider,
      agentLaunchPreset: 'custom',
      agentCustomLaunchCommand: quickPick.value.trim()
    });

    quickPick.title = baseTitle;
    quickPick.placeholder = '编辑完整启动命令；手动编辑后使用自定义命令创建';
    quickPick.matchOnDescription = true;
    quickPick.matchOnDetail = true;
    quickPick.value = presetCommandLines.default;
    quickPick.items = items;
    quickPick.buttons = [vscode.QuickInputButtons.Back];
    quickPick.ignoreFocusOut = true;

    quickPick.onDidChangeValue((value) => {
      updateTitle();
      if (presetValueChange && value === presetCommandLines[presetValueChange]) {
        focusPresetItem(presetValueChange);
        presetValueChange = undefined;
        return;
      }

      presetValueChange = undefined;
      focusCustomCreateItem();
    });

    quickPick.onDidAccept(() => {
      const activeItem = quickPick.activeItems[0] ?? customCreateItem;
      if (activeItem?.launchPreset) {
        if (quickPick.value.trim() === presetCommandLines[activeItem.launchPreset].trim()) {
          finish(createAgentRequestFromCommandLine(provider, launchDefaults, quickPick.value, activeItem.launchPreset));
          return;
        }

        applyPreset(activeItem.launchPreset);
        return;
      }

      const validation = validateAgentCommandLine(quickPick.value, provider, launchDefaults);
      if (!validation.valid) {
        updateTitle();
        focusCustomCreateItem();
        return;
      }

      if (activeItem?.action === 'create-custom') {
        finish(createCustomRequest());
        return;
      }

      finish(createAgentRequestFromCommandLine(provider, launchDefaults, quickPick.value, explicitPresetSelection));
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
    if (defaultPresetItem) {
      quickPick.activeItems = [defaultPresetItem];
    }
    quickPick.show();
    focusPresetItem('default');
  });
}

function buildAgentLaunchQuickPickItems(
  presetCommandLines: Record<Exclude<AgentLaunchPresetKind, 'custom'>, string>
): AgentLaunchQuickPickItem[] {
  return [
    {
      label: '使用自定义命令创建',
      description: 'Enter',
      detail: '按输入框当前命令创建自定义 Agent',
      selectionId: 'agent-launch-accept-current',
      action: 'create-custom',
      alwaysShow: true
    },
    {
      label: '快捷替换启动命令',
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
  commandLine: string,
  explicitPresetSelection?: Exclude<AgentLaunchPresetKind, 'custom'>
): CreateNodeRequest {
  if (
    explicitPresetSelection &&
    matchesAgentCommandLinePreset(provider, commandLine, launchDefaults, explicitPresetSelection)
  ) {
    return {
      kind: 'agent',
      agentProvider: provider,
      agentLaunchPreset: explicitPresetSelection
    };
  }

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

async function applyTemplateFromCommand(
  panelManager: CanvasPanelManager,
  templateIdValue: unknown
): Promise<void> {
  const selectedTemplate = await resolveCanvasTemplateFromCommand(
    panelManager,
    templateIdValue,
    '选择一个模板并应用到当前画布'
  );
  if (!selectedTemplate) {
    return;
  }

  const appliedNodeIds = await panelManager.applyCanvasTemplateById(selectedTemplate.template.id);
  await panelManager.revealOrCreateCurrentCanvasSurface();
  panelManager.focusCanvasTemplateNodeGroup(appliedNodeIds);
}

async function resetToTemplateFromCommand(
  panelManager: CanvasPanelManager,
  templateIdValue: unknown
): Promise<void> {
  const selectedTemplate = await resolveCanvasTemplateFromCommand(
    panelManager,
    templateIdValue,
    '选择一个模板并重置当前画布'
  );
  if (!selectedTemplate) {
    return;
  }

  const appliedNodeIds = await panelManager.resetCanvasTemplateByIdWithConfirmation(selectedTemplate.template.id);
  if (appliedNodeIds) {
    await panelManager.revealOrCreateCurrentCanvasSurface();
    panelManager.focusCanvasTemplateNodeGroup(appliedNodeIds);
  }
}

async function saveCurrentCanvasAsTemplateFromCommand(panelManager: CanvasPanelManager): Promise<void> {
  if (!panelManager.getCanvasNodes().some((node) => isTemplateCompatibleNodeKind(node.kind))) {
    await vscode.window.showInformationMessage('当前画布还没有可保存到模板的 Agent / Terminal / Note 节点。');
    return;
  }

  const canvasNodes = panelManager.getCanvasNodes();
  const formResult = await showCanvasTemplateSaveForm({
    mode: 'save',
    title: '保存当前画布为模板',
    submitLabel: '保存模板',
    storageLocations: panelManager.getCanvasTemplateStorageLocations(),
    associatedNoteNodes: panelManager.getCanvasTemplateAssociatedNoteSaveItems(),
    agentNodes: canvasNodes
      .filter(
        (node): node is typeof node & {
          kind: 'agent';
          metadata: NonNullable<typeof node.metadata> & { agent: NonNullable<NonNullable<typeof node.metadata>['agent']> };
        } => node.kind === 'agent' && !!node.metadata?.agent
      )
      .map((node) => ({
        nodeId: node.id,
        title: node.title,
        currentProvider: node.metadata.agent.provider
      }))
  });
  if (!formResult) {
    return;
  }

  const targetStorageLocation = panelManager
    .getCanvasTemplateStorageLocations()
    .find((location) => location.id === formResult.targetStorageLocationId);
  if (!targetStorageLocation) {
    throw new Error('目标模板保存位置不存在。');
  }

  const savedTemplate = await panelManager.saveCurrentCanvasAsTemplate(formResult.name, formResult.agentProviderSelection, {
    targetRootPath: targetStorageLocation.rootPath,
    associatedNoteSaveModes: formResult.associatedNoteSaveModes
  });
  await vscode.window.showInformationMessage(`已保存模板「${savedTemplate.template.name}」。`);
}

async function importCanvasTemplateFromCommand(panelManager: CanvasPanelManager): Promise<void> {
  const selectedUris = await vscode.window.showOpenDialog({
    canSelectMany: false,
    canSelectFiles: true,
    canSelectFolders: false,
    filters: {
      JSON: ['json']
    },
    openLabel: '导入模板'
  });
  const selectedUri = selectedUris?.[0];
  if (!selectedUri) {
    return;
  }

  const importedTemplate = await panelManager.readCanvasTemplateFromPath(selectedUri.fsPath);
  const storageLocations = panelManager.getCanvasTemplateStorageLocations();
  let draftFormState:
    | {
        name: string;
        targetStorageLocationId: string;
      }
    | undefined;

  while (true) {
    const formResult = await showCanvasTemplateSaveForm({
      mode: 'import',
      title: '导入模板',
      submitLabel: '导入模板',
      initialName: draftFormState?.name ?? importedTemplate.template.name,
      initialTargetStorageLocationId: draftFormState?.targetStorageLocationId,
      storageLocations,
      agentNodes: []
    });
    if (!formResult) {
      return;
    }

    const targetStorageLocation = storageLocations.find((location) => location.id === formResult.targetStorageLocationId);
    if (!targetStorageLocation) {
      throw new Error('目标模板保存位置不存在。');
    }

    const catalog = await panelManager.getCanvasTemplateCatalog();
    const conflictingTemplates = catalog.templates.filter((candidate) => candidate.template.name === formResult.name);
    const builtinConflict = conflictingTemplates.find((candidate) => candidate.template.category === 'builtin');
    const userConflicts = conflictingTemplates.filter((candidate) => candidate.template.category === 'user');

    draftFormState = {
      name: formResult.name,
      targetStorageLocationId: formResult.targetStorageLocationId
    };

    if (builtinConflict) {
      const action = await vscode.window.showWarningMessage(
        `模板名「${formResult.name}」已被内置模板占用，不能覆盖内置模板。`,
        '返回表单修改名称'
      );
      if (action === '返回表单修改名称') {
        continue;
      }
      return;
    }

    if (userConflicts.length > 1) {
      const action = await vscode.window.showWarningMessage(
        `当前已有多个同名用户模板「${formResult.name}」。请返回表单修改名称后再导入。`,
        '返回表单修改名称'
      );
      if (action === '返回表单修改名称') {
        continue;
      }
      return;
    }

    let overwriteTemplateId: string | undefined;
    if (userConflicts.length === 1) {
      const overwriteConflict = userConflicts[0];
      const action = await vscode.window.showWarningMessage(
        `模板名「${formResult.name}」已存在。你可以覆盖已有用户模板，或返回表单修改名称。`,
        '覆盖现有模板',
        '返回表单修改名称'
      );
      if (!action) {
        return;
      }

      if (action === '返回表单修改名称') {
        continue;
      }
      overwriteTemplateId = overwriteConflict.template.id;
    }

    const savedTemplate = await panelManager.importCanvasTemplateFromPath(selectedUri.fsPath, {
      overwriteTemplateId,
      nameOverride: formResult.name,
      targetRootPath: targetStorageLocation.rootPath
    });
    await vscode.window.showInformationMessage(`已导入模板「${savedTemplate.template.name}」。`);
    return;
  }
}

async function exportCanvasTemplateFromCommand(
  panelManager: CanvasPanelManager,
  templateIdValue: unknown
): Promise<void> {
  const selectedTemplate = await resolveCanvasTemplateFromCommand(
    panelManager,
    templateIdValue,
    '选择一个模板并导出为 JSON'
  );
  if (!selectedTemplate) {
    return;
  }

  const defaultFileName = `${sanitizeCanvasTemplateFileStem(
    selectedTemplate.template.name,
    selectedTemplate.template.id
  )}.json`;
  const targetUri = await vscode.window.showSaveDialog({
    saveLabel: '导出模板',
    defaultUri: vscode.Uri.file(path.join(panelManager.getUserCanvasTemplateDirectoryPath(), defaultFileName)),
    filters: {
      JSON: ['json']
    }
  });
  if (!targetUri) {
    return;
  }

  await panelManager.exportCanvasTemplateById(selectedTemplate.template.id, targetUri);
  await vscode.window.showInformationMessage(`已导出模板「${selectedTemplate.template.name}」。`);
}

async function deleteCanvasTemplateFromCommand(
  panelManager: CanvasPanelManager,
  templateIdValue: unknown
): Promise<void> {
  const selectedTemplate = await resolveCanvasTemplateFromCommand(
    panelManager,
    templateIdValue,
    '选择一个用户模板并删除'
  );
  if (!selectedTemplate) {
    return;
  }
  if (selectedTemplate.template.category !== 'user') {
    throw new Error('内置模板不能删除。');
  }

  const confirmed = await vscode.window.showWarningMessage(
    `删除模板「${selectedTemplate.template.name}」后将无法恢复该用户模板文件。`,
    { modal: true },
    '继续删除'
  );
  if (confirmed !== '继续删除') {
    return;
  }

  await panelManager.deleteCanvasTemplateById(selectedTemplate.template.id);
  await vscode.window.showInformationMessage(`已删除模板「${selectedTemplate.template.name}」。`);
}

async function setDefaultCanvasTemplateFromCommand(
  panelManager: CanvasPanelManager,
  templateIdValue: unknown
): Promise<void> {
  const selectedTemplate = await resolveCanvasTemplateFromCommand(
    panelManager,
    templateIdValue,
    '选择一个模板设为默认模板'
  );
  if (!selectedTemplate) {
    return;
  }

  await panelManager.setDefaultCanvasTemplateById(selectedTemplate.template.id);
  await vscode.window.showInformationMessage(`已将默认模板设置为「${selectedTemplate.template.name}」。`);
}

async function resolveCanvasTemplateFromCommand(
  panelManager: CanvasPanelManager,
  templateIdValue: unknown,
  placeHolder: string
): Promise<CanvasStoredTemplate | undefined> {
  const explicitTemplateId = normalizeCanvasTemplateIdValue(templateIdValue);
  if (explicitTemplateId) {
    const catalog = await panelManager.getCanvasTemplateCatalog();
    const selectedTemplate = catalog.templates.find((candidate) => candidate.template.id === explicitTemplateId);
    if (!selectedTemplate) {
      throw new Error('目标模板不存在。');
    }
    return selectedTemplate;
  }

  return pickCanvasTemplate(panelManager, placeHolder);
}

async function pickCanvasTemplate(
  panelManager: CanvasPanelManager,
  placeHolder: string
): Promise<CanvasStoredTemplate | undefined> {
  const catalog = await panelManager.getCanvasTemplateCatalog();
  if (catalog.templates.length === 0) {
    await vscode.window.showInformationMessage('当前还没有可用模板。');
    return undefined;
  }

  const defaultTemplateId = panelManager.getDefaultCanvasTemplateId();
  const picked = await vscode.window.showQuickPick<CanvasTemplateQuickPickItem>(
    catalog.templates.map((storedTemplate) => ({
      label: storedTemplate.template.name,
      description: `${storedTemplate.template.category === 'builtin' ? '内置' : '用户'} · ${formatCanvasTemplateStats(storedTemplate.template)}${storedTemplate.template.id === defaultTemplateId ? ' · 默认' : ''}`,
      detail: storedTemplate.template.nodes.map((node) => `${humanizeNodeKind(node.kind)}: ${node.title}`).join(' / '),
      templateId: storedTemplate.template.id
    })),
    {
      placeHolder,
      matchOnDescription: true,
      matchOnDetail: true
    }
  );
  if (!picked) {
    return undefined;
  }

  return catalog.templates.find((candidate) => candidate.template.id === picked.templateId);
}

async function showCanvasTemplateError(title: string, error: unknown): Promise<void> {
  await vscode.window.showErrorMessage(`${title}：${error instanceof Error ? error.message : String(error)}`);
}

function normalizeCanvasTemplateIdValue(value: unknown): string | undefined {
  if (isRecord(value) && typeof value.templateId === 'string' && value.templateId.trim().length > 0) {
    return value.templateId.trim();
  }

  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function isTemplateCompatibleNodeKind(value: string): value is 'agent' | 'terminal' | 'note' {
  return value === 'agent' || value === 'terminal' || value === 'note';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function registerTestCommands(
  context: vscode.ExtensionContext,
  panelManager: CanvasPanelManager,
  sidebarNodeListView: CanvasSidebarNodeListView,
  sidebarSessionHistoryView: CanvasSidebarSessionHistoryView
): void {
  if (!isTestHarnessMode(context.extensionMode)) {
    return;
  }

  context.subscriptions.push(
    vscode.commands.registerCommand(TEST_COMMAND_IDS.getDebugState, () => panelManager.getDebugSnapshot()),
    vscode.commands.registerCommand(TEST_COMMAND_IDS.getSidebarSummaryItems, () =>
      getCanvasSidebarSummaryItems(panelManager.getSidebarState())
    ),
    vscode.commands.registerCommand(TEST_COMMAND_IDS.getSidebarNodeListItems, () =>
      getCanvasSidebarNodeListItems(
        panelManager.getCanvasSidebarNodeListSnapshot(),
        panelManager.getWorkspaceFoldersForDisplay()
      )
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
    vscode.commands.registerCommand(TEST_COMMAND_IDS.dumpHostDiagnostics, () => panelManager.dumpCurrentHostDiagnostics()),
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
      (provider?: unknown, requestedCommand?: unknown, workspaceCwd?: unknown, shellAuthority?: unknown) => {
        if (provider !== 'codex' && provider !== 'claude') {
          throw new Error('测试命令 devSessionCanvas.__test.getAgentCliResolutionCacheKey 需要有效的 provider。');
        }
        if (typeof requestedCommand !== 'string' || requestedCommand.trim().length === 0) {
          throw new Error('测试命令 devSessionCanvas.__test.getAgentCliResolutionCacheKey 需要有效的 requestedCommand。');
        }

        return panelManager.getAgentCliResolutionCacheKeyForTest(
          provider,
          requestedCommand,
          typeof workspaceCwd === 'string' && workspaceCwd.trim().length > 0 ? workspaceCwd : undefined,
          typeof shellAuthority === 'string' && shellAuthority.trim().length > 0 ? shellAuthority : undefined
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
    vscode.commands.registerCommand(TEST_COMMAND_IDS.runWebviewLifecycleRaceDiagnostics, () =>
      panelManager.runWebviewLifecycleRaceDiagnosticsForTest()
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
    vscode.commands.registerCommand(TEST_COMMAND_IDS.getCanvasTemplateItems, async () => {
      const catalog = await panelManager.getCanvasTemplateCatalog();
      return {
        defaultTemplateId: panelManager.getDefaultCanvasTemplateId(),
        templates: catalog.templates,
        issues: catalog.issues
      };
    }),
    vscode.commands.registerCommand(
      TEST_COMMAND_IDS.applyCanvasTemplate,
      async (templateId?: unknown, reset?: unknown) => {
        const normalizedTemplateId = normalizeCanvasTemplateIdValue(templateId);
        if (!normalizedTemplateId) {
          throw new Error('测试命令 devSessionCanvas.__test.applyCanvasTemplate 需要有效的模板 ID。');
        }

        await panelManager.applyCanvasTemplateById(normalizedTemplateId, {
          reset: reset === true
        });
        return panelManager.getDebugSnapshot();
      }
    ),
    vscode.commands.registerCommand(
      TEST_COMMAND_IDS.saveCanvasAsTemplate,
      async (name?: unknown, agentProviderMode?: unknown, overwriteTemplateId?: unknown) => {
        if (typeof name !== 'string' || name.trim().length === 0) {
          throw new Error('测试命令 devSessionCanvas.__test.saveCanvasAsTemplate 需要有效的模板名称。');
        }
        if (agentProviderMode !== 'default' && agentProviderMode !== 'preserve') {
          throw new Error('测试命令 devSessionCanvas.__test.saveCanvasAsTemplate 需要有效的 Provider 保存模式。');
        }

        return panelManager.saveCurrentCanvasAsTemplate(name.trim(), agentProviderMode, {
          overwriteTemplateId: normalizeCanvasTemplateIdValue(overwriteTemplateId)
        });
      }
    ),
    vscode.commands.registerCommand(TEST_COMMAND_IDS.setDefaultTemplate, async (templateId?: unknown) => {
      const normalizedTemplateId = normalizeCanvasTemplateIdValue(templateId);
      if (!normalizedTemplateId) {
        throw new Error('测试命令 devSessionCanvas.__test.setDefaultTemplate 需要有效的模板 ID。');
      }

      await panelManager.setDefaultCanvasTemplateById(normalizedTemplateId);
      return panelManager.getDefaultCanvasTemplateId();
    }),
    vscode.commands.registerCommand(TEST_COMMAND_IDS.deleteCanvasTemplate, async (templateId?: unknown) => {
      const normalizedTemplateId = normalizeCanvasTemplateIdValue(templateId);
      if (!normalizedTemplateId) {
        throw new Error('测试命令 devSessionCanvas.__test.deleteCanvasTemplate 需要有效的模板 ID。');
      }

      await panelManager.deleteCanvasTemplateById(normalizedTemplateId);
      return panelManager.getDefaultCanvasTemplateId();
    }),
    vscode.commands.registerCommand(
      TEST_COMMAND_IDS.exportCanvasTemplateToPath,
      async (templateId?: unknown, targetPath?: unknown) => {
        const normalizedTemplateId = normalizeCanvasTemplateIdValue(templateId);
        if (!normalizedTemplateId) {
          throw new Error('测试命令 devSessionCanvas.__test.exportCanvasTemplateToPath 需要有效的模板 ID。');
        }
        if (typeof targetPath !== 'string' || targetPath.trim().length === 0) {
          throw new Error('测试命令 devSessionCanvas.__test.exportCanvasTemplateToPath 需要有效的目标路径。');
        }

        await panelManager.exportCanvasTemplateById(normalizedTemplateId, targetPath.trim());
        return targetPath.trim();
      }
    ),
    vscode.commands.registerCommand(
      TEST_COMMAND_IDS.importCanvasTemplateFromPath,
      async (sourcePath?: unknown, overwriteTemplateId?: unknown, nameOverride?: unknown) => {
        if (typeof sourcePath !== 'string' || sourcePath.trim().length === 0) {
          throw new Error('测试命令 devSessionCanvas.__test.importCanvasTemplateFromPath 需要有效的源路径。');
        }

        return panelManager.importCanvasTemplateFromPath(sourcePath.trim(), {
          overwriteTemplateId: normalizeCanvasTemplateIdValue(overwriteTemplateId),
          nameOverride: typeof nameOverride === 'string' && nameOverride.trim().length > 0 ? nameOverride.trim() : undefined
        });
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
        resumeRequested?: unknown,
        rawOptions?: unknown
      ) => {
        if (kind !== 'agent' && kind !== 'terminal') {
          throw new Error('测试命令 devSessionCanvas.__test.startExecutionSession 需要有效的执行节点类型。');
        }
        if (typeof nodeId !== 'string' || !nodeId) {
          throw new Error('测试命令 devSessionCanvas.__test.startExecutionSession 需要有效的节点 ID。');
        }

        const options = typeof rawOptions === 'object' && rawOptions !== null ? rawOptions as Record<string, unknown> : {};
        return panelManager.startExecutionSessionForTest({
          kind,
          nodeId,
          cols: typeof cols === 'number' ? cols : undefined,
          rows: typeof rows === 'number' ? rows : undefined,
          provider: provider === 'codex' || provider === 'claude' ? provider : undefined,
          resumeRequested: resumeRequested === true,
          cwdOverride:
            typeof options.cwdOverride === 'string' ? options.cwdOverride : undefined,
          injectAgentOutputChunk:
            typeof options.injectAgentOutputChunk === 'string' ? options.injectAgentOutputChunk : undefined,
          injectAgentExistingOutput:
            typeof options.injectAgentExistingOutput === 'string' ? options.injectAgentExistingOutput : undefined,
          injectAgentOutputChunks: Array.isArray(options.injectAgentOutputChunks)
            ? options.injectAgentOutputChunks.filter((item): item is string => typeof item === 'string')
            : undefined
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
    vscode.commands.registerCommand(
      TEST_COMMAND_IDS.createNode,
      (kind?: unknown, agentProvider?: unknown, rawOptions?: unknown) => {
        if (!isCanvasCreatableNodeKind(kind)) {
          throw new Error('测试命令 devSessionCanvas.__test.createNode 需要有效的节点类型。');
        }

        const options = typeof rawOptions === 'object' && rawOptions !== null ? rawOptions as Record<string, unknown> : {};
        panelManager.createNodeForTest(kind, undefined, {
          agentProvider: isAgentProviderKind(agentProvider) ? agentProvider : undefined,
          agentLaunchPreset: isAgentLaunchPresetKind(options.agentLaunchPreset)
            ? options.agentLaunchPreset
            : undefined,
          agentCustomLaunchCommand:
            typeof options.agentCustomLaunchCommand === 'string' ? options.agentCustomLaunchCommand : undefined,
          cwdOverride: typeof options.cwdOverride === 'string' ? options.cwdOverride : undefined,
          titleOverride: typeof options.titleOverride === 'string' ? options.titleOverride : undefined
        });
        return panelManager.getDebugSnapshot();
      }
    ),
    vscode.commands.registerCommand(TEST_COMMAND_IDS.resetState, async () => {
      await panelManager.resetState({
        clearAgentCliResolutionCache: true
      });
      return panelManager.getDebugSnapshot();
    })
  );
}

function parseCanvasSurfaceLocation(value: unknown): CanvasSurfaceLocation | undefined {
  return value === 'editor' || value === 'panel' ? value : undefined;
}

function formatWebviewLifecycleDumpStatus(status: WebviewLifecycleDumpStatus): string {
  switch (status) {
    case 'healthy':
      return '健康';
    case 'standby':
      return '非活动承载面';
    case 'initializing':
      return '初始化中';
    case 'attention':
      return '有可追踪线索';
    case 'blocked':
      return '可能阻塞';
    case 'not-attached':
      return '未 attached';
  }
}
