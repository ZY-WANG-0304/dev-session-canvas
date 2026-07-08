import type * as React from 'react';

import { createNoteBodyIndentEdit, createNoteBodyOutdentEdit } from './noteBodyIndent';
import {
  clampNoteMarkdownSourceOffset,
  readNoteMarkdownSourceEnd,
  readNoteMarkdownSourceStart,
  NOTE_MARKDOWN_SOURCE_BLOCK_SELECTOR,
  NOTE_MARKDOWN_SOURCE_TEXT_SELECTOR
} from './noteMarkdownPreview';
import { stopCanvasEvent } from './canvasDomEvents';

const NOTE_DOCUMENT_FALLBACK_LINE_HEIGHT_PX = 21;

export interface NoteBodyFocusRequest {
  selectionStart: number;
  selectionEnd: number;
  selectionDirection?: HTMLTextAreaElement['selectionDirection'];
}

interface NoteBodyLineNumberRow {
  key: string;
  lineNumber: number | null;
}

export function splitTextLines(value: string): string[] {
  return value.split('\n');
}

export function createFallbackVisualLineCounts(lineCount: number): number[] {
  return Array.from({ length: Math.max(1, lineCount) }, () => 1);
}

export function createNoteBodyLineNumberRows(
  lines: readonly string[],
  visualLineCounts: readonly number[]
): NoteBodyLineNumberRow[] {
  const rows: NoteBodyLineNumberRow[] = [];
  lines.forEach((_line, index) => {
    const lineNumber = index + 1;
    const visualLineCount = Math.max(1, visualLineCounts[index] ?? 1);
    for (let visualLineIndex = 0; visualLineIndex < visualLineCount; visualLineIndex += 1) {
      rows.push({
        key: `${lineNumber}:${visualLineIndex}`,
        lineNumber: visualLineIndex === 0 ? lineNumber : null
      });
    }
  });

  return rows;
}


export function clampElementScrollTop(
  element: Pick<HTMLElement, 'clientHeight' | 'scrollHeight'>,
  scrollTop: number
): number {
  if (!Number.isFinite(scrollTop)) {
    return 0;
  }

  const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
  return Math.max(0, Math.min(scrollTop, maxScrollTop));
}

export function resolveNoteBodyTextareaScrollTopForSourceOffset(
  textarea: HTMLTextAreaElement,
  content: string,
  sourceOffset: number,
  visualLineCounts: readonly number[]
): number | null {
  if (!content || !Number.isFinite(sourceOffset)) {
    return null;
  }

  const lineIndex = findTextLineIndexForOffset(content, sourceOffset);
  const lineHeight = readElementLineHeightPx(textarea);
  const visualRowsBeforeLine = countVisualRowsBeforeLine(visualLineCounts, lineIndex);
  const targetScrollTop = Math.max(0, visualRowsBeforeLine * lineHeight - textarea.clientHeight * 0.35);
  return clampElementScrollTop(textarea, targetScrollTop);
}

export function resolveNoteBodySourceOffsetForTextareaScrollTop(
  textarea: HTMLTextAreaElement,
  content: string,
  visualLineCounts: readonly number[]
): number | null {
  if (!content) {
    return 0;
  }

  const lineHeight = readElementLineHeightPx(textarea);
  if (!Number.isFinite(lineHeight) || lineHeight <= 0) {
    return null;
  }

  const firstVisibleVisualRow = Math.max(0, Math.floor(textarea.scrollTop / lineHeight));
  const lineIndex = findLogicalLineIndexForVisualRow(visualLineCounts, firstVisibleVisualRow);
  return findTextLineStartOffset(content, lineIndex);
}

export function scrollNoteMarkdownPreviewToSourceOffset(preview: HTMLElement, sourceOffset: number): boolean {
  const target = findNoteMarkdownPreviewSourceElement(preview, sourceOffset);
  if (!target) {
    return false;
  }

  const previewRect = preview.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const targetScrollTop = preview.scrollTop + targetRect.top - previewRect.top - preview.clientHeight * 0.2;
  preview.scrollTop = clampElementScrollTop(preview, targetScrollTop);
  return true;
}

function findNoteMarkdownPreviewSourceElement(preview: HTMLElement, sourceOffset: number): HTMLElement | null {
  let bestElement: HTMLElement | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  const candidates = preview.querySelectorAll<HTMLElement>(
    `${NOTE_MARKDOWN_SOURCE_TEXT_SELECTOR}, ${NOTE_MARKDOWN_SOURCE_BLOCK_SELECTOR}`
  );

  for (const element of Array.from(candidates)) {
    const sourceStart = readNoteMarkdownSourceStart(element);
    const sourceEnd = readNoteMarkdownSourceEnd(element);
    if (sourceStart === null || sourceEnd === null) {
      continue;
    }

    const distance =
      sourceOffset < sourceStart ? sourceStart - sourceOffset : sourceOffset > sourceEnd ? sourceOffset - sourceEnd : 0;
    if (distance < bestDistance) {
      bestDistance = distance;
      bestElement = element;
    }
  }

  return bestElement;
}

function findTextLineIndexForOffset(content: string, offset: number): number {
  const clampedOffset = clampNoteMarkdownSourceOffset(offset, content);
  let lineIndex = 0;
  for (let index = 0; index < clampedOffset; index += 1) {
    if (content.charCodeAt(index) === 10) {
      lineIndex += 1;
    }
  }
  return lineIndex;
}

function findTextLineStartOffset(content: string, lineIndex: number): number {
  if (lineIndex <= 0) {
    return 0;
  }

  let currentLineIndex = 0;
  for (let index = 0; index < content.length; index += 1) {
    if (content.charCodeAt(index) !== 10) {
      continue;
    }

    currentLineIndex += 1;
    if (currentLineIndex === lineIndex) {
      return index + 1;
    }
  }

  return content.length;
}

function countVisualRowsBeforeLine(visualLineCounts: readonly number[], lineIndex: number): number {
  let count = 0;
  for (let index = 0; index < Math.max(0, lineIndex); index += 1) {
    count += Math.max(1, visualLineCounts[index] ?? 1);
  }
  return count;
}

function findLogicalLineIndexForVisualRow(visualLineCounts: readonly number[], visualRow: number): number {
  let remainingRows = Math.max(0, visualRow);
  const lineCount = Math.max(1, visualLineCounts.length);
  for (let index = 0; index < lineCount; index += 1) {
    const visualLineCount = Math.max(1, visualLineCounts[index] ?? 1);
    if (remainingRows < visualLineCount) {
      return index;
    }
    remainingRows -= visualLineCount;
  }

  return lineCount - 1;
}

export function readElementLineHeightPx(element: HTMLElement): number {
  const computedStyle = window.getComputedStyle(element);
  const lineHeight = Number.parseFloat(computedStyle.lineHeight);
  if (Number.isFinite(lineHeight) && lineHeight > 0) {
    return lineHeight;
  }

  const fontSize = Number.parseFloat(computedStyle.fontSize);
  if (Number.isFinite(fontSize) && fontSize > 0) {
    return fontSize * 1.6;
  }

  return NOTE_DOCUMENT_FALLBACK_LINE_HEIGHT_PX;
}

export function areNumberListsEqual(left: readonly number[], right: readonly number[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
}

export function handleNoteBodyIndentKeyDown(
  event: React.KeyboardEvent<HTMLTextAreaElement>,
  applyContentChange: (value: string) => string,
  pendingSelectionRef: React.MutableRefObject<{ selectionStart: number; selectionEnd: number } | null>
): boolean {
  if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) {
    return false;
  }

  event.preventDefault();
  stopCanvasEvent(event);
  applyNoteBodyIndentChange(
    event.currentTarget,
    applyContentChange,
    pendingSelectionRef,
    event.shiftKey ? 'outdent' : 'indent'
  );
  return true;
}

function applyNoteBodyIndentChange(
  textarea: HTMLTextAreaElement,
  applyContentChange: (value: string) => string,
  pendingSelectionRef: React.MutableRefObject<{ selectionStart: number; selectionEnd: number } | null>,
  direction: 'indent' | 'outdent'
): void {
  const edit =
    direction === 'indent'
      ? createNoteBodyIndentEdit(textarea.value, textarea.selectionStart, textarea.selectionEnd)
      : createNoteBodyOutdentEdit(textarea.value, textarea.selectionStart, textarea.selectionEnd);

  if (!edit) {
    return;
  }

  const appliedValue = applyContentChange(edit.value);
  const selectionStart = Math.min(edit.selectionStart, appliedValue.length);
  const selectionEnd = Math.min(edit.selectionEnd, appliedValue.length);
  pendingSelectionRef.current = {
    selectionStart,
    selectionEnd
  };
  window.requestAnimationFrame(() => {
    if (document.activeElement !== textarea) {
      return;
    }

    textarea.setSelectionRange(selectionStart, selectionEnd);
  });
}

export function createNoteBodyFocusRequestFromPreviewDoubleClick(params: {
  content: string;
  event: React.MouseEvent<HTMLElement>;
  preview: HTMLElement;
}): NoteBodyFocusRequest {
  const sourceOffset = findNotePreviewSourceOffset(params.event.nativeEvent, params.preview) ?? params.content.length;
  const clampedOffset = clampNoteMarkdownSourceOffset(sourceOffset, params.content);
  return {
    selectionStart: clampedOffset,
    selectionEnd: clampedOffset
  };
}

function findNotePreviewSourceOffset(event: MouseEvent, preview: HTMLElement): number | null {
  const caret = findNotePreviewCaretPosition(event.clientX, event.clientY);
  if (caret) {
    const textSourceElement = findNotePreviewTextSourceElement(caret.node);
    const textOffset =
      textSourceElement && isNotePreviewTextSourceElementHit(textSourceElement, event, preview)
        ? readNotePreviewTextSourceOffset(caret.node, caret.offset)
        : null;
    if (textOffset !== null) {
      return textOffset;
    }
  }

  const target = event.target instanceof Element ? event.target : null;
  const targetFallback = findNotePreviewFallbackSourceEnd(target, preview);
  if (targetFallback !== null) {
    return targetFallback;
  }

  if (caret?.node) {
    const caretFallback = findNotePreviewFallbackSourceEnd(caret.node, preview);
    if (caretFallback !== null) {
      return caretFallback;
    }
  }

  return null;
}

function findNotePreviewCaretPosition(x: number, y: number): { node: globalThis.Node; offset: number } | null {
  const documentWithCaretPosition = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: globalThis.Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };

  const position = documentWithCaretPosition.caretPositionFromPoint?.(x, y);
  if (position?.offsetNode) {
    return {
      node: position.offsetNode,
      offset: position.offset
    };
  }

  const range = documentWithCaretPosition.caretRangeFromPoint?.(x, y);
  if (range) {
    return {
      node: range.startContainer,
      offset: range.startOffset
    };
  }

  return null;
}

function readNotePreviewTextSourceOffset(node: globalThis.Node, offset: number): number | null {
  const textNode = node instanceof Text ? node : null;
  const element = textNode ? findNotePreviewTextSourceElement(textNode) : null;
  if (!textNode || !element) {
    return null;
  }

  const rawOffsets = element.dataset.noteMarkdownSourceOffsets;
  if (!rawOffsets) {
    return null;
  }

  let sourceOffsets: unknown;
  try {
    sourceOffsets = JSON.parse(rawOffsets);
  } catch {
    return null;
  }
  if (!Array.isArray(sourceOffsets)) {
    return null;
  }

  const localOffset = Math.min(Math.max(offset, 0), textNode.data.length);
  const sourceOffset = sourceOffsets[localOffset];
  return Number.isSafeInteger(sourceOffset) ? sourceOffset : null;
}

function findNotePreviewTextSourceElement(node: globalThis.Node): HTMLElement | null {
  const element = node instanceof Element ? node : node.parentElement;
  return element?.closest<HTMLElement>(NOTE_MARKDOWN_SOURCE_TEXT_SELECTOR) ?? null;
}

function isNotePreviewTextSourceElementHit(
  element: HTMLElement,
  event: MouseEvent,
  preview: HTMLElement
): boolean {
  if (!preview.contains(element)) {
    return false;
  }

  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest(NOTE_MARKDOWN_SOURCE_TEXT_SELECTOR) === element) {
    return true;
  }

  const hitSlop = 2;
  for (const rect of Array.from(element.getClientRects())) {
    if (
      event.clientX >= rect.left - hitSlop &&
      event.clientX <= rect.right + hitSlop &&
      event.clientY >= rect.top - hitSlop &&
      event.clientY <= rect.bottom + hitSlop
    ) {
      return true;
    }
  }

  return false;
}

function findNotePreviewFallbackSourceEnd(target: globalThis.Node | null, preview: HTMLElement): number | null {
  const startElement = target instanceof Element ? target : target?.parentElement;
  if (!startElement) {
    return readNoteMarkdownSourceEnd(preview);
  }

  const blocks: HTMLElement[] = [];
  let current: HTMLElement | null = startElement instanceof HTMLElement ? startElement : startElement.parentElement;
  while (current && current !== preview.parentElement) {
    if (current.matches(NOTE_MARKDOWN_SOURCE_BLOCK_SELECTOR)) {
      blocks.push(current);
    }
    current = current.parentElement;
  }

  for (const block of blocks) {
    if (!block || !preview.contains(block)) {
      continue;
    }
    const sourceEnd = readNoteMarkdownSourceEnd(block);
    if (sourceEnd !== null) {
      return sourceEnd;
    }
  }

  return readNoteMarkdownSourceEnd(preview);
}

