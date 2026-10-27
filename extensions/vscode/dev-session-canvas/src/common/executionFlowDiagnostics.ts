/** Short, opt-in local traces. Never retain message bodies or terminal text. */
export const EXECUTION_FLOW_DURATION_MS = 120_000;
export const FLOW_STAGES = [
  'input-dispatch', 'input-ack', 'input-host', 'input-write-start', 'input-write', 'state-build',
  'state-options-build', 'state-options-set', 'state-canvas-build', 'state-runtime-build', 'state-diff', 'state-sidebar-notify',
  'message-post', 'message-handle', 'message-roundtrip', 'page-request',
  'page-roundtrip', 'page-host-request', 'page-host', 'page-queue', 'page-apply', 'host-loop', 'webview-loop'
] as const;
export type FlowStage = typeof FLOW_STAGES[number];
export const FLOW_DURATION_BUCKETS_MS = [1, 4, 16, 50, 100, 250, 500, 1000, 2500, 5000, 15000, 60000];
const DETAIL_LIMIT = 64;
const NODE_LIMIT = 128;
const numberFields = ['durationMs', 'sequence', 'afterRevision', 'revision', 'headRevision', 'bytes', 'events',
  'processingMs', 'measurementMs', 'supervisorQueueMs', 'supervisorReadMs', 'supervisorTotalMs'] as const;
const stringFields = ['nodeId', 'sessionId', 'requestId', 'messageType', 'reason'] as const;
export interface FlowSample {
  stage: FlowStage;
  atMs: number;
  durationMs?: number;
  nodeId?: string;
  sessionId?: string;
  requestId?: string;
  messageType?: string;
  reason?: string;
  sequence?: number;
  afterRevision?: number;
  revision?: number;
  headRevision?: number;
  bytes?: number;
  events?: number;
  processingMs?: number;
  measurementMs?: number;
  supervisorQueueMs?: number;
  supervisorReadMs?: number;
  supervisorTotalMs?: number;
  success?: boolean;
}
export interface FlowAggregate {
  stage: FlowStage;
  second?: number;
  messageType?: string;
  nodeId?: string;
  reason?: string;
  count: number;
  bytes: number;
  failures: number;
  durationCount: number;
  totalDurationMs: number;
  maxDurationMs: number;
  durationBuckets: number[];
}
export interface FlowSnapshot {
  schema: 1;
  traceId: string;
  startedEpochMs: number;
  elapsedMs: number;
  durationMs: number;
  stopped: boolean;
  droppedDetails: number;
  droppedNodeGroups: number;
  details: FlowSample[];
  seconds: FlowAggregate[];
  groups: FlowAggregate[];
}
export interface FlowToken { traceId: string; started: number }
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1e15;
const id = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 256;
export function normalizeFlowSample(value: unknown): FlowSample | undefined {
  if (!object(value) || !FLOW_STAGES.includes(value.stage as FlowStage) || !finite(value.atMs)) return undefined;
  const result: FlowSample = { stage: value.stage as FlowStage, atMs: value.atMs };
  for (const key of numberFields) if (finite(value[key])) result[key] = value[key] as number;
  for (const key of stringFields) if (id(value[key])) result[key] = value[key] as string;
  if (typeof value.success === 'boolean') result.success = value.success;
  return result;
}
function aggregate(stage: FlowStage): FlowAggregate {
  return { stage, count: 0, bytes: 0, failures: 0, durationCount: 0, totalDurationMs: 0,
    maxDurationMs: 0, durationBuckets: Array(FLOW_DURATION_BUCKETS_MS.length + 1).fill(0) };
}
function add(target: FlowAggregate, sample: FlowSample): void {
  target.count++;
  target.bytes += sample.bytes ?? 0;
  if (sample.success === false) target.failures++;
  if (sample.durationMs === undefined) return;
  target.durationCount++;
  target.totalDurationMs += sample.durationMs;
  target.maxDurationMs = Math.max(target.maxDurationMs, sample.durationMs);
  const index = FLOW_DURATION_BUCKETS_MS.findIndex(bound => sample.durationMs! <= bound);
  target.durationBuckets[index < 0 ? FLOW_DURATION_BUCKETS_MS.length : index]++;
}
export class ExecutionFlowRecorder {
  private traceId: string | undefined;
  private started = 0;
  private epoch = 0;
  private duration = 0;
  private stoppedAt: number | undefined;
  private details = new Map<FlowStage, FlowSample[]>();
  private seconds = new Map<string, FlowAggregate>();
  private nodes = new Map<string, FlowAggregate>();
  private droppedDetails = 0;
  private droppedNodeGroups = 0;
  public constructor(private readonly now: () => number = () => performance.now()) {}
  public start(traceId: string, durationMs = EXECUTION_FLOW_DURATION_MS): void {
    if (!id(traceId) || !finite(durationMs) || durationMs <= 0) return;
    this.traceId = traceId; this.started = this.now(); this.epoch = Date.now();
    this.duration = Math.min(durationMs, EXECUTION_FLOW_DURATION_MS); this.stoppedAt = undefined;
    this.details.clear(); this.seconds.clear(); this.nodes.clear(); this.droppedDetails = 0; this.droppedNodeGroups = 0;
  }
  public stop(): void { if (this.traceId && this.stoppedAt === undefined) this.stoppedAt = this.now(); }
  public get active(): boolean {
    return !!this.traceId && this.stoppedAt === undefined && this.now() - this.started < this.duration;
  }
  public get currentTraceId(): string | undefined { return this.traceId; }
  public get remainingMs(): number { return this.active ? Math.max(0, this.duration - (this.now() - this.started)) : 0; }
  public begin(): FlowToken | undefined { return this.active ? { traceId: this.traceId!, started: this.now() } : undefined; }
  public finish(token: FlowToken | undefined, sample: Omit<FlowSample, 'atMs'>): void {
    if (!token || token.traceId !== this.traceId || !this.active) return;
    this.record({ ...sample, durationMs: this.now() - token.started });
  }
  /** Measure synchronous work only; keep the operation's return value and thrown error. */
  public measureSync<T>(sample: Omit<FlowSample, 'atMs' | 'durationMs' | 'success'>, operation: () => T): T {
    const token = this.begin();
    if (!token) return operation();
    let success = false;
    try {
      const result = operation();
      success = true;
      return result;
    } finally {
      this.finish(token, { ...sample, success });
    }
  }
  public record(value: Omit<FlowSample, 'atMs'>): void {
    if (!this.active) return;
    const sample = normalizeFlowSample({ ...value, atMs: this.now() - this.started });
    if (!sample) return;
    const detail = this.details.get(sample.stage) ?? [];
    if (detail.length >= DETAIL_LIMIT) { detail.shift(); this.droppedDetails++; }
    detail.push(sample); this.details.set(sample.stage, detail);
    const second = Math.min(119, Math.floor(sample.atMs / 1000));
    // Preserve the state broadcast rate separately from other bridge traffic.
    const messageType = sample.messageType === 'host/stateUpdated' || sample.messageType === 'host/stateDelta' ? sample.messageType : undefined;
    const key = JSON.stringify([second, sample.stage, messageType]);
    const bucket = this.seconds.get(key) ?? { ...aggregate(sample.stage), second, ...(messageType ? { messageType } : {}) };
    add(bucket, sample); this.seconds.set(key, bucket);
    if (sample.nodeId || sample.reason || sample.messageType) {
      const key = JSON.stringify([sample.stage, sample.nodeId, sample.reason, sample.messageType]);
      let node = this.nodes.get(key);
      if (!node && this.nodes.size >= NODE_LIMIT) { this.droppedNodeGroups++; return; }
      node ??= { ...aggregate(sample.stage), ...(sample.nodeId ? { nodeId: sample.nodeId } : {}),
        ...(sample.reason ? { reason: sample.reason } : {}),
        ...(sample.messageType ? { messageType: sample.messageType } : {}) };
      add(node, sample); this.nodes.set(key, node);
    }
  }
  public snapshot(): FlowSnapshot | undefined {
    if (!this.traceId) return undefined;
    return JSON.parse(JSON.stringify({ schema: 1, traceId: this.traceId, startedEpochMs: this.epoch,
      elapsedMs: Math.min(this.duration, (this.stoppedAt ?? this.now()) - this.started), durationMs: this.duration,
      stopped: !this.active, droppedDetails: this.droppedDetails, droppedNodeGroups: this.droppedNodeGroups,
      details: [...this.details.values()].flat().sort((a, b) => a.atMs - b.atMs),
      seconds: [...this.seconds.values()], groups: [...this.nodes.values()] }));
  }
}
/** Validate untrusted Webview exports and strip unknown fields before saving. */
export function normalizeFlowSnapshot(value: unknown): FlowSnapshot | undefined {
  if (!object(value) || value.schema !== 1 || !id(value.traceId) || typeof value.stopped !== 'boolean' ||
      !['startedEpochMs', 'elapsedMs', 'durationMs', 'droppedDetails', 'droppedNodeGroups'].every(k => finite(value[k])) ||
      (value.durationMs as number) > EXECUTION_FLOW_DURATION_MS || (value.elapsedMs as number) > (value.durationMs as number) ||
      !Array.isArray(value.details) || value.details.length > FLOW_STAGES.length * DETAIL_LIMIT ||
      !Array.isArray(value.seconds) || value.seconds.length > FLOW_STAGES.length * 120 * 3 ||
      !Array.isArray(value.groups) || value.groups.length > NODE_LIMIT) return undefined;
  const details = value.details.map(normalizeFlowSample);
  if (details.some(x => !x)) return undefined;
  const parseAggregate = (v: unknown): FlowAggregate | undefined => {
    if (!object(v) || !FLOW_STAGES.includes(v.stage as FlowStage) ||
        !['count', 'bytes', 'failures', 'durationCount', 'totalDurationMs', 'maxDurationMs'].every(k => finite(v[k])) ||
        !Array.isArray(v.durationBuckets) || v.durationBuckets.length !== FLOW_DURATION_BUCKETS_MS.length + 1 ||
        !v.durationBuckets.every(finite) || (v.second !== undefined && (!Number.isInteger(v.second) || (v.second as number) < 0 || (v.second as number) > 119)) ||
        (v.messageType !== undefined && !id(v.messageType)) || (v.nodeId !== undefined && !id(v.nodeId)) || (v.reason !== undefined && !id(v.reason))) return undefined;
    return { stage: v.stage as FlowStage, count: v.count as number, bytes: v.bytes as number,
      failures: v.failures as number, durationCount: v.durationCount as number, totalDurationMs: v.totalDurationMs as number,
      maxDurationMs: v.maxDurationMs as number, durationBuckets: [...v.durationBuckets] as number[],
      ...(v.messageType ? { messageType: v.messageType as string } : {}),
      ...(v.reason ? { reason: v.reason as string } : {}),
      ...(v.second !== undefined ? { second: v.second as number } : {}), ...(v.nodeId ? { nodeId: v.nodeId as string } : {}) };
  };
  const seconds = value.seconds.map(parseAggregate), nodes = value.groups.map(parseAggregate);
  if (seconds.some(x => !x) || nodes.some(x => !x)) return undefined;
  return { schema: 1, traceId: value.traceId, startedEpochMs: value.startedEpochMs as number,
    elapsedMs: value.elapsedMs as number, durationMs: value.durationMs as number, stopped: value.stopped,
    droppedDetails: value.droppedDetails as number, droppedNodeGroups: value.droppedNodeGroups as number,
    details: details as FlowSample[], seconds: seconds as FlowAggregate[], groups: nodes as FlowAggregate[] };
}
