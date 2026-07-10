import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useViewport, type NodeProps } from 'reactflow';

import type {
  CanvasFileIconDescriptor,
  CanvasFileNodeDisplayMode,
  CanvasFileNodeDisplayStyle,
  CanvasFilePathDisplayMode,
  CanvasNodeFootprint,
  CanvasNodeKind,
  CanvasNodeMetadata,
  FileListNodeEntrySummary,
  WebviewNodeActionId
} from '../common/protocol';
import {
  NOTE_EMBEDDED_CONTENT_MAX_LENGTH,
  minimumCanvasNodeFootprint,
  normalizeCanvasNodeFootprint
} from '../common/protocol';
import {
  canvasStatusLabelDescriptor,
  canvasStatusToneClass as statusToneClass
} from '../common/canvasNodeStatusPresentation';
import { toggleNoteMarkdownChecklistAtLine } from '../common/noteMarkdownChecklist';
import { stopCanvasEvent } from './canvasDomEvents';
import type {
  CanvasNodeData,
  FileListEntrySelectionTone,
  FloatingTooltipPosition
} from './canvasTypes';
import {
  CanvasNodeInteractionBoundary,
  ChromeTitleEditor,
  canvasOverviewInertProps,
  handleEditableFieldKeyDown,
  handleNodeChromeDoubleClick,
  selectReadonlyTextContents,
  shouldAllowReadonlyTextShortcutToBubble,
  shouldHandleReadonlySelectAllShortcut,
  useCanvasOverviewInteractionsDisabled
} from './canvasUiSurface';
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
  clampNoteMarkdownSourceOffset,
  createNoteMarkdownPreviewRenderer,
  findNoteMarkdownChecklistInputTarget,
  findNoteMarkdownLinkTarget,
  readNoteMarkdownChecklistLineNumber,
  type NoteMarkdownImageWorkspaceRoot
} from './noteMarkdownPreview';
import type { WebviewI18nKey } from './i18n/webviewI18n';

const FILE_TREE_BASE_PADDING_PX = 8;
const FILE_TREE_DEPTH_STEP_PX = 12;

type FileNoteNodeComponent = ComponentType<NodeProps<CanvasNodeData>>;

type FileNoteTranslator = (key: WebviewI18nKey, params?: Record<string, string | number>) => string;

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

interface FileNoteActionButtonProps {
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

export interface FileNoteNodeDependencies {
  t: FileNoteTranslator;
  CompactCanvasCardNodeContent: ComponentType<Pick<NodeProps<CanvasNodeData>, 'id' | 'data'> & { position: { x: number; y: number }; zoom: number }>;
  NodeResizeAffordance: ComponentType<Pick<NodeProps<CanvasNodeData>, 'id' | 'data'> & {
    position: { x: number; y: number };
    zoom: number;
    minimumOverride?: CanvasNodeFootprint;
  }>;
  NodeHandles: ComponentType<{ selected: boolean }>;
  NodeOverviewTitle: ComponentType<{ title: string; status?: string }>;
  ActionButton: ComponentType<FileNoteActionButtonProps>;
}

export function createFileNoteNodeTypes(deps: FileNoteNodeDependencies): {
  note: FileNoteNodeComponent;
  file: FileNoteNodeComponent;
  'file-list': FileNoteNodeComponent;
} {
  const {
    t,
    CompactCanvasCardNodeContent,
    NodeResizeAffordance,
    NodeHandles,
    NodeOverviewTitle,
    ActionButton
  } = deps;
  const noteMarkdownPreviewRenderer = createNoteMarkdownPreviewRenderer(t);
  const NOTE_BODY_PLACEHOLDER = t('note.body.placeholder');
  const EMBEDDED_NOTE_BODY_PLACEHOLDER = t('note.body.embeddedPlaceholder', {
    max: NOTE_EMBEDDED_CONTENT_MAX_LENGTH.toLocaleString()
  });
  let nextNoteMarkdownMetadataPopoverId = 0;

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

function webviewHumanizeCanvasStatus(status: string): string {
  const label = canvasStatusLabelDescriptor(status);
  return label.kind === 'localized' ? t(label.id) : label.value;
}

  return {
    note: NoteEditableNode,
    file: FileNode,
    'file-list': FileListNode
  };
}

export function collectFileListTreeBranchKeysForEntries(entries: readonly FileListNodeEntrySummary[]): Set<string> {
  const branchKeys = new Set<string>();
  for (const entry of entries) {
    const comparablePath = (entry.relativePath ?? entry.filePath).replace(/\\/g, '/').replace(/^\/+/, '');
    const segments = comparablePath.split('/').filter(Boolean);
    let currentKey = '';
    for (const segment of segments.slice(0, -1)) {
      currentKey = currentKey ? `${currentKey}/${segment}` : segment;
      branchKeys.add(currentKey);
    }
  }
  return branchKeys;
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

export function minimumCanvasNodeFootprintForDisplayStyle(data: Pick<
  CanvasNodeData,
  'kind' | 'fileNodeDisplayStyle' | 'fileNodeDisplayMode' | 'filePathDisplayMode' | 'metadata'
>): CanvasNodeFootprint {
  if (data.kind === 'file' && data.fileNodeDisplayStyle === 'minimal') {
    return resolveMinimalFileNodeFootprint(data.metadata?.file, data.fileNodeDisplayMode, data.filePathDisplayMode);
  }

  return minimumCanvasNodeFootprint(data.kind);
}

export function normalizeCanvasNodeFootprintForDisplayStyle(
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
