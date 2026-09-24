import {
  assertExecutionIdentity,
  assertParentMessageSize,
  decodeOutputPayload,
  parseProviderMessage,
  sameExecutionIdentity,
  S1_LIMITS,
  validateLaunchSpec,
  type AuthorityResult,
  type DataBatch,
  type ExecutionIdentity,
  type LaunchSpec,
  type OperationResult,
  type OutputSeal,
  type ParentMessage,
  type ProcessResult,
  type ProviderMessage,
  type ResourceResult,
  type SourceResult
} from '../common/executionLifecycle';

export interface ExecutionScheduler {
  now(): number;
  // Queue a task, never a synchronous callback or a recursively drained microtask.
  scheduleTask(callback: () => void): void;
  scheduleDeadline(deadline: number, callback: () => void): () => void;
}

export interface ExecutionTransportSink {
  message(value: unknown): void;
  data(bytes: Uint8Array): void;
  disconnected(reason: string): void;
  exited(): void;
  dataEnded(): void;
  dataClosed(reason: string): void;
  controlResourceResult(result: ResourceResult): void;
  startupFailed(reason: string): void;
  transportFault(reason: string): void;
  resourceAcquired(resourceId: string): void;
}

export interface ExecutionTransport {
  connect(sink: ExecutionTransportSink): void;
  send(message: ParentMessage): Promise<void>;
}

export interface ExecutionObserver {
  data(batch: DataBatch): void;
  processResult(identity: ExecutionIdentity, result: ProcessResult): void;
  outputSeal(seal: OutputSeal): void;
  resourceResult(identity: ExecutionIdentity, resourceId: string, result: ResourceResult): void;
  fault(identity: ExecutionIdentity, reason: string): void;
}

export interface OperationObservation {
  readonly first: Promise<OperationResult>;
  readonly current: OperationResult | undefined;
}

type OperationKind = 'start' | 'graceful' | 'force' | 'cancel';
type State = 'prepared' | 'bound' | 'starting' | 'running' | 'closing' | 'settled';
type Operation = {
  id: string;
  kind: OperationKind;
  reason?: string;
  deadline: number;
  view: OperationObservation;
  current?: OperationResult;
  sent: boolean;
  resolve: (result: OperationResult) => void;
  cancelDeadline: () => void;
};
type OwnedResource = { operationId?: string; first?: ResourceResult; current?: ResourceResult };

// Admission belongs to an authority, not to each individual execution.
export class ExecutionAuthority {
  private readonly executions = new Map<string, { identity: ExecutionIdentity; execution: PreparedExecution }>();
  private readonly starting = new Set<ExecutionIdentity>();
  private blockedReason?: string;

  reserve(identity: ExecutionIdentity, execution: PreparedExecution): void {
    if (this.blockedReason) throw new Error('Execution authority is quarantined');
    if (this.executions.has(identity.executionId)) throw new Error('Execution identity already reserved');
    if (this.executions.size >= S1_LIMITS.executions) throw new Error('Execution capacity exhausted');
    this.executions.set(identity.executionId, { identity, execution });
  }

  beginStart(identity: ExecutionIdentity): boolean {
    if (this.executions.get(identity.executionId)?.identity !== identity || this.blockedReason
      || this.starting.size >= S1_LIMITS.starting) return false;
    this.starting.add(identity);
    return true;
  }

  finishStart(identity: ExecutionIdentity): void { this.starting.delete(identity); }

  release(identity: ExecutionIdentity): void {
    if (this.executions.get(identity.executionId)?.identity !== identity) return;
    this.starting.delete(identity);
    this.executions.delete(identity.executionId);
  }

  quarantine(reason: string): void { this.blockedReason ??= reason; }

  snapshot(): Readonly<{ active: number; starting: number; blockedReason?: string }> {
    return Object.freeze({ active: this.executions.size, starting: this.starting.size, blockedReason: this.blockedReason });
  }
}

export function createExecutionAuthority(): ExecutionAuthority { return new ExecutionAuthority(); }

export interface ExecutionDependencies {
  authority: ExecutionAuthority;
  transport: ExecutionTransport;
  scheduler: ExecutionScheduler;
}

export function prepareExecution(identity: ExecutionIdentity, launchSpec: LaunchSpec, dependencies: ExecutionDependencies): PreparedExecution {
  return new PreparedExecution(identity, launchSpec, dependencies);
}

export class PreparedExecution {
  readonly identity: ExecutionIdentity;
  private readonly spec: LaunchSpec;
  private state: State = 'prepared';
  private observer?: ExecutionObserver;
  private consumeBatch?: (batches: readonly DataBatch[]) => Promise<void>;
  private readonly operations = new Map<OperationKind, Operation>();
  private readonly resources = new Map<string, OwnedResource>();
  private resourceLedgerIncomplete = false;
  private ready = false;
  private startSent = false;
  private acquired = false;
  private sendInFlight = false;
  private startMessage?: ParentMessage;
  private readonly normal = new Map<string, ParentMessage>();
  private readonly urgent = new Map<string, ParentMessage>();
  private readonly raw = new Uint8Array(S1_LIMITS.pendingBytes);
  private rawBytes = 0;
  private pendingBytes = 0;
  private acceptedThrough = 0;
  private consumedThrough = 0;
  private readonly pending: DataBatch[] = [];
  private consuming = false;
  private processingScheduled = false;
  private parsingFailed = false;
  private dataAdmissionFailed = false;
  private rejectedDataBytes = 0;
  private firstFault?: string;
  private authorityFailure?: Extract<AuthorityResult, { kind: 'failed' }>;
  private process?: ProcessResult;
  private source?: SourceResult;
  private seal?: OutputSeal;
  private controlDisconnected = false;
  private providerExited = false;
  private outputEnded = false;
  private outputClosed = false;

  constructor(identity: ExecutionIdentity, launchSpec: LaunchSpec, private readonly dependencies: ExecutionDependencies) {
    assertExecutionIdentity(identity);
    this.identity = Object.freeze({ ...identity });
    this.spec = validateLaunchSpec(launchSpec);
    // Include the envelope in the start limit, before reserving an authority slot.
    assertParentMessageSize({ type: 'start', identity: this.identity, operationId: 'prepare', spec: this.spec });
    dependencies.authority.reserve(this.identity, this);
  }

  bind(observer: ExecutionObserver, consumeBatch: (batches: readonly DataBatch[]) => Promise<void>): this {
    if (this.state !== 'prepared') throw new Error('Execution observer already bound');
    this.observer = observer;
    this.consumeBatch = consumeBatch;
    this.state = 'bound';
    return this;
  }

  start(operationId: string, deadline: number): OperationObservation {
    if (!this.observer) throw new Error('Bind execution before starting');
    const previous = this.existingOperation('start', operationId, deadline);
    if (previous) return previous.view;
    const command: ParentMessage = { type: 'start', identity: this.identity, operationId, spec: this.spec };
    assertParentMessageSize(command);
    const operation = this.makeOperation('start', operationId, deadline);
    if (!this.dependencies.authority.beginStart(this.identity)) {
      this.recordOperation(operation, { kind: 'rejected-before-acquire', reason: 'Authority start admission rejected' });
      this.state = 'settled';
      this.dependencies.authority.release(this.identity);
      return operation.view;
    }
    this.state = 'starting';
    // Once connect is entered, a thrown error cannot prove that no resource was acquired.
    this.acquired = true;
    this.resources.set('provider-control', {});
    try {
      this.dependencies.transport.connect({
        message: value => this.receiveMessage(value),
        data: bytes => this.receiveData(bytes),
        disconnected: reason => this.disconnect(reason),
        exited: () => { this.providerExited = true; this.scheduleProcessing(); },
        dataEnded: () => { this.outputEnded = true; this.scheduleProcessing(); },
        dataClosed: reason => { this.outputClosed = true; this.fault(reason); this.scheduleProcessing(); },
        controlResourceResult: result => this.recordResource('provider-control', 'provider-control-release', result),
        startupFailed: reason => this.failStartup(reason),
        transportFault: reason => this.fault(reason),
        resourceAcquired: resourceId => this.registerResource(resourceId)
      });
    } catch {
      this.recordOperation(operation, { kind: 'failed', stage: 'connect', reason: 'Transport connect failed' });
      this.loseControl('Transport connect failed after acquisition boundary');
    }
    return operation.view;
  }

  requestStop(operationId: string, mode: 'graceful' | 'force', deadline: number): OperationObservation {
    if (mode !== 'graceful' && mode !== 'force') throw new Error('Invalid stop mode');
    return this.command(mode, operationId, deadline);
  }

  cancelOutput(operationId: string, reason: string, deadline: number): OperationObservation {
    if (!reason || typeof reason !== 'string') throw new Error('Cancellation requires a reason');
    return this.command('cancel', operationId, deadline, reason);
  }

  snapshot() {
    return Object.freeze({
      identity: this.identity, state: this.state, acceptedThrough: this.acceptedThrough,
      consumedThrough: this.consumedThrough, pendingBytes: this.pendingBytes,
      pendingFrames: this.pending.length + this.countRawFrames(), rawBytes: this.rawBytes,
      rejectedDataBytes: this.rejectedDataBytes,
      resourceLedgerIncomplete: this.resourceLedgerIncomplete,
      process: this.process, source: this.source, seal: this.seal, firstFault: this.firstFault,
      authorityFailure: this.authorityFailure,
      transport: Object.freeze({ disconnected: this.controlDisconnected, exited: this.providerExited,
        dataEnded: this.outputEnded, dataClosed: this.outputClosed }),
      resources: Object.freeze(Object.fromEntries([...this.resources].map(([id, value]) => [id, Object.freeze({ ...value })])))
    });
  }

  private existingOperation(kind: OperationKind, id: string, deadline: number, reason?: string): Operation | undefined {
    if (typeof id !== 'string' || id.length === 0 || id.length > 128) throw new Error('Invalid operation id');
    if (!Number.isFinite(deadline)) throw new Error('An explicit finite observation deadline is required');
    const previous = this.operations.get(kind);
    if (previous && (previous.id !== id || previous.deadline !== deadline || previous.reason !== reason)) {
      throw new Error('Semantic operation already requested with different parameters');
    }
    if (!previous && [...this.operations.values()].some(operation => operation.id === id)) {
      throw new Error('Operation id already used');
    }
    if (!previous && deadline <= this.dependencies.scheduler.now()) throw new Error('Observation deadline must be in the future');
    return previous;
  }

  private makeOperation(kind: OperationKind, id: string, deadline: number, reason?: string): Operation {
    let resolve!: (result: OperationResult) => void;
    const first = new Promise<OperationResult>(settle => { resolve = settle; });
    const operation: Operation = {
      id, kind, deadline, reason, resolve, sent: false, cancelDeadline: () => {},
      view: Object.freeze({ first, get current() { return operation.current; } })
    };
    this.operations.set(kind, operation);
    operation.cancelDeadline = this.dependencies.scheduler.scheduleDeadline(deadline, () => {
      if (operation.current) return;
      this.recordOperation(operation, kind === 'start'
        ? { kind: 'unconfirmed', stage: this.ready ? 'start' : 'ready', reason: 'Observation deadline reached' }
        : { kind: 'unconfirmed', reason: 'Observation deadline reached' });
    });
    return operation;
  }

  private command(kind: Exclude<OperationKind, 'start'>, id: string, deadline: number, reason?: string): OperationObservation {
    if (!this.acquired) throw new Error('Execution has not acquired a provider');
    const previous = this.existingOperation(kind, id, deadline, reason);
    if (previous) return previous.view;
    if (this.state === 'settled') throw new Error('Execution is already settled');
    const message: ParentMessage = kind === 'cancel'
      ? { type: 'cancelOutput', identity: this.identity, operationId: id, reason: reason! }
      : { type: 'requestStop', identity: this.identity, operationId: id, mode: kind };
    assertParentMessageSize(message);
    const operation = this.makeOperation(kind, id, deadline, reason);
    this.state = 'closing';
    this.enqueue(message, 'urgent', kind);
    return operation.view;
  }

  private recordOperation(operation: Operation, result: OperationResult): void {
    const previous = operation.current;
    if (previous && previous.kind !== 'unconfirmed') {
      if (JSON.stringify(previous) !== JSON.stringify(result)) this.fault('Conflicting operation result');
      return;
    }
    if (previous && result.kind === 'unconfirmed') return;
    const value = Object.freeze({ ...result }) as OperationResult;
    operation.current = value;
    if (!previous) { operation.cancelDeadline(); operation.resolve(value); }
    if (result.kind === 'unconfirmed') {
      this.dependencies.authority.quarantine('Operation observation is unconfirmed');
    }
    if (operation.kind === 'start') {
      if (result.kind !== 'unconfirmed') this.dependencies.authority.finishStart(this.identity);
      if (result.kind === 'started') {
        if (this.state !== 'settled') this.state = this.operations.size > 1 || this.process || this.source ? 'closing' : 'running';
      } else if (this.state !== 'settled') this.state = 'closing';
    }
  }

  private receiveMessage(value: unknown): void {
    let message: ProviderMessage;
    try { message = parseProviderMessage(value); }
    catch { this.fault('Invalid provider control message'); return; }
    if (!sameExecutionIdentity(message.identity, this.identity)) { this.fault('Stale execution identity'); return; }
    switch (message.type) {
      case 'ready': {
        if (this.ready) return;
        if (this.state === 'settled' || this.operations.get('start')?.current?.kind === 'failed') {
          this.fault('Provider ready arrived after startup failed or settled'); return;
        }
        if (!message.capabilities.includes('execution-lifecycle-v1')) { this.fault('Missing lifecycle capability'); return; }
        this.ready = true;
        const operation = this.operations.get('start')!;
        this.enqueue({ type: 'start', identity: this.identity, operationId: operation.id, spec: this.spec }, 'start', 'start');
        break;
      }
      case 'operationObservation': {
        const operationId = message.operationId;
        const operation = [...this.operations.values()].find(item => item.id === operationId);
        if (!operation || !this.validOperationResult(operation, message.result)) { this.fault('Invalid operation observation'); return; }
        this.recordOperation(operation, message.result);
        break;
      }
      case 'processResult': this.recordProcess(message.result); break;
      case 'resourceResult':
        if (message.resourceId === 'provider-control') { this.fault('Provider cannot settle parent control resources'); return; }
        this.recordResource(message.resourceId, message.operationId, message.result); break;
      case 'sourceEnd': {
        if (!this.startSent || message.finalFrameId !== this.acceptedThrough || this.rawBytes !== 0
          || this.parsingFailed || this.dataAdmissionFailed) {
          this.fault('Source boundary does not equal the continuous accepted tail'); return;
        }
        const source = Object.freeze({ ...message.disposition, lastDataSequence: this.acceptedThrough }) as SourceResult;
        if (this.source) {
          if (JSON.stringify(this.source) !== JSON.stringify(source)) this.fault('Conflicting source result');
          return;
        }
        this.source = source;
        if (this.state !== 'settled') this.state = 'closing';
        if (source.kind === 'unknown' || source.kind === 'error') this.dependencies.authority.quarantine('Output source is not confirmed');
        this.maybeSeal();
        break;
      }
    }
  }

  private validOperationResult(operation: Operation, result: OperationResult): boolean {
    if (!operation.sent) return false;
    if (operation.kind === 'start') {
      if (!this.startSent) return false;
      return result.kind === 'started' || ((result.kind === 'failed' || result.kind === 'unconfirmed') && 'stage' in result);
    }
    return !('stage' in result) && (result.kind === 'accepted' || result.kind === 'unsupported'
      || result.kind === 'failed' || result.kind === 'unconfirmed');
  }

  private enqueue(message: ParentMessage, lane: 'normal' | 'urgent' | 'start', key: string): void {
    try { assertParentMessageSize(message); }
    catch { this.fault('Control message exceeds its bounded envelope'); return; }
    Object.freeze(message);
    if (lane === 'start') this.startMessage = message;
    else {
      const queue = lane === 'normal' ? this.normal : this.urgent;
      const capacity = lane === 'normal' ? S1_LIMITS.normalSlots : S1_LIMITS.urgentSlots;
      if (!queue.has(key) && queue.size >= capacity) { this.fault('Control queue capacity exhausted'); return; }
      queue.set(key, message);
    }
    this.pumpControl();
  }

  private pumpControl(): void {
    if (!this.ready || this.sendInFlight || this.controlDisconnected || this.providerExited) return;
    let message = this.startMessage;
    if (message) this.startMessage = undefined;
    else {
      const queue = this.urgent.size > 0 ? this.urgent : this.normal;
      // A coalesced consumed watermark may advance past the previously sent accepted.
      const entry = queue === this.normal && queue.has('accepted')
        ? ['accepted', queue.get('accepted')!] as [string, ParentMessage]
        : queue.entries().next().value as [string, ParentMessage] | undefined;
      if (!entry) return;
      queue.delete(entry[0]);
      message = entry[1];
    }
    this.sendInFlight = true;
    if (message.type === 'start') this.startSent = true;
    if ('operationId' in message) {
      const operationId = message.operationId;
      const operation = [...this.operations.values()].find(item => item.id === operationId);
      if (operation) operation.sent = true;
    }
    try {
      Promise.resolve(this.dependencies.transport.send(message)).then(() => {
        this.sendInFlight = false;
        this.pumpControl();
      }, () => { this.sendInFlight = false; this.disconnect('Control send failed'); });
    } catch { this.sendInFlight = false; this.disconnect('Control send failed'); }
  }

  private countRawFrames(extra?: Uint8Array): number {
    const length = this.rawBytes + (extra?.byteLength ?? 0);
    const byte = (offset: number) => offset < this.rawBytes ? this.raw[offset] : extra![offset - this.rawBytes];
    let frames = 0;
    for (let offset = 0; offset < length;) {
      frames++;
      if (offset + 4 > length) break;
      const size = byte(offset) * 0x1000000 + byte(offset + 1) * 0x10000 + byte(offset + 2) * 0x100 + byte(offset + 3);
      offset += 4 + size;
    }
    return frames;
  }

  private receiveData(bytes: Uint8Array): void {
    if (!(bytes instanceof Uint8Array)) { this.fault('Output is not a byte chunk'); return; }
    if (bytes.byteLength === 0) return;
    if (!this.startSent || this.source || this.outputEnded || this.outputClosed || this.parsingFailed || this.dataAdmissionFailed) {
      this.rejectedDataBytes = Math.min(Number.MAX_SAFE_INTEGER, this.rejectedDataBytes + bytes.byteLength);
      this.fault('Output arrived outside data admission'); return;
    }
    // Account before copying, including partial frames and work waiting for the next task.
    if (bytes.byteLength > S1_LIMITS.pendingBytes - this.pendingBytes
      || this.pending.length + this.countRawFrames(bytes) > S1_LIMITS.pendingFrames) {
      this.fault('Output credit exceeded before admission');
      this.rejectedDataBytes = Math.min(Number.MAX_SAFE_INTEGER, this.rejectedDataBytes + bytes.byteLength);
      this.dataAdmissionFailed = true;
      this.scheduleProcessing();
      return;
    }
    this.pendingBytes += bytes.byteLength;
    this.raw.set(bytes, this.rawBytes);
    this.rawBytes += bytes.byteLength;
    this.scheduleProcessing();
  }

  private scheduleProcessing(): void {
    if (this.processingScheduled) return;
    this.processingScheduled = true;
    this.dependencies.scheduler.scheduleTask(() => {
      this.processingScheduled = false;
      this.processFrames();
    });
  }

  private processFrames(): void {
    let processed = 0;
    while (!this.parsingFailed && !this.source && this.rawBytes >= 4 && processed < S1_LIMITS.framesPerTurn) {
      const payloadBytes = new DataView(this.raw.buffer).getUint32(0, false);
      if (payloadBytes === 0 || payloadBytes > S1_LIMITS.payloadBytes) { this.parserFault('Invalid output frame length'); break; }
      const cost = payloadBytes + 4;
      if (this.rawBytes < cost) break;
      let frame;
      try { frame = decodeOutputPayload(this.raw.subarray(4, cost)); }
      catch { this.parserFault('Invalid output frame payload'); break; }
      if (!sameExecutionIdentity(frame.identity, this.identity) || frame.frameId !== this.acceptedThrough + 1) {
        this.parserFault('Output identity or frame sequence mismatch'); break;
      }
      const batch: DataBatch = Object.freeze({ identity: this.identity, frameId: frame.frameId,
        sequence: this.acceptedThrough + 1, text: frame.text, byteLength: cost });
      // Move, rather than release, the reservation from raw bytes to accepted content.
      this.raw.copyWithin(0, cost, this.rawBytes);
      this.rawBytes -= cost;
      this.pending.push(batch);
      try { this.observer!.data(batch); }
      catch {
        this.authorityFailure = Object.freeze({ kind: 'failed', throughDataSequence: this.consumedThrough, reason: 'Authority acceptance failed' });
        this.parserFault('Authority acceptance failed');
        break;
      }
      this.acceptedThrough = frame.frameId;
      this.enqueue({ type: 'accepted', identity: this.identity, throughFrameId: frame.frameId }, 'normal', 'accepted');
      processed++;
    }
    this.beginConsumption();
    if (!this.parsingFailed && !this.source && this.rawBytes >= 4) {
      const nextSize = new DataView(this.raw.buffer).getUint32(0, false);
      if (this.rawBytes >= nextSize + 4) this.scheduleProcessing();
    }
    this.settleLostSource();
  }

  private parserFault(reason: string): void { this.parsingFailed = true; this.fault(reason); }

  private beginConsumption(): void {
    if (this.consuming || this.authorityFailure || this.pending.length === 0) return;
    const batch = Object.freeze(this.pending.slice(0, S1_LIMITS.framesPerTurn));
    this.consuming = true;
    try {
      Promise.resolve(this.consumeBatch!(batch)).then(() => {
        this.consuming = false;
        for (const item of batch) {
          this.pending.shift();
          this.pendingBytes -= item.byteLength;
          this.consumedThrough = item.frameId;
        }
        this.enqueue({ type: 'consumed', identity: this.identity, throughFrameId: this.consumedThrough }, 'normal', 'consumed');
        if (this.pending.length) this.dependencies.scheduler.scheduleTask(() => this.beginConsumption());
        this.maybeRetire();
      }, () => this.consumptionFailed());
    } catch { this.consumptionFailed(); }
  }

  private consumptionFailed(): void {
    this.consuming = false;
    this.authorityFailure = Object.freeze({ kind: 'failed', throughDataSequence: this.consumedThrough, reason: 'Authority consumption failed' });
    this.fault('Authority consumption failed');
  }

  private recordProcess(result: ProcessResult): void {
    if (this.process && this.process.kind !== 'unconfirmed') {
      if (JSON.stringify(this.process) !== JSON.stringify(result)) this.fault('Conflicting process result');
      return;
    }
    if (this.process?.kind === 'unconfirmed' && result.kind === 'unconfirmed') return;
    this.process = Object.freeze({ ...result });
    if (this.state !== 'settled') this.state = 'closing';
    if (result.kind === 'unconfirmed') this.dependencies.authority.quarantine('Process result is unconfirmed');
    this.notify(observer => observer.processResult(this.identity, this.process!));
    this.maybeSeal();
    this.maybeRetire();
  }

  private registerResource(resourceId: string): void {
    if (this.state === 'settled' || typeof resourceId !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(resourceId)
      || this.resources.has(resourceId) || this.resources.size >= 16) {
      this.resourceLedgerIncomplete = true;
      this.fault('Invalid or repeated resource acquisition'); return;
    }
    this.resources.set(resourceId, {});
  }

  private recordResource(resourceId: string, operationId: string, result: ResourceResult): void {
    const resource = this.resources.get(resourceId);
    if (!resource || (resource.operationId && resource.operationId !== operationId)) { this.fault('Unknown resource or conflicting release operation'); return; }
    resource.operationId = operationId;
    if (resource.current?.kind === 'released' || resource.current?.kind === 'failed') {
      if (JSON.stringify(resource.current) !== JSON.stringify(result)) this.fault('Conflicting resource result');
      return;
    }
    resource.current = Object.freeze({ ...result });
    resource.first ??= resource.current;
    if (result.kind === 'unknown' || result.kind === 'failed') this.dependencies.authority.quarantine('Resource settlement is not confirmed');
    this.notify(observer => observer.resourceResult(this.identity, resourceId, resource.current!));
    this.maybeRetire();
  }

  private disconnect(reason: string): void {
    this.controlDisconnected = true;
    this.loseControl(reason);
  }

  private failStartup(reason: string): void {
    if (this.startSent) { this.loseControl(reason); return; }
    const operation = this.operations.get('start');
    if (!operation) { this.fault('Provider startup failure has no start operation'); return; }
    if (!operation.current || operation.current.kind === 'unconfirmed') {
      this.recordOperation(operation, { kind: 'failed', stage: 'provider-spawn', reason });
    }
    this.startMessage = undefined;
    this.maybeRetire();
  }

  private loseControl(reason: string): void {
    const factsComplete = !this.resourceLedgerIncomplete && this.process && this.process.kind !== 'unconfirmed' && this.source
      && [...this.resources].every(([id, resource]) => id === 'provider-control' || resource.current?.kind === 'released')
      && [...this.operations.values()].every(operation => operation.current && operation.current.kind !== 'unconfirmed');
    if (factsComplete) { this.maybeRetire(); return; }
    if (this.state === 'settled') return;
    this.state = 'closing';
    this.fault(reason);
    for (const operation of this.operations.values()) {
      if (!operation.current) this.recordOperation(operation, operation.kind === 'start'
        ? { kind: 'unconfirmed', stage: this.ready ? 'start' : 'ready', reason: 'Provider control lost' }
        : { kind: 'unconfirmed', reason: 'Provider control lost' });
    }
    if (this.startSent && !this.process) this.recordProcess({ kind: 'unconfirmed', reason: 'Provider control lost' });
    for (const [id, resource] of this.resources) {
      if (id === 'provider-control') continue;
      if (resource.current?.kind === 'released' || resource.current?.kind === 'failed') continue;
      resource.current = Object.freeze({ kind: 'unknown', reason: 'Provider control lost' });
      resource.first ??= resource.current;
      this.notify(observer => observer.resourceResult(this.identity, id, resource.current!));
    }
    this.maybeRetire();
    this.scheduleProcessing();
  }

  private settleLostSource(): void {
    if (!this.startSent) return;
    if (this.source || (!this.outputEnded && !this.outputClosed) || this.processingScheduled) return;
    if (!this.controlDisconnected && !this.parsingFailed && !this.dataAdmissionFailed) return;
    const kind = this.parsingFailed || this.dataAdmissionFailed || this.rawBytes > 0 ? 'error' : 'unknown';
    this.source = Object.freeze({ kind, lastDataSequence: this.acceptedThrough,
      reason: `Data channel ended without confirmed source settlement; retained raw bytes: ${this.rawBytes}; rejected bytes: ${this.rejectedDataBytes}` });
    this.maybeSeal();
  }

  private maybeSeal(): void {
    if (this.seal || !this.process || !this.source) return;
    this.seal = Object.freeze({ ...this.identity, process: this.process, source: this.source, lastDataSequence: this.acceptedThrough });
    this.notify(observer => observer.outputSeal(this.seal!));
    this.maybeRetire();
  }

  private maybeRetire(): void {
    if (this.resourceLedgerIncomplete || this.pendingBytes !== 0 || this.rawBytes !== 0 || this.pending.length !== 0 || this.authorityFailure
      || [...this.resources.values()].some(resource => resource.current?.kind !== 'released')) return;
    const startResult = this.operations.get('start')?.current;
    // No execution source existed when start was never dispatched; do not invent its seal.
    const startupSettled = this.acquired && !this.startSent && !this.process && !this.source && !this.seal
      && (startResult?.kind === 'failed' || startResult?.kind === 'unconfirmed');
    if (!startupSettled && (!this.seal || this.process?.kind === 'unconfirmed')) return;
    this.state = 'settled';
    this.dependencies.authority.release(this.identity);
  }

  private notify(callback: (observer: ExecutionObserver) => void): void {
    try { callback(this.observer!); }
    catch { this.fault('Execution observer failed'); }
  }

  private fault(reason: string): void {
    const first = this.firstFault === undefined;
    this.firstFault ??= reason;
    this.dependencies.authority.quarantine(reason);
    // Retain one bounded diagnostic; a throwing observer must not recurse into itself.
    if (first) { try { this.observer?.fault(this.identity, reason); } catch { /* State remains inspectable. */ } }
  }
}
