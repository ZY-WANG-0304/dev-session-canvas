export interface ParsedExecutionTerminalTitles {
  carryover: string;
  titles: string[];
  events: ExecutionTerminalTitleEvent[];
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
 * State for omitting OSC 0/2 payloads from durable terminal output. The payload carryover is
 * bounded; once it exceeds the parser limit, only the fact that it is being discarded remains.
 */
export interface ExecutionTerminalTitleRedactionState {
  carryover: string;
  discardingTitlePayload?: boolean;
}

export const EXECUTION_TERMINAL_TITLE_MAX_LENGTH = 160;

const TITLE_CARRYOVER_LIMIT = 512;
// NUL is ignored by terminal emulators while preserving one stream revision per PTY chunk.
const REDACTED_TERMINAL_TITLE_MARKER = '\u0000';

// OSC 0 and OSC 2 update terminal chrome, rather than terminal screen text.
// Parse them incrementally because node-pty chunks can split every byte boundary.
export function parseExecutionTerminalTitles(
  chunk: string,
  previousCarryover = ''
): ParsedExecutionTerminalTitles {
  const source = `${previousCarryover}${chunk}`;
  const titles: string[] = [];
  const events: ExecutionTerminalTitleEvent[] = [];
  let carryover = '';
  let index = 0;

  while (index < source.length) {
    const sequenceStart = index;
    const oscStartLength = getOscStartLength(source, index);
    if (oscStartLength === 0) {
      if (source[index] === '\u001b' && index + 1 === source.length) {
        // An OSC or CSI introducer may be split after ESC.
        carryover = source.slice(index);
        break;
      }
      const csiStartLength = getCsiStartLength(source, index);
      if (csiStartLength === 0) {
        index += 1;
        continue;
      }

      const queryStart = index + csiStartLength;
      const queryCandidate = source.slice(queryStart, queryStart + 3);
      if (queryCandidate === '21t') {
        events.push({ kind: 'query-title' });
        index = queryStart + 3;
        continue;
      }
      const remainingCandidate = source.slice(queryStart);
      if ('21t'.startsWith(remainingCandidate)) {
        carryover = source.slice(sequenceStart);
        break;
      }
      index = queryStart;
      continue;
    }
    index += oscStartLength;

    let identifier = '';
    while (index < source.length && isAsciiDigit(source[index])) {
      identifier += source[index];
      index += 1;
    }
    if (index >= source.length) {
      carryover = source.slice(sequenceStart);
      break;
    }
    if ((identifier !== '0' && identifier !== '2') || source[index] !== ';') {
      index = sequenceStart + oscStartLength;
      continue;
    }
    index += 1;

    const payloadStart = index;
    let payloadEnd = index;
    let terminated = false;
    let invalid = false;
    while (index < source.length) {
      const current = source[index];
      if (current === '\u0007' || current === '\u009c') {
        payloadEnd = index;
        index += 1;
        terminated = true;
        break;
      }
      if (current === '\u001b') {
        if (source[index + 1] === undefined) {
          // Keep a split ST (ESC | \\) with its OSC payload for the next chunk.
          break;
        }
        if (source[index + 1] === '\\') {
          payloadEnd = index;
          index += 2;
          terminated = true;
          break;
        }
        invalid = true;
        break;
      }
      if (isTerminalControlCharacter(current)) {
        invalid = true;
        break;
      }
      index += 1;
    }

    if (invalid) {
      // Reconsider the invalid control introducer as a possible next sequence.
      index = Math.max(index, sequenceStart + oscStartLength);
      continue;
    }
    if (!terminated) {
      carryover = source.slice(sequenceStart);
      break;
    }

    const title = source.slice(payloadStart, payloadEnd);
    if (title.length <= TITLE_CARRYOVER_LIMIT) {
      titles.push(title);
      events.push({ kind: 'set-title', title });
    }
  }

  return {
    carryover: trimCarryover(carryover),
    titles,
    events
  };
}

export function processExecutionTerminalTitleControls(
  chunk: string,
  previousTerminalTitle: string | undefined,
  previousCarryover = '',
  previousRedactionState?: ExecutionTerminalTitleRedactionState
): ProcessedExecutionTerminalTitleControls {
  const parsed = parseExecutionTerminalTitles(chunk, previousCarryover);
  const redacted = redactExecutionTerminalTitleOutput(chunk, previousRedactionState);
  let terminalTitle = previousTerminalTitle;
  const titleQueries: Array<string | undefined> = [];
  let titleUpdated = false;

  for (const event of parsed.events) {
    if (event.kind === 'set-title') {
      terminalTitle = normalizeExecutionTerminalTitle(event.title);
      titleUpdated = true;
    } else {
      titleQueries.push(terminalTitle);
    }
  }

  return {
    carryover: parsed.carryover,
    terminalTitle,
    titleQueries,
    titleUpdated,
    terminalOutput: redacted.output,
    redactionState: redacted.state
  };
}

/**
 * Removes OSC 0/2 title payloads before output is retained or replayed. A NUL marker keeps a
 * terminal-stream event non-empty, so its revision cannot create a gap for downstream consumers.
 */
export function redactExecutionTerminalTitleOutput(
  chunk: string,
  previousState?: ExecutionTerminalTitleRedactionState
): { output: string; state?: ExecutionTerminalTitleRedactionState } {
  const source = `${previousState?.carryover ?? ''}${chunk}`;
  let output = '';
  let outputStart = 0;
  let index = 0;
  let carryover = '';
  let discardingTitlePayload = previousState?.discardingTitlePayload === true;

  if (discardingTitlePayload) {
    output += REDACTED_TERMINAL_TITLE_MARKER;
    const discarded = consumeRedactedTitlePayload(source, index);
    index = discarded.index;
    if (discarded.status === 'incomplete') {
      carryover = discarded.carryover;
      return finalizeRedactedTerminalTitleOutput(
        output,
        chunk,
        createTerminalTitleRedactionState(carryover, true)
      );
    }
    discardingTitlePayload = false;
    outputStart = index;
  }

  while (index < source.length) {
    const sequenceStart = index;
    const oscStartLength = getOscStartLength(source, index);
    if (oscStartLength === 0) {
      if (source[index] === '\u001b' && index + 1 === source.length) {
        output += source.slice(outputStart, index);
        carryover = source.slice(index);
        break;
      }
      index += 1;
      continue;
    }

    index += oscStartLength;
    let identifier = '';
    while (index < source.length && isAsciiDigit(source[index])) {
      identifier += source[index];
      index += 1;
    }
    if (index >= source.length) {
      output += source.slice(outputStart, sequenceStart);
      carryover = source.slice(sequenceStart);
      break;
    }
    if ((identifier !== '0' && identifier !== '2') || source[index] !== ';') {
      index = sequenceStart + oscStartLength;
      continue;
    }

    output += source.slice(outputStart, sequenceStart);
    output += REDACTED_TERMINAL_TITLE_MARKER;
    index += 1;
    const payloadStart = index;
    const consumed = consumeRedactedTitlePayload(source, index, payloadStart);
    index = consumed.index;
    if (consumed.status === 'incomplete') {
      if (consumed.discardingTitlePayload) {
        return finalizeRedactedTerminalTitleOutput(
          output,
          chunk,
          createTerminalTitleRedactionState(consumed.carryover, true)
        );
      }
      carryover = source.slice(sequenceStart);
      break;
    }
    outputStart = index;
  }

  if (!carryover) {
    output += source.slice(outputStart);
  }
  return finalizeRedactedTerminalTitleOutput(
    output,
    chunk,
    createTerminalTitleRedactionState(carryover, discardingTitlePayload)
  );
}

export function formatExecutionTerminalTitleReport(terminalTitle: string | undefined): string {
  const normalizedTitle = normalizeExecutionTerminalTitle(terminalTitle ?? '');
  return `\u001b]l${normalizedTitle ?? ''}\u001b\\`;
}

export function normalizeExecutionTerminalTitle(title: string): string | undefined {
  const normalized = title
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .replace(/\s+/gu, ' ')
    .trim();
  if (!normalized) {
    return undefined;
  }

  return Array.from(normalized).slice(0, EXECUTION_TERMINAL_TITLE_MAX_LENGTH).join('');
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

function isTerminalControlCharacter(value: string): boolean {
  const codePoint = value.codePointAt(0) ?? 0;
  return (codePoint >= 0 && codePoint <= 0x1f) || (codePoint >= 0x7f && codePoint <= 0x9f);
}

function consumeRedactedTitlePayload(
  source: string,
  startIndex: number,
  payloadStart = startIndex
): {
  index: number;
  status: 'terminated' | 'invalid' | 'incomplete';
  carryover: string;
  discardingTitlePayload: boolean;
} {
  let index = startIndex;
  let discardingTitlePayload = false;
  while (index < source.length) {
    const current = source[index];
    if (current === '\u0007' || current === '\u009c') {
      return { index: index + 1, status: 'terminated', carryover: '', discardingTitlePayload };
    }
    if (current === '\u001b') {
      if (source[index + 1] === undefined) {
        return {
          index,
          status: 'incomplete',
          carryover: discardingTitlePayload ? '\u001b' : '',
          discardingTitlePayload
        };
      }
      if (source[index + 1] === '\\') {
        return { index: index + 2, status: 'terminated', carryover: '', discardingTitlePayload };
      }
      return { index, status: 'invalid', carryover: '', discardingTitlePayload };
    }
    if (isTerminalControlCharacter(current)) {
      return { index, status: 'invalid', carryover: '', discardingTitlePayload };
    }
    index += 1;
    if (index - payloadStart > TITLE_CARRYOVER_LIMIT) {
      discardingTitlePayload = true;
    }
  }
  return {
    index,
    status: 'incomplete',
    carryover: '',
    discardingTitlePayload
  };
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

function finalizeRedactedTerminalTitleOutput(
  output: string,
  chunk: string,
  state: ExecutionTerminalTitleRedactionState | undefined
): { output: string; state?: ExecutionTerminalTitleRedactionState } {
  return {
    // node-pty may split an OSC introducer at any byte boundary. The journal requires a record
    // for every raw chunk, so retain an invisible marker until the sequence can be classified.
    output: output || (chunk ? REDACTED_TERMINAL_TITLE_MARKER : ''),
    state
  };
}

function trimCarryover(value: string): string {
  return value.length <= TITLE_CARRYOVER_LIMIT ? value : '';
}
