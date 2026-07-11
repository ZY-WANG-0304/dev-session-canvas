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
import {
  SerializedTerminalStateTracker,
  type SerializedTerminalState
} from '../common/serializedTerminalState';
import { DEFAULT_TERMINAL_SCROLLBACK, normalizeTerminalScrollback } from '../common/terminalScrollback';
import {
  TERMINAL_SESSION_STREAM_VERSION,
  buildTerminalStreamAttachPayload,
  normalizeTerminalStreamAttachPayload,
  normalizeTerminalStreamCheckpoint,
  normalizeTerminalStreamRevision,
  type TerminalStreamAttachPayload,
  type TerminalStreamCheckpoint,
  type TerminalStreamEvent
} from '../common/terminalSessionStream';
import {
  RUNTIME_SUPERVISOR_ERROR_CODES,
  deserializeExecutionSessionLaunchSpec,
  createRuntimeSupervisorProtocolError,
  formatRuntimeSupervisorMessageDescriptor,
  serializeRuntimeSupervisorError,
  type RuntimeSupervisorAttachSessionParams,
  type RuntimeSupervisorCreateSessionParams,
  type RuntimeSupervisorDeleteSessionParams,
  type RuntimeSupervisorEvent,
  type RuntimeSupervisorMessageDescriptor,
  type RuntimeSupervisorMessage,
  type RuntimeSupervisorPaths,
  type RuntimeSupervisorRequest,
  type RuntimeSupervisorResizeSessionParams,
  type RuntimeSupervisorSessionSnapshot,
  type RuntimeSupervisorStopSessionParams,
  type RuntimeSupervisorSubscribeSessionParams,
  type RuntimeSupervisorSubscribeSessionResult,
  type RuntimeSupervisorUpdateSessionScrollbackParams,
  type RuntimeSupervisorWriteInputParams
} from '../common/runtimeSupervisorProtocol';
import { TerminalSessionJournal } from './terminalSessionJournal';
import {
  createExecutionSessionProcess,
  type DisposableLike,
  type ExecutionSessionExitEvent,
  type ExecutionSessionProcess
} from '../panel/executionSessionBridge';
import {
  extractClaudeResumeSessionId,
  extractCodexResumeSessionId,
  locateClaudeSessionId,
  locateCodexSessionId
} from '../common/codexSessionIdLocator';
import { extractClaudeCommandRuntimeSessionFlag } from '../common/agentLaunchPresets';

const IDLE_SHUTDOWN_DELAY_MS = 30_000;
const TERMINAL_LIVE_DELAY_MS = 160;
const OUTPUT_TAIL_LIMIT = 6000;
const AGENT_GRACEFUL_STOP_INPUT = '\u0003';
// Codex/Claude can take a few extra seconds after Ctrl-C to flush token usage and resume hints.
// Give the CLI a longer grace window before we escalate to kill, so the stopped snapshot is authoritative.
const AGENT_GRACEFUL_STOP_FORCE_KILL_TIMEOUT_MS = 5000;

function normalizeRuntimeSupervisorOutputSequence(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}

function normalizeRuntimeSupervisorOptionalOutputSequence(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

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
  outputSequence: number;
  terminalAuthorityId?: string;
  terminalJournal?: TerminalSessionJournal;
  terminalJournalError?: Error;
  terminalCheckpoint?: TerminalStreamCheckpoint;
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
  lastExitMessageDescriptor?: RuntimeSupervisorMessageDescriptor;
  stopRequested: boolean;
  agentActivity?: AgentActivityHeuristicState;
  process?: ExecutionSessionProcess;
  outputSubscription?: DisposableLike;
  exitSubscription?: DisposableLike;
  lifecycleTimer?: NodeJS.Timeout;
}

type SupervisorSubscriptionMode = 'legacy' | 'terminal-stream-v1';

class RuntimeSupervisorServer {
  private readonly sessions = new Map<string, SupervisorSession>();
  private readonly connections = new Set<net.Socket>();
  private readonly subscriptions = new Map<net.Socket, Map<string, SupervisorSubscriptionMode>>();
  private readonly deferredSubscriptionRevisions = new Map<net.Socket, Map<string, number>>();
  private persistTimer: NodeJS.Timeout | undefined;
  private persistRegistryChain: Promise<void> = Promise.resolve();
  private persistRegistryError: Error | undefined;
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
    await this.loadRegistry();
    await this.listen();
    this.scheduleIdleShutdownIfNeeded();
  }

  private async listen(): Promise<void> {
    if (process.platform !== 'win32' && fs.existsSync(this.paths.socketPath)) {
      fs.unlinkSync(this.paths.socketPath);
    }

    this.server = net.createServer((socket) => {
      this.connections.add(socket);
      this.subscriptions.set(socket, new Map());
      this.deferredSubscriptionRevisions.set(socket, new Map());
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
            const message = error instanceof Error ? error.message : 'Invalid JSON message.';
            this.writeMessage(socket, createErrorResponse('parse-error', {
              id: 'parseError',
              params: {
                message
              }
            }, RUNTIME_SUPERVISOR_ERROR_CODES.parseError));
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
              runtimeGuarantee: this.runtimeGuarantee,
              capabilities: {
                terminalSessionStreamV1: true
              }
            }
          });
          return;
        case 'createSession': {
          const snapshot = await this.createSession(socket, request.params);
          this.writeMessage(socket, {
            type: 'response',
            id: request.id,
            ok: true,
            result: snapshot
          });
          return;
        }
        case 'attachSession': {
          const snapshot = await this.attachSession(socket, request.params);
          this.writeMessage(socket, {
            type: 'response',
            id: request.id,
            ok: true,
            result: snapshot
          });
          return;
        }
        case 'subscribeSession': {
          const result = this.subscribeSession(socket, request.params);
          this.writeMessage(socket, {
            type: 'response',
            id: request.id,
            ok: true,
            result
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
          await this.deleteSession(request.params);
          this.writeOkResponse(socket, request.id);
          return;
      }
    } catch (error) {
      this.writeMessage(socket, {
        type: 'response',
        id: request.id,
        ok: false,
        error: serializeRuntimeSupervisorError(error)
      });
    }
  }

  private async createSession(
    socket: net.Socket,
    params: RuntimeSupervisorCreateSessionParams
  ): Promise<RuntimeSupervisorSessionSnapshot> {
    const sessionId = params.sessionId?.trim() || randomUUID();
    if (this.sessions.has(sessionId)) {
      throw createRuntimeSupervisorProtocolError({
        id: 'sessionAlreadyExists',
        params: {
          sessionId
        }
      }, RUNTIME_SUPERVISOR_ERROR_CODES.sessionAlreadyExists);
    }

    const lifecycle: AgentNodeStatus | TerminalNodeStatus =
      params.kind === 'agent'
        ? params.launchMode === 'resume'
          ? 'resuming'
          : 'starting'
        : 'launching';
    const launchSpec = deserializeExecutionSessionLaunchSpec(params.launchSpec);
    const explicitClaudeSessionFlag =
      params.kind === 'agent' && params.provider === 'claude' && params.launchMode === 'start'
        ? extractClaudeCommandRuntimeSessionFlag(launchSpec.args ?? [])
        : null;
    const initialResumeSessionId = explicitClaudeSessionFlag
      ? explicitClaudeSessionFlag.sessionId
      : params.resumeSessionId;
    const startedAtMs = Date.now();
    const scrollback = normalizeTerminalScrollback(params.scrollback, DEFAULT_TERMINAL_SCROLLBACK);
    const terminalJournal = await TerminalSessionJournal.create({
      storageDir: this.paths.storageDir,
      sessionId,
      initialCols: params.launchSpec.cols,
      initialRows: params.launchSpec.rows,
      initialScrollback: scrollback
    });
    let process: ExecutionSessionProcess;
    try {
      process = createExecutionSessionProcess(launchSpec);
    } catch (error) {
      await terminalJournal.delete();
      throw error;
    }
    const terminalStateTracker = new SerializedTerminalStateTracker(params.launchSpec.cols, params.launchSpec.rows, {
      scrollback,
      initialOutputSequence: 0
    });
    const initialSerializedState = terminalStateTracker.getSerializedState();
    const terminalCheckpoint: TerminalStreamCheckpoint = {
      version: TERMINAL_SESSION_STREAM_VERSION,
      sessionId,
      authorityId: terminalJournal.getAuthorityId(),
      revision: 0,
      cols: params.launchSpec.cols,
      rows: params.launchSpec.rows,
      scrollback,
      createdAtMs: Date.now(),
      serializedState: initialSerializedState
    };
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
      outputSequence: 0,
      terminalAuthorityId: terminalJournal.getAuthorityId(),
      terminalJournal,
      terminalCheckpoint,
      terminalStateTracker,
      displayLabel: params.displayLabel,
      launchMode: params.launchMode,
      provider: params.provider,
      resumeStrategy: params.resumeStrategy,
      resumeSessionId: initialResumeSessionId,
      resumeStoragePath: params.resumeStoragePath,
      stopRequested: false,
      agentActivity: params.kind === 'agent' ? createAgentActivityHeuristicState() : undefined,
      process
    };
    this.sessions.set(sessionId, session);
    if (params.deferSubscription !== true) {
      this.subscribeSocket(socket, sessionId, 'legacy');
    }
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
      session.launchMode === 'start' &&
      (
        (session.provider === 'codex' && !session.resumeSessionId) ||
        (
          session.provider === 'claude' &&
          Boolean(session.resumeSessionId?.trim()) &&
          session.resumeStrategy !== 'claude-session-id'
        )
      )
    ) {
      void this.maybeDiscoverAgentResumeSessionIdFromFiles(session.sessionId, 'startup');
    }

    this.schedulePersist();
    const snapshot = await this.toFreshSnapshot(session);
    if (params.deferSubscription === true && snapshot.terminalStream) {
      this.deferSocketSubscription(socket, sessionId, snapshot.terminalStream.revision);
    }
    return snapshot;
  }

  private async attachSession(
    socket: net.Socket,
    params: RuntimeSupervisorAttachSessionParams
  ): Promise<RuntimeSupervisorSessionSnapshot> {
    const session = this.sessions.get(params.sessionId);
    if (!session) {
      throw createRuntimeSupervisorProtocolError({
        id: 'sessionNotFound',
        params: {
          sessionId: params.sessionId
        }
      }, RUNTIME_SUPERVISOR_ERROR_CODES.sessionNotFound);
    }

    if (params.deferSubscription === true && session.terminalJournal && session.terminalCheckpoint) {
      this.subscriptions.get(socket)?.delete(params.sessionId);
      const snapshot = this.toSnapshot(session);
      if (snapshot.terminalStream) {
        this.deferSocketSubscription(socket, params.sessionId, snapshot.terminalStream.revision);
      }
      return snapshot;
    }

    this.clearDeferredSubscription(socket, params.sessionId);
    this.subscribeSocket(socket, params.sessionId, 'legacy');
    return this.toFreshSnapshot(session);
  }

  private subscribeSession(
    socket: net.Socket,
    params: RuntimeSupervisorSubscribeSessionParams
  ): RuntimeSupervisorSubscribeSessionResult {
    const session = this.requireSession(params.sessionId);
    const journal = session.terminalJournal;
    if (session.terminalJournalError || !journal || !session.terminalAuthorityId || !session.terminalCheckpoint) {
      throw createRuntimeSupervisorProtocolError({
        id: 'terminalJournalUnavailable',
        params: {
          sessionId: params.sessionId
        }
      }, RUNTIME_SUPERVISOR_ERROR_CODES.terminalJournalUnavailable);
    }
    if (params.authorityId !== session.terminalAuthorityId) {
      throw createRuntimeSupervisorProtocolError({
        id: 'terminalAuthorityMismatch',
        params: {
          sessionId: params.sessionId
        }
      }, RUNTIME_SUPERVISOR_ERROR_CODES.terminalAuthorityMismatch);
    }
    const afterRevision = normalizeTerminalStreamRevision(params.afterRevision);
    if (afterRevision === undefined || afterRevision > journal.getRevision()) {
      throw createRuntimeSupervisorProtocolError({
        id: 'terminalRevisionInvalid',
        params: {
          sessionId: params.sessionId,
          revision: String(params.afterRevision)
        }
      }, RUNTIME_SUPERVISOR_ERROR_CODES.terminalRevisionInvalid);
    }
    const deferredRevision = this.deferredSubscriptionRevisions.get(socket)?.get(params.sessionId);
    if (deferredRevision !== undefined && deferredRevision !== afterRevision) {
      throw createRuntimeSupervisorProtocolError({
        id: 'terminalRevisionInvalid',
        params: {
          sessionId: params.sessionId,
          revision: String(params.afterRevision)
        }
      }, RUNTIME_SUPERVISOR_ERROR_CODES.terminalRevisionInvalid);
    }

    const replayEvents = journal.getEventsAfter(afterRevision);
    this.subscribeSocket(socket, params.sessionId, 'terminal-stream-v1');
    for (const event of replayEvents) {
      this.writeTerminalStreamEvent(socket, session, event);
    }
    this.writeMessage(socket, {
      type: 'event',
      event: 'sessionState',
      payload: this.toSnapshot(session)
    });
    this.clearDeferredSubscription(socket, params.sessionId);
    this.releaseTerminalJournalMemoryThroughCheckpoint(session);
    return {
      sessionId: session.sessionId,
      authorityId: session.terminalAuthorityId,
      revision: journal.getRevision()
    };
  }

  private writeInput(params: RuntimeSupervisorWriteInputParams): void {
    const session = this.requireLiveSession(params.sessionId);
    if (session.kind === 'agent' && session.provider === 'claude' && containsTerminalSuspendInput(params.data)) {
      throw createRuntimeSupervisorProtocolError({
        id: 'claudeAgentCtrlZUnsupported'
      }, RUNTIME_SUPERVISOR_ERROR_CODES.claudeCtrlZUnsupported);
    }

    if (session.kind === 'agent' && session.lifecycle === 'suspended') {
      throw createRuntimeSupervisorProtocolError({
        id: 'claudeCodeSuspended'
      }, RUNTIME_SUPERVISOR_ERROR_CODES.claudeSuspended);
    }

    if (session.kind === 'agent') {
      const submittedInstruction = isAgentInstructionSubmission(params.data);
      if (session.lifecycleTimer) {
        clearTimeout(session.lifecycleTimer);
        session.lifecycleTimer = undefined;
      }
      if (submittedInstruction) {
        resetAgentActivityHeuristics(this.ensureAgentActivityState(session), session.output);
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
    let terminalEvent: TerminalStreamEvent | undefined;
    try {
      terminalEvent = session.terminalJournal?.appendResize(params.cols, params.rows);
    } catch (error) {
      this.failSessionForTerminalJournal(session, error);
      throw error;
    }
    if (terminalEvent) {
      session.outputSequence = terminalEvent.revision;
    }
    session.cols = params.cols;
    session.rows = params.rows;
    session.terminalStateTracker.resize(params.cols, params.rows, {
      outputSequence: terminalEvent?.revision
    });
    if (session.live) {
      session.process?.resize(params.cols, params.rows);
    }
    if (terminalEvent) {
      this.emitTerminalStreamEvent(session, terminalEvent);
    }
    this.emitSessionState(session);
  }

  private async updateSessionScrollback(params: RuntimeSupervisorUpdateSessionScrollbackParams): Promise<void> {
    const session = this.requireLiveSession(params.sessionId);
    const scrollback = normalizeTerminalScrollback(params.scrollback, DEFAULT_TERMINAL_SCROLLBACK);
    if (session.scrollback === scrollback) {
      return;
    }

    let terminalEvent: TerminalStreamEvent | undefined;
    try {
      terminalEvent = session.terminalJournal?.appendScrollback(scrollback);
    } catch (error) {
      this.failSessionForTerminalJournal(session, error);
      throw error;
    }
    if (terminalEvent) {
      session.outputSequence = terminalEvent.revision;
    }
    session.scrollback = scrollback;
    await session.terminalStateTracker.setScrollback(scrollback, {
      outputSequence: terminalEvent?.revision
    });
    if (terminalEvent) {
      this.emitTerminalStreamEvent(session, terminalEvent);
    }
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
    if (session.kind === 'agent') {
      if (session.provider === 'claude') {
        session.process?.kill();
        return;
      }
      this.requestGracefulAgentStop(session);
      return;
    }

    session.process?.kill();
  }

  private async deleteSession(params: RuntimeSupervisorDeleteSessionParams): Promise<void> {
    const session = this.requireSession(params.sessionId);
    const wasLive = session.live;
    if (wasLive) {
      session.stopRequested = true;
      session.lifecycle = session.kind === 'agent' ? 'stopped' : 'closed';
      setSessionLastExitMessage(session, {
        id: session.kind === 'agent' ? 'agentSessionDeleted' : 'terminalSessionDeleted'
      });
    }
    session.live = false;
    if (session.terminalJournalError) {
      this.emitSessionState(session);
    } else {
      await this.emitFreshSessionState(session);
    }
    this.disposeSession(session, {
      terminateProcess: wasLive
    });
    await session.terminalJournal?.delete();
    this.clearSessionSubscriptions(params.sessionId);
    this.sessions.delete(params.sessionId);
    this.schedulePersist();
    this.scheduleIdleShutdownIfNeeded();
  }

  private bindSessionProcess(session: SupervisorSession): void {
    session.outputSubscription = session.process?.onData((chunk) => {
      if (!chunk) {
        return;
      }

      let terminalEvent: TerminalStreamEvent | undefined;
      try {
        terminalEvent = session.terminalJournal?.appendOutput(chunk);
      } catch (error) {
        this.failSessionForTerminalJournal(session, error);
        return;
      }
      session.outputSequence = terminalEvent?.revision ?? session.outputSequence + 1;
      session.output = appendOutputTail(session.output, chunk);
      session.terminalStateTracker.write(chunk, {
        outputSequence: session.outputSequence
      });
      if (session.kind === 'agent') {
        this.maybeSyncAgentResumeSessionIdFromOutput(session, {
          allowOverwriteExisting: session.stopRequested,
          emitState: session.stopRequested
        });
      }
      if (session.kind === 'agent') {
        if (
          session.lifecycle === 'starting' ||
          session.lifecycle === 'resuming' ||
          session.lifecycle === 'running'
        ) {
          recordAgentOutputHeuristics(this.ensureAgentActivityState(session), chunk, session.output, session.provider);
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

      this.emitSessionOutput(session, chunk, terminalEvent);
      this.schedulePersist();
    });

    session.exitSubscription = session.process?.onExit(({ exitCode, signal }: ExecutionSessionExitEvent) => {
      void this.finalizeSession(session.sessionId, exitCode, signal).catch((error) => {
        const current = this.sessions.get(session.sessionId);
        if (current) {
          this.failSessionForTerminalJournal(current, error);
        }
      });
    });
  }

  private failSessionForTerminalJournal(session: SupervisorSession, error: unknown): void {
    if (session.terminalJournalError) {
      return;
    }

    const normalizedError = error instanceof Error ? error : new Error(String(error));
    session.terminalJournalError = normalizedError;
    console.error(`Terminal journal failed for session ${session.sessionId}:`, normalizedError);
    session.live = false;
    session.lifecycle = 'error';
    setSessionLastExitMessage(session, {
      id: 'terminalJournalPersistenceFailed',
      params: {
        sessionId: session.sessionId
      }
    });
    this.disposeSession(session, { terminateProcess: true });
    this.emitSessionState(session);
    this.scheduleIdleShutdownIfNeeded();
  }

  private async finalizeSession(sessionId: string, exitCode: number, signal?: string): Promise<void> {
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
      this.finalizeAgentResumeSessionIdFromOutput(session);
      if (session.stopRequested) {
        session.lifecycle = 'stopped';
        setSessionLastExitMessage(session, {
          id: 'agentSessionStopped',
          params: {
            label: session.displayLabel
          }
        });
      } else if (exitCode === 0) {
        session.lifecycle = 'stopped';
        setSessionLastExitMessage(session, {
          id: 'agentSessionEnded',
          params: {
            label: session.displayLabel
          }
        });
      } else if (session.resumePhaseActive) {
        session.lifecycle = 'resume-failed';
        setSessionLastExitMessage(
          session,
          describeAgentResumeFailure(session.displayLabel, exitCode, signal, session.output)
        );
      } else {
        session.lifecycle = 'error';
        setSessionLastExitMessage(session, describeAgentExit(session.displayLabel, exitCode, signal, session.output));
      }
    } else if (session.stopRequested) {
      session.lifecycle = 'closed';
      setSessionLastExitMessage(session, {
        id: 'terminalStopped'
      });
    } else if (exitCode === 0) {
      session.lifecycle = 'closed';
      setSessionLastExitMessage(session, {
        id: 'terminalSessionEnded'
      });
    } else {
      session.lifecycle = 'error';
      setSessionLastExitMessage(session, describeTerminalExit(session.shellPath, exitCode, signal, session.output));
    }

    session.lastExitCode = exitCode;
    session.lastExitSignal = normalizeSignal(signal);
    await this.emitFreshSessionState(session);
    this.schedulePersist();
    this.scheduleIdleShutdownIfNeeded();
  }

  private async maybeDiscoverAgentResumeSessionIdFromFiles(
    sessionId: string,
    trigger: 'startup' | 'waiting-input'
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session || session.kind !== 'agent') {
      return;
    }

    if (session.provider === 'codex') {
      await this.maybeDiscoverCodexResumeSessionId(sessionId, trigger);
      return;
    }

    if (session.provider === 'claude') {
      await this.maybeConfirmClaudeResumeSessionId(sessionId, trigger);
    }
  }

  private async maybeDiscoverCodexResumeSessionId(
    sessionId: string,
    _trigger: 'startup' | 'waiting-input'
  ): Promise<void> {
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

  private async maybeConfirmClaudeResumeSessionId(
    sessionId: string,
    _trigger: 'startup' | 'waiting-input'
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (
      !session ||
      session.kind !== 'agent' ||
      session.provider !== 'claude' ||
      session.launchMode !== 'start' ||
      session.resumeStrategy === 'claude-session-id' ||
      !session.resumeSessionId?.trim()
    ) {
      return;
    }

    const candidateSessionId = session.resumeSessionId.trim();
    const confirmedSessionId = await locateClaudeSessionId({
      cwd: session.cwd,
      sessionId: candidateSessionId
    });

    const current = this.sessions.get(sessionId);
    if (
      !current ||
      current.kind !== 'agent' ||
      current.provider !== 'claude' ||
      current.launchMode !== 'start' ||
      !current.live ||
      current.resumeStrategy === 'claude-session-id' ||
      current.resumeSessionId?.trim() !== candidateSessionId ||
      !confirmedSessionId
    ) {
      return;
    }

    current.resumeStrategy = 'claude-session-id';
    current.resumeSessionId = confirmedSessionId;
    this.emitSessionState(current);
  }

  private readAgentResumeHint(
    session: Pick<SupervisorSession, 'kind' | 'provider' | 'launchMode' | 'output'>
  ): { strategy: AgentResumeStrategy; sessionId: string } | null {
    if (session.kind !== 'agent' || session.launchMode !== 'start') {
      return null;
    }

    if (session.provider === 'codex') {
      const sessionId = extractCodexResumeSessionId(session.output);
      return sessionId
        ? {
            strategy: 'codex-session-id',
            sessionId
          }
        : null;
    }

    if (session.provider === 'claude') {
      const sessionId = extractClaudeResumeSessionId(session.output);
      return sessionId
        ? {
            strategy: 'claude-session-id',
            sessionId
          }
        : null;
    }

    return null;
  }

  private maybeSyncAgentResumeSessionIdFromOutput(
    session: SupervisorSession,
    options: { allowOverwriteExisting?: boolean; emitState?: boolean } = {}
  ): boolean {
    const discoveredResumeHint = this.readAgentResumeHint(session);
    if (!discoveredResumeHint) {
      return false;
    }

    const previousSessionId = session.resumeSessionId?.trim() ?? '';
    const previousStrategy = session.resumeStrategy ?? 'none';
    if (
      previousStrategy === discoveredResumeHint.strategy &&
      previousSessionId === discoveredResumeHint.sessionId
    ) {
      return false;
    }

    const hasConfirmedPreviousSessionId = previousStrategy !== 'none' && Boolean(previousSessionId);
    if (hasConfirmedPreviousSessionId && options.allowOverwriteExisting !== true) {
      return false;
    }

    session.resumeStrategy = discoveredResumeHint.strategy;
    session.resumeSessionId = discoveredResumeHint.sessionId;
    if (options.emitState !== false) {
      this.emitSessionState(session);
    }
    return true;
  }

  private finalizeAgentResumeSessionIdFromOutput(session: SupervisorSession): void {
    const discoveredResumeHint = this.readAgentResumeHint(session);
    if (discoveredResumeHint) {
      session.resumeStrategy = discoveredResumeHint.strategy;
      session.resumeSessionId = discoveredResumeHint.sessionId;
      return;
    }

    if (session.kind !== 'agent' || session.provider !== 'claude' || session.launchMode !== 'start') {
      return;
    }

    if (session.resumeStrategy === 'claude-session-id' && session.resumeSessionId?.trim()) {
      return;
    }

    session.resumeStrategy = 'none';
    session.resumeSessionId = undefined;
  }

  private requestGracefulAgentStop(session: SupervisorSession): void {
    try {
      session.process?.write(AGENT_GRACEFUL_STOP_INPUT);
    } catch {
      session.process?.kill();
      return;
    }

    session.lifecycleTimer = setTimeout(() => {
      const current = this.sessions.get(session.sessionId);
      if (!current || current !== session || !current.live || !current.stopRequested) {
        return;
      }

      current.lifecycleTimer = undefined;
      current.process?.kill();
    }, AGENT_GRACEFUL_STOP_FORCE_KILL_TIMEOUT_MS);
  }

  private emitSessionOutput(
    session: SupervisorSession,
    chunk: string,
    terminalEvent?: TerminalStreamEvent
  ): void {
    const legacyMessage: RuntimeSupervisorEvent = {
      type: 'event',
      event: 'sessionOutput',
      payload: {
        sessionId: session.sessionId,
        kind: session.kind,
        chunk,
        outputSequence: session.outputSequence,
        terminalAuthorityId: session.terminalAuthorityId,
        terminalRevision: terminalEvent?.revision
      }
    };
    for (const [socket, subscriptions] of this.subscriptions.entries()) {
      const mode = subscriptions.get(session.sessionId);
      if (!mode || socket.destroyed) {
        continue;
      }
      if (mode === 'terminal-stream-v1' && terminalEvent) {
        this.writeTerminalStreamEvent(socket, session, terminalEvent);
      } else {
        this.writeMessage(socket, legacyMessage);
      }
    }
  }

  private emitTerminalStreamEvent(session: SupervisorSession, event: TerminalStreamEvent): void {
    for (const [socket, subscriptions] of this.subscriptions.entries()) {
      if (subscriptions.get(session.sessionId) !== 'terminal-stream-v1' || socket.destroyed) {
        continue;
      }
      this.writeTerminalStreamEvent(socket, session, event);
    }
  }

  private writeTerminalStreamEvent(socket: net.Socket, session: SupervisorSession, event: TerminalStreamEvent): void {
    this.writeMessage(socket, {
      type: 'event',
      event: 'sessionTerminalEvent',
      payload: {
        sessionId: session.sessionId,
        kind: session.kind,
        authorityId: session.terminalAuthorityId ?? '',
        event
      }
    });
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

  private async emitFreshSessionState(session: SupervisorSession): Promise<void> {
    const message: RuntimeSupervisorEvent = {
      type: 'event',
      event: 'sessionState',
      payload: await this.toFreshSnapshot(session)
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
        void this.maybeDiscoverAgentResumeSessionIdFromFiles(sessionId, 'waiting-input');
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

  private async toFreshSnapshot(session: SupervisorSession): Promise<RuntimeSupervisorSessionSnapshot> {
    if (session.terminalJournalError && session.live) {
      throw session.terminalJournalError;
    }
    // Pin terminal geometry to the same event-loop cut as the tracker flush. Any
    // later resize/scrollback change remains in the journal after this checkpoint.
    const checkpointCols = session.cols;
    const checkpointRows = session.rows;
    const checkpointScrollback = session.scrollback;
    const serializedTerminalState = await session.terminalStateTracker.flush().catch(() => undefined);
    if (
      serializedTerminalState &&
      session.terminalJournal &&
      session.terminalAuthorityId &&
      !session.terminalJournalError
    ) {
      await session.terminalJournal.flush();
      const checkpointRevision = normalizeTerminalStreamRevision(serializedTerminalState.outputSequence);
      if (checkpointRevision !== undefined && checkpointRevision <= session.terminalJournal.getRevision()) {
        const checkpoint = normalizeTerminalStreamCheckpoint({
          version: TERMINAL_SESSION_STREAM_VERSION,
          sessionId: session.sessionId,
          authorityId: session.terminalAuthorityId,
          revision: checkpointRevision,
          cols: checkpointCols,
          rows: checkpointRows,
          scrollback: checkpointScrollback,
          createdAtMs: Date.now(),
          serializedState: serializedTerminalState
        });
        if (checkpoint) {
          session.terminalCheckpoint = checkpoint;
          this.releaseTerminalJournalMemoryThroughCheckpoint(session);
        }
      }
    }
    return this.toSnapshot(session, serializedTerminalState);
  }

  private getFreshSerializedTerminalState(
    session: SupervisorSession,
    serializedTerminalState: SerializedTerminalState | undefined
  ): SerializedTerminalState | undefined {
    const stateOutputSequence = normalizeRuntimeSupervisorOptionalOutputSequence(
      serializedTerminalState?.outputSequence
    );
    return stateOutputSequence !== undefined && stateOutputSequence === session.outputSequence
      ? serializedTerminalState
      : undefined;
  }

  private toSnapshot(
    session: SupervisorSession,
    serializedTerminalState = session.terminalStateTracker.getSerializedState()
  ): RuntimeSupervisorSessionSnapshot {
    const terminalStream = this.buildTerminalStreamAttachPayload(session);
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
      outputSequence: session.outputSequence,
      serializedTerminalState: this.getFreshSerializedTerminalState(session, serializedTerminalState),
      terminalAuthorityId: session.terminalJournalError ? undefined : session.terminalAuthorityId,
      terminalRevision: session.terminalJournalError ? undefined : session.terminalJournal?.getRevision(),
      terminalStream,
      displayLabel: session.displayLabel,
      launchMode: session.launchMode,
      provider: session.provider,
      resumeStrategy: session.resumeStrategy,
      resumeSessionId: session.resumeSessionId,
      resumeStoragePath: session.resumeStoragePath,
      lastExitCode: session.lastExitCode,
      lastExitSignal: session.lastExitSignal,
      lastExitMessage: session.lastExitMessage,
      lastExitMessageDescriptor: session.lastExitMessageDescriptor,
    };
  }

  private buildTerminalStreamAttachPayload(session: SupervisorSession): TerminalStreamAttachPayload | undefined {
    if (session.terminalJournalError) {
      return undefined;
    }
    const journal = session.terminalJournal;
    const checkpoint = session.terminalCheckpoint;
    if (!journal || !checkpoint || checkpoint.authorityId !== journal.getAuthorityId()) {
      return undefined;
    }
    try {
      return buildTerminalStreamAttachPayload({
        sessionId: session.sessionId,
        authorityId: journal.getAuthorityId(),
        revision: journal.getRevision(),
        checkpoint,
        events: journal.getEventsAfter(checkpoint.revision)
      });
    } catch {
      return undefined;
    }
  }

  private requireSession(sessionId: string): SupervisorSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw createRuntimeSupervisorProtocolError({
        id: 'sessionNotFound',
        params: {
          sessionId
        }
      }, RUNTIME_SUPERVISOR_ERROR_CODES.sessionNotFound);
    }

    return session;
  }

  private requireLiveSession(sessionId: string): SupervisorSession {
    const session = this.requireSession(sessionId);
    if (!session.live || !session.process) {
      throw createRuntimeSupervisorProtocolError({
        id: 'sessionNotLive',
        params: {
          sessionId
        }
      }, RUNTIME_SUPERVISOR_ERROR_CODES.sessionNotLive);
    }

    return session;
  }

  private subscribeSocket(socket: net.Socket, sessionId: string, mode: SupervisorSubscriptionMode): void {
    const subscriptions = this.subscriptions.get(socket);
    if (!subscriptions) {
      return;
    }

    subscriptions.set(sessionId, mode);
  }

  private deferSocketSubscription(socket: net.Socket, sessionId: string, revision: number): void {
    this.subscriptions.get(socket)?.delete(sessionId);
    this.deferredSubscriptionRevisions.get(socket)?.set(sessionId, revision);
  }

  private clearDeferredSubscription(socket: net.Socket, sessionId: string): void {
    this.deferredSubscriptionRevisions.get(socket)?.delete(sessionId);
  }

  private clearSessionSubscriptions(sessionId: string): void {
    for (const subscriptions of this.subscriptions.values()) {
      subscriptions.delete(sessionId);
    }
    for (const deferredRevisions of this.deferredSubscriptionRevisions.values()) {
      deferredRevisions.delete(sessionId);
    }
  }

  private releaseTerminalJournalMemoryThroughCheckpoint(session: SupervisorSession): void {
    const journal = session.terminalJournal;
    const checkpoint = session.terminalCheckpoint;
    if (!journal || !checkpoint) {
      return;
    }

    let releaseRevision = checkpoint.revision;
    for (const deferredRevisions of this.deferredSubscriptionRevisions.values()) {
      const deferredRevision = deferredRevisions.get(session.sessionId);
      if (deferredRevision !== undefined) {
        releaseRevision = Math.min(releaseRevision, deferredRevision);
      }
    }
    journal.releaseMemoryThrough(releaseRevision);
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
    const deferredSessionIds = Array.from(this.deferredSubscriptionRevisions.get(socket)?.keys() ?? []);
    this.connections.delete(socket);
    this.subscriptions.delete(socket);
    this.deferredSubscriptionRevisions.delete(socket);
    for (const sessionId of deferredSessionIds) {
      const session = this.sessions.get(sessionId);
      if (session) {
        this.releaseTerminalJournalMemoryThroughCheckpoint(session);
      }
    }
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
      this.persistRegistryChain = this.persistRegistryChain.then(async () => {
        try {
          await this.persistRegistry();
          this.persistRegistryError = undefined;
        } catch (error) {
          this.persistRegistryError = error instanceof Error ? error : new Error(String(error));
          console.error('Failed to persist runtime supervisor registry:', this.persistRegistryError);
        }
      });
    }, 120);
  }

  private async persistRegistry(): Promise<void> {
    const sessionEntries = Array.from(this.sessions.values());
    const snapshots = await Promise.all(
      sessionEntries.map(async (session) => {
        let snapshot: RuntimeSupervisorSessionSnapshot;
        try {
          snapshot = await this.toFreshSnapshot(session);
        } catch (error) {
          if (!session.terminalJournal) {
            throw error;
          }
          this.failSessionForTerminalJournal(session, error);
          snapshot = this.toSnapshot(session);
        }
        return this.sessions.get(session.sessionId) === session ? snapshot : undefined;
      })
    );
    const registry: SupervisorRegistry = {
      version: 1,
      sessions: snapshots.filter((snapshot): snapshot is RuntimeSupervisorSessionSnapshot => snapshot !== undefined)
    };
    const tempPath = `${this.paths.registryPath}.${process.pid}.${randomUUID()}.tmp`;
    await fs.promises.writeFile(tempPath, JSON.stringify(registry, null, 2), {
      encoding: 'utf8',
      mode: 0o600
    });
    await fs.promises.rename(tempPath, this.paths.registryPath);
  }

  private async flushRegistryBeforeShutdown(): Promise<void> {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = undefined;
    }
    await this.persistRegistryChain;
    await this.persistRegistry();
    this.persistRegistryError = undefined;
  }

  private async loadRegistry(): Promise<void> {
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
      this.sessions.set(rawSession.sessionId, await this.normalizeRecoveredSession(rawSession));
    }
  }

  private async normalizeRecoveredSession(snapshot: RuntimeSupervisorSessionSnapshot): Promise<SupervisorSession> {
    let lifecycle =
      snapshot.kind === 'agent'
        ? normalizeRecoveredAgentLifecycle(snapshot.lifecycle as AgentNodeStatus)
        : normalizeRecoveredTerminalLifecycle(snapshot.lifecycle as TerminalNodeStatus);
    const recoveryDescriptor: RuntimeSupervisorMessageDescriptor = {
      id: 'recoveredHistoryOnly'
    };
    let lastExitMessageDescriptor = snapshot.lastExitMessageDescriptor ?? (
      snapshot.lastExitMessage ? undefined : recoveryDescriptor
    );
    let lastExitMessage =
      snapshot.lastExitMessage ||
      formatRuntimeSupervisorMessageDescriptor(recoveryDescriptor);
    const scrollback = normalizeTerminalScrollback(snapshot.scrollback, DEFAULT_TERMINAL_SCROLLBACK);

    const normalizedTerminalStream = normalizeTerminalStreamAttachPayload(snapshot.terminalStream);
    const recoveredAuthorityId = normalizedTerminalStream?.authorityId ?? snapshot.terminalAuthorityId?.trim();
    let terminalJournal: TerminalSessionJournal | undefined;
    let terminalJournalError: Error | undefined;
    let terminalStateTracker: SerializedTerminalStateTracker | undefined;
    let terminalCheckpoint: TerminalStreamCheckpoint | undefined;
    let recoveredOutputSequence = normalizeRuntimeSupervisorOutputSequence(snapshot.outputSequence);
    let recoveredOutput = snapshot.output;
    let recoveredCols = snapshot.cols;
    let recoveredRows = snapshot.rows;
    let recoveredScrollback = scrollback;
    if (recoveredAuthorityId) {
      try {
        terminalJournal = await TerminalSessionJournal.open({
          storageDir: this.paths.storageDir,
          sessionId: snapshot.sessionId,
          authorityId: recoveredAuthorityId
        });
        const checkpoint =
          normalizedTerminalStream?.sessionId === snapshot.sessionId &&
          normalizedTerminalStream.authorityId === recoveredAuthorityId &&
          normalizedTerminalStream.checkpoint.revision <= terminalJournal.getRevision()
            ? normalizedTerminalStream.checkpoint
            : undefined;
        const initialTerminalState = terminalJournal.getInitialTerminalState();
        terminalStateTracker = checkpoint
          ? new SerializedTerminalStateTracker(checkpoint.cols, checkpoint.rows, {
              scrollback: checkpoint.scrollback,
              initialState: checkpoint.serializedState,
              initialOutputSequence: checkpoint.revision
            })
          : new SerializedTerminalStateTracker(initialTerminalState.cols, initialTerminalState.rows, {
              scrollback: initialTerminalState.scrollback,
              initialOutputSequence: 0
            });
        const fallbackCheckpoint =
          checkpoint ??
          normalizeTerminalStreamCheckpoint({
            version: TERMINAL_SESSION_STREAM_VERSION,
            sessionId: snapshot.sessionId,
            authorityId: recoveredAuthorityId,
            revision: 0,
            cols: initialTerminalState.cols,
            rows: initialTerminalState.rows,
            scrollback: initialTerminalState.scrollback,
            createdAtMs: Date.now(),
            serializedState: terminalStateTracker.getSerializedState()
          });
        if (!fallbackCheckpoint) {
          throw new Error(`Could not create a fallback terminal checkpoint for session ${snapshot.sessionId}.`);
        }
        recoveredCols = checkpoint?.cols ?? initialTerminalState.cols;
        recoveredRows = checkpoint?.rows ?? initialTerminalState.rows;
        recoveredScrollback = checkpoint?.scrollback ?? initialTerminalState.scrollback;
        const allEvents = await terminalJournal.readAllEvents();
        recoveredOutput = appendOutputTail(
          '',
          allEvents.map((event) => event.type === 'output' ? event.data : '').join('')
        );
        for (const event of allEvents) {
          if (event.revision <= (checkpoint?.revision ?? 0)) {
            continue;
          }
          if (event.type === 'output') {
            terminalStateTracker.write(event.data, {
              outputSequence: event.revision
            });
            continue;
          }
          if (event.type === 'resize') {
            recoveredCols = event.cols;
            recoveredRows = event.rows;
            terminalStateTracker.resize(event.cols, event.rows, {
              outputSequence: event.revision
            });
            continue;
          }
          recoveredScrollback = event.scrollback;
          await terminalStateTracker.setScrollback(event.scrollback, {
            outputSequence: event.revision
          });
        }
        const recoveredState = await terminalStateTracker.flush();
        recoveredOutputSequence = terminalJournal.getRevision();
        terminalCheckpoint = normalizeTerminalStreamCheckpoint({
          version: TERMINAL_SESSION_STREAM_VERSION,
          sessionId: snapshot.sessionId,
          authorityId: recoveredAuthorityId,
          revision: recoveredOutputSequence,
          cols: recoveredCols,
          rows: recoveredRows,
          scrollback: recoveredScrollback,
          createdAtMs: Date.now(),
          serializedState: recoveredState
        }) ?? fallbackCheckpoint;
        terminalJournal.releaseMemoryThrough(terminalCheckpoint.revision);
      } catch (error) {
        terminalJournalError = error instanceof Error ? error : new Error(String(error));
        console.error(`Failed to recover terminal journal for session ${snapshot.sessionId}:`, terminalJournalError);
        terminalJournal = undefined;
        terminalStateTracker?.dispose();
        terminalStateTracker = undefined;
        recoveredOutput = '';
        recoveredOutputSequence = 0;
        lifecycle = 'error';
        lastExitMessageDescriptor = {
          id: 'terminalJournalPersistenceFailed',
          params: {
            sessionId: snapshot.sessionId
          }
        };
        lastExitMessage = formatRuntimeSupervisorMessageDescriptor(lastExitMessageDescriptor);
      }
    }
    if (!terminalJournal || !terminalCheckpoint) {
      terminalStateTracker = new SerializedTerminalStateTracker(snapshot.cols, snapshot.rows, {
        scrollback,
        initialState: recoveredAuthorityId ? undefined : snapshot.serializedTerminalState,
        initialOutput: recoveredAuthorityId ? undefined : snapshot.output,
        initialOutputSequence: recoveredAuthorityId
          ? 0
          : normalizeRuntimeSupervisorOutputSequence(snapshot.outputSequence)
      });
    }
    if (!terminalStateTracker) {
      throw new Error(`Could not restore terminal state tracker for session ${snapshot.sessionId}.`);
    }

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
      lastExitMessageDescriptor,
      stopRequested: false,
      agentActivity: snapshot.kind === 'agent' ? createAgentActivityHeuristicState() : undefined,
      cols: recoveredCols,
      rows: recoveredRows,
      scrollback: recoveredScrollback,
      output: recoveredOutput,
      outputSequence: recoveredOutputSequence,
      terminalAuthorityId: terminalJournal?.getAuthorityId(),
      terminalJournal,
      terminalJournalError,
      terminalCheckpoint,
      terminalStateTracker,
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
      this.idleShutdownTimer = undefined;
      void this.flushRegistryBeforeShutdown().then(
        () => process.exit(0),
        (error) => {
          const normalizedError = error instanceof Error ? error : new Error(String(error));
          this.persistRegistryError = normalizedError;
          console.error('Failed to flush runtime supervisor registry before shutdown:', normalizedError);
          process.exit(1);
        }
      );
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

function setSessionLastExitMessage(session: SupervisorSession, descriptor: RuntimeSupervisorMessageDescriptor): void {
  session.lastExitMessageDescriptor = descriptor;
  session.lastExitMessage = formatRuntimeSupervisorMessageDescriptor(descriptor);
}

function describeAgentExit(
  label: string,
  code: number,
  signal: string | undefined,
  output: string
): RuntimeSupervisorMessageDescriptor {
  const suffix = summarizeLastLine(output);
  if (signal) {
    return {
      id: 'agentExitedSignal',
      params: {
        label,
        signal,
        suffix
      }
    };
  }

  return {
    id: 'agentExitedCode',
    params: {
      label,
      code: String(code),
      suffix
    }
  };
}

function describeAgentResumeFailure(
  label: string,
  code: number,
  signal: string | undefined,
  output: string
): RuntimeSupervisorMessageDescriptor {
  const suffix = summarizeLastLine(output);
  if (signal) {
    return {
      id: 'agentResumeFailedSignal',
      params: {
        label,
        signal,
        suffix
      }
    };
  }

  return {
    id: 'agentResumeFailedCode',
    params: {
      label,
      code: String(code),
      suffix
    }
  };
}

function describeTerminalExit(
  shellPath: string,
  code: number,
  signal: string | undefined,
  output: string
): RuntimeSupervisorMessageDescriptor {
  const suffix = summarizeLastLine(output);
  if (signal) {
    return {
      id: 'terminalExitedSignal',
      params: {
        shellPath,
        signal,
        suffix
      }
    };
  }

  return {
    id: 'terminalExitedCode',
    params: {
      shellPath,
      code: String(code),
      suffix
    }
  };
}

function normalizeRecoveredAgentLifecycle(status: AgentNodeStatus): AgentNodeStatus {
  if (
    status === 'starting' ||
    status === 'running' ||
    status === 'waiting-input' ||
    status === 'resuming' ||
    status === 'suspended' ||
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

function containsTerminalSuspendInput(data: string): boolean {
  return data.includes('\u001a');
}

function normalizeRecoveredTerminalLifecycle(status: TerminalNodeStatus): TerminalNodeStatus {
  if (status === 'launching' || status === 'live' || status === 'stopping') {
    return 'closed';
  }

  return status;
}

function createErrorResponse(
  id: string,
  descriptor: RuntimeSupervisorMessageDescriptor,
  code: string
): RuntimeSupervisorMessage {
  return {
    type: 'response',
    id,
    ok: false,
    error: {
      message: formatRuntimeSupervisorMessageDescriptor(descriptor),
      code,
      descriptor
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
    throw createRuntimeSupervisorProtocolError({
      id: 'supervisorMissingStorageDir'
    }, RUNTIME_SUPERVISOR_ERROR_CODES.supervisorMissingStorageDir);
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
