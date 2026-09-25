import { randomUUID } from 'node:crypto';

import {
  assertExecutionIdentity,
  S1_LIMITS,
  validateLaunchSpec,
  type AuthorityResult,
  type DataBatch,
  type ExecutionIdentity,
  type LaunchSpec,
  type OutputSeal,
  type ProcessResult
} from '../common/executionLifecycle';
import {
  createExecutionAuthority,
  prepareExecution,
  type ExecutionScheduler,
  type ExecutionTransport,
  type OperationObservation,
  type PreparedExecution
} from './executionSessionAdapter';

export interface NonNativeExecutionOwnerOptions {
  readonly kind: 'non-native';
  readonly capabilities: readonly string[];
  readonly scheduler: ExecutionScheduler;
  readonly budgets: Readonly<{
    startMs: number;
    gracefulMs: number;
    forceMs: number;
    cancelMs: number;
    settleMs: number;
    naturalDrainMs?: number;
  }>;
  // Construction must not acquire resources; acquisition belongs to connect().
  readonly createTransport: (identity: ExecutionIdentity) => ExecutionTransport;
}

export interface ExecutionOwnerHooks {
  consume(batches: readonly DataBatch[]): Promise<void>;
  flushFinal(seal: OutputSeal): Promise<number>;
  processResult?(result: ProcessResult): void;
  finalized?(result: AuthorityResult): void;
  fault?(reason: string): void;
  changed?(): void;
}

export interface OwnerCloseResult {
  readonly kind: 'settled' | 'unconfirmed';
  readonly pending: readonly string[];
}

type CloseTrigger = 'natural-exit' | 'stop' | 'failure';
type ClosePendingDomain = 'preparation' | 'process' | 'source' | 'consumption' | 'final-flush' | 'resources' | 'observer';
interface CloseObservation {
  readonly trigger: CloseTrigger;
  readonly reason: string;
  readonly startedAt: number;
  readonly forceAt?: number;
  readonly cancelAt: number;
  readonly finishAt: number;
  first?: OwnerCloseResult;
  gracefulRequested: boolean;
  forceRequested: boolean;
  cancelRequested: boolean;
}

export class ExecutionOwnerLifecycle {
  readonly authority = createExecutionAuthority();
  readonly options: NonNativeExecutionOwnerOptions;
  private readonly records = new Map<string, OwnedExecution>();
  private closing?: Promise<OwnerCloseResult>;

  constructor(options: NonNativeExecutionOwnerOptions) {
    if (options.kind !== 'non-native' || typeof options.createTransport !== 'function') {
      throw new Error('Only an explicitly injected non-native execution provider is available');
    }
    const budgets = Object.freeze({ ...options.budgets });
    const values = [budgets.startMs, budgets.gracefulMs, budgets.forceMs, budgets.cancelMs, budgets.settleMs];
    if (values.some(value => !Number.isFinite(value) || value <= 0)
      || values.reduce((sum, value) => sum + value, 0) > 0x7fffffff) {
      throw new Error('Explicit finite execution owner budgets are required');
    }
    if (options.capabilities.includes('execution-close-observation-v1') &&
        (typeof budgets.naturalDrainMs !== 'number' || !Number.isFinite(budgets.naturalDrainMs) ||
          budgets.naturalDrainMs <= 0 ||
          budgets.startMs + budgets.naturalDrainMs + budgets.cancelMs + budgets.settleMs > 0x7fffffff)) {
      throw new Error('Explicit finite natural drain budget is required for close observation');
    }
    this.options = Object.freeze({ ...options, budgets, capabilities: Object.freeze([...options.capabilities]) });
  }

  reserve(key: string, executionId: string = randomUUID()): OwnedExecution {
    this.assertAdmission();
    if (!key || this.records.has(key)) throw new Error('Execution owner key is already reserved or invalid');
    // Include preparation and final reader responsibility in the same finite capacity.
    if (this.records.size >= S1_LIMITS.executions) throw new Error('Execution owner capacity exhausted');
    const identity = Object.freeze({ executionId, generation: randomUUID() });
    assertExecutionIdentity(identity);
    const record = new OwnedExecution(this, key, identity);
    this.records.set(key, record);
    return record;
  }

  get(key: string): OwnedExecution | undefined { return this.records.get(key); }
  list(): readonly OwnedExecution[] { return Object.freeze([...this.records.values()]); }

  closeAdmission(permanent = false): void { this.authority.closeAdmission(permanent); }

  close(options: { reason: string; permanent?: boolean }): Promise<OwnerCloseResult> {
    this.closeAdmission(options.permanent);
    if (!this.closing) {
      this.closing = Promise.all(this.list().map(record => record.requestStop(options.reason))).then(results => {
        const pending = Object.freeze(results.flatMap(result => [...result.pending]));
        return Object.freeze({ kind: pending.length ? 'unconfirmed' : 'settled', pending });
      });
    }
    return this.closing;
  }

  tryResume(): boolean {
    if (this.records.size !== 0 || !this.authority.tryResume()) return false;
    this.closing = undefined;
    return true;
  }

  snapshot() {
    const { closing, permanent, blockedReason } = this.authority.snapshot();
    return Object.freeze({ closing, permanent, blockedReason, pending: this.records.size });
  }

  assertAdmission(record?: OwnedExecution): void {
    const state = this.authority.snapshot();
    if (state.closing || state.blockedReason) throw new Error('Execution owner admission is closed');
    if (!this.options.capabilities.includes('execution-lifecycle-v1')) throw new Error('Execution lifecycle capability is required');
    if (record && this.records.get(record.key) !== record) throw new Error('Execution reservation is no longer current');
  }

  retire(record: OwnedExecution): void {
    if (this.records.get(record.key) === record && record.snapshot().retired) this.records.delete(record.key);
  }
}

export class OwnedExecution {
  private execution?: PreparedExecution;
  private hooks?: ExecutionOwnerHooks;
  private terminal?: AuthorityResult;
  private readerOutcome: 'pending' | 'cancelled' | 'lost' | 'settled' = 'pending';
  private abandoned = false;
  private stopRequested = false;
  private finalizing = false;
  private callbackFailure?: string;
  private settledCommitted = false;
  private lastChangedSignature?: string;
  private stopping?: Promise<OwnerCloseResult>;
  private resolveStop?: (result: OwnerCloseResult) => void;
  private readonly stopTimers: Array<() => void> = [];
  private evaluating = false;
  private closeObservation?: CloseObservation;
  private finalObserverPending = false;

  constructor(private readonly owner: ExecutionOwnerLifecycle, readonly key: string, readonly identity: ExecutionIdentity) {}

  start(spec: LaunchSpec, hooks: ExecutionOwnerHooks): OperationObservation {
    this.owner.assertAdmission(this);
    if (this.stopRequested || this.abandoned || this.execution) throw new Error('Execution reservation cannot start');
    const launch = validateLaunchSpec(spec);
    if (typeof hooks.consume !== 'function' || typeof hooks.flushFinal !== 'function') throw new Error('Execution terminal hooks are required');
    const transport = this.owner.options.createTransport(this.identity);
    this.owner.assertAdmission(this);
    this.hooks = hooks;
    this.execution = prepareExecution(this.identity, launch, {
      authority: this.owner.authority,
      transport,
      scheduler: this.owner.options.scheduler,
      ...(this.closeObservationEnabled() ? { closeObservationV1: true as const } : {})
    }).bind({
      data: () => {},
      processResult: (_identity, result) => {
        this.observeCloseFacts();
        hooks.processResult?.(result);
      },
      outputSeal: () => { this.evaluate(); },
      resourceResult: () => { this.observeCloseFacts(); },
      fault: (_identity, reason) => {
        if (this.closeObservationEnabled()) this.beginCloseObservation('failure', reason);
        hooks.fault?.(reason);
      },
      stateChanged: () => { this.evaluate(); }
    }, batches => hooks.consume(batches));
    const operation = this.execution.start('owner-start', this.now() + this.owner.options.budgets.startMs);
    if (this.closeObservationEnabled()) {
      void operation.first.then(result => {
        if (result.kind === 'failed' || result.kind === 'unconfirmed') {
          this.beginCloseObservation('failure', result.reason ?? 'Execution startup is not confirmed');
        }
      });
    }
    this.evaluate();
    return operation;
  }

  abandon(reason: string): void {
    if (!reason) throw new Error('Preparation abandonment requires a reason');
    if (this.abandoned) return;
    if (this.execution) {
      const snapshot = this.execution.snapshot();
      if (Object.keys(snapshot.resources).length !== 0 || snapshot.process || snapshot.source) {
        throw new Error('An acquired execution cannot be abandoned');
      }
      this.execution.cancelReservation();
    }
    this.abandoned = true;
    this.readerOutcome = 'cancelled';
    this.evaluate();
  }

  requestStop(reason: string): Promise<OwnerCloseResult> {
    if (!reason) throw new Error('Execution stop requires a reason');
    if (this.closeObservationEnabled()) {
      this.stopRequested = true;
      if (!this.closeObservation && this.snapshot().settled) {
        this.stopping ??= Promise.resolve(Object.freeze({ kind: 'settled', pending: Object.freeze([]) }));
        return this.stopping;
      }
      this.beginCloseObservation('stop', reason);
      this.evaluate();
      return this.stopping!;
    }
    if (this.stopping) return this.stopping;
    this.stopRequested = true;
    this.stopping = new Promise(resolve => { this.resolveStop = resolve; });
    if (this.snapshot().settled) {
      this.settledCommitted = true;
      this.finishStop('settled');
      this.owner.retire(this);
      return this.stopping;
    }

    const { gracefulMs, forceMs, cancelMs, settleMs } = this.owner.options.budgets;
    const now = this.now();
    const forceAt = now + gracefulMs;
    const cancelAt = forceAt + forceMs;
    const finishAt = cancelAt + cancelMs + settleMs;
    const schedule = (deadline: number, callback: () => void) => {
      this.stopTimers.push(this.owner.options.scheduler.scheduleDeadline(deadline, callback));
    };
    this.stopSubject('graceful', forceAt);
    schedule(forceAt, () => this.stopSubject('force', cancelAt));
    schedule(cancelAt, () => {
      const execution = this.execution;
      if (execution && !execution.snapshot().source && !this.snapshot().settled) {
        this.command(() => execution.cancelOutput('owner-cancel', reason, cancelAt + cancelMs));
      }
    });
    schedule(finishAt, () => {
      if (this.snapshot().settled) { this.evaluate(); return; }
      this.owner.authority.quarantine('Execution owner close is unconfirmed');
      this.finishStop('unconfirmed');
      this.changed();
    });
    this.evaluate();
    return this.stopping;
  }

  settleReaders(outcome: 'cancelled' | 'lost' | 'settled'): void {
    // "settled" means all individually tracked readers ended, not that all applied output.
    if (outcome !== 'cancelled' && outcome !== 'lost' && outcome !== 'settled') {
      throw new Error('A reader settlement is required');
    }
    if (this.readerOutcome !== 'pending') return;
    this.readerOutcome = outcome;
    this.evaluate();
  }

  snapshot() {
    const adapter = this.execution?.snapshot();
    const settled = this.settledCommitted || this.abandoned
      || (adapter?.state === 'settled' && this.terminal?.kind === 'applied' && !this.callbackFailure &&
        (!this.closeObservationEnabled() || !this.finalObserverPending));
    return Object.freeze({
      identity: this.identity, key: this.key, adapter, terminal: this.terminal,
      readerOutcome: this.readerOutcome, settled, retired: settled && this.readerOutcome !== 'pending',
      stopRequested: this.stopRequested,
      ...(this.closeObservation ? { closeObservation: this.closeObservationSnapshot(adapter, settled) } : {})
    });
  }

  private now(): number { return this.owner.options.scheduler.now(); }

  private closeObservationEnabled(): boolean {
    return this.owner.options.capabilities.includes('execution-close-observation-v1');
  }

  private closeFailureReason(adapter = this.execution?.snapshot()): string | undefined {
    if (this.callbackFailure) return this.callbackFailure;
    if (this.terminal?.kind === 'failed') return this.terminal.reason;
    if (adapter?.firstFault) return adapter.firstFault;
    if (adapter?.authorityFailure) return adapter.authorityFailure.reason;
    if (adapter?.process?.kind === 'unconfirmed') return adapter.process.reason;
    if (adapter?.source?.kind === 'unknown' || adapter?.source?.kind === 'error') return adapter.source.reason;
    for (const resource of Object.values(adapter?.resources ?? {})) {
      if (resource.current?.kind === 'unknown' || resource.current?.kind === 'failed') return resource.current.reason;
    }
    return undefined;
  }

  private observeCloseFacts(): void {
    if (!this.closeObservationEnabled() || this.closeObservation) return;
    const adapter = this.execution?.snapshot();
    const failure = this.closeFailureReason(adapter);
    if (failure) this.beginCloseObservation('failure', failure);
    else if (adapter?.process && adapter.process.kind !== 'unconfirmed') {
      this.beginCloseObservation('natural-exit', `process-${adapter.process.kind}`);
    }
  }

  private beginCloseObservation(trigger: CloseTrigger, reason: string): void {
    if (this.closeObservation || this.owner.get(this.key) !== this) return;
    const { gracefulMs, forceMs, cancelMs, settleMs, naturalDrainMs } = this.owner.options.budgets;
    const startedAt = this.now();
    const forceAt = trigger === 'natural-exit' ? undefined : startedAt + gracefulMs;
    const cancelAt = forceAt === undefined ? startedAt + naturalDrainMs! : forceAt + forceMs;
    this.closeObservation = {
      trigger, reason, startedAt, forceAt, cancelAt, finishAt: cancelAt + cancelMs + settleMs,
      gracefulRequested: false, forceRequested: false, cancelRequested: false
    };
    this.stopping = new Promise(resolve => { this.resolveStop = resolve; });
    for (const deadline of [forceAt, cancelAt, this.closeObservation.finishAt]) {
      if (deadline !== undefined) {
        this.stopTimers.push(this.owner.options.scheduler.scheduleDeadline(deadline, () => this.evaluate()));
      }
    }
    this.evaluate();
  }

  private advanceCloseObservation(): void {
    const observation = this.closeObservation;
    if (!observation || observation.first) return;
    const now = this.now();
    if (now >= observation.finishAt) {
      this.finishStop('unconfirmed');
      return;
    }
    const execution = this.execution;
    if (!execution || this.snapshot().settled) return;
    let adapter = execution.snapshot();
    if (observation.trigger !== 'natural-exit' &&
        (!adapter.process || adapter.process.kind === 'unconfirmed') && Object.keys(adapter.resources).length > 0) {
      const force = now >= observation.forceAt!;
      const requested = force ? observation.forceRequested : observation.gracefulRequested;
      if (!requested) {
        // Record intent before transport callbacks can synchronously reenter the owner.
        if (force) observation.forceRequested = true;
        else observation.gracefulRequested = true;
        this.stopSubject(force ? 'force' : 'graceful', observation.finishAt);
      }
    }
    adapter = execution.snapshot();
    if (now >= observation.cancelAt && !adapter.source && !observation.cancelRequested) {
      observation.cancelRequested = true;
      this.command(() => execution.cancelOutput('owner-cancel', observation.reason, observation.finishAt));
    }
  }

  private closeObservationSnapshot(adapter: ReturnType<PreparedExecution['snapshot']> | undefined, settled: boolean) {
    const observation = this.closeObservation!;
    const pendingDomains: ClosePendingDomain[] = [];
    if (!settled) {
      if (!adapter) pendingDomains.push('preparation');
      else {
        if (!adapter.process || adapter.process.kind === 'unconfirmed') pendingDomains.push('process');
        if (!adapter.source) pendingDomains.push('source');
        if (adapter.pendingBytes > 0 || adapter.pendingFrames > 0 || adapter.authorityFailure ||
            adapter.consumedThrough < adapter.acceptedThrough) pendingDomains.push('consumption');
        if (adapter.seal && this.terminal?.kind !== 'applied') pendingDomains.push('final-flush');
        if (adapter.resourceLedgerIncomplete || Object.values(adapter.resources).some(resource =>
          resource.current?.kind !== 'released')) pendingDomains.push('resources');
      }
      if (this.callbackFailure || this.finalObserverPending) pendingDomains.push('observer');
    }
    const kind = settled ? 'settled' : observation.first?.kind === 'unconfirmed' || this.closeFailureReason(adapter)
      ? 'unconfirmed' : 'pending';
    return Object.freeze({
      trigger: observation.trigger, reason: observation.reason, startedAt: observation.startedAt,
      forceAt: observation.forceAt, cancelAt: observation.cancelAt, finishAt: observation.finishAt,
      first: observation.first,
      current: Object.freeze({ kind, pending: Object.freeze(settled ? [] : [this.key]) }),
      pendingDomains: Object.freeze(pendingDomains), quarantineReason: this.owner.authority.snapshot().blockedReason
    });
  }

  private stopSubject(mode: 'graceful' | 'force', deadline: number): void {
    const execution = this.execution;
    if (!execution || this.snapshot().settled) return;
    const snapshot = execution.snapshot();
    if (snapshot.process && snapshot.process.kind !== 'unconfirmed') return;
    if (Object.keys(snapshot.resources).length === 0) return;
    this.command(() => execution.requestStop(`owner-${mode}`, mode, deadline));
  }

  private command(send: () => OperationObservation): void {
    try { send(); }
    catch (error) {
      this.owner.authority.quarantine(error instanceof Error ? error.message : 'Execution close command failed');
    }
  }

  private evaluate(): void {
    if (this.evaluating) return;
    if (this.owner.get(this.key) !== this) return;
    this.evaluating = true;
    try {
      this.observeCloseFacts();
      this.advanceCloseObservation();
      const snapshot = this.execution?.snapshot();
      if (snapshot?.seal && !this.finalizing && !this.terminal) {
        this.finalizing = true;
        // The next consumption batch may not have entered the terminal chain yet.
        void this.finalize(snapshot.seal);
      }
      this.changed();
      // A callback may cancel a reader or fail; decide from the resulting facts.
      if (this.abandoned || (this.execution?.snapshot().state === 'settled'
        && this.terminal?.kind === 'applied' && !this.callbackFailure &&
        (!this.closeObservationEnabled() || !this.finalObserverPending))) {
        this.settledCommitted = true;
      }
      if (this.snapshot().settled) this.finishStop('settled');
      if (this.closeObservation) this.changed();
      this.owner.retire(this);
    } finally { this.evaluating = false; }
  }

  private async finalize(seal: OutputSeal): Promise<void> {
    try {
      const consumption = await this.execution!.waitForSealedConsumption();
      if (consumption.kind === 'failed') {
        this.terminal = Object.freeze({ ...consumption });
      } else {
        const finalRevision = await this.hooks!.flushFinal(seal);
        if (!Number.isSafeInteger(finalRevision) || finalRevision < 0) throw new Error('Invalid final terminal revision');
        this.terminal = Object.freeze({ kind: 'applied', finalRevision, throughDataSequence: consumption.throughDataSequence });
      }
    } catch (error) {
      this.terminal = Object.freeze({ kind: 'failed', throughDataSequence: this.execution!.snapshot().consumedThrough,
        reason: error instanceof Error ? error.message : 'Final terminal flush failed' });
    }
    this.finalObserverPending = this.closeObservationEnabled();
    try { this.hooks!.finalized?.(this.terminal); }
    catch {
      this.callbackFailure ??= 'Execution final-state observer failed';
      this.owner.authority.quarantine(this.callbackFailure);
    }
    finally { this.finalObserverPending = false; }
    if (this.terminal.kind === 'failed') this.owner.authority.quarantine('Final terminal consumption failed');
    this.evaluate();
  }

  private finishStop(kind: OwnerCloseResult['kind']): void {
    if (!this.resolveStop) return;
    if (this.closeObservation && !this.closeObservation.first) {
      if (this.now() >= this.closeObservation.finishAt) kind = 'unconfirmed';
      if (kind === 'unconfirmed') this.owner.authority.quarantine('Execution owner close is unconfirmed');
    }
    const resolve = this.resolveStop;
    this.resolveStop = undefined;
    for (const cancel of this.stopTimers.splice(0)) cancel();
    const result = Object.freeze({ kind, pending: Object.freeze(kind === 'settled' ? [] : [this.key]) });
    if (this.closeObservation) this.closeObservation.first = result;
    resolve(result);
  }

  private changed(): void {
    const adapter = this.execution?.snapshot();
    const signature = JSON.stringify({
      adapter: adapter && {
        state: adapter.state,
        acceptedThrough: adapter.acceptedThrough,
        consumedThrough: adapter.consumedThrough,
        pendingBytes: adapter.pendingBytes,
        process: adapter.process,
        source: adapter.source,
        seal: adapter.seal,
        resources: adapter.resources,
        firstFault: adapter.firstFault
      },
      terminal: this.terminal,
      readerOutcome: this.readerOutcome,
      stopRequested: this.stopRequested,
      abandoned: this.abandoned,
      finalizing: this.finalizing,
      ...(this.closeObservation ? { closeObservation: this.snapshot().closeObservation } : {})
    });
    if (signature === this.lastChangedSignature) return;
    this.lastChangedSignature = signature;
    try { this.hooks?.changed?.(); }
    catch {
      this.callbackFailure ??= 'Execution owner observer failed';
      this.owner.authority.quarantine(this.callbackFailure);
    }
  }
}
