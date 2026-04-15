import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';

import {
  AGENT_WAITING_INPUT_POLL_INTERVAL_MS,
  createAgentActivityHeuristicState,
  evaluateAgentWaitingInputTransition,
  recordAgentOutputHeuristics,
  resetAgentActivityHeuristics,
  type AgentActivityHeuristicState
} from '../common/agentActivityHeuristics';
import {
  type AgentNodeStatus,
  type AgentProviderKind,
  type AgentResumeStrategy,
  type ExecutionNodeKind,
  type PendingExecutionLaunch,
  type RuntimeHostBackendKind,
  type RuntimePersistenceGuarantee,
  type TerminalNodeStatus
} from '../common/protocol';
import { resolveLegacyRuntimeSupervisorPathsFromStorageDir } from '../common/runtimeSupervisorPaths';
import { SerializedTerminalStateTracker } from '../common/serializedTerminalState';
import { DEFAULT_TERMINAL_SCROLLBACK, normalizeTerminalScrollback } from '../common/terminalScrollback';
import {
  deserializeExecutionSessionLaunchSpec,
  type RuntimeSupervisorAttachSessionParams,
  type RuntimeSupervisorCreateSessionParams,
  type RuntimeSupervisorDeleteSessionParams,
  type RuntimeSupervisorEvent,
  type RuntimeSupervisorMessage,
  type RuntimeSupervisorPaths,
  type RuntimeSupervisorRequest,
  type RuntimeSupervisorResizeSessionParams,
  type RuntimeSupervisorSessionSnapshot,
  type RuntimeSupervisorStopSessionParams,
  type RuntimeSupervisorUpdateSessionScrollbackParams,
  type RuntimeSupervisorWriteInputParams
} from '../common/runtimeSupervisorProtocol';
import {
  createExecutionSessionProcess,
  type DisposableLike,
  type ExecutionSessionExitEvent,
  type ExecutionSessionProcess
} from '../panel/executionSessionBridge';
import { locateCodexSessionId } from '../common/codexSessionIdLocator';

const IDLE_SHUTDOWN_DELAY_MS = 30_000;
const TERMINAL_LIVE_DELAY_MS = 160;
const OUTPUT_TAIL_LIMIT = 6000;

interface SupervisorRegistry {
  version: 1;
  sessions: RuntimeSupervisorSessionSnapshot[];
}

interface SupervisorSession {
  sessionId: string;
  kind: ExecutionNodeKind;
  live: boolean;
  startedAtMs: number;
  lifecycle: AgentNodeStatus | TerminalNodeStatus;
  runtimeBackend: RuntimeHostBackendKind;
  runtimeGuarantee: RuntimePersistenceGuarantee;
  resumePhaseActive: boolean;
  shellPath: string;
  cwd: string;
  cols: number;
  rows: number;
  scrollback: number;
  output: string;
  terminalStateTracker: SerializedTerminalStateTracker;
  displayLabel: string;
  launchMode: PendingExecutionLaunch;
  provider?: AgentProviderKind;
  resumeStrategy?: AgentResumeStrategy;
  resumeSessionId?: string;
  resumeStoragePath?: string;
  lastExitCode?: number;
  lastExitSignal?: string;
  lastExitMessage?: string;
  stopRequested: boolean;
  agentActivity?: AgentActivityHeuristicState;
  process?: ExecutionSessionProcess;
  outputSubscription?: DisposableLike;
  exitSubscription?: DisposableLike;
  lifecycleTimer?: NodeJS.Timeout;
}

class RuntimeSupervisorServer {
  private readonly sessions = new Map<string, SupervisorSession>();
  private readonly connections = new Set<net.Socket>();
  private readonly subscriptions = new Map<net.Socket, Set<string>>();
  private persistTimer: NodeJS.Timeout | undefined;
  private idleShutdownTimer: NodeJS.Timeout | undefined;
  private server: net.Server | undefined;

  public constructor(
    private readonly paths: RuntimeSupervisorPaths,
    private readonly runtimeBackend: RuntimeHostBackendKind,
    private readonly runtimeGuarantee: RuntimePersistenceGuarantee
  ) {}

  public async start(): Promise<void> {
    fs.mkdirSync(this.paths.storageDir, { recursive: true });
    ensureSocketDirectoryReady(this.paths);
    this.loadRegistry();
    await this.listen();
    this.scheduleIdleShutdownIfNeeded();
  }

  private async listen(): Promise<void> {
    if (process.platform !== 'win32' && fs.existsSync(this.paths.socketPath)) {
      fs.unlinkSync(this.paths.socketPath);
    }

    this.server = net.createServer((socket) => {
      this.connections.add(socket);
      this.subscriptions.set(socket, new Set());
      this.clearIdleShutdownTimer();
      socket.setEncoding('utf8');
      let buffer = '';

      socket.on('data', (chunk) => {
        buffer += chunk;
        while (true) {
          const newlineIndex = buffer.indexOf('\n');
          if (newlineIndex < 0) {
            break;
          }

          const line = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);
          if (!line) {
            continue;
          }

          try {
            const message = JSON.parse(line) as RuntimeSupervisorMessage;
            if (message.type === 'request') {
              void this.handleRequest(socket, message);
            }
          } catch (error) {
            this.writeMessage(socket, createErrorResponse('parse-error', error instanceof Error ? error.message : '消息解析失败。'));
          }
        }
      });

      socket.on('close', () => {
        this.cleanupSocket(socket);
      });

      socket.on('error', () => {
        this.cleanupSocket(socket);
      });
    });

    await new Promise<void>((resolve, reject) => {
      this.server?.once('error', reject);
      this.server?.listen(this.paths.socketPath, () => {
        this.server?.removeListener('error', reject);
        resolve();
      });
    });
  }

  private async handleRequest(socket: net.Socket, request: RuntimeSupervisorRequest): Promise<void> {
    try {
      switch (request.method) {
        case 'hello':
          this.writeMessage(socket, {
            type: 'response',
            id: request.id,
            ok: true,
            result: {
              serverVersion: 1,
              pid: process.pid,
              runtimeBackend: this.runtimeBackend,
              runtimeGuarantee: this.runtimeGuarantee
            }
          });
          return;
        case 'createSession': {
          const snapshot = this.createSession(socket, request.params);
          this.writeMessage(socket, {
            type: 'response',
            id: request.id,
            ok: true,
            result: snapshot
          });
          return;
        }
        case 'attachSession': {
          const snapshot = this.attachSession(socket, request.params);
          this.writeMessage(socket, {
            type: 'response',
            id: request.id,
            ok: true,
            result: snapshot
          });
          return;
        }
        case 'writeInput':
          this.writeInput(request.params);
          this.writeOkResponse(socket, request.id);
          return;
        case 'resizeSession':
          this.resizeSession(request.params);
          this.writeOkResponse(socket, request.id);
          return;
        case 'updateSessionScrollback':
          await this.updateSessionScrollback(request.params);
          this.writeOkResponse(socket, request.id);
          return;
        case 'stopSession':
          this.stopSession(request.params);
          this.writeOkResponse(socket, request.id);
          return;
        case 'deleteSession':
          this.deleteSession(request.params);
          this.writeOkResponse(socket, request.id);
          return;
      }
    } catch (error) {
      this.writeMessage(socket, {
        type: 'response',
        id: request.id,
        ok: false,
        error: {
          message: error instanceof Error ? error.message : String(error)
        }
      });
    }
  }

  private createSession(
    socket: net.Socket,
    params: RuntimeSupervisorCreateSessionParams
  ): RuntimeSupervisorSessionSnapshot {
    const sessionId = params.sessionId?.trim() || randomUUID();
    if (this.sessions.has(sessionId)) {
      throw new Error(`runtime session ${sessionId} 已存在。`);
    }

    const lifecycle: AgentNodeStatus | TerminalNodeStatus =
      params.kind === 'agent'
        ? params.launchMode === 'resume'
          ? 'resuming'
          : 'starting'
        : 'launching';
    const launchSpec = deserializeExecutionSessionLaunchSpec(params.launchSpec);
    const startedAtMs = Date.now();
    const process = createExecutionSessionProcess(launchSpec);
    const scrollback = normalizeTerminalScrollback(params.scrollback, DEFAULT_TERMINAL_SCROLLBACK);
    const session: SupervisorSession = {
      sessionId,
      kind: params.kind,
      live: true,
      startedAtMs,
      lifecycle,
      runtimeBackend: this.runtimeBackend,
      runtimeGuarantee: this.runtimeGuarantee,
      resumePhaseActive: params.kind === 'agent' && params.launchMode === 'resume',
      shellPath: params.launchSpec.file,
      cwd: params.launchSpec.cwd,
      cols: params.launchSpec.cols,
      rows: params.launchSpec.rows,
      scrollback,
      output: '',
      terminalStateTracker: new SerializedTerminalStateTracker(params.launchSpec.cols, params.launchSpec.rows, {
        scrollback
      }),
      displayLabel: params.displayLabel,
      launchMode: params.launchMode,
      provider: params.provider,
      resumeStrategy: params.resumeStrategy,
      resumeSessionId: params.resumeSessionId,
      resumeStoragePath: params.resumeStoragePath,
      stopRequested: false,
      agentActivity: params.kind === 'agent' ? createAgentActivityHeuristicState() : undefined,
      process
    };
    this.sessions.set(sessionId, session);
    this.subscribeSocket(socket, sessionId);
    this.bindSessionProcess(session);

    if (session.kind === 'terminal') {
      session.lifecycleTimer = setTimeout(() => {
        const current = this.sessions.get(session.sessionId);
        if (!current || !current.live || current.lifecycle !== 'launching') {
          return;
        }

        current.lifecycleTimer = undefined;
        current.lifecycle = 'live';
        this.emitSessionState(current);
      }, TERMINAL_LIVE_DELAY_MS);
    }

    if (
      session.kind === 'agent' &&
      session.provider === 'codex' &&
      session.launchMode === 'start' &&
      !session.resumeSessionId
    ) {
      void this.maybeDiscoverCodexResumeSessionId(session.sessionId);
    }

    this.schedulePersist();
    return this.toSnapshot(session);
  }

  private attachSession(
    socket: net.Socket,
    params: RuntimeSupervisorAttachSessionParams
  ): RuntimeSupervisorSessionSnapshot {
    const session = this.sessions.get(params.sessionId);
    if (!session) {
      throw new Error(`未找到 runtime session ${params.sessionId}。`);
    }

    this.subscribeSocket(socket, params.sessionId);
    return this.toSnapshot(session);
  }

  private writeInput(params: RuntimeSupervisorWriteInputParams): void {
    const session = this.requireLiveSession(params.sessionId);
    if (session.kind === 'agent') {
      const submittedInstruction = isAgentInstructionSubmission(params.data);
      if (session.lifecycleTimer) {
        clearTimeout(session.lifecycleTimer);
        session.lifecycleTimer = undefined;
      }
      if (submittedInstruction) {
        resetAgentActivityHeuristics(this.ensureAgentActivityState(session));
        session.lifecycle = 'running';
        session.resumePhaseActive = false;
        this.emitSessionState(session);
      }
    } else if (session.lifecycle === 'launching') {
      session.lifecycle = 'live';
      this.emitSessionState(session);
    }

    session.process?.write(params.data);
  }

  private resizeSession(params: RuntimeSupervisorResizeSessionParams): void {
    const session = this.requireSession(params.sessionId);
    session.cols = params.cols;
    session.rows = params.rows;
    session.terminalStateTracker.resize(params.cols, params.rows);
    if (session.live) {
      session.process?.resize(params.cols, params.rows);
    }
    this.emitSessionState(session);
  }

  private async updateSessionScrollback(params: RuntimeSupervisorUpdateSessionScrollbackParams): Promise<void> {
    const session = this.requireLiveSession(params.sessionId);
    const scrollback = normalizeTerminalScrollback(params.scrollback, DEFAULT_TERMINAL_SCROLLBACK);
    if (session.scrollback === scrollback) {
      return;
    }

    session.scrollback = scrollback;
    await session.terminalStateTracker.setScrollback(scrollback);
    this.emitSessionState(session);
    this.schedulePersist();
  }

  private stopSession(params: RuntimeSupervisorStopSessionParams): void {
    const session = this.requireLiveSession(params.sessionId);
    session.stopRequested = true;
    session.lifecycle = session.kind === 'agent' ? 'stopping' : 'stopping';
    if (session.lifecycleTimer) {
      clearTimeout(session.lifecycleTimer);
      session.lifecycleTimer = undefined;
    }
    this.emitSessionState(session);
    session.process?.kill();
  }

  private deleteSession(params: RuntimeSupervisorDeleteSessionParams): void {
    const session = this.requireSession(params.sessionId);
    this.disposeSession(session, {
      terminateProcess: session.live
    });
    this.sessions.delete(params.sessionId);
    this.schedulePersist();
    this.scheduleIdleShutdownIfNeeded();
  }

  private bindSessionProcess(session: SupervisorSession): void {
    session.outputSubscription = session.process?.onData((chunk) => {
      if (!chunk) {
        return;
      }

      session.output = appendOutputTail(session.output, chunk);
      session.terminalStateTracker.write(chunk);
      if (session.kind === 'agent') {
        if (
          session.lifecycle === 'starting' ||
          session.lifecycle === 'resuming' ||
          session.lifecycle === 'running'
        ) {
          recordAgentOutputHeuristics(this.ensureAgentActivityState(session), chunk, session.output);
          this.queueAgentWaitingInput(session.sessionId);
        }
      } else if (session.lifecycle === 'launching') {
        session.lifecycle = 'live';
        if (session.lifecycleTimer) {
          clearTimeout(session.lifecycleTimer);
          session.lifecycleTimer = undefined;
        }
        this.emitSessionState(session);
      }

      this.emitSessionOutput(session, chunk);
      this.schedulePersist();
    });

    session.exitSubscription = session.process?.onExit(({ exitCode, signal }: ExecutionSessionExitEvent) => {
      this.finalizeSession(session.sessionId, exitCode, signal);
    });
  }

  private finalizeSession(sessionId: string, exitCode: number, signal?: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    if (session.lifecycleTimer) {
      clearTimeout(session.lifecycleTimer);
      session.lifecycleTimer = undefined;
    }

    session.outputSubscription?.dispose();
    session.exitSubscription?.dispose();
    session.outputSubscription = undefined;
    session.exitSubscription = undefined;
    session.process = undefined;
    session.live = false;

    if (session.kind === 'agent') {
      if (session.stopRequested) {
        session.lifecycle = 'stopped';
        session.lastExitMessage = `已停止 ${session.displayLabel} 会话。`;
      } else if (exitCode === 0) {
        session.lifecycle = 'stopped';
        session.lastExitMessage = `${session.displayLabel} 会话已结束。`;
      } else if (session.resumePhaseActive) {
        session.lifecycle = 'resume-failed';
        session.lastExitMessage = describeAgentResumeFailure(session.displayLabel, exitCode, signal, session.output);
      } else {
        session.lifecycle = 'error';
        session.lastExitMessage = describeAgentExit(session.displayLabel, exitCode, signal, session.output);
      }
    } else if (session.stopRequested) {
      session.lifecycle = 'closed';
      session.lastExitMessage = '终端已停止。';
    } else if (exitCode === 0) {
      session.lifecycle = 'closed';
      session.lastExitMessage = '终端会话已结束。';
    } else {
      session.lifecycle = 'error';
      session.lastExitMessage = describeTerminalExit(session.shellPath, exitCode, signal, session.output);
    }

    session.lastExitCode = exitCode;
    session.lastExitSignal = normalizeSignal(signal);
    this.emitSessionState(session);
    this.schedulePersist();
    this.scheduleIdleShutdownIfNeeded();
  }

  private async maybeDiscoverCodexResumeSessionId(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (
      !session ||
      session.kind !== 'agent' ||
      session.provider !== 'codex' ||
      session.launchMode !== 'start' ||
      session.resumeSessionId?.trim()
    ) {
      return;
    }

    const discoveredSessionId = await locateCodexSessionId({
      cwd: session.cwd,
      startedAtMs: session.startedAtMs
    });

    const current = this.sessions.get(sessionId);
    if (
      !current ||
      current.kind !== 'agent' ||
      current.provider !== 'codex' ||
      current.launchMode !== 'start' ||
      !current.live ||
      current.resumeSessionId?.trim() ||
      !discoveredSessionId
    ) {
      return;
    }

    current.resumeStrategy = 'codex-session-id';
    current.resumeSessionId = discoveredSessionId;
    this.emitSessionState(current);
  }

  private emitSessionOutput(session: SupervisorSession, chunk: string): void {
    const message: RuntimeSupervisorEvent = {
      type: 'event',
      event: 'sessionOutput',
      payload: {
        sessionId: session.sessionId,
        kind: session.kind,
        chunk
      }
    };
    this.broadcastToSessionSubscribers(session.sessionId, message);
  }

  private emitSessionState(session: SupervisorSession): void {
    const message: RuntimeSupervisorEvent = {
      type: 'event',
      event: 'sessionState',
      payload: this.toSnapshot(session)
    };
    this.broadcastToSessionSubscribers(session.sessionId, message);
    this.schedulePersist();
  }

  private ensureAgentActivityState(session: SupervisorSession): AgentActivityHeuristicState {
    if (!session.agentActivity) {
      session.agentActivity = createAgentActivityHeuristicState();
    }

    return session.agentActivity;
  }

  private queueAgentWaitingInput(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.kind !== 'agent') {
      return;
    }

    if (session.lifecycleTimer) {
      clearTimeout(session.lifecycleTimer);
    }

    session.lifecycleTimer = setTimeout(() => {
      const current = this.sessions.get(sessionId);
      if (
        !current ||
        current.kind !== 'agent' ||
        !current.live ||
        !isAgentLifecycleAwaitingInteractiveState(current.lifecycle)
      ) {
        return;
      }

      const evaluation = evaluateAgentWaitingInputTransition(this.ensureAgentActivityState(current));
      if (evaluation.shouldTransition) {
        current.lifecycleTimer = undefined;
        if (current.lifecycle === 'resuming') {
          current.resumePhaseActive = false;
        }
        current.lifecycle = 'waiting-input';
        this.emitSessionState(current);
        return;
      }

      if (evaluation.shouldKeepPolling) {
        this.queueAgentWaitingInput(sessionId);
        return;
      }

      current.lifecycleTimer = undefined;
    }, AGENT_WAITING_INPUT_POLL_INTERVAL_MS);
  }

  private toSnapshot(session: SupervisorSession): RuntimeSupervisorSessionSnapshot {
    return {
      sessionId: session.sessionId,
      kind: session.kind,
      live: session.live,
      lifecycle: session.lifecycle,
      runtimeBackend: session.runtimeBackend,
      runtimeGuarantee: session.runtimeGuarantee,
      resumePhaseActive: session.resumePhaseActive,
      shellPath: session.shellPath,
      cwd: session.cwd,
      cols: session.cols,
      rows: session.rows,
      scrollback: session.scrollback,
      output: session.output,
      serializedTerminalState: session.terminalStateTracker.getSerializedState(),
      displayLabel: session.displayLabel,
      launchMode: session.launchMode,
      provider: session.provider,
      resumeStrategy: session.resumeStrategy,
      resumeSessionId: session.resumeSessionId,
      resumeStoragePath: session.resumeStoragePath,
      lastExitCode: session.lastExitCode,
      lastExitSignal: session.lastExitSignal,
      lastExitMessage: session.lastExitMessage
    };
  }

  private requireSession(sessionId: string): SupervisorSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`未找到 runtime session ${sessionId}。`);
    }

    return session;
  }

  private requireLiveSession(sessionId: string): SupervisorSession {
    const session = this.requireSession(sessionId);
    if (!session.live || !session.process) {
      throw new Error(`runtime session ${sessionId} 当前不处于 live 状态。`);
    }

    return session;
  }

  private subscribeSocket(socket: net.Socket, sessionId: string): void {
    const subscriptions = this.subscriptions.get(socket);
    if (!subscriptions) {
      return;
    }

    subscriptions.add(sessionId);
  }

  private broadcastToSessionSubscribers(sessionId: string, message: RuntimeSupervisorEvent): void {
    const payload = `${JSON.stringify(message)}\n`;
    for (const [socket, subscriptions] of this.subscriptions.entries()) {
      if (!subscriptions.has(sessionId) || socket.destroyed) {
        continue;
      }

      socket.write(payload);
    }
  }

  private writeMessage(socket: net.Socket, message: RuntimeSupervisorMessage): void {
    if (socket.destroyed) {
      return;
    }

    socket.write(`${JSON.stringify(message)}\n`);
  }

  private writeOkResponse(socket: net.Socket, id: string): void {
    this.writeMessage(socket, {
      type: 'response',
      id,
      ok: true,
      result: {
        ok: true
      }
    });
  }

  private cleanupSocket(socket: net.Socket): void {
    this.connections.delete(socket);
    this.subscriptions.delete(socket);
    this.scheduleIdleShutdownIfNeeded();
  }

  private disposeSession(session: SupervisorSession, options: { terminateProcess: boolean }): void {
    if (session.lifecycleTimer) {
      clearTimeout(session.lifecycleTimer);
      session.lifecycleTimer = undefined;
    }

    session.outputSubscription?.dispose();
    session.exitSubscription?.dispose();
    session.outputSubscription = undefined;
    session.exitSubscription = undefined;

    if (options.terminateProcess) {
      session.process?.kill();
    }

    session.process = undefined;
    session.live = false;
    session.terminalStateTracker.dispose();
  }

  private schedulePersist(): void {
    if (this.persistTimer) {
      return;
    }

    this.persistTimer = setTimeout(() => {
      this.persistTimer = undefined;
      this.persistRegistry();
    }, 120);
  }

  private persistRegistry(): void {
    const registry: SupervisorRegistry = {
      version: 1,
      sessions: Array.from(this.sessions.values()).map((session) => this.toSnapshot(session))
    };
    const tempPath = `${this.paths.registryPath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(registry, null, 2), 'utf8');
    fs.renameSync(tempPath, this.paths.registryPath);
  }

  private loadRegistry(): void {
    if (!fs.existsSync(this.paths.registryPath)) {
      return;
    }

    let registry: SupervisorRegistry;
    try {
      registry = JSON.parse(fs.readFileSync(this.paths.registryPath, 'utf8')) as SupervisorRegistry;
    } catch {
      return;
    }

    for (const rawSession of registry.sessions ?? []) {
      this.sessions.set(rawSession.sessionId, this.normalizeRecoveredSession(rawSession));
    }
  }

  private normalizeRecoveredSession(snapshot: RuntimeSupervisorSessionSnapshot): SupervisorSession {
    const lifecycle =
      snapshot.kind === 'agent'
        ? normalizeRecoveredAgentLifecycle(snapshot.lifecycle as AgentNodeStatus)
        : normalizeRecoveredTerminalLifecycle(snapshot.lifecycle as TerminalNodeStatus);
    const lastExitMessage =
      snapshot.lastExitMessage ||
      '会话监督器未保留原 live runtime，已仅恢复历史结果。';
    const scrollback = normalizeTerminalScrollback(snapshot.scrollback, DEFAULT_TERMINAL_SCROLLBACK);

    return {
      ...snapshot,
      live: false,
      startedAtMs: Date.now(),
      lifecycle,
      runtimeBackend: normalizeRuntimeHostBackend(snapshot.runtimeBackend),
      runtimeGuarantee: normalizeRuntimePersistenceGuarantee(snapshot.runtimeGuarantee),
      resumePhaseActive:
        typeof snapshot.resumePhaseActive === 'boolean'
          ? snapshot.resumePhaseActive
          : snapshot.kind === 'agent' &&
            snapshot.launchMode === 'resume' &&
            isAgentResumePhaseActive(snapshot.lifecycle as AgentNodeStatus),
      lastExitMessage,
      stopRequested: false,
      agentActivity: snapshot.kind === 'agent' ? createAgentActivityHeuristicState() : undefined,
      scrollback,
      terminalStateTracker: new SerializedTerminalStateTracker(snapshot.cols, snapshot.rows, {
        scrollback,
        initialState: snapshot.serializedTerminalState,
        initialOutput: snapshot.output
      }),
      process: undefined,
      outputSubscription: undefined,
      exitSubscription: undefined,
      lifecycleTimer: undefined
    };
  }

  private scheduleIdleShutdownIfNeeded(): void {
    if (this.connections.size > 0 || Array.from(this.sessions.values()).some((session) => session.live)) {
      this.clearIdleShutdownTimer();
      return;
    }

    if (this.idleShutdownTimer) {
      return;
    }

    this.idleShutdownTimer = setTimeout(() => {
      process.exit(0);
    }, IDLE_SHUTDOWN_DELAY_MS);
  }

  private clearIdleShutdownTimer(): void {
    if (this.idleShutdownTimer) {
      clearTimeout(this.idleShutdownTimer);
      this.idleShutdownTimer = undefined;
    }
  }
}

function appendOutputTail(existing: string, chunk: string): string {
  const combined = `${existing}${chunk}`;
  return combined.length > OUTPUT_TAIL_LIMIT ? combined.slice(-OUTPUT_TAIL_LIMIT) : combined;
}

function normalizeSignal(signal: string | undefined): string | undefined {
  const normalized = signal?.trim();
  return normalized && normalized !== '0' ? normalized : undefined;
}

function stripControlSequences(value: string): string {
  return value
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, '')
    .replace(/\u001b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');
}

function summarizeLastLine(value: string): string {
  const normalized = stripControlSequences(value)
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const lastLine = normalized[normalized.length - 1];
  if (!lastLine) {
    return '';
  }

  return lastLine.length > 140 ? `${lastLine.slice(0, 140)}...` : lastLine;
}

function describeAgentExit(label: string, code: number, signal: string | undefined, output: string): string {
  const suffix = summarizeLastLine(output);
  if (signal) {
    return [`${label} 因信号 ${signal} 退出。`, suffix].filter(Boolean).join(' ');
  }

  return [`${label} 以退出码 ${code} 结束。`, suffix].filter(Boolean).join(' ');
}

function describeAgentResumeFailure(label: string, code: number, signal: string | undefined, output: string): string {
  const suffix = summarizeLastLine(output);
  if (signal) {
    return [`恢复 ${label} 时收到信号 ${signal}。`, suffix].filter(Boolean).join(' ');
  }

  return [`恢复 ${label} 时进程以退出码 ${code} 结束。`, suffix].filter(Boolean).join(' ');
}

function describeTerminalExit(shellPath: string, code: number, signal: string | undefined, output: string): string {
  const suffix = summarizeLastLine(output);
  if (signal) {
    return [`终端 ${shellPath} 因信号 ${signal} 退出。`, suffix].filter(Boolean).join(' ');
  }

  return [`终端 ${shellPath} 以退出码 ${code} 结束。`, suffix].filter(Boolean).join(' ');
}

function normalizeRecoveredAgentLifecycle(status: AgentNodeStatus): AgentNodeStatus {
  if (
    status === 'starting' ||
    status === 'running' ||
    status === 'waiting-input' ||
    status === 'resuming' ||
    status === 'stopping'
  ) {
    return 'stopped';
  }

  return status;
}

function isAgentResumePhaseActive(status: AgentNodeStatus): boolean {
  return status === 'starting' || status === 'resuming';
}

function isAgentLifecycleAwaitingInteractiveState(
  status: AgentNodeStatus | TerminalNodeStatus
): boolean {
  return status === 'starting' || status === 'resuming' || status === 'running';
}

function isAgentInstructionSubmission(data: string): boolean {
  return /[\r\n]/.test(data);
}

function normalizeRecoveredTerminalLifecycle(status: TerminalNodeStatus): TerminalNodeStatus {
  if (status === 'launching' || status === 'live' || status === 'stopping') {
    return 'closed';
  }

  return status;
}

function createErrorResponse(id: string, message: string): RuntimeSupervisorMessage {
  return {
    type: 'response',
    id,
    ok: false,
    error: {
      message
    }
  };
}

function ensureSocketDirectoryReady(paths: RuntimeSupervisorPaths): void {
  if (process.platform === 'win32') {
    return;
  }

  const socketDir = paths.controlDir ?? paths.runtimeDir ?? path.dirname(paths.socketPath);
  fs.mkdirSync(socketDir, {
    recursive: true,
    mode: shouldRestrictSocketDirectory(paths) ? 0o700 : undefined
  });

  if (shouldRestrictSocketDirectory(paths)) {
    try {
      fs.chmodSync(socketDir, 0o700);
    } catch {
      // Best effort only. Some remote filesystems do not allow chmod here.
    }
  }
}

function shouldRestrictSocketDirectory(paths: RuntimeSupervisorPaths): boolean {
  return paths.socketLocation === 'runtime-private' || paths.socketLocation === 'control-dir';
}

async function main(): Promise<void> {
  const storageDir = readCliPathFlag('--storage-dir');
  if (!storageDir) {
    throw new Error('runtime supervisor 启动失败：缺少 --storage-dir 参数。');
  }

  const resolvedPaths = resolveLegacyRuntimeSupervisorPathsFromStorageDir(storageDir);
  const socketPath = readCliFlag('--socket-path') ?? resolvedPaths.socketPath;
  const runtimeDir = readCliPathFlag('--runtime-dir') ?? resolvedPaths.runtimeDir;
  const controlDir = readCliPathFlag('--control-dir') ?? resolvedPaths.controlDir;
  const runtimeBackend = normalizeRuntimeHostBackend(readCliFlag('--runtime-backend'));
  const runtimeGuarantee = normalizeRuntimePersistenceGuarantee(readCliFlag('--runtime-guarantee'));
  const paths: RuntimeSupervisorPaths = {
    ...resolvedPaths,
    socketPath,
    runtimeDir,
    controlDir
  };
  const server = new RuntimeSupervisorServer(paths, runtimeBackend, runtimeGuarantee);
  await server.start();
}

function readCliFlag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) {
    return undefined;
  }

  const value = process.argv[index + 1];
  return value?.trim() || undefined;
}

function readCliPathFlag(name: string): string | undefined {
  const value = readCliFlag(name);
  return value ? path.resolve(value) : undefined;
}

function normalizeRuntimeHostBackend(value: unknown): RuntimeHostBackendKind {
  return value === 'systemd-user' ? 'systemd-user' : 'legacy-detached';
}

function normalizeRuntimePersistenceGuarantee(value: unknown): RuntimePersistenceGuarantee {
  return value === 'strong' ? 'strong' : 'best-effort';
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
