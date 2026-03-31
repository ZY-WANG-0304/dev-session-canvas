export type CanvasNodeKind = 'agent' | 'terminal' | 'task' | 'note';
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
export type TaskNodeStatus = 'todo' | 'running' | 'blocked' | 'done';

export interface ExecutionSessionMetadata {
  backend: TerminalBackendKind;
  shellPath: string;
  cwd: string;
  liveSession: boolean;
  autoStartPending?: boolean;
  recentOutput?: string;
  lastExitCode?: number;
  lastExitSignal?: string;
  lastExitMessage?: string;
  lastCols?: number;
  lastRows?: number;
}

export interface AgentNodeMetadata extends ExecutionSessionMetadata {
  provider: AgentProviderKind;
  lastBackendLabel?: string;
}

export interface TerminalNodeMetadata extends ExecutionSessionMetadata {}

export interface TaskNodeMetadata {
  description: string;
  assignee: string;
}

export interface NoteNodeMetadata {
  content: string;
}

export interface CanvasNodeMetadata {
  agent?: AgentNodeMetadata;
  terminal?: TerminalNodeMetadata;
  task?: TaskNodeMetadata;
  note?: NoteNodeMetadata;
}

export interface CanvasNodeSummary {
  id: string;
  kind: CanvasNodeKind;
  title: string;
  status: string;
  summary: string;
  position: CanvasNodePosition;
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
      type: 'webview/updateTaskNode';
      payload: {
        nodeId: string;
        title: string;
        status: TaskNodeStatus;
        description: string;
        assignee: string;
      };
    }
  | {
      type: 'webview/updateNoteNode';
      payload: {
        nodeId: string;
        title: string;
        content: string;
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
    };

const canvasNodeKinds: CanvasNodeKind[] = ['agent', 'terminal', 'task', 'note'];

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
      !isTerminalDimension(payload.rows)
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

  if (value.type === 'webview/updateTaskNode') {
    const payload = isRecord(value.payload) ? value.payload : null;
    if (
      !payload ||
      typeof payload.nodeId !== 'string' ||
      typeof payload.title !== 'string' ||
      typeof payload.description !== 'string' ||
      typeof payload.assignee !== 'string' ||
      !isTaskNodeStatus(payload.status)
    ) {
      return null;
    }

    return {
      type: 'webview/updateTaskNode',
      payload: {
        nodeId: payload.nodeId,
        title: payload.title,
        status: payload.status,
        description: payload.description,
        assignee: payload.assignee
      }
    };
  }

  if (value.type === 'webview/updateNoteNode') {
    const payload = isRecord(value.payload) ? value.payload : null;
    if (
      !payload ||
      typeof payload.nodeId !== 'string' ||
      typeof payload.title !== 'string' ||
      typeof payload.content !== 'string'
    ) {
      return null;
    }

    return {
      type: 'webview/updateNoteNode',
      payload: {
        nodeId: payload.nodeId,
        title: payload.title,
        content: payload.content
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

function isCanvasNodePosition(value: unknown): value is CanvasNodePosition {
  return isRecord(value) && typeof value.x === 'number' && typeof value.y === 'number';
}

function isTaskNodeStatus(value: unknown): value is TaskNodeStatus {
  return value === 'todo' || value === 'running' || value === 'blocked' || value === 'done';
}

function isTerminalDimension(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
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
    case 'task':
      return {
        width: 380,
        height: 360
      };
    case 'note':
      return {
        width: 380,
        height: 430
      };
  }
}
