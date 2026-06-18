import type { SerializedTerminalState } from './serializedTerminalState';
import type {
  ExecutionTerminalFileLinkCandidate,
  ExecutionTerminalDroppedResource,
  ExecutionTerminalFileLinkSource,
  ExecutionTerminalFileLinkResolvePriority,
  ExecutionTerminalOpenLink,
  ExecutionTerminalResolvedFileLink
} from './executionTerminalLinks';
import type { NoteContentSource } from './noteMarkdownFileAssociation';

export type CanvasNodeKind = 'agent' | 'terminal' | 'note' | 'file' | 'file-list';
export type CanvasCreatableNodeKind = 'agent' | 'terminal' | 'note';
export type CanvasGroupDeleteMode = 'delete-members' | 'keep-members';
export type ExecutionNodeKind = 'agent' | 'terminal';
export const EXECUTION_PERFORMANCE_DIAGNOSTICS_SCHEMA_VERSION = 10;
export const NOTE_EMBEDDED_CONTENT_MAX_LENGTH = 8000;
export type CanvasEdgeAnchor = 'top' | 'right' | 'bottom' | 'left';
export type CanvasEdgeArrowMode = 'none' | 'forward' | 'both';
export type CanvasEdgeOwner = 'user' | 'file-activity';
export const canvasEdgePresetColors = ['1', '2', '3', '4', '5', '6'] as const;
export type CanvasEdgePresetColor = (typeof canvasEdgePresetColors)[number];
export type CanvasEdgeColor = CanvasEdgePresetColor | `#${string}`;
export type CanvasFileActivityAccessMode = 'read' | 'write' | 'read-write';
export type CanvasFilePresentationMode = 'nodes' | 'lists';
export type CanvasFileNodeDisplayStyle = 'card' | 'minimal';
export type CanvasFileNodeDisplayMode = 'icon-path' | 'icon-only' | 'path-only';
export type CanvasFilePathDisplayMode = 'basename' | 'relative-path';
export const canvasLinkOpenModes = ['editorPreview', 'externalBrowser'] as const;
export type CanvasLinkOpenMode = (typeof canvasLinkOpenModes)[number];
export const canvasOverviewModes = ['none', 'title'] as const;
export type CanvasOverviewMode = (typeof canvasOverviewModes)[number];
export const canvasMultiRootPresentationModes = ['rootGroups', 'paneGallery'] as const;
export type CanvasMultiRootPresentationMode = (typeof canvasMultiRootPresentationModes)[number];
export const DEFAULT_CANVAS_OVERVIEW_ZOOM_THRESHOLD = 0.2;
export const canvasAttentionNotificationBridgeModes = ['none', 'workbench', 'system'] as const;
export type CanvasAttentionNotificationBridgeMode =
  (typeof canvasAttentionNotificationBridgeModes)[number];
export const canvasStrongTerminalAttentionReminderModes = ['none', 'titleBar', 'minimap', 'both'] as const;
export type CanvasStrongTerminalAttentionReminderMode =
  (typeof canvasStrongTerminalAttentionReminderModes)[number];
export type CanvasAgentAbnormalOutputTextNotificationMode = 'off' | 'codex';

export function isCanvasAttentionNotificationBridgeMode(
  value: unknown
): value is CanvasAttentionNotificationBridgeMode {
  return value === 'none' || value === 'workbench' || value === 'system';
}

export function normalizeCanvasAttentionNotificationBridgeMode(
  value: unknown
): CanvasAttentionNotificationBridgeMode {
  if (isCanvasAttentionNotificationBridgeMode(value)) {
    return value;
  }

  if (value === false) {
    return 'none';
  }

  if (value === true) {
    return 'workbench';
  }

  return 'system';
}

export function isCanvasOverviewMode(value: unknown): value is CanvasOverviewMode {
  return value === 'none' || value === 'title';
}

export function normalizeCanvasOverviewMode(value: unknown): CanvasOverviewMode {
  return isCanvasOverviewMode(value) ? value : 'title';
}

export function isCanvasMultiRootPresentationMode(value: unknown): value is CanvasMultiRootPresentationMode {
  return value === 'rootGroups' || value === 'paneGallery';
}

export function normalizeCanvasMultiRootPresentationMode(value: unknown): CanvasMultiRootPresentationMode {
  return isCanvasMultiRootPresentationMode(value) ? value : 'rootGroups';
}

export function isCanvasLinkOpenMode(value: unknown): value is CanvasLinkOpenMode {
  return value === 'editorPreview' || value === 'externalBrowser';
}

export function normalizeCanvasLinkOpenMode(value: unknown): CanvasLinkOpenMode {
  return isCanvasLinkOpenMode(value) ? value : 'editorPreview';
}

export function normalizeCanvasOverviewZoomThreshold(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_CANVAS_OVERVIEW_ZOOM_THRESHOLD;
  }

  return Math.min(1, Math.max(0, value));
}

export function isCanvasStrongTerminalAttentionReminderMode(
  value: unknown
): value is CanvasStrongTerminalAttentionReminderMode {
  return value === 'none' || value === 'titleBar' || value === 'minimap' || value === 'both';
}

export function normalizeCanvasStrongTerminalAttentionReminderMode(
  value: unknown
): CanvasStrongTerminalAttentionReminderMode {
  if (isCanvasStrongTerminalAttentionReminderMode(value)) {
    return value;
  }

  if (value === false) {
    return 'none';
  }

  if (value === true) {
    return 'both';
  }

  return 'both';
}

export function normalizeCanvasAgentAbnormalOutputTextNotificationMode(
  value: unknown
): CanvasAgentAbnormalOutputTextNotificationMode {
  return value === 'codex' ? 'codex' : 'off';
}

export function strongTerminalAttentionReminderShowsTitleBar(
  mode: CanvasStrongTerminalAttentionReminderMode
): boolean {
  return mode === 'titleBar' || mode === 'both';
}

export function strongTerminalAttentionReminderPulsesMinimap(
  mode: CanvasStrongTerminalAttentionReminderMode
): boolean {
  return mode === 'minimap' || mode === 'both';
}

export interface CanvasNodePosition {
  x: number;
  y: number;
}

export interface CanvasNodeFootprint {
  width: number;
  height: number;
}

export type CanvasGroupRole = 'user' | 'workspace-root';

export interface CanvasGroupSummary {
  id: string;
  title: string;
  position: CanvasNodePosition;
  size: CanvasNodeFootprint;
  parentGroupId?: string;
  role?: CanvasGroupRole;
  workspaceRootPath?: string;
}

export type TerminalBackendKind = 'node-pty';
export type AgentProviderKind = 'codex' | 'claude';
export type AgentLaunchPresetKind = 'default' | 'resume' | 'yolo' | 'sandbox' | 'custom';
export type WebviewClipboardTextSource = 'note-markdown-subtitle' | 'note-markdown-metadata';
export type PendingExecutionLaunch = 'start' | 'resume';
export type RuntimePersistenceMode = 'snapshot-only' | 'live-runtime';
export type RuntimeAttachmentState = 'attached-live' | 'reattaching' | 'history-restored';
export type RuntimeHostBackendKind = 'systemd-user' | 'legacy-detached';
export type RuntimePersistenceGuarantee = 'strong' | 'best-effort';
export type TerminalNodeStatus =
  | 'idle'
  | 'launching'
  | 'live'
  | 'stopping'
  | 'closed'
  | 'error'
  | 'interrupted';
export type AgentNodeStatus =
  | 'idle'
  | 'starting'
  | 'waiting-input'
  | 'running'
  | 'resuming'
  | 'resume-ready'
  | 'resume-failed'
  /** @deprecated Legacy Claude Ctrl-Z state. New Claude Agent sessions block Ctrl-Z instead. */
  | 'suspended'
  | 'stopping'
  | 'stopped'
  | 'error'
  | 'interrupted';
export type AgentRuntimeKind = 'pty-cli';
export type AgentResumeStrategy = 'none' | 'claude-session-id' | 'codex-session-id' | 'fake-provider';
export type ExecutionTerminalClipboardDiagnosticSource =
  | 'environment'
  | 'shortcut'
  | 'selectionChange'
  | 'mouseTrackingMode'
  | 'mouseSelection'
  | 'contextMenu'
  | 'osc52'
  | 'restoreSuppressed';
export interface ExecutionTerminalClipboardDiagnosticPayload {
  nodeId: string;
  kind: ExecutionNodeKind;
  source: ExecutionTerminalClipboardDiagnosticSource;
  detail?: Record<string, unknown>;
}

export interface ExecutionSessionMetadata {
  backend: TerminalBackendKind;
  shellPath: string;
  cwd: string;
  outputSequence?: number;
  persistenceMode: RuntimePersistenceMode;
  attachmentState: RuntimeAttachmentState;
  runtimeBackend?: RuntimeHostBackendKind;
  runtimeGuarantee?: RuntimePersistenceGuarantee;
  runtimeStoragePath?: string;
  liveSession: boolean;
  runtimeSessionId?: string;
  lastRuntimeError?: string;
  pendingLaunch?: PendingExecutionLaunch;
  recentOutput?: string;
  lastExitCode?: number;
  lastExitSignal?: string;
  lastExitMessage?: string;
  lastCols?: number;
  lastRows?: number;
  serializedTerminalState?: SerializedTerminalState;
  attentionPending: boolean;
}

export interface AgentNodeMetadata extends ExecutionSessionMetadata {
  lifecycle: AgentNodeStatus;
  provider: AgentProviderKind;
  launchPreset: AgentLaunchPresetKind;
  customLaunchCommand?: string;
  templateArgv?: string[];
  lastLaunchCommandLine?: string;
  runtimeKind: AgentRuntimeKind;
  resumeSupported: boolean;
  resumeStrategy: AgentResumeStrategy;
  resumeSessionId?: string;
  resumeStoragePath?: string;
  lastResumeError?: string;
  lastBackendLabel?: string;
  /** @deprecated Legacy Claude Ctrl-Z state metadata. New Claude Agent sessions block Ctrl-Z instead. */
  preSuspendLifecycle?: AgentNodeStatus;
  /** @deprecated Legacy Claude Ctrl-Z state metadata. New Claude Agent sessions block Ctrl-Z instead. */
  lastSuspendReason?: 'claude-ctrl-z';
  /** @deprecated Legacy Claude Ctrl-Z state metadata. New Claude Agent sessions block Ctrl-Z instead. */
  lastSuspendMessage?: string;
  /** @deprecated Legacy Claude Ctrl-Z state metadata. New Claude Agent sessions no longer reactivate. */
  lastReactivateError?: string;
}

export interface TerminalNodeMetadata extends ExecutionSessionMetadata {
  lifecycle: TerminalNodeStatus;
}

export interface NoteNodeMetadata {
  content: string;
  contentSource?: NoteContentSource;
}

export interface CanvasFileIconFontFace {
  fontFamily: string;
  src: string;
  format?: string;
  fontWeight?: string;
  fontStyle?: string;
}

export type CanvasFileIconDescriptor =
  | {
      kind: 'codicon';
      id: string;
    }
  | {
      kind: 'image';
      src: string;
    }
  | {
      kind: 'font';
      fontFamily: string;
      character: string;
      color?: string;
    };

export interface FileNodeMetadata {
  fileId: string;
  filePath: string;
  relativePath?: string;
  icon?: CanvasFileIconDescriptor;
  ownerNodeIds: string[];
}

export interface FileListNodeEntrySummary {
  fileId: string;
  filePath: string;
  relativePath?: string;
  accessMode: CanvasFileActivityAccessMode;
  ownerNodeIds: string[];
  icon?: CanvasFileIconDescriptor;
}

export interface FileListNodeMetadata {
  scope: 'agent' | 'shared';
  ownerNodeId?: string;
  entries: FileListNodeEntrySummary[];
}

export interface CanvasNodeMetadata {
  agent?: AgentNodeMetadata;
  terminal?: TerminalNodeMetadata;
  note?: NoteNodeMetadata;
  file?: FileNodeMetadata;
  fileList?: FileListNodeMetadata;
}

export interface CanvasNodeSummary {
  id: string;
  kind: CanvasNodeKind;
  title: string;
  status: string;
  summary: string;
  position: CanvasNodePosition;
  size: CanvasNodeFootprint;
  groupId?: string;
  metadata?: CanvasNodeMetadata;
}

export interface CanvasEdgeSummary {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  sourceAnchor: CanvasEdgeAnchor;
  targetAnchor: CanvasEdgeAnchor;
  arrowMode: CanvasEdgeArrowMode;
  owner: CanvasEdgeOwner;
  color?: CanvasEdgeColor;
  label?: string;
}

export interface CanvasFileReferenceOwnerSummary {
  nodeId: string;
  accessMode: CanvasFileActivityAccessMode;
  updatedAt: string;
}

export interface CanvasFileReferenceSummary {
  id: string;
  filePath: string;
  relativePath?: string;
  updatedAt: string;
  owners: CanvasFileReferenceOwnerSummary[];
}

export interface CanvasPrototypeState {
  version: 1;
  updatedAt: string;
  nodes: CanvasNodeSummary[];
  edges: CanvasEdgeSummary[];
  groups: CanvasGroupSummary[];
  nextGroupSequence: number;
  fileReferences: CanvasFileReferenceSummary[];
  suppressedFileActivityEdgeIds: string[];
  suppressedAutomaticFileArtifactNodeIds: string[];
}

export interface AgentProviderLaunchDefaults {
  command: string;
  defaultArgs: string;
}

export interface AgentLaunchDefaultsByProvider {
  codex: AgentProviderLaunchDefaults;
  claude: AgentProviderLaunchDefaults;
}

export type CanvasSurfaceLocation = 'editor' | 'panel';
export type CanvasSurfaceMode = 'active' | 'standby';

export interface WebviewLifecycleIdentity {
  surface: CanvasSurfaceLocation;
  mode: CanvasSurfaceMode;
  generation: number;
  frameId?: string;
}

interface WebviewLifecycleEnvelope {
  lifecycle?: WebviewLifecycleIdentity;
}

export interface NoteMarkdownImageWorkspaceRoot {
  name: string;
  webviewResourceBaseUri: string;
}

export interface CanvasRuntimeWorkspaceFolder {
  name: string;
  path: string;
}

export interface CanvasRuntimeContext {
  workspaceTrusted: boolean;
  surfaceLocation: CanvasSurfaceLocation;
  workspaceFolders: CanvasRuntimeWorkspaceFolder[];
  defaultAgentProvider: AgentProviderKind;
  agentLaunchDefaults: AgentLaunchDefaultsByProvider;
  strongTerminalAttentionReminderMode: CanvasStrongTerminalAttentionReminderMode;
  terminalScrollback: number;
  editorMultiCursorModifier: 'ctrlCmd' | 'alt';
  terminalWordSeparators: string;
  overviewMode: CanvasOverviewMode;
  overviewZoomThreshold: number;
  multiRootPresentationMode: CanvasMultiRootPresentationMode;
  workspaceRootWatermarksEnabled: boolean;
  filePresentationMode: CanvasFilePresentationMode;
  fileNodeDisplayStyle: CanvasFileNodeDisplayStyle;
  fileNodeDisplayMode: CanvasFileNodeDisplayMode;
  filePathDisplayMode: CanvasFilePathDisplayMode;
  fileIconFontFaces: CanvasFileIconFontFace[];
  noteMarkdownImageWorkspaceRoots?: NoteMarkdownImageWorkspaceRoot[];
}

export interface CanvasTemplateMenuEntry {
  templateId: string;
  name: string;
  category: 'builtin' | 'user';
  statsLabel: string;
  isDefault: boolean;
}

export interface WebviewProbeNodeSnapshot {
  nodeId: string;
  kind: CanvasNodeKind;
  chromeTitle: string | null;
  chromeContext?: string | null;
  chromeSubtitle: string | null;
  statusText: string | null;
  attentionIndicatorVisible: boolean;
  attentionIndicatorFlashing: boolean;
  minimapVisible: boolean;
  minimapAttentionFlashing: boolean;
  minimapAttentionSizePulsing: boolean;
  selected: boolean;
  renderedWidth: number;
  renderedHeight: number;
  overlayTitle?: string;
  overlayMessage?: string;
  titleInputValue?: string;
  bodyValue?: string;
  terminalSelectionText?: string;
  terminalCols?: number;
  terminalRows?: number;
  terminalViewportY?: number;
  terminalVisibleLines?: string[];
  terminalTextareaLeft?: number;
  terminalTextareaTop?: number;
  terminalMouseTrackingMode?: 'none' | 'x10' | 'vt200' | 'drag' | 'any';
  terminalBufferType?: 'normal' | 'alternate';
  terminalHasFocus?: boolean;
  terminalTheme?: WebviewProbeTerminalThemeSnapshot;
}

export interface WebviewProbeTerminalThemeSnapshot {
  background?: string;
  foreground?: string;
  cursor?: string;
  selectionBackground?: string;
  ansiBlue?: string;
  ansiBrightWhite?: string;
}

export interface WebviewProbeSnapshot {
  documentTitle: string;
  hasDocumentFocus: boolean;
  hasCanvasShell: boolean;
  hasReactFlow: boolean;
  toastMessage: string | null;
  executionLinkTooltipText: string | null;
  nodeCount: number;
  nodes: WebviewProbeNodeSnapshot[];
  edgeCount: number;
  edges: WebviewProbeEdgeSnapshot[];
}

export interface WebviewProbeEdgeSnapshot {
  edgeId: string;
  sourceNodeId: string;
  targetNodeId: string;
  arrowMode: CanvasEdgeArrowMode;
  owner: CanvasEdgeOwner;
  color: string | null;
  label: string | null;
  selected: boolean;
}

export type ExecutionPerformanceDiagnosticSource =
  | 'webview-output-enqueue'
  | 'webview-terminal-drain'
  | 'webview-terminal-write'
  | 'webview-snapshot-restore-queue'
  | 'webview-output-snapshot-reset'
  | 'webview-input-dispatch'
  | 'webview-input-ack'
  | 'webview-main-thread-lag'
  | 'host-event-loop-lag'
  | 'host-input-received'
  | 'host-input-write'
  | 'host-output-chunk'
  | 'host-output-scheduler'
  | 'host-output-post'
  | 'host-state-persist';

export type ExecutionPerformanceDiagnosticOwner = 'local' | 'supervisor';

export interface ExecutionPerformanceDiagnosticPayload {
  source: ExecutionPerformanceDiagnosticSource;
  nodeId?: string;
  kind?: ExecutionNodeKind;
  reason?: string;
  sequence?: number;
  durationMs?: number;
  webviewEpochMs?: number;
  hostReceivedEpochMs?: number;
  hostAckEpochMs?: number;
  hostAckPostEpochMs?: number;
  queueDelayMs?: number;
  requestId?: string;
  executionSessionId?: string;
  characters?: number;
  bytes?: number;
  controllerCount?: number;
  flushedControllerCount?: number;
  pendingControllerCount?: number;
  queuedSnapshotCount?: number;
  queuedWriteCount?: number;
  bufferLength?: number;
  pendingOutputLength?: number;
  owner?: ExecutionPerformanceDiagnosticOwner;
  lifecycleStatus?: string;
  workspaceStateMode?: string;
  success?: boolean;
}

export type WebviewDomAction =
  | {
      kind: 'selectNode';
      nodeId: string;
      delayMs?: number;
    }
  | {
      kind: 'setNodeTextField';
      nodeId: string;
      field: 'title' | 'body';
      value: string;
      delayMs?: number;
    }
  | {
      kind: 'clickNodeActionButton';
      nodeId: string;
      label:
        | '删除'
        | '启动'
        | '停止'
        | '新建'
        | '重启'
        | '恢复'
        | '重新加载'
        | '复制草稿'
        | '覆盖文件'
        | '创建空文件并关联';
      delayMs?: number;
    }
  | {
      kind: 'scrollTerminalViewport';
      nodeId: string;
      lines: number;
      delayMs?: number;
    }
  | {
      kind: 'sendExecutionInput';
      nodeId: string;
      data: string;
      delayMs?: number;
    }
  | {
      kind: 'dropExecutionResources';
      nodeId: string;
      source: 'resourceUrls' | 'codeFiles' | 'uriList';
      values: string[];
      delayMs?: number;
    }
  | {
      kind: 'activateExecutionLink';
      nodeId: string;
      text: string;
      delayMs?: number;
    }
  | {
      kind: 'hoverExecutionLink';
      nodeId: string;
      text: string;
      delayMs?: number;
    }
  | {
      kind: 'hoverExecutionText';
      nodeId: string;
      text: string;
      delayMs?: number;
    }
  | {
      kind: 'clearExecutionLinkHover';
      nodeId: string;
      delayMs?: number;
    }
  | {
      kind: 'selectEdge';
      nodeId: string;
      edgeId: string;
      delayMs?: number;
    }
  | {
      kind: 'clickFileEntry';
      nodeId: string;
      filePath: string;
      delayMs?: number;
    }
  | {
      kind: 'toggleNoteChecklistItem';
      nodeId: string;
      lineNumber: number;
      delayMs?: number;
    }
  | {
      kind: 'doubleClickNotePreviewText';
      nodeId: string;
      text: string;
      offset?: number;
      delayMs?: number;
    }
  | {
      kind: 'doubleClickNotePreviewSelector';
      nodeId: string;
      selector: string;
      delayMs?: number;
    };

export type WebviewToHostMessage = WebviewLifecycleEnvelope & (
  | {
      type: 'webview/ready';
    }
  | {
      type: 'webview/bootstrapAck';
    }
  | {
      type: 'webview/updateViewportCenter';
      payload: {
        visibleCenter: CanvasNodePosition;
      };
    }
  | {
      type: 'webview/selectNode';
      payload: {
        nodeId: string;
      };
    }
  | {
      type: 'webview/arrangeCanvasLayout';
    }
  | {
      type: 'webview/createDemoNode';
      payload: {
        requestId?: string;
        kind: CanvasCreatableNodeKind;
        preferredPosition?: CanvasNodePosition;
        targetGroupId?: string;
        cwd?: string;
        agentProvider?: AgentProviderKind;
        agentLaunchPreset?: AgentLaunchPresetKind;
        agentCustomLaunchCommand?: string;
      };
    }
  | {
      type: 'webview/showCreateNodeBlockedReason';
      payload: {
        kind: CanvasCreatableNodeKind;
      };
    }
  | {
      type: 'webview/createEmptyGroup';
      payload: {
        position: CanvasNodePosition;
        size?: CanvasNodeFootprint;
        parentGroupId?: string;
      };
    }
  | {
      type: 'webview/createGroupFromSelection';
      payload: {
        nodeIds: string[];
        groupIds: string[];
        parentGroupId?: string;
      };
    }
  | {
      type: 'webview/updateGroupTitle';
      payload: {
        groupId: string;
        title: string;
      };
    }
  | {
      type: 'webview/moveGroup';
      payload: {
        groupId: string;
        position: CanvasNodePosition;
        pointerPosition?: CanvasNodePosition;
      };
    }
  | {
      type: 'webview/resizeGroup';
      payload: {
        groupId: string;
        position: CanvasNodePosition;
        size: CanvasNodeFootprint;
      };
    }
  | {
      type: 'webview/deleteGroup';
      payload: {
        groupId: string;
      };
    }
  | {
      type: 'webview/ungroup';
      payload: {
        groupId: string;
      };
    }
  | {
      type: 'webview/moveNode';
      payload: {
        id: string;
        position: CanvasNodePosition;
        pointerPosition?: CanvasNodePosition;
        selectedMoves?: Array<{
          id: string;
          position: CanvasNodePosition;
          pointerPosition?: CanvasNodePosition;
        }>;
      };
    }
  | {
      type: 'webview/resizeNode';
      payload: {
        nodeId: string;
        position: CanvasNodePosition;
        size: CanvasNodeFootprint;
      };
    }
  | {
      type: 'webview/deleteNode';
      payload: {
        nodeId: string;
      };
    }
  | {
      type: 'webview/resetDemoState';
    }
  | {
      type: 'webview/applyDefaultTemplate';
      payload?: {
        visibleCenter?: CanvasNodePosition;
        targetGroupId?: string;
      };
    }
  | {
      type: 'webview/applyTemplate';
      payload: {
        templateId: string;
        visibleCenter?: CanvasNodePosition;
        targetGroupId?: string;
      };
    }
  | {
      type: 'webview/resetToDefaultTemplate';
      payload?: {
        visibleCenter?: CanvasNodePosition;
        targetGroupId?: string;
      };
    }
  | {
      type: 'webview/resetToTemplate';
      payload: {
        templateId: string;
        visibleCenter?: CanvasNodePosition;
        targetGroupId?: string;
      };
    }
  | {
      type: 'webview/saveCanvasAsTemplate';
    }
  | {
      type: 'webview/startExecutionSession';
      payload: {
        nodeId: string;
        kind: ExecutionNodeKind;
        cols: number;
        rows: number;
        provider?: AgentProviderKind;
        resume?: boolean;
      };
    }
  | {
      type: 'webview/branchAgentSession';
      payload: {
        nodeId: string;
      };
    }
  | {
      type: 'webview/attachExecutionSession';
      payload: {
        nodeId: string;
        kind: ExecutionNodeKind;
        requestId?: string;
        executionSessionId?: string;
        minOutputSequence?: number;
      };
    }
  | {
      type: 'webview/executionInput';
      payload: {
        nodeId: string;
        kind: ExecutionNodeKind;
        data: string;
        sequence?: number;
        webviewEpochMs?: number;
        webviewPerformanceNowMs?: number;
      };
    }
  | {
      type: 'webview/copyExecutionSelection';
      payload: {
        nodeId: string;
        kind: ExecutionNodeKind;
        text: string;
        clearSelectionAfterCopy?: boolean;
      };
    }
  | {
      type: 'webview/copyTextToClipboard';
      payload: {
        text: string;
        source: WebviewClipboardTextSource;
        nodeId?: string;
      };
    }
  | {
      type: 'webview/requestExecutionPaste';
      payload: {
        requestId: string;
        nodeId: string;
        kind: ExecutionNodeKind;
        bracketedPasteMode: boolean;
      };
    }
  | {
      type: 'webview/dropExecutionResource';
      payload: {
        nodeId: string;
        kind: ExecutionNodeKind;
        resource: ExecutionTerminalDroppedResource;
      };
    }
  | {
      type: 'webview/openExecutionLink';
      payload: {
        nodeId: string;
        kind: ExecutionNodeKind;
        link: ExecutionTerminalOpenLink;
      };
    }
  | {
      type: 'webview/resolveExecutionFileLinks';
      payload: {
        requestId: string;
        nodeId: string;
        kind: ExecutionNodeKind;
        candidates: ExecutionTerminalFileLinkCandidate[];
        priority?: ExecutionTerminalFileLinkResolvePriority;
      };
    }
  | {
      type: 'webview/resizeExecutionSession';
      payload: {
        nodeId: string;
        kind: ExecutionNodeKind;
        cols: number;
        rows: number;
      };
    }
  | {
      type: 'webview/stopExecutionSession';
      payload: {
        nodeId: string;
        kind: ExecutionNodeKind;
      };
    }
  | {
      type: 'webview/updateNodeTitle';
      payload: {
        nodeId: string;
        title: string;
      };
    }
  | {
      type: 'webview/updateNoteNode';
      payload: {
        nodeId: string;
        content: string;
        baseContentRevision?: string;
        force?: boolean;
      };
    }
  | {
      type: 'webview/beginAssociatedNoteMarkdownEdit';
      payload: {
        nodeId: string;
        content: string;
        baseContentRevision?: string;
      };
    }
  | {
      type: 'webview/endAssociatedNoteMarkdownEdit';
      payload: {
        nodeId: string;
      };
    }
  | {
      type: 'webview/updateAssociatedNoteMarkdownDraft';
      payload: {
        nodeId: string;
        content: string;
        baseContentRevision?: string;
      };
    }
  | {
      type: 'webview/clearAssociatedNoteMarkdownDraft';
      payload: {
        nodeId: string;
      };
    }
  | {
      type: 'webview/copyAssociatedNoteMarkdownDraft';
      payload: {
        nodeId: string;
        content: string;
      };
    }
  | {
      type: 'webview/saveNoteAsMarkdownFile';
      payload: {
        nodeId: string;
      };
    }
  | {
      type: 'webview/openAssociatedNoteMarkdownFile';
      payload: {
        nodeId: string;
      };
    }
  | {
      type: 'webview/reloadAssociatedNoteMarkdownFile';
      payload: {
        nodeId: string;
      };
    }
  | {
      type: 'webview/createMissingAssociatedNoteMarkdownFile';
      payload: {
        nodeId: string;
      };
    }
  | {
      type: 'webview/dropNoteMarkdownFiles';
      payload: {
        resources: ExecutionTerminalDroppedResource[];
        position: CanvasNodePosition;
        targetGroupId?: string;
      };
    }
  | {
      type: 'webview/createEdge';
      payload: {
        sourceNodeId: string;
        targetNodeId: string;
        sourceAnchor: CanvasEdgeAnchor;
        targetAnchor: CanvasEdgeAnchor;
      };
    }
  | {
      type: 'webview/updateEdge';
      payload: {
        edgeId: string;
        sourceNodeId?: string;
        targetNodeId?: string;
        sourceAnchor?: CanvasEdgeAnchor;
        targetAnchor?: CanvasEdgeAnchor;
        arrowMode?: CanvasEdgeArrowMode;
        color?: CanvasEdgeColor | null;
        label?: string;
      };
    }
  | {
      type: 'webview/deleteEdge';
      payload: {
        edgeId: string;
      };
    }
  | {
      type: 'webview/openCanvasFile';
      payload: {
        nodeId: string;
        filePath: string;
      };
    }
  | {
      type: 'webview/openNoteLink';
      payload: {
        nodeId: string;
        href: string;
      };
    }
  | {
      type: 'webview/runtimeDiagnostic';
      payload: {
        source: 'window.error' | 'window.unhandledrejection' | 'webview.lifecycle';
        message: string;
        stack?: string;
        filename?: string;
        line?: number;
        column?: number;
        readyState?: 'loading' | 'interactive' | 'complete';
      };
    }
  | {
      type: 'webview/executionPerformanceDiagnostic';
      payload: ExecutionPerformanceDiagnosticPayload;
    }
  | {
      type: 'webview/executionClipboardDiagnostic';
      payload: ExecutionTerminalClipboardDiagnosticPayload;
    }
  | {
      type: 'webview/testProbeResult';
      payload: {
        requestId: string;
        snapshot: WebviewProbeSnapshot;
      };
    }
  | {
      type: 'webview/testDomActionResult';
      payload: {
        requestId: string;
        ok: boolean;
        errorMessage?: string;
      };
    }
);

export type HostToWebviewMessage = WebviewLifecycleEnvelope & (
  | {
      type: 'host/bootstrap';
      payload: {
        state: CanvasPrototypeState;
        runtime: CanvasRuntimeContext;
      };
    }
  | {
      type: 'host/stateUpdated';
      payload: {
        state: CanvasPrototypeState;
        runtime: CanvasRuntimeContext;
      };
    }
  | {
      type: 'host/templateCatalogUpdated';
      payload: {
        templates: CanvasTemplateMenuEntry[];
      };
    }
  | {
      type: 'host/themeChanged';
    }
  | {
      type: 'host/visibilityRestored';
      payload?: {
        restoreFocus?: boolean;
      };
    }
  | {
      type: 'host/focusNode';
      payload: {
        nodeId: string;
      };
    }
  | {
      type: 'host/centerNode';
      payload: {
        nodeId: string;
      };
    }
  | {
      type: 'host/focusNodes';
      payload: {
        nodeIds: string[];
      };
    }
  | {
      type: 'host/focusGroup';
      payload: {
        groupId: string;
      };
    }
  | {
      type: 'host/error';
      payload: {
        message: string;
        createRequestId?: string;
      };
    }
  | {
      type: 'host/executionInputAck';
      payload: {
        nodeId: string;
        kind: ExecutionNodeKind;
        sequence?: number;
        webviewEpochMs?: number;
        webviewPerformanceNowMs?: number;
        hostReceivedEpochMs: number;
        hostAckEpochMs: number;
        hostAckPostEpochMs?: number;
        queueDelayMs?: number;
        controllerCount?: number;
        pendingControllerCount?: number;
        queuedWriteCount?: number;
        pendingOutputLength?: number;
      };
    }
  | {
      type: 'host/executionSnapshot';
      payload: {
        nodeId: string;
        kind: ExecutionNodeKind;
        requestId?: string;
        executionSessionId?: string;
        output: string;
        cols: number;
        rows: number;
        liveSession: boolean;
        outputSequence?: number;
        serializedTerminalState?: SerializedTerminalState;
      };
    }
  | {
      type: 'host/executionOutput';
      payload: {
        nodeId: string;
        kind: ExecutionNodeKind;
        executionSessionId?: string;
        chunk: string;
        persisted?: boolean;
        outputSequence?: number;
      };
    }
  | {
      type: 'host/executionExit';
      payload: {
        nodeId: string;
        kind: ExecutionNodeKind;
        message: string;
      };
    }
  | {
      type: 'host/executionFileLinksResolved';
      payload: {
        requestId: string;
        nodeId: string;
        kind: ExecutionNodeKind;
        resolvedLinks: ExecutionTerminalResolvedFileLink[];
      };
    }
  | {
      type: 'host/executionPasteText';
      payload: {
        requestId: string;
        nodeId: string;
        kind: ExecutionNodeKind;
        text: string;
      };
    }
  | {
      type: 'host/executionPasteCancelled';
      payload: {
        requestId: string;
        nodeId: string;
        kind: ExecutionNodeKind;
      };
    }
  | {
      type: 'host/requestCreateNode';
      payload: {
        kind: CanvasCreatableNodeKind;
        cwd?: string;
        targetGroupId?: string;
        agentProvider?: AgentProviderKind;
        agentLaunchPreset?: AgentLaunchPresetKind;
        agentCustomLaunchCommand?: string;
      };
    }
  | {
      type: 'host/requestCreateGroupFromSelection';
    }
  | {
      type: 'host/testProbeRequest';
      payload: {
        requestId: string;
        delayMs?: number;
      };
    }
  | {
      type: 'host/testDomAction';
      payload: {
        requestId: string;
        action: WebviewDomAction;
      };
    }
);

const canvasSurfaceLocations: CanvasSurfaceLocation[] = ['editor', 'panel'];
const canvasSurfaceModes: CanvasSurfaceMode[] = ['active', 'standby'];
const canvasNodeKinds: CanvasNodeKind[] = ['agent', 'terminal', 'note', 'file', 'file-list'];
const canvasCreatableNodeKinds: CanvasCreatableNodeKind[] = ['agent', 'terminal', 'note'];
const agentProviderKinds: AgentProviderKind[] = ['codex', 'claude'];
const agentLaunchPresetKinds: AgentLaunchPresetKind[] = ['default', 'resume', 'yolo', 'sandbox', 'custom'];
const webviewClipboardTextSources: WebviewClipboardTextSource[] = [
  'note-markdown-subtitle',
  'note-markdown-metadata'
];
const WEBVIEW_LIFECYCLE_FRAME_ID_MAX_LENGTH = 128;
const WEBVIEW_LIFECYCLE_FRAME_ID_PATTERN = /^[A-Za-z0-9._:-]+$/u;

export function isCanvasSurfaceLocation(value: unknown): value is CanvasSurfaceLocation {
  return typeof value === 'string' && canvasSurfaceLocations.includes(value as CanvasSurfaceLocation);
}

export function isCanvasSurfaceMode(value: unknown): value is CanvasSurfaceMode {
  return typeof value === 'string' && canvasSurfaceModes.includes(value as CanvasSurfaceMode);
}

export function extractWebviewMessageLifecycle(value: unknown): WebviewLifecycleIdentity | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const lifecycle = value.lifecycle;
  if (!isRecord(lifecycle)) {
    return undefined;
  }

  if (
    !isCanvasSurfaceLocation(lifecycle.surface) ||
    !isCanvasSurfaceMode(lifecycle.mode) ||
    !isWebviewLifecycleGeneration(lifecycle.generation) ||
    (lifecycle.frameId !== undefined && !isWebviewLifecycleFrameId(lifecycle.frameId))
  ) {
    return undefined;
  }

  return {
    surface: lifecycle.surface,
    mode: lifecycle.mode,
    generation: lifecycle.generation,
    frameId: typeof lifecycle.frameId === 'string' ? lifecycle.frameId : undefined
  };
}

function isWebviewLifecycleGeneration(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isWebviewLifecycleFrameId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= WEBVIEW_LIFECYCLE_FRAME_ID_MAX_LENGTH &&
    WEBVIEW_LIFECYCLE_FRAME_ID_PATTERN.test(value)
  );
}

export function isCanvasNodeKind(value: unknown): value is CanvasNodeKind {
  return typeof value === 'string' && canvasNodeKinds.includes(value as CanvasNodeKind);
}

export function isCanvasCreatableNodeKind(value: unknown): value is CanvasCreatableNodeKind {
  return (
    typeof value === 'string' &&
    canvasCreatableNodeKinds.includes(value as CanvasCreatableNodeKind)
  );
}

export function isAgentProviderKind(value: unknown): value is AgentProviderKind {
  return typeof value === 'string' && agentProviderKinds.includes(value as AgentProviderKind);
}

export function isAgentLaunchPresetKind(value: unknown): value is AgentLaunchPresetKind {
  return typeof value === 'string' && agentLaunchPresetKinds.includes(value as AgentLaunchPresetKind);
}

export function isExecutionNodeKind(value: unknown): value is ExecutionNodeKind {
  return value === 'agent' || value === 'terminal';
}

export function isWebviewClipboardTextSource(value: unknown): value is WebviewClipboardTextSource {
  return (
    typeof value === 'string' &&
    webviewClipboardTextSources.includes(value as WebviewClipboardTextSource)
  );
}

export function parseWebviewMessage(value: unknown): WebviewToHostMessage | null {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return null;
  }

  if (
    value.type === 'webview/ready' ||
    value.type === 'webview/bootstrapAck' ||
    value.type === 'webview/resetDemoState' ||
    value.type === 'webview/arrangeCanvasLayout' ||
    value.type === 'webview/saveCanvasAsTemplate'
  ) {
    return { type: value.type };
  }

  if (value.type === 'webview/updateViewportCenter') {
    const payload = isRecord(value.payload) ? value.payload : null;
    if (!payload || !isCanvasNodePosition(payload.visibleCenter)) {
      return null;
    }

    return {
      type: 'webview/updateViewportCenter',
      payload: {
        visibleCenter: payload.visibleCenter
      }
    };
  }

  if (value.type === 'webview/selectNode') {
    const payload = isRecord(value.payload) ? value.payload : null;
    if (!payload || typeof payload.nodeId !== 'string') {
      return null;
    }

    return {
      type: 'webview/selectNode',
      payload: {
        nodeId: payload.nodeId
      }
    };
  }

  if (value.type === 'webview/createEmptyGroup') {
    const payload = isRecord(value.payload) ? value.payload : null;
    if (!payload || !isCanvasNodePosition(payload.position)) {
      return null;
    }

    return {
      type: 'webview/createEmptyGroup',
      payload: {
        position: payload.position,
        size: isCanvasNodeFootprint(payload.size) ? payload.size : undefined,
        parentGroupId: typeof payload.parentGroupId === 'string' ? payload.parentGroupId : undefined
      }
    };
  }

  if (value.type === 'webview/createGroupFromSelection') {
    const payload = isRecord(value.payload) ? value.payload : null;
    if (!payload || !Array.isArray(payload.nodeIds) || !Array.isArray(payload.groupIds)) {
      return null;
    }

    return {
      type: 'webview/createGroupFromSelection',
      payload: {
        nodeIds: payload.nodeIds.filter((nodeId): nodeId is string => typeof nodeId === 'string'),
        groupIds: payload.groupIds.filter((groupId): groupId is string => typeof groupId === 'string'),
        parentGroupId: typeof payload.parentGroupId === 'string' ? payload.parentGroupId : undefined
      }
    };
  }

  if (value.type === 'webview/updateGroupTitle') {
    const payload = isRecord(value.payload) ? value.payload : null;
    if (!payload || typeof payload.groupId !== 'string' || typeof payload.title !== 'string') {
      return null;
    }

    return {
      type: 'webview/updateGroupTitle',
      payload: {
        groupId: payload.groupId,
        title: payload.title
      }
    };
  }

  if (value.type === 'webview/moveGroup') {
    const payload = isRecord(value.payload) ? value.payload : null;
    if (!payload || typeof payload.groupId !== 'string' || !isCanvasNodePosition(payload.position)) {
      return null;
    }

    return {
      type: 'webview/moveGroup',
      payload: {
        groupId: payload.groupId,
        position: payload.position,
        pointerPosition: isCanvasNodePosition(payload.pointerPosition) ? payload.pointerPosition : undefined
      }
    };
  }

  if (value.type === 'webview/resizeGroup') {
    const payload = isRecord(value.payload) ? value.payload : null;
    if (
      !payload ||
      typeof payload.groupId !== 'string' ||
      !isCanvasNodePosition(payload.position) ||
      !isCanvasNodeFootprint(payload.size)
    ) {
      return null;
    }

    return {
      type: 'webview/resizeGroup',
      payload: {
        groupId: payload.groupId,
        position: payload.position,
        size: payload.size
      }
    };
  }

  if (value.type === 'webview/deleteGroup' || value.type === 'webview/ungroup') {
    const payload = isRecord(value.payload) ? value.payload : null;
    if (!payload || typeof payload.groupId !== 'string') {
      return null;
    }

    return {
      type: value.type,
      payload: {
        groupId: payload.groupId
      }
    };
  }

  if (value.type === 'webview/applyDefaultTemplate' || value.type === 'webview/resetToDefaultTemplate') {
    const payload = isRecord(value.payload) ? value.payload : null;
    if (
      payload &&
      ((payload.visibleCenter !== undefined && !isCanvasNodePosition(payload.visibleCenter)) ||
        (payload.targetGroupId !== undefined && typeof payload.targetGroupId !== 'string'))
    ) {
      return null;
    }
    const visibleCenterValue = payload?.visibleCenter;
    const visibleCenter = isCanvasNodePosition(visibleCenterValue) ? visibleCenterValue : undefined;
    const targetGroupId = typeof payload?.targetGroupId === 'string' ? payload.targetGroupId : undefined;

    if (value.type === 'webview/applyDefaultTemplate') {
      return {
        type: 'webview/applyDefaultTemplate',
        payload: {
          visibleCenter,
          targetGroupId
        }
      };
    }

    return {
      type: 'webview/resetToDefaultTemplate',
      payload: {
        visibleCenter,
        targetGroupId
      }
    };
  }

  if (value.type === 'webview/applyTemplate' || value.type === 'webview/resetToTemplate') {
    const payload = isRecord(value.payload) ? value.payload : null;
    if (
      !payload ||
      typeof payload.templateId !== 'string' ||
      payload.templateId.trim().length === 0 ||
      (payload.visibleCenter !== undefined && !isCanvasNodePosition(payload.visibleCenter)) ||
      (payload.targetGroupId !== undefined && typeof payload.targetGroupId !== 'string')
    ) {
      return null;
    }

    const normalizedTemplateId = payload.templateId.trim();
    const visibleCenterValue = payload.visibleCenter;
    const visibleCenter = isCanvasNodePosition(visibleCenterValue) ? visibleCenterValue : undefined;
    const targetGroupId = typeof payload.targetGroupId === 'string' ? payload.targetGroupId : undefined;
    if (value.type === 'webview/applyTemplate') {
      return {
        type: 'webview/applyTemplate',
        payload: {
          templateId: normalizedTemplateId,
          visibleCenter,
          targetGroupId
        }
      };
    }

    return {
      type: 'webview/resetToTemplate',
      payload: {
        templateId: normalizedTemplateId,
        visibleCenter,
        targetGroupId
      }
    };
  }

  if (
    value.type === 'webview/attachExecutionSession' ||
    value.type === 'webview/stopExecutionSession'
  ) {
    const payload = isRecord(value.payload) ? value.payload : null;
    if (
      !payload ||
      typeof payload.nodeId !== 'string' ||
      !isExecutionNodeKind(payload.kind)
    ) {
      return null;
    }

    const minOutputSequence = normalizeNonNegativeInteger(payload.minOutputSequence);
    return {
      type: value.type,
      payload: {
        nodeId: payload.nodeId,
        kind: payload.kind,
        ...(value.type === 'webview/attachExecutionSession' && typeof payload.requestId === 'string'
          ? { requestId: payload.requestId }
          : {}),
        ...(value.type === 'webview/attachExecutionSession' && typeof payload.executionSessionId === 'string'
          ? { executionSessionId: payload.executionSessionId }
          : {}),
        ...(value.type === 'webview/attachExecutionSession' && minOutputSequence !== undefined
          ? { minOutputSequence }
          : {})
      }
    };
  }

  if (value.type === 'webview/startExecutionSession') {
    const payload = isRecord(value.payload) ? value.payload : null;
    if (
      !payload ||
      typeof payload.nodeId !== 'string' ||
      !isExecutionNodeKind(payload.kind) ||
      !isTerminalDimension(payload.cols) ||
      !isTerminalDimension(payload.rows) ||
      (payload.resume !== undefined && typeof payload.resume !== 'boolean')
    ) {
      return null;
    }

    if (
      payload.kind === 'agent' &&
      payload.provider !== undefined &&
      !isAgentProviderKind(payload.provider)
    ) {
      return null;
    }

    return {
      type: 'webview/startExecutionSession',
      payload: {
        nodeId: payload.nodeId,
        kind: payload.kind,
        cols: payload.cols,
        rows: payload.rows,
        resume: payload.resume === true,
        provider: payload.kind === 'agent' && isAgentProviderKind(payload.provider) ? payload.provider : undefined
      }
    };
  }

  if (value.type === 'webview/branchAgentSession') {
    const payload = isRecord(value.payload) ? value.payload : null;
    if (!payload || typeof payload.nodeId !== 'string') {
      return null;
    }

    return {
      type: 'webview/branchAgentSession',
      payload: {
        nodeId: payload.nodeId
      }
    };
  }

  if (value.type === 'webview/resizeExecutionSession') {
    const payload = isRecord(value.payload) ? value.payload : null;
    if (
      !payload ||
      typeof payload.nodeId !== 'string' ||
      !isExecutionNodeKind(payload.kind) ||
      !isTerminalDimension(payload.cols) ||
      !isTerminalDimension(payload.rows)
    ) {
      return null;
    }

    return {
      type: 'webview/resizeExecutionSession',
      payload: {
        nodeId: payload.nodeId,
        kind: payload.kind,
        cols: payload.cols,
        rows: payload.rows
      }
    };
  }

  if (value.type === 'webview/executionInput') {
    const payload = isRecord(value.payload) ? value.payload : null;
    if (
      !payload ||
      typeof payload.nodeId !== 'string' ||
      !isExecutionNodeKind(payload.kind) ||
      typeof payload.data !== 'string'
    ) {
      return null;
    }

    return {
      type: 'webview/executionInput',
      payload: {
        nodeId: payload.nodeId,
        kind: payload.kind,
        data: payload.data,
        sequence: normalizeNonNegativeInteger(payload.sequence),
        webviewEpochMs: normalizeNonNegativeFiniteNumber(payload.webviewEpochMs),
        webviewPerformanceNowMs: normalizeNonNegativeFiniteNumber(payload.webviewPerformanceNowMs)
      }
    };
  }

  if (value.type === 'webview/copyExecutionSelection') {
    const payload = isRecord(value.payload) ? value.payload : null;
    if (
      !payload ||
      typeof payload.nodeId !== 'string' ||
      !isExecutionNodeKind(payload.kind) ||
      typeof payload.text !== 'string' ||
      (payload.clearSelectionAfterCopy !== undefined && typeof payload.clearSelectionAfterCopy !== 'boolean')
    ) {
      return null;
    }

    return {
      type: 'webview/copyExecutionSelection',
      payload: {
        nodeId: payload.nodeId,
        kind: payload.kind,
        text: payload.text,
        clearSelectionAfterCopy: payload.clearSelectionAfterCopy === true
      }
    };
  }

  if (value.type === 'webview/copyTextToClipboard') {
    const payload = isRecord(value.payload) ? value.payload : null;
    if (
      !payload ||
      typeof payload.text !== 'string' ||
      !isWebviewClipboardTextSource(payload.source) ||
      (payload.nodeId !== undefined && typeof payload.nodeId !== 'string')
    ) {
      return null;
    }

    return {
      type: 'webview/copyTextToClipboard',
      payload: {
        text: payload.text,
        source: payload.source,
        nodeId: typeof payload.nodeId === 'string' ? payload.nodeId : undefined
      }
    };
  }

  if (value.type === 'webview/requestExecutionPaste') {
    const payload = isRecord(value.payload) ? value.payload : null;
    if (
      !payload ||
      typeof payload.requestId !== 'string' ||
      typeof payload.nodeId !== 'string' ||
      !isExecutionNodeKind(payload.kind) ||
      typeof payload.bracketedPasteMode !== 'boolean'
    ) {
      return null;
    }

    return {
      type: 'webview/requestExecutionPaste',
      payload: {
        requestId: payload.requestId,
        nodeId: payload.nodeId,
        kind: payload.kind,
        bracketedPasteMode: payload.bracketedPasteMode
      }
    };
  }

  if (value.type === 'webview/dropExecutionResource') {
    const payload = isRecord(value.payload) ? value.payload : null;
    if (
      !payload ||
      typeof payload.nodeId !== 'string' ||
      !isExecutionNodeKind(payload.kind) ||
      !isExecutionTerminalDroppedResource(payload.resource)
    ) {
      return null;
    }

    return {
      type: 'webview/dropExecutionResource',
      payload: {
        nodeId: payload.nodeId,
        kind: payload.kind,
        resource: payload.resource
      }
    };
  }

  if (value.type === 'webview/openExecutionLink') {
    const payload = isRecord(value.payload) ? value.payload : null;
    if (
      !payload ||
      typeof payload.nodeId !== 'string' ||
      !isExecutionNodeKind(payload.kind) ||
      !isExecutionTerminalOpenLink(payload.link)
    ) {
      return null;
    }

    return {
      type: 'webview/openExecutionLink',
      payload: {
        nodeId: payload.nodeId,
        kind: payload.kind,
        link: payload.link
      }
    };
  }

  if (value.type === 'webview/resolveExecutionFileLinks') {
    const payload = isRecord(value.payload) ? value.payload : null;
    if (
      !payload ||
      typeof payload.requestId !== 'string' ||
      typeof payload.nodeId !== 'string' ||
      !isExecutionNodeKind(payload.kind) ||
      !Array.isArray(payload.candidates) ||
      !payload.candidates.every((candidate) => isExecutionTerminalFileLinkCandidate(candidate)) ||
      (payload.priority !== undefined && !isExecutionTerminalFileLinkResolvePriority(payload.priority))
    ) {
      return null;
    }

    return {
      type: 'webview/resolveExecutionFileLinks',
      payload: {
        requestId: payload.requestId,
        nodeId: payload.nodeId,
        kind: payload.kind,
        candidates: payload.candidates,
        ...(payload.priority !== undefined ? { priority: payload.priority } : {})
      }
    };
  }

  if (value.type === 'webview/updateNodeTitle') {
    const payload = isRecord(value.payload) ? value.payload : null;
    if (
      !payload ||
      typeof payload.nodeId !== 'string' ||
      typeof payload.title !== 'string'
    ) {
      return null;
    }

    return {
      type: 'webview/updateNodeTitle',
      payload: {
        nodeId: payload.nodeId,
        title: payload.title
      }
    };
  }

  if (value.type === 'webview/updateNoteNode') {
    const payload = isRecord(value.payload) ? value.payload : null;
    if (
      !payload ||
      typeof payload.nodeId !== 'string' ||
      typeof payload.content !== 'string'
    ) {
      return null;
    }

    return {
      type: 'webview/updateNoteNode',
      payload: {
        nodeId: payload.nodeId,
        content: payload.content,
        baseContentRevision:
          typeof payload.baseContentRevision === 'string' ? payload.baseContentRevision : undefined,
        force: payload.force === true
      }
    };
  }

  if (value.type === 'webview/updateAssociatedNoteMarkdownDraft') {
    const payload = isRecord(value.payload) ? value.payload : null;
    if (
      !payload ||
      typeof payload.nodeId !== 'string' ||
      typeof payload.content !== 'string'
    ) {
      return null;
    }

    return {
      type: 'webview/updateAssociatedNoteMarkdownDraft',
      payload: {
        nodeId: payload.nodeId,
        content: payload.content,
        baseContentRevision:
          typeof payload.baseContentRevision === 'string' ? payload.baseContentRevision : undefined
      }
    };
  }

  if (value.type === 'webview/beginAssociatedNoteMarkdownEdit') {
    const payload = isRecord(value.payload) ? value.payload : null;
    if (
      !payload ||
      typeof payload.nodeId !== 'string' ||
      typeof payload.content !== 'string'
    ) {
      return null;
    }

    return {
      type: 'webview/beginAssociatedNoteMarkdownEdit',
      payload: {
        nodeId: payload.nodeId,
        content: payload.content,
        baseContentRevision:
          typeof payload.baseContentRevision === 'string' ? payload.baseContentRevision : undefined
      }
    };
  }

  if (value.type === 'webview/endAssociatedNoteMarkdownEdit') {
    const payload = isRecord(value.payload) ? value.payload : null;
    if (!payload || typeof payload.nodeId !== 'string') {
      return null;
    }

    return {
      type: 'webview/endAssociatedNoteMarkdownEdit',
      payload: {
        nodeId: payload.nodeId
      }
    };
  }

  if (value.type === 'webview/clearAssociatedNoteMarkdownDraft') {
    const payload = isRecord(value.payload) ? value.payload : null;
    if (!payload || typeof payload.nodeId !== 'string') {
      return null;
    }

    return {
      type: 'webview/clearAssociatedNoteMarkdownDraft',
      payload: {
        nodeId: payload.nodeId
      }
    };
  }

  if (value.type === 'webview/copyAssociatedNoteMarkdownDraft') {
    const payload = isRecord(value.payload) ? value.payload : null;
    if (!payload || typeof payload.nodeId !== 'string' || typeof payload.content !== 'string') {
      return null;
    }

    return {
      type: 'webview/copyAssociatedNoteMarkdownDraft',
      payload: {
        nodeId: payload.nodeId,
        content: payload.content
      }
    };
  }

  if (value.type === 'webview/saveNoteAsMarkdownFile') {
    const payload = isRecord(value.payload) ? value.payload : null;
    if (!payload || typeof payload.nodeId !== 'string') {
      return null;
    }

    return {
      type: 'webview/saveNoteAsMarkdownFile',
      payload: {
        nodeId: payload.nodeId
      }
    };
  }

  if (value.type === 'webview/openAssociatedNoteMarkdownFile') {
    const payload = isRecord(value.payload) ? value.payload : null;
    if (!payload || typeof payload.nodeId !== 'string') {
      return null;
    }

    return {
      type: 'webview/openAssociatedNoteMarkdownFile',
      payload: {
        nodeId: payload.nodeId
      }
    };
  }

  if (value.type === 'webview/reloadAssociatedNoteMarkdownFile') {
    const payload = isRecord(value.payload) ? value.payload : null;
    if (!payload || typeof payload.nodeId !== 'string') {
      return null;
    }

    return {
      type: 'webview/reloadAssociatedNoteMarkdownFile',
      payload: {
        nodeId: payload.nodeId
      }
    };
  }

  if (value.type === 'webview/createMissingAssociatedNoteMarkdownFile') {
    const payload = isRecord(value.payload) ? value.payload : null;
    if (!payload || typeof payload.nodeId !== 'string') {
      return null;
    }

    return {
      type: 'webview/createMissingAssociatedNoteMarkdownFile',
      payload: {
        nodeId: payload.nodeId
      }
    };
  }

  if (value.type === 'webview/dropNoteMarkdownFiles') {
    const payload = isRecord(value.payload) ? value.payload : null;
    const position = payload && isRecord(payload.position) ? payload.position : null;
    if (
      !payload ||
      !Array.isArray(payload.resources) ||
      !payload.resources.every((resource) => isExecutionTerminalDroppedResource(resource)) ||
      (payload.targetGroupId !== undefined && typeof payload.targetGroupId !== 'string') ||
      !position ||
      typeof position.x !== 'number' ||
      typeof position.y !== 'number' ||
      !Number.isFinite(position.x) ||
      !Number.isFinite(position.y)
    ) {
      return null;
    }

    return {
      type: 'webview/dropNoteMarkdownFiles',
      payload: {
        resources: payload.resources,
        position: {
          x: Math.round(position.x),
          y: Math.round(position.y)
        },
        targetGroupId: typeof payload.targetGroupId === 'string' ? payload.targetGroupId : undefined
      }
    };
  }

  if (value.type === 'webview/createEdge') {
    const payload = isRecord(value.payload) ? value.payload : null;
    if (
      !payload ||
      typeof payload.sourceNodeId !== 'string' ||
      typeof payload.targetNodeId !== 'string' ||
      !isCanvasEdgeAnchor(payload.sourceAnchor) ||
      !isCanvasEdgeAnchor(payload.targetAnchor)
    ) {
      return null;
    }

    return {
      type: 'webview/createEdge',
      payload: {
        sourceNodeId: payload.sourceNodeId,
        targetNodeId: payload.targetNodeId,
        sourceAnchor: payload.sourceAnchor,
        targetAnchor: payload.targetAnchor
      }
    };
  }

  if (value.type === 'webview/updateEdge') {
    const payload = isRecord(value.payload) ? value.payload : null;
    if (
      !payload ||
      typeof payload.edgeId !== 'string' ||
      (payload.sourceNodeId !== undefined && typeof payload.sourceNodeId !== 'string') ||
      (payload.targetNodeId !== undefined && typeof payload.targetNodeId !== 'string') ||
      (payload.sourceAnchor !== undefined && !isCanvasEdgeAnchor(payload.sourceAnchor)) ||
      (payload.targetAnchor !== undefined && !isCanvasEdgeAnchor(payload.targetAnchor)) ||
      (payload.arrowMode !== undefined && !isCanvasEdgeArrowMode(payload.arrowMode)) ||
      (payload.color !== undefined && payload.color !== null && !isCanvasEdgeColor(payload.color)) ||
      (payload.label !== undefined && typeof payload.label !== 'string')
    ) {
      return null;
    }

    return {
      type: 'webview/updateEdge',
      payload: {
        edgeId: payload.edgeId,
        sourceNodeId: typeof payload.sourceNodeId === 'string' ? payload.sourceNodeId : undefined,
        targetNodeId: typeof payload.targetNodeId === 'string' ? payload.targetNodeId : undefined,
        sourceAnchor: isCanvasEdgeAnchor(payload.sourceAnchor) ? payload.sourceAnchor : undefined,
        targetAnchor: isCanvasEdgeAnchor(payload.targetAnchor) ? payload.targetAnchor : undefined,
        arrowMode: isCanvasEdgeArrowMode(payload.arrowMode) ? payload.arrowMode : undefined,
        color: payload.color === null ? null : isCanvasEdgeColor(payload.color) ? payload.color : undefined,
        label: typeof payload.label === 'string' ? payload.label : undefined
      }
    };
  }

  if (value.type === 'webview/deleteEdge') {
    const payload = isRecord(value.payload) ? value.payload : null;
    if (!payload || typeof payload.edgeId !== 'string') {
      return null;
    }

    return {
      type: 'webview/deleteEdge',
      payload: {
        edgeId: payload.edgeId
      }
    };
  }

  if (value.type === 'webview/openCanvasFile') {
    const payload = isRecord(value.payload) ? value.payload : null;
    if (!payload || typeof payload.nodeId !== 'string' || typeof payload.filePath !== 'string') {
      return null;
    }

    return {
      type: 'webview/openCanvasFile',
      payload: {
        nodeId: payload.nodeId,
        filePath: payload.filePath
      }
    };
  }

  if (value.type === 'webview/openNoteLink') {
    const payload = isRecord(value.payload) ? value.payload : null;
    if (!payload || typeof payload.nodeId !== 'string' || typeof payload.href !== 'string') {
      return null;
    }

    return {
      type: 'webview/openNoteLink',
      payload: {
        nodeId: payload.nodeId,
        href: payload.href
      }
    };
  }

  if (value.type === 'webview/runtimeDiagnostic') {
    const payload = isRecord(value.payload) ? value.payload : null;
    if (
      !payload ||
      (
        payload.source !== 'window.error' &&
        payload.source !== 'window.unhandledrejection' &&
        payload.source !== 'webview.lifecycle'
      ) ||
      typeof payload.message !== 'string' ||
      (payload.stack !== undefined && typeof payload.stack !== 'string') ||
      (payload.filename !== undefined && typeof payload.filename !== 'string') ||
      (payload.line !== undefined && (typeof payload.line !== 'number' || !Number.isFinite(payload.line))) ||
      (payload.column !== undefined &&
        (typeof payload.column !== 'number' || !Number.isFinite(payload.column))) ||
      (payload.readyState !== undefined &&
        payload.readyState !== 'loading' &&
        payload.readyState !== 'interactive' &&
        payload.readyState !== 'complete')
    ) {
      return null;
    }

    return {
      type: 'webview/runtimeDiagnostic',
      payload: {
        source: payload.source,
        message: payload.message,
        stack: typeof payload.stack === 'string' ? payload.stack : undefined,
        filename: typeof payload.filename === 'string' ? payload.filename : undefined,
        line:
          typeof payload.line === 'number' && Number.isFinite(payload.line) ? payload.line : undefined,
        column:
          typeof payload.column === 'number' && Number.isFinite(payload.column) ? payload.column : undefined,
        readyState:
          payload.readyState === 'loading' ||
          payload.readyState === 'interactive' ||
          payload.readyState === 'complete'
            ? payload.readyState
            : undefined
      }
    };
  }

  if (value.type === 'webview/executionPerformanceDiagnostic') {
    const payload = isRecord(value.payload) ? value.payload : null;
    const normalizedPayload = normalizeExecutionPerformanceDiagnosticPayload(payload);
    if (!normalizedPayload) {
      return null;
    }

    return {
      type: 'webview/executionPerformanceDiagnostic',
      payload: normalizedPayload
    };
  }

  if (value.type === 'webview/executionClipboardDiagnostic') {
    const payload = isRecord(value.payload) ? value.payload : null;
    const normalizedPayload = normalizeExecutionClipboardDiagnosticPayload(payload);
    if (!normalizedPayload) {
      return null;
    }

    return {
      type: 'webview/executionClipboardDiagnostic',
      payload: normalizedPayload
    };
  }

  if (value.type === 'webview/testProbeResult') {
    const payload = isRecord(value.payload) ? value.payload : null;
    if (
      !payload ||
      typeof payload.requestId !== 'string' ||
      !isWebviewProbeSnapshot(payload.snapshot)
    ) {
      return null;
    }

    return {
      type: 'webview/testProbeResult',
      payload: {
        requestId: payload.requestId,
        snapshot: payload.snapshot
      }
    };
  }

  if (value.type === 'webview/testDomActionResult') {
    const payload = isRecord(value.payload) ? value.payload : null;
    if (
      !payload ||
      typeof payload.requestId !== 'string' ||
      typeof payload.ok !== 'boolean' ||
      (payload.errorMessage !== undefined && typeof payload.errorMessage !== 'string')
    ) {
      return null;
    }

    return {
      type: 'webview/testDomActionResult',
      payload: {
        requestId: payload.requestId,
        ok: payload.ok,
        errorMessage: typeof payload.errorMessage === 'string' ? payload.errorMessage : undefined
      }
    };
  }

  if (value.type === 'webview/deleteNode') {
    const payload = isRecord(value.payload) ? value.payload : null;
    if (!payload || typeof payload.nodeId !== 'string') {
      return null;
    }

    return {
      type: 'webview/deleteNode',
      payload: {
        nodeId: payload.nodeId
      }
    };
  }

  if (value.type === 'webview/moveNode') {
    const payload = isRecord(value.payload) ? value.payload : null;
    if (!payload || typeof payload.id !== 'string' || !isCanvasNodePosition(payload.position)) {
      return null;
    }

    const selectedMoves = Array.isArray(payload.selectedMoves)
      ? payload.selectedMoves.flatMap((entry) => {
          if (
            !isRecord(entry) ||
            typeof entry.id !== 'string' ||
            !isCanvasNodePosition(entry.position)
          ) {
            return [];
          }

          return [
            {
              id: entry.id,
              position: entry.position,
              pointerPosition: isCanvasNodePosition(entry.pointerPosition) ? entry.pointerPosition : undefined
            }
          ];
        })
      : undefined;

    return {
      type: 'webview/moveNode',
      payload: {
        id: payload.id,
        position: payload.position,
        pointerPosition: isCanvasNodePosition(payload.pointerPosition) ? payload.pointerPosition : undefined,
        selectedMoves: selectedMoves && selectedMoves.length > 0 ? selectedMoves : undefined
      }
    };
  }

  if (value.type === 'webview/resizeNode') {
    const payload = isRecord(value.payload) ? value.payload : null;
    if (
      !payload ||
      typeof payload.nodeId !== 'string' ||
      !isCanvasNodePosition(payload.position) ||
      !isCanvasNodeFootprint(payload.size)
    ) {
      return null;
    }

    return {
      type: 'webview/resizeNode',
      payload: {
        nodeId: payload.nodeId,
        position: payload.position,
        size: payload.size
      }
    };
  }

  if (value.type === 'webview/createDemoNode') {
    const payload = isRecord(value.payload) ? value.payload : null;
    if (
      !payload ||
      (payload.requestId !== undefined && typeof payload.requestId !== 'string') ||
      !isCanvasCreatableNodeKind(payload.kind) ||
      (payload.preferredPosition !== undefined && !isCanvasNodePosition(payload.preferredPosition)) ||
      (payload.targetGroupId !== undefined && typeof payload.targetGroupId !== 'string') ||
      (payload.cwd !== undefined && typeof payload.cwd !== 'string') ||
      (payload.agentProvider !== undefined && !isAgentProviderKind(payload.agentProvider)) ||
      (payload.agentLaunchPreset !== undefined && !isAgentLaunchPresetKind(payload.agentLaunchPreset)) ||
      (payload.agentCustomLaunchCommand !== undefined && typeof payload.agentCustomLaunchCommand !== 'string')
    ) {
      return null;
    }

    return {
      type: 'webview/createDemoNode',
      payload: {
        requestId: typeof payload.requestId === 'string' ? payload.requestId : undefined,
        kind: payload.kind,
        preferredPosition: isCanvasNodePosition(payload.preferredPosition)
          ? payload.preferredPosition
          : undefined,
        targetGroupId: typeof payload.targetGroupId === 'string' ? payload.targetGroupId : undefined,
        cwd: typeof payload.cwd === 'string' ? payload.cwd : undefined,
        agentProvider: isAgentProviderKind(payload.agentProvider) ? payload.agentProvider : undefined,
        agentLaunchPreset: isAgentLaunchPresetKind(payload.agentLaunchPreset) ? payload.agentLaunchPreset : undefined,
        agentCustomLaunchCommand:
          typeof payload.agentCustomLaunchCommand === 'string' ? payload.agentCustomLaunchCommand : undefined
      }
    };
  }

  if (value.type === 'webview/showCreateNodeBlockedReason') {
    const payload = isRecord(value.payload) ? value.payload : null;
    if (!payload || !isCanvasCreatableNodeKind(payload.kind)) {
      return null;
    }

    return {
      type: 'webview/showCreateNodeBlockedReason',
      payload: {
        kind: payload.kind
      }
    };
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeExecutionPerformanceDiagnosticPayload(
  value: unknown
): ExecutionPerformanceDiagnosticPayload | undefined {
  if (!isRecord(value) || !isExecutionPerformanceDiagnosticSource(value.source)) {
    return undefined;
  }

  if (value.kind !== undefined && !isExecutionNodeKind(value.kind)) {
    return undefined;
  }
  if (value.owner !== undefined && !isExecutionPerformanceDiagnosticOwner(value.owner)) {
    return undefined;
  }

  return {
    source: value.source,
    nodeId: typeof value.nodeId === 'string' ? value.nodeId : undefined,
    kind: isExecutionNodeKind(value.kind) ? value.kind : undefined,
    reason: typeof value.reason === 'string' ? value.reason : undefined,
    sequence: normalizeNonNegativeInteger(value.sequence),
    durationMs: normalizeNonNegativeFiniteNumber(value.durationMs),
    webviewEpochMs: normalizeNonNegativeFiniteNumber(value.webviewEpochMs),
    hostReceivedEpochMs: normalizeNonNegativeFiniteNumber(value.hostReceivedEpochMs),
    hostAckEpochMs: normalizeNonNegativeFiniteNumber(value.hostAckEpochMs),
    hostAckPostEpochMs: normalizeNonNegativeFiniteNumber(value.hostAckPostEpochMs),
    queueDelayMs: normalizeNonNegativeFiniteNumber(value.queueDelayMs),
    requestId: typeof value.requestId === 'string' ? value.requestId : undefined,
    executionSessionId: typeof value.executionSessionId === 'string' ? value.executionSessionId : undefined,
    characters: normalizeNonNegativeInteger(value.characters),
    bytes: normalizeNonNegativeInteger(value.bytes),
    controllerCount: normalizeNonNegativeInteger(value.controllerCount),
    flushedControllerCount: normalizeNonNegativeInteger(value.flushedControllerCount),
    pendingControllerCount: normalizeNonNegativeInteger(value.pendingControllerCount),
    queuedSnapshotCount: normalizeNonNegativeInteger(value.queuedSnapshotCount),
    queuedWriteCount: normalizeNonNegativeInteger(value.queuedWriteCount),
    bufferLength: normalizeNonNegativeInteger(value.bufferLength),
    pendingOutputLength: normalizeNonNegativeInteger(value.pendingOutputLength),
    owner: isExecutionPerformanceDiagnosticOwner(value.owner) ? value.owner : undefined,
    lifecycleStatus: typeof value.lifecycleStatus === 'string' ? value.lifecycleStatus : undefined,
    workspaceStateMode: typeof value.workspaceStateMode === 'string' ? value.workspaceStateMode : undefined,
    success: typeof value.success === 'boolean' ? value.success : undefined
  };
}

function isExecutionPerformanceDiagnosticSource(
  value: unknown
): value is ExecutionPerformanceDiagnosticSource {
  return (
    value === 'webview-output-enqueue' ||
    value === 'webview-terminal-drain' ||
    value === 'webview-terminal-write' ||
    value === 'webview-snapshot-restore-queue' ||
    value === 'webview-output-snapshot-reset' ||
    value === 'webview-input-dispatch' ||
    value === 'webview-input-ack' ||
    value === 'webview-main-thread-lag' ||
    value === 'host-event-loop-lag' ||
    value === 'host-input-received' ||
    value === 'host-input-write' ||
    value === 'host-output-chunk' ||
    value === 'host-output-scheduler' ||
    value === 'host-output-post' ||
    value === 'host-state-persist'
  );
}

function isExecutionPerformanceDiagnosticOwner(
  value: unknown
): value is ExecutionPerformanceDiagnosticOwner {
  return value === 'local' || value === 'supervisor';
}

function normalizeExecutionClipboardDiagnosticPayload(
  value: unknown
): ExecutionTerminalClipboardDiagnosticPayload | undefined {
  if (
    !isRecord(value) ||
    typeof value.nodeId !== 'string' ||
    !isExecutionNodeKind(value.kind) ||
    !isExecutionClipboardDiagnosticSource(value.source) ||
    (value.detail !== undefined && !isRecord(value.detail))
  ) {
    return undefined;
  }

  return {
    nodeId: value.nodeId,
    kind: value.kind,
    source: value.source,
    detail: value.detail === undefined ? undefined : value.detail
  };
}

function isExecutionClipboardDiagnosticSource(
  value: unknown
): value is ExecutionTerminalClipboardDiagnosticSource {
  return (
    value === 'environment' ||
    value === 'shortcut' ||
    value === 'selectionChange' ||
    value === 'mouseTrackingMode' ||
    value === 'mouseSelection' ||
    value === 'contextMenu' ||
    value === 'osc52' ||
    value === 'restoreSuppressed'
  );
}

function normalizeNonNegativeFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function normalizeNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isCanvasNodePosition(value: unknown): value is CanvasNodePosition {
  return (
    isRecord(value) &&
    typeof value.x === 'number' &&
    Number.isFinite(value.x) &&
    typeof value.y === 'number' &&
    Number.isFinite(value.y)
  );
}

function isCanvasNodeFootprint(value: unknown): value is CanvasNodeFootprint {
  return (
    isRecord(value) &&
    typeof value.width === 'number' &&
    Number.isFinite(value.width) &&
    value.width > 0 &&
    typeof value.height === 'number' &&
    Number.isFinite(value.height) &&
    value.height > 0
  );
}

function isCanvasEdgeAnchor(value: unknown): value is CanvasEdgeAnchor {
  return value === 'top' || value === 'right' || value === 'bottom' || value === 'left';
}

function isCanvasEdgeArrowMode(value: unknown): value is CanvasEdgeArrowMode {
  return value === 'none' || value === 'forward' || value === 'both';
}

function isCanvasEdgeOwner(value: unknown): value is CanvasEdgeOwner {
  return value === 'user' || value === 'file-activity';
}

function isCanvasEdgePresetColor(value: unknown): value is CanvasEdgePresetColor {
  return typeof value === 'string' && canvasEdgePresetColors.includes(value as CanvasEdgePresetColor);
}

function isCanvasEdgeColor(value: unknown): value is CanvasEdgeColor {
  return (
    isCanvasEdgePresetColor(value) ||
    (typeof value === 'string' && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value))
  );
}

export function isWebviewDomAction(value: unknown): value is WebviewDomAction {
  if (!isRecord(value) || typeof value.kind !== 'string' || typeof value.nodeId !== 'string') {
    return false;
  }

  if (value.delayMs !== undefined && !isNonNegativeDelay(value.delayMs)) {
    return false;
  }

  if (value.kind === 'selectNode') {
    return true;
  }

  if (value.kind === 'setNodeTextField') {
    return (value.field === 'title' || value.field === 'body') && typeof value.value === 'string';
  }

  if (value.kind === 'clickNodeActionButton') {
      return (
        value.label === '删除' ||
        value.label === '启动' ||
        value.label === '停止' ||
        value.label === '新建' ||
        value.label === '重启' ||
        value.label === '恢复' ||
        value.label === '重新加载' ||
        value.label === '复制草稿' ||
        value.label === '覆盖文件' ||
        value.label === '创建空文件并关联'
      );
  }

  if (value.kind === 'scrollTerminalViewport') {
    return typeof value.lines === 'number' && Number.isInteger(value.lines);
  }

  if (value.kind === 'sendExecutionInput') {
    return typeof value.data === 'string';
  }

  if (value.kind === 'dropExecutionResources') {
    return (
      (value.source === 'resourceUrls' || value.source === 'codeFiles' || value.source === 'uriList') &&
      Array.isArray(value.values) &&
      value.values.every((entry) => typeof entry === 'string')
    );
  }

  if (value.kind === 'activateExecutionLink') {
    return typeof value.text === 'string';
  }

  if (value.kind === 'hoverExecutionLink') {
    return typeof value.text === 'string';
  }

  if (value.kind === 'hoverExecutionText') {
    return typeof value.text === 'string';
  }

  if (value.kind === 'clearExecutionLinkHover') {
    return true;
  }

  if (value.kind === 'selectEdge') {
    return typeof value.edgeId === 'string';
  }

  if (value.kind === 'clickFileEntry') {
    return typeof value.filePath === 'string';
  }

  if (value.kind === 'toggleNoteChecklistItem') {
    return typeof value.lineNumber === 'number' && Number.isSafeInteger(value.lineNumber);
  }

  if (value.kind === 'doubleClickNotePreviewText') {
    return (
      typeof value.text === 'string' &&
      (value.offset === undefined || (typeof value.offset === 'number' && Number.isSafeInteger(value.offset)))
    );
  }

  if (value.kind === 'doubleClickNotePreviewSelector') {
    return typeof value.selector === 'string';
  }

  return false;
}

function isExecutionTerminalDroppedResource(value: unknown): value is ExecutionTerminalDroppedResource {
  return (
    isRecord(value) &&
    (value.source === 'resourceUrls' ||
      value.source === 'codeFiles' ||
      value.source === 'uriList' ||
      value.source === 'files') &&
    (value.valueKind === 'uri' || value.valueKind === 'path') &&
    typeof value.value === 'string'
  );
}

function isExecutionTerminalFileLinkCandidate(value: unknown): value is ExecutionTerminalFileLinkCandidate {
  return (
    isRecord(value) &&
    typeof value.candidateId === 'string' &&
    typeof value.text === 'string' &&
    typeof value.path === 'string' &&
    typeof value.startIndex === 'number' &&
    Number.isInteger(value.startIndex) &&
    value.startIndex >= 0 &&
    typeof value.endIndexExclusive === 'number' &&
    Number.isInteger(value.endIndexExclusive) &&
    value.endIndexExclusive >= value.startIndex &&
    typeof value.bufferStartLine === 'number' &&
    Number.isInteger(value.bufferStartLine) &&
    value.bufferStartLine >= 0 &&
    isExecutionTerminalFileLinkSource(value.source) &&
    (value.line === undefined || isPositiveInteger(value.line)) &&
    (value.column === undefined || isPositiveInteger(value.column)) &&
    (value.lineEnd === undefined || isPositiveInteger(value.lineEnd)) &&
    (value.columnEnd === undefined || isPositiveInteger(value.columnEnd))
  );
}

function isExecutionTerminalOpenLink(value: unknown): value is ExecutionTerminalOpenLink {
  if (!isRecord(value) || typeof value.text !== 'string' || typeof value.linkKind !== 'string') {
    return false;
  }

  if (value.linkKind === 'url') {
    return (
      typeof value.url === 'string' &&
      (value.source === undefined || value.source === 'implicit' || value.source === 'explicit')
    );
  }

  if (value.linkKind === 'search') {
    return (
      typeof value.searchText === 'string' &&
      (value.contextLine === undefined || typeof value.contextLine === 'string') &&
      (value.bufferStartLine === undefined ||
        (typeof value.bufferStartLine === 'number' &&
          Number.isInteger(value.bufferStartLine) &&
          value.bufferStartLine >= 0)) &&
      (value.source === undefined || value.source === 'word')
    );
  }

  if (value.linkKind === 'file') {
    return (
      typeof value.path === 'string' &&
      (value.line === undefined || isPositiveInteger(value.line)) &&
      (value.column === undefined || isPositiveInteger(value.column)) &&
      (value.lineEnd === undefined || isPositiveInteger(value.lineEnd)) &&
      (value.columnEnd === undefined || isPositiveInteger(value.columnEnd)) &&
      (value.bufferStartLine === undefined ||
        (typeof value.bufferStartLine === 'number' &&
          Number.isInteger(value.bufferStartLine) &&
          value.bufferStartLine >= 0)) &&
      (value.resolvedId === undefined || typeof value.resolvedId === 'string') &&
      (value.source === undefined ||
        isExecutionTerminalFileLinkSource(value.source)) &&
      (value.targetKind === undefined ||
        value.targetKind === 'file' ||
        value.targetKind === 'directory-in-workspace' ||
        value.targetKind === 'directory-outside-workspace')
    );
  }

  return false;
}

function isExecutionTerminalFileLinkSource(value: unknown): value is ExecutionTerminalFileLinkSource {
  return (
    value === 'detected' ||
    value === 'refined' ||
    value === 'styled' ||
    value === 'fallback' ||
    value === 'hardwrap' ||
    value === 'explicit-uri'
  );
}

function isExecutionTerminalFileLinkResolvePriority(
  value: unknown
): value is ExecutionTerminalFileLinkResolvePriority {
  return value === 'interactive' || value === 'background';
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isWebviewProbeNodeSnapshot(value: unknown): value is WebviewProbeNodeSnapshot {
  return (
    isRecord(value) &&
    typeof value.nodeId === 'string' &&
    isCanvasNodeKind(value.kind) &&
    isNullableString(value.chromeTitle) &&
    (value.chromeContext === undefined || isNullableString(value.chromeContext)) &&
    isNullableString(value.chromeSubtitle) &&
    isNullableString(value.statusText) &&
    typeof value.attentionIndicatorVisible === 'boolean' &&
    typeof value.attentionIndicatorFlashing === 'boolean' &&
    typeof value.minimapVisible === 'boolean' &&
    typeof value.minimapAttentionFlashing === 'boolean' &&
    typeof value.minimapAttentionSizePulsing === 'boolean' &&
    typeof value.selected === 'boolean' &&
    typeof value.renderedWidth === 'number' &&
    Number.isFinite(value.renderedWidth) &&
    typeof value.renderedHeight === 'number' &&
    Number.isFinite(value.renderedHeight) &&
    (value.overlayTitle === undefined || typeof value.overlayTitle === 'string') &&
    (value.overlayMessage === undefined || typeof value.overlayMessage === 'string') &&
    (value.titleInputValue === undefined || typeof value.titleInputValue === 'string') &&
    (value.bodyValue === undefined || typeof value.bodyValue === 'string') &&
    (value.terminalSelectionText === undefined || typeof value.terminalSelectionText === 'string') &&
    (value.terminalCols === undefined ||
      (typeof value.terminalCols === 'number' &&
        Number.isInteger(value.terminalCols) &&
        value.terminalCols > 0)) &&
    (value.terminalRows === undefined ||
      (typeof value.terminalRows === 'number' &&
        Number.isInteger(value.terminalRows) &&
        value.terminalRows > 0)) &&
    (value.terminalViewportY === undefined ||
      (typeof value.terminalViewportY === 'number' &&
        Number.isInteger(value.terminalViewportY) &&
        value.terminalViewportY >= 0)) &&
    (value.terminalVisibleLines === undefined ||
      (Array.isArray(value.terminalVisibleLines) &&
        value.terminalVisibleLines.every((line) => typeof line === 'string'))) &&
    (value.terminalTextareaLeft === undefined ||
      (typeof value.terminalTextareaLeft === 'number' && Number.isFinite(value.terminalTextareaLeft))) &&
    (value.terminalTextareaTop === undefined ||
      (typeof value.terminalTextareaTop === 'number' && Number.isFinite(value.terminalTextareaTop))) &&
    (value.terminalMouseTrackingMode === undefined ||
      value.terminalMouseTrackingMode === 'none' ||
      value.terminalMouseTrackingMode === 'x10' ||
      value.terminalMouseTrackingMode === 'vt200' ||
      value.terminalMouseTrackingMode === 'drag' ||
      value.terminalMouseTrackingMode === 'any') &&
    (value.terminalBufferType === undefined ||
      value.terminalBufferType === 'normal' ||
      value.terminalBufferType === 'alternate') &&
    (value.terminalHasFocus === undefined || typeof value.terminalHasFocus === 'boolean') &&
    (value.terminalTheme === undefined || isWebviewProbeTerminalThemeSnapshot(value.terminalTheme))
  );
}

function isWebviewProbeEdgeSnapshot(value: unknown): value is WebviewProbeEdgeSnapshot {
  return (
    isRecord(value) &&
    typeof value.edgeId === 'string' &&
    typeof value.sourceNodeId === 'string' &&
    typeof value.targetNodeId === 'string' &&
    isCanvasEdgeArrowMode(value.arrowMode) &&
    isCanvasEdgeOwner(value.owner) &&
    isNullableString(value.color) &&
    isNullableString(value.label) &&
    typeof value.selected === 'boolean'
  );
}

function isWebviewProbeSnapshot(value: unknown): value is WebviewProbeSnapshot {
  return (
    isRecord(value) &&
    typeof value.documentTitle === 'string' &&
    typeof value.hasDocumentFocus === 'boolean' &&
    typeof value.hasCanvasShell === 'boolean' &&
    typeof value.hasReactFlow === 'boolean' &&
    isNullableString(value.toastMessage) &&
    isNullableString(value.executionLinkTooltipText) &&
    typeof value.nodeCount === 'number' &&
    Number.isInteger(value.nodeCount) &&
    Array.isArray(value.nodes) &&
    value.nodes.every((node) => isWebviewProbeNodeSnapshot(node)) &&
    typeof value.edgeCount === 'number' &&
    Number.isInteger(value.edgeCount) &&
    Array.isArray(value.edges) &&
    value.edges.every((edge) => isWebviewProbeEdgeSnapshot(edge))
  );
}

function isTerminalDimension(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isWebviewProbeTerminalThemeSnapshot(value: unknown): value is WebviewProbeTerminalThemeSnapshot {
  return (
    isRecord(value) &&
    (value.background === undefined || typeof value.background === 'string') &&
    (value.foreground === undefined || typeof value.foreground === 'string') &&
    (value.cursor === undefined || typeof value.cursor === 'string') &&
    (value.selectionBackground === undefined || typeof value.selectionBackground === 'string') &&
    (value.ansiBlue === undefined || typeof value.ansiBlue === 'string') &&
    (value.ansiBrightWhite === undefined || typeof value.ansiBrightWhite === 'string')
  );
}

function isNonNegativeDelay(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export function estimatedCanvasNodeFootprint(kind: CanvasNodeKind): CanvasNodeFootprint {
  switch (kind) {
    case 'agent':
      return {
        width: 560,
        height: 430
      };
    case 'terminal':
      return {
        width: 540,
        height: 420
      };
    case 'note':
      return {
        width: 380,
        height: 400
      };
    case 'file':
      return {
        width: 220,
        height: 84
      };
    case 'file-list':
      return {
        width: 320,
        height: 220
      };
  }
}

export function resolveHorizontalCanvasEdgeAnchors(
  sourceNode: Pick<CanvasNodeSummary, 'position' | 'size'>,
  targetNode: Pick<CanvasNodeSummary, 'position' | 'size'>
): Pick<CanvasEdgeSummary, 'sourceAnchor' | 'targetAnchor'> {
  const sourceLeft = sourceNode.position.x;
  const sourceRight = sourceNode.position.x + sourceNode.size.width;
  const targetLeft = targetNode.position.x;
  const targetRight = targetNode.position.x + targetNode.size.width;
  const rightToLeftDistance = Math.abs(sourceRight - targetLeft);
  const leftToRightDistance = Math.abs(sourceLeft - targetRight);

  if (rightToLeftDistance <= leftToRightDistance) {
    return {
      sourceAnchor: 'right',
      targetAnchor: 'left'
    };
  }

  return {
    sourceAnchor: 'left',
    targetAnchor: 'right'
  };
}

export function minimumCanvasNodeFootprint(kind: CanvasNodeKind): CanvasNodeFootprint {
  switch (kind) {
    case 'agent':
      return {
        width: 420,
        height: 320
      };
    case 'terminal':
      return {
        width: 420,
        height: 300
      };
    case 'note':
      return {
        width: 320,
        height: 280
      };
    case 'file':
      return {
        width: 180,
        height: 72
      };
    case 'file-list':
      return {
        width: 260,
        height: 180
      };
  }
}

export function estimateMinimalFileNodeFootprint(
  primaryLabel: string,
  displayMode: CanvasFileNodeDisplayMode
): CanvasNodeFootprint {
  const textWidth = estimateCanvasLabelWidth(primaryLabel, 12);

  switch (displayMode) {
    case 'icon-only':
      return {
        width: 28,
        height: 24
      };
    case 'path-only':
      return {
        width: Math.max(32, Math.ceil(textWidth + 14)),
        height: 22
      };
    default:
      return {
        width: Math.max(68, Math.min(480, Math.ceil(textWidth + 38))),
        height: 24
      };
  }
}

function estimateCanvasLabelWidth(text: string, fontSizePx: number): number {
  let widthUnits = 0;

  for (const character of text) {
    if (character === ' ') {
      widthUnits += 0.34;
      continue;
    }

    if ('il.,:;|!'.includes(character)) {
      widthUnits += 0.32;
      continue;
    }

    if ('[](){}\'`'.includes(character)) {
      widthUnits += 0.38;
      continue;
    }

    if ('-_/\\'.includes(character)) {
      widthUnits += 0.46;
      continue;
    }

    if (character >= '0' && character <= '9') {
      widthUnits += 0.58;
      continue;
    }

    if (character >= 'A' && character <= 'Z') {
      widthUnits += 0.68;
      continue;
    }

    if ('mwMW@#%&'.includes(character)) {
      widthUnits += 0.82;
      continue;
    }

    if (character.charCodeAt(0) > 0x7f) {
      widthUnits += 0.96;
      continue;
    }

    widthUnits += 0.6;
  }

  return Math.max(0, widthUnits * fontSizePx);
}

export function normalizeCanvasNodeFootprint(
  kind: CanvasNodeKind,
  value: unknown
): CanvasNodeFootprint {
  const fallback = estimatedCanvasNodeFootprint(kind);
  const minimum = minimumCanvasNodeFootprint(kind);

  if (!isCanvasNodeFootprint(value)) {
    return fallback;
  }

  return {
    width: Math.max(minimum.width, Math.round(value.width)),
    height: Math.max(minimum.height, Math.round(value.height))
  };
}
