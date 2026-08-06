import type { AgentProviderKind } from './protocol';

export interface AgentTerminalTitleActivityState {
  carryover: string;
  lastFrame?: string;
  lastFrameAtMs?: number;
}

export interface ParsedAgentTerminalTitles {
  carryover: string;
  titles: string[];
}

export const AGENT_TERMINAL_TITLE_FRAME_GAP_MS = 2500;

const TITLE_CARRYOVER_LIMIT = 512;
const CODEX_ACTIVITY_FRAMES = new Set(['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']);
const CLAUDE_ACTIVITY_FRAMES = new Set(['⠂', '⠐']);

export function createAgentTerminalTitleActivityState(): AgentTerminalTitleActivityState {
  return { carryover: '' };
}

export function resetAgentTerminalTitleActivityState(
  state: AgentTerminalTitleActivityState
): AgentTerminalTitleActivityState {
  state.carryover = '';
  state.lastFrame = undefined;
  state.lastFrameAtMs = undefined;
  return state;
}

// OSC 0 and OSC 2 are transport for terminal chrome, not terminal screen text.
// Keep titles in process memory only and return them directly to the classifier.
export function parseAgentTerminalTitles(
  chunk: string,
  previousCarryover = ''
): ParsedAgentTerminalTitles {
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
          // Keep a split ST (ESC | \) with its OSC payload for the next chunk.
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

export function recordAgentTerminalTitleActivity(
  state: AgentTerminalTitleActivityState,
  provider: AgentProviderKind | undefined,
  titles: readonly string[],
  now = Date.now()
): boolean {
  let sawActivity = false;
  for (const title of titles) {
    const frame = extractAgentTerminalTitleActivityFrame(provider, title);
    if (!frame) {
      continue;
    }
    const isAnimated =
      state.lastFrame !== undefined &&
      state.lastFrame !== frame &&
      typeof state.lastFrameAtMs === 'number' &&
      now - state.lastFrameAtMs >= 0 &&
      now - state.lastFrameAtMs <= AGENT_TERMINAL_TITLE_FRAME_GAP_MS;
    state.lastFrame = frame;
    state.lastFrameAtMs = now;
    sawActivity ||= isAnimated;
  }
  return sawActivity;
}

export function extractAgentTerminalTitleActivityFrame(
  provider: AgentProviderKind | undefined,
  title: string
): string | undefined {
  const firstGlyph = [...title.trimStart()][0];
  if (!firstGlyph) {
    return undefined;
  }
  if (provider === 'codex' && CODEX_ACTIVITY_FRAMES.has(firstGlyph)) {
    return firstGlyph;
  }
  if (provider === 'claude' && CLAUDE_ACTIVITY_FRAMES.has(firstGlyph)) {
    return firstGlyph;
  }
  return undefined;
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
