import type { AgentProviderKind } from './protocol';
import {
  parseExecutionTerminalTitles,
  type ParsedExecutionTerminalTitles
} from './executionTerminalTitle';

export interface AgentTerminalTitleActivityState {
  carryover: string;
  lastFrame?: string;
  lastFrameAtMs?: number;
}

export type ParsedAgentTerminalTitles = ParsedExecutionTerminalTitles;

export const AGENT_TERMINAL_TITLE_FRAME_GAP_MS = 2500;

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

// Preserve the Agent-specific API so lifecycle callers and tests share the
// generic parser without broadening provider activity semantics.
export function parseAgentTerminalTitles(
  chunk: string,
  previousCarryover = ''
): ParsedAgentTerminalTitles {
  return parseExecutionTerminalTitles(chunk, previousCarryover);
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
