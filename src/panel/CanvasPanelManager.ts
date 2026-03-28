import * as vscode from 'vscode';

import {
  type CanvasNodeKind,
  type CanvasNodeMetadata,
  type CanvasNodePosition,
  type CanvasNodeSummary,
  type CanvasPrototypeState,
  type HostToWebviewMessage,
  type TerminalNodeMetadata,
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
    this.state = reconcileTerminalNodes(this.loadState());
    this.persistState();

    context.subscriptions.push(
      vscode.window.onDidCloseTerminal((terminal) => {
        const nextState = updateTerminalConnectionState(this.state, terminal.name, false);
        if (nextState === this.state) {
          return;
        }

        this.state = nextState;
        this.persistState();
        this.postState('host/stateUpdated');
      })
    );
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
    this.state = reconcileTerminalNodes(this.loadState());
    this.persistState();
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
          case 'webview/ensureTerminalSession':
            void this.ensureTerminalSession(parsedMessage.payload.nodeId, true);
            break;
          case 'webview/revealTerminal':
            void this.revealTerminal(parsedMessage.payload.nodeId);
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

  private async ensureTerminalSession(nodeId: string, reveal: boolean): Promise<void> {
    const terminalNode = this.state.nodes.find((node) => node.id === nodeId && node.kind === 'terminal');
    if (!terminalNode) {
      this.postMessage({
        type: 'host/error',
        payload: {
          message: '未找到可创建终端的节点。'
        }
      });
      return;
    }

    const metadata = ensureTerminalMetadata(terminalNode);
    const existingTerminal = findTerminalByName(metadata.terminalName);
    const terminal =
      existingTerminal ??
      vscode.window.createTerminal({
        name: metadata.terminalName,
        location:
          metadata.revealMode === 'editor'
            ? { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false }
            : vscode.TerminalLocation.Panel
      });

    if (reveal) {
      terminal.show(false);
    }

    this.state = updateTerminalNode(this.state, nodeId, {
      status: 'live',
      summary:
        metadata.revealMode === 'editor'
          ? '宿主终端已就绪，可在编辑器区域查看和使用。'
          : '宿主终端已就绪，可在终端面板查看和使用。',
      metadata: {
        terminal: {
          ...metadata,
          liveSession: true
        }
      }
    });
    this.persistState();
    this.postState('host/stateUpdated');
  }

  private async revealTerminal(nodeId: string): Promise<void> {
    const terminalNode = this.state.nodes.find((node) => node.id === nodeId && node.kind === 'terminal');
    if (!terminalNode) {
      this.postMessage({
        type: 'host/error',
        payload: {
          message: '未找到可显示的终端节点。'
        }
      });
      return;
    }

    const metadata = terminalNode.metadata?.terminal;
    if (!metadata) {
      await this.ensureTerminalSession(nodeId, true);
      return;
    }

    const terminal = findTerminalByName(metadata.terminalName);
    if (!terminal) {
      await this.ensureTerminalSession(nodeId, true);
      return;
    }

    terminal.show(false);

    if (!metadata.liveSession) {
      this.state = updateTerminalNode(this.state, nodeId, {
        status: 'live',
        summary: '已重新连接到现存宿主终端。',
        metadata: {
          terminal: {
            ...metadata,
            liveSession: true
          }
        }
      });
      this.persistState();
      this.postState('host/stateUpdated');
    }
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
    terminal: '尚未创建宿主终端，选中后可创建并显示。',
    task: '用于验证任务状态展示的占位节点',
    note: '用于验证最小协作上下文的占位节点'
  } satisfies Record<CanvasNodeKind, string>;

  const id = `${kind}-${sequence}`;
  return {
    id,
    kind,
    title: `${titlePrefix[kind]} ${sequence}`,
    status: kind === 'terminal' ? 'draft' : sequence % 2 === 0 ? 'running' : 'idle',
    summary: summaryPrefix[kind],
    position: createNodePosition(sequence),
    metadata: createNodeMetadata(kind, id)
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
    nodes: reconcileTerminalNodesInArray(nodes.length > 0 ? nodes : createDefaultState().nodes)
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
    ,
    metadata: normalizeMetadata(value.kind, value.id, value.metadata)
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

function createNodeMetadata(kind: CanvasNodeKind, nodeId: string): CanvasNodeMetadata | undefined {
  if (kind !== 'terminal') {
    return undefined;
  }

  return {
    terminal: createTerminalMetadata(nodeId)
  };
}

function createTerminalMetadata(nodeId: string): TerminalNodeMetadata {
  return {
    terminalName: `OpenCove Terminal · ${nodeId}`,
    liveSession: false,
    revealMode: 'editor'
  };
}

function normalizeMetadata(
  kind: CanvasNodeKind,
  nodeId: string,
  value: unknown
): CanvasNodeMetadata | undefined {
  if (kind !== 'terminal') {
    return undefined;
  }

  const record = isRecord(value) ? value : {};
  const terminal = isRecord(record.terminal) ? record.terminal : {};
  const fallback = createTerminalMetadata(nodeId);

  return {
    terminal: {
      terminalName:
        typeof terminal.terminalName === 'string' ? terminal.terminalName : fallback.terminalName,
      liveSession: false,
      revealMode:
        terminal.revealMode === 'panel' || terminal.revealMode === 'editor'
          ? terminal.revealMode
          : fallback.revealMode
    }
  };
}

function reconcileTerminalNodes(state: CanvasPrototypeState): CanvasPrototypeState {
  return {
    ...state,
    nodes: reconcileTerminalNodesInArray(state.nodes)
  };
}

function reconcileTerminalNodesInArray(nodes: CanvasNodeSummary[]): CanvasNodeSummary[] {
  return nodes.map((node) => {
    if (node.kind !== 'terminal') {
      return node;
    }

    const metadata = ensureTerminalMetadata(node);
    const liveTerminal = findTerminalByName(metadata.terminalName);

    return {
      ...node,
      status: liveTerminal ? 'live' : node.status === 'live' ? 'closed' : node.status,
      summary: liveTerminal
        ? '已匹配到现存宿主终端，可直接显示。'
        : node.status === 'closed'
          ? '宿主终端已关闭，可重新创建。'
          : node.summary,
      metadata: {
        terminal: {
          ...metadata,
          liveSession: Boolean(liveTerminal)
        }
      }
    };
  });
}

function updateTerminalConnectionState(
  state: CanvasPrototypeState,
  terminalName: string,
  liveSession: boolean
): CanvasPrototypeState {
  let hasChanged = false;
  const nextNodes = state.nodes.map((node) => {
    if (node.kind !== 'terminal' || node.metadata?.terminal?.terminalName !== terminalName) {
      return node;
    }

    hasChanged = true;
    return {
      ...node,
      status: liveSession ? 'live' : 'closed',
      summary: liveSession
        ? '宿主终端已连接，可直接显示。'
        : '宿主终端已关闭，可重新创建。',
      metadata: {
        terminal: {
          ...ensureTerminalMetadata(node),
          liveSession
        }
      }
    };
  });

  if (!hasChanged) {
    return state;
  }

  return {
    ...state,
    updatedAt: new Date().toISOString(),
    nodes: nextNodes
  };
}

function updateTerminalNode(
  state: CanvasPrototypeState,
  nodeId: string,
  patch: Pick<CanvasNodeSummary, 'status' | 'summary' | 'metadata'>
): CanvasPrototypeState {
  const nextNodes = state.nodes.map((node) =>
    node.id === nodeId
      ? {
          ...node,
          status: patch.status,
          summary: patch.summary,
          metadata: patch.metadata
        }
      : node
  );

  return {
    ...state,
    updatedAt: new Date().toISOString(),
    nodes: nextNodes
  };
}

function ensureTerminalMetadata(node: CanvasNodeSummary): TerminalNodeMetadata {
  return node.metadata?.terminal ?? createTerminalMetadata(node.id);
}

function findTerminalByName(name: string): vscode.Terminal | undefined {
  return vscode.window.terminals.find((terminal) => terminal.name === name);
}
