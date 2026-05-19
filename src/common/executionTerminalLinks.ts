export type ExecutionTerminalPathStyle = 'windows' | 'posix';
export type ExecutionTerminalFileLinkTargetKind =
  | 'file'
  | 'directory-in-workspace'
  | 'directory-outside-workspace';
export type ExecutionTerminalUrlLinkSource = 'implicit' | 'explicit';
export type ExecutionTerminalFileLinkSource =
  | 'detected'
  | 'refined'
  | 'fallback'
  | 'hardwrap'
  | 'explicit-uri';
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
  if (!hasExecutionTerminalPathStartBoundary(line, startIndex)) {
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
    if (!text) {
      break;
    }

    if (
      ((line.startsWith('--- a/') || line.startsWith('+++ b/')) && index === 4) ||
      (line.startsWith('diff --git') && (text.startsWith('a/') || text.startsWith('b/')))
    ) {
      text = text.slice(2);
      index += 2;
    }

    results.push({
      path: {
        index,
        text
      }
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

const fallbackMatchers: RegExp[] = [
  /^ *File (?<link>"(?<path>.+)"(, line (?<line>\d+))?)/,
  /^ +FILE +(?<link>(?<path>.+)(?::(?<line>\d+)(?::(?<col>\d+))?)?)/,
  /^(?<link>(?<path>.+)\((?<line>\d+)(?:, ?(?<col>\d+))?\)) ?:/,
  /^(?<link>(?<path>.+):(?<line>\d+)(?::(?<col>\d+))?) ?:/,
  /^(?:PS\s+)?(?<link>(?<path>[^>]+))>/,
  /^ *(?<link>(?<path>.+))/
];

export function detectExecutionTerminalFallbackPathLink(
  line: string
): ExecutionTerminalFallbackPathLink | undefined {
  for (const matcher of fallbackMatchers) {
    const match = line.match(matcher);
    const group = match?.groups;
    if (!group?.link || !group.path) {
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
