export interface ExecutionAttentionSignalState {
  carryover: string;
}

export type ExecutionAttentionSignalKind = 'bel' | 'osc9' | 'osc777';
export type ExecutionAttentionSignalPresentation = 'notify' | 'ignore';

export interface ExecutionAttentionSignal {
  kind: ExecutionAttentionSignalKind;
  rawMessage?: string;
  message?: string;
  presentation: ExecutionAttentionSignalPresentation;
}

export interface ParsedExecutionAttentionSignals {
  carryover: string;
  notificationCount: number;
  bellCount: number;
  signals: ExecutionAttentionSignal[];
}

const OSC_CARRYOVER_LIMIT = 256;

export function createExecutionAttentionSignalState(): ExecutionAttentionSignalState {
  return {
    carryover: ''
  };
}

export function resetExecutionAttentionSignalState(
  state: ExecutionAttentionSignalState
): ExecutionAttentionSignalState {
  state.carryover = '';
  return state;
}

export function parseExecutionAttentionSignals(
  chunk: string,
  previousCarryover = ''
): ParsedExecutionAttentionSignals {
  const source = `${previousCarryover}${chunk}`;
  let notificationCount = 0;
  let bellCount = 0;
  let carryover = '';
  const signals: ExecutionAttentionSignal[] = [];
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
      const messageStart = index;
      let messageEnd = index;
      let terminated = false;

      while (index < source.length) {
        if (source[index] === '\u0007') {
          messageEnd = index;
          terminated = true;
          index += 1;
          break;
        }
        if (source[index] === '\u001b' && source[index + 1] === '\\') {
          messageEnd = index;
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
        const kind: ExecutionAttentionSignalKind = identifier === '9' ? 'osc9' : 'osc777';
        const rawMessage = source.slice(messageStart, messageEnd);
        signals.push({
          kind,
          rawMessage,
          message: normalizeExecutionAttentionSignalMessage(kind, rawMessage),
          presentation: getExecutionAttentionSignalPresentation(kind, rawMessage)
        });
      }
      continue;
    }

    if (source[index] === '\u0007') {
      bellCount += 1;
      signals.push({
        kind: 'bel',
        presentation: 'notify'
      });
    }

    index += 1;
  }

  if (!carryover) {
    carryover = extractTrailingOscCarryover(source);
  }

  return {
    carryover: trimOscCarryover(carryover),
    notificationCount,
    bellCount,
    signals
  };
}

function normalizeExecutionAttentionSignalMessage(
  kind: ExecutionAttentionSignalKind,
  rawMessage: string
): string | undefined {
  const normalized = rawMessage.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return undefined;
  }

  if (kind === 'osc777') {
    const segments = normalized.split(';').map((segment) => segment.trim()).filter(Boolean);
    if (segments[0]?.toLowerCase() === 'notify') {
      const joined = segments.slice(1).join(' - ').trim();
      return joined || undefined;
    }
  }

  return normalized;
}

function getExecutionAttentionSignalPresentation(
  kind: ExecutionAttentionSignalKind,
  rawMessage: string
): ExecutionAttentionSignalPresentation {
  if (kind === 'osc9' && rawMessage.trimStart().startsWith('4;')) {
    return 'ignore';
  }

  return 'notify';
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
