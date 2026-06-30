export type CanvasNode = {
  id: string;
  title: string;
  body: string;
  x: number;
  y: number;
};

export type HostMessage = {
  type: 'host/bootstrap' | 'host/stateUpdated';
  payload: {
    nodes: CanvasNode[];
  };
};

export type WebviewMessage =
  | { type: 'webview/ready' }
  | { type: 'webview/createNote' };

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
