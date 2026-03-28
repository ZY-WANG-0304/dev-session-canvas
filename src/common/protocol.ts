export type CanvasNodeKind = 'agent' | 'terminal' | 'task' | 'note';

export interface CanvasNodePosition {
  x: number;
  y: number;
}

export type TerminalRevealMode = 'editor' | 'panel';

export interface AgentNodeMetadata {
  liveRun: boolean;
  lastPrompt?: string;
  lastResponse?: string;
  lastModelName?: string;
  lastRunId?: string;
}

export interface TerminalNodeMetadata {
  terminalName: string;
  liveSession: boolean;
  revealMode: TerminalRevealMode;
}

export interface CanvasNodeMetadata {
  agent?: AgentNodeMetadata;
  terminal?: TerminalNodeMetadata;
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
    };

export type HostToWebviewMessage =
  | {
      type: 'host/bootstrap';
      payload: {
        state: CanvasPrototypeState;
      };
    }
  | {
      type: 'host/stateUpdated';
      payload: {
        state: CanvasPrototypeState;
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
      typeof payload.prompt !== 'string'
    ) {
      return null;
    }

    return {
      type: 'webview/startAgentRun',
      payload: {
        nodeId: payload.nodeId,
        prompt: payload.prompt
      }
    };
  }

  if (value.type === 'webview/moveNode') {
    const payload = isRecord(value.payload) ? value.payload : null;
    if (
      !payload ||
      typeof payload.id !== 'string' ||
      !isCanvasNodePosition(payload.position)
    ) {
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
  return (
    isRecord(value) &&
    typeof value.x === 'number' &&
    typeof value.y === 'number'
  );
}
