export type ExecutionTerminalPathStyle = 'windows' | 'posix';
export type ExecutionTerminalFileLinkTargetKind =
  | 'file'
  | 'directory-in-workspace'
  | 'directory-outside-workspace';
export type ExecutionTerminalUrlLinkSource = 'implicit' | 'explicit';
export type ExecutionTerminalFileLinkSource = 'detected' | 'refined' | 'fallback' | 'explicit-uri';
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

const linkWithSuffixPathCharacters = /(?<path>(?:file:\/\/\/)?[^\s\|<>\[\({][^\s\|<>]*)$/;

const enum RegexPathConstants {
  PathPrefix = '(?:\\.\\.?|\\~|file:\\/\\/)',
  PathSeparatorClause = '\\/',
  ExcludedPathCharactersClause = '[^\\0<>\\?\\s!`&*()\'":;\\\\]',
  ExcludedStartPathCharactersClause = '[^\\0<>\\?\\s!`&*()\\[\\]\'":;\\\\]',
  WinOtherPathPrefix = '\\.\\.?|\\~',
  WinPathSeparatorClause = '(?:\\\\|\\/)',
  WinExcludedPathCharactersClause = '[^\\0<>\\?\\|\\/\\s!`&*()\'":;]',
  WinExcludedStartPathCharactersClause = '[^\\0<>\\?\\|\\/\\s!`&*()\\[\\]\'":;]'
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
  return results;
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
