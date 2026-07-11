import React, { useEffect, useRef, type ComponentType } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { useViewport, type NodeProps } from 'reactflow';

import type {
  AgentNodeMetadata,
  AgentProviderKind,
  CanvasRuntimeContext,
  ExecutionNodeKind,
  WebviewNodeActionId
} from '../common/protocol';
import { strongTerminalAttentionReminderShowsTitleBar } from '../common/protocol';
import {
  buildFreshAgentCommandLine,
  formatCommandLine,
  getAgentLaunchErrorDescriptor,
  type AgentLaunchMessageDescriptor
} from '../common/agentLaunchPresets';
import { formatExecutionCwdLabel, formatExecutionCwdTooltip } from '../common/executionCwdLabel';
import {
  inferExecutionTerminalPathStyle,
  type ExecutionTerminalFileLinkCandidate,
  type ExecutionTerminalFileLinkResolvePriority,
  type ExecutionTerminalResolvedFileLink
} from '../common/executionTerminalLinks';
import { canvasOverviewInertProps, CanvasNodeInteractionBoundary, ChromeTitleEditor } from './canvasUiSurface';
import { stopCanvasEvent } from './canvasDomEvents';
import {
  setupExecutionTerminalNativeInteractions,
  type ExecutionTerminalNativeInteractionsHandle
} from './executionTerminalNativeInteractions';
import type { CanvasNodeData, ExecutionInputDispatchMetadata, ExecutionNodeHelpContent } from './canvasTypes';
import type {
  ExecutionHostEvent,
  ExecutionTerminalContentChangeReason,
  ExecutionTerminalController,
  ExecutionTerminalRegistry,
  XtermCoreWithMouseInternals
} from './executionTerminalTypes';
import type { WebviewI18nKey } from './i18n/webviewI18n';

const EXECUTION_TERMINAL_RESTORE_SHRINK_FIT_GRACE_MS = 1000;
const AGENT_TITLE_ACTION_COMPACT_WIDTH = 440;

type EmbeddedTerminalOptions = NonNullable<ConstructorParameters<typeof Terminal>[0]>;

type ExecutionNodeComponent = ComponentType<NodeProps<CanvasNodeData>>;

interface ExecutionNodeActionButtonProps {
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
}

export interface ExecutionSessionNodeDependencies {
  t: (key: WebviewI18nKey, params?: Record<string, string | number>) => string;
  tAgentLaunchMessage: (descriptor: AgentLaunchMessageDescriptor | undefined, fallback?: string) => string;
  agentCommandParseErrorFallback: string;
  executionNodeHelpTips: ExecutionNodeHelpContent;
  createEmbeddedTerminalOptions: () => EmbeddedTerminalOptions;
  createExecutionTerminalController: (
    nodeId: string,
    kind: ExecutionNodeKind,
    terminal: Terminal,
    options?: {
      onContentWillChange?: (reason: ExecutionTerminalContentChangeReason) => void;
      onSnapshotApplied?: (detail: Extract<ExecutionHostEvent, { type: 'snapshot' }>) => void;
      beginSnapshotRestoreDiagnosticsSuppression?: () => (() => void) | undefined;
    }
  ) => ExecutionTerminalController;
  executionTerminalRegistry: ExecutionTerminalRegistry;
  getRuntimeContext: () => CanvasRuntimeContext;
  resolveExecutionTerminalFileLinks: (
    nodeId: string,
    kind: ExecutionNodeKind,
    candidates: ExecutionTerminalFileLinkCandidate[],
    priority?: ExecutionTerminalFileLinkResolvePriority
  ) => Promise<ExecutionTerminalResolvedFileLink[]>;
  reportExecutionInputDispatch: (
    nodeId: string,
    kind: ExecutionNodeKind,
    input: string,
    dispatch: (metadata: ExecutionInputDispatchMetadata) => void
  ) => void;
  createZoomAdjustedMouseEvent: (
    event: Pick<MouseEvent, 'clientX' | 'clientY'>,
    element: HTMLElement,
    zoom: number
  ) => Pick<MouseEvent, 'clientX' | 'clientY'>;
  positionTextareaUnderScaledMouse: (event: MouseEvent, terminal: Terminal, zoom: number) => void;
  readXtermScreenElement: (terminal: Terminal) => HTMLElement | null;
  shouldSelectExecutionNodeForTerminalSelection: (terminal: Terminal) => boolean;
  handleNodeChromeDoubleClick: (event: React.MouseEvent<HTMLElement>, id: string, data: CanvasNodeData) => void;
  CompactCanvasCardNodeContent: ComponentType<Pick<NodeProps<CanvasNodeData>, 'id' | 'data'> & { position: { x: number; y: number }; zoom: number }>;
  NodeResizeAffordance: ComponentType<Pick<NodeProps<CanvasNodeData>, 'id' | 'data'> & { position: { x: number; y: number }; zoom: number }>;
  NodeHandles: ComponentType<{ selected: boolean }>;
  NodeOverviewTitle: ComponentType<{ title: string; status?: string }>;
  ExecutionHelpTrigger: ComponentType<{ help: ExecutionNodeHelpContent; variant: 'inline' }>;
  ExecutionAttentionStatus: ComponentType<{ status: string; attentionPending: boolean }>;
  ActionButton: ComponentType<ExecutionNodeActionButtonProps>;
}

export function createExecutionSessionNodeTypes(deps: ExecutionSessionNodeDependencies): {
  agent: ExecutionNodeComponent;
  terminal: ExecutionNodeComponent;
} {
  function containsTerminalSuspendInput(input: string): boolean {
    return input.includes('\u001a');
  }

  function AgentSessionNode({ id, data, xPos, yPos }: NodeProps<CanvasNodeData>): JSX.Element {
    const { zoom } = useViewport();
    const agentMetadata = data.metadata?.agent;
    if (!agentMetadata) {
      return <deps.CompactCanvasCardNodeContent id={id} data={data} position={{ x: xPos, y: yPos }} zoom={zoom} />;
    }

    const overviewInteractionsDisabled = data.overviewInteractionsDisabled;
    const provider = agentMetadata.provider ?? 'codex';
    const executionBlocked = !data.workspaceTrusted;
    const lifecycle = agentMetadata.lifecycle;
    const displayStatus = data.status;
    const resumeRequested =
      (lifecycle === 'resume-ready' ||
        lifecycle === 'resume-failed' ||
        agentMetadata.pendingLaunch === 'resume');
    const canResumeOriginalSession = canResumeAgentFromMetadataForWebview(agentMetadata);
    const reattaching = displayStatus === 'reattaching';
    const attentionPending = agentMetadata.attentionPending === true;
    const attentionFlashing =
      attentionPending && strongTerminalAttentionReminderShowsTitleBar(data.strongTerminalAttentionReminderMode);
    const runningTitleLine = displayStatus === 'running' && !attentionPending;
    const chromeClassName = [
      'window-chrome',
      attentionPending ? 'has-attention' : '',
      attentionFlashing ? 'is-attention-flashing' : '',
      runningTitleLine ? 'is-agent-running-titleline' : ''
    ]
      .filter(Boolean)
      .join(' ');
    const launchCommandSubtitle = resolveAgentLaunchCommandLineForSubtitle(
      agentMetadata,
      deps.getRuntimeContext().agentLaunchDefaults,
      deps.tAgentLaunchMessage,
      deps.agentCommandParseErrorFallback
    );
    const cwdLabel = formatExecutionCwdLabel(agentMetadata.cwd, data.workspaceFolders, deps.t('execution.cwd.unknown'));
    const cwdTooltip = formatExecutionCwdTooltip(agentMetadata.cwd, cwdLabel);
    const frameRef = useRef<HTMLDivElement | null>(null);
    const viewportRef = useRef<HTMLDivElement | null>(null);
    const resizeFrameRef = useRef<number | undefined>(undefined);
    const deferredShrinkFitTimerRef = useRef<number | undefined>(undefined);
    const autoLaunchRef = useRef<string | null>(null);
    const zoomRef = useRef(zoom);
    const terminalSizeRef = useRef({
      cols: agentMetadata.lastCols ?? 96,
      rows: agentMetadata.lastRows ?? 28
    });
    const snapshotRestoreRef = useRef({
      hasAppliedSnapshot: false,
      suppressShrinkFitUntilMs: 0
    });
    const attachSnapshotRequestedRef = useRef(false);
    const terminalFlagsRef = useRef({
      blockCtrlZInput: provider === 'claude'
    });
    const executionPathContextRef = useRef({
      shellPath: agentMetadata.shellPath,
      cwd: agentMetadata.cwd
    });

    useEffect(() => {
      terminalSizeRef.current = {
        cols: agentMetadata.lastCols ?? terminalSizeRef.current.cols,
        rows: agentMetadata.lastRows ?? terminalSizeRef.current.rows
      };
    }, [agentMetadata.lastCols, agentMetadata.lastRows]);

    useEffect(() => {
      terminalFlagsRef.current = {
        blockCtrlZInput: provider === 'claude'
      };
    }, [provider]);

    useEffect(() => {
      executionPathContextRef.current = {
        shellPath: agentMetadata.shellPath,
        cwd: agentMetadata.cwd
      };
    }, [agentMetadata.cwd, agentMetadata.shellPath]);

    useEffect(() => {
      zoomRef.current = zoom;
    }, [zoom]);

    useEffect(() => {
      const frame = frameRef.current;
      const container = viewportRef.current;
      if (!frame || !container) {
        return;
      }

      function cancelDeferredShrinkFit(): void {
        if (deferredShrinkFitTimerRef.current !== undefined) {
          window.clearTimeout(deferredShrinkFitTimerRef.current);
          deferredShrinkFitTimerRef.current = undefined;
        }
      }

      function scheduleDeferredShrinkFit(delayMs: number): void {
        cancelDeferredShrinkFit();
        deferredShrinkFitTimerRef.current = window.setTimeout(() => {
          deferredShrinkFitTimerRef.current = undefined;
          if (resizeFrameRef.current) {
            window.cancelAnimationFrame(resizeFrameRef.current);
          }
          resizeFrameRef.current = window.requestAnimationFrame(fitTerminal);
        }, Math.max(0, delayMs));
      }

      const terminal = new Terminal(deps.createEmbeddedTerminalOptions());
      const fitAddon = new FitAddon();
      let nativeInteractions: ExecutionTerminalNativeInteractionsHandle | undefined;
      const controller = deps.createExecutionTerminalController(id, 'agent', terminal, {
        onContentWillChange: (reason) => {
          if (reason !== 'snapshot') {
            nativeInteractions?.flushSnapshotRestoreDiagnosticsSuppression();
          }
          if (reason === 'snapshot') {
            nativeInteractions?.invalidateLinkResolutionCache();
          } else if (reason === 'output') {
            nativeInteractions?.invalidateLinkResolutionCache('negative-delayed');
          } else {
            nativeInteractions?.invalidateLinkResolutionCache('negative');
          }
        },
        onSnapshotApplied: (detail) => {
          const hasSerializedRestore = Boolean(
            detail.terminalStream?.checkpoint.serializedState ?? detail.serializedTerminalState
          );
          snapshotRestoreRef.current.hasAppliedSnapshot = true;
          snapshotRestoreRef.current.suppressShrinkFitUntilMs = hasSerializedRestore
            ? Date.now() + EXECUTION_TERMINAL_RESTORE_SHRINK_FIT_GRACE_MS
            : 0;
          if (hasSerializedRestore) {
            scheduleDeferredShrinkFit(EXECUTION_TERMINAL_RESTORE_SHRINK_FIT_GRACE_MS);
          } else {
            cancelDeferredShrinkFit();
          }
        },
        beginSnapshotRestoreDiagnosticsSuppression: () =>
          nativeInteractions?.beginSnapshotRestoreDiagnosticsSuppression()
      });
      nativeInteractions = setupExecutionTerminalNativeInteractions({
        nodeId: id,
        kind: 'agent',
        terminal,
        dropTarget: frame,
        getRuntimeContext: deps.getRuntimeContext,
        getPathStyle: () =>
          inferExecutionTerminalPathStyle(
            executionPathContextRef.current.shellPath,
            executionPathContextRef.current.cwd
          ),
        onDropResource: (nodeId, kind, resource) => data.onDropExecutionResource?.(nodeId, kind, resource),
        onOpenLink: (nodeId, kind, link) => data.onOpenExecutionLink?.(nodeId, kind, link),
        onCopySelection: (nodeId, kind, text, clearSelectionAfterCopy) =>
          data.onCopyExecutionSelection?.(nodeId, kind, text, clearSelectionAfterCopy),
        onRequestPaste: (nodeId, kind, bracketedPasteMode) =>
          data.onRequestExecutionPaste?.(nodeId, kind, bracketedPasteMode),
        onPasteImage: (nodeId, kind, image) => data.onPasteExecutionImage?.(nodeId, kind, image),
        onCopyOsc52Text: (nodeId, _kind, text) =>
          data.onCopyTextToClipboard?.(text, 'execution-osc52', nodeId),
        onClipboardDiagnostic: (payload) => data.onExecutionClipboardDiagnostic?.(payload),
        resolveFileLinks: deps.resolveExecutionTerminalFileLinks
      });
      terminal.loadAddon(fitAddon);
      terminal.open(container);
      deps.executionTerminalRegistry.set(id, {
        terminal,
        fitAddon,
        controller,
        nativeInteractions
      });

      const internalCore = (terminal as unknown as { _core?: XtermCoreWithMouseInternals })._core;
      const mouseService = internalCore?._mouseService;
      const selectionService = internalCore?._selectionService;
      const originalGetCoords = mouseService?.getCoords?.bind(mouseService);
      const originalGetMouseReportCoords = mouseService?.getMouseReportCoords?.bind(mouseService);
      const originalGetMouseEventScrollAmount = selectionService?._getMouseEventScrollAmount?.bind(selectionService);
      const terminalElement = terminal.element;

      if (mouseService && originalGetCoords) {
        mouseService.getCoords = (event, element, colCount, rowCount, isSelection) =>
          originalGetCoords(
            deps.createZoomAdjustedMouseEvent(event, element, zoomRef.current),
            element,
            colCount,
            rowCount,
            isSelection
          );
      }

      if (mouseService && originalGetMouseReportCoords) {
        mouseService.getMouseReportCoords = (event, element) =>
          originalGetMouseReportCoords(
            deps.createZoomAdjustedMouseEvent(event, element, zoomRef.current) as MouseEvent,
            element
          );
      }

      if (selectionService && originalGetMouseEventScrollAmount) {
        selectionService._getMouseEventScrollAmount = (event: MouseEvent): number => {
          const screenElement = selectionService._screenElement ?? deps.readXtermScreenElement(terminal);
          if (!screenElement) {
            return originalGetMouseEventScrollAmount(event);
          }

          return originalGetMouseEventScrollAmount(
            deps.createZoomAdjustedMouseEvent(event, screenElement, zoomRef.current) as MouseEvent
          );
        };
      }

      const syncTextareaToScaledMouse = (event: MouseEvent): void => {
        window.requestAnimationFrame(() => {
          deps.positionTextareaUnderScaledMouse(event, terminal, zoomRef.current);
        });
      };
      const handleContextMenu = (event: MouseEvent): void => {
        syncTextareaToScaledMouse(event);
      };
      const handleAuxClick = (event: MouseEvent): void => {
        if (event.button === 1) {
          syncTextareaToScaledMouse(event);
        }
      };

      terminalElement?.addEventListener('contextmenu', handleContextMenu);
      terminalElement?.addEventListener('auxclick', handleAuxClick);

      function fitTerminal(): void {
        const proposedDimensions = fitAddon.proposeDimensions();
        if (!proposedDimensions) {
          return;
        }

        const { hasAppliedSnapshot, suppressShrinkFitUntilMs } = snapshotRestoreRef.current;
        const shouldDeferShrinkFit =
          hasAppliedSnapshot &&
          Date.now() < suppressShrinkFitUntilMs &&
          (proposedDimensions.cols < terminal.cols || proposedDimensions.rows < terminal.rows);
        if (shouldDeferShrinkFit) {
          scheduleDeferredShrinkFit(suppressShrinkFitUntilMs - Date.now());
        } else {
          cancelDeferredShrinkFit();
        }
        if (
          !shouldDeferShrinkFit &&
          (terminal.cols !== proposedDimensions.cols || terminal.rows !== proposedDimensions.rows)
        ) {
          fitAddon.fit();
        }
        terminalSizeRef.current = {
          cols: terminal.cols,
          rows: terminal.rows
        };

        if (!snapshotRestoreRef.current.hasAppliedSnapshot) {
          return;
        }

        if (terminal.cols <= 0 || terminal.rows <= 0) {
          return;
        }

        data.onResizeExecution?.(id, 'agent', terminal.cols, terminal.rows);
      }

      window.requestAnimationFrame(fitTerminal);

      const resizeObserver = new ResizeObserver(() => {
        if (resizeFrameRef.current) {
          window.cancelAnimationFrame(resizeFrameRef.current);
        }

        resizeFrameRef.current = window.requestAnimationFrame(fitTerminal);
      });
      resizeObserver.observe(container);

      const dataDisposable = terminal.onData((input) => {
        nativeInteractions?.flushSnapshotRestoreDiagnosticsSuppression();
        if (terminalFlagsRef.current.blockCtrlZInput && containsTerminalSuspendInput(input)) {
          data.onShowTransientError?.(deps.t('execution.error.claudeCtrlZUnsupported'));
          return;
        }
        deps.reportExecutionInputDispatch(id, 'agent', input, (metadata) =>
          data.onExecutionInput?.(id, 'agent', input, metadata)
        );
      });
      const selectionDisposable = terminal.onSelectionChange(() => {
        if (deps.shouldSelectExecutionNodeForTerminalSelection(terminal)) {
          data.onSelectNode?.(id);
        }
      });
      const resizeDisposable = terminal.onResize(({ cols, rows }) => {
        terminalSizeRef.current = {
          cols,
          rows
        };
      });

      attachSnapshotRequestedRef.current = true;
      controller.requestAttachSnapshot();

      return () => {
        dataDisposable.dispose();
        selectionDisposable.dispose();
        resizeDisposable.dispose();
        resizeObserver.disconnect();
        terminalElement?.removeEventListener('contextmenu', handleContextMenu);
        terminalElement?.removeEventListener('auxclick', handleAuxClick);
        if (mouseService && originalGetCoords) {
          mouseService.getCoords = originalGetCoords;
        }
        if (mouseService && originalGetMouseReportCoords) {
          mouseService.getMouseReportCoords = originalGetMouseReportCoords;
        }
        if (selectionService && originalGetMouseEventScrollAmount) {
          selectionService._getMouseEventScrollAmount = originalGetMouseEventScrollAmount;
        }
        cancelDeferredShrinkFit();
        if (resizeFrameRef.current) {
          window.cancelAnimationFrame(resizeFrameRef.current);
        }
        controller.dispose();
        nativeInteractions?.dispose();
        deps.executionTerminalRegistry.delete(id);
        terminal.dispose();
      };
    }, [id]);

    useEffect(() => {
      if (agentMetadata.liveSession && !attachSnapshotRequestedRef.current) {
        attachSnapshotRequestedRef.current = true;
        deps.executionTerminalRegistry.get(id)?.controller.requestAttachSnapshot();
      }
      if (!agentMetadata.liveSession) {
        attachSnapshotRequestedRef.current = false;
      }
    }, [agentMetadata.liveSession, id]);

    const startAgent = (resume = resumeRequested): void => {
      data.onSelectNode?.(id);
      data.onStartExecution?.(
        id,
        'agent',
        terminalSizeRef.current.cols,
        terminalSizeRef.current.rows,
        provider,
        resume
      );
    };

    const stopAgent = (): void => {
      data.onSelectNode?.(id);
      data.onStopExecution?.(id, 'agent');
    };

    const deleteAgent = (): void => {
      data.onSelectNode?.(id);
      data.onDeleteNode?.(id);
    };

    const branchAgent = (): void => {
      data.onSelectNode?.(id);
      data.onBranchAgentSession?.(id);
    };

    useEffect(() => {
      if (!agentMetadata.pendingLaunch) {
        autoLaunchRef.current = null;
        return;
      }

      if (executionBlocked || agentMetadata.liveSession || autoLaunchRef.current === agentMetadata.pendingLaunch) {
        return;
      }

      autoLaunchRef.current = agentMetadata.pendingLaunch;
      const frame = window.requestAnimationFrame(() => startAgent(agentMetadata.pendingLaunch === 'resume'));
      return () => {
        window.cancelAnimationFrame(frame);
      };
    }, [agentMetadata.liveSession, agentMetadata.pendingLaunch, executionBlocked, id, provider]);

    const isLegacySuspendedAgent = lifecycle === 'suspended';
    const showRestartActions = !agentMetadata.liveSession && canResumeOriginalSession && !isLegacySuspendedAgent;
    const showBranchAction = canForkAgentFromMetadataForWebview(agentMetadata) && !isLegacySuspendedAgent;
    const titleActionChromeDensity =
      data.size.width <= AGENT_TITLE_ACTION_COMPACT_WIDTH ? 'compact-actions' : 'regular';
    const actionDisabled = executionBlocked || reattaching;

    return (
      <CanvasNodeInteractionBoundary
        nodeId={id}
        disabled={data.overviewInteractionsDisabled}
        onModifierSelectNode={(nodeId) => data.onModifierSelectNode?.(nodeId)}
      >
        <div
        className={`canvas-node session-node agent-session-node kind-agent ${data.selected ? 'is-selected' : ''}`}
        data-node-id={id}
        data-node-kind={data.kind}
        data-node-selected={data.selected ? 'true' : 'false'}
        onMouseDownCapture={(event) => {
          if (event.button === 0) {
            data.onAcknowledgeNodeAttention?.(id);
          }
        }}
      >
        <deps.NodeResizeAffordance id={id} data={data} position={{ x: xPos, y: yPos }} zoom={zoom} />
        <deps.NodeHandles selected={data.selected} />
        <div
          className={chromeClassName}
          data-execution-attention-pending={attentionPending ? 'true' : 'false'}
          data-execution-attention-flashing={attentionFlashing ? 'true' : 'false'}
          data-agent-running-titleline={runningTitleLine ? 'true' : 'false'}
          onDoubleClick={(event) => deps.handleNodeChromeDoubleClick(event, id, data)}
        >
          <ChromeTitleEditor
            value={data.title}
            contextLabel={cwdLabel}
            contextTooltip={cwdTooltip}
            subtitle={launchCommandSubtitle}
            subtitleTooltip={launchCommandSubtitle}
            subtitleAccessory={<deps.ExecutionHelpTrigger help={deps.executionNodeHelpTips} variant="inline" />}
            placeholder={deps.t('agent.title.placeholder')}
            className="agent-window-title"
            onSelectNode={() => data.onSelectNode?.(id)}
            onSubmit={(title) => data.onUpdateNodeTitle?.(id, title)}
          />
          <div
            className="window-chrome-actions agent-window-chrome-actions"
            data-agent-branch-visible={showBranchAction ? 'true' : 'false'}
            data-agent-action-density={titleActionChromeDensity}
          >
            <deps.ExecutionAttentionStatus
              status={displayStatus}
              attentionPending={attentionPending}
            />
            {agentMetadata.liveSession ? (
              <deps.ActionButton
                label={deps.t('action.stop')}
                actionId="stop"
                onClick={stopAgent}
                tone="primary"
                disabled={actionDisabled}
                className="nodrag nopan compact"
                interactive
                onFocus={() => data.onSelectNode?.(id)}
              />
            ) : showRestartActions ? (
              <div className="action-button-group agent-restart-action-group nodrag nopan" data-node-interactive="true">
                <deps.ActionButton
                  label={deps.t('action.newSession')}
                  actionId="new-session"
                  tone="primary"
                  disabled={actionDisabled}
                  className="compact nodrag nopan"
                  interactive
                  onFocus={() => data.onSelectNode?.(id)}
                  onClick={() => {
                    startAgent(false);
                  }}
                  buttonProps={{
                    title: deps.t('agent.action.startNewSession.title'),
                    'aria-label': deps.t('agent.action.startNewSession.title'),
                    'data-agent-restart-action': 'new-session'
                  }}
                />
                <deps.ActionButton
                  label={deps.t('action.resume')}
                  actionId="restart"
                  tone="primary"
                  disabled={actionDisabled || !canResumeOriginalSession}
                  className="compact nodrag nopan"
                  interactive
                  onFocus={() => data.onSelectNode?.(id)}
                  onClick={() => {
                    startAgent(true);
                  }}
                  buttonProps={{
                    title: !canResumeOriginalSession
                      ? deps.t('agent.action.resume.disabledTitle')
                      : deps.t('agent.action.resume.title'),
                    'aria-label': !canResumeOriginalSession
                      ? deps.t('agent.action.resume.disabledAria')
                      : deps.t('agent.action.resume.aria'),
                    'data-agent-restart-action': 'resume'
                  }}
                />
              </div>
            ) : (
              <deps.ActionButton
                label={deps.t('action.start')}
                actionId="start"
                onClick={() => startAgent(false)}
                tone="primary"
                disabled={actionDisabled}
                className="nodrag nopan compact"
                interactive
                onFocus={() => data.onSelectNode?.(id)}
              />
            )}
            {showBranchAction ? (
              <deps.ActionButton
                label={deps.t('action.branch')}
                actionId="branch"
                tone="primary"
                disabled={actionDisabled}
                className="agent-branch-action-button nodrag nopan compact"
                interactive
                onFocus={() => data.onSelectNode?.(id)}
                onClick={branchAgent}
                buttonProps={{
                  title: deps.t('agent.action.branchCurrentSession', { provider: providerLabel(provider) }),
                  'aria-label': deps.t('agent.action.branchCurrentSession', { provider: providerLabel(provider) }),
                  'data-agent-branch-action': 'true'
                }}
              />
            ) : null}
            <deps.ActionButton
              label={deps.t('action.delete')}
              actionId="delete"
              tone="danger"
              onClick={deleteAgent}
              className="nodrag nopan compact"
              interactive
              onFocus={() => data.onSelectNode?.(id)}
            />
          </div>
        </div>

        <div className="session-body">
          <div
            ref={frameRef}
            className={`terminal-frame nowheel nodrag nopan ${agentMetadata.liveSession ? 'is-live' : 'is-idle'}`}
            data-node-interactive="true"
            {...canvasOverviewInertProps(overviewInteractionsDisabled)}
            onMouseDown={(event) => {
              stopCanvasEvent(event);
              data.onSelectNode?.(id);
            }}
            onClick={(event) => {
              stopCanvasEvent(event);
              data.onSelectNode?.(id);
            }}
            onDoubleClick={stopCanvasEvent}
            onWheel={stopCanvasEvent}
          >
            <div ref={viewportRef} className="terminal-viewport" />
            <deps.NodeOverviewTitle title={data.title} status={displayStatus} />
            {!agentMetadata.liveSession ? (
              <div className="terminal-overlay">
                <strong>
                  {executionBlocked
                      ? deps.t('execution.overlay.restrictedMode')
                      : reattaching
                        ? deps.t('agent.overlay.reattaching')
                        : displayStatus === 'history-restored'
                          ? deps.t('agent.overlay.historyRestored')
                      : lifecycle === 'resume-ready'
                        ? deps.t('agent.overlay.resumeReady')
                        : lifecycle === 'resume-failed'
                          ? deps.t('agent.overlay.resumeFailed')
                      : agentMetadata.lastExitMessage
                        ? deps.t('agent.overlay.notRunning')
                        : deps.t('agent.overlay.notStarted')}
                </strong>
                <span>
                  {executionBlocked
                      ? deps.t('agent.overlay.restricted')
                      : reattaching
                        ? data.summary
                        : displayStatus === 'history-restored'
                          ? data.summary
                      : lifecycle === 'resume-ready'
                        ? data.summary
                        : lifecycle === 'resume-failed'
                          ? agentMetadata.lastResumeError ?? data.summary
                      : agentMetadata.lastExitMessage
                        ? agentMetadata.lastExitMessage
                        : data.summary}
                </span>
              </div>
            ) : null}
          </div>
        </div>
        </div>
      </CanvasNodeInteractionBoundary>
    );
  }

  function TerminalSessionNode({ id, data, xPos, yPos }: NodeProps<CanvasNodeData>): JSX.Element {
    const { zoom } = useViewport();
    const terminalMetadata = data.metadata?.terminal;
    if (!terminalMetadata) {
      return <deps.CompactCanvasCardNodeContent id={id} data={data} position={{ x: xPos, y: yPos }} zoom={zoom} />;
    }

    const overviewInteractionsDisabled = data.overviewInteractionsDisabled;
    const executionBlocked = !data.workspaceTrusted;
    const lifecycle = terminalMetadata.lifecycle;
    const displayStatus = data.status;
    const reattaching = displayStatus === 'reattaching';
    const attentionPending = terminalMetadata.attentionPending === true;
    const attentionFlashing =
      attentionPending && strongTerminalAttentionReminderShowsTitleBar(data.strongTerminalAttentionReminderMode);
    const chromeClassName = [
      'window-chrome',
      attentionPending ? 'has-attention' : '',
      attentionFlashing ? 'is-attention-flashing' : ''
    ]
      .filter(Boolean)
      .join(' ');
    const frameRef = useRef<HTMLDivElement | null>(null);
    const viewportRef = useRef<HTMLDivElement | null>(null);
    const autoLaunchRef = useRef<string | null>(null);
    const zoomRef = useRef(zoom);
    const terminalSizeRef = useRef({
      cols: terminalMetadata.lastCols ?? 96,
      rows: terminalMetadata.lastRows ?? 28
    });
    const executionPathContextRef = useRef({
      shellPath: terminalMetadata.shellPath,
      cwd: terminalMetadata.cwd
    });
    const snapshotRestoreRef = useRef({
      hasAppliedSnapshot: false,
      suppressShrinkFitUntilMs: 0
    });
    const attachSnapshotRequestedRef = useRef(false);
    const resizeFrameRef = useRef<number | undefined>(undefined);
    const deferredShrinkFitTimerRef = useRef<number | undefined>(undefined);

    useEffect(() => {
      terminalSizeRef.current = {
        cols: terminalMetadata.lastCols ?? terminalSizeRef.current.cols,
        rows: terminalMetadata.lastRows ?? terminalSizeRef.current.rows
      };
    }, [terminalMetadata.lastCols, terminalMetadata.lastRows]);

    useEffect(() => {
      zoomRef.current = zoom;
    }, [zoom]);

    useEffect(() => {
      executionPathContextRef.current = {
        shellPath: terminalMetadata.shellPath,
        cwd: terminalMetadata.cwd
      };
    }, [terminalMetadata.cwd, terminalMetadata.shellPath]);

    useEffect(() => {
      const frame = frameRef.current;
      const container = viewportRef.current;
      if (!frame || !container) {
        return;
      }

      function cancelDeferredShrinkFit(): void {
        if (deferredShrinkFitTimerRef.current !== undefined) {
          window.clearTimeout(deferredShrinkFitTimerRef.current);
          deferredShrinkFitTimerRef.current = undefined;
        }
      }

      function scheduleDeferredShrinkFit(delayMs: number): void {
        cancelDeferredShrinkFit();
        deferredShrinkFitTimerRef.current = window.setTimeout(() => {
          deferredShrinkFitTimerRef.current = undefined;
          if (resizeFrameRef.current) {
            window.cancelAnimationFrame(resizeFrameRef.current);
          }
          resizeFrameRef.current = window.requestAnimationFrame(fitTerminal);
        }, Math.max(0, delayMs));
      }

      const terminal = new Terminal(deps.createEmbeddedTerminalOptions());
      const fitAddon = new FitAddon();
      let nativeInteractions: ExecutionTerminalNativeInteractionsHandle | undefined;
      const controller = deps.createExecutionTerminalController(id, 'terminal', terminal, {
        onContentWillChange: (reason) => {
          if (reason !== 'snapshot') {
            nativeInteractions?.flushSnapshotRestoreDiagnosticsSuppression();
          }
          if (reason === 'snapshot') {
            nativeInteractions?.invalidateLinkResolutionCache();
          } else if (reason === 'output') {
            nativeInteractions?.invalidateLinkResolutionCache('negative-delayed');
          } else {
            nativeInteractions?.invalidateLinkResolutionCache('negative');
          }
        },
        onSnapshotApplied: (detail) => {
          const hasSerializedRestore = Boolean(
            detail.terminalStream?.checkpoint.serializedState ?? detail.serializedTerminalState
          );
          snapshotRestoreRef.current.hasAppliedSnapshot = true;
          snapshotRestoreRef.current.suppressShrinkFitUntilMs = hasSerializedRestore
            ? Date.now() + EXECUTION_TERMINAL_RESTORE_SHRINK_FIT_GRACE_MS
            : 0;
          if (hasSerializedRestore) {
            scheduleDeferredShrinkFit(EXECUTION_TERMINAL_RESTORE_SHRINK_FIT_GRACE_MS);
          } else {
            cancelDeferredShrinkFit();
          }
        },
        beginSnapshotRestoreDiagnosticsSuppression: () =>
          nativeInteractions?.beginSnapshotRestoreDiagnosticsSuppression()
      });
      nativeInteractions = setupExecutionTerminalNativeInteractions({
        nodeId: id,
        kind: 'terminal',
        terminal,
        dropTarget: frame,
        getRuntimeContext: deps.getRuntimeContext,
        getPathStyle: () =>
          inferExecutionTerminalPathStyle(
            executionPathContextRef.current.shellPath,
            executionPathContextRef.current.cwd
          ),
        onDropResource: (nodeId, kind, resource) => data.onDropExecutionResource?.(nodeId, kind, resource),
        onOpenLink: (nodeId, kind, link) => data.onOpenExecutionLink?.(nodeId, kind, link),
        onCopySelection: (nodeId, kind, text, clearSelectionAfterCopy) =>
          data.onCopyExecutionSelection?.(nodeId, kind, text, clearSelectionAfterCopy),
        onRequestPaste: (nodeId, kind, bracketedPasteMode) =>
          data.onRequestExecutionPaste?.(nodeId, kind, bracketedPasteMode),
        onPasteImage: (nodeId, kind, image) => data.onPasteExecutionImage?.(nodeId, kind, image),
        onCopyOsc52Text: (nodeId, _kind, text) =>
          data.onCopyTextToClipboard?.(text, 'execution-osc52', nodeId),
        onClipboardDiagnostic: (payload) => data.onExecutionClipboardDiagnostic?.(payload),
        resolveFileLinks: deps.resolveExecutionTerminalFileLinks
      });
      terminal.loadAddon(fitAddon);
      terminal.open(container);
      deps.executionTerminalRegistry.set(id, {
        terminal,
        fitAddon,
        controller,
        nativeInteractions
      });

      const internalCore = (terminal as unknown as { _core?: XtermCoreWithMouseInternals })._core;
      const mouseService = internalCore?._mouseService;
      const selectionService = internalCore?._selectionService;
      const originalGetCoords = mouseService?.getCoords?.bind(mouseService);
      const originalGetMouseReportCoords = mouseService?.getMouseReportCoords?.bind(mouseService);
      const originalGetMouseEventScrollAmount = selectionService?._getMouseEventScrollAmount?.bind(selectionService);
      const terminalElement = terminal.element;

      if (mouseService && originalGetCoords) {
        mouseService.getCoords = (event, element, colCount, rowCount, isSelection) =>
          originalGetCoords(
            deps.createZoomAdjustedMouseEvent(event, element, zoomRef.current),
            element,
            colCount,
            rowCount,
            isSelection
          );
      }

      if (mouseService && originalGetMouseReportCoords) {
        mouseService.getMouseReportCoords = (event, element) =>
          originalGetMouseReportCoords(
            deps.createZoomAdjustedMouseEvent(event, element, zoomRef.current) as MouseEvent,
            element
          );
      }

      if (selectionService && originalGetMouseEventScrollAmount) {
        selectionService._getMouseEventScrollAmount = (event: MouseEvent): number => {
          const screenElement = selectionService._screenElement ?? deps.readXtermScreenElement(terminal);
          if (!screenElement) {
            return originalGetMouseEventScrollAmount(event);
          }

          return originalGetMouseEventScrollAmount(
            deps.createZoomAdjustedMouseEvent(event, screenElement, zoomRef.current) as MouseEvent
          );
        };
      }

      const syncTextareaToScaledMouse = (event: MouseEvent): void => {
        window.requestAnimationFrame(() => {
          deps.positionTextareaUnderScaledMouse(event, terminal, zoomRef.current);
        });
      };
      const handleContextMenu = (event: MouseEvent): void => {
        syncTextareaToScaledMouse(event);
      };
      const handleAuxClick = (event: MouseEvent): void => {
        if (event.button === 1) {
          syncTextareaToScaledMouse(event);
        }
      };

      terminalElement?.addEventListener('contextmenu', handleContextMenu);
      terminalElement?.addEventListener('auxclick', handleAuxClick);

      function fitTerminal(): void {
        const proposedDimensions = fitAddon.proposeDimensions();
        if (!proposedDimensions) {
          return;
        }

        const { hasAppliedSnapshot, suppressShrinkFitUntilMs } = snapshotRestoreRef.current;
        const shouldDeferShrinkFit =
          hasAppliedSnapshot &&
          Date.now() < suppressShrinkFitUntilMs &&
          (proposedDimensions.cols < terminal.cols || proposedDimensions.rows < terminal.rows);
        if (shouldDeferShrinkFit) {
          scheduleDeferredShrinkFit(suppressShrinkFitUntilMs - Date.now());
        } else {
          cancelDeferredShrinkFit();
        }
        if (
          !shouldDeferShrinkFit &&
          (terminal.cols !== proposedDimensions.cols || terminal.rows !== proposedDimensions.rows)
        ) {
          fitAddon.fit();
        }
        terminalSizeRef.current = {
          cols: terminal.cols,
          rows: terminal.rows
        };

        if (!snapshotRestoreRef.current.hasAppliedSnapshot) {
          return;
        }

        if (terminal.cols <= 0 || terminal.rows <= 0) {
          return;
        }

        data.onResizeExecution?.(id, 'terminal', terminal.cols, terminal.rows);
      }

      window.requestAnimationFrame(fitTerminal);

      const resizeObserver = new ResizeObserver(() => {
        if (resizeFrameRef.current) {
          window.cancelAnimationFrame(resizeFrameRef.current);
        }

        resizeFrameRef.current = window.requestAnimationFrame(fitTerminal);
      });
      resizeObserver.observe(container);

      const dataDisposable = terminal.onData((input) => {
        nativeInteractions?.flushSnapshotRestoreDiagnosticsSuppression();
        deps.reportExecutionInputDispatch(id, 'terminal', input, (metadata) =>
          data.onExecutionInput?.(id, 'terminal', input, metadata)
        );
      });
      const selectionDisposable = terminal.onSelectionChange(() => {
        if (deps.shouldSelectExecutionNodeForTerminalSelection(terminal)) {
          data.onSelectNode?.(id);
        }
      });
      const resizeDisposable = terminal.onResize(({ cols, rows }) => {
        terminalSizeRef.current = {
          cols,
          rows
        };
      });

      attachSnapshotRequestedRef.current = true;
      controller.requestAttachSnapshot();

      return () => {
        dataDisposable.dispose();
        selectionDisposable.dispose();
        resizeDisposable.dispose();
        resizeObserver.disconnect();
        terminalElement?.removeEventListener('contextmenu', handleContextMenu);
        terminalElement?.removeEventListener('auxclick', handleAuxClick);
        if (mouseService && originalGetCoords) {
          mouseService.getCoords = originalGetCoords;
        }
        if (mouseService && originalGetMouseReportCoords) {
          mouseService.getMouseReportCoords = originalGetMouseReportCoords;
        }
        if (selectionService && originalGetMouseEventScrollAmount) {
          selectionService._getMouseEventScrollAmount = originalGetMouseEventScrollAmount;
        }
        cancelDeferredShrinkFit();
        if (resizeFrameRef.current) {
          window.cancelAnimationFrame(resizeFrameRef.current);
        }
        controller.dispose();
        nativeInteractions?.dispose();
        deps.executionTerminalRegistry.delete(id);
        terminal.dispose();
      };
    }, [id]);

    useEffect(() => {
      if (terminalMetadata.liveSession && !attachSnapshotRequestedRef.current) {
        attachSnapshotRequestedRef.current = true;
        deps.executionTerminalRegistry.get(id)?.controller.requestAttachSnapshot();
      }
      if (!terminalMetadata.liveSession) {
        attachSnapshotRequestedRef.current = false;
      }
    }, [id, terminalMetadata.liveSession]);

    const startTerminal = (): void => {
      data.onSelectNode?.(id);
      data.onStartExecution?.(id, 'terminal', terminalSizeRef.current.cols, terminalSizeRef.current.rows);
    };

    const stopTerminal = (): void => {
      data.onSelectNode?.(id);
      data.onStopExecution?.(id, 'terminal');
    };

    const deleteTerminal = (): void => {
      data.onSelectNode?.(id);
      data.onDeleteNode?.(id);
    };

    useEffect(() => {
      if (!terminalMetadata.pendingLaunch) {
        autoLaunchRef.current = null;
        return;
      }

      if (executionBlocked || terminalMetadata.liveSession || autoLaunchRef.current === terminalMetadata.pendingLaunch) {
        return;
      }

      autoLaunchRef.current = terminalMetadata.pendingLaunch;
      const frame = window.requestAnimationFrame(startTerminal);
      return () => {
        window.cancelAnimationFrame(frame);
      };
    }, [executionBlocked, id, terminalMetadata.liveSession, terminalMetadata.pendingLaunch]);

    return (
      <CanvasNodeInteractionBoundary
        nodeId={id}
        disabled={data.overviewInteractionsDisabled}
        onModifierSelectNode={(nodeId) => data.onModifierSelectNode?.(nodeId)}
      >
        <div
        className={`canvas-node session-node terminal-session-node kind-terminal ${data.selected ? 'is-selected' : ''}`}
        data-node-id={id}
        data-node-kind={data.kind}
        data-node-selected={data.selected ? 'true' : 'false'}
        onMouseDownCapture={(event) => {
          if (event.button === 0) {
            data.onAcknowledgeNodeAttention?.(id);
          }
        }}
      >
        <deps.NodeResizeAffordance id={id} data={data} position={{ x: xPos, y: yPos }} zoom={zoom} />
        <deps.NodeHandles selected={data.selected} />
        <div
          className={chromeClassName}
          data-execution-attention-pending={attentionPending ? 'true' : 'false'}
          data-execution-attention-flashing={attentionFlashing ? 'true' : 'false'}
          onDoubleClick={(event) => deps.handleNodeChromeDoubleClick(event, id, data)}
        >
          <ChromeTitleEditor
            value={data.title}
            subtitle={terminalMetadata.shellPath}
            subtitleAccessory={<deps.ExecutionHelpTrigger help={deps.executionNodeHelpTips} variant="inline" />}
            placeholder={deps.t('terminal.title.placeholder')}
            className="terminal-window-title"
            onSelectNode={() => data.onSelectNode?.(id)}
            onSubmit={(title) => data.onUpdateNodeTitle?.(id, title)}
          />
          <div className="window-chrome-actions">
            <deps.ExecutionAttentionStatus
              status={displayStatus}
              attentionPending={attentionPending}
            />
            <deps.ActionButton
              label={
                terminalMetadata.liveSession
                  ? deps.t('action.stop')
                  : terminalMetadata.lastExitMessage
                    ? deps.t('action.restart')
                    : deps.t('action.start')
              }
              actionId={terminalMetadata.liveSession ? 'stop' : terminalMetadata.lastExitMessage ? 'restart' : 'start'}
              onClick={() => (terminalMetadata.liveSession ? stopTerminal() : startTerminal())}
              tone="primary"
              disabled={executionBlocked || reattaching}
              className="nodrag nopan compact"
              interactive
              onFocus={() => data.onSelectNode?.(id)}
            />
            <deps.ActionButton
              label={deps.t('action.delete')}
              actionId="delete"
              tone="danger"
              onClick={deleteTerminal}
              className="nodrag nopan compact"
              interactive
              onFocus={() => data.onSelectNode?.(id)}
            />
          </div>
        </div>

        <div className="session-body terminal-session-body">
          <div
            ref={frameRef}
            className={`terminal-frame nowheel nodrag nopan ${terminalMetadata.liveSession ? 'is-live' : 'is-idle'}`}
            data-node-interactive="true"
            {...canvasOverviewInertProps(overviewInteractionsDisabled)}
            onMouseDown={(event) => {
              stopCanvasEvent(event);
              data.onSelectNode?.(id);
            }}
            onClick={(event) => {
              stopCanvasEvent(event);
              data.onSelectNode?.(id);
            }}
            onDoubleClick={stopCanvasEvent}
            onWheel={stopCanvasEvent}
          >
            <div ref={viewportRef} className="terminal-viewport" />
            <deps.NodeOverviewTitle title={data.title} status={displayStatus} />
            {!terminalMetadata.liveSession ? (
              <div className="terminal-overlay">
                <strong>
                  {executionBlocked
                    ? deps.t('execution.overlay.restrictedMode')
                    : reattaching
                      ? deps.t('terminal.overlay.reattaching')
                      : displayStatus === 'history-restored'
                        ? deps.t('terminal.overlay.historyRestored')
                    : lifecycle === 'interrupted'
                      ? deps.t('terminal.overlay.interrupted')
                    : terminalMetadata.lastExitMessage
                      ? deps.t('terminal.overlay.notRunning')
                      : deps.t('terminal.overlay.notStarted')}
                </strong>
                <span>
                  {executionBlocked
                    ? deps.t('terminal.overlay.restricted')
                    : reattaching
                      ? data.summary
                      : displayStatus === 'history-restored'
                        ? data.summary
                    : lifecycle === 'interrupted'
                      ? data.summary
                    : terminalMetadata.lastExitMessage
                      ? terminalMetadata.lastExitMessage
                      : data.summary}
                </span>
              </div>
            ) : null}
          </div>
        </div>
        </div>
      </CanvasNodeInteractionBoundary>
    );
  }


  return {
    agent: AgentSessionNode,
    terminal: TerminalSessionNode
  };
}

function providerLabel(provider: AgentProviderKind): string {
  return provider === 'claude' ? 'Claude Code' : 'Codex';
}

function resolveAgentLaunchCommandLineForSubtitle(
  metadata: AgentNodeMetadata,
  defaultsByProvider: CanvasRuntimeContext['agentLaunchDefaults'],
  tAgentLaunchMessage: (descriptor: AgentLaunchMessageDescriptor | undefined, fallback?: string) => string,
  agentCommandParseErrorFallback: string
): string {
  const lastLaunchCommandLine = metadata.lastLaunchCommandLine?.trim();
  if (lastLaunchCommandLine) {
    return lastLaunchCommandLine;
  }

  const provider = metadata.provider ?? 'codex';
  try {
    if (Array.isArray(metadata.templateArgv)) {
      const configuredCommand = defaultsByProvider[provider].command.trim() || provider;
      return formatCommandLine([configuredCommand, ...metadata.templateArgv]);
    }

    return buildFreshAgentCommandLine(
      provider,
      metadata.launchPreset ?? 'default',
      metadata.customLaunchCommand,
      defaultsByProvider[provider]
    );
  } catch (error) {
    return tAgentLaunchMessage(
      getAgentLaunchErrorDescriptor(error),
      error instanceof Error ? error.message : agentCommandParseErrorFallback
    );
  }
}

function canResumeAgentFromMetadataForWebview(
  metadata: {
    resumeStrategy: AgentNodeMetadata['resumeStrategy'];
    resumeSessionId?: string;
    resumeStoragePath?: string;
  }
): boolean {
  if (
    metadata.resumeStrategy !== 'claude-session-id' &&
    metadata.resumeStrategy !== 'codex-session-id' &&
    metadata.resumeStrategy !== 'fake-provider'
  ) {
    return false;
  }

  if (metadata.resumeStrategy === 'fake-provider') {
    return Boolean(metadata.resumeSessionId?.trim() && metadata.resumeStoragePath?.trim());
  }

  return Boolean(metadata.resumeSessionId?.trim());
}

function canForkAgentFromMetadataForWebview(metadata: AgentNodeMetadata): boolean {
  if (!canResumeAgentFromMetadataForWebview(metadata)) {
    return false;
  }

  return (
    (metadata.provider === 'claude' && metadata.resumeStrategy === 'claude-session-id') ||
    (metadata.provider === 'codex' && metadata.resumeStrategy === 'codex-session-id')
  );
}
