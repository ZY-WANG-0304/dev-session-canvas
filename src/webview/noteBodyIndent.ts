export const NOTE_BODY_INDENT = '  ';

export interface NoteBodySelectionEdit {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

export function createNoteBodyIndentEdit(
  value: string,
  selectionStart: number,
  selectionEnd: number
): NoteBodySelectionEdit {
  if (selectionStart === selectionEnd) {
    const nextValue = `${value.slice(0, selectionStart)}${NOTE_BODY_INDENT}${value.slice(selectionEnd)}`;
    const nextSelection = selectionStart + NOTE_BODY_INDENT.length;
    return {
      value: nextValue,
      selectionStart: nextSelection,
      selectionEnd: nextSelection
    };
  }

  const lineStarts = getSelectedLineStarts(value, selectionStart, selectionEnd);
  const nextValue = insertTextAtOffsets(value, lineStarts, NOTE_BODY_INDENT);
  return {
    value: nextValue,
    selectionStart: selectionStart + countOffsetsBefore(lineStarts, selectionStart) * NOTE_BODY_INDENT.length,
    selectionEnd: selectionEnd + countOffsetsBefore(lineStarts, selectionEnd) * NOTE_BODY_INDENT.length
  };
}

export function createNoteBodyOutdentEdit(
  value: string,
  selectionStart: number,
  selectionEnd: number
): NoteBodySelectionEdit | null {
  const removals = getSelectedLineStarts(value, selectionStart, selectionEnd)
    .map((offset) => ({
      offset,
      length: countNoteBodyOutdentChars(value, offset)
    }))
    .filter((removal) => removal.length > 0);

  if (removals.length === 0) {
    return null;
  }

  return {
    value: removeTextAtOffsets(value, removals),
    selectionStart: adjustOffsetAfterRemovals(selectionStart, removals),
    selectionEnd: adjustOffsetAfterRemovals(selectionEnd, removals)
  };
}

function getSelectedLineStarts(value: string, selectionStart: number, selectionEnd: number): number[] {
  const lineStart = value.lastIndexOf('\n', Math.max(0, selectionStart - 1)) + 1;
  const effectiveSelectionEnd =
    selectionEnd > selectionStart && value.charAt(selectionEnd - 1) === '\n' ? selectionEnd - 1 : selectionEnd;
  const nextLineBreak = value.indexOf('\n', effectiveSelectionEnd);
  const lineEnd = nextLineBreak === -1 ? value.length : nextLineBreak;
  const lineStarts = [lineStart];

  for (
    let lineBreak = value.indexOf('\n', lineStart);
    lineBreak !== -1 && lineBreak < lineEnd;
    lineBreak = value.indexOf('\n', lineBreak + 1)
  ) {
    lineStarts.push(lineBreak + 1);
  }

  return lineStarts;
}

function countNoteBodyOutdentChars(value: string, lineStart: number): number {
  if (value.charAt(lineStart) === '\t') {
    return 1;
  }

  let count = 0;
  while (count < NOTE_BODY_INDENT.length && value.charAt(lineStart + count) === ' ') {
    count += 1;
  }

  return count;
}

function insertTextAtOffsets(value: string, offsets: number[], insertedText: string): string {
  let nextValue = '';
  let cursor = 0;
  for (const offset of offsets) {
    nextValue += value.slice(cursor, offset);
    nextValue += insertedText;
    cursor = offset;
  }

  return nextValue + value.slice(cursor);
}

function removeTextAtOffsets(value: string, removals: Array<{ offset: number; length: number }>): string {
  let nextValue = '';
  let cursor = 0;
  for (const removal of removals) {
    nextValue += value.slice(cursor, removal.offset);
    cursor = removal.offset + removal.length;
  }

  return nextValue + value.slice(cursor);
}

function countOffsetsBefore(offsets: number[], position: number): number {
  return offsets.filter((offset) => offset < position).length;
}

function adjustOffsetAfterRemovals(position: number, removals: Array<{ offset: number; length: number }>): number {
  let nextPosition = position;
  for (const removal of removals) {
    if (removal.offset >= position) {
      continue;
    }

    nextPosition -= Math.min(removal.length, position - removal.offset);
  }

  return Math.max(0, nextPosition);
}
