import * as vscode from 'vscode';

import {
  strongTerminalAttentionReminderPulsesMinimap,
  strongTerminalAttentionReminderShowsTitleBar
} from '../common/protocol';
import { type CanvasSidebarState, CanvasPanelManager } from '../panel/CanvasPanelManager';

class CanvasSidebarItem extends vscode.TreeItem {
  public constructor(id: string, label: string, description: string, tooltip: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.id = id;
    this.description = description;
    this.tooltip = tooltip;
  }
}

export interface CanvasSidebarSummaryItemSnapshot {
  id: string;
  label: string;
  description: string;
  tooltip: string;
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
    (item) => new CanvasSidebarItem(item.id, item.label, item.description, item.tooltip)
  );
}

export function getCanvasSidebarSummaryItems(state: CanvasSidebarState): CanvasSidebarSummaryItemSnapshot[] {
  return [
    {
      id: 'summary/canvas-surface',
      label: '画布状态',
      description: formatCanvasSurfaceSummary(state),
      tooltip: buildCanvasSurfaceTooltip(state)
    },
    {
      id: 'summary/runtime-persistence',
      label: '运行时持久化',
      description: state.runtimePersistenceEnabled ? '已开启' : '已关闭',
      tooltip: state.runtimePersistenceEnabled
        ? '当前窗口已启用运行时持久化；Agent 与 Terminal 会优先由独立 runtime host backend 持有。'
        : '当前窗口未启用运行时持久化；Agent 与 Terminal 不会保留 live runtime host。'
    },
    {
      id: 'summary/notification-mode',
      label: '通知模式',
      description: formatNotificationModeSummary(state),
      tooltip: buildNotificationModeTooltip(state)
    },
    {
      id: 'summary/files-feature',
      label: '文件功能',
      description: formatFilesFeatureSummary(state),
      tooltip: buildFileViewTooltip(state)
    },
    {
      id: 'summary/node-count',
      label: '节点总数',
      description: String(state.nodeCount),
      tooltip: `当前画布中共有 ${state.nodeCount} 个节点。`
    },
    {
      id: 'summary/running-executions',
      label: '运行中会话',
      description: String(state.runningExecutionCount),
      tooltip: `当前正在运行的 Agent / Terminal 会话总数：${state.runningExecutionCount}。`
    },
    {
      id: 'summary/workspace-trust',
      label: '工作区信任',
      description: state.workspaceTrusted ? '已信任' : '受限模式',
      tooltip: state.workspaceTrusted
        ? '当前工作区已受信任，执行型对象可按各自能力创建和运行。'
        : '当前工作区处于受限模式；执行型对象会降级，仅保留安全的侧栏与画布浏览能力。'
    }
  ];
}

function formatCanvasSurfaceSummary(state: CanvasSidebarState): string {
  const canvasSurfaceLabel = (() => {
    switch (state.canvasSurface) {
      case 'closed':
        return '未打开';
      case 'hidden':
        return '已打开';
      case 'visible':
        return '已打开';
    }
  })();

  return `${canvasSurfaceLabel} · ${formatSurfaceLabel(resolveCanvasSurfaceSummaryLocation(state))}`;
}

function buildCanvasSurfaceTooltip(state: CanvasSidebarState): string {
  const defaultSurfaceLine = buildSurfaceLocationLine('当前默认承载面', state.configuredSurface);
  const currentSurfaceLine =
    state.canvasSurface === 'closed' || state.surfaceLocation === state.configuredSurface
      ? undefined
      : buildSurfaceLocationLine('当前实例承载面', state.surfaceLocation);

  switch (state.canvasSurface) {
    case 'closed':
      return `当前还没有打开画布；执行“打开画布”时会按默认承载面 ${formatSurfaceLabel(state.configuredSurface)} 打开。\n${defaultSurfaceLine}`;
    case 'hidden':
      return ['画布已经打开，但当前不在前台；可执行“定位画布”回到当前实例。', currentSurfaceLine, defaultSurfaceLine]
        .filter((line): line is string => typeof line === 'string')
        .join('\n');
    case 'visible':
      return ['画布当前已经打开，并显示在前台。', currentSurfaceLine, defaultSurfaceLine]
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
  const prefix = `${label}：${formatSurfaceLabel(surface)}。`;
  if (surface !== 'panel') {
    return prefix;
  }

  return `${prefix} Panel 路线的实际工作台位置由 VS Code 记住，可能位于底部 Panel 或 Secondary Sidebar。`;
}

function formatNotificationModeSummary(state: CanvasSidebarState): string {
  const parts: string[] = [];

  if (state.notificationBridgeEnabled) {
    parts.push('工作台通知');
  }

  const strongReminderSurface = formatStrongReminderSurfaceSummary(state);
  if (strongReminderSurface) {
    parts.push(strongReminderSurface);
  }

  return parts.length > 0 ? parts.join(' + ') : '仅节点提醒';
}

function buildNotificationModeTooltip(state: CanvasSidebarState): string {
  return [
    '执行节点收到 BEL、OSC 9 或 OSC 777 时，节点提醒 icon 与 minimap 闪烁会始终保留。',
    state.notificationBridgeEnabled
      ? '当前已开启 VS Code 工作台通知桥接。'
      : '当前未开启 VS Code 工作台通知桥接。',
    `增强提醒模式：${formatStrongReminderModeLabel(state)}。`,
    '',
    '💡 通知功能依赖于 Agent CLI（Claude Code 或 Codex）配置开启通知功能。',
    '• Claude Code：需配置 Terminal Bell Notifications',
    '• Codex：需设置 notification_method 和 notification_condition'
  ].join('\n');
}

function formatStrongReminderSurfaceSummary(state: CanvasSidebarState): string | undefined {
  const flashesTitleBar = strongTerminalAttentionReminderShowsTitleBar(state.notificationStrongReminderMode);
  const pulsesMinimap = strongTerminalAttentionReminderPulsesMinimap(state.notificationStrongReminderMode);

  if (flashesTitleBar && pulsesMinimap) {
    return '标题栏/Minimap 增强';
  }

  if (flashesTitleBar) {
    return '标题栏增强';
  }

  if (pulsesMinimap) {
    return 'Minimap 增强';
  }

  return undefined;
}

function formatStrongReminderModeLabel(state: CanvasSidebarState): string {
  const strongReminderSurface = formatStrongReminderSurfaceSummary(state);
  return strongReminderSurface ?? '仅默认提醒';
}

function formatFileViewSummary(state: CanvasSidebarState): string {
  return `${formatFilePresentationLabel(state)} · ${formatFileDisplayModeLabel(state)}`;
}

function formatFilesFeatureSummary(state: CanvasSidebarState): string {
  return `${state.filesFeatureEnabled ? '已开启' : '已关闭'} · ${formatFileViewSummary(state)}`;
}

function buildFileViewTooltip(state: CanvasSidebarState): string {
  return [
    state.filesFeatureEnabled
      ? '文件功能当前已开启；以下配置会直接影响当前窗口里的文件对象投影。'
      : '文件功能当前已关闭；以下配置会在重新启用并完成 reload 后生效。',
    `文件节点类型：${formatFilePresentationLabel(state)}。`,
    `显示模式：${formatFileDisplayModeLabel(state)}。`,
    `显示风格：${formatFileNodeDisplayStyleLabel(state.fileNodeDisplayStyle)}。`
  ].join('\n');
}

function formatFilePresentationLabel(state: CanvasSidebarState): string {
  return state.filePresentationMode === 'lists' ? '列表节点' : '独立节点';
}

function formatFileDisplayModeLabel(state: CanvasSidebarState): string {
  switch (state.fileNodeDisplayMode) {
    case 'icon-only':
      return '仅图标';
    case 'path-only':
      return state.filePathDisplayMode === 'relative-path' ? '仅相对路径' : '仅文件名';
    case 'icon-path':
      return state.filePathDisplayMode === 'relative-path' ? '图标+相对路径' : '图标+文件名';
  }
}

function formatFileNodeDisplayStyleLabel(style: CanvasSidebarState['fileNodeDisplayStyle']): string {
  return style === 'card' ? '卡片' : '极简';
}
