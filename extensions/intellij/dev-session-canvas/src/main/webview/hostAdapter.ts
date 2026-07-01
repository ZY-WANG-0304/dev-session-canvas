export type CanvasNode = {
  id: string;
  type: 'note' | 'terminal';
  title: string;
  body: string;
  x: number;
  y: number;
  width: number;
  height: number;
  status: string;
  cwd: string;
  shellPath: string;
  recentOutput: string;
  lastCols: number;
  lastRows: number;
};

export type CanvasViewport = {
  x: number;
  y: number;
  zoom: number;
};

export type HostMessage =
  | {
      type: 'host/bootstrap' | 'host/stateUpdated';
      payload: {
        nodes: CanvasNode[];
        viewport: CanvasViewport;
      };
    }
  | { type: 'host/terminalOutput'; payload: { id: string; text: string } }
  | { type: 'host/terminalExit'; payload: { id: string; status: string; exitCode: number | null; message: string } };

export type WebviewMessage =
  | { type: 'webview/ready' }
  | { type: 'webview/createNote' }
  | { type: 'webview/createTerminal' }
  | { type: 'webview/updateNote'; id: string; title?: string; body?: string; width?: number; height?: number }
  | { type: 'webview/updateNodePosition'; id: string; x: number; y: number }
  | { type: 'webview/updateViewport'; x: number; y: number; zoom: number }
  | { type: 'webview/deleteNode'; id: string }
  | { type: 'webview/terminalInput'; id: string; text: string }
  | { type: 'webview/terminalResize'; id: string; cols: number; rows: number }
  | { type: 'webview/updateTerminalSize'; id: string; width: number; height: number }
  | { type: 'webview/stopTerminal'; id: string };

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
