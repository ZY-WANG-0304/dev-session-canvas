/** Native client protocol, independent of the extension-to-extension v1 contract. */
export const NATIVE_VERSION = 2 as const;
export const MAX_NATIVE_FRAME_BYTES = 65536;
export const MAX_EVENT_TTL_MS = 86400000;
export const MAX_CLOCK_SKEW_MS = 60000;
export interface NativeEvent {
  eventId: string;
  workspaceId: string;
  canvasId: string;
  nodeId: string;
  executionGeneration: string;
  occurredAt: number;
  expiresAt: number;
  mergeKey: string;
  title: string;
  body: string;
  playSound: boolean;
}
export type NativeOperation =
  | { type: 'register'; workspaceId: string; capabilities: ['focus-node'] }
  | { type: 'publish'; event: NativeEvent }
  | { type: 'update'; eventId: string; title: string; body: string }
  | { type: 'withdraw' | 'query'; eventId: string }
  | { type: 'sync'; eventIds: string[] }
  | {
      type: 'focusResult';
      focusRequestId: string;
      result: 'focused' | 'stale' | 'offline';
    };
export interface NativeRequest {
  version: 2;
  requestId: string;
  credential: string;
  sourceInstanceId: string;
  operation: NativeOperation;
}
const encoder = new TextEncoder();
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function exact(value: Record<string, unknown>, keys: string[]): boolean {
  return (
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}
function text(value: unknown, max = 256): value is string {
  if (
    typeof value !== 'string' ||
    value.replace(/^ +| +$/g, '').length === 0 ||
    encoder.encode(value).length > max
  )
    return false;
  // Reject control characters and lone surrogates (Rust JSON strings cannot contain them).
  if (/[\u0000-\u001f\u007f-\u009f]/u.test(value)) return false;
  return (
    new TextDecoder('utf-8', { fatal: true }).decode(encoder.encode(value)) ===
    value
  );
}
function time(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}
const eventKeys = [
  'eventId',
  'workspaceId',
  'canvasId',
  'nodeId',
  'executionGeneration',
  'occurredAt',
  'expiresAt',
  'mergeKey',
  'title',
  'body',
  'playSound'
];
export function isNativeEvent(
  value: unknown,
  now: number
): value is NativeEvent {
  if (!time(now) || !record(value) || !exact(value, eventKeys)) return false;
  return (
    [
      'eventId',
      'workspaceId',
      'canvasId',
      'nodeId',
      'executionGeneration',
      'mergeKey'
    ].every((key) => text(value[key])) &&
    text(value.title, 512) &&
    text(value.body, 8192) &&
    typeof value.playSound === 'boolean' &&
    time(value.occurredAt) &&
    time(value.expiresAt) &&
    value.expiresAt > now &&
    value.occurredAt <= now + MAX_CLOCK_SKEW_MS &&
    value.expiresAt > value.occurredAt &&
    value.expiresAt - value.occurredAt <= MAX_EVENT_TTL_MS
  );
}
export function isNativeRequest(
  value: unknown,
  now: number
): value is NativeRequest {
  if (
    !time(now) ||
    !record(value) ||
    !exact(value, [
      'version',
      'requestId',
      'credential',
      'sourceInstanceId',
      'operation'
    ]) ||
    value.version !== NATIVE_VERSION ||
    !text(value.requestId) ||
    !text(value.sourceInstanceId) ||
    typeof value.credential !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.credential) ||
    !record(value.operation)
  )
    return false;
  const op = value.operation;
  switch (op.type) {
    case 'register':
      return (
        exact(op, ['type', 'workspaceId', 'capabilities']) &&
        text(op.workspaceId) &&
        Array.isArray(op.capabilities) &&
        op.capabilities.length === 1 &&
        op.capabilities[0] === 'focus-node'
      );
    case 'publish':
      return exact(op, ['type', 'event']) && isNativeEvent(op.event, now);
    case 'update':
      return (
        exact(op, ['type', 'eventId', 'title', 'body']) &&
        text(op.eventId) &&
        text(op.title, 512) &&
        text(op.body, 8192)
      );
    case 'withdraw':
    case 'query':
      return exact(op, ['type', 'eventId']) && text(op.eventId);
    case 'sync':
      return (
        exact(op, ['type', 'eventIds']) &&
        Array.isArray(op.eventIds) &&
        op.eventIds.length <= 256 &&
        op.eventIds.every((id) => text(id)) &&
        new Set(op.eventIds).size === op.eventIds.length
      );
    case 'focusResult':
      return (
        exact(op, ['type', 'focusRequestId', 'result']) &&
        text(op.focusRequestId) &&
        ['focused', 'stale', 'offline'].includes(op.result as string)
      );
    default:
      return false;
  }
}
export function decodeNativeFrame(
  bytes: Uint8Array,
  now: number
): NativeRequest | undefined {
  if (
    bytes.length > MAX_NATIVE_FRAME_BYTES ||
    bytes.at(-1) !== 10 ||
    bytes.subarray(0, -1).includes(10)
  )
    return;
  try {
    const raw = new TextDecoder('utf-8', {
      fatal: true,
      ignoreBOM: true
    }).decode(bytes.subarray(0, -1));
    const value: unknown = JSON.parse(raw);
    if (!strictTokens(raw)) return;
    return isNativeRequest(value, now) ? value : undefined;
  } catch {
    return;
  }
}

// JSON.parse loses duplicate keys and integer lexical form; check both before trusting its result.
function strictTokens(raw: string): boolean {
  const stack: { keys?: Set<string>; expectingKey: boolean }[] = [];
  const tokens =
    raw.match(/"(?:\\.|[^"\\])*"|[{}\[\]:,]|[^\s{}\[\]:,"]+/g) ?? [];
  for (const token of tokens) {
    if (token === '{') {
      stack.push({ keys: new Set(), expectingKey: true });
      continue;
    }
    if (token === '[') {
      stack.push({ expectingKey: false });
      continue;
    }
    if (token === '}' || token === ']') {
      stack.pop();
      continue;
    }
    const current = stack.at(-1);
    if (token === ',') {
      if (current?.keys) current.expectingKey = true;
      continue;
    }
    if (token === ':') {
      if (current) current.expectingKey = false;
      continue;
    }
    if (token.startsWith('"') && current?.keys && current.expectingKey) {
      const key = JSON.parse(token) as string;
      if (current.keys.has(key)) return false;
      current.keys.add(key);
    } else if (
      !token.startsWith('"') &&
      !['true', 'false', 'null'].includes(token) &&
      !/^(0|[1-9][0-9]*)$/.test(token)
    )
      return false;
  }
  return true;
}

export type NativeTarget = Pick<
  NativeEvent,
  'eventId' | 'workspaceId' | 'canvasId' | 'nodeId' | 'executionGeneration'
>;
export const NATIVE_IDE_COMMANDS = {
  focus: 'devSessionCanvas.__internal.focusNativeAttention',
  active: 'devSessionCanvas.__internal.activeNativeAttention'
} as const;
export function isNativeTarget(value: unknown): value is NativeTarget {
  return (
    record(value) &&
    exact(value, [
      'eventId',
      'workspaceId',
      'canvasId',
      'nodeId',
      'executionGeneration'
    ]) &&
    Object.values(value).every((v) => text(v))
  );
}
export type NativeResult =
  | { status: 'accepted'; eventState?: 'stored' | 'withdrawn' | 'absent' }
  | { status: 'rejected' | 'unknown'; code: string };
export type NativeServerMessage =
  | { version: 2; type: 'receipt'; requestId: string; result: NativeResult }
  | {
      version: 2;
      type: 'focus-node';
      focusRequestId: string;
      target: NativeTarget;
    };
export function decodeNativeServerFrame(
  bytes: Uint8Array
): NativeServerMessage | undefined {
  if (
    bytes.length > MAX_NATIVE_FRAME_BYTES ||
    bytes.at(-1) !== 10 ||
    bytes.subarray(0, -1).includes(10)
  )
    return;
  try {
    const raw = new TextDecoder('utf-8', {
      fatal: true,
      ignoreBOM: true
    }).decode(bytes.subarray(0, -1));
    const value: unknown = JSON.parse(raw);
    if (!strictTokens(raw) || !record(value) || value.version !== 2) return;
    if (
      value.type === 'focus-node' &&
      exact(value, ['version', 'type', 'focusRequestId', 'target']) &&
      text(value.focusRequestId) &&
      isNativeTarget(value.target)
    )
      return value as NativeServerMessage;
    if (
      value.type !== 'receipt' ||
      !exact(value, ['version', 'type', 'requestId', 'result']) ||
      !text(value.requestId) ||
      !record(value.result)
    )
      return;
    const result = value.result;
    if (
      result.status === 'accepted' &&
      (exact(result, ['status']) ||
        (exact(result, ['status', 'eventState']) &&
          ['stored', 'withdrawn', 'absent'].includes(
            result.eventState as string
          )))
    )
      return value as NativeServerMessage;
    if (
      ['rejected', 'unknown'].includes(result.status as string) &&
      exact(result, ['status', 'code']) &&
      text(result.code)
    )
      return value as NativeServerMessage;
  } catch {
    return;
  }
}
