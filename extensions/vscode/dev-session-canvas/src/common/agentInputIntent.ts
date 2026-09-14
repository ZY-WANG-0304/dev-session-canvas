import type { AgentInputIntent } from './protocol';

const BRACKETED_PASTE_START = '\u001b[200~';
const BRACKETED_PASTE_END = '\u001b[201~';

export interface AgentInputKeyEventLike {
  type: string;
  key: string;
  code?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  isComposing?: boolean;
  keyCode?: number;
}

export interface AgentInputIntentTracker {
  recordKeyEvent(event: AgentInputKeyEventLike): void;
  classifyData(data: string): AgentInputIntent;
  /** Discard a key event when its corresponding PTY data was gated locally. */
  reset(): void;
}

export function createAgentInputIntentTracker(): AgentInputIntentTracker {
  let pendingKeyEvent: AgentInputKeyEventLike | undefined;

  return {
    recordKeyEvent(event) {
      if (event.type === 'keydown') {
        pendingKeyEvent = copyAgentInputKeyEvent(event);
      }
    },
    classifyData(data) {
      const keyEvent = pendingKeyEvent;
      pendingKeyEvent = undefined;
      return classifyAgentInputData(data, keyEvent);
    },
    reset() {
      pendingKeyEvent = undefined;
    }
  };
}

export function classifyAgentInputData(
  data: string,
  keyEvent?: AgentInputKeyEventLike
): AgentInputIntent {
  if (isBracketedOrMultilinePaste(data)) {
    return 'paste';
  }

  if (keyEvent) {
    if (isImeCompositionKeyEvent(keyEvent)) {
      return 'text';
    }

    if (isUnmodifiedEscapeKey(keyEvent)) {
      return 'interrupt';
    }

    if (isUnmodifiedSubmitKey(keyEvent)) {
      return 'submit';
    }

    return 'text';
  }

  // Virtual and remote keyboards do not always expose a DOM key event.
  if (data === '\r' || data === '\n' || data === '\r\n') {
    return 'submit';
  }

  return 'text';
}

export function isAgentSubmissionIntent(intent: AgentInputIntent | undefined): boolean {
  return intent === 'submit';
}

function isBracketedOrMultilinePaste(data: string): boolean {
  if (data.includes(BRACKETED_PASTE_START) || data.includes(BRACKETED_PASTE_END)) {
    return true;
  }

  if (!/[\r\n]/u.test(data)) {
    return false;
  }

  const withoutLineBreaks = data.replace(/[\r\n]/gu, '');
  const lineBreakCount = data.match(/\r\n|\r|\n/gu)?.length ?? 0;
  return withoutLineBreaks.length > 0 || lineBreakCount > 1;
}

function isImeCompositionKeyEvent(event: AgentInputKeyEventLike): boolean {
  return event.isComposing === true || event.keyCode === 229 || event.key === 'Process';
}

function isUnmodifiedEscapeKey(event: AgentInputKeyEventLike): boolean {
  return (
    (event.key === 'Escape' || event.code === 'Escape') &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

function isUnmodifiedSubmitKey(event: AgentInputKeyEventLike): boolean {
  const isEnter =
    event.key === 'Enter' ||
    event.code === 'Enter' ||
    event.code === 'NumpadEnter';
  return (
    isEnter &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

function copyAgentInputKeyEvent(event: AgentInputKeyEventLike): AgentInputKeyEventLike {
  return {
    type: event.type,
    key: event.key,
    code: event.code,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    isComposing: event.isComposing,
    keyCode: event.keyCode
  };
}
