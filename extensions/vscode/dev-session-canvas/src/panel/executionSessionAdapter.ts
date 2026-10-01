import {
  assertExecutionCandidateProfile,
  assertCandidateLaunchSpec,
  assertExecutionIdentity,
  assertParentMessageSize,
  decodeOutputPayload,
  normalizeExecutionAdmissionLimits,
  parseProviderMessage,
  sameExecutionIdentity,
  S1_LIMITS,
  EXECUTION_INTERACTION_LIMITS,
  validateExecutionDimensions,
  validateLaunchSpec,
  type AuthorityResult,
  type DataBatch,
  type ExecutionAdmissionLimits,
  type ExecutionIdentity,
  type ExecutionCandidateProfile,
  type ExecutionInteractionResult,
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

export type ExecutionParentClosed = { kind: 'closed'; exitCode: number | null; signal: string | null };

export type ExecutionParentCleanupBudget = {
  termDeadline: number;
  killDeadline: number;
  canSignal: () => boolean;
};

export type ExecutionParentControl = {
  identity: ExecutionIdentity;
  scheduler: ExecutionScheduler;
  expectedNativeResourceIds: readonly string[];
  closed: Promise<ExecutionParentClosed>;
  terminate(budget: ExecutionParentCleanupBudget): Promise<ExecutionParentClosed | { kind: 'unknown' }>;
};

export type ExecutionParentCleanupClaim = {
  kind: 'unstarted' | 'transferred';
  closed: Promise<ExecutionParentClosed>;
  terminate(budget: { termDeadline: number; killDeadline: number }): Promise<ExecutionParentClosed | { kind: 'unknown' }>;
};

export interface ExecutionTransport {
  parentControl?: ExecutionParentControl;
  connect(sink: ExecutionTransportSink): void;
  send(message: ParentMessage): Promise<void>;
}

export interface ExecutionObserver {
  data(batch: DataBatch): void;
  processResult(identity: ExecutionIdentity, result: ProcessResult): void;
  outputSeal(seal: OutputSeal): void;
  resourceResult(identity: ExecutionIdentity, resourceId: string, result: ResourceResult): void;
  fault(identity: ExecutionIdentity, reason: string): void;
  stateChanged?(identity: ExecutionIdentity): void;
}

export type SealedConsumptionResult =
  | Readonly<{ kind: 'consumed'; throughDataSequence: number }>
  | Readonly<{ kind: 'failed'; throughDataSequence: number; reason: string }>;

export interface OperationObservation {
  readonly first: Promise<OperationResult>;
  readonly current: OperationResult | undefined;
}

export interface InteractionObservation {
  readonly first: Promise<ExecutionInteractionResult>;
  readonly current: ExecutionInteractionResult | undefined;
}

type Interaction = {
  kind: 'input' | 'resize';
  data?: string;
  cols?: number;
  rows?: number;
  bytes: number;
  offset: number;
  writtenBytes: number;
  deadline: number;
  view: InteractionObservation;
  current?: ExecutionInteractionResult;
  firstResolved: boolean;
  resolve: (result: ExecutionInteractionResult) => void;
  cancelDeadline: () => void;
  active?: { id: number; data?: string; bytes: number; confirmedBytes: number; sent: boolean };
};

const inputEncoder = new TextEncoder();
const inputDecoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

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
  readonly admissionLimits: ExecutionAdmissionLimits;
  private readonly executions = new Map<string, { identity: ExecutionIdentity; execution: PreparedExecution }>();
  private readonly starting = new Set<ExecutionIdentity>();
  private blockedReason?: string;
  private closing = false;
  private permanent = false;

  constructor(admissionLimits?: ExecutionAdmissionLimits) {
    this.admissionLimits = normalizeExecutionAdmissionLimits(admissionLimits);
  }

  reserve(identity: ExecutionIdentity, execution: PreparedExecution): void {
    if (this.blockedReason) throw new Error('Execution authority is quarantined');
    if (this.closing) throw new Error('Execution authority is closing');
    if (this.executions.has(identity.executionId)) throw new Error('Execution identity already reserved');
    if (this.executions.size >= this.admissionLimits.executions) throw new Error('Execution capacity exhausted');
    this.executions.set(identity.executionId, { identity, execution });
  }

  beginStart(identity: ExecutionIdentity): boolean {
    if (this.executions.get(identity.executionId)?.identity !== identity || this.blockedReason || this.closing
      || this.starting.size >= this.admissionLimits.starting) return false;
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

  closeAdmission(permanent = false): readonly PreparedExecution[] {
    this.closing = true;
    this.permanent ||= permanent;
    return this.listExecutions();
  }

  listExecutions(): readonly PreparedExecution[] {
    return Object.freeze([...this.executions.values()].map(entry => entry.execution));
  }

  tryResume(): boolean {
    if (!this.closing || this.permanent || this.blockedReason || this.executions.size > 0 || this.starting.size > 0) return false;
    this.closing = false;
    return true;
  }

  snapshot(): Readonly<{ active: number; starting: number; blockedReason?: string; closing: boolean; permanent: boolean }> {
    return Object.freeze({ active: this.executions.size, starting: this.starting.size,
      blockedReason: this.blockedReason, closing: this.closing, permanent: this.permanent });
  }
}

export function createExecutionAuthority(admissionLimits?: ExecutionAdmissionLimits): ExecutionAuthority {
  return new ExecutionAuthority(admissionLimits);
}

export interface ExecutionDependencies {
  profile?: ExecutionCandidateProfile;
  authority: ExecutionAuthority;
  transport: ExecutionTransport;
  scheduler: ExecutionScheduler;
  closeObservationV1?: true;
  parentCleanupV1?: true;
}

export function prepareExecution(identity: ExecutionIdentity, launchSpec: LaunchSpec, dependencies: ExecutionDependencies): PreparedExecution {
  return new PreparedExecution(identity, launchSpec, dependencies);
}

export class PreparedExecution {
  readonly identity: ExecutionIdentity;
  private readonly profile?: ExecutionCandidateProfile;
  private readonly spec: LaunchSpec;
  private readonly parentControl?: Readonly<ExecutionParentControl>;
  private parentCleanupClaim?: Readonly<ExecutionParentCleanupClaim>;
  private parentCleanupValid = false;
  private state: State = 'prepared';
  private factualSettledAt?: number;
  private observer?: ExecutionObserver;
  private consumeBatch?: (batches: readonly DataBatch[]) => Promise<void>;
  private readonly operations = new Map<OperationKind, Operation>();
  private readonly interactions = new Set<Interaction>();
  private interactionBytes = 0;
  private nextInteractionId = 1;
  private interactionCapable = false;
  private interactionClosedReason?: string;
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
  private explicitSourceEnd = false;
  private sourceEndAcceptedSent = false;
  private seal?: OutputSeal;
  private controlDisconnected = false;
  private providerExited = false;
  private outputEnded = false;
  private outputClosed = false;
  private reservationCancelled = false;
  private sealedConsumption?: Promise<SealedConsumptionResult>;
  private resolveSealedConsumption?: (result: SealedConsumptionResult) => void;
  private stateNotificationScheduled = false;
  private stateNotificationFailed = false;

  constructor(identity: ExecutionIdentity, launchSpec: LaunchSpec, private readonly dependencies: ExecutionDependencies) {
    if (dependencies.profile !== undefined) assertExecutionCandidateProfile(dependencies.profile);
    this.profile = dependencies.profile;
    assertExecutionIdentity(identity);
    this.identity = Object.freeze({ ...identity });
    this.spec = validateLaunchSpec(launchSpec);
    if (this.profile) assertCandidateLaunchSpec(this.spec);
    // Include the envelope in the start limit, before reserving an authority slot.
    assertParentMessageSize({ type: 'start', identity: this.identity, operationId: 'prepare', spec: this.spec });
    if (dependencies.parentCleanupV1 === true) {
      if (dependencies.closeObservationV1 !== true) throw new Error('Parent cleanup requires close observation v1');
      const control = dependencies.transport.parentControl;
      if (!control) throw new Error('Parent cleanup requires the original parent control');
      assertExecutionIdentity(control.identity);
      if (!sameExecutionIdentity(control.identity, this.identity) || control.scheduler !== dependencies.scheduler) {
        throw new Error('Parent cleanup must share the original execution identity and scheduler');
      }
      const ids = control.expectedNativeResourceIds;
      if (!Array.isArray(ids) || ids.length === 0 || ids.length > 15
        || [...ids].some(id => typeof id !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(id) || id === 'provider-control')
        || new Set(ids).size !== ids.length || typeof control.closed?.then !== 'function' || typeof control.terminate !== 'function') {
        throw new Error('Invalid original parent cleanup contract');
      }
      this.parentControl = Object.freeze({ identity: Object.freeze({ ...control.identity }), scheduler: control.scheduler,
        expectedNativeResourceIds: Object.freeze([...ids]), closed: control.closed, terminate: control.terminate.bind(control) });
    }
    dependencies.authority.reserve(this.identity, this);
  }

  bind(observer: ExecutionObserver, consumeBatch: (batches: readonly DataBatch[]) => Promise<void>): this {
    if (this.state !== 'prepared') throw new Error('Execution observer already bound');
    this.observer = observer;
    this.consumeBatch = consumeBatch;
    this.state = 'bound';
    this.changed();
    return this;
  }

  cancelReservation(): boolean {
    if (this.reservationCancelled) return true;
    if (this.acquired || (this.state !== 'prepared' && this.state !== 'bound')) return false;
    this.reservationCancelled = true;
    this.state = 'settled';
    this.dependencies.authority.release(this.identity);
    this.changed();
    return true;
  }

  waitForSealedConsumption(): Promise<SealedConsumptionResult> {
    if (!this.seal) throw new Error('Output must be sealed before waiting for its consumption');
    if (!this.sealedConsumption) {
      this.sealedConsumption = new Promise(resolve => { this.resolveSealedConsumption = resolve; });
      this.settleConsumptionWait();
    }
    return this.sealedConsumption;
  }

  tryBeginParentCleanup(): Readonly<ExecutionParentCleanupClaim> | undefined {
    if (this.parentCleanupClaim) return this.parentCleanupClaim;
    const control = this.parentControl;
    if (!control || !this.acquired || !this.resources.has('provider-control')
      || this.resources.get('provider-control')?.current?.kind === 'released'
      || this.firstFault || this.resourceLedgerIncomplete || this.parsingFailed || this.dataAdmissionFailed
      || this.rejectedDataBytes !== 0 || this.rawBytes !== 0 || this.sendInFlight) return;
    let kind: ExecutionParentCleanupClaim['kind'];
    if (!this.startSent) {
      if (this.process || this.source || this.seal || this.acceptedThrough !== 0 || this.pendingBytes !== 0
        || this.pending.length !== 0 || [...this.resources.keys()].some(id => id !== 'provider-control')) return;
      kind = 'unstarted';
    } else {
      const nativeIds = [...this.resources.keys()].filter(id => id !== 'provider-control');
      if (!this.process || this.process.kind === 'unconfirmed' || !this.source || !this.explicitSourceEnd
        || !this.sourceEndAcceptedSent || this.startMessage || this.normal.size !== 0 || this.urgent.size !== 0
        || !this.resources.has('provider-control') || nativeIds.length !== control.expectedNativeResourceIds.length
        || control.expectedNativeResourceIds.some(id => this.resources.get(id)?.current?.kind !== 'released')) return;
      kind = 'transferred';
    }
    const canSignal = () => this.parentCleanupValid && this.parentCleanupClaim === claim;
    const claim: Readonly<ExecutionParentCleanupClaim> = Object.freeze({ kind, closed: control.closed,
      terminate: (budget: { termDeadline: number; killDeadline: number }) => control.terminate({
        termDeadline: budget.termDeadline, killDeadline: budget.killDeadline, canSignal }) });
    this.parentCleanupClaim = claim;
    this.parentCleanupValid = true;
    if (kind === 'unstarted') {
      // Seal local intent before notifying observers or permitting parent teardown.
      this.startMessage = undefined;
      this.normal.clear();
      this.urgent.clear();
      for (const operation of this.operations.values()) {
        if (!operation.sent && (!operation.current || operation.current.kind === 'unconfirmed')) {
          const reason = `Parent cleanup sealed ${operation.kind} before dispatch`;
          this.recordOperation(operation, operation.kind === 'start'
            ? { kind: 'failed', stage: 'parent-cleanup-before-start', reason } : { kind: 'failed', reason });
        }
      }
      this.maybeRetire();
    }
    this.changed();
    return claim;
  }

  start(operationId: string, deadline: number): OperationObservation {
    if (!this.observer) throw new Error('Bind execution before starting');
    const previous = this.existingOperation('start', operationId, deadline);
    if (previous) return previous.view;
    if (this.parentCleanupClaim) throw new Error('Parent cleanup has sealed execution intent');
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
        exited: () => {
          this.providerExited = true;
          this.closeInteractions('Provider exited', true);
          this.scheduleProcessing();
        },
        dataEnded: () => { this.outputEnded = true; this.scheduleProcessing(); },
        dataClosed: reason => {
          this.outputClosed = true;
          if (!this.parentCleanupValid) this.fault(reason);
          this.scheduleProcessing();
        },
        controlResourceResult: result => this.recordResource('provider-control', 'provider-control-release', result),
        startupFailed: reason => this.failStartup(reason),
        transportFault: reason => this.fault(reason),
        resourceAcquired: resourceId => this.registerResource(resourceId)
      });
    } catch {
      this.recordOperation(operation, { kind: 'failed', stage: 'connect', reason: 'Transport connect failed' });
      this.loseControl('Transport connect failed after acquisition boundary');
    }
    this.changed();
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

  write(data: string, deadline: number): InteractionObservation {
    if (typeof data !== 'string' || !data || data.length > EXECUTION_INTERACTION_LIMITS.pendingInputBytes) {
      throw new Error('Terminal input must be a nonempty bounded string');
    }
    const encoded = inputEncoder.encode(data);
    if (inputDecoder.decode(encoded) !== data) throw new Error('Terminal input must contain valid Unicode');
    return this.interact({ kind: 'input', data, bytes: encoded.byteLength }, deadline);
  }

  resize(cols: number, rows: number, deadline: number): InteractionObservation {
    return this.interact({ kind: 'resize', ...validateExecutionDimensions(cols, rows), bytes: 0 }, deadline);
  }

  private interact(input: Pick<Interaction, 'kind' | 'data' | 'cols' | 'rows' | 'bytes'>, deadline: number): InteractionObservation {
    const admission = this.dependencies.authority.snapshot();
    if (!this.interactionCapable || this.state !== 'running' || this.process || this.source || this.parentCleanupClaim
      || this.interactionClosedReason || admission.blockedReason || admission.closing) {
      throw new Error('Execution terminal interaction admission is closed or unsupported');
    }
    if (!Number.isFinite(deadline) || deadline <= this.dependencies.scheduler.now()) {
      throw new Error('Terminal interaction requires a future finite deadline');
    }
    if (this.interactions.size >= EXECUTION_INTERACTION_LIMITS.pendingOperations
      || this.interactionBytes + input.bytes > EXECUTION_INTERACTION_LIMITS.pendingInputBytes) {
      throw new Error('Execution terminal interaction capacity exhausted');
    }
    let resolve!: (result: ExecutionInteractionResult) => void;
    const first = new Promise<ExecutionInteractionResult>(done => { resolve = done; });
    const interaction: Interaction = { ...input, deadline, offset: 0, writtenBytes: 0, resolve,
      firstResolved: false, cancelDeadline: () => {},
      view: Object.freeze({ first, get current() { return interaction.current; } }) };
    this.interactions.add(interaction);
    this.interactionBytes += input.bytes;
    interaction.cancelDeadline = this.dependencies.scheduler.scheduleDeadline(deadline, () => this.expireInteraction(interaction));
    this.pumpInteractions();
    return interaction.view;
  }

  private pumpInteractions(): void {
    // A blocked PTY input must not hold resize, whose caller may own the output-consumption chain.
    for (const kind of ['input', 'resize'] as const) {
      const interaction = [...this.interactions].find(item => item.kind === kind);
      if (interaction) this.queueInteraction(interaction);
    }
  }

  private queueInteraction(interaction: Interaction): void {
    if (!this.interactions.has(interaction) || interaction.active) return;
    const admission = this.dependencies.authority.snapshot();
    if (admission.closing || admission.blockedReason) this.interactionClosedReason ??= 'Execution authority interaction admission closed';
    if (this.interactionClosedReason || this.dependencies.scheduler.now() >= interaction.deadline) {
      this.finishInteraction(interaction, this.interactionFailure(interaction, 'cancelled',
        this.interactionClosedReason ?? 'Interaction deadline reached before dispatch'));
      return;
    }
    if (!Number.isSafeInteger(this.nextInteractionId)) {
      this.finishInteraction(interaction, this.interactionFailure(interaction, 'failed', 'Interaction identity exhausted'));
      return;
    }
    const interactionId = this.nextInteractionId++;
    let message: ParentMessage;
    if (interaction.kind === 'resize') {
      message = { type: 'resize', identity: this.identity, interactionId, cols: interaction.cols!, rows: interaction.rows! };
    } else {
      let data = '';
      // Size the complete JSON envelope, including escaped input and the current numeric identity.
      for (const character of interaction.data!.slice(interaction.offset)) {
        const candidate = { type: 'input' as const, identity: this.identity, interactionId, data: data + character };
        if (inputEncoder.encode(JSON.stringify(candidate)).byteLength > S1_LIMITS.controlBytes) break;
        data += character;
      }
      if (!data) {
        this.finishInteraction(interaction, this.interactionFailure(interaction, 'failed', 'Input envelope exceeds the control limit'));
        return;
      }
      message = { type: 'input', identity: this.identity, interactionId, data };
    }
    interaction.active = { id: interactionId, sent: false, confirmedBytes: 0,
      bytes: message.type === 'input' ? inputEncoder.encode(message.data).byteLength : 0,
      ...(message.type === 'input' ? { data: message.data } : {}) };
    // At most one input and one resize frame are queued, leaving acknowledgement slots available.
    this.enqueue(message, 'normal', `interaction:${interactionId}`);
  }

  private interactionFailure(interaction: Interaction, kind: 'cancelled' | 'failed' | 'unconfirmed', reason: string,
    writtenBytes = interaction.writtenBytes + (interaction.active?.confirmedBytes ?? 0)): ExecutionInteractionResult {
    return Object.freeze({ kind, reason, ...(interaction.kind === 'input' ? { writtenBytes } : {}) });
  }

  private publishInteraction(interaction: Interaction, result: ExecutionInteractionResult): void {
    interaction.current = Object.freeze({ ...result });
    if (!interaction.firstResolved) {
      interaction.firstResolved = true;
      interaction.cancelDeadline();
      interaction.resolve(interaction.current);
    }
  }

  private finishInteraction(interaction: Interaction, result: ExecutionInteractionResult): void {
    this.publishInteraction(interaction, result);
    if (!this.interactions.delete(interaction)) return;
    this.interactionBytes -= interaction.bytes;
    const key = `interaction:${interaction.active?.id}`;
    const queued = this.normal.get(key);
    if (!interaction.active?.sent && queued && 'interactionId' in queued && queued.interactionId === interaction.active?.id) {
      this.normal.delete(key);
    }
    interaction.data = undefined;
    interaction.active = undefined;
    this.pumpInteractions();
  }

  private expireInteraction(interaction: Interaction): void {
    if (!this.interactions.has(interaction) || this.dependencies.scheduler.now() < interaction.deadline) return;
    const result = this.interactionFailure(interaction, interaction.active?.sent ? 'unconfirmed' : 'cancelled',
      'Interaction observation deadline reached');
    if (interaction.active?.sent) this.publishInteraction(interaction, result);
    else this.finishInteraction(interaction, result);
  }

  private closeInteractions(reason: string, uncertain = false): void {
    this.interactionClosedReason ??= reason;
    for (const interaction of [...this.interactions]) {
      if (interaction.active?.sent) {
        if (uncertain) this.publishInteraction(interaction, this.interactionFailure(interaction, 'unconfirmed', reason));
      } else this.finishInteraction(interaction, this.interactionFailure(interaction, 'cancelled', reason));
    }
  }

  private receiveInteraction(interactionId: number, result: ExecutionInteractionResult): void {
    const interaction = [...this.interactions].find(item => item.active?.id === interactionId);
    if (!interaction || !interaction.active?.sent) {
      this.fault('Interaction observation does not match an original in-flight command');
      return;
    }
    const active = interaction.active;
    const bytes = 'writtenBytes' in result ? result.writtenBytes : undefined;
    if ((interaction.kind === 'input' && (result.kind === 'resized' || bytes === undefined || bytes > active.bytes || bytes < active.confirmedBytes
      || (result.kind === 'written' && bytes !== active.bytes)))
      || (interaction.kind === 'resize' && (result.kind === 'written' || bytes !== undefined))) {
      this.fault('Invalid terminal interaction result');
      return;
    }
    if (this.dependencies.scheduler.now() >= interaction.deadline && !interaction.firstResolved) this.expireInteraction(interaction);
    if (result.kind === 'unconfirmed') {
      active.confirmedBytes = bytes ?? 0;
      this.publishInteraction(interaction, this.interactionFailure(interaction, 'unconfirmed', result.reason,
        interaction.writtenBytes + (bytes ?? 0)));
      return;
    }
    if (result.kind === 'written') {
      interaction.writtenBytes += result.writtenBytes;
      interaction.offset += active.data!.length;
      interaction.active = undefined;
      if (interaction.offset < interaction.data!.length) {
        this.pumpInteractions();
        return;
      }
      this.finishInteraction(interaction, { kind: 'written', writtenBytes: interaction.writtenBytes });
    } else if (result.kind === 'resized') this.finishInteraction(interaction, result);
    else this.finishInteraction(interaction, this.interactionFailure(interaction, result.kind, result.reason,
      interaction.writtenBytes + (bytes ?? 0)));
  }

  snapshot() {
    return Object.freeze({
      identity: this.identity, state: this.state, acceptedThrough: this.acceptedThrough,
      consumedThrough: this.consumedThrough, pendingBytes: this.pendingBytes,
      pendingFrames: this.pending.length + this.countRawFrames(), rawBytes: this.rawBytes,
      rejectedDataBytes: this.rejectedDataBytes,
      interactions: Object.freeze({ pending: this.interactions.size, inputBytes: this.interactionBytes,
        closedReason: this.interactionClosedReason }),
      resourceLedgerIncomplete: this.resourceLedgerIncomplete,
      parentCleanup: this.parentCleanupClaim?.kind,
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
    operation.cancelDeadline = this.dependencies.scheduler.scheduleDeadline(deadline, () => this.expireOperation(operation));
    return operation;
  }

  private command(kind: Exclude<OperationKind, 'start'>, id: string, deadline: number, reason?: string): OperationObservation {
    if (!this.acquired) throw new Error('Execution has not acquired a provider');
    const previous = this.existingOperation(kind, id, deadline, reason);
    if (previous) return previous.view;
    if (this.parentCleanupClaim) throw new Error('Parent cleanup has sealed execution intent');
    if (this.state === 'settled') throw new Error('Execution is already settled');
    const message: ParentMessage = kind === 'cancel'
      ? { type: 'cancelOutput', identity: this.identity, operationId: id, reason: reason! }
      : { type: 'requestStop', identity: this.identity, operationId: id, mode: kind };
    assertParentMessageSize(message);
    const operation = this.makeOperation(kind, id, deadline, reason);
    this.closeInteractions(`Execution ${kind} requested`);
    this.state = 'closing';
    this.enqueue(message, 'urgent', kind);
    this.changed();
    return operation.view;
  }

  private recordOperation(operation: Operation, result: OperationResult): void {
    if (this.dependencies.closeObservationV1 === true && this.dependencies.scheduler.now() >= operation.deadline) {
      this.expireOperation(operation);
    }
    this.updateOperation(operation, result);
  }

  private expireOperation(operation: Operation): void {
    if (operation.current || (this.dependencies.closeObservationV1 === true && this.dependencies.scheduler.now() < operation.deadline)) return;
    const missingAckOnly = this.dependencies.closeObservationV1 === true && operation.kind !== 'start' && operation.sent
      && this.state === 'settled' && this.factualSettledAt !== undefined && this.factualSettledAt < operation.deadline
      && this.process !== undefined && this.process.kind !== 'unconfirmed' && this.source !== undefined;
    this.updateOperation(operation, operation.kind === 'start'
      ? { kind: 'unconfirmed', stage: this.ready ? 'start' : 'ready', reason: 'Observation deadline reached' }
      : { kind: 'unconfirmed', reason: 'Observation deadline reached' }, missingAckOnly);
  }

  private updateOperation(operation: Operation, result: OperationResult, missingAckOnly = false): void {
    const previous = operation.current;
    if (previous && previous.kind !== 'unconfirmed') {
      if (JSON.stringify(previous) !== JSON.stringify(result)) this.fault('Conflicting operation result');
      return;
    }
    if (previous && result.kind === 'unconfirmed') {
      // A provider's unknown result is not the parent's missing-ACK observation.
      if (this.dependencies.closeObservationV1 === true && !missingAckOnly) {
        this.dependencies.authority.quarantine('Operation observation is unconfirmed');
        this.changed();
      }
      return;
    }
    const value = Object.freeze({ ...result }) as OperationResult;
    operation.current = value;
    if (!previous) { operation.cancelDeadline(); operation.resolve(value); }
    if (result.kind === 'unconfirmed' && !missingAckOnly) {
      this.dependencies.authority.quarantine('Operation observation is unconfirmed');
    }
    if (operation.kind === 'start') {
      if (result.kind !== 'unconfirmed') this.dependencies.authority.finishStart(this.identity);
      if (result.kind === 'started') {
        if (this.state !== 'settled') this.state = this.operations.size > 1 || this.process || this.source ? 'closing' : 'running';
      } else if (this.state !== 'settled') this.state = 'closing';
    }
    this.changed();
  }

  private receiveMessage(value: unknown): void {
    let message: ProviderMessage;
    try { message = parseProviderMessage(value); }
    catch { this.fault('Invalid provider control message'); return; }
    if (!sameExecutionIdentity(message.identity, this.identity)) { this.fault('Stale execution identity'); return; }
    switch (message.type) {
      case 'ready': {
        if (this.parentCleanupClaim?.kind === 'unstarted') {
          if (!message.capabilities.includes('execution-lifecycle-v1')) this.fault('Missing lifecycle capability');
          return;
        }
        if (this.ready) return;
        if (this.state === 'settled' || this.operations.get('start')?.current?.kind === 'failed') {
          this.fault('Provider ready arrived after startup failed or settled'); return;
        }
        if (!message.capabilities.includes('execution-lifecycle-v1')) { this.fault('Missing lifecycle capability'); return; }
        if (this.profile && !message.capabilities.includes('terminal-interaction-v1')) {
          const operation = this.operations.get('start')!;
          this.recordOperation(operation, { kind: 'failed', stage: 'provider-ready',
            reason: 'Execution candidate provider lacks terminal-interaction-v1.' });
          this.startMessage = undefined;
          this.maybeRetire();
          return;
        }
        this.ready = true;
        this.interactionCapable = message.capabilities.includes('terminal-interaction-v1');
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
      case 'interactionObservation': this.receiveInteraction(message.interactionId, message.result); break;
      case 'processResult': this.recordProcess(message.result); break;
      case 'resourceAcquired':
        if (message.resourceId === 'provider-control') { this.fault('Provider cannot acquire parent control resources'); return; }
        this.registerResource(message.resourceId); break;
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
        this.closeInteractions('Execution output source ended');
        this.explicitSourceEnd = true;
        // No more production credit is needed. The confirmation follows any in-flight ACK.
        this.normal.delete('accepted');
        this.normal.delete('consumed');
        this.enqueue({ type: 'sourceEndAccepted', identity: this.identity, finalFrameId: message.finalFrameId },
          'normal', 'sourceEndAccepted');
        if (this.state !== 'settled') this.state = 'closing';
        if (source.kind === 'unknown' || source.kind === 'error') this.dependencies.authority.quarantine('Output source is not confirmed');
        this.maybeSeal();
        this.changed();
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
    if (this.parentCleanupClaim || !this.ready || this.sendInFlight || this.controlDisconnected || this.providerExited) return;
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
    if ('interactionId' in message) {
      const interactionId = message.interactionId;
      const interaction = [...this.interactions].find(item => item.active?.id === interactionId);
      if (!interaction?.active) { this.sendInFlight = false; this.pumpControl(); return; }
      const admission = this.dependencies.authority.snapshot();
      if (admission.closing || admission.blockedReason) this.interactionClosedReason ??= 'Execution authority interaction admission closed';
      if (this.dependencies.scheduler.now() >= interaction.deadline || this.interactionClosedReason) {
        this.sendInFlight = false;
        this.finishInteraction(interaction, this.interactionFailure(interaction, 'cancelled',
          this.interactionClosedReason ?? 'Interaction deadline reached before dispatch'));
        this.pumpControl();
        return;
      }
      interaction.active.sent = true;
    }
    const sentMessage = message;
    try {
      Promise.resolve(this.dependencies.transport.send(sentMessage)).then(() => {
        this.sendInFlight = false;
        if (sentMessage.type === 'sourceEndAccepted' && this.explicitSourceEnd
          && sentMessage.finalFrameId === this.source?.lastDataSequence) this.sourceEndAcceptedSent = true;
        this.pumpControl();
        if (this.parentControl) this.changed();
      }, () => this.controlSendFailed());
    } catch { this.controlSendFailed(); }
  }

  private controlSendFailed(): void {
    this.sendInFlight = false;
    this.fault('Control send failed');
    this.disconnect('Control send failed');
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
      this.changed();
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
        if (!this.source) {
          this.enqueue({ type: 'consumed', identity: this.identity, throughFrameId: this.consumedThrough }, 'normal', 'consumed');
        }
        if (this.pending.length) this.dependencies.scheduler.scheduleTask(() => this.beginConsumption());
        this.maybeRetire();
        this.changed();
      }, () => this.consumptionFailed());
    } catch { this.consumptionFailed(); }
  }

  private consumptionFailed(): void {
    this.consuming = false;
    this.authorityFailure = Object.freeze({ kind: 'failed', throughDataSequence: this.consumedThrough, reason: 'Authority consumption failed' });
    this.fault('Authority consumption failed');
    this.changed();
  }

  private recordProcess(result: ProcessResult): void {
    if (this.parentCleanupClaim?.kind === 'unstarted') this.fault('Process result arrived after unstarted parent cleanup');
    if (this.process && this.process.kind !== 'unconfirmed') {
      if (JSON.stringify(this.process) !== JSON.stringify(result)) this.fault('Conflicting process result');
      return;
    }
    if (this.process?.kind === 'unconfirmed' && result.kind === 'unconfirmed') return;
    this.process = Object.freeze({ ...result });
    this.closeInteractions('Execution subject ended', result.kind === 'unconfirmed');
    if (this.state !== 'settled') this.state = 'closing';
    if (result.kind === 'unconfirmed') this.dependencies.authority.quarantine('Process result is unconfirmed');
    this.notify(observer => observer.processResult(this.identity, this.process!));
    this.maybeSeal();
    this.maybeRetire();
  }

  private registerResource(resourceId: string): void {
    if (this.parentCleanupClaim || this.state === 'settled' || typeof resourceId !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(resourceId)
      || this.resources.has(resourceId) || this.resources.size >= 16) {
      this.resourceLedgerIncomplete = true;
      this.changed();
      this.fault('Invalid or repeated resource acquisition'); return;
    }
    this.resources.set(resourceId, {});
    this.changed();
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
    this.closeInteractions(reason, true);
    if (this.parentCleanupValid) this.maybeRetire();
    else this.loseControl(reason);
    this.changed();
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
      && (!this.parentCleanupClaim || this.parentCleanupValid)
      && (startResult?.kind === 'failed' || startResult?.kind === 'unconfirmed');
    if (!startupSettled && (!this.seal || this.process?.kind === 'unconfirmed')) return;
    this.state = 'settled';
    if (this.dependencies.closeObservationV1 === true && !startupSettled) {
      this.factualSettledAt ??= this.dependencies.scheduler.now();
    }
    this.dependencies.authority.release(this.identity);
    this.changed();
  }

  private notify(callback: (observer: ExecutionObserver) => void): void {
    try { callback(this.observer!); }
    catch { this.fault('Execution observer failed'); }
    this.changed();
  }

  private settleConsumptionWait(): void {
    if (!this.resolveSealedConsumption || !this.seal) return;
    let result: SealedConsumptionResult | undefined;
    if (this.authorityFailure) result = this.authorityFailure;
    else if (this.consumedThrough >= this.seal.lastDataSequence) {
      result = Object.freeze({ kind: 'consumed', throughDataSequence: this.seal.lastDataSequence });
    }
    if (!result) return;
    const resolve = this.resolveSealedConsumption;
    this.resolveSealedConsumption = undefined;
    resolve(result);
  }

  private changed(): void {
    this.settleConsumptionWait();
    if (!this.observer?.stateChanged || this.stateNotificationScheduled || this.stateNotificationFailed) return;
    // Observe after the current fact transition, including its retirement checks, has completed.
    this.stateNotificationScheduled = true;
    this.dependencies.scheduler.scheduleTask(() => {
      this.stateNotificationScheduled = false;
      if (this.stateNotificationFailed) return;
      try { this.observer?.stateChanged?.(this.identity); }
      catch {
        this.stateNotificationFailed = true;
        this.fault('Execution state observer failed');
      }
    });
  }

  private fault(reason: string): void {
    this.parentCleanupValid = false;
    const first = this.firstFault === undefined;
    this.firstFault ??= reason;
    this.closeInteractions(reason, true);
    this.dependencies.authority.quarantine(reason);
    // Retain one bounded diagnostic; a throwing observer must not recurse into itself.
    if (first) { try { this.observer?.fault(this.identity, reason); } catch { /* State remains inspectable. */ } }
    if (first) this.changed();
  }
}
