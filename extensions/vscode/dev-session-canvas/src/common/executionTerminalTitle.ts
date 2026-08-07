export interface ParsedExecutionTerminalTitles {
  carryover: string;
  titles: string[];
}

export const EXECUTION_TERMINAL_TITLE_MAX_LENGTH = 160;

const TITLE_CARRYOVER_LIMIT = 512;

// OSC 0 and OSC 2 update terminal chrome, rather than terminal screen text.
// Parse them incrementally because node-pty chunks can split every byte boundary.
export function parseExecutionTerminalTitles(
  chunk: string,
  previousCarryover = ''
): ParsedExecutionTerminalTitles {
  const source = `${previousCarryover}${chunk}`;
  const titles: string[] = [];
  let carryover = '';
  let index = 0;

  while (index < source.length) {
    const sequenceStart = index;
    const oscStartLength = getOscStartLength(source, index);
    if (oscStartLength === 0) {
      if (source[index] === '\u001b' && index + 1 === source.length) {
        // The OSC introducer may be split as ESC | ].
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
      index = Math.max(index + 1, sequenceStart + oscStartLength);
      continue;
    }
    if (!terminated) {
      carryover = source.slice(sequenceStart);
      break;
    }

    const title = source.slice(payloadStart, payloadEnd);
    if (title.length <= TITLE_CARRYOVER_LIMIT) {
      titles.push(title);
    }
  }

  return {
    carryover: trimCarryover(carryover),
    titles
  };
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

function isAsciiDigit(value: string | undefined): boolean {
  return value !== undefined && value >= '0' && value <= '9';
}

function isTerminalControlCharacter(value: string): boolean {
  const codePoint = value.codePointAt(0) ?? 0;
  return (codePoint >= 0 && codePoint <= 0x1f) || (codePoint >= 0x7f && codePoint <= 0x9f);
}

function trimCarryover(value: string): string {
  return value.length <= TITLE_CARRYOVER_LIMIT ? value : '';
}
