import React, { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import ReactFlow, {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  getViewportForBounds,
  type Connection,
  type Edge,
  type EdgeMouseHandler,
  type NodeMouseHandler,
  type ReactFlowInstance,
  type Viewport
} from 'reactflow';

import type {
  CanvasGroupSummary,
  CanvasNodeFootprint,
  CanvasNodePosition,
  CanvasNodeSummary,
  CanvasOverviewMode,
  CanvasRuntimeContext,
  CanvasStrongTerminalAttentionReminderMode
} from '../common/protocol';
import { strongTerminalAttentionReminderShowsTitleBar } from '../common/protocol';
import { canvasStatusToneClass as statusToneClass } from '../common/canvasNodeStatusPresentation';
import { stopCanvasEvent } from './canvasDomEvents';
import { CanvasGroupsViewportLayer } from './canvasGroupLayers';
import { collectGroupSubtreeIdsForWebview, resolveContainingWorkspaceRootGroupIdForWebview } from './canvasGraphRules';
import {
  CANVAS_MAX_ZOOM,
  CanvasMiniMap,
  CanvasOverviewModeBridge,
  PANE_GALLERY_FIT_VIEW_PADDING,
  PANE_GALLERY_MIN_ZOOM,
  resolveCanvasSpatialBounds
} from './canvasMiniMap';
import type {
  CanvasFlowEdge,
  CanvasFlowNode,
  CanvasGroupDraft,
  CanvasMiniMapRect,
  CanvasNodeData,
  CanvasOverviewViewportState,
  CanvasSurfaceBinding,
  CanvasViewportSize,
  PaneGalleryRootModel
} from './canvasTypes';
import {
  isPaneGalleryThumbnailLayout,
  type PaneGalleryLayoutMode,
  type PaneGalleryOverviewLayoutMode,
  type PaneGalleryThumbnailLayoutMode,
  type PaneGalleryViewportRole
} from './paneGalleryLocalState';
import type { WebviewI18nKey } from './i18n/webviewI18n';

type PaneGalleryTranslator = (key: WebviewI18nKey, params?: Record<string, string | number>) => string;
type PaneGalleryCountTranslator = (oneKey: WebviewI18nKey, otherKey: WebviewI18nKey, count: number) => string;

type PaneGalleryPaneStatus = 'idle' | 'running' | 'attention';

function paneGalleryNodeHasAttention(node: CanvasFlowNode): boolean {
  return (
    node.data?.metadata?.agent?.attentionPending === true ||
    node.data?.metadata?.terminal?.attentionPending === true
  );
}

function paneGalleryNodeIsRunning(node: CanvasNodeSummary): boolean {
  switch (node.status) {
    case 'launching':
    case 'starting':
    case 'resuming':
    case 'reattaching':
    case 'running':
    case 'live':
      return true;
    default:
      return false;
  }
}

function paneGalleryNodeShowsRunningTitleBlock(node: CanvasNodeSummary): boolean {
  return node.status === 'running';
}

function paneGalleryPaneStatusForModel(model: PaneGalleryRootModel): PaneGalleryPaneStatus {
  if (model.attentionCount > 0) {
    return 'attention';
  }
  if (model.runningCount > 0) {
    return 'running';
  }
  return 'idle';
}

function paneGalleryPaneStatusDescription(
  model: PaneGalleryRootModel,
  t: PaneGalleryTranslator,
  tCount: PaneGalleryCountTranslator
): string | undefined {
  const fragments: string[] = [];
  if (model.attentionCount > 0) {
    fragments.push(tCount('paneGallery.count.attention.one', 'paneGallery.count.attention.other', model.attentionCount));
  }
  if (model.runningCount > 0) {
    fragments.push(tCount('paneGallery.count.running.one', 'paneGallery.count.running.other', model.runningCount));
  }
  return fragments.length > 0 ? fragments.join(t('paneGallery.statusSeparator')) : undefined;
}

export function buildPaneGalleryRootModels(params: {
  rootGroups: readonly CanvasGroupSummary[];
  groups: readonly CanvasGroupSummary[];
  nodes: readonly CanvasFlowNode[];
  edges: readonly CanvasFlowEdge[];
  hostNodes: readonly CanvasNodeSummary[];
  workspaceFolders: readonly CanvasRuntimeContext['workspaceFolders'][number][];
  strongTerminalAttentionReminderMode: CanvasStrongTerminalAttentionReminderMode;
}): PaneGalleryRootModel[] {
  const hostNodesById = new Map(params.hostNodes.map((node) => [node.id, node] as const));
  const nodeRootGroupIds = new Map<string, string>();
  for (const hostNode of params.hostNodes) {
    const rootGroupId = resolveContainingWorkspaceRootGroupIdForWebview(params.groups, hostNode.groupId);
    if (rootGroupId) {
      nodeRootGroupIds.set(hostNode.id, rootGroupId);
    }
  }

  const orderedRootGroups = sortPaneGalleryRootGroupsByWorkspaceOrder(params.rootGroups, params.workspaceFolders);

  return orderedRootGroups.map((rootGroup) => {
    const subtreeGroupIds = collectGroupSubtreeIdsForWebview(params.groups, rootGroup.id);
    const paneNodes = params.nodes.filter((node) => nodeRootGroupIds.get(node.id) === rootGroup.id);
    const paneNodeIds = new Set(paneNodes.map((node) => node.id));
    const paneEdges = params.edges.filter((edge) => paneNodeIds.has(edge.source) && paneNodeIds.has(edge.target));
    const paneHostNodes = paneNodes.flatMap((node) => {
      const hostNode = hostNodesById.get(node.id);
      return hostNode ? [hostNode] : [];
    });
    const attentionCount = paneNodes.filter((node) => paneGalleryNodeHasAttention(node)).length;
    return {
      rootGroup,
      nodes: paneNodes,
      edges: paneEdges,
      groups: params.groups.filter((group) => group.id !== rootGroup.id && subtreeGroupIds.has(group.id)),
      nodeCount: paneNodes.length,
      runningCount: paneHostNodes.filter((node) => paneGalleryNodeIsRunning(node)).length,
      runningTitleBlockCount: paneHostNodes.filter((node) => paneGalleryNodeShowsRunningTitleBlock(node)).length,
      errorCount: paneHostNodes.filter((node) => statusToneClass(node.status) === 'tone-error').length,
      waitingCount: paneHostNodes.filter((node) => statusToneClass(node.status) === 'tone-waiting').length,
      attentionCount,
      attentionTitleBarFlashing:
        attentionCount > 0 && strongTerminalAttentionReminderShowsTitleBar(params.strongTerminalAttentionReminderMode)
    };
  });
}

export function resolvePaneGalleryModelContentBounds(model: PaneGalleryRootModel): CanvasMiniMapRect | undefined {
  return resolveCanvasSpatialBounds(model.nodes, model.groups).bounds;
}

function sortPaneGalleryRootGroupsByWorkspaceOrder(
  rootGroups: readonly CanvasGroupSummary[],
  workspaceFolders: readonly CanvasRuntimeContext['workspaceFolders'][number][]
): CanvasGroupSummary[] {
  const originalIndexes = new Map(rootGroups.map((group, index) => [group.id, index] as const));
  const workspaceRootIndexes = new Map<string, number>();
  workspaceFolders.forEach((folder, index) => {
    const normalizedPath = normalizePaneGalleryRootOrderPath(folder.path);
    if (normalizedPath && !workspaceRootIndexes.has(normalizedPath)) {
      workspaceRootIndexes.set(normalizedPath, index);
    }
  });

  return [...rootGroups].sort((left, right) => {
    const leftWorkspaceIndex = readPaneGalleryWorkspaceRootIndex(left, workspaceRootIndexes);
    const rightWorkspaceIndex = readPaneGalleryWorkspaceRootIndex(right, workspaceRootIndexes);
    if (leftWorkspaceIndex !== rightWorkspaceIndex) {
      if (leftWorkspaceIndex === undefined) {
        return 1;
      }
      if (rightWorkspaceIndex === undefined) {
        return -1;
      }
      return leftWorkspaceIndex - rightWorkspaceIndex;
    }

    return (originalIndexes.get(left.id) ?? 0) - (originalIndexes.get(right.id) ?? 0);
  });
}

function readPaneGalleryWorkspaceRootIndex(
  group: CanvasGroupSummary,
  workspaceRootIndexes: ReadonlyMap<string, number>
): number | undefined {
  const normalizedPath = normalizePaneGalleryRootOrderPath(group.workspaceRootPath);
  return normalizedPath ? workspaceRootIndexes.get(normalizedPath) : undefined;
}

function normalizePaneGalleryRootOrderPath(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  const slashNormalized = trimmed.replace(/\\/g, '/');
  const normalized =
    slashNormalized === '/' || /^[A-Za-z]:\/$/u.test(slashNormalized)
      ? slashNormalized
      : slashNormalized.replace(/\/+$/u, '');
  const caseInsensitive = /^[A-Za-z]:\//u.test(slashNormalized) || trimmed.includes('\\');
  return caseInsensitive ? normalized.toLowerCase() : normalized;
}

export interface PaneGalleryProps {
  models: PaneGalleryRootModel[];
  allModels: PaneGalleryRootModel[];
  activeRootGroupId?: string;
  layout: PaneGalleryLayoutMode;
  lastOverviewLayout: PaneGalleryOverviewLayoutMode;
  lastThumbnailLayout: PaneGalleryThumbnailLayoutMode;
  overviewViewports: Record<string, Viewport>;
  mainViewports: Record<string, Viewport>;
  selectedGroupIds: string[];
  overviewMode: CanvasOverviewMode;
  overviewZoomThreshold: number;
  paneRefs: React.MutableRefObject<Record<string, HTMLDivElement | null>>;
  flowRefs: React.MutableRefObject<Record<string, ReactFlowInstance<CanvasNodeData> | undefined>>;
  onBindActiveSurface: (rootGroupId: string, viewportRole?: PaneGalleryViewportRole) => CanvasSurfaceBinding;
  shouldSkipInitialFit?: (rootGroupId: string, viewportRole: PaneGalleryViewportRole) => boolean;
  onSetLayout: (layout: PaneGalleryLayoutMode, activeRootGroupId?: string) => void;
  onFitPane: (
    rootGroupId: string,
    instance?: ReactFlowInstance<CanvasNodeData>,
    duration?: number,
    options?: { viewportRole?: PaneGalleryViewportRole }
  ) => boolean;
  onSavePaneViewport: (rootGroupId: string, viewport: Viewport, viewportRole?: PaneGalleryViewportRole) => void;
  onNodesChange: (changes: any[]) => void;
  onNodeDragStart: (
    rootGroupId: string,
    event: React.MouseEvent,
    node: CanvasFlowNode,
    draggedNodes: CanvasFlowNode[]
  ) => void;
  onNodeDragStop: (
    rootGroupId: string,
    event: React.MouseEvent,
    node: CanvasFlowNode,
    draggedNodes: CanvasFlowNode[]
  ) => void;
  onConnect: (connection: Connection) => void;
  onEdgeClick: EdgeMouseHandler;
  onEdgeDoubleClick: EdgeMouseHandler;
  onReconnect: (previousEdge: Edge, connection: Connection) => void;
  onEdgeContextMenu: EdgeMouseHandler;
  onNodeClick: NodeMouseHandler;
  onPaneClick: (event: React.MouseEvent, rootGroupId: string) => void;
  onPaneContextMenu: (event: React.MouseEvent, rootGroupId: string, targetGroupId?: string) => void;
  onPaneDragOver: (event: React.DragEvent, rootGroupId: string) => void;
  onPaneDrop: (event: React.DragEvent, rootGroupId: string) => void;
  onSelectGroupBody: (
    groupId: string,
    event?: Pick<React.MouseEvent | React.PointerEvent | MouseEvent, 'ctrlKey' | 'metaKey'>
  ) => void;
  onFocusGroupInViewport: (groupId: string) => boolean;
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
  t: PaneGalleryTranslator;
  tCount: PaneGalleryCountTranslator;
  nodeTypes: NonNullable<React.ComponentProps<typeof ReactFlow>['nodeTypes']>;
  edgeTypes: NonNullable<React.ComponentProps<typeof ReactFlow>['edgeTypes']>;
  nodeFocusAnimationDurationMs: number;
}

const PANE_GALLERY_LAYOUT_OPTIONS: ReadonlyArray<{
  layout: PaneGalleryLayoutMode;
  labelKey: WebviewI18nKey;
  icon: string;
}> = [
  { layout: 'dynamic', labelKey: 'paneGallery.layout.dynamic', icon: 'layout' },
  { layout: 'grid', labelKey: 'paneGallery.layout.grid', icon: 'table' },
  { layout: 'topThumbnails', labelKey: 'paneGallery.layout.topThumbnails', icon: 'split-vertical' },
  { layout: 'sideThumbnails', labelKey: 'paneGallery.layout.sideThumbnails', icon: 'split-horizontal' }
];

const PANE_GALLERY_FIT_VIEW_ICON = (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 25 32" aria-hidden="true" focusable="false">
    <path d="M3.692 4.63c0-.53.4-.938.939-.938h5.215V0H4.708C2.13 0 0 2.054 0 4.63v5.216h3.692V4.631zM20.292 0h-5.2v3.692h5.17c.53 0 .984.4.984.939v5.215h3.692V4.631A4.624 4.624 0 0020.292 0zm.954 24.83c0 .532-.4.94-.939.94h-5.215v3.768h5.215c2.577 0 4.631-2.13 4.631-4.707v-5.139h-3.692v5.139zm-16.615.94c-.531 0-.939-.4-.939-.94v-5.138H0v5.139c0 2.577 2.13 4.707 4.708 4.707h5.138V25.77H4.631z" />
  </svg>
);

function paneGalleryControlTargetOptions(): ReadonlyArray<(typeof PANE_GALLERY_LAYOUT_OPTIONS)[number]> {
  return PANE_GALLERY_LAYOUT_OPTIONS;
}

function paneGalleryCoarseToggleTarget(
  layout: PaneGalleryLayoutMode,
  lastOverviewLayout: PaneGalleryOverviewLayoutMode,
  lastThumbnailLayout: PaneGalleryThumbnailLayoutMode
): PaneGalleryLayoutMode {
  return isPaneGalleryThumbnailLayout(layout) ? lastOverviewLayout : lastThumbnailLayout;
}

export function PaneGallery(props: PaneGalleryProps): JSX.Element {
  const activeModel = props.allModels.find((model) => model.rootGroup.id === props.activeRootGroupId) ?? props.allModels[0];
  const isThumbnailLayout = isPaneGalleryThumbnailLayout(props.layout);
  const railModels = isThumbnailLayout && activeModel ? props.allModels : [];

  return (
    <div
      className={`pane-gallery pane-gallery-${props.layout}`}
      data-pane-gallery="true"
      data-pane-gallery-layout={props.layout}
      data-pane-gallery-count={props.allModels.length}
    >
      {isThumbnailLayout && activeModel ? (
        <div className={`pane-gallery-thumbnail-layout pane-gallery-thumbnail-layout-${props.layout}`}>
          {props.layout === 'topThumbnails' ? (
            <PaneGalleryThumbnailRail
              {...props}
              layout={props.layout}
              models={railModels}
              onActivate={(rootGroupId) => props.onSetLayout(props.layout, rootGroupId)}
            />
          ) : null}
          <PaneGalleryRootPane
            {...props}
            key={activeModel.rootGroup.id}
            model={activeModel}
            mode="main"
          />
          {props.layout === 'sideThumbnails' ? (
            <PaneGalleryThumbnailRail
              {...props}
              layout={props.layout}
              models={railModels}
              onActivate={(rootGroupId) => props.onSetLayout(props.layout, rootGroupId)}
            />
          ) : null}
        </div>
      ) : (
        <div className={`pane-gallery-grid pane-gallery-grid-${props.layout}`} data-pane-gallery-grid="true">
          {props.models.map((model, index) => (
            <PaneGalleryRootPane
              {...props}
              key={model.rootGroup.id}
              model={model}
              mode="tile"
              dynamicSlot={paneGalleryDynamicSlotForIndex(index, props.models.length)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function paneGalleryDynamicSlotForIndex(index: number, count: number): 'wide' | 'tall' | 'large' | 'base' {
  if (count <= 1) {
    return 'large';
  }
  if (count === 2) {
    return index === 0 ? 'wide' : 'base';
  }
  if (count === 3) {
    return index === 0 ? 'large' : 'base';
  }
  if (count === 4) {
    return index === 0 ? 'wide' : index === 3 ? 'tall' : 'base';
  }
  if (index === 0) {
    return 'large';
  }
  if (index % 5 === 1) {
    return 'wide';
  }
  if (index % 5 === 3) {
    return 'tall';
  }
  return 'base';
}

function PaneGalleryThumbnailRail(props: PaneGalleryProps & {
  layout: Extract<PaneGalleryLayoutMode, 'topThumbnails' | 'sideThumbnails'>;
  models: PaneGalleryRootModel[];
  onActivate: (rootGroupId: string) => void;
}): JSX.Element {
  return (
    <div
      className={`pane-gallery-thumbnail-rail pane-gallery-thumbnail-rail-${props.layout}`}
      aria-label={props.t('paneGallery.otherWorkspaceRoots')}
      data-pane-gallery-thumbnail-rail={props.layout}
    >
      <div
        className={`pane-gallery-thumbnail-track pane-gallery-thumbnail-track-${props.layout}`}
        data-pane-gallery-thumbnail-track={props.layout}
      >
        {props.models.map((model) =>
          model.rootGroup.id === props.activeRootGroupId ? (
            <PaneGalleryActiveRootPlaceholder
              key={model.rootGroup.id}
              model={model}
              t={props.t}
              tCount={props.tCount}
            />
          ) : (
            <PaneGalleryRootPane
              {...props}
              key={model.rootGroup.id}
              model={model}
              mode="thumbnail"
              onThumbnailActivate={props.onActivate}
            />
          )
        )}
      </div>
    </div>
  );
}

function paneGalleryRootPaneTitle(model: PaneGalleryRootModel, statusDescription?: string): string {
  return `${model.rootGroup.title}${model.rootGroup.workspaceRootPath ? ` - ${model.rootGroup.workspaceRootPath}` : ''}${statusDescription ? ` - ${statusDescription}` : ''}`;
}

function PaneGalleryActiveRootPlaceholder(props: {
  model: PaneGalleryRootModel;
  t: PaneGalleryTranslator;
  tCount: PaneGalleryCountTranslator;
}): JSX.Element {
  const { model } = props;
  const paneStatus = paneGalleryPaneStatusForModel(model);
  const paneStatusDescription = paneGalleryPaneStatusDescription(model, props.t, props.tCount);
  const paneTitle = `${paneGalleryRootPaneTitle(model, paneStatusDescription)} - ${props.t('paneGallery.activeRoot.titleSuffix')}`;
  const ariaLabel = props.t('paneGallery.activeRoot.aria', {
    title: model.rootGroup.title,
    path: model.rootGroup.workspaceRootPath
      ? props.t('paneGallery.activeRoot.aria.path', { path: model.rootGroup.workspaceRootPath })
      : '',
    status: paneStatusDescription ? props.t('paneGallery.activeRoot.aria.status', { status: paneStatusDescription }) : ''
  });
  const attentionTitleBarFlashing = model.attentionTitleBarFlashing;
  const rootRunningTitleBlock = model.runningTitleBlockCount > 0 && model.attentionCount === 0;
  const blockPlaceholderEvent = (event: React.SyntheticEvent): void => {
    event.preventDefault();
    stopCanvasEvent(event);
  };

  return (
    <section
      className="pane-gallery-root-pane pane-gallery-root-pane-active-placeholder"
      data-pane-gallery-active-placeholder="true"
      data-pane-gallery-root-id={model.rootGroup.id}
      data-pane-gallery-root-mode="active-placeholder"
      data-pane-gallery-status={paneStatus}
      data-pane-gallery-attention-count={model.attentionCount}
      data-pane-gallery-running-count={model.runningCount}
      data-pane-gallery-attention-flashing={attentionTitleBarFlashing ? 'true' : 'false'}
      aria-label={ariaLabel}
      title={paneTitle}
      onPointerDown={blockPlaceholderEvent}
      onPointerMove={blockPlaceholderEvent}
      onPointerUp={blockPlaceholderEvent}
      onPointerCancel={blockPlaceholderEvent}
      onWheel={blockPlaceholderEvent}
      onClick={blockPlaceholderEvent}
      onDoubleClick={blockPlaceholderEvent}
      onContextMenu={blockPlaceholderEvent}
      onDragStart={blockPlaceholderEvent}
      onDragOver={blockPlaceholderEvent}
      onDrop={blockPlaceholderEvent}
    >
      <header
        className={[
          'pane-gallery-root-header',
          attentionTitleBarFlashing ? 'is-attention-flashing' : '',
          rootRunningTitleBlock ? 'is-pane-gallery-root-running-title-block' : ''
        ]
          .filter(Boolean)
          .join(' ')}
        data-pane-gallery-root-header-attention-flashing={attentionTitleBarFlashing ? 'true' : 'false'}
        data-pane-gallery-root-running-title-block={rootRunningTitleBlock ? 'true' : 'false'}
      >
        <div className="pane-gallery-root-title-block">
          <span className="pane-gallery-root-title" title={model.rootGroup.workspaceRootPath ?? model.rootGroup.title}>
            {model.rootGroup.title}
          </span>
        </div>
      </header>
      <div className="pane-gallery-active-placeholder-body" aria-hidden="true">
        <span className="pane-gallery-active-placeholder-label">{props.t('paneGallery.activeRoot.label')}</span>
      </div>
    </section>
  );
}

function PaneGalleryControls(props: {
  layout: PaneGalleryLayoutMode;
  lastOverviewLayout: PaneGalleryOverviewLayoutMode;
  lastThumbnailLayout: PaneGalleryThumbnailLayoutMode;
  rootGroupId: string;
  onFitView: () => void;
  onSetLayout: (layout: PaneGalleryLayoutMode, activeRootGroupId?: string) => void;
  t: PaneGalleryTranslator;
}): JSX.Element {
  return (
    <Controls
      className="canvas-corner-panel canvas-controls pane-gallery-canvas-controls"
      showInteractive={false}
      showFitView={false}
    >
      <button
        type="button"
        className="react-flow__controls-button react-flow__controls-fitview"
        title={props.t('canvas.fitView')}
        aria-label={props.t('canvas.fitView')}
        onClick={(event) => {
          stopCanvasEvent(event);
          props.onFitView();
        }}
      >
        {PANE_GALLERY_FIT_VIEW_ICON}
      </button>
      <PaneGalleryModeControl
        layout={props.layout}
        lastOverviewLayout={props.lastOverviewLayout}
        lastThumbnailLayout={props.lastThumbnailLayout}
        rootGroupId={props.rootGroupId}
        onSetLayout={props.onSetLayout}
        t={props.t}
      />
    </Controls>
  );
}

function PaneGalleryModeControl(props: {
  layout: PaneGalleryLayoutMode;
  lastOverviewLayout: PaneGalleryOverviewLayoutMode;
  lastThumbnailLayout: PaneGalleryThumbnailLayoutMode;
  rootGroupId: string;
  onSetLayout: (layout: PaneGalleryLayoutMode, activeRootGroupId?: string) => void;
  t: PaneGalleryTranslator;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const thumbnailLayout = isPaneGalleryThumbnailLayout(props.layout);
  const targetOptions = paneGalleryControlTargetOptions();
  const controlIcon = thumbnailLayout ? 'globe' : 'eye';
  const controlLabel = thumbnailLayout ? props.t('paneGallery.mode.returnOverview') : props.t('paneGallery.mode.switchThumbnails');
  const coarseTargetLayout = paneGalleryCoarseToggleTarget(
    props.layout,
    props.lastOverviewLayout,
    props.lastThumbnailLayout
  );

  const closeIfFocusLeaves = (event: React.FocusEvent<HTMLDivElement>): void => {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof globalThis.Node && event.currentTarget.contains(nextTarget)) {
      return;
    }
    setOpen(false);
  };

  return (
    <div
      className="pane-gallery-control-mode"
      data-pane-gallery-control-mode="true"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={closeIfFocusLeaves}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          stopCanvasEvent(event);
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        className="react-flow__controls-button pane-gallery-control-mode-trigger"
        aria-label={controlLabel}
        title={controlLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        data-pane-gallery-mode-trigger="true"
        onClick={(event) => {
          stopCanvasEvent(event);
          setOpen(false);
          props.onSetLayout(coarseTargetLayout, props.rootGroupId);
        }}
      >
        <span className={`codicon codicon-${controlIcon}`} aria-hidden="true" />
      </button>
      {open ? (
        <div className="pane-gallery-control-mode-menu" role="menu" aria-label={controlLabel}>
          {targetOptions.map((option) => (
            <button
              key={option.layout}
              type="button"
              role="menuitemradio"
              aria-checked={props.layout === option.layout}
              className={props.layout === option.layout ? 'is-active' : ''}
              data-pane-gallery-mode-option={option.layout}
              onClick={(event) => {
                stopCanvasEvent(event);
                setOpen(false);
                props.onSetLayout(option.layout, props.rootGroupId);
              }}
            >
              <span className={`codicon codicon-${option.icon}`} aria-hidden="true" />
              <span>{props.t(option.labelKey)}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function PaneGalleryRootPane(props: PaneGalleryProps & {
  model: PaneGalleryRootModel;
  mode: 'tile' | 'main' | 'thumbnail';
  dynamicSlot?: 'wide' | 'tall' | 'large' | 'base';
  onThumbnailActivate?: (rootGroupId: string) => void;
}): JSX.Element {
  const { model } = props;
  const rootGroupId = model.rootGroup.id;
  const interactive = props.mode !== 'thumbnail';
  const viewportRole: PaneGalleryViewportRole = props.mode === 'main' ? 'main' : 'overview';
  const paneStatus = paneGalleryPaneStatusForModel(model);
  const paneStatusDescription = paneGalleryPaneStatusDescription(model, props.t, props.tCount);
  const attentionTitleBarFlashing = model.attentionTitleBarFlashing;
  const rootRunningTitleBlock = model.runningTitleBlockCount > 0 && model.attentionCount === 0;
  const paneTitle = paneGalleryRootPaneTitle(model, paneStatusDescription);
  const defaultViewport = interactive
    ? viewportRole === 'main'
      ? props.mainViewports[rootGroupId]
      : props.overviewViewports[rootGroupId]
    : undefined;
  const localPaneRef = useRef<HTMLDivElement | null>(null);
  const [paneViewportSize, setPaneViewportSize] = useState<CanvasViewportSize>({ width: 1, height: 1 });
  const [overviewState, setOverviewState] = useState<CanvasOverviewViewportState>({
    active: false,
    titleScale: 1
  });
  const bindSurface = (): CanvasSurfaceBinding => props.onBindActiveSurface(rootGroupId, viewportRole);
  const updatePaneViewportSize = useCallback((element: HTMLDivElement | null = localPaneRef.current): void => {
    if (!element) {
      return;
    }
    const nextSize = {
      width: Math.max(1, Math.round(element.clientWidth)),
      height: Math.max(1, Math.round(element.clientHeight))
    };
    setPaneViewportSize((current) =>
      current.width === nextSize.width && current.height === nextSize.height ? current : nextSize
    );
  }, []);
  const setFlowShellRef = useCallback((element: HTMLDivElement | null): void => {
    localPaneRef.current = element;
    if (interactive) {
      props.paneRefs.current[rootGroupId] = element;
    }
    updatePaneViewportSize(element);
  }, [interactive, props.paneRefs, rootGroupId, updatePaneViewportSize]);
  const activateThumbnail = (event: React.MouseEvent): void => {
    event.preventDefault();
    stopCanvasEvent(event);
    props.onThumbnailActivate?.(rootGroupId);
  };
  const blockThumbnailPointerEvent = (event: React.SyntheticEvent): void => {
    stopCanvasEvent(event);
  };
  const blockThumbnailDefaultEvent = (event: React.SyntheticEvent): void => {
    event.preventDefault();
    stopCanvasEvent(event);
  };
  const fitLocalPane = (instance: ReactFlowInstance<CanvasNodeData> | undefined, duration = 0): boolean => {
    const shell = localPaneRef.current;
    const contentBounds = resolvePaneGalleryModelContentBounds(model);
    if (!instance?.viewportInitialized || !shell || !contentBounds) {
      return false;
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
    if (interactive) {
      props.onSavePaneViewport(rootGroupId, viewport, viewportRole);
    }
    return true;
  };

  const paneNodes = useMemo(
    () =>
      model.nodes.map((node) => ({
        ...node,
        selected: interactive ? node.selected : false,
        data: {
          ...node.data,
          selected: interactive ? node.data.selected : false,
          overviewInteractionsDisabled: !interactive || overviewState.active
        }
      })),
    [interactive, model.nodes, overviewState.active]
  );
  const paneSpatialBounds = useMemo(
    () => resolveCanvasSpatialBounds(paneNodes, model.groups),
    [model.groups, paneNodes]
  );
  const handleOverviewViewportStateChange = useCallback((nextState: CanvasOverviewViewportState): void => {
    setOverviewState((current) =>
      current.active === nextState.active && Math.abs(current.titleScale - nextState.titleScale) < 0.01
        ? current
        : nextState
    );
  }, []);

  useEffect(() => {
    if (props.mode !== 'main') {
      return;
    }

    const element = localPaneRef.current;
    if (!element) {
      return;
    }

    updatePaneViewportSize(element);
    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(() => updatePaneViewportSize(element));
      observer.observe(element);
      return () => {
        observer.disconnect();
      };
    }

    const handleResize = (): void => updatePaneViewportSize(element);
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [props.mode, updatePaneViewportSize]);

  useEffect(
    () => () => {
      if (interactive) {
        props.flowRefs.current[rootGroupId] = undefined;
        props.paneRefs.current[rootGroupId] = null;
      }
    },
    [interactive, props.flowRefs, props.paneRefs, rootGroupId]
  );

  return (
    <section
      className={`pane-gallery-root-pane pane-gallery-root-pane-${props.mode} ${overviewState.active ? 'is-overview-mode' : ''}`.trim()}
      data-pane-gallery-root-id={rootGroupId}
      data-pane-gallery-root-mode={props.mode}
      data-pane-gallery-dynamic-slot={props.dynamicSlot}
      data-pane-gallery-status={paneStatus}
      data-pane-gallery-attention-count={model.attentionCount}
      data-pane-gallery-running-count={model.runningCount}
      data-pane-gallery-attention-flashing={attentionTitleBarFlashing ? 'true' : 'false'}
      data-canvas-overview-mode={overviewState.active ? 'true' : 'false'}
      data-canvas-overview-config={props.overviewMode}
      aria-label={`Workspace root ${model.rootGroup.title}${paneStatusDescription ? `, ${paneStatusDescription}` : ''}`}
      title={props.mode === 'thumbnail' ? paneTitle : undefined}
      style={{ '--canvas-overview-title-scale': overviewState.titleScale } as CSSProperties}
      onMouseEnter={interactive ? bindSurface : undefined}
      onFocusCapture={interactive ? bindSurface : undefined}
      onPointerDownCapture={interactive ? bindSurface : undefined}
      onDoubleClick={
        props.mode === 'thumbnail'
          ? (event) => {
              stopCanvasEvent(event);
              props.onThumbnailActivate?.(rootGroupId);
            }
          : undefined
      }
      onContextMenu={
        props.mode === 'thumbnail'
          ? (event) => {
              event.preventDefault();
              stopCanvasEvent(event);
            }
          : undefined
      }
    >
      <header
        className={[
          'pane-gallery-root-header',
          attentionTitleBarFlashing ? 'is-attention-flashing' : '',
          rootRunningTitleBlock ? 'is-pane-gallery-root-running-title-block' : ''
        ]
          .filter(Boolean)
          .join(' ')}
        data-pane-gallery-root-header-attention-flashing={attentionTitleBarFlashing ? 'true' : 'false'}
        data-pane-gallery-root-running-title-block={rootRunningTitleBlock ? 'true' : 'false'}
      >
        <div className="pane-gallery-root-title-block">
          <span className="pane-gallery-root-title" title={model.rootGroup.workspaceRootPath ?? model.rootGroup.title}>
            {model.rootGroup.title}
          </span>
        </div>
      </header>
      <div
        className={`pane-gallery-root-flow-shell ${interactive ? '' : 'is-inert'}`.trim()}
        ref={setFlowShellRef}
        onDragOver={interactive ? (event) => props.onPaneDragOver(event, rootGroupId) : undefined}
        onDrop={interactive ? (event) => props.onPaneDrop(event, rootGroupId) : undefined}
      >
        <ReactFlow
          key={`${rootGroupId}-${props.mode}`}
          nodes={paneNodes}
          edges={model.edges}
          nodeTypes={props.nodeTypes}
          edgeTypes={props.edgeTypes}
          connectionMode={ConnectionMode.Loose}
          defaultViewport={defaultViewport}
          minZoom={PANE_GALLERY_MIN_ZOOM}
          maxZoom={CANVAS_MAX_ZOOM}
          nodesDraggable={interactive}
          nodesConnectable={interactive}
          nodesFocusable={interactive}
          edgesFocusable={interactive}
          elementsSelectable={interactive}
          panOnDrag={interactive}
          zoomOnScroll={interactive}
          zoomOnPinch={interactive}
          zoomOnDoubleClick={interactive}
          preventScrolling={interactive}
          onInit={(instance) => {
            if (interactive) {
              props.flowRefs.current[rootGroupId] = instance;
              bindSurface();
            }
            window.requestAnimationFrame(() => {
              if (!defaultViewport && interactive && props.shouldSkipInitialFit?.(rootGroupId, viewportRole)) {
                return;
              }

              if (!defaultViewport || !interactive) {
                fitLocalPane(instance);
              }
            });
          }}
          onNodesChange={interactive ? props.onNodesChange : undefined}
          onConnect={interactive ? props.onConnect : undefined}
          onEdgeClick={
            interactive
              ? (event, edge) => {
                  bindSurface();
                  props.onEdgeClick(event, edge);
                }
              : undefined
          }
          onEdgeDoubleClick={
            interactive
              ? (event, edge) => {
                  bindSurface();
                  props.onEdgeDoubleClick(event, edge);
                }
              : undefined
          }
          onReconnect={interactive ? props.onReconnect : undefined}
          onEdgeContextMenu={
            interactive
              ? (event, edge) => {
                  bindSurface();
                  props.onEdgeContextMenu(event, edge);
                }
              : undefined
          }
          onNodeClick={
            interactive
              ? (event, node) => {
                  bindSurface();
                  props.onNodeClick(event, node);
                }
              : undefined
          }
          onNodeDragStart={
            interactive
              ? (event, node, draggedNodes) => props.onNodeDragStart(rootGroupId, event, node, draggedNodes)
              : undefined
          }
          onNodeDragStop={
            interactive
              ? (event, node, draggedNodes) => props.onNodeDragStop(rootGroupId, event, node, draggedNodes)
              : undefined
          }
          multiSelectionKeyCode={null}
          selectNodesOnDrag={false}
          onMoveStart={interactive ? bindSurface : undefined}
          onPaneClick={interactive ? (event) => props.onPaneClick(event, rootGroupId) : undefined}
          onPaneContextMenu={interactive ? (event) => props.onPaneContextMenu(event, rootGroupId) : undefined}
          onMoveEnd={
            interactive ? (_event, viewport) => props.onSavePaneViewport(rootGroupId, viewport, viewportRole) : undefined
          }
          proOptions={{ hideAttribution: true }}
        >
          <CanvasOverviewModeBridge
            mode={props.overviewMode}
            threshold={props.overviewZoomThreshold}
            onViewportStateChange={handleOverviewViewportStateChange}
          />
          <Background variant={BackgroundVariant.Dots} gap={24} size={1.2} />
          <CanvasGroupsViewportLayer
            groups={model.groups}
            workspaceRootWatermarksEnabled={false}
            selectedGroupIds={interactive ? props.selectedGroupIds : []}
            workspaceRootForegroundMode="background-only"
            t={props.t}
            onSelectGroupBody={(groupId, event) => {
              bindSurface();
              props.onSelectGroupBody(groupId, event);
            }}
            onFocusGroupInViewport={(groupId) => {
              bindSurface();
              props.onFocusGroupInViewport(groupId);
            }}
            onGroupBodyContextMenu={(event, groupId) => props.onPaneContextMenu(event, rootGroupId, groupId)}
            onGroupContextMenu={(event, groupId) => props.onPaneContextMenu(event, rootGroupId, groupId)}
            onSelectGroup={(groupId, event) => {
              bindSurface();
              props.onSelectGroup(groupId, event);
            }}
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
          {props.mode === 'main' ? (
            <CanvasMiniMap
              nodes={paneNodes}
              groups={model.groups}
              spatialBounds={paneSpatialBounds}
              viewportSize={paneViewportSize}
              minimapLabel={props.t('canvas.minimap')}
              onViewportCommit={(viewport) => props.onSavePaneViewport(rootGroupId, viewport, viewportRole)}
            />
          ) : null}
          {interactive ? (
            <PaneGalleryControls
              layout={props.layout}
              lastOverviewLayout={props.lastOverviewLayout}
              lastThumbnailLayout={props.lastThumbnailLayout}
              rootGroupId={rootGroupId}
              onFitView={() => {
                const instance = props.flowRefs.current[rootGroupId];
                if (!fitLocalPane(instance, props.nodeFocusAnimationDurationMs)) {
                  props.onFitPane(rootGroupId, instance, props.nodeFocusAnimationDurationMs, { viewportRole });
                }
              }}
              onSetLayout={props.onSetLayout}
              t={props.t}
            />
          ) : null}
        </ReactFlow>
        {props.mode === 'thumbnail' ? (
          <div
            className="pane-gallery-thumbnail-hit-layer"
            data-pane-gallery-thumbnail-hit-layer="true"
            aria-hidden="true"
            title={paneTitle}
            onPointerDown={blockThumbnailPointerEvent}
            onPointerMove={blockThumbnailPointerEvent}
            onPointerUp={blockThumbnailPointerEvent}
            onPointerCancel={blockThumbnailPointerEvent}
            onWheel={blockThumbnailDefaultEvent}
            onClick={blockThumbnailPointerEvent}
            onDoubleClick={activateThumbnail}
            onContextMenu={blockThumbnailDefaultEvent}
            onDragStart={blockThumbnailDefaultEvent}
            onDragOver={blockThumbnailDefaultEvent}
            onDrop={blockThumbnailDefaultEvent}
          />
        ) : null}
      </div>
    </section>
  );
}
