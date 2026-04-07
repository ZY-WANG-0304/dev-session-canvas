import * as vscode from 'vscode';

import { COMMAND_IDS, EXTENSION_DISPLAY_NAME } from '../common/extensionIdentity';
import type { CanvasNodeKind } from '../common/protocol';
import { type CanvasSidebarState, CanvasPanelManager } from '../panel/CanvasPanelManager';

interface CanvasSidebarEntry {
  id: string;
  label: string;
  description?: string;
  tooltip?: string;
  command?: vscode.Command;
  icon?: vscode.ThemeIcon;
}

export class CanvasSidebarView implements vscode.TreeDataProvider<CanvasSidebarEntry>, vscode.Disposable {
  private readonly didChangeTreeDataEmitter = new vscode.EventEmitter<CanvasSidebarEntry | undefined>();
  private readonly stateSubscription: vscode.Disposable;

  public readonly onDidChangeTreeData = this.didChangeTreeDataEmitter.event;

  public constructor(private readonly panelManager: CanvasPanelManager) {
    this.stateSubscription = this.panelManager.onDidChangeSidebarState(() => {
      this.didChangeTreeDataEmitter.fire(undefined);
    });
  }

  public dispose(): void {
    this.stateSubscription.dispose();
    this.didChangeTreeDataEmitter.dispose();
  }

  public getTreeItem(element: CanvasSidebarEntry): vscode.TreeItem {
    const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
    item.id = element.id;
    item.description = element.description;
    item.tooltip = element.tooltip;
    item.command = element.command;
    item.iconPath = element.icon;
    return item;
  }

  public getChildren(element?: CanvasSidebarEntry): CanvasSidebarEntry[] {
    if (element) {
      return [];
    }

    return buildSidebarEntries(this.panelManager.getSidebarState());
  }
}

function buildSidebarEntries(state: CanvasSidebarState): CanvasSidebarEntry[] {
  return [
    {
      id: 'action-open-canvas',
      label: state.canvasSurface === 'closed' ? '打开画布' : '定位画布',
      description: describeSurfaceState(state.surfaceLocation, state.canvasSurface),
      tooltip:
        state.canvasSurface === 'visible'
          ? `${EXTENSION_DISPLAY_NAME} 画布已在当前${humanizeSurfaceLocation(state.surfaceLocation)}可见。`
          : state.canvasSurface === 'hidden'
            ? `${EXTENSION_DISPLAY_NAME} 画布当前位于${humanizeSurfaceLocation(state.surfaceLocation)}，但不在前台。`
            : `当前还没有在${humanizeSurfaceLocation(state.surfaceLocation)}打开 ${EXTENSION_DISPLAY_NAME} 画布。`,
      command: getOpenCanvasCommand(state),
      icon: new vscode.ThemeIcon('layout')
    },
    {
      id: 'action-create-node',
      label: '创建对象',
      description: describeCreatableKinds(state.creatableKinds),
      tooltip: '创建一个新的 Agent、Terminal 或 Note 节点。',
      command: {
        command: COMMAND_IDS.createNode,
        title: `${EXTENSION_DISPLAY_NAME}: 创建对象`
      },
      icon: new vscode.ThemeIcon('add')
    },
    {
      id: 'action-reset-state',
      label: '重置宿主状态',
      description:
        state.runningExecutionCount > 0 ? `会停止 ${state.runningExecutionCount} 个运行中会话` : '清空当前画布节点',
      tooltip: '清空当前 workspace 绑定的画布对象，并停止运行中的 Agent / Terminal 会话。',
      command: {
        command: COMMAND_IDS.resetCanvasState,
        title: `${EXTENSION_DISPLAY_NAME}: 重置画布状态`
      },
      icon: new vscode.ThemeIcon('discard')
    },
    {
      id: 'status-canvas-surface',
      label: '画布状态',
      description: describeSurfaceState(state.surfaceLocation, state.canvasSurface),
      tooltip: `当前 ${EXTENSION_DISPLAY_NAME} 主画布在 VSCode ${humanizeSurfaceLocation(state.surfaceLocation)}中的状态。`,
      icon: new vscode.ThemeIcon('browser')
    },
    {
      id: 'status-default-surface',
      label: '默认承载面',
      description: humanizeSurfaceLocation(state.configuredSurface),
      tooltip: `${EXTENSION_DISPLAY_NAME}: 打开画布 命令会按这个宿主承载面打开主画布。`,
      icon: new vscode.ThemeIcon('layout-panel')
    },
    {
      id: 'status-node-count',
      label: '节点总数',
      description: String(state.nodeCount),
      tooltip: `当前 workspace 绑定的画布中共有 ${state.nodeCount} 个节点。`,
      icon: new vscode.ThemeIcon('symbol-number')
    },
    {
      id: 'status-execution-count',
      label: '运行中会话',
      description: String(state.runningExecutionCount),
      tooltip:
        state.runningExecutionCount > 0
          ? `当前有 ${state.runningExecutionCount} 个执行型节点处于运行中。`
          : '当前没有运行中的 Agent 或 Terminal 会话。',
      icon: new vscode.ThemeIcon('pulse')
    },
    {
      id: 'status-workspace-trust',
      label: 'Workspace 信任',
      description: state.workspaceTrusted ? '已信任' : '未信任',
      tooltip:
        state.workspaceTrusted
          ? '当前 workspace 已受信任，可创建和运行执行型对象。'
          : '当前 workspace 未受信任，Agent 和 Terminal 创建入口会降级隐藏。',
      icon: new vscode.ThemeIcon(state.workspaceTrusted ? 'verified' : 'warning')
    }
  ];
}

function humanizeCanvasSurface(surface: CanvasSidebarState['canvasSurface']): string {
  switch (surface) {
    case 'visible':
      return '已打开';
    case 'hidden':
      return '可定位';
    case 'closed':
      return '未打开';
  }
}

function describeSurfaceState(
  location: CanvasSidebarState['surfaceLocation'],
  surface: CanvasSidebarState['canvasSurface']
): string {
  return `${humanizeSurfaceLocation(location)} · ${humanizeCanvasSurface(surface)}`;
}

function humanizeSurfaceLocation(location: CanvasSidebarState['surfaceLocation']): string {
  return location === 'panel' ? '面板' : '编辑区';
}

function getOpenCanvasCommand(state: CanvasSidebarState): vscode.Command {
  if (state.canvasSurface === 'closed') {
    return {
      command: COMMAND_IDS.openCanvas,
      title: `${EXTENSION_DISPLAY_NAME}: 打开画布`
    };
  }

  if (state.surfaceLocation === 'panel') {
    return {
      command: COMMAND_IDS.openCanvasInPanel,
      title: `${EXTENSION_DISPLAY_NAME}: 在面板打开画布`
    };
  }

  return {
    command: COMMAND_IDS.openCanvasInEditor,
    title: `${EXTENSION_DISPLAY_NAME}: 在编辑区打开画布`
  };
}

function describeCreatableKinds(kinds: CanvasNodeKind[]): string {
  return kinds.map(humanizeNodeKind).join(' · ');
}

function humanizeNodeKind(kind: CanvasNodeKind): string {
  switch (kind) {
    case 'agent':
      return 'Agent';
    case 'terminal':
      return 'Terminal';
    case 'note':
      return 'Note';
  }
}
