import { spawn, type ChildProcess } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { Readable } from 'node:stream';
import {
  assertExecutionIdentity, assertParentMessageSize, parseProviderMessage, sameExecutionIdentity,
  type ExecutionIdentity, type ParentMessage
} from '../common/executionLifecycle';
import type {
  ExecutionParentCleanupBudget, ExecutionParentControl, ExecutionScheduler, ExecutionTransport, ExecutionTransportSink
} from './executionSessionAdapter';

export function createNodeExecutionScheduler(): ExecutionScheduler {
  return {
    now: () => performance.now(),
    scheduleTask: callback => { setImmediate(callback); },
    scheduleDeadline(deadline, callback) {
      const remaining = deadline - performance.now();
      if (!Number.isFinite(remaining) || remaining > 0x7fffffff) throw new Error('Invalid observation deadline');
      let cancelled = false;
      const wake = (): void => {
        if (cancelled) return;
        const left = deadline - performance.now();
        // Node timers can wake before a fractional monotonic deadline.
        if (left > 0) { timer = setTimeout(wake, Math.ceil(left)); return; }
        cancelled = true;
        callback();
      };
      let timer = setTimeout(wake, Math.max(0, Math.ceil(remaining)));
      return () => { cancelled = true; clearTimeout(timer); };
    }
  };
}

export interface ExecutionProviderTransportOptions {
  identity: ExecutionIdentity;
  executable: string;
  entryPoint: string;
  args?: readonly string[];
  env?: NodeJS.ProcessEnv;
  parentCleanup?: {
    scheduler: ExecutionScheduler;
    expectedNativeResourceIds: readonly string[];
  };
}

export type ProviderClosed = Readonly<{ kind: 'closed'; exitCode: number | null; signal: string | null }>;
type ProviderCleanupResult = ProviderClosed | Readonly<{ kind: 'unknown' }>;
type ProviderTermination = {
  termDeadline: number;
  killDeadline: number;
  result: Promise<ProviderCleanupResult>;
  observation?: {
    canSignal: () => boolean;
    resolve: (result: ProviderCleanupResult) => void;
    first?: ProviderCleanupResult;
    cancelDeadline?: () => void;
  };
};

export function createExecutionProviderTransport(options: ExecutionProviderTransportOptions): ExecutionProviderTransport {
  return new ExecutionProviderTransport(options);
}

export class ExecutionProviderTransport implements ExecutionTransport {
  readonly closed: Promise<ProviderClosed>;
  readonly parentControl?: ExecutionParentControl;
  private resolveClosed!: (result: ProviderClosed) => void;
  private readonly options: ExecutionProviderTransportOptions;
  private sink?: ExecutionTransportSink;
  private child?: ChildProcess;
  private connected = false;
  private spawned = false;
  private childExited = false;
  private childClosed = false;
  private ipcDisconnected = false;
  private outputEnded = false;
  private outputClosed = false;
  private stderrClosed = false;
  private inputClosed = false;
  private sendPending = false;
  private firstFault?: string;
  private stderrBytes = 0;
  private stderrTruncated = false;
  private readonly stderr = Buffer.alloc(64 * 1024);
  private closeResult?: ProviderClosed;
  private releaseReported = false;
  private releasedAt?: number;
  private termination?: ProviderTermination;
  private termRequested = false;
  private killRequested = false;

  constructor(options: ExecutionProviderTransportOptions) {
    if (!['linux', 'darwin', 'win32'].includes(process.platform)) {
      throw new Error('Execution provider transport requires a supported platform');
    }
    assertExecutionIdentity(options.identity);
    if (!isAbsolute(options.executable) || !isAbsolute(options.entryPoint)) throw new Error('Provider paths must be explicit and absolute');
    if (options.args?.some(arg => typeof arg !== 'string')) throw new Error('Invalid provider arguments');
    let parentCleanup: ExecutionProviderTransportOptions['parentCleanup'];
    if (options.parentCleanup) {
      const { scheduler, expectedNativeResourceIds } = options.parentCleanup;
      if (!scheduler || typeof scheduler.now !== 'function' || typeof scheduler.scheduleDeadline !== 'function'
        || typeof scheduler.scheduleTask !== 'function') throw new Error('An explicit parent cleanup scheduler is required');
      if (!Array.isArray(expectedNativeResourceIds) || expectedNativeResourceIds.length < 1 || expectedNativeResourceIds.length > 15
        || new Set(expectedNativeResourceIds).size !== expectedNativeResourceIds.length
        || [...expectedNativeResourceIds].some(id => typeof id !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(id)
          || id === 'provider-control')) throw new Error('Invalid parent cleanup native resource contract');
      parentCleanup = Object.freeze({ scheduler, expectedNativeResourceIds: Object.freeze([...expectedNativeResourceIds]) });
    }
    this.options = Object.freeze({ ...options, identity: Object.freeze({ ...options.identity }),
      args: Object.freeze([...(options.args ?? [])]), env: options.env ? Object.freeze({ ...options.env }) : undefined,
      parentCleanup });
    this.closed = new Promise(resolve => { this.resolveClosed = resolve; });
    if (parentCleanup) {
      this.parentControl = Object.freeze({
        identity: this.options.identity, scheduler: parentCleanup.scheduler,
        expectedNativeResourceIds: parentCleanup.expectedNativeResourceIds, closed: this.closed,
        terminate: (budget: ExecutionParentCleanupBudget) => this.terminate({ ...budget, closeObservationV1: true })
      });
    }
  }

  connect(sink: ExecutionTransportSink): void {
    if (this.connected) throw new Error('Provider transport already connected');
    this.connected = true;
    this.sink = sink;
    try {
      this.child = spawn(this.options.executable,
        [this.options.entryPoint, this.options.identity.executionId, this.options.identity.generation, ...this.options.args!],
        { stdio: process.platform === 'win32' ? ['overlapped', 'ignore', 'overlapped', 'ipc', 'overlapped']
          : ['pipe', 'ignore', 'pipe', 'ipc', 'pipe'], shell: false, detached: false,
          env: this.options.env ?? process.env, serialization: 'json' });
    } catch {
      this.reportFault('Provider spawn failed before a child handle was returned');
      sink.startupFailed('Provider spawn failed');
      this.childClosed = this.ipcDisconnected = this.outputClosed = this.stderrClosed = this.inputClosed = true;
      sink.dataClosed('Provider output was not established');
      this.finishClose(null, null);
      sink.disconnected('Provider control was not established');
      return;
    }
    const child = this.child;
    const output = child.stdio[4] as Readable | null;
    const diagnostics = child.stderr;
    const input = child.stdin;
    this.outputClosed = !output;
    this.stderrClosed = !diagnostics;
    this.inputClosed = !input;

    child.on('spawn', () => { this.spawned = true; });
    child.on('error', () => {
      this.reportFault(this.spawned ? 'Provider child operation failed' : 'Provider spawn failed');
      if (!this.spawned) {
        sink.startupFailed('Provider spawn failed');
        input?.destroy();
        output?.destroy();
        diagnostics?.destroy();
      }
    });
    child.on('message', value => {
      try {
        const message = parseProviderMessage(value);
        if (!sameExecutionIdentity(message.identity, this.options.identity)) throw new Error('Identity mismatch');
        if ((message.type === 'resourceAcquired' || message.type === 'resourceResult')
          && message.resourceId === 'provider-control') throw new Error('Parent resource spoof');
        sink.message(message);
      } catch { this.reportFault('Invalid provider control message or parent resource claim'); }
    });
    child.on('disconnect', () => {
      this.ipcDisconnected = true;
      sink.disconnected('Provider IPC disconnected');
      this.maybeFinishClose();
    });
    child.on('exit', () => { this.childExited = true; sink.exited(); });
    child.on('close', (exitCode, signal) => {
      this.childClosed = true;
      this.closeResult = Object.freeze({ kind: 'closed', exitCode, signal });
      // A failed spawn need not have established an IPC channel at all.
      if (!child.connected) this.ipcDisconnected = true;
      this.maybeFinishClose();
    });
    output?.on('data', (bytes: Buffer) => { sink.data(bytes); });
    output?.on('end', () => { this.outputEnded = true; sink.dataEnded(); });
    output?.on('error', () => { this.reportFault('Provider output pipe failed'); });
    output?.on('close', () => {
      this.outputClosed = true;
      if (!this.outputEnded) sink.dataClosed('Provider output closed without end');
      this.maybeFinishClose();
    });
    diagnostics?.on('data', (bytes: Buffer) => {
      const length = Math.min(bytes.byteLength, this.stderr.length - this.stderrBytes);
      bytes.copy(this.stderr, this.stderrBytes, 0, length);
      this.stderrBytes += length;
      if (length !== bytes.byteLength) this.stderrTruncated = true;
    });
    diagnostics?.on('error', () => { this.reportFault('Provider diagnostic pipe failed'); });
    diagnostics?.on('close', () => { this.stderrClosed = true; this.maybeFinishClose(); });
    input?.on('error', () => { this.reportFault('Provider input pipe failed'); });
    input?.on('close', () => { this.inputClosed = true; this.maybeFinishClose(); });
    // Terminal input uses bounded IPC commands, never a second stdin stream.
    input?.end();
  }

  send(message: ParentMessage): Promise<void> {
    assertParentMessageSize(message);
    if (!sameExecutionIdentity(message.identity, this.options.identity)) throw new Error('Parent command identity mismatch');
    const child = this.child;
    if (!child?.connected || this.childExited || this.childClosed) return Promise.reject(new Error('Provider control is unavailable'));
    if (this.sendPending) return Promise.reject(new Error('Only one parent send may be in flight'));
    this.sendPending = true;
    return new Promise<void>((resolve, reject) => {
      const done = (error: Error | null) => {
        this.sendPending = false;
        if (error) reject(new Error('Provider control send failed'));
        else resolve();
      };
      try { child.send(message, done); }
      catch { done(new Error('Provider control send failed')); }
    });
  }

  terminate(budget: { termDeadline: number; killDeadline: number; closeObservationV1?: true;
    canSignal?: () => boolean }): Promise<ProviderClosed | { kind: 'unknown' }> {
    const deadlines = Object.freeze({ termDeadline: budget.termDeadline, killDeadline: budget.killDeadline });
    const observeClose = budget.closeObservationV1 === true;
    const canSignal = budget.canSignal;
    if (this.termination) {
      if (deadlines.termDeadline !== this.termination.termDeadline || deadlines.killDeadline !== this.termination.killDeadline) {
        throw new Error('Provider termination already requested with different deadlines');
      }
      if (observeClose !== Boolean(this.termination.observation)
        || (observeClose && canSignal !== this.termination.observation!.canSignal)) {
        throw new Error('Provider termination already requested with different parameters');
      }
      return this.termination.result;
    }
    if (!this.connected) throw new Error('Provider transport has not connected');
    if (observeClose) {
      const scheduler = this.options.parentCleanup?.scheduler;
      if (!scheduler || typeof canSignal !== 'function') throw new Error('Original parent cleanup capability and guard are required');
      if (!Number.isFinite(deadlines.termDeadline) || !Number.isFinite(deadlines.killDeadline)
        || deadlines.killDeadline <= deadlines.termDeadline
        || deadlines.killDeadline - scheduler.now() > 0x7fffffff) throw new Error('Invalid provider cleanup deadlines');
      let resolve!: (result: ProviderCleanupResult) => void;
      const result = new Promise<ProviderCleanupResult>(done => { resolve = done; });
      const termination: ProviderTermination = { ...deadlines, result, observation: { canSignal, resolve } };
      this.termination = termination;
      void Promise.resolve().then(() => this.advanceParentTermination(termination));
      return result;
    }
    if (!Number.isFinite(deadlines.termDeadline) || !Number.isFinite(deadlines.killDeadline)
      || deadlines.termDeadline <= performance.now() || deadlines.killDeadline <= deadlines.termDeadline
      || deadlines.killDeadline - performance.now() > 0x7fffffff) throw new Error('Invalid provider cleanup deadlines');
    const result = Promise.resolve().then(() => this.runTermination(deadlines));
    this.termination = { ...deadlines, result };
    return result;
  }

  snapshot() {
    return Object.freeze({ spawned: this.spawned, pid: this.child?.pid, closed: Boolean(this.closeResult && this.isReleased()),
      disconnected: this.ipcDisconnected, exited: this.childExited, dataEnded: this.outputEnded, dataClosed: this.outputClosed,
      stderrBytes: this.stderrBytes, stderrTruncated: this.stderrTruncated, firstFault: this.firstFault,
      termRequested: this.termRequested, killRequested: this.killRequested });
  }

  private reportFault(reason: string): void {
    if (this.firstFault) return;
    this.firstFault = reason;
    this.sink?.transportFault(reason);
  }

  private isReleased(): boolean {
    return this.childClosed && this.ipcDisconnected && this.outputClosed && this.stderrClosed && this.inputClosed;
  }

  private maybeFinishClose(): void {
    if (this.closeResult && this.isReleased()) this.finishClose(this.closeResult.exitCode, this.closeResult.signal);
  }

  private finishClose(exitCode: number | null, signal: string | null): void {
    if (this.releaseReported) return;
    this.releaseReported = true;
    this.releasedAt = this.options.parentCleanup?.scheduler.now();
    const result = this.closeResult ?? Object.freeze({ kind: 'closed' as const, exitCode, signal });
    this.closeResult = result;
    if (this.termination?.observation) {
      const expired = this.releasedAt! >= this.termination.killDeadline;
      this.finishParentTermination(this.termination, expired ? { kind: 'unknown' } : result, expired);
    }
    this.sink!.controlResourceResult({ kind: 'released' });
    this.resolveClosed(result);
  }

  private advanceParentTermination(termination: ProviderTermination): void {
    const observation = termination.observation!;
    if (observation.first) return;
    const scheduler = this.options.parentCleanup!.scheduler;
    if (this.releaseReported) {
      // The resource fact may predate this cleanup request; never publish unknown after released.
      this.finishParentTermination(termination,
        this.releasedAt! < termination.killDeadline ? this.closeResult! : { kind: 'unknown' }, false);
      return;
    }
    if (scheduler.now() >= termination.killDeadline) {
      this.finishParentTermination(termination, { kind: 'unknown' }, true);
      return;
    }
    let signal: 'SIGTERM' | 'SIGKILL' = scheduler.now() < termination.termDeadline ? 'SIGTERM' : 'SIGKILL';
    const alreadyRequested = signal === 'SIGTERM' ? this.termRequested : this.killRequested;
    if (!alreadyRequested && this.child && !this.childExited && !this.childClosed && this.child.pid) {
      let allowed: boolean;
      try { allowed = observation.canSignal() === true; }
      catch {
        this.finishParentTermination(termination, { kind: 'unknown' }, true, 'Parent cleanup safety check failed');
        this.reportFault('Parent cleanup safety check failed');
        return;
      }
      if (observation.first) return;
      const now = scheduler.now();
      if (now >= termination.killDeadline) {
        this.finishParentTermination(termination, { kind: 'unknown' }, true);
        return;
      }
      signal = now < termination.termDeadline ? 'SIGTERM' : 'SIGKILL';
      if (allowed) this.requestSignal(signal);
    }
    if (observation.first) return;
    const now = scheduler.now();
    if (now >= termination.killDeadline) {
      this.finishParentTermination(termination, { kind: 'unknown' }, true);
      return;
    }
    if (signal === 'SIGTERM' && now >= termination.termDeadline) {
      this.advanceParentTermination(termination);
      return;
    }
    const deadline = now < termination.termDeadline ? termination.termDeadline : termination.killDeadline;
    observation.cancelDeadline = scheduler.scheduleDeadline(deadline, () => this.advanceParentTermination(termination));
  }

  private finishParentTermination(termination: ProviderTermination, result: ProviderCleanupResult,
    reportUnknown: boolean, reason = 'Provider close observation deadline reached'): void {
    const observation = termination.observation!;
    if (observation.first) return;
    // Freeze before resource observers or fault handlers can synchronously reenter.
    observation.first = Object.freeze({ ...result });
    observation.cancelDeadline?.();
    observation.resolve(observation.first);
    if (reportUnknown) this.sink!.controlResourceResult({ kind: 'unknown', reason });
  }

  private async runTermination(budget: { termDeadline: number; killDeadline: number }): Promise<ProviderClosed | { kind: 'unknown' }> {
    if (this.isReleased()) return this.closed;
    this.requestSignal('SIGTERM');
    const normal = await this.observeClose(budget.termDeadline);
    if (normal) return normal;
    this.requestSignal('SIGKILL');
    const forced = await this.observeClose(budget.killDeadline);
    if (forced) return forced;
    this.sink!.controlResourceResult({ kind: 'unknown', reason: 'Provider close observation deadline reached' });
    return Object.freeze({ kind: 'unknown' });
  }

  private requestSignal(signal: 'SIGTERM' | 'SIGKILL'): void {
    if (!this.child || this.childExited || this.childClosed || !this.child.pid) return;
    if (signal === 'SIGTERM' ? this.termRequested : this.killRequested) return;
    if (signal === 'SIGTERM') this.termRequested = true;
    else this.killRequested = true;
    try { if (!this.child.kill(signal)) this.reportFault('Provider termination request was not accepted'); }
    catch { this.reportFault('Provider termination request failed'); }
  }

  private observeClose(deadline: number): Promise<ProviderClosed | undefined> {
    return new Promise(resolve => {
      const timer = setTimeout(() => resolve(undefined), Math.max(0, deadline - performance.now()));
      void this.closed.then(result => { clearTimeout(timer); resolve(result); });
    });
  }
}
