import React, { useEffect, useRef, type ComponentType } from 'react';
import { Handle, Position, useViewport, type NodeProps } from 'reactflow';

import { CANVAS_ATTENTION_INDICATOR_ICON_ID } from '../common/canvasAttentionVisuals';
import { canvasStatusToneClass as statusToneClass } from '../common/canvasNodeStatusPresentation';
import type {
  AgentProviderKind,
  CanvasNodeFootprint,
  CanvasNodePosition,
  WebviewNodeActionId
} from '../common/protocol';
import { stopCanvasEvent } from './canvasDomEvents';
import type {
  CanvasNodeData,
  CanvasNodeResizeDirection,
  CanvasNodeResizeDraft
} from './canvasTypes';
import {
  CanvasNodeInteractionBoundary,
  canvasNodeResizeCursorForDirection,
  useCanvasOverviewInteractionsDisabled
} from './canvasUiSurface';
import type { WebviewI18nKey } from './i18n/webviewI18n';

export interface CanvasNodeChromeActionButtonProps {
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

type CanvasNodeChromeTranslator = (key: WebviewI18nKey, params?: Record<string, string | number>) => string;

type CanvasNodeChromeComponent = ComponentType<NodeProps<CanvasNodeData>>;

export interface CanvasNodeChromeDependencies {
  t: CanvasNodeChromeTranslator;
  formatCanvasStatus: (status: string) => string;
  formatCanvasNodeStatus: (node: Pick<CanvasNodeData, 'kind' | 'status' | 'metadata'>) => string;
  formatAgentProviderLabel: (provider: AgentProviderKind) => string;
  minimumNodeFootprint: (data: CanvasNodeData) => CanvasNodeFootprint;
}

export interface CanvasNodeChromeComponents {
  ActionButton: ComponentType<CanvasNodeChromeActionButtonProps>;
  CompactCanvasCardNode: CanvasNodeChromeComponent;
  CompactCanvasCardNodeContent: ComponentType<Pick<NodeProps<CanvasNodeData>, 'id' | 'data'> & {
    position: CanvasNodePosition;
    zoom: number;
  }>;
  ExecutionAttentionStatus: ComponentType<{ status: string; attentionPending: boolean }>;
  NodeHandles: ComponentType<{ selected: boolean }>;
  NodeOverviewTitle: ComponentType<{ title: string; status?: string }>;
  NodeResizeAffordance: ComponentType<Pick<NodeProps<CanvasNodeData>, 'id' | 'data'> & {
    position: CanvasNodePosition;
    zoom: number;
    minimumOverride?: CanvasNodeFootprint;
  }>;
}

export function createCanvasNodeChrome(deps: CanvasNodeChromeDependencies): CanvasNodeChromeComponents {
  const {
    t,
    formatCanvasStatus,
    formatCanvasNodeStatus,
    formatAgentProviderLabel,
    minimumNodeFootprint
  } = deps;

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
          {formatCanvasStatus(props.status)}
        </span>
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
            <span>{formatCanvasStatus(props.status)}</span>
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
    const minimum = minimumOverride ?? minimumNodeFootprint(data);
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
          {t('compact.status', { status: formatCanvasNodeStatus(data) })}
        </div>
        {data.kind === 'agent' && agentMetadata ? (
          <div className="node-hint">
            {agentMetadata.liveSession
              ? t('agent.compact.running', { provider: formatAgentProviderLabel(agentMetadata.provider) })
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

  function ActionButton(props: CanvasNodeChromeActionButtonProps): JSX.Element {
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

  return {
    ActionButton,
    CompactCanvasCardNode,
    CompactCanvasCardNodeContent,
    ExecutionAttentionStatus,
    NodeHandles,
    NodeOverviewTitle,
    NodeResizeAffordance
  };
}
