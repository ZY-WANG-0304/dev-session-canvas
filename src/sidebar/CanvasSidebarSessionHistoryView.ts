import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

import { listWorkspaceAgentSessionHistory, type WorkspaceAgentSessionHistoryEntry } from '../common/agentSessionHistory';
import type { AgentProviderKind } from '../common/protocol';
import { isAgentProviderKind } from '../common/protocol';
import { CanvasPanelManager } from '../panel/CanvasPanelManager';

const SESSION_REFRESH_DEBOUNCE_MS = 350;
const SIDEBAR_SESSION_ICON_ROOT = path.resolve(__dirname, '..', 'images');
const FALLBACK_CLAUDE_PROVIDER_ICON_SVG =
  '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="8" cy="8" r="6" fill="currentColor" fill-opacity="0.18"/><path d="M6.25 5.25L3.75 8L6.25 10.75" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M9.75 5.25L12.25 8L9.75 10.75" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const FALLBACK_CODEX_PROVIDER_ICON_SVG =
  '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="8" cy="8" r="6" fill="currentColor" fill-opacity="0.18"/><path d="M8 4.25L10.85 5.9V10.1L8 11.75L5.15 10.1V5.9L8 4.25Z" stroke="currentColor" stroke-width="1.35" stroke-linejoin="round"/><circle cx="8" cy="8" r="1.45" fill="currentColor"/></svg>';
const SIDEBAR_SESSION_PROVIDER_ICON_SVGS = {
  claude: readBundledProviderIconSvg('provider-claude-code-anthropic.svg', FALLBACK_CLAUDE_PROVIDER_ICON_SVG),
  codex: readBundledProviderIconSvg('provider-codex-openai.svg', FALLBACK_CODEX_PROVIDER_ICON_SVG)
} satisfies Record<AgentProviderKind, string>;

export interface CanvasSidebarSessionHistoryItemSnapshot {
  id: string;
  provider: AgentProviderKind;
  providerLabel: string;
  sessionId: string;
  title: string;
  timestampLabel: string;
  tooltip: string;
  searchText: string;
}

export interface SidebarSessionHistoryTestSnapshot {
  rowCount: number;
  visibleItemIds: string[];
  selectedId?: string;
  disabledItemIds: string[];
  statusNoteText?: string;
}

export type SidebarSessionHistoryTestAction =
  | {
      kind: 'doubleClickItem';
      itemId: string;
      delayMs?: number;
    }
  | {
      kind: 'filterItems';
      query: string;
      delayMs?: number;
    };

type SidebarSessionHistoryInboundMessage =
  | {
      type: 'sidebarSessionHistory/ready';
    }
  | {
      type: 'sidebarSessionHistory/openSession';
      payload: {
        provider: AgentProviderKind;
        sessionId: string;
        title?: string;
      };
    }
  | {
      type: 'sidebarSessionHistory/testActionResult';
      payload: {
        requestId: string;
        snapshot?: SidebarSessionHistoryTestSnapshot;
        errorMessage?: string;
      };
    };

type SidebarSessionHistoryOutboundMessage =
  | {
      type: 'sidebarSessionHistory/state';
      payload: {
        items: CanvasSidebarSessionHistoryItemSnapshot[];
        errorMessage?: string;
        actionErrorMessage?: string;
        restoreBlockedMessage?: string;
      };
    }
  | {
      type: 'sidebarSessionHistory/testAction';
      payload: {
        requestId: string;
        action: SidebarSessionHistoryTestAction;
      };
    };

interface PendingSidebarSessionHistoryReadyRequest {
  resolve: () => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

interface PendingSidebarSessionHistoryTestActionRequest {
  resolve: (snapshot: SidebarSessionHistoryTestSnapshot) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export class CanvasSidebarSessionHistoryView implements vscode.WebviewViewProvider, vscode.Disposable {
  private readonly trustSubscription: vscode.Disposable;
  private view: vscode.WebviewView | undefined;
  private items: CanvasSidebarSessionHistoryItemSnapshot[] = [];
  private errorMessage: string | undefined;
  private actionErrorMessage: string | undefined;
  private refreshTimer: NodeJS.Timeout | undefined;
  private isWebviewReady = false;
  private refreshSequence: Promise<CanvasSidebarSessionHistoryItemSnapshot[]> = Promise.resolve([]);
  private readonly pendingReadyRequests = new Map<string, PendingSidebarSessionHistoryReadyRequest>();
  private readonly pendingTestActionRequests = new Map<string, PendingSidebarSessionHistoryTestActionRequest>();

  public constructor(private readonly panelManager: CanvasPanelManager) {
    this.trustSubscription = vscode.workspace.onDidGrantWorkspaceTrust(() => {
      this.actionErrorMessage = undefined;
      void this.postState();
    });
  }

  public dispose(): void {
    this.view = undefined;
    this.isWebviewReady = false;
    this.trustSubscription.dispose();
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }
    this.rejectPendingReadyRequests('侧栏会话历史视图已被释放。');
    this.rejectPendingTestActionRequests('侧栏会话历史视图已被释放。');
  }

  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    this.isWebviewReady = false;
    webviewView.webview.options = {
      enableScripts: true
    };
    webviewView.webview.html = buildSidebarSessionHistoryHtml(webviewView.webview);

    webviewView.onDidDispose(() => {
      if (this.view === webviewView) {
        this.view = undefined;
        this.isWebviewReady = false;
        this.rejectPendingReadyRequests('侧栏会话历史视图已被关闭。');
        this.rejectPendingTestActionRequests('侧栏会话历史视图已被关闭。');
      }
    });
    webviewView.onDidChangeVisibility(() => {
      if (!webviewView.visible) {
        return;
      }

      this.scheduleRefresh();
    });

    webviewView.webview.onDidReceiveMessage((message) => {
      void this.handleMessage(message);
    });
  }

  public async refresh(options?: { homeDir?: string }): Promise<CanvasSidebarSessionHistoryItemSnapshot[]> {
    const runRefresh = async (): Promise<CanvasSidebarSessionHistoryItemSnapshot[]> => {
      try {
        this.items = await this.loadSessionHistoryItems(options);
        this.errorMessage = undefined;
      } catch (error) {
        this.items = [];
        this.errorMessage = error instanceof Error ? error.message : '无法读取当前 workspace 的会话历史。';
      }

      this.actionErrorMessage = undefined;
      await this.postState();
      return this.items;
    };

    const queuedRefresh = this.refreshSequence.catch(() => this.items).then(runRefresh);
    this.refreshSequence = queuedRefresh.catch(() => this.items);
    return queuedRefresh;
  }

  public async getSessionHistoryItems(options?: { homeDir?: string }): Promise<CanvasSidebarSessionHistoryItemSnapshot[]> {
    return this.refresh(options);
  }

  public async waitForReady(timeoutMs = 5000): Promise<void> {
    if (this.view && this.isWebviewReady) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const requestId = createNonce();
      const timer = setTimeout(() => {
        this.pendingReadyRequests.delete(requestId);
        reject(new Error('等待侧栏会话历史视图就绪超时。'));
      }, timeoutMs);

      this.pendingReadyRequests.set(requestId, {
        resolve,
        reject,
        timer
      });
    });
  }

  public async performTestAction(
    action: SidebarSessionHistoryTestAction,
    timeoutMs = 5000
  ): Promise<SidebarSessionHistoryTestSnapshot> {
    await this.waitForReady(timeoutMs);
    await this.refresh();

    const currentView = this.view;
    if (!currentView) {
      throw new Error('侧栏会话历史视图尚未创建。');
    }

    return new Promise<SidebarSessionHistoryTestSnapshot>((resolve, reject) => {
      const requestId = createNonce();
      const timer = setTimeout(() => {
        this.pendingTestActionRequests.delete(requestId);
        reject(new Error('等待侧栏会话历史测试动作完成超时。'));
      }, timeoutMs);

      this.pendingTestActionRequests.set(requestId, {
        resolve,
        reject,
        timer
      });

      void currentView.webview
        .postMessage({
          type: 'sidebarSessionHistory/testAction',
          payload: {
            requestId,
            action
          }
        } satisfies SidebarSessionHistoryOutboundMessage)
        .then((posted) => {
          if (posted) {
            return;
          }

          const pendingRequest = this.pendingTestActionRequests.get(requestId);
          if (!pendingRequest) {
            return;
          }

          clearTimeout(pendingRequest.timer);
          this.pendingTestActionRequests.delete(requestId);
          pendingRequest.reject(new Error('无法将侧栏会话历史测试动作发送给 Webview。'));
        }, (error: unknown) => {
          const pendingRequest = this.pendingTestActionRequests.get(requestId);
          if (!pendingRequest) {
            return;
          }

          clearTimeout(pendingRequest.timer);
          this.pendingTestActionRequests.delete(requestId);
          pendingRequest.reject(error instanceof Error ? error : new Error('侧栏会话历史测试动作发送失败。'));
        });
    });
  }

  private scheduleRefresh(): void {
    if (!this.view?.visible) {
      return;
    }

    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }

    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      void this.refresh();
    }, SESSION_REFRESH_DEBOUNCE_MS);
  }

  private async loadSessionHistoryItems(options?: { homeDir?: string }): Promise<CanvasSidebarSessionHistoryItemSnapshot[]> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      return [];
    }

    const env =
      typeof options?.homeDir === 'string' && options.homeDir.trim().length > 0
        ? {
            ...process.env,
            HOME: options.homeDir,
            USERPROFILE: options.homeDir
          }
        : process.env;

    const sessionHistory = await listWorkspaceAgentSessionHistory({
      workspaceRoot,
      env,
      maxEntries: 200
    });
    return buildCanvasSidebarSessionHistoryItems(sessionHistory, workspaceRoot);
  }

  private async postState(): Promise<void> {
    if (!this.view) {
      return;
    }

    const message: SidebarSessionHistoryOutboundMessage = {
      type: 'sidebarSessionHistory/state',
      payload: {
        items: this.items,
        errorMessage: this.errorMessage,
        actionErrorMessage: this.actionErrorMessage,
        restoreBlockedMessage: this.panelManager.getSessionHistoryRestoreBlockReason()
      }
    };
    await this.view.webview.postMessage(message);
  }

  private async handleMessage(message: unknown): Promise<void> {
    const parsed = parseSidebarSessionHistoryMessage(message);
    if (!parsed) {
      return;
    }

    switch (parsed.type) {
      case 'sidebarSessionHistory/ready':
        this.isWebviewReady = true;
        this.resolvePendingReadyRequests();
        await this.refresh();
        return;
      case 'sidebarSessionHistory/openSession': {
        const result = await this.panelManager.restoreAgentSessionFromHistory({
          provider: parsed.payload.provider,
          sessionId: parsed.payload.sessionId,
          title: parsed.payload.title
        });
        if (!result.restored && result.errorMessage) {
          this.actionErrorMessage = result.errorMessage;
          await this.postState();
        }
        return;
      }
      case 'sidebarSessionHistory/testActionResult':
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
    snapshot: SidebarSessionHistoryTestSnapshot | undefined,
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
      pendingRequest.reject(new Error('侧栏会话历史测试动作没有返回快照。'));
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

export function buildCanvasSidebarSessionHistoryItems(
  entries: WorkspaceAgentSessionHistoryEntry[],
  workspaceRoot: string
): CanvasSidebarSessionHistoryItemSnapshot[] {
  return entries.map((entry) => {
    const relativeCwd = resolveWorkspaceRelativeCwd(entry.cwd, workspaceRoot);
    const title = formatSessionHistoryTitle(entry);
    const timestampLabel = [
      providerLabel(entry.provider),
      formatRelativeTimestamp(entry.updatedAtMs).replace(/\s+/g, ''),
      entry.sessionId
    ].join(' · ');

    return {
      id: `${entry.provider}:${entry.sessionId}`,
      provider: entry.provider,
      providerLabel: providerLabel(entry.provider),
      sessionId: entry.sessionId,
      title,
      timestampLabel,
      tooltip: [
        title,
        `${providerLabel(entry.provider)} · ${entry.sessionId}`,
        `目录：${relativeCwd}`,
        `创建：${formatTimestamp(entry.createdAtMs)}`,
        `更新：${formatTimestamp(entry.updatedAtMs)}`
      ]
        .filter((line): line is string => typeof line === 'string' && line.length > 0)
        .join('\n'),
      searchText: [
        title,
        providerLabel(entry.provider),
        entry.provider,
        entry.sessionId,
        relativeCwd,
        entry.cwd
      ]
        .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
        .join(' ')
        .toLowerCase()
    } satisfies CanvasSidebarSessionHistoryItemSnapshot;
  });
}

function resolveWorkspaceRelativeCwd(cwd: string, workspaceRoot: string): string {
  const relativePath = path.relative(path.resolve(workspaceRoot), path.resolve(cwd));
  if (!relativePath || relativePath === '.') {
    return '工作区根目录';
  }

  return relativePath.startsWith('..') || path.isAbsolute(relativePath) ? cwd : relativePath.replace(/\\/g, '/');
}

const MAX_SESSION_HISTORY_TITLE_CHARS = 256;

function shortSessionId(sessionId: string): string {
  return sessionId.length <= 12 ? sessionId : sessionId.slice(0, 12);
}

function formatSessionHistoryTitle(entry: WorkspaceAgentSessionHistoryEntry): string {
  const instruction = entry.firstUserInstruction?.trim();
  if (!instruction) {
    return `${providerLabel(entry.provider)} · ${shortSessionId(entry.sessionId)}`;
  }

  const firstLine = instruction.split('\n').find((line) => line.trim().length > 0)?.trim() ?? '';
  if (!firstLine) {
    return `${providerLabel(entry.provider)} · ${shortSessionId(entry.sessionId)}`;
  }

  const normalizedLine = firstLine.replace(/\s+/g, ' ').trim();
  if (normalizedLine.length <= MAX_SESSION_HISTORY_TITLE_CHARS) {
    return normalizedLine;
  }

  return `${normalizedLine.slice(0, MAX_SESSION_HISTORY_TITLE_CHARS - 1).trimEnd()}…`;
}

function providerLabel(provider: AgentProviderKind): string {
  return provider === 'claude' ? 'Claude Code' : 'Codex';
}

function formatTimestamp(timestampMs: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date(timestampMs));
}

function formatRelativeTimestamp(timestampMs: number): string {
  const elapsedMs = Date.now() - timestampMs;
  if (elapsedMs <= 0) {
    return '刚刚';
  }

  const minuteMs = 60 * 1000;
  const hourMs = 60 * minuteMs;
  const dayMs = 24 * hourMs;

  if (elapsedMs < minuteMs) {
    return '刚刚';
  }
  if (elapsedMs < hourMs) {
    return `${Math.max(1, Math.floor(elapsedMs / minuteMs))} 分钟前`;
  }
  if (elapsedMs < dayMs) {
    return `${Math.max(1, Math.floor(elapsedMs / hourMs))} 小时前`;
  }

  return `${Math.max(1, Math.floor(elapsedMs / dayMs))} 天前`;
}

function parseSidebarSessionHistoryMessage(message: unknown): SidebarSessionHistoryInboundMessage | null {
  if (!message || typeof message !== 'object' || !('type' in message) || typeof message.type !== 'string') {
    return null;
  }

  switch (message.type) {
    case 'sidebarSessionHistory/ready':
      return {
        type: 'sidebarSessionHistory/ready'
      };
    case 'sidebarSessionHistory/openSession': {
      const payload = 'payload' in message ? message.payload : undefined;
      if (
        !payload ||
        typeof payload !== 'object' ||
        !('provider' in payload) ||
        !isAgentProviderKind(payload.provider) ||
        !('sessionId' in payload) ||
        typeof payload.sessionId !== 'string'
      ) {
        return null;
      }

      return {
        type: 'sidebarSessionHistory/openSession',
        payload: {
          provider: payload.provider,
          sessionId: payload.sessionId,
          title: 'title' in payload && typeof payload.title === 'string' ? payload.title : undefined
        }
      };
    }
    case 'sidebarSessionHistory/testActionResult': {
      const payload = 'payload' in message ? message.payload : undefined;
      if (
        !payload ||
        typeof payload !== 'object' ||
        !('requestId' in payload) ||
        typeof payload.requestId !== 'string'
      ) {
        return null;
      }

      const snapshot = parseSidebarSessionHistoryTestSnapshot('snapshot' in payload ? payload.snapshot : undefined);
      const errorMessage = 'errorMessage' in payload && typeof payload.errorMessage === 'string' ? payload.errorMessage : undefined;
      if (!snapshot && !errorMessage) {
        return null;
      }

      return {
        type: 'sidebarSessionHistory/testActionResult',
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

function parseSidebarSessionHistoryTestSnapshot(value: unknown): SidebarSessionHistoryTestSnapshot | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const rowCount = 'rowCount' in value && typeof value.rowCount === 'number' ? value.rowCount : null;
  const visibleItemIds =
    'visibleItemIds' in value && Array.isArray(value.visibleItemIds)
      ? value.visibleItemIds.filter((itemId): itemId is string => typeof itemId === 'string')
      : null;
  const selectedId = 'selectedId' in value && typeof value.selectedId === 'string' ? value.selectedId : undefined;
  const disabledItemIds =
    'disabledItemIds' in value && Array.isArray(value.disabledItemIds)
      ? value.disabledItemIds.filter((itemId): itemId is string => typeof itemId === 'string')
      : null;
  const statusNoteText = 'statusNoteText' in value && typeof value.statusNoteText === 'string' ? value.statusNoteText : undefined;

  if (rowCount === null || visibleItemIds === null || disabledItemIds === null) {
    return null;
  }

  return {
    rowCount,
    visibleItemIds,
    selectedId,
    disabledItemIds,
    statusNoteText
  };
}

export function isSidebarSessionHistoryTestAction(value: unknown): value is SidebarSessionHistoryTestAction {
  return (
    value !== null &&
    typeof value === 'object' &&
    'kind' in value &&
    (
      (value.kind === 'doubleClickItem' && 'itemId' in value && typeof value.itemId === 'string') ||
      (value.kind === 'filterItems' && 'query' in value && typeof value.query === 'string')
    ) &&
    (!('delayMs' in value) || typeof value.delayMs === 'number')
  );
}

function buildSidebarSessionHistoryHtml(webview: vscode.Webview): string {
  const nonce = createNonce();
  const providerIconsJson = JSON.stringify(SIDEBAR_SESSION_PROVIDER_ICON_SVGS);

  return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>
      :root {
        color-scheme: light dark;
        --bg: var(--vscode-sideBar-background);
        --fg: var(--vscode-sideBar-foreground);
        --muted: var(--vscode-descriptionForeground);
        --input-bg: var(--vscode-input-background);
        --input-fg: var(--vscode-input-foreground);
        --input-border: var(--vscode-input-border, transparent);
        --focus: var(--vscode-focusBorder);
        --list-hover: var(--vscode-list-hoverBackground, color-mix(in srgb, var(--fg) 6%, transparent));
        --list-active: var(--vscode-list-activeSelectionBackground, color-mix(in srgb, var(--focus) 18%, transparent));
        --list-active-fg: var(--vscode-list-activeSelectionForeground, var(--fg));
        --badge-bg: color-mix(in srgb, var(--focus) 18%, transparent);
        --badge-fg: var(--vscode-list-highlightForeground, var(--fg));
        --border: color-mix(in srgb, var(--vscode-panel-border, var(--focus)) 72%, transparent);
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        padding: 8px 0 0;
        background: var(--bg);
        color: var(--fg);
        font-family: var(--vscode-font-family);
        font-size: 12px;
      }

      input,
      button {
        font: inherit;
      }

      .shell {
        display: grid;
        gap: 8px;
      }

      .toolbar {
        padding: 0 12px;
      }

      .input-wrap {
        position: relative;
      }

      .search-input {
        width: 100%;
        min-height: 28px;
        padding: 0 28px 0 8px;
        border: 1px solid var(--input-border);
        background: var(--input-bg);
        color: var(--input-fg);
        border-radius: 2px;
      }

      .search-input::placeholder {
        color: var(--vscode-input-placeholderForeground, var(--muted));
      }

      .search-clear {
        position: absolute;
        top: 50%;
        right: 4px;
        transform: translateY(-50%);
        width: 20px;
        height: 20px;
        border: none;
        border-radius: 2px;
        background: transparent;
        color: var(--muted);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .search-clear:hover {
        background: color-mix(
          in srgb,
          var(--vscode-button-secondaryHoverBackground, var(--vscode-button-hoverBackground)) 50%,
          transparent
        );
        color: var(--fg);
      }

      .search-clear[hidden] {
        display: none;
      }

      .search-input:focus-visible,
      .search-clear:focus-visible {
        outline: 1px solid var(--focus);
        outline-offset: 0;
      }

      .list {
        display: grid;
      }

      .status-note {
        margin: 0 12px;
        padding: 8px 10px;
        color: var(--muted);
        background: color-mix(in srgb, var(--focus) 10%, transparent);
        border: 1px solid var(--border);
        border-radius: 4px;
        line-height: 1.45;
        display: none;
      }

      .status-note.is-visible {
        display: block;
      }

      .session-row {
        display: grid;
        gap: 6px;
        padding: 9px 12px;
        border: 0;
        border-left: 2px solid transparent;
        background: transparent;
        color: var(--fg);
        text-align: left;
        cursor: default;
      }

      .session-row:hover {
        background: var(--list-hover);
      }

      .session-row.is-disabled {
        cursor: not-allowed;
        opacity: 0.68;
      }

      .session-row.is-disabled:hover {
        background: transparent;
      }

      .session-row.is-selected,
      .session-row:focus-visible {
        background: var(--list-active);
        color: var(--list-active-fg);
        border-left-color: var(--focus);
        outline: none;
      }

      .session-row.is-disabled.is-selected,
      .session-row.is-disabled:focus-visible {
        background: transparent;
        border-left-color: transparent;
      }

      .session-title-line {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
      }

      .provider-icon {
        flex: 0 0 auto;
        width: 14px;
        height: 14px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }

      .provider-icon svg {
        display: block;
        width: 14px;
        height: 14px;
      }

      .session-title,
      .session-time {
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
      }

      .session-title {
        font-size: 12px;
        min-width: 0;
      }

      .session-time {
        color: var(--muted);
        font-size: 11px;
        padding-left: 22px;
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
    <div class="shell">
      <div class="toolbar">
        <div class="input-wrap">
          <input
            id="searchInput"
            class="search-input"
            type="text"
            spellcheck="false"
            placeholder="搜索标题、Session ID 或 provider"
          />
          <button id="searchClearButton" class="search-clear" type="button" aria-label="清空会话搜索" hidden>&times;</button>
        </div>
      </div>
      <div id="statusNote" class="status-note" role="status" aria-live="polite"></div>
      <div id="list" class="list" role="listbox" aria-label="当前 workspace 会话历史"></div>
      <div id="emptyState" class="empty-state" role="status" aria-live="polite"></div>
    </div>
    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      const providerIcons = ${providerIconsJson};
      const state = {
        items: [],
        selectedId: undefined,
        query: '',
        errorMessage: undefined,
        actionErrorMessage: undefined,
        restoreBlockedMessage: undefined
      };

      const searchInput = document.getElementById('searchInput');
      const searchClearButton = document.getElementById('searchClearButton');
      const statusNote = document.getElementById('statusNote');
      const list = document.getElementById('list');
      const emptyState = document.getElementById('emptyState');

      function setSearchQuery(nextQuery) {
        state.query = typeof nextQuery === 'string' ? nextQuery : '';
        searchInput.value = state.query;
        searchClearButton.hidden = state.query.trim().length === 0;
      }

      function getVisibleItems() {
        const normalizedQuery = state.query.trim().toLowerCase();
        if (!normalizedQuery) {
          return state.items;
        }
        return state.items.filter((item) => item.searchText.includes(normalizedQuery));
      }

      function syncRenderedSelection() {
        const rows = list.querySelectorAll('[data-session-history-item-id]');
        for (const row of rows) {
          const isSelected = row.getAttribute('data-session-history-item-id') === state.selectedId;
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

      function openItem(item) {
        if (state.restoreBlockedMessage) {
          return;
        }

        vscode.postMessage({
          type: 'sidebarSessionHistory/openSession',
          payload: {
            provider: item.provider,
            sessionId: item.sessionId,
            title: item.title
          }
        });
      }

      function captureTestSnapshot() {
        return {
          rowCount: list.querySelectorAll('[data-session-history-item-id]').length,
          visibleItemIds: getVisibleItems().map((item) => item.id),
          selectedId: state.selectedId,
          disabledItemIds: Array.from(list.querySelectorAll('.session-row.is-disabled'))
            .map((row) => row.getAttribute('data-session-history-item-id'))
            .filter((itemId) => typeof itemId === 'string'),
          statusNoteText: statusNote.textContent || undefined
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
        return list.querySelector('[data-session-history-item-id="' + CSS.escape(itemId) + '"]');
      }

      async function performTestAction(action) {
        if (!action || typeof action.kind !== 'string') {
          throw new Error('Unsupported sidebar session history test action.');
        }

        if (typeof action.delayMs === 'number' && action.delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, action.delayMs));
        }

        if (action.kind === 'filterItems') {
          if (typeof action.query !== 'string') {
            throw new Error('Sidebar session history filter action requires a string query.');
          }

          setSearchQuery(action.query);
          render();
          await waitForDomActionFlush();
          return captureTestSnapshot();
        }

        if (action.kind !== 'doubleClickItem' || typeof action.itemId !== 'string') {
          throw new Error('Unsupported sidebar session history test action.');
        }

        const row = queryRowByItemId(action.itemId);
        if (!row) {
          throw new Error('Target session history row is not visible.');
        }

        row.focus();
        row.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
        dispatchSyntheticMouseClick(row);
        await waitForDomActionFlush();

        if (!row.isConnected) {
          throw new Error('Session history row was replaced after the first click, so dblclick cannot succeed.');
        }

        dispatchSyntheticMouseClick(row);
        row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, button: 0, detail: 2 }));
        await waitForDomActionFlush();

        return captureTestSnapshot();
      }

      function render() {
        const visibleItems = getVisibleItems();
        const interactionBlocked = typeof state.restoreBlockedMessage === 'string' && state.restoreBlockedMessage.length > 0;
        if (!state.selectedId || !visibleItems.some((item) => item.id === state.selectedId)) {
          state.selectedId = visibleItems[0] ? visibleItems[0].id : undefined;
        }

        list.replaceChildren();
        for (const item of visibleItems) {
          const row = document.createElement('div');
          row.className = 'session-row';
          row.tabIndex = 0;
          row.title = item.tooltip;
          row.setAttribute('data-session-history-item-id', item.id);
          row.setAttribute('role', 'option');
          row.setAttribute('aria-selected', item.id === state.selectedId ? 'true' : 'false');
          row.setAttribute('aria-label', item.providerLabel + '，' + item.title + '，' + item.timestampLabel);
          if (interactionBlocked) {
            row.setAttribute('aria-disabled', 'true');
            row.classList.add('is-disabled');
          }
          if (item.id === state.selectedId) {
            row.classList.add('is-selected');
          }

          row.addEventListener('click', () => {
            setSelectedId(item.id);
          });
          row.addEventListener('focus', () => {
            setSelectedId(item.id);
          });
          row.addEventListener('dblclick', () => {
            // Keep the row DOM stable across the first click so the browser can emit dblclick.
            openItem(item);
          });
          row.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              openItem(item);
            }
          });

          const titleLine = document.createElement('div');
          titleLine.className = 'session-title-line';

          const providerIcon = document.createElement('span');
          providerIcon.className = 'provider-icon';
          providerIcon.setAttribute('aria-hidden', 'true');
          providerIcon.innerHTML = renderProviderIcon(item.provider);

          const title = document.createElement('div');
          title.className = 'session-title';
          title.textContent = item.title;

          titleLine.append(providerIcon, title);

          const time = document.createElement('div');
          time.className = 'session-time';
          time.textContent = item.timestampLabel;

          row.append(titleLine, time);
          list.append(row);
        }

        const statusMessage =
          (typeof state.actionErrorMessage === 'string' && state.actionErrorMessage.length > 0
            ? state.actionErrorMessage
            : undefined) ??
          (typeof state.restoreBlockedMessage === 'string' && state.restoreBlockedMessage.length > 0
            ? state.restoreBlockedMessage
            : undefined);
        if (statusMessage) {
          statusNote.textContent = statusMessage;
          statusNote.classList.add('is-visible');
        } else {
          statusNote.textContent = '';
          statusNote.classList.remove('is-visible');
        }

        if (state.errorMessage) {
          emptyState.textContent = state.errorMessage;
          emptyState.classList.add('is-visible');
          return;
        }

        if (visibleItems.length === 0) {
          emptyState.textContent = state.query.trim()
            ? '没有匹配的会话。'
            : '当前 workspace 还没有可恢复的 Codex / Claude Code 会话。';
          emptyState.classList.add('is-visible');
          return;
        }

        emptyState.textContent = '';
        emptyState.classList.remove('is-visible');
      }

      searchInput.addEventListener('input', (event) => {
        setSearchQuery(event.target.value || '');
        render();
      });

      searchClearButton.addEventListener('click', () => {
        setSearchQuery('');
        render();
        searchInput.focus();
      });

      window.addEventListener('message', (event) => {
        const message = event.data;
        if (!message || typeof message.type !== 'string') {
          return;
        }

        if (message.type === 'sidebarSessionHistory/testAction' && message.payload) {
          void performTestAction(message.payload.action)
            .then((snapshot) => {
              vscode.postMessage({
                type: 'sidebarSessionHistory/testActionResult',
                payload: {
                  requestId: message.payload.requestId,
                  snapshot
                }
              });
            })
            .catch((error) => {
              vscode.postMessage({
                type: 'sidebarSessionHistory/testActionResult',
                payload: {
                  requestId: message.payload.requestId,
                  errorMessage: error instanceof Error ? error.message : 'Sidebar session history test action failed.'
                }
              });
            });
          return;
        }

        if (message.type !== 'sidebarSessionHistory/state' || !message.payload) {
          return;
        }

        state.items = Array.isArray(message.payload.items) ? message.payload.items : [];
        state.errorMessage = typeof message.payload.errorMessage === 'string' ? message.payload.errorMessage : undefined;
        state.actionErrorMessage =
          typeof message.payload.actionErrorMessage === 'string' ? message.payload.actionErrorMessage : undefined;
        state.restoreBlockedMessage =
          typeof message.payload.restoreBlockedMessage === 'string' ? message.payload.restoreBlockedMessage : undefined;
        setSearchQuery(state.query);
        render();
      });

      setSearchQuery('');
      vscode.postMessage({ type: 'sidebarSessionHistory/ready' });

      function renderProviderIcon(provider) {
        return providerIcons[provider] || '';
      }
    </script>
  </body>
</html>`;
}

function readBundledProviderIconSvg(fileName: string, fallbackSvg: string): string {
  try {
    return fs.readFileSync(path.join(SIDEBAR_SESSION_ICON_ROOT, fileName), 'utf8').trim();
  } catch {
    return fallbackSvg;
  }
}

function createNonce(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let value = '';
  for (let index = 0; index < 32; index += 1) {
    value += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return value;
}
