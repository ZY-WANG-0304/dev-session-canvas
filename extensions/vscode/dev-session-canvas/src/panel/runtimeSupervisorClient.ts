import { randomUUID } from 'crypto';
import * as net from 'net';

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

interface PendingSupervisorRequest<T> {
  socket: net.Socket;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
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

const CLOSED_TERMINAL_READ_CONNECTION_LIMIT = 128;

export interface RuntimeSupervisorClientOptions extends RuntimeSupervisorClientEventHandlers {
  backend: RuntimeHostBackend;
  supervisorScriptPath: string;
  supervisorLauncherScriptPath: string;
  onDisconnected?: (error?: Error) => void;
}

export class RuntimeSupervisorClient {
  private socket: net.Socket | undefined;
  private connectPromise: Promise<void> | undefined;
  private disposed = false;
  private buffer = '';
  private helloResult: RuntimeSupervisorHelloResult | undefined;
  private readonly pendingRequests = new Map<string, PendingSupervisorRequest<unknown>>();
  private readonly terminalReadConnections = new Map<string, TerminalReadConnection>();
  private readonly strictDeletes = new Map<string, {
    preserveTerminalReads: boolean;
    observation: StrictRuntimeDeleteObservation;
  }>();
  private strictDeleteConnection?: Promise<net.Socket>;

  public constructor(private readonly options: RuntimeSupervisorClientOptions) {}

  public async ensureConnected(options: { allowRestart?: boolean } = {}): Promise<void> {
    if (this.disposed) {
      throw createRuntimeSupervisorProtocolError({
        id: 'clientDisposed'
      }, RUNTIME_SUPERVISOR_ERROR_CODES.clientDisposed);
    }

    if (this.connectPromise) {
      return this.connectPromise;
    }

    if (this.socket && !this.socket.destroyed && this.helloResult) {
      return;
    }

    const connectPromise = this.connectWithRestart(options.allowRestart !== false);
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

  public supportsExecutionCandidateProfile(profile: ExecutionCandidateProfile): boolean {
    return this.supportsTerminalReadSettlement()
      && this.helloResult?.capabilities?.executionCandidateProfiles?.includes(profile) === true;
  }

  public async openTerminalRead(params: RuntimeSupervisorOpenTerminalReadParams): Promise<TerminalStreamReadDescriptor> {
    await this.ensureConnected({ allowRestart: false });
    const socket = this.socket;
    if (params.settlementMode !== undefined &&
        (params.settlementMode !== 'final-application-v1' || !this.supportsTerminalReadSettlement())) {
      throw new Error('Terminal reader settlement capability is unavailable.');
    }
    const result = await this.requestOnConnectedSocket<TerminalStreamReadDescriptor>('openTerminalRead', params, socket);
    if (params.settlementMode === undefined) return result;
    if (!socket || socket !== this.socket || socket.destroyed || this.disposed) {
      throw new Error('Terminal reader connection changed while opening.');
    }
    const read = normalizeTerminalStreamRead(result);
    if (!read || read.sessionId !== params.sessionId || read.authorityId !== params.authorityId) {
      throw new Error('Invalid terminal reader settlement descriptor.');
    }
    if (read.settlementMode !== params.settlementMode) {
      void this.requestOnConnectedSocket('closeTerminalRead', {
        sessionId: read.sessionId, authorityId: read.authorityId, readId: read.readId
      }, socket).catch(() => undefined);
      throw new Error('Terminal reader settlement was not negotiated.');
    }
    for (const binding of this.terminalReadConnections.values()) {
      if (binding.socket === socket && binding.sessionId === read.sessionId && binding.consumerId === params.consumerId) {
        binding.closed = true;
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
    return this.pendingRequests.size > 0;
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
    let first: StrictRuntimeDeleteResult | undefined;
    let current: StrictRuntimeDeleteResult | undefined;
    let resolve!: (result: StrictRuntimeDeleteResult) => void;
    let cancelDeadline: (() => void) | undefined;
    const observation: StrictRuntimeDeleteObservation = Object.freeze({
      first: new Promise<StrictRuntimeDeleteResult>(done => { resolve = done; }),
      get submitted() { return submitted; }, current: () => current
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
        await this.requestOnConnectedSocket('deleteSession', request, socket, error => { responseError = error; });
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

  private connectStrictDeleteSocket(deadline: number, scheduler: ExecutionScheduler): Promise<net.Socket> {
    const original = this.socket;
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
    if (this.socket && !this.socket.destroyed) {
      this.socket.destroy();
    }
    this.socket = undefined;
    this.helloResult = undefined;
    this.terminalReadConnections.clear();
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
    responseError?: (error: Error) => void): Promise<T> {
    const socket = this.socket;
    if (!socket || socket.destroyed || this.disposed || (expectedSocket && socket !== expectedSocket)) {
      throw createRuntimeSupervisorProtocolError({
        id: 'clientNotConnected'
      }, RUNTIME_SUPERVISOR_ERROR_CODES.clientNotConnected);
    }

    const id = randomUUID();
    const promise = new Promise<T>((resolve, reject) => {
      this.pendingRequests.set(id, {
        socket,
        resolve: resolve as (value: unknown) => void,
        reject,
        ...(responseError ? { responseError } : {})
      });
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
      socket.write(`${JSON.stringify(message)}\n`);
    } catch (error) {
      const pending = this.pendingRequests.get(id);
      this.pendingRequests.delete(id);
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

  private async connectSocket(): Promise<void> {
    if (this.disposed) {
      throw createRuntimeSupervisorProtocolError({
        id: 'clientDisposed'
      }, RUNTIME_SUPERVISOR_ERROR_CODES.clientDisposed);
    }

    await new Promise<void>((resolve, reject) => {
      const socket = net.createConnection(this.options.backend.paths.socketPath);
      const cleanup = (): void => {
        socket.removeListener('connect', handleConnect);
        socket.removeListener('error', handleError);
      };

      const handleConnect = (): void => {
        cleanup();
        this.attachSocket(socket);
        resolve();
      };

      const handleError = (error: Error & { code?: string }): void => {
        cleanup();
        socket.destroy();
        reject(error);
      };

      socket.once('connect', handleConnect);
      socket.once('error', handleError);
    });
  }

  private attachSocket(socket: net.Socket): void {
    if (this.socket && this.socket !== socket) {
      this.rejectSocketPending(this.socket, new Error('Runtime supervisor connection was replaced.'));
    }
    this.socket = socket;
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
      this.pendingRequests.delete(message.id);
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

    this.handleEvent(message);
  }

  private handleEvent(message: RuntimeSupervisorEvent): void {
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

  private rejectAllPending(error: Error): void {
    for (const pending of this.pendingRequests.values()) {
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }

  private rejectSocketPending(socket: net.Socket, error: Error): void {
    for (const [id, pending] of this.pendingRequests) {
      if (pending.socket === socket) {
        this.pendingRequests.delete(id);
        pending.reject(error);
      }
    }
  }

  private async startSupervisorProcess(): Promise<void> {
    await this.options.backend.startSupervisor({
      supervisorScriptPath: this.options.supervisorScriptPath,
      supervisorLauncherScriptPath: this.options.supervisorLauncherScriptPath
    });
  }

  private async waitForSupervisorReady(): Promise<void> {
    const deadline = Date.now() + 5000;
    let lastError: Error | undefined;

    while (Date.now() < deadline) {
      try {
        if (!this.socket || this.socket.destroyed) {
          await this.connectSocket();
        }
        await this.performHelloHandshake();
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }

      await delay(80);
    }

    throw lastError ?? createRuntimeSupervisorProtocolError({
      id: 'clientReadyTimeout'
    }, RUNTIME_SUPERVISOR_ERROR_CODES.clientReadyTimeout);
  }

  private async performHelloHandshake(): Promise<void> {
    const socket = this.socket;
    const result = await this.requestOnConnectedSocket<RuntimeSupervisorHelloResult>('hello', undefined, socket);
    if (!socket || socket !== this.socket || socket.destroyed || this.disposed) {
      throw new Error('Runtime supervisor connection changed during handshake.');
    }
    this.helloResult = result;
  }

  private clearConnectPromise(connectPromise: Promise<void>): void {
    if (this.connectPromise === connectPromise) {
      this.connectPromise = undefined;
    }
  }
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
