import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import * as vscode from 'vscode';

import {
  type AgentNodeMetadata,
  type AgentProviderKind,
  type AgentTranscriptEntry,
  type CanvasNodeKind,
  type CanvasNodeMetadata,
  type CanvasNodePosition,
  type CanvasRuntimeContext,
  type CanvasNodeSummary,
  type CanvasPrototypeState,
  type HostToWebviewMessage,
  type NoteNodeMetadata,
  type TaskNodeMetadata,
  type TaskNodeStatus,
  type TerminalNodeMetadata,
  isCanvasNodeKind,
  parseWebviewMessage
} from '../common/protocol';
import { getWebviewHtml } from './getWebviewHtml';

const CANVAS_STATE_STORAGE_KEY = 'opencove.canvas.prototypeState';

interface AgentRunSession {
  runId: string;
  provider: AgentProviderKind;
  process: ChildProcessWithoutNullStreams;
  stopRequested: boolean;
  stdout: string;
  stderr: string;
}

interface AgentCliConfig {
  defaultProvider: AgentProviderKind;
  codexCommand: string;
  claudeCommand: string;
}

interface AgentCliSpec {
  provider: AgentProviderKind;
  label: string;
  command: string;
  args: string[];
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

    context.subscriptions.push(
      vscode.workspace.onDidGrantWorkspaceTrust(() => {
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
            if (
              isExecutionNodeKind(parsedMessage.payload.kind) &&
              !this.assertExecutionAllowed('当前 workspace 未受信任，已禁止创建 Agent / Terminal 节点。')
            ) {
              break;
            }

            this.state = createNextState(
              this.state,
              parsedMessage.payload.kind,
              this.getAgentCliConfig().defaultProvider
            );
            this.persistState();
            this.postState('host/stateUpdated');
            break;
          case 'webview/moveNode':
            this.state = moveNode(this.state, parsedMessage.payload.id, parsedMessage.payload.position);
            this.persistState();
            this.postState('host/stateUpdated');
            break;
          case 'webview/startAgentRun':
            void this.startAgentRun(
              parsedMessage.payload.nodeId,
              parsedMessage.payload.prompt,
              parsedMessage.payload.provider
            );
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
          case 'webview/updateTaskNode':
            this.state = updateTaskContent(this.state, parsedMessage.payload);
            this.persistState();
            this.postState('host/stateUpdated');
            break;
          case 'webview/updateNoteNode':
            this.state = updateNoteContent(this.state, parsedMessage.payload);
            this.persistState();
            this.postState('host/stateUpdated');
            break;
          case 'webview/resetDemoState':
            this.cancelAllAgentRuns();
            this.state = createDefaultState(this.getAgentCliConfig().defaultProvider);
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
    return normalizeState(rawState, this.getAgentCliConfig().defaultProvider);
  }

  private persistState(): void {
    void this.context.workspaceState.update(CANVAS_STATE_STORAGE_KEY, this.state);
  }

  private postState(type: 'host/bootstrap' | 'host/stateUpdated'): void {
    this.postMessage({
      type,
      payload: {
        state: this.state,
        runtime: this.getRuntimeContext()
      }
    });
  }

  private postMessage(message: HostToWebviewMessage): void {
    void this.panel?.webview.postMessage(message);
  }

  private getRuntimeContext(): CanvasRuntimeContext {
    return {
      workspaceTrusted: vscode.workspace.isTrusted
    };
  }

  private assertExecutionAllowed(errorMessage: string): boolean {
    if (vscode.workspace.isTrusted) {
      return true;
    }

    this.postMessage({
      type: 'host/error',
      payload: {
        message: errorMessage
      }
    });
    return false;
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

  private async startAgentRun(
    nodeId: string,
    prompt: string,
    provider: AgentProviderKind
  ): Promise<void> {
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

    if (!this.assertExecutionAllowed('当前 workspace 未受信任，已禁止 Agent 运行。')) {
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

    const runId = createAgentRunId(nodeId);
    const cliSpec = this.resolveAgentCli(provider);
    const initialTranscript = beginAgentTranscript(
      ensureAgentMetadata(agentNode).transcript ?? [],
      runId,
      trimmedPrompt
    );
    let aggregatedResponse = '';
    let aggregatedError = '';

    this.state = updateAgentNode(this.state, nodeId, {
      status: 'running',
      summary: `正在准备 ${cliSpec.label} 会话...`,
      metadata: buildAgentMetadataPatch(this.state, nodeId, {
        provider,
        liveRun: true,
        transcript: initialTranscript,
        lastPrompt: trimmedPrompt,
        lastResponse: undefined,
        lastRunId: runId,
        lastBackendLabel: cliSpec.label
      })
    });
    this.persistState();
    this.postState('host/stateUpdated');

    try {
      const respawnedChild = spawn(cliSpec.command, [...cliSpec.args, trimmedPrompt], {
        cwd: this.getWorkspaceRoot(),
        env: process.env
      });

      const session: AgentRunSession = {
        runId,
        provider,
        process: respawnedChild,
        stopRequested: false,
        stdout: '',
        stderr: ''
      };
      this.agentRuns.set(nodeId, session);

      let settled = false;
      const finalize = (status: 'idle' | 'error' | 'cancelled', message?: string): void => {
        if (settled) {
          return;
        }

        settled = true;
        if (this.isActiveAgentRun(nodeId, runId)) {
          this.agentRuns.delete(nodeId);
        }

        const finalOutput = trimStoredAgentText(stripAnsi(session.stdout).trim());
        const finalError = trimStoredAgentText(stripAnsi(session.stderr).trim());
        const summary =
          status === 'idle'
            ? summarizeAgentResponse(finalOutput, false)
            : message ?? summarizeAgentFailure(finalError || finalOutput);
        const transcript = finalizeAgentTranscript(
          readAgentTranscript(this.state, nodeId),
          runId,
          status,
          finalOutput,
          message ?? finalError
        );

        this.state = updateAgentNode(this.state, nodeId, {
          status,
          summary,
          metadata: buildAgentMetadataPatch(this.state, nodeId, {
            provider,
            liveRun: false,
            transcript,
            lastPrompt: trimmedPrompt,
            lastRunId: runId,
            lastBackendLabel: cliSpec.label,
            lastResponse: finalOutput || undefined
          })
        });
        this.persistState();
        this.postState('host/stateUpdated');

        if (status === 'error') {
          this.postMessage({
            type: 'host/error',
            payload: {
              message: summary
            }
          });
        }
      };

      respawnedChild.stdout.on('data', (chunk: Buffer | string) => {
        if (!this.isActiveAgentRun(nodeId, runId)) {
          return;
        }

        const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
        session.stdout = trimStoredAgentText(`${session.stdout}${text}`);
        aggregatedResponse = trimStoredAgentText(stripAnsi(session.stdout).trim());
        const transcript = updateAssistantTranscript(
          readAgentTranscript(this.state, nodeId),
          runId,
          aggregatedResponse,
          'streaming'
        );

        this.state = updateAgentNode(this.state, nodeId, {
          status: 'running',
          summary: summarizeAgentResponse(aggregatedResponse, true),
          metadata: buildAgentMetadataPatch(this.state, nodeId, {
            provider,
            liveRun: true,
            transcript,
            lastPrompt: trimmedPrompt,
            lastRunId: runId,
            lastBackendLabel: cliSpec.label,
            lastResponse: aggregatedResponse || undefined
          })
        });
        this.postState('host/stateUpdated');
      });

      respawnedChild.stderr.on('data', (chunk: Buffer | string) => {
        if (!this.isActiveAgentRun(nodeId, runId)) {
          return;
        }

        const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
        session.stderr = trimStoredAgentText(`${session.stderr}${text}`);
        aggregatedError = trimStoredAgentText(stripAnsi(session.stderr).trim());

        if (!aggregatedResponse) {
          this.state = updateAgentNode(this.state, nodeId, {
            status: 'running',
            summary: summarizeAgentFailure(aggregatedError, true),
            metadata: buildAgentMetadataPatch(this.state, nodeId, {
              provider,
              liveRun: true,
              lastPrompt: trimmedPrompt,
              lastRunId: runId,
              lastBackendLabel: cliSpec.label
            })
          });
          this.postState('host/stateUpdated');
        }
      });

      respawnedChild.once('error', (error) => {
        finalize('error', describeAgentCliSpawnError(cliSpec, error));
      });

      respawnedChild.once('close', (code, signal) => {
        if (session.stopRequested) {
          finalize('cancelled', `已停止 ${cliSpec.label} 会话。`);
          return;
        }

        if (code === 0) {
          finalize('idle');
          return;
        }

        finalize(
          'error',
          describeAgentCliExit(cliSpec, code, signal, aggregatedError || aggregatedResponse)
        );
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Agent CLI 会话启动失败。';
      this.state = updateAgentNode(this.state, nodeId, {
        status: 'error',
        summary: errorMessage,
        metadata: buildAgentMetadataPatch(this.state, nodeId, {
          provider,
          liveRun: false,
          transcript: finalizeAgentTranscript(
            readAgentTranscript(this.state, nodeId),
            runId,
            'error',
            '',
            errorMessage
          ),
          lastPrompt: trimmedPrompt,
          lastRunId: runId,
          lastBackendLabel: cliSpec.label
        })
      });
      this.persistState();
      this.postState('host/stateUpdated');
      this.postMessage({
        type: 'host/error',
        payload: {
          message: errorMessage
        }
      });
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

    activeRun.stopRequested = true;
    activeRun.process.kill('SIGTERM');
  }

  private cancelAllAgentRuns(): void {
    for (const run of this.agentRuns.values()) {
      run.stopRequested = true;
      run.process.kill('SIGTERM');
    }
    this.agentRuns.clear();
  }

  private isActiveAgentRun(nodeId: string, runId: string): boolean {
    return this.agentRuns.get(nodeId)?.runId === runId;
  }

  private getAgentCliConfig(): AgentCliConfig {
    const configuration = vscode.workspace.getConfiguration('opencove.agent');
    const defaultProvider = configuration.get<AgentProviderKind>('defaultProvider', 'codex');

    return {
      defaultProvider: defaultProvider === 'claude' ? 'claude' : 'codex',
      codexCommand: configuration.get<string>('codexCommand', 'codex').trim() || 'codex',
      claudeCommand: configuration.get<string>('claudeCommand', 'claude').trim() || 'claude'
    };
  }

  private resolveAgentCli(provider: AgentProviderKind): AgentCliSpec {
    const configuration = this.getAgentCliConfig();
    if (provider === 'claude') {
      return {
        provider,
        label: 'Claude Code',
        command: configuration.claudeCommand,
        args: ['--print']
      };
    }

    return {
      provider: 'codex',
      label: 'Codex',
      command: configuration.codexCommand,
      args: ['exec', '--color', 'never']
    };
  }

  private getWorkspaceRoot(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  private async ensureTerminalSession(nodeId: string, reveal: boolean): Promise<void> {
    if (!this.assertExecutionAllowed('当前 workspace 未受信任，已禁止终端操作。')) {
      return;
    }

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
    if (!this.assertExecutionAllowed('当前 workspace 未受信任，已禁止终端操作。')) {
      return;
    }

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
    if (!this.assertExecutionAllowed('当前 workspace 未受信任，已禁止终端操作。')) {
      return;
    }

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

function createDefaultState(defaultAgentProvider: AgentProviderKind = 'codex'): CanvasPrototypeState {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    nodes: [
      createNode('note', 1, defaultAgentProvider),
      createNode('task', 2, defaultAgentProvider)
    ]
  };
}

function isExecutionNodeKind(kind: CanvasNodeKind): boolean {
  return kind === 'agent' || kind === 'terminal';
}

function createNextState(
  previousState: CanvasPrototypeState,
  kind: CanvasNodeKind,
  defaultAgentProvider: AgentProviderKind = 'codex'
): CanvasPrototypeState {
  const nextIndex = previousState.nodes.length + 1;
  const nextNode = createNode(kind, nextIndex, defaultAgentProvider);

  return {
    ...previousState,
    updatedAt: new Date().toISOString(),
    nodes: [...previousState.nodes, nextNode]
  };
}

function defaultSummaryForKind(kind: CanvasNodeKind): string {
  switch (kind) {
    case 'agent':
      return '等待在节点内输入第一条消息，并启动真实 CLI Agent 运行。';
    case 'terminal':
      return '尚未创建宿主终端，选中后可创建并显示。';
    case 'task':
      return '等待补充任务描述。';
    case 'note':
      return '等待记录笔记内容。';
  }
}

function defaultStatusForKind(kind: CanvasNodeKind): string {
  switch (kind) {
    case 'agent':
      return 'idle';
    case 'terminal':
      return 'draft';
    case 'task':
      return 'todo';
    case 'note':
      return 'ready';
  }
}

function createNode(
  kind: CanvasNodeKind,
  sequence: number,
  defaultAgentProvider: AgentProviderKind = 'codex'
): CanvasNodeSummary {
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
    status: defaultStatusForKind(kind),
    summary: defaultSummaryForKind(kind),
    position: createNodePosition(sequence),
    metadata: createNodeMetadata(kind, id, defaultAgentProvider)
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

function normalizeState(
  value: unknown,
  defaultAgentProvider: AgentProviderKind = 'codex'
): CanvasPrototypeState {
  if (!isRecord(value)) {
    return createDefaultState(defaultAgentProvider);
  }

  const rawNodes = Array.isArray(value.nodes) ? value.nodes : [];
  const nodes = rawNodes
    .map((node, index) => normalizeNode(node, index, defaultAgentProvider))
    .filter((node): node is CanvasNodeSummary => node !== null);

  return {
    version: 1,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date().toISOString(),
    nodes: reconcileRuntimeNodesInArray(
      nodes.length > 0 ? nodes : createDefaultState(defaultAgentProvider).nodes
    )
  };
}

function normalizeNode(
  value: unknown,
  index: number,
  defaultAgentProvider: AgentProviderKind = 'codex'
): CanvasNodeSummary | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !isCanvasNodeKind(value.kind)) {
    return null;
  }

  const sequence = index + 1;

  return {
    id: value.id,
    kind: value.kind,
    title: typeof value.title === 'string' ? value.title : `${capitalize(value.kind)} ${sequence}`,
    status: typeof value.status === 'string' ? value.status : defaultStatusForKind(value.kind),
    summary:
      typeof value.summary === 'string'
        ? value.summary
        : defaultSummaryForKind(value.kind),
    position: normalizePosition(value.position, sequence),
    metadata: normalizeMetadata(value.kind, value.id, value.metadata, defaultAgentProvider)
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

function createNodeMetadata(
  kind: CanvasNodeKind,
  nodeId: string,
  defaultAgentProvider: AgentProviderKind = 'codex'
): CanvasNodeMetadata | undefined {
  if (kind === 'agent') {
    return {
      agent: createAgentMetadata(defaultAgentProvider)
    };
  }

  if (kind === 'terminal') {
    return {
      terminal: createTerminalMetadata(nodeId)
    };
  }

  if (kind === 'task') {
    return {
      task: createTaskMetadata()
    };
  }

  if (kind === 'note') {
    return {
      note: createNoteMetadata()
    };
  }

  return undefined;
}

function createAgentMetadata(provider: AgentProviderKind = 'codex'): AgentNodeMetadata {
  return {
    provider,
    liveRun: false,
    transcript: []
  };
}

function createTerminalMetadata(nodeId: string): TerminalNodeMetadata {
  return {
    terminalName: `OpenCove Terminal · ${nodeId}`,
    liveSession: false,
    revealMode: 'editor'
  };
}

function createTaskMetadata(): TaskNodeMetadata {
  return {
    description: '',
    assignee: ''
  };
}

function createNoteMetadata(): NoteNodeMetadata {
  return {
    content: ''
  };
}

function normalizeMetadata(
  kind: CanvasNodeKind,
  nodeId: string,
  value: unknown,
  defaultAgentProvider: AgentProviderKind = 'codex'
): CanvasNodeMetadata | undefined {
  const record = isRecord(value) ? value : {};
  if (kind === 'agent') {
    const agent = isRecord(record.agent) ? record.agent : {};
    const fallback = createAgentMetadata(defaultAgentProvider);

    return {
      agent: {
        provider:
          agent.provider === 'claude' || agent.provider === 'codex'
            ? agent.provider
            : fallback.provider,
        liveRun: typeof agent.liveRun === 'boolean' ? agent.liveRun : fallback.liveRun,
        transcript: normalizeAgentTranscript(agent.transcript),
        lastPrompt:
          typeof agent.lastPrompt === 'string' ? trimStoredAgentText(agent.lastPrompt) : undefined,
        lastResponse:
          typeof agent.lastResponse === 'string'
            ? trimStoredAgentText(agent.lastResponse)
            : undefined,
        lastBackendLabel:
          typeof agent.lastBackendLabel === 'string'
            ? agent.lastBackendLabel
            : typeof agent.lastModelName === 'string'
              ? agent.lastModelName
              : undefined,
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

  if (kind === 'task') {
    const task = isRecord(record.task) ? record.task : {};
    const fallback = createTaskMetadata();

    return {
      task: {
        description:
          typeof task.description === 'string'
            ? trimStoredNodeText(task.description)
            : fallback.description,
        assignee:
          typeof task.assignee === 'string'
            ? trimStoredNodeText(task.assignee)
            : fallback.assignee
      }
    };
  }

  if (kind === 'note') {
    const note = isRecord(record.note) ? record.note : {};
    const fallback = createNoteMetadata();

    return {
      note: {
        content:
          typeof note.content === 'string'
            ? trimStoredNodeText(note.content)
            : fallback.content
      }
    };
  }

  return undefined;
}

function normalizeAgentTranscript(value: unknown): AgentTranscriptEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return trimAgentTranscript(
    value
      .map((entry) => normalizeAgentTranscriptEntry(entry))
      .filter((entry): entry is AgentTranscriptEntry => entry !== null)
  );
}

function normalizeAgentTranscriptEntry(value: unknown): AgentTranscriptEntry | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.text !== 'string') {
    return null;
  }

  if (value.role !== 'user' && value.role !== 'assistant' && value.role !== 'status') {
    return null;
  }

  const state =
    value.state === 'streaming' || value.state === 'done' || value.state === 'error'
      ? value.state
      : undefined;

  return {
    id: value.id,
    role: value.role,
    text: trimStoredAgentText(value.text),
    state
  };
}

function reconcileRuntimeNodes(state: CanvasPrototypeState): CanvasPrototypeState {
  return {
    ...state,
    nodes: reconcileRuntimeNodesInArray(state.nodes)
  };
}

function reconcileRuntimeNodesInArray(nodes: CanvasNodeSummary[]): CanvasNodeSummary[] {
  return reconcileTaskAndNoteNodesInArray(
    reconcileAgentNodesInArray(reconcileTerminalNodesInArray(nodes))
  );
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
            liveRun: false,
            transcript: markAgentTranscriptInterrupted(
              metadata.transcript ?? [],
              metadata.lastRunId,
              '扩展重载后，本轮运行未恢复。'
            )
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

function reconcileTaskAndNoteNodesInArray(nodes: CanvasNodeSummary[]): CanvasNodeSummary[] {
  return nodes.map((node) => {
    if (node.kind === 'task') {
      const metadata = ensureTaskMetadata(node);
      const shouldMigrate =
        node.summary === '用于验证任务状态展示的占位节点' ||
        !node.metadata?.task;

      return {
        ...node,
        status:
          node.status === 'todo' || node.status === 'running' || node.status === 'blocked' || node.status === 'done'
            ? node.status
            : 'todo',
        summary: shouldMigrate
          ? summarizeTaskNode(metadata.description, metadata.assignee, 'todo')
          : node.summary,
        metadata: {
          ...node.metadata,
          task: metadata
        }
      };
    }

    if (node.kind === 'note') {
      const metadata = ensureNoteMetadata(node);
      const shouldMigrate =
        node.summary === '用于验证最小协作上下文的占位节点' ||
        !node.metadata?.note;

      return {
        ...node,
        status: node.status === 'ready' ? node.status : 'ready',
        summary: shouldMigrate ? summarizeNoteNode(metadata.content) : node.summary,
        metadata: {
          ...node.metadata,
          note: metadata
        }
      };
    }

    return node;
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

function updateTaskContent(
  state: CanvasPrototypeState,
  payload: {
    nodeId: string;
    title: string;
    status: TaskNodeStatus;
    description: string;
    assignee: string;
  }
): CanvasPrototypeState {
  const node = state.nodes.find((currentNode) => currentNode.id === payload.nodeId && currentNode.kind === 'task');
  if (!node) {
    return state;
  }

  const nextTitle = trimStoredNodeText(payload.title).trim() || node.title;
  const nextDescription = trimStoredNodeText(payload.description);
  const nextAssignee = trimStoredNodeText(payload.assignee);
  const nextMetadata: CanvasNodeMetadata = {
    ...node.metadata,
    task: {
      ...ensureTaskMetadata(node),
      description: nextDescription,
      assignee: nextAssignee
    }
  };

  const nextNodes = state.nodes.map((currentNode) =>
    currentNode.id === payload.nodeId
      ? {
          ...currentNode,
          title: nextTitle,
          status: payload.status,
          summary: summarizeTaskNode(nextDescription, nextAssignee, payload.status),
          metadata: nextMetadata
        }
      : currentNode
  );

  return {
    ...state,
    updatedAt: new Date().toISOString(),
    nodes: nextNodes
  };
}

function updateNoteContent(
  state: CanvasPrototypeState,
  payload: {
    nodeId: string;
    title: string;
    content: string;
  }
): CanvasPrototypeState {
  const node = state.nodes.find((currentNode) => currentNode.id === payload.nodeId && currentNode.kind === 'note');
  if (!node) {
    return state;
  }

  const nextTitle = trimStoredNodeText(payload.title).trim() || node.title;
  const nextContent = trimStoredNodeText(payload.content);
  const nextMetadata: CanvasNodeMetadata = {
    ...node.metadata,
    note: {
      ...ensureNoteMetadata(node),
      content: nextContent
    }
  };

  const nextNodes = state.nodes.map((currentNode) =>
    currentNode.id === payload.nodeId
      ? {
          ...currentNode,
          title: nextTitle,
          status: 'ready',
          summary: summarizeNoteNode(nextContent),
          metadata: nextMetadata
        }
      : currentNode
  );

  return {
    ...state,
    updatedAt: new Date().toISOString(),
    nodes: nextNodes
  };
}

function ensureAgentMetadata(node: CanvasNodeSummary): AgentNodeMetadata {
  return node.metadata?.agent ?? createAgentMetadata();
}

function ensureTerminalMetadata(node: CanvasNodeSummary): TerminalNodeMetadata {
  return node.metadata?.terminal ?? createTerminalMetadata(node.id);
}

function ensureTaskMetadata(node: CanvasNodeSummary): TaskNodeMetadata {
  return node.metadata?.task ?? createTaskMetadata();
}

function ensureNoteMetadata(node: CanvasNodeSummary): NoteNodeMetadata {
  return node.metadata?.note ?? createNoteMetadata();
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

function readAgentTranscript(state: CanvasPrototypeState, nodeId: string): AgentTranscriptEntry[] {
  const agentNode = state.nodes.find((node) => node.id === nodeId && node.kind === 'agent');
  if (!agentNode) {
    return [];
  }

  return ensureAgentMetadata(agentNode).transcript ?? [];
}

function beginAgentTranscript(
  existing: AgentTranscriptEntry[],
  runId: string,
  prompt: string
): AgentTranscriptEntry[] {
  return trimAgentTranscript([
    ...existing,
    {
      id: createAgentTranscriptEntryId(runId, 'user'),
      role: 'user',
      text: trimStoredAgentText(prompt),
      state: 'done'
    },
    {
      id: createAgentTranscriptEntryId(runId, 'assistant'),
      role: 'assistant',
      text: '',
      state: 'streaming'
    }
  ]);
}

function updateAssistantTranscript(
  existing: AgentTranscriptEntry[],
  runId: string,
  output: string,
  state: 'streaming' | 'done' | 'error'
): AgentTranscriptEntry[] {
  return upsertAgentTranscriptEntry(existing, {
    id: createAgentTranscriptEntryId(runId, 'assistant'),
    role: 'assistant',
    text: trimStoredAgentText(output),
    state
  });
}

function finalizeAgentTranscript(
  existing: AgentTranscriptEntry[],
  runId: string,
  status: 'idle' | 'error' | 'cancelled',
  output: string,
  statusMessage?: string
): AgentTranscriptEntry[] {
  let transcript = existing;
  const normalizedOutput = trimStoredAgentText(output);

  if (normalizedOutput) {
    transcript = updateAssistantTranscript(
      transcript,
      runId,
      normalizedOutput,
      status === 'error' ? 'error' : 'done'
    );
  } else {
    transcript = removeAgentTranscriptEntry(
      transcript,
      createAgentTranscriptEntryId(runId, 'assistant')
    );
  }

  const nextStatusMessage = normalizeAgentTranscriptStatusMessage(status, normalizedOutput, statusMessage);
  if (!nextStatusMessage) {
    return removeAgentTranscriptEntry(transcript, createAgentTranscriptEntryId(runId, 'status'));
  }

  return upsertAgentTranscriptEntry(transcript, {
    id: createAgentTranscriptEntryId(runId, 'status'),
    role: 'status',
    text: nextStatusMessage,
    state: status === 'error' ? 'error' : 'done'
  });
}

function markAgentTranscriptInterrupted(
  existing: AgentTranscriptEntry[],
  runId: string | undefined,
  message: string
): AgentTranscriptEntry[] {
  if (!runId) {
    return trimAgentTranscript(existing);
  }

  let transcript = existing;
  const assistantId = createAgentTranscriptEntryId(runId, 'assistant');
  const assistantEntry = transcript.find((entry) => entry.id === assistantId);
  if (assistantEntry) {
    if (assistantEntry.text) {
      transcript = updateAssistantTranscript(transcript, runId, assistantEntry.text, 'done');
    } else {
      transcript = removeAgentTranscriptEntry(transcript, assistantId);
    }
  }

  return upsertAgentTranscriptEntry(transcript, {
    id: createAgentTranscriptEntryId(runId, 'status'),
    role: 'status',
    text: message,
    state: 'error'
  });
}

function normalizeAgentTranscriptStatusMessage(
  status: 'idle' | 'error' | 'cancelled',
  output: string,
  statusMessage?: string
): string {
  if (status === 'idle') {
    return output ? '' : '本轮运行已完成，但没有返回可展示文本。';
  }

  if (status === 'cancelled') {
    return statusMessage || '本轮运行已停止。';
  }

  return statusMessage || '本轮运行失败。';
}

function upsertAgentTranscriptEntry(
  entries: AgentTranscriptEntry[],
  nextEntry: AgentTranscriptEntry
): AgentTranscriptEntry[] {
  const nextEntries = entries.filter((entry) => entry.id !== nextEntry.id);
  nextEntries.push({
    ...nextEntry,
    text: trimStoredAgentText(nextEntry.text)
  });
  return trimAgentTranscript(nextEntries);
}

function removeAgentTranscriptEntry(
  entries: AgentTranscriptEntry[],
  entryId: string
): AgentTranscriptEntry[] {
  return trimAgentTranscript(entries.filter((entry) => entry.id !== entryId));
}

function trimAgentTranscript(entries: AgentTranscriptEntry[]): AgentTranscriptEntry[] {
  const limited = entries
    .slice(-18)
    .map((entry) => ({
      ...entry,
      text: trimStoredAgentText(entry.text)
    }));

  let totalChars = limited.reduce((sum, entry) => sum + entry.text.length, 0);
  while (totalChars > 12000 && limited.length > 1) {
    const removed = limited.shift();
    totalChars -= removed?.text.length ?? 0;
  }

  return limited;
}

function createAgentTranscriptEntryId(
  runId: string,
  role: AgentTranscriptEntry['role']
): string {
  return `${runId}:${role}`;
}

function isLegacyPlaceholderAgent(
  node: CanvasNodeSummary,
  metadata: AgentNodeMetadata
): boolean {
  return (
    node.summary === '等待接入真实 backend 的原型节点' &&
    !metadata.liveRun &&
    (!metadata.transcript || metadata.transcript.length === 0) &&
    !metadata.lastPrompt &&
    !metadata.lastResponse &&
    !metadata.lastBackendLabel &&
    !metadata.lastRunId
  );
}

function createAgentRunId(nodeId: string): string {
  return `${nodeId}-${Date.now().toString(36)}`;
}

function summarizeAgentResponse(response: string, running: boolean): string {
  const normalized = response.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return running ? 'Agent 会话已启动，正在等待 CLI 输出...' : 'Agent 已完成，但未返回可展示文本。';
  }

  return normalized.length > 140 ? `${normalized.slice(0, 140)}...` : normalized;
}

function summarizeTaskNode(
  description: string,
  assignee: string,
  status: TaskNodeStatus
): string {
  const normalizedDescription = description.replace(/\s+/g, ' ').trim();
  const normalizedAssignee = assignee.replace(/\s+/g, ' ').trim();
  if (normalizedDescription) {
    const summary = normalizedDescription.length > 120
      ? `${normalizedDescription.slice(0, 120)}...`
      : normalizedDescription;
    return normalizedAssignee ? `${summary} · 负责人：${normalizedAssignee}` : summary;
  }

  return normalizedAssignee
    ? `${humanizeTaskStatus(status)} · 负责人：${normalizedAssignee}`
    : `${humanizeTaskStatus(status)} · 等待补充任务描述。`;
}

function summarizeNoteNode(content: string): string {
  const normalizedContent = content.replace(/\s+/g, ' ').trim();
  if (!normalizedContent) {
    return '等待记录笔记内容。';
  }

  return normalizedContent.length > 140 ? `${normalizedContent.slice(0, 140)}...` : normalizedContent;
}

function trimStoredAgentText(value: string): string {
  return value.length > 4000 ? value.slice(0, 4000) : value;
}

function trimStoredNodeText(value: string): string {
  return value.length > 8000 ? value.slice(0, 8000) : value;
}

function summarizeAgentFailure(output: string, running = false): string {
  const normalized = output.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return running ? 'CLI 已启动，正在等待输出...' : 'Agent CLI 运行失败。';
  }

  return normalized.length > 140 ? `${normalized.slice(0, 140)}...` : normalized;
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, '');
}

function describeAgentCliSpawnError(spec: AgentCliSpec, error: unknown): string {
  if (isRecord(error) && error.code === 'ENOENT') {
    return `没有找到 ${spec.label} 命令 ${spec.command}。请确认它在 Extension Host 的 PATH 中，或通过设置项显式指定命令路径。`;
  }

  if (error instanceof Error && error.message) {
    return `启动 ${spec.label} 失败：${error.message}`;
  }

  return `启动 ${spec.label} 失败。`;
}

function describeAgentCliExit(
  spec: AgentCliSpec,
  code: number | null,
  signal: NodeJS.Signals | null,
  output: string
): string {
  const summary = summarizeAgentFailure(output);
  const suffix = summary === 'Agent CLI 运行失败。' ? '' : ` ${summary}`;

  if (signal) {
    return `${spec.label} 因信号 ${signal} 退出。${suffix}`.trim();
  }

  if (typeof code === 'number') {
    return `${spec.label} 以退出码 ${code} 结束。${suffix}`.trim();
  }

  return `${spec.label} 提前结束。${suffix}`.trim();
}

function humanizeTaskStatus(status: TaskNodeStatus): string {
  switch (status) {
    case 'todo':
      return '待办';
    case 'running':
      return '进行中';
    case 'blocked':
      return '受阻';
    case 'done':
      return '已完成';
  }
}

function findTerminalByName(name: string): vscode.Terminal | undefined {
  return vscode.window.terminals.find((terminal) => terminal.name === name);
}
