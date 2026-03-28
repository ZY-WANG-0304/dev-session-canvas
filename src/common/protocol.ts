export type CanvasNodeKind = 'agent' | 'terminal' | 'task' | 'note';

export interface CanvasNodePosition {
  x: number;
  y: number;
}

export interface CanvasNodeSummary {
  id: string;
  kind: CanvasNodeKind;
  title: string;
  status: string;
  summary: string;
  position: CanvasNodePosition;
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
