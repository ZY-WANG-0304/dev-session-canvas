import type { IBufferLine, IBufferRange, ILink, ILinkProvider, Terminal } from '@xterm/xterm';

import type { CanvasRuntimeContext, ExecutionNodeKind } from '../common/protocol';
import {
  detectExecutionTerminalFallbackPathLink,
  detectExecutionTerminalPathLinks,
  type DetectedExecutionTerminalPathLink,
  type ExecutionTerminalFileLinkCandidate,
  type ExecutionTerminalDroppedResource,
  type ExecutionTerminalOpenLink,
  type ExecutionTerminalResolvedFileLink
} from '../common/executionTerminalLinks';

interface ExecutionTerminalNativeInteractionsOptions {
  nodeId: string;
  kind: ExecutionNodeKind;
  terminal: Terminal;
  dropTarget: HTMLElement;
  getRuntimeContext: () => CanvasRuntimeContext;
  onDropResource: (
    nodeId: string,
    kind: ExecutionNodeKind,
    resource: ExecutionTerminalDroppedResource
  ) => void;
  onOpenLink: (
    nodeId: string,
    kind: ExecutionNodeKind,
    link: ExecutionTerminalOpenLink
  ) => void;
  resolveFileLinks: (
    nodeId: string,
    kind: ExecutionNodeKind,
    candidates: ExecutionTerminalFileLinkCandidate[]
  ) => Promise<ExecutionTerminalResolvedFileLink[]>;
}

interface WrappedLineContext {
  startLine: number;
  endLine: number;
  lines: IBufferLine[];
  text: string;
}

interface SimpleRange {
  startColumn: number;
  startLineNumber: number;
  endColumn: number;
  endLineNumber: number;
}

interface ActiveTooltipState {
  text: string;
  dispose: () => void;
}

const RESOURCE_URLS_DATA_TRANSFER = 'ResourceURLs';
const CODE_FILES_DATA_TRANSFER = 'CodeFiles';
const URI_LIST_DATA_TRANSFER = 'text/uri-list';
const EXECUTION_LINK_TOOLTIP_CLASS = 'execution-link-tooltip';
const EXECUTION_LINK_TOOLTIP_VISIBLE_CLASS = 'is-visible';
const FILE_LINK_LABEL = 'Open file in editor';
const URL_LINK_LABEL = 'Follow link';
const URL_REGEX = /\bhttps?:\/\/[^\s<>"'`]+/g;

export interface ExecutionTerminalNativeInteractionsHandle {
  activateLinkForTest(linkText: string): Promise<void>;
  hoverLinkForTest(linkText: string): Promise<void>;
  clearHoverForTest(): void;
  dispose(): void;
}

export function setupExecutionTerminalNativeInteractions(
  options: ExecutionTerminalNativeInteractionsOptions
): ExecutionTerminalNativeInteractionsHandle {
  const { terminal, dropTarget } = options;
  const fileLinkResolutionCache = new Map<
    string,
    ExecutionTerminalResolvedFileLink[] | Promise<ExecutionTerminalResolvedFileLink[]>
  >();
  let tooltip: ActiveTooltipState | undefined;
  let hoveredLink: ILink | undefined;

  const clearDropTarget = (): void => {
    dropTarget.classList.remove('is-drop-target');
  };

  const setDropTarget = (): void => {
    dropTarget.classList.add('is-drop-target');
  };

  const hideTooltip = (): void => {
    tooltip?.dispose();
    tooltip = undefined;
  };

  const updateTooltip = (nextTooltip: ActiveTooltipState | undefined): void => {
    hideTooltip();
    tooltip = nextTooltip;
  };

  const clearHoveredLink = (): void => {
    const currentHoveredLink = hoveredLink;
    hoveredLink = undefined;
    if (currentHoveredLink?.leave) {
      currentHoveredLink.leave(createSyntheticHoverEvent(dropTarget), currentHoveredLink.text);
    }
    hideTooltip();
  };

  const fileLinkProvider = createFileLinkProvider(options, fileLinkResolutionCache, () => tooltip, updateTooltip);
  const urlLinkProvider = createUrlLinkProvider(options, () => tooltip, updateTooltip);
  const fileLinkDisposable = terminal.registerLinkProvider(fileLinkProvider);
  const urlLinkDisposable = terminal.registerLinkProvider(urlLinkProvider);

  const handleDragEnter = (event: DragEvent): void => {
    if (!hasPotentialDroppedExecutionResource(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setDropTarget();
  };

  const handleDragOver = (event: DragEvent): void => {
    if (!hasPotentialDroppedExecutionResource(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setDropTarget();
  };

  const handleDragLeave = (_event: DragEvent): void => {
    clearDropTarget();
  };

  const handleDrop = (event: DragEvent): void => {
    clearDropTarget();
    if (hasPotentialDroppedExecutionResource(event.dataTransfer)) {
      event.preventDefault();
      event.stopPropagation();
    }

    const resource = extractDroppedExecutionResource(event.dataTransfer);
    if (!resource) {
      return;
    }

    options.terminal.focus();
    options.onDropResource(options.nodeId, options.kind, resource);
  };

  dropTarget.addEventListener('dragenter', handleDragEnter);
  dropTarget.addEventListener('dragover', handleDragOver);
  dropTarget.addEventListener('dragleave', handleDragLeave);
  dropTarget.addEventListener('dragend', handleDragLeave);
  dropTarget.addEventListener('drop', handleDrop);

  return {
    async activateLinkForTest(linkText: string): Promise<void> {
      const detectedLink = await findInteractionLinkByText(
        options,
        linkText,
        fileLinkResolutionCache,
        () => undefined
      );
      if (!detectedLink) {
        throw new Error(`Execution link "${linkText}" was not detected.`);
      }

      detectedLink.activate(createSyntheticLinkActivationEvent(options.getRuntimeContext()), detectedLink.text);
    },
    async hoverLinkForTest(linkText: string): Promise<void> {
      const detectedLink = await findInteractionLinkByText(options, linkText, fileLinkResolutionCache, updateTooltip);
      if (!detectedLink) {
        throw new Error(`Execution link "${linkText}" was not detected.`);
      }

      if (!detectedLink.hover) {
        throw new Error(`Execution link "${linkText}" does not support hover interactions.`);
      }

      if (hoveredLink && hoveredLink.text !== detectedLink.text) {
        clearHoveredLink();
      }

      detectedLink.hover(createSyntheticHoverEvent(dropTarget), detectedLink.text);
      hoveredLink = detectedLink;
    },
    clearHoverForTest(): void {
      clearHoveredLink();
    },
    dispose(): void {
      clearHoveredLink();
      clearDropTarget();
      fileLinkDisposable.dispose();
      urlLinkDisposable.dispose();
      dropTarget.removeEventListener('dragenter', handleDragEnter);
      dropTarget.removeEventListener('dragover', handleDragOver);
      dropTarget.removeEventListener('dragleave', handleDragLeave);
      dropTarget.removeEventListener('dragend', handleDragLeave);
      dropTarget.removeEventListener('drop', handleDrop);
      fileLinkResolutionCache.clear();
    }
  };
}

function createFileLinkProvider(
  options: ExecutionTerminalNativeInteractionsOptions,
  fileLinkResolutionCache: Map<
    string,
    ExecutionTerminalResolvedFileLink[] | Promise<ExecutionTerminalResolvedFileLink[]>
  >,
  _readTooltip: () => ActiveTooltipState | undefined,
  updateTooltip: (tooltip: ActiveTooltipState | undefined) => void
): ILinkProvider {
  return {
    provideLinks(bufferLineNumber, callback): void {
      const context = readWrappedLineContext(options.terminal, bufferLineNumber);
      if (!context) {
        callback(undefined);
        return;
      }

      void collectFileLinks(options, context, updateTooltip, fileLinkResolutionCache)
        .then((links) => {
          callback(links.length > 0 ? links : undefined);
        })
        .catch(() => {
          callback(undefined);
        });
    }
  };
}

function createUrlLinkProvider(
  options: ExecutionTerminalNativeInteractionsOptions,
  _readTooltip: () => ActiveTooltipState | undefined,
  updateTooltip: (tooltip: ActiveTooltipState | undefined) => void
): ILinkProvider {
  return {
    provideLinks(bufferLineNumber, callback): void {
      const context = readWrappedLineContext(options.terminal, bufferLineNumber);
      if (!context) {
        callback(undefined);
        return;
      }

      const links = collectUrlLinks(options, context, updateTooltip);
      callback(links.length > 0 ? links : undefined);
    }
  };
}

async function collectFileLinks(
  options: ExecutionTerminalNativeInteractionsOptions,
  context: WrappedLineContext,
  updateTooltip: (tooltip: ActiveTooltipState | undefined) => void,
  fileLinkResolutionCache: Map<
    string,
    ExecutionTerminalResolvedFileLink[] | Promise<ExecutionTerminalResolvedFileLink[]>
  >
): Promise<ILink[]> {
  const candidates = collectFileLinkCandidates(context);
  if (candidates.length === 0) {
    return [];
  }

  const resolvedLinks = await resolveExecutionFileLinksForContext(
    options,
    context,
    candidates,
    fileLinkResolutionCache
  );
  return mapResolvedFileLinksToInteractions(options, context, candidates, resolvedLinks, updateTooltip);
}

function collectUrlLinks(
  options: ExecutionTerminalNativeInteractionsOptions,
  context: WrappedLineContext,
  updateTooltip: (tooltip: ActiveTooltipState | undefined) => void
): ILink[] {
  const links: ILink[] = [];
  URL_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = URL_REGEX.exec(context.text)) !== null) {
    const rawUrl = match[0];
    const trimmedUrl = trimUrlCandidate(rawUrl);
    if (!trimmedUrl) {
      continue;
    }

    const startColumn = match.index + 1;
    const endColumn = match.index + trimmedUrl.length + 1;
    links.push(
      createInteractionLink(
        options,
        context,
        trimmedUrl,
        URL_LINK_LABEL,
        {
          linkKind: 'url',
          text: trimmedUrl,
          url: trimmedUrl
        },
        updateTooltip,
        {
          startColumn,
          startLineNumber: 1,
          endColumn,
          endLineNumber: 1
        }
      )
    );
  }

  return links;
}

function collectFileLinkCandidates(context: WrappedLineContext): ExecutionTerminalFileLinkCandidate[] {
  const detectedCandidates = dedupeDetectedPathLinks([
    ...detectExecutionTerminalPathLinks(context.text, 'posix'),
    ...detectExecutionTerminalPathLinks(context.text, 'windows')
  ]).filter((candidate) => !/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(candidate.path) || candidate.path.startsWith('file://'));

  if (detectedCandidates.length === 0) {
    const fallback = detectExecutionTerminalFallbackPathLink(context.text);
    if (fallback) {
      detectedCandidates.push(fallback);
    }
  }

  return detectedCandidates.map((candidate) => ({
    candidateId: createExecutionTerminalFileLinkCandidateId(context, candidate),
    text: candidate.text,
    path: candidate.path,
    startIndex: candidate.startIndex,
    endIndexExclusive: candidate.endIndexExclusive,
    line: candidate.line,
    column: candidate.column,
    lineEnd: candidate.lineEnd,
    columnEnd: candidate.columnEnd
  }));
}

function createExecutionTerminalFileLinkCandidateId(
  context: WrappedLineContext,
  candidate: DetectedExecutionTerminalPathLink
): string {
  return `${context.startLine}:${candidate.startIndex}:${candidate.endIndexExclusive}:${candidate.text}`;
}

async function resolveExecutionFileLinksForContext(
  options: ExecutionTerminalNativeInteractionsOptions,
  context: WrappedLineContext,
  candidates: ExecutionTerminalFileLinkCandidate[],
  fileLinkResolutionCache: Map<
    string,
    ExecutionTerminalResolvedFileLink[] | Promise<ExecutionTerminalResolvedFileLink[]>
  >
): Promise<ExecutionTerminalResolvedFileLink[]> {
  const cacheKey = `${context.startLine}:${context.endLine}:${context.text}`;
  const cachedEntry = fileLinkResolutionCache.get(cacheKey);
  if (Array.isArray(cachedEntry)) {
    return cachedEntry;
  }

  if (cachedEntry) {
    return cachedEntry;
  }

  const request = options
    .resolveFileLinks(options.nodeId, options.kind, candidates)
    .then((resolvedLinks) => {
      fileLinkResolutionCache.set(cacheKey, resolvedLinks);
      trimExecutionFileLinkResolutionCache(fileLinkResolutionCache);
      return resolvedLinks;
    })
    .catch((error) => {
      fileLinkResolutionCache.delete(cacheKey);
      throw error;
    });
  fileLinkResolutionCache.set(cacheKey, request);
  return request;
}

function trimExecutionFileLinkResolutionCache(
  fileLinkResolutionCache: Map<
    string,
    ExecutionTerminalResolvedFileLink[] | Promise<ExecutionTerminalResolvedFileLink[]>
  >
): void {
  const maxEntries = 240;
  while (fileLinkResolutionCache.size > maxEntries) {
    const oldestKey = fileLinkResolutionCache.keys().next().value;
    if (typeof oldestKey !== 'string') {
      break;
    }

    fileLinkResolutionCache.delete(oldestKey);
  }
}

function mapResolvedFileLinksToInteractions(
  options: ExecutionTerminalNativeInteractionsOptions,
  context: WrappedLineContext,
  candidates: ExecutionTerminalFileLinkCandidate[],
  resolvedLinks: ExecutionTerminalResolvedFileLink[],
  updateTooltip: (tooltip: ActiveTooltipState | undefined) => void
): ILink[] {
  const candidatesById = new Map(candidates.map((candidate) => [candidate.candidateId, candidate]));
  const links: ILink[] = [];
  for (const resolvedLink of resolvedLinks) {
    const candidate = candidatesById.get(resolvedLink.candidateId);
    if (!candidate) {
      continue;
    }

    links.push(
      createInteractionLink(
        options,
        context,
        resolvedLink.link.text,
        FILE_LINK_LABEL,
        resolvedLink.link,
        updateTooltip,
        {
          startColumn: candidate.startIndex + 1,
          startLineNumber: 1,
          endColumn: candidate.endIndexExclusive + 1,
          endLineNumber: 1
        }
      )
    );
  }

  return links;
}

function createInteractionLink(
  options: ExecutionTerminalNativeInteractionsOptions,
  context: WrappedLineContext,
  text: string,
  hoverLabel: string,
  link: ExecutionTerminalOpenLink,
  updateTooltip: (tooltip: ActiveTooltipState | undefined) => void,
  range: SimpleRange
): ILink {
  const xtermRange = convertLinkRangeToBuffer(context.lines, options.terminal.cols, range, context.startLine);
  return {
    text,
    range: xtermRange,
    activate: (event): void => {
      if (!shouldActivateExecutionLink(options.getRuntimeContext(), event)) {
        return;
      }

      options.onOpenLink(options.nodeId, options.kind, link);
    },
    hover: (event): void => {
      updateTooltip(createExecutionLinkTooltip(event, hoverLabel, options.getRuntimeContext()));
    },
    leave: (): void => {
      updateTooltip(undefined);
    }
  };
}

function createExecutionLinkTooltip(
  event: MouseEvent,
  label: string,
  runtimeContext: CanvasRuntimeContext
): ActiveTooltipState {
  const tooltip = document.createElement('div');
  tooltip.className = `${EXECUTION_LINK_TOOLTIP_CLASS} ${EXECUTION_LINK_TOOLTIP_VISIBLE_CLASS}`;
  tooltip.textContent = `${label} (${describeExecutionLinkModifier(runtimeContext)})`;
  document.body.appendChild(tooltip);
  const offsetX = 12;
  const offsetY = 18;
  tooltip.style.left = `${Math.min(event.clientX + offsetX, window.innerWidth - tooltip.offsetWidth - 12)}px`;
  tooltip.style.top = `${Math.min(event.clientY + offsetY, window.innerHeight - tooltip.offsetHeight - 12)}px`;
  return {
    text: tooltip.textContent ?? '',
    dispose: (): void => {
      tooltip.remove();
    }
  };
}

function describeExecutionLinkModifier(runtimeContext: CanvasRuntimeContext): string {
  if (runtimeContext.editorMultiCursorModifier === 'ctrlCmd') {
    return isMacintosh() ? 'option + click' : 'alt + click';
  }

  return isMacintosh() ? 'cmd + click' : 'ctrl + click';
}

function shouldActivateExecutionLink(
  runtimeContext: CanvasRuntimeContext,
  event: MouseEvent
): boolean {
  if (runtimeContext.editorMultiCursorModifier === 'ctrlCmd') {
    return event.altKey;
  }

  return isMacintosh() ? event.metaKey : event.ctrlKey;
}

function createSyntheticLinkActivationEvent(runtimeContext: CanvasRuntimeContext): MouseEvent {
  if (runtimeContext.editorMultiCursorModifier === 'ctrlCmd') {
    return new MouseEvent('click', {
      altKey: true,
      bubbles: true
    });
  }

  return new MouseEvent('click', {
    ctrlKey: !isMacintosh(),
    metaKey: isMacintosh(),
    bubbles: true
  });
}

function createSyntheticHoverEvent(target: HTMLElement): MouseEvent {
  const rect = target.getBoundingClientRect();
  return new MouseEvent('mousemove', {
    bubbles: true,
    clientX: Math.round(rect.left + Math.min(Math.max(rect.width / 2, 12), 48)),
    clientY: Math.round(rect.top + Math.min(Math.max(rect.height / 2, 12), 48))
  });
}

function isMacintosh(): boolean {
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform);
}

function readWrappedLineContext(terminal: Terminal, bufferLineNumber: number): WrappedLineContext | undefined {
  const startBufferLine = bufferLineNumber - 1;
  let startLine = startBufferLine;
  let endLine = startBufferLine;
  const initialLine = terminal.buffer.active.getLine(startLine);
  if (!initialLine) {
    return undefined;
  }

  const lines: IBufferLine[] = [initialLine];
  while (startLine > 0 && terminal.buffer.active.getLine(startLine)?.isWrapped) {
    const previousLine = terminal.buffer.active.getLine(startLine - 1);
    if (!previousLine) {
      break;
    }

    lines.unshift(previousLine);
    startLine -= 1;
  }

  while (terminal.buffer.active.getLine(endLine + 1)?.isWrapped) {
    const nextLine = terminal.buffer.active.getLine(endLine + 1);
    if (!nextLine) {
      break;
    }

    lines.push(nextLine);
    endLine += 1;
  }

  return {
    startLine,
    endLine,
    lines,
    text: getXtermLineContent(terminal, startLine, endLine)
  };
}

function getXtermLineContent(terminal: Terminal, lineStart: number, lineEnd: number): string {
  const maxLineLength = Math.max(2048, terminal.cols * 2);
  const boundedEnd = Math.min(lineEnd, lineStart + maxLineLength);
  let content = '';
  for (let lineIndex = lineStart; lineIndex <= boundedEnd; lineIndex += 1) {
    const line = terminal.buffer.active.getLine(lineIndex);
    if (!line) {
      continue;
    }

    content += line.translateToString(true, 0, terminal.cols);
  }

  return content;
}

function convertLinkRangeToBuffer(
  lines: IBufferLine[],
  bufferWidth: number,
  range: SimpleRange,
  startLine: number
): IBufferRange {
  const bufferRange: IBufferRange = {
    start: {
      x: range.startColumn,
      y: range.startLineNumber + startLine
    },
    end: {
      x: range.endColumn - 1,
      y: range.endLineNumber + startLine
    }
  };

  let startOffset = 0;
  const startWrappedLineCount = Math.ceil(range.startColumn / bufferWidth);
  for (let lineIndex = 0; lineIndex < Math.min(startWrappedLineCount, lines.length); lineIndex += 1) {
    const lineLength = Math.min(bufferWidth, range.startColumn - 1 - lineIndex * bufferWidth);
    let lineOffset = 0;
    const line = lines[lineIndex];
    if (!line) {
      break;
    }

    for (let x = 0; x < Math.min(bufferWidth, lineLength + lineOffset); x += 1) {
      const cell = line.getCell(x);
      if (!cell) {
        break;
      }

      const width = cell.getWidth();
      if (width === 2) {
        lineOffset += 1;
      }

      const char = cell.getChars();
      if (char.length > 1) {
        lineOffset -= char.length - 1;
      }
    }

    startOffset += lineOffset;
  }

  let endOffset = 0;
  const endWrappedLineCount = Math.ceil(range.endColumn / bufferWidth);
  for (
    let lineIndex = Math.max(0, startWrappedLineCount - 1);
    lineIndex < Math.min(endWrappedLineCount, lines.length);
    lineIndex += 1
  ) {
    const start =
      lineIndex === startWrappedLineCount - 1 ? ((range.startColumn - 1 + startOffset) % bufferWidth) : 0;
    const lineLength = Math.min(bufferWidth, range.endColumn + startOffset - lineIndex * bufferWidth);
    let lineOffset = 0;
    const line = lines[lineIndex];
    if (!line) {
      break;
    }

    for (let x = start; x < Math.min(bufferWidth, lineLength + lineOffset); x += 1) {
      const cell = line.getCell(x);
      if (!cell) {
        break;
      }

      const width = cell.getWidth();
      const chars = cell.getChars();
      if (width === 2) {
        lineOffset += 1;
      }

      if (x === bufferWidth - 1 && chars === '') {
        lineOffset += 1;
      }

      if (chars.length > 1) {
        lineOffset -= chars.length - 1;
      }
    }

    endOffset += lineOffset;
  }

  bufferRange.start.x += startOffset;
  bufferRange.end.x += startOffset + endOffset;

  while (bufferRange.start.x > bufferWidth) {
    bufferRange.start.x -= bufferWidth;
    bufferRange.start.y += 1;
  }

  while (bufferRange.end.x > bufferWidth) {
    bufferRange.end.x -= bufferWidth;
    bufferRange.end.y += 1;
  }

  return bufferRange;
}

function trimUrlCandidate(value: string): string {
  let trimmed = value;
  while (/[),.;!?]$/.test(trimmed)) {
    trimmed = trimmed.slice(0, -1);
  }

  return trimmed;
}

function dedupeDetectedPathLinks(
  links: DetectedExecutionTerminalPathLink[]
): DetectedExecutionTerminalPathLink[] {
  const seen = new Set<string>();
  const deduped: DetectedExecutionTerminalPathLink[] = [];
  for (const link of links) {
    const key = `${link.startIndex}:${link.endIndexExclusive}:${link.text}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(link);
  }

  return deduped;
}

function extractDroppedExecutionResource(
  dataTransfer: DataTransfer | null
): ExecutionTerminalDroppedResource | undefined {
  if (!dataTransfer) {
    return undefined;
  }

  const rawResources = dataTransfer.getData(RESOURCE_URLS_DATA_TRANSFER);
  if (rawResources) {
    const resources = parseDroppedStringArray(rawResources);
    if (resources.length > 0) {
      return {
        source: 'resourceUrls',
        valueKind: 'uri',
        value: resources[0]
      };
    }
  }

  const rawCodeFiles = dataTransfer.getData(CODE_FILES_DATA_TRANSFER);
  if (rawCodeFiles) {
    const files = parseDroppedStringArray(rawCodeFiles);
    if (files.length > 0) {
      return {
        source: 'codeFiles',
        valueKind: 'path',
        value: files[0]
      };
    }
  }

  const rawUriList = dataTransfer.getData(URI_LIST_DATA_TRANSFER);
  if (rawUriList) {
    const uriList = rawUriList
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0 && !entry.startsWith('#'));
    if (uriList.length > 0) {
      return {
        source: 'uriList',
        valueKind: 'uri',
        value: uriList[0]
      };
    }
  }

  if (dataTransfer.files.length > 0) {
    const firstFile = dataTransfer.files[0] as File & { path?: string };
    if (typeof firstFile.path === 'string' && firstFile.path.trim().length > 0) {
      return {
        source: 'files',
        valueKind: 'path',
        value: firstFile.path
      };
    }
  }

  return undefined;
}

function hasPotentialDroppedExecutionResource(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) {
    return false;
  }

  if (dataTransfer.files.length > 0) {
    return true;
  }

  return [RESOURCE_URLS_DATA_TRANSFER, CODE_FILES_DATA_TRANSFER, URI_LIST_DATA_TRANSFER].some((type) =>
    hasDataTransferType(dataTransfer, type)
  );
}

function hasDataTransferType(dataTransfer: DataTransfer, type: string): boolean {
  const dataTransferTypes = dataTransfer.types;
  if (!dataTransferTypes) {
    return false;
  }

  const contains = (dataTransferTypes as { contains?: (value: string) => boolean }).contains;
  if (typeof contains === 'function') {
    return contains.call(dataTransferTypes, type);
  }

  return Array.from(dataTransferTypes).some((entry) => entry === type);
}

function parseDroppedStringArray(rawValue: string): string[] {
  try {
    const parsed = JSON.parse(rawValue);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}

async function findInteractionLinkByText(
  options: ExecutionTerminalNativeInteractionsOptions,
  linkText: string,
  fileLinkResolutionCache: Map<
    string,
    ExecutionTerminalResolvedFileLink[] | Promise<ExecutionTerminalResolvedFileLink[]>
  >,
  updateTooltip: (tooltip: ActiveTooltipState | undefined) => void
): Promise<ILink | undefined> {
  for (
    let bufferLineNumber = options.terminal.buffer.active.viewportY + 1;
    bufferLineNumber <= options.terminal.buffer.active.length;
    bufferLineNumber += 1
  ) {
    const context = readWrappedLineContext(options.terminal, bufferLineNumber);
    if (!context) {
      continue;
    }

    const fileLink = (
      await collectFileLinks(options, context, updateTooltip, fileLinkResolutionCache)
    ).find((link) => link.text === linkText);
    if (fileLink) {
      return fileLink;
    }

    const urlLink = collectUrlLinks(options, context, updateTooltip).find((link) => link.text === linkText);
    if (urlLink) {
      return urlLink;
    }
  }

  return undefined;
}
