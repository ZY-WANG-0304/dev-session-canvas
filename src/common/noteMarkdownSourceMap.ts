import { decodeNamedCharacterReference } from 'decode-named-character-reference';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { mathFromMarkdown } from 'mdast-util-math';
import type { Code, InlineCode, Literal, Nodes, Root, Text as MdastText } from 'mdast';
import type { InlineMath, Math as MdastMath } from 'mdast-util-math';
import { gfm } from 'micromark-extension-gfm';
import { math } from 'micromark-extension-math';

export interface NoteMarkdownSourceTextSegment {
  text: string;
  sourceOffsets: number[];
  sourceStart: number;
  sourceEnd: number;
}

export interface NoteMarkdownSourceBlockRange {
  kind: NoteMarkdownSourceBlockKind;
  sourceStart: number;
  sourceEnd: number;
}

export type NoteMarkdownSourceBlockKind =
  | 'blockquote'
  | 'code'
  | 'heading'
  | 'image'
  | 'list'
  | 'listItem'
  | 'math'
  | 'paragraph'
  | 'table'
  | 'thematicBreak';

export interface NoteMarkdownSourceMap {
  textSegments: NoteMarkdownSourceTextSegment[];
  blockRanges: NoteMarkdownSourceBlockRange[];
}

export interface NoteMarkdownSourceMapFrontMatterInput {
  kind: 'none' | 'valid' | 'invalid';
  body: string;
  rawBlock?: string;
}

export function createNoteMarkdownSourceMap(
  content: string,
  frontMatter: NoteMarkdownSourceMapFrontMatterInput
): NoteMarkdownSourceMap {
  const bodyStartOffset = frontMatter.kind === 'valid' ? (frontMatter.rawBlock?.length ?? 0) : 0;
  const source = frontMatter.kind === 'valid' ? frontMatter.body : content;
  if (!source.trim()) {
    return { textSegments: [], blockRanges: [] };
  }

  let tree: Root;
  try {
    tree = fromMarkdown(source, {
      extensions: [gfm(), math()],
      mdastExtensions: [gfmFromMarkdown(), mathFromMarkdown()]
    });
  } catch {
    return { textSegments: [], blockRanges: [] };
  }

  const sourceMap: NoteMarkdownSourceMap = {
    textSegments: [],
    blockRanges: []
  };
  collectNoteMarkdownSourceMap(tree, {
    content,
    bodyStartOffset,
    sourceMap
  });
  return sourceMap;
}

function collectNoteMarkdownSourceMap(
  node: Nodes | MdastMath | InlineMath,
  context: {
    content: string;
    bodyStartOffset: number;
    sourceMap: NoteMarkdownSourceMap;
  },
  parent?: Nodes | MdastMath | InlineMath
): void {
  const blockKind = readNoteMarkdownSourceBlockKind(node, parent);
  if (blockKind) {
    appendNoteMarkdownBlockRange(node, blockKind, context);
  }

  switch (node.type) {
    case 'text':
      appendNoteMarkdownTextSegment(node, context);
      return;
    case 'inlineCode':
      appendNoteMarkdownInlineCodeSegment(node, context);
      return;
    case 'code':
      appendNoteMarkdownCodeBlockSegments(node, context);
      return;
    case 'inlineMath':
    case 'math':
    case 'html':
    case 'image':
    case 'imageReference':
    case 'break':
    case 'thematicBreak':
    case 'definition':
    case 'footnoteDefinition':
      return;
    default:
      if (isMdastParent(node)) {
        for (const child of node.children) {
          collectNoteMarkdownSourceMap(child as Nodes | MdastMath | InlineMath, context, node);
        }
      }
  }
}

function readNoteMarkdownSourceBlockKind(
  node: Nodes | MdastMath | InlineMath,
  parent?: Nodes | MdastMath | InlineMath
): NoteMarkdownSourceBlockKind | null {
  switch (node.type) {
    case 'blockquote':
      return 'blockquote';
    case 'code':
      return 'code';
    case 'heading':
      return 'heading';
    case 'image':
    case 'imageReference':
      return 'image';
    case 'list':
      return 'list';
    case 'listItem':
      return 'listItem';
    case 'math':
      return 'math';
    case 'paragraph':
      return parent?.type === 'listItem' && (parent as { spread?: boolean }).spread !== true ? null : 'paragraph';
    case 'table':
      return 'table';
    case 'thematicBreak':
      return 'thematicBreak';
    default:
      return null;
  }
}

function appendNoteMarkdownBlockRange(
  node: Nodes | MdastMath | InlineMath,
  kind: NoteMarkdownSourceBlockKind,
  context: {
    bodyStartOffset: number;
    sourceMap: NoteMarkdownSourceMap;
  }
): void {
  const range = readMdastNodeAbsoluteRange(node, context.bodyStartOffset);
  if (!range) {
    return;
  }

  context.sourceMap.blockRanges.push({
    kind,
    sourceStart: range.start,
    sourceEnd: range.end
  });
}

function appendNoteMarkdownTextSegment(
  node: MdastText,
  context: {
    content: string;
    bodyStartOffset: number;
    sourceMap: NoteMarkdownSourceMap;
  }
): void {
  appendNoteMarkdownSegmentFromNodeValue(node, node.value, context);
}

function appendNoteMarkdownInlineCodeSegment(
  node: InlineCode,
  context: {
    content: string;
    bodyStartOffset: number;
    sourceMap: NoteMarkdownSourceMap;
  }
): void {
  appendNoteMarkdownSegmentFromNodeValue(node, node.value, context);
}

function appendNoteMarkdownSegmentFromNodeValue(
  node: Literal,
  renderedText: string,
  context: {
    content: string;
    bodyStartOffset: number;
    sourceMap: NoteMarkdownSourceMap;
  }
): void {
  const range = readMdastNodeAbsoluteRange(node, context.bodyStartOffset);
  if (!range || renderedText.length === 0) {
    return;
  }

  const sourceSlice = context.content.slice(range.start, range.end);
  const sourceOffsets = createNoteMarkdownDecodedSourceOffsets(sourceSlice, renderedText, range.start);
  if (!sourceOffsets) {
    return;
  }

  context.sourceMap.textSegments.push({
    text: renderedText,
    sourceOffsets,
    sourceStart: range.start,
    sourceEnd: range.end
  });
}

function appendNoteMarkdownCodeBlockSegments(
  node: Code,
  context: {
    content: string;
    bodyStartOffset: number;
    sourceMap: NoteMarkdownSourceMap;
  }
): void {
  const range = readMdastNodeAbsoluteRange(node, context.bodyStartOffset);
  if (!range || node.value.length === 0) {
    return;
  }

  const sourceSlice = context.content.slice(range.start, range.end);
  const sourceOffsets = createNoteMarkdownCodeBlockSourceOffsets(sourceSlice, node, range.start);
  if (!sourceOffsets) {
    return;
  }

  context.sourceMap.textSegments.push({
    text: node.value,
    sourceOffsets,
    sourceStart: sourceOffsets[0] ?? range.start,
    sourceEnd: sourceOffsets[sourceOffsets.length - 1] ?? range.end
  });
}

function createNoteMarkdownCodeBlockSourceOffsets(
  sourceSlice: string,
  node: Code,
  absoluteStart: number
): number[] | null {
  const codeStartOffset = findNoteMarkdownCodeValueStartOffset(sourceSlice, node, absoluteStart);
  if (codeStartOffset === null) {
    return null;
  }

  if (node.lang || isFencedCodeBlockSource(sourceSlice)) {
    return createNoteMarkdownPlainSourceOffsets(node.value, codeStartOffset);
  }

  return createNoteMarkdownIndentedCodeSourceOffsets(sourceSlice, node.value, absoluteStart);
}

function findNoteMarkdownCodeValueStartOffset(sourceSlice: string, node: Code, absoluteStart: number): number | null {
  if (node.lang || isFencedCodeBlockSource(sourceSlice)) {
    const firstLineBreak = sourceSlice.indexOf('\n');
    return firstLineBreak === -1 ? null : absoluteStart + firstLineBreak + 1;
  }

  const firstCodeLineOffset = findFirstNonBlankLineOffset(sourceSlice);
  if (firstCodeLineOffset === null) {
    return null;
  }

  return absoluteStart + firstCodeLineOffset + readIndentedCodePrefixLength(sourceSlice, firstCodeLineOffset);
}

function isFencedCodeBlockSource(sourceSlice: string): boolean {
  const firstLineBreak = sourceSlice.search(/\r?\n/u);
  const firstLine = sourceSlice.slice(0, firstLineBreak === -1 ? sourceSlice.length : firstLineBreak);
  return /^ {0,3}(?:`{3,}|~{3,})/u.test(firstLine);
}

function createNoteMarkdownIndentedCodeSourceOffsets(
  sourceSlice: string,
  renderedText: string,
  absoluteStart: number
): number[] | null {
  const sourceLines = splitNoteMarkdownSourceLines(sourceSlice);
  const renderedLines = renderedText.split('\n');
  if (sourceLines.length < renderedLines.length) {
    return null;
  }

  const offsets: number[] = [];
  for (let lineIndex = 0; lineIndex < renderedLines.length; lineIndex += 1) {
    const sourceLine = sourceLines[lineIndex];
    const renderedLine = renderedLines[lineIndex];
    if (!sourceLine) {
      return null;
    }

    const prefixLength = readIndentedCodePrefixLength(sourceSlice, sourceLine.start);
    const contentStart = sourceLine.start + prefixLength;
    const contentEnd = sourceLine.end;
    const sourceLineText = sourceSlice.slice(contentStart, contentEnd);
    const matchOffset = sourceLineText.startsWith(renderedLine) ? 0 : sourceLineText.indexOf(renderedLine);
    if (matchOffset < 0) {
      return null;
    }

    const renderedSourceStart = contentStart + matchOffset;
    for (let index = 0; index < renderedLine.length; index += 1) {
      offsets.push(absoluteStart + renderedSourceStart + index);
    }

    if (lineIndex < renderedLines.length - 1) {
      offsets.push(absoluteStart + sourceLine.end);
    } else {
      offsets.push(absoluteStart + renderedSourceStart + renderedLine.length);
    }
  }

  return offsets.length === renderedText.length + 1 ? offsets : null;
}

function splitNoteMarkdownSourceLines(source: string): Array<{ start: number; end: number }> {
  const lines: Array<{ start: number; end: number }> = [];
  let lineStart = 0;
  while (lineStart <= source.length) {
    const lineBreak = source.indexOf('\n', lineStart);
    const lineEnd = lineBreak === -1 ? source.length : lineBreak;
    lines.push({
      start: lineStart,
      end: source.charAt(lineEnd - 1) === '\r' ? lineEnd - 1 : lineEnd
    });
    if (lineBreak === -1) {
      break;
    }
    lineStart = lineBreak + 1;
  }
  return lines;
}

function findFirstNonBlankLineOffset(source: string): number | null {
  let lineStart = 0;
  while (lineStart <= source.length) {
    const lineEnd = source.indexOf('\n', lineStart);
    const line = source.slice(lineStart, lineEnd === -1 ? source.length : lineEnd).replace(/\r$/u, '');
    if (line.trim().length > 0) {
      return lineStart;
    }
    if (lineEnd === -1) {
      break;
    }
    lineStart = lineEnd + 1;
  }
  return null;
}

function readIndentedCodePrefixLength(source: string, lineStart: number): number {
  let prefixLength = 0;
  for (let offset = lineStart; offset < source.length && prefixLength < 4; offset += 1) {
    const char = source.charAt(offset);
    if (char !== ' ' && char !== '\t') {
      break;
    }
    prefixLength += 1;
  }
  return prefixLength;
}

function createNoteMarkdownPlainSourceOffsets(text: string, absoluteStart: number): number[] {
  const offsets: number[] = [];
  for (let index = 0; index <= text.length; index += 1) {
    offsets.push(absoluteStart + index);
  }
  return offsets;
}

function createNoteMarkdownDecodedSourceOffsets(
  source: string,
  renderedText: string,
  absoluteStart: number
): number[] | null {
  const offsets: number[] = [];
  let sourceIndex = 0;
  let renderedIndex = 0;

  while (renderedIndex < renderedText.length) {
    const decoded = readNextNoteMarkdownDecodedSourceCharacter(source, sourceIndex);
    if (!decoded || renderedText.slice(renderedIndex, renderedIndex + decoded.value.length) !== decoded.value) {
      return createNoteMarkdownFuzzySourceOffsets(source, renderedText, absoluteStart);
    }

    for (let index = 0; index < decoded.value.length; index += 1) {
      offsets.push(absoluteStart + sourceIndex);
    }
    sourceIndex = decoded.nextIndex;
    renderedIndex += decoded.value.length;
  }

  offsets.push(absoluteStart + sourceIndex);
  return sourceIndex <= source.length && offsets.length === renderedText.length + 1 ? offsets : null;
}

function createNoteMarkdownFuzzySourceOffsets(
  source: string,
  renderedText: string,
  absoluteStart: number
): number[] | null {
  const offsets: number[] = [];
  let searchStart = 0;
  for (let index = 0; index < renderedText.length; index += 1) {
    const char = renderedText.charAt(index);
    const matchIndex = source.indexOf(char, searchStart);
    if (matchIndex === -1) {
      return null;
    }
    offsets.push(absoluteStart + matchIndex);
    searchStart = matchIndex + char.length;
  }
  offsets.push(absoluteStart + searchStart);
  return offsets.length === renderedText.length + 1 ? offsets : null;
}

function readNextNoteMarkdownDecodedSourceCharacter(
  source: string,
  start: number
): { value: string; nextIndex: number } | null {
  if (start >= source.length) {
    return null;
  }

  const current = source.charAt(start);
  if (current === '\\' && start + 1 < source.length) {
    const escaped = source.charAt(start + 1);
    if (/^[!"#$%&'()*+,./:;<=>?@[\\\]^_`{|}~-]$/u.test(escaped)) {
      return { value: escaped, nextIndex: start + 2 };
    }
  }

  if (current === '&') {
    const characterReference = readNoteMarkdownCharacterReference(source, start);
    if (characterReference) {
      return characterReference;
    }
  }

  const codePoint = source.codePointAt(start);
  if (codePoint === undefined) {
    return null;
  }
  const value = String.fromCodePoint(codePoint);
  return { value, nextIndex: start + value.length };
}

function readNoteMarkdownCharacterReference(
  source: string,
  start: number
): { value: string; nextIndex: number } | null {
  const match = /^&(?:#([0-9]+)|#x([0-9A-Fa-f]+)|([A-Za-z][A-Za-z0-9]+));/u.exec(source.slice(start));
  if (!match) {
    return null;
  }

  let value: string | false | null = null;
  if (match[1]) {
    const codePoint = Number.parseInt(match[1], 10);
    value = Number.isFinite(codePoint) ? safeStringFromCodePoint(codePoint) : null;
  } else if (match[2]) {
    const codePoint = Number.parseInt(match[2], 16);
    value = Number.isFinite(codePoint) ? safeStringFromCodePoint(codePoint) : null;
  } else if (match[3]) {
    value = decodeNamedCharacterReference(match[3]);
  }

  return value ? { value, nextIndex: start + match[0].length } : null;
}

function safeStringFromCodePoint(codePoint: number): string | null {
  try {
    return String.fromCodePoint(codePoint);
  } catch {
    return null;
  }
}

function readMdastNodeAbsoluteRange(
  node: Pick<Nodes | MdastMath | InlineMath, 'position'>,
  bodyStartOffset: number
): { start: number; end: number } | null {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start === undefined || end === undefined) {
    return null;
  }
  return {
    start: bodyStartOffset + start,
    end: bodyStartOffset + end
  };
}

function isMdastParent(node: Nodes | MdastMath | InlineMath): node is (Nodes | MdastMath | InlineMath) & { children: unknown[] } {
  return Array.isArray((node as { children?: unknown }).children);
}
