import { createHash, randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  ATTENTION_NOTIFICATION_PROTOCOL_VERSION,
  NOTIFIER_COMMAND_IDS,
  isAttentionNotificationDeliveryResult,
  type AttentionNotificationDeliveryResult,
  type AttentionNotificationRequest
} from '../../packages/attention-protocol/src/index';

import {
  AGENT_WAITING_INPUT_POLL_INTERVAL_MS,
  createAgentActivityHeuristicState,
  evaluateAgentWaitingInputTransition,
  recordAgentOutputHeuristics,
  resetAgentAbnormalStreamInterruptionHeuristics,
  resetAgentActivityHeuristics,
  stripTerminalControlSequences,
  normalizeAgentAbnormalStreamInterruptionSignature,
  type AgentActivityHeuristicState
} from '../common/agentActivityHeuristics';
import {
  createExecutionAttentionSignalState,
  filterEnabledExecutionAttentionSignals,
  isExecutionAttentionSignalEnabled,
  normalizeEnabledExecutionAttentionSignalKinds,
  parseExecutionAttentionSignals,
  type ExecutionAttentionSignal,
  type ExecutionAttentionSignalKind,
  type ExecutionAttentionSignalState
} from '../common/executionAttentionSignals';
import {
  createExecutionImagePasteFileName,
  EXECUTION_IMAGE_PASTE_MAX_BYTES,
  formatExecutionImagePasteText,
  hasValidExecutionImagePasteSignature,
  isExecutionImagePasteSizeAllowed,
  prepareExecutionTerminalPasteText,
  type ExecutionImagePasteMimeType
} from '../common/executionTerminalClipboard';
import {
  COMMAND_IDS,
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
  type AgentLaunchDefaultsByProvider,
  type AgentLaunchPresetKind,
  type AgentProviderKind,
  type AgentProviderLaunchDefaults,
  type AgentResumeStrategy,
  type CanvasCreatableNodeKind,
  type CanvasGroupRole,
  type CanvasGroupDeleteMode,
  type CanvasGroupSummary,
  type CanvasEdgeAnchor,
  type CanvasEdgeArrowMode,
  type CanvasEdgeColor,
  type CanvasEdgeSummary,
  type CanvasFileActivityAccessMode,
  type CanvasAttentionNotificationBridgeMode,
  type CanvasAgentAbnormalOutputTextNotificationMode,
  type CanvasSurfaceLocation,
  type CanvasSurfaceMode,
  type CanvasFileNodeDisplayStyle,
  type CanvasFileNodeDisplayMode,
  type CanvasFilePathDisplayMode,
  type CanvasFilePresentationMode,
  type CanvasLinkOpenMode,
  type CanvasFileIconDescriptor,
  type CanvasMultiRootPresentationMode,
  type CanvasOverviewMode,
  type CanvasStrongTerminalAttentionReminderMode,
  type CanvasFileReferenceOwnerSummary,
  type CanvasFileReferenceSummary,
  type CanvasFileIconFontFace,
  type FileNodeMetadata,
  type FileListNodeEntrySummary,
  type CanvasNodeFootprint,
  type CanvasNodeKind,
  type CanvasNodeMetadata,
  type CanvasNodePosition,
  type CanvasRuntimeContext,
  type WebviewClipboardTextSource,
  type CanvasTemplateMenuEntry,
  type CanvasNodeSummary,
  type CanvasPrototypeState,
  type ExecutionPerformanceDiagnosticPayload,
  type ExecutionNodeKind,
  type ExecutionSessionMetadata,
  type HostToWebviewMessage,
  type NoteNodeMetadata,
  type NoteMarkdownImageWorkspaceRoot,
  type PendingExecutionLaunch,
  type RuntimeAttachmentState,
  type RuntimeHostBackendKind,
  type RuntimePersistenceMode,
  type RuntimePersistenceGuarantee,
  type TerminalNodeStatus,
  type TerminalNodeMetadata,
  type WebviewDomAction,
  type WebviewLifecycleIdentity,
  type WebviewProbeSnapshot,
  type WebviewToHostMessage,
  DEFAULT_CANVAS_OVERVIEW_ZOOM_THRESHOLD,
  EXECUTION_PERFORMANCE_DIAGNOSTICS_SCHEMA_VERSION,
  NOTE_EMBEDDED_CONTENT_MAX_LENGTH,
  estimateMinimalFileNodeFootprint,
  estimatedCanvasNodeFootprint,
  isCanvasCreatableNodeKind,
  isCanvasNodeKind,
  extractWebviewMessageLifecycle,
  isExecutionNodeKind,
  normalizeCanvasAttentionNotificationBridgeMode,
  normalizeCanvasAgentAbnormalOutputTextNotificationMode,
  normalizeCanvasLinkOpenMode,
  normalizeCanvasMultiRootPresentationMode,
  normalizeCanvasOverviewMode,
  normalizeCanvasOverviewZoomThreshold,
  normalizeCanvasStrongTerminalAttentionReminderMode,
  normalizeCanvasNodeFootprint,
  parseWebviewMessage,
  resolveHorizontalCanvasEdgeAnchors,
  strongTerminalAttentionReminderPulsesMinimap,
  strongTerminalAttentionReminderShowsTitleBar
} from '../common/protocol';
import {
  composeRootLocalCanvasStateIntoComposed,
  composeMultiRootCanvasState,
  createEmptyCanvasState,
  denamespaceCanvasObjectId,
  decomposeComposedCanvasStateForWorkspaceRoot,
  decomposeMultiRootCanvasState,
  getWorkspaceRootSectionContentInset,
  isWorkspaceRootGroup,
  normalizeCanvasMultiRootOverlay,
  namespaceCanvasObjectId,
  resolveWorkspaceRootPathForGroup,
  sanitizeRootLocalCanvasState,
  splitNamespacedCanvasObjectId,
  translateComposedCanvasPositionToRootLocal,
  translateRootLocalCanvasPositionToComposed,
  type CanvasMultiRootOverlay,
  type CanvasMultiRootWorkspaceFolder,
  type CanvasRootLocalStateSnapshot
} from '../common/canvasMultiRootComposition';
import { arrangeCanvasLayout } from '../common/canvasLayoutArrangement';
import {
  buildAgentBranchCommandLine as buildAgentProviderBranchCommandLine,
  buildFreshAgentCommandLine,
  buildAgentHistoryResumeCommandLine,
  extractClaudeCommandRuntimeSessionFlag,
  formatCommandLine,
  validateAgentCommandLine
} from '../common/agentLaunchPresets';
import {
  DEFAULT_BUILTIN_CANVAS_TEMPLATE_ID,
  captureCanvasTemplateFromState,
  cloneCanvasTemplate,
  encodeCanvasTemplateDocument,
  formatCanvasTemplateStats,
  normalizeCanvasTemplateWorkspaceRelativePath,
  resolveCanvasTemplateAgentProvider,
  type CanvasTemplate,
  type CanvasTemplateAssociatedNoteSaveMode,
  type CanvasTemplateAssociatedNoteSaveSelection,
  type CanvasTemplateCaptureResult,
  type CanvasTemplateSaveAgentProviderSelection
} from '../common/canvasTemplates';
import {
  SerializedTerminalStateTracker,
  cloneSerializedTerminalState,
  normalizeSerializedTerminalState
} from '../common/serializedTerminalState';
import { selectExecutionOutputSchedulerEntries } from '../common/executionOutputScheduler';
import { DEFAULT_TERMINAL_SCROLLBACK, normalizeTerminalScrollback } from '../common/terminalScrollback';
import { isTestHarnessMode } from '../common/testHarness';
import {
  resolveNoteMarkdownLinkTarget,
  type NoteMarkdownFileSelection,
  type NoteMarkdownWorkspaceRoot
} from '../common/noteMarkdownLinks';
import {
  canCompareNoteMarkdownResourceWithWorkspaceRoot,
  createDefaultNoteMarkdownFileName,
  createDroppedNoteMarkdownTitle,
  extractNoteMarkdownCurrentRemoteAuthorityFromWebviewResourceUri,
  formatNoteMarkdownRemoteAuthorityPrefix,
  isSupportedNoteMarkdownFilePath,
  normalizeNoteMarkdownAuthority,
  resolveNoteMarkdownRefreshDraftRetention,
  shouldShowNoteMarkdownRemoteAuthorityPrefixForDisplay,
  type MarkdownFileNoteContentSource,
  type NoteContentSource,
  type NoteMarkdownRecoverableDraft,
  type NoteMarkdownFileStatus
} from '../common/noteMarkdownFileAssociation';
import { resolveContainedWorkspaceRelativePath } from '../common/workspaceRelativePath';
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
import {
  applyShellEnvironmentPatch,
  resolveShellEnvironmentPatch,
  shouldResolveShellEnvironmentPatchForExecutionTarget,
  type ResolvedShellEnvironmentPatch,
  type ShellEnvironmentProbeMode
} from './shellEnvironmentResolver';
import {
  getConfiguredTerminalInheritEnv,
  getConfigurationValue,
  getConfiguredTerminalShell,
  getConfiguredTerminalShellArgs,
  inspectCurrentConfiguredTerminalShellInCwd
} from './configuration';
import { getWebviewHtml } from './getWebviewHtml';
import { openCanvasExternalLink } from './linkOpenMode';
import { RuntimeSupervisorClient } from './runtimeSupervisorClient';
import {
  CanvasTemplateStore,
  type CanvasStoredTemplate,
  type CanvasTemplateCatalog,
  type CanvasTemplateStorageLocation
} from './CanvasTemplateStore';
import {
  serializeExecutionSessionLaunchSpec,
  type RuntimeSupervisorCreateSessionParams,
  type RuntimeSupervisorEvent,
  type RuntimeSupervisorSessionSnapshot
} from '../common/runtimeSupervisorProtocol';
import {
  extractClaudeResumeSessionId,
  extractCodexResumeSessionId,
  locateClaudeSessionId,
  locateCodexSessionId
} from '../common/codexSessionIdLocator';
import {
  createRuntimeHostBackend,
  listPreferredRuntimeHostBackendKinds,
  type RuntimeHostBackend
} from './runtimeHostBackend';
import type {
  ExecutionTerminalFileLinkCandidate,
  ExecutionTerminalDroppedResource,
  ExecutionTerminalOpenLink,
  ExecutionTerminalFileLinkResolvePriority,
  ExecutionTerminalFileLinkSource
} from '../common/executionTerminalLinks';
import { inferExecutionTerminalPathStyle } from '../common/executionTerminalLinks';
import {
  normalizeEditorMultiCursorModifier,
  normalizeExecutionTerminalWordSeparators,
  filterResolvableExecutionTerminalFileLinkCandidates,
  openExecutionTerminalLink,
  openResolvedExecutionTerminalLink,
  prepareExecutionTerminalDroppedPath,
  resolveExecutionTerminalFileLinkCandidates,
  type PreparedExecutionTerminalResolvedFileLink,
  type ExecutionTerminalPathContext,
  type OpenExecutionTerminalLinkResult,
  type ResolvedExecutionFileLink
} from './executionTerminalNativeHelpers';
import { ExecutionTerminalLineContextTracker } from './executionTerminalLineContextTracker';
import {
  createAgentFileActivitySession,
  looksLikeFakeAgentProviderCommand,
  type AgentFileActivityEvent,
  type AgentFileActivitySession
} from './agentFileActivity';
import type {
  ConfiguredTerminalShell,
  InspectedConfiguredTerminalShell,
  TerminalShellResolutionSource
} from './terminalShellConfiguration';

export type { CanvasSurfaceLocation };

const DEFAULT_TERMINAL_COLS = 96;
const DEFAULT_TERMINAL_ROWS = 28;
const NODE_PLACEMENT_PADDING = 40;
const NODE_PLACEMENT_STEP_X = 120;
const NODE_PLACEMENT_STEP_Y = 96;
const NODE_PLACEMENT_SEARCH_RADIUS = 8;
const DEFAULT_CANVAS_GROUP_SIZE: CanvasNodeFootprint = { width: 360, height: 240 };
const MINIMUM_CANVAS_GROUP_SIZE: CanvasNodeFootprint = { width: 180, height: 96 };
const CANVAS_GROUP_PADDING = 24;
const CANVAS_GROUP_TITLE_HEIGHT = 28;
const CANVAS_GROUP_MEMBER_INSETS = {
  left: CANVAS_GROUP_PADDING,
  top: CANVAS_GROUP_PADDING + CANVAS_GROUP_TITLE_HEIGHT,
  right: CANVAS_GROUP_PADDING,
  bottom: CANVAS_GROUP_PADDING
} as const;
const CANVAS_WORKSPACE_ROOT_GROUP_MEMBER_INSETS = {
  left: getWorkspaceRootSectionContentInset(),
  top: getWorkspaceRootSectionContentInset(),
  right: getWorkspaceRootSectionContentInset(),
  bottom: getWorkspaceRootSectionContentInset()
} as const;
const CANVAS_GROUP_COLLISION_PADDING = 24;
const CANVAS_NODE_COLLISION_PADDING = 24;
const EXECUTION_OUTPUT_FLUSH_INTERVAL_MS = 32;
const EXECUTION_HOST_OUTPUT_SCHEDULER_FLUSH_INTERVAL_MS = 16;
const EXECUTION_HOST_OUTPUT_SCHEDULER_MAX_POSTS_PER_FLUSH = 3;
const EXECUTION_HOST_OUTPUT_INPUT_PRIORITY_WINDOW_MS = 300;
const EXECUTION_HOST_OUTPUT_INPUT_NON_PRIORITY_MAX_DEFER_MS = 750;
const EXECUTION_OUTPUT_STATE_SYNC_INTERVAL_MS = 2500;
const EXECUTION_INTERACTION_STATE_SYNC_INTERVAL_MS = 160;
const CANVAS_STATE_DEFERRED_PERSIST_DEBOUNCE_MS = 1500;
const CANVAS_STATE_DEFERRED_PERSIST_MAX_WAIT_MS = 5000;
const EXECUTION_PERFORMANCE_DIAGNOSTIC_MAX_SAMPLES = 500;
const EXECUTION_PERFORMANCE_HOST_INPUT_WRITE_MIN_DURATION_MS = 8;
const EXECUTION_PERFORMANCE_HOST_OUTPUT_MIN_DURATION_MS = 16;
const EXECUTION_PERFORMANCE_HOST_OUTPUT_MIN_CHARACTERS = 32 * 1024;
const EXECUTION_HOST_EVENT_LOOP_LAG_INTERVAL_MS = 500;
const EXECUTION_HOST_EVENT_LOOP_LAG_REPORT_THRESHOLD_MS = 120;
const EXECUTION_FILE_LINK_RESOLVE_CACHE_MAX_ENTRIES = 512;
const EXECUTION_FILE_LINK_RESOLVE_CACHE_TTL_MS = 30_000;
const EXECUTION_FILE_LINK_BACKGROUND_RESOLVE_MIN_INTERVAL_MS = 150;
const EXECUTION_ATTENTION_NOTIFICATION_TEXT_LIMIT = 140;
const EXECUTION_ATTENTION_NOTIFICATION_COOLDOWN_MS = 4000;
const EXECUTION_ATTENTION_BELL_NOTIFICATION_COOLDOWN_MS = 8000;
const EXECUTION_ATTENTION_FOCUS_ACTION_LABEL = '查看节点';
const EXECUTION_ATTENTION_FOCUS_TIMEOUT_MS = 20000;
const WORKSPACE_ROOT_FOCUS_REPLAY_WINDOW_MS = 1500;
const TERMINAL_INITIAL_INPUT_DISPATCH_TIMEOUT_MS = 20000;
const AGENT_GRACEFUL_STOP_INPUT = '\u0003';
// Codex/Claude can take a few extra seconds after Ctrl-C to flush token usage and resume hints.
// Give the CLI a longer grace window before we escalate to kill, so the stopped snapshot is authoritative.
const AGENT_GRACEFUL_STOP_FORCE_KILL_TIMEOUT_MS = 5000;
const CANVAS_DEFAULT_TEMPLATE_ID_GLOBAL_STATE_KEY = 'devSessionCanvas.canvas.defaultTemplateId';
const ROOT_LOCAL_CANVAS_STORAGE_DIRECTORY = 'root-local-canvas';
const FAKE_PROVIDER_STORAGE_PATH_ENV_KEY = 'DEV_SESSION_CANVAS_FAKE_PROVIDER_STORAGE_PATH';
const FAKE_PROVIDER_STOP_HINT_STYLE_ENV_KEY = 'DEV_SESSION_CANVAS_FAKE_PROVIDER_STOP_HINT_STYLE';
const RELOAD_WINDOW_ACTION_LABEL = '重新加载窗口';

interface AgentCliConfig {
  defaultProvider: AgentProviderKind;
  codexCommand: string;
  claudeCommand: string;
  codexDefaultArgs: string;
  claudeDefaultArgs: string;
}

interface AgentCliSpec {
  provider: AgentProviderKind;
  label: string;
  requestedCommand: string;
  command: string;
  resolutionSource: AgentCliResolutionSource;
}

interface CreateTerminalCommandResult {
  created: boolean;
  nodeId?: string;
  commandDispatched?: boolean;
  errorMessage?: string;
}

interface TerminalInitialInputDispatchResult {
  dispatched: boolean;
  errorMessage?: string;
}

interface PendingTerminalInitialInputDispatch {
  resolve: (result: TerminalInitialInputDispatchResult) => void;
  timeout: NodeJS.Timeout;
}

interface AgentResumeContext {
  supported: boolean;
  strategy: AgentResumeStrategy;
  sessionId?: string;
  storagePath?: string;
}

interface ExecutionCwdValidationOptions {
  allowLegacyDefaultCwd?: boolean;
}

interface ExecutionSnapshotAttachOptions {
  requestId?: string;
  executionSessionId?: string;
  minOutputSequence?: number;
}

interface CreateNodeOptions {
  requestId?: string;
  agentProvider?: AgentProviderKind;
  agentLaunchPreset?: AgentLaunchPresetKind;
  agentCustomLaunchCommand?: string;
  cwdOverride?: string;
  targetGroupId?: string;
  titleOverride?: string;
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
  outputSequence: number;
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
  attentionSignalState?: ExecutionAttentionNotificationState;
  preSuspendLifecycleStatus?: AgentNodeStatus;
  lastSuspendReason?: 'claude-ctrl-z';
  lastSuspendMessage?: string;
  lastReactivateError?: string;
}

interface ExecutionAttentionNotificationState extends ExecutionAttentionSignalState {
  lastNotificationKey?: string;
  lastNotificationAtMs?: number;
  lastAbnormalStreamNotificationKey?: string;
  lastAbnormalStreamNotificationAtMs?: number;
}

interface ExecutionAttentionNotificationWorkspaceFolderContext {
  name: string;
  path: string;
}

interface ExecutionAttentionNotificationWorkspaceContext {
  workspaceName?: string;
  workspaceFolders?: readonly ExecutionAttentionNotificationWorkspaceFolderContext[];
  cwd?: string;
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

type RuntimeSupervisorSessionOutputEvent = Extract<
  RuntimeSupervisorEvent,
  { event: 'sessionOutput' }
>['payload'];

interface PendingWebviewProbeRequest {
  surface: CanvasSurfaceLocation;
  lifecycle?: WebviewLifecycleIdentity;
  webview?: vscode.Webview;
  resolve: (snapshot: WebviewProbeSnapshot) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

interface PendingWebviewDomActionRequest {
  surface: CanvasSurfaceLocation;
  lifecycle?: WebviewLifecycleIdentity;
  webview?: vscode.Webview;
  resolve: () => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

interface PendingWorkspaceRootFocusReplay {
  groupId: string;
  sentLifecycle?: WebviewLifecycleIdentity;
  expiresAtMs: number;
}

interface CanvasSurfaceLifecycleState {
  generation: number;
  mode?: CanvasSurfaceMode;
  ready: boolean;
  frameId?: string;
  bootstrapAck: boolean;
}

interface CanvasTestDiagnosticEvent {
  timestamp: string;
  kind: string;
  detail?: Record<string, unknown>;
}

interface CanvasHostMessageDiagnosticRecord {
  timestamp: string;
  surface: CanvasSurfaceLocation | 'active';
  delivered: boolean;
  type: HostToWebviewMessage['type'];
  detail?: Record<string, unknown>;
}

interface CanvasWebviewLifecycleRaceDiagnostics {
  surface: CanvasSurfaceLocation;
  promoted: boolean;
  ready: boolean;
  bootstrapAck: boolean;
  bootstrapDeliveredToPromotedWebview: boolean;
  secondReadyPromotionIgnored: boolean;
  secondReadyBootstrapSuppressed: boolean;
  messageTargetStayedOnPromotedWebview: boolean;
  sameWebviewFrameReadyPromoted: boolean;
  sameWebviewFrameBootstrapDelivered: boolean;
  sameWebviewFrameLifecycleRebound: boolean;
  gatedMessageQueuedBeforeAck: boolean;
  gatedMessageDeliveredBeforeAck: boolean;
  gatedMessageDeliveredAfterAck: boolean;
  staleMutationIgnored: boolean;
  staleProbeResultIgnored: boolean;
  pendingProbeResolvedFromCurrent: boolean;
  staleDomActionResultIgnored: boolean;
  pendingDomActionResolvedFromCurrent: boolean;
  focusMessageRetriedAfterFrameRefresh: boolean;
  focusMessageReachedRefreshedFrame: boolean;
  templateCatalogPostSettled: boolean;
  oldLifecycle: WebviewLifecycleIdentity;
  competingLifecycle: WebviewLifecycleIdentity;
  currentLifecycle?: WebviewLifecycleIdentity;
  oldWebviewPostedTypes: HostToWebviewMessage['type'][];
  competingWebviewPostedTypes: HostToWebviewMessage['type'][];
  diagnosticKinds: string[];
}

interface CanvasLifecycleRaceFakeWebview {
  webview: vscode.Webview;
  postedMessages: HostToWebviewMessage[];
}

interface CanvasWebviewProbeDiagnosticResult {
  surface: CanvasSurfaceLocation;
  attached: boolean;
  ready: boolean;
  interactive: boolean;
  visibility: CanvasSidebarState['canvasSurface'];
  capturedAt?: string;
  error?: string;
  snapshot?: WebviewProbeSnapshot;
}

type CanvasWebviewLifecycleHealthStatus =
  | 'healthy'
  | 'standby'
  | 'initializing'
  | 'attention'
  | 'blocked'
  | 'not-attached';

interface CanvasWebviewLifecycleSurfaceEventCounts {
  attached: number;
  rendered: number;
  messageWebviewBound: number;
  ready: number;
  readyWebviewPromoted: number;
  bootstrapAck: number;
  hostMessageQueuedUntilBootstrapAck: number;
  staleMessageIgnored: number;
  staleProbeResultIgnored: number;
  staleDomActionResultIgnored: number;
  invalidLifecycleIgnored: number;
  runtimeDiagnostic: number;
  executionPerformanceDiagnostic: number;
}

interface CanvasWebviewLifecycleAttachRenderBurstSummary {
  detected: boolean;
  eventCount: number;
  windowMs?: number;
  latestTimestamp?: string;
}

interface CanvasWebviewLifecycleSurfaceSummary {
  surface: CanvasSurfaceLocation;
  active: boolean;
  attached: boolean;
  visibility: CanvasSidebarState['canvasSurface'];
  interactive: boolean;
  ready: boolean;
  lifecycle?: Record<string, unknown>;
  bootstrapAck: boolean;
  messageTarget: 'explicit' | 'surface-webview' | 'missing';
  pendingBootstrapHostMessageCount: number;
  hostMessages: {
    bootstrapCount: number;
    stateUpdatedCount: number;
    visibilityRestoredCount: number;
    deliveredCount: number;
    undeliveredCount: number;
  };
  events: CanvasWebviewLifecycleSurfaceEventCounts;
  attachRenderBurst: CanvasWebviewLifecycleAttachRenderBurstSummary;
  latestEvents: CanvasTestDiagnosticEvent[];
  probe: {
    attached: boolean;
    ready: boolean;
    interactive: boolean;
    visibility: CanvasSidebarState['canvasSurface'];
    capturedAt?: string;
    error?: string;
    nodeCount: number | null;
  };
  status: CanvasWebviewLifecycleHealthStatus;
  issues: string[];
  recommendedNextSteps: string[];
}

interface CanvasWebviewLifecycleDiagnosticsSummary {
  capturedAt: string;
  activeSurface?: CanvasSurfaceLocation;
  status: CanvasWebviewLifecycleHealthStatus;
  panelRestore: {
    likelyAffected: boolean;
    consecutiveAttachRender: boolean;
    readyPromotionObserved: boolean;
    staleMessageIgnoredCount: number;
    probeFailedAfterReady: boolean;
    missingReadyAfterRender: boolean;
    missingBootstrapAckAfterReady: boolean;
  };
  surfaces: CanvasWebviewLifecycleSurfaceSummary[];
}

interface CanvasHostDiagnosticsDumpResult {
  outputDir: string;
  summaryPath: string;
  webviewLifecycleSummaryPath: string;
  executionPerformanceDiagnosticsPath: string;
  webviewLifecycleStatus: CanvasWebviewLifecycleHealthStatus;
  webviewLifecyclePanelRestoreLikelyAffected: boolean;
}

type NodePlacementPreference = 'left-up' | 'right-down';

interface CanvasFileFilterState {
  includeGlobs: string[];
  excludeGlobs: string[];
}

interface ExecutionFileLinkResolveCandidateDiagnostic {
  text: string;
  path: string;
  source: ExecutionTerminalFileLinkSource;
  bufferStartLine: number;
  line?: number;
  column?: number;
}

interface ExecutionFileLinkResolveDiagnostics {
  candidateCount: number;
  retainedCandidateCount: number;
  filteredCandidateCount: number;
  resolvedCount: number;
  durationMs: number;
  sourceCounts: Partial<Record<ExecutionTerminalFileLinkSource, number>>;
  retainedSourceCounts: Partial<Record<ExecutionTerminalFileLinkSource, number>>;
  filteredSourceCounts: Partial<Record<ExecutionTerminalFileLinkSource, number>>;
  candidates: ExecutionFileLinkResolveCandidateDiagnostic[];
  retainedCandidates: ExecutionFileLinkResolveCandidateDiagnostic[];
  filteredCandidates: ExecutionFileLinkResolveCandidateDiagnostic[];
  skippedReason?: string;
  priority?: ExecutionTerminalFileLinkResolvePriority;
  cacheHitCount?: number;
  cacheMissCount?: number;
  cachePendingCount?: number;
}

interface ExecutionFileLinkResolveDiagnosticSample extends ExecutionFileLinkResolveDiagnostics {
  timestamp: string;
  kind: ExecutionNodeKind;
  nodeId: string;
  requestId: string;
}

interface ExecutionFileLinkResolveDiagnosticsSummary {
  requestCount: number;
  candidateCount: number;
  retainedCandidateCount: number;
  filteredCandidateCount: number;
  resolvedCount: number;
  totalDurationMs: number;
  maxDurationMs: number;
  slowRequestCount: number;
  sourceCounts: Partial<Record<ExecutionTerminalFileLinkSource, number>>;
  retainedSourceCounts: Partial<Record<ExecutionTerminalFileLinkSource, number>>;
  filteredSourceCounts: Partial<Record<ExecutionTerminalFileLinkSource, number>>;
  skippedReasonCounts: Record<string, number>;
  priorityCounts: Partial<Record<ExecutionTerminalFileLinkResolvePriority, number>>;
  cacheHitCount: number;
  cacheMissCount: number;
  cachePendingCount: number;
  latestRequests: ExecutionFileLinkResolveDiagnosticSample[];
}

interface ExecutionPerformanceDiagnosticSample extends ExecutionPerformanceDiagnosticPayload {
  timestamp: string;
  surface?: CanvasSurfaceLocation;
  current?: boolean;
}

interface ExecutionPerformanceDiagnosticsSummary {
  sampleCount: number;
  sourceCounts: Partial<Record<ExecutionPerformanceDiagnosticPayload['source'], number>>;
  totalDurationMs: number;
  maxDurationMs: number;
  slowSampleCount: number;
  totalCharacters: number;
  totalBytes: number;
  latestSamples: ExecutionPerformanceDiagnosticSample[];
}

interface ExecutionInputDiagnosticMetadata {
  sequence?: number;
  webviewEpochMs?: number;
  webviewPerformanceNowMs?: number;
  hostReceivedEpochMs?: number;
  queueDelayMs?: number;
}

interface ScheduledExecutionOutputPost {
  key: string;
  kind: ExecutionNodeKind;
  nodeId: string;
  chunk: string;
  persisted: boolean;
  outputSequence?: number;
  executionSessionId?: string;
  queuedAtMs: number;
  lastUpdatedAtMs: number;
}

interface ExecutionInputPriorityState {
  kind: ExecutionNodeKind;
  nodeId: string;
  receivedAtMs: number;
  sequence?: number;
}

type CanvasStatePersistMode = 'immediate' | 'deferred';
type CanvasWorkspaceStatePersistMode = 'full' | 'skip';

interface PendingCanvasStatePersist {
  snapshot: PersistedCanvasSnapshot;
  rootLocalStates?: CanvasRootLocalStateSnapshot[];
  requestedAtMs: number;
  latestRequestedAtMs: number;
  mode: CanvasStatePersistMode;
  workspaceStateMode: CanvasWorkspaceStatePersistMode;
  reason: string;
  coalescedCount: number;
}

interface ExecutionFileLinkResolveCacheEntry {
  createdAt: number;
  resolvedCandidates: ExecutionFileLinkResolveCachedCandidate[];
}

interface ExecutionFileLinkResolveCachedCandidate {
  candidateCacheKey: string;
  openLink: PreparedExecutionTerminalResolvedFileLink['openLink'];
  resolved: PreparedExecutionTerminalResolvedFileLink['resolved'];
}

interface ExecutionFileLinkResolveCacheState {
  entries: Map<string, ExecutionFileLinkResolveCacheEntry>;
  inFlight: Map<string, ExecutionFileLinkResolveInFlightEntry>;
  lastBackgroundStartedAt: number;
}

interface ExecutionFileLinkResolveResult {
  resolvedCandidates: PreparedExecutionTerminalResolvedFileLink[];
  cacheHitCount: number;
  cacheMissCount: number;
  cachePendingCount: number;
}

interface ExecutionFileLinkResolveInFlightEntry {
  priority: ExecutionTerminalFileLinkResolvePriority;
  promise: Promise<PreparedExecutionTerminalResolvedFileLink[]>;
}

export interface CanvasSidebarState {
  canvasSurface: 'closed' | 'hidden' | 'visible';
  surfaceLocation: CanvasSurfaceLocation;
  configuredSurface: CanvasSurfaceLocation;
  runtimePersistenceEnabled: boolean;
  notificationBridgeMode: CanvasAttentionNotificationBridgeMode;
  enabledAttentionSignals: ExecutionAttentionSignalKind[];
  notificationStrongReminderMode: CanvasStrongTerminalAttentionReminderMode;
  agentAbnormalOutputTextNotificationMode: CanvasAgentAbnormalOutputTextNotificationMode;
  filesFeatureEnabled: boolean;
  filePresentationMode: CanvasFilePresentationMode;
  fileNodeDisplayStyle: CanvasFileNodeDisplayStyle;
  fileNodeDisplayMode: CanvasFileNodeDisplayMode;
  filePathDisplayMode: CanvasFilePathDisplayMode;
  terminalShellConfiguredValue: string;
  terminalShellPath: string;
  agentCodexCommand: string;
  agentClaudeCommand: string;
  nodeCount: number;
  runningExecutionCount: number;
  workspaceTrusted: boolean;
  creatableKinds: CanvasCreatableNodeKind[];
  fileFilters: CanvasFileFilterState;
}

type CreateNodeBlockReason = 'workspace-untrusted';

export interface CanvasSidebarNodeListSnapshot {
  nodes: CanvasNodeSummary[];
  groups: CanvasGroupSummary[];
}

export interface CanvasDebugSnapshot {
  activeSurface: CanvasSurfaceLocation | undefined;
  configuration: CanvasDebugConfigurationSnapshot;
  sidebar: CanvasSidebarState;
  state: CanvasPrototypeState;
  surfaceMode: Partial<Record<CanvasSurfaceLocation, CanvasSurfaceMode>>;
  surfaceReady: Record<CanvasSurfaceLocation, boolean>;
  surfaceLifecycle: Record<CanvasSurfaceLocation, CanvasSurfaceLifecycleState>;
}

interface CanvasDebugConfigurationSnapshot {
  linkOpenMode: CanvasLinkOpenMode;
  terminalShellPath: string;
  terminalShellPathOverride?: string;
  terminalShellResolutionSource: TerminalShellResolutionSource;
  terminalInheritEnv: boolean;
  terminalShellArgs: string[];
  terminalShellSetting?: Exclude<ConfiguredTerminalShell, 'default'>;
  executionShellEnvPatchSource?: ResolvedShellEnvironmentPatch['source'];
  executionShellEnvPatchShellFamily?: ResolvedShellEnvironmentPatch['shellFamily'];
  executionShellEnvPatchProbeMode?: ResolvedShellEnvironmentPatch['probeMode'];
  executionShellEnvPatchSkipReason?: ResolvedShellEnvironmentPatch['skippedReason'];
  executionShellEnvPatchShellPath?: ResolvedShellEnvironmentPatch['shellPath'];
  executionShellEnvPatchAppliedKeys?: ResolvedShellEnvironmentPatch['appliedKeys'];
  executionShellEnvPatchError?: ResolvedShellEnvironmentPatch['error'];
}

interface PersistedCanvasSnapshot {
  version: 1;
  writtenAt?: string;
  stateHash?: string;
  state?: unknown;
  multiRootOverlay?: unknown;
  fileFilterState?: unknown;
  activeSurface?: CanvasSurfaceLocation;
  defaultSurface?: CanvasSurfaceLocation;
  runtimePersistenceEnabled?: boolean;
  filesFeatureEnabled?: boolean;
}

interface CanvasStartupConfiguration {
  defaultSurface: CanvasSurfaceLocation;
  runtimePersistenceEnabled: boolean;
  filesFeatureEnabled: boolean;
}

interface CanvasFileViewConfiguration {
  enabled: boolean;
  presentationMode: CanvasFilePresentationMode;
  includeGlobs: string[];
  excludeGlobs: string[];
  displayStyle: CanvasFileNodeDisplayStyle;
  nodeDisplayMode: CanvasFileNodeDisplayMode;
  pathDisplayMode: CanvasFilePathDisplayMode;
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
  cwdOverride?: string;
  injectAgentOutputChunk?: string;
  injectAgentExistingOutput?: string;
  injectAgentOutputChunks?: string[];
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
    runtimeBackend: RuntimeHostBackendKind;
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

interface CanvasTemplateApplyStateResult {
  state: CanvasPrototypeState;
  nodeIds: string[];
}

interface CanvasTemplateNoteMaterialization {
  content: string;
  contentSource?: NoteContentSource;
}

interface CanvasTemplateAssociatedNoteSaveFormItem {
  nodeId: string;
  title: string;
  displayPath: string;
  status: string;
  isWorkspaceRelative: boolean;
  defaultMode: CanvasTemplateAssociatedNoteSaveMode;
}

interface NoteMarkdownFileQuickPickItem extends vscode.QuickPickItem {
  itemKind: 'use-input' | 'directory' | 'file';
  filePath?: string;
}

interface NoteMarkdownFileWatcher {
  close(): void;
}

interface ActiveAssociatedNoteMarkdownEdit {
  content: string;
  baseContent: string;
  baseContentRevision?: string;
  updatedAt: number;
}

interface ReadNoteMarkdownFileResult {
  status: NoteMarkdownFileStatus;
  content: string;
  contentRevision?: string;
  contentSkipped?: boolean;
  lastError?: string;
}

interface NoteMarkdownFileStatResult {
  status: NoteMarkdownFileStatus;
  contentRevision?: string;
  lastError?: string;
}

type NoteMarkdownExistingFileChoice = 'overwrite' | 'keep';
type NoteMarkdownExistingDropChoice = 'create' | 'locate';

// Keep the directory name stable so existing storage-backed drafts survive the field rename.
const NOTE_MARKDOWN_RECOVERABLE_DRAFTS_STORAGE_DIRECTORY = 'note-markdown-drafts';
const NOTE_MARKDOWN_RECOVERABLE_DRAFT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const EXECUTION_IMAGE_PASTE_STORAGE_DIRECTORY = 'execution-image-pastes';

export class CanvasPanelManager implements vscode.WebviewPanelSerializer, vscode.WebviewViewProvider {
  public static readonly viewType = VIEW_IDS.editorWebviewPanel;
  public static readonly panelViewType = VIEW_IDS.panelWebviewView;
  public static readonly panelContainerId = VIEW_IDS.panelContainer;
  private static readonly RECOVERABLE_STORAGE_RELATIVE_PATHS = [
    'canvas-state.json',
    NOTE_MARKDOWN_RECOVERABLE_DRAFTS_STORAGE_DIRECTORY,
    'agent-runtime'
  ] as const;

  private readonly rawExtensionStoragePath: string;
  private readonly canvasTemplateStore: CanvasTemplateStore;
  private storageRecoverySelection!: ExtensionStorageRecoverySourceSelection;
  private editorPanel: vscode.WebviewPanel | undefined;
  private panelView: vscode.WebviewView | undefined;
  private appliedStartupConfiguration: CanvasStartupConfiguration;
  private attentionNotificationBridgeMode: CanvasAttentionNotificationBridgeMode;
  private enabledAttentionSignals: ExecutionAttentionSignalKind[];
  private strongTerminalAttentionReminderMode: CanvasStrongTerminalAttentionReminderMode;
  private agentAbnormalOutputTextNotificationMode: CanvasAgentAbnormalOutputTextNotificationMode;
  private fileFilterState: CanvasFileFilterState;
  private canvasTemplateInitialized: boolean;
  private state: CanvasPrototypeState;
  private activeSurface: CanvasSurfaceLocation | undefined;
  private readonly lastVisibleCanvasCenterBySurface: Partial<Record<CanvasSurfaceLocation, CanvasNodePosition>> = {};
  private readonly surfaceMode: Partial<Record<CanvasSurfaceLocation, CanvasSurfaceMode>> = {};
  private readonly surfaceReady: Record<CanvasSurfaceLocation, boolean> = {
    editor: false,
    panel: false
  };
  private readonly surfaceLifecycle: Record<CanvasSurfaceLocation, CanvasSurfaceLifecycleState> = {
    editor: {
      generation: 0,
      ready: false,
      bootstrapAck: false
    },
    panel: {
      generation: 0,
      ready: false,
      bootstrapAck: false
    }
  };
  private readonly pendingVisibilityRestore: Record<CanvasSurfaceLocation, boolean> = {
    editor: false,
    panel: false
  };
  private currentWebviewRemoteAuthority: string | undefined;
  private currentWebviewRemoteAuthorityProbeUri: string | undefined;
  private currentWebviewRemoteAuthorityProbeError: string | undefined;
  private didScheduleNoteMarkdownCurrentHostRecanonicalize = false;
  private readonly pendingVisibilityRestoreFocus: Partial<Record<CanvasSurfaceLocation, boolean>> = {};
  private readonly pendingWorkspaceRootFocusReplay: Partial<Record<CanvasSurfaceLocation, PendingWorkspaceRootFocusReplay>> = {};
  private readonly agentSessions = new Map<string, ManagedExecutionSession>();
  private readonly terminalSessions = new Map<string, ManagedExecutionSession>();
  private readonly pendingTerminalInitialInputs = new Map<string, string>();
  private readonly pendingTerminalInitialInputDispatches = new Map<string, PendingTerminalInitialInputDispatch>();
  private readonly runtimeSessionBindings = new Map<
    string,
    {
      nodeId: string;
      kind: ExecutionNodeKind;
      runtimeBackend: RuntimeHostBackendKind;
      runtimeSessionId: string;
      runtimeStoragePath: string;
    }
  >();
  private readonly sidebarStateEmitter = new vscode.EventEmitter<CanvasSidebarState>();
  private readonly templateCatalogEmitter = new vscode.EventEmitter<void>();
  private readonly diagnosticHostMessages: CanvasHostMessageDiagnosticRecord[] = [];
  private readonly executionFileLinkResolveDiagnostics: ExecutionFileLinkResolveDiagnosticSample[] = [];
  private readonly executionPerformanceDiagnostics: ExecutionPerformanceDiagnosticSample[] = [];
  private readonly executionFileLinkResolveQueueByNode = new Map<string, Promise<void>>();
  private readonly executionFileLinkResolveCache: ExecutionFileLinkResolveCacheState = {
    entries: new Map(),
    inFlight: new Map(),
    lastBackgroundStartedAt: 0
  };
  private readonly testHostMessages: HostToWebviewMessage[] = [];
  private readonly testDiagnosticEvents: CanvasTestDiagnosticEvent[] = [];
  private readonly surfaceMessageWebview: Partial<Record<CanvasSurfaceLocation, vscode.Webview>> = {};
  private readonly renderedWebviewLifecycle = new WeakMap<vscode.Webview, WebviewLifecycleIdentity>();
  private readonly pendingBootstrapHostMessages: Partial<Record<CanvasSurfaceLocation, HostToWebviewMessage[]>> = {};
  private readonly pendingWebviewProbeRequests = new Map<string, PendingWebviewProbeRequest>();
  private readonly pendingWebviewDomActionRequests = new Map<string, PendingWebviewDomActionRequest>();
  private readonly resolvedExecutionFileLinks = new Map<
    string,
    { nodeId: string; kind: ExecutionNodeKind; resolved?: ResolvedExecutionFileLink }
  >();
  private readonly pendingRuntimeSupervisorOperations = new Set<Promise<unknown>>();
  private readonly executionSessionOperationTokens = new Map<string, number>();
  private pendingWorkspaceStateUpdate: Promise<void> = Promise.resolve();
  private pendingCanvasStatePersist: PendingCanvasStatePersist | undefined;
  private pendingCanvasStatePersistFlush: Promise<void> | undefined;
  private pendingCanvasStatePersistTimer: NodeJS.Timeout | undefined;
  private hostEventLoopLagMonitorTimer: NodeJS.Timeout | undefined;
  private hostEventLoopLagMonitorExpectedAtMs = 0;
  private readonly scheduledExecutionOutputPosts = new Map<string, ScheduledExecutionOutputPost>();
  private executionOutputSchedulerTimer: NodeJS.Timeout | undefined;
  private recentExecutionInputPriority: ExecutionInputPriorityState | undefined;
  private lastPersistedCanvasSnapshotError: string | undefined;
  private lastPersistedCanvasSnapshotWrittenAt: string | undefined;
  private multiRootOverlay: CanvasMultiRootOverlay | undefined;
  private lastLoadedRootLocalStates: CanvasRootLocalStateSnapshot[] = [];
  private lastComposedWorkspaceRootPaths: string[] = [];
  private pendingWorkspaceRootPlacement:
    | {
        rootPaths: string[];
        preferredCenter?: CanvasNodePosition;
      }
    | undefined;
  private readonly runtimeSupervisorClients = new Map<string, RuntimeSupervisorClient>();
  private preferredRuntimeHostBackendKind: RuntimeHostBackendKind | undefined;
  private preferredRuntimeHostBackendFallbackReason: string | undefined;
  // Resolved CLI paths are observations of the current shell/workspace environment, not persisted user choices.
  private readonly agentCliResolutionCache: Record<string, AgentCliResolutionCacheEntry>;
  private readonly agentFileActivitySessions = new Map<string, AgentFileActivitySession>();
  private readonly noteMarkdownFileWatchers = new Map<string, NoteMarkdownFileWatcher>();
  private readonly noteMarkdownFileRefreshTimers = new Map<string, NodeJS.Timeout>();
  private readonly activeAssociatedNoteMarkdownEdits = new Map<string, ActiveAssociatedNoteMarkdownEdit>();
  private readonly noteMarkdownDropResourceKeysInProgress = new Set<string>();
  private lastUnavailableConfiguredTerminalShellWarningKey: string | undefined;
  private readonly resolvedShellEnvironmentPatchPromises = new Map<string, Promise<ResolvedShellEnvironmentPatch>>();
  private readonly resolvedShellEnvironmentPatches = new Map<string, ResolvedShellEnvironmentPatch>();

  public readonly onDidChangeSidebarState = this.sidebarStateEmitter.event;
  public readonly onDidChangeTemplateCatalog = this.templateCatalogEmitter.event;

  public constructor(private readonly context: vscode.ExtensionContext) {
    this.agentCliResolutionCache = {};
    this.rawExtensionStoragePath = this.context.storageUri?.fsPath ?? this.context.globalStorageUri.fsPath;
    this.canvasTemplateStore = new CanvasTemplateStore(
      path.join(this.context.extensionUri.fsPath, 'resources', 'templates'),
      buildCanvasTemplateStorageLocations(this.context)
    );
    this.appliedStartupConfiguration = this.readStartupConfiguration();
    this.attentionNotificationBridgeMode = this.readAttentionNotificationBridgeMode();
    this.enabledAttentionSignals = this.readEnabledAttentionSignals();
    this.strongTerminalAttentionReminderMode = this.readStrongTerminalAttentionReminderMode();
    this.agentAbnormalOutputTextNotificationMode = this.readAgentAbnormalOutputTextNotificationMode();
    this.refreshStorageRecoverySelection();
    this.fileFilterState = this.loadStoredCanvasFileFilterState();
    this.state = this.loadReconciledState();
    this.lastComposedWorkspaceRootPaths = this.getMultiRootWorkspaceFoldersForComposition().map((folder) => folder.path);
    this.canvasTemplateInitialized = this.readCanvasTemplateInitializedFlag(this.state);
    this.activeSurface = this.loadStoredSurface();
    this.persistState({ reason: 'state-initialized' });
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
    context.subscriptions.push(this.sidebarStateEmitter, this.templateCatalogEmitter);
    this.startHostEventLoopLagMonitor();
    context.subscriptions.push({
      dispose: () => {
        if (this.hostEventLoopLagMonitorTimer) {
          clearTimeout(this.hostEventLoopLagMonitorTimer);
          this.hostEventLoopLagMonitorTimer = undefined;
        }
        if (this.executionOutputSchedulerTimer) {
          clearTimeout(this.executionOutputSchedulerTimer);
          this.executionOutputSchedulerTimer = undefined;
        }
        this.scheduledExecutionOutputPosts.clear();
      }
    });

    context.subscriptions.push(
      vscode.workspace.onDidGrantWorkspaceTrust(() => {
        this.recordDiagnosticEvent('workspace/trustGranted');
        this.state = this.loadReconciledState();
        this.canvasTemplateInitialized = this.readCanvasTemplateInitializedFlag(this.state);
        this.persistState({ reason: 'workspace-trust-granted' });
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

    const onDidChangeShell = (vscode.env as unknown as { onDidChangeShell?: vscode.Event<string> }).onDidChangeShell;
    if (onDidChangeShell) {
      context.subscriptions.push(
        onDidChangeShell(() => {
          if (getConfiguredTerminalShell().resolutionSource !== 'default-shell') {
            return;
          }

          this.invalidateResolvedShellEnvironmentPatch();
          this.clearAgentCliResolutionCache();
          if (this.refreshConfiguredTerminalShellMetadata()) {
            this.postState('host/stateUpdated');
          }
          this.notifySidebarStateChanged();
        })
      );
    }

    context.subscriptions.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        this.invalidateResolvedShellEnvironmentPatch();
        this.clearAgentCliResolutionCache();
        const previousWorkspaceRootPaths = this.lastComposedWorkspaceRootPaths;
        const nextWorkspaceRootPaths = this.getMultiRootWorkspaceFoldersForComposition().map((folder) => folder.path);
        const addedWorkspaceRootPaths = nextWorkspaceRootPaths.filter(
          (rootPath) => !previousWorkspaceRootPaths.includes(rootPath)
        );
        const preferredCenter = this.resolvePreferredCanvasCenter();
        this.pendingWorkspaceRootPlacement = addedWorkspaceRootPaths.length > 0
          ? {
              rootPaths: addedWorkspaceRootPaths,
              preferredCenter
            }
          : undefined;
        try {
          this.state = this.loadReconciledState();
        } finally {
          this.pendingWorkspaceRootPlacement = undefined;
        }
        this.lastComposedWorkspaceRootPaths = nextWorkspaceRootPaths;
        const focusedRootGroup = this.resolveWorkspaceRootGroupForAddedFolder(addedWorkspaceRootPaths);
        this.reconcileDefaultExecutionMetadataCwd();
        this.refreshConfiguredTerminalShellMetadata();
        this.persistState({ reason: 'workspace-folders-changed' });
        this.postState('host/stateUpdated');
        if (focusedRootGroup) {
          this.recordDiagnosticEvent('workspaceRoot/focusAddedRoot', {
            rootPath: focusedRootGroup.workspaceRootPath,
            groupId: focusedRootGroup.groupId
          });
          this.focusWorkspaceRootInCanvas(focusedRootGroup.groupId);
        }
        this.notifySidebarStateChanged();
        this.scheduleRestoreLiveRuntimeSessions();
      })
    );

    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        const defaultSurfaceChanged = event.affectsConfiguration(CONFIG_KEYS.canvasDefaultSurface);
        const runtimePersistenceChanged = event.affectsConfiguration(CONFIG_KEYS.runtimePersistenceEnabled);
        const defaultAgentProviderChanged = event.affectsConfiguration(CONFIG_KEYS.agentDefaultProvider);
        const agentCodexCommandChanged = event.affectsConfiguration(CONFIG_KEYS.agentCodexCommand);
        const agentClaudeCommandChanged = event.affectsConfiguration(CONFIG_KEYS.agentClaudeCommand);
        const agentCodexDefaultArgsChanged = event.affectsConfiguration(CONFIG_KEYS.agentCodexDefaultArgs);
        const agentClaudeDefaultArgsChanged = event.affectsConfiguration(CONFIG_KEYS.agentClaudeDefaultArgs);
        const canvasOverviewModeChanged = event.affectsConfiguration(CONFIG_KEYS.canvasOverviewMode);
        const canvasOverviewZoomThresholdChanged = event.affectsConfiguration(
          CONFIG_KEYS.canvasOverviewZoomThreshold
        );
        const canvasMultiRootPresentationModeChanged = event.affectsConfiguration(
          CONFIG_KEYS.canvasMultiRootPresentationMode
        );
        const canvasLinkOpenModeChanged = event.affectsConfiguration(CONFIG_KEYS.canvasLinkOpenMode);
        const canvasWorkspaceRootWatermarksChanged = event.affectsConfiguration(
          CONFIG_KEYS.canvasWorkspaceRootWatermarksEnabled
        );
        const filesFeatureEnabledChanged = event.affectsConfiguration(CONFIG_KEYS.filesFeatureEnabled);
        const filesPresentationModeChanged = event.affectsConfiguration(CONFIG_KEYS.filesPresentationMode);
        const fileNodeDisplayStyleChanged = event.affectsConfiguration(CONFIG_KEYS.fileNodeDisplayStyle);
        const filesNodeDisplayModeChanged = event.affectsConfiguration(CONFIG_KEYS.filesNodeDisplayMode);
        const filesPathDisplayModeChanged = event.affectsConfiguration(CONFIG_KEYS.filesPathDisplayMode);
        const attentionNotificationBridgeChanged =
          event.affectsConfiguration(CONFIG_KEYS.notificationAttentionSignalBridge) ||
          event.affectsConfiguration(CONFIG_KEYS.legacyNotificationBridgeTerminalAttentionSignals) ||
          event.affectsConfiguration(CONFIG_KEYS.legacyNotificationPreferNotifierCompanion);
        const enabledAttentionSignalsChanged = event.affectsConfiguration(
          CONFIG_KEYS.enabledAttentionSignals
        );
        const strongTerminalAttentionReminderChanged = event.affectsConfiguration(
          CONFIG_KEYS.notificationStrongTerminalAttentionReminder
        );
        const agentAbnormalOutputTextNotificationsChanged = event.affectsConfiguration(
          CONFIG_KEYS.agentAbnormalOutputTextNotifications
        );
        const terminalShellChanged = event.affectsConfiguration(CONFIG_KEYS.terminalShell);
        const terminalShellPathChanged = event.affectsConfiguration(CONFIG_KEYS.terminalShellPath);
        const terminalInheritEnvChanged = event.affectsConfiguration(CONFIG_KEYS.terminalInheritEnv);
        const terminalShellArgsChanged = event.affectsConfiguration(CONFIG_KEYS.terminalShellArgs);
        const terminalScrollbackChanged = event.affectsConfiguration('terminal.integrated.scrollback');
        const multiCursorModifierChanged = event.affectsConfiguration('editor.multiCursorModifier');
        const terminalWordSeparatorsChanged = event.affectsConfiguration(
          'terminal.integrated.wordSeparators'
        );
        const workbenchIconThemeChanged = event.affectsConfiguration('workbench.iconTheme');
        const sidebarStateChanged =
          defaultSurfaceChanged ||
          runtimePersistenceChanged ||
          filesFeatureEnabledChanged ||
          filesPresentationModeChanged ||
          fileNodeDisplayStyleChanged ||
          filesNodeDisplayModeChanged ||
          filesPathDisplayModeChanged ||
          agentCodexCommandChanged ||
          agentClaudeCommandChanged ||
          terminalShellChanged ||
          terminalShellPathChanged ||
          attentionNotificationBridgeChanged ||
          enabledAttentionSignalsChanged ||
          strongTerminalAttentionReminderChanged ||
          agentAbnormalOutputTextNotificationsChanged;

        if (defaultSurfaceChanged || runtimePersistenceChanged || filesFeatureEnabledChanged) {
          void this.notifyReloadRequiredConfigurationChanged({
            defaultSurfaceChanged,
            runtimePersistenceChanged,
            filesFeatureEnabledChanged
          });
        }

        if (
          !defaultAgentProviderChanged &&
          !agentCodexCommandChanged &&
          !agentClaudeCommandChanged &&
          !agentCodexDefaultArgsChanged &&
          !agentClaudeDefaultArgsChanged &&
          !canvasOverviewModeChanged &&
          !canvasOverviewZoomThresholdChanged &&
          !canvasMultiRootPresentationModeChanged &&
          !canvasLinkOpenModeChanged &&
          !canvasWorkspaceRootWatermarksChanged &&
          !filesPresentationModeChanged &&
          !fileNodeDisplayStyleChanged &&
          !filesNodeDisplayModeChanged &&
          !filesPathDisplayModeChanged &&
          !attentionNotificationBridgeChanged &&
          !enabledAttentionSignalsChanged &&
          !strongTerminalAttentionReminderChanged &&
          !agentAbnormalOutputTextNotificationsChanged &&
          !terminalShellChanged &&
          !terminalShellPathChanged &&
          !terminalInheritEnvChanged &&
          !terminalShellArgsChanged &&
          !terminalScrollbackChanged &&
          !multiCursorModifierChanged &&
          !terminalWordSeparatorsChanged &&
          !workbenchIconThemeChanged
        ) {
          if (sidebarStateChanged) {
            this.notifySidebarStateChanged();
          }
          return;
        }

        void this
          .handleRuntimeConfigurationChanged({
            defaultAgentProviderChanged,
            agentCodexCommandChanged,
            agentClaudeCommandChanged,
            agentCodexDefaultArgsChanged,
            agentClaudeDefaultArgsChanged,
            canvasOverviewModeChanged,
            canvasOverviewZoomThresholdChanged,
            canvasMultiRootPresentationModeChanged,
            canvasLinkOpenModeChanged,
            canvasWorkspaceRootWatermarksChanged,
            filesPresentationModeChanged,
            fileNodeDisplayStyleChanged,
            filesNodeDisplayModeChanged,
            filesPathDisplayModeChanged,
            attentionNotificationBridgeChanged,
            enabledAttentionSignalsChanged,
            strongTerminalAttentionReminderChanged,
            agentAbnormalOutputTextNotificationsChanged,
            terminalShellChanged,
            terminalShellPathChanged,
            terminalInheritEnvChanged,
            terminalShellArgsChanged,
            terminalScrollbackChanged,
            multiCursorModifierChanged,
            terminalWordSeparatorsChanged,
            workbenchIconThemeChanged
          })
          .finally(() => {
            if (sidebarStateChanged) {
              this.notifySidebarStateChanged();
            }
          });
      })
    );

    context.subscriptions.push(
      new vscode.Disposable(() => {
        this.clearPendingWorkspaceRootFocusReplay();
        this.disposeRuntimeSupervisorClients();
        this.disposeNoteMarkdownFileWatchers();
      })
    );

    context.subscriptions.push(
      vscode.workspace.onDidSaveTextDocument((document) => {
        void this.refreshAssociatedMarkdownNotesForDocument(document);
      }),
      vscode.window.onDidChangeWindowState((windowState) => {
        if (windowState.focused) {
          void this.refreshAllAssociatedMarkdownNotes();
        }
      })
    );

    this.syncNoteMarkdownFileWatchers();
    void this.refreshAllAssociatedMarkdownNotes();
    this.scheduleRestoreLiveRuntimeSessions();
    void this.notifyIfConfiguredTerminalShellUnavailable();
  }

  public async revealOrCreate(surface: CanvasSurfaceLocation = this.getConfiguredSurface()): Promise<void> {
    await this.revealSurface(surface);
  }

  public async revealOrCreateCurrentCanvasSurface(): Promise<void> {
    await this.revealSurface(this.getCurrentOpenCanvasSurface() ?? this.getConfiguredSurface());
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
    const fileConfiguration = this.getCanvasFileViewConfiguration();
    const terminalShell = getConfiguredTerminalShell();
    const agentCliConfig = this.getAgentCliConfig();

    return {
      canvasSurface,
      surfaceLocation,
      configuredSurface,
      runtimePersistenceEnabled: this.appliedStartupConfiguration.runtimePersistenceEnabled,
      notificationBridgeMode: this.attentionNotificationBridgeMode,
      enabledAttentionSignals: [...this.enabledAttentionSignals],
      notificationStrongReminderMode: this.strongTerminalAttentionReminderMode,
      agentAbnormalOutputTextNotificationMode: this.agentAbnormalOutputTextNotificationMode,
      filesFeatureEnabled: this.appliedStartupConfiguration.filesFeatureEnabled,
      filePresentationMode: fileConfiguration.presentationMode,
      fileNodeDisplayStyle: fileConfiguration.displayStyle,
      fileNodeDisplayMode: fileConfiguration.nodeDisplayMode,
      filePathDisplayMode: fileConfiguration.pathDisplayMode,
      terminalShellConfiguredValue: terminalShell.configuredPath || terminalShell.configuredShell,
      terminalShellPath: this.resolveTerminalShellPathForConfigurationCwd(terminalShell.resolvedPath),
      agentCodexCommand: agentCliConfig.codexCommand,
      agentClaudeCommand: agentCliConfig.claudeCommand,
      nodeCount: this.state.nodes.length,
      runningExecutionCount: this.agentSessions.size + this.terminalSessions.size,
      workspaceTrusted: vscode.workspace.isTrusted,
      creatableKinds: ['agent', 'terminal', 'note'],
      fileFilters: cloneJsonValue(this.fileFilterState)
    };
  }

  public getCreateNodeBlockedReason(kind: CanvasCreatableNodeKind): string | undefined {
    const blockReason = this.getCreateNodeBlockReasonCode(kind);
    return blockReason ? describeCreateNodeBlockReason(kind, blockReason) : undefined;
  }

  public async showCreateNodeBlockedReasonModal(kind: CanvasCreatableNodeKind): Promise<boolean> {
    const message = this.getCreateNodeBlockedReason(kind);
    if (!message) {
      return false;
    }

    await vscode.window.showWarningMessage(message, { modal: true });
    return true;
  }

  public isFilesFeatureEnabled(): boolean {
    return this.appliedStartupConfiguration.filesFeatureEnabled;
  }

  public getCanvasNodes(): CanvasNodeSummary[] {
    return cloneJsonValue(this.state.nodes);
  }

  public getCanvasSidebarNodeListSnapshot(): CanvasSidebarNodeListSnapshot {
    return cloneJsonValue({
      nodes: this.state.nodes,
      groups: this.state.groups ?? []
    });
  }

  public getWorkspaceFoldersForDisplay(): CanvasRuntimeContext['workspaceFolders'] {
    return (vscode.workspace.workspaceFolders ?? []).map((workspaceFolder) => ({
      name: workspaceFolder.name,
      path: workspaceFolder.uri.fsPath
    }));
  }

  private getMultiRootWorkspaceFoldersForComposition(): CanvasMultiRootWorkspaceFolder[] {
    return (vscode.workspace.workspaceFolders ?? []).map((workspaceFolder) => ({
      name: workspaceFolder.name,
      path: normalizeWorkspaceRootPathForComposition(workspaceFolder.uri.fsPath)
    }));
  }

  public getCanvasTemplateAssociatedNoteSaveItems(): CanvasTemplateAssociatedNoteSaveFormItem[] {
    return this.state.nodes.flatMap((node) => {
      if (node.kind !== 'note') {
        return [];
      }

      const source = ensureNoteMetadata(node).contentSource;
      if (source?.kind !== 'markdown-file') {
        return [];
      }

      const relativePath = this.resolveCanvasTemplateRelativePathForAssociatedNoteSource(source);
      return [
        {
          nodeId: node.id,
          title: node.title,
          displayPath: source.fullDisplayPath ?? source.displayPath,
          status: source.status,
          isWorkspaceRelative: relativePath !== undefined,
          defaultMode: relativePath ? 'workspace-file-path-only' : 'embedded-snapshot'
        }
      ];
    });
  }

  public getCanvasFileFilterState(): CanvasFileFilterState {
    return cloneJsonValue(this.fileFilterState);
  }

  public getUserCanvasTemplateDirectoryPath(): string {
    return this.canvasTemplateStore.getUserTemplateDir();
  }

  public getCanvasTemplateStorageLocations(): CanvasTemplateStorageLocation[] {
    return this.canvasTemplateStore.getUserTemplateLocations();
  }

  public getDefaultCanvasTemplateId(): string {
    const storedValue = this.context.globalState.get<string>(CANVAS_DEFAULT_TEMPLATE_ID_GLOBAL_STATE_KEY);
    return typeof storedValue === 'string' && storedValue.trim().length > 0
      ? storedValue.trim()
      : DEFAULT_BUILTIN_CANVAS_TEMPLATE_ID;
  }

  public async getCanvasTemplateCatalog(): Promise<CanvasTemplateCatalog> {
    return this.canvasTemplateStore.listTemplates();
  }

  public async refreshCanvasTemplateCatalog(): Promise<CanvasTemplateCatalog> {
    const catalog = await this.canvasTemplateStore.listTemplates();
    this.notifyTemplateCatalogChanged();
    return catalog;
  }

  public async saveCurrentCanvasAsTemplate(
    name: string,
    agentProviderSelection: CanvasTemplateSaveAgentProviderSelection,
    options?: {
      overwriteTemplateId?: string;
      targetRootPath?: string;
      relativeDirectory?: string;
      associatedNoteSaveModes?: Readonly<Record<string, CanvasTemplateAssociatedNoteSaveMode>>;
    }
  ): Promise<CanvasStoredTemplate> {
    if ((vscode.workspace.workspaceFolders?.length ?? 0) > 1) {
      throw new Error('多根 workspace 中暂不支持保存整个组合视图为模板；请单独打开目标 root 后保存模板。');
    }

    const catalog = await this.getCanvasTemplateCatalog();
    const overwriteTemplate = options?.overwriteTemplateId
      ? findCanvasTemplateById(catalog.templates, options.overwriteTemplateId)
      : undefined;
    if (overwriteTemplate && overwriteTemplate.template.category !== 'user') {
      throw new Error('内置模板不能被覆盖。');
    }

    const now = new Date().toISOString();
    const associatedNoteSaveSelection = await this.resolveAssociatedNoteTemplateSaveSelection(
      options?.associatedNoteSaveModes ?? {}
    );
    const capture = captureCanvasTemplateFromState({
      state: this.buildStateForCanvasTemplateCapture(),
      name,
      templateId: overwriteTemplate?.template.id ?? `user-template-${randomUUID()}`,
      category: 'user',
      agentProviderSelection,
      associatedNoteSaveSelection,
      now
    });
    const template = capture.template;
    if (overwriteTemplate) {
      template.createdAt = overwriteTemplate.template.createdAt;
      template.updatedAt = now;
    }

    const savedTemplate = await this.canvasTemplateStore.writeUserTemplate(template, {
      filePath: overwriteTemplate?.filePath,
      targetRootPath: options?.targetRootPath,
      relativeDirectory: options?.relativeDirectory
    });
    this.canvasTemplateInitialized = true;
    this.notifyTemplateCatalogChanged();
    return savedTemplate;
  }

  private buildStateForCanvasTemplateCapture(): CanvasPrototypeState {
    return {
      ...this.state,
      nodes: this.state.nodes.map((node) => {
        if (node.kind !== 'agent') {
          return node;
        }

        const metadata = node.metadata?.agent;
        if (!metadata) {
          return node;
        }

        const launchSnapshot = this.resolveAgentFreshLaunch(metadata.provider, metadata);
        return {
          ...node,
          metadata: {
            ...node.metadata,
            agent: {
              ...metadata,
              templateArgv: [...launchSnapshot.launchArgs]
            }
          }
        };
      })
    };
  }

  private async resolveAssociatedNoteTemplateSaveSelection(
    modes: Readonly<Record<string, CanvasTemplateAssociatedNoteSaveMode>>
  ): Promise<Record<string, CanvasTemplateAssociatedNoteSaveSelection>> {
    const selection: Record<string, CanvasTemplateAssociatedNoteSaveSelection> = {};

    for (const [nodeId, mode] of Object.entries(modes)) {
      const node = this.state.nodes.find((candidate) => candidate.id === nodeId && candidate.kind === 'note');
      const noteMetadata = node ? ensureNoteMetadata(node) : undefined;
      const source = noteMetadata?.contentSource;
      if (!node || !noteMetadata || source?.kind !== 'markdown-file') {
        continue;
      }

      if (mode === 'workspace-file-path-only') {
        selection[nodeId] = {
          mode,
          relativePath: this.requireCanvasTemplateRelativePathForAssociatedNote(node, source)
        };
        continue;
      }

      const content = await this.readAssociatedMarkdownContentForTemplateSave(node, source, mode);
      if (mode === 'embedded-snapshot') {
        if (content.length > NOTE_EMBEDDED_CONTENT_MAX_LENGTH) {
          throw new Error(
            `关联 Markdown Note「${node.title}」的内容超过普通 Note 8,000 字符上限，请改选“保留 workspace 相对路径和文件内容”（仅 workspace 内文件可用）或先调整关联文件。`
          );
        }
        selection[nodeId] = { mode, content };
        continue;
      }

      selection[nodeId] = {
        mode,
        content,
        relativePath: this.requireCanvasTemplateRelativePathForAssociatedNote(node, source)
      };
    }

    return selection;
  }

  private async readAssociatedMarkdownContentForTemplateSave(
    node: CanvasNodeSummary,
    source: MarkdownFileNoteContentSource,
    mode: CanvasTemplateAssociatedNoteSaveMode
  ): Promise<string> {
    if (source.status !== 'ok' || source.recoverableDraft) {
      throw new Error(
        `关联 Markdown Note「${node.title}」当前不是可保存状态（${source.status}），请先恢复关联文件后再保存模板。`
      );
    }

    const uri = this.parseCurrentHostNoteMarkdownUri(source.resourceUri);
    if (!uri) {
      throw new Error(`关联 Markdown Note「${node.title}」的文件 URI 无法解析。`);
    }

    if (mode === 'workspace-file-with-content') {
      this.requireCanvasTemplateRelativePathForAssociatedNote(node, source);
    }

    const readResult = await this.readNoteMarkdownFile(uri);
    if (readResult.status !== 'ok') {
      throw new Error(
        `无法读取关联 Markdown Note「${node.title}」的落盘内容：${readResult.lastError ?? readResult.status}`
      );
    }

    return readResult.content;
  }

  private requireCanvasTemplateRelativePathForAssociatedNote(
    node: CanvasNodeSummary,
    source: MarkdownFileNoteContentSource
  ): string {
    const relativePath = this.resolveCanvasTemplateRelativePathForAssociatedNoteSource(source);
    if (!relativePath) {
      throw new Error(`关联 Markdown Note「${node.title}」不在当前 workspace 内，不能保存为 workspace 相对文件关联。`);
    }
    return relativePath;
  }

  public async importCanvasTemplateFromPath(
    sourcePath: string,
    options?: {
      overwriteTemplateId?: string;
      nameOverride?: string;
      targetRootPath?: string;
      relativeDirectory?: string;
    }
  ): Promise<CanvasStoredTemplate> {
    const importedTemplate = await this.canvasTemplateStore.readTemplateFile(sourcePath, {
      forceCategory: 'user'
    });
    const catalog = await this.getCanvasTemplateCatalog();
    const overwriteTemplate = options?.overwriteTemplateId
      ? findCanvasTemplateById(catalog.templates, options.overwriteTemplateId)
      : undefined;
    if (overwriteTemplate && overwriteTemplate.template.category !== 'user') {
      throw new Error('内置模板不能被覆盖。');
    }

    const now = new Date().toISOString();
    const nextTemplate = cloneCanvasTemplate(importedTemplate.template);
    nextTemplate.id = overwriteTemplate?.template.id ?? `user-template-${randomUUID()}`;
    nextTemplate.category = 'user';
    nextTemplate.name = options?.nameOverride?.trim() || nextTemplate.name;
    nextTemplate.updatedAt = now;
    nextTemplate.createdAt = overwriteTemplate?.template.createdAt ?? now;

    const savedTemplate = await this.canvasTemplateStore.writeUserTemplate(nextTemplate, {
      filePath: overwriteTemplate?.filePath,
      targetRootPath: options?.targetRootPath,
      relativeDirectory: options?.relativeDirectory
    });
    this.notifyTemplateCatalogChanged();
    return savedTemplate;
  }

  public async readCanvasTemplateFromPath(sourcePath: string): Promise<CanvasStoredTemplate> {
    return this.canvasTemplateStore.readTemplateFile(sourcePath, {
      forceCategory: 'user'
    });
  }

  public async exportCanvasTemplateById(templateId: string, target: string | vscode.Uri): Promise<void> {
    const catalog = await this.getCanvasTemplateCatalog();
    const storedTemplate = findCanvasTemplateById(catalog.templates, templateId);
    if (!storedTemplate) {
      throw new Error('目标模板不存在。');
    }

    if (typeof target === 'string') {
      await this.canvasTemplateStore.exportTemplateToFile(storedTemplate.template, target);
      return;
    }

    await vscode.workspace.fs.createDirectory(getUriDirectory(target));
    await vscode.workspace.fs.writeFile(
      target,
      new TextEncoder().encode(encodeCanvasTemplateDocument(storedTemplate.template))
    );
  }

  public async deleteCanvasTemplateById(templateId: string): Promise<void> {
    const catalog = await this.getCanvasTemplateCatalog();
    const storedTemplate = findCanvasTemplateById(catalog.templates, templateId);
    if (!storedTemplate) {
      throw new Error('目标模板不存在。');
    }
    if (storedTemplate.template.category !== 'user') {
      throw new Error('内置模板不能删除。');
    }

    await this.canvasTemplateStore.deleteUserTemplate(storedTemplate.filePath);
    await this.reconcileDefaultCanvasTemplateId();
    this.notifyTemplateCatalogChanged();
  }

  public async setDefaultCanvasTemplateById(templateId: string): Promise<void> {
    const catalog = await this.getCanvasTemplateCatalog();
    const storedTemplate = findCanvasTemplateById(catalog.templates, templateId);
    if (!storedTemplate) {
      throw new Error('目标模板不存在。');
    }

    await this.context.globalState.update(CANVAS_DEFAULT_TEMPLATE_ID_GLOBAL_STATE_KEY, storedTemplate.template.id);
    this.notifyTemplateCatalogChanged();
  }

  public async applyDefaultCanvasTemplate(options?: {
    reset?: boolean;
    visibleCenter?: CanvasNodePosition;
    targetGroupId?: string;
    focusAppliedNodes?: boolean;
    quietOnFailure?: boolean;
  }): Promise<string[]> {
    const defaultTemplate = await this.resolveDefaultCanvasTemplateRecord();
    if (!defaultTemplate) {
      throw new Error('当前没有可用的默认模板。');
    }

    return this.applyCanvasTemplateRecord(defaultTemplate, options);
  }

  public async applyCanvasTemplateById(
    templateId: string,
    options?: {
      reset?: boolean;
      visibleCenter?: CanvasNodePosition;
      targetGroupId?: string;
      focusAppliedNodes?: boolean;
      quietOnFailure?: boolean;
    }
  ): Promise<string[]> {
    const catalog = await this.getCanvasTemplateCatalog();
    const storedTemplate = findCanvasTemplateById(catalog.templates, templateId);
    if (!storedTemplate) {
      throw new Error('目标模板不存在。');
    }

    return this.applyCanvasTemplateRecord(storedTemplate, options);
  }

  public async resetDefaultCanvasTemplateWithConfirmation(options?: {
    visibleCenter?: CanvasNodePosition;
    targetGroupId?: string;
    focusAppliedNodes?: boolean;
    quietOnFailure?: boolean;
  }): Promise<string[] | undefined> {
    const defaultTemplate = await this.resolveDefaultCanvasTemplateRecord();
    if (!defaultTemplate) {
      throw new Error('当前没有可用的默认模板。');
    }

    if (!(await this.confirmCanvasTemplateReset('当前默认模板'))) {
      return undefined;
    }

    return this.applyCanvasTemplateRecord(defaultTemplate, {
      ...options,
      reset: true
    });
  }

  public async resetCanvasTemplateByIdWithConfirmation(
    templateId: string,
    options?: {
      visibleCenter?: CanvasNodePosition;
      targetGroupId?: string;
      focusAppliedNodes?: boolean;
      quietOnFailure?: boolean;
    }
  ): Promise<string[] | undefined> {
    const catalog = await this.getCanvasTemplateCatalog();
    const storedTemplate = findCanvasTemplateById(catalog.templates, templateId);
    if (!storedTemplate) {
      throw new Error('目标模板不存在。');
    }

    if (!(await this.confirmCanvasTemplateReset(`模板「${storedTemplate.template.name}」`))) {
      return undefined;
    }

    return this.applyCanvasTemplateRecord(storedTemplate, {
      ...options,
      reset: true
    });
  }

  public focusCanvasTemplateNodeGroup(nodeIds: readonly string[]): void {
    this.requestTemplateNodeGroupFocus(nodeIds);
  }

  public getDebugSnapshot(): CanvasDebugSnapshot {
    return {
      activeSurface: this.activeSurface,
      configuration: cloneJsonValue(this.buildDebugConfigurationSnapshot()),
      sidebar: cloneJsonValue(this.getSidebarState()),
      state: cloneJsonValue(stripNoteMarkdownRecoverableDraftContentFromCanvasState(this.state)),
      surfaceMode: cloneJsonValue(this.surfaceMode),
      surfaceReady: cloneJsonValue(this.surfaceReady),
      surfaceLifecycle: cloneJsonValue(this.surfaceLifecycle)
    };
  }

  public getRuntimeSupervisorStateForTest(): RuntimeSupervisorDebugStateForTest {
    if (!isTestHarnessMode(this.context.extensionMode)) {
      throw new Error('getRuntimeSupervisorStateForTest 仅在测试模式下可用。');
    }

    const registries: Partial<Record<RuntimeHostBackendKind, RuntimeSupervisorRegistryForTest>> = {};
    for (const backendKind of ['legacy-detached', 'systemd-user'] as const) {
      registries[backendKind] = this.collectRuntimeSupervisorRegistryForTest(backendKind);
    }

    return {
      pendingRuntimeSupervisorOperationCount: this.pendingRuntimeSupervisorOperations.size,
      bindings: Array.from(this.runtimeSessionBindings.values()).map((binding) => ({
        runtimeBackend: binding.runtimeBackend,
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

  public collectExecutionFileLinkResolveDiagnostics(): {
    samples: ExecutionFileLinkResolveDiagnosticSample[];
    summary: ExecutionFileLinkResolveDiagnosticsSummary;
  } {
    const samples = cloneJsonValue(this.executionFileLinkResolveDiagnostics);
    return {
      samples,
      summary: summarizeExecutionFileLinkResolveDiagnostics(samples)
    };
  }

  public collectExecutionPerformanceDiagnostics(): {
    samples: ExecutionPerformanceDiagnosticSample[];
    summary: ExecutionPerformanceDiagnosticsSummary;
  } {
    const samples = cloneJsonValue(this.executionPerformanceDiagnostics);
    return {
      samples,
      summary: summarizeExecutionPerformanceDiagnostics(samples)
    };
  }

  public async dumpCurrentHostDiagnostics(): Promise<CanvasHostDiagnosticsDumpResult> {
    await this.flushDeferredCanvasStatePersist('diagnostics');
    await this.waitForPendingWorkspaceStateUpdates();

    const capturedAt = new Date().toISOString();
    const outputDir = path.join(
      this.getHostDiagnosticsRootPath(),
      'current-host-diagnostics',
      createFileSystemSafeTimestamp(capturedAt)
    );
    await fs.promises.mkdir(outputDir, {
      recursive: true
    });

    const probeResults = await Promise.all(
      (['panel', 'editor'] as const).map((surface) => this.collectWebviewProbeDiagnostic(surface))
    );
    const debugSnapshot = this.getDebugSnapshot();
    const diagnosticHostMessages = cloneJsonValue(this.diagnosticHostMessages);
    const executionFileLinkResolveDiagnostics = this.collectExecutionFileLinkResolveDiagnostics();
    const executionPerformanceDiagnostics = this.collectExecutionPerformanceDiagnostics();
    const agentCliConfig = this.getAgentCliConfig();
    const defaultCwd = this.getTerminalWorkingDirectory();
    const shellEnvironmentPatch = await this.getResolvedShellEnvironmentPatch(
      this.buildBaseExecutionEnvironment(defaultCwd),
      'interactive-login',
      defaultCwd
    );
    const persistedSnapshotPath = this.getPersistedCanvasSnapshotPath();
    const persistedSnapshot = this.loadPersistedCanvasSnapshot();
    const noteMarkdownDiagnostics = this.collectNoteMarkdownHostDiagnostics();
    const diagnosticEvents = cloneJsonValue(this.testDiagnosticEvents);
    const summaryPath = path.join(outputDir, 'summary.json');
    const webviewLifecycleSummary = this.buildWebviewLifecycleDiagnosticsSummary(
      capturedAt,
      debugSnapshot,
      diagnosticEvents,
      diagnosticHostMessages,
      probeResults
    );
    const webviewLifecycleSummaryPath = path.join(outputDir, 'webview-lifecycle-summary.json');
    const executionPerformanceDiagnosticsPath = path.join(outputDir, 'execution-performance-diagnostics.json');

    const summary = {
      capturedAt,
      extension: {
        id: this.context.extension.id,
        version:
          isRecord(this.context.extension.packageJSON) && typeof this.context.extension.packageJSON.version === 'string'
            ? this.context.extension.packageJSON.version
            : undefined,
        mode: describeExtensionMode(this.context.extensionMode)
      },
      diagnosticsSchema: {
        executionFileLinkResolve: 3,
        executionPerformance: EXECUTION_PERFORMANCE_DIAGNOSTICS_SCHEMA_VERSION,
        canvasGroupGeometry: 1
      },
      host: {
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.version,
        electronVersion: process.versions.electron,
        chromeVersion: process.versions.chrome,
        vscodeVersion: vscode.version,
        pid: process.pid
      },
      workspace: {
        trusted: vscode.workspace.isTrusted,
        folders: vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath) ?? [],
        outputRoot: outputDir
      },
      noteMarkdown: noteMarkdownDiagnostics,
      storage: {
        extensionStoragePath: this.getExtensionStoragePath(),
        recoverySourcePath: this.storageRecoverySelection.sourcePath,
        recoveryWritePath: this.storageRecoverySelection.writePath,
        recoverySelectionBasis: this.storageRecoverySelection.selectionBasis,
        persistedCanvasSnapshotPath: persistedSnapshotPath,
        persistedCanvasSnapshotExists: fs.existsSync(persistedSnapshotPath),
        persistedCanvasSnapshotWrittenAt: persistedSnapshot?.writtenAt,
        lastPersistedCanvasSnapshotError: this.lastPersistedCanvasSnapshotError
      },
      configuration: {
        activeSurface: this.activeSurface,
        surfaceMode: cloneJsonValue(this.surfaceMode),
        surfaceReady: cloneJsonValue(this.surfaceReady),
        surfaceLifecycle: cloneJsonValue(this.surfaceLifecycle),
        defaultSurface: this.getConfiguredSurface(),
        agentDefaultProvider: agentCliConfig.defaultProvider,
        agentCodexCommand: agentCliConfig.codexCommand,
        agentClaudeCommand: agentCliConfig.claudeCommand,
        ...this.buildDebugConfigurationSnapshot(shellEnvironmentPatch),
        runtimePersistenceEnabled: this.appliedStartupConfiguration.runtimePersistenceEnabled,
        filesFeatureEnabled: this.appliedStartupConfiguration.filesFeatureEnabled,
        preferredRuntimeHostBackendKind: this.preferredRuntimeHostBackendKind,
        preferredRuntimeHostBackendFallbackReason: this.preferredRuntimeHostBackendFallbackReason
      },
      diagnostics: {
        hostMessageCount: diagnosticHostMessages.length,
        hostMessageSummary: summarizeDiagnosticHostMessages(diagnosticHostMessages),
        executionFileLinkResolveSummary: executionFileLinkResolveDiagnostics.summary,
        executionPerformanceSummary: executionPerformanceDiagnostics.summary,
        executionClipboardSummary: summarizeExecutionClipboardDiagnostics(diagnosticEvents),
        diagnosticEventCount: diagnosticEvents.length,
        latestDiagnosticKinds: diagnosticEvents.slice(-20).map((event) => event.kind),
        webviewLifecycleStatus: webviewLifecycleSummary.status,
        webviewLifecyclePanelRestoreLikelyAffected: webviewLifecycleSummary.panelRestore.likelyAffected
      },
      webviewLifecycle: webviewLifecycleSummary,
      runtime: {
        runtimeSessionBindingCount: this.runtimeSessionBindings.size,
        pendingRuntimeSupervisorOperationCount: this.pendingRuntimeSupervisorOperations.size,
        executionSessions: {
          agent: this.collectManagedExecutionSessionDiagnostics('agent'),
          terminal: this.collectManagedExecutionSessionDiagnostics('terminal')
        }
      },
      probes: probeResults.map((result) => ({
        surface: result.surface,
        attached: result.attached,
        ready: result.ready,
        interactive: result.interactive,
        visibility: result.visibility,
        capturedAt: result.capturedAt,
        error: result.error,
        nodeCount: result.snapshot?.nodeCount ?? null
      }))
    };

    await Promise.all([
      writeJsonFile(summaryPath, summary),
      writeJsonFile(path.join(outputDir, 'debug-snapshot.json'), debugSnapshot),
      writeJsonFile(path.join(outputDir, 'host-messages.json'), diagnosticHostMessages),
      writeJsonFile(webviewLifecycleSummaryPath, webviewLifecycleSummary),
      writeJsonFile(
        path.join(outputDir, 'execution-file-link-resolve-diagnostics.json'),
        executionFileLinkResolveDiagnostics
      ),
      writeJsonFile(
        executionPerformanceDiagnosticsPath,
        executionPerformanceDiagnostics
      ),
      writeJsonFile(path.join(outputDir, 'diagnostic-events.json'), diagnosticEvents),
      writeJsonFile(path.join(outputDir, 'note-markdown-diagnostics.json'), noteMarkdownDiagnostics),
      writeJsonFile(
        path.join(outputDir, 'persisted-canvas-snapshot.json'),
        persistedSnapshot ?? {
          exists: false
        }
      ),
      ...probeResults.map((result) =>
        writeJsonFile(path.join(outputDir, `${result.surface}-probe.json`), result)
      )
    ]);

    return {
      outputDir,
      summaryPath,
      webviewLifecycleSummaryPath,
      executionPerformanceDiagnosticsPath,
      webviewLifecycleStatus: webviewLifecycleSummary.status,
      webviewLifecyclePanelRestoreLikelyAffected: webviewLifecycleSummary.panelRestore.likelyAffected
    };
  }

  private buildWebviewLifecycleDiagnosticsSummary(
    capturedAt: string,
    debugSnapshot: CanvasDebugSnapshot,
    diagnosticEvents: readonly CanvasTestDiagnosticEvent[],
    diagnosticHostMessages: readonly CanvasHostMessageDiagnosticRecord[],
    probeResults: readonly CanvasWebviewProbeDiagnosticResult[]
  ): CanvasWebviewLifecycleDiagnosticsSummary {
    const surfaces = (['panel', 'editor'] as const).map((surface) =>
      this.buildWebviewLifecycleSurfaceSummary(
        capturedAt,
        surface,
        debugSnapshot,
        diagnosticEvents,
        diagnosticHostMessages,
        probeResults.find((result) => result.surface === surface)
      )
    );
    const panelSummary = surfaces.find((surface) => surface.surface === 'panel');
    const panelRestore = {
      likelyAffected: Boolean(
        panelSummary?.status === 'blocked' ||
          (
            panelSummary?.attachRenderBurst.detected &&
            (
              panelSummary.issues.some((issue) => issue.includes('尚未 ready')) ||
              panelSummary.issues.some((issue) => issue.includes('bootstrapAck')) ||
              panelSummary.issues.some((issue) => issue.includes('probe 失败')) ||
              panelSummary.events.staleMessageIgnored > 0
            )
          )
      ),
      consecutiveAttachRender: panelSummary?.attachRenderBurst.detected ?? false,
      readyPromotionObserved: (panelSummary?.events.readyWebviewPromoted ?? 0) > 0,
      staleMessageIgnoredCount: panelSummary?.events.staleMessageIgnored ?? 0,
      probeFailedAfterReady: Boolean(panelSummary?.ready && panelSummary.probe.error),
      missingReadyAfterRender: Boolean(
        panelSummary?.attached &&
          panelSummary.interactive &&
          !panelSummary.ready &&
          panelSummary.events.rendered > 0
      ),
      missingBootstrapAckAfterReady: Boolean(panelSummary?.ready && !panelSummary.bootstrapAck)
    };

    return {
      capturedAt,
      activeSurface: debugSnapshot.activeSurface,
      status: summarizeWebviewLifecycleOverallStatus(surfaces),
      panelRestore,
      surfaces
    };
  }

  private buildWebviewLifecycleSurfaceSummary(
    capturedAt: string,
    surface: CanvasSurfaceLocation,
    debugSnapshot: CanvasDebugSnapshot,
    diagnosticEvents: readonly CanvasTestDiagnosticEvent[],
    diagnosticHostMessages: readonly CanvasHostMessageDiagnosticRecord[],
    probeResult: CanvasWebviewProbeDiagnosticResult | undefined
  ): CanvasWebviewLifecycleSurfaceSummary {
    const surfaceEvents = diagnosticEvents.filter((event) => readDiagnosticEventSurface(event) === surface);
    const events = summarizeWebviewLifecycleSurfaceEventCounts(surfaceEvents);
    const attachRenderBurst = summarizeWebviewLifecycleAttachRenderBurst(surfaceEvents);
    const hostMessages = summarizeWebviewLifecycleHostMessages(surface, diagnosticHostMessages);
    const lifecycleState = debugSnapshot.surfaceLifecycle[surface];
    const lifecycle = lifecycleState.mode
      ? {
          surface,
          mode: lifecycleState.mode,
          generation: lifecycleState.generation,
          frameId: lifecycleState.frameId
        }
      : undefined;
    const attached = Boolean(this.getSurfaceWebview(surface));
    const ready = debugSnapshot.surfaceReady[surface];
    const active = debugSnapshot.activeSurface === surface;
    const interactive = active && debugSnapshot.surfaceMode[surface] === 'active';
    const bootstrapAck = lifecycleState.bootstrapAck;
    const visibility = this.getSurfaceVisibility(surface);
    const pendingBootstrapHostMessageCount = this.pendingBootstrapHostMessages[surface]?.length ?? 0;
    const probe = {
      attached: probeResult?.attached ?? attached,
      ready: probeResult?.ready ?? ready,
      interactive: probeResult?.interactive ?? interactive,
      visibility: probeResult?.visibility ?? visibility,
      capturedAt: probeResult?.capturedAt,
      error: probeResult?.error,
      nodeCount: probeResult?.snapshot?.nodeCount ?? null
    };
    const messageTarget = this.surfaceMessageWebview[surface]
      ? 'explicit'
      : attached
        ? 'surface-webview'
        : 'missing';
    const issues = buildWebviewLifecycleSurfaceIssues({
      surface,
      active,
      attached,
      interactive,
      ready,
      bootstrapAck,
      probeError: probe.error,
      events,
      attachRenderBurst,
      pendingBootstrapHostMessageCount,
      hostMessages
    });
    const status = classifyWebviewLifecycleSurfaceStatus({
      active,
      attached,
      visibility,
      interactive,
      ready,
      bootstrapAck,
      probeError: probe.error,
      events,
      attachRenderBurst
    });

    return {
      surface,
      active,
      attached,
      visibility,
      interactive,
      ready,
      lifecycle,
      bootstrapAck,
      messageTarget,
      pendingBootstrapHostMessageCount,
      hostMessages,
      events,
      attachRenderBurst,
      latestEvents: cloneJsonValue(surfaceEvents.slice(-12)),
      probe,
      status,
      issues,
      recommendedNextSteps: buildWebviewLifecycleRecommendedNextSteps(surface, status, issues, capturedAt)
    };
  }

  private collectNoteMarkdownHostDiagnostics(): Record<string, unknown> {
    const activeWebview = this.getActiveWebview();
    const currentRemoteAuthority = this.getCurrentWebviewRemoteAuthority(activeWebview);
    const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
    return {
      remoteName: vscode.env.remoteName,
      currentRemoteAuthority,
      normalizedCurrentRemoteAuthority: normalizeNoteMarkdownAuthority(currentRemoteAuthority),
      currentRemoteAuthorityProbeUri: this.currentWebviewRemoteAuthorityProbeUri,
      currentRemoteAuthorityProbeError: this.currentWebviewRemoteAuthorityProbeError,
      didScheduleCurrentHostRecanonicalize: this.didScheduleNoteMarkdownCurrentHostRecanonicalize,
      webviewAuthorityProbes: (['panel', 'editor'] as const).map((surface) =>
        this.collectNoteMarkdownWebviewAuthorityProbe(surface)
      ),
      workspaceFolders: workspaceFolders.map((workspaceFolder) => ({
        name: workspaceFolder.name,
        uri: workspaceFolder.uri.toString(),
        scheme: workspaceFolder.uri.scheme,
        authority: workspaceFolder.uri.authority,
        normalizedAuthority: normalizeNoteMarkdownAuthority(workspaceFolder.uri.authority),
        path: workspaceFolder.uri.path,
        fsPath: workspaceFolder.uri.fsPath
      })),
      associatedResources: this.state.nodes.flatMap((node) => {
        if (node.kind !== 'note') {
          return [];
        }

        const source = ensureNoteMetadata(node).contentSource;
        if (source?.kind !== 'markdown-file') {
          return [];
        }

        const parsedUri = parseStoredNoteMarkdownResourceUri(source.resourceUri);
        const canonicalUri = parsedUri
          ? canonicalizeNoteMarkdownUriForCurrentHost(parsedUri, currentRemoteAuthority)
          : undefined;
        return [{
          nodeId: node.id,
          title: node.title,
          status: source.status,
          displayPath: source.displayPath,
          fullDisplayPath: source.fullDisplayPath,
          contentRevision: source.contentRevision,
          resourceUri: source.resourceUri,
          parsedUri: parsedUri ? describeNoteMarkdownUriForDiagnostics(parsedUri) : null,
          canonicalUri: canonicalUri ? describeNoteMarkdownUriForDiagnostics(canonicalUri) : null,
          didCanonicalize: Boolean(parsedUri && canonicalUri && parsedUri.toString() !== canonicalUri.toString()),
          resourceKey: canonicalUri ? normalizeNoteMarkdownResourceKey(canonicalUri) : source.resourceUri
        }];
      })
    };
  }

  private collectNoteMarkdownWebviewAuthorityProbe(surface: CanvasSurfaceLocation): Record<string, unknown> {
    const webview = this.getSurfaceWebview(surface);
    if (!webview) {
      return {
        surface,
        attached: false
      };
    }

    try {
      const probeUri = webview.asWebviewUri(vscode.Uri.file(process.cwd())).toString();
      const remoteAuthority = extractNoteMarkdownCurrentRemoteAuthorityFromWebviewResourceUri(probeUri);
      return {
        surface,
        attached: true,
        probeUri,
        remoteAuthority,
        normalizedRemoteAuthority: normalizeNoteMarkdownAuthority(remoteAuthority)
      };
    } catch (error) {
      return {
        surface,
        attached: true,
        error: formatUnknownError(error)
      };
    }
  }

  public createNode(kind: CanvasCreatableNodeKind, options?: CreateNodeOptions): void {
    if ((vscode.workspace.workspaceFolders?.length ?? 0) > 1 && !options?.targetGroupId && !options?.cwdOverride) {
      void this.createNodeAfterWorkspaceRootSelection(kind, options);
      return;
    }

    if (this.isInteractiveSurfaceReady()) {
      this.postMessage({
        type: 'host/requestCreateNode',
        payload: {
          kind,
          cwd: options?.cwdOverride,
          targetGroupId: options?.targetGroupId,
          agentProvider: options?.agentProvider,
          agentLaunchPreset: options?.agentLaunchPreset,
          agentCustomLaunchCommand: options?.agentCustomLaunchCommand
        }
      });
      return;
    }

    this.applyCreateNode(kind, undefined, {
      agentProvider: options?.agentProvider,
      agentLaunchPreset: options?.agentLaunchPreset,
      agentCustomLaunchCommand: options?.agentCustomLaunchCommand,
      cwdOverride: options?.cwdOverride,
      targetGroupId: options?.targetGroupId,
      titleOverride: options?.titleOverride
    });
  }

  private async createNodeAfterWorkspaceRootSelection(
    kind: CanvasCreatableNodeKind,
    options?: CreateNodeOptions
  ): Promise<void> {
    const targetGroupId = await this.pickWorkspaceRootGroupIdForCreate(kind);
    if (!targetGroupId) {
      return;
    }

    if (this.isInteractiveSurfaceReady()) {
      this.postMessage({
        type: 'host/requestCreateNode',
        payload: {
          kind,
          targetGroupId,
          agentProvider: options?.agentProvider,
          agentLaunchPreset: options?.agentLaunchPreset,
          agentCustomLaunchCommand: options?.agentCustomLaunchCommand
        }
      });
      return;
    }

    this.applyCreateNode(kind, undefined, {
      agentProvider: options?.agentProvider,
      agentLaunchPreset: options?.agentLaunchPreset,
      agentCustomLaunchCommand: options?.agentCustomLaunchCommand,
      targetGroupId,
      titleOverride: options?.titleOverride
    });
  }

  private async pickWorkspaceRootGroupIdForCreate(kind: CanvasCreatableNodeKind): Promise<string | undefined> {
    return this.pickWorkspaceRootGroupId(
      `${kind === 'agent' ? 'Agent' : kind === 'terminal' ? 'Terminal' : 'Note'} 所属 root`
    );
  }

  private async pickWorkspaceRootGroupId(title: string): Promise<string | undefined> {
    const rootGroups = (this.state.groups ?? []).filter(isWorkspaceRootGroup);
    if (rootGroups.length === 0) {
      return undefined;
    }

    const selected = await vscode.window.showQuickPick(
      rootGroups.map((group) => ({
        label: group.title,
        description: group.workspaceRootPath,
        group
      })),
      {
        title: `选择 ${title}`,
        placeHolder: '选择新节点要放入的 workspace folder'
      }
    );
    return selected?.group.id;
  }

  public createEmptyGroupFromCommand(): void {
    if ((vscode.workspace.workspaceFolders?.length ?? 0) > 1) {
      void this.createEmptyGroupAfterWorkspaceRootSelection();
      return;
    }

    const preferredCenter = this.resolvePreferredCanvasCenter() ?? { x: 0, y: 0 };
    const groupSize = DEFAULT_CANVAS_GROUP_SIZE;
    this.state = createEmptyCanvasGroup(
      this.state,
      snapCanvasPosition({
        x: preferredCenter.x - Math.round(groupSize.width / 2),
        y: preferredCenter.y - Math.round(groupSize.height / 2)
      }),
      groupSize
    );
    this.canvasTemplateInitialized = true;
    this.persistState();
    this.postState('host/stateUpdated');
  }

  private async createEmptyGroupAfterWorkspaceRootSelection(): Promise<void> {
    const targetGroupId = await this.pickWorkspaceRootGroupId('分组所属 root');
    if (!targetGroupId) {
      return;
    }

    const targetRootGroup = (this.state.groups ?? []).find(
      (group) => group.id === targetGroupId && isWorkspaceRootGroup(group)
    );
    if (!targetRootGroup) {
      return;
    }

    const groupSize = DEFAULT_CANVAS_GROUP_SIZE;
    this.state = createEmptyCanvasGroup(
      this.state,
      translateRootLocalCanvasPositionToComposed({ x: 0, y: 0 }, targetRootGroup),
      groupSize,
      targetRootGroup.id
    );
    this.canvasTemplateInitialized = true;
    this.persistState();
    this.postState('host/stateUpdated');
  }

  public createGroupFromSelectionFromCommand(): boolean {
    if (!this.isInteractiveSurfaceReady()) {
      return false;
    }

    this.postMessage({
      type: 'host/requestCreateGroupFromSelection'
    });
    return true;
  }

  public async createTerminalAndRunCommand(
    commandLine: string,
    options: { titleOverride?: string } = {}
  ): Promise<CreateTerminalCommandResult> {
    const trimmedCommandLine = commandLine.trim();
    if (!trimmedCommandLine) {
      return {
        created: false,
        errorMessage: '安装命令不能为空。'
      };
    }

    if (!vscode.workspace.isTrusted) {
      return {
        created: false,
        errorMessage: '当前 workspace 未受信任，不能在画布中启动 Terminal 执行安装命令。'
      };
    }

    try {
      await this.revealOrCreateCurrentCanvasSurface();
      await this.waitForCanvasReady(undefined, TERMINAL_INITIAL_INPUT_DISPATCH_TIMEOUT_MS);
    } catch (error) {
      return {
        created: false,
        errorMessage: error instanceof Error ? error.message : '无法打开画布 Terminal。'
      };
    }

    const targetGroupId = (vscode.workspace.workspaceFolders?.length ?? 0) > 1
      ? await this.pickWorkspaceRootGroupId('Terminal 所属 root')
      : undefined;
    if ((vscode.workspace.workspaceFolders?.length ?? 0) > 1 && !targetGroupId) {
      return {
        created: false,
        errorMessage: '已取消选择 Terminal 所属 root。'
      };
    }

    const createdNode = this.applyCreateNode('terminal', undefined, {
      titleOverride: options.titleOverride,
      targetGroupId
    });
    if (!createdNode) {
      return {
        created: false,
        errorMessage: '无法创建用于安装的 Terminal 节点。'
      };
    }

    const dispatchResult = this.waitForPendingTerminalInitialInputDispatch(
      createdNode.id,
      trimmedCommandLine
    );
    this.pendingTerminalInitialInputs.set(createdNode.id, `${trimmedCommandLine}\n`);
    void this.focusNodeInCanvas(createdNode.id).catch(() => {
      // The node still exists and will auto-launch; focus is only a convenience.
    });

    const completedDispatch = await dispatchResult;
    if (!completedDispatch.dispatched) {
      return {
        created: true,
        nodeId: createdNode.id,
        commandDispatched: false,
        errorMessage:
          completedDispatch.errorMessage ??
          '已创建画布 Terminal，但尚未确认安装命令已输入；请检查 Terminal 节点状态。'
      };
    }

    return {
      created: true,
      nodeId: createdNode.id,
      commandDispatched: true
    };
  }

  public createNodeForTest(
    kind: CanvasCreatableNodeKind,
    preferredPosition?: CanvasNodePosition,
    options?: CreateNodeOptions
  ): void {
    if (!isTestHarnessMode(this.context.extensionMode)) {
      throw new Error('createNodeForTest 仅在测试模式下可用。');
    }

    this.applyCreateNode(kind, preferredPosition, {
      bypassTrust: true,
      agentProvider: options?.agentProvider,
      agentLaunchPreset: options?.agentLaunchPreset,
      agentCustomLaunchCommand: options?.agentCustomLaunchCommand,
      cwdOverride: options?.cwdOverride,
      titleOverride: options?.titleOverride
    });
  }


  private createAgentNotificationSessionForTest(params: StartExecutionSessionForTestParams): ManagedExecutionSession {
    const node = this.state.nodes.find((candidate) => candidate.id === params.nodeId && candidate.kind === 'agent');
    if (!node) {
      throw new Error('测试命令 devSessionCanvas.__test.startExecutionSession 需要有效的 Agent 节点。');
    }

    const metadata = ensureAgentMetadata(node);
    const provider = params.provider ?? metadata.provider;
    const cols = normalizeTerminalCols(params.cols ?? DEFAULT_TERMINAL_COLS);
    const rows = normalizeTerminalRows(params.rows ?? DEFAULT_TERMINAL_ROWS);
    const cwd = params.cwdOverride ?? this.getExecutionNodeCwd(node, 'agent');
    const noopSubscription: DisposableLike = { dispose: () => {} };
    return {
      sessionId: createExecutionSessionId(params.nodeId, 'agent'),
      owner: 'local',
      startedAtMs: Date.now(),
      process: {
        backend: 'node-pty',
        pid: 0,
        processName: 'test-agent-output-injection',
        write: () => {},
        resize: () => {},
        kill: () => {},
        onData: () => noopSubscription,
        onExit: () => noopSubscription
      },
      shellPath: provider,
      cwd,
      cols,
      rows,
      buffer: '',
      terminalStateTracker: new SerializedTerminalStateTracker(cols, rows, {
        scrollback: this.getTerminalScrollback()
      }),
      lineContextTracker: this.createExecutionTerminalLineContextTracker(
        cols,
        rows,
        provider,
        cwd,
        this.getTerminalScrollback()
      ),
      stopRequested: false,
      syncTimer: undefined,
      syncDueAtMs: undefined,
      lifecycleTimer: undefined,
      pendingOutput: '',
      outputSequence: 0,
      outputFlushTimer: undefined,
      displayLabel: agentProviderDisplayLabel(provider),
      lifecycleStatus: 'running',
      launchMode: params.resumeRequested === true ? 'resume' : 'start',
      resumePhaseActive: false,
      agentProvider: provider,
      agentResume: {
        supported: false,
        strategy: 'none'
      },
      agentActivity: createAgentActivityHeuristicState(),
      attentionSignalState: this.createExecutionAttentionNotificationState(),
      outputSubscription: undefined,
      exitSubscription: undefined
    };
  }

  public async saveNoteAsMarkdownFile(nodeId?: string): Promise<void> {
    const node = nodeId
      ? this.state.nodes.find((candidate) => candidate.id === nodeId && candidate.kind === 'note')
      : await this.pickEmbeddedNoteForMarkdownAssociation();
    if (!node || node.kind !== 'note') {
      return;
    }

    const noteMetadata = ensureNoteMetadata(node);
    if (noteMetadata.contentSource?.kind === 'markdown-file') {
      await this.openAssociatedNoteMarkdownFile(node.id, this.activeSurface ?? this.getConfiguredSurface());
      return;
    }

    const targetUri = await this.promptNoteMarkdownFileTarget(node);
    if (!targetUri) {
      return;
    }

    if (!isSupportedNoteMarkdownFilePath(noteMarkdownUriPathLike(targetUri))) {
      await vscode.window.showWarningMessage('只能关联 Markdown 文件（.md / .markdown）。');
      return;
    }

    const targetStatus = await this.statNoteMarkdownTarget(targetUri);
    if (targetStatus === 'directory') {
      await vscode.window.showWarningMessage('选择的路径是目录，请指定一个 Markdown 文件。');
      return;
    }

    if (targetStatus === 'missing-parent') {
      await vscode.window.showWarningMessage('所选目录不存在，无法保存文件。');
      return;
    }

    if (targetStatus === 'other') {
      await vscode.window.showWarningMessage('所选路径不是有效文件，无法保存。');
      return;
    }

    let nextContent = noteMetadata.content;
    let nextContentRevision: string | undefined;
    let shouldWriteCurrentNoteContent = targetStatus !== 'file';
    if (targetStatus === 'file') {
      const choice = await this.confirmExistingNoteMarkdownFile(targetUri);
      if (!choice) {
        return;
      }

      if (choice === 'keep') {
        const readResult = await this.readNoteMarkdownFile(targetUri);
        if (readResult.status !== 'ok') {
          await vscode.window.showWarningMessage(readResult.lastError ?? '无法读取 Markdown 文件。');
          return;
        }
        nextContent = readResult.content;
        nextContentRevision = readResult.contentRevision;
      } else {
        shouldWriteCurrentNoteContent = true;
      }
    }

    if (shouldWriteCurrentNoteContent) {
      const writeResult = await this.writeNoteMarkdownFile(targetUri, noteMetadata.content);
      if (!writeResult.ok) {
        await vscode.window.showWarningMessage(writeResult.errorMessage);
        return;
      }
      nextContent = noteMetadata.content;
      nextContentRevision = writeResult.contentRevision;
    }

    this.state = this.updateNoteMarkdownFileAssociationState(this.state, node.id, targetUri, {
      status: 'ok',
      content: nextContent,
      contentRevision: nextContentRevision
    });
    this.persistState();
    this.postState('host/stateUpdated');
  }

  public async createNoteFromMarkdownResource(
    uri: vscode.Uri,
    options: { preferredPosition?: CanvasNodePosition; targetGroupId?: string } = {}
  ): Promise<CanvasNodeSummary | undefined> {
    const resourceUri = this.canonicalizeCurrentHostNoteMarkdownUri(uri);
    const admission = resolveExplorerNoteMarkdownAdmission(
      resourceUri,
      vscode.workspace.workspaceFolders ?? []
    );
    if (!admission.uri) {
      await vscode.window.showWarningMessage(
        admission.rejectionReason ?? '请选择 Markdown 文件（.md / .markdown）来创建关联 Note。'
      );
      return undefined;
    }

    const noteUri = admission.uri;
    if (!isSupportedNoteMarkdownFilePath(noteMarkdownUriPathLike(noteUri))) {
      await vscode.window.showWarningMessage('只能关联 Markdown 文件（.md / .markdown）。');
      return undefined;
    }

    const readResult = await this.readNoteMarkdownFile(noteUri);
    if (readResult.status !== 'ok') {
      await vscode.window.showWarningMessage(
        readResult.lastError ?? `无法读取 ${this.formatNoteMarkdownUriForMessage(noteUri)}。`
      );
      return undefined;
    }

    const resourceKey = normalizeNoteMarkdownResourceKey(noteUri);
    const existingNodeIds = this.getAssociatedNoteMarkdownNodeIdsForResourceKey(resourceKey);
    if (existingNodeIds.length > 0) {
      const choice = await this.confirmExistingDroppedNoteMarkdownFile(noteUri, existingNodeIds.length);
      if (choice === 'locate') {
        this.focusCanvasTemplateNodeGroup(existingNodeIds);
        return undefined;
      }
      if (choice !== 'create') {
        return undefined;
      }
    }

    const preferredPosition = this.resolveExplorerMarkdownNotePosition(options.preferredPosition);
    const placement = this.resolveExplorerMarkdownNotePlacement(preferredPosition, noteUri, options.targetGroupId);
    const createdNode = this.createAssociatedNoteMarkdownNode(
      noteUri,
      readResult.content,
      placement.preferredPosition,
      readResult.contentRevision,
      placement.targetGroupId
    );
    if (!createdNode) {
      await vscode.window.showWarningMessage('多根 workspace 中请从目标 root section 内创建关联 Note。');
      return undefined;
    }

    this.persistState();
    this.postState('host/stateUpdated');
    this.focusCanvasTemplateNodeGroup([createdNode.id]);
    return createdNode;
  }

  private resolveExplorerMarkdownNotePosition(
    preferredPosition?: CanvasNodePosition
  ): CanvasNodePosition {
    const preferredCenter = this.resolvePreferredCanvasCenter();
    const footprint = estimatedCanvasNodeFootprint('note');
    return snapCanvasPosition(preferredPosition ?? {
      x: (preferredCenter?.x ?? 0) - Math.round(footprint.width / 2),
      y: (preferredCenter?.y ?? 0) - Math.round(footprint.height / 2)
    });
  }

  private resolveExplorerMarkdownNotePlacement(
    preferredPosition: CanvasNodePosition,
    uri: vscode.Uri,
    explicitTargetGroupId?: string
  ): { preferredPosition?: CanvasNodePosition; targetGroupId?: string } {
    if (explicitTargetGroupId) {
      return {
        preferredPosition,
        targetGroupId: explicitTargetGroupId
      };
    }

    const workspaceRootGroups = (this.state.groups ?? []).filter(isWorkspaceRootGroup);
    if (workspaceRootGroups.length === 0) {
      return {
        preferredPosition
      };
    }

    const workspaceFolder = findContainingNoteMarkdownWorkspaceFolder(uri, vscode.workspace.workspaceFolders ?? []);
    const targetRootGroup = workspaceFolder
      ? workspaceRootGroups
          .flatMap((group) => {
            const rootPath = resolveWorkspaceRootPathForGroup(group);
            return rootPath !== undefined && isSameOrDescendantExecutionPath(workspaceFolder.uri.fsPath, rootPath)
              ? [{ group, rootPath }]
              : [];
          })
          .sort((left, right) => right.rootPath.length - left.rootPath.length)
          .at(0)?.group
      : undefined;

    if (targetRootGroup) {
      return {
        preferredPosition: rectContainsPoint(rectForGroup(targetRootGroup), preferredPosition)
          ? preferredPosition
          : undefined,
        targetGroupId: targetRootGroup.id
      };
    }

    const containingGroup = workspaceRootGroups.find((group) => rectContainsPoint(rectForGroup(group), preferredPosition));
    return {
      preferredPosition: containingGroup ? preferredPosition : undefined,
      targetGroupId: containingGroup?.id
    };
  }

  public async focusNodeById(nodeId: string): Promise<boolean> {
    const node = this.state.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) {
      return false;
    }

    try {
      await this.focusNodeInCanvas(nodeId);
      return true;
    } catch {
      return false;
    }
  }

  public async centerAttentionNodeById(nodeId: string): Promise<boolean> {
    const node = this.state.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) {
      return false;
    }

    try {
      await this.centerNodeInCanvas(nodeId);
      return true;
    } catch {
      return false;
    }
  }

  public async restoreAgentSessionFromHistory(params: {
    provider: AgentProviderKind;
    sessionId: string;
    title?: string;
  }): Promise<{ restored: boolean; errorMessage?: string }> {
    const restoreBlockReason = this.getSessionHistoryRestoreBlockReason();
    if (restoreBlockReason) {
      return {
        restored: false,
        errorMessage: restoreBlockReason
      };
    }

    const sessionId = params.sessionId.trim();
    if (!sessionId) {
      return {
        restored: false
      };
    }

    let historyResumeCommandLine: string;
    try {
      historyResumeCommandLine = this.buildHistoryResumeCommandLine(params.provider, sessionId);
    } catch (error) {
      return {
        restored: false,
        errorMessage: error instanceof Error ? error.message : '无法解析历史恢复的 Agent 启动命令。'
      };
    }

    const createdNode = this.applyCreateNode('agent', undefined, {
      agentProvider: params.provider,
      agentLaunchPreset: 'custom',
      agentCustomLaunchCommand: historyResumeCommandLine,
      titleOverride: params.title
    });
    if (!createdNode) {
      return {
        restored: false
      };
    }

    try {
      await this.focusNodeInCanvas(createdNode.id);
      return {
        restored: true
      };
    } catch {
      void vscode.window.showWarningMessage(`历史会话节点已创建，但暂时无法自动定位到「${createdNode.title}」。`);
      return {
        restored: true
      };
    }
  }

  public async forkAgentSessionFromHistory(params: {
    provider: AgentProviderKind;
    sessionId: string;
    title?: string;
  }): Promise<{ forked: boolean; errorMessage?: string }> {
    const restoreBlockReason = this.getSessionHistoryRestoreBlockReason();
    if (restoreBlockReason) {
      return {
        forked: false,
        errorMessage: restoreBlockReason
      };
    }

    const sessionId = params.sessionId.trim();
    if (!sessionId) {
      return {
        forked: false
      };
    }

    let historyForkCommandLine: string;
    try {
      historyForkCommandLine = this.buildAgentBranchCommandLine(params.provider, sessionId);
    } catch (error) {
      return {
        forked: false,
        errorMessage:
          error instanceof Error
            ? error.message
            : `无法解析 ${agentProviderDisplayLabel(params.provider)} 历史分叉启动命令。`
      };
    }

    const createdNode = this.applyCreateNode('agent', undefined, {
      agentProvider: params.provider,
      agentLaunchPreset: 'custom',
      agentCustomLaunchCommand: historyForkCommandLine,
      titleOverride: formatHistoryForkTitle(params.title)
    });
    if (!createdNode) {
      return {
        forked: false
      };
    }

    try {
      await this.focusNodeInCanvas(createdNode.id);
      return {
        forked: true
      };
    } catch {
      void vscode.window.showWarningMessage(`历史会话分叉节点已创建，但暂时无法自动定位到「${createdNode.title}」。`);
      return {
        forked: true
      };
    }
  }

  private async branchAgentSession(nodeId: string): Promise<{ branched: boolean; errorMessage?: string }> {
    if (!this.assertExecutionAllowed('当前 workspace 未受信任，已禁止分叉 Agent 会话。')) {
      return {
        branched: false,
        errorMessage: '当前 workspace 未受信任，不能分叉 Agent 会话。'
      };
    }

    const sourceNode = this.state.nodes.find((candidate) => candidate.id === nodeId && candidate.kind === 'agent');
    if (!sourceNode) {
      const message = '未找到可分叉的 Agent 节点。';
      this.postMessage({ type: 'host/error', payload: { message } });
      return { branched: false, errorMessage: message };
    }

    const metadata = ensureAgentMetadata(sourceNode);
    if (!isAgentProviderBranchSupported(metadata.provider, metadata.resumeStrategy)) {
      const message = '只有持有可信会话的 Codex / Claude Code Agent 才能分叉。';
      this.postMessage({ type: 'host/error', payload: { message } });
      return { branched: false, errorMessage: message };
    }

    const sessionId = metadata.resumeSessionId?.trim();
    if (!sessionId) {
      const message = `当前 ${agentProviderDisplayLabel(metadata.provider)} Agent 尚未确认可分叉的会话标识。`;
      this.postMessage({ type: 'host/error', payload: { message } });
      return { branched: false, errorMessage: message };
    }

    let branchCommandLine: string;
    try {
      branchCommandLine = this.buildAgentBranchCommandLine(metadata.provider, sessionId);
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : `无法解析 ${agentProviderDisplayLabel(metadata.provider)} 分叉启动命令。`;
      this.postMessage({ type: 'host/error', payload: { message } });
      return { branched: false, errorMessage: message };
    }

    const sourceSize = sourceNode.size ?? estimatedCanvasNodeFootprint('agent');
    const preferredPosition = {
      x: sourceNode.position.x + sourceSize.width + 48,
      y: sourceNode.position.y
    };
    const createdNode = this.applyCreateNode('agent', preferredPosition, {
      agentProvider: metadata.provider,
      agentLaunchPreset: 'custom',
      agentCustomLaunchCommand: branchCommandLine,
      titleOverride: `${sourceNode.title} 分叉`,
      cwdOverride: metadata.cwd
    });
    if (!createdNode) {
      return { branched: false };
    }

    this.state = createBranchAgentUserEdge(this.state, sourceNode, createdNode);
    this.persistState();
    this.postState('host/stateUpdated');

    try {
      await this.focusNodeInCanvas(createdNode.id);
    } catch {
      void vscode.window.showWarningMessage(`分叉节点已创建，但暂时无法自动定位到「${createdNode.title}」。`);
    }

    return { branched: true };
  }

  public getSessionHistoryRestoreBlockReason(): string | undefined {
    return vscode.workspace.isTrusted ? undefined : '当前 workspace 未受信任，只能查看历史会话，不能恢复或分叉为新 Agent 节点。';
  }

  public async startExecutionSessionForTest(params: StartExecutionSessionForTestParams): Promise<CanvasDebugSnapshot> {
    if (!isTestHarnessMode(this.context.extensionMode)) {
      throw new Error('startExecutionSessionForTest 仅在测试模式下可用。');
    }

    if (params.cwdOverride) {
      const validation = this.validateExecutionCwd(params.cwdOverride);
      if (!validation.valid) {
        throw new Error(validation.message);
      }
      params.cwdOverride = validation.cwd;
      this.state = this.applyExecutionCwdOverrideForTest(params.nodeId, params.kind, validation.cwd);
      this.persistState();
      this.postState('host/stateUpdated');
    }

    if (
      params.kind === 'agent' &&
      (params.injectAgentOutputChunk || (params.injectAgentOutputChunks && params.injectAgentOutputChunks.length > 0))
    ) {
      const syntheticSession = this.createAgentNotificationSessionForTest(params);
      try {
        if (params.injectAgentExistingOutput) {
          syntheticSession.buffer = appendTerminalBuffer(syntheticSession.buffer, params.injectAgentExistingOutput);
          resetAgentActivityHeuristics(
            this.ensureAgentActivityState(syntheticSession),
            syntheticSession.buffer
          );
        }
        const injectedChunks: string[] =
          params.injectAgentOutputChunks && params.injectAgentOutputChunks.length > 0
            ? params.injectAgentOutputChunks
            : params.injectAgentOutputChunk
              ? [params.injectAgentOutputChunk]
              : [];
        for (const injectedChunk of injectedChunks) {
          syntheticSession.buffer = appendTerminalBuffer(syntheticSession.buffer, injectedChunk);
          this.recordAgentOutputHeuristicsAndNotifyAbnormalStream(
            params.nodeId,
            syntheticSession,
            injectedChunk
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
      } finally {
        this.disposeManagedExecutionSession(syntheticSession);
      }

      return this.getDebugSnapshot();
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

  private applyExecutionCwdOverrideForTest(
    nodeId: string,
    kind: ExecutionNodeKind,
    cwd: string
  ): CanvasPrototypeState {
    const targetNode = this.state.nodes.find((node) => node.id === nodeId && node.kind === kind);
    if (!targetNode) {
      throw new Error('测试命令 devSessionCanvas.__test.startExecutionSession 需要有效的执行节点。');
    }

    return {
      ...this.state,
      updatedAt: new Date().toISOString(),
      nodes: this.state.nodes.map((node) => {
        if (node.id !== nodeId || node.kind !== kind) {
          return node;
        }

        return applyExecutionCwdOverrideToCreatedNode(node, cwd);
      })
    };
  }

  public dispatchWebviewMessageForTest(
    message: unknown,
    surface: CanvasSurfaceLocation | undefined = this.activeSurface
  ): CanvasDebugSnapshot {
    if (!surface) {
      throw new Error('测试命令 devSessionCanvas.__test.dispatchWebviewMessage 需要一个有效的画布承载面。');
    }

    this.handleWebviewMessage(
      surface,
      this.withSyntheticLifecycleForTest(surface, message),
      this.getSurfaceMessageWebview(surface)
    );
    return this.getDebugSnapshot();
  }

  private withSyntheticLifecycleForTest(surface: CanvasSurfaceLocation, message: unknown): unknown {
    if (!isTestHarnessMode(this.context.extensionMode) || !isRecord(message) || message.lifecycle !== undefined) {
      return message;
    }

    const lifecycle = this.getSurfaceLifecycleIdentity(surface);
    return lifecycle
      ? {
          ...message,
          lifecycle
        }
      : message;
  }

  public async reloadPersistedStateForTest(): Promise<CanvasDebugSnapshot> {
    await this.flushDeferredCanvasStatePersist('test-reload');
    await this.waitForPendingWorkspaceStateUpdates();
    this.refreshStorageRecoverySelection();
    this.fileFilterState = this.loadStoredCanvasFileFilterState();
    this.state = this.loadReconciledState();
    this.canvasTemplateInitialized = this.readCanvasTemplateInitializedFlag(this.state);
    this.activeSurface = this.loadStoredSurface();
    this.persistState({ reason: 'test-reload' });
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
    if (!isTestHarnessMode(this.context.extensionMode)) {
      throw new Error('setPersistedStateForTest 仅在测试模式下可用。');
    }

    // 先切换内存态，再异步同步到 workspaceState，避免旧 webview 在 await 间隙继续把已删除节点写回持久化快照。
    this.state = this.reconcileSeededStateForTest(rawState);
    this.canvasTemplateInitialized = this.canvasTemplateInitialized || this.state.nodes.length > 0;
    this.recordDiagnosticEvent('state/seededForTest', {
      nodeCount: this.state.nodes.length
    });
    this.notifySidebarStateChanged();

    const multiRootOverlay = this.writeRootLocalCanvasSnapshotsForState(this.state);
    await this.queuePersistedCanvasSnapshotWrite({
      version: 1,
      state: this.state,
      multiRootOverlay,
      activeSurface: this.activeSurface
    }, {
      workspaceStateMode: 'full',
      reason: 'test-seed'
    });
    await this.waitForPendingWorkspaceStateUpdates();

    const snapshot = this.getDebugSnapshot();

    if (this.activeSurface && this.isInteractiveSurface(this.activeSurface)) {
      this.postState('host/stateUpdated');
    }

    this.scheduleRestoreLiveRuntimeSessions();

    return snapshot;
  }

  public async simulateRuntimeReloadForTest(): Promise<CanvasDebugSnapshot> {
    await this.flushDeferredCanvasStatePersist('test-runtime-reload');
    const nextStartupConfiguration = this.readStartupConfiguration();
    await this.prepareForHostBoundary({
      preserveLiveRuntime: this.shouldPreserveLiveRuntimeAcrossHostBoundary(nextStartupConfiguration),
      allowRuntimeSupervisorRestart: false
    });

    this.applyStartupConfiguration(nextStartupConfiguration);
    this.refreshStorageRecoverySelection();
    this.fileFilterState = this.loadStoredCanvasFileFilterState();
    this.state = this.loadReconciledState();
    this.canvasTemplateInitialized = this.readCanvasTemplateInitializedFlag(this.state);
    this.activeSurface = this.loadStoredSurface();
    this.persistState({ reason: 'test-runtime-reload' });
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
    workspaceCwd?: string,
    shellAuthority?: string
  ): string {
    if (!isTestHarnessMode(this.context.extensionMode)) {
      throw new Error('getAgentCliResolutionCacheKeyForTest 仅在测试模式下可用。');
    }

    return this.getAgentCliResolutionCacheKey(provider, requestedCommand, workspaceCwd, shellAuthority);
  }

  public async flushPersistedCanvasStateForTest(): Promise<PersistedCanvasStateFlushResult> {
    if (!isTestHarnessMode(this.context.extensionMode)) {
      throw new Error('flushPersistedCanvasStateForTest 仅在测试模式下可用。');
    }

    await this.flushDeferredCanvasStatePersist('test-flush');
    await this.queuePersistedCanvasSnapshotWrite({
      version: 1,
      state: this.state,
      activeSurface: this.activeSurface
    }, {
      workspaceStateMode: 'full',
      reason: 'test-flush'
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
    await this.flushDeferredCanvasStatePersist('host-boundary');
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
    this.clearPendingTerminalInitialInputs('扩展宿主正在切换，安装命令未写入。');
    this.runtimeSessionBindings.clear();

    if (persistedRuntimeSessions.length > 0) {
      await this.deleteRuntimeSupervisorSessions(persistedRuntimeSessions, {
        allowRestart: options.allowRuntimeSupervisorRestart
      });
    }

    await this.waitForPendingRuntimeSupervisorOperations();
    this.disposeRuntimeSupervisorClients();
    await this.flushDeferredCanvasStatePersist('host-boundary-final');
    await this.waitForPendingWorkspaceStateUpdates();
  }

  public async resetState(options: { clearAgentCliResolutionCache?: boolean } = {}): Promise<void> {
    const previousNodeCount = this.state.nodes.length;
    await this.prepareForHostBoundary({
      preserveLiveRuntime: false,
      allowRuntimeSupervisorRestart: false,
      invalidatePendingExecutionOperations: true
    });
    if (options.clearAgentCliResolutionCache) {
      this.clearAgentCliResolutionCache();
    }
    this.state = createDefaultState(this.getAgentCliConfig().defaultProvider);
    this.canvasTemplateInitialized = true;
    this.persistState({ reason: 'state-reset' });
    this.recordDiagnosticEvent('state/reset', {
      previousNodeCount,
      clearedAgentCliResolutionCache: options.clearAgentCliResolutionCache === true
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
    if (!isTestHarnessMode(this.context.extensionMode)) {
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
    const lifecycle = this.getSurfaceLifecycleIdentity(surface);
    const webview = this.getSurfaceMessageWebview(surface);

    return new Promise<WebviewProbeSnapshot>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingWebviewProbeRequests.delete(requestId);
        reject(new Error(`等待 ${surface} Webview probe 返回超时（${timeoutMs}ms）。`));
      }, timeoutMs);

      this.pendingWebviewProbeRequests.set(requestId, {
        surface,
        lifecycle,
        webview,
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

  private async captureWebviewProbe(
    surface: CanvasSurfaceLocation,
    timeoutMs = 5000,
    delayMs = 0
  ): Promise<WebviewProbeSnapshot> {
    const requestId = `probe-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const lifecycle = this.getSurfaceLifecycleIdentity(surface);
    const webview = this.getSurfaceMessageWebview(surface);

    return new Promise<WebviewProbeSnapshot>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingWebviewProbeRequests.delete(requestId);
        reject(new Error(`等待 ${surface} Webview probe 返回超时（${timeoutMs}ms）。`));
      }, timeoutMs);

      this.pendingWebviewProbeRequests.set(requestId, {
        surface,
        lifecycle,
        webview,
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

  private async collectWebviewProbeDiagnostic(
    surface: CanvasSurfaceLocation
  ): Promise<CanvasWebviewProbeDiagnosticResult> {
    const attached = Boolean(this.getSurfaceWebview(surface));
    const ready = this.surfaceReady[surface];
    const interactive = this.isInteractiveSurface(surface);
    const visibility = this.getSurfaceVisibility(surface);

    if (!attached || !ready) {
      return {
        surface,
        attached,
        ready,
        interactive,
        visibility,
        error: !attached ? 'surface-not-attached' : 'surface-not-ready'
      };
    }

    try {
      const snapshot = await this.captureWebviewProbe(surface, 2500, 0);
      return {
        surface,
        attached,
        ready,
        interactive,
        visibility,
        capturedAt: new Date().toISOString(),
        snapshot
      };
    } catch (error) {
      return {
        surface,
        attached,
        ready,
        interactive,
        visibility,
        capturedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private collectManagedExecutionSessionDiagnostics(
    kind: ExecutionNodeKind
  ): Array<Record<string, unknown>> {
    return Array.from(this.getExecutionSessions(kind).entries()).map(([nodeId, session]) => ({
      nodeId,
      kind,
      sessionId: session.sessionId,
      owner: session.owner,
      startedAtMs: session.startedAtMs,
      shellPath: session.shellPath,
      cwd: session.cwd,
      cols: session.cols,
      rows: session.rows,
      displayLabel: session.displayLabel,
      lifecycleStatus: session.lifecycleStatus,
      launchMode: session.launchMode,
      resumePhaseActive: session.resumePhaseActive,
      stopRequested: session.stopRequested,
      bufferLength: session.buffer.length,
      pendingOutputLength: session.pendingOutput.length,
      outputSequence: session.outputSequence,
      runtimeBackend: session.runtimeBackend,
      runtimeGuarantee: session.runtimeGuarantee,
      runtimeSessionId: session.runtimeSessionId,
      runtimeStoragePath: session.runtimeStoragePath,
      agentProvider: session.agentProvider,
      agentResume: session.agentResume
        ? {
            supported: session.agentResume.supported,
            strategy: session.agentResume.strategy,
            sessionId: session.agentResume.sessionId,
            storagePath: session.agentResume.storagePath
          }
        : undefined
    }));
  }

  private getHostDiagnosticsRootPath(): string {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    return workspaceRoot ? path.join(workspaceRoot, '.debug') : path.join(this.getExtensionStoragePath(), 'debug');
  }

  public async performWebviewDomActionForTest(
    action: WebviewDomAction,
    surface: CanvasSurfaceLocation | undefined = this.activeSurface,
    timeoutMs = 5000
  ): Promise<void> {
    if (!isTestHarnessMode(this.context.extensionMode)) {
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
    const lifecycle = this.getSurfaceLifecycleIdentity(surface);
    const webview = this.getSurfaceMessageWebview(surface);

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingWebviewDomActionRequests.delete(requestId);
        reject(new Error(`等待 ${surface} Webview DOM 动作返回超时（${timeoutMs}ms）。`));
      }, timeoutMs);

      this.pendingWebviewDomActionRequests.set(requestId, {
        surface,
        lifecycle,
        webview,
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

  public async runWebviewLifecycleRaceDiagnosticsForTest(): Promise<CanvasWebviewLifecycleRaceDiagnostics> {
    if (!isTestHarnessMode(this.context.extensionMode)) {
      throw new Error('runWebviewLifecycleRaceDiagnosticsForTest 仅在测试模式下可用。');
    }

    const surface: CanvasSurfaceLocation = 'panel';
    if (
      Array.from(this.pendingWebviewProbeRequests.values()).some((request) => request.surface === surface) ||
      Array.from(this.pendingWebviewDomActionRequests.values()).some((request) => request.surface === surface)
    ) {
      throw new Error('测试命令 devSessionCanvas.__test.runWebviewLifecycleRaceDiagnostics 需要目标 surface 没有未完成 Webview 请求。');
    }

    const previousActiveSurface = this.activeSurface;
    const previousSurfaceMode = { ...this.surfaceMode };
    const previousSurfaceReady = { ...this.surfaceReady };
    const previousSurfaceLifecycle = cloneJsonValue(this.surfaceLifecycle);
    const previousSurfaceMessageWebview = { ...this.surfaceMessageWebview };
    const previousPendingBootstrapHostMessages = {
      editor: this.pendingBootstrapHostMessages.editor?.slice(),
      panel: this.pendingBootstrapHostMessages.panel?.slice()
    };
    const previousPanelView = this.panelView;
    const previousCanvasTemplateInitialized = this.canvasTemplateInitialized;
    const previousPanelCenter = this.lastVisibleCanvasCenterBySurface.panel
      ? { ...this.lastVisibleCanvasCenterBySurface.panel }
      : undefined;
    const hadPreviousPanelCenter = this.lastVisibleCanvasCenterBySurface.panel !== undefined;
    const previousDiagnosticHostMessages = this.diagnosticHostMessages.slice();
    const previousTestHostMessages = this.testHostMessages.slice();
    const previousTestDiagnosticEvents = this.testDiagnosticEvents.slice();

    const oldFrame = this.createLifecycleRaceFakeWebview('old');
    const competingFrame = this.createLifecycleRaceFakeWebview('competing');
    const diagnosticPanelView = {
      webview: oldFrame.webview,
      visible: true
    } as unknown as vscode.WebviewView;

    let gatedMessageQueuedBeforeAck = false;
    let gatedMessageDeliveredBeforeAck = false;
    let gatedMessageDeliveredAfterAck = false;
    let staleMutationIgnored = false;
    let staleProbeResultIgnored = false;
    let pendingProbeResolvedFromCurrent = false;
    let staleDomActionResultIgnored = false;
    let pendingDomActionResolvedFromCurrent = false;
    let templateCatalogPostSettled = false;
    let secondReadyPromotionIgnored = false;
    let secondReadyBootstrapSuppressed = false;
    let messageTargetStayedOnPromotedWebview = false;
    let sameWebviewFrameReadyPromoted = false;
    let sameWebviewFrameBootstrapDelivered = false;
    let sameWebviewFrameLifecycleRebound = false;
    let focusMessageRetriedAfterFrameRefresh = false;
    let focusMessageReachedRefreshedFrame = false;

    try {
      this.activeSurface = surface;
      this.panelView = diagnosticPanelView;
      this.canvasTemplateInitialized = true;
      this.clearPendingBootstrapHostMessages(surface);
      this.testHostMessages.length = 0;
      this.testDiagnosticEvents.length = 0;

      const oldLifecycle = this.beginSurfaceRender(surface, 'active');
      this.renderedWebviewLifecycle.set(oldFrame.webview, oldLifecycle);
      this.bindSurfaceMessageWebview(surface, oldFrame.webview, 'render');

      const competingLifecycle = this.beginSurfaceRender(surface, 'active');
      this.renderedWebviewLifecycle.set(competingFrame.webview, competingLifecycle);
      this.bindSurfaceMessageWebview(surface, competingFrame.webview, 'render');

      const oldReadyLifecycle: WebviewLifecycleIdentity = {
        ...oldLifecycle,
        frameId: 'frame-lifecycle-race-old'
      };
      const competingReadyLifecycle: WebviewLifecycleIdentity = {
        ...competingLifecycle,
        frameId: 'frame-lifecycle-race-competing'
      };

      this.handleWebviewMessage(
        surface,
        {
          type: 'webview/ready',
          lifecycle: oldReadyLifecycle
        },
        oldFrame.webview
      );
      await this.waitForLifecycleRacePostedMessage(oldFrame, 'host/bootstrap');

      this.postMessageToSurface(surface, {
        type: 'host/visibilityRestored'
      });
      gatedMessageQueuedBeforeAck = (this.pendingBootstrapHostMessages[surface]?.length ?? 0) > 0;
      gatedMessageDeliveredBeforeAck = oldFrame.postedMessages.some(
        (message) => message.type === 'host/visibilityRestored'
      );

      this.handleWebviewMessage(
        surface,
        {
          type: 'webview/bootstrapAck',
          lifecycle: oldReadyLifecycle
        },
        oldFrame.webview
      );
      gatedMessageDeliveredAfterAck = oldFrame.postedMessages.some(
        (message) => message.type === 'host/visibilityRestored'
      );
      templateCatalogPostSettled = await this.waitForLifecycleRaceTemplateCatalogPost(oldFrame);

      const promotionCountBeforeSecondReady = this.testDiagnosticEvents.filter(
        (event) => event.kind === 'surface/readyWebviewPromoted'
      ).length;
      const oldBootstrapCountBeforeSecondReady = oldFrame.postedMessages.filter(
        (message) => message.type === 'host/bootstrap'
      ).length;
      this.handleWebviewMessage(
        surface,
        {
          type: 'webview/ready',
          lifecycle: competingReadyLifecycle
        },
        competingFrame.webview
      );
      secondReadyPromotionIgnored =
        this.testDiagnosticEvents.filter((event) => event.kind === 'surface/readyWebviewPromoted').length ===
        promotionCountBeforeSecondReady;
      secondReadyBootstrapSuppressed =
        competingFrame.postedMessages.every((message) => message.type !== 'host/bootstrap') &&
        oldFrame.postedMessages.filter((message) => message.type === 'host/bootstrap').length ===
          oldBootstrapCountBeforeSecondReady;
      const promotedLifecycleAfterSecondReady = this.getSurfaceLifecycleIdentity(surface);
      messageTargetStayedOnPromotedWebview =
        this.getSurfaceMessageWebview(surface) === oldFrame.webview &&
        promotedLifecycleAfterSecondReady?.generation === oldReadyLifecycle.generation &&
        promotedLifecycleAfterSecondReady.frameId === oldReadyLifecycle.frameId;

      const refreshedReadyLifecycle: WebviewLifecycleIdentity = {
        ...oldLifecycle,
        frameId: 'frame-lifecycle-race-old-refresh'
      };
      const promotionCountBeforeSameWebviewFrameReady = this.testDiagnosticEvents.filter(
        (event) => event.kind === 'surface/readyWebviewPromoted'
      ).length;
      const oldBootstrapCountBeforeSameWebviewFrameReady = oldFrame.postedMessages.filter(
        (message) => message.type === 'host/bootstrap'
      ).length;
      this.handleWebviewMessage(
        surface,
        {
          type: 'webview/ready',
          lifecycle: refreshedReadyLifecycle
        },
        oldFrame.webview
      );
      sameWebviewFrameReadyPromoted =
        this.testDiagnosticEvents.filter((event) => event.kind === 'surface/readyWebviewPromoted').length ===
        promotionCountBeforeSameWebviewFrameReady + 1;
      sameWebviewFrameBootstrapDelivered = await this.waitForLifecycleRacePostedMessageCount(
        oldFrame,
        'host/bootstrap',
        oldBootstrapCountBeforeSameWebviewFrameReady + 1
      );
      const promotedLifecycleAfterSameWebviewFrameReady = this.getSurfaceLifecycleIdentity(surface);
      sameWebviewFrameLifecycleRebound =
        this.getSurfaceMessageWebview(surface) === oldFrame.webview &&
        promotedLifecycleAfterSameWebviewFrameReady?.generation === refreshedReadyLifecycle.generation &&
        promotedLifecycleAfterSameWebviewFrameReady.frameId === refreshedReadyLifecycle.frameId;
      this.handleWebviewMessage(
        surface,
        {
          type: 'webview/bootstrapAck',
          lifecycle: refreshedReadyLifecycle
        },
        oldFrame.webview
      );

      const focusMessageCountBeforeRetry = oldFrame.postedMessages.filter(
        (message) => message.type === 'host/focusGroup'
      ).length;
      this.postWorkspaceRootFocusGroupMessage(surface, 'workspace-root-lifecycle-race');
      const latestFocusMessageBeforeRefresh = oldFrame.postedMessages
        .filter((message) => message.type === 'host/focusGroup')
        .at(-1);

      const secondRefreshedReadyLifecycle: WebviewLifecycleIdentity = {
        ...oldLifecycle,
        frameId: 'frame-lifecycle-race-old-refresh-second'
      };
      this.handleWebviewMessage(
        surface,
        {
          type: 'webview/ready',
          lifecycle: secondRefreshedReadyLifecycle
        },
        oldFrame.webview
      );
      await this.waitForLifecycleRacePostedMessageCount(
        oldFrame,
        'host/bootstrap',
        oldBootstrapCountBeforeSameWebviewFrameReady + 2
      );
      this.handleWebviewMessage(
        surface,
        {
          type: 'webview/bootstrapAck',
          lifecycle: secondRefreshedReadyLifecycle
        },
        oldFrame.webview
      );
      const focusMessagesAfterRetry = oldFrame.postedMessages.filter(
        (message) => message.type === 'host/focusGroup'
      );
      const latestFocusMessageAfterRetry = focusMessagesAfterRetry.at(-1);
      focusMessageRetriedAfterFrameRefresh =
        latestFocusMessageBeforeRefresh?.lifecycle?.frameId === refreshedReadyLifecycle.frameId &&
        focusMessagesAfterRetry.length > focusMessageCountBeforeRetry + 1;
      focusMessageReachedRefreshedFrame =
        latestFocusMessageAfterRetry?.lifecycle?.frameId === secondRefreshedReadyLifecycle.frameId;

      this.lastVisibleCanvasCenterBySurface.panel = { x: -1, y: -1 };
      this.handleWebviewMessage(
        surface,
        {
          type: 'webview/updateViewportCenter',
          lifecycle: competingReadyLifecycle,
          payload: {
            visibleCenter: { x: 321, y: 654 }
          }
        },
        competingFrame.webview
      );
      staleMutationIgnored =
        this.lastVisibleCanvasCenterBySurface.panel?.x === -1 &&
        this.lastVisibleCanvasCenterBySurface.panel?.y === -1;

      const currentLifecycle = this.getSurfaceLifecycleIdentity(surface);
      if (!currentLifecycle) {
        throw new Error('Lifecycle race diagnostics expected a current lifecycle after ready promotion.');
      }

      const probeRequestId = 'lifecycle-race-probe';
      const probeSnapshot = this.createLifecycleRaceProbeSnapshot();
      const probePromise = new Promise<WebviewProbeSnapshot>((resolve, reject) => {
        const timeout = setTimeout(() => {
          this.pendingWebviewProbeRequests.delete(probeRequestId);
          reject(new Error('Lifecycle race probe did not resolve.'));
        }, 1000);
        this.pendingWebviewProbeRequests.set(probeRequestId, {
          surface,
          lifecycle: currentLifecycle,
          webview: oldFrame.webview,
          resolve,
          reject,
          timeout
        });
      });
      this.handleWebviewMessage(
        surface,
        {
          type: 'webview/testProbeResult',
          lifecycle: currentLifecycle,
          payload: {
            requestId: probeRequestId,
            snapshot: probeSnapshot
          }
        },
        competingFrame.webview
      );
      staleProbeResultIgnored = this.pendingWebviewProbeRequests.has(probeRequestId);
      this.handleWebviewMessage(
        surface,
        {
          type: 'webview/testProbeResult',
          lifecycle: currentLifecycle,
          payload: {
            requestId: probeRequestId,
            snapshot: probeSnapshot
          }
        },
        oldFrame.webview
      );
      pendingProbeResolvedFromCurrent = (await probePromise).documentTitle === probeSnapshot.documentTitle;

      const domActionRequestId = 'lifecycle-race-dom-action';
      const domActionPromise = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          this.pendingWebviewDomActionRequests.delete(domActionRequestId);
          reject(new Error('Lifecycle race DOM action did not resolve.'));
        }, 1000);
        this.pendingWebviewDomActionRequests.set(domActionRequestId, {
          surface,
          lifecycle: currentLifecycle,
          webview: oldFrame.webview,
          resolve,
          reject,
          timeout
        });
      });
      this.handleWebviewMessage(
        surface,
        {
          type: 'webview/testDomActionResult',
          lifecycle: currentLifecycle,
          payload: {
            requestId: domActionRequestId,
            ok: true
          }
        },
        competingFrame.webview
      );
      staleDomActionResultIgnored = this.pendingWebviewDomActionRequests.has(domActionRequestId);
      this.handleWebviewMessage(
        surface,
        {
          type: 'webview/testDomActionResult',
          lifecycle: currentLifecycle,
          payload: {
            requestId: domActionRequestId,
            ok: true
          }
        },
        oldFrame.webview
      );
      await domActionPromise;
      pendingDomActionResolvedFromCurrent = true;

      const diagnosticKinds = this.testDiagnosticEvents.map((event) => event.kind);
      return {
        surface,
        promoted: diagnosticKinds.includes('surface/readyWebviewPromoted'),
        ready: this.surfaceReady[surface],
        bootstrapAck: this.surfaceLifecycle[surface].bootstrapAck === true,
        bootstrapDeliveredToPromotedWebview: oldFrame.postedMessages.some(
          (message) => message.type === 'host/bootstrap'
        ),
        secondReadyPromotionIgnored,
        secondReadyBootstrapSuppressed,
        messageTargetStayedOnPromotedWebview,
        sameWebviewFrameReadyPromoted,
        sameWebviewFrameBootstrapDelivered,
        sameWebviewFrameLifecycleRebound,
        gatedMessageQueuedBeforeAck,
        gatedMessageDeliveredBeforeAck,
        gatedMessageDeliveredAfterAck,
        staleMutationIgnored,
        staleProbeResultIgnored,
        pendingProbeResolvedFromCurrent,
        staleDomActionResultIgnored,
        pendingDomActionResolvedFromCurrent,
        focusMessageRetriedAfterFrameRefresh,
        focusMessageReachedRefreshedFrame,
        templateCatalogPostSettled,
        oldLifecycle: oldReadyLifecycle,
        competingLifecycle: competingReadyLifecycle,
        currentLifecycle: this.getSurfaceLifecycleIdentity(surface),
        oldWebviewPostedTypes: oldFrame.postedMessages.map((message) => message.type),
        competingWebviewPostedTypes: competingFrame.postedMessages.map((message) => message.type),
        diagnosticKinds
      };
    } finally {
      this.clearPendingWorkspaceRootFocusReplay();
      this.renderedWebviewLifecycle.delete(oldFrame.webview);
      this.renderedWebviewLifecycle.delete(competingFrame.webview);
      this.activeSurface = previousActiveSurface;
      this.restoreSurfaceLifecycleStateForTest('editor', previousSurfaceMode, previousSurfaceReady, previousSurfaceLifecycle);
      this.restoreSurfaceLifecycleStateForTest('panel', previousSurfaceMode, previousSurfaceReady, previousSurfaceLifecycle);
      this.restoreSurfaceMessageWebviewForTest('editor', previousSurfaceMessageWebview.editor);
      this.restoreSurfaceMessageWebviewForTest('panel', previousSurfaceMessageWebview.panel);
      if (this.panelView === diagnosticPanelView) {
        this.panelView = previousPanelView;
      }
      this.restorePendingBootstrapHostMessagesForTest('editor', previousPendingBootstrapHostMessages.editor);
      this.restorePendingBootstrapHostMessagesForTest('panel', previousPendingBootstrapHostMessages.panel);
      this.canvasTemplateInitialized = previousCanvasTemplateInitialized;
      if (hadPreviousPanelCenter) {
        this.lastVisibleCanvasCenterBySurface.panel = previousPanelCenter!;
      } else {
        delete this.lastVisibleCanvasCenterBySurface.panel;
      }
      this.diagnosticHostMessages.splice(0, this.diagnosticHostMessages.length, ...previousDiagnosticHostMessages);
      this.testHostMessages.splice(0, this.testHostMessages.length, ...previousTestHostMessages);
      this.testDiagnosticEvents.splice(0, this.testDiagnosticEvents.length, ...previousTestDiagnosticEvents);
    }
  }

  private createLifecycleRaceFakeWebview(label: string): CanvasLifecycleRaceFakeWebview {
    const postedMessages: HostToWebviewMessage[] = [];
    const webview = {
      options: {},
      html: '',
      cspSource: `vscode-webview://dev-session-canvas-lifecycle-race-${label}`,
      asWebviewUri: (uri: vscode.Uri) => uri,
      postMessage: (message: HostToWebviewMessage) => {
        postedMessages.push(cloneJsonValue(message));
        return Promise.resolve(true);
      },
      onDidReceiveMessage: () => ({
        dispose: () => undefined
      })
    } as unknown as vscode.Webview;

    return {
      webview,
      postedMessages
    };
  }

  private createLifecycleRaceProbeSnapshot(): WebviewProbeSnapshot {
    return {
      documentTitle: 'lifecycle-race-probe',
      hasDocumentFocus: false,
      hasCanvasShell: true,
      hasReactFlow: true,
      toastMessage: null,
      executionLinkTooltipText: null,
      nodeCount: 0,
      nodes: [],
      edgeCount: 0,
      edges: []
    };
  }

  private async waitForLifecycleRaceTemplateCatalogPost(
    frame: CanvasLifecycleRaceFakeWebview,
    timeoutMs = 1000
  ): Promise<boolean> {
    return this.waitForLifecycleRacePostedMessage(frame, 'host/templateCatalogUpdated', timeoutMs, {
      diagnosticKind: 'template/catalogPostFailed'
    });
  }

  private async waitForLifecycleRacePostedMessage(
    frame: CanvasLifecycleRaceFakeWebview,
    type: HostToWebviewMessage['type'],
    timeoutMs = 1000,
    options?: { diagnosticKind?: string }
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (
        frame.postedMessages.some((message) => message.type === type) ||
        (options?.diagnosticKind
          ? this.testDiagnosticEvents.some((event) => event.kind === options.diagnosticKind)
          : false)
      ) {
        return true;
      }

      await delay(25);
    }

    return false;
  }

  private async waitForLifecycleRacePostedMessageCount(
    frame: CanvasLifecycleRaceFakeWebview,
    type: HostToWebviewMessage['type'],
    expectedCount: number,
    timeoutMs = 1000
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (frame.postedMessages.filter((message) => message.type === type).length >= expectedCount) {
        return true;
      }

      await delay(25);
    }

    return false;
  }

  private restoreSurfaceLifecycleStateForTest(
    surface: CanvasSurfaceLocation,
    previousSurfaceMode: Partial<Record<CanvasSurfaceLocation, CanvasSurfaceMode>>,
    previousSurfaceReady: Record<CanvasSurfaceLocation, boolean>,
    previousSurfaceLifecycle: Record<CanvasSurfaceLocation, CanvasSurfaceLifecycleState>
  ): void {
    if (previousSurfaceMode[surface]) {
      this.surfaceMode[surface] = previousSurfaceMode[surface];
    } else {
      delete this.surfaceMode[surface];
    }
    this.surfaceReady[surface] = previousSurfaceReady[surface];
    this.surfaceLifecycle[surface] = { ...previousSurfaceLifecycle[surface] };
  }

  private restoreSurfaceMessageWebviewForTest(
    surface: CanvasSurfaceLocation,
    webview: vscode.Webview | undefined
  ): void {
    if (webview) {
      this.surfaceMessageWebview[surface] = webview;
    } else {
      delete this.surfaceMessageWebview[surface];
    }
  }

  private restorePendingBootstrapHostMessagesForTest(
    surface: CanvasSurfaceLocation,
    messages: HostToWebviewMessage[] | undefined
  ): void {
    if (messages) {
      this.pendingBootstrapHostMessages[surface] = messages.slice();
    } else {
      delete this.pendingBootstrapHostMessages[surface];
    }
  }

  public async deserializeWebviewPanel(
    webviewPanel: vscode.WebviewPanel,
    _state: unknown
  ): Promise<void> {
    this.state = this.loadReconciledState();
    this.canvasTemplateInitialized = this.readCanvasTemplateInitializedFlag(this.state);
    this.persistState({ reason: 'editor-restore' });
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

  private async revealSurface(
    surface: CanvasSurfaceLocation,
    options?: { restoreWebviewFocus?: boolean }
  ): Promise<void> {
    await this.ensureDefaultTemplateAppliedIfNeeded();
    this.recordDiagnosticEvent('surface/revealRequested', {
      from: this.activeSurface,
      to: surface
    });
    this.activeSurface = surface;
    this.persistActiveSurface();
    this.applyWorkbenchContextKeys();
    if (options?.restoreWebviewFocus === false) {
      this.pendingVisibilityRestoreFocus[surface] = false;
    } else {
      delete this.pendingVisibilityRestoreFocus[surface];
    }

    if (surface === 'editor') {
      this.renderStandbySurface('panel');

      if (this.editorPanel) {
        this.ensureActiveSurfaceRendered('editor');
        await this.refocusInteractiveSurface('editor', options);
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
      await this.refocusInteractiveSurface('editor', options);
      this.notifySidebarStateChanged();
      return;
    }

    if (this.editorPanel) {
      this.editorPanel.dispose();
    }

    if (this.panelView) {
      this.ensureActiveSurfaceRendered('panel');
      await this.refocusInteractiveSurface('panel', options);
      this.notifySidebarStateChanged();
      return;
    }

    await this.revealPanelView();
    this.notifySidebarStateChanged();
  }

  private attachEditorPanel(panel: vscode.WebviewPanel): void {
    this.editorPanel = panel;
    const editorWebview = panel.webview;
    this.invalidateSurfaceLifecycle('editor');
    this.claimSurfaceIfNeeded('editor');
    this.recordDiagnosticEvent('surface/attached', {
      surface: 'editor'
    });
    editorWebview.options = this.getWebviewOptions();

    panel.onDidDispose(
      () => {
        const wasMessageWebview = this.surfaceMessageWebview.editor === editorWebview;
        if (wasMessageWebview) {
          this.bindSurfaceMessageWebview('editor', undefined, 'dispose');
          this.rejectPendingWebviewProbeRequests('editor', '编辑区 Webview 已被关闭。');
          this.rejectPendingWebviewDomActionRequests('editor', '编辑区 Webview 已被关闭。');
          if (this.editorPanel !== panel) {
            this.recoverSurfaceAfterMessageWebviewDisposed('editor');
          }
        }
        this.renderedWebviewLifecycle.delete(editorWebview);

        if (this.editorPanel === panel) {
          this.editorPanel = undefined;
          if (this.activeSurface === 'editor') {
            this.activeSurface = undefined;
            this.applyWorkbenchContextKeys();
          }
          this.invalidateSurfaceLifecycle('editor');
          this.pendingVisibilityRestore.editor = false;
          this.recordDiagnosticEvent('surface/disposed', {
            surface: 'editor'
          });
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

    editorWebview.onDidReceiveMessage(
      (message) => this.handleWebviewMessage('editor', message, editorWebview),
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
    const panelWebview = webviewView.webview;
    this.invalidateSurfaceLifecycle('panel');
    this.claimSurfaceIfNeeded('panel');
    this.recordDiagnosticEvent('surface/attached', {
      surface: 'panel'
    });
    panelWebview.options = this.getWebviewOptions();

    webviewView.onDidDispose(
      () => {
        const wasMessageWebview = this.surfaceMessageWebview.panel === panelWebview;
        if (wasMessageWebview) {
          this.bindSurfaceMessageWebview('panel', undefined, 'dispose');
          this.rejectPendingWebviewProbeRequests('panel', '面板 Webview 已被关闭。');
          this.rejectPendingWebviewDomActionRequests('panel', '面板 Webview 已被关闭。');
          if (this.panelView !== webviewView) {
            this.recoverSurfaceAfterMessageWebviewDisposed('panel');
          }
        }
        this.renderedWebviewLifecycle.delete(panelWebview);

        if (this.panelView === webviewView) {
          this.panelView = undefined;
          if (this.activeSurface === 'panel') {
            this.activeSurface = undefined;
            this.applyWorkbenchContextKeys();
          }
          this.invalidateSurfaceLifecycle('panel');
          this.pendingVisibilityRestore.panel = false;
          this.recordDiagnosticEvent('surface/disposed', {
            surface: 'panel'
          });
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

    panelWebview.onDidReceiveMessage(
      (message) => this.handleWebviewMessage('panel', message, panelWebview),
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
      enableCommandUris: [
        COMMAND_IDS.openCanvas,
        COMMAND_IDS.openCanvasInEditor,
        COMMAND_IDS.openCanvasInPanel
      ],
      localResourceRoots: this.getWebviewLocalResourceRoots()
    };
  }

  private getWebviewLocalResourceRoots(): vscode.Uri[] {
    const roots = [
      vscode.Uri.joinPath(this.context.extensionUri, 'dist'),
      ...(vscode.workspace.workspaceFolders ?? []).map((workspaceFolder) => workspaceFolder.uri),
      ...this.listAssociatedNoteMarkdownResourceDirectories()
    ];
    const seen = new Set<string>();
    return roots.filter((root) => {
      const key = root.toString();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  private listAssociatedNoteMarkdownResourceDirectories(): vscode.Uri[] {
    return this.state.nodes.flatMap((node) => {
      if (node.kind !== 'note') {
        return [];
      }

      const source = ensureNoteMetadata(node).contentSource;
      if (source?.kind !== 'markdown-file') {
        return [];
      }

      const uri = this.parseCurrentHostNoteMarkdownUri(source.resourceUri);
      return uri ? [dirnameUri(uri)] : [];
    });
  }

  private formatWebviewResourceBaseUri(webview: vscode.Webview, directoryUri: vscode.Uri): string {
    const resourceUri = webview.asWebviewUri(directoryUri.with({ query: '', fragment: '' })).toString();
    return resourceUri.endsWith('/') ? resourceUri : `${resourceUri}/`;
  }

  private getCurrentWebviewRemoteAuthority(
    webview: vscode.Webview | undefined = this.getActiveWebview()
  ): string | undefined {
    if (this.currentWebviewRemoteAuthority) {
      return this.currentWebviewRemoteAuthority;
    }
    if (!webview) {
      return undefined;
    }

    try {
      // VS Code encodes the full Remote authority into webview resource URIs.
      const probeUri = webview.asWebviewUri(vscode.Uri.file(process.cwd())).toString();
      this.currentWebviewRemoteAuthorityProbeUri = probeUri;
      this.currentWebviewRemoteAuthorityProbeError = undefined;
      const remoteAuthority = extractNoteMarkdownCurrentRemoteAuthorityFromWebviewResourceUri(probeUri);
      if (remoteAuthority) {
        this.currentWebviewRemoteAuthority = remoteAuthority;
        this.recordDiagnosticEvent('noteMarkdown/currentRemoteAuthorityInferred', {
          probeUri,
          remoteAuthority,
          normalizedRemoteAuthority: normalizeNoteMarkdownAuthority(remoteAuthority),
          remoteName: vscode.env.remoteName
        });
        this.scheduleNoteMarkdownCurrentHostRecanonicalize();
      } else {
        this.recordDiagnosticEvent('noteMarkdown/currentRemoteAuthorityProbeMissed', {
          probeUri,
          remoteName: vscode.env.remoteName
        });
      }
      return remoteAuthority;
    } catch (error) {
      this.currentWebviewRemoteAuthorityProbeError = formatUnknownError(error);
      this.recordDiagnosticEvent('noteMarkdown/currentRemoteAuthorityProbeFailed', {
        error: this.currentWebviewRemoteAuthorityProbeError,
        remoteName: vscode.env.remoteName
      });
      return undefined;
    }
  }

  private canonicalizeCurrentHostNoteMarkdownUri(
    uri: vscode.Uri,
    webview: vscode.Webview | undefined = this.getActiveWebview()
  ): vscode.Uri {
    return canonicalizeNoteMarkdownUriForCurrentHost(
      uri,
      this.getCurrentWebviewRemoteAuthority(webview)
    );
  }

  private parseCurrentHostNoteMarkdownUri(value: string): vscode.Uri | undefined {
    const uri = parseStoredNoteMarkdownResourceUri(value);
    return uri ? this.canonicalizeCurrentHostNoteMarkdownUri(uri) : undefined;
  }

  private scheduleNoteMarkdownCurrentHostRecanonicalize(): void {
    if (this.didScheduleNoteMarkdownCurrentHostRecanonicalize) {
      return;
    }

    this.didScheduleNoteMarkdownCurrentHostRecanonicalize = true;
    setTimeout(() => {
      void this.refreshAllAssociatedMarkdownNotes().finally(() => {
        this.syncNoteMarkdownFileWatchers();
      });
    }, 0);
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

  private readCanvasTemplateInitializedFlag(state: CanvasPrototypeState): boolean {
    return this.getStoredValue<boolean>(STORAGE_KEYS.canvasTemplateInitialized) === true || state.nodes.length > 0;
  }

  private notifyTemplateCatalogChanged(): void {
    this.templateCatalogEmitter.fire();
    void this.postCanvasTemplateCatalogToActiveWebview();
  }

  private async postCanvasTemplateCatalogToActiveWebview(): Promise<void> {
    if (
      !this.activeSurface ||
      !this.surfaceReady[this.activeSurface] ||
      !this.isInteractiveSurface(this.activeSurface) ||
      !this.surfaceLifecycle[this.activeSurface].bootstrapAck
    ) {
      return;
    }

    try {
      const catalog = await this.getCanvasTemplateCatalog();
      const defaultTemplateId = await this.reconcileDefaultCanvasTemplateId(catalog);
      this.postMessage({
        type: 'host/templateCatalogUpdated',
        payload: {
          templates: buildCanvasTemplateMenuEntries(catalog.templates, defaultTemplateId)
        }
      });
    } catch (error) {
      this.recordDiagnosticEvent('template/catalogPostFailed', {
        message: formatUnknownError(error)
      });
    }
  }

  private resolvePreferredCanvasCenter(explicitCenter?: CanvasNodePosition): CanvasNodePosition | undefined {
    if (explicitCenter) {
      return explicitCenter;
    }

    const activeCenter = this.activeSurface ? this.lastVisibleCanvasCenterBySurface[this.activeSurface] : undefined;
    if (activeCenter) {
      return activeCenter;
    }

    return this.lastVisibleCanvasCenterBySurface[this.getConfiguredSurface()];
  }

  private resolvePreferredTemplatePlacementCenter(explicitCenter?: CanvasNodePosition): CanvasNodePosition | undefined {
    return this.resolvePreferredCanvasCenter(explicitCenter);
  }

  private async ensureDefaultTemplateAppliedIfNeeded(): Promise<void> {
    if (
      this.canvasTemplateInitialized ||
      this.state.nodes.length > 0 ||
      (this.state.groups ?? []).some(isWorkspaceRootGroup)
    ) {
      return;
    }

    const preferredCenter = this.resolvePreferredTemplatePlacementCenter();
    const preservedDefaultTemplateId = this.getDefaultCanvasTemplateId();
    try {
      const firstOpenTemplate = await this.resolveFirstOpenCanvasTemplateRecord();
      if (firstOpenTemplate) {
        await this.applyCanvasTemplateRecord(firstOpenTemplate, {
          visibleCenter: preferredCenter
        });
        this.recordDiagnosticEvent('template/gettingStartedAppliedOnFirstOpen', {
          templateId: firstOpenTemplate.template.id,
          preservedDefaultTemplateId
        });
        return;
      }
      this.recordDiagnosticEvent('template/gettingStartedMissingOnFirstOpen', {
        preservedDefaultTemplateId
      });
    } catch (error) {
      this.recordDiagnosticEvent('template/gettingStartedApplyFailedOnFirstOpen', {
        preservedDefaultTemplateId,
        message: error instanceof Error ? error.message : String(error)
      });
    }

    this.canvasTemplateInitialized = true;
    this.persistState({ reason: 'template-getting-started-initialized' });
  }

  private async resolveDefaultCanvasTemplateRecord(): Promise<CanvasStoredTemplate | undefined> {
    const catalog = await this.getCanvasTemplateCatalog();
    const defaultTemplateId = await this.reconcileDefaultCanvasTemplateId(catalog);
    return defaultTemplateId ? findCanvasTemplateById(catalog.templates, defaultTemplateId) : undefined;
  }

  private async reconcileDefaultCanvasTemplateId(catalog?: CanvasTemplateCatalog): Promise<string | undefined> {
    const resolvedCatalog = catalog ?? await this.getCanvasTemplateCatalog();
    const preferredTemplateId = this.getDefaultCanvasTemplateId();
    const defaultTemplateId = resolveEffectiveCanvasTemplateId(resolvedCatalog.templates, preferredTemplateId);

    if (defaultTemplateId && defaultTemplateId !== preferredTemplateId) {
      await this.context.globalState.update(CANVAS_DEFAULT_TEMPLATE_ID_GLOBAL_STATE_KEY, defaultTemplateId);
    }

    return defaultTemplateId;
  }

  private async resolveFirstOpenCanvasTemplateRecord(): Promise<CanvasStoredTemplate | undefined> {
    const catalog = await this.getCanvasTemplateCatalog();
    return findCanvasTemplateById(catalog.templates, DEFAULT_BUILTIN_CANVAS_TEMPLATE_ID);
  }

  private async applyCanvasTemplateRecord(
    storedTemplate: CanvasStoredTemplate,
    options?: {
      reset?: boolean;
      visibleCenter?: CanvasNodePosition;
      targetGroupId?: string;
      focusAppliedNodes?: boolean;
      quietOnFailure?: boolean;
    }
  ): Promise<string[]> {
    const isMultiRootWorkspace = (vscode.workspace.workspaceFolders?.length ?? 0) > 1;
    if (isMultiRootWorkspace && options?.reset) {
      throw new Error('多根 workspace 中暂不支持重置模板；请单独打开目标 root 后重置，或在 root section 内追加模板。');
    }

    const resolvedAgentProviders = await this.validateCanvasTemplateForApply(storedTemplate.template);
    const noteMaterializations = await this.resolveCanvasTemplateNoteMaterializations(storedTemplate.template, {
      quiet: options?.quietOnFailure === true
    });
    const nextBaseState = options?.reset
      ? createDefaultState(this.getAgentCliConfig().defaultProvider)
      : this.state;
    let targetGroupId = options?.reset
      ? undefined
      : resolveValidTargetGroupId(nextBaseState.groups ?? [], options?.targetGroupId);
    if (isMultiRootWorkspace && !targetGroupId) {
      targetGroupId = await this.pickWorkspaceRootGroupId('模板所属 root');
      if (!targetGroupId) {
        throw new Error('多根 workspace 中应用模板需要选择目标 root。');
      }
    }
    let targetGroup = targetGroupId
      ? (nextBaseState.groups ?? []).find((group) => group.id === targetGroupId)
      : undefined;
    let targetRootGroupId = targetGroup
      ? isWorkspaceRootGroup(targetGroup)
        ? targetGroup.id
        : resolveContainingWorkspaceRootGroupId(nextBaseState.groups ?? [], targetGroup.id)
      : undefined;
    let targetRootGroup = targetRootGroupId
      ? (nextBaseState.groups ?? []).find((group) => group.id === targetRootGroupId && isWorkspaceRootGroup(group))
      : undefined;
    if (isMultiRootWorkspace && !targetRootGroup) {
      targetGroupId = await this.pickWorkspaceRootGroupId('模板所属 root');
      if (!targetGroupId) {
        throw new Error('多根 workspace 中应用模板需要选择目标 root。');
      }
      targetGroup = (nextBaseState.groups ?? []).find((group) => group.id === targetGroupId);
      targetRootGroupId = targetGroup
        ? isWorkspaceRootGroup(targetGroup)
          ? targetGroup.id
          : resolveContainingWorkspaceRootGroupId(nextBaseState.groups ?? [], targetGroup.id)
        : undefined;
      targetRootGroup = targetRootGroupId
        ? (nextBaseState.groups ?? []).find((group) => group.id === targetRootGroupId && isWorkspaceRootGroup(group))
        : undefined;
      if (!targetRootGroup) {
        throw new Error('多根 workspace 中应用模板需要选择目标 root。');
      }
    }
    const targetWorkspaceRootPath = targetRootGroup ? resolveWorkspaceRootPathForGroup(targetRootGroup) : undefined;
    const rawPreferredCenter = this.resolvePreferredTemplatePlacementCenter(options?.visibleCenter);
    const preferredCenterInComposedState = targetGroup && isWorkspaceRootGroup(targetGroup)
      ? resolveTemplatePlacementCenterInWorkspaceRoot(targetGroup, storedTemplate.template, rawPreferredCenter)
      : rawPreferredCenter;
    const applyBaseState = targetRootGroup
      ? this.prepareStateForWorkspaceRootLocalCreate(targetRootGroup)
      : nextBaseState;
    const preferredCenter = preferredCenterInComposedState && targetRootGroup
      ? translateComposedCanvasPositionToRootLocal(preferredCenterInComposedState, targetRootGroup)
      : preferredCenterInComposedState;
    const targetGroupIdForApply = targetRootGroup
      ? targetGroup && !isWorkspaceRootGroup(targetGroup)
        ? denamespaceCanvasObjectId(targetWorkspaceRootPath ?? '', targetGroup.id) ?? targetGroup.id
        : undefined
      : targetGroupId;

    if (options?.reset) {
      await this.prepareForHostBoundary({
        preserveLiveRuntime: false,
        allowRuntimeSupervisorRestart: false,
        invalidatePendingExecutionOperations: true
      });
    }

    const applyResult = applyCanvasTemplateToState(applyBaseState, storedTemplate.template, {
      preferredCenter,
      targetGroupId: targetGroupIdForApply,
      resolvedAgentProviders,
      noteMaterializations,
      executionCwdOverride: targetWorkspaceRootPath
    });
    const appliedState = targetRootGroup
      ? this.namespaceWorkspaceRootLocalCreateState(applyResult.state, targetRootGroup)
      : applyResult.state;
    const appliedNodeIds = targetWorkspaceRootPath && targetRootGroup
      ? applyResult.nodeIds.map((nodeId) => namespaceCanvasObjectId(targetWorkspaceRootPath, nodeId))
      : applyResult.nodeIds;
    this.state = this.reconcileCanvasFileArtifacts(appliedState);
    this.canvasTemplateInitialized = true;
    this.persistState({ reason: 'template-applied' });
    this.recordDiagnosticEvent('template/applied', {
      templateId: storedTemplate.template.id,
      templateName: storedTemplate.template.name,
      reset: options?.reset === true,
      nodeCount: storedTemplate.template.nodes.length,
      edgeCount: storedTemplate.template.edges.length
    });
    this.postState('host/stateUpdated');
    if (options?.focusAppliedNodes === true) {
      this.requestTemplateNodeGroupFocus(appliedNodeIds);
    }
    return appliedNodeIds;
  }

  private async confirmCanvasTemplateReset(targetLabel: string): Promise<boolean> {
    const confirmed = await vscode.window.showWarningMessage(
      `重置会清空当前 workspace 绑定的画布对象，并终止运行中的 Agent / Terminal 会话，然后套用${targetLabel}。`,
      { modal: true },
      '继续重置'
    );
    return confirmed === '继续重置';
  }

  private async validateCanvasTemplateForApply(template: CanvasTemplate): Promise<Map<number, AgentProviderKind>> {
    const resolvedAgentProviders = new Map<number, AgentProviderKind>();
    const uniqueProviders = new Set<AgentProviderKind>();
    const containsExecutionNode = template.nodes.some((node) => node.kind === 'agent' || node.kind === 'terminal');

    if (containsExecutionNode && !vscode.workspace.isTrusted) {
      throw new Error('当前 workspace 未受信任，只有纯 Note 模板可以应用。');
    }

    for (const [index, node] of template.nodes.entries()) {
      if (node.kind !== 'agent') {
        continue;
      }

      const resolvedProvider = resolveCanvasTemplateAgentProvider(
        node.metadata?.agent?.provider ?? 'default',
        this.getAgentCliConfig().defaultProvider
      );
      resolvedAgentProviders.set(index, resolvedProvider);
      uniqueProviders.add(resolvedProvider);
    }

    for (const provider of uniqueProviders) {
      try {
        await this.resolveAgentCli(provider);
      } catch (error) {
        throw new Error(
          `模板「${template.name}」要求使用 ${agentProviderDisplayLabel(provider)}，但当前环境不可用：${formatUnknownError(error)}`
        );
      }
    }

    return resolvedAgentProviders;
  }

  private async resolveCanvasTemplateNoteMaterializations(
    template: CanvasTemplate,
    options: { quiet: boolean }
  ): Promise<Map<number, CanvasTemplateNoteMaterialization>> {
    const materializations = new Map<number, CanvasTemplateNoteMaterialization>();

    for (const [index, node] of template.nodes.entries()) {
      if (node.kind !== 'note') {
        continue;
      }

      const note = node.metadata?.note;
      const mode = note?.templateContentMode ?? 'embedded-snapshot';
      if (mode === 'embedded-snapshot') {
        continue;
      }

      const relativePath = normalizeCanvasTemplateWorkspaceRelativePath(note?.relativePath ?? '');
      if (!relativePath) {
        throw new Error(`模板「${template.name}」中的 Note「${node.title}」缺少合法 workspace 相对路径。`);
      }

      const uri = this.resolveCanvasTemplateWorkspaceRelativeMarkdownUri(relativePath);
      if (!uri) {
        throw new Error(`当前 workspace 无法解析模板 Note「${node.title}」的相对路径：${relativePath}`);
      }

      const materialization =
        mode === 'workspace-file-path-only'
          ? await this.resolvePathOnlyCanvasTemplateNoteMaterialization(template.name, node.title, relativePath, uri)
          : await this.resolveContentBackedCanvasTemplateNoteMaterialization(
              template.name,
              node.title,
              relativePath,
              uri,
              note?.content ?? ''
            );
      materializations.set(index, materialization);
    }

    return materializations;
  }

  private resolveCanvasTemplateWorkspaceRelativeMarkdownUri(relativePath: string): vscode.Uri | undefined {
    const normalizedPath = normalizeCanvasTemplateWorkspaceRelativePath(relativePath);
    if (!normalizedPath || !isSupportedNoteMarkdownFilePath(normalizedPath)) {
      return undefined;
    }

    const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
    if (workspaceFolders.length === 0) {
      return undefined;
    }

    const parts = normalizedPath.split('/');
    if (workspaceFolders.length === 1) {
      return vscode.Uri.joinPath(workspaceFolders[0].uri, ...parts);
    }

    const [folderName, ...fileParts] = parts;
    if (fileParts.length === 0) {
      return undefined;
    }

    const workspaceFolder = workspaceFolders.find((folder) => folder.name === folderName);
    return workspaceFolder ? vscode.Uri.joinPath(workspaceFolder.uri, ...fileParts) : undefined;
  }

  private async resolvePathOnlyCanvasTemplateNoteMaterialization(
    templateName: string,
    noteTitle: string,
    relativePath: string,
    uri: vscode.Uri
  ): Promise<CanvasTemplateNoteMaterialization> {
    const readResult = await this.readNoteMarkdownFile(uri);
    if (readResult.status === 'ok') {
      return this.createCanvasTemplateAssociatedNoteMaterialization(uri, readResult.content, {
        status: 'ok',
        contentRevision: readResult.contentRevision
      });
    }

    if (readResult.status !== 'missing') {
      return this.createCanvasTemplateAssociatedNoteMaterialization(uri, '', {
        status: readResult.status,
        lastError: readResult.lastError
      });
    }

    return this.createCanvasTemplateAssociatedNoteMaterialization(uri, '', {
      status: 'missing',
      lastError:
        readResult.lastError ??
        `模板「${templateName}」中的 Note「${noteTitle}」只保留了路径，但当前 workspace 中没有 ${relativePath}。`
    });
  }

  private async resolveContentBackedCanvasTemplateNoteMaterialization(
    templateName: string,
    noteTitle: string,
    relativePath: string,
    uri: vscode.Uri,
    templateContent: string
  ): Promise<CanvasTemplateNoteMaterialization> {
    const readResult = await this.readNoteMarkdownFile(uri);
    if (readResult.status === 'missing') {
      return this.createCanvasTemplateMarkdownFileAndMaterialization(uri, templateContent);
    }

    if (readResult.status !== 'ok') {
      throw new Error(`无法为模板「${templateName}」应用 Note「${noteTitle}」：${readResult.lastError ?? readResult.status}`);
    }

    if (readResult.content === templateContent) {
      return this.createCanvasTemplateAssociatedNoteMaterialization(uri, readResult.content, {
        status: 'ok',
        contentRevision: readResult.contentRevision
      });
    }

    const recoverableDraft = this.createStoredNoteMarkdownRecoverableDraft(
      templateContent,
      readResult.contentRevision,
      readResult.contentRevision
    );
    return this.createCanvasTemplateAssociatedNoteMaterialization(uri, readResult.content, {
      status: 'dirty-conflict',
      contentRevision: readResult.contentRevision,
      lastError: `模板「${templateName}」中的 Note「${noteTitle}」与现有文件 ${relativePath} 内容不同。请在节点内重新加载现有文件或覆盖为模板内容。`,
      recoverableDraft: {
        ...recoverableDraft,
        content: templateContent
      }
    });
  }

  private async createCanvasTemplateMarkdownFileAndMaterialization(
    uri: vscode.Uri,
    content: string
  ): Promise<CanvasTemplateNoteMaterialization> {
    await vscode.workspace.fs.createDirectory(getUriDirectory(uri));
    const writeResult = await this.writeNoteMarkdownFile(uri, content);
    if (!writeResult.ok) {
      throw new Error(writeResult.errorMessage);
    }

    return this.createCanvasTemplateAssociatedNoteMaterialization(uri, content, {
      status: 'ok',
      contentRevision: writeResult.contentRevision
    });
  }

  private createCanvasTemplateAssociatedNoteMaterialization(
    uri: vscode.Uri,
    content: string,
    params: {
      status: NoteMarkdownFileStatus;
      contentRevision?: string;
      lastError?: string;
      recoverableDraft?: NoteMarkdownRecoverableDraft;
    }
  ): CanvasTemplateNoteMaterialization {
    return {
      content,
      contentSource: {
        kind: 'markdown-file',
        resourceUri: uri.toString(),
        ...this.formatNoteMarkdownDisplayPathInfo(uri),
        contentRevision: params.contentRevision,
        status: params.status,
        lastError: params.lastError,
        recoverableDraft: params.recoverableDraft
      }
    };
  }

  private loadStoredCanvasFileFilterState(): CanvasFileFilterState {
    const snapshot = this.loadPersistedCanvasSnapshot();
    if (
      !this.appliedStartupConfiguration.filesFeatureEnabled ||
      this.shouldResetFileDomainDueToFilesFeatureModeChange(snapshot)
    ) {
      return createEmptyCanvasFileFilterState();
    }
    const storedFilterState =
      snapshot?.fileFilterState ?? this.getStoredValue<CanvasFileFilterState | undefined>(STORAGE_KEYS.canvasFileFilterState);
    if (storedFilterState !== undefined) {
      return normalizeCanvasFileFilterState(storedFilterState);
    }

    return {
      includeGlobs: readLegacyCanvasFileFilterGlobs('include'),
      excludeGlobs: readLegacyCanvasFileFilterGlobs('exclude')
    };
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

  private getRootLocalCanvasStorageDirectory(): string {
    return path.join(this.context.globalStorageUri.fsPath, ROOT_LOCAL_CANVAS_STORAGE_DIRECTORY);
  }

  private getRootLocalCanvasStoragePath(rootPath: string): string {
    return path.join(this.getRootLocalCanvasStorageDirectory(), createRootLocalCanvasStorageKey(rootPath));
  }

  private getRootLocalCanvasSnapshotPath(rootPath: string): string {
    return path.join(this.getRootLocalCanvasStoragePath(rootPath), 'canvas-state.json');
  }

  private getNoteMarkdownRecoverableDraftsStoragePath(): string {
    return path.join(this.getExtensionStoragePath(), NOTE_MARKDOWN_RECOVERABLE_DRAFTS_STORAGE_DIRECTORY);
  }

  private getNoteMarkdownRecoverableDraftPath(draftId: string | undefined): string | undefined {
    if (!draftId || !NOTE_MARKDOWN_RECOVERABLE_DRAFT_ID_PATTERN.test(draftId)) {
      return undefined;
    }

    return path.join(this.getNoteMarkdownRecoverableDraftsStoragePath(), `${draftId}.md`);
  }

  private readNoteMarkdownRecoverableDraftContent(draftId: string | undefined): string | undefined {
    const draftPath = this.getNoteMarkdownRecoverableDraftPath(draftId);
    if (!draftPath) {
      return undefined;
    }

    try {
      return fs.readFileSync(draftPath, 'utf8');
    } catch {
      return undefined;
    }
  }

  private writeNoteMarkdownRecoverableDraftContent(content: string, draftId?: string): string {
    const nextDraftId =
      draftId && NOTE_MARKDOWN_RECOVERABLE_DRAFT_ID_PATTERN.test(draftId) ? draftId : randomUUID();
    const draftPath = this.getNoteMarkdownRecoverableDraftPath(nextDraftId);
    if (!draftPath) {
      throw new Error('无法生成关联 Markdown 草稿文件路径。');
    }

    fs.mkdirSync(path.dirname(draftPath), {
      recursive: true
    });
    const tempDraftPath = `${draftPath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tempDraftPath, content, 'utf8');
    fs.renameSync(tempDraftPath, draftPath);
    return nextDraftId;
  }

  private cleanupUnreferencedNoteMarkdownRecoverableDraftFiles(): void {
    const draftsPath = this.getNoteMarkdownRecoverableDraftsStoragePath();
    if (!fs.existsSync(draftsPath)) {
      return;
    }

    const referencedDraftIds = new Set<string>();
    for (const node of this.state.nodes) {
      if (node.kind !== 'note') {
        continue;
      }

      const source = ensureNoteMetadata(node).contentSource;
      const draftId = source?.kind === 'markdown-file' ? source.recoverableDraft?.draftId : undefined;
      if (draftId && NOTE_MARKDOWN_RECOVERABLE_DRAFT_ID_PATTERN.test(draftId)) {
        referencedDraftIds.add(draftId);
      }
    }

    try {
      for (const entry of fs.readdirSync(draftsPath, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.md')) {
          continue;
        }
        const draftId = entry.name.slice(0, -'.md'.length);
        if (!NOTE_MARKDOWN_RECOVERABLE_DRAFT_ID_PATTERN.test(draftId) || referencedDraftIds.has(draftId)) {
          continue;
        }
        fs.rmSync(path.join(draftsPath, entry.name), { force: true });
      }
    } catch {
      // Do not let internal draft garbage collection block canvas persistence.
    }
  }

  private createStoredNoteMarkdownRecoverableDraft(
    content: string,
    baseContentRevision?: string,
    remoteContentRevision?: string,
    previousDraft?: NoteMarkdownRecoverableDraft
  ): NoteMarkdownRecoverableDraft {
    try {
      const draftId = this.writeNoteMarkdownRecoverableDraftContent(content, previousDraft?.draftId);
      return createNoteMarkdownRecoverableDraft({
        draftId,
        baseContentRevision,
        remoteContentRevision
      });
    } catch (error) {
      this.recordDiagnosticEvent('noteMarkdownDraft/writeFailed', {
        message: formatUnknownError(error)
      });
      return createNoteMarkdownRecoverableDraft({
        content,
        baseContentRevision,
        remoteContentRevision
      });
    }
  }

  private materializeNoteMarkdownRecoverableDraftFiles(state: CanvasPrototypeState): CanvasPrototypeState {
    let didChange = false;
    const nodes = state.nodes.map((node) => {
      if (node.kind !== 'note') {
        return node;
      }

      const noteMetadata = ensureNoteMetadata(node);
      const source = noteMetadata.contentSource;
      if (source?.kind !== 'markdown-file' || !source.recoverableDraft) {
        return node;
      }

      const draft = source.recoverableDraft;
      if (typeof draft.content !== 'string') {
        return node;
      }

      const nextDraft = this.createStoredNoteMarkdownRecoverableDraft(
        draft.content,
        draft.baseContentRevision,
        draft.remoteContentRevision,
        draft
      );
      didChange = true;
      return {
        ...node,
        metadata: {
          ...node.metadata,
          note: {
            ...noteMetadata,
            contentSource: {
              ...source,
              recoverableDraft: {
                ...nextDraft,
                updatedAt: draft.updatedAt
              }
            }
          }
        }
      };
    });

    return didChange
      ? {
          ...state,
          nodes
        }
      : state;
  }

  private hydrateNoteMarkdownRecoverableDraftsForWebview(state: CanvasPrototypeState): CanvasPrototypeState {
    let didChange = false;
    const nodes = state.nodes.map((node) => {
      if (node.kind !== 'note') {
        return node;
      }

      const noteMetadata = ensureNoteMetadata(node);
      const source = noteMetadata.contentSource;
      if (source?.kind !== 'markdown-file' || !source.recoverableDraft) {
        return node;
      }

      const draft = source.recoverableDraft;
      if (typeof draft.content === 'string') {
        return node;
      }

      const content = this.readNoteMarkdownRecoverableDraftContent(draft.draftId);
      if (typeof content !== 'string') {
        return node;
      }

      didChange = true;
      return {
        ...node,
        metadata: {
          ...node.metadata,
          note: {
            ...noteMetadata,
            contentSource: {
              ...source,
              recoverableDraft: {
                ...draft,
                content
              }
            }
          }
        }
      };
    });

    return didChange
      ? {
          ...state,
          nodes
        }
      : state;
  }

  private hydrateNoteMarkdownImageResourceBasesForWebview(
    state: CanvasPrototypeState,
    webview: vscode.Webview | undefined
  ): CanvasPrototypeState {
    if (!webview) {
      return state;
    }

    let didChange = false;
    const nodes = state.nodes.map((node) => {
      if (node.kind !== 'note') {
        return node;
      }

      const noteMetadata = ensureNoteMetadata(node);
      const source = noteMetadata.contentSource;
      if (source?.kind !== 'markdown-file') {
        return node;
      }

      const parsedUri = parseStoredNoteMarkdownResourceUri(source.resourceUri);
      const uri = parsedUri ? this.canonicalizeCurrentHostNoteMarkdownUri(parsedUri, webview) : undefined;
      if (!uri) {
        return node;
      }

      didChange = true;
      return {
        ...node,
        metadata: {
          ...node.metadata,
          note: {
            ...noteMetadata,
            contentSource: {
              ...source,
              resourceUri: uri.toString(),
              webviewResourceBaseUri: this.formatWebviewResourceBaseUri(webview, dirnameUri(uri))
            }
          }
        }
      };
    });

    return didChange
      ? {
          ...state,
          nodes
        }
      : state;
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

  private loadPersistedRootLocalCanvasSnapshot(rootPath: string): PersistedCanvasSnapshot | undefined {
    return this.loadPersistedCanvasSnapshotFromPath(this.getRootLocalCanvasSnapshotPath(rootPath));
  }

  private writeRootLocalCanvasSnapshot(rootPath: string, state: CanvasPrototypeState): void {
    const snapshotPath = this.getRootLocalCanvasSnapshotPath(rootPath);
    const rootLocalState = sanitizeRootLocalCanvasState(rootPath, state);
    this.writePersistedCanvasSnapshotToDisk(snapshotPath, this.buildPersistedCanvasSnapshot({
      version: 1,
      state: rootLocalState,
      activeSurface: this.activeSurface
    }));
  }

  private writeRootLocalCanvasSnapshotsForState(state: CanvasPrototypeState): CanvasMultiRootOverlay | undefined {
    const workspaceFolders = this.getMultiRootWorkspaceFoldersForComposition();
    if (workspaceFolders.length > 1) {
      const decomposed = decomposeMultiRootCanvasState({
        composedState: state,
        workspaceFolders,
        previousRootStates: this.lastLoadedRootLocalStates
      });
      this.lastLoadedRootLocalStates = cloneJsonValue(decomposed.rootStates);
      this.multiRootOverlay = decomposed.overlay;
      for (const rootState of decomposed.rootStates) {
        this.writeRootLocalCanvasSnapshot(rootState.rootPath, rootState.state);
      }
      return decomposed.overlay;
    }

    if (workspaceFolders.length === 1) {
      const rootPath = workspaceFolders[0].path;
      this.lastLoadedRootLocalStates = [{ rootPath, state: cloneJsonValue(state) }];
      this.multiRootOverlay = undefined;
      this.writeRootLocalCanvasSnapshot(rootPath, state);
    }
    return undefined;
  }

  private queuePersistedCanvasSnapshotWrite(
    snapshot: PersistedCanvasSnapshot,
    options: {
      mode?: CanvasStatePersistMode;
      workspaceStateMode?: CanvasWorkspaceStatePersistMode;
      reason?: string;
      rootLocalStates?: CanvasRootLocalStateSnapshot[];
    } = {}
  ): Promise<void> {
    const mode = options.mode ?? 'immediate';
    const workspaceStateMode = options.workspaceStateMode ?? (this.hasActiveExecutionSessions() ? 'skip' : 'full');
    const reason = options.reason ?? (mode === 'deferred' ? 'deferred' : 'persist-snapshot');
    if (mode === 'deferred') {
      this.scheduleDeferredCanvasStatePersist(
        snapshot,
        reason,
        workspaceStateMode,
        options.rootLocalStates
      );
      return this.pendingWorkspaceStateUpdate;
    }

    this.clearDeferredCanvasStatePersistTimer();
    if (this.pendingCanvasStatePersist) {
      this.recordDiagnosticEvent('state/persistDeferredSuperseded', {
        reason,
        coalescedCount: this.pendingCanvasStatePersist.coalescedCount,
        ...summarizeCanvasStateForDiagnostics(this.pendingCanvasStatePersist.snapshot.state)
      });
      this.pendingCanvasStatePersist = undefined;
    }
    return this.writePersistedCanvasSnapshotNow(snapshot, {
      mode,
      workspaceStateMode,
      reason,
      coalescedCount: 0
    });
  }

  private scheduleDeferredCanvasStatePersist(
    snapshot: PersistedCanvasSnapshot,
    reason: string,
    workspaceStateMode: CanvasWorkspaceStatePersistMode,
    rootLocalStates: CanvasRootLocalStateSnapshot[] | undefined
  ): void {
    const now = Date.now();
    const current = this.pendingCanvasStatePersist;
    const pending: PendingCanvasStatePersist = current
      ? {
          snapshot,
          rootLocalStates,
          requestedAtMs: current.requestedAtMs,
          latestRequestedAtMs: now,
          mode: 'deferred',
          workspaceStateMode: current.workspaceStateMode === 'full' ? 'full' : workspaceStateMode,
          reason,
          coalescedCount: current.coalescedCount + 1
        }
      : {
          snapshot,
          rootLocalStates,
          requestedAtMs: now,
          latestRequestedAtMs: now,
          mode: 'deferred',
          workspaceStateMode,
          reason,
          coalescedCount: 0
        };
    this.pendingCanvasStatePersist = pending;

    const elapsedMs = now - pending.requestedAtMs;
    const delayMs = Math.max(
      0,
      Math.min(CANVAS_STATE_DEFERRED_PERSIST_DEBOUNCE_MS, CANVAS_STATE_DEFERRED_PERSIST_MAX_WAIT_MS - elapsedMs)
    );
    this.recordDiagnosticEvent('state/persistDeferred', {
      reason,
      delayMs,
      coalescedCount: pending.coalescedCount,
      mode: 'deferred',
      workspaceStateMode: pending.workspaceStateMode,
      ...summarizeCanvasStateForDiagnostics(snapshot.state)
    });

    this.clearDeferredCanvasStatePersistTimer();
    this.pendingCanvasStatePersistTimer = setTimeout(() => {
      void this.flushDeferredCanvasStatePersist('timer').catch(() => undefined);
    }, delayMs);
  }

  private clearDeferredCanvasStatePersistTimer(): void {
    if (!this.pendingCanvasStatePersistTimer) {
      return;
    }

    clearTimeout(this.pendingCanvasStatePersistTimer);
    this.pendingCanvasStatePersistTimer = undefined;
  }

  private async flushDeferredCanvasStatePersist(trigger: string): Promise<void> {
    const pending = this.pendingCanvasStatePersist;
    if (!pending) {
      await this.pendingCanvasStatePersistFlush;
      return;
    }

    this.pendingCanvasStatePersist = undefined;
    this.clearDeferredCanvasStatePersistTimer();
    this.writeDeferredRootLocalCanvasSnapshots(pending);
    const operation = this.writePersistedCanvasSnapshotNow(pending.snapshot, {
      mode: pending.mode,
      workspaceStateMode: pending.workspaceStateMode,
      reason: `${pending.reason}:${trigger}`,
      coalescedCount: pending.coalescedCount
    });
    const flushBarrier = operation.then(
      () => undefined,
      () => undefined
    );
    this.pendingCanvasStatePersistFlush = flushBarrier;
    try {
      await operation;
    } finally {
      if (this.pendingCanvasStatePersistFlush === flushBarrier) {
        this.pendingCanvasStatePersistFlush = undefined;
      }
    }
  }

  private writeDeferredRootLocalCanvasSnapshots(pending: PendingCanvasStatePersist): void {
    if (!pending.rootLocalStates || pending.rootLocalStates.length === 0) {
      return;
    }

    const startedAt = Date.now();
    for (const rootState of pending.rootLocalStates) {
      try {
        this.writeRootLocalCanvasSnapshot(rootState.rootPath, rootState.state);
      } catch (error) {
        this.recordDiagnosticEvent('state/rootLocalPersistFailed', {
          rootPath: rootState.rootPath,
          mode: pending.mode,
          reason: pending.reason,
          message: formatUnknownError(error)
        });
      }
    }
    this.recordStatePersistPerformance('persist-root-local-snapshots', startedAt, pending.snapshot.state, undefined, {
      mode: pending.mode,
      workspaceStateMode: pending.workspaceStateMode,
      coalescedCount: pending.coalescedCount
    });
  }

  private writePersistedCanvasSnapshotNow(
    snapshot: PersistedCanvasSnapshot,
    options: {
      mode: CanvasStatePersistMode;
      workspaceStateMode: CanvasWorkspaceStatePersistMode;
      reason?: string;
      coalescedCount: number;
    }
  ): Promise<void> {
    const snapshotPath = this.getPersistedCanvasSnapshotPath();
    const snapshotWithMetadata = this.buildPersistedCanvasSnapshot(snapshot);
    const snapshotSummary = summarizeCanvasStateForDiagnostics(snapshotWithMetadata.state);
    this.recordDiagnosticEvent('state/persistQueued', {
      snapshotPath,
      activeSurface: snapshotWithMetadata.activeSurface,
      writePath: this.getExtensionStoragePath(),
      snapshotWrittenAt: snapshotWithMetadata.writtenAt,
      mode: options.mode,
      workspaceStateMode: options.workspaceStateMode,
      reason: options.reason,
      coalescedCount: options.coalescedCount,
      ...snapshotSummary
    });

    try {
      const writeStartedAt = Date.now();
      const byteLength = this.writePersistedCanvasSnapshotToDisk(snapshotPath, snapshotWithMetadata);
      this.lastPersistedCanvasSnapshotError = undefined;
      this.lastPersistedCanvasSnapshotWrittenAt = snapshotWithMetadata.writtenAt;
      this.recordStatePersistPerformance(
        'persist-snapshot-write',
        writeStartedAt,
        snapshotWithMetadata.state,
        byteLength,
        {
          mode: options.mode,
          workspaceStateMode: options.workspaceStateMode,
          coalescedCount: options.coalescedCount
        }
      );
      this.recordDiagnosticEvent('state/persistWritten', {
        snapshotPath,
        activeSurface: snapshotWithMetadata.activeSurface,
        writePath: this.getExtensionStoragePath(),
        writtenAt: snapshotWithMetadata.writtenAt,
        mode: options.mode,
        workspaceStateMode: options.workspaceStateMode,
        reason: options.reason,
        coalescedCount: options.coalescedCount,
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
        mode: options.mode,
        workspaceStateMode: options.workspaceStateMode,
        reason: options.reason,
        coalescedCount: options.coalescedCount,
        ...snapshotSummary
      });
      return Promise.reject(error);
    }

    if (options.workspaceStateMode === 'skip') {
      this.recordDiagnosticEvent('state/workspaceStateSkipped', {
        snapshotPath,
        activeSurface: snapshotWithMetadata.activeSurface,
        writePath: this.getExtensionStoragePath(),
        mode: options.mode,
        reason: options.reason,
        coalescedCount: options.coalescedCount,
        ...snapshotSummary
      });
      return Promise.resolve();
    }

    const operation = this.pendingWorkspaceStateUpdate.then(async () => {
      const workspaceUpdateStartedAt = Date.now();
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
      await this.context.workspaceState.update(
        STORAGE_KEYS.canvasFilesFeatureEnabled,
        snapshotWithMetadata.filesFeatureEnabled
      );
      await this.context.workspaceState.update(
        STORAGE_KEYS.canvasFileFilterState,
        normalizeCanvasFileFilterState(snapshotWithMetadata.fileFilterState)
      );
      await this.context.workspaceState.update(
        STORAGE_KEYS.canvasTemplateInitialized,
        this.canvasTemplateInitialized
      );
      this.lastPersistedCanvasSnapshotError = undefined;
      this.recordStatePersistPerformance(
        'persist-workspace-state',
        workspaceUpdateStartedAt,
        snapshotWithMetadata.state,
        undefined,
        {
          mode: options.mode,
          workspaceStateMode: options.workspaceStateMode,
          coalescedCount: options.coalescedCount
        }
      );
    }).catch((error) => {
      const message = formatUnknownError(error);
      this.lastPersistedCanvasSnapshotError = message;
      this.recordDiagnosticEvent('state/persistFailed', {
        message,
        snapshotPath,
        activeSurface: snapshotWithMetadata.activeSurface,
        writePath: this.getExtensionStoragePath(),
        mode: options.mode,
        workspaceStateMode: options.workspaceStateMode,
        reason: options.reason,
        coalescedCount: options.coalescedCount,
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
    const persistedFileFilterState = this.appliedStartupConfiguration.filesFeatureEnabled
      ? normalizeCanvasFileFilterState(this.fileFilterState)
      : createEmptyCanvasFileFilterState();
    const state = stripNoteMarkdownRecoverableDraftContentFromCanvasState(snapshot.state);
    return {
      ...snapshot,
      state,
      multiRootOverlay: normalizeCanvasMultiRootOverlay(snapshot.multiRootOverlay),
      fileFilterState: persistedFileFilterState,
      defaultSurface: this.appliedStartupConfiguration.defaultSurface,
      runtimePersistenceEnabled: this.appliedStartupConfiguration.runtimePersistenceEnabled,
      filesFeatureEnabled: this.appliedStartupConfiguration.filesFeatureEnabled,
      writtenAt: new Date().toISOString(),
      stateHash: buildDiagnosticStateHash(state)
    };
  }

  private writePersistedCanvasSnapshotToDisk(snapshotPath: string, snapshot: PersistedCanvasSnapshot): number {
    fs.mkdirSync(path.dirname(snapshotPath), {
      recursive: true
    });
    const tempSnapshotPath = `${snapshotPath}.tmp`;
    const serializedSnapshot = `${JSON.stringify(snapshot, null, 2)}\n`;
    const byteLength = Buffer.byteLength(serializedSnapshot, 'utf8');
    fs.writeFileSync(tempSnapshotPath, serializedSnapshot, 'utf8');
    fs.renameSync(tempSnapshotPath, snapshotPath);
    return byteLength;
  }

  private loadStoredRuntimePersistenceEnabled(snapshot?: PersistedCanvasSnapshot): boolean | undefined {
    return typeof snapshot?.runtimePersistenceEnabled === 'boolean'
      ? snapshot.runtimePersistenceEnabled
      : this.getStoredValue<boolean | undefined>(STORAGE_KEYS.canvasRuntimePersistenceEnabled);
  }

  private loadStoredFilesFeatureEnabled(snapshot?: PersistedCanvasSnapshot): boolean | undefined {
    return typeof snapshot?.filesFeatureEnabled === 'boolean'
      ? snapshot.filesFeatureEnabled
      : this.getStoredValue<boolean | undefined>(STORAGE_KEYS.canvasFilesFeatureEnabled);
  }

  private shouldResetStateDueToRuntimePersistenceModeChange(snapshot?: PersistedCanvasSnapshot): boolean {
    const storedRuntimePersistenceEnabled = this.loadStoredRuntimePersistenceEnabled(snapshot);
    return (
      typeof storedRuntimePersistenceEnabled === 'boolean' &&
      storedRuntimePersistenceEnabled !== this.appliedStartupConfiguration.runtimePersistenceEnabled
    );
  }

  private shouldResetFileDomainDueToFilesFeatureModeChange(snapshot?: PersistedCanvasSnapshot): boolean {
    const storedFilesFeatureEnabled = this.loadStoredFilesFeatureEnabled(snapshot);
    return (
      typeof storedFilesFeatureEnabled === 'boolean' &&
      storedFilesFeatureEnabled !== this.appliedStartupConfiguration.filesFeatureEnabled
    );
  }

  private loadState(): CanvasPrototypeState {
    const fileView = this.getCanvasFileViewConfiguration();
    const snapshot = this.loadPersistedCanvasSnapshot();
    const workspaceState = this.getStoredValue<unknown>(STORAGE_KEYS.canvasState);
    const workspaceFolders = this.getMultiRootWorkspaceFoldersForComposition();
    const isMultiRootWorkspace = workspaceFolders.length > 1;
    const storedRuntimePersistenceEnabled = this.loadStoredRuntimePersistenceEnabled(snapshot);
    const storedFilesFeatureEnabled = this.loadStoredFilesFeatureEnabled(snapshot);
    const resetDueToRuntimePersistenceModeChange =
      this.shouldResetStateDueToRuntimePersistenceModeChange(snapshot);
    const resetDueToFilesFeatureModeChange = this.shouldResetFileDomainDueToFilesFeatureModeChange(snapshot);
    if (workspaceFolders.length === 1 && !resetDueToRuntimePersistenceModeChange) {
      const rootLocalSnapshot = this.loadPersistedRootLocalCanvasSnapshot(workspaceFolders[0].path);
      if (rootLocalSnapshot?.state !== undefined) {
        const rootPath = workspaceFolders[0].path;
        const rootLocalSnapshotPath = this.getRootLocalCanvasSnapshotPath(rootPath);
        const rootState = this.loadRootLocalState(rootPath, fileView);
        const sanitizedRootState = resetDueToFilesFeatureModeChange ? clearFileDomainState(rootState) : rootState;
        const runtimeSafeRootState = this.downgradeRootLocalLiveRuntimeNodesMissingRuntimeStoragePath(
          rootPath,
          sanitizedRootState
        );
        const rootLocalSnapshotSummary = summarizeCanvasStateForDiagnostics(rootLocalSnapshot.state);
        const rootLocalLoadedStateSummary = summarizeCanvasStateForDiagnostics(runtimeSafeRootState);
        this.lastLoadedRootLocalStates = [{ rootPath, state: cloneJsonValue(runtimeSafeRootState) }];
        this.multiRootOverlay = undefined;
        this.recordDiagnosticEvent('state/loadSelected', {
          source: 'rootLocalSnapshot',
          rootPath,
          snapshotPath: rootLocalSnapshotPath,
          storagePath: this.getExtensionStoragePath(),
          snapshotAvailable: true,
          workspaceStateAvailable: workspaceState !== undefined,
          resetDueToFilesFeatureModeChange,
          fileDomainDisabled: !this.appliedStartupConfiguration.filesFeatureEnabled,
          snapshotWrittenAt: rootLocalSnapshot.writtenAt,
          snapshotStateHash: rootLocalSnapshot.stateHash ?? rootLocalSnapshotSummary.stateHash,
          loadedStateHash: rootLocalLoadedStateSummary.stateHash,
          ...rootLocalSnapshotSummary
        });
        return this.materializeNoteMarkdownRecoverableDraftFiles(runtimeSafeRootState);
      }
    }
    if (isMultiRootWorkspace && !resetDueToRuntimePersistenceModeChange) {
      const rootStates = workspaceFolders.map((folder) => ({
        rootPath: folder.path,
        state: this.downgradeRootLocalLiveRuntimeNodesMissingRuntimeStoragePath(
          folder.path,
          this.loadRootLocalState(folder.path, fileView)
        )
      }));
      this.lastLoadedRootLocalStates = cloneJsonValue(rootStates);
      this.multiRootOverlay = normalizeCanvasMultiRootOverlay(snapshot?.multiRootOverlay);
      const composedState = composeMultiRootCanvasState({
        workspaceFolders,
        rootStates,
        overlay: this.multiRootOverlay,
        newRootPlacement: this.pendingWorkspaceRootPlacement
      });
      this.recordDiagnosticEvent('state/loadSelected', {
        source: 'multiRootComposition',
        rootCount: workspaceFolders.length,
        snapshotPath: this.getPersistedCanvasSnapshotPath(),
        storagePath: this.getExtensionStoragePath(),
        snapshotAvailable: snapshot !== undefined,
        workspaceStateAvailable: workspaceState !== undefined,
        resetDueToFilesFeatureModeChange,
        fileDomainDisabled: !this.appliedStartupConfiguration.filesFeatureEnabled,
        newRootPlacementCount: this.pendingWorkspaceRootPlacement?.rootPaths.length,
        ...summarizeCanvasStateForDiagnostics(composedState)
      });
      return this.materializeNoteMarkdownRecoverableDraftFiles(
        this.appliedStartupConfiguration.filesFeatureEnabled && !resetDueToFilesFeatureModeChange
          ? composedState
          : clearFileDomainState(composedState)
      );
    }

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
      storedFilesFeatureEnabled,
      appliedFilesFeatureEnabled: this.appliedStartupConfiguration.filesFeatureEnabled,
      resetDueToRuntimePersistenceModeChange,
      resetDueToFilesFeatureModeChange,
      fileDomainDisabled: !this.appliedStartupConfiguration.filesFeatureEnabled,
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
    if (resetDueToFilesFeatureModeChange) {
      this.recordDiagnosticEvent('state/filesFeatureReset', {
        storedFilesFeatureEnabled,
        appliedFilesFeatureEnabled: this.appliedStartupConfiguration.filesFeatureEnabled
      });
    }
    const normalizedState = normalizeState(rawState, this.getAgentCliConfig().defaultProvider, fileView);
    const singleRootFolder = workspaceFolders[0];
    const rootScopedState = singleRootFolder
      ? sanitizeRootLocalCanvasState(singleRootFolder.path, normalizedState)
      : normalizedState;
    const sanitizedState =
      this.appliedStartupConfiguration.filesFeatureEnabled && !resetDueToFilesFeatureModeChange
        ? rootScopedState
        : clearFileDomainState(rootScopedState);
    if (singleRootFolder) {
      this.lastLoadedRootLocalStates = [{
        rootPath: singleRootFolder.path,
        state: cloneJsonValue(sanitizedState)
      }];
    } else {
      this.lastLoadedRootLocalStates = [];
    }
    this.multiRootOverlay = undefined;
    return hydrateRuntimeStoragePaths(
      this.materializeNoteMarkdownRecoverableDraftFiles(sanitizedState),
      this.storageRecoverySelection.sourcePath
    );
  }

  private loadRootLocalState(
    rootPath: string,
    fileView?: Pick<CanvasFileViewConfiguration, 'displayStyle' | 'nodeDisplayMode' | 'pathDisplayMode'>
  ): CanvasPrototypeState {
    const rootLocalSnapshot = this.loadPersistedRootLocalCanvasSnapshot(rootPath);
    const normalizedState = sanitizeRootLocalCanvasState(
      rootPath,
      normalizeState(rootLocalSnapshot?.state, this.getAgentCliConfig().defaultProvider, fileView)
    );
    return this.appliedStartupConfiguration.filesFeatureEnabled
      ? normalizedState
      : clearFileDomainState(normalizedState);
  }

  private downgradeRootLocalLiveRuntimeNodesMissingRuntimeStoragePath(
    rootPath: string,
    state: CanvasPrototypeState
  ): CanvasPrototypeState {
    const result = downgradeLiveRuntimeNodesMissingRuntimeStoragePath(
      state,
      'root-local live runtime 缺少 runtimeStoragePath，已恢复为历史结果以避免连接到错误 supervisor。'
    );
    if (result.downgradedCount > 0) {
      this.recordDiagnosticEvent('runtime/missingRuntimeStoragePathDowngraded', {
        rootPath,
        downgradedCount: result.downgradedCount
      });
    }
    return result.state;
  }

  private loadReconciledState(): CanvasPrototypeState {
    const liveRuntimeReconnectBlockReason = this.getLiveRuntimeReconnectBlockReason();
    return this.reconcileCanvasFileArtifacts(
      reconcileRuntimeNodes(this.loadState(), this.agentSessions, this.terminalSessions, {
        allowLiveRuntimeReconnect: liveRuntimeReconnectBlockReason === undefined,
        liveRuntimeReconnectBlockReason
      })
    );
  }

  private reconcileSeededStateForTest(rawState: unknown): CanvasPrototypeState {
    const fileView = this.getCanvasFileViewConfiguration();
    const normalizedState = normalizeState(rawState, this.getAgentCliConfig().defaultProvider, fileView);
    const sanitizedState = this.appliedStartupConfiguration.filesFeatureEnabled
      ? normalizedState
      : clearFileDomainState(normalizedState);
    const hydratedState = hydrateRuntimeStoragePaths(
      this.materializeNoteMarkdownRecoverableDraftFiles(sanitizedState),
      this.storageRecoverySelection.sourcePath
    );
    const liveRuntimeReconnectBlockReason = this.getLiveRuntimeReconnectBlockReason();

    return this.reconcileCanvasFileArtifacts(
      reconcileRuntimeNodes(hydratedState, this.agentSessions, this.terminalSessions, {
        allowLiveRuntimeReconnect: liveRuntimeReconnectBlockReason === undefined,
        liveRuntimeReconnectBlockReason
      })
    );
  }

  private persistState(
    options: {
      mode?: CanvasStatePersistMode;
      workspaceStateMode?: CanvasWorkspaceStatePersistMode;
      reason?: string;
    } = {}
  ): void {
    const startedAt = Date.now();
    const mode = options.mode ?? 'immediate';
    const workspaceStateMode =
      options.workspaceStateMode ?? (mode === 'deferred' || this.hasActiveExecutionSessions() ? 'skip' : 'full');
    const reason = options.reason ?? 'persist-state';
    this.syncNoteMarkdownFileWatchers();
    this.cleanupUnreferencedNoteMarkdownRecoverableDraftFiles();
    const workspaceFolders = this.getMultiRootWorkspaceFoldersForComposition();
    let overlayToPersist: CanvasMultiRootOverlay | undefined;
    let rootLocalStatesToPersist: CanvasRootLocalStateSnapshot[] | undefined;
    if (workspaceFolders.length > 1) {
      const previousRootStates = this.lastLoadedRootLocalStates;
      const composedRootGeometryBeforeDecompose = summarizeWorkspaceRootGroupsForDiagnostics(this.state);
      const previousRootGeometry = summarizeRootLocalStatesForDiagnostics(previousRootStates);
      const decomposed = decomposeMultiRootCanvasState({
        composedState: this.state,
        workspaceFolders,
        previousRootStates
      });
      const rootStatesToPersist = decomposed.rootStates;
      this.recordDiagnosticEvent('state/multiRootDecomposed', {
        reason,
        mode,
        workspaceStateMode,
        rootCount: workspaceFolders.length,
        composedRootGeometry: composedRootGeometryBeforeDecompose,
        overlayRoots: summarizeCanvasMultiRootOverlayRootsForDiagnostics(decomposed.overlay),
        previousRootStates: previousRootGeometry,
        nextRootStates: summarizeRootLocalStatesForDiagnostics(rootStatesToPersist)
      });
      this.lastLoadedRootLocalStates = cloneJsonValue(rootStatesToPersist);
      this.multiRootOverlay = decomposed.overlay;
      overlayToPersist = decomposed.overlay;
      rootLocalStatesToPersist = rootStatesToPersist;
      if (mode === 'immediate') {
        for (const rootState of rootStatesToPersist) {
          try {
            this.writeRootLocalCanvasSnapshot(rootState.rootPath, rootState.state);
          } catch (error) {
            this.recordDiagnosticEvent('state/rootLocalPersistFailed', {
              rootPath: rootState.rootPath,
              message: formatUnknownError(error)
            });
          }
        }
      }
    } else if (workspaceFolders.length === 1) {
      const rootPath = workspaceFolders[0].path;
      this.lastLoadedRootLocalStates = [{ rootPath, state: cloneJsonValue(this.state) }];
      rootLocalStatesToPersist = [{ rootPath, state: this.state }];
      if (mode === 'immediate') {
        try {
          this.writeRootLocalCanvasSnapshot(rootPath, this.state);
        } catch (error) {
          this.recordDiagnosticEvent('state/rootLocalPersistFailed', {
            rootPath,
            message: formatUnknownError(error)
          });
        }
      }
    }
    void this.queuePersistedCanvasSnapshotWrite({
      version: 1,
      state: this.state,
      multiRootOverlay: overlayToPersist,
      activeSurface: this.activeSurface
    }, {
      mode,
      workspaceStateMode,
      reason,
      rootLocalStates: rootLocalStatesToPersist
    }).catch(() => undefined);
    this.recordStatePersistPerformance('persist-state', startedAt, this.state, undefined, {
      mode,
      workspaceStateMode,
      coalescedCount: 0
    });
  }

  private reconcileCanvasFileArtifacts(state: CanvasPrototypeState): CanvasPrototypeState {
    return rebuildCanvasFileArtifacts(state, {
      view: this.getCanvasFileViewConfiguration(),
      preserveAutomaticFileNodeSizes: true
    });
  }

  private postState(
    type: 'host/bootstrap' | 'host/stateUpdated',
    options?: { surface?: CanvasSurfaceLocation; lifecycle?: WebviewLifecycleIdentity }
  ): void {
    const targetSurface = options?.surface ?? this.activeSurface;
    const activeWebview =
      targetSurface && this.isInteractiveSurface(targetSurface)
        ? this.getSurfaceMessageWebview(targetSurface)
        : undefined;
    if (activeWebview) {
      activeWebview.options = this.getWebviewOptions();
    }
    const lifecycle = options?.lifecycle ?? (targetSurface ? this.getSurfaceLifecycleIdentity(targetSurface) : undefined);
    this.postMessage({
      type,
      lifecycle,
      payload: {
        state: this.prepareCanvasStateForWebview(activeWebview),
        runtime: this.getRuntimeContext(activeWebview)
      }
    }, targetSurface);
    this.notifySidebarStateChanged();
  }

  private prepareCanvasStateForWebview(webview: vscode.Webview | undefined): CanvasPrototypeState {
    const state = this.hydrateNoteMarkdownRecoverableDraftsForWebview(this.state);
    const stateWithImageResources = this.hydrateNoteMarkdownImageResourceBasesForWebview(state, webview);
    return stripSerializedTerminalStateFromCanvasState(stateWithImageResources);
  }

  private postMessage(message: HostToWebviewMessage, surface?: CanvasSurfaceLocation): void {
    const targetSurface = surface ?? this.activeSurface;
    const targetWebview =
      targetSurface && this.isInteractiveSurface(targetSurface)
        ? this.getSurfaceMessageWebview(targetSurface)
        : undefined;
    const preparedMessage = targetSurface ? this.withSurfaceLifecycle(targetSurface, message) : message;
    if (targetSurface && this.shouldQueueUntilBootstrapAck(targetSurface, preparedMessage)) {
      this.queuePendingBootstrapHostMessage(targetSurface, preparedMessage);
      this.recordHostMessage(targetSurface, preparedMessage, false);
      return;
    }

    this.recordHostMessage(targetSurface ?? 'active', preparedMessage, Boolean(targetWebview));
    if (!targetWebview) {
      return;
    }

    void targetWebview.postMessage(preparedMessage);
  }

  private withSurfaceLifecycle(
    surface: CanvasSurfaceLocation,
    message: HostToWebviewMessage
  ): HostToWebviewMessage {
    const lifecycle = message.lifecycle ?? this.getSurfaceLifecycleIdentity(surface);
    return lifecycle
      ? {
          ...message,
          lifecycle
        }
      : message;
  }

  private shouldQueueUntilBootstrapAck(surface: CanvasSurfaceLocation, message: HostToWebviewMessage): boolean {
    if (!this.isInteractiveSurface(surface) || !this.surfaceReady[surface]) {
      return false;
    }

    if (this.surfaceLifecycle[surface].bootstrapAck) {
      return false;
    }

    return isBootstrapAckGatedHostMessage(message.type);
  }

  private queuePendingBootstrapHostMessage(surface: CanvasSurfaceLocation, message: HostToWebviewMessage): void {
    const pendingMessages = this.pendingBootstrapHostMessages[surface] ?? [];
    pendingMessages.push(message);
    this.pendingBootstrapHostMessages[surface] = pendingMessages.slice(-50);
    this.recordDiagnosticEvent('surface/hostMessageQueuedUntilBootstrapAck', {
      surface,
      type: message.type,
      lifecycle: summarizeWebviewLifecycleIdentity(message.lifecycle)
    });
  }

  private flushPendingBootstrapHostMessages(surface: CanvasSurfaceLocation): void {
    const pendingMessages = this.pendingBootstrapHostMessages[surface];
    if (!pendingMessages || pendingMessages.length === 0) {
      return;
    }

    delete this.pendingBootstrapHostMessages[surface];
    const webview = this.getSurfaceMessageWebview(surface);
    for (const message of pendingMessages) {
      const preparedMessage = this.withSurfaceLifecycle(surface, message);
      this.recordHostMessage(surface, preparedMessage, Boolean(webview));
      if (webview) {
        void webview.postMessage(preparedMessage);
      }
    }
  }

  private clearPendingBootstrapHostMessages(surface: CanvasSurfaceLocation): void {
    if (this.pendingBootstrapHostMessages[surface]) {
      delete this.pendingBootstrapHostMessages[surface];
    }
  }

  private notifySidebarStateChanged(): void {
    this.sidebarStateEmitter.fire(this.getSidebarState());
  }

  private getRuntimeContext(webview: vscode.Webview | undefined = this.getActiveWebview()): CanvasRuntimeContext {
    const fileConfiguration = this.getCanvasFileViewConfiguration();
    return {
      workspaceTrusted: vscode.workspace.isTrusted,
      surfaceLocation: this.activeSurface ?? this.getConfiguredSurface(),
      workspaceFolders: this.getWorkspaceFoldersForDisplay(),
      defaultAgentProvider: this.getAgentCliConfig().defaultProvider,
      agentLaunchDefaults: this.getAgentLaunchDefaultsByProvider(),
      strongTerminalAttentionReminderMode: this.strongTerminalAttentionReminderMode,
      terminalScrollback: this.getTerminalScrollback(),
      editorMultiCursorModifier: normalizeEditorMultiCursorModifier(
        vscode.workspace
          .getConfiguration('editor')
          .get<'ctrlCmd' | 'alt'>('multiCursorModifier')
      ),
      terminalWordSeparators: normalizeExecutionTerminalWordSeparators(
        vscode.workspace.getConfiguration('terminal.integrated').get<string>('wordSeparators')
      ),
      overviewMode: this.getCanvasOverviewMode(),
      overviewZoomThreshold: this.getCanvasOverviewZoomThreshold(),
      multiRootPresentationMode: this.getCanvasMultiRootPresentationMode(),
      workspaceRootWatermarksEnabled: this.getWorkspaceRootWatermarksEnabled(),
      filePresentationMode: fileConfiguration.presentationMode,
      fileNodeDisplayStyle: fileConfiguration.displayStyle,
      fileNodeDisplayMode: fileConfiguration.nodeDisplayMode,
      filePathDisplayMode: fileConfiguration.pathDisplayMode,
      fileIconFontFaces: [],
      noteMarkdownImageWorkspaceRoots: this.getNoteMarkdownImageWorkspaceRoots(webview)
    };
  }

  private getNoteMarkdownImageWorkspaceRoots(
    webview: vscode.Webview | undefined
  ): NoteMarkdownImageWorkspaceRoot[] | undefined {
    if (!webview) {
      return undefined;
    }

    const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
    if (workspaceFolders.length === 0) {
      return undefined;
    }

    return workspaceFolders.map((workspaceFolder) => ({
      name: workspaceFolder.name,
      webviewResourceBaseUri: this.formatWebviewResourceBaseUri(webview, workspaceFolder.uri)
    }));
  }

  private getTerminalScrollback(): number {
    return normalizeTerminalScrollback(
      vscode.workspace.getConfiguration('terminal.integrated').get<number>('scrollback'),
      DEFAULT_TERMINAL_SCROLLBACK
    );
  }

  private getCanvasOverviewMode(): CanvasOverviewMode {
    return normalizeCanvasOverviewMode(
      getConfigurationValue<CanvasOverviewMode>('canvasOverviewMode', 'title')
    );
  }

  private getCanvasOverviewZoomThreshold(): number {
    return normalizeCanvasOverviewZoomThreshold(
      getConfigurationValue<number>('canvasOverviewZoomThreshold', DEFAULT_CANVAS_OVERVIEW_ZOOM_THRESHOLD)
    );
  }

  private getCanvasMultiRootPresentationMode(): CanvasMultiRootPresentationMode {
    return normalizeCanvasMultiRootPresentationMode(
      getConfigurationValue<CanvasMultiRootPresentationMode>('canvasMultiRootPresentationMode', 'rootGroups')
    );
  }

  private getCanvasLinkOpenMode(): CanvasLinkOpenMode {
    return normalizeCanvasLinkOpenMode(
      getConfigurationValue<CanvasLinkOpenMode>('canvasLinkOpenMode', 'editorPreview')
    );
  }

  private getWorkspaceRootWatermarksEnabled(): boolean {
    return getConfigurationValue<boolean>('canvasWorkspaceRootWatermarksEnabled', true);
  }

  private getCanvasFileViewConfiguration(): CanvasFileViewConfiguration {
    const presentationMode = getConfigurationValue<CanvasFilePresentationMode>('filesPresentationMode', 'lists');
    const displayStyle = getConfigurationValue<CanvasFileNodeDisplayStyle>('fileNodeDisplayStyle', 'minimal');
    const nodeDisplayMode = getConfigurationValue<CanvasFileNodeDisplayMode>('filesNodeDisplayMode', 'icon-path');
    const pathDisplayMode = getConfigurationValue<CanvasFilePathDisplayMode>('filesPathDisplayMode', 'basename');

    return {
      enabled: this.appliedStartupConfiguration.filesFeatureEnabled,
      presentationMode: presentationMode === 'nodes' ? 'nodes' : 'lists',
      includeGlobs: this.fileFilterState.includeGlobs,
      excludeGlobs: this.fileFilterState.excludeGlobs,
      displayStyle: displayStyle === 'card' ? 'card' : 'minimal',
      nodeDisplayMode:
        nodeDisplayMode === 'icon-only' || nodeDisplayMode === 'path-only' ? nodeDisplayMode : 'icon-path',
      pathDisplayMode: pathDisplayMode === 'relative-path' ? 'relative-path' : 'basename'
    };
  }

  public updateCanvasFileFilterState(kind: 'include' | 'exclude', globs: readonly string[]): void {
    if (!this.isFilesFeatureEnabled()) {
      return;
    }

    const normalizedGlobs = normalizeCanvasFileFilterGlobs(globs);
    const nextState: CanvasFileFilterState =
      kind === 'include'
        ? {
            ...this.fileFilterState,
            includeGlobs: normalizedGlobs
          }
        : {
            ...this.fileFilterState,
            excludeGlobs: normalizedGlobs
          };

    if (
      areStringArraysEqual(nextState.includeGlobs, this.fileFilterState.includeGlobs) &&
      areStringArraysEqual(nextState.excludeGlobs, this.fileFilterState.excludeGlobs)
    ) {
      return;
    }

    this.fileFilterState = nextState;
    this.recordDiagnosticEvent('fileView/filterUpdated', {
      kind,
      includeGlobs: nextState.includeGlobs,
      excludeGlobs: nextState.excludeGlobs
    });
    this.state = this.reconcileCanvasFileArtifacts(this.state);
    this.persistState({ reason: 'file-filter-updated' });
    this.postState('host/stateUpdated');
    this.notifySidebarStateChanged();
  }

  private readStartupConfiguration(): CanvasStartupConfiguration {
    return {
      defaultSurface:
        getConfigurationValue<'editor' | 'panel'>('canvasDefaultSurface', 'panel') === 'panel' ? 'panel' : 'editor',
      runtimePersistenceEnabled: getConfigurationValue<boolean>('runtimePersistenceEnabled', false),
      filesFeatureEnabled: getConfigurationValue<boolean>('filesFeatureEnabled', false)
    };
  }

  private readAttentionNotificationBridgeMode(): CanvasAttentionNotificationBridgeMode {
    const configuration = vscode.workspace.getConfiguration();
    const inspectedMode = configuration.inspect<CanvasAttentionNotificationBridgeMode | boolean>(
      CONFIG_KEYS.notificationAttentionSignalBridge
    );
    // Distinguish an explicit v2 setting from the schema default before falling
    // back to legacy keys used by earlier notifier experiments.
    const configuredMode =
      inspectedMode?.workspaceFolderValue ?? inspectedMode?.workspaceValue ?? inspectedMode?.globalValue;
    if (configuredMode !== undefined) {
      return normalizeCanvasAttentionNotificationBridgeMode(configuredMode);
    }

    const inspectedLegacyPreferNotifierCompanion = configuration.inspect<boolean>(
      CONFIG_KEYS.legacyNotificationPreferNotifierCompanion
    );
    const legacyPreferNotifierCompanion =
      inspectedLegacyPreferNotifierCompanion?.workspaceFolderValue ??
      inspectedLegacyPreferNotifierCompanion?.workspaceValue ??
      inspectedLegacyPreferNotifierCompanion?.globalValue;
    if (legacyPreferNotifierCompanion === true) {
      return 'system';
    }

    const inspectedLegacyBridgeTerminalAttentionSignals = configuration.inspect<boolean>(
      CONFIG_KEYS.legacyNotificationBridgeTerminalAttentionSignals
    );
    const legacyBridgeTerminalAttentionSignals =
      inspectedLegacyBridgeTerminalAttentionSignals?.workspaceFolderValue ??
      inspectedLegacyBridgeTerminalAttentionSignals?.workspaceValue ??
      inspectedLegacyBridgeTerminalAttentionSignals?.globalValue;
    if (
      legacyPreferNotifierCompanion !== undefined ||
      legacyBridgeTerminalAttentionSignals !== undefined
    ) {
      const effectiveLegacyBridgeTerminalAttentionSignals =
        legacyBridgeTerminalAttentionSignals ?? true;
      return effectiveLegacyBridgeTerminalAttentionSignals === true ? 'workbench' : 'none';
    }

    return 'system';
  }

  private readEnabledAttentionSignals(): ExecutionAttentionSignalKind[] {
    return normalizeEnabledExecutionAttentionSignalKinds(
      vscode.workspace
        .getConfiguration()
        .get<unknown>(CONFIG_KEYS.enabledAttentionSignals)
    );
  }

  private readStrongTerminalAttentionReminderMode(): CanvasStrongTerminalAttentionReminderMode {
    return normalizeCanvasStrongTerminalAttentionReminderMode(
      getConfigurationValue<CanvasStrongTerminalAttentionReminderMode | boolean>(
        'notificationStrongTerminalAttentionReminder',
        'both'
      )
    );
  }

  private readAgentAbnormalOutputTextNotificationMode(): CanvasAgentAbnormalOutputTextNotificationMode {
    return normalizeCanvasAgentAbnormalOutputTextNotificationMode(
      getConfigurationValue<CanvasAgentAbnormalOutputTextNotificationMode>(
        'agentAbnormalOutputTextNotifications',
        'off'
      )
    );
  }

  private applyStartupConfiguration(configuration: CanvasStartupConfiguration): void {
    this.appliedStartupConfiguration = configuration;
    this.applyWorkbenchContextKeys();
  }

  private applyWorkbenchContextKeys(): void {
    void vscode.commands.executeCommand(
      'setContext',
      CONTEXT_KEYS.panelVisibilityManaged,
      true
    );
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
    filesFeatureEnabledChanged: boolean;
  }): Promise<void> {
    if (isTestHarnessMode(this.context.extensionMode)) {
      return;
    }

    if (options.runtimePersistenceChanged || options.filesFeatureEnabledChanged) {
      const changedSettings = [
        options.defaultSurfaceChanged ? '默认承载面' : undefined,
        options.runtimePersistenceChanged ? '运行时持久化' : undefined,
        options.filesFeatureEnabledChanged ? '文件功能开关' : undefined
      ].filter((label): label is string => Boolean(label));
      const changeSummary =
        changedSettings.length > 1
          ? `${changedSettings.slice(0, -1).join('、')}和${changedSettings[changedSettings.length - 1]}`
          : changedSettings[0];
      const followUps = [
        options.runtimePersistenceChanged ? '切换运行时持久化会在下次加载时清空当前工作区的画布宿主状态。' : undefined,
        options.filesFeatureEnabledChanged
          ? '切换文件功能开关会在下次加载时清空文件活动状态、文件对象、自动文件关系和文件过滤状态。'
          : undefined
      ].filter((message): message is string => Boolean(message));
      const message = `${changeSummary}的更改会在重新加载窗口后生效；${followUps.join('')}`;
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

  private async notifyIfConfiguredTerminalShellUnavailable(): Promise<void> {
    const inspectedShell = inspectCurrentConfiguredTerminalShellInCwd(this.getTerminalWorkingDirectory());
    if (inspectedShell.isAvailable) {
      this.lastUnavailableConfiguredTerminalShellWarningKey = undefined;
      return;
    }

    const warningKey = [
      inspectedShell.configuredShell,
      inspectedShell.configuredPath,
      inspectedShell.resolutionSource,
      inspectedShell.resolvedPath
    ].join('|');
    if (this.lastUnavailableConfiguredTerminalShellWarningKey === warningKey) {
      return;
    }
    this.lastUnavailableConfiguredTerminalShellWarningKey = warningKey;

    const selectShellAction = '选择可用 Shell';
    const openSettingsAction = '打开 Terminal 设置';
    const selection = await vscode.window.showWarningMessage(
      describeUnavailableConfiguredTerminalShell(inspectedShell),
      selectShellAction,
      openSettingsAction
    );
    if (selection === selectShellAction) {
      await vscode.commands.executeCommand(COMMAND_IDS.selectTerminalShell);
      return;
    }
    if (selection === openSettingsAction) {
      await vscode.commands.executeCommand(
        'workbench.action.openSettings',
        `@ext:devsessioncanvas.dev-session-canvas ${
          inspectedShell.configuredPath ? CONFIG_KEYS.terminalShellPath : CONFIG_KEYS.terminalShell
        }`
      );
    }
  }

  private async handleRuntimeConfigurationChanged(options: {
    defaultAgentProviderChanged: boolean;
    agentCodexCommandChanged: boolean;
    agentClaudeCommandChanged: boolean;
    agentCodexDefaultArgsChanged: boolean;
    agentClaudeDefaultArgsChanged: boolean;
    canvasOverviewModeChanged: boolean;
    canvasOverviewZoomThresholdChanged: boolean;
    canvasMultiRootPresentationModeChanged: boolean;
    canvasLinkOpenModeChanged: boolean;
    canvasWorkspaceRootWatermarksChanged: boolean;
    filesPresentationModeChanged: boolean;
    fileNodeDisplayStyleChanged: boolean;
    filesNodeDisplayModeChanged: boolean;
    filesPathDisplayModeChanged: boolean;
    attentionNotificationBridgeChanged: boolean;
    enabledAttentionSignalsChanged: boolean;
    strongTerminalAttentionReminderChanged: boolean;
    agentAbnormalOutputTextNotificationsChanged: boolean;
    terminalShellChanged: boolean;
    terminalShellPathChanged: boolean;
    terminalInheritEnvChanged: boolean;
    terminalShellArgsChanged: boolean;
    terminalScrollbackChanged: boolean;
    multiCursorModifierChanged: boolean;
    terminalWordSeparatorsChanged: boolean;
    workbenchIconThemeChanged: boolean;
  }): Promise<void> {
    if (options.canvasLinkOpenModeChanged) {
      this.recordDiagnosticEvent('canvas/linkOpenModeConfigChanged', {
        mode: this.getCanvasLinkOpenMode()
      });
    }

    if (options.attentionNotificationBridgeChanged) {
      this.attentionNotificationBridgeMode = this.readAttentionNotificationBridgeMode();
      this.recordDiagnosticEvent('execution/attentionNotificationBridgeConfigChanged', {
        enabled: this.attentionNotificationBridgeMode !== 'none',
        mode: this.attentionNotificationBridgeMode,
        workbenchEnabled: this.attentionNotificationBridgeMode !== 'none',
        systemPreferred: this.attentionNotificationBridgeMode === 'system'
      });
    }

    if (options.enabledAttentionSignalsChanged) {
      this.enabledAttentionSignals = this.readEnabledAttentionSignals();
      for (const session of this.getExecutionSessions('agent').values()) {
        resetAgentAbnormalStreamInterruptionHeuristics(this.ensureAgentActivityState(session), session.buffer);
      }
      this.recordDiagnosticEvent('execution/enabledAttentionSignalsConfigChanged', {
        enabledSignals: this.enabledAttentionSignals
      });
    }

    if (options.strongTerminalAttentionReminderChanged) {
      this.strongTerminalAttentionReminderMode = this.readStrongTerminalAttentionReminderMode();
      this.recordDiagnosticEvent('execution/attentionStrongReminderConfigChanged', {
        enabled: this.strongTerminalAttentionReminderMode !== 'none',
        mode: this.strongTerminalAttentionReminderMode,
        titleBarEnabled: strongTerminalAttentionReminderShowsTitleBar(this.strongTerminalAttentionReminderMode),
        minimapEnabled: strongTerminalAttentionReminderPulsesMinimap(this.strongTerminalAttentionReminderMode)
      });
    }

    if (options.agentAbnormalOutputTextNotificationsChanged) {
      this.agentAbnormalOutputTextNotificationMode = this.readAgentAbnormalOutputTextNotificationMode();
      for (const session of this.getExecutionSessions('agent').values()) {
        resetAgentAbnormalStreamInterruptionHeuristics(this.ensureAgentActivityState(session), session.buffer);
      }
      this.recordDiagnosticEvent('execution/agentAbnormalOutputTextNotificationsConfigChanged', {
        enabled: this.agentAbnormalOutputTextNotificationMode !== 'off',
        mode: this.agentAbnormalOutputTextNotificationMode
      });
    }

    const terminalShellMetadataChanged =
      options.terminalShellChanged || options.terminalShellPathChanged
        ? this.refreshConfiguredTerminalShellMetadata()
        : false;
    if (options.terminalShellChanged || options.terminalShellPathChanged) {
      this.invalidateResolvedShellEnvironmentPatch();
      this.clearAgentCliResolutionCache();
      await this.notifyIfConfiguredTerminalShellUnavailable();
    }

    if (options.terminalInheritEnvChanged) {
      this.recordDiagnosticEvent('executionEnvironment/terminalInheritEnvConfigChanged', {
        inheritEnv: this.getTerminalInheritEnv(),
        platform: process.platform
      });
    }

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
      options.filesPresentationModeChanged ||
      options.fileNodeDisplayStyleChanged ||
      options.filesNodeDisplayModeChanged ||
      options.filesPathDisplayModeChanged ||
      options.workbenchIconThemeChanged
    ) {
      this.state = rebuildCanvasFileArtifacts(this.state, {
        view: this.getCanvasFileViewConfiguration(),
        preserveAutomaticFileNodeSizes: false
      });
      this.persistState();
    }

    if (
      options.defaultAgentProviderChanged ||
      options.agentCodexCommandChanged ||
      options.agentClaudeCommandChanged ||
      options.agentCodexDefaultArgsChanged ||
      options.agentClaudeDefaultArgsChanged ||
      options.canvasOverviewModeChanged ||
      options.canvasOverviewZoomThresholdChanged ||
      options.canvasMultiRootPresentationModeChanged ||
      options.canvasLinkOpenModeChanged ||
      options.canvasWorkspaceRootWatermarksChanged ||
      options.filesPresentationModeChanged ||
      options.fileNodeDisplayStyleChanged ||
      options.filesNodeDisplayModeChanged ||
      options.filesPathDisplayModeChanged ||
      options.terminalShellChanged ||
      options.terminalShellPathChanged ||
      options.terminalInheritEnvChanged ||
      options.terminalShellArgsChanged ||
      options.strongTerminalAttentionReminderChanged ||
      options.agentAbnormalOutputTextNotificationsChanged ||
      terminalShellMetadataChanged ||
      options.terminalScrollbackChanged ||
      options.multiCursorModifierChanged ||
      options.terminalWordSeparatorsChanged ||
      options.workbenchIconThemeChanged
    ) {
      this.postState('host/stateUpdated');
    }
  }

  private reconcileDefaultExecutionMetadataCwd(): boolean {
    const nextState = reconcileDefaultExecutionMetadataCwd(this.state);
    if (nextState === this.state) {
      return false;
    }

    this.state = nextState;
    return true;
  }

  private refreshConfiguredTerminalShellMetadata(): boolean {
    const shellPath = this.getTerminalShellPath();
    let changed = false;

    const nextNodes = this.state.nodes.map((node) => {
      if (node.kind !== 'terminal') {
        return node;
      }

      const metadata = ensureTerminalMetadata(node);
      if (
        metadata.liveSession ||
        metadata.runtimeSessionId ||
        metadata.lifecycle === 'launching' ||
        metadata.attachmentState === 'reattaching' ||
        metadata.shellPath === shellPath
      ) {
        return node;
      }

      changed = true;
      return {
        ...node,
        metadata: {
          ...node.metadata,
          terminal: {
            ...metadata,
            shellPath
          }
        }
      };
    });

    if (!changed) {
      return false;
    }

    this.state = {
      ...this.state,
      updatedAt: new Date().toISOString(),
      nodes: nextNodes
    };
    this.persistState({ reason: 'terminal-shell-metadata' });
    return true;
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
    await this.writeExecutionInput(kind, nodeId, preparedPath);
  }

  private async handleDroppedNoteMarkdownFiles(
    resources: ExecutionTerminalDroppedResource[],
    position: CanvasNodePosition,
    sourceSurface?: CanvasSurfaceLocation,
    targetGroupId?: string
  ): Promise<void> {
    const droppedResourceKeys = new Set<string>();
    const createdNodeIds: string[] = [];
    const locatedNodeIds: string[] = [];
    const rejectedReasons: string[] = [];
    const sourceWebview = sourceSurface ? this.getSurfaceWebview(sourceSurface) : undefined;
    const currentRemoteAuthority = this.getCurrentWebviewRemoteAuthority(sourceWebview);
    const currentRemoteName = vscode.env.remoteName;
    let offsetIndex = 0;

    for (const resource of resources) {
      const parsedUri = resolveDroppedNoteMarkdownResourceUri(resource);
      const admission = parsedUri
        ? resolveDroppedNoteMarkdownAdmission(
            parsedUri,
            vscode.workspace.workspaceFolders ?? [],
            currentRemoteAuthority
          )
        : undefined;
      const uri = admission?.uri;
      this.recordDiagnosticEvent('noteMarkdown/dropResourceResolved', {
        source: resource.source,
        valueKind: resource.valueKind,
        rawValue: resource.value,
        sourceSurface: sourceSurface ?? null,
        currentRemoteName,
        currentRemoteAuthority,
        normalizedCurrentRemoteAuthority: normalizeNoteMarkdownAuthority(currentRemoteAuthority),
        parsedUri: parsedUri ? describeNoteMarkdownUriForDiagnostics(parsedUri) : null,
        canonicalUri: uri ? describeNoteMarkdownUriForDiagnostics(uri) : null,
        didCanonicalize: Boolean(parsedUri && uri && parsedUri.toString() !== uri.toString()),
        admissionKind: admission?.kind ?? null,
        admissionWorkspaceFolder: admission?.workspaceFolder
          ? {
              name: admission.workspaceFolder.name,
              uri: admission.workspaceFolder.uri.toString()
            }
          : null,
        admissionRejectionReason: admission?.rejectionReason ?? null
      });
      if (!uri) {
        rejectedReasons.push(admission?.rejectionReason ?? '无法识别拖拽资源。');
        continue;
      }

      if (!isSupportedNoteMarkdownFilePath(noteMarkdownUriPathLike(uri))) {
        rejectedReasons.push(`${this.formatNoteMarkdownUriForMessage(uri)} 不是 Markdown 文件。`);
        continue;
      }

      const resourceKey = normalizeNoteMarkdownResourceKey(uri);
      if (droppedResourceKeys.has(resourceKey)) {
        continue;
      }
      droppedResourceKeys.add(resourceKey);

      if (this.noteMarkdownDropResourceKeysInProgress.has(resourceKey)) {
        continue;
      }

      this.noteMarkdownDropResourceKeysInProgress.add(resourceKey);
      try {
        const existingNodeIds = this.getAssociatedNoteMarkdownNodeIdsForResourceKey(resourceKey);
        if (existingNodeIds.length > 0) {
          const choice = await this.confirmExistingDroppedNoteMarkdownFile(uri, existingNodeIds.length);
          if (choice === 'locate') {
            locatedNodeIds.push(...existingNodeIds);
            continue;
          }
          if (choice !== 'create') {
            continue;
          }
        }

        const readResult = await this.readNoteMarkdownFile(uri);
        if (readResult.status !== 'ok') {
          rejectedReasons.push(readResult.lastError ?? `无法读取 ${this.formatNoteMarkdownUriForMessage(uri)}。`);
          continue;
        }

        if (existingNodeIds.length === 0) {
          const latestExistingNodeIds = this.getAssociatedNoteMarkdownNodeIdsForResourceKey(resourceKey);
          if (latestExistingNodeIds.length > 0) {
            const choice = await this.confirmExistingDroppedNoteMarkdownFile(uri, latestExistingNodeIds.length);
            if (choice === 'locate') {
              locatedNodeIds.push(...latestExistingNodeIds);
              continue;
            }
            if (choice !== 'create') {
              continue;
            }
          }
        }

        const createdNode = this.createAssociatedNoteMarkdownNode(
          uri,
          readResult.content,
          {
            x: position.x + offsetIndex * 28,
            y: position.y + offsetIndex * 28
          },
          readResult.contentRevision,
          targetGroupId
        );
        if (createdNode) {
          createdNodeIds.push(createdNode.id);
          offsetIndex += 1;
        } else if ((vscode.workspace.workspaceFolders?.length ?? 0) > 1 && !targetGroupId) {
          rejectedReasons.push('多根 workspace 中请把 Markdown 文件拖到目标 root section 内。');
        }
      } finally {
        this.noteMarkdownDropResourceKeysInProgress.delete(resourceKey);
      }
    }

    const focusNodeIds = Array.from(new Set([...createdNodeIds, ...locatedNodeIds]));
    if (focusNodeIds.length === 0) {
      if (rejectedReasons.length === 0) {
        return;
      }
      this.postMessage({
        type: 'host/error',
        payload: {
          message: rejectedReasons[0] ?? '没有可创建关联 Note 的 Markdown 文件。'
        }
      });
      return;
    }

    if (createdNodeIds.length > 0) {
      this.persistState();
      this.postState('host/stateUpdated');
    }
    this.focusCanvasTemplateNodeGroup(focusNodeIds);
  }

  private getAssociatedNoteMarkdownNodeIdsForResourceKey(resourceKey: string): string[] {
    return this.state.nodes
      .filter((node) => this.getAssociatedNoteMarkdownResourceKey(node) === resourceKey)
      .map((node) => node.id);
  }

  private getAssociatedNoteMarkdownResourceKey(node: CanvasNodeSummary): string | undefined {
    const source = node.kind === 'note' ? ensureNoteMetadata(node).contentSource : undefined;
    if (source?.kind !== 'markdown-file') {
      return undefined;
    }

    const uri = this.parseCurrentHostNoteMarkdownUri(source.resourceUri);
    return uri ? normalizeNoteMarkdownResourceKey(uri) : source.resourceUri;
  }

  private createAssociatedNoteMarkdownNode(
    uri: vscode.Uri,
    content: string,
    preferredPosition: CanvasNodePosition | undefined,
    contentRevision?: string,
    targetGroupId?: string
  ): CanvasNodeSummary | undefined {
    const targetGroup = targetGroupId
      ? (this.state.groups ?? []).find((group) => group.id === targetGroupId)
      : undefined;
    const targetRootGroupId = targetGroup
      ? isWorkspaceRootGroup(targetGroup)
        ? targetGroup.id
        : resolveContainingWorkspaceRootGroupId(this.state.groups ?? [], targetGroup.id)
      : undefined;
    const targetRootGroup = targetRootGroupId
      ? (this.state.groups ?? []).find((group) => group.id === targetRootGroupId && isWorkspaceRootGroup(group))
      : undefined;
    if ((vscode.workspace.workspaceFolders?.length ?? 0) > 1 && !targetRootGroup) {
      return undefined;
    }

    const targetRootPath = targetRootGroup ? resolveWorkspaceRootPathForGroup(targetRootGroup) : undefined;
    const preferredPositionInTargetRoot = preferredPosition && targetRootGroup
      ? translateComposedCanvasPositionToRootLocal(preferredPosition, targetRootGroup)
      : preferredPosition;
    const createState = targetRootGroup
      ? this.prepareStateForWorkspaceRootLocalCreate(targetRootGroup)
      : this.state;
    const targetGroupIdForCreate = targetRootGroup
      ? targetGroup && !isWorkspaceRootGroup(targetGroup)
        ? denamespaceCanvasObjectId(targetRootPath ?? '', targetGroup.id) ?? targetGroup.id
        : undefined
      : targetGroupId;
    const nextState = createNextState(
      createState,
      'note',
      'codex',
      'default',
      undefined,
      preferredPositionInTargetRoot,
      targetGroupIdForCreate
    );
    const composedNextState = targetRootGroup
      ? this.namespaceWorkspaceRootLocalCreateState(nextState, targetRootGroup)
      : nextState;
    const createdNode = composedNextState.nodes[composedNextState.nodes.length - 1];
    if (!createdNode) {
      return undefined;
    }

    const title = noteMarkdownTitleFromUri(uri, {
      stripExtension: this.shouldStripExtensionFromDroppedNoteMarkdownTitle()
    });
    const displayPathInfo = this.formatNoteMarkdownDisplayPathInfo(uri);
    const noteMetadata: NoteNodeMetadata = {
      content,
      contentSource: {
        kind: 'markdown-file',
        resourceUri: uri.toString(),
        ...displayPathInfo,
        contentRevision,
        status: 'ok'
      }
    };
    const associatedNode: CanvasNodeSummary = {
      ...createdNode,
      title,
      status: 'ready',
      summary: summarizeNoteNode(noteMetadata.content),
      metadata: {
        ...createdNode.metadata,
        note: noteMetadata
      }
    };

    this.state = {
      ...composedNextState,
      nodes: [...composedNextState.nodes.slice(0, -1), associatedNode]
    };
    return associatedNode;
  }

  private shouldStripExtensionFromDroppedNoteMarkdownTitle(): boolean {
    return vscode.workspace
      .getConfiguration()
      .get<boolean>(CONFIG_KEYS.noteMarkdownStripExtensionFromDroppedFileTitle, false) === true;
  }

  private async handleResolveExecutionFileLinks(
    surface: CanvasSurfaceLocation,
    kind: ExecutionNodeKind,
    nodeId: string,
    requestId: string,
    candidates: ExecutionTerminalFileLinkCandidate[],
    priority: ExecutionTerminalFileLinkResolvePriority | undefined
  ): Promise<void> {
    const context = this.getExecutionTerminalPathContext(kind, nodeId);
    const resolvePriority = priority ?? 'interactive';
    const filteredCandidates = filterResolvableExecutionTerminalFileLinkCandidates(
      candidates,
      context,
      { priority: resolvePriority }
    );
    const startedAt = Date.now();
    const resolveResult = await this.runExecutionFileLinkResolveForNode(
      kind,
      nodeId,
      filteredCandidates,
      context,
      resolvePriority
    );
    const diagnostics = buildExecutionFileLinkResolveDiagnostics(
      candidates,
      filteredCandidates,
      resolveResult.resolvedCandidates.length,
      Date.now() - startedAt,
      undefined,
      {
        cacheHitCount: resolveResult.cacheHitCount,
        cacheMissCount: resolveResult.cacheMissCount,
        cachePendingCount: resolveResult.cachePendingCount,
        priority: resolvePriority
      }
    );
    this.recordExecutionFileLinkResolveDiagnostics({
      timestamp: new Date().toISOString(),
      kind,
      nodeId,
      requestId,
      ...diagnostics
    });

    for (const resolvedCandidate of resolveResult.resolvedCandidates) {
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
        resolvedLinks: resolveResult.resolvedCandidates.map((resolvedCandidate) => ({
          candidateId: resolvedCandidate.candidateId,
          link: resolvedCandidate.openLink
        }))
      }
    });
  }

  private async runExecutionFileLinkResolveForNode(
    kind: ExecutionNodeKind,
    nodeId: string,
    filteredCandidates: ExecutionTerminalFileLinkCandidate[],
    context: ExecutionTerminalPathContext,
    priority: ExecutionTerminalFileLinkResolvePriority
  ): Promise<ExecutionFileLinkResolveResult> {
    if (filteredCandidates.length === 0) {
      return {
        resolvedCandidates: [],
        cacheHitCount: 0,
        cacheMissCount: 0,
        cachePendingCount: 0
      };
    }

    const cacheKey = this.createExecutionFileLinkResolveCacheKey(kind, nodeId, context, filteredCandidates);
    const cachedEntry = this.readExecutionFileLinkResolveCacheEntry(cacheKey);
    if (cachedEntry) {
      return {
        resolvedCandidates: this.prepareCachedExecutionFileLinkResolveCandidates(
          filteredCandidates,
          context,
          cachedEntry
        ),
        cacheHitCount: filteredCandidates.length,
        cacheMissCount: 0,
        cachePendingCount: 0
      };
    }

    const pending = this.executionFileLinkResolveCache.inFlight.get(cacheKey);
    if (pending) {
      if (priority === 'background') {
        return {
          resolvedCandidates: [],
          cacheHitCount: 0,
          cacheMissCount: 0,
          cachePendingCount: filteredCandidates.length
        };
      }

      const resolvedCandidates = await pending.promise;
      return {
        resolvedCandidates,
        cacheHitCount: 0,
        cacheMissCount: 0,
        cachePendingCount: filteredCandidates.length
      };
    }

    if (priority === 'background') {
      const now = Date.now();
      if (
        this.executionFileLinkResolveCache.lastBackgroundStartedAt > 0 &&
        now - this.executionFileLinkResolveCache.lastBackgroundStartedAt <
          EXECUTION_FILE_LINK_BACKGROUND_RESOLVE_MIN_INTERVAL_MS
      ) {
        return {
          resolvedCandidates: [],
          cacheHitCount: 0,
          cacheMissCount: 0,
          cachePendingCount: filteredCandidates.length
        };
      }

      this.executionFileLinkResolveCache.lastBackgroundStartedAt = now;
    }

    const nodeQueueKey = `${kind}:${nodeId}`;
    const previous = this.executionFileLinkResolveQueueByNode.get(nodeQueueKey);
    let releaseQueue: () => void = () => undefined;
    const current = new Promise<void>((resolve) => {
      releaseQueue = resolve;
    });
    const queued = previous ? previous.then(() => current, () => current) : current;
    this.executionFileLinkResolveQueueByNode.set(
      nodeQueueKey,
      queued
    );

    await previous?.catch(() => undefined);
    const cachedEntryAfterQueue = this.readExecutionFileLinkResolveCacheEntry(cacheKey);
    if (cachedEntryAfterQueue) {
      releaseQueue();
      if (this.executionFileLinkResolveQueueByNode.get(nodeQueueKey) === queued) {
        this.executionFileLinkResolveQueueByNode.delete(nodeQueueKey);
      }
      return {
        resolvedCandidates: this.prepareCachedExecutionFileLinkResolveCandidates(
          filteredCandidates,
          context,
          cachedEntryAfterQueue
        ),
        cacheHitCount: filteredCandidates.length,
        cacheMissCount: 0,
        cachePendingCount: 0
      };
    }

    let resolveRequest: Promise<PreparedExecutionTerminalResolvedFileLink[]>;
    resolveRequest = resolveExecutionTerminalFileLinkCandidates(
      filteredCandidates,
      context,
      () => randomUUID(),
      { priority }
    )
      .then((resolvedCandidates) => {
        this.writeExecutionFileLinkResolveCacheEntry(
          cacheKey,
          filteredCandidates,
          context,
          resolvedCandidates
        );
        return resolvedCandidates;
      })
      .catch(() => []);
    this.executionFileLinkResolveCache.inFlight.set(cacheKey, {
      priority,
      promise: resolveRequest
    });
    try {
      const resolvedCandidates = await resolveRequest;
      return {
        resolvedCandidates,
        cacheHitCount: 0,
        cacheMissCount: filteredCandidates.length,
        cachePendingCount: 0
      };
    } finally {
      if (this.executionFileLinkResolveCache.inFlight.get(cacheKey)?.promise === resolveRequest) {
        this.executionFileLinkResolveCache.inFlight.delete(cacheKey);
      }
      releaseQueue();
      if (this.executionFileLinkResolveQueueByNode.get(nodeQueueKey) === queued) {
        this.executionFileLinkResolveQueueByNode.delete(nodeQueueKey);
      }
    }
  }

  private createExecutionFileLinkResolveCacheKey(
    kind: ExecutionNodeKind,
    nodeId: string,
    context: ExecutionTerminalPathContext,
    candidates: readonly ExecutionTerminalFileLinkCandidate[]
  ): string {
    const hasLineScopedCandidate = candidates.some((candidate) =>
      this.shouldScopeExecutionFileLinkResolveCacheToBufferLine(candidate, context)
    );
    return JSON.stringify({
      kind,
      nodeId: hasLineScopedCandidate ? nodeId : undefined,
      cwd: context.cwd,
      shellPath: hasLineScopedCandidate ? context.shellPath ?? '' : '',
      pathStyle: context.pathStyle,
      userHome: context.userHome ?? '',
      workspaceFolders:
        vscode.workspace.workspaceFolders?.map((folder) => ({
          name: folder.name,
          path: folder.uri.fsPath
        })) ?? [],
      candidates: candidates.map((candidate) =>
        this.createExecutionFileLinkResolveCandidateCacheKey(candidate, context)
      )
    });
  }

  private createExecutionFileLinkResolveCandidateCacheKey(
    candidate: ExecutionTerminalFileLinkCandidate,
    context: ExecutionTerminalPathContext
  ): string {
    return JSON.stringify({
      text: candidate.text,
      path: candidate.path,
      lineScopedBufferStartLine: this.shouldScopeExecutionFileLinkResolveCacheToBufferLine(
        candidate,
        context
      )
        ? candidate.bufferStartLine
        : undefined,
      line: candidate.line,
      column: candidate.column,
      lineEnd: candidate.lineEnd,
      columnEnd: candidate.columnEnd,
      source: candidate.source
    });
  }

  private shouldScopeExecutionFileLinkResolveCacheToBufferLine(
    candidate: ExecutionTerminalFileLinkCandidate,
    context: ExecutionTerminalPathContext
  ): boolean {
    const value = candidate.path.trim();
    if (
      value.startsWith('/') ||
      value.startsWith('~/') ||
      value.startsWith('file://') ||
      (context.pathStyle === 'windows' && (/^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('\\\\')))
    ) {
      return false;
    }

    return true;
  }

  private readExecutionFileLinkResolveCacheEntry(
    cacheKey: string
  ): ExecutionFileLinkResolveCacheEntry | undefined {
    const cachedEntry = this.executionFileLinkResolveCache.entries.get(cacheKey);
    if (!cachedEntry) {
      return undefined;
    }

    if (Date.now() - cachedEntry.createdAt > EXECUTION_FILE_LINK_RESOLVE_CACHE_TTL_MS) {
      this.executionFileLinkResolveCache.entries.delete(cacheKey);
      return undefined;
    }

    return cachedEntry;
  }

  private writeExecutionFileLinkResolveCacheEntry(
    cacheKey: string,
    candidates: readonly ExecutionTerminalFileLinkCandidate[],
    context: ExecutionTerminalPathContext,
    resolvedCandidates: PreparedExecutionTerminalResolvedFileLink[]
  ): void {
    const candidatesById = new Map(candidates.map((candidate) => [candidate.candidateId, candidate]));
    this.executionFileLinkResolveCache.entries.set(cacheKey, {
      createdAt: Date.now(),
      resolvedCandidates: resolvedCandidates.flatMap((resolvedCandidate) => {
        const candidate = candidatesById.get(resolvedCandidate.candidateId);
        if (!candidate) {
          return [];
        }

        return [
          {
            candidateCacheKey: this.createExecutionFileLinkResolveCandidateCacheKey(candidate, context),
            openLink: resolvedCandidate.openLink,
            resolved: resolvedCandidate.resolved
          }
        ];
      })
    });

    while (this.executionFileLinkResolveCache.entries.size > EXECUTION_FILE_LINK_RESOLVE_CACHE_MAX_ENTRIES) {
      const oldestKey = this.executionFileLinkResolveCache.entries.keys().next().value;
      if (typeof oldestKey !== 'string') {
        break;
      }
      this.executionFileLinkResolveCache.entries.delete(oldestKey);
    }
  }

  private prepareCachedExecutionFileLinkResolveCandidates(
    candidates: readonly ExecutionTerminalFileLinkCandidate[],
    context: ExecutionTerminalPathContext,
    cachedEntry: ExecutionFileLinkResolveCacheEntry
  ): PreparedExecutionTerminalResolvedFileLink[] {
    const cachedCandidatesByKey = new Map(
      cachedEntry.resolvedCandidates.map((candidate) => [candidate.candidateCacheKey, candidate])
    );
    const resolvedCandidates: PreparedExecutionTerminalResolvedFileLink[] = [];
    for (const candidate of candidates) {
      const cachedCandidate = cachedCandidatesByKey.get(
        this.createExecutionFileLinkResolveCandidateCacheKey(candidate, context)
      );
      if (!cachedCandidate) {
        continue;
      }

      resolvedCandidates.push({
        candidateId: candidate.candidateId,
        openLink: {
          ...cachedCandidate.openLink,
          text: candidate.text,
          path: candidate.path,
          line: candidate.line,
          column: candidate.column,
          lineEnd: candidate.lineEnd,
          columnEnd: candidate.columnEnd,
          bufferStartLine: candidate.bufferStartLine,
          source: candidate.source,
          resolvedId: randomUUID()
        },
        resolved: cachedCandidate.resolved
      });
    }

    return resolvedCandidates;
  }

  private async handleOpenExecutionLink(
    kind: ExecutionNodeKind,
    nodeId: string,
    link: ExecutionTerminalOpenLink
  ): Promise<void> {
    const context = this.getExecutionTerminalPathContext(kind, nodeId);
    const cached =
      link.linkKind === 'file' && typeof link.resolvedId === 'string'
        ? this.resolvedExecutionFileLinks.get(link.resolvedId)
        : undefined;
    let openResult: OpenExecutionTerminalLinkResult;
    if (cached && (cached.nodeId !== nodeId || cached.kind !== kind)) {
      openResult = { opened: false };
    } else if (cached?.resolved) {
      openResult = await openResolvedExecutionTerminalLink(cached.resolved).catch(
        (): OpenExecutionTerminalLinkResult => ({ opened: false })
      );
    } else {
      openResult = await openExecutionTerminalLink(link, context).catch(
        (): OpenExecutionTerminalLinkResult => ({ opened: false })
      );
    }

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

  private async openCanvasFile(
    filePath: string,
    sourceSurface: CanvasSurfaceLocation,
    selection?: NoteMarkdownFileSelection
  ): Promise<void> {
    const normalizedPath = normalizeTrackedFilePath(filePath);
    if (!normalizedPath) {
      return;
    }

    const uri = vscode.Uri.file(normalizedPath);
    const document = await vscode.workspace.openTextDocument(uri);
    const initialSelection = toNoteMarkdownDocumentSelection(document, selection);
    const showOptions: vscode.TextDocumentShowOptions =
      sourceSurface === 'editor'
        ? {
            preview: false,
            preserveFocus: true,
            viewColumn: vscode.ViewColumn.Beside,
            selection: initialSelection
          }
        : {
            preview: false,
            preserveFocus: true,
            selection: initialSelection
          };
    await vscode.window.showTextDocument(document, showOptions);
    if (sourceSurface === 'editor') {
      await this.refocusInteractiveSurface('editor');
    }
  }

  private async handleUpdateNoteNode(payload: {
    nodeId: string;
    content: string;
    baseContentRevision?: string;
    force?: boolean;
  }): Promise<void> {
    const node = this.state.nodes.find((currentNode) => currentNode.id === payload.nodeId && currentNode.kind === 'note');
    const noteMetadata = node ? ensureNoteMetadata(node) : undefined;
    if (!node || noteMetadata?.contentSource?.kind !== 'markdown-file') {
      this.state = updateNoteContent(this.state, payload);
      this.persistState();
      this.postState('host/stateUpdated');
      return;
    }

    const uri = this.parseCurrentHostNoteMarkdownUri(noteMetadata.contentSource.resourceUri);
    if (!uri) {
      this.state = updateAssociatedNoteMarkdownFileStatus(this.state, payload.nodeId, {
        ...noteMetadata.contentSource,
        status: 'unreadable',
        lastError: '关联 Markdown 文件 URI 无法解析。'
      }, noteMetadata.content);
      this.persistState();
      this.postState('host/stateUpdated');
      return;
    }

    const nextContent = payload.content;
    if (!payload.force && payload.baseContentRevision) {
      const currentStatResult = await this.statNoteMarkdownFile(uri);
      if (currentStatResult.status !== 'ok') {
        this.state = updateAssociatedNoteMarkdownFileStatus(this.state, payload.nodeId, {
          ...noteMetadata.contentSource,
          resourceUri: uri.toString(),
          ...this.formatNoteMarkdownDisplayPathInfo(uri),
          contentRevision: currentStatResult.contentRevision ?? noteMetadata.contentSource.contentRevision,
          status: currentStatResult.status,
          lastError: currentStatResult.lastError
        }, noteMetadata.content);
        this.persistState();
        this.postState('host/stateUpdated');
        return;
      }

      const currentRevision = currentStatResult.contentRevision;
      if (currentRevision && currentRevision !== payload.baseContentRevision) {
        const currentReadResult = await this.readNoteMarkdownFile(uri);
        const currentContent =
          currentReadResult.status === 'ok' ? currentReadResult.content : noteMetadata.content;
        const recoverableDraft = this.createStoredNoteMarkdownRecoverableDraft(
          nextContent,
          payload.baseContentRevision,
          currentReadResult.contentRevision ?? currentRevision,
          noteMetadata.contentSource.recoverableDraft
        );
        this.state = updateAssociatedNoteMarkdownFileStatus(this.state, payload.nodeId, {
          ...noteMetadata.contentSource,
          resourceUri: uri.toString(),
          ...this.formatNoteMarkdownDisplayPathInfo(uri),
          contentRevision: currentReadResult.contentRevision ?? currentRevision,
          status: 'dirty-conflict',
          lastError: '关联文件在编辑期间被外部修改。请重新加载或覆盖。',
          recoverableDraft
        }, currentContent);
        this.persistState();
        this.postState('host/stateUpdated');
        return;
      }
    }

    const writeResult = await this.writeNoteMarkdownFile(uri, nextContent);
    if (!writeResult.ok) {
      this.state = updateAssociatedNoteMarkdownFileStatus(this.state, payload.nodeId, {
        ...noteMetadata.contentSource,
        resourceUri: uri.toString(),
        ...this.formatNoteMarkdownDisplayPathInfo(uri),
        status: 'unreadable',
        lastError: writeResult.errorMessage
      }, noteMetadata.content);
      this.persistState();
      this.postState('host/stateUpdated');
      return;
    }

    this.activeAssociatedNoteMarkdownEdits.delete(payload.nodeId);
    this.state = updateAssociatedNoteMarkdownFileStatus(this.state, payload.nodeId, {
      ...noteMetadata.contentSource,
      resourceUri: uri.toString(),
      ...this.formatNoteMarkdownDisplayPathInfo(uri),
      contentRevision: writeResult.contentRevision ?? noteMetadata.contentSource.contentRevision,
      status: 'ok',
      lastError: undefined,
      recoverableDraft: undefined
    }, nextContent);
    this.persistState();
    this.postState('host/stateUpdated');
  }

  private async handleBeginAssociatedNoteMarkdownEdit(payload: {
    nodeId: string;
    content: string;
    baseContentRevision?: string;
  }): Promise<void> {
    const node = this.state.nodes.find((currentNode) => currentNode.id === payload.nodeId && currentNode.kind === 'note');
    const source = node ? ensureNoteMetadata(node).contentSource : undefined;
    if (!node || source?.kind !== 'markdown-file') {
      return;
    }

    this.activeAssociatedNoteMarkdownEdits.set(payload.nodeId, {
      content: payload.content,
      baseContent: payload.content,
      baseContentRevision: payload.baseContentRevision ?? source.contentRevision,
      updatedAt: Date.now()
    });
    await this.refreshAssociatedMarkdownNote(payload.nodeId);
  }

  private handleEndAssociatedNoteMarkdownEdit(nodeId: string): void {
    this.activeAssociatedNoteMarkdownEdits.delete(nodeId);
  }

  private async handleUpdateAssociatedNoteMarkdownDraft(payload: {
    nodeId: string;
    content: string;
    baseContentRevision?: string;
  }): Promise<void> {
    const initialNode = this.state.nodes.find((currentNode) => currentNode.id === payload.nodeId && currentNode.kind === 'note');
    const initialNoteMetadata = initialNode ? ensureNoteMetadata(initialNode) : undefined;
    const initialSource = initialNoteMetadata?.contentSource;
    if (!initialNode || !initialNoteMetadata || initialSource?.kind !== 'markdown-file') {
      return;
    }

    const previousActiveEdit = this.activeAssociatedNoteMarkdownEdits.get(payload.nodeId);
    if (!previousActiveEdit && !initialSource.recoverableDraft && initialSource.status !== 'dirty-conflict') {
      return;
    }

    const baseContentRevision =
      previousActiveEdit?.baseContent === initialNoteMetadata.content
        ? previousActiveEdit.baseContentRevision ?? payload.baseContentRevision ?? initialSource.contentRevision
        : payload.baseContentRevision ?? previousActiveEdit?.baseContentRevision ?? initialSource.contentRevision;
    this.activeAssociatedNoteMarkdownEdits.set(payload.nodeId, {
      content: payload.content,
      baseContent: previousActiveEdit?.baseContent ?? initialNoteMetadata.content,
      baseContentRevision,
      updatedAt: Date.now()
    });
    await this.refreshAssociatedMarkdownNote(payload.nodeId);

    const node = this.state.nodes.find((currentNode) => currentNode.id === payload.nodeId && currentNode.kind === 'note');
    const noteMetadata = node ? ensureNoteMetadata(node) : undefined;
    const source = noteMetadata?.contentSource;
    if (!node || !noteMetadata || source?.kind !== 'markdown-file') {
      return;
    }

    const refreshedActiveEdit = this.activeAssociatedNoteMarkdownEdits.get(payload.nodeId);
    if (!refreshedActiveEdit && !source.recoverableDraft && source.status !== 'dirty-conflict') {
      return;
    }

    const effectiveBaseContentRevision = refreshedActiveEdit?.baseContentRevision ?? baseContentRevision;
    const isDraftConflict =
      source.status === 'dirty-conflict' ||
      (Boolean(effectiveBaseContentRevision) &&
        Boolean(source.contentRevision) &&
        effectiveBaseContentRevision !== source.contentRevision);
    if (payload.content === noteMetadata.content && source.status !== 'dirty-conflict') {
      this.handleClearAssociatedNoteMarkdownDraft(payload.nodeId);
      return;
    }

    const nextSource: MarkdownFileNoteContentSource = {
      ...source,
      status: isDraftConflict ? 'dirty-conflict' : source.status,
      lastError: isDraftConflict
        ? '关联文件在编辑期间被外部修改。请重新加载或覆盖。'
        : source.lastError,
      recoverableDraft: this.createStoredNoteMarkdownRecoverableDraft(
        payload.content,
        effectiveBaseContentRevision,
        isDraftConflict ? source.contentRevision : undefined,
        source.recoverableDraft
      )
    };
    const nextState = updateAssociatedNoteMarkdownFileStatus(this.state, payload.nodeId, nextSource, noteMetadata.content);
    if (nextState === this.state) {
      return;
    }

    this.state = nextState;
    this.persistState();
    this.postState('host/stateUpdated');
  }

  private handleClearAssociatedNoteMarkdownDraft(nodeId: string): void {
    const node = this.state.nodes.find((currentNode) => currentNode.id === nodeId && currentNode.kind === 'note');
    const noteMetadata = node ? ensureNoteMetadata(node) : undefined;
    const source = noteMetadata?.contentSource;
    if (
      !node ||
      !noteMetadata ||
      source?.kind !== 'markdown-file' ||
      source.status === 'dirty-conflict'
    ) {
      return;
    }

    this.activeAssociatedNoteMarkdownEdits.delete(nodeId);
    if (!source.recoverableDraft) {
      return;
    }

    const nextState = updateAssociatedNoteMarkdownFileStatus(
      this.state,
      nodeId,
      {
        ...source,
        recoverableDraft: undefined
      },
      noteMetadata.content
    );
    if (nextState === this.state) {
      return;
    }

    this.state = nextState;
    this.persistState();
    this.postState('host/stateUpdated');
  }

  private async copyAssociatedNoteMarkdownDraft(
    sourceSurface: CanvasSurfaceLocation,
    nodeId: string,
    content: string
  ): Promise<void> {
    const node = this.state.nodes.find((currentNode) => currentNode.id === nodeId && currentNode.kind === 'note');
    const source = node ? ensureNoteMetadata(node).contentSource : undefined;
    if (!node || source?.kind !== 'markdown-file') {
      return;
    }

    try {
      await vscode.env.clipboard.writeText(content);
      this.recordDiagnosticEvent('noteMarkdownDraft/copied', {
        nodeId,
        bytes: Buffer.byteLength(content, 'utf8')
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '复制关联 Markdown 草稿失败。';
      this.recordDiagnosticEvent('noteMarkdownDraft/copyFailed', {
        nodeId,
        message
      });
      this.postMessageToSurface(sourceSurface, {
        type: 'host/error',
        payload: {
          message
        }
      });
    }
  }

  private async openAssociatedNoteMarkdownFile(
    nodeId: string,
    sourceSurface: CanvasSurfaceLocation
  ): Promise<void> {
    const node = this.state.nodes.find((candidate) => candidate.id === nodeId && candidate.kind === 'note');
    const source = node ? ensureNoteMetadata(node).contentSource : undefined;
    if (!source || source.kind !== 'markdown-file') {
      return;
    }

    const uri = this.parseCurrentHostNoteMarkdownUri(source.resourceUri);
    if (!uri) {
      return;
    }

    if (uri.scheme === 'file') {
      await this.openCanvasFile(uri.fsPath, sourceSurface);
      return;
    }

    await vscode.commands.executeCommand('vscode.open', uri);
  }

  private async createMissingAssociatedNoteMarkdownFile(
    nodeId: string,
    sourceSurface: CanvasSurfaceLocation
  ): Promise<void> {
    const node = this.state.nodes.find((candidate) => candidate.id === nodeId && candidate.kind === 'note');
    const noteMetadata = node ? ensureNoteMetadata(node) : undefined;
    const source = noteMetadata?.contentSource;
    if (!node || !noteMetadata || source?.kind !== 'markdown-file') {
      return;
    }

    const uri = this.parseCurrentHostNoteMarkdownUri(source.resourceUri);
    if (!uri) {
      this.state = updateAssociatedNoteMarkdownFileStatus(this.state, nodeId, {
        ...source,
        status: 'unreadable',
        lastError: '关联 Markdown 文件 URI 无法解析。'
      }, noteMetadata.content);
      this.persistState();
      this.postState('host/stateUpdated');
      return;
    }

    try {
      const readResult = await this.readNoteMarkdownFile(uri);
      if (readResult.status === 'ok') {
        this.state = updateAssociatedNoteMarkdownFileStatus(this.state, nodeId, {
          ...source,
          resourceUri: uri.toString(),
          ...this.formatNoteMarkdownDisplayPathInfo(uri),
          contentRevision: readResult.contentRevision,
          status: 'ok',
          lastError: undefined,
          recoverableDraft: undefined
        }, readResult.content);
        this.persistState();
        this.postState('host/stateUpdated');
        return;
      }

      if (readResult.status !== 'missing') {
        this.state = updateAssociatedNoteMarkdownFileStatus(this.state, nodeId, {
          ...source,
          resourceUri: uri.toString(),
          ...this.formatNoteMarkdownDisplayPathInfo(uri),
          contentRevision: readResult.contentRevision ?? source.contentRevision,
          status: readResult.status,
          lastError: readResult.lastError
        }, noteMetadata.content);
        this.persistState();
        this.postState('host/stateUpdated');
        return;
      }

      const materialization = await this.createCanvasTemplateMarkdownFileAndMaterialization(uri, '');
      if (materialization.contentSource?.kind !== 'markdown-file') {
        return;
      }

      this.state = updateAssociatedNoteMarkdownFileStatus(
        this.state,
        nodeId,
        materialization.contentSource,
        materialization.content
      );
      this.persistState();
      this.postState('host/stateUpdated');
    } catch (error) {
      this.postMessageToSurface(sourceSurface, {
        type: 'host/error',
        payload: {
          message: formatUnknownError(error)
        }
      });
    }
  }

  private async openNoteLink(
    nodeId: string,
    href: string,
    sourceSurface: CanvasSurfaceLocation
  ): Promise<void> {
    const resolvedTarget = resolveNoteMarkdownLinkTarget({
      href,
      workspaceRoots: this.listNoteMarkdownWorkspaceRoots()
    });
    if (!resolvedTarget) {
      this.recordDiagnosticEvent('note/linkOpenRejected', {
        nodeId,
        href,
        reason: 'unsupported-scheme-or-unresolved-workspace-link'
      });
      return;
    }

    if (resolvedTarget.kind === 'external') {
      const openResult = await openCanvasExternalLink(
        vscode.Uri.parse(resolvedTarget.href),
        this.getCanvasLinkOpenMode()
      );
      if (!openResult.opened) {
        this.recordDiagnosticEvent('note/linkOpenRejected', {
          nodeId,
          href: resolvedTarget.href,
          openerKind: openResult.openerKind,
          reason: 'external-opener-failed',
          targetKind: 'external'
        });
        return;
      }
      this.recordDiagnosticEvent('note/linkOpened', {
        nodeId,
        href: resolvedTarget.href,
        openerKind: openResult.openerKind,
        targetKind: 'external'
      });
      return;
    }

    const fileUri = vscode.Uri.file(resolvedTarget.filePath);
    let stat: vscode.FileStat | null = null;
    try {
      stat = await vscode.workspace.fs.stat(fileUri);
    } catch {
      stat = null;
    }
    if (!stat || stat.type === vscode.FileType.Directory) {
      this.recordDiagnosticEvent('note/linkOpenRejected', {
        nodeId,
        href,
        filePath: resolvedTarget.filePath,
        reason: 'workspace-file-missing-or-not-a-file'
      });
      return;
    }

    await this.openCanvasFile(resolvedTarget.filePath, sourceSurface, resolvedTarget.selection);
    this.recordDiagnosticEvent('note/linkOpened', {
      nodeId,
      href,
      filePath: resolvedTarget.filePath,
      line: resolvedTarget.selection?.line ?? null,
      column: resolvedTarget.selection?.column ?? null,
      targetKind: 'workspace-file'
    });
  }

  private listNoteMarkdownWorkspaceRoots(): NoteMarkdownWorkspaceRoot[] {
    return (vscode.workspace.workspaceFolders ?? []).map((workspaceFolder) => ({
      name: workspaceFolder.name,
      path: workspaceFolder.uri.fsPath
    }));
  }

  private async pickEmbeddedNoteForMarkdownAssociation(): Promise<CanvasNodeSummary | undefined> {
    const noteNodes = this.state.nodes.filter(
      (node) => node.kind === 'note' && ensureNoteMetadata(node).contentSource?.kind !== 'markdown-file'
    );
    if (noteNodes.length === 0) {
      await vscode.window.showInformationMessage('当前画布没有可保存为 Markdown 的 Note。');
      return undefined;
    }

    const selected = await vscode.window.showQuickPick(
      noteNodes.map((node) => ({
        label: node.title,
        description: summarizeNoteNode(ensureNoteMetadata(node).content),
        node
      })),
      {
        title: '保存为 Markdown',
        placeHolder: '选择 Note'
      }
    );
    return selected?.node;
  }

  private async promptNoteMarkdownFileTarget(node: CanvasNodeSummary): Promise<vscode.Uri | undefined> {
    const defaultDirectory = this.resolveDefaultNoteMarkdownDirectory();
    const defaultPath = path.join(defaultDirectory, createDefaultNoteMarkdownFileName(node.title));
    return this.showNoteMarkdownFileQuickInput(defaultPath, defaultDirectory);
  }

  private async showNoteMarkdownFileQuickInput(
    initialPath: string,
    baseDirectory: string
  ): Promise<vscode.Uri | undefined> {
    return new Promise((resolve) => {
      const quickPick = vscode.window.createQuickPick<NoteMarkdownFileQuickPickItem>();
      let disposed = false;

      const resolveOnce = (uri: vscode.Uri | undefined): void => {
        if (disposed) {
          return;
        }
        disposed = true;
        quickPick.dispose();
        resolve(uri);
      };

      const updateItems = (): void => {
        const inputPath = this.resolveNoteMarkdownInputPath(quickPick.value, baseDirectory);
        const directoryPath = resolveExistingDirectoryForNoteMarkdownInput(inputPath);
        const items: NoteMarkdownFileQuickPickItem[] = [
          {
            itemKind: 'use-input',
            label: '$(check) 使用此路径',
            description: inputPath,
            alwaysShow: true
          }
        ];

        if (directoryPath) {
          try {
            const entries = fs.readdirSync(directoryPath, { withFileTypes: true });
            for (const entry of entries) {
              const entryPath = path.join(directoryPath, entry.name);
              if (entry.isDirectory()) {
                items.push({
                  itemKind: 'directory',
                  label: `$(folder) ${entry.name}`,
                  description: entryPath,
                  filePath: entryPath
                });
              } else if (entry.isFile() && isSupportedNoteMarkdownFilePath(entry.name)) {
                items.push({
                  itemKind: 'file',
                  label: `$(markdown) ${entry.name}`,
                  description: entryPath,
                  filePath: entryPath
                });
              }
            }
          } catch {
            // Keep the current input item available even if the directory cannot be listed.
          }
        }

        quickPick.items = items;
      };

      quickPick.title = '保存为关联 Markdown 文件';
      quickPick.placeholder = '输入或选择 Markdown 文件路径';
      quickPick.value = initialPath;
      quickPick.matchOnDescription = true;
      quickPick.ignoreFocusOut = true;
      quickPick.onDidChangeValue(updateItems);
      quickPick.onDidHide(() => resolveOnce(undefined));
      quickPick.onDidAccept(() => {
        const selected = quickPick.selectedItems[0];
        if (selected?.itemKind === 'directory' && selected.filePath) {
          quickPick.value = `${selected.filePath}${path.sep}`;
          updateItems();
          return;
        }

        const targetPath = selected?.itemKind === 'file' && selected.filePath
          ? selected.filePath
          : this.resolveNoteMarkdownInputPath(quickPick.value, baseDirectory);
        resolveOnce(vscode.Uri.file(targetPath));
      });
      updateItems();
      quickPick.show();
    });
  }

  private resolveDefaultNoteMarkdownDirectory(): string {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ??
      process.env.HOME ??
      process.env.USERPROFILE ??
      process.cwd();
  }

  private resolveNoteMarkdownInputPath(value: string, baseDirectory: string): string {
    const trimmedValue = value.trim();
    if (!trimmedValue) {
      return path.join(
        baseDirectory,
        createDefaultNoteMarkdownFileName('note')
      );
    }

    if (path.isAbsolute(trimmedValue)) {
      return path.normalize(trimmedValue);
    }

    return path.resolve(baseDirectory, trimmedValue);
  }

  private async statNoteMarkdownTarget(
    uri: vscode.Uri
  ): Promise<'file' | 'directory' | 'missing' | 'missing-parent' | 'other'> {
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      if (stat.type === vscode.FileType.File) {
        return 'file';
      }
      if (stat.type === vscode.FileType.Directory) {
        return 'directory';
      }
      return 'other';
    } catch {
      const parentUri = vscode.Uri.joinPath(uri, '..');
      try {
        const parentStat = await vscode.workspace.fs.stat(parentUri);
        return parentStat.type === vscode.FileType.Directory ? 'missing' : 'missing-parent';
      } catch {
        return 'missing-parent';
      }
    }
  }

  private async confirmExistingNoteMarkdownFile(
    uri: vscode.Uri
  ): Promise<NoteMarkdownExistingFileChoice | undefined> {
    const overwrite = '覆盖并关联';
    const keep = '保留并关联';
    const selected = await vscode.window.showWarningMessage(
      `${this.formatNoteMarkdownUriForMessage(uri)} 已存在。覆盖文件内容，还是保留现有内容直接关联？`,
      { modal: true },
      overwrite,
      keep
    );
    if (selected === overwrite) {
      return 'overwrite';
    }
    if (selected === keep) {
      return 'keep';
    }
    return undefined;
  }

  private async confirmExistingDroppedNoteMarkdownFile(
    uri: vscode.Uri,
    existingNodeCount: number
  ): Promise<NoteMarkdownExistingDropChoice | undefined> {
    const create = '添加新 Note';
    const locate = '定位已有 Note';
    const countText = existingNodeCount > 1
      ? `已关联到 ${existingNodeCount} 个 Note`
      : '已关联到一个 Note';
    const selected = await vscode.window.showWarningMessage(
      `${this.formatNoteMarkdownUriForMessage(uri)} ${countText}。添加新的关联 Note，还是定位到已有的？`,
      { modal: true },
      create,
      locate
    );
    if (selected === create) {
      return 'create';
    }
    if (selected === locate) {
      return 'locate';
    }
    return undefined;
  }

  private async statNoteMarkdownFile(uri: vscode.Uri): Promise<NoteMarkdownFileStatResult> {
    if (!isSupportedNoteMarkdownFilePath(noteMarkdownUriPathLike(uri))) {
      return {
        status: 'unsupported-extension',
        lastError: '只能关联 Markdown 文件（.md / .markdown）。'
      };
    }

    let stat: vscode.FileStat;
    try {
      stat = await vscode.workspace.fs.stat(uri);
    } catch {
      return {
        status: 'missing',
        lastError: `关联文件不可用：${this.formatNoteMarkdownUriForMessage(uri)}`
      };
    }

    if (stat.type === vscode.FileType.Directory) {
      return {
        status: 'not-file',
        lastError: `所选路径是目录：${this.formatNoteMarkdownUriForMessage(uri)}`
      };
    }
    if (stat.type !== vscode.FileType.File) {
      return {
        status: 'unreadable',
        lastError: `所选路径不是有效文件：${this.formatNoteMarkdownUriForMessage(uri)}`
      };
    }

    return {
      status: 'ok',
      contentRevision: await this.createNoteMarkdownFileStatRevision(uri, stat)
    };
  }

  private async readNoteMarkdownFile(
    uri: vscode.Uri,
    options: { skipContentIfRevision?: string } = {}
  ): Promise<ReadNoteMarkdownFileResult> {
    const statResult = await this.statNoteMarkdownFile(uri);
    if (statResult.status !== 'ok') {
      return {
        ...statResult,
        content: ''
      };
    }

    if (
      options.skipContentIfRevision &&
      statResult.contentRevision &&
      options.skipContentIfRevision === statResult.contentRevision
    ) {
      return {
        status: 'ok',
        content: '',
        contentRevision: statResult.contentRevision,
        contentSkipped: true
      };
    }

    try {
      let content = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
      let contentRevision = statResult.contentRevision;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const latestStatResult = await this.statNoteMarkdownFile(uri);
        if (latestStatResult.status !== 'ok') {
          return {
            ...latestStatResult,
            content: ''
          };
        }

        if (!contentRevision || latestStatResult.contentRevision === contentRevision) {
          return {
            status: 'ok',
            content,
            contentRevision: latestStatResult.contentRevision
          };
        }

        contentRevision = latestStatResult.contentRevision;
        content = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
      }

      return {
        status: 'ok',
        content,
        contentRevision
      };
    } catch (error) {
      return {
        status: 'unreadable',
        content: '',
        contentRevision: statResult.contentRevision,
        lastError: error instanceof Error ? error.message : `无法读取 ${this.formatNoteMarkdownUriForMessage(uri)}`
      };
    }
  }

  private async writeNoteMarkdownFile(
    uri: vscode.Uri,
    content: string
  ): Promise<{ ok: true; contentRevision?: string } | { ok: false; errorMessage: string }> {
    if (!isSupportedNoteMarkdownFilePath(noteMarkdownUriPathLike(uri))) {
      return {
        ok: false,
        errorMessage: '只能关联 Markdown 文件（.md / .markdown）。'
      };
    }

    try {
      await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
      const statResult = await this.statNoteMarkdownFile(uri);
      return {
        ok: true,
        contentRevision: statResult.status === 'ok' ? statResult.contentRevision : undefined
      };
    } catch (error) {
      return {
        ok: false,
        errorMessage: error instanceof Error ? error.message : `无法写入 ${this.formatNoteMarkdownUriForMessage(uri)}`
      };
    }
  }

  private updateNoteMarkdownFileAssociationState(
    state: CanvasPrototypeState,
    nodeId: string,
    uri: vscode.Uri,
    params: {
      status: NoteMarkdownFileStatus;
      content: string;
      contentRevision?: string;
      lastError?: string;
    }
  ): CanvasPrototypeState {
    return updateAssociatedNoteMarkdownFileStatus(state, nodeId, {
      kind: 'markdown-file',
      resourceUri: uri.toString(),
      ...this.formatNoteMarkdownDisplayPathInfo(uri),
      contentRevision: params.contentRevision,
      status: params.status,
      lastError: params.lastError
    }, params.content);
  }

  private async createNoteMarkdownFileStatRevision(uri: vscode.Uri, stat: vscode.FileStat): Promise<string> {
    if (uri.scheme === 'file') {
      try {
        const localStat = await fs.promises.stat(uri.fsPath);
        if (localStat.isFile()) {
          return [
            'stat:file',
            formatNoteMarkdownRevisionNumber(localStat.dev),
            formatNoteMarkdownRevisionNumber(localStat.ino),
            formatNoteMarkdownRevisionNumber(localStat.size),
            formatNoteMarkdownRevisionTime(localStat.mtimeMs),
            formatNoteMarkdownRevisionTime(localStat.ctimeMs)
          ].join(':');
        }
      } catch {
        // Fall back to VSCode's FileStat for any local stat edge case.
      }
    }

    return [
      'stat:vscode',
      formatNoteMarkdownRevisionNumber(stat.type),
      formatNoteMarkdownRevisionNumber(stat.size),
      formatNoteMarkdownRevisionNumber(stat.mtime),
      formatNoteMarkdownRevisionNumber(stat.ctime)
    ].join(':');
  }

  private formatNoteMarkdownDisplayPathInfo(
    uri: vscode.Uri
  ): Pick<MarkdownFileNoteContentSource, 'displayPath' | 'fullDisplayPath'> {
    const fullDisplayPath = this.formatNoteMarkdownFullDisplayPath(uri);
    return {
      displayPath: fullDisplayPath,
      fullDisplayPath
    };
  }

  private formatNoteMarkdownUriForMessage(uri: vscode.Uri): string {
    return this.formatNoteMarkdownDisplayPathInfo(uri).displayPath;
  }

  private formatNoteMarkdownFullDisplayPath(uri: vscode.Uri): string {
    const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
    const currentRemoteAuthority = this.getCurrentWebviewRemoteAuthority();
    const displayUri = canonicalizeNoteMarkdownUriForCurrentHost(
      uri,
      currentRemoteAuthority
    );
    const workspaceRelativePath = this.resolveNoteMarkdownWorkspaceRelativeDisplayPath(
      displayUri,
      currentRemoteAuthority,
      workspaceFolders
    );
    if (workspaceRelativePath) {
      return workspaceRelativePath;
    }

    const readablePath = this.formatNoteMarkdownReadableAbsolutePath(displayUri);
    const shouldShowRemotePrefix = shouldShowNoteMarkdownRemoteAuthorityPrefixForDisplay(
      {
        scheme: displayUri.scheme,
        authority: displayUri.authority
      },
      workspaceFolders.map((workspaceFolder) => ({
        scheme: workspaceFolder.uri.scheme,
        authority: workspaceFolder.uri.authority
      })),
      currentRemoteAuthority
    );
    const remotePrefix = shouldShowRemotePrefix
      ? formatNoteMarkdownRemoteAuthorityPrefix(displayUri.scheme, displayUri.authority)
      : undefined;
    return remotePrefix ? `${remotePrefix} · ${readablePath}` : readablePath;
  }

  private resolveNoteMarkdownWorkspaceRelativeDisplayPath(
    uri: vscode.Uri,
    currentRemoteAuthority: string | undefined = this.getCurrentWebviewRemoteAuthority(),
    workspaceFolders: readonly vscode.WorkspaceFolder[] = vscode.workspace.workspaceFolders ?? []
  ): string | undefined {
    for (const workspaceFolder of workspaceFolders) {
      const relativePath = resolveWorkspaceRelativeDisplayPathForNoteMarkdownUri(
        uri,
        workspaceFolder,
        workspaceFolders.length > 1,
        currentRemoteAuthority
      );
      if (relativePath) {
        return relativePath;
      }
    }

    return undefined;
  }

  private resolveCanvasTemplateRelativePathForAssociatedNoteSource(
    source: MarkdownFileNoteContentSource
  ): string | undefined {
    const uri = this.parseCurrentHostNoteMarkdownUri(source.resourceUri);
    if (!uri || !isSupportedNoteMarkdownFilePath(noteMarkdownUriPathLike(uri))) {
      return undefined;
    }

    const relativePath = this.resolveNoteMarkdownWorkspaceRelativeDisplayPath(uri);
    return relativePath ? normalizeCanvasTemplateWorkspaceRelativePath(relativePath) : undefined;
  }

  private formatNoteMarkdownReadableAbsolutePath(uri: vscode.Uri): string {
    const rawPath = uri.scheme === 'file' ? uri.fsPath : uri.path || uri.toString(true);
    const userHome = process.env.HOME ?? process.env.USERPROFILE;
    if (userHome) {
      const relativeToHome = resolveNoteMarkdownPathRelativeToHome(rawPath, userHome, uri.scheme === 'file');
      if (relativeToHome) {
        return relativeToHome;
      }
    }

    return uri.scheme === 'file' ? rawPath : rawPath.replace(/\\/g, '/');
  }

  private async refreshAssociatedMarkdownNotesForDocument(document: vscode.TextDocument): Promise<void> {
    const documentResourceKey = normalizeNoteMarkdownResourceKey(
      this.canonicalizeCurrentHostNoteMarkdownUri(document.uri)
    );
    const matchingNodeIds = this.state.nodes
      .filter((node) => {
        return this.getAssociatedNoteMarkdownResourceKey(node) === documentResourceKey;
      })
      .map((node) => node.id);
    for (const nodeId of matchingNodeIds) {
      await this.refreshAssociatedMarkdownNote(nodeId);
    }
  }

  private async refreshAllAssociatedMarkdownNotes(): Promise<void> {
    for (const node of this.state.nodes) {
      if (node.kind === 'note' && ensureNoteMetadata(node).contentSource?.kind === 'markdown-file') {
        await this.refreshAssociatedMarkdownNote(node.id);
      }
    }
  }

  private async refreshAssociatedMarkdownNote(
    nodeId: string,
    options: { clearRecoverableDraft?: boolean } = {}
  ): Promise<void> {
    if (options.clearRecoverableDraft) {
      this.activeAssociatedNoteMarkdownEdits.delete(nodeId);
    }

    const node = this.state.nodes.find((candidate) => candidate.id === nodeId && candidate.kind === 'note');
    const source = node ? ensureNoteMetadata(node).contentSource : undefined;
    if (!node || !source || source.kind !== 'markdown-file') {
      return;
    }

    const uri = this.parseCurrentHostNoteMarkdownUri(source.resourceUri);
    if (!uri) {
      this.state = updateAssociatedNoteMarkdownFileStatus(this.state, nodeId, {
        ...source,
        status: 'unreadable',
        lastError: '关联 Markdown 文件 URI 无法解析。'
      }, ensureNoteMetadata(node).content);
      this.persistState();
      this.postState('host/stateUpdated');
      return;
    }

    const readResult = await this.readNoteMarkdownFile(uri, {
      skipContentIfRevision:
        source.status === 'ok' && !source.recoverableDraft ? source.contentRevision : undefined
    });
    const latestNode = this.state.nodes.find((candidate) => candidate.id === nodeId && candidate.kind === 'note');
    const latestSource = latestNode ? ensureNoteMetadata(latestNode).contentSource : undefined;
    if (!latestNode || latestSource?.kind !== 'markdown-file') {
      return;
    }

    const latestResourceKey = this.getAssociatedNoteMarkdownResourceKey(latestNode);
    const refreshedResourceKey = normalizeNoteMarkdownResourceKey(
      this.canonicalizeCurrentHostNoteMarkdownUri(uri)
    );
    if (latestResourceKey !== refreshedResourceKey) {
      return;
    }

    const latestMetadata = ensureNoteMetadata(latestNode);
    const nextContent =
      readResult.status === 'ok' && !readResult.contentSkipped ? readResult.content : latestMetadata.content;
    const didRevisionChange =
      readResult.status === 'ok' &&
      Boolean(latestSource.contentRevision) &&
      Boolean(readResult.contentRevision) &&
      latestSource.contentRevision !== readResult.contentRevision;
    const activeEdit = this.activeAssociatedNoteMarkdownEdits.get(nodeId);
    const activeEditBaseRevision = activeEdit?.baseContentRevision ?? latestSource.contentRevision;
    const didActiveEditDraftChange = Boolean(activeEdit) && activeEdit?.content !== activeEdit?.baseContent;
    const didActiveEditRemoteRevisionChange =
      readResult.status === 'ok' &&
      Boolean(activeEdit) &&
      Boolean(activeEditBaseRevision) &&
      Boolean(readResult.contentRevision) &&
      activeEditBaseRevision !== readResult.contentRevision;
    const didActiveEditRemoteContentChange =
      readResult.status === 'ok' &&
      !readResult.contentSkipped &&
      Boolean(activeEdit) &&
      activeEdit?.baseContent !== readResult.content;
    const didActiveEditConflict =
      didActiveEditDraftChange &&
      (didActiveEditRemoteContentChange || didActiveEditRemoteRevisionChange);
    if (
      activeEdit &&
      readResult.status === 'ok' &&
      !readResult.contentSkipped &&
      readResult.contentRevision &&
      activeEditBaseRevision !== readResult.contentRevision &&
      !didActiveEditDraftChange
    ) {
      this.activeAssociatedNoteMarkdownEdits.set(nodeId, {
        ...activeEdit,
        baseContent: readResult.content,
        baseContentRevision: readResult.contentRevision,
        updatedAt: Date.now()
      });
    }
    const draftRetention = resolveNoteMarkdownRefreshDraftRetention({
      clearRecoverableDraft: options.clearRecoverableDraft,
      currentStatus: latestSource.status,
      hasRecoverableDraft: Boolean(latestSource.recoverableDraft),
      didRevisionChange,
      didActiveEditConflict
    });
    const nextRecoverableDraft = draftRetention.keepRecoverableDraft
      ? didActiveEditConflict && activeEdit
        ? this.createStoredNoteMarkdownRecoverableDraft(
            activeEdit.content,
            activeEditBaseRevision,
            readResult.contentRevision,
            latestSource.recoverableDraft
          )
        : latestSource.recoverableDraft
          ? {
              ...latestSource.recoverableDraft,
              remoteContentRevision: draftRetention.markDirtyConflict && readResult.status === 'ok'
                ? readResult.contentRevision
                : latestSource.recoverableDraft.remoteContentRevision
            }
          : undefined
      : undefined;
    const nextStatus = draftRetention.markDirtyConflict ? 'dirty-conflict' : readResult.status;
    const nextLastError = draftRetention.markDirtyConflict
      ? (latestSource.lastError ?? '关联文件在编辑期间被外部修改。请重新加载或覆盖。')
      : readResult.lastError;
    const nextState = updateAssociatedNoteMarkdownFileStatus(this.state, nodeId, {
      ...latestSource,
      resourceUri: uri.toString(),
      ...this.formatNoteMarkdownDisplayPathInfo(uri),
      contentRevision: readResult.status === 'ok' ? readResult.contentRevision : latestSource.contentRevision,
      status: nextStatus,
      lastError: nextLastError,
      recoverableDraft: nextRecoverableDraft
    }, nextContent);
    if (nextState === this.state) {
      return;
    }

    this.state = nextState;
    this.persistState();
    this.postState('host/stateUpdated');
  }

  private syncNoteMarkdownFileWatchers(): void {
    const expected = new Map<string, vscode.Uri>();
    for (const node of this.state.nodes) {
      if (node.kind !== 'note') {
        continue;
      }
      const source = ensureNoteMetadata(node).contentSource;
      if (source?.kind !== 'markdown-file') {
        continue;
      }
      const uri = this.parseCurrentHostNoteMarkdownUri(source.resourceUri);
      if (uri?.scheme === 'file') {
        expected.set(node.id, uri);
      }
    }

    for (const [nodeId, watcher] of this.noteMarkdownFileWatchers.entries()) {
      if (!expected.has(nodeId)) {
        watcher.close();
        this.noteMarkdownFileWatchers.delete(nodeId);
      }
    }

    for (const [nodeId, uri] of expected.entries()) {
      if (this.noteMarkdownFileWatchers.has(nodeId)) {
        continue;
      }

      const watcher = this.createNoteMarkdownFileWatcher(nodeId, uri);
      if (watcher) {
        this.noteMarkdownFileWatchers.set(nodeId, watcher);
      }
    }
  }

  private createNoteMarkdownFileWatcher(nodeId: string, uri: vscode.Uri): NoteMarkdownFileWatcher | undefined {
    const parentDirectory = path.dirname(uri.fsPath);
    const closeCallbacks: Array<() => void> = [];

    const fileListener = (): void => {
      this.scheduleNoteMarkdownFileRefresh(nodeId);
    };
    try {
      fs.watchFile(uri.fsPath, { interval: 750, persistent: false }, fileListener);
      closeCallbacks.push(() => fs.unwatchFile(uri.fsPath, fileListener));
    } catch {
      // Parent directory watching below may still catch create/delete events.
    }

    try {
      const parentWatcher = fs.watch(parentDirectory, { persistent: false }, () => {
        this.scheduleNoteMarkdownFileRefresh(nodeId);
      });
      closeCallbacks.push(() => parentWatcher.close());
    } catch {
      // Missing or inaccessible parents are represented in node state by refreshAssociatedMarkdownNote.
    }

    if (closeCallbacks.length === 0) {
      return undefined;
    }

    return {
      close: () => {
        for (const close of closeCallbacks) {
          close();
        }
      }
    };
  }

  private scheduleNoteMarkdownFileRefresh(nodeId: string): void {
    const existingTimer = this.noteMarkdownFileRefreshTimers.get(nodeId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      this.noteMarkdownFileRefreshTimers.delete(nodeId);
      void this.refreshAssociatedMarkdownNote(nodeId);
    }, 120);
    this.noteMarkdownFileRefreshTimers.set(nodeId, timer);
  }

  private disposeNoteMarkdownFileWatchers(): void {
    for (const timer of this.noteMarkdownFileRefreshTimers.values()) {
      clearTimeout(timer);
    }
    this.noteMarkdownFileRefreshTimers.clear();
    for (const watcher of this.noteMarkdownFileWatchers.values()) {
      watcher.close();
    }
    this.noteMarkdownFileWatchers.clear();
  }

  private async refocusInteractiveSurface(
    surface: CanvasSurfaceLocation | undefined,
    options?: { restoreWebviewFocus?: boolean }
  ): Promise<void> {
    if (surface === 'panel') {
      this.panelView?.show(false);
      this.maybePostVisibilityRestored('panel', {
        force: true,
        restoreFocus: options?.restoreWebviewFocus
      });
      return;
    }

    if (surface === 'editor') {
      this.editorPanel?.reveal(vscode.ViewColumn.One, false);
      for (const command of ['workbench.action.focusActiveEditorGroup', 'workbench.action.focusFirstEditorGroup']) {
        try {
          await vscode.commands.executeCommand(command);
          break;
        } catch {
          continue;
        }
      }
      this.maybePostVisibilityRestored('editor', {
        force: true,
        restoreFocus: options?.restoreWebviewFocus
      });
    }
  }

  private bindAgentFileActivitySession(nodeId: string, session: AgentFileActivitySession): void {
    this.agentFileActivitySessions.set(nodeId, session);
    session.start((event) => {
      // Ignore drained events from a session that has already been replaced or disposed.
      if (this.agentFileActivitySessions.get(nodeId) !== session) {
        return;
      }
      this.handleAgentFileActivityEvent(nodeId, event);
    });
  }

  private async disposeAgentFileActivitySession(nodeId: string): Promise<void> {
    const existing = this.agentFileActivitySessions.get(nodeId);
    if (!existing) {
      return;
    }

    await existing.dispose();
    if (this.agentFileActivitySessions.get(nodeId) === existing) {
      this.agentFileActivitySessions.delete(nodeId);
    }
  }

  private handleAgentFileActivityEvent(nodeId: string, event: AgentFileActivityEvent): void {
    if (!this.isFilesFeatureEnabled()) {
      return;
    }

    const relativePath = this.resolveWorkspaceRelativePath(event.path);
    const nextState = recordAgentFileActivity(this.state, {
      ...event,
      nodeId,
      relativePath
    });
    this.state = this.reconcileCanvasFileArtifacts(nextState);
    this.persistState();
    this.postState('host/stateUpdated');
  }

  private resolveWorkspaceRelativePath(filePath: string): string | undefined {
    const normalizedPath = normalizeTrackedFilePath(filePath);
    if (!normalizedPath) {
      return undefined;
    }

    const candidateUri = vscode.Uri.file(normalizedPath);
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(candidateUri);
    if (!workspaceFolder) {
      return undefined;
    }

    return resolveContainedWorkspaceRelativePath({
      filePath: normalizedPath,
      workspaceFolderPath: workspaceFolder.uri.fsPath,
      workspaceFolderName: workspaceFolder.name,
      includeWorkspaceFolderPrefix: (vscode.workspace.workspaceFolders?.length ?? 0) > 1
    });
  }

  private createConfiguredAgentFileActivitySession(
    provider: AgentProviderKind,
    command: string
  ): AgentFileActivitySession {
    if (!this.isFilesFeatureEnabled()) {
      return {
        extraArgs: [],
        extraEnv: {},
        start: () => {},
        dispose: async () => {}
      };
    }

    return createAgentFileActivitySession({
      provider,
      command,
      extensionRootPath: this.context.extensionUri.fsPath,
      storageRootPath: path.join(this.getExtensionStoragePath(), 'agent-file-activity')
    });
  }

  private getExecutionTerminalPathContext(kind: ExecutionNodeKind, nodeId: string): {
    shellPath?: string;
    cwd: string;
    pathStyle: 'windows' | 'posix';
    userHome?: string;
    linkOpenMode?: CanvasLinkOpenMode;
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
      linkOpenMode: this.getCanvasLinkOpenMode(),
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

  private hasActiveExecutionSessions(): boolean {
    return this.agentSessions.size > 0 || this.terminalSessions.size > 0;
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
          this.handleRuntimeSupervisorOutput(backend.kind, runtimeStoragePath, event),
        onSessionState: (snapshot) => {
          void this.handleRuntimeSupervisorState(backend.kind, runtimeStoragePath, snapshot).catch((error) => {
            this.recordDiagnosticEvent('runtime/sessionStateHandlerFailed', {
              sessionId: snapshot.sessionId,
              lifecycle: snapshot.lifecycle,
              live: snapshot.live,
              message: formatUnknownError(error)
            });
          });
        },
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

  private buildRuntimeSessionBindingKey(
    kind: ExecutionNodeKind,
    runtimeSessionId: string,
    runtimeStoragePath: string | undefined,
    runtimeBackend: RuntimeHostBackendKind | undefined
  ): string {
    const backendKind = normalizeRuntimeHostBackendKind(runtimeBackend) ?? 'legacy-detached';
    return `${backendKind}::${this.resolveRuntimeStoragePath(runtimeStoragePath)}::${kind}::${runtimeSessionId}`;
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
      if (snapshot.kind !== kind) {
        this.recordDiagnosticEvent('runtime/sessionKindMismatch', {
          nodeId,
          expectedKind: kind,
          actualKind: snapshot.kind,
          runtimeSessionId: snapshot.sessionId
        });
        this.markExecutionNodeAsHistoryRestored(
          nodeId,
          kind,
          `runtime session 类型不匹配：期望 ${kind}，实际 ${snapshot.kind}。`
        );
        return;
      }

      const node = this.requireNode(nodeId, kind);
      const metadata = kind === 'agent' ? ensureAgentMetadata(node) : ensureTerminalMetadata(node);
      this.bindRuntimeSession(
        nodeId,
        kind,
        snapshot.sessionId,
        this.getPersistedRuntimeStoragePath(metadata),
        normalizeRuntimeHostBackendKind(metadata.runtimeBackend) ?? snapshot.runtimeBackend
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
    runtimeStoragePath: string | undefined,
    runtimeBackend: RuntimeHostBackendKind | undefined
  ): void {
    const backendKind = normalizeRuntimeHostBackendKind(runtimeBackend) ?? 'legacy-detached';
    const normalizedRuntimeStoragePath = this.resolveRuntimeStoragePath(runtimeStoragePath);
    const nextBindingKey = this.buildRuntimeSessionBindingKey(
      kind,
      runtimeSessionId,
      normalizedRuntimeStoragePath,
      backendKind
    );
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
      runtimeBackend: backendKind,
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

  private unbindRuntimeSession(
    runtimeSessionId: string | undefined,
    runtimeStoragePath?: string,
    kind?: ExecutionNodeKind,
    runtimeBackend?: RuntimeHostBackendKind
  ): void {
    if (!runtimeSessionId) {
      return;
    }

    if (runtimeStoragePath && kind && runtimeBackend) {
      this.runtimeSessionBindings.delete(
        this.buildRuntimeSessionBindingKey(kind, runtimeSessionId, runtimeStoragePath, runtimeBackend)
      );
      return;
    }

    const normalizedRuntimeStoragePath = runtimeStoragePath
      ? this.resolveRuntimeStoragePath(runtimeStoragePath)
      : undefined;
    const normalizedRuntimeBackend = normalizeRuntimeHostBackendKind(runtimeBackend);
    for (const [bindingKey, binding] of Array.from(this.runtimeSessionBindings.entries())) {
      if (
        binding.runtimeSessionId === runtimeSessionId &&
        (!normalizedRuntimeStoragePath || binding.runtimeStoragePath === normalizedRuntimeStoragePath) &&
        (!kind || binding.kind === kind) &&
        (!normalizedRuntimeBackend || binding.runtimeBackend === normalizedRuntimeBackend)
      ) {
        this.runtimeSessionBindings.delete(bindingKey);
      }
    }
  }

  private createSupervisorExecutionSession(
    snapshot: RuntimeSupervisorSessionSnapshot,
    runtimeStoragePath: string | undefined,
    options: { outputSequenceFloor?: number } = {}
  ): SupervisorExecutionSession {
    const agentActivity =
      snapshot.kind === 'agent' ? createAgentActivityHeuristicState() : undefined;
    if (agentActivity) {
      resetAgentAbnormalStreamInterruptionHeuristics(agentActivity, snapshot.output);
    }

    const snapshotOutputSequence = normalizeExecutionOutputSequence(snapshot.outputSequence) ?? 0;
    const outputSequenceFloor = normalizeExecutionOutputSequence(options.outputSequenceFloor) ?? 0;

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
      preSuspendLifecycleStatus: snapshot.preSuspendLifecycle,
      lastSuspendReason: snapshot.lastSuspendReason,
      lastSuspendMessage: snapshot.lastSuspendMessage,
      lastReactivateError: snapshot.lastReactivateError,
      syncTimer: undefined,
      syncDueAtMs: undefined,
      lifecycleTimer: undefined,
      pendingOutput: '',
      outputSequence: Math.max(snapshotOutputSequence, outputSequenceFloor),
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
      agentActivity,
      attentionSignalState: this.createExecutionAttentionNotificationState(),
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
    runtimeBackend: RuntimeHostBackendKind,
    runtimeStoragePath: string,
    event: RuntimeSupervisorSessionOutputEvent
  ): void {
    const startedAt = Date.now();
    const binding = this.runtimeSessionBindings.get(
      this.buildRuntimeSessionBindingKey(event.kind, event.sessionId, runtimeStoragePath, runtimeBackend)
    );
    if (!binding) {
      return;
    }

    const session = this.getExecutionSessions(binding.kind).get(binding.nodeId);
    if (!session || session.owner !== 'supervisor') {
      return;
    }

    const supervisorOutputSequence = normalizeExecutionOutputSequence(event.outputSequence);
    if (supervisorOutputSequence !== undefined && supervisorOutputSequence > session.outputSequence) {
      session.outputSequence = supervisorOutputSequence;
    } else {
      session.outputSequence += 1;
    }
    session.buffer = appendTerminalBuffer(session.buffer, event.chunk);
    session.terminalStateTracker.write(event.chunk);
    session.lineContextTracker.write(event.chunk);
    void this.bridgeExecutionAttentionSignals(binding.kind, binding.nodeId, session, event.chunk);
    if (binding.kind === 'agent') {
      this.maybeSyncAgentResumeContextFromOutput(binding.nodeId, session, {
        allowOverwriteExisting: session.stopRequested,
        flushImmediately: session.stopRequested
      });
      this.recordAgentOutputHeuristicsAndNotifyAbnormalStream(binding.nodeId, session, event.chunk);
    }
    this.queueExecutionStateSync(binding.kind, binding.nodeId);
    this.queueExecutionOutput(binding.kind, binding.nodeId, event.chunk);
    this.recordExecutionPerformanceDiagnostics({
      timestamp: new Date().toISOString(),
      source: 'host-output-chunk',
      nodeId: binding.nodeId,
      kind: binding.kind,
      owner: session.owner,
      lifecycleStatus: session.lifecycleStatus,
      durationMs: Date.now() - startedAt,
      characters: event.chunk.length,
      bytes: Buffer.byteLength(event.chunk, 'utf8'),
      sequence: session.outputSequence,
      bufferLength: session.buffer.length,
      pendingOutputLength: session.pendingOutput.length
    });
  }

  private async handleRuntimeSupervisorState(
    runtimeBackend: RuntimeHostBackendKind,
    runtimeStoragePath: string,
    snapshot: RuntimeSupervisorSessionSnapshot
  ): Promise<void> {
    const binding = this.runtimeSessionBindings.get(
      this.buildRuntimeSessionBindingKey(snapshot.kind, snapshot.sessionId, runtimeStoragePath, runtimeBackend)
    );
    if (!binding) {
      return;
    }

    const previousSession = this.getExecutionSessions(binding.kind).get(binding.nodeId);
    const wasLive = Boolean(previousSession);
    this.applyRuntimeSupervisorSnapshot(binding.nodeId, binding.kind, snapshot, {
      postSnapshot: false,
      historyOnUnavailable: false
    });

    if (wasLive && !snapshot.live) {
      await this.postExecutionExitWithFinalSnapshot(
        binding.kind,
        binding.nodeId,
        snapshot.lastExitMessage ?? '会话已结束。'
      );
      if (binding.kind === 'agent' && previousSession && snapshot.lifecycle === 'error') {
        await this.markAndNotifyAgentAbnormalInterruption(
          binding.nodeId,
          previousSession,
          snapshot.lifecycle,
          snapshot.lastExitMessage ?? 'Agent 会话异常退出。',
          {
            exitCode: snapshot.lastExitCode ?? null,
            signal: snapshot.lastExitSignal ?? null,
            launchMode: snapshot.launchMode,
            runtimeBackend: snapshot.runtimeBackend,
            reason: 'process-exit'
          }
        );
      }
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
      const existingSession = this.getExecutionSessions(kind).get(nodeId);
      const outputSequenceFloor =
        maxExecutionOutputSequence(existingRuntimeMetadata.outputSequence, existingSession?.outputSequence) ?? 0;
      this.disposeManagedExecutionSession(existingSession);
      const session = this.createSupervisorExecutionSession(snapshot, runtimeStoragePath, {
        outputSequenceFloor
      });
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
          outputSequence: session.outputSequence,
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
                preSuspendLifecycle: snapshot.preSuspendLifecycle,
                lastSuspendReason: snapshot.lastSuspendReason,
                lastSuspendMessage: snapshot.lastSuspendMessage,
                lastReactivateError: snapshot.lastReactivateError,
                lastBackendLabel: snapshot.displayLabel
              }
            : {
                lifecycle: snapshot.lifecycle as TerminalNodeStatus
              })
        })
      });
      this.persistState({ reason: 'runtime-supervisor-live-snapshot' });
      this.postState('host/stateUpdated');
      if (options.postSnapshot) {
        this.postExecutionSnapshot(kind, nodeId, {
          executionSessionId: session.sessionId
        });
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
    this.unbindRuntimeSession(
      snapshot.sessionId,
      currentMetadata.runtimeStoragePath,
      kind,
      normalizeRuntimeHostBackendKind(currentMetadata.runtimeBackend) ?? snapshot.runtimeBackend
    );
    const existingSession = this.getExecutionSessions(kind).get(nodeId);
    this.disposeManagedExecutionSession(existingSession);
    this.getExecutionSessions(kind).delete(nodeId);
    if (kind === 'agent') {
      void this.disposeAgentFileActivitySession(nodeId);
    }
    this.state = updateExecutionNode(this.state, nodeId, kind, {
      status: snapshot.lifecycle,
      summary:
        snapshot.lastExitMessage ||
        (kind === 'agent'
          ? summarizeAgentSessionOutput(snapshot.output, snapshot.lifecycle as AgentNodeStatus, snapshot.displayLabel)
          : summarizeEmbeddedTerminalOutput(snapshot.output, snapshot.lifecycle as TerminalNodeStatus)),
      metadata: buildExecutionMetadataPatch(this.state, nodeId, kind, {
        persistenceMode: 'snapshot-only',
        attachmentState: 'history-restored',
        runtimeBackend: undefined,
        runtimeGuarantee: undefined,
        runtimeStoragePath: undefined,
        liveSession: false,
        runtimeSessionId: undefined,
        lastRuntimeError: undefined,
        shellPath: snapshot.shellPath,
        cwd: snapshot.cwd,
        recentOutput: extractRecentTerminalOutput(stripTerminalControlSequences(snapshot.output)) || currentMetadata.recentOutput,
        outputSequence: maxExecutionOutputSequence(
          snapshot.outputSequence,
          existingSession?.outputSequence,
          currentMetadata.outputSequence
        ),
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
              preSuspendLifecycle: undefined,
              lastSuspendReason: undefined,
              lastSuspendMessage: undefined,
              lastReactivateError: undefined,
              lastBackendLabel: snapshot.displayLabel
            }
          : {
              lifecycle: snapshot.lifecycle as TerminalNodeStatus
            })
      })
    });
    this.persistState({ reason: 'runtime-supervisor-completed-snapshot' });
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
    this.unbindRuntimeSession(
      runtimeSessionId,
      currentMetadata.runtimeStoragePath,
      kind,
      normalizeRuntimeHostBackendKind(currentMetadata.runtimeBackend) ?? snapshot?.runtimeBackend
    );
    const existingSession = this.getExecutionSessions(kind).get(nodeId);
    this.disposeManagedExecutionSession(existingSession);
    this.getExecutionSessions(kind).delete(nodeId);
    if (kind === 'agent') {
      void this.disposeAgentFileActivitySession(nodeId);
    }

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
        outputSequence: maxExecutionOutputSequence(
          snapshot?.outputSequence,
          existingSession?.outputSequence,
          currentMetadata.outputSequence
        ),
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
              preSuspendLifecycle: undefined,
              lastSuspendReason: undefined,
              lastSuspendMessage: undefined,
              lastReactivateError: undefined,
              lastBackendLabel: snapshot?.displayLabel ?? ensureAgentMetadata(existingNode).lastBackendLabel
            }
          : {
              lifecycle: lifecycle as TerminalNodeStatus,
              shellPath: snapshot?.shellPath ?? ensureTerminalMetadata(existingNode).shellPath,
              cwd: snapshot?.cwd ?? ensureTerminalMetadata(existingNode).cwd
            })
      })
    });
    this.persistState({ reason: 'runtime-history-restored' });
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

    this.unbindRuntimeSession(
      metadata.runtimeSessionId,
      metadata.runtimeStoragePath,
      'agent',
      normalizeRuntimeHostBackendKind(metadata.runtimeBackend)
    );
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
    this.persistState({ reason: 'agent-live-runtime-fallback-to-resume' });
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

  private getCurrentOpenCanvasSurface(): CanvasSurfaceLocation | undefined {
    if (!this.activeSurface) {
      return undefined;
    }

    return this.getSurfaceVisibility(this.activeSurface) === 'closed' ? undefined : this.activeSurface;
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
    if (this.shouldResetStateDueToRuntimePersistenceModeChange(snapshot)) {
      return this.appliedStartupConfiguration.defaultSurface;
    }

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
    }, {
      reason: 'active-surface'
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

  private invalidateSurfaceLifecycle(surface: CanvasSurfaceLocation, mode?: CanvasSurfaceMode): void {
    this.rejectPendingWebviewProbeRequests(surface, `${formatSurfaceForDiagnostics(surface)} Webview 生命周期已失效。`);
    this.rejectPendingWebviewDomActionRequests(surface, `${formatSurfaceForDiagnostics(surface)} Webview 生命周期已失效。`);
    this.clearPendingBootstrapHostMessages(surface);
    this.surfaceMode[surface] = mode;
    this.surfaceReady[surface] = false;
    this.surfaceLifecycle[surface] = {
      generation: this.surfaceLifecycle[surface].generation + 1,
      mode,
      ready: false,
      bootstrapAck: false
    };
  }

  private beginSurfaceRender(
    surface: CanvasSurfaceLocation,
    mode: CanvasSurfaceMode
  ): WebviewLifecycleIdentity {
    this.rejectPendingWebviewProbeRequests(surface, `${formatSurfaceForDiagnostics(surface)} Webview 正在重新渲染。`);
    this.rejectPendingWebviewDomActionRequests(surface, `${formatSurfaceForDiagnostics(surface)} Webview 正在重新渲染。`);
    this.clearPendingBootstrapHostMessages(surface);
    const generation = this.surfaceLifecycle[surface].generation + 1;
    this.surfaceMode[surface] = mode;
    this.surfaceReady[surface] = false;
    this.surfaceLifecycle[surface] = {
      generation,
      mode,
      ready: false,
      bootstrapAck: false
    };
    return {
      surface,
      mode,
      generation
    };
  }

  private getSurfaceLifecycleIdentity(surface: CanvasSurfaceLocation): WebviewLifecycleIdentity | undefined {
    const lifecycle = this.surfaceLifecycle[surface];
    if (!lifecycle.mode) {
      return undefined;
    }

    return {
      surface,
      mode: lifecycle.mode,
      generation: lifecycle.generation,
      frameId: lifecycle.frameId
    };
  }

  private getSurfaceMessageWebview(surface: CanvasSurfaceLocation): vscode.Webview | undefined {
    return this.surfaceMessageWebview[surface] ?? this.getSurfaceWebview(surface);
  }

  private markSurfaceReady(surface: CanvasSurfaceLocation, lifecycle?: WebviewLifecycleIdentity): void {
    this.clearPendingBootstrapHostMessages(surface);
    this.surfaceReady[surface] = true;
    this.surfaceLifecycle[surface] = {
      ...this.surfaceLifecycle[surface],
      ready: true,
      frameId: lifecycle?.frameId,
      bootstrapAck: false
    };
  }

  private bindSurfaceMessageWebview(
    surface: CanvasSurfaceLocation,
    sourceWebview: vscode.Webview | undefined,
    reason: 'render' | 'ready' | 'dispose'
  ): void {
    if (!sourceWebview) {
      const previousWebview = this.surfaceMessageWebview[surface];
      if (previousWebview) {
        this.recordDiagnosticEvent('surface/messageWebviewBound', {
          surface,
          reason,
          lifecycle: summarizeWebviewLifecycleIdentity(this.renderedWebviewLifecycle.get(previousWebview))
        });
      }
      delete this.surfaceMessageWebview[surface];
      return;
    }

    if (this.surfaceMessageWebview[surface] === sourceWebview) {
      return;
    }

    this.surfaceMessageWebview[surface] = sourceWebview;
    this.recordDiagnosticEvent('surface/messageWebviewBound', {
      surface,
      reason,
      lifecycle: summarizeWebviewLifecycleIdentity(this.renderedWebviewLifecycle.get(sourceWebview))
    });
  }

  private isCurrentWebviewMessage(
    sourceSurface: CanvasSurfaceLocation,
    sourceWebview: vscode.Webview | undefined,
    lifecycle: WebviewLifecycleIdentity | undefined,
    messageType: string,
    options: { recordIgnored?: boolean } = {}
  ): boolean {
    const currentWebview = this.getSurfaceMessageWebview(sourceSurface);
    const recordIgnored = options.recordIgnored !== false;
    if (sourceWebview && currentWebview && sourceWebview !== currentWebview) {
      if (recordIgnored) {
        this.recordDiagnosticEvent('webview/staleMessageIgnored', {
          surface: sourceSurface,
          type: messageType,
          reason: 'source-webview-mismatch',
          lifecycle: summarizeWebviewLifecycleIdentity(lifecycle),
          currentLifecycle: summarizeWebviewLifecycleIdentity(this.getSurfaceLifecycleIdentity(sourceSurface))
        });
      }
      return false;
    }

    if (!lifecycle) {
      if (sourceWebview) {
        if (recordIgnored) {
          this.recordDiagnosticEvent('webview/staleMessageIgnored', {
            surface: sourceSurface,
            type: messageType,
            reason: 'missing-lifecycle',
            currentLifecycle: summarizeWebviewLifecycleIdentity(this.getSurfaceLifecycleIdentity(sourceSurface))
          });
        }
        return false;
      }
      return true;
    }

    if (this.isCurrentSurfaceLifecycle(sourceSurface, lifecycle, messageType, { recordIgnored })) {
      return true;
    }

    return false;
  }

  private isCurrentSurfaceLifecycle(
    sourceSurface: CanvasSurfaceLocation,
    lifecycle: WebviewLifecycleIdentity,
    messageType: string,
    options: { recordIgnored?: boolean } = {}
  ): boolean {
    const currentLifecycle = this.surfaceLifecycle[sourceSurface];
    const matches =
      lifecycle.surface === sourceSurface &&
      lifecycle.mode === currentLifecycle.mode &&
      lifecycle.generation === currentLifecycle.generation &&
      areSurfaceLifecycleFrameIdsCompatible(currentLifecycle.frameId, lifecycle.frameId);

    if (!matches && options.recordIgnored !== false) {
      this.recordDiagnosticEvent('webview/staleMessageIgnored', {
        surface: sourceSurface,
        type: messageType,
        reason: 'lifecycle-mismatch',
        lifecycle: summarizeWebviewLifecycleIdentity(lifecycle),
        currentLifecycle: summarizeWebviewLifecycleIdentity(this.getSurfaceLifecycleIdentity(sourceSurface))
      });
    }

    return matches;
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

  private canPromoteReadyWebviewMessage(
    sourceSurface: CanvasSurfaceLocation,
    sourceWebview: vscode.Webview | undefined,
    lifecycle: WebviewLifecycleIdentity | undefined
  ): boolean {
    if (!sourceWebview || !lifecycle || !this.isInteractiveSurface(sourceSurface)) {
      return false;
    }

    const renderedLifecycle = this.renderedWebviewLifecycle.get(sourceWebview);
    const currentLifecycle = this.surfaceLifecycle[sourceSurface];
    const matchesRenderedLifecycle =
      renderedLifecycle !== undefined &&
      lifecycle.surface === sourceSurface &&
      lifecycle.mode === 'active' &&
      lifecycle.surface === renderedLifecycle.surface &&
      lifecycle.mode === renderedLifecycle.mode &&
      lifecycle.generation === renderedLifecycle.generation;
    if (!matchesRenderedLifecycle) {
      return false;
    }

    if (!this.surfaceReady[sourceSurface] && !currentLifecycle.ready) {
      return true;
    }

    return (
      this.surfaceReady[sourceSurface] &&
      currentLifecycle.ready &&
      this.getSurfaceMessageWebview(sourceSurface) === sourceWebview &&
      lifecycle.mode === currentLifecycle.mode &&
      lifecycle.generation === currentLifecycle.generation &&
      !areSurfaceLifecycleFrameIdsCompatible(currentLifecycle.frameId, lifecycle.frameId)
    );
  }

  private promoteReadyWebviewMessageIfNeeded(
    sourceSurface: CanvasSurfaceLocation,
    sourceWebview: vscode.Webview | undefined,
    lifecycle: WebviewLifecycleIdentity | undefined
  ): void {
    if (!this.canPromoteReadyWebviewMessage(sourceSurface, sourceWebview, lifecycle)) {
      return;
    }

    const currentLifecycle = this.surfaceLifecycle[sourceSurface];
    if (
      currentLifecycle.mode === lifecycle!.mode &&
      currentLifecycle.generation === lifecycle!.generation &&
      this.getSurfaceMessageWebview(sourceSurface) === sourceWebview &&
      areSurfaceLifecycleFrameIdsCompatible(currentLifecycle.frameId, lifecycle!.frameId)
    ) {
      return;
    }

    this.surfaceMode[sourceSurface] = lifecycle!.mode;
    this.surfaceReady[sourceSurface] = false;
    this.surfaceLifecycle[sourceSurface] = {
      generation: lifecycle!.generation,
      mode: lifecycle!.mode,
      ready: false,
      bootstrapAck: false
    };
    this.bindSurfaceMessageWebview(sourceSurface, sourceWebview, 'ready');
    this.recordDiagnosticEvent('surface/readyWebviewPromoted', {
      surface: sourceSurface,
      lifecycle: summarizeWebviewLifecycleIdentity(lifecycle)
    });
    this.postWorkspaceRootFocusGroupMessageForCurrentLifecycle(sourceSurface);
  }

  private recoverSurfaceAfterMessageWebviewDisposed(surface: CanvasSurfaceLocation): void {
    this.surfaceReady[surface] = false;
    if (this.activeSurface === surface && this.getSurfaceWebview(surface)) {
      this.invalidateSurfaceLifecycle(surface);
      this.ensureActiveSurfaceRendered(surface);
    }
  }

  private maybePostVisibilityRestored(
    surface: CanvasSurfaceLocation,
    options?: { force?: boolean; restoreFocus?: boolean }
  ): void {
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
    const restoreFocus = options?.restoreFocus ?? this.pendingVisibilityRestoreFocus[surface];
    delete this.pendingVisibilityRestoreFocus[surface];
    this.postMessage({
      type: 'host/visibilityRestored',
      ...(restoreFocus === false
        ? {
            payload: {
              restoreFocus: false
            }
          }
        : {})
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

    const lifecycle = this.beginSurfaceRender(surface, 'active');
    this.recordDiagnosticEvent('surface/rendered', {
      surface,
      mode: 'active',
      lifecycle: summarizeWebviewLifecycleIdentity(lifecycle)
    });
    webview.options = this.getWebviewOptions();
    webview.html = getWebviewHtml(webview, this.context.extensionUri, {
      mode: 'active',
      surface,
      lifecycle
    });
    this.renderedWebviewLifecycle.set(webview, lifecycle);
    this.bindSurfaceMessageWebview(surface, webview, 'render');
  }

  private renderStandbySurface(surface: CanvasSurfaceLocation): void {
    if (!this.activeSurface || this.activeSurface === surface) {
      return;
    }

    const webview = this.getSurfaceWebview(surface);
    if (!webview) {
      return;
    }

    const lifecycle = this.beginSurfaceRender(surface, 'standby');
    this.recordDiagnosticEvent('surface/rendered', {
      surface,
      mode: 'standby',
      activeSurface: this.activeSurface,
      lifecycle: summarizeWebviewLifecycleIdentity(lifecycle)
    });
    webview.options = this.getWebviewOptions();
    webview.html = getWebviewHtml(webview, this.context.extensionUri, {
      mode: 'standby',
      surface,
      activeSurface: this.activeSurface
    });
    this.renderedWebviewLifecycle.set(webview, lifecycle);
    this.bindSurfaceMessageWebview(surface, webview, 'render');
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

    return this.getSurfaceMessageWebview(this.activeSurface);
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

  private handleWebviewMessage(
    sourceSurface: CanvasSurfaceLocation,
    message: unknown,
    sourceWebview?: vscode.Webview
  ): void {
    const lifecycle = extractWebviewMessageLifecycle(message);
    if (hasInvalidWebviewLifecycle(message, lifecycle)) {
      this.recordDiagnosticEvent('webview/invalidLifecycleIgnored', {
        surface: sourceSurface,
        lifecycle: summarizeUnknownWebviewLifecycle(message)
      });
      return;
    }

    const parsedMessage = parseWebviewMessage(message);
    if (!parsedMessage) {
      if (this.isInteractiveSurface(sourceSurface) && this.isCurrentWebviewMessage(sourceSurface, sourceWebview, lifecycle, 'unknown')) {
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
        sourceWebview,
        parsedMessage.payload.requestId,
        parsedMessage.payload.snapshot,
        lifecycle
      );
      return;
    }

    if (parsedMessage.type === 'webview/testDomActionResult') {
      this.resolvePendingWebviewDomActionRequest(
        sourceSurface,
        sourceWebview,
        parsedMessage.payload.requestId,
        parsedMessage.payload.ok,
        parsedMessage.payload.errorMessage,
        lifecycle
      );
      return;
    }

    if (parsedMessage.type === 'webview/runtimeDiagnostic') {
      const current = this.isCurrentWebviewMessage(sourceSurface, sourceWebview, lifecycle, parsedMessage.type, {
        recordIgnored: false
      });
      this.recordDiagnosticEvent('webview/runtimeDiagnostic', {
        surface: sourceSurface,
        current,
        lifecycle: summarizeWebviewLifecycleIdentity(lifecycle),
        ...parsedMessage.payload
      });
      return;
    }

    if (parsedMessage.type === 'webview/executionPerformanceDiagnostic') {
      const current = this.isCurrentWebviewMessage(sourceSurface, sourceWebview, lifecycle, parsedMessage.type, {
        recordIgnored: false
      });
      const diagnosticDetail = {
        surface: sourceSurface,
        current,
        lifecycle: summarizeWebviewLifecycleIdentity(lifecycle),
        ...parsedMessage.payload
      };
      this.recordDiagnosticEvent('webview/executionPerformanceDiagnostic', diagnosticDetail);
      this.recordExecutionPerformanceDiagnostics({
        timestamp: new Date().toISOString(),
        ...diagnosticDetail
      });
      return;
    }

    if (parsedMessage.type === 'webview/executionClipboardDiagnostic') {
      const current = this.isCurrentWebviewMessage(sourceSurface, sourceWebview, lifecycle, parsedMessage.type, {
        recordIgnored: false
      });
      this.recordDiagnosticEvent('webview/executionClipboardDiagnostic', {
        surface: sourceSurface,
        current,
        lifecycle: summarizeWebviewLifecycleIdentity(lifecycle),
        ...parsedMessage.payload
      });
      return;
    }

    if (parsedMessage.type === 'webview/ready') {
      this.promoteReadyWebviewMessageIfNeeded(sourceSurface, sourceWebview, lifecycle);
      if (!this.isCurrentWebviewMessage(sourceSurface, sourceWebview, lifecycle, parsedMessage.type)) {
        return;
      }

      this.bindSurfaceMessageWebview(sourceSurface, sourceWebview, 'ready');
      this.markSurfaceReady(sourceSurface, lifecycle);
      this.recordDiagnosticEvent('surface/ready', {
        surface: sourceSurface,
        mode: this.surfaceMode[sourceSurface],
        activeSurface: this.activeSurface,
        lifecycle: summarizeWebviewLifecycleIdentity(this.getSurfaceLifecycleIdentity(sourceSurface))
      });
      this.postWorkspaceRootFocusGroupMessageForCurrentLifecycle(sourceSurface);
      if (this.isInteractiveSurface(sourceSurface)) {
        void this.bootstrapInteractiveSurface(sourceSurface, this.getSurfaceLifecycleIdentity(sourceSurface));
      }
      return;
    }

    if (parsedMessage.type === 'webview/bootstrapAck') {
      if (!this.isCurrentWebviewMessage(sourceSurface, sourceWebview, lifecycle, parsedMessage.type)) {
        return;
      }
      this.surfaceLifecycle[sourceSurface].bootstrapAck = true;
      this.recordDiagnosticEvent('surface/bootstrapAck', {
        surface: sourceSurface,
        lifecycle: summarizeWebviewLifecycleIdentity(this.getSurfaceLifecycleIdentity(sourceSurface))
      });
      this.flushPendingBootstrapHostMessages(sourceSurface);
      this.postWorkspaceRootFocusGroupMessageForCurrentLifecycle(sourceSurface);
      void this.postCanvasTemplateCatalogToActiveWebview();
      return;
    }

    if (!this.isInteractiveSurface(sourceSurface)) {
      return;
    }

    if (!this.isCurrentWebviewMessage(sourceSurface, sourceWebview, lifecycle, parsedMessage.type)) {
      return;
    }

    this.handleActiveWebviewMessage(sourceSurface, parsedMessage);
  }

  private async bootstrapInteractiveSurface(
    sourceSurface: CanvasSurfaceLocation,
    lifecycle?: WebviewLifecycleIdentity
  ): Promise<void> {
    try {
      await this.ensureDefaultTemplateAppliedIfNeeded();
    } catch (error) {
      this.recordDiagnosticEvent('template/defaultApplyFailedBeforeBootstrap', {
        message: formatUnknownError(error)
      });
    }

    const targetLifecycle = lifecycle ?? this.getSurfaceLifecycleIdentity(sourceSurface);
    if (
      !this.isInteractiveSurface(sourceSurface) ||
      !this.surfaceReady[sourceSurface] ||
      (targetLifecycle && !this.isCurrentSurfaceLifecycle(sourceSurface, targetLifecycle, 'host/bootstrap'))
    ) {
      return;
    }

    this.postState('host/bootstrap', {
      surface: sourceSurface,
      lifecycle: targetLifecycle
    });
    void this.postCanvasTemplateCatalogToActiveWebview();
    this.maybePostVisibilityRestored(sourceSurface, {
      force: true
    });
  }

  private handleActiveWebviewMessage(
    sourceSurface: CanvasSurfaceLocation,
    parsedMessage: WebviewToHostMessage
  ): void {
    switch (parsedMessage.type) {
      case 'webview/ready':
        return;
      case 'webview/updateViewportCenter':
        this.lastVisibleCanvasCenterBySurface[sourceSurface] = parsedMessage.payload.visibleCenter;
        return;
      case 'webview/selectNode':
        this.acknowledgeExecutionAttentionForNode(parsedMessage.payload.nodeId);
        return;
      case 'webview/arrangeCanvasLayout':
        this.state = this.reconcileCanvasFileArtifacts(
          finalizeCanvasGroupState(arrangeCanvasLayout(this.state))
        );
        this.canvasTemplateInitialized = true;
        this.persistState();
        this.postState('host/stateUpdated');
        return;
      case 'webview/createDemoNode':
        this.applyCreateNode(parsedMessage.payload.kind, parsedMessage.payload.preferredPosition, {
          requestId: parsedMessage.payload.requestId,
          agentProvider: parsedMessage.payload.agentProvider,
          agentLaunchPreset: parsedMessage.payload.agentLaunchPreset,
          agentCustomLaunchCommand: parsedMessage.payload.agentCustomLaunchCommand,
          cwdOverride: parsedMessage.payload.cwd,
          targetGroupId: parsedMessage.payload.targetGroupId
        });
        return;
      case 'webview/showCreateNodeBlockedReason':
        void this.showCreateNodeBlockedReasonModal(parsedMessage.payload.kind);
        return;
      case 'webview/createEmptyGroup':
        this.state = createEmptyCanvasGroup(
          this.state,
          parsedMessage.payload.position,
          parsedMessage.payload.size,
          parsedMessage.payload.parentGroupId
        );
        this.canvasTemplateInitialized = true;
        this.persistState();
        this.postState('host/stateUpdated');
        return;
      case 'webview/createGroupFromSelection':
        this.state = this.reconcileCanvasFileArtifacts(
          createGroupFromSelection(
            this.state,
            parsedMessage.payload.nodeIds,
            parsedMessage.payload.groupIds,
            parsedMessage.payload.parentGroupId
          )
        );
        this.canvasTemplateInitialized = true;
        this.persistState();
        this.postState('host/stateUpdated');
        return;
      case 'webview/updateGroupTitle':
        this.state = updateGroupTitle(
          this.state,
          parsedMessage.payload.groupId,
          parsedMessage.payload.title
        );
        this.persistState();
        this.postState('host/stateUpdated');
        return;
      case 'webview/moveGroup':
        {
          const groupId = parsedMessage.payload.groupId;
          this.recordDiagnosticEvent('canvas/groupMoveRequested', {
            groupId,
            previous: summarizeCanvasGroupGeometryForDiagnostics(this.state, groupId),
            requested: {
              position: parsedMessage.payload.position,
              pointerPosition: parsedMessage.payload.pointerPosition
            }
          });
          this.state = this.reconcileCanvasFileArtifacts(
            moveGroup(
              this.state,
              groupId,
              parsedMessage.payload.position,
              parsedMessage.payload.pointerPosition
            )
          );
          this.recordDiagnosticEvent('canvas/groupMoveApplied', {
            groupId,
            applied: summarizeCanvasGroupGeometryForDiagnostics(this.state, groupId)
          });
          this.persistState();
          this.postState('host/stateUpdated');
        }
        return;
      case 'webview/resizeGroup':
        {
          const groupId = parsedMessage.payload.groupId;
          const previousGroup = findCanvasGroupById(this.state, groupId);
          this.recordDiagnosticEvent('canvas/groupResizeRequested', {
            groupId,
            previous: summarizeCanvasGroupGeometryForDiagnostics(this.state, groupId),
            requested: {
              position: parsedMessage.payload.position,
              size: parsedMessage.payload.size
            }
          });
          this.state = this.reconcileCanvasFileArtifacts(
            resizeGroup(
              this.state,
              groupId,
              parsedMessage.payload.position,
              parsedMessage.payload.size
            )
          );
          const appliedGroup = findCanvasGroupById(this.state, groupId);
          this.recordDiagnosticEvent('canvas/groupResizeApplied', {
            groupId,
            applied: summarizeCanvasGroupGeometryForDiagnostics(this.state, groupId),
            requestedChangedByRepair: previousGroup && appliedGroup
              ? {
                  position: !canvasPositionsEqual(appliedGroup.position, parsedMessage.payload.position),
                  size: !canvasFootprintsEqual(appliedGroup.size, parsedMessage.payload.size)
                }
              : undefined,
            changedFromPrevious: previousGroup && appliedGroup
              ? {
                  position: !canvasPositionsEqual(previousGroup.position, appliedGroup.position),
                  size: !canvasFootprintsEqual(previousGroup.size, appliedGroup.size)
                }
              : undefined
          });
          this.persistState();
          this.postState('host/stateUpdated');
        }
        return;
      case 'webview/ungroup':
        this.state = this.reconcileCanvasFileArtifacts(ungroupCanvasGroup(this.state, parsedMessage.payload.groupId));
        this.persistState();
        this.postState('host/stateUpdated');
        return;
      case 'webview/deleteGroup':
        void this.deleteGroup(parsedMessage.payload.groupId);
        return;
      case 'webview/moveNode':
        this.state = this.reconcileCanvasFileArtifacts(
          moveNode(
            this.state,
            parsedMessage.payload.id,
            parsedMessage.payload.position,
            parsedMessage.payload.pointerPosition,
            parsedMessage.payload.selectedMoves
          )
        );
        this.persistState();
        this.postState('host/stateUpdated');
        return;
      case 'webview/resizeNode':
        this.state = this.reconcileCanvasFileArtifacts(
          resizeNode(
            this.state,
            parsedMessage.payload.nodeId,
            parsedMessage.payload.position,
            parsedMessage.payload.size,
            this.getCanvasFileViewConfiguration()
          )
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
      case 'webview/branchAgentSession':
        void this.branchAgentSession(parsedMessage.payload.nodeId);
        return;
      case 'webview/attachExecutionSession':
        this.attachExecutionSession(parsedMessage.payload.kind, parsedMessage.payload.nodeId, {
          requestId: parsedMessage.payload.requestId,
          executionSessionId: parsedMessage.payload.executionSessionId,
          minOutputSequence: parsedMessage.payload.minOutputSequence
        });
        return;
      case 'webview/executionInput':
        {
          const hostReceivedEpochMs = Date.now();
          const queueDelayMs =
            typeof parsedMessage.payload.webviewEpochMs === 'number'
              ? Math.max(0, hostReceivedEpochMs - parsedMessage.payload.webviewEpochMs)
              : undefined;
          this.recordExecutionPerformanceDiagnostics({
            timestamp: new Date(hostReceivedEpochMs).toISOString(),
            source: 'host-input-received',
            nodeId: parsedMessage.payload.nodeId,
            kind: parsedMessage.payload.kind,
            sequence: parsedMessage.payload.sequence,
            webviewEpochMs: parsedMessage.payload.webviewEpochMs,
            hostReceivedEpochMs,
            queueDelayMs,
            durationMs: queueDelayMs,
            characters: parsedMessage.payload.data.length,
            bytes: Buffer.byteLength(parsedMessage.payload.data, 'utf8'),
            success: true
          });
          this.recentExecutionInputPriority = {
            nodeId: parsedMessage.payload.nodeId,
            kind: parsedMessage.payload.kind,
            receivedAtMs: hostReceivedEpochMs,
            sequence: parsedMessage.payload.sequence
          };
          const hostAckEpochMs = Date.now();
          const schedulerStateBeforeAck = this.getExecutionOutputSchedulerDiagnosticState();
          const hostAckPostEpochMs = Date.now();
          this.postMessageToSurface(sourceSurface, {
            type: 'host/executionInputAck',
            payload: {
              nodeId: parsedMessage.payload.nodeId,
              kind: parsedMessage.payload.kind,
              sequence: parsedMessage.payload.sequence,
              webviewEpochMs: parsedMessage.payload.webviewEpochMs,
              webviewPerformanceNowMs: parsedMessage.payload.webviewPerformanceNowMs,
              hostReceivedEpochMs,
              hostAckEpochMs,
              hostAckPostEpochMs,
              queueDelayMs,
              controllerCount: schedulerStateBeforeAck.controllerCount,
              pendingControllerCount: schedulerStateBeforeAck.pendingControllerCount,
              queuedWriteCount: schedulerStateBeforeAck.queuedWriteCount,
              pendingOutputLength: schedulerStateBeforeAck.pendingOutputLength
            }
          });
          void this.writeExecutionInput(
            parsedMessage.payload.kind,
            parsedMessage.payload.nodeId,
            parsedMessage.payload.data,
            {
              sequence: parsedMessage.payload.sequence,
              webviewEpochMs: parsedMessage.payload.webviewEpochMs,
              webviewPerformanceNowMs: parsedMessage.payload.webviewPerformanceNowMs,
              hostReceivedEpochMs,
              queueDelayMs
            }
          );
          return;
        }
      case 'webview/copyExecutionSelection':
        void this.copyExecutionSelection(
          sourceSurface,
          parsedMessage.payload.kind,
          parsedMessage.payload.nodeId,
          parsedMessage.payload.text
        );
        return;
      case 'webview/copyTextToClipboard':
        void this.copyTextToClipboard(sourceSurface, parsedMessage.payload.text, {
          source: parsedMessage.payload.source,
          nodeId: parsedMessage.payload.nodeId
        });
        return;
      case 'webview/requestExecutionPaste':
        void this.handleExecutionPasteRequest(
          sourceSurface,
          parsedMessage.payload.kind,
          parsedMessage.payload.nodeId,
          parsedMessage.payload.requestId,
          parsedMessage.payload.bracketedPasteMode
        );
        return;
      case 'webview/pasteExecutionImage':
        void this.handleExecutionImagePasteRequest(
          sourceSurface,
          parsedMessage.payload.kind,
          parsedMessage.payload.nodeId,
          parsedMessage.payload.requestId,
          parsedMessage.payload.mimeType,
          parsedMessage.payload.dataBase64,
          parsedMessage.payload.sizeBytes,
          parsedMessage.payload.name
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
          parsedMessage.payload.candidates,
          parsedMessage.payload.priority
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
        void this.handleUpdateNoteNode(parsedMessage.payload);
        return;
      case 'webview/beginAssociatedNoteMarkdownEdit':
        void this.handleBeginAssociatedNoteMarkdownEdit(parsedMessage.payload);
        return;
      case 'webview/endAssociatedNoteMarkdownEdit':
        this.handleEndAssociatedNoteMarkdownEdit(parsedMessage.payload.nodeId);
        return;
      case 'webview/updateAssociatedNoteMarkdownDraft':
        void this.handleUpdateAssociatedNoteMarkdownDraft(parsedMessage.payload);
        return;
      case 'webview/clearAssociatedNoteMarkdownDraft':
        this.handleClearAssociatedNoteMarkdownDraft(parsedMessage.payload.nodeId);
        return;
      case 'webview/copyAssociatedNoteMarkdownDraft':
        void this.copyAssociatedNoteMarkdownDraft(
          sourceSurface,
          parsedMessage.payload.nodeId,
          parsedMessage.payload.content
        );
        return;
      case 'webview/saveNoteAsMarkdownFile':
        void this.saveNoteAsMarkdownFile(parsedMessage.payload.nodeId);
        return;
      case 'webview/openAssociatedNoteMarkdownFile':
        void this.openAssociatedNoteMarkdownFile(parsedMessage.payload.nodeId, sourceSurface);
        return;
      case 'webview/reloadAssociatedNoteMarkdownFile':
        void this.refreshAssociatedMarkdownNote(parsedMessage.payload.nodeId, { clearRecoverableDraft: true });
        return;
      case 'webview/createMissingAssociatedNoteMarkdownFile':
        void this.createMissingAssociatedNoteMarkdownFile(parsedMessage.payload.nodeId, sourceSurface);
        return;
      case 'webview/dropNoteMarkdownFiles':
        void this.handleDroppedNoteMarkdownFiles(
          parsedMessage.payload.resources,
          parsedMessage.payload.position,
          sourceSurface,
          parsedMessage.payload.targetGroupId
        );
        return;
      case 'webview/createEdge':
        this.state = createUserCanvasEdge(this.state, {
          id: `edge-${randomUUID()}`,
          sourceNodeId: parsedMessage.payload.sourceNodeId,
          targetNodeId: parsedMessage.payload.targetNodeId,
          sourceAnchor: parsedMessage.payload.sourceAnchor,
          targetAnchor: parsedMessage.payload.targetAnchor,
          arrowMode: 'forward',
          owner: 'user'
        });
        this.persistState();
        this.postState('host/stateUpdated');
        return;
      case 'webview/updateEdge':
        this.state = updateCanvasEdge(this.state, parsedMessage.payload.edgeId, {
          sourceNodeId: parsedMessage.payload.sourceNodeId,
          targetNodeId: parsedMessage.payload.targetNodeId,
          sourceAnchor: parsedMessage.payload.sourceAnchor,
          targetAnchor: parsedMessage.payload.targetAnchor,
          arrowMode: parsedMessage.payload.arrowMode,
          color: parsedMessage.payload.color,
          label: parsedMessage.payload.label
        });
        this.persistState();
        this.postState('host/stateUpdated');
        return;
      case 'webview/deleteEdge':
        this.state = deleteCanvasEdge(this.state, parsedMessage.payload.edgeId);
        this.persistState();
        this.postState('host/stateUpdated');
        return;
      case 'webview/openCanvasFile':
        void this.openCanvasFile(parsedMessage.payload.filePath, sourceSurface);
        return;
      case 'webview/openNoteLink':
        void this.openNoteLink(parsedMessage.payload.nodeId, parsedMessage.payload.href, sourceSurface);
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
      case 'webview/applyDefaultTemplate':
        void this.applyDefaultCanvasTemplate({
          visibleCenter: parsedMessage.payload?.visibleCenter,
          targetGroupId: parsedMessage.payload?.targetGroupId,
          focusAppliedNodes: true
        }).catch((error) => {
          this.postMessage({
            type: 'host/error',
            payload: {
              message: formatUnknownError(error)
            }
          });
        });
        return;
      case 'webview/applyTemplate':
        void this.applyCanvasTemplateById(parsedMessage.payload.templateId, {
          visibleCenter: parsedMessage.payload.visibleCenter,
          targetGroupId: parsedMessage.payload.targetGroupId,
          focusAppliedNodes: true
        }).catch((error) => {
          this.postMessage({
            type: 'host/error',
            payload: {
              message: formatUnknownError(error)
            }
          });
        });
        return;
      case 'webview/resetToDefaultTemplate':
        void this.resetDefaultCanvasTemplateWithConfirmation({
          visibleCenter: parsedMessage.payload?.visibleCenter,
          targetGroupId: parsedMessage.payload?.targetGroupId,
          focusAppliedNodes: true
        }).catch((error) => {
          this.postMessage({
            type: 'host/error',
            payload: {
              message: formatUnknownError(error)
            }
          });
        });
        return;
      case 'webview/resetToTemplate':
        void this.resetCanvasTemplateByIdWithConfirmation(parsedMessage.payload.templateId, {
          visibleCenter: parsedMessage.payload.visibleCenter,
          targetGroupId: parsedMessage.payload.targetGroupId,
          focusAppliedNodes: true
        }).catch((error) => {
          this.postMessage({
            type: 'host/error',
            payload: {
              message: formatUnknownError(error)
            }
          });
        });
        return;
      case 'webview/saveCanvasAsTemplate':
        void vscode.commands.executeCommand(COMMAND_IDS.saveCanvasAsTemplate);
        return;
    }
  }

  private postMessageToSurface(surface: CanvasSurfaceLocation, message: HostToWebviewMessage): void {
    const webview = this.getSurfaceMessageWebview(surface);
    const preparedMessage = this.withSurfaceLifecycle(surface, message);
    if (this.shouldQueueUntilBootstrapAck(surface, preparedMessage)) {
      this.queuePendingBootstrapHostMessage(surface, preparedMessage);
      this.recordHostMessage(surface, preparedMessage, false);
      return;
    }

    this.recordHostMessage(surface, preparedMessage, Boolean(webview));
    if (!webview) {
      return;
    }

    void webview.postMessage(preparedMessage);
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
    metadata?: AgentNodeMetadata,
    launchArgs: readonly string[] = []
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

      const explicitClaudeSessionFlag = extractClaudeCommandRuntimeSessionFlag(launchArgs);
      if (isClaudeForkSessionLaunch(launchArgs)) {
        return {
          supported: false,
          strategy: 'none',
          sessionId: explicitClaudeSessionFlag?.sessionId ?? randomUUID()
        };
      }

      if (explicitClaudeSessionFlag?.sessionId) {
        return {
          supported: false,
          strategy: 'none',
          sessionId: explicitClaudeSessionFlag.sessionId
        };
      }

      if (explicitClaudeSessionFlag) {
        return {
          supported: false,
          strategy: 'none'
        };
      }

      return {
        supported: false,
        strategy: 'none',
        sessionId: randomUUID()
      };
    }

    if (isTestHarnessMode(this.context.extensionMode)) {
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

  private readAgentResumeContextFromOutput(
    session: Pick<ManagedExecutionSession, 'agentProvider' | 'launchMode' | 'buffer'>
  ): AgentResumeContext | null {
    if (session.launchMode !== 'start') {
      return null;
    }

    const cleanedOutput = stripTerminalControlSequences(session.buffer);
    if (session.agentProvider === 'codex') {
      const sessionId = extractCodexResumeSessionId(cleanedOutput);
      return sessionId
        ? {
            supported: true,
            strategy: 'codex-session-id',
            sessionId
          }
        : null;
    }

    if (session.agentProvider === 'claude') {
      const sessionId = extractClaudeResumeSessionId(cleanedOutput);
      return sessionId
        ? {
            supported: true,
            strategy: 'claude-session-id',
            sessionId
          }
        : null;
    }

    return null;
  }

  private maybeSyncAgentResumeContextFromOutput(
    nodeId: string,
    session: ManagedExecutionSession,
    options: { allowOverwriteExisting?: boolean; flushImmediately?: boolean } = {}
  ): boolean {
    const discoveredResumeContext = this.readAgentResumeContextFromOutput(session);
    if (!discoveredResumeContext) {
      return false;
    }

    const previousSessionId = session.agentResume?.sessionId?.trim() ?? '';
    const previousStrategy = session.agentResume?.strategy ?? 'none';
    if (
      previousStrategy === discoveredResumeContext.strategy &&
      previousSessionId === discoveredResumeContext.sessionId
    ) {
      return false;
    }

    const hasConfirmedPreviousSessionId = previousStrategy !== 'none' && Boolean(previousSessionId);
    if (hasConfirmedPreviousSessionId && options.allowOverwriteExisting !== true) {
      return false;
    }

    session.agentResume = discoveredResumeContext;
    const provider = session.agentProvider ?? 'codex';
    this.recordDiagnosticEvent(
      hasConfirmedPreviousSessionId
        ? `agent/${provider}SessionIdCorrectedFromOutputHint`
        : `agent/${provider}SessionIdDiscoveredFromOutputHint`,
      {
        nodeId,
        cwd: session.cwd,
        previousResumeSessionId: previousSessionId || null,
        resumeSessionId: discoveredResumeContext.sessionId ?? null,
        startedAtMs: session.startedAtMs,
        stopRequested: session.stopRequested
      }
    );
    if (options.flushImmediately !== false) {
      this.flushLiveExecutionState('agent', nodeId, {
        persistMode: 'immediate',
        persistReason: 'agent-resume-context'
      });
    }
    return true;
  }

  private finalizeAgentResumeContextFromOutput(nodeId: string, session: ManagedExecutionSession): void {
    const discoveredResumeContext = this.readAgentResumeContextFromOutput(session);
    if (discoveredResumeContext) {
      session.agentResume = discoveredResumeContext;
      return;
    }

    if (session.agentProvider !== 'claude' || session.launchMode !== 'start') {
      return;
    }
    if (!session.stopRequested) {
      return;
    }

    const previousSessionId = session.agentResume?.sessionId?.trim() ?? '';
    const previousStrategy = session.agentResume?.strategy ?? 'none';
    if (previousStrategy === 'claude-session-id' && previousSessionId) {
      return;
    }
    if (previousStrategy === 'none' && !previousSessionId) {
      return;
    }

    session.agentResume = {
      supported: false,
      strategy: 'none'
    };
    this.recordDiagnosticEvent('agent/claudeSessionIdRejectedWithoutStopHint', {
      nodeId,
      cwd: session.cwd,
      previousResumeSessionId: previousSessionId || null,
      startedAtMs: session.startedAtMs,
      stopRequested: session.stopRequested
    });
  }

  private async maybeDiscoverAgentResumeContextFromFiles(
    nodeId: string,
    session: ManagedExecutionSession,
    trigger: 'startup' | 'waiting-input'
  ): Promise<void> {
    if (session.agentProvider === 'codex') {
      await this.maybeDiscoverCodexResumeSessionId(nodeId, session, trigger);
      return;
    }

    if (session.agentProvider === 'claude') {
      await this.maybeConfirmClaudeResumeSessionId(nodeId, session, trigger);
    }
  }

  private async maybeDiscoverCodexResumeSessionId(
    nodeId: string,
    session: ManagedExecutionSession,
    trigger: 'startup' | 'waiting-input'
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

    if (currentSession.agentResume?.sessionId?.trim()) {
      return;
    }

    if (!discoveredSessionId) {
      this.recordDiagnosticEvent('agent/codexSessionIdDiscoveryMissed', {
        nodeId,
        cwd: session.cwd,
        startedAtMs: session.startedAtMs,
        trigger
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
      startedAtMs: session.startedAtMs,
      trigger
    });
    this.flushLiveExecutionState('agent', nodeId, {
      persistMode: 'immediate',
      persistReason: 'agent-resume-context'
    });
  }

  private async maybeConfirmClaudeResumeSessionId(
    nodeId: string,
    session: ManagedExecutionSession,
    trigger: 'startup' | 'waiting-input'
  ): Promise<void> {
    if (session.agentProvider !== 'claude' || session.launchMode !== 'start') {
      return;
    }

    const candidateSessionId = session.agentResume?.sessionId?.trim() ?? '';
    if (!candidateSessionId || session.agentResume?.strategy === 'claude-session-id') {
      return;
    }

    const confirmedSessionId = await locateClaudeSessionId({
      cwd: session.cwd,
      sessionId: candidateSessionId
    });

    const currentSession = this.getExecutionSessions('agent').get(nodeId);
    if (!currentSession || currentSession !== session) {
      return;
    }

    const currentSessionId = currentSession.agentResume?.sessionId?.trim() ?? '';
    if (
      currentSession.agentProvider !== 'claude' ||
      currentSession.launchMode !== 'start' ||
      !currentSessionId ||
      currentSessionId !== candidateSessionId ||
      currentSession.agentResume?.strategy === 'claude-session-id'
    ) {
      return;
    }

    if (!confirmedSessionId) {
      this.recordDiagnosticEvent('agent/claudeSessionIdFileConfirmationMissed', {
        nodeId,
        cwd: session.cwd,
        resumeSessionId: candidateSessionId,
        startedAtMs: session.startedAtMs,
        trigger
      });
      return;
    }

    currentSession.agentResume = {
      supported: true,
      strategy: 'claude-session-id',
      sessionId: confirmedSessionId
    };
    this.recordDiagnosticEvent('agent/claudeSessionIdConfirmedFromFiles', {
      nodeId,
      cwd: session.cwd,
      resumeSessionId: confirmedSessionId,
      startedAtMs: session.startedAtMs,
      trigger
    });
    this.flushLiveExecutionState('agent', nodeId, {
      persistMode: 'immediate',
      persistReason: 'agent-resume-context'
    });
  }

  private ensureAgentActivityState(session: ManagedExecutionSession): AgentActivityHeuristicState {
    if (!session.agentActivity) {
      session.agentActivity = createAgentActivityHeuristicState();
    }

    return session.agentActivity;
  }

  private createExecutionAttentionNotificationState(): ExecutionAttentionNotificationState {
    return {
      ...createExecutionAttentionSignalState()
    };
  }

  private ensureExecutionAttentionNotificationState(
    session: ManagedExecutionSession
  ): ExecutionAttentionNotificationState {
    if (!session.attentionSignalState) {
      session.attentionSignalState = this.createExecutionAttentionNotificationState();
    }

    return session.attentionSignalState;
  }

  private setExecutionAttentionPending(
    kind: ExecutionNodeKind,
    nodeId: string,
    pending: boolean,
    options: { postState?: boolean } = {}
  ): boolean {
    const node = this.state.nodes.find((candidate) => candidate.id === nodeId && candidate.kind === kind);
    if (!node) {
      return false;
    }

    const metadata = kind === 'agent' ? ensureAgentMetadata(node) : ensureTerminalMetadata(node);
    if (metadata.attentionPending === pending) {
      return false;
    }

    this.state = updateExecutionNode(this.state, nodeId, kind, {
      status: node.status,
      summary: node.summary,
      metadata: buildExecutionMetadataPatch(this.state, nodeId, kind, {
        attentionPending: pending
      })
    });
    this.persistState({ reason: 'execution-attention' });
    if (options.postState !== false) {
      this.postState('host/stateUpdated');
    }
    return true;
  }

  private clearExecutionAttention(
    kind: ExecutionNodeKind,
    nodeId: string,
    options: { postState?: boolean } = {}
  ): boolean {
    return this.setExecutionAttentionPending(kind, nodeId, false, options);
  }

  private acknowledgeExecutionAttentionForNode(nodeId: string): void {
    const node = this.state.nodes.find((candidate) => candidate.id === nodeId);
    if (!node || !isExecutionNodeKind(node.kind)) {
      return;
    }

    this.clearExecutionAttention(node.kind, nodeId);
  }

  private async bridgeExecutionAttentionSignals(
    kind: ExecutionNodeKind,
    nodeId: string,
    session: ManagedExecutionSession,
    chunk: string
  ): Promise<void> {
    const state = this.ensureExecutionAttentionNotificationState(session);
    const parsed = parseExecutionAttentionSignals(chunk, state.carryover);
    state.carryover = parsed.carryover;

    if (parsed.signals.length === 0) {
      return;
    }

    const enabledSignals = filterEnabledExecutionAttentionSignals(
      parsed.signals,
      this.enabledAttentionSignals
    );
    if (enabledSignals.length === 0) {
      this.recordDiagnosticEvent('execution/attentionNotificationSuppressed', {
        kind,
        nodeId,
        reason: 'signal-disabled',
        signals: parsed.signals.map((parsedSignal) => parsedSignal.kind),
        enabledSignals: this.enabledAttentionSignals
      });
      return;
    }

    const signal = selectExecutionAttentionSignalForNotification(enabledSignals);
    if (!signal) {
      this.recordDiagnosticEvent('execution/attentionNotificationSuppressed', {
        kind,
        nodeId,
        reason: 'no-notify-signal'
      });
      return;
    }

    const message = this.buildExecutionAttentionNotificationMessage(kind, nodeId, session, signal);
    const notificationKey = `${signal.kind}:${message}`;
    const cooldownMs =
      signal.kind === 'bel'
        ? EXECUTION_ATTENTION_BELL_NOTIFICATION_COOLDOWN_MS
        : EXECUTION_ATTENTION_NOTIFICATION_COOLDOWN_MS;
    const now = Date.now();

    if (
      state.lastNotificationKey === notificationKey &&
      typeof state.lastNotificationAtMs === 'number' &&
      now - state.lastNotificationAtMs < cooldownMs
    ) {
      this.recordDiagnosticEvent('execution/attentionNotificationSuppressed', {
        kind,
        nodeId,
        reason: 'cooldown',
        signal: signal.kind
      });
      return;
    }

    this.setExecutionAttentionPending(kind, nodeId, true);
    state.lastNotificationKey = notificationKey;
    state.lastNotificationAtMs = now;

    await this.publishExecutionAttentionNotification(kind, nodeId, message, notificationKey, {
      trigger: 'terminal-signal',
      signal: signal.kind
    });
  }

  private async markAndNotifyAgentAbnormalInterruption(
    nodeId: string,
    session: ManagedExecutionSession,
    status: AgentNodeStatus,
    message: string,
    detail: Record<string, unknown> = {}
  ): Promise<void> {
    if (!this.shouldNotifyAgentAbnormalInterruption(session, status, detail)) {
      return;
    }

    if (!this.isConfiguredAttentionSignalEnabled('agentAbnormalExit', 'agent', nodeId, {
      trigger: 'agent-abnormal-interruption',
      provider: session.agentProvider,
      lifecycleStatus: status,
      ...detail
    })) {
      return;
    }

    const state = session.attentionSignalState;
    const now = Date.now();
    if (
      typeof state?.lastAbnormalStreamNotificationAtMs === 'number' &&
      now - state.lastAbnormalStreamNotificationAtMs < EXECUTION_ATTENTION_NOTIFICATION_COOLDOWN_MS
    ) {
      this.setExecutionAttentionPending('agent', nodeId, true);
      this.recordDiagnosticEvent('execution/attentionNotificationSuppressed', {
        kind: 'agent',
        nodeId,
        reason: 'covered-by-abnormal-stream',
        trigger: 'agent-abnormal-interruption',
        provider: session.agentProvider,
        lifecycleStatus: status,
        ...detail
      });
      return;
    }

    this.setExecutionAttentionPending('agent', nodeId, true);
    const notificationMessage = this.buildAgentAbnormalInterruptionNotificationMessage(
      nodeId,
      session,
      status,
      message
    );
    await this.publishExecutionAttentionNotification(
      'agent',
      nodeId,
      notificationMessage,
      `agent-abnormal-interruption:${session.sessionId}:${status}`,
      {
        trigger: 'agent-abnormal-interruption',
        provider: session.agentProvider,
        lifecycleStatus: status,
        ...detail
      }
    );
  }

  private shouldNotifyAgentAbnormalInterruption(
    session: Pick<ManagedExecutionSession, 'agentProvider' | 'stopRequested' | 'lifecycleStatus'>,
    status: AgentNodeStatus | TerminalNodeStatus,
    detail: Record<string, unknown>
  ): status is 'error' {
    return (
      !session.stopRequested &&
      status === 'error' &&
      (session.agentProvider === 'codex' || session.agentProvider === 'claude') &&
      (session.lifecycleStatus === 'running' || session.lifecycleStatus === 'waiting-input') &&
      detail.reason === 'process-exit' &&
      typeof detail.exitCode === 'number' &&
      detail.exitCode !== 0
    );
  }

  private async markAndNotifyAgentAbnormalStreamInterruption(
    nodeId: string,
    session: ManagedExecutionSession,
    message: string
  ): Promise<void> {
    if (!this.shouldNotifyAgentAbnormalStreamInterruption(session)) {
      return;
    }

    if (!this.isConfiguredAttentionSignalEnabled('codexAbnormalOutputText', 'agent', nodeId, {
      trigger: 'agent-abnormal-stream-interruption',
      provider: session.agentProvider,
      lifecycleStatus: session.lifecycleStatus,
      launchMode: session.launchMode,
      reason: 'output-pattern'
    })) {
      return;
    }

    const normalizedMessage = trimStoredTerminalText(message)
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!normalizedMessage) {
      return;
    }

    const signature = normalizeAgentAbnormalStreamInterruptionSignature(normalizedMessage);
    const state = this.ensureExecutionAttentionNotificationState(session);
    const notificationKey = `agent-abnormal-stream:${session.sessionId}:${signature}`;
    const now = Date.now();
    if (
      state.lastAbnormalStreamNotificationKey === notificationKey &&
      typeof state.lastAbnormalStreamNotificationAtMs === 'number' &&
      now - state.lastAbnormalStreamNotificationAtMs < EXECUTION_ATTENTION_NOTIFICATION_COOLDOWN_MS
    ) {
      this.recordDiagnosticEvent('execution/attentionNotificationSuppressed', {
        kind: 'agent',
        nodeId,
        reason: 'cooldown',
        trigger: 'agent-abnormal-stream-interruption',
        provider: session.agentProvider,
        message: normalizedMessage
      });
      return;
    }

    state.lastAbnormalStreamNotificationKey = notificationKey;
    state.lastAbnormalStreamNotificationAtMs = now;
    this.setExecutionAttentionPending('agent', nodeId, true);
    await this.publishExecutionAttentionNotification(
      'agent',
      nodeId,
      this.buildAgentAbnormalStreamInterruptionNotificationMessage(nodeId, session, normalizedMessage),
      notificationKey,
      {
        trigger: 'agent-abnormal-stream-interruption',
        provider: session.agentProvider,
        lifecycleStatus: session.lifecycleStatus,
        launchMode: session.launchMode,
        reason: 'output-pattern'
      }
    );
  }

  private shouldNotifyAgentAbnormalStreamInterruption(
    session: Pick<ManagedExecutionSession, 'agentProvider' | 'stopRequested' | 'lifecycleStatus'>
  ): boolean {
    return (
      !session.stopRequested &&
      this.agentAbnormalOutputTextNotificationMode === 'codex' &&
      session.agentProvider === 'codex' &&
      (session.lifecycleStatus === 'running' || session.lifecycleStatus === 'waiting-input')
    );
  }

  private isConfiguredAttentionSignalEnabled(
    signal: ExecutionAttentionSignalKind,
    kind: ExecutionNodeKind,
    nodeId: string,
    detail: Record<string, unknown> = {}
  ): boolean {
    if (isExecutionAttentionSignalEnabled(this.enabledAttentionSignals, signal)) {
      return true;
    }

    this.recordDiagnosticEvent('execution/attentionNotificationSuppressed', {
      ...detail,
      kind,
      nodeId,
      reason: 'signal-disabled',
      signal,
      enabledSignals: this.enabledAttentionSignals
    });
    return false;
  }

  private async publishExecutionAttentionNotification(
    kind: ExecutionNodeKind,
    nodeId: string,
    message: string,
    notificationKey: string,
    detail: Record<string, unknown> = {}
  ): Promise<void> {
    if (this.attentionNotificationBridgeMode === 'system') {
      const companionResult = await this.postExecutionAttentionNotificationToCompanion(
        this.buildExecutionAttentionNotificationRequest(kind, nodeId, message, notificationKey)
      );
      if (companionResult.status === 'posted') {
        this.recordDiagnosticEvent('execution/attentionNotificationCompanionPosted', {
          ...detail,
          kind,
          nodeId,
          message,
          bridgeMode: this.attentionNotificationBridgeMode,
          backend: companionResult.backend,
          activationMode: companionResult.activationMode,
          companionDetail: companionResult.detail
        });
        return;
      }

      this.recordDiagnosticEvent('execution/attentionNotificationCompanionFallback', {
        ...detail,
        kind,
        nodeId,
        message,
        bridgeMode: this.attentionNotificationBridgeMode,
        status: companionResult.status,
        backend: companionResult.backend,
        activationMode: companionResult.activationMode,
        companionDetail: companionResult.detail
      });
    }

    if (this.attentionNotificationBridgeMode === 'none') {
      return;
    }

    this.recordDiagnosticEvent('execution/attentionNotificationPosted', {
      ...detail,
      kind,
      nodeId,
      message,
      bridgeMode: this.attentionNotificationBridgeMode
    });
    void this.showExecutionAttentionNotification(kind, nodeId, message);
  }

  private buildExecutionAttentionNotificationRequest(
    kind: ExecutionNodeKind,
    nodeId: string,
    message: string,
    notificationKey: string
  ): AttentionNotificationRequest {
    return {
      version: ATTENTION_NOTIFICATION_PROTOCOL_VERSION,
      kind: 'execution-attention',
      title: this.buildExecutionAttentionNotificationTitle(
        kind,
        this.resolveExecutionAttentionNotificationCwd(kind, nodeId)
      ),
      message,
      dedupeKey: `${nodeId}:${notificationKey}`,
      focusAction: {
        command: COMMAND_IDS.centerAttentionNode,
        arguments: [nodeId]
      }
    };
  }

  private buildExecutionAttentionNotificationTitle(
    kind: ExecutionNodeKind,
    cwd: string | undefined
  ): string {
    return buildExecutionAttentionNotificationTitleForWorkspace(kind, {
      workspaceName: vscode.workspace.name,
      workspaceFolders: (vscode.workspace.workspaceFolders ?? []).map((folder) => ({
        name: folder.name,
        path: folder.uri.fsPath
      })),
      cwd
    });
  }

  private resolveExecutionAttentionNotificationCwd(
    kind: ExecutionNodeKind,
    nodeId: string
  ): string | undefined {
    const liveSessionCwd = normalizeExecutionCwd(this.getExecutionSessions(kind).get(nodeId)?.cwd ?? '');
    if (liveSessionCwd) {
      return liveSessionCwd;
    }

    const node = this.state.nodes.find((candidate) => candidate.id === nodeId && candidate.kind === kind);
    if (!node) {
      return undefined;
    }

    const metadata = kind === 'agent' ? ensureAgentMetadata(node) : ensureTerminalMetadata(node);
    return normalizeExecutionCwd(metadata.cwd);
  }

  private async postExecutionAttentionNotificationToCompanion(
    request: AttentionNotificationRequest
  ): Promise<AttentionNotificationDeliveryResult> {
    try {
      const result = await vscode.commands.executeCommand(
        NOTIFIER_COMMAND_IDS.postSystemNotification,
        request
      );
      if (isAttentionNotificationDeliveryResult(result)) {
        return result;
      }

      return {
        status: 'error',
        backend: 'unsupported',
        activationMode: 'none',
        detail: 'invalid-companion-result'
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const status = /command .* not found/i.test(detail) ? 'unsupported' : 'error';
      return {
        status,
        backend: 'unsupported',
        activationMode: 'none',
        detail
      };
    }
  }

  private async showExecutionAttentionNotification(
    kind: ExecutionNodeKind,
    nodeId: string,
    message: string
  ): Promise<void> {
    const selection = await vscode.window.showInformationMessage(message, EXECUTION_ATTENTION_FOCUS_ACTION_LABEL);
    if (selection !== EXECUTION_ATTENTION_FOCUS_ACTION_LABEL) {
      return;
    }

    await this.centerExecutionAttentionNode(kind, nodeId);
  }

  private async centerExecutionAttentionNode(kind: ExecutionNodeKind, nodeId: string): Promise<void> {
    const node = this.state.nodes.find((candidate) => candidate.id === nodeId && candidate.kind === kind);
    if (!node) {
      void vscode.window.showWarningMessage('通知对应的节点已不存在，无法定位。');
      return;
    }

    try {
      await this.centerNodeInCanvas(nodeId);
    } catch {
      void vscode.window.showWarningMessage(
        `${kind === 'agent' ? 'Agent' : 'Terminal'}「${trimStoredTerminalText(node.title).trim() || nodeId}」暂时无法定位。`
      );
    }
  }

  private requestTemplateNodeGroupFocus(nodeIds: readonly string[]): void {
    const targetNodeIds = Array.from(
      new Set(nodeIds.filter((nodeId) => nodeId.trim().length > 0))
    );
    if (targetNodeIds.length === 0) {
      return;
    }

    void this.focusTemplateNodeGroupInCanvas(targetNodeIds).catch((error) => {
      this.recordDiagnosticEvent('template/focusFailed', {
        nodeIds: targetNodeIds,
        message: formatUnknownError(error)
      });
    });
  }

  private async focusTemplateNodeGroupInCanvas(nodeIds: readonly string[]): Promise<void> {
    const targetSurface = this.activeSurface ?? this.getConfiguredSurface();
    await this.revealSurface(targetSurface);
    await this.waitForCanvasReady(targetSurface, EXECUTION_ATTENTION_FOCUS_TIMEOUT_MS);
    this.postMessageToSurface(targetSurface, {
      type: 'host/focusNodes',
      payload: {
        nodeIds: [...nodeIds]
      }
    });
  }

  private async focusNodeInCanvas(nodeId: string): Promise<void> {
    const targetSurface = this.activeSurface ?? this.getConfiguredSurface();
    await this.revealSurface(targetSurface);
    await this.waitForCanvasReady(targetSurface, EXECUTION_ATTENTION_FOCUS_TIMEOUT_MS);
    this.postMessageToSurface(targetSurface, {
      type: 'host/focusNode',
      payload: {
        nodeId
      }
    });
  }

  private async centerNodeInCanvas(nodeId: string): Promise<void> {
    const targetSurface = this.activeSurface ?? this.getConfiguredSurface();
    await this.revealSurface(targetSurface, { restoreWebviewFocus: false });
    await this.waitForCanvasReady(targetSurface, EXECUTION_ATTENTION_FOCUS_TIMEOUT_MS);
    this.postMessageToSurface(targetSurface, {
      type: 'host/centerNode',
      payload: {
        nodeId
      }
    });
  }

  private resolveWorkspaceRootGroupForAddedFolder(
    rootPaths: readonly string[]
  ): { workspaceRootPath: string; groupId: string } | undefined {
    const targetRootPaths = new Set(rootPaths.map(normalizeWorkspaceRootPathForComposition));
    if (targetRootPaths.size === 0) {
      return undefined;
    }

    for (const group of this.state.groups ?? []) {
      if (!isWorkspaceRootGroup(group)) {
        continue;
      }

      const workspaceRootPath = resolveWorkspaceRootPathForGroup(group);
      if (workspaceRootPath && targetRootPaths.has(workspaceRootPath)) {
        return {
          workspaceRootPath,
          groupId: group.id
        };
      }
    }

    return undefined;
  }

  private focusWorkspaceRootInCanvas(groupId: string): void {
    const targetSurface = this.activeSurface ?? this.getConfiguredSurface();
    void (async () => {
      await this.revealSurface(targetSurface, { restoreWebviewFocus: false });
      await this.waitForCanvasReady(targetSurface, EXECUTION_ATTENTION_FOCUS_TIMEOUT_MS);
      this.postWorkspaceRootFocusGroupMessage(targetSurface, groupId);
    })().catch((error) => {
      this.recordDiagnosticEvent('workspaceRoot/focusFailed', {
        groupId,
        message: formatUnknownError(error)
      });
    });
  }

  private postWorkspaceRootFocusGroupMessage(
    surface: CanvasSurfaceLocation,
    groupId: string
  ): void {
    this.pendingWorkspaceRootFocusReplay[surface] = {
      groupId,
      expiresAtMs: Date.now() + WORKSPACE_ROOT_FOCUS_REPLAY_WINDOW_MS
    };
    this.postWorkspaceRootFocusGroupMessageForCurrentLifecycle(surface);
  }

  private postWorkspaceRootFocusGroupMessageForCurrentLifecycle(surface: CanvasSurfaceLocation): void {
    const pendingFocus = this.pendingWorkspaceRootFocusReplay[surface];
    if (!pendingFocus) {
      return;
    }

    if (Date.now() > pendingFocus.expiresAtMs) {
      delete this.pendingWorkspaceRootFocusReplay[surface];
      return;
    }

    if (!this.isInteractiveSurfaceReady() || this.activeSurface !== surface) {
      return;
    }

    const lifecycle = this.getSurfaceLifecycleIdentity(surface);
    if (areWebviewLifecycleIdentitiesEqual(pendingFocus.sentLifecycle, lifecycle)) {
      return;
    }

    pendingFocus.sentLifecycle = lifecycle;
    this.recordDiagnosticEvent('workspaceRoot/focusGroupPosted', {
      surface,
      groupId: pendingFocus.groupId,
      lifecycle: summarizeWebviewLifecycleIdentity(lifecycle)
    });
    this.postMessageToSurface(surface, {
      type: 'host/focusGroup',
      payload: {
        groupId: pendingFocus.groupId
      }
    });
  }

  private clearPendingWorkspaceRootFocusReplay(): void {
    delete this.pendingWorkspaceRootFocusReplay.editor;
    delete this.pendingWorkspaceRootFocusReplay.panel;
  }

  private buildExecutionAttentionNotificationMessage(
    kind: ExecutionNodeKind,
    nodeId: string,
    session: ManagedExecutionSession,
    signal: ExecutionAttentionSignal
  ): string {
    const node = this.state.nodes.find((candidate) => candidate.id === nodeId);
    const executionLabel = kind === 'agent' ? 'Agent' : 'Terminal';
    const nodeLabel = trimStoredTerminalText(node?.title || session.displayLabel || '').trim();
    const displayLabel = nodeLabel || executionLabel;
    const signalMessage = trimStoredTerminalText(signal.message ?? '').trim();

    if (signalMessage) {
      const clippedMessage =
        signalMessage.length > EXECUTION_ATTENTION_NOTIFICATION_TEXT_LIMIT
          ? `${signalMessage.slice(0, EXECUTION_ATTENTION_NOTIFICATION_TEXT_LIMIT)}...`
          : signalMessage;
      return `${executionLabel}「${displayLabel}」: ${clippedMessage}`;
    }

    return signal.kind === 'bel'
      ? `${executionLabel}「${displayLabel}」发出终端提醒。`
      : `${executionLabel}「${displayLabel}」发出终端通知。`;
  }

  private buildAgentAbnormalInterruptionNotificationMessage(
    nodeId: string,
    session: ManagedExecutionSession,
    _status: 'error',
    message: string
  ): string {
    const node = this.state.nodes.find((candidate) => candidate.id === nodeId && candidate.kind === 'agent');
    const providerLabel = agentProviderDisplayLabel(session.agentProvider ?? 'codex');
    const nodeLabel = trimStoredTerminalText(node?.title || session.displayLabel || '').trim() || 'Agent';
    const normalizedMessage = trimStoredTerminalText(message)
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!normalizedMessage) {
      return `${providerLabel} Agent「${nodeLabel}」异常中断。`;
    }

    const clippedMessage =
      normalizedMessage.length > EXECUTION_ATTENTION_NOTIFICATION_TEXT_LIMIT
        ? `${normalizedMessage.slice(0, EXECUTION_ATTENTION_NOTIFICATION_TEXT_LIMIT)}...`
        : normalizedMessage;
    return `${providerLabel} Agent「${nodeLabel}」异常中断：${clippedMessage}`;
  }

  private buildAgentAbnormalStreamInterruptionNotificationMessage(
    nodeId: string,
    session: ManagedExecutionSession,
    message: string
  ): string {
    const node = this.state.nodes.find((candidate) => candidate.id === nodeId && candidate.kind === 'agent');
    const providerLabel = agentProviderDisplayLabel(session.agentProvider ?? 'codex');
    const nodeLabel = trimStoredTerminalText(node?.title || session.displayLabel || '').trim() || 'Agent';
    const normalizedMessage = trimStoredTerminalText(message)
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const clippedMessage =
      normalizedMessage.length > EXECUTION_ATTENTION_NOTIFICATION_TEXT_LIMIT
        ? `${normalizedMessage.slice(0, EXECUTION_ATTENTION_NOTIFICATION_TEXT_LIMIT)}...`
        : normalizedMessage;
    return `${providerLabel} Agent「${nodeLabel}」输出流异常：${clippedMessage}`;
  }

  private recordAgentOutputHeuristicsAndNotifyAbnormalStream(
    nodeId: string,
    session: ManagedExecutionSession,
    chunk: string
  ): void {
    const providerForTextNotifications =
      this.agentAbnormalOutputTextNotificationMode === 'codex' && session.agentProvider === 'codex'
        ? session.agentProvider
        : undefined;
    const state = this.ensureAgentActivityState(session);
    const snapshot = recordAgentOutputHeuristics(state, chunk, session.buffer, providerForTextNotifications);
    if (snapshot.sawAbnormalStreamInterruption && snapshot.abnormalStreamInterruptionMessage) {
      void this.markAndNotifyAgentAbnormalStreamInterruption(
        nodeId,
        session,
        snapshot.abnormalStreamInterruptionMessage
      );
    }
    this.syncAgentExecutionStateForInjectedOutput(nodeId, session);
  }

  private syncAgentExecutionStateForInjectedOutput(
    nodeId: string,
    session: ManagedExecutionSession
  ): void {
    if (session.owner !== 'local' || session.process.processName !== 'test-agent-output-injection') {
      return;
    }

    this.state = updateAgentNode(this.state, nodeId, {
      status: session.lifecycleStatus as AgentNodeStatus,
      summary: summarizeAgentSessionOutput(
        session.buffer,
        session.lifecycleStatus as AgentNodeStatus,
        agentProviderDisplayLabel(session.agentProvider ?? 'codex')
      ),
      metadata: buildAgentMetadataPatch(this.state, nodeId, {
        provider: session.agentProvider ?? 'codex',
        lifecycle: session.lifecycleStatus as AgentNodeStatus,
        recentOutput: extractRecentTerminalOutput(session.buffer) || undefined,
        liveSession: false,
        pendingLaunch: undefined
      })
    });
    this.persistState();
    this.postState('host/stateUpdated');
  }

  private recordAgentOutputActivity(
    nodeId: string,
    session: ManagedExecutionSession,
    chunk: string
  ): void {
    this.recordAgentOutputHeuristicsAndNotifyAbnormalStream(nodeId, session, chunk);
    if (isAgentLifecycleAwaitingInteractiveState(session.lifecycleStatus)) {
      this.scheduleAgentInteractiveStateEvaluation(nodeId);
    }
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
        void this.maybeDiscoverAgentResumeContextFromFiles(nodeId, current, 'waiting-input');
        this.flushLiveExecutionState('agent', nodeId, {
          persistMode: 'immediate',
          persistReason: 'agent-waiting-input'
        });
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
    displayLaunchCommandLine: string,
    launchArgs: string[],
    resumeContext: AgentResumeContext,
    launchMode: PendingExecutionLaunch
  ): Promise<void> {
    const operationToken = this.beginExecutionSessionOperation('agent', nodeId);
    const existingNode = this.requireNode(nodeId, 'agent');
    const existingMetadata = ensureAgentMetadata(existingNode);
    const cwd = this.getExecutionNodeCwd(existingNode, 'agent');
    const executionEnv = await this.resolveExecutionEnvironment('agent', cwd);
    await this.disposeAgentFileActivitySession(nodeId);
    const fileActivitySession = this.createConfiguredAgentFileActivitySession(provider, cliSpec.command);
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
        outputSequence: undefined,
        lastCols: normalizedCols,
        lastRows: normalizedRows,
        serializedTerminalState: undefined,
        preSuspendLifecycle: undefined,
        lastSuspendReason: undefined,
        lastSuspendMessage: undefined,
        lastReactivateError: undefined,
        lastBackendLabel: cliSpec.label,
        lastLaunchCommandLine: displayLaunchCommandLine
      })
    });
    this.persistState({ reason: 'agent-supervisor-launching' });
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
      this.unbindRuntimeSession(
        previousRuntimeSessionId,
        existingMetadata.runtimeStoragePath,
        'agent',
        normalizeRuntimeHostBackendKind(existingMetadata.runtimeBackend)
      );
    }

    const launchSpec = this.buildAgentLaunchSpec(
      cliSpec,
      launchArgs,
      cwd,
      normalizedCols,
      normalizedRows,
      executionEnv,
      launchMode,
      resumeContext,
      fileActivitySession
    );
    let snapshot: RuntimeSupervisorSessionSnapshot;
    try {
      snapshot = await client.createSession({
        kind: 'agent',
        displayLabel: cliSpec.label,
        launchMode,
        scrollback: this.getTerminalScrollback(),
        provider,
        resumeStrategy: resumeContext.strategy,
        resumeSessionId: resumeContext.sessionId,
        resumeStoragePath: resumeContext.storagePath,
        launchSpec: serializeExecutionSessionLaunchSpec(launchSpec)
      });
    } catch (error) {
      await fileActivitySession.dispose();
      throw error;
    }
    if (!this.shouldApplyRuntimeCreateResult('agent', nodeId, operationToken, backend.kind)) {
      this.recordIgnoredExecutionSessionOperation('agent', nodeId, 'create', snapshot.sessionId);
      await fileActivitySession.dispose();
      await this.deleteRuntimeSupervisorSessionBestEffort(client, snapshot.sessionId);
      return;
    }

    this.bindRuntimeSession(nodeId, 'agent', snapshot.sessionId, runtimeStoragePath, backend.kind);
    this.bindAgentFileActivitySession(nodeId, fileActivitySession);
    this.recordDiagnosticEvent('execution/started', {
      kind: 'agent',
      nodeId,
      sessionId: snapshot.sessionId,
      provider,
      launchMode,
      launchCommandLine: displayLaunchCommandLine,
      requestedCommand: cliSpec.requestedCommand,
      launchArgs: launchSpec.args,
      cols: normalizedCols,
      rows: normalizedRows,
      shellPath: cliSpec.command,
      cwd,
      resumeStrategy: resumeContext.strategy,
      resumeSessionId: resumeContext.sessionId ?? null,
      resumeStoragePath: resumeContext.storagePath ?? null,
      runtimeBackend: backend.kind,
      runtimeGuarantee: backend.guarantee
    });
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
    const cwd = this.getExecutionNodeCwd(existingNode, 'terminal');
    const executionEnv = await this.resolveExecutionEnvironment('terminal', cwd);
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
        outputSequence: undefined,
        serializedTerminalState: undefined
      })
    });
    this.persistState({ reason: 'terminal-supervisor-launching' });
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
      this.unbindRuntimeSession(
        previousRuntimeSessionId,
        existingMetadata.runtimeStoragePath,
        'terminal',
        normalizeRuntimeHostBackendKind(existingMetadata.runtimeBackend)
      );
    }

    const snapshot = await client.createSession({
      kind: 'terminal',
      displayLabel: shellPath,
      launchMode: 'start',
      scrollback: this.getTerminalScrollback(),
      launchSpec: serializeExecutionSessionLaunchSpec(
        this.buildTerminalLaunchSpec(shellPath, cwd, normalizedCols, normalizedRows, executionEnv)
      )
    });
    if (!this.shouldApplyRuntimeCreateResult('terminal', nodeId, operationToken, backend.kind)) {
      this.recordIgnoredExecutionSessionOperation('terminal', nodeId, 'create', snapshot.sessionId);
      await this.deleteRuntimeSupervisorSessionBestEffort(client, snapshot.sessionId);
      return;
    }

    this.bindRuntimeSession(nodeId, 'terminal', snapshot.sessionId, runtimeStoragePath, backend.kind);
    this.recordDiagnosticEvent('execution/started', {
      kind: 'terminal',
      nodeId,
      sessionId: snapshot.sessionId,
      cols: normalizedCols,
      rows: normalizedRows,
      shellPath,
      cwd,
      runtimeBackend: backend.kind,
      runtimeGuarantee: backend.guarantee
    });
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
    const cwd = this.getExecutionNodeCwd(agentNode, 'agent');
    const cwdUnavailableMessage = this.describeUnavailableExecutionCwd(cwd);
    if (cwdUnavailableMessage) {
      this.recordDiagnosticEvent('execution/startRejected', {
        kind: 'agent',
        nodeId,
        reason: 'cwd-unavailable',
        cwd,
        message: cwdUnavailableMessage
      });
      this.state = updateAgentNode(this.state, nodeId, {
        status: 'error',
        summary: cwdUnavailableMessage,
        metadata: buildAgentMetadataPatch(this.state, nodeId, {
          lifecycle: 'error',
          liveSession: false,
          pendingLaunch: undefined,
          lastExitMessage: cwdUnavailableMessage,
          lastRuntimeError: cwdUnavailableMessage
        })
      });
      this.persistState();
      this.postState('host/stateUpdated');
      this.postMessage({
        type: 'host/error',
        payload: {
          message: cwdUnavailableMessage
        }
      });
      return;
    }
    const provider = requestedProvider ?? currentMetadata.provider;
    const launchMode: PendingExecutionLaunch = resumeRequested ? 'resume' : 'start';
    let freshLaunch:
      | {
          commandLine: string;
          requestedCommand: string;
          launchArgs: string[];
          launchPreset: AgentLaunchPresetKind;
        }
      | undefined;
    if (launchMode === 'start') {
      try {
        freshLaunch = this.resolveAgentFreshLaunch(provider, currentMetadata);
      } catch (error) {
        const message = error instanceof Error ? error.message : '无法解析 Agent 启动命令。';
        this.recordDiagnosticEvent('execution/startRejected', {
          kind: 'agent',
          nodeId,
          reason: 'invalid-launch-command',
          message
        });
        this.state = updateAgentNode(this.state, nodeId, {
          status: 'error',
          summary: message,
          metadata: buildAgentMetadataPatch(this.state, nodeId, {
            provider,
            lifecycle: 'error',
            liveSession: false,
            pendingLaunch: undefined,
            lastExitMessage: message,
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
        return;
      }
    }
    const configuredCliSpec = this.getRequestedAgentCliSpec(
      provider,
      freshLaunch?.requestedCommand ?? this.getAgentLaunchDefaults(provider).command
    );
    let cliSpec = configuredCliSpec;
    const resumeContext = this.resolveAgentResumeContext(
      nodeId,
      provider,
      launchMode,
      currentMetadata,
      freshLaunch?.launchArgs ?? []
    );
    const displayLaunchCommandLine = this.buildAgentDisplayLaunchCommandLine({
      provider,
      requestedCommand: configuredCliSpec.requestedCommand,
      launchMode,
      freshLaunchCommandLine: freshLaunch?.commandLine,
      resumeContext
    });
    this.recordDiagnosticEvent('execution/startRequested', {
      kind: 'agent',
      nodeId,
      provider,
      resumeRequested,
      launchPreset: freshLaunch?.launchPreset ?? currentMetadata.launchPreset,
      launchCommandLine: displayLaunchCommandLine,
      requestedCommand: freshLaunch?.requestedCommand ?? null,
      launchArgs: freshLaunch?.launchArgs ?? [],
      cols: normalizedCols,
      rows: normalizedRows,
      cwd,
      workspaceTrusted: vscode.workspace.isTrusted
    });
    const lifecycleStatus: AgentNodeStatus = launchMode === 'resume' ? 'resuming' : 'starting';
    if (this.isRuntimePersistenceEnabled()) {
      try {
        cliSpec = await this.resolveAgentCli(provider, freshLaunch?.requestedCommand, cwd);
        await this.startAgentSessionWithSupervisor(
          nodeId,
          normalizedCols,
          normalizedRows,
          provider,
          cliSpec,
          displayLaunchCommandLine,
          freshLaunch?.launchArgs ?? [],
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
          cwd,
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
            cwd,
            lastExitMessage: message,
            lastCols: normalizedCols,
            lastRows: normalizedRows,
            serializedTerminalState: undefined,
            lastBackendLabel: cliSpec.label,
            lastLaunchCommandLine: displayLaunchCommandLine,
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
        this.promptAgentCliSelectionAfterCommandNotFound(provider, error);
      }
      return;
    }
    const sessionId = createExecutionSessionId(nodeId, 'agent');
    const executionEnv = await this.resolveExecutionEnvironment('agent', cwd);
    await this.disposeAgentFileActivitySession(nodeId);

    try {
      cliSpec = await this.resolveAgentCli(provider, freshLaunch?.requestedCommand, cwd);
      const fileActivitySession = this.createConfiguredAgentFileActivitySession(provider, cliSpec.command);
      const launchSpec = this.buildAgentLaunchSpec(
        cliSpec,
        freshLaunch?.launchArgs ?? [],
        cwd,
        normalizedCols,
        normalizedRows,
        executionEnv,
        launchMode,
        resumeContext,
        fileActivitySession
      );
      const process = createExecutionSessionProcess(launchSpec);

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
        outputSequence: 0,
        outputFlushTimer: undefined,
        displayLabel: cliSpec.label,
        lifecycleStatus,
        launchMode,
        resumePhaseActive: launchMode === 'resume',
        agentProvider: provider,
        agentResume: resumeContext,
        agentActivity: createAgentActivityHeuristicState(),
        attentionSignalState: this.createExecutionAttentionNotificationState(),
        outputSubscription: undefined,
        exitSubscription: undefined
      };
      activeSessions.set(nodeId, session);
      this.bindAgentFileActivitySession(nodeId, fileActivitySession);

      const handleSessionChunk = (text: string): void => {
        const startedAt = Date.now();
        const sessionMap = this.getExecutionSessions('agent');
        const activeSession = sessionMap.get(nodeId);
        if (!activeSession) {
          return;
        }

        if (!text) {
          return;
        }

        activeSession.outputSequence += 1;
        activeSession.buffer = appendTerminalBuffer(activeSession.buffer, text);
        activeSession.terminalStateTracker.write(text);
        activeSession.lineContextTracker.write(text);
        void this.bridgeExecutionAttentionSignals('agent', nodeId, activeSession, text);
        this.maybeSyncAgentResumeContextFromOutput(nodeId, activeSession, {
          allowOverwriteExisting: activeSession.stopRequested,
          flushImmediately: activeSession.stopRequested
        });
        if (shouldRecordAgentOutputHeuristics(activeSession.lifecycleStatus)) {
          this.recordAgentOutputActivity(nodeId, activeSession, text);
        }
        this.queueExecutionStateSync('agent', nodeId);
        this.queueExecutionOutput('agent', nodeId, text);
        this.recordExecutionPerformanceDiagnostics({
          timestamp: new Date().toISOString(),
          source: 'host-output-chunk',
          nodeId,
          kind: 'agent',
          owner: activeSession.owner,
          lifecycleStatus: activeSession.lifecycleStatus,
          durationMs: Date.now() - startedAt,
          characters: text.length,
          bytes: Buffer.byteLength(text, 'utf8'),
          sequence: activeSession.outputSequence,
          bufferLength: activeSession.buffer.length,
          pendingOutputLength: activeSession.pendingOutput.length
        });
      };

      const finalize = async (
        status: 'stopped' | 'error' | 'resume-failed',
        message: string,
        exitCode?: number,
        signal?: string
      ): Promise<void> => {
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
        await this.disposeAgentFileActivitySession(nodeId);

        const cleanedOutput = stripTerminalControlSequences(activeSession.buffer);
        const recentOutput = extractRecentTerminalOutput(cleanedOutput);
        this.finalizeAgentResumeContextFromOutput(nodeId, activeSession);
        const finalizedResumeContext = activeSession.agentResume ?? resumeContext;
        const serializedTerminalState = await activeSession.terminalStateTracker
          .flush()
          .catch(() => activeSession.terminalStateTracker.getSerializedState());

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
            resumeSupported: finalizedResumeContext.supported,
            resumeStrategy: finalizedResumeContext.strategy,
            resumeSessionId: finalizedResumeContext.sessionId,
            resumeStoragePath: finalizedResumeContext.storagePath,
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
            outputSequence: activeSession.outputSequence,
            lastExitCode: exitCode,
            lastExitSignal: signal ?? undefined,
            lastExitMessage: message,
            lastCols: activeSession.cols,
            lastRows: activeSession.rows,
            serializedTerminalState,
            preSuspendLifecycle: undefined,
            lastSuspendReason: undefined,
            lastSuspendMessage: undefined,
            lastReactivateError: undefined,
            lastBackendLabel: cliSpec.label
          })
        });
        this.disposeManagedExecutionSession(activeSession);
        this.persistState();
        this.postState('host/stateUpdated');
        await this.postExecutionExitWithFinalSnapshot('agent', nodeId, message);
        if (status === 'error') {
          await this.markAndNotifyAgentAbnormalInterruption(nodeId, activeSession, status, message, {
            exitCode: exitCode ?? null,
            signal: signal ?? null,
            launchMode: activeSession.launchMode,
            reason: 'process-exit'
          });
        }
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
          void finalize('stopped', `已停止 ${cliSpec.label} 会话。`, exitCode, signal);
          return;
        }

        if (exitCode === 0) {
          void finalize('stopped', `${cliSpec.label} 会话已结束。`, exitCode, signal);
          return;
        }

        const cleanedOutput = stripTerminalControlSequences(session.buffer);
        if (session.resumePhaseActive) {
          void finalize(
            'resume-failed',
            describeAgentResumeFailure(cliSpec, exitCode, signal, cleanedOutput),
            exitCode,
            signal
          );
          return;
        }

        void finalize(
          'error',
          describeAgentSessionExit(cliSpec, exitCode, signal, cleanedOutput),
          exitCode,
          signal
        );
      });

      this.recordDiagnosticEvent('execution/started', {
        kind: 'agent',
        nodeId,
        sessionId,
        provider,
        launchMode,
        launchPreset: freshLaunch?.launchPreset ?? currentMetadata.launchPreset,
        launchCommandLine: displayLaunchCommandLine,
        requestedCommand: freshLaunch?.requestedCommand ?? null,
        launchArgs: launchSpec.args,
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
          outputSequence: undefined,
          lastExitCode: undefined,
          lastExitSignal: undefined,
          lastExitMessage: undefined,
          lastCols: normalizedCols,
          lastRows: normalizedRows,
          serializedTerminalState: undefined,
          preSuspendLifecycle: undefined,
          lastSuspendReason: undefined,
          lastSuspendMessage: undefined,
          lastReactivateError: undefined,
          lastBackendLabel: cliSpec.label,
          lastLaunchCommandLine: displayLaunchCommandLine
        })
      });
      this.persistState();
      this.postState('host/stateUpdated');
      this.postExecutionSnapshot('agent', nodeId, {
        executionSessionId: session.sessionId
      });
      void this.maybeDiscoverAgentResumeContextFromFiles(nodeId, session, 'startup');
    } catch (error) {
      await this.disposeAgentFileActivitySession(nodeId);
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
        cwd,
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
      this.promptAgentCliSelectionAfterCommandNotFound(provider, error);
    }
  }

  private promptAgentCliSelectionAfterCommandNotFound(provider: AgentProviderKind, error: unknown): void {
    if (
      isTestHarnessMode(this.context.extensionMode) ||
      !isAgentCliCommandNotFoundLaunchError(error)
    ) {
      return;
    }

    const command = provider === 'claude' ? COMMAND_IDS.selectClaudeCli : COMMAND_IDS.selectCodexCli;
    this.recordDiagnosticEvent('agentCli/selectionPromptRequested', {
      provider,
      reason: isAgentCliResolutionError(error) ? 'resolution-failed' : 'spawn-enoent'
    });
    void vscode.commands.executeCommand(command);
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
    const codexDefaultArgs = getConfigurationValue<string>('agentCodexDefaultArgs', '').trim();
    const claudeDefaultArgs = getConfigurationValue<string>('agentClaudeDefaultArgs', '').trim();

    const codexCommand =
      isTestHarnessMode(this.context.extensionMode)
        ? process.env.DEV_SESSION_CANVAS_TEST_CODEX_COMMAND?.trim() || configuredCodexCommand
        : configuredCodexCommand;
    const claudeCommand =
      isTestHarnessMode(this.context.extensionMode)
        ? process.env.DEV_SESSION_CANVAS_TEST_CLAUDE_COMMAND?.trim() || configuredClaudeCommand
        : configuredClaudeCommand;

    return {
      defaultProvider: defaultProvider === 'claude' ? 'claude' : 'codex',
      codexCommand,
      claudeCommand,
      codexDefaultArgs,
      claudeDefaultArgs
    };
  }

  private getAgentLaunchDefaults(provider: AgentProviderKind): AgentProviderLaunchDefaults {
    const configuration = this.getAgentCliConfig();
    return provider === 'claude'
      ? {
          command: configuration.claudeCommand,
          defaultArgs: configuration.claudeDefaultArgs
        }
      : {
          command: configuration.codexCommand,
          defaultArgs: configuration.codexDefaultArgs
        };
  }

  private getAgentLaunchDefaultsByProvider(): AgentLaunchDefaultsByProvider {
    return {
      codex: this.getAgentLaunchDefaults('codex'),
      claude: this.getAgentLaunchDefaults('claude')
    };
  }

  private getRequestedAgentCliSpec(provider: AgentProviderKind, requestedCommand: string): AgentCliSpec {
    const label = provider === 'claude' ? 'Claude Code' : 'Codex';
    return {
      provider,
      label,
      requestedCommand,
      command: requestedCommand,
      resolutionSource: 'path-env'
    };
  }

  private validateAgentFreshLaunchCommand(
    provider: AgentProviderKind,
    launchPreset: AgentLaunchPresetKind,
    customLaunchCommand: string | undefined,
    defaults: AgentProviderLaunchDefaults,
    templateArgv?: readonly string[]
  ): {
    commandLine: string;
    requestedCommand: string;
    launchArgs: string[];
  } {
    if (launchPreset === 'custom' && !customLaunchCommand?.trim() && templateArgv === undefined) {
      throw new Error('自定义启动命令不能为空。');
    }

    const commandLine =
      templateArgv !== undefined
        ? formatCommandLine([defaults.command.trim() || provider, ...normalizeStoredAgentTemplateArgv(templateArgv)])
        : buildFreshAgentCommandLine(provider, launchPreset, customLaunchCommand, defaults);
    const validation = validateAgentCommandLine(commandLine, provider, defaults);
    if (!validation.valid || !validation.parsed) {
      throw new Error(validation.error ?? '无法解析 Agent 启动命令。');
    }

    return {
      commandLine,
      requestedCommand: validation.parsed.command,
      launchArgs: validation.parsed.args
    };
  }

  private resolveAgentFreshLaunch(
    provider: AgentProviderKind,
    metadata: AgentNodeMetadata
  ): {
    commandLine: string;
    requestedCommand: string;
    launchArgs: string[];
    launchPreset: AgentLaunchPresetKind;
  } {
    const defaults = this.getAgentLaunchDefaults(provider);
    const parsed = this.validateAgentFreshLaunchCommand(
      provider,
      metadata.launchPreset,
      metadata.customLaunchCommand,
      defaults,
      metadata.templateArgv
    );
    return {
      commandLine: parsed.commandLine,
      requestedCommand: parsed.requestedCommand,
      launchArgs: parsed.launchArgs,
      launchPreset: metadata.launchPreset
    };
  }

  private buildAgentDisplayLaunchCommandLine(params: {
    provider: AgentProviderKind;
    requestedCommand: string;
    launchMode: PendingExecutionLaunch;
    freshLaunchCommandLine?: string;
    resumeContext: AgentResumeContext;
  }): string {
    if (params.launchMode === 'start') {
      return params.freshLaunchCommandLine?.trim() || params.requestedCommand.trim();
    }

    if (params.provider === 'claude') {
      return formatCommandLine(
        params.resumeContext.sessionId
          ? [params.requestedCommand, '--resume', params.resumeContext.sessionId]
          : [params.requestedCommand, '--resume']
      );
    }

    return formatCommandLine(
      params.resumeContext.sessionId
        ? [params.requestedCommand, 'resume', params.resumeContext.sessionId]
        : [params.requestedCommand, 'resume']
    );
  }

  private buildHistoryResumeCommandLine(provider: AgentProviderKind, sessionId: string): string {
    return buildAgentHistoryResumeCommandLine(
      provider,
      sessionId,
      this.getAgentLaunchDefaults(provider)
    );
  }

  private buildAgentBranchCommandLine(provider: AgentProviderKind, sessionId: string): string {
    return buildAgentProviderBranchCommandLine(
      provider,
      sessionId,
      this.getAgentLaunchDefaults(provider)
    );
  }

  private getAgentCliResolutionAuthority(): string {
    return this.getTerminalShellPath();
  }

  private getAgentCliResolutionCacheKey(
    provider: AgentProviderKind,
    requestedCommand: string,
    workspaceCwd?: string,
    shellAuthority: string = this.getAgentCliResolutionAuthority()
  ): string {
    const normalizedCommand =
      process.platform === 'win32' ? requestedCommand.trim().toLowerCase() : requestedCommand.trim();
    const normalizedShellAuthority = normalizeAgentCliCacheAuthority(shellAuthority, workspaceCwd);
    const normalizedWorkspaceCwd = normalizeAgentCliCacheWorkspaceCwd(workspaceCwd);
    // The execution env can be cwd-sensitive through direnv, Nix, or repo-local shell hooks.
    return `${process.platform}:${provider}:${normalizedShellAuthority}:${normalizedWorkspaceCwd}:${normalizedCommand}`;
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
  }

  private clearAgentCliResolution(
    provider: AgentProviderKind,
    requestedCommand: string,
    workspaceCwd?: string
  ): void {
    delete this.agentCliResolutionCache[
      this.getAgentCliResolutionCacheKey(provider, requestedCommand, workspaceCwd)
    ];
  }

  private clearAgentCliResolutionCache(): void {
    const cacheKeys = Object.keys(this.agentCliResolutionCache);
    if (cacheKeys.length === 0) {
      return;
    }

    for (const cacheKey of cacheKeys) {
      delete this.agentCliResolutionCache[cacheKey];
    }
  }

  private async resolveAgentCli(
    provider: AgentProviderKind,
    requestedCommand?: string,
    cwd: string = this.getTerminalWorkingDirectory()
  ): Promise<AgentCliSpec> {
    const executionEnv = await this.resolveExecutionEnvironment('agent', cwd);
    const configuredSpec = this.getRequestedAgentCliSpec(
      provider,
      requestedCommand?.trim() || this.getAgentLaunchDefaults(provider).command
    );
    const workspaceCwd = cwd;

    try {
      const resolution = await resolveAgentCliCommand({
        provider,
        label: configuredSpec.label,
        requestedCommand: configuredSpec.requestedCommand,
        workspaceCwd,
        env: executionEnv,
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
        cwd: workspaceCwd,
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
          cwd: workspaceCwd,
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
    return this.resolveTerminalShellPathForConfigurationCwd(getConfiguredTerminalShell().resolvedPath);
  }

  private resolveTerminalShellPathForConfigurationCwd(shellPath: string): string {
    return resolveTerminalShellPathForConfigurationCwd(shellPath, this.getTerminalWorkingDirectory());
  }

  private getTerminalInheritEnv(): boolean {
    return getConfiguredTerminalInheritEnv();
  }

  private getTerminalShellArgs(): string[] {
    return getConfiguredTerminalShellArgs();
  }

  private buildDebugConfigurationSnapshot(
    shellEnvironmentPatch = this.resolvedShellEnvironmentPatches.get(
      this.getShellEnvironmentPatchCacheKey('interactive-login', this.getTerminalWorkingDirectory())
    )
  ): CanvasDebugConfigurationSnapshot {
    const configuredTerminalShell = getConfiguredTerminalShell();
    return {
      linkOpenMode: this.getCanvasLinkOpenMode(),
      terminalShellPath: this.resolveTerminalShellPathForConfigurationCwd(configuredTerminalShell.resolvedPath),
      terminalShellPathOverride: configuredTerminalShell.configuredPath || undefined,
      terminalShellResolutionSource: configuredTerminalShell.resolutionSource,
      terminalInheritEnv: this.getTerminalInheritEnv(),
      terminalShellArgs: this.getTerminalShellArgs(),
      terminalShellSetting:
        configuredTerminalShell.configuredShell !== 'default' ? configuredTerminalShell.configuredShell : undefined,
      executionShellEnvPatchSource: shellEnvironmentPatch?.source,
      executionShellEnvPatchShellFamily: shellEnvironmentPatch?.shellFamily,
      executionShellEnvPatchProbeMode: shellEnvironmentPatch?.probeMode,
      executionShellEnvPatchSkipReason: shellEnvironmentPatch?.skippedReason,
      executionShellEnvPatchShellPath: shellEnvironmentPatch?.shellPath,
      executionShellEnvPatchAppliedKeys: shellEnvironmentPatch?.appliedKeys,
      executionShellEnvPatchError: shellEnvironmentPatch?.error
    };
  }

  private getTerminalWorkingDirectory(): string {
    return this.getWorkspaceRoot() ?? defaultTerminalWorkingDirectory();
  }

  private getExecutionNodeCwd(node: CanvasNodeSummary, kind: ExecutionNodeKind): string {
    const metadata = kind === 'agent' ? ensureAgentMetadata(node) : ensureTerminalMetadata(node);
    const metadataCwd = normalizeExecutionCwd(metadata.cwd);
    if (metadataCwd) {
      const validation = this.validateExecutionCwd(metadataCwd, { allowLegacyDefaultCwd: true });
      if (validation.valid) {
        return validation.cwd;
      }
    }

    return metadataCwd ?? this.getTerminalWorkingDirectory();
  }

  private isLegacyDefaultExecutionCwd(cwd: string): boolean {
    const legacyDefaultCwd = normalizeExecutionCwd(defaultTerminalWorkingDirectory());
    return Boolean(
      legacyDefaultCwd &&
        areSameExecutionPath(cwd, legacyDefaultCwd) &&
        !this.resolveExecutionWorkspaceFolder(cwd)
    );
  }

  private getPrioritizedBaseExecutionPathEntries(cwd: string = this.getTerminalWorkingDirectory()): string[] {
    if (!isTestHarnessMode(this.context.extensionMode)) {
      return [];
    }

    const commandDirectories = new Set<string>();
    for (const command of [
      process.env.DEV_SESSION_CANVAS_TEST_CODEX_COMMAND,
      process.env.DEV_SESSION_CANVAS_TEST_CLAUDE_COMMAND
    ]) {
      const trimmedCommand = command?.trim();
      if (!trimmedCommand) {
        continue;
      }

      if (path.isAbsolute(trimmedCommand)) {
        commandDirectories.add(path.dirname(trimmedCommand));
        continue;
      }

      if (isExplicitRelativePath(trimmedCommand)) {
        commandDirectories.add(path.dirname(path.resolve(cwd, trimmedCommand)));
      }
    }

    return Array.from(commandDirectories);
  }

  private buildBaseExecutionEnvironment(cwd: string = this.getTerminalWorkingDirectory()): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      TERM: process.env.TERM?.trim() || (process.platform === 'win32' ? 'xterm-color' : 'xterm-256color'),
      COLORTERM: process.env.COLORTERM?.trim() || 'truecolor'
    };

    const prioritizedPathEntries = this.getPrioritizedBaseExecutionPathEntries(cwd);
    if (prioritizedPathEntries.length > 0) {
      const existingPathEntries = (env.PATH ?? '').split(path.delimiter).filter(Boolean);
      env.PATH = Array.from(new Set([...prioritizedPathEntries, ...existingPathEntries])).join(path.delimiter);
    }

    if (process.platform === 'win32') {
      env.SystemRoot = process.env.SystemRoot?.trim() || process.env.SYSTEMROOT?.trim() || 'C:\\Windows';
    }

    return env;
  }

  private async resolveExecutionEnvironment(
    target: 'agent' | 'terminal',
    cwd: string = this.getTerminalWorkingDirectory()
  ): Promise<NodeJS.ProcessEnv> {
    const baseEnv = this.buildBaseExecutionEnvironment(cwd);
    if (
      !shouldResolveShellEnvironmentPatchForExecutionTarget(target, process.platform, {
        terminalInheritEnv: this.getTerminalInheritEnv()
      })
    ) {
      return baseEnv;
    }

    const shellEnvironmentPatch = await this.getResolvedShellEnvironmentPatch(
      baseEnv,
      this.getShellEnvironmentProbeMode(target),
      cwd
    );
    return applyShellEnvironmentPatch(baseEnv, shellEnvironmentPatch.envPatch, process.platform, {
      prioritizedBasePathEntries: this.getPrioritizedBaseExecutionPathEntries(cwd)
    });
  }

  public async resolveAgentSettingsFileEnvironment(): Promise<{ env: NodeJS.ProcessEnv; cwd: string }> {
    return {
      env: await this.resolveExecutionEnvironment('agent'),
      cwd: this.getTerminalWorkingDirectory()
    };
  }

  private getShellEnvironmentProbeMode(target: 'agent' | 'terminal'): ShellEnvironmentProbeMode {
    return target === 'terminal' && process.platform !== 'win32' ? 'login' : 'interactive-login';
  }

  private invalidateResolvedShellEnvironmentPatch(): void {
    this.resolvedShellEnvironmentPatchPromises.clear();
    this.resolvedShellEnvironmentPatches.clear();
  }

  private getResolvedShellEnvironmentPatch(
    baseEnv: NodeJS.ProcessEnv,
    probeMode: ShellEnvironmentProbeMode = 'interactive-login',
    cwd: string = this.getTerminalWorkingDirectory()
  ): Promise<ResolvedShellEnvironmentPatch> {
    const cacheKey = this.getShellEnvironmentPatchCacheKey(probeMode, cwd);
    const existingPromise = this.resolvedShellEnvironmentPatchPromises.get(cacheKey);
    if (!existingPromise) {
      const shellPath = this.getTerminalShellPath();
      const nextPromise = resolveShellEnvironmentPatch({
        env: baseEnv,
        shellPath,
        cwd,
        probeMode
      }).then((result) => {
        this.resolvedShellEnvironmentPatches.set(cacheKey, result);
        if (result.source !== 'none') {
          this.recordDiagnosticEvent('executionEnvironment/shellEnvPatchResolved', {
            source: result.source,
            shellFamily: result.shellFamily,
            probeMode: result.probeMode,
            shellPath: result.shellPath,
            cwd,
            appliedKeys: result.appliedKeys
          });
        } else if (result.skippedReason === 'shell-resolution-failed') {
          this.recordDiagnosticEvent('executionEnvironment/shellEnvPatchFailed', {
            source: result.source,
            shellFamily: result.shellFamily,
            probeMode: result.probeMode,
            skippedReason: result.skippedReason,
            shellPath: result.shellPath,
            cwd,
            error: result.error
          });
        } else {
          this.recordDiagnosticEvent('executionEnvironment/shellEnvPatchSkipped', {
            source: result.source,
            shellFamily: result.shellFamily,
            probeMode: result.probeMode,
            skippedReason: result.skippedReason,
            shellPath: result.shellPath,
            cwd
          });
        }
        return result;
      });
      this.resolvedShellEnvironmentPatchPromises.set(cacheKey, nextPromise);
      return nextPromise;
    }

    return existingPromise;
  }

  private getShellEnvironmentPatchCacheKey(probeMode: ShellEnvironmentProbeMode, cwd: string): string {
    const normalizedCwd = process.platform === 'win32' ? path.resolve(cwd).toLowerCase() : path.resolve(cwd);
    return `${probeMode}\u0000${normalizedCwd}`;
  }

  private buildTerminalLaunchSpec(
    shellPath: string,
    cwd: string,
    cols: number,
    rows: number,
    env: NodeJS.ProcessEnv
  ): ExecutionSessionLaunchSpec {
    return {
      file: shellPath,
      args: this.getTerminalShellArgs(),
      cwd,
      cols,
      rows,
      env
    };
  }

  private buildAgentLaunchSpec(
    spec: AgentCliSpec,
    launchArgs: string[],
    cwd: string,
    cols: number,
    rows: number,
    env: NodeJS.ProcessEnv,
    launchMode: PendingExecutionLaunch,
    resumeContext: AgentResumeContext,
    fileActivitySession?: AgentFileActivitySession
  ): ExecutionSessionLaunchSpec {
    const args: string[] = launchMode === 'start' ? [...launchArgs] : [];

    if (looksLikeFakeAgentProviderCommand(spec.command)) {
      env[FAKE_PROVIDER_STOP_HINT_STYLE_ENV_KEY] = spec.provider;
    }

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
      const hasExplicitClaudeSessionFlag = Boolean(extractClaudeCommandRuntimeSessionFlag(launchArgs));
      if (launchMode === 'resume' && resumeContext.sessionId) {
        args.push('--resume', resumeContext.sessionId);
      } else if (resumeContext.sessionId && isClaudeForkSessionLaunch(launchArgs) && !hasExplicitClaudeSessionFlag) {
        args.push('--session-id', resumeContext.sessionId);
      } else if (resumeContext.sessionId && !hasExplicitClaudeSessionFlag) {
        args.push('--session-id', resumeContext.sessionId);
      }
    } else if (launchMode === 'resume') {
      if (!resumeContext.sessionId) {
        throw new Error('缺少可恢复的 Codex 会话标识。');
      }
      args.push('resume', resumeContext.sessionId);
    }

    if (fileActivitySession) {
      args.push(...fileActivitySession.extraArgs);
      Object.assign(env, fileActivitySession.extraEnv);
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
      this.dropPendingTerminalInitialInput(nodeId, '当前 workspace 未受信任，安装命令未写入。');
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
      this.dropPendingTerminalInitialInput(nodeId, '未找到可启动的终端节点，安装命令未写入。');
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
      this.dropPendingTerminalInitialInput(nodeId, '该终端已在运行中，安装命令未写入。');
      return;
    }

    const shellPath = this.getTerminalShellPath();
    const currentMetadata = ensureTerminalMetadata(terminalNode);
    const cwd = this.getExecutionNodeCwd(terminalNode, 'terminal');
    const cwdUnavailableMessage = this.describeUnavailableExecutionCwd(cwd);
    if (cwdUnavailableMessage) {
      this.recordDiagnosticEvent('execution/startRejected', {
        kind: 'terminal',
        nodeId,
        reason: 'cwd-unavailable',
        cwd,
        message: cwdUnavailableMessage
      });
      this.state = updateTerminalNode(this.state, nodeId, {
        status: 'error',
        summary: cwdUnavailableMessage,
        metadata: buildTerminalMetadataPatch(this.state, nodeId, {
          lifecycle: 'error',
          liveSession: false,
          pendingLaunch: undefined,
          lastExitMessage: cwdUnavailableMessage,
          lastRuntimeError: cwdUnavailableMessage
        })
      });
      this.persistState();
      this.postState('host/stateUpdated');
      this.postMessage({
        type: 'host/error',
        payload: {
          message: cwdUnavailableMessage
        }
      });
      this.dropPendingTerminalInitialInput(nodeId, cwdUnavailableMessage);
      return;
    }
    this.recordDiagnosticEvent('execution/startRequested', {
      kind: 'terminal',
      nodeId,
      cols: normalizedCols,
      rows: normalizedRows,
      cwd,
      workspaceTrusted: vscode.workspace.isTrusted
    });
    if (this.isRuntimePersistenceEnabled()) {
      try {
        await this.startTerminalSessionWithSupervisor(nodeId, normalizedCols, normalizedRows);
        await this.flushPendingTerminalInitialInput(nodeId);
      } catch (error) {
        const message = describeEmbeddedTerminalSpawnError(shellPath, error);
        this.recordDiagnosticEvent('execution/spawnError', {
          kind: 'terminal',
          nodeId,
          cols: normalizedCols,
          rows: normalizedRows,
          cwd,
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
        this.dropPendingTerminalInitialInput(nodeId, message);
      }
      return;
    }
    const sessionId = createExecutionSessionId(nodeId, 'terminal');
    const executionEnv = await this.resolveExecutionEnvironment('terminal', cwd);

    try {
      const process = createExecutionSessionProcess(
        this.buildTerminalLaunchSpec(shellPath, cwd, normalizedCols, normalizedRows, executionEnv)
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
        outputSequence: 0,
        outputFlushTimer: undefined,
        displayLabel: shellPath,
        lifecycleStatus: 'launching',
        launchMode: 'start',
        resumePhaseActive: false,
        outputSubscription: undefined,
        exitSubscription: undefined
      };
      this.terminalSessions.set(nodeId, session);

      const handleTerminalChunk = (text: string): void => {
        const startedAt = Date.now();
        const activeSession = this.terminalSessions.get(nodeId);
        if (!activeSession) {
          return;
        }

        if (!text) {
          return;
        }

        activeSession.outputSequence += 1;
        activeSession.buffer = appendTerminalBuffer(activeSession.buffer, text);
        activeSession.terminalStateTracker.write(text);
        activeSession.lineContextTracker.write(text);
        void this.bridgeExecutionAttentionSignals('terminal', nodeId, activeSession, text);
        if (activeSession.lifecycleStatus === 'launching') {
          activeSession.lifecycleStatus = 'live';
        }
        this.queueExecutionStateSync('terminal', nodeId);
        this.queueExecutionOutput('terminal', nodeId, text);
        this.recordExecutionPerformanceDiagnostics({
          timestamp: new Date().toISOString(),
          source: 'host-output-chunk',
          nodeId,
          kind: 'terminal',
          owner: activeSession.owner,
          lifecycleStatus: activeSession.lifecycleStatus,
          durationMs: Date.now() - startedAt,
          characters: text.length,
          bytes: Buffer.byteLength(text, 'utf8'),
          sequence: activeSession.outputSequence,
          bufferLength: activeSession.buffer.length,
          pendingOutputLength: activeSession.pendingOutput.length
        });
      };

      const finalize = async (
        status: 'closed' | 'error',
        message: string,
        exitCode?: number,
        signal?: string
      ): Promise<void> => {
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
        const serializedTerminalState = await activeSession.terminalStateTracker
          .flush()
          .catch(() => activeSession.terminalStateTracker.getSerializedState());

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
            outputSequence: activeSession.outputSequence,
            lastExitCode: exitCode,
            lastExitSignal: signal ?? undefined,
            lastExitMessage: message,
            lastCols: activeSession.cols,
            lastRows: activeSession.rows,
            serializedTerminalState
          })
        });
        this.disposeManagedExecutionSession(activeSession);
        this.persistState();
        this.postState('host/stateUpdated');
        await this.postExecutionExitWithFinalSnapshot('terminal', nodeId, message);
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
          void finalize('closed', '终端已停止。', exitCode, signal);
          return;
        }

        if (exitCode === 0) {
          void finalize('closed', '终端会话已结束。', exitCode, signal);
          return;
        }

        const cleanedOutput = stripTerminalControlSequences(session.buffer);
        void finalize(
          'error',
          describeEmbeddedTerminalExit(shellPath, exitCode, signal, cleanedOutput),
          exitCode,
          signal
        );
      });

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
          outputSequence: undefined,
          lastExitCode: undefined,
          lastExitSignal: undefined,
          lastExitMessage: undefined,
          serializedTerminalState: undefined
        })
      });
      this.persistState();
      this.postState('host/stateUpdated');
      this.postExecutionSnapshot('terminal', nodeId, {
        executionSessionId: session.sessionId
      });
      await this.flushPendingTerminalInitialInput(nodeId);

      session.lifecycleTimer = setTimeout(() => {
        const activeSession = this.terminalSessions.get(nodeId);
        if (!activeSession || activeSession.lifecycleStatus !== 'launching') {
          return;
        }

        activeSession.lifecycleTimer = undefined;
        activeSession.lifecycleStatus = 'live';
      this.flushLiveExecutionState('terminal', nodeId, {
        persistMode: 'immediate',
        persistReason: 'terminal-launch-live'
      });
      }, 160);
    } catch (error) {
      const message = describeEmbeddedTerminalSpawnError(shellPath, error);
      this.recordDiagnosticEvent('execution/spawnError', {
        kind: 'terminal',
        nodeId,
        cols: normalizedCols,
        rows: normalizedRows,
        cwd,
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
      this.dropPendingTerminalInitialInput(nodeId, message);
    }
  }

  private getExecutionSessions(kind: ExecutionNodeKind): Map<string, ManagedExecutionSession> {
    return kind === 'agent' ? this.agentSessions : this.terminalSessions;
  }

  private waitForPendingTerminalInitialInputDispatch(
    nodeId: string,
    commandLine: string
  ): Promise<TerminalInitialInputDispatchResult> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pendingTerminalInitialInputDispatches.delete(nodeId);
        this.recordDiagnosticEvent('execution/initialInputDispatchTimedOut', {
          kind: 'terminal',
          nodeId,
          preview: summarizeDiagnosticInput(commandLine)
        });
        resolve({
          dispatched: false,
          errorMessage: '已创建画布 Terminal，但尚未确认安装命令已输入；请检查 Terminal 节点状态。'
        });
      }, TERMINAL_INITIAL_INPUT_DISPATCH_TIMEOUT_MS);

      this.pendingTerminalInitialInputDispatches.set(nodeId, {
        resolve,
        timeout
      });
    });
  }

  private completePendingTerminalInitialInputDispatch(
    nodeId: string,
    result: TerminalInitialInputDispatchResult
  ): void {
    const pendingDispatch = this.pendingTerminalInitialInputDispatches.get(nodeId);
    if (!pendingDispatch) {
      return;
    }

    this.pendingTerminalInitialInputDispatches.delete(nodeId);
    clearTimeout(pendingDispatch.timeout);
    pendingDispatch.resolve(result);
  }

  private dropPendingTerminalInitialInput(nodeId: string, errorMessage: string): void {
    this.pendingTerminalInitialInputs.delete(nodeId);
    this.completePendingTerminalInitialInputDispatch(nodeId, {
      dispatched: false,
      errorMessage
    });
  }

  private clearPendingTerminalInitialInputs(errorMessage: string): void {
    const pendingNodeIds = new Set([
      ...this.pendingTerminalInitialInputs.keys(),
      ...this.pendingTerminalInitialInputDispatches.keys()
    ]);
    this.pendingTerminalInitialInputs.clear();
    for (const nodeId of pendingNodeIds) {
      this.completePendingTerminalInitialInputDispatch(nodeId, {
        dispatched: false,
        errorMessage
      });
    }
  }

  private async flushPendingTerminalInitialInput(nodeId: string): Promise<void> {
    const input = this.pendingTerminalInitialInputs.get(nodeId);
    if (!input) {
      return;
    }

    this.pendingTerminalInitialInputs.delete(nodeId);
    if (!this.terminalSessions.has(nodeId)) {
      this.recordDiagnosticEvent('execution/initialInputDropped', {
        kind: 'terminal',
        nodeId,
        reason: 'missing-session',
        preview: summarizeDiagnosticInput(input)
      });
      this.completePendingTerminalInitialInputDispatch(nodeId, {
        dispatched: false,
        errorMessage: 'Terminal 会话未成功启动，安装命令未写入。'
      });
      return;
    }

    const inputWritten = await this.writeExecutionInput('terminal', nodeId, input);
    this.completePendingTerminalInitialInputDispatch(nodeId, {
      dispatched: inputWritten,
      errorMessage: inputWritten ? undefined : 'Terminal 已启动，但安装命令未能写入。'
    });
  }

  private attachExecutionSession(
    kind: ExecutionNodeKind,
    nodeId: string,
    options: ExecutionSnapshotAttachOptions = {}
  ): void {
    this.recordDiagnosticEvent('execution/attachRequested', {
      kind,
      nodeId,
      requestId: options.requestId,
      executionSessionId: options.executionSessionId,
      minOutputSequence: options.minOutputSequence,
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

    this.postExecutionSnapshot(kind, nodeId, options);
  }

  private async writeExecutionInput(
    kind: ExecutionNodeKind,
    nodeId: string,
    data: string,
    diagnosticMetadata: ExecutionInputDiagnosticMetadata = {}
  ): Promise<boolean> {
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
      return false;
    }

    const session = this.getExecutionSessions(kind).get(nodeId);
    if (!session) {
      this.recordDiagnosticEvent('execution/inputRejected', {
        ...inputDetail,
        reason: 'missing-session'
      });
      return false;
    }

    if (kind === 'agent' && session.agentProvider === 'claude' && containsTerminalSuspendInput(data)) {
      this.recordDiagnosticEvent('execution/inputRejected', {
        ...inputDetail,
        sessionId: session.sessionId,
        reason: 'claude-agent-ctrl-z-unsupported'
      });
      this.postMessage({
        type: 'host/error',
        payload: {
          message: 'Claude Agent 节点不支持 Ctrl-Z/fg；请使用停止、重启或分叉。'
        }
      });
      return false;
    }

    if (kind === 'agent' && session.lifecycleStatus === 'suspended') {
      this.recordDiagnosticEvent('execution/inputRejected', {
        ...inputDetail,
        sessionId: session.sessionId,
        reason: 'agent-suspended'
      });
      this.postMessage({
        type: 'host/error',
        payload: {
          message: 'Claude Code 已挂起，请点击“停止”结束会话后重启。'
        }
      });
      return false;
    }

    if (kind === 'agent') {
      const submittedInstruction = isAgentInstructionSubmission(data);
      if (session.lifecycleTimer) {
        clearTimeout(session.lifecycleTimer);
        session.lifecycleTimer = undefined;
      }
      if (submittedInstruction) {
        resetAgentActivityHeuristics(this.ensureAgentActivityState(session), session.buffer);
        session.lifecycleStatus = 'running';
        session.resumePhaseActive = false;
        this.queueExecutionStateSync('agent', nodeId, EXECUTION_INTERACTION_STATE_SYNC_INTERVAL_MS, {
          postState: true
        });
      }
    } else if (session.lifecycleStatus === 'launching') {
      session.lifecycleStatus = 'live';
      this.queueExecutionStateSync('terminal', nodeId, EXECUTION_INTERACTION_STATE_SYNC_INTERVAL_MS, {
        postState: true
      });
    }

    if (kind === 'terminal') {
      session.lineContextTracker.recordInput(data);
    }
    const writeStartedAt = Date.now();
    let inputWriteSucceeded = false;
    try {
      if (session.owner === 'local') {
        session.process.write(data);
      } else {
        const backendKind = normalizeRuntimeHostBackendKind(session.runtimeBackend) ?? 'legacy-detached';
        const operation = this.getRuntimeSupervisorClientForKind(
          backendKind,
          {},
          session.runtimeStoragePath
        ).then((client) =>
          client.writeInput({
            sessionId: session.runtimeSessionId,
            data
          })
        );
        this.trackRuntimeSupervisorOperation(operation.catch(() => undefined));
        await operation;
      }
      inputWriteSucceeded = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : '向 live runtime 写入输入失败。';
      this.recordExecutionPerformanceDiagnostics({
        timestamp: new Date().toISOString(),
        source: 'host-input-write',
        nodeId,
        kind,
        sequence: diagnosticMetadata.sequence,
        owner: session.owner,
        lifecycleStatus: session.lifecycleStatus,
        durationMs: Date.now() - writeStartedAt,
        webviewEpochMs: diagnosticMetadata.webviewEpochMs,
        hostReceivedEpochMs: diagnosticMetadata.hostReceivedEpochMs,
        queueDelayMs: diagnosticMetadata.queueDelayMs,
        characters: data.length,
        bytes: inputDetail.bytes,
        success: false,
        reason: message
      });
      this.recordDiagnosticEvent('execution/inputRejected', {
        ...inputDetail,
        reason: 'write-failed',
        message
      });
      this.postMessage({
        type: 'host/error',
        payload: {
          message
        }
      });
      return false;
    } finally {
      if (inputWriteSucceeded) {
        this.recordExecutionPerformanceDiagnostics({
          timestamp: new Date().toISOString(),
          source: 'host-input-write',
          nodeId,
          kind,
          sequence: diagnosticMetadata.sequence,
          owner: session.owner,
          lifecycleStatus: session.lifecycleStatus,
          durationMs: Date.now() - writeStartedAt,
          webviewEpochMs: diagnosticMetadata.webviewEpochMs,
          hostReceivedEpochMs: diagnosticMetadata.hostReceivedEpochMs,
          queueDelayMs: diagnosticMetadata.queueDelayMs,
          characters: data.length,
          bytes: inputDetail.bytes,
          success: true
        });
      }
    }

    this.recordDiagnosticEvent('execution/inputWritten', {
      ...inputDetail,
      sessionId: session.sessionId
    });
    return true;
  }

  private async copyExecutionSelection(
    sourceSurface: CanvasSurfaceLocation,
    kind: ExecutionNodeKind,
    nodeId: string,
    text: string
  ): Promise<void> {
    try {
      await vscode.env.clipboard.writeText(text);
      this.recordDiagnosticEvent('execution/selectionCopied', {
        kind,
        nodeId,
        bytes: Buffer.byteLength(text, 'utf8'),
        preview: summarizeDiagnosticInput(text)
      });
    } catch (error) {
      this.recordDiagnosticEvent('execution/selectionCopyFailed', {
        kind,
        nodeId,
        message: error instanceof Error ? error.message : String(error)
      });
      this.postMessageToSurface(sourceSurface, {
        type: 'host/error',
        payload: {
          message: error instanceof Error ? error.message : '复制终端选区失败。'
        }
      });
    }
  }

  private async copyTextToClipboard(
    sourceSurface: CanvasSurfaceLocation,
    text: string,
    detail: {
      source: WebviewClipboardTextSource;
      nodeId?: string;
    }
  ): Promise<void> {
    try {
      await vscode.env.clipboard.writeText(text);
      this.recordDiagnosticEvent('clipboard/textCopied', {
        source: detail.source,
        nodeId: detail.nodeId,
        bytes: Buffer.byteLength(text, 'utf8'),
        preview: summarizeDiagnosticInput(text)
      });
    } catch (error) {
      this.recordDiagnosticEvent('clipboard/textCopyFailed', {
        source: detail.source,
        nodeId: detail.nodeId,
        message: error instanceof Error ? error.message : String(error)
      });
      this.postMessageToSurface(sourceSurface, {
        type: 'host/error',
        payload: {
          message: error instanceof Error ? error.message : '复制到剪贴板失败。'
        }
      });
    }
  }

  private async handleExecutionPasteRequest(
    sourceSurface: CanvasSurfaceLocation,
    kind: ExecutionNodeKind,
    nodeId: string,
    requestId: string,
    bracketedPasteMode: boolean
  ): Promise<void> {
    if (!this.getExecutionSessions(kind).has(nodeId)) {
      this.postExecutionPasteCancelled(sourceSurface, kind, nodeId, requestId);
      this.postMessageToSurface(sourceSurface, {
        type: 'host/error',
        payload: {
          message: kind === 'agent' ? '当前 Agent 没有可输入的运行中会话。' : '当前 Terminal 没有可输入的运行中会话。'
        }
      });
      return;
    }

    let clipboardText: string;
    try {
      clipboardText = await vscode.env.clipboard.readText();
    } catch (error) {
      this.postExecutionPasteCancelled(sourceSurface, kind, nodeId, requestId);
      this.recordDiagnosticEvent('execution/pasteReadFailed', {
        kind,
        nodeId,
        message: error instanceof Error ? error.message : String(error)
      });
      this.postMessageToSurface(sourceSurface, {
        type: 'host/error',
        payload: {
          message: error instanceof Error ? error.message : '读取剪贴板失败。'
        }
      });
      return;
    }

    const preparedPaste = prepareExecutionTerminalPasteText(clipboardText, bracketedPasteMode);
    if (preparedPaste.kind === 'cancel') {
      this.postExecutionPasteCancelled(sourceSurface, kind, nodeId, requestId);
      return;
    }

    if (preparedPaste.kind === 'confirm') {
      const pasteAction = '继续粘贴';
      const selection = await vscode.window.showWarningMessage(
        `确定要向当前${kind === 'agent' ? ' Agent' : ' Terminal'}粘贴 ${preparedPaste.lineCount} 行文本吗？`,
        { modal: true },
        pasteAction
      );
      if (selection !== pasteAction) {
        this.postExecutionPasteCancelled(sourceSurface, kind, nodeId, requestId);
        return;
      }
    }

    if (!this.getExecutionSessions(kind).has(nodeId)) {
      this.postExecutionPasteCancelled(sourceSurface, kind, nodeId, requestId);
      return;
    }

    const pasteText = preparedPaste.text;
    this.postMessageToSurface(sourceSurface, {
      type: 'host/executionPasteText',
      payload: {
        requestId,
        nodeId,
        kind,
        text: pasteText
      }
    });
    this.recordDiagnosticEvent('execution/pastePrepared', {
      kind,
      nodeId,
      requestId,
      bytes: Buffer.byteLength(pasteText, 'utf8'),
      preview: summarizeDiagnosticInput(pasteText)
    });
  }

  private async handleExecutionImagePasteRequest(
    sourceSurface: CanvasSurfaceLocation,
    kind: ExecutionNodeKind,
    nodeId: string,
    requestId: string,
    mimeType: ExecutionImagePasteMimeType,
    dataBase64: string,
    sizeBytes: number,
    name?: string
  ): Promise<void> {
    if (kind !== 'agent') {
      this.postExecutionPasteCancelled(sourceSurface, kind, nodeId, requestId);
      this.postMessageToSurface(sourceSurface, {
        type: 'host/error',
        payload: {
          message: 'Terminal 节点暂不支持直接粘贴截图。'
        }
      });
      return;
    }

    const session = this.getExecutionSessions('agent').get(nodeId);
    if (!session) {
      this.postExecutionPasteCancelled(sourceSurface, kind, nodeId, requestId);
      this.postMessageToSurface(sourceSurface, {
        type: 'host/error',
        payload: {
          message: '当前 Agent 没有可输入的运行中会话。'
        }
      });
      return;
    }

    let imageBuffer: Buffer;
    try {
      imageBuffer = Buffer.from(dataBase64, 'base64');
    } catch (error) {
      this.postExecutionPasteCancelled(sourceSurface, kind, nodeId, requestId);
      this.recordDiagnosticEvent('execution/imagePasteRejected', {
        kind,
        nodeId,
        requestId,
        reason: 'decode-failed',
        message: error instanceof Error ? error.message : String(error)
      });
      this.postMessageToSurface(sourceSurface, {
        type: 'host/error',
        payload: {
          message: '读取截图数据失败。'
        }
      });
      return;
    }

    if (
      !isExecutionImagePasteSizeAllowed(sizeBytes) ||
      imageBuffer.length !== sizeBytes ||
      imageBuffer.length > EXECUTION_IMAGE_PASTE_MAX_BYTES ||
      !hasValidExecutionImagePasteSignature(imageBuffer, mimeType)
    ) {
      this.postExecutionPasteCancelled(sourceSurface, kind, nodeId, requestId);
      this.recordDiagnosticEvent('execution/imagePasteRejected', {
        kind,
        nodeId,
        requestId,
        reason: 'invalid-image',
        mimeType,
        declaredBytes: sizeBytes,
        decodedBytes: imageBuffer.length
      });
      this.postMessageToSurface(sourceSurface, {
        type: 'host/error',
        payload: {
          message: '剪贴板中的图片格式不支持或文件过大。'
        }
      });
      return;
    }

    try {
      const imagePath = this.writeExecutionImagePasteFile(nodeId, mimeType, imageBuffer);
      const pasteText = formatExecutionImagePasteText(imagePath);

      if (!this.getExecutionSessions('agent').has(nodeId)) {
        this.postExecutionPasteCancelled(sourceSurface, kind, nodeId, requestId);
        return;
      }

      this.postMessageToSurface(sourceSurface, {
        type: 'host/executionPasteText',
        payload: {
          requestId,
          nodeId,
          kind,
          text: pasteText
        }
      });
      this.recordDiagnosticEvent('execution/imagePastePrepared', {
        kind,
        nodeId,
        requestId,
        provider: session.agentProvider ?? 'codex',
        mimeType,
        bytes: imageBuffer.length,
        originalName: name,
        imagePath
      });
    } catch (error) {
      this.postExecutionPasteCancelled(sourceSurface, kind, nodeId, requestId);
      this.recordDiagnosticEvent('execution/imagePasteWriteFailed', {
        kind,
        nodeId,
        requestId,
        mimeType,
        bytes: imageBuffer.length,
        message: error instanceof Error ? error.message : String(error)
      });
      this.postMessageToSurface(sourceSurface, {
        type: 'host/error',
        payload: {
          message: error instanceof Error ? error.message : '保存剪贴板截图失败。'
        }
      });
    }
  }

  private writeExecutionImagePasteFile(
    nodeId: string,
    mimeType: ExecutionImagePasteMimeType,
    imageBuffer: Buffer
  ): string {
    const nodeDirectory = path.join(
      this.getExtensionStoragePath(),
      EXECUTION_IMAGE_PASTE_STORAGE_DIRECTORY,
      sanitizeExecutionImagePasteStorageSegment(nodeId)
    );
    fs.mkdirSync(nodeDirectory, {
      recursive: true
    });
    const fileName = createExecutionImagePasteFileName({
      mimeType,
      randomSuffix: randomUUID().replace(/-/g, '').slice(0, 12)
    });
    const imagePath = path.join(nodeDirectory, fileName);
    const tempPath = `${imagePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tempPath, imageBuffer);
    fs.renameSync(tempPath, imagePath);
    return imagePath;
  }

  private postExecutionPasteCancelled(
    surface: CanvasSurfaceLocation,
    kind: ExecutionNodeKind,
    nodeId: string,
    requestId: string
  ): void {
    this.postMessageToSurface(surface, {
      type: 'host/executionPasteCancelled',
      payload: {
        requestId,
        nodeId,
        kind
      }
    });
  }

  private resizeExecutionSession(kind: ExecutionNodeKind, nodeId: string, cols: number, rows: number): void {
    const normalizedCols = normalizeTerminalCols(cols);
    const normalizedRows = normalizeTerminalRows(rows);
    const session = this.getExecutionSessions(kind).get(nodeId);

    if (!session) {
      const node = this.state.nodes.find((currentNode) => currentNode.id === nodeId && currentNode.kind === kind);
      const metadata =
        kind === 'agent'
          ? node
            ? ensureAgentMetadata(node)
            : undefined
          : node
            ? ensureTerminalMetadata(node)
            : undefined;
      if (metadata && shouldPreserveStoredExecutionViewportDuringReattach(metadata)) {
        return;
      }

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
    this.flushLiveExecutionState(kind, nodeId, {
      persistMode: 'immediate',
      persistReason: 'execution-stop'
    });
    if (session.owner === 'local') {
      if (kind === 'agent') {
        if (session.agentProvider === 'claude') {
          session.process.kill();
          return;
        }
        this.requestGracefulLocalAgentStop(nodeId, session);
        return;
      }
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
      persistedRuntimeSession.runtimeStoragePath,
      node.kind,
      persistedRuntimeSession.backendKind
    );
  }

  private async deleteGroup(groupId: string): Promise<void> {
    const group = (this.state.groups ?? []).find((currentGroup) => currentGroup.id === groupId);
    if (!group) {
      this.postMessage({
        type: 'host/error',
        payload: {
          message: '未找到可删除的分组。'
        }
      });
      return;
    }
    if (isWorkspaceRootGroup(group)) {
      this.postMessage({
        type: 'host/error',
        payload: {
          message: '系统 root section 不能删除；如需从 workspace 移除 folder，请使用 VSCode workspace folder 管理。'
        }
      });
      return;
    }

    if (isEmptyCanvasGroup(this.state, groupId)) {
      this.state = this.reconcileCanvasFileArtifacts(deleteCanvasGroupKeepMembers(this.state, groupId));
      this.persistState();
      this.postState('host/stateUpdated');
      return;
    }

    const deleteImpact = collectCanvasGroupDeleteImpact(this.state, groupId);
    const groupsById = new Map((this.state.groups ?? []).map((currentGroup) => [currentGroup.id, currentGroup] as const));
    const containsWorkspaceRootGroup = [...deleteImpact.groupIds].some((impactGroupId) =>
      isWorkspaceRootGroup(groupsById.get(impactGroupId))
    );
    if (containsWorkspaceRootGroup) {
      const keepRootSectionsAction = { title: '仅删除外层分组并保留 root section' };
      const selection = await vscode.window.showWarningMessage(
        `删除分组「${group.title}」？`,
        {
          modal: true,
          detail: '该分组包含系统 root section。root section 不能被删除；删除操作只会移除当前外层分组并保留内部 root。'
        },
        keepRootSectionsAction
      );

      if (!selection) {
        return;
      }

      this.state = this.reconcileCanvasFileArtifacts(deleteCanvasGroupKeepMembers(this.state, groupId));
      this.persistState();
      this.postState('host/stateUpdated');
      return;
    }

    const deleteMembersAction = {
      title: `一并删除内部所有节点与子分组（${deleteImpact.nodeIds.length} 个节点，${Math.max(0, deleteImpact.groupIds.size - 1)} 个子分组）`
    };
    const keepMembersAction = { title: '仅删除分组框并保留内部对象' };
    const selection = await vscode.window.showWarningMessage(
      `删除分组「${group.title}」？`,
      {
        modal: true,
        detail: formatCanvasGroupDeleteImpactDetail(deleteImpact)
      },
      deleteMembersAction,
      keepMembersAction
    );

    if (!selection) {
      return;
    }

    const mode: CanvasGroupDeleteMode = selection.title === keepMembersAction.title ? 'keep-members' : 'delete-members';
    if (mode === 'keep-members') {
      this.state = this.reconcileCanvasFileArtifacts(deleteCanvasGroupKeepMembers(this.state, groupId));
      this.persistState();
      this.postState('host/stateUpdated');
      return;
    }

    const groupIdsToDelete = deleteImpact.groupIds;
    const nodeIdsToDelete = deleteImpact.nodeIds;

    for (const nodeId of nodeIdsToDelete) {
      const node = this.state.nodes.find((currentNode) => currentNode.id === nodeId);
      if (!node) {
        continue;
      }

      this.dropPendingTerminalInitialInput(nodeId, '节点已删除，安装命令未写入。');
      this.activeAssociatedNoteMarkdownEdits.delete(nodeId);
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
    }

    const nextNodes = this.state.nodes.filter((node) => !nodeIdsToDelete.includes(node.id));
    const deletedNodeIds = new Set(nodeIdsToDelete);
    let nextState: CanvasPrototypeState = {
      ...this.state,
      updatedAt: new Date().toISOString(),
      nodes: nextNodes,
      edges: this.state.edges.filter(
        (edge) => !deletedNodeIds.has(edge.sourceNodeId) && !deletedNodeIds.has(edge.targetNodeId)
      ),
      groups: (this.state.groups ?? []).filter((currentGroup) => !groupIdsToDelete.has(currentGroup.id))
    };

    for (const nodeId of nodeIdsToDelete) {
      const deletedNode = this.state.nodes.find((node) => node.id === nodeId);
      if (deletedNode?.kind === 'agent') {
        nextState = removeAgentFileReferences(nextState, nodeId);
      } else if (deletedNode?.kind === 'file' || deletedNode?.kind === 'file-list') {
        nextState = {
          ...nextState,
          suppressedAutomaticFileArtifactNodeIds: ensureSuppressedAutomaticFileArtifactNodeId(
            nextState.suppressedAutomaticFileArtifactNodeIds,
            nodeId
          )
        };
      }
    }

    this.state = this.reconcileCanvasFileArtifacts(finalizeCanvasGroupState(nextState));
    this.persistState();
    this.postState('host/stateUpdated');
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

    this.dropPendingTerminalInitialInput(nodeId, '节点已删除，安装命令未写入。');
    this.activeAssociatedNoteMarkdownEdits.delete(nodeId);

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

    const nextState =
      node.kind === 'agent'
        ? removeAgentFileReferences(deleteCanvasNode(this.state, nodeId), nodeId)
        : node.kind === 'file' || node.kind === 'file-list'
          ? {
              ...deleteCanvasNode(this.state, nodeId),
              suppressedAutomaticFileArtifactNodeIds: ensureSuppressedAutomaticFileArtifactNodeId(
                this.state.suppressedAutomaticFileArtifactNodeIds,
                nodeId
              )
            }
        : deleteCanvasNode(this.state, nodeId);
    this.state = this.reconcileCanvasFileArtifacts(nextState);
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
    this.clearScheduledExecutionOutputPost(kind, nodeId);

    session.outputSubscription?.dispose();
    session.exitSubscription?.dispose();
    sessionMap.delete(nodeId);
    if (kind === 'agent') {
      void this.disposeAgentFileActivitySession(nodeId);
    }
    this.disposeManagedExecutionSession(session);

    if (session.owner === 'supervisor') {
      this.unbindRuntimeSession(session.runtimeSessionId, session.runtimeStoragePath, kind, session.runtimeBackend);
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

  private requestGracefulLocalAgentStop(nodeId: string, session: LocalExecutionSession): void {
    try {
      session.process.write(AGENT_GRACEFUL_STOP_INPUT);
    } catch {
      session.process.kill();
      return;
    }

    session.lifecycleTimer = setTimeout(() => {
      const currentSession = this.getExecutionSessions('agent').get(nodeId);
      if (
        !currentSession ||
        currentSession !== session ||
        currentSession.owner !== 'local' ||
        !currentSession.stopRequested
      ) {
        return;
      }

      currentSession.lifecycleTimer = undefined;
      this.recordDiagnosticEvent('execution/stopForceKilled', {
        kind: 'agent',
        nodeId,
        provider: currentSession.agentProvider ?? null,
        sessionId: currentSession.sessionId,
        waitedMs: AGENT_GRACEFUL_STOP_FORCE_KILL_TIMEOUT_MS
      });
      currentSession.process.kill();
    }, AGENT_GRACEFUL_STOP_FORCE_KILL_TIMEOUT_MS);
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

    this.flushScheduledExecutionOutputForKey(kind, nodeId, 'immediate-flush');
    const pendingOutput = this.takePendingExecutionOutput(session);
    if (!pendingOutput) {
      return;
    }

    this.postExecutionOutput(kind, nodeId, pendingOutput, { immediate: true });
  }

  private clearQueuedExecutionOutput(kind: ExecutionNodeKind, nodeId: string): void {
    const session = this.getExecutionSessions(kind).get(nodeId);
    if (session) {
      this.takePendingExecutionOutput(session);
    }

    this.clearScheduledExecutionOutputPost(kind, nodeId);
  }

  private getCanvasStatePersistBarrierBeforeExecutionOutput(
    kind: ExecutionNodeKind,
    nodeId: string
  ): Promise<void> | undefined {
    if (this.pendingCanvasStatePersistFlush) {
      return this.pendingCanvasStatePersistFlush;
    }

    const pendingState = this.pendingCanvasStatePersist?.snapshot.state;
    if (!isRecord(pendingState) || !Array.isArray(pendingState.nodes)) {
      return undefined;
    }

    const pendingNode = pendingState.nodes.find(
      (candidate) => isRecord(candidate) && candidate.id === nodeId && candidate.kind === kind
    );
    if (!isRecord(pendingNode)) {
      return undefined;
    }

    const nodeMetadata = isRecord(pendingNode.metadata) ? pendingNode.metadata : undefined;
    const executionMetadata =
      kind === 'agent'
        ? nodeMetadata && isRecord(nodeMetadata.agent)
          ? nodeMetadata.agent
          : undefined
        : nodeMetadata && isRecord(nodeMetadata.terminal)
          ? nodeMetadata.terminal
          : undefined;
    return executionMetadata?.serializedTerminalState !== undefined
      ? undefined
      : this.flushDeferredCanvasStatePersist('first-output-post');
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

  private postExecutionOutput(
    kind: ExecutionNodeKind,
    nodeId: string,
    chunk: string,
    options: { immediate?: boolean } = {}
  ): void {
    if (!chunk) {
      return;
    }

    const persistBarrier = this.getCanvasStatePersistBarrierBeforeExecutionOutput(kind, nodeId);
    const session = this.getExecutionSessions(kind).get(nodeId);
    const outputSequence = session?.outputSequence;
    const executionSessionId = session?.sessionId;
    const persisted = persistBarrier === undefined;
    if (options.immediate === true || !persisted) {
      this.postExecutionOutputMessage(kind, nodeId, chunk, {
        persisted,
        outputSequence,
        executionSessionId
      });
    } else {
      this.scheduleExecutionOutputPost({
        key: this.getExecutionOutputSchedulerKey(kind, nodeId),
        kind,
        nodeId,
        chunk,
        persisted: true,
        outputSequence,
        executionSessionId,
        queuedAtMs: Date.now(),
        lastUpdatedAtMs: Date.now()
      });
    }

    if (persistBarrier) {
      void persistBarrier.then(
        () => undefined,
        (error) => {
          this.recordDiagnosticEvent('state/persistOutputBarrierFailed', {
            kind,
            nodeId,
            message: formatUnknownError(error)
          });
        }
      ).then(() => {
        const schedulerKey = this.getExecutionOutputSchedulerKey(kind, nodeId);
        const controllerStillNeedsOutput =
          this.getExecutionSessions(kind).get(nodeId)?.pendingOutput.length === 0 &&
          !this.scheduledExecutionOutputPosts.has(schedulerKey);
        if (!controllerStillNeedsOutput) {
          return;
        }
        this.postMessage({
          type: 'host/executionOutput',
          payload: {
            nodeId,
            kind,
            executionSessionId,
            chunk: '',
            persisted: true,
            outputSequence
          }
        });
      }).catch(() => undefined);
    }
  }

  private getExecutionOutputSchedulerKey(kind: ExecutionNodeKind, nodeId: string): string {
    return `${kind}:${nodeId}`;
  }

  private scheduleExecutionOutputPost(entry: ScheduledExecutionOutputPost): void {
    const existing = this.scheduledExecutionOutputPosts.get(entry.key);
    if (existing) {
      existing.chunk += entry.chunk;
      existing.persisted = existing.persisted && entry.persisted;
      existing.outputSequence = entry.outputSequence;
      existing.executionSessionId = entry.executionSessionId;
      existing.lastUpdatedAtMs = entry.lastUpdatedAtMs;
    } else {
      this.scheduledExecutionOutputPosts.set(entry.key, entry);
    }

    this.scheduleExecutionOutputSchedulerFlush();
  }

  private scheduleExecutionOutputSchedulerFlush(): void {
    if (this.executionOutputSchedulerTimer || this.scheduledExecutionOutputPosts.size === 0) {
      return;
    }

    this.executionOutputSchedulerTimer = setTimeout(() => {
      this.executionOutputSchedulerTimer = undefined;
      this.flushScheduledExecutionOutputPosts();
    }, EXECUTION_HOST_OUTPUT_SCHEDULER_FLUSH_INTERVAL_MS);
  }

  private flushScheduledExecutionOutputForKey(
    kind: ExecutionNodeKind,
    nodeId: string,
    reason: string
  ): void {
    const key = this.getExecutionOutputSchedulerKey(kind, nodeId);
    const entry = this.scheduledExecutionOutputPosts.get(key);
    if (!entry) {
      return;
    }

    const startedAt = Date.now();
    this.scheduledExecutionOutputPosts.delete(key);
    if (this.scheduledExecutionOutputPosts.size === 0 && this.executionOutputSchedulerTimer) {
      clearTimeout(this.executionOutputSchedulerTimer);
      this.executionOutputSchedulerTimer = undefined;
    }

    const posted = this.postScheduledExecutionOutput(entry);
    const schedulerState = this.getExecutionOutputSchedulerDiagnosticState();
    this.recordExecutionPerformanceDiagnostics({
      timestamp: new Date().toISOString(),
      source: 'host-output-scheduler',
      reason,
      nodeId,
      kind,
      durationMs: Date.now() - startedAt,
      characters: posted ? entry.chunk.length : 0,
      bytes: posted ? Buffer.byteLength(entry.chunk, 'utf8') : 0,
      controllerCount: 1,
      flushedControllerCount: posted ? 1 : 0,
      pendingControllerCount: schedulerState.pendingControllerCount,
      queuedWriteCount: schedulerState.queuedWriteCount,
      pendingOutputLength: schedulerState.pendingOutputLength,
      sequence: entry.outputSequence,
      executionSessionId: entry.executionSessionId,
      success: posted
    });
  }

  private clearScheduledExecutionOutputPost(kind: ExecutionNodeKind, nodeId: string): void {
    this.scheduledExecutionOutputPosts.delete(this.getExecutionOutputSchedulerKey(kind, nodeId));
    if (this.scheduledExecutionOutputPosts.size === 0 && this.executionOutputSchedulerTimer) {
      clearTimeout(this.executionOutputSchedulerTimer);
      this.executionOutputSchedulerTimer = undefined;
    }
  }

  private flushScheduledExecutionOutputPosts(): void {
    const entries = Array.from(this.scheduledExecutionOutputPosts.values());
    if (entries.length === 0) {
      return;
    }

    const startedAt = Date.now();
    const selected = this.selectScheduledExecutionOutputPosts(entries, startedAt);
    if (selected.entries.length === 0) {
      const schedulerState = this.getExecutionOutputSchedulerDiagnosticState();
      this.recordExecutionPerformanceDiagnostics({
        timestamp: new Date().toISOString(),
        source: 'host-output-scheduler',
        reason: selected.reason,
        durationMs: Date.now() - startedAt,
        characters: 0,
        bytes: 0,
        controllerCount: entries.length,
        flushedControllerCount: 0,
        pendingControllerCount: schedulerState.pendingControllerCount,
        queuedWriteCount: schedulerState.queuedWriteCount,
        pendingOutputLength: schedulerState.pendingOutputLength,
        success: true
      });
      this.scheduleExecutionOutputSchedulerFlush();
      return;
    }

    let postedCount = 0;
    let postedCharacters = 0;
    let postedBytes = 0;
    for (const entry of selected.entries) {
      this.scheduledExecutionOutputPosts.delete(entry.key);
      if (!this.postScheduledExecutionOutput(entry)) {
        continue;
      }
      postedCount += 1;
      postedCharacters += entry.chunk.length;
      postedBytes += Buffer.byteLength(entry.chunk, 'utf8');
    }

    const schedulerState = this.getExecutionOutputSchedulerDiagnosticState();
    this.recordExecutionPerformanceDiagnostics({
      timestamp: new Date().toISOString(),
      source: 'host-output-scheduler',
      reason: selected.reason,
      durationMs: Date.now() - startedAt,
      characters: postedCharacters,
      bytes: postedBytes,
      controllerCount: entries.length,
      flushedControllerCount: postedCount,
      pendingControllerCount: schedulerState.pendingControllerCount,
      queuedWriteCount: schedulerState.queuedWriteCount,
      pendingOutputLength: schedulerState.pendingOutputLength,
      nodeId: selected.entries.length === 1 ? selected.entries[0].nodeId : undefined,
      kind: selected.entries.length === 1 ? selected.entries[0].kind : undefined,
      sequence: selected.entries.length === 1 ? selected.entries[0].outputSequence : undefined,
      executionSessionId: selected.entries.length === 1 ? selected.entries[0].executionSessionId : undefined,
      success: true
    });

    if (this.scheduledExecutionOutputPosts.size > 0) {
      this.scheduleExecutionOutputSchedulerFlush();
    }
  }

  private selectScheduledExecutionOutputPosts(
    entries: ScheduledExecutionOutputPost[],
    now: number
  ): { entries: ScheduledExecutionOutputPost[]; reason: string } {
    return selectExecutionOutputSchedulerEntries(entries, now, this.getActiveExecutionInputPriority(now), {
      maxPostsPerFlush: EXECUTION_HOST_OUTPUT_SCHEDULER_MAX_POSTS_PER_FLUSH,
      inputPriorityWindowMs: EXECUTION_HOST_OUTPUT_INPUT_PRIORITY_WINDOW_MS,
      nonPriorityMaxDeferMs: EXECUTION_HOST_OUTPUT_INPUT_NON_PRIORITY_MAX_DEFER_MS
    });
  }

  private getActiveExecutionInputPriority(now: number): ExecutionInputPriorityState | undefined {
    const priority = this.recentExecutionInputPriority;
    if (!priority || now - priority.receivedAtMs > EXECUTION_HOST_OUTPUT_INPUT_PRIORITY_WINDOW_MS) {
      return undefined;
    }

    return priority;
  }

  private postScheduledExecutionOutput(entry: ScheduledExecutionOutputPost): boolean {
    const activeSession = this.getExecutionSessions(entry.kind).get(entry.nodeId);
    if (!activeSession || (entry.executionSessionId && activeSession.sessionId !== entry.executionSessionId)) {
      return false;
    }

    this.postExecutionOutputMessage(entry.kind, entry.nodeId, entry.chunk, {
      persisted: entry.persisted,
      outputSequence: entry.outputSequence,
      executionSessionId: entry.executionSessionId
    });
    return true;
  }

  private postExecutionOutputMessage(
    kind: ExecutionNodeKind,
    nodeId: string,
    chunk: string,
    options: {
      persisted: boolean;
      outputSequence?: number;
      executionSessionId?: string;
    }
  ): void {
    const startedAt = Date.now();
    this.postMessage({
      type: 'host/executionOutput',
      payload: {
        nodeId,
        kind,
        executionSessionId: options.executionSessionId,
        chunk,
        persisted: options.persisted,
        outputSequence: options.outputSequence
      }
    });
    this.recordExecutionPerformanceDiagnostics({
      timestamp: new Date().toISOString(),
      source: 'host-output-post',
      nodeId,
      kind,
      durationMs: Date.now() - startedAt,
      characters: chunk.length,
      bytes: Buffer.byteLength(chunk, 'utf8'),
      sequence: options.outputSequence,
      executionSessionId: options.executionSessionId,
      pendingOutputLength: this.getExecutionOutputPendingLength(kind, nodeId),
      success: true
    });
  }

  private getExecutionOutputPendingLength(kind: ExecutionNodeKind, nodeId: string): number {
    const sessionPendingOutputLength = this.getExecutionSessions(kind).get(nodeId)?.pendingOutput.length ?? 0;
    const scheduledOutputLength =
      this.scheduledExecutionOutputPosts.get(this.getExecutionOutputSchedulerKey(kind, nodeId))?.chunk.length ?? 0;
    return sessionPendingOutputLength + scheduledOutputLength;
  }

  private getExecutionOutputSchedulerDiagnosticState(): {
    controllerCount: number;
    pendingControllerCount: number;
    queuedWriteCount: number;
    pendingOutputLength: number;
  } {
    const pendingControllerKeys = new Set<string>();
    let pendingOutputLength = 0;
    for (const [nodeId, session] of this.agentSessions) {
      if (session.pendingOutput.length > 0) {
        pendingControllerKeys.add(this.getExecutionOutputSchedulerKey('agent', nodeId));
        pendingOutputLength += session.pendingOutput.length;
      }
    }
    for (const [nodeId, session] of this.terminalSessions) {
      if (session.pendingOutput.length > 0) {
        pendingControllerKeys.add(this.getExecutionOutputSchedulerKey('terminal', nodeId));
        pendingOutputLength += session.pendingOutput.length;
      }
    }
    for (const [key, entry] of this.scheduledExecutionOutputPosts) {
      pendingControllerKeys.add(key);
      pendingOutputLength += entry.chunk.length;
    }

    return {
      controllerCount: this.agentSessions.size + this.terminalSessions.size,
      pendingControllerCount: pendingControllerKeys.size,
      queuedWriteCount: this.scheduledExecutionOutputPosts.size,
      pendingOutputLength
    };
  }

  private queueExecutionStateSync(
    kind: ExecutionNodeKind,
    nodeId: string,
    delayMs = EXECUTION_OUTPUT_STATE_SYNC_INTERVAL_MS,
    options: { postState?: boolean } = {}
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
      this.flushLiveExecutionState(kind, nodeId, {
        postState: options.postState === true
      });
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
    this.flushLiveExecutionState(kind, nodeId, {
      persistMode: 'immediate',
      persistReason: 'execution-boundary'
    });
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
    options: { postState?: boolean; persistMode?: CanvasStatePersistMode; persistReason?: string } = {}
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
        outputSequence: session.outputSequence,
        lastCols: session.cols,
        lastRows: session.rows,
        serializedTerminalState: session.terminalStateTracker.getSerializedState(),
        lastRuntimeError: undefined,
        ...(kind === 'agent'
          ? {
              lastBackendLabel: session.displayLabel,
              preSuspendLifecycle: session.preSuspendLifecycleStatus,
              lastSuspendReason: session.lastSuspendReason,
              lastSuspendMessage: session.lastSuspendMessage,
              lastReactivateError: session.lastReactivateError
            }
          : {}),
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
    this.persistState({
      mode: options.persistMode ?? 'deferred',
      reason: options.persistReason ?? 'live-execution-state'
    });
    if (
      options.postState !== false &&
      (options.postState === true || options.persistMode === 'immediate' || !this.hasActiveExecutionSessions())
    ) {
      this.postState('host/stateUpdated');
    }
  }

  private async postExecutionSnapshot(
    kind: ExecutionNodeKind,
    nodeId: string,
    options: ExecutionSnapshotAttachOptions = {}
  ): Promise<void> {
    this.clearQueuedExecutionOutput(kind, nodeId);
    const session = this.getExecutionSessions(kind).get(nodeId);
    if (
      session &&
      options.executionSessionId !== undefined &&
      options.executionSessionId === session.sessionId &&
      options.minOutputSequence !== undefined &&
      options.minOutputSequence > session.outputSequence
    ) {
      session.outputSequence = options.minOutputSequence;
    }
    const outputSequence = session?.outputSequence;
    const executionSessionId = session?.sessionId;
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
        requestId: options.requestId,
        executionSessionId,
        output: session?.buffer ?? metadata?.recentOutput ?? '',
        cols: session?.cols ?? metadata?.lastCols ?? DEFAULT_TERMINAL_COLS,
        rows: session?.rows ?? metadata?.lastRows ?? DEFAULT_TERMINAL_ROWS,
        liveSession: Boolean(session),
        outputSequence,
        serializedTerminalState:
          serializedTerminalState ??
          cloneSerializedTerminalState(metadata?.serializedTerminalState)
      }
    });
    this.recordDiagnosticEvent('execution/snapshotPosted', {
      kind,
      nodeId,
      requestId: options.requestId,
      requestedExecutionSessionId: options.executionSessionId,
      minOutputSequence: options.minOutputSequence,
      executionSessionId,
      cols: session?.cols ?? metadata?.lastCols ?? DEFAULT_TERMINAL_COLS,
      rows: session?.rows ?? metadata?.lastRows ?? DEFAULT_TERMINAL_ROWS,
      liveSession: Boolean(session),
      outputSequence
    });
  }

  private async postExecutionExitWithFinalSnapshot(
    kind: ExecutionNodeKind,
    nodeId: string,
    message: string
  ): Promise<void> {
    await this.postExecutionSnapshot(kind, nodeId, {
      executionSessionId: this.getExecutionSessions(kind).get(nodeId)?.sessionId
    });
    this.postMessage({
      type: 'host/executionExit',
      payload: {
        nodeId,
        kind,
        message
      }
    });
  }

  private applyCreateNode(
    kind: CanvasCreatableNodeKind,
    preferredPosition?: CanvasNodePosition,
    options?: CreateNodeOptions & { bypassTrust?: boolean }
  ): CanvasNodeSummary | undefined {
    if (
      isExecutionNodeKind(kind) &&
      !options?.bypassTrust &&
      !vscode.workspace.isTrusted
    ) {
      this.postMessage({
        type: 'host/error',
        payload: {
          message: '当前 workspace 未受信任，已禁止创建 Agent / Terminal 节点。',
          createRequestId: options?.requestId
        }
      });
      return undefined;
    }

    const agentProvider = options?.agentProvider ?? this.getAgentCliConfig().defaultProvider;
    const agentLaunchPreset = options?.agentLaunchPreset ?? 'default';
    const agentCustomLaunchCommand =
      agentLaunchPreset === 'custom' ? options?.agentCustomLaunchCommand : undefined;
    const cwdOverride = isExecutionNodeKind(kind) && options?.cwdOverride
      ? this.validateExecutionCwdForCreate(kind, options.cwdOverride, options?.requestId)
      : undefined;
    if (isExecutionNodeKind(kind) && options?.cwdOverride && !cwdOverride) {
      return undefined;
    }
    const targetGroup = options?.targetGroupId
      ? (this.state.groups ?? []).find((group) => group.id === options.targetGroupId)
      : undefined;
    const targetRootGroupId = targetGroup
      ? isWorkspaceRootGroup(targetGroup)
        ? targetGroup.id
        : resolveContainingWorkspaceRootGroupId(this.state.groups ?? [], targetGroup.id)
      : undefined;
    const targetRootGroupFromGroup = targetRootGroupId
      ? (this.state.groups ?? []).find((group) => group.id === targetRootGroupId && isWorkspaceRootGroup(group))
      : undefined;
    const targetRootGroup = targetRootGroupFromGroup ??
      (cwdOverride ? this.resolveWorkspaceRootGroupForExecutionCwd(cwdOverride) : undefined);
    const targetRootPath = targetRootGroup ? resolveWorkspaceRootPathForGroup(targetRootGroup) : undefined;
    const resolvedCwdOverride = cwdOverride ?? (isExecutionNodeKind(kind) ? targetRootPath : undefined);
    if ((vscode.workspace.workspaceFolders?.length ?? 0) > 1 && !targetRootGroup) {
      this.postMessage({
        type: 'host/error',
        payload: {
          message: '多根 workspace 中请在目标 root section 内创建节点，或从 Explorer 资源入口创建执行节点。',
          createRequestId: options?.requestId
        }
      });
      return undefined;
    }

    if (kind === 'agent') {
      try {
        this.validateAgentFreshLaunchCommand(
          agentProvider,
          agentLaunchPreset,
          agentCustomLaunchCommand,
          this.getAgentLaunchDefaults(agentProvider)
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : '无法创建 Agent 节点。';
        this.recordDiagnosticEvent('node/createRejected', {
          kind,
          provider: agentProvider,
          launchPreset: agentLaunchPreset,
          commandLine: agentCustomLaunchCommand ?? null,
          message
        });
        this.postMessage({
          type: 'host/error',
          payload: {
            message,
            createRequestId: options?.requestId
          }
        });
        return undefined;
      }
    }

    const preferredPositionInTargetRoot = preferredPosition && targetRootGroupFromGroup
      ? translateComposedCanvasPositionToRootLocal(preferredPosition, targetRootGroupFromGroup)
      : targetRootGroup
        ? undefined
        : preferredPosition;
    const createState = targetRootGroup
      ? this.prepareStateForWorkspaceRootLocalCreate(targetRootGroup)
      : this.state;
    const targetGroupIdForCreate = targetRootGroup
      ? targetGroup && !isWorkspaceRootGroup(targetGroup)
        ? denamespaceCanvasObjectId(targetRootPath ?? '', targetGroup.id) ?? targetGroup.id
        : undefined
      : options?.targetGroupId;
    const nextState = createNextState(
      createState,
      kind,
      agentProvider,
      agentLaunchPreset,
      agentCustomLaunchCommand,
      preferredPositionInTargetRoot,
      targetGroupIdForCreate,
      resolvedCwdOverride
    );
    const composedNextState = targetRootGroup
      ? this.namespaceWorkspaceRootLocalCreateState(nextState, targetRootGroup)
      : nextState;
    const createdNodeCandidate = composedNextState.nodes[composedNextState.nodes.length - 1];
    const createdNode =
      createdNodeCandidate && options?.titleOverride?.trim()
        ? {
            ...createdNodeCandidate,
            title: options.titleOverride.trim()
          }
        : createdNodeCandidate;
    const nextStateWithOverrides =
      createdNode && createdNode !== createdNodeCandidate
        ? {
            ...composedNextState,
            nodes: [...composedNextState.nodes.slice(0, -1), createdNode]
          }
        : composedNextState;

    if (createdNode && createdNode.kind === 'agent') {
      this.state = updateAgentNode(nextStateWithOverrides, createdNode.id, {
        status: 'starting',
        summary: '正在等待节点尺寸就绪后启动 Agent 会话。',
        metadata: buildAgentMetadataPatch(composedNextState, createdNode.id, {
          lifecycle: 'starting',
          pendingLaunch: 'start',
          liveSession: false,
          cwd: resolvedCwdOverride ?? ensureAgentMetadata(createdNode).cwd,
          launchPreset: agentLaunchPreset,
          customLaunchCommand:
            agentLaunchPreset === 'custom' ? agentCustomLaunchCommand?.trim() || undefined : undefined,
          lastExitCode: undefined,
          lastExitSignal: undefined,
          lastExitMessage: undefined,
          outputSequence: undefined,
          recentOutput: undefined,
          lastResumeError: undefined
        })
      });
    } else if (createdNode && createdNode.kind === 'terminal') {
      this.state = updateTerminalNode(nextStateWithOverrides, createdNode.id, {
        status: 'launching',
        summary: '正在等待节点尺寸就绪后启动嵌入式终端。',
        metadata: buildTerminalMetadataPatch(composedNextState, createdNode.id, {
          lifecycle: 'launching',
          pendingLaunch: 'start',
          liveSession: false,
          cwd: resolvedCwdOverride ?? ensureTerminalMetadata(createdNode).cwd,
          lastExitCode: undefined,
          lastExitSignal: undefined,
          lastExitMessage: undefined,
          outputSequence: undefined,
          recentOutput: undefined
        })
      });
    } else {
      this.state = nextStateWithOverrides;
    }

    this.canvasTemplateInitialized = true;
    this.persistState();
    this.postState('host/stateUpdated');
    return createdNode;
  }

  private getCreateNodeBlockReasonCode(kind: CanvasCreatableNodeKind): CreateNodeBlockReason | undefined {
    if (isExecutionNodeKind(kind) && !vscode.workspace.isTrusted) {
      return 'workspace-untrusted';
    }

    return undefined;
  }

  private resolveWorkspaceRootGroupForExecutionCwd(cwd: string): CanvasGroupSummary | undefined {
    return (this.state.groups ?? [])
      .flatMap((group) => {
        const rootPath = resolveWorkspaceRootPathForGroup(group);
        return rootPath !== undefined && isSameOrDescendantExecutionPath(cwd, rootPath)
          ? [{ group, rootPath }]
          : [];
      })
      .sort((left, right) => right.rootPath.length - left.rootPath.length)
      .at(0)?.group;
  }

  private prepareStateForWorkspaceRootLocalCreate(rootGroup: CanvasGroupSummary): CanvasPrototypeState {
    return decomposeComposedCanvasStateForWorkspaceRoot(this.state, rootGroup);
  }

  private namespaceWorkspaceRootLocalCreateState(
    localState: CanvasPrototypeState,
    rootGroup: CanvasGroupSummary
  ): CanvasPrototypeState {
    return finalizeCanvasGroupState(composeRootLocalCanvasStateIntoComposed(this.state, localState, rootGroup));
  }

  private validateExecutionCwdForCreate(
    kind: ExecutionNodeKind,
    cwd: string,
    createRequestId?: string
  ): string | undefined {
    const validation = this.validateExecutionCwd(cwd);
    if (validation.valid) {
      return validation.cwd;
    }

    this.recordDiagnosticEvent('node/createRejected', {
      kind,
      reason: 'invalid-cwd',
      cwd,
      message: validation.message
    });
    this.postMessage({
      type: 'host/error',
      payload: {
        message: validation.message,
        createRequestId
      }
    });
    return undefined;
  }

  private validateExecutionCwd(
    cwd: string,
    options: ExecutionCwdValidationOptions = {}
  ): { valid: true; cwd: string } | { valid: false; message: string } {
    const normalizedCwd = normalizeExecutionCwd(cwd);
    if (!normalizedCwd) {
      return { valid: false, message: '执行目录不能为空。' };
    }

    if (!path.isAbsolute(normalizedCwd)) {
      return { valid: false, message: `执行目录必须是绝对路径：${normalizedCwd}` };
    }

    let stat: fs.Stats;
    try {
      stat = fs.statSync(normalizedCwd);
    } catch {
      return { valid: false, message: `执行目录不存在或不可访问：${normalizedCwd}` };
    }

    if (!stat.isDirectory()) {
      return { valid: false, message: `执行目录不是文件夹：${normalizedCwd}` };
    }

    const workspaceFolder = this.resolveExecutionWorkspaceFolder(normalizedCwd);
    if (!workspaceFolder) {
      if (
        options.allowLegacyDefaultCwd &&
        this.isLegacyDefaultExecutionCwd(normalizedCwd)
      ) {
        const workspaceRoot = this.getWorkspaceRoot();
        if (workspaceRoot) {
          return { valid: true, cwd: workspaceRoot };
        }
      }
      return { valid: false, message: `执行目录必须位于当前 workspace 内：${normalizedCwd}` };
    }

    return { valid: true, cwd: normalizedCwd };
  }

  private resolveExecutionWorkspaceFolder(cwd: string): vscode.WorkspaceFolder | undefined {
    const cwdUri = vscode.Uri.file(cwd);
    const directWorkspaceFolder = vscode.workspace.getWorkspaceFolder(cwdUri);
    if (directWorkspaceFolder) {
      return directWorkspaceFolder;
    }

    return vscode.workspace.workspaceFolders?.find((workspaceFolder) =>
      isSameOrDescendantExecutionPath(cwd, workspaceFolder.uri.fsPath)
    );
  }

  private describeUnavailableExecutionCwd(cwd: string): string | undefined {
    const validation = this.validateExecutionCwd(cwd, { allowLegacyDefaultCwd: true });
    return validation.valid ? undefined : `启动执行节点失败：${validation.message}`;
  }

  private recordHostMessage(
    surface: CanvasSurfaceLocation | 'active',
    message: HostToWebviewMessage,
    delivered: boolean
  ): void {
    this.recordHostMessageDiagnostic(surface, message, delivered);
    this.recordHostMessageForTest(message);
  }

  private recordHostMessageDiagnostic(
    surface: CanvasSurfaceLocation | 'active',
    message: HostToWebviewMessage,
    delivered: boolean
  ): void {
    const messageDetail = summarizeHostMessageDetail(message);
    const lifecycle = summarizeWebviewLifecycleIdentity(message.lifecycle);
    this.diagnosticHostMessages.push({
      timestamp: new Date().toISOString(),
      surface,
      delivered,
      type: message.type,
      detail:
        lifecycle || messageDetail
          ? {
              ...(messageDetail ?? {}),
              ...(lifecycle
                ? {
                    lifecycle
                  }
                : {})
            }
          : undefined
    });
    if (this.diagnosticHostMessages.length > 400) {
      this.diagnosticHostMessages.splice(0, this.diagnosticHostMessages.length - 400);
    }
  }

  private recordHostMessageForTest(message: HostToWebviewMessage): void {
    if (!isTestHarnessMode(this.context.extensionMode)) {
      return;
    }

    this.testHostMessages.push(cloneJsonValue(message));
    if (this.testHostMessages.length > 200) {
      this.testHostMessages.splice(0, this.testHostMessages.length - 200);
    }
  }

  private recordExecutionFileLinkResolveDiagnostics(
    sample: ExecutionFileLinkResolveDiagnosticSample
  ): void {
    this.executionFileLinkResolveDiagnostics.push(cloneJsonValue(sample));
    if (this.executionFileLinkResolveDiagnostics.length > 400) {
      this.executionFileLinkResolveDiagnostics.splice(
        0,
        this.executionFileLinkResolveDiagnostics.length - 400
      );
    }
  }

  private recordExecutionPerformanceDiagnostics(sample: ExecutionPerformanceDiagnosticSample): void {
    if (!shouldRetainExecutionPerformanceDiagnosticSample(sample)) {
      return;
    }

    this.executionPerformanceDiagnostics.push(cloneJsonValue(sample));
    if (this.executionPerformanceDiagnostics.length > EXECUTION_PERFORMANCE_DIAGNOSTIC_MAX_SAMPLES) {
      this.executionPerformanceDiagnostics.splice(
        0,
        this.executionPerformanceDiagnostics.length - EXECUTION_PERFORMANCE_DIAGNOSTIC_MAX_SAMPLES
      );
    }
  }

  private startHostEventLoopLagMonitor(): void {
    this.hostEventLoopLagMonitorExpectedAtMs = Date.now() + EXECUTION_HOST_EVENT_LOOP_LAG_INTERVAL_MS;
    const tick = (): void => {
      const now = Date.now();
      const lagMs = Math.max(0, now - this.hostEventLoopLagMonitorExpectedAtMs);
      if (lagMs >= EXECUTION_HOST_EVENT_LOOP_LAG_REPORT_THRESHOLD_MS) {
        this.recordExecutionPerformanceDiagnostics({
          timestamp: new Date(now).toISOString(),
          source: 'host-event-loop-lag',
          reason: 'timer-lag',
          durationMs: lagMs,
          controllerCount: this.agentSessions.size + this.terminalSessions.size,
          success: true
        });
      }
      this.hostEventLoopLagMonitorExpectedAtMs = now + EXECUTION_HOST_EVENT_LOOP_LAG_INTERVAL_MS;
      this.hostEventLoopLagMonitorTimer = setTimeout(tick, EXECUTION_HOST_EVENT_LOOP_LAG_INTERVAL_MS);
    };
    this.hostEventLoopLagMonitorTimer = setTimeout(tick, EXECUTION_HOST_EVENT_LOOP_LAG_INTERVAL_MS);
  }

  private recordStatePersistPerformance(
    reason: string,
    startedAt: number,
    state: unknown,
    bytes?: number,
    options: {
      mode?: CanvasStatePersistMode;
      workspaceStateMode?: CanvasWorkspaceStatePersistMode;
      coalescedCount?: number;
    } = {}
  ): void {
    const durationMs = Date.now() - startedAt;
    if (durationMs < EXECUTION_PERFORMANCE_HOST_OUTPUT_MIN_DURATION_MS) {
      return;
    }

    this.recordExecutionPerformanceDiagnostics({
      timestamp: new Date().toISOString(),
      source: 'host-state-persist',
      reason,
      durationMs,
      bytes,
      lifecycleStatus: options.mode,
      workspaceStateMode: options.workspaceStateMode,
      queuedWriteCount: options.coalescedCount,
      ...summarizeCanvasStatePerformanceDetail(state)
    });
  }

  private recordDiagnosticEvent(kind: string, detail?: Record<string, unknown>): void {
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
    sourceWebview: vscode.Webview | undefined,
    requestId: string,
    snapshot: WebviewProbeSnapshot,
    lifecycle?: WebviewLifecycleIdentity
  ): void {
    const pendingRequest = this.pendingWebviewProbeRequests.get(requestId);
    if (!pendingRequest) {
      return;
    }

    if (!this.matchesPendingWebviewRequestLifecycle(pendingRequest, lifecycle)) {
      this.recordDiagnosticEvent('webview/staleProbeResultIgnored', {
        surface,
        requestId,
        lifecycle: summarizeWebviewLifecycleIdentity(lifecycle),
        pendingLifecycle: summarizeWebviewLifecycleIdentity(pendingRequest.lifecycle)
      });
      return;
    }

    if (!this.matchesPendingWebviewRequestSource(pendingRequest, sourceWebview)) {
      this.recordDiagnosticEvent('webview/staleProbeResultIgnored', {
        surface,
        requestId,
        reason: 'source-webview-mismatch',
        lifecycle: summarizeWebviewLifecycleIdentity(lifecycle),
        pendingLifecycle: summarizeWebviewLifecycleIdentity(pendingRequest.lifecycle)
      });
      return;
    }

    if (pendingRequest.surface !== surface) {
      clearTimeout(pendingRequest.timeout);
      this.pendingWebviewProbeRequests.delete(requestId);
      pendingRequest.reject(new Error(`收到来自 ${surface} 的 probe 结果，但请求原本发往 ${pendingRequest.surface}。`));
      return;
    }

    clearTimeout(pendingRequest.timeout);
    this.pendingWebviewProbeRequests.delete(requestId);
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
    sourceWebview: vscode.Webview | undefined,
    requestId: string,
    ok: boolean,
    errorMessage: string | undefined,
    lifecycle?: WebviewLifecycleIdentity
  ): void {
    const pendingRequest = this.pendingWebviewDomActionRequests.get(requestId);
    if (!pendingRequest) {
      return;
    }

    if (!this.matchesPendingWebviewRequestLifecycle(pendingRequest, lifecycle)) {
      this.recordDiagnosticEvent('webview/staleDomActionResultIgnored', {
        surface,
        requestId,
        lifecycle: summarizeWebviewLifecycleIdentity(lifecycle),
        pendingLifecycle: summarizeWebviewLifecycleIdentity(pendingRequest.lifecycle)
      });
      return;
    }

    if (!this.matchesPendingWebviewRequestSource(pendingRequest, sourceWebview)) {
      this.recordDiagnosticEvent('webview/staleDomActionResultIgnored', {
        surface,
        requestId,
        reason: 'source-webview-mismatch',
        lifecycle: summarizeWebviewLifecycleIdentity(lifecycle),
        pendingLifecycle: summarizeWebviewLifecycleIdentity(pendingRequest.lifecycle)
      });
      return;
    }

    if (pendingRequest.surface !== surface) {
      clearTimeout(pendingRequest.timeout);
      this.pendingWebviewDomActionRequests.delete(requestId);
      pendingRequest.reject(
        new Error(`收到来自 ${surface} 的 DOM 动作结果，但请求原本发往 ${pendingRequest.surface}。`)
      );
      return;
    }

    clearTimeout(pendingRequest.timeout);
    this.pendingWebviewDomActionRequests.delete(requestId);
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

  private matchesPendingWebviewRequestLifecycle(
    pendingRequest: { lifecycle?: WebviewLifecycleIdentity },
    lifecycle: WebviewLifecycleIdentity | undefined
  ): boolean {
    if (!pendingRequest.lifecycle) {
      return true;
    }

    if (!lifecycle) {
      return false;
    }

    return (
      pendingRequest.lifecycle.surface === lifecycle.surface &&
      pendingRequest.lifecycle.mode === lifecycle.mode &&
      pendingRequest.lifecycle.generation === lifecycle.generation &&
      areSurfaceLifecycleFrameIdsCompatible(pendingRequest.lifecycle.frameId, lifecycle.frameId)
    );
  }

  private matchesPendingWebviewRequestSource(
    pendingRequest: { webview?: vscode.Webview },
    sourceWebview: vscode.Webview | undefined
  ): boolean {
    return !pendingRequest.webview || !sourceWebview || pendingRequest.webview === sourceWebview;
  }
}

function createDefaultState(defaultAgentProvider: AgentProviderKind = 'codex'): CanvasPrototypeState {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    nodes: [],
    edges: [],
    fileReferences: [],
    groups: [],
    nextGroupSequence: 1,
    suppressedFileActivityEdgeIds: [],
    suppressedAutomaticFileArtifactNodeIds: []
  };
}

function clearFileDomainState(state: CanvasPrototypeState): CanvasPrototypeState {
  const retainedNodes = state.nodes.filter((node) => node.kind !== 'file' && node.kind !== 'file-list');
  const retainedNodeIds = new Set(retainedNodes.map((node) => node.id));
  const retainedEdges = state.edges.filter(
    (edge) =>
      edge.owner !== 'file-activity' &&
      retainedNodeIds.has(edge.sourceNodeId) &&
      retainedNodeIds.has(edge.targetNodeId)
  );

  return {
    ...state,
    nodes: retainedNodes,
    edges: retainedEdges,
    groups: state.groups ?? [],
    nextGroupSequence: state.nextGroupSequence ?? readNextGroupSequence(state),
    fileReferences: [],
    suppressedFileActivityEdgeIds: [],
    suppressedAutomaticFileArtifactNodeIds: []
  };
}

function cloneJsonValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function buildExecutionFileLinkResolveDiagnostics(
  candidates: readonly ExecutionTerminalFileLinkCandidate[],
  filteredCandidates: readonly ExecutionTerminalFileLinkCandidate[],
  resolvedCount: number,
  durationMs: number,
  skippedReason?: ExecutionFileLinkResolveDiagnostics['skippedReason'],
  options: {
    priority?: ExecutionTerminalFileLinkResolvePriority;
    cacheHitCount?: number;
    cacheMissCount?: number;
    cachePendingCount?: number;
  } = {}
): ExecutionFileLinkResolveDiagnostics {
  const sourceCounts = countExecutionFileLinkResolveCandidateSources(candidates);
  const retainedSourceCounts = countExecutionFileLinkResolveCandidateSources(filteredCandidates);
  const filteredCandidateIds = new Set(filteredCandidates.map((candidate) => candidate.candidateId));
  const removedCandidates = candidates.filter(
    (candidate) => !filteredCandidateIds.has(candidate.candidateId)
  );
  const filteredSourceCounts = countExecutionFileLinkResolveCandidateSources(removedCandidates);
  const toCandidateDiagnostic = (
    candidate: ExecutionTerminalFileLinkCandidate
  ): ExecutionFileLinkResolveCandidateDiagnostic => ({
    text: candidate.text,
    path: candidate.path,
    source: candidate.source,
    bufferStartLine: candidate.bufferStartLine,
    line: candidate.line,
    column: candidate.column
  });

  return {
    candidateCount: candidates.length,
    retainedCandidateCount: filteredCandidates.length,
    filteredCandidateCount: removedCandidates.length,
    resolvedCount,
    durationMs,
    sourceCounts,
    retainedSourceCounts,
    filteredSourceCounts,
    candidates: candidates.map(toCandidateDiagnostic),
    retainedCandidates: filteredCandidates.map(toCandidateDiagnostic),
    filteredCandidates: removedCandidates.map(toCandidateDiagnostic),
    skippedReason,
    priority: options.priority,
    cacheHitCount: options.cacheHitCount,
    cacheMissCount: options.cacheMissCount,
    cachePendingCount: options.cachePendingCount
  };
}

function countExecutionFileLinkResolveCandidateSources(
  candidates: readonly ExecutionTerminalFileLinkCandidate[]
): Partial<Record<ExecutionTerminalFileLinkSource, number>> {
  const sourceCounts: Partial<Record<ExecutionTerminalFileLinkSource, number>> = {};
  for (const candidate of candidates) {
    sourceCounts[candidate.source] = (sourceCounts[candidate.source] ?? 0) + 1;
  }

  return sourceCounts;
}

function summarizeExecutionFileLinkResolveDiagnostics(
  samples: readonly ExecutionFileLinkResolveDiagnosticSample[]
): ExecutionFileLinkResolveDiagnosticsSummary {
  const summary: ExecutionFileLinkResolveDiagnosticsSummary = {
    requestCount: samples.length,
    candidateCount: 0,
    retainedCandidateCount: 0,
    filteredCandidateCount: 0,
    resolvedCount: 0,
    totalDurationMs: 0,
    maxDurationMs: 0,
    slowRequestCount: 0,
    sourceCounts: {},
    retainedSourceCounts: {},
    filteredSourceCounts: {},
    skippedReasonCounts: {},
    priorityCounts: {},
    cacheHitCount: 0,
    cacheMissCount: 0,
    cachePendingCount: 0,
    latestRequests: samples.slice(-20).map((sample) => cloneJsonValue(sample))
  };

  for (const sample of samples) {
    summary.candidateCount += sample.candidateCount;
    summary.retainedCandidateCount += sample.retainedCandidateCount;
    summary.filteredCandidateCount += sample.filteredCandidateCount;
    summary.resolvedCount += sample.resolvedCount;
    summary.totalDurationMs += sample.durationMs;
    summary.maxDurationMs = Math.max(summary.maxDurationMs, sample.durationMs);
    if (sample.durationMs >= 100) {
      summary.slowRequestCount += 1;
    }

    for (const [source, count] of Object.entries(sample.sourceCounts) as Array<
      [ExecutionTerminalFileLinkSource, number]
    >) {
      summary.sourceCounts[source] = (summary.sourceCounts[source] ?? 0) + count;
    }

    for (const [source, count] of Object.entries(sample.retainedSourceCounts) as Array<
      [ExecutionTerminalFileLinkSource, number]
    >) {
      summary.retainedSourceCounts[source] = (summary.retainedSourceCounts[source] ?? 0) + count;
    }

    for (const [source, count] of Object.entries(sample.filteredSourceCounts) as Array<
      [ExecutionTerminalFileLinkSource, number]
    >) {
      summary.filteredSourceCounts[source] = (summary.filteredSourceCounts[source] ?? 0) + count;
    }

    if (sample.skippedReason) {
      summary.skippedReasonCounts[sample.skippedReason] =
        (summary.skippedReasonCounts[sample.skippedReason] ?? 0) + 1;
    }

    if (sample.priority) {
      summary.priorityCounts[sample.priority] =
        (summary.priorityCounts[sample.priority] ?? 0) + 1;
    }

    summary.cacheHitCount += sample.cacheHitCount ?? 0;
    summary.cacheMissCount += sample.cacheMissCount ?? 0;
    summary.cachePendingCount += sample.cachePendingCount ?? 0;
  }

  return summary;
}

function shouldRetainExecutionPerformanceDiagnosticSample(
  sample: ExecutionPerformanceDiagnosticSample
): boolean {
  if (sample.success === false) {
    return true;
  }

  if (sample.source === 'host-input-write') {
    return (sample.durationMs ?? 0) >= EXECUTION_PERFORMANCE_HOST_INPUT_WRITE_MIN_DURATION_MS;
  }

  if (sample.source === 'host-input-received') {
    return (sample.queueDelayMs ?? sample.durationMs ?? 0) >= EXECUTION_PERFORMANCE_HOST_INPUT_WRITE_MIN_DURATION_MS;
  }

  if (sample.source === 'host-event-loop-lag') {
    return (sample.durationMs ?? 0) >= EXECUTION_HOST_EVENT_LOOP_LAG_REPORT_THRESHOLD_MS;
  }

  if (sample.source === 'host-output-scheduler') {
    return (
      sample.reason !== 'flush' ||
      (sample.durationMs ?? 0) >= EXECUTION_PERFORMANCE_HOST_OUTPUT_MIN_DURATION_MS ||
      (sample.characters ?? 0) >= EXECUTION_PERFORMANCE_HOST_OUTPUT_MIN_CHARACTERS ||
      (sample.pendingOutputLength ?? 0) >= EXECUTION_PERFORMANCE_HOST_OUTPUT_MIN_CHARACTERS
    );
  }

  if (sample.source === 'webview-output-snapshot-reset') {
    return (
      sample.success !== true ||
      sample.reason !== 'output-deferred-until-snapshot-reset' ||
      (sample.pendingOutputLength ?? sample.characters ?? 0) >= EXECUTION_PERFORMANCE_HOST_OUTPUT_MIN_CHARACTERS
    );
  }

  if (sample.source === 'host-output-chunk' || sample.source === 'host-output-post') {
    return (
      (sample.durationMs ?? 0) >= EXECUTION_PERFORMANCE_HOST_OUTPUT_MIN_DURATION_MS ||
      (sample.characters ?? 0) >= EXECUTION_PERFORMANCE_HOST_OUTPUT_MIN_CHARACTERS
    );
  }

  return true;
}

function summarizeExecutionPerformanceDiagnostics(
  samples: readonly ExecutionPerformanceDiagnosticSample[]
): ExecutionPerformanceDiagnosticsSummary {
  const summary: ExecutionPerformanceDiagnosticsSummary = {
    sampleCount: samples.length,
    sourceCounts: {},
    totalDurationMs: 0,
    maxDurationMs: 0,
    slowSampleCount: 0,
    totalCharacters: 0,
    totalBytes: 0,
    latestSamples: samples.slice(-50).map((sample) => cloneJsonValue(sample))
  };

  for (const sample of samples) {
    summary.sourceCounts[sample.source] = (summary.sourceCounts[sample.source] ?? 0) + 1;
    const durationMs = sample.durationMs ?? 0;
    summary.totalDurationMs += durationMs;
    summary.maxDurationMs = Math.max(summary.maxDurationMs, durationMs);
    if (durationMs >= 24) {
      summary.slowSampleCount += 1;
    }
    summary.totalCharacters += sample.characters ?? 0;
    summary.totalBytes += sample.bytes ?? 0;
  }

  summary.totalDurationMs = Math.round(summary.totalDurationMs * 100) / 100;
  summary.maxDurationMs = Math.round(summary.maxDurationMs * 100) / 100;
  return summary;
}

function getUriDirectory(uri: vscode.Uri): vscode.Uri {
  const directoryPath = path.posix.dirname(uri.path);
  return uri.with({ path: directoryPath || '/' });
}

function findCanvasTemplateById(
  templates: readonly CanvasStoredTemplate[],
  templateId: string
): CanvasStoredTemplate | undefined {
  return templates.find((template) => template.template.id === templateId);
}

function resolveEffectiveCanvasTemplateId(
  templates: readonly CanvasStoredTemplate[],
  preferredTemplateId: string
): string | undefined {
  return (
    findCanvasTemplateById(templates, preferredTemplateId)?.template.id ??
    findCanvasTemplateById(templates, DEFAULT_BUILTIN_CANVAS_TEMPLATE_ID)?.template.id ??
    templates[0]?.template.id
  );
}

function buildCanvasTemplateMenuEntries(
  templates: readonly CanvasStoredTemplate[],
  defaultTemplateId: string | undefined
): CanvasTemplateMenuEntry[] {
  return templates.map((storedTemplate) => ({
    templateId: storedTemplate.template.id,
    name: storedTemplate.template.name,
    category: storedTemplate.template.category,
    statsLabel: formatCanvasTemplateStats(storedTemplate.template),
    isDefault: storedTemplate.template.id === defaultTemplateId
  }));
}

function summarizeCanvasStateForDiagnostics(rawState: unknown): Record<string, unknown> {
  if (!isRecord(rawState)) {
    return {
      stateHash: buildDiagnosticStateHash(rawState)
    };
  }

  const rawNodes = Array.isArray(rawState.nodes) ? rawState.nodes : [];
  const rawGroups = Array.isArray(rawState.groups) ? rawState.groups : [];
  const nodeIds = rawNodes
    .map((node) => (isRecord(node) && typeof node.id === 'string' ? node.id : undefined))
    .filter((nodeId): nodeId is string => Boolean(nodeId))
    .slice(0, 8);
  const rootGroups = rawGroups
    .filter((group) => isRecord(group) && group.role === 'workspace-root')
    .map((group) => ({
      groupId: typeof group.id === 'string' ? group.id : undefined,
      workspaceRootPath: typeof group.workspaceRootPath === 'string' ? group.workspaceRootPath : undefined,
      position: isRecord(group.position) ? group.position : undefined,
      size: isRecord(group.size) ? group.size : undefined
    }))
    .slice(0, 8);

  return {
    stateHash: buildDiagnosticStateHash(rawState),
    nodeCount: rawNodes.length,
    groupCount: rawGroups.length,
    rootGroupCount: rootGroups.length,
    updatedAt: typeof rawState.updatedAt === 'string' ? rawState.updatedAt : undefined,
    nodeIds,
    rootGroups
  };
}

interface CanvasGroupMemberGeometryDiagnostics {
  count: number;
  sampleIds: string[];
  bounds?: CanvasRect;
}

function summarizeCanvasGroupGeometryForDiagnostics(
  state: CanvasPrototypeState,
  groupId: string
): Record<string, unknown> | undefined {
  const group = findCanvasGroupById(state, groupId);
  if (!group) {
    return undefined;
  }

  const directNodes = state.nodes.filter((node) => node.groupId === group.id);
  const directStableNodes = directNodes.filter((node) => isStableCanvasGroupMemberKind(node.kind));
  const directAutomaticNodes = directNodes.filter((node) => isAutomaticFileArtifactNodeKind(node.kind));
  const directChildGroups = (state.groups ?? []).filter((candidate) => candidate.parentGroupId === group.id);
  const memberInsets = memberInsetsForCanvasGroup(group);
  const memberRects = [...directNodes.map((node) => rectForNode(node)), ...directChildGroups.map((child) => rectForGroup(child))];
  const memberBounds = boundingRectForRects(memberRects);
  const requiredRect = memberBounds ? expandRectByInsets(memberBounds, memberInsets) : undefined;
  const groupRect = rectForGroup(group);

  return {
    groupId: group.id,
    title: group.title,
    role: group.role ?? 'user',
    workspaceRootPath: group.workspaceRootPath,
    parentGroupId: group.parentGroupId,
    position: group.position,
    size: group.size,
    rect: groupRect,
    directMemberInsets: memberInsets,
    directStableNodes: summarizeCanvasGroupMemberRectsForDiagnostics(directStableNodes),
    directAutomaticNodes: summarizeCanvasGroupMemberRectsForDiagnostics(directAutomaticNodes),
    directChildGroups: summarizeCanvasGroupMemberRectsForDiagnostics(directChildGroups),
    directMemberBounds: memberBounds,
    directMemberRequiredRect: requiredRect,
    directMembersContained: requiredRect ? rectContainsRect(groupRect, requiredRect) : true,
    containingWorkspaceRootGroupId: isWorkspaceRootGroup(group)
      ? group.id
      : resolveContainingWorkspaceRootGroupId(state.groups ?? [], group.parentGroupId),
    workspaceRootGroupCount: (state.groups ?? []).filter(isWorkspaceRootGroup).length
  };
}

function summarizeCanvasGroupMemberRectsForDiagnostics(
  items: readonly (CanvasNodeSummary | CanvasGroupSummary)[]
): CanvasGroupMemberGeometryDiagnostics {
  return {
    count: items.length,
    sampleIds: items.slice(0, 8).map((item) => item.id),
    bounds: boundingRectForRects(items.map((item) => rectForGroupOrNode(item)))
  };
}

function summarizeWorkspaceRootGroupsForDiagnostics(
  state: CanvasPrototypeState
): Record<string, unknown>[] {
  return (state.groups ?? [])
    .filter(isWorkspaceRootGroup)
    .map((group) => ({
      groupId: group.id,
      title: group.title,
      workspaceRootPath: group.workspaceRootPath,
      parentGroupId: group.parentGroupId,
      position: group.position,
      size: group.size
    }));
}

function summarizeCanvasMultiRootOverlayRootsForDiagnostics(
  overlay: CanvasMultiRootOverlay | undefined
): Record<string, unknown>[] {
  return (overlay?.roots ?? []).map((root) => ({
    rootPath: root.rootPath,
    position: root.position,
    size: root.size,
    parentGroupId: root.parentGroupId
  }));
}

function summarizeRootLocalStatesForDiagnostics(
  rootStates: readonly CanvasRootLocalStateSnapshot[]
): Record<string, unknown>[] {
  return rootStates.map((rootState) => ({
    rootPath: rootState.rootPath,
    stateHash: buildDiagnosticStateHash(rootState.state),
    updatedAt: rootState.state.updatedAt,
    nodeCount: rootState.state.nodes.length,
    groupCount: (rootState.state.groups ?? []).length,
    nodeBounds: boundingRectForRects(rootState.state.nodes.map((node) => rectForNode(node))),
    groupBounds: boundingRectForRects((rootState.state.groups ?? []).map((group) => rectForGroup(group)))
  }));
}

function findCanvasGroupById(
  state: Pick<CanvasPrototypeState, 'groups'>,
  groupId: string
): CanvasGroupSummary | undefined {
  return (state.groups ?? []).find((group) => group.id === groupId);
}

function rectForGroupOrNode(item: CanvasGroupSummary | CanvasNodeSummary): CanvasRect {
  return rectForGroup(item);
}

function canvasPositionsEqual(left: CanvasNodePosition, right: CanvasNodePosition): boolean {
  return Math.round(left.x) === Math.round(right.x) && Math.round(left.y) === Math.round(right.y);
}

function canvasFootprintsEqual(left: CanvasNodeFootprint, right: CanvasNodeFootprint): boolean {
  return (
    Math.round(left.width) === Math.round(right.width) &&
    Math.round(left.height) === Math.round(right.height)
  );
}

function summarizeCanvasStatePerformanceDetail(
  rawState: unknown
): Pick<ExecutionPerformanceDiagnosticPayload, 'controllerCount'> {
  const nodes = isRecord(rawState) && Array.isArray(rawState.nodes) ? rawState.nodes : [];
  return {
    controllerCount: nodes.length
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

function containsTerminalSuspendInput(data: string): boolean {
  return data.includes('\u001a');
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
  agentLaunchPreset: AgentLaunchPresetKind = 'default',
  agentCustomLaunchCommand?: string,
  preferredPosition?: CanvasNodePosition,
  targetGroupId?: string,
  cwdOverride?: string
): CanvasPrototypeState {
  const nextIndex = readNextNodeSequence(previousState.nodes);
  const nextNode = createNode(kind, nextIndex, agentProvider, agentLaunchPreset, agentCustomLaunchCommand);
  const resolvedPosition = resolveNewNodePosition(
    filterPlacementCollisionNodesForGroup(previousState.nodes, targetGroupId),
    kind,
    preferredPosition ?? nextNode.position
  );
  const validTargetGroupId = resolveValidTargetGroupId(previousState.groups ?? [], targetGroupId);
  const createdNodeBase = {
    ...nextNode,
    position: resolvedPosition,
    groupId: validTargetGroupId && isStableCanvasGroupMemberKind(kind) ? validTargetGroupId : undefined
  };
  const createdNode = applyExecutionCwdOverrideToCreatedNode(createdNodeBase, cwdOverride);

  const nextState = {
    ...previousState,
    updatedAt: new Date().toISOString(),
    nodes: [...previousState.nodes, createdNode]
  };

  return finalizeCanvasGroupState(nextState);
}

function defaultSummaryForKind(kind: CanvasNodeKind): string {
  switch (kind) {
    case 'agent':
      return '尚未启动 Agent 会话。';
    case 'terminal':
      return '尚未启动嵌入式终端。';
    case 'note':
      return '等待记录笔记内容。';
    case 'file':
      return '最近被 Agent 访问的文件。';
    case 'file-list':
      return '按 Agent 聚合的文件活动列表。';
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
    case 'file':
      return 'linked';
    case 'file-list':
      return 'linked';
  }
}

function createNode(
  kind: CanvasNodeKind,
  sequence: number,
  agentProvider: AgentProviderKind = 'codex',
  agentLaunchPreset: AgentLaunchPresetKind = 'default',
  agentCustomLaunchCommand?: string
): CanvasNodeSummary {
  const titlePrefix = {
    agent: 'Agent',
    terminal: 'Terminal',
    note: 'Note',
    file: 'File',
    'file-list': 'File List'
  } satisfies Record<CanvasNodeKind, string>;

  const id = createCanvasNodeObjectId(kind, sequence);
  return {
    id,
    kind,
    title: `${titlePrefix[kind]} ${sequence}`,
    status: defaultStatusForKind(kind),
    summary: defaultSummaryForKind(kind),
    position: createNodePosition(sequence),
    size: estimatedCanvasNodeFootprint(kind),
    metadata: createNodeMetadata(kind, id, agentProvider, agentLaunchPreset, agentCustomLaunchCommand)
  };
}

function applyExecutionCwdOverrideToCreatedNode(
  node: CanvasNodeSummary,
  cwdOverride: string | undefined
): CanvasNodeSummary {
  if (!cwdOverride) {
    return node;
  }

  if (node.kind === 'agent') {
    return {
      ...node,
      metadata: {
        ...node.metadata,
        agent: {
          ...ensureAgentMetadata(node),
          cwd: cwdOverride
        }
      }
    };
  }

  if (node.kind === 'terminal') {
    return {
      ...node,
      metadata: {
        ...node.metadata,
        terminal: {
          ...ensureTerminalMetadata(node),
          cwd: cwdOverride
        }
      }
    };
  }

  return node;
}

function createCanvasNodeObjectId(kind: CanvasNodeKind, sequence: number): string {
  return `${kind}-${sequence}-${randomUUID()}`;
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
  anchor: CanvasNodePosition,
  preference: NodePlacementPreference = 'right-down'
): CanvasNodePosition {
  const normalizedAnchor = snapCanvasPosition(anchor);

  for (const candidate of buildPlacementCandidates(normalizedAnchor, preference)) {
    if (!doesPlacementCollide(existingNodes, kind, candidate)) {
      return candidate;
    }
  }

  return fallbackPlacementPosition(existingNodes, kind, normalizedAnchor, preference);
}

function filterPlacementCollisionNodesForGroup(
  nodes: readonly CanvasNodeSummary[],
  targetGroupId?: string
): CanvasNodeSummary[] {
  if (!targetGroupId) {
    return [...nodes];
  }

  return nodes.filter((node) => node.groupId === targetGroupId);
}

function buildPlacementCandidates(
  anchor: CanvasNodePosition,
  preference: NodePlacementPreference
): CanvasNodePosition[] {
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
    const leftHorizontalRank = resolvePlacementAxisRank(left.dx, preference === 'left-up' ? 'negative' : 'positive');
    const rightHorizontalRank = resolvePlacementAxisRank(right.dx, preference === 'left-up' ? 'negative' : 'positive');
    const leftVerticalRank = resolvePlacementAxisRank(left.dy, preference === 'left-up' ? 'negative' : 'positive');
    const rightVerticalRank = resolvePlacementAxisRank(right.dy, preference === 'left-up' ? 'negative' : 'positive');
    const leftPreferenceRank = leftHorizontalRank + leftVerticalRank;
    const rightPreferenceRank = rightHorizontalRank + rightVerticalRank;

    if (leftPreferenceRank !== rightPreferenceRank) {
      return leftPreferenceRank - rightPreferenceRank;
    }

    if (leftHorizontalRank !== rightHorizontalRank) {
      return leftHorizontalRank - rightHorizontalRank;
    }

    if (leftVerticalRank !== rightVerticalRank) {
      return leftVerticalRank - rightVerticalRank;
    }

    if (left.distance !== right.distance) {
      return left.distance - right.distance;
    }

    if (left.backwardBias !== right.backwardBias) {
      return left.backwardBias - right.backwardBias;
    }

    if (Math.abs(left.dy) !== Math.abs(right.dy)) {
      return Math.abs(left.dy) - Math.abs(right.dy);
    }

    if (Math.abs(left.dx) !== Math.abs(right.dx)) {
      return Math.abs(left.dx) - Math.abs(right.dx);
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

function resolvePlacementAxisRank(value: number, preferredSign: 'negative' | 'positive'): number {
  if (value === 0) {
    return 1;
  }

  const matchesPreferred = preferredSign === 'negative' ? value < 0 : value > 0;
  return matchesPreferred ? 0 : 2;
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
  normalizedAnchor: CanvasNodePosition,
  preference: NodePlacementPreference
): CanvasNodePosition {
  if (existingNodes.length === 0) {
    return normalizedAnchor;
  }

  const bounds = existingNodes.reduce(
    (current, node) => {
      const rect = createPlacementRect(node.position, node.size);
      return {
        maxRight: Math.max(current.maxRight, rect.right),
        minLeft: Math.min(current.minLeft, rect.left),
        minTop: Math.min(current.minTop, rect.top),
        maxBottom: Math.max(current.maxBottom, rect.bottom)
      };
    },
    {
      maxRight: Number.NEGATIVE_INFINITY,
      minLeft: Number.POSITIVE_INFINITY,
      minTop: Number.POSITIVE_INFINITY,
      maxBottom: Number.NEGATIVE_INFINITY
    }
  );
  const nextFootprint = estimatedCanvasNodeFootprint(kind);

  if (preference === 'left-up') {
    return snapCanvasPosition({
      x: bounds.minLeft - nextFootprint.width - NODE_PLACEMENT_PADDING,
      y: Math.min(
        bounds.minTop - nextFootprint.height - NODE_PLACEMENT_PADDING,
        normalizedAnchor.y - Math.round(nextFootprint.height / 3)
      )
    });
  }

  return snapCanvasPosition({
    x: bounds.maxRight + NODE_PLACEMENT_PADDING,
    y: Math.max(bounds.maxBottom - Math.round(nextFootprint.height / 2), normalizedAnchor.y)
  });
}

function applyCanvasTemplateToState(
  previousState: CanvasPrototypeState,
  template: CanvasTemplate,
  options: {
    preferredCenter?: CanvasNodePosition;
    targetGroupId?: string;
    resolvedAgentProviders: Map<number, AgentProviderKind>;
    noteMaterializations?: ReadonlyMap<number, CanvasTemplateNoteMaterialization>;
    executionCwdOverride?: string;
  }
): CanvasTemplateApplyStateResult {
  const bounds = measureCanvasTemplateBounds(template.nodes);
  const centeredTopLeft = snapCanvasPosition({
    x: (options.preferredCenter?.x ?? 0) - Math.round(bounds.width / 2),
    y: (options.preferredCenter?.y ?? 0) - Math.round(bounds.height / 2)
  });
  const resolvedTopLeft =
    previousState.nodes.length === 0
      ? centeredTopLeft
      : resolveTemplatePlacementTopLeft(previousState.nodes, template.nodes, centeredTopLeft);

  let nextSequence = readNextNodeSequence(previousState.nodes);
  let nextGroupSequence = readNextGroupSequence(previousState);
  const groupIdByTemplateIndex = new Map<number, string>();
  const templateGroups = template.groups ?? [];
  for (const [index] of templateGroups.entries()) {
    const groupId = createCanvasGroupObjectId(nextGroupSequence);
    nextGroupSequence += 1;
    groupIdByTemplateIndex.set(index, groupId);
  }
  const parentGroupIndexByTemplateIndex = resolveTemplateGroupParentIndexesForApply(templateGroups);
  const materializedGroups = templateGroups.map((templateGroup, index) => {
    const groupId = groupIdByTemplateIndex.get(index);
    if (!groupId) {
      return undefined;
    }
    return materializeTemplateGroup(
      groupId,
      templateGroup,
      bounds.origin,
      resolvedTopLeft,
      groupIdByTemplateIndex,
      parentGroupIndexByTemplateIndex.get(index),
      options.targetGroupId
    );
  }).filter((group): group is CanvasGroupSummary => Boolean(group));
  const nodeIdByTemplateIndex = new Map<number, string>();
  const materializedNodes = template.nodes.map((templateNode, index) => {
    const resolvedAgentProvider =
      templateNode.kind === 'agent'
        ? options.resolvedAgentProviders.get(index) ?? 'codex'
        : undefined;
    const baseNode = createNode(
      templateNode.kind,
      nextSequence,
      resolvedAgentProvider ?? 'codex'
    );
    nextSequence += 1;
    nodeIdByTemplateIndex.set(index, baseNode.id);

    return materializeTemplateNode(
      baseNode,
      templateNode,
      bounds.origin,
      resolvedTopLeft,
      resolvedAgentProvider,
      templateNode.kind === 'note' ? options.noteMaterializations?.get(index) : undefined,
      options.executionCwdOverride
    );
  });
  const materializedNodesWithGroups = materializedNodes.map((node, index) => {
    const groupIndex = template.nodes[index]?.groupIndex;
    const groupId = groupIndex === undefined ? options.targetGroupId : groupIdByTemplateIndex.get(groupIndex);
    return groupId
      ? {
          ...node,
          groupId
        }
      : node;
  });

  const materializedEdges = template.edges.flatMap((edge) => {
    const sourceNodeId = nodeIdByTemplateIndex.get(edge.sourceNodeIndex);
    const targetNodeId = nodeIdByTemplateIndex.get(edge.targetNodeIndex);
    if (!sourceNodeId || !targetNodeId) {
      return [];
    }

    return [
      {
        id: `edge-${randomUUID()}`,
        sourceNodeId,
        targetNodeId,
        sourceAnchor: edge.sourceAnchor,
        targetAnchor: edge.targetAnchor,
        arrowMode: edge.arrowMode,
        owner: 'user' as const,
        color: edge.color,
        label: edge.label
      }
    ];
  });

  const nextState = finalizeCanvasGroupState({
    ...previousState,
    updatedAt: new Date().toISOString(),
    nodes: [...previousState.nodes, ...materializedNodesWithGroups],
    edges: [...previousState.edges, ...materializedEdges],
    groups: [...(previousState.groups ?? []), ...materializedGroups],
    nextGroupSequence
  });

  return {
    state: nextState,
    nodeIds: materializedNodes.map((node) => node.id)
  };
}

function resolveTemplatePlacementCenterInWorkspaceRoot(
  rootGroup: CanvasGroupSummary,
  template: CanvasTemplate,
  preferredCenter?: CanvasNodePosition
): CanvasNodePosition {
  if (preferredCenter && rectContainsPoint(rectForGroup(rootGroup), preferredCenter)) {
    return preferredCenter;
  }

  const templateBounds = measureCanvasTemplateBounds(template.nodes);
  return translateRootLocalCanvasPositionToComposed({
    x: Math.round(templateBounds.width / 2),
    y: Math.round(templateBounds.height / 2)
  }, rootGroup);
}

function materializeTemplateGroup(
  groupId: string,
  templateGroup: NonNullable<CanvasTemplate['groups']>[number],
  templateOrigin: CanvasNodePosition,
  placedTopLeft: CanvasNodePosition,
  groupIdByTemplateIndex: ReadonlyMap<number, string>,
  parentGroupIndex: number | undefined,
  rootParentGroupId?: string
): CanvasGroupSummary {
  return {
    id: groupId,
    title: templateGroup.title,
    position: snapCanvasPosition({
      x: placedTopLeft.x + (templateGroup.position.x - templateOrigin.x),
      y: placedTopLeft.y + (templateGroup.position.y - templateOrigin.y)
    }),
    size: normalizeCanvasGroupFootprint(templateGroup.size),
    parentGroupId:
      parentGroupIndex === undefined
        ? rootParentGroupId
        : groupIdByTemplateIndex.get(parentGroupIndex)
  };
}

function resolveTemplateGroupParentIndexesForApply(
  templateGroups: readonly NonNullable<CanvasTemplate['groups']>[number][]
): Map<number, number> {
  const parentIndexByGroupIndex = new Map<number, number>();

  for (const [index, templateGroup] of templateGroups.entries()) {
    const parentGroupIndex = templateGroup.parentGroupIndex;
    if (
      parentGroupIndex === undefined ||
      !Number.isInteger(parentGroupIndex) ||
      parentGroupIndex < 0 ||
      parentGroupIndex >= templateGroups.length ||
      parentGroupIndex === index
    ) {
      continue;
    }

    if (!wouldCreateTemplateGroupParentCycle(parentIndexByGroupIndex, index, parentGroupIndex)) {
      parentIndexByGroupIndex.set(index, parentGroupIndex);
    }
  }

  return parentIndexByGroupIndex;
}

function wouldCreateTemplateGroupParentCycle(
  parentIndexByGroupIndex: ReadonlyMap<number, number>,
  groupIndex: number,
  parentGroupIndex: number
): boolean {
  let nextParentIndex: number | undefined = parentGroupIndex;
  const visited = new Set<number>();

  while (nextParentIndex !== undefined) {
    if (nextParentIndex === groupIndex || visited.has(nextParentIndex)) {
      return true;
    }

    visited.add(nextParentIndex);
    nextParentIndex = parentIndexByGroupIndex.get(nextParentIndex);
  }

  return false;
}

function materializeTemplateNode(
  baseNode: CanvasNodeSummary,
  templateNode: CanvasTemplate['nodes'][number],
  templateOrigin: CanvasNodePosition,
  placedTopLeft: CanvasNodePosition,
  resolvedAgentProvider?: AgentProviderKind,
  noteMaterialization?: CanvasTemplateNoteMaterialization,
  executionCwdOverride?: string
): CanvasNodeSummary {
  const position = snapCanvasPosition({
    x: placedTopLeft.x + (templateNode.position.x - templateOrigin.x),
    y: placedTopLeft.y + (templateNode.position.y - templateOrigin.y)
  });

  if (templateNode.kind === 'note') {
    const isAssociatedMarkdownNote = noteMaterialization?.contentSource?.kind === 'markdown-file';
    const content = isAssociatedMarkdownNote
      ? noteMaterialization.content
      : trimStoredNodeText(noteMaterialization?.content ?? templateNode.metadata?.note?.content ?? '');
    const associatedSource = isAssociatedMarkdownNote
      ? noteMaterialization.contentSource as MarkdownFileNoteContentSource
      : undefined;
    const status = associatedSource
      ? associatedSource.status === 'ok'
        ? 'ready'
        : associatedSource.status
      : 'ready';
    const summary = associatedSource
      ? associatedSource.status === 'ok'
        ? summarizeNoteNode(content)
        : associatedSource.status === 'dirty-conflict'
          ? '关联文件存在编辑冲突。'
          : '关联文件不可用。'
      : summarizeNoteNode(content);
    return {
      ...baseNode,
      title: templateNode.title,
      position,
      size: normalizeCanvasNodeFootprint('note', templateNode.size),
      status,
      summary,
      metadata: {
        note: {
          content,
          contentSource: associatedSource
        }
      }
    };
  }

  if (templateNode.kind === 'agent') {
    const provider = resolvedAgentProvider ?? 'codex';
    const templateArgv = templateNode.metadata?.agent?.argv;
    const agentMetadata = createAgentMetadata(provider);
    return {
      ...baseNode,
      title: templateNode.title,
      position,
      size: normalizeCanvasNodeFootprint('agent', templateNode.size),
      status: 'idle',
      summary: defaultSummaryForKind('agent'),
      metadata: {
        agent: {
          ...agentMetadata,
          cwd: executionCwdOverride ?? agentMetadata.cwd,
          templateArgv: Array.isArray(templateArgv) ? normalizeStoredAgentTemplateArgv(templateArgv) : undefined
        }
      }
    };
  }

  const terminalMetadata = createTerminalMetadata(baseNode.id);
  return {
    ...baseNode,
    title: templateNode.title,
    position,
    size: normalizeCanvasNodeFootprint('terminal', templateNode.size),
    status: 'idle',
    summary: defaultSummaryForKind('terminal'),
    metadata: {
      terminal: {
        ...terminalMetadata,
        cwd: executionCwdOverride ?? terminalMetadata.cwd
      }
    }
  };
}

function measureCanvasTemplateBounds(nodes: readonly CanvasTemplate['nodes'][number][]): {
  origin: CanvasNodePosition;
  width: number;
  height: number;
} {
  const minX = Math.min(...nodes.map((node) => node.position.x));
  const minY = Math.min(...nodes.map((node) => node.position.y));
  const maxRight = Math.max(...nodes.map((node) => node.position.x + node.size.width));
  const maxBottom = Math.max(...nodes.map((node) => node.position.y + node.size.height));
  return {
    origin: {
      x: minX,
      y: minY
    },
    width: maxRight - minX,
    height: maxBottom - minY
  };
}

function resolveTemplatePlacementTopLeft(
  existingNodes: CanvasNodeSummary[],
  templateNodes: readonly CanvasTemplate['nodes'][number][],
  centeredTopLeft: CanvasNodePosition
): CanvasNodePosition {
  const normalizedAnchor = snapCanvasPosition(centeredTopLeft);
  for (const candidate of buildPlacementCandidates(normalizedAnchor, 'right-down')) {
    if (!doesTemplatePlacementCollide(existingNodes, templateNodes, candidate)) {
      return candidate;
    }
  }

  return fallbackTemplatePlacementTopLeft(existingNodes, templateNodes, normalizedAnchor);
}

function doesTemplatePlacementCollide(
  existingNodes: CanvasNodeSummary[],
  templateNodes: readonly CanvasTemplate['nodes'][number][],
  placedTopLeft: CanvasNodePosition
): boolean {
  const templateRects = buildTemplatePlacementRects(templateNodes, placedTopLeft);
  return existingNodes.some((node) => {
    const existingRect = createPlacementRect(node.position, node.size);
    return templateRects.some((templateRect) => placementRectsOverlap(templateRect, existingRect));
  });
}

function buildTemplatePlacementRects(
  templateNodes: readonly CanvasTemplate['nodes'][number][],
  placedTopLeft: CanvasNodePosition
): Array<{ left: number; top: number; right: number; bottom: number }> {
  const bounds = measureCanvasTemplateBounds(templateNodes);
  return templateNodes.map((node) =>
    createPlacementRect(
      {
        x: placedTopLeft.x + (node.position.x - bounds.origin.x),
        y: placedTopLeft.y + (node.position.y - bounds.origin.y)
      },
      node.size
    )
  );
}

function fallbackTemplatePlacementTopLeft(
  existingNodes: CanvasNodeSummary[],
  templateNodes: readonly CanvasTemplate['nodes'][number][],
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
        maxBottom: Math.max(current.maxBottom, rect.bottom)
      };
    },
    {
      maxRight: Number.NEGATIVE_INFINITY,
      maxBottom: Number.NEGATIVE_INFINITY
    }
  );
  const templateBounds = measureCanvasTemplateBounds(templateNodes);

  return snapCanvasPosition({
    x: bounds.maxRight + NODE_PLACEMENT_PADDING,
    y: Math.max(bounds.maxBottom - Math.round(templateBounds.height / 2), normalizedAnchor.y)
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
  position: CanvasNodePosition,
  pointerPosition?: CanvasNodePosition,
  selectedMoves: readonly CanvasNodeMoveIntent[] = []
): CanvasPrototypeState {
  const targetNode = previousState.nodes.find((node) => node.id === nodeId);
  const normalizedPrimaryPosition = normalizeCanvasMovePosition(position);
  const sharedPointerPosition = pointerPosition
    ? normalizeCanvasMovePosition(pointerPosition)
    : targetNode
      ? {
          x: normalizedPrimaryPosition.x + Math.round(targetNode.size.width / 2),
          y: normalizedPrimaryPosition.y + Math.round(targetNode.size.height / 2)
        }
      : undefined;
  // Multi-node drag is treated as a temporary cluster, so grouping uses one release point.
  const moveIntents = normalizeCanvasNodeMoveIntents([
    { id: nodeId, position: normalizedPrimaryPosition, pointerPosition: sharedPointerPosition },
    ...selectedMoves.map((intent) => ({
      ...intent,
      pointerPosition: sharedPointerPosition ?? intent.pointerPosition
    }))
  ]);
  if (moveIntents.length === 0) {
    return previousState;
  }

  const intentsById = new Map(moveIntents.map((intent) => [intent.id, intent] as const));
  const movedNodeIds = new Set(intentsById.keys());
  if (!previousState.nodes.some((node) => movedNodeIds.has(node.id))) {
    return previousState;
  }

  const nodes = previousState.nodes.map((node) => {
    const intent = intentsById.get(node.id);
    if (!intent) {
      return node;
    }

    const normalizedPosition = normalizeCanvasMovePosition(intent.position);
    const resolvedPointerPosition = intent.pointerPosition ?? {
      x: normalizedPosition.x + Math.round(node.size.width / 2),
      y: normalizedPosition.y + Math.round(node.size.height / 2)
    };

    return {
      ...node,
      position: normalizedPosition,
      groupId: isStableCanvasGroupMemberKind(node.kind)
        ? resolveDroppedObjectGroupId(previousState, node.id, 'node', resolvedPointerPosition)
        : isAutomaticFileArtifactNodeKind(node.kind)
          ? node.groupId
          : undefined
    };
  });

  const stateWithMovedNodes = applyOwnerDerivedAutomaticFileArtifactGroupIds({
    ...previousState,
    updatedAt: new Date().toISOString(),
    nodes
  });
  const movedState = adjustMovedNodesAfterGroupDrop(previousState, stateWithMovedNodes, movedNodeIds);
  const movedWorkspaceRootGroupIds = new Set(
    movedState.nodes
      .filter((node) => movedNodeIds.has(node.id) && node.groupId)
      .flatMap((node) => {
        const rootGroupId = resolveContainingWorkspaceRootGroupId(movedState.groups ?? [], node.groupId);
        return rootGroupId ? [rootGroupId] : [];
      })
  );
  const movedAutomaticFileArtifactGroupIds = new Set(
    movedState.nodes
      .filter((node) => movedNodeIds.has(node.id) && isAutomaticFileArtifactNodeKind(node.kind) && node.groupId)
      .map((node) => node.groupId as string)
  );

  return finalizeCanvasGroupState(movedState, {
    pinnedGroupIds: [
      ...movedAutomaticFileArtifactGroupIds,
      ...(movedWorkspaceRootGroupIds.size === 1 ? [...movedWorkspaceRootGroupIds] : [])
    ]
  });
}

function applyOwnerDerivedAutomaticFileArtifactGroupIds(
  state: CanvasPrototypeState
): CanvasPrototypeState {
  if (!state.nodes.some((node) => isAutomaticFileArtifactNodeKind(node.kind))) {
    return state;
  }

  const groups = state.groups ?? [];
  const ownerNodesById = new Map(
    state.nodes
      .filter((node) => !isAutomaticFileArtifactNodeKind(node.kind))
      .map((node) => [node.id, node] as const)
  );
  let didChange = false;
  const nodes = state.nodes.map((node) => {
    if (!isAutomaticFileArtifactNodeKind(node.kind)) {
      return node;
    }

    const nextGroupId = resolveAutomaticFileArtifactGroupId(
      node,
      ownerNodesById,
      groups,
      resolveContainingWorkspaceRootGroupId(groups, node.groupId)
    );
    if (nextGroupId === node.groupId) {
      return node;
    }

    didChange = true;
    return withCanvasNodeGroupId(node, nextGroupId);
  });

  return didChange
    ? {
        ...state,
        nodes
      }
    : state;
}

function normalizeCanvasNodeMoveIntents(intents: readonly CanvasNodeMoveIntent[]): CanvasNodeMoveIntent[] {
  const intentsById = new Map<string, CanvasNodeMoveIntent>();
  for (const intent of intents) {
    if (!intent.id) {
      continue;
    }

    intentsById.set(intent.id, {
      id: intent.id,
      position: normalizeCanvasMovePosition(intent.position),
      pointerPosition: intent.pointerPosition ? normalizeCanvasMovePosition(intent.pointerPosition) : undefined
    });
  }

  return [...intentsById.values()];
}

function normalizeCanvasMovePosition(position: CanvasNodePosition): CanvasNodePosition {
  return {
    x: Math.round(position.x),
    y: Math.round(position.y)
  };
}

function adjustMovedNodesAfterGroupDrop(
  previousState: CanvasPrototypeState,
  nextState: CanvasPrototypeState,
  movedNodeIds: ReadonlySet<string>
): CanvasPrototypeState {
  const previousNodesById = new Map(previousState.nodes.map((node) => [node.id, node] as const));
  const movedNodes = nextState.nodes.filter((node) => movedNodeIds.has(node.id));
  const targetGroupIds = new Set<string>();
  for (const node of movedNodes) {
    const previousNode = previousNodesById.get(node.id);
    if (node.groupId && node.groupId !== previousNode?.groupId) {
      targetGroupIds.add(node.groupId);
    }
  }

  if (targetGroupIds.size === 0) {
    return nextState;
  }

  const groupsById = new Map((nextState.groups ?? []).map((group) => [group.id, group] as const));
  const movedNodeIdSet = new Set(movedNodeIds);
  const placedNodesById = new Map(nextState.nodes.map((node) => [node.id, { ...node }] as const));

  for (const targetGroupId of targetGroupIds) {
    const targetGroup = groupsById.get(targetGroupId);
    if (!targetGroup || isWorkspaceRootGroup(targetGroup)) {
      continue;
    }

    const currentNodes = nextState.nodes.map((node) => placedNodesById.get(node.id) ?? node);
    const adjustedGroupNodes = preserveRepairTargetClusterWhileAvoidingSiblings(
      currentNodes.filter((node) => movedNodeIdSet.has(node.id) && node.groupId === targetGroupId),
      currentNodes.filter((node) => node.groupId === targetGroupId && !movedNodeIdSet.has(node.id)),
      rectForGroup(targetGroup)
    );
    for (const node of adjustedGroupNodes) {
      placedNodesById.set(node.id, node);
    }
  }

  return {
    ...nextState,
    nodes: nextState.nodes.map((node) => placedNodesById.get(node.id) ?? node)
  };
}

function preserveRepairTargetClusterWhileAvoidingSiblings(
  repairTargetNodes: readonly CanvasNodeSummary[],
  siblingNodes: readonly CanvasNodeSummary[],
  containerRect: CanvasRect
): CanvasNodeSummary[] {
  if (repairTargetNodes.length === 0 || siblingNodes.length === 0) {
    return [...repairTargetNodes];
  }

  const clusterRect = boundingRectForRects(repairTargetNodes.map((node) => rectForNode(node)));
  if (!clusterRect) {
    return [...repairTargetNodes];
  }

  const blockingRects = siblingNodes.map((node) => expandRectByPadding(rectForNode(node), CANVAS_NODE_COLLISION_PADDING));
  const candidateDeltas = buildClusterAvoidanceDeltas(clusterRect, blockingRects, containerRect);
  for (const delta of candidateDeltas) {
    const candidateNodes = repairTargetNodes.map((node) => translateNode(node, delta));
    const candidateRects = candidateNodes.map((node) => rectForNode(node));
    if (candidateRects.some((rect) => blockingRects.some((blockingRect) => rectsIntersect(rect, blockingRect)))) {
      continue;
    }

    return candidateNodes;
  }

  return [...repairTargetNodes];
}

function buildClusterAvoidanceDeltas(
  clusterRect: CanvasRect,
  blockingRects: readonly CanvasRect[],
  containerRect: CanvasRect
): CanvasNodePosition[] {
  const deltas: CanvasNodePosition[] = [{ x: 0, y: 0 }];
  for (const blockingRect of blockingRects) {
    if (!rectsIntersect(clusterRect, blockingRect)) {
      continue;
    }

    deltas.push(
      { x: Math.round(blockingRect.right - clusterRect.left), y: 0 },
      { x: Math.round(blockingRect.left - clusterRect.right), y: 0 },
      { x: 0, y: Math.round(blockingRect.bottom - clusterRect.top) },
      { x: 0, y: Math.round(blockingRect.top - clusterRect.bottom) }
    );
  }

  deltas.push(
    { x: Math.round(containerRect.left + CANVAS_GROUP_MEMBER_INSETS.left - clusterRect.left), y: 0 },
    { x: Math.round(containerRect.right - CANVAS_GROUP_MEMBER_INSETS.right - clusterRect.right), y: 0 },
    { x: 0, y: Math.round(containerRect.top + CANVAS_GROUP_MEMBER_INSETS.top - clusterRect.top) },
    { x: 0, y: Math.round(containerRect.bottom - CANVAS_GROUP_MEMBER_INSETS.bottom - clusterRect.bottom) }
  );

  return dedupeCanvasPositionDeltas(deltas).sort(
    (left, right) => Math.abs(left.x) + Math.abs(left.y) - (Math.abs(right.x) + Math.abs(right.y))
  );
}

function dedupeCanvasPositionDeltas(deltas: readonly CanvasNodePosition[]): CanvasNodePosition[] {
  const seen = new Set<string>();
  const uniqueDeltas: CanvasNodePosition[] = [];
  for (const delta of deltas) {
    const normalizedDelta = { x: Math.round(delta.x), y: Math.round(delta.y) };
    const key = `${normalizedDelta.x}:${normalizedDelta.y}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    uniqueDeltas.push(normalizedDelta);
  }

  return uniqueDeltas;
}

function resizeNode(
  previousState: CanvasPrototypeState,
  nodeId: string,
  position: CanvasNodePosition,
  size: CanvasNodeFootprint,
  view: Pick<CanvasFileViewConfiguration, 'displayStyle' | 'nodeDisplayMode' | 'pathDisplayMode'>
): CanvasPrototypeState {
  const targetNode = previousState.nodes.find((node) => node.id === nodeId);
  if (!targetNode) {
    return previousState;
  }

  const normalizedSize = normalizeCanvasNodeFootprintForPersistence(targetNode, size, view);
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

  return finalizeCanvasGroupState({
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
  });
}

function deleteCanvasNode(previousState: CanvasPrototypeState, nodeId: string): CanvasPrototypeState {
  const nextNodes = previousState.nodes.filter((node) => node.id !== nodeId);
  if (nextNodes.length === previousState.nodes.length) {
    return previousState;
  }

  const nextEdges = previousState.edges.filter(
    (edge) => edge.sourceNodeId !== nodeId && edge.targetNodeId !== nodeId
  );

  return {
    ...previousState,
    updatedAt: new Date().toISOString(),
    nodes: nextNodes,
    edges: nextEdges,
    groups: removeMissingGroupNodeMemberships(previousState.groups ?? [], nextNodes)
  };
}

interface CanvasRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface CanvasNodeMoveIntent {
  id: string;
  position: CanvasNodePosition;
  pointerPosition?: CanvasNodePosition;
}

function createCanvasGroupObjectId(sequence: number): string {
  return `group-${sequence}-${randomUUID()}`;
}

function createCanvasGroupWithSequence(
  sequence: number,
  position: CanvasNodePosition,
  size: CanvasNodeFootprint,
  parentGroupId?: string
): CanvasGroupSummary {
  return {
    id: createCanvasGroupObjectId(sequence),
    title: `Group ${sequence}`,
    position: {
      x: Math.round(position.x),
      y: Math.round(position.y)
    },
    size: normalizeCanvasGroupFootprint(size),
    parentGroupId
  };
}

function createEmptyCanvasGroup(
  previousState: CanvasPrototypeState,
  position: CanvasNodePosition,
  size?: CanvasNodeFootprint,
  parentGroupId?: string
): CanvasPrototypeState {
  const sequence = readNextGroupSequence(previousState);
  const resolvedParentGroupId = resolveValidTargetGroupId(previousState.groups ?? [], parentGroupId);
  const group = createCanvasGroupWithSequence(
    sequence,
    position,
    size ?? DEFAULT_CANVAS_GROUP_SIZE,
    resolvedParentGroupId
  );

  return finalizeCanvasGroupState({
    ...previousState,
    updatedAt: new Date().toISOString(),
    groups: [...(previousState.groups ?? []), group],
    nextGroupSequence: sequence + 1
  }, { pinnedGroupId: group.id });
}

function createGroupFromSelection(
  previousState: CanvasPrototypeState,
  nodeIds: readonly string[],
  groupIds: readonly string[],
  parentGroupId?: string
): CanvasPrototypeState {
  const selectedNodeIds = new Set(nodeIds);
  const selectedGroupIds = new Set(groupIds);
  const selectedNodes = previousState.nodes.filter(
    (node) => selectedNodeIds.has(node.id) && isStableCanvasGroupMemberKind(node.kind)
  );
  const selectedGroups = (previousState.groups ?? []).filter((group) => selectedGroupIds.has(group.id));
  const selectedObjectCount = selectedNodes.length + selectedGroups.length;
  if (selectedObjectCount < 2) {
    return previousState;
  }

  const selectedGroupSubtrees = selectedGroups.map((group) => ({
    rootId: group.id,
    subtreeIds: collectGroupSubtreeIds(previousState.groups ?? [], group.id)
  }));
  const containsSelectedGroupDescendant = selectedGroupSubtrees.some(({ rootId, subtreeIds }) =>
    [...subtreeIds].some((groupId) => groupId !== rootId && selectedGroupIds.has(groupId))
  );
  if (containsSelectedGroupDescendant) {
    return previousState;
  }

  const containsNodeInsideSelectedGroup = selectedNodeIds.size > 0 && selectedGroups.some((group) => {
    const subtreeIds = collectGroupSubtreeIds(previousState.groups ?? [], group.id);
    return selectedNodes.some((node) => node.groupId && subtreeIds.has(node.groupId));
  });
  if (containsNodeInsideSelectedGroup) {
    return previousState;
  }

  const parentIds = new Set<string | undefined>([
    ...selectedNodes.map((node) => node.groupId),
    ...selectedGroups.map((group) => group.parentGroupId)
  ]);
  if (parentIds.size !== 1) {
    return previousState;
  }

  const selectedParentGroupId = parentIds.values().next().value as string | undefined;
  const requestedParentGroupId = resolveValidTargetGroupId(previousState.groups ?? [], parentGroupId);
  if (selectedGroups.some(isWorkspaceRootGroup) && requestedParentGroupId) {
    const requestedParentGroup = (previousState.groups ?? []).find((group) => group.id === requestedParentGroupId);
    if (
      !requestedParentGroup ||
      isWorkspaceRootGroup(requestedParentGroup) ||
      resolveContainingWorkspaceRootGroupId(previousState.groups ?? [], requestedParentGroup.id)
    ) {
      return previousState;
    }
  }
  if (selectedGroups.some(isWorkspaceRootGroup) && selectedNodes.length > 0) {
    return previousState;
  }
  if (requestedParentGroupId !== selectedParentGroupId) {
    return previousState;
  }

  const selectedRects = [
    ...selectedNodes.map((node) => rectForNode(node)),
    ...selectedGroups.map((group) => rectForGroup(group))
  ];
  const selectionRect = boundingRectForRects(selectedRects);
  if (!selectionRect) {
    return previousState;
  }

  const sequence = readNextGroupSequence(previousState);
  const groupRect = expandRectByInsets(selectionRect, CANVAS_GROUP_MEMBER_INSETS);
  const group = createCanvasGroupWithSequence(
    sequence,
    { x: groupRect.left, y: groupRect.top },
    { width: groupRect.right - groupRect.left, height: groupRect.bottom - groupRect.top },
    selectedParentGroupId
  );

  return finalizeCanvasGroupState({
    ...previousState,
    updatedAt: new Date().toISOString(),
    nextGroupSequence: sequence + 1,
    nodes: previousState.nodes.map((node) =>
      selectedNodeIds.has(node.id) && isStableCanvasGroupMemberKind(node.kind)
        ? {
            ...node,
            groupId: group.id
          }
        : node
    ),
    groups: [
      ...(previousState.groups ?? []).map((currentGroup) =>
        selectedGroupIds.has(currentGroup.id)
          ? {
              ...currentGroup,
              parentGroupId: group.id
            }
          : currentGroup
      ),
      group
    ]
  }, { pinnedGroupId: group.id });
}

function updateGroupTitle(state: CanvasPrototypeState, groupId: string, title: string): CanvasPrototypeState {
  const currentGroup = (state.groups ?? []).find((group) => group.id === groupId);
  if (!currentGroup || isWorkspaceRootGroup(currentGroup)) {
    return state;
  }

  const nextTitle = trimStoredNodeText(title).trim() || currentGroup.title;
  if (nextTitle === currentGroup.title) {
    return state;
  }

  return {
    ...state,
    updatedAt: new Date().toISOString(),
    groups: (state.groups ?? []).map((group) =>
      group.id === groupId
        ? {
            ...group,
            title: nextTitle
          }
        : group
    )
  };
}

function moveGroup(
  previousState: CanvasPrototypeState,
  groupId: string,
  position: CanvasNodePosition,
  pointerPosition?: CanvasNodePosition
): CanvasPrototypeState {
  const targetGroup = (previousState.groups ?? []).find((group) => group.id === groupId);
  if (!targetGroup) {
    return previousState;
  }

  const normalizedPosition = {
    x: Math.round(position.x),
    y: Math.round(position.y)
  };
  const delta = {
    x: normalizedPosition.x - targetGroup.position.x,
    y: normalizedPosition.y - targetGroup.position.y
  };
  const subtreeGroupIds = collectGroupSubtreeIds(previousState.groups ?? [], groupId);
  const containingWorkspaceRootGroupId = isWorkspaceRootGroup(targetGroup)
    ? undefined
    : resolveContainingWorkspaceRootGroupId(previousState.groups ?? [], targetGroup.parentGroupId);
  const nextParentGroupId = resolveDroppedObjectGroupId(
    previousState,
    groupId,
    'group',
    pointerPosition ?? {
      x: normalizedPosition.x + Math.round(targetGroup.size.width / 2),
      y: normalizedPosition.y + Math.round(targetGroup.size.height / 2)
    }
  );

  return finalizeCanvasGroupState({
    ...previousState,
    updatedAt: new Date().toISOString(),
    nodes: previousState.nodes.map((node) =>
      node.groupId && subtreeGroupIds.has(node.groupId)
        ? {
            ...node,
            position: {
              x: Math.round(node.position.x + delta.x),
              y: Math.round(node.position.y + delta.y)
            }
          }
        : node
    ),
    groups: (previousState.groups ?? []).map((group) =>
      subtreeGroupIds.has(group.id)
        ? {
            ...group,
            position: {
              x: Math.round(group.position.x + delta.x),
              y: Math.round(group.position.y + delta.y)
            },
            parentGroupId: group.id === groupId ? nextParentGroupId : group.parentGroupId
          }
        : group
    )
  }, { pinnedGroupIds: [groupId, containingWorkspaceRootGroupId].filter((id): id is string => Boolean(id)) });
}

function resizeGroup(
  previousState: CanvasPrototypeState,
  groupId: string,
  position: CanvasNodePosition,
  size: CanvasNodeFootprint
): CanvasPrototypeState {
  const targetGroup = (previousState.groups ?? []).find((group) => group.id === groupId);
  if (!targetGroup) {
    return previousState;
  }

  const resizedGroup: CanvasGroupSummary = {
    ...targetGroup,
    position: {
      x: Math.round(position.x),
      y: Math.round(position.y)
    },
    size: normalizeCanvasGroupFootprint(size)
  };
  const resizedRect = rectForGroup(resizedGroup);
  const targetParentId = targetGroup.parentGroupId;
  const groupsAfterBoundaryIntent = (previousState.groups ?? []).map((group) => {
    if (group.id === groupId) {
      return resizedGroup;
    }

    if (isWorkspaceRootGroup(targetGroup)) {
      return group;
    }

    if (group.parentGroupId === groupId && !rectContainsRect(resizedRect, rectForGroup(group))) {
      return {
        ...group,
        parentGroupId: targetParentId
      };
    }

    if (
      group.parentGroupId === targetParentId &&
      group.id !== groupId &&
      rectContainsRect(resizedRect, rectForGroup(group))
    ) {
      return {
        ...group,
        parentGroupId: groupId
      };
    }

    return group;
  });
  const nodesAfterBoundaryIntent = previousState.nodes.map((node) => {
    if (isWorkspaceRootGroup(targetGroup)) {
      return node;
    }

    if (
      node.groupId === groupId &&
      isStableCanvasGroupMemberKind(node.kind) &&
      !rectContainsRect(resizedRect, rectForNode(node))
    ) {
      return {
        ...node,
        groupId: targetParentId
      };
    }

    if (
      node.groupId === targetParentId &&
      isStableCanvasGroupMemberKind(node.kind) &&
      rectContainsRect(resizedRect, rectForNode(node))
    ) {
      return {
        ...node,
        groupId
      };
    }

    return node;
  });
  const boundaryIntentNodesById = new Map(nodesAfterBoundaryIntent.map((node) => [node.id, node] as const));
  const nodesAfterAutomaticGroupIntent = nodesAfterBoundaryIntent.map((node) =>
    isAutomaticFileArtifactNodeKind(node.kind)
      ? withCanvasNodeGroupId(
          node,
          resolveAutomaticFileArtifactGroupId(
            node,
            boundaryIntentNodesById,
            groupsAfterBoundaryIntent,
            resolveContainingWorkspaceRootGroupId(groupsAfterBoundaryIntent, node.groupId)
          )
        )
      : node
  );

  return finalizeCanvasGroupState({
    ...previousState,
    updatedAt: new Date().toISOString(),
    nodes: nodesAfterAutomaticGroupIntent,
    groups: groupsAfterBoundaryIntent
  }, { pinnedGroupId: groupId });
}

function ungroupCanvasGroup(previousState: CanvasPrototypeState, groupId: string): CanvasPrototypeState {
  const targetGroup = (previousState.groups ?? []).find((group) => group.id === groupId);
  if (!targetGroup || isWorkspaceRootGroup(targetGroup)) {
    return previousState;
  }

  return finalizeCanvasGroupState({
    ...previousState,
    updatedAt: new Date().toISOString(),
    nodes: previousState.nodes.map((node) =>
      node.groupId === groupId
        ? {
            ...node,
            groupId: targetGroup.parentGroupId
          }
        : node
    ),
    groups: (previousState.groups ?? [])
      .filter((group) => group.id !== groupId)
      .map((group) =>
        group.parentGroupId === groupId
          ? {
              ...group,
              parentGroupId: targetGroup.parentGroupId
            }
          : group
      )
  });
}

function deleteCanvasGroupKeepMembers(previousState: CanvasPrototypeState, groupId: string): CanvasPrototypeState {
  return ungroupCanvasGroup(previousState, groupId);
}

function isEmptyCanvasGroup(state: CanvasPrototypeState, groupId: string): boolean {
  return (
    !state.nodes.some((node) => node.groupId === groupId) &&
    !(state.groups ?? []).some((group) => group.parentGroupId === groupId)
  );
}

interface CanvasGroupDeleteImpact {
  groupIds: Set<string>;
  nodeIds: string[];
  executionNodeCount: number;
}

function collectCanvasGroupDeleteImpact(state: CanvasPrototypeState, groupId: string): CanvasGroupDeleteImpact {
  const groupIds = collectGroupSubtreeIds(state.groups ?? [], groupId);
  const nodeIds = state.nodes
    .filter((node) => node.groupId && groupIds.has(node.groupId))
    .map((node) => node.id);
  const executionNodeCount = state.nodes.filter((node) => nodeIds.includes(node.id) && isExecutionNodeKind(node.kind)).length;

  return {
    groupIds,
    nodeIds,
    executionNodeCount
  };
}

function formatCanvasGroupDeleteImpactDetail(impact: CanvasGroupDeleteImpact): string {
  const childGroupCount = Math.max(0, impact.groupIds.size - 1);
  const parts = [
    `一并删除会递归删除内部 ${impact.nodeIds.length} 个节点和 ${childGroupCount} 个子分组。`,
    '仅删除分组框会保留内部对象并提升到当前父级。'
  ];

  if (impact.executionNodeCount > 0) {
    parts.push(`其中 ${impact.executionNodeCount} 个执行节点会先终止并清理运行会话。`);
  }

  return parts.join(' ');
}

function collectGroupSubtreeIds(groups: readonly CanvasGroupSummary[], groupId: string): Set<string> {
  const childrenByParent = new Map<string, string[]>();
  for (const group of groups) {
    if (!group.parentGroupId) {
      continue;
    }

    childrenByParent.set(group.parentGroupId, [...(childrenByParent.get(group.parentGroupId) ?? []), group.id]);
  }

  const visited = new Set<string>();
  const stack = [groupId];
  while (stack.length > 0) {
    const nextId = stack.pop();
    if (!nextId || visited.has(nextId)) {
      continue;
    }

    visited.add(nextId);
    for (const childId of childrenByParent.get(nextId) ?? []) {
      stack.push(childId);
    }
  }

  return visited;
}

function collectGroupDescendantIds(groups: readonly CanvasGroupSummary[], groupId: string): Set<string> {
  const descendantIds = collectGroupSubtreeIds(groups, groupId);
  descendantIds.delete(groupId);
  return descendantIds;
}

function resolveDroppedObjectGroupId(
  state: CanvasPrototypeState,
  objectId: string,
  objectKind: 'node' | 'group',
  pointerPosition: CanvasNodePosition
): string | undefined {
  const excludedGroupIds =
    objectKind === 'group' ? collectGroupSubtreeIds(state.groups ?? [], objectId) : new Set<string>();
  const currentObject = objectKind === 'group'
    ? (state.groups ?? []).find((group) => group.id === objectId)
    : state.nodes.find((node) => node.id === objectId);
  const currentRootGroupId = currentObject
    ? resolveContainingWorkspaceRootGroupId(state.groups ?? [], objectKind === 'group'
      ? (currentObject as CanvasGroupSummary).parentGroupId
      : (currentObject as CanvasNodeSummary).groupId)
    : undefined;
  const hasWorkspaceRootGroups = (state.groups ?? []).some(isWorkspaceRootGroup);
  const isWorkspaceLevelGroupMove =
    objectKind === 'group' &&
    currentObject !== undefined &&
    (isWorkspaceRootGroup(currentObject as CanvasGroupSummary) ||
      (hasWorkspaceRootGroups && !currentRootGroupId));
  const candidates = (state.groups ?? [])
    .filter((group) => {
      if (excludedGroupIds.has(group.id) || !pointInRect(pointerPosition, rectForGroup(group))) {
        return false;
      }
      if (isWorkspaceLevelGroupMove) {
        return !isWorkspaceRootGroup(group) && !resolveContainingWorkspaceRootGroupId(state.groups ?? [], group.id);
      }
      const candidateRootGroupId = isWorkspaceRootGroup(group)
        ? group.id
        : resolveContainingWorkspaceRootGroupId(state.groups ?? [], group.parentGroupId);
      return currentRootGroupId ? candidateRootGroupId === currentRootGroupId : true;
    })
    .sort((left, right) => groupDepth(state.groups ?? [], right.id) - groupDepth(state.groups ?? [], left.id));

  return candidates[0]?.id ?? currentRootGroupId;
}

function resolveValidTargetGroupId(
  groups: readonly CanvasGroupSummary[],
  targetGroupId?: string
): string | undefined {
  return targetGroupId && groups.some((group) => group.id === targetGroupId) ? targetGroupId : undefined;
}

function resolveContainingWorkspaceRootGroupId(
  groups: readonly CanvasGroupSummary[],
  groupId?: string
): string | undefined {
  let currentGroup = groupId ? groups.find((group) => group.id === groupId) : undefined;
  const visited = new Set<string>();
  while (currentGroup && !visited.has(currentGroup.id)) {
    if (isWorkspaceRootGroup(currentGroup)) {
      return currentGroup.id;
    }
    visited.add(currentGroup.id);
    currentGroup = currentGroup.parentGroupId
      ? groups.find((group) => group.id === currentGroup?.parentGroupId)
      : undefined;
  }
  return undefined;
}

function finalizeCanvasGroupState(
  state: CanvasPrototypeState,
  options: CanvasGroupGeometryRepairOptions = {}
): CanvasPrototypeState {
  const groups = removeMissingGroupNodeMemberships(state.groups ?? [], state.nodes);
  const nodes = normalizeCanvasNodeGroupMemberships(state.nodes, groups);
  const repairedState = repairCanvasGroupGeometry(groups, nodes, options);
  const finalGroups = expandGroupsToContainDirectMembers(repairedState.groups, repairedState.nodes);

  return {
    ...state,
    nodes: repairedState.nodes,
    groups: finalGroups
  };
}

function expandGroupsToContainDirectMembers(
  groups: readonly CanvasGroupSummary[],
  nodes: readonly CanvasNodeSummary[]
): CanvasGroupSummary[] {
  let nextGroups = groups.map((group) => ({ ...group }));

  for (let pass = 0; pass < Math.max(1, nextGroups.length + 1); pass += 1) {
    let didChange = false;
    nextGroups = nextGroups.map((group) => {
      const memberRects = [
        ...nodes
          .filter((node) => node.groupId === group.id)
          .map((node) => rectForNode(node)),
        ...nextGroups
          .filter((candidate) => candidate.parentGroupId === group.id)
          .map((candidate) => rectForGroup(candidate))
      ];

      if (memberRects.length === 0) {
        return group;
      }

      const containedRect = expandRectToContainRects(rectForGroup(group), memberRects, memberInsetsForCanvasGroup(group));
      const nextGroup = groupFromRect(group, containedRect);
      if (!groupsEqualGeometry(group, nextGroup)) {
        didChange = true;
      }
      return nextGroup;
    });

    if (!didChange) {
      break;
    }
  }

  return nextGroups;
}

function memberInsetsForCanvasGroup(group: Pick<CanvasGroupSummary, 'role'>): CanvasRectInsets {
  return isWorkspaceRootGroup(group) ? CANVAS_WORKSPACE_ROOT_GROUP_MEMBER_INSETS : CANVAS_GROUP_MEMBER_INSETS;
}

function displaceOverlappingSiblingGroups(groups: readonly CanvasGroupSummary[]): CanvasGroupSummary[] {
  return repairCanvasGroupGeometry(groups, [], {}).groups;
}

function repairCanvasGroupGeometry(
  groups: readonly CanvasGroupSummary[],
  nodes: readonly CanvasNodeSummary[],
  options: CanvasGroupGeometryRepairOptions = {}
): { groups: CanvasGroupSummary[]; nodes: CanvasNodeSummary[] } {
  let nextGroups = expandGroupsToContainDirectMembers(groups, nodes);
  let nextNodes = nodes.map((node) => ({ ...node }));

  for (let pass = 0; pass < Math.max(1, nextGroups.length * nextGroups.length + nextGroups.length + 1); pass += 1) {
    const expandedGroups = expandGroupsToContainDirectMembers(nextGroups, nextNodes);
    const repairedState = repairOneIllegalSiblingGeometry(expandedGroups, nextNodes, options);
    nextGroups = repairedState.groups;
    nextNodes = repairedState.nodes;

    if (!repairedState.didRepair && groupsEqualCollectionGeometry(expandedGroups, nextGroups)) {
      break;
    }
  }

  return { groups: nextGroups, nodes: nextNodes };
}

function repairOneIllegalSiblingGeometry(
  groups: readonly CanvasGroupSummary[],
  nodes: readonly CanvasNodeSummary[],
  options: CanvasGroupGeometryRepairOptions = {}
): { groups: CanvasGroupSummary[]; nodes: CanvasNodeSummary[]; didRepair: boolean } {
  const siblingCollections = collectSiblingGeometryCollections(groups, nodes);
  for (const collection of siblingCollections) {
    const overlappingGroups = findFirstOverlappingSiblingGroups(collection.items);
    if (overlappingGroups) {
      const repairGroups = collection.items
        .filter((item) => item.kind === 'group')
        .map((item) => item.id);
      return {
        ...applySpreadRepair(groups, nodes, collection.items, repairGroups, overlappingGroups, options),
        didRepair: true
      };
    }

    const nodeGroupOverlap = findFirstNodeGroupOverlap(collection.items);
    if (nodeGroupOverlap) {
      const preferredRepairIds =
        isPinnedCanvasGroupRepairTarget(options, nodeGroupOverlap.secondId)
          ? [nodeGroupOverlap.firstId]
          : [nodeGroupOverlap.secondId];
      return {
        ...applySpreadRepair(groups, nodes, collection.items, preferredRepairIds, nodeGroupOverlap, options),
        didRepair: true
      };
    }
  }

  return { groups: groups.map((group) => ({ ...group })), nodes: nodes.map((node) => ({ ...node })), didRepair: false };
}

interface SiblingGeometryItem {
  kind: 'group' | 'node';
  id: string;
  rect: CanvasRect;
  role?: CanvasGroupSummary['role'];
}

interface IllegalGeometryOverlap {
  firstId: string;
  secondId: string;
}

interface CanvasGroupGeometryRepairOptions {
  pinnedGroupId?: string;
  pinnedGroupIds?: readonly string[];
}

function collectPinnedCanvasGroupRepairTargetIds(options: CanvasGroupGeometryRepairOptions): Set<string> {
  return new Set([options.pinnedGroupId, ...(options.pinnedGroupIds ?? [])].filter((id): id is string => Boolean(id)));
}

function isPinnedCanvasGroupRepairTarget(options: CanvasGroupGeometryRepairOptions, groupId: string): boolean {
  return collectPinnedCanvasGroupRepairTargetIds(options).has(groupId);
}

function collectSiblingGeometryCollections(
  groups: readonly CanvasGroupSummary[],
  nodes: readonly CanvasNodeSummary[]
): Array<{ parentGroupId?: string; items: SiblingGeometryItem[] }> {
  const parentGroupIds = new Set<string | undefined>();
  for (const group of groups) {
    parentGroupIds.add(group.parentGroupId);
  }
  for (const node of nodes) {
    parentGroupIds.add(node.groupId);
  }

  return [...parentGroupIds].map((parentGroupId) => ({
    parentGroupId,
    items: [
      ...groups
        .filter((group) => group.parentGroupId === parentGroupId)
        .map((group) => ({ kind: 'group' as const, id: group.id, rect: rectForGroup(group), role: group.role })),
      ...nodes
        .filter((node) => node.groupId === parentGroupId)
        .map((node) => ({ kind: 'node' as const, id: node.id, rect: rectForNode(node) }))
    ]
  }));
}

function findFirstOverlappingSiblingGroups(items: readonly SiblingGeometryItem[]): IllegalGeometryOverlap | undefined {
  const groupItems = items.filter((item) => item.kind === 'group');
  for (let leftIndex = 0; leftIndex < groupItems.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < groupItems.length; rightIndex += 1) {
      const left = groupItems[leftIndex];
      const right = groupItems[rightIndex];
      if (shouldTreatSiblingGeometryAsConflict(left, right, false)) {
        return { firstId: left.id, secondId: right.id };
      }
    }
  }

  return undefined;
}

function findFirstNodeGroupOverlap(items: readonly SiblingGeometryItem[]): IllegalGeometryOverlap | undefined {
  const nodeItems = items.filter((item) => item.kind === 'node');
  const groupItems = items.filter((item) => item.kind === 'group');
  for (const group of groupItems) {
    const node = nodeItems.find((candidate) => rectsIntersect(candidate.rect, group.rect));
    if (node) {
      return { firstId: node.id, secondId: group.id };
    }
  }

  return undefined;
}

function applySpreadRepair(
  groups: readonly CanvasGroupSummary[],
  nodes: readonly CanvasNodeSummary[],
  siblingItems: readonly SiblingGeometryItem[],
  preferredRepairIds: readonly string[],
  overlap: IllegalGeometryOverlap,
  options: CanvasGroupGeometryRepairOptions = {}
): { groups: CanvasGroupSummary[]; nodes: CanvasNodeSummary[] } {
  const candidates = buildSpreadRepairCandidates(siblingItems, preferredRepairIds, overlap, options);
  const bestCandidate = candidates
    .map((repairTargetIds) => ({
      repairTargetIds,
      plan: resolveSpreadRepairPlan(siblingItems, repairTargetIds, options)
    }))
    .filter((candidate): candidate is { repairTargetIds: string[]; plan: SpreadRepairPlan } => candidate.plan !== undefined)
    .sort((left, right) => compareSpreadRepairPlans(left.plan, right.plan))[0];

  if (!bestCandidate) {
    return { groups: groups.map((group) => ({ ...group })), nodes: nodes.map((node) => ({ ...node })) };
  }

  return applySpreadRepairPlan(groups, nodes, bestCandidate.plan);
}

interface SpreadRepairTarget {
  item: SiblingGeometryItem;
  index: number;
  rect: CanvasRect;
}

interface SpreadRepairPlan {
  targets: SpreadRepairTarget[];
  deltas: CanvasNodePosition[];
  totalMovement: number;
  maxMovement: number;
  movedCount: number;
}

function buildSpreadRepairCandidates(
  items: readonly SiblingGeometryItem[],
  preferredRepairIds: readonly string[],
  overlap: IllegalGeometryOverlap,
  options: CanvasGroupGeometryRepairOptions
): string[][] {
  const movableIds = items.map((item) => item.id);
  const preferredIds = preferredRepairIds.filter((id) => movableIds.includes(id));
  const overlapMovableIds = [overlap.firstId, overlap.secondId].filter((id) => movableIds.includes(id));
  const candidateKeys = new Set<string>();
  const candidates: string[][] = [];

  const addCandidate = (ids: readonly string[]) => {
    const pinnedIds = collectPinnedCanvasGroupRepairTargetIds(options);
    const uniqueIds = [...new Set(ids)].filter((id) => !pinnedIds.has(id));
    if (uniqueIds.length === 0) {
      return;
    }

    const key = uniqueIds.slice().sort().join('\u0000');
    if (candidateKeys.has(key)) {
      return;
    }

    candidateKeys.add(key);
    candidates.push(uniqueIds);
  };

  addCandidate(preferredIds);
  addCandidate(overlapMovableIds);
  for (const id of overlapMovableIds) {
    addCandidate([id]);
  }
  for (const id of preferredIds) {
    addCandidate([id]);
  }
  addCandidate(items.filter((item) => item.kind === 'group').map((item) => item.id));
  addCandidate(movableIds);

  return candidates;
}

function resolveSpreadRepairPlan(
  items: readonly SiblingGeometryItem[],
  repairTargetIds: readonly string[],
  options: CanvasGroupGeometryRepairOptions
): SpreadRepairPlan | undefined {
  const pinnedIds = collectPinnedCanvasGroupRepairTargetIds(options);
  const repairTargetIdSet = new Set(repairTargetIds);
  const targets = items
    .map((item, index) => ({ item, index, rect: item.rect }))
    .filter((target) => repairTargetIdSet.has(target.item.id));
  if (targets.length === 0) {
    return undefined;
  }

  const fixedItems = items.filter((item) => !repairTargetIdSet.has(item.id) || pinnedIds.has(item.id));
  const repairedTargets = targets.map((target) => ({ ...target }));
  const deltasById = new Map<string, CanvasNodePosition>();
  for (const target of repairedTargets) {
    deltasById.set(target.item.id, { x: 0, y: 0 });
  }

  const pinnedItems = items.filter((item) => pinnedIds.has(item.id));
  const originPoint = pinnedItems.length > 0
    ? averageRectCenter(pinnedItems.map((item) => item.rect))
    : averageRectCenter(items.map((item) => item.rect));
  for (let pass = 0; pass < Math.max(1, repairedTargets.length + fixedItems.length + 2); pass += 1) {
    let didMove = false;
    const allItems = [
      ...fixedItems.map((item) => ({ item, rect: item.rect, canMove: false })),
      ...repairedTargets.map((target) => ({ item: target.item, rect: target.rect, canMove: true }))
    ];

    for (const target of repairedTargets) {
      const overlaps = allItems.filter(
        (candidate) => candidate.item.id !== target.item.id && rectsIntersect(target.rect, candidate.rect)
      );
      if (overlaps.length === 0) {
        continue;
      }

      const blockingCenter =
        overlaps.some((candidate) => pinnedIds.has(candidate.item.id)) && pinnedItems.length > 0
          ? originPoint
          : averageRectCenter(overlaps.map((candidate) => candidate.rect));
      const delta = chooseSpreadDelta(target.rect, blockingCenter, overlaps.map((candidate) => candidate.rect));
      if (delta.x === 0 && delta.y === 0) {
        continue;
      }

      target.rect = translateRect(target.rect, delta);
      const previousDelta = deltasById.get(target.item.id) ?? { x: 0, y: 0 };
      deltasById.set(target.item.id, { x: previousDelta.x + delta.x, y: previousDelta.y + delta.y });
      didMove = true;
    }

    if (!didMove) {
      break;
    }
  }

  const finalItems = [
    ...fixedItems.map((item) => ({ item, id: item.id, rect: item.rect })),
    ...repairedTargets.map((target) => ({
      item: { ...target.item, rect: target.rect },
      id: target.item.id,
      rect: target.rect
    }))
  ];
  for (let leftIndex = 0; leftIndex < finalItems.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < finalItems.length; rightIndex += 1) {
      const left = finalItems[leftIndex];
      const right = finalItems[rightIndex];
      if (shouldTreatSiblingGeometryAsConflict(left.item, right.item, false)) {
        return undefined;
      }
    }
  }

  const deltas = targets.map((target) => deltasById.get(target.item.id) ?? { x: 0, y: 0 });
  return {
    targets,
    deltas,
    totalMovement: deltas.reduce((sum, delta) => sum + Math.abs(delta.x) + Math.abs(delta.y), 0),
    maxMovement: deltas.reduce((max, delta) => Math.max(max, Math.abs(delta.x) + Math.abs(delta.y)), 0),
    movedCount: deltas.filter((delta) => delta.x !== 0 || delta.y !== 0).length
  };
}

function chooseSpreadDelta(rect: CanvasRect, blockingCenter: CanvasNodePosition, blockingRects: readonly CanvasRect[]): CanvasNodePosition {
  const rectCenter = rectCenterPoint(rect);
  const preferredDirections = rankSpreadDirections(rectCenter, blockingCenter);
  const directionRanks = new Map(preferredDirections.map((direction, index) => [direction, index] as const));
  const candidateDeltas = buildCardinalSpreadDeltas(rect, blockingRects);

  return candidateDeltas.sort((left, right) => {
    const leftDirection = directionForDelta(left);
    const rightDirection = directionForDelta(right);
    return (
      (directionRanks.get(leftDirection) ?? Number.MAX_SAFE_INTEGER) -
        (directionRanks.get(rightDirection) ?? Number.MAX_SAFE_INTEGER) ||
      Math.abs(left.x) + Math.abs(left.y) - (Math.abs(right.x) + Math.abs(right.y))
    );
  })[0] ?? { x: 0, y: 0 };
}

function rankSpreadDirections(
  rectCenter: CanvasNodePosition,
  blockingCenter: CanvasNodePosition
): Array<'left' | 'right' | 'up' | 'down'> {
  const horizontalDirection = rectCenter.x < blockingCenter.x ? 'left' : 'right';
  const verticalDirection = rectCenter.y < blockingCenter.y ? 'up' : 'down';
  const oppositeHorizontalDirection = horizontalDirection === 'left' ? 'right' : 'left';
  const oppositeVerticalDirection = verticalDirection === 'up' ? 'down' : 'up';

  return Math.abs(rectCenter.x - blockingCenter.x) >= Math.abs(rectCenter.y - blockingCenter.y)
    ? [horizontalDirection, verticalDirection, oppositeVerticalDirection, oppositeHorizontalDirection]
    : [verticalDirection, horizontalDirection, oppositeHorizontalDirection, oppositeVerticalDirection];
}

function buildCardinalSpreadDeltas(rect: CanvasRect, blockingRects: readonly CanvasRect[]): CanvasNodePosition[] {
  const intersectingRects = blockingRects.filter((blockingRect) => rectsIntersect(rect, blockingRect));
  if (intersectingRects.length === 0) {
    return [{ x: 0, y: 0 }];
  }

  const leftDelta = Math.min(
    ...intersectingRects.map((blockingRect) => blockingRect.left - CANVAS_GROUP_COLLISION_PADDING - rect.right)
  );
  const rightDelta = Math.max(
    ...intersectingRects.map((blockingRect) => blockingRect.right + CANVAS_GROUP_COLLISION_PADDING - rect.left)
  );
  const upDelta = Math.min(
    ...intersectingRects.map((blockingRect) => blockingRect.top - CANVAS_GROUP_COLLISION_PADDING - rect.bottom)
  );
  const downDelta = Math.max(
    ...intersectingRects.map((blockingRect) => blockingRect.bottom + CANVAS_GROUP_COLLISION_PADDING - rect.top)
  );

  return dedupeCanvasPositionDeltas([
    { x: Math.round(leftDelta), y: 0 },
    { x: Math.round(rightDelta), y: 0 },
    { x: 0, y: Math.round(upDelta) },
    { x: 0, y: Math.round(downDelta) }
  ]);
}

function directionForDelta(delta: CanvasNodePosition): 'left' | 'right' | 'up' | 'down' {
  if (Math.abs(delta.x) >= Math.abs(delta.y)) {
    return delta.x < 0 ? 'left' : 'right';
  }

  return delta.y < 0 ? 'up' : 'down';
}

function compareSpreadRepairPlans(left: SpreadRepairPlan, right: SpreadRepairPlan): number {
  return (
    left.totalMovement - right.totalMovement ||
    left.maxMovement - right.maxMovement ||
    left.movedCount - right.movedCount ||
    left.targets.length - right.targets.length
  );
}

function applySpreadRepairPlan(
  groups: readonly CanvasGroupSummary[],
  nodes: readonly CanvasNodeSummary[],
  plan: SpreadRepairPlan
): { groups: CanvasGroupSummary[]; nodes: CanvasNodeSummary[] } {
  const deltasById = new Map(plan.targets.map((target, index) => [target.item.id, plan.deltas[index]] as const));
  let nextGroups = groups.map((group) => ({ ...group }));
  let nextNodes = nodes.map((node) => ({ ...node }));

  for (const target of plan.targets) {
    const delta = deltasById.get(target.item.id);
    if (!delta || (delta.x === 0 && delta.y === 0)) {
      continue;
    }

    if (target.item.kind === 'group') {
      const translated = translateGroupSubtree(nextGroups, nextNodes, target.item.id, delta);
      nextGroups = translated.groups;
      nextNodes = translated.nodes;
    } else {
      nextNodes = nextNodes.map((node) => (node.id === target.item.id ? translateNode(node, delta) : node));
    }
  }

  return { groups: nextGroups, nodes: nextNodes };
}

function shouldTreatSiblingGeometryAsConflict(
  left: Pick<SiblingGeometryItem, 'kind' | 'rect' | 'role'>,
  right: Pick<SiblingGeometryItem, 'kind' | 'rect' | 'role'>,
  includeNodeNode: boolean
): boolean {
  if (!rectsIntersect(left.rect, right.rect)) {
    return false;
  }

  if (left.kind === 'node' && right.kind === 'node') {
    return includeNodeNode;
  }

  if (left.kind === 'group' && right.kind === 'group') {
    if (left.role === 'workspace-root' || right.role === 'workspace-root') {
      return true;
    }
    const leftContainsRight = rectContainsRect(left.rect, right.rect);
    const rightContainsLeft = rectContainsRect(right.rect, left.rect);
    return (!leftContainsRight && !rightContainsLeft) || (leftContainsRight && rightContainsLeft);
  }

  return true;
}

function rectCenterPoint(rect: CanvasRect): CanvasNodePosition {
  return {
    x: Math.round((rect.left + rect.right) / 2),
    y: Math.round((rect.top + rect.bottom) / 2)
  };
}

function averageRectCenter(rects: readonly CanvasRect[]): CanvasNodePosition {
  if (rects.length === 0) {
    return { x: 0, y: 0 };
  }

  const centerSum = rects.reduce(
    (sum, rect) => {
      const center = rectCenterPoint(rect);
      return { x: sum.x + center.x, y: sum.y + center.y };
    },
    { x: 0, y: 0 }
  );

  return {
    x: Math.round(centerSum.x / rects.length),
    y: Math.round(centerSum.y / rects.length)
  };
}

function translateRect(rect: CanvasRect, delta: CanvasNodePosition): CanvasRect {
  return {
    left: Math.round(rect.left + delta.x),
    top: Math.round(rect.top + delta.y),
    right: Math.round(rect.right + delta.x),
    bottom: Math.round(rect.bottom + delta.y)
  };
}

function translateGroupSubtree(
  groups: readonly CanvasGroupSummary[],
  nodes: readonly CanvasNodeSummary[],
  groupId: string,
  delta: CanvasNodePosition
): { groups: CanvasGroupSummary[]; nodes: CanvasNodeSummary[] } {
  const subtreeGroupIds = collectGroupSubtreeIds(groups, groupId);
  return {
    groups: groups.map((group) => (subtreeGroupIds.has(group.id) ? translateGroup(group, delta) : group)),
    nodes: nodes.map((node) =>
      node.groupId && subtreeGroupIds.has(node.groupId)
        ? {
            ...node,
            position: {
              x: Math.round(node.position.x + delta.x),
              y: Math.round(node.position.y + delta.y)
            }
          }
        : node
    )
  };
}

function normalizeCanvasGroups(value: unknown): CanvasGroupSummary[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const groups = value
    .map((group, index) => normalizeCanvasGroup(group, index))
    .filter((group): group is CanvasGroupSummary => group !== null);
  const normalizedGroups = normalizeCanvasGroupParentIds(groups);

  return displaceOverlappingSiblingGroups(normalizedGroups);
}

function normalizeCanvasGroupParentIds(groups: readonly CanvasGroupSummary[]): CanvasGroupSummary[] {
  const groupIds = new Set(groups.map((group) => group.id));
  return groups.map((group) =>
    group.parentGroupId &&
      groupIds.has(group.parentGroupId) &&
      !wouldCreateGroupCycle(groups, group.id, group.parentGroupId) &&
      isAllowedCanvasGroupParent(groups, group, group.parentGroupId)
      ? group
      : {
          ...group,
          parentGroupId: undefined
        }
  );
}

function isAllowedCanvasGroupParent(
  groups: readonly CanvasGroupSummary[],
  group: CanvasGroupSummary,
  parentGroupId: string
): boolean {
  if (!isWorkspaceRootGroup(group)) {
    return true;
  }
  const parent = groups.find((candidate) => candidate.id === parentGroupId);
  return Boolean(parent && !isWorkspaceRootGroup(parent) && !resolveContainingWorkspaceRootGroupId(groups, parent.id));
}

function normalizeCanvasGroup(value: unknown, index: number): CanvasGroupSummary | null {
  if (!isRecord(value) || typeof value.id !== 'string') {
    return null;
  }

  const role: CanvasGroupRole | undefined = value.role === 'workspace-root' ? 'workspace-root' : undefined;
  const workspaceRootPath =
    role === 'workspace-root' && typeof value.workspaceRootPath === 'string'
      ? path.resolve(value.workspaceRootPath)
      : undefined;
  return {
    id: value.id,
    title: typeof value.title === 'string' && value.title.trim() ? trimStoredNodeText(value.title).trim() : `Group ${index + 1}`,
    position: normalizeRawPosition(value.position),
    size: normalizeCanvasGroupFootprint(value.size),
    parentGroupId: typeof value.parentGroupId === 'string' ? value.parentGroupId : undefined,
    role,
    workspaceRootPath
  };
}

function normalizeRawPosition(value: unknown): CanvasNodePosition {
  return isRecord(value) && typeof value.x === 'number' && Number.isFinite(value.x) && typeof value.y === 'number' && Number.isFinite(value.y)
    ? {
        x: Math.round(value.x),
        y: Math.round(value.y)
      }
    : { x: 0, y: 0 };
}

function normalizeCanvasGroupFootprint(value: unknown): CanvasNodeFootprint {
  if (
    !isRecord(value) ||
    typeof value.width !== 'number' ||
    !Number.isFinite(value.width) ||
    typeof value.height !== 'number' ||
    !Number.isFinite(value.height)
  ) {
    return DEFAULT_CANVAS_GROUP_SIZE;
  }

  return {
    width: Math.max(MINIMUM_CANVAS_GROUP_SIZE.width, Math.round(value.width)),
    height: Math.max(MINIMUM_CANVAS_GROUP_SIZE.height, Math.round(value.height))
  };
}

function normalizeCanvasNodeGroupMemberships(
  nodes: readonly CanvasNodeSummary[],
  groups: readonly CanvasGroupSummary[]
): CanvasNodeSummary[] {
  const groupIds = new Set(groups.map((group) => group.id));
  return nodes.map((node) =>
    node.groupId && (!groupIds.has(node.groupId) || !isAllowedCanvasGroupMemberKind(node.kind))
      ? {
          ...node,
          groupId: undefined
        }
      : node
  );
}

function removeMissingGroupNodeMemberships(
  groups: readonly CanvasGroupSummary[],
  nodes: readonly CanvasNodeSummary[]
): CanvasGroupSummary[] {
  const groupIds = new Set(groups.map((group) => group.id));
  return normalizeCanvasGroupParentIds(
    groups.map((group) =>
      group.parentGroupId && !groupIds.has(group.parentGroupId)
        ? {
            ...group,
            parentGroupId: undefined
          }
        : group
    )
  );
}

function isStableCanvasGroupMemberKind(kind: CanvasNodeKind): boolean {
  return kind === 'agent' || kind === 'terminal' || kind === 'note';
}

function isAutomaticFileArtifactNodeKind(kind: CanvasNodeKind): boolean {
  return kind === 'file' || kind === 'file-list';
}

function isAllowedCanvasGroupMemberKind(kind: CanvasNodeKind): boolean {
  return isStableCanvasGroupMemberKind(kind) || isAutomaticFileArtifactNodeKind(kind);
}

function wouldCreateGroupCycle(groups: readonly CanvasGroupSummary[], groupId: string, parentGroupId: string): boolean {
  let nextParentId: string | undefined = parentGroupId;
  const visited = new Set<string>();
  while (nextParentId) {
    if (nextParentId === groupId) {
      return true;
    }

    if (visited.has(nextParentId)) {
      return true;
    }

    visited.add(nextParentId);
    nextParentId = groups.find((group) => group.id === nextParentId)?.parentGroupId;
  }

  return false;
}

function readNextGroupSequence(state: Pick<CanvasPrototypeState, 'groups' | 'nextGroupSequence'>): number {
  const persistedSequence =
    typeof state.nextGroupSequence === 'number' && Number.isInteger(state.nextGroupSequence) && state.nextGroupSequence > 0
      ? state.nextGroupSequence
      : 1;
  const maxSequence = (state.groups ?? []).reduce((currentMax, group) => {
    const parsedValue = readCanvasGroupDisplaySequence(group);
    return parsedValue === undefined ? currentMax : Math.max(currentMax, parsedValue);
  }, 0);

  return Math.max(persistedSequence, maxSequence + 1);
}

function readCanvasGroupDisplaySequence(group: Pick<CanvasGroupSummary, 'id'>): number | undefined {
  const matchedPrefix = group.id.match(/^group-([1-9]\d*)(?:-.+)?$/u);
  if (!matchedPrefix) {
    return undefined;
  }

  const parsedValue = Number.parseInt(matchedPrefix[1], 10);
  return Number.isFinite(parsedValue) ? parsedValue : undefined;
}

function rectForNode(node: Pick<CanvasNodeSummary, 'position' | 'size'>): CanvasRect {
  return {
    left: node.position.x,
    top: node.position.y,
    right: node.position.x + node.size.width,
    bottom: node.position.y + node.size.height
  };
}

function rectForGroup(group: Pick<CanvasGroupSummary, 'position' | 'size'>): CanvasRect {
  return {
    left: group.position.x,
    top: group.position.y,
    right: group.position.x + group.size.width,
    bottom: group.position.y + group.size.height
  };
}

function groupFromRect(group: CanvasGroupSummary, rect: CanvasRect): CanvasGroupSummary {
  return {
    ...group,
    position: {
      x: Math.round(rect.left),
      y: Math.round(rect.top)
    },
    size: {
      width: Math.max(MINIMUM_CANVAS_GROUP_SIZE.width, Math.round(rect.right - rect.left)),
      height: Math.max(MINIMUM_CANVAS_GROUP_SIZE.height, Math.round(rect.bottom - rect.top))
    }
  };
}

function translateGroup(group: CanvasGroupSummary, delta: CanvasNodePosition): CanvasGroupSummary {
  return {
    ...group,
    position: {
      x: Math.round(group.position.x + delta.x),
      y: Math.round(group.position.y + delta.y)
    }
  };
}

function translateNode(node: CanvasNodeSummary, delta: CanvasNodePosition): CanvasNodeSummary {
  return {
    ...node,
    position: {
      x: Math.round(node.position.x + delta.x),
      y: Math.round(node.position.y + delta.y)
    }
  };
}

interface CanvasRectInsets {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function expandRectToContainRects(rect: CanvasRect, innerRects: readonly CanvasRect[], insets: CanvasRectInsets): CanvasRect {
  return innerRects.reduce(
    (current, innerRect) => ({
      left: Math.min(current.left, innerRect.left - insets.left),
      top: Math.min(current.top, innerRect.top - insets.top),
      right: Math.max(current.right, innerRect.right + insets.right),
      bottom: Math.max(current.bottom, innerRect.bottom + insets.bottom)
    }),
    rect
  );
}

function boundingRectForRects(rects: readonly CanvasRect[]): CanvasRect | undefined {
  if (rects.length === 0) {
    return undefined;
  }

  return rects.reduce(
    (current, rect) => ({
      left: Math.min(current.left, rect.left),
      top: Math.min(current.top, rect.top),
      right: Math.max(current.right, rect.right),
      bottom: Math.max(current.bottom, rect.bottom)
    }),
    {
      left: rects[0].left,
      top: rects[0].top,
      right: rects[0].right,
      bottom: rects[0].bottom
    }
  );
}

function expandRectByPadding(rect: CanvasRect, padding: number): CanvasRect {
  return expandRectByInsets(rect, { left: padding, top: padding, right: padding, bottom: padding });
}

function expandRectByInsets(rect: CanvasRect, insets: CanvasRectInsets): CanvasRect {
  return {
    left: rect.left - insets.left,
    top: rect.top - insets.top,
    right: rect.right + insets.right,
    bottom: rect.bottom + insets.bottom
  };
}

function rectContainsRect(outer: CanvasRect, inner: CanvasRect): boolean {
  return outer.left <= inner.left && outer.top <= inner.top && outer.right >= inner.right && outer.bottom >= inner.bottom;
}

function rectsIntersect(left: CanvasRect, right: CanvasRect): boolean {
  return left.left < right.right && left.right > right.left && left.top < right.bottom && left.bottom > right.top;
}

function pointInRect(point: CanvasNodePosition, rect: CanvasRect): boolean {
  return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
}

function rectContainsPoint(rect: CanvasRect, point: CanvasNodePosition): boolean {
  return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
}

function groupDepth(groups: readonly CanvasGroupSummary[], groupId: string): number {
  let depth = 0;
  let currentGroup = groups.find((group) => group.id === groupId);
  const visited = new Set<string>();
  while (currentGroup?.parentGroupId && !visited.has(currentGroup.parentGroupId)) {
    visited.add(currentGroup.parentGroupId);
    depth += 1;
    currentGroup = groups.find((group) => group.id === currentGroup?.parentGroupId);
  }

  return depth;
}

function groupsEqualGeometry(left: CanvasGroupSummary, right: CanvasGroupSummary): boolean {
  return (
    left.position.x === right.position.x &&
    left.position.y === right.position.y &&
    left.size.width === right.size.width &&
    left.size.height === right.size.height
  );
}

function groupsEqualCollectionGeometry(
  leftGroups: readonly CanvasGroupSummary[],
  rightGroups: readonly CanvasGroupSummary[]
): boolean {
  if (leftGroups.length !== rightGroups.length) {
    return false;
  }

  const rightGroupsById = new Map(rightGroups.map((group) => [group.id, group] as const));
  return leftGroups.every((group) => {
    const rightGroup = rightGroupsById.get(group.id);
    return rightGroup !== undefined && groupsEqualGeometry(group, rightGroup);
  });
}

function normalizeCanvasNodeFootprintForPersistence(
  node: Pick<CanvasNodeSummary, 'kind' | 'metadata'>,
  value: unknown,
  view?: Pick<CanvasFileViewConfiguration, 'displayStyle' | 'nodeDisplayMode' | 'pathDisplayMode'>
): CanvasNodeFootprint {
  if (node.kind !== 'file' || view?.displayStyle !== 'minimal') {
    return normalizeCanvasNodeFootprint(node.kind, value);
  }

  const fallback = resolveMinimalFileNodeFootprint(node.metadata?.file, view);
  if (
    !isRecord(value) ||
    typeof value.width !== 'number' ||
    !Number.isFinite(value.width) ||
    typeof value.height !== 'number' ||
    !Number.isFinite(value.height)
  ) {
    return fallback;
  }

  const minimum = resolveMinimalFileNodeFootprint(node.metadata?.file, view);
  return {
    width: Math.max(minimum.width, Math.round(value.width)),
    height: Math.max(minimum.height, Math.round(value.height))
  };
}

function rebuildCanvasFileArtifacts(
  state: CanvasPrototypeState,
  options: {
    view: CanvasFileViewConfiguration;
    preserveAutomaticFileNodeSizes: boolean;
  }
): CanvasPrototypeState {
  const workspaceRootGroups = state.groups.filter(isWorkspaceRootGroup);
  const rebuiltState = workspaceRootGroups.length > 0
    ? rebuildMultiRootCanvasFileArtifacts(state, options, workspaceRootGroups)
    : rebuildCanvasFileArtifactsForNodeScope(
        state,
        options,
        state.nodes.filter((node) => !isAutomaticFileArtifactNodeKind(node.kind)),
        {
          allowedGroupId: undefined,
          namespaceId: undefined
        }
      );
  return finalizeCanvasGroupState(rebuiltState);
}

function rebuildMultiRootCanvasFileArtifacts(
  state: CanvasPrototypeState,
  options: {
    view: CanvasFileViewConfiguration;
    preserveAutomaticFileNodeSizes: boolean;
  },
  workspaceRootGroups: CanvasGroupSummary[]
): CanvasPrototypeState {
  let nextState = state;
  for (const rootGroup of workspaceRootGroups) {
    const rootPath = resolveWorkspaceRootPathForGroup(rootGroup);
    if (!rootPath) {
      continue;
    }

    const rootManualNodes = state.nodes.filter(
      (node) =>
        !isAutomaticFileArtifactNodeKind(node.kind) &&
        isCanvasNodeInWorkspaceRootScope(state.groups ?? [], node, rootGroup.id)
    );
    nextState = rebuildCanvasFileArtifactsForNodeScope(nextState, options, rootManualNodes, {
      allowedGroupId: rootGroup.id,
      namespaceId: rootGroup.id
    });
  }

  const rootScopedNodeIds = new Set(nextState.nodes.flatMap((node) =>
    isCanvasNodeInAnyWorkspaceRootScope(nextState.groups ?? [], node) ? [node.id] : []
  ));
  const workspaceLevelAutomaticNodes = nextState.nodes.filter(
    (node) =>
      isAutomaticFileArtifactNodeKind(node.kind) &&
      splitNamespacedCanvasObjectId(node.id) === undefined &&
      !rootScopedNodeIds.has(node.id)
  );
  if (workspaceLevelAutomaticNodes.length === 0) {
    return nextState;
  }

  const workspaceLevelAutomaticNodeIds = new Set(workspaceLevelAutomaticNodes.map((node) => node.id));
  return {
    ...nextState,
    nodes: nextState.nodes.filter((node) => !workspaceLevelAutomaticNodeIds.has(node.id)),
    edges: nextState.edges.filter(
      (edge) =>
        !workspaceLevelAutomaticNodeIds.has(edge.sourceNodeId) &&
        !workspaceLevelAutomaticNodeIds.has(edge.targetNodeId)
    )
  };
}

function rebuildCanvasFileArtifactsForNodeScope(
  state: CanvasPrototypeState,
  options: {
    view: CanvasFileViewConfiguration;
    preserveAutomaticFileNodeSizes: boolean;
  },
  manualNodes: CanvasNodeSummary[],
  scope: {
    allowedGroupId: string | undefined;
    namespaceId: string | undefined;
  }
): CanvasPrototypeState {
  const existingAutoNodes = new Map(
    state.nodes
      .filter((node) => isAutomaticFileArtifactNodeKind(node.kind))
      .map((node) => [node.id, node] as const)
  );
  const manualNodeIds = new Set(manualNodes.map((node) => node.id));
  const manualNodesById = new Map(manualNodes.map((node) => [node.id, node] as const));
  const agentNodesById = new Map(
    manualNodes.filter((node) => node.kind === 'agent').map((node) => [node.id, node] as const)
  );
  const authoritativeFileReferences = state.fileReferences
    .filter((reference) => !isCanvasObjectIdOutsideWorkspaceRootNamespace(reference.id, scope.namespaceId))
    .map((reference) => ({
      ...reference,
      owners: reference.owners.filter((owner) => manualNodeIds.has(owner.nodeId))
    }))
    .filter((reference) => reference.owners.length > 0)
    .map((reference) => namespaceFileReferenceForScope(reference, scope.namespaceId));
  const scopedAuthoritativeFileReferences = mergeCanvasFileReferences(authoritativeFileReferences);
  const scopedAutomaticNodeIds = new Set(
    state.nodes
      .filter((node) =>
        isAutomaticFileArtifactNodeKind(node.kind) &&
        isAutomaticFileArtifactNodeInScope(node, scope, state.groups ?? [])
      )
      .map((node) => node.id)
  );
  if (!options.view.enabled) {
    const userEdges = state.edges.filter(
      (edge) =>
        edge.owner === 'user' &&
        manualNodeIds.has(edge.sourceNodeId) &&
        manualNodeIds.has(edge.targetNodeId)
    );
    const retainedNodes = state.nodes.filter(
      (node) => !manualNodeIds.has(node.id) && !scopedAutomaticNodeIds.has(node.id)
    );
    const retainedNodeIds = new Set(retainedNodes.map((node) => node.id));
    const retainedEdges = state.edges.filter(
      (edge) =>
        !manualNodeIds.has(edge.sourceNodeId) &&
        !manualNodeIds.has(edge.targetNodeId) &&
        !scopedAutomaticNodeIds.has(edge.sourceNodeId) &&
        !scopedAutomaticNodeIds.has(edge.targetNodeId) &&
        retainedNodeIds.has(edge.sourceNodeId) &&
        retainedNodeIds.has(edge.targetNodeId)
    );

    return {
      ...state,
      nodes: [...retainedNodes, ...manualNodes],
      edges: [...retainedEdges, ...userEdges],
      fileReferences: removeFileReferenceOwnersForNodeIds(state.fileReferences, manualNodeIds),
      suppressedFileActivityEdgeIds: filterSuppressedFileActivityEdgeIdsForScope(
        state.suppressedFileActivityEdgeIds,
        new Set(),
        userEdges,
        scope.namespaceId
      ),
      suppressedAutomaticFileArtifactNodeIds: filterSuppressedAutomaticFileArtifactNodeIdsForScope(
        state.suppressedAutomaticFileArtifactNodeIds,
        new Set(),
        scope.namespaceId
      )
    };
  }
  const projectedFileReferences = scopedAuthoritativeFileReferences.filter((reference) =>
    shouldIncludeFileReference(reference, options.view.includeGlobs, options.view.excludeGlobs)
  );
  const automaticArtifactNodeIds = collectAutomaticFileArtifactNodeIds(scopedAuthoritativeFileReferences);
  const allAutomaticArtifacts =
    options.view.presentationMode === 'lists'
      ? buildAutomaticFileListArtifacts(scopedAuthoritativeFileReferences, manualNodes, agentNodesById, existingAutoNodes)
      : buildAutomaticFileNodeArtifacts(
          scopedAuthoritativeFileReferences,
          manualNodes,
          agentNodesById,
          existingAutoNodes,
          options.preserveAutomaticFileNodeSizes,
          {
            displayStyle: options.view.displayStyle,
            nodeDisplayMode: options.view.nodeDisplayMode,
            pathDisplayMode: options.view.pathDisplayMode
          }
        );
  const automaticArtifacts =
    options.view.presentationMode === 'lists'
      ? buildAutomaticFileListArtifacts(projectedFileReferences, manualNodes, agentNodesById, existingAutoNodes)
      : buildAutomaticFileNodeArtifacts(
          projectedFileReferences,
          manualNodes,
          agentNodesById,
          existingAutoNodes,
          options.preserveAutomaticFileNodeSizes,
          {
            displayStyle: options.view.displayStyle,
            nodeDisplayMode: options.view.nodeDisplayMode,
            pathDisplayMode: options.view.pathDisplayMode
          }
        );
  const scopedAutomaticArtifacts = {
    nodes: automaticArtifacts.nodes.map((node) =>
      withCanvasNodeGroupId(
        node,
        resolveAutomaticFileArtifactGroupId(
          node,
          manualNodesById,
          state.groups ?? [],
          scope.allowedGroupId
        )
      )
    ),
    edges: automaticArtifacts.edges
  };
  const suppressedAutomaticFileArtifactNodeIds = new Set(state.suppressedAutomaticFileArtifactNodeIds);
  const projectedNodes = [
    ...manualNodes,
    ...scopedAutomaticArtifacts.nodes.filter((node) => !suppressedAutomaticFileArtifactNodeIds.has(node.id))
  ];
  const projectedNodeIds = new Set(projectedNodes.map((node) => node.id));
  const automaticEdgeIds = new Set(allAutomaticArtifacts.edges.map((edge) => edge.id));
  const suppressedFileActivityEdgeIds = new Set(state.suppressedFileActivityEdgeIds);
  const userEdges = state.edges.filter(
    (edge) =>
      edge.owner === 'user' &&
      projectedNodeIds.has(edge.sourceNodeId) &&
      projectedNodeIds.has(edge.targetNodeId)
  );
  const automaticEdges = automaticArtifacts.edges.filter(
    (edge) =>
      !suppressedFileActivityEdgeIds.has(edge.id) &&
      projectedNodeIds.has(edge.sourceNodeId) &&
      projectedNodeIds.has(edge.targetNodeId)
  );
  const replacedNodeIds = new Set<string>([
    ...manualNodeIds,
    ...scopedAutomaticNodeIds
  ]);
  const retainedNodes = state.nodes.filter((node) => !replacedNodeIds.has(node.id));
  const retainedNodeIds = new Set(retainedNodes.map((node) => node.id));
  const retainedEdges = state.edges.filter(
    (edge) =>
      !manualNodeIds.has(edge.sourceNodeId) &&
      !manualNodeIds.has(edge.targetNodeId) &&
      !automaticEdgeIds.has(edge.id) &&
      retainedNodeIds.has(edge.sourceNodeId) &&
      retainedNodeIds.has(edge.targetNodeId)
  );
  const retainedFileReferences = removeFileReferenceOwnersForNodeIds(state.fileReferences, manualNodeIds);

  return {
    ...state,
    nodes: [...retainedNodes, ...projectedNodes],
    edges: [...retainedEdges, ...userEdges, ...automaticEdges],
    fileReferences: [...retainedFileReferences, ...scopedAuthoritativeFileReferences],
    suppressedFileActivityEdgeIds: filterSuppressedFileActivityEdgeIdsForScope(
      state.suppressedFileActivityEdgeIds,
      automaticEdgeIds,
      userEdges,
      scope.namespaceId
    ),
    suppressedAutomaticFileArtifactNodeIds: filterSuppressedAutomaticFileArtifactNodeIdsForScope(
      state.suppressedAutomaticFileArtifactNodeIds,
      automaticArtifactNodeIds,
      scope.namespaceId
    )
  };
}

function namespaceFileReferenceForScope(
  reference: CanvasFileReferenceSummary,
  namespaceId: string | undefined
): CanvasFileReferenceSummary {
  if (!namespaceId || splitNamespacedCanvasObjectId(reference.id)) {
    return reference;
  }

  return {
    ...reference,
    id: `${namespaceId}:${reference.id}`
  };
}

function mergeCanvasFileReferences(
  fileReferences: readonly CanvasFileReferenceSummary[]
): CanvasFileReferenceSummary[] {
  const referencesById = new Map<string, CanvasFileReferenceSummary>();
  for (const reference of fileReferences) {
    const existingReference = referencesById.get(reference.id);
    if (!existingReference) {
      referencesById.set(reference.id, reference);
      continue;
    }

    referencesById.set(reference.id, {
      ...existingReference,
      filePath: reference.filePath || existingReference.filePath,
      relativePath: reference.relativePath ?? existingReference.relativePath,
      updatedAt: compareTimestamp(reference.updatedAt, existingReference.updatedAt) >= 0
        ? reference.updatedAt
        : existingReference.updatedAt,
      owners: reference.owners.reduce(
        (owners, owner) => mergeFileReferenceOwners(owners, owner),
        existingReference.owners
      )
    });
  }
  return Array.from(referencesById.values());
}

function compareTimestamp(left: string | undefined, right: string | undefined): number {
  const leftTime = left ? Date.parse(left) : Number.NaN;
  const rightTime = right ? Date.parse(right) : Number.NaN;
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) {
    return leftTime - rightTime;
  }
  if (Number.isFinite(leftTime)) {
    return 1;
  }
  if (Number.isFinite(rightTime)) {
    return -1;
  }
  return 0;
}

function removeFileReferenceOwnersForNodeIds(
  fileReferences: readonly CanvasFileReferenceSummary[],
  nodeIds: ReadonlySet<string>
): CanvasFileReferenceSummary[] {
  return fileReferences
    .map((reference) => ({
      ...reference,
      owners: reference.owners.filter((owner) => !nodeIds.has(owner.nodeId))
    }))
    .filter((reference) => reference.owners.length > 0);
}

function withCanvasNodeGroupId(
  node: CanvasNodeSummary,
  groupId: string | undefined
): CanvasNodeSummary {
  return groupId
    ? {
        ...node,
        groupId
      }
    : {
        ...node,
        groupId: undefined
      };
}

function resolveAutomaticFileArtifactGroupId(
  node: CanvasNodeSummary,
  ownerNodesById: ReadonlyMap<string, CanvasNodeSummary>,
  groups: readonly CanvasGroupSummary[],
  fallbackGroupId: string | undefined
): string | undefined {
  const ownerNodes = resolveAutomaticFileArtifactOwnerNodeIds(node)
    .map((ownerNodeId) => ownerNodesById.get(ownerNodeId))
    .filter((ownerNode): ownerNode is CanvasNodeSummary => Boolean(ownerNode));
  if (ownerNodes.length === 0) {
    return resolveValidTargetGroupId(groups, fallbackGroupId);
  }

  return resolveCommonOwnerGroupId(ownerNodes, groups, fallbackGroupId);
}

function resolveAutomaticFileArtifactOwnerNodeIds(node: CanvasNodeSummary): string[] {
  const ownerNodeIds = new Set<string>();
  if (node.kind === 'file') {
    for (const ownerNodeId of node.metadata?.file?.ownerNodeIds ?? []) {
      ownerNodeIds.add(ownerNodeId);
    }
  }

  if (node.kind === 'file-list') {
    const fileListMetadata = node.metadata?.fileList;
    if (fileListMetadata?.ownerNodeId) {
      ownerNodeIds.add(fileListMetadata.ownerNodeId);
    }
    for (const entry of fileListMetadata?.entries ?? []) {
      for (const ownerNodeId of entry.ownerNodeIds) {
        ownerNodeIds.add(ownerNodeId);
      }
    }
  }

  return [...ownerNodeIds];
}

function resolveCommonOwnerGroupId(
  ownerNodes: readonly CanvasNodeSummary[],
  groups: readonly CanvasGroupSummary[],
  fallbackGroupId: string | undefined
): string | undefined {
  const resolvedFallbackGroupId = resolveValidTargetGroupId(groups, fallbackGroupId);
  const ownerGroupChains = ownerNodes.map((node) =>
    resolveGroupAncestorChain(groups, node.groupId, resolvedFallbackGroupId)
  );
  if (ownerGroupChains.length === 0) {
    return resolvedFallbackGroupId;
  }

  const [firstChain] = ownerGroupChains;
  for (const groupId of firstChain) {
    if (ownerGroupChains.every((chain) => chain.includes(groupId))) {
      return groupId;
    }
  }

  return resolvedFallbackGroupId;
}

function resolveGroupAncestorChain(
  groups: readonly CanvasGroupSummary[],
  groupId: string | undefined,
  fallbackGroupId: string | undefined
): string[] {
  const groupIds = new Set(groups.map((group) => group.id));
  const chain: string[] = [];
  const visited = new Set<string>();
  let currentGroupId = groupId && groupIds.has(groupId) ? groupId : undefined;
  while (currentGroupId && !visited.has(currentGroupId)) {
    chain.push(currentGroupId);
    visited.add(currentGroupId);
    currentGroupId = groups.find((group) => group.id === currentGroupId)?.parentGroupId;
  }

  if (fallbackGroupId && groupIds.has(fallbackGroupId) && !chain.includes(fallbackGroupId)) {
    chain.push(fallbackGroupId);
  }

  return chain;
}

function isAutomaticFileArtifactNodeInScope(
  node: CanvasNodeSummary,
  scope: {
    allowedGroupId: string | undefined;
    namespaceId: string | undefined;
  },
  groups: readonly CanvasGroupSummary[]
): boolean {
  if (!scope.allowedGroupId) {
    return true;
  }

  if (node.groupId === scope.allowedGroupId) {
    return true;
  }

  if (node.groupId && resolveContainingWorkspaceRootGroupId(groups, node.groupId) === scope.allowedGroupId) {
    return true;
  }

  const namespacedId = splitNamespacedCanvasObjectId(node.id);
  if (namespacedId) {
    return namespacedId.namespaceId === scope.namespaceId;
  }

  const legacyArtifactNamespaceId = resolveLegacyAutomaticFileArtifactNamespaceId(node.id);
  if (legacyArtifactNamespaceId) {
    return legacyArtifactNamespaceId === scope.namespaceId;
  }

  return node.groupId === undefined;
}

function filterSuppressedFileActivityEdgeIdsForScope(
  existingEdgeIds: readonly string[],
  automaticEdgeIds: ReadonlySet<string>,
  userEdges: readonly CanvasEdgeSummary[],
  namespaceId: string | undefined
): string[] {
  const userEdgeIds = new Set(userEdges.map((edge) => edge.id));
  return uniqueCanvasStrings(existingEdgeIds.filter((edgeId) => {
    if (isCanvasObjectIdOutsideWorkspaceRootNamespace(edgeId, namespaceId)) {
      return true;
    }
    return automaticEdgeIds.has(edgeId) || userEdgeIds.has(edgeId);
  }));
}

function filterSuppressedAutomaticFileArtifactNodeIdsForScope(
  existingNodeIds: readonly string[],
  automaticArtifactNodeIds: ReadonlySet<string>,
  namespaceId: string | undefined
): string[] {
  return uniqueCanvasStrings(existingNodeIds.filter((nodeId) => {
    if (isCanvasObjectIdOutsideWorkspaceRootNamespace(nodeId, namespaceId)) {
      return true;
    }
    return automaticArtifactNodeIds.has(nodeId);
  }));
}

function uniqueCanvasStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values));
}

function isCanvasObjectIdOutsideWorkspaceRootNamespace(
  objectId: string,
  namespaceId: string | undefined
): boolean {
  if (!namespaceId) {
    return false;
  }
  const namespacedId = splitNamespacedCanvasObjectId(objectId);
  if (namespacedId) {
    return namespacedId.namespaceId !== namespaceId;
  }

  const legacyArtifactNamespaceId = resolveLegacyAutomaticFileArtifactNamespaceId(objectId);
  return legacyArtifactNamespaceId !== undefined && legacyArtifactNamespaceId !== namespaceId;
}

function resolveLegacyAutomaticFileArtifactNamespaceId(objectId: string): string | undefined {
  for (const prefix of ['file-', 'file-list-agent-']) {
    if (!objectId.startsWith(prefix)) {
      continue;
    }
    const remainder = objectId.slice(prefix.length);
    const separatorIndex = remainder.indexOf(':');
    if (separatorIndex <= 0) {
      continue;
    }
    const namespaceId = remainder.slice(0, separatorIndex);
    if (namespaceId.startsWith('workspace-root-')) {
      return namespaceId;
    }
  }
  return undefined;
}

function isCanvasNodeInWorkspaceRootScope(
  groups: readonly CanvasGroupSummary[],
  node: CanvasNodeSummary,
  rootGroupId: string
): boolean {
  if (node.groupId === rootGroupId) {
    return true;
  }
  return Boolean(node.groupId && resolveContainingWorkspaceRootGroupId(groups, node.groupId) === rootGroupId);
}

function isCanvasNodeInAnyWorkspaceRootScope(
  groups: readonly CanvasGroupSummary[],
  node: CanvasNodeSummary
): boolean {
  return Boolean(node.groupId && resolveContainingWorkspaceRootGroupId(groups, node.groupId));
}

function buildAutomaticFileNodeArtifacts(
  fileReferences: CanvasFileReferenceSummary[],
  manualNodes: CanvasNodeSummary[],
  agentNodesById: Map<string, CanvasNodeSummary>,
  existingAutoNodes: Map<string, CanvasNodeSummary>,
  preserveAutomaticFileNodeSizes: boolean,
  view: Pick<CanvasFileViewConfiguration, 'displayStyle' | 'nodeDisplayMode' | 'pathDisplayMode'>
): { nodes: CanvasNodeSummary[]; edges: CanvasEdgeSummary[] } {
  const nodes: CanvasNodeSummary[] = [];
  const edges: CanvasEdgeSummary[] = [];
  const singleOwnerFileCounts = new Map<string, number>();

  for (const reference of sortFileReferences(fileReferences)) {
    const nodeId = buildFileNodeId(reference.id);
    const existingNode = existingAutoNodes.get(nodeId);
    const placementPreference = resolveFileReferencePlacementPreference(reference);
    const anchor = resolveFileReferencePlacementAnchor(
      reference,
      agentNodesById,
      singleOwnerFileCounts,
      placementPreference
    );
    const occupiedNodes = [...manualNodes, ...nodes];
    const position = resolveAutomaticArtifactPosition(
      occupiedNodes,
      'file',
      anchor,
      existingNode,
      placementPreference
    );
    const title = buildFileDisplayLabel(reference, view.pathDisplayMode);
    const fileNode: CanvasNodeSummary = {
      id: nodeId,
      kind: 'file',
      title,
      status: 'linked',
      summary: reference.relativePath ?? reference.filePath,
      position,
      size: resolveAutomaticFileNodeSize(
        reference,
        preserveAutomaticFileNodeSizes ? existingNode : undefined,
        view
      ),
      metadata: {
        file: {
          fileId: reference.id,
          filePath: reference.filePath,
          relativePath: reference.relativePath,
          ownerNodeIds: reference.owners.map((owner) => owner.nodeId),
          icon: createDefaultFileIconDescriptor(reference.filePath)
        }
      }
    };
    nodes.push(fileNode);

    for (const owner of reference.owners) {
      const agentNode = agentNodesById.get(owner.nodeId);
      if (!agentNode) {
        continue;
      }

      edges.push(
        createAutomaticFileEdge({
          edgeId: buildAutomaticFileEdgeId(owner.nodeId, nodeId),
          referenceNode: fileNode,
          agentNode,
          accessMode: owner.accessMode
        })
      );
    }
  }

  return { nodes, edges };
}

function resolveAutomaticFileNodeSize(
  reference: CanvasFileReferenceSummary,
  existingNode: CanvasNodeSummary | undefined,
  view: Pick<CanvasFileViewConfiguration, 'displayStyle' | 'nodeDisplayMode' | 'pathDisplayMode'>
): CanvasNodeFootprint {
  const preferredSize = estimateAutomaticFileNodeFootprint(reference, view);
  if (!existingNode?.size) {
    return preferredSize;
  }

  if (isKnownAutomaticFileNodeDefaultSize(reference, existingNode.size)) {
    return preferredSize;
  }

  if (view.displayStyle === 'minimal') {
    return {
      width: Math.max(preferredSize.width, existingNode.size.width),
      height: preferredSize.height
    };
  }

  return existingNode.size;
}

function isKnownAutomaticFileNodeDefaultSize(
  reference: CanvasFileReferenceSummary,
  size: CanvasNodeFootprint
): boolean {
  const knownSizes: CanvasNodeFootprint[] = [
    estimatedCanvasNodeFootprint('file'),
    normalizeCanvasNodeFootprint('file', estimatedCanvasNodeFootprint('file'))
  ];
  const displayModes: CanvasFileNodeDisplayMode[] = ['icon-path', 'icon-only', 'path-only'];
  const pathModes: CanvasFilePathDisplayMode[] = ['basename', 'relative-path'];

  for (const nodeDisplayMode of displayModes) {
    for (const pathDisplayMode of pathModes) {
      const view = {
        displayStyle: 'minimal' as const,
        nodeDisplayMode,
        pathDisplayMode
      };
      knownSizes.push(
        estimateAutomaticFileNodeFootprint(reference, view),
        estimateLegacyAutomaticFileNodeFootprint(reference, view)
      );
    }
  }

  return knownSizes.some(
    (candidate) => candidate.width === size.width && candidate.height === size.height
  );
}

function estimateAutomaticFileNodeFootprint(
  reference: CanvasFileReferenceSummary,
  view: Pick<CanvasFileViewConfiguration, 'displayStyle' | 'nodeDisplayMode' | 'pathDisplayMode'>
): CanvasNodeFootprint {
  if (view.displayStyle === 'card') {
    return estimatedCanvasNodeFootprint('file');
  }

  return resolveMinimalFileNodeFootprint(
    {
      filePath: reference.filePath,
      relativePath: reference.relativePath
    },
    view
  );
}

function estimateLegacyAutomaticFileNodeFootprint(
  reference: CanvasFileReferenceSummary,
  view: Pick<CanvasFileViewConfiguration, 'displayStyle' | 'nodeDisplayMode' | 'pathDisplayMode'>
): CanvasNodeFootprint {
  if (view.displayStyle === 'card') {
    return estimatedCanvasNodeFootprint('file');
  }

  const primaryLabel = buildFileDisplayLabel(reference, view.pathDisplayMode);
  const textWidth = Math.max(
    measureApproximateCanvasTextWidth(primaryLabel, 12, 0.62),
    0
  );

  switch (view.nodeDisplayMode) {
    case 'icon-only':
      return {
        width: 28,
        height: 24
      };
    case 'path-only':
      return {
        width: Math.max(32, Math.min(320, Math.ceil(textWidth + 12))),
        height: 22
      };
    default:
      return {
        width: Math.max(64, Math.min(360, Math.ceil(textWidth + 36))),
        height: 24
      };
  }
}

function measureApproximateCanvasTextWidth(text: string, fontSizePx: number, widthFactor: number): number {
  return Math.max(0, text.length) * fontSizePx * widthFactor;
}

function resolveMinimalFileNodeFootprint(
  metadata: Pick<FileNodeMetadata, 'filePath' | 'relativePath'> | undefined,
  view: Pick<CanvasFileViewConfiguration, 'nodeDisplayMode' | 'pathDisplayMode'>
): CanvasNodeFootprint {
  const primaryLabel = metadata
    ? view.pathDisplayMode === 'relative-path'
      ? metadata.relativePath ?? metadata.filePath
      : path.basename(metadata.relativePath ?? metadata.filePath)
    : '';

  return estimateMinimalFileNodeFootprint(primaryLabel, view.nodeDisplayMode);
}

function buildAutomaticFileListArtifacts(
  fileReferences: CanvasFileReferenceSummary[],
  manualNodes: CanvasNodeSummary[],
  agentNodesById: Map<string, CanvasNodeSummary>,
  existingAutoNodes: Map<string, CanvasNodeSummary>
): { nodes: CanvasNodeSummary[]; edges: CanvasEdgeSummary[] } {
  const nodes: CanvasNodeSummary[] = [];
  const edges: CanvasEdgeSummary[] = [];
  const uniqueEntriesByAgent = new Map<string, FileListNodeEntrySummary[]>();
  const sharedEntries: FileListNodeEntrySummary[] = [];

  for (const reference of sortFileReferences(fileReferences)) {
    const entryBase = {
      fileId: reference.id,
      filePath: reference.filePath,
      relativePath: reference.relativePath,
      ownerNodeIds: reference.owners.map((owner) => owner.nodeId),
      icon: createDefaultFileIconDescriptor(reference.filePath)
    };

    if (reference.owners.length > 1) {
      sharedEntries.push({
        ...entryBase,
        accessMode: mergeAccessModes(reference.owners.map((owner) => owner.accessMode))
      });
      continue;
    }

    const [owner] = reference.owners;
    const bucket = uniqueEntriesByAgent.get(owner.nodeId) ?? [];
    bucket.push({
      ...entryBase,
      accessMode: owner.accessMode
    });
    uniqueEntriesByAgent.set(owner.nodeId, bucket);
  }

  for (const [agentNodeId, entries] of uniqueEntriesByAgent.entries()) {
    const agentNode = agentNodesById.get(agentNodeId);
    if (!agentNode) {
      continue;
    }

    const nodeId = buildAgentFileListNodeId(agentNodeId);
    const existingNode = existingAutoNodes.get(nodeId);
    const position = existingNode?.position
      ? existingNode.position
      : resolveNewNodePosition(
          [...manualNodes, ...nodes],
          'file-list',
          resolveFileListAnchor(agentNode, 'agent')
        );
    const fileListNode: CanvasNodeSummary = {
      id: nodeId,
      kind: 'file-list',
      title: `${agentNode.title} 文件`,
      status: 'linked',
      summary: `共 ${entries.length} 个文件`,
      position,
      size: existingNode?.size ?? estimatedCanvasNodeFootprint('file-list'),
      metadata: {
        fileList: {
          scope: 'agent',
          ownerNodeId: agentNodeId,
          entries
        }
      }
    };
    nodes.push(fileListNode);
    edges.push(
      createAutomaticFileEdge({
        edgeId: buildAutomaticFileEdgeId(agentNodeId, nodeId),
        referenceNode: fileListNode,
        agentNode,
        accessMode: mergeAccessModes(entries.map((entry) => entry.accessMode))
      })
    );
  }

  if (sharedEntries.length > 0) {
    const sharedNodeId = buildSharedFileListNodeId(sharedEntries);
    const existingNode = existingAutoNodes.get(sharedNodeId);
    const position = existingNode?.position
      ? existingNode.position
      : resolveNewNodePosition(
          [...manualNodes, ...nodes],
          'file-list',
          resolveSharedFileListAnchor(sharedEntries, agentNodesById)
        );
    const sharedNode: CanvasNodeSummary = {
      id: sharedNodeId,
      kind: 'file-list',
      title: '共享文件',
      status: 'linked',
      summary: `共 ${sharedEntries.length} 个共享文件`,
      position,
      size: existingNode?.size ?? estimatedCanvasNodeFootprint('file-list'),
      metadata: {
        fileList: {
          scope: 'shared',
          entries: sharedEntries
        }
      }
    };
    nodes.push(sharedNode);

    const sharedOwners = new Map<string, CanvasFileActivityAccessMode[]>();
    for (const entry of sharedEntries) {
      for (const ownerNodeId of entry.ownerNodeIds) {
        const bucket = sharedOwners.get(ownerNodeId) ?? [];
        bucket.push(entry.accessMode);
        sharedOwners.set(ownerNodeId, bucket);
      }
    }

    for (const [agentNodeId, accessModes] of sharedOwners.entries()) {
      const agentNode = agentNodesById.get(agentNodeId);
      if (!agentNode) {
        continue;
      }
      edges.push(
        createAutomaticFileEdge({
          edgeId: buildAutomaticFileEdgeId(agentNodeId, sharedNodeId),
          referenceNode: sharedNode,
          agentNode,
          accessMode: mergeAccessModes(accessModes)
        })
      );
    }
  }

  return { nodes, edges };
}

function buildFileNodeId(fileReferenceId: string): string {
  const namespacedId = splitNamespacedCanvasObjectId(fileReferenceId);
  return namespacedId
    ? `${namespacedId.namespaceId}:file-${namespacedId.localId}`
    : `file-${fileReferenceId}`;
}

function buildAgentFileListNodeId(agentNodeId: string): string {
  const namespacedId = splitNamespacedCanvasObjectId(agentNodeId);
  return namespacedId
    ? `${namespacedId.namespaceId}:file-list-agent-${namespacedId.localId}`
    : `file-list-agent-${agentNodeId}`;
}

function buildAutomaticFileEdgeId(ownerNodeId: string, artifactNodeId: string): string {
  const ownerNamespacedId = splitNamespacedCanvasObjectId(ownerNodeId);
  const artifactNamespacedId = splitNamespacedCanvasObjectId(artifactNodeId);
  if (
    ownerNamespacedId &&
    artifactNamespacedId &&
    ownerNamespacedId.namespaceId === artifactNamespacedId.namespaceId
  ) {
    return `${ownerNamespacedId.namespaceId}:${ownerNamespacedId.localId}::${artifactNamespacedId.localId}`;
  }

  return `${ownerNodeId}::${artifactNodeId}`;
}

function buildSharedFileListNodeId(entries: readonly FileListNodeEntrySummary[]): string {
  const namespaceId = resolveSingleCanvasNamespaceId(entries.flatMap((entry) => entry.ownerNodeIds));
  return namespaceId ? `${namespaceId}:file-list-shared` : 'file-list-shared';
}

function resolveSingleCanvasNamespaceId(objectIds: readonly string[]): string | undefined {
  let namespaceId: string | undefined;
  for (const objectId of objectIds) {
    const parts = splitNamespacedCanvasObjectId(objectId);
    if (!parts) {
      return undefined;
    }
    if (!namespaceId) {
      namespaceId = parts.namespaceId;
      continue;
    }
    if (namespaceId !== parts.namespaceId) {
      return undefined;
    }
  }
  return namespaceId;
}

function collectAutomaticFileArtifactNodeIds(
  fileReferences: CanvasFileReferenceSummary[]
): Set<string> {
  const nodeIds = new Set<string>();
  const uniqueAgentFileListOwnerIds = new Set<string>();
  const sharedOwnerNodeIds: string[][] = [];

  for (const reference of fileReferences) {
    nodeIds.add(buildFileNodeId(reference.id));
    if (reference.owners.length > 1) {
      sharedOwnerNodeIds.push(reference.owners.map((owner) => owner.nodeId));
      continue;
    }

    const [owner] = reference.owners;
    if (owner) {
      uniqueAgentFileListOwnerIds.add(owner.nodeId);
    }
  }

  for (const ownerNodeId of uniqueAgentFileListOwnerIds) {
    nodeIds.add(buildAgentFileListNodeId(ownerNodeId));
  }

  for (const ownerNodeIds of sharedOwnerNodeIds) {
    const namespaceId = resolveSingleCanvasNamespaceId(ownerNodeIds);
    nodeIds.add(namespaceId ? `${namespaceId}:file-list-shared` : 'file-list-shared');
  }

  return nodeIds;
}

function resolveAutomaticArtifactPosition(
  occupiedNodes: CanvasNodeSummary[],
  kind: CanvasNodeKind,
  anchor: CanvasNodePosition,
  existingNode?: CanvasNodeSummary,
  preference: NodePlacementPreference = 'right-down'
): CanvasNodePosition {
  const existingPosition = existingNode?.position;
  if (existingPosition) {
    return existingPosition;
  }

  return resolveNewNodePosition(occupiedNodes, kind, anchor, preference);
}

function resolveFileReferencePlacementAnchor(
  reference: CanvasFileReferenceSummary,
  agentNodesById: Map<string, CanvasNodeSummary>,
  singleOwnerFileCounts: Map<string, number>,
  preference: NodePlacementPreference
): CanvasNodePosition {
  const baseAnchor = resolveFileReferenceAnchor(reference, agentNodesById, 'file', preference);
  if (reference.owners.length !== 1) {
    return baseAnchor;
  }

  const [owner] = reference.owners;
  const countKey = `${owner.nodeId}:${preference}`;
  const offsetIndex = singleOwnerFileCounts.get(countKey) ?? 0;
  singleOwnerFileCounts.set(countKey, offsetIndex + 1);
  if (offsetIndex === 0) {
    return baseAnchor;
  }

  return snapCanvasPosition({
    x: baseAnchor.x,
    y: baseAnchor.y + (preference === 'left-up' ? -1 : 1) * offsetIndex * NODE_PLACEMENT_STEP_Y
  });
}

function resolveFileReferenceAnchor(
  reference: CanvasFileReferenceSummary,
  agentNodesById: Map<string, CanvasNodeSummary>,
  kind: 'file' | 'file-list',
  preference: NodePlacementPreference = 'right-down'
): CanvasNodePosition {
  const ownerNodes = reference.owners
    .map((owner) => agentNodesById.get(owner.nodeId))
    .filter((node): node is CanvasNodeSummary => Boolean(node));
  if (ownerNodes.length === 0) {
    return createNodePosition(1);
  }

  const averageLeft = ownerNodes.reduce((sum, node) => sum + node.position.x, 0) / ownerNodes.length;
  const averageRight =
    ownerNodes.reduce((sum, node) => sum + node.position.x + node.size.width, 0) / ownerNodes.length;
  const averageY =
    ownerNodes.reduce((sum, node) => sum + node.position.y + node.size.height / 3, 0) / ownerNodes.length;
  const footprint = estimatedCanvasNodeFootprint(kind);
  const horizontalOffset = kind === 'file' ? 140 : 180;

  return snapCanvasPosition({
    x:
      preference === 'left-up'
        ? averageLeft - footprint.width - horizontalOffset
        : averageRight + horizontalOffset,
    y: averageY
  });
}

function resolveFileReferencePlacementPreference(reference: CanvasFileReferenceSummary): NodePlacementPreference {
  return mergeAccessModes(reference.owners.map((owner) => owner.accessMode)) === 'read' ? 'left-up' : 'right-down';
}

function doesPlacementRespectPreference(
  position: CanvasNodePosition,
  kind: CanvasNodeKind,
  anchor: CanvasNodePosition,
  preference: NodePlacementPreference
): boolean {
  const footprint = estimatedCanvasNodeFootprint(kind);
  const centerX = position.x + footprint.width / 2;
  const centerY = position.y + footprint.height / 2;

  if (preference === 'left-up') {
    return centerX <= anchor.x + NODE_PLACEMENT_STEP_X && centerY <= anchor.y + NODE_PLACEMENT_STEP_Y;
  }

  return centerX >= anchor.x - NODE_PLACEMENT_STEP_X && centerY >= anchor.y - NODE_PLACEMENT_STEP_Y;
}

function resolveFileListAnchor(
  agentNode: CanvasNodeSummary,
  scope: 'agent' | 'shared'
): CanvasNodePosition {
  return snapCanvasPosition({
    x: agentNode.position.x + agentNode.size.width + 140,
    y: agentNode.position.y + (scope === 'shared' ? 120 : 20)
  });
}

function resolveSharedFileListAnchor(
  sharedEntries: FileListNodeEntrySummary[],
  agentNodesById: Map<string, CanvasNodeSummary>
): CanvasNodePosition {
  const ownerNodes = Array.from(
    new Set(sharedEntries.flatMap((entry) => entry.ownerNodeIds))
  )
    .map((nodeId) => agentNodesById.get(nodeId))
    .filter((node): node is CanvasNodeSummary => Boolean(node));
  if (ownerNodes.length === 0) {
    return createNodePosition(1);
  }

  const averageX =
    ownerNodes.reduce((sum, node) => sum + node.position.x + node.size.width, 0) / ownerNodes.length;
  const averageY =
    ownerNodes.reduce((sum, node) => sum + node.position.y + node.size.height / 2, 0) / ownerNodes.length;
  return snapCanvasPosition({
    x: averageX + 180,
    y: averageY + 80
  });
}

function createAutomaticFileEdge(params: {
  edgeId: string;
  referenceNode: CanvasNodeSummary;
  agentNode: CanvasNodeSummary;
  accessMode: CanvasFileActivityAccessMode;
}): CanvasEdgeSummary {
  const arrowMode = params.accessMode === 'read-write' ? 'both' : 'forward';
  if (params.accessMode === 'read') {
    return createAutomaticFileEdgeSummary(
      params.edgeId,
      params.referenceNode,
      params.agentNode,
      arrowMode
    );
  }

  return createAutomaticFileEdgeSummary(
    params.edgeId,
    params.agentNode,
    params.referenceNode,
    arrowMode
  );
}

function createAutomaticFileEdgeSummary(
  edgeId: string,
  sourceNode: Pick<CanvasNodeSummary, 'id' | 'position' | 'size'>,
  targetNode: Pick<CanvasNodeSummary, 'id' | 'position' | 'size'>,
  arrowMode: CanvasEdgeSummary['arrowMode']
): CanvasEdgeSummary {
  const anchors = resolveHorizontalCanvasEdgeAnchors(sourceNode, targetNode);
  return {
    id: edgeId,
    sourceNodeId: sourceNode.id,
    targetNodeId: targetNode.id,
    sourceAnchor: anchors.sourceAnchor,
    targetAnchor: anchors.targetAnchor,
    arrowMode,
    owner: 'file-activity'
  };
}

function sortFileReferences(fileReferences: CanvasFileReferenceSummary[]): CanvasFileReferenceSummary[] {
  return [...fileReferences].sort((left, right) =>
    (left.relativePath ?? left.filePath).localeCompare(right.relativePath ?? right.filePath)
  );
}

function mergeAccessModes(accessModes: CanvasFileActivityAccessMode[]): CanvasFileActivityAccessMode {
  const hasRead = accessModes.includes('read') || accessModes.includes('read-write');
  const hasWrite = accessModes.includes('write') || accessModes.includes('read-write');
  if (hasRead && hasWrite) {
    return 'read-write';
  }
  return hasWrite ? 'write' : 'read';
}

function normalizeCanvasFileFilterGlobs(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function createEmptyCanvasFileFilterState(): CanvasFileFilterState {
  return {
    includeGlobs: [],
    excludeGlobs: []
  };
}

function normalizeCanvasFileFilterState(value: unknown): CanvasFileFilterState {
  if (!isRecord(value)) {
    return createEmptyCanvasFileFilterState();
  }

  return {
    includeGlobs: normalizeCanvasFileFilterGlobs(value.includeGlobs),
    excludeGlobs: normalizeCanvasFileFilterGlobs(value.excludeGlobs)
  };
}

function areStringArraysEqual(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
}

function readLegacyCanvasFileFilterGlobs(kind: 'include' | 'exclude'): string[] {
  const key =
    kind === 'include' ? 'devSessionCanvas.files.includeGlobs' : 'devSessionCanvas.files.excludeGlobs';
  return normalizeCanvasFileFilterGlobs(vscode.workspace.getConfiguration().get<unknown>(key));
}

function shouldIncludeFileReference(
  reference: CanvasFileReferenceSummary,
  includeGlobs: string[],
  excludeGlobs: string[]
): boolean {
  const candidateText = reference.relativePath ?? reference.filePath;
  if (includeGlobs.length > 0 && !includeGlobs.some((pattern) => globPatternMatches(pattern, candidateText))) {
    return false;
  }

  return !excludeGlobs.some((pattern) => globPatternMatches(pattern, candidateText));
}

function globPatternMatches(pattern: string, value: string): boolean {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '::double-star::')
    .replace(/\*/g, '[^/]*')
    .replace(/::double-star::/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`).test(value.replace(/\\/g, '/'));
}

function createDefaultFileIconDescriptor(filePath: string): CanvasFileIconDescriptor {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.md') {
    return { kind: 'codicon', id: 'markdown' };
  }
  if (extension === '.ts' || extension === '.tsx' || extension === '.js' || extension === '.jsx') {
    return { kind: 'codicon', id: 'symbol-file' };
  }
  if (extension === '.json') {
    return { kind: 'codicon', id: 'json' };
  }
  return { kind: 'codicon', id: 'file' };
}

function buildFileDisplayLabel(
  reference: Pick<CanvasFileReferenceSummary, 'relativePath' | 'filePath'>,
  mode: CanvasFilePathDisplayMode
): string {
  const candidate = mode === 'relative-path' ? reference.relativePath ?? reference.filePath : path.basename(reference.filePath);
  return candidate || reference.filePath;
}

function createUserCanvasEdge(
  previousState: CanvasPrototypeState,
  edge: CanvasEdgeSummary
): CanvasPrototypeState {
  if (previousState.edges.some((existingEdge) => existingEdge.id === edge.id)) {
    return previousState;
  }
  if (!canConnectCanvasEdgeEndpoints(previousState, edge.sourceNodeId, edge.targetNodeId)) {
    return previousState;
  }

  return {
    ...previousState,
    updatedAt: new Date().toISOString(),
    edges: [...previousState.edges, edge]
  };
}

function createBranchAgentUserEdge(
  previousState: CanvasPrototypeState,
  sourceNode: Pick<CanvasNodeSummary, 'id' | 'position' | 'size'>,
  targetNode: Pick<CanvasNodeSummary, 'id' | 'position' | 'size'>
): CanvasPrototypeState {
  const anchors = resolveHorizontalCanvasEdgeAnchors(sourceNode, targetNode);
  return createUserCanvasEdge(previousState, {
    id: `edge-${randomUUID()}`,
    sourceNodeId: sourceNode.id,
    targetNodeId: targetNode.id,
    sourceAnchor: anchors.sourceAnchor,
    targetAnchor: anchors.targetAnchor,
    arrowMode: 'forward',
    owner: 'user',
    label: 'fork'
  });
}

function canConnectCanvasEdgeEndpoints(
  state: CanvasPrototypeState,
  sourceNodeId: string,
  targetNodeId: string
): boolean {
  const sourceNode = state.nodes.find((node) => node.id === sourceNodeId);
  const targetNode = state.nodes.find((node) => node.id === targetNodeId);
  if (!sourceNode || !targetNode) {
    return false;
  }

  const groups = state.groups ?? [];
  if (!groups.some(isWorkspaceRootGroup)) {
    return true;
  }

  const sourceRootGroupId = resolveContainingWorkspaceRootGroupId(groups, sourceNode.groupId);
  const targetRootGroupId = resolveContainingWorkspaceRootGroupId(groups, targetNode.groupId);
  return Boolean(sourceRootGroupId && sourceRootGroupId === targetRootGroupId);
}

function updateCanvasEdge(
  previousState: CanvasPrototypeState,
  edgeId: string,
  patch: {
    sourceNodeId?: string;
    targetNodeId?: string;
    sourceAnchor?: CanvasEdgeAnchor;
    targetAnchor?: CanvasEdgeAnchor;
    arrowMode?: CanvasEdgeArrowMode;
    color?: CanvasEdgeColor | null;
    label?: string;
  }
): CanvasPrototypeState {
  const edge = previousState.edges.find((candidate) => candidate.id === edgeId);
  if (!edge) {
    return previousState;
  }

  const patchedEdge = applyCanvasEdgePatch(edge, patch);
  if (!canConnectCanvasEdgeEndpoints(previousState, patchedEdge.sourceNodeId, patchedEdge.targetNodeId)) {
    return previousState;
  }
  if (areCanvasEdgesEquivalent(edge, patchedEdge)) {
    return previousState;
  }
  const nextEdge =
    edge.owner === 'file-activity'
      ? {
          ...patchedEdge,
          owner: 'user' as const
        }
      : patchedEdge;

  return {
    ...previousState,
    updatedAt: new Date().toISOString(),
    edges: previousState.edges.map((candidate) => (candidate.id === edgeId ? nextEdge : candidate)),
    suppressedFileActivityEdgeIds:
      edge.owner === 'file-activity'
        ? ensureSuppressedFileActivityEdgeId(previousState.suppressedFileActivityEdgeIds, edgeId)
        : previousState.suppressedFileActivityEdgeIds
  };
}

function deleteCanvasEdge(previousState: CanvasPrototypeState, edgeId: string): CanvasPrototypeState {
  const edge = previousState.edges.find((candidate) => candidate.id === edgeId);
  if (!edge) {
    return previousState;
  }

  const nextEdges = previousState.edges.filter((edge) => edge.id !== edgeId);
  return {
    ...previousState,
    updatedAt: new Date().toISOString(),
    edges: nextEdges,
    suppressedFileActivityEdgeIds:
      edge.owner === 'file-activity' || previousState.suppressedFileActivityEdgeIds.includes(edgeId)
        ? ensureSuppressedFileActivityEdgeId(previousState.suppressedFileActivityEdgeIds, edgeId)
        : previousState.suppressedFileActivityEdgeIds
  };
}

function normalizeCanvasEdgeLabel(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeCanvasEdgeColor(value: CanvasEdgeColor | undefined): CanvasEdgeColor | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  if (/^[1-6]$/.test(trimmed)) {
    return trimmed as CanvasEdgeColor;
  }

  return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(trimmed)
    ? (trimmed as CanvasEdgeColor)
    : undefined;
}

function applyCanvasEdgePatch(
  edge: CanvasEdgeSummary,
  patch: {
    sourceNodeId?: string;
    targetNodeId?: string;
    sourceAnchor?: CanvasEdgeAnchor;
    targetAnchor?: CanvasEdgeAnchor;
    arrowMode?: CanvasEdgeArrowMode;
    color?: CanvasEdgeColor | null;
    label?: string;
  }
): CanvasEdgeSummary {
  const hasColorPatch = Object.prototype.hasOwnProperty.call(patch, 'color');
  return {
    ...edge,
    sourceNodeId: patch.sourceNodeId ?? edge.sourceNodeId,
    targetNodeId: patch.targetNodeId ?? edge.targetNodeId,
    sourceAnchor: patch.sourceAnchor ?? edge.sourceAnchor,
    targetAnchor: patch.targetAnchor ?? edge.targetAnchor,
    arrowMode: patch.arrowMode ?? edge.arrowMode,
    color: hasColorPatch ? normalizeCanvasEdgeColor(patch.color ?? undefined) : edge.color,
    label: patch.label !== undefined ? normalizeCanvasEdgeLabel(patch.label) : edge.label
  };
}

function areCanvasEdgesEquivalent(left: CanvasEdgeSummary, right: CanvasEdgeSummary): boolean {
  return (
    left.id === right.id &&
    left.sourceNodeId === right.sourceNodeId &&
    left.targetNodeId === right.targetNodeId &&
    left.sourceAnchor === right.sourceAnchor &&
    left.targetAnchor === right.targetAnchor &&
    left.arrowMode === right.arrowMode &&
    left.owner === right.owner &&
    left.color === right.color &&
    left.label === right.label
  );
}

function ensureSuppressedFileActivityEdgeId(edgeIds: string[], edgeId: string): string[] {
  return edgeIds.includes(edgeId) ? edgeIds : [...edgeIds, edgeId];
}

function ensureSuppressedAutomaticFileArtifactNodeId(nodeIds: string[], nodeId: string): string[] {
  return nodeIds.includes(nodeId) ? nodeIds : [...nodeIds, nodeId];
}

function recordAgentFileActivity(
  previousState: CanvasPrototypeState,
  event: AgentFileActivityEvent & { nodeId: string; relativePath?: string }
): CanvasPrototypeState {
  const normalizedPath = normalizeTrackedFilePath(event.path);
  if (!normalizedPath) {
    return previousState;
  }

  const localReferenceId = buildFileReferenceId(normalizedPath);
  const referenceId = buildFileReferenceIdForOwner(normalizedPath, event.nodeId);
  const ownerNamespaceId = splitNamespacedCanvasObjectId(event.nodeId)?.namespaceId;
  const existingReference = previousState.fileReferences.find((reference) => reference.id === referenceId);
  const migratedOwners = ownerNamespaceId
    ? previousState.fileReferences
        .filter((reference) => reference.id === localReferenceId)
        .flatMap((reference) => reference.owners.filter((owner) =>
          splitNamespacedCanvasObjectId(owner.nodeId)?.namespaceId === ownerNamespaceId
        ))
    : [];
  const nextOwner: CanvasFileReferenceOwnerSummary = {
    nodeId: event.nodeId,
    accessMode: event.accessMode,
    updatedAt: event.timestamp
  };
  const targetOwners = [...migratedOwners, nextOwner].reduce(
    (owners, owner) => mergeFileReferenceOwners(owners, owner),
    existingReference?.owners ?? []
  );
  const targetReference: CanvasFileReferenceSummary = {
    ...(existingReference ?? {
      id: referenceId,
      filePath: normalizedPath
    }),
    id: referenceId,
    filePath: normalizedPath,
    relativePath: event.relativePath ?? existingReference?.relativePath,
    updatedAt: event.timestamp,
    owners: targetOwners
  };
  const retainedFileReferences = previousState.fileReferences.flatMap((reference): CanvasFileReferenceSummary[] => {
    if (reference.id === referenceId) {
      return [];
    }
    if (ownerNamespaceId && reference.id === localReferenceId) {
      const remainingOwners = reference.owners.filter((owner) =>
        splitNamespacedCanvasObjectId(owner.nodeId)?.namespaceId !== ownerNamespaceId
      );
      return remainingOwners.length > 0 ? [{ ...reference, owners: remainingOwners }] : [];
    }
    return [reference];
  });

  return {
    ...previousState,
    updatedAt: new Date().toISOString(),
    fileReferences: [...retainedFileReferences, targetReference]
  };
}

function removeAgentFileReferences(previousState: CanvasPrototypeState, nodeId: string): CanvasPrototypeState {
  const nextFileReferences = previousState.fileReferences
    .map((reference) => ({
      ...reference,
      owners: reference.owners.filter((owner) => owner.nodeId !== nodeId)
    }))
    .filter((reference) => reference.owners.length > 0);

  if (nextFileReferences.length === previousState.fileReferences.length) {
    const didChange = previousState.fileReferences.some((reference) =>
      reference.owners.some((owner) => owner.nodeId === nodeId)
    );
    if (!didChange) {
      return previousState;
    }
  }

  return {
    ...previousState,
    updatedAt: new Date().toISOString(),
    fileReferences: nextFileReferences
  };
}

function mergeFileReferenceOwners(
  owners: CanvasFileReferenceOwnerSummary[],
  nextOwner: CanvasFileReferenceOwnerSummary
): CanvasFileReferenceOwnerSummary[] {
  let didMerge = false;
  const nextOwners = owners.map((owner) => {
    if (owner.nodeId !== nextOwner.nodeId) {
      return owner;
    }

    didMerge = true;
    return {
      ...owner,
      accessMode: mergeAccessModes([owner.accessMode, nextOwner.accessMode]),
      updatedAt: nextOwner.updatedAt
    };
  });

  return didMerge ? nextOwners : [...owners, nextOwner];
}

function buildFileReferenceId(filePath: string): string {
  return createHash('sha256').update(filePath).digest('hex').slice(0, 16);
}

function buildFileReferenceIdForOwner(filePath: string, ownerNodeId: string): string {
  const localReferenceId = buildFileReferenceId(filePath);
  const ownerNamespaceId = splitNamespacedCanvasObjectId(ownerNodeId)?.namespaceId;
  return ownerNamespaceId ? `${ownerNamespaceId}:${localReferenceId}` : localReferenceId;
}

function normalizeTrackedFilePath(filePath: string): string | undefined {
  const trimmed = filePath.trim();
  if (!trimmed) {
    return undefined;
  }

  return path.normalize(trimmed);
}

function normalizeExecutionCwd(cwd: string): string | undefined {
  const trimmed = cwd.trim();
  return trimmed ? path.normalize(trimmed) : undefined;
}

function sanitizeExecutionImagePasteStorageSegment(value: string): string {
  const sanitized = value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[. -]+|[. -]+$/g, '')
    .slice(0, 80);
  return sanitized || 'agent';
}

function areSameExecutionPath(left: string, right: string): boolean {
  const resolvedLeft = path.resolve(left);
  const resolvedRight = path.resolve(right);
  return process.platform === 'win32'
    ? resolvedLeft.toLowerCase() === resolvedRight.toLowerCase()
    : resolvedLeft === resolvedRight;
}

function isSameOrDescendantExecutionPath(candidatePath: string, ancestorPath: string): boolean {
  const normalizedCandidate = normalizeComparableExecutionPath(candidatePath);
  const normalizedAncestor = normalizeComparableExecutionPath(ancestorPath);
  if (normalizedCandidate === normalizedAncestor) {
    return true;
  }

  const ancestorWithSeparator = normalizedAncestor.endsWith(path.sep)
    ? normalizedAncestor
    : `${normalizedAncestor}${path.sep}`;
  return normalizedCandidate.startsWith(ancestorWithSeparator);
}

function normalizeComparableExecutionPath(filePath: string): string {
  const resolvedPath = path.resolve(filePath);
  return process.platform === 'win32' ? resolvedPath.toLowerCase() : resolvedPath;
}

function buildExecutionAttentionNotificationTitleForWorkspace(
  kind: ExecutionNodeKind,
  context: ExecutionAttentionNotificationWorkspaceContext
): string {
  const workspaceLabel = resolveExecutionAttentionNotificationWorkspaceLabel(context);
  const rootLabel = resolveExecutionAttentionNotificationRootLabel(context);
  const targetLabel = kind === 'agent' ? 'Agent' : 'Terminal';
  return ['DSCanvas', workspaceLabel, rootLabel, targetLabel].filter(isNonEmptyString).join(' · ');
}

function resolveExecutionAttentionNotificationWorkspaceLabel(
  context: ExecutionAttentionNotificationWorkspaceContext
): string | undefined {
  const configuredWorkspaceName = trimStoredTerminalText(context.workspaceName ?? '').trim();
  if (configuredWorkspaceName) {
    return configuredWorkspaceName;
  }

  const firstWorkspaceFolderName = trimStoredTerminalText(context.workspaceFolders?.[0]?.name ?? '').trim();
  return firstWorkspaceFolderName || undefined;
}

function resolveExecutionAttentionNotificationRootLabel(
  context: ExecutionAttentionNotificationWorkspaceContext
): string | undefined {
  const workspaceFolders = context.workspaceFolders ?? [];
  if (workspaceFolders.length <= 1) {
    return undefined;
  }

  const cwd = normalizeExecutionCwd(context.cwd ?? '');
  if (!cwd) {
    return undefined;
  }

  return workspaceFolders
    .flatMap((folder) => {
      const folderPath = normalizeExecutionCwd(folder.path);
      const folderName = trimStoredTerminalText(folder.name).trim();
      return folderPath && folderName && isSameOrDescendantExecutionPath(cwd, folderPath)
        ? [{ name: folderName, path: folderPath }]
        : [];
    })
    .sort((left, right) => right.path.length - left.path.length)
    .at(0)?.name;
}

function isNonEmptyString(value: string | undefined): value is string {
  return typeof value === 'string' && value.length > 0;
}

function toNoteMarkdownDocumentSelection(
  document: vscode.TextDocument,
  selection: NoteMarkdownFileSelection | undefined
): vscode.Range | undefined {
  if (!selection) {
    return undefined;
  }

  const line = Math.min(Math.max(selection.line - 1, 0), Math.max(document.lineCount - 1, 0));
  const targetLine = document.lineAt(line);
  const column = Math.min(
    Math.max((selection.column ?? 1) - 1, 0),
    targetLine.text.length
  );
  const position = new vscode.Position(line, column);
  return new vscode.Range(position, position);
}

function normalizeState(
  value: unknown,
  defaultAgentProvider: AgentProviderKind = 'codex',
  fileView?: Pick<CanvasFileViewConfiguration, 'displayStyle' | 'nodeDisplayMode' | 'pathDisplayMode'>
): CanvasPrototypeState {
  if (!isRecord(value)) {
    return createDefaultState(defaultAgentProvider);
  }

  const hasStoredNodesArray = Array.isArray(value.nodes);
  const rawNodes: unknown[] = hasStoredNodesArray ? (value.nodes as unknown[]) : [];
  const nodes = rawNodes
    .map((node, index) => normalizeNode(node, index, defaultAgentProvider, fileView))
    .filter((node): node is CanvasNodeSummary => node !== null);

  const normalizedNodes = hasStoredNodesArray
    ? rawNodes.length === 0
      ? []
      : nodes.length > 0
        ? nodes
        : createDefaultState(defaultAgentProvider).nodes
    : createDefaultState(defaultAgentProvider).nodes;
  const edges = Array.isArray(value.edges)
    ? value.edges
        .map((edge) => normalizeCanvasEdge(edge))
        .filter((edge): edge is CanvasEdgeSummary => edge !== null)
    : [];
  const fileReferences = Array.isArray(value.fileReferences)
    ? value.fileReferences
        .map((reference) => normalizeCanvasFileReference(reference))
        .filter((reference): reference is CanvasFileReferenceSummary => reference !== null)
    : [];
  const suppressedFileActivityEdgeIds = Array.isArray(value.suppressedFileActivityEdgeIds)
    ? value.suppressedFileActivityEdgeIds.filter((edgeId): edgeId is string => typeof edgeId === 'string')
    : [];
  const suppressedAutomaticFileArtifactNodeIds = Array.isArray(value.suppressedAutomaticFileArtifactNodeIds)
    ? value.suppressedAutomaticFileArtifactNodeIds.filter((nodeId): nodeId is string => typeof nodeId === 'string')
    : [];

  const normalizedGroups = normalizeCanvasGroups(value.groups);
  const normalizedNodesWithGroups = normalizeCanvasNodeGroupMemberships(
    reconcileRuntimeNodesInArray(normalizedNodes),
    normalizedGroups
  );
  const nextGroupSequence = normalizeNextGroupSequence(value.nextGroupSequence, normalizedGroups);

  return {
    version: 1,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date().toISOString(),
    nodes: normalizedNodesWithGroups,
    edges,
    groups: removeMissingGroupNodeMemberships(normalizedGroups, normalizedNodesWithGroups),
    nextGroupSequence,
    fileReferences,
    suppressedFileActivityEdgeIds,
    suppressedAutomaticFileArtifactNodeIds
  };
}

function normalizeNextGroupSequence(value: unknown, groups: readonly CanvasGroupSummary[]): number {
  const maxSequence = groups.reduce((currentMax, group) => {
    const parsedValue = readCanvasGroupDisplaySequence(group);
    return parsedValue === undefined ? currentMax : Math.max(currentMax, parsedValue);
  }, 0);
  const fallback = maxSequence + 1;
  return typeof value === 'number' && Number.isInteger(value) && value > fallback ? value : fallback;
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

interface DowngradeLiveRuntimeNodesMissingRuntimeStoragePathResult {
  state: CanvasPrototypeState;
  downgradedCount: number;
}

function downgradeLiveRuntimeNodesMissingRuntimeStoragePath(
  state: CanvasPrototypeState,
  reason: string
): DowngradeLiveRuntimeNodesMissingRuntimeStoragePathResult {
  let downgradedCount = 0;
  const nodes: CanvasNodeSummary[] = state.nodes.map((node): CanvasNodeSummary => {
    if (node.kind === 'agent') {
      const metadata = ensureAgentMetadata(node);
      if (
        metadata.persistenceMode === 'live-runtime' &&
        metadata.runtimeSessionId &&
        !normalizeRuntimeStoragePath(metadata.runtimeStoragePath)
      ) {
        downgradedCount += 1;
        return {
          ...node,
          status: 'history-restored',
          summary: reason,
          metadata: {
            ...node.metadata,
            agent: {
              ...metadata,
              attachmentState: 'history-restored',
              runtimeBackend: undefined,
              runtimeGuarantee: undefined,
              runtimeStoragePath: undefined,
              runtimeSessionId: undefined,
              liveSession: false,
              pendingLaunch: undefined,
              lastRuntimeError: reason,
              lastExitMessage: metadata.lastExitMessage ?? reason
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
        downgradedCount += 1;
        return {
          ...node,
          status: 'history-restored',
          summary: reason,
          metadata: {
            ...node.metadata,
            terminal: {
              ...metadata,
              attachmentState: 'history-restored',
              runtimeBackend: undefined,
              runtimeGuarantee: undefined,
              runtimeStoragePath: undefined,
              runtimeSessionId: undefined,
              liveSession: false,
              pendingLaunch: undefined,
              lastRuntimeError: reason,
              lastExitMessage: metadata.lastExitMessage ?? reason
            }
          }
        };
      }
    }

    return node;
  });

  return {
    state: downgradedCount > 0
      ? {
          ...state,
          nodes
        }
      : state,
    downgradedCount
  };
}

function normalizeNode(
  value: unknown,
  index: number,
  defaultAgentProvider: AgentProviderKind = 'codex',
  fileView?: Pick<CanvasFileViewConfiguration, 'displayStyle' | 'nodeDisplayMode' | 'pathDisplayMode'>
): CanvasNodeSummary | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !isCanvasNodeKind(value.kind)) {
    return null;
  }

  const sequence = index + 1;
  const normalizedMetadata = normalizeMetadata(
    value.kind,
    value.id,
    typeof value.status === 'string' ? value.status : undefined,
    value.metadata,
    defaultAgentProvider
  );

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
    size: normalizeCanvasNodeFootprintForPersistence(
      {
        kind: value.kind,
        metadata: normalizedMetadata
      },
      value.size,
      fileView
    ),
    groupId:
      typeof value.groupId === 'string' && isAllowedCanvasGroupMemberKind(value.kind)
        ? value.groupId
        : undefined,
    metadata: normalizedMetadata
  };
}

function normalizeCanvasEdge(value: unknown): CanvasEdgeSummary | null {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.sourceNodeId !== 'string' ||
    typeof value.targetNodeId !== 'string' ||
    !isCanvasEdgeAnchor(value.sourceAnchor) ||
    !isCanvasEdgeAnchor(value.targetAnchor)
  ) {
    return null;
  }

  return {
    id: value.id,
    sourceNodeId: value.sourceNodeId,
    targetNodeId: value.targetNodeId,
    sourceAnchor: value.sourceAnchor,
    targetAnchor: value.targetAnchor,
    arrowMode: normalizeCanvasEdgeArrowMode(value.arrowMode),
    owner: value.owner === 'file-activity' ? 'file-activity' : 'user',
    color: typeof value.color === 'string' ? normalizeCanvasEdgeColor(value.color as CanvasEdgeColor) : undefined,
    label: typeof value.label === 'string' ? value.label : undefined
  };
}

function normalizeCanvasFileReference(value: unknown): CanvasFileReferenceSummary | null {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.filePath !== 'string' ||
    !Array.isArray(value.owners)
  ) {
    return null;
  }

  const owners = value.owners
    .map((owner) => normalizeCanvasFileReferenceOwner(owner))
    .filter((owner): owner is CanvasFileReferenceOwnerSummary => owner !== null);
  if (owners.length === 0) {
    return null;
  }

  return {
    id: value.id,
    filePath: value.filePath,
    relativePath: typeof value.relativePath === 'string' ? value.relativePath : undefined,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date().toISOString(),
    owners
  };
}

function normalizeCanvasFileReferenceOwner(value: unknown): CanvasFileReferenceOwnerSummary | null {
  if (
    !isRecord(value) ||
    typeof value.nodeId !== 'string' ||
    !isCanvasFileActivityAccessMode(value.accessMode)
  ) {
    return null;
  }

  return {
    nodeId: value.nodeId,
    accessMode: value.accessMode,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date().toISOString()
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

function summarizeHostMessageDetail(message: HostToWebviewMessage): Record<string, unknown> | undefined {
  switch (message.type) {
    case 'host/bootstrap':
    case 'host/stateUpdated':
      return {
        nodeCount: message.payload.state.nodes.length,
        groupCount: (message.payload.state.groups ?? []).length,
        updatedAt: message.payload.state.updatedAt,
        surfaceLocation: message.payload.runtime.surfaceLocation,
        workspaceTrusted: message.payload.runtime.workspaceTrusted,
        multiRootPresentationMode: message.payload.runtime.multiRootPresentationMode,
        workspaceRootGroups: summarizeWorkspaceRootGroupsForDiagnostics(message.payload.state)
      };
    case 'host/focusNode':
      return {
        nodeId: message.payload.nodeId
      };
    case 'host/centerNode':
      return {
        nodeId: message.payload.nodeId
      };
    case 'host/focusNodes':
      return {
        nodeIds: message.payload.nodeIds
      };
    case 'host/focusGroup':
      return {
        groupId: message.payload.groupId
      };
    case 'host/error':
      return {
        message: message.payload.message
      };
    case 'host/executionSnapshot':
      return {
        nodeId: message.payload.nodeId,
        kind: message.payload.kind,
        requestId: message.payload.requestId,
        executionSessionId: message.payload.executionSessionId,
        outputSequence: message.payload.outputSequence,
        cols: message.payload.cols,
        rows: message.payload.rows,
        liveSession: message.payload.liveSession,
        outputLength: message.payload.output.length,
        outputPreview: summarizeDiagnosticText(message.payload.output),
        hasSerializedTerminalState: message.payload.serializedTerminalState !== undefined
      };
    case 'host/executionOutput':
      return {
        nodeId: message.payload.nodeId,
        kind: message.payload.kind,
        executionSessionId: message.payload.executionSessionId,
        outputSequence: message.payload.outputSequence,
        chunkLength: message.payload.chunk.length,
        chunkPreview: summarizeDiagnosticText(message.payload.chunk)
      };
    case 'host/executionInputAck':
      return {
        nodeId: message.payload.nodeId,
        kind: message.payload.kind,
        sequence: message.payload.sequence,
        hostAckPostEpochMs: message.payload.hostAckPostEpochMs,
        queueDelayMs: message.payload.queueDelayMs,
        pendingControllerCount: message.payload.pendingControllerCount,
        queuedWriteCount: message.payload.queuedWriteCount,
        pendingOutputLength: message.payload.pendingOutputLength
      };
    case 'host/executionExit':
      return {
        nodeId: message.payload.nodeId,
        kind: message.payload.kind,
        message: message.payload.message
      };
    case 'host/executionFileLinksResolved':
      return {
        requestId: message.payload.requestId,
        nodeId: message.payload.nodeId,
        kind: message.payload.kind,
        resolvedLinkCount: message.payload.resolvedLinks.length
      };
    case 'host/executionPasteText':
      return {
        requestId: message.payload.requestId,
        nodeId: message.payload.nodeId,
        kind: message.payload.kind,
        textLength: message.payload.text.length,
        textPreview: summarizeDiagnosticInput(message.payload.text)
      };
    case 'host/executionPasteCancelled':
      return {
        requestId: message.payload.requestId,
        nodeId: message.payload.nodeId,
        kind: message.payload.kind
      };
    case 'host/requestCreateNode':
      return {
        kind: message.payload.kind,
        cwd: message.payload.cwd,
        targetGroupId: message.payload.targetGroupId,
        agentProvider: message.payload.agentProvider
      };
    case 'host/requestCreateGroupFromSelection':
      return undefined;
    case 'host/testProbeRequest':
      return {
        requestId: message.payload.requestId,
        delayMs: message.payload.delayMs ?? 0
      };
    case 'host/testDomAction':
      return {
        requestId: message.payload.requestId,
        action: cloneJsonValue(message.payload.action)
      };
    case 'host/themeChanged':
      return undefined;
    case 'host/visibilityRestored':
      return message.payload?.restoreFocus === false
        ? {
            restoreFocus: false
          }
        : undefined;
  }
}

function hasInvalidWebviewLifecycle(
  message: unknown,
  lifecycle: WebviewLifecycleIdentity | undefined
): boolean {
  return isRecord(message) && message.lifecycle !== undefined && lifecycle === undefined;
}

function summarizeUnknownWebviewLifecycle(message: unknown): Record<string, unknown> | null {
  if (!isRecord(message) || !isRecord(message.lifecycle)) {
    return null;
  }

  return {
    surface: message.lifecycle.surface,
    mode: message.lifecycle.mode,
    generation: message.lifecycle.generation,
    frameId: message.lifecycle.frameId
  };
}

function summarizeWebviewLifecycleIdentity(
  lifecycle: WebviewLifecycleIdentity | undefined
): Record<string, unknown> | undefined {
  if (!lifecycle) {
    return undefined;
  }

  return {
    surface: lifecycle.surface,
    mode: lifecycle.mode,
    generation: lifecycle.generation,
    frameId: lifecycle.frameId
  };
}

function areSurfaceLifecycleFrameIdsCompatible(left: string | undefined, right: string | undefined): boolean {
  return left === undefined || right === undefined || left === right;
}

function areWebviewLifecycleIdentitiesEqual(
  left: WebviewLifecycleIdentity | undefined,
  right: WebviewLifecycleIdentity | undefined
): boolean {
  if (!left || !right) {
    return left === right;
  }

  return (
    left.surface === right.surface &&
    left.mode === right.mode &&
    left.generation === right.generation &&
    left.frameId === right.frameId
  );
}

function isBootstrapAckGatedHostMessage(type: HostToWebviewMessage['type']): boolean {
  return type !== 'host/bootstrap' && type !== 'host/error' && type !== 'host/executionInputAck';
}

function formatSurfaceForDiagnostics(surface: CanvasSurfaceLocation): string {
  return surface === 'panel' ? '面板' : '编辑区';
}

function summarizeDiagnosticHostMessages(
  messages: readonly CanvasHostMessageDiagnosticRecord[]
): Record<string, unknown> {
  const byType: Record<string, number> = {};
  const bySurface: Record<string, number> = {};
  const executionByNode: Record<string, { snapshot: number; output: number; exit: number }> = {};

  for (const message of messages) {
    byType[message.type] = (byType[message.type] ?? 0) + 1;
    bySurface[message.surface] = (bySurface[message.surface] ?? 0) + 1;

    const nodeId =
      typeof message.detail?.nodeId === 'string' ? message.detail.nodeId : undefined;
    if (!nodeId) {
      continue;
    }

    const currentEntry = executionByNode[nodeId] ?? {
      snapshot: 0,
      output: 0,
      exit: 0
    };
    if (message.type === 'host/executionSnapshot') {
      currentEntry.snapshot += 1;
    } else if (message.type === 'host/executionOutput') {
      currentEntry.output += 1;
    } else if (message.type === 'host/executionExit') {
      currentEntry.exit += 1;
    }
    executionByNode[nodeId] = currentEntry;
  }

  return {
    byType,
    bySurface,
    executionByNode
  };
}

function summarizeExecutionClipboardDiagnostics(
  events: readonly CanvasTestDiagnosticEvent[]
): Record<string, unknown> {
  const bySource: Record<string, number> = {};
  const byNode: Record<string, Record<string, number>> = {};
  const latestByNode: Record<string, Record<string, unknown>> = {};

  for (const event of events) {
    if (event.kind !== 'webview/executionClipboardDiagnostic') {
      continue;
    }

    const source = typeof event.detail?.source === 'string' ? event.detail.source : 'unknown';
    const nodeId = typeof event.detail?.nodeId === 'string' ? event.detail.nodeId : 'unknown';
    bySource[source] = (bySource[source] ?? 0) + 1;

    const currentNode = byNode[nodeId] ?? {};
    currentNode[source] = (currentNode[source] ?? 0) + 1;
    byNode[nodeId] = currentNode;

    latestByNode[nodeId] = {
      timestamp: event.timestamp,
      source,
      detail: event.detail?.detail
    };
  }

  return {
    bySource,
    byNode,
    latestByNode
  };
}

function readDiagnosticEventSurface(event: CanvasTestDiagnosticEvent): CanvasSurfaceLocation | undefined {
  const surface = event.detail?.surface;
  return surface === 'editor' || surface === 'panel' ? surface : undefined;
}

function summarizeWebviewLifecycleSurfaceEventCounts(
  events: readonly CanvasTestDiagnosticEvent[]
): CanvasWebviewLifecycleSurfaceEventCounts {
  return {
    attached: countDiagnosticEvents(events, 'surface/attached'),
    rendered: countDiagnosticEvents(events, 'surface/rendered'),
    messageWebviewBound: countDiagnosticEvents(events, 'surface/messageWebviewBound'),
    ready: countDiagnosticEvents(events, 'surface/ready'),
    readyWebviewPromoted: countDiagnosticEvents(events, 'surface/readyWebviewPromoted'),
    bootstrapAck: countDiagnosticEvents(events, 'surface/bootstrapAck'),
    hostMessageQueuedUntilBootstrapAck: countDiagnosticEvents(events, 'surface/hostMessageQueuedUntilBootstrapAck'),
    staleMessageIgnored: countDiagnosticEvents(events, 'webview/staleMessageIgnored'),
    staleProbeResultIgnored: countDiagnosticEvents(events, 'webview/staleProbeResultIgnored'),
    staleDomActionResultIgnored: countDiagnosticEvents(events, 'webview/staleDomActionResultIgnored'),
    invalidLifecycleIgnored: countDiagnosticEvents(events, 'webview/invalidLifecycleIgnored'),
    runtimeDiagnostic: countDiagnosticEvents(events, 'webview/runtimeDiagnostic'),
    executionPerformanceDiagnostic: countDiagnosticEvents(events, 'webview/executionPerformanceDiagnostic')
  };
}

function countDiagnosticEvents(events: readonly CanvasTestDiagnosticEvent[], kind: string): number {
  return events.filter((event) => event.kind === kind).length;
}

function summarizeWebviewLifecycleAttachRenderBurst(
  events: readonly CanvasTestDiagnosticEvent[]
): CanvasWebviewLifecycleAttachRenderBurstSummary {
  const attachRenderTimes = events
    .filter((event) => event.kind === 'surface/attached' || event.kind === 'surface/rendered')
    .map((event) => ({
      timestamp: event.timestamp,
      timeMs: Date.parse(event.timestamp)
    }))
    .filter((event) => Number.isFinite(event.timeMs))
    .sort((left, right) => left.timeMs - right.timeMs);

  let bestEventCount = 0;
  let bestWindowMs: number | undefined;
  let latestTimestamp: string | undefined;
  for (let startIndex = 0; startIndex < attachRenderTimes.length; startIndex += 1) {
    for (let endIndex = startIndex; endIndex < attachRenderTimes.length; endIndex += 1) {
      const windowMs = attachRenderTimes[endIndex].timeMs - attachRenderTimes[startIndex].timeMs;
      if (windowMs > 250) {
        break;
      }
      const eventCount = endIndex - startIndex + 1;
      if (eventCount > bestEventCount) {
        bestEventCount = eventCount;
        bestWindowMs = windowMs;
        latestTimestamp = attachRenderTimes[endIndex].timestamp;
      }
    }
  }

  return {
    detected: bestEventCount >= 4,
    eventCount: bestEventCount,
    windowMs: bestWindowMs,
    latestTimestamp
  };
}

function summarizeWebviewLifecycleHostMessages(
  surface: CanvasSurfaceLocation,
  messages: readonly CanvasHostMessageDiagnosticRecord[]
): CanvasWebviewLifecycleSurfaceSummary['hostMessages'] {
  const surfaceMessages = messages.filter((message) => message.surface === surface);
  return {
    bootstrapCount: surfaceMessages.filter((message) => message.type === 'host/bootstrap').length,
    stateUpdatedCount: surfaceMessages.filter((message) => message.type === 'host/stateUpdated').length,
    visibilityRestoredCount: surfaceMessages.filter((message) => message.type === 'host/visibilityRestored').length,
    deliveredCount: surfaceMessages.filter((message) => message.delivered).length,
    undeliveredCount: surfaceMessages.filter((message) => !message.delivered).length
  };
}

function classifyWebviewLifecycleSurfaceStatus(args: {
  active: boolean;
  attached: boolean;
  visibility: CanvasSidebarState['canvasSurface'];
  interactive: boolean;
  ready: boolean;
  bootstrapAck: boolean;
  probeError?: string;
  events: CanvasWebviewLifecycleSurfaceEventCounts;
  attachRenderBurst: CanvasWebviewLifecycleAttachRenderBurstSummary;
}): CanvasWebviewLifecycleHealthStatus {
  if (!args.attached || args.visibility === 'closed') {
    return 'not-attached';
  }

  if (!args.active || !args.interactive) {
    return 'standby';
  }

  if (!args.ready) {
    return args.attachRenderBurst.detected || args.events.staleMessageIgnored > 0 ? 'blocked' : 'initializing';
  }

  if (!args.bootstrapAck || args.probeError) {
    return 'blocked';
  }

  if (
    args.attachRenderBurst.detected ||
    args.events.readyWebviewPromoted > 0 ||
    args.events.staleMessageIgnored > 0 ||
    args.events.staleProbeResultIgnored > 0 ||
    args.events.staleDomActionResultIgnored > 0 ||
    args.events.invalidLifecycleIgnored > 0
  ) {
    return 'attention';
  }

  return 'healthy';
}

function summarizeWebviewLifecycleOverallStatus(
  surfaces: readonly CanvasWebviewLifecycleSurfaceSummary[]
): CanvasWebviewLifecycleHealthStatus {
  const activeSurface = surfaces.find((surface) => surface.active);
  if (activeSurface) {
    return activeSurface.status;
  }

  if (surfaces.some((surface) => surface.status === 'blocked')) {
    return 'blocked';
  }

  if (surfaces.some((surface) => surface.status === 'initializing')) {
    return 'initializing';
  }

  if (surfaces.some((surface) => surface.status === 'attention')) {
    return 'attention';
  }

  if (surfaces.some((surface) => surface.status === 'healthy')) {
    return 'healthy';
  }

  if (surfaces.some((surface) => surface.status === 'standby')) {
    return 'standby';
  }

  return 'not-attached';
}

function buildWebviewLifecycleSurfaceIssues(args: {
  surface: CanvasSurfaceLocation;
  active: boolean;
  attached: boolean;
  interactive: boolean;
  ready: boolean;
  bootstrapAck: boolean;
  probeError?: string;
  events: CanvasWebviewLifecycleSurfaceEventCounts;
  attachRenderBurst: CanvasWebviewLifecycleAttachRenderBurstSummary;
  pendingBootstrapHostMessageCount: number;
  hostMessages: CanvasWebviewLifecycleSurfaceSummary['hostMessages'];
}): string[] {
  const issues: string[] = [];
  const surfaceLabel = formatSurfaceForDiagnostics(args.surface);

  if (!args.attached) {
    issues.push(`${surfaceLabel} Webview 当前未 attached。`);
    return issues;
  }

  if (args.active && !args.interactive) {
    issues.push(`${surfaceLabel} 是 active surface，但当前 mode 不是 active。`);
  }
  if (args.interactive && !args.ready && args.events.rendered > 0) {
    issues.push(`${surfaceLabel} active Webview 已渲染但尚未 ready。`);
  }
  if (args.ready && !args.bootstrapAck) {
    issues.push(`${surfaceLabel} ready 后尚未收到 bootstrapAck。`);
  }
  if (args.ready && !args.bootstrapAck && args.hostMessages.bootstrapCount === 0) {
    issues.push(`${surfaceLabel} ready 后未记录 host/bootstrap 投递。`);
  }
  if (args.probeError) {
    issues.push(`${surfaceLabel} probe 失败：${args.probeError}`);
  }
  if (args.pendingBootstrapHostMessageCount > 0) {
    issues.push(`${surfaceLabel} 仍有 ${args.pendingBootstrapHostMessageCount} 条消息等待 bootstrapAck flush。`);
  }
  if (args.attachRenderBurst.detected) {
    issues.push(
      `${surfaceLabel} 近期 ${args.attachRenderBurst.windowMs ?? '未知'}ms 内出现 ${args.attachRenderBurst.eventCount} 次 attach/render。`
    );
  }
  if (args.events.readyWebviewPromoted > 0) {
    issues.push(`${surfaceLabel} 已触发 ready Webview promotion。`);
  }
  if (args.events.staleMessageIgnored > 0) {
    issues.push(`${surfaceLabel} 已忽略 ${args.events.staleMessageIgnored} 条 stale Webview 消息。`);
  }
  if (args.events.staleProbeResultIgnored > 0 || args.events.staleDomActionResultIgnored > 0) {
    issues.push(
      `${surfaceLabel} 已忽略 stale probe/DOM action 结果：probe=${args.events.staleProbeResultIgnored}, dom=${args.events.staleDomActionResultIgnored}。`
    );
  }
  if (args.events.invalidLifecycleIgnored > 0) {
    issues.push(`${surfaceLabel} 已忽略 ${args.events.invalidLifecycleIgnored} 条非法 lifecycle 消息。`);
  }

  return issues;
}

function buildWebviewLifecycleRecommendedNextSteps(
  surface: CanvasSurfaceLocation,
  status: CanvasWebviewLifecycleHealthStatus,
  issues: readonly string[],
  capturedAt: string
): string[] {
  const surfaceLabel = formatSurfaceForDiagnostics(surface);
  if (status === 'blocked') {
    return [
      `保持 ${surfaceLabel} 空白现场，不要切换承载面；直接分享本次 ${capturedAt} dump 目录。`,
      '优先查看 webview-lifecycle-summary.json、diagnostic-events.json、host-messages.json 和 panel-probe.json。',
      '若 ready=false 或 bootstrapAck=false，继续按 Panel restore 路径复验 attach/render/ready 顺序。'
    ];
  }

  if (status === 'initializing') {
    return [
      `${surfaceLabel} 仍在初始化；等待 2-3 秒后再次执行“落盘当前宿主诊断”。`,
      '如果下一份诊断仍停在 initializing，把两份 dump 目录一起对比。'
    ];
  }

  if (status === 'attention') {
    return [
      `${surfaceLabel} 当前生命周期已可用，但近期出现过 ${issues.length} 条 lifecycle 线索。`,
      '如果画布仍空白，下一步应从 Webview runtimeDiagnostic 或前端渲染状态继续排查。'
    ];
  }

  if (status === 'healthy') {
    return [
      `${surfaceLabel} lifecycle 当前健康；如果用户仍看到空白，优先排查前端渲染或节点过滤。`
    ];
  }

  if (status === 'standby') {
    return [
      `${surfaceLabel} 当前不是可交互主 surface；如需验证它，请先显式切到该承载面。`
    ];
  }

  return [
    `${surfaceLabel} Webview 当前未 attached；如需验证它，请先打开对应画布承载面。`
  ];
}

function summarizeDiagnosticText(value: string): string {
  const normalized = stripTerminalControlSequences(value).replace(/\s+/g, ' ').trim();
  return normalized.length > 240 ? `${normalized.slice(0, 240)}...` : normalized;
}

function describeExtensionMode(mode: vscode.ExtensionMode): 'production' | 'development' | 'test' {
  switch (mode) {
    case vscode.ExtensionMode.Development:
      return 'development';
    case vscode.ExtensionMode.Test:
      return 'test';
    default:
      return 'production';
  }
}

function createFileSystemSafeTimestamp(value: string): string {
  return value.replace(/[:.]/g, '-');
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await fs.promises.mkdir(path.dirname(filePath), {
    recursive: true
  });
  await fs.promises.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isCanvasEdgeAnchor(value: unknown): value is CanvasEdgeAnchor {
  return value === 'top' || value === 'right' || value === 'bottom' || value === 'left';
}

function normalizeCanvasEdgeArrowMode(value: unknown): CanvasEdgeArrowMode {
  return value === 'both' || value === 'forward' ? value : 'none';
}

function isCanvasFileActivityAccessMode(value: unknown): value is CanvasFileActivityAccessMode {
  return value === 'read' || value === 'write' || value === 'read-write';
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function readNextNodeSequence(nodes: CanvasNodeSummary[]): number {
  const maxSequence = nodes.reduce((currentMax, node) => {
    const parsedValue = readCanvasNodeDisplaySequence(node);
    if (parsedValue === undefined) {
      return currentMax;
    }

    return Number.isFinite(parsedValue) ? Math.max(currentMax, parsedValue) : currentMax;
  }, 0);

  return maxSequence + 1;
}

function readCanvasNodeDisplaySequence(node: Pick<CanvasNodeSummary, 'id' | 'kind'>): number | undefined {
  if (node.kind !== 'agent' && node.kind !== 'terminal' && node.kind !== 'note') {
    return undefined;
  }

  const matchedPrefix = node.id.match(/^(agent|terminal|note)-([1-9]\d*)(?:-.+)?$/u);
  if (!matchedPrefix || matchedPrefix[1] !== node.kind) {
    return undefined;
  }

  const parsedValue = Number.parseInt(matchedPrefix[2], 10);
  return Number.isFinite(parsedValue) ? parsedValue : undefined;
}

function createNodeMetadata(
  kind: CanvasNodeKind,
  nodeId: string,
  agentProvider: AgentProviderKind = 'codex',
  agentLaunchPreset: AgentLaunchPresetKind = 'default',
  agentCustomLaunchCommand?: string
): CanvasNodeMetadata | undefined {
  if (kind === 'agent') {
    return {
      agent: createAgentMetadata(agentProvider, agentLaunchPreset, agentCustomLaunchCommand)
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

  if (kind === 'file' || kind === 'file-list') {
    return undefined;
  }

  return undefined;
}

function createAgentMetadata(
  provider: AgentProviderKind = 'codex',
  launchPreset: AgentLaunchPresetKind = 'default',
  customLaunchCommand?: string
): AgentNodeMetadata {
  return {
    backend: 'node-pty',
    lifecycle: 'idle',
    provider,
    launchPreset,
    customLaunchCommand: launchPreset === 'custom' ? customLaunchCommand?.trim() || undefined : undefined,
    lastLaunchCommandLine: undefined,
    runtimeKind: 'pty-cli',
    resumeSupported: false,
    resumeStrategy: 'none',
    shellPath: defaultAgentCommand(provider),
    cwd: defaultExecutionWorkingDirectory(),
    persistenceMode: 'snapshot-only',
    attachmentState: 'history-restored',
    runtimeBackend: undefined,
    runtimeGuarantee: undefined,
    runtimeStoragePath: undefined,
    liveSession: false,
    pendingLaunch: undefined,
    lastCols: DEFAULT_TERMINAL_COLS,
    lastRows: DEFAULT_TERMINAL_ROWS,
    attentionPending: false,
    lastBackendLabel: agentProviderDisplayLabel(provider)
  };
}

function createTerminalMetadata(nodeId: string): TerminalNodeMetadata {
  return {
    backend: 'node-pty',
    lifecycle: 'idle',
    shellPath: resolveDefaultExecutionTerminalShellPath(),
    cwd: defaultExecutionWorkingDirectory(),
    persistenceMode: 'snapshot-only',
    attachmentState: 'history-restored',
    runtimeBackend: undefined,
    runtimeGuarantee: undefined,
    runtimeStoragePath: undefined,
    liveSession: false,
    pendingLaunch: undefined,
    lastCols: DEFAULT_TERMINAL_COLS,
    lastRows: DEFAULT_TERMINAL_ROWS,
    attentionPending: false
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

function normalizeExecutionOutputSequence(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function maxExecutionOutputSequence(...values: unknown[]): number | undefined {
  return values.reduce<number | undefined>((currentMax, value) => {
    const normalized = normalizeExecutionOutputSequence(value);
    if (normalized === undefined) {
      return currentMax;
    }
    return currentMax === undefined ? normalized : Math.max(currentMax, normalized);
  }, undefined);
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
    value === 'suspended' ||
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

  if (nodeStatus === 'suspended') {
    return 'suspended';
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
    const launchPreset =
      agent.launchPreset === 'resume' ||
      agent.launchPreset === 'yolo' ||
      agent.launchPreset === 'sandbox' ||
      agent.launchPreset === 'custom' ||
      agent.launchPreset === 'default'
        ? agent.launchPreset
        : fallback.launchPreset;
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
    const preSuspendLifecycle = normalizeOptionalAgentLifecycle(agent.preSuspendLifecycle);

    return {
      agent: {
        backend: 'node-pty',
        lifecycle: normalizeAgentLifecycle(
          nodeStatus,
          liveSession,
          agent.lifecycle
        ),
        provider,
        launchPreset,
        customLaunchCommand:
          launchPreset === 'custom' && typeof agent.customLaunchCommand === 'string'
            ? agent.customLaunchCommand.trim() || undefined
            : undefined,
        templateArgv: Array.isArray(agent.templateArgv)
          ? normalizeStoredAgentTemplateArgv(agent.templateArgv)
          : undefined,
        lastLaunchCommandLine:
          typeof agent.lastLaunchCommandLine === 'string'
            ? trimStoredTerminalText(agent.lastLaunchCommandLine)
            : typeof agent.launchCommandLine === 'string'
              ? trimStoredTerminalText(agent.launchCommandLine)
              : fallback.lastLaunchCommandLine,
        runtimeKind: 'pty-cli',
        resumeSupported,
        resumeStrategy,
        shellPath:
          typeof agent.shellPath === 'string'
            ? agent.shellPath
            : fallback.shellPath,
        cwd: normalizeDefaultExecutionMetadataCwd(
          typeof agent.cwd === 'string'
            ? agent.cwd
            : fallback.cwd
        ),
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
        outputSequence: normalizeExecutionOutputSequence(agent.outputSequence),
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
        preSuspendLifecycle,
        lastSuspendReason: agent.lastSuspendReason === 'claude-ctrl-z' ? 'claude-ctrl-z' : undefined,
        lastSuspendMessage:
          typeof agent.lastSuspendMessage === 'string'
            ? trimStoredTerminalText(agent.lastSuspendMessage)
            : undefined,
        lastReactivateError:
          typeof agent.lastReactivateError === 'string'
            ? trimStoredTerminalText(agent.lastReactivateError)
            : undefined,
        lastCols:
          typeof agent.lastCols === 'number'
            ? normalizeTerminalCols(agent.lastCols)
            : fallback.lastCols,
        lastRows:
          typeof agent.lastRows === 'number'
            ? normalizeTerminalRows(agent.lastRows)
            : fallback.lastRows,
        attentionPending: agent.attentionPending === true,
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
        cwd: normalizeDefaultExecutionMetadataCwd(
          typeof terminal.cwd === 'string'
            ? terminal.cwd
            : fallback.cwd
        ),
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
        outputSequence: normalizeExecutionOutputSequence(terminal.outputSequence),
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
        attentionPending: terminal.attentionPending === true,
        serializedTerminalState: normalizeSerializedTerminalState(terminal.serializedTerminalState)
      }
    };
  }

  if (kind === 'note') {
    const note = isRecord(record.note) ? record.note : {};
    const fallback = createNoteMetadata();
    const content = typeof note.content === 'string' ? note.content : fallback.content;
    const contentSource = normalizeStoredNoteContentSource(note.contentSource);

    return {
      note: {
        content: contentSource?.kind === 'markdown-file' ? content : trimStoredNodeText(content),
        contentSource
      }
    };
  }

  if (kind === 'file') {
    const file = isRecord(record.file) ? record.file : {};
    const filePath = typeof file.filePath === 'string' ? normalizeTrackedFilePath(file.filePath) : undefined;
    const fileId =
      typeof file.fileId === 'string' && file.fileId.trim().length > 0
        ? file.fileId
        : filePath
          ? buildFileReferenceId(filePath)
          : nodeId;

    if (!filePath) {
      return undefined;
    }

    return {
      file: {
        fileId,
        filePath,
        relativePath:
          typeof file.relativePath === 'string' && file.relativePath.trim().length > 0
            ? file.relativePath
            : undefined,
        ownerNodeIds: Array.isArray(file.ownerNodeIds)
          ? file.ownerNodeIds.filter((ownerNodeId): ownerNodeId is string => typeof ownerNodeId === 'string')
          : [],
        icon: normalizeCanvasFileIconDescriptor(file.icon)
      }
    };
  }

  if (kind === 'file-list') {
    const fileList = isRecord(record.fileList) ? record.fileList : {};
    const entries = Array.isArray(fileList.entries)
      ? fileList.entries
          .map((entry) => normalizeFileListEntry(entry))
          .filter((entry): entry is FileListNodeEntrySummary => entry !== null)
      : [];

    return {
      fileList: {
        scope: fileList.scope === 'shared' ? 'shared' : 'agent',
        ownerNodeId: typeof fileList.ownerNodeId === 'string' ? fileList.ownerNodeId : undefined,
        entries
      }
    };
  }

  return undefined;
}

function normalizeFileListEntry(value: unknown): FileListNodeEntrySummary | null {
  if (!isRecord(value)) {
    return null;
  }

  const filePath = typeof value.filePath === 'string' ? normalizeTrackedFilePath(value.filePath) : undefined;
  if (!filePath) {
    return null;
  }

  return {
    fileId:
      typeof value.fileId === 'string' && value.fileId.trim().length > 0
        ? value.fileId
        : buildFileReferenceId(filePath),
    filePath,
    relativePath:
      typeof value.relativePath === 'string' && value.relativePath.trim().length > 0
        ? value.relativePath
        : undefined,
    accessMode:
      value.accessMode === 'read' || value.accessMode === 'write' || value.accessMode === 'read-write'
        ? value.accessMode
        : 'read',
    ownerNodeIds: Array.isArray(value.ownerNodeIds)
      ? value.ownerNodeIds.filter((ownerNodeId): ownerNodeId is string => typeof ownerNodeId === 'string')
      : [],
    icon: normalizeCanvasFileIconDescriptor(value.icon)
  };
}

function normalizeCanvasFileIconDescriptor(value: unknown): CanvasFileIconDescriptor | undefined {
  if (!isRecord(value) || typeof value.kind !== 'string') {
    return undefined;
  }

  switch (value.kind) {
    case 'codicon':
      return typeof value.id === 'string'
        ? {
            kind: 'codicon',
            id: value.id
          }
        : undefined;
    case 'image':
      return typeof value.src === 'string'
        ? {
            kind: 'image',
            src: value.src
          }
        : undefined;
    case 'font':
      return typeof value.fontFamily === 'string' && typeof value.character === 'string'
        ? {
            kind: 'font',
            fontFamily: value.fontFamily,
            character: value.character,
            color: typeof value.color === 'string' ? value.color : undefined
          }
        : undefined;
    default:
      return undefined;
  }
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
            outputSequence: liveSession.outputSequence,
            lastCols: liveSession.cols,
            lastRows: liveSession.rows,
            serializedTerminalState: liveSession.terminalStateTracker.getSerializedState(),
            preSuspendLifecycle: liveSession.preSuspendLifecycleStatus,
            lastSuspendReason: liveSession.lastSuspendReason,
            lastSuspendMessage: liveSession.lastSuspendMessage,
            lastReactivateError: liveSession.lastReactivateError,
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
            outputSequence: liveSession.outputSequence,
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

function normalizeStoredAgentTemplateArgv(value: readonly string[] | undefined): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    .map((entry) => entry.trim());
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

function normalizeStoredNoteContentSource(value: unknown): NoteContentSource | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  if (value.kind === 'embedded') {
    return { kind: 'embedded' };
  }

  if (
    value.kind !== 'markdown-file' ||
    typeof value.resourceUri !== 'string' ||
    typeof value.displayPath !== 'string'
  ) {
    return undefined;
  }

  return {
    kind: 'markdown-file',
    resourceUri: value.resourceUri,
    displayPath: value.displayPath,
    fullDisplayPath:
      typeof value.fullDisplayPath === 'string' ? trimStoredNodeText(value.fullDisplayPath) : undefined,
    contentRevision:
      typeof value.contentRevision === 'string' ? trimStoredNodeText(value.contentRevision) : undefined,
    status: normalizeNoteMarkdownFileStatus(value.status),
    lastError: typeof value.lastError === 'string' ? trimStoredNodeText(value.lastError) : undefined,
    recoverableDraft: normalizeStoredNoteMarkdownRecoverableDraft(
      value.recoverableDraft ?? readLegacyNoteMarkdownConflictDraft(value)
    )
  };
}

function readLegacyNoteMarkdownConflictDraft(value: Record<string, unknown>): unknown {
  return value.conflictDraft;
}

function normalizeStoredNoteMarkdownRecoverableDraft(value: unknown): NoteMarkdownRecoverableDraft | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const draftId =
    typeof value.draftId === 'string' && NOTE_MARKDOWN_RECOVERABLE_DRAFT_ID_PATTERN.test(value.draftId)
      ? value.draftId
      : undefined;
  const content = typeof value.content === 'string' ? value.content : undefined;
  if (!draftId && content === undefined) {
    return undefined;
  }

  return createNoteMarkdownRecoverableDraft({
    draftId,
    content,
    baseContentRevision:
      typeof value.baseContentRevision === 'string' ? trimStoredNodeText(value.baseContentRevision) : undefined,
    remoteContentRevision:
      typeof value.remoteContentRevision === 'string' ? trimStoredNodeText(value.remoteContentRevision) : undefined,
    updatedAt: typeof value.updatedAt === 'string' ? trimStoredNodeText(value.updatedAt) : undefined
  });
}

function normalizeNoteMarkdownFileStatus(value: unknown): NoteMarkdownFileStatus {
  return value === 'ok' ||
    value === 'missing' ||
    value === 'not-file' ||
    value === 'unsupported-extension' ||
    value === 'unreadable' ||
    value === 'dirty-conflict'
    ? value
    : 'unreadable';
}

function updateAssociatedNoteMarkdownFileStatus(
  state: CanvasPrototypeState,
  nodeId: string,
  source: MarkdownFileNoteContentSource,
  content: string
): CanvasPrototypeState {
  const node = state.nodes.find((candidate) => candidate.id === nodeId && candidate.kind === 'note');
  if (!node) {
    return state;
  }

  const nextContent = content;
  const nextMetadata: CanvasNodeMetadata = {
    ...node.metadata,
    note: {
      ...ensureNoteMetadata(node),
      content: nextContent,
      contentSource: source
    }
  };
  const nextStatus = source.status === 'ok' ? 'ready' : source.status;
  const nextSummary =
    source.status === 'ok'
      ? summarizeNoteNode(nextContent)
      : source.status === 'dirty-conflict'
        ? '关联文件存在编辑冲突。'
      : '关联文件不可用。';

  const nextNodes = state.nodes.map((candidate) =>
    candidate.id === nodeId
      ? {
          ...candidate,
          status: nextStatus,
          summary: nextSummary,
          metadata: nextMetadata
        }
      : candidate
  );

  if (
    node.status === nextStatus &&
    node.summary === nextSummary &&
    ensureNoteMetadata(node).content === nextContent &&
    areNoteContentSourcesEqual(ensureNoteMetadata(node).contentSource, source)
  ) {
    return state;
  }

  return {
    ...state,
    updatedAt: new Date().toISOString(),
    nodes: nextNodes
  };
}

function createNoteMarkdownRecoverableDraft(
  options: {
    draftId?: string;
    content?: string;
    baseContentRevision?: string;
    remoteContentRevision?: string;
    updatedAt?: string;
  }
): NoteMarkdownRecoverableDraft {
  return {
    draftId: options.draftId,
    content: options.content,
    baseContentRevision: options.baseContentRevision,
    remoteContentRevision: options.remoteContentRevision,
    updatedAt: options.updatedAt ?? new Date().toISOString()
  };
}

function areNoteContentSourcesEqual(
  left: NoteContentSource | undefined,
  right: NoteContentSource | undefined
): boolean {
  if (!left || !right || left.kind !== right.kind) {
    return left === right;
  }
  if (left.kind === 'embedded' && right.kind === 'embedded') {
    return true;
  }
  if (left.kind === 'markdown-file' && right.kind === 'markdown-file') {
    return (
      left.resourceUri === right.resourceUri &&
      left.displayPath === right.displayPath &&
      left.fullDisplayPath === right.fullDisplayPath &&
      left.contentRevision === right.contentRevision &&
      left.status === right.status &&
      left.lastError === right.lastError &&
      areNoteMarkdownRecoverableDraftsEqual(left.recoverableDraft, right.recoverableDraft)
    );
  }
  return false;
}

function areNoteMarkdownRecoverableDraftsEqual(
  left: NoteMarkdownRecoverableDraft | undefined,
  right: NoteMarkdownRecoverableDraft | undefined
): boolean {
  if (!left || !right) {
    return left === right;
  }

  return (
    left.draftId === right.draftId &&
    left.content === right.content &&
    left.baseContentRevision === right.baseContentRevision &&
    left.remoteContentRevision === right.remoteContentRevision &&
    left.updatedAt === right.updatedAt
  );
}

function parseStoredNoteMarkdownResourceUri(value: string): vscode.Uri | undefined {
  try {
    return vscode.Uri.parse(value, true);
  } catch {
    return undefined;
  }
}

function dirnameUri(uri: vscode.Uri): vscode.Uri {
  if (uri.scheme === 'file') {
    return vscode.Uri.file(path.dirname(uri.fsPath));
  }

  const nextPath = path.posix.dirname(uri.path || '/');
  return uri.with({
    path: nextPath === '.' ? '/' : nextPath,
    query: '',
    fragment: ''
  });
}

function resolveDroppedNoteMarkdownResourceUri(
  resource: ExecutionTerminalDroppedResource
): vscode.Uri | undefined {
  const rawValue = resource.value.trim();
  if (!rawValue) {
    return undefined;
  }

  if (resource.valueKind === 'uri') {
    return parseNoteMarkdownUriOrPath(rawValue);
  }

  return parseNoteMarkdownUriOrPath(rawValue);
}

function parseNoteMarkdownUriOrPath(value: string): vscode.Uri | undefined {
  if (/^[A-Za-z]:[\\/]/u.test(value) || value.startsWith('/') || value.startsWith('\\\\')) {
    return vscode.Uri.file(value);
  }

  const schemeMatch = /^([A-Za-z][A-Za-z0-9+.-]*):/u.exec(value);
  if (schemeMatch) {
    try {
      return vscode.Uri.parse(value, true);
    } catch {
      return undefined;
    }
  }

  return vscode.Uri.file(value);
}

function canonicalizeNoteMarkdownUriForCurrentHost(
  uri: vscode.Uri,
  currentRemoteAuthority?: string
): vscode.Uri {
  if (uri.scheme !== 'vscode-remote') {
    return uri;
  }

  const normalizedUriAuthority = normalizeNoteMarkdownAuthority(uri.authority);
  const normalizedCurrentRemoteAuthority = normalizeNoteMarkdownAuthority(currentRemoteAuthority);
  if (!normalizedCurrentRemoteAuthority) {
    return uri;
  }

  return normalizedUriAuthority === normalizedCurrentRemoteAuthority
    ? createCurrentHostFileUriFromVscodeRemoteUri(uri)
    : uri;
}

type NoteMarkdownDropAdmissionKind =
  | 'same-workspace'
  | 'same-host-outside-workspace'
  | 'foreign-host'
  | 'unknown-current-host'
  | 'unsupported-scheme';

interface NoteMarkdownDropAdmission {
  kind: NoteMarkdownDropAdmissionKind;
  uri?: vscode.Uri;
  workspaceFolder?: vscode.WorkspaceFolder;
  rejectionReason?: string;
}

function resolveDroppedNoteMarkdownAdmission(
  uri: vscode.Uri,
  workspaceFolders: readonly vscode.WorkspaceFolder[],
  currentRemoteAuthority?: string
): NoteMarkdownDropAdmission {
  const currentHostUri = resolveDroppedNoteMarkdownCurrentHostUri(uri, currentRemoteAuthority);
  if (!currentHostUri.uri) {
    return currentHostUri;
  }

  const workspaceFolder = findContainingNoteMarkdownWorkspaceFolder(currentHostUri.uri, workspaceFolders);
  return workspaceFolder
    ? {
        kind: 'same-workspace',
        uri: currentHostUri.uri,
        workspaceFolder
      }
    : {
        kind: 'same-host-outside-workspace',
        uri: currentHostUri.uri
      };
}

function resolveExplorerNoteMarkdownAdmission(
  uri: vscode.Uri,
  workspaceFolders: readonly vscode.WorkspaceFolder[]
): NoteMarkdownDropAdmission {
  if (uri.scheme !== 'file') {
    return {
      kind: 'unsupported-scheme',
      rejectionReason: `不支持关联 ${uri.scheme}: Markdown 资源。`
    };
  }

  const workspaceFolder = findContainingNoteMarkdownWorkspaceFolder(uri, workspaceFolders);
  return workspaceFolder
    ? {
        kind: 'same-workspace',
        uri,
        workspaceFolder
      }
    : {
        kind: 'same-host-outside-workspace',
        uri
      };
}

function resolveDroppedNoteMarkdownCurrentHostUri(
  uri: vscode.Uri,
  currentRemoteAuthority?: string
): NoteMarkdownDropAdmission {
  if (uri.scheme === 'file') {
    return {
      kind: 'same-host-outside-workspace',
      uri
    };
  }

  if (uri.scheme !== 'vscode-remote') {
    return {
      kind: 'unsupported-scheme',
      rejectionReason: `不支持关联 ${uri.scheme}: Markdown 资源。`
    };
  }

  const normalizedCurrentRemoteAuthority = normalizeNoteMarkdownAuthority(currentRemoteAuthority);
  if (!normalizedCurrentRemoteAuthority) {
    return {
      kind: 'unknown-current-host',
      rejectionReason: '无法确认拖拽的 Remote Markdown 文件是否属于当前设备，请等待画板就绪后重试。'
    };
  }

  if (normalizeNoteMarkdownAuthority(uri.authority) !== normalizedCurrentRemoteAuthority) {
    return {
      kind: 'foreign-host',
      rejectionReason: '拖拽的 Markdown 文件来自其他 Remote 设备，未创建关联 Note。'
    };
  }

  return {
    kind: 'same-host-outside-workspace',
    uri: createCurrentHostFileUriFromVscodeRemoteUri(uri)
  };
}

function findContainingNoteMarkdownWorkspaceFolder(
  uri: vscode.Uri,
  workspaceFolders: readonly vscode.WorkspaceFolder[]
): vscode.WorkspaceFolder | undefined {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
  if (workspaceFolder) {
    return workspaceFolder;
  }

  return workspaceFolders.find((workspaceFolder) =>
    Boolean(resolveWorkspaceRelativeDisplayPathForNoteMarkdownUri(
      uri,
      workspaceFolder,
      false
    ))
  );
}

function createCurrentHostFileUriFromVscodeRemoteUri(uri: vscode.Uri): vscode.Uri {
  const filePath =
    process.platform === 'win32' && /^\/[A-Za-z]:\//u.test(uri.path) ? uri.path.slice(1) : uri.path;
  return vscode.Uri.file(filePath).with({
    query: uri.query,
    fragment: uri.fragment
  });
}

function describeNoteMarkdownUriForDiagnostics(uri: vscode.Uri): Record<string, unknown> {
  return {
    scheme: uri.scheme,
    authority: uri.authority,
    normalizedAuthority: normalizeNoteMarkdownAuthority(uri.authority),
    path: uri.path,
    fsPath: uri.scheme === 'file' ? uri.fsPath : undefined,
    uri: uri.toString()
  };
}

function normalizeNoteMarkdownResourceKey(uri: vscode.Uri): string {
  return uri.scheme === 'file' ? vscode.Uri.file(uri.fsPath).toString() : uri.toString();
}

function resolveWorkspaceRelativeDisplayPathForNoteMarkdownUri(
  uri: vscode.Uri,
  workspaceFolder: vscode.WorkspaceFolder,
  includeWorkspaceFolderPrefix: boolean,
  currentRemoteAuthority?: string
): string | undefined {
  if (uri.scheme === 'file' && workspaceFolder.uri.scheme === 'file') {
    return resolveContainedWorkspaceRelativePath({
      filePath: uri.fsPath,
      workspaceFolderPath: workspaceFolder.uri.fsPath,
      workspaceFolderName: workspaceFolder.name,
      includeWorkspaceFolderPrefix
    });
  }

  if (!canCompareNoteMarkdownUriWithWorkspaceFolder(uri, workspaceFolder.uri, currentRemoteAuthority)) {
    return undefined;
  }

  const filePath = normalizeNoteMarkdownPosixDisplayPath(noteMarkdownUriPathLike(uri));
  const workspaceFolderPath = normalizeNoteMarkdownPosixDisplayPath(
    workspaceFolder.uri.scheme === 'file' ? workspaceFolder.uri.fsPath : workspaceFolder.uri.path
  );
  const relativePath = path.posix.relative(workspaceFolderPath, filePath);
  if (!relativePath || relativePath.startsWith('..') || path.posix.isAbsolute(relativePath)) {
    return undefined;
  }

  if (!includeWorkspaceFolderPrefix) {
    return relativePath;
  }

  const normalizedWorkspaceFolderName = workspaceFolder.name.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  return normalizedWorkspaceFolderName ? `${normalizedWorkspaceFolderName}/${relativePath}` : relativePath;
}

function canCompareNoteMarkdownUriWithWorkspaceFolder(
  uri: vscode.Uri,
  workspaceFolderUri: vscode.Uri,
  currentRemoteAuthority?: string
): boolean {
  return canCompareNoteMarkdownResourceWithWorkspaceRoot(
    {
      scheme: uri.scheme,
      authority: uri.authority
    },
    {
      scheme: workspaceFolderUri.scheme,
      authority: workspaceFolderUri.authority
    },
    currentRemoteAuthority
  );
}

function resolveNoteMarkdownPathRelativeToHome(
  rawPath: string,
  userHome: string,
  usePlatformPath: boolean
): string | undefined {
  const relativePath = usePlatformPath
    ? path.relative(userHome, rawPath)
    : path.posix.relative(
        normalizeNoteMarkdownPosixDisplayPath(userHome),
        normalizeNoteMarkdownPosixDisplayPath(rawPath)
      );
  const isAbsolutePath = usePlatformPath ? path.isAbsolute(relativePath) : path.posix.isAbsolute(relativePath);
  if (!relativePath || relativePath.startsWith('..') || isAbsolutePath) {
    return undefined;
  }

  return `~/${relativePath.replace(/\\/g, '/')}`;
}

function normalizeNoteMarkdownPosixDisplayPath(value: string): string {
  const normalized = value.replace(/\\/g, '/');
  return normalized.length > 1 ? normalized.replace(/\/+$/u, '') : normalized;
}

function noteMarkdownUriPathLike(uri: vscode.Uri): string {
  return uri.scheme === 'file' ? uri.fsPath : uri.path || uri.toString(true);
}

function formatNoteMarkdownRevisionNumber(value: number): string {
  return Number.isFinite(value) ? String(Math.trunc(value)) : '0';
}

function formatNoteMarkdownRevisionTime(value: number): string {
  return Number.isFinite(value) ? String(Math.round(value * 1000)) : '0';
}

function noteMarkdownTitleFromUri(
  uri: vscode.Uri,
  options: { stripExtension?: boolean } = {}
): string {
  return createDroppedNoteMarkdownTitle(noteMarkdownUriPathLike(uri), options);
}

function resolveExistingDirectoryForNoteMarkdownInput(inputPath: string): string | undefined {
  const candidate = inputPath.endsWith(path.sep) ? inputPath : path.dirname(inputPath);
  if (!candidate) {
    return undefined;
  }

  try {
    const stat = fs.statSync(candidate);
    return stat.isDirectory() ? candidate : undefined;
  } catch {
    const parent = path.dirname(candidate);
    if (!parent || parent === candidate) {
      return undefined;
    }
    try {
      const parentStat = fs.statSync(parent);
      return parentStat.isDirectory() ? parent : undefined;
    } catch {
      return undefined;
    }
  }
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

function stripNoteMarkdownRecoverableDraftContentFromCanvasState<T>(state: T): T {
  if (!isRecord(state) || !Array.isArray(state.nodes)) {
    return state;
  }

  let didChange = false;
  const nodes = state.nodes.map((node) => {
    if (!isRecord(node) || !isRecord(node.metadata) || !isRecord(node.metadata.note)) {
      return node;
    }

    const note = node.metadata.note;
    if (!isRecord(note.contentSource) || note.contentSource.kind !== 'markdown-file') {
      return node;
    }

    const contentSource = note.contentSource;
    const recoverableDraft = contentSource.recoverableDraft;
    const legacyConflictDraft = contentSource.conflictDraft;
    const shouldStripRecoverableDraftContent = isRecord(recoverableDraft) && 'content' in recoverableDraft;
    const shouldStripLegacyConflictDraftContent = isRecord(legacyConflictDraft) && 'content' in legacyConflictDraft;
    const shouldMigrateLegacyConflictDraft = 'conflictDraft' in contentSource;
    if (!shouldStripRecoverableDraftContent && !shouldMigrateLegacyConflictDraft) {
      return node;
    }

    // Legacy conflictDraft is migrated here so runtime snapshots no longer re-emit the old field.
    const { conflictDraft: _legacyConflictDraft, ...contentSourceWithoutLegacy } = contentSource;
    const nextContentSource = {
      ...contentSourceWithoutLegacy
    };
    if (shouldStripRecoverableDraftContent) {
      const { content: _content, ...draftWithoutContent } = recoverableDraft;
      nextContentSource.recoverableDraft = draftWithoutContent;
    } else if (!isRecord(recoverableDraft) && isRecord(legacyConflictDraft)) {
      const legacyDraftWithoutContent = shouldStripLegacyConflictDraftContent
        ? stripNoteMarkdownRuntimeDraftContent(legacyConflictDraft)
        : legacyConflictDraft;
      nextContentSource.recoverableDraft = legacyDraftWithoutContent;
    }
    didChange = true;
    return {
      ...node,
      metadata: {
        ...node.metadata,
        note: {
          ...note,
          contentSource: nextContentSource
        }
      }
    };
  });

  return didChange
    ? ({
        ...state,
        nodes
      } as T)
    : state;
}

function stripNoteMarkdownRuntimeDraftContent(draft: Record<string, unknown>): Record<string, unknown> {
  const { content: _content, ...draftWithoutContent } = draft;
  return draftWithoutContent;
}

function shouldPreserveStoredExecutionViewportDuringReattach(
  metadata: Pick<
    ExecutionSessionMetadata,
    'persistenceMode' | 'attachmentState' | 'runtimeSessionId' | 'serializedTerminalState'
  >
): boolean {
  return (
    metadata.persistenceMode === 'live-runtime' &&
    metadata.attachmentState === 'reattaching' &&
    Boolean(metadata.runtimeSessionId) &&
    metadata.serializedTerminalState !== undefined
  );
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

function isAgentProviderBranchSupported(provider: AgentProviderKind, resumeStrategy: AgentResumeStrategy): boolean {
  return (
    (provider === 'claude' && resumeStrategy === 'claude-session-id') ||
    (provider === 'codex' && resumeStrategy === 'codex-session-id')
  );
}

function isClaudeForkSessionLaunch(launchArgs: readonly string[]): boolean {
  return launchArgs.some((token) => token === '--fork-session' || token.startsWith('--fork-session='));
}

function normalizeAgentCliCacheWorkspaceCwd(workspaceCwd: string | undefined): string {
  const normalizedWorkspaceCwd = workspaceCwd?.trim();
  if (!normalizedWorkspaceCwd) {
    return '<no-workspace>';
  }

  const resolvedWorkspaceCwd = path.resolve(normalizedWorkspaceCwd);
  return process.platform === 'win32' ? resolvedWorkspaceCwd.toLowerCase() : resolvedWorkspaceCwd;
}

function normalizeAgentCliCacheAuthority(shellAuthority: string | undefined, workspaceCwd?: string): string {
  const normalizedShellAuthority = shellAuthority?.trim();
  if (!normalizedShellAuthority) {
    return '<no-shell-authority>';
  }

  if (isExplicitRelativePath(normalizedShellAuthority)) {
    const resolvedShellAuthority = path.resolve(workspaceCwd ?? process.cwd(), normalizedShellAuthority);
    return process.platform === 'win32' ? resolvedShellAuthority.toLowerCase() : resolvedShellAuthority;
  }

  return process.platform === 'win32' ? normalizedShellAuthority.toLowerCase() : normalizedShellAuthority;
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

function defaultExecutionWorkingDirectory(): string {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? defaultTerminalWorkingDirectory();
}

function normalizeDefaultExecutionMetadataCwd(cwd: string): string {
  const normalizedCwd = normalizeExecutionCwd(cwd);
  if (!normalizedCwd || !isLegacyDefaultExecutionCwd(normalizedCwd)) {
    return cwd;
  }

  return defaultExecutionWorkingDirectory();
}

function resolveDefaultExecutionTerminalShellPath(): string {
  return resolveTerminalShellPathForConfigurationCwd(
    getConfiguredTerminalShell().resolvedPath,
    defaultExecutionWorkingDirectory()
  );
}

function resolveTerminalShellPathForConfigurationCwd(shellPath: string, cwd: string): string {
  const trimmedShellPath = shellPath.trim();
  if (!trimmedShellPath || path.isAbsolute(trimmedShellPath) || !isExplicitRelativePath(trimmedShellPath)) {
    return trimmedShellPath;
  }

  return path.resolve(cwd, trimmedShellPath);
}

function isLegacyDefaultExecutionCwd(cwd: string): boolean {
  const legacyDefaultCwd = normalizeExecutionCwd(defaultTerminalWorkingDirectory());
  return Boolean(
    legacyDefaultCwd &&
      areSameExecutionPath(cwd, legacyDefaultCwd) &&
      !(vscode.workspace.workspaceFolders ?? []).some((workspaceFolder) =>
        isSameOrDescendantExecutionPath(cwd, workspaceFolder.uri.fsPath)
      )
  );
}

function reconcileDefaultExecutionMetadataCwd(state: CanvasPrototypeState): CanvasPrototypeState {
  let changed = false;
  const nodes = state.nodes.map((node) => {
    if (node.kind === 'agent') {
      const metadata = ensureAgentMetadata(node);
      if (shouldSkipExecutionMetadataDefaultReconciliation(metadata)) {
        return node;
      }

      const normalizedCwd = normalizeDefaultExecutionMetadataCwd(metadata.cwd);
      if (normalizedCwd === metadata.cwd) {
        return node;
      }

      changed = true;
      return {
        ...node,
        metadata: {
          ...node.metadata,
          agent: {
            ...metadata,
            cwd: normalizedCwd
          }
        }
      };
    }

    if (node.kind === 'terminal') {
      const metadata = ensureTerminalMetadata(node);
      if (shouldSkipExecutionMetadataDefaultReconciliation(metadata)) {
        return node;
      }

      const normalizedCwd = normalizeDefaultExecutionMetadataCwd(metadata.cwd);
      const normalizedShellPath = resolveTerminalShellPathForConfigurationCwd(
        metadata.shellPath,
        defaultExecutionWorkingDirectory()
      );
      if (normalizedCwd === metadata.cwd && normalizedShellPath === metadata.shellPath) {
        return node;
      }

      changed = true;
      return {
        ...node,
        metadata: {
          ...node.metadata,
          terminal: {
            ...metadata,
            cwd: normalizedCwd,
            shellPath: normalizedShellPath
          }
        }
      };
    }

    return node;
  });

  return changed
    ? {
        ...state,
        updatedAt: new Date().toISOString(),
        nodes
      }
    : state;
}

function shouldSkipExecutionMetadataDefaultReconciliation(metadata: ExecutionSessionMetadata): boolean {
  return Boolean(
    metadata.liveSession ||
      metadata.runtimeSessionId ||
      metadata.pendingLaunch ||
      metadata.attachmentState === 'reattaching'
  );
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

function formatHistoryForkTitle(title: string | undefined): string {
  const baseTitle = title?.trim();
  return baseTitle ? `${baseTitle} 分叉` : '历史会话分叉';
}

function describeCreateNodeBlockReason(
  kind: CanvasCreatableNodeKind,
  blockReason: CreateNodeBlockReason
): string {
  if (blockReason === 'workspace-untrusted') {
    const kindLabel = kind === 'agent' ? 'Agent' : kind === 'terminal' ? 'Terminal' : 'Note';
    return `当前 workspace 未受信任，暂时不能创建 ${kindLabel} 节点。请先信任当前工作区，再创建执行型节点。`;
  }

  return '当前无法创建该节点。';
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
  return value.length > NOTE_EMBEDDED_CONTENT_MAX_LENGTH
    ? value.slice(0, NOTE_EMBEDDED_CONTENT_MAX_LENGTH)
    : value;
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

function selectExecutionAttentionSignalForNotification(
  signals: readonly ExecutionAttentionSignal[]
): ExecutionAttentionSignal | undefined {
  for (const signal of signals) {
    if (signal.presentation === 'notify' && signal.kind !== 'bel') {
      return signal;
    }
  }

  return signals.find((signal) => signal.presentation === 'notify');
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
      case 'suspended':
        return `${label} 已挂起。请点击“停止”结束会话后重启。`;
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

function isAgentCliCommandNotFoundLaunchError(error: unknown): boolean {
  return isAgentCliResolutionError(error) || (isRecord(error) && error.code === 'ENOENT');
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

function normalizeOptionalAgentLifecycle(value: unknown): AgentNodeStatus | undefined {
  if (
    value === 'starting' ||
    value === 'waiting-input' ||
    value === 'running' ||
    value === 'resuming'
  ) {
    return value;
  }

  return undefined;
}


function isAgentResumePhaseActive(status: AgentNodeStatus): boolean {
  return status === 'starting' || status === 'resuming';
}

function isAgentLifecycleAwaitingInteractiveState(
  status: AgentNodeStatus | TerminalNodeStatus
): boolean {
  return status === 'starting' || status === 'resuming' || status === 'running';
}

function shouldRecordAgentOutputHeuristics(status: AgentNodeStatus | TerminalNodeStatus): boolean {
  return isAgentLifecycleAwaitingInteractiveState(status) || status === 'waiting-input';
}

function isAgentInstructionSubmission(data: string): boolean {
  return /[\r\n]/.test(data);
}

function describeUnavailableConfiguredTerminalShell(shell: InspectedConfiguredTerminalShell): string {
  if (shell.resolutionSource === 'path') {
    return `当前配置的 Terminal shell 路径不可用：${shell.configuredPath || shell.resolvedPath}。新的嵌入式 Terminal 启动可能失败；请改成当前设备实际可用的 shell。`;
  }

  if (shell.resolutionSource === 'named-shell') {
    return `当前设备上未找到设置项 \`devSessionCanvas.terminal.shell=${shell.configuredShell}\` 对应的可用 shell。新的嵌入式 Terminal 启动可能失败；请改选当前设备实际支持的 shell。`;
  }

  return `当前设备的默认 shell 暂不可用：${shell.resolvedPath || '未解析到路径'}。新的嵌入式 Terminal 启动可能失败；请检查宿主环境，或手动指定可用 shell。`;
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

function buildCanvasTemplateStorageLocations(context: vscode.ExtensionContext): CanvasTemplateStorageLocation[] {
  const workspaceLocations =
    vscode.workspace.workspaceFolders
      ?.filter((folder) => folder.uri.scheme === 'file')
      .map<CanvasTemplateStorageLocation>((folder) => ({
        id: `workspace:${folder.uri.fsPath}`,
        label: `当前 workspace · ${folder.name}`,
        rootPath: path.join(folder.uri.fsPath, '.dev-session-canvas', 'templates'),
        scope: 'workspace'
      })) ?? [];

  const globalLocation: CanvasTemplateStorageLocation = {
    id: 'global',
    label: '当前设备',
    rootPath: path.join(context.globalStorageUri.fsPath, 'templates'),
    scope: 'global'
  };

  return [...workspaceLocations, globalLocation];
}

function createRootLocalCanvasStorageKey(rootPath: string): string {
  return createHash('sha256')
    .update(normalizeWorkspaceRootPathForComposition(rootPath))
    .digest('hex')
    .slice(0, 24);
}

function normalizeWorkspaceRootPathForComposition(rootPath: string): string {
  const resolvedRootPath = path.resolve(rootPath);
  return process.platform === 'win32' ? resolvedRootPath.toLowerCase() : resolvedRootPath;
}
