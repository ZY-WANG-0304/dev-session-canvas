export type ExecutionTerminalPathStyle = 'windows' | 'posix';
export type ExecutionTerminalFileLinkTargetKind =
  | 'file'
  | 'directory-in-workspace'
  | 'directory-outside-workspace';
export type ExecutionTerminalUrlLinkSource = 'implicit' | 'explicit';
export type ExecutionTerminalFileLinkSource =
  | 'detected'
  | 'refined'
  | 'styled'
  | 'fallback'
  | 'hardwrap'
  | 'explicit-uri';
export type ExecutionTerminalFileLinkResolvePriority = 'interactive' | 'background';
export type ExecutionTerminalSearchLinkSource = 'word';
export const DEFAULT_EXECUTION_TERMINAL_WORD_SEPARATORS = ' ()[]{}\',"`';
export type ExecutionTerminalOpenLink =
  | {
      linkKind: 'file';
      text: string;
      path: string;
      line?: number;
      column?: number;
      lineEnd?: number;
      columnEnd?: number;
      bufferStartLine?: number;
      resolvedId?: string;
      targetKind?: ExecutionTerminalFileLinkTargetKind;
      source?: ExecutionTerminalFileLinkSource;
    }
  | {
      linkKind: 'url';
      text: string;
      url: string;
      source?: ExecutionTerminalUrlLinkSource;
    }
  | {
      linkKind: 'search';
      text: string;
      searchText: string;
      contextLine?: string;
      bufferStartLine?: number;
      source?: ExecutionTerminalSearchLinkSource;
    };

export interface ExecutionTerminalDroppedResource {
  source: 'resourceUrls' | 'codeFiles' | 'uriList' | 'files';
  valueKind: 'uri' | 'path';
  value: string;
}

export interface ExecutionTerminalFileLinkCandidate {
  candidateId: string;
  text: string;
  path: string;
  startIndex: number;
  endIndexExclusive: number;
  bufferStartLine: number;
  line?: number;
  column?: number;
  lineEnd?: number;
  columnEnd?: number;
  source: ExecutionTerminalFileLinkSource;
}

export interface ExecutionTerminalResolvedFileLink {
  candidateId: string;
  link: {
    linkKind: 'file';
    text: string;
    path: string;
    line?: number;
    column?: number;
    lineEnd?: number;
    columnEnd?: number;
    bufferStartLine?: number;
    resolvedId: string;
    targetKind: ExecutionTerminalFileLinkTargetKind;
    source?: ExecutionTerminalFileLinkSource;
  };
}

export interface ExecutionTerminalLinkSuffix {
  row: number | undefined;
  col: number | undefined;
  rowEnd: number | undefined;
  colEnd: number | undefined;
  suffix: ExecutionTerminalLinkPartialRange;
}

interface ExecutionTerminalLinkPartialRange {
  index: number;
  text: string;
}

interface ParsedExecutionTerminalLink {
  path: ExecutionTerminalLinkPartialRange;
  prefix?: ExecutionTerminalLinkPartialRange;
  suffix?: ExecutionTerminalLinkSuffix;
  hasStartBoundary?: boolean;
}

const linkSuffixRegexEol = generateLinkSuffixRegex(true);
const linkSuffixRegex = generateLinkSuffixRegex(false);

function generateLinkSuffixRegex(eolOnly: boolean): RegExp {
  let rowIndex = 0;
  let columnIndex = 0;
  let rowEndIndex = 0;
  let columnEndIndex = 0;
  const row = (): string => `(?<row${rowIndex++}>\\d+)`;
  const column = (): string => `(?<col${columnIndex++}>\\d+)`;
  const rowEnd = (): string => `(?<rowEnd${rowEndIndex++}>\\d+)`;
  const columnEnd = (): string => `(?<colEnd${columnEndIndex++}>\\d+)`;
  const endOfLine = eolOnly ? '$' : '';
  const lineAndColumnClauses = [
    `(?::|#| |['"],|, )${row()}([:.]${column()}(?:-(?:${rowEnd()}\\.)?${columnEnd()})?)?${endOfLine}`,
    `['"]?(?:,? |: ?| on )lines? ${row()}(?:-${rowEnd()})?(?:,? (?:col(?:umn)?|characters?) ${column()}(?:-${columnEnd()})?)?${endOfLine}`,
    `:? ?[\\[\\(]${row()}(?:(?:, ?|:)${column()})?[\\]\\)]${endOfLine}`
  ];
  const suffixClause = lineAndColumnClauses.join('|').replace(/ /g, `[${'\u00A0'} ]`);
  return new RegExp(`(${suffixClause})`, eolOnly ? undefined : 'g');
}

function parseIntOptional(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function normalizeExecutionTerminalWordSeparators(value: unknown): string {
  return typeof value === 'string' && value.length > 0
    ? value
    : DEFAULT_EXECUTION_TERMINAL_WORD_SEPARATORS;
}

export function inferExecutionTerminalPathStyle(
  shellPath: string | undefined,
  cwd: string | undefined
): ExecutionTerminalPathStyle {
  const cwdValue = cwd?.trim() ?? '';
  const shellValue = shellPath?.trim() ?? '';
  if (
    /^[a-zA-Z]:[\\/]/.test(cwdValue) ||
    cwdValue.startsWith('\\\\') ||
    /^[a-zA-Z]:/.test(shellValue) ||
    shellValue.includes('\\')
  ) {
    return 'windows';
  }

  return 'posix';
}

export function getExecutionTerminalLinkSuffix(
  value: string
): ExecutionTerminalLinkSuffix | undefined {
  const match = linkSuffixRegexEol.exec(value);
  if (!match?.groups || match.length < 1) {
    return undefined;
  }

  return {
    row: parseIntOptional(match.groups.row0 ?? match.groups.row1 ?? match.groups.row2),
    col: parseIntOptional(match.groups.col0 ?? match.groups.col1 ?? match.groups.col2),
    rowEnd: parseIntOptional(match.groups.rowEnd0 ?? match.groups.rowEnd1 ?? match.groups.rowEnd2),
    colEnd: parseIntOptional(match.groups.colEnd0 ?? match.groups.colEnd1 ?? match.groups.colEnd2),
    suffix: {
      index: match.index,
      text: match[0]
    }
  };
}

export function removeExecutionTerminalLinkSuffix(value: string): string {
  const suffix = getExecutionTerminalLinkSuffix(value);
  if (!suffix) {
    return value;
  }

  return value.slice(0, suffix.suffix.index);
}

export function removeExecutionTerminalLinkQueryString(value: string): string {
  const start = value.startsWith('\\\\?\\') ? 4 : 0;
  const index = value.indexOf('?', start);
  if (index < 0) {
    return value;
  }

  return value.slice(0, index);
}

export const EXECUTION_TERMINAL_CJK_PUNCTUATION_CHARACTER_CLASS =
  '\\u2018-\\u201F\\u3000-\\u303F\\uFF01-\\uFF0F\\uFF1A-\\uFF20\\uFF3B-\\uFF40\\uFF5B-\\uFF65';
const cjkPunctuationRegex = new RegExp(`[${EXECUTION_TERMINAL_CJK_PUNCTUATION_CHARACTER_CLASS}]`);
const cjkIdeographRegex = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/;
const cjkProsePrefixBeforeAsciiPathRegex = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF][a-zA-Z][a-zA-Z._-]*$/;
const fileLikeWordRegex = /(?:^|[\\/])[^\\/]+\.[a-zA-Z\d]{1,16}(?::\d+(?::\d+)?)?$/;
const codeDirectoryRootSegments = new Set([
  'api',
  'app',
  'apps',
  'bin',
  'client',
  'cmd',
  'components',
  'config',
  'configs',
  'docs',
  'e2e',
  'examples',
  'internal',
  'lib',
  'libs',
  'packages',
  'pages',
  'pkg',
  'playwright',
  'public',
  'scripts',
  'server',
  'services',
  'source',
  'spec',
  'src',
  'test',
  'tests',
  'tools',
  'web'
]);
const linkWithSuffixPathCharacters = new RegExp(
  `(?<path>(?:file:\\/\\/\\/)?[^\\s\\|<>\\[\\({${EXECUTION_TERMINAL_CJK_PUNCTUATION_CHARACTER_CLASS}][^\\s\\|<>${EXECUTION_TERMINAL_CJK_PUNCTUATION_CHARACTER_CLASS}]*)$`
);

export function shouldSuppressExecutionTerminalWordLink(value: string): boolean {
  if (cjkPunctuationRegex.test(value)) {
    return true;
  }

  if (!cjkIdeographRegex.test(value)) {
    return false;
  }

  if (hasProsePrefixedRelativePath(value, inferExecutionTerminalPathStyle(undefined, value))) {
    return true;
  }

  return !isFileLikeExecutionTerminalWord(value);
}

function isFileLikeExecutionTerminalWord(value: string): boolean {
  return (
    fileLikeWordRegex.test(value) ||
    value.startsWith('/') ||
    value.startsWith('./') ||
    value.startsWith('../') ||
    value.startsWith('~/') ||
    value.startsWith('file://') ||
    /^[a-zA-Z]:[\\/]/.test(value) ||
    value.startsWith('\\\\')
  );
}

const enum RegexPathConstants {
  PathPrefix = '(?:\\.\\.?|\\~|file:\\/\\/)',
  PathSeparatorClause = '\\/',
  ExcludedPathCharactersClause = '[^\\0<>\\?\\s!`&*()\'":;\\\\\\u2018-\\u201F\\u3000-\\u303F\\uFF01-\\uFF0F\\uFF1A-\\uFF20\\uFF3B-\\uFF40\\uFF5B-\\uFF65]',
  ExcludedStartPathCharactersClause = '[^\\0<>\\?\\s!`&*()\\[\\]\'":;\\\\\\u2018-\\u201F\\u3000-\\u303F\\uFF01-\\uFF0F\\uFF1A-\\uFF20\\uFF3B-\\uFF40\\uFF5B-\\uFF65]',
  WinOtherPathPrefix = '\\.\\.?|\\~',
  WinPathSeparatorClause = '(?:\\\\|\\/)',
  WinExcludedPathCharactersClause = '[^\\0<>\\?\\|\\/\\s!`&*()\'":;\\u2018-\\u201F\\u3000-\\u303F\\uFF01-\\uFF0F\\uFF1A-\\uFF20\\uFF3B-\\uFF40\\uFF5B-\\uFF65]',
  WinExcludedStartPathCharactersClause = '[^\\0<>\\?\\|\\/\\s!`&*()\\[\\]\'":;\\u2018-\\u201F\\u3000-\\u303F\\uFF01-\\uFF0F\\uFF1A-\\uFF20\\uFF3B-\\uFF40\\uFF5B-\\uFF65]'
}

const unixLocalLinkClause =
  '(?:(?:' +
  RegexPathConstants.PathPrefix +
  '|(?:' +
  RegexPathConstants.ExcludedStartPathCharactersClause +
  RegexPathConstants.ExcludedPathCharactersClause +
  '*))?(?:' +
  RegexPathConstants.PathSeparatorClause +
  '(?:' +
  RegexPathConstants.ExcludedPathCharactersClause +
  ')+)+)';

export const executionTerminalWindowsDrivePrefix =
  '(?:\\\\\\\\\\?\\\\|file:\\/\\/\\/)?[a-zA-Z]:';

const windowsLocalLinkClause =
  '(?:(?:' +
  `(?:${executionTerminalWindowsDrivePrefix}|${RegexPathConstants.WinOtherPathPrefix})` +
  '|(?:' +
  RegexPathConstants.WinExcludedStartPathCharactersClause +
  RegexPathConstants.WinExcludedPathCharactersClause +
  '*))?(?:' +
  RegexPathConstants.WinPathSeparatorClause +
  '(?:' +
  RegexPathConstants.WinExcludedPathCharactersClause +
  ')+)+)';

export interface DetectedExecutionTerminalPathLink {
  text: string;
  path: string;
  startIndex: number;
  endIndexExclusive: number;
  line: number | undefined;
  column: number | undefined;
  lineEnd: number | undefined;
  columnEnd: number | undefined;
}

export interface ExecutionTerminalStyledPathLink extends DetectedExecutionTerminalPathLink {}

export function detectExecutionTerminalPathLinks(
  line: string,
  style: ExecutionTerminalPathStyle
): DetectedExecutionTerminalPathLink[] {
  const parsedLinks = detectParsedExecutionTerminalLinks(line, style);
  return parsedLinks
    .map((parsedLink) => {
      const startIndex = parsedLink.prefix?.index ?? parsedLink.path.index;
      const endIndexExclusive = parsedLink.suffix
        ? parsedLink.suffix.suffix.index + parsedLink.suffix.suffix.text.length
        : parsedLink.path.index + parsedLink.path.text.length;
      const suffix = parsedLink.suffix;
      return {
        text: line.slice(startIndex, endIndexExclusive),
        path: parsedLink.path.text,
        startIndex,
        endIndexExclusive,
        line: suffix?.row,
        column: suffix?.col,
        lineEnd: suffix?.rowEnd,
        columnEnd: suffix?.colEnd
      };
    })
    .filter((candidate) => candidate.text.trim().length > 0 && candidate.path.trim().length > 0);
}

export function detectExecutionTerminalStyledPathLink(
  value: string,
  style: ExecutionTerminalPathStyle
): ExecutionTerminalStyledPathLink | undefined {
  const trimmedValue = value.trim();
  if (!trimmedValue || isObviousLowConfidenceExecutionTerminalStyledPathText(trimmedValue)) {
    return undefined;
  }

  const trimStartIndex = value.indexOf(trimmedValue);
  const detectedLink = detectExecutionTerminalPathLinks(trimmedValue, style).find(
    (candidate) =>
      !isObviousLowConfidenceExecutionTerminalStyledPathText(candidate.text.trim()) &&
      isPlausibleExecutionTerminalStyledFilePath(candidate.path, style)
  );
  if (detectedLink) {
    const normalizedLink = normalizeExecutionTerminalStyledDetectedPathLink(detectedLink);
    return normalizedLink
      ? offsetExecutionTerminalStyledPathLink(normalizedLink, trimStartIndex)
      : undefined;
  }

  const basenameLink = detectExecutionTerminalStyledBasenamePathLink(trimmedValue, style);
  return basenameLink ? offsetExecutionTerminalStyledPathLink(basenameLink, trimStartIndex) : undefined;
}

export function isPlausibleExecutionTerminalStyledFilePath(
  value: string,
  style: ExecutionTerminalPathStyle
): boolean {
  const trimmedToken = trimExecutionTerminalStyledPathToken(value.trim()).text;
  if (
    !trimmedToken ||
    isObviousLowConfidenceExecutionTerminalStyledPathText(trimmedToken) ||
    hasProsePrefixedRelativePath(trimmedToken, style)
  ) {
    return false;
  }

  if (/[\r\n\s{}<>"'`,;|]/u.test(trimmedToken)) {
    return false;
  }

  if (hasExecutionTerminalStyledFileExtension(trimmedToken)) {
    return true;
  }

  if (hasExplicitExecutionTerminalPathPrefix(trimmedToken, style)) {
    return isPlausibleExplicitExecutionTerminalStyledPath(trimmedToken, style);
  }

  if (!hasExecutionTerminalStyledPathSeparator(trimmedToken)) {
    return false;
  }

  return isPlausibleSeparatedExecutionTerminalStyledPath(trimmedToken);
}

export function shouldAllowExecutionTerminalDetectedPathLink(
  link: {
    text: string;
    path: string;
    line?: number;
    column?: number;
    lineEnd?: number;
    columnEnd?: number;
  },
  style: ExecutionTerminalPathStyle
): boolean {
  if (isPlausibleExecutionTerminalStyledFilePath(link.path, style)) {
    return true;
  }

  if (link.line === undefined) {
    return false;
  }

  return isPlausibleExecutionTerminalBareLineLocationLink(link);
}

function isPlausibleExecutionTerminalBareLineLocationLink(
  link: {
    text: string;
    path: string;
    line?: number;
    column?: number;
    lineEnd?: number;
    columnEnd?: number;
  }
): boolean {
  const trimmedPath = trimExecutionTerminalStyledPathToken(link.path.trim()).text;
  const trimmedText = link.text.trim();
  if (
    !trimmedPath ||
    trimmedPath !== link.path.trim() ||
    isObviousLowConfidenceExecutionTerminalStyledPathText(trimmedPath) ||
    /[\\/()[\]{}<>"'`,;:|\s]/u.test(trimmedPath) ||
    !/^[._A-Za-z\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/u.test(trimmedPath)
  ) {
    return false;
  }

  if (trimmedText.startsWith(`${trimmedPath}:`)) {
    return true;
  }

  if (/^['"`].+['"`],?\s+lines?\s+\d+/iu.test(trimmedText)) {
    return true;
  }

  if (new RegExp(`^File ['"]${escapeRegExp(trimmedPath)}['"],? line \\d+`, 'iu').test(trimmedText)) {
    return true;
  }

  return /\blines?\s+\d+/iu.test(trimmedText) && /['"`]/u.test(trimmedText);
}

function normalizeExecutionTerminalStyledDetectedPathLink(
  link: ExecutionTerminalStyledPathLink
): ExecutionTerminalStyledPathLink | undefined {
  const trimmedPath = trimExecutionTerminalStyledPathToken(link.path);
  if (!trimmedPath.text) {
    return undefined;
  }

  if (trimmedPath.text === link.path) {
    return link;
  }

  const pathTextIndex = link.text.indexOf(link.path);
  if (pathTextIndex < 0) {
    return undefined;
  }

  const startIndex = link.startIndex + pathTextIndex + trimmedPath.startIndex;
  const endIndexExclusive = link.startIndex + pathTextIndex + trimmedPath.endIndexExclusive;
  return {
    ...link,
    text: link.text.slice(
      pathTextIndex + trimmedPath.startIndex,
      pathTextIndex + trimmedPath.endIndexExclusive
    ),
    path: trimmedPath.text,
    startIndex,
    endIndexExclusive
  };
}

function detectExecutionTerminalStyledBasenamePathLink(
  value: string,
  style: ExecutionTerminalPathStyle
): ExecutionTerminalStyledPathLink | undefined {
  const token = trimExecutionTerminalStyledPathToken(value);
  if (!isPlausibleExecutionTerminalStyledFilePath(token.text, style)) {
    return undefined;
  }

  if (hasExecutionTerminalStyledPathSeparator(token.text)) {
    return undefined;
  }

  return {
    text: token.text,
    path: token.text,
    startIndex: token.startIndex,
    endIndexExclusive: token.endIndexExclusive,
    line: undefined,
    column: undefined,
    lineEnd: undefined,
    columnEnd: undefined
  };
}

function offsetExecutionTerminalStyledPathLink(
  link: ExecutionTerminalStyledPathLink,
  offset: number
): ExecutionTerminalStyledPathLink {
  if (offset <= 0) {
    return link;
  }

  return {
    ...link,
    startIndex: link.startIndex + offset,
    endIndexExclusive: link.endIndexExclusive + offset
  };
}

function trimExecutionTerminalStyledPathToken(value: string): {
  text: string;
  startIndex: number;
  endIndexExclusive: number;
} {
  let startIndex = 0;
  let endIndexExclusive = value.length;

  while (startIndex < endIndexExclusive && /\s/u.test(value[startIndex])) {
    startIndex += 1;
  }
  while (endIndexExclusive > startIndex && /\s/u.test(value[endIndexExclusive - 1])) {
    endIndexExclusive -= 1;
  }

  let text = value.slice(startIndex, endIndexExclusive);
  const unwrapPair = (open: string, close: string): boolean => {
    if (text.length >= 2 && text.startsWith(open) && text.endsWith(close)) {
      startIndex += open.length;
      endIndexExclusive -= close.length;
      text = value.slice(startIndex, endIndexExclusive);
      return true;
    }
    return false;
  };

  let changed = true;
  while (changed) {
    changed =
      unwrapPair('"', '"') ||
      unwrapPair("'", "'") ||
      unwrapPair('`', '`') ||
      unwrapPair('(', ')') ||
      unwrapPair('[', ']') ||
      unwrapPair('{', '}');
  }

  while (endIndexExclusive > startIndex && /[.,;]/u.test(value[endIndexExclusive - 1])) {
    endIndexExclusive -= 1;
  }

  return {
    text: value.slice(startIndex, endIndexExclusive),
    startIndex,
    endIndexExclusive
  };
}

function isObviousLowConfidenceExecutionTerminalStyledPathText(value: string): boolean {
  const trimmedValue = value.trim();
  return (
    trimmedValue.length === 0 ||
    /^[,.;:]+$/u.test(trimmedValue) ||
    /^(?:[•·›]|[│┃┆┊╎╏└├┌┐┘┤┬┴┼╭╰╮╯]|…|\.\.\.)/u.test(trimmedValue) ||
    /[•·›│┃┆┊╎╏└├┌┐┘┤┬┴┼╭╰╮╯…]/u.test(trimmedValue) ||
    /^(?:\d+[smhd]?|\d+:\d+|\d{4}-\d{2}-\d{2})\b/iu.test(trimmedValue) ||
    /\b(?:context left|tab to queue message|esc to interrupt|yolo mode)\b/iu.test(trimmedValue) ||
    /^(?:working|explored|searching the web|searched the web|ran|new)$/iu.test(trimmedValue) ||
    /^improve documentation in @filename$/iu.test(trimmedValue)
  );
}

function hasExecutionTerminalStyledPathSeparator(value: string): boolean {
  return /[\\/]/u.test(value);
}

function hasExecutionTerminalStyledFileExtension(value: string): boolean {
  return (
    !/[\\/][\\/]/u.test(value) &&
    !/[()[\]]/u.test(value) &&
    /(?:^|[\\/])[^\\/]+\.[a-zA-Z\d]{1,16}$/u.test(value)
  );
}

function isPlausibleExplicitExecutionTerminalStyledPath(
  value: string,
  style: ExecutionTerminalPathStyle
): boolean {
  if (value.startsWith('/') && !value.startsWith('//')) {
    const withoutRoot = value.slice(1);
    return hasExecutionTerminalStyledFileExtension(value) || withoutRoot.includes('/');
  }

  if (value.startsWith('file://')) {
    const filePath = value.replace(/^file:\/\/\/?/u, '');
    return hasExecutionTerminalStyledFileExtension(filePath) || filePath.includes('/');
  }

  if (value.startsWith('./') || value.startsWith('../') || value.startsWith('~/')) {
    return value.replace(/^(?:\.{1,2}|~)[\\/]/u, '').length > 0;
  }

  if (style === 'windows' && (/^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('\\\\'))) {
    return true;
  }

  return isPlausibleSeparatedExecutionTerminalStyledPath(value);
}

function isPlausibleSeparatedExecutionTerminalStyledPath(value: string): boolean {
  if (
    value.startsWith('//') ||
    value.startsWith('@') ||
    hasUrlLikeExecutionTerminalPathPrefix(value) ||
    /[()[\]]/u.test(value) ||
    /[•·›│┃┆┊╎╏└├┌┐┘┤┬┴┼╭╰╮╯…]/u.test(value)
  ) {
    return false;
  }

  const normalizedValue = value
    .replace(/^file:\/\/\/?/u, '')
    .replace(/^[a-zA-Z]:/u, '')
    .replace(/^\\\\/u, '')
    .replace(/^(?:\.{1,2}|~)[\\/]/u, '');
  const parts = normalizedValue.split(/[\\/]+/u).filter((part) => part.length > 0);
  if (parts.length === 0 || parts.every((part) => /^\d+$/u.test(part))) {
    return false;
  }

  if (parts.some((part) => part.startsWith('@'))) {
    return false;
  }

  if (hasExecutionTerminalStyledFileExtension(normalizedValue)) {
    return true;
  }

  return isPlausibleExtensionlessExecutionTerminalDirectoryPath(parts);
}

function hasUrlLikeExecutionTerminalPathPrefix(value: string): boolean {
  const firstSegment = value.split(/[\\/]+/u).find((part) => part.length > 0) ?? '';
  return /^[a-zA-Z\d-]+(?:\.[a-zA-Z\d-]+)+$/u.test(firstSegment);
}

function isPlausibleExtensionlessExecutionTerminalDirectoryPath(parts: string[]): boolean {
  if (parts.length < 2 || parts.some((part) => cjkIdeographRegex.test(part))) {
    return false;
  }

  if (
    parts.some(
      (part) =>
        part.length > 80 ||
        !/^[.@A-Za-z0-9_-]+$/u.test(part) ||
        part === '.' ||
        part === '..'
    )
  ) {
    return false;
  }

  const firstSegment = parts[0].replace(/^\.+/u, '').toLowerCase();
  if (codeDirectoryRootSegments.has(firstSegment)) {
    return true;
  }

  if (parts[0].startsWith('.') && parts.length >= 3) {
    return true;
  }

  return false;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function detectParsedExecutionTerminalLinks(
  line: string,
  style: ExecutionTerminalPathStyle
): ParsedExecutionTerminalLink[] {
  const results = detectLinksViaSuffix(line);
  const noSuffixPaths = detectPathsWithoutSuffix(line, style);
  insertParsedLinks(results, noSuffixPaths);
  return results.filter((link) => isValidParsedExecutionTerminalLink(line, link, style));
}

function isValidParsedExecutionTerminalLink(
  line: string,
  link: ParsedExecutionTerminalLink,
  style: ExecutionTerminalPathStyle
): boolean {
  const startIndex = link.prefix?.index ?? link.path.index;
  if (!link.hasStartBoundary && !hasExecutionTerminalPathStartBoundary(line, startIndex)) {
    return false;
  }

  if (isTruncatedBeforeInternalCjkPunctuation(line, link.path.index + link.path.text.length)) {
    return false;
  }

  return !hasProsePrefixedRelativePath(link.path.text, style);
}

function hasExecutionTerminalPathStartBoundary(line: string, startIndex: number): boolean {
  if (startIndex <= 0) {
    return true;
  }

  const previous = line[startIndex - 1];
  return /[\s"'`,:;=\[\(\{<]/.test(previous) || cjkPunctuationRegex.test(previous);
}

function hasProsePrefixedRelativePath(
  pathText: string,
  style: ExecutionTerminalPathStyle
): boolean {
  if (hasExplicitExecutionTerminalPathPrefix(pathText, style)) {
    return false;
  }

  const firstSeparatorIndex =
    style === 'windows'
      ? findFirstExecutionTerminalPathSeparator(pathText, ['\\', '/'])
      : pathText.indexOf('/');
  if (firstSeparatorIndex <= 0) {
    return false;
  }

  const firstSegment = pathText.slice(0, firstSeparatorIndex);
  return cjkProsePrefixBeforeAsciiPathRegex.test(firstSegment);
}

function isTruncatedBeforeInternalCjkPunctuation(line: string, endIndexExclusive: number): boolean {
  const next = line[endIndexExclusive];
  if (!next || !cjkPunctuationRegex.test(next)) {
    return false;
  }

  const rest = line.slice(endIndexExclusive + 1);
  if (!rest) {
    return false;
  }

  const nextBoundaryIndex = rest.search(/[\s"'`,;=\[\(\{<]/);
  const nextSegment = nextBoundaryIndex < 0 ? rest : rest.slice(0, nextBoundaryIndex);
  return /[\\/]/.test(nextSegment) || /\.[a-zA-Z\d]{1,16}(?=$|[^\w])/u.test(nextSegment);
}

function hasExplicitExecutionTerminalPathPrefix(
  pathText: string,
  style: ExecutionTerminalPathStyle
): boolean {
  if (
    pathText.startsWith('/') ||
    pathText.startsWith('./') ||
    pathText.startsWith('../') ||
    pathText.startsWith('~/') ||
    pathText.startsWith('file://')
  ) {
    return true;
  }

  if (style === 'windows') {
    return /^[a-zA-Z]:[\\/]/.test(pathText) || pathText.startsWith('\\\\');
  }

  return false;
}

function findFirstExecutionTerminalPathSeparator(value: string, separators: string[]): number {
  let index = -1;
  for (const separator of separators) {
    const nextIndex = value.indexOf(separator);
    if (nextIndex >= 0 && (index < 0 || nextIndex < index)) {
      index = nextIndex;
    }
  }

  return index;
}

function detectLinksViaSuffix(line: string): ParsedExecutionTerminalLink[] {
  const results: ParsedExecutionTerminalLink[] = [];
  linkSuffixRegex.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = linkSuffixRegex.exec(line)) !== null) {
    const suffix = toExecutionTerminalLinkSuffix(match);
    if (!suffix) {
      break;
    }

    const beforeSuffix = line.slice(0, suffix.suffix.index);
    const possiblePathMatch = beforeSuffix.match(linkWithSuffixPathCharacters);
    if (possiblePathMatch?.index === undefined || !possiblePathMatch.groups?.path) {
      continue;
    }

    let linkStartIndex = possiblePathMatch.index;
    let pathText = possiblePathMatch.groups.path;
    let prefix: ExecutionTerminalLinkPartialRange | undefined;
    const prefixMatch = pathText.match(/^(?<prefix>['"]+)/);
    if (prefixMatch?.groups?.prefix) {
      prefix = {
        index: linkStartIndex,
        text: prefixMatch.groups.prefix
      };
      pathText = pathText.slice(prefix.text.length);
      if (pathText.trim().length === 0) {
        continue;
      }

      if (prefix.text.length > 1) {
        const firstSuffixChar = suffix.suffix.text[0];
        const lastPrefixChar = prefix.text[prefix.text.length - 1];
        if ((firstSuffixChar === '\'' || firstSuffixChar === '"') && lastPrefixChar === firstSuffixChar) {
          const trimAmount = prefix.text.length - 1;
          prefix = {
            index: prefix.index + trimAmount,
            text: lastPrefixChar
          };
          linkStartIndex += trimAmount;
        }
      }
    }

    const pathIndex = linkStartIndex + (prefix?.text.length ?? 0);
    results.push({
      path: {
        index: pathIndex,
        text: pathText
      },
      prefix,
      suffix
    });

    const openingBracketMatches = pathText.matchAll(/(?<bracket>[\[\(])(?![\]\)])/g);
    for (const bracketMatch of openingBracketMatches) {
      const bracket = bracketMatch.groups?.bracket;
      if (!bracket || bracketMatch.index === undefined) {
        continue;
      }

      results.push({
        path: {
          index: pathIndex + bracketMatch.index + 1,
          text: pathText.slice(bracketMatch.index + bracket.length)
        },
        prefix,
        suffix
      });
    }
  }

  return results;
}

function detectPathsWithoutSuffix(
  line: string,
  style: ExecutionTerminalPathStyle
): ParsedExecutionTerminalLink[] {
  const results: ParsedExecutionTerminalLink[] = [];
  const regex = new RegExp(style === 'windows' ? windowsLocalLinkClause : unixLocalLinkClause, 'g');
  let match: RegExpExecArray | null;
  while ((match = regex.exec(line)) !== null) {
    let text = match[0];
    let index = match.index;
    let hasStartBoundary = false;
    if (!text) {
      break;
    }

    if (
      ((line.startsWith('--- a/') || line.startsWith('+++ b/')) && index === 4) ||
      (line.startsWith('diff --git') && (text.startsWith('a/') || text.startsWith('b/')))
    ) {
      text = text.slice(2);
      index += 2;
      hasStartBoundary = true;
    }

    results.push({
      path: {
        index,
        text
      },
      hasStartBoundary
    });
  }

  return results;
}

function insertParsedLinks(list: ParsedExecutionTerminalLink[], newItems: ParsedExecutionTerminalLink[]): void {
  if (list.length === 0) {
    list.push(...newItems);
    return;
  }

  for (const item of newItems) {
    insertParsedLink(list, item, 0, list.length);
  }
}

function insertParsedLink(
  list: ParsedExecutionTerminalLink[],
  newItem: ParsedExecutionTerminalLink,
  low: number,
  high: number
): void {
  if (list.length === 0) {
    list.push(newItem);
    return;
  }

  if (low > high) {
    return;
  }

  const middle = Math.floor((low + high) / 2);
  if (
    middle >= list.length ||
    (newItem.path.index < list[middle].path.index &&
      (middle === 0 || newItem.path.index > list[middle - 1].path.index))
  ) {
    if (
      middle >= list.length ||
      (newItem.path.index + newItem.path.text.length < list[middle].path.index &&
        (middle === 0 ||
          newItem.path.index >
            list[middle - 1].path.index + list[middle - 1].path.text.length))
    ) {
      list.splice(middle, 0, newItem);
    }
    return;
  }

  if (newItem.path.index > list[middle].path.index) {
    insertParsedLink(list, newItem, middle + 1, high);
  } else {
    insertParsedLink(list, newItem, low, middle - 1);
  }
}

function toExecutionTerminalLinkSuffix(
  match: RegExpExecArray | null
): ExecutionTerminalLinkSuffix | undefined {
  if (!match?.groups || match.length < 1) {
    return undefined;
  }

  return {
    row: parseIntOptional(match.groups.row0 ?? match.groups.row1 ?? match.groups.row2),
    col: parseIntOptional(match.groups.col0 ?? match.groups.col1 ?? match.groups.col2),
    rowEnd: parseIntOptional(match.groups.rowEnd0 ?? match.groups.rowEnd1 ?? match.groups.rowEnd2),
    colEnd: parseIntOptional(match.groups.colEnd0 ?? match.groups.colEnd1 ?? match.groups.colEnd2),
    suffix: {
      index: match.index,
      text: match[0]
    }
  };
}

export interface ExecutionTerminalFallbackPathLink extends DetectedExecutionTerminalPathLink {}

export type ExecutionTerminalFallbackPathDetectionMode = 'strict' | 'interactive';

type ExecutionTerminalFallbackPathMatcherKind =
  | 'file-trace'
  | 'file-label'
  | 'paren-location'
  | 'colon-location'
  | 'shell-prompt'
  | 'plain-line';

interface ExecutionTerminalFallbackPathMatcher {
  kind: ExecutionTerminalFallbackPathMatcherKind;
  matcher: RegExp;
}

const fallbackMatchers: ExecutionTerminalFallbackPathMatcher[] = [
  {
    kind: 'file-trace',
    matcher: /^ *File (?<link>"(?<path>.+)"(, line (?<line>\d+))?)/
  },
  {
    kind: 'file-label',
    matcher: /^ +FILE +(?<link>(?<path>.+)(?::(?<line>\d+)(?::(?<col>\d+))?)?)/
  },
  {
    kind: 'paren-location',
    matcher: /^(?<link>(?<path>.+)\((?<line>\d+)(?:, ?(?<col>\d+))?\)) ?:/
  },
  {
    kind: 'colon-location',
    matcher: /^(?<link>(?<path>.+):(?<line>\d+)(?::(?<col>\d+))?) ?:/
  },
  {
    kind: 'shell-prompt',
    matcher: /^(?:PS\s+)?(?<link>(?<path>[^>]+))>/
  },
  {
    kind: 'plain-line',
    matcher: /^ *(?<link>(?<path>.+))/
  }
];

export function detectExecutionTerminalFallbackPathLink(
  line: string,
  options: {
    mode?: ExecutionTerminalFallbackPathDetectionMode;
    pathStyle?: ExecutionTerminalPathStyle;
  } = {}
): ExecutionTerminalFallbackPathLink | undefined {
  for (const { kind, matcher } of fallbackMatchers) {
    const match = line.match(matcher);
    const group = match?.groups;
    if (!group?.link || !group.path) {
      continue;
    }

    if (
      !shouldAllowExecutionTerminalFallbackPathLink({
        kind,
        line,
        link: group.link,
        path: group.path,
        mode: options.mode ?? 'strict',
        pathStyle: options.pathStyle ?? 'posix'
      })
    ) {
      continue;
    }

    const startIndex = line.indexOf(group.link);
    if (startIndex < 0) {
      continue;
    }

    const lineNumber = parseIntOptional(group.line);
    const columnNumber = parseIntOptional(group.col);
    return {
      text: group.link,
      path: group.path,
      startIndex,
      endIndexExclusive: startIndex + group.link.length,
      line: lineNumber,
      column: columnNumber,
      lineEnd: undefined,
      columnEnd: undefined
    };
  }

  return undefined;
}

function shouldAllowExecutionTerminalFallbackPathLink(options: {
  kind: ExecutionTerminalFallbackPathMatcherKind;
  line: string;
  link: string;
  path: string;
  mode: ExecutionTerminalFallbackPathDetectionMode;
  pathStyle: ExecutionTerminalPathStyle;
}): boolean {
  const trimmedLine = options.line.trim();
  const trimmedLink = options.link.trim();
  const trimmedPath = trimExecutionTerminalFallbackPathQuotes(options.path.trim());
  if (!trimmedLine || !trimmedLink || !trimmedPath) {
    return false;
  }

  if (isObviousLowConfidenceExecutionTerminalFallbackLine(trimmedLine)) {
    return false;
  }

  if (options.kind === 'shell-prompt') {
    return (
      hasExplicitExecutionTerminalFallbackPathPrefix(trimmedPath) ||
      hasExecutionTerminalFallbackPathSeparator(trimmedPath)
    );
  }

  if (options.kind !== 'plain-line') {
    return isPlausibleExecutionTerminalFallbackPath(trimmedPath);
  }

  if (trimmedLine !== trimmedLink) {
    return false;
  }

  if (hasExecutionTerminalFallbackNaturalLanguageBoundary(trimmedPath)) {
    return false;
  }

  if (options.mode === 'interactive') {
    return isPlausibleInteractiveExecutionTerminalFallbackPath(trimmedPath, options.pathStyle);
  }

  return isPlausibleExecutionTerminalFallbackPath(trimmedPath);
}

function trimExecutionTerminalFallbackPathQuotes(value: string): string {
  if (value.length < 2) {
    return value;
  }

  const first = value[0];
  const last = value[value.length - 1];
  if ((first === '"' || first === '\'' || first === '`') && first === last) {
    return value.slice(1, -1).trim();
  }

  return value;
}

function isObviousLowConfidenceExecutionTerminalFallbackLine(value: string): boolean {
  return (
    /^(?:[•·]|[│┃┆┊╎╏└├┌┐┘┤┬┴┼╭╰╮╯]|…|\.\.\.)/u.test(value) ||
    /\bctrl\s*\+\s*t\s+to\s+view\s+transcript\b/iu.test(value)
  );
}

function hasExecutionTerminalFallbackNaturalLanguageBoundary(value: string): boolean {
  return /[\s{}]/u.test(value) || cjkPunctuationRegex.test(value);
}

function isPlausibleExecutionTerminalFallbackPath(value: string): boolean {
  if (
    hasFallbackExecutionTerminalProsePrefix(value) ||
    isNonFileUriLikeExecutionTerminalPath(value)
  ) {
    return false;
  }

  if (hasExplicitExecutionTerminalFallbackPathPrefix(value)) {
    return true;
  }

  if (hasExecutionTerminalFallbackFileExtension(value)) {
    return true;
  }

  return (
    hasExecutionTerminalFallbackPathSeparator(value) &&
    isPlausibleExtensionlessExecutionTerminalDirectoryPath(
      value.split(/[\\/]+/u).filter((part) => part.length > 0)
    )
  );
}

export function isPlausibleInteractiveExecutionTerminalFallbackPath(
  value: string,
  style: ExecutionTerminalPathStyle
): boolean {
  const trimmedValue = trimExecutionTerminalFallbackPathQuotes(value.trim());
  if (
    !trimmedValue ||
    hasFallbackExecutionTerminalProsePrefix(trimmedValue) ||
    isNonFileUriLikeExecutionTerminalPath(trimmedValue)
  ) {
    return false;
  }

  if (hasExplicitExecutionTerminalFallbackPathPrefix(trimmedValue)) {
    return true;
  }

  if (hasExecutionTerminalFallbackFileExtension(trimmedValue)) {
    return true;
  }

  if (!hasExecutionTerminalFallbackPathSeparator(trimmedValue)) {
    return false;
  }

  if (hasUrlLikeExecutionTerminalPathPrefix(trimmedValue)) {
    return false;
  }

  const normalizedValue = trimmedValue
    .replace(/^file:\/\/\/?/u, '')
    .replace(/^[a-zA-Z]:/u, '')
    .replace(/^\\\\/u, '')
    .replace(/^(?:\.{1,2}|~)[\\/]/u, '');
  const parts = normalizedValue.split(/[\\/]+/u).filter((part) => part.length > 0);
  return (
    parts.length >= 2 &&
    !parts.some(
      (part) =>
        part.startsWith('@') ||
        part.length > 80 ||
        cjkIdeographRegex.test(part) ||
        !/^[.@A-Za-z0-9_-]+$/u.test(part) ||
        part === '.' ||
        part === '..'
    ) &&
    !hasProsePrefixedRelativePath(trimmedValue, style)
  );
}

function hasExplicitExecutionTerminalFallbackPathPrefix(value: string): boolean {
  return (
    value.startsWith('/') ||
    value.startsWith('./') ||
    value.startsWith('../') ||
    value.startsWith('~/') ||
    value.startsWith('file://') ||
    /^[a-zA-Z]:[\\/]/.test(value) ||
    value.startsWith('\\\\')
  );
}

function hasExecutionTerminalFallbackPathSeparator(value: string): boolean {
  return /[\\/]/.test(value);
}

function hasExecutionTerminalFallbackFileExtension(value: string): boolean {
  return /(?:^|[\\/])[^\\/]+\.[a-zA-Z\d]{1,16}$/u.test(value);
}

function isNonFileUriLikeExecutionTerminalPath(value: string): boolean {
  if (value.startsWith('file://')) {
    return false;
  }

  if (/^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('\\\\')) {
    return false;
  }

  return /^[a-zA-Z][a-zA-Z\d+\-.]*:/u.test(value);
}

function hasFallbackExecutionTerminalProsePrefix(value: string): boolean {
  return (
    hasProsePrefixedRelativePath(value, 'posix') ||
    hasProsePrefixedRelativePath(value, 'windows')
  );
}
