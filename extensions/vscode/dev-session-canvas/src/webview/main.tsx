import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { Terminal } from '@xterm/xterm';
import ReactFlow, {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  getViewportForBounds,
  Handle,
  MarkerType,
  Position,
  useReactFlow,
  useViewport,
  type Connection,
  type Edge,
  type EdgeMouseHandler,
  type ReactFlowInstance,
  type NodeDragHandler,
  type NodeMouseHandler,
  type NodeProps,
  type Viewport
} from 'reactflow';

import 'reactflow/dist/style.css';
import 'katex/dist/katex.min.css';
import '@xterm/xterm/css/xterm.css';
import '@vscode/codicons/dist/codicon.css';
import './styles.css';

import type {
  AgentLaunchDefaultsByProvider,
  AgentLaunchPresetKind,
  AgentProviderKind,
  AgentProviderLaunchDefaults,
  CanvasCreatableNodeKind,
  CanvasGroupSummary,
  CanvasEdgeArrowMode,
  CanvasEdgeColor,
  CanvasEdgeSummary,
  CanvasFileIconDescriptor,
  CanvasFileNodeDisplayStyle,
  CanvasFileNodeDisplayMode,
  CanvasFilePathDisplayMode,
  CanvasNodeKind,
  CanvasNodeFootprint,
  CanvasNodeMetadata,
  CanvasNodePosition,
  CanvasRuntimeContext,
  CanvasStrongTerminalAttentionReminderMode,
  CanvasNodeSummary,
  CanvasPrototypeState,
  CanvasTemplateMenuEntry,
  ExecutionNodeKind,
  FileListNodeEntrySummary,
  HostToWebviewMessage,
  WebviewDomAction,
  WebviewNodeActionId,
  WebviewClipboardTextSource,
  WebviewLifecycleIdentity,
  ExecutionPerformanceDiagnosticPayload,
  ExecutionTerminalClipboardDiagnosticPayload,
  WebviewProbeEdgeSnapshot,
  WebviewProbeGroupSnapshot,
  WebviewProbeNodeSnapshot,
  WebviewProbeSnapshot,
  WebviewToHostMessage
} from '../common/protocol';
import {
  DEFAULT_CANVAS_OVERVIEW_ZOOM_THRESHOLD,
  NOTE_EMBEDDED_CONTENT_MAX_LENGTH,
  extractWebviewMessageLifecycle,
  normalizeCanvasMultiRootPresentationMode,
  normalizeCanvasOverviewMode,
  normalizeCanvasOverviewZoomThreshold,
  normalizeCanvasStrongTerminalAttentionReminderMode
} from '../common/protocol';
import {
  buildFreshAgentCommandLine,
  buildAgentPresetCommandLine,
  classifyAgentLaunchPreset,
  createDefaultAgentLaunchDefaults,
  formatAgentLaunchMessageDescriptor,
  formatCommandLine,
  getAgentLaunchErrorDescriptor,
  validateAgentCommandLine,
  type AgentLaunchConflictDescriptionId,
  type AgentLaunchMessageDescriptor
} from '../common/agentLaunchPresets';
import { CANVAS_ATTENTION_INDICATOR_ICON_ID } from '../common/canvasAttentionVisuals';
import { colorForCanvasNodeKind } from '../common/canvasNodeVisuals';
import {
  canvasNodeStatusLabelDescriptor,
  canvasStatusLabelDescriptor,
  canvasStatusToneClass as statusToneClass
} from '../common/canvasNodeStatusPresentation';
import type {
  ExecutionTerminalFileLinkCandidate,
  ExecutionTerminalDroppedResource,
  ExecutionTerminalOpenLink,
  ExecutionTerminalFileLinkResolvePriority,
  ExecutionTerminalResolvedFileLink
} from '../common/executionTerminalLinks';
import type { ExecutionImagePasteData } from '../common/executionTerminalClipboard';
import { normalizeExecutionTerminalWordSeparators } from '../common/executionTerminalLinks';
import { toggleNoteMarkdownChecklistAtLine } from '../common/noteMarkdownChecklist';
import { DEFAULT_TERMINAL_SCROLLBACK, normalizeTerminalScrollback } from '../common/terminalScrollback';
import {
  estimatedCanvasNodeFootprint,
  isCanvasNodeKind,
  minimumCanvasNodeFootprint,
  normalizeCanvasNodeFootprint
} from '../common/protocol';
import type {
  ExecutionHostEvent,
  ExecutionTerminalContentChangeReason,
  ExecutionTerminalController,
  ExecutionTerminalRegistry
} from './executionTerminalTypes';
import { createExecutionSessionNodeTypes } from './executionSessionNodes';
import {
  CODE_FILES_DATA_TRANSFER,
  RESOURCE_URLS_DATA_TRANSFER,
  URI_LIST_DATA_TRANSFER,
  hasPotentialDroppedResource,
  parseDroppedStringArray
} from './droppedResources';
import { isWorkspaceRootCanvasGroupRole } from './canvasGroupFrameStyles';
import { createCanvasEdgeTypes, resolveCanvasEdgeStrokeColor } from './canvasEdges';
import { isImeComposingKeyboardEvent, stopCanvasEvent } from './canvasDomEvents';
import {
  CanvasGroupsViewportLayer,
  findInnermostCanvasGroupBodyAtFlowPoint,
  findInnermostCanvasGroupBodyAtScreenPoint,
  findInnermostCanvasGroupFrameAtFlowPoint,
  groupDepthForWebview
} from './canvasGroupLayers';
import {
  CANVAS_COMFORT_MIN_ZOOM,
  CANVAS_FIT_VIEW_PADDING,
  CANVAS_MAX_ZOOM,
  CanvasMiniMap,
  CanvasOverviewModeBridge,
  NODE_FOCUS_MAX_ZOOM,
  NODE_FOCUS_MIN_ZOOM,
  NODE_FOCUS_VIEW_PADDING,
  PANE_GALLERY_FIT_VIEW_PADDING,
  PANE_GALLERY_MIN_ZOOM,
  isPositiveFiniteNumber,
  mergeCanvasMiniMapRects,
  rectForGroupLike,
  resolveCanvasOverviewTitleScale,
  resolveCanvasSpatialBounds,
  resolveDynamicCanvasMinZoom,
  resolveViewportForCanvasRect
} from './canvasMiniMap';
import {
  CanvasNodeInteractionBoundary,
  CanvasOverviewInteractionContext,
  ChromeTitleEditor,
  OverflowAwareText,
  canvasNodeResizeCursorForDirection,
  canvasOverviewInertProps,
  footprintsEqual,
  handleEditableFieldKeyDown,
  handleNodeChromeDoubleClick,
  isInteractiveTarget,
  useCanvasOverviewInteractionsDisabled,
  positionsEqual,
  selectReadonlyTextContents,
  shouldAllowReadonlyTextShortcutToBubble,
  shouldDeleteSelectedNodeFromKeyboard,
  shouldHandleReadonlySelectAllShortcut
} from './canvasUiSurface';
import {
  canConnectCanvasEdgeEndpoints,
  canCreateCanvasGroupFromSelection,
  collectGroupSubtreeIdsForWebview,
  isCanvasGroupInsideTargetRoot,
  isTemplateCompatibleNodeKind,
  resolveContainingWorkspaceRootGroupIdForWebview,
  resolveSelectedObjectParentGroupId
} from './canvasGraphRules';
import type {
  CanvasClearCanvasTargetKind,
  CanvasContextMenuState,
  CanvasContextMenuView,
  CanvasFlowEdge,
  CanvasFlowNode,
  CanvasGroupDraft,
  CanvasMiniMapRect,
  CanvasNodeData,
  CanvasNodeLayoutDraft,
  CanvasNodeResizeDirection,
  CanvasNodeResizeDraft,
  CanvasOverviewViewportState,
  CanvasSurfaceBinding,
  CanvasViewportSize,
  ExecutionInputDispatchMetadata,
  ExecutionNodeHelpContent,
  FileListEntrySelectionTone,
  FileListViewMode,
  FloatingTooltipPosition,
  LocalUiState
} from './canvasTypes';
import {
  areNumberListsEqual,
  clampElementScrollTop,
  createFallbackVisualLineCounts,
  createNoteBodyFocusRequestFromPreviewDoubleClick,
  createNoteBodyLineNumberRows,
  handleNoteBodyIndentKeyDown,
  readElementLineHeightPx,
  resolveNoteBodySourceOffsetForTextareaScrollTop,
  resolveNoteBodyTextareaScrollTopForSourceOffset,
  scrollNoteMarkdownPreviewToSourceOffset,
  splitTextLines,
  type NoteBodyFocusRequest
} from './noteEditingSurface';
import type { NoteMarkdownFrontMatter } from './noteMarkdownFrontMatter';
import {
  createNoteMarkdownPreviewRenderer,
  findNoteMarkdownChecklistInputTarget,
  findNoteMarkdownLinkTarget,
  readNoteMarkdownChecklistLineNumber,
  clampNoteMarkdownSourceOffset,
  NOTE_MARKDOWN_CHECKLIST_SELECTOR,
  type NoteMarkdownImageWorkspaceRoot
} from './noteMarkdownPreview';
import {
  PANE_GALLERY_DEFAULT_OVERVIEW_LAYOUT,
  isPaneGalleryThumbnailLayout,
  normalizePaneGalleryLayoutMode,
  normalizePaneGalleryLocalState,
  normalizePaneGalleryOverviewLayoutMode,
  normalizePaneGalleryThumbnailLayoutMode,
  resolvePaneGalleryLastOverviewLayout,
  resolvePaneGalleryLastThumbnailLayout,
  resolvePaneGalleryViewportRole,
  type PaneGalleryLayoutMode,
  type PaneGalleryLocalState,
  type PaneGalleryViewportRole
} from './paneGalleryLocalState';
import {
  PaneGallery,
  buildPaneGalleryRootModels,
  resolvePaneGalleryModelContentBounds
} from './paneGallerySurface';
import {
  formatWebviewMessage,
  resolveWebviewI18n,
  type WebviewI18nBootstrap,
  type WebviewI18nKey
} from './i18n/webviewI18n';

type CanvasGroupRole = CanvasGroupSummary['role'];

declare function acquireVsCodeApi<T>(): {
  getState(): T | undefined;
  setState(state: T): void;
  postMessage(message: unknown): void;
};

declare global {
  interface Window {
    __DEV_SESSION_CANVAS_WEBVIEW_IDENTITY__?: WebviewLifecycleIdentity;
    __DEV_SESSION_CANVAS_I18N__?: WebviewI18nBootstrap;
  }
}

function shouldSelectExecutionNodeForTerminalSelection(terminal: Terminal): boolean {
  return terminal.getSelection().length > 0 || terminal.textarea === document.activeElement;
}

function resolveSelectedGroupIds(state: Pick<LocalUiState, 'selectedGroupId' | 'selectedGroupIds'>): string[] {
  return state.selectedGroupIds ?? (state.selectedGroupId ? [state.selectedGroupId] : []);
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

interface EdgeLabelEditorState {
  edgeId: string;
}

interface PendingExecutionInputAck {
  nodeId: string;
  kind: ExecutionNodeKind;
  webviewEpochMs: number;
  webviewPerformanceNowMs: number;
  characters: number;
  bytes: number;
}

interface AssociatedMarkdownDraftRecovery {
  kind: 'dirty-conflict' | 'recoverable-draft' | 'unavailable-draft';
  remoteContent: string;
  remoteContentRevision?: string;
}
type AssociatedMarkdownConflictResolution = 'reload' | 'overwrite';
interface PendingAssociatedMarkdownSubmission {
  content: string;
  force: boolean;
}
const FILE_TREE_BASE_PADDING_PX = 8;
const FILE_TREE_DEPTH_STEP_PX = 12;
type EmbeddedTerminalOptions = NonNullable<ConstructorParameters<typeof Terminal>[0]>;
type EmbeddedTerminalTheme = NonNullable<EmbeddedTerminalOptions['theme']>;
type WorkbenchThemeKind = 'light' | 'dark' | 'hcDark' | 'hcLight';
interface AutoPanController {
  handlePointerMove(
    event: Pick<PointerEvent | React.PointerEvent, 'clientX' | 'clientY'>,
    onPan?: (previousViewport: Viewport, nextViewport: Viewport) => void
  ): void;
  stop(): void;
}
type NodeViewportFocusMode = 'fit' | 'center-no-extra-zoom-if-visible';
type CanvasViewportObjectKind = 'node' | 'group';
interface PendingNodeViewportRequest {
  objectId: string;
  objectKind: CanvasViewportObjectKind;
  mode: NodeViewportFocusMode;
  selectNode: boolean;
}
interface PendingNodeGroupViewportRequest {
  nodeIds: string[];
  retryCount: number;
}
interface PendingManualNodeCreateRequest {
  requestId: string;
  knownNodeIdsSnapshot: ReadonlySet<string>;
  kind: CanvasCreatableNodeKind;
  preferredPosition?: CanvasNodePosition;
  targetGroupId?: string;
  agentProvider?: AgentProviderKind;
  agentLaunchPreset?: AgentLaunchPresetKind;
  agentCustomLaunchCommand?: string;
  cwd?: string;
}
type ExecutionHelpTriggerVariant = 'canvas' | 'inline';

let nextExecutionNodeHelpTooltipId = 0;
let nextNoteMarkdownMetadataPopoverId = 0;
const vscode = acquireVsCodeApi<LocalUiState>();
const reportedRuntimeDiagnostics = new Set<string>();
const initialPersistedState = vscode.getState() ?? {};
const webviewI18n = window.__DEV_SESSION_CANVAS_I18N__ ?? resolveWebviewI18n(navigator.language);
function t(key: WebviewI18nKey, params?: Record<string, string | number>): string {
  return formatWebviewMessage(webviewI18n.messages, key, params);
}
function tCount(oneKey: WebviewI18nKey, otherKey: WebviewI18nKey, count: number): string {
  return t(count === 1 ? oneKey : otherKey, { count });
}
const noteMarkdownPreviewRenderer = createNoteMarkdownPreviewRenderer(t);
const edgeTypes = createCanvasEdgeTypes({ t });

function tAgentLaunchMessage(
  descriptor: AgentLaunchMessageDescriptor | undefined,
  fallback?: string
): string {
  if (!descriptor) {
    return fallback ?? t('agentLaunchPreset.agentCommandParseError');
  }

  const params = descriptor.params ?? {};
  switch (descriptor.id) {
    case 'resumeSessionIdEmpty':
      return t('agentLaunch.error.resumeSessionIdEmpty');
    case 'forkSessionIdEmpty':
      return t('agentLaunch.error.forkSessionIdEmpty');
    case 'launchCommandEmpty':
      return t('agentLaunch.error.launchCommandEmpty');
    case 'claudeCommandMismatch':
      return t('agentLaunch.error.claudeCommandMismatch');
    case 'codexCommandMismatch':
      return t('agentLaunch.error.codexCommandMismatch');
    case 'doubleQuoteUnclosed':
      return t('agentLaunch.error.doubleQuoteUnclosed');
    case 'singleQuoteUnclosed':
      return t('agentLaunch.error.singleQuoteUnclosed');
    case 'defaultArgsParseError':
      return t('agentLaunch.error.defaultArgsParseError', {
        provider: params.provider ?? 'Agent',
        message: descriptor.cause
          ? tAgentLaunchMessage(descriptor.cause)
          : params.message ?? ''
      });
    case 'defaultArgsConflict':
      return t('agentLaunch.error.defaultArgsConflict', {
        provider: params.provider ?? 'Agent',
        description: tAgentLaunchConflictDescription(
          params.descriptionId as AgentLaunchConflictDescriptionId | undefined,
          params.description
        ),
        token: params.token ?? ''
      });
    default:
      return fallback ?? formatAgentLaunchMessageDescriptor(descriptor);
  }
}

function tAgentLaunchConflictDescription(
  id: AgentLaunchConflictDescriptionId | undefined,
  fallback?: string
): string {
  switch (id) {
    case 'positionalArgumentSeparator':
      return t('agentLaunch.conflict.positionalArgumentSeparator');
    case 'sessionSelectionArgument':
      return t('agentLaunch.conflict.sessionSelectionArgument');
    case 'sessionTargetSubcommand':
      return t('agentLaunch.conflict.sessionTargetSubcommand');
    case 'positionalArgument':
      return t('agentLaunch.conflict.positionalArgument');
    case 'forkFlagArgument':
      return t('agentLaunch.conflict.forkFlagArgument');
    case 'sessionTargetArgument':
      return t('agentLaunch.conflict.sessionTargetArgument');
    default:
      return fallback ?? t('agentLaunch.conflict.argument');
  }
}
const NOTE_BODY_PLACEHOLDER = t('note.body.placeholder');
const EMBEDDED_NOTE_BODY_PLACEHOLDER = t('note.body.embeddedPlaceholder', {
  max: NOTE_EMBEDDED_CONTENT_MAX_LENGTH.toLocaleString()
});
const EXECUTION_NODE_HELP_TIPS: ExecutionNodeHelpContent = {
  title: t('execution.help.title'),
  items: [
    t('execution.help.dragPath'),
    t('execution.help.panelSurface'),
    t('execution.help.runtimePersistence'),
    t('execution.help.notifications'),
    t('execution.help.windowsPowerShell'),
    t('execution.help.multiRootPresentation')
  ]
};
const EXECUTION_TERMINAL_HELP_TOOLTIP = formatExecutionNodeHelpTooltip(EXECUTION_NODE_HELP_TIPS);
const injectedWebviewLifecycleIdentity = extractWebviewMessageLifecycle({
  lifecycle: window.__DEV_SESSION_CANVAS_WEBVIEW_IDENTITY__
});
const webviewLifecycleIdentity = createWebviewLifecycleIdentity(injectedWebviewLifecycleIdentity);
if (!injectedWebviewLifecycleIdentity) {
  window.setTimeout(() => {
    emitWebviewLifecycleDiagnostic('Active Webview HTML is missing a valid lifecycle identity; using the test fallback identity.');
  }, 0);
}
const rootElement = document.querySelector<HTMLDivElement>('#app');
const executionTerminalRegistry: ExecutionTerminalRegistry = new Map();
const pendingExecutionFileLinkResolutionRequests = new Map<
  string,
  {
    resolve: (resolvedLinks: ExecutionTerminalResolvedFileLink[]) => void;
    reject: (error: Error) => void;
    timeout: number;
  }
>();
const pendingExecutionPasteRequests = new Map<
  string,
  {
    nodeId: string;
    kind: ExecutionNodeKind;
  }
>();

const EXECUTION_PERFORMANCE_DIAGNOSTIC_MIN_DURATION_MS = 24;
const EXECUTION_PERFORMANCE_DIAGNOSTIC_DRAIN_MIN_DURATION_MS = 16;
const EXECUTION_PERFORMANCE_DIAGNOSTIC_MIN_CHARACTERS = 32 * 1024;
const EXECUTION_PERFORMANCE_DIAGNOSTIC_MAX_SAMPLES = 500;
const EXECUTION_TERMINAL_DRAIN_MAX_CONTROLLERS_PER_FRAME = 2;
const EXECUTION_TERMINAL_DRAIN_MAX_CHARS_PER_FRAME = 32 * 1024;
const EXECUTION_TERMINAL_DRAIN_MAX_CHARS_PER_CONTROLLER = 16 * 1024;
const EXECUTION_TERMINAL_INPUT_DRAIN_MAX_CONTROLLERS_PER_FRAME = 1;
const EXECUTION_TERMINAL_INPUT_DRAIN_MAX_CHARS_PER_FRAME = 4 * 1024;
const EXECUTION_TERMINAL_INPUT_DRAIN_MAX_CHARS_PER_CONTROLLER = 4 * 1024;
const EXECUTION_TERMINAL_LAG_RECOVERY_DRAIN_MAX_CHARS_PER_FRAME = 8 * 1024;
const EXECUTION_TERMINAL_INPUT_OUTPUT_YIELD_MS = 240;
const EXECUTION_TERMINAL_LAG_RECOVERY_WINDOW_MS = 2000;
const EXECUTION_TERMINAL_VISIBILITY_RESTORE_RECOVERY_MS = 3000;
const EXECUTION_TERMINAL_MAX_QUEUED_WRITES_PER_CONTROLLER = 1;
const EXECUTION_TERMINAL_HARD_SNAPSHOT_RESET_BACKLOG_THRESHOLD = 1024 * 1024;
const EXECUTION_TERMINAL_SNAPSHOT_RESET_BACKLOG_THRESHOLD = 512 * 1024;
const EXECUTION_TERMINAL_HIDDEN_SNAPSHOT_RESET_BACKLOG_THRESHOLD = 128 * 1024;
const EXECUTION_TERMINAL_SNAPSHOT_RESET_AFTER_LAG_MS = 2000;
const EXECUTION_TERMINAL_SNAPSHOT_RESET_REQUEST_COOLDOWN_MS = 1000;
const EXECUTION_TERMINAL_SNAPSHOT_RESET_TIMEOUT_MS = 1500;
const EXECUTION_TERMINAL_SNAPSHOT_RESET_DEFERRED_OUTPUT_BUDGET = 256 * 1024;
const EXECUTION_TERMINAL_SNAPSHOT_RESET_DEFERRED_OUTPUT_DIAGNOSTIC_STEP = 128 * 1024;
const EXECUTION_TERMINAL_SNAPSHOT_RESTORE_STAGGER_MS = 32;
const EXECUTION_TERMINAL_INPUT_SNAPSHOT_RESTORE_STAGGER_MS = 96;
const EXECUTION_TERMINAL_INPUT_SNAPSHOT_RESTORE_MAX_DEFER_MS = 480;
const EXECUTION_MAIN_THREAD_LAG_INTERVAL_MS = 500;
const EXECUTION_MAIN_THREAD_LAG_REPORT_THRESHOLD_MS = 120;
const executionPerformanceDiagnosticSamples: ExecutionPerformanceDiagnosticPayload[] = [];
let nextExecutionInputSequence = 1;
let nextExecutionSnapshotResetRequestSequence = 1;
const pendingExecutionInputAcks = new Map<number, PendingExecutionInputAck>();
let lastExecutionInputAtMs = Number.NEGATIVE_INFINITY;
let lastExecutionInputNodeId: string | undefined;
let lastExecutionMainThreadLagAtMs = Number.NEGATIVE_INFINITY;
let lastExecutionVisibilityRestoredAtMs = Number.NEGATIVE_INFINITY;

type WebviewRuntimeDiagnosticPayload = Extract<
  WebviewToHostMessage,
  { type: 'webview/runtimeDiagnostic' }
>['payload'];

function registerRuntimeDiagnosticListeners(): void {
  window.addEventListener('error', (event: ErrorEvent) => {
    emitRuntimeDiagnostic({
      source: 'window.error',
      message: normalizeRuntimeDiagnosticMessage(event.error, event.message),
      stack: extractRuntimeDiagnosticStack(event.error),
      filename: typeof event.filename === 'string' && event.filename.trim() ? event.filename.trim() : undefined,
      line: normalizeRuntimeDiagnosticCoordinate(event.lineno),
      column: normalizeRuntimeDiagnosticCoordinate(event.colno),
      readyState: document.readyState
    });
  });

  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    emitRuntimeDiagnostic({
      source: 'window.unhandledrejection',
      message: normalizeRuntimeDiagnosticMessage(event.reason),
      stack: extractRuntimeDiagnosticStack(event.reason),
      readyState: document.readyState
    });
  });
}

function emitRuntimeDiagnostic(payload: WebviewRuntimeDiagnosticPayload): void {
  const diagnosticKey = JSON.stringify([
    payload.source,
    payload.message,
    payload.stack ?? '',
    payload.filename ?? '',
    payload.line ?? 0,
    payload.column ?? 0,
    payload.readyState ?? ''
  ]);

  if (reportedRuntimeDiagnostics.has(diagnosticKey)) {
    return;
  }

  if (reportedRuntimeDiagnostics.size >= 100) {
    reportedRuntimeDiagnostics.clear();
  }
  reportedRuntimeDiagnostics.add(diagnosticKey);

  try {
    postMessage({
      type: 'webview/runtimeDiagnostic',
      payload
    });
  } catch {
    // Ignore secondary failures while reporting primary webview runtime issues.
  }
}

function normalizeRuntimeDiagnosticMessage(error: unknown, fallbackMessage?: string): string {
  if (error instanceof Error) {
    const preferredMessage = error.message.trim() || error.name.trim();
    if (preferredMessage) {
      return preferredMessage;
    }
  }

  if (typeof error === 'string') {
    const normalized = error.trim();
    if (normalized) {
      return normalized;
    }
  }

  if (typeof fallbackMessage === 'string') {
    const normalized = fallbackMessage.trim();
    if (normalized) {
      return normalized;
    }
  }

  try {
    const serialized = JSON.stringify(error);
    return serialized === undefined ? 'Unknown webview runtime error.' : serialized;
  } catch {
    return String(error);
  }
}

function extractRuntimeDiagnosticStack(error: unknown): string | undefined {
  if (!(error instanceof Error)) {
    return undefined;
  }

  const stack = error.stack?.trim();
  return stack ? stack : undefined;
}

function normalizeRuntimeDiagnosticCoordinate(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }

  return Math.round(value);
}

function reportExecutionInputDispatch(
  nodeId: string,
  kind: ExecutionNodeKind,
  input: string,
  dispatch: (metadata: ExecutionInputDispatchMetadata) => void
): void {
  const metadata = createExecutionInputDispatchMetadata();
  lastExecutionInputAtMs = metadata.webviewPerformanceNowMs;
  lastExecutionInputNodeId = nodeId;
  pendingExecutionInputAcks.set(metadata.sequence, {
    nodeId,
    kind,
    webviewEpochMs: metadata.webviewEpochMs,
    webviewPerformanceNowMs: metadata.webviewPerformanceNowMs,
    characters: input.length,
    bytes: estimateUtf8ByteLength(input)
  });
  trimPendingExecutionInputAcks();
  const startedAt = readPerformanceNow();
  try {
    dispatch(metadata);
    reportExecutionPerformanceDiagnostic(
      {
        source: 'webview-input-dispatch',
        nodeId,
        kind,
        sequence: metadata.sequence,
        durationMs: readPerformanceNow() - startedAt,
        webviewEpochMs: metadata.webviewEpochMs,
        characters: input.length,
        bytes: estimateUtf8ByteLength(input),
        success: true
      },
      {
        minDurationMs: 8
      }
    );
  } catch (error) {
    reportExecutionPerformanceDiagnostic(
      {
        source: 'webview-input-dispatch',
        nodeId,
        kind,
        sequence: metadata.sequence,
        durationMs: readPerformanceNow() - startedAt,
        webviewEpochMs: metadata.webviewEpochMs,
        characters: input.length,
        bytes: estimateUtf8ByteLength(input),
        success: false,
        reason: error instanceof Error ? error.message : String(error)
      },
      {
        force: true
      }
    );
    throw error;
  }
}

function createExecutionInputDispatchMetadata(): ExecutionInputDispatchMetadata {
  return {
    sequence: nextExecutionInputSequence++,
    webviewEpochMs: Date.now(),
    webviewPerformanceNowMs: readPerformanceNow()
  };
}

function reportExecutionPerformanceDiagnostic(
  payload: ExecutionPerformanceDiagnosticPayload,
  options: {
    force?: boolean;
    minDurationMs?: number;
    minCharacters?: number;
  } = {}
): void {
  const normalizedPayload = normalizeExecutionPerformanceDiagnosticForWebview(payload);
  const minDurationMs = options.minDurationMs ?? EXECUTION_PERFORMANCE_DIAGNOSTIC_MIN_DURATION_MS;
  const minCharacters = options.minCharacters ?? Number.POSITIVE_INFINITY;
  const diagnosticCharacters = Math.max(normalizedPayload.characters ?? 0, normalizedPayload.pendingOutputLength ?? 0);
  const shouldReport =
    options.force === true ||
    normalizedPayload.success === false ||
    (typeof normalizedPayload.durationMs === 'number' && normalizedPayload.durationMs >= minDurationMs) ||
    diagnosticCharacters >= minCharacters;

  if (!shouldReport) {
    return;
  }

  executionPerformanceDiagnosticSamples.push(normalizedPayload);
  if (executionPerformanceDiagnosticSamples.length > EXECUTION_PERFORMANCE_DIAGNOSTIC_MAX_SAMPLES) {
    executionPerformanceDiagnosticSamples.splice(
      0,
      executionPerformanceDiagnosticSamples.length - EXECUTION_PERFORMANCE_DIAGNOSTIC_MAX_SAMPLES
    );
  }

  try {
    postMessage({
      type: 'webview/executionPerformanceDiagnostic',
      payload: normalizedPayload
    });
  } catch {
    // Ignore telemetry failures; performance diagnostics must not affect input/output.
  }
}

function normalizeExecutionPerformanceDiagnosticForWebview(
  payload: ExecutionPerformanceDiagnosticPayload
): ExecutionPerformanceDiagnosticPayload {
  return {
    source: payload.source,
    nodeId: payload.nodeId,
    kind: payload.kind,
    reason: payload.reason,
    sequence: normalizeDiagnosticInteger(payload.sequence),
    durationMs: roundDiagnosticNumber(payload.durationMs),
    webviewEpochMs: roundDiagnosticNumber(payload.webviewEpochMs),
    hostReceivedEpochMs: roundDiagnosticNumber(payload.hostReceivedEpochMs),
    hostAckEpochMs: roundDiagnosticNumber(payload.hostAckEpochMs),
    hostAckPostEpochMs: roundDiagnosticNumber(payload.hostAckPostEpochMs),
    queueDelayMs: roundDiagnosticNumber(payload.queueDelayMs),
    requestId: payload.requestId,
    executionSessionId: payload.executionSessionId,
    characters: normalizeDiagnosticInteger(payload.characters),
    bytes: normalizeDiagnosticInteger(payload.bytes),
    controllerCount: normalizeDiagnosticInteger(payload.controllerCount),
    flushedControllerCount: normalizeDiagnosticInteger(payload.flushedControllerCount),
    pendingControllerCount: normalizeDiagnosticInteger(payload.pendingControllerCount),
    queuedSnapshotCount: normalizeDiagnosticInteger(payload.queuedSnapshotCount),
    queuedWriteCount: normalizeDiagnosticInteger(payload.queuedWriteCount),
    bufferLength: normalizeDiagnosticInteger(payload.bufferLength),
    pendingOutputLength: normalizeDiagnosticInteger(payload.pendingOutputLength),
    owner: payload.owner,
    lifecycleStatus: payload.lifecycleStatus,
    workspaceStateMode: payload.workspaceStateMode,
    success: payload.success
  };
}

function handleExecutionInputAck(payload: {
  nodeId: string;
  kind: ExecutionNodeKind;
  sequence?: number;
  webviewEpochMs?: number;
  webviewPerformanceNowMs?: number;
  hostReceivedEpochMs: number;
  hostAckEpochMs: number;
  hostAckPostEpochMs?: number;
  queueDelayMs?: number;
  controllerCount?: number;
  pendingControllerCount?: number;
  queuedWriteCount?: number;
  pendingOutputLength?: number;
}): void {
  const pending = typeof payload.sequence === 'number' ? pendingExecutionInputAcks.get(payload.sequence) : undefined;
  if (typeof payload.sequence === 'number') {
    pendingExecutionInputAcks.delete(payload.sequence);
  }
  const now = readPerformanceNow();
  const startedAt = pending?.webviewPerformanceNowMs ?? payload.webviewPerformanceNowMs;
  const durationMs = typeof startedAt === 'number' ? Math.max(0, now - startedAt) : undefined;
  reportExecutionPerformanceDiagnostic(
    {
      source: 'webview-input-ack',
      nodeId: payload.nodeId,
      kind: payload.kind,
      sequence: payload.sequence,
      durationMs,
      webviewEpochMs: payload.webviewEpochMs ?? pending?.webviewEpochMs,
      hostReceivedEpochMs: payload.hostReceivedEpochMs,
      hostAckEpochMs: payload.hostAckEpochMs,
      hostAckPostEpochMs: payload.hostAckPostEpochMs,
      queueDelayMs: payload.queueDelayMs,
      characters: pending?.characters,
      bytes: pending?.bytes,
      controllerCount: payload.controllerCount,
      pendingControllerCount: payload.pendingControllerCount,
      queuedWriteCount: payload.queuedWriteCount,
      pendingOutputLength: payload.pendingOutputLength,
      success: true
    },
    {
      minDurationMs: 8
    }
  );
}

function trimPendingExecutionInputAcks(): void {
  if (pendingExecutionInputAcks.size <= 200) {
    return;
  }

  const overflow = pendingExecutionInputAcks.size - 200;
  let deletedCount = 0;
  for (const sequence of pendingExecutionInputAcks.keys()) {
    pendingExecutionInputAcks.delete(sequence);
    deletedCount += 1;
    if (deletedCount >= overflow) {
      return;
    }
  }
}

function roundDiagnosticNumber(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value * 100) / 100 : undefined;
}

function normalizeDiagnosticInteger(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined;
}

function estimateUtf8ByteLength(value: string): number {
  try {
    return new TextEncoder().encode(value).length;
  } catch {
    return value.length;
  }
}

function readPerformanceNow(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
}

function startExecutionMainThreadLagMonitor(): void {
  let expectedAt = readPerformanceNow() + EXECUTION_MAIN_THREAD_LAG_INTERVAL_MS;
  window.setTimeout(function tick(): void {
    const now = readPerformanceNow();
    const lagMs = Math.max(0, now - expectedAt);
    if (lagMs >= EXECUTION_MAIN_THREAD_LAG_REPORT_THRESHOLD_MS) {
      lastExecutionMainThreadLagAtMs = now;
      reportExecutionPerformanceDiagnostic(
        {
          source: 'webview-main-thread-lag',
          durationMs: lagMs,
          reason: 'timer-lag',
          success: true
        },
        {
          force: true
        }
      );
    }
    expectedAt = now + EXECUTION_MAIN_THREAD_LAG_INTERVAL_MS;
    window.setTimeout(tick, EXECUTION_MAIN_THREAD_LAG_INTERVAL_MS);
  }, EXECUTION_MAIN_THREAD_LAG_INTERVAL_MS);
}

registerRuntimeDiagnosticListeners();
startExecutionMainThreadLagMonitor();
const pendingExecutionTerminalDrains = new Set<ExecutionTerminalController>();
let executionTerminalDrainFrame: number | undefined;
let executionTerminalDrainTimer: number | undefined;
interface PendingExecutionTerminalSnapshotWrite {
  nodeId: string;
  kind: ExecutionNodeKind;
  queuedAtMs: number;
  run: (done: () => void) => void;
  cancel: () => void;
  finishQueue?: () => void;
}
const pendingExecutionTerminalSnapshotWrites: PendingExecutionTerminalSnapshotWrite[] = [];
let executionTerminalSnapshotWriteFrame: number | undefined;
let executionTerminalSnapshotWriteTimer: number | undefined;
let executionTerminalSnapshotWriteInFlight = false;
let activeExecutionTerminalSnapshotWrite: PendingExecutionTerminalSnapshotWrite | undefined;
let lastExecutionTerminalSnapshotWriteAtMs = Number.NEGATIVE_INFINITY;
const NODE_FOCUS_ANIMATION_DURATION_MS = 280;
const NODE_FOCUS_VIEWPORT_SYNC_GRACE_MS = 48;
const NODE_GROUP_FOCUS_RETRY_INTERVAL_MS = 48;
const NODE_GROUP_FOCUS_MAX_RETRY_COUNT = 8;
const CANVAS_AUTO_PAN_EDGE_THRESHOLD_PX = 48;
const CANVAS_AUTO_PAN_MAX_SPEED_PX = 24;
const DEFAULT_CANVAS_GROUP_SIZE: CanvasNodeFootprint = { width: 360, height: 240 };
const EMBEDDED_TERMINAL_BACKGROUND_CSS_VAR = '--canvas-embedded-terminal-background';
const EMBEDDED_TERMINAL_FOREGROUND_CSS_VAR = '--canvas-embedded-terminal-foreground';
const TERMINAL_BACKGROUND_FALLBACKS: Record<'editor' | 'panel', string[]> = {
  editor: ['--vscode-editor-background', '--vscode-panel-background'],
  panel: ['--vscode-panel-background', '--vscode-editor-background']
};
const EMBEDDED_TERMINAL_DEFAULTS: Record<
  WorkbenchThemeKind,
  {
    editorBackground: string;
    panelBackground: string;
    foreground: string;
    selectionBackground: string;
    ansi: Record<
      | 'black'
      | 'red'
      | 'green'
      | 'yellow'
      | 'blue'
      | 'magenta'
      | 'cyan'
      | 'white'
      | 'brightBlack'
      | 'brightRed'
      | 'brightGreen'
      | 'brightYellow'
      | 'brightBlue'
      | 'brightMagenta'
      | 'brightCyan'
      | 'brightWhite',
      string
    >;
  }
> = {
  dark: {
    editorBackground: '#1E1E1E',
    panelBackground: '#1E1E1E',
    foreground: '#CCCCCC',
    selectionBackground: '#264F78',
    ansi: {
      black: '#000000',
      red: '#cd3131',
      green: '#0DBC79',
      yellow: '#e5e510',
      blue: '#2472c8',
      magenta: '#bc3fbc',
      cyan: '#11a8cd',
      white: '#e5e5e5',
      brightBlack: '#666666',
      brightRed: '#f14c4c',
      brightGreen: '#23d18b',
      brightYellow: '#f5f543',
      brightBlue: '#3b8eea',
      brightMagenta: '#d670d6',
      brightCyan: '#29b8db',
      brightWhite: '#e5e5e5'
    }
  },
  light: {
    editorBackground: '#FFFFFF',
    panelBackground: '#F3F3F3',
    foreground: '#333333',
    selectionBackground: '#ADD6FF',
    ansi: {
      black: '#000000',
      red: '#cd3131',
      green: '#107C10',
      yellow: '#949800',
      blue: '#0451a5',
      magenta: '#bc05bc',
      cyan: '#0598bc',
      white: '#555555',
      brightBlack: '#666666',
      brightRed: '#cd3131',
      brightGreen: '#14CE14',
      brightYellow: '#b5ba00',
      brightBlue: '#0451a5',
      brightMagenta: '#bc05bc',
      brightCyan: '#0598bc',
      brightWhite: '#a5a5a5'
    }
  },
  hcDark: {
    editorBackground: '#000000',
    panelBackground: '#000000',
    foreground: '#FFFFFF',
    selectionBackground: '#f3f518',
    ansi: {
      black: '#000000',
      red: '#cd0000',
      green: '#00cd00',
      yellow: '#cdcd00',
      blue: '#0000ee',
      magenta: '#cd00cd',
      cyan: '#00cdcd',
      white: '#e5e5e5',
      brightBlack: '#7f7f7f',
      brightRed: '#ff0000',
      brightGreen: '#00ff00',
      brightYellow: '#ffff00',
      brightBlue: '#5c5cff',
      brightMagenta: '#ff00ff',
      brightCyan: '#00ffff',
      brightWhite: '#ffffff'
    }
  },
  hcLight: {
    editorBackground: '#FFFFFF',
    panelBackground: '#FFFFFF',
    foreground: '#292929',
    selectionBackground: '#0F4A85',
    ansi: {
      black: '#292929',
      red: '#cd3131',
      green: '#136C13',
      yellow: '#949800',
      blue: '#0451a5',
      magenta: '#bc05bc',
      cyan: '#0598bc',
      white: '#555555',
      brightBlack: '#666666',
      brightRed: '#cd3131',
      brightGreen: '#00bc00',
      brightYellow: '#b5ba00',
      brightBlue: '#0451a5',
      brightMagenta: '#bc05bc',
      brightCyan: '#0598bc',
      brightWhite: '#a5a5a5'
    }
  }
};
let latestRuntimeContext: CanvasRuntimeContext = {
  workspaceTrusted: false,
  surfaceLocation: 'editor',
  defaultAgentProvider: 'codex',
  agentLaunchDefaults: createDefaultAgentLaunchDefaults(),
  strongTerminalAttentionReminderMode: 'both',
  terminalScrollback: DEFAULT_TERMINAL_SCROLLBACK,
  editorMultiCursorModifier: 'alt',
  terminalWordSeparators: normalizeExecutionTerminalWordSeparators(undefined),
  overviewMode: 'title',
  overviewZoomThreshold: DEFAULT_CANVAS_OVERVIEW_ZOOM_THRESHOLD,
  multiRootPresentationMode: 'rootGroups',
  workspaceRootWatermarksEnabled: true,
  filePresentationMode: 'nodes',
  fileNodeDisplayStyle: 'minimal',
  fileNodeDisplayMode: 'icon-path',
  filePathDisplayMode: 'basename',
  fileIconFontFaces: [],
  workspaceFolders: [],
  noteMarkdownImageWorkspaceRoots: []
};
let embeddedTerminalThemeObserverDispose: (() => void) | undefined;
let embeddedTerminalAppearanceRefreshScheduled = false;

if (!rootElement) {
  throw new Error('Webview root element not found.');
}

const root = createRoot(rootElement);

function normalizeRuntimeContext(
  runtimeContext: Partial<CanvasRuntimeContext> | undefined
): CanvasRuntimeContext {
  const fileIconFontFaces = runtimeContext && Array.isArray(runtimeContext.fileIconFontFaces)
    ? runtimeContext.fileIconFontFaces
    : [];
  const noteMarkdownImageWorkspaceRoots =
    runtimeContext && Array.isArray(runtimeContext.noteMarkdownImageWorkspaceRoots)
      ? runtimeContext.noteMarkdownImageWorkspaceRoots.filter(
          (root): root is NoteMarkdownImageWorkspaceRoot =>
            typeof root?.name === 'string' && typeof root.webviewResourceBaseUri === 'string'
        )
      : [];
  const workspaceFolders =
    runtimeContext && Array.isArray(runtimeContext.workspaceFolders)
      ? runtimeContext.workspaceFolders.filter(
          (folder): folder is CanvasRuntimeContext['workspaceFolders'][number] =>
            typeof folder?.name === 'string' && typeof folder.path === 'string'
        )
      : [];
  const legacyStrongTerminalAttentionReminderEnabled = runtimeContext
    ? (
        runtimeContext as Partial<CanvasRuntimeContext> & {
          strongTerminalAttentionReminderEnabled?: boolean;
        }
      ).strongTerminalAttentionReminderEnabled
    : undefined;

  return {
    workspaceTrusted: runtimeContext?.workspaceTrusted ?? false,
    surfaceLocation: runtimeContext?.surfaceLocation === 'editor' ? 'editor' : 'panel',
    defaultAgentProvider: runtimeContext?.defaultAgentProvider === 'claude' ? 'claude' : 'codex',
    agentLaunchDefaults: normalizeAgentLaunchDefaults(runtimeContext?.agentLaunchDefaults),
    strongTerminalAttentionReminderMode: normalizeCanvasStrongTerminalAttentionReminderMode(
      runtimeContext?.strongTerminalAttentionReminderMode ?? legacyStrongTerminalAttentionReminderEnabled
    ),
    terminalScrollback:
      typeof runtimeContext?.terminalScrollback === 'number'
        ? runtimeContext.terminalScrollback
        : DEFAULT_TERMINAL_SCROLLBACK,
    editorMultiCursorModifier: runtimeContext?.editorMultiCursorModifier === 'ctrlCmd' ? 'ctrlCmd' : 'alt',
    terminalWordSeparators:
      typeof runtimeContext?.terminalWordSeparators === 'string'
        ? runtimeContext.terminalWordSeparators
        : normalizeExecutionTerminalWordSeparators(undefined),
    overviewMode: normalizeCanvasOverviewMode(runtimeContext?.overviewMode),
    overviewZoomThreshold: normalizeCanvasOverviewZoomThreshold(runtimeContext?.overviewZoomThreshold),
    multiRootPresentationMode: normalizeCanvasMultiRootPresentationMode(runtimeContext?.multiRootPresentationMode),
    workspaceRootWatermarksEnabled: runtimeContext?.workspaceRootWatermarksEnabled !== false,
    filePresentationMode: runtimeContext?.filePresentationMode === 'lists' ? 'lists' : 'nodes',
    fileNodeDisplayStyle: runtimeContext?.fileNodeDisplayStyle === 'card' ? 'card' : 'minimal',
    fileNodeDisplayMode:
      runtimeContext?.fileNodeDisplayMode === 'icon-only' || runtimeContext?.fileNodeDisplayMode === 'path-only'
        ? runtimeContext.fileNodeDisplayMode
        : 'icon-path',
    filePathDisplayMode: runtimeContext?.filePathDisplayMode === 'relative-path' ? 'relative-path' : 'basename',
    fileIconFontFaces,
    workspaceFolders,
    noteMarkdownImageWorkspaceRoots
  };
}

function normalizeAgentLaunchDefaults(
  value: Partial<AgentLaunchDefaultsByProvider> | undefined
): AgentLaunchDefaultsByProvider {
  const defaults = createDefaultAgentLaunchDefaults();
  return {
    codex: {
      command: typeof value?.codex?.command === 'string' && value.codex.command.trim() ? value.codex.command : defaults.codex.command,
      defaultArgs: typeof value?.codex?.defaultArgs === 'string' ? value.codex.defaultArgs : defaults.codex.defaultArgs
    },
    claude: {
      command:
        typeof value?.claude?.command === 'string' && value.claude.command.trim()
          ? value.claude.command
          : defaults.claude.command,
      defaultArgs: typeof value?.claude?.defaultArgs === 'string' ? value.claude.defaultArgs : defaults.claude.defaultArgs
    }
  };
}

function normalizeCanvasPrototypeState(state: Partial<CanvasPrototypeState> | null | undefined): CanvasPrototypeState {
  const nodes = Array.isArray(state?.nodes) ? state?.nodes ?? [] : [];
  const edges = Array.isArray(state?.edges) ? state?.edges ?? [] : [];
  const fileReferences = Array.isArray(state?.fileReferences) ? state?.fileReferences ?? [] : [];
  const suppressedFileActivityEdgeIds = state && Array.isArray(state.suppressedFileActivityEdgeIds)
    ? state.suppressedFileActivityEdgeIds.filter((edgeId): edgeId is string => typeof edgeId === 'string')
    : [];
  const suppressedAutomaticFileArtifactNodeIds = state && Array.isArray(state.suppressedAutomaticFileArtifactNodeIds)
    ? state.suppressedAutomaticFileArtifactNodeIds.filter((nodeId): nodeId is string => typeof nodeId === 'string')
    : [];
  const rawGroups = state?.groups;
  const groups = Array.isArray(rawGroups) ? rawGroups : [];
  const nextGroupSequence = state?.nextGroupSequence;

  return {
    version: 1,
    updatedAt: typeof state?.updatedAt === 'string' ? state.updatedAt : new Date().toISOString(),
    nodes,
    edges,
    groups,
    nextGroupSequence:
      typeof nextGroupSequence === 'number' && Number.isInteger(nextGroupSequence) && nextGroupSequence > 0
        ? nextGroupSequence
        : 1,
    fileReferences,
    suppressedFileActivityEdgeIds,
    suppressedAutomaticFileArtifactNodeIds
  };
}

function App(): JSX.Element {
  const [hostState, setHostState] = useState<CanvasPrototypeState | null>(null);
  const [templateMenuEntries, setTemplateMenuEntries] = useState<CanvasTemplateMenuEntry[]>([]);
  const [runtimeContext, setRuntimeContext] = useState<CanvasRuntimeContext>({
    workspaceTrusted: false,
    surfaceLocation: latestRuntimeContext.surfaceLocation,
    defaultAgentProvider: latestRuntimeContext.defaultAgentProvider,
    agentLaunchDefaults: latestRuntimeContext.agentLaunchDefaults,
    strongTerminalAttentionReminderMode: latestRuntimeContext.strongTerminalAttentionReminderMode,
    terminalScrollback: latestRuntimeContext.terminalScrollback,
    editorMultiCursorModifier: latestRuntimeContext.editorMultiCursorModifier,
    terminalWordSeparators: latestRuntimeContext.terminalWordSeparators,
    overviewMode: latestRuntimeContext.overviewMode,
    overviewZoomThreshold: latestRuntimeContext.overviewZoomThreshold,
    multiRootPresentationMode: latestRuntimeContext.multiRootPresentationMode,
    workspaceRootWatermarksEnabled: latestRuntimeContext.workspaceRootWatermarksEnabled,
    filePresentationMode: latestRuntimeContext.filePresentationMode,
    fileNodeDisplayStyle: latestRuntimeContext.fileNodeDisplayStyle,
    fileNodeDisplayMode: latestRuntimeContext.fileNodeDisplayMode,
    filePathDisplayMode: latestRuntimeContext.filePathDisplayMode,
    fileIconFontFaces: latestRuntimeContext.fileIconFontFaces,
    workspaceFolders: latestRuntimeContext.workspaceFolders,
    noteMarkdownImageWorkspaceRoots: latestRuntimeContext.noteMarkdownImageWorkspaceRoots
  });
  const [localUiState, setLocalUiState] = useState<LocalUiState>(() => ({
    selectedNodeId: initialPersistedState.selectedNodeId,
    selectedNodeIds: Array.isArray(initialPersistedState.selectedNodeIds)
      ? initialPersistedState.selectedNodeIds.filter((nodeId): nodeId is string => typeof nodeId === 'string')
      : undefined,
    selectedGroupId: initialPersistedState.selectedGroupId,
    selectedGroupIds: Array.isArray(initialPersistedState.selectedGroupIds)
      ? initialPersistedState.selectedGroupIds.filter((groupId): groupId is string => typeof groupId === 'string')
      : undefined,
    viewport: initialPersistedState.viewport,
    fileListViewModes:
      initialPersistedState.fileListViewModes && typeof initialPersistedState.fileListViewModes === 'object'
        ? initialPersistedState.fileListViewModes
        : undefined,
    selectedFileListEntries:
      initialPersistedState.selectedFileListEntries && typeof initialPersistedState.selectedFileListEntries === 'object'
        ? Object.fromEntries(
            Object.entries(initialPersistedState.selectedFileListEntries).filter(
              (entry): entry is [string, string] => typeof entry[1] === 'string'
            )
          )
        : undefined,
    collapsedFileListTreeBranches:
      initialPersistedState.collapsedFileListTreeBranches &&
      typeof initialPersistedState.collapsedFileListTreeBranches === 'object'
        ? Object.fromEntries(
            Object.entries(initialPersistedState.collapsedFileListTreeBranches).flatMap(([nodeId, branchKeys]) =>
              Array.isArray(branchKeys)
                ? [[nodeId, branchKeys.filter((branchKey): branchKey is string => typeof branchKey === 'string')]]
                : []
            )
          )
        : undefined,
    paneGallery: normalizePaneGalleryLocalState(initialPersistedState.paneGallery)
  }));
  const pendingModifierNodeSelectionRef = useRef<{
    nodeId: string;
    baseSelectedNodeIds: string[];
  } | null>(null);
  const hostStateRef = useRef<CanvasPrototypeState | null>(hostState);
  const localUiStateRef = useRef<LocalUiState>(localUiState);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | undefined>();
  const [documentHasFocus, setDocumentHasFocus] = useState<boolean>(() => document.hasFocus());
  const [edgeLabelEditor, setEdgeLabelEditor] = useState<EdgeLabelEditorState | null>(null);
  const [edgeArrowMenuEdgeId, setEdgeArrowMenuEdgeId] = useState<string | undefined>();
  const [edgeColorMenuEdgeId, setEdgeColorMenuEdgeId] = useState<string | undefined>();
  const [nodeLayoutDrafts, setNodeLayoutDrafts] = useState<Record<string, CanvasNodeLayoutDraft>>({});
  const [nodeResizeDrafts, setNodeResizeDrafts] = useState<Record<string, CanvasNodeResizeDraft>>({});
  const pendingCommittedNodeLayoutDraftIdsRef = useRef<Set<string>>(new Set());
  const [groupDrafts, setGroupDrafts] = useState<Record<string, CanvasGroupDraft>>({});
  const activeGroupInteractionIdsRef = useRef<Set<string>>(new Set());
  const committedGroupDraftIdsRef = useRef<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<CanvasContextMenuState | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const clearErrorTimer = useRef<number | null>(null);
  const canvasShellRef = useRef<HTMLDivElement | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const reactFlowRef = useRef<ReactFlowInstance<CanvasNodeData> | null>(null);
  const paneGalleryFlowRefs = useRef<Record<string, ReactFlowInstance<CanvasNodeData> | undefined>>({});
  const paneGalleryShellRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const hostMessageHandlerRef = useRef<(message: HostToWebviewMessage) => void>(() => undefined);
  const pendingPaneGalleryMainNodeFitRootIdsRef = useRef<Set<string>>(new Set());
  const activeCanvasSurfaceRef = useRef<CanvasSurfaceBinding>({
    flow: reactFlowRef.current,
    shell: canvasShellRef.current,
    viewportKind: 'rootGroups'
  });
  const pendingViewportRequestRef = useRef<PendingNodeViewportRequest | undefined>();
  const pendingNodeGroupViewportRequestRef = useRef<PendingNodeGroupViewportRequest | undefined>();
  const pendingNodeGroupViewportRetryTimeoutRef = useRef<number | undefined>();
  const pendingManualCreateRequestRef = useRef<PendingManualNodeCreateRequest | undefined>();
  const latestHostNodeIdsRef = useRef<Set<string>>(new Set());
  const pendingViewportSyncTimeoutRef = useRef<number | undefined>();
  const groupDragAutoPanRef = useRef<AutoPanController | null>(null);
  const groupResizeAutoPanRef = useRef<AutoPanController | null>(null);
  const nodeResizeAutoPanRef = useRef<AutoPanController | null>(null);
  const activeNodeResizeDraftsRef = useRef<Record<string, CanvasNodeLayoutDraft>>({});
  const [reactFlowReadyVersion, setReactFlowReadyVersion] = useState(0);
  const didApplyInitialCanvasFitRef = useRef(Boolean(initialPersistedState.viewport));
  const [canvasViewportSize, setCanvasViewportSize] = useState<CanvasViewportSize>(() => ({
    width: Math.max(1, window.innerWidth),
    height: Math.max(1, window.innerHeight)
  }));
  const [canvasOverviewMode, setCanvasOverviewMode] = useState(
    () =>
      latestRuntimeContext.overviewMode !== 'none' &&
      (initialPersistedState.viewport?.zoom ?? 1) < latestRuntimeContext.overviewZoomThreshold
  );
  const [canvasOverviewTitleScale, setCanvasOverviewTitleScale] = useState(() =>
    resolveCanvasOverviewTitleScale(initialPersistedState.viewport?.zoom ?? 1)
  );

  hostMessageHandlerRef.current = (message: HostToWebviewMessage): void => {
    const messageLifecycle = extractWebviewMessageLifecycle(message);
    if (requiresHostMessageLifecycle(message.type) && !messageLifecycle) {
      emitWebviewLifecycleDiagnostic(`ignore host message without lifecycle: ${message.type}`);
      return;
    }

    if (messageLifecycle && !isCurrentWebviewLifecycleIdentity(messageLifecycle)) {
      emitWebviewLifecycleDiagnostic(`ignore host message with mismatched lifecycle: ${message.type}`);
      return;
    }

    switch (message.type) {
      case 'host/bootstrap':
      case 'host/stateUpdated':
        {
          const normalizedState = normalizeCanvasPrototypeState(message.payload.state);
          const normalizedRuntime = normalizeRuntimeContext(message.payload.runtime);
          hostStateRef.current = normalizedState;
          latestHostNodeIdsRef.current = new Set(normalizedState.nodes.map((node) => node.id));
          latestRuntimeContext = normalizedRuntime;
          setHostState(normalizedState);
          setRuntimeContext(normalizedRuntime);
          setNodeLayoutDrafts((current) => {
            // Host layout wins after a move/resize has been submitted.
            const pendingNodeIds = pendingCommittedNodeLayoutDraftIdsRef.current;
            if (pendingNodeIds.size === 0) {
              return current;
            }

            const next = { ...current };
            for (const nodeId of pendingNodeIds) {
              delete next[nodeId];
            }
            pendingNodeIds.clear();
            return shallowEqualCanvasNodeLayoutDrafts(current, next) ? current : next;
          });
          setNodeResizeDrafts((current) => (Object.keys(current).length > 0 ? {} : current));
          activeNodeResizeDraftsRef.current = {};
          setGroupDrafts((current) => {
            const activeGroupIds = activeGroupInteractionIdsRef.current;
            const committedGroupIds = committedGroupDraftIdsRef.current;
            const knownGroupIds = new Set(normalizedState.groups.map((group) => group.id));
            for (const groupId of Array.from(activeGroupIds)) {
              if (!knownGroupIds.has(groupId)) {
                activeGroupIds.delete(groupId);
              }
            }

            const next = Object.fromEntries(
              Object.entries(current).filter(([groupId]) =>
                knownGroupIds.has(groupId) &&
                activeGroupIds.has(groupId) &&
                !committedGroupIds.has(groupId)
              )
            );
            committedGroupIds.clear();
            return shallowEqualCanvasGroupDrafts(current, next) ? current : next;
          });
          applyEmbeddedTerminalRuntimeContext(normalizedRuntime);
          if (message.type === 'host/bootstrap') {
            postMessage({ type: 'webview/bootstrapAck' });
          }
        }
        scheduleEmbeddedTerminalAppearanceRefresh();
        break;
      case 'host/templateCatalogUpdated':
        setTemplateMenuEntries(Array.isArray(message.payload.templates) ? message.payload.templates : []);
        break;
      case 'host/themeChanged':
        scheduleEmbeddedTerminalAppearanceRefresh();
        break;
      case 'host/visibilityRestored':
        scheduleExecutionTerminalVisibilityRestore();
        if (message.payload?.restoreFocus !== false) {
          scheduleCanvasShellFocusRestore(canvasShellRef.current, latestRuntimeContext.surfaceLocation);
        }
        break;
      case 'host/focusNode':
        requestNodeFocus(message.payload.nodeId);
        break;
      case 'host/centerNode':
        requestNodeCenter(message.payload.nodeId);
        break;
      case 'host/focusNodes':
        requestNodeGroupFocus(message.payload.nodeIds);
        break;
      case 'host/focusGroup':
        requestGroupFocus(message.payload.groupId);
        break;
      case 'host/executionSnapshot':
        routeExecutionTerminalSnapshot({
          type: 'snapshot',
          nodeId: message.payload.nodeId,
          kind: message.payload.kind,
          output: message.payload.output,
          cols: message.payload.cols,
          rows: message.payload.rows,
          liveSession: message.payload.liveSession,
          requestId: message.payload.requestId,
          executionSessionId: message.payload.executionSessionId,
          outputSequence: message.payload.outputSequence,
          serializedTerminalState: message.payload.serializedTerminalState
        });
        break;
      case 'host/executionOutput':
        queueExecutionTerminalOutput({
          type: 'output',
          nodeId: message.payload.nodeId,
          kind: message.payload.kind,
          chunk: message.payload.chunk,
          executionSessionId: message.payload.executionSessionId,
          persisted: message.payload.persisted,
          outputSequence: message.payload.outputSequence
        });
        break;
      case 'host/executionInputAck':
        handleExecutionInputAck(message.payload);
        break;
      case 'host/executionExit':
        routeExecutionTerminalExit({
          type: 'exit',
          nodeId: message.payload.nodeId,
          kind: message.payload.kind,
          message: message.payload.message
        });
        break;
      case 'host/executionFileLinksResolved':
        resolvePendingExecutionFileLinkResolutionRequest(
          message.payload.requestId,
          message.payload.resolvedLinks
        );
        break;
      case 'host/executionPasteText':
        routeExecutionPasteText(
          message.payload.requestId,
          message.payload.nodeId,
          message.payload.kind,
          message.payload.text
        );
        break;
      case 'host/executionPasteCancelled':
        clearPendingExecutionPasteRequest(
          message.payload.requestId,
          message.payload.nodeId,
          message.payload.kind
        );
        break;
      case 'host/error':
        if (message.payload.createRequestId === pendingManualCreateRequestRef.current?.requestId) {
          pendingManualCreateRequestRef.current = undefined;
        }
        showTransientCanvasError(message.payload.message);
        break;
      case 'host/requestCreateNode':
        // Host commands have already passed workspace-trust validation; the host still rejects if trust changes.
        createNode(
          message.payload.kind,
          undefined,
          message.payload.targetGroupId,
          message.payload.agentProvider,
          message.payload.agentLaunchPreset,
          message.payload.agentCustomLaunchCommand,
          {
            skipWorkspaceTrustCheck: true,
            cwd: message.payload.cwd,
            useDefaultPlacement: Boolean(message.payload.targetGroupId || message.payload.cwd)
          }
        );
        break;
      case 'host/requestCreateGroupFromSelection':
        createGroupFromCurrentSelectionRequest();
        break;
      case 'host/testProbeRequest':
        void respondWithWebviewProbeSnapshot(message.payload.requestId, message.payload.delayMs);
        break;
      case 'host/testDomAction':
        void performWebviewDomAction(message.payload.requestId, message.payload.action);
        break;
    }
  };

  useEffect(() => {
    const listener = (event: MessageEvent<HostToWebviewMessage>): void => {
      hostMessageHandlerRef.current(event.data);
    };
    window.addEventListener('message', listener);
    postMessage({ type: 'webview/ready' });

    return () => {
      window.removeEventListener('message', listener);
      if (clearErrorTimer.current) {
        window.clearTimeout(clearErrorTimer.current);
      }
      rejectPendingExecutionFileLinkResolutionRequests('Webview disposed before execution file links were resolved.');
      clearPendingExecutionPasteRequests();
    };
  }, []);

  useEffect(() => {
    latestRuntimeContext = runtimeContext;
  }, [runtimeContext]);

  useEffect(() => {
    return applyFileIconFontFaces(runtimeContext.fileIconFontFaces);
  }, [runtimeContext.fileIconFontFaces]);

  useEffect(() => {
    ensureEmbeddedTerminalThemeObservers();
    scheduleEmbeddedTerminalAppearanceRefresh();

    return () => {
      embeddedTerminalThemeObserverDispose?.();
      embeddedTerminalThemeObserverDispose = undefined;
    };
  }, []);

  useEffect(() => {
    const handleFocus = (): void => {
      setDocumentHasFocus(true);
    };
    const handleBlur = (): void => {
      setDocumentHasFocus(false);
    };
    const handleVisibilityChange = (): void => {
      setDocumentHasFocus(document.hasFocus());
      if (!document.hidden && pendingExecutionTerminalDrains.size > 0) {
        lastExecutionVisibilityRestoredAtMs = readPerformanceNow();
        scheduleExecutionTerminalDrainPump();
      }
      if (!document.hidden && pendingExecutionTerminalSnapshotWrites.length > 0) {
        lastExecutionVisibilityRestoredAtMs = readPerformanceNow();
        scheduleExecutionTerminalSnapshotWritePump();
      }
    };

    window.addEventListener('focus', handleFocus);
    window.addEventListener('blur', handleBlur);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('blur', handleBlur);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  useLayoutEffect(() => {
    const element = canvasShellRef.current;
    if (!element) {
      return;
    }

    const updateCanvasViewportSize = (): void => {
      const nextSize = {
        width: Math.max(1, Math.round(element.clientWidth || window.innerWidth)),
        height: Math.max(1, Math.round(element.clientHeight || window.innerHeight))
      };
      setCanvasViewportSize((current) =>
        current.width === nextSize.width && current.height === nextSize.height ? current : nextSize
      );
    };

    updateCanvasViewportSize();

    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(updateCanvasViewportSize);
      observer.observe(element);
      return () => {
        observer.disconnect();
      };
    }

    window.addEventListener('resize', updateCanvasViewportSize);
    return () => {
      window.removeEventListener('resize', updateCanvasViewportSize);
    };
  }, []);

  useEffect(() => {
    localUiStateRef.current = localUiState;
    vscode.setState(localUiState);
  }, [localUiState]);

  useEffect(() => {
    if (!hostState) {
      return;
    }

    const validNodeIds = new Set(hostState.nodes.map((node) => node.id));
    const validFileListNodeIds = new Set(
      hostState.nodes.filter((node) => node.kind === 'file-list').map((node) => node.id)
    );
    const validFileListEntryPathsByNodeId = new Map<string, Set<string>>(
      hostState.nodes
        .filter((node) => node.kind === 'file-list')
        .map((node) => [
          node.id,
          new Set(node.metadata?.fileList?.entries.map((entry) => entry.filePath) ?? [])
        ])
    );
    const validFileListTreeBranchKeysByNodeId = new Map<string, Set<string>>(
      hostState.nodes
        .filter((node) => node.kind === 'file-list')
        .map((node) => [
          node.id,
          collectFileListTreeBranchKeys(buildFileListTree(node.metadata?.fileList?.entries ?? []).branches)
        ])
    );
    const validEdgeIds = new Set(hostState.edges.map((edge) => edge.id));
    const validGroupIds = new Set((hostState.groups ?? []).map((group) => group.id));
    setLocalUiState((current) => {
      let changed = false;
      let nextState = current;

      if (current.selectedNodeId && !validNodeIds.has(current.selectedNodeId)) {
        nextState = {
          ...nextState,
          selectedNodeId: undefined
        };
        changed = true;
      }

      if (current.selectedNodeIds) {
        const selectedNodeIds = current.selectedNodeIds.filter((nodeId) => validNodeIds.has(nodeId));
        if (selectedNodeIds.length !== current.selectedNodeIds.length) {
          nextState = {
            ...nextState,
            selectedNodeIds: selectedNodeIds.length > 0 ? selectedNodeIds : undefined
          };
          changed = true;
        }
      }

      if (current.selectedGroupId && !validGroupIds.has(current.selectedGroupId)) {
        nextState = {
          ...nextState,
          selectedGroupId: undefined
        };
        changed = true;
      }

      if (current.selectedGroupIds) {
        const selectedGroupIds = current.selectedGroupIds.filter((groupId) => validGroupIds.has(groupId));
        if (selectedGroupIds.length !== current.selectedGroupIds.length) {
          nextState = {
            ...nextState,
            selectedGroupIds: selectedGroupIds.length > 0 ? selectedGroupIds : undefined
          };
          changed = true;
        }
      }

      const currentViewModes = current.fileListViewModes;
      if (currentViewModes) {
        const filteredEntries = Object.entries(currentViewModes).filter(([nodeId]) => validFileListNodeIds.has(nodeId));
        if (filteredEntries.length !== Object.keys(currentViewModes).length) {
          nextState = {
            ...nextState,
            fileListViewModes: filteredEntries.length > 0 ? Object.fromEntries(filteredEntries) : undefined
          };
          changed = true;
        }
      }

      const currentSelectedFileEntries = current.selectedFileListEntries;
      if (currentSelectedFileEntries) {
        const filteredEntries = Object.entries(currentSelectedFileEntries).filter(([nodeId, filePath]) =>
          validFileListEntryPathsByNodeId.get(nodeId)?.has(filePath)
        );
        if (filteredEntries.length !== Object.keys(currentSelectedFileEntries).length) {
          nextState = {
            ...nextState,
            selectedFileListEntries: filteredEntries.length > 0 ? Object.fromEntries(filteredEntries) : undefined
          };
          changed = true;
        }
      }

      const currentCollapsedBranches = current.collapsedFileListTreeBranches;
      if (currentCollapsedBranches) {
        const filteredEntries: Array<[string, string[]]> = [];
        for (const [nodeId, branchKeys] of Object.entries(currentCollapsedBranches)) {
          const validBranchKeys = validFileListTreeBranchKeysByNodeId.get(nodeId);
          if (!validBranchKeys || !Array.isArray(branchKeys)) {
            continue;
          }

          const nextBranchKeys = branchKeys.filter((branchKey) => validBranchKeys.has(branchKey));
          if (nextBranchKeys.length > 0) {
            filteredEntries.push([nodeId, nextBranchKeys]);
          }
        }
        const collapsedBranchesChanged =
          filteredEntries.length !== Object.keys(currentCollapsedBranches).length ||
          filteredEntries.some(
            ([nodeId, nextBranchKeys]) =>
              nextBranchKeys.length !== (Array.isArray(currentCollapsedBranches[nodeId]) ? currentCollapsedBranches[nodeId].length : 0)
          );
        if (collapsedBranchesChanged) {
          nextState = {
            ...nextState,
            collapsedFileListTreeBranches:
              filteredEntries.length > 0 ? Object.fromEntries(filteredEntries) : undefined
          };
          changed = true;
        }
      }

      return changed ? nextState : current;
    });
    setSelectedEdgeId((current) => (current && !validEdgeIds.has(current) ? undefined : current));
    setEdgeLabelEditor((current) => (current && !validEdgeIds.has(current.edgeId) ? null : current));
    setEdgeArrowMenuEdgeId((current) => (current && !validEdgeIds.has(current) ? undefined : current));
    setEdgeColorMenuEdgeId((current) => (current && !validEdgeIds.has(current) ? undefined : current));
  }, [hostState]);

  useEffect(() => {
    if (!contextMenu || contextMenu.view !== 'root') {
      return;
    }

    const selectedNodeIds = contextMenu.selectedNodeIds ?? [];
    const selectedGroupIds = contextMenu.selectedGroupIds ?? [];
    const nextCanCreateGroupFromSelection = canCreateCanvasGroupFromSelection(
      hostState,
      selectedNodeIds,
      selectedGroupIds,
      contextMenu.targetGroupId
    );
    if (contextMenu.canCreateGroupFromSelection === nextCanCreateGroupFromSelection) {
      return;
    }

    setContextMenu((current) =>
      current
        ? {
            ...current,
            canCreateGroupFromSelection: nextCanCreateGroupFromSelection
          }
        : current
    );
  }, [contextMenu, hostState]);

  useEffect(() => {
    setEdgeLabelEditor((current) => (current && current.edgeId !== selectedEdgeId ? null : current));
    setEdgeArrowMenuEdgeId((current) => (current && current !== selectedEdgeId ? undefined : current));
    setEdgeColorMenuEdgeId((current) => (current && current !== selectedEdgeId ? undefined : current));
  }, [selectedEdgeId]);

  useEffect(() => {
    return () => {
      if (pendingViewportSyncTimeoutRef.current !== undefined) {
        window.clearTimeout(pendingViewportSyncTimeoutRef.current);
      }
      clearPendingNodeGroupViewportRetryTimeout();
      groupDragAutoPanRef.current?.stop();
      groupDragAutoPanRef.current = null;
      groupResizeAutoPanRef.current?.stop();
      groupResizeAutoPanRef.current = null;
      nodeResizeAutoPanRef.current?.stop();
      nodeResizeAutoPanRef.current = null;
    };
  }, []);

  useEffect(() => {
    const pendingViewportRequest = pendingViewportRequestRef.current;
    if (!pendingViewportRequest || !isPendingViewportTargetAvailable(hostState, pendingViewportRequest)) {
      return;
    }

    const didApply = pendingViewportRequest.selectNode
      ? focusNodeInViewport(pendingViewportRequest.objectId, pendingViewportRequest.mode)
      : pendingViewportRequest.objectKind === 'group'
        ? centerGroupInViewport(pendingViewportRequest.objectId)
        : centerNodeInViewport(pendingViewportRequest.objectId, pendingViewportRequest.mode);
    if (didApply) {
      pendingViewportRequestRef.current = undefined;
      if (pendingViewportRequest.selectNode) {
        scheduleCanvasShellFocusRestore(canvasShellRef.current, latestRuntimeContext.surfaceLocation);
      }
    }
  }, [hostState, reactFlowReadyVersion]);

  useEffect(() => {
    const pendingNodeGroupViewportRequest = pendingNodeGroupViewportRequestRef.current;
    if (
      !pendingNodeGroupViewportRequest ||
      !hostState ||
      !pendingNodeGroupViewportRequest.nodeIds.every((nodeId) =>
        hostState.nodes.some((node) => node.id === nodeId)
      )
    ) {
      return;
    }

    if (focusNodeGroupInViewport(pendingNodeGroupViewportRequest.nodeIds)) {
      pendingNodeGroupViewportRequestRef.current = undefined;
      clearPendingNodeGroupViewportRetryTimeout();
      return;
    }

    schedulePendingNodeGroupViewportRetry();
  }, [hostState, reactFlowReadyVersion]);

  useEffect(() => {
    if (!hostState) {
      return;
    }

    const pendingManualCreateRequest = pendingManualCreateRequestRef.current;
    if (pendingManualCreateRequest) {
      const createdNode = resolvePendingManualNodeCreateTarget(
        hostState,
        hostState.nodes,
        pendingManualCreateRequest.knownNodeIdsSnapshot,
        pendingManualCreateRequest
      );
      if (createdNode) {
        requestNodeFocus(createdNode.id, 'center-no-extra-zoom-if-visible');
        pendingManualCreateRequestRef.current = undefined;
      }
    }
  }, [hostState]);

  const workspaceTrusted = runtimeContext.workspaceTrusted;
  const creatableKinds: CanvasCreatableNodeKind[] = ['agent', 'terminal', 'note'];

  const closePaneContextMenu = (): void => {
    setContextMenu(null);
  };

  const closeEdgeArrowMenu = (): void => {
    setEdgeArrowMenuEdgeId(undefined);
  };

  const closeEdgeColorMenu = (): void => {
    setEdgeColorMenuEdgeId(undefined);
  };

  const closeEdgeMenus = (): void => {
    closeEdgeArrowMenu();
    closeEdgeColorMenu();
  };

  const closeFloatingMenus = (): void => {
    closePaneContextMenu();
    closeEdgeMenus();
  };

  const clearCanvasTransientInteractionState = (): void => {
    closeFloatingMenus();
    setSelectedEdgeId(undefined);
    setEdgeLabelEditor(null);
    setEdgeArrowMenuEdgeId(undefined);
    setEdgeColorMenuEdgeId(undefined);
    setLocalUiState((current) => {
      const nextState = {
        ...current,
        selectedNodeId: undefined,
        selectedNodeIds: undefined,
        selectedGroupId: undefined,
        selectedGroupIds: undefined
      };
      localUiStateRef.current = nextState;
      return nextState;
    });
  };

  const deleteNode = (nodeId: string): void => {
    setLocalUiState((current) => ({
      ...current,
      selectedNodeId: current.selectedNodeId === nodeId ? undefined : current.selectedNodeId,
      selectedNodeIds: current.selectedNodeIds?.filter((selectedNodeId) => selectedNodeId !== nodeId),
      selectedGroupId: undefined,
      selectedGroupIds: undefined
    }));
    closeFloatingMenus();
    postMessage({
      type: 'webview/deleteNode',
      payload: {
        nodeId
      }
    });
  };

  const deleteEdge = (edgeId: string): void => {
    setLocalUiState((current) => ({
      ...current,
      selectedNodeIds: current.selectedNodeId ? [current.selectedNodeId] : undefined,
      selectedGroupId: undefined,
      selectedGroupIds: undefined
    }));
    setEdgeLabelEditor((current) => (current?.edgeId === edgeId ? null : current));
    setEdgeArrowMenuEdgeId((current) => (current === edgeId ? undefined : current));
    setEdgeColorMenuEdgeId((current) => (current === edgeId ? undefined : current));
    setSelectedEdgeId((current) => (current === edgeId ? undefined : current));
    postMessage({
      type: 'webview/deleteEdge',
      payload: {
        edgeId
      }
    });
  };

  const startEdgeLabelEdit = (edgeId: string): void => {
    const edge = hostState?.edges.find((candidate) => candidate.id === edgeId);
    if (!edge) {
      return;
    }

    closePaneContextMenu();
    setSelectedEdgeId(edgeId);
    closeEdgeMenus();
    setEdgeLabelEditor({ edgeId });
  };

  const submitEdgeLabelEdit = (edgeId: string, label: string): void => {
    setEdgeLabelEditor((current) => {
      if (!current || current.edgeId !== edgeId) {
        return current;
      }

      postMessage({
        type: 'webview/updateEdge',
        payload: {
          edgeId,
          label
        }
      });
      return null;
    });
  };

  const cancelEdgeLabelEdit = (edgeId: string): void => {
    setEdgeLabelEditor((current) => (current?.edgeId === edgeId ? null : current));
  };

  const setEdgeArrowMode = (edgeId: string, arrowMode: CanvasEdgeArrowMode): void => {
    closeEdgeMenus();
    postMessage({
      type: 'webview/updateEdge',
      payload: {
        edgeId,
        arrowMode
      }
    });
  };

  const setEdgeColor = (edgeId: string, color: CanvasEdgeColor | null): void => {
    closeEdgeMenus();
    postMessage({
      type: 'webview/updateEdge',
      payload: {
        edgeId,
        color
      }
    });
  };

  const fitPaneGalleryNodesInViewport = (
    rootGroupId: string,
    nodeIds: readonly string[],
    mode: NodeViewportFocusMode = 'fit',
    duration = NODE_FOCUS_ANIMATION_DURATION_MS,
    viewportRole?: PaneGalleryViewportRole
  ): boolean => {
    const resolvedViewportRole =
      viewportRole ??
      resolvePaneGalleryViewportRole(
        normalizePaneGalleryLayoutMode(localUiStateRef.current.paneGallery?.layout) ??
          PANE_GALLERY_DEFAULT_OVERVIEW_LAYOUT
      );
    const binding: CanvasSurfaceBinding = {
      flow: paneGalleryFlowRefs.current[rootGroupId],
      shell: paneGalleryShellRefs.current[rootGroupId],
      viewportKind: 'paneGallery',
      rootGroupId,
      paneGalleryViewportRole: resolvedViewportRole
    };
    activeCanvasSurfaceRef.current = binding;
    const reactFlowInstance = binding.flow;
    if (!reactFlowInstance?.viewportInitialized || nodeIds.length === 0) {
      return false;
    }

    const didFit =
      nodeIds.length === 1 && mode === 'center-no-extra-zoom-if-visible'
        ? centerNodeInViewportWithoutExtraZoomIfPossible(
            reactFlowInstance,
            binding.shell,
            hostStateRef.current,
            nodeIds[0],
            duration
          )
        : reactFlowInstance.fitView({
            nodes: nodeIds.map((id) => ({ id })),
            padding: NODE_FOCUS_VIEW_PADDING,
            maxZoom: NODE_FOCUS_MAX_ZOOM,
            minZoom: PANE_GALLERY_MIN_ZOOM,
            duration
          });
    if (didFit) {
      window.setTimeout(() => {
        const viewport = reactFlowInstance.getViewport();
        savePaneGalleryViewport(rootGroupId, viewport, resolvedViewportRole);
      }, duration + NODE_FOCUS_VIEWPORT_SYNC_GRACE_MS);
    }
    return didFit;
  };

  const schedulePaneGalleryNodeFit = (
    rootGroupId: string,
    nodeIds: readonly string[],
    mode: NodeViewportFocusMode = 'fit',
    viewportRole?: PaneGalleryViewportRole,
    options: { onApplied?: () => void; onExpired?: () => void } = {}
  ): void => {
    let remainingAttempts = 6;
    const tryFit = (): void => {
      if (fitPaneGalleryNodesInViewport(rootGroupId, nodeIds, mode, NODE_FOCUS_ANIMATION_DURATION_MS, viewportRole)) {
        options.onApplied?.();
        return;
      }
      remainingAttempts -= 1;
      if (remainingAttempts > 0) {
        window.setTimeout(tryFit, 50);
        return;
      }

      options.onExpired?.();
    };

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(tryFit);
    });
  };

  const fitPaneGalleryGroupInViewport = (
    rootGroupId: string,
    groupId: string,
    duration = NODE_FOCUS_ANIMATION_DURATION_MS,
    viewportRole?: PaneGalleryViewportRole
  ): boolean => {
    const resolvedViewportRole =
      viewportRole ??
      resolvePaneGalleryViewportRole(
        normalizePaneGalleryLayoutMode(localUiStateRef.current.paneGallery?.layout) ??
          PANE_GALLERY_DEFAULT_OVERVIEW_LAYOUT
      );
    const reactFlowInstance = paneGalleryFlowRefs.current[rootGroupId];
    const shell = paneGalleryShellRefs.current[rootGroupId];
    const group = groups.find((candidate) => candidate.id === groupId);
    activeCanvasSurfaceRef.current = {
      flow: reactFlowInstance,
      shell,
      viewportKind: 'paneGallery',
      rootGroupId,
      paneGalleryViewportRole: resolvedViewportRole
    };
    if (!reactFlowInstance?.viewportInitialized || !shell || !group) {
      return false;
    }

    const viewport = getViewportForBounds(
      rectForGroupLike(group),
      Math.max(1, shell.clientWidth),
      Math.max(1, shell.clientHeight),
      PANE_GALLERY_MIN_ZOOM,
      NODE_FOCUS_MAX_ZOOM,
      NODE_FOCUS_VIEW_PADDING
    );
    reactFlowInstance.setViewport(viewport, { duration });
    savePaneGalleryViewport(rootGroupId, viewport, resolvedViewportRole);
    return true;
  };

  const schedulePaneGalleryGroupFit = (
    rootGroupId: string,
    groupId: string,
    viewportRole?: PaneGalleryViewportRole
  ): void => {
    let remainingAttempts = 6;
    const tryFit = (): void => {
      if (fitPaneGalleryGroupInViewport(rootGroupId, groupId, NODE_FOCUS_ANIMATION_DURATION_MS, viewportRole)) {
        return;
      }
      remainingAttempts -= 1;
      if (remainingAttempts > 0) {
        window.setTimeout(tryFit, 50);
      }
    };

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(tryFit);
    });
  };

  const resolveSurfaceForNode = (nodeId: string): CanvasSurfaceBinding => {
    if (isPaneGalleryPresentation) {
      const node = hostStateRef.current?.nodes.find((candidate) => candidate.id === nodeId);
      const rootGroupId = node
        ? resolveContainingWorkspaceRootGroupIdForWebview(groups, node.groupId)
        : undefined;
      if (rootGroupId) {
        return {
          flow: paneGalleryFlowRefs.current[rootGroupId],
          shell: paneGalleryShellRefs.current[rootGroupId],
          viewportKind: 'paneGallery',
          rootGroupId,
          paneGalleryViewportRole: resolvePaneGalleryViewportRole(
            normalizePaneGalleryLayoutMode(localUiStateRef.current.paneGallery?.layout) ??
              PANE_GALLERY_DEFAULT_OVERVIEW_LAYOUT
          )
        };
      }
    }

    return {
      flow: reactFlowRef.current,
      shell: canvasShellRef.current,
      viewportKind: 'rootGroups'
    };
  };

  const moveNodeIntoViewport = (nodeId: string, mode: NodeViewportFocusMode = 'fit'): boolean => {
    if (isPaneGalleryPresentation) {
      const node = hostStateRef.current?.nodes.find((candidate) => candidate.id === nodeId);
      const rootGroupId = node
        ? resolveContainingWorkspaceRootGroupIdForWebview(groups, node.groupId)
        : undefined;
      if (!rootGroupId) {
        return false;
      }

      if (fitPaneGalleryNodesInViewport(rootGroupId, [nodeId], mode)) {
        return true;
      }

      pendingPaneGalleryMainNodeFitRootIdsRef.current.add(rootGroupId);
      updatePaneGalleryLayout('sideThumbnails', rootGroupId, { fitRoot: false });
      schedulePaneGalleryNodeFit(rootGroupId, [nodeId], mode, 'main', {
        onApplied: () => {
          window.setTimeout(() => {
            pendingPaneGalleryMainNodeFitRootIdsRef.current.delete(rootGroupId);
          }, NODE_FOCUS_ANIMATION_DURATION_MS + NODE_FOCUS_VIEWPORT_SYNC_GRACE_MS);
        },
        onExpired: () => pendingPaneGalleryMainNodeFitRootIdsRef.current.delete(rootGroupId)
      });
      return true;
    }

    const binding = resolveSurfaceForNode(nodeId);
    const reactFlowInstance = binding.flow;
    if (!reactFlowInstance?.viewportInitialized) {
      return false;
    }

    activeCanvasSurfaceRef.current = binding;
    return mode === 'center-no-extra-zoom-if-visible'
      ? centerNodeInViewportWithoutExtraZoomIfPossible(
          reactFlowInstance,
          binding.shell,
          hostState,
          nodeId,
          NODE_FOCUS_ANIMATION_DURATION_MS
        )
      : reactFlowInstance.fitView({
          nodes: [{ id: nodeId }],
          padding: NODE_FOCUS_VIEW_PADDING,
          maxZoom: NODE_FOCUS_MAX_ZOOM,
          minZoom: NODE_FOCUS_MIN_ZOOM,
          duration: NODE_FOCUS_ANIMATION_DURATION_MS
        });
  };

  const focusNodeInViewport = (nodeId: string, mode: NodeViewportFocusMode = 'fit'): boolean => {
    if (!moveNodeIntoViewport(nodeId, mode)) {
      return false;
    }

    closeFloatingMenus();
    setSelectedEdgeId(undefined);
    setLocalUiState((current) => ({
      ...current,
      selectedNodeId: nodeId
    }));
    scheduleFocusedViewportPersistence();
    return true;
  };

  const centerNodeInViewport = (nodeId: string, mode: NodeViewportFocusMode = 'fit'): boolean => {
    if (!moveNodeIntoViewport(nodeId, mode)) {
      return false;
    }

    scheduleFocusedViewportPersistence();
    return true;
  };

  const centerGroupInViewport = (groupId: string): boolean => {
    if (isPaneGalleryPresentation) {
      const group = (hostStateRef.current?.groups ?? []).find((candidate) => candidate.id === groupId);
      const rootGroupId = group
        ? resolveContainingWorkspaceRootGroupIdForWebview(groups, group.id) ??
          (isWorkspaceRootCanvasGroupRole(group.role) ? group.id : undefined)
        : undefined;
      if (!group || !rootGroupId) {
        return false;
      }

      updatePaneGalleryLayout('sideThumbnails', rootGroupId, { fitRoot: false });
      closeFloatingMenus();
      setSelectedEdgeId(undefined);
      setLocalUiState((current) => {
        const lastOverviewLayout = resolvePaneGalleryLastOverviewLayout(current.paneGallery);
        const nextState = {
          ...current,
          selectedNodeId: undefined,
          selectedNodeIds: undefined,
          selectedGroupId: groupId,
          selectedGroupIds: [groupId],
          paneGallery: {
            ...(current.paneGallery ?? {}),
            layout: 'sideThumbnails' as const,
            activeRootGroupId: rootGroupId,
            lastOverviewLayout,
            lastThumbnailLayout: 'sideThumbnails' as const
          }
        };
        localUiStateRef.current = nextState;
        return nextState;
      });
      schedulePaneGalleryGroupFit(rootGroupId, groupId, 'main');
      return true;
    }

    const reactFlowInstance = reactFlowRef.current;
    const group = (hostStateRef.current?.groups ?? []).find((candidate) => candidate.id === groupId);
    if (!reactFlowInstance?.viewportInitialized || !group) {
      return false;
    }

    const targetViewport = resolveViewportForCanvasRect(
      rectForGroupLike(group),
      canvasViewportSize,
      dynamicCanvasMinZoom
    );
    if (!targetViewport) {
      return false;
    }

    reactFlowInstance.setViewport(targetViewport, { duration: NODE_FOCUS_ANIMATION_DURATION_MS });
    closeFloatingMenus();
    setSelectedEdgeId(undefined);
    setLocalUiState((current) => ({
      ...current,
      selectedNodeId: undefined,
      selectedNodeIds: undefined,
      selectedGroupId: groupId,
      selectedGroupIds: [groupId],
      viewport: targetViewport
    }));
    scheduleFocusedViewportPersistence();
    postCanvasViewportCenter(targetViewport);
    return true;
  };

  const normalizeNodeGroupFocusIds = (nodeIds: readonly string[]): string[] => {
    return Array.from(
      new Set(nodeIds.filter((nodeId) => typeof nodeId === 'string' && nodeId.trim().length > 0))
    );
  };

  const focusNodeGroupInViewport = (nodeIds: readonly string[]): boolean => {
    const targetNodeIds = normalizeNodeGroupFocusIds(nodeIds);
    if (isPaneGalleryPresentation) {
      if (!hostState || targetNodeIds.length === 0) {
        return false;
      }

      const rootGroupIds = new Set(
        targetNodeIds.flatMap((nodeId) => {
          const node = hostState.nodes.find((candidate) => candidate.id === nodeId);
          const rootGroupId = node
            ? resolveContainingWorkspaceRootGroupIdForWebview(groups, node.groupId)
            : undefined;
          return rootGroupId ? [rootGroupId] : [];
        })
      );
      if (rootGroupIds.size !== 1) {
        return false;
      }

      const rootGroupId = [...rootGroupIds][0];
      if (fitPaneGalleryNodesInViewport(rootGroupId, targetNodeIds)) {
        closeFloatingMenus();
        setSelectedEdgeId(undefined);
        return true;
      }

      updatePaneGalleryLayout('sideThumbnails', rootGroupId, { fitRoot: false });
      closeFloatingMenus();
      setSelectedEdgeId(undefined);
      schedulePaneGalleryNodeFit(rootGroupId, targetNodeIds, 'fit', 'main');
      return true;
    }

    const reactFlowInstance = reactFlowRef.current;
    if (!reactFlowInstance?.viewportInitialized || targetNodeIds.length === 0) {
      return false;
    }

    const knownNodeIds = latestHostNodeIdsRef.current;
    if (!targetNodeIds.every((nodeId) => knownNodeIds.has(nodeId))) {
      return false;
    }

    const didFit = reactFlowInstance.fitView({
      nodes: targetNodeIds.map((id) => ({ id })),
      padding: NODE_FOCUS_VIEW_PADDING,
      maxZoom: NODE_FOCUS_MAX_ZOOM,
      minZoom: NODE_FOCUS_MIN_ZOOM,
      duration: NODE_FOCUS_ANIMATION_DURATION_MS
    });
    if (!didFit) {
      return false;
    }

    closeFloatingMenus();
    setSelectedEdgeId(undefined);
    scheduleFocusedViewportPersistence();
    return true;
  };

  const clearPendingNodeGroupViewportRetryTimeout = (): void => {
    if (pendingNodeGroupViewportRetryTimeoutRef.current === undefined) {
      return;
    }

    window.clearTimeout(pendingNodeGroupViewportRetryTimeoutRef.current);
    pendingNodeGroupViewportRetryTimeoutRef.current = undefined;
  };

  const schedulePendingNodeGroupViewportRetry = (): void => {
    const pendingNodeGroupViewportRequest = pendingNodeGroupViewportRequestRef.current;
    if (
      !pendingNodeGroupViewportRequest ||
      pendingNodeGroupViewportRequest.retryCount >= NODE_GROUP_FOCUS_MAX_RETRY_COUNT ||
      pendingNodeGroupViewportRetryTimeoutRef.current !== undefined
    ) {
      return;
    }

    pendingNodeGroupViewportRequestRef.current = {
      ...pendingNodeGroupViewportRequest,
      retryCount: pendingNodeGroupViewportRequest.retryCount + 1
    };
    pendingNodeGroupViewportRetryTimeoutRef.current = window.setTimeout(() => {
      pendingNodeGroupViewportRetryTimeoutRef.current = undefined;
      const nextPendingNodeGroupViewportRequest = pendingNodeGroupViewportRequestRef.current;
      if (!nextPendingNodeGroupViewportRequest) {
        return;
      }

      if (focusNodeGroupInViewport(nextPendingNodeGroupViewportRequest.nodeIds)) {
        pendingNodeGroupViewportRequestRef.current = undefined;
        return;
      }

      schedulePendingNodeGroupViewportRetry();
    }, NODE_GROUP_FOCUS_RETRY_INTERVAL_MS);
  };

  const requestNodeFocus = (nodeId: string, mode: NodeViewportFocusMode = 'fit'): void => {
    if (focusNodeInViewport(nodeId, mode)) {
      pendingViewportRequestRef.current = undefined;
      scheduleCanvasShellFocusRestore(canvasShellRef.current, latestRuntimeContext.surfaceLocation);
      return;
    }

    pendingViewportRequestRef.current = {
      objectId: nodeId,
      objectKind: 'node',
      mode,
      selectNode: true
    };
  };

  const requestNodeCenter = (nodeId: string, mode: NodeViewportFocusMode = 'fit'): void => {
    if (centerNodeInViewport(nodeId, mode)) {
      pendingViewportRequestRef.current = undefined;
      return;
    }

    pendingViewportRequestRef.current = {
      objectId: nodeId,
      objectKind: 'node',
      mode,
      selectNode: false
    };
  };

  const requestGroupFocus = (groupId: string): void => {
    if (centerGroupInViewport(groupId)) {
      pendingViewportRequestRef.current = undefined;
      return;
    }

    pendingViewportRequestRef.current = {
      objectId: groupId,
      objectKind: 'group',
      mode: 'fit',
      selectNode: false
    };
  };

  const requestNodeGroupFocus = (nodeIds: readonly string[]): void => {
    const targetNodeIds = normalizeNodeGroupFocusIds(nodeIds);
    if (targetNodeIds.length === 0) {
      pendingNodeGroupViewportRequestRef.current = undefined;
      clearPendingNodeGroupViewportRetryTimeout();
      return;
    }

    pendingNodeGroupViewportRequestRef.current = {
      nodeIds: targetNodeIds,
      retryCount: 0
    };
    clearPendingNodeGroupViewportRetryTimeout();

    if (focusNodeGroupInViewport(targetNodeIds)) {
      pendingNodeGroupViewportRequestRef.current = undefined;
      return;
    }

    schedulePendingNodeGroupViewportRetry();
  };

  const acknowledgeNodeAttention = (nodeId: string): void => {
    postMessage({
      type: 'webview/selectNode',
      payload: {
        nodeId
      }
    });
  };

  const selectNode = (nodeId: string): void => {
    closeFloatingMenus();
    setSelectedEdgeId(undefined);
    setLocalUiState((current) => ({
      ...current,
      selectedNodeId: nodeId,
      selectedNodeIds: [nodeId],
      selectedGroupId: undefined,
      selectedGroupIds: undefined,
      selectedFileListEntries:
        current.selectedFileListEntries && nodeId in current.selectedFileListEntries
          ? { [nodeId]: current.selectedFileListEntries[nodeId] }
          : undefined
    }));
  };

  const toggleNodeSelection = (nodeId: string): void => {
    closeFloatingMenus();
    setSelectedEdgeId(undefined);
    const currentUiState = localUiStateRef.current;
    const selectedNodeIds = new Set(
      currentUiState.selectedNodeIds ?? (currentUiState.selectedNodeId ? [currentUiState.selectedNodeId] : [])
    );
    const baseSelectedNodeIds = Array.from(selectedNodeIds);
    if (selectedNodeIds.has(nodeId)) {
      selectedNodeIds.delete(nodeId);
    } else {
      selectedNodeIds.add(nodeId);
    }
    const nextSelectedNodeIds = Array.from(selectedNodeIds);
    pendingModifierNodeSelectionRef.current = { nodeId, baseSelectedNodeIds };
    setLocalUiState((current) => {
      const nextState = {
        ...current,
        selectedNodeId: nextSelectedNodeIds.at(-1),
        selectedNodeIds: nextSelectedNodeIds.length > 0 ? nextSelectedNodeIds : undefined,
        selectedGroupId: undefined,
        selectedGroupIds: undefined,
        selectedFileListEntries: undefined
      };
      localUiStateRef.current = nextState;
      return nextState;
    });
  };

  const setFileListViewMode = (nodeId: string, viewMode: FileListViewMode): void => {
    setLocalUiState((current) => {
      const currentViewMode = current.fileListViewModes?.[nodeId] ?? 'list';
      if (currentViewMode === viewMode) {
        return current;
      }

      return {
        ...current,
        fileListViewModes: {
          ...(current.fileListViewModes ?? {}),
          [nodeId]: viewMode
        }
      };
    });
  };

  const toggleFileListTreeBranch = (nodeId: string, branchKey: string): void => {
    closeEdgeMenus();
    setSelectedEdgeId(undefined);
    setLocalUiState((current) => {
      const nextNodeBranchKeys = new Set(current.collapsedFileListTreeBranches?.[nodeId] ?? []);
      if (nextNodeBranchKeys.has(branchKey)) {
        nextNodeBranchKeys.delete(branchKey);
      } else {
        nextNodeBranchKeys.add(branchKey);
      }

      const nextCollapsedBranches = { ...(current.collapsedFileListTreeBranches ?? {}) };
      if (nextNodeBranchKeys.size > 0) {
        nextCollapsedBranches[nodeId] = Array.from(nextNodeBranchKeys).sort();
      } else {
        delete nextCollapsedBranches[nodeId];
      }

      return {
        ...current,
        selectedNodeId: nodeId,
        selectedNodeIds: [nodeId],
        selectedGroupId: undefined,
        selectedGroupIds: undefined,
        collapsedFileListTreeBranches:
          Object.keys(nextCollapsedBranches).length > 0 ? nextCollapsedBranches : undefined
      };
    });
  };

  const selectFileListEntry = (nodeId: string, filePath: string): void => {
    closeEdgeMenus();
    setSelectedEdgeId(undefined);
    setLocalUiState((current) => {
      if (current.selectedNodeId === nodeId && current.selectedFileListEntries?.[nodeId] === filePath) {
        return current;
      }

      return {
        ...current,
        selectedNodeId: nodeId,
        selectedNodeIds: [nodeId],
        selectedGroupId: undefined,
        selectedGroupIds: undefined,
        selectedFileListEntries: {
          ...(current.selectedFileListEntries ?? {}),
          [nodeId]: filePath
        }
      };
    });
  };

  const markCommittedNodeLayoutDrafts = (nodeIds: readonly string[]): void => {
    for (const nodeId of nodeIds) {
      pendingCommittedNodeLayoutDraftIdsRef.current.add(nodeId);
    }
  };

  const handleResizeNode = (nodeId: string, position: CanvasNodePosition, size: CanvasNodeFootprint): void => {
    markCommittedNodeLayoutDrafts([nodeId]);
    nodeResizeAutoPanRef.current?.stop();
    nodeResizeAutoPanRef.current = null;
    setNodeResizeDrafts((current) => {
      if (!current[nodeId]) {
        return current;
      }

      const next = { ...current };
      delete next[nodeId];
      return next;
    });
    postMessage({
      type: 'webview/resizeNode',
      payload: {
        nodeId,
        position,
        size
      }
    });
  };

  const showTransientCanvasError = (message: string): void => {
    setErrorMessage(message);
    if (clearErrorTimer.current) {
      window.clearTimeout(clearErrorTimer.current);
    }
    clearErrorTimer.current = window.setTimeout(() => setErrorMessage(null), 2600);
  };

  const persistViewportForSurface = (binding: CanvasSurfaceBinding, viewport: Viewport): void => {
    if (binding.viewportKind === 'paneGallery' && binding.rootGroupId) {
      const viewportRole =
        binding.paneGalleryViewportRole ??
        resolvePaneGalleryViewportRole(
          normalizePaneGalleryLayoutMode(localUiStateRef.current.paneGallery?.layout) ??
            PANE_GALLERY_DEFAULT_OVERVIEW_LAYOUT
        );
      setLocalUiState((current) => ({
        ...current,
        paneGallery: {
          ...(current.paneGallery ?? {}),
          [viewportRole === 'main' ? 'mainViewports' : 'overviewViewports']: {
            ...(viewportRole === 'main'
              ? current.paneGallery?.mainViewports ?? {}
              : current.paneGallery?.overviewViewports ?? {}),
            [binding.rootGroupId as string]: viewport
          }
        }
      }));
      return;
    }

    setLocalUiState((current) => ({
      ...current,
      viewport
    }));
  };

  const updateNodeLayoutDraft = (nodeId: string, draft: CanvasNodeLayoutDraft | null): void => {
    if (draft?.position && draft.size) {
      activeNodeResizeDraftsRef.current = {
        ...activeNodeResizeDraftsRef.current,
        [nodeId]: draft
      };
      setNodeResizeDrafts((current) => ({
        ...current,
        [nodeId]: {
          position: draft.position as CanvasNodePosition,
          size: draft.size as CanvasNodeFootprint
        }
      }));
    } else {
      const nextActiveDrafts = { ...activeNodeResizeDraftsRef.current };
      delete nextActiveDrafts[nodeId];
      activeNodeResizeDraftsRef.current = nextActiveDrafts;
      setNodeResizeDrafts((current) => {
        if (!current[nodeId]) {
          return current;
        }

        const next = { ...current };
        delete next[nodeId];
        return next;
      });
    }

    setNodeLayoutDrafts((current) => {
      const next = { ...current };
      if (draft) {
        next[nodeId] = draft;
      } else {
        delete next[nodeId];
      }
      return shallowEqualCanvasNodeLayoutDrafts(current, next) ? current : next;
    });
  };

  const handleResizeNodePointerMove = (
    event: Pick<PointerEvent | React.PointerEvent, 'clientX' | 'clientY'>,
    onPan?: (previousViewport: Viewport, nextViewport: Viewport) => void
  ): void => {
    if (!nodeResizeAutoPanRef.current) {
      const binding = activeCanvasSurfaceRef.current;
      nodeResizeAutoPanRef.current = createCanvasAutoPanController(
        binding.flow ?? reactFlowRef.current,
        binding.shell ?? canvasShellRef.current,
        (viewport) => persistViewportForSurface(binding, viewport)
      );
    }

    nodeResizeAutoPanRef.current.handlePointerMove(event, onPan);
  };

  const handleResizeNodeEnd = (): void => {
    nodeResizeAutoPanRef.current?.stop();
    nodeResizeAutoPanRef.current = null;
    activeNodeResizeDraftsRef.current = {};
    setNodeResizeDrafts((current) => (Object.keys(current).length > 0 ? {} : current));
  };

  const baseNodes = toFlowNodes({
    nodes: hostState?.nodes ?? [],
    selectedNodeId: localUiState.selectedNodeId,
    selectedNodeIds: localUiState.selectedNodeIds,
    documentHasFocus,
    workspaceTrusted,
    overviewInteractionsDisabled: canvasOverviewMode,
    strongTerminalAttentionReminderMode: runtimeContext.strongTerminalAttentionReminderMode,
    fileNodeDisplayStyle: runtimeContext.fileNodeDisplayStyle,
    fileNodeDisplayMode: runtimeContext.fileNodeDisplayMode,
    filePathDisplayMode: runtimeContext.filePathDisplayMode,
    noteMarkdownImageWorkspaceRoots: runtimeContext.noteMarkdownImageWorkspaceRoots ?? [],
    workspaceFolders: runtimeContext.workspaceFolders ?? [],
    fileListViewModes: localUiState.fileListViewModes,
    selectedFileListEntries: localUiState.selectedFileListEntries,
    collapsedFileListTreeBranches: localUiState.collapsedFileListTreeBranches,
    nodeResizeDrafts,
    onSelectNode: selectNode,
    onAcknowledgeNodeAttention: acknowledgeNodeAttention,
    onOpenCanvasFile: (nodeId, filePath) =>
      postMessage({
        type: 'webview/openCanvasFile',
        payload: {
          nodeId,
          filePath
        }
      }),
    onOpenNoteLink: (nodeId, href) =>
      postMessage({
        type: 'webview/openNoteLink',
        payload: {
          nodeId,
          href
        }
      }),
    onSaveNoteAsMarkdownFile: (nodeId) =>
      postMessage({
        type: 'webview/saveNoteAsMarkdownFile',
        payload: {
          nodeId
        }
      }),
    onOpenAssociatedNoteMarkdownFile: (nodeId) =>
      postMessage({
        type: 'webview/openAssociatedNoteMarkdownFile',
        payload: {
          nodeId
        }
      }),
    onReloadAssociatedNoteMarkdownFile: (nodeId) =>
      postMessage({
        type: 'webview/reloadAssociatedNoteMarkdownFile',
        payload: {
          nodeId
        }
      }),
    onCreateMissingAssociatedNoteMarkdownFile: (nodeId) =>
      postMessage({
        type: 'webview/createMissingAssociatedNoteMarkdownFile',
        payload: {
          nodeId
        }
      }),
    onCopyTextToClipboard: (text, source, nodeId) =>
      postMessage({
        type: 'webview/copyTextToClipboard',
        payload: {
          text,
          source,
          nodeId
        }
      }),
    onSelectFileListEntry: selectFileListEntry,
    onSetFileListViewMode: setFileListViewMode,
    onToggleFileListTreeBranch: toggleFileListTreeBranch,
    onStartExecution: (nodeId, kind, cols, rows, provider, resume) =>
      postMessage({
        type: 'webview/startExecutionSession',
        payload: {
          nodeId,
          kind,
          cols,
          rows,
          provider,
          resume: resume === true
        }
      }),
    onBranchAgentSession: (nodeId) =>
      postMessage({
        type: 'webview/branchAgentSession',
        payload: { nodeId }
      }),
    onAttachExecution: (nodeId, kind) =>
      postMessage({
        type: 'webview/attachExecutionSession',
        payload: { nodeId, kind }
      }),
    onExecutionInput: (nodeId, kind, data, metadata) =>
      postMessage({
        type: 'webview/executionInput',
        payload: {
          nodeId,
          kind,
          data,
          ...(metadata
            ? {
                sequence: metadata.sequence,
                webviewEpochMs: metadata.webviewEpochMs,
                webviewPerformanceNowMs: metadata.webviewPerformanceNowMs
              }
            : {})
        }
      }),
    onShowTransientError: showTransientCanvasError,
    onDropExecutionResource: (nodeId, kind, resource) =>
      postMessage({
        type: 'webview/dropExecutionResource',
        payload: {
          nodeId,
          kind,
          resource
        }
      }),
    onOpenExecutionLink: (nodeId, kind, link) =>
      postMessage({
        type: 'webview/openExecutionLink',
        payload: {
          nodeId,
          kind,
          link
        }
      }),
    onCopyExecutionSelection: copyExecutionSelection,
    onRequestExecutionPaste: requestExecutionPaste,
    onPasteExecutionImage: pasteExecutionImage,
    onExecutionClipboardDiagnostic: reportExecutionClipboardDiagnostic,
    onResizeExecution: (nodeId, kind, cols, rows) =>
      postMessage({
        type: 'webview/resizeExecutionSession',
        payload: { nodeId, kind, cols, rows }
      }),
    onStopExecution: (nodeId, kind) =>
      postMessage({
        type: 'webview/stopExecutionSession',
        payload: { nodeId, kind }
      }),
    onUpdateNodeTitle: (nodeId, title) =>
      postMessage({
        type: 'webview/updateNodeTitle',
        payload: {
          nodeId,
          title
        }
      }),
    onUpdateNote: (payload) =>
      postMessage({
        type: 'webview/updateNoteNode',
        payload
      }),
    onBeginAssociatedNoteMarkdownEdit: (payload) =>
      postMessage({
        type: 'webview/beginAssociatedNoteMarkdownEdit',
        payload
      }),
    onEndAssociatedNoteMarkdownEdit: (nodeId) =>
      postMessage({
        type: 'webview/endAssociatedNoteMarkdownEdit',
        payload: {
          nodeId
        }
      }),
    onUpdateAssociatedNoteMarkdownDraft: (payload) =>
      postMessage({
        type: 'webview/updateAssociatedNoteMarkdownDraft',
        payload
      }),
    onClearAssociatedNoteMarkdownDraft: (nodeId) =>
      postMessage({
        type: 'webview/clearAssociatedNoteMarkdownDraft',
        payload: {
          nodeId
        }
      }),
    onCopyAssociatedNoteMarkdownDraft: (nodeId, content) =>
      postMessage({
        type: 'webview/copyAssociatedNoteMarkdownDraft',
        payload: {
          nodeId,
          content
        }
      }),
    onDraftNodeLayout: updateNodeLayoutDraft,
    onResizeNodePointerMove: handleResizeNodePointerMove,
    onResizeNodeEnd: handleResizeNodeEnd,
    onResizeNode: handleResizeNode,
    onFocusNodeInViewport: focusNodeInViewport,
    onDeleteNode: deleteNode,
    onModifierSelectNode: toggleNodeSelection
  });
  const groupDraftLayout = applyCanvasGroupDrafts({
    groups: hostState?.groups ?? [],
    hostNodes: hostState?.nodes ?? [],
    flowNodes: baseNodes,
    drafts: groupDrafts
  });
  const nodes = applyCanvasNodeLayoutDrafts(groupDraftLayout.nodes, nodeLayoutDrafts);
  const groups = groupDraftLayout.groups;
  const canvasSpatialBounds = useMemo(
    () => resolveCanvasSpatialBounds(nodes, groups),
    [groups, nodes]
  );
  const dynamicCanvasMinZoom = useMemo(
    () => resolveDynamicCanvasMinZoom(canvasSpatialBounds, canvasViewportSize),
    [canvasSpatialBounds, canvasViewportSize]
  );

  const moveGroupIntoViewport = (groupId: string): boolean => {
    const reactFlowInstance = reactFlowRef.current;
    const targetGroup = groups.find((group) => group.id === groupId);
    if (
      !reactFlowInstance?.viewportInitialized ||
      !targetGroup ||
      !isPositiveFiniteNumber(targetGroup.size.width) ||
      !isPositiveFiniteNumber(targetGroup.size.height)
    ) {
      return false;
    }

    const viewport = getViewportForBounds(
      {
        x: targetGroup.position.x,
        y: targetGroup.position.y,
        width: targetGroup.size.width,
        height: targetGroup.size.height
      },
      canvasViewportSize.width,
      canvasViewportSize.height,
      Math.min(NODE_FOCUS_MIN_ZOOM, dynamicCanvasMinZoom),
      NODE_FOCUS_MAX_ZOOM,
      NODE_FOCUS_VIEW_PADDING
    );
    reactFlowInstance.setViewport(viewport, { duration: NODE_FOCUS_ANIMATION_DURATION_MS });
    return true;
  };

  const focusGroupInViewport = (groupId: string): boolean => {
    if (isPaneGalleryPresentation) {
      return centerGroupInViewport(groupId);
    }

    if (!moveGroupIntoViewport(groupId)) {
      return false;
    }

    closeFloatingMenus();
    setSelectedEdgeId(undefined);
    setLocalUiState((current) => {
      const nextState = {
        ...current,
        selectedNodeId: undefined,
        selectedNodeIds: undefined,
        selectedGroupId: groupId,
        selectedGroupIds: [groupId]
      };
      localUiStateRef.current = nextState;
      return nextState;
    });
    scheduleFocusedViewportPersistence();
    return true;
  };

  const fitCanvasView = useCallback((duration = 0): boolean => {
    const reactFlowInstance = reactFlowRef.current;
    const bounds = canvasSpatialBounds.bounds;
    if (!reactFlowInstance?.viewportInitialized || !bounds) {
      return false;
    }

    const viewport = getViewportForBounds(
      bounds,
      canvasViewportSize.width,
      canvasViewportSize.height,
      dynamicCanvasMinZoom,
      CANVAS_MAX_ZOOM,
      CANVAS_FIT_VIEW_PADDING
    );
    reactFlowInstance.setViewport(viewport, { duration });
    if (duration <= 0) {
      setLocalUiState((current) => ({
        ...current,
        viewport
      }));
    } else {
      clearPendingViewportPersistenceTimeout();
      pendingViewportSyncTimeoutRef.current = window.setTimeout(() => {
        pendingViewportSyncTimeoutRef.current = undefined;
        const latestViewport = reactFlowRef.current?.getViewport() ?? viewport;
        setLocalUiState((current) => ({
          ...current,
          viewport: latestViewport
        }));
      }, duration + NODE_FOCUS_VIEWPORT_SYNC_GRACE_MS);
    }
    return true;
  }, [canvasSpatialBounds, canvasViewportSize.height, canvasViewportSize.width, dynamicCanvasMinZoom]);
  const edges = toFlowEdges({
    edges: hostState?.edges ?? [],
    selectedEdgeId,
    edgeLabelEditor,
    edgeArrowMenuEdgeId,
    edgeColorMenuEdgeId,
    onSelectEdge: (edgeId) => {
      closePaneContextMenu();
      closeEdgeMenus();
      setSelectedEdgeId(edgeId);
      setLocalUiState((current) => ({
        ...current,
        selectedNodeId: undefined,
        selectedNodeIds: undefined,
        selectedGroupId: undefined,
        selectedGroupIds: undefined
      }));
    },
    onStartLabelEdit: startEdgeLabelEdit,
    onSubmitLabelEdit: submitEdgeLabelEdit,
    onCancelLabelEdit: cancelEdgeLabelEdit,
    onToggleArrowMenu: (edgeId) => {
      setEdgeColorMenuEdgeId(undefined);
      setEdgeArrowMenuEdgeId((current) => (current === edgeId ? undefined : edgeId));
    },
    onSetArrowMode: setEdgeArrowMode,
    onToggleColorMenu: (edgeId) => {
      setEdgeArrowMenuEdgeId(undefined);
      setEdgeColorMenuEdgeId((current) => (current === edgeId ? undefined : edgeId));
    },
    onSetColor: setEdgeColor,
    onDeleteEdge: deleteEdge
  });
  const hostNodes = hostState?.nodes ?? [];
  const paneGalleryRootModels = useMemo(
    () => buildPaneGalleryRootModels({
      rootGroups: groups.filter((group) => isWorkspaceRootCanvasGroupRole(group.role)),
      groups,
      nodes,
      edges,
      hostNodes,
      workspaceFolders: runtimeContext.workspaceFolders ?? [],
      strongTerminalAttentionReminderMode: runtimeContext.strongTerminalAttentionReminderMode
    }),
    [edges, groups, hostNodes, nodes, runtimeContext.workspaceFolders, runtimeContext.strongTerminalAttentionReminderMode]
  );
  const paneGalleryRootIds = paneGalleryRootModels.map((model) => model.rootGroup.id);
  const paneGalleryState = localUiState.paneGallery;
  const normalizedPaneGalleryLayout =
    normalizePaneGalleryLayoutMode(paneGalleryState?.layout) ?? PANE_GALLERY_DEFAULT_OVERVIEW_LAYOUT;
  const lastPaneGalleryOverviewLayout = resolvePaneGalleryLastOverviewLayout(paneGalleryState);
  const lastPaneGalleryThumbnailLayout = resolvePaneGalleryLastThumbnailLayout(paneGalleryState);
  const activePaneGalleryRootId = paneGalleryRootIds.includes(paneGalleryState?.activeRootGroupId ?? '')
    ? paneGalleryState?.activeRootGroupId
    : paneGalleryRootIds[0];
  const isPaneGalleryPresentation =
    runtimeContext.multiRootPresentationMode === 'paneGallery' && paneGalleryRootModels.length > 1;
  const selectedGroupIds = resolveSelectedGroupIds(localUiState);
  const workspaceRootGroupCount = groups.filter((group) => isWorkspaceRootCanvasGroupRole(group.role)).length;
  const resolveArrangeLayoutRootGroupId = (
    targetGroupId?: string,
    fallbackFlowAnchor?: CanvasNodePosition
  ): string | undefined => {
    const targetGroup = targetGroupId
      ? groups.find((group) => group.id === targetGroupId)
      : fallbackFlowAnchor
        ? findInnermostCanvasGroupFrameAtFlowPoint(groups, fallbackFlowAnchor)
        : undefined;
    if (!targetGroup) {
      return undefined;
    }

    return isWorkspaceRootCanvasGroupRole(targetGroup.role)
      ? targetGroup.id
      : resolveContainingWorkspaceRootGroupIdForWebview(groups, targetGroup.id);
  };
  const resolveClearCanvasTargetGroup = (
    targetGroupId?: string,
    fallbackFlowAnchor?: CanvasNodePosition
  ): CanvasGroupSummary | undefined => {
    const targetGroup = targetGroupId
      ? groups.find((group) => group.id === targetGroupId)
      : fallbackFlowAnchor
        ? findInnermostCanvasGroupFrameAtFlowPoint(groups, fallbackFlowAnchor)
        : undefined;
    if (!targetGroup) {
      return undefined;
    }

    if (isWorkspaceRootCanvasGroupRole(targetGroup.role)) {
      return targetGroup;
    }

    const containingRootGroupId = resolveContainingWorkspaceRootGroupIdForWebview(groups, targetGroup.id);
    if (containingRootGroupId || workspaceRootGroupCount <= 1) {
      return targetGroup;
    }

    return undefined;
  };
  const resolveClearCanvasTargetGroupId = (
    targetGroupId?: string,
    fallbackFlowAnchor?: CanvasNodePosition
  ): string | undefined => resolveClearCanvasTargetGroup(targetGroupId, fallbackFlowAnchor)?.id;
  const resolveClearCanvasTargetKind = (
    targetGroupId?: string,
    fallbackFlowAnchor?: CanvasNodePosition
  ): CanvasClearCanvasTargetKind | undefined => {
    const targetGroup = resolveClearCanvasTargetGroup(targetGroupId, fallbackFlowAnchor);
    if (!targetGroup) {
      return undefined;
    }
    return isWorkspaceRootCanvasGroupRole(targetGroup.role) ? 'workspace-root' : 'group';
  };
  const shouldOfferWorkspaceArrangeLayoutScope = (
    targetGroupId?: string,
    fallbackFlowAnchor?: CanvasNodePosition
  ): boolean =>
    workspaceRootGroupCount > 1 &&
    (runtimeContext.multiRootPresentationMode === 'rootGroups' ||
      runtimeContext.multiRootPresentationMode === 'paneGallery') &&
    Boolean(resolveArrangeLayoutRootGroupId(targetGroupId, fallbackFlowAnchor));
  const shouldOfferWorkspaceClearCanvasScope = (
    targetGroupId?: string,
    fallbackFlowAnchor?: CanvasNodePosition
  ): boolean =>
    workspaceRootGroupCount > 1 &&
    (runtimeContext.multiRootPresentationMode === 'rootGroups' ||
      runtimeContext.multiRootPresentationMode === 'paneGallery') &&
    Boolean(resolveClearCanvasTargetGroupId(targetGroupId, fallbackFlowAnchor));
  const resolveTemplateResetTargetRootGroupId = (targetGroupId?: string): string | undefined => {
    const targetGroup = targetGroupId ? groups.find((group) => group.id === targetGroupId) : undefined;
    if (!targetGroup) {
      return undefined;
    }

    return isWorkspaceRootCanvasGroupRole(targetGroup.role)
      ? targetGroup.id
      : resolveContainingWorkspaceRootGroupIdForWebview(groups, targetGroup.id);
  };
  const shouldPromptForRootGroupTemplateReset = (targetGroupId?: string): boolean =>
    !isPaneGalleryPresentation &&
    workspaceRootGroupCount > 1 &&
    !resolveTemplateResetTargetRootGroupId(targetGroupId);
  const promptForRootGroupTemplateResetTarget = (): void => {
    showTransientCanvasError(t('canvas.error.multiRootTemplateReset'));
    closePaneContextMenu();
  };

  useEffect(() => {
    if (paneGalleryRootIds.length === 0) {
      return;
    }

    setLocalUiState((current) => {
      const currentPaneState = current.paneGallery;
      const knownRootIds = new Set(paneGalleryRootIds);
      const overviewViewports = Object.fromEntries(
        Object.entries(currentPaneState?.overviewViewports ?? {}).filter(([rootGroupId]) =>
          knownRootIds.has(rootGroupId)
        )
      );
      const mainViewports = Object.fromEntries(
        Object.entries(currentPaneState?.mainViewports ?? {}).filter(([rootGroupId]) =>
          knownRootIds.has(rootGroupId)
        )
      );
      const activeRootGroupId = currentPaneState?.activeRootGroupId;
      const normalizedActiveRootGroupId = activeRootGroupId && knownRootIds.has(activeRootGroupId)
        ? activeRootGroupId
        : paneGalleryRootIds[0];
      const normalizedLayout =
        normalizePaneGalleryLayoutMode(currentPaneState?.layout) ?? PANE_GALLERY_DEFAULT_OVERVIEW_LAYOUT;
      const normalizedLastOverviewLayout = resolvePaneGalleryLastOverviewLayout(currentPaneState);
      const normalizedLastThumbnailLayout = resolvePaneGalleryLastThumbnailLayout(currentPaneState);
      const overviewViewportsChanged =
        Object.keys(overviewViewports).length !== Object.keys(currentPaneState?.overviewViewports ?? {}).length;
      const mainViewportsChanged =
        Object.keys(mainViewports).length !== Object.keys(currentPaneState?.mainViewports ?? {}).length;
      if (
        normalizedActiveRootGroupId === activeRootGroupId &&
        normalizedLayout === currentPaneState?.layout &&
        normalizedLastOverviewLayout === currentPaneState?.lastOverviewLayout &&
        normalizedLastThumbnailLayout === currentPaneState?.lastThumbnailLayout &&
        !overviewViewportsChanged &&
        !mainViewportsChanged
      ) {
        return current;
      }

      const nextState = {
        ...current,
        paneGallery: {
          ...(currentPaneState ?? {}),
          layout: normalizedLayout,
          activeRootGroupId: normalizedActiveRootGroupId,
          lastOverviewLayout: normalizedLastOverviewLayout,
          lastThumbnailLayout: normalizedLastThumbnailLayout,
          overviewViewports: Object.keys(overviewViewports).length > 0 ? overviewViewports : undefined,
          mainViewports: Object.keys(mainViewports).length > 0 ? mainViewports : undefined
        }
      };
      localUiStateRef.current = nextState;
      return nextState;
    });
  }, [paneGalleryRootIds.join('\0')]);

  useEffect(() => {
    if (didApplyInitialCanvasFitRef.current || !reactFlowReadyVersion || !canvasSpatialBounds.bounds) {
      return;
    }

    if (fitCanvasView(0)) {
      didApplyInitialCanvasFitRef.current = true;
    }
  }, [canvasSpatialBounds, fitCanvasView, reactFlowReadyVersion]);

  useEffect(() => {
    setNodeLayoutDrafts((current) => pruneCanvasNodeLayoutDrafts(baseNodes, current));
  }, [hostState]);

  const updateLocalUiState = (nextState: LocalUiState): void => {
    localUiStateRef.current = nextState;
    setLocalUiState(nextState);
  };

  const handleNodeClick: NodeMouseHandler = (_event, node) => {
    if (isInteractiveTarget(_event.target)) {
      return;
    }

    closeFloatingMenus();
    if (_event.ctrlKey || _event.metaKey) {
      return;
    }

    selectNode(node.id);
  };

  const resolveGroupBodyHitAtPointer = (
    event: Pick<React.MouseEvent | React.DragEvent, 'clientX' | 'clientY'>,
    binding: CanvasSurfaceBinding = activeCanvasSurfaceRef.current
  ): CanvasGroupSummary | undefined => {
    if (binding.flow?.viewportInitialized) {
      return findInnermostCanvasGroupBodyAtFlowPoint(
        groups,
        binding.shell,
        binding.flow.screenToFlowPosition({
          x: event.clientX,
          y: event.clientY
        })
      );
    }

    return findInnermostCanvasGroupBodyAtScreenPoint(groups, binding.shell, event.clientX, event.clientY);
  };

  const bindActiveCanvasSurface = (binding: CanvasSurfaceBinding): void => {
    activeCanvasSurfaceRef.current = binding;
  };

  const handlePaneClick = (event: React.MouseEvent): void => {
    closeFloatingMenus();
    const bodyHitGroup = resolveGroupBodyHitAtPointer(event);
    if (bodyHitGroup) {
      selectGroup(bodyHitGroup.id, event);
      return;
    }

    if (
      !localUiState.selectedNodeId &&
      !localUiState.selectedGroupId &&
      !localUiState.selectedGroupIds?.length &&
      !selectedEdgeId
    ) {
      return;
    }

    setSelectedEdgeId(undefined);
    updateLocalUiState({
      ...localUiState,
      selectedNodeId: undefined,
      selectedNodeIds: undefined,
      selectedGroupId: undefined,
      selectedGroupIds: undefined
    });
  };

  const selectGroup = (
    groupId: string,
    event?: Pick<React.MouseEvent | React.PointerEvent | MouseEvent, 'ctrlKey' | 'metaKey'>
  ): void => {
    closeFloatingMenus();
    setSelectedEdgeId(undefined);
    setLocalUiState((current) => {
      const useModifierSelection = event?.ctrlKey === true || event?.metaKey === true;
      if (useModifierSelection) {
        const selectedGroupIds = new Set(resolveSelectedGroupIds(current));
        if (selectedGroupIds.has(groupId)) {
          selectedGroupIds.delete(groupId);
        } else {
          selectedGroupIds.add(groupId);
        }
        const nextSelectedGroupIds = Array.from(selectedGroupIds);
        const nextState = {
          ...current,
          selectedNodeId: undefined,
          selectedNodeIds: undefined,
          selectedGroupId: nextSelectedGroupIds.at(-1),
          selectedGroupIds: nextSelectedGroupIds.length > 0 ? nextSelectedGroupIds : undefined
        };
        localUiStateRef.current = nextState;
        return nextState;
      }

      const nextState =
        current.selectedGroupId === groupId &&
        !current.selectedNodeId &&
        !current.selectedNodeIds?.length &&
        arraysEqual(resolveSelectedGroupIds(current), [groupId])
          ? current
          : {
              ...current,
              selectedNodeId: undefined,
              selectedNodeIds: undefined,
              selectedGroupIds: [groupId],
              selectedGroupId: groupId
            };
      localUiStateRef.current = nextState;
      return nextState;
    });
  };

  const updateGroupDraft = (groupId: string, draft: CanvasGroupDraft | null): void => {
    setGroupDrafts((current) => {
      if (draft && !activeGroupInteractionIdsRef.current.has(groupId)) {
        return current;
      }

      const next = { ...current };
      if (draft) {
        next[groupId] = draft;
      } else {
        delete next[groupId];
      }
      return shallowEqualCanvasGroupDrafts(current, next) ? current : next;
    });
  };

  const handleGroupInteractionStart = (groupId: string): void => {
    activeGroupInteractionIdsRef.current.add(groupId);
  };

  const handleGroupInteractionEnd = (groupId: string): void => {
    activeGroupInteractionIdsRef.current.delete(groupId);
  };

  const markCommittedGroupDraft = (groupId: string): void => {
    activeGroupInteractionIdsRef.current.delete(groupId);
    committedGroupDraftIdsRef.current.add(groupId);
  };

  const handleCreateEmptyGroup = (position: CanvasNodePosition, parentGroupId?: string): void => {
    postMessage({
      type: 'webview/createEmptyGroup',
      payload: {
        position,
        size: DEFAULT_CANVAS_GROUP_SIZE,
        parentGroupId
      }
    });
  };

  const handleCreateGroupFromSelection = (
    nodeIds: readonly string[],
    groupIds: readonly string[],
    parentGroupId?: string
  ): void => {
    postMessage({
      type: 'webview/createGroupFromSelection',
      payload: {
        nodeIds: [...nodeIds],
        groupIds: [...groupIds],
        parentGroupId
      }
    });
  };

  const createGroupFromCurrentSelectionRequest = (): void => {
    const currentHostState = hostStateRef.current;
    const currentUiState = localUiStateRef.current;
    const nodeIds = currentUiState.selectedNodeIds ?? (currentUiState.selectedNodeId ? [currentUiState.selectedNodeId] : []);
    const groupIds = resolveSelectedGroupIds(currentUiState);
    const parentGroupId = resolveSelectedObjectParentGroupId(currentHostState, nodeIds, groupIds);

    if (!canCreateCanvasGroupFromSelection(currentHostState, nodeIds, groupIds, parentGroupId)) {
      showTransientCanvasError(t('canvas.error.createGroupFromSelection'));
      return;
    }

    handleCreateGroupFromSelection(nodeIds, groupIds, parentGroupId);
  };

  const handleMoveGroup = (groupId: string, position: CanvasNodePosition, pointerPosition: CanvasNodePosition): void => {
    markCommittedGroupDraft(groupId);
    updateGroupDraft(groupId, null);
    groupDragAutoPanRef.current?.stop();
    groupDragAutoPanRef.current = null;
    postMessage({
      type: 'webview/moveGroup',
      payload: {
        groupId,
        position,
        pointerPosition
      }
    });
  };

  const handleGroupDragPointerMove = (
    event: Pick<PointerEvent | React.PointerEvent, 'clientX' | 'clientY'>,
    onPan?: (previousViewport: Viewport, nextViewport: Viewport) => void
  ): void => {
    if (!groupDragAutoPanRef.current) {
      const binding = activeCanvasSurfaceRef.current;
      groupDragAutoPanRef.current = createCanvasAutoPanController(
        binding.flow ?? reactFlowRef.current,
        binding.shell ?? canvasShellRef.current,
        (viewport) => persistViewportForSurface(binding, viewport)
      );
    }

    groupDragAutoPanRef.current.handlePointerMove(event, onPan);
  };

  const handleGroupDragEnd = (): void => {
    groupDragAutoPanRef.current?.stop();
    groupDragAutoPanRef.current = null;
  };

  const handleGroupResizePointerMove = (
    event: Pick<PointerEvent | React.PointerEvent, 'clientX' | 'clientY'>,
    onPan?: (previousViewport: Viewport, nextViewport: Viewport) => void
  ): void => {
    if (!groupResizeAutoPanRef.current) {
      const binding = activeCanvasSurfaceRef.current;
      groupResizeAutoPanRef.current = createCanvasAutoPanController(
        binding.flow ?? reactFlowRef.current,
        binding.shell ?? canvasShellRef.current,
        (viewport) => persistViewportForSurface(binding, viewport)
      );
    }

    groupResizeAutoPanRef.current.handlePointerMove(event, onPan);
  };

  const handleGroupResizeEnd = (): void => {
    groupResizeAutoPanRef.current?.stop();
    groupResizeAutoPanRef.current = null;
  };

  const handleResizeGroup = (groupId: string, position: CanvasNodePosition, size: CanvasNodeFootprint): void => {
    markCommittedGroupDraft(groupId);
    updateGroupDraft(groupId, null);
    handleGroupResizeEnd();
    postMessage({
      type: 'webview/resizeGroup',
      payload: {
        groupId,
        position,
        size
      }
    });
  };

  const handleUpdateGroupTitle = (groupId: string, title: string): void => {
    postMessage({
      type: 'webview/updateGroupTitle',
      payload: {
        groupId,
        title
      }
    });
  };

  const handleUngroup = (groupId: string): void => {
    setLocalUiState((current) =>
      current.selectedGroupId === groupId
        ? {
            ...current,
            selectedGroupId: undefined,
            selectedGroupIds: undefined
          }
        : current
    );
    postMessage({
      type: 'webview/ungroup',
      payload: { groupId }
    });
  };

  const handleDeleteGroup = (groupId: string): void => {
    setLocalUiState((current) =>
      current.selectedGroupId === groupId
        ? {
            ...current,
            selectedGroupId: undefined,
            selectedGroupIds: undefined
          }
        : current
    );
    postMessage({
      type: 'webview/deleteGroup',
      payload: { groupId }
    });
  };

  const handleNodeDragStop: NodeDragHandler = (event, node, draggedNodes) => {
    const pointerPosition = reactFlowRef.current?.screenToFlowPosition({
      x: event.clientX,
      y: event.clientY
    });
    const primaryPointerPosition = pointerPosition
      ? {
          x: Math.round(pointerPosition.x),
          y: Math.round(pointerPosition.y)
        }
      : undefined;
    const draggedNodeIds = new Set(draggedNodes.map((draggedNode) => draggedNode.id));
    const selectedFlowNodesById = new Map(
      nodes
        .filter(
          (candidate) =>
            candidate.id !== node.id &&
            candidate.selected &&
            !draggedNodeIds.has(candidate.id) &&
            candidate.draggable !== false &&
            nodeLayoutDrafts[candidate.id]?.position
        )
        .map((candidate) => [candidate.id, candidate] as const)
    );
    const selectedMoves = [
      ...draggedNodes.filter((draggedNode) => draggedNode.id !== node.id),
      ...selectedFlowNodesById.values()
    ].map((draggedNode) => {
      const draftPosition = nodeLayoutDrafts[draggedNode.id]?.position;
      const resolvedPosition = draftPosition ?? draggedNode.position;
      return {
        id: draggedNode.id,
        position: {
          x: Math.round(resolvedPosition.x),
          y: Math.round(resolvedPosition.y)
        },
        pointerPosition: primaryPointerPosition
      };
    });
    markCommittedNodeLayoutDrafts([node.id, ...selectedMoves.map((move) => move.id)]);
    postMessage({
      type: 'webview/moveNode',
      payload: {
        id: node.id,
        position: node.position,
        pointerPosition: primaryPointerPosition,
        selectedMoves: selectedMoves.length > 0 ? selectedMoves : undefined
      }
    });
  };

  const isCanvasNodeInPaneGalleryRoot = (nodeId: string, rootGroupId: string): boolean => {
    const hostNode = hostStateRef.current?.nodes.find((candidate) => candidate.id === nodeId);
    return Boolean(
      hostNode &&
        resolveContainingWorkspaceRootGroupIdForWebview(groups, hostNode.groupId) === rootGroupId
    );
  };

  const filterCanvasNodeLayoutDraftsForPaneRoot = (
    drafts: Record<string, CanvasNodeLayoutDraft>,
    rootGroupId?: string
  ): Record<string, CanvasNodeLayoutDraft> => {
    if (!rootGroupId) {
      return drafts;
    }

    const nextDrafts = Object.fromEntries(
      Object.entries(drafts).filter(([nodeId]) => isCanvasNodeInPaneGalleryRoot(nodeId, rootGroupId))
    );
    return shallowEqualCanvasNodeLayoutDrafts(drafts, nextDrafts) ? drafts : nextDrafts;
  };

  const handleNodesChange = (changes: any[]): void => {
    const paneRootGroupId =
      activeCanvasSurfaceRef.current.viewportKind === 'paneGallery'
        ? activeCanvasSurfaceRef.current.rootGroupId
        : undefined;
    const selectionChanges = changes.filter(
      (change) => change?.type === 'select' && typeof change.id === 'string' && typeof change.selected === 'boolean'
    );
    setNodeLayoutDrafts((current) => {
      const currentNodes = applyCanvasNodeLayoutDrafts(groupDraftLayout.nodes, current);
      const nextNodes = applyNodeChanges(changes, currentNodes);
      const nextDrafts = {
        ...collectCanvasNodeLayoutDrafts(groupDraftLayout.nodes, nextNodes),
        ...activeNodeResizeDraftsRef.current
      };
      if (selectionChanges.length > 0 || !changes.some((change) => change?.type === 'position')) {
        return filterCanvasNodeLayoutDraftsForPaneRoot(nextDrafts, paneRootGroupId);
      }

      return filterCanvasNodeLayoutDraftsForPaneRoot(
        extendCanvasNodeLayoutDraftsForSelectedDrag(groupDraftLayout.nodes, nextNodes, nextDrafts),
        paneRootGroupId
      );
    });

    if (selectionChanges.length > 0) {
      setSelectedEdgeId(undefined);
      setLocalUiState((current) => {
        const pendingModifierNodeSelection = pendingModifierNodeSelectionRef.current;
        const selectedNodeIds = new Set(
          pendingModifierNodeSelection?.baseSelectedNodeIds ??
            current.selectedNodeIds ??
            (current.selectedNodeId ? [current.selectedNodeId] : [])
        );
        let lastSelectedNodeId = current.selectedNodeId;
        if (pendingModifierNodeSelection) {
          if (selectedNodeIds.has(pendingModifierNodeSelection.nodeId)) {
            selectedNodeIds.delete(pendingModifierNodeSelection.nodeId);
          } else {
            selectedNodeIds.add(pendingModifierNodeSelection.nodeId);
          }
          pendingModifierNodeSelectionRef.current = null;
          const nextSelectedNodeIds = Array.from(selectedNodeIds);
          const nextState = {
            ...current,
            selectedNodeId: nextSelectedNodeIds.at(-1),
            selectedNodeIds: nextSelectedNodeIds.length > 0 ? nextSelectedNodeIds : undefined,
            selectedGroupId: undefined,
            selectedGroupIds: undefined
          };
          localUiStateRef.current = nextState;
          return nextState;
        }
        if (!selectionChanges.some((change) => change.selected)) {
          return current;
        }
        for (const change of selectionChanges) {
          if (change.selected) {
            selectedNodeIds.add(change.id);
            lastSelectedNodeId = change.id;
          } else {
            selectedNodeIds.delete(change.id);
          }
        }
        const selectedChangeCount = selectionChanges.filter((change) => change.selected).length;
        const nextSelectedNodeIds =
          selectedChangeCount === 1
            ? [lastSelectedNodeId ?? selectionChanges.find((change) => change.selected)?.id].filter(
                (id): id is string => typeof id === 'string'
              )
            : Array.from(selectedNodeIds);
        const nextState = {
          ...current,
          selectedNodeId: nextSelectedNodeIds.at(-1),
          selectedNodeIds: nextSelectedNodeIds.length > 0 ? nextSelectedNodeIds : undefined,
          selectedGroupId: undefined,
          selectedGroupIds: undefined
        };
        localUiStateRef.current = nextState;
        return nextState;
      });
    }
  };

  const handleMoveEnd = (_event: MouseEvent | TouchEvent | null, viewport: Viewport): void => {
    persistCanvasViewport(viewport);
  };

  const postCanvasViewportCenter = (viewport: Viewport): void => {
    const visibleCenter = resolveVisibleCanvasCenterFromViewport(viewport, canvasShellRef.current);
    if (!visibleCenter) {
      return;
    }

    postMessage({
      type: 'webview/updateViewportCenter',
      payload: {
        visibleCenter
      }
    });
  };

  const commitCanvasViewport = (viewport: Viewport): void => {
    setLocalUiState((current) => ({
      ...current,
      viewport
    }));
    postCanvasViewportCenter(viewport);
  };

  const persistCanvasViewport = (viewport: Viewport): void => {
    clearPendingViewportPersistenceTimeout();
    commitCanvasViewport(viewport);
  };

  const handleMoveStart = (): void => {
    closeFloatingMenus();
  };

  const clearPendingViewportPersistenceTimeout = (): void => {
    if (pendingViewportSyncTimeoutRef.current === undefined) {
      return;
    }

    window.clearTimeout(pendingViewportSyncTimeoutRef.current);
    pendingViewportSyncTimeoutRef.current = undefined;
  };

  const scheduleFocusedViewportPersistence = (): void => {
    const binding = activeCanvasSurfaceRef.current;
    clearPendingViewportPersistenceTimeout();
    pendingViewportSyncTimeoutRef.current = window.setTimeout(() => {
      pendingViewportSyncTimeoutRef.current = undefined;
      const viewport = binding.flow?.getViewport();
      if (!viewport) {
        return;
      }

      if (binding.viewportKind === 'paneGallery') {
        persistViewportForSurface(binding, viewport);
        return;
      }

      commitCanvasViewport(viewport);
    }, NODE_FOCUS_ANIMATION_DURATION_MS + NODE_FOCUS_VIEWPORT_SYNC_GRACE_MS);
  };

  const handlePaneContextMenu = (event: React.MouseEvent, explicitTargetGroupId?: string): void => {
    event.preventDefault();
    stopCanvasEvent(event);

    const surfaceBinding = activeCanvasSurfaceRef.current;
    const reactFlowInstance = surfaceBinding.flow ?? reactFlowRef.current;
    if (!reactFlowInstance?.viewportInitialized) {
      return;
    }

    const flowAnchor = reactFlowInstance.screenToFlowPosition({
      x: event.clientX,
      y: event.clientY
    });

    const explicitBodyHitGroup = explicitTargetGroupId
      ? groups.find((group) => group.id === explicitTargetGroupId)
      : undefined;
    const bodyHitGroup = explicitBodyHitGroup ?? resolveGroupBodyHitAtPointer(event, surfaceBinding);
    setSelectedEdgeId(undefined);
    closeEdgeMenus();
    const currentSelectedNodeIds =
      localUiState.selectedNodeIds ?? (localUiState.selectedNodeId ? [localUiState.selectedNodeId] : []);
    const currentSelectedGroupIds =
      resolveSelectedGroupIds(localUiState);
    const bodyHitGroupForSelection = bodyHitGroup;
    const targetGroupId = bodyHitGroup?.id;
    const preserveSelectionForBodyAction =
      bodyHitGroupForSelection &&
      canCreateCanvasGroupFromSelection(hostState, currentSelectedNodeIds, currentSelectedGroupIds, bodyHitGroupForSelection.id);
    const selectedNodeIds = preserveSelectionForBodyAction
      ? currentSelectedNodeIds
      : bodyHitGroupForSelection
        ? []
        : currentSelectedNodeIds;
    const selectedGroupIds = preserveSelectionForBodyAction
      ? currentSelectedGroupIds
      : bodyHitGroupForSelection
        ? [bodyHitGroupForSelection.id]
        : currentSelectedGroupIds;
    const canCreateGroupFromSelection = canCreateCanvasGroupFromSelection(
      hostState,
      selectedNodeIds,
      selectedGroupIds,
      targetGroupId
    );
    setLocalUiState((current) => ({
      ...current,
      selectedNodeId: undefined,
      selectedNodeIds: undefined,
      selectedGroupId: selectedGroupIds.at(-1),
      selectedGroupIds: selectedGroupIds.length > 0 ? selectedGroupIds : undefined
    }));
    setContextMenu({
      screenX: event.clientX,
      screenY: event.clientY,
      flowAnchor: {
        x: Math.round(flowAnchor.x),
        y: Math.round(flowAnchor.y)
      },
      view: 'root',
      targetGroupId,
      selectedNodeIds,
      selectedGroupIds,
      canCreateGroupFromSelection
    });
  };

  const handleCanvasDragOver = (event: React.DragEvent<HTMLDivElement>): void => {
    if (!isCanvasBlankDropTarget(event.target)) {
      return;
    }
    if (!hasPotentialDroppedResource(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
  };

  const handleCanvasDropForSurface = (
    event: React.DragEvent,
    binding: CanvasSurfaceBinding = activeCanvasSurfaceRef.current,
    explicitTargetGroupId?: string
  ): void => {
    if (!isCanvasBlankDropTarget(event.target)) {
      return;
    }

    const hasPotentialDroppedMarkdownResource = hasPotentialDroppedResource(event.dataTransfer);
    const resources = extractDroppedNoteMarkdownResources(event.dataTransfer);
    if (resources.length === 0) {
      if (hasPotentialDroppedMarkdownResource) {
        event.preventDefault();
        stopCanvasEvent(event);
      }
      return;
    }

    event.preventDefault();
    stopCanvasEvent(event);
    const reactFlowInstance = binding.flow ?? reactFlowRef.current;
    if (!reactFlowInstance?.viewportInitialized) {
      return;
    }

    const flowPosition = reactFlowInstance.screenToFlowPosition({
      x: event.clientX,
      y: event.clientY
    });
    const targetGroupId = explicitTargetGroupId ?? resolveGroupBodyHitAtPointer(event, binding)?.id;
    postMessage({
      type: 'webview/dropNoteMarkdownFiles',
      payload: {
        resources,
        position: {
          x: Math.round(flowPosition.x),
          y: Math.round(flowPosition.y)
        },
        targetGroupId
      }
    });
  };

  const handleCanvasDrop = (event: React.DragEvent<HTMLDivElement>): void => {
    handleCanvasDropForSurface(event);
  };

  const bindPaneGallerySurface = (
    rootGroupId: string,
    viewportRole = resolvePaneGalleryViewportRole(
      normalizePaneGalleryLayoutMode(localUiStateRef.current.paneGallery?.layout) ??
        PANE_GALLERY_DEFAULT_OVERVIEW_LAYOUT
    )
  ): CanvasSurfaceBinding => {
    const binding: CanvasSurfaceBinding = {
      flow: paneGalleryFlowRefs.current[rootGroupId],
      shell: paneGalleryShellRefs.current[rootGroupId],
      viewportKind: 'paneGallery',
      rootGroupId,
      paneGalleryViewportRole: viewportRole
    };
    bindActiveCanvasSurface(binding);
    return binding;
  };

  const shouldSkipPaneGalleryInitialFit = (
    rootGroupId: string,
    viewportRole: PaneGalleryViewportRole
  ): boolean =>
    viewportRole === 'main' && pendingPaneGalleryMainNodeFitRootIdsRef.current.has(rootGroupId);

  const handlePaneGalleryPaneClick = (event: React.MouseEvent, rootGroupId: string): void => {
    bindPaneGallerySurface(rootGroupId);
    handlePaneClick(event);
  };

  const handlePaneGalleryContextMenu = (
    event: React.MouseEvent,
    rootGroupId: string,
    targetGroupId = rootGroupId
  ): void => {
    bindPaneGallerySurface(rootGroupId);
    handlePaneContextMenu(event, targetGroupId);
  };

  const handlePaneGalleryDragOver = (event: React.DragEvent, rootGroupId: string): void => {
    bindPaneGallerySurface(rootGroupId);
    handleCanvasDragOver(event as React.DragEvent<HTMLDivElement>);
  };

  const handlePaneGalleryDrop = (event: React.DragEvent, rootGroupId: string): void => {
    const binding = bindPaneGallerySurface(rootGroupId);
    handleCanvasDropForSurface(event, binding, rootGroupId);
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const visibleCenter = resolveVisibleCanvasCenter(reactFlowRef.current, canvasShellRef.current);
      if (!visibleCenter) {
        return;
      }

      postMessage({
        type: 'webview/updateViewportCenter',
        payload: {
          visibleCenter
        }
      });
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, [reactFlowReadyVersion]);

  useEffect(() => {
    const currentSelectedNodeId = localUiState.selectedNodeId;
    const currentSelectedEdgeId = selectedEdgeId;
    if (!currentSelectedNodeId && !currentSelectedEdgeId) {
      return;
    }

    const handleWindowKeyDown = (event: KeyboardEvent): void => {
      if (!shouldDeleteSelectedNodeFromKeyboard(event)) {
        return;
      }

      event.preventDefault();
      if (currentSelectedEdgeId) {
        deleteEdge(currentSelectedEdgeId);
        return;
      }

      if (currentSelectedNodeId) {
        deleteNode(currentSelectedNodeId);
      }
    };

    window.addEventListener('keydown', handleWindowKeyDown);
    return () => {
      window.removeEventListener('keydown', handleWindowKeyDown);
    };
  }, [deleteEdge, localUiState.selectedNodeId, selectedEdgeId]);

  useEffect(() => {
    if (!contextMenu) {
      return;
    }

    const handlePointerDown = (event: PointerEvent): void => {
      if (event.target instanceof globalThis.Node && contextMenuRef.current?.contains(event.target)) {
        return;
      }

      closeFloatingMenus();
    };

    const handleWindowKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') {
        return;
      }

      event.preventDefault();
      setContextMenu((current) => {
        if (!current) {
          closeFloatingMenus();
          return current;
        }
        if (current.view !== 'root') {
          return {
            ...current,
            view: 'root',
            selectedAgentProvider: undefined
          };
        }
        return null;
      });
    };

    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('keydown', handleWindowKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('keydown', handleWindowKeyDown);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (!edgeArrowMenuEdgeId && !edgeColorMenuEdgeId && !edgeLabelEditor) {
      return;
    }

    const handleWindowKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') {
        return;
      }

      event.preventDefault();
      if (edgeLabelEditor) {
        cancelEdgeLabelEdit(edgeLabelEditor.edgeId);
        return;
      }

      closeEdgeMenus();
    };

    window.addEventListener('keydown', handleWindowKeyDown);
    return () => {
      window.removeEventListener('keydown', handleWindowKeyDown);
    };
  }, [cancelEdgeLabelEdit, closeEdgeMenus, edgeArrowMenuEdgeId, edgeColorMenuEdgeId, edgeLabelEditor]);

  const handleConnect = (connection: Connection): void => {
    const sourceAnchor = parseHandleAnchor(connection.sourceHandle);
    const targetAnchor = parseHandleAnchor(connection.targetHandle);
    if (!connection.source || !connection.target || !sourceAnchor || !targetAnchor) {
      return;
    }
    if (!canConnectCanvasEdgeEndpoints(hostState, connection.source, connection.target)) {
      return;
    }

    closeFloatingMenus();
    setSelectedEdgeId(undefined);
    postMessage({
      type: 'webview/createEdge',
      payload: {
        sourceNodeId: connection.source,
        targetNodeId: connection.target,
        sourceAnchor,
        targetAnchor
      }
    });
  };

  const handleEdgeReconnect = (previousEdge: Edge, connection: Connection): void => {
    const sourceAnchor = parseHandleAnchor(connection.sourceHandle);
    const targetAnchor = parseHandleAnchor(connection.targetHandle);
    if (!connection.source || !connection.target || !sourceAnchor || !targetAnchor) {
      return;
    }
    if (!canConnectCanvasEdgeEndpoints(hostState, connection.source, connection.target)) {
      return;
    }

    closeFloatingMenus();
    setSelectedEdgeId(previousEdge.id);
    postMessage({
      type: 'webview/updateEdge',
      payload: {
        edgeId: previousEdge.id,
        sourceNodeId: connection.source,
        targetNodeId: connection.target,
        sourceAnchor,
        targetAnchor
      }
    });
  };

  const handleEdgeClick: EdgeMouseHandler = (event, edge) => {
    stopCanvasEvent(event);

    closePaneContextMenu();
    closeEdgeMenus();
    setSelectedEdgeId(edge.id);
    setLocalUiState((current) => ({
      ...current,
      selectedNodeId: undefined,
      selectedNodeIds: undefined,
      selectedGroupId: undefined,
      selectedGroupIds: undefined
    }));
  };

  const handleEdgeDoubleClick: EdgeMouseHandler = (event, edge) => {
    stopCanvasEvent(event);
    setSelectedEdgeId(edge.id);
    startEdgeLabelEdit(edge.id);
  };

  const handleEdgeContextMenu: EdgeMouseHandler = (event) => {
    event.preventDefault();
    stopCanvasEvent(event);
  };

  const handleCanvasOverviewViewportStateChange = useCallback((nextState: CanvasOverviewViewportState): void => {
    setCanvasOverviewMode((current) => (current === nextState.active ? current : nextState.active));
    setCanvasOverviewTitleScale((current) =>
      Math.abs(current - nextState.titleScale) < 0.01 ? current : nextState.titleScale
    );
  }, []);

  const canvasShellStyle = useMemo(
    () =>
      ({
        '--canvas-overview-title-scale': canvasOverviewTitleScale
      }) as CSSProperties,
    [canvasOverviewTitleScale]
  );
  const setPaneGalleryState = (updater: (current: PaneGalleryLocalState | undefined) => PaneGalleryLocalState): void => {
    setLocalUiState((current) => ({
      ...current,
      paneGallery: updater(current.paneGallery)
    }));
  };
  const savePaneGalleryViewport = (
    rootGroupId: string,
    viewport: Viewport,
    viewportRole: PaneGalleryViewportRole = resolvePaneGalleryViewportRole(
      normalizePaneGalleryLayoutMode(localUiStateRef.current.paneGallery?.layout) ??
        PANE_GALLERY_DEFAULT_OVERVIEW_LAYOUT
    )
  ): void => {
    const viewportKey = viewportRole === 'main' ? 'mainViewports' : 'overviewViewports';
    setPaneGalleryState((current) => ({
      ...current,
      [viewportKey]: {
        ...(current?.[viewportKey] ?? {}),
        [rootGroupId]: viewport
      }
    }));
  };
  const resolvePaneGalleryRootContentBounds = (
    rootGroupId: string
  ): CanvasMiniMapRect | undefined => {
    const model = paneGalleryRootModels.find((candidate) => candidate.rootGroup.id === rootGroupId);
    return model ? resolvePaneGalleryModelContentBounds(model) : undefined;
  };
  const fitPaneGalleryRoot = (
    rootGroupId: string,
    instance = paneGalleryFlowRefs.current[rootGroupId],
    duration = 0,
    options: { viewportRole?: PaneGalleryViewportRole; requirePaneMode?: 'main' } = {}
  ): boolean => {
    const viewportRole =
      options.viewportRole ??
      resolvePaneGalleryViewportRole(
        normalizePaneGalleryLayoutMode(localUiStateRef.current.paneGallery?.layout) ??
          PANE_GALLERY_DEFAULT_OVERVIEW_LAYOUT
      );
    const contentBounds = resolvePaneGalleryRootContentBounds(rootGroupId);
    const shell = paneGalleryShellRefs.current[rootGroupId];
    if (!instance?.viewportInitialized || !contentBounds || !shell) {
      return false;
    }
    if (options.requirePaneMode) {
      const paneElement = shell.closest('.pane-gallery-root-pane');
      if (
        !(paneElement instanceof HTMLElement) ||
        paneElement.dataset.paneGalleryRootMode !== options.requirePaneMode
      ) {
        return false;
      }
    }

    const viewport = getViewportForBounds(
      contentBounds,
      Math.max(1, shell.clientWidth),
      Math.max(1, shell.clientHeight),
      PANE_GALLERY_MIN_ZOOM,
      CANVAS_MAX_ZOOM,
      PANE_GALLERY_FIT_VIEW_PADDING
    );
    instance.setViewport(viewport, { duration });
    savePaneGalleryViewport(rootGroupId, viewport, viewportRole);
    return true;
  };
  const hasPaneGalleryMainViewport = (rootGroupId: string): boolean =>
    paneGalleryState?.mainViewports?.[rootGroupId] !== undefined;
  const schedulePaneGalleryRootFit = (
    rootGroupId: string,
    options: { viewportRole?: PaneGalleryViewportRole; requirePaneMode?: 'main' } = {},
    duration = 0
  ): void => {
    let remainingAttempts = 8;
    const tryFit = (): void => {
      if (fitPaneGalleryRoot(rootGroupId, undefined, duration, options)) {
        return;
      }
      remainingAttempts -= 1;
      if (remainingAttempts > 0) {
        window.setTimeout(tryFit, 50);
      }
    };

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(tryFit);
    });
  };
  const updatePaneGalleryLayout = (
    layout: PaneGalleryLayoutMode,
    activeRootGroupId = activePaneGalleryRootId,
    options: { fitRoot?: boolean } = {}
  ): void => {
    const currentLayout = normalizedPaneGalleryLayout;
    const currentActiveRootGroupId = activePaneGalleryRootId;
    const enteringThumbnailLayout =
      !isPaneGalleryThumbnailLayout(currentLayout) && isPaneGalleryThumbnailLayout(layout);
    const switchingThumbnailMainPane =
      isPaneGalleryThumbnailLayout(currentLayout) &&
      isPaneGalleryThumbnailLayout(layout) &&
      activeRootGroupId !== currentActiveRootGroupId;
    if (enteringThumbnailLayout || switchingThumbnailMainPane) {
      clearCanvasTransientInteractionState();
    }

    const lastOverviewLayout =
      normalizePaneGalleryOverviewLayoutMode(layout) ?? lastPaneGalleryOverviewLayout;
    const lastThumbnailLayout =
      normalizePaneGalleryThumbnailLayoutMode(layout) ?? lastPaneGalleryThumbnailLayout;
    setPaneGalleryState((current) => ({
      ...current,
      layout,
      activeRootGroupId,
      lastOverviewLayout,
      lastThumbnailLayout
    }));
    if (options.fitRoot === false) {
      return;
    }
    if (!activeRootGroupId) {
      return;
    }

    const thumbnailMainRootNeedsFit =
      isPaneGalleryThumbnailLayout(layout) && !hasPaneGalleryMainViewport(activeRootGroupId);
    if (thumbnailMainRootNeedsFit) {
      schedulePaneGalleryRootFit(activeRootGroupId, {
        viewportRole: 'main',
        requirePaneMode: 'main'
      });
    }
  };
  useEffect(() => {
    if (
      !isPaneGalleryPresentation ||
      !isPaneGalleryThumbnailLayout(normalizedPaneGalleryLayout) ||
      !activePaneGalleryRootId ||
      pendingPaneGalleryMainNodeFitRootIdsRef.current.has(activePaneGalleryRootId) ||
      hasPaneGalleryMainViewport(activePaneGalleryRootId)
    ) {
      return;
    }

    schedulePaneGalleryRootFit(activePaneGalleryRootId, { viewportRole: 'main', requirePaneMode: 'main' });
  }, [
    activePaneGalleryRootId,
    isPaneGalleryPresentation,
    normalizedPaneGalleryLayout,
    activePaneGalleryRootId ? paneGalleryState?.mainViewports?.[activePaneGalleryRootId] !== undefined : false
  ]);
  const handlePaneGalleryNodeDragStop = (
    rootGroupId: string,
    event: React.MouseEvent,
    node: CanvasFlowNode,
    draggedNodes: CanvasFlowNode[]
  ): void => {
    bindPaneGallerySurface(rootGroupId);
    const paneFlow = paneGalleryFlowRefs.current[rootGroupId];
    const pointerPosition = paneFlow?.screenToFlowPosition({
      x: event.clientX,
      y: event.clientY
    });
    const primaryPointerPosition = pointerPosition
      ? {
          x: Math.round(pointerPosition.x),
          y: Math.round(pointerPosition.y)
        }
      : undefined;
    const draggedNodeIds = new Set(draggedNodes.map((draggedNode) => draggedNode.id));
    const selectedFlowNodesById = new Map(
      nodes
        .filter(
          (candidate) =>
            candidate.id !== node.id &&
            isCanvasNodeInPaneGalleryRoot(candidate.id, rootGroupId) &&
            candidate.selected &&
            !draggedNodeIds.has(candidate.id) &&
            candidate.draggable !== false &&
            nodeLayoutDrafts[candidate.id]?.position
        )
        .map((candidate) => [candidate.id, candidate] as const)
    );
    const selectedMoves = [
      ...draggedNodes.filter((draggedNode) => draggedNode.id !== node.id),
      ...selectedFlowNodesById.values()
    ].map((draggedNode) => {
      const draftPosition = nodeLayoutDrafts[draggedNode.id]?.position;
      const resolvedPosition = draftPosition ?? draggedNode.position;
      return {
        id: draggedNode.id,
        position: {
          x: Math.round(resolvedPosition.x),
          y: Math.round(resolvedPosition.y)
        },
        pointerPosition: primaryPointerPosition
      };
    });
    const nodeDraftPosition = nodeLayoutDrafts[node.id]?.position;
    const nodePosition = nodeDraftPosition ?? node.position;
    markCommittedNodeLayoutDrafts([node.id, ...selectedMoves.map((move) => move.id)]);
    postMessage({
      type: 'webview/moveNode',
      payload: {
        id: node.id,
        position: {
          x: Math.round(nodePosition.x),
          y: Math.round(nodePosition.y)
        },
        pointerPosition: primaryPointerPosition,
        selectedMoves: selectedMoves.length > 0 ? selectedMoves : undefined
      }
    });
  };
  return (
    <div
      ref={canvasShellRef}
      className={`canvas-shell ${canvasOverviewMode && !isPaneGalleryPresentation ? 'is-overview-mode' : ''} ${
        isPaneGalleryPresentation ? 'is-pane-gallery' : ''
      }`.trim()}
      data-canvas-overview-mode={canvasOverviewMode && !isPaneGalleryPresentation ? 'true' : 'false'}
      data-canvas-overview-config={runtimeContext.overviewMode}
      style={canvasShellStyle}
      tabIndex={runtimeContext.surfaceLocation === 'editor' ? -1 : undefined}
      onDragOver={handleCanvasDragOver}
      onDrop={handleCanvasDrop}
    >
      <CanvasOverviewInteractionContext.Provider value={isPaneGalleryPresentation ? false : canvasOverviewMode}>
        <CanvasExecutionHelpPanel help={EXECUTION_NODE_HELP_TIPS} />
        {isPaneGalleryPresentation ? (
          <PaneGallery
            models={paneGalleryRootModels}
            allModels={paneGalleryRootModels}
            activeRootGroupId={activePaneGalleryRootId}
            layout={normalizedPaneGalleryLayout}
            lastOverviewLayout={lastPaneGalleryOverviewLayout}
            lastThumbnailLayout={lastPaneGalleryThumbnailLayout}
            overviewViewports={paneGalleryState?.overviewViewports ?? {}}
            mainViewports={paneGalleryState?.mainViewports ?? {}}
            selectedGroupIds={selectedGroupIds}
            overviewMode={runtimeContext.overviewMode}
            overviewZoomThreshold={runtimeContext.overviewZoomThreshold}
            t={t}
            tCount={tCount}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            nodeFocusAnimationDurationMs={NODE_FOCUS_ANIMATION_DURATION_MS}
            paneRefs={paneGalleryShellRefs}
            flowRefs={paneGalleryFlowRefs}
            onBindActiveSurface={bindPaneGallerySurface}
            shouldSkipInitialFit={shouldSkipPaneGalleryInitialFit}
            onSetLayout={updatePaneGalleryLayout}
            onFitPane={fitPaneGalleryRoot}
            onSavePaneViewport={savePaneGalleryViewport}
            onNodesChange={handleNodesChange}
            onNodeDragStop={handlePaneGalleryNodeDragStop}
            onConnect={handleConnect}
            onEdgeClick={handleEdgeClick}
            onEdgeDoubleClick={handleEdgeDoubleClick}
            onReconnect={handleEdgeReconnect}
            onEdgeContextMenu={handleEdgeContextMenu}
            onNodeClick={handleNodeClick}
            onPaneClick={handlePaneGalleryPaneClick}
            onPaneContextMenu={handlePaneGalleryContextMenu}
            onPaneDragOver={handlePaneGalleryDragOver}
            onPaneDrop={handlePaneGalleryDrop}
            onSelectGroupBody={selectGroup}
            onFocusGroupInViewport={focusGroupInViewport}
            onSelectGroup={selectGroup}
            onDraftGroup={updateGroupDraft}
            onGroupInteractionStart={handleGroupInteractionStart}
            onGroupInteractionEnd={handleGroupInteractionEnd}
            onMoveGroup={handleMoveGroup}
            onResizeGroup={handleResizeGroup}
            onUpdateGroupTitle={handleUpdateGroupTitle}
            onUngroup={handleUngroup}
            onDeleteGroup={handleDeleteGroup}
            onDragPointerMove={handleGroupDragPointerMove}
            onDragEnd={handleGroupDragEnd}
            onResizePointerMove={handleGroupResizePointerMove}
            onResizeEnd={handleGroupResizeEnd}
          />
        ) : (
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          connectionMode={ConnectionMode.Loose}
          defaultViewport={localUiState.viewport}
          minZoom={dynamicCanvasMinZoom}
          maxZoom={CANVAS_MAX_ZOOM}
          onInit={(instance) => {
            reactFlowRef.current = instance;
            bindActiveCanvasSurface({
              flow: instance,
              shell: canvasShellRef.current,
              viewportKind: 'rootGroups'
            });
            setReactFlowReadyVersion((current) => current + 1);
          }}
          onNodesChange={handleNodesChange}
          onConnect={handleConnect}
          onEdgeClick={handleEdgeClick}
          onEdgeDoubleClick={handleEdgeDoubleClick}
          onReconnect={handleEdgeReconnect}
          onEdgeContextMenu={handleEdgeContextMenu}
          connectionLineStyle={{
            stroke: 'var(--canvas-edge-stroke-default)',
            strokeWidth: 2
          }}
          onNodeClick={handleNodeClick}
          onNodeDragStop={handleNodeDragStop}
          multiSelectionKeyCode={null}
          selectNodesOnDrag={false}
          onPointerDownCapture={() =>
            bindActiveCanvasSurface({
              flow: reactFlowRef.current,
              shell: canvasShellRef.current,
              viewportKind: 'rootGroups'
            })
          }
          onMouseEnter={() =>
            bindActiveCanvasSurface({
              flow: reactFlowRef.current,
              shell: canvasShellRef.current,
              viewportKind: 'rootGroups'
            })
          }
          onMoveStart={handleMoveStart}
          onPaneClick={handlePaneClick}
          onPaneContextMenu={handlePaneContextMenu}
          onMoveEnd={handleMoveEnd}
          proOptions={{ hideAttribution: true }}
        >
          <CanvasOverviewModeBridge
            mode={runtimeContext.overviewMode}
            threshold={runtimeContext.overviewZoomThreshold}
            onViewportStateChange={handleCanvasOverviewViewportStateChange}
          />
          <Background variant={BackgroundVariant.Dots} gap={24} size={1.2} />
          <CanvasGroupsViewportLayer
            groups={groups}
            workspaceRootWatermarksEnabled={runtimeContext.workspaceRootWatermarksEnabled}
            selectedGroupIds={resolveSelectedGroupIds(localUiState)}
            t={t}
            onSelectGroupBody={selectGroup}
            onFocusGroupInViewport={focusGroupInViewport}
            onGroupBodyContextMenu={handlePaneContextMenu}
            onGroupContextMenu={handlePaneContextMenu}
            onSelectGroup={selectGroup}
            onDraftGroup={updateGroupDraft}
            onGroupInteractionStart={handleGroupInteractionStart}
            onGroupInteractionEnd={handleGroupInteractionEnd}
            onMoveGroup={handleMoveGroup}
            onResizeGroup={handleResizeGroup}
            onUpdateGroupTitle={handleUpdateGroupTitle}
            onUngroup={handleUngroup}
            onDeleteGroup={handleDeleteGroup}
            onDragPointerMove={handleGroupDragPointerMove}
            onDragEnd={handleGroupDragEnd}
            onResizePointerMove={handleGroupResizePointerMove}
            onResizeEnd={handleGroupResizeEnd}
          />
          <CanvasMiniMap
            nodes={nodes}
            groups={groups}
            spatialBounds={canvasSpatialBounds}
            viewportSize={canvasViewportSize}
            minimapLabel={t('canvas.minimap')}
            onViewportCommit={persistCanvasViewport}
          />
          <Controls
            className="canvas-corner-panel canvas-controls"
            showInteractive={false}
            showFitView={false}
          >
            <button
              type="button"
              className="react-flow__controls-button react-flow__controls-fitview"
              title={t('canvas.fitView')}
              aria-label={t('canvas.fitView')}
              onClick={() => {
                fitCanvasView(NODE_FOCUS_ANIMATION_DURATION_MS);
              }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 25 32" aria-hidden="true" focusable="false">
                <path d="M3.692 4.63c0-.53.4-.938.939-.938h5.215V0H4.708C2.13 0 0 2.054 0 4.63v5.216h3.692V4.631zM20.292 0h-5.2v3.692h5.17c.53 0 .984.4.984.939v5.215h3.692V4.631A4.624 4.624 0 0020.292 0zm.954 24.83c0 .532-.4.94-.939.94h-5.215v3.768h5.215c2.577 0 4.631-2.13 4.631-4.707v-5.139h-3.692v5.139zm-16.615.94c-.531 0-.939-.4-.939-.94v-5.138H0v5.139c0 2.577 2.13 4.707 4.708 4.707h5.138V25.77H4.631z" />
              </svg>
            </button>
          </Controls>
        </ReactFlow>
        )}
      </CanvasOverviewInteractionContext.Provider>

      {contextMenu ? (
        <CanvasContextMenu
          ref={contextMenuRef}
          screenX={contextMenu.screenX}
          screenY={contextMenu.screenY}
          view={contextMenu.view}
          selectedAgentProvider={contextMenu.selectedAgentProvider}
          kinds={creatableKinds}
          templateEntries={templateMenuEntries}
          defaultAgentProvider={runtimeContext.defaultAgentProvider}
          agentLaunchDefaults={runtimeContext.agentLaunchDefaults}
          canSaveCurrentCanvas={hostState?.nodes.some((node) => isTemplateCompatibleNodeKind(node.kind)) ?? false}
          canCreateGroupFromSelection={contextMenu.canCreateGroupFromSelection === true}
          canArrangeWorkspaceLayoutScope={shouldOfferWorkspaceArrangeLayoutScope(
            contextMenu.targetGroupId,
            contextMenu.flowAnchor
          )}
          canClearWorkspaceCanvasScope={shouldOfferWorkspaceClearCanvasScope(
            contextMenu.targetGroupId,
            contextMenu.flowAnchor
          )}
          clearCanvasTargetKind={resolveClearCanvasTargetKind(
            contextMenu.targetGroupId,
            contextMenu.flowAnchor
          )}
          onCreateEmptyGroup={() => {
            handleCreateEmptyGroup(contextMenu.flowAnchor, contextMenu.targetGroupId);
            closePaneContextMenu();
          }}
          onCreateGroupFromSelection={() => {
            handleCreateGroupFromSelection(
              contextMenu.selectedNodeIds ?? [],
              contextMenu.selectedGroupIds ?? [],
              contextMenu.targetGroupId
            );
            closePaneContextMenu();
          }}
          onCreate={(kind, agentProvider, agentLaunchPreset, agentCustomLaunchCommand) => {
            createNode(
              kind,
              resolveCreateNodePreferredPositionFromFlowAnchor(kind, contextMenu.flowAnchor),
              contextMenu.targetGroupId,
              agentProvider,
              agentLaunchPreset,
              agentCustomLaunchCommand
            );
            closePaneContextMenu();
          }}
          onShowAgentLaunchModes={(provider) =>
            setContextMenu((current) =>
              current
                ? {
                    ...current,
                    view: 'agent-launch-mode',
                    selectedAgentProvider: provider
                  }
                : current
            )
          }
          onShowTemplatePicker={(view) =>
            {
              if (view === 'reset-template' && shouldPromptForRootGroupTemplateReset(contextMenu.targetGroupId)) {
                promptForRootGroupTemplateResetTarget();
                return;
              }

              setContextMenu((current) =>
                current
                  ? {
                      ...current,
                      view,
                      selectedAgentProvider: undefined
                    }
                  : current
              );
            }
          }
          onShowArrangeLayoutScope={() =>
            setContextMenu((current) =>
              current
                ? {
                    ...current,
                    view: 'arrange-layout-scope',
                    selectedAgentProvider: undefined
                  }
                : current
            )
          }
          onShowClearCanvasScope={() =>
            setContextMenu((current) =>
              current
                ? {
                    ...current,
                    view: 'clear-canvas-scope',
                    selectedAgentProvider: undefined
                  }
                : current
            )
          }
          onApplyDefaultTemplate={() => {
            postMessage({
              type: 'webview/applyDefaultTemplate',
              payload: {
                visibleCenter: resolveVisibleCanvasCenter(
                  activeCanvasSurfaceRef.current.flow,
                  activeCanvasSurfaceRef.current.shell
                ),
                targetGroupId: contextMenu.targetGroupId
              }
            });
            closePaneContextMenu();
          }}
          onResetToDefaultTemplate={() => {
            if (shouldPromptForRootGroupTemplateReset(contextMenu.targetGroupId)) {
              promptForRootGroupTemplateResetTarget();
              return;
            }

            postMessage({
              type: 'webview/resetToDefaultTemplate',
              payload: {
                visibleCenter: resolveVisibleCanvasCenter(
                  activeCanvasSurfaceRef.current.flow,
                  activeCanvasSurfaceRef.current.shell
                ),
                targetGroupId: contextMenu.targetGroupId
              }
            });
            closePaneContextMenu();
          }}
          onArrangeCanvasLayout={(scope) => {
            const targetGroupId =
              scope === 'target'
                ? resolveArrangeLayoutRootGroupId(contextMenu.targetGroupId, contextMenu.flowAnchor)
                : undefined;
            postMessage({
              type: 'webview/arrangeCanvasLayout',
              ...(targetGroupId
                ? {
                    payload: {
                      targetGroupId
                    }
                  }
                : {})
            });
            closePaneContextMenu();
          }}
          onClearCanvas={(scope) => {
            const targetGroupId =
              scope === 'target'
                ? resolveClearCanvasTargetGroupId(contextMenu.targetGroupId, contextMenu.flowAnchor)
                : undefined;
            postMessage({
              type: 'webview/clearCanvas',
              ...(targetGroupId
                ? {
                    payload: {
                      targetGroupId
                    }
                  }
                : {})
            });
            closePaneContextMenu();
          }}
          onApplyTemplate={(templateId, reset) => {
            if (reset && shouldPromptForRootGroupTemplateReset(contextMenu.targetGroupId)) {
              promptForRootGroupTemplateResetTarget();
              return;
            }

            postMessage({
              type: reset ? 'webview/resetToTemplate' : 'webview/applyTemplate',
              payload: {
                templateId,
                visibleCenter: resolveVisibleCanvasCenter(
                  activeCanvasSurfaceRef.current.flow,
                  activeCanvasSurfaceRef.current.shell
                ),
                targetGroupId: contextMenu.targetGroupId
              }
            });
            closePaneContextMenu();
          }}
          onSaveCanvasAsTemplate={() => {
            postMessage({
              type: 'webview/saveCanvasAsTemplate'
            });
            closePaneContextMenu();
          }}
          onBack={() =>
            setContextMenu((current) => {
              if (!current) {
                return current;
              }
              return {
                ...current,
                view: 'root',
                selectedAgentProvider: undefined
              };
            })
          }
          onClose={closePaneContextMenu}
        />
      ) : null}

      {errorMessage ? (
        <div className="toast-error" data-toast-kind="error">
          {errorMessage}
        </div>
      ) : null}
    </div>
  );

  function createNode(
    kind: CanvasCreatableNodeKind,
    preferredPosition?: CanvasNodePosition,
    targetGroupId?: string,
    agentProvider?: AgentProviderKind,
    agentLaunchPreset?: AgentLaunchPresetKind,
    agentCustomLaunchCommand?: string,
    options?: {
      skipWorkspaceTrustCheck?: boolean;
      cwd?: string;
      useDefaultPlacement?: boolean;
    }
  ): void {
    if (!options?.skipWorkspaceTrustCheck && !workspaceTrusted && (kind === 'agent' || kind === 'terminal')) {
      postMessage({
        type: 'webview/showCreateNodeBlockedReason',
        payload: {
          kind
        }
      });
      return;
    }

    const requestId = createManualNodeCreateRequestId();
    const resolvedPreferredPosition =
      options?.useDefaultPlacement === true
        ? undefined
        : preferredPosition ?? resolveCreateNodePreferredPosition(kind, reactFlowRef.current);
    const resolvedAgentProvider = kind === 'agent' ? agentProvider ?? runtimeContext.defaultAgentProvider : undefined;
    const resolvedAgentLaunchPreset = kind === 'agent' ? agentLaunchPreset ?? 'default' : undefined;
    pendingManualCreateRequestRef.current = {
      requestId,
      knownNodeIdsSnapshot: new Set(latestHostNodeIdsRef.current),
      kind,
      preferredPosition: resolvedPreferredPosition,
      targetGroupId,
      agentProvider: resolvedAgentProvider,
      agentLaunchPreset: resolvedAgentLaunchPreset,
      agentCustomLaunchCommand:
        resolvedAgentLaunchPreset === 'custom' ? agentCustomLaunchCommand?.trim() || undefined : undefined,
      cwd: options?.cwd
    };
    postMessage({
      type: 'webview/createDemoNode',
      payload: {
        requestId,
        kind,
        preferredPosition: resolvedPreferredPosition,
        targetGroupId,
        cwd: options?.cwd,
        agentProvider,
        agentLaunchPreset,
        agentCustomLaunchCommand
      }
    });
  }
}

function centerNodeInViewportWithoutExtraZoomIfPossible(
  reactFlowInstance: ReactFlowInstance<CanvasNodeData>,
  canvasShellElement: HTMLDivElement | null,
  hostState: CanvasPrototypeState | null,
  nodeId: string,
  durationMs: number
): boolean {
  const targetNode = hostState?.nodes.find((candidate) => candidate.id === nodeId);
  if (!targetNode) {
    return false;
  }

  const currentViewport = reactFlowInstance.getViewport();
  if (isCanvasNodeFullyVisible(targetNode, currentViewport, canvasShellElement)) {
    const footprint = normalizeCanvasNodeFootprint(targetNode.kind, targetNode.size);
    reactFlowInstance.setCenter(
      targetNode.position.x + footprint.width / 2,
      targetNode.position.y + footprint.height / 2,
      {
        zoom: currentViewport.zoom,
        duration: durationMs
      }
    );
    return true;
  }

  return reactFlowInstance.fitView({
    nodes: [{ id: nodeId }],
    padding: NODE_FOCUS_VIEW_PADDING,
    maxZoom: NODE_FOCUS_MAX_ZOOM,
    minZoom: NODE_FOCUS_MIN_ZOOM,
    duration: durationMs
  });
}

function isCanvasNodeFullyVisible(
  node: CanvasNodeSummary,
  viewport: Viewport,
  canvasShellElement: HTMLDivElement | null
): boolean {
  const footprint = normalizeCanvasNodeFootprint(node.kind, node.size);
  const viewportWidth = Math.max(1, canvasShellElement?.clientWidth ?? window.innerWidth);
  const viewportHeight = Math.max(1, canvasShellElement?.clientHeight ?? window.innerHeight);
  const left = node.position.x * viewport.zoom + viewport.x;
  const top = node.position.y * viewport.zoom + viewport.y;
  const right = (node.position.x + footprint.width) * viewport.zoom + viewport.x;
  const bottom = (node.position.y + footprint.height) * viewport.zoom + viewport.y;

  return left >= 0 && top >= 0 && right <= viewportWidth && bottom <= viewportHeight;
}

function isPendingViewportTargetAvailable(
  state: CanvasPrototypeState | null,
  request: PendingNodeViewportRequest
): boolean {
  if (!state) {
    return false;
  }

  return request.objectKind === 'group'
    ? (state.groups ?? []).some((group) => group.id === request.objectId)
    : state.nodes.some((node) => node.id === request.objectId);
}

function resolvePendingManualNodeCreateTarget(
  state: CanvasPrototypeState,
  nodes: CanvasNodeSummary[],
  knownNodeIds: ReadonlySet<string>,
  request: PendingManualNodeCreateRequest
): CanvasNodeSummary | undefined {
  const createdNodes = nodes.filter(
    (node) => !knownNodeIds.has(node.id) && doesNodeMatchPendingManualCreateRequest(state, node, request)
  );
  if (createdNodes.length === 0) {
    return undefined;
  }

  if (!request.preferredPosition) {
    return createdNodes[createdNodes.length - 1];
  }

  let bestCandidate = createdNodes[0];
  let bestDistance = canvasPositionDistance(bestCandidate.position, request.preferredPosition);
  for (const candidate of createdNodes.slice(1)) {
    const distance = canvasPositionDistance(candidate.position, request.preferredPosition);
    if (distance < bestDistance) {
      bestCandidate = candidate;
      bestDistance = distance;
    }
  }

  return bestCandidate;
}

function doesNodeMatchPendingManualCreateRequest(
  state: CanvasPrototypeState,
  node: CanvasNodeSummary,
  request: PendingManualNodeCreateRequest
): boolean {
  if (node.kind !== request.kind) {
    return false;
  }

  if (request.targetGroupId && node.groupId !== request.targetGroupId) {
    const targetGroup = state.groups.find((group) => group.id === request.targetGroupId);
    if (targetGroup?.role !== 'workspace-root') {
      return false;
    }
    if (!node.groupId || !isCanvasGroupInsideTargetRoot(state.groups, node.groupId, targetGroup.id)) {
      return false;
    }
  }

  if (node.kind !== 'agent') {
    if (request.cwd && node.kind === 'terminal' && node.metadata?.terminal?.cwd !== request.cwd) {
      return false;
    }
    return true;
  }

  const agentMetadata = node.metadata?.agent;
  if (!agentMetadata) {
    return false;
  }

  if (request.agentProvider && agentMetadata.provider !== request.agentProvider) {
    return false;
  }

  if (request.cwd && agentMetadata.cwd !== request.cwd) {
    return false;
  }

  if (request.agentLaunchPreset && agentMetadata.launchPreset !== request.agentLaunchPreset) {
    return false;
  }

  if (request.agentLaunchPreset === 'custom') {
    return (request.agentCustomLaunchCommand ?? '') === (agentMetadata.customLaunchCommand ?? '');
  }

  return true;
}

function resolveVisibleCanvasCenter(
  reactFlowInstance: ReactFlowInstance<CanvasNodeData> | null | undefined,
  canvasShellElement: HTMLDivElement | null
): CanvasNodePosition | undefined {
  if (!reactFlowInstance?.viewportInitialized || !canvasShellElement) {
    return undefined;
  }

  const bounds = canvasShellElement.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0) {
    return undefined;
  }

  const flowCenter = reactFlowInstance.screenToFlowPosition({
    x: bounds.left + bounds.width / 2,
    y: bounds.top + bounds.height / 2
  });

  return {
    x: Math.round(flowCenter.x),
    y: Math.round(flowCenter.y)
  };
}

function resolveVisibleCanvasCenterFromViewport(
  viewport: Viewport,
  canvasShellElement: HTMLDivElement | null
): CanvasNodePosition | undefined {
  if (!canvasShellElement || viewport.zoom <= 0) {
    return undefined;
  }

  const bounds = canvasShellElement.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0) {
    return undefined;
  }

  return {
    x: Math.round((bounds.width / 2 - viewport.x) / viewport.zoom),
    y: Math.round((bounds.height / 2 - viewport.y) / viewport.zoom)
  };
}

function canvasPositionDistance(left: CanvasNodePosition, right: CanvasNodePosition): number {
  return Math.abs(left.x - right.x) + Math.abs(left.y - right.y);
}

function createCanvasAutoPanController(
  reactFlowInstance: ReactFlowInstance<CanvasNodeData> | null,
  canvasShellElement: HTMLDivElement | null,
  onViewportChange: (viewport: Viewport) => void
): AutoPanController {
  let frameId: number | undefined;
  let pointer: { clientX: number; clientY: number } | null = null;
  let onPanFrame: ((previousViewport: Viewport, nextViewport: Viewport) => void) | undefined;
  let running = false;

  const tick = (): void => {
    if (!running || !reactFlowInstance?.viewportInitialized || !canvasShellElement || !pointer) {
      frameId = undefined;
      running = false;
      return;
    }

    const bounds = canvasShellElement.getBoundingClientRect();
    const delta = resolveCanvasAutoPanDelta(pointer, bounds);
    if (delta.x !== 0 || delta.y !== 0) {
      const currentViewport = reactFlowInstance.getViewport();
      const nextViewport = {
        ...currentViewport,
        x: currentViewport.x + delta.x,
        y: currentViewport.y + delta.y
      };
      reactFlowInstance.setViewport(nextViewport);
      onViewportChange(nextViewport);
      onPanFrame?.(currentViewport, nextViewport);
    }

    frameId = window.requestAnimationFrame(tick);
  };

  return {
    handlePointerMove(event, onPan) {
      pointer = { clientX: event.clientX, clientY: event.clientY };
      onPanFrame = onPan;
      if (running) {
        return;
      }

      running = true;
      frameId = window.requestAnimationFrame(tick);
    },
    stop() {
      running = false;
      pointer = null;
      onPanFrame = undefined;
      if (frameId !== undefined) {
        window.cancelAnimationFrame(frameId);
        frameId = undefined;
      }
    }
  };
}

function resolveCanvasAutoPanDelta(
  pointer: { clientX: number; clientY: number },
  bounds: DOMRect
): CanvasNodePosition {
  const edgeThreshold = CANVAS_AUTO_PAN_EDGE_THRESHOLD_PX;
  const maxSpeed = CANVAS_AUTO_PAN_MAX_SPEED_PX;

  return {
    x: resolveCanvasAutoPanAxisDelta(pointer.clientX, bounds.left, bounds.right, edgeThreshold, maxSpeed),
    y: resolveCanvasAutoPanAxisDelta(pointer.clientY, bounds.top, bounds.bottom, edgeThreshold, maxSpeed)
  };
}

function resolveCanvasAutoPanAxisDelta(
  pointerValue: number,
  start: number,
  end: number,
  edgeThreshold: number,
  maxSpeed: number
): number {
  if (pointerValue < start + edgeThreshold) {
    return Math.round(((start + edgeThreshold - pointerValue) / edgeThreshold) * maxSpeed);
  }

  if (pointerValue > end - edgeThreshold) {
    return -Math.round(((pointerValue - (end - edgeThreshold)) / edgeThreshold) * maxSpeed);
  }

  return 0;
}

function createManualNodeCreateRequestId(): string {
  return `create-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function ExecutionAttentionStatus(props: {
  status: string;
  attentionPending: boolean;
}): JSX.Element {
  return (
    <div className="execution-status-cluster">
      {props.attentionPending ? (
        <span
          className={`execution-attention-indicator codicon codicon-${CANVAS_ATTENTION_INDICATOR_ICON_ID}`}
          data-attention-indicator="true"
          aria-label={t('execution.attention.unacknowledgedTerminal')}
          title={t('execution.attention.unacknowledgedTerminal')}
        />
      ) : null}
      <span className={`status-pill ${statusToneClass(props.status)}`}>
        {webviewHumanizeCanvasStatus(props.status)}
      </span>
    </div>
  );
}

function RestrictedBanner(props: { title: string; description: string }): JSX.Element {
  return (
    <div className="restricted-banner">
      <strong>{props.title}</strong>
      <span>{props.description}</span>
    </div>
  );
}

function NodeOverviewTitle(props: { title: string; status?: string }): JSX.Element {
  return (
    <div className="node-overview-title" aria-hidden="true">
      <span className="node-overview-title-label">{props.title}</span>
      {props.status ? (
        <span
          className={`node-overview-status ${statusToneClass(props.status)}`}
          data-overview-status={props.status}
        >
          <span className="node-overview-status-dot" />
          <span>{webviewHumanizeCanvasStatus(props.status)}</span>
        </span>
      ) : null}
    </div>
  );
}

function overviewStatusForNode(data: CanvasNodeData): string | undefined {
  return data.kind === 'agent' || data.kind === 'terminal' ? data.status : undefined;
}

function NodeHandles(props: { selected: boolean }): JSX.Element {
  return (
    <>
      <Handle
        id="top"
        type="source"
        position={Position.Top}
        className={`canvas-node-handle anchor-top ${props.selected ? 'is-selected' : ''}`}
      />
      <Handle
        id="right"
        type="source"
        position={Position.Right}
        className={`canvas-node-handle anchor-right ${props.selected ? 'is-selected' : ''}`}
      />
      <Handle
        id="bottom"
        type="source"
        position={Position.Bottom}
        className={`canvas-node-handle anchor-bottom ${props.selected ? 'is-selected' : ''}`}
      />
      <Handle
        id="left"
        type="source"
        position={Position.Left}
        className={`canvas-node-handle anchor-left ${props.selected ? 'is-selected' : ''}`}
      />
    </>
  );
}

function resolveNodeResizeGeometry(
  resizeStart: {
    clientX: number;
    clientY: number;
    position: CanvasNodePosition;
    size: CanvasNodeFootprint;
    direction: CanvasNodeResizeDirection;
    autoPanOffset: CanvasNodePosition;
  },
  event: Pick<PointerEvent | React.PointerEvent, 'clientX' | 'clientY'>,
  zoom: number,
  minimum: CanvasNodeFootprint
): CanvasNodeResizeDraft {
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const deltaX = (event.clientX - resizeStart.clientX) / safeZoom + resizeStart.autoPanOffset.x;
  const deltaY = (event.clientY - resizeStart.clientY) / safeZoom + resizeStart.autoPanOffset.y;
  const resizeLeft = resizeStart.direction.includes('left');
  const resizeRight = resizeStart.direction.includes('right');
  const resizeTop = resizeStart.direction.includes('top');
  const resizeBottom = resizeStart.direction.includes('bottom');
  const width = Math.max(
    minimum.width,
    Math.round(resizeStart.size.width + (resizeRight ? deltaX : 0) - (resizeLeft ? deltaX : 0))
  );
  const height = Math.max(
    minimum.height,
    Math.round(resizeStart.size.height + (resizeBottom ? deltaY : 0) - (resizeTop ? deltaY : 0))
  );

  return {
    position: {
      x: resizeLeft ? Math.round(resizeStart.position.x + resizeStart.size.width - width) : resizeStart.position.x,
      y: resizeTop ? Math.round(resizeStart.position.y + resizeStart.size.height - height) : resizeStart.position.y
    },
    size: {
      width,
      height
    }
  };
}

const CANVAS_NODE_RESIZE_DIRECTIONS: CanvasNodeResizeDirection[] = [
  'top',
  'right',
  'bottom',
  'left',
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right'
];

const CANVAS_NODE_RESIZE_LINE_DIRECTIONS: CanvasNodeResizeDirection[] = ['top', 'right', 'bottom', 'left'];

function NodeResizeAffordance({
  id,
  data,
  position,
  zoom,
  minimumOverride
}: Pick<NodeProps<CanvasNodeData>, 'id' | 'data'> & {
  position: CanvasNodePosition;
  zoom: number;
  minimumOverride?: CanvasNodeFootprint;
}): JSX.Element {
  const minimum = minimumOverride ?? minimumCanvasNodeFootprintForDisplayStyle(data);
  const resizeStartRef = useRef<{
    pointerId: number;
    clientX: number;
    clientY: number;
    position: CanvasNodePosition;
    size: CanvasNodeFootprint;
    direction: CanvasNodeResizeDirection;
    autoPanOffset: CanvasNodePosition;
  } | null>(null);
  const lastResizeEventRef = useRef<Pick<PointerEvent | React.PointerEvent, 'clientX' | 'clientY'> | null>(null);
  const activeResizeDraftRef = useRef<CanvasNodeResizeDraft | null>(null);

  useEffect(() => {
    const applyResizeMove = (event: Pick<PointerEvent | MouseEvent, 'clientX' | 'clientY'>): void => {
      const resizeStart = resizeStartRef.current;
      if (!resizeStart) {
        return;
      }

      lastResizeEventRef.current = {
        clientX: event.clientX,
        clientY: event.clientY
      };
      const publishDraft = (): void => {
        const draft = resolveNodeResizeGeometry(resizeStart, lastResizeEventRef.current ?? event, zoom, minimum);
        activeResizeDraftRef.current = draft;
        data.onDraftNodeLayout?.(id, draft);
      };
      data.onResizeNodePointerMove?.(event, (previousViewport, nextViewport) => {
        const safeZoom = Number.isFinite(nextViewport.zoom) && nextViewport.zoom > 0 ? nextViewport.zoom : zoom;
        resizeStart.autoPanOffset = {
          x: resizeStart.autoPanOffset.x + (previousViewport.x - nextViewport.x) / safeZoom,
          y: resizeStart.autoPanOffset.y + (previousViewport.y - nextViewport.y) / safeZoom
        };
        publishDraft();
      });
      publishDraft();
    };

    const applyResizeEnd = (event: Pick<PointerEvent | MouseEvent, 'clientX' | 'clientY'>): void => {
      const resizeStart = resizeStartRef.current;
      if (!resizeStart) {
        return;
      }

      resizeStartRef.current = null;
      const eventForGeometry = lastResizeEventRef.current ?? event;
      lastResizeEventRef.current = null;
      const nextDraft = resolveNodeResizeGeometry(resizeStart, eventForGeometry, zoom, minimum);
      activeResizeDraftRef.current = null;
      if (
        nextDraft.position.x === resizeStart.position.x &&
        nextDraft.position.y === resizeStart.position.y &&
        nextDraft.size.width === resizeStart.size.width &&
        nextDraft.size.height === resizeStart.size.height
      ) {
        data.onDraftNodeLayout?.(id, null);
        data.onResizeNodeEnd?.();
        return;
      }

      data.onResizeNode?.(id, nextDraft.position, nextDraft.size);
    };

    const handlePointerMove = (event: PointerEvent): void => {
      if (resizeStartRef.current?.pointerId !== event.pointerId) {
        return;
      }

      applyResizeMove(event);
    };

    const handlePointerUp = (event: PointerEvent): void => {
      if (resizeStartRef.current?.pointerId !== event.pointerId) {
        return;
      }

      applyResizeEnd(event);
    };

    const handleMouseMove = (event: MouseEvent): void => {
      if (!resizeStartRef.current) {
        return;
      }

      applyResizeMove(event);
    };

    const handleMouseUp = (event: MouseEvent): void => {
      if (!resizeStartRef.current) {
        return;
      }

      applyResizeEnd(event);
    };

    const handlePointerCancel = (event: PointerEvent): void => {
      const resizeStart = resizeStartRef.current;
      if (!resizeStart || resizeStart.pointerId !== event.pointerId) {
        return;
      }

      resizeStartRef.current = null;
      lastResizeEventRef.current = null;
      activeResizeDraftRef.current = null;
      data.onDraftNodeLayout?.(id, null);
      data.onResizeNodeEnd?.();
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [data, id, minimum, zoom]);

  const beginResize = (event: React.PointerEvent, direction: CanvasNodeResizeDirection): void => {
    if (event.button !== 0) {
      return;
    }

    stopCanvasEvent(event);
    data.onSelectNode?.(id);
    lastResizeEventRef.current = {
      clientX: event.clientX,
      clientY: event.clientY
    };
    activeResizeDraftRef.current = null;
    resizeStartRef.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      position,
      size: data.size,
      direction,
      autoPanOffset: { x: 0, y: 0 }
    };
  };

  const handleResizeMove = (event: React.PointerEvent): void => {
    if (resizeStartRef.current?.pointerId === event.pointerId) {
      stopCanvasEvent(event);
    }
  };

  const endResize = (event: React.PointerEvent): void => {
    if (resizeStartRef.current?.pointerId === event.pointerId) {
      stopCanvasEvent(event);
    }
  };

  const cancelResize = (event: React.PointerEvent): void => {
    const resizeStart = resizeStartRef.current;
    if (!resizeStart || resizeStart.pointerId !== event.pointerId) {
      return;
    }

    resizeStartRef.current = null;
    data.onDraftNodeLayout?.(id, null);
    data.onResizeNodeEnd?.();
    stopCanvasEvent(event);
  };

  if (!data.selected) {
    return <></>;
  }

  return (
    <>
      {CANVAS_NODE_RESIZE_LINE_DIRECTIONS.map((direction) => (
        <span
          key={`line-${direction}`}
          className={`canvas-node-resize-line canvas-node-resize-line-${direction}`}
          aria-hidden="true"
        />
      ))}
      {CANVAS_NODE_RESIZE_DIRECTIONS.map((direction) => (
        <button
          key={direction}
          type="button"
          className={`canvas-node-resize-control canvas-node-resize-${direction} nodrag nopan`}
          data-node-resize-direction={direction}
          aria-label={t('canvas.resizeNode', { direction, title: data.title })}
          style={{ cursor: canvasNodeResizeCursorForDirection(direction) }}
          onPointerDown={(event) => beginResize(event, direction)}
          onPointerMove={handleResizeMove}
          onPointerUp={endResize}
          onPointerCancel={cancelResize}
        />
      ))}
    </>
  );
}

function FileNode({ id, data, xPos, yPos }: NodeProps<CanvasNodeData>): JSX.Element {
  const { zoom } = useViewport();
  const fileMetadata = data.metadata?.file;
  if (!fileMetadata) {
    return <CompactCanvasCardNodeContent id={id} data={data} position={{ x: xPos, y: yPos }} zoom={zoom} />;
  }
  const overviewInteractionsDisabled = data.overviewInteractionsDisabled;
  const fileActionPointerStateRef = useRef<{
    pointerId: number | null;
    originX: number;
    originY: number;
    dragged: boolean;
  }>({
    pointerId: null,
    originX: 0,
    originY: 0,
    dragged: false
  });

  const isMinimalStyle = data.fileNodeDisplayStyle === 'minimal';
  const minimumFootprint = minimumCanvasNodeFootprintForDisplayStyle(data);
  const primaryLabel = displayFilePath(fileMetadata, data.filePathDisplayMode);
  const secondaryLabel = isMinimalStyle
    ? undefined
    : data.filePathDisplayMode === 'basename'
      ? fileMetadata.relativePath ?? fileMetadata.filePath
      : fileMetadata.filePath !== primaryLabel
        ? fileMetadata.filePath
        : undefined;
  const ownerCount = fileMetadata.ownerNodeIds.length;
  const showIcon = data.fileNodeDisplayMode !== 'path-only';
  const showText = data.fileNodeDisplayMode !== 'icon-only';

  return (
    <CanvasNodeInteractionBoundary
      nodeId={id}
      disabled={data.overviewInteractionsDisabled}
      onModifierSelectNode={(nodeId) => data.onModifierSelectNode?.(nodeId)}
    >
      <div
      className={`canvas-node file-node kind-file display-style-${data.fileNodeDisplayStyle} ${data.selected ? 'is-selected' : ''}`}
      data-node-id={id}
      data-node-kind={data.kind}
      data-node-selected={data.selected ? 'true' : 'false'}
    >
      <NodeResizeAffordance id={id} data={data} position={{ x: xPos, y: yPos }} zoom={zoom} minimumOverride={minimumFootprint} />
      <NodeHandles selected={data.selected} />
      <button
        type="button"
        className={`file-node-action nopan ${isMinimalStyle ? 'file-node-action-minimal' : 'file-node-action-card'} ${
          showText ? '' : 'is-icon-only'
        } ${showText && !showIcon ? 'is-path-only' : ''}`}
        data-node-interactive="true"
        data-file-entry-path={fileMetadata.filePath}
        disabled={overviewInteractionsDisabled}
        tabIndex={overviewInteractionsDisabled ? -1 : undefined}
        aria-hidden={overviewInteractionsDisabled ? true : undefined}
        onPointerDown={(event) => {
          if (!event.isPrimary || event.button !== 0) {
            return;
          }
          if (overviewInteractionsDisabled) {
            stopCanvasEvent(event);
            return;
          }

          data.onSelectNode?.(id);
          fileActionPointerStateRef.current = {
            pointerId: event.pointerId,
            originX: event.clientX,
            originY: event.clientY,
            dragged: false
          };
        }}
        onPointerMove={(event) => {
          const current = fileActionPointerStateRef.current;
          if (current.pointerId !== event.pointerId || current.dragged) {
            return;
          }

          if (Math.hypot(event.clientX - current.originX, event.clientY - current.originY) >= 4) {
            current.dragged = true;
          }
        }}
        onPointerUp={(event) => {
          const current = fileActionPointerStateRef.current;
          if (current.pointerId === event.pointerId) {
            current.pointerId = null;
          }
        }}
        onPointerCancel={(event) => {
          const current = fileActionPointerStateRef.current;
          if (current.pointerId === event.pointerId) {
            current.pointerId = null;
            current.dragged = false;
          }
        }}
        onClick={(event) => {
          stopCanvasEvent(event);
          if (overviewInteractionsDisabled) {
            return;
          }
          const current = fileActionPointerStateRef.current;
          const shouldOpen = !current.dragged;
          current.pointerId = null;
          current.dragged = false;
          if (!shouldOpen) {
            return;
          }

          data.onSelectNode?.(id);
          data.onOpenCanvasFile?.(id, fileMetadata.filePath);
        }}
        onFocus={() => data.onSelectNode?.(id)}
      >
        <NodeOverviewTitle title={data.title} />
        {showIcon ? (
          <span className="file-node-icon" aria-hidden="true">
            {renderFileIcon(fileMetadata.icon, primaryLabel)}
          </span>
        ) : null}
        {showText ? (
          <span className="file-node-copy">
            <strong title={primaryLabel}>{primaryLabel}</strong>
            {secondaryLabel ? <span>{secondaryLabel}</span> : null}
          </span>
        ) : !isMinimalStyle ? (
          <span className="file-node-copy file-node-copy-icon-only">
            <strong>{ownerCount}</strong>
            <span>{t('file.references')}</span>
          </span>
        ) : null}
      </button>
      </div>
    </CanvasNodeInteractionBoundary>
  );
}

function FileListNode({ id, data, xPos, yPos }: NodeProps<CanvasNodeData>): JSX.Element {
  const { zoom } = useViewport();
  const fileListMetadata = data.metadata?.fileList;
  if (!fileListMetadata) {
    return <CompactCanvasCardNodeContent id={id} data={data} position={{ x: xPos, y: yPos }} zoom={zoom} />;
  }

  const overviewInteractionsDisabled = data.overviewInteractionsDisabled;
  const fileListTree = useMemo(() => buildFileListTree(fileListMetadata.entries), [fileListMetadata.entries]);

  const deleteFileList = (): void => {
    data.onSelectNode?.(id);
    data.onDeleteNode?.(id);
  };
  const isMinimalStyle = data.fileNodeDisplayStyle === 'minimal';
  const selectionTone: FileListEntrySelectionTone =
    data.selected && data.documentHasFocus ? 'active' : 'inactive';

  return (
    <CanvasNodeInteractionBoundary
      nodeId={id}
      disabled={data.overviewInteractionsDisabled}
      onModifierSelectNode={(nodeId) => data.onModifierSelectNode?.(nodeId)}
    >
      <div
      className={`canvas-node file-list-node kind-file-list display-style-${data.fileNodeDisplayStyle} ${
        data.selected ? 'is-selected' : ''
      }`}
      data-node-id={id}
      data-node-kind={data.kind}
      data-node-selected={data.selected ? 'true' : 'false'}
    >
      <NodeResizeAffordance id={id} data={data} position={{ x: xPos, y: yPos }} zoom={zoom} />
      <NodeHandles selected={data.selected} />
      <div
        className={isMinimalStyle ? 'file-list-minimal-header' : 'window-chrome'}
        onDoubleClick={(event) => handleNodeChromeDoubleClick(event, id, data)}
      >
        <div className="window-title file-list-title">
          <strong className="file-list-title-text">{data.title}</strong>
          <div className="window-title-subtitle-row">
            <span className="window-title-subtitle">{data.summary}</span>
          </div>
        </div>
        {isMinimalStyle ? (
          <div className="file-list-minimal-toolbar">
            <div className="file-list-view-toggle" role="group" aria-label={t('fileList.viewToggle')}>
              <button
                type="button"
                className={`file-list-view-toggle-button nodrag nopan ${
                  data.fileListViewMode === 'list' ? 'is-active' : ''
                }`}
                data-node-interactive="true"
                data-file-list-view-mode="list"
                disabled={overviewInteractionsDisabled}
                tabIndex={overviewInteractionsDisabled ? -1 : undefined}
                onMouseDown={stopCanvasEvent}
                onClick={(event) => {
                  stopCanvasEvent(event);
                  if (overviewInteractionsDisabled) {
                    return;
                  }
                  data.onSelectNode?.(id);
                  data.onSetFileListViewMode?.(id, 'list');
                }}
              >{t('fileList.view.list')}</button>
              <button
                type="button"
                className={`file-list-view-toggle-button nodrag nopan ${
                  data.fileListViewMode === 'tree' ? 'is-active' : ''
                }`}
                data-node-interactive="true"
                data-file-list-view-mode="tree"
                disabled={overviewInteractionsDisabled}
                tabIndex={overviewInteractionsDisabled ? -1 : undefined}
                onMouseDown={stopCanvasEvent}
                onClick={(event) => {
                  stopCanvasEvent(event);
                  if (overviewInteractionsDisabled) {
                    return;
                  }
                  data.onSelectNode?.(id);
                  data.onSetFileListViewMode?.(id, 'tree');
                }}
              >{t('fileList.view.tree')}</button>
            </div>
            <ActionButton
              label={t('action.delete')}
              actionId="delete"
              tone="danger"
              onClick={deleteFileList}
              className="nodrag nopan compact"
              interactive
              onFocus={() => data.onSelectNode?.(id)}
            />
          </div>
        ) : (
          <div className="window-chrome-actions">
            <span className={`status-pill ${statusToneClass(data.status)}`}>{webviewHumanizeCanvasStatus(data.status)}</span>
            <ActionButton
              label={t('action.delete')}
              actionId="delete"
              tone="danger"
              onClick={deleteFileList}
              className="nodrag nopan compact"
              interactive
              onFocus={() => data.onSelectNode?.(id)}
            />
          </div>
        )}
      </div>
      <div
        className={`file-list-body nowheel ${isMinimalStyle ? 'minimal' : 'object-surface'}`}
        {...canvasOverviewInertProps(overviewInteractionsDisabled)}
        onWheel={stopCanvasEvent}
      >
        <NodeOverviewTitle title={data.title} />
        {fileListMetadata.entries.length === 0 ? (
          <div className="file-list-empty">{t('fileList.empty')}</div>
        ) : !isMinimalStyle ? (
          <div className="file-list-entries">
            {fileListMetadata.entries.map((entry) => {
              return (
                <FileListEntryButton
                  key={`${entry.fileId}-${entry.filePath}`}
                  nodeId={id}
                  entry={entry}
                  filePathDisplayMode={data.filePathDisplayMode}
                  variant="card"
                  selected={data.selectedFileListEntryPath === entry.filePath}
                  selectionTone={selectionTone}
                  onSelectNode={data.onSelectNode}
                  onSelectFileListEntry={data.onSelectFileListEntry}
                  onOpenCanvasFile={data.onOpenCanvasFile}
                />
              );
            })}
          </div>
        ) : data.fileListViewMode === 'tree' ? (
          <div className="file-list-tree" role="tree">
            {renderFileListTree({
              nodeId: id,
              tree: fileListTree,
              selectedFilePath: data.selectedFileListEntryPath,
              selectionTone,
              collapsedBranchKeys: new Set(data.collapsedFileListTreeBranchKeys ?? []),
              onSelectNode: data.onSelectNode,
              onToggleBranch: data.onToggleFileListTreeBranch,
              onSelectFileListEntry: data.onSelectFileListEntry,
              onOpenCanvasFile: data.onOpenCanvasFile
            })}
          </div>
        ) : (
          <div className="file-list-entries minimal">
            {fileListMetadata.entries.map((entry) => (
              <FileListEntryButton
                key={`${entry.fileId}-${entry.filePath}`}
                nodeId={id}
                entry={entry}
                filePathDisplayMode={data.filePathDisplayMode}
                variant="minimal-list"
                selected={data.selectedFileListEntryPath === entry.filePath}
                selectionTone={selectionTone}
                onSelectNode={data.onSelectNode}
                onSelectFileListEntry={data.onSelectFileListEntry}
                onOpenCanvasFile={data.onOpenCanvasFile}
              />
            ))}
          </div>
        )}
      </div>
      </div>
    </CanvasNodeInteractionBoundary>
  );
}

interface FileListEntryButtonProps {
  nodeId: string;
  entry: FileListNodeEntrySummary;
  filePathDisplayMode: CanvasFilePathDisplayMode;
  variant: 'card' | 'minimal-list' | 'minimal-tree';
  selected: boolean;
  selectionTone: FileListEntrySelectionTone;
  treeDepth?: number;
  forcePrimaryBasename?: boolean;
  onSelectNode?: (nodeId: string) => void;
  onSelectFileListEntry?: (nodeId: string, filePath: string) => void;
  onOpenCanvasFile?: (nodeId: string, filePath: string) => void;
}

function FileListEntryButton(props: FileListEntryButtonProps): JSX.Element {
  const { entry, filePathDisplayMode, forcePrimaryBasename = false, treeDepth = 0, variant } = props;
  const label = forcePrimaryBasename ? displayFilePath(entry, 'basename') : displayFilePath(entry, filePathDisplayMode);
  const secondary =
    variant === 'card'
      ? filePathDisplayMode === 'basename'
        ? entry.relativePath ?? entry.filePath
        : entry.filePath !== label
          ? entry.filePath
          : undefined
      : undefined;
  const treeRowStyle = variant === 'minimal-tree' ? fileTreeRowPaddingStyle(treeDepth) : undefined;

  return (
    <button
      type="button"
      className={`file-list-entry nodrag nopan variant-${variant} ${
        props.selected ? `is-selected selection-${props.selectionTone}` : ''
      }`}
      data-node-interactive="true"
      data-file-entry-path={entry.filePath}
      data-file-entry-selected={props.selected ? 'true' : 'false'}
      data-file-entry-selection-tone={props.selected ? props.selectionTone : undefined}
      data-file-tree-item-type={variant === 'minimal-tree' ? 'file' : undefined}
      data-file-tree-label={variant === 'minimal-tree' ? label : undefined}
      style={treeRowStyle}
      onMouseDown={stopCanvasEvent}
      onClick={(event) => {
        stopCanvasEvent(event);
        props.onSelectFileListEntry?.(props.nodeId, entry.filePath);
        props.onOpenCanvasFile?.(props.nodeId, entry.filePath);
      }}
      onFocus={() => {
        props.onSelectFileListEntry?.(props.nodeId, entry.filePath);
      }}
    >
      {variant === 'minimal-tree' ? <span className="file-tree-disclosure-spacer" aria-hidden="true" /> : null}
      <span className="file-list-entry-icon" aria-hidden="true">
        {renderFileIcon(entry.icon, label)}
      </span>
      <span className="file-list-entry-copy">
        <strong title={label}>{label}</strong>
        {secondary ? <span>{secondary}</span> : null}
      </span>
      {variant === 'card' ? (
        <span className={`file-access-badge mode-${entry.accessMode}`}>
          {humanizeFileAccessMode(entry.accessMode)}
        </span>
      ) : (
        <FileAccessIndicator accessMode={entry.accessMode} />
      )}
    </button>
  );
}

function FileAccessIndicator({ accessMode }: { accessMode: FileListNodeEntrySummary['accessMode'] }): JSX.Element {
  const showRead = accessMode === 'read' || accessMode === 'read-write';
  const showWrite = accessMode === 'write' || accessMode === 'read-write';

  return (
    <span className="file-access-indicator" aria-label={humanizeFileAccessMode(accessMode)} title={humanizeFileAccessMode(accessMode)}>
      {showRead ? <span className="read">R</span> : null}
      {showWrite ? <span className="write">W</span> : null}
    </span>
  );
}

interface FileListTreeBranch {
  key: string;
  label: string;
  children: FileListTreeBranch[];
  entries: FileListNodeEntrySummary[];
}

interface MutableFileListTreeBranch {
  key: string;
  label: string;
  children: Map<string, MutableFileListTreeBranch>;
  entries: FileListNodeEntrySummary[];
}

function fileTreeRowPaddingStyle(depth: number): CSSProperties {
  return {
    paddingInlineStart: `${FILE_TREE_BASE_PADDING_PX + depth * FILE_TREE_DEPTH_STEP_PX}px`
  };
}

function compareFileTreeLabels(left: string, right: string): number {
  return left.localeCompare(right, undefined, {
    numeric: true,
    sensitivity: 'base'
  });
}

function compareFileTreeEntries(left: FileListNodeEntrySummary, right: FileListNodeEntrySummary): number {
  const leftLabel = displayFilePath(left, 'basename');
  const rightLabel = displayFilePath(right, 'basename');
  const byLabel = compareFileTreeLabels(leftLabel, rightLabel);
  if (byLabel !== 0) {
    return byLabel;
  }

  const leftPath = left.relativePath ?? left.filePath;
  const rightPath = right.relativePath ?? right.filePath;
  return compareFileTreeLabels(leftPath, rightPath);
}

function buildFileListTree(entries: readonly FileListNodeEntrySummary[]): {
  rootEntries: FileListNodeEntrySummary[];
  branches: FileListTreeBranch[];
} {
  const root = {
    children: new Map<string, MutableFileListTreeBranch>(),
    entries: [] as FileListNodeEntrySummary[]
  };

  for (const entry of entries) {
    const segments = resolveFileTreeSegments(entry);
    if (segments.length <= 1) {
      root.entries.push(entry);
      continue;
    }

    let currentChildren = root.children;
    let currentBranch: MutableFileListTreeBranch | undefined;
    let currentKey = '';
    for (const segment of segments.slice(0, -1)) {
      currentKey = currentKey ? `${currentKey}/${segment}` : segment;
      currentBranch = currentChildren.get(segment);
      if (!currentBranch) {
        currentBranch = {
          key: currentKey,
          label: segment,
          children: new Map<string, MutableFileListTreeBranch>(),
          entries: []
        };
        currentChildren.set(segment, currentBranch);
      }
      currentChildren = currentBranch.children;
    }

    if (currentBranch) {
      currentBranch.entries.push(entry);
    }
  }

  return {
    rootEntries: [...root.entries].sort(compareFileTreeEntries),
    branches: Array.from(root.children.values())
      .map(materializeFileListTreeBranch)
      .sort((left, right) => compareFileTreeLabels(left.label, right.label))
  };
}

function materializeFileListTreeBranch(branch: MutableFileListTreeBranch): FileListTreeBranch {
  return {
    key: branch.key,
    label: branch.label,
    children: Array.from(branch.children.values())
      .map(materializeFileListTreeBranch)
      .sort((left, right) => compareFileTreeLabels(left.label, right.label)),
    entries: [...branch.entries].sort(compareFileTreeEntries)
  };
}

function resolveFileTreeSegments(entry: Pick<FileListNodeEntrySummary, 'relativePath' | 'filePath'>): string[] {
  const comparablePath = (entry.relativePath ?? entry.filePath).replace(/\\/g, '/').replace(/^\/+/, '');
  const segments = comparablePath.split('/').filter(Boolean);
  return segments.length > 0 ? segments : [displayFilePath(entry, 'basename')];
}

function collectFileListTreeBranchKeys(branches: readonly FileListTreeBranch[]): Set<string> {
  const branchKeys = new Set<string>();

  for (const branch of branches) {
    branchKeys.add(branch.key);
    for (const nestedBranchKey of collectFileListTreeBranchKeys(branch.children)) {
      branchKeys.add(nestedBranchKey);
    }
  }

  return branchKeys;
}

function renderFileListTree(params: {
  nodeId: string;
  tree: { rootEntries: FileListNodeEntrySummary[]; branches: FileListTreeBranch[] };
  selectedFilePath?: string;
  selectionTone: FileListEntrySelectionTone;
  collapsedBranchKeys: ReadonlySet<string>;
  onSelectNode?: (nodeId: string) => void;
  onToggleBranch?: (nodeId: string, branchKey: string) => void;
  onSelectFileListEntry?: (nodeId: string, filePath: string) => void;
  onOpenCanvasFile?: (nodeId: string, filePath: string) => void;
}): JSX.Element[] {
  const rows: JSX.Element[] = [];

  rows.push(
    ...renderFileListTreeBranches(
      params.nodeId,
      params.tree.branches,
      0,
      params.selectedFilePath,
      params.selectionTone,
      params.collapsedBranchKeys,
      params.onSelectNode,
      params.onToggleBranch,
      params.onSelectFileListEntry,
      params.onOpenCanvasFile
    )
  );

  for (const entry of params.tree.rootEntries) {
    rows.push(
      <FileListEntryButton
        key={`root-${entry.fileId}-${entry.filePath}`}
        nodeId={params.nodeId}
        entry={entry}
        filePathDisplayMode="basename"
        variant="minimal-tree"
        selected={params.selectedFilePath === entry.filePath}
        selectionTone={params.selectionTone}
        onSelectNode={params.onSelectNode}
        onSelectFileListEntry={params.onSelectFileListEntry}
        onOpenCanvasFile={params.onOpenCanvasFile}
      />
    );
  }
  return rows;
}

function renderFileListTreeBranches(
  nodeId: string,
  branches: readonly FileListTreeBranch[],
  depth: number,
  selectedFilePath: string | undefined,
  selectionTone: FileListEntrySelectionTone,
  collapsedBranchKeys: ReadonlySet<string>,
  onSelectNode: ((nodeId: string) => void) | undefined,
  onToggleBranch: ((nodeId: string, branchKey: string) => void) | undefined,
  onSelectFileListEntry: ((nodeId: string, filePath: string) => void) | undefined,
  onOpenCanvasFile: ((nodeId: string, filePath: string) => void) | undefined
): JSX.Element[] {
  const rows: JSX.Element[] = [];

  for (const branch of branches) {
    const isExpanded = !collapsedBranchKeys.has(branch.key);
    rows.push(
      <button
        key={`folder-${branch.key}`}
        type="button"
        className="file-tree-folder-row"
        data-node-interactive="true"
        data-file-tree-item-type="folder"
        data-file-tree-label={branch.label}
        data-file-tree-branch-key={branch.key}
        data-file-tree-expanded={isExpanded ? 'true' : 'false'}
        aria-expanded={isExpanded}
        style={fileTreeRowPaddingStyle(depth)}
        onMouseDown={stopCanvasEvent}
        onClick={(event) => {
          stopCanvasEvent(event);
          onToggleBranch?.(nodeId, branch.key);
        }}
        onFocus={() => onSelectNode?.(nodeId)}
      >
        <span
          className={`file-tree-folder-disclosure codicon ${
            isExpanded ? 'codicon-chevron-down' : 'codicon-chevron-right'
          }`}
          aria-hidden="true"
        />
        <span
          className={`file-tree-folder-icon codicon ${isExpanded ? 'codicon-folder-opened' : 'codicon-folder'}`}
          aria-hidden="true"
        />
        <span className="file-tree-folder-label">{branch.label}</span>
      </button>
    );

    if (!isExpanded) {
      continue;
    }

    rows.push(
      ...renderFileListTreeBranches(
        nodeId,
        branch.children,
        depth + 1,
        selectedFilePath,
        selectionTone,
        collapsedBranchKeys,
        onSelectNode,
        onToggleBranch,
        onSelectFileListEntry,
        onOpenCanvasFile
      )
    );

    for (const entry of branch.entries) {
      rows.push(
        <FileListEntryButton
          key={`file-${branch.key}-${entry.fileId}-${entry.filePath}`}
          nodeId={nodeId}
          entry={entry}
          filePathDisplayMode="basename"
          variant="minimal-tree"
          selected={selectedFilePath === entry.filePath}
          selectionTone={selectionTone}
          treeDepth={depth + 1}
          forcePrimaryBasename
          onSelectNode={onSelectNode}
          onSelectFileListEntry={onSelectFileListEntry}
          onOpenCanvasFile={onOpenCanvasFile}
        />
      );
    }
  }

  return rows;
}

function NoteEditableNode({ id, data, xPos, yPos }: NodeProps<CanvasNodeData>): JSX.Element {
  const { zoom } = useViewport();
  const noteMetadata = data.metadata?.note;
  if (!noteMetadata) {
    return <CompactCanvasCardNodeContent id={id} data={data} position={{ x: xPos, y: yPos }} zoom={zoom} />;
  }

  const overviewInteractionsDisabled = data.overviewInteractionsDisabled;
  const noteContentSource = noteMetadata.contentSource;
  const associatedMarkdownFile =
    noteContentSource?.kind === 'markdown-file' ? noteContentSource : undefined;
  const associatedMarkdownSubtitle =
    associatedMarkdownFile?.fullDisplayPath ?? associatedMarkdownFile?.displayPath;
  const associatedMarkdownContentRevision = associatedMarkdownFile?.contentRevision;
  const associatedMarkdownStatus = associatedMarkdownFile?.status;
  const hasAssociatedMarkdownMissingFile = associatedMarkdownStatus === 'missing';
  const associatedMarkdownRecoverableDraft = associatedMarkdownFile?.recoverableDraft;
  const hasAssociatedMarkdownRecoverableDraft = Boolean(associatedMarkdownRecoverableDraft);
  const associatedMarkdownRecoverableDraftContent =
    typeof associatedMarkdownRecoverableDraft?.content === 'string'
      ? associatedMarkdownRecoverableDraft.content
      : undefined;
  const hasAssociatedMarkdownHostConflict = associatedMarkdownStatus === 'dirty-conflict';
  const canSurfaceAssociatedMarkdownRecoverableDraft =
    Boolean(associatedMarkdownFile) &&
    Boolean(associatedMarkdownStatus) &&
    hasAssociatedMarkdownRecoverableDraft;
  const associatedMarkdownFileAvailable =
    !associatedMarkdownFile || associatedMarkdownStatus === 'ok' || hasAssociatedMarkdownHostConflict;
  const associatedMarkdownFileEditable =
    !associatedMarkdownFile || associatedMarkdownStatus === 'ok';
  const canOpenAssociatedMarkdownFile =
    Boolean(associatedMarkdownFile) && !hasAssociatedMarkdownMissingFile;
  const associatedMarkdownWarningTitle =
    hasAssociatedMarkdownHostConflict
      ? t('note.associated.warning.dirtyConflict')
      : hasAssociatedMarkdownMissingFile
        ? t('note.associated.warning.missing')
        : t('note.associated.warning.unavailable');
  const isEmbeddedNote = !associatedMarkdownFile;
  const bodyPlaceholder = isEmbeddedNote ? EMBEDDED_NOTE_BODY_PLACEHOLDER : NOTE_BODY_PLACEHOLDER;
  const [content, setContent] = useState(noteMetadata.content);
  const [isEditingBody, setIsEditingBody] = useState(false);
  const [isComposing, setIsComposing] = useState(false);
  const [isEmbeddedLimitNoticeVisible, setIsEmbeddedLimitNoticeVisible] = useState(false);
  const [associatedMarkdownDraftRecovery, setAssociatedMarkdownDraftRecovery] =
    useState<AssociatedMarkdownDraftRecovery | null>(null);
  const [associatedMarkdownDraftCopied, setAssociatedMarkdownDraftCopied] = useState(false);
  const [associatedMarkdownConflictResolution, setAssociatedMarkdownConflictResolution] =
    useState<AssociatedMarkdownConflictResolution | null>(null);
  const showAssociatedMarkdownHostConflictPanel =
    hasAssociatedMarkdownHostConflict &&
    !associatedMarkdownDraftRecovery &&
    !isEditingBody &&
    !associatedMarkdownConflictResolution;
  const showAssociatedMarkdownRecoverableDraftPanel =
    !hasAssociatedMarkdownHostConflict &&
    canSurfaceAssociatedMarkdownRecoverableDraft &&
    associatedMarkdownRecoverableDraftContent === undefined &&
    !associatedMarkdownDraftRecovery &&
    !isEditingBody &&
    !associatedMarkdownConflictResolution;
  const showAssociatedMarkdownUnavailablePanel =
    !associatedMarkdownFileAvailable && !associatedMarkdownDraftRecovery;
  const associatedMarkdownFilePanelTitle = showAssociatedMarkdownRecoverableDraftPanel
    ? t('note.associated.warning.unsavedDraft')
    : associatedMarkdownWarningTitle;
  const associatedMarkdownFilePanelDetail = showAssociatedMarkdownRecoverableDraftPanel
    ? associatedMarkdownStatus === 'ok'
      ? t('note.associated.draftUnreadableClean')
      : t('note.associated.draftUnreadableUnavailable', {
          reason: associatedMarkdownFile?.lastError ?? t('note.associated.fileUnavailable')
        })
    : associatedMarkdownFile?.lastError ?? t('note.associated.unavailableDetail');
  const associatedMarkdownDraftRecoveryHint =
    associatedMarkdownDraftRecovery?.kind === 'recoverable-draft'
      ? t('note.associated.recoverableDraftHint')
      : associatedMarkdownDraftRecovery?.kind === 'unavailable-draft'
        ? t('note.associated.unavailableDraftHint', { title: associatedMarkdownWarningTitle })
        : t('note.associated.externalUpdateHint');
  const [bodyScrollTop, setBodyScrollTop] = useState(0);
  const [bodyVisualLineCounts, setBodyVisualLineCounts] = useState<number[]>(() =>
    createFallbackVisualLineCounts(splitTextLines(noteMetadata.content).length)
  );
  const committedContentRef = useRef(noteMetadata.content);
  const pendingContentRef = useRef<string | null>(null);
  const lastPropContentRef = useRef(noteMetadata.content);
  const lastPropStatusRef = useRef(associatedMarkdownStatus);
  const lastPropContentRevisionRef = useRef(associatedMarkdownContentRevision);
  const pendingAssociatedMarkdownSubmissionRef = useRef<PendingAssociatedMarkdownSubmission | null>(null);
  const editBaselineContentRef = useRef<string | null>(null);
  const editBaselineRevisionRef = useRef<string | undefined>(associatedMarkdownContentRevision);
  const associatedMarkdownDraftSyncTimerRef = useRef<number | undefined>();
  const associatedMarkdownDraftCopiedTimerRef = useRef<number | undefined>();
  const lastAssociatedMarkdownDraftSyncKeyRef = useRef<string | undefined>();
  const restoredAssociatedMarkdownDraftKeyRef = useRef<string | undefined>();
  const bodyInputRef = useRef<HTMLTextAreaElement | null>(null);
  const bodyMeasureRef = useRef<HTMLDivElement | null>(null);
  const bodyPreviewRef = useRef<HTMLDivElement | null>(null);
  const pendingBodyScrollTopRef = useRef<number | null>(null);
  const pendingBodyPreviewScrollTargetRef = useRef<number | null>(null);
  const pendingBodyFocusRef = useRef<NoteBodyFocusRequest | null>(null);
  const pendingBodySelectionRef = useRef<{ selectionStart: number; selectionEnd: number } | null>(null);
  const pendingBodyFocusSelectionRef = useRef<{
    selectionStart: number;
    selectionEnd: number;
    selectionDirection: HTMLTextAreaElement['selectionDirection'];
  } | null>(null);
  const associatedMarkdownImageBaseUri = associatedMarkdownFile?.webviewResourceBaseUri;
  const markdownPreview = useMemo(
    () =>
      noteMarkdownPreviewRenderer.render(content, {
        imageBaseUri: associatedMarkdownImageBaseUri,
        imageWorkspaceRoots: data.noteMarkdownImageWorkspaceRoots
      }),
    [associatedMarkdownImageBaseUri, content, data.noteMarkdownImageWorkspaceRoots]
  );
  const previewHtml = markdownPreview.html;
  const markdownFrontMatter = markdownPreview.frontMatter;
  const bodyLines = useMemo(() => splitTextLines(content), [content]);
  const bodyLineNumberRows = useMemo(
    () => createNoteBodyLineNumberRows(bodyLines, bodyVisualLineCounts),
    [bodyLines, bodyVisualLineCounts]
  );

  const clearAssociatedMarkdownDraftSyncTimer = (): void => {
    if (associatedMarkdownDraftSyncTimerRef.current !== undefined) {
      window.clearTimeout(associatedMarkdownDraftSyncTimerRef.current);
      associatedMarkdownDraftSyncTimerRef.current = undefined;
    }
  };

  const clearAssociatedMarkdownDraftCopiedTimer = (): void => {
    if (associatedMarkdownDraftCopiedTimerRef.current !== undefined) {
      window.clearTimeout(associatedMarkdownDraftCopiedTimerRef.current);
      associatedMarkdownDraftCopiedTimerRef.current = undefined;
    }
  };

  const clearAssociatedMarkdownDraft = (): void => {
    clearAssociatedMarkdownDraftSyncTimer();
    lastAssociatedMarkdownDraftSyncKeyRef.current = undefined;
    data.onClearAssociatedNoteMarkdownDraft?.(id);
  };

  const readCurrentBodyContent = (): string => bodyInputRef.current?.value ?? content;

  const isAssociatedMarkdownConflictActionTarget = (target: EventTarget | null): boolean =>
    target instanceof HTMLElement && Boolean(target.closest('[data-note-conflict-action="true"]'));

  const preserveFocusedBodySelection = (): void => {
    const textarea = bodyInputRef.current;
    if (!textarea || document.activeElement !== textarea) {
      return;
    }

    pendingBodyFocusSelectionRef.current = {
      selectionStart: textarea.selectionStart,
      selectionEnd: textarea.selectionEnd,
      selectionDirection: textarea.selectionDirection
    };
  };

  const beginAssociatedMarkdownEdit = (draftContent: string): void => {
    if (!associatedMarkdownFile) {
      return;
    }

    const baseContentRevision = editBaselineRevisionRef.current ?? associatedMarkdownContentRevision;
    data.onBeginAssociatedNoteMarkdownEdit?.({
      nodeId: id,
      content: draftContent,
      baseContentRevision
    });
  };

  const endAssociatedMarkdownEdit = (): void => {
    if (!associatedMarkdownFile) {
      return;
    }

    clearAssociatedMarkdownDraftSyncTimer();
    data.onEndAssociatedNoteMarkdownEdit?.(id);
  };

  const persistAssociatedMarkdownDraft = (draftContent: string, options: { immediate?: boolean } = {}): void => {
    if (!associatedMarkdownFile) {
      return;
    }

    const baseContentRevision = editBaselineRevisionRef.current ?? associatedMarkdownContentRevision;
    const baselineContent = editBaselineContentRef.current ?? committedContentRef.current;
    if (draftContent === baselineContent && !hasAssociatedMarkdownHostConflict) {
      clearAssociatedMarkdownDraft();
      return;
    }

    const syncKey = `${baseContentRevision ?? ''}\n${draftContent}`;
    if (lastAssociatedMarkdownDraftSyncKeyRef.current === syncKey) {
      return;
    }

    const sendDraft = (): void => {
      associatedMarkdownDraftSyncTimerRef.current = undefined;
      lastAssociatedMarkdownDraftSyncKeyRef.current = syncKey;
      data.onUpdateAssociatedNoteMarkdownDraft?.({
        nodeId: id,
        content: draftContent,
        baseContentRevision
      });
    };

    clearAssociatedMarkdownDraftSyncTimer();
    if (options.immediate === true) {
      sendDraft();
      return;
    }

    associatedMarkdownDraftSyncTimerRef.current = window.setTimeout(sendDraft, 450);
  };

  const measureBodyVisualLineCounts = useCallback((): void => {
    const measureElement = bodyMeasureRef.current;
    const textarea = bodyInputRef.current;
    if (!measureElement || !textarea) {
      return;
    }

    measureElement.style.width = `${textarea.clientWidth}px`;
    const lineHeight = readElementLineHeightPx(measureElement);
    const nextCounts = Array.from(
      measureElement.querySelectorAll<HTMLElement>('.note-document-line-measure-line'),
      (lineElement) => Math.max(1, Math.round(lineElement.offsetHeight / lineHeight))
    );
    if (nextCounts.length === 0) {
      nextCounts.push(1);
    }

    setBodyVisualLineCounts((current) => (areNumberListsEqual(current, nextCounts) ? current : nextCounts));
  }, []);

  useLayoutEffect(() => {
    const previousPropContent = lastPropContentRef.current;
    const previousPropStatus = lastPropStatusRef.current;
    const previousPropContentRevision = lastPropContentRevisionRef.current;
    lastPropContentRef.current = noteMetadata.content;
    lastPropStatusRef.current = associatedMarkdownStatus;
    lastPropContentRevisionRef.current = associatedMarkdownContentRevision;
    const didPropContentChange = noteMetadata.content !== previousPropContent;
    const didPropStatusChange = associatedMarkdownStatus !== previousPropStatus;
    const didPropContentRevisionChange = associatedMarkdownContentRevision !== previousPropContentRevision;
    const didMatchPendingContent = pendingContentRef.current === noteMetadata.content;

    const canRestoreAssociatedMarkdownRecoverableDraft =
      canSurfaceAssociatedMarkdownRecoverableDraft &&
      associatedMarkdownRecoverableDraftContent !== undefined;
    const recoverableDraftRestoreKey = canRestoreAssociatedMarkdownRecoverableDraft
      ? [
          id,
          associatedMarkdownRecoverableDraft?.draftId ?? '',
          associatedMarkdownRecoverableDraft?.baseContentRevision ?? '',
          associatedMarkdownRecoverableDraft?.remoteContentRevision ?? '',
          associatedMarkdownRecoverableDraft?.updatedAt ?? '',
          associatedMarkdownStatus
        ].join('\n')
      : undefined;
    if (
      canRestoreAssociatedMarkdownRecoverableDraft &&
      !associatedMarkdownDraftRecovery &&
      !associatedMarkdownConflictResolution &&
      restoredAssociatedMarkdownDraftKeyRef.current !== recoverableDraftRestoreKey
    ) {
      preserveFocusedBodySelection();
      pendingAssociatedMarkdownSubmissionRef.current = null;
      setAssociatedMarkdownConflictResolution(null);
      committedContentRef.current = noteMetadata.content;
      editBaselineContentRef.current = noteMetadata.content;
      editBaselineRevisionRef.current =
        associatedMarkdownRecoverableDraft?.baseContentRevision ?? associatedMarkdownContentRevision;
      setContent(associatedMarkdownRecoverableDraftContent);
      setIsEditingBody(true);
      restoredAssociatedMarkdownDraftKeyRef.current = recoverableDraftRestoreKey;
      setAssociatedMarkdownDraftRecovery({
        kind: hasAssociatedMarkdownHostConflict
          ? 'dirty-conflict'
          : associatedMarkdownStatus === 'ok'
            ? 'recoverable-draft'
            : 'unavailable-draft',
        remoteContent: noteMetadata.content,
        remoteContentRevision:
          associatedMarkdownRecoverableDraft?.remoteContentRevision ?? associatedMarkdownContentRevision
      });
      return;
    }

    if (didMatchPendingContent) {
      pendingContentRef.current = null;
    } else if (pendingContentRef.current && noteMetadata.content !== previousPropContent) {
      pendingContentRef.current = null;
    }

    const pendingAssociatedSubmission = associatedMarkdownFile
      ? pendingAssociatedMarkdownSubmissionRef.current
      : null;
    if (pendingAssociatedSubmission) {
      if (
        associatedMarkdownStatus === 'ok' &&
        noteMetadata.content === pendingAssociatedSubmission.content
      ) {
        pendingAssociatedMarkdownSubmissionRef.current = null;
        committedContentRef.current = noteMetadata.content;
        editBaselineContentRef.current = null;
        editBaselineRevisionRef.current = associatedMarkdownContentRevision;
        setAssociatedMarkdownConflictResolution(null);
        setAssociatedMarkdownDraftRecovery(null);
        if (!isEditingBody && !isComposing) {
          setContent(noteMetadata.content);
        }
        return;
      }

      if (
        !pendingAssociatedSubmission.force &&
        hasAssociatedMarkdownHostConflict &&
        (didPropContentChange || didPropStatusChange)
      ) {
        preserveFocusedBodySelection();
        committedContentRef.current = noteMetadata.content;
        editBaselineContentRef.current = noteMetadata.content;
        editBaselineRevisionRef.current = associatedMarkdownContentRevision;
        setAssociatedMarkdownConflictResolution(null);
        setContent(pendingAssociatedSubmission.content);
        setIsEditingBody(true);
        setAssociatedMarkdownDraftRecovery({
          kind: 'dirty-conflict',
          remoteContent: noteMetadata.content,
          remoteContentRevision: associatedMarkdownContentRevision
        });
        return;
      }

      if (
        associatedMarkdownStatus === 'ok' &&
        noteMetadata.content !== pendingAssociatedSubmission.content &&
        (didPropContentChange || didPropStatusChange)
      ) {
        preserveFocusedBodySelection();
        committedContentRef.current = noteMetadata.content;
        editBaselineContentRef.current = noteMetadata.content;
        editBaselineRevisionRef.current = associatedMarkdownContentRevision;
        setAssociatedMarkdownConflictResolution(null);
        setContent(pendingAssociatedSubmission.content);
        setIsEditingBody(true);
        setAssociatedMarkdownDraftRecovery({
          kind: 'dirty-conflict',
          remoteContent: noteMetadata.content,
          remoteContentRevision: associatedMarkdownContentRevision
        });
        return;
      }

      if (!didPropContentChange && !didPropStatusChange) {
        return;
      }
    }

    if (
      associatedMarkdownFile &&
      isEditingBody &&
      (didPropContentChange || (hasAssociatedMarkdownHostConflict && didPropStatusChange)) &&
      !didMatchPendingContent
    ) {
      const editBaselineContent = editBaselineContentRef.current ?? previousPropContent;
      if (content !== editBaselineContent || hasAssociatedMarkdownHostConflict) {
        preserveFocusedBodySelection();
        persistAssociatedMarkdownDraft(content, { immediate: true });
        setAssociatedMarkdownConflictResolution(null);
        setAssociatedMarkdownDraftRecovery({
          kind: 'dirty-conflict',
          remoteContent: noteMetadata.content,
          remoteContentRevision: associatedMarkdownContentRevision
        });
        return;
      }

      editBaselineContentRef.current = noteMetadata.content;
      editBaselineRevisionRef.current = associatedMarkdownContentRevision;
      setAssociatedMarkdownConflictResolution(null);
      setAssociatedMarkdownDraftRecovery(null);
      setContent(noteMetadata.content);
      return;
    }

    if (
      associatedMarkdownFile &&
      isEditingBody &&
      didPropContentRevisionChange &&
      !didPropContentChange &&
      !associatedMarkdownDraftRecovery &&
      associatedMarkdownStatus === 'ok'
    ) {
      const editBaselineContent = editBaselineContentRef.current ?? noteMetadata.content;
      if (content !== editBaselineContent) {
        preserveFocusedBodySelection();
        persistAssociatedMarkdownDraft(content, { immediate: true });
        setAssociatedMarkdownConflictResolution(null);
        setAssociatedMarkdownDraftRecovery({
          kind: 'dirty-conflict',
          remoteContent: noteMetadata.content,
          remoteContentRevision: associatedMarkdownContentRevision
        });
        return;
      }

      editBaselineRevisionRef.current = associatedMarkdownContentRevision;
      beginAssociatedMarkdownEdit(content);
    }

    committedContentRef.current = pendingContentRef.current ?? noteMetadata.content;
    if (!isEditingBody && !isComposing) {
      editBaselineContentRef.current = null;
      editBaselineRevisionRef.current = associatedMarkdownContentRevision;
      if (associatedMarkdownStatus === 'ok' && !hasAssociatedMarkdownRecoverableDraft) {
        setAssociatedMarkdownConflictResolution(null);
      }
      setAssociatedMarkdownDraftRecovery(null);
      setContent(pendingContentRef.current ?? noteMetadata.content);
    }
  }, [
    associatedMarkdownContentRevision,
    associatedMarkdownRecoverableDraft,
    associatedMarkdownRecoverableDraftContent,
    associatedMarkdownConflictResolution,
    associatedMarkdownDraftRecovery,
    associatedMarkdownFile,
    associatedMarkdownStatus,
    canSurfaceAssociatedMarkdownRecoverableDraft,
    content,
    hasAssociatedMarkdownHostConflict,
    id,
    isComposing,
    isEditingBody,
    noteMetadata.content
  ]);

  useEffect(() => {
    return () => {
      clearAssociatedMarkdownDraftSyncTimer();
      clearAssociatedMarkdownDraftCopiedTimer();
      data.onEndAssociatedNoteMarkdownEdit?.(id);
    };
  }, []);

  useEffect(() => {
    clearAssociatedMarkdownDraftCopiedTimer();
    setAssociatedMarkdownDraftCopied(false);
  }, [content]);

  useLayoutEffect(() => {
    if (!isEditingBody || !pendingBodyFocusRef.current) {
      return;
    }

    const focusRequest = pendingBodyFocusRef.current;
    pendingBodyFocusRef.current = null;
    const textarea = bodyInputRef.current;
    if (!textarea) {
      return;
    }

    const selectionStart = clampNoteMarkdownSourceOffset(focusRequest.selectionStart, textarea.value);
    const selectionEnd = clampNoteMarkdownSourceOffset(focusRequest.selectionEnd, textarea.value);
    const restoredScrollTop =
      resolveNoteBodyTextareaScrollTopForSourceOffset(
        textarea,
        textarea.value,
        selectionStart,
        bodyVisualLineCounts
      ) ?? pendingBodyScrollTopRef.current ?? bodyScrollTop;
    pendingBodyScrollTopRef.current = null;

    textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(selectionStart, selectionEnd, focusRequest.selectionDirection ?? 'none');

    const applyRestoredScrollTop = (): void => {
      textarea.scrollTop = clampElementScrollTop(textarea, restoredScrollTop);
      setBodyScrollTop(textarea.scrollTop);
    };

    applyRestoredScrollTop();
    const frame = window.requestAnimationFrame(applyRestoredScrollTop);
    return () => window.cancelAnimationFrame(frame);
  }, [isEditingBody]);

  useLayoutEffect(() => {
    if (!isEditingBody) {
      return;
    }

    measureBodyVisualLineCounts();
  }, [bodyLines, isEditingBody, measureBodyVisualLineCounts]);

  useLayoutEffect(() => {
    if (isEditingBody) {
      return;
    }

    const preview = bodyPreviewRef.current;
    if (!preview) {
      return;
    }

    const sourceOffset = pendingBodyPreviewScrollTargetRef.current;
    pendingBodyPreviewScrollTargetRef.current = null;
    if (sourceOffset !== null && scrollNoteMarkdownPreviewToSourceOffset(preview, sourceOffset)) {
      setBodyScrollTop(preview.scrollTop);
      return;
    }

    preview.scrollTop = clampElementScrollTop(preview, bodyScrollTop);
  }, [bodyScrollTop, isEditingBody, previewHtml]);

  useEffect(() => {
    if (!isEditingBody) {
      return;
    }

    const textarea = bodyInputRef.current;
    if (!textarea) {
      return;
    }

    let pendingFrame: number | undefined;
    const scheduleMeasurement = (): void => {
      if (pendingFrame !== undefined) {
        window.cancelAnimationFrame(pendingFrame);
      }

      pendingFrame = window.requestAnimationFrame(() => {
        pendingFrame = undefined;
        measureBodyVisualLineCounts();
      });
    };

    const resizeObserver = new ResizeObserver(scheduleMeasurement);
    resizeObserver.observe(textarea);
    scheduleMeasurement();

    return () => {
      resizeObserver.disconnect();
      if (pendingFrame !== undefined) {
        window.cancelAnimationFrame(pendingFrame);
      }
    };
  }, [isEditingBody, measureBodyVisualLineCounts]);

  useLayoutEffect(() => {
    if (!isEditingBody || !pendingBodySelectionRef.current) {
      return;
    }

    const textarea = bodyInputRef.current;
    const pendingSelection = pendingBodySelectionRef.current;
    pendingBodySelectionRef.current = null;
    if (!textarea) {
      return;
    }

    textarea.setSelectionRange(pendingSelection.selectionStart, pendingSelection.selectionEnd);
  }, [content, isEditingBody]);

  useLayoutEffect(() => {
    if (!isEditingBody || !pendingBodyFocusSelectionRef.current) {
      return;
    }

    const textarea = bodyInputRef.current;
    const pendingSelection = pendingBodyFocusSelectionRef.current;
    pendingBodyFocusSelectionRef.current = null;
    if (!textarea) {
      return;
    }

    const selectionStart = Math.min(pendingSelection.selectionStart, textarea.value.length);
    const selectionEnd = Math.min(pendingSelection.selectionEnd, textarea.value.length);
    textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(selectionStart, selectionEnd, pendingSelection.selectionDirection);
  }, [associatedMarkdownDraftRecovery, content, isEditingBody]);

  useEffect(() => {
    if (!overviewInteractionsDisabled) {
      return;
    }

    pendingBodyFocusRef.current = null;
    pendingBodySelectionRef.current = null;
    if (document.activeElement === bodyInputRef.current) {
      bodyInputRef.current?.blur();
    }
    endAssociatedMarkdownEdit();
    setIsEditingBody(false);
  }, [overviewInteractionsDisabled]);

  useEffect(() => {
    setIsEmbeddedLimitNoticeVisible(
      isEmbeddedNote && isEditingBody && content.length >= NOTE_EMBEDDED_CONTENT_MAX_LENGTH
    );
  }, [content.length, isEditingBody, isEmbeddedNote]);

  const normalizeEditableNoteContent = (nextContent: string): string => {
    if (!isEmbeddedNote || nextContent.length <= NOTE_EMBEDDED_CONTENT_MAX_LENGTH) {
      return nextContent;
    }

    setIsEmbeddedLimitNoticeVisible(true);
    return nextContent.slice(0, NOTE_EMBEDDED_CONTENT_MAX_LENGTH);
  };

  const updateBodyContent = (nextContent: string): string => {
    const normalizedContent = normalizeEditableNoteContent(nextContent);
    setContent(normalizedContent);
    if (associatedMarkdownFile && isEditingBody) {
      persistAssociatedMarkdownDraft(normalizedContent);
    }
    if (isEmbeddedNote && normalizedContent.length >= NOTE_EMBEDDED_CONTENT_MAX_LENGTH) {
      setIsEmbeddedLimitNoticeVisible(true);
    }
    return normalizedContent;
  };

  const submitNote = (nextContent: string, options: { force?: boolean } = {}): void => {
    if (associatedMarkdownFile && associatedMarkdownDraftRecovery && !options.force) {
      return;
    }
    if (associatedMarkdownFile && hasAssociatedMarkdownHostConflict && !options.force) {
      return;
    }

    const normalizedContent = normalizeEditableNoteContent(nextContent);
    if (normalizedContent !== nextContent) {
      setContent(normalizedContent);
    }

    const baselineContent = committedContentRef.current;
    if (normalizedContent === baselineContent && options.force !== true) {
      if (associatedMarkdownFile) {
        clearAssociatedMarkdownDraft();
      }
      return;
    }

    const baseContentRevision = associatedMarkdownFile
      ? isEditingBody
        ? editBaselineRevisionRef.current
        : associatedMarkdownContentRevision
      : undefined;
    const updatePayload: {
      nodeId: string;
      content: string;
      baseContentRevision?: string;
      force?: boolean;
    } = {
      nodeId: id,
      content: normalizedContent
    };
    if (baseContentRevision) {
      updatePayload.baseContentRevision = baseContentRevision;
    }
    if (options.force === true) {
      updatePayload.force = true;
    }
    if (associatedMarkdownFile) {
      pendingAssociatedMarkdownSubmissionRef.current = {
        content: normalizedContent,
        force: options.force === true
      };
      data.onUpdateNote?.(updatePayload);
      return;
    }

    committedContentRef.current = normalizedContent;
    pendingContentRef.current = normalizedContent;
    data.onUpdateNote?.(updatePayload);
  };

  const deleteNote = (): void => {
    data.onSelectNode?.(id);
    data.onDeleteNode?.(id);
  };

  const saveAsMarkdownFile = (): void => {
    data.onSelectNode?.(id);
    data.onSaveNoteAsMarkdownFile?.(id);
  };

  const openAssociatedMarkdownFile = (): void => {
    data.onSelectNode?.(id);
    data.onOpenAssociatedNoteMarkdownFile?.(id);
  };

  const createMissingAssociatedMarkdownFile = (): void => {
    data.onSelectNode?.(id);
    data.onCreateMissingAssociatedNoteMarkdownFile?.(id);
  };

  const copyAssociatedMarkdownSubtitlePath = (): void => {
    if (!associatedMarkdownSubtitle) {
      return;
    }

    data.onSelectNode?.(id);
    data.onCopyTextToClipboard?.(associatedMarkdownSubtitle, 'note-markdown-subtitle', id);
  };

  const copyNoteMarkdownMetadata = (rawBlock: string): void => {
    data.onSelectNode?.(id);
    data.onCopyTextToClipboard?.(rawBlock, 'note-markdown-metadata', id);
  };

  const reloadAssociatedMarkdownDraft = (): void => {
    if (
      !associatedMarkdownDraftRecovery &&
      !hasAssociatedMarkdownHostConflict &&
      !showAssociatedMarkdownRecoverableDraftPanel
    ) {
      return;
    }

    const nextContent = associatedMarkdownDraftRecovery?.remoteContent ?? noteMetadata.content;
    pendingAssociatedMarkdownSubmissionRef.current = null;
    setContent(nextContent);
    committedContentRef.current = nextContent;
    pendingContentRef.current = null;
    editBaselineContentRef.current = nextContent;
    editBaselineRevisionRef.current =
      associatedMarkdownDraftRecovery?.remoteContentRevision ?? associatedMarkdownContentRevision;
    setAssociatedMarkdownConflictResolution('reload');
    setAssociatedMarkdownDraftRecovery(null);
    setIsEditingBody(false);
    data.onReloadAssociatedNoteMarkdownFile?.(id);
    endAssociatedMarkdownEdit();
  };

  const overwriteAssociatedMarkdownFile = (): void => {
    if (!associatedMarkdownDraftRecovery) {
      return;
    }

    const nextContent = readCurrentBodyContent();
    setContent(nextContent);
    setAssociatedMarkdownConflictResolution('overwrite');
    setAssociatedMarkdownDraftRecovery(null);
    submitNote(nextContent, { force: true });
    setIsEditingBody(false);
    endAssociatedMarkdownEdit();
  };

  const copyAssociatedMarkdownDraft = (): void => {
    if (!associatedMarkdownDraftRecovery) {
      return;
    }

    data.onCopyAssociatedNoteMarkdownDraft?.(id, readCurrentBodyContent());
    clearAssociatedMarkdownDraftCopiedTimer();
    setAssociatedMarkdownDraftCopied(true);
    associatedMarkdownDraftCopiedTimerRef.current = window.setTimeout(() => {
      associatedMarkdownDraftCopiedTimerRef.current = undefined;
      setAssociatedMarkdownDraftCopied(false);
    }, 1600);
    bodyInputRef.current?.focus({ preventScroll: true });
  };

  const handleAssociatedMarkdownConflictActionPointerDown = (
    event: React.PointerEvent<HTMLButtonElement>
  ): void => {
    stopCanvasEvent(event);
  };

  const handleAssociatedMarkdownConflictActionMouseDown = (
    event: React.MouseEvent<HTMLButtonElement>
  ): void => {
    stopCanvasEvent(event);
  };

  const handleReloadAssociatedMarkdownDraftClick = (
    event: React.MouseEvent<HTMLButtonElement>
  ): void => {
    stopCanvasEvent(event);
    reloadAssociatedMarkdownDraft();
  };

  const handleCopyAssociatedMarkdownDraftClick = (
    event: React.MouseEvent<HTMLButtonElement>
  ): void => {
    stopCanvasEvent(event);
    copyAssociatedMarkdownDraft();
  };

  const handleOverwriteAssociatedMarkdownFileClick = (
    event: React.MouseEvent<HTMLButtonElement>
  ): void => {
    stopCanvasEvent(event);
    overwriteAssociatedMarkdownFile();
  };

  const handleCreateMissingAssociatedMarkdownFileClick = (
    event: React.MouseEvent<HTMLButtonElement>
  ): void => {
    stopCanvasEvent(event);
    createMissingAssociatedMarkdownFile();
  };

  const startEditingBody = (focusRequest?: NoteBodyFocusRequest): void => {
    if (overviewInteractionsDisabled || !associatedMarkdownFileEditable) {
      return;
    }
    const contentLength = noteMetadata.content.length;
    pendingBodyFocusRef.current = focusRequest ?? {
      selectionStart: contentLength,
      selectionEnd: contentLength
    };
    data.onSelectNode?.(id);
    editBaselineContentRef.current = noteMetadata.content;
    editBaselineRevisionRef.current = associatedMarkdownContentRevision;
    setAssociatedMarkdownConflictResolution(null);
    setAssociatedMarkdownDraftRecovery(null);
    pendingBodyScrollTopRef.current = bodyPreviewRef.current?.scrollTop ?? bodyScrollTop;
    beginAssociatedMarkdownEdit(noteMetadata.content);
    setIsEditingBody(true);
  };

  const handleBodyKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (associatedMarkdownDraftRecovery || hasAssociatedMarkdownHostConflict) {
      if (handleNoteBodyIndentKeyDown(event, updateBodyContent, pendingBodySelectionRef)) {
        return;
      }
      handleEditableFieldKeyDown(event, () => persistAssociatedMarkdownDraft(event.currentTarget.value, {
        immediate: true
      }), {
        isComposing
      });
      return;
    }

    if (handleNoteBodyIndentKeyDown(event, updateBodyContent, pendingBodySelectionRef)) {
      return;
    }

    handleEditableFieldKeyDown(event, () => submitNote(event.currentTarget.value), {
      isComposing
    });
  };

  const toggleChecklistFromPreview = (input: HTMLInputElement): void => {
    if (hasAssociatedMarkdownHostConflict) {
      return;
    }

    const lineNumber = readNoteMarkdownChecklistLineNumber(input);
    if (!lineNumber) {
      return;
    }

    const nextContent = toggleNoteMarkdownChecklistAtLine(content, lineNumber);
    if (!nextContent) {
      return;
    }

    data.onSelectNode?.(id);
    setContent(nextContent);
    submitNote(nextContent);
  };

  const handlePreviewClick = (event: React.MouseEvent<HTMLDivElement>): void => {
    const checkbox = findNoteMarkdownChecklistInputTarget(event.target);
    if (checkbox) {
      event.preventDefault();
      stopCanvasEvent(event);
      if (overviewInteractionsDisabled) {
        return;
      }
      toggleChecklistFromPreview(checkbox);
      return;
    }

    const link = findNoteMarkdownLinkTarget(event.target);
    if (link) {
      event.preventDefault();
      stopCanvasEvent(event);
      const href = link.getAttribute('href');
      if (href) {
        if (overviewInteractionsDisabled) {
          return;
        }
        data.onSelectNode?.(id);
        data.onOpenNoteLink?.(id, href);
      }
      return;
    }
  };

  const handlePreviewDoubleClick = (event: React.MouseEvent<HTMLDivElement>): void => {
    if (findNoteMarkdownChecklistInputTarget(event.target) || findNoteMarkdownLinkTarget(event.target)) {
      return;
    }
    if (overviewInteractionsDisabled) {
      return;
    }

    event.preventDefault();
    stopCanvasEvent(event);
    startEditingBody(
      createNoteBodyFocusRequestFromPreviewDoubleClick({
        content,
        event,
        preview: event.currentTarget
      })
    );
  };

  const handlePreviewKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (shouldHandleReadonlySelectAllShortcut(event)) {
      event.preventDefault();
      stopCanvasEvent(event);
      selectReadonlyTextContents(event.currentTarget);
      return;
    }

    if (shouldAllowReadonlyTextShortcutToBubble(event)) {
      return;
    }

    stopCanvasEvent(event);
    if (findNoteMarkdownChecklistInputTarget(event.target)) {
      return;
    }

    if (findNoteMarkdownLinkTarget(event.target)) {
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      startEditingBody();
    }
  };

  return (
    <CanvasNodeInteractionBoundary
      nodeId={id}
      disabled={data.overviewInteractionsDisabled}
      onModifierSelectNode={(nodeId) => data.onModifierSelectNode?.(nodeId)}
    >
      <div
      className={`canvas-node object-editor-node kind-note ${data.selected ? 'is-selected' : ''}`}
      data-node-id={id}
      data-node-kind={data.kind}
      data-node-selected={data.selected ? 'true' : 'false'}
    >
      <NodeResizeAffordance id={id} data={data} position={{ x: xPos, y: yPos }} zoom={zoom} />
      <NodeHandles selected={data.selected} />
      <div className="window-chrome" onDoubleClick={(event) => handleNodeChromeDoubleClick(event, id, data)}>
        <ChromeTitleEditor
          value={data.title}
          placeholder={t('note.title.placeholder')}
          className="note-window-title"
          subtitle={associatedMarkdownSubtitle}
          subtitleAccessory={
            associatedMarkdownSubtitle || markdownFrontMatter.kind !== 'none' ? (
              <>
                {associatedMarkdownSubtitle ? (
                  <SubtitleCopyButton
                    label={t('action.copyMarkdownPath')}
                    copiedLabel={t('action.copiedMarkdownPath')}
                    onCopy={copyAssociatedMarkdownSubtitlePath}
                    onFocus={() => data.onSelectNode?.(id)}
                  />
                ) : null}
                {markdownFrontMatter.kind !== 'none' ? (
                  <NoteMarkdownMetadataTrigger
                    frontMatter={markdownFrontMatter}
                    sourceLabel={
                      associatedMarkdownDraftRecovery || hasAssociatedMarkdownHostConflict
                        ? t('note.associated.currentDraftSource')
                        : undefined
                    }
                    onCopyMetadata={copyNoteMarkdownMetadata}
                    onFocus={() => data.onSelectNode?.(id)}
                  />
                ) : null}
              </>
            ) : undefined
          }
          onSelectNode={() => data.onSelectNode?.(id)}
          onSubmit={(title) => data.onUpdateNodeTitle?.(id, title)}
        />
        <div className="window-chrome-actions">
          {canOpenAssociatedMarkdownFile ? (
            <ActionButton
              label={t('action.openFile')}
              actionId="open-associated-markdown-file"
              tone="secondary"
              onClick={openAssociatedMarkdownFile}
              className="nodrag nopan compact"
              interactive
              onFocus={() => data.onSelectNode?.(id)}
            />
          ) : associatedMarkdownFile ? null : (
            <ActionButton
              label={t('action.saveAsMarkdown')}
              actionId="save-as-markdown"
              tone="secondary"
              onClick={saveAsMarkdownFile}
              className="nodrag nopan compact"
              interactive
              onFocus={() => data.onSelectNode?.(id)}
            />
          )}
          <ActionButton
            label={t('action.delete')}
            actionId="delete"
            tone="danger"
            onClick={deleteNote}
            className="nodrag nopan compact"
            interactive
            onFocus={() => data.onSelectNode?.(id)}
          />
        </div>
      </div>

      <div className="object-body object-surface note-surface">
        <NodeOverviewTitle title={data.title} />
        <div className="note-editor-surface" {...canvasOverviewInertProps(overviewInteractionsDisabled)}>
          {showAssociatedMarkdownUnavailablePanel ||
          showAssociatedMarkdownHostConflictPanel ||
          showAssociatedMarkdownRecoverableDraftPanel ? (
            <div
              className="note-file-warning nowheel nodrag nopan"
              data-node-interactive="true"
              data-probe-field="body"
              data-probe-value={content}
              role={
                showAssociatedMarkdownHostConflictPanel || showAssociatedMarkdownRecoverableDraftPanel
                  ? 'alert'
                  : 'status'
              }
            >
              <div className="note-file-conflict-card">
                <div className="note-file-conflict-copy">
                  <strong>{associatedMarkdownFilePanelTitle}</strong>
                  <span className="note-file-conflict-path">
                    {associatedMarkdownFile?.fullDisplayPath ?? associatedMarkdownFile?.displayPath}
                  </span>
                  <span className="note-file-conflict-detail">{associatedMarkdownFilePanelDetail}</span>
                </div>
                {showAssociatedMarkdownHostConflictPanel || showAssociatedMarkdownRecoverableDraftPanel ? (
                  <button
                    type="button"
                    className="note-edit-conflict-action nodrag nopan"
                    data-node-interactive="true"
                    data-note-conflict-action="true"
                    data-node-action-id="reload"
                    onPointerDown={handleAssociatedMarkdownConflictActionPointerDown}
                    onMouseDown={handleAssociatedMarkdownConflictActionMouseDown}
                    onClick={handleReloadAssociatedMarkdownDraftClick}
                  >
                    {t('action.reload')}
                  </button>
                ) : hasAssociatedMarkdownMissingFile ? (
                  <button
                    type="button"
                    className="note-edit-conflict-action nodrag nopan"
                    data-node-interactive="true"
                    data-note-conflict-action="true"
                    data-node-action-id="create-missing-associated-markdown-file"
                    onPointerDown={handleAssociatedMarkdownConflictActionPointerDown}
                    onMouseDown={handleAssociatedMarkdownConflictActionMouseDown}
                    onClick={handleCreateMissingAssociatedMarkdownFileClick}
                  >
                    {t('action.createEmptyAndAssociate')}
                  </button>
                ) : null}
              </div>
            </div>
          ) : isEditingBody ? (
            <div className="note-document-editor">
              <div className="note-document-line-number-gutter" aria-hidden="true">
                <div
                  className="note-document-line-number-list"
                  style={{ transform: `translateY(-${bodyScrollTop}px)` }}
                >
                  {bodyLineNumberRows.map((row) => (
                    <span
                      className={`note-document-line-number${row.lineNumber === null ? ' is-continuation' : ''}`}
                      key={row.key}
                    >
                      {row.lineNumber ?? ''}
                    </span>
                  ))}
                </div>
              </div>
              <div ref={bodyMeasureRef} className="note-document-line-measure" aria-hidden="true">
                {bodyLines.map((line, index) => (
                  <span className="note-document-line-measure-line" key={index}>
                    {line}
                  </span>
                ))}
              </div>
              <textarea
                ref={bodyInputRef}
                className="node-document-input note-document-input nowheel nodrag nopan"
                data-node-interactive="true"
                data-probe-field="body"
                value={content}
                disabled={overviewInteractionsDisabled}
                tabIndex={overviewInteractionsDisabled ? -1 : undefined}
                onFocus={() => {
                  if (overviewInteractionsDisabled) {
                    bodyInputRef.current?.blur();
                    return;
                  }
                  setIsEditingBody(true);
                  data.onSelectNode?.(id);
                }}
                onMouseDown={stopCanvasEvent}
                onClick={stopCanvasEvent}
                onWheel={stopCanvasEvent}
                onScroll={(event) => setBodyScrollTop(event.currentTarget.scrollTop)}
                onCompositionStart={() => setIsComposing(true)}
                onCompositionEnd={(event) => {
                  setIsComposing(false);
                  updateBodyContent(event.currentTarget.value);
                }}
                onChange={(event) => updateBodyContent(event.target.value)}
                onBlur={(event) => {
                  if (
                    (associatedMarkdownDraftRecovery || hasAssociatedMarkdownHostConflict) &&
                    isAssociatedMarkdownConflictActionTarget(event.relatedTarget)
                  ) {
                    return;
                  }

                  const nextContent = event.currentTarget.value;
                  updateBodyContent(nextContent);
                  if (associatedMarkdownDraftRecovery || hasAssociatedMarkdownHostConflict) {
                    persistAssociatedMarkdownDraft(nextContent, { immediate: true });
                    return;
                  }
                  pendingBodyPreviewScrollTargetRef.current = resolveNoteBodySourceOffsetForTextareaScrollTop(
                    event.currentTarget,
                    nextContent,
                    bodyVisualLineCounts
                  );
                  setIsEditingBody(false);
                  submitNote(nextContent);
                  endAssociatedMarkdownEdit();
                }}
                onKeyDown={handleBodyKeyDown}
                maxLength={isEmbeddedNote ? NOTE_EMBEDDED_CONTENT_MAX_LENGTH : undefined}
                placeholder={bodyPlaceholder}
                spellCheck={false}
              />
              {isEmbeddedLimitNoticeVisible ? (
                <div className="note-limit-hint" role="status">
                  {t('note.body.limitReached', { max: NOTE_EMBEDDED_CONTENT_MAX_LENGTH.toLocaleString() })}
                </div>
              ) : null}
              {associatedMarkdownDraftRecovery ? (
                <div className="note-edit-conflict-hint" role="alert">
                  <span>{associatedMarkdownDraftRecoveryHint}</span>
                  <button
                    type="button"
                    className="note-edit-conflict-action nodrag nopan"
                    data-node-interactive="true"
                    data-note-conflict-action="true"
                    data-node-action-id="reload"
                    onPointerDown={handleAssociatedMarkdownConflictActionPointerDown}
                    onMouseDown={handleAssociatedMarkdownConflictActionMouseDown}
                    onClick={handleReloadAssociatedMarkdownDraftClick}
                  >
                    {t('action.reload')}
                  </button>
                  <button
                    type="button"
                    className="note-edit-conflict-action nodrag nopan"
                    data-node-interactive="true"
                    data-note-conflict-action="true"
                    data-node-action-id="copy-draft"
                    onPointerDown={handleAssociatedMarkdownConflictActionPointerDown}
                    onMouseDown={handleAssociatedMarkdownConflictActionMouseDown}
                    onClick={handleCopyAssociatedMarkdownDraftClick}
                  >
                    {associatedMarkdownDraftCopied ? t('action.copied') : t('action.copyDraft')}
                  </button>
                  <button
                    type="button"
                    className="note-edit-conflict-action is-danger nodrag nopan"
                    data-node-interactive="true"
                    data-note-conflict-action="true"
                    data-node-action-id="overwrite-file"
                    onPointerDown={handleAssociatedMarkdownConflictActionPointerDown}
                    onMouseDown={handleAssociatedMarkdownConflictActionMouseDown}
                    onClick={handleOverwriteAssociatedMarkdownFileClick}
                  >
                    {t('action.overwriteFile')}
                  </button>
                </div>
              ) : null}
            </div>
          ) : (
            <div
              ref={bodyPreviewRef}
              className={`note-markdown-preview nowheel nodrag nopan ${content.trim() ? '' : 'is-empty'}`.trim()}
              data-node-interactive="true"
              data-probe-field="body"
              data-probe-value={content}
              tabIndex={overviewInteractionsDisabled ? -1 : 0}
              aria-hidden={overviewInteractionsDisabled ? true : undefined}
              aria-label={t('note.preview.ariaLabel')}
              onFocus={(event) => {
                if (overviewInteractionsDisabled) {
                  event.currentTarget.blur();
                  return;
                }
                data.onSelectNode?.(id);
              }}
              onMouseDown={stopCanvasEvent}
              onClick={handlePreviewClick}
              onDoubleClick={handlePreviewDoubleClick}
              onScroll={(event) => setBodyScrollTop(event.currentTarget.scrollTop)}
              onKeyDown={handlePreviewKeyDown}
            >
              {previewHtml ? (
                <div
                  className="note-markdown-preview-copy"
                  dangerouslySetInnerHTML={{ __html: previewHtml }}
                />
              ) : (
                <p className="note-markdown-preview-placeholder">{bodyPlaceholder}</p>
              )}
            </div>
          )}
        </div>
      </div>
      </div>
    </CanvasNodeInteractionBoundary>
  );
}

function CompactCanvasCardNode({ id, data, xPos, yPos }: NodeProps<CanvasNodeData>): JSX.Element {
  const { zoom } = useViewport();
  return <CompactCanvasCardNodeContent id={id} data={data} position={{ x: xPos, y: yPos }} zoom={zoom} />;
}

function CompactCanvasCardNodeContent({ id, data, position, zoom }: Pick<NodeProps<CanvasNodeData>, 'id' | 'data'> & { position: CanvasNodePosition; zoom: number }): JSX.Element {
  const agentMetadata = data.metadata?.agent;
  const terminalMetadata = data.metadata?.terminal;

  return (
    <CanvasNodeInteractionBoundary
      nodeId={id}
      disabled={data.overviewInteractionsDisabled}
      onModifierSelectNode={(nodeId) => data.onModifierSelectNode?.(nodeId)}
    >
      <div
      className={`canvas-node compact-node kind-${data.kind} ${data.selected ? 'is-selected' : ''}`}
      data-node-id={id}
      data-node-kind={data.kind}
      data-node-selected={data.selected ? 'true' : 'false'}
    >
      <NodeResizeAffordance id={id} data={data} position={position} zoom={zoom} />
      <NodeHandles selected={data.selected} />
      <NodeOverviewTitle title={data.title} status={overviewStatusForNode(data)} />
      <div className="node-topline">
        <strong>{data.title}</strong>
        <span>{data.kind}</span>
      </div>
      <div className="node-status">
        {t('compact.status', { status: webviewHumanizeCanvasNodeStatus(data) })}
      </div>
      {data.kind === 'agent' && agentMetadata ? (
        <div className="node-hint">
          {agentMetadata.liveSession
            ? t('agent.compact.running', { provider: providerLabel(agentMetadata.provider) })
            : agentMetadata.recentOutput
              ? t('agent.compact.recentOutput')
              : t('agent.compact.notRunning')}
        </div>
      ) : null}
      {data.kind === 'terminal' && terminalMetadata ? (
        <div className="node-hint">
          {terminalMetadata.liveSession ? t('terminal.compact.running') : t('terminal.compact.notRunning')}
        </div>
      ) : null}
      <p>{data.summary}</p>
      <div className="action-row compact-node-actions">
        <ActionButton
          label={t('action.delete')}
          actionId="delete"
          tone="danger"
          onClick={() => data.onDeleteNode?.(id)}
          className="compact nodrag nopan"
          interactive
          onFocus={() => data.onSelectNode?.(id)}
        />
      </div>
      </div>
    </CanvasNodeInteractionBoundary>
  );
}

const executionNodeTypes = createExecutionSessionNodeTypes({
  t,
  tAgentLaunchMessage,
  agentCommandParseErrorFallback: t('agentLaunchPreset.agentCommandParseError'),
  executionNodeHelpTips: EXECUTION_NODE_HELP_TIPS,
  createEmbeddedTerminalOptions,
  createExecutionTerminalController,
  executionTerminalRegistry,
  getRuntimeContext: () => latestRuntimeContext,
  resolveExecutionTerminalFileLinks,
  reportExecutionInputDispatch,
  createZoomAdjustedMouseEvent,
  positionTextareaUnderScaledMouse,
  readXtermScreenElement,
  shouldSelectExecutionNodeForTerminalSelection,
  handleNodeChromeDoubleClick,
  CompactCanvasCardNodeContent,
  NodeResizeAffordance,
  NodeHandles,
  NodeOverviewTitle,
  ExecutionHelpTrigger,
  ExecutionAttentionStatus,
  ActionButton
});

const nodeTypes = {
  agent: executionNodeTypes.agent,
  terminal: executionNodeTypes.terminal,
  note: NoteEditableNode,
  file: FileNode,
  'file-list': FileListNode,
  card: CompactCanvasCardNode
};

function CanvasExecutionHelpPanel(props: { help: ExecutionNodeHelpContent }): JSX.Element {
  return (
    <div className="canvas-corner-panel canvas-help-panel">
      <ExecutionHelpTrigger help={props.help} variant="canvas" />
    </div>
  );
}

function ExecutionHelpTrigger(props: {
  help: ExecutionNodeHelpContent;
  variant: ExecutionHelpTriggerVariant;
}): JSX.Element {
  const overviewInteractionsDisabled = useCanvasOverviewInteractionsDisabled();
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const tooltipIdRef = useRef<string>('');
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [position, setPosition] = useState<FloatingTooltipPosition | null>(null);
  const visible = !overviewInteractionsDisabled && (hovered || focused);
  const label = props.variant === 'canvas' ? t('execution.help.trigger') : undefined;
  const showGlyph = props.variant === 'inline';

  if (!tooltipIdRef.current) {
    tooltipIdRef.current = `execution-node-help-tooltip-${nextExecutionNodeHelpTooltipId++}`;
  }

  useEffect(() => {
    if (!overviewInteractionsDisabled) {
      return;
    }

    setHovered(false);
    setFocused(false);
  }, [overviewInteractionsDisabled]);

  useLayoutEffect(() => {
    if (!visible) {
      setPosition(null);
      return;
    }

    const updatePosition = (): void => {
      const button = buttonRef.current;
      const tooltip = tooltipRef.current;
      if (!button || !tooltip) {
        return;
      }

      const margin = 12;
      const gap = 8;
      const buttonRect = button.getBoundingClientRect();
      const tooltipRect = tooltip.getBoundingClientRect();
      const maxLeft = Math.max(margin, window.innerWidth - margin - tooltipRect.width);
      const maxTop = Math.max(margin, window.innerHeight - margin - tooltipRect.height);
      let left = buttonRect.right - tooltipRect.width;
      let top = buttonRect.bottom + gap;

      if (top + tooltipRect.height > window.innerHeight - margin) {
        top = buttonRect.top - tooltipRect.height - gap;
      }

      left = Math.min(Math.max(margin, left), maxLeft);
      top = Math.min(Math.max(margin, top), maxTop);
      setPosition({ left, top });
    };

    const frame = window.requestAnimationFrame(updatePosition);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [visible]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`execution-help-trigger execution-help-trigger-${props.variant}`}
        data-node-interactive="true"
        aria-label={EXECUTION_TERMINAL_HELP_TOOLTIP}
        aria-describedby={visible ? tooltipIdRef.current : undefined}
        aria-hidden={overviewInteractionsDisabled ? true : undefined}
        disabled={overviewInteractionsDisabled}
        tabIndex={overviewInteractionsDisabled ? -1 : undefined}
        onMouseDown={stopCanvasEvent}
        onClick={stopCanvasEvent}
        onKeyDown={(event) => {
          stopCanvasEvent(event);
          if (event.key === 'Escape') {
            setHovered(false);
            setFocused(false);
            event.currentTarget.blur();
          }
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      >
        {showGlyph ? (
          <span
            className="execution-help-trigger-icon codicon codicon-info"
            aria-hidden="true"
          />
        ) : null}
        {label ? <span className="execution-help-trigger-label">{label}</span> : null}
      </button>
      {visible
        ? createPortal(
            <div
              ref={tooltipRef}
              id={tooltipIdRef.current}
              role="tooltip"
              className={`execution-node-help-tooltip${position ? ' is-visible' : ''}`}
              style={
                position
                  ? {
                      left: position.left,
                      top: position.top
                    }
                  : undefined
              }
            >
              <strong className="execution-node-help-tooltip-title">{props.help.title}</strong>
              <div className="execution-node-help-tooltip-items">
                {props.help.items.map((item, index) => (
                  <div key={`${index}-${item}`} className="execution-node-help-tooltip-item">
                    <span className="execution-node-help-tooltip-index">{`${index + 1}. `}</span>
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
}

function ActionButton(props: {
  label: React.ReactNode;
  actionId?: WebviewNodeActionId;
  onClick: () => void;
  tone?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  className?: string;
  interactive?: boolean;
  onFocus?: () => void;
  buttonProps?: Omit<
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    'type' | 'className' | 'children' | 'onClick' | 'onFocus' | 'disabled'
  > &
    Record<`data-${string}`, string | number | boolean | undefined>;
}): JSX.Element {
  const overviewInteractionsDisabled = useCanvasOverviewInteractionsDisabled();
  const disabled = props.disabled || overviewInteractionsDisabled;
  const toneClass =
    props.tone === 'primary'
      ? 'primary'
      : props.tone === 'danger'
        ? 'danger'
        : 'secondary';

  return (
    <button
      type="button"
      {...props.buttonProps}
      data-node-action-id={props.actionId ?? props.buttonProps?.['data-node-action-id']}
      data-node-interactive={props.interactive ? 'true' : undefined}
      className={`action-button ${toneClass} ${props.className ?? ''}`.trim()}
      disabled={disabled}
      tabIndex={overviewInteractionsDisabled ? -1 : props.buttonProps?.tabIndex}
      aria-hidden={overviewInteractionsDisabled ? true : props.buttonProps?.['aria-hidden']}
      onFocus={props.onFocus}
      onPointerDown={props.interactive ? stopCanvasEvent : undefined}
      onMouseDown={props.interactive ? stopCanvasEvent : undefined}
      onClick={(event) => {
        if (props.interactive) {
          stopCanvasEvent(event);
        }
        if (disabled) {
          return;
        }
        props.onClick();
      }}
      onPointerUp={props.interactive ? stopCanvasEvent : undefined}
      onKeyDown={props.interactive ? stopCanvasEvent : undefined}
    >
      <span className="action-button-label">{props.label}</span>
    </button>
  );
}

const CanvasContextMenu = React.forwardRef<
  HTMLDivElement,
  {
    screenX: number;
    screenY: number;
    view: CanvasContextMenuView;
    selectedAgentProvider?: AgentProviderKind;
    kinds: CanvasCreatableNodeKind[];
    templateEntries: CanvasTemplateMenuEntry[];
    defaultAgentProvider: AgentProviderKind;
    agentLaunchDefaults: AgentLaunchDefaultsByProvider;
    canSaveCurrentCanvas: boolean;
    canCreateGroupFromSelection: boolean;
    canArrangeWorkspaceLayoutScope: boolean;
    canClearWorkspaceCanvasScope: boolean;
    clearCanvasTargetKind?: CanvasClearCanvasTargetKind;
    onCreate: (
      kind: CanvasCreatableNodeKind,
      agentProvider?: AgentProviderKind,
      agentLaunchPreset?: AgentLaunchPresetKind,
      agentCustomLaunchCommand?: string
    ) => void;
    onShowAgentLaunchModes: (provider: AgentProviderKind) => void;
    onShowTemplatePicker: (view: 'apply-template' | 'reset-template') => void;
    onShowArrangeLayoutScope: () => void;
    onShowClearCanvasScope: () => void;
    onApplyDefaultTemplate: () => void;
    onResetToDefaultTemplate: () => void;
    onArrangeCanvasLayout: (scope: 'target' | 'workspace') => void;
    onClearCanvas: (scope: 'target' | 'workspace') => void;
    onApplyTemplate: (templateId: string, reset: boolean) => void;
    onSaveCanvasAsTemplate: () => void;
    onCreateEmptyGroup: () => void;
    onCreateGroupFromSelection: () => void;
    onBack: () => void;
    onClose: () => void;
  }
>(function CanvasContextMenu(props, ref): JSX.Element {
  const position = resolveContextMenuScreenPosition(props.screenX, props.screenY);
  const providerItems = orderedAgentProviders(props.defaultAgentProvider);
  const rootKinds = (['note', 'terminal'] as const).filter((kind) => props.kinds.includes(kind));
  const showAgentProviders = props.kinds.includes('agent');
  const isNestedView = props.view !== 'root';
  const isTemplatePickerView = props.view === 'apply-template' || props.view === 'reset-template';
  const isResetTemplatePicker = props.view === 'reset-template';
  const defaultTemplateEntry = props.templateEntries.find((entry) => entry.isDefault) ?? props.templateEntries[0];
  const selectedAgentProvider = props.selectedAgentProvider ?? props.defaultAgentProvider;
  const selectedLaunchDefaults = props.agentLaunchDefaults[selectedAgentProvider];
  const defaultPresetBuild = tryBuildAgentPresetCommandLine(
    selectedAgentProvider,
    selectedLaunchDefaults,
    'default'
  );
  const [customEditorOpen, setCustomEditorOpen] = useState(false);
  const [customInputIsComposing, setCustomInputIsComposing] = useState(false);
  const [customCommandLine, setCustomCommandLine] = useState(() =>
    defaultPresetBuild.commandLine ?? fallbackAgentCommandLine(selectedAgentProvider, selectedLaunchDefaults)
  );

  useEffect(() => {
    setCustomEditorOpen(false);
    setCustomInputIsComposing(false);
    setCustomCommandLine(
      defaultPresetBuild.commandLine ?? fallbackAgentCommandLine(selectedAgentProvider, selectedLaunchDefaults)
    );
  }, [
    defaultPresetBuild.commandLine,
    props.view,
    selectedAgentProvider,
    selectedLaunchDefaults.command,
    selectedLaunchDefaults.defaultArgs
  ]);

  const customValidation = validateAgentCommandLine(
    customCommandLine,
    selectedAgentProvider,
    selectedLaunchDefaults
  );

  const createAgentWithCustomCommand = (): void => {
    if (!customValidation.valid) {
      return;
    }

    const classification = classifyAgentLaunchPreset(
      selectedAgentProvider,
      customCommandLine,
      selectedLaunchDefaults
    );
    props.onCreate(
      'agent',
      selectedAgentProvider,
      classification.launchPreset,
      classification.customLaunchCommand
    );
  };

  return (
    <div
      ref={ref}
      className="canvas-context-menu"
      data-context-menu="true"
      style={{
        left: position.x,
        top: position.y
      }}
      onMouseDown={stopCanvasEvent}
      onClick={stopCanvasEvent}
      onKeyDownCapture={(event) => {
        if (
          customEditorOpen &&
          event.key === 'Escape' &&
          !customInputIsComposing &&
          !isImeComposingKeyboardEvent(event)
        ) {
          event.preventDefault();
          stopCanvasEvent(event);
          setCustomEditorOpen(false);
        }
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        stopCanvasEvent(event);
      }}
    >
      <div className={`canvas-context-menu-header${isNestedView ? ' with-back' : ''}`}>
        {isNestedView ? (
          <button
            type="button"
            className="canvas-context-menu-header-back"
            data-context-menu-back="true"
            onClick={props.onBack}
            aria-label={t('contextMenu.back')}
            title={t('contextMenu.back')}
          >
            <span
              className="canvas-context-menu-icon codicon codicon-chevron-left"
              aria-hidden="true"
            />
          </button>
        ) : null}
        <div className="canvas-context-menu-header-copy">
          <strong>
            {props.view === 'root'
              ? t('contextMenu.header.canvasActions')
              : props.view === 'agent-launch-mode'
                ? t('contextMenu.header.selectLaunchMode', { provider: providerLabel(selectedAgentProvider) })
                : props.view === 'arrange-layout-scope'
                  ? t('contextMenu.header.arrangeLayoutScope')
                  : props.view === 'clear-canvas-scope'
                    ? t('contextMenu.header.clearCanvasScope')
                    : isResetTemplatePicker
                      ? t('contextMenu.header.resetTemplate')
                      : t('contextMenu.header.applyTemplate')}
          </strong>
          {props.view === 'root' ? null : (
            <span>
              {props.view === 'agent-launch-mode'
                ? t('contextMenu.subtitle.selectLaunchMode')
                : props.view === 'arrange-layout-scope'
                  ? t('contextMenu.subtitle.arrangeLayoutScope')
                  : props.view === 'clear-canvas-scope'
                    ? t('contextMenu.subtitle.clearCanvasScope')
                    : isResetTemplatePicker
                      ? t('contextMenu.subtitle.resetTemplate')
                      : t('contextMenu.subtitle.applyTemplate')}
            </span>
          )}
        </div>
      </div>
      <div className="canvas-context-menu-items">
        {props.view === 'root' ? (
          <>
            {rootKinds.map((kind) => (
              <button
                key={kind}
                type="button"
                className="canvas-context-menu-item"
                data-context-menu-kind={kind}
                onClick={() => props.onCreate(kind)}
              >
                <span
                  className="canvas-context-menu-swatch"
                  style={{ backgroundColor: colorForKind(kind) }}
                  aria-hidden="true"
                />
                <span className="canvas-context-menu-copy">
                  <strong>{humanizeNodeKind(kind)}</strong>
                  <span>{describeContextMenuKind(kind)}</span>
                </span>
              </button>
            ))}
            {showAgentProviders
              ? providerItems.map((provider) => (
                  <div
                    key={provider}
                    className="canvas-context-menu-split-item"
                    data-context-menu-provider={provider}
                  >
                    <button
                      type="button"
                      className="canvas-context-menu-item"
                      data-context-menu-provider-action="create-default"
                      data-context-menu-agent-action={
                        provider === props.defaultAgentProvider ? 'create-default' : undefined
                      }
                      onClick={() => props.onCreate('agent', provider, 'default')}
                    >
                      <span
                        className="canvas-context-menu-swatch"
                        style={{ backgroundColor: colorForKind('agent') }}
                        aria-hidden="true"
                      />
                      <span className="canvas-context-menu-copy">
                        <strong>
                          {provider === props.defaultAgentProvider
                            ? t('contextMenu.providerDefault', { provider: providerLabel(provider) })
                            : providerLabel(provider)}
                        </strong>
                        <span>{describeAgentProviderContextMenu(provider)}</span>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="canvas-context-menu-item-secondary"
                      data-context-menu-provider-action="show-launch-modes"
                      onClick={() => props.onShowAgentLaunchModes(provider)}
                      aria-label={t('contextMenu.selectProviderLaunchMode', { provider: providerLabel(provider) })}
                      title={t('contextMenu.selectProviderLaunchMode', { provider: providerLabel(provider) })}
                    >
                      <span
                        className="canvas-context-menu-icon codicon codicon-chevron-right"
                        aria-hidden="true"
                      />
                    </button>
                  </div>
                ))
              : null}
            <div className="canvas-context-menu-separator" aria-hidden="true" />
            <button
              type="button"
              className="canvas-context-menu-item"
              data-context-menu-action="create-empty-group"
              onClick={props.onCreateEmptyGroup}
            >
              <span className="canvas-context-menu-icon codicon codicon-symbol-array" aria-hidden="true" />
              <span className="canvas-context-menu-copy">
                <strong>{t('contextMenu.createGroup.title')}</strong>
                <span>{t('contextMenu.createGroup.description')}</span>
              </span>
            </button>
            {props.canCreateGroupFromSelection ? (
              <button
                type="button"
                className="canvas-context-menu-item"
                data-context-menu-action="create-group-from-selection"
                onClick={props.onCreateGroupFromSelection}
              >
                <span className="canvas-context-menu-icon codicon codicon-group-by-ref-type" aria-hidden="true" />
                <span className="canvas-context-menu-copy">
                  <strong>{t('contextMenu.createGroupFromSelection.title')}</strong>
                  <span>{t('contextMenu.createGroupFromSelection.description')}</span>
                </span>
              </button>
            ) : null}
            {props.canArrangeWorkspaceLayoutScope ? (
              <div className="canvas-context-menu-split-item" data-context-menu-arrange-group="layout">
                <button
                  type="button"
                  className="canvas-context-menu-item"
                  data-context-menu-action="arrange-canvas-layout"
                  onClick={() => props.onArrangeCanvasLayout('target')}
                >
                  <span className="canvas-context-menu-icon codicon codicon-type-hierarchy-sub" aria-hidden="true" />
                  <span className="canvas-context-menu-copy">
                    <strong>{t('contextMenu.arrangeCanvas.title')}</strong>
                    <span>{t('contextMenu.arrangeCanvas.currentRootDescription')}</span>
                  </span>
                </button>
                <button
                  type="button"
                  className="canvas-context-menu-item-secondary"
                  data-context-menu-action="show-arrange-layout-scope"
                  onClick={props.onShowArrangeLayoutScope}
                  aria-label={t('contextMenu.arrangeCanvas.chooseScope')}
                  title={t('contextMenu.arrangeCanvas.chooseScope')}
                >
                  <span
                    className="canvas-context-menu-icon codicon codicon-chevron-right"
                    aria-hidden="true"
                  />
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="canvas-context-menu-item"
                data-context-menu-action="arrange-canvas-layout"
                onClick={() => props.onArrangeCanvasLayout('target')}
              >
                <span className="canvas-context-menu-icon codicon codicon-type-hierarchy-sub" aria-hidden="true" />
                <span className="canvas-context-menu-copy">
                  <strong>{t('contextMenu.arrangeCanvas.title')}</strong>
                  <span>{t('contextMenu.arrangeCanvas.description')}</span>
                </span>
              </button>
            )}
            {props.canClearWorkspaceCanvasScope ? (
              <div className="canvas-context-menu-split-item" data-context-menu-clear-group="canvas">
                <button
                  type="button"
                  className="canvas-context-menu-item"
                  data-context-menu-action="clear-canvas"
                  onClick={() => props.onClearCanvas('target')}
                >
                  <span className="canvas-context-menu-icon codicon codicon-trash" aria-hidden="true" />
                  <span className="canvas-context-menu-copy">
                    <strong>{t('contextMenu.clearCanvas.title')}</strong>
                    <span>
                      {props.clearCanvasTargetKind === 'group'
                        ? t('contextMenu.clearCanvas.currentGroupDescription')
                        : t('contextMenu.clearCanvas.currentRootDescription')}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  className="canvas-context-menu-item-secondary"
                  data-context-menu-action="show-clear-canvas-scope"
                  onClick={props.onShowClearCanvasScope}
                  aria-label={t('contextMenu.clearCanvas.chooseScope')}
                  title={t('contextMenu.clearCanvas.chooseScope')}
                >
                  <span
                    className="canvas-context-menu-icon codicon codicon-chevron-right"
                    aria-hidden="true"
                  />
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="canvas-context-menu-item"
                data-context-menu-action="clear-canvas"
                onClick={() => props.onClearCanvas('target')}
              >
                <span className="canvas-context-menu-icon codicon codicon-trash" aria-hidden="true" />
                <span className="canvas-context-menu-copy">
                  <strong>{t('contextMenu.clearCanvas.title')}</strong>
                  <span>
                    {props.clearCanvasTargetKind === 'group'
                      ? t('contextMenu.clearCanvas.currentGroupDescription')
                      : props.clearCanvasTargetKind === 'workspace-root'
                        ? t('contextMenu.clearCanvas.currentRootDescription')
                        : t('contextMenu.clearCanvas.description')}
                  </span>
                </span>
              </button>
            )}
            <div className="canvas-context-menu-separator" aria-hidden="true" />
            <div className="canvas-context-menu-split-item" data-context-menu-template-group="apply">
              <button
                type="button"
                className="canvas-context-menu-item"
                data-context-menu-action="apply-default-template"
                onClick={props.onApplyDefaultTemplate}
              >
                <span className="canvas-context-menu-icon codicon codicon-library" aria-hidden="true" />
                <span className="canvas-context-menu-copy">
                  <strong>{t('contextMenu.applyTemplate.title')}</strong>
                  <span>
                    {defaultTemplateEntry
                      ? t('contextMenu.applyTemplate.defaultWithName', { name: defaultTemplateEntry.name })
                      : t('contextMenu.applyTemplate.default')}
                  </span>
                </span>
              </button>
              <button
                type="button"
                className="canvas-context-menu-item-secondary"
                data-context-menu-action="show-apply-template-picker"
                disabled={props.templateEntries.length === 0}
                onClick={() => props.onShowTemplatePicker('apply-template')}
                aria-label={t('contextMenu.applyTemplate.choose')}
                title={t('contextMenu.applyTemplate.choose')}
              >
                <span
                  className="canvas-context-menu-icon codicon codicon-chevron-right"
                  aria-hidden="true"
                />
              </button>
            </div>
            <div className="canvas-context-menu-split-item" data-context-menu-template-group="reset">
              <button
                type="button"
                className="canvas-context-menu-item"
                data-context-menu-action="reset-default-template"
                onClick={props.onResetToDefaultTemplate}
              >
                <span className="canvas-context-menu-icon codicon codicon-discard" aria-hidden="true" />
                <span className="canvas-context-menu-copy">
                  <strong>{t('contextMenu.resetTemplate.title')}</strong>
                  <span>
                    {defaultTemplateEntry
                      ? t('contextMenu.resetTemplate.defaultWithName', { name: defaultTemplateEntry.name })
                      : t('contextMenu.resetTemplate.default')}
                  </span>
                </span>
              </button>
              <button
                type="button"
                className="canvas-context-menu-item-secondary"
                data-context-menu-action="show-reset-template-picker"
                disabled={props.templateEntries.length === 0}
                onClick={() => props.onShowTemplatePicker('reset-template')}
                aria-label={t('contextMenu.resetTemplate.choose')}
                title={t('contextMenu.resetTemplate.choose')}
              >
                <span
                  className="canvas-context-menu-icon codicon codicon-chevron-right"
                  aria-hidden="true"
                />
              </button>
            </div>
            <button
              type="button"
              className="canvas-context-menu-item"
              data-context-menu-action="save-canvas-template"
              disabled={!props.canSaveCurrentCanvas}
              onClick={props.onSaveCanvasAsTemplate}
            >
              <span className="canvas-context-menu-icon codicon codicon-save-as" aria-hidden="true" />
              <span className="canvas-context-menu-copy">
                <strong>{t('contextMenu.saveTemplate.title')}</strong>
                <span>{t('contextMenu.saveTemplate.description')}</span>
              </span>
            </button>
          </>
        ) : props.view === 'arrange-layout-scope' ? (
          <>
            <button
              type="button"
              className="canvas-context-menu-item"
              data-context-menu-action="arrange-current-root-canvas-layout"
              onClick={() => props.onArrangeCanvasLayout('target')}
            >
              <span className="canvas-context-menu-icon codicon codicon-type-hierarchy-sub" aria-hidden="true" />
              <span className="canvas-context-menu-copy">
                <strong>{t('contextMenu.arrangeCanvas.currentRoot.title')}</strong>
                <span>{t('contextMenu.arrangeCanvas.currentRoot.description')}</span>
              </span>
            </button>
            <button
              type="button"
              className="canvas-context-menu-item"
              data-context-menu-action="arrange-workspace-canvas-layout"
              onClick={() => props.onArrangeCanvasLayout('workspace')}
            >
              <span className="canvas-context-menu-icon codicon codicon-globe" aria-hidden="true" />
              <span className="canvas-context-menu-copy">
                <strong>{t('contextMenu.arrangeCanvas.workspace.title')}</strong>
                <span>{t('contextMenu.arrangeCanvas.workspace.description')}</span>
              </span>
            </button>
          </>
        ) : props.view === 'clear-canvas-scope' ? (
          <>
            <button
              type="button"
              className="canvas-context-menu-item"
              data-context-menu-action="clear-current-canvas"
              onClick={() => props.onClearCanvas('target')}
            >
              <span className="canvas-context-menu-icon codicon codicon-trash" aria-hidden="true" />
              <span className="canvas-context-menu-copy">
                <strong>
                  {props.clearCanvasTargetKind === 'group'
                    ? t('contextMenu.clearCanvas.currentGroup.title')
                    : t('contextMenu.clearCanvas.currentRoot.title')}
                </strong>
                <span>
                  {props.clearCanvasTargetKind === 'group'
                    ? t('contextMenu.clearCanvas.currentGroup.description')
                    : t('contextMenu.clearCanvas.currentRoot.description')}
                </span>
              </span>
            </button>
            <button
              type="button"
              className="canvas-context-menu-item"
              data-context-menu-action="clear-workspace-canvas"
              onClick={() => props.onClearCanvas('workspace')}
            >
              <span className="canvas-context-menu-icon codicon codicon-globe" aria-hidden="true" />
              <span className="canvas-context-menu-copy">
                <strong>{t('contextMenu.clearCanvas.workspace.title')}</strong>
                <span>{t('contextMenu.clearCanvas.workspace.description')}</span>
              </span>
            </button>
          </>
        ) : props.view === 'agent-launch-mode' ? (
          <>
            {defaultPresetBuild.error ? (
              <div className="canvas-context-menu-inline-error" data-context-menu-launch-error="true">
                {defaultPresetBuild.error}
              </div>
            ) : null}
            {(
              [
                {
                  preset: 'default',
                  action: 'launch-default',
                  icon: 'play'
                },
                {
                  preset: 'resume',
                  action: 'launch-resume',
                  icon: 'history'
                },
                {
                  preset: 'yolo',
                  action: 'launch-yolo',
                  icon: 'rocket'
                },
                {
                  preset: 'sandbox',
                  action: 'launch-sandbox',
                  icon: 'shield'
                }
              ] satisfies ReadonlyArray<{
                preset: Exclude<AgentLaunchPresetKind, 'custom'>;
                action: string;
                icon: string;
              }>
            ).map((item) => (
              <button
                key={item.preset}
                type="button"
                className="canvas-context-menu-item has-clamped-detail"
                data-context-menu-launch-preset={item.action}
                disabled={Boolean(defaultPresetBuild.error)}
                onClick={() => props.onCreate('agent', selectedAgentProvider, item.preset)}
              >
                <span
                  className={`canvas-context-menu-icon codicon codicon-${item.icon}`}
                  aria-hidden="true"
                />
                <span className="canvas-context-menu-copy">
                  <strong>{labelForAgentLaunchPreset(item.preset)}</strong>
                  <OverflowAwareText
                    className="canvas-context-menu-copy-detail"
                    text={describeAgentLaunchPreset(
                      selectedAgentProvider,
                      item.preset,
                      selectedLaunchDefaults
                    )}
                  />
                </span>
              </button>
            ))}
            <button
              type="button"
              className="canvas-context-menu-item has-clamped-detail"
              data-context-menu-launch-preset="launch-custom"
              disabled={Boolean(defaultPresetBuild.error)}
              onClick={() => setCustomEditorOpen(true)}
            >
              <span
                className="canvas-context-menu-icon codicon codicon-gear"
                aria-hidden="true"
              />
              <span className="canvas-context-menu-copy">
                <strong>{t('contextMenu.customLaunch.title')}</strong>
                <OverflowAwareText
                  className="canvas-context-menu-copy-detail"
                  text={t('contextMenu.customLaunch.description')}
                />
              </span>
            </button>
            {customEditorOpen ? (
              <div
                className={`canvas-context-menu-inline-editor${customValidation.valid ? '' : ' is-invalid'}`}
                data-context-menu-custom-editor="true"
                onMouseDown={stopCanvasEvent}
                onClick={stopCanvasEvent}
              >
                <input
                  type="text"
                  className="canvas-context-menu-inline-input"
                  data-context-menu-custom-input="true"
                  value={customCommandLine}
                  onChange={(event) => setCustomCommandLine(event.target.value)}
                  onCompositionStart={() => setCustomInputIsComposing(true)}
                  onCompositionEnd={(event) => {
                    setCustomInputIsComposing(false);
                    setCustomCommandLine(event.currentTarget.value);
                  }}
                  onKeyDown={(event) => {
                    stopCanvasEvent(event);

                    if (customInputIsComposing || isImeComposingKeyboardEvent(event)) {
                      return;
                    }

                    if (event.key === 'Escape') {
                      event.preventDefault();
                      setCustomEditorOpen(false);
                      return;
                    }
                    if (event.key !== 'Enter' || !customValidation.valid) {
                      return;
                    }
                    event.preventDefault();
                    createAgentWithCustomCommand();
                  }}
                  aria-label={t('contextMenu.customLaunch.aria', { provider: providerLabel(selectedAgentProvider) })}
                />
                <button
                  type="button"
                  className="canvas-context-menu-inline-confirm"
                  data-context-menu-custom-confirm="true"
                  disabled={!customValidation.valid}
                  onClick={createAgentWithCustomCommand}
                >
                  {t('action.confirm')}
                </button>
                {!customValidation.valid ? (
                  <span className="canvas-context-menu-inline-error">
                    {tAgentLaunchMessage(customValidation.errorDescriptor, customValidation.error)}
                  </span>
                ) : null}
              </div>
            ) : null}
          </>
        ) : isTemplatePickerView ? (
          props.templateEntries.length > 0 ? (
            <>
              {props.templateEntries.map((templateEntry) => (
                <button
                  key={`${props.view}/${templateEntry.templateId}`}
                  type="button"
                  className="canvas-context-menu-item has-clamped-detail"
                  data-context-menu-template-id={templateEntry.templateId}
                  data-context-menu-template-action={props.view}
                  onClick={() => props.onApplyTemplate(templateEntry.templateId, isResetTemplatePicker)}
                >
                  <span
                    className={`canvas-context-menu-icon codicon codicon-${
                      isResetTemplatePicker ? 'discard' : 'library'
                    }`}
                    aria-hidden="true"
                  />
                  <span className="canvas-context-menu-copy">
                    <strong>
                      {templateEntry.isDefault ? t('contextMenu.templateDefault', { name: templateEntry.name }) : templateEntry.name}
                    </strong>
                    <span className="canvas-context-menu-copy-detail">
                      {`${templateEntry.category === 'builtin' ? t('contextMenu.templateCategory.builtin') : t('contextMenu.templateCategory.user')} · ${templateEntry.statsLabel}`}
                    </span>
                  </span>
                </button>
              ))}
            </>
          ) : (
            <div className="canvas-context-menu-inline-error">{t('contextMenu.noTemplates')}</div>
          )
        ) : null}
      </div>
    </div>
  );
});

function SubtitleCopyButton(props: {
  label: string;
  copiedLabel: string;
  onCopy: () => void;
  onFocus?: () => void;
}): JSX.Element {
  const overviewInteractionsDisabled = useCanvasOverviewInteractionsDisabled();
  const [copied, setCopied] = useState(false);
  const copiedResetTimeoutRef = useRef<number | undefined>(undefined);
  const currentLabel = copied ? props.copiedLabel : props.label;

  useEffect(() => {
    return () => {
      if (copiedResetTimeoutRef.current !== undefined) {
        window.clearTimeout(copiedResetTimeoutRef.current);
      }
    };
  }, []);

  const handleCopy = (): void => {
    if (overviewInteractionsDisabled) {
      return;
    }

    props.onCopy();
    setCopied(true);
    if (copiedResetTimeoutRef.current !== undefined) {
      window.clearTimeout(copiedResetTimeoutRef.current);
    }
    copiedResetTimeoutRef.current = window.setTimeout(() => {
      copiedResetTimeoutRef.current = undefined;
      setCopied(false);
    }, 1200);
  };

  return (
    <button
      type="button"
      className="window-title-subtitle-copy nodrag nopan"
      data-node-interactive="true"
      title={currentLabel}
      aria-label={currentLabel}
      aria-hidden={overviewInteractionsDisabled ? true : undefined}
      disabled={overviewInteractionsDisabled}
      tabIndex={overviewInteractionsDisabled ? -1 : undefined}
      onFocus={props.onFocus}
      onMouseDown={stopCanvasEvent}
      onClick={(event) => {
        stopCanvasEvent(event);
        handleCopy();
      }}
      onKeyDown={stopCanvasEvent}
      onKeyUp={stopCanvasEvent}
    >
      <span
        className={`window-title-subtitle-copy-icon codicon codicon-${copied ? 'check' : 'copy'}`}
        aria-hidden="true"
      />
    </button>
  );
}

function NoteMarkdownMetadataTrigger(props: {
  frontMatter: Exclude<NoteMarkdownFrontMatter, { kind: 'none' }>;
  sourceLabel?: string;
  onCopyMetadata: (rawBlock: string) => void;
  onFocus?: () => void;
}): JSX.Element {
  const overviewInteractionsDisabled = useCanvasOverviewInteractionsDisabled();
  const viewport = useViewport();
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const popoverIdRef = useRef<string>('');
  const copiedResetTimeoutRef = useRef<number | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<FloatingTooltipPosition | null>(null);
  const [copied, setCopied] = useState(false);
  const isInvalid = props.frontMatter.kind === 'invalid';
  const title = isInvalid ? t('note.metadata.parseFailed') : t('note.metadata.title');
  const buttonLabel = isInvalid ? t('note.metadata.viewIssue') : t('note.metadata.view');
  const copyLabel = copied ? t('note.metadata.copied') : t('note.metadata.copy');

  if (!popoverIdRef.current) {
    popoverIdRef.current = `note-markdown-metadata-popover-${nextNoteMarkdownMetadataPopoverId++}`;
  }

  useEffect(() => {
    return () => {
      if (copiedResetTimeoutRef.current !== undefined) {
        window.clearTimeout(copiedResetTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!overviewInteractionsDisabled) {
      return;
    }

    setOpen(false);
  }, [overviewInteractionsDisabled]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof globalThis.Node)) {
        setOpen(false);
        return;
      }

      if (buttonRef.current?.contains(target) || popoverRef.current?.contains(target)) {
        return;
      }

      setOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') {
        return;
      }

      event.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    };

    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }

    const updatePosition = (): void => {
      const button = buttonRef.current;
      const popover = popoverRef.current;
      if (!button || !popover) {
        return;
      }

      const margin = 12;
      const gap = 6;
      const buttonRect = button.getBoundingClientRect();
      const popoverRect = popover.getBoundingClientRect();
      const maxLeft = Math.max(margin, window.innerWidth - margin - popoverRect.width);
      const maxTop = Math.max(margin, window.innerHeight - margin - popoverRect.height);
      let left = buttonRect.left;
      let top = buttonRect.bottom + gap;

      if (left + popoverRect.width > window.innerWidth - margin) {
        left = buttonRect.right - popoverRect.width;
      }
      if (top + popoverRect.height > window.innerHeight - margin) {
        top = buttonRect.top - popoverRect.height - gap;
      }

      setPosition({
        left: Math.min(Math.max(margin, left), maxLeft),
        top: Math.min(Math.max(margin, top), maxTop)
      });
    };

    const frame = window.requestAnimationFrame(updatePosition);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open, viewport.x, viewport.y, viewport.zoom]);

  const copyMetadata = (): void => {
    props.onCopyMetadata(props.frontMatter.rawBlock);
    setCopied(true);
    if (copiedResetTimeoutRef.current !== undefined) {
      window.clearTimeout(copiedResetTimeoutRef.current);
    }
    copiedResetTimeoutRef.current = window.setTimeout(() => {
      copiedResetTimeoutRef.current = undefined;
      setCopied(false);
    }, 1200);
  };

  const closeOnEscape = (event: React.KeyboardEvent): void => {
    stopCanvasEvent(event);
    if (event.key !== 'Escape') {
      return;
    }

    event.preventDefault();
    setOpen(false);
    buttonRef.current?.focus();
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`note-metadata-trigger ${open ? 'is-open' : ''} ${isInvalid ? 'is-warning' : ''}`.trim()}
        data-node-interactive="true"
        title={buttonLabel}
        aria-label={buttonLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popoverIdRef.current : undefined}
        aria-hidden={overviewInteractionsDisabled ? true : undefined}
        disabled={overviewInteractionsDisabled}
        tabIndex={overviewInteractionsDisabled ? -1 : undefined}
        onFocus={props.onFocus}
        onPointerDown={stopCanvasEvent}
        onMouseDown={stopCanvasEvent}
        onClick={(event) => {
          stopCanvasEvent(event);
          if (overviewInteractionsDisabled) {
            return;
          }
          props.onFocus?.();
          setOpen((current) => !current);
        }}
        onKeyDown={closeOnEscape}
      >
        <span
          className={`note-metadata-trigger-icon codicon codicon-${isInvalid ? 'warning' : 'json'}`}
          aria-hidden="true"
        />
      </button>
      {open
        ? createPortal(
            <div
              ref={popoverRef}
              id={popoverIdRef.current}
              role="dialog"
              aria-label={title}
              className={`note-metadata-popover nodrag nopan nowheel${position ? ' is-visible' : ''} ${
                isInvalid ? 'is-warning' : ''
              }`.trim()}
              data-node-interactive="true"
              style={
                {
                  '--note-metadata-popover-scale': String(viewport.zoom),
                  ...(position
                    ? {
                        left: position.left,
                        top: position.top
                      }
                    : {})
                } as CSSProperties
              }
              onPointerDown={stopCanvasEvent}
              onMouseDown={stopCanvasEvent}
              onClick={stopCanvasEvent}
              onKeyDown={closeOnEscape}
              onWheel={stopCanvasEvent}
            >
              <div className="note-metadata-popover-header">
                <strong>{title}</strong>
                {props.sourceLabel ? <span>{props.sourceLabel}</span> : null}
                <button
                  type="button"
                  className="note-metadata-popover-copy"
                  data-node-interactive="true"
                  title={copyLabel}
                  aria-label={copyLabel}
                  onPointerDown={stopCanvasEvent}
                  onMouseDown={stopCanvasEvent}
                  onClick={(event) => {
                    stopCanvasEvent(event);
                    copyMetadata();
                  }}
                >
                  <span
                    className={`note-metadata-popover-copy-icon codicon codicon-${copied ? 'check' : 'copy'}`}
                    aria-hidden="true"
                  />
                </button>
              </div>
              <div className="note-metadata-popover-body">
                {props.frontMatter.kind === 'valid' ? (
                  props.frontMatter.entries.length > 0 ? (
                    props.frontMatter.entries.map((entry) => (
                      <div key={entry.key} className="note-metadata-popover-row">
                        <span className="note-metadata-popover-key" title={entry.key}>
                          {entry.key}
                        </span>
                        <span className="note-metadata-popover-value" title={entry.title ?? entry.value}>
                          {entry.value}
                        </span>
                      </div>
                    ))
                  ) : (
                    <p className="note-metadata-popover-empty">{t('note.metadata.empty')}</p>
                  )
                ) : (
                  <p className="note-metadata-popover-error">{props.frontMatter.error}</p>
                )}
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
}

function toFlowNodes(params: {
  nodes: CanvasNodeSummary[];
  selectedNodeId: string | undefined;
  selectedNodeIds: readonly string[] | undefined;
  documentHasFocus: boolean;
  workspaceTrusted: boolean;
  overviewInteractionsDisabled: boolean;
  strongTerminalAttentionReminderMode: CanvasStrongTerminalAttentionReminderMode;
  fileNodeDisplayStyle: CanvasFileNodeDisplayStyle;
  fileNodeDisplayMode: CanvasFileNodeDisplayMode;
  filePathDisplayMode: CanvasFilePathDisplayMode;
  noteMarkdownImageWorkspaceRoots: readonly NoteMarkdownImageWorkspaceRoot[];
  workspaceFolders: CanvasRuntimeContext['workspaceFolders'];
  fileListViewModes: Record<string, FileListViewMode> | undefined;
  selectedFileListEntries: Record<string, string> | undefined;
  collapsedFileListTreeBranches: Record<string, string[]> | undefined;
  nodeResizeDrafts: Record<string, CanvasNodeResizeDraft>;
  onSelectNode: (nodeId: string) => void;
  onAcknowledgeNodeAttention: (nodeId: string) => void;
  onOpenCanvasFile: (nodeId: string, filePath: string) => void;
  onOpenNoteLink: (nodeId: string, href: string) => void;
  onSaveNoteAsMarkdownFile: (nodeId: string) => void;
  onOpenAssociatedNoteMarkdownFile: (nodeId: string) => void;
  onReloadAssociatedNoteMarkdownFile: (nodeId: string) => void;
  onCreateMissingAssociatedNoteMarkdownFile: (nodeId: string) => void;
  onCopyTextToClipboard: (text: string, source: WebviewClipboardTextSource, nodeId?: string) => void;
  onSelectFileListEntry: (nodeId: string, filePath: string) => void;
  onSetFileListViewMode: (nodeId: string, viewMode: FileListViewMode) => void;
  onToggleFileListTreeBranch: (nodeId: string, branchKey: string) => void;
  onUpdateNodeTitle: (nodeId: string, title: string) => void;
  onStartExecution: (
    nodeId: string,
    kind: ExecutionNodeKind,
    cols: number,
    rows: number,
    provider?: AgentProviderKind,
    resume?: boolean
  ) => void;
  onBranchAgentSession: (nodeId: string) => void;
  onAttachExecution: (nodeId: string, kind: ExecutionNodeKind) => void;
  onExecutionInput: (
    nodeId: string,
    kind: ExecutionNodeKind,
    data: string,
    metadata?: ExecutionInputDispatchMetadata
  ) => void;
  onShowTransientError: (message: string) => void;
  onDropExecutionResource: (
    nodeId: string,
    kind: ExecutionNodeKind,
    resource: ExecutionTerminalDroppedResource
  ) => void;
  onOpenExecutionLink: (
    nodeId: string,
    kind: ExecutionNodeKind,
    link: ExecutionTerminalOpenLink
  ) => void;
  onCopyExecutionSelection: (
    nodeId: string,
    kind: ExecutionNodeKind,
    text: string,
    clearSelectionAfterCopy: boolean
  ) => void;
  onRequestExecutionPaste: (
    nodeId: string,
    kind: ExecutionNodeKind,
    bracketedPasteMode: boolean
  ) => void;
  onPasteExecutionImage: (
    nodeId: string,
    kind: ExecutionNodeKind,
    image: ExecutionImagePasteData
  ) => void;
  onExecutionClipboardDiagnostic: (payload: ExecutionTerminalClipboardDiagnosticPayload) => void;
  onResizeExecution: (nodeId: string, kind: ExecutionNodeKind, cols: number, rows: number) => void;
  onStopExecution: (nodeId: string, kind: ExecutionNodeKind) => void;
  onUpdateNote: (payload: {
    nodeId: string;
    content: string;
    baseContentRevision?: string;
    force?: boolean;
  }) => void;
  onBeginAssociatedNoteMarkdownEdit: (payload: {
    nodeId: string;
    content: string;
    baseContentRevision?: string;
  }) => void;
  onEndAssociatedNoteMarkdownEdit: (nodeId: string) => void;
  onUpdateAssociatedNoteMarkdownDraft: (payload: {
    nodeId: string;
    content: string;
    baseContentRevision?: string;
  }) => void;
  onClearAssociatedNoteMarkdownDraft: (nodeId: string) => void;
  onCopyAssociatedNoteMarkdownDraft: (nodeId: string, content: string) => void;
  onDraftNodeLayout: (nodeId: string, draft: CanvasNodeLayoutDraft | null) => void;
  onResizeNodePointerMove: (
    event: Pick<PointerEvent | React.PointerEvent, 'clientX' | 'clientY'>,
    onPan?: (previousViewport: Viewport, nextViewport: Viewport) => void
  ) => void;
  onResizeNodeEnd: () => void;
  onResizeNode: (nodeId: string, position: CanvasNodePosition, size: CanvasNodeFootprint) => void;
  onFocusNodeInViewport: (nodeId: string) => void;
  onDeleteNode: (nodeId: string) => void;
  onModifierSelectNode: (nodeId: string) => void;
}): CanvasFlowNode[] {
  const selectedNodeIds = new Set(params.selectedNodeIds ?? (params.selectedNodeId ? [params.selectedNodeId] : []));
  return params.nodes.map((node) => {
    const size = normalizeCanvasNodeFootprintForDisplayStyle(
      node.kind,
      params.fileNodeDisplayStyle,
      node.size,
      node.metadata?.file,
      params.fileNodeDisplayMode,
      params.filePathDisplayMode
    );
    const resizeDraft = params.nodeResizeDrafts[node.id];
    const renderedSize = resizeDraft?.size ?? size;

    return {
      id: node.id,
      type: node.kind === 'agent' || node.kind === 'terminal' || node.kind === 'note' || node.kind === 'file' || node.kind === 'file-list' ? node.kind : 'card',
      position: node.position,
      draggable: true,
      selected: selectedNodeIds.has(node.id),
      width: renderedSize.width,
      height: renderedSize.height,
      style: {
        width: renderedSize.width,
        height: renderedSize.height
      },
      data: {
        kind: node.kind,
        title: node.title,
        status: node.status,
        summary: node.summary,
        selected: selectedNodeIds.has(node.id),
        documentHasFocus: params.documentHasFocus,
        workspaceTrusted: params.workspaceTrusted,
        overviewInteractionsDisabled: params.overviewInteractionsDisabled,
        strongTerminalAttentionReminderMode: params.strongTerminalAttentionReminderMode,
        size: renderedSize,
        fileNodeDisplayStyle: params.fileNodeDisplayStyle,
        fileNodeDisplayMode: params.fileNodeDisplayMode,
        filePathDisplayMode: params.filePathDisplayMode,
        noteMarkdownImageWorkspaceRoots: [...params.noteMarkdownImageWorkspaceRoots],
        workspaceFolders: [...params.workspaceFolders],
        fileListViewMode: params.fileListViewModes?.[node.id] === 'tree' ? 'tree' : 'list',
        selectedFileListEntryPath: params.selectedFileListEntries?.[node.id],
        collapsedFileListTreeBranchKeys: params.collapsedFileListTreeBranches?.[node.id],
        metadata: node.metadata,
        onSelectNode: params.onSelectNode,
        onAcknowledgeNodeAttention: params.onAcknowledgeNodeAttention,
        onOpenCanvasFile: params.onOpenCanvasFile,
        onOpenNoteLink: params.onOpenNoteLink,
        onSaveNoteAsMarkdownFile: params.onSaveNoteAsMarkdownFile,
        onOpenAssociatedNoteMarkdownFile: params.onOpenAssociatedNoteMarkdownFile,
        onReloadAssociatedNoteMarkdownFile: params.onReloadAssociatedNoteMarkdownFile,
        onCreateMissingAssociatedNoteMarkdownFile: params.onCreateMissingAssociatedNoteMarkdownFile,
        onCopyTextToClipboard: params.onCopyTextToClipboard,
        onSelectFileListEntry: params.onSelectFileListEntry,
        onSetFileListViewMode: params.onSetFileListViewMode,
        onToggleFileListTreeBranch: params.onToggleFileListTreeBranch,
        onUpdateNodeTitle: params.onUpdateNodeTitle,
        onStartExecution: params.onStartExecution,
        onBranchAgentSession: params.onBranchAgentSession,
        onAttachExecution: params.onAttachExecution,
        onExecutionInput: params.onExecutionInput,
        onShowTransientError: params.onShowTransientError,
        onDropExecutionResource: params.onDropExecutionResource,
        onOpenExecutionLink: params.onOpenExecutionLink,
        onCopyExecutionSelection: params.onCopyExecutionSelection,
        onRequestExecutionPaste: params.onRequestExecutionPaste,
        onPasteExecutionImage: params.onPasteExecutionImage,
        onExecutionClipboardDiagnostic: params.onExecutionClipboardDiagnostic,
        onResizeExecution: params.onResizeExecution,
        onStopExecution: params.onStopExecution,
        onUpdateNote: params.onUpdateNote,
        onBeginAssociatedNoteMarkdownEdit: params.onBeginAssociatedNoteMarkdownEdit,
        onEndAssociatedNoteMarkdownEdit: params.onEndAssociatedNoteMarkdownEdit,
        onUpdateAssociatedNoteMarkdownDraft: params.onUpdateAssociatedNoteMarkdownDraft,
        onClearAssociatedNoteMarkdownDraft: params.onClearAssociatedNoteMarkdownDraft,
        onCopyAssociatedNoteMarkdownDraft: params.onCopyAssociatedNoteMarkdownDraft,
        onDraftNodeLayout: params.onDraftNodeLayout,
        onResizeNodePointerMove: params.onResizeNodePointerMove,
        onResizeNodeEnd: params.onResizeNodeEnd,
        onResizeNode: params.onResizeNode,
        onFocusNodeInViewport: params.onFocusNodeInViewport,
        onDeleteNode: params.onDeleteNode,
        onModifierSelectNode: params.onModifierSelectNode
      }
    };
  });
}

function toFlowEdges(params: {
  edges: CanvasEdgeSummary[];
  selectedEdgeId: string | undefined;
  edgeLabelEditor: EdgeLabelEditorState | null;
  edgeArrowMenuEdgeId: string | undefined;
  edgeColorMenuEdgeId: string | undefined;
  onSelectEdge: (edgeId: string) => void;
  onStartLabelEdit: (edgeId: string) => void;
  onSubmitLabelEdit: (edgeId: string, value: string) => void;
  onCancelLabelEdit: (edgeId: string) => void;
  onToggleArrowMenu: (edgeId: string) => void;
  onSetArrowMode: (edgeId: string, arrowMode: CanvasEdgeArrowMode) => void;
  onToggleColorMenu: (edgeId: string) => void;
  onSetColor: (edgeId: string, color: CanvasEdgeColor | null) => void;
  onDeleteEdge: (edgeId: string) => void;
}): CanvasFlowEdge[] {
  return params.edges.map((edge) => {
    const isSelected = edge.id === params.selectedEdgeId;
    const strokeColor = resolveCanvasEdgeStrokeColor(edge.color);
    const isLabelEditing = params.edgeLabelEditor?.edgeId === edge.id;
    const isArrowMenuOpen = params.edgeArrowMenuEdgeId === edge.id;
    const isColorMenuOpen = params.edgeColorMenuEdgeId === edge.id;

    return {
      id: edge.id,
      type: 'canvas',
      source: edge.sourceNodeId,
      target: edge.targetNodeId,
      sourceHandle: edge.sourceAnchor,
      targetHandle: edge.targetAnchor,
      label: edge.label,
      selectable: true,
      focusable: true,
      selected: isSelected,
      reconnectable: isSelected,
      zIndex: 6,
      data: {
        owner: edge.owner,
        arrowMode: edge.arrowMode,
        color: edge.color,
        strokeColor,
        isLabelEditing,
        isArrowMenuOpen,
        isColorMenuOpen,
        onSelectEdge: () => params.onSelectEdge(edge.id),
        onStartLabelEdit: () => params.onStartLabelEdit(edge.id),
        onSubmitLabelEdit: (value) => params.onSubmitLabelEdit(edge.id, value),
        onCancelLabelEdit: () => params.onCancelLabelEdit(edge.id),
        onToggleArrowMenu: () => params.onToggleArrowMenu(edge.id),
        onSetArrowMode: (arrowMode) => params.onSetArrowMode(edge.id, arrowMode),
        onToggleColorMenu: () => params.onToggleColorMenu(edge.id),
        onSetColor: (color) => params.onSetColor(edge.id, color),
        onDeleteEdge: () => params.onDeleteEdge(edge.id)
      },
      style: {
        stroke: strokeColor,
        strokeWidth: 1.8
      },
      markerStart:
        edge.arrowMode === 'both'
          ? {
              type: MarkerType.ArrowClosed,
              width: 16,
              height: 16,
              color: strokeColor
            }
          : undefined,
      markerEnd:
        edge.arrowMode === 'forward' || edge.arrowMode === 'both'
          ? {
              type: MarkerType.ArrowClosed,
              width: 16,
              height: 16,
              color: strokeColor
            }
          : undefined
    };
  });
}

function applyCanvasNodeLayoutDrafts(
  nodes: CanvasFlowNode[],
  drafts: Record<string, CanvasNodeLayoutDraft>
): CanvasFlowNode[] {
  return nodes.map((node) => {
    const draft = drafts[node.id];
    if (!draft) {
      return node;
    }

    const nextSize = draft.size ?? node.data.size;

    return {
      ...node,
      position: draft.position ?? node.position,
      width: nextSize.width,
      height: nextSize.height,
      style: {
        ...node.style,
        width: nextSize.width,
        height: nextSize.height
      },
      data: {
        ...node.data,
        size: nextSize
      }
    };
  });
}

function applyCanvasGroupDrafts(params: {
  groups: CanvasGroupSummary[];
  hostNodes: CanvasNodeSummary[];
  flowNodes: CanvasFlowNode[];
  drafts: Record<string, CanvasGroupDraft>;
}): { groups: CanvasGroupSummary[]; nodes: CanvasFlowNode[] } {
  const groupsById = new Map(params.groups.map((group) => [group.id, group] as const));
  const movingDrafts = Object.entries(params.drafts).flatMap(([groupId, draft]) => {
    const group = groupsById.get(groupId);
    if (
      !group?.id ||
      !draft.position ||
      draft.size ||
      (draft.position.x === group.position.x && draft.position.y === group.position.y)
    ) {
      return [];
    }

    return [
      {
        groupId,
        subtreeGroupIds: collectGroupSubtreeIdsForWebview(params.groups, groupId),
        delta: {
          x: draft.position.x - group.position.x,
          y: draft.position.y - group.position.y
        }
      }
    ];
  });

  const groups = params.groups.map((group) => {
    const translatedPosition = movingDrafts.reduce(
      (position, movingDraft) =>
        movingDraft.subtreeGroupIds.has(group.id)
          ? {
              x: position.x + movingDraft.delta.x,
              y: position.y + movingDraft.delta.y
            }
          : position,
      group.position
    );
    const draft = params.drafts[group.id];
    const nextPosition = draft?.position ?? translatedPosition;
    return {
      ...group,
      position: {
        x: Math.round(nextPosition.x),
        y: Math.round(nextPosition.y)
      },
      size: draft?.size ?? group.size
    };
  });

  const hostNodesById = new Map(params.hostNodes.map((node) => [node.id, node] as const));
  const nodes = params.flowNodes.map((node) => {
    const hostNode = hostNodesById.get(node.id);
    if (!hostNode?.groupId) {
      return node;
    }

    const delta = movingDrafts.reduce(
      (currentDelta, movingDraft) =>
        movingDraft.subtreeGroupIds.has(hostNode.groupId ?? '')
          ? {
              x: currentDelta.x + movingDraft.delta.x,
              y: currentDelta.y + movingDraft.delta.y
            }
          : currentDelta,
      { x: 0, y: 0 }
    );
    if (delta.x === 0 && delta.y === 0) {
      return node;
    }

    return {
      ...node,
      position: {
        x: Math.round(node.position.x + delta.x),
        y: Math.round(node.position.y + delta.y)
      }
    };
  });

  return { groups, nodes };
}

function shallowEqualCanvasGroupDrafts(
  left: Record<string, CanvasGroupDraft>,
  right: Record<string, CanvasGroupDraft>
): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }

  return leftKeys.every((key) => {
    const leftDraft = left[key];
    const rightDraft = right[key];
    if (!rightDraft) {
      return false;
    }

    return (
      positionsEqual(leftDraft.position, rightDraft.position) &&
      footprintsEqual(leftDraft.size, rightDraft.size)
    );
  });
}

function pruneCanvasNodeLayoutDrafts(
  nodes: CanvasFlowNode[],
  drafts: Record<string, CanvasNodeLayoutDraft>
): Record<string, CanvasNodeLayoutDraft> {
  const nextDrafts = collectCanvasNodeLayoutDrafts(nodes, applyCanvasNodeLayoutDrafts(nodes, drafts));
  return shallowEqualCanvasNodeLayoutDrafts(drafts, nextDrafts) ? drafts : nextDrafts;
}

function extendCanvasNodeLayoutDraftsForSelectedDrag(
  baseNodes: CanvasFlowNode[],
  nextNodes: CanvasFlowNode[],
  drafts: Record<string, CanvasNodeLayoutDraft>
): Record<string, CanvasNodeLayoutDraft> {
  const draggedDraftEntries = Object.entries(drafts).filter(([, draft]) => draft.position);
  if (draggedDraftEntries.length !== 1) {
    return drafts;
  }

  const [draggedNodeId, draggedDraft] = draggedDraftEntries[0];
  const draggedBaseNode = baseNodes.find((node) => node.id === draggedNodeId);
  if (!draggedBaseNode || !draggedDraft.position) {
    return drafts;
  }

  const delta = {
    x: draggedDraft.position.x - draggedBaseNode.position.x,
    y: draggedDraft.position.y - draggedBaseNode.position.y
  };
  if (delta.x === 0 && delta.y === 0) {
    return drafts;
  }

  const nextNodeIds = new Set(nextNodes.map((node) => node.id));
  const nextDrafts = { ...drafts };
  for (const node of baseNodes) {
    if (node.id === draggedNodeId || !node.selected || !nextNodeIds.has(node.id)) {
      continue;
    }

    nextDrafts[node.id] = {
      ...nextDrafts[node.id],
      position: {
        x: Math.round(node.position.x + delta.x),
        y: Math.round(node.position.y + delta.y)
      }
    };
  }

  return nextDrafts;
}

function collectCanvasNodeLayoutDrafts(
  baseNodes: CanvasFlowNode[],
  nextNodes: CanvasFlowNode[]
): Record<string, CanvasNodeLayoutDraft> {
  const baseNodesById = new Map(baseNodes.map((node) => [node.id, node]));
  const drafts: Record<string, CanvasNodeLayoutDraft> = {};

  for (const node of nextNodes) {
    const baseNode = baseNodesById.get(node.id);
    if (!baseNode) {
      continue;
    }

    const draft: CanvasNodeLayoutDraft = {};
    if (!positionsEqual(node.position, baseNode.position)) {
      draft.position = {
        x: Math.round(node.position.x),
        y: Math.round(node.position.y)
      };
    }

    const normalizedNextSize = normalizeCanvasNodeFootprintForDisplayStyle(
      node.data.kind,
      node.data.fileNodeDisplayStyle,
      {
        width: Number(node.style?.width ?? node.data.size.width),
        height: Number(node.style?.height ?? node.data.size.height)
      },
      node.data.metadata?.file,
      node.data.fileNodeDisplayMode,
      node.data.filePathDisplayMode
    );

    if (!footprintsEqual(normalizedNextSize, baseNode.data.size)) {
      draft.size = normalizedNextSize;
    }

    if (draft.position || draft.size) {
      drafts[node.id] = draft;
    }
  }

  return drafts;
}

function shallowEqualCanvasNodeLayoutDrafts(
  left: Record<string, CanvasNodeLayoutDraft>,
  right: Record<string, CanvasNodeLayoutDraft>
): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }

  return leftKeys.every((key) => {
    const leftDraft = left[key];
    const rightDraft = right[key];
    if (!rightDraft) {
      return false;
    }

    return (
      positionsEqual(leftDraft.position, rightDraft.position) &&
      footprintsEqual(leftDraft.size, rightDraft.size)
    );
  });
}

function resolveCreateNodePreferredPosition(
  kind: CanvasCreatableNodeKind,
  reactFlowInstance: ReactFlowInstance<CanvasNodeData> | null
): CanvasNodePosition | undefined {
  if (!reactFlowInstance || !reactFlowInstance.viewportInitialized) {
    return undefined;
  }

  const viewportCenter = reactFlowInstance.screenToFlowPosition({
    x: Math.round(window.innerWidth * 0.5),
    y: Math.round(window.innerHeight * 0.55)
  });

  return resolveCreateNodePreferredPositionFromFlowAnchor(kind, viewportCenter);
}

function resolveCreateNodePreferredPositionFromFlowAnchor(
  kind: CanvasCreatableNodeKind,
  flowAnchor: CanvasNodePosition
): CanvasNodePosition {
  const footprint = estimatedCanvasNodeFootprint(kind);

  return {
    x: Math.round(flowAnchor.x - footprint.width / 2),
    y: Math.round(flowAnchor.y - footprint.height / 2)
  };
}

function parseHandleAnchor(handleId: string | null | undefined): CanvasEdgeSummary['sourceAnchor'] | undefined {
  return handleId === 'top' || handleId === 'right' || handleId === 'bottom' || handleId === 'left'
    ? handleId
    : undefined;
}

function displayFilePath(
  value: Pick<FileListNodeEntrySummary, 'filePath' | 'relativePath'>,
  mode: CanvasFilePathDisplayMode
): string {
  return mode === 'relative-path' ? value.relativePath ?? value.filePath : basename(value.filePath);
}

function basename(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const segments = normalized.split('/');
  return segments[segments.length - 1] || filePath;
}

function renderFileIcon(icon: CanvasFileIconDescriptor | undefined, fallbackLabel: string): JSX.Element {
  if (!icon || icon.kind === 'codicon') {
    const codiconId = icon?.kind === 'codicon' ? icon.id : 'file';
    return <span className={`codicon codicon-${codiconId}`} title={fallbackLabel} />;
  }

  if (icon.kind === 'image') {
    return <img className="file-icon-image" src={icon.src} alt="" />;
  }

  return (
    <span
      className="file-icon-font"
      style={{
        fontFamily: icon.fontFamily,
        color: icon.color
      }}
      title={fallbackLabel}
    >
      {icon.character}
    </span>
  );
}

function colorForKind(kind: CanvasNodeKind): string {
  return colorForCanvasNodeKind(kind);
}

function webviewHumanizeCanvasNodeStatus(
  node: Pick<CanvasNodeData, 'kind' | 'status' | 'metadata'>
): string {
  return webviewFormatCanvasStatusLabel(canvasNodeStatusLabelDescriptor(node));
}

function webviewHumanizeCanvasStatus(status: string): string {
  return webviewFormatCanvasStatusLabel(canvasStatusLabelDescriptor(status));
}

function webviewFormatCanvasStatusLabel(label: ReturnType<typeof canvasStatusLabelDescriptor>): string {
  return label.kind === 'localized' ? t(label.id) : label.value;
}

function humanizeNodeKind(kind: CanvasNodeKind): string {
  switch (kind) {
    case 'agent':
      return t('nodeKind.agent');
    case 'terminal':
      return t('nodeKind.terminal');
    case 'note':
      return t('nodeKind.note');
    case 'file':
      return t('nodeKind.file');
    case 'file-list':
      return t('nodeKind.fileList');
  }
}

function describeContextMenuKind(kind: CanvasNodeKind): string {
  switch (kind) {
    case 'agent':
      return t('contextMenu.kind.agent.description');
    case 'terminal':
      return t('contextMenu.kind.terminal.description');
    case 'note':
      return t('contextMenu.kind.note.description');
    case 'file':
      return t('contextMenu.kind.file.description');
    case 'file-list':
      return t('contextMenu.kind.fileList.description');
  }
}

function describeAgentProviderContextMenu(provider: AgentProviderKind): string {
  return t('contextMenu.provider.description', { provider: providerLabel(provider) });
}

function labelForAgentLaunchPreset(preset: AgentLaunchPresetKind): string {
  switch (preset) {
    case 'resume':
      return t('agentLaunchPreset.resume.label');
    case 'yolo':
      return t('agentLaunchPreset.yolo.label');
    case 'sandbox':
      return t('agentLaunchPreset.sandbox.label');
    case 'custom':
      return t('agentLaunchPreset.custom.label');
    case 'default':
    default:
      return t('agentLaunchPreset.default.label');
  }
}

function describeAgentLaunchPreset(
  provider: AgentProviderKind,
  preset: Exclude<AgentLaunchPresetKind, 'custom'>,
  defaults: AgentProviderLaunchDefaults
): string {
  const commandLine = tryBuildAgentPresetCommandLine(provider, defaults, preset);
  if (!commandLine.commandLine) {
    return commandLine.error ?? t('agentLaunchPreset.parseError');
  }
  switch (preset) {
    case 'resume':
      return t('agentLaunchPreset.resume.description', { commandLine: commandLine.commandLine });
    case 'yolo':
      return t('agentLaunchPreset.yolo.description', { commandLine: commandLine.commandLine });
    case 'sandbox':
      return t('agentLaunchPreset.sandbox.description', { commandLine: commandLine.commandLine });
    case 'default':
    default:
      return t('agentLaunchPreset.default.description', { commandLine: commandLine.commandLine });
  }
}

function providerLabel(provider: AgentProviderKind): string {
  return provider === 'claude' ? 'Claude Code' : 'Codex';
}

function orderedAgentProviders(defaultProvider: AgentProviderKind): AgentProviderKind[] {
  const secondaryProvider: AgentProviderKind = defaultProvider === 'codex' ? 'claude' : 'codex';
  return [defaultProvider, secondaryProvider];
}

function tryBuildAgentPresetCommandLine(
  provider: AgentProviderKind,
  defaults: AgentProviderLaunchDefaults,
  preset: Exclude<AgentLaunchPresetKind, 'custom'>
): {
  commandLine?: string;
  error?: string;
} {
  try {
    return {
      commandLine: buildAgentPresetCommandLine(provider, defaults, preset)
    };
  } catch (error) {
    return {
      error: tAgentLaunchMessage(
        getAgentLaunchErrorDescriptorForWebview(error),
        error instanceof Error ? error.message : t('agentLaunchPreset.agentCommandParseError')
      )
    };
  }
}

function getAgentLaunchErrorDescriptorForWebview(error: unknown): AgentLaunchMessageDescriptor | undefined {
  return getAgentLaunchErrorDescriptor(error);
}

function fallbackAgentCommandLine(
  provider: AgentProviderKind,
  defaults: AgentProviderLaunchDefaults
): string {
  return formatCommandLine([defaults.command.trim() || provider]);
}

function humanizeFileAccessMode(accessMode: FileListNodeEntrySummary['accessMode']): string {
  switch (accessMode) {
    case 'read':
      return t('fileList.access.read');
    case 'write':
      return t('fileList.access.write');
    case 'read-write':
      return t('fileList.access.readWrite');
  }
}

function resolveMinimalFileNodeFootprint(
  metadata: CanvasNodeMetadata['file'] | undefined,
  displayMode: CanvasFileNodeDisplayMode,
  pathDisplayMode: CanvasFilePathDisplayMode
): CanvasNodeFootprint {
  const primaryLabel = metadata ? displayFilePath(metadata, pathDisplayMode) : '';
  const textWidth = measureMinimalFileNodeLabelWidth(primaryLabel);

  switch (displayMode) {
    case 'icon-only':
      return {
        width: 28,
        height: 24
      };
    case 'path-only':
      return {
        width: Math.max(32, Math.ceil(textWidth + 14)),
        height: 22
      };
    default:
      return {
        width: Math.max(64, Math.min(480, Math.ceil(textWidth + 33))),
        height: 24
      };
  }
}

function measureMinimalFileNodeLabelWidth(text: string): number {
  if (!text) {
    return 0;
  }

  const context = getMinimalFileNodeMeasureContext();
  if (!context || typeof document === 'undefined') {
    let widthUnits = 0;
    for (const character of text) {
      if (character === ' ') {
        widthUnits += 0.34;
      } else if ('il.,:;|!'.includes(character)) {
        widthUnits += 0.32;
      } else if ('[](){}\'`'.includes(character)) {
        widthUnits += 0.38;
      } else if ('-_/\\'.includes(character)) {
        widthUnits += 0.46;
      } else if (character >= '0' && character <= '9') {
        widthUnits += 0.58;
      } else if (character >= 'A' && character <= 'Z') {
        widthUnits += 0.68;
      } else if ('mwMW@#%&'.includes(character)) {
        widthUnits += 0.82;
      } else if (character.charCodeAt(0) > 0x7f) {
        widthUnits += 0.96;
      } else {
        widthUnits += 0.6;
      }
    }
    return widthUnits * 12;
  }

  const bodyStyles = getComputedStyle(document.body);
  const fontFamily = bodyStyles.getPropertyValue('--vscode-font-family').trim() || bodyStyles.fontFamily || 'sans-serif';
  context.font = `600 12px ${fontFamily}`;
  return context.measureText(text).width;
}

let minimalFileNodeMeasureContext: CanvasRenderingContext2D | null | undefined;

function getMinimalFileNodeMeasureContext(): CanvasRenderingContext2D | null {
  if (minimalFileNodeMeasureContext !== undefined) {
    return minimalFileNodeMeasureContext;
  }

  if (typeof document === 'undefined') {
    minimalFileNodeMeasureContext = null;
    return minimalFileNodeMeasureContext;
  }

  const canvas = document.createElement('canvas');
  minimalFileNodeMeasureContext = canvas.getContext('2d');
  return minimalFileNodeMeasureContext;
}

function minimumCanvasNodeFootprintForDisplayStyle(data: Pick<
  CanvasNodeData,
  'kind' | 'fileNodeDisplayStyle' | 'fileNodeDisplayMode' | 'filePathDisplayMode' | 'metadata'
>): CanvasNodeFootprint {
  if (data.kind === 'file' && data.fileNodeDisplayStyle === 'minimal') {
    return resolveMinimalFileNodeFootprint(data.metadata?.file, data.fileNodeDisplayMode, data.filePathDisplayMode);
  }

  return minimumCanvasNodeFootprint(data.kind);
}

function normalizeCanvasNodeFootprintForDisplayStyle(
  kind: CanvasNodeKind,
  fileNodeDisplayStyle: CanvasFileNodeDisplayStyle,
  size: CanvasNodeFootprint,
  fileMetadata?: CanvasNodeMetadata['file'],
  fileNodeDisplayMode: CanvasFileNodeDisplayMode = 'icon-path',
  filePathDisplayMode: CanvasFilePathDisplayMode = 'basename'
): CanvasNodeFootprint {
  if (kind === 'file' && fileNodeDisplayStyle === 'minimal') {
    const minimum = resolveMinimalFileNodeFootprint(fileMetadata, fileNodeDisplayMode, filePathDisplayMode);
    return {
      width: Math.max(minimum.width, Math.round(size.width)),
      height: Math.max(minimum.height, Math.round(size.height))
    };
  }

  return normalizeCanvasNodeFootprint(kind, size);
}

function resolveContextMenuScreenPosition(screenX: number, screenY: number): { x: number; y: number } {
  const maxX = Math.max(12, window.innerWidth - 236);
  const maxY = Math.max(12, window.innerHeight - 230);

  return {
    x: Math.min(Math.max(12, screenX), maxX),
    y: Math.min(Math.max(12, screenY), maxY)
  };
}

function routeExecutionTerminalSnapshot(detail: Extract<ExecutionHostEvent, { type: 'snapshot' }>): void {
  executionTerminalRegistry.get(detail.nodeId)?.controller.applySnapshot(detail);
}

function queueExecutionTerminalOutput(detail: Extract<ExecutionHostEvent, { type: 'output' }>): void {
  const startedAt = readPerformanceNow();
  const controller = executionTerminalRegistry.get(detail.nodeId)?.controller;
  try {
    controller?.enqueueOutput(detail.chunk, {
      persisted: detail.persisted,
      outputSequence: detail.outputSequence,
      executionSessionId: detail.executionSessionId
    });
    maybeResetExecutionTerminalBacklogFromSnapshot(controller, detail);
    reportExecutionPerformanceDiagnostic(
      {
        source: 'webview-output-enqueue',
        nodeId: detail.nodeId,
        kind: detail.kind,
        durationMs: readPerformanceNow() - startedAt,
        characters: detail.chunk.length,
        pendingOutputLength: controller?.getPendingOutputLength() ?? 0,
        success: controller !== undefined
      },
      {
        minDurationMs: EXECUTION_PERFORMANCE_DIAGNOSTIC_DRAIN_MIN_DURATION_MS,
        minCharacters: EXECUTION_PERFORMANCE_DIAGNOSTIC_MIN_CHARACTERS
      }
    );
  } catch (error) {
    reportExecutionPerformanceDiagnostic(
      {
        source: 'webview-output-enqueue',
        nodeId: detail.nodeId,
        kind: detail.kind,
        durationMs: readPerformanceNow() - startedAt,
        characters: detail.chunk.length,
        pendingOutputLength: controller?.getPendingOutputLength() ?? 0,
        success: false,
        reason: error instanceof Error ? error.message : String(error)
      },
      {
        force: true
      }
    );
    throw error;
  }
}

function maybeResetExecutionTerminalBacklogFromSnapshot(
  controller: ExecutionTerminalController | undefined,
  detail: Extract<ExecutionHostEvent, { type: 'output' }>
): void {
  if (!controller || detail.persisted === false || detail.outputSequence === undefined) {
    return;
  }

  const now = readPerformanceNow();
  const pendingOutputLength = controller.getPendingOutputLength();
  if (pendingOutputLength >= EXECUTION_TERMINAL_HARD_SNAPSHOT_RESET_BACKLOG_THRESHOLD) {
    controller.resetBacklogForSnapshot('hard-backlog-snapshot-reset');
    return;
  }

  const recentLagOrRestore =
    now - lastExecutionMainThreadLagAtMs < EXECUTION_TERMINAL_SNAPSHOT_RESET_AFTER_LAG_MS ||
    now - lastExecutionVisibilityRestoredAtMs < EXECUTION_TERMINAL_VISIBILITY_RESTORE_RECOVERY_MS ||
    document.hidden;
  if (!recentLagOrRestore) {
    return;
  }

  const resetThreshold = document.hidden
    ? EXECUTION_TERMINAL_HIDDEN_SNAPSHOT_RESET_BACKLOG_THRESHOLD
    : EXECUTION_TERMINAL_SNAPSHOT_RESET_BACKLOG_THRESHOLD;
  if (pendingOutputLength < resetThreshold) {
    return;
  }

  controller.resetBacklogForSnapshot(
    document.hidden
      ? 'hidden-backlog-snapshot-reset'
      : now - lastExecutionMainThreadLagAtMs < EXECUTION_TERMINAL_SNAPSHOT_RESET_AFTER_LAG_MS
        ? 'lag-backlog-snapshot-reset'
        : 'visibility-backlog-snapshot-reset'
  );
}

function routeExecutionTerminalExit(detail: Extract<ExecutionHostEvent, { type: 'exit' }>): void {
  executionTerminalRegistry.get(detail.nodeId)?.controller.showExit(detail.message);
}

function scheduleExecutionTerminalSnapshotWrite(entry: PendingExecutionTerminalSnapshotWrite): void {
  pendingExecutionTerminalSnapshotWrites.push(entry);
  const now = readPerformanceNow();
  const recentInput = now - lastExecutionInputAtMs < EXECUTION_TERMINAL_INPUT_OUTPUT_YIELD_MS;
  reportExecutionPerformanceDiagnostic(
    {
      source: 'webview-snapshot-restore-queue',
      nodeId: entry.nodeId,
      kind: entry.kind,
      reason: 'queued',
      queuedSnapshotCount: pendingExecutionTerminalSnapshotWrites.length,
      success: true
    },
    {
      force: true
    }
  );
  scheduleExecutionTerminalSnapshotWritePump(
    recentInput ? EXECUTION_TERMINAL_INPUT_SNAPSHOT_RESTORE_STAGGER_MS : EXECUTION_TERMINAL_SNAPSHOT_RESTORE_STAGGER_MS
  );
}

function scheduleExecutionTerminalSnapshotWritePump(delayMs = 0): void {
  if (
    executionTerminalSnapshotWriteInFlight ||
    executionTerminalSnapshotWriteFrame !== undefined ||
    executionTerminalSnapshotWriteTimer !== undefined
  ) {
    return;
  }

  const useTimer = delayMs > 0 || document.hidden;
  if (useTimer) {
    executionTerminalSnapshotWriteTimer = window.setTimeout(() => {
      executionTerminalSnapshotWriteTimer = undefined;
      drainExecutionTerminalSnapshotWrites();
    }, document.hidden ? Math.max(delayMs, 250) : delayMs);
    return;
  }

  executionTerminalSnapshotWriteFrame = window.requestAnimationFrame(() => {
    executionTerminalSnapshotWriteFrame = undefined;
    drainExecutionTerminalSnapshotWrites();
  });
}

function drainExecutionTerminalSnapshotWrites(): void {
  if (executionTerminalSnapshotWriteInFlight) {
    return;
  }

  if (document.hidden) {
    if (pendingExecutionTerminalSnapshotWrites.length > 0) {
      scheduleExecutionTerminalSnapshotWritePump(250);
    }
    return;
  }

  if (pendingExecutionTerminalSnapshotWrites.length === 0) {
    return;
  }

  const now = readPerformanceNow();
  const inputAgeMs = now - lastExecutionInputAtMs;
  const oldestSnapshotQueuedAgeMs = pendingExecutionTerminalSnapshotWrites.reduce(
    (oldestAgeMs, entry) => Math.max(oldestAgeMs, now - entry.queuedAtMs),
    0
  );
  if (
    inputAgeMs >= 0 &&
    inputAgeMs < EXECUTION_TERMINAL_INPUT_SNAPSHOT_RESTORE_STAGGER_MS &&
    oldestSnapshotQueuedAgeMs < EXECUTION_TERMINAL_INPUT_SNAPSHOT_RESTORE_MAX_DEFER_MS
  ) {
    scheduleExecutionTerminalSnapshotWritePump(EXECUTION_TERMINAL_INPUT_SNAPSHOT_RESTORE_STAGGER_MS - inputAgeMs);
    return;
  }

  const nextWrite = takeNextExecutionTerminalSnapshotWrite();
  if (!nextWrite) {
    return;
  }

  executionTerminalSnapshotWriteInFlight = true;
  activeExecutionTerminalSnapshotWrite = nextWrite;
  lastExecutionTerminalSnapshotWriteAtMs = readPerformanceNow();
  reportExecutionPerformanceDiagnostic(
    {
      source: 'webview-snapshot-restore-queue',
      nodeId: nextWrite.nodeId,
      kind: nextWrite.kind,
      reason: 'started',
      durationMs: Math.max(0, lastExecutionTerminalSnapshotWriteAtMs - nextWrite.queuedAtMs),
      queuedSnapshotCount: pendingExecutionTerminalSnapshotWrites.length,
      success: true
    },
    {
      force: true
    }
  );
  let completed = false;
  const completeSnapshotWrite = (): void => {
    if (completed) {
      return;
    }
    completed = true;
    executionTerminalSnapshotWriteInFlight = false;
    if (activeExecutionTerminalSnapshotWrite === nextWrite) {
      activeExecutionTerminalSnapshotWrite = undefined;
    }
    nextWrite.finishQueue = undefined;
    if (pendingExecutionTerminalSnapshotWrites.length > 0) {
      const now = readPerformanceNow();
      const recentInput = now - lastExecutionInputAtMs < EXECUTION_TERMINAL_INPUT_OUTPUT_YIELD_MS;
      const spacingMs = recentInput
        ? EXECUTION_TERMINAL_INPUT_SNAPSHOT_RESTORE_STAGGER_MS
        : EXECUTION_TERMINAL_SNAPSHOT_RESTORE_STAGGER_MS;
      const elapsedSinceLastWriteMs = Math.max(0, now - lastExecutionTerminalSnapshotWriteAtMs);
      scheduleExecutionTerminalSnapshotWritePump(Math.max(0, spacingMs - elapsedSinceLastWriteMs));
    }
  };
  nextWrite.finishQueue = completeSnapshotWrite;
  nextWrite.run(completeSnapshotWrite);
}

function takeNextExecutionTerminalSnapshotWrite(): PendingExecutionTerminalSnapshotWrite | undefined {
  if (pendingExecutionTerminalSnapshotWrites.length === 0) {
    return undefined;
  }

  const inputNodeIndex =
    lastExecutionInputNodeId === undefined
      ? -1
      : pendingExecutionTerminalSnapshotWrites.findIndex((entry) => entry.nodeId === lastExecutionInputNodeId);
  const index = inputNodeIndex >= 0 ? inputNodeIndex : 0;
  const [entry] = pendingExecutionTerminalSnapshotWrites.splice(index, 1);
  return entry;
}

function scheduleExecutionTerminalDrain(controller: ExecutionTerminalController): void {
  pendingExecutionTerminalDrains.add(controller);
  scheduleExecutionTerminalDrainPump();
}

function scheduleExecutionTerminalDrainPump(delayMs = 0): void {
  if (executionTerminalDrainFrame !== undefined || executionTerminalDrainTimer !== undefined) {
    return;
  }

  const useTimer = delayMs > 0 || document.hidden;
  if (useTimer) {
    executionTerminalDrainTimer = window.setTimeout(() => {
      executionTerminalDrainTimer = undefined;
      drainExecutionTerminalOutput();
    }, document.hidden ? Math.max(delayMs, 250) : delayMs);
    return;
  }

  executionTerminalDrainFrame = window.requestAnimationFrame(() => {
    executionTerminalDrainFrame = undefined;
    drainExecutionTerminalOutput();
  });
}

function drainExecutionTerminalOutput(): void {
  if (document.hidden) {
    reportExecutionPerformanceDiagnostic(
      {
        source: 'webview-terminal-drain',
        durationMs: 0,
        controllerCount: pendingExecutionTerminalDrains.size,
        pendingControllerCount: pendingExecutionTerminalDrains.size,
        pendingOutputLength: getTotalPendingExecutionTerminalOutputLength(),
        reason: 'hidden-paused'
      },
      {
        minCharacters: EXECUTION_PERFORMANCE_DIAGNOSTIC_MIN_CHARACTERS
      }
    );
    return;
  }

  const startedAt = readPerformanceNow();
  const controllers = Array.from(pendingExecutionTerminalDrains);
  pendingExecutionTerminalDrains.clear();
  if (controllers.length === 0) {
    return;
  }

  const now = readPerformanceNow();
  const shouldThrottleForInput = now - lastExecutionInputAtMs < EXECUTION_TERMINAL_INPUT_OUTPUT_YIELD_MS;
  const shouldThrottleForLagRecovery =
    !shouldThrottleForInput &&
    (now - lastExecutionMainThreadLagAtMs < EXECUTION_TERMINAL_LAG_RECOVERY_WINDOW_MS ||
      now - lastExecutionVisibilityRestoredAtMs < EXECUTION_TERMINAL_VISIBILITY_RESTORE_RECOVERY_MS);
  const maxControllersThisFrame = shouldThrottleForInput
    ? EXECUTION_TERMINAL_INPUT_DRAIN_MAX_CONTROLLERS_PER_FRAME
    : EXECUTION_TERMINAL_DRAIN_MAX_CONTROLLERS_PER_FRAME;
  const maxCharsThisFrame = shouldThrottleForInput
    ? EXECUTION_TERMINAL_INPUT_DRAIN_MAX_CHARS_PER_FRAME
    : shouldThrottleForLagRecovery
      ? EXECUTION_TERMINAL_LAG_RECOVERY_DRAIN_MAX_CHARS_PER_FRAME
      : EXECUTION_TERMINAL_DRAIN_MAX_CHARS_PER_FRAME;
  const maxCharsPerController = shouldThrottleForInput
    ? EXECUTION_TERMINAL_INPUT_DRAIN_MAX_CHARS_PER_CONTROLLER
    : shouldThrottleForLagRecovery
      ? EXECUTION_TERMINAL_LAG_RECOVERY_DRAIN_MAX_CHARS_PER_FRAME
      : EXECUTION_TERMINAL_DRAIN_MAX_CHARS_PER_CONTROLLER;
  let flushedControllerCount = 0;
  let characters = 0;
  let pendingOutputLength = 0;
  let processedControllerCount = 0;
  let queuedWriteBlockedControllerCount = 0;
  const deferredControllers: ExecutionTerminalController[] = [];
  const queuedWriteBlockedControllers: ExecutionTerminalController[] = [];
  const processedControllersWithRemainingOutput: ExecutionTerminalController[] = [];
  const orderedControllers = lastExecutionInputNodeId
    ? [...controllers].sort((left, right) => {
        if (left.nodeId === lastExecutionInputNodeId && right.nodeId !== lastExecutionInputNodeId) {
          return -1;
        }
        if (right.nodeId === lastExecutionInputNodeId && left.nodeId !== lastExecutionInputNodeId) {
          return 1;
        }
        return 0;
      })
    : controllers;
  for (const currentController of orderedControllers) {
    const pendingLength = currentController.getPendingOutputLength();
    pendingOutputLength += pendingLength;
    if (pendingLength <= 0 || currentController.isOutputDrainBlocked()) {
      continue;
    }
    if (currentController.getQueuedWriteCount() >= EXECUTION_TERMINAL_MAX_QUEUED_WRITES_PER_CONTROLLER) {
      queuedWriteBlockedControllerCount += 1;
      queuedWriteBlockedControllers.push(currentController);
      continue;
    }
    if (processedControllerCount >= maxControllersThisFrame) {
      deferredControllers.push(currentController);
      continue;
    }

    const remainingFrameBudget = Math.max(0, maxCharsThisFrame - characters);
    if (remainingFrameBudget <= 0) {
      deferredControllers.push(currentController);
      continue;
    }

    processedControllerCount += 1;
    const flushedCharacters = currentController.flushPendingOutput(Math.min(maxCharsPerController, remainingFrameBudget));
    if (flushedCharacters > 0) {
      characters += flushedCharacters;
      flushedControllerCount += 1;
    }
    if (currentController.getPendingOutputLength() > 0 && !currentController.isOutputDrainBlocked()) {
      processedControllersWithRemainingOutput.push(currentController);
    }
  }
  for (const controller of [
    ...deferredControllers,
    ...queuedWriteBlockedControllers,
    ...processedControllersWithRemainingOutput
  ]) {
    pendingExecutionTerminalDrains.add(controller);
  }
  if (pendingExecutionTerminalDrains.size > 0) {
    scheduleExecutionTerminalDrainPump(flushedControllerCount === 0 && queuedWriteBlockedControllerCount > 0 ? 16 : 0);
  }
  reportExecutionPerformanceDiagnostic(
    {
      source: 'webview-terminal-drain',
      durationMs: readPerformanceNow() - startedAt,
      controllerCount: controllers.length,
      flushedControllerCount,
      pendingControllerCount: pendingExecutionTerminalDrains.size,
      pendingOutputLength,
      characters,
      reason: shouldThrottleForInput ? 'input-throttle' : shouldThrottleForLagRecovery ? 'lag-recovery' : undefined
    },
    {
      minDurationMs: EXECUTION_PERFORMANCE_DIAGNOSTIC_DRAIN_MIN_DURATION_MS,
      minCharacters: EXECUTION_PERFORMANCE_DIAGNOSTIC_MIN_CHARACTERS
    }
  );
}

function getTotalPendingExecutionTerminalOutputLength(): number {
  let total = 0;
  for (const controller of pendingExecutionTerminalDrains) {
    total += controller.getPendingOutputLength();
  }
  return total;
}

function createExecutionTerminalController(
  nodeId: string,
  kind: ExecutionNodeKind,
  terminal: Terminal,
  options?: {
    onContentWillChange?: (reason: ExecutionTerminalContentChangeReason) => void;
    onSnapshotApplied?: (detail: Extract<ExecutionHostEvent, { type: 'snapshot' }>) => void;
    beginSnapshotRestoreDiagnosticsSuppression?: () => (() => void) | undefined;
  }
): ExecutionTerminalController {
  let pendingOutput = '';
  let pendingPersistBarrier = false;
  let pendingExitMessage: string | undefined;
  let disposed = false;
  let writeGeneration = 0;
  let queuedWriteCount = 0;
  let writeChain: Promise<void> = Promise.resolve();
  let snapshotResetRequestedAtMs = Number.NEGATIVE_INFINITY;
  let snapshotResetTimeout: number | undefined;
  let snapshotResetRequestPending = false;
  let pendingSnapshotResetRequestId: string | undefined;
  let currentExecutionSessionId: string | undefined;
  let pendingSnapshotResetExecutionSessionId: string | undefined;
  let pendingSnapshotResetAfterSequence: number | undefined;
  let pendingSnapshotOutputQueue: Array<{
    chunk: string;
    persisted?: boolean;
    outputSequence?: number;
    executionSessionId?: string;
  }> = [];
  let pendingSnapshotOutputLength = 0;
  let pendingSnapshotLastDeferredDiagnosticAtMs = Number.NEGATIVE_INFINITY;
  let pendingSnapshotLastDeferredDiagnosticLength = 0;
  let lastAppliedSnapshotSequence = 0;

  const normalizeOutputSequence = (value: number | undefined): number | undefined =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined;

  const queueTerminalWrite = (
    writer: (done: () => void, markStarted?: () => void) => void,
    detail?: {
      reason: string;
      characters?: number;
    },
    onComplete?: () => void
  ): void => {
    const generation = writeGeneration;
    queuedWriteCount += 1;
    writeChain = writeChain
      .catch(() => undefined)
      .then(
        () =>
          new Promise<void>((resolve) => {
            if (disposed || generation !== writeGeneration) {
              queuedWriteCount = Math.max(0, queuedWriteCount - 1);
              onComplete?.();
              resolve();
              return;
            }

            let startedAt = readPerformanceNow();
            const markStarted = (): void => {
              startedAt = readPerformanceNow();
            };
            writer(() => {
              queuedWriteCount = Math.max(0, queuedWriteCount - 1);
              reportExecutionPerformanceDiagnostic(
                {
                  source: 'webview-terminal-write',
                  nodeId,
                  kind,
                  reason: detail?.reason,
                  durationMs: readPerformanceNow() - startedAt,
                  characters: detail?.characters,
                  queuedWriteCount,
                  bufferLength: terminal.buffer.active.length
                },
                {
                  minDurationMs: EXECUTION_PERFORMANCE_DIAGNOSTIC_MIN_DURATION_MS,
                  minCharacters: EXECUTION_PERFORMANCE_DIAGNOSTIC_MIN_CHARACTERS
                }
              );
              onComplete?.();
              resolve();
            }, markStarted);
          })
      );
  };

  const queueExitWrite = (message: string): void => {
    options?.onContentWillChange?.('exit');
    queueTerminalWrite((done) => {
      terminal.write(`\r\n[Dev Session Canvas] ${message}\r\n`, done);
    }, {
      reason: 'exit',
      characters: message.length
    });
  };

  const postAttachSnapshotRequest = (): void => {
    postMessage({
      type: 'webview/attachExecutionSession',
      payload: {
        nodeId,
        kind,
        ...(currentExecutionSessionId !== undefined
          ? { executionSessionId: currentExecutionSessionId }
          : {}),
        ...(lastAppliedSnapshotSequence > 0
          ? { minOutputSequence: lastAppliedSnapshotSequence }
          : {})
      }
    });
  };

  const flushDeferredExitIfReady = (): void => {
    if (pendingPersistBarrier || pendingOutput.length > 0 || pendingExitMessage === undefined) {
      return;
    }

    const message = pendingExitMessage;
    pendingExitMessage = undefined;
    queueExitWrite(message);
  };

  const clearSnapshotResetTimeout = (): void => {
    if (snapshotResetTimeout !== undefined) {
      window.clearTimeout(snapshotResetTimeout);
      snapshotResetTimeout = undefined;
    }
  };

  const clearPendingSnapshotResetState = (): void => {
    clearSnapshotResetTimeout();
    pendingSnapshotResetAfterSequence = undefined;
    pendingSnapshotResetRequestId = undefined;
    pendingSnapshotResetExecutionSessionId = undefined;
    snapshotResetRequestPending = false;
    pendingSnapshotOutputQueue = [];
    pendingSnapshotOutputLength = 0;
    pendingSnapshotLastDeferredDiagnosticAtMs = Number.NEGATIVE_INFINITY;
    pendingSnapshotLastDeferredDiagnosticLength = 0;
  };

  const requestSnapshotForReset = (reason: string, options?: { force?: boolean }): boolean => {
    if (pendingSnapshotResetAfterSequence === undefined) {
      return false;
    }

    const now = readPerformanceNow();
    const shouldRequestSnapshot =
      options?.force === true ||
      !snapshotResetRequestPending ||
      now - snapshotResetRequestedAtMs >= EXECUTION_TERMINAL_SNAPSHOT_RESET_REQUEST_COOLDOWN_MS;
    if (!shouldRequestSnapshot) {
      return false;
    }

    const requestId = `snapshot-reset-${nextExecutionSnapshotResetRequestSequence++}`;
    pendingSnapshotResetRequestId = requestId;
    snapshotResetRequestedAtMs = now;
    snapshotResetRequestPending = true;
    clearSnapshotResetTimeout();
    snapshotResetTimeout = window.setTimeout(() => {
      snapshotResetTimeout = undefined;
      if (disposed || pendingSnapshotResetAfterSequence === undefined) {
        return;
      }
      const requestAgeMs = Math.max(0, readPerformanceNow() - snapshotResetRequestedAtMs);
      reportExecutionPerformanceDiagnostic(
        {
          source: 'webview-output-snapshot-reset',
          nodeId,
          kind,
          reason: 'snapshot-reset-timeout',
          requestId: pendingSnapshotResetRequestId,
          executionSessionId: pendingSnapshotResetExecutionSessionId,
          sequence: pendingSnapshotResetAfterSequence,
          durationMs: requestAgeMs,
          pendingOutputLength: pendingSnapshotOutputLength,
          success: false
        },
        {
          force: true
        }
      );
      requestSnapshotForReset('snapshot-reset-timeout-retry', { force: true });
    }, EXECUTION_TERMINAL_SNAPSHOT_RESET_TIMEOUT_MS);
    postMessage({
      type: 'webview/attachExecutionSession',
      payload: {
        nodeId,
        kind,
        requestId,
        ...(pendingSnapshotResetExecutionSessionId !== undefined
          ? { executionSessionId: pendingSnapshotResetExecutionSessionId }
          : {}),
        minOutputSequence: pendingSnapshotResetAfterSequence
      }
    });
    reportExecutionPerformanceDiagnostic(
      {
        source: 'webview-output-snapshot-reset',
        nodeId,
        kind,
        reason,
        requestId,
        executionSessionId: pendingSnapshotResetExecutionSessionId,
        sequence: pendingSnapshotResetAfterSequence,
        pendingOutputLength: pendingSnapshotOutputLength,
        success: true
      },
      {
        force: true
      }
    );
    return true;
  };

  const reportDeferredSnapshotOutputIfNeeded = (outputSequence: number | undefined, chunkLength: number): void => {
    const now = readPerformanceNow();
    if (
      pendingSnapshotOutputLength - pendingSnapshotLastDeferredDiagnosticLength <
        EXECUTION_TERMINAL_SNAPSHOT_RESET_DEFERRED_OUTPUT_DIAGNOSTIC_STEP &&
      now - pendingSnapshotLastDeferredDiagnosticAtMs < 1000
    ) {
      return;
    }

    pendingSnapshotLastDeferredDiagnosticAtMs = now;
    pendingSnapshotLastDeferredDiagnosticLength = pendingSnapshotOutputLength;
    reportExecutionPerformanceDiagnostic(
      {
        source: 'webview-output-snapshot-reset',
        nodeId,
        kind,
        reason: 'output-deferred-until-snapshot-reset',
        requestId: pendingSnapshotResetRequestId,
        executionSessionId: pendingSnapshotResetExecutionSessionId,
        sequence: outputSequence,
        characters: chunkLength,
        pendingOutputLength: pendingSnapshotOutputLength,
        pendingControllerCount: pendingSnapshotOutputQueue.length,
        success: true
      },
      {
        force: true
      }
    );
  };

  const compactDeferredSnapshotOutputForBudget = (latestOutputSequence: number | undefined): void => {
    if (pendingSnapshotOutputLength <= EXECUTION_TERMINAL_SNAPSHOT_RESET_DEFERRED_OUTPUT_BUDGET) {
      return;
    }

    const droppedCharacters = pendingSnapshotOutputLength;
    const latestQueuedSequence = pendingSnapshotOutputQueue.reduce<number | undefined>((latest, entry) => {
      const entrySequence = normalizeOutputSequence(entry.outputSequence);
      if (entrySequence === undefined) {
        return latest;
      }
      return latest === undefined ? entrySequence : Math.max(latest, entrySequence);
    }, latestOutputSequence);
    if (latestQueuedSequence !== undefined) {
      pendingSnapshotResetAfterSequence =
        pendingSnapshotResetAfterSequence === undefined
          ? latestQueuedSequence
          : Math.max(pendingSnapshotResetAfterSequence, latestQueuedSequence);
    }
    pendingSnapshotOutputQueue = [];
    pendingSnapshotOutputLength = 0;
    pendingSnapshotLastDeferredDiagnosticLength = 0;
    reportExecutionPerformanceDiagnostic(
      {
        source: 'webview-output-snapshot-reset',
        nodeId,
        kind,
        reason: 'deferred-output-budget-reset',
        requestId: pendingSnapshotResetRequestId,
        executionSessionId: pendingSnapshotResetExecutionSessionId,
        sequence: pendingSnapshotResetAfterSequence,
        characters: droppedCharacters,
        pendingOutputLength: droppedCharacters,
        success: true
      },
      {
        force: true
      }
    );
    requestSnapshotForReset('deferred-output-budget-reset-requested');
  };

  const controller: ExecutionTerminalController = {
    nodeId,
    kind,
    applySnapshot(detail) {
      if (disposed) {
        return;
      }

      if (
        pendingSnapshotResetAfterSequence === undefined &&
        typeof detail.requestId === 'string' &&
        detail.requestId.startsWith('snapshot-reset-')
      ) {
        reportExecutionPerformanceDiagnostic(
          {
            source: 'webview-output-snapshot-reset',
            nodeId,
            kind,
            reason: 'stale-snapshot-reset-ignored',
            requestId: detail.requestId,
            executionSessionId: detail.executionSessionId,
            sequence: normalizeOutputSequence(detail.outputSequence),
            success: false
          },
          {
            force: true
          }
        );
        return;
      }

      const snapshotSequence = normalizeOutputSequence(detail.outputSequence);
      const hasPendingSnapshotReset = pendingSnapshotResetAfterSequence !== undefined;
      const snapshotRequestMismatch =
        hasPendingSnapshotReset &&
        pendingSnapshotResetRequestId !== undefined &&
        detail.requestId !== undefined &&
        detail.requestId !== pendingSnapshotResetRequestId;
      if (snapshotRequestMismatch) {
        reportExecutionPerformanceDiagnostic(
          {
            source: 'webview-output-snapshot-reset',
            nodeId,
            kind,
            reason: 'stale-snapshot-reset-ignored',
            requestId: detail.requestId,
            executionSessionId: detail.executionSessionId ?? pendingSnapshotResetExecutionSessionId,
            sequence: snapshotSequence,
            success: false
          },
          {
            force: true
          }
        );
        return;
      }

      const resetSessionChanged =
        pendingSnapshotResetExecutionSessionId !== undefined &&
        detail.executionSessionId !== undefined &&
        detail.executionSessionId !== pendingSnapshotResetExecutionSessionId;
      if (
        pendingSnapshotResetAfterSequence !== undefined &&
        !resetSessionChanged &&
        snapshotSequence !== undefined &&
        snapshotSequence < pendingSnapshotResetAfterSequence
      ) {
        reportExecutionPerformanceDiagnostic(
          {
            source: 'webview-output-snapshot-reset',
            nodeId,
            kind,
            reason: 'stale-snapshot-reset-ignored',
            requestId: detail.requestId ?? pendingSnapshotResetRequestId,
            executionSessionId: detail.executionSessionId ?? pendingSnapshotResetExecutionSessionId,
            sequence: snapshotSequence,
            success: false
          },
          {
            force: true
          }
        );
        return;
      }

      if (hasPendingSnapshotReset && !resetSessionChanged && snapshotSequence === undefined) {
        reportExecutionPerformanceDiagnostic(
          {
            source: 'webview-output-snapshot-reset',
            nodeId,
            kind,
            reason: detail.liveSession ? 'snapshot-reset-unsequenced-snapshot' : 'snapshot-reset-session-ended-snapshot',
            requestId: detail.requestId ?? pendingSnapshotResetRequestId,
            executionSessionId: detail.executionSessionId ?? pendingSnapshotResetExecutionSessionId,
            sequence: pendingSnapshotResetAfterSequence,
            pendingOutputLength: pendingSnapshotOutputLength,
            success: detail.liveSession === false
          },
          {
            force: true
          }
        );
        if (detail.liveSession) {
          return;
        }
      }

      const outputsAfterSnapshotReset =
        !hasPendingSnapshotReset || resetSessionChanged || snapshotSequence === undefined
          ? []
          : pendingSnapshotOutputQueue.filter((entry) => {
              const outputSequence = normalizeOutputSequence(entry.outputSequence);
              return outputSequence !== undefined && outputSequence > snapshotSequence;
            });
      const requestId = detail.requestId ?? pendingSnapshotResetRequestId;
      const appliedPendingLength = pendingSnapshotOutputLength;
      const snapshotResetApplied =
        hasPendingSnapshotReset && !resetSessionChanged && snapshotSequence !== undefined;
      if (hasPendingSnapshotReset && resetSessionChanged) {
        reportExecutionPerformanceDiagnostic(
          {
            source: 'webview-output-snapshot-reset',
            nodeId,
            kind,
            reason: 'snapshot-reset-session-changed',
            requestId,
            executionSessionId: detail.executionSessionId ?? pendingSnapshotResetExecutionSessionId,
            sequence: snapshotSequence ?? pendingSnapshotResetAfterSequence,
            pendingOutputLength: appliedPendingLength,
            success: true
          },
          {
            force: true
          }
        );
      }
      clearPendingSnapshotResetState();
      if (detail.executionSessionId !== undefined && detail.executionSessionId !== currentExecutionSessionId) {
        lastAppliedSnapshotSequence = 0;
      }
      currentExecutionSessionId = detail.executionSessionId ?? currentExecutionSessionId;
      lastAppliedSnapshotSequence = Math.max(lastAppliedSnapshotSequence, snapshotSequence ?? lastAppliedSnapshotSequence);
      pendingOutput = '';
      pendingPersistBarrier = false;
      pendingExitMessage = undefined;
      pendingExecutionTerminalDrains.delete(controller);
      writeGeneration += 1;
      options?.onContentWillChange?.('snapshot');
      options?.onSnapshotApplied?.(detail);
      queueTerminalWrite(
        (done, markStarted) => {
          const snapshotWriteGeneration = writeGeneration;
          let finished = false;
          const finishSnapshotWrite = (snapshotDone?: () => void): void => {
            if (finished) {
              snapshotDone?.();
              return;
            }
            finished = true;
            snapshotDone?.();
            done();
          };
          scheduleExecutionTerminalSnapshotWrite({
            nodeId,
            kind,
            queuedAtMs: readPerformanceNow(),
            run: (snapshotDone) => {
              if (disposed || snapshotWriteGeneration !== writeGeneration) {
                finishSnapshotWrite(snapshotDone);
                return;
              }
              markStarted?.();
              const releaseSnapshotRestoreDiagnosticsSuppression =
                options?.beginSnapshotRestoreDiagnosticsSuppression?.();
              restoreExecutionTerminalSnapshot(terminal, detail, () => {
                releaseSnapshotRestoreDiagnosticsSuppression?.();
                finishSnapshotWrite(snapshotDone);
              });
            },
            cancel: finishSnapshotWrite
          });
        },
        {
          reason: 'snapshot',
          characters: detail.serializedTerminalState?.data.length ?? detail.output.length
        }
      );
      if (snapshotResetApplied) {
        reportExecutionPerformanceDiagnostic(
          {
            source: 'webview-output-snapshot-reset',
            nodeId,
            kind,
            reason: 'snapshot-reset-applied',
            requestId,
            executionSessionId: currentExecutionSessionId,
            sequence: snapshotSequence,
            characters: detail.serializedTerminalState?.data.length ?? detail.output.length,
            pendingOutputLength: appliedPendingLength,
            pendingControllerCount: outputsAfterSnapshotReset.length,
            success: true
          },
          {
            force: true
          }
        );
      }
      for (const output of outputsAfterSnapshotReset) {
        controller.enqueueOutput(output.chunk, {
          persisted: output.persisted,
          outputSequence: output.outputSequence,
          executionSessionId: output.executionSessionId
        });
      }
    },
    requestAttachSnapshot() {
      if (disposed) {
        return;
      }

      postAttachSnapshotRequest();
    },
    enqueueOutput(chunk, outputOptions) {
      if (disposed) {
        return;
      }

      const outputSequence = normalizeOutputSequence(outputOptions?.outputSequence);
      const outputExecutionSessionId = outputOptions?.executionSessionId;
      if (outputExecutionSessionId !== undefined && currentExecutionSessionId !== outputExecutionSessionId) {
        if (currentExecutionSessionId !== undefined) {
          clearPendingSnapshotResetState();
          lastAppliedSnapshotSequence = 0;
        }
        currentExecutionSessionId = outputExecutionSessionId;
      }
      const resetSessionMatches =
        pendingSnapshotResetExecutionSessionId === undefined ||
        outputExecutionSessionId === undefined ||
        outputExecutionSessionId === pendingSnapshotResetExecutionSessionId;
      if (
        pendingSnapshotResetAfterSequence !== undefined &&
        resetSessionMatches &&
        (outputSequence === undefined || outputSequence <= pendingSnapshotResetAfterSequence)
      ) {
        reportExecutionPerformanceDiagnostic(
          {
            source: 'webview-output-snapshot-reset',
            nodeId,
            kind,
            reason: 'stale-output-after-reset-dropped',
            requestId: pendingSnapshotResetRequestId,
            executionSessionId: outputExecutionSessionId ?? pendingSnapshotResetExecutionSessionId,
            sequence: outputSequence,
            characters: chunk.length,
            success: true
          },
          {
            force: true
          }
        );
        return;
      }
      if (pendingSnapshotResetAfterSequence !== undefined && resetSessionMatches) {
        pendingSnapshotOutputQueue.push({
          chunk,
          persisted: outputOptions?.persisted,
          outputSequence,
          executionSessionId: outputExecutionSessionId
        });
        pendingSnapshotOutputLength += chunk.length;
        reportDeferredSnapshotOutputIfNeeded(outputSequence, chunk.length);
        compactDeferredSnapshotOutputForBudget(outputSequence);
        return;
      }
      if (outputSequence !== undefined) {
        lastAppliedSnapshotSequence = Math.max(lastAppliedSnapshotSequence, outputSequence);
      }

      if (chunk) {
        pendingOutput += chunk;
        options?.onContentWillChange?.('output');
      }
      if (outputOptions?.persisted === false) {
        pendingPersistBarrier = true;
      }
      if (outputOptions?.persisted === true) {
        pendingPersistBarrier = false;
      }
      if (pendingPersistBarrier || pendingOutput.length === 0) {
        flushDeferredExitIfReady();
        pendingExecutionTerminalDrains.delete(controller);
        return;
      }

      scheduleExecutionTerminalDrain(controller);
    },
    resetBacklogForSnapshot(reason) {
      if (disposed || pendingPersistBarrier || pendingOutput.length === 0 || pendingSnapshotResetAfterSequence !== undefined) {
        return;
      }

      const droppedCharacters = pendingOutput.length;
      const resetAfterSequence = lastAppliedSnapshotSequence;
      pendingOutput = '';
      pendingExitMessage = undefined;
      pendingSnapshotResetAfterSequence = resetAfterSequence;
      pendingSnapshotResetExecutionSessionId = currentExecutionSessionId;
      pendingSnapshotOutputQueue = [];
      pendingSnapshotOutputLength = 0;
      pendingSnapshotLastDeferredDiagnosticAtMs = Number.NEGATIVE_INFINITY;
      pendingSnapshotLastDeferredDiagnosticLength = 0;
      pendingExecutionTerminalDrains.delete(controller);
      const requestedSnapshot = requestSnapshotForReset('snapshot-reset-requested', { force: true });
      reportExecutionPerformanceDiagnostic(
        {
          source: 'webview-output-snapshot-reset',
          nodeId,
          kind,
          reason,
          requestId: pendingSnapshotResetRequestId,
          executionSessionId: pendingSnapshotResetExecutionSessionId,
          sequence: resetAfterSequence,
          characters: droppedCharacters,
          pendingOutputLength: droppedCharacters,
          success: requestedSnapshot
        },
        {
          force: true
        }
      );
    },
    showExit(message) {
      if (disposed) {
        return;
      }

      if (pendingSnapshotResetAfterSequence !== undefined) {
        reportExecutionPerformanceDiagnostic(
          {
            source: 'webview-output-snapshot-reset',
            nodeId,
            kind,
            reason: 'snapshot-reset-session-ended',
            requestId: pendingSnapshotResetRequestId,
            executionSessionId: pendingSnapshotResetExecutionSessionId,
            sequence: pendingSnapshotResetAfterSequence,
            pendingOutputLength: pendingSnapshotOutputLength,
            pendingControllerCount: pendingSnapshotOutputQueue.length,
            success: true
          },
          {
            force: true
          }
        );
        clearPendingSnapshotResetState();
      }

      if (pendingPersistBarrier) {
        pendingExitMessage = message;
        return;
      }

      if (pendingOutput.length > 0) {
        pendingExitMessage = message;
        scheduleExecutionTerminalDrain(controller);
        return;
      }
      queueExitWrite(message);
    },
    refreshVisibleRows() {
      if (disposed) {
        return;
      }

      if (pendingOutput.length > 0 && !pendingPersistBarrier) {
        scheduleExecutionTerminalDrain(controller);
      }
      if (terminal.rows > 0) {
        terminal.refresh(0, terminal.rows - 1);
      }
    },
    flushPendingOutput(maxCharacters) {
      if (disposed || pendingPersistBarrier || pendingOutput.length === 0) {
        return 0;
      }

      const chunkLength =
        typeof maxCharacters === 'number' && Number.isFinite(maxCharacters) && maxCharacters > 0
          ? Math.min(pendingOutput.length, Math.round(maxCharacters))
          : pendingOutput.length;
      const chunk = pendingOutput.slice(0, chunkLength);
      pendingOutput = pendingOutput.slice(chunkLength);
      // Keep the host message callback lightweight by deferring real terminal writes
      // to a batched drain step. xterm will continue to apply its own async parser queue.
      queueTerminalWrite((done) => {
        terminal.write(chunk, done);
      }, {
        reason: 'output',
        characters: chunk.length
      });
      flushDeferredExitIfReady();
      return chunk.length;
    },
    getPendingOutputLength() {
      return pendingOutput.length;
    },
    getQueuedWriteCount() {
      return queuedWriteCount;
    },
    isOutputDrainBlocked() {
      return pendingPersistBarrier;
    },
    dispose() {
      disposed = true;
      pendingOutput = '';
      pendingPersistBarrier = false;
      pendingExitMessage = undefined;
      for (let index = pendingExecutionTerminalSnapshotWrites.length - 1; index >= 0; index -= 1) {
        const snapshotWrite = pendingExecutionTerminalSnapshotWrites[index];
        if (snapshotWrite.nodeId === nodeId && snapshotWrite.kind === kind) {
          pendingExecutionTerminalSnapshotWrites.splice(index, 1);
          snapshotWrite.cancel();
        }
      }
      if (activeExecutionTerminalSnapshotWrite?.nodeId === nodeId && activeExecutionTerminalSnapshotWrite.kind === kind) {
        const snapshotWrite = activeExecutionTerminalSnapshotWrite;
        snapshotWrite.cancel();
        snapshotWrite.finishQueue?.();
      }
      clearPendingSnapshotResetState();
      writeGeneration += 1;
      queuedWriteCount = 0;
      writeChain = Promise.resolve();
      pendingExecutionTerminalDrains.delete(controller);
    }
  };

  return controller;
}

function restoreExecutionTerminalSnapshot(
  terminal: Terminal,
  detail: Extract<ExecutionHostEvent, { type: 'snapshot' }>,
  onRestored?: () => void
): void {
  const restoreCols = detail.cols > 1 ? detail.cols : terminal.cols;
  const restoreRows = detail.rows > 0 ? detail.rows : terminal.rows;

  if (restoreCols > 1 && restoreRows > 0 && (terminal.cols !== restoreCols || terminal.rows !== restoreRows)) {
    terminal.resize(restoreCols, restoreRows);
  }

  terminal.reset();
  const finishRestore = (): void => {
    window.requestAnimationFrame(() => {
      if (terminal.rows > 0) {
        terminal.refresh(0, terminal.rows - 1);
      }
    });
  };

  const snapshotOutputSequence = normalizeTerminalSnapshotOutputSequence(detail.outputSequence);
  const serializedTerminalStateOutputSequence = normalizeTerminalSnapshotOutputSequence(
    detail.serializedTerminalState?.outputSequence
  );
  const serializedTerminalState =
    detail.serializedTerminalState !== undefined &&
    (
      snapshotOutputSequence === undefined ||
      serializedTerminalStateOutputSequence === snapshotOutputSequence
    )
      ? detail.serializedTerminalState
      : undefined;

  if (serializedTerminalState) {
    terminal.write(serializedTerminalState.data, () => {
      finishRestore();
      onRestored?.();
    });
    return;
  }

  if (detail.output) {
    terminal.write(detail.output, () => {
      finishRestore();
      onRestored?.();
    });
    return;
  }

  finishRestore();
  onRestored?.();
}

function normalizeTerminalSnapshotOutputSequence(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined;
}

function scheduleExecutionTerminalVisibilityRestore(): void {
  lastExecutionVisibilityRestoredAtMs = readPerformanceNow();
  if (pendingExecutionTerminalDrains.size > 0) {
    scheduleExecutionTerminalDrainPump();
  }
  if (pendingExecutionTerminalSnapshotWrites.length > 0) {
    scheduleExecutionTerminalSnapshotWritePump();
  }
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      for (const { controller } of executionTerminalRegistry.values()) {
        controller.refreshVisibleRows();
      }
    });
  });
}

function scheduleCanvasShellFocusRestore(
  shell: HTMLDivElement | null,
  surfaceLocation: CanvasRuntimeContext['surfaceLocation']
): void {
  if (surfaceLocation !== 'editor') {
    return;
  }

  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      if (!shell || !shell.isConnected) {
        return;
      }

      try {
        window.focus();
      } catch {
        // Ignore focus failures and fall through to the root element focus attempt.
      }

      try {
        shell.focus({
          preventScroll: true
        });
      } catch {
        shell.focus();
      }
    });
  });
}

function scheduleEmbeddedTerminalAppearanceRefresh(): void {
  if (embeddedTerminalAppearanceRefreshScheduled) {
    return;
  }

  embeddedTerminalAppearanceRefreshScheduled = true;
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      embeddedTerminalAppearanceRefreshScheduled = false;
      refreshAllEmbeddedTerminalAppearances();
    });
  });
}

function refreshAllEmbeddedTerminalAppearances(): void {
  const appearance = readEmbeddedTerminalAppearance();
  syncEmbeddedTerminalCssVariables(appearance);
  for (const { terminal } of executionTerminalRegistry.values()) {
    applyEmbeddedTerminalAppearance(terminal, appearance);
  }
}

function ensureEmbeddedTerminalThemeObservers(): void {
  if (embeddedTerminalThemeObserverDispose) {
    return;
  }

  const scheduleRefresh = (): void => {
    scheduleEmbeddedTerminalAppearanceRefresh();
  };
  const headObserver = new MutationObserver(() => {
    scheduleRefresh();
  });
  const bodyObserver = new MutationObserver(() => {
    scheduleRefresh();
  });
  const rootObserver = new MutationObserver(() => {
    scheduleRefresh();
  });

  if (document.head) {
    headObserver.observe(document.head, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  if (document.body) {
    bodyObserver.observe(document.body, {
      attributes: true,
      attributeFilter: ['class', 'style', 'data-vscode-theme-id', 'data-vscode-theme-kind']
    });
  }

  rootObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class', 'style']
  });

  embeddedTerminalThemeObserverDispose = () => {
    headObserver.disconnect();
    bodyObserver.disconnect();
    rootObserver.disconnect();
  };
}

function collectWebviewProbeSnapshot(): WebviewProbeSnapshot {
  const nodeElements = Array.from(
    document.querySelectorAll<HTMLElement>('[data-node-id][data-node-kind]')
  );
  const nodes = nodeElements
    .map((element) => readWebviewProbeNodeSnapshot(element))
    .filter((node): node is WebviewProbeNodeSnapshot => node !== null);
  const edgeElements = Array.from(
    document.querySelectorAll<HTMLElement>('[data-edge-probe="true"][data-edge-id][data-edge-source][data-edge-target]')
  );
  const edges = edgeElements
    .map((element) => readWebviewProbeEdgeSnapshot(element))
    .filter((edge): edge is WebviewProbeSnapshot['edges'][number] => edge !== null);
  const groupElements = Array.from(document.querySelectorAll<HTMLElement>('[data-group-id]'));
  const groups = groupElements
    .map((element) => readWebviewProbeGroupSnapshot(element))
    .filter((group): group is WebviewProbeGroupSnapshot => group !== null);

  return {
    documentTitle: document.title,
    hasDocumentFocus: document.hasFocus(),
    hasCanvasShell: Boolean(document.querySelector('.canvas-shell')),
    hasReactFlow: Boolean(document.querySelector('.react-flow')),
    toastMessage: readProbeText(document.querySelector('[data-toast-kind="error"]')),
    executionLinkTooltipText: readProbeText(document.querySelector('.execution-link-tooltip.is-visible')),
    nodeCount: nodes.length,
    nodes,
    edgeCount: edges.length,
    edges,
    groupCount: groups.length,
    groups,
    selectedGroupIds: groups.filter((group) => group.selected).map((group) => group.groupId)
  };
}

function readWebviewProbeGroupSnapshot(element: HTMLElement): WebviewProbeGroupSnapshot | null {
  const groupId = element.dataset.groupId;
  if (!groupId) {
    return null;
  }

  const left = Number.parseFloat(element.style.left);
  const top = Number.parseFloat(element.style.top);
  const width = Number.parseFloat(element.style.width);
  const height = Number.parseFloat(element.style.height);
  const title = readProbeFieldValue(element, 'title') ?? readProbeText(element.querySelector('[data-probe-field="title"]'));
  const background = document.querySelector<HTMLElement>(`[data-group-background-id="${CSS.escape(groupId)}"]`);
  const role = background?.dataset.groupBackgroundRole === 'workspace-root' ? 'workspace-root' : 'user';
  const bodyTopOffset = background
    ? Number.parseFloat(getComputedStyle(background).getPropertyValue('--canvas-group-body-top'))
    : Number.NaN;

  return {
    groupId,
    title,
    role,
    selected: element.classList.contains('is-selected'),
    left: Number.isFinite(left) ? Math.round(left) : 0,
    top: Number.isFinite(top) ? Math.round(top) : 0,
    width: Number.isFinite(width) ? Math.round(width) : Math.round(element.offsetWidth),
    height: Number.isFinite(height) ? Math.round(height) : Math.round(element.offsetHeight),
    bodyTopOffset: Number.isFinite(bodyTopOffset) ? Math.round(bodyTopOffset) : 0
  };
}

function readWebviewProbeNodeSnapshot(element: HTMLElement): WebviewProbeNodeSnapshot | null {
  const nodeId = element.dataset.nodeId;
  const nodeKind = element.dataset.nodeKind;

  if (!nodeId || !isCanvasNodeKind(nodeKind)) {
    return null;
  }

  const footprint = readProbeNodeFootprint(element);
  const minimapNode = queryMinimapNode(nodeId);

  return {
    nodeId,
    kind: nodeKind,
    chromeTitle:
      readProbeText(
        element.querySelector('.window-title strong, .node-topline strong, .file-node-copy strong, .file-list-title-text')
      ) ??
      readProbeFieldValue(element, 'title') ??
      null,
    chromeContext: readProbeText(element.querySelector('.window-title-context, .node-topline .node-context')),
    chromeSubtitle: readProbeText(
      element.querySelector('.window-title-subtitle, .node-topline span, .file-node-copy span')
    ),
    statusText: readProbeText(element.querySelector('.status-pill, .node-status')),
    attentionIndicatorVisible: Boolean(element.querySelector('[data-attention-indicator="true"]')),
    attentionIndicatorFlashing:
      element.querySelector<HTMLElement>('.window-chrome')?.dataset.executionAttentionFlashing === 'true',
    minimapVisible: minimapNode !== null,
    minimapAttentionFlashing: minimapNode?.dataset.minimapAttentionFlashing === 'true',
    minimapAttentionSizePulsing: minimapNode?.dataset.minimapAttentionSizePulsing === 'true',
    selected: element.dataset.nodeSelected === 'true',
    renderedWidth: footprint.width,
    renderedHeight: footprint.height,
    overlayTitle: readProbeTextOrUndefined(element.querySelector('.terminal-overlay strong')),
    overlayMessage: readProbeTextOrUndefined(element.querySelector('.terminal-overlay span')),
    titleInputValue: readProbeFieldValue(element, 'title'),
    bodyValue: readProbeFieldValue(element, 'body'),
    ...readProbeExecutionTerminalState(nodeId)
  };
}

function readWebviewProbeEdgeSnapshot(element: HTMLElement): WebviewProbeEdgeSnapshot | null {
  const edgeId = element.dataset.edgeId;
  const sourceNodeId = element.dataset.edgeSource;
  const targetNodeId = element.dataset.edgeTarget;
  const arrowMode = element.dataset.edgeArrowMode;
  const owner = element.dataset.edgeOwner;

  if (
    !edgeId ||
    !sourceNodeId ||
    !targetNodeId ||
    (arrowMode !== 'none' && arrowMode !== 'forward' && arrowMode !== 'both') ||
    (owner !== 'user' && owner !== 'file-activity')
  ) {
    return null;
  }

  return {
    edgeId,
    sourceNodeId,
    targetNodeId,
    arrowMode,
    owner,
    color: element.dataset.edgeColor ?? null,
    label: element.dataset.edgeLabel ?? null,
    selected: element.dataset.edgeSelected === 'true'
  };
}

function readProbeNodeFootprint(element: HTMLElement): CanvasNodeFootprint {
  const wrapper = element.closest<HTMLElement>('.react-flow__node');
  const probeTarget = wrapper ?? element;
  const width = Math.round(probeTarget.offsetWidth || element.getBoundingClientRect().width);
  const height = Math.round(probeTarget.offsetHeight || element.getBoundingClientRect().height);

  return {
    width,
    height
  };
}

function readProbeFieldValue(element: HTMLElement, fieldName: string): string | undefined {
  const field = element.querySelector<HTMLElement>(`[data-probe-field="${fieldName}"]`);
  if (!field) {
    return undefined;
  }

  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement) {
    return field.value;
  }

  const probeValue = field.dataset.probeValue;
  return typeof probeValue === 'string' ? probeValue : undefined;
}

function readProbeText(element: Element | null): string | null {
  const text = element?.textContent?.trim();
  return text ? text : null;
}

function readProbeTextOrUndefined(element: Element | null): string | undefined {
  return readProbeText(element) ?? undefined;
}

function readProbeExecutionTerminalState(
  nodeId: string
): Pick<
  WebviewProbeNodeSnapshot,
  | 'terminalSelectionText'
  | 'terminalCols'
  | 'terminalRows'
  | 'terminalViewportY'
  | 'terminalVisibleLines'
  | 'terminalTextareaLeft'
  | 'terminalTextareaTop'
  | 'terminalMouseTrackingMode'
  | 'terminalBufferType'
  | 'terminalHasFocus'
  | 'terminalTheme'
> {
  const terminal = executionTerminalRegistry.get(nodeId);
  if (!terminal) {
    return {};
  }

  return {
    terminalSelectionText: terminal.terminal.getSelection(),
    terminalCols: terminal.terminal.cols > 0 ? terminal.terminal.cols : undefined,
    terminalRows: terminal.terminal.rows > 0 ? terminal.terminal.rows : undefined,
    terminalViewportY:
      terminal.terminal.buffer.active.viewportY >= 0 ? terminal.terminal.buffer.active.viewportY : undefined,
    terminalVisibleLines: readProbeTerminalVisibleLines(terminal.terminal),
    terminalTextareaLeft: readProbeNumericStyleValue(terminal.terminal.textarea?.style.left),
    terminalTextareaTop: readProbeNumericStyleValue(terminal.terminal.textarea?.style.top),
    terminalMouseTrackingMode: terminal.terminal.modes.mouseTrackingMode,
    terminalBufferType: terminal.terminal.buffer.active.type,
    terminalHasFocus: terminal.terminal.textarea === document.activeElement,
    terminalTheme: readProbeTerminalTheme(terminal.terminal.options.theme)
  };
}

function readProbeTerminalVisibleLines(terminal: Terminal): string[] | undefined {
  if (terminal.rows <= 0) {
    return undefined;
  }

  const startLine = Math.max(0, terminal.buffer.active.viewportY);
  const visibleLines: string[] = [];
  for (let offset = 0; offset < terminal.rows; offset += 1) {
    const line = terminal.buffer.active.getLine(startLine + offset);
    visibleLines.push(line ? line.translateToString(true) : '');
  }

  return visibleLines;
}

function readProbeTerminalTheme(
  theme: EmbeddedTerminalOptions['theme']
): WebviewProbeNodeSnapshot['terminalTheme'] | undefined {
  if (!theme) {
    return undefined;
  }

  return {
    background: theme.background,
    foreground: theme.foreground,
    cursor: theme.cursor,
    selectionBackground: theme.selectionBackground,
    ansiBlue: theme.blue,
    ansiBrightWhite: theme.brightWhite
  };
}

function readProbeNumericStyleValue(value: string | undefined): number | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return undefined;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function performWebviewDomAction(requestId: string, action: WebviewDomAction): Promise<void> {
  try {
    await delayTestAction(action.delayMs);

    switch (action.kind) {
      case 'selectNode': {
        const target = queryNodeSelectionTarget(action.nodeId);
        dispatchSyntheticMouseClick(target);
        await waitForDomActionFlush();
        break;
      }
      case 'setNodeTextField': {
        const field = await queryNodeTextField(action.nodeId, action.field);
        field.focus();
        field.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
        setControlledFieldValue(field, action.value);
        field.dispatchEvent(new Event('input', { bubbles: true }));
        field.dispatchEvent(new Event('change', { bubbles: true }));
        await waitForDomActionFlush();
        field.blur();
        field.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
        await waitForDomActionFlush();
        break;
      }
      case 'clickNodeActionButton': {
        const button = queryNodeActionButton(action.nodeId, action);
        button.focus();
        button.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
        dispatchSyntheticMouseClick(button);
        await waitForDomActionFlush();
        button.blur();
        button.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
        break;
      }
      case 'scrollTerminalViewport': {
        const entry = executionTerminalRegistry.get(action.nodeId);
        if (!entry) {
          throw new Error(`Execution terminal ${action.nodeId} is not mounted.`);
        }

        entry.terminal.scrollLines(action.lines);
        await waitForDomActionFlush();
        break;
      }
      case 'sendExecutionInput': {
        const entry = executionTerminalRegistry.get(action.nodeId);
        if (!entry) {
          throw new Error(`Execution terminal ${action.nodeId} is not mounted.`);
        }

        entry.terminal.input(action.data);
        await waitForDomActionFlush();
        break;
      }
      case 'dropExecutionResources': {
        const nodeRoot = queryNodeRoot(action.nodeId);
        const dropTarget = nodeRoot.querySelector<HTMLElement>('.terminal-frame');
        if (!dropTarget) {
          throw new Error(`Execution terminal ${action.nodeId} has no drop target.`);
        }

        const dataTransfer = new DataTransfer();
        if (action.source === 'resourceUrls') {
          dataTransfer.setData('ResourceURLs', JSON.stringify(action.values));
        } else if (action.source === 'codeFiles') {
          dataTransfer.setData('CodeFiles', JSON.stringify(action.values));
        } else {
          dataTransfer.setData('text/uri-list', action.values.join('\n'));
        }

        dropTarget.dispatchEvent(
          new DragEvent('dragenter', {
            bubbles: true,
            cancelable: true,
            dataTransfer
          })
        );
        dropTarget.dispatchEvent(
          new DragEvent('dragover', {
            bubbles: true,
            cancelable: true,
            dataTransfer
          })
        );
        dropTarget.dispatchEvent(
          new DragEvent('drop', {
            bubbles: true,
            cancelable: true,
            dataTransfer
          })
        );
        await waitForDomActionFlush();
        break;
      }
      case 'activateExecutionLink': {
        const entry = executionTerminalRegistry.get(action.nodeId);
        if (!entry) {
          throw new Error(`Execution terminal ${action.nodeId} is not mounted.`);
        }

        await entry.nativeInteractions.activateLinkForTest(action.text);
        postMessage({
          type: 'webview/testDomActionResult',
          payload: {
            requestId,
            ok: true
          }
        });
        return;
      }
      case 'hoverExecutionLink': {
        const entry = executionTerminalRegistry.get(action.nodeId);
        if (!entry) {
          throw new Error(`Execution terminal ${action.nodeId} is not mounted.`);
        }

        await entry.nativeInteractions.hoverLinkForTest(action.text);
        await waitForDomActionFlush();
        break;
      }
      case 'hoverExecutionText': {
        const terminal = queryExecutionTerminalElement(action.nodeId);
        const rows = terminal.querySelector('.xterm-rows');
        if (!(rows instanceof HTMLElement)) {
          throw new Error(`Execution terminal ${action.nodeId} has no rendered rows.`);
        }

        const point = findExecutionTerminalTextPoint(rows, action.text);
        if (!point) {
          throw new Error(`Execution terminal text "${action.text}" was not found.`);
        }

        const target = document.elementFromPoint(point.x, point.y) ?? rows;
        target.dispatchEvent(
          new MouseEvent('mousemove', {
            bubbles: true,
            composed: true,
            view: window,
            clientX: point.x,
            clientY: point.y
          })
        );
        await waitForDomActionFlush();
        break;
      }
      case 'clearExecutionLinkHover': {
        const entry = executionTerminalRegistry.get(action.nodeId);
        if (!entry) {
          throw new Error(`Execution terminal ${action.nodeId} is not mounted.`);
        }

        entry.nativeInteractions.clearHoverForTest();
        await waitForDomActionFlush();
        break;
      }
      case 'selectEdge': {
        const target = queryEdgeSelectionTarget(action.edgeId);
        dispatchSyntheticMouseClick(target);
        await waitForDomActionFlush();
        break;
      }
      case 'clickFileEntry': {
        const target = queryFileEntryButton(action.nodeId, action.filePath);
        dispatchSyntheticMouseClick(target);
        await waitForDomActionFlush();
        break;
      }
      case 'toggleNoteChecklistItem': {
        const checkbox = queryNoteChecklistInput(action.nodeId, action.lineNumber);
        checkbox.focus();
        checkbox.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
        dispatchSyntheticMouseClick(checkbox);
        await waitForDomActionFlush();
        checkbox.blur();
        checkbox.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
        break;
      }
      case 'doubleClickNotePreviewText': {
        const point = queryNotePreviewTextPoint(action.nodeId, action.text, action.offset);
        const target = document.elementFromPoint(point.x, point.y) ?? point.element;
        postMessage({
          type: 'webview/testDomActionResult',
          payload: {
            requestId,
            ok: true
          }
        });
        dispatchSyntheticMouseDoubleClick(target, point);
        return;
      }
      case 'doubleClickNotePreviewSelector': {
        const target = queryNotePreviewSelectorTarget(action.nodeId, action.selector);
        postMessage({
          type: 'webview/testDomActionResult',
          payload: {
            requestId,
            ok: true
          }
        });
        dispatchSyntheticMouseDoubleClick(target, readElementCenterPoint(target));
        return;
      }
    }

    await waitForDomActionFlush();
    postMessage({
      type: 'webview/testDomActionResult',
      payload: {
        requestId,
        ok: true
      }
    });
  } catch (error) {
    postMessage({
      type: 'webview/testDomActionResult',
      payload: {
        requestId,
        ok: false,
        errorMessage: formatTestDomActionError(error)
      }
    });
  }
}

async function respondWithWebviewProbeSnapshot(requestId: string, delayMs?: number): Promise<void> {
  await delayTestAction(delayMs);
  postMessage({
    type: 'webview/testProbeResult',
    payload: {
      requestId,
      snapshot: collectWebviewProbeSnapshot()
    }
  });
}

async function queryNodeTextField(
  nodeId: string,
  fieldName: 'title' | 'body'
): Promise<HTMLInputElement | HTMLTextAreaElement> {
  let field = queryNodeField(nodeId, fieldName);
  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
    return field;
  }

  if (fieldName === 'body' && field instanceof HTMLElement) {
    dispatchSyntheticMouseDoubleClick(field);
    await waitForDomActionFlush();
    field = queryNodeField(nodeId, fieldName);
    if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
      return field;
    }
  }

  throw new Error(`Node ${nodeId} field ${fieldName} is not a text input control.`);
}

function queryNodeActionButton(nodeId: string, action: Extract<WebviewDomAction, { kind: 'clickNodeActionButton' }>): HTMLButtonElement {
  const nodeRoot = queryNodeRoot(nodeId);
  const button = Array.from(nodeRoot.querySelectorAll('button')).find(
    (candidate) => candidate.dataset.nodeActionId === action.action
  );
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Could not find action button ${action.action} on node ${nodeId}.`);
  }

  return button;
}

function queryNodeSelectionTarget(nodeId: string): HTMLElement {
  const nodeRoot = queryNodeRoot(nodeId);
  return (
    nodeRoot.querySelector<HTMLElement>('.window-chrome, .node-topline, .session-body, .object-body') ??
    nodeRoot
  );
}

function queryNodeField(nodeId: string, fieldName: string): Element {
  const field = queryNodeRoot(nodeId).querySelector(`[data-probe-field="${fieldName}"]`);
  if (!field) {
    throw new Error(`Could not find field ${fieldName} on node ${nodeId}.`);
  }

  return field;
}

function queryEdgeSelectionTarget(edgeId: string): Element {
  const edge = document.querySelector(`[data-edge-hitbox="true"][data-edge-id="${edgeId}"]`);
  if (!edge) {
    throw new Error(`Could not find edge ${edgeId}.`);
  }

  return edge;
}

function queryFileEntryButton(nodeId: string, filePath: string): HTMLElement {
  const nodeRoot = queryNodeRoot(nodeId);
  const target = Array.from(nodeRoot.querySelectorAll<HTMLElement>('[data-file-entry-path]')).find(
    (candidate) => candidate.dataset.fileEntryPath === filePath
  );
  if (!target) {
    throw new Error(`Could not find file entry ${filePath} on node ${nodeId}.`);
  }

  return target;
}

function queryNoteChecklistInput(nodeId: string, lineNumber: number): HTMLInputElement {
  const nodeRoot = queryNodeRoot(nodeId);
  const target = nodeRoot.querySelector<HTMLInputElement>(
    `${NOTE_MARKDOWN_CHECKLIST_SELECTOR}[data-note-markdown-task-line="${lineNumber}"]`
  );
  if (!(target instanceof HTMLInputElement)) {
    throw new Error(`Could not find Note checklist for line ${lineNumber} on node ${nodeId}.`);
  }

  return target;
}

function queryNotePreviewTextPoint(
  nodeId: string,
  text: string,
  offset = Math.floor(text.length / 2)
): { element: Element; x: number; y: number } {
  const preview = queryNodeRoot(nodeId).querySelector<HTMLElement>('.note-markdown-preview');
  if (!preview) {
    throw new Error(`Node ${nodeId} does not currently have a Note preview.`);
  }

  const textNode = findTextNodeContaining(preview, text);
  if (!textNode) {
    throw new Error(`Could not find text ${text} in the Note preview for node ${nodeId}.`);
  }

  const clampedOffset = Math.min(Math.max(0, offset), text.length);
  const range = document.createRange();
  const startOffset = textNode.data.indexOf(text);
  const textOffset = startOffset + clampedOffset;
  range.setStart(textNode, textOffset);
  range.setEnd(textNode, Math.min(textNode.data.length, textOffset + 1));
  const rect = range.getBoundingClientRect();
  const fallbackRect = textNode.parentElement?.getBoundingClientRect() ?? preview.getBoundingClientRect();
  range.detach();

  return {
    element: textNode.parentElement ?? preview,
    x: rect.width > 0 ? rect.left + Math.min(2, rect.width / 4) : fallbackRect.left + fallbackRect.width / 2,
    y: rect.height > 0 ? rect.top + rect.height / 2 : fallbackRect.top + fallbackRect.height / 2
  };
}

function findTextNodeContaining(root: HTMLElement, text: string): Text | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node instanceof Text && node.data.includes(text)) {
      return node;
    }
  }

  return null;
}

function queryNotePreviewSelectorTarget(nodeId: string, selector: string): HTMLElement {
  const preview = queryNodeRoot(nodeId).querySelector<HTMLElement>('.note-markdown-preview');
  if (!preview) {
    throw new Error(`Node ${nodeId} does not currently have a Note preview.`);
  }

  const target = preview.querySelector<HTMLElement>(selector);
  if (!target) {
    throw new Error(`Could not find selector ${selector} in the Note preview for node ${nodeId}.`);
  }

  return target;
}

function readElementCenterPoint(element: Element): { x: number; y: number } {
  const rect = element.getBoundingClientRect();
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2
  };
}


function queryNodeRoot(nodeId: string): HTMLElement {
  const nodeRoot = document.querySelector<HTMLElement>(`[data-node-id="${nodeId}"]`);
  if (!nodeRoot) {
    throw new Error(`Could not find node ${nodeId}.`);
  }

  return nodeRoot;
}

function queryExecutionTerminalElement(nodeId: string): HTMLElement {
  const terminal = queryNodeRoot(nodeId).querySelector<HTMLElement>('.xterm');
  if (!terminal) {
    throw new Error(`Could not find the execution terminal for node ${nodeId}.`);
  }

  return terminal;
}

function findExecutionTerminalTextPoint(rows: HTMLElement, text: string): { x: number; y: number } | undefined {
  for (const row of Array.from(rows.children)) {
    if (!(row instanceof HTMLElement) || !(row.textContent ?? '').includes(text)) {
      continue;
    }

    for (const span of Array.from(row.querySelectorAll('span'))) {
      if (!(span instanceof HTMLElement) || !(span.textContent ?? '').includes(text)) {
        continue;
      }

      const rect = span.getBoundingClientRect();
      return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2
      };
    }
  }

  return undefined;
}

function queryMinimapNode(nodeId: string): SVGElement | null {
  return (
    Array.from(document.querySelectorAll<SVGElement>('[data-minimap-node-id]')).find(
      (candidate) => candidate.dataset.minimapNodeId === nodeId
    ) ?? null
  );
}

function setControlledFieldValue(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string
): void {
  const prototype =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : element instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');

  descriptor?.set?.call(element, value);
}

function dispatchSyntheticMouseClick(target: Element, point?: { x: number; y: number }): void {
  const eventInit = {
    bubbles: true,
    cancelable: true,
    composed: true,
    button: 0,
    clientX: point?.x ?? 0,
    clientY: point?.y ?? 0
  };

  target.dispatchEvent(new MouseEvent('mousedown', eventInit));
  target.dispatchEvent(new MouseEvent('mouseup', eventInit));
  target.dispatchEvent(new MouseEvent('click', eventInit));
}

function dispatchSyntheticMouseDoubleClick(target: Element, point?: { x: number; y: number }): void {
  dispatchSyntheticMouseClick(target, point);
  dispatchSyntheticMouseClick(target, point);
  target.dispatchEvent(
    new MouseEvent('dblclick', {
      bubbles: true,
      cancelable: true,
      composed: true,
      button: 0,
      clientX: point?.x ?? 0,
      clientY: point?.y ?? 0
    })
  );
}

function waitForDomActionFlush(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => resolve());
    });
  });
}

function delayTestAction(delayMs?: number): Promise<void> {
  if (!delayMs || delayMs <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    window.setTimeout(resolve, delayMs);
  });
}

function isCanvasBlankDropTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }

  return !target.closest('.react-flow__node, .canvas-node, [data-node-interactive="true"], [data-context-menu="true"]');
}

function extractDroppedNoteMarkdownResources(dataTransfer: DataTransfer | null): ExecutionTerminalDroppedResource[] {
  if (!dataTransfer) {
    return [];
  }

  const resources: ExecutionTerminalDroppedResource[] = [];
  const rawResources = dataTransfer.getData(RESOURCE_URLS_DATA_TRANSFER);
  for (const value of parseDroppedStringArray(rawResources)) {
    resources.push({
      source: 'resourceUrls',
      valueKind: 'uri',
      value
    });
  }

  const rawCodeFiles = dataTransfer.getData(CODE_FILES_DATA_TRANSFER);
  for (const value of parseDroppedStringArray(rawCodeFiles)) {
    resources.push({
      source: 'codeFiles',
      valueKind: 'path',
      value
    });
  }

  const rawUriList = dataTransfer.getData(URI_LIST_DATA_TRANSFER);
  if (rawUriList) {
    for (const value of rawUriList
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0 && !entry.startsWith('#'))) {
      resources.push({
        source: 'uriList',
        valueKind: 'uri',
        value
      });
    }
  }

  for (const file of Array.from(dataTransfer.files) as Array<File & { path?: string }>) {
    if (typeof file.path === 'string' && file.path.trim().length > 0) {
      resources.push({
        source: 'files',
        valueKind: 'path',
        value: file.path
      });
    }
  }

  return resources;
}


function formatTestDomActionError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function createEmbeddedTerminalOptions(): EmbeddedTerminalOptions {
  const appearance = readEmbeddedTerminalAppearance();

  return {
    allowTransparency: true,
    cursorBlink: true,
    convertEol: false,
    fontFamily: appearance.fontFamily,
    fontSize: 12.5,
    scrollback: resolveEmbeddedTerminalScrollback(),
    theme: appearance.theme
  };
}

function resolveEmbeddedTerminalScrollback(runtimeContext: CanvasRuntimeContext = latestRuntimeContext): number {
  return normalizeTerminalScrollback(runtimeContext.terminalScrollback, DEFAULT_TERMINAL_SCROLLBACK);
}

function applyEmbeddedTerminalRuntimeContext(runtimeContext: CanvasRuntimeContext = latestRuntimeContext): void {
  const scrollback = resolveEmbeddedTerminalScrollback(runtimeContext);
  for (const { terminal } of executionTerminalRegistry.values()) {
    terminal.options.scrollback = scrollback;
  }
}

function applyFileIconFontFaces(fontFaces: CanvasRuntimeContext['fileIconFontFaces']): () => void {
  const styleId = 'dev-session-canvas-file-icon-font-faces';
  const existing = document.head.querySelector<HTMLStyleElement>(`#${styleId}`);
  if (!fontFaces.length) {
    existing?.remove();
    return () => {};
  }

  const styleElement = existing ?? document.createElement('style');
  styleElement.id = styleId;
  styleElement.textContent = fontFaces
    .map(
      (fontFace) =>
        `@font-face { font-family: '${fontFace.fontFamily}'; src: url('${fontFace.src}') format('${fontFace.format ?? 'woff'}'); font-weight: ${fontFace.fontWeight ?? 'normal'}; font-style: ${fontFace.fontStyle ?? 'normal'}; }`
    )
    .join('\n');
  if (!styleElement.parentElement) {
    document.head.appendChild(styleElement);
  }

  return () => {
    styleElement.remove();
  };
}

function readEmbeddedTerminalAppearance(): {
  fontFamily: string;
  theme: EmbeddedTerminalTheme;
} {
  const styles = readWorkbenchThemeStyles();
  const themeKind = readWorkbenchThemeKind();
  const defaults = EMBEDDED_TERMINAL_DEFAULTS[themeKind];
  const surfaceLocation = latestRuntimeContext.surfaceLocation;
  const background =
    readCssVariableValue(styles, '--vscode-terminal-background') ??
    readCssVariableChain(styles, TERMINAL_BACKGROUND_FALLBACKS[surfaceLocation]) ??
    (surfaceLocation === 'panel' ? defaults.panelBackground : defaults.editorBackground);
  const foreground =
    readCssVariableValue(styles, '--vscode-terminal-foreground') ?? defaults.foreground;
  const cursor = readCssVariableValue(styles, '--vscode-terminalCursor-foreground') ?? foreground;
  const selectionBackground =
    readCssVariableValue(styles, '--vscode-terminal-selectionBackground') ??
    readCssVariableValue(styles, '--vscode-editor-selectionBackground') ??
    defaults.selectionBackground;
  const selectionForeground =
    readCssVariableValue(styles, '--vscode-terminal-selectionForeground') ?? foreground;
  const selectionInactiveBackground =
    readCssVariableValue(styles, '--vscode-terminal-inactiveSelectionBackground') ??
    selectionBackground;
  const cursorAccent = readCssVariableValue(styles, '--vscode-terminalCursor-background') ?? background;
  const fontFamily = readCssVariable(
    styles,
    '--vscode-editor-font-family',
    `'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace`
  );
  const theme: EmbeddedTerminalTheme = {
    background,
    foreground,
    cursor,
    cursorAccent,
    selectionBackground,
    selectionForeground,
    selectionInactiveBackground,
    black: readCssVariable(styles, '--vscode-terminal-ansiBlack', defaults.ansi.black),
    red: readCssVariable(styles, '--vscode-terminal-ansiRed', defaults.ansi.red),
    green: readCssVariable(styles, '--vscode-terminal-ansiGreen', defaults.ansi.green),
    yellow: readCssVariable(styles, '--vscode-terminal-ansiYellow', defaults.ansi.yellow),
    blue: readCssVariable(styles, '--vscode-terminal-ansiBlue', defaults.ansi.blue),
    magenta: readCssVariable(styles, '--vscode-terminal-ansiMagenta', defaults.ansi.magenta),
    cyan: readCssVariable(styles, '--vscode-terminal-ansiCyan', defaults.ansi.cyan),
    white: readCssVariable(styles, '--vscode-terminal-ansiWhite', defaults.ansi.white),
    brightBlack: readCssVariable(
      styles,
      '--vscode-terminal-ansiBrightBlack',
      defaults.ansi.brightBlack
    ),
    brightRed: readCssVariable(styles, '--vscode-terminal-ansiBrightRed', defaults.ansi.brightRed),
    brightGreen: readCssVariable(
      styles,
      '--vscode-terminal-ansiBrightGreen',
      defaults.ansi.brightGreen
    ),
    brightYellow: readCssVariable(
      styles,
      '--vscode-terminal-ansiBrightYellow',
      defaults.ansi.brightYellow
    ),
    brightBlue: readCssVariable(styles, '--vscode-terminal-ansiBrightBlue', defaults.ansi.brightBlue),
    brightMagenta: readCssVariable(
      styles,
      '--vscode-terminal-ansiBrightMagenta',
      defaults.ansi.brightMagenta
    ),
    brightCyan: readCssVariable(styles, '--vscode-terminal-ansiBrightCyan', defaults.ansi.brightCyan),
    brightWhite: readCssVariable(
      styles,
      '--vscode-terminal-ansiBrightWhite',
      defaults.ansi.brightWhite
    )
  };

  syncEmbeddedTerminalCssVariables({
    fontFamily,
    theme
  });

  return {
    fontFamily,
    theme
  };
}

function applyEmbeddedTerminalAppearance(
  terminal: Terminal,
  appearance: { fontFamily: string; theme: EmbeddedTerminalTheme } = readEmbeddedTerminalAppearance()
): void {
  terminal.options.fontFamily = appearance.fontFamily;
  terminal.options.theme = {
    ...appearance.theme
  };

  if (terminal.rows > 0) {
    terminal.refresh(0, terminal.rows - 1);
  }
}

function readWorkbenchThemeKind(): WorkbenchThemeKind {
  const body = document.body;
  const themeKind = body?.dataset.vscodeThemeKind;
  if (themeKind === 'vscode-high-contrast-light' || body?.classList.contains('vscode-high-contrast-light')) {
    return 'hcLight';
  }

  if (themeKind === 'vscode-high-contrast' || body?.classList.contains('vscode-high-contrast')) {
    return 'hcDark';
  }

  if (themeKind === 'vscode-light' || body?.classList.contains('vscode-light')) {
    return 'light';
  }

  if (themeKind === 'vscode-dark' || body?.classList.contains('vscode-dark')) {
    return 'dark';
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function readWorkbenchThemeStyles(): CSSStyleDeclaration {
  return getComputedStyle(document.body ?? document.documentElement);
}

function syncEmbeddedTerminalCssVariables(appearance: {
  fontFamily: string;
  theme: EmbeddedTerminalTheme;
}): void {
  document.documentElement.style.setProperty(
    EMBEDDED_TERMINAL_BACKGROUND_CSS_VAR,
    appearance.theme.background ?? ''
  );
  document.documentElement.style.setProperty(
    EMBEDDED_TERMINAL_FOREGROUND_CSS_VAR,
    appearance.theme.foreground ?? ''
  );
}

function createZoomAdjustedMouseEvent(
  event: Pick<MouseEvent, 'clientX' | 'clientY'>,
  element: HTMLElement,
  zoom: number
): Pick<MouseEvent, 'clientX' | 'clientY'> {
  const normalizedZoom = normalizeTerminalViewportZoom(zoom);
  if (Math.abs(normalizedZoom - 1) < 0.001) {
    return event;
  }

  const rect = element.getBoundingClientRect();
  return {
    clientX: rect.left + (event.clientX - rect.left) / normalizedZoom,
    clientY: rect.top + (event.clientY - rect.top) / normalizedZoom
  };
}

function normalizeTerminalViewportZoom(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function positionTextareaUnderScaledMouse(
  event: MouseEvent,
  terminal: Terminal,
  zoom: number
): void {
  const textarea = terminal.textarea;
  const screenElement = readXtermScreenElement(terminal);
  if (!textarea || !screenElement) {
    return;
  }

  const adjustedEvent = createZoomAdjustedMouseEvent(event, screenElement, zoom);
  const rect = screenElement.getBoundingClientRect();
  textarea.style.width = '20px';
  textarea.style.height = '20px';
  textarea.style.left = `${adjustedEvent.clientX - rect.left - 10}px`;
  textarea.style.top = `${adjustedEvent.clientY - rect.top - 10}px`;
  textarea.style.zIndex = '1000';
}

function readXtermScreenElement(terminal: Terminal): HTMLElement | null {
  return terminal.element?.querySelector<HTMLElement>('.xterm-screen') ?? null;
}

function readCssVariableValue(
  styles: CSSStyleDeclaration,
  variableName: string
): string | undefined {
  const value = styles.getPropertyValue(variableName).trim();
  return value.length > 0 ? value : undefined;
}

function readCssVariableChain(
  styles: CSSStyleDeclaration,
  variableNames: readonly string[]
): string | undefined {
  for (const variableName of variableNames) {
    const value = readCssVariableValue(styles, variableName);
    if (value) {
      return value;
    }
  }

  return undefined;
}

function readCssVariable(styles: CSSStyleDeclaration, variableName: string, fallback: string): string {
  return readCssVariableValue(styles, variableName) ?? fallback;
}

function formatExecutionNodeHelpTooltip(help: {
  title: string;
  items: readonly string[];
}): string {
  if (help.items.length === 0) {
    return help.title;
  }

  return `${help.title}：${help.items.map((item, index) => `${index + 1}. ${item}`).join('；')}`;
}

function resolveExecutionTerminalFileLinks(
  nodeId: string,
  kind: ExecutionNodeKind,
  candidates: ExecutionTerminalFileLinkCandidate[],
  priority: ExecutionTerminalFileLinkResolvePriority = 'interactive'
): Promise<ExecutionTerminalResolvedFileLink[]> {
  const requestId = `execution-file-links-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      pendingExecutionFileLinkResolutionRequests.delete(requestId);
      reject(new Error('Execution file link resolution timed out.'));
    }, 2500);

    pendingExecutionFileLinkResolutionRequests.set(requestId, {
      resolve,
      reject,
      timeout
    });

    postMessage({
      type: 'webview/resolveExecutionFileLinks',
      payload: {
        requestId,
        nodeId,
        kind,
        candidates,
        priority
      }
    });
  });
}

function resolvePendingExecutionFileLinkResolutionRequest(
  requestId: string,
  resolvedLinks: ExecutionTerminalResolvedFileLink[]
): void {
  const pendingRequest = pendingExecutionFileLinkResolutionRequests.get(requestId);
  if (!pendingRequest) {
    return;
  }

  window.clearTimeout(pendingRequest.timeout);
  pendingExecutionFileLinkResolutionRequests.delete(requestId);
  pendingRequest.resolve(resolvedLinks);
}

function rejectPendingExecutionFileLinkResolutionRequests(message: string): void {
  for (const [requestId, pendingRequest] of pendingExecutionFileLinkResolutionRequests.entries()) {
    window.clearTimeout(pendingRequest.timeout);
    pendingExecutionFileLinkResolutionRequests.delete(requestId);
    pendingRequest.reject(new Error(message));
  }
}

function copyExecutionSelection(
  nodeId: string,
  kind: ExecutionNodeKind,
  text: string,
  clearSelectionAfterCopy: boolean
): void {
  postMessage({
    type: 'webview/copyExecutionSelection',
    payload: {
      nodeId,
      kind,
      text,
      clearSelectionAfterCopy
    }
  });
}

function reportExecutionClipboardDiagnostic(
  payload: ExecutionTerminalClipboardDiagnosticPayload
): void {
  postMessage({
    type: 'webview/executionClipboardDiagnostic',
    payload
  });
}

function requestExecutionPaste(
  nodeId: string,
  kind: ExecutionNodeKind,
  bracketedPasteMode: boolean
): void {
  const requestId = `execution-paste-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  pendingExecutionPasteRequests.set(requestId, {
    nodeId,
    kind
  });

  postMessage({
    type: 'webview/requestExecutionPaste',
    payload: {
      requestId,
      nodeId,
      kind,
      bracketedPasteMode
    }
  });
}

function pasteExecutionImage(
  nodeId: string,
  kind: ExecutionNodeKind,
  image: ExecutionImagePasteData
): void {
  if (kind !== 'agent') {
    return;
  }

  const requestId = `execution-image-paste-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  pendingExecutionPasteRequests.set(requestId, {
    nodeId,
    kind
  });

  postMessage({
    type: 'webview/pasteExecutionImage',
    payload: {
      requestId,
      nodeId,
      kind,
      mimeType: image.mimeType,
      dataBase64: image.dataBase64,
      sizeBytes: image.sizeBytes,
      name: image.name
    }
  });
}

function routeExecutionPasteText(
  requestId: string,
  nodeId: string,
  kind: ExecutionNodeKind,
  text: string
): void {
  const pendingRequest = pendingExecutionPasteRequests.get(requestId);
  if (!pendingRequest || pendingRequest.nodeId !== nodeId || pendingRequest.kind !== kind) {
    return;
  }

  clearPendingExecutionPasteRequest(requestId, nodeId, kind);
  executionTerminalRegistry.get(nodeId)?.terminal.paste(text);
}

function clearPendingExecutionPasteRequest(
  requestId: string,
  nodeId: string,
  kind: ExecutionNodeKind
): void {
  const pendingRequest = pendingExecutionPasteRequests.get(requestId);
  if (!pendingRequest || pendingRequest.nodeId !== nodeId || pendingRequest.kind !== kind) {
    return;
  }

  pendingExecutionPasteRequests.delete(requestId);
}

function clearPendingExecutionPasteRequests(): void {
  pendingExecutionPasteRequests.clear();
}

function postMessage(message: WebviewToHostMessage): void {
  vscode.postMessage({
    ...message,
    lifecycle: webviewLifecycleIdentity
  });
}

function isCurrentWebviewLifecycleIdentity(lifecycle: WebviewLifecycleIdentity): boolean {
  return (
    lifecycle.surface === webviewLifecycleIdentity.surface &&
    lifecycle.mode === webviewLifecycleIdentity.mode &&
    lifecycle.generation === webviewLifecycleIdentity.generation &&
    (lifecycle.frameId === undefined || lifecycle.frameId === webviewLifecycleIdentity.frameId)
  );
}

function requiresHostMessageLifecycle(type: HostToWebviewMessage['type']): boolean {
  return type !== 'host/error' && type !== 'host/executionInputAck';
}

function emitWebviewLifecycleDiagnostic(message: string): void {
  emitRuntimeDiagnostic({
    source: 'webview.lifecycle',
    message,
    readyState: document.readyState
  });
}

function createWebviewLifecycleIdentity(hostLifecycle: WebviewLifecycleIdentity | undefined): WebviewLifecycleIdentity {
  return {
    ...(hostLifecycle ?? {
      surface: 'panel',
      mode: 'active',
      generation: 0
    }),
    frameId: createWebviewFrameId()
  };
}

function createWebviewFrameId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    return `frame-${cryptoApi.randomUUID()}`;
  }

  const randomParts =
    cryptoApi && typeof cryptoApi.getRandomValues === 'function'
      ? Array.from(cryptoApi.getRandomValues(new Uint32Array(2)), (value) => value.toString(36))
      : [Math.random().toString(36).slice(2), Math.random().toString(36).slice(2)];
  return `frame-${Date.now().toString(36)}-${randomParts.join('-')}`;
}

root.render(<App />);
