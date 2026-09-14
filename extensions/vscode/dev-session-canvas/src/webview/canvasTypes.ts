import type * as React from 'react';
import type { Edge, Node, ReactFlowInstance, Viewport } from 'reactflow';

import type { ExecutionImagePasteData } from '../common/executionTerminalClipboard';
import type {
  ExecutionTerminalDroppedResource,
  ExecutionTerminalOpenLink
} from '../common/executionTerminalLinks';
import type {
  AgentInputIntent,
  AgentProviderKind,
  CanvasEdgeArrowMode,
  CanvasEdgeColor,
  CanvasEdgeOwner,
  CanvasFileNodeDisplayMode,
  CanvasFileNodeDisplayStyle,
  CanvasFilePathDisplayMode,
  CanvasGroupSummary,
  CanvasNodeFootprint,
  CanvasNodeKind,
  CanvasNodeMetadata,
  CanvasNodePosition,
  CanvasRuntimeContext,
  CanvasStrongTerminalAttentionReminderMode,
  ExecutionNodeKind,
  ExecutionTerminalClipboardDiagnosticPayload,
  WebviewClipboardTextSource
} from '../common/protocol';
import type { NoteMarkdownImageWorkspaceRoot } from './noteMarkdownPreview';
import type { PaneGalleryLocalState, PaneGalleryViewportRole } from './paneGalleryLocalState';

export type FileListViewMode = 'list' | 'tree';
export type FileListEntrySelectionTone = 'active' | 'inactive';

export interface LocalUiState {
  selectedNodeId?: string;
  selectedNodeIds?: string[];
  selectedGroupId?: string;
  selectedGroupIds?: string[];
  viewport?: Viewport;
  paneGallery?: PaneGalleryLocalState;
  fileListViewModes?: Record<string, FileListViewMode>;
  selectedFileListEntries?: Record<string, string>;
  collapsedFileListTreeBranches?: Record<string, string[]>;
}

export interface CanvasSurfaceBinding {
  flow: ReactFlowInstance<CanvasNodeData> | null | undefined;
  shell: HTMLDivElement | null;
  viewportKind: 'rootGroups' | 'paneGallery';
  rootGroupId?: string;
  paneGalleryViewportRole?: PaneGalleryViewportRole;
}

export interface CanvasViewportSize {
  width: number;
  height: number;
}

export interface CanvasOverviewViewportState {
  active: boolean;
  titleScale: number;
}

export interface CanvasMiniMapRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CanvasSpatialRect extends CanvasMiniMapRect {
  kind: 'node' | 'group' | 'workspace-root';
  id: string;
}

export interface CanvasSpatialBounds {
  rects: CanvasSpatialRect[];
  bounds?: CanvasMiniMapRect;
}

export interface ExecutionInputDispatchMetadata {
  intent?: AgentInputIntent;
  sequence: number;
  webviewEpochMs: number;
  webviewPerformanceNowMs: number;
}

export interface CanvasNodeData {
  kind: CanvasNodeKind;
  title: string;
  status: string;
  summary: string;
  /** The current read-only title emitted by the execution PTY. */
  terminalTitle?: string;
  selected: boolean;
  documentHasFocus: boolean;
  workspaceTrusted: boolean;
  overviewInteractionsDisabled: boolean;
  strongTerminalAttentionReminderMode: CanvasStrongTerminalAttentionReminderMode;
  size: CanvasNodeFootprint;
  fileNodeDisplayStyle: CanvasFileNodeDisplayStyle;
  fileNodeDisplayMode: CanvasFileNodeDisplayMode;
  filePathDisplayMode: CanvasFilePathDisplayMode;
  noteMarkdownImageWorkspaceRoots: NoteMarkdownImageWorkspaceRoot[];
  workspaceFolders: CanvasRuntimeContext['workspaceFolders'];
  fileListViewMode: FileListViewMode;
  selectedFileListEntryPath?: string;
  collapsedFileListTreeBranchKeys?: string[];
  metadata?: CanvasNodeMetadata;
  onSelectNode?: (nodeId: string) => void;
  onAcknowledgeNodeAttention?: (nodeId: string) => void;
  onOpenCanvasFile?: (nodeId: string, filePath: string) => void;
  onOpenNoteLink?: (nodeId: string, href: string) => void;
  onSaveNoteAsMarkdownFile?: (nodeId: string) => void;
  onOpenAssociatedNoteMarkdownFile?: (nodeId: string) => void;
  onReloadAssociatedNoteMarkdownFile?: (nodeId: string) => void;
  onCreateMissingAssociatedNoteMarkdownFile?: (nodeId: string) => void;
  onCopyTextToClipboard?: (text: string, source: WebviewClipboardTextSource, nodeId?: string) => void;
  onSelectFileListEntry?: (nodeId: string, filePath: string) => void;
  onSetFileListViewMode?: (nodeId: string, viewMode: FileListViewMode) => void;
  onToggleFileListTreeBranch?: (nodeId: string, branchKey: string) => void;
  onStartExecution?: (
    nodeId: string,
    kind: ExecutionNodeKind,
    cols: number,
    rows: number,
    provider?: AgentProviderKind,
    resume?: boolean
  ) => void;
  onBranchAgentSession?: (nodeId: string) => void;
  onAttachExecution?: (nodeId: string, kind: ExecutionNodeKind) => void;
  onExecutionInput?: (
    nodeId: string,
    kind: ExecutionNodeKind,
    data: string,
    metadata?: ExecutionInputDispatchMetadata
  ) => void;
  onShowTransientError?: (message: string) => void;
  onDropExecutionResource?: (
    nodeId: string,
    kind: ExecutionNodeKind,
    resource: ExecutionTerminalDroppedResource
  ) => void;
  onOpenExecutionLink?: (
    nodeId: string,
    kind: ExecutionNodeKind,
    link: ExecutionTerminalOpenLink
  ) => void;
  onCopyExecutionSelection?: (
    nodeId: string,
    kind: ExecutionNodeKind,
    text: string,
    clearSelectionAfterCopy: boolean
  ) => void;
  onRequestExecutionPaste?: (
    nodeId: string,
    kind: ExecutionNodeKind,
    bracketedPasteMode: boolean
  ) => void;
  onPasteExecutionImage?: (
    nodeId: string,
    kind: ExecutionNodeKind,
    image: ExecutionImagePasteData
  ) => void;
  onExecutionClipboardDiagnostic?: (payload: ExecutionTerminalClipboardDiagnosticPayload) => void;
  onResizeExecution?: (nodeId: string, kind: ExecutionNodeKind, cols: number, rows: number) => void;
  onStopExecution?: (nodeId: string, kind: ExecutionNodeKind) => void;
  onUpdateNodeTitle?: (nodeId: string, title: string) => void;
  onUpdateNote?: (payload: {
    nodeId: string;
    content: string;
    baseContentRevision?: string;
    force?: boolean;
  }) => void;
  onBeginAssociatedNoteMarkdownEdit?: (payload: {
    nodeId: string;
    content: string;
    baseContentRevision?: string;
  }) => void;
  onEndAssociatedNoteMarkdownEdit?: (nodeId: string) => void;
  onUpdateAssociatedNoteMarkdownDraft?: (payload: {
    nodeId: string;
    content: string;
    baseContentRevision?: string;
  }) => void;
  onClearAssociatedNoteMarkdownDraft?: (nodeId: string) => void;
  onCopyAssociatedNoteMarkdownDraft?: (nodeId: string, content: string) => void;
  onDraftNodeLayout?: (nodeId: string, draft: CanvasNodeLayoutDraft | null) => void;
  onResizeNodePointerMove?: (
    event: Pick<PointerEvent | React.PointerEvent, 'clientX' | 'clientY'>,
    onPan?: (previousViewport: Viewport, nextViewport: Viewport) => void
  ) => void;
  onResizeNodeEnd?: () => void;
  onResizeNode?: (nodeId: string, position: CanvasNodePosition, size: CanvasNodeFootprint) => void;
  onFocusNodeInViewport?: (nodeId: string) => void;
  onDeleteNode?: (nodeId: string) => void;
  onModifierSelectNode?: (nodeId: string) => void;
}

export type CanvasFlowNode = Node<CanvasNodeData>;

export interface CanvasEdgeData {
  owner: CanvasEdgeOwner;
  arrowMode: CanvasEdgeArrowMode;
  color?: CanvasEdgeColor;
  strokeColor?: string;
  isLabelEditing?: boolean;
  isArrowMenuOpen?: boolean;
  isColorMenuOpen?: boolean;
  onSelectEdge?: () => void;
  onStartLabelEdit?: () => void;
  onSubmitLabelEdit?: (value: string) => void;
  onCancelLabelEdit?: () => void;
  onToggleArrowMenu?: () => void;
  onSetArrowMode?: (arrowMode: CanvasEdgeArrowMode) => void;
  onToggleColorMenu?: () => void;
  onSetColor?: (color: CanvasEdgeColor | null) => void;
  onDeleteEdge?: () => void;
}

export type CanvasFlowEdge = Edge<CanvasEdgeData>;

export interface CanvasNodeLayoutDraft {
  position?: CanvasNodePosition;
  size?: CanvasNodeFootprint;
}

export interface CanvasNodeResizeDraft {
  position: CanvasNodePosition;
  size: CanvasNodeFootprint;
}

export type CanvasNodeResizeDirection =
  | 'top'
  | 'right'
  | 'bottom'
  | 'left'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right';

export type CanvasContextMenuView =
  | 'root'
  | 'agent-launch-mode'
  | 'apply-template'
  | 'reset-template'
  | 'arrange-layout-scope'
  | 'clear-canvas-scope';

export type CanvasClearCanvasTargetKind = 'workspace-root' | 'group';

export interface CanvasContextMenuState {
  screenX: number;
  screenY: number;
  flowAnchor: CanvasNodePosition;
  view: CanvasContextMenuView;
  targetGroupId?: string;
  selectedAgentProvider?: AgentProviderKind;
  selectedNodeIds?: string[];
  selectedGroupIds?: string[];
  canCreateGroupFromSelection?: boolean;
}

export interface CanvasGroupDraft {
  position?: CanvasNodePosition;
  size?: CanvasNodeFootprint;
}

export type CanvasGroupResizeDirection =
  | 'top'
  | 'right'
  | 'bottom'
  | 'left'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right';

export type CanvasPoint = { x: number; y: number };
export type CanvasSize = { width: number; height: number };
export type CanvasRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export interface ExecutionNodeHelpContent {
  title: string;
  items: readonly string[];
}

export interface FloatingTooltipPosition {
  left: number;
  top: number;
}

export interface PaneGalleryRootModel {
  rootGroup: CanvasGroupSummary;
  nodes: CanvasFlowNode[];
  edges: CanvasFlowEdge[];
  groups: CanvasGroupSummary[];
  nodeCount: number;
  runningCount: number;
  runningTitleBlockCount: number;
  errorCount: number;
  waitingCount: number;
  attentionCount: number;
  attentionTitleBarFlashing: boolean;
}
