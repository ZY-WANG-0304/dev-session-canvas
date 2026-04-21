import * as vscode from 'vscode';

import { type CanvasSidebarState, CanvasPanelManager } from '../panel/CanvasPanelManager';

class CanvasSidebarItem extends vscode.TreeItem {
  public constructor(id: string, label: string, description: string, tooltip: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.id = id;
    this.description = description;
    this.tooltip = tooltip;
  }
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
  return [
    new CanvasSidebarItem(
      'summary/canvas-surface',
      '画布状态',
      formatCanvasSurfaceSummary(state),
      buildCanvasSurfaceTooltip(state)
    ),
    new CanvasSidebarItem(
      'summary/default-surface',
      '默认承载面',
      formatSurfaceLabel(state.configuredSurface),
      `当前默认承载面：${formatSurfaceLabel(state.configuredSurface)}。\n` +
        'Panel 路线的实际工作台位置由 VS Code 记住，可能位于底部 Panel 或 Secondary Sidebar。'
    ),
    new CanvasSidebarItem(
      'summary/runtime-persistence',
      '运行时持久化',
      state.runtimePersistenceEnabled ? '已开启' : '已关闭',
      state.runtimePersistenceEnabled
        ? '当前窗口已启用运行时持久化；Agent 与 Terminal 会优先由独立 runtime host backend 持有。'
        : '当前窗口未启用运行时持久化；Agent 与 Terminal 不会保留 live runtime host。'
    ),
    new CanvasSidebarItem(
      'summary/files-feature',
      '文件功能',
      state.filesFeatureEnabled ? '已开启' : '已关闭',
      state.filesFeatureEnabled
        ? '当前窗口已启用文件活动功能；支持的 Agent 会生成文件节点、文件列表节点和相关过滤入口。'
        : '当前窗口未启用文件活动功能；文件节点、文件列表节点、文件过滤和自动文件关系都不可用。'
    ),
    new CanvasSidebarItem(
      'summary/node-count',
      '节点总数',
      String(state.nodeCount),
      `当前画布中共有 ${state.nodeCount} 个节点。`
    ),
    new CanvasSidebarItem(
      'summary/running-executions',
      '运行中会话',
      String(state.runningExecutionCount),
      `当前正在运行的 Agent / Terminal 会话总数：${state.runningExecutionCount}。`
    ),
    new CanvasSidebarItem(
      'summary/workspace-trust',
      '工作区信任',
      state.workspaceTrusted ? '已信任' : '受限模式',
      state.workspaceTrusted
        ? '当前工作区已受信任，执行型对象可按各自能力创建和运行。'
        : '当前工作区处于受限模式；执行型对象会降级，仅保留安全的侧栏与画布浏览能力。'
    )
  ];
}

function formatCanvasSurfaceSummary(state: CanvasSidebarState): string {
  switch (state.canvasSurface) {
    case 'closed':
      return '未打开';
    case 'hidden':
      return '已打开';
    case 'visible':
      return '已打开';
  }
}

function buildCanvasSurfaceTooltip(state: CanvasSidebarState): string {
  switch (state.canvasSurface) {
    case 'closed':
      return `当前还没有打开画布；执行“打开画布”时会按默认承载面 ${formatSurfaceLabel(state.configuredSurface)} 打开。`;
    case 'hidden':
      return '画布已经打开，但当前不在前台；可执行“定位画布”回到当前实例。';
    case 'visible':
      return '画布当前已经打开，并显示在前台。';
  }
}

function formatSurfaceLabel(surface: CanvasSidebarState['surfaceLocation']): string {
  return surface === 'panel' ? 'Panel' : 'Editor';
}
