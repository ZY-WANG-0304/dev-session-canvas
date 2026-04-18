import { createHash, randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import {
  AGENT_WAITING_INPUT_POLL_INTERVAL_MS,
  createAgentActivityHeuristicState,
  evaluateAgentWaitingInputTransition,
  recordAgentOutputHeuristics,
  resetAgentActivityHeuristics,
  stripTerminalControlSequences,
  type AgentActivityHeuristicState
} from '../common/agentActivityHeuristics';
import {
  CONTEXT_KEYS,
  CONFIG_KEYS,
  EXTENSION_DISPLAY_NAME,
  STORAGE_KEYS,
  VIEW_IDS
} from '../common/extensionIdentity';
import {
  selectPreferredExtensionStorageRecoverySource,
  type ExtensionStorageRecoverySourceSelection
} from '../common/extensionStoragePaths';
import {
  type AgentNodeStatus,
  type AgentNodeMetadata,
  type AgentProviderKind,
  type AgentResumeStrategy,
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
  type PendingExecutionLaunch,
  type RuntimeAttachmentState,
  type RuntimeHostBackendKind,
  type RuntimePersistenceMode,
  type RuntimePersistenceGuarantee,
  type TerminalNodeStatus,
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
  SerializedTerminalStateTracker,
  cloneSerializedTerminalState,
  normalizeSerializedTerminalState
} from '../common/serializedTerminalState';
import { DEFAULT_TERMINAL_SCROLLBACK, normalizeTerminalScrollback } from '../common/terminalScrollback';
import {
  createExecutionSessionProcess,
  type DisposableLike,
  type ExecutionSessionExitEvent,
  type ExecutionSessionLaunchSpec,
  type ExecutionSessionProcess,
  isIncompatibleNodePtyRuntimeError,
  isMissingNodePtyDependencyError
} from './executionSessionBridge';
import {
  isExplicitRelativePath,
  isAgentCliResolutionError,
  resolveAgentCliCommand,
  type AgentCliResolutionCacheEntry,
  type AgentCliResolutionSource
} from './agentCliResolver';
import { getConfigurationValue } from './configuration';
import { getWebviewHtml } from './getWebviewHtml';
import { RuntimeSupervisorClient } from './runtimeSupervisorClient';
import {
  serializeExecutionSessionLaunchSpec,
  type RuntimeSupervisorCreateSessionParams,
  type RuntimeSupervisorSessionSnapshot
} from '../common/runtimeSupervisorProtocol';
import { locateCodexSessionId } from '../common/codexSessionIdLocator';
import {
  createRuntimeHostBackend,
  listPreferredRuntimeHostBackendKinds,
  type RuntimeHostBackend
} from './runtimeHostBackend';
import type {
  ExecutionTerminalFileLinkCandidate,
  ExecutionTerminalDroppedResource,
  ExecutionTerminalOpenLink
} from '../common/executionTerminalLinks';
import {
  inferExecutionTerminalPathStyle,
  normalizeEditorMultiCursorModifier,
  normalizeExecutionTerminalWordSeparators,
  openExecutionTerminalLink,
  prepareExecutionTerminalDroppedPath,
  resolveExecutionTerminalFileLinkCandidates,
  type OpenExecutionTerminalLinkResult,
  type ResolvedExecutionFileLink
} from './executionTerminalNativeHelpers';
import { ExecutionTerminalLineContextTracker } from './executionTerminalLineContextTracker';

const DEFAULT_TERMINAL_COLS = 96;
const DEFAULT_TERMINAL_ROWS = 28;
const NODE_PLACEMENT_PADDING = 40;
const NODE_PLACEMENT_STEP_X = 120;
const NODE_PLACEMENT_STEP_Y = 96;
const NODE_PLACEMENT_SEARCH_RADIUS = 8;
const EXECUTION_OUTPUT_FLUSH_INTERVAL_MS = 32;
const EXECUTION_OUTPUT_STATE_SYNC_INTERVAL_MS = 1000;
const EXECUTION_INTERACTION_STATE_SYNC_INTERVAL_MS = 160;
const AGENT_CLI_RESOLUTION_CACHE_KEY = 'devSessionCanvas.agent.cliResolutionCache';
const FAKE_PROVIDER_STORAGE_PATH_ENV_KEY = 'DEV_SESSION_CANVAS_FAKE_PROVIDER_STORAGE_PATH';
const RELOAD_WINDOW_ACTION_LABEL = '重新加载窗口';

interface AgentCliConfig {
  defaultProvider: AgentProviderKind;
  codexCommand: string;
  claudeCommand: string;
}

interface AgentCliSpec {
  provider: AgentProviderKind;
  label: string;
  requestedCommand: string;
  command: string;
  resolutionSource: AgentCliResolutionSource;
}

interface AgentResumeContext {
  supported: boolean;
  strategy: AgentResumeStrategy;
  sessionId?: string;
  storagePath?: string;
}

type LiveRuntimeReconnectBlockReason = 'workspace-untrusted' | 'runtime-persistence-disabled';

interface ManagedExecutionSessionBase {
  sessionId: string;
  owner: 'local' | 'supervisor';
  startedAtMs: number;
  shellPath: string;
  cwd: string;
  cols: number;
  rows: number;
  buffer: string;
  terminalStateTracker: SerializedTerminalStateTracker;
  lineContextTracker: ExecutionTerminalLineContextTracker;
  stopRequested: boolean;
  syncTimer: NodeJS.Timeout | undefined;
  syncDueAtMs: number | undefined;
  lifecycleTimer: NodeJS.Timeout | undefined;
  pendingOutput: string;
  outputFlushTimer: NodeJS.Timeout | undefined;
  displayLabel: string;
  lifecycleStatus: AgentNodeStatus | TerminalNodeStatus;
  launchMode: PendingExecutionLaunch;
  resumePhaseActive: boolean;
  runtimeBackend?: RuntimeHostBackendKind;
  runtimeGuarantee?: RuntimePersistenceGuarantee;
  runtimeStoragePath?: string;
  runtimeSessionId?: string;
  agentProvider?: AgentProviderKind;
  agentResume?: AgentResumeContext;
  agentActivity?: AgentActivityHeuristicState;
}

interface LocalExecutionSession extends ManagedExecutionSessionBase {
  owner: 'local';
  process: ExecutionSessionProcess;
  outputSubscription: DisposableLike | undefined;
  exitSubscription: DisposableLike | undefined;
}

interface SupervisorExecutionSession extends ManagedExecutionSessionBase {
  owner: 'supervisor';
  runtimeSessionId: string;
  outputSubscription: undefined;
  exitSubscription: undefined;
}

type ManagedExecutionSession = LocalExecutionSession | SupervisorExecutionSession;

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

interface PersistedCanvasSnapshot {
  version: 1;
  writtenAt?: string;
  stateHash?: string;
  state?: unknown;
  activeSurface?: CanvasSurfaceLocation;
  defaultSurface?: CanvasSurfaceLocation;
  runtimePersistenceEnabled?: boolean;
}

interface CanvasStartupConfiguration {
  defaultSurface: CanvasSurfaceLocation;
  runtimePersistenceEnabled: boolean;
}

interface PersistedCanvasStateFlushResult {
  snapshotPath: string;
  exists: boolean;
  lastError?: string;
  writtenAt?: string;
  snapshot?: PersistedCanvasSnapshot;
}

interface StartExecutionSessionForTestParams {
  kind: ExecutionNodeKind;
  nodeId: string;
  cols?: number;
  rows?: number;
  provider?: AgentProviderKind;
  resumeRequested?: boolean;
}

interface RuntimeSupervisorRegistryForTest {
  runtimeStoragePath?: string;
  registryPath?: string;
  exists: boolean;
  registry?: unknown;
  error?: string;
  entries?: RuntimeSupervisorRegistryEntryForTest[];
}

interface RuntimeSupervisorRegistryEntryForTest {
  runtimeStoragePath: string;
  registryPath?: string;
  exists: boolean;
  registry?: unknown;
  error?: string;
}

interface RuntimeSupervisorDebugStateForTest {
  pendingRuntimeSupervisorOperationCount: number;
  bindings: Array<{
    runtimeSessionId: string;
    runtimeStoragePath: string;
    nodeId: string;
    kind: ExecutionNodeKind;
  }>;
  registries: Partial<Record<RuntimeHostBackendKind, RuntimeSupervisorRegistryForTest>>;
}

interface ConnectedRuntimeSupervisorClient {
  client: RuntimeSupervisorClient;
  backend: RuntimeHostBackend;
  runtimeStoragePath: string;
  fallbackReason?: string;
}

interface PersistedLiveRuntimeSession {
  backendKind: RuntimeHostBackendKind;
  sessionId: string;
  runtimeStoragePath?: string;
}

interface StartExecutionSessionOptions {
  bypassTrust?: boolean;
}

export class CanvasPanelManager implements vscode.WebviewPanelSerializer, vscode.WebviewViewProvider {
  public static readonly viewType = VIEW_IDS.editorWebviewPanel;
  public static readonly panelViewType = VIEW_IDS.panelWebviewView;
  public static readonly panelContainerId = VIEW_IDS.panelContainer;
  private static readonly RECOVERABLE_STORAGE_RELATIVE_PATHS = [
    'canvas-state.json',
    'agent-runtime'
  ] as const;

  private readonly rawExtensionStoragePath: string;
  private storageRecoverySelection!: ExtensionStorageRecoverySourceSelection;
  private editorPanel: vscode.WebviewPanel | undefined;
  private panelView: vscode.WebviewView | undefined;
  private appliedStartupConfiguration: CanvasStartupConfiguration;
  private state: CanvasPrototypeState;
  private activeSurface: CanvasSurfaceLocation | undefined;
  private readonly surfaceMode: Partial<Record<CanvasSurfaceLocation, CanvasSurfaceMode>> = {};
  private readonly surfaceReady: Record<CanvasSurfaceLocation, boolean> = {
    editor: false,
    panel: false
  };
  private readonly pendingVisibilityRestore: Record<CanvasSurfaceLocation, boolean> = {
    editor: false,
    panel: false
  };
  private readonly agentSessions = new Map<string, ManagedExecutionSession>();
  private readonly terminalSessions = new Map<string, ManagedExecutionSession>();
  private readonly runtimeSessionBindings = new Map<
    string,
    { nodeId: string; kind: ExecutionNodeKind; runtimeSessionId: string; runtimeStoragePath: string }
  >();
  private readonly sidebarStateEmitter = new vscode.EventEmitter<CanvasSidebarState>();
  private readonly testHostMessages: HostToWebviewMessage[] = [];
  private readonly testDiagnosticEvents: CanvasTestDiagnosticEvent[] = [];
  private readonly pendingWebviewProbeRequests = new Map<string, PendingWebviewProbeRequest>();
  private readonly pendingWebviewDomActionRequests = new Map<string, PendingWebviewDomActionRequest>();
  private readonly resolvedExecutionFileLinks = new Map<
    string,
    { nodeId: string; kind: ExecutionNodeKind; resolved: ResolvedExecutionFileLink }
  >();
  private readonly pendingRuntimeSupervisorOperations = new Set<Promise<unknown>>();
  private readonly executionSessionOperationTokens = new Map<string, number>();
  private pendingWorkspaceStateUpdate: Promise<void> = Promise.resolve();
  private lastPersistedCanvasSnapshotError: string | undefined;
  private lastPersistedCanvasSnapshotWrittenAt: string | undefined;
  private readonly runtimeSupervisorClients = new Map<string, RuntimeSupervisorClient>();
  private preferredRuntimeHostBackendKind: RuntimeHostBackendKind | undefined;
  private preferredRuntimeHostBackendFallbackReason: string | undefined;
  private readonly agentCliResolutionCache: Record<string, AgentCliResolutionCacheEntry>;

  public readonly onDidChangeSidebarState = this.sidebarStateEmitter.event;

  public constructor(private readonly context: vscode.ExtensionContext) {
    this.agentCliResolutionCache = readAgentCliResolutionCache(
      context.globalState.get<Record<string, AgentCliResolutionCacheEntry>>(AGENT_CLI_RESOLUTION_CACHE_KEY)
    );
    this.rawExtensionStoragePath = this.context.storageUri?.fsPath ?? this.context.globalStorageUri.fsPath;
    this.appliedStartupConfiguration = this.readStartupConfiguration();
    this.refreshStorageRecoverySelection();
    this.state = this.loadReconciledState();
    this.activeSurface = this.loadStoredSurface();
    this.persistState();
    this.applyWorkbenchContextKeys();
    this.recordDiagnosticEvent('state/initialized', {
      activeSurface: this.activeSurface,
      nodeCount: this.state.nodes.length,
      storagePath: this.getExtensionStoragePath(),
      recoverySourcePath:
        this.storageRecoverySelection.sourcePath === this.storageRecoverySelection.writePath
          ? undefined
          : this.storageRecoverySelection.sourcePath,
      storageSelectionBasis: this.storageRecoverySelection.selectionBasis
    });
    context.subscriptions.push(this.sidebarStateEmitter);

    context.subscriptions.push(
      vscode.workspace.onDidGrantWorkspaceTrust(() => {
        this.recordDiagnosticEvent('workspace/trustGranted');
        this.state = this.loadReconciledState();
        this.persistState();
        this.postState('host/stateUpdated');
        this.scheduleRestoreLiveRuntimeSessions();
      })
    );

    context.subscriptions.push(
      vscode.window.onDidChangeActiveColorTheme(() => {
        this.postMessage({
          type: 'host/themeChanged'
        });
      })
    );

    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        const defaultSurfaceChanged = event.affectsConfiguration(CONFIG_KEYS.canvasDefaultSurface);
        const runtimePersistenceChanged = event.affectsConfiguration(CONFIG_KEYS.runtimePersistenceEnabled);
        const defaultAgentProviderChanged = event.affectsConfiguration(CONFIG_KEYS.agentDefaultProvider);
        const terminalScrollbackChanged = event.affectsConfiguration('terminal.integrated.scrollback');
        const multiCursorModifierChanged = event.affectsConfiguration('editor.multiCursorModifier');
        const terminalWordSeparatorsChanged = event.affectsConfiguration(
          'terminal.integrated.wordSeparators'
        );

        if (defaultSurfaceChanged || runtimePersistenceChanged) {
          void this.notifyReloadRequiredConfigurationChanged({
            defaultSurfaceChanged,
            runtimePersistenceChanged
          });
        }

        if (
          !defaultAgentProviderChanged &&
          !terminalScrollbackChanged &&
          !multiCursorModifierChanged &&
          !terminalWordSeparatorsChanged
        ) {
          return;
        }

        void this.handleRuntimeConfigurationChanged({
          defaultAgentProviderChanged,
          terminalScrollbackChanged,
          multiCursorModifierChanged,
          terminalWordSeparatorsChanged
        });
      })
    );

    context.subscriptions.push(
      new vscode.Disposable(() => {
        this.disposeRuntimeSupervisorClients();
      })
    );

    this.scheduleRestoreLiveRuntimeSessions();
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
      creatableKinds: vscode.workspace.isTrusted ? ['agent', 'terminal', 'note'] : ['note']
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

  public getRuntimeSupervisorStateForTest(): RuntimeSupervisorDebugStateForTest {
    if (this.context.extensionMode !== vscode.ExtensionMode.Test) {
      throw new Error('getRuntimeSupervisorStateForTest 仅在测试模式下可用。');
    }

    const registries: Partial<Record<RuntimeHostBackendKind, RuntimeSupervisorRegistryForTest>> = {};
    for (const backendKind of ['legacy-detached', 'systemd-user'] as const) {
      registries[backendKind] = this.collectRuntimeSupervisorRegistryForTest(backendKind);
    }

    return {
      pendingRuntimeSupervisorOperationCount: this.pendingRuntimeSupervisorOperations.size,
      bindings: Array.from(this.runtimeSessionBindings.values()).map((binding) => ({
        runtimeSessionId: binding.runtimeSessionId,
        runtimeStoragePath: binding.runtimeStoragePath,
        nodeId: binding.nodeId,
        kind: binding.kind
      })),
      registries
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

  public createNode(kind: CanvasNodeKind, options?: { agentProvider?: AgentProviderKind }): void {
    if (this.isInteractiveSurfaceReady()) {
      this.postMessage({
        type: 'host/requestCreateNode',
        payload: {
          kind,
          agentProvider: options?.agentProvider
        }
      });
      return;
    }

    this.applyCreateNode(kind, undefined, {
      agentProvider: options?.agentProvider
    });
  }

  public createNodeForTest(
    kind: CanvasNodeKind,
    preferredPosition?: CanvasNodePosition,
    options?: { agentProvider?: AgentProviderKind }
  ): void {
    if (this.context.extensionMode !== vscode.ExtensionMode.Test) {
      throw new Error('createNodeForTest 仅在测试模式下可用。');
    }

    this.applyCreateNode(kind, preferredPosition, {
      bypassTrust: true,
      agentProvider: options?.agentProvider
    });
  }

  public async startExecutionSessionForTest(params: StartExecutionSessionForTestParams): Promise<CanvasDebugSnapshot> {
    if (this.context.extensionMode !== vscode.ExtensionMode.Test) {
      throw new Error('startExecutionSessionForTest 仅在测试模式下可用。');
    }

    if (params.kind === 'agent') {
      await this.startAgentSession(
        params.nodeId,
        params.cols ?? DEFAULT_TERMINAL_COLS,
        params.rows ?? DEFAULT_TERMINAL_ROWS,
        params.provider,
        params.resumeRequested === true,
        {
          bypassTrust: true
        }
      );
    } else {
      await this.startTerminalSession(params.nodeId, params.cols ?? DEFAULT_TERMINAL_COLS, params.rows ?? DEFAULT_TERMINAL_ROWS, {
        bypassTrust: true
      });
    }

    return this.getDebugSnapshot();
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

  public async reloadPersistedStateForTest(): Promise<CanvasDebugSnapshot> {
    await this.waitForPendingWorkspaceStateUpdates();
    this.refreshStorageRecoverySelection();
    this.state = this.loadReconciledState();
    this.activeSurface = this.loadStoredSurface();
    this.applyWorkbenchContextKeys();
    this.recordDiagnosticEvent('state/reloaded', {
      activeSurface: this.activeSurface,
      nodeCount: this.state.nodes.length
    });
    this.notifySidebarStateChanged();

    if (this.activeSurface && this.isInteractiveSurface(this.activeSurface)) {
      this.postState('host/stateUpdated');
    }

    this.scheduleRestoreLiveRuntimeSessions();

    return this.getDebugSnapshot();
  }

  public async setPersistedStateForTest(rawState: unknown): Promise<CanvasDebugSnapshot> {
    if (this.context.extensionMode !== vscode.ExtensionMode.Test) {
      throw new Error('setPersistedStateForTest 仅在测试模式下可用。');
    }

    await this.queuePersistedCanvasSnapshotWrite({
      version: 1,
      state: rawState,
      activeSurface: this.activeSurface
    });
    this.state = this.loadReconciledState();
    this.recordDiagnosticEvent('state/seededForTest', {
      nodeCount: this.state.nodes.length
    });
    this.notifySidebarStateChanged();

    if (this.activeSurface && this.isInteractiveSurface(this.activeSurface)) {
      this.postState('host/stateUpdated');
    }

    this.scheduleRestoreLiveRuntimeSessions();

    return this.getDebugSnapshot();
  }

  public async simulateRuntimeReloadForTest(): Promise<CanvasDebugSnapshot> {
    const nextStartupConfiguration = this.readStartupConfiguration();
    await this.prepareForHostBoundary({
      preserveLiveRuntime: this.shouldPreserveLiveRuntimeAcrossHostBoundary(nextStartupConfiguration),
      allowRuntimeSupervisorRestart: false
    });

    this.applyStartupConfiguration(nextStartupConfiguration);
    this.refreshStorageRecoverySelection();
    this.state = this.loadReconciledState();
    this.activeSurface = this.loadStoredSurface();
    this.applyWorkbenchContextKeys();
    this.recordDiagnosticEvent('state/runtimeReloaded', {
      activeSurface: this.activeSurface,
      nodeCount: this.state.nodes.length
    });
    this.notifySidebarStateChanged();

    if (this.activeSurface && this.isInteractiveSurface(this.activeSurface)) {
      this.postState('host/stateUpdated');
    }

    this.scheduleRestoreLiveRuntimeSessions();

    return this.getDebugSnapshot();
  }

  public getAgentCliResolutionCacheKeyForTest(
    provider: AgentProviderKind,
    requestedCommand: string,
    workspaceCwd?: string
  ): string {
    if (this.context.extensionMode !== vscode.ExtensionMode.Test) {
      throw new Error('getAgentCliResolutionCacheKeyForTest 仅在测试模式下可用。');
    }

    return this.getAgentCliResolutionCacheKey(provider, requestedCommand, workspaceCwd);
  }

  public async flushPersistedCanvasStateForTest(): Promise<PersistedCanvasStateFlushResult> {
    if (this.context.extensionMode !== vscode.ExtensionMode.Test) {
      throw new Error('flushPersistedCanvasStateForTest 仅在测试模式下可用。');
    }

    await this.queuePersistedCanvasSnapshotWrite({
      version: 1,
      state: this.state,
      activeSurface: this.activeSurface
    });
    await this.waitForPendingWorkspaceStateUpdates();

    const snapshotPath = this.getPersistedCanvasSnapshotPath();
    const snapshot = this.loadPersistedCanvasSnapshot();
    return {
      snapshotPath,
      exists: fs.existsSync(snapshotPath),
      lastError: this.lastPersistedCanvasSnapshotError,
      writtenAt: snapshot?.writtenAt ?? this.lastPersistedCanvasSnapshotWrittenAt,
      snapshot: snapshot ? cloneJsonValue(snapshot) : undefined
    };
  }

  public async prepareForDeactivation(): Promise<void> {
    const nextStartupConfiguration = this.readStartupConfiguration();
    await this.prepareForHostBoundary({
      preserveLiveRuntime: this.shouldPreserveLiveRuntimeAcrossHostBoundary(nextStartupConfiguration),
      allowRuntimeSupervisorRestart: false
    });
  }

  private async prepareForHostBoundary(options: {
    preserveLiveRuntime: boolean;
    allowRuntimeSupervisorRestart: boolean;
    invalidatePendingExecutionOperations?: boolean;
  }): Promise<void> {
    if (options.invalidatePendingExecutionOperations) {
      this.invalidateAllExecutionSessionOperations();
    }

    await this.waitForPendingRuntimeSupervisorOperations();
    await this.flushAllExecutionSessionStatesForHostBoundary();
    await this.waitForPendingWorkspaceStateUpdates();

    const persistedRuntimeSessions = options.preserveLiveRuntime ? [] : this.collectPersistedLiveRuntimeSessions();

    for (const [nodeId, session] of Array.from(this.agentSessions.entries())) {
      if (session.owner === 'local') {
        this.disposeExecutionSession('agent', nodeId, {
          terminateProcess: true
        });
      }
    }
    for (const [nodeId, session] of Array.from(this.terminalSessions.entries())) {
      if (session.owner === 'local') {
        this.disposeExecutionSession('terminal', nodeId, {
          terminateProcess: true
        });
      }
    }
    this.agentSessions.clear();
    this.terminalSessions.clear();
    this.runtimeSessionBindings.clear();

    if (persistedRuntimeSessions.length > 0) {
      await this.deleteRuntimeSupervisorSessions(persistedRuntimeSessions, {
        allowRestart: options.allowRuntimeSupervisorRestart
      });
    }

    await this.waitForPendingRuntimeSupervisorOperations();
    this.disposeRuntimeSupervisorClients();
    await this.waitForPendingWorkspaceStateUpdates();
  }

  public async resetState(): Promise<void> {
    const previousNodeCount = this.state.nodes.length;
    await this.prepareForHostBoundary({
      preserveLiveRuntime: false,
      allowRuntimeSupervisorRestart: false,
      invalidatePendingExecutionOperations: true
    });
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
    this.state = this.loadReconciledState();
    this.persistState();
    if ((this.activeSurface ?? this.getConfiguredSurface()) !== 'editor') {
      this.recordDiagnosticEvent('surface/editorRestoreSkipped', {
        activeSurface: this.activeSurface,
        configuredSurface: this.getConfiguredSurface()
      });
      webviewPanel.dispose();
      return;
    }
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
    this.applyWorkbenchContextKeys();

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
        this.getEditorWebviewPanelOptions()
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
          if (this.activeSurface === 'editor') {
            this.activeSurface = undefined;
            this.applyWorkbenchContextKeys();
          }
          this.surfaceMode.editor = undefined;
          this.surfaceReady.editor = false;
          this.pendingVisibilityRestore.editor = false;
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
        if (!panel.visible) {
          this.pendingVisibilityRestore.editor = true;
        }
        this.maybePostVisibilityRestored('editor');
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
          if (this.activeSurface === 'panel') {
            this.activeSurface = undefined;
            this.applyWorkbenchContextKeys();
          }
          this.surfaceMode.panel = undefined;
          this.surfaceReady.panel = false;
          this.pendingVisibilityRestore.panel = false;
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
        if (!webviewView.visible) {
          this.pendingVisibilityRestore.panel = true;
        }
        this.maybePostVisibilityRestored('panel');
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

  private getWebviewOptions(): vscode.WebviewOptions {
    return {
      enableScripts: true,
      enableCommandUris: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'dist')]
    };
  }

  private getEditorWebviewPanelOptions(): vscode.WebviewOptions & vscode.WebviewPanelOptions {
    return {
      ...this.getWebviewOptions(),
      retainContextWhenHidden: true
    };
  }

  private getStoredValue<T>(key: string): T | undefined {
    return this.context.workspaceState.get<T>(key);
  }

  private refreshStorageRecoverySelection(): void {
    this.storageRecoverySelection = selectPreferredExtensionStorageRecoverySource(this.rawExtensionStoragePath, {
      pathExists: (candidatePath) => fs.existsSync(candidatePath)
    });
    this.recordStorageRecoverySelection(this.storageRecoverySelection);
    this.initializeRecoveredStorageState(this.storageRecoverySelection);
  }

  private recordStorageRecoverySelection(selection: ExtensionStorageRecoverySourceSelection): void {
    this.recordDiagnosticEvent('storage/slotSelected', {
      currentPath: selection.currentPath,
      writePath: selection.writePath,
      sourcePath: selection.sourcePath,
      recoveryReason: selection.recoveryReason,
      selectionBasis: selection.selectionBasis,
      migrationRequired: selection.migrationRequired,
      currentSlotName: selection.currentCandidate.slotName,
      sourceSlotName: selection.sourceCandidate.slotName,
      sourceStateHash: selection.sourceCandidate.snapshot.stateHash,
      sourceWrittenAt: selection.sourceCandidate.snapshot.writtenAt,
      sourceStateUpdatedAt: selection.sourceCandidate.snapshot.stateUpdatedAt,
      sourceTimestamp: selection.sourceCandidate.snapshot.effectiveTimestamp,
      currentStateHash: selection.currentCandidate.snapshot.stateHash,
      currentWrittenAt: selection.currentCandidate.snapshot.writtenAt,
      currentStateUpdatedAt: selection.currentCandidate.snapshot.stateUpdatedAt,
      currentTimestamp: selection.currentCandidate.snapshot.effectiveTimestamp
    });
  }

  private initializeRecoveredStorageState(selection: ExtensionStorageRecoverySourceSelection): void {
    if (!selection.migrationRequired) {
      return;
    }

    try {
      const migratedPaths = this.migrateRecoverableStateToCurrentSlot(selection.sourcePath, selection.writePath);
      this.recordDiagnosticEvent('storage/stateMigratedToCurrentSlot', {
        sourcePath: selection.sourcePath,
        targetPath: selection.writePath,
        copiedPaths: migratedPaths,
        sourceStateHash: selection.sourceCandidate.snapshot.stateHash,
        sourceTimestamp: selection.sourceCandidate.snapshot.effectiveTimestamp
      });
    } catch (error) {
      this.recordDiagnosticEvent('storage/stateMigrationFailed', {
        sourcePath: selection.sourcePath,
        targetPath: selection.writePath,
        sourceStateHash: selection.sourceCandidate.snapshot.stateHash,
        message: formatUnknownError(error)
      });
    }
  }

  private migrateRecoverableStateToCurrentSlot(sourcePath: string, targetPath: string): string[] {
    if (path.normalize(sourcePath) === path.normalize(targetPath)) {
      return [];
    }

    fs.mkdirSync(targetPath, {
      recursive: true
    });

    const copiedPaths: string[] = [];
    for (const relativePath of CanvasPanelManager.RECOVERABLE_STORAGE_RELATIVE_PATHS) {
      const sourceCandidatePath = path.join(sourcePath, relativePath);
      if (!fs.existsSync(sourceCandidatePath)) {
        continue;
      }

      const targetCandidatePath = path.join(targetPath, relativePath);
      fs.rmSync(targetCandidatePath, {
        recursive: true,
        force: true
      });
      fs.mkdirSync(path.dirname(targetCandidatePath), {
        recursive: true
      });
      const sourceStats = fs.statSync(sourceCandidatePath);
      if (sourceStats.isDirectory()) {
        fs.cpSync(sourceCandidatePath, targetCandidatePath, {
          recursive: true
        });
      } else {
        fs.copyFileSync(sourceCandidatePath, targetCandidatePath);
      }
      copiedPaths.push(relativePath);
    }

    return copiedPaths;
  }

  private getExtensionStoragePath(): string {
    return this.rawExtensionStoragePath;
  }

  private resolveRuntimeStoragePath(runtimeStoragePath: string | undefined): string {
    return normalizeRuntimeStoragePath(runtimeStoragePath) ?? this.getExtensionStoragePath();
  }

  private getRuntimeStoragePathFromBackend(backend: RuntimeHostBackend): string {
    return this.resolveRuntimeStoragePath(path.dirname(backend.paths.storageDir));
  }

  private buildRuntimeSupervisorClientKey(backend: RuntimeHostBackend): string {
    return `${backend.kind}:${backend.paths.storageDir}`;
  }

  private getPersistedRuntimeStoragePath(metadata: { runtimeStoragePath?: string }): string | undefined {
    return normalizeRuntimeStoragePath(metadata.runtimeStoragePath);
  }

  private getPersistedCanvasSnapshotPath(): string {
    return path.join(this.getExtensionStoragePath(), 'canvas-state.json');
  }

  private loadPersistedCanvasSnapshot(): PersistedCanvasSnapshot | undefined {
    return this.loadPersistedCanvasSnapshotFromPath(this.getPersistedCanvasSnapshotPath());
  }

  private queuePersistedCanvasSnapshotWrite(snapshot: PersistedCanvasSnapshot): Promise<void> {
    const snapshotPath = this.getPersistedCanvasSnapshotPath();
    const snapshotWithMetadata = this.buildPersistedCanvasSnapshot(snapshot);
    const snapshotSummary = summarizeCanvasStateForDiagnostics(snapshotWithMetadata.state);
    this.recordDiagnosticEvent('state/persistQueued', {
      snapshotPath,
      activeSurface: snapshotWithMetadata.activeSurface,
      writePath: this.getExtensionStoragePath(),
      snapshotWrittenAt: snapshotWithMetadata.writtenAt,
      ...snapshotSummary
    });

    try {
      this.writePersistedCanvasSnapshotToDisk(snapshotPath, snapshotWithMetadata);
      this.lastPersistedCanvasSnapshotError = undefined;
      this.lastPersistedCanvasSnapshotWrittenAt = snapshotWithMetadata.writtenAt;
      this.recordDiagnosticEvent('state/persistWritten', {
        snapshotPath,
        activeSurface: snapshotWithMetadata.activeSurface,
        writePath: this.getExtensionStoragePath(),
        writtenAt: snapshotWithMetadata.writtenAt,
        ...snapshotSummary
      });
    } catch (error) {
      const message = formatUnknownError(error);
      this.lastPersistedCanvasSnapshotError = message;
      this.recordDiagnosticEvent('state/persistFailed', {
        message,
        snapshotPath,
        activeSurface: snapshotWithMetadata.activeSurface,
        writePath: this.getExtensionStoragePath(),
        ...snapshotSummary
      });
      return Promise.reject(error);
    }

    const operation = this.pendingWorkspaceStateUpdate.then(async () => {
      const normalizedWorkspaceState = normalizeState(
        snapshotWithMetadata.state,
        this.getAgentCliConfig().defaultProvider
      );
      await this.context.workspaceState.update(
        STORAGE_KEYS.canvasState,
        stripSerializedTerminalStateFromCanvasState(normalizedWorkspaceState)
      );
      await this.context.workspaceState.update(STORAGE_KEYS.canvasLastSurface, snapshotWithMetadata.activeSurface);
      await this.context.workspaceState.update(STORAGE_KEYS.canvasDefaultSurface, snapshotWithMetadata.defaultSurface);
      await this.context.workspaceState.update(
        STORAGE_KEYS.canvasRuntimePersistenceEnabled,
        snapshotWithMetadata.runtimePersistenceEnabled
      );
      this.lastPersistedCanvasSnapshotError = undefined;
    }).catch((error) => {
      const message = formatUnknownError(error);
      this.lastPersistedCanvasSnapshotError = message;
      this.recordDiagnosticEvent('state/persistFailed', {
        message,
        snapshotPath,
        activeSurface: snapshotWithMetadata.activeSurface,
        writePath: this.getExtensionStoragePath(),
        ...snapshotSummary
      });
      throw error;
    });
    this.pendingWorkspaceStateUpdate = operation.then(
      () => undefined,
      () => undefined
    );
    return operation;
  }

  private loadPersistedCanvasSnapshotFromPath(snapshotPath: string): PersistedCanvasSnapshot | undefined {
    try {
      if (!fs.existsSync(snapshotPath)) {
        return undefined;
      }

      const rawSnapshot = fs.readFileSync(snapshotPath, 'utf8');
      const parsedSnapshot = JSON.parse(rawSnapshot) as PersistedCanvasSnapshot;
      if (!parsedSnapshot || typeof parsedSnapshot !== 'object') {
        return undefined;
      }

      return parsedSnapshot;
    } catch {
      return undefined;
    }
  }

  private buildPersistedCanvasSnapshot(snapshot: PersistedCanvasSnapshot): PersistedCanvasSnapshot {
    return {
      ...snapshot,
      defaultSurface: this.appliedStartupConfiguration.defaultSurface,
      runtimePersistenceEnabled: this.appliedStartupConfiguration.runtimePersistenceEnabled,
      writtenAt: new Date().toISOString(),
      stateHash: buildDiagnosticStateHash(snapshot.state)
    };
  }

  private writePersistedCanvasSnapshotToDisk(snapshotPath: string, snapshot: PersistedCanvasSnapshot): void {
    fs.mkdirSync(path.dirname(snapshotPath), {
      recursive: true
    });
    const tempSnapshotPath = `${snapshotPath}.tmp`;
    const serializedSnapshot = `${JSON.stringify(snapshot, null, 2)}\n`;
    fs.writeFileSync(tempSnapshotPath, serializedSnapshot, 'utf8');
    fs.renameSync(tempSnapshotPath, snapshotPath);
  }

  private loadState(): CanvasPrototypeState {
    const snapshot = this.loadPersistedCanvasSnapshot();
    const workspaceState = this.getStoredValue<unknown>(STORAGE_KEYS.canvasState);
    const storedRuntimePersistenceEnabled =
      typeof snapshot?.runtimePersistenceEnabled === 'boolean'
        ? snapshot.runtimePersistenceEnabled
        : this.getStoredValue<boolean | undefined>(STORAGE_KEYS.canvasRuntimePersistenceEnabled);
    const resetDueToRuntimePersistenceModeChange =
      typeof storedRuntimePersistenceEnabled === 'boolean' &&
      storedRuntimePersistenceEnabled !== this.appliedStartupConfiguration.runtimePersistenceEnabled;
    const rawState = resetDueToRuntimePersistenceModeChange ? undefined : snapshot?.state ?? workspaceState;
    const source = resetDueToRuntimePersistenceModeChange
      ? 'runtimePersistenceReset'
      : snapshot?.state !== undefined
        ? 'snapshot'
        : workspaceState !== undefined
          ? 'workspaceState'
          : 'default';
    this.recordDiagnosticEvent('state/loadSelected', {
      source,
      snapshotPath: this.getPersistedCanvasSnapshotPath(),
      storagePath: this.getExtensionStoragePath(),
      writePath: this.storageRecoverySelection.writePath,
      recoverySourcePath:
        this.storageRecoverySelection.sourcePath === this.storageRecoverySelection.writePath
          ? undefined
          : this.storageRecoverySelection.sourcePath,
      snapshotAvailable: snapshot !== undefined,
      workspaceStateAvailable: workspaceState !== undefined,
      activeSurface: snapshot?.activeSurface,
      storedRuntimePersistenceEnabled,
      appliedRuntimePersistenceEnabled: this.appliedStartupConfiguration.runtimePersistenceEnabled,
      resetDueToRuntimePersistenceModeChange,
      snapshotWrittenAt: snapshot?.writtenAt,
      snapshotStateHash: snapshot?.stateHash,
      ...summarizeCanvasStateForDiagnostics(rawState)
    });
    if (resetDueToRuntimePersistenceModeChange) {
      this.recordDiagnosticEvent('state/runtimePersistenceReset', {
        storedRuntimePersistenceEnabled,
        appliedRuntimePersistenceEnabled: this.appliedStartupConfiguration.runtimePersistenceEnabled
      });
    }
    return hydrateRuntimeStoragePaths(
      normalizeState(rawState, this.getAgentCliConfig().defaultProvider),
      this.storageRecoverySelection.sourcePath
    );
  }

  private loadReconciledState(): CanvasPrototypeState {
    const liveRuntimeReconnectBlockReason = this.getLiveRuntimeReconnectBlockReason();
    return reconcileRuntimeNodes(this.loadState(), this.agentSessions, this.terminalSessions, {
      allowLiveRuntimeReconnect: liveRuntimeReconnectBlockReason === undefined,
      liveRuntimeReconnectBlockReason
    });
  }

  private persistState(): void {
    void this.queuePersistedCanvasSnapshotWrite({
      version: 1,
      state: this.state,
      activeSurface: this.activeSurface
    }).catch(() => undefined);
  }

  private postState(type: 'host/bootstrap' | 'host/stateUpdated'): void {
    this.postMessage({
      type,
      payload: {
        state: stripSerializedTerminalStateFromCanvasState(this.state),
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
      workspaceTrusted: vscode.workspace.isTrusted,
      surfaceLocation: this.activeSurface ?? this.getConfiguredSurface(),
      defaultAgentProvider: this.getAgentCliConfig().defaultProvider,
      terminalScrollback: this.getTerminalScrollback(),
      editorMultiCursorModifier: normalizeEditorMultiCursorModifier(
        vscode.workspace
          .getConfiguration('editor')
          .get<'ctrlCmd' | 'alt'>('multiCursorModifier')
      ),
      terminalWordSeparators: normalizeExecutionTerminalWordSeparators(
        vscode.workspace.getConfiguration('terminal.integrated').get<string>('wordSeparators')
      )
    };
  }

  private getTerminalScrollback(): number {
    return normalizeTerminalScrollback(
      vscode.workspace.getConfiguration('terminal.integrated').get<number>('scrollback'),
      DEFAULT_TERMINAL_SCROLLBACK
    );
  }

  private readStartupConfiguration(): CanvasStartupConfiguration {
    return {
      defaultSurface:
        getConfigurationValue<'editor' | 'panel'>('canvasDefaultSurface', 'panel') === 'panel' ? 'panel' : 'editor',
      runtimePersistenceEnabled: getConfigurationValue<boolean>('runtimePersistenceEnabled', false)
    };
  }

  private applyStartupConfiguration(configuration: CanvasStartupConfiguration): void {
    this.appliedStartupConfiguration = configuration;
    this.applyWorkbenchContextKeys();
  }

  private applyWorkbenchContextKeys(): void {
    void vscode.commands.executeCommand(
      'setContext',
      CONTEXT_KEYS.panelViewVisible,
      this.shouldShowPanelView()
    );
  }

  private shouldShowPanelView(): boolean {
    return this.appliedStartupConfiguration.defaultSurface === 'panel' || this.activeSurface === 'panel';
  }

  private async notifyReloadRequiredConfigurationChanged(options: {
    defaultSurfaceChanged: boolean;
    runtimePersistenceChanged: boolean;
  }): Promise<void> {
    if (this.context.extensionMode === vscode.ExtensionMode.Test) {
      return;
    }

    if (options.runtimePersistenceChanged) {
      const message = options.defaultSurfaceChanged
        ? 'Default Surface 和 Runtime Persistence 的更改会在重新加载窗口后生效；其中切换 Runtime Persistence 会在下次加载时清空当前 workspace 的画布宿主状态。'
        : 'Runtime Persistence 的更改会在重新加载窗口后生效；切换此设置会在下次加载时清空当前 workspace 的画布宿主状态。';
      const selection = await vscode.window.showWarningMessage(message, RELOAD_WINDOW_ACTION_LABEL);
      if (selection === RELOAD_WINDOW_ACTION_LABEL) {
        await vscode.commands.executeCommand('workbench.action.reloadWindow');
      }
      return;
    }

    if (!options.defaultSurfaceChanged) {
      return;
    }

    const selection = await vscode.window.showInformationMessage(
      'Default Surface 的更改会在重新加载窗口后生效。',
      RELOAD_WINDOW_ACTION_LABEL
    );
    if (selection === RELOAD_WINDOW_ACTION_LABEL) {
      await vscode.commands.executeCommand('workbench.action.reloadWindow');
    }
  }

  private async handleRuntimeConfigurationChanged(options: {
    defaultAgentProviderChanged: boolean;
    terminalScrollbackChanged: boolean;
    multiCursorModifierChanged: boolean;
    terminalWordSeparatorsChanged: boolean;
  }): Promise<void> {
    if (options.terminalScrollbackChanged) {
      try {
        await this.refreshLiveExecutionSessionScrollback(this.getTerminalScrollback());
      } catch (error) {
        this.postMessage({
          type: 'host/error',
          payload: {
            message: error instanceof Error ? error.message : '同步运行中终端 scrollback 配置失败。'
          }
        });
        return;
      }
    }

    if (
      options.defaultAgentProviderChanged ||
      options.terminalScrollbackChanged ||
      options.multiCursorModifierChanged ||
      options.terminalWordSeparatorsChanged
    ) {
      this.postState('host/stateUpdated');
    }
  }

  private async handleDroppedExecutionResource(
    kind: ExecutionNodeKind,
    nodeId: string,
    resource: ExecutionTerminalDroppedResource
  ): Promise<void> {
    const session = this.getExecutionSessions(kind).get(nodeId);
    if (!session) {
      this.recordDiagnosticEvent('execution/dropResourceRejected', {
        kind,
        nodeId,
        reason: 'missing-session',
        source: resource.source
      });
      return;
    }

    const preparedPath = prepareExecutionTerminalDroppedPath(resource, {
      shellPath: session.shellPath,
      cwd: session.cwd,
      pathStyle: inferExecutionTerminalPathStyle(session.shellPath, session.cwd),
      userHome: process.env.HOME ?? process.env.USERPROFILE
    });
    this.recordDiagnosticEvent('execution/dropResourcePrepared', {
      kind,
      nodeId,
      source: resource.source,
      valueKind: resource.valueKind
    });
    this.writeExecutionInput(kind, nodeId, preparedPath);
  }

  private async handleResolveExecutionFileLinks(
    surface: CanvasSurfaceLocation,
    kind: ExecutionNodeKind,
    nodeId: string,
    requestId: string,
    candidates: ExecutionTerminalFileLinkCandidate[]
  ): Promise<void> {
    const context = this.getExecutionTerminalPathContext(kind, nodeId);
    const resolvedCandidates = await resolveExecutionTerminalFileLinkCandidates(
      candidates,
      context,
      () => randomUUID()
    ).catch(() => []);

    for (const resolvedCandidate of resolvedCandidates) {
      this.resolvedExecutionFileLinks.set(resolvedCandidate.openLink.resolvedId, {
        nodeId,
        kind,
        resolved: resolvedCandidate.resolved
      });
    }

    this.postMessageToSurface(surface, {
      type: 'host/executionFileLinksResolved',
      payload: {
        requestId,
        nodeId,
        kind,
        resolvedLinks: resolvedCandidates.map((resolvedCandidate) => ({
          candidateId: resolvedCandidate.candidateId,
          link: resolvedCandidate.openLink
        }))
      }
    });
  }

  private async handleOpenExecutionLink(
    kind: ExecutionNodeKind,
    nodeId: string,
    link: ExecutionTerminalOpenLink
  ): Promise<void> {
    const context = this.getExecutionTerminalPathContext(kind, nodeId);
    const openResult = await openExecutionTerminalLink(
      link,
      context,
      (resolvedId) => {
        const cached = this.resolvedExecutionFileLinks.get(resolvedId);
        if (!cached || cached.nodeId !== nodeId || cached.kind !== kind) {
          return undefined;
        }

        return cached.resolved;
      }
    ).catch((): OpenExecutionTerminalLinkResult => ({ opened: false }));

    this.recordDiagnosticEvent(openResult.opened ? 'execution/linkOpened' : 'execution/linkOpenRejected', {
      kind,
      nodeId,
      linkKind: link.linkKind,
      text: link.text,
      openerKind: openResult.openerKind ?? null,
      targetUri: openResult.targetUri ?? null,
      shellPath: context.shellPath ?? null,
      cwd: context.cwd
    });
  }

  private getExecutionTerminalPathContext(kind: ExecutionNodeKind, nodeId: string): {
    shellPath?: string;
    cwd: string;
    pathStyle: 'windows' | 'posix';
    userHome?: string;
    resolveCwdForBufferLine?: (bufferStartLine: number) => Promise<string | undefined>;
  } {
    const session = this.getExecutionSessions(kind).get(nodeId);
    const node = this.state.nodes.find((currentNode) => currentNode.id === nodeId && currentNode.kind === kind);
    const metadata =
      kind === 'agent'
        ? (node ? ensureAgentMetadata(node) : undefined)
        : node
          ? ensureTerminalMetadata(node)
          : undefined;
    const shellPath = session?.shellPath ?? metadata?.shellPath;
    const cwd = session?.cwd ?? metadata?.cwd ?? this.getTerminalWorkingDirectory();

    return {
      shellPath,
      cwd,
      pathStyle: inferExecutionTerminalPathStyle(shellPath, cwd),
      userHome: process.env.HOME ?? process.env.USERPROFILE,
      resolveCwdForBufferLine:
        session ? (bufferStartLine) => session.lineContextTracker.getCwdForBufferLine(bufferStartLine) : undefined
    };
  }

  private async refreshLiveExecutionSessionScrollback(scrollback: number): Promise<void> {
    const operations: Array<Promise<void>> = [];
    for (const [nodeId, session] of this.agentSessions.entries()) {
      operations.push(this.refreshManagedExecutionSessionScrollback('agent', nodeId, session, scrollback));
    }
    for (const [nodeId, session] of this.terminalSessions.entries()) {
      operations.push(this.refreshManagedExecutionSessionScrollback('terminal', nodeId, session, scrollback));
    }

    const results = await Promise.allSettled(operations);
    const rejected = results.find((result) => result.status === 'rejected');
    if (rejected?.status === 'rejected') {
      throw rejected.reason;
    }
  }

  private async refreshManagedExecutionSessionScrollback(
    kind: ExecutionNodeKind,
    nodeId: string,
    session: ManagedExecutionSession,
    scrollback: number
  ): Promise<void> {
    if (session.terminalStateTracker.getScrollback() === scrollback) {
      return;
    }

    if (session.owner === 'supervisor') {
      const backendKind = normalizeRuntimeHostBackendKind(session.runtimeBackend) ?? 'legacy-detached';
      const operation = this.getRuntimeSupervisorClientForKind(
        backendKind,
        {},
        session.runtimeStoragePath
      ).then((client) =>
        client.updateSessionScrollback({
          sessionId: session.runtimeSessionId,
          scrollback
        })
      );
      this.trackRuntimeSupervisorOperation(operation);
      await operation;

      const refreshedSession = this.getExecutionSessions(kind).get(nodeId);
      if (
        refreshedSession?.owner === 'supervisor' &&
        refreshedSession.terminalStateTracker.getScrollback() !== scrollback
      ) {
        await refreshedSession.terminalStateTracker.setScrollback(scrollback);
        await refreshedSession.lineContextTracker.setScrollback(scrollback);
        this.flushLiveExecutionState(kind, nodeId, {
          postState: false
        });
      }
      return;
    }

    await session.terminalStateTracker.setScrollback(scrollback);
    await session.lineContextTracker.setScrollback(scrollback);
    this.flushLiveExecutionState(kind, nodeId, {
      postState: false
    });
  }

  private isRuntimePersistenceEnabled(): boolean {
    return this.appliedStartupConfiguration.runtimePersistenceEnabled;
  }

  private getLiveRuntimeReconnectBlockReason(): LiveRuntimeReconnectBlockReason | undefined {
    if (!this.isRuntimePersistenceEnabled()) {
      return 'runtime-persistence-disabled';
    }

    if (!vscode.workspace.isTrusted) {
      return 'workspace-untrusted';
    }

    return undefined;
  }

  private shouldPreserveLiveRuntimeAcrossHostBoundary(nextStartupConfiguration = this.appliedStartupConfiguration): boolean {
    return this.isRuntimePersistenceEnabled() && nextStartupConfiguration.runtimePersistenceEnabled;
  }

  private getRuntimeHostBaseStoragePath(runtimeStoragePath?: string): string {
    return this.resolveRuntimeStoragePath(runtimeStoragePath);
  }

  private getRuntimeSupervisorScriptPath(): string {
    return path.join(this.context.extensionUri.fsPath, 'dist', 'runtime-supervisor.js');
  }

  private getRuntimeSupervisorLauncherScriptPath(): string {
    return path.join(this.context.extensionUri.fsPath, 'dist', 'runtime-supervisor-launcher.js');
  }

  private getRuntimeHostBackend(
    kind: RuntimeHostBackendKind,
    runtimeStoragePath?: string
  ): RuntimeHostBackend {
    return createRuntimeHostBackend(kind, {
      baseStoragePath: this.getRuntimeHostBaseStoragePath(runtimeStoragePath),
      extensionMode: this.context.extensionMode
    });
  }

  private scheduleRestoreLiveRuntimeSessions(): void {
    const operation = this.restoreLiveRuntimeSessions().catch((error) => {
      this.recordDiagnosticEvent('runtime/restoreFailed', {
        message: formatUnknownError(error)
      });
    });
    this.trackRuntimeSupervisorOperation(operation);
  }

  private readRuntimeSupervisorRegistryForTest(
    backendKind: RuntimeHostBackendKind,
    runtimeStoragePath: string
  ): RuntimeSupervisorRegistryEntryForTest {
    const normalizedRuntimeStoragePath = this.resolveRuntimeStoragePath(runtimeStoragePath);
    try {
      const registryPath = this.getRuntimeHostBackend(
        backendKind,
        normalizedRuntimeStoragePath
      ).paths.registryPath;
      if (!fs.existsSync(registryPath)) {
        return {
          runtimeStoragePath: normalizedRuntimeStoragePath,
          registryPath,
          exists: false
        };
      }

      return {
        runtimeStoragePath: normalizedRuntimeStoragePath,
        registryPath,
        exists: true,
        registry: JSON.parse(fs.readFileSync(registryPath, 'utf8')) as unknown
      };
    } catch (error) {
      return {
        runtimeStoragePath: normalizedRuntimeStoragePath,
        exists: false,
        error: formatUnknownError(error)
      };
    }
  }

  private collectRuntimeSupervisorRegistryForTest(
    backendKind: RuntimeHostBackendKind
  ): RuntimeSupervisorRegistryForTest {
    const entries = this.collectRuntimeSupervisorStoragePathsForTest(backendKind).map((runtimeStoragePath) =>
      this.readRuntimeSupervisorRegistryForTest(backendKind, runtimeStoragePath)
    );
    const sessionsById = new Map<string, unknown>();
    for (const entry of entries) {
      const sessions = readRuntimeSupervisorRegistrySessionsForTest(entry.registry);
      for (const session of sessions) {
        if (isRecord(session) && typeof session.sessionId === 'string') {
          sessionsById.set(session.sessionId, session);
        }
      }
    }

    const successfulEntries = entries.filter((entry) => entry.exists);
    const failedEntries = entries.filter((entry) => entry.error);
    const singleEntry = entries.length === 1 ? entries[0] : undefined;

    return {
      runtimeStoragePath: singleEntry?.runtimeStoragePath,
      registryPath: singleEntry?.registryPath,
      exists: successfulEntries.length > 0,
      registry: {
        version: 1,
        sessions: Array.from(sessionsById.values())
      },
      error:
        successfulEntries.length === 0 && failedEntries.length > 0
          ? failedEntries
              .map((entry) => `[${entry.runtimeStoragePath}] ${entry.error}`)
              .join('\n')
          : undefined,
      entries
    };
  }

  private collectRuntimeSupervisorStoragePathsForTest(
    backendKind: RuntimeHostBackendKind
  ): string[] {
    const storagePaths = new Set<string>([this.getExtensionStoragePath()]);
    for (const node of this.state.nodes) {
      if (node.kind === 'agent') {
        const metadata = ensureAgentMetadata(node);
        if (
          metadata.persistenceMode === 'live-runtime' &&
          normalizeRuntimeHostBackendKind(metadata.runtimeBackend) === backendKind
        ) {
          storagePaths.add(
            this.resolveRuntimeStoragePath(this.getPersistedRuntimeStoragePath(metadata))
          );
        }
        continue;
      }

      if (node.kind === 'terminal') {
        const metadata = ensureTerminalMetadata(node);
        if (
          metadata.persistenceMode === 'live-runtime' &&
          normalizeRuntimeHostBackendKind(metadata.runtimeBackend) === backendKind
        ) {
          storagePaths.add(
            this.resolveRuntimeStoragePath(this.getPersistedRuntimeStoragePath(metadata))
          );
        }
      }
    }

    for (const session of this.agentSessions.values()) {
      if (session.owner === 'supervisor' && session.runtimeBackend === backendKind) {
        storagePaths.add(this.resolveRuntimeStoragePath(session.runtimeStoragePath));
      }
    }

    for (const session of this.terminalSessions.values()) {
      if (session.owner === 'supervisor' && session.runtimeBackend === backendKind) {
        storagePaths.add(this.resolveRuntimeStoragePath(session.runtimeStoragePath));
      }
    }

    return Array.from(storagePaths);
  }

  private disposeRuntimeSupervisorClients(): void {
    for (const client of this.runtimeSupervisorClients.values()) {
      client.dispose();
    }
    this.runtimeSupervisorClients.clear();
  }

  private async getRuntimeSupervisorClientForBackend(
    backend: RuntimeHostBackend,
    options: { allowRestart?: boolean } = {}
  ): Promise<RuntimeSupervisorClient> {
    const runtimeStoragePath = this.getRuntimeStoragePathFromBackend(backend);
    const clientKey = this.buildRuntimeSupervisorClientKey(backend);
    let client = this.runtimeSupervisorClients.get(clientKey);
    if (!client) {
      client = new RuntimeSupervisorClient({
        backend,
        supervisorScriptPath: this.getRuntimeSupervisorScriptPath(),
        supervisorLauncherScriptPath: this.getRuntimeSupervisorLauncherScriptPath(),
        onSessionOutput: (event) =>
          this.handleRuntimeSupervisorOutput(runtimeStoragePath, event.sessionId, event.chunk),
        onSessionState: (snapshot) => this.handleRuntimeSupervisorState(runtimeStoragePath, snapshot),
        onDisconnected: (error) =>
          this.handleRuntimeSupervisorDisconnected(backend.kind, runtimeStoragePath, error)
      });
      this.runtimeSupervisorClients.set(clientKey, client);
    }

    await client.ensureConnected(options);
    return client;
  }

  private async getRuntimeSupervisorClientForKind(
    kind: RuntimeHostBackendKind,
    options: { allowRestart?: boolean } = {},
    runtimeStoragePath?: string
  ): Promise<RuntimeSupervisorClient> {
    return this.getRuntimeSupervisorClientForBackend(
      this.getRuntimeHostBackend(kind, runtimeStoragePath),
      options
    );
  }

  private async getPreferredRuntimeSupervisorClient(
    options: { allowRestart?: boolean } = {}
  ): Promise<ConnectedRuntimeSupervisorClient> {
    if (this.preferredRuntimeHostBackendKind) {
      try {
        const backend = this.getRuntimeHostBackend(this.preferredRuntimeHostBackendKind);
        return {
          client: await this.getRuntimeSupervisorClientForBackend(backend, options),
          backend,
          runtimeStoragePath: this.getRuntimeStoragePathFromBackend(backend),
          fallbackReason: this.preferredRuntimeHostBackendFallbackReason
        };
      } catch {
        this.preferredRuntimeHostBackendKind = undefined;
        this.preferredRuntimeHostBackendFallbackReason = undefined;
      }
    }

    const preferredKinds = listPreferredRuntimeHostBackendKinds({
      baseStoragePath: this.getRuntimeHostBaseStoragePath(),
      extensionMode: this.context.extensionMode
    });
    let lastError: Error | undefined;
    let fallbackReason: string | undefined;

    for (const kind of preferredKinds) {
      try {
        const backend = this.getRuntimeHostBackend(kind);
        const client = await this.getRuntimeSupervisorClientForBackend(backend, options);
        this.preferredRuntimeHostBackendKind = kind;
        this.preferredRuntimeHostBackendFallbackReason = fallbackReason;
        return {
          client,
          backend,
          runtimeStoragePath: this.getRuntimeStoragePathFromBackend(backend),
          fallbackReason
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (kind === 'systemd-user') {
          fallbackReason = lastError.message;
          continue;
        }
      }
    }

    throw lastError ?? new Error('无法连接 runtime supervisor。');
  }

  private getExecutionSessionOperationKey(kind: ExecutionNodeKind, nodeId: string): string {
    return `${kind}:${nodeId}`;
  }

  private buildRuntimeSessionBindingKey(runtimeSessionId: string, runtimeStoragePath: string | undefined): string {
    return `${this.resolveRuntimeStoragePath(runtimeStoragePath)}::${runtimeSessionId}`;
  }

  private beginExecutionSessionOperation(kind: ExecutionNodeKind, nodeId: string): number {
    const key = this.getExecutionSessionOperationKey(kind, nodeId);
    const nextToken = (this.executionSessionOperationTokens.get(key) ?? 0) + 1;
    this.executionSessionOperationTokens.set(key, nextToken);
    return nextToken;
  }

  private invalidateExecutionSessionOperation(kind: ExecutionNodeKind, nodeId: string): void {
    this.beginExecutionSessionOperation(kind, nodeId);
  }

  private invalidateAllExecutionSessionOperations(): void {
    const executionNodeKeys = new Set<string>();
    for (const node of this.state.nodes) {
      if (!isExecutionNodeKind(node.kind)) {
        continue;
      }
      executionNodeKeys.add(this.getExecutionSessionOperationKey(node.kind, node.id));
    }
    for (const nodeId of this.agentSessions.keys()) {
      executionNodeKeys.add(this.getExecutionSessionOperationKey('agent', nodeId));
    }
    for (const nodeId of this.terminalSessions.keys()) {
      executionNodeKeys.add(this.getExecutionSessionOperationKey('terminal', nodeId));
    }
    for (const binding of this.runtimeSessionBindings.values()) {
      executionNodeKeys.add(this.getExecutionSessionOperationKey(binding.kind, binding.nodeId));
    }

    for (const key of executionNodeKeys) {
      const nextToken = (this.executionSessionOperationTokens.get(key) ?? 0) + 1;
      this.executionSessionOperationTokens.set(key, nextToken);
    }
  }

  private isExecutionSessionOperationCurrent(
    kind: ExecutionNodeKind,
    nodeId: string,
    token: number
  ): boolean {
    return this.executionSessionOperationTokens.get(this.getExecutionSessionOperationKey(kind, nodeId)) === token;
  }

  private shouldApplyRuntimeAttachResult(
    kind: ExecutionNodeKind,
    nodeId: string,
    token: number,
    expectedRuntimeSessionId: string
  ): boolean {
    if (!this.isExecutionSessionOperationCurrent(kind, nodeId, token)) {
      return false;
    }

    const node = this.state.nodes.find((currentNode) => currentNode.id === nodeId && currentNode.kind === kind);
    if (!node) {
      return false;
    }

    const metadata = kind === 'agent' ? ensureAgentMetadata(node) : ensureTerminalMetadata(node);
    return (
      metadata.persistenceMode === 'live-runtime' &&
      metadata.runtimeSessionId === expectedRuntimeSessionId &&
      metadata.attachmentState === 'reattaching'
    );
  }

  private shouldApplyRuntimeCreateResult(
    kind: ExecutionNodeKind,
    nodeId: string,
    token: number,
    expectedBackendKind: RuntimeHostBackendKind
  ): boolean {
    if (!this.isExecutionSessionOperationCurrent(kind, nodeId, token)) {
      return false;
    }

    const node = this.state.nodes.find((currentNode) => currentNode.id === nodeId && currentNode.kind === kind);
    if (!node) {
      return false;
    }

    const metadata = kind === 'agent' ? ensureAgentMetadata(node) : ensureTerminalMetadata(node);
    return metadata.persistenceMode === 'live-runtime' && metadata.runtimeBackend === expectedBackendKind;
  }

  private recordIgnoredExecutionSessionOperation(
    kind: ExecutionNodeKind,
    nodeId: string,
    stage: 'attach' | 'create',
    runtimeSessionId?: string
  ): void {
    this.recordDiagnosticEvent('execution/operationIgnored', {
      kind,
      nodeId,
      stage,
      runtimeSessionId: runtimeSessionId ?? null
    });
  }

  private async deleteRuntimeSupervisorSessionBestEffort(
    client: RuntimeSupervisorClient,
    sessionId: string
  ): Promise<void> {
    try {
      await client.deleteSession({
        sessionId
      });
    } catch {
      // Best effort only for stale-session cleanup.
    }
  }

  private async attachPersistedRuntimeSession(
    kind: ExecutionNodeKind,
    nodeId: string,
    runtimeSessionId: string,
    attachSession: () => Promise<RuntimeSupervisorSessionSnapshot>
  ): Promise<void> {
    const operationToken = this.beginExecutionSessionOperation(kind, nodeId);

    try {
      const snapshot = await attachSession();
      if (!this.shouldApplyRuntimeAttachResult(kind, nodeId, operationToken, runtimeSessionId)) {
        this.recordIgnoredExecutionSessionOperation(kind, nodeId, 'attach', runtimeSessionId);
        return;
      }

      const node = this.requireNode(nodeId, kind);
      const metadata = kind === 'agent' ? ensureAgentMetadata(node) : ensureTerminalMetadata(node);
      this.bindRuntimeSession(
        nodeId,
        kind,
        snapshot.sessionId,
        this.getPersistedRuntimeStoragePath(metadata)
      );
      this.applyRuntimeSupervisorSnapshot(nodeId, kind, snapshot, {
        postSnapshot: true,
        historyOnUnavailable: true
      });
    } catch (error) {
      if (!this.isExecutionSessionOperationCurrent(kind, nodeId, operationToken)) {
        this.recordIgnoredExecutionSessionOperation(kind, nodeId, 'attach', runtimeSessionId);
        return;
      }

      if (
        kind === 'agent' &&
        this.maybeFallbackAgentLiveRuntimeToResume(nodeId, error instanceof Error ? error.message : '重新附着 live runtime 失败。')
      ) {
        return;
      }

      this.markExecutionNodeAsHistoryRestored(
        nodeId,
        kind,
        error instanceof Error ? error.message : '重新附着 live runtime 失败。'
      );
    }
  }

  private async restoreLiveRuntimeSessions(): Promise<void> {
    const liveRuntimeReconnectBlockReason = this.getLiveRuntimeReconnectBlockReason();
    if (liveRuntimeReconnectBlockReason === 'workspace-untrusted') {
      return;
    }

    if (liveRuntimeReconnectBlockReason === 'runtime-persistence-disabled') {
      await this.deleteRuntimeSupervisorSessions(this.collectPersistedLiveRuntimeSessions(), {
        allowRestart: false
      });
      return;
    }

    const reconnectableNodes = this.state.nodes.filter((node) => {
      if (node.kind === 'agent') {
        const metadata = ensureAgentMetadata(node);
        return (
          metadata.persistenceMode === 'live-runtime' &&
          metadata.runtimeSessionId &&
          metadata.attachmentState === 'reattaching'
        );
      }

      if (node.kind === 'terminal') {
        const metadata = ensureTerminalMetadata(node);
        return (
          metadata.persistenceMode === 'live-runtime' &&
          metadata.runtimeSessionId &&
          metadata.attachmentState === 'reattaching'
        );
      }

      return false;
    });

    if (reconnectableNodes.length === 0) {
      return;
    }

    const nodesByBackend = new Map<
      string,
      { backendKind: RuntimeHostBackendKind; runtimeStoragePath: string; nodes: CanvasNodeSummary[] }
    >();
    for (const node of reconnectableNodes) {
      const metadata = node.kind === 'agent' ? ensureAgentMetadata(node) : ensureTerminalMetadata(node);
      const backendKind = normalizeRuntimeHostBackendKind(metadata.runtimeBackend) ?? 'legacy-detached';
      const runtimeStoragePath = this.resolveRuntimeStoragePath(this.getPersistedRuntimeStoragePath(metadata));
      const bucketKey = `${backendKind}:${runtimeStoragePath}`;
      const bucket = nodesByBackend.get(bucketKey);
      if (bucket) {
        bucket.nodes.push(node);
      } else {
        nodesByBackend.set(bucketKey, {
          backendKind,
          runtimeStoragePath,
          nodes: [node]
        });
      }
    }

    for (const { backendKind, runtimeStoragePath, nodes } of nodesByBackend.values()) {
      let client: RuntimeSupervisorClient;
      try {
        client = await this.getRuntimeSupervisorClientForKind(backendKind, {}, runtimeStoragePath);
      } catch (error) {
        const message = error instanceof Error ? error.message : '无法连接 runtime supervisor。';
        for (const node of nodes) {
          if (
            node.kind === 'agent' &&
            this.maybeFallbackAgentLiveRuntimeToResume(node.id, message)
          ) {
            continue;
          }

          this.markExecutionNodeAsHistoryRestored(
            node.id,
            node.kind as ExecutionNodeKind,
            message
          );
        }
        continue;
      }

      await Promise.all(
        nodes.map(async (node) => {
          const runtimeSessionId =
            node.kind === 'agent'
              ? ensureAgentMetadata(node).runtimeSessionId
              : ensureTerminalMetadata(node).runtimeSessionId;
          if (!runtimeSessionId) {
            return;
          }

          await this.attachPersistedRuntimeSession(
            node.kind as ExecutionNodeKind,
            node.id,
            runtimeSessionId,
            () =>
              client.attachSession({
                sessionId: runtimeSessionId
              })
          );
        })
      );
    }
  }

  private bindRuntimeSession(
    nodeId: string,
    kind: ExecutionNodeKind,
    runtimeSessionId: string,
    runtimeStoragePath: string | undefined
  ): void {
    const normalizedRuntimeStoragePath = this.resolveRuntimeStoragePath(runtimeStoragePath);
    const nextBindingKey = this.buildRuntimeSessionBindingKey(runtimeSessionId, normalizedRuntimeStoragePath);
    for (const [bindingKey, binding] of Array.from(this.runtimeSessionBindings.entries())) {
      if (
        bindingKey !== nextBindingKey &&
        binding.nodeId === nodeId &&
        binding.kind === kind
      ) {
        this.runtimeSessionBindings.delete(bindingKey);
      }
    }

    this.runtimeSessionBindings.set(nextBindingKey, {
      nodeId,
      kind,
      runtimeSessionId,
      runtimeStoragePath: normalizedRuntimeStoragePath
    });
  }

  private collectPersistedLiveRuntimeSessions(): PersistedLiveRuntimeSession[] {
    const sessionKeys = new Set<string>();
    const sessions: PersistedLiveRuntimeSession[] = [];
    for (const node of this.state.nodes) {
      if (node.kind === 'agent') {
        const metadata = ensureAgentMetadata(node);
        if (metadata.persistenceMode === 'live-runtime' && metadata.runtimeSessionId) {
          const backendKind = normalizeRuntimeHostBackendKind(metadata.runtimeBackend) ?? 'legacy-detached';
          const runtimeStoragePath = this.getPersistedRuntimeStoragePath(metadata);
          const key = `${backendKind}:${runtimeStoragePath ?? ''}:${metadata.runtimeSessionId}`;
          if (!sessionKeys.has(key)) {
            sessionKeys.add(key);
            sessions.push({
              backendKind,
              sessionId: metadata.runtimeSessionId,
              runtimeStoragePath
            });
          }
        }
        continue;
      }

      if (node.kind === 'terminal') {
        const metadata = ensureTerminalMetadata(node);
        if (metadata.persistenceMode === 'live-runtime' && metadata.runtimeSessionId) {
          const backendKind = normalizeRuntimeHostBackendKind(metadata.runtimeBackend) ?? 'legacy-detached';
          const runtimeStoragePath = this.getPersistedRuntimeStoragePath(metadata);
          const key = `${backendKind}:${runtimeStoragePath ?? ''}:${metadata.runtimeSessionId}`;
          if (!sessionKeys.has(key)) {
            sessionKeys.add(key);
            sessions.push({
              backendKind,
              sessionId: metadata.runtimeSessionId,
              runtimeStoragePath
            });
          }
        }
      }
    }

    return sessions;
  }

  private getPersistedLiveRuntimeSessionForNode(
    node: CanvasNodeSummary
  ): PersistedLiveRuntimeSession | undefined {
    if (node.kind === 'agent') {
      const metadata = ensureAgentMetadata(node);
      if (metadata.persistenceMode === 'live-runtime' && metadata.runtimeSessionId) {
        return {
          backendKind: normalizeRuntimeHostBackendKind(metadata.runtimeBackend) ?? 'legacy-detached',
          sessionId: metadata.runtimeSessionId,
          runtimeStoragePath: this.getPersistedRuntimeStoragePath(metadata)
        };
      }
      return undefined;
    }

    if (node.kind === 'terminal') {
      const metadata = ensureTerminalMetadata(node);
      if (metadata.persistenceMode === 'live-runtime' && metadata.runtimeSessionId) {
        return {
          backendKind: normalizeRuntimeHostBackendKind(metadata.runtimeBackend) ?? 'legacy-detached',
          sessionId: metadata.runtimeSessionId,
          runtimeStoragePath: this.getPersistedRuntimeStoragePath(metadata)
        };
      }
    }

    return undefined;
  }

  private isMissingRuntimeSupervisorSessionError(error: unknown): boolean {
    return formatUnknownError(error).includes('未找到 runtime session');
  }

  private async deleteRuntimeSupervisorSessionStrict(
    session: PersistedLiveRuntimeSession,
    options: { allowRestart: boolean }
  ): Promise<void> {
    try {
      const client = await this.getRuntimeSupervisorClientForKind(session.backendKind, {
        allowRestart: options.allowRestart
      }, session.runtimeStoragePath);
      await client.deleteSession({
        sessionId: session.sessionId
      });
    } catch (error) {
      if (this.isMissingRuntimeSupervisorSessionError(error)) {
        return;
      }
      throw error;
    }
  }

  private async deleteRuntimeSupervisorSessions(
    sessions: PersistedLiveRuntimeSession[],
    options: { allowRestart: boolean }
  ): Promise<void> {
    if (sessions.length === 0) {
      return;
    }

    const sessionsByBackend = new Map<
      string,
      { backendKind: RuntimeHostBackendKind; runtimeStoragePath?: string; sessionIds: string[] }
    >();
    for (const session of sessions) {
      const bucketKey = `${session.backendKind}:${this.resolveRuntimeStoragePath(session.runtimeStoragePath)}`;
      const bucket = sessionsByBackend.get(bucketKey);
      if (bucket) {
        bucket.sessionIds.push(session.sessionId);
      } else {
        sessionsByBackend.set(bucketKey, {
          backendKind: session.backendKind,
          runtimeStoragePath: session.runtimeStoragePath,
          sessionIds: [session.sessionId]
        });
      }
    }

    for (const { backendKind, runtimeStoragePath, sessionIds } of sessionsByBackend.values()) {
      let client: RuntimeSupervisorClient;
      try {
        client = await this.getRuntimeSupervisorClientForKind(backendKind, {
          allowRestart: options.allowRestart
        }, runtimeStoragePath);
      } catch {
        continue;
      }

      await Promise.allSettled(
        sessionIds.map((sessionId) =>
          client.deleteSession({
            sessionId
          })
        )
      );
    }
  }

  private trackRuntimeSupervisorOperation<T>(operation: Promise<T>): void {
    this.pendingRuntimeSupervisorOperations.add(operation);
    operation.finally(() => {
      this.pendingRuntimeSupervisorOperations.delete(operation);
    });
  }

  private async waitForPendingRuntimeSupervisorOperations(): Promise<void> {
    if (this.pendingRuntimeSupervisorOperations.size === 0) {
      return;
    }

    await Promise.allSettled(Array.from(this.pendingRuntimeSupervisorOperations));
  }

  private async waitForPendingWorkspaceStateUpdates(): Promise<void> {
    await this.pendingWorkspaceStateUpdate;
  }

  private unbindRuntimeSession(runtimeSessionId: string | undefined, runtimeStoragePath?: string): void {
    if (!runtimeSessionId) {
      return;
    }

    if (runtimeStoragePath) {
      this.runtimeSessionBindings.delete(
        this.buildRuntimeSessionBindingKey(runtimeSessionId, runtimeStoragePath)
      );
      return;
    }

    for (const [bindingKey, binding] of Array.from(this.runtimeSessionBindings.entries())) {
      if (binding.runtimeSessionId === runtimeSessionId) {
        this.runtimeSessionBindings.delete(bindingKey);
      }
    }
  }

  private createSupervisorExecutionSession(
    snapshot: RuntimeSupervisorSessionSnapshot,
    runtimeStoragePath: string | undefined
  ): SupervisorExecutionSession {
    return {
      sessionId: snapshot.sessionId,
      owner: 'supervisor',
      startedAtMs: Date.now(),
      runtimeBackend: snapshot.runtimeBackend,
      runtimeGuarantee: snapshot.runtimeGuarantee,
      runtimeStoragePath: this.resolveRuntimeStoragePath(runtimeStoragePath),
      runtimeSessionId: snapshot.sessionId,
      shellPath: snapshot.shellPath,
      cwd: snapshot.cwd,
      cols: snapshot.cols,
      rows: snapshot.rows,
      buffer: snapshot.output,
      terminalStateTracker: new SerializedTerminalStateTracker(snapshot.cols, snapshot.rows, {
        scrollback: snapshot.scrollback,
        initialState: snapshot.serializedTerminalState,
        initialOutput: snapshot.output
      }),
      lineContextTracker: this.createExecutionTerminalLineContextTracker(
        snapshot.cols,
        snapshot.rows,
        snapshot.shellPath,
        snapshot.cwd,
        snapshot.scrollback,
        snapshot.output
      ),
      stopRequested: false,
      syncTimer: undefined,
      syncDueAtMs: undefined,
      lifecycleTimer: undefined,
      pendingOutput: '',
      outputFlushTimer: undefined,
      displayLabel: snapshot.displayLabel,
      lifecycleStatus: snapshot.lifecycle,
      launchMode: snapshot.launchMode,
      resumePhaseActive:
        snapshot.kind === 'agent'
          ? typeof snapshot.resumePhaseActive === 'boolean'
            ? snapshot.resumePhaseActive
            : snapshot.launchMode === 'resume' &&
              isAgentResumePhaseActive(snapshot.lifecycle as AgentNodeStatus)
          : false,
      agentProvider: snapshot.provider,
      agentResume:
        snapshot.kind === 'agent'
          ? {
              supported: doesAgentResumeStrategyRequireSupport(snapshot.resumeStrategy ?? 'none'),
              strategy: snapshot.resumeStrategy ?? 'none',
              sessionId: snapshot.resumeSessionId,
              storagePath: snapshot.resumeStoragePath
            }
          : undefined,
      outputSubscription: undefined,
      exitSubscription: undefined
    };
  }

  private createExecutionTerminalLineContextTracker(
    cols: number,
    rows: number,
    shellPath: string,
    cwd: string,
    scrollback: number,
    initialOutput?: string
  ): ExecutionTerminalLineContextTracker {
    return new ExecutionTerminalLineContextTracker(cols, rows, {
      cwd,
      pathStyle: inferExecutionTerminalPathStyle(shellPath, cwd),
      userHome: process.env.HOME ?? process.env.USERPROFILE,
      scrollback,
      initialOutput
    });
  }

  private disposeManagedExecutionSession(session: ManagedExecutionSession | undefined): void {
    if (!session) {
      return;
    }

    session.terminalStateTracker.dispose();
    session.lineContextTracker.dispose();
  }

  private handleRuntimeSupervisorOutput(
    runtimeStoragePath: string,
    runtimeSessionId: string,
    chunk: string
  ): void {
    const binding = this.runtimeSessionBindings.get(
      this.buildRuntimeSessionBindingKey(runtimeSessionId, runtimeStoragePath)
    );
    if (!binding) {
      return;
    }

    const session = this.getExecutionSessions(binding.kind).get(binding.nodeId);
    if (!session || session.owner !== 'supervisor') {
      return;
    }

    session.buffer = appendTerminalBuffer(session.buffer, chunk);
    session.terminalStateTracker.write(chunk);
    session.lineContextTracker.write(chunk);
    this.queueExecutionStateSync(binding.kind, binding.nodeId);
    this.queueExecutionOutput(binding.kind, binding.nodeId, chunk);
  }

  private handleRuntimeSupervisorState(
    runtimeStoragePath: string,
    snapshot: RuntimeSupervisorSessionSnapshot
  ): void {
    const binding = this.runtimeSessionBindings.get(
      this.buildRuntimeSessionBindingKey(snapshot.sessionId, runtimeStoragePath)
    );
    if (!binding) {
      return;
    }

    const wasLive = this.getExecutionSessions(binding.kind).has(binding.nodeId);
    this.applyRuntimeSupervisorSnapshot(binding.nodeId, binding.kind, snapshot, {
      postSnapshot: false,
      historyOnUnavailable: false
    });

    if (wasLive && !snapshot.live) {
      this.postMessage({
        type: 'host/executionExit',
        payload: {
          nodeId: binding.nodeId,
          kind: binding.kind,
          message: snapshot.lastExitMessage ?? '会话已结束。'
        }
      });
      if (
        snapshot.lifecycle === 'error' ||
        snapshot.lifecycle === 'resume-failed'
      ) {
        this.postMessage({
          type: 'host/error',
          payload: {
            message: snapshot.lastExitMessage ?? '会话异常退出。'
          }
        });
      }
    }
  }

  private handleRuntimeSupervisorDisconnected(
    backendKind: RuntimeHostBackendKind,
    runtimeStoragePath: string,
    error?: Error
  ): void {
    for (const [nodeId, session] of this.agentSessions.entries()) {
      if (
        session.owner === 'supervisor' &&
        session.runtimeBackend === backendKind &&
        this.resolveRuntimeStoragePath(session.runtimeStoragePath) === runtimeStoragePath
      ) {
        if (this.maybeFallbackAgentLiveRuntimeToResume(nodeId, error?.message)) {
          continue;
        }
        this.markExecutionNodeAsHistoryRestored(nodeId, 'agent', error?.message);
      }
    }

    for (const [nodeId, session] of this.terminalSessions.entries()) {
      if (
        session.owner === 'supervisor' &&
        session.runtimeBackend === backendKind &&
        this.resolveRuntimeStoragePath(session.runtimeStoragePath) === runtimeStoragePath
      ) {
        this.markExecutionNodeAsHistoryRestored(nodeId, 'terminal', error?.message);
      }
    }
  }

  private applyRuntimeSupervisorSnapshot(
    nodeId: string,
    kind: ExecutionNodeKind,
    snapshot: RuntimeSupervisorSessionSnapshot,
    options: { postSnapshot: boolean; historyOnUnavailable: boolean }
  ): void {
    if (snapshot.live) {
      const existingNode = this.requireNode(nodeId, kind);
      const existingAgentMetadata = kind === 'agent' ? ensureAgentMetadata(existingNode) : undefined;
      const existingRuntimeMetadata =
        kind === 'agent' ? ensureAgentMetadata(existingNode) : ensureTerminalMetadata(existingNode);
      const runtimeStoragePath = this.resolveRuntimeStoragePath(
        this.getPersistedRuntimeStoragePath(existingRuntimeMetadata)
      );
      this.disposeManagedExecutionSession(this.getExecutionSessions(kind).get(nodeId));
      const session = this.createSupervisorExecutionSession(snapshot, runtimeStoragePath);
      this.getExecutionSessions(kind).set(nodeId, session);
      this.state = updateExecutionNode(this.state, nodeId, kind, {
        status: snapshot.lifecycle,
        summary:
          kind === 'agent'
            ? summarizeAgentSessionOutput(snapshot.output, snapshot.lifecycle as AgentNodeStatus, snapshot.displayLabel)
            : summarizeEmbeddedTerminalOutput(snapshot.output, snapshot.lifecycle as TerminalNodeStatus),
        metadata: buildExecutionMetadataPatch(this.state, nodeId, kind, {
          persistenceMode: 'live-runtime',
          attachmentState: 'attached-live',
          runtimeBackend: snapshot.runtimeBackend,
          runtimeGuarantee: snapshot.runtimeGuarantee,
          runtimeStoragePath,
          liveSession: true,
          runtimeSessionId: snapshot.sessionId,
          lastRuntimeError: undefined,
          shellPath: snapshot.shellPath,
          cwd: snapshot.cwd,
          recentOutput: extractRecentTerminalOutput(stripTerminalControlSequences(snapshot.output)) || undefined,
          lastCols: snapshot.cols,
          lastRows: snapshot.rows,
          serializedTerminalState: cloneSerializedTerminalState(snapshot.serializedTerminalState),
          lastExitCode: snapshot.lastExitCode,
          lastExitSignal: snapshot.lastExitSignal,
          lastExitMessage: snapshot.lastExitMessage,
          ...(kind === 'agent'
            ? {
                lifecycle: snapshot.lifecycle as AgentNodeStatus,
                provider: snapshot.provider ?? existingAgentMetadata?.provider,
                resumeSupported: doesAgentResumeStrategyRequireSupport(
                  snapshot.resumeStrategy ?? existingAgentMetadata?.resumeStrategy ?? 'none'
                ),
                resumeStrategy: snapshot.resumeStrategy,
                resumeSessionId: snapshot.resumeSessionId,
                resumeStoragePath: snapshot.resumeStoragePath,
                lastBackendLabel: snapshot.displayLabel
              }
            : {
                lifecycle: snapshot.lifecycle as TerminalNodeStatus
              })
        })
      });
      this.persistState();
      this.postState('host/stateUpdated');
      if (options.postSnapshot) {
        this.postExecutionSnapshot(kind, nodeId);
      }
      return;
    }

    if (options.historyOnUnavailable) {
      this.markExecutionNodeAsHistoryRestored(nodeId, kind, snapshot.lastExitMessage, snapshot);
      return;
    }

    this.applyCompletedRuntimeSupervisorSnapshot(nodeId, kind, snapshot);
  }

  private applyCompletedRuntimeSupervisorSnapshot(
    nodeId: string,
    kind: ExecutionNodeKind,
    snapshot: RuntimeSupervisorSessionSnapshot
  ): void {
    const existingNode = this.requireNode(nodeId, kind);
    const currentMetadata = kind === 'agent' ? ensureAgentMetadata(existingNode) : ensureTerminalMetadata(existingNode);
    this.unbindRuntimeSession(snapshot.sessionId, currentMetadata.runtimeStoragePath);
    const existingSession = this.getExecutionSessions(kind).get(nodeId);
    this.disposeManagedExecutionSession(existingSession);
    this.getExecutionSessions(kind).delete(nodeId);
    this.state = updateExecutionNode(this.state, nodeId, kind, {
      status: snapshot.lifecycle,
      summary:
        snapshot.lastExitMessage ||
        (kind === 'agent'
          ? summarizeAgentSessionOutput(snapshot.output, snapshot.lifecycle as AgentNodeStatus, snapshot.displayLabel)
          : summarizeEmbeddedTerminalOutput(snapshot.output, snapshot.lifecycle as TerminalNodeStatus)),
      metadata: buildExecutionMetadataPatch(this.state, nodeId, kind, {
        persistenceMode: 'live-runtime',
        attachmentState: 'history-restored',
        runtimeBackend: snapshot.runtimeBackend,
        runtimeGuarantee: snapshot.runtimeGuarantee,
        runtimeStoragePath: currentMetadata.runtimeStoragePath,
        liveSession: false,
        runtimeSessionId: snapshot.sessionId,
        lastRuntimeError: undefined,
        shellPath: snapshot.shellPath,
        cwd: snapshot.cwd,
        recentOutput: extractRecentTerminalOutput(stripTerminalControlSequences(snapshot.output)) || currentMetadata.recentOutput,
        lastExitCode: snapshot.lastExitCode,
        lastExitSignal: snapshot.lastExitSignal,
        lastExitMessage: snapshot.lastExitMessage,
        lastCols: snapshot.cols,
        lastRows: snapshot.rows,
        serializedTerminalState:
          cloneSerializedTerminalState(snapshot.serializedTerminalState) ??
          currentMetadata.serializedTerminalState,
        ...(kind === 'agent'
          ? {
              lifecycle: snapshot.lifecycle as AgentNodeStatus,
              provider: snapshot.provider ?? ensureAgentMetadata(existingNode).provider,
              resumeSupported: doesAgentResumeStrategyRequireSupport(
                snapshot.resumeStrategy ?? ensureAgentMetadata(existingNode).resumeStrategy
              ),
              resumeStrategy: snapshot.resumeStrategy ?? ensureAgentMetadata(existingNode).resumeStrategy,
              resumeSessionId: snapshot.resumeSessionId ?? ensureAgentMetadata(existingNode).resumeSessionId,
              resumeStoragePath: snapshot.resumeStoragePath ?? ensureAgentMetadata(existingNode).resumeStoragePath,
              lastBackendLabel: snapshot.displayLabel
            }
          : {
              lifecycle: snapshot.lifecycle as TerminalNodeStatus
            })
      })
    });
    this.persistState();
    this.postState('host/stateUpdated');
  }

  private markExecutionNodeAsHistoryRestored(
    nodeId: string,
    kind: ExecutionNodeKind,
    reason?: string,
    snapshot?: RuntimeSupervisorSessionSnapshot
  ): void {
    const existingNode = this.requireNode(nodeId, kind);
    const currentMetadata = kind === 'agent' ? ensureAgentMetadata(existingNode) : ensureTerminalMetadata(existingNode);
    const runtimeSessionId = snapshot?.sessionId ?? currentMetadata.runtimeSessionId;
    this.unbindRuntimeSession(runtimeSessionId, currentMetadata.runtimeStoragePath);
    const existingSession = this.getExecutionSessions(kind).get(nodeId);
    this.disposeManagedExecutionSession(existingSession);
    this.getExecutionSessions(kind).delete(nodeId);

    const lifecycle =
      snapshot?.lifecycle ??
      (kind === 'agent'
        ? ensureAgentMetadata(existingNode).lifecycle
        : ensureTerminalMetadata(existingNode).lifecycle);
    const summary =
      reason?.trim() ||
      (kind === 'agent'
        ? '未能重新附着到原 Agent live runtime，已恢复为历史结果。'
        : '未能重新附着到原终端 live runtime，已恢复为历史结果。');
    this.state = updateExecutionNode(this.state, nodeId, kind, {
      status: 'history-restored',
      summary,
      metadata: buildExecutionMetadataPatch(this.state, nodeId, kind, {
        persistenceMode: 'live-runtime',
        attachmentState: 'history-restored',
        runtimeBackend: snapshot?.runtimeBackend ?? currentMetadata.runtimeBackend,
        runtimeGuarantee: snapshot?.runtimeGuarantee ?? currentMetadata.runtimeGuarantee,
        runtimeStoragePath: currentMetadata.runtimeStoragePath,
        liveSession: false,
        runtimeSessionId,
        lastRuntimeError: reason,
        recentOutput:
          snapshot?.output !== undefined
            ? extractRecentTerminalOutput(stripTerminalControlSequences(snapshot.output)) || currentMetadata.recentOutput
            : currentMetadata.recentOutput,
        lastExitCode: snapshot?.lastExitCode ?? currentMetadata.lastExitCode,
        lastExitSignal: snapshot?.lastExitSignal ?? currentMetadata.lastExitSignal,
        lastExitMessage: snapshot?.lastExitMessage ?? currentMetadata.lastExitMessage ?? summary,
        lastCols: snapshot?.cols ?? currentMetadata.lastCols,
        lastRows: snapshot?.rows ?? currentMetadata.lastRows,
        serializedTerminalState:
          cloneSerializedTerminalState(snapshot?.serializedTerminalState) ??
          currentMetadata.serializedTerminalState,
        ...(kind === 'agent'
          ? {
              lifecycle: lifecycle as AgentNodeStatus,
              provider: snapshot?.provider ?? ensureAgentMetadata(existingNode).provider,
              resumeSupported: doesAgentResumeStrategyRequireSupport(
                snapshot?.resumeStrategy ?? ensureAgentMetadata(existingNode).resumeStrategy
              ),
              resumeStrategy: snapshot?.resumeStrategy ?? ensureAgentMetadata(existingNode).resumeStrategy,
              resumeSessionId: snapshot?.resumeSessionId ?? ensureAgentMetadata(existingNode).resumeSessionId,
              resumeStoragePath: snapshot?.resumeStoragePath ?? ensureAgentMetadata(existingNode).resumeStoragePath,
              lastBackendLabel: snapshot?.displayLabel ?? ensureAgentMetadata(existingNode).lastBackendLabel
            }
          : {
              lifecycle: lifecycle as TerminalNodeStatus,
              shellPath: snapshot?.shellPath ?? ensureTerminalMetadata(existingNode).shellPath,
              cwd: snapshot?.cwd ?? ensureTerminalMetadata(existingNode).cwd
            })
      })
    });
    this.persistState();
    this.postState('host/stateUpdated');
  }

  private maybeFallbackAgentLiveRuntimeToResume(
    nodeId: string,
    reason?: string
  ): boolean {
    if (this.getLiveRuntimeReconnectBlockReason() !== undefined) {
      return false;
    }

    const existingNode = this.state.nodes.find((node) => node.id === nodeId && node.kind === 'agent');
    if (!existingNode) {
      return false;
    }

    const metadata = ensureAgentMetadata(existingNode);
    if (!canResumeAgentFromMetadata(metadata)) {
      return false;
    }

    this.unbindRuntimeSession(metadata.runtimeSessionId, metadata.runtimeStoragePath);
    this.getExecutionSessions('agent').delete(nodeId);

    this.state = updateAgentNode(this.state, nodeId, {
      status: 'resume-ready',
      summary: '原 Agent live runtime 已断开，将改用可恢复会话继续。',
      metadata: buildAgentMetadataPatch(this.state, nodeId, {
        lifecycle: 'resume-ready',
        provider: metadata.provider,
        runtimeKind: metadata.runtimeKind,
        resumeSupported: doesAgentResumeStrategyRequireSupport(metadata.resumeStrategy),
        resumeStrategy: metadata.resumeStrategy,
        resumeSessionId: metadata.resumeSessionId,
        resumeStoragePath: metadata.resumeStoragePath,
        lastResumeError: undefined,
        persistenceMode: metadata.persistenceMode,
        attachmentState: 'history-restored',
        runtimeBackend: metadata.runtimeBackend,
        runtimeGuarantee: metadata.runtimeGuarantee,
        liveSession: false,
        runtimeSessionId: undefined,
        pendingLaunch: 'resume',
        shellPath: metadata.shellPath,
        cwd: metadata.cwd,
        recentOutput: metadata.recentOutput,
        lastExitCode: metadata.lastExitCode,
        lastExitSignal: metadata.lastExitSignal,
        lastExitMessage: metadata.lastExitMessage,
        lastCols: metadata.lastCols,
        lastRows: metadata.lastRows,
        lastBackendLabel: metadata.lastBackendLabel,
        lastRuntimeError: reason
      })
    });
    this.recordDiagnosticEvent('agent/liveRuntimeReconnectFallbackToResume', {
      nodeId,
      resumeStrategy: metadata.resumeStrategy,
      resumeSessionId: metadata.resumeSessionId ?? null,
      reason: reason ?? null
    });
    this.persistState();
    this.postState('host/stateUpdated');
    return true;
  }

  private requireNode(nodeId: string, kind: ExecutionNodeKind): CanvasNodeSummary {
    const node = this.state.nodes.find((currentNode) => currentNode.id === nodeId && currentNode.kind === kind);
    if (!node) {
      throw new Error(`未找到 ${kind} 节点 ${nodeId}。`);
    }

    return node;
  }

  private getConfiguredSurface(): CanvasSurfaceLocation {
    return this.appliedStartupConfiguration.defaultSurface;
  }

  private normalizeStoredSurface(value: unknown): CanvasSurfaceLocation | undefined {
    return value === 'editor' || value === 'panel' ? value : undefined;
  }

  private loadStoredDefaultSurface(snapshot?: PersistedCanvasSnapshot): CanvasSurfaceLocation | undefined {
    return (
      this.normalizeStoredSurface(snapshot?.defaultSurface) ??
      this.normalizeStoredSurface(this.getStoredValue<string>(STORAGE_KEYS.canvasDefaultSurface))
    );
  }

  private loadStoredSurface(): CanvasSurfaceLocation | undefined {
    const snapshot = this.loadPersistedCanvasSnapshot();
    const storedSurface = this.normalizeStoredSurface(
      snapshot?.activeSurface ?? this.getStoredValue<string>(STORAGE_KEYS.canvasLastSurface)
    );
    const storedDefaultSurface = this.loadStoredDefaultSurface(snapshot);
    if (
      storedDefaultSurface &&
      storedDefaultSurface !== this.appliedStartupConfiguration.defaultSurface &&
      storedSurface !== this.appliedStartupConfiguration.defaultSurface
    ) {
      return this.appliedStartupConfiguration.defaultSurface;
    }

    return storedSurface;
  }

  private persistActiveSurface(): void {
    if (!this.activeSurface) {
      return;
    }

    void this.queuePersistedCanvasSnapshotWrite({
      version: 1,
      state: this.state,
      activeSurface: this.activeSurface
    }).catch(() => undefined);
  }

  private claimSurfaceIfNeeded(surface: CanvasSurfaceLocation): void {
    if (this.activeSurface || this.getConfiguredSurface() !== surface) {
      return;
    }

    this.activeSurface = surface;
    this.persistActiveSurface();
    this.applyWorkbenchContextKeys();
    this.recordDiagnosticEvent('surface/claimed', {
      surface
    });
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

  private maybePostVisibilityRestored(surface: CanvasSurfaceLocation, options?: { force?: boolean }): void {
    if (
      this.activeSurface !== surface ||
      !this.surfaceReady[surface] ||
      this.getSurfaceVisibility(surface) !== 'visible'
    ) {
      return;
    }

    if (!this.pendingVisibilityRestore[surface] && options?.force !== true) {
      return;
    }

    this.pendingVisibilityRestore[surface] = false;
    this.postMessage({
      type: 'host/visibilityRestored'
    });
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

  private handleWebviewMessage(sourceSurface: CanvasSurfaceLocation, message: unknown): void {
    const parsedMessage = parseWebviewMessage(message);
    if (!parsedMessage) {
      if (this.isInteractiveSurface(sourceSurface)) {
        this.postMessageToSurface(sourceSurface, {
          type: 'host/error',
          payload: {
            message: '收到无法识别的消息，已忽略。'
          }
        });
      }
      return;
    }

    if (parsedMessage.type === 'webview/testProbeResult') {
      this.resolvePendingWebviewProbeRequest(
        sourceSurface,
        parsedMessage.payload.requestId,
        parsedMessage.payload.snapshot
      );
      return;
    }

    if (parsedMessage.type === 'webview/testDomActionResult') {
      this.resolvePendingWebviewDomActionRequest(
        sourceSurface,
        parsedMessage.payload.requestId,
        parsedMessage.payload.ok,
        parsedMessage.payload.errorMessage
      );
      return;
    }

    if (parsedMessage.type === 'webview/ready') {
      this.surfaceReady[sourceSurface] = true;
      this.recordDiagnosticEvent('surface/ready', {
        surface: sourceSurface,
        mode: this.surfaceMode[sourceSurface],
        activeSurface: this.activeSurface
      });
      if (this.isInteractiveSurface(sourceSurface)) {
        this.postState('host/bootstrap');
        this.maybePostVisibilityRestored(sourceSurface, {
          force: true
        });
      }
      return;
    }

    if (!this.isInteractiveSurface(sourceSurface)) {
      return;
    }

    this.handleActiveWebviewMessage(sourceSurface, parsedMessage);
  }

  private handleActiveWebviewMessage(
    sourceSurface: CanvasSurfaceLocation,
    parsedMessage: WebviewToHostMessage
  ): void {
    switch (parsedMessage.type) {
      case 'webview/ready':
        return;
      case 'webview/createDemoNode':
        this.applyCreateNode(parsedMessage.payload.kind, parsedMessage.payload.preferredPosition, {
          agentProvider: parsedMessage.payload.agentProvider
        });
        return;
      case 'webview/moveNode':
        this.state = moveNode(this.state, parsedMessage.payload.id, parsedMessage.payload.position);
        this.persistState();
        this.postState('host/stateUpdated');
        return;
      case 'webview/resizeNode':
        this.state = resizeNode(
          this.state,
          parsedMessage.payload.nodeId,
          parsedMessage.payload.position,
          parsedMessage.payload.size
        );
        this.persistState();
        this.postState('host/stateUpdated');
        return;
      case 'webview/deleteNode':
        void this.deleteNode(parsedMessage.payload.nodeId);
        return;
      case 'webview/startExecutionSession':
        if (parsedMessage.payload.kind === 'agent') {
          const operation = this.startAgentSession(
            parsedMessage.payload.nodeId,
            parsedMessage.payload.cols,
            parsedMessage.payload.rows,
            parsedMessage.payload.provider,
            parsedMessage.payload.resume === true
          );
          if (this.isRuntimePersistenceEnabled()) {
            this.trackRuntimeSupervisorOperation(operation);
          }
          return;
        }

        const operation = this.startTerminalSession(
          parsedMessage.payload.nodeId,
          parsedMessage.payload.cols,
          parsedMessage.payload.rows
        );
        if (this.isRuntimePersistenceEnabled()) {
          this.trackRuntimeSupervisorOperation(operation);
        }
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
      case 'webview/dropExecutionResource':
        void this.handleDroppedExecutionResource(
          parsedMessage.payload.kind,
          parsedMessage.payload.nodeId,
          parsedMessage.payload.resource
        );
        return;
      case 'webview/openExecutionLink':
        void this.handleOpenExecutionLink(
          parsedMessage.payload.kind,
          parsedMessage.payload.nodeId,
          parsedMessage.payload.link
        );
        return;
      case 'webview/resolveExecutionFileLinks':
        void this.handleResolveExecutionFileLinks(
          sourceSurface,
          parsedMessage.payload.kind,
          parsedMessage.payload.nodeId,
          parsedMessage.payload.requestId,
          parsedMessage.payload.candidates
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
      case 'webview/updateNodeTitle':
        this.state = updateNodeTitle(this.state, parsedMessage.payload.nodeId, parsedMessage.payload.title);
        this.persistState();
        this.postState('host/stateUpdated');
        return;
      case 'webview/updateNoteNode':
        this.state = updateNoteContent(this.state, parsedMessage.payload);
        this.persistState();
        this.postState('host/stateUpdated');
        return;
      case 'webview/resetDemoState':
        void this.resetState().catch((error) => {
          this.postMessage({
            type: 'host/error',
            payload: {
              message: formatUnknownError(error)
            }
          });
        });
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

  private ensureRuntimeDirectory(targetPath: string): string {
    fs.mkdirSync(targetPath, {
      recursive: true
    });
    return targetPath;
  }

  private getAgentRuntimeStorageRoot(): string {
    return this.ensureRuntimeDirectory(path.join(this.getExtensionStoragePath(), 'agent-runtime'));
  }

  private resolveAgentResumeContext(
    nodeId: string,
    provider: AgentProviderKind,
    launchMode: PendingExecutionLaunch,
    metadata?: AgentNodeMetadata
  ): AgentResumeContext {
    const previousProvider = metadata?.provider;
    if (provider === 'claude') {
      if (launchMode === 'resume') {
        const sessionId = previousProvider === provider ? metadata?.resumeSessionId?.trim() : undefined;
        if (sessionId) {
          return {
            supported: true,
            strategy: 'claude-session-id',
            sessionId
          };
        }

        return {
          supported: false,
          strategy: 'none'
        };
      }

      return {
        supported: true,
        strategy: 'claude-session-id',
        sessionId: randomUUID()
      };
    }

    if (this.context.extensionMode === vscode.ExtensionMode.Test) {
      if (launchMode === 'resume') {
        const sessionId = previousProvider === provider ? metadata?.resumeSessionId?.trim() : undefined;
        const storagePath =
          previousProvider === provider ? metadata?.resumeStoragePath?.trim() : undefined;
        if (sessionId && storagePath) {
          return {
            supported: true,
            strategy: 'fake-provider',
            sessionId,
            storagePath
          };
        }

        return {
          supported: false,
          strategy: 'none'
        };
      }

      return {
        supported: true,
        strategy: 'fake-provider',
        sessionId: randomUUID(),
        storagePath: this.ensureRuntimeDirectory(path.join(this.getAgentRuntimeStorageRoot(), nodeId))
      };
    }

    if (launchMode === 'resume') {
      const sessionId = previousProvider === provider ? metadata?.resumeSessionId?.trim() : undefined;
      if (sessionId) {
        return {
          supported: true,
          strategy: 'codex-session-id',
          sessionId
        };
      }
    }

    return {
      supported: false,
      strategy: 'none'
    };
  }

  private async maybeDiscoverCodexResumeSessionId(
    nodeId: string,
    session: ManagedExecutionSession
  ): Promise<void> {
    if (
      session.agentProvider !== 'codex' ||
      session.launchMode !== 'start' ||
      session.agentResume?.sessionId?.trim()
    ) {
      return;
    }

    const discoveredSessionId = await locateCodexSessionId({
      cwd: session.cwd,
      startedAtMs: session.startedAtMs
    });

    const currentSession = this.getExecutionSessions('agent').get(nodeId);
    if (!currentSession || currentSession !== session) {
      return;
    }

    if (!discoveredSessionId) {
      this.recordDiagnosticEvent('agent/codexSessionIdDiscoveryMissed', {
        nodeId,
        cwd: session.cwd,
        startedAtMs: session.startedAtMs
      });
      return;
    }

    currentSession.agentResume = {
      supported: true,
      strategy: 'codex-session-id',
      sessionId: discoveredSessionId
    };
    this.recordDiagnosticEvent('agent/codexSessionIdDiscovered', {
      nodeId,
      cwd: session.cwd,
      resumeSessionId: discoveredSessionId,
      startedAtMs: session.startedAtMs
    });
    this.flushLiveExecutionState('agent', nodeId);
  }

  private ensureAgentActivityState(session: ManagedExecutionSession): AgentActivityHeuristicState {
    if (!session.agentActivity) {
      session.agentActivity = createAgentActivityHeuristicState();
    }

    return session.agentActivity;
  }

  private recordAgentOutputActivity(
    nodeId: string,
    session: ManagedExecutionSession,
    chunk: string
  ): void {
    const state = this.ensureAgentActivityState(session);
    recordAgentOutputHeuristics(state, chunk, session.buffer);
    this.scheduleAgentInteractiveStateEvaluation(nodeId);
  }

  private scheduleAgentInteractiveStateEvaluation(nodeId: string): void {
    const session = this.getExecutionSessions('agent').get(nodeId);
    if (!session || !isAgentLifecycleAwaitingInteractiveState(session.lifecycleStatus)) {
      return;
    }

    if (session.lifecycleTimer) {
      clearTimeout(session.lifecycleTimer);
    }

    session.lifecycleTimer = setTimeout(() => {
      const current = this.getExecutionSessions('agent').get(nodeId);
      if (!current || !isAgentLifecycleAwaitingInteractiveState(current.lifecycleStatus)) {
        return;
      }

      const evaluation = evaluateAgentWaitingInputTransition(this.ensureAgentActivityState(current));
      if (evaluation.shouldTransition) {
        current.lifecycleTimer = undefined;
        if (current.lifecycleStatus === 'resuming') {
          current.resumePhaseActive = false;
        }
        current.lifecycleStatus = 'waiting-input';
        this.flushLiveExecutionState('agent', nodeId);
        this.recordDiagnosticEvent('agent/waitingInputHeuristicMatched', {
          nodeId,
          reason: evaluation.reason ?? 'unknown'
        });
        return;
      }

      if (evaluation.shouldKeepPolling) {
        this.scheduleAgentInteractiveStateEvaluation(nodeId);
        return;
      }

      current.lifecycleTimer = undefined;
    }, AGENT_WAITING_INPUT_POLL_INTERVAL_MS);
  }

  private async startAgentSessionWithSupervisor(
    nodeId: string,
    normalizedCols: number,
    normalizedRows: number,
    provider: AgentProviderKind,
    cliSpec: AgentCliSpec,
    resumeContext: AgentResumeContext,
    launchMode: PendingExecutionLaunch
  ): Promise<void> {
    const operationToken = this.beginExecutionSessionOperation('agent', nodeId);
    const existingNode = this.requireNode(nodeId, 'agent');
    const existingMetadata = ensureAgentMetadata(existingNode);
    const cwd = this.getTerminalWorkingDirectory();
    const lifecycleStatus: AgentNodeStatus = launchMode === 'resume' ? 'resuming' : 'starting';
    const { client, backend, runtimeStoragePath, fallbackReason } =
      await this.getPreferredRuntimeSupervisorClient();
    if (fallbackReason) {
      this.recordDiagnosticEvent('runtime/backendFallback', {
        kind: 'agent',
        nodeId,
        selectedBackend: backend.kind,
        guarantee: backend.guarantee,
        reason: fallbackReason
      });
    }

    this.state = updateAgentNode(this.state, nodeId, {
      status: lifecycleStatus,
      summary: summarizeAgentSessionOutput('', lifecycleStatus, cliSpec.label),
      metadata: buildAgentMetadataPatch(this.state, nodeId, {
        provider,
        lifecycle: lifecycleStatus,
        runtimeKind: 'pty-cli',
        resumeSupported: resumeContext.supported,
        resumeStrategy: resumeContext.strategy,
        resumeSessionId: resumeContext.sessionId,
        resumeStoragePath: resumeContext.storagePath,
        persistenceMode: 'live-runtime',
        attachmentState: 'attached-live',
        runtimeBackend: backend.kind,
        runtimeGuarantee: backend.guarantee,
        runtimeStoragePath,
        liveSession: false,
        runtimeSessionId: undefined,
        pendingLaunch: undefined,
        shellPath: cliSpec.command,
        cwd,
        lastExitCode: undefined,
        lastExitSignal: undefined,
        lastExitMessage: undefined,
        lastResumeError: undefined,
        lastRuntimeError: undefined,
        lastCols: normalizedCols,
        lastRows: normalizedRows,
        serializedTerminalState: undefined,
        lastBackendLabel: cliSpec.label
      })
    });
    this.persistState();
    this.postState('host/stateUpdated');

    const previousRuntimeSessionId = existingMetadata.runtimeSessionId;
    if (previousRuntimeSessionId) {
      const previousBackendKind =
        normalizeRuntimeHostBackendKind(existingMetadata.runtimeBackend) ?? 'legacy-detached';
      const previousRuntimeStoragePath = this.getPersistedRuntimeStoragePath(existingMetadata);
      try {
        const previousClient =
          previousBackendKind === backend.kind &&
          this.resolveRuntimeStoragePath(previousRuntimeStoragePath) === runtimeStoragePath
            ? client
            : await this.getRuntimeSupervisorClientForKind(
                previousBackendKind,
                {},
                previousRuntimeStoragePath
              );
        await previousClient.deleteSession({
          sessionId: previousRuntimeSessionId
        });
      } catch {
        // Best effort only. The new session can still start with a fresh identity.
      }
      this.unbindRuntimeSession(previousRuntimeSessionId, existingMetadata.runtimeStoragePath);
    }

    const snapshot = await client.createSession({
      kind: 'agent',
      displayLabel: cliSpec.label,
      launchMode,
      scrollback: this.getTerminalScrollback(),
      provider,
      resumeStrategy: resumeContext.strategy,
      resumeSessionId: resumeContext.sessionId,
      resumeStoragePath: resumeContext.storagePath,
      launchSpec: serializeExecutionSessionLaunchSpec(
        this.buildAgentLaunchSpec(cliSpec, cwd, normalizedCols, normalizedRows, launchMode, resumeContext)
      )
    });
    if (!this.shouldApplyRuntimeCreateResult('agent', nodeId, operationToken, backend.kind)) {
      this.recordIgnoredExecutionSessionOperation('agent', nodeId, 'create', snapshot.sessionId);
      await this.deleteRuntimeSupervisorSessionBestEffort(client, snapshot.sessionId);
      return;
    }

    this.bindRuntimeSession(nodeId, 'agent', snapshot.sessionId, runtimeStoragePath);
    this.applyRuntimeSupervisorSnapshot(nodeId, 'agent', snapshot, {
      postSnapshot: true,
      historyOnUnavailable: true
    });
  }

  private async startTerminalSessionWithSupervisor(
    nodeId: string,
    normalizedCols: number,
    normalizedRows: number
  ): Promise<void> {
    const operationToken = this.beginExecutionSessionOperation('terminal', nodeId);
    const existingNode = this.requireNode(nodeId, 'terminal');
    const existingMetadata = ensureTerminalMetadata(existingNode);
    const shellPath = this.getTerminalShellPath();
    const cwd = this.getTerminalWorkingDirectory();
    const { client, backend, runtimeStoragePath, fallbackReason } =
      await this.getPreferredRuntimeSupervisorClient();
    if (fallbackReason) {
      this.recordDiagnosticEvent('runtime/backendFallback', {
        kind: 'terminal',
        nodeId,
        selectedBackend: backend.kind,
        guarantee: backend.guarantee,
        reason: fallbackReason
      });
    }

    this.state = updateTerminalNode(this.state, nodeId, {
      status: 'launching',
      summary: summarizeEmbeddedTerminalOutput('', 'launching'),
      metadata: buildTerminalMetadataPatch(this.state, nodeId, {
        lifecycle: 'launching',
        persistenceMode: 'live-runtime',
        attachmentState: 'attached-live',
        runtimeBackend: backend.kind,
        runtimeGuarantee: backend.guarantee,
        runtimeStoragePath,
        liveSession: false,
        runtimeSessionId: undefined,
        pendingLaunch: undefined,
        shellPath,
        cwd,
        lastCols: normalizedCols,
        lastRows: normalizedRows,
        recentOutput: undefined,
        lastExitCode: undefined,
        lastExitSignal: undefined,
        lastExitMessage: undefined,
        lastRuntimeError: undefined,
        serializedTerminalState: undefined
      })
    });
    this.persistState();
    this.postState('host/stateUpdated');

    const previousRuntimeSessionId = existingMetadata.runtimeSessionId;
    if (previousRuntimeSessionId) {
      const previousBackendKind =
        normalizeRuntimeHostBackendKind(existingMetadata.runtimeBackend) ?? 'legacy-detached';
      const previousRuntimeStoragePath = this.getPersistedRuntimeStoragePath(existingMetadata);
      try {
        const previousClient =
          previousBackendKind === backend.kind &&
          this.resolveRuntimeStoragePath(previousRuntimeStoragePath) === runtimeStoragePath
            ? client
            : await this.getRuntimeSupervisorClientForKind(
                previousBackendKind,
                {},
                previousRuntimeStoragePath
              );
        await previousClient.deleteSession({
          sessionId: previousRuntimeSessionId
        });
      } catch {
        // Best effort only. The new session can still start with a fresh identity.
      }
      this.unbindRuntimeSession(previousRuntimeSessionId, existingMetadata.runtimeStoragePath);
    }

    const snapshot = await client.createSession({
      kind: 'terminal',
      displayLabel: shellPath,
      launchMode: 'start',
      scrollback: this.getTerminalScrollback(),
      launchSpec: serializeExecutionSessionLaunchSpec(
        this.buildTerminalLaunchSpec(shellPath, cwd, normalizedCols, normalizedRows)
      )
    });
    if (!this.shouldApplyRuntimeCreateResult('terminal', nodeId, operationToken, backend.kind)) {
      this.recordIgnoredExecutionSessionOperation('terminal', nodeId, 'create', snapshot.sessionId);
      await this.deleteRuntimeSupervisorSessionBestEffort(client, snapshot.sessionId);
      return;
    }

    this.bindRuntimeSession(nodeId, 'terminal', snapshot.sessionId, runtimeStoragePath);
    this.applyRuntimeSupervisorSnapshot(nodeId, 'terminal', snapshot, {
      postSnapshot: true,
      historyOnUnavailable: true
    });
  }

  private async startAgentSession(
    nodeId: string,
    cols: number,
    rows: number,
    requestedProvider: AgentProviderKind | undefined,
    resumeRequested: boolean,
    options: StartExecutionSessionOptions = {}
  ): Promise<void> {
    const normalizedCols = normalizeTerminalCols(cols);
    const normalizedRows = normalizeTerminalRows(rows);
    this.recordDiagnosticEvent('execution/startRequested', {
      kind: 'agent',
      nodeId,
      provider: requestedProvider ?? null,
      resumeRequested,
      cols: normalizedCols,
      rows: normalizedRows,
      workspaceTrusted: vscode.workspace.isTrusted
    });

    if (!options.bypassTrust && !this.assertExecutionAllowed('当前 workspace 未受信任，已禁止 Agent 运行。')) {
      const blockedNode = this.state.nodes.find((node) => node.id === nodeId && node.kind === 'agent');
      if (blockedNode) {
        this.state = updateAgentNode(this.state, nodeId, {
          status: 'idle',
          summary: defaultSummaryForKind('agent'),
          metadata: buildAgentMetadataPatch(this.state, nodeId, {
            lifecycle: 'idle',
            pendingLaunch: undefined,
            liveSession: false
          })
        });
        this.persistState();
        this.postState('host/stateUpdated');
      }
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

    const currentMetadata = ensureAgentMetadata(agentNode);
    const provider = requestedProvider ?? currentMetadata.provider;
    const launchMode: PendingExecutionLaunch = resumeRequested ? 'resume' : 'start';
    const configuredCliSpec = this.getConfiguredAgentCliSpec(provider);
    let cliSpec = configuredCliSpec;
    const resumeContext = this.resolveAgentResumeContext(nodeId, provider, launchMode, currentMetadata);
    const lifecycleStatus: AgentNodeStatus = launchMode === 'resume' ? 'resuming' : 'starting';
    if (this.isRuntimePersistenceEnabled()) {
      try {
        cliSpec = await this.resolveAgentCli(provider);
        await this.startAgentSessionWithSupervisor(
          nodeId,
          normalizedCols,
          normalizedRows,
          provider,
          cliSpec,
          resumeContext,
          launchMode
        );
      } catch (error) {
        const message =
          launchMode === 'resume'
            ? describeAgentResumeSpawnError(cliSpec, error)
            : describeAgentSessionSpawnError(cliSpec, error);
        this.recordDiagnosticEvent('execution/spawnError', {
          kind: 'agent',
          nodeId,
          provider,
          launchMode,
          cols: normalizedCols,
          rows: normalizedRows,
          message
        });
        this.state = updateAgentNode(this.state, nodeId, {
          status: launchMode === 'resume' ? 'resume-failed' : 'error',
          summary: message,
          metadata: buildAgentMetadataPatch(this.state, nodeId, {
            provider,
            lifecycle: launchMode === 'resume' ? 'resume-failed' : 'error',
            runtimeKind: 'pty-cli',
            resumeSupported: resumeContext.supported,
            resumeStrategy: resumeContext.strategy,
            resumeSessionId: resumeContext.sessionId,
            resumeStoragePath: resumeContext.storagePath,
            lastResumeError: launchMode === 'resume' ? message : undefined,
            persistenceMode: 'live-runtime',
            attachmentState: 'history-restored',
            runtimeBackend: currentMetadata.runtimeBackend,
            runtimeGuarantee: currentMetadata.runtimeGuarantee,
            runtimeStoragePath: currentMetadata.runtimeStoragePath,
            liveSession: false,
            runtimeSessionId: undefined,
            shellPath: cliSpec.command,
            cwd: this.getTerminalWorkingDirectory(),
            lastExitMessage: message,
            lastCols: normalizedCols,
            lastRows: normalizedRows,
            serializedTerminalState: undefined,
            lastBackendLabel: cliSpec.label,
            lastRuntimeError: message
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
      return;
    }
    const cwd = this.getTerminalWorkingDirectory();
    const sessionId = createExecutionSessionId(nodeId, 'agent');

    try {
      cliSpec = await this.resolveAgentCli(provider);
      const process = createExecutionSessionProcess(
        this.buildAgentLaunchSpec(cliSpec, cwd, normalizedCols, normalizedRows, launchMode, resumeContext)
      );

      const session: LocalExecutionSession = {
        sessionId,
        owner: 'local',
        startedAtMs: Date.now(),
        process,
        shellPath: cliSpec.command,
        cwd,
        cols: normalizedCols,
        rows: normalizedRows,
        buffer: '',
        terminalStateTracker: new SerializedTerminalStateTracker(normalizedCols, normalizedRows, {
          scrollback: this.getTerminalScrollback()
        }),
        lineContextTracker: this.createExecutionTerminalLineContextTracker(
          normalizedCols,
          normalizedRows,
          cliSpec.command,
          cwd,
          this.getTerminalScrollback()
        ),
        stopRequested: false,
        syncTimer: undefined,
        syncDueAtMs: undefined,
        lifecycleTimer: undefined,
        pendingOutput: '',
        outputFlushTimer: undefined,
        displayLabel: cliSpec.label,
        lifecycleStatus,
        launchMode,
        resumePhaseActive: launchMode === 'resume',
        agentProvider: provider,
        agentResume: resumeContext,
        agentActivity: createAgentActivityHeuristicState(),
        outputSubscription: undefined,
        exitSubscription: undefined
      };
      activeSessions.set(nodeId, session);
      this.recordDiagnosticEvent('execution/started', {
        kind: 'agent',
        nodeId,
        sessionId,
        provider,
        launchMode,
        cols: normalizedCols,
        rows: normalizedRows,
        shellPath: cliSpec.command,
        cwd,
        resumeStrategy: resumeContext.strategy,
        resumeSessionId: resumeContext.sessionId ?? null,
        resumeStoragePath: resumeContext.storagePath ?? null
      });

      this.state = updateAgentNode(this.state, nodeId, {
        status: lifecycleStatus,
        summary: summarizeAgentSessionOutput('', lifecycleStatus, cliSpec.label),
        metadata: buildAgentMetadataPatch(this.state, nodeId, {
          provider,
          lifecycle: lifecycleStatus,
          runtimeKind: 'pty-cli',
          resumeSupported: resumeContext.supported,
          resumeStrategy: resumeContext.strategy,
          resumeSessionId: resumeContext.sessionId,
          resumeStoragePath: resumeContext.storagePath,
          lastResumeError: undefined,
          persistenceMode: 'snapshot-only',
          attachmentState: 'attached-live',
          runtimeBackend: undefined,
          runtimeGuarantee: undefined,
          runtimeStoragePath: undefined,
          liveSession: true,
          runtimeSessionId: undefined,
          pendingLaunch: undefined,
          shellPath: cliSpec.command,
          cwd,
          recentOutput: undefined,
          lastExitCode: undefined,
          lastExitSignal: undefined,
          lastExitMessage: undefined,
          lastCols: normalizedCols,
          lastRows: normalizedRows,
          serializedTerminalState: undefined,
          lastBackendLabel: cliSpec.label
        })
      });
      this.persistState();
      this.postState('host/stateUpdated');
      this.postExecutionSnapshot('agent', nodeId);
      void this.maybeDiscoverCodexResumeSessionId(nodeId, session);

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
        activeSession.terminalStateTracker.write(text);
        activeSession.lineContextTracker.write(text);
        if (
          activeSession.lifecycleStatus === 'starting' ||
          activeSession.lifecycleStatus === 'resuming' ||
          activeSession.lifecycleStatus === 'running'
        ) {
          this.recordAgentOutputActivity(nodeId, activeSession, text);
        }
        this.queueExecutionStateSync('agent', nodeId);
        this.queueExecutionOutput('agent', nodeId, text);
      };

      const finalize = (
        status: 'stopped' | 'error' | 'resume-failed',
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
        activeSession.syncDueAtMs = undefined;
        if (activeSession.lifecycleTimer) {
          clearTimeout(activeSession.lifecycleTimer);
          activeSession.lifecycleTimer = undefined;
        }
        activeSession.outputSubscription?.dispose();
        activeSession.exitSubscription?.dispose();
        this.flushExecutionOutputImmediately('agent', nodeId);

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
          message,
          launchMode: activeSession.launchMode
        });
        this.state = updateAgentNode(this.state, nodeId, {
          status,
          summary: message,
          metadata: buildAgentMetadataPatch(this.state, nodeId, {
            provider,
            lifecycle: status,
            runtimeKind: 'pty-cli',
            resumeSupported: activeSession.agentResume?.supported ?? resumeContext.supported,
            resumeStrategy: activeSession.agentResume?.strategy ?? resumeContext.strategy,
            resumeSessionId: activeSession.agentResume?.sessionId ?? resumeContext.sessionId,
            resumeStoragePath: activeSession.agentResume?.storagePath ?? resumeContext.storagePath,
            lastResumeError: status === 'resume-failed' ? message : undefined,
            persistenceMode: 'snapshot-only',
            attachmentState: 'history-restored',
            runtimeBackend: undefined,
            runtimeGuarantee: undefined,
            runtimeStoragePath: undefined,
            liveSession: false,
            runtimeSessionId: undefined,
            pendingLaunch: undefined,
            shellPath: activeSession.shellPath,
            cwd: activeSession.cwd,
            recentOutput: recentOutput || undefined,
            lastExitCode: exitCode,
            lastExitSignal: signal ?? undefined,
            lastExitMessage: message,
            lastCols: activeSession.cols,
            lastRows: activeSession.rows,
            serializedTerminalState: activeSession.terminalStateTracker.getSerializedState(),
            lastBackendLabel: cliSpec.label
          })
        });
        this.disposeManagedExecutionSession(activeSession);
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
        if (status === 'error' || status === 'resume-failed') {
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
          finalize('stopped', `已停止 ${cliSpec.label} 会话。`, exitCode, signal);
          return;
        }

        if (exitCode === 0) {
          finalize('stopped', `${cliSpec.label} 会话已结束。`, exitCode, signal);
          return;
        }

        const cleanedOutput = stripTerminalControlSequences(session.buffer);
        if (session.resumePhaseActive) {
          finalize(
            'resume-failed',
            describeAgentResumeFailure(cliSpec, exitCode, signal, cleanedOutput),
            exitCode,
            signal
          );
          return;
        }

        finalize(
          'error',
          describeAgentSessionExit(cliSpec, exitCode, signal, cleanedOutput),
          exitCode,
          signal
        );
      });
    } catch (error) {
      const message =
        launchMode === 'resume'
          ? describeAgentResumeSpawnError(cliSpec, error)
          : describeAgentSessionSpawnError(cliSpec, error);
      this.recordDiagnosticEvent('execution/spawnError', {
        kind: 'agent',
        nodeId,
        provider,
        launchMode,
        cols: normalizedCols,
        rows: normalizedRows,
        message
      });
      this.state = updateAgentNode(this.state, nodeId, {
        status: launchMode === 'resume' ? 'resume-failed' : 'error',
        summary: message,
        metadata: buildAgentMetadataPatch(this.state, nodeId, {
          provider,
          lifecycle: launchMode === 'resume' ? 'resume-failed' : 'error',
          runtimeKind: 'pty-cli',
          resumeSupported: resumeContext.supported,
          resumeStrategy: resumeContext.strategy,
          resumeSessionId: resumeContext.sessionId,
          resumeStoragePath: resumeContext.storagePath,
          lastResumeError: launchMode === 'resume' ? message : undefined,
          persistenceMode: 'snapshot-only',
          attachmentState: 'history-restored',
          runtimeBackend: undefined,
          runtimeGuarantee: undefined,
          runtimeStoragePath: undefined,
          liveSession: false,
          runtimeSessionId: undefined,
          pendingLaunch: undefined,
          shellPath: cliSpec.command,
          cwd,
          lastExitMessage: message,
          lastCols: normalizedCols,
          lastRows: normalizedRows,
          serializedTerminalState: undefined,
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

  private getConfiguredAgentCliSpec(provider: AgentProviderKind): AgentCliSpec {
    const configuration = this.getAgentCliConfig();
    const label = provider === 'claude' ? 'Claude Code' : 'Codex';
    const requestedCommand = provider === 'claude' ? configuration.claudeCommand : configuration.codexCommand;
    return {
      provider,
      label,
      requestedCommand,
      command: requestedCommand,
      resolutionSource: 'path-env'
    };
  }

  private getAgentCliResolutionCacheKey(
    provider: AgentProviderKind,
    requestedCommand: string,
    workspaceCwd?: string
  ): string {
    const normalizedCommand =
      process.platform === 'win32' ? requestedCommand.trim().toLowerCase() : requestedCommand.trim();
    if (!isExplicitRelativePath(requestedCommand.trim())) {
      return `${process.platform}:${provider}:${normalizedCommand}`;
    }

    const normalizedWorkspaceCwd = normalizeAgentCliCacheWorkspaceCwd(workspaceCwd);
    return `${process.platform}:${provider}:${normalizedWorkspaceCwd}:${normalizedCommand}`;
  }

  private getCachedAgentCliResolution(
    provider: AgentProviderKind,
    requestedCommand: string,
    workspaceCwd?: string
  ): string | undefined {
    return this.agentCliResolutionCache[
      this.getAgentCliResolutionCacheKey(provider, requestedCommand, workspaceCwd)
    ]?.resolvedCommand;
  }

  private storeAgentCliResolution(
    provider: AgentProviderKind,
    requestedCommand: string,
    resolvedCommand: string,
    workspaceCwd?: string
  ): void {
    this.agentCliResolutionCache[this.getAgentCliResolutionCacheKey(provider, requestedCommand, workspaceCwd)] = {
      requestedCommand,
      resolvedCommand
    };
    void this.context.globalState.update(AGENT_CLI_RESOLUTION_CACHE_KEY, this.agentCliResolutionCache);
  }

  private clearAgentCliResolution(
    provider: AgentProviderKind,
    requestedCommand: string,
    workspaceCwd?: string
  ): void {
    delete this.agentCliResolutionCache[
      this.getAgentCliResolutionCacheKey(provider, requestedCommand, workspaceCwd)
    ];
    void this.context.globalState.update(AGENT_CLI_RESOLUTION_CACHE_KEY, this.agentCliResolutionCache);
  }

  private async resolveAgentCli(provider: AgentProviderKind): Promise<AgentCliSpec> {
    const configuredSpec = this.getConfiguredAgentCliSpec(provider);
    const workspaceCwd = this.getTerminalWorkingDirectory();

    try {
      const resolution = await resolveAgentCliCommand({
        provider,
        label: configuredSpec.label,
        requestedCommand: configuredSpec.requestedCommand,
        workspaceCwd,
        env: this.buildExecutionEnvironment(),
        cachedResolvedCommand: this.getCachedAgentCliResolution(
          provider,
          configuredSpec.requestedCommand,
          workspaceCwd
        )
      });
      this.storeAgentCliResolution(
        provider,
        configuredSpec.requestedCommand,
        resolution.resolvedCommand,
        workspaceCwd
      );
      this.recordDiagnosticEvent('agentCli/commandResolved', {
        provider,
        requestedCommand: resolution.requestedCommand,
        resolvedCommand: resolution.resolvedCommand,
        source: resolution.source
      });

      return {
        provider,
        label: configuredSpec.label,
        requestedCommand: resolution.requestedCommand,
        command: resolution.resolvedCommand,
        resolutionSource: resolution.source
      };
    } catch (error) {
      this.clearAgentCliResolution(provider, configuredSpec.requestedCommand, workspaceCwd);
      if (isAgentCliResolutionError(error)) {
        this.recordDiagnosticEvent('agentCli/commandResolutionFailed', {
          provider,
          requestedCommand: configuredSpec.requestedCommand,
          attempts: error.attempts
        });
      }
      throw error;
    }
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
    spec: AgentCliSpec,
    cwd: string,
    cols: number,
    rows: number,
    launchMode: PendingExecutionLaunch,
    resumeContext: AgentResumeContext
  ): ExecutionSessionLaunchSpec {
    const env = this.buildExecutionEnvironment();
    const args: string[] = [];

    if (resumeContext.strategy === 'fake-provider') {
      if (resumeContext.sessionId) {
        env.DEV_SESSION_CANVAS_FAKE_PROVIDER_SESSION_ID = resumeContext.sessionId;
      }
      if (resumeContext.storagePath) {
        env[FAKE_PROVIDER_STORAGE_PATH_ENV_KEY] = resumeContext.storagePath;
      }
      if (launchMode === 'resume') {
        args.push('resume');
        if (resumeContext.sessionId) {
          args.push(resumeContext.sessionId);
        }
      }
    } else if (spec.provider === 'claude') {
      if (launchMode === 'resume' && resumeContext.sessionId) {
        args.push('--resume', resumeContext.sessionId);
      } else if (resumeContext.sessionId) {
        args.push('--session-id', resumeContext.sessionId);
      }
    } else if (launchMode === 'resume') {
      if (!resumeContext.sessionId) {
        throw new Error('缺少可恢复的 Codex 会话标识。');
      }
      args.push('resume', resumeContext.sessionId);
    }

    return {
      file: spec.command,
      args,
      cwd,
      cols,
      rows,
      env
    };
  }

  private async startTerminalSession(
    nodeId: string,
    cols: number,
    rows: number,
    options: StartExecutionSessionOptions = {}
  ): Promise<void> {
    const normalizedCols = normalizeTerminalCols(cols);
    const normalizedRows = normalizeTerminalRows(rows);
    this.recordDiagnosticEvent('execution/startRequested', {
      kind: 'terminal',
      nodeId,
      cols: normalizedCols,
      rows: normalizedRows,
      workspaceTrusted: vscode.workspace.isTrusted
    });

    if (!options.bypassTrust && !this.assertExecutionAllowed('当前 workspace 未受信任，已禁止终端操作。')) {
      const blockedNode = this.state.nodes.find((node) => node.id === nodeId && node.kind === 'terminal');
      if (blockedNode) {
        this.state = updateTerminalNode(this.state, nodeId, {
          status: 'idle',
          summary: defaultSummaryForKind('terminal'),
          metadata: buildTerminalMetadataPatch(this.state, nodeId, {
            lifecycle: 'idle',
            pendingLaunch: undefined,
            liveSession: false
          })
        });
        this.persistState();
        this.postState('host/stateUpdated');
      }
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
    const currentMetadata = ensureTerminalMetadata(terminalNode);
    if (this.isRuntimePersistenceEnabled()) {
      try {
        await this.startTerminalSessionWithSupervisor(nodeId, normalizedCols, normalizedRows);
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
            lifecycle: 'error',
            persistenceMode: 'live-runtime',
            attachmentState: 'history-restored',
            runtimeBackend: currentMetadata.runtimeBackend,
            runtimeGuarantee: currentMetadata.runtimeGuarantee,
            runtimeStoragePath: currentMetadata.runtimeStoragePath,
            liveSession: false,
            runtimeSessionId: undefined,
            shellPath,
            cwd,
            lastExitMessage: message,
            lastCols: normalizedCols,
            lastRows: normalizedRows,
            lastRuntimeError: message,
            serializedTerminalState: undefined
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
      return;
    }
    const sessionId = createExecutionSessionId(nodeId, 'terminal');

    try {
      const process = createExecutionSessionProcess(
        this.buildTerminalLaunchSpec(shellPath, cwd, normalizedCols, normalizedRows)
      );

      const session: LocalExecutionSession = {
        sessionId,
        owner: 'local',
        startedAtMs: Date.now(),
        process,
        shellPath,
        cwd,
        cols: normalizedCols,
        rows: normalizedRows,
        buffer: '',
        terminalStateTracker: new SerializedTerminalStateTracker(normalizedCols, normalizedRows, {
          scrollback: this.getTerminalScrollback()
        }),
        lineContextTracker: this.createExecutionTerminalLineContextTracker(
          normalizedCols,
          normalizedRows,
          shellPath,
          cwd,
          this.getTerminalScrollback()
        ),
        stopRequested: false,
        syncTimer: undefined,
        syncDueAtMs: undefined,
        lifecycleTimer: undefined,
        pendingOutput: '',
        outputFlushTimer: undefined,
        displayLabel: shellPath,
        lifecycleStatus: 'launching',
        launchMode: 'start',
        resumePhaseActive: false,
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
        status: 'launching',
        summary: summarizeEmbeddedTerminalOutput('', 'launching'),
        metadata: buildTerminalMetadataPatch(this.state, nodeId, {
          lifecycle: 'launching',
          persistenceMode: 'snapshot-only',
          attachmentState: 'attached-live',
          runtimeBackend: undefined,
          runtimeGuarantee: undefined,
          runtimeStoragePath: undefined,
          liveSession: true,
          runtimeSessionId: undefined,
          pendingLaunch: undefined,
          shellPath,
          cwd,
          lastCols: normalizedCols,
          lastRows: normalizedRows,
          recentOutput: undefined,
          lastExitCode: undefined,
          lastExitSignal: undefined,
          lastExitMessage: undefined,
          serializedTerminalState: undefined
        })
      });
      this.persistState();
      this.postState('host/stateUpdated');
      this.postExecutionSnapshot('terminal', nodeId);

      session.lifecycleTimer = setTimeout(() => {
        const activeSession = this.terminalSessions.get(nodeId);
        if (!activeSession || activeSession.lifecycleStatus !== 'launching') {
          return;
        }

        activeSession.lifecycleTimer = undefined;
        activeSession.lifecycleStatus = 'live';
        this.flushLiveExecutionState('terminal', nodeId);
      }, 160);

      const handleTerminalChunk = (text: string): void => {
        const activeSession = this.terminalSessions.get(nodeId);
        if (!activeSession) {
          return;
        }

        if (!text) {
          return;
        }

        activeSession.buffer = appendTerminalBuffer(activeSession.buffer, text);
        activeSession.terminalStateTracker.write(text);
        activeSession.lineContextTracker.write(text);
        if (activeSession.lifecycleStatus === 'launching') {
          activeSession.lifecycleStatus = 'live';
        }
        this.queueExecutionStateSync('terminal', nodeId);
        this.queueExecutionOutput('terminal', nodeId, text);
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
        activeSession.syncDueAtMs = undefined;
        if (activeSession.lifecycleTimer) {
          clearTimeout(activeSession.lifecycleTimer);
          activeSession.lifecycleTimer = undefined;
        }
        activeSession.outputSubscription?.dispose();
        activeSession.exitSubscription?.dispose();
        this.flushExecutionOutputImmediately('terminal', nodeId);

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
            lifecycle: status,
            persistenceMode: 'snapshot-only',
            attachmentState: 'history-restored',
            runtimeBackend: undefined,
            runtimeGuarantee: undefined,
            runtimeStoragePath: undefined,
            liveSession: false,
            runtimeSessionId: undefined,
            pendingLaunch: undefined,
            shellPath: activeSession.shellPath,
            cwd: activeSession.cwd,
            recentOutput: recentOutput || undefined,
            lastExitCode: exitCode,
            lastExitSignal: signal ?? undefined,
            lastExitMessage: message,
            lastCols: activeSession.cols,
            lastRows: activeSession.rows,
            serializedTerminalState: activeSession.terminalStateTracker.getSerializedState()
          })
        });
        this.disposeManagedExecutionSession(activeSession);
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
          lifecycle: 'error',
          persistenceMode: 'snapshot-only',
          attachmentState: 'history-restored',
          runtimeBackend: undefined,
          runtimeGuarantee: undefined,
          runtimeStoragePath: undefined,
          liveSession: false,
          runtimeSessionId: undefined,
          pendingLaunch: undefined,
          shellPath,
          cwd,
          lastExitMessage: message,
          lastCols: normalizedCols,
          lastRows: normalizedRows,
          serializedTerminalState: undefined
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

  private getExecutionSessions(kind: ExecutionNodeKind): Map<string, ManagedExecutionSession> {
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

    const metadata = kind === 'agent' ? ensureAgentMetadata(node) : ensureTerminalMetadata(node);
    if (
      !this.getExecutionSessions(kind).has(nodeId) &&
      metadata.persistenceMode === 'live-runtime' &&
      metadata.runtimeSessionId &&
      metadata.attachmentState === 'reattaching' &&
      this.getLiveRuntimeReconnectBlockReason() === undefined
    ) {
      const backendKind = normalizeRuntimeHostBackendKind(metadata.runtimeBackend) ?? 'legacy-detached';
      const runtimeSessionId = metadata.runtimeSessionId as string;
      const operation = this.attachPersistedRuntimeSession(kind, nodeId, runtimeSessionId, () =>
        this.getRuntimeSupervisorClientForKind(
          backendKind,
          {},
          this.getPersistedRuntimeStoragePath(metadata)
        ).then((client) =>
          client.attachSession({
            sessionId: runtimeSessionId
          })
        )
      );
      this.trackRuntimeSupervisorOperation(operation);
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

    if (kind === 'agent') {
      const submittedInstruction = isAgentInstructionSubmission(data);
      if (session.lifecycleTimer) {
        clearTimeout(session.lifecycleTimer);
        session.lifecycleTimer = undefined;
      }
      if (submittedInstruction) {
        resetAgentActivityHeuristics(this.ensureAgentActivityState(session));
        session.lifecycleStatus = 'running';
        session.resumePhaseActive = false;
        this.queueExecutionStateSync('agent', nodeId, EXECUTION_INTERACTION_STATE_SYNC_INTERVAL_MS);
      }
    } else if (session.lifecycleStatus === 'launching') {
      session.lifecycleStatus = 'live';
      this.queueExecutionStateSync('terminal', nodeId, EXECUTION_INTERACTION_STATE_SYNC_INTERVAL_MS);
    }

    if (kind === 'terminal') {
      session.lineContextTracker.recordInput(data);
    }
    if (session.owner === 'local') {
      session.process.write(data);
    } else {
      const backendKind = normalizeRuntimeHostBackendKind(session.runtimeBackend) ?? 'legacy-detached';
      this.trackRuntimeSupervisorOperation(
        this.getRuntimeSupervisorClientForKind(backendKind, {}, session.runtimeStoragePath)
          .then((client) =>
            client.writeInput({
              sessionId: session.runtimeSessionId,
              data
            })
          )
          .catch((error) => {
            this.postMessage({
              type: 'host/error',
              payload: {
                message: error instanceof Error ? error.message : '向 live runtime 写入输入失败。'
              }
            });
          })
      );
    }
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
    session.terminalStateTracker.resize(normalizedCols, normalizedRows);
    session.lineContextTracker.resize(normalizedCols, normalizedRows);
    if (session.owner === 'local') {
      session.process.resize(normalizedCols, normalizedRows);
    } else {
      const backendKind = normalizeRuntimeHostBackendKind(session.runtimeBackend) ?? 'legacy-detached';
      this.trackRuntimeSupervisorOperation(
        this.getRuntimeSupervisorClientForKind(backendKind, {}, session.runtimeStoragePath)
          .then((client) =>
            client.resizeSession({
              sessionId: session.runtimeSessionId,
              cols: normalizedCols,
              rows: normalizedRows
            })
          )
          .catch((error) => {
            this.postMessage({
              type: 'host/error',
              payload: {
                message: error instanceof Error ? error.message : '调整 live runtime 尺寸失败。'
              }
            });
          })
      );
    }
    this.queueExecutionStateSync(kind, nodeId, EXECUTION_INTERACTION_STATE_SYNC_INTERVAL_MS);
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
    session.lifecycleStatus = kind === 'agent' ? 'stopping' : 'stopping';
    if (session.lifecycleTimer) {
      clearTimeout(session.lifecycleTimer);
      session.lifecycleTimer = undefined;
    }
    this.flushLiveExecutionState(kind, nodeId);
    if (session.owner === 'local') {
      session.process.kill();
      return;
    }

    try {
      const backendKind = normalizeRuntimeHostBackendKind(session.runtimeBackend) ?? 'legacy-detached';
      const client = await this.getRuntimeSupervisorClientForKind(
        backendKind,
        {},
        session.runtimeStoragePath
      );
      await client.stopSession({
        sessionId: session.runtimeSessionId
      });
    } catch (error) {
      this.postMessage({
        type: 'host/error',
        payload: {
          message: error instanceof Error ? error.message : '停止 live runtime 失败。'
        }
      });
    }
  }

  private async terminateExecutionNodeForDeletion(node: CanvasNodeSummary): Promise<void> {
    if (!isExecutionNodeKind(node.kind)) {
      return;
    }

    const attachedSession = this.getExecutionSessions(node.kind).get(node.id);
    if (attachedSession?.owner === 'local') {
      await this.flushExecutionStateImmediately(node.kind, node.id);
      this.disposeExecutionSession(node.kind, node.id, {
        terminateProcess: true
      });
      return;
    }

    if (attachedSession?.owner === 'supervisor') {
      const backendKind = normalizeRuntimeHostBackendKind(attachedSession.runtimeBackend) ?? 'legacy-detached';
      await this.deleteRuntimeSupervisorSessionStrict(
        {
          backendKind,
          sessionId: attachedSession.runtimeSessionId,
          runtimeStoragePath: attachedSession.runtimeStoragePath
        },
        {
          allowRestart: true
        }
      );
      this.disposeExecutionSession(node.kind, node.id, {
        terminateProcess: false
      });
      return;
    }

    const persistedRuntimeSession = this.getPersistedLiveRuntimeSessionForNode(node);
    if (!persistedRuntimeSession) {
      return;
    }

    await this.deleteRuntimeSupervisorSessionStrict(persistedRuntimeSession, {
      allowRestart: true
    });
    this.unbindRuntimeSession(
      persistedRuntimeSession.sessionId,
      persistedRuntimeSession.runtimeStoragePath
    );
  }

  private async deleteNode(nodeId: string): Promise<void> {
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
      this.invalidateExecutionSessionOperation(node.kind, nodeId);
      try {
        await this.terminateExecutionNodeForDeletion(node);
      } catch (error) {
        this.postMessage({
          type: 'host/error',
          payload: {
            message: error instanceof Error ? error.message : '删除执行节点时清理 live runtime 失败。'
          }
        });
        return;
      }
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
    this.invalidateExecutionSessionOperation(kind, nodeId);
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
    session.syncDueAtMs = undefined;
    if (session.lifecycleTimer) {
      clearTimeout(session.lifecycleTimer);
      session.lifecycleTimer = undefined;
    }
    if (session.outputFlushTimer) {
      clearTimeout(session.outputFlushTimer);
      session.outputFlushTimer = undefined;
    }
    session.pendingOutput = '';

    session.outputSubscription?.dispose();
    session.exitSubscription?.dispose();
    sessionMap.delete(nodeId);
    this.disposeManagedExecutionSession(session);

    if (session.owner === 'supervisor') {
      this.unbindRuntimeSession(session.runtimeSessionId, session.runtimeStoragePath);
      if (options.terminateProcess) {
        const backendKind = normalizeRuntimeHostBackendKind(session.runtimeBackend) ?? 'legacy-detached';
        this.trackRuntimeSupervisorOperation(
          this.getRuntimeSupervisorClientForKind(backendKind, {}, session.runtimeStoragePath)
            .then((client) =>
              client.deleteSession({
                sessionId: session.runtimeSessionId
              })
            )
            .catch(() => {
              // Best effort only during dispose paths.
            })
        );
      }
      return;
    }

    if (options.terminateProcess) {
      session.process.kill();
    }
  }

  private queueExecutionOutput(kind: ExecutionNodeKind, nodeId: string, chunk: string): void {
    const session = this.getExecutionSessions(kind).get(nodeId);
    if (!session || !chunk) {
      return;
    }

    session.pendingOutput += chunk;
    if (session.outputFlushTimer) {
      return;
    }

    session.outputFlushTimer = setTimeout(() => {
      const activeSession = this.getExecutionSessions(kind).get(nodeId);
      if (!activeSession) {
        return;
      }

      const pendingOutput = this.takePendingExecutionOutput(activeSession);
      if (!pendingOutput) {
        return;
      }

      this.postExecutionOutput(kind, nodeId, pendingOutput);
    }, EXECUTION_OUTPUT_FLUSH_INTERVAL_MS);
  }

  private flushExecutionOutputImmediately(kind: ExecutionNodeKind, nodeId: string): void {
    const session = this.getExecutionSessions(kind).get(nodeId);
    if (!session) {
      return;
    }

    const pendingOutput = this.takePendingExecutionOutput(session);
    if (!pendingOutput) {
      return;
    }

    this.postExecutionOutput(kind, nodeId, pendingOutput);
  }

  private clearQueuedExecutionOutput(kind: ExecutionNodeKind, nodeId: string): void {
    const session = this.getExecutionSessions(kind).get(nodeId);
    if (!session) {
      return;
    }

    this.takePendingExecutionOutput(session);
  }

  private takePendingExecutionOutput(session: ManagedExecutionSession): string {
    if (session.outputFlushTimer) {
      clearTimeout(session.outputFlushTimer);
      session.outputFlushTimer = undefined;
    }

    const pendingOutput = session.pendingOutput;
    session.pendingOutput = '';
    return pendingOutput;
  }

  private postExecutionOutput(kind: ExecutionNodeKind, nodeId: string, chunk: string): void {
    this.postMessage({
      type: 'host/executionOutput',
      payload: {
        nodeId,
        kind,
        chunk
      }
    });
  }

  private queueExecutionStateSync(
    kind: ExecutionNodeKind,
    nodeId: string,
    delayMs = EXECUTION_OUTPUT_STATE_SYNC_INTERVAL_MS
  ): void {
    const session = this.getExecutionSessions(kind).get(nodeId);
    if (!session) {
      return;
    }

    const nextDelayMs = Math.max(0, delayMs);
    const dueAtMs = Date.now() + nextDelayMs;
    if (session.syncTimer) {
      if ((session.syncDueAtMs ?? dueAtMs) <= dueAtMs) {
        return;
      }

      clearTimeout(session.syncTimer);
    }

    session.syncDueAtMs = dueAtMs;
    session.syncTimer = setTimeout(() => {
      const activeSession = this.getExecutionSessions(kind).get(nodeId);
      if (!activeSession) {
        return;
      }

      activeSession.syncTimer = undefined;
      activeSession.syncDueAtMs = undefined;
      this.flushLiveExecutionState(kind, nodeId);
    }, nextDelayMs);
  }

  private flushExecutionStateSyncTimer(kind: ExecutionNodeKind, nodeId: string): void {
    const session = this.getExecutionSessions(kind).get(nodeId);
    if (!session?.syncTimer) {
      return;
    }

    clearTimeout(session.syncTimer);
    session.syncTimer = undefined;
    session.syncDueAtMs = undefined;
  }

  private async flushExecutionStateImmediately(kind: ExecutionNodeKind, nodeId: string): Promise<void> {
    if (!this.getExecutionSessions(kind).has(nodeId)) {
      return;
    }

    await this.getExecutionSessions(kind)
      .get(nodeId)
      ?.terminalStateTracker.flush()
      .catch(() => undefined);
    this.flushExecutionStateSyncTimer(kind, nodeId);
    this.flushLiveExecutionState(kind, nodeId);
  }

  private async flushAllExecutionSessionStatesForHostBoundary(): Promise<void> {
    for (const nodeId of this.agentSessions.keys()) {
      await this.flushExecutionStateImmediately('agent', nodeId);
    }
    for (const nodeId of this.terminalSessions.keys()) {
      await this.flushExecutionStateImmediately('terminal', nodeId);
    }
  }

  private flushLiveExecutionState(
    kind: ExecutionNodeKind,
    nodeId: string,
    options: { postState?: boolean } = {}
  ): void {
    const session = this.getExecutionSessions(kind).get(nodeId);
    if (!session) {
      return;
    }

    const cleanedOutput = stripTerminalControlSequences(session.buffer);
    const recentOutput = extractRecentTerminalOutput(cleanedOutput);
    this.state = updateExecutionNode(this.state, nodeId, kind, {
      status: session.lifecycleStatus,
      summary:
        kind === 'agent'
          ? summarizeAgentSessionOutput(
              cleanedOutput,
              session.lifecycleStatus as AgentNodeStatus,
              session.displayLabel
            )
          : summarizeEmbeddedTerminalOutput(cleanedOutput, session.lifecycleStatus as TerminalNodeStatus),
      metadata: buildExecutionMetadataPatch(this.state, nodeId, kind, {
        lifecycle: session.lifecycleStatus,
        persistenceMode: session.owner === 'supervisor' ? 'live-runtime' : 'snapshot-only',
        attachmentState: 'attached-live',
        ...(session.owner === 'supervisor'
          ? {
              runtimeBackend: session.runtimeBackend,
              runtimeGuarantee: session.runtimeGuarantee,
              runtimeStoragePath: session.runtimeStoragePath
            }
          : {
              runtimeStoragePath: undefined
            }),
        liveSession: true,
        runtimeSessionId: session.runtimeSessionId,
        shellPath: session.shellPath,
        cwd: session.cwd,
        recentOutput: recentOutput || undefined,
        lastCols: session.cols,
        lastRows: session.rows,
        serializedTerminalState: session.terminalStateTracker.getSerializedState(),
        lastRuntimeError: undefined,
        ...(kind === 'agent' ? { lastBackendLabel: session.displayLabel } : {}),
        ...(kind === 'agent' && session.agentResume
          ? {
              resumeSupported: session.agentResume.supported,
              resumeStrategy: session.agentResume.strategy,
              resumeSessionId: session.agentResume.sessionId,
              resumeStoragePath: session.agentResume.storagePath
            }
          : {})
      })
    });
    this.persistState();
    if (options.postState !== false) {
      this.postState('host/stateUpdated');
    }
  }

  private async postExecutionSnapshot(kind: ExecutionNodeKind, nodeId: string): Promise<void> {
    this.clearQueuedExecutionOutput(kind, nodeId);
    const session = this.getExecutionSessions(kind).get(nodeId);
    const serializedTerminalState = session
      ? await session.terminalStateTracker.flush().catch(() => session.terminalStateTracker.getSerializedState())
      : undefined;
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
        output: session?.buffer ?? metadata?.recentOutput ?? '',
        cols: session?.cols ?? metadata?.lastCols ?? DEFAULT_TERMINAL_COLS,
        rows: session?.rows ?? metadata?.lastRows ?? DEFAULT_TERMINAL_ROWS,
        liveSession: Boolean(session),
        serializedTerminalState:
          serializedTerminalState ??
          cloneSerializedTerminalState(metadata?.serializedTerminalState)
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
    options?: { bypassTrust?: boolean; agentProvider?: AgentProviderKind }
  ): void {
    if (
      isExecutionNodeKind(kind) &&
      !options?.bypassTrust &&
      !this.assertExecutionAllowed('当前 workspace 未受信任，已禁止创建 Agent / Terminal 节点。')
    ) {
      return;
    }

    const nextState = createNextState(
      this.state,
      kind,
      options?.agentProvider ?? this.getAgentCliConfig().defaultProvider,
      preferredPosition
    );
    const createdNode = nextState.nodes[nextState.nodes.length - 1];

    if (createdNode && createdNode.kind === 'agent') {
      this.state = updateAgentNode(nextState, createdNode.id, {
        status: 'starting',
        summary: '正在等待节点尺寸就绪后启动 Agent 会话。',
        metadata: buildAgentMetadataPatch(nextState, createdNode.id, {
          lifecycle: 'starting',
          pendingLaunch: 'start',
          liveSession: false,
          lastExitCode: undefined,
          lastExitSignal: undefined,
          lastExitMessage: undefined,
          recentOutput: undefined,
          lastResumeError: undefined
        })
      });
    } else if (createdNode && createdNode.kind === 'terminal') {
      this.state = updateTerminalNode(nextState, createdNode.id, {
        status: 'launching',
        summary: '正在等待节点尺寸就绪后启动嵌入式终端。',
        metadata: buildTerminalMetadataPatch(nextState, createdNode.id, {
          lifecycle: 'launching',
          pendingLaunch: 'start',
          liveSession: false,
          lastExitCode: undefined,
          lastExitSignal: undefined,
          lastExitMessage: undefined,
          recentOutput: undefined
        })
      });
    } else {
      this.state = nextState;
    }

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
    if (this.testDiagnosticEvents.length > 2000) {
      this.testDiagnosticEvents.splice(0, this.testDiagnosticEvents.length - 2000);
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

function summarizeCanvasStateForDiagnostics(rawState: unknown): Record<string, unknown> {
  if (!isRecord(rawState)) {
    return {
      stateHash: buildDiagnosticStateHash(rawState)
    };
  }

  const rawNodes = Array.isArray(rawState.nodes) ? rawState.nodes : [];
  const nodeIds = rawNodes
    .map((node) => (isRecord(node) && typeof node.id === 'string' ? node.id : undefined))
    .filter((nodeId): nodeId is string => Boolean(nodeId))
    .slice(0, 8);

  return {
    stateHash: buildDiagnosticStateHash(rawState),
    nodeCount: rawNodes.length,
    updatedAt: typeof rawState.updatedAt === 'string' ? rawState.updatedAt : undefined,
    nodeIds
  };
}

function buildDiagnosticStateHash(value: unknown): string | undefined {
  try {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 12);
  } catch {
    return undefined;
  }
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack || error.message;
  }

  return String(error);
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
  agentProvider: AgentProviderKind = 'codex',
  preferredPosition?: CanvasNodePosition
): CanvasPrototypeState {
  const nextIndex = readNextNodeSequence(previousState.nodes);
  const nextNode = createNode(kind, nextIndex, agentProvider);
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
    case 'note':
      return '等待记录笔记内容。';
  }
}

function defaultStatusForKind(kind: CanvasNodeKind): string {
  switch (kind) {
    case 'agent':
      return 'idle';
    case 'terminal':
      return 'idle';
    case 'note':
      return 'ready';
  }
}

function createNode(
  kind: CanvasNodeKind,
  sequence: number,
  agentProvider: AgentProviderKind = 'codex'
): CanvasNodeSummary {
  const titlePrefix = {
    agent: 'Agent',
    terminal: 'Terminal',
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
    metadata: createNodeMetadata(kind, id, agentProvider)
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
  position: CanvasNodePosition,
  size: CanvasNodeFootprint
): CanvasPrototypeState {
  const targetNode = previousState.nodes.find((node) => node.id === nodeId);
  if (!targetNode) {
    return previousState;
  }

  const normalizedSize = normalizeCanvasNodeFootprint(targetNode.kind, size);
  const normalizedPosition = {
    x: Math.round(position.x),
    y: Math.round(position.y)
  };
  const didChange =
    targetNode.size.width !== normalizedSize.width ||
    targetNode.size.height !== normalizedSize.height ||
    targetNode.position.x !== normalizedPosition.x ||
    targetNode.position.y !== normalizedPosition.y;

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
            position: normalizedPosition,
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

function readRuntimeSupervisorRegistrySessionsForTest(value: unknown): unknown[] {
  if (!isRecord(value)) {
    return [];
  }

  return Array.isArray(value.sessions) ? value.sessions : [];
}

function hydrateRuntimeStoragePaths(
  state: CanvasPrototypeState,
  runtimeStoragePath: string
): CanvasPrototypeState {
  const normalizedRuntimeStoragePath = normalizeRuntimeStoragePath(runtimeStoragePath);
  if (!normalizedRuntimeStoragePath) {
    return state;
  }

  let didMutate = false;
  const nodes = state.nodes.map((node) => {
    if (node.kind === 'agent') {
      const metadata = ensureAgentMetadata(node);
      if (
        metadata.persistenceMode === 'live-runtime' &&
        metadata.runtimeSessionId &&
        !normalizeRuntimeStoragePath(metadata.runtimeStoragePath)
      ) {
        didMutate = true;
        return {
          ...node,
          metadata: {
            ...node.metadata,
            agent: {
              ...metadata,
              runtimeStoragePath: normalizedRuntimeStoragePath
            }
          }
        };
      }
      return node;
    }

    if (node.kind === 'terminal') {
      const metadata = ensureTerminalMetadata(node);
      if (
        metadata.persistenceMode === 'live-runtime' &&
        metadata.runtimeSessionId &&
        !normalizeRuntimeStoragePath(metadata.runtimeStoragePath)
      ) {
        didMutate = true;
        return {
          ...node,
          metadata: {
            ...node.metadata,
            terminal: {
              ...metadata,
              runtimeStoragePath: normalizedRuntimeStoragePath
            }
          }
        };
      }
    }

    return node;
  });

  return didMutate
    ? {
        ...state,
        nodes
      }
    : state;
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
    metadata: normalizeMetadata(
      value.kind,
      value.id,
      typeof value.status === 'string' ? value.status : undefined,
      value.metadata,
      defaultAgentProvider
    )
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
  agentProvider: AgentProviderKind = 'codex'
): CanvasNodeMetadata | undefined {
  if (kind === 'agent') {
    return {
      agent: createAgentMetadata(agentProvider)
    };
  }

  if (kind === 'terminal') {
    return {
      terminal: createTerminalMetadata(nodeId)
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
    lifecycle: 'idle',
    provider,
    runtimeKind: 'pty-cli',
    resumeSupported: provider === 'claude',
    resumeStrategy: provider === 'claude' ? 'claude-session-id' : 'none',
    shellPath: defaultAgentCommand(provider),
    cwd: defaultTerminalWorkingDirectory(),
    persistenceMode: 'snapshot-only',
    attachmentState: 'history-restored',
    runtimeBackend: undefined,
    runtimeGuarantee: undefined,
    runtimeStoragePath: undefined,
    liveSession: false,
    pendingLaunch: undefined,
    lastCols: DEFAULT_TERMINAL_COLS,
    lastRows: DEFAULT_TERMINAL_ROWS,
    lastBackendLabel: agentProviderDisplayLabel(provider)
  };
}

function createTerminalMetadata(nodeId: string): TerminalNodeMetadata {
  return {
    backend: 'node-pty',
    lifecycle: 'idle',
    shellPath: defaultTerminalShellPath(),
    cwd: defaultTerminalWorkingDirectory(),
    persistenceMode: 'snapshot-only',
    attachmentState: 'history-restored',
    runtimeBackend: undefined,
    runtimeGuarantee: undefined,
    runtimeStoragePath: undefined,
    liveSession: false,
    pendingLaunch: undefined,
    lastCols: DEFAULT_TERMINAL_COLS,
    lastRows: DEFAULT_TERMINAL_ROWS
  };
}

function createNoteMetadata(): NoteNodeMetadata {
  return {
    content: ''
  };
}

function normalizePendingLaunch(value: unknown): PendingExecutionLaunch | undefined {
  if (value === 'start' || value === 'resume') {
    return value;
  }

  return value === true ? 'start' : undefined;
}

function normalizeRuntimePersistenceMode(value: unknown): RuntimePersistenceMode {
  return value === 'live-runtime' ? 'live-runtime' : 'snapshot-only';
}

function normalizeRuntimeHostBackendKind(
  value: unknown,
  options?: {
    persistenceMode?: RuntimePersistenceMode;
    liveSession?: boolean;
    runtimeSessionId?: string;
  }
): RuntimeHostBackendKind | undefined {
  if (value === 'systemd-user' || value === 'legacy-detached') {
    return value;
  }

  if (
    options?.persistenceMode === 'live-runtime' ||
    options?.liveSession ||
    Boolean(options?.runtimeSessionId)
  ) {
    return 'legacy-detached';
  }

  return undefined;
}

function normalizeRuntimePersistenceGuarantee(
  value: unknown,
  runtimeBackend: RuntimeHostBackendKind | undefined
): RuntimePersistenceGuarantee | undefined {
  if (value === 'strong' || value === 'best-effort') {
    return value;
  }

  if (runtimeBackend === 'systemd-user') {
    return 'strong';
  }

  if (runtimeBackend === 'legacy-detached') {
    return 'best-effort';
  }

  return undefined;
}

function normalizeRuntimeStoragePath(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  return normalized ? path.normalize(normalized) : undefined;
}

function normalizeRuntimeAttachmentState(
  persistenceMode: RuntimePersistenceMode,
  liveSession: boolean,
  value: unknown
): RuntimeAttachmentState {
  if (value === 'attached-live' || value === 'reattaching' || value === 'history-restored') {
    return value;
  }

  if (liveSession) {
    return 'attached-live';
  }

  return persistenceMode === 'live-runtime' ? 'history-restored' : 'history-restored';
}

function normalizeAgentLifecycle(
  nodeStatus: string | undefined,
  liveSession: boolean,
  value: unknown
): AgentNodeStatus {
  if (
    value === 'idle' ||
    value === 'starting' ||
    value === 'waiting-input' ||
    value === 'running' ||
    value === 'resuming' ||
    value === 'resume-ready' ||
    value === 'resume-failed' ||
    value === 'stopping' ||
    value === 'stopped' ||
    value === 'error' ||
    value === 'interrupted'
  ) {
    return value;
  }

  if (nodeStatus === 'resume-ready' || nodeStatus === 'resume-failed') {
    return nodeStatus;
  }

  if (nodeStatus === 'starting' || nodeStatus === 'waiting-input' || nodeStatus === 'running' || nodeStatus === 'resuming') {
    return nodeStatus;
  }

  if (nodeStatus === 'stopped' || nodeStatus === 'stopping') {
    return nodeStatus;
  }

  if (nodeStatus === 'error' || nodeStatus === 'interrupted') {
    return nodeStatus;
  }

  if (nodeStatus === 'closed') {
    return 'stopped';
  }

  if (nodeStatus === 'draft' || nodeStatus === 'idle') {
    return 'idle';
  }

  return liveSession ? 'running' : 'idle';
}

function normalizeTerminalLifecycle(
  nodeStatus: string | undefined,
  liveSession: boolean,
  value: unknown
): TerminalNodeStatus {
  if (
    value === 'idle' ||
    value === 'launching' ||
    value === 'live' ||
    value === 'stopping' ||
    value === 'closed' ||
    value === 'error' ||
    value === 'interrupted'
  ) {
    return value;
  }

  if (
    nodeStatus === 'idle' ||
    nodeStatus === 'launching' ||
    nodeStatus === 'live' ||
    nodeStatus === 'stopping' ||
    nodeStatus === 'closed' ||
    nodeStatus === 'error' ||
    nodeStatus === 'interrupted'
  ) {
    return nodeStatus;
  }

  if (nodeStatus === 'draft') {
    return 'idle';
  }

  return liveSession ? 'live' : 'idle';
}

function normalizeMetadata(
  kind: CanvasNodeKind,
  nodeId: string,
  nodeStatus: string | undefined,
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
    const liveSession =
      typeof agent.liveSession === 'boolean'
        ? agent.liveSession
        : typeof agent.liveRun === 'boolean'
          ? agent.liveRun
          : fallback.liveSession;
    const persistenceMode = normalizeRuntimePersistenceMode(agent.persistenceMode);
    const runtimeSessionId =
      typeof agent.runtimeSessionId === 'string'
        ? agent.runtimeSessionId
        : undefined;
    const runtimeBackend = normalizeRuntimeHostBackendKind(agent.runtimeBackend, {
      persistenceMode,
      liveSession,
      runtimeSessionId
    });
    const runtimeGuarantee = normalizeRuntimePersistenceGuarantee(agent.runtimeGuarantee, runtimeBackend);
    const resumeStrategy =
      agent.resumeStrategy === 'claude-session-id' ||
      agent.resumeStrategy === 'codex-session-id' ||
      agent.resumeStrategy === 'fake-provider'
        ? agent.resumeStrategy
        : fallback.resumeStrategy;
    const resumeSessionId =
      typeof agent.resumeSessionId === 'string'
        ? agent.resumeSessionId
        : undefined;
    const resumeStoragePath =
      typeof agent.resumeStoragePath === 'string'
        ? agent.resumeStoragePath
        : undefined;
    const runtimeStoragePath = normalizeRuntimeStoragePath(agent.runtimeStoragePath);
    const resumeSupported = doesAgentResumeStrategyRequireSupport(resumeStrategy);

    return {
      agent: {
        backend: 'node-pty',
        lifecycle: normalizeAgentLifecycle(
          nodeStatus,
          liveSession,
          agent.lifecycle
        ),
        provider,
        runtimeKind: 'pty-cli',
        resumeSupported,
        resumeStrategy,
        shellPath:
          typeof agent.shellPath === 'string'
            ? agent.shellPath
            : fallback.shellPath,
        cwd:
          typeof agent.cwd === 'string'
            ? agent.cwd
            : fallback.cwd,
        persistenceMode,
        attachmentState: normalizeRuntimeAttachmentState(
          persistenceMode,
          liveSession,
          agent.attachmentState
        ),
        runtimeBackend,
        runtimeGuarantee,
        runtimeStoragePath,
        liveSession,
        runtimeSessionId,
        lastRuntimeError:
          typeof agent.lastRuntimeError === 'string'
            ? trimStoredTerminalText(agent.lastRuntimeError)
            : undefined,
        pendingLaunch: normalizePendingLaunch(agent.pendingLaunch ?? agent.autoStartPending),
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
        resumeSessionId,
        resumeStoragePath,
        lastResumeError:
          typeof agent.lastResumeError === 'string'
            ? trimStoredTerminalText(agent.lastResumeError)
            : undefined,
        lastCols:
          typeof agent.lastCols === 'number'
            ? normalizeTerminalCols(agent.lastCols)
            : fallback.lastCols,
        lastRows:
          typeof agent.lastRows === 'number'
            ? normalizeTerminalRows(agent.lastRows)
            : fallback.lastRows,
        serializedTerminalState: normalizeSerializedTerminalState(agent.serializedTerminalState),
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
    const liveSession =
      typeof terminal.liveSession === 'boolean'
        ? terminal.liveSession
        : typeof terminal.liveRun === 'boolean'
          ? terminal.liveRun
          : fallback.liveSession;
    const persistenceMode = normalizeRuntimePersistenceMode(terminal.persistenceMode);
    const runtimeSessionId =
      typeof terminal.runtimeSessionId === 'string'
        ? terminal.runtimeSessionId
        : undefined;
    const runtimeBackend = normalizeRuntimeHostBackendKind(terminal.runtimeBackend, {
      persistenceMode,
      liveSession,
      runtimeSessionId
    });
    const runtimeGuarantee = normalizeRuntimePersistenceGuarantee(
      terminal.runtimeGuarantee,
      runtimeBackend
    );
    const runtimeStoragePath = normalizeRuntimeStoragePath(terminal.runtimeStoragePath);

    return {
      terminal: {
        backend: 'node-pty',
        lifecycle: normalizeTerminalLifecycle(
          nodeStatus,
          liveSession,
          terminal.lifecycle
        ),
        shellPath:
          typeof terminal.shellPath === 'string'
            ? terminal.shellPath
            : fallback.shellPath,
        cwd:
          typeof terminal.cwd === 'string'
            ? terminal.cwd
            : fallback.cwd,
        persistenceMode,
        attachmentState: normalizeRuntimeAttachmentState(
          persistenceMode,
          liveSession,
          terminal.attachmentState
        ),
        runtimeBackend,
        runtimeGuarantee,
        runtimeStoragePath,
        liveSession,
        runtimeSessionId,
        lastRuntimeError:
          typeof terminal.lastRuntimeError === 'string'
            ? trimStoredTerminalText(terminal.lastRuntimeError)
            : undefined,
        pendingLaunch: normalizePendingLaunch(terminal.pendingLaunch ?? terminal.autoStartPending),
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
            : fallback.lastRows,
        serializedTerminalState: normalizeSerializedTerminalState(terminal.serializedTerminalState)
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

interface ReconcileRuntimeOptions {
  allowLiveRuntimeReconnect: boolean;
  liveRuntimeReconnectBlockReason?: LiveRuntimeReconnectBlockReason;
}

function reconcileRuntimeNodes(
  state: CanvasPrototypeState,
  agentSessions: Map<string, ManagedExecutionSession> = new Map(),
  terminalSessions: Map<string, ManagedExecutionSession> = new Map(),
  options: ReconcileRuntimeOptions = {
    allowLiveRuntimeReconnect: true
  }
): CanvasPrototypeState {
  return {
    ...state,
    nodes: reconcileRuntimeNodesInArray(state.nodes, agentSessions, terminalSessions, options)
  };
}

function reconcileRuntimeNodesInArray(
  nodes: CanvasNodeSummary[],
  agentSessions: Map<string, ManagedExecutionSession> = new Map(),
  terminalSessions: Map<string, ManagedExecutionSession> = new Map(),
  options: ReconcileRuntimeOptions = {
    allowLiveRuntimeReconnect: true
  }
): CanvasNodeSummary[] {
  return reconcileNoteNodesInArray(
    reconcileAgentNodesInArray(
      reconcileTerminalNodesInArray(nodes, terminalSessions, options),
      agentSessions,
      options
    )
  );
}

function reconcileAgentNodesInArray(
  nodes: CanvasNodeSummary[],
  agentSessions: Map<string, ManagedExecutionSession> = new Map(),
  options: ReconcileRuntimeOptions = {
    allowLiveRuntimeReconnect: true
  }
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
        status: liveSession.lifecycleStatus,
        summary: summarizeAgentSessionOutput(
          cleanedOutput,
          liveSession.lifecycleStatus as AgentNodeStatus,
          liveSession.displayLabel
        ),
        metadata: {
          ...node.metadata,
          agent: {
            ...metadata,
            lifecycle: liveSession.lifecycleStatus as AgentNodeStatus,
            persistenceMode: liveSession.owner === 'supervisor' ? 'live-runtime' : 'snapshot-only',
            attachmentState: 'attached-live',
            ...(liveSession.owner === 'supervisor'
              ? {
                  runtimeBackend: liveSession.runtimeBackend,
                  runtimeGuarantee: liveSession.runtimeGuarantee,
                  runtimeStoragePath: liveSession.runtimeStoragePath
                }
              : {
                  runtimeBackend: undefined,
                  runtimeGuarantee: undefined,
                  runtimeStoragePath: undefined
                }),
            liveSession: true,
            runtimeSessionId: liveSession.runtimeSessionId,
            pendingLaunch: undefined,
            shellPath: liveSession.shellPath,
            cwd: liveSession.cwd,
            recentOutput: recentOutput || metadata.recentOutput,
            lastCols: liveSession.cols,
            lastRows: liveSession.rows,
            serializedTerminalState: liveSession.terminalStateTracker.getSerializedState(),
            lastBackendLabel: liveSession.displayLabel
          }
        }
      };
    }

    if (
      metadata.persistenceMode === 'live-runtime' &&
      metadata.runtimeSessionId &&
      (metadata.liveSession || metadata.attachmentState === 'reattaching')
    ) {
      if (!options.allowLiveRuntimeReconnect) {
        const liveRuntimeReconnectBlockReason =
          options.liveRuntimeReconnectBlockReason ?? 'runtime-persistence-disabled';
        return {
          ...node,
          status: 'history-restored',
          summary: describeBlockedAgentLiveRuntimeSummary(liveRuntimeReconnectBlockReason),
          metadata: {
            ...node.metadata,
            agent: {
              ...metadata,
              attachmentState:
                liveRuntimeReconnectBlockReason === 'workspace-untrusted'
                  ? 'reattaching'
                  : 'history-restored',
              liveSession: false,
              pendingLaunch: undefined
            }
          }
        };
      }

      return {
        ...node,
        status: 'reattaching',
        summary: '正在重新连接原 Agent live runtime。',
        metadata: {
          ...node.metadata,
          agent: {
            ...metadata,
            attachmentState: 'reattaching',
            liveSession: false,
            pendingLaunch: undefined
          }
        }
      };
    }

    if (metadata.liveSession) {
      const canResume = canResumeAgentFromMetadata(metadata);
      return {
        ...node,
        status: canResume ? 'resume-ready' : 'interrupted',
        summary: canResume ? '检测到可恢复的 Agent 会话，正在等待恢复。' : '上一次 Agent 会话在扩展重载后未恢复，可重新启动。',
        metadata: {
          ...node.metadata,
          agent: {
            ...metadata,
            lifecycle: canResume ? 'resume-ready' : 'interrupted',
            liveSession: false,
            pendingLaunch: canResume ? 'resume' : undefined
          }
        }
      };
    }

    if (metadata.persistenceMode === 'live-runtime' && metadata.attachmentState === 'history-restored') {
      if (metadata.pendingLaunch === 'resume' && canResumeAgentFromMetadata(metadata)) {
        return {
          ...node,
          status: 'resume-ready',
          summary: '检测到可恢复的 Agent 会话，正在等待恢复。',
          metadata: {
            ...node.metadata,
            agent: {
              ...metadata,
              lifecycle: 'resume-ready',
              liveSession: false
            }
          }
        };
      }

      return {
        ...node,
        status: 'history-restored',
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
        status: 'idle',
        summary: defaultSummaryForKind('agent'),
        metadata: {
          ...node.metadata,
          agent: {
            ...metadata,
            lifecycle: 'idle',
            pendingLaunch: undefined
          }
        }
      };
    }

    return {
      ...node,
      status: metadata.lifecycle,
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
  terminalSessions: Map<string, ManagedExecutionSession> = new Map(),
  options: ReconcileRuntimeOptions = {
    allowLiveRuntimeReconnect: true
  }
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
        status: liveSession.lifecycleStatus,
        summary: summarizeEmbeddedTerminalOutput(
          cleanedOutput,
          liveSession.lifecycleStatus as TerminalNodeStatus
        ),
        metadata: {
          terminal: {
            ...metadata,
            lifecycle: liveSession.lifecycleStatus as TerminalNodeStatus,
            persistenceMode: liveSession.owner === 'supervisor' ? 'live-runtime' : 'snapshot-only',
            attachmentState: 'attached-live',
            ...(liveSession.owner === 'supervisor'
              ? {
                  runtimeBackend: liveSession.runtimeBackend,
                  runtimeGuarantee: liveSession.runtimeGuarantee,
                  runtimeStoragePath: liveSession.runtimeStoragePath
                }
              : {
                  runtimeBackend: undefined,
                  runtimeGuarantee: undefined,
                  runtimeStoragePath: undefined
                }),
            liveSession: true,
            runtimeSessionId: liveSession.runtimeSessionId,
            pendingLaunch: undefined,
            shellPath: liveSession.shellPath,
            cwd: liveSession.cwd,
            recentOutput: recentOutput || metadata.recentOutput,
            lastCols: liveSession.cols,
            lastRows: liveSession.rows,
            serializedTerminalState: liveSession.terminalStateTracker.getSerializedState()
          }
        }
      };
    }

    if (
      metadata.persistenceMode === 'live-runtime' &&
      metadata.runtimeSessionId &&
      (metadata.liveSession || metadata.attachmentState === 'reattaching')
    ) {
      if (!options.allowLiveRuntimeReconnect) {
        const liveRuntimeReconnectBlockReason =
          options.liveRuntimeReconnectBlockReason ?? 'runtime-persistence-disabled';
        return {
          ...node,
          status: 'history-restored',
          summary: describeBlockedTerminalLiveRuntimeSummary(liveRuntimeReconnectBlockReason),
          metadata: {
            terminal: {
              ...metadata,
              attachmentState:
                liveRuntimeReconnectBlockReason === 'workspace-untrusted'
                  ? 'reattaching'
                  : 'history-restored',
              liveSession: false,
              pendingLaunch: undefined
            }
          }
        };
      }

      return {
        ...node,
        status: 'reattaching',
        summary: '正在重新连接原终端 live runtime。',
        metadata: {
          terminal: {
            ...metadata,
            attachmentState: 'reattaching',
            liveSession: false,
            pendingLaunch: undefined
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
            lifecycle: 'interrupted',
            liveSession: false,
            pendingLaunch: undefined
          }
        }
      };
    }

    if (metadata.persistenceMode === 'live-runtime' && metadata.attachmentState === 'history-restored') {
      return {
        ...node,
        status: 'history-restored',
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
        status: 'idle',
        summary: defaultSummaryForKind('terminal'),
        metadata: {
          ...node.metadata,
          terminal: {
            ...metadata,
            lifecycle: 'idle',
            pendingLaunch: undefined
          }
        }
      };
    }

    return {
      ...node,
      status: metadata.lifecycle,
      metadata: {
        terminal: {
          ...metadata,
          liveSession: false
        }
      }
    };
  });
}

function reconcileNoteNodesInArray(nodes: CanvasNodeSummary[]): CanvasNodeSummary[] {
  return nodes.map((node) => {
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

function updateNoteContent(
  state: CanvasPrototypeState,
  payload: {
    nodeId: string;
    content: string;
  }
): CanvasPrototypeState {
  const node = state.nodes.find((currentNode) => currentNode.id === payload.nodeId && currentNode.kind === 'note');
  if (!node) {
    return state;
  }

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

function updateNodeTitle(
  state: CanvasPrototypeState,
  nodeId: string,
  title: string
): CanvasPrototypeState {
  const currentNode = state.nodes.find((node) => node.id === nodeId);
  if (!currentNode) {
    return state;
  }

  const nextTitle = trimStoredNodeText(title).trim() || currentNode.title;
  if (nextTitle === currentNode.title) {
    return state;
  }

  return {
    ...state,
    updatedAt: new Date().toISOString(),
    nodes: state.nodes.map((node) =>
      node.id === nodeId
        ? {
            ...node,
            title: nextTitle
          }
        : node
    )
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
  return agentNode?.status ?? 'idle';
}

function readAgentSummary(state: CanvasPrototypeState, nodeId: string): string {
  const agentNode = state.nodes.find((node) => node.id === nodeId && node.kind === 'agent');
  return agentNode?.summary ?? defaultSummaryForKind('agent');
}

function readTerminalStatus(state: CanvasPrototypeState, nodeId: string): string {
  const terminalNode = state.nodes.find((node) => node.id === nodeId && node.kind === 'terminal');
  return terminalNode?.status ?? 'idle';
}

function readTerminalSummary(state: CanvasPrototypeState, nodeId: string): string {
  const terminalNode = state.nodes.find((node) => node.id === nodeId && node.kind === 'terminal');
  return terminalNode?.summary ?? defaultSummaryForKind('terminal');
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

function stripSerializedTerminalStateFromCanvasState(state: CanvasPrototypeState): CanvasPrototypeState {
  return {
    ...state,
    nodes: state.nodes.map((node) => ({
      ...node,
      metadata:
        node.kind === 'agent'
          ? node.metadata?.agent
            ? {
                ...node.metadata,
                agent: {
                  ...node.metadata.agent,
                  serializedTerminalState: undefined
                }
              }
            : node.metadata
          : node.kind === 'terminal'
            ? node.metadata?.terminal
              ? {
                  ...node.metadata,
                  terminal: {
                    ...node.metadata.terminal,
                    serializedTerminalState: undefined
                  }
                }
              : node.metadata
            : node.metadata
    }))
  };
}

function doesAgentResumeStrategyRequireSupport(strategy: AgentResumeStrategy): boolean {
  return strategy === 'claude-session-id' || strategy === 'codex-session-id' || strategy === 'fake-provider';
}

function canResumeAgentFromMetadata(metadata: Pick<AgentNodeMetadata, 'resumeStrategy' | 'resumeSessionId' | 'resumeStoragePath'>): boolean {
  if (!doesAgentResumeStrategyRequireSupport(metadata.resumeStrategy)) {
    return false;
  }

  if (metadata.resumeStrategy === 'fake-provider') {
    return Boolean(metadata.resumeSessionId?.trim() && metadata.resumeStoragePath?.trim());
  }

  if (metadata.resumeStrategy === 'claude-session-id' || metadata.resumeStrategy === 'codex-session-id') {
    return Boolean(metadata.resumeSessionId?.trim());
  }

  return false;
}

function normalizeAgentCliCacheWorkspaceCwd(workspaceCwd: string | undefined): string {
  const normalizedWorkspaceCwd = workspaceCwd?.trim();
  if (!normalizedWorkspaceCwd) {
    return '<no-workspace>';
  }

  const resolvedWorkspaceCwd = path.resolve(normalizedWorkspaceCwd);
  return process.platform === 'win32' ? resolvedWorkspaceCwd.toLowerCase() : resolvedWorkspaceCwd;
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

function extractRecentTerminalOutput(value: string): string {
  const trimmed = value.replace(/\r/g, '').trim();
  if (!trimmed) {
    return '';
  }

  return trimStoredTerminalText(trimmed);
}

function summarizeEmbeddedTerminalOutput(output: string, status: TerminalNodeStatus): string {
  const normalized = output
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const lastLine = normalized[normalized.length - 1];

  if (!lastLine) {
    switch (status) {
      case 'launching':
        return '正在启动嵌入式终端。';
      case 'stopping':
        return '正在停止终端会话。';
      case 'closed':
        return '终端会话已结束。';
      case 'error':
        return '终端会话异常退出。';
      case 'interrupted':
        return '上一次嵌入式终端在扩展重载后未恢复。';
      default:
        return '嵌入式终端已启动，等待输入。';
    }
  }

  return lastLine.length > 140 ? `${lastLine.slice(0, 140)}...` : lastLine;
}

function summarizeAgentSessionOutput(output: string, status: AgentNodeStatus, label: string): string {
  const normalized = output
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const lastLine = normalized[normalized.length - 1];

  if (!lastLine) {
    switch (status) {
      case 'starting':
        return `正在启动 ${label} 会话。`;
      case 'resuming':
        return `正在恢复 ${label} 会话。`;
      case 'running':
        return `${label} 正在处理输入。`;
      case 'waiting-input':
        return `${label} 已就绪，等待输入。`;
      case 'stopping':
        return `正在停止 ${label} 会话。`;
      case 'resume-ready':
        return `检测到可恢复的 ${label} 会话。`;
      case 'resume-failed':
        return `${label} 会话恢复失败。`;
      case 'stopped':
        return `${label} 会话已结束。`;
      case 'error':
        return `${label} 会话异常退出。`;
      case 'interrupted':
        return `${label} 会话在扩展重载后未恢复。`;
      default:
        return `${label} 会话尚未启动。`;
    }
  }

  return lastLine.length > 140 ? `${lastLine.slice(0, 140)}...` : lastLine;
}

function describeAgentSessionSpawnError(spec: AgentCliSpec, error: unknown): string {
  if (isAgentCliResolutionError(error)) {
    return error.message;
  }

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
    const commandLabel =
      spec.command !== spec.requestedCommand ? `${spec.requestedCommand}（解析结果 ${spec.command}）` : spec.command;
    return `没有找到 ${spec.label} 命令 ${commandLabel}。${suffix}`;
  }

  if (error instanceof Error && error.message) {
    return `启动 ${spec.label} 失败：${error.message}`;
  }

  return `启动 ${spec.label} 失败。`;
}

function describeAgentResumeSpawnError(spec: AgentCliSpec, error: unknown): string {
  const message = describeAgentSessionSpawnError(spec, error);
  return message.replace(/^启动/, '恢复');
}

function describeAgentSessionExit(
  spec: AgentCliSpec,
  code: number | null,
  signal: string | undefined,
  output: string
): string {
  const summary = summarizeAgentSessionOutput(output, 'stopped', spec.label);
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

function describeAgentResumeFailure(
  spec: AgentCliSpec,
  code: number | null,
  signal: string | undefined,
  output: string
): string {
  const summary = summarizeAgentSessionOutput(output, 'resume-failed', spec.label);
  const suffix = summary === `${spec.label} 会话恢复失败。` ? '' : ` ${summary}`;
  const normalizedSignal = normalizeExecutionExitSignal(signal);

  if (normalizedSignal) {
    return `恢复 ${spec.label} 时收到信号 ${normalizedSignal}。${suffix}`.trim();
  }

  if (typeof code === 'number') {
    return `恢复 ${spec.label} 时进程以退出码 ${code} 结束。${suffix}`.trim();
  }

  return `恢复 ${spec.label} 失败。${suffix}`.trim();
}

function describeBlockedAgentLiveRuntimeSummary(blockReason: LiveRuntimeReconnectBlockReason): string {
  if (blockReason === 'workspace-untrusted') {
    return '当前 workspace 未受信任，暂不重新连接原 Agent live runtime，仅展示历史结果。';
  }

  return '运行时持久化已关闭，原 Agent live runtime 已恢复为历史结果。';
}

function describeBlockedTerminalLiveRuntimeSummary(blockReason: LiveRuntimeReconnectBlockReason): string {
  if (blockReason === 'workspace-untrusted') {
    return '当前 workspace 未受信任，暂不重新连接原终端 live runtime，仅展示历史结果。';
  }

  return '运行时持久化已关闭，原终端 live runtime 已恢复为历史结果。';
}

function isAgentResumePhaseActive(status: AgentNodeStatus): boolean {
  return status === 'starting' || status === 'resuming';
}

function isAgentLifecycleAwaitingInteractiveState(
  status: AgentNodeStatus | TerminalNodeStatus
): boolean {
  return status === 'starting' || status === 'resuming' || status === 'running';
}

function isAgentInstructionSubmission(data: string): boolean {
  return /[\r\n]/.test(data);
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
  const summary = summarizeEmbeddedTerminalOutput(output, 'closed');
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

function readAgentCliResolutionCache(value: unknown): Record<string, AgentCliResolutionCacheEntry> {
  if (!isRecord(value)) {
    return {};
  }

  const cache: Record<string, AgentCliResolutionCacheEntry> = {};
  for (const [cacheKey, entry] of Object.entries(value)) {
    if (!isRecord(entry)) {
      continue;
    }

    const requestedCommand =
      typeof entry.requestedCommand === 'string' ? entry.requestedCommand.trim() : '';
    const resolvedCommand =
      typeof entry.resolvedCommand === 'string' ? entry.resolvedCommand.trim() : '';
    if (!requestedCommand || !resolvedCommand) {
      continue;
    }

    cache[cacheKey] = {
      requestedCommand,
      resolvedCommand
    };
  }

  return cache;
}
