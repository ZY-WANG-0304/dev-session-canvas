export type CanvasNodeKind = 'agent' | 'terminal' | 'note';
export type ExecutionNodeKind = 'agent' | 'terminal';

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
export type AgentResumeStrategy = 'none' | 'claude-session-id' | 'codex-home' | 'fake-provider';

export interface ExecutionSessionMetadata {
  backend: TerminalBackendKind;
  shellPath: string;
  cwd: string;
  persistenceMode: RuntimePersistenceMode;
  attachmentState: RuntimeAttachmentState;
  runtimeBackend?: RuntimeHostBackendKind;
  runtimeGuarantee?: RuntimePersistenceGuarantee;
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
}

export interface AgentNodeMetadata extends ExecutionSessionMetadata {
  lifecycle: AgentNodeStatus;
  provider: AgentProviderKind;
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

export interface CanvasNodeMetadata {
  agent?: AgentNodeMetadata;
  terminal?: TerminalNodeMetadata;
  note?: NoteNodeMetadata;
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

export interface CanvasPrototypeState {
  version: 1;
  updatedAt: string;
  nodes: CanvasNodeSummary[];
}

export interface CanvasRuntimeContext {
  workspaceTrusted: boolean;
}

export interface WebviewProbeNodeSnapshot {
  nodeId: string;
  kind: CanvasNodeKind;
  chromeTitle: string | null;
  chromeSubtitle: string | null;
  statusText: string | null;
  selected: boolean;
  renderedWidth: number;
  renderedHeight: number;
  overlayTitle?: string;
  overlayMessage?: string;
  providerValue?: string;
  titleInputValue?: string;
  bodyValue?: string;
  terminalSelectionText?: string;
  terminalCols?: number;
  terminalRows?: number;
  terminalViewportY?: number;
  terminalTextareaLeft?: number;
  terminalTextareaTop?: number;
}

export interface WebviewProbeSnapshot {
  documentTitle: string;
  hasCanvasShell: boolean;
  hasReactFlow: boolean;
  toastMessage: string | null;
  nodeCount: number;
  nodes: WebviewProbeNodeSnapshot[];
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
      kind: 'selectNodeOption';
      nodeId: string;
      field: 'provider';
      value: AgentProviderKind;
      delayMs?: number;
    }
  | {
      kind: 'clickNodeActionButton';
      nodeId: string;
      label: '删除' | '启动' | '停止' | '重启' | '恢复';
      delayMs?: number;
    };

export type WebviewToHostMessage =
  | {
      type: 'webview/ready';
    }
  | {
      type: 'webview/createDemoNode';
      payload: {
        kind: CanvasNodeKind;
        preferredPosition?: CanvasNodePosition;
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
      type: 'host/error';
      payload: {
        message: string;
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
      type: 'host/requestCreateNode';
      payload: {
        kind: CanvasNodeKind;
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

const canvasNodeKinds: CanvasNodeKind[] = ['agent', 'terminal', 'note'];

export function isCanvasNodeKind(value: unknown): value is CanvasNodeKind {
  return typeof value === 'string' && canvasNodeKinds.includes(value as CanvasNodeKind);
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
      payload.provider !== 'codex' &&
      payload.provider !== 'claude'
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
        provider:
          payload.kind === 'agent' &&
          (payload.provider === 'codex' || payload.provider === 'claude')
            ? payload.provider
            : undefined
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
      !isCanvasNodeKind(payload.kind) ||
      (payload.preferredPosition !== undefined && !isCanvasNodePosition(payload.preferredPosition))
    ) {
      return null;
    }

    return {
      type: 'webview/createDemoNode',
      payload: {
        kind: payload.kind,
        preferredPosition: isCanvasNodePosition(payload.preferredPosition)
          ? payload.preferredPosition
          : undefined
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

  if (value.kind === 'selectNodeOption') {
    return value.field === 'provider' && (value.value === 'codex' || value.value === 'claude');
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

  return false;
}

function isWebviewProbeNodeSnapshot(value: unknown): value is WebviewProbeNodeSnapshot {
  return (
    isRecord(value) &&
    typeof value.nodeId === 'string' &&
    isCanvasNodeKind(value.kind) &&
    isNullableString(value.chromeTitle) &&
    isNullableString(value.chromeSubtitle) &&
    isNullableString(value.statusText) &&
    typeof value.selected === 'boolean' &&
    typeof value.renderedWidth === 'number' &&
    Number.isFinite(value.renderedWidth) &&
    typeof value.renderedHeight === 'number' &&
    Number.isFinite(value.renderedHeight) &&
    (value.overlayTitle === undefined || typeof value.overlayTitle === 'string') &&
    (value.overlayMessage === undefined || typeof value.overlayMessage === 'string') &&
    (value.providerValue === undefined || typeof value.providerValue === 'string') &&
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
    (value.terminalTextareaLeft === undefined ||
      (typeof value.terminalTextareaLeft === 'number' && Number.isFinite(value.terminalTextareaLeft))) &&
    (value.terminalTextareaTop === undefined ||
      (typeof value.terminalTextareaTop === 'number' && Number.isFinite(value.terminalTextareaTop)))
  );
}

function isWebviewProbeSnapshot(value: unknown): value is WebviewProbeSnapshot {
  return (
    isRecord(value) &&
    typeof value.documentTitle === 'string' &&
    typeof value.hasCanvasShell === 'boolean' &&
    typeof value.hasReactFlow === 'boolean' &&
    isNullableString(value.toastMessage) &&
    typeof value.nodeCount === 'number' &&
    Number.isInteger(value.nodeCount) &&
    Array.isArray(value.nodes) &&
    value.nodes.every((node) => isWebviewProbeNodeSnapshot(node))
  );
}

function isTerminalDimension(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
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
  }
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
  }
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
