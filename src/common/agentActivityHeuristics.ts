import type { AgentProviderKind } from './protocol';
import { parseExecutionAttentionSignals } from './executionAttentionSignals';

export interface AgentActivityHeuristicState {
  lastOutputAtMs?: number;
  lastLineBoundaryAtMs?: number;
  lastPromptAtMs?: number;
  lastNotificationAtMs?: number;
  lastBellAtMs?: number;
  lastSpinnerAtMs?: number;
  lastAbnormalStreamAtMs?: number;
  lastAbnormalStreamMessage?: string;
  lastAbnormalStreamSignature?: string;
  lastAbnormalStreamScanLength?: number;
  abnormalStreamCarryover?: string;
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
  sawAbnormalStreamInterruption: boolean;
  abnormalStreamInterruptionMessage?: string;
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
const ABNORMAL_STREAM_TAIL_LIMIT = 1200;
const ABNORMAL_STREAM_CARRYOVER_LIMIT = 320;

const AGENT_SPINNER_REDRAW_PATTERN = /(?:\r(?!\n)|\u0008|\u001b\[[0-9;?]*[ABCDGHJKfhlmnrsu])/u;
const AGENT_SPINNER_GLYPH_PATTERN = /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏◐◓◑◒]/u;
const AGENT_PROMPT_PATTERN = /(?:^|\n)\s{0,4}(?:>|›|❯|≫|»)\s*$/u;

interface AgentAbnormalStreamInterruptionMatch {
  message: string;
}

const CODEX_FINAL_ERROR_MARKER_PATTERN = /^\s*■\s+/u;
const CODEX_TAIL_PROMPT_PATTERN = /^\s{0,4}(?:›.*|[>❯≫»](?:\s+.*)?)$/u;
const CODEX_TAIL_STATUS_FOOTER_PATTERN = /^(?:gpt|o\d|codex)[\w.-]*(?:\s+[\w.-]+){0,4}\s+·\s+\S.*$/iu;
// Keep this list limited to Codex TUI final-error lines rendered with the
// leading square marker at the tail. Reconnecting tree lines are retry progress.
const CODEX_FINAL_ERROR_MESSAGE_PATTERNS: RegExp[] = [
  /stream\s+disconnected\s+before\s+completion.*stream\s+closed\s+before\s+response\.completed/iu,
  /\{\s*"error"\s*:\s*\{[^{}]*"message"\s*:\s*"internal server error"[^{}]*\}\s*\}/iu
];

interface AgentAbnormalStreamTailLine {
  end: number;
  line: string;
}

export function createAgentActivityHeuristicState(): AgentActivityHeuristicState {
  return {
    oscCarryover: ''
  };
}

export function resetAgentActivityHeuristics(
  state: AgentActivityHeuristicState,
  currentBuffer?: string
): AgentActivityHeuristicState {
  state.lastOutputAtMs = undefined;
  state.lastLineBoundaryAtMs = undefined;
  state.lastPromptAtMs = undefined;
  state.lastNotificationAtMs = undefined;
  state.lastBellAtMs = undefined;
  state.lastSpinnerAtMs = undefined;
  resetAgentAbnormalStreamInterruptionHeuristics(state, currentBuffer);
  state.oscCarryover = '';
  return state;
}

export function resetAgentAbnormalStreamInterruptionHeuristics(
  state: AgentActivityHeuristicState,
  currentBuffer?: string
): AgentActivityHeuristicState {
  state.lastAbnormalStreamAtMs = undefined;
  state.lastAbnormalStreamMessage = undefined;
  state.lastAbnormalStreamSignature = undefined;
  state.lastAbnormalStreamScanLength =
    typeof currentBuffer === 'string'
      ? stripTerminalControlSequences(currentBuffer).replace(/\r/g, '').length
      : undefined;
  state.abnormalStreamCarryover = undefined;
  return state;
}

export function recordAgentOutputHeuristics(
  state: AgentActivityHeuristicState,
  chunk: string,
  buffer: string,
  provider?: AgentProviderKind,
  now: number = Date.now()
): AgentOutputHeuristicSnapshot {
  state.lastOutputAtMs = now;
  const strippedBuffer = stripTerminalControlSequences(buffer).replace(/\r/g, '');

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

  const promptTail = strippedBuffer.slice(-PROMPT_TAIL_LIMIT);
  const sawPrompt = AGENT_PROMPT_PATTERN.test(promptTail);
  if (sawPrompt) {
    state.lastPromptAtMs = now;
  } else if (hasVisibleChunkContent) {
    state.lastPromptAtMs = undefined;
  }

  const abnormalStreamScanStart = state.lastAbnormalStreamScanLength ?? 0;
  const abnormalStreamNewOutput =
    strippedBuffer.length > abnormalStreamScanStart
      ? strippedBuffer.slice(abnormalStreamScanStart)
      : normalizedChunk;
  const previousAbnormalStreamCarryover = state.abnormalStreamCarryover ?? '';
  const abnormalStreamScanText = `${previousAbnormalStreamCarryover}${abnormalStreamNewOutput}`;
  const abnormalStreamInterruptions = provider
    ? extractAgentAbnormalStreamInterruptions(
        abnormalStreamScanText,
        provider,
        0,
        previousAbnormalStreamCarryover.length
      )
    : undefined;
  if (provider) {
    state.lastAbnormalStreamScanLength = strippedBuffer.length;
    state.abnormalStreamCarryover = abnormalStreamScanText.slice(-ABNORMAL_STREAM_CARRYOVER_LIMIT);
  }
  let sawAbnormalStreamInterruption = false;
  let abnormalStreamInterruptionMessage: string | undefined;
  for (const abnormalStreamInterruption of abnormalStreamInterruptions ?? []) {
    const abnormalStreamSignature = normalizeAgentAbnormalStreamInterruptionSignature(
      abnormalStreamInterruption.message
    );
    state.lastAbnormalStreamAtMs = now;
    state.lastAbnormalStreamMessage = abnormalStreamInterruption.message;
    if (abnormalStreamSignature === state.lastAbnormalStreamSignature) {
      continue;
    }
    sawAbnormalStreamInterruption = true;
    abnormalStreamInterruptionMessage = abnormalStreamInterruption.message;
    state.lastAbnormalStreamSignature = abnormalStreamSignature;
  }

  return {
    sawBell: attentionSignals.bellCount > 0,
    sawNotification: attentionSignals.notificationCount > 0,
    sawPrompt,
    sawSpinner,
    sawLineBoundary,
    sawAbnormalStreamInterruption,
    abnormalStreamInterruptionMessage
  };
}

export function extractAgentAbnormalStreamInterruptionMessage(
  output: string,
  provider: AgentProviderKind = 'codex',
  scanStart = 0
): string | undefined {
  return extractAgentAbnormalStreamInterruptions(output, provider, scanStart).at(-1)?.message;
}

function extractAgentAbnormalStreamInterruptions(
  output: string,
  provider: AgentProviderKind = 'codex',
  scanStart = 0,
  minMatchEndOffset = 0
): AgentAbnormalStreamInterruptionMatch[] {
  if (provider !== 'codex') {
    return [];
  }

  const stripped = stripTerminalControlSequences(output).replace(/\r/g, '');
  const safeScanStart = Math.min(Math.max(0, scanStart), stripped.length);
  const tailStart = Math.max(safeScanStart, stripped.length - ABNORMAL_STREAM_TAIL_LIMIT);
  const tail = stripped.slice(tailStart);
  const tailLines: AgentAbnormalStreamTailLine[] = [];
  let lineStart = tailStart;

  for (const rawLine of tail.split('\n')) {
    const lineEnd = lineStart + rawLine.length;
    const line = rawLine.trim();
    if (line) {
      tailLines.push({
        end: lineEnd,
        line
      });
    }
    lineStart = lineEnd + 1;
  }

  const candidate = getTailCodexFinalErrorLine(tailLines);
  if (!candidate || candidate.end <= minMatchEndOffset) {
    return [];
  }

  return isCodexFinalErrorLine(candidate.line)
    ? [
        {
          message: candidate.line.length > 240 ? `${candidate.line.slice(0, 240)}...` : candidate.line
        }
      ]
    : [];
}

export function normalizeAgentAbnormalStreamInterruptionSignature(message: string): string {
  return message.replace(/\s+/g, ' ').trim().toLowerCase();
}

function getTailCodexFinalErrorLine(
  tailLines: AgentAbnormalStreamTailLine[]
): AgentAbnormalStreamTailLine | undefined {
  for (let index = tailLines.length - 1; index >= 0; index -= 1) {
    const candidate = tailLines[index];
    if (isCodexFinalErrorLine(candidate.line)) {
      return candidate;
    }

    if (isIgnorableCodexTrailingChromeLine(candidate.line)) {
      continue;
    }

    return undefined;
  }

  return undefined;
}

function isIgnorableCodexTrailingChromeLine(line: string): boolean {
  return CODEX_TAIL_PROMPT_PATTERN.test(line) || CODEX_TAIL_STATUS_FOOTER_PATTERN.test(line);
}

function isCodexFinalErrorLine(line: string): boolean {
  if (!CODEX_FINAL_ERROR_MARKER_PATTERN.test(line)) {
    return false;
  }
  const message = line.replace(CODEX_FINAL_ERROR_MARKER_PATTERN, '');
  return CODEX_FINAL_ERROR_MESSAGE_PATTERNS.some((pattern) => pattern.test(message));
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
