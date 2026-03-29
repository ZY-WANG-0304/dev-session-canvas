export type CanvasNodeKind = 'agent' | 'terminal' | 'task' | 'note';

export interface CanvasNodePosition {
  x: number;
  y: number;
}

export type TerminalRevealMode = 'editor' | 'panel';
export type AgentProviderKind = 'codex' | 'claude';
export type TaskNodeStatus = 'todo' | 'running' | 'blocked' | 'done';
export type AgentTranscriptRole = 'user' | 'assistant' | 'status';
export type AgentTranscriptState = 'done' | 'streaming' | 'error';

export interface AgentTranscriptEntry {
  id: string;
  role: AgentTranscriptRole;
  text: string;
  state?: AgentTranscriptState;
}

export interface AgentNodeMetadata {
  provider: AgentProviderKind;
  liveRun: boolean;
  transcript?: AgentTranscriptEntry[];
  lastPrompt?: string;
  lastResponse?: string;
  lastBackendLabel?: string;
  lastRunId?: string;
}

export interface TerminalNodeMetadata {
  terminalName: string;
  liveSession: boolean;
  revealMode: TerminalRevealMode;
}

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
      type: 'webview/resetDemoState';
    }
  | {
      type: 'webview/startAgentRun';
      payload: {
        nodeId: string;
        prompt: string;
        provider: AgentProviderKind;
      };
    }
  | {
      type: 'webview/stopAgentRun';
      payload: {
        nodeId: string;
      };
    }
  | {
      type: 'webview/ensureTerminalSession';
      payload: {
        nodeId: string;
      };
    }
  | {
      type: 'webview/revealTerminal';
      payload: {
        nodeId: string;
      };
    }
  | {
      type: 'webview/reconnectTerminal';
      payload: {
        nodeId: string;
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
    };

const canvasNodeKinds: CanvasNodeKind[] = ['agent', 'terminal', 'task', 'note'];

export function isCanvasNodeKind(value: unknown): value is CanvasNodeKind {
  return typeof value === 'string' && canvasNodeKinds.includes(value as CanvasNodeKind);
}

export function parseWebviewMessage(value: unknown): WebviewToHostMessage | null {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return null;
  }

  if (value.type === 'webview/ready' || value.type === 'webview/resetDemoState') {
    return { type: value.type };
  }

  if (
    value.type === 'webview/stopAgentRun' ||
    value.type === 'webview/ensureTerminalSession' ||
    value.type === 'webview/revealTerminal' ||
    value.type === 'webview/reconnectTerminal'
  ) {
    const payload = isRecord(value.payload) ? value.payload : null;
    if (!payload || typeof payload.nodeId !== 'string') {
      return null;
    }

    return {
      type: value.type,
      payload: {
        nodeId: payload.nodeId
      }
    };
  }

  if (value.type === 'webview/startAgentRun') {
    const payload = isRecord(value.payload) ? value.payload : null;
    if (
      !payload ||
      typeof payload.nodeId !== 'string' ||
      typeof payload.prompt !== 'string' ||
      (payload.provider !== 'codex' && payload.provider !== 'claude')
    ) {
      return null;
    }

    return {
      type: 'webview/startAgentRun',
      payload: {
        nodeId: payload.nodeId,
        prompt: payload.prompt,
        provider: payload.provider
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
    if (!payload || !isCanvasNodeKind(payload.kind)) {
      return null;
    }

    return {
      type: 'webview/createDemoNode',
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

function isCanvasNodePosition(value: unknown): value is CanvasNodePosition {
  return isRecord(value) && typeof value.x === 'number' && typeof value.y === 'number';
}

function isTaskNodeStatus(value: unknown): value is TaskNodeStatus {
  return value === 'todo' || value === 'running' || value === 'blocked' || value === 'done';
}
