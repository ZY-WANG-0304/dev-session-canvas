import * as vscode from 'vscode';

import {
  strongTerminalAttentionReminderPulsesMinimap,
  strongTerminalAttentionReminderShowsTitleBar
} from '../common/protocol';
import { COMMAND_IDS } from '../common/extensionIdentity';
import { shortenMiddle } from '../panel/agentCliSelection';
import { type CanvasSidebarState, CanvasPanelManager } from '../panel/CanvasPanelManager';

class CanvasSidebarItem extends vscode.TreeItem {
  public constructor(
    id: string,
    label: string,
    description: string,
    tooltip: string,
    command?: vscode.Command,
    contextValue?: string
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.id = id;
    this.description = description;
    this.tooltip = tooltip;
    this.command = command;
    this.contextValue = contextValue;
  }
}

export interface CanvasSidebarSummaryItemSnapshot {
  id: string;
  label: string;
  description: string;
  tooltip: string;
  command?: vscode.Command;
  contextValue?: string;
}

export class CanvasSidebarView implements vscode.TreeDataProvider<CanvasSidebarItem>, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  public readonly onDidChangeTreeData = this.changeEmitter.event;

  private readonly stateSubscription: vscode.Disposable;

  public constructor(private readonly panelManager: CanvasPanelManager) {
    this.stateSubscription = this.panelManager.onDidChangeSidebarState(() => {
      this.changeEmitter.fire();
    });
  }

  public dispose(): void {
    this.changeEmitter.dispose();
    this.stateSubscription.dispose();
  }

  public getTreeItem(element: CanvasSidebarItem): vscode.TreeItem {
    return element;
  }

  public getChildren(element?: CanvasSidebarItem): CanvasSidebarItem[] {
    if (element) {
      return [];
    }

    return buildSummaryItems(this.panelManager.getSidebarState());
  }
}

function buildSummaryItems(state: CanvasSidebarState): CanvasSidebarItem[] {
  return getCanvasSidebarSummaryItems(state).map(
    (item) => new CanvasSidebarItem(item.id, item.label, item.description, item.tooltip, item.command, item.contextValue)
  );
}

export function getCanvasSidebarSummaryItems(state: CanvasSidebarState): CanvasSidebarSummaryItemSnapshot[] {
  return [
    {
      id: 'summary/workspace-trust',
      label: vscode.l10n.t('Workspace Trust'),
      description: state.workspaceTrusted ? vscode.l10n.t('Trusted') : vscode.l10n.t('Restricted Mode'),
      tooltip: state.workspaceTrusted
        ? vscode.l10n.t('The current workspace is trusted. Execution objects can be created and run according to their capabilities.')
        : vscode.l10n.t('The current workspace is in Restricted Mode. Execution objects are downgraded, leaving only safe sidebar and Canvas browsing.')
    },
    {
      id: 'summary/canvas-surface',
      label: vscode.l10n.t('Canvas State'),
      description: formatCanvasSurfaceSummary(state),
      tooltip: buildCanvasSurfaceTooltip(state)
    },
    {
      id: 'summary/runtime-persistence',
      label: vscode.l10n.t('Runtime Persistence'),
      description: state.runtimePersistenceEnabled ? vscode.l10n.t('Enabled') : vscode.l10n.t('Disabled'),
      tooltip: state.runtimePersistenceEnabled
        ? vscode.l10n.t('Runtime persistence is enabled for this window. Agent and Terminal sessions are held by the dedicated runtime host backend when possible.')
        : vscode.l10n.t('Runtime persistence is disabled for this window. Agent and Terminal sessions will not keep a live runtime host.')
    },
    {
      id: 'summary/notification-mode',
      label: vscode.l10n.t('Notification Mode'),
      description: formatNotificationModeSummary(state),
      tooltip: buildNotificationModeTooltip(state)
    },
    {
      id: 'summary/files-feature',
      label: vscode.l10n.t('Files'),
      description: formatFilesFeatureSummary(state),
      tooltip: buildFileViewTooltip(state)
    },
    {
      id: 'summary/node-count',
      label: vscode.l10n.t('Total Nodes'),
      description: String(state.nodeCount),
      tooltip: vscode.l10n.t('There are {count} nodes on the current Canvas.', { count: state.nodeCount })
    },
    {
      id: 'summary/running-executions',
      label: vscode.l10n.t('Running Sessions'),
      description: String(state.runningExecutionCount),
      tooltip: vscode.l10n.t('Total running Agent / Terminal sessions: {count}.', {
        count: state.runningExecutionCount
      })
    },
    {
      id: 'summary/terminal-shell',
      label: vscode.l10n.t('Terminal'),
      description: formatConfigSummaryValue(state.terminalShellPath),
      tooltip: [
        vscode.l10n.t('Click to select the embedded Terminal shell.'),
        vscode.l10n.t('Configured value: {value}', { value: state.terminalShellConfiguredValue }),
        vscode.l10n.t('Resolved path: {path}', { path: state.terminalShellPath || vscode.l10n.t('not resolved') })
      ].join('\n'),
      command: {
        command: COMMAND_IDS.selectTerminalShell,
        title: vscode.l10n.t('Select Terminal shell')
      }
    },
    {
      id: 'summary/codex-cli',
      label: vscode.l10n.t('Codex Command'),
      description: formatConfigSummaryValue(state.agentCodexCommand),
      tooltip: [
        vscode.l10n.t('Click to select or install the Codex command.'),
        vscode.l10n.t('Current configuration: {value}', { value: state.agentCodexCommand })
      ].join('\n'),
      command: {
        command: COMMAND_IDS.selectCodexCli,
        title: vscode.l10n.t('Select Codex CLI')
      },
      contextValue: 'codexCliConfig'
    },
    {
      id: 'summary/claude-cli',
      label: vscode.l10n.t('Claude Code Command'),
      description: formatConfigSummaryValue(state.agentClaudeCommand),
      tooltip: [
        vscode.l10n.t('Click to select or install the Claude Code command.'),
        vscode.l10n.t('Current configuration: {value}', { value: state.agentClaudeCommand })
      ].join('\n'),
      command: {
        command: COMMAND_IDS.selectClaudeCli,
        title: vscode.l10n.t('Select Claude Code CLI')
      },
      contextValue: 'claudeCliConfig'
    }
  ];
}

function formatConfigSummaryValue(value: string): string {
  return shortenMiddle(value.trim() || vscode.l10n.t('Not configured'));
}

function formatCanvasSurfaceSummary(state: CanvasSidebarState): string {
  const canvasSurfaceLabel = (() => {
    switch (state.canvasSurface) {
      case 'closed':
        return vscode.l10n.t('Closed');
      case 'hidden':
        return vscode.l10n.t('Open');
      case 'visible':
        return vscode.l10n.t('Open');
    }
  })();

  return `${canvasSurfaceLabel} · ${formatSurfaceLabel(resolveCanvasSurfaceSummaryLocation(state))}`;
}

function buildCanvasSurfaceTooltip(state: CanvasSidebarState): string {
  const defaultSurfaceLine = buildSurfaceLocationLine(vscode.l10n.t('Default surface'), state.configuredSurface);
  const currentSurfaceLine =
    state.canvasSurface === 'closed' || state.surfaceLocation === state.configuredSurface
      ? undefined
      : buildSurfaceLocationLine(vscode.l10n.t('Current instance surface'), state.surfaceLocation);

  switch (state.canvasSurface) {
    case 'closed':
      return [
        vscode.l10n.t('No Canvas is open yet. Running "Open Canvas" will open it on the default surface {surface}.', {
          surface: formatSurfaceLabel(state.configuredSurface)
        }),
        defaultSurfaceLine
      ].join('\n');
    case 'hidden':
      return [
        vscode.l10n.t('The Canvas is open but not in front. Run "Reveal Canvas" to return to the current instance.'),
        currentSurfaceLine,
        defaultSurfaceLine
      ]
        .filter((line): line is string => typeof line === 'string')
        .join('\n');
    case 'visible':
      return [vscode.l10n.t('The Canvas is open and visible in front.'), currentSurfaceLine, defaultSurfaceLine]
        .filter((line): line is string => typeof line === 'string')
        .join('\n');
  }
}

function formatSurfaceLabel(surface: CanvasSidebarState['surfaceLocation']): string {
  return surface === 'panel' ? 'Panel' : 'Editor';
}

function resolveCanvasSurfaceSummaryLocation(state: CanvasSidebarState): CanvasSidebarState['surfaceLocation'] {
  return state.canvasSurface === 'closed' ? state.configuredSurface : state.surfaceLocation;
}

function buildSurfaceLocationLine(
  label: string,
  surface: CanvasSidebarState['surfaceLocation']
): string {
  const prefix = vscode.l10n.t('{label}: {surface}.', { label, surface: formatSurfaceLabel(surface) });
  if (surface !== 'panel') {
    return prefix;
  }

  return `${prefix} ${vscode.l10n.t('VS Code remembers the actual workbench location for the Panel route; it may be in the bottom Panel or the Secondary Sidebar.')}`;
}

function formatNotificationModeSummary(state: CanvasSidebarState): string {
  const bridgeStatus = formatNotificationBridgeStatus(state);
  return `${bridgeStatus} · ${formatAttentionSignalsLabel(state)} · ${formatStrongReminderModeLabel(state)} · ${formatAgentAbnormalOutputTextModeLabel(state)}`;
}

function buildNotificationModeTooltip(state: CanvasSidebarState): string {
  return [
    vscode.l10n.t('Execution nodes show the alert icon and minimap pulse only after receiving an enabled attention signal.'),
    vscode.l10n.t('Enabled attention signals: {signals}.', { signals: formatAttentionSignalsTooltip(state) }),
    formatNotificationBridgeTooltip(state),
    vscode.l10n.t('Strong reminder mode: {mode}.', { mode: formatStrongReminderModeLabel(state) }),
    vscode.l10n.t('Abnormal text alerts: {mode}.', { mode: formatAgentAbnormalOutputTextModeLabel(state) }),
    '',
    vscode.l10n.t('Tip: notifications depend on the Agent CLI (Claude Code or Codex) being configured to emit notifications.'),
    vscode.l10n.t('Claude Code: set preferredNotifChannel: "iterm2"'),
    vscode.l10n.t('Codex: set notifications = true, notification_method = "osc9", notification_condition = "always" under [tui]')
  ].join('\n');
}

function formatNotificationBridgeStatus(state: CanvasSidebarState): string {
  switch (state.notificationBridgeMode) {
    case 'none':
      return vscode.l10n.t('No bridge');
    case 'workbench':
      return vscode.l10n.t('Workbench messages');
    case 'system':
      return vscode.l10n.t('System notifications');
  }
}

function formatNotificationBridgeTooltip(state: CanvasSidebarState): string {
  switch (state.notificationBridgeMode) {
    case 'none':
      return vscode.l10n.t('No additional workbench messages or system notifications are bridged; only in-node attention remains.');
    case 'workbench':
      return vscode.l10n.t('Attention signals are bridged to VS Code workbench messages.');
    case 'system':
      return vscode.l10n.t('System notifications are sent through the local Notifier companion first; if the companion is unavailable or delivery fails, VS Code workbench messages are used as fallback.');
  }
}

function formatAttentionSignalsLabel(state: CanvasSidebarState): string {
  const enabledSignals = state.enabledAttentionSignals;
  if (enabledSignals.length === 0) {
    return vscode.l10n.t('attention off');
  }

  if (enabledSignals.length === 5) {
    return vscode.l10n.t('all attention');
  }

  if (
    enabledSignals.length === 3 &&
    enabledSignals.includes('bel') &&
    enabledSignals.includes('osc9') &&
    enabledSignals.includes('osc777')
  ) {
    return vscode.l10n.t('all terminal signals');
  }

  return enabledSignals.map(formatAttentionSignalName).join('+');
}

function formatAttentionSignalsTooltip(state: CanvasSidebarState): string {
  return state.enabledAttentionSignals.length === 0
    ? vscode.l10n.t('none')
    : state.enabledAttentionSignals.map(formatAttentionSignalName).join(', ');
}

function formatAttentionSignalName(signal: CanvasSidebarState['enabledAttentionSignals'][number]): string {
  switch (signal) {
    case 'bel':
      return 'BEL';
    case 'osc9':
      return 'OSC 9';
    case 'osc777':
      return 'OSC 777';
    case 'agentAbnormalExit':
      return vscode.l10n.t('Agent abnormal exit');
    case 'codexAbnormalOutputText':
      return vscode.l10n.t('Codex abnormal text');
  }
}

function formatStrongReminderSurfaceSummary(state: CanvasSidebarState): string | undefined {
  const flashesTitleBar = strongTerminalAttentionReminderShowsTitleBar(state.notificationStrongReminderMode);
  const pulsesMinimap = strongTerminalAttentionReminderPulsesMinimap(state.notificationStrongReminderMode);

  if (flashesTitleBar && pulsesMinimap) {
    return vscode.l10n.t('Title Bar + Minimap boost');
  }

  if (flashesTitleBar) {
    return vscode.l10n.t('Title Bar boost');
  }

  if (pulsesMinimap) {
    return vscode.l10n.t('Minimap boost');
  }

  return undefined;
}

function formatStrongReminderModeLabel(state: CanvasSidebarState): string {
  const strongReminderSurface = formatStrongReminderSurfaceSummary(state);
  return strongReminderSurface ?? vscode.l10n.t('Standard alert');
}

function formatAgentAbnormalOutputTextModeLabel(state: CanvasSidebarState): string {
  return state.agentAbnormalOutputTextNotificationMode === 'codex'
    ? vscode.l10n.t('Codex abnormal text')
    : vscode.l10n.t('Text abnormal alerts off');
}

function formatFileViewSummary(state: CanvasSidebarState): string {
  return `${formatFilePresentationLabel(state)} · ${formatFileDisplayModeLabel(state)}`;
}

function formatFilesFeatureSummary(state: CanvasSidebarState): string {
  return `${state.filesFeatureEnabled ? vscode.l10n.t('Enabled') : vscode.l10n.t('Disabled')} · ${formatFileViewSummary(state)}`;
}

function buildFileViewTooltip(state: CanvasSidebarState): string {
  return [
    state.filesFeatureEnabled
      ? vscode.l10n.t('Files are enabled. The settings below directly affect file object projections in the current window.')
      : vscode.l10n.t('Files are disabled. The settings below take effect after files are re-enabled and the window reloads.'),
    vscode.l10n.t('File node type: {type}.', { type: formatFilePresentationLabel(state) }),
    vscode.l10n.t('Display mode: {mode}.', { mode: formatFileDisplayModeLabel(state) }),
    vscode.l10n.t('Display style: {style}.', { style: formatFileNodeDisplayStyleLabel(state.fileNodeDisplayStyle) })
  ].join('\n');
}

function formatFilePresentationLabel(state: CanvasSidebarState): string {
  return state.filePresentationMode === 'lists' ? vscode.l10n.t('List nodes') : vscode.l10n.t('Standalone nodes');
}

function formatFileDisplayModeLabel(state: CanvasSidebarState): string {
  switch (state.fileNodeDisplayMode) {
    case 'icon-only':
      return vscode.l10n.t('Icon only');
    case 'path-only':
      return state.filePathDisplayMode === 'relative-path'
        ? vscode.l10n.t('Relative path only')
        : vscode.l10n.t('File name only');
    case 'icon-path':
      return state.filePathDisplayMode === 'relative-path'
        ? vscode.l10n.t('Icon + relative path')
        : vscode.l10n.t('Icon + file name');
  }
}

function formatFileNodeDisplayStyleLabel(style: CanvasSidebarState['fileNodeDisplayStyle']): string {
  return style === 'card' ? vscode.l10n.t('Card') : vscode.l10n.t('Minimal');
}
