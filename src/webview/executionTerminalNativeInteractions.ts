import type { IBufferLine, IBufferRange, ILink, ILinkDecorations, ILinkProvider, Terminal } from '@xterm/xterm';
import LinkifyIt from 'linkify-it';

import type { CanvasRuntimeContext, ExecutionNodeKind } from '../common/protocol';
import {
  detectExecutionTerminalFallbackPathLink,
  detectExecutionTerminalPathLinks,
  type DetectedExecutionTerminalPathLink,
  type ExecutionTerminalFileLinkCandidate,
  type ExecutionTerminalDroppedResource,
  type ExecutionTerminalOpenLink,
  type ExecutionTerminalPathStyle,
  type ExecutionTerminalResolvedFileLink
} from '../common/executionTerminalLinks';

interface ExecutionTerminalNativeInteractionsOptions {
  nodeId: string;
  kind: ExecutionNodeKind;
  terminal: Terminal;
  dropTarget: HTMLElement;
  getRuntimeContext: () => CanvasRuntimeContext;
  getPathStyle: () => ExecutionTerminalPathStyle;
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

interface StyledFileLinkCandidate {
  candidate: ExecutionTerminalFileLinkCandidate;
  bufferRange: IBufferRange;
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

interface TooltipController {
  show: (event: MouseEvent, label: string) => void;
  hide: () => void;
}

const RESOURCE_URLS_DATA_TRANSFER = 'ResourceURLs';
const CODE_FILES_DATA_TRANSFER = 'CodeFiles';
const URI_LIST_DATA_TRANSFER = 'text/uri-list';
const EXECUTION_LINK_TOOLTIP_CLASS = 'execution-link-tooltip';
const EXECUTION_LINK_TOOLTIP_VISIBLE_CLASS = 'is-visible';
const DEFAULT_WORKBENCH_HOVER_DELAY = 500;
const EXECUTION_MAX_LINE_LENGTH = 2000;
const EXECUTION_MAX_RESOLVED_LINK_LENGTH = 1024;
const EXECUTION_MAX_RESOLVED_LINKS_PER_LINE = 10;
const EXECUTION_MULTILINE_LINK_MAX_LENGTH = 500;
const EXECUTION_LOCAL_LINK_MAX_LENGTH = 500;
const EXECUTION_URI_LINK_MAX_LENGTH = 2048;
const EXECUTION_WORD_LINK_MAX_LENGTH = 100;
const FILE_LINK_LABEL = 'Open file in editor';
const FOCUS_DIRECTORY_LINK_LABEL = 'Focus folder in explorer';
const OPEN_DIRECTORY_LINK_LABEL = 'Open folder in new window';
const URL_LINK_LABEL = 'Follow link';
const EXECUTION_URL_LINKIFY = new LinkifyIt()
  .set({
    fuzzyLink: false,
    fuzzyEmail: false,
    fuzzyIP: false
  })
  .add('vscode:', 'http:')
  .add('vscode-insiders:', 'http:');
const EXECUTION_MULTILINE_LINE_NUMBER_PREFIX_MATCHERS: RegExp[] = [
  /^ *(?<link>(?<line>\d+):(?<col>\d+)?)/
];
const EXECUTION_MULTILINE_GIT_DIFF_MATCHERS: RegExp[] = [
  /^(?<link>@@ .+ \+(?<toFileLine>\d+),(?<toFileCount>\d+) @@)/
];

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
  invalidateLinkResolutionCache(): void;
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
  let tooltipTimer: number | undefined;

  const clearDropTarget = (): void => {
    dropTarget.classList.remove('is-drop-target');
  };

  const setDropTarget = (): void => {
    dropTarget.classList.add('is-drop-target');
  };

  const clearTooltipTimer = (): void => {
    if (tooltipTimer !== undefined) {
      window.clearTimeout(tooltipTimer);
      tooltipTimer = undefined;
    }
  };

  const hideTooltip = (): void => {
    clearTooltipTimer();
    tooltip?.dispose();
    tooltip = undefined;
  };

  const tooltipController: TooltipController = {
    show: (event, label): void => {
      hideTooltip();
      tooltipTimer = window.setTimeout(() => {
        tooltipTimer = undefined;
        tooltip = createExecutionLinkTooltip(event, label, options.getRuntimeContext());
      }, getExecutionTerminalHoverDelay());
    },
    hide: (): void => {
      hideTooltip();
    }
  };

  const clearHoveredLink = (): void => {
    hoveredLink = undefined;
    dispatchSyntheticLinkMouseLeaveEvent(terminal);
    hideTooltip();
  };

  const previousLinkHandler = terminal.options.linkHandler;
  terminal.options.linkHandler = createExplicitLinkHandler(options, tooltipController);
  const multilineLinkProvider = createMultilineLinkProvider(options, fileLinkResolutionCache, tooltipController);
  const fileLinkProvider = createFileLinkProvider(options, fileLinkResolutionCache, tooltipController);
  const urlLinkProvider = createUrlLinkProvider(options, tooltipController);
  const wordLinkProvider = createWordLinkProvider(options, tooltipController);
  const multilineLinkDisposable = terminal.registerLinkProvider(multilineLinkProvider);
  const fileLinkDisposable = terminal.registerLinkProvider(fileLinkProvider);
  const urlLinkDisposable = terminal.registerLinkProvider(urlLinkProvider);
  const wordLinkDisposable = terminal.registerLinkProvider(wordLinkProvider);

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
        tooltipController
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
      const detectedLink = await findInteractionLinkByText(
        options,
        linkText,
        fileLinkResolutionCache,
        tooltipController
      );
      if (!detectedLink) {
        throw new Error(`Execution link "${linkText}" was not detected.`);
      }

      if (!detectedLink.hover) {
        throw new Error(`Execution link "${linkText}" does not support hover interactions.`);
      }

      if (hoveredLink && hoveredLink.text !== detectedLink.text) {
        clearHoveredLink();
      }

      dispatchSyntheticLinkHoverEvent(terminal, detectedLink);
      hoveredLink = detectedLink;
    },
    clearHoverForTest(): void {
      clearHoveredLink();
    },
    invalidateLinkResolutionCache(): void {
      fileLinkResolutionCache.clear();
      clearHoveredLink();
    },
    dispose(): void {
      clearHoveredLink();
      clearDropTarget();
      terminal.options.linkHandler = previousLinkHandler;
      multilineLinkDisposable.dispose();
      fileLinkDisposable.dispose();
      urlLinkDisposable.dispose();
      wordLinkDisposable.dispose();
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
  tooltipController: TooltipController
): ILinkProvider {
  return {
    provideLinks(bufferLineNumber, callback): void {
      const context = readWrappedLineContext(
        options.terminal,
        bufferLineNumber,
        EXECUTION_LOCAL_LINK_MAX_LENGTH
      );
      if (!context) {
        callback(undefined);
        return;
      }

      void collectFileLinks(options, context, tooltipController, fileLinkResolutionCache)
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
  tooltipController: TooltipController
): ILinkProvider {
  return {
    provideLinks(bufferLineNumber, callback): void {
      const context = readWrappedLineContext(options.terminal, bufferLineNumber, EXECUTION_URI_LINK_MAX_LENGTH);
      if (!context) {
        callback(undefined);
        return;
      }

      const links = collectUrlLinks(options, context, tooltipController);
      callback(links.length > 0 ? links : undefined);
    }
  };
}

function createMultilineLinkProvider(
  options: ExecutionTerminalNativeInteractionsOptions,
  fileLinkResolutionCache: Map<
    string,
    ExecutionTerminalResolvedFileLink[] | Promise<ExecutionTerminalResolvedFileLink[]>
  >,
  tooltipController: TooltipController
): ILinkProvider {
  return {
    provideLinks(bufferLineNumber, callback): void {
      const context = readWrappedLineContext(
        options.terminal,
        bufferLineNumber,
        EXECUTION_MULTILINE_LINK_MAX_LENGTH
      );
      if (!context) {
        callback(undefined);
        return;
      }

      void collectMultilineLinks(options, context, tooltipController, fileLinkResolutionCache)
        .then((links) => {
          callback(links.length > 0 ? links : undefined);
        })
        .catch(() => {
          callback(undefined);
        });
    }
  };
}

function createWordLinkProvider(
  options: ExecutionTerminalNativeInteractionsOptions,
  tooltipController: TooltipController
): ILinkProvider {
  return {
    provideLinks(bufferLineNumber, callback): void {
      const context = readWrappedLineContext(options.terminal, bufferLineNumber, EXECUTION_WORD_LINK_MAX_LENGTH);
      if (!context) {
        callback(undefined);
        return;
      }

      const links = collectWordLinks(options, context, tooltipController);
      callback(links.length > 0 ? links : undefined);
    }
  };
}

function createExplicitLinkHandler(
  options: ExecutionTerminalNativeInteractionsOptions,
  tooltipController: TooltipController
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

      tooltipController.show(event, link.linkKind === 'file' ? FILE_LINK_LABEL : URL_LINK_LABEL);
    },
    leave: (): void => {
      tooltipController.hide();
    }
  };
}

async function collectFileLinks(
  options: ExecutionTerminalNativeInteractionsOptions,
  context: WrappedLineContext,
  tooltipController: TooltipController,
  fileLinkResolutionCache: Map<
    string,
    ExecutionTerminalResolvedFileLink[] | Promise<ExecutionTerminalResolvedFileLink[]>
  >
): Promise<ILink[]> {
  const candidates = collectFileLinkCandidates(context, options.getPathStyle());
  if (candidates.length === 0) {
    return collectStyledFileLinks(options, context, tooltipController, fileLinkResolutionCache);
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
      tooltipController
    );
  }

  const resolvedFallbackLinks = await resolveExecutionFileLinksForContext(
    options,
    context,
    fallbackCandidates,
    fileLinkResolutionCache
  );
  if (resolvedFallbackLinks.length > 0) {
    return mapResolvedFileLinksToInteractions(
      options,
      context,
      fallbackCandidates,
      resolvedFallbackLinks,
      tooltipController
    );
  }

  return collectStyledFileLinks(options, context, tooltipController, fileLinkResolutionCache);
}

async function collectMultilineLinks(
  options: ExecutionTerminalNativeInteractionsOptions,
  context: WrappedLineContext,
  tooltipController: TooltipController,
  fileLinkResolutionCache: Map<
    string,
    ExecutionTerminalResolvedFileLink[] | Promise<ExecutionTerminalResolvedFileLink[]>
  >
): Promise<ILink[]> {
  const candidates = collectMultilineFileLinkCandidates(options.terminal, context);
  if (candidates.length === 0) {
    return [];
  }

  const resolvedLinks = await resolveExecutionFileLinksForContext(
    options,
    context,
    candidates,
    fileLinkResolutionCache
  );
  return mapResolvedFileLinksToInteractions(
    options,
    context,
    candidates,
    resolvedLinks,
    tooltipController
  );
}

function collectMultilineFileLinkCandidates(
  terminal: Terminal,
  context: WrappedLineContext
): ExecutionTerminalFileLinkCandidate[] {
  if (context.text.length === 0 || context.text.length > EXECUTION_MAX_LINE_LENGTH) {
    return [];
  }

  for (const matcher of EXECUTION_MULTILINE_LINE_NUMBER_PREFIX_MATCHERS) {
    const match = context.text.match(matcher);
    const group = match?.groups;
    if (!group?.link || !group.line) {
      continue;
    }

    const path = findPreviousMultilinePath(terminal, context.startLine);
    if (!path) {
      continue;
    }

    const startIndex = context.text.indexOf(group.link);
    if (startIndex < 0) {
      continue;
    }

    return [
      {
        candidateId: `${context.startLine}:0:${context.text.length}:multiline:${group.link}`,
        text: group.link,
        path,
        startIndex: 0,
        endIndexExclusive: context.text.length,
        bufferStartLine: context.startLine,
        line: parseExecutionTerminalInt(group.line),
        column: parseExecutionTerminalInt(group.col),
        lineEnd: undefined,
        columnEnd: undefined,
        source: 'detected'
      }
    ];
  }

  for (const matcher of EXECUTION_MULTILINE_GIT_DIFF_MATCHERS) {
    const match = context.text.match(matcher);
    const group = match?.groups;
    if (!group?.link || !group.toFileLine) {
      continue;
    }

    const path = findPreviousGitDiffPath(terminal, context.startLine);
    if (!path) {
      continue;
    }

    const startIndex = context.text.indexOf(group.link);
    if (startIndex < 0) {
      continue;
    }

    const startLine = parseExecutionTerminalInt(group.toFileLine);
    const lineCount = parseExecutionTerminalInt(group.toFileCount);
    return [
      {
        candidateId: `${context.startLine}:${startIndex}:${group.link.length}:gitdiff:${group.link}`,
        text: group.link,
        path,
        startIndex,
        endIndexExclusive: startIndex + group.link.length,
        bufferStartLine: context.startLine,
        line: startLine,
        column: 1,
        lineEnd:
          startLine !== undefined && lineCount !== undefined ? startLine + Math.max(0, lineCount) : undefined,
        columnEnd: undefined,
        source: 'detected'
      }
    ];
  }

  return [];
}

function collectUrlLinks(
  options: ExecutionTerminalNativeInteractionsOptions,
  context: WrappedLineContext,
  tooltipController: TooltipController
): ILink[] {
  if (!EXECUTION_URL_LINKIFY.pretest(context.text)) {
    return [];
  }

  const links: ILink[] = [];
  const matches = EXECUTION_URL_LINKIFY.match(context.text) ?? [];
  for (const match of matches) {
    if (match.text.length > EXECUTION_URI_LINK_MAX_LENGTH) {
      continue;
    }
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
        tooltipController,
        {
          startColumn: match.index + 1,
          startLineNumber: 1,
          endColumn: match.lastIndex + 1,
          endLineNumber: 1
        }
      )
    );
    if (links.length >= EXECUTION_MAX_RESOLVED_LINKS_PER_LINE) {
      break;
    }
  }

  return links;
}

function collectWordLinks(
  options: ExecutionTerminalNativeInteractionsOptions,
  context: WrappedLineContext,
  tooltipController: TooltipController
): ILink[] {
  if (context.text.length === 0 || context.text.length > EXECUTION_MAX_LINE_LENGTH) {
    return [];
  }

  const links: ILink[] = [];
  for (const range of readExecutionTerminalWordRanges(context.text, options.getRuntimeContext())) {
    if (range.text.length === 0 || range.text.length > EXECUTION_WORD_LINK_MAX_LENGTH) {
      continue;
    }

    links.push(
      createInteractionLink(
        options,
        context,
        range.text,
        undefined,
        {
          linkKind: 'search',
          text: range.text,
          searchText: range.text,
          contextLine: context.text,
          bufferStartLine: context.startLine,
          source: 'word'
        },
        tooltipController,
        {
          startColumn: range.startIndex + 1,
          startLineNumber: 1,
          endColumn: range.endIndexExclusive + 1,
          endLineNumber: 1
        },
        {
          lowConfidence: true
        }
      )
    );
    if (links.length >= EXECUTION_MAX_RESOLVED_LINKS_PER_LINE) {
      break;
    }
  }

  return links;
}

function readExecutionTerminalWordRanges(
  text: string,
  runtimeContext: CanvasRuntimeContext
): Array<{ text: string; startIndex: number; endIndexExclusive: number }> {
  const separatorRegex = createExecutionTerminalWordSeparatorRegex(runtimeContext.terminalWordSeparators);
  const splitWords = text.split(separatorRegex);
  const ranges: Array<{ text: string; startIndex: number; endIndexExclusive: number }> = [];
  let runningIndex = 0;
  for (const splitWord of splitWords) {
    let nextText = splitWord;
    let endIndexExclusive = runningIndex + splitWord.length;
    if (nextText.length > 0 && nextText.endsWith(':')) {
      nextText = nextText.slice(0, -1);
      endIndexExclusive -= 1;
    }
    ranges.push({
      text: nextText,
      startIndex: runningIndex,
      endIndexExclusive
    });
    runningIndex += splitWord.length + 1;
  }
  return ranges;
}

function createExecutionTerminalWordSeparatorRegex(wordSeparators: string): RegExp {
  let powerlineSymbols = '';
  for (let codePoint = 0xe0b0; codePoint <= 0xe0bf; codePoint += 1) {
    powerlineSymbols += String.fromCharCode(codePoint);
  }
  return new RegExp(
    `[${escapeExecutionTerminalWordSeparatorCharacters(wordSeparators)}${powerlineSymbols}]`,
    'g'
  );
}

function escapeExecutionTerminalWordSeparatorCharacters(value: string): string {
  return value.replace(/[|\\{}()[\]^$+*?.-]/g, '\\$&');
}

function collectFileLinkCandidates(
  context: WrappedLineContext,
  pathStyle: ExecutionTerminalPathStyle
): ExecutionTerminalFileLinkCandidate[] {
  const detectedCandidates = dedupeDetectedPathLinks(
    detectExecutionTerminalPathLinks(context.text, pathStyle)
  )
    .filter(
      (candidate) =>
        !isNonFileUriLikePath(candidate.path) &&
        candidate.path.length <= EXECUTION_MAX_RESOLVED_LINK_LENGTH
    );

  const candidates: ExecutionTerminalFileLinkCandidate[] = [];
  for (const candidate of detectedCandidates) {
    candidates.push(toExecutionTerminalFileLinkCandidate(context, candidate, 'detected'));
  }

  const fallback = detectExecutionTerminalFallbackPathLink(context.text);
  if (
    fallback &&
    !isNonFileUriLikePath(fallback.path) &&
    fallback.path.length <= EXECUTION_MAX_RESOLVED_LINK_LENGTH
  ) {
    candidates.push(toExecutionTerminalFileLinkCandidate(context, fallback, 'fallback'));
  }

  return dedupeExecutionTerminalFileLinkCandidates(candidates).slice(0, EXECUTION_MAX_RESOLVED_LINKS_PER_LINE);
}

async function collectStyledFileLinks(
  options: ExecutionTerminalNativeInteractionsOptions,
  context: WrappedLineContext,
  tooltipController: TooltipController,
  fileLinkResolutionCache: Map<
    string,
    ExecutionTerminalResolvedFileLink[] | Promise<ExecutionTerminalResolvedFileLink[]>
  >
): Promise<ILink[]> {
  const styledCandidates = collectStyledFileLinkCandidates(options.terminal, context);
  if (styledCandidates.length === 0) {
    return [];
  }

  const resolvedLinks = await resolveExecutionFileLinksForContext(
    options,
    context,
    styledCandidates.map((entry) => entry.candidate),
    fileLinkResolutionCache
  );
  return mapResolvedStyledFileLinksToInteractions(
    options,
    styledCandidates,
    resolvedLinks,
    tooltipController
  );
}

function collectStyledFileLinkCandidates(
  terminal: Terminal,
  context: WrappedLineContext
): StyledFileLinkCandidate[] {
  const ranges = readXtermRangesByAttr(terminal, context.startLine, context.endLine);
  const candidates: StyledFileLinkCandidate[] = [];
  for (const range of ranges) {
    let text = '';
    for (let lineIndex = range.start.y - 1; lineIndex <= range.end.y - 1; lineIndex += 1) {
      const line = terminal.buffer.active.getLine(lineIndex);
      if (!line) {
        break;
      }

      const lineStartX = lineIndex === range.start.y - 1 ? range.start.x - 1 : 0;
      const lineEndX = lineIndex === range.end.y - 1 ? range.end.x : terminal.cols - 1;
      text += line.translateToString(false, lineStartX, lineEndX);
    }

    if (
      text.trim().length === 0 ||
      text.length > EXECUTION_MAX_RESOLVED_LINK_LENGTH ||
      isNonFileUriLikePath(text)
    ) {
      continue;
    }

    candidates.push({
      candidate: {
        candidateId: `styled:${range.start.y}:${range.start.x}:${range.end.y}:${range.end.x}:${text}`,
        text,
        path: text,
        startIndex: 0,
        endIndexExclusive: text.length,
        bufferStartLine: context.startLine,
        line: undefined,
        column: undefined,
        lineEnd: undefined,
        columnEnd: undefined,
        source: 'detected'
      },
      bufferRange: range
    });

    if (candidates.length >= EXECUTION_MAX_RESOLVED_LINKS_PER_LINE) {
      break;
    }
  }

  return candidates;
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
  const cacheKey = createExecutionFileLinkResolutionCacheKey(context, candidates);
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

function createExecutionFileLinkResolutionCacheKey(
  context: WrappedLineContext,
  candidates: ExecutionTerminalFileLinkCandidate[]
): string {
  return `${context.startLine}:${context.endLine}:${context.text}:${candidates
    .map((candidate) =>
      [
        candidate.candidateId,
        candidate.text,
        candidate.path,
        candidate.startIndex,
        candidate.endIndexExclusive,
        candidate.bufferStartLine,
        candidate.line ?? '',
        candidate.column ?? '',
        candidate.lineEnd ?? '',
        candidate.columnEnd ?? '',
        candidate.source
      ].join(':')
    )
    .join('|')}`;
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
  tooltipController: TooltipController
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
        tooltipController,
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

function mapResolvedStyledFileLinksToInteractions(
  options: ExecutionTerminalNativeInteractionsOptions,
  candidates: StyledFileLinkCandidate[],
  resolvedLinks: ExecutionTerminalResolvedFileLink[],
  tooltipController: TooltipController
): ILink[] {
  const candidatesById = new Map(candidates.map((candidate) => [candidate.candidate.candidateId, candidate]));
  const links: ILink[] = [];
  for (const resolvedLink of resolvedLinks) {
    const candidate = candidatesById.get(resolvedLink.candidateId);
    if (!candidate) {
      continue;
    }

    links.push(
      createBufferRangeInteractionLink(
        options,
        resolvedLink.link.text,
        labelForResolvedFileLink(resolvedLink.link.targetKind),
        resolvedLink.link,
        tooltipController,
        candidate.bufferRange
      )
    );
  }

  return links;
}

function labelForResolvedFileLink(
  targetKind: ExecutionTerminalResolvedFileLink['link']['targetKind']
): string {
  if (targetKind === 'directory-in-workspace') {
    return FOCUS_DIRECTORY_LINK_LABEL;
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

function findPreviousMultilinePath(terminal: Terminal, startLine: number): string | undefined {
  for (let lineIndex = startLine - 1; lineIndex >= 0; lineIndex -= 1) {
    const line = terminal.buffer.active.getLine(lineIndex);
    if (!line || line.isWrapped) {
      continue;
    }
    const text = getXtermLineContent(terminal, lineIndex, lineIndex);
    if (!text.match(/^\s*\d/)) {
      return text.length > 0 ? text : undefined;
    }
  }
  return undefined;
}

function findPreviousGitDiffPath(terminal: Terminal, startLine: number): string | undefined {
  for (let lineIndex = startLine - 1; lineIndex >= 0; lineIndex -= 1) {
    const line = terminal.buffer.active.getLine(lineIndex);
    if (!line || line.isWrapped) {
      continue;
    }
    const text = getXtermLineContent(terminal, lineIndex, lineIndex);
    const match = text.match(/\+\+\+ b\/(?<path>.+)/);
    const path = match?.groups?.path?.trim();
    if (path) {
      return path;
    }
  }
  return undefined;
}

function parseExecutionTerminalInt(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
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
  hoverLabel: string | undefined,
  link: ExecutionTerminalOpenLink,
  tooltipController: TooltipController,
  range: SimpleRange,
  linkOptions?: {
    lowConfidence?: boolean;
  }
): ILink {
  const xtermRange = convertLinkRangeToBuffer(context.lines, options.terminal.cols, range, context.startLine);
  return createBufferRangeInteractionLink(
    options,
    text,
    hoverLabel,
    link,
    tooltipController,
    xtermRange,
    linkOptions
  );
}

function createBufferRangeInteractionLink(
  options: ExecutionTerminalNativeInteractionsOptions,
  text: string,
  hoverLabel: string | undefined,
  link: ExecutionTerminalOpenLink,
  tooltipController: TooltipController,
  xtermRange: IBufferRange,
  linkOptions?: {
    lowConfidence?: boolean;
  }
): ILink {
  const lowConfidence = linkOptions?.lowConfidence === true;
  let interactionLink: ILink | undefined;
  const lowConfidenceDecorations = lowConfidence
    ? createLowConfidenceExecutionLinkDecorations(options.getRuntimeContext, () => interactionLink?.decorations)
    : undefined;
  interactionLink = {
    text,
    range: xtermRange,
    decorations: lowConfidenceDecorations?.decorations,
    activate: (event): void => {
      if (!shouldActivateExecutionLink(options.getRuntimeContext(), event)) {
        return;
      }

      options.onOpenLink(options.nodeId, options.kind, link);
    },
    hover: (event): void => {
      lowConfidenceDecorations?.hover(event);
      if (!lowConfidence && hoverLabel) {
        tooltipController.show(event, hoverLabel);
        return;
      }

      tooltipController.hide();
    },
    leave: (): void => {
      lowConfidenceDecorations?.leave();
      tooltipController.hide();
    }
  };
  return interactionLink;
}

function createLowConfidenceExecutionLinkDecorations(
  getRuntimeContext: () => CanvasRuntimeContext,
  getDecorations: () => ILinkDecorations | undefined
): {
  decorations: ILinkDecorations;
  hover: (event: MouseEvent) => void;
  leave: () => void;
} {
  const decorations: ILinkDecorations = {
    pointerCursor: false,
    underline: false
  };
  let removeListeners: (() => void) | undefined;
  let hoverSequence = 0;

  const applyModifierState = (modifierDown: boolean): void => {
    const activeDecorations = getDecorations() ?? decorations;
    if (activeDecorations.pointerCursor !== modifierDown) {
      activeDecorations.pointerCursor = modifierDown;
    }
    if (activeDecorations.underline !== modifierDown) {
      activeDecorations.underline = modifierDown;
    }
  };

  const clearListeners = (): void => {
    removeListeners?.();
    removeListeners = undefined;
  };

  return {
    decorations,
    hover: (event): void => {
      clearListeners();
      hoverSequence += 1;
      const currentHoverSequence = hoverSequence;

      const eventDocument = event.view?.document ?? document;
      const handleKeydown = (nextEvent: KeyboardEvent): void => {
        applyModifierState(isExecutionLinkModifierDown(getRuntimeContext(), nextEvent));
      };
      const handleKeyup = (nextEvent: KeyboardEvent): void => {
        applyModifierState(isExecutionLinkModifierDown(getRuntimeContext(), nextEvent));
      };
      const handleMousemove = (nextEvent: MouseEvent): void => {
        applyModifierState(isExecutionLinkModifierDown(getRuntimeContext(), nextEvent));
      };

      eventDocument.addEventListener('keydown', handleKeydown);
      eventDocument.addEventListener('keyup', handleKeyup);
      eventDocument.addEventListener('mousemove', handleMousemove);
      removeListeners = (): void => {
        eventDocument.removeEventListener('keydown', handleKeydown);
        eventDocument.removeEventListener('keyup', handleKeyup);
        eventDocument.removeEventListener('mousemove', handleMousemove);
      };

      const modifierDown = isExecutionLinkModifierDown(getRuntimeContext(), event);
      applyModifierState(modifierDown);
      void Promise.resolve().then(() => {
        if (hoverSequence !== currentHoverSequence) {
          return;
        }

        applyModifierState(modifierDown);
      });
    },
    leave: (): void => {
      hoverSequence += 1;
      clearListeners();
      applyModifierState(false);
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

function getExecutionTerminalHoverDelay(): number {
  return DEFAULT_WORKBENCH_HOVER_DELAY;
}

function describeExecutionLinkModifier(runtimeContext: CanvasRuntimeContext): string {
  if (runtimeContext.editorMultiCursorModifier === 'ctrlCmd') {
    return isMacintosh() ? 'option + click' : 'alt + click';
  }

  return isMacintosh() ? 'cmd + click' : 'ctrl + click';
}

function isExecutionLinkModifierDown(
  runtimeContext: CanvasRuntimeContext,
  event: MouseEvent | KeyboardEvent
): boolean {
  if (runtimeContext.editorMultiCursorModifier === 'ctrlCmd') {
    return event.altKey;
  }

  return isMacintosh() ? event.metaKey : event.ctrlKey;
}

function shouldActivateExecutionLink(
  runtimeContext: CanvasRuntimeContext,
  event: MouseEvent
): boolean {
  return isExecutionLinkModifierDown(runtimeContext, event);
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

function dispatchSyntheticLinkHoverEvent(terminal: Terminal, link: ILink): void {
  const screenElement = queryExecutionTerminalScreenElement(terminal);
  if (!screenElement) {
    throw new Error('Execution terminal screen is not mounted.');
  }

  const hoverPoint = computeExecutionLinkHoverPoint(terminal, screenElement, link.range);
  const eventTarget = document.elementFromPoint(hoverPoint.clientX, hoverPoint.clientY) ?? screenElement;
  eventTarget.dispatchEvent(
    new MouseEvent('mousemove', {
      bubbles: true,
      composed: true,
      view: window,
      clientX: hoverPoint.clientX,
      clientY: hoverPoint.clientY
    })
  );
}

function dispatchSyntheticLinkMouseLeaveEvent(terminal: Terminal): void {
  const screenElement = queryExecutionTerminalScreenElement(terminal);
  if (!screenElement) {
    return;
  }

  screenElement.dispatchEvent(
    new MouseEvent('mouseleave', {
      bubbles: true,
      composed: true,
      view: window
    })
  );
}

function queryExecutionTerminalScreenElement(terminal: Terminal): HTMLElement | null {
  return terminal.element?.querySelector<HTMLElement>('.xterm-screen') ?? terminal.element ?? null;
}

function computeExecutionLinkHoverPoint(
  terminal: Terminal,
  screenElement: HTMLElement,
  range: IBufferRange
): { clientX: number; clientY: number } {
  const viewportLineIndex = range.start.y - terminal.buffer.active.viewportY - 1;
  if (viewportLineIndex < 0 || viewportLineIndex >= terminal.rows) {
    throw new Error(`Execution link "${range.start.x}:${range.start.y}" is outside the visible viewport.`);
  }

  const rect = screenElement.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    throw new Error('Execution terminal screen has no visible size.');
  }

  const cellWidth = rect.width / Math.max(terminal.cols, 1);
  const cellHeight = rect.height / Math.max(terminal.rows, 1);
  const linkStartColumn = Math.max(0, range.start.x - 1);
  const linkEndColumn =
    range.start.y === range.end.y ? Math.max(linkStartColumn, range.end.x - 1) : Math.max(linkStartColumn, terminal.cols - 1);
  const linkMidColumn = linkStartColumn + Math.max(0, linkEndColumn - linkStartColumn) / 2;
  return {
    clientX: Math.round(rect.left + cellWidth * (linkMidColumn + 0.5)),
    clientY: Math.round(rect.top + cellHeight * (viewportLineIndex + 0.5))
  };
}

function isMacintosh(): boolean {
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform);
}

function readWrappedLineContext(
  terminal: Terminal,
  bufferLineNumber: number,
  maxLinkLength: number
): WrappedLineContext | undefined {
  const startBufferLine = bufferLineNumber - 1;
  let startLine = startBufferLine;
  let endLine = startBufferLine;
  const initialLine = terminal.buffer.active.getLine(startLine);
  if (!initialLine) {
    return undefined;
  }

  const lines: IBufferLine[] = [initialLine];
  const maxCharacterContext = Math.max(maxLinkLength, terminal.cols);
  const maxLineContext = Math.ceil(maxCharacterContext / terminal.cols);
  const minStartLine = Math.max(startLine - maxLineContext, 0);
  const maxEndLine = Math.min(endLine + maxLineContext, terminal.buffer.active.length);

  while (startLine >= minStartLine && terminal.buffer.active.getLine(startLine)?.isWrapped) {
    const previousLine = terminal.buffer.active.getLine(startLine - 1);
    if (!previousLine) {
      break;
    }

    lines.unshift(previousLine);
    startLine -= 1;
  }

  while (endLine < maxEndLine && terminal.buffer.active.getLine(endLine + 1)?.isWrapped) {
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
  let content = '';
  for (let lineIndex = lineStart; lineIndex <= lineEnd; lineIndex += 1) {
    const line = terminal.buffer.active.getLine(lineIndex);
    if (!line) {
      continue;
    }

    content += line.translateToString(true, 0, terminal.cols);
  }

  return content;
}

function readXtermRangesByAttr(terminal: Terminal, lineStart: number, lineEnd: number): IBufferRange[] {
  let bufferRangeStart: { x: number; y: number } | undefined;
  let lastFgAttr = -1;
  let lastBgAttr = -1;
  const ranges: IBufferRange[] = [];

  for (let lineIndex = lineStart; lineIndex <= lineEnd; lineIndex += 1) {
    const line = terminal.buffer.active.getLine(lineIndex);
    if (!line) {
      continue;
    }

    for (let column = 0; column < terminal.cols; column += 1) {
      const cell = line.getCell(column);
      if (!cell) {
        break;
      }

      const fgAttr = cell.isBold() | cell.isInverse() | cell.isStrikethrough() | cell.isUnderline();
      const bgAttr = cell.isDim() | cell.isItalic();
      if (lastFgAttr === -1 || lastBgAttr === -1) {
        bufferRangeStart = { x: column, y: lineIndex };
      } else if (lastFgAttr !== fgAttr || lastBgAttr !== bgAttr) {
        if (bufferRangeStart) {
          ranges.push({
            start: {
              x: bufferRangeStart.x + 1,
              y: bufferRangeStart.y + 1
            },
            end: {
              x: column,
              y: lineIndex + 1
            }
          });
        }
        bufferRangeStart = { x: column, y: lineIndex };
      }

      lastFgAttr = fgAttr;
      lastBgAttr = bgAttr;
    }
  }

  return ranges;
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
  _tooltipController: TooltipController
): Promise<ILink | undefined> {
  for (
    let bufferLineNumber = options.terminal.buffer.active.length;
    bufferLineNumber >= options.terminal.buffer.active.viewportY + 1;
    bufferLineNumber -= 1
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
