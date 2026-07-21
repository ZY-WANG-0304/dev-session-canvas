import type { AgentProviderKind } from './protocol';
import { parseExecutionAttentionSignals } from './executionAttentionSignals';

export interface AgentActivityHeuristicState {
  lastActivityAtMs?: number;
  lastInputAtMs?: number;
  bottomScreenSignature?: string;
  bottomScreenChangeStreak: number;
  lastBottomScreenChangeAtMs?: number;
  lastStrongBottomActivityAtMs?: number;
  lastAbnormalStreamAtMs?: number;
  lastAbnormalStreamMessage?: string;
  lastAbnormalStreamSignature?: string;
  lastAbnormalStreamScanLength?: number;
  abnormalStreamCarryover?: string;
  oscCarryover: string;
}

export type AgentWaitingInputTransitionReason = 'fallback';

export interface AgentOutputHeuristicSnapshot {
  sawBell: boolean;
  sawNotification: boolean;
  sawAbnormalStreamInterruption: boolean;
  abnormalStreamInterruptionMessage?: string;
}

export interface AgentBottomScreenActivitySnapshot {
  changed: boolean;
  strongRunningEvidence: boolean;
}

export interface AgentWaitingInputEvaluation {
  shouldTransition: boolean;
  shouldKeepPolling: boolean;
  reason?: AgentWaitingInputTransitionReason;
}

export const AGENT_WAITING_INPUT_POLL_INTERVAL_MS = 120;
export const AGENT_WAITING_INPUT_QUIET_FALLBACK_MS = 5000;

const AGENT_BOTTOM_ACTIVITY_INPUT_ECHO_SUPPRESSION_MS = 600;
const AGENT_BOTTOM_ACTIVITY_SEQUENCE_GAP_MS = 1000;
const AGENT_BOTTOM_ACTIVITY_GRACE_MS = 1200;
const AGENT_BOTTOM_ACTIVITY_REQUIRED_CHANGES = 2;
const ABNORMAL_STREAM_TAIL_LIMIT = 1200;
const ABNORMAL_STREAM_CARRYOVER_LIMIT = 320;

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
  start: number;
}

export function createAgentActivityHeuristicState(): AgentActivityHeuristicState {
  return {
    bottomScreenChangeStreak: 0,
    oscCarryover: ''
  };
}

export function resetAgentActivityHeuristics(
  state: AgentActivityHeuristicState,
  currentBuffer?: string,
  activityStartedAtMs?: number
): AgentActivityHeuristicState {
  state.lastActivityAtMs = activityStartedAtMs;
  state.lastInputAtMs = activityStartedAtMs;
  state.bottomScreenSignature = undefined;
  state.bottomScreenChangeStreak = 0;
  state.lastBottomScreenChangeAtMs = undefined;
  state.lastStrongBottomActivityAtMs = undefined;
  resetAgentAbnormalStreamInterruptionHeuristics(state, currentBuffer);
  state.oscCarryover = '';
  return state;
}

export function recordAgentInputHeuristics(
  state: AgentActivityHeuristicState,
  now: number = Date.now()
): void {
  state.lastInputAtMs = now;
}

export function recordAgentBottomScreenActivity(
  state: AgentActivityHeuristicState,
  signature: string,
  now: number = Date.now()
): AgentBottomScreenActivitySnapshot {
  if (state.bottomScreenSignature === undefined) {
    state.bottomScreenSignature = signature;
    return {
      changed: false,
      strongRunningEvidence: false
    };
  }

  if (state.bottomScreenSignature === signature) {
    if (
      typeof state.lastBottomScreenChangeAtMs === 'number' &&
      now - state.lastBottomScreenChangeAtMs > AGENT_BOTTOM_ACTIVITY_SEQUENCE_GAP_MS
    ) {
      state.bottomScreenChangeStreak = 0;
    }
    return {
      changed: false,
      strongRunningEvidence: false
    };
  }

  state.bottomScreenSignature = signature;
  if (
    typeof state.lastInputAtMs === 'number' &&
    now - state.lastInputAtMs <= AGENT_BOTTOM_ACTIVITY_INPUT_ECHO_SUPPRESSION_MS
  ) {
    state.bottomScreenChangeStreak = 0;
    state.lastBottomScreenChangeAtMs = undefined;
    return {
      changed: true,
      strongRunningEvidence: false
    };
  }

  state.bottomScreenChangeStreak =
    typeof state.lastBottomScreenChangeAtMs === 'number' &&
    now - state.lastBottomScreenChangeAtMs <= AGENT_BOTTOM_ACTIVITY_SEQUENCE_GAP_MS
      ? state.bottomScreenChangeStreak + 1
      : 1;
  state.lastBottomScreenChangeAtMs = now;
  const strongRunningEvidence =
    state.bottomScreenChangeStreak >= AGENT_BOTTOM_ACTIVITY_REQUIRED_CHANGES;
  if (strongRunningEvidence) {
    state.lastStrongBottomActivityAtMs = now;
  }

  return {
    changed: true,
    strongRunningEvidence
  };
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
  state.lastActivityAtMs = now;
  const strippedBuffer = stripTerminalControlSequences(buffer).replace(/\r/g, '');

  const attentionSignals = parseExecutionAttentionSignals(chunk, state.oscCarryover);
  state.oscCarryover = attentionSignals.carryover;
  const strippedChunk = stripTerminalControlSequences(chunk);
  const normalizedChunk = strippedChunk.replace(/\r/g, '');

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
        line,
        start: lineStart
      });
    }
    lineStart = lineEnd + 1;
  }

  const candidate = getTailCodexFinalErrorLine(tailLines);
  if (!candidate) {
    return [];
  }
  if (
    candidate.end <= minMatchEndOffset &&
    !doesTailAfterCandidateIncludeNewlyCompletedIgnorableCodexChrome(
      tailLines,
      candidate,
      minMatchEndOffset
    )
  ) {
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

function doesTailAfterCandidateIncludeNewlyCompletedIgnorableCodexChrome(
  tailLines: AgentAbnormalStreamTailLine[],
  candidate: AgentAbnormalStreamTailLine,
  minMatchEndOffset: number
): boolean {
  let sawNewlyCompletedChrome = false;
  for (const tailLine of tailLines) {
    if (tailLine.end <= candidate.end) {
      continue;
    }
    if (!isIgnorableCodexTrailingChromeLine(tailLine.line)) {
      return false;
    }
    if (tailLine.start < minMatchEndOffset && tailLine.end > minMatchEndOffset) {
      sawNewlyCompletedChrome = true;
    }
  }

  return sawNewlyCompletedChrome;
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
  if (typeof state.lastActivityAtMs !== 'number') {
    return {
      shouldTransition: false,
      shouldKeepPolling: false
    };
  }

  const quietMs = now - state.lastActivityAtMs;
  const bottomActivityRecentlyStrong =
    typeof state.lastStrongBottomActivityAtMs === 'number' &&
    now - state.lastStrongBottomActivityAtMs < AGENT_BOTTOM_ACTIVITY_GRACE_MS;
  if (!bottomActivityRecentlyStrong && quietMs >= AGENT_WAITING_INPUT_QUIET_FALLBACK_MS) {
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
