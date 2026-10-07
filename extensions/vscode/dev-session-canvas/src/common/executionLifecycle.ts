export interface ExecutionIdentity {
  readonly executionId: string;
  readonly generation: string;
}

export const EXECUTION_CANDIDATE_PROFILE = 'linux-owner-v1-candidate' as const;
export const MACOS_EXECUTION_CANDIDATE_PROFILE = 'macos-owner-v1-candidate' as const;
export const WINDOWS_EXECUTION_CANDIDATE_PROFILE = 'windows-owner-v1-candidate' as const;
export type ExecutionCandidateProfile = typeof EXECUTION_CANDIDATE_PROFILE | typeof MACOS_EXECUTION_CANDIDATE_PROFILE
  | typeof WINDOWS_EXECUTION_CANDIDATE_PROFILE;
export type ExecutionCandidateMode = 'live-runtime' | 'snapshot-only';
export const EXECUTION_CANDIDATE_BUDGETS = Object.freeze({
  startMs: 10000,
  gracefulMs: 5000,
  forceMs: 2000,
  naturalDrainMs: 2000,
  cancelMs: 2000,
  settleMs: 4000,
  parentTermMs: 1000,
  parentKillMs: 1000,
  boundaryMs: 20000
});

export function assertExecutionCandidateProfile(value: unknown): asserts value is ExecutionCandidateProfile {
  if (value !== EXECUTION_CANDIDATE_PROFILE && value !== MACOS_EXECUTION_CANDIDATE_PROFILE
    && value !== WINDOWS_EXECUTION_CANDIDATE_PROFILE) {
    throw new Error('Unsupported execution candidate profile.');
  }
}

export function assertExecutionCandidateCapabilities(
  capabilities: readonly string[], mode: ExecutionCandidateMode
): void {
  if (mode !== 'live-runtime' && mode !== 'snapshot-only') throw new Error('An explicit execution candidate mode is required.');
  const required = ['execution-lifecycle-v1', 'execution-close-observation-v1', 'execution-parent-cleanup-v1',
    'execution-owner-boundary-v1', 'terminal-interaction-v1', ...(mode === 'live-runtime'
      ? ['terminal-read-settlement-v1'] : ['terminal-local-settlement-v1', 'terminal-local-persistence-v1'])];
  const missing = required.filter(capability => !capabilities.includes(capability));
  if (missing.length) throw new Error(`Execution candidate capabilities missing: ${missing.join(', ')}.`);
}

export type ExecutionProviderCapability = 'execution-lifecycle-v1' | 'terminal-interaction-v1';

export type ProcessResult =
  | Readonly<{ kind: 'exited'; exitCode: number; signal?: string }>
  | Readonly<{ kind: 'signaled'; signal: string }>
  | Readonly<{ kind: 'terminated' | 'unconfirmed'; reason: string }>;

export type SourceDisposition =
  | Readonly<{ kind: 'eof' }>
  | Readonly<{ kind: 'interrupted' | 'error' | 'unknown'; reason: string }>;

export type SourceResult = SourceDisposition & Readonly<{ lastDataSequence: number }>;

export type ResourceResult =
  | Readonly<{ kind: 'released' }>
  | Readonly<{ kind: 'retained' | 'failed' | 'unknown'; reason: string }>;

export type OutputSeal = ExecutionIdentity & Readonly<{
  process: ProcessResult;
  source: SourceResult;
  lastDataSequence: number;
}>;

export type AuthorityResult =
  | Readonly<{ kind: 'applied'; finalRevision: number; throughDataSequence: number }>
  | Readonly<{ kind: 'failed'; throughDataSequence: number; reason: string }>;

export interface LaunchSpec {
  readonly file: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly cols?: number;
  readonly rows?: number;
  readonly stopStrategy?: ExecutionStopStrategy;
}

export type ExecutionStopStrategy = 'hangup' | 'interrupt-then-hangup';

export const EXECUTION_INTERACTION_LIMITS = Object.freeze({
  pendingOperations: 4,
  pendingInputBytes: 32768,
  observationMs: 5000
});

export type ExecutionInteractionResult =
  | Readonly<{ kind: 'written'; writtenBytes: number }>
  | Readonly<{ kind: 'resized' }>
  | Readonly<{ kind: 'cancelled' | 'failed' | 'unconfirmed'; reason: string; writtenBytes?: number }>;

export type StartResult =
  | Readonly<{ kind: 'started'; pid: number }>
  | Readonly<{ kind: 'rejected-before-acquire'; reason: string }>
  | Readonly<{ kind: 'failed' | 'unconfirmed'; stage: string; reason: string }>;

export interface CommandResult {
  readonly kind: 'accepted' | 'unsupported' | 'failed' | 'unconfirmed';
  readonly reason?: string;
}

export type OperationResult = StartResult | CommandResult;

export type ProviderMessage = Readonly<{ identity: ExecutionIdentity }> & (
  | Readonly<{ type: 'ready'; capabilities: readonly ExecutionProviderCapability[] }>
  | Readonly<{ type: 'operationObservation'; operationId: string; result: OperationResult }>
  | Readonly<{ type: 'interactionObservation'; interactionId: number; result: ExecutionInteractionResult }>
  | Readonly<{ type: 'processResult'; result: ProcessResult }>
  | Readonly<{ type: 'resourceAcquired'; resourceId: string }>
  | Readonly<{ type: 'resourceResult'; resourceId: string; operationId: string; result: ResourceResult }>
  | Readonly<{ type: 'sourceEnd'; finalFrameId: number; disposition: SourceDisposition }>
);

export type OutputAcknowledgement = Readonly<{
  type: 'accepted' | 'consumed';
  identity: ExecutionIdentity;
  throughFrameId: number;
}>;

export type ParentMessage =
  | Readonly<{ type: 'start'; identity: ExecutionIdentity; operationId: string; spec: LaunchSpec }>
  | Readonly<{
    type: 'requestStop'; identity: ExecutionIdentity; operationId: string; mode: 'graceful' | 'force';
  }>
  | Readonly<{ type: 'cancelOutput'; identity: ExecutionIdentity; operationId: string; reason: string }>
  | Readonly<{ type: 'input'; identity: ExecutionIdentity; interactionId: number; data: string }>
  | Readonly<{ type: 'resize'; identity: ExecutionIdentity; interactionId: number; cols: number; rows: number }>
  | Readonly<{ type: 'sourceEndAccepted'; identity: ExecutionIdentity; finalFrameId: number }>
  | OutputAcknowledgement;

export interface OutputFrame {
  readonly version: 1;
  readonly identity: ExecutionIdentity;
  readonly frameId: number;
  readonly text: string;
}

export interface DataBatch {
  readonly identity: ExecutionIdentity;
  readonly frameId: number;
  readonly sequence: number;
  readonly text: string;
  readonly byteLength: number;
}

export const S1_LIMITS = Object.freeze({
  payloadBytes: 32768,
  pendingBytes: 262144,
  pendingFrames: 16,
  framesPerTurn: 4,
  controlBytes: 4096,
  startBytes: 65536,
  normalSlots: 8,
  urgentSlots: 4,
  executions: 2,
  starting: 1
});

export type ExecutionAdmissionLimits =
  | Readonly<{ executions: number; starting: number; pending?: never }>
  | Readonly<{ executions: null; starting: number; pending: number }>;

export const EXECUTION_PRODUCTION_ADMISSION: ExecutionAdmissionLimits = Object.freeze({
  executions: null, starting: 1, pending: 2
});

export function normalizeExecutionAdmissionLimits(value?: ExecutionAdmissionLimits): ExecutionAdmissionLimits {
  const record = value === undefined ? S1_LIMITS
    : readRecord(value, 'Execution admission limits', ['executions', 'starting', 'pending']);
  const starting = readInteger(record.starting, 'Execution admission starting', 1);
  if (record.executions === null) {
    const pending = readInteger('pending' in record ? record.pending : undefined, 'Execution admission pending', 1);
    if (starting > pending) throw new RangeError('Execution admission starting must not exceed pending capacity.');
    return Object.freeze({ executions: null, starting, pending });
  }
  if ('pending' in record) throw new TypeError('Finite execution admission does not accept pending capacity.');
  const executions = readInteger(record.executions, 'Execution admission executions', 1);
  if (starting > executions) throw new RangeError('Execution admission starting must not exceed executions.');
  return Object.freeze({ executions, starting });
}

export function hasExecutionAdmissionCapacity(
  limits: ExecutionAdmissionLimits, counts: Readonly<{ executions: number; pending: number }>
): boolean {
  return limits.executions === null ? counts.pending < limits.pending : counts.executions < limits.executions;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

export function assertExecutionIdentity(value: unknown): asserts value is ExecutionIdentity {
  copyExecutionIdentity(value);
}

export function sameExecutionIdentity(left: ExecutionIdentity, right: ExecutionIdentity): boolean {
  return left.executionId === right.executionId && left.generation === right.generation;
}

export function validateLaunchSpec(value: unknown): LaunchSpec {
  const record = readRecord(value, 'launch spec', ['file', 'args', 'cwd', 'env', 'cols', 'rows', 'stopStrategy']);
  const file = readString(record.file, 'launch file');
  if (!Array.isArray(record.args)) {
    throw new TypeError('Launch args must be an array.');
  }
  const args = Object.freeze(Array.from(record.args, (arg) => readString(arg, 'launch argument', true)));
  const cwd = record.cwd === undefined ? undefined : readString(record.cwd, 'launch cwd');
  if ((record.cols === undefined) !== (record.rows === undefined)) throw new TypeError('Launch dimensions must be paired.');
  const dimensions = record.cols === undefined ? {} : validateExecutionDimensions(record.cols, record.rows);
  if (record.stopStrategy !== undefined && record.stopStrategy !== 'hangup' && record.stopStrategy !== 'interrupt-then-hangup') {
    throw new TypeError('Unknown execution stop strategy.');
  }
  let env: Readonly<Record<string, string>> | undefined;
  if (record.env !== undefined) {
    const environment = readRecord(record.env, 'launch env');
    const copy: Record<string, string> = Object.create(null);
    for (const [key, entry] of Object.entries(environment)) {
      readString(key, 'environment key');
      copy[key] = readString(entry, 'environment value', true);
    }
    env = Object.freeze(copy);
  }
  const spec: LaunchSpec = Object.freeze({
    file,
    args,
    ...(cwd === undefined ? {} : { cwd }),
    ...(env === undefined ? {} : { env }),
    ...dimensions,
    ...(record.stopStrategy === undefined ? {} : { stopStrategy: record.stopStrategy })
  });
  assertEncodedSize(spec, S1_LIMITS.startBytes, 'Launch spec');
  return spec;
}

export function validateExecutionDimensions(cols: unknown, rows: unknown): Readonly<{ cols: number; rows: number }> {
  const dimensions = { cols: readInteger(cols, 'terminal cols', 1), rows: readInteger(rows, 'terminal rows', 1) };
  if (dimensions.cols > 1000 || dimensions.rows > 1000) throw new RangeError('Terminal dimensions exceed the supported limit.');
  return Object.freeze(dimensions);
}

export function assertCandidateLaunchSpec(spec: LaunchSpec): void {
  if (spec.cols === undefined || spec.rows === undefined || spec.stopStrategy === undefined) {
    throw new Error('Execution candidate requires initial dimensions and an explicit stop strategy.');
  }
}

export function parseExecutionInteractionResult(value: unknown): ExecutionInteractionResult {
  const result = readRecord(value, 'interaction result');
  switch (result.kind) {
    case 'written':
      assertKeys(result, ['kind', 'writtenBytes']);
      return Object.freeze({ kind: 'written', writtenBytes: readInteger(result.writtenBytes, 'written bytes', 0) });
    case 'resized':
      assertKeys(result, ['kind']);
      return Object.freeze({ kind: 'resized' });
    case 'cancelled':
    case 'failed':
    case 'unconfirmed':
      assertKeys(result, ['kind', 'reason', 'writtenBytes']);
      return Object.freeze({ kind: result.kind, reason: readString(result.reason, 'interaction reason'),
        ...(result.writtenBytes === undefined ? {} : { writtenBytes: readInteger(result.writtenBytes, 'written bytes', 0) }) });
    default:
      throw new TypeError('Unknown interaction result.');
  }
}

export function parseProviderMessage(value: unknown): ProviderMessage {
  const record = readRecord(value, 'provider message');
  const identity = copyExecutionIdentity(record.identity);
  let message: ProviderMessage;
  switch (record.type) {
    case 'ready': {
      assertKeys(record, ['type', 'identity', 'capabilities']);
      if (!Array.isArray(record.capabilities) || !record.capabilities.includes('execution-lifecycle-v1') ||
          new Set(record.capabilities).size !== record.capabilities.length ||
          record.capabilities.some(capability => capability !== 'execution-lifecycle-v1' && capability !== 'terminal-interaction-v1')) {
        throw new TypeError('Provider capabilities must contain lifecycle and only known optional capabilities.');
      }
      message = Object.freeze({
        type: 'ready', identity, capabilities: Object.freeze([...record.capabilities] as ExecutionProviderCapability[])
      });
      break;
    }
    case 'operationObservation':
      assertKeys(record, ['type', 'identity', 'operationId', 'result']);
      message = Object.freeze({
        type: 'operationObservation', identity,
        operationId: readString(record.operationId, 'operation id'),
        result: parseOperationResult(record.result)
      });
      break;
    case 'interactionObservation':
      assertKeys(record, ['type', 'identity', 'interactionId', 'result']);
      message = Object.freeze({ type: 'interactionObservation', identity,
        interactionId: readInteger(record.interactionId, 'interaction id', 1),
        result: parseExecutionInteractionResult(record.result) });
      break;
    case 'processResult':
      assertKeys(record, ['type', 'identity', 'result']);
      message = Object.freeze({ type: 'processResult', identity, result: parseProcessResult(record.result) });
      break;
    case 'resourceAcquired':
      assertKeys(record, ['type', 'identity', 'resourceId']);
      message = Object.freeze({
        type: 'resourceAcquired', identity, resourceId: readString(record.resourceId, 'resource id')
      });
      break;
    case 'resourceResult':
      assertKeys(record, ['type', 'identity', 'resourceId', 'operationId', 'result']);
      message = Object.freeze({
        type: 'resourceResult', identity,
        resourceId: readString(record.resourceId, 'resource id'),
        operationId: readString(record.operationId, 'operation id'),
        result: parseResourceResult(record.result)
      });
      break;
    case 'sourceEnd':
      assertKeys(record, ['type', 'identity', 'finalFrameId', 'disposition']);
      message = Object.freeze({
        type: 'sourceEnd', identity,
        finalFrameId: readInteger(record.finalFrameId, 'final frame id', 0),
        disposition: parseSourceDisposition(record.disposition)
      });
      break;
    default:
      throw new TypeError('Unknown provider message type.');
  }
  assertEncodedSize(message, S1_LIMITS.controlBytes, 'Provider message');
  return message;
}

export function parseParentMessage(value: unknown): ParentMessage {
  const record = readRecord(value, 'parent message');
  const identity = copyExecutionIdentity(record.identity);
  let message: ParentMessage;
  switch (record.type) {
    case 'start':
      assertKeys(record, ['type', 'identity', 'operationId', 'spec']);
      message = Object.freeze({
        type: 'start', identity, operationId: readString(record.operationId, 'operation id'),
        spec: validateLaunchSpec(record.spec)
      });
      break;
    case 'requestStop':
      assertKeys(record, ['type', 'identity', 'operationId', 'mode']);
      if (record.mode !== 'graceful' && record.mode !== 'force') {
        throw new TypeError('Stop mode must be graceful or force.');
      }
      message = Object.freeze({
        type: 'requestStop', identity, operationId: readString(record.operationId, 'operation id'),
        mode: record.mode
      });
      break;
    case 'cancelOutput':
      assertKeys(record, ['type', 'identity', 'operationId', 'reason']);
      message = Object.freeze({
        type: 'cancelOutput', identity, operationId: readString(record.operationId, 'operation id'),
        reason: readString(record.reason, 'cancel reason')
      });
      break;
    case 'input':
      assertKeys(record, ['type', 'identity', 'interactionId', 'data']);
      message = Object.freeze({ type: 'input', identity,
        interactionId: readInteger(record.interactionId, 'interaction id', 1),
        data: readString(record.data, 'terminal input') });
      break;
    case 'resize':
      assertKeys(record, ['type', 'identity', 'interactionId', 'cols', 'rows']);
      message = Object.freeze({ type: 'resize', identity,
        interactionId: readInteger(record.interactionId, 'interaction id', 1),
        ...validateExecutionDimensions(record.cols, record.rows) });
      break;
    case 'accepted':
    case 'consumed':
      message = parseAcknowledgement(record);
      break;
    case 'sourceEndAccepted':
      assertKeys(record, ['type', 'identity', 'finalFrameId']);
      message = Object.freeze({
        type: 'sourceEndAccepted', identity, finalFrameId: readInteger(record.finalFrameId, 'final frame id', 0)
      });
      break;
    default:
      throw new TypeError('Unknown parent message type.');
  }
  assertEncodedSize(message, message.type === 'start' ? S1_LIMITS.startBytes : S1_LIMITS.controlBytes,
    'Parent message');
  return message;
}

export function assertParentMessageSize(value: ParentMessage): void {
  parseParentMessage(value);
}

export function encodeOutputFrame(value: OutputFrame): Uint8Array {
  const frame = parseOutputFrame(value);
  const payload = textEncoder.encode(JSON.stringify(frame));
  if (payload.byteLength > S1_LIMITS.payloadBytes) {
    throw new RangeError('Output payload exceeds the S1 byte limit.');
  }
  const encoded = new Uint8Array(4 + payload.byteLength);
  new DataView(encoded.buffer).setUint32(0, payload.byteLength, false);
  encoded.set(payload, 4);
  return encoded;
}

export function decodeOutputPayload(payload: Uint8Array): OutputFrame {
  if (!(payload instanceof Uint8Array) || payload.byteLength === 0 ||
      payload.byteLength > S1_LIMITS.payloadBytes) {
    throw new RangeError('Output payload must contain 1 to 32768 bytes.');
  }
  const snapshot = Uint8Array.from(payload);
  return parseOutputFrame(JSON.parse(textDecoder.decode(snapshot)));
}

export class OutputCreditWindow {
  private readonly identity: ExecutionIdentity;
  private readonly costs = new Map<number, number>();
  private pendingBytes = 0;
  private acceptedThrough = 0;
  private consumedThrough = 0;
  private sentThrough = 0;

  public constructor(identity: ExecutionIdentity) {
    this.identity = copyExecutionIdentity(identity);
  }

  public reserve(value: OutputFrame): Uint8Array {
    const frame = parseOutputFrame(value);
    if (!sameExecutionIdentity(frame.identity, this.identity)) {
      throw new TypeError('Output frame belongs to a different execution.');
    }
    if (frame.frameId !== this.sentThrough + 1) {
      throw new RangeError('Output frame ids must be contiguous.');
    }
    const encoded = encodeOutputFrame(frame);
    if (this.costs.size >= S1_LIMITS.pendingFrames ||
        this.pendingBytes + encoded.byteLength > S1_LIMITS.pendingBytes) {
      throw new RangeError('Output credit exhausted.');
    }
    this.costs.set(frame.frameId, encoded.byteLength);
    this.pendingBytes += encoded.byteLength;
    this.sentThrough = frame.frameId;
    return encoded;
  }

  public acknowledge(value: OutputAcknowledgement): void {
    const message = parseAcknowledgement(value);
    assertEncodedSize(message, S1_LIMITS.controlBytes, 'Output acknowledgement');
    if (!sameExecutionIdentity(message.identity, this.identity)) {
      throw new TypeError('Acknowledgement belongs to a different execution.');
    }
    const through = message.throughFrameId;
    const previous = message.type === 'accepted' ? this.acceptedThrough : this.consumedThrough;
    if (through < previous || through > this.sentThrough) {
      throw new RangeError('Acknowledgement is outside the valid frame range.');
    }
    if (message.type === 'accepted') {
      this.acceptedThrough = through;
      return;
    }
    if (through > this.acceptedThrough) {
      throw new RangeError('Consumption cannot precede acceptance.');
    }
    // Acceptance transfers buffer ownership; only consumption restores credit.
    for (const [frameId, cost] of this.costs) {
      if (frameId > through) {
        break;
      }
      this.pendingBytes -= cost;
      this.costs.delete(frameId);
    }
    this.consumedThrough = through;
  }

  public snapshot(): Readonly<{
    pendingBytes: number;
    pendingFrames: number;
    acceptedThrough: number;
    consumedThrough: number;
    sentThrough: number;
  }> {
    return Object.freeze({
      pendingBytes: this.pendingBytes,
      pendingFrames: this.costs.size,
      acceptedThrough: this.acceptedThrough,
      consumedThrough: this.consumedThrough,
      sentThrough: this.sentThrough
    });
  }
}

function copyExecutionIdentity(value: unknown): ExecutionIdentity {
  const record = readRecord(value, 'execution identity', ['executionId', 'generation']);
  return Object.freeze({
    executionId: readString(record.executionId, 'execution id'),
    generation: readString(record.generation, 'generation')
  });
}

function parseOutputFrame(value: unknown): OutputFrame {
  const record = readRecord(value, 'output frame', ['version', 'identity', 'frameId', 'text']);
  if (record.version !== 1) {
    throw new TypeError('Unsupported output frame version.');
  }
  return Object.freeze({
    version: 1,
    identity: copyExecutionIdentity(record.identity),
    frameId: readInteger(record.frameId, 'frame id', 1),
    text: readString(record.text, 'output text')
  });
}

function parseAcknowledgement(value: unknown): OutputAcknowledgement {
  const record = readRecord(value, 'output acknowledgement', ['type', 'identity', 'throughFrameId']);
  if (record.type !== 'accepted' && record.type !== 'consumed') {
    throw new TypeError('Unknown output acknowledgement type.');
  }
  return Object.freeze({
    type: record.type,
    identity: copyExecutionIdentity(record.identity),
    throughFrameId: readInteger(record.throughFrameId, 'acknowledgement frame id', 0)
  });
}

function parseOperationResult(value: unknown): OperationResult {
  const record = readRecord(value, 'operation result');
  switch (record.kind) {
    case 'started':
      assertKeys(record, ['kind', 'pid']);
      return Object.freeze({ kind: 'started', pid: readInteger(record.pid, 'process id', 1) });
    case 'rejected-before-acquire':
      assertKeys(record, ['kind', 'reason']);
      return Object.freeze({ kind: 'rejected-before-acquire', reason: readString(record.reason, 'reason') });
    case 'failed':
    case 'unconfirmed':
      if (record.stage !== undefined) {
        assertKeys(record, ['kind', 'stage', 'reason']);
        return Object.freeze({
          kind: record.kind, stage: readString(record.stage, 'operation stage'),
          reason: readString(record.reason, 'reason')
        });
      }
      return parseCommandResult(record);
    case 'accepted':
    case 'unsupported':
      return parseCommandResult(record);
    default:
      throw new TypeError('Unknown operation result kind.');
  }
}

function parseCommandResult(record: Record<string, unknown>): CommandResult {
  assertKeys(record, ['kind', 'reason']);
  const kind = record.kind;
  if (kind !== 'accepted' && kind !== 'unsupported' && kind !== 'failed' && kind !== 'unconfirmed') {
    throw new TypeError('Unknown command result kind.');
  }
  const reason = record.reason === undefined ? undefined : readString(record.reason, 'reason');
  return Object.freeze({ kind, ...(reason === undefined ? {} : { reason }) });
}

function parseProcessResult(value: unknown): ProcessResult {
  const record = readRecord(value, 'process result');
  switch (record.kind) {
    case 'exited': {
      assertKeys(record, ['kind', 'exitCode', 'signal']);
      const signal = record.signal === undefined ? undefined : readString(record.signal, 'exit signal');
      return Object.freeze({
        kind: 'exited', exitCode: readInteger(record.exitCode, 'exit code'),
        ...(signal === undefined ? {} : { signal })
      });
    }
    case 'signaled':
      assertKeys(record, ['kind', 'signal']);
      return Object.freeze({ kind: 'signaled', signal: readString(record.signal, 'exit signal') });
    case 'terminated':
    case 'unconfirmed':
      assertKeys(record, ['kind', 'reason']);
      return Object.freeze({ kind: record.kind, reason: readString(record.reason, 'reason') });
    default:
      throw new TypeError('Unknown process result kind.');
  }
}

function parseResourceResult(value: unknown): ResourceResult {
  const record = readRecord(value, 'resource result');
  switch (record.kind) {
    case 'released':
      assertKeys(record, ['kind']);
      return Object.freeze({ kind: 'released' });
    case 'retained':
    case 'failed':
    case 'unknown':
      assertKeys(record, ['kind', 'reason']);
      return Object.freeze({ kind: record.kind, reason: readString(record.reason, 'reason') });
    default:
      throw new TypeError('Unknown resource result kind.');
  }
}

function parseSourceDisposition(value: unknown): SourceDisposition {
  const record = readRecord(value, 'source disposition');
  switch (record.kind) {
    case 'eof':
      assertKeys(record, ['kind']);
      return Object.freeze({ kind: 'eof' });
    case 'interrupted':
    case 'error':
    case 'unknown':
      assertKeys(record, ['kind', 'reason']);
      return Object.freeze({ kind: record.kind, reason: readString(record.reason, 'reason') });
    default:
      throw new TypeError('Unknown source disposition kind.');
  }
}

function readRecord(value: unknown, label: string, keys?: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw new TypeError(`${label} must be a plain object.`);
  }
  const record: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      throw new TypeError(`${label} must contain enumerable data fields only.`);
    }
    record[key] = descriptor.value;
  }
  if (keys) {
    assertKeys(record, keys);
  }
  return record;
}

function assertKeys(record: Record<string, unknown>, keys: readonly string[]): void {
  for (const key of Object.keys(record)) {
    if (!keys.includes(key)) {
      throw new TypeError(`Unexpected protocol field: ${key}.`);
    }
  }
}

function readString(value: unknown, label: string, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0)) {
    throw new TypeError(`${label} must be ${allowEmpty ? 'a string' : 'a nonempty string'}.`);
  }
  return value;
}

function readInteger(value: unknown, label: string, minimum = Number.MIN_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    throw new TypeError(`${label} must be a safe integer >= ${minimum}.`);
  }
  return value;
}

function assertEncodedSize(value: object, maximum: number, label: string): void {
  if (textEncoder.encode(JSON.stringify(value)).byteLength > maximum) {
    throw new RangeError(`${label} exceeds the S1 byte limit.`);
  }
}
