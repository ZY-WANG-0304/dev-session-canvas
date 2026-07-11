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
  RuntimeSupervisorGetSessionSnapshotParams,
  RuntimeSupervisorHelloResult,
  RuntimeSupervisorMessage,
  RuntimeSupervisorResizeSessionParams,
  RuntimeSupervisorSessionSnapshot,
  RuntimeSupervisorStopSessionParams,
  RuntimeSupervisorSubscribeSessionParams,
  RuntimeSupervisorSubscribeSessionResult,
  RuntimeSupervisorUpdateSessionScrollbackParams,
  RuntimeSupervisorWriteInputParams
} from '../common/runtimeSupervisorProtocol';
import type { RuntimeHostBackend } from './runtimeHostBackend';

interface PendingSupervisorRequest<T> {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

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

  public constructor(private readonly options: RuntimeSupervisorClientOptions) {}

  public async ensureConnected(options: { allowRestart?: boolean } = {}): Promise<void> {
    if (this.disposed) {
      throw createRuntimeSupervisorProtocolError({
        id: 'clientDisposed'
      }, RUNTIME_SUPERVISOR_ERROR_CODES.clientDisposed);
    }

    if (this.socket && !this.socket.destroyed) {
      return;
    }

    if (!this.connectPromise) {
      this.connectPromise = this.connectWithRestart(options.allowRestart !== false);
      this.connectPromise.finally(() => {
        this.connectPromise = undefined;
      });
    }

    return this.connectPromise;
  }

  public async hello(): Promise<RuntimeSupervisorHelloResult> {
    const result = await this.request<RuntimeSupervisorHelloResult>('hello');
    this.helloResult = result;
    return result;
  }

  public supportsTerminalProjectionSnapshot(): boolean {
    return this.helloResult?.capabilities?.terminalProjectionSnapshotV1 === true;
  }

  public supportsTerminalSessionStream(): boolean {
    return this.helloResult?.capabilities?.terminalSessionStreamV1 === true;
  }

  public supportsTerminalAppliedRevisionAck(): boolean {
    return this.helloResult?.capabilities?.terminalAppliedRevisionAckV1 === true;
  }

  public async createSession(
    params: RuntimeSupervisorCreateSessionParams
  ): Promise<RuntimeSupervisorSessionSnapshot> {
    return this.request('createSession', params);
  }

  public async attachSession(
    params: RuntimeSupervisorAttachSessionParams
  ): Promise<RuntimeSupervisorSessionSnapshot> {
    return this.request('attachSession', params);
  }

  public async getSessionSnapshot(
    params: RuntimeSupervisorGetSessionSnapshotParams
  ): Promise<RuntimeSupervisorSessionSnapshot> {
    return this.request('getSessionSnapshot', params);
  }

  public async subscribeSession(
    params: RuntimeSupervisorSubscribeSessionParams
  ): Promise<RuntimeSupervisorSubscribeSessionResult> {
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
    await this.request('deleteSession', params);
  }

  public dispose(): void {
    this.disposed = true;
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
    method: 'hello'
  ): Promise<T>;
  private async request<T>(
    method:
      | 'createSession'
      | 'attachSession'
      | 'getSessionSnapshot'
      | 'subscribeSession'
      | 'ackSessionRevision'
      | 'writeInput'
      | 'resizeSession'
      | 'updateSessionScrollback'
      | 'stopSession'
      | 'deleteSession',
    params:
      | RuntimeSupervisorCreateSessionParams
      | RuntimeSupervisorAttachSessionParams
      | RuntimeSupervisorGetSessionSnapshotParams
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
    const socket = this.socket;
    if (!socket || socket.destroyed) {
      throw createRuntimeSupervisorProtocolError({
        id: 'clientNotConnected'
      }, RUNTIME_SUPERVISOR_ERROR_CODES.clientNotConnected);
    }

    const id = randomUUID();
    const promise = new Promise<T>((resolve, reject) => {
      this.pendingRequests.set(id, {
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
      await this.connectSocket();
      await this.hello();
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
    this.socket = socket;
    this.buffer = '';
    this.helloResult = undefined;
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      this.buffer += chunk;
      this.drainBufferedMessages();
    });
    socket.on('close', () => {
      const error = this.disposed
        ? undefined
        : createRuntimeSupervisorProtocolError({
            id: 'clientConnectionClosed'
          }, RUNTIME_SUPERVISOR_ERROR_CODES.clientConnectionClosed);
      this.socket = undefined;
      this.helloResult = undefined;
      this.rejectAllPending(error ?? createRuntimeSupervisorProtocolError({
        id: 'clientConnectionClosed'
      }, RUNTIME_SUPERVISOR_ERROR_CODES.clientConnectionClosed));
      if (!this.disposed) {
        this.options.onDisconnected?.(error);
      }
    });
    socket.on('error', (error) => {
      if (!this.disposed) {
        this.options.onDisconnected?.(error);
      }
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
        pending.resolve(message.result);
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
        await this.connectSocket();
        await this.hello();
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
