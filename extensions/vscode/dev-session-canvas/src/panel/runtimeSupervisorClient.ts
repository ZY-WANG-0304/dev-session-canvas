import { randomUUID } from 'crypto';
import * as net from 'net';

import {
  RUNTIME_SUPERVISOR_ERROR_CODES,
  createRuntimeSupervisorError,
  createRuntimeSupervisorProtocolError,
  getRuntimeSupervisorErrorDetails
} from '../common/runtimeSupervisorProtocol';
import type {
  RuntimeSupervisorAttachSessionParams,
  RuntimeSupervisorAckSessionRevisionParams,
  RuntimeSupervisorAckSessionRevisionResult,
  RuntimeSupervisorCancelTerminalProjectionParams,
  RuntimeSupervisorCancelTerminalProjectionResult,
  RuntimeSupervisorClientEventHandlers,
  RuntimeSupervisorCreateSessionParams,
  RuntimeSupervisorDeleteSessionParams,
  RuntimeSupervisorEvent,
  RuntimeSupervisorGetTerminalProjectionCheckpointParams,
  RuntimeSupervisorGetSessionSnapshotParams,
  RuntimeSupervisorHelloResult,
  RuntimeSupervisorMessage,
  RuntimeSupervisorOpenTerminalProjectionParams,
  RuntimeSupervisorOpenTerminalProjectionResult,
  RuntimeSupervisorReadTerminalProjectionParams,
  RuntimeSupervisorReadTerminalProjectionResult,
  RuntimeSupervisorRecoveryState,
  RuntimeSupervisorResizeSessionParams,
  RuntimeSupervisorSessionSnapshot,
  RuntimeSupervisorStopSessionParams,
  RuntimeSupervisorSubscribeSessionParams,
  RuntimeSupervisorSubscribeSessionResult,
  RuntimeSupervisorTerminalProjectionCheckpoint,
  RuntimeSupervisorUpdateSessionScrollbackParams,
  RuntimeSupervisorWriteInputParams
} from '../common/runtimeSupervisorProtocol';
import type { RuntimeHostBackend } from './runtimeHostBackend';

interface PendingSupervisorRequest<T> {
  method: string;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

export interface RuntimeSupervisorInputDispatch {
  response: Promise<void>;
}

export interface RuntimeSupervisorExistingSessionRequestPolicy {
  allowRestart: false;
  expectedSupervisorInstanceId: string;
}

/** One-shot token pinning an existing-session RPC to one connected socket generation. */
export interface RuntimeSupervisorExistingSessionRequestAdmission
  extends RuntimeSupervisorExistingSessionRequestPolicy {
  readonly socketGeneration: number;
}

export interface RuntimeSupervisorClientOptions extends RuntimeSupervisorClientEventHandlers {
  backend: RuntimeHostBackend;
  supervisorScriptPath: string;
  supervisorLauncherScriptPath: string;
  onDisconnected?: (error?: Error, supervisorInstanceId?: string) => void;
  /** Overrides the five-second startup deadline for deterministic protocol tests. */
  startupTimeoutMs?: number;
  /** Bulk sockets defer session event callbacks until response continuations run. */
  deferSessionEventCallbacks?: boolean;
}

export interface RuntimeSupervisorProjectionClientOptions
  extends Pick<RuntimeSupervisorClientEventHandlers, 'onSessionOutput' | 'onSessionTerminalEvent' | 'onSessionState'> {
  /** Deliberately scoped to the bulk transport; never treat it as control Supervisor death. */
  onBulkDisconnected?: (error?: Error, supervisorInstanceId?: string) => void;
}

const DEFAULT_SUPERVISOR_STARTUP_TIMEOUT_MS = 5000;

export class RuntimeSupervisorClient {
  private socket: net.Socket | undefined;
  private connectPromise: Promise<void> | undefined;
  private disposed = false;
  private buffer = '';
  private helloResult: RuntimeSupervisorHelloResult | undefined;
  private socketGeneration = 0;
  private readonly pendingRequests = new Map<string, PendingSupervisorRequest<unknown>>();
  private readonly socketDisconnectErrors = new WeakMap<net.Socket, Error>();
  private readonly socketSupervisorInstanceIds = new WeakMap<net.Socket, string>();
  private readonly existingSessionRequestAdmissions = new WeakSet<
    RuntimeSupervisorExistingSessionRequestAdmission
  >();
  private readonly projectionClients = new Set<RuntimeSupervisorProjectionClient>();
  private readonly deferredSessionEventCallbacks: Array<() => void> = [];
  private deferredSessionEventTimer: ReturnType<typeof setTimeout> | undefined;
  private sessionEventResponseBarrierTimer: ReturnType<typeof setTimeout> | undefined;
  private socketCloseBarrier:
    | {
        socket: net.Socket;
        promise: Promise<void>;
        resolve: () => void;
      }
    | undefined;

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

  public supportsSupervisorInstanceIdentity(): boolean {
    return this.helloResult?.capabilities?.supervisorInstanceIdentityV1 === true;
  }

  public supportsTerminalProjectionStream(): boolean {
    return this.helloResult?.capabilities?.terminalProjectionStreamV1 === true;
  }

  public supportsTerminalProjectionFollow(): boolean {
    return this.helloResult?.capabilities?.terminalProjectionFollowV1 === true;
  }

  public getSupervisorInstanceId(): string | undefined {
    return normalizeSupervisorInstanceId(this.helloResult?.supervisorInstanceId);
  }

  public captureExistingSessionRequestAdmission(
    policy: RuntimeSupervisorExistingSessionRequestPolicy
  ): RuntimeSupervisorExistingSessionRequestAdmission {
    const socket = this.socket;
    if (!socket || socket.destroyed || !this.helloResult) {
      throw createRuntimeSupervisorProtocolError({
        id: 'clientNotConnected'
      }, RUNTIME_SUPERVISOR_ERROR_CODES.clientNotConnected);
    }

    const expectedSupervisorInstanceId = normalizeSupervisorInstanceId(
      policy.expectedSupervisorInstanceId
    );
    const connectedSupervisorInstanceId = this.getSupervisorInstanceId();
    if (
      !expectedSupervisorInstanceId ||
      connectedSupervisorInstanceId !== expectedSupervisorInstanceId
    ) {
      throw createSupervisorInstanceIdentityProtocolError(
        'existing-session request admission',
        expectedSupervisorInstanceId ?? policy.expectedSupervisorInstanceId,
        connectedSupervisorInstanceId
      );
    }

    const admission: RuntimeSupervisorExistingSessionRequestAdmission = Object.freeze({
      allowRestart: false,
      expectedSupervisorInstanceId,
      socketGeneration: this.socketGeneration
    });
    this.existingSessionRequestAdmissions.add(admission);
    return admission;
  }

  public supportsTerminalProjectionSnapshot(): boolean {
    return this.helloResult?.capabilities?.terminalProjectionSnapshotV1 === true;
  }

  public supportsTerminalProjectionCheckpoint(): boolean {
    return this.helloResult?.capabilities?.terminalProjectionCheckpointV1 === true;
  }

  public supportsTerminalSessionStream(): boolean {
    return this.helloResult?.capabilities?.terminalSessionStreamV1 === true;
  }

  public supportsTerminalAppliedRevisionAck(): boolean {
    return this.helloResult?.capabilities?.terminalAppliedRevisionAckV1 === true;
  }

  public getRecoveryState(): RuntimeSupervisorRecoveryState | undefined {
    return this.helloResult?.recovery;
  }

  public supportsAgentSubmissionIntent(): boolean {
    return this.helloResult?.capabilities?.agentSubmissionIntentV1 === true;
  }

  public supportsAgentProviderLifecycle(): boolean {
    return this.helloResult?.capabilities?.agentProviderLifecycleV1 === true;
  }

  public hasPendingRequests(): boolean {
    return this.pendingRequests.size > 0;
  }

  public getPendingRequestCount(): number {
    return this.pendingRequests.size;
  }

  public async createSession(
    params: RuntimeSupervisorCreateSessionParams
  ): Promise<RuntimeSupervisorSessionSnapshot> {
    return this.request('createSession', params);
  }

  public async attachSession(
    params: RuntimeSupervisorAttachSessionParams,
    admission?: RuntimeSupervisorExistingSessionRequestAdmission
  ): Promise<RuntimeSupervisorSessionSnapshot> {
    return this.request('attachSession', params, admission);
  }

  public async getSessionSnapshot(
    params: RuntimeSupervisorGetSessionSnapshotParams,
    admission?: RuntimeSupervisorExistingSessionRequestAdmission
  ): Promise<RuntimeSupervisorSessionSnapshot> {
    return this.request('getSessionSnapshot', params, admission);
  }

  public async getTerminalProjectionCheckpoint(
    params: RuntimeSupervisorGetTerminalProjectionCheckpointParams,
    admission?: RuntimeSupervisorExistingSessionRequestAdmission
  ): Promise<RuntimeSupervisorTerminalProjectionCheckpoint> {
    return this.request('getTerminalProjectionCheckpoint', params, admission);
  }

  public async subscribeSession(
    params: RuntimeSupervisorSubscribeSessionParams,
    admission?: RuntimeSupervisorExistingSessionRequestAdmission
  ): Promise<RuntimeSupervisorSubscribeSessionResult> {
    return this.request('subscribeSession', params, admission);
  }

  public async ackSessionRevision(
    params: RuntimeSupervisorAckSessionRevisionParams,
    admission?: RuntimeSupervisorExistingSessionRequestAdmission
  ): Promise<RuntimeSupervisorAckSessionRevisionResult> {
    return this.request('ackSessionRevision', params, admission);
  }

  public async writeInput(
    params: RuntimeSupervisorWriteInputParams,
    admission?: RuntimeSupervisorExistingSessionRequestAdmission
  ): Promise<void> {
    const dispatch = await this.dispatchInput(params, admission);
    await dispatch.response;
  }

  public async dispatchInput(
    params: RuntimeSupervisorWriteInputParams,
    admission?: RuntimeSupervisorExistingSessionRequestAdmission
  ): Promise<RuntimeSupervisorInputDispatch> {
    if (!admission) {
      await this.ensureConnected();
    } else {
      this.consumeExistingSessionRequestAdmission(admission);
    }
    return {
      response: this.requestOnConnectedSocket('writeInput', params, {
        expectedSocketGeneration: admission?.socketGeneration ?? this.socketGeneration,
        expectedSupervisorInstanceId: admission?.expectedSupervisorInstanceId
      })
    };
  }

  public async resizeSession(
    params: RuntimeSupervisorResizeSessionParams,
    admission?: RuntimeSupervisorExistingSessionRequestAdmission
  ): Promise<void> {
    await this.request('resizeSession', params, admission);
  }

  public async updateSessionScrollback(
    params: RuntimeSupervisorUpdateSessionScrollbackParams,
    admission?: RuntimeSupervisorExistingSessionRequestAdmission
  ): Promise<void> {
    await this.request('updateSessionScrollback', params, admission);
  }

  public async stopSession(
    params: RuntimeSupervisorStopSessionParams,
    admission?: RuntimeSupervisorExistingSessionRequestAdmission
  ): Promise<void> {
    await this.request('stopSession', params, admission);
  }

  public async deleteSession(
    params: RuntimeSupervisorDeleteSessionParams,
    admission?: RuntimeSupervisorExistingSessionRequestAdmission
  ): Promise<void> {
    await this.request('deleteSession', params, admission);
  }

  public async openTerminalProjection(
    params: RuntimeSupervisorOpenTerminalProjectionParams,
    admission: RuntimeSupervisorExistingSessionRequestAdmission
  ): Promise<RuntimeSupervisorOpenTerminalProjectionResult> {
    this.assertProjectionAdmission(admission);
    return this.request('openTerminalProjection', params, admission);
  }

  public async readTerminalProjection(
    params: RuntimeSupervisorReadTerminalProjectionParams,
    admission: RuntimeSupervisorExistingSessionRequestAdmission
  ): Promise<RuntimeSupervisorReadTerminalProjectionResult> {
    this.assertProjectionAdmission(admission);
    return this.request('readTerminalProjection', params, admission);
  }

  public async cancelTerminalProjection(
    params: RuntimeSupervisorCancelTerminalProjectionParams,
    admission: RuntimeSupervisorExistingSessionRequestAdmission
  ): Promise<RuntimeSupervisorCancelTerminalProjectionResult> {
    this.assertProjectionAdmission(admission);
    return this.request('cancelTerminalProjection', params, admission);
  }

  public async createTerminalProjectionClient(
    options: RuntimeSupervisorProjectionClientOptions = {}
  ): Promise<RuntimeSupervisorProjectionClient> {
    await this.ensureConnected({ allowRestart: false });
    const expectedSupervisorInstanceId = this.getSupervisorInstanceId();
    if (!this.supportsTerminalProjectionStream() || !expectedSupervisorInstanceId) {
      throw new Error('The connected Runtime Supervisor does not support terminal projection streams.');
    }

    const transport = new RuntimeSupervisorClient({
      backend: this.options.backend,
      supervisorScriptPath: this.options.supervisorScriptPath,
      supervisorLauncherScriptPath: this.options.supervisorLauncherScriptPath,
      startupTimeoutMs: this.options.startupTimeoutMs,
      deferSessionEventCallbacks: true,
      onSessionOutput: options.onSessionOutput,
      onSessionTerminalEvent: options.onSessionTerminalEvent,
      onSessionState: options.onSessionState,
      onDisconnected: options.onBulkDisconnected
    });
    try {
      await transport.ensureConnected({ allowRestart: false });
      const actualSupervisorInstanceId = transport.getSupervisorInstanceId();
      if (
        this.getSupervisorInstanceId() !== expectedSupervisorInstanceId ||
        actualSupervisorInstanceId !== expectedSupervisorInstanceId ||
        !transport.supportsTerminalProjectionStream()
      ) {
        throw createSupervisorInstanceIdentityProtocolError(
          'terminal projection connection',
          expectedSupervisorInstanceId,
          actualSupervisorInstanceId
        );
      }

      let projectionClient: RuntimeSupervisorProjectionClient;
      projectionClient = new RuntimeSupervisorProjectionClient(
        transport,
        expectedSupervisorInstanceId,
        () => this.projectionClients.delete(projectionClient)
      );
      this.projectionClients.add(projectionClient);
      return projectionClient;
    } catch (error) {
      transport.dispose();
      throw error;
    }
  }

  public dispose(): void {
    this.disposed = true;
    if (this.deferredSessionEventTimer !== undefined) {
      clearTimeout(this.deferredSessionEventTimer);
      this.deferredSessionEventTimer = undefined;
    }
    if (this.sessionEventResponseBarrierTimer !== undefined) {
      clearTimeout(this.sessionEventResponseBarrierTimer);
      this.sessionEventResponseBarrierTimer = undefined;
    }
    this.deferredSessionEventCallbacks.length = 0;
    for (const projectionClient of [...this.projectionClients]) {
      projectionClient.dispose();
    }
    this.projectionClients.clear();
    if (this.socket && !this.socket.destroyed) {
      this.socket.destroy();
    }
    this.socket = undefined;
    this.helloResult = undefined;
    this.rejectAllPending(createRuntimeSupervisorProtocolError({
      id: 'clientDisconnected'
    }, RUNTIME_SUPERVISOR_ERROR_CODES.clientDisconnected));
  }

  private async request<T>(
    method:
      | 'createSession'
      | 'attachSession'
      | 'getSessionSnapshot'
      | 'getTerminalProjectionCheckpoint'
      | 'subscribeSession'
      | 'ackSessionRevision'
      | 'writeInput'
      | 'resizeSession'
      | 'updateSessionScrollback'
      | 'stopSession'
      | 'deleteSession'
      | 'openTerminalProjection'
      | 'readTerminalProjection'
      | 'cancelTerminalProjection',
    params:
      | RuntimeSupervisorCreateSessionParams
      | RuntimeSupervisorAttachSessionParams
      | RuntimeSupervisorGetSessionSnapshotParams
      | RuntimeSupervisorGetTerminalProjectionCheckpointParams
      | RuntimeSupervisorSubscribeSessionParams
      | RuntimeSupervisorAckSessionRevisionParams
      | RuntimeSupervisorWriteInputParams
      | RuntimeSupervisorResizeSessionParams
      | RuntimeSupervisorUpdateSessionScrollbackParams
      | RuntimeSupervisorStopSessionParams
      | RuntimeSupervisorDeleteSessionParams
      | RuntimeSupervisorOpenTerminalProjectionParams
      | RuntimeSupervisorReadTerminalProjectionParams
      | RuntimeSupervisorCancelTerminalProjectionParams,
    admission?: RuntimeSupervisorExistingSessionRequestAdmission
  ): Promise<T>;
  private async request<T>(
    method: string,
    params?: unknown,
    admission?: RuntimeSupervisorExistingSessionRequestAdmission
  ): Promise<T> {
    if (!admission) {
      await this.ensureConnected();
    } else {
      this.consumeExistingSessionRequestAdmission(admission);
    }
    return this.requestOnConnectedSocket(method, params, {
      expectedSocketGeneration: admission?.socketGeneration ?? this.socketGeneration,
      expectedSupervisorInstanceId: admission?.expectedSupervisorInstanceId
    });
  }

  private requestOnConnectedSocket<T>(
    method: string,
    params?: unknown,
    admission: {
      expectedSocketGeneration?: number;
      expectedSupervisorInstanceId?: string;
    } = {}
  ): Promise<T> {
    const socket = this.socket;
    if (!socket || socket.destroyed) {
      throw createRuntimeSupervisorProtocolError({
        id: 'clientNotConnected'
      }, RUNTIME_SUPERVISOR_ERROR_CODES.clientNotConnected);
    }
    if (
      admission.expectedSocketGeneration !== undefined &&
      admission.expectedSocketGeneration !== this.socketGeneration
    ) {
      throw createRuntimeSupervisorProtocolError({
        id: 'clientDisconnected'
      }, RUNTIME_SUPERVISOR_ERROR_CODES.clientDisconnected);
    }
    if (admission.expectedSupervisorInstanceId !== undefined) {
      const expectedSupervisorInstanceId = normalizeSupervisorInstanceId(
        admission.expectedSupervisorInstanceId
      );
      const connectedSupervisorInstanceId = this.getSupervisorInstanceId();
      if (
        !expectedSupervisorInstanceId ||
        connectedSupervisorInstanceId !== expectedSupervisorInstanceId
      ) {
        throw createSupervisorInstanceIdentityProtocolError(
          `${method} request admission`,
          expectedSupervisorInstanceId ?? admission.expectedSupervisorInstanceId,
          connectedSupervisorInstanceId
        );
      }
    }

    const id = randomUUID();
    const promise = new Promise<T>((resolve, reject) => {
      this.pendingRequests.set(id, {
        method,
        resolve: resolve as (value: unknown) => void,
        reject
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

    socket.write(`${JSON.stringify(message)}\n`);
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
    await this.waitForSocketCloseBarrier();
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
        reject(createSocketTransportError(error));
      };

      socket.once('connect', handleConnect);
      socket.once('error', handleError);
    });
  }

  private attachSocket(socket: net.Socket): void {
    let resolveSocketClose = (): void => undefined;
    const socketClosePromise = new Promise<void>((resolve) => {
      resolveSocketClose = resolve;
    });
    this.socketCloseBarrier = {
      socket,
      promise: socketClosePromise,
      resolve: resolveSocketClose
    };
    this.socket = socket;
    this.socketGeneration += 1;
    this.buffer = '';
    this.helloResult = undefined;
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      if (this.socket !== socket) {
        return;
      }
      this.buffer += chunk;
      this.drainBufferedMessages();
    });
    socket.on('close', () => {
      try {
        if (this.socket !== socket) {
          return;
        }
        const error = this.disposed
          ? undefined
          : this.socketDisconnectErrors.get(socket) ?? createRuntimeSupervisorProtocolError({
              id: 'clientConnectionClosed'
            }, RUNTIME_SUPERVISOR_ERROR_CODES.clientConnectionClosed, {
              origin: 'transport'
            });
        const supervisorInstanceId = this.socketSupervisorInstanceIds.get(socket);
        this.socket = undefined;
        this.helloResult = undefined;
        this.rejectAllPending(error ?? createRuntimeSupervisorProtocolError({
          id: 'clientConnectionClosed'
        }, RUNTIME_SUPERVISOR_ERROR_CODES.clientConnectionClosed));
        if (!this.disposed) {
          this.options.onDisconnected?.(error, supervisorInstanceId);
        }
      } finally {
        this.completeSocketCloseBarrier(socket);
      }
    });
    socket.on('error', () => {
      // Report the disconnect only after close clears the stale socket reference.
      socket.destroy();
    });
  }

  private drainBufferedMessages(): void {
    while (true) {
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

      this.handleMessage(message);
    }
  }

  private handleMessage(message: RuntimeSupervisorMessage): void {
    if (message.type === 'response') {
      const pending = this.pendingRequests.get(message.id);
      if (!pending) {
        return;
      }
      this.pendingRequests.delete(message.id);
      if (message.ok) {
        try {
          if (pending.method === 'hello') {
            const helloResult = normalizeHelloResult(message.result);
            this.helloResult = helloResult;
            const supervisorInstanceId = normalizeSupervisorInstanceId(
              helloResult.supervisorInstanceId
            );
            if (this.socket && supervisorInstanceId) {
              this.socketSupervisorInstanceIds.set(this.socket, supervisorInstanceId);
            }
            pending.resolve(helloResult);
          } else {
            const result = this.withSupervisorInstanceId(
              message.result,
              `${pending.method} response`
            );
            if (
              pending.method === 'createSession' ||
              pending.method === 'attachSession' ||
              pending.method === 'writeInput'
            ) {
              this.beginSessionEventResponseBarrier();
            }
            pending.resolve(result);
          }
        } catch (error) {
          const protocolError = normalizeThrownProtocolError(error);
          pending.reject(protocolError);
          this.disconnectForProtocolError(protocolError);
        }
      } else {
        pending.reject(createRuntimeSupervisorError(message.error));
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
      let payload: typeof message.payload;
      try {
        payload = this.withSupervisorInstanceId(message.payload, 'sessionOutput event');
      } catch (error) {
        this.disconnectForProtocolError(normalizeThrownProtocolError(error));
        return;
      }
      this.dispatchSessionEvent(() => this.options.onSessionOutput?.(payload));
      return;
    }

    if (message.event === 'sessionTerminalEvent') {
      let payload: typeof message.payload;
      try {
        payload = this.withSupervisorInstanceId(message.payload, 'sessionTerminalEvent event');
      } catch (error) {
        this.disconnectForProtocolError(normalizeThrownProtocolError(error));
        return;
      }
      this.dispatchSessionEvent(() => this.options.onSessionTerminalEvent?.(payload));
      return;
    }

    if (message.event === 'sessionState') {
      let payload: typeof message.payload;
      try {
        payload = this.withSupervisorInstanceId(message.payload, 'sessionState event');
      } catch (error) {
        this.disconnectForProtocolError(normalizeThrownProtocolError(error));
        return;
      }
      this.dispatchSessionEvent(() => this.options.onSessionState?.(payload));
      return;
    }

    if (message.event === 'recoveryState') {
      this.helloResult = this.helloResult
        ? { ...this.helloResult, recovery: message.payload }
        : this.helloResult;
      this.options.onRecoveryState?.(message.payload);
    }
  }

  private rejectAllPending(error: Error): void {
    for (const pending of this.pendingRequests.values()) {
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }

  private dispatchSessionEvent(callback: () => void): void {
    if (this.sessionEventResponseBarrierTimer !== undefined) {
      this.deferredSessionEventCallbacks.push(callback);
      return;
    }
    if (this.options.deferSessionEventCallbacks) {
      // Let response promise/adoption chains resume first. Batch one timer per
      // parser burst so a busy live tail does not create one timer per event.
      queueMicrotask(() => {
        if (this.disposed) {
          return;
        }
        this.deferredSessionEventCallbacks.push(callback);
        if (this.deferredSessionEventTimer !== undefined) {
          return;
        }
        this.deferredSessionEventTimer = setTimeout(() => {
          this.deferredSessionEventTimer = undefined;
          const callbacks = this.deferredSessionEventCallbacks.splice(0);
          for (const deferredCallback of callbacks) {
            deferredCallback();
          }
        }, 0);
      });
      return;
    }
    callback();
  }

  private beginSessionEventResponseBarrier(): void {
    if (this.sessionEventResponseBarrierTimer !== undefined) {
      return;
    }
    this.sessionEventResponseBarrierTimer = setTimeout(() => {
      this.sessionEventResponseBarrierTimer = undefined;
      const callbacks = this.deferredSessionEventCallbacks.splice(0);
      for (const callback of callbacks) {
        callback();
      }
    }, 0);
  }

  private async startSupervisorProcess(): Promise<void> {
    await this.options.backend.startSupervisor({
      supervisorScriptPath: this.options.supervisorScriptPath,
      supervisorLauncherScriptPath: this.options.supervisorLauncherScriptPath
    });
  }

  private async waitForSupervisorReady(): Promise<void> {
    const timeoutMs = normalizeStartupTimeoutMs(this.options.startupTimeoutMs);
    const deadline = Date.now() + timeoutMs;
    let lastTransportError: Error | undefined;

    while (Date.now() < deadline) {
      try {
        if (!this.socket || this.socket.destroyed) {
          await this.connectSocket();
        }
        await this.performHelloHandshake();
        return;
      } catch (error) {
        const normalizedError = error instanceof Error ? error : new Error(String(error));
        if (!isSupervisorSocketStartupError(normalizedError)) {
          throw normalizedError;
        }
        lastTransportError = normalizedError;
      }

      await delay(80);
    }

    throw createRuntimeSupervisorProtocolError({
      id: 'clientReadyTimeout',
      params: {
        ...(lastTransportError ? { lastError: lastTransportError.message } : {})
      }
    }, RUNTIME_SUPERVISOR_ERROR_CODES.clientReadyTimeout, {
      origin: 'readiness',
      errno: getRuntimeSupervisorErrorDetails(lastTransportError)?.errno
    });
  }

  private async performHelloHandshake(): Promise<void> {
    const helloResult = await this.requestOnConnectedSocket<RuntimeSupervisorHelloResult>('hello');
    if (helloResult.recovery) {
      this.options.onRecoveryState?.(helloResult.recovery);
    }
  }

  private withSupervisorInstanceId<T extends object>(value: T, context: string): T {
    const supervisorInstanceId = this.getSupervisorInstanceId();
    if (!supervisorInstanceId) {
      return value;
    }

    if (this.supportsSupervisorInstanceIdentity()) {
      const payloadInstanceId = normalizeSupervisorInstanceId(
        (value as { supervisorInstanceId?: unknown }).supervisorInstanceId
      );
      if (payloadInstanceId !== supervisorInstanceId) {
        throw createSupervisorInstanceIdentityProtocolError(
          context,
          supervisorInstanceId,
          payloadInstanceId
        );
      }
      return { ...value, supervisorInstanceId };
    }

    return { ...value, supervisorInstanceId };
  }

  private disconnectForProtocolError(error: Error): void {
    const socket = this.socket;
    this.rejectAllPending(error);
    if (!socket || socket.destroyed) {
      return;
    }
    this.socketDisconnectErrors.set(socket, error);
    socket.destroy();
  }

  private consumeExistingSessionRequestAdmission(
    admission: RuntimeSupervisorExistingSessionRequestAdmission
  ): void {
    if (!this.existingSessionRequestAdmissions.delete(admission)) {
      throw createRuntimeSupervisorProtocolError({
        id: 'clientDisconnected'
      }, RUNTIME_SUPERVISOR_ERROR_CODES.clientDisconnected);
    }
  }

  private assertProjectionAdmission(
    admission: RuntimeSupervisorExistingSessionRequestAdmission | undefined
  ): asserts admission is RuntimeSupervisorExistingSessionRequestAdmission {
    if (!admission) {
      throw createRuntimeSupervisorProtocolError({
        id: 'clientDisconnected'
      }, RUNTIME_SUPERVISOR_ERROR_CODES.clientDisconnected);
    }
  }

  private async waitForSocketCloseBarrier(): Promise<void> {
    const barrier = this.socketCloseBarrier;
    if (barrier) {
      await barrier.promise;
    }
  }

  private completeSocketCloseBarrier(socket: net.Socket): void {
    const barrier = this.socketCloseBarrier;
    if (!barrier || barrier.socket !== socket) {
      return;
    }
    this.socketCloseBarrier = undefined;
    barrier.resolve();
  }

  private clearConnectPromise(connectPromise: Promise<void>): void {
    if (this.connectPromise === connectPromise) {
      this.connectPromise = undefined;
    }
  }
}

/** Restricted second connection used only for credit-driven terminal history transfer. */
export class RuntimeSupervisorProjectionClient {
  private disposed = false;

  public constructor(
    private readonly transport: RuntimeSupervisorClient,
    private readonly supervisorInstanceId: string,
    private readonly onDispose: () => void = () => undefined
  ) {}

  public getSupervisorInstanceId(): string {
    return this.supervisorInstanceId;
  }

  public async open(
    params: RuntimeSupervisorOpenTerminalProjectionParams
  ): Promise<RuntimeSupervisorOpenTerminalProjectionResult> {
    this.assertNotDisposed();
    if (params.follow === true && !this.transport.supportsTerminalProjectionFollow()) {
      throw new Error('The connected Runtime Supervisor does not support follow terminal projections.');
    }
    return this.transport.openTerminalProjection(params, this.captureAdmission());
  }

  public async read(
    params: RuntimeSupervisorReadTerminalProjectionParams
  ): Promise<RuntimeSupervisorReadTerminalProjectionResult> {
    this.assertNotDisposed();
    return this.transport.readTerminalProjection(params, this.captureAdmission());
  }

  public async cancel(
    params: RuntimeSupervisorCancelTerminalProjectionParams
  ): Promise<RuntimeSupervisorCancelTerminalProjectionResult> {
    this.assertNotDisposed();
    return this.transport.cancelTerminalProjection(params, this.captureAdmission());
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.onDispose();
    this.transport.dispose();
  }

  private captureAdmission(): RuntimeSupervisorExistingSessionRequestAdmission {
    return this.transport.captureExistingSessionRequestAdmission({
      allowRestart: false,
      expectedSupervisorInstanceId: this.supervisorInstanceId
    });
  }

  private assertNotDisposed(): void {
    if (this.disposed) {
      throw createRuntimeSupervisorProtocolError({
        id: 'clientDisposed'
      }, RUNTIME_SUPERVISOR_ERROR_CODES.clientDisposed);
    }
  }
}

function isSupervisorSocketStartupError(error: unknown): boolean {
  return getRuntimeSupervisorErrorDetails(error)?.origin === 'transport';
}

function normalizeStartupTimeoutMs(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : DEFAULT_SUPERVISOR_STARTUP_TIMEOUT_MS;
}

function normalizeHelloResult(value: unknown): RuntimeSupervisorHelloResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw createSupervisorInstanceIdentityProtocolError('hello response');
  }
  const helloResult = value as RuntimeSupervisorHelloResult;
  if (helloResult.capabilities?.supervisorInstanceIdentityV1 === true) {
    const nativeInstanceId = normalizeSupervisorInstanceId(helloResult.supervisorInstanceId);
    if (!nativeInstanceId) {
      throw createSupervisorInstanceIdentityProtocolError('hello response');
    }
    return { ...helloResult, supervisorInstanceId: nativeInstanceId };
  }

  const legacyInstanceId = Number.isInteger(helloResult.pid) && helloResult.pid > 0
    ? `legacy-pid:${helloResult.pid}`
    : undefined;
  return legacyInstanceId
    ? { ...helloResult, supervisorInstanceId: legacyInstanceId }
    : helloResult;
}

function normalizeSupervisorInstanceId(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function createSupervisorInstanceIdentityProtocolError(
  context: string,
  expected?: string,
  actual?: string
): Error {
  const expectation = expected
    ? `expected ${expected}, received ${actual ?? '<missing>'}`
    : 'supervisorInstanceIdentityV1 requires a non-empty supervisorInstanceId';
  return createRuntimeSupervisorProtocolError({
    id: 'parseError',
    params: {
      message: `${context} has invalid supervisor instance identity (${expectation})`
    }
  }, RUNTIME_SUPERVISOR_ERROR_CODES.parseError);
}

function normalizeThrownProtocolError(error: unknown): Error {
  return error instanceof Error
    ? error
    : createRuntimeSupervisorProtocolError({
        id: 'parseError',
        params: {
          message: 'runtime supervisor identity validation failed'
        }
      }, RUNTIME_SUPERVISOR_ERROR_CODES.parseError);
}

function createSocketTransportError(error: Error & { code?: string }): Error {
  const errno = typeof error.code === 'string' ? error.code : undefined;
  if (errno === 'ENOENT') {
    return createRuntimeSupervisorProtocolError({
      id: 'clientSocketUnavailable'
    }, RUNTIME_SUPERVISOR_ERROR_CODES.clientSocketUnavailable, {
      origin: 'transport',
      errno
    });
  }
  if (errno === 'ECONNREFUSED') {
    return createRuntimeSupervisorProtocolError({
      id: 'clientSocketRefused'
    }, RUNTIME_SUPERVISOR_ERROR_CODES.clientSocketRefused, {
      origin: 'transport',
      errno
    });
  }

  return createRuntimeSupervisorProtocolError({
    id: 'clientConnectionClosed'
  }, RUNTIME_SUPERVISOR_ERROR_CODES.clientConnectionClosed, {
    origin: 'transport',
    errno
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
