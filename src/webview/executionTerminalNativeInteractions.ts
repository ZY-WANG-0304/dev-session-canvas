import type {
  IBufferCell,
  IBufferLine,
  IBufferRange,
  ILink,
  ILinkDecorations,
  ILinkProvider,
  IDisposable,
  Terminal
} from '@xterm/xterm';
import LinkifyIt from 'linkify-it';

import type {
  CanvasRuntimeContext,
  ExecutionNodeKind,
  ExecutionTerminalClipboardDiagnosticPayload,
  ExecutionTerminalClipboardDiagnosticSource
} from '../common/protocol';
import {
  inferExecutionTerminalClipboardPlatform,
  resolveExecutionTerminalClipboardShortcut,
  type ExecutionTerminalClipboardPlatform
} from '../common/executionTerminalClipboard';
import {
  EXECUTION_TERMINAL_CJK_PUNCTUATION_CHARACTER_CLASS,
  detectExecutionTerminalFallbackPathLink,
  detectExecutionTerminalPathLinks,
  detectExecutionTerminalStyledPathLink,
  shouldSuppressExecutionTerminalWordLink,
  shouldAllowExecutionTerminalDetectedPathLink,
  type DetectedExecutionTerminalPathLink,
  type ExecutionTerminalFileLinkCandidate,
  type ExecutionTerminalDroppedResource,
  type ExecutionTerminalFileLinkResolvePriority,
  type ExecutionTerminalOpenLink,
  type ExecutionTerminalPathStyle,
  type ExecutionTerminalResolvedFileLink
} from '../common/executionTerminalLinks';
import {
  CODE_FILES_DATA_TRANSFER,
  RESOURCE_URLS_DATA_TRANSFER,
  URI_LIST_DATA_TRANSFER,
  hasPotentialDroppedResource,
  parseDroppedStringArray
} from './droppedResources';

interface ExecutionTerminalNativeInteractionsOptions {
  nodeId: string;
  kind: ExecutionNodeKind;
  terminal: Terminal;
  dropTarget: HTMLElement;
  getRuntimeContext: () => CanvasRuntimeContext;
  getPathStyle: () => ExecutionTerminalPathStyle;
  onDropResource: (
    nodeId: string,
    kind: ExecutionNodeKind,
    resource: ExecutionTerminalDroppedResource
  ) => void;
  onOpenLink: (
    nodeId: string,
    kind: ExecutionNodeKind,
    link: ExecutionTerminalOpenLink
  ) => void;
  onCopySelection: (
    nodeId: string,
    kind: ExecutionNodeKind,
    text: string,
    clearSelectionAfterCopy: boolean
  ) => void;
  onRequestPaste: (
    nodeId: string,
    kind: ExecutionNodeKind,
    bracketedPasteMode: boolean
  ) => void;
  onClipboardDiagnostic?: (payload: ExecutionTerminalClipboardDiagnosticPayload) => void;
  resolveFileLinks: (
    nodeId: string,
    kind: ExecutionNodeKind,
    candidates: ExecutionTerminalFileLinkCandidate[],
    priority?: ExecutionTerminalFileLinkResolvePriority
  ) => Promise<ExecutionTerminalResolvedFileLink[]>;
}

interface WrappedLineContext {
  startLine: number;
  endLine: number;
  lines: IBufferLine[];
  text: string;
}

interface StyledFileLinkCandidate {
  candidate: ExecutionTerminalFileLinkCandidate;
  bufferRange: IBufferRange;
}

interface HardWrappedFileLinkCandidate {
  candidate: ExecutionTerminalFileLinkCandidate;
  fragments: HardWrappedLinkFragment[];
}

interface HardWrappedLinkFragment {
  text: string;
  bufferRange: IBufferRange;
}

interface StyledTextSpan {
  text: string;
  signature: string;
  bufferRange: IBufferRange;
}

interface SimpleRange {
  startColumn: number;
  startLineNumber: number;
  endColumn: number;
  endLineNumber: number;
}

interface ActiveTooltipState {
  text: string;
  dispose: () => void;
}

interface TooltipController {
  show: (event: MouseEvent, label: string) => void;
  hide: () => void;
}

interface HardWrappedHoverOverlayController {
  show: (ranges: IBufferRange[]) => void;
  clear: () => void;
  dispose: () => void;
}

type ExecutionFileLinkResolutionCache = Map<
  string,
  ExecutionTerminalResolvedFileLink[] | Promise<ExecutionTerminalResolvedFileLink[]>
>;

interface ExecutionFileLinkResolutionCacheMetadata {
  negativeInvalidationGeneration: number;
  entries: Map<string, ExecutionFileLinkResolutionCacheEntryMetadata>;
  revalidateVisibleFileLinks?: (cacheKey: string) => void;
  scheduleRefreshAfterCurrent?: ScheduleExecutionNegativeFileLinkCacheRefresh;
  lastOutputInvalidationTime?: number;
}

interface ExecutionFileLinkResolutionCacheEntryMetadata {
  backgroundRefresh?: Promise<void>;
  backgroundRefreshGeneration?: number;
  candidates: ExecutionTerminalFileLinkCandidate[];
  bufferStartLine: number;
  bufferEndLine: number;
  needsRefreshAfterCurrent?: boolean;
  negativeInvalidationGeneration: number;
  priority?: ExecutionTerminalFileLinkResolvePriority;
}

type ScheduleExecutionNegativeFileLinkCacheRefresh = () => void;

type ExecutionClipboardDiagnosticEmitter = (
  source: ExecutionTerminalClipboardDiagnosticPayload['source'],
  readDetail?: () => Record<string, unknown>
) => void;

interface ExecutionFileLinkNegativeCacheInvalidationResult {
  invalidated: boolean;
  retryDelayMs?: number;
}

interface InteractionLinkOptions {
  lowConfidence?: boolean;
  hoverOverlayRanges?: IBufferRange[];
  hoverOverlayController?: HardWrappedHoverOverlayController;
  activate?: () => void | Promise<void>;
}

const EXECUTION_LINK_TOOLTIP_CLASS = 'execution-link-tooltip';
const EXECUTION_LINK_TOOLTIP_VISIBLE_CLASS = 'is-visible';
const EXECUTION_HARD_WRAPPED_LINK_HOVER_CLASS = 'execution-hard-wrapped-link-hover';
const EXECUTION_HARD_WRAPPED_LINK_HOVER_SEGMENT_CLASS = 'execution-hard-wrapped-link-hover-segment';
const DEFAULT_WORKBENCH_HOVER_DELAY = 500;
const EXECUTION_MAX_LINE_LENGTH = 2000;
const EXECUTION_MAX_RESOLVED_LINK_LENGTH = 1024;
const EXECUTION_MAX_RESOLVED_LINKS_PER_LINE = 10;
const EXECUTION_MULTILINE_LINK_MAX_LENGTH = 500;
const EXECUTION_LOCAL_LINK_MAX_LENGTH = 500;
const EXECUTION_URI_LINK_MAX_LENGTH = 2048;
const EXECUTION_WORD_LINK_MAX_LENGTH = 100;
const EXECUTION_HARD_WRAPPED_LINK_MAX_LINES = 4;
const EXECUTION_HARD_WRAPPED_LINK_CONTINUATION_MAX_PREFIX = 16;
const EXECUTION_NEGATIVE_FILE_LINK_CACHE_REFRESH_DELAY_MS = 200;
const EXECUTION_NEGATIVE_FILE_LINK_CACHE_OUTPUT_INVALIDATION_MIN_INTERVAL_MS = 1000;
const EXECUTION_CLIPBOARD_DIAGNOSTIC_SELECTION_SAMPLE_LIMIT = 120;
const EXECUTION_CLIPBOARD_DIAGNOSTIC_VISIBLE_LINE_LIMIT = 3;
const EXECUTION_CLIPBOARD_DIAGNOSTIC_VISIBLE_LINE_LENGTH_LIMIT = 160;
const EXECUTION_CLIPBOARD_DIAGNOSTIC_OSC52_BASE64_LIMIT = 2048;
const EXECUTION_CLIPBOARD_DIAGNOSTIC_OSC52_DECODED_PREVIEW_LIMIT = 120;
const EXECUTION_RESTORE_CLIPBOARD_DIAGNOSTIC_GRACE_FRAMES = 3;
const EXECUTION_RESTORE_SUPPRESSED_CLIPBOARD_DIAGNOSTIC_SOURCES: ReadonlySet<ExecutionTerminalClipboardDiagnosticSource> =
  new Set(['selectionChange', 'mouseTrackingMode', 'osc52']);
const FILE_LINK_LABEL = 'Open file in editor';
const FOCUS_DIRECTORY_LINK_LABEL = 'Focus folder in explorer';
const OPEN_DIRECTORY_LINK_LABEL = 'Open folder in new window';
const URL_LINK_LABEL = 'Follow link';
const executionFileLinkResolutionCacheMetadata = new WeakMap<
  ExecutionFileLinkResolutionCache,
  ExecutionFileLinkResolutionCacheMetadata
>();
const EXECUTION_URL_LINKIFY = new LinkifyIt()
  .set({
    fuzzyLink: false,
    fuzzyEmail: false,
    fuzzyIP: false
  })
  .add('vscode:', 'http:')
  .add('vscode-insiders:', 'http:');
const EXECUTION_MULTILINE_LINE_NUMBER_PREFIX_MATCHERS: RegExp[] = [
  /^ *(?<link>(?<line>\d+):(?<col>\d+)?)/
];
const EXECUTION_MULTILINE_GIT_DIFF_MATCHERS: RegExp[] = [
  /^(?<link>@@ .+ \+(?<toFileLine>\d+),(?<toFileCount>\d+) @@)/
];

interface XtermTerminalWithLinkProviders {
  _core?: {
    _linkProviderService?: {
      linkProviders?: ILinkProvider[];
    };
  };
}

export interface ExecutionTerminalNativeInteractionsHandle {
  activateLinkForTest(linkText: string): Promise<void>;
  hoverLinkForTest(linkText: string): Promise<void>;
  clearHoverForTest(): void;
  invalidateLinkResolutionCache(mode?: 'all' | 'negative' | 'negative-delayed'): void;
  beginSnapshotRestoreDiagnosticsSuppression(reason?: string): () => void;
  flushSnapshotRestoreDiagnosticsSuppression(): void;
  dispose(): void;
}

export function setupExecutionTerminalNativeInteractions(
  options: ExecutionTerminalNativeInteractionsOptions
): ExecutionTerminalNativeInteractionsHandle {
  const { terminal, dropTarget } = options;
  const fileLinkResolutionCache: ExecutionFileLinkResolutionCache = new Map();
  let tooltip: ActiveTooltipState | undefined;
  let hoveredLink: ILink | undefined;
  let tooltipTimer: number | undefined;
  let delayedNegativeCacheRefreshTimer: number | undefined;
  let trailingNegativeCacheRefreshTimer: number | undefined;
  const restoreSuppressionState = createExecutionClipboardRestoreSuppressionState();

  const clearDropTarget = (): void => {
    dropTarget.classList.remove('is-drop-target');
  };

  const setDropTarget = (): void => {
    dropTarget.classList.add('is-drop-target');
  };

  const clearTooltipTimer = (): void => {
    if (tooltipTimer !== undefined) {
      window.clearTimeout(tooltipTimer);
      tooltipTimer = undefined;
    }
  };

  const cancelDelayedNegativeCacheRefresh = (): void => {
    if (delayedNegativeCacheRefreshTimer !== undefined) {
      window.clearTimeout(delayedNegativeCacheRefreshTimer);
      delayedNegativeCacheRefreshTimer = undefined;
    }

    if (trailingNegativeCacheRefreshTimer !== undefined) {
      window.clearTimeout(trailingNegativeCacheRefreshTimer);
      trailingNegativeCacheRefreshTimer = undefined;
    }

  };

  const refreshNegativeFileLinkResolutionCacheNow = (): void => {
    cancelDelayedNegativeCacheRefresh();
    markExecutionFileLinkNegativeCacheInvalidated(fileLinkResolutionCache, 'immediate');
    refreshNegativeExecutionFileLinkResolutionCache(
      options,
      fileLinkResolutionCache,
      ensureNegativeFileLinkResolutionCacheRefresh
    );
  };

  const ensureNegativeFileLinkResolutionCacheRefresh = (
    delayMs = EXECUTION_NEGATIVE_FILE_LINK_CACHE_REFRESH_DELAY_MS
  ): void => {
    if (delayedNegativeCacheRefreshTimer !== undefined) {
      return;
    }

    delayedNegativeCacheRefreshTimer = window.setTimeout(() => {
      delayedNegativeCacheRefreshTimer = undefined;
      refreshNegativeExecutionFileLinkResolutionCache(
        options,
        fileLinkResolutionCache,
        ensureNegativeFileLinkResolutionCacheRefresh
      );
    }, delayMs);
  };

  const scheduleTrailingNegativeFileLinkResolutionCacheRefresh = (delayMs: number): void => {
    if (trailingNegativeCacheRefreshTimer !== undefined) {
      return;
    }

    trailingNegativeCacheRefreshTimer = window.setTimeout(() => {
      trailingNegativeCacheRefreshTimer = undefined;
      scheduleNegativeFileLinkResolutionCacheRefresh({ trailing: true });
    }, Math.max(0, delayMs));
  };

  const scheduleNegativeFileLinkResolutionCacheRefresh = (
    refreshOptions: { trailing?: boolean } = {}
  ): void => {
    if (!hasRefreshableNegativeExecutionFileLinkResolutionCacheEntry(fileLinkResolutionCache)) {
      return;
    }

    const invalidation = markExecutionFileLinkNegativeCacheInvalidated(
      fileLinkResolutionCache,
      'output'
    );
    if (!invalidation.invalidated) {
      scheduleTrailingNegativeFileLinkResolutionCacheRefresh(
        invalidation.retryDelayMs ??
          EXECUTION_NEGATIVE_FILE_LINK_CACHE_OUTPUT_INVALIDATION_MIN_INTERVAL_MS
      );
      return;
    }

    if (!refreshOptions.trailing && trailingNegativeCacheRefreshTimer !== undefined) {
      window.clearTimeout(trailingNegativeCacheRefreshTimer);
      trailingNegativeCacheRefreshTimer = undefined;
    }
    ensureNegativeFileLinkResolutionCacheRefresh(refreshOptions.trailing ? 0 : undefined);
  };
  const fileLinkCacheMetadata = getExecutionFileLinkResolutionCacheMetadata(fileLinkResolutionCache);
  fileLinkCacheMetadata.revalidateVisibleFileLinks = (cacheKey): void => {
    revalidateVisibleExecutionFileLinks(terminal, fileLinkResolutionCache, cacheKey);
  };
  fileLinkCacheMetadata.scheduleRefreshAfterCurrent =
    ensureNegativeFileLinkResolutionCacheRefresh;

  const hideTooltip = (): void => {
    clearTooltipTimer();
    tooltip?.dispose();
    tooltip = undefined;
  };

  const tooltipController: TooltipController = {
    show: (event, label): void => {
      hideTooltip();
      tooltipTimer = window.setTimeout(() => {
        tooltipTimer = undefined;
        tooltip = createExecutionLinkTooltip(event, label, options.getRuntimeContext());
      }, getExecutionTerminalHoverDelay());
    },
    hide: (): void => {
      hideTooltip();
    }
  };
  const hardWrappedHoverOverlayController = createHardWrappedHoverOverlayController(terminal);

  const clearHoveredLink = (): void => {
    hoveredLink = undefined;
    hardWrappedHoverOverlayController.clear();
    dispatchSyntheticLinkMouseLeaveEvent(terminal);
    hideTooltip();
  };

  const previousLinkHandler = terminal.options.linkHandler;
  terminal.options.linkHandler = createExplicitLinkHandler(options, tooltipController);
  const hardWrappedLinkProvider = createHardWrappedLinkProvider(
    options,
    fileLinkResolutionCache,
    tooltipController,
    hardWrappedHoverOverlayController
  );
  const multilineLinkProvider = createMultilineLinkProvider(options, fileLinkResolutionCache, tooltipController);
  const fileLinkProvider = createFileLinkProvider(options, fileLinkResolutionCache, tooltipController);
  const urlLinkProvider = createUrlLinkProvider(options, tooltipController);
  const wordLinkProvider = createWordLinkProvider(options, tooltipController);
  const hardWrappedLinkDisposable = terminal.registerLinkProvider(hardWrappedLinkProvider);
  const multilineLinkDisposable = terminal.registerLinkProvider(multilineLinkProvider);
  const fileLinkDisposable = terminal.registerLinkProvider(fileLinkProvider);
  const urlLinkDisposable = terminal.registerLinkProvider(urlLinkProvider);
  const wordLinkDisposable = terminal.registerLinkProvider(wordLinkProvider);
  const clipboardPlatform = detectExecutionTerminalClipboardPlatform();
  const emitClipboardDiagnostic = createExecutionClipboardDiagnosticEmitter(options, restoreSuppressionState);

  emitClipboardDiagnostic('environment', () => ({
    platform: clipboardPlatform,
    navigatorPlatform: window.navigator.platform,
    userAgent: window.navigator.userAgent,
    initialMouseTrackingMode: terminal.modes.mouseTrackingMode,
    initialBufferType: terminal.buffer.active.type
  }));

  const mouseModeDisposable = monitorExecutionTerminalMouseTrackingMode(
    terminal,
    emitClipboardDiagnostic
  );
  const selectionDiagnosticsDisposable = terminal.onSelectionChange(() => {
    emitClipboardDiagnostic('selectionChange', () => readExecutionSelectionDiagnosticDetail(terminal));
  });
  const osc52DiagnosticDisposable = terminal.parser.registerOscHandler(52, (data) => {
    emitClipboardDiagnostic('osc52', () => readExecutionOsc52DiagnosticDetail(data));
    return false;
  });

  terminal.attachCustomKeyEventHandler((event) => {
    if (event.type !== 'keydown') {
      return true;
    }

    const selection = terminal.getSelection();
    const action = resolveExecutionTerminalClipboardShortcut(clipboardPlatform, event, selection.length > 0);
    if (action !== 'passThrough' || isExecutionClipboardShortcutCandidate(clipboardPlatform, event)) {
      emitClipboardDiagnostic('shortcut', () => ({
        platform: clipboardPlatform,
        action,
        key: event.key,
        code: event.code,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        selectionLength: selection.length,
        hasSelection: selection.length > 0,
        mouseTrackingMode: terminal.modes.mouseTrackingMode,
        bufferType: terminal.buffer.active.type,
        bracketedPasteMode: terminal.modes.bracketedPasteMode,
        terminalHasFocus: terminal.textarea === document.activeElement,
        selectionPreview: summarizeExecutionDiagnosticText(
          selection,
          EXECUTION_CLIPBOARD_DIAGNOSTIC_SELECTION_SAMPLE_LIMIT
        )
      }));
    }
    if (action === 'passThrough') {
      return true;
    }

    event.preventDefault();
    event.stopPropagation();

    if (action === 'copy' || action === 'copyAndClearSelection') {
      if (selection.length > 0) {
        options.onCopySelection(
          options.nodeId,
          options.kind,
          selection,
          action === 'copyAndClearSelection'
        );
        if (action === 'copyAndClearSelection') {
          terminal.clearSelection();
        }
      }
      return false;
    }

    if (action === 'paste') {
      options.onRequestPaste(options.nodeId, options.kind, terminal.modes.bracketedPasteMode);
      return false;
    }

    return false;
  });

  const handleDragEnter = (event: DragEvent): void => {
    if (!hasPotentialDroppedResource(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setDropTarget();
  };

  const handleDragOver = (event: DragEvent): void => {
    if (!hasPotentialDroppedResource(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setDropTarget();
  };

  const handleDragLeave = (_event: DragEvent): void => {
    clearDropTarget();
  };

  const handleDrop = (event: DragEvent): void => {
    clearDropTarget();
    if (hasPotentialDroppedResource(event.dataTransfer)) {
      event.preventDefault();
      event.stopPropagation();
    }

    const resource = extractDroppedExecutionResource(event.dataTransfer);
    if (!resource) {
      return;
    }

    options.terminal.focus();
    options.onDropResource(options.nodeId, options.kind, resource);
  };

  const handleMouseDown = (event: MouseEvent): void => {
    if (event.button !== 0) {
      return;
    }

    const mouseTrackingMode = terminal.modes.mouseTrackingMode;
    if (mouseTrackingMode === 'none') {
      return;
    }

    emitClipboardDiagnostic('mouseSelection', () => ({
      phase: 'mousedown',
      button: event.button,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      mouseTrackingMode,
      bufferType: terminal.buffer.active.type,
      terminalHasFocus: terminal.textarea === document.activeElement,
      selectionLengthBefore: terminal.getSelection().length,
      forceSelectionLikely: event.shiftKey
    }));
  };

  const handleMouseUp = (event: MouseEvent): void => {
    if (event.button !== 0) {
      return;
    }

    const mouseTrackingMode = terminal.modes.mouseTrackingMode;
    if (mouseTrackingMode === 'none') {
      return;
    }

    emitClipboardDiagnostic('mouseSelection', () => ({
      phase: 'mouseup',
      button: event.button,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      mouseTrackingMode,
      bufferType: terminal.buffer.active.type,
      terminalHasFocus: terminal.textarea === document.activeElement,
      selectionLengthAfter: terminal.getSelection().length,
      selectionPreview: summarizeExecutionDiagnosticText(
        terminal.getSelection(),
        EXECUTION_CLIPBOARD_DIAGNOSTIC_SELECTION_SAMPLE_LIMIT
      ),
      forceSelectionLikely: event.shiftKey
    }));
  };

  const handleContextMenu = (event: MouseEvent): void => {
    emitClipboardDiagnostic('contextMenu', () => ({
      button: event.button,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      selectionLength: terminal.getSelection().length,
      hasSelection: terminal.getSelection().length > 0,
      mouseTrackingMode: terminal.modes.mouseTrackingMode,
      bufferType: terminal.buffer.active.type,
      terminalHasFocus: terminal.textarea === document.activeElement,
      selectionPreview: summarizeExecutionDiagnosticText(
        terminal.getSelection(),
        EXECUTION_CLIPBOARD_DIAGNOSTIC_SELECTION_SAMPLE_LIMIT
      ),
      visibleLinePreview: readExecutionTerminalVisibleLinePreview(terminal)
    }));
  };

  dropTarget.addEventListener('dragenter', handleDragEnter);
  dropTarget.addEventListener('dragover', handleDragOver);
  dropTarget.addEventListener('dragleave', handleDragLeave);
  dropTarget.addEventListener('dragend', handleDragLeave);
  dropTarget.addEventListener('drop', handleDrop);
  dropTarget.addEventListener('mousedown', handleMouseDown);
  dropTarget.addEventListener('mouseup', handleMouseUp);
  dropTarget.addEventListener('contextmenu', handleContextMenu);

  return {
    async activateLinkForTest(linkText: string): Promise<void> {
      const detectedLink = await findInteractionLinkByText(
        options,
        linkText,
        fileLinkResolutionCache,
        tooltipController
      );
      if (!detectedLink) {
        throw new Error(`Execution link "${linkText}" was not detected.`);
      }

      window.setTimeout(() => {
        detectedLink.activate(
          createSyntheticLinkActivationEvent(options.getRuntimeContext()),
          detectedLink.text
        );
      }, 0);
    },
    async hoverLinkForTest(linkText: string): Promise<void> {
      const detectedLink = await findInteractionLinkByText(
        options,
        linkText,
        fileLinkResolutionCache,
        tooltipController
      );
      if (!detectedLink) {
        throw new Error(`Execution link "${linkText}" was not detected.`);
      }

      if (!detectedLink.hover) {
        throw new Error(`Execution link "${linkText}" does not support hover interactions.`);
      }

      if (hoveredLink && hoveredLink.text !== detectedLink.text) {
        clearHoveredLink();
      }

      dispatchSyntheticLinkHoverEvent(terminal, detectedLink);
      hoveredLink = detectedLink;
    },
    clearHoverForTest(): void {
      clearHoveredLink();
    },
    invalidateLinkResolutionCache(mode = 'all'): void {
      if (mode === 'negative') {
        refreshNegativeFileLinkResolutionCacheNow();
        return;
      }

      if (mode === 'negative-delayed') {
        scheduleNegativeFileLinkResolutionCacheRefresh();
        return;
      }

      cancelDelayedNegativeCacheRefresh();
      markExecutionFileLinkNegativeCacheInvalidated(fileLinkResolutionCache, 'immediate');
      fileLinkResolutionCache.clear();
      getExecutionFileLinkResolutionCacheMetadata(fileLinkResolutionCache).entries.clear();
      // Keep the current hover alive while an execution session is still streaming output.
      // xterm's linkifier will revalidate hovered ranges on render; forcing a
      // synthetic mouseleave here makes links disappear during spinner redraws.
    },
    beginSnapshotRestoreDiagnosticsSuppression(reason = 'snapshot-restore'): () => void {
      return beginExecutionClipboardRestoreDiagnosticSuppression(
        options,
        restoreSuppressionState,
        reason
      );
    },
    flushSnapshotRestoreDiagnosticsSuppression(): void {
      flushPendingExecutionClipboardRestoreDiagnosticSuppression(options, restoreSuppressionState);
    },
    dispose(): void {
      clearHoveredLink();
      clearDropTarget();
      cancelDelayedNegativeCacheRefresh();
      cancelExecutionClipboardRestoreDiagnosticSuppression(options, restoreSuppressionState);
      terminal.options.linkHandler = previousLinkHandler;
      hardWrappedLinkDisposable.dispose();
      multilineLinkDisposable.dispose();
      fileLinkDisposable.dispose();
      urlLinkDisposable.dispose();
      wordLinkDisposable.dispose();
      mouseModeDisposable.dispose();
      selectionDiagnosticsDisposable.dispose();
      osc52DiagnosticDisposable.dispose();
      hardWrappedHoverOverlayController.dispose();
      terminal.attachCustomKeyEventHandler(() => true);
      dropTarget.removeEventListener('dragenter', handleDragEnter);
      dropTarget.removeEventListener('dragover', handleDragOver);
      dropTarget.removeEventListener('dragleave', handleDragLeave);
      dropTarget.removeEventListener('dragend', handleDragLeave);
      dropTarget.removeEventListener('drop', handleDrop);
      dropTarget.removeEventListener('mousedown', handleMouseDown);
      dropTarget.removeEventListener('mouseup', handleMouseUp);
      dropTarget.removeEventListener('contextmenu', handleContextMenu);
      fileLinkResolutionCache.clear();
      getExecutionFileLinkResolutionCacheMetadata(fileLinkResolutionCache).entries.clear();
    }
  };
}

function detectExecutionTerminalClipboardPlatform(): ExecutionTerminalClipboardPlatform {
  return inferExecutionTerminalClipboardPlatform({
    platform: window.navigator.platform,
    userAgent: window.navigator.userAgent
  });
}

function isExecutionClipboardShortcutCandidate(
  platform: ExecutionTerminalClipboardPlatform,
  event: KeyboardEvent
): boolean {
  if (event.altKey) {
    return false;
  }

  const key = event.key.trim().toLowerCase();
  const normalizedKey = key === 'keyc' || key === 'c' ? 'c' : key === 'keyv' || key === 'v' ? 'v' : key;
  if (normalizedKey !== 'c' && normalizedKey !== 'v') {
    return false;
  }

  if (platform === 'mac') {
    return event.metaKey && !event.ctrlKey && !event.shiftKey;
  }

  if (platform === 'windows') {
    return event.ctrlKey && !event.metaKey && (normalizedKey === 'v' || !event.shiftKey);
  }

  if (platform === 'linux') {
    return event.ctrlKey && event.shiftKey && !event.metaKey;
  }

  return Boolean(event.metaKey || (event.ctrlKey && event.shiftKey));
}

function createExecutionClipboardDiagnosticEmitter(
  options: ExecutionTerminalNativeInteractionsOptions,
  restoreSuppressionState: ExecutionClipboardRestoreSuppressionState
): ExecutionClipboardDiagnosticEmitter {
  return (source, readDetail): void => {
    if (!options.onClipboardDiagnostic) {
      return;
    }

    try {
      const restoreSuppressionActive =
        restoreSuppressionState.depth > 0 || restoreSuppressionState.releaseFrame !== undefined;
      if (restoreSuppressionActive && EXECUTION_RESTORE_SUPPRESSED_CLIPBOARD_DIAGNOSTIC_SOURCES.has(source)) {
        recordSuppressedExecutionClipboardDiagnostic(restoreSuppressionState, source);
        return;
      }

      options.onClipboardDiagnostic({
        nodeId: options.nodeId,
        kind: options.kind,
        source,
        detail: readDetail?.()
      });
    } catch {
      // Clipboard diagnostics must never affect terminal input, selection, or rendering.
    }
  };
}

interface ExecutionClipboardRestoreSuppressionState {
  depth: number;
  generation: number;
  reason: string;
  startedAtMs: number;
  suppressedCounts: Partial<Record<ExecutionTerminalClipboardDiagnosticSource, number>>;
  releaseFrame?: number;
}

function createExecutionClipboardRestoreSuppressionState(): ExecutionClipboardRestoreSuppressionState {
  return {
    depth: 0,
    generation: 0,
    reason: 'snapshot-restore',
    startedAtMs: 0,
    suppressedCounts: {}
  };
}

function beginExecutionClipboardRestoreDiagnosticSuppression(
  options: ExecutionTerminalNativeInteractionsOptions,
  state: ExecutionClipboardRestoreSuppressionState,
  reason: string
): () => void {
  if (state.depth === 0 && state.releaseFrame !== undefined) {
    cancelScheduledExecutionClipboardRestoreDiagnosticFlush(state);
    flushExecutionClipboardRestoreSuppressedDiagnostic(options, state);
  }
  if (state.depth === 0) {
    state.generation += 1;
    state.reason = reason;
    state.startedAtMs = readExecutionDiagnosticNow();
    state.suppressedCounts = {};
  }
  state.depth += 1;

  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    finishExecutionClipboardRestoreDiagnosticSuppression(options, state);
  };
}

function finishExecutionClipboardRestoreDiagnosticSuppression(
  options: ExecutionTerminalNativeInteractionsOptions,
  state: ExecutionClipboardRestoreSuppressionState
): void {
  state.depth = Math.max(0, state.depth - 1);
  if (state.depth > 0) {
    return;
  }

  cancelScheduledExecutionClipboardRestoreDiagnosticFlush(state);
  let remainingFrames = EXECUTION_RESTORE_CLIPBOARD_DIAGNOSTIC_GRACE_FRAMES;
  const scheduleNextReleaseFrame = (): void => {
    state.releaseFrame = window.requestAnimationFrame(() => {
      state.releaseFrame = undefined;
      if (state.depth > 0) {
        return;
      }
      remainingFrames -= 1;
      if (remainingFrames > 0) {
        scheduleNextReleaseFrame();
        return;
      }
      flushExecutionClipboardRestoreSuppressedDiagnostic(options, state);
    });
  };
  scheduleNextReleaseFrame();
}

function flushPendingExecutionClipboardRestoreDiagnosticSuppression(
  options: ExecutionTerminalNativeInteractionsOptions,
  state: ExecutionClipboardRestoreSuppressionState
): void {
  if (state.depth > 0) {
    return;
  }
  cancelScheduledExecutionClipboardRestoreDiagnosticFlush(state);
  flushExecutionClipboardRestoreSuppressedDiagnostic(options, state);
}

function cancelExecutionClipboardRestoreDiagnosticSuppression(
  options: ExecutionTerminalNativeInteractionsOptions,
  state: ExecutionClipboardRestoreSuppressionState
): void {
  state.depth = 0;
  flushPendingExecutionClipboardRestoreDiagnosticSuppression(options, state);
}

function cancelScheduledExecutionClipboardRestoreDiagnosticFlush(
  state: ExecutionClipboardRestoreSuppressionState
): void {
  if (state.releaseFrame !== undefined) {
    window.cancelAnimationFrame(state.releaseFrame);
    state.releaseFrame = undefined;
  }
}

function recordSuppressedExecutionClipboardDiagnostic(
  state: ExecutionClipboardRestoreSuppressionState,
  source: ExecutionTerminalClipboardDiagnosticSource
): void {
  state.suppressedCounts[source] = (state.suppressedCounts[source] ?? 0) + 1;
}

function flushExecutionClipboardRestoreSuppressedDiagnostic(
  options: ExecutionTerminalNativeInteractionsOptions,
  state: ExecutionClipboardRestoreSuppressionState
): void {
  const counts = Object.fromEntries(
    Object.entries(state.suppressedCounts).filter(([, count]) => typeof count === 'number' && count > 0)
  );
  const total = Object.values(counts).reduce(
    (sum, count) => sum + (typeof count === 'number' ? count : 0),
    0
  );
  if (total <= 0) {
    state.suppressedCounts = {};
    return;
  }

  try {
    options.onClipboardDiagnostic?.({
      nodeId: options.nodeId,
      kind: options.kind,
      source: 'restoreSuppressed',
      detail: {
        reason: state.reason,
        generation: state.generation,
        durationMs: Math.max(0, readExecutionDiagnosticNow() - state.startedAtMs),
        total,
        counts
      }
    });
  } catch {
    // Clipboard diagnostics must never affect terminal input, selection, or rendering.
  } finally {
    state.suppressedCounts = {};
  }
}

function readExecutionDiagnosticNow(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
}

function monitorExecutionTerminalMouseTrackingMode(
  terminal: Terminal,
  emitClipboardDiagnostic: ExecutionClipboardDiagnosticEmitter
): IDisposable {
  let previousMouseTrackingMode = terminal.modes.mouseTrackingMode;
  const disposable = terminal.onWriteParsed(() => {
    const mouseTrackingMode = terminal.modes.mouseTrackingMode;
    if (mouseTrackingMode === previousMouseTrackingMode) {
      return;
    }

    const previous = previousMouseTrackingMode;
    previousMouseTrackingMode = mouseTrackingMode;
    emitClipboardDiagnostic('mouseTrackingMode', () => ({
      previous,
      current: mouseTrackingMode,
      enabled: mouseTrackingMode !== 'none',
      bufferType: terminal.buffer.active.type,
      bracketedPasteMode: terminal.modes.bracketedPasteMode
    }));
  });

  return disposable;
}

function readExecutionSelectionDiagnosticDetail(terminal: Terminal): Record<string, unknown> {
  const selection = terminal.getSelection();
  return {
    selectionLength: selection.length,
    hasSelection: selection.length > 0,
    mouseTrackingMode: terminal.modes.mouseTrackingMode,
    bufferType: terminal.buffer.active.type,
    terminalHasFocus: terminal.textarea === document.activeElement,
    selectionPreview: summarizeExecutionDiagnosticText(
      selection,
      EXECUTION_CLIPBOARD_DIAGNOSTIC_SELECTION_SAMPLE_LIMIT
    )
  };
}

function readExecutionOsc52DiagnosticDetail(data: string): Record<string, unknown> {
  const separatorIndex = data.indexOf(';');
  const target = separatorIndex >= 0 ? data.slice(0, separatorIndex) : '';
  const payload = separatorIndex >= 0 ? data.slice(separatorIndex + 1) : data;
  const baseDetail: Record<string, unknown> = {
    payloadLength: data.length,
    target: summarizeExecutionDiagnosticText(target, 32),
    dataLength: payload.length
  };

  if (payload.length === 0) {
    return {
      ...baseDetail,
      dataKind: 'empty'
    };
  }

  if (payload === '?') {
    return {
      ...baseDetail,
      dataKind: 'query'
    };
  }

  const normalizedPayload = payload.replace(/\s+/g, '');
  const base64Like = /^[A-Za-z0-9+/]*={0,2}$/u.test(normalizedPayload);
  if (!base64Like) {
    return {
      ...baseDetail,
      dataKind: 'non-base64'
    };
  }

  const detail: Record<string, unknown> = {
    ...baseDetail,
    dataKind: 'base64',
    base64Length: normalizedPayload.length,
    base64TruncatedForDiagnostics:
      normalizedPayload.length > EXECUTION_CLIPBOARD_DIAGNOSTIC_OSC52_BASE64_LIMIT
  };

  if (normalizedPayload.length > EXECUTION_CLIPBOARD_DIAGNOSTIC_OSC52_BASE64_LIMIT) {
    return detail;
  }

  try {
    const binary = window.atob(normalizedPayload);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    const decodedText = new TextDecoder().decode(bytes);
    return {
      ...detail,
      decodedBytes: bytes.byteLength,
      decodedPreview: summarizeExecutionDiagnosticText(
        decodedText,
        EXECUTION_CLIPBOARD_DIAGNOSTIC_OSC52_DECODED_PREVIEW_LIMIT
      )
    };
  } catch (error) {
    return {
      ...detail,
      decodeError: error instanceof Error ? error.message : String(error)
    };
  }
}

function readExecutionTerminalVisibleLinePreview(terminal: Terminal): string[] {
  const startLine = Math.max(0, terminal.buffer.active.viewportY);
  const preview: string[] = [];
  for (let offset = 0; offset < EXECUTION_CLIPBOARD_DIAGNOSTIC_VISIBLE_LINE_LIMIT; offset += 1) {
    const line = terminal.buffer.active.getLine(startLine + offset);
    if (!line) {
      break;
    }
    preview.push(
      summarizeExecutionDiagnosticText(
        line.translateToString(true),
        EXECUTION_CLIPBOARD_DIAGNOSTIC_VISIBLE_LINE_LENGTH_LIMIT
      )
    );
  }

  return preview;
}

function summarizeExecutionDiagnosticText(text: string, limit: number): string {
  if (text.length <= limit) {
    return text;
  }

  return `${text.slice(0, Math.max(0, limit))}...`;
}

function createHardWrappedLinkProvider(
  options: ExecutionTerminalNativeInteractionsOptions,
  fileLinkResolutionCache: Map<
    string,
    ExecutionTerminalResolvedFileLink[] | Promise<ExecutionTerminalResolvedFileLink[]>
  >,
  tooltipController: TooltipController,
  hoverOverlayController: HardWrappedHoverOverlayController
): ILinkProvider {
  return {
    provideLinks(bufferLineNumber, callback): void {
      void collectHardWrappedLinksForBufferLine(
        options,
        bufferLineNumber,
        tooltipController,
        fileLinkResolutionCache,
        hoverOverlayController
      )
        .then((links) => {
          callback(links.length > 0 ? links : undefined);
        })
        .catch(() => {
          callback(undefined);
        });
    }
  };
}

function createFileLinkProvider(
  options: ExecutionTerminalNativeInteractionsOptions,
  fileLinkResolutionCache: Map<
    string,
    ExecutionTerminalResolvedFileLink[] | Promise<ExecutionTerminalResolvedFileLink[]>
  >,
  tooltipController: TooltipController
): ILinkProvider {
  return {
    provideLinks(bufferLineNumber, callback): void {
      const context = readWrappedLineContext(
        options.terminal,
        bufferLineNumber,
        EXECUTION_LOCAL_LINK_MAX_LENGTH
      );
      if (!context) {
        callback(undefined);
        return;
      }

      void collectFileLinks(options, context, tooltipController, fileLinkResolutionCache)
        .then((links) => {
          callback(links.length > 0 ? links : undefined);
        })
        .catch(() => {
          callback(undefined);
        });
    }
  };
}

function createUrlLinkProvider(
  options: ExecutionTerminalNativeInteractionsOptions,
  tooltipController: TooltipController
): ILinkProvider {
  return {
    provideLinks(bufferLineNumber, callback): void {
      const context = readWrappedLineContext(options.terminal, bufferLineNumber, EXECUTION_URI_LINK_MAX_LENGTH);
      if (!context) {
        callback(undefined);
        return;
      }

      const links = collectUrlLinks(options, context, tooltipController);
      callback(links.length > 0 ? links : undefined);
    }
  };
}

function createMultilineLinkProvider(
  options: ExecutionTerminalNativeInteractionsOptions,
  fileLinkResolutionCache: Map<
    string,
    ExecutionTerminalResolvedFileLink[] | Promise<ExecutionTerminalResolvedFileLink[]>
  >,
  tooltipController: TooltipController
): ILinkProvider {
  return {
    provideLinks(bufferLineNumber, callback): void {
      const context = readWrappedLineContext(
        options.terminal,
        bufferLineNumber,
        EXECUTION_MULTILINE_LINK_MAX_LENGTH
      );
      if (!context) {
        callback(undefined);
        return;
      }

      void collectMultilineLinks(options, context, tooltipController, fileLinkResolutionCache)
        .then((links) => {
          callback(links.length > 0 ? links : undefined);
        })
        .catch(() => {
          callback(undefined);
        });
    }
  };
}

function createWordLinkProvider(
  options: ExecutionTerminalNativeInteractionsOptions,
  tooltipController: TooltipController
): ILinkProvider {
  return {
    provideLinks(bufferLineNumber, callback): void {
      const context = readWrappedLineContext(options.terminal, bufferLineNumber, EXECUTION_WORD_LINK_MAX_LENGTH);
      if (!context) {
        callback(undefined);
        return;
      }

      const links = collectWordLinks(options, context, tooltipController);
      callback(links.length > 0 ? links : undefined);
    }
  };
}

function createExplicitLinkHandler(
  options: ExecutionTerminalNativeInteractionsOptions,
  tooltipController: TooltipController
): NonNullable<Terminal['options']['linkHandler']> {
  return {
    allowNonHttpProtocols: true,
    activate: (event, text, range): void => {
      if (!shouldActivateExecutionLink(options.getRuntimeContext(), event)) {
        return;
      }

      const link = parseExplicitExecutionTerminalLink(text, range.start.y - 1);
      if (!link) {
        return;
      }

      options.onOpenLink(options.nodeId, options.kind, link);
    },
    hover: (event, text, range): void => {
      const link = parseExplicitExecutionTerminalLink(text, range.start.y - 1);
      if (!link) {
        return;
      }

      tooltipController.show(event, link.linkKind === 'file' ? FILE_LINK_LABEL : URL_LINK_LABEL);
    },
    leave: (): void => {
      tooltipController.hide();
    }
  };
}

async function collectHardWrappedLinksForBufferLine(
  options: ExecutionTerminalNativeInteractionsOptions,
  bufferLineNumber: number,
  tooltipController: TooltipController,
  fileLinkResolutionCache: Map<
    string,
    ExecutionTerminalResolvedFileLink[] | Promise<ExecutionTerminalResolvedFileLink[]>
  >,
  hoverOverlayController: HardWrappedHoverOverlayController
): Promise<ILink[]> {
  const requestedLineIndex = bufferLineNumber - 1;
  const links: ILink[] = [];
  const seen = new Set<string>();

  const pushLinks = (nextLinks: ILink[]): void => {
    for (const link of nextLinks) {
      const key = `${link.text}:${link.range.start.x}:${link.range.start.y}:${link.range.end.x}:${link.range.end.y}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      links.push(link);
    }
  };

  for (let offset = 0; offset < EXECUTION_HARD_WRAPPED_LINK_MAX_LINES; offset += 1) {
    const startLineIndex = requestedLineIndex - offset;
    if (startLineIndex < 0) {
      break;
    }

    const context = readHardWrappedLineContext(options.terminal, startLineIndex);
    if (!context) {
      continue;
    }

    pushLinks(
      collectHardWrappedUrlLinks(
        options,
        context,
        requestedLineIndex,
        tooltipController,
        hoverOverlayController
      )
    );
    pushLinks(
      await collectHardWrappedStyledFileLinks(
        options,
        context,
        requestedLineIndex,
        tooltipController,
        fileLinkResolutionCache,
        hoverOverlayController
      )
    );
    if (links.length >= EXECUTION_MAX_RESOLVED_LINKS_PER_LINE) {
      break;
    }
  }

  return links.slice(0, EXECUTION_MAX_RESOLVED_LINKS_PER_LINE);
}

function collectHardWrappedUrlLinks(
  options: ExecutionTerminalNativeInteractionsOptions,
  context: WrappedLineContext,
  requestedLineIndex: number,
  tooltipController: TooltipController,
  hoverOverlayController: HardWrappedHoverOverlayController
): ILink[] {
  const firstLineText = getWrappedContextLineText(context, 0);
  if (!EXECUTION_URL_LINKIFY.pretest(firstLineText)) {
    return [];
  }

  const links: ILink[] = [];
  const matches = EXECUTION_URL_LINKIFY.match(firstLineText) ?? [];
  for (const match of matches) {
    if (match.lastIndex < firstLineText.length || !isPotentialHardWrappedUrlBreak(match.text)) {
      continue;
    }

    const fragments: HardWrappedLinkFragment[] = [
      {
        text: match.text,
        bufferRange: toSingleLineBufferRange(context.startLine, 0, match.index, match.lastIndex)
      }
    ];
    let fullText = match.text;

    for (let lineOffset = 1; lineOffset < context.lines.length; lineOffset += 1) {
      const continuation = readHardWrappedContinuationFragment(
        getWrappedContextLineText(context, lineOffset),
        context.startLine + lineOffset
      );
      if (!continuation) {
        break;
      }

      fullText += continuation.text;
      if (fullText.length > EXECUTION_URI_LINK_MAX_LENGTH) {
        break;
      }
      fragments.push(continuation);
    }

    if (fragments.length < 2 || fullText.length > EXECUTION_URI_LINK_MAX_LENGTH) {
      continue;
    }

    const parsed = parseHardWrappedUrl(fullText);
    if (!parsed) {
      continue;
    }

    const hoverOverlayRanges = fragments.map((entry) => entry.bufferRange);
    for (const fragment of fragments) {
      if (fragment.bufferRange.start.y !== requestedLineIndex + 1) {
        continue;
      }

      links.push(
        createBufferRangeInteractionLink(
          options,
          fullText,
          URL_LINK_LABEL,
          {
            linkKind: 'url',
            text: fullText,
            url: parsed.url,
            source: 'implicit'
          },
          tooltipController,
          fragment.bufferRange,
          {
            hoverOverlayController,
            hoverOverlayRanges
          }
        )
      );
    }
  }

  return links;
}

async function collectHardWrappedStyledFileLinks(
  options: ExecutionTerminalNativeInteractionsOptions,
  context: WrappedLineContext,
  requestedLineIndex: number,
  tooltipController: TooltipController,
  fileLinkResolutionCache: Map<
    string,
    ExecutionTerminalResolvedFileLink[] | Promise<ExecutionTerminalResolvedFileLink[]>
  >,
  hoverOverlayController: HardWrappedHoverOverlayController
): Promise<ILink[]> {
  const candidates = collectHardWrappedStyledFileLinkCandidates(
    options.terminal,
    context,
    options.getPathStyle()
  );
  if (candidates.length === 0) {
    return [];
  }

  const resolvedLinks = resolveCachedExecutionFileLinksForContext(
    context,
    candidates.map((entry) => entry.candidate),
    fileLinkResolutionCache
  );
  if (resolvedLinks === undefined) {
    const pendingCandidates = candidates.map((entry) => entry.candidate);
    return mapPendingHardWrappedFileLinksToInteractions(
      options,
      candidates,
      pendingCandidates,
      context,
      requestedLineIndex,
      tooltipController,
      hoverOverlayController,
      fileLinkResolutionCache
    );
  }

  return mapResolvedHardWrappedFileLinksToInteractions(
    options,
    candidates,
    resolvedLinks,
    requestedLineIndex,
    tooltipController,
    hoverOverlayController
  );
}

function collectHardWrappedStyledFileLinkCandidates(
  terminal: Terminal,
  context: WrappedLineContext,
  pathStyle: ExecutionTerminalPathStyle
): HardWrappedFileLinkCandidate[] {
  const candidates: HardWrappedFileLinkCandidate[] = [];
  const firstLineSpans = readStyledTextSpans(terminal, context.startLine);
  for (const firstSpan of firstLineSpans) {
    if (!isHardWrappedStartStyledSpan(context, firstSpan)) {
      continue;
    }

    const fragments: HardWrappedLinkFragment[] = [
      {
        text: firstSpan.text,
        bufferRange: firstSpan.bufferRange
      }
    ];
    let fullText = firstSpan.text;

    for (let lineOffset = 1; lineOffset < context.lines.length; lineOffset += 1) {
      const nextSpan = readHardWrappedContinuationStyledSpan(
        terminal,
        context.startLine + lineOffset,
        firstSpan.signature
      );
      if (!nextSpan) {
        break;
      }

      fullText += nextSpan.text;
      if (fullText.length > EXECUTION_MAX_RESOLVED_LINK_LENGTH) {
        break;
      }
      fragments.push({
        text: nextSpan.text,
        bufferRange: nextSpan.bufferRange
      });
    }

    if (fragments.length < 2 || fullText.length > EXECUTION_MAX_RESOLVED_LINK_LENGTH) {
      continue;
    }

    if (parseHardWrappedUrl(fullText)) {
      continue;
    }

    const detectedLink = detectExecutionTerminalPathLinks(fullText, pathStyle).find(
      (link) =>
        link.text === fullText &&
        !isNonFileUriLikePath(link.path) &&
        shouldAllowExecutionTerminalDetectedPathLink(link, pathStyle)
    );
    if (!detectedLink) {
      continue;
    }

    candidates.push({
      candidate: {
        candidateId: `hardwrap-styled:${context.startLine}:${fragments
          .map((fragment) =>
            [
              fragment.bufferRange.start.y,
              fragment.bufferRange.start.x,
              fragment.bufferRange.end.y,
              fragment.bufferRange.end.x
            ].join(':')
          )
          .join('|')}:${fullText}`,
        text: fullText,
        path: detectedLink.path,
        startIndex: 0,
        endIndexExclusive: fullText.length,
        bufferStartLine: context.startLine,
        line: detectedLink.line,
        column: detectedLink.column,
        lineEnd: detectedLink.lineEnd,
        columnEnd: detectedLink.columnEnd,
        source: 'hardwrap'
      },
      fragments
    });

    if (candidates.length >= EXECUTION_MAX_RESOLVED_LINKS_PER_LINE) {
      break;
    }
  }

  return candidates;
}

function isHardWrappedStartStyledSpan(context: WrappedLineContext, span: StyledTextSpan): boolean {
  const lineText = getWrappedContextLineText(context, 0);
  return lineText.slice(span.bufferRange.end.x).trim().length === 0;
}

function readHardWrappedContinuationStyledSpan(
  terminal: Terminal,
  lineIndex: number,
  signature: string
): StyledTextSpan | undefined {
  const lineText = terminal.buffer.active.getLine(lineIndex)?.translateToString(true) ?? '';
  const leadingWhitespace = lineText.match(/^\s*/)?.[0].length ?? 0;
  if (
    leadingWhitespace <= 0 ||
    leadingWhitespace > EXECUTION_HARD_WRAPPED_LINK_CONTINUATION_MAX_PREFIX
  ) {
    return undefined;
  }

  const span = readStyledTextSpans(terminal, lineIndex).find(
    (entry) => entry.signature === signature && entry.bufferRange.start.x === leadingWhitespace + 1
  );
  if (!span) {
    return undefined;
  }

  return span;
}

async function collectFileLinks(
  options: ExecutionTerminalNativeInteractionsOptions,
  context: WrappedLineContext,
  tooltipController: TooltipController,
  fileLinkResolutionCache: Map<
    string,
    ExecutionTerminalResolvedFileLink[] | Promise<ExecutionTerminalResolvedFileLink[]>
  >
): Promise<ILink[]> {
  const candidates = collectFileLinkCandidates(context, options.getPathStyle());
  if (candidates.length === 0) {
    return collectStyledFileLinks(options, context, tooltipController, fileLinkResolutionCache);
  }

  const directCandidates = candidates.filter((candidate) => candidate.source !== 'fallback');
  const fallbackCandidates = candidates.filter((candidate) => candidate.source === 'fallback');
  if (directCandidates.length > 0) {
    const resolvedDirectLinks = resolveCachedExecutionFileLinksForContext(
      context,
      directCandidates,
      fileLinkResolutionCache
    );
    if (resolvedDirectLinks === undefined) {
      return mapPendingFileLinksToInteractions(
        options,
        context,
        directCandidates,
        (candidate) => [candidate, ...fallbackCandidates],
        tooltipController,
        fileLinkResolutionCache
      );
    }

    if (resolvedDirectLinks.length > 0 || fallbackCandidates.length === 0) {
      return mapResolvedFileLinksToInteractions(
        options,
        context,
        directCandidates,
        resolvedDirectLinks,
        tooltipController
      );
    }
  }

  if (fallbackCandidates.length > 0) {
    const resolvedFallbackLinks = resolveCachedExecutionFileLinksForContext(
      context,
      fallbackCandidates,
      fileLinkResolutionCache
    );
    if (resolvedFallbackLinks === undefined) {
      return mapPendingFileLinksToInteractions(
        options,
        context,
        fallbackCandidates,
        undefined,
        tooltipController,
        fileLinkResolutionCache
      );
    }

    if (resolvedFallbackLinks.length > 0) {
      return mapResolvedFileLinksToInteractions(
        options,
        context,
        fallbackCandidates,
        resolvedFallbackLinks,
        tooltipController
      );
    }

    return collectStyledFileLinks(options, context, tooltipController, fileLinkResolutionCache);
  }

  return collectStyledFileLinks(options, context, tooltipController, fileLinkResolutionCache);
}

async function collectMultilineLinks(
  options: ExecutionTerminalNativeInteractionsOptions,
  context: WrappedLineContext,
  tooltipController: TooltipController,
  fileLinkResolutionCache: Map<
    string,
    ExecutionTerminalResolvedFileLink[] | Promise<ExecutionTerminalResolvedFileLink[]>
  >
): Promise<ILink[]> {
  const candidates = collectMultilineFileLinkCandidates(options.terminal, context);
  if (candidates.length === 0) {
    return [];
  }

  const resolvedLinks = resolveCachedExecutionFileLinksForContext(context, candidates, fileLinkResolutionCache);
  if (resolvedLinks === undefined) {
    return mapPendingFileLinksToInteractions(
      options,
      context,
      candidates,
      undefined,
      tooltipController,
      fileLinkResolutionCache
    );
  }

  return mapResolvedFileLinksToInteractions(
    options,
    context,
    candidates,
    resolvedLinks,
    tooltipController
  );
}

function collectMultilineFileLinkCandidates(
  terminal: Terminal,
  context: WrappedLineContext
): ExecutionTerminalFileLinkCandidate[] {
  if (context.text.length === 0 || context.text.length > EXECUTION_MAX_LINE_LENGTH) {
    return [];
  }

  for (const matcher of EXECUTION_MULTILINE_LINE_NUMBER_PREFIX_MATCHERS) {
    const match = context.text.match(matcher);
    const group = match?.groups;
    if (!group?.link || !group.line) {
      continue;
    }

    const path = findPreviousMultilinePath(terminal, context.startLine);
    if (!path) {
      continue;
    }

    const startIndex = context.text.indexOf(group.link);
    if (startIndex < 0) {
      continue;
    }

    return [
      {
        candidateId: `${context.startLine}:0:${context.text.length}:multiline:${group.link}`,
        text: group.link,
        path,
        startIndex: 0,
        endIndexExclusive: context.text.length,
        bufferStartLine: context.startLine,
        line: parseExecutionTerminalInt(group.line),
        column: parseExecutionTerminalInt(group.col),
        lineEnd: undefined,
        columnEnd: undefined,
        source: 'detected'
      }
    ];
  }

  for (const matcher of EXECUTION_MULTILINE_GIT_DIFF_MATCHERS) {
    const match = context.text.match(matcher);
    const group = match?.groups;
    if (!group?.link || !group.toFileLine) {
      continue;
    }

    const path = findPreviousGitDiffPath(terminal, context.startLine);
    if (!path) {
      continue;
    }

    const startIndex = context.text.indexOf(group.link);
    if (startIndex < 0) {
      continue;
    }

    const startLine = parseExecutionTerminalInt(group.toFileLine);
    const lineCount = parseExecutionTerminalInt(group.toFileCount);
    return [
      {
        candidateId: `${context.startLine}:${startIndex}:${group.link.length}:gitdiff:${group.link}`,
        text: group.link,
        path,
        startIndex,
        endIndexExclusive: startIndex + group.link.length,
        bufferStartLine: context.startLine,
        line: startLine,
        column: 1,
        lineEnd:
          startLine !== undefined && lineCount !== undefined ? startLine + Math.max(0, lineCount) : undefined,
        columnEnd: undefined,
        source: 'detected'
      }
    ];
  }

  return [];
}

function collectUrlLinks(
  options: ExecutionTerminalNativeInteractionsOptions,
  context: WrappedLineContext,
  tooltipController: TooltipController
): ILink[] {
  if (!EXECUTION_URL_LINKIFY.pretest(context.text)) {
    return [];
  }

  const links: ILink[] = [];
  const matches = EXECUTION_URL_LINKIFY.match(context.text) ?? [];
  for (const match of matches) {
    if (match.text.length > EXECUTION_URI_LINK_MAX_LENGTH) {
      continue;
    }
    links.push(
      createInteractionLink(
        options,
        context,
        match.text,
        URL_LINK_LABEL,
        {
          linkKind: 'url',
          text: match.text,
          url: match.url,
          source: 'implicit'
        },
        tooltipController,
        {
          startColumn: match.index + 1,
          startLineNumber: 1,
          endColumn: match.lastIndex + 1,
          endLineNumber: 1
        }
      )
    );
    if (links.length >= EXECUTION_MAX_RESOLVED_LINKS_PER_LINE) {
      break;
    }
  }

  return links;
}

function collectWordLinks(
  options: ExecutionTerminalNativeInteractionsOptions,
  context: WrappedLineContext,
  tooltipController: TooltipController
): ILink[] {
  if (context.text.length === 0 || context.text.length > EXECUTION_MAX_LINE_LENGTH) {
    return [];
  }

  const links: ILink[] = [];
  for (const range of readExecutionTerminalWordRanges(context.text, options.getRuntimeContext())) {
    if (
      range.text.length === 0 ||
      range.text.length > EXECUTION_WORD_LINK_MAX_LENGTH ||
      shouldSuppressExecutionTerminalWordLink(range.text)
    ) {
      continue;
    }

    links.push(
      createInteractionLink(
        options,
        context,
        range.text,
        undefined,
        {
          linkKind: 'search',
          text: range.text,
          searchText: range.text,
          contextLine: context.text,
          bufferStartLine: context.startLine,
          source: 'word'
        },
        tooltipController,
        {
          startColumn: range.startIndex + 1,
          startLineNumber: 1,
          endColumn: range.endIndexExclusive + 1,
          endLineNumber: 1
        },
        {
          lowConfidence: true
        }
      )
    );
    if (links.length >= EXECUTION_MAX_RESOLVED_LINKS_PER_LINE) {
      break;
    }
  }

  return links;
}

function readExecutionTerminalWordRanges(
  text: string,
  runtimeContext: CanvasRuntimeContext
): Array<{ text: string; startIndex: number; endIndexExclusive: number }> {
  const separatorRegex = createExecutionTerminalWordSeparatorRegex(runtimeContext.terminalWordSeparators);
  const splitWords = text.split(separatorRegex);
  const ranges: Array<{ text: string; startIndex: number; endIndexExclusive: number }> = [];
  let runningIndex = 0;
  for (const splitWord of splitWords) {
    let nextText = splitWord;
    let endIndexExclusive = runningIndex + splitWord.length;
    if (nextText.length > 0 && nextText.endsWith(':')) {
      nextText = nextText.slice(0, -1);
      endIndexExclusive -= 1;
    }
    ranges.push({
      text: nextText,
      startIndex: runningIndex,
      endIndexExclusive
    });
    runningIndex += splitWord.length + 1;
  }
  return ranges;
}

function createExecutionTerminalWordSeparatorRegex(wordSeparators: string): RegExp {
  let powerlineSymbols = '';
  for (let codePoint = 0xe0b0; codePoint <= 0xe0bf; codePoint += 1) {
    powerlineSymbols += String.fromCharCode(codePoint);
  }
  return new RegExp(
    `[${escapeExecutionTerminalWordSeparatorCharacters(wordSeparators)}${powerlineSymbols}${EXECUTION_TERMINAL_CJK_PUNCTUATION_CHARACTER_CLASS}]`,
    'g'
  );
}

function escapeExecutionTerminalWordSeparatorCharacters(value: string): string {
  return value.replace(/[|\\{}()[\]^$+*?.-]/g, '\\$&');
}

function collectFileLinkCandidates(
  context: WrappedLineContext,
  pathStyle: ExecutionTerminalPathStyle
): ExecutionTerminalFileLinkCandidate[] {
  const detectedCandidates = dedupeDetectedPathLinks(
    detectExecutionTerminalPathLinks(context.text, pathStyle)
  )
    .filter(
      (candidate) =>
        !isNonFileUriLikePath(candidate.path) &&
        candidate.path.length <= EXECUTION_MAX_RESOLVED_LINK_LENGTH &&
        shouldAllowExecutionTerminalDetectedPathLink(candidate, pathStyle)
    );

  const candidates: ExecutionTerminalFileLinkCandidate[] = [];
  for (const candidate of detectedCandidates) {
    candidates.push(toExecutionTerminalFileLinkCandidate(context, candidate, 'detected'));
  }

  const fallback = detectExecutionTerminalFallbackPathLink(context.text, {
    mode: 'interactive',
    pathStyle
  });
  if (
    fallback &&
    !isNonFileUriLikePath(fallback.path) &&
    fallback.path.length <= EXECUTION_MAX_RESOLVED_LINK_LENGTH
  ) {
    candidates.push(toExecutionTerminalFileLinkCandidate(context, fallback, 'fallback'));
  }

  return dedupeExecutionTerminalFileLinkCandidates(candidates).slice(0, EXECUTION_MAX_RESOLVED_LINKS_PER_LINE);
}

async function collectStyledFileLinks(
  options: ExecutionTerminalNativeInteractionsOptions,
  context: WrappedLineContext,
  tooltipController: TooltipController,
  fileLinkResolutionCache: Map<
    string,
    ExecutionTerminalResolvedFileLink[] | Promise<ExecutionTerminalResolvedFileLink[]>
  >
): Promise<ILink[]> {
  const styledCandidates = collectStyledFileLinkCandidates(
    options.terminal,
    context,
    options.getPathStyle()
  );
  if (styledCandidates.length === 0) {
    return [];
  }

  const resolvedLinks = resolveCachedExecutionFileLinksForContext(
    context,
    styledCandidates.map((entry) => entry.candidate),
    fileLinkResolutionCache
  );
  if (resolvedLinks === undefined) {
    const pendingCandidates = styledCandidates.map((entry) => entry.candidate);
    return mapPendingStyledFileLinksToInteractions(
      options,
      styledCandidates,
      pendingCandidates,
      context,
      tooltipController,
      fileLinkResolutionCache
    );
  }

  return mapResolvedStyledFileLinksToInteractions(
    options,
    styledCandidates,
    resolvedLinks,
    tooltipController
  );
}

function collectStyledFileLinkCandidates(
  terminal: Terminal,
  context: WrappedLineContext,
  pathStyle: ExecutionTerminalPathStyle
): StyledFileLinkCandidate[] {
  const ranges = readXtermRangesByAttr(terminal, context.startLine, context.endLine);
  const candidates: StyledFileLinkCandidate[] = [];
  for (const range of ranges) {
    let text = '';
    for (let lineIndex = range.start.y - 1; lineIndex <= range.end.y - 1; lineIndex += 1) {
      const line = terminal.buffer.active.getLine(lineIndex);
      if (!line) {
        break;
      }

      const lineStartX = lineIndex === range.start.y - 1 ? range.start.x - 1 : 0;
      const lineEndX = lineIndex === range.end.y - 1 ? range.end.x : terminal.cols - 1;
      text += line.translateToString(false, lineStartX, lineEndX);
    }

    if (
      text.trim().length === 0 ||
      text.length > EXECUTION_MAX_RESOLVED_LINK_LENGTH ||
      isNonFileUriLikePath(text)
    ) {
      continue;
    }

    const detectedLink = detectExecutionTerminalStyledPathLink(text, pathStyle);
    if (!detectedLink || isNonFileUriLikePath(detectedLink.path)) {
      continue;
    }

    candidates.push({
      candidate: {
        candidateId: `styled:${range.start.y}:${range.start.x}:${range.end.y}:${range.end.x}:${detectedLink.text}`,
        text: detectedLink.text,
        path: detectedLink.path,
        startIndex: detectedLink.startIndex,
        endIndexExclusive: detectedLink.endIndexExclusive,
        bufferStartLine: context.startLine,
        line: detectedLink.line,
        column: detectedLink.column,
        lineEnd: detectedLink.lineEnd,
        columnEnd: detectedLink.columnEnd,
        source: 'styled'
      },
      bufferRange: sliceBufferRangeByTextOffsets(range, detectedLink.startIndex, detectedLink.endIndexExclusive)
    });

    if (candidates.length >= EXECUTION_MAX_RESOLVED_LINKS_PER_LINE) {
      break;
    }
  }

  return candidates;
}

function sliceBufferRangeByTextOffsets(
  range: IBufferRange,
  startIndex: number,
  endIndexExclusive: number
): IBufferRange {
  if (range.start.y !== range.end.y) {
    return range;
  }

  return {
    start: {
      x: range.start.x + startIndex,
      y: range.start.y
    },
    end: {
      x: range.start.x + Math.max(startIndex, endIndexExclusive) - 1,
      y: range.end.y
    }
  };
}

function toExecutionTerminalFileLinkCandidate(
  context: WrappedLineContext,
  candidate: DetectedExecutionTerminalPathLink,
  source: ExecutionTerminalFileLinkCandidate['source']
): ExecutionTerminalFileLinkCandidate {
  return {
    candidateId: createExecutionTerminalFileLinkCandidateId(context, candidate, source),
    text: candidate.text,
    path: candidate.path,
    startIndex: candidate.startIndex,
    endIndexExclusive: candidate.endIndexExclusive,
    bufferStartLine: context.startLine,
    line: candidate.line,
    column: candidate.column,
    lineEnd: candidate.lineEnd,
    columnEnd: candidate.columnEnd,
    source
  };
}

function createExecutionTerminalFileLinkCandidateId(
  context: WrappedLineContext,
  candidate: DetectedExecutionTerminalPathLink,
  source: ExecutionTerminalFileLinkCandidate['source']
): string {
  return `${context.startLine}:${candidate.startIndex}:${candidate.endIndexExclusive}:${source}:${candidate.text}`;
}

async function resolveExecutionFileLinksForContext(
  options: ExecutionTerminalNativeInteractionsOptions,
  context: WrappedLineContext,
  candidates: ExecutionTerminalFileLinkCandidate[],
  fileLinkResolutionCache: ExecutionFileLinkResolutionCache,
  priority: ExecutionTerminalFileLinkResolvePriority = 'interactive'
): Promise<ExecutionTerminalResolvedFileLink[]> {
  const cacheKey = createExecutionFileLinkResolutionCacheKey(context, candidates);
  const cachedEntry = fileLinkResolutionCache.get(cacheKey);
  if (Array.isArray(cachedEntry)) {
    return cachedEntry;
  }

  if (cachedEntry) {
    const cachedMetadata = getExecutionFileLinkResolutionCacheMetadata(fileLinkResolutionCache)
      .entries.get(cacheKey);
    if (!(priority === 'interactive' && cachedMetadata?.priority === 'background')) {
      return cachedEntry;
    }
  }

  const cacheMetadata = getExecutionFileLinkResolutionCacheMetadata(fileLinkResolutionCache);
  const negativeInvalidationGeneration = cacheMetadata.negativeInvalidationGeneration;
  let request: Promise<ExecutionTerminalResolvedFileLink[]>;
  cacheMetadata.entries.set(cacheKey, {
    bufferEndLine: context.endLine,
    bufferStartLine: context.startLine,
    candidates,
    negativeInvalidationGeneration,
    priority
  });
  request = options
    .resolveFileLinks(options.nodeId, options.kind, candidates, priority)
    .then((resolvedLinks) => {
      if (fileLinkResolutionCache.get(cacheKey) !== request) {
        return resolvedLinks;
      }

      const staleNegativeResult =
        resolvedLinks.length === 0 &&
        negativeInvalidationGeneration !==
          getExecutionFileLinkNegativeInvalidationGeneration(fileLinkResolutionCache);
      if (staleNegativeResult) {
        fileLinkResolutionCache.set(cacheKey, resolvedLinks);
        trimExecutionFileLinkResolutionCache(fileLinkResolutionCache);
        void refreshNegativeExecutionFileLinkResolutionCacheEntry(
          options,
          fileLinkResolutionCache,
          cacheKey,
          cacheMetadata.scheduleRefreshAfterCurrent
        );
        return resolvedLinks;
      }

      fileLinkResolutionCache.set(cacheKey, resolvedLinks);
      trimExecutionFileLinkResolutionCache(fileLinkResolutionCache);
      return resolvedLinks;
    })
    .catch((error) => {
      if (fileLinkResolutionCache.get(cacheKey) === request) {
        fileLinkResolutionCache.delete(cacheKey);
        getExecutionFileLinkResolutionCacheMetadata(fileLinkResolutionCache).entries.delete(cacheKey);
      }
      throw error;
    });
  fileLinkResolutionCache.set(cacheKey, request);
  return request;
}

function resolveCachedExecutionFileLinksForContext(
  context: WrappedLineContext,
  candidates: ExecutionTerminalFileLinkCandidate[],
  fileLinkResolutionCache: ExecutionFileLinkResolutionCache
): ExecutionTerminalResolvedFileLink[] | undefined {
  const cachedEntry = fileLinkResolutionCache.get(
    createExecutionFileLinkResolutionCacheKey(context, candidates)
  );
  return Array.isArray(cachedEntry) ? cachedEntry : undefined;
}

function createExecutionFileLinkResolutionCacheKey(
  context: WrappedLineContext,
  candidates: ExecutionTerminalFileLinkCandidate[]
): string {
  return `${context.startLine}:${context.endLine}:${context.text}:${candidates
    .map((candidate) =>
      [
        candidate.candidateId,
        candidate.text,
        candidate.path,
        candidate.startIndex,
        candidate.endIndexExclusive,
        candidate.bufferStartLine,
        candidate.line ?? '',
        candidate.column ?? '',
        candidate.lineEnd ?? '',
        candidate.columnEnd ?? '',
        candidate.source
      ].join(':')
    )
    .join('|')}`;
}

function trimExecutionFileLinkResolutionCache(
  fileLinkResolutionCache: ExecutionFileLinkResolutionCache
): void {
  const maxEntries = 240;
  while (fileLinkResolutionCache.size > maxEntries) {
    const oldestKey = fileLinkResolutionCache.keys().next().value;
    if (typeof oldestKey !== 'string') {
      break;
    }

    fileLinkResolutionCache.delete(oldestKey);
    getExecutionFileLinkResolutionCacheMetadata(fileLinkResolutionCache).entries.delete(oldestKey);
  }
}

function refreshNegativeExecutionFileLinkResolutionCache(
  options: ExecutionTerminalNativeInteractionsOptions,
  fileLinkResolutionCache: ExecutionFileLinkResolutionCache,
  scheduleRefreshAfterCurrent?: ScheduleExecutionNegativeFileLinkCacheRefresh
): void {
  for (const [key, entry] of fileLinkResolutionCache.entries()) {
    if (Array.isArray(entry) && entry.length === 0) {
      void refreshNegativeExecutionFileLinkResolutionCacheEntry(
        options,
        fileLinkResolutionCache,
        key,
        scheduleRefreshAfterCurrent
      );
    }
  }
}

function hasRefreshableNegativeExecutionFileLinkResolutionCacheEntry(
  fileLinkResolutionCache: ExecutionFileLinkResolutionCache
): boolean {
  const cacheMetadata = getExecutionFileLinkResolutionCacheMetadata(fileLinkResolutionCache);
  for (const [cacheKey, entryMetadata] of cacheMetadata.entries) {
    if (!shouldRefreshNegativeExecutionFileLinkResolutionCacheEntry(entryMetadata)) {
      continue;
    }

    if (entryMetadata.backgroundRefresh) {
      return true;
    }

    const cachedEntry = fileLinkResolutionCache.get(cacheKey);
    if (cachedEntry && !Array.isArray(cachedEntry)) {
      return true;
    }

    if (Array.isArray(cachedEntry) && cachedEntry.length === 0) {
      return true;
    }
  }

  return false;
}

function refreshNegativeExecutionFileLinkResolutionCacheEntry(
  options: ExecutionTerminalNativeInteractionsOptions,
  fileLinkResolutionCache: ExecutionFileLinkResolutionCache,
  cacheKey: string,
  scheduleRefreshAfterCurrent?: ScheduleExecutionNegativeFileLinkCacheRefresh
): Promise<void> | undefined {
  const cacheMetadata = getExecutionFileLinkResolutionCacheMetadata(fileLinkResolutionCache);
  const entryMetadata = cacheMetadata.entries.get(cacheKey);
  if (!entryMetadata) {
    return undefined;
  }

  if (!shouldRefreshNegativeExecutionFileLinkResolutionCacheEntry(entryMetadata)) {
    return undefined;
  }

  if (entryMetadata.backgroundRefresh) {
    // Preserve the stable negative cache, but do not drop delayed invalidations
    // that arrive while an older background refresh is still resolving.
    if (
      entryMetadata.backgroundRefreshGeneration !== cacheMetadata.negativeInvalidationGeneration
    ) {
      entryMetadata.needsRefreshAfterCurrent = true;
    }

    return entryMetadata.backgroundRefresh;
  }

  const cachedEntry = fileLinkResolutionCache.get(cacheKey);
  if (!Array.isArray(cachedEntry) || cachedEntry.length !== 0) {
    return undefined;
  }

  const refreshGeneration = cacheMetadata.negativeInvalidationGeneration;
  entryMetadata.backgroundRefreshGeneration = refreshGeneration;
  entryMetadata.needsRefreshAfterCurrent = false;
  let refreshRequest: Promise<void>;
  refreshRequest = options
    .resolveFileLinks(options.nodeId, options.kind, entryMetadata.candidates, 'background')
    .then((resolvedLinks) => {
      const latestEntry = fileLinkResolutionCache.get(cacheKey);
      if (!Array.isArray(latestEntry) || latestEntry.length !== 0) {
        return;
      }

      entryMetadata.negativeInvalidationGeneration = refreshGeneration;
      if (resolvedLinks.length > 0) {
        fileLinkResolutionCache.set(cacheKey, resolvedLinks);
        trimExecutionFileLinkResolutionCache(fileLinkResolutionCache);
        cacheMetadata.revalidateVisibleFileLinks?.(cacheKey);
      }
    })
    .catch(() => undefined)
    .finally(() => {
      if (entryMetadata.backgroundRefresh === refreshRequest) {
        entryMetadata.backgroundRefresh = undefined;
        entryMetadata.backgroundRefreshGeneration = undefined;
        const latestEntry = fileLinkResolutionCache.get(cacheKey);
        const staleRefreshGeneration =
          refreshGeneration !== cacheMetadata.negativeInvalidationGeneration;
        const shouldRefreshAfterCurrent =
          (entryMetadata.needsRefreshAfterCurrent || staleRefreshGeneration) &&
          Array.isArray(latestEntry) &&
          latestEntry.length === 0;
        entryMetadata.needsRefreshAfterCurrent = false;
        if (shouldRefreshAfterCurrent) {
          // Re-enter the shared refresh window instead of retrying immediately;
          // later output can still be coalesced into the same negative refresh.
          const refreshScheduler =
            scheduleRefreshAfterCurrent ?? cacheMetadata.scheduleRefreshAfterCurrent;
          refreshScheduler?.();
        }
      }
    });
  entryMetadata.backgroundRefresh = refreshRequest;
  return refreshRequest;
}

function shouldRefreshNegativeExecutionFileLinkResolutionCacheEntry(
  entryMetadata: ExecutionFileLinkResolutionCacheEntryMetadata
): boolean {
  return entryMetadata.candidates.some((candidate) => candidate.source !== 'fallback');
}

function getExecutionFileLinkResolutionCacheMetadata(
  fileLinkResolutionCache: ExecutionFileLinkResolutionCache
): ExecutionFileLinkResolutionCacheMetadata {
  let metadata = executionFileLinkResolutionCacheMetadata.get(fileLinkResolutionCache);
  if (!metadata) {
    metadata = {
      entries: new Map(),
      negativeInvalidationGeneration: 0
    };
    executionFileLinkResolutionCacheMetadata.set(fileLinkResolutionCache, metadata);
  }

  return metadata;
}

function getExecutionFileLinkNegativeInvalidationGeneration(
  fileLinkResolutionCache: ExecutionFileLinkResolutionCache
): number {
  return getExecutionFileLinkResolutionCacheMetadata(fileLinkResolutionCache)
    .negativeInvalidationGeneration;
}

function markExecutionFileLinkNegativeCacheInvalidated(
  fileLinkResolutionCache: ExecutionFileLinkResolutionCache,
  reason: 'immediate' | 'output'
): ExecutionFileLinkNegativeCacheInvalidationResult {
  const metadata = getExecutionFileLinkResolutionCacheMetadata(fileLinkResolutionCache);
  if (reason === 'output') {
    const now = Date.now();
    const hasActiveBackgroundRefresh = Array.from(metadata.entries.values()).some(
      (entry) => entry.backgroundRefresh
    );
    if (
      metadata.lastOutputInvalidationTime !== undefined &&
      now - metadata.lastOutputInvalidationTime <
        EXECUTION_NEGATIVE_FILE_LINK_CACHE_OUTPUT_INVALIDATION_MIN_INTERVAL_MS &&
      !hasActiveBackgroundRefresh
    ) {
      return {
        invalidated: false,
        retryDelayMs:
          EXECUTION_NEGATIVE_FILE_LINK_CACHE_OUTPUT_INVALIDATION_MIN_INTERVAL_MS -
          (now - metadata.lastOutputInvalidationTime)
      };
    }

    metadata.lastOutputInvalidationTime = now;
  } else {
    metadata.lastOutputInvalidationTime = undefined;
  }

  metadata.negativeInvalidationGeneration += 1;
  return { invalidated: true };
}

function revalidateVisibleExecutionFileLinks(
  terminal: Terminal,
  fileLinkResolutionCache: ExecutionFileLinkResolutionCache,
  cacheKey: string
): void {
  const entryMetadata = getExecutionFileLinkResolutionCacheMetadata(fileLinkResolutionCache)
    .entries.get(cacheKey);
  if (!entryMetadata) {
    return;
  }

  const viewportStartLine = terminal.buffer.active.viewportY;
  const viewportEndLine = viewportStartLine + terminal.rows - 1;
  const startLine = Math.max(entryMetadata.bufferStartLine, viewportStartLine);
  const endLine = Math.min(entryMetadata.bufferEndLine, viewportEndLine);
  if (endLine < startLine) {
    return;
  }

  terminal.refresh(startLine - viewportStartLine, endLine - viewportStartLine);
}

function mapResolvedFileLinksToInteractions(
  options: ExecutionTerminalNativeInteractionsOptions,
  context: WrappedLineContext,
  candidates: ExecutionTerminalFileLinkCandidate[],
  resolvedLinks: ExecutionTerminalResolvedFileLink[],
  tooltipController: TooltipController
): ILink[] {
  const candidatesById = new Map(candidates.map((candidate) => [candidate.candidateId, candidate]));
  const links: ILink[] = [];
  for (const resolvedLink of resolvedLinks) {
    const candidate = candidatesById.get(resolvedLink.candidateId);
    if (!candidate) {
      continue;
    }

    links.push(
      createInteractionLink(
        options,
        context,
        resolvedLink.link.text,
        labelForResolvedFileLink(resolvedLink.link.targetKind),
        resolvedLink.link,
        tooltipController,
        {
          startColumn: candidate.startIndex + 1,
          startLineNumber: 1,
          endColumn: candidate.endIndexExclusive + 1,
          endLineNumber: 1
        }
      )
    );
  }

  return links;
}

function mapPendingFileLinksToInteractions(
  options: ExecutionTerminalNativeInteractionsOptions,
  context: WrappedLineContext,
  candidates: ExecutionTerminalFileLinkCandidate[],
  resolveCandidatesForCandidate:
    | ((candidate: ExecutionTerminalFileLinkCandidate) => ExecutionTerminalFileLinkCandidate[])
    | undefined,
  tooltipController: TooltipController,
  fileLinkResolutionCache: ExecutionFileLinkResolutionCache
): ILink[] {
  const links: ILink[] = [];
  for (const candidate of candidates) {
    links.push(
      createPendingFileResolveInteractionLink(
        options,
        candidate.text,
        convertLinkRangeToBuffer(
          context.lines,
          options.terminal.cols,
          {
            startColumn: candidate.startIndex + 1,
            startLineNumber: 1,
            endColumn: candidate.endIndexExclusive + 1,
            endLineNumber: 1
          },
          context.startLine
        ),
        resolveCandidatesForCandidate?.(candidate) ?? [candidate],
        context,
        tooltipController,
        fileLinkResolutionCache
      )
    );
    if (links.length >= EXECUTION_MAX_RESOLVED_LINKS_PER_LINE) {
      break;
    }
  }

  return links;
}

function mapResolvedStyledFileLinksToInteractions(
  options: ExecutionTerminalNativeInteractionsOptions,
  candidates: StyledFileLinkCandidate[],
  resolvedLinks: ExecutionTerminalResolvedFileLink[],
  tooltipController: TooltipController
): ILink[] {
  const candidatesById = new Map(candidates.map((candidate) => [candidate.candidate.candidateId, candidate]));
  const links: ILink[] = [];
  for (const resolvedLink of resolvedLinks) {
    const candidate = candidatesById.get(resolvedLink.candidateId);
    if (!candidate) {
      continue;
    }

    links.push(
      createBufferRangeInteractionLink(
        options,
        resolvedLink.link.text,
        labelForResolvedFileLink(resolvedLink.link.targetKind),
        resolvedLink.link,
        tooltipController,
        candidate.bufferRange
      )
    );
  }

  return links;
}

function mapPendingStyledFileLinksToInteractions(
  options: ExecutionTerminalNativeInteractionsOptions,
  candidates: StyledFileLinkCandidate[],
  fileLinkCandidates: ExecutionTerminalFileLinkCandidate[],
  context: WrappedLineContext,
  tooltipController: TooltipController,
  fileLinkResolutionCache: ExecutionFileLinkResolutionCache
): ILink[] {
  return candidates.map((candidate) =>
    createPendingFileResolveInteractionLink(
      options,
      candidate.candidate.text,
      candidate.bufferRange,
      fileLinkCandidates,
      context,
      tooltipController,
      fileLinkResolutionCache
    )
  );
}

function mapResolvedHardWrappedFileLinksToInteractions(
  options: ExecutionTerminalNativeInteractionsOptions,
  candidates: HardWrappedFileLinkCandidate[],
  resolvedLinks: ExecutionTerminalResolvedFileLink[],
  requestedLineIndex: number,
  tooltipController: TooltipController,
  hoverOverlayController: HardWrappedHoverOverlayController
): ILink[] {
  const candidatesById = new Map(candidates.map((candidate) => [candidate.candidate.candidateId, candidate]));
  const links: ILink[] = [];
  for (const resolvedLink of resolvedLinks) {
    const candidate = candidatesById.get(resolvedLink.candidateId);
    if (!candidate) {
      continue;
    }

    for (const fragment of candidate.fragments) {
      if (fragment.bufferRange.start.y !== requestedLineIndex + 1) {
        continue;
      }

      const hoverOverlayRanges = candidate.fragments.map((entry) => entry.bufferRange);
      links.push(
        createBufferRangeInteractionLink(
          options,
          resolvedLink.link.text,
          labelForResolvedFileLink(resolvedLink.link.targetKind),
          resolvedLink.link,
          tooltipController,
          fragment.bufferRange,
          {
            hoverOverlayController,
            hoverOverlayRanges
          }
        )
      );
    }
  }

  return links;
}

function mapPendingHardWrappedFileLinksToInteractions(
  options: ExecutionTerminalNativeInteractionsOptions,
  candidates: HardWrappedFileLinkCandidate[],
  fileLinkCandidates: ExecutionTerminalFileLinkCandidate[],
  context: WrappedLineContext,
  requestedLineIndex: number,
  tooltipController: TooltipController,
  hoverOverlayController: HardWrappedHoverOverlayController,
  fileLinkResolutionCache: ExecutionFileLinkResolutionCache
): ILink[] {
  const links: ILink[] = [];
  for (const candidate of candidates) {
    for (const fragment of candidate.fragments) {
      if (fragment.bufferRange.start.y !== requestedLineIndex + 1) {
        continue;
      }

      const hoverOverlayRanges = candidate.fragments.map((entry) => entry.bufferRange);
      links.push(
        createPendingFileResolveInteractionLink(
          options,
          candidate.candidate.text,
          fragment.bufferRange,
          fileLinkCandidates,
          context,
          tooltipController,
          fileLinkResolutionCache,
          {
            hoverOverlayController,
            hoverOverlayRanges
          }
        )
      );
    }
  }

  return links;
}

function createPendingFileResolveInteractionLink(
  options: ExecutionTerminalNativeInteractionsOptions,
  text: string,
  bufferRange: IBufferRange,
  candidates: ExecutionTerminalFileLinkCandidate[],
  context: WrappedLineContext,
  tooltipController: TooltipController,
  fileLinkResolutionCache: ExecutionFileLinkResolutionCache,
  linkOptions?: Pick<InteractionLinkOptions, 'hoverOverlayController' | 'hoverOverlayRanges'>
): ILink {
  return createBufferRangeInteractionLink(
    options,
    text,
    FILE_LINK_LABEL,
    {
      linkKind: 'search',
      text,
      searchText: text,
      contextLine: context.text,
      bufferStartLine: context.startLine,
      source: 'word'
    },
    tooltipController,
    bufferRange,
    {
      ...linkOptions,
      activate: async (): Promise<void> => {
        const resolvedLinks = await resolveExecutionFileLinksForContext(
          options,
          context,
          candidates,
          fileLinkResolutionCache,
          'interactive'
        ).catch(() => []);
        const resolvedLink = resolvedLinks.find((link) => link.link.text === text) ?? resolvedLinks[0];
        if (resolvedLink) {
          options.onOpenLink(options.nodeId, options.kind, resolvedLink.link);
          return;
        }

        options.onOpenLink(options.nodeId, options.kind, {
          linkKind: 'search',
          text,
          searchText: text,
          contextLine: context.text,
          bufferStartLine: context.startLine,
          source: 'word'
        });
      }
    }
  );
}

function labelForResolvedFileLink(
  targetKind: ExecutionTerminalResolvedFileLink['link']['targetKind']
): string {
  if (targetKind === 'directory-in-workspace') {
    return FOCUS_DIRECTORY_LINK_LABEL;
  }

  if (targetKind === 'directory-outside-workspace') {
    return OPEN_DIRECTORY_LINK_LABEL;
  }

  return FILE_LINK_LABEL;
}

function parseExplicitExecutionTerminalLink(
  text: string,
  bufferStartLine: number
): ExecutionTerminalOpenLink | undefined {
  try {
    const uri = new URL(text);
    if (uri.protocol === 'file:') {
      return {
        linkKind: 'file',
        text,
        path: uri.toString(),
        bufferStartLine,
        source: 'explicit-uri'
      };
    }

    return {
      linkKind: 'url',
      text,
      url: uri.toString(),
      source: 'explicit'
    };
  } catch {
    return undefined;
  }
}

function findPreviousMultilinePath(terminal: Terminal, startLine: number): string | undefined {
  for (let lineIndex = startLine - 1; lineIndex >= 0; lineIndex -= 1) {
    const line = terminal.buffer.active.getLine(lineIndex);
    if (!line || line.isWrapped) {
      continue;
    }
    const text = getXtermLineContent(terminal, lineIndex, lineIndex);
    if (!text.match(/^\s*\d/)) {
      return text.length > 0 ? text : undefined;
    }
  }
  return undefined;
}

function findPreviousGitDiffPath(terminal: Terminal, startLine: number): string | undefined {
  for (let lineIndex = startLine - 1; lineIndex >= 0; lineIndex -= 1) {
    const line = terminal.buffer.active.getLine(lineIndex);
    if (!line || line.isWrapped) {
      continue;
    }
    const text = getXtermLineContent(terminal, lineIndex, lineIndex);
    const match = text.match(/\+\+\+ b\/(?<path>.+)/);
    const path = match?.groups?.path?.trim();
    if (path) {
      return path;
    }
  }
  return undefined;
}

function parseExecutionTerminalInt(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isNonFileUriLikePath(pathValue: string): boolean {
  if (pathValue.startsWith('file://')) {
    return false;
  }

  if (/^[a-zA-Z]:[\\/]/.test(pathValue) || pathValue.startsWith('\\\\')) {
    return false;
  }

  return /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(pathValue);
}

function dedupeExecutionTerminalFileLinkCandidates(
  candidates: ExecutionTerminalFileLinkCandidate[]
): ExecutionTerminalFileLinkCandidate[] {
  const seen = new Set<string>();
  const deduped: ExecutionTerminalFileLinkCandidate[] = [];
  for (const candidate of candidates) {
    const key = [
      candidate.startIndex,
      candidate.endIndexExclusive,
      candidate.bufferStartLine,
      candidate.source,
      candidate.path,
      candidate.line,
      candidate.column,
      candidate.lineEnd,
      candidate.columnEnd
    ].join(':');
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(candidate);
  }

  return deduped;
}

function createInteractionLink(
  options: ExecutionTerminalNativeInteractionsOptions,
  context: WrappedLineContext,
  text: string,
  hoverLabel: string | undefined,
  link: ExecutionTerminalOpenLink,
  tooltipController: TooltipController,
  range: SimpleRange,
  linkOptions?: InteractionLinkOptions
): ILink {
  const xtermRange = convertLinkRangeToBuffer(context.lines, options.terminal.cols, range, context.startLine);
  return createBufferRangeInteractionLink(
    options,
    text,
    hoverLabel,
    link,
    tooltipController,
    xtermRange,
    linkOptions
  );
}

function createBufferRangeInteractionLink(
  options: ExecutionTerminalNativeInteractionsOptions,
  text: string,
  hoverLabel: string | undefined,
  link: ExecutionTerminalOpenLink,
  tooltipController: TooltipController,
  xtermRange: IBufferRange,
  linkOptions?: InteractionLinkOptions
): ILink {
  const lowConfidence = linkOptions?.lowConfidence === true;
  const usesGroupedHoverOverlay =
    !lowConfidence &&
    linkOptions?.hoverOverlayController !== undefined &&
    (linkOptions.hoverOverlayRanges?.length ?? 0) > 1;
  let interactionLink: ILink | undefined;
  const lowConfidenceDecorations = lowConfidence
    ? createLowConfidenceExecutionLinkDecorations(options.getRuntimeContext, () => interactionLink?.decorations)
    : undefined;
  interactionLink = {
    text,
    range: xtermRange,
    decorations: lowConfidenceDecorations?.decorations ?? (usesGroupedHoverOverlay
      ? {
          pointerCursor: true,
          underline: false
        }
      : undefined),
    activate: (event): void => {
      if (!shouldActivateExecutionLink(options.getRuntimeContext(), event)) {
        return;
      }

      if (linkOptions?.activate) {
        void Promise.resolve(linkOptions.activate());
        return;
      }

      options.onOpenLink(options.nodeId, options.kind, link);
    },
    hover: (event): void => {
      lowConfidenceDecorations?.hover(event);
      if (usesGroupedHoverOverlay && linkOptions.hoverOverlayRanges) {
        linkOptions.hoverOverlayController?.show(linkOptions.hoverOverlayRanges);
      }
      if (!lowConfidence && hoverLabel) {
        tooltipController.show(event, hoverLabel);
        return;
      }

      tooltipController.hide();
    },
    leave: (): void => {
      lowConfidenceDecorations?.leave();
      if (usesGroupedHoverOverlay) {
        linkOptions?.hoverOverlayController?.clear();
      }
      tooltipController.hide();
    }
  };
  return interactionLink;
}

function createLowConfidenceExecutionLinkDecorations(
  getRuntimeContext: () => CanvasRuntimeContext,
  getDecorations: () => ILinkDecorations | undefined
): {
  decorations: ILinkDecorations;
  hover: (event: MouseEvent) => void;
  leave: () => void;
} {
  const decorations: ILinkDecorations = {
    pointerCursor: false,
    underline: false
  };
  let removeListeners: (() => void) | undefined;
  let hoverSequence = 0;

  const applyModifierState = (modifierDown: boolean): void => {
    const activeDecorations = getDecorations() ?? decorations;
    if (activeDecorations.pointerCursor !== modifierDown) {
      activeDecorations.pointerCursor = modifierDown;
    }
    if (activeDecorations.underline !== modifierDown) {
      activeDecorations.underline = modifierDown;
    }
  };

  const clearListeners = (): void => {
    removeListeners?.();
    removeListeners = undefined;
  };

  return {
    decorations,
    hover: (event): void => {
      clearListeners();
      hoverSequence += 1;
      const currentHoverSequence = hoverSequence;

      const eventDocument = event.view?.document ?? document;
      const handleKeydown = (nextEvent: KeyboardEvent): void => {
        applyModifierState(isExecutionLinkModifierDown(getRuntimeContext(), nextEvent));
      };
      const handleKeyup = (nextEvent: KeyboardEvent): void => {
        applyModifierState(isExecutionLinkModifierDown(getRuntimeContext(), nextEvent));
      };
      const handleMousemove = (nextEvent: MouseEvent): void => {
        applyModifierState(isExecutionLinkModifierDown(getRuntimeContext(), nextEvent));
      };

      eventDocument.addEventListener('keydown', handleKeydown);
      eventDocument.addEventListener('keyup', handleKeyup);
      eventDocument.addEventListener('mousemove', handleMousemove);
      removeListeners = (): void => {
        eventDocument.removeEventListener('keydown', handleKeydown);
        eventDocument.removeEventListener('keyup', handleKeyup);
        eventDocument.removeEventListener('mousemove', handleMousemove);
      };

      const modifierDown = isExecutionLinkModifierDown(getRuntimeContext(), event);
      applyModifierState(modifierDown);
      void Promise.resolve().then(() => {
        if (hoverSequence !== currentHoverSequence) {
          return;
        }

        applyModifierState(modifierDown);
      });
    },
    leave: (): void => {
      hoverSequence += 1;
      clearListeners();
      applyModifierState(false);
    }
  };
}

function createExecutionLinkTooltip(
  event: MouseEvent,
  label: string,
  runtimeContext: CanvasRuntimeContext
): ActiveTooltipState {
  const tooltip = document.createElement('div');
  tooltip.className = `${EXECUTION_LINK_TOOLTIP_CLASS} ${EXECUTION_LINK_TOOLTIP_VISIBLE_CLASS}`;
  tooltip.textContent = `${label} (${describeExecutionLinkModifier(runtimeContext)})`;
  document.body.appendChild(tooltip);
  const offsetX = 12;
  const offsetY = 18;
  tooltip.style.left = `${Math.min(event.clientX + offsetX, window.innerWidth - tooltip.offsetWidth - 12)}px`;
  tooltip.style.top = `${Math.min(event.clientY + offsetY, window.innerHeight - tooltip.offsetHeight - 12)}px`;
  return {
    text: tooltip.textContent ?? '',
    dispose: (): void => {
      tooltip.remove();
    }
  };
}

function getExecutionTerminalHoverDelay(): number {
  return DEFAULT_WORKBENCH_HOVER_DELAY;
}

function describeExecutionLinkModifier(runtimeContext: CanvasRuntimeContext): string {
  if (runtimeContext.editorMultiCursorModifier === 'ctrlCmd') {
    return isMacintosh() ? 'option + click' : 'alt + click';
  }

  return isMacintosh() ? 'cmd + click' : 'ctrl + click';
}

function isExecutionLinkModifierDown(
  runtimeContext: CanvasRuntimeContext,
  event: MouseEvent | KeyboardEvent
): boolean {
  if (runtimeContext.editorMultiCursorModifier === 'ctrlCmd') {
    return event.altKey;
  }

  return isMacintosh() ? event.metaKey : event.ctrlKey;
}

function shouldActivateExecutionLink(
  runtimeContext: CanvasRuntimeContext,
  event: MouseEvent
): boolean {
  return isExecutionLinkModifierDown(runtimeContext, event);
}

function createSyntheticLinkActivationEvent(runtimeContext: CanvasRuntimeContext): MouseEvent {
  if (runtimeContext.editorMultiCursorModifier === 'ctrlCmd') {
    return new MouseEvent('click', {
      altKey: true,
      bubbles: true
    });
  }

  return new MouseEvent('click', {
    ctrlKey: !isMacintosh(),
    metaKey: isMacintosh(),
    bubbles: true
  });
}

function createHardWrappedHoverOverlayController(terminal: Terminal): HardWrappedHoverOverlayController {
  let overlayElement: HTMLElement | undefined;
  const scrollDisposable = terminal.onScroll(() => clear());
  const resizeDisposable = terminal.onResize(() => clear());

  function clear(): void {
    overlayElement?.remove();
    overlayElement = undefined;
  }

  function show(ranges: IBufferRange[]): void {
    clear();

    const screenElement = queryExecutionTerminalScreenElement(terminal);
    if (!screenElement) {
      return;
    }

    const screenWidth = screenElement.clientWidth;
    const screenHeight = screenElement.clientHeight;
    if (screenWidth <= 0 || screenHeight <= 0 || terminal.cols <= 0 || terminal.rows <= 0) {
      return;
    }

    const cellWidth = screenWidth / terminal.cols;
    const cellHeight = screenHeight / terminal.rows;
    const nextOverlayElement = document.createElement('div');
    nextOverlayElement.className = EXECUTION_HARD_WRAPPED_LINK_HOVER_CLASS;
    nextOverlayElement.setAttribute('aria-hidden', 'true');

    for (const range of ranges) {
      appendHardWrappedHoverOverlaySegments(
        nextOverlayElement,
        terminal,
        range,
        cellWidth,
        cellHeight
      );
    }

    if (nextOverlayElement.childElementCount === 0) {
      return;
    }

    screenElement.appendChild(nextOverlayElement);
    overlayElement = nextOverlayElement;
  }

  function dispose(): void {
    clear();
    scrollDisposable.dispose();
    resizeDisposable.dispose();
  }

  return {
    show,
    clear,
    dispose
  };
}

function appendHardWrappedHoverOverlaySegments(
  overlayElement: HTMLElement,
  terminal: Terminal,
  range: IBufferRange,
  cellWidth: number,
  cellHeight: number
): void {
  const viewportStartY = terminal.buffer.active.viewportY + 1;
  const rangeStartY = Math.max(range.start.y, viewportStartY);
  const rangeEndY = Math.min(range.end.y, viewportStartY + terminal.rows - 1);
  if (rangeEndY < rangeStartY) {
    return;
  }

  for (let lineNumber = rangeStartY; lineNumber <= rangeEndY; lineNumber += 1) {
    const startColumn = lineNumber === range.start.y ? range.start.x : 1;
    const endColumn = lineNumber === range.end.y ? range.end.x : terminal.cols;
    if (endColumn < startColumn) {
      continue;
    }

    const viewportLineIndex = lineNumber - viewportStartY;
    const segmentElement = document.createElement('div');
    segmentElement.className = EXECUTION_HARD_WRAPPED_LINK_HOVER_SEGMENT_CLASS;
    segmentElement.style.left = `${(startColumn - 1) * cellWidth}px`;
    segmentElement.style.top = `${(viewportLineIndex + 1) * cellHeight - 2}px`;
    segmentElement.style.width = `${(endColumn - startColumn + 1) * cellWidth}px`;
    overlayElement.appendChild(segmentElement);
  }
}

function dispatchSyntheticLinkHoverEvent(terminal: Terminal, link: ILink): void {
  const screenElement = queryExecutionTerminalScreenElement(terminal);
  if (!screenElement) {
    throw new Error('Execution terminal screen is not mounted.');
  }

  const hoverPoint = computeExecutionLinkHoverPoint(terminal, screenElement, link.range);
  const eventTarget = document.elementFromPoint(hoverPoint.clientX, hoverPoint.clientY) ?? screenElement;
  eventTarget.dispatchEvent(
    new MouseEvent('mousemove', {
      bubbles: true,
      composed: true,
      view: window,
      clientX: hoverPoint.clientX,
      clientY: hoverPoint.clientY
    })
  );
}

function dispatchSyntheticLinkMouseLeaveEvent(terminal: Terminal): void {
  const screenElement = queryExecutionTerminalScreenElement(terminal);
  if (!screenElement) {
    return;
  }

  screenElement.dispatchEvent(
    new MouseEvent('mouseleave', {
      bubbles: true,
      composed: true,
      view: window
    })
  );
}

function queryExecutionTerminalScreenElement(terminal: Terminal): HTMLElement | null {
  return terminal.element?.querySelector<HTMLElement>('.xterm-screen') ?? terminal.element ?? null;
}

function computeExecutionLinkHoverPoint(
  terminal: Terminal,
  screenElement: HTMLElement,
  range: IBufferRange
): { clientX: number; clientY: number } {
  const viewportLineIndex = range.start.y - terminal.buffer.active.viewportY - 1;
  if (viewportLineIndex < 0 || viewportLineIndex >= terminal.rows) {
    throw new Error(`Execution link "${range.start.x}:${range.start.y}" is outside the visible viewport.`);
  }

  const rect = screenElement.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    throw new Error('Execution terminal screen has no visible size.');
  }

  const cellWidth = rect.width / Math.max(terminal.cols, 1);
  const cellHeight = rect.height / Math.max(terminal.rows, 1);
  const linkStartColumn = Math.max(0, range.start.x - 1);
  const linkEndColumn =
    range.start.y === range.end.y ? Math.max(linkStartColumn, range.end.x - 1) : Math.max(linkStartColumn, terminal.cols - 1);
  const linkMidColumn = linkStartColumn + Math.max(0, linkEndColumn - linkStartColumn) / 2;
  return {
    clientX: Math.round(rect.left + cellWidth * (linkMidColumn + 0.5)),
    clientY: Math.round(rect.top + cellHeight * (viewportLineIndex + 0.5))
  };
}

function isMacintosh(): boolean {
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform);
}

function readHardWrappedLineContext(
  terminal: Terminal,
  startLine: number
): WrappedLineContext | undefined {
  const initialLine = terminal.buffer.active.getLine(startLine);
  if (!initialLine || initialLine.isWrapped) {
    return undefined;
  }

  const lines: IBufferLine[] = [];
  let endLine = startLine;
  for (let lineIndex = startLine; lineIndex < terminal.buffer.active.length; lineIndex += 1) {
    if (lineIndex - startLine >= EXECUTION_HARD_WRAPPED_LINK_MAX_LINES) {
      break;
    }

    const line = terminal.buffer.active.getLine(lineIndex);
    if (!line || line.isWrapped) {
      break;
    }

    lines.push(line);
    endLine = lineIndex;
  }

  if (lines.length < 2) {
    return undefined;
  }

  return {
    startLine,
    endLine,
    lines,
    text: lines.map((line) => line.translateToString(true, 0, terminal.cols)).join('\n')
  };
}

function readWrappedLineContext(
  terminal: Terminal,
  bufferLineNumber: number,
  maxLinkLength: number
): WrappedLineContext | undefined {
  const startBufferLine = bufferLineNumber - 1;
  let startLine = startBufferLine;
  let endLine = startBufferLine;
  const initialLine = terminal.buffer.active.getLine(startLine);
  if (!initialLine) {
    return undefined;
  }

  const lines: IBufferLine[] = [initialLine];
  const maxCharacterContext = Math.max(maxLinkLength, terminal.cols);
  const maxLineContext = Math.ceil(maxCharacterContext / terminal.cols);
  const minStartLine = Math.max(startLine - maxLineContext, 0);
  const maxEndLine = Math.min(endLine + maxLineContext, terminal.buffer.active.length);

  while (startLine >= minStartLine && terminal.buffer.active.getLine(startLine)?.isWrapped) {
    const previousLine = terminal.buffer.active.getLine(startLine - 1);
    if (!previousLine) {
      break;
    }

    lines.unshift(previousLine);
    startLine -= 1;
  }

  while (endLine < maxEndLine && terminal.buffer.active.getLine(endLine + 1)?.isWrapped) {
    const nextLine = terminal.buffer.active.getLine(endLine + 1);
    if (!nextLine) {
      break;
    }

    lines.push(nextLine);
    endLine += 1;
  }

  return {
    startLine,
    endLine,
    lines,
    text: getXtermLineContent(terminal, startLine, endLine)
  };
}

function getXtermLineContent(terminal: Terminal, lineStart: number, lineEnd: number): string {
  let content = '';
  for (let lineIndex = lineStart; lineIndex <= lineEnd; lineIndex += 1) {
    const line = terminal.buffer.active.getLine(lineIndex);
    if (!line) {
      continue;
    }

    content += line.translateToString(true, 0, terminal.cols);
  }

  return content;
}

function getWrappedContextLineText(context: WrappedLineContext, lineOffset: number): string {
  return context.lines[lineOffset]?.translateToString(true) ?? '';
}

function parseHardWrappedUrl(text: string): { url: string } | undefined {
  const matches = EXECUTION_URL_LINKIFY.match(text);
  const match = matches?.find((entry) => entry.index === 0 && entry.lastIndex === text.length);
  return match ? { url: match.url } : undefined;
}

function isPotentialHardWrappedUrlBreak(text: string): boolean {
  return /[/?#&=._~%+-]$/.test(text);
}

function readHardWrappedContinuationFragment(
  lineText: string,
  lineIndex: number
): HardWrappedLinkFragment | undefined {
  const leadingWhitespace = lineText.match(/^\s*/)?.[0].length ?? 0;
  if (
    leadingWhitespace <= 0 ||
    leadingWhitespace > EXECUTION_HARD_WRAPPED_LINK_CONTINUATION_MAX_PREFIX
  ) {
    return undefined;
  }

  const rest = lineText.slice(leadingWhitespace);
  const match = rest.match(/^[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+/);
  if (!match || match[0].length < 2 || match[0].length !== rest.trimEnd().length) {
    return undefined;
  }
  if (isExplicitUrlSchemeStart(match[0])) {
    return undefined;
  }

  return {
    text: match[0],
    bufferRange: toSingleLineBufferRange(
      lineIndex,
      0,
      leadingWhitespace,
      leadingWhitespace + match[0].length
    )
  };
}

function isExplicitUrlSchemeStart(text: string): boolean {
  return /^[A-Za-z][A-Za-z\d+\-.]*:/.test(text);
}

function toSingleLineBufferRange(
  startLine: number,
  lineOffset: number,
  startIndex: number,
  endIndexExclusive: number
): IBufferRange {
  return {
    start: {
      x: startIndex + 1,
      y: startLine + lineOffset + 1
    },
    end: {
      x: endIndexExclusive,
      y: startLine + lineOffset + 1
    }
  };
}

function readStyledTextSpans(terminal: Terminal, lineIndex: number): StyledTextSpan[] {
  const line = terminal.buffer.active.getLine(lineIndex);
  if (!line) {
    return [];
  }

  const spans: StyledTextSpan[] = [];
  let currentSignature: string | undefined;
  let currentCells: Array<{ text: string; startColumn: number; endColumn: number }> = [];
  const flush = (): void => {
    if (!currentSignature || currentCells.length === 0) {
      currentCells = [];
      return;
    }

    while (currentCells.length > 0 && currentCells[0].text.trim().length === 0) {
      currentCells.shift();
    }
    while (currentCells.length > 0 && currentCells[currentCells.length - 1].text.trim().length === 0) {
      currentCells.pop();
    }
    if (currentCells.length === 0) {
      return;
    }

    const text = currentCells.map((cell) => cell.text).join('');
    spans.push({
      text,
      signature: currentSignature,
      bufferRange: {
        start: {
          x: currentCells[0].startColumn,
          y: lineIndex + 1
        },
        end: {
          x: currentCells[currentCells.length - 1].endColumn,
          y: lineIndex + 1
        }
      }
    });
    currentCells = [];
  };

  const lineTextLength = getTrimmedXtermLineTextLength(line, terminal.cols);
  let lineTextOffset = 0;
  for (let column = 0; column < terminal.cols && lineTextOffset < lineTextLength; column += 1) {
    const cell = line.getCell(column);
    if (!cell) {
      break;
    }
    if (cell.getWidth() === 0) {
      continue;
    }

    const chars = cell.getChars() || ' ';
    const charsLength = Math.min(chars.length, lineTextLength - lineTextOffset);
    if (charsLength <= 0) {
      continue;
    }

    const signature = getStyledCellSignature(cell);
    if (!signature) {
      flush();
      currentSignature = undefined;
      lineTextOffset += charsLength;
      continue;
    }

    if (currentSignature !== signature) {
      flush();
      currentSignature = signature;
    }
    currentCells.push({
      text: chars.slice(0, charsLength),
      startColumn: column + 1,
      endColumn: column + Math.max(1, cell.getWidth())
    });
    lineTextOffset += charsLength;
  }

  flush();
  return spans;
}

function getStyledCellSignature(cell: IBufferCell): string | undefined {
  if (cell.isAttributeDefault()) {
    return undefined;
  }

  return [
    cell.getFgColorMode(),
    cell.getFgColor(),
    cell.getBgColorMode(),
    cell.getBgColor(),
    cell.isBold(),
    cell.isItalic(),
    cell.isDim(),
    cell.isUnderline(),
    cell.isInverse(),
    cell.isStrikethrough(),
    cell.isOverline()
  ].join(':');
}

function readXtermRangesByAttr(terminal: Terminal, lineStart: number, lineEnd: number): IBufferRange[] {
  let bufferRangeStart: { x: number; y: number } | undefined;
  let lastFgAttr = -1;
  let lastBgAttr = -1;
  const ranges: IBufferRange[] = [];

  for (let lineIndex = lineStart; lineIndex <= lineEnd; lineIndex += 1) {
    const line = terminal.buffer.active.getLine(lineIndex);
    if (!line) {
      continue;
    }

    for (let column = 0; column < terminal.cols; column += 1) {
      const cell = line.getCell(column);
      if (!cell) {
        break;
      }

      const fgAttr = cell.isBold() | cell.isInverse() | cell.isStrikethrough() | cell.isUnderline();
      const bgAttr = cell.isDim() | cell.isItalic();
      if (lastFgAttr === -1 || lastBgAttr === -1) {
        bufferRangeStart = { x: column, y: lineIndex };
      } else if (lastFgAttr !== fgAttr || lastBgAttr !== bgAttr) {
        if (bufferRangeStart) {
          ranges.push({
            start: {
              x: bufferRangeStart.x + 1,
              y: bufferRangeStart.y + 1
            },
            end: {
              x: column,
              y: lineIndex + 1
            }
          });
        }
        bufferRangeStart = { x: column, y: lineIndex };
      }

      lastFgAttr = fgAttr;
      lastBgAttr = bgAttr;
    }
  }

  return ranges;
}

function convertLinkRangeToBuffer(
  lines: IBufferLine[],
  bufferWidth: number,
  range: SimpleRange,
  startLine: number
): IBufferRange {
  const stringCells = readBufferStringCells(lines, bufferWidth, startLine);
  const startOffset = toBufferStringOffset(lines, bufferWidth, range.startLineNumber, range.startColumn);
  const endOffsetExclusive = toBufferStringOffset(lines, bufferWidth, range.endLineNumber, range.endColumn);
  const startCell = stringCells.find((cell) => cell.endOffsetExclusive > startOffset);
  const endCell = findLastBufferStringCellBeforeOffset(stringCells, endOffsetExclusive);
  if (startCell && endCell) {
    return {
      start: {
        x: startCell.startColumn,
        y: startCell.lineNumber
      },
      end: {
        x: endCell.endColumn,
        y: endCell.lineNumber
      }
    };
  }

  return {
    start: {
      x: range.startColumn,
      y: range.startLineNumber + startLine
    },
    end: {
      x: range.endColumn - 1,
      y: range.endLineNumber + startLine
    }
  };
}

function findLastBufferStringCellBeforeOffset(
  cells: BufferStringCell[],
  endOffsetExclusive: number
): BufferStringCell | undefined {
  for (let index = cells.length - 1; index >= 0; index -= 1) {
    if (cells[index].startOffset < endOffsetExclusive) {
      return cells[index];
    }
  }

  return undefined;
}

interface BufferStringCell {
  startOffset: number;
  endOffsetExclusive: number;
  startColumn: number;
  endColumn: number;
  lineNumber: number;
}

function readBufferStringCells(
  lines: IBufferLine[],
  bufferWidth: number,
  startLine: number
): BufferStringCell[] {
  const cells: BufferStringCell[] = [];
  let textOffset = 0;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    if (!line) {
      continue;
    }

    const lineTextLength = getTrimmedXtermLineTextLength(line, bufferWidth);
    let lineTextOffset = 0;
    for (let column = 0; column < bufferWidth && lineTextOffset < lineTextLength; column += 1) {
      const cell = line.getCell(column);
      if (!cell) {
        break;
      }

      if (cell.getWidth() === 0) {
        continue;
      }

      const chars = cell.getChars() || ' ';
      const charsLength = Math.min(chars.length, lineTextLength - lineTextOffset);
      if (charsLength <= 0) {
        continue;
      }

      cells.push({
        startOffset: textOffset + lineTextOffset,
        endOffsetExclusive: textOffset + lineTextOffset + charsLength,
        startColumn: column + 1,
        endColumn: column + Math.max(1, cell.getWidth()),
        lineNumber: startLine + lineIndex + 1
      });
      lineTextOffset += charsLength;
    }

    textOffset += lineTextLength;
  }

  return cells;
}

function toBufferStringOffset(
  lines: IBufferLine[],
  bufferWidth: number,
  lineNumber: number,
  column: number
): number {
  let offset = 0;
  for (let lineIndex = 0; lineIndex < Math.min(lineNumber - 1, lines.length); lineIndex += 1) {
    const line = lines[lineIndex];
    if (line) {
      offset += getTrimmedXtermLineTextLength(line, bufferWidth);
    }
  }

  return offset + Math.max(0, column - 1);
}

function getTrimmedXtermLineTextLength(line: IBufferLine, bufferWidth: number): number {
  return line.translateToString(true, 0, bufferWidth).length;
}

function dedupeDetectedPathLinks(
  links: DetectedExecutionTerminalPathLink[]
): DetectedExecutionTerminalPathLink[] {
  const seen = new Set<string>();
  const deduped: DetectedExecutionTerminalPathLink[] = [];
  for (const link of links) {
    const key = `${link.startIndex}:${link.endIndexExclusive}:${link.text}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(link);
  }

  return deduped;
}

function extractDroppedExecutionResource(
  dataTransfer: DataTransfer | null
): ExecutionTerminalDroppedResource | undefined {
  if (!dataTransfer) {
    return undefined;
  }

  const rawResources = dataTransfer.getData(RESOURCE_URLS_DATA_TRANSFER);
  if (rawResources) {
    const resources = parseDroppedStringArray(rawResources);
    if (resources.length > 0) {
      return {
        source: 'resourceUrls',
        valueKind: 'uri',
        value: resources[0]
      };
    }
  }

  const rawCodeFiles = dataTransfer.getData(CODE_FILES_DATA_TRANSFER);
  if (rawCodeFiles) {
    const files = parseDroppedStringArray(rawCodeFiles);
    if (files.length > 0) {
      return {
        source: 'codeFiles',
        valueKind: 'path',
        value: files[0]
      };
    }
  }

  const rawUriList = dataTransfer.getData(URI_LIST_DATA_TRANSFER);
  if (rawUriList) {
    const uriList = rawUriList
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0 && !entry.startsWith('#'));
    if (uriList.length > 0) {
      return {
        source: 'uriList',
        valueKind: 'uri',
        value: uriList[0]
      };
    }
  }

  if (dataTransfer.files.length > 0) {
    const firstFile = dataTransfer.files[0] as File & { path?: string };
    if (typeof firstFile.path === 'string' && firstFile.path.trim().length > 0) {
      return {
        source: 'files',
        valueKind: 'path',
        value: firstFile.path
      };
    }
  }

  return undefined;
}

async function findInteractionLinkByText(
  options: ExecutionTerminalNativeInteractionsOptions,
  linkText: string,
  fileLinkResolutionCache: Map<
    string,
    ExecutionTerminalResolvedFileLink[] | Promise<ExecutionTerminalResolvedFileLink[]>
  >,
  _tooltipController: TooltipController
): Promise<ILink | undefined> {
  for (
    let bufferLineNumber = options.terminal.buffer.active.length;
    bufferLineNumber >= options.terminal.buffer.active.viewportY + 1;
    bufferLineNumber -= 1
  ) {
    const linkProviders = readExecutionTerminalLinkProviders(options.terminal);
    for (const linkProvider of linkProviders) {
      const links = await new Promise<ILink[] | undefined>((resolve) => {
        linkProvider.provideLinks(bufferLineNumber, resolve);
      });
      const matchingLink = links?.find((link) => link.text === linkText);
      if (matchingLink) {
        return matchingLink;
      }
    }
  }

  return undefined;
}

function readExecutionTerminalLinkProviders(terminal: Terminal): ILinkProvider[] {
  const internalTerminal = terminal as unknown as XtermTerminalWithLinkProviders;
  return internalTerminal._core?._linkProviderService?.linkProviders ?? [];
}
