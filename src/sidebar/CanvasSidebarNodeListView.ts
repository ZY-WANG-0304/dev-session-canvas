import * as vscode from 'vscode';

import { stripTerminalControlSequences } from '../common/agentActivityHeuristics';
import { colorForCanvasNodeKind } from '../common/canvasNodeVisuals';
import type { CanvasNodeKind, CanvasNodeMetadata, CanvasNodeSummary } from '../common/protocol';
import { getVersionedWebviewResourceUri } from '../common/webviewResourceUri';
import { CanvasPanelManager } from '../panel/CanvasPanelManager';

const SIDEBAR_NODE_DANGLING_CSI_FRAGMENT_PATTERN = /(?:^|\s)\[\?[0-9;:<>=$]*[ -/]*[@-~](?=\s|$)/g;
const SIDEBAR_NODE_ATTENTION_TOOLTIP = '该节点当前有待处理的通知提醒。';
const SIDEBAR_NODE_LIST_REFRESH_DEBOUNCE_MS = 75;
const SIDEBAR_BUNDLED_CODICON_PATH_SEGMENTS = ['dist', 'sidebar-codicon.css'] as const;

export interface CanvasSidebarNodeItemSnapshot {
  id: string;
  nodeId: string;
  nodeKind: CanvasNodeKind;
  label: string;
  description: string;
  tooltip: string;
  status: string;
  summary: string;
  markerColor: string;
  attentionPending: boolean;
}

export interface SidebarNodeListTestSnapshot {
  rowCount: number;
  visibleItemIds: string[];
  selectedId?: string;
  attentionItemIds: string[];
}

export type SidebarNodeListTestAction = {
  kind: 'clickItem';
  itemId: string;
  delayMs?: number;
};

type SidebarNodeListInboundMessage =
  | {
      type: 'sidebarNodeList/ready';
    }
  | {
      type: 'sidebarNodeList/focusNode';
      payload: {
        nodeId: string;
      };
    }
  | {
      type: 'sidebarNodeList/testActionResult';
      payload: {
        requestId: string;
        snapshot?: SidebarNodeListTestSnapshot;
        errorMessage?: string;
      };
    };

type SidebarNodeListOutboundMessage =
  | {
      type: 'sidebarNodeList/state';
      payload: {
        items: CanvasSidebarNodeItemSnapshot[];
      };
    }
  | {
      type: 'sidebarNodeList/testAction';
      payload: {
        requestId: string;
        action: SidebarNodeListTestAction;
      };
    };

interface PendingSidebarNodeListReadyRequest {
  resolve: () => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

interface PendingSidebarNodeListTestActionRequest {
  resolve: (snapshot: SidebarNodeListTestSnapshot) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export class CanvasSidebarNodeListView implements vscode.WebviewViewProvider, vscode.Disposable {
  private readonly stateSubscription: vscode.Disposable;
  private view: vscode.WebviewView | undefined;
  private items: CanvasSidebarNodeItemSnapshot[] = [];
  private isWebviewReady = false;
  private refreshTimer: NodeJS.Timeout | undefined;
  private readonly pendingReadyRequests = new Map<string, PendingSidebarNodeListReadyRequest>();
  private readonly pendingTestActionRequests = new Map<string, PendingSidebarNodeListTestActionRequest>();

  public constructor(
    private readonly panelManager: CanvasPanelManager,
    private readonly extensionUri: vscode.Uri
  ) {
    this.stateSubscription = this.panelManager.onDidChangeSidebarState(() => {
      this.scheduleRefresh();
    });
  }

  public dispose(): void {
    this.view = undefined;
    this.isWebviewReady = false;
    this.stateSubscription.dispose();
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }
    this.rejectPendingReadyRequests('侧栏节点列表视图已被释放。');
    this.rejectPendingTestActionRequests('侧栏节点列表视图已被释放。');
  }

  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    this.isWebviewReady = false;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist')]
    };
    webviewView.webview.html = buildSidebarNodeListHtml(webviewView.webview, this.extensionUri);

    webviewView.onDidDispose(() => {
      if (this.view === webviewView) {
        this.view = undefined;
        this.isWebviewReady = false;
        this.rejectPendingReadyRequests('侧栏节点列表视图已被关闭。');
        this.rejectPendingTestActionRequests('侧栏节点列表视图已被关闭。');
      }
    });

    webviewView.webview.onDidReceiveMessage((message) => {
      void this.handleMessage(message);
    });
  }

  public async waitForReady(timeoutMs = 5000): Promise<void> {
    if (this.view && this.isWebviewReady) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const requestId = createNonce();
      const timer = setTimeout(() => {
        this.pendingReadyRequests.delete(requestId);
        reject(new Error('等待侧栏节点列表视图就绪超时。'));
      }, timeoutMs);

      this.pendingReadyRequests.set(requestId, {
        resolve,
        reject,
        timer
      });
    });
  }

  public async performTestAction(action: SidebarNodeListTestAction, timeoutMs = 5000): Promise<SidebarNodeListTestSnapshot> {
    await this.waitForReady(timeoutMs);
    await this.refresh();

    const currentView = this.view;
    if (!currentView) {
      throw new Error('侧栏节点列表视图尚未创建。');
    }

    return new Promise<SidebarNodeListTestSnapshot>((resolve, reject) => {
      const requestId = createNonce();
      const timer = setTimeout(() => {
        this.pendingTestActionRequests.delete(requestId);
        reject(new Error('等待侧栏节点列表测试动作完成超时。'));
      }, timeoutMs);

      this.pendingTestActionRequests.set(requestId, {
        resolve,
        reject,
        timer
      });

      void currentView.webview
        .postMessage({
          type: 'sidebarNodeList/testAction',
          payload: {
            requestId,
            action
          }
        } satisfies SidebarNodeListOutboundMessage)
        .then(
          (posted) => {
            if (posted) {
              return;
            }

            const pendingRequest = this.pendingTestActionRequests.get(requestId);
            if (!pendingRequest) {
              return;
            }

            clearTimeout(pendingRequest.timer);
            this.pendingTestActionRequests.delete(requestId);
            pendingRequest.reject(new Error('无法将侧栏节点列表测试动作发送给 Webview。'));
          },
          (error: unknown) => {
            const pendingRequest = this.pendingTestActionRequests.get(requestId);
            if (!pendingRequest) {
              return;
            }

            clearTimeout(pendingRequest.timer);
            this.pendingTestActionRequests.delete(requestId);
            pendingRequest.reject(error instanceof Error ? error : new Error('侧栏节点列表测试动作发送失败。'));
          }
        );
    });
  }

  public async refresh(): Promise<CanvasSidebarNodeItemSnapshot[]> {
    this.items = getCanvasSidebarNodeListItems(this.panelManager.getCanvasNodes());
    await this.postState();
    return this.items;
  }

  private scheduleRefresh(): void {
    if (!this.view) {
      return;
    }

    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }

    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      void this.refresh();
    }, SIDEBAR_NODE_LIST_REFRESH_DEBOUNCE_MS);
  }

  private async postState(): Promise<void> {
    if (!this.view) {
      return;
    }

    await this.view.webview.postMessage({
      type: 'sidebarNodeList/state',
      payload: {
        items: this.items
      }
    } satisfies SidebarNodeListOutboundMessage);
  }

  private async handleMessage(message: unknown): Promise<void> {
    const parsed = parseSidebarNodeListMessage(message);
    if (!parsed) {
      return;
    }

    switch (parsed.type) {
      case 'sidebarNodeList/ready':
        this.isWebviewReady = true;
        this.resolvePendingReadyRequests();
        await this.refresh();
        return;
      case 'sidebarNodeList/focusNode': {
        const focused = await this.panelManager.focusNodeById(parsed.payload.nodeId);
        if (!focused) {
          await vscode.window.showWarningMessage('目标节点已不存在，或当前无法定位到画布中的该节点。');
        }
        return;
      }
      case 'sidebarNodeList/testActionResult':
        this.resolvePendingTestActionRequest(parsed.payload.requestId, parsed.payload.snapshot, parsed.payload.errorMessage);
        return;
    }
  }

  private resolvePendingReadyRequests(): void {
    for (const [requestId, pendingRequest] of this.pendingReadyRequests.entries()) {
      clearTimeout(pendingRequest.timer);
      this.pendingReadyRequests.delete(requestId);
      pendingRequest.resolve();
    }
  }

  private rejectPendingReadyRequests(message: string): void {
    for (const [requestId, pendingRequest] of this.pendingReadyRequests.entries()) {
      clearTimeout(pendingRequest.timer);
      this.pendingReadyRequests.delete(requestId);
      pendingRequest.reject(new Error(message));
    }
  }

  private resolvePendingTestActionRequest(
    requestId: string,
    snapshot: SidebarNodeListTestSnapshot | undefined,
    errorMessage?: string
  ): void {
    const pendingRequest = this.pendingTestActionRequests.get(requestId);
    if (!pendingRequest) {
      return;
    }

    clearTimeout(pendingRequest.timer);
    this.pendingTestActionRequests.delete(requestId);

    if (errorMessage) {
      pendingRequest.reject(new Error(errorMessage));
      return;
    }

    if (!snapshot) {
      pendingRequest.reject(new Error('侧栏节点列表测试动作没有返回快照。'));
      return;
    }

    pendingRequest.resolve(snapshot);
  }

  private rejectPendingTestActionRequests(message: string): void {
    for (const [requestId, pendingRequest] of this.pendingTestActionRequests.entries()) {
      clearTimeout(pendingRequest.timer);
      this.pendingTestActionRequests.delete(requestId);
      pendingRequest.reject(new Error(message));
    }
  }
}

export function getCanvasSidebarNodeListItems(nodes: CanvasNodeSummary[]): CanvasSidebarNodeItemSnapshot[] {
  return nodes
    .filter((node) => node.kind !== 'file' && node.kind !== 'file-list')
    .map((node) => {
      const label = node.title.trim() || fallbackNodeLabel(node.kind, node.id);
      const statusLabel = humanizeStatus(node.status);
      const summary = sanitizeSidebarNodeSummary(node.summary);
      const attentionPending = canvasNodeAttentionPending(node.metadata);
      const description = statusLabel;
      const tooltipLines = [label, `${humanizeNodeKind(node.kind)} · ${statusLabel}`];
      if (summary) {
        tooltipLines.push(summary);
      } else {
        tooltipLines.push('当前节点没有可显示的副标题。');
      }
      if (attentionPending) {
        tooltipLines.push(SIDEBAR_NODE_ATTENTION_TOOLTIP);
      }

      return {
        id: `node/${node.id}`,
        nodeId: node.id,
        nodeKind: node.kind,
        label,
        description,
        tooltip: tooltipLines.join('\n'),
        status: statusLabel,
        summary,
        markerColor: colorForCanvasNodeKind(node.kind),
        attentionPending
      } satisfies CanvasSidebarNodeItemSnapshot;
    });
}

function humanizeNodeKind(kind: CanvasNodeKind): string {
  switch (kind) {
    case 'agent':
      return 'Agent';
    case 'terminal':
      return 'Terminal';
    case 'note':
      return 'Note';
    case 'file':
      return 'File';
    case 'file-list':
      return 'File List';
  }
}

function fallbackNodeLabel(kind: CanvasNodeKind, nodeId: string): string {
  return `${humanizeNodeKind(kind)} · ${nodeId}`;
}

function humanizeStatus(status: string): string {
  switch (status) {
    case 'linked':
      return '已关联';
    case 'idle':
      return '空闲';
    case 'launching':
    case 'starting':
      return '启动中';
    case 'waiting-input':
      return '等待输入';
    case 'resuming':
      return '恢复中';
    case 'resume-ready':
      return '可恢复';
    case 'reattaching':
      return '重连中';
    case 'resume-failed':
      return '恢复失败';
    case 'stopping':
      return '停止中';
    case 'stopped':
      return '已停止';
    case 'running':
      return '运行中';
    case 'draft':
      return '草稿';
    case 'ready':
      return '就绪';
    case 'live':
      return '活动';
    case 'closed':
      return '已关闭';
    case 'error':
      return '失败';
    case 'cancelled':
      return '已停止';
    case 'interrupted':
      return '已中断';
    case 'history-restored':
      return '历史恢复';
    default:
      return status;
  }
}

function sanitizeSidebarNodeSummary(value: string): string {
  return stripTerminalControlSequences(value)
    .replace(SIDEBAR_NODE_DANGLING_CSI_FRAGMENT_PATTERN, ' ')
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseSidebarNodeListMessage(message: unknown): SidebarNodeListInboundMessage | null {
  if (!message || typeof message !== 'object' || !('type' in message) || typeof message.type !== 'string') {
    return null;
  }

  switch (message.type) {
    case 'sidebarNodeList/ready':
      return {
        type: 'sidebarNodeList/ready'
      };
    case 'sidebarNodeList/focusNode': {
      const payload = 'payload' in message ? message.payload : undefined;
      if (
        !payload ||
        typeof payload !== 'object' ||
        !('nodeId' in payload) ||
        typeof payload.nodeId !== 'string' ||
        payload.nodeId.trim().length === 0
      ) {
        return null;
      }

      return {
        type: 'sidebarNodeList/focusNode',
        payload: {
          nodeId: payload.nodeId
        }
      };
    }
    case 'sidebarNodeList/testActionResult': {
      const payload = 'payload' in message ? message.payload : undefined;
      if (
        !payload ||
        typeof payload !== 'object' ||
        !('requestId' in payload) ||
        typeof payload.requestId !== 'string'
      ) {
        return null;
      }

      const snapshot = parseSidebarNodeListTestSnapshot('snapshot' in payload ? payload.snapshot : undefined);
      const errorMessage = 'errorMessage' in payload && typeof payload.errorMessage === 'string' ? payload.errorMessage : undefined;
      if (!snapshot && !errorMessage) {
        return null;
      }

      return {
        type: 'sidebarNodeList/testActionResult',
        payload: {
          requestId: payload.requestId,
          snapshot: snapshot ?? undefined,
          errorMessage
        }
      };
    }
    default:
      return null;
  }
}

function parseSidebarNodeListTestSnapshot(value: unknown): SidebarNodeListTestSnapshot | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const rowCount = 'rowCount' in value && typeof value.rowCount === 'number' ? value.rowCount : null;
  const visibleItemIds =
    'visibleItemIds' in value && Array.isArray(value.visibleItemIds)
      ? value.visibleItemIds.filter((itemId): itemId is string => typeof itemId === 'string')
      : null;
  const selectedId = 'selectedId' in value && typeof value.selectedId === 'string' ? value.selectedId : undefined;
  const attentionItemIds =
    'attentionItemIds' in value && Array.isArray(value.attentionItemIds)
      ? value.attentionItemIds.filter((itemId): itemId is string => typeof itemId === 'string')
      : null;

  if (rowCount === null || visibleItemIds === null || attentionItemIds === null) {
    return null;
  }

  return {
    rowCount,
    visibleItemIds,
    selectedId,
    attentionItemIds
  };
}

export function isSidebarNodeListTestAction(value: unknown): value is SidebarNodeListTestAction {
  return (
    value !== null &&
    typeof value === 'object' &&
    'kind' in value &&
    value.kind === 'clickItem' &&
    'itemId' in value &&
    typeof value.itemId === 'string' &&
    (!('delayMs' in value) || typeof value.delayMs === 'number')
  );
}

function buildSidebarNodeListHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const nonce = createNonce();
  const codiconCssUri = getVersionedWebviewResourceUri(
    webview,
    extensionUri,
    ...SIDEBAR_BUNDLED_CODICON_PATH_SEGMENTS
  );

  return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="stylesheet" href="${codiconCssUri}" />
    <style>
      :root {
        color-scheme: light dark;
        --bg: var(--vscode-sideBar-background);
        --fg: var(--vscode-sideBar-foreground);
        --muted: var(--vscode-descriptionForeground);
        --focus: var(--vscode-focusBorder);
        --list-hover: var(--vscode-list-hoverBackground, color-mix(in srgb, var(--fg) 6%, transparent));
        --list-active: var(--vscode-list-activeSelectionBackground, color-mix(in srgb, var(--focus) 18%, transparent));
        --list-active-fg: var(--vscode-list-activeSelectionForeground, var(--fg));
        --attention: var(--vscode-notificationsInfoIcon-foreground, var(--focus));
        --border: color-mix(in srgb, var(--vscode-panel-border, var(--focus)) 72%, transparent);
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        padding: 4px 0 0;
        background: var(--bg);
        color: var(--fg);
        font-family: var(--vscode-font-family);
        font-size: 12px;
      }

      .list {
        display: grid;
      }

      .node-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: start;
        gap: 6px 10px;
        padding: 9px 12px;
        border: 0;
        border-left: 2px solid transparent;
        background: transparent;
        color: var(--fg);
        text-align: left;
        cursor: default;
      }

      .node-row:hover {
        background: var(--list-hover);
      }

      .node-row.is-selected,
      .node-row:focus-visible {
        background: var(--list-active);
        color: var(--list-active-fg);
        border-left-color: var(--focus);
        outline: none;
      }

      .node-main {
        min-width: 0;
        display: grid;
        gap: 4px;
      }

      .node-title-line {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
      }

      .node-marker {
        flex: 0 0 auto;
        width: 14px;
        height: 14px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 13px;
        line-height: 1;
      }

      .node-title,
      .node-status {
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
      }

      .node-title {
        min-width: 0;
        font-size: 12px;
      }

      .node-status {
        color: var(--muted);
        font-size: 11px;
        padding-left: 22px;
      }

      .node-attention {
        flex: 0 0 auto;
        width: 16px;
        height: 16px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        color: var(--attention);
        font-size: 14px;
        line-height: 1;
        margin-top: 1px;
      }

      .empty-state {
        padding: 8px 12px 12px;
        color: var(--muted);
        border-top: 1px solid var(--border);
        display: none;
      }

      .empty-state.is-visible {
        display: block;
      }
    </style>
  </head>
  <body>
    <div id="list" class="list" role="listbox" aria-label="当前画布节点列表"></div>
    <div id="emptyState" class="empty-state" role="status" aria-live="polite"></div>
    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      const state = {
        items: [],
        selectedId: undefined
      };

      const list = document.getElementById('list');
      const emptyState = document.getElementById('emptyState');

      function syncRenderedSelection() {
        const rows = list.querySelectorAll('[data-sidebar-node-item-id]');
        for (const row of rows) {
          const isSelected = row.getAttribute('data-sidebar-node-item-id') === state.selectedId;
          row.setAttribute('aria-selected', isSelected ? 'true' : 'false');
          row.classList.toggle('is-selected', isSelected);
        }
      }

      function setSelectedId(nextId) {
        if (state.selectedId === nextId) {
          syncRenderedSelection();
          return;
        }
        state.selectedId = nextId;
        syncRenderedSelection();
      }

      function focusNode(item) {
        vscode.postMessage({
          type: 'sidebarNodeList/focusNode',
          payload: {
            nodeId: item.nodeId
          }
        });
      }

      function captureTestSnapshot() {
        return {
          rowCount: list.querySelectorAll('[data-sidebar-node-item-id]').length,
          visibleItemIds: state.items.map((item) => item.id),
          selectedId: state.selectedId,
          attentionItemIds: state.items.filter((item) => item.attentionPending).map((item) => item.id)
        };
      }

      function dispatchSyntheticMouseClick(target) {
        target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, buttons: 1 }));
        target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, buttons: 0 }));
        target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, detail: 1 }));
      }

      async function waitForDomActionFlush() {
        await Promise.resolve();
        await new Promise((resolve) => requestAnimationFrame(() => resolve()));
        await Promise.resolve();
      }

      function queryRowByItemId(itemId) {
        return list.querySelector('[data-sidebar-node-item-id="' + CSS.escape(itemId) + '"]');
      }

      async function performTestAction(action) {
        if (!action || action.kind !== 'clickItem' || typeof action.itemId !== 'string') {
          throw new Error('Unsupported sidebar node list test action.');
        }

        if (typeof action.delayMs === 'number' && action.delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, action.delayMs));
        }

        const row = queryRowByItemId(action.itemId);
        if (!row) {
          throw new Error('Target sidebar node row is not visible.');
        }

        row.focus();
        row.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
        dispatchSyntheticMouseClick(row);
        await waitForDomActionFlush();

        return captureTestSnapshot();
      }

      function render() {
        if (!state.selectedId || !state.items.some((item) => item.id === state.selectedId)) {
          state.selectedId = state.items[0] ? state.items[0].id : undefined;
        }

        list.replaceChildren();
        for (const item of state.items) {
          const row = document.createElement('div');
          row.className = 'node-row';
          row.tabIndex = 0;
          row.title = item.tooltip;
          row.setAttribute('data-sidebar-node-item-id', item.id);
          row.setAttribute('data-sidebar-node-id', item.nodeId);
          row.setAttribute('data-attention-pending', item.attentionPending ? 'true' : 'false');
          row.setAttribute('role', 'option');
          row.setAttribute('aria-selected', item.id === state.selectedId ? 'true' : 'false');
          row.setAttribute(
            'aria-label',
            item.label + '，' + item.status + (item.attentionPending ? '，当前有通知提醒' : '')
          );
          if (item.id === state.selectedId) {
            row.classList.add('is-selected');
          }

          row.addEventListener('click', () => {
            setSelectedId(item.id);
            focusNode(item);
          });
          row.addEventListener('focus', () => {
            setSelectedId(item.id);
          });
          row.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              setSelectedId(item.id);
              focusNode(item);
            }
          });

          const main = document.createElement('div');
          main.className = 'node-main';

          const titleLine = document.createElement('div');
          titleLine.className = 'node-title-line';

          const marker = document.createElement('span');
          marker.className = 'node-marker codicon codicon-circle-filled';
          marker.setAttribute('aria-hidden', 'true');
          marker.style.color = item.markerColor;

          const title = document.createElement('div');
          title.className = 'node-title';
          title.textContent = item.label;

          titleLine.append(marker, title);
          main.append(titleLine);

          const status = document.createElement('div');
          status.className = 'node-status';
          status.textContent = item.status;
          main.append(status);

          row.append(main);

          if (item.attentionPending) {
            const attention = document.createElement('span');
            attention.className = 'node-attention codicon codicon-bell';
            attention.setAttribute('aria-hidden', 'true');
            attention.title = '未确认终端提醒';
            row.append(attention);
          }

          list.append(row);
        }

        if (state.items.length === 0) {
          emptyState.textContent = '当前画布还没有可定位的非文件节点。';
          emptyState.classList.add('is-visible');
          return;
        }

        emptyState.textContent = '';
        emptyState.classList.remove('is-visible');
      }

      window.addEventListener('message', (event) => {
        const message = event.data;
        if (!message || typeof message.type !== 'string') {
          return;
        }

        if (message.type === 'sidebarNodeList/testAction' && message.payload) {
          void performTestAction(message.payload.action)
            .then((snapshot) => {
              vscode.postMessage({
                type: 'sidebarNodeList/testActionResult',
                payload: {
                  requestId: message.payload.requestId,
                  snapshot
                }
              });
            })
            .catch((error) => {
              vscode.postMessage({
                type: 'sidebarNodeList/testActionResult',
                payload: {
                  requestId: message.payload.requestId,
                  errorMessage: error instanceof Error ? error.message : 'Sidebar node list test action failed.'
                }
              });
            });
          return;
        }

        if (message.type !== 'sidebarNodeList/state' || !message.payload) {
          return;
        }

        state.items = Array.isArray(message.payload.items) ? message.payload.items : [];
        render();
      });

      vscode.postMessage({ type: 'sidebarNodeList/ready' });
    </script>
  </body>
</html>`;
}

function createNonce(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let value = '';
  for (let index = 0; index < 32; index += 1) {
    value += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return value;
}

function canvasNodeAttentionPending(metadata: CanvasNodeMetadata | undefined): boolean {
  return metadata?.agent?.attentionPending === true || metadata?.terminal?.attentionPending === true;
}
