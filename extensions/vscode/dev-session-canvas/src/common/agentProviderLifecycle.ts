import type {
  AgentActivityAuthority,
  AgentActivitySource,
  AgentInputIntent,
  AgentProviderKind,
  AgentTurnOutcome
} from './protocol';
import { stripTerminalControlSequences } from './agentActivityHeuristics';

const MAX_TRACKED_COMPLETED_TURNS = 32;

export type AgentProviderLifecycleEvent =
  | {
      provider: 'codex';
      kind: 'turn-completed';
      providerSessionId: string;
      providerTurnId: string;
      observedAtMs?: number;
    }
  | {
      provider: 'claude';
      kind: 'turn-started' | 'turn-completed' | 'turn-failed';
      providerSessionId: string;
      providerTurnId: string;
      error?: string;
      observedAtMs?: number;
    };

export interface AgentProviderLifecycleCallbackEnvelope {
  version: 1;
  runtimeSessionId: string;
  processEpoch: string;
  callbackNonce: string;
  event: AgentProviderLifecycleEvent;
}

export interface AgentProviderLifecycleState {
  provider: AgentProviderKind;
  lifecycleEnabled: boolean;
  activitySource: AgentActivitySource;
  activityAuthority: AgentActivityAuthority;
  providerSessionId?: string;
  activeProviderTurnId?: string;
  activeTurnStartedAtMs?: number;
  lastProviderTurnId?: string;
  lastTurnOutcome?: AgentTurnOutcome;
  lastTurnError?: string;
  turnActive: boolean;
  interruptRequested: boolean;
  codexSubmissionCandidateArmed: boolean;
  completedProviderTurnIds: string[];
}

export type AgentProviderLifecycleApplyReason =
  | 'accepted'
  | 'duplicate'
  | 'provider-mismatch'
  | 'provider-session-mismatch'
  | 'stale-turn'
  | 'no-active-turn';

export interface AgentProviderLifecycleApplyResult {
  accepted: boolean;
  changed: boolean;
  reason: AgentProviderLifecycleApplyReason;
  lifecycle?: 'running' | 'waiting-input';
}

export function createAgentProviderLifecycleState(
  provider: AgentProviderKind,
  lifecycleEnabled: boolean
): AgentProviderLifecycleState {
  return {
    provider,
    lifecycleEnabled,
    activitySource: 'heuristic',
    activityAuthority: 'best-effort',
    turnActive: false,
    interruptRequested: false,
    codexSubmissionCandidateArmed: false,
    completedProviderTurnIds: []
  };
}

export function consumeCodexInstructionSubmission(
  state: AgentProviderLifecycleState,
  data: string,
  intent?: AgentInputIntent
): boolean {
  if (state.provider !== 'codex') {
    return false;
  }

  if (intent === 'interrupt') {
    state.codexSubmissionCandidateArmed = false;
    return false;
  }

  if (containsEditablePromptInput(data)) {
    state.codexSubmissionCandidateArmed = true;
  }

  const submitted = intent === 'submit' || (intent === undefined && /[\r\n]/u.test(data));
  if (!submitted) {
    return false;
  }

  const accepted = state.codexSubmissionCandidateArmed;
  state.codexSubmissionCandidateArmed = false;
  return accepted;
}

export function recordCodexSubmission(
  state: AgentProviderLifecycleState,
  submittedAtMs = Date.now()
): AgentProviderLifecycleApplyResult {
  if (state.provider !== 'codex') {
    return rejected('provider-mismatch');
  }

  state.turnActive = true;
  state.activitySource = 'submission-intent';
  state.activityAuthority = 'derived';
  state.interruptRequested = false;
  state.codexSubmissionCandidateArmed = false;
  state.activeProviderTurnId = undefined;
  state.activeTurnStartedAtMs = submittedAtMs;
  state.lastTurnOutcome = undefined;
  state.lastTurnError = undefined;
  return accepted(true, 'running');
}

export function recordAgentInterruptRequest(
  state: AgentProviderLifecycleState
): AgentProviderLifecycleApplyResult {
  if (!state.turnActive) {
    return rejected('no-active-turn');
  }

  const changed = !state.interruptRequested;
  state.interruptRequested = true;
  state.codexSubmissionCandidateArmed = false;
  state.activitySource = 'submission-intent';
  state.activityAuthority = 'derived';
  return accepted(changed);
}

function containsEditablePromptInput(data: string): boolean {
  const withoutSs3Controls = data.replace(/\u001bO[\u0020-\u007e]/gu, '');
  const visibleInput = stripTerminalControlSequences(withoutSs3Controls)
    .replace(/\u001b[\u0020-\u007e]/gu, '')
    .replace(/[\u0000-\u001f\u007f]/gu, '');
  return /\S/u.test(visibleInput);
}

export function confirmAgentInterrupt(
  state: AgentProviderLifecycleState
): AgentProviderLifecycleApplyResult {
  if (!state.turnActive || !state.interruptRequested) {
    return rejected('no-active-turn');
  }

  state.turnActive = false;
  state.activitySource = 'heuristic';
  state.activityAuthority = 'best-effort';
  state.interruptRequested = false;
  state.activeTurnStartedAtMs = undefined;
  state.lastTurnOutcome = 'interrupted';
  state.lastTurnError = undefined;
  if (state.activeProviderTurnId) {
    state.lastProviderTurnId = state.activeProviderTurnId;
  }
  return accepted(true, 'waiting-input');
}

export function applyAgentProviderLifecycleEvent(
  state: AgentProviderLifecycleState,
  event: AgentProviderLifecycleEvent
): AgentProviderLifecycleApplyResult {
  if (event.provider !== state.provider) {
    return rejected('provider-mismatch');
  }
  if (state.providerSessionId && state.providerSessionId !== event.providerSessionId) {
    return rejected('provider-session-mismatch');
  }

  if (event.provider === 'claude' && event.kind === 'turn-started') {
    markProviderLifecycleSource(state);
    state.providerSessionId = event.providerSessionId;
    const changed =
      !state.turnActive ||
      state.activeProviderTurnId !== event.providerTurnId ||
      state.interruptRequested;
    state.turnActive = true;
    state.interruptRequested = false;
    state.activeProviderTurnId = event.providerTurnId;
    state.activeTurnStartedAtMs = event.observedAtMs;
    state.lastTurnOutcome = undefined;
    state.lastTurnError = undefined;
    return accepted(changed, 'running');
  }

  if (event.provider === 'claude') {
    if (!state.turnActive) {
      if (state.lastProviderTurnId === event.providerTurnId) {
        return accepted(false, 'waiting-input', 'duplicate');
      }
      return rejected('no-active-turn');
    }
    if (state.activeProviderTurnId !== event.providerTurnId) {
      return rejected('stale-turn');
    }

    markProviderLifecycleSource(state);
    state.providerSessionId = event.providerSessionId;
    state.turnActive = false;
    const interrupted = state.interruptRequested;
    state.interruptRequested = false;
    state.lastProviderTurnId = event.providerTurnId;
    state.activeTurnStartedAtMs = undefined;
    state.lastTurnOutcome = interrupted
      ? 'interrupted'
      : event.kind === 'turn-failed'
        ? 'failed'
        : 'completed';
    state.lastTurnError = event.kind === 'turn-failed' ? event.error : undefined;
    rememberCompletedTurn(state, event.providerTurnId);
    return accepted(true, 'waiting-input');
  }

  if (state.completedProviderTurnIds.includes(event.providerTurnId)) {
    return accepted(false, 'waiting-input', 'duplicate');
  }
  if (!state.turnActive) {
    return rejected('no-active-turn');
  }
  if (
    event.observedAtMs !== undefined &&
    state.activeTurnStartedAtMs !== undefined &&
    event.observedAtMs < state.activeTurnStartedAtMs
  ) {
    return rejected('stale-turn');
  }

  markProviderLifecycleSource(state);
  state.providerSessionId = event.providerSessionId;
  state.activeProviderTurnId = event.providerTurnId;
  state.lastProviderTurnId = event.providerTurnId;
  state.lastTurnOutcome = state.interruptRequested ? 'interrupted' : 'completed';
  state.lastTurnError = undefined;
  state.turnActive = false;
  state.activeTurnStartedAtMs = undefined;
  state.interruptRequested = false;
  rememberCompletedTurn(state, event.providerTurnId);
  return accepted(true, 'waiting-input');
}

export function parseAgentProviderLifecycleCallbackEnvelope(
  value: unknown
): AgentProviderLifecycleCallbackEnvelope | null {
  if (!isRecord(value) || value.version !== 1) {
    return null;
  }

  const runtimeSessionId = normalizeIdentity(value.runtimeSessionId);
  const processEpoch = normalizeIdentity(value.processEpoch);
  const callbackNonce = normalizeIdentity(value.callbackNonce);
  const event = parseAgentProviderLifecycleEvent(value.event);
  if (!runtimeSessionId || !processEpoch || !callbackNonce || !event) {
    return null;
  }

  return {
    version: 1,
    runtimeSessionId,
    processEpoch,
    callbackNonce,
    event
  };
}

export function parseAgentProviderLifecycleEvent(
  value: unknown
): AgentProviderLifecycleEvent | null {
  if (!isRecord(value)) {
    return null;
  }

  const providerSessionId = normalizeIdentity(value.providerSessionId);
  const providerTurnId = normalizeIdentity(value.providerTurnId);
  const observedAtMs = normalizeObservedAtMs(value.observedAtMs);
  if (!providerSessionId || !providerTurnId) {
    return null;
  }

  if (value.provider === 'codex' && value.kind === 'turn-completed') {
    return {
      provider: 'codex',
      kind: 'turn-completed',
      providerSessionId,
      providerTurnId,
      ...(observedAtMs !== undefined ? { observedAtMs } : {})
    };
  }

  if (
    value.provider === 'claude' &&
    (value.kind === 'turn-started' || value.kind === 'turn-completed' || value.kind === 'turn-failed')
  ) {
    return {
      provider: 'claude',
      kind: value.kind,
      providerSessionId,
      providerTurnId,
      ...(typeof value.error === 'string' && value.error.trim()
        ? { error: value.error.trim().slice(0, 2000) }
        : {}),
      ...(observedAtMs !== undefined ? { observedAtMs } : {})
    };
  }

  return null;
}

function accepted(
  changed: boolean,
  lifecycle?: 'running' | 'waiting-input',
  reason: AgentProviderLifecycleApplyReason = 'accepted'
): AgentProviderLifecycleApplyResult {
  return {
    accepted: true,
    changed,
    reason,
    lifecycle
  };
}

function rejected(reason: AgentProviderLifecycleApplyReason): AgentProviderLifecycleApplyResult {
  return {
    accepted: false,
    changed: false,
    reason
  };
}

function rememberCompletedTurn(state: AgentProviderLifecycleState, turnId: string): void {
  state.completedProviderTurnIds = [
    ...state.completedProviderTurnIds.filter((candidate) => candidate !== turnId),
    turnId
  ].slice(-MAX_TRACKED_COMPLETED_TURNS);
}

function markProviderLifecycleSource(state: AgentProviderLifecycleState): void {
  state.activitySource = 'provider-lifecycle';
  state.activityAuthority = 'authoritative';
}

function normalizeIdentity(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized && normalized.length <= 512 ? normalized : null;
}

function normalizeObservedAtMs(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
