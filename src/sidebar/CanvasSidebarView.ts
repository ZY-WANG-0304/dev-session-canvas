import * as vscode from 'vscode';

import { type CanvasSidebarState, CanvasPanelManager } from '../panel/CanvasPanelManager';

type CanvasSidebarSection = 'summary' | 'filters';

const FILTER_CONTEXT_VALUES = {
  includeEmpty: 'canvasSidebarIncludeFilterEmpty',
  includeValue: 'canvasSidebarIncludeFilterValue',
  excludeEmpty: 'canvasSidebarExcludeFilterEmpty',
  excludeValue: 'canvasSidebarExcludeFilterValue'
} as const;

class CanvasSidebarItem extends vscode.TreeItem {
  public constructor(
    id: string,
    label: string,
    options?: {
      description?: string;
      tooltip?: string;
      contextValue?: string;
    }
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.id = id;
    this.description = options?.description;
    this.tooltip = options?.tooltip;
    this.contextValue = options?.contextValue;
  }
}

export class CanvasSidebarView implements vscode.TreeDataProvider<CanvasSidebarItem>, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  public readonly onDidChangeTreeData = this.changeEmitter.event;

  private readonly stateSubscription: vscode.Disposable;

  public constructor(
    private readonly panelManager: CanvasPanelManager,
    private readonly section: CanvasSidebarSection
  ) {
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

    const state = this.panelManager.getSidebarState();
    return this.section === 'filters' ? buildFilterItems(state) : buildSummaryItems(state);
  }
}

function buildFilterItems(state: CanvasSidebarState): CanvasSidebarItem[] {
  return [
    new CanvasSidebarItem('files/include', 'Files to Include', {
      description: summarizeFilterGlobs('include', state.fileFilters.includeGlobs),
      tooltip: buildFilterTooltip('include', state.fileFilters.includeGlobs),
      contextValue:
        state.fileFilters.includeGlobs.length > 0 ? FILTER_CONTEXT_VALUES.includeValue : FILTER_CONTEXT_VALUES.includeEmpty
    }),
    new CanvasSidebarItem('files/exclude', 'Files to Exclude', {
      description: summarizeFilterGlobs('exclude', state.fileFilters.excludeGlobs),
      tooltip: buildFilterTooltip('exclude', state.fileFilters.excludeGlobs),
      contextValue:
        state.fileFilters.excludeGlobs.length > 0 ? FILTER_CONTEXT_VALUES.excludeValue : FILTER_CONTEXT_VALUES.excludeEmpty
    })
  ];
}

function buildSummaryItems(state: CanvasSidebarState): CanvasSidebarItem[] {
  return [
    new CanvasSidebarItem('summary/canvas-surface', '画布状态', {
      description: formatCanvasSurfaceSummary(state),
      tooltip: buildCanvasSurfaceTooltip(state)
    }),
    new CanvasSidebarItem('summary/default-surface', '默认承载面', {
      description: formatSurfaceLabel(state.configuredSurface),
      tooltip:
        `当前默认承载面：${formatSurfaceLabel(state.configuredSurface)}。\n` +
        'Panel 路线的实际工作台位置由 VS Code 记住，可能位于底部 Panel 或 Secondary Sidebar。'
    }),
    new CanvasSidebarItem('summary/node-count', '节点总数', {
      description: String(state.nodeCount),
      tooltip: `当前画布中共有 ${state.nodeCount} 个节点。`
    }),
    new CanvasSidebarItem('summary/running-executions', '运行中会话', {
      description: String(state.runningExecutionCount),
      tooltip: `当前正在运行的 Agent / Terminal 会话总数：${state.runningExecutionCount}。`
    }),
    new CanvasSidebarItem('summary/workspace-trust', 'Workspace Trust', {
      description: state.workspaceTrusted ? '已信任' : 'Restricted Mode',
      tooltip: state.workspaceTrusted
        ? '当前 workspace 已受信任，所有对象类型都可按各自能力创建。'
        : '当前 workspace 处于 Restricted Mode；执行型对象会降级，仅保留安全的侧栏与画布浏览能力。'
    }),
    new CanvasSidebarItem('summary/creatable-kinds', '可创建对象', {
      description: formatCreatableKinds(state),
      tooltip: `当前允许创建的对象类型：${formatCreatableKinds(state)}。`
    })
  ];
}

function summarizeFilterGlobs(kind: 'include' | 'exclude', globs: readonly string[]): string {
  if (globs.length === 0) {
    return kind === 'include' ? '全部文件' : '未设置';
  }

  const visibleGlobs = globs.slice(0, 2).join(', ');
  return globs.length > 2 ? `${visibleGlobs}, +${globs.length - 2}` : visibleGlobs;
}

function buildFilterTooltip(kind: 'include' | 'exclude', globs: readonly string[]): string {
  const title = kind === 'include' ? 'Files to Include' : 'Files to Exclude';
  const value =
    globs.length > 0 ? globs.join(', ') : kind === 'include' ? '未设置；默认不过滤任何文件。' : '未设置；默认不排除文件。';

  return `${title}\n当前值：${value}\n只影响文件对象与自动边的显示投影，不会修改 fileReferences。`;
}

function formatCanvasSurfaceSummary(state: CanvasSidebarState): string {
  switch (state.canvasSurface) {
    case 'closed':
      return '未打开';
    case 'hidden':
      return `${formatSurfaceLabel(state.surfaceLocation)}（已隐藏）`;
    case 'visible':
      return formatSurfaceLabel(state.surfaceLocation);
  }
}

function buildCanvasSurfaceTooltip(state: CanvasSidebarState): string {
  switch (state.canvasSurface) {
    case 'closed':
      return `当前还没有打开画布；执行“打开画布”时会按默认承载面 ${formatSurfaceLabel(state.configuredSurface)} 打开。`;
    case 'hidden':
      return `画布实例当前位于 ${formatSurfaceLabel(state.surfaceLocation)} 路线，但不在前台。`;
    case 'visible':
      return `画布当前正在 ${formatSurfaceLabel(state.surfaceLocation)} 路线显示。`;
  }
}

function formatSurfaceLabel(surface: CanvasSidebarState['surfaceLocation']): string {
  return surface === 'panel' ? 'Panel' : 'Editor';
}

function formatCreatableKinds(state: CanvasSidebarState): string {
  if (state.creatableKinds.length === 0) {
    return '无';
  }

  return state.creatableKinds
    .map((kind) => {
      switch (kind) {
        case 'agent':
          return 'Agent';
        case 'terminal':
          return 'Terminal';
        case 'note':
          return 'Note';
      }
    })
    .join(', ');
}
