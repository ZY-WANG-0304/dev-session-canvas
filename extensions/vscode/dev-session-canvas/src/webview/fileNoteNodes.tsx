import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useViewport, type NodeProps } from 'reactflow';

import type {
  CanvasNodeFootprint,
  CanvasNodeKind,
  CanvasNodeMetadata,
  WebviewNodeActionId
} from '../common/protocol';
import {
  NOTE_EMBEDDED_CONTENT_MAX_LENGTH,
  minimumCanvasNodeFootprint,
  normalizeCanvasNodeFootprint
} from '../common/protocol';
import { canvasStatusLabelDescriptor } from '../common/canvasNodeStatusPresentation';
import { toggleNoteMarkdownChecklistAtLine } from '../common/noteMarkdownChecklist';
import { stopCanvasEvent } from './canvasDomEvents';
import type {
  CanvasNodeData,
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
      disabled={data.overviewInteractionsDisabled || data.deletionPending}
      deletionPending={data.deletionPending}
      deletionLabel={t('action.deleting')}
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
          titleEditLabel={t('action.editTitle')}
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
            label={data.deletionPending ? t('action.deleting') : t('action.delete')}
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


function webviewHumanizeCanvasStatus(status: string): string {
  const label = canvasStatusLabelDescriptor(status);
  return label.kind === 'localized' ? t(label.id) : label.value;
}

  return {
    note: NoteEditableNode
  };
}

export function minimumCanvasNodeFootprintForDisplayStyle(data: Pick<CanvasNodeData, 'kind'>): CanvasNodeFootprint {
  return minimumCanvasNodeFootprint(data.kind);
}
