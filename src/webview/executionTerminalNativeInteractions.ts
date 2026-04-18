import type { IBufferLine, IBufferRange, ILink, ILinkProvider, Terminal } from '@xterm/xterm';
import LinkifyIt from 'linkify-it';

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
const REVEAL_DIRECTORY_LINK_LABEL = 'Reveal in Explorer';
const OPEN_DIRECTORY_LINK_LABEL = 'Open folder';
const URL_LINK_LABEL = 'Follow link';
const SEARCH_LINK_LABEL = 'Search workspace';
const MAX_SEARCH_LINK_LINE_LENGTH = 2000;
const MAX_SEARCH_LINK_TEXT_LENGTH = 100;
const EXECUTION_URL_LINKIFY = new LinkifyIt()
  .set({
    fuzzyLink: false,
    fuzzyEmail: false,
    fuzzyIP: false
  })
  .add('vscode:', 'http:')
  .add('vscode-insiders:', 'http:');
const EXECUTION_FILE_LEADING_TRIM_CHARS = new Set([
  '"',
  '\'',
  '`',
  '(',
  '[',
  '<',
  '：',
  '，',
  '；',
  '。',
  '！',
  '？',
  '、',
  '（',
  '【',
  '《',
  '〈',
  '「',
  '『',
  '“',
  '‘'
]);
const EXECUTION_FILE_TRAILING_PUNCTUATION_CHARS = new Set([
  '.',
  ',',
  ';',
  '!',
  '?',
  ':',
  '。',
  '，',
  '；',
  '！',
  '？',
  '：',
  '、'
]);
const EXECUTION_FILE_TRAILING_QUOTE_CHARS = new Set(['"', '\'', '`', '”', '’']);
const EXECUTION_FILE_CLOSING_WRAPPERS = new Map<string, string>([
  [')', '('],
  [']', '['],
  ['）', '（'],
  ['】', '【'],
  ['》', '《'],
  ['〉', '〈'],
  ['」', '「'],
  ['』', '『']
]);
const EXECUTION_EMBEDDED_MULTI_SEGMENT_ASCII_PATH_REGEX =
  /[A-Za-z0-9._-]+(?:[\\/][A-Za-z0-9._-]+){2,}/g;

interface XtermTerminalWithLinkProviders {
  _core?: {
    _linkProviderService?: {
      linkProviders?: ILinkProvider[];
    };
  };
}

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

  const previousLinkHandler = terminal.options.linkHandler;
  terminal.options.linkHandler = createExplicitLinkHandler(options, updateTooltip);
  const fileLinkProvider = createFileLinkProvider(options, fileLinkResolutionCache, () => tooltip, updateTooltip);
  const urlLinkProvider = createUrlLinkProvider(options, () => tooltip, updateTooltip);
  const searchLinkProvider = createSearchLinkProvider(
    options,
    fileLinkResolutionCache,
    () => tooltip,
    updateTooltip
  );
  const fileLinkDisposable = terminal.registerLinkProvider(fileLinkProvider);
  const urlLinkDisposable = terminal.registerLinkProvider(urlLinkProvider);
  const searchLinkDisposable = terminal.registerLinkProvider(searchLinkProvider);

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

      window.setTimeout(() => {
        detectedLink.activate(
          createSyntheticLinkActivationEvent(options.getRuntimeContext()),
          detectedLink.text
        );
      }, 0);
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
      terminal.options.linkHandler = previousLinkHandler;
      fileLinkDisposable.dispose();
      urlLinkDisposable.dispose();
      searchLinkDisposable.dispose();
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

function createSearchLinkProvider(
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

      void collectSearchLinks(options, context, updateTooltip, fileLinkResolutionCache)
        .then((links) => {
          callback(links.length > 0 ? links : undefined);
        })
        .catch(() => {
          callback(undefined);
        });
    }
  };
}

function createExplicitLinkHandler(
  options: ExecutionTerminalNativeInteractionsOptions,
  updateTooltip: (tooltip: ActiveTooltipState | undefined) => void
): NonNullable<Terminal['options']['linkHandler']> {
  return {
    allowNonHttpProtocols: true,
    activate: (event, text, range): void => {
      if (!shouldActivateExecutionLink(options.getRuntimeContext(), event)) {
        return;
      }

      const link = parseExplicitExecutionTerminalLink(text, range.start.y - 1);
      if (!link) {
        return;
      }

      options.onOpenLink(options.nodeId, options.kind, link);
    },
    hover: (event, text, range): void => {
      const link = parseExplicitExecutionTerminalLink(text, range.start.y - 1);
      if (!link) {
        return;
      }

      updateTooltip(
        createExecutionLinkTooltip(
          event,
          link.linkKind === 'file' ? FILE_LINK_LABEL : URL_LINK_LABEL,
          options.getRuntimeContext()
        )
      );
    },
    leave: (): void => {
      updateTooltip(undefined);
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

  const directCandidates = candidates.filter((candidate) => candidate.source !== 'fallback');
  const fallbackCandidates = candidates.filter((candidate) => candidate.source === 'fallback');
  const resolvedDirectLinks =
    directCandidates.length > 0
      ? await resolveExecutionFileLinksForContext(options, context, directCandidates, fileLinkResolutionCache)
      : [];
  if (resolvedDirectLinks.length > 0 || fallbackCandidates.length === 0) {
    return mapResolvedFileLinksToInteractions(
      options,
      context,
      directCandidates,
      resolvedDirectLinks,
      updateTooltip
    );
  }

  const resolvedFallbackLinks = await resolveExecutionFileLinksForContext(
    options,
    context,
    fallbackCandidates,
    fileLinkResolutionCache
  );
  return mapResolvedFileLinksToInteractions(
    options,
    context,
    fallbackCandidates,
    resolvedFallbackLinks,
    updateTooltip
  );
}

function collectUrlLinks(
  options: ExecutionTerminalNativeInteractionsOptions,
  context: WrappedLineContext,
  updateTooltip: (tooltip: ActiveTooltipState | undefined) => void
): ILink[] {
  if (!EXECUTION_URL_LINKIFY.pretest(context.text)) {
    return [];
  }

  const links: ILink[] = [];
  const matches = EXECUTION_URL_LINKIFY.match(context.text) ?? [];
  for (const match of matches) {
    links.push(
      createInteractionLink(
        options,
        context,
        match.text,
        URL_LINK_LABEL,
        {
          linkKind: 'url',
          text: match.text,
          url: match.url,
          source: 'implicit'
        },
        updateTooltip,
        {
          startColumn: match.index + 1,
          startLineNumber: 1,
          endColumn: match.lastIndex + 1,
          endLineNumber: 1
        }
      )
    );
  }

  return links;
}

async function collectSearchLinks(
  options: ExecutionTerminalNativeInteractionsOptions,
  context: WrappedLineContext,
  updateTooltip: (tooltip: ActiveTooltipState | undefined) => void,
  fileLinkResolutionCache: Map<
    string,
    ExecutionTerminalResolvedFileLink[] | Promise<ExecutionTerminalResolvedFileLink[]>
  >
): Promise<ILink[]> {
  if (context.text.length === 0 || context.text.length > MAX_SEARCH_LINK_LINE_LENGTH) {
    return [];
  }

  const candidates = collectSearchLinkCandidates(context);
  if (candidates.length === 0) {
    return [];
  }

  const resolvedLinks = await resolveExecutionFileLinksForContext(
    options,
    context,
    candidates,
    fileLinkResolutionCache
  );
  const resolvedCandidateIds = new Set(resolvedLinks.map((resolvedLink) => resolvedLink.candidateId));
  const candidateById = new Map(candidates.map((candidate) => [candidate.candidateId, candidate]));
  const resolvedCandidates = resolvedLinks
    .map((resolvedLink) => candidateById.get(resolvedLink.candidateId))
    .filter((candidate): candidate is ExecutionTerminalFileLinkCandidate => candidate !== undefined);
  const unresolvedCandidates = selectExecutionTerminalSearchLinkCandidates(
    candidates.filter(
      (candidate) =>
        !resolvedCandidateIds.has(candidate.candidateId) &&
        !resolvedCandidates.some((resolvedCandidate) =>
          doExecutionTerminalFileLinkCandidateRangesOverlap(candidate, resolvedCandidate)
        )
    )
  );

  const links: ILink[] = [];
  for (const candidate of unresolvedCandidates) {
    if (candidate.text.length > MAX_SEARCH_LINK_TEXT_LENGTH) {
      continue;
    }

    links.push(
      createInteractionLink(
        options,
        context,
        candidate.text,
        SEARCH_LINK_LABEL,
        {
          linkKind: 'search',
          text: candidate.text,
          searchText: candidate.text,
          contextLine: context.text,
          bufferStartLine: candidate.bufferStartLine,
          source: 'word'
        },
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

function collectSearchLinkCandidates(context: WrappedLineContext): ExecutionTerminalFileLinkCandidate[] {
  return selectExecutionTerminalSearchLinkCandidates(
    collectFileLinkCandidates(context).filter(isExecutionTerminalSearchFallbackCandidate)
  );
}

function isExecutionTerminalSearchFallbackCandidate(
  candidate: ExecutionTerminalFileLinkCandidate
): boolean {
  if (candidate.source === 'detected' || candidate.source === 'refined') {
    return true;
  }

  if (candidate.source !== 'fallback') {
    return false;
  }

  return isExecutionTerminalSearchFallbackPathLike(candidate);
}

function isExecutionTerminalSearchFallbackPathLike(
  candidate: ExecutionTerminalFileLinkCandidate
): boolean {
  if (
    candidate.line !== undefined ||
    candidate.column !== undefined ||
    candidate.lineEnd !== undefined ||
    candidate.columnEnd !== undefined
  ) {
    return true;
  }

  const pathValue = candidate.path.trim();
  if (pathValue.length === 0) {
    return false;
  }

  if (
    pathValue.includes('/') ||
    pathValue.includes('\\') ||
    pathValue.startsWith('./') ||
    pathValue.startsWith('../') ||
    pathValue.startsWith('~/') ||
    pathValue.startsWith('.\\') ||
    pathValue.startsWith('..\\') ||
    pathValue.startsWith('~\\') ||
    pathValue.startsWith('file://') ||
    /^[a-zA-Z]:[\\/]/.test(pathValue) ||
    pathValue.startsWith('\\\\')
  ) {
    return true;
  }

  return /\.[a-zA-Z0-9_-]{1,20}$/.test(pathValue);
}

function selectExecutionTerminalSearchLinkCandidates(
  candidates: ExecutionTerminalFileLinkCandidate[]
): ExecutionTerminalFileLinkCandidate[] {
  const selected: ExecutionTerminalFileLinkCandidate[] = [];
  const sortedCandidates = [...candidates].sort(compareExecutionTerminalSearchLinkCandidates);
  for (const candidate of sortedCandidates) {
    if (
      selected.some((selectedCandidate) =>
        doExecutionTerminalFileLinkCandidateRangesOverlap(candidate, selectedCandidate)
      )
    ) {
      continue;
    }

    selected.push(candidate);
  }

  return selected.sort(
    (left, right) =>
      left.startIndex - right.startIndex || left.endIndexExclusive - right.endIndexExclusive
  );
}

function compareExecutionTerminalSearchLinkCandidates(
  left: ExecutionTerminalFileLinkCandidate,
  right: ExecutionTerminalFileLinkCandidate
): number {
  const priorityDifference =
    getExecutionTerminalSearchLinkCandidatePriority(right) -
    getExecutionTerminalSearchLinkCandidatePriority(left);
  if (priorityDifference !== 0) {
    return priorityDifference;
  }

  const leftLength = left.endIndexExclusive - left.startIndex;
  const rightLength = right.endIndexExclusive - right.startIndex;
  if (leftLength !== rightLength) {
    return leftLength - rightLength;
  }

  return left.startIndex - right.startIndex || left.endIndexExclusive - right.endIndexExclusive;
}

function getExecutionTerminalSearchLinkCandidatePriority(
  candidate: ExecutionTerminalFileLinkCandidate
): number {
  switch (candidate.source) {
    case 'refined':
      return 3;
    case 'detected':
      return 2;
    case 'fallback':
      return 1;
    default:
      return 0;
  }
}

function doExecutionTerminalFileLinkCandidateRangesOverlap(
  left: Pick<ExecutionTerminalFileLinkCandidate, 'startIndex' | 'endIndexExclusive'>,
  right: Pick<ExecutionTerminalFileLinkCandidate, 'startIndex' | 'endIndexExclusive'>
): boolean {
  return left.startIndex < right.endIndexExclusive && right.startIndex < left.endIndexExclusive;
}

function collectFileLinkCandidates(context: WrappedLineContext): ExecutionTerminalFileLinkCandidate[] {
  const detectedCandidates = dedupeDetectedPathLinks([
    ...detectExecutionTerminalPathLinks(context.text, 'posix'),
    ...detectExecutionTerminalPathLinks(context.text, 'windows')
  ]).filter((candidate) => !isNonFileUriLikePath(candidate.path));

  const candidates: ExecutionTerminalFileLinkCandidate[] = [];
  for (const candidate of detectedCandidates) {
    candidates.push(toExecutionTerminalFileLinkCandidate(context, candidate, 'detected'));
    const refinedCandidate = refineDetectedPathLinkCandidate(candidate);
    if (refinedCandidate) {
      candidates.push(toExecutionTerminalFileLinkCandidate(context, refinedCandidate, 'refined'));
    }
  }

  const fallback = detectExecutionTerminalFallbackPathLink(context.text);
  if (fallback && !isNonFileUriLikePath(fallback.path)) {
    candidates.push(toExecutionTerminalFileLinkCandidate(context, fallback, 'fallback'));
  }

  return dedupeExecutionTerminalFileLinkCandidates(candidates);
}

function toExecutionTerminalFileLinkCandidate(
  context: WrappedLineContext,
  candidate: DetectedExecutionTerminalPathLink,
  source: ExecutionTerminalFileLinkCandidate['source']
): ExecutionTerminalFileLinkCandidate {
  return {
    candidateId: createExecutionTerminalFileLinkCandidateId(context, candidate, source),
    text: candidate.text,
    path: candidate.path,
    startIndex: candidate.startIndex,
    endIndexExclusive: candidate.endIndexExclusive,
    bufferStartLine: context.startLine,
    line: candidate.line,
    column: candidate.column,
    lineEnd: candidate.lineEnd,
    columnEnd: candidate.columnEnd,
    source
  };
}

function createExecutionTerminalFileLinkCandidateId(
  context: WrappedLineContext,
  candidate: DetectedExecutionTerminalPathLink,
  source: ExecutionTerminalFileLinkCandidate['source']
): string {
  return `${context.startLine}:${candidate.startIndex}:${candidate.endIndexExclusive}:${source}:${candidate.text}`;
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
  const cacheKey = `${context.startLine}:${context.endLine}:${context.text}:${candidates
    .map((candidate) => candidate.candidateId)
    .join('|')}`;
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
        labelForResolvedFileLink(resolvedLink.link.targetKind),
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

function labelForResolvedFileLink(
  targetKind: ExecutionTerminalResolvedFileLink['link']['targetKind']
): string {
  if (targetKind === 'directory-in-workspace') {
    return REVEAL_DIRECTORY_LINK_LABEL;
  }

  if (targetKind === 'directory-outside-workspace') {
    return OPEN_DIRECTORY_LINK_LABEL;
  }

  return FILE_LINK_LABEL;
}

function parseExplicitExecutionTerminalLink(
  text: string,
  bufferStartLine: number
): ExecutionTerminalOpenLink | undefined {
  try {
    const uri = new URL(text);
    if (uri.protocol === 'file:') {
      return {
        linkKind: 'file',
        text,
        path: uri.toString(),
        bufferStartLine,
        source: 'explicit-uri'
      };
    }

    return {
      linkKind: 'url',
      text,
      url: uri.toString(),
      source: 'explicit'
    };
  } catch {
    return undefined;
  }
}

function refineDetectedPathLinkCandidate(
  candidate: DetectedExecutionTerminalPathLink
): DetectedExecutionTerminalPathLink | undefined {
  let startIndex = candidate.startIndex;
  let endIndexExclusive = candidate.endIndexExclusive;
  let text = candidate.text;
  let path = candidate.path;
  let changed = false;

  while (text.length > 0 && shouldTrimLeadingExecutionFileChar(text[0])) {
    const leadingChar = text[0];
    text = text.slice(1);
    startIndex += 1;
    if (path.startsWith(leadingChar)) {
      path = path.slice(1);
    }
    changed = true;
  }

  const embeddedPathOffset = findEmbeddedExecutionPathOffset(path);
  if (embeddedPathOffset > 0) {
    text = text.slice(embeddedPathOffset);
    path = path.slice(embeddedPathOffset);
    startIndex += embeddedPathOffset;
    changed = true;
  }

  while (text.length > 0 && shouldTrimTrailingExecutionFileChar(path, text[text.length - 1])) {
    const trailingChar = text[text.length - 1];
    text = text.slice(0, -1);
    endIndexExclusive -= 1;
    if (path.endsWith(trailingChar)) {
      path = path.slice(0, -1);
    }
    changed = true;
  }

  if (!changed || text.trim().length === 0 || path.trim().length === 0) {
    return undefined;
  }

  return {
    ...candidate,
    text,
    path,
    startIndex,
    endIndexExclusive
  };
}

function findEmbeddedExecutionPathOffset(pathValue: string): number {
  EXECUTION_EMBEDDED_MULTI_SEGMENT_ASCII_PATH_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = EXECUTION_EMBEDDED_MULTI_SEGMENT_ASCII_PATH_REGEX.exec(pathValue)) !== null) {
    if (match.index <= 0) {
      continue;
    }

    const directPrefix = pathValue.slice(0, match.index);
    if (isLikelyAttachedExecutionProsePrefix(directPrefix)) {
      return match.index;
    }
  }

  return 0;
}

function isLikelyAttachedExecutionProsePrefix(prefix: string): boolean {
  if (prefix.length === 0 || prefix.includes('/') || prefix.includes('\\')) {
    return false;
  }

  return /[^\x00-\x7F]/u.test(prefix) && !/[A-Za-z0-9]/.test(prefix);
}

function shouldTrimLeadingExecutionFileChar(value: string): boolean {
  return EXECUTION_FILE_LEADING_TRIM_CHARS.has(value);
}

function shouldTrimTrailingExecutionFileChar(pathValue: string, value: string): boolean {
  if (
    EXECUTION_FILE_TRAILING_PUNCTUATION_CHARS.has(value) ||
    EXECUTION_FILE_TRAILING_QUOTE_CHARS.has(value)
  ) {
    return true;
  }

  const openingWrapper = EXECUTION_FILE_CLOSING_WRAPPERS.get(value);
  if (openingWrapper) {
    if (!pathValue.endsWith(value)) {
      return true;
    }
    return countExecutionFileChar(pathValue, openingWrapper) < countExecutionFileChar(pathValue, value);
  }

  return false;
}

function countExecutionFileChar(value: string, char: string): number {
  let count = 0;
  for (const currentChar of value) {
    if (currentChar === char) {
      count += 1;
    }
  }

  return count;
}

function isNonFileUriLikePath(pathValue: string): boolean {
  if (pathValue.startsWith('file://')) {
    return false;
  }

  if (/^[a-zA-Z]:[\\/]/.test(pathValue) || pathValue.startsWith('\\\\')) {
    return false;
  }

  return /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(pathValue);
}

function dedupeExecutionTerminalFileLinkCandidates(
  candidates: ExecutionTerminalFileLinkCandidate[]
): ExecutionTerminalFileLinkCandidate[] {
  const seen = new Set<string>();
  const deduped: ExecutionTerminalFileLinkCandidate[] = [];
  for (const candidate of candidates) {
    const key = [
      candidate.startIndex,
      candidate.endIndexExclusive,
      candidate.bufferStartLine,
      candidate.source,
      candidate.path,
      candidate.line,
      candidate.column,
      candidate.lineEnd,
      candidate.columnEnd
    ].join(':');
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(candidate);
  }

  return deduped;
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
    const linkProviders = readExecutionTerminalLinkProviders(options.terminal);
    for (const linkProvider of linkProviders) {
      const links = await new Promise<ILink[] | undefined>((resolve) => {
        linkProvider.provideLinks(bufferLineNumber, resolve);
      });
      const matchingLink = links?.find((link) => link.text === linkText);
      if (matchingLink) {
        return matchingLink;
      }
    }
  }

  return undefined;
}

function readExecutionTerminalLinkProviders(terminal: Terminal): ILinkProvider[] {
  const internalTerminal = terminal as unknown as XtermTerminalWithLinkProviders;
  return internalTerminal._core?._linkProviderService?.linkProviders ?? [];
}
