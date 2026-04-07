import * as vscode from 'vscode';

import {
  EXTENSION_DISPLAY_NAME,
  STORAGE_KEYS,
  VIEW_IDS
} from '../common/extensionIdentity';
import {
  type AgentNodeMetadata,
  type AgentProviderKind,
  type CanvasNodeFootprint,
  type CanvasNodeKind,
  type CanvasNodeMetadata,
  type CanvasNodePosition,
  type CanvasRuntimeContext,
  type CanvasNodeSummary,
  type CanvasPrototypeState,
  type ExecutionNodeKind,
  type HostToWebviewMessage,
  type NoteNodeMetadata,
  type TaskNodeMetadata,
  type TaskNodeStatus,
  type TerminalNodeMetadata,
  type WebviewDomAction,
  type WebviewProbeSnapshot,
  type WebviewToHostMessage,
  estimatedCanvasNodeFootprint,
  isCanvasNodeKind,
  isExecutionNodeKind,
  normalizeCanvasNodeFootprint,
  parseWebviewMessage
} from '../common/protocol';
import {
  createExecutionSessionProcess,
  type DisposableLike,
  type ExecutionSessionExitEvent,
  type ExecutionSessionLaunchSpec,
  type ExecutionSessionProcess,
    isIncompatibleNodePtyRuntimeError,
    isMissingNodePtyDependencyError
  } from './executionSessionBridge';
import { getConfigurationValue } from './configuration';
import { getWebviewHtml } from './getWebviewHtml';

const DEFAULT_TERMINAL_COLS = 96;
const DEFAULT_TERMINAL_ROWS = 28;
const NODE_PLACEMENT_PADDING = 40;
const NODE_PLACEMENT_STEP_X = 120;
const NODE_PLACEMENT_STEP_Y = 96;
const NODE_PLACEMENT_SEARCH_RADIUS = 8;

interface AgentCliConfig {
  defaultProvider: AgentProviderKind;
  codexCommand: string;
  claudeCommand: string;
}

interface AgentCliSpec {
  provider: AgentProviderKind;
  label: string;
  command: string;
}

interface EmbeddedExecutionSession {
  sessionId: string;
  process: ExecutionSessionProcess;
  shellPath: string;
  cwd: string;
  cols: number;
  rows: number;
  buffer: string;
  stopRequested: boolean;
  syncTimer: NodeJS.Timeout | undefined;
  displayLabel: string;
  outputSubscription: DisposableLike | undefined;
  exitSubscription: DisposableLike | undefined;
}

interface PendingWebviewProbeRequest {
  surface: CanvasSurfaceLocation;
  resolve: (snapshot: WebviewProbeSnapshot) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

interface PendingWebviewDomActionRequest {
  surface: CanvasSurfaceLocation;
  resolve: () => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

interface CanvasTestDiagnosticEvent {
  timestamp: string;
  kind: string;
  detail?: Record<string, unknown>;
}

export type CanvasSurfaceLocation = 'editor' | 'panel';
type CanvasSurfaceMode = 'active' | 'standby';

export interface CanvasSidebarState {
  canvasSurface: 'closed' | 'hidden' | 'visible';
  surfaceLocation: CanvasSurfaceLocation;
  configuredSurface: CanvasSurfaceLocation;
  nodeCount: number;
  runningExecutionCount: number;
  workspaceTrusted: boolean;
  creatableKinds: CanvasNodeKind[];
}

export interface CanvasDebugSnapshot {
  activeSurface: CanvasSurfaceLocation | undefined;
  sidebar: CanvasSidebarState;
  state: CanvasPrototypeState;
  surfaceMode: Partial<Record<CanvasSurfaceLocation, CanvasSurfaceMode>>;
  surfaceReady: Record<CanvasSurfaceLocation, boolean>;
}

export class CanvasPanelManager implements vscode.WebviewPanelSerializer, vscode.WebviewViewProvider {
  public static readonly viewType = VIEW_IDS.editorWebviewPanel;
  public static readonly panelViewType = VIEW_IDS.panelWebviewView;
  public static readonly panelContainerId = VIEW_IDS.panelContainer;

  private editorPanel: vscode.WebviewPanel | undefined;
  private panelView: vscode.WebviewView | undefined;
  private state: CanvasPrototypeState;
  private activeSurface: CanvasSurfaceLocation | undefined;
  private readonly surfaceMode: Partial<Record<CanvasSurfaceLocation, CanvasSurfaceMode>> = {};
  private readonly surfaceReady: Record<CanvasSurfaceLocation, boolean> = {
    editor: false,
    panel: false
  };
  private readonly agentSessions = new Map<string, EmbeddedExecutionSession>();
  private readonly terminalSessions = new Map<string, EmbeddedExecutionSession>();
  private readonly sidebarStateEmitter = new vscode.EventEmitter<CanvasSidebarState>();
  private readonly testHostMessages: HostToWebviewMessage[] = [];
  private readonly testDiagnosticEvents: CanvasTestDiagnosticEvent[] = [];
  private readonly pendingWebviewProbeRequests = new Map<string, PendingWebviewProbeRequest>();
  private readonly pendingWebviewDomActionRequests = new Map<string, PendingWebviewDomActionRequest>();

  public readonly onDidChangeSidebarState = this.sidebarStateEmitter.event;

  public constructor(private readonly context: vscode.ExtensionContext) {
    this.state = reconcileRuntimeNodes(this.loadState(), this.agentSessions, this.terminalSessions);
    this.activeSurface = this.loadStoredSurface();
    this.persistState();
    this.recordDiagnosticEvent('state/initialized', {
      activeSurface: this.activeSurface,
      nodeCount: this.state.nodes.length
    });
    context.subscriptions.push(this.sidebarStateEmitter);

    context.subscriptions.push(
      vscode.workspace.onDidGrantWorkspaceTrust(() => {
        this.recordDiagnosticEvent('workspace/trustGranted');
        this.postState('host/stateUpdated');
      })
    );
  }

  public async revealOrCreate(surface: CanvasSurfaceLocation = this.getConfiguredSurface()): Promise<void> {
    await this.revealSurface(surface);
  }

  public async revealInEditor(): Promise<void> {
    await this.revealSurface('editor');
  }

  public async revealInPanel(): Promise<void> {
    await this.revealSurface('panel');
  }

  public getSidebarState(): CanvasSidebarState {
    const configuredSurface = this.getConfiguredSurface();
    const canvasSurface = this.activeSurface ? this.getSurfaceVisibility(this.activeSurface) : 'closed';
    const surfaceLocation = canvasSurface === 'closed' ? configuredSurface : this.activeSurface ?? configuredSurface;

    return {
      canvasSurface,
      surfaceLocation,
      configuredSurface,
      nodeCount: this.state.nodes.length,
      runningExecutionCount: this.agentSessions.size + this.terminalSessions.size,
      workspaceTrusted: vscode.workspace.isTrusted,
      creatableKinds: vscode.workspace.isTrusted
        ? ['agent', 'terminal', 'task', 'note']
        : ['task', 'note']
    };
  }

  public getDebugSnapshot(): CanvasDebugSnapshot {
    return {
      activeSurface: this.activeSurface,
      sidebar: cloneJsonValue(this.getSidebarState()),
      state: cloneJsonValue(this.state),
      surfaceMode: cloneJsonValue(this.surfaceMode),
      surfaceReady: cloneJsonValue(this.surfaceReady)
    };
  }

  public getHostMessagesForTest(): HostToWebviewMessage[] {
    return cloneJsonValue(this.testHostMessages);
  }

  public clearHostMessagesForTest(): void {
    this.testHostMessages.length = 0;
  }

  public getDiagnosticEventsForTest(): CanvasTestDiagnosticEvent[] {
    return cloneJsonValue(this.testDiagnosticEvents);
  }

  public clearDiagnosticEventsForTest(): void {
    this.testDiagnosticEvents.length = 0;
  }

  public createNode(kind: CanvasNodeKind): void {
    if (this.isInteractiveSurfaceReady()) {
      this.postMessage({
        type: 'host/requestCreateNode',
        payload: {
          kind
        }
      });
      return;
    }

    this.applyCreateNode(kind);
  }

  public createNodeForTest(kind: CanvasNodeKind, preferredPosition?: CanvasNodePosition): void {
    if (this.context.extensionMode !== vscode.ExtensionMode.Test) {
      throw new Error('createNodeForTest 仅在测试模式下可用。');
    }

    this.applyCreateNode(kind, preferredPosition, {
      bypassTrust: true
    });
  }

  public dispatchWebviewMessageForTest(
    message: unknown,
    surface: CanvasSurfaceLocation | undefined = this.activeSurface
  ): CanvasDebugSnapshot {
    if (!surface) {
      throw new Error('测试命令 devSessionCanvas.__test.dispatchWebviewMessage 需要一个有效的画布承载面。');
    }

    this.handleWebviewMessage(surface, message);
    return this.getDebugSnapshot();
  }

  public reloadPersistedStateForTest(): CanvasDebugSnapshot {
    this.state = reconcileRuntimeNodes(this.loadState(), this.agentSessions, this.terminalSessions);
    this.activeSurface = this.loadStoredSurface();
    this.recordDiagnosticEvent('state/reloaded', {
      activeSurface: this.activeSurface,
      nodeCount: this.state.nodes.length
    });
    this.notifySidebarStateChanged();

    if (this.activeSurface && this.isInteractiveSurface(this.activeSurface)) {
      this.postState('host/stateUpdated');
    }

    return this.getDebugSnapshot();
  }

  public resetState(): void {
    const previousNodeCount = this.state.nodes.length;
    this.cancelAllAgentSessions();
    this.cancelAllTerminalSessions();
    this.state = createDefaultState(this.getAgentCliConfig().defaultProvider);
    this.persistState();
    this.recordDiagnosticEvent('state/reset', {
      previousNodeCount
    });
    this.postState('host/stateUpdated');
  }

  public async waitForCanvasReady(
    surface: CanvasSurfaceLocation | undefined = this.activeSurface,
    timeoutMs = 15000
  ): Promise<CanvasDebugSnapshot> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const targetSurface = surface ?? this.activeSurface;
      if (targetSurface && this.activeSurface === targetSurface && this.isInteractiveSurfaceReady()) {
        return this.getDebugSnapshot();
      }

      await delay(50);
    }

    const targetLabel = surface ?? this.activeSurface ?? 'active surface';
    throw new Error(`等待 ${targetLabel} 画布完成 ready 超时（${timeoutMs}ms）。`);
  }

  public async captureWebviewProbeForTest(
    surface: CanvasSurfaceLocation | undefined = this.activeSurface,
    timeoutMs = 5000,
    delayMs = 0
  ): Promise<WebviewProbeSnapshot> {
    if (this.context.extensionMode !== vscode.ExtensionMode.Test) {
      throw new Error('captureWebviewProbeForTest 仅在测试模式下可用。');
    }

    if (!surface) {
      throw new Error('测试命令 devSessionCanvas.__test.captureWebviewProbe 需要一个有效的画布承载面。');
    }

    if (!this.isInteractiveSurface(surface)) {
      throw new Error(`当前 ${surface} 不是可交互的主画布承载面。`);
    }

    if (!this.surfaceReady[surface]) {
      throw new Error(`当前 ${surface} 画布尚未完成 ready。`);
    }

    const requestId = `probe-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    return new Promise<WebviewProbeSnapshot>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingWebviewProbeRequests.delete(requestId);
        reject(new Error(`等待 ${surface} Webview probe 返回超时（${timeoutMs}ms）。`));
      }, timeoutMs);

      this.pendingWebviewProbeRequests.set(requestId, {
        surface,
        resolve,
        reject,
        timeout
      });

      this.postMessageToSurface(surface, {
        type: 'host/testProbeRequest',
        payload: {
          requestId,
          delayMs: delayMs > 0 ? delayMs : undefined
        }
      });
    });
  }

  public async performWebviewDomActionForTest(
    action: WebviewDomAction,
    surface: CanvasSurfaceLocation | undefined = this.activeSurface,
    timeoutMs = 5000
  ): Promise<void> {
    if (this.context.extensionMode !== vscode.ExtensionMode.Test) {
      throw new Error('performWebviewDomActionForTest 仅在测试模式下可用。');
    }

    if (!surface) {
      throw new Error('测试命令 devSessionCanvas.__test.performWebviewDomAction 需要一个有效的画布承载面。');
    }

    if (!this.isInteractiveSurface(surface)) {
      throw new Error(`当前 ${surface} 不是可交互的主画布承载面。`);
    }

    if (!this.surfaceReady[surface]) {
      throw new Error(`当前 ${surface} 画布尚未完成 ready。`);
    }

    const requestId = `dom-action-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingWebviewDomActionRequests.delete(requestId);
        reject(new Error(`等待 ${surface} Webview DOM 动作返回超时（${timeoutMs}ms）。`));
      }, timeoutMs);

      this.pendingWebviewDomActionRequests.set(requestId, {
        surface,
        resolve,
        reject,
        timeout
      });

      this.postMessageToSurface(surface, {
        type: 'host/testDomAction',
        payload: {
          requestId,
          action
        }
      });
    });
  }

  public async deserializeWebviewPanel(
    webviewPanel: vscode.WebviewPanel,
    _state: unknown
  ): Promise<void> {
    this.state = reconcileRuntimeNodes(this.loadState(), this.agentSessions, this.terminalSessions);
    this.persistState();
    this.attachEditorPanel(webviewPanel);
  }

  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.attachPanelView(webviewView);
  }

  private async revealSurface(surface: CanvasSurfaceLocation): Promise<void> {
    this.recordDiagnosticEvent('surface/revealRequested', {
      from: this.activeSurface,
      to: surface
    });
    this.activeSurface = surface;
    this.persistActiveSurface();

    if (surface === 'editor') {
      this.renderStandbySurface('panel');

      if (this.editorPanel) {
        this.ensureActiveSurfaceRendered('editor');
        this.editorPanel.reveal(vscode.ViewColumn.One);
        this.notifySidebarStateChanged();
        return;
      }

      const panel = vscode.window.createWebviewPanel(
        CanvasPanelManager.viewType,
        EXTENSION_DISPLAY_NAME,
        vscode.ViewColumn.One,
        this.getWebviewOptions()
      );
      this.attachEditorPanel(panel);
      this.ensureActiveSurfaceRendered('editor');
      this.notifySidebarStateChanged();
      return;
    }

    if (this.editorPanel) {
      this.editorPanel.dispose();
    }

    if (this.panelView) {
      this.ensureActiveSurfaceRendered('panel');
      this.panelView.show(false);
      this.notifySidebarStateChanged();
      return;
    }

    await this.revealPanelView();
    this.notifySidebarStateChanged();
  }

  private attachEditorPanel(panel: vscode.WebviewPanel): void {
    this.editorPanel = panel;
    this.surfaceMode.editor = undefined;
    this.surfaceReady.editor = false;
    this.claimSurfaceIfNeeded('editor');
    this.recordDiagnosticEvent('surface/attached', {
      surface: 'editor'
    });
    panel.webview.options = this.getWebviewOptions();

    panel.onDidDispose(
      () => {
        if (this.editorPanel === panel) {
          this.editorPanel = undefined;
          this.surfaceMode.editor = undefined;
          this.surfaceReady.editor = false;
          this.recordDiagnosticEvent('surface/disposed', {
            surface: 'editor'
          });
          this.rejectPendingWebviewProbeRequests('editor', '编辑区 Webview 已被关闭。');
          this.rejectPendingWebviewDomActionRequests('editor', '编辑区 Webview 已被关闭。');
          this.notifySidebarStateChanged();
        }
      },
      null,
      this.context.subscriptions
    );

    panel.onDidChangeViewState(
      () => {
        this.recordDiagnosticEvent('surface/visibilityChanged', {
          surface: 'editor',
          visible: panel.visible
        });
        this.notifySidebarStateChanged();
      },
      null,
      this.context.subscriptions
    );

    panel.webview.onDidReceiveMessage(
      (message) => this.handleWebviewMessage('editor', message),
      null,
      this.context.subscriptions
    );

    if (this.activeSurface === 'editor') {
      this.ensureActiveSurfaceRendered('editor');
    } else {
      this.renderStandbySurface('editor');
    }

    this.notifySidebarStateChanged();
  }

  private attachPanelView(webviewView: vscode.WebviewView): void {
    this.panelView = webviewView;
    this.surfaceMode.panel = undefined;
    this.surfaceReady.panel = false;
    this.claimSurfaceIfNeeded('panel');
    this.recordDiagnosticEvent('surface/attached', {
      surface: 'panel'
    });
    webviewView.webview.options = this.getWebviewOptions();

    webviewView.onDidDispose(
      () => {
        if (this.panelView === webviewView) {
          this.panelView = undefined;
          this.surfaceMode.panel = undefined;
          this.surfaceReady.panel = false;
          this.recordDiagnosticEvent('surface/disposed', {
            surface: 'panel'
          });
          this.rejectPendingWebviewProbeRequests('panel', '面板 Webview 已被关闭。');
          this.rejectPendingWebviewDomActionRequests('panel', '面板 Webview 已被关闭。');
          this.notifySidebarStateChanged();
        }
      },
      null,
      this.context.subscriptions
    );

    webviewView.onDidChangeVisibility(
      () => {
        this.recordDiagnosticEvent('surface/visibilityChanged', {
          surface: 'panel',
          visible: webviewView.visible
        });
        this.notifySidebarStateChanged();
      },
      null,
      this.context.subscriptions
    );

    webviewView.webview.onDidReceiveMessage(
      (message) => this.handleWebviewMessage('panel', message),
      null,
      this.context.subscriptions
    );

    if (this.activeSurface === 'panel') {
      this.ensureActiveSurfaceRendered('panel');
    } else {
      this.renderStandbySurface('panel');
    }

    this.notifySidebarStateChanged();
  }

  private getWebviewOptions(): vscode.WebviewOptions & vscode.WebviewPanelOptions {
    return {
      enableScripts: true,
      enableCommandUris: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'dist')]
    };
  }

  private getStoredValue<T>(key: string): T | undefined {
    return this.context.workspaceState.get<T>(key);
  }

  private loadState(): CanvasPrototypeState {
    const rawState = this.getStoredValue<unknown>(STORAGE_KEYS.canvasState);
    return normalizeState(rawState, this.getAgentCliConfig().defaultProvider);
  }

  private persistState(): void {
    void this.context.workspaceState.update(STORAGE_KEYS.canvasState, this.state);
  }

  private postState(type: 'host/bootstrap' | 'host/stateUpdated'): void {
    this.postMessage({
      type,
      payload: {
        state: this.state,
        runtime: this.getRuntimeContext()
      }
    });
    this.notifySidebarStateChanged();
  }

  private postMessage(message: HostToWebviewMessage): void {
    this.recordHostMessageForTest(message);

    const activeWebview = this.getActiveWebview();
    if (!activeWebview) {
      return;
    }

    void activeWebview.postMessage(message);
  }

  private notifySidebarStateChanged(): void {
    this.sidebarStateEmitter.fire(this.getSidebarState());
  }

  private getRuntimeContext(): CanvasRuntimeContext {
    return {
      workspaceTrusted: vscode.workspace.isTrusted
    };
  }

  private getConfiguredSurface(): CanvasSurfaceLocation {
    return getConfigurationValue<'editor' | 'panel'>('canvasDefaultSurface', 'editor') === 'panel'
      ? 'panel'
      : 'editor';
  }

  private loadStoredSurface(): CanvasSurfaceLocation | undefined {
    const storedSurface = this.getStoredValue<string>(STORAGE_KEYS.canvasLastSurface);
    if (storedSurface === 'editor' || storedSurface === 'panel') {
      return storedSurface;
    }

    return undefined;
  }

  private persistActiveSurface(): void {
    if (!this.activeSurface) {
      return;
    }

    void this.context.workspaceState.update(STORAGE_KEYS.canvasLastSurface, this.activeSurface);
  }

  private claimSurfaceIfNeeded(surface: CanvasSurfaceLocation): void {
    if (!this.activeSurface || this.getSurfaceVisibility(this.activeSurface) === 'closed') {
      this.activeSurface = surface;
      this.persistActiveSurface();
      this.recordDiagnosticEvent('surface/claimed', {
        surface
      });
    }
  }

  private getSurfaceWebview(surface: CanvasSurfaceLocation): vscode.Webview | undefined {
    return surface === 'editor' ? this.editorPanel?.webview : this.panelView?.webview;
  }

  private getSurfaceVisibility(surface: CanvasSurfaceLocation): CanvasSidebarState['canvasSurface'] {
    if (surface === 'editor') {
      if (!this.editorPanel) {
        return 'closed';
      }

      return this.editorPanel.visible ? 'visible' : 'hidden';
    }

    if (!this.panelView) {
      return 'closed';
    }

    return this.panelView.visible ? 'visible' : 'hidden';
  }

  private ensureActiveSurfaceRendered(surface: CanvasSurfaceLocation): void {
    const webview = this.getSurfaceWebview(surface);
    if (!webview) {
      return;
    }

    if (this.surfaceMode[surface] === 'active') {
      return;
    }

    this.surfaceMode[surface] = 'active';
    this.surfaceReady[surface] = false;
    this.recordDiagnosticEvent('surface/rendered', {
      surface,
      mode: 'active'
    });
    webview.options = this.getWebviewOptions();
    webview.html = getWebviewHtml(webview, this.context.extensionUri, {
      mode: 'active',
      surface
    });
  }

  private renderStandbySurface(surface: CanvasSurfaceLocation): void {
    if (!this.activeSurface || this.activeSurface === surface) {
      return;
    }

    const webview = this.getSurfaceWebview(surface);
    if (!webview) {
      return;
    }

    this.surfaceMode[surface] = 'standby';
    this.surfaceReady[surface] = false;
    this.recordDiagnosticEvent('surface/rendered', {
      surface,
      mode: 'standby',
      activeSurface: this.activeSurface
    });
    webview.options = this.getWebviewOptions();
    webview.html = getWebviewHtml(webview, this.context.extensionUri, {
      mode: 'standby',
      surface,
      activeSurface: this.activeSurface
    });
  }

  private isInteractiveSurface(surface: CanvasSurfaceLocation): boolean {
    return this.activeSurface === surface && this.surfaceMode[surface] === 'active';
  }

  private isInteractiveSurfaceReady(): boolean {
    if (!this.activeSurface) {
      return false;
    }

    return (
      this.isInteractiveSurface(this.activeSurface) &&
      this.getSurfaceVisibility(this.activeSurface) === 'visible' &&
      this.surfaceReady[this.activeSurface]
    );
  }

  private getActiveWebview(): vscode.Webview | undefined {
    if (!this.activeSurface || !this.isInteractiveSurface(this.activeSurface)) {
      return undefined;
    }

    return this.getSurfaceWebview(this.activeSurface);
  }

  private async revealPanelView(): Promise<void> {
    if (this.panelView) {
      this.panelView.show(false);
      return;
    }

    const candidateCommands = [
      `${CanvasPanelManager.panelViewType}.open`,
      `${CanvasPanelManager.panelViewType}.focus`,
      `workbench.view.extension.${CanvasPanelManager.panelContainerId}`
    ];

    for (const command of candidateCommands) {
      try {
        await vscode.commands.executeCommand(command);
        return;
      } catch {
        continue;
      }
    }

    try {
      await vscode.commands.executeCommand('workbench.action.openPanel');
    } catch {
      // Ignore and fall through to the explicit hint below.
    }

    void vscode.window.showInformationMessage(`请从 Panel 中打开 ${EXTENSION_DISPLAY_NAME} 视图。`);
  }

  private handleWebviewMessage(surface: CanvasSurfaceLocation, message: unknown): void {
    const parsedMessage = parseWebviewMessage(message);
    if (!parsedMessage) {
      if (this.isInteractiveSurface(surface)) {
        this.postMessageToSurface(surface, {
          type: 'host/error',
          payload: {
            message: '收到无法识别的消息，已忽略。'
          }
        });
      }
      return;
    }

    if (parsedMessage.type === 'webview/testProbeResult') {
      this.resolvePendingWebviewProbeRequest(surface, parsedMessage.payload.requestId, parsedMessage.payload.snapshot);
      return;
    }

    if (parsedMessage.type === 'webview/testDomActionResult') {
      this.resolvePendingWebviewDomActionRequest(
        surface,
        parsedMessage.payload.requestId,
        parsedMessage.payload.ok,
        parsedMessage.payload.errorMessage
      );
      return;
    }

    if (parsedMessage.type === 'webview/ready') {
      this.surfaceReady[surface] = true;
      this.recordDiagnosticEvent('surface/ready', {
        surface,
        mode: this.surfaceMode[surface],
        activeSurface: this.activeSurface
      });
      if (this.isInteractiveSurface(surface)) {
        this.postState('host/bootstrap');
      }
      return;
    }

    if (!this.isInteractiveSurface(surface)) {
      return;
    }

    this.handleActiveWebviewMessage(parsedMessage);
  }

  private handleActiveWebviewMessage(parsedMessage: WebviewToHostMessage): void {
    switch (parsedMessage.type) {
      case 'webview/ready':
        return;
      case 'webview/createDemoNode':
        this.applyCreateNode(parsedMessage.payload.kind, parsedMessage.payload.preferredPosition);
        return;
      case 'webview/moveNode':
        this.state = moveNode(this.state, parsedMessage.payload.id, parsedMessage.payload.position);
        this.persistState();
        this.postState('host/stateUpdated');
        return;
      case 'webview/resizeNode':
        this.state = resizeNode(this.state, parsedMessage.payload.nodeId, parsedMessage.payload.size);
        this.persistState();
        this.postState('host/stateUpdated');
        return;
      case 'webview/deleteNode':
        this.deleteNode(parsedMessage.payload.nodeId);
        return;
      case 'webview/startExecutionSession':
        if (parsedMessage.payload.kind === 'agent') {
          void this.startAgentSession(
            parsedMessage.payload.nodeId,
            parsedMessage.payload.cols,
            parsedMessage.payload.rows,
            parsedMessage.payload.provider
          );
          return;
        }

        void this.startTerminalSession(
          parsedMessage.payload.nodeId,
          parsedMessage.payload.cols,
          parsedMessage.payload.rows
        );
        return;
      case 'webview/attachExecutionSession':
        this.attachExecutionSession(parsedMessage.payload.kind, parsedMessage.payload.nodeId);
        return;
      case 'webview/executionInput':
        this.writeExecutionInput(
          parsedMessage.payload.kind,
          parsedMessage.payload.nodeId,
          parsedMessage.payload.data
        );
        return;
      case 'webview/resizeExecutionSession':
        this.resizeExecutionSession(
          parsedMessage.payload.kind,
          parsedMessage.payload.nodeId,
          parsedMessage.payload.cols,
          parsedMessage.payload.rows
        );
        return;
      case 'webview/stopExecutionSession':
        void this.stopExecutionSession(parsedMessage.payload.kind, parsedMessage.payload.nodeId);
        return;
      case 'webview/updateTaskNode':
        this.state = updateTaskContent(this.state, parsedMessage.payload);
        this.persistState();
        this.postState('host/stateUpdated');
        return;
      case 'webview/updateNoteNode':
        this.state = updateNoteContent(this.state, parsedMessage.payload);
        this.persistState();
        this.postState('host/stateUpdated');
        return;
      case 'webview/resetDemoState':
        this.resetState();
        return;
    }
  }

  private postMessageToSurface(surface: CanvasSurfaceLocation, message: HostToWebviewMessage): void {
    this.recordHostMessageForTest(message);

    const webview = this.getSurfaceWebview(surface);
    if (!webview) {
      return;
    }

    void webview.postMessage(message);
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

  private async startAgentSession(
    nodeId: string,
    cols: number,
    rows: number,
    requestedProvider: AgentProviderKind | undefined
  ): Promise<void> {
    const normalizedCols = normalizeTerminalCols(cols);
    const normalizedRows = normalizeTerminalRows(rows);
    this.recordDiagnosticEvent('execution/startRequested', {
      kind: 'agent',
      nodeId,
      provider: requestedProvider ?? null,
      cols: normalizedCols,
      rows: normalizedRows,
      workspaceTrusted: vscode.workspace.isTrusted
    });

    if (!this.assertExecutionAllowed('当前 workspace 未受信任，已禁止 Agent 运行。')) {
      this.recordDiagnosticEvent('execution/startRejected', {
        kind: 'agent',
        nodeId,
        reason: 'workspace-untrusted'
      });
      return;
    }

    const agentNode = this.state.nodes.find((node) => node.id === nodeId && node.kind === 'agent');
    if (!agentNode) {
      this.recordDiagnosticEvent('execution/startRejected', {
        kind: 'agent',
        nodeId,
        reason: 'missing-node'
      });
      this.postMessage({
        type: 'host/error',
        payload: {
          message: '未找到可启动的 Agent 节点。'
        }
      });
      return;
    }

    const activeSessions = this.getExecutionSessions('agent');
    if (activeSessions.has(nodeId)) {
      this.recordDiagnosticEvent('execution/startRejected', {
        kind: 'agent',
        nodeId,
        reason: 'already-running'
      });
      this.postMessage({
        type: 'host/error',
        payload: {
          message: '该 Agent 已在运行中。'
        }
      });
      this.attachExecutionSession('agent', nodeId);
      return;
    }

    const provider = requestedProvider ?? ensureAgentMetadata(agentNode).provider;
    const cliSpec = this.resolveAgentCli(provider);
    const cwd = this.getTerminalWorkingDirectory();
    const sessionId = createExecutionSessionId(nodeId, 'agent');

    try {
      const process = createExecutionSessionProcess(
        this.buildAgentLaunchSpec(cliSpec.command, cwd, normalizedCols, normalizedRows)
      );

      const session: EmbeddedExecutionSession = {
        sessionId,
        process,
        shellPath: cliSpec.command,
        cwd,
        cols: normalizedCols,
        rows: normalizedRows,
        buffer: '',
        stopRequested: false,
        syncTimer: undefined,
        displayLabel: cliSpec.label,
        outputSubscription: undefined,
        exitSubscription: undefined
      };
      activeSessions.set(nodeId, session);
      this.recordDiagnosticEvent('execution/started', {
        kind: 'agent',
        nodeId,
        sessionId,
        provider,
        cols: normalizedCols,
        rows: normalizedRows,
        shellPath: cliSpec.command,
        cwd
      });

      this.state = updateAgentNode(this.state, nodeId, {
        status: 'live',
        summary: summarizeAgentSessionOutput('', true, cliSpec.label),
        metadata: buildAgentMetadataPatch(this.state, nodeId, {
          provider,
          liveSession: true,
          autoStartPending: false,
          shellPath: cliSpec.command,
          cwd,
          recentOutput: undefined,
          lastExitCode: undefined,
          lastExitSignal: undefined,
          lastExitMessage: undefined,
          lastCols: normalizedCols,
          lastRows: normalizedRows,
          lastBackendLabel: cliSpec.label
        })
      });
      this.persistState();
      this.postState('host/stateUpdated');
      this.postExecutionSnapshot('agent', nodeId);

      const handleSessionChunk = (text: string): void => {
        const sessionMap = this.getExecutionSessions('agent');
        const activeSession = sessionMap.get(nodeId);
        if (!activeSession) {
          return;
        }

        if (!text) {
          return;
        }

        activeSession.buffer = appendTerminalBuffer(activeSession.buffer, text);
        this.queueExecutionStateSync('agent', nodeId);
        this.postMessage({
          type: 'host/executionOutput',
          payload: {
            nodeId,
            kind: 'agent',
            chunk: text
          }
        });
      };

      const finalize = (
        status: 'closed' | 'error',
        message: string,
        exitCode?: number,
        signal?: string
      ): void => {
        const sessionMap = this.getExecutionSessions('agent');
        const activeSession = sessionMap.get(nodeId);
        if (!activeSession) {
          return;
        }

        if (activeSession.syncTimer) {
          clearTimeout(activeSession.syncTimer);
          activeSession.syncTimer = undefined;
        }
        activeSession.outputSubscription?.dispose();
        activeSession.exitSubscription?.dispose();

        const cleanedOutput = stripTerminalControlSequences(activeSession.buffer);
        const recentOutput = extractRecentTerminalOutput(cleanedOutput);

        sessionMap.delete(nodeId);
        this.recordDiagnosticEvent('execution/exited', {
          kind: 'agent',
          nodeId,
          sessionId: activeSession.sessionId,
          status,
          exitCode: exitCode ?? null,
          signal: signal ?? null,
          stopRequested: activeSession.stopRequested,
          message
        });
        this.state = updateAgentNode(this.state, nodeId, {
          status,
          summary: message,
          metadata: buildAgentMetadataPatch(this.state, nodeId, {
            provider,
            liveSession: false,
            autoStartPending: false,
            shellPath: activeSession.shellPath,
            cwd: activeSession.cwd,
            recentOutput: recentOutput || undefined,
            lastExitCode: exitCode,
            lastExitSignal: signal ?? undefined,
            lastExitMessage: message,
            lastCols: activeSession.cols,
            lastRows: activeSession.rows,
            lastBackendLabel: cliSpec.label
          })
        });
        this.persistState();
        this.postState('host/stateUpdated');
        this.postMessage({
          type: 'host/executionExit',
          payload: {
            nodeId,
            kind: 'agent',
            message
          }
        });
        if (status === 'error') {
          this.postMessage({
            type: 'host/error',
            payload: {
              message
            }
          });
        }
      };

      session.outputSubscription = session.process.onData(handleSessionChunk);
      session.exitSubscription = session.process.onExit(({ exitCode, signal }: ExecutionSessionExitEvent) => {
        if (session.stopRequested) {
          finalize('closed', `已停止 ${cliSpec.label} 会话。`, exitCode, signal);
          return;
        }

        if (exitCode === 0) {
          finalize('closed', `${cliSpec.label} 会话已结束。`, exitCode, signal);
          return;
        }

        const cleanedOutput = stripTerminalControlSequences(session.buffer);
        finalize(
          'error',
          describeAgentSessionExit(cliSpec, exitCode, signal, cleanedOutput),
          exitCode,
          signal
        );
      });
    } catch (error) {
      const message = describeAgentSessionSpawnError(cliSpec, error);
      this.recordDiagnosticEvent('execution/spawnError', {
        kind: 'agent',
        nodeId,
        provider,
        cols: normalizedCols,
        rows: normalizedRows,
        message
      });
      this.state = updateAgentNode(this.state, nodeId, {
        status: 'error',
        summary: message,
        metadata: buildAgentMetadataPatch(this.state, nodeId, {
          provider,
          liveSession: false,
          autoStartPending: false,
          shellPath: cliSpec.command,
          cwd,
          lastExitMessage: message,
          lastCols: normalizedCols,
          lastRows: normalizedRows,
          lastBackendLabel: cliSpec.label
        })
      });
      this.persistState();
      this.postState('host/stateUpdated');
      this.postMessage({
        type: 'host/error',
        payload: {
          message
        }
      });
    }
  }

  private cancelAllAgentSessions(): void {
    for (const nodeId of Array.from(this.agentSessions.keys())) {
      this.disposeExecutionSession('agent', nodeId, {
        terminateProcess: true
      });
    }
  }

  private getAgentCliConfig(): AgentCliConfig {
    const defaultProvider = getConfigurationValue<AgentProviderKind>('agentDefaultProvider', 'codex');
    const configuredCodexCommand = getConfigurationValue<string>('agentCodexCommand', 'codex').trim() || 'codex';
    const configuredClaudeCommand = getConfigurationValue<string>('agentClaudeCommand', 'claude').trim() || 'claude';

    const codexCommand =
      this.context.extensionMode === vscode.ExtensionMode.Test
        ? process.env.DEV_SESSION_CANVAS_TEST_CODEX_COMMAND?.trim() || configuredCodexCommand
        : configuredCodexCommand;
    const claudeCommand =
      this.context.extensionMode === vscode.ExtensionMode.Test
        ? process.env.DEV_SESSION_CANVAS_TEST_CLAUDE_COMMAND?.trim() || configuredClaudeCommand
        : configuredClaudeCommand;

    return {
      defaultProvider: defaultProvider === 'claude' ? 'claude' : 'codex',
      codexCommand,
      claudeCommand
    };
  }

  private resolveAgentCli(provider: AgentProviderKind): AgentCliSpec {
    const configuration = this.getAgentCliConfig();
    if (provider === 'claude') {
      return {
        provider,
        label: 'Claude Code',
        command: configuration.claudeCommand
      };
    }

    return {
      provider: 'codex',
      label: 'Codex',
      command: configuration.codexCommand
    };
  }

  private getWorkspaceRoot(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  private getTerminalShellPath(): string {
    const configuredPath = getConfigurationValue<string>('terminalShellPath', '').trim();
    if (configuredPath) {
      return configuredPath;
    }

    if (process.platform === 'win32') {
      return process.env.ComSpec?.trim() || process.env.COMSPEC?.trim() || 'powershell.exe';
    }

    return process.env.SHELL?.trim() || '/bin/bash';
  }

  private getTerminalWorkingDirectory(): string {
    return this.getWorkspaceRoot() ?? defaultTerminalWorkingDirectory();
  }

  private buildExecutionEnvironment(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      TERM: process.env.TERM?.trim() || (process.platform === 'win32' ? 'xterm-color' : 'xterm-256color'),
      COLORTERM: process.env.COLORTERM?.trim() || 'truecolor'
    };

    if (process.platform === 'win32') {
      env.SystemRoot = process.env.SystemRoot?.trim() || process.env.SYSTEMROOT?.trim() || 'C:\\Windows';
    }

    return env;
  }

  private buildTerminalLaunchSpec(
    shellPath: string,
    cwd: string,
    cols: number,
    rows: number
  ): ExecutionSessionLaunchSpec {
    return {
      file: shellPath,
      args: [],
      cwd,
      cols,
      rows,
      env: this.buildExecutionEnvironment()
    };
  }

  private buildAgentLaunchSpec(
    command: string,
    cwd: string,
    cols: number,
    rows: number
  ): ExecutionSessionLaunchSpec {
    return {
      file: command,
      args: [],
      cwd,
      cols,
      rows,
      env: this.buildExecutionEnvironment()
    };
  }

  private async startTerminalSession(nodeId: string, cols: number, rows: number): Promise<void> {
    const normalizedCols = normalizeTerminalCols(cols);
    const normalizedRows = normalizeTerminalRows(rows);
    this.recordDiagnosticEvent('execution/startRequested', {
      kind: 'terminal',
      nodeId,
      cols: normalizedCols,
      rows: normalizedRows,
      workspaceTrusted: vscode.workspace.isTrusted
    });

    if (!this.assertExecutionAllowed('当前 workspace 未受信任，已禁止终端操作。')) {
      this.recordDiagnosticEvent('execution/startRejected', {
        kind: 'terminal',
        nodeId,
        reason: 'workspace-untrusted'
      });
      return;
    }

    const terminalNode = this.state.nodes.find((node) => node.id === nodeId && node.kind === 'terminal');
    if (!terminalNode) {
      this.recordDiagnosticEvent('execution/startRejected', {
        kind: 'terminal',
        nodeId,
        reason: 'missing-node'
      });
      this.postMessage({
        type: 'host/error',
        payload: {
          message: '未找到可启动的终端节点。'
        }
      });
      return;
    }

    if (this.terminalSessions.has(nodeId)) {
      this.recordDiagnosticEvent('execution/startRejected', {
        kind: 'terminal',
        nodeId,
        reason: 'already-running'
      });
      this.postMessage({
        type: 'host/error',
        payload: {
          message: '该终端已在运行中。'
        }
      });
      this.attachExecutionSession('terminal', nodeId);
      return;
    }

    const shellPath = this.getTerminalShellPath();
    const cwd = this.getTerminalWorkingDirectory();
    const sessionId = createExecutionSessionId(nodeId, 'terminal');

    try {
      const process = createExecutionSessionProcess(
        this.buildTerminalLaunchSpec(shellPath, cwd, normalizedCols, normalizedRows)
      );

      const session: EmbeddedExecutionSession = {
        sessionId,
        process,
        shellPath,
        cwd,
        cols: normalizedCols,
        rows: normalizedRows,
        buffer: '',
        stopRequested: false,
        syncTimer: undefined,
        displayLabel: shellPath,
        outputSubscription: undefined,
        exitSubscription: undefined
      };
      this.terminalSessions.set(nodeId, session);
      this.recordDiagnosticEvent('execution/started', {
        kind: 'terminal',
        nodeId,
        sessionId,
        cols: normalizedCols,
        rows: normalizedRows,
        shellPath,
        cwd
      });

      this.state = updateTerminalNode(this.state, nodeId, {
        status: 'live',
        summary: '嵌入式终端已启动，等待输入。',
        metadata: buildTerminalMetadataPatch(this.state, nodeId, {
          liveSession: true,
          autoStartPending: false,
          shellPath,
          cwd,
          lastCols: normalizedCols,
          lastRows: normalizedRows,
          recentOutput: undefined,
          lastExitCode: undefined,
          lastExitSignal: undefined,
          lastExitMessage: undefined
        })
      });
      this.persistState();
      this.postState('host/stateUpdated');
      this.postExecutionSnapshot('terminal', nodeId);

      const handleTerminalChunk = (text: string): void => {
        const activeSession = this.terminalSessions.get(nodeId);
        if (!activeSession) {
          return;
        }

        if (!text) {
          return;
        }

        activeSession.buffer = appendTerminalBuffer(activeSession.buffer, text);
        this.queueExecutionStateSync('terminal', nodeId);
        this.postMessage({
          type: 'host/executionOutput',
          payload: {
            nodeId,
            kind: 'terminal',
            chunk: text
          }
        });
      };

      const finalize = (
        status: 'closed' | 'error',
        message: string,
        exitCode?: number,
        signal?: string
      ): void => {
        const activeSession = this.terminalSessions.get(nodeId);
        if (!activeSession) {
          return;
        }

        if (activeSession.syncTimer) {
          clearTimeout(activeSession.syncTimer);
          activeSession.syncTimer = undefined;
        }
        activeSession.outputSubscription?.dispose();
        activeSession.exitSubscription?.dispose();

        const cleanedOutput = stripTerminalControlSequences(activeSession.buffer);
        const recentOutput = extractRecentTerminalOutput(cleanedOutput);

        this.terminalSessions.delete(nodeId);
        this.recordDiagnosticEvent('execution/exited', {
          kind: 'terminal',
          nodeId,
          sessionId: activeSession.sessionId,
          status,
          exitCode: exitCode ?? null,
          signal: signal ?? null,
          stopRequested: activeSession.stopRequested,
          message
        });
        this.state = updateTerminalNode(this.state, nodeId, {
          status,
          summary: message,
          metadata: buildTerminalMetadataPatch(this.state, nodeId, {
            liveSession: false,
            autoStartPending: false,
            shellPath: activeSession.shellPath,
            cwd: activeSession.cwd,
            recentOutput: recentOutput || undefined,
            lastExitCode: exitCode,
            lastExitSignal: signal ?? undefined,
            lastExitMessage: message,
            lastCols: activeSession.cols,
            lastRows: activeSession.rows
          })
        });
        this.persistState();
        this.postState('host/stateUpdated');
        this.postMessage({
          type: 'host/executionExit',
          payload: {
            nodeId,
            kind: 'terminal',
            message
          }
        });
        if (status === 'error') {
          this.postMessage({
            type: 'host/error',
            payload: {
              message
            }
          });
        }
      };

      session.outputSubscription = session.process.onData(handleTerminalChunk);
      session.exitSubscription = session.process.onExit(({ exitCode, signal }: ExecutionSessionExitEvent) => {
        if (session.stopRequested) {
          finalize('closed', '终端已停止。', exitCode, signal);
          return;
        }

        if (exitCode === 0) {
          finalize('closed', '终端会话已结束。', exitCode, signal);
          return;
        }

        const cleanedOutput = stripTerminalControlSequences(session.buffer);
        finalize(
          'error',
          describeEmbeddedTerminalExit(shellPath, exitCode, signal, cleanedOutput),
          exitCode,
          signal
        );
      });
    } catch (error) {
      const message = describeEmbeddedTerminalSpawnError(shellPath, error);
      this.recordDiagnosticEvent('execution/spawnError', {
        kind: 'terminal',
        nodeId,
        cols: normalizedCols,
        rows: normalizedRows,
        message
      });
      this.state = updateTerminalNode(this.state, nodeId, {
        status: 'error',
        summary: message,
        metadata: buildTerminalMetadataPatch(this.state, nodeId, {
          liveSession: false,
          autoStartPending: false,
          shellPath,
          cwd,
          lastExitMessage: message,
          lastCols: normalizedCols,
          lastRows: normalizedRows
        })
      });
      this.persistState();
      this.postState('host/stateUpdated');
      this.postMessage({
        type: 'host/error',
        payload: {
          message
        }
      });
    }
  }

  private getExecutionSessions(kind: ExecutionNodeKind): Map<string, EmbeddedExecutionSession> {
    return kind === 'agent' ? this.agentSessions : this.terminalSessions;
  }

  private attachExecutionSession(kind: ExecutionNodeKind, nodeId: string): void {
    this.recordDiagnosticEvent('execution/attachRequested', {
      kind,
      nodeId,
      liveSession: this.getExecutionSessions(kind).has(nodeId)
    });

    const node = this.state.nodes.find((currentNode) => currentNode.id === nodeId && currentNode.kind === kind);
    if (!node) {
      return;
    }

    this.postExecutionSnapshot(kind, nodeId);
  }

  private writeExecutionInput(kind: ExecutionNodeKind, nodeId: string, data: string): void {
    const inputDetail = {
      kind,
      nodeId,
      bytes: Buffer.byteLength(data, 'utf8'),
      preview: summarizeDiagnosticInput(data)
    };

    if (
      !this.assertExecutionAllowed(
        kind === 'agent' ? '当前 workspace 未受信任，已禁止 Agent 输入。' : '当前 workspace 未受信任，已禁止终端输入。'
      )
    ) {
      this.recordDiagnosticEvent('execution/inputRejected', {
        ...inputDetail,
        reason: 'workspace-untrusted'
      });
      return;
    }

    const session = this.getExecutionSessions(kind).get(nodeId);
    if (!session) {
      this.recordDiagnosticEvent('execution/inputRejected', {
        ...inputDetail,
        reason: 'missing-session'
      });
      return;
    }

    session.process.write(data);
    this.recordDiagnosticEvent('execution/inputWritten', {
      ...inputDetail,
      sessionId: session.sessionId
    });
  }

  private resizeExecutionSession(kind: ExecutionNodeKind, nodeId: string, cols: number, rows: number): void {
    const normalizedCols = normalizeTerminalCols(cols);
    const normalizedRows = normalizeTerminalRows(rows);
    const session = this.getExecutionSessions(kind).get(nodeId);

    if (!session) {
      this.state = updateExecutionNode(this.state, nodeId, kind, {
        status: readExecutionStatus(this.state, nodeId, kind),
        summary: readExecutionSummary(this.state, nodeId, kind),
        metadata: buildExecutionMetadataPatch(this.state, nodeId, kind, {
          lastCols: normalizedCols,
          lastRows: normalizedRows
        })
      });
      this.persistState();
      this.postState('host/stateUpdated');
      return;
    }

    if (session.cols === normalizedCols && session.rows === normalizedRows) {
      return;
    }

    session.cols = normalizedCols;
    session.rows = normalizedRows;
    session.process.resize(normalizedCols, normalizedRows);
    this.queueExecutionStateSync(kind, nodeId);
  }

  private async stopExecutionSession(kind: ExecutionNodeKind, nodeId: string): Promise<void> {
    const session = this.getExecutionSessions(kind).get(nodeId);
    if (!session) {
      this.recordDiagnosticEvent('execution/stopRejected', {
        kind,
        nodeId,
        reason: 'missing-session'
      });
      this.postMessage({
        type: 'host/error',
        payload: {
          message: kind === 'agent' ? '当前没有可停止的 Agent 会话。' : '当前没有可停止的终端会话。'
        }
      });
      return;
    }

    this.recordDiagnosticEvent('execution/stopRequested', {
      kind,
      nodeId,
      sessionId: session.sessionId
    });
    session.stopRequested = true;
    session.process.kill();
  }

  private deleteNode(nodeId: string): void {
    const node = this.state.nodes.find((currentNode) => currentNode.id === nodeId);
    if (!node) {
      this.postMessage({
        type: 'host/error',
        payload: {
          message: '未找到可删除的节点。'
        }
      });
      return;
    }

    if (isExecutionNodeKind(node.kind)) {
      this.disposeExecutionSession(node.kind, nodeId, {
        terminateProcess: true
      });
    }

    this.state = deleteCanvasNode(this.state, nodeId);
    this.persistState();
    this.postState('host/stateUpdated');
  }

  private cancelAllTerminalSessions(): void {
    for (const nodeId of Array.from(this.terminalSessions.keys())) {
      this.disposeExecutionSession('terminal', nodeId, {
        terminateProcess: true
      });
    }
  }

  private disposeExecutionSession(
    kind: ExecutionNodeKind,
    nodeId: string,
    options: { terminateProcess: boolean }
  ): void {
    const sessionMap = this.getExecutionSessions(kind);
    const session = sessionMap.get(nodeId);
    if (!session) {
      return;
    }

    session.stopRequested = true;
    if (session.syncTimer) {
      clearTimeout(session.syncTimer);
      session.syncTimer = undefined;
    }

    session.outputSubscription?.dispose();
    session.exitSubscription?.dispose();
    sessionMap.delete(nodeId);

    if (options.terminateProcess) {
      session.process.kill();
    }
  }

  private queueExecutionStateSync(kind: ExecutionNodeKind, nodeId: string): void {
    const session = this.getExecutionSessions(kind).get(nodeId);
    if (!session || session.syncTimer) {
      return;
    }

    session.syncTimer = setTimeout(() => {
      const activeSession = this.getExecutionSessions(kind).get(nodeId);
      if (!activeSession) {
        return;
      }

      activeSession.syncTimer = undefined;
      this.flushLiveExecutionState(kind, nodeId);
    }, 160);
  }

  private flushLiveExecutionState(kind: ExecutionNodeKind, nodeId: string): void {
    const session = this.getExecutionSessions(kind).get(nodeId);
    if (!session) {
      return;
    }

    const cleanedOutput = stripTerminalControlSequences(session.buffer);
    const recentOutput = extractRecentTerminalOutput(cleanedOutput);
    this.state = updateExecutionNode(this.state, nodeId, kind, {
      status: 'live',
      summary:
        kind === 'agent'
          ? summarizeAgentSessionOutput(cleanedOutput, true, session.displayLabel)
          : summarizeEmbeddedTerminalOutput(cleanedOutput, true),
      metadata: buildExecutionMetadataPatch(this.state, nodeId, kind, {
        liveSession: true,
        shellPath: session.shellPath,
        cwd: session.cwd,
        recentOutput: recentOutput || undefined,
        lastCols: session.cols,
        lastRows: session.rows,
        ...(kind === 'agent' ? { lastBackendLabel: session.displayLabel } : {})
      })
    });
    this.persistState();
    this.postState('host/stateUpdated');
  }

  private postExecutionSnapshot(kind: ExecutionNodeKind, nodeId: string): void {
    const session = this.getExecutionSessions(kind).get(nodeId);
    const node = this.state.nodes.find((currentNode) => currentNode.id === nodeId && currentNode.kind === kind);
    const metadata =
      kind === 'agent'
        ? node
          ? ensureAgentMetadata(node)
          : undefined
        : node
          ? ensureTerminalMetadata(node)
          : undefined;

    this.postMessage({
      type: 'host/executionSnapshot',
      payload: {
        nodeId,
        kind,
        output: session?.buffer ?? '',
        cols: session?.cols ?? metadata?.lastCols ?? DEFAULT_TERMINAL_COLS,
        rows: session?.rows ?? metadata?.lastRows ?? DEFAULT_TERMINAL_ROWS,
        liveSession: Boolean(session)
      }
    });
    this.recordDiagnosticEvent('execution/snapshotPosted', {
      kind,
      nodeId,
      cols: session?.cols ?? metadata?.lastCols ?? DEFAULT_TERMINAL_COLS,
      rows: session?.rows ?? metadata?.lastRows ?? DEFAULT_TERMINAL_ROWS,
      liveSession: Boolean(session)
    });
  }

  private applyCreateNode(
    kind: CanvasNodeKind,
    preferredPosition?: CanvasNodePosition,
    options?: { bypassTrust?: boolean }
  ): void {
    if (
      isExecutionNodeKind(kind) &&
      !options?.bypassTrust &&
      !this.assertExecutionAllowed('当前 workspace 未受信任，已禁止创建 Agent / Terminal 节点。')
    ) {
      return;
    }

    this.state = createNextState(
      this.state,
      kind,
      this.getAgentCliConfig().defaultProvider,
      preferredPosition
    );

    this.persistState();
    this.postState('host/stateUpdated');
  }

  private recordHostMessageForTest(message: HostToWebviewMessage): void {
    if (this.context.extensionMode !== vscode.ExtensionMode.Test) {
      return;
    }

    this.testHostMessages.push(cloneJsonValue(message));
    if (this.testHostMessages.length > 200) {
      this.testHostMessages.splice(0, this.testHostMessages.length - 200);
    }
  }

  private recordDiagnosticEvent(kind: string, detail?: Record<string, unknown>): void {
    if (this.context.extensionMode !== vscode.ExtensionMode.Test) {
      return;
    }

    this.testDiagnosticEvents.push({
      timestamp: new Date().toISOString(),
      kind,
      detail: detail ? cloneJsonValue(detail) : undefined
    });
    if (this.testDiagnosticEvents.length > 400) {
      this.testDiagnosticEvents.splice(0, this.testDiagnosticEvents.length - 400);
    }
  }

  private resolvePendingWebviewProbeRequest(
    surface: CanvasSurfaceLocation,
    requestId: string,
    snapshot: WebviewProbeSnapshot
  ): void {
    const pendingRequest = this.pendingWebviewProbeRequests.get(requestId);
    if (!pendingRequest) {
      return;
    }

    clearTimeout(pendingRequest.timeout);
    this.pendingWebviewProbeRequests.delete(requestId);

    if (pendingRequest.surface !== surface) {
      pendingRequest.reject(new Error(`收到来自 ${surface} 的 probe 结果，但请求原本发往 ${pendingRequest.surface}。`));
      return;
    }

    pendingRequest.resolve(cloneJsonValue(snapshot));
  }

  private rejectPendingWebviewProbeRequests(surface: CanvasSurfaceLocation, message: string): void {
    for (const [requestId, pendingRequest] of this.pendingWebviewProbeRequests.entries()) {
      if (pendingRequest.surface !== surface) {
        continue;
      }

      clearTimeout(pendingRequest.timeout);
      this.pendingWebviewProbeRequests.delete(requestId);
      pendingRequest.reject(new Error(message));
    }
  }

  private resolvePendingWebviewDomActionRequest(
    surface: CanvasSurfaceLocation,
    requestId: string,
    ok: boolean,
    errorMessage: string | undefined
  ): void {
    const pendingRequest = this.pendingWebviewDomActionRequests.get(requestId);
    if (!pendingRequest) {
      return;
    }

    clearTimeout(pendingRequest.timeout);
    this.pendingWebviewDomActionRequests.delete(requestId);

    if (pendingRequest.surface !== surface) {
      pendingRequest.reject(
        new Error(`收到来自 ${surface} 的 DOM 动作结果，但请求原本发往 ${pendingRequest.surface}。`)
      );
      return;
    }

    if (!ok) {
      pendingRequest.reject(new Error(errorMessage || '真实 Webview DOM 动作执行失败。'));
      return;
    }

    pendingRequest.resolve();
  }

  private rejectPendingWebviewDomActionRequests(surface: CanvasSurfaceLocation, message: string): void {
    for (const [requestId, pendingRequest] of this.pendingWebviewDomActionRequests.entries()) {
      if (pendingRequest.surface !== surface) {
        continue;
      }

      clearTimeout(pendingRequest.timeout);
      this.pendingWebviewDomActionRequests.delete(requestId);
      pendingRequest.reject(new Error(message));
    }
  }
}

function createDefaultState(defaultAgentProvider: AgentProviderKind = 'codex'): CanvasPrototypeState {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    nodes: []
  };
}

function cloneJsonValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function delay(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, timeoutMs);
  });
}

function summarizeDiagnosticInput(data: string): string {
  const normalized = data.replace(/\r/g, '\\r').replace(/\n/g, '\\n');
  if (normalized.length <= 120) {
    return normalized;
  }

  return `${normalized.slice(0, 117)}...`;
}

function createNextState(
  previousState: CanvasPrototypeState,
  kind: CanvasNodeKind,
  defaultAgentProvider: AgentProviderKind = 'codex',
  preferredPosition?: CanvasNodePosition
): CanvasPrototypeState {
  const nextIndex = readNextNodeSequence(previousState.nodes);
  const nextNode = createNode(kind, nextIndex, defaultAgentProvider);
  const resolvedPosition = resolveNewNodePosition(
    previousState.nodes,
    kind,
    preferredPosition ?? nextNode.position
  );

  return {
    ...previousState,
    updatedAt: new Date().toISOString(),
    nodes: [
      ...previousState.nodes,
      {
        ...nextNode,
        position: resolvedPosition
      }
    ]
  };
}

function defaultSummaryForKind(kind: CanvasNodeKind): string {
  switch (kind) {
    case 'agent':
      return '尚未启动 Agent 会话。';
    case 'terminal':
      return '尚未启动嵌入式终端。';
    case 'task':
      return '等待补充任务描述。';
    case 'note':
      return '等待记录笔记内容。';
  }
}

function defaultStatusForKind(kind: CanvasNodeKind): string {
  switch (kind) {
    case 'agent':
      return 'draft';
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
    size: estimatedCanvasNodeFootprint(kind),
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

function resolveNewNodePosition(
  existingNodes: CanvasNodeSummary[],
  kind: CanvasNodeKind,
  anchor: CanvasNodePosition
): CanvasNodePosition {
  const normalizedAnchor = snapCanvasPosition(anchor);

  for (const candidate of buildPlacementCandidates(normalizedAnchor)) {
    if (!doesPlacementCollide(existingNodes, kind, candidate)) {
      return candidate;
    }
  }

  return fallbackPlacementPosition(existingNodes, kind, normalizedAnchor);
}

function buildPlacementCandidates(anchor: CanvasNodePosition): CanvasNodePosition[] {
  const offsets: Array<{ dx: number; dy: number; distance: number; backwardBias: number }> = [];

  for (let dx = -NODE_PLACEMENT_SEARCH_RADIUS; dx <= NODE_PLACEMENT_SEARCH_RADIUS; dx += 1) {
    for (let dy = -NODE_PLACEMENT_SEARCH_RADIUS; dy <= NODE_PLACEMENT_SEARCH_RADIUS; dy += 1) {
      offsets.push({
        dx,
        dy,
        distance: Math.abs(dx) + Math.abs(dy),
        backwardBias: (dx < 0 ? 1 : 0) + (dy < 0 ? 1 : 0)
      });
    }
  }

  offsets.sort((left, right) => {
    if (left.distance !== right.distance) {
      return left.distance - right.distance;
    }

    if (left.backwardBias !== right.backwardBias) {
      return left.backwardBias - right.backwardBias;
    }

    if (left.dy !== right.dy) {
      return left.dy - right.dy;
    }

    return left.dx - right.dx;
  });

  return offsets.map(({ dx, dy }) =>
    snapCanvasPosition({
      x: anchor.x + dx * NODE_PLACEMENT_STEP_X,
      y: anchor.y + dy * NODE_PLACEMENT_STEP_Y
    })
  );
}

function doesPlacementCollide(
  existingNodes: CanvasNodeSummary[],
  nextKind: CanvasNodeKind,
  nextPosition: CanvasNodePosition
): boolean {
  const nextRect = createPlacementRect(nextPosition, estimatedCanvasNodeFootprint(nextKind));

  return existingNodes.some((node) =>
    placementRectsOverlap(nextRect, createPlacementRect(node.position, node.size))
  );
}

function fallbackPlacementPosition(
  existingNodes: CanvasNodeSummary[],
  kind: CanvasNodeKind,
  normalizedAnchor: CanvasNodePosition
): CanvasNodePosition {
  if (existingNodes.length === 0) {
    return normalizedAnchor;
  }

  const bounds = existingNodes.reduce(
    (current, node) => {
      const rect = createPlacementRect(node.position, node.size);
      return {
        maxRight: Math.max(current.maxRight, rect.right),
        minTop: Math.min(current.minTop, rect.top)
      };
    },
    {
      maxRight: Number.NEGATIVE_INFINITY,
      minTop: Number.POSITIVE_INFINITY
    }
  );
  const nextFootprint = estimatedCanvasNodeFootprint(kind);

  return snapCanvasPosition({
    x: bounds.maxRight + NODE_PLACEMENT_PADDING,
    y: Math.max(bounds.minTop, normalizedAnchor.y - Math.round(nextFootprint.height / 3))
  });
}

function snapCanvasPosition(position: CanvasNodePosition): CanvasNodePosition {
  return {
    x: snapCanvasCoordinate(position.x),
    y: snapCanvasCoordinate(position.y)
  };
}

function snapCanvasCoordinate(value: number): number {
  return Math.round(value / 20) * 20;
}

function createPlacementRect(position: CanvasNodePosition, footprint: CanvasNodeFootprint): {
  left: number;
  top: number;
  right: number;
  bottom: number;
} {
  return {
    left: position.x,
    top: position.y,
    right: position.x + footprint.width,
    bottom: position.y + footprint.height
  };
}

function placementRectsOverlap(
  left: { left: number; top: number; right: number; bottom: number },
  right: { left: number; top: number; right: number; bottom: number }
): boolean {
  return (
    left.left < right.right + NODE_PLACEMENT_PADDING &&
    left.right > right.left - NODE_PLACEMENT_PADDING &&
    left.top < right.bottom + NODE_PLACEMENT_PADDING &&
    left.bottom > right.top - NODE_PLACEMENT_PADDING
  );
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

function resizeNode(
  previousState: CanvasPrototypeState,
  nodeId: string,
  size: CanvasNodeFootprint
): CanvasPrototypeState {
  const targetNode = previousState.nodes.find((node) => node.id === nodeId);
  if (!targetNode) {
    return previousState;
  }

  const normalizedSize = normalizeCanvasNodeFootprint(targetNode.kind, size);
  const didChange =
    targetNode.size.width !== normalizedSize.width || targetNode.size.height !== normalizedSize.height;

  if (!didChange) {
    return previousState;
  }

  return {
    ...previousState,
    updatedAt: new Date().toISOString(),
    nodes: previousState.nodes.map((node) =>
      node.id === nodeId
        ? {
            ...node,
            size: normalizedSize
          }
        : node
    )
  };
}

function deleteCanvasNode(previousState: CanvasPrototypeState, nodeId: string): CanvasPrototypeState {
  const nextNodes = previousState.nodes.filter((node) => node.id !== nodeId);
  if (nextNodes.length === previousState.nodes.length) {
    return previousState;
  }

  return {
    ...previousState,
    updatedAt: new Date().toISOString(),
    nodes: nextNodes
  };
}

function normalizeState(
  value: unknown,
  defaultAgentProvider: AgentProviderKind = 'codex'
): CanvasPrototypeState {
  if (!isRecord(value)) {
    return createDefaultState(defaultAgentProvider);
  }

  const hasStoredNodesArray = Array.isArray(value.nodes);
  const rawNodes: unknown[] = hasStoredNodesArray ? (value.nodes as unknown[]) : [];
  const nodes = rawNodes
    .map((node, index) => normalizeNode(node, index, defaultAgentProvider))
    .filter((node): node is CanvasNodeSummary => node !== null);

  const normalizedNodes = hasStoredNodesArray
    ? rawNodes.length === 0
      ? []
      : nodes.length > 0
        ? nodes
        : createDefaultState(defaultAgentProvider).nodes
    : createDefaultState(defaultAgentProvider).nodes;

  return {
    version: 1,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date().toISOString(),
    nodes: reconcileRuntimeNodesInArray(normalizedNodes)
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
    size: normalizeCanvasNodeFootprint(value.kind, value.size),
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

function readNextNodeSequence(nodes: CanvasNodeSummary[]): number {
  const maxSequence = nodes.reduce((currentMax, node) => {
    const matchedSuffix = node.id.match(/-(\d+)$/);
    if (!matchedSuffix) {
      return currentMax;
    }

    const parsedValue = Number.parseInt(matchedSuffix[1], 10);
    return Number.isFinite(parsedValue) ? Math.max(currentMax, parsedValue) : currentMax;
  }, 0);

  return maxSequence + 1;
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
    backend: 'node-pty',
    provider,
    shellPath: defaultAgentCommand(provider),
    cwd: defaultTerminalWorkingDirectory(),
    liveSession: false,
    autoStartPending: false,
    lastCols: DEFAULT_TERMINAL_COLS,
    lastRows: DEFAULT_TERMINAL_ROWS,
    lastBackendLabel: agentProviderDisplayLabel(provider)
  };
}

function createTerminalMetadata(nodeId: string): TerminalNodeMetadata {
  return {
    backend: 'node-pty',
    shellPath: defaultTerminalShellPath(),
    cwd: defaultTerminalWorkingDirectory(),
    liveSession: false,
    autoStartPending: false,
    lastCols: DEFAULT_TERMINAL_COLS,
    lastRows: DEFAULT_TERMINAL_ROWS
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
    const provider =
      agent.provider === 'claude' || agent.provider === 'codex'
        ? agent.provider
        : defaultAgentProvider;
    const fallback = createAgentMetadata(provider);

    return {
      agent: {
        backend: 'node-pty',
        provider,
        shellPath:
          typeof agent.shellPath === 'string'
            ? agent.shellPath
            : fallback.shellPath,
        cwd:
          typeof agent.cwd === 'string'
            ? agent.cwd
            : fallback.cwd,
        liveSession:
          typeof agent.liveSession === 'boolean'
            ? agent.liveSession
            : typeof agent.liveRun === 'boolean'
              ? agent.liveRun
              : fallback.liveSession,
        autoStartPending: false,
        recentOutput:
          typeof agent.recentOutput === 'string'
            ? trimStoredTerminalText(agent.recentOutput)
            : typeof agent.lastResponse === 'string'
              ? trimStoredTerminalText(agent.lastResponse)
              : undefined,
        lastExitCode:
          typeof agent.lastExitCode === 'number'
            ? agent.lastExitCode
            : undefined,
        lastExitSignal:
          typeof agent.lastExitSignal === 'string'
            ? agent.lastExitSignal
            : undefined,
        lastExitMessage:
          typeof agent.lastExitMessage === 'string'
            ? trimStoredTerminalText(agent.lastExitMessage)
            : undefined,
        lastCols:
          typeof agent.lastCols === 'number'
            ? normalizeTerminalCols(agent.lastCols)
            : fallback.lastCols,
        lastRows:
          typeof agent.lastRows === 'number'
            ? normalizeTerminalRows(agent.lastRows)
            : fallback.lastRows,
        lastBackendLabel:
          typeof agent.lastBackendLabel === 'string'
            ? agent.lastBackendLabel
            : typeof agent.lastModelName === 'string'
              ? agent.lastModelName
              : fallback.lastBackendLabel
      }
    };
  }

  if (kind === 'terminal') {
    const terminal = isRecord(record.terminal) ? record.terminal : {};
    const fallback = createTerminalMetadata(nodeId);

    return {
      terminal: {
        backend: 'node-pty',
        shellPath:
          typeof terminal.shellPath === 'string'
            ? terminal.shellPath
            : fallback.shellPath,
        cwd:
          typeof terminal.cwd === 'string'
            ? terminal.cwd
            : fallback.cwd,
        liveSession: false,
        autoStartPending: false,
        recentOutput:
          typeof terminal.recentOutput === 'string'
            ? trimStoredTerminalText(terminal.recentOutput)
            : undefined,
        lastExitCode:
          typeof terminal.lastExitCode === 'number'
            ? terminal.lastExitCode
            : undefined,
        lastExitSignal:
          typeof terminal.lastExitSignal === 'string'
            ? terminal.lastExitSignal
            : undefined,
        lastExitMessage:
          typeof terminal.lastExitMessage === 'string'
            ? trimStoredTerminalText(terminal.lastExitMessage)
            : undefined,
        lastCols:
          typeof terminal.lastCols === 'number'
            ? normalizeTerminalCols(terminal.lastCols)
            : fallback.lastCols,
        lastRows:
          typeof terminal.lastRows === 'number'
            ? normalizeTerminalRows(terminal.lastRows)
            : fallback.lastRows
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

function reconcileRuntimeNodes(
  state: CanvasPrototypeState,
  agentSessions: Map<string, EmbeddedExecutionSession> = new Map(),
  terminalSessions: Map<string, EmbeddedExecutionSession> = new Map()
): CanvasPrototypeState {
  return {
    ...state,
    nodes: reconcileRuntimeNodesInArray(state.nodes, agentSessions, terminalSessions)
  };
}

function reconcileRuntimeNodesInArray(
  nodes: CanvasNodeSummary[],
  agentSessions: Map<string, EmbeddedExecutionSession> = new Map(),
  terminalSessions: Map<string, EmbeddedExecutionSession> = new Map()
): CanvasNodeSummary[] {
  return reconcileTaskAndNoteNodesInArray(
    reconcileAgentNodesInArray(
      reconcileTerminalNodesInArray(nodes, terminalSessions),
      agentSessions
    )
  );
}

function reconcileAgentNodesInArray(
  nodes: CanvasNodeSummary[],
  agentSessions: Map<string, EmbeddedExecutionSession> = new Map()
): CanvasNodeSummary[] {
  return nodes.map((node) => {
    if (node.kind !== 'agent') {
      return node;
    }

    const metadata = ensureAgentMetadata(node);
    const liveSession = agentSessions.get(node.id);
    if (liveSession) {
      const cleanedOutput = stripTerminalControlSequences(liveSession.buffer);
      const recentOutput = extractRecentTerminalOutput(cleanedOutput);

      return {
        ...node,
        status: 'live',
        summary: summarizeAgentSessionOutput(cleanedOutput, true, liveSession.displayLabel),
        metadata: {
          ...node.metadata,
          agent: {
            ...metadata,
            liveSession: true,
            shellPath: liveSession.shellPath,
            cwd: liveSession.cwd,
            recentOutput: recentOutput || metadata.recentOutput,
            lastCols: liveSession.cols,
            lastRows: liveSession.rows,
            lastBackendLabel: liveSession.displayLabel
          }
        }
      };
    }

    if (metadata.liveSession) {
      return {
        ...node,
        status: 'interrupted',
        summary: '上一次 Agent 会话在扩展重载后未恢复，可重新启动。',
        metadata: {
          ...node.metadata,
          agent: {
            ...metadata,
            liveSession: false
          }
        }
      };
    }

    if (shouldResetIdleAgentNode(node, metadata)) {
      return {
        ...node,
        status: 'draft',
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
        agent: {
          ...metadata,
          liveSession: false
        }
      }
    };
  });
}

function reconcileTerminalNodesInArray(
  nodes: CanvasNodeSummary[],
  terminalSessions: Map<string, EmbeddedExecutionSession> = new Map()
): CanvasNodeSummary[] {
  return nodes.map((node) => {
    if (node.kind !== 'terminal') {
      return node;
    }

    const metadata = ensureTerminalMetadata(node);
    const liveSession = terminalSessions.get(node.id);
    if (liveSession) {
      const cleanedOutput = stripTerminalControlSequences(liveSession.buffer);
      const recentOutput = extractRecentTerminalOutput(cleanedOutput);

      return {
        ...node,
        status: 'live',
        summary: summarizeEmbeddedTerminalOutput(cleanedOutput, true),
        metadata: {
          terminal: {
            ...metadata,
            liveSession: true,
            shellPath: liveSession.shellPath,
            cwd: liveSession.cwd,
            recentOutput: recentOutput || metadata.recentOutput,
            lastCols: liveSession.cols,
            lastRows: liveSession.rows
          }
        }
      };
    }

    if (metadata.liveSession) {
      return {
        ...node,
        status: 'interrupted',
        summary: '上一次嵌入式终端在扩展重载后未恢复，可重新启动。',
        metadata: {
          terminal: {
            ...metadata,
            liveSession: false
          }
        }
      };
    }

    if (isLegacyPlaceholderTerminal(node) || shouldResetIdleTerminalNode(node, metadata)) {
      return {
        ...node,
        status: 'draft',
        summary: defaultSummaryForKind('terminal'),
        metadata: {
          ...node.metadata,
          terminal: metadata
        }
      };
    }

    return {
      ...node,
      metadata: {
        terminal: {
          ...metadata,
          liveSession: false
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

function updateExecutionNode(
  state: CanvasPrototypeState,
  nodeId: string,
  kind: ExecutionNodeKind,
  patch: Pick<CanvasNodeSummary, 'status' | 'summary' | 'metadata'>
): CanvasPrototypeState {
  return kind === 'agent'
    ? updateAgentNode(state, nodeId, patch)
    : updateTerminalNode(state, nodeId, patch);
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

function readExecutionStatus(
  state: CanvasPrototypeState,
  nodeId: string,
  kind: ExecutionNodeKind
): string {
  return kind === 'agent' ? readAgentStatus(state, nodeId) : readTerminalStatus(state, nodeId);
}

function readExecutionSummary(
  state: CanvasPrototypeState,
  nodeId: string,
  kind: ExecutionNodeKind
): string {
  return kind === 'agent' ? readAgentSummary(state, nodeId) : readTerminalSummary(state, nodeId);
}

function readAgentStatus(state: CanvasPrototypeState, nodeId: string): string {
  const agentNode = state.nodes.find((node) => node.id === nodeId && node.kind === 'agent');
  return agentNode?.status ?? 'draft';
}

function readAgentSummary(state: CanvasPrototypeState, nodeId: string): string {
  const agentNode = state.nodes.find((node) => node.id === nodeId && node.kind === 'agent');
  return agentNode?.summary ?? defaultSummaryForKind('agent');
}

function readTerminalStatus(state: CanvasPrototypeState, nodeId: string): string {
  const terminalNode = state.nodes.find((node) => node.id === nodeId && node.kind === 'terminal');
  return terminalNode?.status ?? 'draft';
}

function readTerminalSummary(state: CanvasPrototypeState, nodeId: string): string {
  const terminalNode = state.nodes.find((node) => node.id === nodeId && node.kind === 'terminal');
  return terminalNode?.summary ?? defaultSummaryForKind('terminal');
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
  patch: Partial<AgentNodeMetadata>
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

function buildTerminalMetadataPatch(
  state: CanvasPrototypeState,
  nodeId: string,
  patch: Partial<TerminalNodeMetadata>
): CanvasNodeMetadata {
  const currentNode = state.nodes.find((node) => node.id === nodeId);

  return {
    ...currentNode?.metadata,
    terminal: {
      ...(currentNode ? ensureTerminalMetadata(currentNode) : createTerminalMetadata(nodeId)),
      ...patch
    }
  };
}

function buildExecutionMetadataPatch(
  state: CanvasPrototypeState,
  nodeId: string,
  kind: ExecutionNodeKind,
  patch: Partial<AgentNodeMetadata> | Partial<TerminalNodeMetadata>
): CanvasNodeMetadata {
  return kind === 'agent'
    ? buildAgentMetadataPatch(state, nodeId, patch as Partial<AgentNodeMetadata>)
    : buildTerminalMetadataPatch(state, nodeId, patch as Partial<TerminalNodeMetadata>);
}

function shouldResetIdleAgentNode(
  node: CanvasNodeSummary,
  metadata: AgentNodeMetadata
): boolean {
  return (
    (node.summary === '等待接入真实 backend 的原型节点' ||
      node.summary === 'Agent 会话准备按节点尺寸自动启动。') &&
    !metadata.liveSession &&
    !metadata.recentOutput &&
    !metadata.lastExitMessage
  );
}

function shouldResetIdleTerminalNode(
  node: CanvasNodeSummary,
  metadata: TerminalNodeMetadata
): boolean {
  return (
    node.summary === '终端准备按节点尺寸自动启动。' &&
    !metadata.liveSession &&
    !metadata.recentOutput &&
    !metadata.lastExitMessage
  );
}

function createExecutionSessionId(nodeId: string, kind: ExecutionNodeKind): string {
  return `${nodeId}-${kind}-${Date.now().toString(36)}`;
}

function defaultTerminalShellPath(): string {
  if (process.platform === 'win32') {
    return process.env.ComSpec?.trim() || process.env.COMSPEC?.trim() || 'powershell.exe';
  }

  return process.env.SHELL?.trim() || '/bin/bash';
}

function defaultTerminalWorkingDirectory(): string {
  if (process.platform === 'win32') {
    return (
      process.env.USERPROFILE?.trim() ||
      process.env.HOME?.trim() ||
      process.cwd()
    );
  }

  return process.env.HOME?.trim() || process.cwd();
}

function defaultAgentCommand(provider: AgentProviderKind): string {
  return provider === 'claude' ? 'claude' : 'codex';
}

function agentProviderDisplayLabel(provider: AgentProviderKind): string {
  return provider === 'claude' ? 'Claude Code' : 'Codex';
}

function normalizeExecutionExitSignal(signal: string | undefined): string | undefined {
  const normalizedSignal = signal?.trim();
  return normalizedSignal && normalizedSignal !== '0' ? normalizedSignal : undefined;
}

function normalizeTerminalCols(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_TERMINAL_COLS;
  }

  return Math.max(40, Math.min(220, Math.round(value)));
}

function normalizeTerminalRows(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_TERMINAL_ROWS;
  }

  return Math.max(12, Math.min(80, Math.round(value)));
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

function trimStoredTerminalText(value: string): string {
  return value.length > 6000 ? value.slice(-6000) : value;
}

function trimStoredNodeText(value: string): string {
  return value.length > 8000 ? value.slice(0, 8000) : value;
}

function appendTerminalBuffer(existing: string, nextChunk: string): string {
  return trimStoredTerminalText(`${existing}${nextChunk}`);
}

function stripTerminalControlSequences(value: string): string {
  return value
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, '')
    .replace(/\u001b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');
}

function extractRecentTerminalOutput(value: string): string {
  const trimmed = value.replace(/\r/g, '').trim();
  if (!trimmed) {
    return '';
  }

  return trimStoredTerminalText(trimmed);
}

function summarizeEmbeddedTerminalOutput(output: string, live: boolean): string {
  const normalized = output
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const lastLine = normalized[normalized.length - 1];

  if (!lastLine) {
    return live ? '嵌入式终端已启动，等待输入。' : '终端会话已结束。';
  }

  return lastLine.length > 140 ? `${lastLine.slice(0, 140)}...` : lastLine;
}

function summarizeAgentSessionOutput(output: string, live: boolean, label: string): string {
  const normalized = output
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const lastLine = normalized[normalized.length - 1];

  if (!lastLine) {
    return live ? `${label} 会话已启动，等待输入。` : `${label} 会话已结束。`;
  }

  return lastLine.length > 140 ? `${lastLine.slice(0, 140)}...` : lastLine;
}

function describeAgentSessionSpawnError(spec: AgentCliSpec, error: unknown): string {
  if (isIncompatibleNodePtyRuntimeError(error)) {
    return `当前 node-pty 运行时与 VS Code 扩展宿主不兼容，已阻止启动 ${spec.label} 以避免插件崩溃。请重新执行 npm install，或升级到兼容当前 VS Code 版本的依赖后重试。`;
  }

  if (isMissingNodePtyDependencyError(error)) {
    return '缺少 node-pty 运行时依赖，请在仓库根目录执行 npm install 后重试。';
  }

  if (isRecord(error) && error.code === 'ENOENT') {
    const suffix =
      process.platform === 'win32'
        ? '请确认它在 Extension Host 的 PATH 中，或通过设置项显式指定 .exe / .cmd 命令路径。'
        : '请确认它在 Extension Host 的 PATH 中，或通过设置项显式指定命令路径。';
    return `没有找到 ${spec.label} 命令 ${spec.command}。${suffix}`;
  }

  if (error instanceof Error && error.message) {
    return `启动 ${spec.label} 失败：${error.message}`;
  }

  return `启动 ${spec.label} 失败。`;
}

function describeAgentSessionExit(
  spec: AgentCliSpec,
  code: number | null,
  signal: string | undefined,
  output: string
): string {
  const summary = summarizeAgentSessionOutput(output, false, spec.label);
  const suffix = summary === `${spec.label} 会话已结束。` ? '' : ` ${summary}`;
  const normalizedSignal = normalizeExecutionExitSignal(signal);

  if (normalizedSignal) {
    return `${spec.label} 因信号 ${normalizedSignal} 退出。${suffix}`.trim();
  }

  if (typeof code === 'number') {
    return `${spec.label} 以退出码 ${code} 结束。${suffix}`.trim();
  }

  return `${spec.label} 提前结束。${suffix}`.trim();
}

function describeEmbeddedTerminalSpawnError(shellPath: string, error: unknown): string {
  if (isIncompatibleNodePtyRuntimeError(error)) {
    return '当前 node-pty 运行时与 VS Code 扩展宿主不兼容，已阻止启动嵌入式终端以避免插件崩溃。请重新执行 npm install，或升级到兼容当前 VS Code 版本的依赖后重试。';
  }

  if (isMissingNodePtyDependencyError(error)) {
    return '缺少 node-pty 运行时依赖，请在仓库根目录执行 npm install 后重试。';
  }

  if (isRecord(error) && error.code === 'ENOENT') {
    return `没有找到启动嵌入式终端所需的 shell 或命令：${shellPath}。请检查终端 shell 路径配置，或确认当前平台可正常加载 node-pty 运行时。`;
  }

  if (error instanceof Error && error.message) {
    return `启动嵌入式终端失败：${error.message}`;
  }

  return '启动嵌入式终端失败。';
}

function describeEmbeddedTerminalExit(
  shellPath: string,
  code: number | null,
  signal: string | undefined,
  output: string
): string {
  const summary = summarizeEmbeddedTerminalOutput(output, false);
  const suffix = summary === '终端会话已结束。' ? '' : ` ${summary}`;
  const normalizedSignal = normalizeExecutionExitSignal(signal);

  if (normalizedSignal) {
    return `终端 shell ${shellPath} 因信号 ${normalizedSignal} 退出。${suffix}`.trim();
  }

  if (typeof code === 'number') {
    return `终端 shell ${shellPath} 以退出码 ${code} 结束。${suffix}`.trim();
  }

  return `终端 shell ${shellPath} 已结束。${suffix}`.trim();
}

function isLegacyPlaceholderTerminal(node: CanvasNodeSummary): boolean {
  return (
    node.summary === '尚未创建宿主终端，选中后可创建并显示。' ||
    node.summary === '宿主终端已连接，可直接显示。' ||
    node.summary === '宿主终端已关闭，可重新创建。' ||
    node.summary === '已匹配到现存宿主终端，可直接显示。'
  );
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
