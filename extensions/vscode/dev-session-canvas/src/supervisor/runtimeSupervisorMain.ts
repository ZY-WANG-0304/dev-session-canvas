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
import {
  formatExecutionTerminalTitleReport,
  processExecutionTerminalTitleControls,
  stripExecutionTerminalTitleMarkers,
  type ExecutionTerminalTitleRedactionState
} from '../common/executionTerminalTitle';
import { assertExecutionCandidateRuntimeSupervisorStorageDir, resolveLegacyRuntimeSupervisorPathsFromStorageDir } from '../common/runtimeSupervisorPaths';
import {
  SERIALIZED_TERMINAL_CHECKPOINT_PROFILES,
  SerializedTerminalStateTracker,
  type SerializedTerminalState
} from '../common/serializedTerminalState';
import { DEFAULT_TERMINAL_SCROLLBACK, normalizeTerminalScrollback } from '../common/terminalScrollback';
import {
  TERMINAL_SESSION_STREAM_VERSION,
  buildTerminalStreamAttachPayload,
  cloneTerminalStreamCheckpoint,
  normalizeTerminalStreamAttachPayload,
  normalizeTerminalStreamCheckpoint,
  normalizeTerminalStreamRevision,
  type TerminalStreamAttachPayload,
  type TerminalStreamCheckpoint,
  type TerminalStreamEvent
} from '../common/terminalSessionStream';
import {
  TERMINAL_STREAM_PAGE_MAX_BYTES,
  TERMINAL_STREAM_PAGE_MAX_EVENTS,
  normalizeTerminalReadOutcome,
  type TerminalStreamPage,
  type TerminalStreamReadDescriptor
} from '../common/terminalStreamPaging';
import type {
  RuntimeSupervisorOpenTerminalReadParams,
  RuntimeSupervisorReadTerminalPageParams,
  RuntimeSupervisorCloseTerminalReadParams,
  RuntimeSupervisorCloseTerminalReadResult,
  RuntimeSupervisorTerminalReadOutcome
} from '../common/runtimeSupervisorProtocol';
import {
  RUNTIME_SUPERVISOR_ERROR_CODES,
  deserializeExecutionSessionLaunchSpec,
  createRuntimeSupervisorProtocolError,
  formatRuntimeSupervisorMessageDescriptor,
  serializeRuntimeSupervisorError,
  type RuntimeSupervisorAttachSessionParams,
  type RuntimeSupervisorAckSessionRevisionParams,
  type RuntimeSupervisorAckSessionRevisionResult,
  type RuntimeSupervisorAckTerminalBatchParams,
  type RuntimeSupervisorCreateSessionParams,
  type RuntimeSupervisorDeleteSessionParams,
  type RuntimeSupervisorEvent,
  type RuntimeSupervisorGetSessionCheckpointParams,
  type RuntimeSupervisorGetSessionSnapshotParams,
  type RuntimeSupervisorMessageDescriptor,
  type RuntimeSupervisorMessage,
  type RuntimeSupervisorPaths,
  type RuntimeSupervisorRequest,
  type RuntimeSupervisorResizeSessionParams,
  type RuntimeSupervisorSessionCheckpointResult,
  type RuntimeSupervisorSessionSnapshot,
  type RuntimeSupervisorStopSessionParams,
  type RuntimeSupervisorSubscribeSessionParams,
  type RuntimeSupervisorSubscribeSessionResult,
  type RuntimeSupervisorUpdateSessionScrollbackParams,
  type RuntimeSupervisorWriteInputParams
} from '../common/runtimeSupervisorProtocol';
import {
  resolveTerminalJournalSessionDirectory,
  TerminalSessionJournal,
  type TerminalJournalPageReader,
  type TerminalJournalRecoveryCandidate
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
import { assertExecutionCandidateCapabilities, assertExecutionCandidateProfile, hasExecutionAdmissionCapacity, EXECUTION_INTERACTION_LIMITS,
  type AuthorityResult, type DataBatch, type ExecutionCandidateProfile, type LaunchSpec, type ProcessResult
} from '../common/executionLifecycle';
import type { InteractionObservation, OperationObservation } from '../panel/executionSessionAdapter';
import { createNativeExecutionOwnerOptions } from '../panel/executionOwnerFactory';
import {
  acquireRuntimeSupervisorNamespace,
  assertRuntimeSupervisorNamespaceSupport,
  prepareRuntimeSupervisorSocketPath
} from './runtimeSupervisorNamespace';
import {
  ExecutionOwnerLifecycle,
  type ExecutionOwnerOptions,
  type OwnedExecution
} from '../panel/executionOwnerLifecycle';

const IDLE_SHUTDOWN_DELAY_MS = 30_000;
const TERMINAL_LIVE_DELAY_MS = 160;
const OUTPUT_TAIL_LIMIT = 6000;
const TERMINAL_CHECKPOINT_VALIDATION_RETRY_DELAY_MS = 30_000;
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
  terminalTitle?: string;
  terminalTitleCarryover?: string;
  terminalTitleRedactionState?: ExecutionTerminalTitleRedactionState;
  outputSequence: number;
  terminalAuthorityId?: string;
  terminalJournal?: TerminalSessionJournal;
  terminalJournalError?: Error;
  terminalCheckpoint?: TerminalStreamCheckpoint;
  terminalCheckpointValidationAttemptAtMs?: number;
  terminalStateTracker: SerializedTerminalStateTracker;
  terminalOperationChain: Promise<void>;
  terminalMutationAdmissionOpen: boolean;
  finalizationPromise?: Promise<void>;
  retiring?: true;
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
  ownedExecution?: OwnedExecution;
  ownedResizeObservation?: InteractionObservation;
  ownedMutationError?: string;
  ownedProcessResult?: ProcessResult;
  ownedReaderAdmissionOpen?: boolean;
  ownedReaderSockets?: Set<net.Socket>;
  ownedReaders?: Map<string, OwnedTerminalReader>;
  ownedReaderResults?: Record<TerminalReaderResult['kind'], number>;
}

interface RestoredTerminalJournalCandidate {
  terminalStateTracker: SerializedTerminalStateTracker;
  terminalCheckpoint: TerminalStreamCheckpoint;
  cols: number;
  rows: number;
  scrollback: number;
  output: string;
}

type SupervisorSubscriptionMode = 'legacy' | 'terminal-stream-v1' | 'terminal-stream-paged' | 'terminal-stream-paged-completion'
  | 'terminal-host-credit';

interface HostOutputSubscription {
  socket: net.Socket;
  session: SupervisorSession;
  authorityId: string;
  subscriptionId: string;
  appliedRevision: number;
  nextBatchId: number;
  stateVersion: number;
  appliedStateVersion: number;
  scheduled: boolean;
  pumping: boolean;
  pageReader?: TerminalJournalPageReader;
  inFlight?: { batchId: number; revision: number; stateVersion: number; completed: boolean; error: boolean };
}

interface HostOutputSocketScheduler {
  scheduled: boolean;
  pumping: boolean;
  cursorSessionId?: string;
}

interface TerminalReadCursor {
  readId: string;
  sessionId: string;
  authorityId: string;
  consumerId: 'editor' | 'panel';
  appliedRevision: number;
  sentRevision: number;
  checkpoint: TerminalStreamCheckpoint;
  pageReader?: TerminalJournalPageReader;
}

type TerminalReaderResult = RuntimeSupervisorTerminalReadOutcome
  | { kind: 'lost' }
  | { kind: 'legacy-released' };

interface OwnedTerminalReader {
  readId: string;
  session: SupervisorSession;
  socket: net.Socket;
  reads: Map<string, TerminalReadCursor>;
  consumerId: 'editor' | 'panel';
  authorityId: string;
  explicitSettlement: boolean;
  cursor?: TerminalReadCursor;
}

interface TerminalReaderReceipt {
  sessionId: string;
  authorityId: string;
  explicitSettlement: boolean;
  outcome: TerminalReaderResult;
  expiresAt: number;
}

const OWNED_TERMINAL_READER_LIMIT = 128;
const TERMINAL_READER_RECEIPT_LIMIT = 128;
const TERMINAL_READER_RECEIPT_MS = 60_000;

type SupervisorShutdownDomain = 'execution' | 'readers' | 'registry' | 'server' | 'sockets';
type SupervisorShutdownStatus = 'pending' | 'settled' | 'failed';

interface SupervisorShutdownReport {
  readonly boundary: 'supervisor-shutdown';
  readonly kind: 'settled' | 'unconfirmed' | 'failed';
  readonly startedAt: number;
  readonly deadline: number;
  readonly pending: readonly SupervisorShutdownDomain[];
  readonly domains: Readonly<Record<SupervisorShutdownDomain, SupervisorShutdownStatus>>;
  readonly errors: Readonly<Partial<Record<SupervisorShutdownDomain, string>>>;
}

interface SupervisorShutdownBoundary {
  readonly startedAt: number;
  readonly deadline: number;
  readonly executions: readonly OwnedExecution[];
  readonly sockets: Map<net.Socket, SupervisorShutdownStatus>;
  readonly promise: Promise<SupervisorShutdownReport>;
  readonly resolve: (report: SupervisorShutdownReport) => void;
  readonly errors: Partial<Record<SupervisorShutdownDomain, string>>;
  cancelDeadline?: () => void;
  keepAlive?: NodeJS.Timeout;
  first?: SupervisorShutdownReport;
  registry: SupervisorShutdownStatus;
  server: SupervisorShutdownStatus;
  registryStarted: boolean;
  socketsEnded: boolean;
}

export class RuntimeSupervisorServer {
  private readonly sessions = new Map<string, SupervisorSession>();
  private readonly connections = new Set<net.Socket>();
  private readonly subscriptions = new Map<net.Socket, Map<string, SupervisorSubscriptionMode>>();
  private readonly hostOutputSubscriptions = new Map<net.Socket, Map<string, HostOutputSubscription>>();
  private readonly hostOutputSocketSchedulers = new WeakMap<net.Socket, HostOutputSocketScheduler>();
  private readonly hostOutputDrainListeners = new Map<net.Socket, () => void>();
  private readonly deferredSubscriptionRevisions = new Map<net.Socket, Map<string, number>>();
  private readonly terminalReads = new Map<net.Socket, Map<string, TerminalReadCursor>>();
  private readonly terminalReaderReceipts = new Map<net.Socket, Map<string, TerminalReaderReceipt>>();
  private readonly ownedTerminalReplies = new WeakMap<object, OwnedTerminalReader>();
  private readonly appliedRevisionAcks = new Map<
    net.Socket,
    Map<string, RuntimeSupervisorAckSessionRevisionResult>
  >();
  private persistTimer: NodeJS.Timeout | undefined;
  private persistRegistryChain: Promise<void> = Promise.resolve();
  private persistRegistryError: Error | undefined;
  private idleShutdownTimer: NodeJS.Timeout | undefined;
  private server: net.Server | undefined;
  private namespaceClaim: net.Server | undefined;
  private candidateStartAttempted = false;
  private readonly executionOwner?: ExecutionOwnerLifecycle;
  private shutdownBoundary?: SupervisorShutdownBoundary;

  public constructor(
    private readonly paths: RuntimeSupervisorPaths,
    private readonly runtimeBackend: RuntimeHostBackendKind,
    private readonly runtimeGuarantee: RuntimePersistenceGuarantee,
    ownerOptions?: ExecutionOwnerOptions,
    private readonly executionProfile: ExecutionCandidateProfile | undefined = ownerOptions?.profile
  ) {
    if (this.executionProfile !== undefined) {
      assertExecutionCandidateProfile(this.executionProfile);
      if (ownerOptions && (ownerOptions.profile !== this.executionProfile || ownerOptions.profileMode !== 'live-runtime')) {
        throw new Error('Supervisor execution candidate requires a matching live-runtime owner.');
      }
      if (ownerOptions) assertExecutionCandidateCapabilities(ownerOptions.capabilities, 'live-runtime');
    }
    this.executionOwner = ownerOptions ? new ExecutionOwnerLifecycle(ownerOptions) : undefined;
  }

  public prepareForShutdown(reason: string) {
    if (!this.executionOwner) {
      throw new Error('An injected execution owner is required for coordinated shutdown.');
    }
    this.clearIdleShutdownTimer();
    if (this.ownerBoundaryEnabled()) return this.prepareOwnedShutdown(reason);
    return this.executionOwner.close({ reason, permanent: true });
  }

  private ownerBoundaryEnabled(): boolean {
    return this.executionOwner?.options.capabilities.includes('execution-owner-boundary-v1') === true;
  }

  private prepareOwnedShutdown(reason: string): Promise<SupervisorShutdownReport> {
    if (this.shutdownBoundary) return this.shutdownBoundary.promise;
    const owner = this.executionOwner!;
    const startedAt = owner.options.scheduler.now();
    let resolve!: (report: SupervisorShutdownReport) => void;
    const boundary: SupervisorShutdownBoundary = {
      startedAt, deadline: startedAt + owner.options.budgets.boundaryMs!, executions: owner.list(),
      sockets: new Map([...this.connections].map(socket => [socket, 'pending'])),
      promise: new Promise(done => { resolve = done; }), resolve, errors: {},
      registry: 'pending', server: this.server ? 'pending' : 'settled', registryStarted: false, socketsEnded: false
    };
    this.shutdownBoundary = boundary;
    // A closed listener must not let Node exit naturally while shutdown responsibility remains unknown.
    boundary.keepAlive = setInterval(() => {}, IDLE_SHUTDOWN_DELAY_MS);
    owner.closeAdmission(true);
    for (const session of this.sessions.values()) {
      if (!session.ownedExecution) continue;
      session.terminalMutationAdmissionOpen = false;
      session.ownedReaderAdmissionOpen = false;
      this.settleOwnedReadersIfComplete(session);
    }
    boundary.cancelDeadline = owner.options.scheduler.scheduleDeadline(boundary.deadline, () => {
      this.observeShutdownDeadline(boundary);
    });
    for (const socket of boundary.sockets.keys()) {
      socket.once('close', () => {
        this.observeShutdownDeadline(boundary);
        boundary.sockets.set(socket, 'settled');
        this.advanceOwnedShutdown();
      });
    }
    if (this.server) {
      try {
        this.server.close(error => {
          this.observeShutdownDeadline(boundary);
          boundary.server = error ? 'failed' : 'settled';
          if (error) boundary.errors.server = error.message;
          this.advanceOwnedShutdown();
        });
      } catch (error) {
        boundary.server = 'failed';
        boundary.errors.server = error instanceof Error ? error.message : String(error);
      }
    }
    void owner.close({ reason, permanent: true }).then(
      () => this.advanceOwnedShutdown(),
      error => {
        this.observeShutdownDeadline(boundary);
        boundary.errors.execution = error instanceof Error ? error.message : String(error);
        this.finishOwnedShutdown(boundary, 'failed');
      }
    );
    this.advanceOwnedShutdown();
    return boundary.promise;
  }

  private shutdownDomains(boundary: SupervisorShutdownBoundary): Record<SupervisorShutdownDomain, SupervisorShutdownStatus> {
    const legacySubscriptions = [...this.subscriptions.values(), ...this.deferredSubscriptionRevisions.values()]
      .some(subscriptions => [...subscriptions.keys()].some(sessionId => {
        const session = this.sessions.get(sessionId);
        return session && !session.ownedExecution;
      }));
    return {
      execution: boundary.errors.execution ? 'failed'
        : boundary.executions.some(execution => !execution.snapshot().settled)
          || [...this.sessions.values()].some(session => session.live && !session.ownedExecution) ? 'pending' : 'settled',
      readers: boundary.executions.some(execution => execution.snapshot().readerOutcome === 'pending')
        || [...this.terminalReads.values()].some(reads => reads.size > 0)
        || this.hostOutputSubscriptions.size > 0 || legacySubscriptions ? 'pending' : 'settled',
      registry: boundary.registry,
      server: boundary.server,
      sockets: boundary.errors.sockets ? 'failed'
        : [...boundary.sockets.values()].some(status => status !== 'settled') ? 'pending' : 'settled'
    };
  }

  private finishOwnedShutdown(boundary: SupervisorShutdownBoundary, kind: SupervisorShutdownReport['kind']): void {
    if (boundary.first) return;
    const domains = Object.freeze(this.shutdownDomains(boundary));
    boundary.first = Object.freeze({
      boundary: 'supervisor-shutdown', kind, startedAt: boundary.startedAt, deadline: boundary.deadline,
      domains, pending: Object.freeze((Object.keys(domains) as SupervisorShutdownDomain[])
        .filter(domain => domains[domain] !== 'settled')), errors: Object.freeze({ ...boundary.errors })
    });
    boundary.cancelDeadline?.();
    if (kind === 'settled' && boundary.keepAlive) {
      clearInterval(boundary.keepAlive);
      boundary.keepAlive = undefined;
    }
    boundary.resolve(boundary.first);
  }

  private observeShutdownDeadline(boundary: SupervisorShutdownBoundary): void {
    if (!boundary.first && this.executionOwner!.options.scheduler.now() >= boundary.deadline) {
      this.finishOwnedShutdown(boundary, 'unconfirmed');
    }
  }

  private advanceOwnedShutdown(): void {
    const boundary = this.shutdownBoundary;
    if (!boundary) return;
    this.observeShutdownDeadline(boundary);
    if (boundary.first) return;
    const domains = this.shutdownDomains(boundary);
    if (Object.values(domains).includes('failed')) {
      this.finishOwnedShutdown(boundary, 'failed');
      return;
    }
    if (this.executionOwner!.snapshot().pending > 0 || domains.execution !== 'settled' || domains.readers !== 'settled') return;
    if (!boundary.registryStarted) {
      boundary.registryStarted = true;
      void this.flushRegistryBeforeShutdown(true).then(
        () => {
          this.observeShutdownDeadline(boundary);
          boundary.registry = 'settled';
          this.advanceOwnedShutdown();
        },
        error => {
          this.observeShutdownDeadline(boundary);
          boundary.registry = 'failed';
          boundary.errors.registry = error instanceof Error ? error.message : String(error);
          this.advanceOwnedShutdown();
        }
      );
      return;
    }
    if (boundary.registry !== 'settled') return;
    if (!boundary.socketsEnded) {
      boundary.socketsEnded = true;
      for (const [socket, status] of boundary.sockets) {
        if (status === 'settled') continue;
        this.observeShutdownDeadline(boundary);
        if (boundary.first) return;
        try { socket.end(); }
        catch (error) {
          boundary.errors.sockets = error instanceof Error ? error.message : String(error);
          this.finishOwnedShutdown(boundary, 'failed');
          return;
        }
      }
    }
    if (Object.values(this.shutdownDomains(boundary)).every(status => status === 'settled')) {
      this.finishOwnedShutdown(boundary, 'settled');
    }
  }

  private assertOwnedAdmissionOpen(session?: SupervisorSession): void {
    if (this.shutdownBoundary && (!session || session.ownedExecution)) {
      throw new Error('Supervisor shutdown admission is closed.');
    }
  }

  public async start(): Promise<void> {
    this.assertOwnedAdmissionOpen();
    const options = this.executionOwner?.options;
    const nativeClaim = options?.kind === 'macos-provider' || options?.kind === 'linux-provider'
      ? options.claimNamespace : undefined;
    if (this.executionProfile !== undefined) {
      if (this.candidateStartAttempted) throw new Error('Execution candidate Supervisor startup was already attempted.');
      this.candidateStartAttempted = true;
      assertRuntimeSupervisorNamespaceSupport(nativeClaim);
    }
    fs.mkdirSync(this.paths.storageDir, { recursive: true, ...(nativeClaim ? { mode: 0o700 } : {}) });
    if (this.executionProfile !== undefined) {
      this.namespaceClaim = await acquireRuntimeSupervisorNamespace(this.paths.storageDir, nativeClaim);
      await prepareRuntimeSupervisorSocketPath(this.paths.socketPath);
      const canonicalStorageDir = await fs.promises.realpath(this.paths.storageDir);
      assertExecutionCandidateRuntimeSupervisorStorageDir(canonicalStorageDir, this.executionProfile);
      if (path.resolve(this.paths.registryPath) !== path.join(path.resolve(this.paths.storageDir), 'registry.json')) {
        throw new Error('Execution candidate registry must belong to its isolated runtime storage.');
      }
      // Only a new exclusive owner may discard stale runtime history; reconnects never enter this path.
      await fs.promises.rm(path.join(canonicalStorageDir, 'registry.json'), { force: true });
      await fs.promises.rm(path.join(canonicalStorageDir, 'terminal-journals'), { recursive: true, force: true });
    }
    ensureSocketDirectoryReady(this.paths);
    if (this.executionProfile === undefined) await this.loadRegistry();
    this.assertOwnedAdmissionOpen();
    await this.listen();
    this.scheduleIdleShutdownIfNeeded();
  }

  private async listen(): Promise<void> {
    if (this.executionProfile === undefined && process.platform !== 'win32' && fs.existsSync(this.paths.socketPath)) {
      fs.unlinkSync(this.paths.socketPath);
    }

    this.server = net.createServer((socket) => this.acceptSocket(socket));

    await new Promise<void>((resolve, reject) => {
      this.server?.once('error', reject);
      this.server?.listen(this.paths.socketPath, () => {
        this.server?.removeListener('error', reject);
        resolve();
      });
    });
  }

  private acceptSocket(socket: net.Socket): void {
    if (this.shutdownBoundary) {
      socket.destroy();
      return;
    }
    this.connections.add(socket);
    this.subscriptions.set(socket, new Map());
    this.deferredSubscriptionRevisions.set(socket, new Map());
    this.terminalReads.set(socket, new Map());
    this.appliedRevisionAcks.set(socket, new Map());
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
                terminalSessionStreamV1: true,
                terminalProjectionSnapshotV1: true,
                terminalAppliedRevisionAckV1: true,
                terminalCheckpointRefreshV1: true,
                terminalPagedReadV1: true,
                terminalPagedCompletionV1: true,
                terminalHostOutputCreditV1: true,
                ...(this.executionOwner?.options.capabilities.includes('terminal-read-settlement-v1')
                  ? { terminalReadSettlementV1: true as const } : {}),
                ...(this.executionProfile && this.executionOwner
                  ? { executionCandidateProfiles: [this.executionProfile] } : {})
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
        case 'openTerminalRead': {
          const result = await this.openTerminalRead(socket, request.params);
          this.publishTerminalRead(socket, request.id, result);
          return;
        }
        case 'readTerminalPage': {
          const result = await this.readTerminalPage(socket, request.params);
          this.publishTerminalRead(socket, request.id, result);
          return;
        }
        case 'closeTerminalRead': {
          const result = await this.closeTerminalRead(socket, request.params);
          this.writeMessage(socket, { type: 'response', id: request.id, ok: true, result });
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
        case 'getSessionCheckpoint': {
          const result = await this.getSessionCheckpoint(request.params);
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
        case 'ackTerminalBatch':
          this.ackTerminalBatch(socket, request.params);
          this.writeOkResponse(socket, request.id);
          return;
        case 'writeInput':
          await this.writeInput(request.params);
          this.writeOkResponse(socket, request.id);
          return;
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
    if (params.executionProfile !== undefined) assertExecutionCandidateProfile(params.executionProfile);
    if (params.executionProfile !== this.executionProfile) {
      throw new Error('Execution candidate profile does not match this Supervisor.');
    }
    if (this.executionProfile && !this.executionOwner) {
      throw new Error('Execution candidate provider factory is unavailable.');
    }
    this.assertOwnedAdmissionOpen();
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
    const owner = this.executionOwner;
    if (owner?.admissionLimits.executions === null) {
      owner.assertAdmission();
      const owned = owner.snapshot();
      let retainedRetirements = 0;
      for (const retained of this.sessions.values()) {
        const execution = retained.ownedExecution;
        if (execution?.snapshot().retired && owner.get(execution.key) !== execution) retainedRetirements++;
      }
      // Reader retirement does not release the terminal model or its pending storage cleanup.
      if (!hasExecutionAdmissionCapacity(owner.admissionLimits, {
        executions: owned.pending + retainedRetirements,
        pending: owned.admissionPending + retainedRetirements
      })) throw new Error('Execution start was rejected-before-acquire.');
    }
    const ownedExecution = this.executionOwner?.reserve(sessionId, sessionId);
    let terminalJournal: TerminalSessionJournal;
    try {
      terminalJournal = await TerminalSessionJournal.create({
        storageDir: this.paths.storageDir,
        sessionId,
        initialCols: params.launchSpec.cols,
        initialRows: params.launchSpec.rows,
        initialScrollback: scrollback,
        checkpointProfiles: SERIALIZED_TERMINAL_CHECKPOINT_PROFILES
      });
    } catch (error) {
      // A rejected create may already have written part of its journal; retain the reservation.
      if (ownedExecution) void ownedExecution.requestStop('Terminal journal preparation is unconfirmed.');
      throw error;
    }
    if (ownedExecution && this.shutdownBoundary) {
      await terminalJournal.delete();
      ownedExecution.abandon('Supervisor closed during terminal journal preparation.');
      this.advanceOwnedShutdown();
      throw new Error('Supervisor shutdown admission is closed.');
    }
    let process: ExecutionSessionProcess | undefined;
    try {
      if (!ownedExecution) process = createExecutionSessionProcess(launchSpec);
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
      process,
      ...(ownedExecution ? { ownedExecution, ownedReaderAdmissionOpen: true,
        ...(this.executionOwner!.options.capabilities.includes('terminal-read-settlement-v1')
          ? { ownedReaders: new Map<string, OwnedTerminalReader>(),
            ownedReaderResults: { applied: 0, cancelled: 0, lost: 0, 'legacy-released': 0 } }
          : { ownedReaderSockets: new Set(socket.destroyed ? [] : [socket]) }) } : {})
    };
    this.sessions.set(sessionId, session);
    if (params.deferSubscription !== true) {
      this.subscribeSocket(socket, sessionId, params.terminalStreamMode === 'paged-until-exit'
        ? 'terminal-stream-paged-completion' : params.terminalStreamMode === 'paged' ? 'terminal-stream-paged' : 'legacy');
    }
    if (ownedExecution) {
      try {
        const starting = this.bindOwnedExecution(session, {
          file: launchSpec.file, args: launchSpec.args ?? [], cwd: launchSpec.cwd,
          ...(this.executionOwner?.options.profile ? { cols: session.cols, rows: session.rows,
            stopStrategy: session.kind === 'agent' && session.provider !== 'claude'
              ? 'interrupt-then-hangup' as const : 'hangup' as const } : {}),
          env: Object.fromEntries(Object.entries(launchSpec.env).filter((entry): entry is [string, string] =>
            typeof entry[1] === 'string'))
        });
        const started = await starting.first;
        if (started.kind !== 'started') {
          throw new Error(`Execution start was ${started.kind}.`);
        }
        if (this.sessions.get(sessionId) !== session || ownedExecution.snapshot().stopRequested) {
          throw new Error('Execution creation was superseded or closed while starting.');
        }
      } catch (error) {
        const acquired = Object.keys(ownedExecution.snapshot().adapter?.resources ?? {}).length > 0;
        if (acquired) {
          session.live = false;
          session.lifecycle = 'error';
          void ownedExecution.requestStop('Execution startup did not complete.');
          throw error;
        }
        await terminalJournal.delete();
        if (this.sessions.get(sessionId) === session) {
          this.clearSessionSubscriptions(sessionId);
          this.sessions.delete(sessionId);
        }
        terminalStateTracker.dispose();
        ownedExecution.abandon('Execution start was rejected before acquiring a provider.');
        this.advanceOwnedShutdown();
        throw error;
      }
    } else {
      this.bindSessionProcess(session);
    }

    if (session.kind === 'terminal') {
      session.lifecycleTimer = setTimeout(() => {
        const current = this.sessions.get(session.sessionId);
        if (!current || (ownedExecution && current !== session) || !current.live || current.lifecycle !== 'launching') {
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
    const snapshot = await this.toAttachSnapshot(session, params.terminalStreamMode);
    this.assertOwnedAdmissionOpen(session);
    if (params.deferSubscription === true && snapshot.terminalRevision !== undefined) {
      this.deferSocketSubscription(socket, sessionId, snapshot.terminalRevision);
    }
    return snapshot;
  }

  private async attachSession(
    socket: net.Socket,
    params: RuntimeSupervisorAttachSessionParams
  ): Promise<RuntimeSupervisorSessionSnapshot> {
    const session = this.requireSession(params.sessionId);
    this.assertOwnedAdmissionOpen();

    if (params.deferSubscription === true && session.terminalJournal && session.terminalCheckpoint) {
      this.subscriptions.get(socket)?.delete(params.sessionId);
      const snapshot = await this.toAttachSnapshot(session, params.terminalStreamMode);
      this.assertOwnedAdmissionOpen();
      if (snapshot.terminalRevision !== undefined) {
        this.deferSocketSubscription(socket, params.sessionId, snapshot.terminalRevision);
      }
      return snapshot;
    }

    this.clearDeferredSubscription(socket, params.sessionId);
    if (params.terminalStreamMode) {
      this.subscribeSocket(socket, params.sessionId, params.terminalStreamMode === 'paged-until-exit'
        ? 'terminal-stream-paged-completion' : 'terminal-stream-paged');
      const snapshot = await this.toAttachSnapshot(session, params.terminalStreamMode);
      this.assertOwnedAdmissionOpen();
      return snapshot;
    }
    this.subscribeSocket(socket, params.sessionId, 'legacy');
    const snapshot = await this.toFreshSnapshot(session);
    this.assertOwnedAdmissionOpen();
    return snapshot;
  }

  private getSessionSnapshot(
    params: RuntimeSupervisorGetSessionSnapshotParams
  ): Promise<RuntimeSupervisorSessionSnapshot> {
    return this.toFreshSnapshot(this.requireSession(params.sessionId));
  }

  private toAttachSnapshot(
    session: SupervisorSession,
    mode: RuntimeSupervisorAttachSessionParams['terminalStreamMode']
  ): Promise<RuntimeSupervisorSessionSnapshot> {
    return this.enqueueTerminalOperation(session, async () => {
      this.requireSession(session.sessionId);
      const paged = mode !== undefined && Boolean(session.terminalJournal && session.terminalCheckpoint) &&
        !session.terminalJournalError && (session.live || mode === 'paged-until-exit');
      const snapshot = await this.createFreshSnapshot(session, 'always', !paged);
      return paged
        ? { ...snapshot, output: snapshot.live ? snapshot.output : '', terminalStreamPaged: true }
        : snapshot;
    });
  }

  private requireReadableJournal(session: SupervisorSession, authorityId: string): TerminalSessionJournal {
    if (authorityId !== session.terminalAuthorityId) {
      throw createRuntimeSupervisorProtocolError({ id: 'terminalAuthorityMismatch',
        params: { sessionId: session.sessionId } }, RUNTIME_SUPERVISOR_ERROR_CODES.terminalAuthorityMismatch);
    }
    if (!session.terminalJournal || !session.terminalCheckpoint || session.terminalJournalError) {
      throw createRuntimeSupervisorProtocolError({ id: 'terminalJournalUnavailable',
        params: { sessionId: session.sessionId } }, RUNTIME_SUPERVISOR_ERROR_CODES.terminalJournalUnavailable);
    }
    return session.terminalJournal;
  }

  private async openTerminalRead(
    socket: net.Socket,
    params: RuntimeSupervisorOpenTerminalReadParams
  ): Promise<TerminalStreamReadDescriptor> {
    const session = this.requireSession(params.sessionId);
    this.assertOwnedAdmissionOpen();
    if (params.settlementMode !== undefined &&
        (params.settlementMode !== 'final-application-v1' || !session.ownedReaders)) {
      throw new Error('Terminal reader settlement capability is unavailable.');
    }
    const owned = session.ownedReaders ? this.admitOwnedTerminalReader(session, socket, params) : undefined;
    return this.enqueueTerminalOperation(session, async () => {
      this.requireSession(params.sessionId, Boolean(owned));
      if (owned) this.assertOwnedTerminalReader(owned);
      if (session.ownedExecution && this.sessions.get(session.sessionId) !== session) {
        throw new Error('Terminal reader belongs to a replaced execution.');
      }
      if (session.ownedExecution && !owned && !session.ownedReaderAdmissionOpen) {
        throw new Error('The execution final revision is fixed; new readers are closed.');
      }
      const journal = this.requireReadableJournal(session, params.authorityId);
      const reads = this.terminalReads.get(socket);
      if (!reads || socket.destroyed || (params.consumerId !== 'editor' && params.consumerId !== 'panel')) {
        throw new Error('Invalid terminal reader connection or consumer.');
      }
      await this.createFreshSnapshot(session, 'always', false);
      if (!owned) this.assertOwnedAdmissionOpen();
      if (owned) this.assertOwnedTerminalReader(owned);
      if (session.ownedExecution) {
        if (this.sessions.get(session.sessionId) !== session) {
          throw new Error('Terminal reader belongs to a replaced execution.');
        }
        if (socket.destroyed || this.terminalReads.get(socket) !== reads) {
          throw new Error('Terminal reader connection closed while preparing its checkpoint.');
        }
      }
      const checkpoint = session.terminalCheckpoint!;
      const readId = owned?.readId ?? randomUUID();
      // A socket owns at most one reader per session and surface.
      for (const [id, read] of reads) {
        if (read.sessionId === session.sessionId && read.consumerId === params.consumerId) {
          this.disposeJournalPageReader(read);
          reads.delete(id);
        }
      }
      const cursor = { readId, sessionId: session.sessionId, authorityId: journal.getAuthorityId(),
        consumerId: params.consumerId, appliedRevision: checkpoint.revision,
        sentRevision: owned ? -1 : checkpoint.revision,
        checkpoint: cloneTerminalStreamCheckpoint(checkpoint) };
      reads.set(readId, cursor);
      if (owned) owned.cursor = cursor;
      session.ownedReaderSockets?.add(socket);
      const result = { readId, sessionId: session.sessionId, authorityId: journal.getAuthorityId(),
        checkpoint: cloneTerminalStreamCheckpoint(checkpoint), headRevision: journal.getRevision(),
        ...(owned?.explicitSettlement ? { settlementMode: 'final-application-v1' as const } : {}) };
      if (owned) this.ownedTerminalReplies.set(result, owned);
      return result;
    }).catch(error => {
      if (owned) this.settleOwnedTerminalReader(owned, { kind: 'lost' });
      throw error;
    });
  }

  private readTerminalPage(socket: net.Socket, params: RuntimeSupervisorReadTerminalPageParams): Promise<TerminalStreamPage> {
    const session = this.requireSession(params.sessionId, true);
    return this.enqueueTerminalOperation(session, async () => {
      const journal = this.requireReadableJournal(session, params.authorityId);
      const read = this.terminalReads.get(socket)?.get(params.readId);
      const owned = session.ownedReaders?.get(params.readId);
      if (session.ownedReaders) {
        if (!owned || !read || owned.socket !== socket || owned.cursor !== read) {
          throw new Error('Terminal reader is no longer current.');
        }
        this.assertOwnedTerminalReader(owned);
        if (read.sentRevision < 0) throw new Error('Terminal reader checkpoint has not been sent.');
      }
      const afterRevision = normalizeTerminalStreamRevision(params.afterRevision);
      if (!read || read.sessionId !== params.sessionId || read.authorityId !== params.authorityId ||
          afterRevision === undefined ||
          (afterRevision !== read.appliedRevision && afterRevision !== read.sentRevision)) {
        throw createRuntimeSupervisorProtocolError({ id: 'terminalRevisionInvalid',
          params: { sessionId: params.sessionId, revision: String(params.afterRevision) }
        }, RUNTIME_SUPERVISOR_ERROR_CODES.terminalRevisionInvalid);
      }
      const headRevision = journal.getRevision();
      const events = await this.readJournalPage(read, journal, afterRevision, headRevision);
      const revision = events[events.length - 1]?.revision ?? afterRevision;
      if (owned) this.assertOwnedTerminalReader(owned);
      if (socket.destroyed || this.terminalReads.get(socket)?.get(params.readId) !== read) {
        this.disposeJournalPageReader(read);
        throw new Error('Terminal reader is no longer current.');
      }
      read.appliedRevision = afterRevision;
      if (!owned) read.sentRevision = revision;
      if (session.terminalCheckpoint && session.terminalCheckpoint.revision <= afterRevision &&
          session.terminalCheckpoint.revision > read.checkpoint.revision) {
        read.checkpoint = cloneTerminalStreamCheckpoint(session.terminalCheckpoint);
      }
      const result = { readId: read.readId, sessionId: session.sessionId, authorityId: read.authorityId,
        afterRevision, revision, headRevision, events };
      if (owned) this.ownedTerminalReplies.set(result, owned);
      return result;
    });
  }

  private async readJournalPage(
    consumer: { pageReader?: TerminalJournalPageReader }, journal: TerminalSessionJournal,
    afterRevision: number, throughRevision: number
  ): Promise<TerminalStreamEvent[]> {
    // Retain only the authenticated index between requests, never a live journal
    // iterator or compaction pin while the consumer is processing its page.
    const reader = consumer.pageReader ??= journal.createPageReader({
      pageMaxBytes: TERMINAL_STREAM_PAGE_MAX_BYTES, pageMaxEvents: TERMINAL_STREAM_PAGE_MAX_EVENTS
    });
    try {
      const events = await reader.readAfter(afterRevision, throughRevision);
      if (consumer.pageReader !== reader) throw new Error('Terminal journal page reader is no longer current.');
      return events;
    } catch (error) {
      reader.dispose();
      if (consumer.pageReader === reader) consumer.pageReader = undefined;
      throw error;
    }
  }

  private disposeJournalPageReader(consumer: { pageReader?: TerminalJournalPageReader }): void {
    const reader = consumer.pageReader;
    consumer.pageReader = undefined;
    reader?.dispose();
  }

  private async closeTerminalRead(
    socket: net.Socket, params: RuntimeSupervisorCloseTerminalReadParams
  ): Promise<RuntimeSupervisorCloseTerminalReadResult> {
    const session = this.sessions.get(params.sessionId);
    const explicit = params.outcome !== undefined;
    const outcome = explicit ? this.validateTerminalReaderOutcome(params.outcome) : { kind: 'legacy-released' } as const;
    const receipts = this.pruneTerminalReaderReceipts(socket);
    const receipt = receipts?.get(params.readId);
    if (receipt) {
      if (explicit && !receipt.explicitSettlement) throw new Error('Terminal reader settlement was not negotiated.');
      if (receipt.sessionId !== params.sessionId || receipt.authorityId !== params.authorityId ||
          JSON.stringify(receipt.outcome) !== JSON.stringify(outcome)) {
        throw new Error('Terminal reader settlement conflicts with the recorded result.');
      }
      return { ok: true, settlement: 'duplicate' };
    }
    if (explicit && !this.executionOwner?.options.capabilities.includes('terminal-read-settlement-v1')) {
      throw new Error('Terminal reader settlement capability is unavailable.');
    }
    if (session?.ownedReaders) {
      const owned = session.ownedReaders.get(params.readId);
      if (!owned || owned.socket !== socket) return { ok: true, settlement: 'unconfirmed' };
      this.assertOwnedTerminalReader(owned);
      if (owned.authorityId !== params.authorityId) throw new Error('Terminal reader authority does not match.');
      if (explicit && !owned.explicitSettlement) throw new Error('Terminal reader settlement was not negotiated.');
      if (outcome.kind === 'applied') {
        const terminal = session.ownedExecution!.snapshot().terminal;
        if (terminal?.kind !== 'applied' || terminal.finalRevision !== outcome.finalRevision ||
            !owned.cursor || owned.cursor.sentRevision < outcome.finalRevision) {
          throw new Error('Terminal reader final revision is not fixed or has not been sent.');
        }
      }
      this.settleOwnedTerminalReader(owned, outcome);
      if (session.retiring) await this.enqueueTerminalOperation(session, () => this.finishSessionRetirement(session));
      return { ok: true, settlement: 'recorded' };
    }
    if (explicit) {
      if (session) throw new Error('Terminal reader settlement capability is unavailable for this session.');
      return { ok: true, settlement: 'unconfirmed' };
    }
    const reads = this.terminalReads.get(socket);
    const read = reads?.get(params.readId);
    if (read?.sessionId === params.sessionId && read.authorityId === params.authorityId) {
      this.disposeJournalPageReader(read);
      reads?.delete(params.readId);
      const session = this.sessions.get(params.sessionId);
      if (session?.retiring) {
        await this.enqueueTerminalOperation(session, () => this.finishSessionRetirement(session));
      }
    }
    this.advanceOwnedShutdown();
    return { ok: true };
  }

  private admitOwnedTerminalReader(
    session: SupervisorSession, socket: net.Socket, params: RuntimeSupervisorOpenTerminalReadParams
  ): OwnedTerminalReader {
    if (!session.ownedReaderAdmissionOpen) throw new Error('The execution final revision is fixed; new readers are closed.');
    this.requireReadableJournal(session, params.authorityId);
    const reads = this.terminalReads.get(socket);
    if (!reads || socket.destroyed || (params.consumerId !== 'editor' && params.consumerId !== 'panel')) {
      throw new Error('Invalid terminal reader connection or consumer.');
    }
    if (session.ownedReaders!.size >= OWNED_TERMINAL_READER_LIMIT) throw new Error('Terminal reader capacity exhausted.');
    const owned: OwnedTerminalReader = { readId: randomUUID(), session, socket, reads,
      consumerId: params.consumerId, authorityId: params.authorityId,
      explicitSettlement: params.settlementMode === 'final-application-v1' };
    for (const previous of session.ownedReaders!.values()) {
      if (previous.socket === socket && previous.consumerId === params.consumerId) {
        this.settleOwnedTerminalReader(previous, { kind: 'cancelled', reason: 'reader-replaced' });
      }
    }
    session.ownedReaders!.set(owned.readId, owned);
    return owned;
  }

  private assertOwnedTerminalReader(owned: OwnedTerminalReader): void {
    if (this.sessions.get(owned.session.sessionId) !== owned.session) {
      this.settleOwnedTerminalReader(owned, { kind: 'lost' });
      throw new Error('Terminal reader belongs to a replaced execution.');
    }
    if (owned.socket.destroyed || this.terminalReads.get(owned.socket) !== owned.reads) {
      this.settleOwnedTerminalReader(owned, { kind: 'lost' });
      throw new Error('Terminal reader connection is no longer current.');
    }
    if (owned.session.ownedReaders?.get(owned.readId) !== owned ||
        (owned.cursor && owned.reads.get(owned.readId) !== owned.cursor)) {
      throw new Error('Terminal reader is no longer current.');
    }
  }

  private publishTerminalRead(socket: net.Socket, id: string, result: TerminalStreamReadDescriptor | TerminalStreamPage): void {
    const owned = this.ownedTerminalReplies.get(result);
    if (owned) {
      // A result may have outlived its cursor while handleRequest was awaiting it.
      if (owned.socket !== socket || owned.authorityId !== result.authorityId) {
        throw new Error('Terminal reader reply is no longer current.');
      }
      this.assertOwnedTerminalReader(owned);
      try {
        this.writeMessage(socket, { type: 'response', id, ok: true, result });
      } catch (error) {
        this.settleOwnedTerminalReader(owned, { kind: 'lost' });
        throw error;
      }
      this.assertOwnedTerminalReader(owned);
      owned.cursor!.sentRevision = Math.max(owned.cursor!.sentRevision,
        'checkpoint' in result ? result.checkpoint.revision : result.revision);
      this.ownedTerminalReplies.delete(result);
      return;
    }
    this.writeMessage(socket, { type: 'response', id, ok: true, result });
  }

  private validateTerminalReaderOutcome(outcome: unknown): RuntimeSupervisorTerminalReadOutcome {
    const normalized = normalizeTerminalReadOutcome(outcome);
    if (!normalized) throw new Error('Invalid terminal reader outcome.');
    return normalized;
  }

  private pruneTerminalReaderReceipts(socket: net.Socket): Map<string, TerminalReaderReceipt> | undefined {
    const receipts = this.terminalReaderReceipts.get(socket);
    const now = this.executionOwner?.options.scheduler.now() ?? 0;
    for (const [id, receipt] of receipts ?? []) {
      if (receipt.expiresAt <= now) receipts!.delete(id);
    }
    if (receipts?.size === 0) this.terminalReaderReceipts.delete(socket);
    return receipts;
  }

  private settleOwnedTerminalReader(owned: OwnedTerminalReader, outcome: TerminalReaderResult): void {
    const session = owned.session;
    if (session.ownedReaders?.get(owned.readId) !== owned) return;
    if (!owned.socket.destroyed && this.terminalReads.get(owned.socket) === owned.reads) {
      const receipts = this.pruneTerminalReaderReceipts(owned.socket) ?? new Map<string, TerminalReaderReceipt>();
      receipts.set(owned.readId, { sessionId: session.sessionId, authorityId: owned.authorityId,
        explicitSettlement: owned.explicitSettlement,
        outcome: { ...outcome }, expiresAt: this.executionOwner!.options.scheduler.now() + TERMINAL_READER_RECEIPT_MS });
      while (receipts.size > TERMINAL_READER_RECEIPT_LIMIT) receipts.delete(receipts.keys().next().value!);
      this.terminalReaderReceipts.set(owned.socket, receipts);
    }
    session.ownedReaderResults![outcome.kind]++;
    session.ownedReaders.delete(owned.readId);
    if (owned.cursor) this.disposeJournalPageReader(owned.cursor);
    if (owned.cursor && owned.reads.get(owned.readId) === owned.cursor) owned.reads.delete(owned.readId);
    this.settleOwnedReadersIfComplete(session);
  }

  private settleOwnedReadersIfComplete(session: SupervisorSession): void {
    if (!session.ownedReaderAdmissionOpen && session.ownedReaders?.size === 0) {
      session.ownedExecution!.settleReaders('settled');
    }
  }

  private getSessionCheckpoint(
    params: RuntimeSupervisorGetSessionCheckpointParams
  ): Promise<RuntimeSupervisorSessionCheckpointResult> {
    const session = this.requireSession(params.sessionId);
    return this.enqueueTerminalOperation(session, async () => {
      const journal = session.terminalJournal;
      if (session.terminalJournalError || !journal || !session.terminalCheckpoint) {
        throw createRuntimeSupervisorProtocolError({
          id: 'terminalJournalUnavailable',
          params: { sessionId: session.sessionId }
        }, RUNTIME_SUPERVISOR_ERROR_CODES.terminalJournalUnavailable);
      }
      if (params.authorityId !== session.terminalAuthorityId) {
        throw createRuntimeSupervisorProtocolError({
          id: 'terminalAuthorityMismatch',
          params: { sessionId: session.sessionId }
        }, RUNTIME_SUPERVISOR_ERROR_CODES.terminalAuthorityMismatch);
      }
      const afterRevision = normalizeTerminalStreamRevision(params.afterCheckpointRevision);
      if (afterRevision === undefined || afterRevision > journal.getRevision()) {
        throw createRuntimeSupervisorProtocolError({
          id: 'terminalRevisionInvalid',
          params: { sessionId: session.sessionId, revision: String(params.afterCheckpointRevision) }
        }, RUNTIME_SUPERVISOR_ERROR_CODES.terminalRevisionInvalid);
      }

      // Refresh the verified checkpoint without collecting the journal suffix.
      await this.createFreshSnapshot(session, 'always', false);
      if (session.terminalJournalError) {
        throw session.terminalJournalError;
      }
      const checkpoint = session.terminalCheckpoint;
      return {
        sessionId: session.sessionId,
        authorityId: journal.getAuthorityId(),
        revision: journal.getRevision(),
        ...(checkpoint.revision > afterRevision
          ? { checkpoint: cloneTerminalStreamCheckpoint(checkpoint) }
          : {})
      };
    });
  }

  private subscribeSession(
    socket: net.Socket,
    params: RuntimeSupervisorSubscribeSessionParams
  ): Promise<RuntimeSupervisorSubscribeSessionResult> {
    const session = this.requireSession(params.sessionId);
    this.assertOwnedAdmissionOpen();
    return this.enqueueTerminalOperation(session, () =>
      this.subscribeSessionAtSettledRevision(socket, session, params)
    );
  }

  private async subscribeSessionAtSettledRevision(
    socket: net.Socket,
    session: SupervisorSession,
    params: RuntimeSupervisorSubscribeSessionParams
  ): Promise<RuntimeSupervisorSubscribeSessionResult> {
    this.assertOwnedAdmissionOpen();
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

    this.requireSession(params.sessionId);
    if (params.hostOutputCredit !== undefined &&
        (params.hostOutputCredit !== 'journal-pages-v1' || params.terminalStreamMode !== 'paged-until-exit')) {
      throw new Error('Host output credit requires paged-until-exit subscription.');
    }
    const paged = params.terminalStreamMode !== undefined;
    const pagedCompletion = params.terminalStreamMode === 'paged-until-exit';
    if (params.hostOutputCredit === 'journal-pages-v1') {
      if (afterRevision < journal.getRetainedStartRevision() - 1) {
        throw createRuntimeSupervisorProtocolError({ id: 'terminalRevisionInvalid',
          params: { sessionId: session.sessionId, revision: String(afterRevision) }
        }, RUNTIME_SUPERVISOR_ERROR_CODES.terminalHostCursorCompacted);
      }
      if (socket.destroyed || !this.subscriptions.has(socket) || this.sessions.get(session.sessionId) !== session) {
        throw new Error('Host output subscription is no longer current.');
      }
      this.subscribeSocket(socket, params.sessionId, 'terminal-host-credit');
      const subscriptions = this.hostOutputSubscriptions.get(socket) ?? new Map<string, HostOutputSubscription>();
      this.hostOutputSubscriptions.set(socket, subscriptions);
      const subscription: HostOutputSubscription = {
        socket, session, authorityId: session.terminalAuthorityId, subscriptionId: randomUUID(),
        appliedRevision: afterRevision, nextBatchId: 1, stateVersion: 1, appliedStateVersion: 0,
        scheduled: false, pumping: false
      };
      subscriptions.set(session.sessionId, subscription);
      this.clearDeferredSubscription(socket, params.sessionId);
      this.scheduleHostOutput(subscription);
      return { sessionId: session.sessionId, authorityId: session.terminalAuthorityId,
        revision: journal.getRevision(), subscriptionId: subscription.subscriptionId };
    }
    const snapshot = await this.createFreshSnapshot(session, 'never', !paged || (!session.live && !pagedCompletion));
    this.assertOwnedAdmissionOpen();
    if (paged) {
      for await (const page of journal.readEventPagesAfter(afterRevision)) {
        this.assertOwnedAdmissionOpen();
        for (const event of page) {
          this.writeTerminalStreamEvent(socket, session, event);
        }
        await this.waitForSocketDrain(socket);
      }
    } else {
      for (const event of await journal.getEventsAfter(afterRevision)) {
        this.assertOwnedAdmissionOpen();
        this.writeTerminalStreamEvent(socket, session, event);
      }
    }
    this.subscribeSocket(socket, params.sessionId, pagedCompletion
      ? 'terminal-stream-paged-completion' : paged ? 'terminal-stream-paged' : 'terminal-stream-v1');
    this.writeMessage(socket, {
      type: 'event',
      event: 'sessionState',
      payload: paged && (snapshot.live || pagedCompletion)
        ? { ...snapshot, output: snapshot.live ? snapshot.output : '', terminalStreamPaged: true } : snapshot
    });
    this.clearDeferredSubscription(socket, params.sessionId);
    this.releaseTerminalJournalMemoryThroughCheckpoint(session);
    return {
      sessionId: session.sessionId,
      authorityId: session.terminalAuthorityId,
      revision: journal.getRevision()
    };
  }

  private toHostOutputSnapshot(snapshot: RuntimeSupervisorSessionSnapshot): RuntimeSupervisorSessionSnapshot {
    return { ...snapshot, output: '', terminalStream: undefined, serializedTerminalState: undefined,
      terminalTitle: snapshot.live ? snapshot.terminalTitle ?? null : null, terminalStreamPaged: true };
  }

  private isHostOutputCurrent(subscription: HostOutputSubscription): boolean {
    return !subscription.socket.destroyed && this.sessions.get(subscription.session.sessionId) === subscription.session &&
      this.hostOutputSubscriptions.get(subscription.socket)?.get(subscription.session.sessionId) === subscription;
  }

  private scheduleHostOutput(subscription: HostOutputSubscription): void {
    if (!this.isHostOutputCurrent(subscription) || subscription.pumping || subscription.inFlight) return;
    subscription.scheduled = true;
    this.scheduleHostOutputSocket(subscription.socket);
  }

  private scheduleHostOutputSocket(socket: net.Socket): void {
    if (socket.destroyed) return;
    if (socket.writableNeedDrain) {
      if (!this.hostOutputDrainListeners.has(socket)) {
        const drained = (): void => {
          this.hostOutputDrainListeners.delete(socket);
          for (const pending of this.hostOutputSubscriptions.get(socket)?.values() ?? []) {
            this.scheduleHostOutput(pending);
          }
        };
        this.hostOutputDrainListeners.set(socket, drained);
        socket.once('drain', drained);
      }
      return;
    }
    const scheduler = this.hostOutputSocketSchedulers.get(socket) ?? {
      scheduled: false,
      pumping: false
    };
    this.hostOutputSocketSchedulers.set(socket, scheduler);
    if (scheduler.scheduled || scheduler.pumping) return;
    scheduler.scheduled = true;
    setImmediate(() => {
      scheduler.scheduled = false;
      this.pumpNextHostOutput(socket, scheduler);
    });
  }

  private pumpNextHostOutput(socket: net.Socket, scheduler: HostOutputSocketScheduler): void {
    if (scheduler.pumping || socket.destroyed) return;
    if (socket.writableNeedDrain) {
      // Other socket writes may introduce backpressure after this turn was queued.
      this.scheduleHostOutputSocket(socket);
      return;
    }
    const subscriptions = this.hostOutputSubscriptions.get(socket);
    if (!subscriptions || subscriptions.size === 0) return;
    const entries = [...subscriptions.values()];
    const cursorIndex = scheduler.cursorSessionId === undefined
      ? -1
      : entries.findIndex(subscription => subscription.session.sessionId === scheduler.cursorSessionId);
    let selected: HostOutputSubscription | undefined;
    for (let offset = 1; offset <= entries.length; offset += 1) {
      const candidate = entries[(cursorIndex + offset) % entries.length];
      if (candidate.scheduled && !candidate.pumping && !candidate.inFlight) {
        selected = candidate;
        break;
      }
    }
    if (!selected) return;

    selected.scheduled = false;
    scheduler.pumping = true;
    void this.pumpHostOutput(selected)
      .catch(error => console.error('Failed to deliver Host output:', error))
      .finally(() => {
        scheduler.pumping = false;
        scheduler.cursorSessionId = selected!.session.sessionId;
        // The selected subscription may have more output, while other sessions may
        // have become ready during its journal read. Pick the next one fairly.
        for (const pending of this.hostOutputSubscriptions.get(socket)?.values() ?? []) {
          if (pending.scheduled && !pending.pumping && !pending.inFlight) {
            this.scheduleHostOutputSocket(socket);
            break;
          }
        }
      });
  }

  private async pumpHostOutput(subscription: HostOutputSubscription): Promise<void> {
    if (!this.isHostOutputCurrent(subscription) || subscription.pumping || subscription.inFlight) return;
    if (subscription.socket.writableNeedDrain) {
      this.scheduleHostOutput(subscription);
      return;
    }
    subscription.pumping = true;
    const { session, socket } = subscription;
    try {
      // Only source reads enter the terminal chain; consumer credit and socket drain never hold it.
      if (!this.isHostOutputCurrent(subscription)) return;
      const result = await this.enqueueTerminalOperation(session, async () => {
        if (!this.isHostOutputCurrent(subscription)) return undefined;
        const journal = this.requireReadableJournal(session, subscription.authorityId);
        const afterRevision = subscription.appliedRevision;
        const headRevision = journal.getRevision();
        let events: TerminalStreamEvent[] = [];
        if (afterRevision < headRevision) {
          events = await this.readJournalPage(subscription, journal, afterRevision, headRevision);
          if (events.length === 0) throw new Error('Host output journal page did not advance.');
        }
        const revision = events.at(-1)?.revision ?? afterRevision;
        const snapshot = subscription.stateVersion > subscription.appliedStateVersion && revision === headRevision
          ? this.toHostOutputSnapshot(this.toSnapshot(session, undefined, false)) : undefined;
        if (events.length === 0 && !snapshot) return undefined;
        return { afterRevision, revision, events, snapshot,
          stateVersion: snapshot ? subscription.stateVersion : subscription.appliedStateVersion };
      });
      if (!result || !this.isHostOutputCurrent(subscription)) return;
      const batchId = subscription.nextBatchId++;
      subscription.inFlight = { batchId, revision: result.revision, stateVersion: result.stateVersion,
        completed: result.snapshot?.live === false, error: false };
      this.writeMessage(socket, { type: 'event', event: 'sessionTerminalBatch', payload: {
        sessionId: session.sessionId, kind: session.kind, authorityId: subscription.authorityId,
        subscriptionId: subscription.subscriptionId, batchId, afterRevision: result.afterRevision,
        revision: result.revision, events: result.events, emittedAtMs: Date.now(),
        ...(result.snapshot ? { snapshot: result.snapshot } : {})
      } });
    } catch (error) {
      this.disposeJournalPageReader(subscription);
      if (!this.isHostOutputCurrent(subscription) || subscription.inFlight) return;
      const batchId = subscription.nextBatchId++;
      subscription.inFlight = { batchId, revision: subscription.appliedRevision,
        stateVersion: subscription.appliedStateVersion, completed: false, error: true };
      this.writeMessage(socket, { type: 'event', event: 'sessionTerminalBatch', payload: {
        sessionId: session.sessionId, kind: session.kind, authorityId: subscription.authorityId,
        subscriptionId: subscription.subscriptionId, batchId, afterRevision: subscription.appliedRevision,
        revision: subscription.appliedRevision, events: [], emittedAtMs: Date.now(),
        error: error instanceof Error ? error.message : String(error)
      } });
    } finally {
      subscription.pumping = false;
      if ((session.terminalJournal?.getRevision() ?? 0) > subscription.appliedRevision ||
          subscription.stateVersion > subscription.appliedStateVersion) this.scheduleHostOutput(subscription);
    }
  }

  private ackTerminalBatch(socket: net.Socket, params: RuntimeSupervisorAckTerminalBatchParams): void {
    if ((params.outcome !== 'consumed' && params.outcome !== 'cancelled') ||
        !Number.isSafeInteger(params.batchId) || params.batchId <= 0) {
      throw new Error('Invalid Host output batch acknowledgement.');
    }
    const subscription = this.hostOutputSubscriptions.get(socket)?.get(params.sessionId);
    if (!subscription || !this.isHostOutputCurrent(subscription) ||
        subscription.subscriptionId !== params.subscriptionId || subscription.authorityId !== params.authorityId ||
        subscription.inFlight?.batchId !== params.batchId) return;
    if (params.outcome === 'cancelled') {
      this.cancelHostOutput(subscription);
      return;
    }
    const inFlight = subscription.inFlight;
    if (inFlight.error) throw new Error('A failed Host output batch must be cancelled.');
    subscription.appliedRevision = inFlight.revision;
    subscription.appliedStateVersion = inFlight.stateVersion;
    subscription.inFlight = undefined;
    if (inFlight.completed) {
      this.cancelHostOutput(subscription);
      return;
    }
    this.releaseTerminalJournalMemoryThroughCheckpoint(subscription.session);
    this.scheduleHostOutput(subscription);
  }

  private cancelHostOutput(subscription: HostOutputSubscription): void {
    const subscriptions = this.hostOutputSubscriptions.get(subscription.socket);
    if (subscriptions?.get(subscription.session.sessionId) !== subscription) return;
    this.disposeJournalPageReader(subscription);
    subscriptions.delete(subscription.session.sessionId);
    if (subscriptions.size === 0) {
      this.hostOutputSubscriptions.delete(subscription.socket);
      this.clearHostOutputDrainListener(subscription.socket);
    }
    if (this.subscriptions.get(subscription.socket)?.get(subscription.session.sessionId) === 'terminal-host-credit') {
      this.subscriptions.get(subscription.socket)?.delete(subscription.session.sessionId);
    }
    this.releaseTerminalJournalMemoryThroughCheckpoint(subscription.session);
    if (subscription.session.retiring) {
      void this.enqueueTerminalOperation(subscription.session, () => this.finishSessionRetirement(subscription.session))
        .catch(error => console.error('Failed to retire Host output subscription:', error));
    }
    this.scheduleIdleShutdownIfNeeded();
  }

  private updateHostOutput(subscription: HostOutputSubscription, stateChanged = false): void {
    if (stateChanged) subscription.stateVersion += 1;
    this.scheduleHostOutput(subscription);
  }

  private clearHostOutputDrainListener(socket: net.Socket): void {
    const listener = this.hostOutputDrainListeners.get(socket);
    if (listener) socket.removeListener('drain', listener);
    this.hostOutputDrainListeners.delete(socket);
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
      sessionId: params.sessionId,
      authorityId: params.authorityId,
      consumerId,
      appliedRevision: revision
    };
    socketAcks?.set(consumerKey, result);
    this.releaseTerminalJournalMemoryThroughCheckpoint(session);
    return result;
  }

  private async writeInput(params: RuntimeSupervisorWriteInputParams): Promise<void> {
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

    if (session.ownedExecution) {
      const result = await session.ownedExecution.write(params.data, this.ownedInteractionDeadline()).first;
      if (result.kind !== 'written') throw new Error(`Execution input was ${result.kind}.`);
      if (this.sessions.get(session.sessionId) !== session || !session.live ||
        !session.terminalMutationAdmissionOpen || session.stopRequested) return;
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

    if (!session.ownedExecution) session.process?.write(params.data);
  }

  private ownedInteractionDeadline(): number {
    return this.executionOwner!.options.scheduler.now() + EXECUTION_INTERACTION_LIMITS.observationMs;
  }

  private async resizeSession(params: RuntimeSupervisorResizeSessionParams): Promise<void> {
    const session = this.requireLiveSession(params.sessionId);
    this.assertTerminalMutationAdmissionOpen(session);
    const deadline = session.ownedExecution ? this.ownedInteractionDeadline() : undefined;
    await this.enqueueTerminalOperation(session, async () => {
      if (session.ownedExecution) {
        if (this.requireLiveSession(params.sessionId) !== session) throw new Error('The original resize session was replaced.');
        const observation = session.ownedExecution.resize(params.cols, params.rows, deadline!);
        session.ownedResizeObservation = observation;
        const result = await observation.first;
        if (result.kind === 'unconfirmed') {
          session.ownedMutationError = `Terminal resize effect is unconfirmed: ${result.reason}`;
          session.terminalMutationAdmissionOpen = false;
        }
        if (result.kind !== 'resized') throw new Error(`Execution resize was ${result.kind}.`);
        if (this.sessions.get(session.sessionId) !== session || !session.terminalMutationAdmissionOpen) {
          const error = new Error('Execution changed while resizing its terminal.');
          session.terminalMutationAdmissionOpen = false;
          this.failSessionForTerminalJournal(session, error);
          throw error;
        }
      }
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
      try {
        session.terminalStateTracker.resize(params.cols, params.rows, {
          outputSequence: terminalEvent?.revision
        });
      } catch (error) {
        if (session.ownedExecution) this.failSessionForTerminalJournal(session, error);
        throw error;
      }
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
      if (session.ownedExecution && this.requireLiveSession(params.sessionId) !== session) {
        throw new Error('The original scrollback session was replaced.');
      }
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
    const ownedSession = this.sessions.get(params.sessionId);
    if (ownedSession?.ownedExecution) {
      this.assertOwnedAdmissionOpen(ownedSession);
      if (!ownedSession.live) throw new Error('Execution is not live.');
      ownedSession.stopRequested = true;
      ownedSession.lifecycle = 'stopping';
      if (ownedSession.lifecycleTimer) clearTimeout(ownedSession.lifecycleTimer);
      ownedSession.lifecycleTimer = undefined;
      this.emitSessionState(ownedSession);
      void ownedSession.ownedExecution.requestStop('Session stop requested.').catch((error) => {
        console.error('Failed to observe execution stop:', error);
      });
      return;
    }
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
    const session = this.requireSession(params.sessionId, true);
    this.assertOwnedAdmissionOpen(session);
    if (params.preserveTerminalReads && session.live) {
      throw new Error('Only ended runtime sessions can retain terminal readers.');
    }
    if (!params.preserveTerminalReads) {
      for (const subscriptions of this.hostOutputSubscriptions.values()) {
        const subscription = subscriptions.get(session.sessionId);
        if (subscription?.session === session) this.cancelHostOutput(subscription);
      }
    }
    if (session.ownedExecution) {
      session.retiring = true;
      session.terminalMutationAdmissionOpen = false;
      session.ownedReaderAdmissionOpen = false;
      session.stopRequested = true;
      if (session.ownedReaders) {
        if (!params.preserveTerminalReads) {
          for (const reader of session.ownedReaders.values()) {
            this.settleOwnedTerminalReader(reader, { kind: 'cancelled', reason: 'session-deleted' });
          }
        }
        this.settleOwnedReadersIfComplete(session);
      } else if (!params.preserveTerminalReads) session.ownedExecution.settleReaders('cancelled');
      const stopped = await session.ownedExecution.requestStop('Session deletion requested.');
      if (stopped.kind !== 'settled') {
        throw new Error('Execution deletion remains unconfirmed; ownership is retained.');
      }
      await this.enqueueTerminalOperation(session, () => this.finishSessionRetirement(session));
      return;
    }
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
      if (this.sessions.get(params.sessionId) !== session) {
        return;
      }
      if (params.preserveTerminalReads) {
        session.retiring = true;
        this.schedulePersist();
        await this.finishSessionRetirement(session);
        return;
      }
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
      const message: RuntimeSupervisorEvent = {
        type: 'event',
        event: 'sessionState',
        payload: session.terminalJournalError
          ? this.toSnapshot(session)
          : await this.createFreshSnapshot(session, 'never', this.needsFullProjection(session))
      };
      this.broadcastToSessionSubscribers(session.sessionId, message);
      await this.removeSession(session);
    });
  }

  private async finishSessionRetirement(session: SupervisorSession): Promise<void> {
    if (!session.retiring || this.sessions.get(session.sessionId) !== session) {
      return;
    }
    for (const subscriptions of this.hostOutputSubscriptions.values()) {
      if (subscriptions.get(session.sessionId)?.session === session) return;
    }
    if (session.ownedExecution) {
      if (!session.ownedExecution.snapshot().retired) return;
      await this.removeSession(session);
      return;
    }
    for (const reads of this.terminalReads.values()) {
      if ([...reads.values()].some((read) => read.sessionId === session.sessionId)) {
        return;
      }
    }
    await this.removeSession(session);
  }

  private async removeSession(session: SupervisorSession): Promise<void> {
    const deferDisposal = this.ownerBoundaryEnabled() && Boolean(session.ownedExecution);
    if (!deferDisposal) this.disposeSession(session, { terminateProcess: false });
    if (session.terminalJournal) {
      await session.terminalJournal.delete();
    } else if (session.terminalAuthorityId) {
      await fs.promises.rm(resolveTerminalJournalSessionDirectory(this.paths.storageDir, session.sessionId),
        { recursive: true, force: true });
    }
    if (deferDisposal) this.disposeSession(session, { terminateProcess: false });
    if (session.ownedExecution && this.sessions.get(session.sessionId) !== session) return;
    this.clearSessionSubscriptions(session.sessionId);
    this.sessions.delete(session.sessionId);
    this.schedulePersist();
    this.scheduleIdleShutdownIfNeeded();
  }

  private bindOwnedExecution(session: SupervisorSession, spec: LaunchSpec): OperationObservation {
    const execution = session.ownedExecution!;
    return execution.start(spec, {
      consume: (batches) => this.consumeOwnedOutput(session, batches),
      flushFinal: () => this.enqueueTerminalOperation(session, async () => {
        const state = await session.terminalStateTracker.flush();
        if (state.outputSequence !== session.outputSequence) {
          throw new Error('Final terminal state does not cover the accepted terminal operations.');
        }
        if (session.ownedMutationError || session.terminalJournalError) {
          throw new Error(session.ownedMutationError ?? session.terminalJournalError!.message);
        }
        session.terminalMutationAdmissionOpen = false;
        session.ownedReaderAdmissionOpen = false;
        this.settleOwnedReadersIfComplete(session);
        if (session.ownedReaderSockets?.size === 0) execution.settleReaders('lost');
        return session.outputSequence;
      }),
      processResult: (result) => { session.ownedProcessResult = result; },
      finalized: (result) => this.finalizeOwnedExecution(session, result),
      fault: () => {
        if (this.sessions.get(session.sessionId) === session) session.lifecycle = 'error';
      },
      changed: () => {
        if (session.retiring && execution.snapshot().retired) {
          void this.enqueueTerminalOperation(session, () => this.finishSessionRetirement(session))
            .catch((error) => console.error('Failed to retire owned execution:', error));
        }
        void Promise.resolve().then(() => {
          this.advanceOwnedShutdown();
          this.scheduleIdleShutdownIfNeeded();
        }).catch((error) => {
          this.executionOwner?.authority.quarantine('Supervisor idle coordination failed.');
          console.error('Failed to coordinate owned execution idle retirement:', error);
        });
      }
    });
  }

  private consumeOwnedOutput(session: SupervisorSession, batches: readonly DataBatch[]): Promise<void> {
    return this.enqueueTerminalOperation(session, async () => {
      for (const batch of batches) {
        const titleUpdate = updateSupervisorTerminalTitle(session, batch.text);
        const text = titleUpdate.terminalOutput;
        let event: TerminalStreamEvent | undefined;
        try {
          event = session.terminalJournal!.appendOutput(text);
        } catch (error) {
          this.failSessionForTerminalJournal(session, error);
          throw error;
        }
        session.outputSequence = event?.revision ?? session.outputSequence + 1;
        session.output = appendOutputTail(session.output, text);
        for (const report of titleUpdate.titleReports) {
          this.replyToOwnedTerminalQuery(session, report);
        }
        session.terminalStateTracker.write(text, { outputSequence: session.outputSequence });
        if (this.sessions.get(session.sessionId) === session) {
          this.applySessionOutputActivity(session, text);
          this.emitSessionOutput(session, text, event,
            titleUpdate.titleUpdated ? session.terminalTitle ?? null : undefined);
          this.schedulePersist();
        }
      }
      await session.terminalStateTracker.drain();
      // Consumption credit must cover pending and in-flight journal writes, not only parser work.
      try {
        await session.terminalJournal!.flush();
      } catch (error) {
        this.failSessionForTerminalJournal(session, error);
        throw error;
      }
    });
  }

  private replyToOwnedTerminalQuery(session: SupervisorSession, report: string): void {
    // Replies share input accounting, but output consumption must never wait for PTY writability.
    if (!session.ownedExecution || this.sessions.get(session.sessionId) !== session) return;
    try {
      if (!session.terminalMutationAdmissionOpen || session.ownedMutationError) {
        throw new Error(session.ownedMutationError ?? 'Owned terminal mutation admission is closed.');
      }
      const observation = session.ownedExecution.write(report, this.ownedInteractionDeadline());
      void observation.first.then(result => {
        if (result.kind !== 'written') console.error(`Terminal title reply was ${result.kind} for ${session.sessionId}.`);
      }, error => console.error('Terminal title reply failed:', error));
    } catch (error) {
      console.error('Terminal title reply was rejected:', error);
    }
  }

  private applySessionOutputActivity(session: SupervisorSession, terminalOutput: string): void {
    const observableTerminalOutput = stripExecutionTerminalTitleMarkers(terminalOutput);
    if (session.kind === 'agent') {
      this.maybeSyncAgentResumeSessionIdFromOutput(session, {
        allowOverwriteExisting: session.stopRequested, emitState: session.stopRequested
      });
      if (session.lifecycle === 'starting' || session.lifecycle === 'resuming' || session.lifecycle === 'running') {
        recordAgentOutputHeuristics(this.ensureAgentActivityState(session), observableTerminalOutput, session.output, session.provider);
        this.queueAgentWaitingInput(session.sessionId);
      }
    } else if (session.lifecycle === 'launching') {
      session.lifecycle = 'live';
      if (session.lifecycleTimer) clearTimeout(session.lifecycleTimer);
      session.lifecycleTimer = undefined;
      this.emitSessionState(session);
    }
  }

  private finalizeOwnedExecution(session: SupervisorSession, result: AuthorityResult): void {
    // Old execution callbacks may settle their captured owner, but cannot publish a replacement session.
    if (this.sessions.get(session.sessionId) !== session) return;
    if (session.lifecycleTimer) clearTimeout(session.lifecycleTimer);
    session.lifecycleTimer = undefined;
    session.live = false;
    if (session.kind === 'agent') this.finalizeAgentResumeSessionIdFromOutput(session);
    session.ownedReaderAdmissionOpen = false;
    this.settleOwnedReadersIfComplete(session);
    if (session.ownedReaderSockets?.size === 0) session.ownedExecution?.settleReaders('lost');
    const execution = session.ownedExecution?.snapshot();
    const processResult = session.ownedProcessResult;
    const successful = result.kind === 'applied' && processResult && processResult.kind !== 'unconfirmed';
    const stopped = session.stopRequested || execution?.stopRequested;
    session.lifecycle = !successful ? 'error'
      : stopped || (processResult?.kind === 'exited' && processResult.exitCode === 0)
        ? session.kind === 'agent' ? 'stopped' : 'closed' : 'error';
    session.lastExitCode = processResult?.kind === 'exited' ? processResult.exitCode : undefined;
    session.lastExitSignal = processResult?.kind === 'signaled' ? processResult.signal : undefined;
    const source = execution?.adapter?.seal?.source;
    if (source && source.kind !== 'eof') {
      setSessionLastExitMessage(session, { id: 'terminalOutputIncomplete', params: { reason: source.reason } });
    }
    this.broadcastToSessionSubscribers(session.sessionId, {
      type: 'event', event: 'sessionState', payload: this.toSnapshot(session, undefined, false)
    });
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
        this.applySessionOutputActivity(session, terminalOutput);

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
    session.lifecycle = 'error';
    setSessionLastExitMessage(session, {
      id: 'terminalJournalPersistenceFailed',
      params: {
        sessionId: session.sessionId
      }
    });
    if (session.ownedExecution) {
      void session.ownedExecution.requestStop('Terminal journal failed.').catch((stopError) => {
        console.error('Failed to observe execution stop after journal failure:', stopError);
      });
      this.scheduleIdleShutdownIfNeeded();
      return;
    }
    session.live = false;
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
      const message: RuntimeSupervisorEvent = {
        type: 'event',
        event: 'sessionState',
        payload: await this.createFreshSnapshot(session, 'never', this.needsFullProjection(session))
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
      if (mode === 'terminal-host-credit') {
        const subscription = this.hostOutputSubscriptions.get(socket)?.get(session.sessionId);
        if (subscription) this.updateHostOutput(subscription, terminalTitle !== undefined);
        continue;
      }
      if ((mode === 'terminal-stream-v1' || mode === 'terminal-stream-paged' ||
          mode === 'terminal-stream-paged-completion') && terminalEvent) {
        this.writeTerminalStreamEvent(socket, session, terminalEvent, terminalTitle);
      } else {
        this.writeMessage(socket, legacyMessage);
      }
    }
  }

  private emitTerminalStreamEvent(session: SupervisorSession, event: TerminalStreamEvent): void {
    for (const [socket, subscriptions] of this.subscriptions.entries()) {
      const mode = subscriptions.get(session.sessionId);
      if (mode === 'terminal-host-credit' && !socket.destroyed) {
        const subscription = this.hostOutputSubscriptions.get(socket)?.get(session.sessionId);
        if (subscription) this.updateHostOutput(subscription);
        continue;
      }
      if ((mode !== 'terminal-stream-v1' && mode !== 'terminal-stream-paged' &&
          mode !== 'terminal-stream-paged-completion') || socket.destroyed) {
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
        sessionId: session.sessionId,
        kind: session.kind,
        authorityId: session.terminalAuthorityId ?? '',
        event,
        terminalTitle
      }
    });
  }

  private emitSessionState(session: SupervisorSession): void {
    void this.enqueueTerminalOperation(session, async () => {
      // Finalization owns the normal terminal state, including any accepted output.
      if (this.sessions.get(session.sessionId) !== session || (!session.live && !session.terminalJournalError)) {
        return;
      }
      const message: RuntimeSupervisorEvent = {
        type: 'event',
        event: 'sessionState',
        payload: session.terminalJournalError
          ? this.toSnapshot(session)
          : await this.createFreshSnapshot(session, 'never', this.needsFullProjection(session))
      };
      this.broadcastToSessionSubscribers(session.sessionId, message);
      this.schedulePersist();
    }).catch((error) => this.failSessionForTerminalJournal(session, error));
  }

  private async emitFreshSessionState(session: SupervisorSession): Promise<void> {
    const message: RuntimeSupervisorEvent = {
      type: 'event',
      event: 'sessionState',
      payload: await this.toFreshSnapshot(session, 'always', this.needsFullProjection(session))
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
    const validatedCheckpoint = shouldValidateCheckpoint
      ? await session.terminalStateTracker.flushValidatedCheckpoint().catch(() => undefined)
      : undefined;
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
    const terminalStream = includeTerminalProjection
      ? await this.buildTerminalStreamAttachPayload(session)
      : undefined;
    return {
      ...this.toSnapshot(session, serializedTerminalState, includeTerminalProjection),
      terminalStream
    };
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
    serializedTerminalState = session.terminalJournal
      ? session.terminalCheckpoint?.serializedState
      : session.terminalStateTracker.getSerializedState(),
    includeTerminalProjection = true
  ): RuntimeSupervisorSessionSnapshot {
    const execution = session.ownedExecution?.snapshot();
    const terminal = session.ownedReaders ? execution?.terminal : undefined;
    const source = execution?.adapter?.seal?.source;
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
      terminalTitle: session.live ? session.terminalTitle ?? null : undefined,
      outputSequence: session.outputSequence,
      serializedTerminalState: includeTerminalProjection
        ? this.getFreshSerializedTerminalState(session, serializedTerminalState)
        : undefined,
      terminalAuthorityId: session.terminalJournalError ? undefined : session.terminalAuthorityId,
      terminalRevision: session.terminalJournalError ? undefined : session.terminalJournal?.getRevision(),
      ...(session.ownedReaders ? { capabilities: { terminalReadSettlementV1: true as const } } : {}),
      ...(terminal?.kind === 'applied' ? { terminalFinalRevision: terminal.finalRevision } : {}),
      ...(source ? { terminalSourceDisposition: source.kind === 'eof'
        ? { kind: source.kind } : { kind: source.kind, reason: source.reason } } : {}),
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

  private async buildTerminalStreamAttachPayload(
    session: SupervisorSession
  ): Promise<TerminalStreamAttachPayload | undefined> {
    if (session.terminalJournalError) {
      return undefined;
    }
    const journal = session.terminalJournal;
    let checkpoint = session.terminalCheckpoint;
    if (!session.live) {
      for (const reads of this.terminalReads.values()) {
        for (const read of reads.values()) {
          if (read.sessionId === session.sessionId && read.authorityId === session.terminalAuthorityId &&
              checkpoint && read.checkpoint.revision < checkpoint.revision) {
            checkpoint = read.checkpoint;
          }
        }
      }
    }
    if (!journal || !checkpoint || checkpoint.authorityId !== journal.getAuthorityId()) {
      return undefined;
    }
    const terminalStream = buildTerminalStreamAttachPayload({
      sessionId: session.sessionId,
      authorityId: journal.getAuthorityId(),
      revision: journal.getRevision(),
      checkpoint,
      events: await journal.getEventsAfter(checkpoint.revision)
    });
    if (!terminalStream) {
      throw new Error(`Invalid terminal journal projection for session ${session.sessionId}.`);
    }
    return terminalStream;
  }

  private requireSession(sessionId: string, allowRetiring = false): SupervisorSession {
    const session = this.sessions.get(sessionId);
    if (!session || (session.retiring && !allowRetiring)) {
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
    const owned = session.ownedExecution?.snapshot();
    if (!session.live || (!session.process && !session.ownedExecution) || !session.terminalMutationAdmissionOpen ||
      (owned && (owned.stopRequested || owned.adapter?.process !== undefined || owned.adapter?.seal !== undefined))) {
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
    const session = this.sessions.get(sessionId);
    this.assertOwnedAdmissionOpen();
    const subscriptions = this.subscriptions.get(socket);
    if (!subscriptions) {
      return;
    }
    const previous = this.hostOutputSubscriptions.get(socket)?.get(sessionId);
    if (previous) this.cancelHostOutput(previous);
    subscriptions.set(sessionId, mode);
    if (session?.ownedReaderAdmissionOpen) session.ownedReaderSockets?.add(socket);
  }

  private deferSocketSubscription(socket: net.Socket, sessionId: string, revision: number): void {
    const session = this.sessions.get(sessionId);
    this.assertOwnedAdmissionOpen();
    const previous = this.hostOutputSubscriptions.get(socket)?.get(sessionId);
    if (previous) this.cancelHostOutput(previous);
    this.subscriptions.get(socket)?.delete(sessionId);
    this.deferredSubscriptionRevisions.get(socket)?.set(sessionId, revision);
    if (session?.ownedReaderAdmissionOpen) session.ownedReaderSockets?.add(socket);
  }

  private clearDeferredSubscription(socket: net.Socket, sessionId: string): void {
    this.deferredSubscriptionRevisions.get(socket)?.delete(sessionId);
  }

  private clearSessionSubscriptions(sessionId: string): void {
    for (const [socket, subscriptions] of this.hostOutputSubscriptions) {
      const subscription = subscriptions.get(sessionId);
      if (subscription) this.disposeJournalPageReader(subscription);
      subscriptions.delete(sessionId);
      if (subscriptions.size === 0) {
        this.hostOutputSubscriptions.delete(socket);
        this.clearHostOutputDrainListener(socket);
      }
    }
    for (const reads of this.terminalReads.values()) {
      for (const [id, read] of reads) {
        if (read.sessionId === sessionId) {
          this.disposeJournalPageReader(read);
          reads.delete(id);
        }
      }
    }
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
    for (const subscriptions of this.hostOutputSubscriptions.values()) {
      const subscription = subscriptions.get(session.sessionId);
      if (subscription?.session === session) retainAfter(subscription.appliedRevision);
    }
    for (const reads of this.terminalReads.values()) {
      for (const read of reads.values()) {
        if (read.sessionId === session.sessionId && read.authorityId === session.terminalAuthorityId) {
          retainAfter(read.checkpoint.revision);
        }
      }
    }
    for (const deferredRevisions of this.deferredSubscriptionRevisions.values()) {
      const deferredRevision = deferredRevisions.get(session.sessionId);
      if (deferredRevision !== undefined) {
        retainAfter(deferredRevision);
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
    const pagedPayload = message.event === 'sessionState' && message.payload.terminalAuthorityId
      ? `${JSON.stringify({ ...message, payload: { ...message.payload, terminalStream: undefined,
          output: message.payload.live ? message.payload.output : '',
          serializedTerminalState: undefined, terminalStreamPaged: true } })}\n`
      : payload;
    for (const [socket, subscriptions] of this.subscriptions.entries()) {
      if (!subscriptions.has(sessionId) || socket.destroyed) {
        continue;
      }

      const mode = subscriptions.get(sessionId);
      if (mode === 'terminal-host-credit') {
        const subscription = this.hostOutputSubscriptions.get(socket)?.get(sessionId);
        if (subscription && message.event === 'sessionState') this.updateHostOutput(subscription, true);
        continue;
      }
      socket.write(mode === 'terminal-stream-paged-completion' ||
        (mode === 'terminal-stream-paged' && message.event === 'sessionState' && message.payload.live)
        ? pagedPayload : payload);
    }
  }

  private needsFullProjection(session: SupervisorSession): boolean {
    return [...this.subscriptions.values()].some((subscriptions) => {
      const mode = subscriptions.get(session.sessionId);
      return mode !== undefined && mode !== 'terminal-stream-paged-completion' &&
        mode !== 'terminal-host-credit' &&
        (!session.live || mode !== 'terminal-stream-paged');
    });
  }

  private waitForSocketDrain(socket: net.Socket): Promise<void> {
    if (socket.destroyed) {
      return Promise.reject(new Error('Terminal subscription connection closed.'));
    }
    if (!socket.writableNeedDrain) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const cleanup = (): void => {
        socket.removeListener('drain', drained);
        socket.removeListener('close', closed);
        socket.removeListener('error', closed);
      };
      const drained = (): void => { cleanup(); resolve(); };
      const closed = (): void => { cleanup(); reject(new Error('Terminal subscription connection closed.')); };
      socket.once('drain', drained);
      socket.once('close', closed);
      socket.once('error', closed);
    });
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
    const affectedSessionIds = new Set(this.deferredSubscriptionRevisions.get(socket)?.keys() ?? []);
    for (const sessionId of this.subscriptions.get(socket)?.keys() ?? []) {
      affectedSessionIds.add(sessionId);
    }
    for (const read of this.terminalReads.get(socket)?.values() ?? []) {
      affectedSessionIds.add(read.sessionId);
      this.disposeJournalPageReader(read);
    }
    for (const appliedRevision of this.appliedRevisionAcks.get(socket)?.values() ?? []) {
      affectedSessionIds.add(appliedRevision.sessionId);
    }
    for (const session of this.sessions.values()) {
      for (const reader of session.ownedReaders?.values() ?? []) {
        if (reader.socket === socket) {
          affectedSessionIds.add(session.sessionId);
          this.settleOwnedTerminalReader(reader, { kind: 'lost' });
        }
      }
      if (session.ownedReaderSockets?.delete(socket)) {
        affectedSessionIds.add(session.sessionId);
        if (session.ownedReaderSockets.size === 0 && !session.ownedReaderAdmissionOpen) {
          session.ownedExecution?.settleReaders('lost');
        }
      }
    }
    this.connections.delete(socket);
    for (const subscription of this.hostOutputSubscriptions.get(socket)?.values() ?? []) {
      this.disposeJournalPageReader(subscription);
    }
    this.hostOutputSubscriptions.delete(socket);
    this.clearHostOutputDrainListener(socket);
    this.subscriptions.delete(socket);
    this.deferredSubscriptionRevisions.delete(socket);
    this.terminalReads.delete(socket);
    this.terminalReaderReceipts.delete(socket);
    this.appliedRevisionAcks.delete(socket);
    for (const sessionId of affectedSessionIds) {
      const session = this.sessions.get(sessionId);
      if (session) {
        this.releaseTerminalJournalMemoryThroughCheckpoint(session);
        if (session.retiring) {
          void this.enqueueTerminalOperation(session, () => this.finishSessionRetirement(session))
            .catch((error) => console.error('Failed to retire completed runtime session:', error));
        }
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

  private async persistRegistry(strict = false): Promise<void> {
    if (strict) {
      for (const session of this.sessions.values()) {
        if (session.terminalJournalError) throw session.terminalJournalError;
        if (session.retiring) throw new Error('Session deletion has not completed before shutdown persistence.');
      }
    }
    const sessionEntries = Array.from(this.sessions.values()).filter((session) => !session.retiring);
    const snapshots = await Promise.all(
      sessionEntries.map(async (session) => {
        let snapshot: RuntimeSupervisorSessionSnapshot;
        try {
          snapshot = await this.toFreshSnapshot(
            session,
            session.terminalAuthorityId ? 'if-compaction-due' : 'always',
            !session.terminalAuthorityId
          );
        } catch (error) {
          if (strict) throw error;
          if (!session.terminalJournal) {
            throw error;
          }
          this.failSessionForTerminalJournal(session, error);
          snapshot = this.toSnapshot(session);
        }
        if (strict && session.terminalJournalError) throw session.terminalJournalError;
        if (this.sessions.get(session.sessionId) !== session || session.retiring) {
          if (strict) throw new Error('Session changed during shutdown persistence.');
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

  private async flushRegistryBeforeShutdown(strict = false): Promise<void> {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = undefined;
    }
    await this.persistRegistryChain;
    await this.persistRegistry(strict);
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
    let recoveredAuthorityId = snapshot.terminalAuthorityId?.trim() || normalizedTerminalStream?.authorityId;
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
          authorityId: recoveredAuthorityId,
          checkpointProfiles: SERIALIZED_TERMINAL_CHECKPOINT_PROFILES
        });
        recoveredAuthorityId = terminalJournal.getAuthorityId();
        const initialTerminalState = terminalJournal.getInitialTerminalState();
        const recoveryCandidates = await terminalJournal.getRecoveryCandidates();
        let restoredCandidate: RestoredTerminalJournalCandidate | undefined;
        let lastCandidateError: Error | undefined;
        for (const candidate of recoveryCandidates) {
          try {
            restoredCandidate = await this.restoreTerminalJournalCandidate(
              snapshot.sessionId,
              recoveredAuthorityId,
              terminalJournal.getRevision(),
              initialTerminalState,
              candidate
            );
            break;
          } catch (error) {
            lastCandidateError = error instanceof Error ? error : new Error(String(error));
          }
        }
        if (!restoredCandidate) {
          throw lastCandidateError ?? new Error(
            `No trusted terminal journal recovery candidate is available for session ${snapshot.sessionId}.`
          );
        }
        terminalStateTracker = restoredCandidate.terminalStateTracker;
        terminalCheckpoint = restoredCandidate.terminalCheckpoint;
        recoveredCols = restoredCandidate.cols;
        recoveredRows = restoredCandidate.rows;
        recoveredScrollback = restoredCandidate.scrollback;
        recoveredOutput = restoredCandidate.output;
        recoveredOutputSequence = terminalJournal.getRevision();
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
      terminalTitle: undefined,
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
      terminalAuthorityId: terminalJournal?.getAuthorityId() ?? recoveredAuthorityId,
      terminalJournal,
      terminalJournalError,
      terminalCheckpoint,
      terminalStateTracker,
      terminalOperationChain: Promise.resolve(),
      terminalMutationAdmissionOpen: false,
      finalizationPromise: undefined,
      process: undefined,
      outputSubscription: undefined,
      exitSubscription: undefined,
      lifecycleTimer: undefined
    };
  }

  private async restoreTerminalJournalCandidate(
    sessionId: string,
    authorityId: string,
    journalRevision: number,
    initialTerminalState: { cols: number; rows: number; scrollback: number },
    candidate: TerminalJournalRecoveryCandidate
  ): Promise<RestoredTerminalJournalCandidate> {
    const checkpoint = candidate.checkpoint
      ? normalizeTerminalStreamCheckpoint(candidate.checkpoint)
      : undefined;
    if (
      candidate.checkpoint &&
      (
        !checkpoint ||
        checkpoint.sessionId !== sessionId ||
        checkpoint.authorityId !== authorityId ||
        checkpoint.revision > journalRevision
      )
    ) {
      throw new Error(`Invalid ${candidate.source} terminal checkpoint for session ${sessionId}.`);
    }

    const terminalStateTracker = checkpoint
      ? new SerializedTerminalStateTracker(checkpoint.cols, checkpoint.rows, {
          scrollback: checkpoint.scrollback,
          initialState: checkpoint.serializedState,
          initialOutputSequence: checkpoint.revision
        })
      : new SerializedTerminalStateTracker(initialTerminalState.cols, initialTerminalState.rows, {
          scrollback: initialTerminalState.scrollback,
          initialOutputSequence: 0
        });
    const baseCheckpoint = checkpoint ?? normalizeTerminalStreamCheckpoint({
      version: TERMINAL_SESSION_STREAM_VERSION,
      sessionId,
      authorityId,
      revision: 0,
      cols: initialTerminalState.cols,
      rows: initialTerminalState.rows,
      scrollback: initialTerminalState.scrollback,
      createdAtMs: Date.now(),
      serializedState: terminalStateTracker.getSerializedState()
    });
    if (!baseCheckpoint) {
      terminalStateTracker.dispose();
      throw new Error(`Could not create a genesis terminal checkpoint for session ${sessionId}.`);
    }

    let cols = baseCheckpoint.cols;
    let rows = baseCheckpoint.rows;
    let scrollback = baseCheckpoint.scrollback;
    let expectedRevision = baseCheckpoint.revision + 1;
    let output = candidate.outputTail;
    try {
      for (const event of candidate.events) {
        if (event.revision !== expectedRevision || event.revision > journalRevision) {
          throw new Error(
            `Terminal journal ${candidate.source} recovery has a revision gap at ${expectedRevision}.`
          );
        }
        expectedRevision += 1;
        if (event.type === 'output') {
          output = appendOutputTail(output, event.data);
          terminalStateTracker.write(event.data, {
            outputSequence: event.revision
          });
          continue;
        }
        if (event.type === 'resize') {
          cols = event.cols;
          rows = event.rows;
          terminalStateTracker.resize(event.cols, event.rows, {
            outputSequence: event.revision
          });
          continue;
        }
        scrollback = event.scrollback;
        await terminalStateTracker.setScrollback(event.scrollback, {
          outputSequence: event.revision
        });
      }
      if (expectedRevision !== journalRevision + 1) {
        throw new Error(
          `Terminal journal ${candidate.source} recovery stops before revision ${journalRevision}.`
        );
      }

      const validation = await terminalStateTracker.flushValidatedCheckpoint();
      let trustedCheckpoint = baseCheckpoint;
      if (validation.eligible) {
        const headCheckpoint = normalizeTerminalStreamCheckpoint({
          version: TERMINAL_SESSION_STREAM_VERSION,
          sessionId,
          authorityId,
          revision: journalRevision,
          cols,
          rows,
          scrollback,
          createdAtMs: Date.now(),
          serializedState: validation.state
        });
        if (!headCheckpoint) {
          throw new Error(`Could not validate recovered terminal head for session ${sessionId}.`);
        }
        trustedCheckpoint = headCheckpoint;
      }
      return {
        terminalStateTracker,
        terminalCheckpoint: trustedCheckpoint,
        cols,
        rows,
        scrollback,
        output
      };
    } catch (error) {
      terminalStateTracker.dispose();
      throw error;
    }
  }

  private scheduleIdleShutdownIfNeeded(): void {
    if (this.shutdownBoundary) {
      this.clearIdleShutdownTimer();
      this.advanceOwnedShutdown();
      return;
    }
    if (this.connections.size > 0 || Array.from(this.sessions.values()).some((session) => session.live)
      || (this.executionOwner?.snapshot().pending ?? 0) > 0) {
      this.clearIdleShutdownTimer();
      return;
    }

    if (this.idleShutdownTimer) {
      return;
    }

    this.idleShutdownTimer = setTimeout(() => this.runIdleShutdown(), IDLE_SHUTDOWN_DELAY_MS);
  }

  private runIdleShutdown(): void {
    this.idleShutdownTimer = undefined;
    if (this.ownerBoundaryEnabled()) {
      if (this.connections.size > 0 || this.executionOwner!.snapshot().pending > 0
        || Array.from(this.sessions.values()).some((session) => session.live)) return;
      void this.prepareForShutdown('Supervisor idle shutdown.').then(report => {
        if (report.kind === 'settled') process.exit(0);
      });
      return;
    }
    if (this.executionOwner) {
      if (this.connections.size > 0 || this.executionOwner.snapshot().pending > 0
        || Array.from(this.sessions.values()).some((session) => session.live)) return;
      this.executionOwner.closeAdmission(true);
    }
    void this.flushRegistryBeforeShutdown().then(
      () => process.exit(0),
      (error) => {
        const normalizedError = error instanceof Error ? error : new Error(String(error));
        this.persistRegistryError = normalizedError;
        console.error('Failed to flush runtime supervisor registry before shutdown:', normalizedError);
        process.exit(1);
      }
    );
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
    .replace(/\u001b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '')
    .replace(/\u0000/g, '');
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
  let executionProfile: ExecutionCandidateProfile | undefined;
  let executionOwnerOptions: ExecutionOwnerOptions | undefined;
  if (process.argv.includes('--execution-profile')) {
    const requestedProfile = readCliFlag('--execution-profile');
    assertExecutionCandidateRuntimeSupervisorStorageDir(storageDir, requestedProfile);
    executionProfile = requestedProfile;
    executionOwnerOptions = createNativeExecutionOwnerOptions({ extensionRoot: path.dirname(__dirname),
      mode: 'live-runtime', profile: executionProfile });
  }
  const server = new RuntimeSupervisorServer(paths, runtimeBackend, runtimeGuarantee, executionOwnerOptions, executionProfile);
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

if (require.main === module) {
  void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
