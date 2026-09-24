import { spawn, type ChildProcess } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { Readable } from 'node:stream';
import {
  assertExecutionIdentity, assertParentMessageSize, parseProviderMessage, sameExecutionIdentity,
  type ExecutionIdentity, type ParentMessage
} from '../common/executionLifecycle';
import type { ExecutionScheduler, ExecutionTransport, ExecutionTransportSink } from './executionSessionAdapter';

export function createNodeExecutionScheduler(): ExecutionScheduler {
  return {
    now: () => performance.now(),
    scheduleTask: callback => { setImmediate(callback); },
    scheduleDeadline(deadline, callback) {
      const remaining = deadline - performance.now();
      if (!Number.isFinite(remaining) || remaining > 0x7fffffff) throw new Error('Invalid observation deadline');
      const timer = setTimeout(callback, Math.max(0, remaining));
      return () => clearTimeout(timer);
    }
  };
}

export interface ExecutionProviderTransportOptions {
  identity: ExecutionIdentity;
  executable: string;
  entryPoint: string;
  args?: readonly string[];
  env?: NodeJS.ProcessEnv;
}

export type ProviderClosed = Readonly<{ kind: 'closed'; exitCode: number | null; signal: string | null }>;

export function createExecutionProviderTransport(options: ExecutionProviderTransportOptions): ExecutionProviderTransport {
  return new ExecutionProviderTransport(options);
}

export class ExecutionProviderTransport implements ExecutionTransport {
  readonly closed: Promise<ProviderClosed>;
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
  private termination?: { termDeadline: number; killDeadline: number; result: Promise<ProviderClosed | { kind: 'unknown' }> };
  private termRequested = false;
  private killRequested = false;

  constructor(options: ExecutionProviderTransportOptions) {
    if (process.platform !== 'linux') throw new Error('Execution provider transport is not validated on this platform');
    assertExecutionIdentity(options.identity);
    if (!isAbsolute(options.executable) || !isAbsolute(options.entryPoint)) throw new Error('Provider paths must be explicit and absolute');
    if (options.args?.some(arg => typeof arg !== 'string')) throw new Error('Invalid provider arguments');
    this.options = Object.freeze({ ...options, identity: Object.freeze({ ...options.identity }),
      args: Object.freeze([...(options.args ?? [])]), env: options.env ? Object.freeze({ ...options.env }) : undefined });
    this.closed = new Promise(resolve => { this.resolveClosed = resolve; });
  }

  connect(sink: ExecutionTransportSink): void {
    if (this.connected) throw new Error('Provider transport already connected');
    this.connected = true;
    this.sink = sink;
    try {
      this.child = spawn(this.options.executable,
        [this.options.entryPoint, this.options.identity.executionId, this.options.identity.generation, ...this.options.args!],
        { stdio: ['pipe', 'ignore', 'pipe', 'ipc', 'pipe'], shell: false, detached: false,
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
        if (message.type === 'resourceResult' && message.resourceId === 'provider-control') throw new Error('Parent resource spoof');
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
    // Terminal input is deliberately not exposed in S2.
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

  terminate(budget: { termDeadline: number; killDeadline: number }): Promise<ProviderClosed | { kind: 'unknown' }> {
    const deadlines = Object.freeze({ termDeadline: budget.termDeadline, killDeadline: budget.killDeadline });
    if (this.termination) {
      if (deadlines.termDeadline !== this.termination.termDeadline || deadlines.killDeadline !== this.termination.killDeadline) {
        throw new Error('Provider termination already requested with different deadlines');
      }
      return this.termination.result;
    }
    if (!this.connected) throw new Error('Provider transport has not connected');
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
    const result = this.closeResult ?? Object.freeze({ kind: 'closed' as const, exitCode, signal });
    this.closeResult = result;
    this.sink!.controlResourceResult({ kind: 'released' });
    this.resolveClosed(result);
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
