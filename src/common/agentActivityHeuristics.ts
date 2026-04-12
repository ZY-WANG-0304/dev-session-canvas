export interface AgentActivityHeuristicState {
  lastOutputAtMs?: number;
  lastLineBoundaryAtMs?: number;
  lastPromptAtMs?: number;
  lastNotificationAtMs?: number;
  lastBellAtMs?: number;
  lastSpinnerAtMs?: number;
  oscCarryover: string;
}

export type AgentWaitingInputTransitionReason =
  | 'prompt'
  | 'notification'
  | 'line-boundary'
  | 'fallback';

export interface AgentOutputHeuristicSnapshot {
  sawBell: boolean;
  sawNotification: boolean;
  sawPrompt: boolean;
  sawSpinner: boolean;
  sawLineBoundary: boolean;
}

export interface AgentWaitingInputEvaluation {
  shouldTransition: boolean;
  shouldKeepPolling: boolean;
  reason?: AgentWaitingInputTransitionReason;
}

export const AGENT_WAITING_INPUT_POLL_INTERVAL_MS = 120;

const AGENT_WAITING_INPUT_PROMPT_QUIET_MS = 220;
const AGENT_WAITING_INPUT_NOTIFICATION_QUIET_MS = 260;
const AGENT_WAITING_INPUT_LINE_BOUNDARY_QUIET_MS = 420;
const AGENT_WAITING_INPUT_HARD_FALLBACK_MS = 1600;
const AGENT_WAITING_INPUT_SPINNER_GRACE_MS = 900;
const OSC_CARRYOVER_LIMIT = 256;
const PROMPT_TAIL_LIMIT = 256;

const AGENT_SPINNER_REDRAW_PATTERN = /(?:\r(?!\n)|\u0008|\u001b\[[0-9;?]*[ABCDGHJKfhlmnrsu])/u;
const AGENT_SPINNER_GLYPH_PATTERN = /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏◐◓◑◒]/u;
const AGENT_PROMPT_PATTERN = /(?:^|\n)\s{0,4}(?:>|›|❯|≫|»)\s*$/u;

export function createAgentActivityHeuristicState(): AgentActivityHeuristicState {
  return {
    oscCarryover: ''
  };
}

export function resetAgentActivityHeuristics(
  state: AgentActivityHeuristicState
): AgentActivityHeuristicState {
  state.lastOutputAtMs = undefined;
  state.lastLineBoundaryAtMs = undefined;
  state.lastPromptAtMs = undefined;
  state.lastNotificationAtMs = undefined;
  state.lastBellAtMs = undefined;
  state.lastSpinnerAtMs = undefined;
  state.oscCarryover = '';
  return state;
}

export function recordAgentOutputHeuristics(
  state: AgentActivityHeuristicState,
  chunk: string,
  buffer: string,
  now: number = Date.now()
): AgentOutputHeuristicSnapshot {
  state.lastOutputAtMs = now;

  const attentionSignals = parseAttentionSignals(chunk, state.oscCarryover);
  state.oscCarryover = attentionSignals.carryover;
  if (attentionSignals.notificationCount > 0) {
    state.lastNotificationAtMs = now;
  }
  if (attentionSignals.bellCount > 0) {
    state.lastBellAtMs = now;
  }

  const strippedChunk = stripTerminalControlSequences(chunk);
  const normalizedChunk = strippedChunk.replace(/\r/g, '');
  const sawSpinner =
    AGENT_SPINNER_REDRAW_PATTERN.test(chunk) || AGENT_SPINNER_GLYPH_PATTERN.test(normalizedChunk);
  if (sawSpinner) {
    state.lastSpinnerAtMs = now;
  }

  const sawLineBoundary = /(?:\r?\n)\s*$/.test(normalizedChunk);
  const hasVisibleChunkContent = normalizedChunk.trim().length > 0;
  if (sawLineBoundary) {
    state.lastLineBoundaryAtMs = now;
  } else if (hasVisibleChunkContent && !sawSpinner) {
    state.lastLineBoundaryAtMs = undefined;
  }

  const promptTail = stripTerminalControlSequences(buffer).replace(/\r/g, '').slice(-PROMPT_TAIL_LIMIT);
  const sawPrompt = AGENT_PROMPT_PATTERN.test(promptTail);
  if (sawPrompt) {
    state.lastPromptAtMs = now;
  } else if (hasVisibleChunkContent) {
    state.lastPromptAtMs = undefined;
  }

  return {
    sawBell: attentionSignals.bellCount > 0,
    sawNotification: attentionSignals.notificationCount > 0,
    sawPrompt,
    sawSpinner,
    sawLineBoundary
  };
}

export function evaluateAgentWaitingInputTransition(
  state: AgentActivityHeuristicState,
  now: number = Date.now()
): AgentWaitingInputEvaluation {
  if (typeof state.lastOutputAtMs !== 'number') {
    return {
      shouldTransition: false,
      shouldKeepPolling: false
    };
  }

  const quietMs = now - state.lastOutputAtMs;
  const spinnerRecentlyActive =
    typeof state.lastSpinnerAtMs === 'number' &&
    now - state.lastSpinnerAtMs < AGENT_WAITING_INPUT_SPINNER_GRACE_MS;

  if (typeof state.lastPromptAtMs === 'number' && quietMs >= AGENT_WAITING_INPUT_PROMPT_QUIET_MS) {
    return {
      shouldTransition: true,
      shouldKeepPolling: false,
      reason: 'prompt'
    };
  }

  if (
    !spinnerRecentlyActive &&
    (typeof state.lastNotificationAtMs === 'number' || typeof state.lastBellAtMs === 'number') &&
    quietMs >= AGENT_WAITING_INPUT_NOTIFICATION_QUIET_MS
  ) {
    return {
      shouldTransition: true,
      shouldKeepPolling: false,
      reason: 'notification'
    };
  }

  if (
    !spinnerRecentlyActive &&
    typeof state.lastLineBoundaryAtMs === 'number' &&
    quietMs >= AGENT_WAITING_INPUT_LINE_BOUNDARY_QUIET_MS
  ) {
    return {
      shouldTransition: true,
      shouldKeepPolling: false,
      reason: 'line-boundary'
    };
  }

  if (!spinnerRecentlyActive && quietMs >= AGENT_WAITING_INPUT_HARD_FALLBACK_MS) {
    return {
      shouldTransition: true,
      shouldKeepPolling: false,
      reason: 'fallback'
    };
  }

  return {
    shouldTransition: false,
    shouldKeepPolling: true
  };
}

export function stripTerminalControlSequences(value: string): string {
  return value
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, '')
    .replace(/\u001b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');
}

function parseAttentionSignals(
  chunk: string,
  previousCarryover: string
): { carryover: string; notificationCount: number; bellCount: number } {
  const source = `${previousCarryover}${chunk}`;
  let notificationCount = 0;
  let bellCount = 0;
  let carryover = '';
  let index = 0;

  while (index < source.length) {
    if (source[index] === '\u001b' && source[index + 1] === ']') {
      const sequenceStart = index;
      index += 2;

      let identifier = '';
      while (index < source.length && /[0-9]/.test(source[index] ?? '')) {
        identifier += source[index];
        index += 1;
      }

      if (index >= source.length) {
        carryover = source.slice(sequenceStart);
        break;
      }

      if (source[index] !== ';') {
        index = sequenceStart + 1;
        continue;
      }

      index += 1;
      let terminated = false;
      while (index < source.length) {
        if (source[index] === '\u0007') {
          terminated = true;
          index += 1;
          break;
        }
        if (source[index] === '\u001b' && source[index + 1] === '\\') {
          terminated = true;
          index += 2;
          break;
        }
        index += 1;
      }

      if (!terminated) {
        carryover = source.slice(sequenceStart);
        break;
      }

      if (identifier === '9' || identifier === '777') {
        notificationCount += 1;
      }
      continue;
    }

    if (source[index] === '\u0007') {
      bellCount += 1;
    }

    index += 1;
  }

  if (!carryover) {
    carryover = extractTrailingOscCarryover(source);
  }

  return {
    carryover: trimOscCarryover(carryover),
    notificationCount,
    bellCount
  };
}

function extractTrailingOscCarryover(source: string): string {
  if (source.endsWith('\u001b')) {
    return '\u001b';
  }

  const oscIndex = source.lastIndexOf('\u001b]');
  if (oscIndex < 0) {
    return '';
  }

  const candidate = source.slice(oscIndex);
  if (candidate.includes('\u0007') || candidate.includes('\u001b\\')) {
    return '';
  }

  return candidate;
}

function trimOscCarryover(value: string): string {
  return value.length > OSC_CARRYOVER_LIMIT ? value.slice(-OSC_CARRYOVER_LIMIT) : value;
}
