import { randomUUID } from 'crypto';
import { realpathSync } from 'fs';
import * as net from 'net';
import { performance } from 'node:perf_hooks';
import { ensureRuntimeRootSocketDirectory } from '../supervisor/runtimeRootOwner';

import {
  RUNTIME_SUPERVISOR_ERROR_CODES,
  createRuntimeSupervisorError,
  createRuntimeSupervisorProtocolError
} from '../common/runtimeSupervisorProtocol';
import type {
  RuntimeSupervisorAttachSessionParams,
  RuntimeSupervisorAckSessionRevisionParams,
  RuntimeSupervisorAckSessionRevisionResult,
  RuntimeSupervisorClientEventHandlers,
  RuntimeSupervisorCreateSessionParams,
  RuntimeSupervisorDeleteSessionParams,
  RuntimeSupervisorEvent,
  RuntimeSupervisorGetSessionCheckpointParams,
  RuntimeSupervisorGetSessionSnapshotParams,
  RuntimeSupervisorHelloResult,
  RuntimeSupervisorMessage,
  RuntimeSupervisorResizeSessionParams,
  RuntimeSupervisorSessionCheckpointResult,
  RuntimeSupervisorSessionSnapshot,
  RuntimeSupervisorStopSessionParams,
  RuntimeSupervisorSubscribeSessionParams,
  RuntimeSupervisorSubscribeSessionResult,
  RuntimeSupervisorUpdateSessionScrollbackParams,
  RuntimeSupervisorWriteInputParams
} from '../common/runtimeSupervisorProtocol';
import type {
  RuntimeSupervisorOpenTerminalReadParams,
  RuntimeSupervisorReadTerminalPageParams,
  RuntimeSupervisorCloseTerminalReadParams,
  RuntimeSupervisorCloseTerminalReadResult
} from '../common/runtimeSupervisorProtocol';
import {
  normalizeTerminalReadOutcome,
  normalizeTerminalStreamRead,
  type TerminalStreamPage,
  type TerminalStreamReadDescriptor
} from '../common/terminalStreamPaging';
import type { RuntimeHostBackend } from './runtimeHostBackend';
import type { ExecutionScheduler } from './executionSessionAdapter';
import type { ExecutionCandidateProfile } from '../common/executionLifecycle';
import {
  assertExecutionCandidateRuntimeSupervisorStorageDir,
  isRootOwnerRuntimeSupervisorStorageDir,
  isRuntimeRootStorageNamespace,
  resolveRootRuntimeSupervisorGeneration
} from '../common/runtimeSupervisorPaths';
import {
  createRuntimeOwnerCompatibilityFingerprint,
  assertRuntimeOwnerDescriptor,
  runtimeOwnerDescriptorsEqual,
  resolveRuntimeRootOwnerGlobalStoragePath,
  type RuntimeOwnerDescriptorV1
} from '../common/runtimeRootOwnership';

interface PendingSupervisorRequest<T> {
  socket: net.Socket;
  deadline?: number;
  timeout?: ReturnType<typeof setTimeout>;
  method: string;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  expire: () => void;
  // Only an actual error response can confirm legacy absence or rejection.
  responseError?: (error: Error) => void;
}

export interface StrictRuntimeDeleteResult {
  readonly kind: 'legacy-acknowledged' | 'legacy-absent' | 'failed' | 'unconfirmed';
  readonly reason?: string;
  readonly error?: Error;
}

export interface StrictRuntimeDeleteObservation {
  readonly first: Promise<StrictRuntimeDeleteResult>;
  readonly submitted: boolean;
  readonly attemptSettled: boolean;
  current(): StrictRuntimeDeleteResult | undefined;
}

export interface StrictRuntimeDeleteOptions {
  readonly deadline: number;
  readonly scheduler: ExecutionScheduler;
  readonly isCurrent?: () => boolean;
}

interface TerminalReadConnection {
  socket: net.Socket;
  sessionId: string;
  authorityId: string;
  consumerId: 'editor' | 'panel';
  closed: boolean;
}

interface HostOutputSubscription {
  socket: net.Socket;
  sessionId: string;
  authorityId: string;
  subscriptionId: string;
  revision: number;
  batchId: number;
  consuming: boolean;
}

const CLOSED_TERMINAL_READ_CONNECTION_LIMIT = 128;
const REQUEST_TIMEOUT_MS = 15_000;
const HELLO_TIMEOUT_MS = 5_000;

export class ExecutionCandidateHandshakeError extends Error {}

export interface RuntimeSupervisorClientOptions extends RuntimeSupervisorClientEventHandlers {
  backend: RuntimeHostBackend;
  supervisorScriptPath: string;
  supervisorLauncherScriptPath: string;
  executionProfile?: ExecutionCandidateProfile;
  expectedRuntimeOwner?: RuntimeOwnerDescriptorV1;
  onDisconnected?: (error?: Error) => void;
  onTerminalBatchSettled?: () => void;
}

export class RuntimeSupervisorClient {
  private socket: net.Socket | undefined;
  private connectPromise: Promise<void> | undefined;
  private cancelSocketConnection: (() => void) | undefined;
  private disposed = false;
  private buffer = '';
  private helloResult: RuntimeSupervisorHelloResult | undefined;
  private readonly expectedRuntimeOwner?: RuntimeOwnerDescriptorV1;
  private readonly pendingRequests = new Map<string, PendingSupervisorRequest<unknown>>();
  private readonly terminalReadConnections = new Map<string, TerminalReadConnection>();
  private readonly hostOutputSubscriptions = new Map<string, HostOutputSubscription>();
  private readonly strictDeletes = new Map<string, {
    preserveTerminalReads: boolean;
    observation: StrictRuntimeDeleteObservation;
  }>();
  private strictDeleteConnection?: Promise<net.Socket>;

  public constructor(private readonly options: RuntimeSupervisorClientOptions) {
    const storageDir = options.backend.paths?.storageDir;
    const rootOwnerStorage = storageDir !== undefined && isRootOwnerRuntimeSupervisorStorageDir(storageDir);
    if (storageDir !== undefined) {
      if (isRuntimeRootStorageNamespace(storageDir) && !rootOwnerStorage) {
        throw new Error('Reserved root runtime storage requires a supported root owner generation.');
      }
      try {
        const canonicalStorageDir = realpathSync(storageDir);
        const canonicalRootOwner = isRootOwnerRuntimeSupervisorStorageDir(canonicalStorageDir);
        if (isRuntimeRootStorageNamespace(canonicalStorageDir) && !canonicalRootOwner) {
          throw new Error('Reserved root runtime storage requires a supported root owner generation.');
        }
        if (!rootOwnerStorage && canonicalRootOwner) {
          throw new Error('Root runtime owner cannot be opened through a legacy storage alias.');
        }
      } catch (error) {
        if (!(error instanceof Error) || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    if (rootOwnerStorage !== (options.expectedRuntimeOwner !== undefined)) {
      throw new Error('Root runtime owner storage requires an explicit matching owner descriptor; legacy storage cannot adopt one.');
    }
    if (rootOwnerStorage) {
      if (options.executionProfile === undefined) {
        throw new Error('Root runtime owner requires an explicit execution profile.');
      }
      assertRuntimeOwnerDescriptor(options.expectedRuntimeOwner);
      if (options.expectedRuntimeOwner.generation !== resolveRootRuntimeSupervisorGeneration(options.executionProfile)) {
        throw new Error('Root runtime owner generation does not match its execution profile.');
      }
      resolveRuntimeRootOwnerGlobalStoragePath(storageDir!, options.expectedRuntimeOwner);
      this.expectedRuntimeOwner = Object.freeze({
        ...options.expectedRuntimeOwner, root: Object.freeze({ ...options.expectedRuntimeOwner.root })
      });
    }
    if (options.executionProfile !== undefined) {
      assertExecutionCandidateRuntimeSupervisorStorageDir(options.backend.paths.storageDir, options.executionProfile);
    }
  }

  public async ensureConnected(options: { allowRestart?: boolean } = {}): Promise<void> {
    if (this.disposed) {
      throw createRuntimeSupervisorProtocolError({
        id: 'clientDisposed'
      }, RUNTIME_SUPERVISOR_ERROR_CODES.clientDisposed);
    }
    if (this.expectedRuntimeOwner && options.allowRestart === true) {
      throw new Error('Root runtime owner startup requires coordinated preparation; automatic startup is unavailable.');
    }

    if (this.connectPromise) {
      return this.connectPromise;
    }

    if (this.socket && !this.socket.destroyed && this.helloResult) {
      return;
    }

    const allowRestart = options.allowRestart ?? (!this.expectedRuntimeOwner && this.options.executionProfile === undefined);
    const connectPromise = this.connectWithRestart(allowRestart);
    this.connectPromise = connectPromise;
    void connectPromise.then(
      () => this.clearConnectPromise(connectPromise),
      () => this.clearConnectPromise(connectPromise)
    );
    return connectPromise;
  }

  public async hello(): Promise<RuntimeSupervisorHelloResult> {
    await this.ensureConnected();
    if (!this.helloResult) {
      throw createRuntimeSupervisorProtocolError({
        id: 'clientNotConnected'
      }, RUNTIME_SUPERVISOR_ERROR_CODES.clientNotConnected);
    }
    return this.helloResult;
  }

  public matchesRuntimeOwner(expected: RuntimeOwnerDescriptorV1 | undefined): boolean {
    return expected === undefined ? this.expectedRuntimeOwner === undefined
      : runtimeOwnerDescriptorsEqual(this.expectedRuntimeOwner, expected);
  }

  public supportsTerminalProjectionSnapshot(): boolean {
    return this.helloResult?.capabilities?.terminalProjectionSnapshotV1 === true;
  }

  public supportsTerminalCheckpointRefresh(): boolean {
    return this.helloResult?.capabilities?.terminalCheckpointRefreshV1 === true;
  }

  public supportsTerminalPagedRead(): boolean {
    return this.helloResult?.capabilities?.terminalPagedReadV1 === true;
  }

  public supportsTerminalPagedCompletion(): boolean {
    return this.supportsTerminalPagedRead() && this.helloResult?.capabilities?.terminalPagedCompletionV1 === true;
  }

  public supportsTerminalReadSettlement(): boolean {
    return this.supportsTerminalPagedCompletion() && this.helloResult?.capabilities?.terminalReadSettlementV1 === true;
  }

  public supportsTerminalCurrentState(): boolean {
    return this.supportsTerminalPagedCompletion() && this.helloResult?.capabilities?.terminalCurrentStateV1 === true;
  }

  public supportsTerminalHostOutputCredit(): boolean {
    return this.supportsTerminalPagedCompletion() && this.helloResult?.capabilities?.terminalHostOutputCreditV1 === true;
  }

  public supportsExecutionCandidateProfile(profile: ExecutionCandidateProfile): boolean {
    return helloSupportsExecutionCandidateProfile(this.helloResult, profile);
  }

  public async openTerminalRead(params: RuntimeSupervisorOpenTerminalReadParams,
    onTimeout?: (lateRead: Promise<TerminalStreamReadDescriptor>) => void
  ): Promise<TerminalStreamReadDescriptor> {
    await this.ensureConnected({ allowRestart: false });
    const socket = this.socket;
    if (params.settlementMode !== undefined &&
        (params.settlementMode !== 'final-application-v1' || !this.supportsTerminalReadSettlement())) {
      throw new Error('Terminal reader settlement capability is unavailable.');
    }
    if (params.currentState !== undefined &&
        (params.currentState !== 'xterm-current-state-v1' || !this.supportsTerminalCurrentState())) {
      throw new Error('Terminal current state capability is unavailable.');
    }
    const result = await this.requestOnConnectedSocket<TerminalStreamReadDescriptor>(
      'openTerminalRead', params, socket, undefined, undefined, performance.now() + REQUEST_TIMEOUT_MS,
      lateResponse => {
        const lateRead = lateResponse.then(value => this.bindTerminalReadResult(params, value, socket, true));
        if (onTimeout) onTimeout(lateRead);
        else {
          // A direct caller has already received timeout and cannot release a descriptor it never saw.
          void lateRead.then(read => this.closeTerminalRead({
            sessionId: read.sessionId, authorityId: read.authorityId, readId: read.readId,
            ...(read.settlementMode ? { outcome: { kind: 'cancelled' as const, reason: 'open-timed-out' } } : {})
          })).catch(() => undefined);
        }
      });
    return this.bindTerminalReadResult(params, result, socket);
  }

  private bindTerminalReadResult(params: RuntimeSupervisorOpenTerminalReadParams,
    result: TerminalStreamReadDescriptor, socket: net.Socket | undefined, late = false
  ): TerminalStreamReadDescriptor {
    if (!late && params.settlementMode === undefined && params.currentState === undefined) return result;
    if (!socket || socket !== this.socket || socket.destroyed || this.disposed) {
      throw new Error('Terminal reader connection changed while opening.');
    }
    const read = normalizeTerminalStreamRead(result);
    if (!read || read.sessionId !== params.sessionId || read.authorityId !== params.authorityId) {
      throw new Error('Invalid terminal reader settlement descriptor.');
    }
    if (read.settlementMode !== params.settlementMode || read.currentState?.format !== params.currentState) {
      void this.requestOnConnectedSocket('closeTerminalRead', {
        sessionId: read.sessionId, authorityId: read.authorityId, readId: read.readId
      }, socket).catch(() => undefined);
      throw new Error(read.settlementMode !== params.settlementMode
        ? 'Terminal reader settlement was not negotiated.' : 'Terminal current state was not negotiated.');
    }
    // A late descriptor exists only for cleanup; it must not retire a newer reader's local binding.
    if (!late) {
      for (const binding of this.terminalReadConnections.values()) {
        if (binding.socket === socket && binding.sessionId === read.sessionId && binding.consumerId === params.consumerId) {
          binding.closed = true;
        }
      }
    }
    this.terminalReadConnections.set(read.readId, { socket, sessionId: read.sessionId,
      authorityId: read.authorityId, consumerId: params.consumerId, closed: false });
    this.pruneClosedTerminalReadConnections();
    return read;
  }

  public async readTerminalPage(params: RuntimeSupervisorReadTerminalPageParams): Promise<TerminalStreamPage> {
    const binding = this.terminalReadConnections.get(params.readId);
    if (binding) {
      this.assertTerminalReadConnection(binding, params);
      if (binding.closed) throw new Error('Terminal reader is already closed.');
      return this.requestOnConnectedSocket('readTerminalPage', params, binding.socket);
    }
    await this.ensureConnected({ allowRestart: false });
    return this.requestOnConnectedSocket('readTerminalPage', params);
  }

  public async closeTerminalRead(params: RuntimeSupervisorCloseTerminalReadParams): Promise<RuntimeSupervisorCloseTerminalReadResult> {
    const binding = this.terminalReadConnections.get(params.readId);
    if (params.outcome !== undefined) {
      const outcome = normalizeTerminalReadOutcome(params.outcome);
      if (!outcome) throw new Error('Invalid terminal reader outcome.');
      if (!binding || binding.sessionId !== params.sessionId || binding.authorityId !== params.authorityId) {
        return { ok: true, settlement: 'unconfirmed' };
      }
      if (this.disposed || this.socket !== binding.socket || binding.socket.destroyed || !this.helloResult) {
        binding.closed = true;
        this.pruneClosedTerminalReadConnections();
        return { ok: true, settlement: 'unconfirmed' };
      }
      const result = await this.requestOnConnectedSocket<RuntimeSupervisorCloseTerminalReadResult>(
        'closeTerminalRead', { ...params, outcome }, binding.socket);
      if (result?.ok !== true || !['recorded', 'duplicate', 'unconfirmed'].includes(result.settlement ?? '')) {
        throw new Error('Invalid terminal reader settlement response.');
      }
      binding.closed = true;
      this.pruneClosedTerminalReadConnections();
      return result;
    }
    if (binding && (this.socket !== binding.socket || binding.socket.destroyed)) {
      binding.closed = true;
      this.pruneClosedTerminalReadConnections();
      return { ok: true, settlement: 'unconfirmed' };
    }
    if (this.socket && !this.socket.destroyed && this.helloResult) {
      const result = await this.requestOnConnectedSocket<RuntimeSupervisorCloseTerminalReadResult>('closeTerminalRead', params);
      if (binding) { binding.closed = true; this.pruneClosedTerminalReadConnections(); }
      return result;
    }
    return { ok: true };
  }

  private assertTerminalReadConnection(binding: TerminalReadConnection, params: RuntimeSupervisorReadTerminalPageParams): void {
    if (this.disposed || binding.socket !== this.socket || binding.socket.destroyed || !this.helloResult ||
        binding.sessionId !== params.sessionId || binding.authorityId !== params.authorityId) {
      throw new Error('Terminal reader connection is no longer current.');
    }
  }

  private pruneClosedTerminalReadConnections(): void {
    let closed = [...this.terminalReadConnections.values()].filter(binding => binding.closed).length;
    for (const [readId, binding] of this.terminalReadConnections) {
      if (closed <= CLOSED_TERMINAL_READ_CONNECTION_LIMIT) break;
      if (binding.closed) { this.terminalReadConnections.delete(readId); closed--; }
    }
  }

  public supportsTerminalSessionStream(): boolean {
    return this.helloResult?.capabilities?.terminalSessionStreamV1 === true;
  }

  public supportsTerminalAppliedRevisionAck(): boolean {
    return this.helloResult?.capabilities?.terminalAppliedRevisionAckV1 === true;
  }

  public hasPendingRequests(): boolean {
    return this.pendingRequests.size > 0 || [...this.hostOutputSubscriptions.values()].some(binding => binding.consuming);
  }

  public async createSession(
    params: RuntimeSupervisorCreateSessionParams
  ): Promise<RuntimeSupervisorSessionSnapshot> {
    if (params.executionProfile !== undefined) {
      const socket = this.socket;
      if (!socket || socket.destroyed || this.disposed || !this.supportsExecutionCandidateProfile(params.executionProfile)) {
        throw new Error('The original runtime connection does not support the execution candidate profile.');
      }
      const result = await this.requestOnConnectedSocket<RuntimeSupervisorSessionSnapshot>('createSession', params, socket);
      if (this.socket !== socket || socket.destroyed || this.disposed) {
        throw new Error('Runtime connection changed while creating the execution candidate.');
      }
      return result;
    }
    return this.request('createSession', params);
  }

  public async attachSession(
    params: RuntimeSupervisorAttachSessionParams
  ): Promise<RuntimeSupervisorSessionSnapshot> {
    if (params.terminalStreamMode) {
      await this.ensureConnected({ allowRestart: false });
      return this.requestOnConnectedSocket('attachSession', params);
    }
    return this.request('attachSession', params);
  }

  public async getSessionSnapshot(
    params: RuntimeSupervisorGetSessionSnapshotParams
  ): Promise<RuntimeSupervisorSessionSnapshot> {
    return this.request('getSessionSnapshot', params);
  }

  public async getSessionCheckpoint(
    params: RuntimeSupervisorGetSessionCheckpointParams
  ): Promise<RuntimeSupervisorSessionCheckpointResult> {
    return this.request('getSessionCheckpoint', params);
  }

  public async subscribeSession(
    params: RuntimeSupervisorSubscribeSessionParams
  ): Promise<RuntimeSupervisorSubscribeSessionResult> {
    if (params.hostOutputCredit !== undefined) {
      await this.ensureConnected({ allowRestart: false });
      const socket = this.socket!;
      if (params.hostOutputCredit !== 'journal-pages-v1' || params.terminalStreamMode !== 'paged-until-exit' ||
          !this.supportsTerminalHostOutputCredit() || !this.options.onSessionTerminalBatch) {
        throw new Error('Host output consumption credit is unavailable.');
      }
      return this.requestOnConnectedSocket('subscribeSession', params, socket, undefined, (value) => {
        const result = value as RuntimeSupervisorSubscribeSessionResult;
        if (!result.subscriptionId || result.sessionId !== params.sessionId || result.authorityId !== params.authorityId) {
          throw new Error('Host output consumption credit was not negotiated.');
        }
        // Bind before parsing the next event in the same socket data chunk.
        this.hostOutputSubscriptions.set(params.sessionId, { socket, sessionId: params.sessionId,
          authorityId: params.authorityId, subscriptionId: result.subscriptionId,
          revision: params.afterRevision, batchId: 0, consuming: false });
      });
    }
    if (params.terminalStreamMode) {
      await this.ensureConnected({ allowRestart: false });
      return this.requestOnConnectedSocket('subscribeSession', params);
    }
    return this.request('subscribeSession', params);
  }

  public async ackSessionRevision(
    params: RuntimeSupervisorAckSessionRevisionParams
  ): Promise<RuntimeSupervisorAckSessionRevisionResult> {
    return this.request('ackSessionRevision', params);
  }

  public async writeInput(params: RuntimeSupervisorWriteInputParams): Promise<void> {
    await this.request('writeInput', params);
  }

  public async resizeSession(params: RuntimeSupervisorResizeSessionParams): Promise<void> {
    await this.request('resizeSession', params);
  }

  public async updateSessionScrollback(params: RuntimeSupervisorUpdateSessionScrollbackParams): Promise<void> {
    await this.request('updateSessionScrollback', params);
  }

  public async stopSession(params: RuntimeSupervisorStopSessionParams): Promise<void> {
    await this.request('stopSession', params);
  }

  public async deleteSession(params: RuntimeSupervisorDeleteSessionParams): Promise<void> {
    if (params.preserveTerminalReads) {
      await this.ensureConnected({ allowRestart: false });
      await this.requestOnConnectedSocket('deleteSession', params);
      return;
    }
    await this.request('deleteSession', params);
  }

  public deleteSessionStrict(
    params: RuntimeSupervisorDeleteSessionParams,
    options: StrictRuntimeDeleteOptions
  ): StrictRuntimeDeleteObservation {
    if (!params.sessionId || !Number.isFinite(options.deadline)
      || typeof options.scheduler?.now !== 'function' || typeof options.scheduler.scheduleDeadline !== 'function'
      || options.deadline - options.scheduler.now() > 0x7fffffff) {
      throw new Error('Strict deletion requires a session and an explicit finite deadline and scheduler.');
    }
    const existing = this.strictDeletes.get(params.sessionId);
    if (existing) {
      if (existing.preserveTerminalReads !== (params.preserveTerminalReads === true)) {
        throw new Error('The original strict deletion has different terminal reader semantics.');
      }
      return existing.observation;
    }
    const { deadline, scheduler, isCurrent } = options;
    const request = Object.freeze({ ...params });
    let submitted = false;
    let attemptSettled = false;
    let first: StrictRuntimeDeleteResult | undefined;
    let current: StrictRuntimeDeleteResult | undefined;
    let resolve!: (result: StrictRuntimeDeleteResult) => void;
    let cancelDeadline: (() => void) | undefined;
    const observation: StrictRuntimeDeleteObservation = Object.freeze({
      first: new Promise<StrictRuntimeDeleteResult>(done => { resolve = done; }),
      get submitted() { return submitted; }, get attemptSettled() { return attemptSettled; }, current: () => current
    });
    this.strictDeletes.set(request.sessionId, { preserveTerminalReads: request.preserveTerminalReads === true, observation });
    const recordFirst = (result: StrictRuntimeDeleteResult): void => {
      if (first) return;
      first = Object.freeze({ ...result });
      current = first;
      cancelDeadline?.();
      resolve(first);
    };
    const observeDeadline = (): void => {
      if (scheduler.now() >= deadline) recordFirst({ kind: 'unconfirmed', reason: 'The strict deletion deadline was reached.' });
    };
    const finish = (result: StrictRuntimeDeleteResult): void => {
      attemptSettled = true;
      observeDeadline();
      recordFirst(result);
      current = Object.freeze({ ...result });
      if (!submitted || result.kind !== 'unconfirmed') this.strictDeletes.delete(request.sessionId);
    };
    const canSubmit = (socket?: net.Socket): boolean => {
      observeDeadline();
      return scheduler.now() < deadline && !this.disposed && (!isCurrent || isCurrent())
        && (!socket || (this.socket === socket && !socket.destroyed && this.helloResult !== undefined));
    };
    cancelDeadline = scheduler.scheduleDeadline(deadline, observeDeadline);
    void (async () => {
      let socket: net.Socket | undefined;
      let responseError: Error | undefined;
      try {
        if (!canSubmit()) {
          finish({ kind: 'unconfirmed', reason: 'The original deletion binding or deadline is no longer current.' });
          return;
        }
        socket = this.socket;
        if (!socket || socket.destroyed || !this.helloResult) {
          socket = await this.connectForStrictDelete(deadline, scheduler);
        }
        if (!canSubmit(socket)) {
          finish({ kind: 'unconfirmed', reason: 'The original deletion connection, binding or deadline changed before submission.' });
          return;
        }
        submitted = true;
        // The strict observation already has a deadline and must retain late evidence.
        await this.requestOnConnectedSocket('deleteSession', request, socket, error => { responseError = error; },
          undefined, 'strict-delete');
        finish(this.socket === socket && !socket.destroyed && !this.disposed
          ? { kind: 'legacy-acknowledged' }
          : { kind: 'unconfirmed', reason: 'The original deletion connection changed before its result was observed.' });
      } catch (error) {
        const normalized = error instanceof Error ? error : new Error(String(error));
        const originalResponse = responseError === error && socket === this.socket && !socket?.destroyed && !this.disposed;
        const absent = originalResponse && (normalized as Error & { code?: string }).code === RUNTIME_SUPERVISOR_ERROR_CODES.sessionNotFound;
        finish({ kind: absent ? 'legacy-absent' : originalResponse ? 'failed' : 'unconfirmed',
          reason: normalized.message, error: normalized });
      }
    })();
    return observation;
  }

  private connectForStrictDelete(deadline: number, scheduler: ExecutionScheduler): Promise<net.Socket> {
    if (this.strictDeleteConnection) return this.strictDeleteConnection;
    if (this.connectPromise) return Promise.reject(new Error('An unrelated runtime connection attempt is already in flight.'));
    const operation = (async () => {
      let socket = this.socket;
      if (!socket || socket.destroyed) socket = await this.connectStrictDeleteSocket(deadline, scheduler);
      if (scheduler.now() >= deadline || this.disposed || this.socket !== socket || socket.destroyed) {
        throw new Error('The original strict connection deadline or identity is no longer current.');
      }
      if (!this.helloResult) await this.performHelloHandshake();
      if (scheduler.now() >= deadline || this.disposed || this.socket !== socket || socket.destroyed) {
        throw new Error('The original strict handshake deadline or identity is no longer current.');
      }
      return socket;
    })();
    this.strictDeleteConnection = operation;
    const clear = (): void => { if (this.strictDeleteConnection === operation) this.strictDeleteConnection = undefined; };
    void operation.then(clear, clear);
    return operation;
  }

  private async connectStrictDeleteSocket(deadline: number, scheduler: ExecutionScheduler): Promise<net.Socket> {
    const original = this.socket;
    if (this.expectedRuntimeOwner) {
      await ensureRuntimeRootSocketDirectory(this.options.backend.paths, this.options.backend.kind, false);
      if (scheduler.now() >= deadline || this.disposed || this.socket !== original) {
        throw new Error('The original strict connection expired or was replaced.');
      }
    }
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(this.options.backend.paths.socketPath);
      let finished = false;
      let cancelDeadline: (() => void) | undefined;
      const finish = (error?: Error): void => {
        if (finished) return;
        finished = true;
        cancelDeadline?.();
        socket.removeListener('connect', connected);
        socket.removeListener('error', failed);
        if (error) { socket.destroy(); reject(error); }
        else { this.attachSocket(socket); resolve(socket); }
      };
      const failed = (error: Error): void => finish(error);
      const connected = (): void => finish(scheduler.now() >= deadline || this.disposed || this.socket !== original
        ? new Error('The original strict connection expired or was replaced.') : undefined);
      socket.once('connect', connected);
      socket.once('error', failed);
      cancelDeadline = scheduler.scheduleDeadline(deadline, () => finish(new Error('The strict connection deadline was reached.')));
    });
  }

  public dispose(): void {
    this.disposed = true;
    this.cancelSocketConnection?.();
    if (this.socket && !this.socket.destroyed) {
      this.socket.destroy();
    }
    this.socket = undefined;
    this.helloResult = undefined;
    this.terminalReadConnections.clear();
    this.hostOutputSubscriptions.clear();
    this.rejectAllPending(createRuntimeSupervisorProtocolError({
      id: 'clientDisconnected'
    }, RUNTIME_SUPERVISOR_ERROR_CODES.clientDisconnected));
  }

  private async request<T>(
    method:
      | 'openTerminalRead'
      | 'readTerminalPage'
      | 'closeTerminalRead'
      | 'createSession'
      | 'attachSession'
      | 'getSessionSnapshot'
      | 'getSessionCheckpoint'
      | 'subscribeSession'
      | 'ackSessionRevision'
      | 'writeInput'
      | 'resizeSession'
      | 'updateSessionScrollback'
      | 'stopSession'
      | 'deleteSession',
    params:
      | RuntimeSupervisorOpenTerminalReadParams
      | RuntimeSupervisorReadTerminalPageParams
      | RuntimeSupervisorCloseTerminalReadParams
      | RuntimeSupervisorCreateSessionParams
      | RuntimeSupervisorAttachSessionParams
      | RuntimeSupervisorGetSessionSnapshotParams
      | RuntimeSupervisorGetSessionCheckpointParams
      | RuntimeSupervisorSubscribeSessionParams
      | RuntimeSupervisorAckSessionRevisionParams
      | RuntimeSupervisorWriteInputParams
      | RuntimeSupervisorResizeSessionParams
      | RuntimeSupervisorUpdateSessionScrollbackParams
      | RuntimeSupervisorStopSessionParams
      | RuntimeSupervisorDeleteSessionParams
  ): Promise<T>;
  private async request<T>(method: string, params?: unknown): Promise<T> {
    await this.ensureConnected();
    return this.requestOnConnectedSocket(method, params);
  }

  private requestOnConnectedSocket<T>(method: string, params?: unknown, expectedSocket?: net.Socket,
    responseError?: (error: Error) => void, responseResult?: (value: unknown) => void,
    deadline: number | 'strict-delete' = performance.now() + REQUEST_TIMEOUT_MS,
    onTimeout?: (lateResponse: Promise<T>) => void): Promise<T> {
    const socket = this.socket;
    if (!socket || socket.destroyed || this.disposed || (expectedSocket && socket !== expectedSocket)) {
      throw createRuntimeSupervisorProtocolError({
        id: 'clientNotConnected'
      }, RUNTIME_SUPERVISOR_ERROR_CODES.clientNotConnected);
    }

    const id = randomUUID();
    const promise = new Promise<T>((resolve, reject) => {
      const pending: PendingSupervisorRequest<unknown> = {
        socket,
        method,
        ...(deadline === 'strict-delete' ? {} : { deadline }),
        resolve: (value: unknown) => {
          try { responseResult?.(value); resolve(value as T); }
          catch (error) { reject(error); }
        },
        reject,
        expire: () => {
          const error = this.createRequestTimeoutError(method);
          if (onTimeout) {
            // End only the caller's wait. Keep the original ID/socket until the resource can be released.
            clearTimeout(pending.timeout);
            pending.timeout = undefined;
            pending.deadline = undefined;
            const lateResponse = new Promise<T>((resolveLate, rejectLate) => {
              pending.resolve = value => resolveLate(value as T);
              pending.reject = rejectLate;
            });
            onTimeout(lateResponse);
            reject(error);
          } else {
            this.takePendingRequest(id)?.reject(error);
          }
        },
        ...(responseError ? { responseError } : {})
      };
      this.pendingRequests.set(id, pending);
      if (typeof deadline === 'number') {
        const expire = (): void => {
          if (this.pendingRequests.get(id) !== pending) return;
          const remaining = deadline - performance.now();
          if (remaining > 0) {
            pending.timeout = setTimeout(expire, Math.ceil(remaining));
            return;
          }
          pending.expire();
        };
        pending.timeout = setTimeout(expire, Math.max(0, Math.ceil(deadline - performance.now())));
      }
    });

    const message =
      params === undefined
        ? {
            type: 'request' as const,
            id,
            method
          }
        : {
            type: 'request' as const,
            id,
            method,
            params
          };

    try {
      if (typeof deadline === 'number' && performance.now() >= deadline) {
        throw this.createRequestTimeoutError(method);
      }
      socket.write(`${JSON.stringify(message)}\n`);
    } catch (error) {
      const pending = this.takePendingRequest(id);
      pending?.reject(error instanceof Error ? error : new Error(String(error)));
    }
    return promise;
  }

  private async connectWithRestart(allowRestart: boolean): Promise<void> {
    try {
      if (!this.socket || this.socket.destroyed) {
        await this.connectSocket();
      }
      await this.performHelloHandshake();
      return;
    } catch (error) {
      if (!allowRestart || !isSupervisorSocketStartupError(error)) {
        throw error;
      }
    }

    await this.startSupervisorProcess();
    await this.waitForSupervisorReady();
  }

  private async connectSocket(deadline = performance.now() + HELLO_TIMEOUT_MS): Promise<void> {
    if (this.expectedRuntimeOwner) {
      await ensureRuntimeRootSocketDirectory(this.options.backend.paths, this.options.backend.kind, false);
    }
    if (this.disposed) {
      throw createRuntimeSupervisorProtocolError({
        id: 'clientDisposed'
      }, RUNTIME_SUPERVISOR_ERROR_CODES.clientDisposed);
    }

    await new Promise<void>((resolve, reject) => {
      const socket = net.createConnection(this.options.backend.paths.socketPath);
      const timeoutError = (): Error => createRuntimeSupervisorProtocolError({
        id: 'clientReadyTimeout'
      }, RUNTIME_SUPERVISOR_ERROR_CODES.clientReadyTimeout);
      const timeout = setTimeout(() => handleError(timeoutError()), Math.max(0, Math.ceil(deadline - performance.now())));
      const cleanup = (): void => {
        clearTimeout(timeout);
        if (this.cancelSocketConnection === cancel) this.cancelSocketConnection = undefined;
        socket.removeListener('connect', handleConnect);
        socket.removeListener('error', handleError);
      };

      const handleConnect = (): void => {
        if (performance.now() >= deadline || this.disposed) {
          handleError(this.disposed ? createRuntimeSupervisorProtocolError({ id: 'clientDisposed' },
            RUNTIME_SUPERVISOR_ERROR_CODES.clientDisposed) : timeoutError());
          return;
        }
        cleanup();
        this.attachSocket(socket);
        resolve();
      };

      const handleError = (error: Error & { code?: string }): void => {
        cleanup();
        socket.destroy();
        reject(error);
      };

      const cancel = (): void => handleError(createRuntimeSupervisorProtocolError({ id: 'clientDisposed' },
        RUNTIME_SUPERVISOR_ERROR_CODES.clientDisposed));
      this.cancelSocketConnection = cancel;

      socket.once('connect', handleConnect);
      socket.once('error', handleError);
    });
  }

  private attachSocket(socket: net.Socket): void {
    if (this.socket && this.socket !== socket) {
      this.rejectSocketPending(this.socket, new Error('Runtime supervisor connection was replaced.'));
    }
    this.socket = socket;
    this.hostOutputSubscriptions.clear();
    this.buffer = '';
    this.helloResult = undefined;
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      if (this.socket !== socket) return;
      this.buffer += chunk;
      this.drainBufferedMessages(socket);
    });
    socket.on('close', () => {
      if (this.socket !== socket) return;
      const error = this.disposed
        ? undefined
        : createRuntimeSupervisorProtocolError({
            id: 'clientConnectionClosed'
          }, RUNTIME_SUPERVISOR_ERROR_CODES.clientConnectionClosed);
      this.socket = undefined;
      this.hostOutputSubscriptions.clear();
      this.helloResult = undefined;
      this.buffer = '';
      this.rejectSocketPending(socket, error ?? createRuntimeSupervisorProtocolError({
        id: 'clientConnectionClosed'
      }, RUNTIME_SUPERVISOR_ERROR_CODES.clientConnectionClosed));
      if (!this.disposed) {
        this.options.onDisconnected?.(error);
      }
    });
    socket.on('error', (error) => {
      if (this.socket === socket && !this.disposed) {
        this.options.onDisconnected?.(error);
      }
    });
  }

  private drainBufferedMessages(socket: net.Socket): void {
    while (this.socket === socket) {
      const newlineIndex = this.buffer.indexOf('\n');
      if (newlineIndex < 0) {
        return;
      }

      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (!line) {
        continue;
      }

      let message: RuntimeSupervisorMessage;
      try {
        message = JSON.parse(line) as RuntimeSupervisorMessage;
      } catch {
        continue;
      }

      this.handleMessage(message, socket);
    }
  }

  private handleMessage(message: RuntimeSupervisorMessage, socket: net.Socket): void {
    if (message.type === 'response') {
      const pending = this.pendingRequests.get(message.id);
      if (!pending || pending.socket !== socket) {
        return;
      }
      if (pending.deadline !== undefined && performance.now() >= pending.deadline) {
        pending.expire();
        if (this.pendingRequests.get(message.id) !== pending) return;
      }
      this.takePendingRequest(message.id);
      if (message.ok) {
        pending.resolve(message.result);
      } else {
        const error = createRuntimeSupervisorError(message.error);
        pending.responseError?.(error);
        pending.reject(error);
      }
      return;
    }

    if (message.type !== 'event') {
      return;
    }

    this.handleEvent(message, socket);
  }

  private handleEvent(message: RuntimeSupervisorEvent, socket: net.Socket): void {
    if (message.event === 'sessionTerminalBatch') {
      void this.consumeTerminalBatch(message.payload, socket);
      return;
    }
    if (message.event === 'sessionOutput') {
      this.options.onSessionOutput?.(message.payload);
      return;
    }

    if (message.event === 'sessionTerminalEvent') {
      this.options.onSessionTerminalEvent?.(message.payload);
      return;
    }

    if (message.event === 'sessionState') {
      this.options.onSessionState?.(message.payload);
    }
  }

  private async consumeTerminalBatch(
    payload: Extract<RuntimeSupervisorEvent, { event: 'sessionTerminalBatch' }>['payload'],
    socket: net.Socket
  ): Promise<void> {
    const subscription = this.hostOutputSubscriptions.get(payload.sessionId);
    const isCurrent = (): boolean => Boolean(subscription && !this.disposed && !socket.destroyed &&
      this.socket === socket && this.hostOutputSubscriptions.get(payload.sessionId) === subscription);
    if (!subscription || !isCurrent() || subscription.subscriptionId !== payload.subscriptionId ||
        subscription.authorityId !== payload.authorityId) return;
    if (subscription.consuming) {
      // A valid sender never has two unacknowledged pages. Do not build a fallback queue.
      console.error('Runtime Host output credit was exceeded.');
      socket.destroy();
      return;
    }
    subscription.consuming = true;
    let outcome: 'consumed' | 'cancelled' = 'cancelled';
    try {
      if (payload.batchId !== subscription.batchId + 1 || payload.afterRevision !== subscription.revision ||
          !Array.isArray(payload.events) || !Number.isSafeInteger(payload.revision) ||
          payload.events.some((event, index) => event.revision !== subscription.revision + index + 1) ||
          payload.revision !== subscription.revision + payload.events.length) {
        throw new Error('Invalid Host output batch identity or revision.');
      }
      outcome = await this.options.onSessionTerminalBatch!(payload, isCurrent);
      if (outcome !== 'consumed' && outcome !== 'cancelled') outcome = 'cancelled';
      if (!isCurrent()) return;
      if (outcome === 'consumed' && payload.error) outcome = 'cancelled';
      await this.requestOnConnectedSocket('ackTerminalBatch', {
        sessionId: payload.sessionId, authorityId: payload.authorityId, subscriptionId: payload.subscriptionId,
        batchId: payload.batchId, outcome
      }, socket, undefined, () => {
        if (!isCurrent()) return;
        subscription.revision = payload.revision;
        subscription.batchId = payload.batchId;
        subscription.consuming = false;
        if (outcome === 'cancelled' || payload.snapshot?.live === false) {
          this.hostOutputSubscriptions.delete(payload.sessionId);
        }
      });
    } catch (error) {
      console.error('Runtime Host output batch consumption failed:', error);
      if (isCurrent()) {
        this.hostOutputSubscriptions.delete(payload.sessionId);
        if ((error as { code?: string })?.code === RUNTIME_SUPERVISOR_ERROR_CODES.clientRequestTimeout) {
          // An acknowledgement may already have taken effect. Do not submit it again as cancellation.
          socket.destroy();
          return;
        }
        try {
          await this.requestOnConnectedSocket('ackTerminalBatch', {
            sessionId: payload.sessionId, authorityId: payload.authorityId, subscriptionId: payload.subscriptionId,
            batchId: payload.batchId, outcome: 'cancelled'
          }, socket);
        } catch { /* A lost connection retains no successful consumption claim. */ }
      }
    } finally {
      this.options.onTerminalBatchSettled?.();
    }
  }

  private rejectAllPending(error: Error): void {
    for (const id of this.pendingRequests.keys()) {
      this.takePendingRequest(id)?.reject(error);
    }
  }

  private rejectSocketPending(socket: net.Socket, error: Error): void {
    for (const [id, pending] of this.pendingRequests) {
      if (pending.socket === socket) {
        this.takePendingRequest(id)?.reject(error);
      }
    }
  }

  private takePendingRequest(id: string): PendingSupervisorRequest<unknown> | undefined {
    const pending = this.pendingRequests.get(id);
    if (pending) {
      this.pendingRequests.delete(id);
      clearTimeout(pending.timeout);
    }
    return pending;
  }

  private createRequestTimeoutError(method: string): Error {
    return createRuntimeSupervisorProtocolError({ id: 'clientRequestTimeout', params: { method } },
      RUNTIME_SUPERVISOR_ERROR_CODES.clientRequestTimeout);
  }

  private async startSupervisorProcess(): Promise<void> {
    await this.options.backend.startSupervisor({
      supervisorScriptPath: this.options.supervisorScriptPath,
      supervisorLauncherScriptPath: this.options.supervisorLauncherScriptPath,
      ...(this.options.executionProfile !== undefined ? { executionProfile: this.options.executionProfile } : {})
    });
  }

  private async waitForSupervisorReady(): Promise<void> {
    const deadline = performance.now() + HELLO_TIMEOUT_MS;
    let lastError: Error | undefined;

    while (performance.now() < deadline) {
      try {
        if (!this.socket || this.socket.destroyed) {
          await this.connectSocket(deadline);
        }
        await this.performHelloHandshake(deadline);
        return;
      } catch (error) {
        if (error instanceof ExecutionCandidateHandshakeError) throw error;
        lastError = error instanceof Error ? error : new Error(String(error));
      }

      const remaining = deadline - performance.now();
      if (remaining > 0) await delay(Math.min(80, remaining));
    }

    throw lastError ?? createRuntimeSupervisorProtocolError({
      id: 'clientReadyTimeout'
    }, RUNTIME_SUPERVISOR_ERROR_CODES.clientReadyTimeout);
  }

  private async performHelloHandshake(deadline = performance.now() + HELLO_TIMEOUT_MS): Promise<void> {
    const socket = this.socket;
    let result: RuntimeSupervisorHelloResult;
    try {
      result = await this.requestOnConnectedSocket<RuntimeSupervisorHelloResult>('hello', undefined, socket,
        undefined, undefined, deadline);
    } catch (error) {
      if ((error as { code?: string })?.code === RUNTIME_SUPERVISOR_ERROR_CODES.clientRequestTimeout &&
          socket && this.socket === socket) {
        this.helloResult = undefined;
        socket.destroy();
      }
      throw error;
    }
    if (!socket || socket !== this.socket || socket.destroyed || this.disposed) {
      throw new Error('Runtime supervisor connection changed during handshake.');
    }
    if (this.expectedRuntimeOwner && !this.helloMatchesRuntimeOwner(result)) {
      this.helloResult = undefined;
      socket.destroy();
      throw new ExecutionCandidateHandshakeError('Runtime supervisor owner descriptor, backend, or compatibility does not match.');
    }
    if (this.options.executionProfile !== undefined && !helloSupportsExecutionCandidateProfile(result, this.options.executionProfile)) {
      this.helloResult = undefined;
      socket.destroy();
      throw new ExecutionCandidateHandshakeError('Runtime supervisor execution candidate profile or reader capability is unavailable.');
    }
    this.helloResult = result;
  }

  private helloMatchesRuntimeOwner(result: RuntimeSupervisorHelloResult): boolean {
    try {
      return result.serverVersion === 1
        && runtimeOwnerDescriptorsEqual(this.expectedRuntimeOwner, result.runtimeOwner)
        && result.runtimeBackend === this.options.backend.kind
        && result.runtimeGuarantee === this.options.backend.guarantee
        && result.executionProfile === this.options.executionProfile
        && result.ownerCompatibilityFingerprint === createRuntimeOwnerCompatibilityFingerprint(
          this.expectedRuntimeOwner!.generation, this.options.executionProfile!
        )
        && result.capabilities?.terminalCurrentStateV1 === true
        && result.capabilities.terminalHostOutputCreditV1 === true;
    } catch {
      return false;
    }
  }

  private clearConnectPromise(connectPromise: Promise<void>): void {
    if (this.connectPromise === connectPromise) {
      this.connectPromise = undefined;
    }
  }
}

function helloSupportsExecutionCandidateProfile(
  hello: RuntimeSupervisorHelloResult | undefined,
  profile: ExecutionCandidateProfile
): boolean {
  const capabilities = hello?.capabilities;
  return capabilities?.terminalPagedReadV1 === true
    && capabilities.terminalPagedCompletionV1 === true
    && capabilities.terminalReadSettlementV1 === true
    && Array.isArray(capabilities.executionCandidateProfiles)
    && capabilities.executionCandidateProfiles.includes(profile);
}

function isSupervisorSocketStartupError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const code = (error as Error & { code?: string }).code;
  return code === 'ENOENT' || code === 'ECONNREFUSED';
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
