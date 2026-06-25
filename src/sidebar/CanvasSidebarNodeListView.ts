import * as path from 'path';
import { readFile, stat } from 'fs/promises';
import * as vscode from 'vscode';

import { stripTerminalControlSequences } from '../common/agentActivityHeuristics';
import { colorForCanvasNodeKind } from '../common/canvasNodeVisuals';
import {
  canvasNodeStatusToneClass,
  humanizeCanvasNodeStatus
} from '../common/canvasNodeStatusPresentation';
import {
  COMMAND_IDS,
  CONTEXT_KEYS,
  STORAGE_KEYS,
  type SidebarNodeListViewMode
} from '../common/extensionIdentity';
import type { CanvasGroupSummary, CanvasNodeKind, CanvasNodeMetadata, CanvasNodeSummary } from '../common/protocol';
import { formatExecutionCwdLabel } from '../common/executionCwdLabel';
import { getVersionedWebviewResourceUri } from '../common/webviewResourceUri';
import type { CanvasPanelManager, CanvasSidebarNodeListSnapshot } from '../panel/CanvasPanelManager';

const SIDEBAR_NODE_DANGLING_CSI_FRAGMENT_PATTERN = /(?:^|\s)\[\?[0-9;:<>=$]*[ -/]*[@-~](?=\s|$)/g;
const SIDEBAR_NODE_ATTENTION_TOOLTIP = '该节点当前有待处理的通知提醒。';
const SIDEBAR_NODE_LIST_REFRESH_DEBOUNCE_MS = 75;
const SIDEBAR_BUNDLED_CODICON_PATH_SEGMENTS = ['dist', 'sidebar-codicon.css'] as const;

export interface CanvasSidebarNodeItemSnapshot {
  id: string;
  nodeId: string;
  nodeKind: CanvasNodeKind;
  groupPath: string[];
  groupPathIds: string[];
  label: string;
  description: string;
  tooltip: string;
  status: string;
  statusLabel: string;
  statusTone: string;
  subtitlePrefix?: string;
  summary: string;
  markerColor: string;
  attentionPending: boolean;
}

export interface SidebarNodeListTestSnapshot {
  rowCount: number;
  visibleItemIds: string[];
  selectedId?: string;
  attentionItemIds: string[];
  viewMode: SidebarNodeListViewMode;
  groupRows: SidebarNodeListTestGroupRowSnapshot[];
}

export interface SidebarNodeListTestGroupRowSnapshot {
  key: string;
  label: string;
  expanded: boolean;
  depth: number;
  folderKind?: SidebarWorkspaceFolderKind;
  folderKindIconClass?: string;
  folderActionTypes: string[];
  folderActionIconClasses: string[];
}

type SidebarWorkspaceFolderKind = 'folder' | 'repository' | 'worktree';

interface CanvasSidebarGroupSnapshot extends CanvasGroupSummary {
  workspaceFolderKind?: SidebarWorkspaceFolderKind;
}

export type SidebarNodeListTestAction =
  | {
      kind: 'clickItem';
      itemId: string;
      delayMs?: number;
    }
  | {
      kind: 'toggleGroup';
      groupKey: string;
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
      type: 'sidebarNodeList/createWorktreeForRoot';
      payload: SidebarWorkspaceFolderActionPayload;
    }
  | {
      type: 'sidebarNodeList/removeFolderFromWorkspace';
      payload: SidebarWorkspaceFolderActionPayload;
    }
  | {
      type: 'sidebarNodeList/removeWorktreeFromWorkspace';
      payload: SidebarWorkspaceFolderActionPayload;
    }
  | {
      type: 'sidebarNodeList/testActionResult';
      payload: {
        requestId: string;
        snapshot?: SidebarNodeListTestSnapshot;
        errorMessage?: string;
      };
    };

interface SidebarWorkspaceFolderActionPayload {
  rootPath: string;
  groupId?: string;
}

type SidebarNodeListOutboundMessage =
  | {
      type: 'sidebarNodeList/state';
      payload: {
        items: CanvasSidebarNodeItemSnapshot[];
        groups: CanvasSidebarGroupSnapshot[];
        viewMode: SidebarNodeListViewMode;
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
  private groups: CanvasSidebarGroupSnapshot[] = [];
  private viewMode: SidebarNodeListViewMode = 'grouped';
  private isWebviewReady = false;
  private refreshTimer: NodeJS.Timeout | undefined;
  private readonly pendingReadyRequests = new Map<string, PendingSidebarNodeListReadyRequest>();
  private readonly pendingTestActionRequests = new Map<string, PendingSidebarNodeListTestActionRequest>();

  public constructor(
    private readonly panelManager: CanvasPanelManager,
    private readonly extensionUri: vscode.Uri,
    private readonly workspaceState?: vscode.Memento
  ) {
    this.viewMode = normalizeSidebarNodeListViewMode(this.workspaceState?.get(STORAGE_KEYS.sidebarNodeListViewMode));
    this.applyViewModeContext();
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
    const snapshot = this.panelManager.getCanvasSidebarNodeListSnapshot();
    this.groups = await resolveSidebarGroupSnapshots(snapshot.groups);
    this.items = getCanvasSidebarNodeListItems(snapshot, this.panelManager.getWorkspaceFoldersForDisplay());
    await this.postState();
    return this.items;
  }

  public getViewMode(): SidebarNodeListViewMode {
    return this.viewMode;
  }

  public async setViewMode(viewMode: SidebarNodeListViewMode): Promise<void> {
    if (this.viewMode === viewMode) {
      this.applyViewModeContext();
      await this.postState();
      return;
    }

    this.viewMode = viewMode;
    this.applyViewModeContext();
    await this.workspaceState?.update(STORAGE_KEYS.sidebarNodeListViewMode, viewMode);
    await this.postState();
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
        items: this.items,
        groups: this.groups,
        viewMode: this.viewMode
      }
    } satisfies SidebarNodeListOutboundMessage);
  }

  private applyViewModeContext(): void {
    void vscode.commands.executeCommand(
      'setContext',
      CONTEXT_KEYS.sidebarNodeListGroupedView,
      this.viewMode === 'grouped'
    );
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
      case 'sidebarNodeList/createWorktreeForRoot':
        await vscode.commands.executeCommand(
          COMMAND_IDS.createWorktreeForRoot,
          parsed.payload.rootPath,
          parsed.payload.groupId
        );
        return;
      case 'sidebarNodeList/removeFolderFromWorkspace':
        await vscode.commands.executeCommand(
          COMMAND_IDS.removeFolderFromWorkspace,
          parsed.payload.rootPath,
          parsed.payload.groupId
        );
        return;
      case 'sidebarNodeList/removeWorktreeFromWorkspace':
        await vscode.commands.executeCommand(
          COMMAND_IDS.removeWorktreeFromWorkspace,
          parsed.payload.rootPath,
          parsed.payload.groupId
        );
        return;
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

export function getCanvasSidebarNodeListItems(
  source: CanvasNodeSummary[] | CanvasSidebarNodeListSnapshot,
  workspaceFolders: Parameters<typeof formatExecutionCwdLabel>[1] = []
): CanvasSidebarNodeItemSnapshot[] {
  const nodes = Array.isArray(source) ? source : source.nodes;
  const groups = Array.isArray(source) ? [] : source.groups;
  const groupsById = new Map(groups.map((group) => [group.id, group] as const));
  return nodes
    .filter((node) => node.kind !== 'file' && node.kind !== 'file-list')
    .map((node) => {
      const label = node.title.trim() || fallbackNodeLabel(node.kind, node.id);
      const statusLabel = humanizeCanvasNodeStatus(node);
      const groupPath = resolveSidebarNodeGroupPath(node.groupId, groupsById);
      const subtitlePrefix = buildSidebarNodeSubtitlePrefix(node, workspaceFolders);
      const secondLine = buildSidebarNodeSecondaryText(subtitlePrefix, statusLabel);
      const summary = sanitizeSidebarNodeSummary(node.summary);
      const attentionPending = canvasNodeAttentionPending(node.metadata);
      const description = secondLine;
      const tooltipLines = [label, `${humanizeNodeKind(node.kind)} · ${secondLine}`];
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
        groupPath: groupPath.map((group) => group.title),
        groupPathIds: groupPath.map((group) => group.id),
        label,
        description,
        tooltip: tooltipLines.join('\n'),
        status: secondLine,
        statusLabel,
        statusTone: canvasNodeStatusToneClass(node),
        subtitlePrefix,
        summary,
        markerColor: colorForCanvasNodeKind(node.kind),
        attentionPending
      } satisfies CanvasSidebarNodeItemSnapshot;
    });
}

function resolveSidebarNodeGroupPath(
  groupId: string | undefined,
  groupsById: ReadonlyMap<string, CanvasGroupSummary>
): Array<{ id: string; title: string }> {
  const path: Array<{ id: string; title: string }> = [];
  const visited = new Set<string>();
  let currentGroup = groupId ? groupsById.get(groupId) : undefined;
  while (currentGroup && !visited.has(currentGroup.id)) {
    visited.add(currentGroup.id);
    path.unshift({
      id: currentGroup.id,
      title: currentGroup.title.trim() || '未命名分组'
    });
    currentGroup = currentGroup.parentGroupId ? groupsById.get(currentGroup.parentGroupId) : undefined;
  }
  return path;
}

function buildSidebarNodeSecondaryText(subtitlePrefix: string | undefined, statusLabel: string): string {
  return subtitlePrefix ? `${subtitlePrefix} · ${statusLabel}` : statusLabel;
}

function buildSidebarNodeSubtitlePrefix(
  node: CanvasNodeSummary,
  workspaceFolders: Parameters<typeof formatExecutionCwdLabel>[1]
): string | undefined {
  if (node.kind !== 'agent') {
    return undefined;
  }

  const agentMetadata = node.metadata?.agent;
  const providerLabel = humanizeAgentProvider(agentMetadata?.provider);
  const cwdLabel = formatExecutionCwdLabel(agentMetadata?.cwd, workspaceFolders);
  return `${cwdLabel} · ${providerLabel}`;
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

function humanizeAgentProvider(provider: 'codex' | 'claude' | undefined): string {
  return provider === 'claude' ? 'Claude Code' : 'Codex';
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
    case 'sidebarNodeList/createWorktreeForRoot':
    case 'sidebarNodeList/removeFolderFromWorkspace':
    case 'sidebarNodeList/removeWorktreeFromWorkspace': {
      const payload = parseSidebarWorkspaceFolderActionPayload('payload' in message ? message.payload : undefined);
      if (!payload) {
        return null;
      }

      return {
        type: message.type,
        payload
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

function parseSidebarWorkspaceFolderActionPayload(value: unknown): SidebarWorkspaceFolderActionPayload | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const rootPath = 'rootPath' in value && typeof value.rootPath === 'string' ? value.rootPath.trim() : '';
  if (!rootPath) {
    return null;
  }

  const groupId = 'groupId' in value && typeof value.groupId === 'string' && value.groupId.trim()
    ? value.groupId.trim()
    : undefined;

  return {
    rootPath,
    groupId
  };
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
  const viewMode = normalizeSidebarNodeListViewMode('viewMode' in value ? value.viewMode : undefined);
  const groupRows =
    'groupRows' in value && Array.isArray(value.groupRows)
      ? value.groupRows
          .map(parseSidebarNodeListTestGroupRowSnapshot)
          .filter((row): row is SidebarNodeListTestGroupRowSnapshot => row !== null)
      : null;

  if (rowCount === null || visibleItemIds === null || attentionItemIds === null || groupRows === null) {
    return null;
  }

  return {
    rowCount,
    visibleItemIds,
    selectedId,
    attentionItemIds,
    viewMode,
    groupRows
  };
}

function parseSidebarNodeListTestGroupRowSnapshot(value: unknown): SidebarNodeListTestGroupRowSnapshot | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const key = 'key' in value && typeof value.key === 'string' ? value.key : null;
  const label = 'label' in value && typeof value.label === 'string' ? value.label : null;
  const expanded = 'expanded' in value && typeof value.expanded === 'boolean' ? value.expanded : null;
  const depth = 'depth' in value && typeof value.depth === 'number' ? value.depth : null;
  const folderKind =
    'folderKind' in value && isSidebarWorkspaceFolderKind(value.folderKind) ? value.folderKind : undefined;
  const folderKindIconClass =
    'folderKindIconClass' in value && typeof value.folderKindIconClass === 'string'
      ? value.folderKindIconClass
      : undefined;
  const folderActionTypes =
    'folderActionTypes' in value && Array.isArray(value.folderActionTypes)
      ? value.folderActionTypes.filter((actionType): actionType is string => typeof actionType === 'string')
      : [];
  const folderActionIconClasses =
    'folderActionIconClasses' in value && Array.isArray(value.folderActionIconClasses)
      ? value.folderActionIconClasses.filter((iconClass): iconClass is string => typeof iconClass === 'string')
      : [];
  if (key === null || label === null || expanded === null || depth === null) {
    return null;
  }

  return {
    key,
    label,
    expanded,
    depth,
    folderKind,
    folderKindIconClass,
    folderActionTypes,
    folderActionIconClasses
  };
}

function isSidebarWorkspaceFolderKind(value: unknown): value is SidebarWorkspaceFolderKind {
  return value === 'folder' || value === 'repository' || value === 'worktree';
}

async function resolveSidebarGroupSnapshots(groups: CanvasGroupSummary[]): Promise<CanvasSidebarGroupSnapshot[]> {
  return await Promise.all(
    groups.map(async (group): Promise<CanvasSidebarGroupSnapshot> => {
      if (!isWorkspaceRootGroupSummary(group) || typeof group.workspaceRootPath !== 'string') {
        return group;
      }

      return {
        ...group,
        workspaceFolderKind: await classifyWorkspaceFolderKind(group.workspaceRootPath)
      };
    })
  );
}

function isWorkspaceRootGroupSummary(group: Pick<CanvasGroupSummary, 'role'>): boolean {
  return group.role === 'workspace-root';
}

async function classifyWorkspaceFolderKind(workspaceFolderPath: string): Promise<SidebarWorkspaceFolderKind> {
  const gitMetadataPath = path.join(workspaceFolderPath, '.git');
  let gitMetadataStat;
  try {
    gitMetadataStat = await stat(gitMetadataPath);
  } catch (error) {
    return isMissingSidebarFileSystemEntryError(error) ? 'folder' : 'repository';
  }

  if (gitMetadataStat.isDirectory()) {
    return 'repository';
  }
  if (!gitMetadataStat.isFile()) {
    return 'repository';
  }

  try {
    const gitMetadata = await readFile(gitMetadataPath, 'utf8');
    const gitDirMatch = /^gitdir:\s*(.+)\s*$/imu.exec(gitMetadata);
    const gitDirPath = gitDirMatch?.[1]?.trim();
    if (gitDirPath) {
      const resolvedGitDirPath = path.isAbsolute(gitDirPath)
        ? path.resolve(gitDirPath)
        : path.resolve(workspaceFolderPath, gitDirPath);
      const normalizedGitDirPath = normalizeComparableSidebarFileSystemPath(resolvedGitDirPath);
      if (normalizedGitDirPath.includes(`${path.sep}worktrees${path.sep}`)) {
        return 'worktree';
      }
    }
  } catch {
    return 'repository';
  }

  return 'repository';
}

function isMissingSidebarFileSystemEntryError(error: unknown): boolean {
  if (error === null || typeof error !== 'object' || !('code' in error)) {
    return false;
  }

  return error.code === 'ENOENT' || error.code === 'ENOTDIR';
}

function normalizeComparableSidebarFileSystemPath(filePath: string): string {
  const resolvedPath = path.resolve(filePath);
  return process.platform === 'win32' ? resolvedPath.toLowerCase() : resolvedPath;
}

export function isSidebarNodeListTestAction(value: unknown): value is SidebarNodeListTestAction {
  if (value === null || typeof value !== 'object' || !('kind' in value)) {
    return false;
  }

  if (value.kind === 'clickItem') {
    return (
      'itemId' in value &&
      typeof value.itemId === 'string' &&
      (!('delayMs' in value) || typeof value.delayMs === 'number')
    );
  }

  if (value.kind === 'toggleGroup') {
    return (
      'groupKey' in value &&
      typeof value.groupKey === 'string' &&
      (!('delayMs' in value) || typeof value.delayMs === 'number')
    );
  }

  return false;
}

function normalizeSidebarNodeListViewMode(value: unknown): SidebarNodeListViewMode {
  return value === 'flat' ? 'flat' : 'grouped';
}

export function buildSidebarNodeListHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
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
        --fg: var(--vscode-foreground, var(--vscode-sideBar-foreground));
        --muted: var(--vscode-descriptionForeground);
        --focus: var(--vscode-focusBorder);
        --list-hover: var(--vscode-list-hoverBackground, color-mix(in srgb, var(--fg) 6%, transparent));
        --list-hover-fg: var(--vscode-list-hoverForeground, var(--fg));
        --list-active: var(--vscode-list-activeSelectionBackground, color-mix(in srgb, var(--focus) 18%, transparent));
        --list-active-fg: var(--vscode-list-activeSelectionForeground, var(--fg));
        --list-inactive: var(--vscode-list-inactiveSelectionBackground, color-mix(in srgb, var(--focus) 10%, transparent));
        --list-inactive-fg: var(--vscode-list-inactiveSelectionForeground, var(--fg));
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

      .node-group-row {
        --row-fg: var(--fg);
        --row-muted: var(--muted);
        width: 100%;
        min-width: 0;
        min-height: 22px;
        display: flex;
        align-items: center;
        gap: 4px;
        border: 0;
        background: transparent;
        color: var(--row-fg);
        font: inherit;
        text-align: left;
        cursor: default;
      }

      .node-group-row:hover {
        background: var(--list-hover);
        --row-fg: var(--list-hover-fg);
        --row-muted: var(--list-hover-fg);
      }

      .node-group-row:focus-visible {
        background: var(--list-active);
        color: var(--list-active-fg);
        outline: 1px solid var(--focus);
        outline-offset: -1px;
      }

      .node-group-twistie {
        width: 16px;
        height: 16px;
        flex: 0 0 auto;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        color: var(--row-muted);
        font-size: 14px;
        line-height: 1;
      }

      .node-group-title {
        min-width: 0;
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
        font-size: 12px;
        font-weight: 600;
      }

      .node-group-count {
        flex: 0 0 auto;
        margin-left: auto;
        color: var(--row-muted);
        font-size: 11px;
      }

      .node-group-folder-actions {
        flex: 0 0 auto;
        display: inline-flex;
        align-items: center;
        gap: 1px;
        margin-left: 4px;
      }

      .node-group-folder-action {
        width: 20px;
        height: 20px;
        padding: 0;
        border: 0;
        border-radius: 3px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        background: transparent;
        color: var(--row-muted);
        font: inherit;
        cursor: pointer;
      }

      .node-group-folder-action:hover {
        background: color-mix(in srgb, var(--list-hover) 82%, var(--fg) 8%);
        color: var(--row-fg);
      }

      .node-group-folder-action.is-danger:hover {
        color: var(--vscode-errorForeground, var(--row-fg));
      }

      .node-group-folder-action:focus-visible {
        outline: 1px solid var(--focus);
        outline-offset: -1px;
      }

      .node-group-kind-icon {
        flex: 0 0 auto;
        color: var(--attention);
        font-size: 13px;
        line-height: 1;
      }

      .node-group-kind-icon.is-workspace-folder {
        color: var(--muted);
      }

      .node-row {
        --row-fg: var(--fg);
        --row-muted: var(--muted);
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: start;
        gap: 6px 10px;
        padding: 9px 12px;
        border: 0;
        border-left: 2px solid transparent;
        background: transparent;
        color: var(--row-fg);
        text-align: left;
        cursor: default;
      }

      .node-row.is-grouped {
        padding-top: 7px;
        padding-bottom: 7px;
      }

      .node-row:hover {
        background: var(--list-hover);
        --row-fg: var(--list-hover-fg);
        --row-muted: var(--list-hover-fg);
      }

      .node-row.is-selected {
        background: var(--list-inactive);
        --row-fg: var(--list-inactive-fg);
        --row-muted: var(--list-inactive-fg);
      }

      .node-row.is-selected:focus,
      .node-row:focus-visible {
        background: var(--list-active);
        --row-fg: var(--list-active-fg);
        --row-muted: var(--list-active-fg);
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
        display: flex;
        min-width: 0;
        align-items: center;
        gap: 4px;
        font-size: 11px;
        padding-left: 22px;
      }

      .node-status-prefix {
        min-width: 0;
        overflow: hidden;
        color: var(--row-muted);
        white-space: nowrap;
        text-overflow: ellipsis;
      }

      .node-group-path {
        min-width: 0;
        overflow: hidden;
        color: var(--row-muted);
        white-space: nowrap;
        text-overflow: ellipsis;
        padding-left: 22px;
        font-size: 11px;
      }

      .status-pill {
        --status-pill-accent: var(--vscode-debugView-stateLabelForeground, var(--focus));
        --status-pill-bg: color-mix(in srgb, var(--status-pill-accent) 18%, transparent);
        --status-pill-border: color-mix(in srgb, var(--status-pill-accent) 42%, var(--vscode-panel-border) 58%);
        --status-pill-fg: var(--status-pill-accent);
        display: inline-flex;
        min-height: 16px;
        flex: 0 0 auto;
        align-items: center;
        border: 1px solid var(--status-pill-border);
        border-radius: 6px;
        background: var(--status-pill-bg);
        color: var(--status-pill-fg);
        padding: 0 5px;
        font-size: 10px;
        font-weight: 600;
        line-height: 1;
        white-space: nowrap;
      }

      .tone-starting {
        --status-pill-accent: var(--vscode-debugIcon-startForeground, var(--focus));
      }

      .tone-running {
        --status-pill-accent: var(--vscode-debugIcon-startForeground, var(--vscode-debugIcon-restartForeground, var(--focus)));
      }

      .tone-resuming {
        --status-pill-accent: var(--vscode-debugIcon-restartForeground, var(--focus));
      }

      .tone-success {
        --status-pill-accent: var(--vscode-debugIcon-continueForeground, var(--focus));
      }

      .tone-waiting {
        --status-pill-accent: var(--vscode-debugIcon-pauseForeground, var(--focus));
      }

      .tone-stopped {
        --status-pill-accent: var(--vscode-debugIcon-stopForeground, var(--vscode-descriptionForeground));
      }

      .tone-disconnected {
        --status-pill-accent: var(--vscode-debugIcon-disconnectForeground, var(--vscode-descriptionForeground));
      }

      .tone-history {
        --status-pill-accent: var(--vscode-debugIcon-stepBackForeground, var(--vscode-descriptionForeground));
      }

      .tone-idle {
        --status-pill-accent: var(--vscode-debugView-stateLabelForeground, var(--vscode-descriptionForeground));
      }

      .tone-error {
        --status-pill-accent: var(
          --vscode-debugView-exceptionLabelForeground,
          var(--vscode-debugConsole-errorForeground, var(--vscode-errorForeground, var(--focus)))
        );
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
      const ATTENTION_GROUP_KEY = '__attention__';
      const ATTENTION_GROUP_LABEL = '待处理提醒';
      const UNGROUPED_GROUP_KEY = '__ungrouped__';
      const WORKSPACE_ROOT_GROUP_ROLE = 'workspace-root';
      const state = {
        items: [],
        groups: [],
        selectedId: undefined,
        viewMode: 'grouped',
        collapsedGroupKeys: new Set()
      };

      const list = document.getElementById('list');
      const emptyState = document.getElementById('emptyState');

      function normalizeViewMode(value) {
        return value === 'flat' ? 'flat' : 'grouped';
      }

      function normalizeGroupTitle(group) {
        return typeof group.title === 'string' && group.title.trim() ? group.title.trim() : '未命名分组';
      }

      function normalizeGroupIds(item) {
        if (Array.isArray(item.groupPathIds) && item.groupPathIds.length > 0) {
          return item.groupPathIds.filter((groupId) => typeof groupId === 'string' && groupId.length > 0);
        }
        return [];
      }

      function normalizeItemGroupPath(item) {
        if (!Array.isArray(item.groupPath)) {
          return [];
        }
        return item.groupPath.filter((part) => typeof part === 'string' && part.length > 0);
      }

      function isWorkspaceRootGroup(group) {
        return group && group.role === WORKSPACE_ROOT_GROUP_ROLE;
      }

      function normalizeWorkspaceFolderKind(value) {
        return value === 'worktree' || value === 'repository' ? value : 'folder';
      }

      function getWorkspaceFolderKindIconClass(kind) {
        if (kind === 'worktree') {
          return 'codicon-worktree';
        }
        if (kind === 'repository') {
          return 'codicon-repo';
        }
        return 'codicon-folder';
      }

      function getWorkspaceFolderKindLabel(kind) {
        if (kind === 'worktree') {
          return 'Git worktree';
        }
        if (kind === 'repository') {
          return 'Git repository';
        }
        return '普通 folder';
      }

      function getWorkspaceRootGroups() {
        return state.groups.filter(isWorkspaceRootGroup);
      }

      function shouldRenderFlatRootGroups() {
        return state.viewMode === 'flat' && getWorkspaceRootGroups().length > 1;
      }

      function isTreeRenderMode() {
        return state.viewMode === 'grouped' || shouldRenderFlatRootGroups();
      }

      function hasAttentionItems(items = state.items) {
        return items.some((item) => item && item.attentionPending === true);
      }

      function getAttentionItems(items = state.items) {
        return items.filter((item) => item && item.attentionPending === true);
      }

      function sortItemsForFlat(items) {
        const indexedItems = items.map((item, index) => ({ item, index }));
        if (!indexedItems.some((entry) => entry.item.attentionPending === true)) {
          return indexedItems.map((entry) => entry.item);
        }
        indexedItems.sort((left, right) => {
          const attentionDelta = Number(right.item.attentionPending === true) - Number(left.item.attentionPending === true);
          return attentionDelta || left.index - right.index;
        });
        return indexedItems.map((entry) => entry.item);
      }

      function sortItemsByLabel(items) {
        items.sort((left, right) => left.label.localeCompare(right.label, 'zh-CN') || left.id.localeCompare(right.id, 'zh-CN'));
      }

      function resolveItemWorkspaceRootGroupId(item, workspaceRootGroupIds) {
        return normalizeGroupIds(item).find((groupId) => workspaceRootGroupIds.has(groupId));
      }

      function buildGroupPathLabel(item, options = {}) {
        const path = normalizeItemGroupPath(item);
        if (path.length === 0) {
          return '';
        }

        if (!options.rootGroupId) {
          return path.join(' / ');
        }

        const groupIds = normalizeGroupIds(item);
        const rootIndex = groupIds.indexOf(options.rootGroupId);
        if (rootIndex < 0) {
          return path.join(' / ');
        }

        return path.slice(rootIndex + 1).join(' / ');
      }

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
        const rows = Array.from(list.querySelectorAll('[data-sidebar-node-item-id]'));
        const groupRows = Array.from(list.querySelectorAll('[data-sidebar-node-group-key]'));
        return {
          rowCount: rows.length,
          visibleItemIds: rows.map((row) => row.getAttribute('data-sidebar-node-item-id')).filter(Boolean),
          selectedId: state.selectedId,
          viewMode: state.viewMode,
          attentionItemIds: rows
            .filter((row) => row.getAttribute('data-attention-pending') === 'true')
            .map((row) => row.getAttribute('data-sidebar-node-item-id'))
            .filter(Boolean),
          groupRows: groupRows.map((row) => ({
            key: row.getAttribute('data-sidebar-node-group-key') || '',
            label: row.getAttribute('data-sidebar-node-group-label') || '',
            expanded: row.getAttribute('aria-expanded') === 'true',
            depth: Number(row.getAttribute('data-sidebar-node-group-depth') || '0'),
            folderKind: row.getAttribute('data-sidebar-workspace-folder-kind') || undefined,
            folderKindIconClass: row.getAttribute('data-sidebar-workspace-folder-kind-icon') || undefined,
            folderActionTypes: Array.from(
              row.querySelectorAll('[data-sidebar-folder-action]')
            ).map((action) => action.getAttribute('data-sidebar-folder-action')).filter(Boolean),
            folderActionIconClasses: Array.from(
              row.querySelectorAll('[data-sidebar-folder-action]')
            ).map((action) => action.getAttribute('data-sidebar-folder-action-icon')).filter(Boolean)
          }))
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

      function queryGroupByKey(groupKey) {
        return list.querySelector('[data-sidebar-node-group-key="' + CSS.escape(groupKey) + '"]');
      }

      function toggleGroup(groupKey) {
        if (state.collapsedGroupKeys.has(groupKey)) {
          state.collapsedGroupKeys.delete(groupKey);
        } else {
          state.collapsedGroupKeys.add(groupKey);
        }
        render();
      }

      async function performTestAction(action) {
        if (!action || (action.kind !== 'clickItem' && action.kind !== 'toggleGroup')) {
          throw new Error('Unsupported sidebar node list test action.');
        }

        if (typeof action.delayMs === 'number' && action.delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, action.delayMs));
        }

        if (action.kind === 'toggleGroup') {
          if (typeof action.groupKey !== 'string') {
            throw new Error('Sidebar node group key is required.');
          }
          const groupRow = queryGroupByKey(action.groupKey);
          if (!groupRow) {
            throw new Error('Target sidebar node group row is not visible.');
          }
          groupRow.focus();
          groupRow.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
          dispatchSyntheticMouseClick(groupRow);
          await waitForDomActionFlush();
          return captureTestSnapshot();
        }

        if (typeof action.itemId !== 'string') {
          throw new Error('Sidebar node item id is required.');
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

      function getFlatRenderedItems() {
        return sortItemsForFlat(state.items);
      }

      function getPreferredInitialItem() {
        const attentionItems = getAttentionItems();
        if (attentionItems.length > 0) {
          return sortItemsForFlat(attentionItems)[0];
        }
        if (state.viewMode === 'flat') {
          return getFlatRenderedItems()[0];
        }
        return state.items[0];
      }

      function createGroupTreeNode(group) {
        return {
          id: group.id,
          key: group.id,
          label: normalizeGroupTitle(group),
          parentGroupId: typeof group.parentGroupId === 'string' ? group.parentGroupId : undefined,
          workspaceRootPath: isWorkspaceRootGroup(group) && typeof group.workspaceRootPath === 'string'
            ? group.workspaceRootPath
            : undefined,
          workspaceFolderKind: isWorkspaceRootGroup(group) ? normalizeWorkspaceFolderKind(group.workspaceFolderKind) : undefined,
          childGroups: [],
          items: [],
          depth: 0,
          totalItemCount: 0
        };
      }

      function buildGroupedTree() {
        const root = {
          childGroups: [],
          items: [],
          totalItemCount: 0
        };
        const groupNodesById = new Map();
        for (const group of state.groups) {
          if (!group || typeof group.id !== 'string') {
            continue;
          }
          groupNodesById.set(group.id, createGroupTreeNode(group));
        }

        for (const groupNode of groupNodesById.values()) {
          const parentNode = groupNode.parentGroupId ? groupNodesById.get(groupNode.parentGroupId) : undefined;
          if (parentNode) {
            parentNode.childGroups.push(groupNode);
          } else {
            root.childGroups.push(groupNode);
          }
        }

        for (const item of state.items) {
          const groupIds = normalizeGroupIds(item);
          const directGroupId = groupIds.length > 0 ? groupIds[groupIds.length - 1] : undefined;
          const groupNode = directGroupId ? groupNodesById.get(directGroupId) : undefined;
          if (groupNode) {
            groupNode.items.push(item);
          } else {
            root.items.push(item);
          }
        }

        const sortGroups = (groups) => {
          groups.sort((left, right) => left.label.localeCompare(right.label, 'zh-CN') || left.id.localeCompare(right.id, 'zh-CN'));
        };
        const visit = (groupNode, depth) => {
          groupNode.depth = depth;
          sortGroups(groupNode.childGroups);
          sortItemsByLabel(groupNode.items);
          let total = groupNode.items.length;
          for (const childGroup of groupNode.childGroups) {
            total += visit(childGroup, depth + 1);
          }
          groupNode.totalItemCount = total;
          return total;
        };

        sortGroups(root.childGroups);
        sortItemsByLabel(root.items);
        root.totalItemCount = root.items.length;
        for (const groupNode of root.childGroups) {
          root.totalItemCount += visit(groupNode, 0);
        }
        return root;
      }

      function pruneCollapsedGroupKeys(root) {
        const validKeys = new Set();
        if (root.items.length > 0) {
          validKeys.add(UNGROUPED_GROUP_KEY);
        }
        if (hasAttentionItems()) {
          validKeys.add(ATTENTION_GROUP_KEY);
        }
        const visit = (groupNode) => {
          validKeys.add(groupNode.key);
          for (const childGroup of groupNode.childGroups) {
            visit(childGroup);
          }
        };
        for (const groupNode of root.childGroups) {
          visit(groupNode);
        }
        for (const groupKey of [...state.collapsedGroupKeys]) {
          if (!validKeys.has(groupKey)) {
            state.collapsedGroupKeys.delete(groupKey);
          }
        }
      }

      function renderGroupRow(options) {
        const row = document.createElement('div');
        const isExpanded = !state.collapsedGroupKeys.has(options.key);
        const isWorkspaceFolder = typeof options.workspaceRootPath === 'string' && options.workspaceRootPath.trim().length > 0;
        row.className = 'node-group-row';
        row.tabIndex = 0;
        row.title = isWorkspaceFolder ? options.label + '\\n' + options.workspaceRootPath : options.label;
        row.style.paddingLeft = String(4 + options.depth * 14) + 'px';
        row.setAttribute('data-sidebar-node-group-key', options.key);
        row.setAttribute('data-sidebar-node-group-label', options.label);
        row.setAttribute('data-sidebar-node-group-depth', String(options.depth));
        if (isWorkspaceFolder) {
          row.setAttribute('data-sidebar-workspace-folder-path', options.workspaceRootPath);
          const folderKind = normalizeWorkspaceFolderKind(options.workspaceFolderKind);
          row.setAttribute('data-sidebar-workspace-folder-kind', folderKind);
          row.setAttribute('data-sidebar-workspace-folder-kind-icon', getWorkspaceFolderKindIconClass(folderKind));
        }
        if (options.virtualKind) {
          row.setAttribute('data-sidebar-node-group-virtual-kind', options.virtualKind);
        }
        row.setAttribute('role', 'treeitem');
        row.setAttribute('aria-level', String(options.depth + 1));
        row.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
        row.setAttribute('aria-label', options.label + (isExpanded ? '，已展开' : '，已折叠'));

        const twistie = document.createElement('span');
        twistie.className = 'node-group-twistie codicon ' + (isExpanded ? 'codicon-chevron-down' : 'codicon-chevron-right');
        twistie.setAttribute('aria-hidden', 'true');

        const leadingIcon = document.createElement('span');
        const folderKind = isWorkspaceFolder ? normalizeWorkspaceFolderKind(options.workspaceFolderKind) : undefined;
        const leadingIconClass = folderKind ? getWorkspaceFolderKindIconClass(folderKind) : options.leadingIconClass;
        if (leadingIconClass) {
          leadingIcon.className = 'node-group-kind-icon codicon ' + leadingIconClass + (folderKind ? ' is-workspace-folder' : '');
          leadingIcon.setAttribute('aria-hidden', 'true');
          if (folderKind) {
            leadingIcon.title = getWorkspaceFolderKindLabel(folderKind);
          }
        }

        const title = document.createElement('span');
        title.className = 'node-group-title';
        title.textContent = options.label;

        const count = document.createElement('span');
        count.className = 'node-group-count';
        count.textContent = options.totalItemCount > 0 ? String(options.totalItemCount) : '';

        const children = leadingIconClass
          ? [twistie, leadingIcon, title, count]
          : [twistie, title, count];
        if (isWorkspaceFolder) {
          const actions = renderWorkspaceFolderActions(options.key, options.workspaceRootPath);
          children.push(actions);
        }

        row.append(...children);
        row.addEventListener('click', () => toggleGroup(options.key));
        row.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            toggleGroup(options.key);
          }
        });
        list.append(row);
      }

      function renderWorkspaceFolderActions(groupKey, rootPath) {
        const actions = document.createElement('span');
        actions.className = 'node-group-folder-actions';

        const worktreeButton = createWorkspaceFolderActionButton({
          action: 'createWorktree',
          iconClass: 'codicon-worktree',
          label: '为此 folder 新建 worktree 并加入 workspace',
          danger: false,
          onClick: () => {
            vscode.postMessage({
              type: 'sidebarNodeList/createWorktreeForRoot',
              payload: {
                rootPath,
                groupId: groupKey
              }
            });
          }
        });

        const removeButton = createWorkspaceFolderActionButton({
          action: 'removeFolder',
          iconClass: 'codicon-close',
          label: '从 Workspace 移除文件夹（可保留或清空画板）',
          danger: true,
          onClick: () => {
            vscode.postMessage({
              type: 'sidebarNodeList/removeFolderFromWorkspace',
              payload: {
                rootPath,
                groupId: groupKey
              }
            });
          }
        });

        const removeWorktreeButton = createWorkspaceFolderActionButton({
          action: 'removeWorktree',
          iconClass: 'codicon-trash',
          label: '移除 Worktree（默认清空画板，可保留画板）',
          danger: true,
          onClick: () => {
            vscode.postMessage({
              type: 'sidebarNodeList/removeWorktreeFromWorkspace',
              payload: {
                rootPath,
                groupId: groupKey
              }
            });
          }
        });

        actions.append(worktreeButton, removeWorktreeButton, removeButton);
        return actions;
      }

      function createWorkspaceFolderActionButton(options) {
        const button = document.createElement('span');
        button.className = 'node-group-folder-action codicon ' + options.iconClass + (options.danger ? ' is-danger' : '');
        button.setAttribute('role', 'button');
        button.setAttribute('tabindex', '0');
        button.setAttribute('aria-label', options.label);
        button.setAttribute('title', options.label);
        button.setAttribute('data-sidebar-folder-action', options.action);
        button.setAttribute('data-sidebar-folder-action-icon', options.iconClass);
        button.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          options.onClick();
        });
        button.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            event.stopPropagation();
            options.onClick();
          }
        });
        return button;
      }

      function groupRowOptionsFromTreeNode(groupNode) {
        return {
          key: groupNode.key,
          label: groupNode.label,
          depth: groupNode.depth,
          totalItemCount: groupNode.totalItemCount,
          workspaceRootPath: groupNode.workspaceRootPath,
          workspaceFolderKind: groupNode.workspaceFolderKind
        };
      }

      function renderNodeRow(item, depth, options = {}) {
        const row = document.createElement('div');
        row.className = 'node-row';
        row.tabIndex = 0;
        row.title = item.tooltip;
        row.setAttribute('data-sidebar-node-item-id', item.id);
        row.setAttribute('data-sidebar-node-id', item.nodeId);
        row.setAttribute('data-attention-pending', item.attentionPending ? 'true' : 'false');
        row.setAttribute('role', isTreeRenderMode() ? 'treeitem' : 'option');
        row.setAttribute('aria-selected', item.id === state.selectedId ? 'true' : 'false');
        row.setAttribute(
          'aria-label',
          item.label + '，' + item.status + (item.attentionPending ? '，当前有通知提醒' : '')
        );
        if (isTreeRenderMode()) {
          row.classList.add('is-grouped');
          row.style.paddingLeft = String(12 + depth * 14) + 'px';
          row.setAttribute('aria-level', String(depth + 1));
        }
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
        if (item.subtitlePrefix) {
          const subtitlePrefix = document.createElement('span');
          subtitlePrefix.className = 'node-status-prefix';
          subtitlePrefix.textContent = item.subtitlePrefix + ' ·';
          status.append(subtitlePrefix);
        }
        const statusPill = document.createElement('span');
        statusPill.className = 'status-pill ' + item.statusTone;
        statusPill.textContent = item.statusLabel;
        status.append(statusPill);
        main.append(status);

        const groupPathLabel = options.groupPathLabel ?? (
          state.viewMode !== 'grouped' ? buildGroupPathLabel(item, { rootGroupId: options.rootGroupId }) : ''
        );
        if (groupPathLabel) {
          const groupPath = document.createElement('div');
          groupPath.className = 'node-group-path';
          groupPath.textContent = groupPathLabel;
          main.append(groupPath);
        }

        row.append(main);

        if (item.attentionPending) {
          const attention = document.createElement('span');
          attention.className = 'node-attention codicon codicon-bell';
          attention.setAttribute('aria-hidden', 'true');
          attention.title = '终端有待处理的通知';
          row.append(attention);
        }

        list.append(row);
      }

      function renderAttentionGroup(depth, options = {}) {
        const attentionItems = sortItemsForFlat(getAttentionItems());
        if (attentionItems.length === 0) {
          return;
        }

        renderGroupRow({
          key: ATTENTION_GROUP_KEY,
          label: ATTENTION_GROUP_LABEL,
          depth,
          totalItemCount: attentionItems.length,
          leadingIconClass: 'codicon-bell',
          virtualKind: 'attention'
        });
        if (state.collapsedGroupKeys.has(ATTENTION_GROUP_KEY)) {
          return;
        }

        for (const item of attentionItems) {
          renderNodeRow(item, depth + 1, {
            groupPathLabel: options.showGroupPath ? buildGroupPathLabel(item) : ''
          });
        }
      }

      function renderGroupNode(groupNode) {
        renderGroupRow(groupRowOptionsFromTreeNode(groupNode));
        if (state.collapsedGroupKeys.has(groupNode.key)) {
          return;
        }
        for (const childGroup of groupNode.childGroups) {
          renderGroupNode(childGroup);
        }
        for (const item of groupNode.items) {
          renderNodeRow(item, groupNode.depth + 1);
        }
      }

      function renderGroupedTree() {
        const root = buildGroupedTree();
        pruneCollapsedGroupKeys(root);
        renderAttentionGroup(0, { showGroupPath: true });
        if (root.items.length > 0) {
          renderGroupRow({
            key: UNGROUPED_GROUP_KEY,
            label: '未分组',
            depth: 0,
            totalItemCount: root.items.length
          });
          if (!state.collapsedGroupKeys.has(UNGROUPED_GROUP_KEY)) {
            for (const item of root.items) {
              renderNodeRow(item, 1);
            }
          }
        }
        for (const groupNode of root.childGroups) {
          renderGroupNode(groupNode);
        }
      }

      function renderFlatRootGroups() {
        const workspaceRootGroups = getWorkspaceRootGroups();
        const workspaceRootGroupIds = new Set(workspaceRootGroups.map((group) => group.id));
        const itemsByRootGroupId = new Map(workspaceRootGroups.map((group) => [group.id, []]));
        const unrootedItems = [];

        for (const item of state.items) {
          const rootGroupId = resolveItemWorkspaceRootGroupId(item, workspaceRootGroupIds);
          if (rootGroupId && itemsByRootGroupId.has(rootGroupId)) {
            itemsByRootGroupId.get(rootGroupId).push(item);
          } else {
            unrootedItems.push(item);
          }
        }

        const root = {
          items: unrootedItems,
          childGroups: workspaceRootGroups.map((group) => ({
            key: group.id,
            label: normalizeGroupTitle(group),
            depth: 0,
            childGroups: [],
            items: itemsByRootGroupId.get(group.id) ?? [],
            totalItemCount: (itemsByRootGroupId.get(group.id) ?? []).length,
            workspaceRootPath: typeof group.workspaceRootPath === 'string' ? group.workspaceRootPath : undefined,
            workspaceFolderKind: normalizeWorkspaceFolderKind(group.workspaceFolderKind)
          }))
        };

        pruneCollapsedGroupKeys(root);
        renderAttentionGroup(0, { showGroupPath: true });

        for (const rootGroup of root.childGroups) {
          renderGroupRow(groupRowOptionsFromTreeNode(rootGroup));
          if (state.collapsedGroupKeys.has(rootGroup.key)) {
            continue;
          }
          for (const item of sortItemsForFlat(rootGroup.items)) {
            renderNodeRow(item, 1, { rootGroupId: rootGroup.key });
          }
        }

        if (root.items.length > 0) {
          renderGroupRow({
            key: UNGROUPED_GROUP_KEY,
            label: '未分组',
            depth: 0,
            totalItemCount: root.items.length
          });
          if (!state.collapsedGroupKeys.has(UNGROUPED_GROUP_KEY)) {
            for (const item of sortItemsForFlat(root.items)) {
              renderNodeRow(item, 1);
            }
          }
        }
      }

      function render() {
        if (!state.selectedId || !state.items.some((item) => item.id === state.selectedId)) {
          const preferredItem = getPreferredInitialItem();
          state.selectedId = preferredItem ? preferredItem.id : undefined;
        }

        list.replaceChildren();
        list.setAttribute('role', isTreeRenderMode() ? 'tree' : 'listbox');
        list.setAttribute('aria-label', isTreeRenderMode() ? '当前画布节点分组树' : '当前画布节点列表');

        if (state.viewMode === 'grouped') {
          renderGroupedTree();
        } else if (shouldRenderFlatRootGroups()) {
          renderFlatRootGroups();
        } else {
          for (const item of getFlatRenderedItems()) {
            renderNodeRow(item, 0);
          }
        }

        if (state.items.length === 0 && state.groups.length === 0) {
          emptyState.textContent = '当前画布还没有可定位的非文件节点。';
          emptyState.classList.add('is-visible');
          return;
        }

        emptyState.textContent = '';
        emptyState.classList.remove('is-visible');
        syncRenderedSelection();
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
        state.groups = Array.isArray(message.payload.groups) ? message.payload.groups : [];
        state.viewMode = normalizeViewMode(message.payload.viewMode);
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
