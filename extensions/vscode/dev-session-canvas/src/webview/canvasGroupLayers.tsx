import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useStore, useViewport, type ReactFlowState, type Viewport } from 'reactflow';

import type {
  CanvasGroupSummary,
  CanvasNodeFootprint,
  CanvasNodePosition
} from '../common/protocol';
import {
  CANVAS_GROUP_BODY_TOP_OFFSET,
  createCanvasGroupFrameStyle,
  isWorkspaceRootCanvasGroupRole
} from './canvasGroupFrameStyles';
import { stopCanvasEvent } from './canvasDomEvents';
import type { CanvasGroupDraft, CanvasGroupResizeDirection, CanvasPoint } from './canvasTypes';
import {
  ChromeTitleEditor,
  canvasNodeResizeCursorForDirection,
  footprintsEqual,
  handleGroupChromeDoubleClick,
  isGroupChromeFocusBlockedTarget,
  isGroupModifierSelectionBlockedTarget,
  isInteractiveTarget,
  positionsEqual
} from './canvasUiSurface';
import type { WebviewI18nKey } from './i18n/webviewI18n';

type CanvasGroupTranslator = (key: WebviewI18nKey, params?: Record<string, string | number>) => string;

const MINIMUM_CANVAS_GROUP_SIZE: CanvasNodeFootprint = { width: 180, height: 96 };
const CANVAS_GROUP_RESIZE_DIRECTIONS: CanvasGroupResizeDirection[] = [
  'top',
  'right',
  'bottom',
  'left',
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right'
];
const CANVAS_GROUP_RESIZE_LINE_DIRECTIONS: CanvasGroupResizeDirection[] = ['top', 'right', 'bottom', 'left'];
const CANVAS_GROUP_POINTER_COMMIT_THRESHOLD_PX = 3;
const CANVAS_GROUP_TITLEBAR_DOUBLE_CLICK_MAX_INTERVAL_MS = 700;
const CANVAS_GROUP_TITLEBAR_DOUBLE_CLICK_POSITION_TOLERANCE_PX = 8;

export function CanvasGroupsViewportLayer(props: {
  groups: CanvasGroupSummary[];
  workspaceRootWatermarksEnabled: boolean;
  selectedGroupIds?: readonly string[];
  workspaceRootForegroundMode?: 'editable' | 'background-only';
  t: CanvasGroupTranslator;
  onSelectGroupBody: (
    groupId: string,
    event?: Pick<React.MouseEvent | React.PointerEvent | MouseEvent, 'ctrlKey' | 'metaKey'>
  ) => void;
  onFocusGroupInViewport: (groupId: string) => void;
  onGroupBodyContextMenu: (event: React.MouseEvent, groupId: string) => void;
  onGroupContextMenu: (event: React.MouseEvent, groupId: string) => void;
  onSelectGroup: (
    groupId: string,
    event?: Pick<React.MouseEvent | React.PointerEvent | MouseEvent, 'ctrlKey' | 'metaKey'>
  ) => void;
  onDraftGroup: (groupId: string, draft: CanvasGroupDraft | null) => void;
  onGroupInteractionStart: (groupId: string) => void;
  onGroupInteractionEnd: (groupId: string) => void;
  onMoveGroup: (groupId: string, position: CanvasNodePosition, pointerPosition: CanvasNodePosition) => void;
  onResizeGroup: (groupId: string, position: CanvasNodePosition, size: CanvasNodeFootprint) => void;
  onUpdateGroupTitle: (groupId: string, title: string) => void;
  onUngroup: (groupId: string) => void;
  onDeleteGroup: (groupId: string) => void;
  onDragPointerMove: (
    event: Pick<PointerEvent | React.PointerEvent, 'clientX' | 'clientY'>,
    onPan?: (previousViewport: Viewport, nextViewport: Viewport) => void
  ) => void;
  onDragEnd: () => void;
  onResizePointerMove: (
    event: Pick<PointerEvent | React.PointerEvent, 'clientX' | 'clientY'>,
    onPan?: (previousViewport: Viewport, nextViewport: Viewport) => void
  ) => void;
  onResizeEnd: () => void;
}): JSX.Element {
  const viewport = useViewport();
  const backgroundPortalElement = useStore(selectCanvasGroupBackgroundViewportElement);
  const foregroundPortalElement = useStore(selectCanvasGroupForegroundPortalElement);

  return (
    <>
      {backgroundPortalElement
        ? createPortal(
            <CanvasGroupBackgroundLayer
              groups={props.groups}
              workspaceRootWatermarksEnabled={props.workspaceRootWatermarksEnabled}
              selectedGroupIds={props.selectedGroupIds}
              zoom={viewport.zoom}
              onSelectGroupBody={props.onSelectGroupBody}
              onFocusGroupInViewport={props.onFocusGroupInViewport}
              onGroupBodyContextMenu={props.onGroupBodyContextMenu}
            />,
            backgroundPortalElement
          )
        : null}
      {foregroundPortalElement
        ? createPortal(<CanvasGroupLayer {...props} viewport={viewport} />, foregroundPortalElement)
        : null}
    </>
  );
}

function selectCanvasGroupBackgroundViewportElement(state: ReactFlowState): HTMLDivElement | null {
  const viewportElement = state.domNode?.querySelector('.react-flow__viewport');
  return viewportElement instanceof HTMLDivElement ? viewportElement : null;
}

function selectCanvasGroupForegroundPortalElement(state: ReactFlowState): HTMLDivElement | null {
  const rendererElement = state.domNode?.querySelector('.react-flow__renderer');
  return rendererElement instanceof HTMLDivElement ? rendererElement : null;
}

function CanvasGroupBackgroundLayer(props: {
  groups: CanvasGroupSummary[];
  workspaceRootWatermarksEnabled: boolean;
  selectedGroupIds?: readonly string[];
  zoom: number;
  onSelectGroupBody: (
    groupId: string,
    event?: Pick<React.MouseEvent | React.PointerEvent | MouseEvent, 'ctrlKey' | 'metaKey'>
  ) => void;
  onFocusGroupInViewport: (groupId: string) => void;
  onGroupBodyContextMenu: (event: React.MouseEvent, groupId: string) => void;
}): JSX.Element {
  const orderedGroups = sortCanvasGroupsByDepthForWebview(props.groups);
  const selectedGroupIds = new Set(props.selectedGroupIds ?? []);
  return (
    <div className="canvas-group-background-layer" aria-hidden="true">
      {orderedGroups.map((group) => (
        <CanvasGroupBackgroundFrame
          key={group.id}
          group={group}
          selected={selectedGroupIds.has(group.id)}
          zoom={props.zoom}
          onSelectGroupBody={props.onSelectGroupBody}
          onFocusGroupInViewport={props.onFocusGroupInViewport}
          onGroupBodyContextMenu={props.onGroupBodyContextMenu}
        />
      ))}
      <CanvasRootWatermarkLayer
        groups={orderedGroups}
        enabled={props.workspaceRootWatermarksEnabled}
        selectedGroupIds={selectedGroupIds}
        zoom={props.zoom}
      />
    </div>
  );
}

function CanvasRootWatermarkLayer(props: {
  groups: readonly CanvasGroupSummary[];
  enabled: boolean;
  selectedGroupIds: ReadonlySet<string>;
  zoom: number;
}): JSX.Element | null {
  if (!props.enabled) {
    return null;
  }

  const rootGroups = props.groups.filter((group) => isWorkspaceRootCanvasGroupRole(group.role));
  if (rootGroups.length === 0) {
    return null;
  }

  return (
    <>
      {rootGroups.map((group) => (
        <div
          key={`watermark-${group.id}`}
          className="canvas-root-watermark-frame"
          data-root-watermark-frame-id={group.id}
          style={createCanvasGroupFrameStyle(group, props.zoom, props.selectedGroupIds.has(group.id), true)}
        >
          <div
            className="canvas-root-watermark-tile"
            data-root-name-watermark="true"
            aria-hidden="true"
          >
            <span data-root-watermark-label={group.title}>{group.title}</span>
          </div>
        </div>
      ))}
    </>
  );
}

function CanvasGroupBackgroundFrame(props: {
  group: CanvasGroupSummary;
  selected: boolean;
  zoom: number;
  onSelectGroupBody: (
    groupId: string,
    event?: Pick<React.MouseEvent | React.PointerEvent | MouseEvent, 'ctrlKey' | 'metaKey'>
  ) => void;
  onFocusGroupInViewport: (groupId: string) => void;
  onGroupBodyContextMenu: (event: React.MouseEvent, groupId: string) => void;
}): JSX.Element {
  const isWorkspaceRootGroup = isWorkspaceRootCanvasGroupRole(props.group.role);
  return (
    <div
      className={`canvas-group-background-frame${isWorkspaceRootGroup ? ' is-workspace-root' : ''}`}
      data-group-background-id={props.group.id}
      data-group-background-role={isWorkspaceRootGroup ? 'workspace-root' : 'user'}
      style={createCanvasGroupFrameStyle(props.group, props.zoom, props.selected, false)}
    >
      <div
        className="canvas-group-background-body-hit-area"
        data-group-background-body-hit-area="true"
        onClick={(event) => {
          stopCanvasEvent(event);
          props.onSelectGroupBody(props.group.id, event);
        }}
        onDoubleClick={(event) => handleGroupChromeDoubleClick(event, props.group.id, props.onFocusGroupInViewport)}
        onContextMenu={(event) => {
          props.onGroupBodyContextMenu(event, props.group.id);
        }}
      />
    </div>
  );
}

function CanvasGroupLayer(props: {
  groups: CanvasGroupSummary[];
  selectedGroupIds?: readonly string[];
  workspaceRootForegroundMode?: 'editable' | 'background-only';
  viewport: Viewport;
  t: CanvasGroupTranslator;
  onSelectGroup: (
    groupId: string,
    event?: Pick<React.MouseEvent | React.PointerEvent | MouseEvent, 'ctrlKey' | 'metaKey'>
  ) => void;
  onFocusGroupInViewport: (groupId: string) => void;
  onGroupContextMenu: (event: React.MouseEvent, groupId: string) => void;
  onDraftGroup: (groupId: string, draft: CanvasGroupDraft | null) => void;
  onGroupInteractionStart: (groupId: string) => void;
  onGroupInteractionEnd: (groupId: string) => void;
  onMoveGroup: (groupId: string, position: CanvasNodePosition, pointerPosition: CanvasNodePosition) => void;
  onResizeGroup: (groupId: string, position: CanvasNodePosition, size: CanvasNodeFootprint) => void;
  onUpdateGroupTitle: (groupId: string, title: string) => void;
  onUngroup: (groupId: string) => void;
  onDeleteGroup: (groupId: string) => void;
  onDragPointerMove: (
    event: Pick<PointerEvent | React.PointerEvent, 'clientX' | 'clientY'>,
    onPan?: (previousViewport: Viewport, nextViewport: Viewport) => void
  ) => void;
  onDragEnd: () => void;
  onResizePointerMove: (
    event: Pick<PointerEvent | React.PointerEvent, 'clientX' | 'clientY'>,
    onPan?: (previousViewport: Viewport, nextViewport: Viewport) => void
  ) => void;
  onResizeEnd: () => void;
}): JSX.Element {
  const orderedGroups = sortCanvasGroupsByDepthForWebview(props.groups).filter(
    (group) =>
      props.workspaceRootForegroundMode !== 'background-only' ||
      !isWorkspaceRootCanvasGroupRole(group.role)
  );
  const selectedGroupIds = new Set(props.selectedGroupIds ?? []);
  return (
    <div
      className="canvas-group-layer"
      style={{
        transform: `translate(${props.viewport.x}px, ${props.viewport.y}px) scale(${props.viewport.zoom})`
      }}
    >
      {orderedGroups.map((group) => (
        <CanvasGroupFrame
          key={group.id}
          group={group}
          selected={selectedGroupIds.has(group.id)}
          zoom={props.viewport.zoom}
          t={props.t}
          onSelectGroup={props.onSelectGroup}
          onFocusGroupInViewport={props.onFocusGroupInViewport}
          onGroupContextMenu={props.onGroupContextMenu}
          onDraftGroup={props.onDraftGroup}
          onGroupInteractionStart={props.onGroupInteractionStart}
          onGroupInteractionEnd={props.onGroupInteractionEnd}
          onMoveGroup={props.onMoveGroup}
          onResizeGroup={props.onResizeGroup}
          onUpdateGroupTitle={props.onUpdateGroupTitle}
          onUngroup={props.onUngroup}
          onDeleteGroup={props.onDeleteGroup}
          onDragPointerMove={props.onDragPointerMove}
          onDragEnd={props.onDragEnd}
          onResizePointerMove={props.onResizePointerMove}
          onResizeEnd={props.onResizeEnd}
        />
      ))}
    </div>
  );
}

export function sortCanvasGroupsByDepthForWebview(groups: readonly CanvasGroupSummary[]): CanvasGroupSummary[] {
  return [...groups].sort((left, right) => {
    const depthDelta = groupDepthForWebview(groups, left.id) - groupDepthForWebview(groups, right.id);
    return depthDelta !== 0 ? depthDelta : groupAreaForWebview(left) - groupAreaForWebview(right);
  });
}

export function findInnermostCanvasGroupBodyAtScreenPoint(
  groups: readonly CanvasGroupSummary[],
  canvasShellElement: HTMLElement | null,
  clientX: number,
  clientY: number
): CanvasGroupSummary | undefined {
  if (!canvasShellElement) {
    return undefined;
  }

  const backgroundLayer = canvasShellElement.querySelector<HTMLElement>('.canvas-group-background-layer');
  const viewportElement = backgroundLayer?.closest<HTMLElement>('.react-flow__viewport');
  if (!backgroundLayer || !viewportElement) {
    return undefined;
  }

  const viewportRect = viewportElement.getBoundingClientRect();
  const viewportTransform = readCanvasViewportTransform(viewportElement);
  const safeZoom = Number.isFinite(viewportTransform.zoom) && viewportTransform.zoom > 0 ? viewportTransform.zoom : 1;
  const flowPoint = {
    x: (clientX - viewportRect.left) / safeZoom,
    y: (clientY - viewportRect.top) / safeZoom
  };

  return findInnermostCanvasGroupBodyAtFlowPoint(groups, canvasShellElement, flowPoint);
}

export function findInnermostCanvasGroupBodyAtFlowPoint(
  groups: readonly CanvasGroupSummary[],
  canvasShellElement: HTMLElement | null,
  flowPoint: CanvasPoint
): CanvasGroupSummary | undefined {
  if (!canvasShellElement) {
    return undefined;
  }

  const backgroundLayer = canvasShellElement.querySelector<HTMLElement>('.canvas-group-background-layer');
  if (!backgroundLayer) {
    return undefined;
  }

  return [...groups]
    .filter((group) =>
      isCanvasPointInsideGroupBody(flowPoint, group, readCanvasGroupBodyTopOffset(backgroundLayer, group.id))
    )
    .sort((left, right) => {
      const depthDelta = groupDepthForWebview(groups, right.id) - groupDepthForWebview(groups, left.id);
      return depthDelta !== 0 ? depthDelta : groupAreaForWebview(left) - groupAreaForWebview(right);
    })
    .at(0);
}

export function findInnermostCanvasGroupFrameAtFlowPoint(
  groups: readonly CanvasGroupSummary[],
  flowPoint: CanvasPoint
): CanvasGroupSummary | undefined {
  return [...groups]
    .filter((group) => isCanvasPointInsideGroupFrame(flowPoint, group))
    .sort((left, right) => {
      const depthDelta = groupDepthForWebview(groups, right.id) - groupDepthForWebview(groups, left.id);
      return depthDelta !== 0 ? depthDelta : groupAreaForWebview(left) - groupAreaForWebview(right);
    })
    .at(0);
}

function readCanvasViewportTransform(viewportElement: HTMLElement): Viewport {
  const match = viewportElement.style.transform.match(
    /translate\((-?\d+(?:\.\d+)?)px,\s*(-?\d+(?:\.\d+)?)px\)\s+scale\((-?\d+(?:\.\d+)?)\)/u
  );
  if (match) {
    return {
      x: Number.parseFloat(match[1]),
      y: Number.parseFloat(match[2]),
      zoom: Number.parseFloat(match[3])
    };
  }

  const transform = getComputedStyle(viewportElement).transform;
  if (transform && transform !== 'none') {
    const matrix = new DOMMatrixReadOnly(transform);
    return {
      x: matrix.m41,
      y: matrix.m42,
      zoom: matrix.a
    };
  }

  return { x: 0, y: 0, zoom: 1 };
}

function readCanvasGroupBodyTopOffset(backgroundLayer: HTMLElement, groupId: string): number {
  const background = backgroundLayer.querySelector<HTMLElement>(`[data-group-background-id="${CSS.escape(groupId)}"]`);
  if (!background) {
    return CANVAS_GROUP_BODY_TOP_OFFSET;
  }

  const bodyTopOffset = Number.parseFloat(getComputedStyle(background).getPropertyValue('--canvas-group-body-top'));
  return Number.isFinite(bodyTopOffset) && bodyTopOffset >= 0 ? bodyTopOffset : CANVAS_GROUP_BODY_TOP_OFFSET;
}

function isCanvasPointInsideGroupBody(
  point: CanvasPoint,
  group: CanvasGroupSummary,
  bodyTopOffset: number
): boolean {
  const left = group.position.x;
  const top = group.position.y + bodyTopOffset;
  const right = group.position.x + group.size.width;
  const bottom = group.position.y + group.size.height;
  return point.x >= left && point.x <= right && point.y >= top && point.y <= bottom;
}

function isCanvasPointInsideGroupFrame(point: CanvasPoint, group: CanvasGroupSummary): boolean {
  const left = group.position.x;
  const top = group.position.y;
  const right = group.position.x + group.size.width;
  const bottom = group.position.y + group.size.height;
  return point.x >= left && point.x <= right && point.y >= top && point.y <= bottom;
}

function groupAreaForWebview(group: CanvasGroupSummary): number {
  return group.size.width * group.size.height;
}

function resolveGroupDragPosition(
  dragStart: { clientX: number; clientY: number; position: CanvasNodePosition; autoPanOffset: CanvasNodePosition },
  event: Pick<PointerEvent | React.PointerEvent, 'clientX' | 'clientY'>,
  zoom: number
): CanvasNodePosition {
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  return {
    x: Math.round(dragStart.position.x + (event.clientX - dragStart.clientX) / safeZoom + dragStart.autoPanOffset.x),
    y: Math.round(dragStart.position.y + (event.clientY - dragStart.clientY) / safeZoom + dragStart.autoPanOffset.y)
  };
}

function resolveGroupResizeGeometry(
  resizeStart: {
    clientX: number;
    clientY: number;
    position: CanvasNodePosition;
    size: CanvasNodeFootprint;
    direction: CanvasGroupResizeDirection;
    autoPanOffset: CanvasNodePosition;
  },
  event: Pick<PointerEvent | React.PointerEvent, 'clientX' | 'clientY'>,
  zoom: number
): { position: CanvasNodePosition; size: CanvasNodeFootprint } {
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const deltaX = (event.clientX - resizeStart.clientX) / safeZoom + resizeStart.autoPanOffset.x;
  const deltaY = (event.clientY - resizeStart.clientY) / safeZoom + resizeStart.autoPanOffset.y;
  const resizeLeft = resizeStart.direction.includes('left');
  const resizeRight = resizeStart.direction.includes('right');
  const resizeTop = resizeStart.direction.includes('top');
  const resizeBottom = resizeStart.direction.includes('bottom');
  const nextWidth = Math.max(
    MINIMUM_CANVAS_GROUP_SIZE.width,
    Math.round(resizeStart.size.width + (resizeRight ? deltaX : 0) - (resizeLeft ? deltaX : 0))
  );
  const nextHeight = Math.max(
    MINIMUM_CANVAS_GROUP_SIZE.height,
    Math.round(resizeStart.size.height + (resizeBottom ? deltaY : 0) - (resizeTop ? deltaY : 0))
  );

  return {
    position: {
      x: resizeLeft
        ? Math.round(resizeStart.position.x + resizeStart.size.width - nextWidth)
        : resizeStart.position.x,
      y: resizeTop
        ? Math.round(resizeStart.position.y + resizeStart.size.height - nextHeight)
        : resizeStart.position.y
    },
    size: {
      width: nextWidth,
      height: nextHeight
    }
  };
}

function hasGroupPointerCommitMovement(
  pointerStart: { clientX: number; clientY: number; autoPanOffset: CanvasNodePosition },
  event: Pick<PointerEvent | React.PointerEvent, 'clientX' | 'clientY'>,
  zoom: number
): boolean {
  const pointerDelta = Math.hypot(event.clientX - pointerStart.clientX, event.clientY - pointerStart.clientY);
  if (pointerDelta > CANVAS_GROUP_POINTER_COMMIT_THRESHOLD_PX) {
    return true;
  }

  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const autoPanScreenDelta = Math.hypot(
    pointerStart.autoPanOffset.x * safeZoom,
    pointerStart.autoPanOffset.y * safeZoom
  );
  return autoPanScreenDelta > CANVAS_GROUP_POINTER_COMMIT_THRESHOLD_PX;
}

function CanvasGroupFrame(props: {
  group: CanvasGroupSummary;
  selected: boolean;
  zoom: number;
  t: CanvasGroupTranslator;
  onSelectGroup: (
    groupId: string,
    event?: Pick<React.MouseEvent | React.PointerEvent | MouseEvent, 'ctrlKey' | 'metaKey'>
  ) => void;
  onFocusGroupInViewport: (groupId: string) => void;
  onGroupContextMenu: (event: React.MouseEvent, groupId: string) => void;
  onDraftGroup: (groupId: string, draft: CanvasGroupDraft | null) => void;
  onGroupInteractionStart: (groupId: string) => void;
  onGroupInteractionEnd: (groupId: string) => void;
  onMoveGroup: (groupId: string, position: CanvasNodePosition, pointerPosition: CanvasNodePosition) => void;
  onResizeGroup: (groupId: string, position: CanvasNodePosition, size: CanvasNodeFootprint) => void;
  onUpdateGroupTitle: (groupId: string, title: string) => void;
  onUngroup: (groupId: string) => void;
  onDeleteGroup: (groupId: string) => void;
  onDragPointerMove: (
    event: Pick<PointerEvent | React.PointerEvent, 'clientX' | 'clientY'>,
    onPan?: (previousViewport: Viewport, nextViewport: Viewport) => void
  ) => void;
  onDragEnd: () => void;
  onResizePointerMove: (
    event: Pick<PointerEvent | React.PointerEvent, 'clientX' | 'clientY'>,
    onPan?: (previousViewport: Viewport, nextViewport: Viewport) => void
  ) => void;
  onResizeEnd: () => void;
}): JSX.Element {
  const isWorkspaceRootGroup = isWorkspaceRootCanvasGroupRole(props.group.role);
  const dragStartRef = useRef<{
    pointerId: number;
    source: 'titlebar' | 'border';
    clientX: number;
    clientY: number;
    position: CanvasNodePosition;
    pointerOffset: CanvasNodePosition;
    autoPanOffset: CanvasNodePosition;
  } | null>(null);
  const resizeStartRef = useRef<{
    pointerId: number;
    clientX: number;
    clientY: number;
    position: CanvasNodePosition;
    size: CanvasNodeFootprint;
    direction: CanvasGroupResizeDirection;
    autoPanOffset: CanvasNodePosition;
  } | null>(null);
  const lastDragEventRef = useRef<Pick<PointerEvent | React.PointerEvent, 'clientX' | 'clientY'> | null>(null);
  const lastResizeEventRef = useRef<Pick<PointerEvent | React.PointerEvent, 'clientX' | 'clientY'> | null>(null);
  const lastTitlebarPointerClickRef = useRef<{
    clientX: number;
    clientY: number;
    timestamp: number;
  } | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const ignoreNextClickSelectionRef = useRef(false);
  const latestPropsRef = useRef(props);

  useEffect(() => {
    latestPropsRef.current = props;
  });

  const selectGroup = (
    event?: Pick<React.MouseEvent | React.PointerEvent | MouseEvent, 'ctrlKey' | 'metaKey'>
  ): void => props.onSelectGroup(props.group.id, event);

  const handleModifierSelectionPointerDownCapture = (event: React.PointerEvent): void => {
    if (
      event.button !== 0 ||
      (!event.ctrlKey && !event.metaKey) ||
      isGroupModifierSelectionBlockedTarget(event.target)
    ) {
      return;
    }

    event.preventDefault();
    stopCanvasEvent(event);
    ignoreNextClickSelectionRef.current = true;
    props.onSelectGroup(props.group.id, event);
  };

  const resolvePointerOffsetInGroup = (event: React.PointerEvent): CanvasNodePosition => {
    const frameElement = event.currentTarget instanceof HTMLElement
      ? event.currentTarget.closest<HTMLElement>('.canvas-group-frame')
      : null;
    const frameRect = frameElement?.getBoundingClientRect();
    if (!frameRect) {
      return {
        x: Math.round(props.group.size.width / 2),
        y: Math.round(props.group.size.height / 2)
      };
    }

    return {
      x: Math.round((event.clientX - frameRect.left) / props.zoom),
      y: Math.round((event.clientY - frameRect.top) / props.zoom)
    };
  };

  const takeTitlebarDoubleClickPointerIntent = (event: React.PointerEvent): boolean => {
    const lastClick = lastTitlebarPointerClickRef.current;
    if (!lastClick) {
      return false;
    }

    const elapsed = event.timeStamp - lastClick.timestamp;
    const distance = Math.hypot(event.clientX - lastClick.clientX, event.clientY - lastClick.clientY);
    if (
      elapsed < 0 ||
      elapsed > CANVAS_GROUP_TITLEBAR_DOUBLE_CLICK_MAX_INTERVAL_MS ||
      distance > CANVAS_GROUP_TITLEBAR_DOUBLE_CLICK_POSITION_TOLERANCE_PX
    ) {
      return false;
    }

    lastTitlebarPointerClickRef.current = null;
    return true;
  };

  const rememberTitlebarPointerClick = (
    event: Pick<PointerEvent | React.PointerEvent, 'clientX' | 'clientY' | 'timeStamp'>
  ): void => {
    lastTitlebarPointerClickRef.current = {
      clientX: event.clientX,
      clientY: event.clientY,
      timestamp: event.timeStamp
    };
  };

  const clearTitlebarPointerClickMemory = (): void => {
    lastTitlebarPointerClickRef.current = null;
  };

  const applyDragMove = (
    event: Pick<PointerEvent | React.PointerEvent, 'pointerId' | 'clientX' | 'clientY'>
  ): boolean => {
    const dragStart = dragStartRef.current;
    if (!dragStart || dragStart.pointerId !== event.pointerId) {
      return false;
    }

    lastDragEventRef.current = {
      clientX: event.clientX,
      clientY: event.clientY
    };
    const currentProps = latestPropsRef.current;
    const publishDraft = (): void => {
      currentProps.onDraftGroup(currentProps.group.id, {
        position: resolveGroupDragPosition(dragStart, event, currentProps.zoom)
      });
    };
    currentProps.onDragPointerMove(event, (previousViewport, nextViewport) => {
      const zoom = Number.isFinite(nextViewport.zoom) && nextViewport.zoom > 0 ? nextViewport.zoom : currentProps.zoom;
      dragStart.autoPanOffset = {
        x: dragStart.autoPanOffset.x + (previousViewport.x - nextViewport.x) / zoom,
        y: dragStart.autoPanOffset.y + (previousViewport.y - nextViewport.y) / zoom
      };
      publishDraft();
    });
    publishDraft();
    return true;
  };

  const applyResizeMove = (
    event: Pick<PointerEvent | React.PointerEvent, 'pointerId' | 'clientX' | 'clientY'>
  ): boolean => {
    const resizeStart = resizeStartRef.current;
    if (!resizeStart || resizeStart.pointerId !== event.pointerId) {
      return false;
    }

    lastResizeEventRef.current = {
      clientX: event.clientX,
      clientY: event.clientY
    };
    const currentProps = latestPropsRef.current;
    const publishDraft = (): void => {
      currentProps.onDraftGroup(currentProps.group.id, resolveGroupResizeGeometry(resizeStart, event, currentProps.zoom));
    };
    currentProps.onResizePointerMove(event, (previousViewport, nextViewport) => {
      const zoom = Number.isFinite(nextViewport.zoom) && nextViewport.zoom > 0 ? nextViewport.zoom : currentProps.zoom;
      resizeStart.autoPanOffset = {
        x: resizeStart.autoPanOffset.x + (previousViewport.x - nextViewport.x) / zoom,
        y: resizeStart.autoPanOffset.y + (previousViewport.y - nextViewport.y) / zoom
      };
      publishDraft();
    });
    publishDraft();
    return true;
  };

  const completeDrag = (
    event: Pick<PointerEvent | React.PointerEvent, 'pointerId' | 'clientX' | 'clientY' | 'timeStamp'>
  ): boolean => {
    const dragStart = dragStartRef.current;
    if (!dragStart || dragStart.pointerId !== event.pointerId) {
      return false;
    }

    dragStartRef.current = null;
    lastDragEventRef.current = null;
    const currentProps = latestPropsRef.current;
    const position = resolveGroupDragPosition(dragStart, event, currentProps.zoom);
    currentProps.onDragEnd();
    if (
      !hasGroupPointerCommitMovement(dragStart, event, currentProps.zoom) ||
      positionsEqual(position, dragStart.position)
    ) {
      currentProps.onDraftGroup(currentProps.group.id, null);
      currentProps.onGroupInteractionEnd(currentProps.group.id);
      if (dragStart.source === 'titlebar') {
        rememberTitlebarPointerClick(event);
      } else {
        clearTitlebarPointerClickMemory();
      }
      return true;
    }

    clearTitlebarPointerClickMemory();
    currentProps.onGroupInteractionEnd(currentProps.group.id);
    currentProps.onMoveGroup(currentProps.group.id, position, {
      x: Math.round(position.x + dragStart.pointerOffset.x),
      y: Math.round(position.y + dragStart.pointerOffset.y)
    });
    return true;
  };

  const completeResize = (
    event: Pick<PointerEvent | React.PointerEvent, 'pointerId' | 'clientX' | 'clientY'>
  ): boolean => {
    const resizeStart = resizeStartRef.current;
    if (!resizeStart || resizeStart.pointerId !== event.pointerId) {
      return false;
    }

    resizeStartRef.current = null;
    lastResizeEventRef.current = null;
    const currentProps = latestPropsRef.current;
    const resizedGeometry = resolveGroupResizeGeometry(resizeStart, event, currentProps.zoom);
    currentProps.onResizeEnd();
    if (
      !hasGroupPointerCommitMovement(resizeStart, event, currentProps.zoom) ||
      (positionsEqual(resizedGeometry.position, resizeStart.position) &&
        footprintsEqual(resizedGeometry.size, resizeStart.size))
    ) {
      currentProps.onDraftGroup(currentProps.group.id, null);
      currentProps.onGroupInteractionEnd(currentProps.group.id);
      return true;
    }

    clearTitlebarPointerClickMemory();
    currentProps.onGroupInteractionEnd(currentProps.group.id);
    currentProps.onResizeGroup(currentProps.group.id, resizedGeometry.position, resizedGeometry.size);
    return true;
  };

  const cancelActiveGroupInteraction = (
    event?: Pick<PointerEvent | React.PointerEvent, 'pointerId'>
  ): boolean => {
    const hasMatchingDrag = Boolean(
      dragStartRef.current && (!event || dragStartRef.current.pointerId === event.pointerId)
    );
    const hasMatchingResize = Boolean(
      resizeStartRef.current && (!event || resizeStartRef.current.pointerId === event.pointerId)
    );
    if (!hasMatchingDrag && !hasMatchingResize) {
      return false;
    }

    dragStartRef.current = null;
    resizeStartRef.current = null;
    lastDragEventRef.current = null;
    lastResizeEventRef.current = null;
    ignoreNextClickSelectionRef.current = false;
    clearTitlebarPointerClickMemory();
    const currentProps = latestPropsRef.current;
    currentProps.onDraftGroup(currentProps.group.id, null);
    currentProps.onGroupInteractionEnd(currentProps.group.id);
    if (hasMatchingDrag) {
      currentProps.onDragEnd();
    }
    if (hasMatchingResize) {
      currentProps.onResizeEnd();
    }
    return true;
  };

  useEffect(() => {
    const handleWindowPointerMove = (event: PointerEvent): void => {
      if (!applyDragMove(event) && !applyResizeMove(event)) {
        return;
      }

      stopCanvasEvent(event);
    };

    const handleWindowPointerUp = (event: PointerEvent): void => {
      if (!completeDrag(event) && !completeResize(event)) {
        return;
      }

      stopCanvasEvent(event);
    };

    const handleWindowPointerCancel = (event: PointerEvent): void => {
      if (!cancelActiveGroupInteraction(event)) {
        return;
      }

      stopCanvasEvent(event);
    };

    const handleWindowBlur = (): void => {
      cancelActiveGroupInteraction();
    };

    window.addEventListener('pointermove', handleWindowPointerMove, true);
    window.addEventListener('pointerup', handleWindowPointerUp, true);
    window.addEventListener('pointercancel', handleWindowPointerCancel, true);
    window.addEventListener('blur', handleWindowBlur);
    return () => {
      window.removeEventListener('pointermove', handleWindowPointerMove, true);
      window.removeEventListener('pointerup', handleWindowPointerUp, true);
      window.removeEventListener('pointercancel', handleWindowPointerCancel, true);
      window.removeEventListener('blur', handleWindowBlur);
    };
  });

  useEffect(() => () => {
    cancelActiveGroupInteraction();
  }, []);

  const beginDrag = (event: React.PointerEvent, source: 'titlebar' | 'border'): void => {
    if (event.button !== 0 || isInteractiveTarget(event.target)) {
      return;
    }
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      stopCanvasEvent(event);
      ignoreNextClickSelectionRef.current = true;
      props.onSelectGroup(props.group.id, event);
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    stopCanvasEvent(event);
    props.onSelectGroup(props.group.id);
    props.onGroupInteractionStart(props.group.id);
    lastDragEventRef.current = {
      clientX: event.clientX,
      clientY: event.clientY
    };
    lastResizeEventRef.current = null;
    dragStartRef.current = {
      pointerId: event.pointerId,
      source,
      clientX: event.clientX,
      clientY: event.clientY,
      position: props.group.position,
      pointerOffset: resolvePointerOffsetInGroup(event),
      autoPanOffset: { x: 0, y: 0 }
    };
  };

  const handleDragMove = (event: React.PointerEvent): void => {
    if (applyDragMove(event)) {
      stopCanvasEvent(event);
    }
  };

  const endDrag = (event: React.PointerEvent): void => {
    if (completeDrag(event)) {
      stopCanvasEvent(event);
    }
  };

  const beginResize = (event: React.PointerEvent, direction: CanvasGroupResizeDirection): void => {
    if (event.button !== 0) {
      return;
    }
    if (takeTitlebarDoubleClickPointerIntent(event)) {
      event.preventDefault();
      stopCanvasEvent(event);
      props.onSelectGroup(props.group.id);
      props.onFocusGroupInViewport(props.group.id);
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    stopCanvasEvent(event);
    props.onSelectGroup(props.group.id);
    props.onGroupInteractionStart(props.group.id);
    clearTitlebarPointerClickMemory();
    lastDragEventRef.current = null;
    lastResizeEventRef.current = {
      clientX: event.clientX,
      clientY: event.clientY
    };
    resizeStartRef.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      position: props.group.position,
      size: props.group.size,
      direction,
      autoPanOffset: { x: 0, y: 0 }
    };
  };

  const handleResizeMove = (event: React.PointerEvent): void => {
    if (applyResizeMove(event)) {
      stopCanvasEvent(event);
    }
  };

  const endResize = (event: React.PointerEvent): void => {
    if (completeResize(event)) {
      stopCanvasEvent(event);
    }
  };

  const handleFocusDoubleClick = (event: React.MouseEvent<HTMLElement>): void => {
    if (isGroupChromeFocusBlockedTarget(event.target)) {
      return;
    }

    dragStartRef.current = null;
    resizeStartRef.current = null;
    clearTitlebarPointerClickMemory();
    props.onDraftGroup(props.group.id, null);
    props.onDragEnd();
    props.onResizeEnd();
    handleGroupChromeDoubleClick(event, props.group.id, props.onFocusGroupInViewport);
  };

  const handleContextMenu = (event: React.MouseEvent): void => {
    props.onGroupContextMenu(event, props.group.id);
  };

  return (
    <div
      className={`canvas-group-frame nodrag nopan${props.selected ? ' is-selected' : ''}`}
      data-group-id={props.group.id}
      style={createCanvasGroupFrameStyle(props.group, props.zoom, props.selected)}
      onPointerDownCapture={handleModifierSelectionPointerDownCapture}
      onClickCapture={(event) => {
        if (!ignoreNextClickSelectionRef.current) {
          return;
        }
        ignoreNextClickSelectionRef.current = false;
        event.preventDefault();
        stopCanvasEvent(event);
      }}
      onClick={(event) => {
        stopCanvasEvent(event);
        if (event.ctrlKey || event.metaKey) {
          return;
        }
        selectGroup();
      }}
      onContextMenu={handleContextMenu}
      onPointerMove={(event) => {
        handleDragMove(event);
        handleResizeMove(event);
      }}
      onPointerUp={(event) => {
        endDrag(event);
        endResize(event);
      }}
      onPointerCancel={(event) => {
        if (cancelActiveGroupInteraction(event)) {
          stopCanvasEvent(event);
        }
      }}
    >
      <div className="canvas-group-body" aria-hidden="true" />
      <div
        className="canvas-group-titlebar"
        onPointerDown={(event) => beginDrag(event, 'titlebar')}
        onDoubleClick={handleFocusDoubleClick}
      >
        <ChromeTitleEditor
          value={props.group.title}
          placeholder={props.t('group.title.placeholder')}
          className="canvas-group-title"
          tooltip={isWorkspaceRootGroup ? props.group.workspaceRootPath ?? props.group.title : undefined}
          readOnly={isWorkspaceRootGroup}
          onSubmit={isWorkspaceRootGroup ? undefined : (title) => props.onUpdateGroupTitle(props.group.id, title)}
          onSelectNode={() => selectGroup()}
        />
      </div>
      <div className="canvas-group-border canvas-group-border-top" onPointerDown={(event) => beginDrag(event, 'border')} />
      <div className="canvas-group-border canvas-group-border-right" onPointerDown={(event) => beginDrag(event, 'border')} />
      <div className="canvas-group-border canvas-group-border-bottom" onPointerDown={(event) => beginDrag(event, 'border')} />
      <div className="canvas-group-border canvas-group-border-left" onPointerDown={(event) => beginDrag(event, 'border')} />
      {props.selected ? (
        <>
          {CANVAS_GROUP_RESIZE_LINE_DIRECTIONS.map((direction) => (
            <span
              key={`line-${direction}`}
              className={`canvas-group-resize-line canvas-group-resize-line-${direction}`}
              aria-hidden="true"
            />
          ))}
          {CANVAS_GROUP_RESIZE_DIRECTIONS.map((direction) => (
            <button
              key={direction}
              type="button"
              className={`canvas-group-resize-control canvas-group-resize-${direction} nodrag nopan`}
              data-group-resize-direction={direction}
              data-resize-direction={direction}
              aria-label={props.t('canvas.resizeGroup', { direction, title: props.group.title })}
              style={{ cursor: canvasNodeResizeCursorForDirection(direction) }}
              onPointerDown={(event) => beginResize(event, direction)}
            />
          ))}
        </>
      ) : null}
      {props.selected && !isWorkspaceRootGroup ? (
        <div
          ref={toolbarRef}
          className="canvas-group-toolbar"
          data-group-toolbar="true"
          data-node-interactive="true"
          onPointerDown={stopCanvasEvent}
          onMouseDown={stopCanvasEvent}
          onClick={stopCanvasEvent}
        >
          <button
            type="button"
            className="canvas-group-split-primary"
            onClick={(event) => {
              stopCanvasEvent(event);
              props.onUngroup(props.group.id);
            }}
          >
            {props.t('group.action.ungroup')}
          </button>
          <button
            type="button"
            className="canvas-group-split-danger"
            onClick={(event) => {
              stopCanvasEvent(event);
              props.onDeleteGroup(props.group.id);
            }}
          >
            {props.t('group.action.delete')}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function groupDepthForWebview(groups: readonly CanvasGroupSummary[], groupId: string): number {
  let depth = 0;
  let current = groups.find((group) => group.id === groupId);
  const visited = new Set<string>();
  while (current?.parentGroupId && !visited.has(current.parentGroupId)) {
    visited.add(current.parentGroupId);
    depth += 1;
    current = groups.find((group) => group.id === current?.parentGroupId);
  }
  return depth;
}
