import React, { useEffect, type CSSProperties } from 'react';
import { getViewportForBounds, useReactFlow, useStore, useViewport, type Viewport } from 'reactflow';

import { colorForCanvasNodeKind } from '../common/canvasNodeVisuals';
import {
  strongTerminalAttentionReminderPulsesMinimap,
  type CanvasGroupSummary,
  type CanvasNodeKind,
  type CanvasNodeMetadata,
  type CanvasOverviewMode
} from '../common/protocol';
import { isWorkspaceRootCanvasGroupRole } from './canvasGroupFrameStyles';
import { stopCanvasEvent } from './canvasDomEvents';
import type {
  CanvasFlowNode,
  CanvasMiniMapRect,
  CanvasNodeData,
  CanvasOverviewViewportState,
  CanvasSpatialBounds,
  CanvasSpatialRect,
  CanvasViewportSize
} from './canvasTypes';

export const CANVAS_FIT_VIEW_PADDING = 0.05;
export const CANVAS_COMFORT_MIN_ZOOM = 0.4;
export const CANVAS_MAX_ZOOM = 1.8;
export const PANE_GALLERY_MIN_ZOOM = 0.02;
export const PANE_GALLERY_FIT_VIEW_PADDING = 0.16;
export const NODE_FOCUS_VIEW_PADDING = 0.22;
export const NODE_FOCUS_MAX_ZOOM = 1.15;
export const NODE_FOCUS_MIN_ZOOM = 0.55;

const CANVAS_MINIMAP_WIDTH = 194;
const CANVAS_MINIMAP_HEIGHT = 126;
const CANVAS_MINIMAP_OFFSET_SCALE = 5;
const CANVAS_MINIMAP_VIEWPORT_STROKE_WIDTH = 0.5;

export function CanvasMiniMap(props: {
  nodes: readonly CanvasFlowNode[];
  groups: readonly CanvasGroupSummary[];
  spatialBounds: CanvasSpatialBounds;
  viewportSize: CanvasViewportSize;
  minimapLabel: string;
  onViewportCommit: (viewport: Viewport) => void;
}): JSX.Element {
  const { x, y, zoom } = useViewport();
  const reactFlowInstance = useReactFlow<CanvasNodeData>();
  const minZoom = useStore((state) => state.minZoom);
  const viewBB = resolveCanvasViewportBoundsForMiniMap(x, y, zoom, props.viewportSize);
  const boundingRect = mergeCanvasMiniMapRects([props.spatialBounds.bounds, viewBB].filter(isCanvasMiniMapRect)) ?? viewBB;
  const viewBox = resolveCanvasMiniMapViewBox(boundingRect);
  const handlePointerDown = (event: React.PointerEvent<SVGSVGElement>): void => {
    if (event.button !== 0 || !reactFlowInstance.viewportInitialized) {
      return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    stopCanvasEvent(event);
    const start = {
      clientX: event.clientX,
      clientY: event.clientY,
      viewport: reactFlowInstance.getViewport(),
      viewScale: viewBox.width / CANVAS_MINIMAP_WIDTH
    };
    let latestViewport: Viewport | undefined;

    const handlePointerMove = (moveEvent: PointerEvent): void => {
      if (!reactFlowInstance.viewportInitialized) {
        return;
      }

      const multiplier = start.viewScale * Math.max(1, start.viewport.zoom);
      const nextViewport = {
        ...start.viewport,
        x: start.viewport.x - (moveEvent.clientX - start.clientX) * multiplier,
        y: start.viewport.y - (moveEvent.clientY - start.clientY) * multiplier
      };
      latestViewport = nextViewport;
      reactFlowInstance.setViewport(nextViewport);
    };
    const stop = (): void => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      if (latestViewport) {
        props.onViewportCommit(latestViewport);
      }
    };
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stop, { once: true });
    window.addEventListener('pointercancel', stop, { once: true });
  };
  const handleWheel = (event: React.WheelEvent<SVGSVGElement>): void => {
    if (!reactFlowInstance.viewportInitialized) {
      return;
    }

    event.preventDefault();
    stopCanvasEvent(event);
    const currentViewport = reactFlowInstance.getViewport();
    const delta = -event.deltaY * (event.deltaMode === 1 ? 0.05 : event.deltaMode ? 1 : 0.002) * 10;
    const nextZoom = Math.min(CANVAS_MAX_ZOOM, Math.max(minZoom, currentViewport.zoom * Math.pow(2, delta)));
    const rect = event.currentTarget.getBoundingClientRect();
    const flowPoint = {
      x: viewBox.x + ((event.clientX - rect.left) / Math.max(1, rect.width)) * viewBox.width,
      y: viewBox.y + ((event.clientY - rect.top) / Math.max(1, rect.height)) * viewBox.height
    };
    const nextViewport = {
      x: event.clientX - flowPoint.x * nextZoom,
      y: event.clientY - flowPoint.y * nextZoom,
      zoom: nextZoom
    };
    reactFlowInstance.setViewport(nextViewport);
    props.onViewportCommit(nextViewport);
  };

  return (
    <div
      className="canvas-corner-panel canvas-minimap react-flow__minimap"
      data-testid="rf__minimap"
      style={{ width: CANVAS_MINIMAP_WIDTH, height: CANVAS_MINIMAP_HEIGHT }}
    >
      <svg
        width={CANVAS_MINIMAP_WIDTH}
        height={CANVAS_MINIMAP_HEIGHT}
        viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
        role="img"
        aria-label={props.minimapLabel}
        onPointerDown={handlePointerDown}
        onWheel={handleWheel}
      >
        <title>{props.minimapLabel}</title>
        <g className="canvas-minimap-groups" aria-hidden="true">
          {props.groups.map((group) => (
            <rect
              key={group.id}
              className={`canvas-minimap-group${isWorkspaceRootCanvasGroupRole(group.role) ? ' is-workspace-root' : ''}`}
              data-minimap-group-id={group.id}
              data-minimap-group-role={isWorkspaceRootCanvasGroupRole(group.role) ? 'workspace-root' : 'user'}
              x={group.position.x}
              y={group.position.y}
              width={group.size.width}
              height={group.size.height}
              rx={isWorkspaceRootCanvasGroupRole(group.role) ? 0 : 2}
              ry={isWorkspaceRootCanvasGroupRole(group.role) ? 0 : 2}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </g>
        <g className="canvas-minimap-nodes">
          {props.nodes.map((node) => (
            <CanvasMiniMapNode key={node.id} node={node} />
          ))}
        </g>
        <path
          className="react-flow__minimap-mask"
          d={`M${viewBox.x},${viewBox.y}h${viewBox.width}v${viewBox.height}h${-viewBox.width}z M${viewBB.x},${viewBB.y}h${viewBB.width}v${viewBB.height}h${-viewBB.width}z`}
          fill="color-mix(in srgb, var(--vscode-editor-background) 74%, transparent)"
          fillRule="evenodd"
          stroke="none"
          strokeWidth={0}
          pointerEvents="none"
        />
        <rect
          className="canvas-minimap-viewport-outline-rect"
          x={viewBB.x}
          y={viewBB.y}
          width={viewBB.width}
          height={viewBB.height}
          fill="none"
          strokeWidth={CANVAS_MINIMAP_VIEWPORT_STROKE_WIDTH}
          pointerEvents="none"
        />
      </svg>
    </div>
  );
}

function CanvasMiniMapNode(props: { node: CanvasFlowNode }): JSX.Element {
  const node = props.node;
  const className = minimapClassNameForNode(node as CanvasFlowNode);
  const classNames = className.split(/\s+/).filter(Boolean);
  const attentionPending = classNames.includes('has-attention');
  const attentionFlashing = classNames.includes('is-attention-flashing');
  const attentionSizePulsing = classNames.includes('has-strong-attention-reminder');
  const color = minimapFillColorForKind(node.data.kind);
  const strokeColor = minimapStrokeColorForKind(node.data.kind);
  const style = {
    '--minimap-node-attention-color': color,
    '--minimap-node-attention-stroke-color': strokeColor,
    '--minimap-node-attention-scale-peak': attentionSizePulsing ? '1.16' : '1'
  } as CSSProperties;

  return (
    <rect
      className={['react-flow__minimap-node', node.selected ? 'selected' : '', className]
        .filter(Boolean)
        .join(' ')}
      data-minimap-node-id={node.id}
      data-minimap-attention-pending={attentionPending ? 'true' : 'false'}
      data-minimap-attention-flashing={attentionFlashing ? 'true' : 'false'}
      data-minimap-attention-size-pulsing={attentionSizePulsing ? 'true' : 'false'}
      x={node.position.x}
      y={node.position.y}
      rx={4}
      ry={4}
      width={node.width ?? node.data.size.width}
      height={node.height ?? node.data.size.height}
      fill={color}
      stroke={strokeColor}
      strokeWidth={1.2}
      shapeRendering={typeof window === 'undefined' || Boolean((window as unknown as { chrome?: unknown }).chrome) ? 'crispEdges' : 'geometricPrecision'}
      style={style}
    />
  );
}

export function resolveViewportForCanvasRect(
  rect: CanvasMiniMapRect,
  viewportSize: CanvasViewportSize,
  minZoom: number
): Viewport | undefined {
  if (
    !isPositiveFiniteNumber(rect.width) ||
    !isPositiveFiniteNumber(rect.height) ||
    viewportSize.width <= 0 ||
    viewportSize.height <= 0
  ) {
    return undefined;
  }

  return getViewportForBounds(
    rect,
    viewportSize.width,
    viewportSize.height,
    minZoom,
    CANVAS_MAX_ZOOM,
    NODE_FOCUS_VIEW_PADDING
  );
}

export function rectForGroupLike(group: CanvasGroupSummary): CanvasMiniMapRect {
  return {
    x: group.position.x,
    y: group.position.y,
    width: group.size.width,
    height: group.size.height
  };
}

export function resolveDynamicCanvasMinZoom(
  spatialBounds: CanvasSpatialBounds,
  viewportSize: CanvasViewportSize
): number {
  const bounds = spatialBounds.bounds;
  if (!bounds || viewportSize.width <= 0 || viewportSize.height <= 0) {
    return CANVAS_COMFORT_MIN_ZOOM;
  }

  const xZoom = viewportSize.width / (bounds.width * (1 + CANVAS_FIT_VIEW_PADDING));
  const yZoom = viewportSize.height / (bounds.height * (1 + CANVAS_FIT_VIEW_PADDING));
  const fitAllZoom = Math.min(xZoom, yZoom);

  return Number.isFinite(fitAllZoom)
    ? Math.min(CANVAS_COMFORT_MIN_ZOOM, fitAllZoom)
    : CANVAS_COMFORT_MIN_ZOOM;
}

export function resolveCanvasSpatialBounds(
  nodes: readonly CanvasFlowNode[],
  groups: readonly CanvasGroupSummary[]
): CanvasSpatialBounds {
  const nodeRects = nodes.flatMap((node): CanvasSpatialRect[] => {
    const width = numberOrUndefined(node.width) ?? numberOrUndefined(node.style?.width) ?? node.data.size.width;
    const height = numberOrUndefined(node.height) ?? numberOrUndefined(node.style?.height) ?? node.data.size.height;
    if (!isPositiveFiniteNumber(width) || !isPositiveFiniteNumber(height)) {
      return [];
    }

    return [{
      id: node.id,
      kind: 'node',
      x: node.position.x,
      y: node.position.y,
      width,
      height
    }];
  });
  const groupRects = groups.flatMap((group): CanvasSpatialRect[] => {
    if (!isPositiveFiniteNumber(group.size.width) || !isPositiveFiniteNumber(group.size.height)) {
      return [];
    }

    return [{
      id: group.id,
      kind: isWorkspaceRootCanvasGroupRole(group.role) ? 'workspace-root' : 'group',
      x: group.position.x,
      y: group.position.y,
      width: group.size.width,
      height: group.size.height
    }];
  });
  const rects = [...groupRects, ...nodeRects];
  return {
    rects,
    bounds: mergeCanvasMiniMapRects(rects)
  };
}

export function isPositiveFiniteNumber(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function mergeCanvasMiniMapRects(rects: readonly CanvasMiniMapRect[]): CanvasMiniMapRect | undefined {
  if (rects.length === 0) {
    return undefined;
  }

  const left = Math.min(...rects.map((rect) => rect.x));
  const top = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
  const width = right - left;
  const height = bottom - top;
  if (!isPositiveFiniteNumber(width) || !isPositiveFiniteNumber(height)) {
    return undefined;
  }

  return {
    x: left,
    y: top,
    width,
    height
  };
}

export function resolveCanvasOverviewTitleScale(zoom: number): number {
  if (!Number.isFinite(zoom) || zoom <= 0) {
    return 1;
  }

  return Math.min(12, Math.max(1, 1 / zoom));
}

export function CanvasOverviewModeBridge(props: {
  mode: CanvasOverviewMode;
  threshold: number;
  onViewportStateChange: (state: CanvasOverviewViewportState) => void;
}): null {
  const { mode, onViewportStateChange, threshold } = props;
  const { zoom } = useViewport();

  useEffect(() => {
    const active = mode !== 'none' && zoom < threshold;
    onViewportStateChange({
      active,
      titleScale: active && mode === 'title' ? resolveCanvasOverviewTitleScale(zoom) : 1
    });
  }, [mode, onViewportStateChange, threshold, zoom]);

  return null;
}

function isCanvasMiniMapRect(value: CanvasMiniMapRect | undefined): value is CanvasMiniMapRect {
  return Boolean(value && isPositiveFiniteNumber(value.width) && isPositiveFiniteNumber(value.height));
}

function resolveCanvasViewportBoundsForMiniMap(
  x: number,
  y: number,
  zoom: number,
  viewportSize: CanvasViewportSize
): CanvasMiniMapRect {
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  return {
    x: -x / safeZoom,
    y: -y / safeZoom,
    width: Math.max(1, viewportSize.width) / safeZoom,
    height: Math.max(1, viewportSize.height) / safeZoom
  };
}

function resolveCanvasMiniMapViewBox(
  boundingRect: CanvasMiniMapRect
): CanvasMiniMapRect {
  const scaledWidth = boundingRect.width / CANVAS_MINIMAP_WIDTH;
  const scaledHeight = boundingRect.height / CANVAS_MINIMAP_HEIGHT;
  const viewScale = Math.max(scaledWidth, scaledHeight);
  const safeViewScale = Number.isFinite(viewScale) && viewScale > 0 ? viewScale : 1;
  const viewWidth = safeViewScale * CANVAS_MINIMAP_WIDTH;
  const viewHeight = safeViewScale * CANVAS_MINIMAP_HEIGHT;
  const offset = CANVAS_MINIMAP_OFFSET_SCALE * safeViewScale;

  return {
    x: boundingRect.x - (viewWidth - boundingRect.width) / 2 - offset,
    y: boundingRect.y - (viewHeight - boundingRect.height) / 2 - offset,
    width: viewWidth + offset * 2,
    height: viewHeight + offset * 2
  };
}

function colorForKind(kind: CanvasNodeKind): string {
  return colorForCanvasNodeKind(kind);
}

function minimapFillColorForKind(kind: CanvasNodeKind): string {
  return minimapStrokeColorForKind(kind);
}

function minimapStrokeColorForKind(kind: CanvasNodeKind): string {
  return `color-mix(in srgb, ${colorForKind(kind)} 82%, var(--vscode-editor-background) 18%)`;
}

function minimapClassNameForNode(node: CanvasFlowNode): string {
  const data = node.data;
  if (!data || (data.kind !== 'agent' && data.kind !== 'terminal')) {
    return '';
  }

  if (!executionAttentionPendingFromMetadata(data.metadata)) {
    return '';
  }

  return [
    'has-attention',
    'is-attention-flashing',
    strongTerminalAttentionReminderPulsesMinimap(data.strongTerminalAttentionReminderMode)
      ? 'has-strong-attention-reminder'
      : ''
  ]
    .filter(Boolean)
    .join(' ');
}

function executionAttentionPendingFromMetadata(metadata: CanvasNodeMetadata | undefined): boolean {
  return metadata?.agent?.attentionPending === true || metadata?.terminal?.attentionPending === true;
}
