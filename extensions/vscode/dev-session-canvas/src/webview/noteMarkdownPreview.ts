import hljs from 'highlight.js/lib/common';
import katex from 'katex';
import MarkdownIt from 'markdown-it';
import markdownItTaskLists from 'markdown-it-task-lists';
import type StateBlock from 'markdown-it/lib/rules_block/state_block.mjs';
import type StateInline from 'markdown-it/lib/rules_inline/state_inline.mjs';
import type Token from 'markdown-it/lib/token.mjs';

import {
  createNoteMarkdownSourceMap,
  type NoteMarkdownSourceBlockKind,
  type NoteMarkdownSourceBlockRange,
  type NoteMarkdownSourceMap,
  type NoteMarkdownSourceTextSegment
} from '../common/noteMarkdownSourceMap';
import type { CanvasRuntimeContext } from '../common/protocol';
import { parseNoteMarkdownFrontMatter, type NoteMarkdownFrontMatter } from './noteMarkdownFrontMatter';
import type { WebviewI18nKey } from './i18n/webviewI18n';

export interface NoteMarkdownPreviewResult {
  html: string;
  frontMatter: NoteMarkdownFrontMatter;
}

export type NoteMarkdownImageWorkspaceRoot = NonNullable<CanvasRuntimeContext['noteMarkdownImageWorkspaceRoots']>[number];

export interface NoteMarkdownPreviewRenderOptions {
  imageBaseUri?: string;
  imageWorkspaceRoots: readonly NoteMarkdownImageWorkspaceRoot[];
}

interface NoteMarkdownNormalizedImagePath {
  segments: string[];
  relativePath: string;
}

interface NoteMarkdownResolvedImageResource {
  baseUri: string;
  relativePath: string;
}

export interface NoteMarkdownPreviewRenderer {
  render(content: string, options: NoteMarkdownPreviewRenderOptions): NoteMarkdownPreviewResult;
}

type NoteMarkdownTranslate = (key: WebviewI18nKey, params?: Record<string, string | number>) => string;

const NOTE_MARKDOWN_RENDERABLE_EXTERNAL_LINK_SCHEMES = new Set(['http', 'https', 'mailto']);
export const NOTE_MARKDOWN_LINK_SELECTOR = 'a[data-note-markdown-link="true"]';
export const NOTE_MARKDOWN_CHECKLIST_SELECTOR = 'input.task-list-item-checkbox[data-note-markdown-task-line]';
export const NOTE_MARKDOWN_SOURCE_TEXT_SELECTOR = '[data-note-markdown-source-offsets]';
export const NOTE_MARKDOWN_SOURCE_BLOCK_SELECTOR = '[data-note-markdown-source-block="true"]';
const NOTE_MARKDOWN_DATA_IMAGE_PATTERN = /^data:image\/(?:png|jpe?g|gif|webp|bmp|avif);base64,[A-Za-z0-9+/=\r\n]+$/iu;

export function createNoteMarkdownPreviewRenderer(t: NoteMarkdownTranslate): NoteMarkdownPreviewRenderer {
  const noteMarkdownRenderer = createNoteMarkdownRenderer(t);

  return {
    render(content, options) {
      const frontMatter = parseNoteMarkdownFrontMatter(content);
      const renderContent = frontMatter.kind === 'valid' ? frontMatter.body : content;
      if (!renderContent.trim()) {
        return {
          html: '',
          frontMatter
        };
      }

      const sourceMap = createNoteMarkdownSourceMap(content, frontMatter);
      const rawHtml = noteMarkdownRenderer.render(renderContent, {
        noteMarkdownLineOffset: frontMatter.lineOffset,
        imageBaseUri: options.imageBaseUri,
        imageWorkspaceRoots: options.imageWorkspaceRoots
      });

      return {
        html: annotateNoteMarkdownPreviewHtml(rawHtml, sourceMap),
        frontMatter
      };
    }
  };
}

function annotateNoteMarkdownPreviewHtml(html: string, sourceMap: NoteMarkdownSourceMap): string {
  if (!html || (sourceMap.textSegments.length === 0 && sourceMap.blockRanges.length === 0)) {
    return html;
  }

  const template = document.createElement('template');
  template.innerHTML = html;
  applyNoteMarkdownSourceBlockRanges(template.content, sourceMap.blockRanges);
  applyNoteMarkdownSourceTextSegments(template.content, sourceMap.textSegments);
  return template.innerHTML;
}

function applyNoteMarkdownSourceBlockRanges(root: ParentNode, ranges: readonly NoteMarkdownSourceBlockRange[]): void {
  const candidateCache = new Map<NoteMarkdownSourceBlockKind, HTMLElement[]>();
  const candidateIndexes = new Map<NoteMarkdownSourceBlockKind, number>();

  for (const range of ranges) {
    const candidates = readNoteMarkdownSourceBlockCandidates(root, range.kind, candidateCache);
    const candidateIndex = candidateIndexes.get(range.kind) ?? 0;
    candidateIndexes.set(range.kind, candidateIndex + 1);
    const element = candidates[candidateIndex];
    if (!element) {
      continue;
    }

    const existingStart = readNoteMarkdownSourceStart(element);
    const existingEnd = readNoteMarkdownSourceEnd(element);
    const sourceStart = existingStart === null ? range.sourceStart : Math.min(existingStart, range.sourceStart);
    const sourceEnd = existingEnd === null ? range.sourceEnd : Math.max(existingEnd, range.sourceEnd);
    element.dataset.noteMarkdownSourceBlock = 'true';
    element.dataset.noteMarkdownSourceStart = String(sourceStart);
    element.dataset.noteMarkdownSourceEnd = String(sourceEnd);
  }
}

function readNoteMarkdownSourceBlockCandidates(
  root: ParentNode,
  kind: NoteMarkdownSourceBlockKind,
  cache: Map<NoteMarkdownSourceBlockKind, HTMLElement[]>
): HTMLElement[] {
  const cached = cache.get(kind);
  if (cached) {
    return cached;
  }

  const selector = noteMarkdownSourceBlockSelectorForKind(kind);
  const candidates = selector ? Array.from(root.querySelectorAll<HTMLElement>(selector)) : [];
  cache.set(kind, candidates);
  return candidates;
}

function noteMarkdownSourceBlockSelectorForKind(kind: NoteMarkdownSourceBlockKind): string | null {
  switch (kind) {
    case 'blockquote':
      return 'blockquote';
    case 'code':
      return 'pre';
    case 'heading':
      return 'h1, h2, h3, h4, h5, h6';
    case 'image':
      return 'img.note-markdown-image, .note-markdown-image-fallback';
    case 'list':
      return 'ul, ol';
    case 'listItem':
      return 'li';
    case 'math':
      return '.note-markdown-math-display';
    case 'paragraph':
      return 'p';
    case 'table':
      return 'table';
    case 'thematicBreak':
      return 'hr';
    default:
      return null;
  }
}

function applyNoteMarkdownSourceTextSegments(root: ParentNode, segments: readonly NoteMarkdownSourceTextSegment[]): void {
  if (segments.length === 0) {
    return;
  }

  const textIndex = createNoteMarkdownPreviewTextIndex(root);
  if (textIndex.text.length === 0) {
    return;
  }

  let searchStart = 0;
  const operations = new Map<Text, Array<{ start: number; end: number; sourceOffsets: number[] }>>();
  for (const segment of segments) {
    if (!segment.text) {
      continue;
    }

    const matchIndex = textIndex.text.indexOf(segment.text, searchStart);
    if (matchIndex === -1) {
      continue;
    }

    collectNoteMarkdownTextSegmentWrapOperations({
      textIndex,
      segment,
      matchIndex,
      operations
    });
    searchStart = matchIndex + segment.text.length;
  }

  for (const [textNode, nodeOperations] of operations) {
    wrapNoteMarkdownTextNodeRanges(textNode, nodeOperations);
  }
}

function createNoteMarkdownPreviewTextIndex(root: ParentNode): {
  text: string;
  chars: Array<{ node: Text; offset: number }>;
} {
  const chars: Array<{ node: Text; offset: number }> = [];
  let text = '';
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!(node instanceof Text) || !node.data) {
        return NodeFilter.FILTER_REJECT;
      }
      const parent = node.parentElement;
      if (
        parent?.closest(
          '.katex, .katex-display, .katex-error, .note-markdown-math-display, .note-markdown-math-fallback, .note-markdown-image-fallback'
        )
      ) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    }
  });

  for (let current = walker.nextNode(); current; current = walker.nextNode()) {
    if (!(current instanceof Text)) {
      continue;
    }
    for (let offset = 0; offset < current.data.length; offset += 1) {
      text += current.data.charAt(offset);
      chars.push({ node: current, offset });
    }
  }

  return { text, chars };
}

function collectNoteMarkdownTextSegmentWrapOperations(params: {
  textIndex: { chars: Array<{ node: Text; offset: number }> };
  segment: NoteMarkdownSourceTextSegment;
  matchIndex: number;
  operations: Map<Text, Array<{ start: number; end: number; sourceOffsets: number[] }>>;
}): void {
  const { textIndex, segment, matchIndex, operations } = params;
  let rangeStart = 0;
  while (rangeStart < segment.text.length) {
    const firstChar = textIndex.chars[matchIndex + rangeStart];
    if (!firstChar) {
      return;
    }

    let rangeEnd = rangeStart + 1;
    while (rangeEnd < segment.text.length) {
      const previousChar = textIndex.chars[matchIndex + rangeEnd - 1];
      const currentChar = textIndex.chars[matchIndex + rangeEnd];
      if (!currentChar || currentChar.node !== firstChar.node || currentChar.offset !== previousChar.offset + 1) {
        break;
      }
      rangeEnd += 1;
    }

    const sourceOffsets = segment.sourceOffsets.slice(rangeStart, rangeEnd + 1);
    if (sourceOffsets.length === rangeEnd - rangeStart + 1) {
      const nodeOperations = operations.get(firstChar.node) ?? [];
      nodeOperations.push({
        start: firstChar.offset,
        end: firstChar.offset + (rangeEnd - rangeStart),
        sourceOffsets
      });
      operations.set(firstChar.node, nodeOperations);
    }

    rangeStart = rangeEnd;
  }
}

function wrapNoteMarkdownTextNodeRanges(
  textNode: Text,
  operations: Array<{ start: number; end: number; sourceOffsets: number[] }>
): void {
  const parent = textNode.parentNode;
  if (!parent) {
    return;
  }

  const sortedOperations = operations
    .filter((operation) => operation.start < operation.end)
    .sort((a, b) => a.start - b.start);
  if (sortedOperations.length === 0) {
    return;
  }

  const fragment = document.createDocumentFragment();
  let cursor = 0;
  for (const operation of sortedOperations) {
    if (operation.start < cursor) {
      continue;
    }
    if (operation.start > cursor) {
      fragment.append(document.createTextNode(textNode.data.slice(cursor, operation.start)));
    }

    const span = document.createElement('span');
    span.dataset.noteMarkdownSourceOffsets = JSON.stringify(operation.sourceOffsets);
    span.dataset.noteMarkdownSourceStart = String(operation.sourceOffsets[0]);
    span.dataset.noteMarkdownSourceEnd = String(operation.sourceOffsets[operation.sourceOffsets.length - 1]);
    span.textContent = textNode.data.slice(operation.start, operation.end);
    fragment.append(span);
    cursor = operation.end;
  }

  if (cursor < textNode.data.length) {
    fragment.append(document.createTextNode(textNode.data.slice(cursor)));
  }

  parent.replaceChild(fragment, textNode);
}

function createNoteMarkdownRenderer(t: NoteMarkdownTranslate): MarkdownIt {
  const renderer = new MarkdownIt({
    html: false,
    breaks: true,
    linkify: true,
    highlight(code, info) {
      const language = info.trim().split(/\s+/, 1)[0];
      if (language && hljs.getLanguage(language)) {
        return renderHighlightedNoteCodeBlock(
          hljs.highlight(code, {
            language,
            ignoreIllegals: true
          }).value,
          language
        );
      }

      if (!language) {
        const autoDetected = hljs.highlightAuto(code);
        if (autoDetected.value) {
          return renderHighlightedNoteCodeBlock(autoDetected.value, autoDetected.language);
        }
      }

      return renderHighlightedNoteCodeBlock(escapeHtml(code), language || undefined);
    }
  });

  renderer.use(markdownItTaskLists, {
    enabled: true
  });
  registerSafeNoteMathRenderer(renderer);
  renderer.core.ruler.after('github-task-lists', 'note-task-list-metadata', (state) => {
    const noteMarkdownLineOffset =
      typeof state.env?.noteMarkdownLineOffset === 'number' ? state.env.noteMarkdownLineOffset : 0;
    for (const token of state.tokens) {
      if (token.type !== 'inline' || !token.map || !Array.isArray(token.children)) {
        continue;
      }

      const checkboxChild = token.children.find(
        (child) =>
          child.type === 'html_inline' &&
          child.content.startsWith('<input') &&
          child.content.includes('task-list-item-checkbox')
      );
      if (!checkboxChild) {
        continue;
      }

      const lineNumber = token.map[0] + 1 + noteMarkdownLineOffset;
      checkboxChild.content = injectNoteMarkdownCheckboxAttributes(checkboxChild.content, {
        'data-note-markdown-task-line': String(lineNumber),
        'aria-label': checkboxChild.content.includes('checked=""')
          ? t('note.markdown.checklist.unmarkComplete')
          : t('note.markdown.checklist.markComplete')
      });
    }
  });

  const defaultLinkOpenRenderer =
    renderer.renderer.rules.link_open ??
    ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
  const defaultImageRenderer =
    renderer.renderer.rules.image ??
    ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
  const defaultValidateLink = renderer.validateLink.bind(renderer);
  renderer.validateLink = (href) =>
    defaultValidateLink(href) &&
    (isRenderableNoteMarkdownHref(href) || isRenderableNoteMarkdownImageReference(href));
  renderer.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const href = token.attrGet('href');
    if (!href || !isRenderableNoteMarkdownHref(href)) {
      removeMarkdownTokenAttribute(token, 'href');
      token.attrSet('aria-disabled', 'true');
      token.attrJoin('class', 'is-disabled');
      return defaultLinkOpenRenderer(tokens, idx, options, env, self);
    }

    token.attrSet('data-note-markdown-link', 'true');
    token.attrJoin('class', 'note-markdown-link');
    token.attrSet('rel', 'noopener noreferrer');
    return defaultLinkOpenRenderer(tokens, idx, options, env, self);
  };
  renderer.renderer.rules.image = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const src = token.attrGet('src');
    const resolvedSrc = src ? resolveRenderableNoteMarkdownImageSrc(src, env) : null;
    if (!resolvedSrc) {
      const altText = token.content.trim() || src || t('note.markdown.imageFallback');
      return `<span class="note-markdown-image-fallback" role="img" aria-label="${escapeHtml(altText)}">${escapeHtml(
        altText
      )}</span>`;
    }

    token.attrSet('src', resolvedSrc);
    token.attrJoin('class', 'note-markdown-image');
    token.attrSet('loading', 'lazy');
    token.attrSet('decoding', 'async');
    token.attrSet('draggable', 'false');
    return defaultImageRenderer(tokens, idx, options, env, self);
  };

  return renderer;
}

function registerSafeNoteMathRenderer(renderer: MarkdownIt): void {
  renderer.inline.ruler.before('escape', 'note_math_inline', parseNoteInlineMath);
  renderer.block.ruler.before('fence', 'note_math_block', parseNoteBlockMath, {
    alt: ['paragraph', 'reference', 'blockquote', 'list']
  });
  renderer.renderer.rules.note_math_inline = (tokens, idx) => renderSafeNoteMath(tokens[idx].content, false);
  renderer.renderer.rules.note_math_block = (tokens, idx) =>
    `<div class="note-markdown-math-display">${renderSafeNoteMath(tokens[idx].content, true)}</div>\n`;
}

function isRenderableNoteMarkdownHref(href: string): boolean {
  const trimmedHref = href.trim();
  if (!trimmedHref || trimmedHref.startsWith('#')) {
    return false;
  }

  const schemeMatch = /^([A-Za-z][A-Za-z0-9+.-]*):/u.exec(trimmedHref);
  if (schemeMatch) {
    return NOTE_MARKDOWN_RENDERABLE_EXTERNAL_LINK_SCHEMES.has(schemeMatch[1].toLowerCase());
  }

  return isRenderableNoteMarkdownWorkspaceHref(trimmedHref);
}

function isRenderableNoteMarkdownWorkspaceHref(href: string): boolean {
  const hashIndex = href.indexOf('#');
  const rawPathPart = hashIndex === -1 ? href : href.slice(0, hashIndex);
  if (!rawPathPart || rawPathPart.includes('?')) {
    return false;
  }

  let decodedPathPart: string;
  try {
    decodedPathPart = decodeURIComponent(rawPathPart);
  } catch {
    return false;
  }

  const normalizedPath = decodedPathPart.replace(/\\/g, '/');
  if (
    !normalizedPath ||
    normalizedPath.startsWith('/') ||
    normalizedPath.startsWith('//') ||
    /^[A-Za-z]:[\\/]/u.test(decodedPathPart)
  ) {
    return false;
  }

  const pathSegments = normalizedPath.split('/').filter((segment) => segment.length > 0);
  return pathSegments.length > 0 && pathSegments.every((segment) => segment !== '..');
}

function isRenderableNoteMarkdownImageReference(src: string): boolean {
  const trimmedSrc = src.trim();
  if (!trimmedSrc) {
    return false;
  }

  if (isRenderableNoteMarkdownDataImageSrc(trimmedSrc)) {
    return true;
  }

  const schemeMatch = /^([A-Za-z][A-Za-z0-9+.-]*):/u.exec(trimmedSrc);
  if (schemeMatch) {
    return schemeMatch[1].toLowerCase() === 'https';
  }

  return isRenderableNoteMarkdownWorkspaceHref(trimmedSrc);
}

function resolveRenderableNoteMarkdownImageSrc(src: string, env: unknown): string | null {
  const trimmedSrc = src.trim();
  if (!trimmedSrc) {
    return null;
  }

  if (isRenderableNoteMarkdownDataImageSrc(trimmedSrc)) {
    return trimmedSrc;
  }

  let parsedUrl: URL | null = null;
  try {
    parsedUrl = new URL(trimmedSrc);
  } catch {
    parsedUrl = null;
  }
  if (parsedUrl) {
    return parsedUrl.protocol.toLowerCase() === 'https:' ? parsedUrl.toString() : null;
  }

  const normalizedPath = normalizeNoteMarkdownImageRelativePath(trimmedSrc);
  if (!normalizedPath) {
    return null;
  }

  const options = readNoteMarkdownPreviewRenderOptions(env);
  const associatedBaseUri = normalizeNoteMarkdownImageBaseUri(options.imageBaseUri);
  if (associatedBaseUri) {
    return resolveNoteMarkdownImageAgainstBaseUri(normalizedPath, associatedBaseUri);
  }

  const workspaceResource = resolveNoteMarkdownWorkspaceImageResource(normalizedPath, options.imageWorkspaceRoots);
  return workspaceResource
    ? resolveNoteMarkdownImageAgainstBaseUri(workspaceResource.relativePath, workspaceResource.baseUri)
    : null;
}

function isRenderableNoteMarkdownDataImageSrc(src: string): boolean {
  return NOTE_MARKDOWN_DATA_IMAGE_PATTERN.test(src);
}

function normalizeNoteMarkdownImageRelativePath(src: string): NoteMarkdownNormalizedImagePath | null {
  const [rawPathPart] = splitNoteMarkdownImagePathAndFragment(src);
  if (!rawPathPart || rawPathPart.includes('?')) {
    return null;
  }

  let decodedPathPart: string;
  try {
    decodedPathPart = decodeURIComponent(rawPathPart);
  } catch {
    return null;
  }

  const normalizedPath = decodedPathPart.replace(/\\/g, '/');
  if (
    !normalizedPath ||
    normalizedPath.startsWith('/') ||
    normalizedPath.startsWith('//') ||
    /^[A-Za-z]:[\\/]/u.test(decodedPathPart)
  ) {
    return null;
  }

  const segments: string[] = [];
  for (const segment of normalizedPath.split('/')) {
    if (!segment || segment === '.') {
      continue;
    }
    if (segment === '..') {
      return null;
    }
    segments.push(segment);
  }

  if (segments.length === 0) {
    return null;
  }

  return {
    segments,
    relativePath: segments.map((segment) => encodeURIComponent(segment)).join('/')
  };
}

function splitNoteMarkdownImagePathAndFragment(src: string): [string, string] {
  const hashIndex = src.indexOf('#');
  return hashIndex === -1 ? [src, ''] : [src.slice(0, hashIndex), src.slice(hashIndex + 1)];
}

function readNoteMarkdownPreviewRenderOptions(env: unknown): NoteMarkdownPreviewRenderOptions {
  if (!env || typeof env !== 'object') {
    return {
      imageWorkspaceRoots: []
    };
  }

  const candidate = env as Partial<NoteMarkdownPreviewRenderOptions>;
  return {
    imageBaseUri: typeof candidate.imageBaseUri === 'string' ? candidate.imageBaseUri : undefined,
    imageWorkspaceRoots: Array.isArray(candidate.imageWorkspaceRoots)
      ? candidate.imageWorkspaceRoots.filter(
          (root): root is NoteMarkdownImageWorkspaceRoot =>
            typeof root?.name === 'string' && typeof root.webviewResourceBaseUri === 'string'
        )
      : []
  };
}

function normalizeNoteMarkdownImageBaseUri(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);
    return url.toString().endsWith('/') ? url.toString() : `${url.toString()}/`;
  } catch {
    return null;
  }
}

function resolveNoteMarkdownWorkspaceImageResource(
  normalizedPath: NoteMarkdownNormalizedImagePath,
  workspaceRoots: readonly NoteMarkdownImageWorkspaceRoot[]
): NoteMarkdownResolvedImageResource | null {
  if (workspaceRoots.length === 0) {
    return null;
  }

  if (workspaceRoots.length === 1) {
    const baseUri = normalizeNoteMarkdownImageBaseUri(workspaceRoots[0].webviewResourceBaseUri);
    return baseUri ? { baseUri, relativePath: normalizedPath.relativePath } : null;
  }

  const [rootName] = normalizedPath.segments;
  const normalizedRootName = normalizeNoteMarkdownWorkspaceRootName(rootName);
  const matchingRoot = workspaceRoots.find(
    (root) => normalizeNoteMarkdownWorkspaceRootName(root.name) === normalizedRootName
  );
  if (!matchingRoot || normalizedPath.segments.length < 2) {
    return null;
  }

  const baseUri = normalizeNoteMarkdownImageBaseUri(matchingRoot.webviewResourceBaseUri);
  if (!baseUri) {
    return null;
  }

  return {
    baseUri,
    relativePath: normalizedPath.segments.slice(1).map((segment) => encodeURIComponent(segment)).join('/')
  };
}

function normalizeNoteMarkdownWorkspaceRootName(value: string): string {
  return value.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

function resolveNoteMarkdownImageAgainstBaseUri(
  normalizedPath: { relativePath: string } | string,
  baseUri: string
): string | null {
  try {
    return new URL(
      typeof normalizedPath === 'string' ? normalizedPath : normalizedPath.relativePath,
      baseUri
    ).toString();
  } catch {
    return null;
  }
}

function removeMarkdownTokenAttribute(token: Token, attributeName: string): void {
  const attributeIndex = token.attrIndex(attributeName);
  if (attributeIndex < 0 || !token.attrs) {
    return;
  }

  token.attrs.splice(attributeIndex, 1);
}

function parseNoteInlineMath(state: StateInline, silent: boolean): boolean {
  if (state.src.charAt(state.pos) !== '$' || state.src.charAt(state.pos + 1) === '$') {
    return false;
  }

  const markerEnd = findUnescapedNoteMathDelimiter(state.src, '$', state.pos + 1, state.posMax);
  if (markerEnd === -1) {
    return false;
  }

  const content = state.src.slice(state.pos + 1, markerEnd);
  if (!content.trim()) {
    return false;
  }

  if (!silent) {
    const token = state.push('note_math_inline', 'math', 0);
    token.content = content;
    token.markup = '$';
  }

  state.pos = markerEnd + 1;
  return true;
}

function parseNoteBlockMath(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  if (state.sCount[startLine] - state.blkIndent >= 4) {
    return false;
  }

  const lineStart = state.bMarks[startLine] + state.tShift[startLine];
  const lineEnd = state.eMarks[startLine];
  const lineText = state.src.slice(lineStart, lineEnd);
  const openingMarkerOffset = lineText.indexOf('$$');
  if (openingMarkerOffset === -1 || lineText.slice(0, openingMarkerOffset).trim().length > 0) {
    return false;
  }

  const openingMarkerEnd = lineStart + openingMarkerOffset + 2;
  const openingLineRest = state.src.slice(openingMarkerEnd, lineEnd);
  const sameLineClosingOffset = findUnescapedNoteMathDelimiter(openingLineRest, '$$', 0, openingLineRest.length);
  if (sameLineClosingOffset !== -1 && openingLineRest.slice(sameLineClosingOffset + 2).trim().length === 0) {
    if (!silent) {
      pushNoteBlockMathToken(state, startLine, startLine + 1, openingLineRest.slice(0, sameLineClosingOffset));
    }
    state.line = startLine + 1;
    return true;
  }

  if (openingLineRest.trim().length > 0) {
    return false;
  }

  for (let nextLine = startLine + 1; nextLine < endLine; nextLine += 1) {
    const nextLineStart = state.bMarks[nextLine] + state.tShift[nextLine];
    const nextLineEnd = state.eMarks[nextLine];
    const nextLineText = state.src.slice(nextLineStart, nextLineEnd);
    if (nextLineText.trim() !== '$$') {
      continue;
    }

    if (!silent) {
      pushNoteBlockMathToken(state, startLine, nextLine + 1, state.getLines(startLine + 1, nextLine, 0, true));
    }
    state.line = nextLine + 1;
    return true;
  }

  return false;
}

function pushNoteBlockMathToken(
  state: StateBlock,
  startLine: number,
  endLine: number,
  content: string
): void {
  const token = state.push('note_math_block', 'math', 0);
  token.block = true;
  token.content = content.trim();
  token.map = [startLine, endLine];
  token.markup = '$$';
}

function findUnescapedNoteMathDelimiter(source: string, delimiter: '$' | '$$', start: number, end: number): number {
  for (let offset = start; offset < end; offset += 1) {
    if (!source.startsWith(delimiter, offset) || isEscapedNoteMathDelimiter(source, offset)) {
      continue;
    }

    return offset;
  }

  return -1;
}

function isEscapedNoteMathDelimiter(source: string, delimiterOffset: number): boolean {
  let backslashCount = 0;
  for (let offset = delimiterOffset - 1; offset >= 0 && source.charAt(offset) === '\\'; offset -= 1) {
    backslashCount += 1;
  }

  return backslashCount % 2 === 1;
}

function renderSafeNoteMath(content: string, displayMode: boolean): string {
  try {
    return katex.renderToString(content, {
      displayMode,
      strict: 'ignore',
      throwOnError: false,
      trust: false
    });
  } catch {
    return `<code class="note-markdown-math-fallback">${escapeHtml(content)}</code>`;
  }
}

function renderHighlightedNoteCodeBlock(highlightedHtml: string, language: string | undefined): string {
  const languageClass = normalizeHighlightedNoteCodeLanguageClass(language);
  return `<pre><code class="hljs${languageClass ? ` ${languageClass}` : ''}">${highlightedHtml}</code></pre>`;
}

function normalizeHighlightedNoteCodeLanguageClass(language: string | undefined): string | null {
  if (!language) {
    return null;
  }

  return /^[A-Za-z0-9_+-]+$/u.test(language) ? `language-${language}` : null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function findNoteMarkdownLinkTarget(target: EventTarget | null): HTMLAnchorElement | null {
  if (!(target instanceof HTMLElement)) {
    return null;
  }

  return target.closest<HTMLAnchorElement>(NOTE_MARKDOWN_LINK_SELECTOR);
}

export function findNoteMarkdownChecklistInputTarget(target: EventTarget | null): HTMLInputElement | null {
  if (!(target instanceof HTMLElement)) {
    return null;
  }

  const checkbox = target.closest<HTMLInputElement>(NOTE_MARKDOWN_CHECKLIST_SELECTOR);
  return checkbox instanceof HTMLInputElement ? checkbox : null;
}

export function readNoteMarkdownChecklistLineNumber(input: HTMLInputElement): number | null {
  const rawLineNumber = input.dataset.noteMarkdownTaskLine;
  if (!rawLineNumber) {
    return null;
  }

  const parsedLineNumber = Number.parseInt(rawLineNumber, 10);
  return Number.isSafeInteger(parsedLineNumber) && parsedLineNumber > 0 ? parsedLineNumber : null;
}

export function readNoteMarkdownSourceStart(element: HTMLElement): number | null {
  return readNoteMarkdownSourceBoundary(element.dataset.noteMarkdownSourceStart);
}

export function readNoteMarkdownSourceEnd(element: HTMLElement): number | null {
  return readNoteMarkdownSourceBoundary(element.dataset.noteMarkdownSourceEnd);
}

function readNoteMarkdownSourceBoundary(rawValue: string | undefined): number | null {
  if (!rawValue) {
    return null;
  }
  const parsed = Number.parseInt(rawValue, 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

export function clampNoteMarkdownSourceOffset(offset: number, content: string): number {
  if (!Number.isFinite(offset)) {
    return content.length;
  }
  return Math.max(0, Math.min(Math.round(offset), content.length));
}

function injectNoteMarkdownCheckboxAttributes(
  html: string,
  attributes: Record<string, string>
): string {
  if (!html.startsWith('<input')) {
    return html;
  }

  const serializedAttributes = Object.entries(attributes)
    .map(([key, value]) => ` ${key}="${escapeHtml(value)}"`)
    .join('');
  return html.replace(/^<input\b/u, `<input${serializedAttributes}`);
}
