import * as vscode from 'vscode';

import {
  type CanvasNodeKind,
  type CanvasNodePosition,
  type CanvasNodeSummary,
  type CanvasPrototypeState,
  type HostToWebviewMessage,
  isCanvasNodeKind,
  parseWebviewMessage
} from '../common/protocol';
import { getWebviewHtml } from './getWebviewHtml';

const CANVAS_STATE_STORAGE_KEY = 'opencove.canvas.prototypeState';

export class CanvasPanelManager implements vscode.WebviewPanelSerializer {
  public static readonly viewType = 'opencove.canvas';

  private panel: vscode.WebviewPanel | undefined;
  private state: CanvasPrototypeState;

  public constructor(private readonly context: vscode.ExtensionContext) {
    this.state = this.loadState();
  }

  public async revealOrCreate(): Promise<void> {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.One);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      CanvasPanelManager.viewType,
      'OpenCove Canvas',
      vscode.ViewColumn.One,
      this.getWebviewOptions()
    );

    this.attachPanel(panel);
  }

  public async deserializeWebviewPanel(
    webviewPanel: vscode.WebviewPanel,
    _state: unknown
  ): Promise<void> {
    this.state = this.loadState();
    this.attachPanel(webviewPanel);
  }

  private attachPanel(panel: vscode.WebviewPanel): void {
    this.panel = panel;
    panel.webview.options = this.getWebviewOptions();
    panel.webview.html = getWebviewHtml(panel.webview, this.context.extensionUri);

    panel.onDidDispose(
      () => {
        if (this.panel === panel) {
          this.panel = undefined;
        }
      },
      null,
      this.context.subscriptions
    );

    panel.webview.onDidReceiveMessage(
      (message) => {
        const parsedMessage = parseWebviewMessage(message);
        if (!parsedMessage) {
          this.postMessage({
            type: 'host/error',
            payload: {
              message: '收到无法识别的消息，已忽略。'
            }
          });
          return;
        }

        switch (parsedMessage.type) {
          case 'webview/ready':
            this.postState('host/bootstrap');
            break;
          case 'webview/createDemoNode':
            this.state = createNextState(this.state, parsedMessage.payload.kind);
            this.persistState();
            this.postState('host/stateUpdated');
            break;
          case 'webview/moveNode':
            this.state = moveNode(this.state, parsedMessage.payload.id, parsedMessage.payload.position);
            this.persistState();
            this.postState('host/stateUpdated');
            break;
          case 'webview/resetDemoState':
            this.state = createDefaultState();
            this.persistState();
            this.postState('host/stateUpdated');
            break;
        }
      },
      null,
      this.context.subscriptions
    );
  }

  private getWebviewOptions(): vscode.WebviewOptions & vscode.WebviewPanelOptions {
    return {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'dist')]
    };
  }

  private loadState(): CanvasPrototypeState {
    const rawState = this.context.workspaceState.get<unknown>(CANVAS_STATE_STORAGE_KEY);
    return normalizeState(rawState);
  }

  private persistState(): void {
    void this.context.workspaceState.update(CANVAS_STATE_STORAGE_KEY, this.state);
  }

  private postState(type: 'host/bootstrap' | 'host/stateUpdated'): void {
    this.postMessage({
      type,
      payload: {
        state: this.state
      }
    });
  }

  private postMessage(message: HostToWebviewMessage): void {
    void this.panel?.webview.postMessage(message);
  }
}

function createDefaultState(): CanvasPrototypeState {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    nodes: [
      createNode('note', 1),
      createNode('task', 2)
    ]
  };
}

function createNextState(
  previousState: CanvasPrototypeState,
  kind: CanvasNodeKind
): CanvasPrototypeState {
  const nextIndex = previousState.nodes.length + 1;
  const nextNode = createNode(kind, nextIndex);

  return {
    ...previousState,
    updatedAt: new Date().toISOString(),
    nodes: [...previousState.nodes, nextNode]
  };
}

function createNode(kind: CanvasNodeKind, sequence: number): CanvasNodeSummary {
  const titlePrefix = {
    agent: 'Agent',
    terminal: 'Terminal',
    task: 'Task',
    note: 'Note'
  } satisfies Record<CanvasNodeKind, string>;

  const summaryPrefix = {
    agent: '等待接入真实 backend 的原型节点',
    terminal: '可跳转到宿主终端的占位节点',
    task: '用于验证任务状态展示的占位节点',
    note: '用于验证最小协作上下文的占位节点'
  } satisfies Record<CanvasNodeKind, string>;

  return {
    id: `${kind}-${sequence}`,
    kind,
    title: `${titlePrefix[kind]} ${sequence}`,
    status: sequence % 2 === 0 ? 'running' : 'idle',
    summary: summaryPrefix[kind],
    position: createNodePosition(sequence)
  };
}

function createNodePosition(sequence: number): CanvasNodePosition {
  const zeroBasedIndex = sequence - 1;
  const column = zeroBasedIndex % 3;
  const row = Math.floor(zeroBasedIndex / 3);

  return {
    x: column * 320,
    y: row * 220
  };
}

function moveNode(
  previousState: CanvasPrototypeState,
  nodeId: string,
  position: CanvasNodePosition
): CanvasPrototypeState {
  const nodes = previousState.nodes.map((node) =>
    node.id === nodeId
      ? {
          ...node,
          position
        }
      : node
  );

  return {
    ...previousState,
    updatedAt: new Date().toISOString(),
    nodes
  };
}

function normalizeState(value: unknown): CanvasPrototypeState {
  if (!isRecord(value)) {
    return createDefaultState();
  }

  const rawNodes = Array.isArray(value.nodes) ? value.nodes : [];
  const nodes = rawNodes
    .map((node, index) => normalizeNode(node, index))
    .filter((node): node is CanvasNodeSummary => node !== null);

  return {
    version: 1,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date().toISOString(),
    nodes: nodes.length > 0 ? nodes : createDefaultState().nodes
  };
}

function normalizeNode(value: unknown, index: number): CanvasNodeSummary | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !isCanvasNodeKind(value.kind)) {
    return null;
  }

  const sequence = index + 1;

  return {
    id: value.id,
    kind: value.kind,
    title: typeof value.title === 'string' ? value.title : `${capitalize(value.kind)} ${sequence}`,
    status: typeof value.status === 'string' ? value.status : 'idle',
    summary:
      typeof value.summary === 'string'
        ? value.summary
        : '从旧状态恢复的节点，已补齐默认摘要。',
    position: normalizePosition(value.position, sequence)
  };
}

function normalizePosition(value: unknown, sequence: number): CanvasNodePosition {
  if (
    isRecord(value) &&
    typeof value.x === 'number' &&
    typeof value.y === 'number'
  ) {
    return {
      x: value.x,
      y: value.y
    };
  }

  return createNodePosition(sequence);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
