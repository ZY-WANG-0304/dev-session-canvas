export type CanvasNode = {
  id: string;
  type: 'note';
  title: string;
  body: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type CanvasViewport = {
  x: number;
  y: number;
  zoom: number;
};

export type HostMessage = {
  type: 'host/bootstrap' | 'host/stateUpdated';
  payload: {
    nodes: CanvasNode[];
    viewport: CanvasViewport;
  };
};

export type WebviewMessage =
  | { type: 'webview/ready' }
  | { type: 'webview/createNote' }
  | { type: 'webview/updateNote'; id: string; title?: string; body?: string; width?: number; height?: number }
  | { type: 'webview/updateNodePosition'; id: string; x: number; y: number }
  | { type: 'webview/updateViewport'; x: number; y: number; zoom: number }
  | { type: 'webview/deleteNode'; id: string };

declare global {
  interface Window {
    devSessionCanvasPostMessage?: (message: WebviewMessage) => void;
    devSessionCanvasReceiveHostMessage?: (message: HostMessage) => void;
  }
}

type HostMessageListener = (message: HostMessage) => void;

export type CanvasHostAdapter = {
  postMessage(message: WebviewMessage): void;
  onMessage(listener: HostMessageListener): () => void;
};

export function createCanvasHostAdapter(): CanvasHostAdapter {
  const listeners = new Set<HostMessageListener>();

  function ensureReceiver(): void {
    window.devSessionCanvasReceiveHostMessage = (message: HostMessage): void => {
      for (const listener of listeners) {
        listener(message);
      }
    };
  }

  ensureReceiver();

  return {
    postMessage(message: WebviewMessage): void {
      ensureReceiver();
      window.devSessionCanvasPostMessage?.(message);
    },
    onMessage(listener: HostMessageListener): () => void {
      ensureReceiver();
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }
  };
}
