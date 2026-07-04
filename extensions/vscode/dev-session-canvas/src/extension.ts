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
import { sanitizeCanvasTemplateFileStem, type CanvasTemplate } from './common/canvasTemplates';
import {
  formatGitWorktreeListEntryRef,
  groupGitWorktreeRepositoryCandidates,
  parseGitWorktreeListPorcelain,
  type GitWorktreeListEntry
} from './common/gitWorktrees';
import {
  CanvasPanelManager,
  type CanvasSurfaceLocation,
  type WorkspaceRootCanvasRemovalImpact
} from './panel/CanvasPanelManager';
import { CanvasTemplateMarketplacePanelController } from './panel/CanvasTemplateMarketplacePanel';
import { TemplateMarketplaceClient } from './panel/TemplateMarketplaceClient';
import { localizeCanvasTemplateError } from './panel/canvasTemplateLocalization';
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
import { localizeAgentLaunchMessageDescriptor } from './panel/agentLaunchLocalization';
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

interface CanvasTemplatePickOptions {
  filter?: (template: CanvasStoredTemplate) => boolean;
  emptyMessage?: string;
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

interface WorkspaceWorktreeRepositoryCandidate {
  workspaceFolder: vscode.WorkspaceFolder;
  gitCommonDir: string;
  isLinkedWorktree: boolean;
  isRepositoryRoot: boolean;
  workspaceFolderIndex: number;
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

interface WorkspaceWorktreeCreationTarget {
  kind: 'create';
  rootFolder: vscode.WorkspaceFolder;
  branchName?: string;
  checkoutRef?: string;
  startPoint?: string;
  detached?: boolean;
  displayName: string;
  targetPath: string;
}

interface ExistingWorkspaceWorktreeTarget {
  kind: 'addExisting';
  rootFolder: vscode.WorkspaceFolder;
  targetPath: string;
  displayName: string;
  refLabel: string;
}

type WorkspaceWorktreeTarget = WorkspaceWorktreeCreationTarget | ExistingWorkspaceWorktreeTarget;

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

interface WorktreeAddExistingPlan {
  kind: 'addExisting';
  targetPath: string;
  displayName: string;
  refLabel: string;
}

type WorktreeTargetPlan = WorktreeCreationPlan | WorktreeAddExistingPlan;

interface WorktreeActionQuickPickItem extends vscode.QuickPickItem {
  type: 'createNewBranch' | 'createNewBranchFrom' | 'addExistingWorktree';
}

interface WorktreeRefQuickPickItem extends vscode.QuickPickItem {
  type: 'ref';
  ref: GitWorktreeRef;
}

type WorktreeQuickPickItem = WorktreeActionQuickPickItem | WorktreeRefQuickPickItem;

interface ExistingWorktreeQuickPickItem extends vscode.QuickPickItem {
  entry: GitWorktreeListEntry;
}

function resolveTerminalShellConfigurationTarget(): vscode.ConfigurationTarget {
  return vscode.workspace.workspaceFile || (vscode.workspace.workspaceFolders?.length ?? 0) > 0
    ? vscode.ConfigurationTarget.Workspace
    : vscode.ConfigurationTarget.Global;
}

function describeTerminalShellConfigurationTarget(target: vscode.ConfigurationTarget): string {
  return target === vscode.ConfigurationTarget.Workspace
    ? vscode.l10n.t('the current workspace')
    : vscode.l10n.t('the current device');
}

export function activate(context: vscode.ExtensionContext): void {
  const panelManager = new CanvasPanelManager(context);
  const templateMarketplaceClient = new TemplateMarketplaceClient(panelManager, context, context.extensionMode);
  const templateMarketplacePanel = new CanvasTemplateMarketplacePanelController(
    templateMarketplaceClient,
    context.extensionUri,
    context.extensionMode
  );
  activePanelManager = panelManager;
  const sidebarSummaryView = new CanvasSidebarView(panelManager);
  const sidebarActionsView = new CanvasSidebarActionsView(panelManager);
  const sidebarTemplateView = new CanvasSidebarTemplateView(panelManager, context.extensionUri, {
    client: templateMarketplaceClient,
    openTemplateDetail: (templateIdOrSlug, versionId, sourceUrl, options) => {
      templateMarketplacePanel.openTemplateDetail(templateIdOrSlug, versionId, sourceUrl, options);
    }
  });
  const sidebarNodeListView = new CanvasSidebarNodeListView(panelManager, context.extensionUri, context.workspaceState);
  const sidebarSessionHistoryView = new CanvasSidebarSessionHistoryView(
    panelManager,
    context.extensionUri,
    context.workspaceState
  );

  registerCommand(context, COMMAND_IDS.dumpHostDiagnostics, async () => {
    const dumpResult = await panelManager.dumpCurrentHostDiagnostics();
    const revealAction = vscode.l10n.t('Reveal in File Explorer');
    const openLifecycleSummaryAction = vscode.l10n.t('Open lifecycle summary');
    const openPerformanceDiagnosticsAction = vscode.l10n.t('Open performance diagnostics');
    const lifecycleStatus = formatWebviewLifecycleDumpStatus(dumpResult.webviewLifecycleStatus);
    const panelRestoreHint = dumpResult.webviewLifecyclePanelRestoreLikelyAffected
      ? vscode.l10n.t('; panel restore may still be blocked by lifecycle state')
      : '';
    const selection = await vscode.window.showInformationMessage(
      vscode.l10n.t('Host diagnostics were written to {outputDir}. Webview lifecycle: {status}{hint}', {
        outputDir: dumpResult.outputDir,
        status: lifecycleStatus,
        hint: panelRestoreHint
      }),
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
    templateMarketplacePanel,
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

  context.subscriptions.push(
    vscode.window.registerUriHandler({
      async handleUri(uri) {
        try {
          templateMarketplacePanel.openTemplateDetailFromUri(uri);
        } catch (error) {
          await showCanvasTemplateError(vscode.l10n.t('Failed to open marketplace template details'), error);
        }
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

  registerCommand(context, COMMAND_IDS.openTemplateMarketplace, async () => {
    templateMarketplacePanel.reveal();
  });

  registerCommand(context, COMMAND_IDS.publishTemplateToMarketplace, async (templateId?: unknown) => {
    try {
      const explicitTemplateId = normalizeCanvasTemplateIdValue(templateId);
      const templateIdOrSlug = readTemplatePublishVersionTarget(templateId);
      templateMarketplacePanel.openTemplatePublishForm(explicitTemplateId, { templateIdOrSlug });
      return explicitTemplateId ? { templateId: explicitTemplateId } : undefined;
    } catch (error) {
      await showCanvasTemplateError(vscode.l10n.t('Failed to open template publish form'), error);
    }
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
        await showCanvasTemplateError(vscode.l10n.t('Failed to apply template'), error);
      }
    }),
    vscode.commands.registerCommand(COMMAND_IDS.applyDefaultTemplate, async () => {
      try {
        const appliedNodeIds = await panelManager.applyDefaultCanvasTemplate();
        await panelManager.revealOrCreateCurrentCanvasSurface();
        panelManager.focusCanvasTemplateNodeGroup(appliedNodeIds);
      } catch (error) {
        await showCanvasTemplateError(vscode.l10n.t('Failed to apply default template'), error);
      }
    }),
    vscode.commands.registerCommand(COMMAND_IDS.resetToTemplate, async (templateId?: unknown) => {
      try {
        await resetToTemplateFromCommand(panelManager, templateId);
      } catch (error) {
        await showCanvasTemplateError(vscode.l10n.t('Failed to reset to template'), error);
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
        await showCanvasTemplateError(vscode.l10n.t('Failed to reset to default template'), error);
      }
    }),
    vscode.commands.registerCommand(COMMAND_IDS.saveCanvasAsTemplate, async () => {
      try {
        await saveCurrentCanvasAsTemplateFromCommand(panelManager);
      } catch (error) {
        await showCanvasTemplateError(vscode.l10n.t('Failed to save template'), error);
      }
    }),
    vscode.commands.registerCommand(COMMAND_IDS.importTemplate, async () => {
      try {
        await importCanvasTemplateFromCommand(panelManager);
      } catch (error) {
        await showCanvasTemplateError(vscode.l10n.t('Failed to import template'), error);
      }
    }),
    vscode.commands.registerCommand(COMMAND_IDS.exportTemplate, async (templateId?: unknown) => {
      try {
        await exportCanvasTemplateFromCommand(panelManager, templateId);
      } catch (error) {
        await showCanvasTemplateError(vscode.l10n.t('Failed to export template'), error);
      }
    }),
    vscode.commands.registerCommand(COMMAND_IDS.deleteTemplate, async (templateId?: unknown) => {
      try {
        await deleteCanvasTemplateFromCommand(panelManager, templateId);
      } catch (error) {
        await showCanvasTemplateError(vscode.l10n.t('Failed to delete template'), error);
      }
    }),
    vscode.commands.registerCommand(COMMAND_IDS.setDefaultTemplate, async (templateId?: unknown) => {
      try {
        await setDefaultCanvasTemplateFromCommand(panelManager, templateId);
      } catch (error) {
        await showCanvasTemplateError(vscode.l10n.t('Failed to set default template'), error);
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
    vscode.commands.registerCommand(
      COMMAND_IDS.removeFolderFromWorkspace,
      async (rootPath?: unknown, groupIdOrClearCanvas?: unknown, clearCanvas?: unknown) => {
        if (typeof rootPath !== 'string' || rootPath.trim().length === 0) {
          await vscode.window.showWarningMessage(vscode.l10n.t('No folder was found to remove from the workspace.'));
          return;
        }

        const confirmedClearCanvas = typeof clearCanvas === 'boolean'
          ? clearCanvas
          : typeof groupIdOrClearCanvas === 'boolean'
            ? groupIdOrClearCanvas
            : undefined;
        const commandOptions = typeof confirmedClearCanvas === 'boolean'
          ? { confirmedChoice: { clearCanvas: confirmedClearCanvas } }
          : undefined;
        await removeFolderFromWorkspaceFromCommand(
          panelManager,
          rootPath,
          commandOptions
        );
      }
    ),
    vscode.commands.registerCommand(
      COMMAND_IDS.removeWorktreeFromWorkspace,
      async (rootPath?: unknown, groupIdOrClearCanvas?: unknown, clearCanvas?: unknown) => {
        if (typeof rootPath !== 'string' || rootPath.trim().length === 0) {
          await vscode.window.showWarningMessage(vscode.l10n.t('No worktree folder was found to remove.'));
          return;
        }

        const confirmedClearCanvas = typeof clearCanvas === 'boolean'
          ? clearCanvas
          : typeof groupIdOrClearCanvas === 'boolean'
            ? groupIdOrClearCanvas
            : undefined;
        const commandOptions = typeof confirmedClearCanvas === 'boolean'
          ? { confirmedChoice: { clearCanvas: confirmedClearCanvas } }
          : undefined;
        await removeWorktreeFromWorkspaceFromCommand(
          panelManager,
          rootPath,
          commandOptions
        );
      }
    )
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
      await vscode.window.showInformationMessage(
        vscode.l10n.t('Open the Canvas and select at least two nodes or groups under the same parent first.')
      );
      return;
    }

    const requested = panelManager.createGroupFromSelectionFromCommand();
    if (!requested) {
      await vscode.window.showInformationMessage(
        vscode.l10n.t('Open the Canvas and select at least two nodes or groups under the same parent first.')
      );
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
    const resetCanvasAction = vscode.l10n.t('Continue clearing');
    const confirmed = await vscode.window.showWarningMessage(
      vscode.l10n.t(
        'Clearing the Canvas removes Canvas objects bound to the current workspace and stops running Agent / Terminal sessions.'
      ),
      { modal: true },
      resetCanvasAction
    );
    if (confirmed !== resetCanvasAction) {
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
      await vscode.window.showWarningMessage(
        vscode.l10n.t('The target node no longer exists, or it cannot be located on the Canvas right now.')
      );
    }
  };

  const centerAttentionNodeFromCommand = async (nodeId?: unknown): Promise<void> => {
    if (typeof nodeId !== 'string' || nodeId.trim().length === 0) {
      return;
    }

    const centered = await panelManager.centerAttentionNodeById(nodeId);
    if (!centered) {
      await vscode.window.showWarningMessage(
        vscode.l10n.t('The target node no longer exists, or it cannot be located on the Canvas right now.')
      );
    }
  };

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMAND_IDS.focusNode, focusNodeFromCommand),
    vscode.commands.registerCommand(COMMAND_IDS.focusAttentionNode, centerAttentionNodeFromCommand),
    vscode.commands.registerCommand(COMMAND_IDS.centerAttentionNode, centerAttentionNodeFromCommand),
    vscode.commands.registerCommand(COMMAND_IDS.focusSidebarNode, focusNodeFromCommand),
    vscode.commands.registerCommand(
      COMMAND_IDS.restoreSidebarSessionHistoryEntry,
      async (provider?: unknown, sessionId?: unknown, title?: unknown, cwd?: unknown) => {
        if (!isAgentProviderKind(provider) || typeof sessionId !== 'string' || sessionId.trim().length === 0) {
          return;
        }

        const result = await panelManager.restoreAgentSessionFromHistory({
          provider,
          sessionId,
          cwd: typeof cwd === 'string' && cwd.trim().length > 0 ? cwd : undefined,
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

  registerTestCommands(
    context,
    panelManager,
    templateMarketplacePanel,
    sidebarTemplateView,
    sidebarNodeListView,
    sidebarSessionHistoryView
  );
}

export async function deactivate(): Promise<void> {
  const panelManager = activePanelManager;
  activePanelManager = undefined;
  await panelManager?.prepareForDeactivation();
}

function registerCommand(
  context: vscode.ExtensionContext,
  commandId: string,
  handler: (...args: unknown[]) => Promise<unknown>
): void {
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
      placeHolder: vscode.l10n.t('Select the shell for embedded Terminal')
    }
  );

  if (!picked) {
    return;
  }

  if (picked.useDefault) {
    await configuration.update(CONFIG_KEYS.terminalShell, 'default', configurationTarget);
    await configuration.update(CONFIG_KEYS.terminalShellPath, '', configurationTarget);
    const defaultShellPath = detectedShells.find((shell) => shell.isDefault)?.resolvedPath ?? vscode.env.shell.trim();
    if (defaultShellPath) {
      await vscode.window.showInformationMessage(
        vscode.l10n.t('Changed the embedded Terminal shell for {target} to follow the current default shell: {path}', {
          target: targetLabel,
          path: defaultShellPath
        })
      );
    } else {
      await vscode.window.showInformationMessage(
        vscode.l10n.t('Changed the embedded Terminal shell for {target} to follow the current default shell', {
          target: targetLabel
        })
      );
    }
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
  if (persistedSelection.configuredShell === 'default') {
    await vscode.window.showInformationMessage(
      vscode.l10n.t('Updated the embedded Terminal shell for {target} to {label}: {path}', {
        target: targetLabel,
        label: picked.label,
        path: persistedSelection.configuredPath
      })
    );
  } else {
    await vscode.window.showInformationMessage(
      vscode.l10n.t(
        'Updated the embedded Terminal shell for {target} to {label}: {path} (type: {shell}; this path is preferred when launching)',
        {
          target: targetLabel,
          label: picked.label,
          path: persistedSelection.configuredPath,
          shell: persistedSelection.configuredShell
        }
      )
    );
  }
}

async function openAgentSettingsFile(kind: AgentSettingsFileKind, panelManager: CanvasPanelManager): Promise<void> {
  const descriptor = getAgentSettingsFileDescriptor(kind);
  const settingsEnvironment = await panelManager.resolveAgentSettingsFileEnvironment();
  const filePath = resolveAgentSettingsFilePath(kind, settingsEnvironment);
  if (!filePath) {
    await vscode.window.showWarningMessage(
      vscode.l10n.t('Could not locate the current execution host configuration directory, so {label} cannot be opened yet.', {
        label: descriptor.label
      })
    );
    return;
  }

  const uri = vscode.Uri.file(filePath);
  try {
    const status = await getLocalAgentSettingsFileStatus(filePath);
    if (status === 'directory') {
      await vscode.window.showWarningMessage(
        vscode.l10n.t('{label} points to a directory and cannot be opened as a configuration file: {path}', {
          label: descriptor.label,
          path: filePath
        })
      );
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
      vscode.l10n.t('Failed to open {label}: {message}', {
        label: descriptor.label,
        message: error instanceof Error ? error.message : String(error)
      })
    );
  }
}

async function createMissingAgentSettingsFileIfRequested(
  descriptor: AgentSettingsFileDescriptor,
  filePath: string
): Promise<boolean> {
  const createAndOpenAction = vscode.l10n.t('Create and open');
  const picked = await vscode.window.showWarningMessage(
    vscode.l10n.t('{label} was not found: {path}. Create it and open it?', {
      label: descriptor.label,
      path: filePath
    }),
    { modal: true },
    createAndOpenAction
  );
  if (picked !== createAndOpenAction) {
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
    placeHolder: vscode.l10n.t('Select {provider} CLI command or path', { provider: providerLabelText })
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
  await vscode.window.showInformationMessage(
    vscode.l10n.t('Updated {provider} CLI for the current device: {command}', {
      provider: providerLabelText,
      command: selectedCommand
    })
  );
}

async function promptAgentCliInstallation(
  provider: AgentProviderKind,
  panelManager: CanvasPanelManager
): Promise<void> {
  const installationInfo = getAgentCliInstallationInfo(provider);
  const picked = await vscode.window.showQuickPick(buildAgentCliInstallQuickPickItems(installationInfo), {
    placeHolder: vscode.l10n.t('Select how to install {provider}', { provider: installationInfo.label })
  });

  if (!picked) {
    return;
  }

  if (picked.installMethod === 'command-line') {
    const result = await panelManager.createTerminalAndRunCommand(installationInfo.cliInstallCommand, {
      titleOverride: vscode.l10n.t('Install {provider}', { provider: installationInfo.label })
    });
    if (!result.created) {
      await vscode.window.showWarningMessage(
        result.errorMessage ??
          vscode.l10n.t('Could not run the {provider} install command in a Canvas Terminal.', {
            provider: installationInfo.label
          })
      );
      return;
    }

    if (!result.commandDispatched) {
      await vscode.window.showWarningMessage(
        result.errorMessage ??
          vscode.l10n.t(
            'Created a Canvas Terminal, but could not confirm that the {provider} install command was sent. Check the Terminal node status.',
            { provider: installationInfo.label }
          )
      );
      return;
    }

    await vscode.window.showInformationMessage(
      vscode.l10n.t(
        'Sent and ran in a Canvas Terminal: {command}. After installation finishes, run the {provider} command again and select the CLI.',
        {
          command: installationInfo.cliInstallCommand,
          provider: installationInfo.label
        }
      )
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
      label: vscode.l10n.t('Install globally with npm'),
      description: installationInfo.cliInstallCommand,
      detail: vscode.l10n.t('Run the install command in a Canvas Terminal.'),
      installMethod: 'command-line'
    },
    {
      label: vscode.l10n.t('Install VS Code extension'),
      description: installationInfo.vscodeExtensionId,
      detail: vscode.l10n.t('Open the {provider} extension page, then click Install.', {
        provider: installationInfo.label
      }),
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
      vscode.l10n.t('Opened the {provider} VS Code extension page. Click Install in the Extensions view.', {
        provider: installationInfo.label
      })
    );
  } catch {
    await vscode.window.showWarningMessage(
      vscode.l10n.t(
        'Could not open the {provider} VS Code extension page automatically; search for {extensionId} in the Extensions view.',
        {
          provider: installationInfo.label,
          extensionId: installationInfo.vscodeExtensionId
        }
      )
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
    title: vscode.l10n.t('Select {provider} CLI', { provider: providerLabelText }),
    prompt: vscode.l10n.t('Enter the command name or absolute path for {provider} CLI.', {
      provider: providerLabelText
    }),
    value: currentCommand,
    validateInput: (input) => (input.trim().length > 0 ? undefined : vscode.l10n.t('CLI command cannot be empty.'))
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
      label: vscode.l10n.t('Install {provider}...', { provider: providerLabelText }),
      description: vscode.l10n.t('Not detected on this system'),
      detail: vscode.l10n.t('Install the CLI globally with npm, or install the matching VS Code extension.'),
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
      description: isCurrent ? vscode.l10n.t('{source} · Current', { source: sourceLabel }) : sourceLabel,
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
    label: vscode.l10n.t('Enter command or path manually...'),
    description: vscode.l10n.t('Custom'),
    detail: vscode.l10n.t(
      'Enter a command name such as {command}, or the absolute path to the CLI executable.',
      { command: getAgentCliDefaultCommand(provider) }
    ),
    manualInput: true
  });

  return items;
}

function formatAgentCliCandidateSource(source: AgentCliCandidateSource): string {
  switch (source) {
    case 'configured':
      return vscode.l10n.t('Current configuration');
    case 'default-command':
      return vscode.l10n.t('Default command');
    case 'path-env':
      return 'PATH';
    case 'login-shell':
      return vscode.l10n.t('Login shell');
    case 'extension-bundled':
      return vscode.l10n.t('Bundled with extension');
    case 'common-location':
      return vscode.l10n.t('Common location');
  }
}

function buildAgentCliCandidateDetail(candidate: AgentCliCandidate): string {
  const lines = [vscode.l10n.t('Command: {command}', { command: candidate.command })];
  if (candidate.resolvedPath && !agentCliCommandValuesEqual(candidate.resolvedPath, candidate.command)) {
    lines.push(vscode.l10n.t('Resolved path: {path}', { path: candidate.resolvedPath }));
  }
  if (!candidate.resolvedPath) {
    lines.push(vscode.l10n.t('Executable not found. Install the CLI or configure PATH.'));
  }
  if (candidate.extensionRoot) {
    lines.push(vscode.l10n.t('Extension directory: {path}', { path: candidate.extensionRoot }));
    lines.push(vscode.l10n.t('Note: this path may change when the extension updates.'));
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
      label: vscode.l10n.t('Follow current default shell'),
      description: isFollowingDefaultShell ? vscode.l10n.t('Current') : undefined,
      detail: normalizedResolvedConfiguredShellPath || vscode.l10n.t('No default shell path detected'),
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
    const shellDisplayName = path.basename(normalizedResolvedConfiguredShellPath) || normalizedResolvedConfiguredShellPath;
    items.push({
      label: vscode.l10n.t('Current configuration ({shell})', { shell: shellDisplayName }),
      description: currentConfiguredShellPath ? vscode.l10n.t('Current') : vscode.l10n.t('Current (legacy setting)'),
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
        ? vscode.l10n.t('Current')
        : shell.isDefault
          ? vscode.l10n.t('Default shell')
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
        placeHolder: vscode.l10n.t('Select the object or Agent type to create')
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
  await vscode.window.showWarningMessage(
    vscode.l10n.t('Select a Markdown file (.md / .markdown) to create an associated Note.')
  );
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
  await vscode.window.showWarningMessage(
    vscode.l10n.t('Select a folder or regular file inside the current workspace to create a Canvas Terminal / Agent.')
  );
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
    openLabel: vscode.l10n.t('Add to Workspace')
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
    await vscode.window.showInformationMessage(vscode.l10n.t('The selected folders are already in the current workspace.'));
    return;
  }

  const inserted = vscode.workspace.updateWorkspaceFolders(
    vscode.workspace.workspaceFolders?.length ?? 0,
    0,
    ...foldersToAdd
  );
  if (!inserted) {
    await vscode.window.showWarningMessage(vscode.l10n.t('Could not add the selected folders to the current workspace.'));
  }
}

interface WorkspaceRootRemovalChoice {
  clearCanvas: boolean;
}

interface WorkspaceRootRemovalCommandOptions {
  confirmedChoice?: WorkspaceRootRemovalChoice;
}

interface WorkspaceRootRemovalModalItem extends vscode.MessageItem {
  clearCanvas?: boolean;
  cancel?: boolean;
}

function formatWorkspaceRootCanvasRemovalImpact(impact: WorkspaceRootCanvasRemovalImpact | undefined): string {
  if (!impact) {
    return vscode.l10n.t('Canvas impact could not be calculated yet');
  }

  if (impact.nodeCount === 0 && impact.groupCount === 0 && impact.edgeCount === 0) {
    return vscode.l10n.t('Current Canvas is empty');
  }

  const parts = [
    vscode.l10n.t('{count} nodes', { count: impact.nodeCount }),
    vscode.l10n.t('{count} edges', { count: impact.edgeCount })
  ];
  if (impact.groupCount > 0) {
    parts.push(vscode.l10n.t('{count} groups', { count: impact.groupCount }));
  }
  if (impact.fileReferenceCount > 0) {
    parts.push(vscode.l10n.t('{count} file activity records', { count: impact.fileReferenceCount }));
  }
  if (impact.executionNodeCount > 0) {
    parts.push(vscode.l10n.t('will stop {count} Agent / Terminal sessions', {
      count: impact.executionNodeCount
    }));
  }

  return parts.join(vscode.l10n.t(', '));
}

function buildWorkspaceFolderRemovalDetail(options: {
  impact: WorkspaceRootCanvasRemovalImpact | undefined;
}): { keepCanvasDetail: string; clearDetail: string } {
  return {
    keepCanvasDetail: vscode.l10n.t(
      "Remove the folder from the current Workspace only; disk files and this root's Canvas snapshot are kept and can be restored when re-added."
    ),
    clearDetail: vscode.l10n.t(
      'Clear this folder Canvas first ({impact}), then remove it from Workspace; disk files are not deleted, and the old Canvas will not be restored when re-added.',
      { impact: formatWorkspaceRootCanvasRemovalImpact(options.impact) }
    )
  };
}

function buildWorktreeRemovalDetail(options: {
  impact: WorkspaceRootCanvasRemovalImpact | undefined;
}): { keepCanvasDetail: string; clearDetail: string } {
  return {
    clearDetail: vscode.l10n.t(
      "After git worktree remove succeeds, clear this worktree Canvas ({impact}); the worktree directory is deleted, and the old Canvas will not be restored. If Git refuses removal, the Canvas stays unchanged.",
      { impact: formatWorkspaceRootCanvasRemovalImpact(options.impact) }
    ),
    keepCanvasDetail: vscode.l10n.t(
      'Run git worktree remove and remove it from Workspace; the Canvas snapshot is kept at this path and can be restored if the same path is re-added.'
    )
  };
}

async function promptWorkspaceRootRemovalChoice(
  options: {
    title: string;
    rootPath: string;
    clearActionTitle: string;
    keepCanvasActionTitle: string;
    clearDetail: string;
    keepCanvasDetail: string;
    defaultChoice: 'clear-canvas' | 'keep-canvas';
  },
  commandOptions?: WorkspaceRootRemovalCommandOptions
): Promise<WorkspaceRootRemovalChoice | undefined> {
  if (commandOptions?.confirmedChoice) {
    return commandOptions.confirmedChoice;
  }

  const clearItem: WorkspaceRootRemovalModalItem = {
    title: options.clearActionTitle,
    clearCanvas: true
  };
  const keepCanvasItem: WorkspaceRootRemovalModalItem = {
    title: options.keepCanvasActionTitle,
    clearCanvas: false
  };
  const cancelItem: WorkspaceRootRemovalModalItem = {
    title: vscode.l10n.t('Cancel'),
    isCloseAffordance: true,
    cancel: true
  };
  const actionItems =
    options.defaultChoice === 'clear-canvas'
      ? [clearItem, keepCanvasItem]
      : [keepCanvasItem, clearItem];
  const selection = await vscode.window.showWarningMessage<WorkspaceRootRemovalModalItem>(
    options.title,
    {
      modal: true,
      detail: buildWorkspaceRootRemovalModalDetail(options)
    },
    ...actionItems,
    cancelItem
  );
  if (!selection || selection.cancel) {
    return undefined;
  }

  return {
    clearCanvas: selection.clearCanvas === true
  };
}

function buildWorkspaceRootRemovalModalDetail(options: {
  rootPath: string;
  clearActionTitle: string;
  keepCanvasActionTitle: string;
  clearDetail: string;
  keepCanvasDetail: string;
  defaultChoice: 'clear-canvas' | 'keep-canvas';
}): string {
  const defaultActionTitle =
    options.defaultChoice === 'clear-canvas'
      ? options.clearActionTitle
      : options.keepCanvasActionTitle;
  return [
    vscode.l10n.t('Path: {path}', { path: options.rootPath }),
    '',
    vscode.l10n.t('Default action: {action}', { action: defaultActionTitle }),
    '',
    vscode.l10n.t('{action}: {detail}', {
      action: options.clearActionTitle,
      detail: options.clearDetail
    }),
    '',
    vscode.l10n.t('{action}: {detail}', {
      action: options.keepCanvasActionTitle,
      detail: options.keepCanvasDetail
    })
  ].join('\n');
}

async function clearWorkspaceRootCanvasIfRequested(
  panelManager: CanvasPanelManager,
  rootPath: string,
  choice: WorkspaceRootRemovalChoice,
  reason: string
): Promise<boolean> {
  if (!choice.clearCanvas) {
    return true;
  }

  return panelManager.clearWorkspaceRootCanvas(rootPath, { reason });
}

async function removeFolderFromWorkspaceFromCommand(
  panelManager: CanvasPanelManager,
  rootPath: string,
  commandOptions?: WorkspaceRootRemovalCommandOptions
): Promise<void> {
  const workspaceFolder = resolveWorkspaceFolderByFsPath(rootPath);
  if (!workspaceFolder) {
    await vscode.window.showWarningMessage(vscode.l10n.t('That folder is no longer in the current workspace.'));
    return;
  }

  const removalDetail = buildWorkspaceFolderRemovalDetail({
    impact: panelManager.getWorkspaceRootCanvasRemovalImpact(workspaceFolder.uri.fsPath)
  });
  const removalChoice = await promptWorkspaceRootRemovalChoice(
    {
      title: vscode.l10n.t('Remove folder "{name}" from Workspace?', { name: workspaceFolder.name }),
      rootPath: workspaceFolder.uri.fsPath,
      clearActionTitle: vscode.l10n.t('Clear Canvas and remove'),
      keepCanvasActionTitle: vscode.l10n.t('Keep Canvas and remove'),
      clearDetail: removalDetail.clearDetail,
      keepCanvasDetail: removalDetail.keepCanvasDetail,
      defaultChoice: 'keep-canvas'
    },
    commandOptions
  );
  if (!removalChoice) {
    return;
  }

  const cleared = await clearWorkspaceRootCanvasIfRequested(
    panelManager,
    workspaceFolder.uri.fsPath,
    removalChoice,
    'workspace-folder-remove-clear-root-canvas'
  );
  if (!cleared) {
    return;
  }

  const removalResult = removeWorkspaceFolderByFsPath(workspaceFolder.uri.fsPath);
  if (removalResult === 'missing') {
    await vscode.window.showWarningMessage(vscode.l10n.t('That folder is no longer in the current workspace.'));
  } else if (removalResult === 'failed') {
    await vscode.window.showWarningMessage(
      vscode.l10n.t('Could not remove folder from the current workspace: {folder}', {
        folder: workspaceFolder.name
      })
    );
  }
}

async function removeWorktreeFromWorkspaceFromCommand(
  panelManager: CanvasPanelManager,
  rootPath: string,
  commandOptions?: WorkspaceRootRemovalCommandOptions
): Promise<void> {
  const workspaceFolder = resolveWorkspaceFolderByFsPath(rootPath);
  if (!workspaceFolder) {
    await vscode.window.showWarningMessage(vscode.l10n.t('That worktree folder is no longer in the current workspace.'));
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
      detail: vscode.l10n.t(
        'The current folder is the main git worktree or a regular folder, not a linked worktree removable with git worktree remove.'
      )
    });
    return;
  }

  const removalDetail = buildWorktreeRemovalDetail({
    impact: panelManager.getWorkspaceRootCanvasRemovalImpact(workspaceFolder.uri.fsPath)
  });
  const removalChoice = await promptWorkspaceRootRemovalChoice(
    {
      title: vscode.l10n.t('Remove Worktree "{name}"?', { name: workspaceFolder.name }),
      rootPath: workspaceFolder.uri.fsPath,
      clearActionTitle: vscode.l10n.t('Remove Worktree and clear Canvas'),
      keepCanvasActionTitle: vscode.l10n.t('Remove Worktree but keep Canvas'),
      clearDetail: removalDetail.clearDetail,
      keepCanvasDetail: removalDetail.keepCanvasDetail,
      defaultChoice: 'clear-canvas'
    },
    commandOptions
  );
  if (!removalChoice) {
    return;
  }

  try {
    await execFileAsync('git', ['-C', workspaceFolder.uri.fsPath, 'worktree', 'remove', workspaceFolder.uri.fsPath], {
      timeout: GIT_WORKTREE_COMMAND_TIMEOUT_MS,
      maxBuffer: GIT_COMMAND_MAX_BUFFER_BYTES,
      encoding: 'utf8'
    });
  } catch (error) {
    await vscode.window.showErrorMessage(
      vscode.l10n.t('Failed to remove git worktree: {message}', {
        message: formatExecErrorMessage(error)
      }),
      { modal: true }
    );
    return;
  }

  if (removalChoice.clearCanvas) {
    // Git already removed the worktree; remove the stale workspace folder even if Canvas cleanup fails.
    await clearWorkspaceRootCanvasIfRequested(
      panelManager,
      workspaceFolder.uri.fsPath,
      removalChoice,
      'workspace-worktree-remove-clear-root-canvas'
    );
  }

  const removalResult = removeWorkspaceFolderByFsPath(workspaceFolder.uri.fsPath);
  if (removalResult === 'failed') {
    await vscode.window.showWarningMessage(
      vscode.l10n.t('Removed worktree but could not remove folder from the current workspace automatically: {folder}', {
        folder: workspaceFolder.name
      }),
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

  const confirmationAction = target.kind === 'create'
    ? vscode.l10n.t('Create Worktree')
    : vscode.l10n.t('Add Worktree');
  const confirmed = await vscode.window.showInformationMessage(
    formatWorktreeConfirmationMessage(target),
    { modal: true, detail: target.targetPath },
    confirmationAction
  );
  if (confirmed !== confirmationAction) {
    return;
  }

  if (target.kind === 'create') {
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
      await vscode.window.showErrorMessage(
        vscode.l10n.t('Failed to create git worktree: {message}', {
          message: formatExecErrorMessage(error)
        })
      );
      return;
    }
  }

  const added = addWorkspaceFolderIfMissing(target.targetPath);
  if (!added) {
    await vscode.window.showWarningMessage(
      target.kind === 'create'
        ? vscode.l10n.t('Worktree was created, but could not be added to the current workspace automatically. Add it manually: {path}', {
            path: target.targetPath
          })
        : vscode.l10n.t('Existing worktree was selected, but could not be added to the current workspace automatically. Add it manually: {path}', {
            path: target.targetPath
          })
    );
    return;
  }

  await vscode.window.showInformationMessage(
    target.kind === 'create'
      ? vscode.l10n.t('Created worktree and added it to the workspace: {name}', { name: target.displayName })
      : vscode.l10n.t('Added existing worktree to the workspace: {name}', { name: target.displayName })
  );
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
    gitCommonDir: realGitCommonDir,
    isLinkedWorktree: normalizeComparableFileSystemPath(realGitDir) !== normalizeComparableFileSystemPath(realGitCommonDir)
  };
}

function isGitRepositoryRoot(info: GitWorktreeRepositoryInfo): boolean {
  return normalizeComparableFileSystemPath(info.rootPath) === normalizeComparableFileSystemPath(info.topLevelPath);
}

async function getGitWorktreeListEntries(rootPath: string): Promise<GitWorktreeListEntry[]> {
  return parseGitWorktreeListPorcelain(
    await execGit(rootPath, ['worktree', 'list', '--porcelain'])
  );
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
        ? vscode.l10n.t('The specified folder is no longer in the current workspace.')
        : vscode.l10n.t('The current window has no local workspace folder available for creating a worktree.')
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
      detail: vscode.l10n.t('The current git repository has no commits or local refs available for creating a worktree.')
    });
    return undefined;
  }

  const targetPlan = await promptWorktreeCreationPlan(rootFolder, refs);
  if (!targetPlan) {
    return undefined;
  }

  if (targetPlan.kind === 'addExisting') {
    return {
      kind: 'addExisting',
      rootFolder,
      displayName: targetPlan.displayName,
      refLabel: targetPlan.refLabel,
      targetPath: targetPlan.targetPath
    };
  }

  const defaultTargetPath = buildDefaultWorktreeTargetPath(rootFolder.uri.fsPath, targetPlan.defaultPathName);
  const targetPath = await promptWorktreeTargetPath(defaultTargetPath);
  if (!targetPath) {
    return undefined;
  }

  return {
    kind: 'create',
    rootFolder,
    branchName: targetPlan.branchName,
    checkoutRef: targetPlan.checkoutRef,
    startPoint: targetPlan.startPoint,
    detached: targetPlan.detached,
    displayName: targetPlan.displayName,
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
): Promise<WorktreeTargetPlan | undefined> {
  const picked = await vscode.window.showQuickPick<WorktreeQuickPickItem>(
    [
      {
        type: 'addExistingWorktree',
        label: `$(worktree) ${vscode.l10n.t('Add existing worktree to workspace...')}`,
        description: vscode.l10n.t('Choose from git worktree list'),
        alwaysShow: true
      },
      {
        type: 'createNewBranch',
        label: `$(add) ${vscode.l10n.t('Create new branch...')}`,
        alwaysShow: true
      },
      {
        type: 'createNewBranchFrom',
        label: `$(git-branch-create) ${vscode.l10n.t('Create new branch from...')}`,
        alwaysShow: true
      },
      ...refs.map(buildWorktreeRefQuickPickItem)
    ],
    {
      title: vscode.l10n.t('Create or add Worktree ({root}) (1/2)', {
        root: abbreviateWorktreeRootPath(rootFolder.uri.fsPath)
      }),
      placeHolder: vscode.l10n.t('Create a new worktree or add an existing one to this workspace'),
      matchOnDescription: true,
      matchOnDetail: true,
      ignoreFocusOut: true
    }
  );

  if (!picked) {
    return undefined;
  }

  if (picked.type === 'addExistingWorktree') {
    return await promptExistingWorktreeToAdd(rootFolder);
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

async function promptExistingWorktreeToAdd(
  rootFolder: vscode.WorkspaceFolder
): Promise<WorktreeAddExistingPlan | undefined> {
  let worktreeEntries: GitWorktreeListEntry[];
  try {
    worktreeEntries = await getGitWorktreeListEntries(rootFolder.uri.fsPath);
  } catch (error) {
    await showWorktreeUnavailableModal({
      code: classifyWorktreeRepositoryError(error),
      rootPath: rootFolder.uri.fsPath,
      operation: 'create',
      cause: error
    });
    return undefined;
  }

  const existingWorkspaceFolderPaths = new Set(
    (vscode.workspace.workspaceFolders ?? [])
      .filter((folder) => folder.uri.scheme === 'file')
      .map((folder) => normalizeComparableFileSystemPath(folder.uri.fsPath))
  );
  const candidates = (
    await Promise.all(
      worktreeEntries.map(async (entry): Promise<ExistingWorktreeQuickPickItem | undefined> => {
        const normalizedWorktreePath = normalizeComparableFileSystemPath(entry.worktreePath);
        if (entry.bare || entry.prunable || existingWorkspaceFolderPaths.has(normalizedWorktreePath)) {
          return undefined;
        }
        if (!(await isExistingDirectory(entry.worktreePath))) {
          return undefined;
        }

        const refLabel = formatGitWorktreeListEntryRef(entry);
        return {
          entry,
          label: `$(worktree) ${path.basename(entry.worktreePath) || entry.worktreePath}`,
          description: refLabel,
          detail: entry.worktreePath
        };
      })
    )
  ).filter((item): item is ExistingWorktreeQuickPickItem => Boolean(item));

  if (candidates.length === 0) {
    await vscode.window.showInformationMessage(
      vscode.l10n.t('No existing git worktrees are available to add to the current workspace.')
    );
    return undefined;
  }

  const picked = await vscode.window.showQuickPick<ExistingWorktreeQuickPickItem>(
    candidates,
    {
      title: vscode.l10n.t('Add existing Worktree ({root}) (2/2)', {
        root: abbreviateWorktreeRootPath(rootFolder.uri.fsPath)
      }),
      placeHolder: vscode.l10n.t('Choose an existing git worktree to add to this workspace'),
      matchOnDescription: true,
      matchOnDetail: true,
      ignoreFocusOut: true
    }
  );

  if (!picked) {
    return undefined;
  }

  return {
    kind: 'addExisting',
    targetPath: path.resolve(picked.entry.worktreePath),
    displayName: path.basename(picked.entry.worktreePath) || picked.entry.worktreePath,
    refLabel: formatGitWorktreeListEntryRef(picked.entry)
  };
}

async function promptWorktreeBaseRef(refs: GitWorktreeRef[]): Promise<GitWorktreeRef | undefined> {
  const picked = await vscode.window.showQuickPick<WorktreeRefQuickPickItem>(
    refs.map(buildWorktreeRefQuickPickItem),
    {
      title: vscode.l10n.t('Create new branch from...'),
      placeHolder: vscode.l10n.t('Choose a reference to create new branch from'),
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
      ? [vscode.l10n.t('Current commit hash')]
      : [ref.shortSha, ref.relativeDate].filter((part): part is string => Boolean(part));
  if (ref.isCheckedOutInWorktree) {
    descriptionParts.push(vscode.l10n.t('worktree'));
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
    title: vscode.l10n.t('Select worktree directory'),
    value: defaultTargetPath,
    valueSelection: [defaultTargetPath.length, defaultTargetPath.length],
    prompt: vscode.l10n.t('Enter the local directory for the new worktree; the directory must not already exist.'),
    ignoreFocusOut: true,
    validateInput: async (value) => {
      const normalizedValue = value.trim();
      if (!normalizedValue) {
        return vscode.l10n.t('Enter a worktree directory.');
      }
      if (!path.isAbsolute(normalizedValue)) {
        return vscode.l10n.t('Enter an absolute path.');
      }
      return await pathExists(normalizedValue)
        ? vscode.l10n.t('That path already exists. Choose a directory that does not exist yet.')
        : undefined;
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

  const candidates = (
    await Promise.all(
      workspaceFolders.map(async (folder): Promise<WorkspaceWorktreeRepositoryCandidate | undefined> => {
        try {
          const repositoryInfo = await getGitWorktreeRepositoryInfo(folder.uri.fsPath);
          return {
            workspaceFolder: folder,
            gitCommonDir: repositoryInfo.gitCommonDir,
            isLinkedWorktree: repositoryInfo.isLinkedWorktree,
            isRepositoryRoot: isGitRepositoryRoot(repositoryInfo),
            workspaceFolderIndex: folder.index
          };
        } catch {
          return undefined;
        }
      })
    )
  ).filter((candidate): candidate is WorkspaceWorktreeRepositoryCandidate => Boolean(candidate));

  const repositoryGroups = groupGitWorktreeRepositoryCandidates(
    candidates,
    normalizeComparableFileSystemPath
  );
  if (repositoryGroups.length === 1) {
    return repositoryGroups[0]?.primary.workspaceFolder;
  }
  if (repositoryGroups.length > 1) {
    const picked = await vscode.window.showQuickPick<WorkspaceRootQuickPickItem>(
      repositoryGroups.map((group) => ({
        label: `$(repo) ${group.primary.workspaceFolder.name}`,
        description: group.primary.workspaceFolder.uri.fsPath,
        detail: group.members.length > 1
          ? vscode.l10n.t('{count} workspace folders in this git repository', { count: group.members.length })
          : undefined,
        folder: group.primary.workspaceFolder
      })),
      {
        title: vscode.l10n.t('Select Git repository to create or add worktree from'),
        placeHolder: vscode.l10n.t('Choose the git repository that owns the worktree'),
        matchOnDescription: true,
        matchOnDetail: true
      }
    );

    return picked?.folder;
  }

  const picked = await vscode.window.showQuickPick<WorkspaceRootQuickPickItem>(
    workspaceFolders.map((folder) => ({
      label: `$(repo) ${folder.name}`,
      description: folder.uri.fsPath,
      folder
    })),
    {
      title: vscode.l10n.t('Select Git repository to create or add worktree from'),
      placeHolder: vscode.l10n.t('Choose the workspace folder that owns the git repository'),
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
    title: startPoint
      ? vscode.l10n.t('Create new branch from {ref}', { ref: startPoint })
      : vscode.l10n.t('Create new branch ({folder})', { folder: rootFolder.name }),
    prompt: vscode.l10n.t('Enter the new branch name to create. This runs git worktree add -b <branch>.'),
    placeHolder: 'feature/my-worktree',
    ignoreFocusOut: true,
    validateInput: (value) => validateWorktreeBranchName(value)
  });
  return branchName?.trim() || undefined;
}

function validateWorktreeBranchName(value: string): string | undefined {
  const branchName = value.trim();
  if (!branchName) {
    return vscode.l10n.t('Enter a branch name.');
  }
  if (
    branchName.startsWith('/') ||
    branchName.endsWith('/') ||
    branchName.includes('..') ||
    branchName.includes('//') ||
    !WORKTREE_BRANCH_NAME_PATTERN.test(branchName) ||
    /[\\~^:?*[\]\s]/u.test(branchName)
  ) {
    return vscode.l10n.t(
      'Branch names can only contain letters, numbers, dots, underscores, hyphens, and slashes, and cannot contain spaces, .., or special git ref characters.'
    );
  }

  return undefined;
}

function buildGitWorktreeAddArgs(target: WorkspaceWorktreeCreationTarget): string[] {
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
  if (target.kind === 'addExisting') {
    return vscode.l10n.t('Add existing worktree "{name}" ({ref}) to the current workspace.', {
      name: target.displayName,
      ref: target.refLabel
    });
  }

  if (target.branchName) {
    return target.startPoint
      ? vscode.l10n.t('Create worktree branch "{branch}" from folder "{folder}" at start point "{startPoint}", then add it to the current workspace.', {
          branch: target.branchName,
          folder: target.rootFolder.name,
          startPoint: target.startPoint
        })
      : vscode.l10n.t('Create worktree branch "{branch}" from folder "{folder}", then add it to the current workspace.', {
          branch: target.branchName,
          folder: target.rootFolder.name
        });
  }

  const ref = target.checkoutRef ?? target.displayName;
  return target.detached
    ? vscode.l10n.t('Create a detached HEAD worktree for ref "{ref}" from folder "{folder}", then add it to the current workspace.', {
        ref,
        folder: target.rootFolder.name
      })
    : vscode.l10n.t('Create a worktree for ref "{ref}" from folder "{folder}", then add it to the current workspace.', {
        ref,
        folder: target.rootFolder.name
      });
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

async function isExistingDirectory(filePath: string): Promise<boolean> {
  try {
    const fileStat = await stat(filePath);
    return fileStat.isDirectory();
  } catch {
    return false;
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
  const operationLabel = options.operation === 'create'
    ? vscode.l10n.t('Create / add worktree')
    : vscode.l10n.t('Remove worktree');
  const reason = formatWorktreeUnavailableReason(options);
  const rootDetail = options.rootPath
    ? `\n\n${vscode.l10n.t('Target folder: {path}', { path: options.rootPath })}`
    : '';
  const causeDetail = options.cause
    ? `\n\n${vscode.l10n.t('Underlying error: {message}', { message: formatExecErrorMessage(options.cause) })}`
    : '';
  const customDetail = options.detail ? `\n\n${options.detail}` : '';
  await vscode.window.showWarningMessage(
    vscode.l10n.t('{operation} unavailable: {reason}{rootDetail}{customDetail}{causeDetail}', {
      operation: operationLabel,
      reason,
      rootDetail,
      customDetail,
      causeDetail
    }),
    { modal: true }
  );
}

function formatWorktreeUnavailableReason(options: {
  code: WorktreeUnavailableReasonCode;
  operation: 'create' | 'remove';
}): string {
  switch (options.code) {
    case 'workspace-untrusted':
      return vscode.l10n.t('The current workspace is not trusted. Trust the workspace before running git worktree operations.');
    case 'not-file-root':
      return vscode.l10n.t('There is no local file-system folder. git worktree can only operate on local folders.');
    case 'not-git-repository':
      return options.operation === 'create'
        ? vscode.l10n.t('The current folder is not a git repository yet. Initialize it as a repository, or choose an existing git repository folder.')
        : vscode.l10n.t('The current folder is not a git repository yet. Choose a git repository folder first.');
    case 'no-git-refs':
      return vscode.l10n.t('The current git repository has no commits or local refs available for creating a worktree. Make an initial commit first, or choose a repository with commits.');
    case 'not-linked-worktree':
      return vscode.l10n.t('The current folder is not a removable linked git worktree. Confirm it was created with git worktree.');
    case 'git-unavailable':
      return vscode.l10n.t('The current environment cannot find the git command. Install git and make sure the VS Code extension host can access it.');
    case 'unknown':
      return vscode.l10n.t('Could not confirm whether the current folder supports git worktree.');
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
  cwd?: string;
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
    await vscode.window.showInformationMessage(vscode.l10n.t('The current Canvas has no locatable non-file nodes.'));
    return;
  }

  const picked = await vscode.window.showQuickPick<SidebarNodeQuickPickItem>(
    items.map((item) => ({
      label: item.label,
      description: item.attentionPending
        ? vscode.l10n.t('{description} · Attention', { description: item.description })
        : item.description,
      detail: buildSidebarNodeQuickPickDetail(nodesById.get(item.nodeId)),
      nodeId: item.nodeId
    })),
    {
      placeHolder: vscode.l10n.t('Select a node to locate it on the Canvas'),
      matchOnDescription: true,
      matchOnDetail: true
    }
  );
  if (!picked) {
    return;
  }

  const focused = await panelManager.focusNodeById(picked.nodeId);
  if (!focused) {
    await vscode.window.showWarningMessage(
      vscode.l10n.t('The target node no longer exists, or it cannot be located on the Canvas right now.')
    );
  }
}

async function showSessionHistoryQuickPick(
  sidebarSessionHistoryView: CanvasSidebarSessionHistoryView,
  panelManager: CanvasPanelManager
): Promise<void> {
  const restoreBlockReason = panelManager.getSessionHistoryRestoreBlockReason();
  const items = await sidebarSessionHistoryView.getSessionHistoryItems();
  if (items.length === 0) {
    await vscode.window.showInformationMessage(
      vscode.l10n.t('No recoverable Codex / Claude Code sessions in the current workspace.')
    );
    return;
  }

  const picked = await vscode.window.showQuickPick<SidebarSessionQuickPickItem>(
    items.flatMap((item) => [
      {
        label: item.title,
        description: vscode.l10n.t('Resume'),
        detail: buildSidebarSessionQuickPickDetail(item.timestampLabel),
        provider: item.provider,
        sessionId: item.sessionId,
        cwd: item.cwd,
        titleOverride: item.title,
        action: 'resume' as const
      },
      {
        label: item.title,
        description: vscode.l10n.t('Fork'),
        detail: buildSidebarSessionQuickPickDetail(item.timestampLabel),
        provider: item.provider,
        sessionId: item.sessionId,
        cwd: item.cwd,
        titleOverride: item.title,
        action: 'fork' as const
      }
    ]),
    {
      title: restoreBlockReason,
      placeHolder: restoreBlockReason
        ? vscode.l10n.t('Read-only mode: you can browse session history, but cannot resume or fork sessions into new Agent nodes')
        : vscode.l10n.t('Select a session and resume or fork it into a new node'),
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
      cwd: picked.cwd,
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
    cwd: picked.cwd,
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
      label: vscode.l10n.t('Agent (default: {provider})', { provider: providerLabel(defaultAgentProvider) }),
      description: vscode.l10n.t('Create object'),
      detail: vscode.l10n.t('Review the full launch command next, then create an Agent with the default provider.'),
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
      description: vscode.l10n.t('Create object'),
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
      description: vscode.l10n.t('Create object'),
      detail: describeNodeKind('note'),
      selectionId: 'create-note',
      request: {
        kind: 'note'
      }
    });
  }

  if (directCreateItems.length > 0) {
    items.push({
      label: vscode.l10n.t('Create object'),
      kind: vscode.QuickPickItemKind.Separator
    });
    items.push(...directCreateItems);
  }

  if (creatableKinds.includes('agent')) {
    items.push({
      label: vscode.l10n.t('Create Agent by provider'),
      kind: vscode.QuickPickItemKind.Separator
    });
    for (const provider of ['codex', 'claude'] as const) {
      items.push({
        label:
          provider === defaultAgentProvider
            ? vscode.l10n.t('{provider} (default)', { provider: providerLabel(provider) })
            : providerLabel(provider),
        description: vscode.l10n.t('Create Agent by provider'),
        detail: vscode.l10n.t('Review the full launch command next, then create a {provider} session window.', {
          provider: providerLabel(provider)
        }),
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
      error instanceof Error
        ? error.message
        : vscode.l10n.t('Could not read default launch arguments for {provider}.', {
            provider: providerLabel(provider)
          })
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
    const baseTitle = vscode.l10n.t('Configure {provider} launch command', {
      provider: providerLabel(provider)
    });
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
      quickPick.title = validation.valid
        ? baseTitle
        : `${baseTitle} · ${localizeAgentLaunchMessageDescriptor(validation.errorDescriptor, validation.error)}`;
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
    quickPick.placeholder = vscode.l10n.t('Edit the full launch command; manual edits create a custom command');
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
      label: vscode.l10n.t('Create with custom command'),
      description: 'Enter',
      detail: vscode.l10n.t('Create a custom Agent from the current command in the input box'),
      selectionId: 'agent-launch-accept-current',
      action: 'create-custom',
      alwaysShow: true
    },
    {
      label: vscode.l10n.t('Quickly replace launch command'),
      kind: vscode.QuickPickItemKind.Separator,
      alwaysShow: true
    },
    {
      label: vscode.l10n.t('Default'),
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
      label: vscode.l10n.t('Sandbox'),
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
      return vscode.l10n.t('Canvas session window for Codex / Claude Code.');
    case 'terminal':
      return vscode.l10n.t('Embedded terminal window on the Canvas.');
    case 'note':
      return vscode.l10n.t('Editable note node.');
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
    title: vscode.l10n.t('{name}: Edit file {kind} filter', {
      name: EXTENSION_DISPLAY_NAME,
      kind: kind === 'include' ? 'Include' : 'Exclude'
    }),
    prompt:
      kind === 'include'
        ? vscode.l10n.t('Use VS Code Search glob syntax, separated by commas; leave empty to include everything. This filter only affects file object projection and does not modify file references.')
        : vscode.l10n.t('Use VS Code Search glob syntax, separated by commas; leave empty to exclude nothing. This filter only affects file object projection and does not modify file references.'),
    placeHolder: kind === 'include' ? 'e.g. src/**/*.ts, docs/**/*.md' : 'e.g. **/dist/**, **/*.snap',
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
    vscode.l10n.t(
      'Files are currently disabled. Reload the window and enable `devSessionCanvas.files.enabled` before using file activity and file filters.'
    )
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
    vscode.l10n.t('Select a template and apply it to the current Canvas')
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
    vscode.l10n.t('Select a template and reset the current Canvas')
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

async function saveCurrentCanvasAsTemplateFromCommand(
  panelManager: CanvasPanelManager,
  options: {
    title?: string;
    submitLabel?: string;
    successMessage?: (savedTemplate: CanvasStoredTemplate) => string;
  } = {}
): Promise<CanvasStoredTemplate | undefined> {
  if (!panelManager.getCanvasNodes().some((node) => isTemplateCompatibleNodeKind(node.kind))) {
    await vscode.window.showInformationMessage(
      vscode.l10n.t('The current Canvas has no Agent / Terminal / Note nodes that can be saved as a template.')
    );
    return undefined;
  }

  const canvasNodes = panelManager.getCanvasNodes();
  const formResult = await showCanvasTemplateSaveForm({
    mode: 'save',
    title: options.title ?? vscode.l10n.t('Save current Canvas as template'),
    submitLabel: options.submitLabel ?? vscode.l10n.t('Save template'),
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
    return undefined;
  }

  const targetStorageLocation = panelManager
    .getCanvasTemplateStorageLocations()
    .find((location) => location.id === formResult.targetStorageLocationId);
  if (!targetStorageLocation) {
    throw new Error(vscode.l10n.t('Target template storage location does not exist.'));
  }

  const savedTemplate = await panelManager.saveCurrentCanvasAsTemplate(formResult.name, formResult.agentProviderSelection, {
    targetRootPath: targetStorageLocation.rootPath,
    associatedNoteSaveModes: formResult.associatedNoteSaveModes
  });
  await vscode.window.showInformationMessage(
    options.successMessage
      ? options.successMessage(savedTemplate)
      : vscode.l10n.t('Saved template "{name}".', { name: savedTemplate.template.name })
  );
  return savedTemplate;
}

async function importCanvasTemplateFromCommand(panelManager: CanvasPanelManager): Promise<void> {
  const selectedUris = await vscode.window.showOpenDialog({
    canSelectMany: false,
    canSelectFiles: true,
    canSelectFolders: false,
    filters: {
      JSON: ['json']
    },
    openLabel: vscode.l10n.t('Import template')
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
      title: vscode.l10n.t('Import template'),
      submitLabel: vscode.l10n.t('Import template'),
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
      throw new Error(vscode.l10n.t('Target template storage location does not exist.'));
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
      const backToFormAction = vscode.l10n.t('Return to form and edit name');
      const action = await vscode.window.showWarningMessage(
        vscode.l10n.t('Template name "{name}" is already used by a built-in template and cannot overwrite it.', {
          name: formResult.name
        }),
        backToFormAction
      );
      if (action === backToFormAction) {
        continue;
      }
      return;
    }

    if (userConflicts.length > 1) {
      const backToFormAction = vscode.l10n.t('Return to form and edit name');
      const action = await vscode.window.showWarningMessage(
        vscode.l10n.t('Multiple user templates named "{name}" already exist. Return to the form and edit the name before importing.', {
          name: formResult.name
        }),
        backToFormAction
      );
      if (action === backToFormAction) {
        continue;
      }
      return;
    }

    let overwriteTemplateId: string | undefined;
    if (userConflicts.length === 1) {
      const overwriteConflict = userConflicts[0];
      const overwriteAction = vscode.l10n.t('Overwrite existing template');
      const backToFormAction = vscode.l10n.t('Return to form and edit name');
      const action = await vscode.window.showWarningMessage(
        vscode.l10n.t('Template name "{name}" already exists. You can overwrite the existing user template, or return to the form and edit the name.', {
          name: formResult.name
        }),
        overwriteAction,
        backToFormAction
      );
      if (!action) {
        return;
      }

      if (action === backToFormAction) {
        continue;
      }
      if (action !== overwriteAction) {
        return;
      }
      overwriteTemplateId = overwriteConflict.template.id;
    }

    const savedTemplate = await panelManager.importCanvasTemplateFromPath(selectedUri.fsPath, {
      overwriteTemplateId,
      nameOverride: formResult.name,
      targetRootPath: targetStorageLocation.rootPath
    });
    await vscode.window.showInformationMessage(
      vscode.l10n.t('Imported template "{name}".', { name: savedTemplate.template.name })
    );
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
    vscode.l10n.t('Select a template and export it as JSON')
  );
  if (!selectedTemplate) {
    return;
  }

  const defaultFileName = `${sanitizeCanvasTemplateFileStem(
    selectedTemplate.template.name,
    selectedTemplate.template.id
  )}.json`;
  const targetUri = await vscode.window.showSaveDialog({
    saveLabel: vscode.l10n.t('Export template'),
    defaultUri: vscode.Uri.file(path.join(panelManager.getUserCanvasTemplateDirectoryPath(), defaultFileName)),
    filters: {
      JSON: ['json']
    }
  });
  if (!targetUri) {
    return;
  }

  await panelManager.exportCanvasTemplateById(selectedTemplate.template.id, targetUri);
  await vscode.window.showInformationMessage(
    vscode.l10n.t('Exported template "{name}".', { name: selectedTemplate.template.name })
  );
}

async function deleteCanvasTemplateFromCommand(
  panelManager: CanvasPanelManager,
  templateIdValue: unknown
): Promise<void> {
  const selectedTemplate = await resolveCanvasTemplateFromCommand(
    panelManager,
    templateIdValue,
    vscode.l10n.t('Select a user template and delete it')
  );
  if (!selectedTemplate) {
    return;
  }
  if (selectedTemplate.template.category !== 'user') {
    throw new Error(vscode.l10n.t('Built-in templates cannot be deleted.'));
  }

  const deleteTemplateAction = vscode.l10n.t('Continue deleting');
  const confirmed = await vscode.window.showWarningMessage(
    vscode.l10n.t('After deleting template "{name}", the user template file cannot be restored.', {
      name: selectedTemplate.template.name
    }),
    { modal: true },
    deleteTemplateAction
  );
  if (confirmed !== deleteTemplateAction) {
    return;
  }

  await panelManager.deleteCanvasTemplateById(selectedTemplate.template.id);
  await vscode.window.showInformationMessage(
    vscode.l10n.t('Deleted template "{name}".', { name: selectedTemplate.template.name })
  );
}

async function setDefaultCanvasTemplateFromCommand(
  panelManager: CanvasPanelManager,
  templateIdValue: unknown
): Promise<void> {
  const selectedTemplate = await resolveCanvasTemplateFromCommand(
    panelManager,
    templateIdValue,
    vscode.l10n.t('Select a template and set it as the default template')
  );
  if (!selectedTemplate) {
    return;
  }

  await panelManager.setDefaultCanvasTemplateById(selectedTemplate.template.id);
  await vscode.window.showInformationMessage(
    vscode.l10n.t('Set "{name}" as the default template.', { name: selectedTemplate.template.name })
  );
}

async function resolveCanvasTemplateFromCommand(
  panelManager: CanvasPanelManager,
  templateIdValue: unknown,
  placeHolder: string,
  options: CanvasTemplatePickOptions = {}
): Promise<CanvasStoredTemplate | undefined> {
  const explicitTemplateId = normalizeCanvasTemplateIdValue(templateIdValue);
  if (explicitTemplateId) {
    const catalog = await panelManager.getCanvasTemplateCatalog();
    const selectedTemplate = catalog.templates.find((candidate) => candidate.template.id === explicitTemplateId);
    if (!selectedTemplate) {
      throw new Error(vscode.l10n.t('Target template does not exist.'));
    }
    if (options.filter && !options.filter(selectedTemplate)) {
      throw new Error(vscode.l10n.t('Target template does not support this operation.'));
    }
    return selectedTemplate;
  }

  return pickCanvasTemplate(panelManager, placeHolder, options);
}

async function pickCanvasTemplate(
  panelManager: CanvasPanelManager,
  placeHolder: string,
  options: CanvasTemplatePickOptions = {}
): Promise<CanvasStoredTemplate | undefined> {
  const catalog = await panelManager.getCanvasTemplateCatalog();
  if (catalog.templates.length === 0) {
    await vscode.window.showInformationMessage(vscode.l10n.t('No templates are currently available.'));
    return undefined;
  }

  const defaultTemplateId = panelManager.getDefaultCanvasTemplateId();
  const templates = options.filter ? catalog.templates.filter(options.filter) : catalog.templates;
  if (templates.length === 0) {
    await vscode.window.showInformationMessage(options.emptyMessage ?? vscode.l10n.t('No templates currently match the criteria.'));
    return undefined;
  }
  const picked = await vscode.window.showQuickPick<CanvasTemplateQuickPickItem>(
    templates.map((storedTemplate) => ({
      label: storedTemplate.template.name,
      description: `${formatCanvasTemplateSourceForQuickPick(storedTemplate)} · ${formatCanvasTemplateStatsForQuickPick(storedTemplate.template)}${storedTemplate.template.id === defaultTemplateId ? ` · ${vscode.l10n.t('Default')}` : ''}`,
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

function formatCanvasTemplateSourceForQuickPick(storedTemplate: CanvasStoredTemplate): string {
  if (storedTemplate.template.category === 'builtin') {
    return vscode.l10n.t('Built-in');
  }
  if (storedTemplate.marketplace) {
    return vscode.l10n.t('Marketplace');
  }
  return vscode.l10n.t('User');
}

function formatCanvasTemplateStatsForQuickPick(template: Pick<CanvasTemplate, 'nodes'>): string {
  const counts = template.nodes.reduce(
    (stats, node) => {
      stats[node.kind] += 1;
      return stats;
    },
    {
      agent: 0,
      terminal: 0,
      note: 0
    }
  );
  const parts: string[] = [];
  if (counts.agent > 0) {
    parts.push(vscode.l10n.t('{count} Agent', { count: counts.agent }));
  }
  if (counts.terminal > 0) {
    parts.push(vscode.l10n.t('{count} Terminal', { count: counts.terminal }));
  }
  if (counts.note > 0) {
    parts.push(vscode.l10n.t('{count} Note', { count: counts.note }));
  }
  return parts.join(vscode.l10n.t(', ')) || vscode.l10n.t('0 Node');
}

async function showCanvasTemplateError(title: string, error: unknown): Promise<void> {
  const message = localizeCanvasTemplateError(error) ?? (error instanceof Error ? error.message : String(error));
  await vscode.window.showErrorMessage(
    vscode.l10n.t('{title}: {message}', {
      title,
      message
    })
  );
}

function normalizeCanvasTemplateIdValue(value: unknown): string | undefined {
  if (isRecord(value) && typeof value.templateId === 'string' && value.templateId.trim().length > 0) {
    return value.templateId.trim();
  }

  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function readTemplatePublishVersionTarget(value: unknown): string | undefined {
  return isRecord(value) && typeof value.templateIdOrSlug === 'string' && value.templateIdOrSlug.trim().length > 0
    ? value.templateIdOrSlug.trim()
    : undefined;
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
  templateMarketplacePanel: CanvasTemplateMarketplacePanelController,
  sidebarTemplateView: CanvasSidebarTemplateView,
  sidebarNodeListView: CanvasSidebarNodeListView,
  sidebarSessionHistoryView: CanvasSidebarSessionHistoryView
): void {
  if (!isTestHarnessMode(context.extensionMode)) {
    return;
  }

  context.subscriptions.push(
    vscode.commands.registerCommand(TEST_COMMAND_IDS.getDebugState, () => panelManager.getDebugSnapshot()),
    vscode.commands.registerCommand(TEST_COMMAND_IDS.getWebviewHtmlSnapshot, () =>
      panelManager.getWebviewHtmlSnapshotForTest()
    ),
    vscode.commands.registerCommand(TEST_COMMAND_IDS.getSidebarSummaryItems, () =>
      getCanvasSidebarSummaryItems(panelManager.getSidebarState())
    ),
    vscode.commands.registerCommand(TEST_COMMAND_IDS.getSidebarNodeListItems, () =>
      getCanvasSidebarNodeListItems(
        panelManager.getCanvasSidebarNodeListSnapshot(),
        panelManager.getWorkspaceFoldersForDisplay()
      )
    ),
    vscode.commands.registerCommand(TEST_COMMAND_IDS.getSidebarTemplateItems, async () => {
      const snapshot = await sidebarTemplateView.refresh();
      return snapshot.items;
    }),
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
      TEST_COMMAND_IDS.captureTemplateMarketplaceProbe,
      async (timeoutMs?: unknown) =>
        templateMarketplacePanel.captureTestProbe(typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : 5000)
    ),
    vscode.commands.registerCommand(
      TEST_COMMAND_IDS.performTemplateMarketplaceAction,
      async (action?: unknown, timeoutMs?: unknown) =>
        templateMarketplacePanel.performTestAction(action, typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : 5000)
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
      return vscode.l10n.t('Healthy');
    case 'standby':
      return vscode.l10n.t('Standby surface');
    case 'initializing':
      return vscode.l10n.t('Initializing');
    case 'attention':
      return vscode.l10n.t('Has traceable clues');
    case 'blocked':
      return vscode.l10n.t('Possibly blocked');
    case 'not-attached':
      return vscode.l10n.t('Not attached');
  }
}
