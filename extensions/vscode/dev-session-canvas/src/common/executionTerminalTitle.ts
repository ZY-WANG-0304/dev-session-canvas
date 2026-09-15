export interface ParsedExecutionTerminalTitles {
  carryover: string;
  titles: string[];
  events: ExecutionTerminalTitleEvent[];
  discardingTitlePayload?: boolean;
}

export type ExecutionTerminalTitleEvent =
  | { kind: 'set-title'; title: string }
  | { kind: 'query-title' };

export interface ProcessedExecutionTerminalTitleControls {
  carryover: string;
  terminalTitle?: string;
  titleQueries: Array<string | undefined>;
  titleUpdated: boolean;
  terminalOutput: string;
  redactionState?: ExecutionTerminalTitleRedactionState;
}

/**
 * Incremental state for removing OSC 0/2 payloads. The raw carryover is bounded; once an
 * unterminated payload exceeds the bound, only the discard mode is retained until its terminator.
 */
export interface ExecutionTerminalTitleRedactionState {
  carryover: string;
  discardingTitlePayload?: boolean;
}

export const EXECUTION_TERMINAL_TITLE_MAX_LENGTH = 160;

const TITLE_CARRYOVER_LIMIT = 512;
// NUL is ignored by terminal emulators while preserving one stream revision per PTY chunk.
const REDACTED_TERMINAL_TITLE_MARKER = '\u0000';

interface ScannedExecutionTerminalTitleControls {
  carryover: string;
  discardingTitlePayload: boolean;
  events: ExecutionTerminalTitleEvent[];
  titles: string[];
  output: string;
}

// OSC 0/2 and CSI 21 t are terminal control-plane messages, not screen output. Scan the
// combined carryover and current chunk so every control can be split at an arbitrary boundary.
function scanExecutionTerminalTitleControls(
  source: string,
  previousDiscardingTitlePayload = false
): ScannedExecutionTerminalTitleControls {
  const events: ExecutionTerminalTitleEvent[] = [];
  const titles: string[] = [];
  let output = '';
  let outputStart = 0;
  let index = 0;
  let discardingTitlePayload = previousDiscardingTitlePayload;

  if (discardingTitlePayload) {
    const discarded = consumeDiscardedTitlePayload(source, 0);
    index = discarded.index;
    if (discarded.status === 'incomplete') {
      return {
        carryover: discarded.carryover,
        discardingTitlePayload: true,
        events,
        titles,
        output: REDACTED_TERMINAL_TITLE_MARKER
      };
    }
    discardingTitlePayload = false;
    outputStart = index;
  }

  while (index < source.length) {
    const sequenceStart = index;
    const oscStartLength = getOscStartLength(source, index);
    if (oscStartLength > 0) {
      const identifierStart = index + oscStartLength;
      let payloadStart = identifierStart;
      while (payloadStart < source.length && isAsciiDigit(source[payloadStart])) {
        payloadStart += 1;
      }

      if (payloadStart >= source.length) {
        return finishIncompleteControl(
          source,
          output,
          outputStart,
          sequenceStart,
          source.slice(sequenceStart),
          events,
          titles,
          false
        );
      }

      const identifier = source.slice(identifierStart, payloadStart);
      if (
        (identifier !== '0' && identifier !== '2') ||
        source[payloadStart] !== ';'
      ) {
        // Leave non-title OSC controls untouched for xterm.js. Re-scan after the introducer so
        // a malformed sequence cannot make the remainder disappear.
        index = identifierStart;
        continue;
      }

      const titlePayloadStart = payloadStart + 1;
      const consumed = consumeTitlePayload(source, titlePayloadStart);
      if (consumed.status === 'incomplete') {
        const incomplete = source.slice(sequenceStart);
        if (incomplete.length > TITLE_CARRYOVER_LIMIT) {
          output += source.slice(outputStart, sequenceStart);
          output += REDACTED_TERMINAL_TITLE_MARKER;
          return {
            carryover: getTrailingEscapeCarryover(source),
            discardingTitlePayload: true,
            events,
            titles,
            output
          };
        }
        return finishIncompleteControl(
          source,
          output,
          outputStart,
          sequenceStart,
          incomplete,
          events,
          titles,
          false
        );
      }

      output += source.slice(outputStart, sequenceStart);
      output += REDACTED_TERMINAL_TITLE_MARKER;
      // Normalize while scanning so a very large completed payload is not copied into the
      // event list before the 160-code-point display limit is applied.
      const title = normalizeExecutionTerminalTitleRange(
        source,
        titlePayloadStart,
        consumed.payloadEnd
      ) ?? '';
      titles.push(title);
      events.push({ kind: 'set-title', title });
      index = consumed.index;
      outputStart = index;
      continue;
    }

    const csiStartLength = getCsiStartLength(source, index);
    if (csiStartLength > 0) {
      const queryStart = index + csiStartLength;
      const queryCandidate = source.slice(queryStart, queryStart + 3);
      if (queryCandidate === '21t') {
        output += source.slice(outputStart, sequenceStart);
        output += REDACTED_TERMINAL_TITLE_MARKER;
        events.push({ kind: 'query-title' });
        index = queryStart + 3;
        outputStart = index;
        continue;
      }

      const queryPrefix = source.slice(queryStart);
      if ('21t'.startsWith(queryPrefix)) {
        return finishIncompleteControl(
          source,
          output,
          outputStart,
          sequenceStart,
          source.slice(sequenceStart),
          events,
          titles,
          false
        );
      }

      // This is another CSI sequence. Preserve it for the terminal emulator.
      index = queryStart;
      continue;
    }

    if (source[index] === '\u001b' && index + 1 === source.length) {
      return finishIncompleteControl(
        source,
        output,
        outputStart,
        sequenceStart,
        source.slice(sequenceStart),
        events,
        titles,
        false
      );
    }

    index += 1;
  }

  output += source.slice(outputStart);
  return {
    carryover: '',
    discardingTitlePayload,
    events,
    titles,
    output
  };
}

function finishIncompleteControl(
  source: string,
  output: string,
  outputStart: number,
  sequenceStart: number,
  incomplete: string,
  events: ExecutionTerminalTitleEvent[],
  titles: string[],
  discardingTitlePayload: boolean
): ScannedExecutionTerminalTitleControls {
  return {
    carryover: incomplete.length <= TITLE_CARRYOVER_LIMIT ? incomplete : '',
    discardingTitlePayload,
    events,
    titles,
    output:
      output +
      source.slice(outputStart, sequenceStart) +
      REDACTED_TERMINAL_TITLE_MARKER
  };
}

// OSC 0/2 accepts BEL, C1 ST, or the 7-bit ESC \\ terminator.
function consumeTitlePayload(
  source: string,
  startIndex: number
): {
  index: number;
  payloadEnd: number;
  status: 'terminated' | 'incomplete';
} {
  let index = startIndex;
  while (index < source.length) {
    const current = source[index];
    if (current === '\u0007' || current === '\u009c') {
      return {
        index: index + 1,
        payloadEnd: index,
        status: 'terminated'
      };
    }
    if (current === '\u001b') {
      if (source[index + 1] === undefined) {
        return {
          index,
          payloadEnd: index,
          status: 'incomplete'
        };
      }
      if (source[index + 1] === '\\') {
        return {
          index: index + 2,
          payloadEnd: index,
          status: 'terminated'
        };
      }
    }
    index += 1;
  }

  return {
    index,
    payloadEnd: index,
    status: 'incomplete'
  };
}

function consumeDiscardedTitlePayload(
  source: string,
  startIndex: number
): {
  index: number;
  carryover: string;
  status: 'terminated' | 'incomplete';
} {
  let index = startIndex;
  while (index < source.length) {
    const current = source[index];
    if (current === '\u0007' || current === '\u009c') {
      return {
        index: index + 1,
        carryover: '',
        status: 'terminated'
      };
    }
    if (current === '\u001b') {
      if (source[index + 1] === undefined) {
        return {
          index,
          carryover: '\u001b',
          status: 'incomplete'
        };
      }
      if (source[index + 1] === '\\') {
        return {
          index: index + 2,
          carryover: '',
          status: 'terminated'
        };
      }
    }
    index += 1;
  }

  return {
    index,
    carryover: getTrailingEscapeCarryover(source),
    status: 'incomplete'
  };
}

function getTrailingEscapeCarryover(source: string): string {
  return source.endsWith('\u001b') ? '\u001b' : '';
}

export function parseExecutionTerminalTitles(
  chunk: string,
  previousCarryover = ''
): ParsedExecutionTerminalTitles {
  const scanned = scanExecutionTerminalTitleControls(`${previousCarryover}${chunk}`);
  return {
    carryover: scanned.carryover,
    titles: scanned.titles,
    events: scanned.events,
    discardingTitlePayload: scanned.discardingTitlePayload || undefined
  };
}

export function processExecutionTerminalTitleControls(
  chunk: string,
  previousTerminalTitle: string | undefined,
  previousCarryover = '',
  previousRedactionState?: ExecutionTerminalTitleRedactionState
): ProcessedExecutionTerminalTitleControls {
  const carryover = previousRedactionState?.carryover ?? previousCarryover;
  const source = `${carryover}${chunk}`;
  const scanned = scanExecutionTerminalTitleControls(
    source,
    previousRedactionState?.discardingTitlePayload === true
  );
  let terminalTitle = previousTerminalTitle;
  const titleQueries: Array<string | undefined> = [];
  for (const event of scanned.events) {
    if (event.kind === 'set-title') {
      terminalTitle = normalizeExecutionTerminalTitle(event.title);
    } else {
      titleQueries.push(terminalTitle);
    }
  }

  const terminalOutput =
    scanned.output || (chunk ? REDACTED_TERMINAL_TITLE_MARKER : '');
  const redactionState = createTerminalTitleRedactionState(
    scanned.carryover,
    scanned.discardingTitlePayload
  );
  return {
    carryover: scanned.carryover,
    terminalTitle,
    titleQueries,
    titleUpdated: scanned.events.some((event) => event.kind === 'set-title'),
    terminalOutput,
    redactionState
  };
}

export function redactExecutionTerminalTitleOutput(
  chunk: string,
  previousState?: ExecutionTerminalTitleRedactionState
): { output: string; state?: ExecutionTerminalTitleRedactionState } {
  const carryover = previousState?.carryover ?? '';
  const scanned = scanExecutionTerminalTitleControls(
    `${carryover}${chunk}`,
    previousState?.discardingTitlePayload === true
  );
  return {
    output: scanned.output || (chunk ? REDACTED_TERMINAL_TITLE_MARKER : ''),
    state: createTerminalTitleRedactionState(
      scanned.carryover,
      scanned.discardingTitlePayload
    )
  };
}

/**
 * Removes the invisible per-chunk marker used by the journal/revision path. It must not enter
 * summaries, recent-output metadata, heuristics, or diagnostic text.
 */
export function stripExecutionTerminalTitleMarkers(value: string): string {
  return value.replace(/\u0000/g, '');
}

export function formatExecutionTerminalTitleReport(terminalTitle: string | undefined): string {
  const normalizedTitle = normalizeExecutionTerminalTitle(terminalTitle ?? '');
  return `\u001b]l${normalizedTitle ?? ''}\u001b\\`;
}

export function normalizeExecutionTerminalTitle(title: string): string | undefined {
  return normalizeExecutionTerminalTitleRange(title, 0, title.length);
}

function normalizeExecutionTerminalTitleRange(
  source: string,
  startIndex: number,
  endIndex: number
): string | undefined {
  let normalized = '';
  let pendingWhitespace = false;
  let index = startIndex;

  while (index < endIndex) {
    const codePoint = source.codePointAt(index);
    if (codePoint === undefined) {
      break;
    }
    const character = String.fromCodePoint(codePoint);
    index += character.length;

    if (isTerminalControlCodePoint(codePoint)) {
      continue;
    }
    if (/\s/u.test(character)) {
      if (normalized) {
        pendingWhitespace = true;
      }
      continue;
    }

    if (pendingWhitespace) {
      normalized += ' ';
      pendingWhitespace = false;
    }
    normalized += character;
    if (Array.from(normalized).length >= EXECUTION_TERMINAL_TITLE_MAX_LENGTH) {
      return Array.from(normalized).slice(0, EXECUTION_TERMINAL_TITLE_MAX_LENGTH).join('');
    }
  }

  return normalized || undefined;
}

function createTerminalTitleRedactionState(
  carryover: string,
  discardingTitlePayload: boolean
): ExecutionTerminalTitleRedactionState | undefined {
  if (!carryover && !discardingTitlePayload) {
    return undefined;
  }
  return {
    carryover,
    discardingTitlePayload: discardingTitlePayload || undefined
  };
}

function getOscStartLength(source: string, index: number): number {
  if (source[index] === '\u001b' && source[index + 1] === ']') {
    return 2;
  }
  return source[index] === '\u009d' ? 1 : 0;
}

function getCsiStartLength(source: string, index: number): number {
  if (source[index] === '\u001b' && source[index + 1] === '[') {
    return 2;
  }
  return source[index] === '\u009b' ? 1 : 0;
}

function isAsciiDigit(value: string | undefined): boolean {
  return value !== undefined && value >= '0' && value <= '9';
}

function isTerminalControlCodePoint(codePoint: number): boolean {
  return (codePoint >= 0 && codePoint <= 0x1f) || (codePoint >= 0x7f && codePoint <= 0x9f);
}
