import { createHash, randomUUID } from 'crypto';
import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';

import {
  confirmAgentInterrupt,
  consumeAgentInstructionSubmission,
  createAgentProviderLifecycleState,
  isAgentHeuristicWaitingInputRecoverable,
  recordAgentAttentionWaitingInput,
  recordAgentHeuristicRunning,
  recordAgentHeuristicWaitingInput,
  recordAgentInterruptRequest,
  recordAgentSubmission,
  type AgentProviderLifecycleState
} from '../common/agentProviderLifecycle';
import {
  AGENT_WAITING_INPUT_POLL_INTERVAL_MS,
  createAgentActivityHeuristicState,
  evaluateAgentWaitingInputTransition,
  recordAgentBottomScreenActivity,
  recordAgentInputHeuristics,
  recordAgentOutputHeuristics,
  resetAgentActivityHeuristics,
  resetAgentBottomScreenActivityHeuristics,
  type AgentActivityHeuristicState
} from '../common/agentActivityHeuristics';
import {
  formatExecutionTerminalTitleReport,
  processExecutionTerminalTitleControls,
  type ExecutionTerminalTitleRedactionState
} from '../common/executionTerminalTitle';
import {
  type AgentNodeStatus,
  type AgentInputIntent,
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
  SERIALIZED_TERMINAL_CHECKPOINT_PROFILES,
  SerializedTerminalStateTracker,
  type SerializedTerminalCheckpointRejectionReason,
  type SerializedTerminalCheckpointValidationResult,
  type SerializedTerminalState
} from '../common/serializedTerminalState';
import { DEFAULT_TERMINAL_SCROLLBACK, normalizeTerminalScrollback } from '../common/terminalScrollback';
import {
  TERMINAL_SESSION_STREAM_VERSION,
  buildTerminalStreamAttachPayload,
  cloneTerminalStreamCheckpoint,
  normalizeTerminalStreamCheckpoint,
  normalizeTerminalStreamRevision,
  type TerminalStreamAttachPayload,
  type TerminalStreamCheckpoint,
  type TerminalStreamEvent
} from '../common/terminalSessionStream';
import {
  RUNTIME_SUPERVISOR_ERROR_CODES,
  RUNTIME_SUPERVISOR_TERMINAL_PROJECTION_MAX_CREDIT_BYTES,
  RUNTIME_SUPERVISOR_TERMINAL_PROJECTION_MIN_CREDIT_BYTES,
  deserializeExecutionSessionLaunchSpec,
  createRuntimeSupervisorProtocolError,
  formatRuntimeSupervisorMessageDescriptor,
  serializeRuntimeSupervisorError,
  type RuntimeSupervisorAttachSessionParams,
  type RuntimeSupervisorAckSessionRevisionParams,
  type RuntimeSupervisorAckSessionRevisionResult,
  type RuntimeSupervisorCancelTerminalProjectionParams,
  type RuntimeSupervisorCancelTerminalProjectionResult,
  type RuntimeSupervisorCreateSessionParams,
  type RuntimeSupervisorDeleteSessionParams,
  type RuntimeSupervisorEvent,
  type RuntimeSupervisorGetTerminalProjectionCheckpointParams,
  type RuntimeSupervisorGetSessionSnapshotParams,
  type RuntimeSupervisorMessageDescriptor,
  type RuntimeSupervisorMessage,
  type RuntimeSupervisorOpenTerminalProjectionParams,
  type RuntimeSupervisorOpenTerminalProjectionResult,
  type RuntimeSupervisorPaths,
  type RuntimeSupervisorReadTerminalProjectionParams,
  type RuntimeSupervisorReadTerminalProjectionResult,
  type RuntimeSupervisorRequest,
  type RuntimeSupervisorResizeSessionParams,
  type RuntimeSupervisorSessionSnapshot,
  type RuntimeSupervisorStopSessionParams,
  type RuntimeSupervisorSubscribeSessionParams,
  type RuntimeSupervisorSubscribeSessionResult,
  type RuntimeSupervisorTerminalCheckpointDiagnostics,
  type RuntimeSupervisorTerminalProjectionChunk,
  type RuntimeSupervisorTerminalProjectionCheckpoint,
  type RuntimeSupervisorUpdateSessionScrollbackParams,
  type RuntimeSupervisorWriteInputParams
} from '../common/runtimeSupervisorProtocol';
import {
  resolveTerminalJournalSessionDirectory,
  TerminalSessionJournal,
  type TerminalSessionJournalProjectionPin
} from './terminalSessionJournal';
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
const OUTPUT_TAIL_LIMIT = 6000;
const TERMINAL_CHECKPOINT_VALIDATION_RETRY_DELAY_MS = 30_000;
const AGENT_GRACEFUL_STOP_INPUT = '\u0003';
// Codex/Claude can take a few extra seconds after Ctrl-C to flush token usage and resume hints.
// Give the CLI a longer grace window before we escalate to kill, so the stopped snapshot is authoritative.
const AGENT_GRACEFUL_STOP_FORCE_KILL_TIMEOUT_MS = 5000;

function normalizeRuntimeSupervisorOptionalOutputSequence(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

interface SupervisorRegistry {
  version: 1;
  sessions: RuntimeSupervisorSessionSnapshot[];
}

interface SupervisorSession {
  sessionId: string;
  stateRevision: number;
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
  terminalTitle?: string;
  terminalTitleCarryover?: string;
  terminalTitleRedactionState?: ExecutionTerminalTitleRedactionState;
  outputSequence: number;
  terminalAuthorityId?: string;
  terminalJournal?: TerminalSessionJournal;
  terminalJournalError?: Error;
  terminalCheckpoint?: TerminalStreamCheckpoint;
  terminalCheckpointValidationAttemptAtMs?: number;
  terminalCheckpointLastRejectionReason?: SerializedTerminalCheckpointRejectionReason;
  terminalCheckpointConsecutiveRejectionCount: number;
  terminalCheckpointRejectionStartedAtMs?: number;
  terminalStateTracker: SerializedTerminalStateTracker;
  terminalOperationChain: Promise<void>;
  terminalMutationAdmissionOpen: boolean;
  finalizationPromise?: Promise<void>;
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
  agentProviderLifecycle?: AgentProviderLifecycleState;
  process?: ExecutionSessionProcess;
  outputSubscription?: DisposableLike;
  exitSubscription?: DisposableLike;
  lifecycleTimer?: NodeJS.Timeout;
}

type SupervisorSubscriptionMode =
  | 'legacy'
  | 'control-only'
  | 'terminal-stream-v1'
  | 'terminal-stream-with-state-v1';

function isTerminalStreamSubscription(mode: SupervisorSubscriptionMode): boolean {
  return mode === 'terminal-stream-v1' || mode === 'terminal-stream-with-state-v1';
}

interface SupervisorTerminalProjectionIdentity {
  sessionId: string;
  authorityId: string;
  targetRevision: number;
}

interface SupervisorTerminalProjectionStream extends SupervisorTerminalProjectionIdentity {
  projectionId: string;
  pin: TerminalSessionJournalProjectionPin;
  follow: boolean;
  checkpointComplete: boolean;
  checkpointDataOffset: number;
  nextRevision: number;
  currentEvent?: TerminalStreamEvent;
  eventDataOffset: number;
}

interface SupervisorTerminalProjectionTailBarrier extends SupervisorTerminalProjectionIdentity {
  projectionId: string;
}

interface LocatedTerminalProjectionTailBarrier {
  barriers: Map<string, SupervisorTerminalProjectionTailBarrier>;
  barrier: SupervisorTerminalProjectionTailBarrier;
}

class RuntimeSupervisorServer {
  private readonly supervisorInstanceId = randomUUID();
  private readonly sessions = new Map<string, SupervisorSession>();
  private readonly connections = new Set<net.Socket>();
  private readonly subscriptions = new Map<net.Socket, Map<string, SupervisorSubscriptionMode>>();
  private readonly deferredSubscriptionRevisions = new Map<net.Socket, Map<string, number>>();
  private readonly appliedRevisionAcks = new Map<
    net.Socket,
    Map<string, RuntimeSupervisorAckSessionRevisionResult>
  >();
  private readonly terminalProjectionStreams = new Map<
    net.Socket,
    Map<string, SupervisorTerminalProjectionStream>
  >();
  private readonly terminalProjectionTailBarriers = new Map<
    net.Socket,
    Map<string, SupervisorTerminalProjectionTailBarrier>
  >();
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
      this.appliedRevisionAcks.set(socket, new Map());
      this.terminalProjectionStreams.set(socket, new Map());
      this.terminalProjectionTailBarriers.set(socket, new Map());
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
              supervisorInstanceId: this.supervisorInstanceId,
              runtimeBackend: this.runtimeBackend,
              runtimeGuarantee: this.runtimeGuarantee,
              capabilities: {
                terminalProjectionStreamV1: true,
                terminalProjectionFollowV1: true,
                terminalSessionStreamV1: true,
                terminalProjectionSnapshotV1: true,
                terminalProjectionCheckpointV1: true,
                terminalAppliedRevisionAckV1: true,
                agentSubmissionIntentV1: true,
                supervisorInstanceIdentityV1: true
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
          if (
            request.params.deferSubscription === true &&
            request.params.terminalProjectionMode === 'stream-v1'
          ) {
            await this.activateControlSubscriptionWithCatchUp(socket, snapshot.sessionId);
          }
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
          if (
            request.params.deferSubscription === true &&
            request.params.terminalProjectionMode === 'stream-v1'
          ) {
            await this.activateControlSubscriptionWithCatchUp(socket, snapshot.sessionId);
          }
          return;
        }
        case 'getSessionSnapshot': {
          const snapshot = await this.getSessionSnapshot(request.params);
          this.writeMessage(socket, {
            type: 'response',
            id: request.id,
            ok: true,
            result: snapshot
          });
          return;
        }
        case 'getTerminalProjectionCheckpoint': {
          const checkpoint = await this.getTerminalProjectionCheckpoint(request.params);
          this.writeMessage(socket, {
            type: 'response',
            id: request.id,
            ok: true,
            result: checkpoint
          });
          return;
        }
        case 'subscribeSession': {
          const result = await this.subscribeSession(socket, request.params);
          this.writeMessage(socket, {
            type: 'response',
            id: request.id,
            ok: true,
            result
          });
          return;
        }
        case 'ackSessionRevision': {
          const result = this.ackSessionRevision(socket, request.params);
          this.writeMessage(socket, {
            type: 'response',
            id: request.id,
            ok: true,
            result
          });
          return;
        }
        case 'writeInput': {
          const lifecycleSession = this.writeInput(request.params);
          this.writeOkResponse(socket, request.id);
          if (lifecycleSession) {
            this.emitSessionState(lifecycleSession);
          }
          return;
        }
        case 'resizeSession':
          await this.resizeSession(request.params);
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
        case 'openTerminalProjection': {
          const result = await this.openTerminalProjection(socket, request.params);
          this.writeMessage(socket, {
            type: 'response',
            id: request.id,
            ok: true,
            result
          });
          return;
        }
        case 'readTerminalProjection': {
          await this.readTerminalProjection(socket, request.id, request.params);
          return;
        }
        case 'cancelTerminalProjection': {
          const result = this.cancelTerminalProjection(socket, request.params);
          this.writeMessage(socket, {
            type: 'response',
            id: request.id,
            ok: true,
            result
          });
          return;
        }
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
        : 'live';
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
      initialScrollback: scrollback,
      checkpointProfiles: SERIALIZED_TERMINAL_CHECKPOINT_PROFILES
    });
    let process: ExecutionSessionProcess;
    try {
      process = createExecutionSessionProcess(launchSpec);
    } catch (error) {
      await terminalJournal.delete();
      throw createExecutionSpawnProtocolError(error, launchSpec.file, launchSpec.cwd);
    }
    if (this.sessions.has(sessionId)) {
      process.kill();
      await terminalJournal.delete();
      throw createRuntimeSupervisorProtocolError({
        id: 'sessionAlreadyExists',
        params: {
          sessionId
        }
      }, RUNTIME_SUPERVISOR_ERROR_CODES.sessionAlreadyExists);
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
      stateRevision: 0,
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
      terminalCheckpointConsecutiveRejectionCount: 0,
      terminalStateTracker,
      terminalOperationChain: Promise.resolve(),
      terminalMutationAdmissionOpen: true,
      displayLabel: params.displayLabel,
      launchMode: params.launchMode,
      provider: params.provider,
      resumeStrategy: params.resumeStrategy,
      resumeSessionId: initialResumeSessionId,
      resumeStoragePath: params.resumeStoragePath,
      stopRequested: false,
      agentActivity: params.kind === 'agent' ? createAgentActivityHeuristicState() : undefined,
      agentProviderLifecycle:
        params.kind === 'agent' && params.provider
          ? createAgentProviderLifecycleState(params.provider, false)
          : undefined,
      process
    };
    this.sessions.set(sessionId, session);
    if (params.deferSubscription !== true) {
      this.subscribeSocket(socket, sessionId, 'legacy');
    }
    this.bindSessionProcess(session);

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
    const metadataOnlyProjection =
      params.deferSubscription === true && params.terminalProjectionMode === 'stream-v1';
    const snapshot = metadataOnlyProjection
      ? await this.toFreshSnapshot(session, 'never', false)
      : await this.toFreshSnapshot(session);
    if (metadataOnlyProjection) {
      return snapshot;
    }
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

    if (params.deferSubscription === true && params.terminalProjectionMode === 'stream-v1') {
      return this.enqueueTerminalOperation(session, () => {
        const snapshot = this.toSnapshot(session, undefined, false);
        const journal = session.terminalJournal;
        const authorityId = session.terminalAuthorityId;
        if (
          session.terminalJournalError ||
          !journal ||
          !authorityId
        ) {
          return snapshot;
        }

        const observedRevision = journal.getRevision();
        return {
          ...snapshot,
          terminalProjectionTargetRevision: observedRevision
        };
      });
    }

    if (params.deferSubscription === true && session.terminalJournal && session.terminalCheckpoint) {
      this.subscriptions.get(socket)?.delete(params.sessionId);
      const snapshot = await this.toFreshSnapshot(session);
      if (snapshot.terminalStream) {
        this.deferSocketSubscription(socket, params.sessionId, snapshot.terminalStream.revision);
      }
      return snapshot;
    }

    this.clearDeferredSubscription(socket, params.sessionId);
    this.subscribeSocket(socket, params.sessionId, 'legacy');
    return this.toFreshSnapshot(session);
  }

  private async activateControlSubscriptionWithCatchUp(
    socket: net.Socket,
    sessionId: string
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session || socket.destroyed) {
      return;
    }

    await this.enqueueTerminalOperation(session, () => {
      if (this.sessions.get(sessionId) !== session || socket.destroyed) {
        return;
      }
      this.clearDeferredSubscription(socket, sessionId);
      const subscriptionMode = this.subscriptions.get(socket)?.get(sessionId);
      if (!subscriptionMode || !isTerminalStreamSubscription(subscriptionMode)) {
        this.subscribeSocket(socket, sessionId, 'control-only');
      }
      this.writeMessage(socket, {
        type: 'event',
        event: 'sessionState',
        payload: this.toSnapshot(session, undefined, false)
      });
    });
  }

  private getSessionSnapshot(
    params: RuntimeSupervisorGetSessionSnapshotParams
  ): Promise<RuntimeSupervisorSessionSnapshot> {
    return this.toFreshSnapshot(this.requireSession(params.sessionId));
  }

  private getTerminalProjectionCheckpoint(
    params: RuntimeSupervisorGetTerminalProjectionCheckpointParams
  ): Promise<RuntimeSupervisorTerminalProjectionCheckpoint> {
    const session = this.requireSession(params.sessionId);
    return this.enqueueTerminalOperation(session, async () => {
      await this.createFreshSnapshot(session, 'always', false);
      const journal = session.terminalJournal;
      const checkpoint = session.terminalCheckpoint;
      if (session.terminalJournalError || !journal || !session.terminalAuthorityId || !checkpoint) {
        throw createRuntimeSupervisorProtocolError({
          id: 'terminalJournalUnavailable',
          params: { sessionId: params.sessionId }
        }, RUNTIME_SUPERVISOR_ERROR_CODES.terminalJournalUnavailable);
      }
      return {
        supervisorInstanceId: this.supervisorInstanceId,
        sessionId: session.sessionId,
        authorityId: session.terminalAuthorityId,
        revision: journal.getRevision(),
        checkpoint: cloneTerminalStreamCheckpoint(checkpoint),
        terminalCheckpointDiagnostics: this.getTerminalCheckpointDiagnostics(session)
      };
    });
  }

  private openTerminalProjection(
    socket: net.Socket,
    params: RuntimeSupervisorOpenTerminalProjectionParams
  ): Promise<RuntimeSupervisorOpenTerminalProjectionResult> {
    const session = this.requireSession(params.sessionId);
    return this.enqueueTerminalOperation(session, async () => {
      const journal = session.terminalJournal;
      const authorityId = session.terminalAuthorityId;
      let checkpoint = session.terminalCheckpoint;
      if (
        session.terminalJournalError ||
        !journal ||
        !authorityId ||
        !checkpoint ||
        checkpoint.sessionId !== session.sessionId ||
        checkpoint.authorityId !== authorityId
      ) {
        // Reuse the last eligible checkpoint on the hot path. A full tracker
        // validation/serialization is only needed before the first usable
        // projection (or after a journal authority changes).
        await this.createFreshSnapshot(session, 'always', false);
        checkpoint = session.terminalCheckpoint;
      }
      if (session.terminalJournalError || !journal || !authorityId || !checkpoint) {
        throw createRuntimeSupervisorProtocolError({
          id: 'terminalJournalUnavailable',
          params: { sessionId: params.sessionId }
        }, RUNTIME_SUPERVISOR_ERROR_CODES.terminalJournalUnavailable);
      }
      if (params.authorityId !== undefined && params.authorityId !== authorityId) {
        throw createRuntimeSupervisorProtocolError({
          id: 'terminalAuthorityMismatch',
          params: { sessionId: params.sessionId }
        }, RUNTIME_SUPERVISOR_ERROR_CODES.terminalAuthorityMismatch);
      }

      const targetRevision = journal.getRevision();
      const follow = params.follow === true;
      const expectedTargetRevision = params.targetRevision === undefined
        ? undefined
        : normalizeTerminalStreamRevision(params.targetRevision);
      if (
        params.targetRevision !== undefined &&
        (expectedTargetRevision === undefined || expectedTargetRevision !== targetRevision)
      ) {
        throw createRuntimeSupervisorProtocolError({
          id: 'terminalRevisionInvalid',
          params: {
            sessionId: params.sessionId,
            revision: String(params.targetRevision)
          }
        }, RUNTIME_SUPERVISOR_ERROR_CODES.terminalRevisionInvalid);
      }

      let pin: TerminalSessionJournalProjectionPin | undefined;
      let projectionId: string | undefined;
      try {
        try {
          pin = journal.pinProjection(checkpoint, targetRevision);
        } catch (error) {
          // A retained checkpoint can become too old after compaction. Refresh
          // once and retry so projection admission remains bounded without
          // paying the full validation cost for every surface.
          await this.createFreshSnapshot(session, 'always', false);
          checkpoint = session.terminalCheckpoint;
          if (!checkpoint) {
            throw error;
          }
          pin = journal.pinProjection(checkpoint, targetRevision);
        }
        const streams = this.terminalProjectionStreams.get(socket);
        const tailBarriers = this.terminalProjectionTailBarriers.get(socket);
        if (socket.destroyed || !streams || !tailBarriers) {
          throw createRuntimeSupervisorProtocolError({
            id: 'clientDisconnected'
          }, RUNTIME_SUPERVISOR_ERROR_CODES.clientDisconnected);
        }

        projectionId = randomUUID();
        const stream: SupervisorTerminalProjectionStream = {
          projectionId,
          sessionId: params.sessionId,
          authorityId,
          targetRevision,
          pin,
          follow,
          checkpointComplete: false,
          checkpointDataOffset: 0,
          nextRevision: pin.checkpoint.revision + 1,
          eventDataOffset: 0
        };
        streams.set(projectionId, stream);
        tailBarriers.set(projectionId, {
          projectionId,
          sessionId: params.sessionId,
          authorityId,
          targetRevision
        });
        const { data: _checkpointData, ...serializedState } = pin.checkpoint.serializedState;
        return {
          supervisorInstanceId: this.supervisorInstanceId,
          projectionId,
          sessionId: params.sessionId,
          authorityId,
          targetRevision,
          follow,
          checkpoint: {
            version: pin.checkpoint.version,
            sessionId: pin.checkpoint.sessionId,
            authorityId: pin.checkpoint.authorityId,
            revision: pin.checkpoint.revision,
            cols: pin.checkpoint.cols,
            rows: pin.checkpoint.rows,
            scrollback: pin.checkpoint.scrollback,
            createdAtMs: pin.checkpoint.createdAtMs,
            serializedState
          }
        };
      } catch (error) {
        pin?.release();
        if (projectionId) {
          this.terminalProjectionStreams.get(socket)?.delete(projectionId);
          this.terminalProjectionTailBarriers.get(socket)?.delete(projectionId);
        }
        throw error;
      }
    });
  }

  private async readTerminalProjection(
    socket: net.Socket,
    requestId: string,
    params: RuntimeSupervisorReadTerminalProjectionParams
  ): Promise<void> {
    const creditBytes = params.creditBytes;
    if (
      !Number.isSafeInteger(creditBytes) ||
      creditBytes < RUNTIME_SUPERVISOR_TERMINAL_PROJECTION_MIN_CREDIT_BYTES ||
      creditBytes > RUNTIME_SUPERVISOR_TERMINAL_PROJECTION_MAX_CREDIT_BYTES
    ) {
      throw new Error(
        `Terminal projection credit must be between ${RUNTIME_SUPERVISOR_TERMINAL_PROJECTION_MIN_CREDIT_BYTES} and ${RUNTIME_SUPERVISOR_TERMINAL_PROJECTION_MAX_CREDIT_BYTES} bytes.`
      );
    }

    const initialStream = this.terminalProjectionStreams.get(socket)?.get(params.projectionId);
    if (!initialStream) {
      throw new Error(`Terminal projection ${params.projectionId} is not open on this connection.`);
    }

    const session = this.requireSession(initialStream.sessionId);
    await this.enqueueTerminalOperation(session, async () => {
      const stream = this.terminalProjectionStreams.get(socket)?.get(params.projectionId);
      if (!stream) {
        throw new Error(`Terminal projection ${params.projectionId} is no longer open on this connection.`);
      }
      const result = this.readTerminalProjectionAtSettledRevision(socket, session, stream, creditBytes);
      // Keep this write inside the session operation. A transition to the live
      // subscription must publish this response before any later PTY event.
      this.writeMessage(socket, {
        type: 'response',
        id: requestId,
        ok: true,
        result
      });
    });
  }

  private readTerminalProjectionAtSettledRevision(
    socket: net.Socket,
    session: SupervisorSession,
    stream: SupervisorTerminalProjectionStream,
    creditBytes: number
  ): RuntimeSupervisorReadTerminalProjectionResult {
    const journal = session.terminalJournal;
    if (session.terminalJournalError || !journal || session.terminalAuthorityId !== stream.authorityId) {
      throw createRuntimeSupervisorProtocolError({
        id: 'terminalJournalUnavailable',
        params: { sessionId: stream.sessionId }
      }, RUNTIME_SUPERVISOR_ERROR_CODES.terminalJournalUnavailable);
    }

    if (stream.checkpointComplete && stream.nextRevision > stream.targetRevision) {
      if (stream.follow) {
        const headRevision = journal.getRevision();
        if (stream.nextRevision <= headRevision) {
          // Every revision observed before the atomic live subscription stays
          // on the same credit/ACK projection path. Ready therefore means the
          // Webview has applied the complete settled backlog, not only the
          // fixed open-time cut.
          stream.pin.extendTargetRevision(headRevision);
          stream.targetRevision = headRevision;
          const barrier = this.terminalProjectionTailBarriers.get(socket)?.get(stream.projectionId);
          if (!barrier) {
            throw new Error(`Terminal projection ${stream.projectionId} live-tail barrier is unavailable.`);
          }
          barrier.targetRevision = headRevision;
        } else {
          const live = session.live;
          if (live) {
            this.subscribeSocket(socket, stream.sessionId, 'terminal-stream-v1');
          }
          const result: RuntimeSupervisorReadTerminalProjectionResult = {
            supervisorInstanceId: this.supervisorInstanceId,
            projectionId: stream.projectionId,
            sessionId: stream.sessionId,
            authorityId: stream.authorityId,
            targetRevision: headRevision,
            payloadBytes: 0,
            done: true,
            live
          };
          this.releaseTerminalProjectionStream(socket, stream.projectionId);
          return result;
        }
      }
    }

    let chunk: RuntimeSupervisorTerminalProjectionChunk;
    let payloadBytes: number;
    if (!stream.checkpointComplete) {
      const result = sliceTerminalProjectionDataChunk(
        stream.pin.checkpoint.serializedState.data,
        stream.checkpointDataOffset,
        creditBytes,
        (data, complete) => ({
          kind: 'checkpoint',
          dataOffset: stream.checkpointDataOffset,
          data,
          complete
        })
      );
      chunk = result.chunk;
      payloadBytes = result.payloadBytes;
      stream.checkpointDataOffset = result.nextOffset;
      stream.checkpointComplete = chunk.complete;
    } else {
      const event = stream.currentEvent ?? stream.pin.readEvent(stream.nextRevision);
      if (!event) {
        throw new Error(`Terminal projection event ${stream.nextRevision} is unavailable.`);
      }
      stream.currentEvent = event;
      if (event.type === 'output') {
        const result = sliceTerminalProjectionDataChunk(
          event.data,
          stream.eventDataOffset,
          creditBytes,
          (data, complete) => ({
            kind: 'output',
            revision: event.revision,
            createdAtMs: event.createdAtMs,
            dataOffset: stream.eventDataOffset,
            data,
            complete
          })
        );
        chunk = result.chunk;
        payloadBytes = result.payloadBytes;
        stream.eventDataOffset = result.nextOffset;
        if (chunk.complete) {
          stream.currentEvent = undefined;
          stream.eventDataOffset = 0;
          stream.nextRevision += 1;
        }
      } else if (event.type === 'resize') {
        chunk = {
          kind: 'resize',
          revision: event.revision,
          createdAtMs: event.createdAtMs,
          cols: event.cols,
          rows: event.rows,
          complete: true
        };
        payloadBytes = terminalProjectionChunkPayloadBytes(chunk);
        stream.currentEvent = undefined;
        stream.nextRevision += 1;
      } else {
        chunk = {
          kind: 'scrollback',
          revision: event.revision,
          createdAtMs: event.createdAtMs,
          scrollback: event.scrollback,
          complete: true
        };
        payloadBytes = terminalProjectionChunkPayloadBytes(chunk);
        stream.currentEvent = undefined;
        stream.nextRevision += 1;
      }
      if (payloadBytes > creditBytes) {
        throw new Error(`Terminal projection metadata exceeds the supplied ${creditBytes}-byte credit.`);
      }
    }

    const done = !stream.follow && stream.checkpointComplete && stream.nextRevision > stream.targetRevision;
    const result: RuntimeSupervisorReadTerminalProjectionResult = {
      supervisorInstanceId: this.supervisorInstanceId,
      projectionId: stream.projectionId,
      sessionId: stream.sessionId,
      authorityId: stream.authorityId,
      targetRevision: stream.targetRevision,
      payloadBytes,
      chunkChecksum: terminalProjectionChunkChecksum(chunk),
      chunk,
      done
    };
    if (done) {
      this.releaseTerminalProjectionStream(socket, stream.projectionId);
    }
    return result;
  }

  private cancelTerminalProjection(
    socket: net.Socket,
    params: RuntimeSupervisorCancelTerminalProjectionParams
  ): RuntimeSupervisorCancelTerminalProjectionResult {
    const cancelled = this.releaseTerminalProjectionStream(socket, params.projectionId);
    return {
      supervisorInstanceId: this.supervisorInstanceId,
      projectionId: params.projectionId,
      cancelled
    };
  }

  private subscribeSession(
    socket: net.Socket,
    params: RuntimeSupervisorSubscribeSessionParams
  ): Promise<RuntimeSupervisorSubscribeSessionResult> {
    const session = this.requireSession(params.sessionId);
    return this.enqueueTerminalOperation(session, () =>
      this.subscribeSessionAtSettledRevision(socket, session, params)
    );
  }

  private subscribeSessionAtSettledRevision(
    socket: net.Socket,
    session: SupervisorSession,
    params: RuntimeSupervisorSubscribeSessionParams
  ): RuntimeSupervisorSubscribeSessionResult {
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
    const projectionBarrier = params.projectionId === undefined
      ? undefined
      : this.requireTerminalProjectionTailBarrier(params.projectionId, {
          sessionId: params.sessionId,
          authorityId: params.authorityId,
          targetRevision: afterRevision
        });

    const replayEvents = journal.getEventsAfter(afterRevision);
    // The compatibility subscribe RPC shares one socket for terminal events
    // and lifecycle. Bulk follow sockets use terminal-stream-v1 and must not
    // receive compact state snapshots duplicated from the control socket.
    this.subscribeSocket(socket, params.sessionId, 'terminal-stream-with-state-v1');
    for (const event of replayEvents) {
      this.writeTerminalStreamEvent(socket, session, event);
    }
    this.writeMessage(socket, {
      type: 'event',
      event: 'sessionState',
      payload: this.toSnapshot(session, undefined, false)
    });
    this.clearDeferredSubscription(socket, params.sessionId);
    projectionBarrier?.barriers.delete(projectionBarrier.barrier.projectionId);
    this.releaseTerminalJournalMemoryThroughCheckpoint(session);
    return {
      supervisorInstanceId: this.supervisorInstanceId,
      sessionId: session.sessionId,
      authorityId: session.terminalAuthorityId,
      revision: journal.getRevision()
    };
  }

  private ackSessionRevision(
    socket: net.Socket,
    params: RuntimeSupervisorAckSessionRevisionParams
  ): RuntimeSupervisorAckSessionRevisionResult {
    const session = this.requireSession(params.sessionId);
    const journal = session.terminalJournal;
    if (session.terminalJournalError || !journal || !session.terminalAuthorityId) {
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

    const revision = normalizeTerminalStreamRevision(params.revision);
    const consumerId = params.consumerId === 'editor' || params.consumerId === 'panel'
      ? params.consumerId
      : undefined;
    if (
      revision === undefined ||
      consumerId === undefined ||
      revision > journal.getRevision()
    ) {
      throw createRuntimeSupervisorProtocolError({
        id: 'terminalRevisionInvalid',
        params: {
          sessionId: params.sessionId,
          revision: String(params.revision)
        }
      }, RUNTIME_SUPERVISOR_ERROR_CODES.terminalRevisionInvalid);
    }
    const socketAcks = this.appliedRevisionAcks.get(socket);
    const consumerKey = JSON.stringify([params.sessionId, consumerId]);
    const previous = socketAcks?.get(consumerKey);
    if (previous?.authorityId === params.authorityId && revision < previous.appliedRevision) {
      throw createRuntimeSupervisorProtocolError({
        id: 'terminalRevisionInvalid',
        params: {
          sessionId: params.sessionId,
          revision: String(params.revision)
        }
      }, RUNTIME_SUPERVISOR_ERROR_CODES.terminalRevisionInvalid);
    }

    const result: RuntimeSupervisorAckSessionRevisionResult = {
      supervisorInstanceId: this.supervisorInstanceId,
      sessionId: params.sessionId,
      authorityId: params.authorityId,
      consumerId,
      appliedRevision: revision
    };
    socketAcks?.set(consumerKey, result);
    this.releaseTerminalJournalMemoryThroughCheckpoint(session);
    return result;
  }

  private writeInput(params: RuntimeSupervisorWriteInputParams): SupervisorSession | undefined {
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

    this.assertTerminalMutationAdmissionOpen(session);
    session.process?.write(params.data);

    if (session.kind === 'agent') {
      const inputAtMs = Date.now();
      recordAgentInputHeuristics(this.ensureAgentActivityState(session), inputAtMs);
      const providerLifecycle = session.agentProviderLifecycle;
      const submittedInstruction = providerLifecycle
        ? consumeAgentInstructionSubmission(providerLifecycle, params.data, params.intent)
        : isAgentInstructionSubmission(params.data, params.intent);
      if (session.lifecycleTimer) {
        clearTimeout(session.lifecycleTimer);
        session.lifecycleTimer = undefined;
      }
      if (
        params.intent === 'interrupt' &&
        providerLifecycle &&
        session.lifecycle === 'running'
      ) {
        const interruptResult = recordAgentInterruptRequest(providerLifecycle);
        if (interruptResult.accepted) {
          session.terminalStateTracker.disableBottomScreenActivityTracking();
          resetAgentActivityHeuristics(
            this.ensureAgentActivityState(session),
            session.output,
            inputAtMs
          );
          this.queueAgentWaitingInput(session.sessionId);
        }
      } else if (submittedInstruction) {
        if (providerLifecycle) {
          recordAgentSubmission(providerLifecycle);
        }
        session.terminalStateTracker.disableBottomScreenActivityTracking();
        resetAgentActivityHeuristics(
          this.ensureAgentActivityState(session),
          session.output,
          inputAtMs
        );
        session.lifecycle = 'running';
        session.resumePhaseActive = false;
        this.queueAgentWaitingInput(session.sessionId);
        return session;
      }
    } else if (session.lifecycle === 'launching') {
      session.lifecycle = 'live';
      return session;
    }
    return undefined;
  }

  private async resizeSession(params: RuntimeSupervisorResizeSessionParams): Promise<void> {
    const session = this.requireLiveSession(params.sessionId);
    this.assertTerminalMutationAdmissionOpen(session);
    await this.enqueueTerminalOperation(session, () => {
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
      session.process?.resize(params.cols, params.rows);
      if (terminalEvent) {
        this.emitTerminalStreamEvent(session, terminalEvent);
      }
      this.emitSessionState(session);
    });
  }

  private async updateSessionScrollback(params: RuntimeSupervisorUpdateSessionScrollbackParams): Promise<void> {
    const session = this.requireLiveSession(params.sessionId);
    this.assertTerminalMutationAdmissionOpen(session);
    await this.enqueueTerminalOperation(session, async () => {
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
    });
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
    session.terminalMutationAdmissionOpen = false;
    if (session.finalizationPromise) {
      await session.finalizationPromise;
    }
    const wasLive = session.live;
    if (wasLive) {
      session.stopRequested = true;
      session.outputSubscription?.dispose();
      session.exitSubscription?.dispose();
      session.outputSubscription = undefined;
      session.exitSubscription = undefined;
      const process = session.process;
      session.process = undefined;
      process?.kill();
    }
    await this.enqueueTerminalOperation(session, async () => {
      if (session.lifecycleTimer) {
        clearTimeout(session.lifecycleTimer);
        session.lifecycleTimer = undefined;
      }
      if (wasLive) {
        session.lifecycle = session.kind === 'agent' ? 'stopped' : 'closed';
        setSessionLastExitMessage(session, {
          id: session.kind === 'agent' ? 'agentSessionDeleted' : 'terminalSessionDeleted'
        });
      }
      session.live = false;
      session.terminalTitle = undefined;
      session.terminalTitleCarryover = undefined;
      session.terminalTitleRedactionState = undefined;
      this.advanceSessionStateRevision(session);
      const message: RuntimeSupervisorEvent = {
        type: 'event',
        event: 'sessionState',
        payload: session.terminalJournalError
          ? this.toSnapshot(session, undefined, false)
          : await this.createFreshSnapshot(session, 'never', false)
      };
      this.broadcastToSessionSubscribers(session.sessionId, message);
      this.schedulePersist();
    });
    this.disposeSession(session, {
      terminateProcess: false
    });
    this.clearSessionSubscriptions(params.sessionId);
    if (session.terminalJournal) {
      await session.terminalJournal.delete();
    } else if (session.terminalAuthorityId) {
      await fs.promises.rm(
        resolveTerminalJournalSessionDirectory(this.paths.storageDir, session.sessionId),
        { recursive: true, force: true }
      );
    }
    this.sessions.delete(params.sessionId);
    this.schedulePersist();
    this.scheduleIdleShutdownIfNeeded();
  }

  private bindSessionProcess(session: SupervisorSession): void {
    session.outputSubscription = session.process?.onData((chunk) => {
      if (!chunk || !session.terminalMutationAdmissionOpen) {
        return;
      }

      void this.enqueueTerminalOperation(session, () => {
        const titleUpdate = updateSupervisorTerminalTitle(session, chunk);
        const terminalOutput = titleUpdate.terminalOutput;
        let terminalEvent: TerminalStreamEvent | undefined;
        try {
          terminalEvent = session.terminalJournal?.appendOutput(terminalOutput);
        } catch (error) {
          this.failSessionForTerminalJournal(session, error);
          throw error;
        }
        session.outputSequence = terminalEvent?.revision ?? session.outputSequence + 1;
        this.advanceSessionStateRevision(session);
        session.output = appendOutputTail(session.output, terminalOutput);
        for (const report of titleUpdate.titleReports) {
          try {
            session.process?.write(report);
          } catch {
            // The process may exit between its output query and the reply.
          }
        }
        session.terminalStateTracker.write(terminalOutput, {
          outputSequence: session.outputSequence
        });
        if (session.kind === 'agent') {
          this.maybeSyncAgentResumeSessionIdFromOutput(session, {
            allowOverwriteExisting: session.stopRequested,
            emitState: session.stopRequested
          });
        }
        if (session.kind === 'agent') {
          if (shouldRecordSupervisorAgentOutputHeuristics(session)) {
            const snapshot = recordAgentOutputHeuristics(
              this.ensureAgentActivityState(session),
              chunk,
              session.output,
              session.provider
            );
            this.applySupervisorAgentOutputActivityEvidence(session, snapshot);
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

        this.emitSessionOutput(
          session,
          terminalOutput,
          terminalEvent,
          titleUpdate.titleUpdated ? session.terminalTitle ?? null : undefined
        );
        this.schedulePersist();
      }).catch((error) => {
        if (!session.terminalJournalError) {
          this.failSessionForTerminalJournal(session, error);
        }
      });
    });

    session.exitSubscription = session.process?.onExit(({ exitCode, signal }: ExecutionSessionExitEvent) => {
      session.terminalMutationAdmissionOpen = false;
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
    session.terminalTitle = undefined;
    session.terminalTitleCarryover = undefined;
    session.terminalTitleRedactionState = undefined;
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

    if (session.finalizationPromise) {
      await session.finalizationPromise;
      return;
    }
    session.terminalMutationAdmissionOpen = false;

    const finalizationPromise = this.enqueueTerminalOperation(session, async () => {
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
      session.terminalTitle = undefined;
      session.terminalTitleCarryover = undefined;
      session.terminalTitleRedactionState = undefined;

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
          setSessionLastExitMessage(
            session,
            describeAgentExit(session.displayLabel, exitCode, signal, session.output)
          );
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
        setSessionLastExitMessage(
          session,
          describeTerminalExit(session.shellPath, exitCode, signal, session.output)
        );
      }

      session.lastExitCode = exitCode;
      session.lastExitSignal = normalizeSignal(signal);
      this.advanceSessionStateRevision(session);
      const message: RuntimeSupervisorEvent = {
        type: 'event',
        event: 'sessionState',
        payload: await this.createFreshSnapshot(session, 'never', false)
      };
      this.broadcastToSessionSubscribers(session.sessionId, message);
      this.schedulePersist();
      this.scheduleIdleShutdownIfNeeded();
    });
    session.finalizationPromise = finalizationPromise;
    await finalizationPromise;
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
    terminalEvent?: TerminalStreamEvent,
    terminalTitle?: string | null
  ): void {
    const legacyMessage: RuntimeSupervisorEvent = {
      type: 'event',
      event: 'sessionOutput',
      payload: {
        supervisorInstanceId: this.supervisorInstanceId,
        sessionId: session.sessionId,
        kind: session.kind,
        chunk,
        outputSequence: session.outputSequence,
        terminalAuthorityId: session.terminalAuthorityId,
        terminalRevision: terminalEvent?.revision,
        terminalTitle
      }
    };
    for (const [socket, subscriptions] of this.subscriptions.entries()) {
      const mode = subscriptions.get(session.sessionId);
      if (!mode || socket.destroyed) {
        continue;
      }
      if (mode === 'control-only') {
        continue;
      }
      if (isTerminalStreamSubscription(mode) && terminalEvent) {
        this.writeTerminalStreamEvent(socket, session, terminalEvent, terminalTitle);
      } else {
        this.writeMessage(socket, legacyMessage);
      }
    }
  }

  private emitTerminalStreamEvent(session: SupervisorSession, event: TerminalStreamEvent): void {
    for (const [socket, subscriptions] of this.subscriptions.entries()) {
      const mode = subscriptions.get(session.sessionId);
      if (!mode || !isTerminalStreamSubscription(mode) || socket.destroyed) {
        continue;
      }
      this.writeTerminalStreamEvent(socket, session, event);
    }
  }

  private writeTerminalStreamEvent(
    socket: net.Socket,
    session: SupervisorSession,
    event: TerminalStreamEvent,
    terminalTitle?: string | null
  ): void {
    this.writeMessage(socket, {
      type: 'event',
      event: 'sessionTerminalEvent',
      payload: {
        supervisorInstanceId: this.supervisorInstanceId,
        sessionId: session.sessionId,
        kind: session.kind,
        authorityId: session.terminalAuthorityId ?? '',
        event,
        terminalTitle
      }
    });
  }

  private emitSessionState(session: SupervisorSession): void {
    this.advanceSessionStateRevision(session);
    const message: RuntimeSupervisorEvent = {
      type: 'event',
      event: 'sessionState',
      payload: this.toSnapshot(session, undefined, false)
    };
    this.broadcastToSessionSubscribers(session.sessionId, message);
    this.schedulePersist();
  }

  private async emitFreshSessionState(session: SupervisorSession): Promise<void> {
    this.advanceSessionStateRevision(session);
    const message: RuntimeSupervisorEvent = {
      type: 'event',
      event: 'sessionState',
      payload: await this.toFreshSnapshot(session, 'always', false)
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

  private applySupervisorAgentOutputActivityEvidence(
    session: SupervisorSession,
    snapshot: ReturnType<typeof recordAgentOutputHeuristics>
  ): void {
    if (!session.agentProviderLifecycle) {
      return;
    }

    let transition: 'running' | 'waiting-input' | undefined;
    if (snapshot.sawAttentionSignal) {
      const result = recordAgentAttentionWaitingInput(session.agentProviderLifecycle);
      if (result.accepted && result.changed && result.lifecycle) {
        transition = result.lifecycle;
      }
    }
    if (snapshot.sawTerminalTitleActivity) {
      const result = recordAgentHeuristicRunning(session.agentProviderLifecycle, 'terminal-title');
      if (result.accepted && result.changed && result.lifecycle) {
        transition = result.lifecycle;
      }
    }
    if (!transition) {
      return;
    }

    if (transition === 'running') {
      session.terminalStateTracker.disableBottomScreenActivityTracking();
      resetAgentBottomScreenActivityHeuristics(this.ensureAgentActivityState(session));
      session.resumePhaseActive = false;
    } else {
      resetAgentBottomScreenActivityHeuristics(this.ensureAgentActivityState(session));
      session.terminalStateTracker.enableBottomScreenActivityTracking();
      recordAgentBottomScreenActivity(
        this.ensureAgentActivityState(session),
        session.terminalStateTracker.getBottomScreenActivityToken()
      );
    }
    session.lifecycle = transition;
    this.emitSessionState(session);
  }

  private queueAgentWaitingInput(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (
      !session ||
      session.kind !== 'agent' ||
      !shouldEvaluateSupervisorAgentInteractiveState(session)
    ) {
      return;
    }
    if (
      session.lifecycle === 'waiting-input' &&
      isAgentHeuristicWaitingInputRecoverable(session.agentProviderLifecycle)
    ) {
      session.terminalStateTracker.enableBottomScreenActivityTracking();
    } else {
      session.terminalStateTracker.disableBottomScreenActivityTracking();
    }
    if (session.lifecycleTimer) {
      return;
    }

    session.lifecycleTimer = setTimeout(() => {
      const current = this.sessions.get(sessionId);
      if (
        !current ||
        current.kind !== 'agent' ||
        !current.live
      ) {
        return;
      }
      current.lifecycleTimer = undefined;
      if (!shouldEvaluateSupervisorAgentInteractiveState(current)) {
        return;
      }

      const now = Date.now();
      if (current.lifecycle === 'waiting-input') {
        const bottomActivity = recordAgentBottomScreenActivity(
          this.ensureAgentActivityState(current),
          current.terminalStateTracker.getBottomScreenActivityToken(),
          now
        );
        const recovery =
          bottomActivity.strongRunningEvidence && current.agentProviderLifecycle
            ? recordAgentHeuristicRunning(current.agentProviderLifecycle)
            : undefined;
        if (recovery?.accepted) {
          current.terminalStateTracker.disableBottomScreenActivityTracking();
          resetAgentBottomScreenActivityHeuristics(this.ensureAgentActivityState(current));
          current.lifecycle = 'running';
          current.resumePhaseActive = false;
          this.emitSessionState(current);
          this.queueAgentWaitingInput(sessionId);
          return;
        }
      }

      const interruptRequested = current.agentProviderLifecycle?.interruptRequested === true;
      const evaluation = evaluateAgentWaitingInputTransition(
        this.ensureAgentActivityState(current),
        now
      );
      if (evaluation.shouldTransition) {
        if (current.lifecycle === 'waiting-input') {
          return;
        }
        if (current.agentProviderLifecycle) {
          const transitionResult = interruptRequested
            ? confirmAgentInterrupt(current.agentProviderLifecycle)
            : recordAgentHeuristicWaitingInput(current.agentProviderLifecycle);
          if (interruptRequested && !transitionResult.accepted) {
            return;
          }
        }
        if (current.lifecycle === 'resuming') {
          current.resumePhaseActive = false;
        }
        current.lifecycle = 'waiting-input';
        resetAgentBottomScreenActivityHeuristics(this.ensureAgentActivityState(current));
        if (isAgentHeuristicWaitingInputRecoverable(current.agentProviderLifecycle)) {
          current.terminalStateTracker.enableBottomScreenActivityTracking();
          recordAgentBottomScreenActivity(
            this.ensureAgentActivityState(current),
            current.terminalStateTracker.getBottomScreenActivityToken(),
            now
          );
        } else {
          current.terminalStateTracker.disableBottomScreenActivityTracking();
        }
        void this.maybeDiscoverAgentResumeSessionIdFromFiles(sessionId, 'waiting-input');
        this.emitSessionState(current);
        return;
      }

      if (evaluation.shouldKeepPolling) {
        this.queueAgentWaitingInput(sessionId);
        return;
      }

    }, AGENT_WAITING_INPUT_POLL_INTERVAL_MS);
  }

  private toFreshSnapshot(
    session: SupervisorSession,
    checkpointValidation: 'always' | 'if-compaction-due' | 'never' = 'always',
    includeTerminalProjection = true
  ): Promise<RuntimeSupervisorSessionSnapshot> {
    return this.enqueueTerminalOperation(session, () =>
      this.createFreshSnapshot(session, checkpointValidation, includeTerminalProjection)
    );
  }

  private async createFreshSnapshot(
    session: SupervisorSession,
    checkpointValidation: 'always' | 'if-compaction-due' | 'never' = 'always',
    includeTerminalProjection = true
  ): Promise<RuntimeSupervisorSessionSnapshot> {
    if (session.terminalJournalError && session.live) {
      throw session.terminalJournalError;
    }
    // Pin terminal geometry to the same event-loop cut as the tracker flush. Any
    // later resize/scrollback change remains in the journal after this checkpoint.
    const checkpointCols = session.cols;
    const checkpointRows = session.rows;
    const checkpointScrollback = session.scrollback;
    const journal = session.terminalJournal;
    const journalRevision = journal?.getRevision();
    const now = Date.now();
    const compactionDue =
      session.live && journalRevision !== undefined && journal?.shouldCommitCheckpoint(journalRevision);
    const validationRetryReady =
      session.terminalCheckpointValidationAttemptAtMs === undefined ||
      now - session.terminalCheckpointValidationAttemptAtMs >= TERMINAL_CHECKPOINT_VALIDATION_RETRY_DELAY_MS;
    const shouldValidateCheckpoint =
      checkpointValidation === 'always' ||
      Boolean(checkpointValidation === 'if-compaction-due' && compactionDue && validationRetryReady);
    if (checkpointValidation === 'if-compaction-due' && shouldValidateCheckpoint) {
      session.terminalCheckpointValidationAttemptAtMs = now;
    }
    let validatedCheckpoint: SerializedTerminalCheckpointValidationResult | undefined;
    if (shouldValidateCheckpoint) {
      try {
        validatedCheckpoint = await session.terminalStateTracker.flushValidatedCheckpoint();
      } catch {
        validatedCheckpoint = { eligible: false, reason: 'validation-failed' };
      }
      this.recordTerminalCheckpointValidation(session, validatedCheckpoint);
    }
    const serializedTerminalState = validatedCheckpoint?.eligible
      ? validatedCheckpoint.state
      : session.terminalCheckpoint?.serializedState;
    if (
      validatedCheckpoint?.eligible &&
      journal &&
      session.terminalAuthorityId &&
      !session.terminalJournalError
    ) {
      await journal.flush();
      const checkpointRevision = normalizeTerminalStreamRevision(validatedCheckpoint.state.outputSequence);
      if (checkpointRevision !== undefined && checkpointRevision === journal.getRevision()) {
        const checkpoint = normalizeTerminalStreamCheckpoint({
          version: TERMINAL_SESSION_STREAM_VERSION,
          sessionId: session.sessionId,
          authorityId: session.terminalAuthorityId,
          revision: checkpointRevision,
          cols: checkpointCols,
          rows: checkpointRows,
          scrollback: checkpointScrollback,
          createdAtMs: Date.now(),
          serializedState: validatedCheckpoint.state
        });
        if (checkpoint) {
          if (session.live && journal.shouldCommitCheckpoint(checkpoint.revision)) {
            const commitResult = await journal.commitCheckpoint(checkpoint, {
              retainAfterRevision: this.getTerminalJournalRetentionRevision(session)
            });
            if (commitResult.committed) {
              session.terminalCheckpointValidationAttemptAtMs = undefined;
            }
          }
          session.terminalCheckpoint = checkpoint;
          this.releaseTerminalJournalMemoryThroughCheckpoint(session);
        }
      }
    }
    if (journal && !session.terminalJournalError) {
      await journal.flush();
    }
    return this.toSnapshot(session, serializedTerminalState, includeTerminalProjection);
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

  private recordTerminalCheckpointValidation(
    session: SupervisorSession,
    result: SerializedTerminalCheckpointValidationResult
  ): void {
    if (result.eligible) {
      session.terminalCheckpointLastRejectionReason = undefined;
      session.terminalCheckpointConsecutiveRejectionCount = 0;
      session.terminalCheckpointRejectionStartedAtMs = undefined;
      return;
    }

    session.terminalCheckpointLastRejectionReason = result.reason;
    session.terminalCheckpointConsecutiveRejectionCount += 1;
    session.terminalCheckpointRejectionStartedAtMs ??= Date.now();
  }

  private getTerminalCheckpointDiagnostics(
    session: SupervisorSession,
    terminalStream?: TerminalStreamAttachPayload
  ): RuntimeSupervisorTerminalCheckpointDiagnostics | undefined {
    if (!session.terminalJournal && !session.terminalCheckpoint) {
      return undefined;
    }

    const snapshotEventBytes = terminalStream
      ? terminalStream.events.reduce((total, event) => total + Buffer.byteLength(JSON.stringify(event), 'utf8'), 0)
      : undefined;
    return {
      ...(session.terminalCheckpointLastRejectionReason
        ? { lastRejectionReason: session.terminalCheckpointLastRejectionReason }
        : {}),
      consecutiveRejectionCount: session.terminalCheckpointConsecutiveRejectionCount,
      ...(session.terminalCheckpointRejectionStartedAtMs !== undefined
        ? { rejectionStartedAtMs: session.terminalCheckpointRejectionStartedAtMs }
        : {}),
      ...(session.terminalCheckpoint?.createdAtMs !== undefined
        ? { checkpointCreatedAtMs: session.terminalCheckpoint.createdAtMs }
        : {}),
      ...(terminalStream
        ? {
            snapshotEventCount: terminalStream.events.length,
            snapshotEventBytes
          }
        : {})
    };
  }

  private toSnapshot(
    session: SupervisorSession,
    serializedTerminalState = session.terminalJournal
      ? session.terminalCheckpoint?.serializedState
      : session.terminalStateTracker.getSerializedState(),
    includeTerminalProjection = true
  ): RuntimeSupervisorSessionSnapshot {
    const terminalStream = includeTerminalProjection
      ? this.buildTerminalStreamAttachPayload(session)
      : undefined;
    return {
      supervisorInstanceId: this.supervisorInstanceId,
      stateRevision: session.stateRevision,
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
      // Live snapshots must distinguish a known empty title from legacy snapshots that omit it.
      terminalTitle: session.live ? session.terminalTitle ?? null : undefined,
      outputSequence: session.outputSequence,
      serializedTerminalState: includeTerminalProjection
        ? this.getFreshSerializedTerminalState(session, serializedTerminalState)
        : undefined,
      terminalAuthorityId: session.terminalJournalError ? undefined : session.terminalAuthorityId,
      terminalRevision: session.terminalJournalError ? undefined : session.terminalJournal?.getRevision(),
      terminalProjectionIncluded: includeTerminalProjection,
      terminalStream,
      terminalCheckpointDiagnostics: this.getTerminalCheckpointDiagnostics(session, terminalStream),
      displayLabel: session.displayLabel,
      launchMode: session.launchMode,
      provider: session.provider,
      resumeStrategy: session.resumeStrategy,
      resumeSessionId: session.resumeSessionId,
      resumeStoragePath: session.resumeStoragePath,
      agentActivitySource: session.agentProviderLifecycle?.activitySource,
      agentActivityAuthority: session.agentProviderLifecycle?.activityAuthority,
      providerLifecycleEnabled: session.agentProviderLifecycle?.lifecycleEnabled,
      providerSessionId: session.agentProviderLifecycle?.providerSessionId,
      providerTurnId:
        session.agentProviderLifecycle?.activeProviderTurnId ??
        session.agentProviderLifecycle?.lastProviderTurnId,
      lastTurnOutcome: session.agentProviderLifecycle?.lastTurnOutcome,
      lastTurnError: session.agentProviderLifecycle?.lastTurnError,
      lastExitCode: session.lastExitCode,
      lastExitSignal: session.lastExitSignal,
      lastExitMessage: session.lastExitMessage,
      lastExitMessageDescriptor: session.lastExitMessageDescriptor
    };
  }

  private advanceSessionStateRevision(session: SupervisorSession): void {
    session.stateRevision = Math.min(Number.MAX_SAFE_INTEGER, session.stateRevision + 1);
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
    if (!session.live || !session.process || !session.terminalMutationAdmissionOpen) {
      throw createRuntimeSupervisorProtocolError({
        id: 'sessionNotLive',
        params: {
          sessionId
        }
      }, RUNTIME_SUPERVISOR_ERROR_CODES.sessionNotLive);
    }

    return session;
  }

  private assertTerminalMutationAdmissionOpen(session: SupervisorSession): void {
    if (!session.terminalMutationAdmissionOpen) {
      throw createRuntimeSupervisorProtocolError({
        id: 'sessionNotLive',
        params: {
          sessionId: session.sessionId
        }
      }, RUNTIME_SUPERVISOR_ERROR_CODES.sessionNotLive);
    }
  }

  private enqueueTerminalOperation<T>(
    session: SupervisorSession,
    operation: () => Promise<T> | T
  ): Promise<T> {
    const result = session.terminalOperationChain.then(operation);
    session.terminalOperationChain = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  private subscribeSocket(socket: net.Socket, sessionId: string, mode: SupervisorSubscriptionMode): void {
    const subscriptions = this.subscriptions.get(socket);
    if (!subscriptions) {
      return;
    }

    subscriptions.set(sessionId, mode);
  }

  private deferSocketSubscription(socket: net.Socket, sessionId: string, revision: number): void {
    this.subscribeSocket(socket, sessionId, 'control-only');
    this.deferredSubscriptionRevisions.get(socket)?.set(sessionId, revision);
  }

  private clearDeferredSubscription(socket: net.Socket, sessionId: string): void {
    this.deferredSubscriptionRevisions.get(socket)?.delete(sessionId);
  }

  private releaseTerminalProjectionStream(
    socket: net.Socket,
    projectionId: string,
    options: { releaseTailBarrier?: boolean } = {}
  ): boolean {
    const streams = this.terminalProjectionStreams.get(socket);
    const stream = streams?.get(projectionId);
    const tailBarriers = this.terminalProjectionTailBarriers.get(socket);
    const tailBarrier = tailBarriers?.get(projectionId);
    if (!stream && !tailBarrier) {
      return false;
    }
    if (stream) {
      streams?.delete(projectionId);
      stream.pin.release();
    }
    if (options.releaseTailBarrier !== false) {
      tailBarriers?.delete(projectionId);
    }
    const session = this.sessions.get(stream?.sessionId ?? tailBarrier?.sessionId ?? '');
    if (session) {
      this.releaseTerminalJournalMemoryThroughCheckpoint(session);
    }
    return true;
  }

  private clearTerminalProjectionTailBarriers(sessionId: string): void {
    for (const barriers of this.terminalProjectionTailBarriers.values()) {
      for (const [projectionId, barrier] of barriers) {
        if (barrier.sessionId === sessionId) {
          barriers.delete(projectionId);
        }
      }
    }
  }

  private requireTerminalProjectionTailBarrier(
    projectionId: string,
    expected: SupervisorTerminalProjectionIdentity
  ): LocatedTerminalProjectionTailBarrier {
    for (const barriers of this.terminalProjectionTailBarriers.values()) {
      const barrier = barriers.get(projectionId);
      if (!barrier) {
        continue;
      }
      if (
        barrier.sessionId !== expected.sessionId ||
        barrier.authorityId !== expected.authorityId ||
        barrier.targetRevision !== expected.targetRevision
      ) {
        break;
      }
      return { barriers, barrier };
    }
    throw createRuntimeSupervisorProtocolError({
      id: 'terminalRevisionInvalid',
      params: {
        sessionId: expected.sessionId,
        revision: String(expected.targetRevision)
      }
    }, RUNTIME_SUPERVISOR_ERROR_CODES.terminalRevisionInvalid);
  }

  private clearSessionTerminalProjections(sessionId: string): void {
    for (const [socket, streams] of this.terminalProjectionStreams) {
      for (const [projectionId, stream] of streams) {
        if (stream.sessionId === sessionId) {
          this.releaseTerminalProjectionStream(socket, projectionId);
        }
      }
    }
    this.clearTerminalProjectionTailBarriers(sessionId);
  }

  private clearSessionSubscriptions(sessionId: string): void {
    this.clearSessionTerminalProjections(sessionId);
    for (const subscriptions of this.subscriptions.values()) {
      subscriptions.delete(sessionId);
    }
    for (const deferredRevisions of this.deferredSubscriptionRevisions.values()) {
      deferredRevisions.delete(sessionId);
    }
    for (const appliedRevisions of this.appliedRevisionAcks.values()) {
      for (const [consumerKey, appliedRevision] of appliedRevisions) {
        if (appliedRevision.sessionId === sessionId) {
          appliedRevisions.delete(consumerKey);
        }
      }
    }
  }

  private releaseTerminalJournalMemoryThroughCheckpoint(session: SupervisorSession): void {
    const journal = session.terminalJournal;
    const checkpoint = session.terminalCheckpoint;
    if (!journal || !checkpoint) {
      return;
    }

    const retentionRevision = this.getTerminalJournalRetentionRevision(session);
    const releaseRevision = retentionRevision === undefined
      ? checkpoint.revision
      : Math.min(checkpoint.revision, retentionRevision);
    journal.releaseMemoryThrough(releaseRevision);
  }

  private getTerminalJournalRetentionRevision(session: SupervisorSession): number | undefined {
    let retentionRevision: number | undefined;
    const retainAfter = (revision: number): void => {
      retentionRevision = retentionRevision === undefined
        ? revision
        : Math.min(retentionRevision, revision);
    };
    const pinnedProjectionRevision = session.terminalJournal?.getPinnedProjectionRetentionRevision();
    if (pinnedProjectionRevision !== undefined) {
      retainAfter(pinnedProjectionRevision);
    }
    for (const deferredRevisions of this.deferredSubscriptionRevisions.values()) {
      const deferredRevision = deferredRevisions.get(session.sessionId);
      if (deferredRevision !== undefined) {
        retainAfter(deferredRevision);
      }
    }
    for (const barriers of this.terminalProjectionTailBarriers.values()) {
      for (const barrier of barriers.values()) {
        if (
          barrier.sessionId === session.sessionId &&
          barrier.authorityId === session.terminalAuthorityId
        ) {
          retainAfter(barrier.targetRevision);
        }
      }
    }
    for (const appliedRevisions of this.appliedRevisionAcks.values()) {
      for (const appliedRevision of appliedRevisions.values()) {
        if (
          appliedRevision.sessionId === session.sessionId &&
          appliedRevision.authorityId === session.terminalAuthorityId
        ) {
          retainAfter(appliedRevision.appliedRevision);
        }
      }
    }
    return retentionRevision;
  }

  private broadcastToSessionSubscribers(sessionId: string, message: RuntimeSupervisorEvent): void {
    const payload = `${JSON.stringify(message)}\n`;
    for (const [socket, subscriptions] of this.subscriptions.entries()) {
      const mode = subscriptions.get(sessionId);
      if (
        !mode ||
        socket.destroyed ||
        (message.event === 'sessionState' && mode === 'terminal-stream-v1')
      ) {
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
        supervisorInstanceId: this.supervisorInstanceId,
        ok: true
      }
    });
  }

  private cleanupSocket(socket: net.Socket): void {
    const affectedSessionIds = new Set(this.deferredSubscriptionRevisions.get(socket)?.keys() ?? []);
    for (const appliedRevision of this.appliedRevisionAcks.get(socket)?.values() ?? []) {
      affectedSessionIds.add(appliedRevision.sessionId);
    }
    for (const [projectionId, stream] of this.terminalProjectionStreams.get(socket) ?? []) {
      affectedSessionIds.add(stream.sessionId);
      this.releaseTerminalProjectionStream(socket, projectionId);
    }
    for (const [projectionId, barrier] of this.terminalProjectionTailBarriers.get(socket) ?? []) {
      affectedSessionIds.add(barrier.sessionId);
      this.releaseTerminalProjectionStream(socket, projectionId);
    }
    this.connections.delete(socket);
    this.subscriptions.delete(socket);
    this.deferredSubscriptionRevisions.delete(socket);
    this.appliedRevisionAcks.delete(socket);
    this.terminalProjectionStreams.delete(socket);
    this.terminalProjectionTailBarriers.delete(socket);
    for (const sessionId of affectedSessionIds) {
      const session = this.sessions.get(sessionId);
      if (session) {
        this.releaseTerminalJournalMemoryThroughCheckpoint(session);
      }
    }
    this.scheduleIdleShutdownIfNeeded();
  }

  private disposeSession(session: SupervisorSession, options: { terminateProcess: boolean }): void {
    session.terminalMutationAdmissionOpen = false;
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
          // The registry is a compact diagnostic/control descriptor. A new
          // Supervisor never rehydrates PTY authority from it, so do not flush
          // or serialize the terminal tracker/journal on every 120 ms persist.
          snapshot = await this.enqueueTerminalOperation(session, () =>
            this.toSnapshot(session, undefined, false)
          );
        } catch (error) {
          if (!session.terminalJournal) {
            throw error;
          }
          this.failSessionForTerminalJournal(session, error);
          snapshot = this.toSnapshot(session, undefined, false);
        }
        if (this.sessions.get(session.sessionId) !== session) {
          return undefined;
        }
        return session.terminalJournalError && session.terminalAuthorityId
          ? { ...snapshot, terminalAuthorityId: session.terminalAuthorityId }
          : snapshot;
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

  private scheduleIdleShutdownIfNeeded(): void {
    if (
      this.connections.size > 0 ||
      Array.from(this.sessions.values()).some((session) => session.live)
    ) {
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

function sliceTerminalProjectionDataChunk(
  data: string,
  dataOffset: number,
  creditBytes: number,
  createChunk: (data: string, complete: boolean) => RuntimeSupervisorTerminalProjectionChunk
): {
  chunk: RuntimeSupervisorTerminalProjectionChunk;
  payloadBytes: number;
  nextOffset: number;
} {
  if (
    !Number.isSafeInteger(dataOffset) ||
    dataOffset < 0 ||
    dataOffset > data.length ||
    splitsUtf16SurrogatePair(data, dataOffset)
  ) {
    throw new Error(`Invalid terminal projection data offset ${dataOffset}.`);
  }

  if (dataOffset === data.length) {
    const chunk = createChunk('', true);
    const payloadBytes = terminalProjectionChunkPayloadBytes(chunk);
    if (payloadBytes > creditBytes) {
      throw new Error(`Terminal projection metadata exceeds the supplied ${creditBytes}-byte credit.`);
    }
    return { chunk, payloadBytes, nextOffset: dataOffset };
  }

  const maxCodeUnits = Math.min(data.length - dataOffset, creditBytes);
  let lower = 1;
  let upper = maxCodeUnits;
  let best:
    | {
        chunk: RuntimeSupervisorTerminalProjectionChunk;
        payloadBytes: number;
        nextOffset: number;
      }
    | undefined;
  while (lower <= upper) {
    const candidateUnits = Math.floor((lower + upper) / 2);
    let nextOffset = dataOffset + candidateUnits;
    if (splitsUtf16SurrogatePair(data, nextOffset)) {
      nextOffset -= 1;
    }
    if (nextOffset <= dataOffset) {
      lower = candidateUnits + 1;
      continue;
    }

    const chunk = createChunk(data.slice(dataOffset, nextOffset), nextOffset === data.length);
    const payloadBytes = terminalProjectionChunkPayloadBytes(chunk);
    if (payloadBytes <= creditBytes) {
      best = { chunk, payloadBytes, nextOffset };
      lower = candidateUnits + 1;
    } else {
      upper = candidateUnits - 1;
    }
  }

  if (!best) {
    throw new Error(`Terminal projection credit ${creditBytes} cannot fit one Unicode code point.`);
  }
  return best;
}

function splitsUtf16SurrogatePair(data: string, offset: number): boolean {
  if (offset <= 0 || offset >= data.length) {
    return false;
  }
  const previous = data.charCodeAt(offset - 1);
  const next = data.charCodeAt(offset);
  return previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff;
}

function terminalProjectionChunkPayloadBytes(chunk: RuntimeSupervisorTerminalProjectionChunk): number {
  return Buffer.byteLength(JSON.stringify(chunk), 'utf8');
}

function terminalProjectionChunkChecksum(chunk: RuntimeSupervisorTerminalProjectionChunk): string {
  return createHash('sha256').update(JSON.stringify(chunk), 'utf8').digest('hex');
}

function appendOutputTail(existing: string, chunk: string): string {
  const combined = `${existing}${chunk}`;
  return combined.length > OUTPUT_TAIL_LIMIT ? combined.slice(-OUTPUT_TAIL_LIMIT) : combined;
}

function updateSupervisorTerminalTitle(
  session: SupervisorSession,
  chunk: string
): { terminalOutput: string; titleReports: string[]; titleUpdated: boolean } {
  const processed = processExecutionTerminalTitleControls(
    chunk,
    session.terminalTitle,
    session.terminalTitleCarryover,
    session.terminalTitleRedactionState
  );
  session.terminalTitleCarryover = processed.carryover;
  session.terminalTitleRedactionState = processed.redactionState;
  session.terminalTitle = processed.terminalTitle;
  return {
    terminalOutput: processed.terminalOutput,
    titleReports: processed.titleQueries.map((terminalTitle) => formatExecutionTerminalTitleReport(terminalTitle)),
    titleUpdated: processed.titleUpdated
  };
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

function isAgentLifecycleAwaitingInteractiveState(
  status: AgentNodeStatus | TerminalNodeStatus
): boolean {
  return status === 'starting' || status === 'resuming' || status === 'running';
}

function shouldEvaluateSupervisorAgentInteractiveState(session: SupervisorSession): boolean {
  return (
    isAgentLifecycleAwaitingInteractiveState(session.lifecycle) ||
    (session.lifecycle === 'waiting-input' &&
      isAgentHeuristicWaitingInputRecoverable(session.agentProviderLifecycle))
  );
}

function shouldRecordSupervisorAgentOutputHeuristics(session: SupervisorSession): boolean {
  return shouldEvaluateSupervisorAgentInteractiveState(session);
}

function isAgentInstructionSubmission(data: string, intent?: AgentInputIntent): boolean {
  return intent === 'submit' || (intent === undefined && /[\r\n]/.test(data));
}

function containsTerminalSuspendInput(data: string): boolean {
  return data.includes('\u001a');
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

function createExecutionSpawnProtocolError(error: unknown, file: string, cwd: string): Error {
  const cause = error instanceof Error ? error : new Error(String(error));
  const errno = readErrorCode(cause);
  return createRuntimeSupervisorProtocolError({
    id: 'executionSpawnFailed',
    params: {
      file,
      cwd,
      detail: cause.message
    }
  }, RUNTIME_SUPERVISOR_ERROR_CODES.executionSpawnFailed, {
    origin: 'execution-spawn',
    errno,
    file,
    cwd
  });
}

function readErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }

  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && code.trim() ? code.trim() : undefined;
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
