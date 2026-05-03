export const ATTENTION_NOTIFICATION_PROTOCOL_VERSION = 1 as const;

export const NOTIFIER_COMMAND_IDS = {
  postSystemNotification: 'devSessionCanvasNotifier.postSystemNotification'
} as const;

export const NOTIFIER_TEST_COMMAND_IDS = {
  getPostedNotifications: 'devSessionCanvasNotifier.__test.getPostedNotifications',
  clearPostedNotifications: 'devSessionCanvasNotifier.__test.clearPostedNotifications',
  replayLastFocusAction: 'devSessionCanvasNotifier.__test.replayLastFocusAction'
} as const;

export type AttentionNotificationKind = 'execution-attention';

export interface AttentionNotificationFocusAction {
  command: string;
  arguments?: string[];
}

export interface AttentionNotificationRequest {
  version: typeof ATTENTION_NOTIFICATION_PROTOCOL_VERSION;
  kind: AttentionNotificationKind;
  title: string;
  message: string;
  dedupeKey: string;
  focusAction?: AttentionNotificationFocusAction;
}

export type AttentionNotificationBackend =
  | 'test'
  | 'linux-notify-send'
  | 'macos-terminal-notifier'
  | 'macos-osascript'
  | 'windows-toast'
  | 'unsupported';

export type AttentionNotificationActivationMode = 'none' | 'direct-action' | 'protocol' | 'test-replay';

export interface AttentionNotificationDeliveryResult {
  status: 'posted' | 'unsupported' | 'error';
  backend: AttentionNotificationBackend;
  activationMode: AttentionNotificationActivationMode;
  detail?: string;
}

export interface AttentionNotificationDebugRecord {
  request: AttentionNotificationRequest;
  callbackUri?: string;
  result: AttentionNotificationDeliveryResult;
}

export function isAttentionNotificationFocusAction(value: unknown): value is AttentionNotificationFocusAction {
  if (!isRecord(value) || typeof value.command !== 'string' || value.command.trim().length === 0) {
    return false;
  }

  if (value.arguments === undefined) {
    return true;
  }

  return Array.isArray(value.arguments) && value.arguments.every((item) => typeof item === 'string');
}

export function isAttentionNotificationRequest(value: unknown): value is AttentionNotificationRequest {
  return parseAttentionNotificationRequest(value) !== undefined;
}

export function parseAttentionNotificationRequest(value: unknown): AttentionNotificationRequest | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  if (value.version !== ATTENTION_NOTIFICATION_PROTOCOL_VERSION) {
    return undefined;
  }

  if (value.kind !== 'execution-attention') {
    return undefined;
  }

  if (!isNonEmptyString(value.title) || !isNonEmptyString(value.message) || !isNonEmptyString(value.dedupeKey)) {
    return undefined;
  }

  if (value.focusAction !== undefined && !isAttentionNotificationFocusAction(value.focusAction)) {
    return undefined;
  }

  return {
    version: ATTENTION_NOTIFICATION_PROTOCOL_VERSION,
    kind: 'execution-attention',
    title: value.title.trim(),
    message: value.message.trim(),
    dedupeKey: value.dedupeKey.trim(),
    focusAction: value.focusAction
      ? {
          command: value.focusAction.command.trim(),
          arguments: value.focusAction.arguments?.slice()
        }
      : undefined
  };
}

export function isAttentionNotificationDeliveryResult(
  value: unknown
): value is AttentionNotificationDeliveryResult {
  if (!isRecord(value)) {
    return false;
  }

  if (value.status !== 'posted' && value.status !== 'unsupported' && value.status !== 'error') {
    return false;
  }

  if (!isAttentionNotificationBackend(value.backend)) {
    return false;
  }

  if (!isAttentionNotificationActivationMode(value.activationMode)) {
    return false;
  }

  return value.detail === undefined || typeof value.detail === 'string';
}

export function encodeAttentionNotificationFocusAction(action: AttentionNotificationFocusAction): string {
  const payload = JSON.stringify({
    command: action.command,
    arguments: action.arguments ?? []
  });
  return Buffer.from(payload, 'utf8').toString('base64url');
}

export function decodeAttentionNotificationFocusAction(
  encoded: string | undefined
): AttentionNotificationFocusAction | undefined {
  if (!isNonEmptyString(encoded)) {
    return undefined;
  }

  try {
    const decoded = Buffer.from(encoded, 'base64url').toString('utf8');
    const parsed = JSON.parse(decoded) as unknown;
    if (!isAttentionNotificationFocusAction(parsed)) {
      return undefined;
    }

    return {
      command: parsed.command.trim(),
      arguments: parsed.arguments?.slice()
    };
  } catch {
    return undefined;
  }
}

function isAttentionNotificationBackend(value: unknown): value is AttentionNotificationBackend {
  return (
    value === 'test' ||
    value === 'linux-notify-send' ||
    value === 'macos-terminal-notifier' ||
    value === 'macos-osascript' ||
    value === 'windows-toast' ||
    value === 'unsupported'
  );
}

function isAttentionNotificationActivationMode(value: unknown): value is AttentionNotificationActivationMode {
  return value === 'none' || value === 'direct-action' || value === 'protocol' || value === 'test-replay';
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object';
}
