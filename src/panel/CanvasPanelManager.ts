import * as vscode from 'vscode';

import {
  type AgentNodeMetadata,
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

interface AgentRunSession {
  runId: string;
  cancellationSource: vscode.CancellationTokenSource;
}

export class CanvasPanelManager implements vscode.WebviewPanelSerializer {
  public static readonly viewType = 'opencove.canvas';

  private panel: vscode.WebviewPanel | undefined;
  private state: CanvasPrototypeState;
  private readonly agentRuns = new Map<string, AgentRunSession>();

  public constructor(private readonly context: vscode.ExtensionContext) {
    this.state = reconcileRuntimeNodes(this.loadState());
    this.persistState();

    context.subscriptions.push(
      vscode.window.onDidOpenTerminal((terminal) => {
        this.handleTerminalConnectivityChange(terminal.name, true);
      })
    );

    context.subscriptions.push(
      vscode.window.onDidCloseTerminal((terminal) => {
        this.handleTerminalConnectivityChange(terminal.name, false);
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
    this.state = reconcileRuntimeNodes(this.loadState());
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
          case 'webview/startAgentRun':
            void this.startAgentRun(parsedMessage.payload.nodeId, parsedMessage.payload.prompt);
            break;
          case 'webview/stopAgentRun':
            void this.stopAgentRun(parsedMessage.payload.nodeId);
            break;
          case 'webview/ensureTerminalSession':
            void this.ensureTerminalSession(parsedMessage.payload.nodeId, true);
            break;
          case 'webview/revealTerminal':
            void this.revealTerminal(parsedMessage.payload.nodeId);
            break;
          case 'webview/reconnectTerminal':
            void this.reconnectTerminal(parsedMessage.payload.nodeId);
            break;
          case 'webview/resetDemoState':
            this.cancelAllAgentRuns();
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

  private handleTerminalConnectivityChange(terminalName: string, liveSession: boolean): void {
    const nextState = updateTerminalConnectionState(this.state, terminalName, liveSession);
    if (nextState === this.state) {
      return;
    }

    this.state = nextState;
    this.persistState();
    this.postState('host/stateUpdated');
  }

  private async startAgentRun(nodeId: string, prompt: string): Promise<void> {
    const agentNode = this.state.nodes.find((node) => node.id === nodeId && node.kind === 'agent');
    if (!agentNode) {
      this.postMessage({
        type: 'host/error',
        payload: {
          message: '未找到可运行的 Agent 节点。'
        }
      });
      return;
    }

    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      this.postMessage({
        type: 'host/error',
        payload: {
          message: '请先输入 Agent 目标，再启动运行。'
        }
      });
      return;
    }

    if (!vscode.workspace.isTrusted) {
      this.postMessage({
        type: 'host/error',
        payload: {
          message: '当前 workspace 未受信任，已禁止 Agent 运行。'
        }
      });
      return;
    }

    const existingRun = this.agentRuns.get(nodeId);
    if (existingRun) {
      this.postMessage({
        type: 'host/error',
        payload: {
          message: '该 Agent 已在运行中。'
        }
      });
      return;
    }

    const previousMetadata = ensureAgentMetadata(agentNode);
    const runId = createAgentRunId(nodeId);
    const cancellationSource = new vscode.CancellationTokenSource();
    this.agentRuns.set(nodeId, { runId, cancellationSource });

    let lastModelName = previousMetadata.lastModelName;
    let aggregatedResponse = '';

    this.state = updateAgentNode(this.state, nodeId, {
      status: 'running',
      summary: '正在准备 Agent 运行...',
      metadata: {
        ...agentNode.metadata,
        agent: {
          ...previousMetadata,
          liveRun: true,
          lastPrompt: trimmedPrompt,
          lastResponse: undefined,
          lastRunId: runId
        }
      }
    });
    this.persistState();
    this.postState('host/stateUpdated');

    try {
      const model = await this.resolveAgentModel();
      if (!model) {
        throw new Error('当前 VSCode 中没有可用的语言模型。');
      }

      lastModelName = formatModelLabel(model);
      this.state = updateAgentNode(this.state, nodeId, {
        status: 'running',
        summary: `正在通过 ${lastModelName} 运行 Agent...`,
        metadata: buildAgentMetadataPatch(this.state, nodeId, {
          liveRun: true,
          lastPrompt: trimmedPrompt,
          lastRunId: runId,
          lastModelName,
          lastResponse: undefined
        })
      });
      this.postState('host/stateUpdated');

      const response = await model.sendRequest(
        [
          vscode.LanguageModelChatMessage.User(buildAgentPrompt(trimmedPrompt))
        ],
        {
          justification: '需要让画布中的 Agent 节点根据用户目标生成下一步建议。'
        },
        cancellationSource.token
      );

      for await (const chunk of response.text) {
        if (!this.isActiveAgentRun(nodeId, runId)) {
          return;
        }

        aggregatedResponse = trimStoredAgentText(`${aggregatedResponse}${chunk}`);
        this.state = updateAgentNode(this.state, nodeId, {
          status: 'running',
          summary: summarizeAgentResponse(aggregatedResponse, true),
          metadata: buildAgentMetadataPatch(this.state, nodeId, {
            liveRun: true,
            lastPrompt: trimmedPrompt,
            lastRunId: runId,
            lastModelName,
            lastResponse: aggregatedResponse
          })
        });
        this.postState('host/stateUpdated');
      }

      if (!this.isActiveAgentRun(nodeId, runId)) {
        return;
      }

      this.state = updateAgentNode(this.state, nodeId, {
        status: 'idle',
        summary: summarizeAgentResponse(aggregatedResponse, false),
        metadata: buildAgentMetadataPatch(this.state, nodeId, {
          liveRun: false,
          lastPrompt: trimmedPrompt,
          lastRunId: runId,
          lastModelName,
          lastResponse: aggregatedResponse || undefined
        })
      });
      this.persistState();
      this.postState('host/stateUpdated');
    } catch (error) {
      if (!this.isActiveAgentRun(nodeId, runId)) {
        return;
      }

      const cancelled = cancellationSource.token.isCancellationRequested;
      const errorMessage = cancelled ? '已停止 Agent 运行。' : describeAgentRunError(error);
      this.state = updateAgentNode(this.state, nodeId, {
        status: cancelled ? 'cancelled' : 'error',
        summary: errorMessage,
        metadata: buildAgentMetadataPatch(this.state, nodeId, {
          liveRun: false,
          lastPrompt: trimmedPrompt,
          lastRunId: runId,
          lastModelName,
          lastResponse: aggregatedResponse || undefined
        })
      });
      this.persistState();
      this.postState('host/stateUpdated');

      if (!cancelled) {
        this.postMessage({
          type: 'host/error',
          payload: {
            message: errorMessage
          }
        });
      }
    } finally {
      const activeRun = this.agentRuns.get(nodeId);
      if (activeRun?.runId === runId) {
        this.agentRuns.delete(nodeId);
      }
      cancellationSource.dispose();
    }
  }

  private async stopAgentRun(nodeId: string): Promise<void> {
    const activeRun = this.agentRuns.get(nodeId);
    if (!activeRun) {
      this.postMessage({
        type: 'host/error',
        payload: {
          message: '当前没有可停止的 Agent 运行。'
        }
      });
      return;
    }

    activeRun.cancellationSource.cancel();
  }

  private cancelAllAgentRuns(): void {
    for (const run of this.agentRuns.values()) {
      run.cancellationSource.cancel();
    }
    this.agentRuns.clear();
  }

  private isActiveAgentRun(nodeId: string, runId: string): boolean {
    return this.agentRuns.get(nodeId)?.runId === runId;
  }

  private async resolveAgentModel(): Promise<vscode.LanguageModelChat | undefined> {
    if (!hasLanguageModelApi()) {
      return undefined;
    }

    const preferredModels = await vscode.lm.selectChatModels({ vendor: 'copilot' });
    if (preferredModels.length > 0) {
      return preferredModels[0];
    }

    const fallbackModels = await vscode.lm.selectChatModels();
    return fallbackModels[0];
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

  private async reconnectTerminal(nodeId: string): Promise<void> {
    const terminalNode = this.state.nodes.find((node) => node.id === nodeId && node.kind === 'terminal');
    if (!terminalNode) {
      this.postMessage({
        type: 'host/error',
        payload: {
          message: '未找到可重连的终端节点。'
        }
      });
      return;
    }

    const metadata = ensureTerminalMetadata(terminalNode);
    const terminal = findTerminalByName(metadata.terminalName);
    if (!terminal) {
      this.postMessage({
        type: 'host/error',
        payload: {
          message: '没有找到可重连的现有终端，请使用“创建并显示终端”。'
        }
      });
      return;
    }

    terminal.show(false);
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
      this.postMessage({
        type: 'host/error',
        payload: {
          message: '当前没有可显示的现有终端，请先创建并显示终端。'
        }
      });
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

function defaultSummaryForKind(kind: CanvasNodeKind): string {
  switch (kind) {
    case 'agent':
      return '等待输入目标并启动一次真实运行。';
    case 'terminal':
      return '尚未创建宿主终端，选中后可创建并显示。';
    case 'task':
      return '用于验证任务状态展示的占位节点';
    case 'note':
      return '用于验证最小协作上下文的占位节点';
  }
}

function createNode(kind: CanvasNodeKind, sequence: number): CanvasNodeSummary {
  const titlePrefix = {
    agent: 'Agent',
    terminal: 'Terminal',
    task: 'Task',
    note: 'Note'
  } satisfies Record<CanvasNodeKind, string>;

  const id = `${kind}-${sequence}`;
  return {
    id,
    kind,
    title: `${titlePrefix[kind]} ${sequence}`,
    status:
      kind === 'terminal'
        ? 'draft'
        : kind === 'agent'
          ? 'idle'
          : sequence % 2 === 0
            ? 'running'
            : 'idle',
    summary: defaultSummaryForKind(kind),
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
    nodes: reconcileRuntimeNodesInArray(nodes.length > 0 ? nodes : createDefaultState().nodes)
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
        : defaultSummaryForKind(value.kind),
    position: normalizePosition(value.position, sequence),
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
  if (kind === 'agent') {
    return {
      agent: createAgentMetadata()
    };
  }

  if (kind === 'terminal') {
    return {
      terminal: createTerminalMetadata(nodeId)
    };
  }

  return undefined;
}

function createAgentMetadata(): AgentNodeMetadata {
  return {
    liveRun: false
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
  const record = isRecord(value) ? value : {};
  if (kind === 'agent') {
    const agent = isRecord(record.agent) ? record.agent : {};
    const fallback = createAgentMetadata();

    return {
      agent: {
        liveRun: typeof agent.liveRun === 'boolean' ? agent.liveRun : fallback.liveRun,
        lastPrompt:
          typeof agent.lastPrompt === 'string' ? trimStoredAgentText(agent.lastPrompt) : undefined,
        lastResponse:
          typeof agent.lastResponse === 'string'
            ? trimStoredAgentText(agent.lastResponse)
            : undefined,
        lastModelName:
          typeof agent.lastModelName === 'string' ? agent.lastModelName : undefined,
        lastRunId: typeof agent.lastRunId === 'string' ? agent.lastRunId : undefined
      }
    };
  }

  if (kind === 'terminal') {
    const terminal = isRecord(record.terminal) ? record.terminal : {};
    const fallback = createTerminalMetadata(nodeId);

    return {
      terminal: {
        terminalName:
          typeof terminal.terminalName === 'string'
            ? terminal.terminalName
            : fallback.terminalName,
        liveSession: false,
        revealMode:
          terminal.revealMode === 'panel' || terminal.revealMode === 'editor'
            ? terminal.revealMode
            : fallback.revealMode
      }
    };
  }

  return undefined;
}

function reconcileRuntimeNodes(state: CanvasPrototypeState): CanvasPrototypeState {
  return {
    ...state,
    nodes: reconcileRuntimeNodesInArray(state.nodes)
  };
}

function reconcileRuntimeNodesInArray(nodes: CanvasNodeSummary[]): CanvasNodeSummary[] {
  return reconcileAgentNodesInArray(reconcileTerminalNodesInArray(nodes));
}

function reconcileAgentNodesInArray(nodes: CanvasNodeSummary[]): CanvasNodeSummary[] {
  return nodes.map((node) => {
    if (node.kind !== 'agent') {
      return node;
    }

    const metadata = ensureAgentMetadata(node);
    if (metadata.liveRun) {
      return {
        ...node,
        status: 'interrupted',
        summary: '上一次 Agent 运行在扩展重载后未恢复，可重新启动。',
        metadata: {
          ...node.metadata,
          agent: {
            ...metadata,
            liveRun: false
          }
        }
      };
    }

    if (isLegacyPlaceholderAgent(node, metadata)) {
      return {
        ...node,
        status: 'idle',
        summary: defaultSummaryForKind('agent'),
        metadata: {
          ...node.metadata,
          agent: metadata
        }
      };
    }

    return {
      ...node,
      metadata: {
        ...node.metadata,
        agent: metadata
      }
    };
  });
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

function updateCanvasNode(
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

function updateTerminalNode(
  state: CanvasPrototypeState,
  nodeId: string,
  patch: Pick<CanvasNodeSummary, 'status' | 'summary' | 'metadata'>
): CanvasPrototypeState {
  return updateCanvasNode(state, nodeId, patch);
}

function updateAgentNode(
  state: CanvasPrototypeState,
  nodeId: string,
  patch: Pick<CanvasNodeSummary, 'status' | 'summary' | 'metadata'>
): CanvasPrototypeState {
  return updateCanvasNode(state, nodeId, patch);
}

function ensureAgentMetadata(node: CanvasNodeSummary): AgentNodeMetadata {
  return node.metadata?.agent ?? createAgentMetadata();
}

function ensureTerminalMetadata(node: CanvasNodeSummary): TerminalNodeMetadata {
  return node.metadata?.terminal ?? createTerminalMetadata(node.id);
}

function buildAgentMetadataPatch(
  state: CanvasPrototypeState,
  nodeId: string,
  patch: AgentNodeMetadata
): CanvasNodeMetadata {
  const currentNode = state.nodes.find((node) => node.id === nodeId);

  return {
    ...currentNode?.metadata,
    agent: {
      ...(currentNode ? ensureAgentMetadata(currentNode) : createAgentMetadata()),
      ...patch
    }
  };
}

function isLegacyPlaceholderAgent(
  node: CanvasNodeSummary,
  metadata: AgentNodeMetadata
): boolean {
  return (
    node.summary === '等待接入真实 backend 的原型节点' &&
    !metadata.liveRun &&
    !metadata.lastPrompt &&
    !metadata.lastResponse &&
    !metadata.lastModelName &&
    !metadata.lastRunId
  );
}

function createAgentRunId(nodeId: string): string {
  return `${nodeId}-${Date.now().toString(36)}`;
}

function hasLanguageModelApi(): boolean {
  return typeof vscode.lm?.selectChatModels === 'function';
}

function formatModelLabel(model: vscode.LanguageModelChat): string {
  const vendorLabel = [model.vendor, model.family].filter(Boolean).join('/');
  if (!vendorLabel || model.name.includes(vendorLabel)) {
    return model.name;
  }

  return `${model.name} (${vendorLabel})`;
}

function buildAgentPrompt(prompt: string): string {
  return [
    '你是 OpenCove 画布中的最小 Agent 原型。',
    '请基于用户目标给出：1. 目标理解 2. 下一步建议 3. 主要风险。',
    `用户目标：${prompt}`
  ].join('\n\n');
}

function summarizeAgentResponse(response: string, running: boolean): string {
  const normalized = response.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return running ? 'Agent 已启动，正在等待模型响应...' : 'Agent 已完成，但未返回可展示文本。';
  }

  return normalized.length > 140 ? `${normalized.slice(0, 140)}...` : normalized;
}

function trimStoredAgentText(value: string): string {
  return value.length > 4000 ? value.slice(0, 4000) : value;
}

function describeAgentRunError(error: unknown): string {
  if (error instanceof vscode.LanguageModelError) {
    switch (error.code) {
      case vscode.LanguageModelError.NoPermissions.name:
        return '当前未获得语言模型访问授权，请授权后重试。';
      case vscode.LanguageModelError.Blocked.name:
        return '当前语言模型请求被限制或额度已用尽，请稍后重试。';
      case vscode.LanguageModelError.NotFound.name:
        return '当前选择的语言模型不可用，请重新运行。';
      default:
        return error.message || 'Agent 运行失败。';
    }
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return 'Agent 运行失败。';
}

function findTerminalByName(name: string): vscode.Terminal | undefined {
  return vscode.window.terminals.find((terminal) => terminal.name === name);
}
