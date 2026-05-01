import type { SerializedTerminalState } from './serializedTerminalState';
import type {
  ExecutionTerminalFileLinkCandidate,
  ExecutionTerminalDroppedResource,
  ExecutionTerminalOpenLink,
  ExecutionTerminalResolvedFileLink
} from './executionTerminalLinks';

export type CanvasNodeKind = 'agent' | 'terminal' | 'note' | 'file' | 'file-list';
export type CanvasCreatableNodeKind = 'agent' | 'terminal' | 'note';
export type ExecutionNodeKind = 'agent' | 'terminal';
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
export const canvasStrongTerminalAttentionReminderModes = ['none', 'titleBar', 'minimap', 'both'] as const;
export type CanvasStrongTerminalAttentionReminderMode =
  (typeof canvasStrongTerminalAttentionReminderModes)[number];

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

export type TerminalBackendKind = 'node-pty';
export type AgentProviderKind = 'codex' | 'claude';
export type AgentLaunchPresetKind = 'default' | 'resume' | 'yolo' | 'sandbox' | 'custom';
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
  | 'stopping'
  | 'stopped'
  | 'error'
  | 'interrupted';
export type AgentRuntimeKind = 'pty-cli';
export type AgentResumeStrategy = 'none' | 'claude-session-id' | 'codex-session-id' | 'fake-provider';

export interface ExecutionSessionMetadata {
  backend: TerminalBackendKind;
  shellPath: string;
  cwd: string;
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
  lastLaunchCommandLine?: string;
  runtimeKind: AgentRuntimeKind;
  resumeSupported: boolean;
  resumeStrategy: AgentResumeStrategy;
  resumeSessionId?: string;
  resumeStoragePath?: string;
  lastResumeError?: string;
  lastBackendLabel?: string;
}

export interface TerminalNodeMetadata extends ExecutionSessionMetadata {
  lifecycle: TerminalNodeStatus;
}

export interface NoteNodeMetadata {
  content: string;
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

export interface CanvasRuntimeContext {
  workspaceTrusted: boolean;
  surfaceLocation: 'editor' | 'panel';
  defaultAgentProvider: AgentProviderKind;
  agentLaunchDefaults: AgentLaunchDefaultsByProvider;
  strongTerminalAttentionReminderMode: CanvasStrongTerminalAttentionReminderMode;
  terminalScrollback: number;
  editorMultiCursorModifier: 'ctrlCmd' | 'alt';
  terminalWordSeparators: string;
  filePresentationMode: CanvasFilePresentationMode;
  fileNodeDisplayStyle: CanvasFileNodeDisplayStyle;
  fileNodeDisplayMode: CanvasFileNodeDisplayMode;
  filePathDisplayMode: CanvasFilePathDisplayMode;
  fileIconFontFaces: CanvasFileIconFontFace[];
}

export interface WebviewProbeNodeSnapshot {
  nodeId: string;
  kind: CanvasNodeKind;
  chromeTitle: string | null;
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
      label: '删除' | '启动' | '停止' | '重启' | '恢复';
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
    };

export type WebviewToHostMessage =
  | {
      type: 'webview/ready';
    }
  | {
      type: 'webview/selectNode';
      payload: {
        nodeId: string;
      };
    }
  | {
      type: 'webview/createDemoNode';
      payload: {
        requestId?: string;
        kind: CanvasCreatableNodeKind;
        preferredPosition?: CanvasNodePosition;
        agentProvider?: AgentProviderKind;
        agentLaunchPreset?: AgentLaunchPresetKind;
        agentCustomLaunchCommand?: string;
      };
    }
  | {
      type: 'webview/moveNode';
      payload: {
        id: string;
        position: CanvasNodePosition;
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
      type: 'webview/attachExecutionSession';
      payload: {
        nodeId: string;
        kind: ExecutionNodeKind;
      };
    }
  | {
      type: 'webview/executionInput';
      payload: {
        nodeId: string;
        kind: ExecutionNodeKind;
        data: string;
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
      type: 'webview/runtimeDiagnostic';
      payload: {
        source: 'window.error' | 'window.unhandledrejection';
        message: string;
        stack?: string;
        filename?: string;
        line?: number;
        column?: number;
        readyState?: 'loading' | 'interactive' | 'complete';
      };
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
    };

export type HostToWebviewMessage =
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
      type: 'host/themeChanged';
    }
  | {
      type: 'host/visibilityRestored';
    }
  | {
      type: 'host/focusNode';
      payload: {
        nodeId: string;
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
      type: 'host/executionSnapshot';
      payload: {
        nodeId: string;
        kind: ExecutionNodeKind;
        output: string;
        cols: number;
        rows: number;
        liveSession: boolean;
        serializedTerminalState?: SerializedTerminalState;
      };
    }
  | {
      type: 'host/executionOutput';
      payload: {
        nodeId: string;
        kind: ExecutionNodeKind;
        chunk: string;
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
      type: 'host/requestCreateNode';
      payload: {
        kind: CanvasCreatableNodeKind;
        agentProvider?: AgentProviderKind;
        agentLaunchPreset?: AgentLaunchPresetKind;
        agentCustomLaunchCommand?: string;
      };
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
    };

const canvasNodeKinds: CanvasNodeKind[] = ['agent', 'terminal', 'note', 'file', 'file-list'];
const canvasCreatableNodeKinds: CanvasCreatableNodeKind[] = ['agent', 'terminal', 'note'];
const agentProviderKinds: AgentProviderKind[] = ['codex', 'claude'];
const agentLaunchPresetKinds: AgentLaunchPresetKind[] = ['default', 'resume', 'yolo', 'sandbox', 'custom'];

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

export function parseWebviewMessage(value: unknown): WebviewToHostMessage | null {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return null;
  }

  if (value.type === 'webview/ready' || value.type === 'webview/resetDemoState') {
    return { type: value.type };
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

    return {
      type: value.type,
      payload: {
        nodeId: payload.nodeId,
        kind: payload.kind
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
        data: payload.data
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
      !payload.candidates.every((candidate) => isExecutionTerminalFileLinkCandidate(candidate))
    ) {
      return null;
    }

    return {
      type: 'webview/resolveExecutionFileLinks',
      payload: {
        requestId: payload.requestId,
        nodeId: payload.nodeId,
        kind: payload.kind,
        candidates: payload.candidates
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
        content: payload.content
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

  if (value.type === 'webview/runtimeDiagnostic') {
    const payload = isRecord(value.payload) ? value.payload : null;
    if (
      !payload ||
      (payload.source !== 'window.error' && payload.source !== 'window.unhandledrejection') ||
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

    return {
      type: 'webview/moveNode',
      payload: {
        id: payload.id,
        position: payload.position
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
        agentProvider: isAgentProviderKind(payload.agentProvider) ? payload.agentProvider : undefined,
        agentLaunchPreset: isAgentLaunchPresetKind(payload.agentLaunchPreset) ? payload.agentLaunchPreset : undefined,
        agentCustomLaunchCommand:
          typeof payload.agentCustomLaunchCommand === 'string' ? payload.agentCustomLaunchCommand : undefined
      }
    };
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isCanvasNodePosition(value: unknown): value is CanvasNodePosition {
  return isRecord(value) && typeof value.x === 'number' && typeof value.y === 'number';
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
        value.label === '重启' ||
        value.label === '恢复'
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

  if (value.kind === 'clearExecutionLinkHover') {
    return true;
  }

  if (value.kind === 'selectEdge') {
    return typeof value.edgeId === 'string';
  }

  if (value.kind === 'clickFileEntry') {
    return typeof value.filePath === 'string';
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
    (value.source === 'detected' ||
      value.source === 'refined' ||
      value.source === 'fallback' ||
      value.source === 'explicit-uri') &&
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
        value.source === 'detected' ||
        value.source === 'refined' ||
        value.source === 'fallback' ||
        value.source === 'explicit-uri') &&
      (value.targetKind === undefined ||
        value.targetKind === 'file' ||
        value.targetKind === 'directory-in-workspace' ||
        value.targetKind === 'directory-outside-workspace')
    );
  }

  return false;
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
