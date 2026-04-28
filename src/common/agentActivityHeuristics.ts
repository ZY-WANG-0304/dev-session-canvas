import { parseExecutionAttentionSignals } from './executionAttentionSignals';

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
const AGENT_WAITING_INPUT_HARD_FALLBACK_MS = 1600;
const AGENT_WAITING_INPUT_SPINNER_GRACE_MS = 900;
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

  const attentionSignals = parseExecutionAttentionSignals(chunk, state.oscCarryover);
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

  // A plain newline is not enough to conclude that an agent turn finished.
  // Long-running tasks may print one full line and then continue working.
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
    // Some PTYs emit 8-bit C1 CSI/OSC controls instead of ESC-prefixed sequences.
    .replace(/(?:\u001b\]|\u009d)[^\u0007\u001b\u009c]*(?:\u0007|\u001b\\|\u009c)?/g, '')
    .replace(/(?:\u001b\[|\u009b)[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\u001b[@-Z\\-_]/g, '')
    .replace(/[\u0080-\u009f]/g, '');
}
