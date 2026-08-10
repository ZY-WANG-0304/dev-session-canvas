import type {
  AgentProviderKind,
  AgentInputIntent,
  AgentActivityAuthority,
  AgentActivitySource,
  AgentTurnOutcome,
  AgentResumeStrategy,
  ExecutionNodeKind,
  PendingExecutionLaunch,
  RuntimeHostBackendKind,
  RuntimePersistenceGuarantee,
  TerminalNodeStatus,
  AgentNodeStatus
} from './protocol';
import type {
  SerializedTerminalCheckpointRejectionReason,
  SerializedTerminalState
} from './serializedTerminalState';
import type {
  TerminalStreamAttachPayload,
  TerminalStreamCheckpoint,
  TerminalStreamEvent
} from './terminalSessionStream';
import type { ExecutionSessionLaunchSpec } from '../panel/executionSessionBridge';

export interface RuntimeSupervisorPaths {
  storageDir: string;
  controlDir?: string;
  runtimeDir?: string;
  socketPath: string;
  registryPath: string;
  socketLocation: 'storage' | 'runtime-private' | 'runtime-fallback' | 'named-pipe' | 'control-dir';
  unitName?: string;
  unitFilePath?: string;
}

export interface RuntimeSupervisorHelloResult {
  serverVersion: 1;
  pid: number;
  runtimeBackend: RuntimeHostBackendKind;
  runtimeGuarantee: RuntimePersistenceGuarantee;
  /** Omitted by older Supervisors that predate asynchronous journal recovery. */
  recovery?: RuntimeSupervisorRecoveryState;
  capabilities?: {
    terminalSessionStreamV1?: true;
    terminalProjectionSnapshotV1?: true;
    terminalProjectionCheckpointV1?: true;
    terminalAppliedRevisionAckV1?: true;
    agentSubmissionIntentV1?: true;
    agentProviderLifecycleV1?: true;
  };
}

/** Safe checkpoint health metadata; terminal output and user input are never included. */
export interface RuntimeSupervisorTerminalCheckpointDiagnostics {
  lastRejectionReason?: SerializedTerminalCheckpointRejectionReason;
  consecutiveRejectionCount: number;
  rejectionStartedAtMs?: number;
  checkpointCreatedAtMs?: number;
  snapshotEventCount?: number;
  snapshotEventBytes?: number;
}

/** A bounded checkpoint refresh result for a Host that already has a live stream. */
export interface RuntimeSupervisorTerminalProjectionCheckpoint {
  sessionId: string;
  authorityId: string;
  revision: number;
  checkpoint: TerminalStreamCheckpoint;
  terminalCheckpointDiagnostics?: RuntimeSupervisorTerminalCheckpointDiagnostics;
}

export interface RuntimeSupervisorRecoveryState {
  phase: 'recovering' | 'ready';
  pendingSessionCount: number;
  failureCount?: number;
}

export interface RuntimeSupervisorSessionSnapshot {
  sessionId: string;
  kind: ExecutionNodeKind;
  live: boolean;
  lifecycle: AgentNodeStatus | TerminalNodeStatus;
  runtimeBackend: RuntimeHostBackendKind;
  runtimeGuarantee: RuntimePersistenceGuarantee;
  resumePhaseActive?: boolean;
  shellPath: string;
  cwd: string;
  cols: number;
  rows: number;
  scrollback: number;
  output: string;
  /** Current title; null confirms that this live PTY has cleared it. */
  terminalTitle?: string | null;
  outputSequence?: number;
  serializedTerminalState?: SerializedTerminalState;
  terminalAuthorityId?: string;
  terminalRevision?: number;
  terminalStream?: TerminalStreamAttachPayload;
  terminalCheckpointDiagnostics?: RuntimeSupervisorTerminalCheckpointDiagnostics;
  displayLabel: string;
  launchMode: PendingExecutionLaunch;
  provider?: AgentProviderKind;
  resumeStrategy?: AgentResumeStrategy;
  resumeSessionId?: string;
  resumeStoragePath?: string;
  agentActivitySource?: AgentActivitySource;
  agentActivityAuthority?: AgentActivityAuthority;
  providerLifecycleEnabled?: boolean;
  providerSessionId?: string;
  providerTurnId?: string;
  lastTurnOutcome?: AgentTurnOutcome;
  lastTurnError?: string;
  lastExitCode?: number;
  lastExitSignal?: string;
  lastExitMessage?: string;
  lastExitMessageDescriptor?: RuntimeSupervisorMessageDescriptor;
  /** @deprecated Legacy Claude Ctrl-Z state metadata. New Claude Agent sessions block Ctrl-Z instead. */
  preSuspendLifecycle?: AgentNodeStatus;
  /** @deprecated Legacy Claude Ctrl-Z state metadata. New Claude Agent sessions block Ctrl-Z instead. */
  lastSuspendReason?: 'claude-ctrl-z';
  /** @deprecated Legacy Claude Ctrl-Z state metadata. New Claude Agent sessions block Ctrl-Z instead. */
  lastSuspendMessage?: string;
  /** @deprecated Legacy Claude Ctrl-Z state metadata. New Claude Agent sessions no longer reactivate. */
  lastReactivateError?: string;
}

export interface RuntimeSupervisorErrorPayload {
  message: string;
  code?: string;
  descriptor?: RuntimeSupervisorMessageDescriptor;
  details?: RuntimeSupervisorErrorDetails;
}

/** Identifies the layer that produced a Runtime Supervisor failure. */
export type RuntimeSupervisorErrorOrigin = 'transport' | 'readiness' | 'protocol' | 'execution-spawn';

/**
 * Structured error metadata is carried across the Host/Supervisor process boundary.
 * `file` and `cwd` are only populated for a real PTY process spawn attempt.
 */
export interface RuntimeSupervisorErrorDetails {
  origin: RuntimeSupervisorErrorOrigin;
  errno?: string;
  file?: string;
  cwd?: string;
}

export const RUNTIME_SUPERVISOR_ERROR_CODES = {
  parseError: 'DEV_SESSION_CANVAS_RUNTIME_SUPERVISOR_PARSE_ERROR',
  sessionAlreadyExists: 'DEV_SESSION_CANVAS_RUNTIME_SESSION_ALREADY_EXISTS',
  sessionNotFound: 'DEV_SESSION_CANVAS_RUNTIME_SESSION_NOT_FOUND',
  sessionNotLive: 'DEV_SESSION_CANVAS_RUNTIME_SESSION_NOT_LIVE',
  claudeCtrlZUnsupported: 'DEV_SESSION_CANVAS_RUNTIME_CLAUDE_CTRL_Z_UNSUPPORTED',
  claudeSuspended: 'DEV_SESSION_CANVAS_RUNTIME_CLAUDE_SUSPENDED',
  supervisorMissingStorageDir: 'DEV_SESSION_CANVAS_RUNTIME_SUPERVISOR_MISSING_STORAGE_DIR',
  legacySocketPathUnavailable: 'DEV_SESSION_CANVAS_RUNTIME_LEGACY_SOCKET_PATH_UNAVAILABLE',
  systemdUserUnsupportedOnWindows: 'DEV_SESSION_CANVAS_RUNTIME_SYSTEMD_USER_UNSUPPORTED_ON_WINDOWS',
  systemdControlPathUnavailable: 'DEV_SESSION_CANVAS_RUNTIME_SYSTEMD_CONTROL_PATH_UNAVAILABLE',
  homeDirectoryUnavailable: 'DEV_SESSION_CANVAS_RUNTIME_HOME_DIRECTORY_UNAVAILABLE',
  clientDisposed: 'DEV_SESSION_CANVAS_RUNTIME_SUPERVISOR_CLIENT_DISPOSED',
  clientDisconnected: 'DEV_SESSION_CANVAS_RUNTIME_SUPERVISOR_CLIENT_DISCONNECTED',
  clientNotConnected: 'DEV_SESSION_CANVAS_RUNTIME_SUPERVISOR_CLIENT_NOT_CONNECTED',
  clientConnectionClosed: 'DEV_SESSION_CANVAS_RUNTIME_SUPERVISOR_CONNECTION_CLOSED',
  clientSocketUnavailable: 'DEV_SESSION_CANVAS_RUNTIME_SUPERVISOR_SOCKET_UNAVAILABLE',
  clientSocketRefused: 'DEV_SESSION_CANVAS_RUNTIME_SUPERVISOR_SOCKET_REFUSED',
  clientReadyTimeout: 'DEV_SESSION_CANVAS_RUNTIME_SUPERVISOR_READY_TIMEOUT',
  executionSpawnFailed: 'DEV_SESSION_CANVAS_RUNTIME_EXECUTION_SPAWN_FAILED',
  launcherMissingSupervisorScript: 'DEV_SESSION_CANVAS_RUNTIME_SUPERVISOR_LAUNCHER_MISSING_SUPERVISOR_SCRIPT',
  launcherMissingStorageDir: 'DEV_SESSION_CANVAS_RUNTIME_SUPERVISOR_LAUNCHER_MISSING_STORAGE_DIR',
  systemdBackendMissingPaths: 'DEV_SESSION_CANVAS_RUNTIME_SYSTEMD_BACKEND_MISSING_PATHS',
  systemdCommandFailed: 'DEV_SESSION_CANVAS_RUNTIME_SYSTEMD_COMMAND_FAILED',
  terminalAuthorityMismatch: 'DEV_SESSION_CANVAS_RUNTIME_TERMINAL_AUTHORITY_MISMATCH',
  terminalRevisionInvalid: 'DEV_SESSION_CANVAS_RUNTIME_TERMINAL_REVISION_INVALID',
  terminalJournalUnavailable: 'DEV_SESSION_CANVAS_RUNTIME_TERMINAL_JOURNAL_UNAVAILABLE'
} as const;

export type RuntimeSupervisorErrorCode =
  (typeof RUNTIME_SUPERVISOR_ERROR_CODES)[keyof typeof RUNTIME_SUPERVISOR_ERROR_CODES];

export type RuntimeSupervisorMessageId =
  | 'parseError'
  | 'sessionAlreadyExists'
  | 'sessionNotFound'
  | 'sessionNotLive'
  | 'claudeAgentCtrlZUnsupported'
  | 'claudeCodeSuspended'
  | 'agentSessionDeleted'
  | 'terminalSessionDeleted'
  | 'agentSessionStopped'
  | 'agentSessionEnded'
  | 'terminalStopped'
  | 'terminalSessionEnded'
  | 'recoveredHistoryOnly'
  | 'agentExitedSignal'
  | 'agentExitedCode'
  | 'agentResumeFailedSignal'
  | 'agentResumeFailedCode'
  | 'terminalExitedSignal'
  | 'terminalExitedCode'
  | 'supervisorMissingStorageDir'
  | 'launcherMissingSupervisorScript'
  | 'launcherMissingStorageDir'
  | 'legacySocketPathUnavailable'
  | 'systemdUserUnsupportedOnWindows'
  | 'systemdControlPathUnavailable'
  | 'homeDirectoryUnavailable'
  | 'clientDisposed'
  | 'clientDisconnected'
  | 'clientNotConnected'
  | 'clientConnectionClosed'
  | 'clientSocketUnavailable'
  | 'clientSocketRefused'
  | 'clientReadyTimeout'
  | 'executionSpawnFailed'
  | 'systemdBackendMissingPaths'
  | 'systemdCommandFailed'
  | 'terminalAuthorityMismatch'
  | 'terminalRevisionInvalid'
  | 'terminalJournalUnavailable'
  | 'terminalJournalPersistenceFailed';

export interface RuntimeSupervisorMessageDescriptor {
  id: RuntimeSupervisorMessageId;
  params?: Record<string, string>;
}

export interface RuntimeSupervisorCreateSessionParams {
  kind: ExecutionNodeKind;
  sessionId?: string;
  displayLabel: string;
  launchMode: PendingExecutionLaunch;
  scrollback: number;
  provider?: AgentProviderKind;
  resumeStrategy?: AgentResumeStrategy;
  resumeSessionId?: string;
  resumeStoragePath?: string;
  providerLifecycleEnabled?: boolean;
  launchSpec: SerializedExecutionSessionLaunchSpec;
  deferSubscription?: boolean;
}

export interface RuntimeSupervisorAttachSessionParams {
  sessionId: string;
  deferSubscription?: boolean;
}

export interface RuntimeSupervisorGetSessionSnapshotParams {
  sessionId: string;
}

export interface RuntimeSupervisorGetTerminalProjectionCheckpointParams {
  sessionId: string;
}

export interface RuntimeSupervisorSubscribeSessionParams {
  sessionId: string;
  authorityId: string;
  afterRevision: number;
}

export interface RuntimeSupervisorSubscribeSessionResult {
  sessionId: string;
  authorityId: string;
  revision: number;
}

export interface RuntimeSupervisorAckSessionRevisionParams {
  sessionId: string;
  authorityId: string;
  consumerId: 'editor' | 'panel';
  revision: number;
}

export interface RuntimeSupervisorAckSessionRevisionResult {
  sessionId: string;
  authorityId: string;
  consumerId: 'editor' | 'panel';
  appliedRevision: number;
}

export interface RuntimeSupervisorWriteInputParams {
  sessionId: string;
  data: string;
  intent?: AgentInputIntent;
}

export interface RuntimeSupervisorResizeSessionParams {
  sessionId: string;
  cols: number;
  rows: number;
}

export interface RuntimeSupervisorUpdateSessionScrollbackParams {
  sessionId: string;
  scrollback: number;
}

export interface RuntimeSupervisorStopSessionParams {
  sessionId: string;
}

export interface RuntimeSupervisorDeleteSessionParams {
  sessionId: string;
}

export type RuntimeSupervisorRequest =
  | {
      type: 'request';
      id: string;
      method: 'hello';
    }
  | {
      type: 'request';
      id: string;
      method: 'createSession';
      params: RuntimeSupervisorCreateSessionParams;
    }
  | {
      type: 'request';
      id: string;
      method: 'attachSession';
      params: RuntimeSupervisorAttachSessionParams;
    }
  | {
      type: 'request';
      id: string;
      method: 'getSessionSnapshot';
      params: RuntimeSupervisorGetSessionSnapshotParams;
    }
  | {
      type: 'request';
      id: string;
      method: 'getTerminalProjectionCheckpoint';
      params: RuntimeSupervisorGetTerminalProjectionCheckpointParams;
    }
  | {
      type: 'request';
      id: string;
      method: 'subscribeSession';
      params: RuntimeSupervisorSubscribeSessionParams;
    }
  | {
      type: 'request';
      id: string;
      method: 'ackSessionRevision';
      params: RuntimeSupervisorAckSessionRevisionParams;
    }
  | {
      type: 'request';
      id: string;
      method: 'writeInput';
      params: RuntimeSupervisorWriteInputParams;
    }
  | {
      type: 'request';
      id: string;
      method: 'resizeSession';
      params: RuntimeSupervisorResizeSessionParams;
    }
  | {
      type: 'request';
      id: string;
      method: 'updateSessionScrollback';
      params: RuntimeSupervisorUpdateSessionScrollbackParams;
    }
  | {
      type: 'request';
      id: string;
      method: 'stopSession';
      params: RuntimeSupervisorStopSessionParams;
    }
  | {
      type: 'request';
      id: string;
      method: 'deleteSession';
      params: RuntimeSupervisorDeleteSessionParams;
    };

export type RuntimeSupervisorResponse =
  | {
      type: 'response';
      id: string;
      ok: true;
      result:
        | RuntimeSupervisorHelloResult
        | RuntimeSupervisorSessionSnapshot
        | RuntimeSupervisorTerminalProjectionCheckpoint
        | RuntimeSupervisorSubscribeSessionResult
        | RuntimeSupervisorAckSessionRevisionResult
        | {
            ok: true;
          };
    }
  | {
      type: 'response';
      id: string;
      ok: false;
      error: RuntimeSupervisorErrorPayload;
    };

export type RuntimeSupervisorEvent =
  | {
      type: 'event';
      event: 'sessionOutput';
      payload: {
        sessionId: string;
        kind: ExecutionNodeKind;
        chunk: string;
        outputSequence?: number;
        terminalAuthorityId?: string;
        terminalRevision?: number;
        /** Ephemeral title projection for a redacted OSC 0/2 output event. */
        terminalTitle?: string | null;
      };
    }
  | {
      type: 'event';
      event: 'sessionTerminalEvent';
      payload: {
        sessionId: string;
        kind: ExecutionNodeKind;
        authorityId: string;
        event: TerminalStreamEvent;
        /** Present only for the live event that changed the current terminal title. */
        terminalTitle?: string | null;
      };
    }
  | {
      type: 'event';
      event: 'sessionState';
      payload: RuntimeSupervisorSessionSnapshot;
    }
  | {
      type: 'event';
      event: 'recoveryState';
      payload: RuntimeSupervisorRecoveryState;
    };

export type RuntimeSupervisorMessage =
  | RuntimeSupervisorRequest
  | RuntimeSupervisorResponse
  | RuntimeSupervisorEvent;

export interface RuntimeSupervisorClientEventHandlers {
  onSessionOutput?: (event: Extract<RuntimeSupervisorEvent, { event: 'sessionOutput' }>['payload']) => void;
  onSessionTerminalEvent?: (
    event: Extract<RuntimeSupervisorEvent, { event: 'sessionTerminalEvent' }>['payload']
  ) => void;
  onSessionState?: (snapshot: RuntimeSupervisorSessionSnapshot) => void;
  onRecoveryState?: (state: RuntimeSupervisorRecoveryState) => void;
}

export interface SerializedExecutionSessionLaunchSpec {
  file: string;
  args?: string[];
  cwd: string;
  cols: number;
  rows: number;
  env: Record<string, string>;
  terminalName?: string;
}

export function serializeExecutionSessionLaunchSpec(
  spec: ExecutionSessionLaunchSpec
): SerializedExecutionSessionLaunchSpec {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(spec.env)) {
    if (typeof value === 'string') {
      env[key] = value;
    }
  }

  return {
    file: spec.file,
    args: spec.args ? [...spec.args] : [],
    cwd: spec.cwd,
    cols: spec.cols,
    rows: spec.rows,
    env,
    terminalName: spec.terminalName
  };
}

export function deserializeExecutionSessionLaunchSpec(
  spec: SerializedExecutionSessionLaunchSpec
): ExecutionSessionLaunchSpec {
  return {
    file: spec.file,
    args: spec.args ? [...spec.args] : [],
    cwd: spec.cwd,
    cols: spec.cols,
    rows: spec.rows,
    env: {
      ...spec.env
    },
    terminalName: spec.terminalName
  };
}

export function serializeRuntimeSupervisorError(error: unknown): RuntimeSupervisorErrorPayload {
  const message = error instanceof Error ? error.message : String(error);
  const code = readRuntimeSupervisorErrorCode(error);
  const descriptor = getRuntimeSupervisorErrorDescriptor(error);
  const details = getRuntimeSupervisorErrorDetails(error);
  return {
    message,
    ...(code ? { code } : {}),
    ...(descriptor ? { descriptor } : {}),
    ...(details ? { details } : {})
  };
}

export type RuntimeSupervisorError = Error & {
  code?: string;
  descriptor?: RuntimeSupervisorMessageDescriptor;
  details?: RuntimeSupervisorErrorDetails;
};

export function createRuntimeSupervisorError(payload: RuntimeSupervisorErrorPayload): RuntimeSupervisorError {
  const error = new Error(payload.message) as RuntimeSupervisorError;
  if (payload.code) {
    error.code = payload.code;
  }
  if (isRuntimeSupervisorMessageDescriptor(payload.descriptor)) {
    error.descriptor = payload.descriptor;
  }
  error.details = isRuntimeSupervisorErrorDetails(payload.details)
    ? payload.details
    : { origin: 'protocol' };
  return error;
}

export class RuntimeSupervisorProtocolError extends Error {
  public constructor(
    public readonly descriptor: RuntimeSupervisorMessageDescriptor,
    public readonly code?: RuntimeSupervisorErrorCode,
    public readonly details: RuntimeSupervisorErrorDetails = { origin: 'protocol' }
  ) {
    super(formatRuntimeSupervisorMessageDescriptor(descriptor));
    this.name = 'RuntimeSupervisorProtocolError';
  }
}

export function createRuntimeSupervisorProtocolError(
  descriptor: RuntimeSupervisorMessageDescriptor,
  code?: RuntimeSupervisorErrorCode,
  details?: RuntimeSupervisorErrorDetails
): RuntimeSupervisorProtocolError {
  return new RuntimeSupervisorProtocolError(descriptor, code, details);
}

export function getRuntimeSupervisorErrorDescriptor(
  error: unknown
): RuntimeSupervisorMessageDescriptor | undefined {
  if (!isRecord(error)) {
    return undefined;
  }

  const descriptor = error.descriptor;
  return isRuntimeSupervisorMessageDescriptor(descriptor) ? descriptor : undefined;
}

export function getRuntimeSupervisorErrorDetails(error: unknown): RuntimeSupervisorErrorDetails | undefined {
  if (!isRecord(error)) {
    return undefined;
  }

  return isRuntimeSupervisorErrorDetails(error.details) ? error.details : undefined;
}

export function isRuntimeSupervisorExecutionSpawnError(error: unknown): boolean {
  return getRuntimeSupervisorErrorDetails(error)?.origin === 'execution-spawn';
}

export function formatRuntimeSupervisorMessageDescriptor(
  descriptor: RuntimeSupervisorMessageDescriptor
): string {
  const params = descriptor.params ?? {};
  switch (descriptor.id) {
    case 'parseError':
      return `Could not parse runtime supervisor message${params.message ? `: ${params.message}` : '.'}`;
    case 'sessionAlreadyExists':
      return `Runtime session ${params.sessionId ?? '<unknown>'} already exists.`;
    case 'sessionNotFound':
      return `Runtime session ${params.sessionId ?? '<unknown>'} was not found.`;
    case 'sessionNotLive':
      return `Runtime session ${params.sessionId ?? '<unknown>'} is not live.`;
    case 'claudeAgentCtrlZUnsupported':
      return 'Claude Agent nodes do not support Ctrl-Z/fg. Use stop, resume, or fork instead.';
    case 'claudeCodeSuspended':
      return 'Claude Code is suspended. Click "Stop" to end the session, then restart.';
    case 'agentSessionDeleted':
      return 'Agent session deleted.';
    case 'terminalSessionDeleted':
      return 'Terminal session deleted.';
    case 'agentSessionStopped':
      return `Stopped ${params.label ?? 'Agent'} session.`;
    case 'agentSessionEnded':
      return `${params.label ?? 'Agent'} session ended.`;
    case 'terminalStopped':
      return 'Terminal stopped.';
    case 'terminalSessionEnded':
      return 'Terminal session ended.';
    case 'recoveredHistoryOnly':
      return 'The session supervisor did not retain the original live runtime. Only history results were restored.';
    case 'agentExitedSignal':
      return appendRuntimeSupervisorSummarySuffix(
        `${params.label ?? 'Agent'} exited with signal ${params.signal ?? '<unknown>'}.`,
        params.suffix
      );
    case 'agentExitedCode':
      return appendRuntimeSupervisorSummarySuffix(
        `${params.label ?? 'Agent'} exited with code ${params.code ?? '<unknown>'}.`,
        params.suffix
      );
    case 'agentResumeFailedSignal':
      return appendRuntimeSupervisorSummarySuffix(
        `Resuming ${params.label ?? 'Agent'} received signal ${params.signal ?? '<unknown>'}.`,
        params.suffix
      );
    case 'agentResumeFailedCode':
      return appendRuntimeSupervisorSummarySuffix(
        `Resuming ${params.label ?? 'Agent'} ended with code ${params.code ?? '<unknown>'}.`,
        params.suffix
      );
    case 'terminalExitedSignal':
      return appendRuntimeSupervisorSummarySuffix(
        `Terminal ${params.shellPath ?? '<unknown>'} exited with signal ${params.signal ?? '<unknown>'}.`,
        params.suffix
      );
    case 'terminalExitedCode':
      return appendRuntimeSupervisorSummarySuffix(
        `Terminal ${params.shellPath ?? '<unknown>'} exited with code ${params.code ?? '<unknown>'}.`,
        params.suffix
      );
    case 'supervisorMissingStorageDir':
      return 'Runtime supervisor failed to start: missing --storage-dir.';
    case 'launcherMissingSupervisorScript':
      return 'Runtime supervisor launcher failed to start: missing --supervisor-script.';
    case 'launcherMissingStorageDir':
      return 'Runtime supervisor launcher failed to start: missing --storage-dir.';
    case 'legacySocketPathUnavailable':
      return 'Could not create a legacy runtime supervisor path within the Unix socket limit.';
    case 'systemdUserUnsupportedOnWindows':
      return 'The systemd-user backend does not support Windows.';
    case 'systemdControlPathUnavailable':
      return 'Could not create a systemd-user control path within the Unix socket limit.';
    case 'homeDirectoryUnavailable':
      return 'Could not resolve the current user home directory, so the runtime host backend cannot initialize.';
    case 'clientDisposed':
      return 'RuntimeSupervisorClient has been disposed.';
    case 'clientDisconnected':
      return 'RuntimeSupervisorClient disconnected.';
    case 'clientNotConnected':
      return 'Could not connect to the runtime supervisor.';
    case 'clientConnectionClosed':
      return 'Runtime supervisor connection closed.';
    case 'clientSocketUnavailable':
      return 'Runtime supervisor socket is unavailable.';
    case 'clientSocketRefused':
      return 'Runtime supervisor socket refused the connection.';
    case 'clientReadyTimeout':
      return 'Timed out waiting for the runtime supervisor to start.';
    case 'executionSpawnFailed':
      return `Could not start runtime process ${params.file ?? '<unknown>'}${params.cwd ? ` in ${params.cwd}` : ''}${params.detail ? `: ${params.detail}` : '.'}`;
    case 'systemdBackendMissingPaths':
      return 'The systemd-user backend is missing unit or controlDir paths.';
    case 'systemdCommandFailed':
      return `${params.command ?? 'systemctl --user'} failed${params.detail ? `: ${params.detail}` : '.'}`;
    case 'terminalAuthorityMismatch':
      return `Runtime terminal authority mismatch for session ${params.sessionId ?? '<unknown>'}.`;
    case 'terminalRevisionInvalid':
      return `Runtime terminal revision ${params.revision ?? '<unknown>'} is invalid for session ${params.sessionId ?? '<unknown>'}.`;
    case 'terminalJournalUnavailable':
      return `Runtime terminal journal is unavailable for session ${params.sessionId ?? '<unknown>'}.`;
    case 'terminalJournalPersistenceFailed':
      return `Runtime terminal journal persistence failed for session ${params.sessionId ?? '<unknown>'}.`;
    default:
      return 'Runtime supervisor operation failed.';
  }
}

function readRuntimeSupervisorErrorCode(error: unknown): string | undefined {
  if (!isRecord(error)) {
    return undefined;
  }

  const code = error.code;
  return typeof code === 'string' && code.trim() ? code.trim() : undefined;
}

function appendRuntimeSupervisorSummarySuffix(message: string, suffix?: string): string {
  const normalizedSuffix = suffix?.trim();
  return normalizedSuffix ? `${message} ${normalizedSuffix}` : message;
}

function isRuntimeSupervisorMessageDescriptor(value: unknown): value is RuntimeSupervisorMessageDescriptor {
  if (!isRecord(value)) {
    return false;
  }

  const id = value.id;
  if (typeof id !== 'string' || !isRuntimeSupervisorMessageId(id)) {
    return false;
  }

  const params = value.params;
  if (params !== undefined && !isRuntimeSupervisorMessageParams(params)) {
    return false;
  }

  return true;
}

function isRuntimeSupervisorMessageParams(value: unknown): value is Record<string, string> {
  if (!isRecord(value)) {
    return false;
  }

  return Object.values(value).every((entry) => typeof entry === 'string');
}

function isRuntimeSupervisorErrorDetails(value: unknown): value is RuntimeSupervisorErrorDetails {
  if (!isRecord(value)) {
    return false;
  }

  const origin = value.origin;
  if (origin !== 'transport' && origin !== 'readiness' && origin !== 'protocol' && origin !== 'execution-spawn') {
    return false;
  }

  return ['errno', 'file', 'cwd'].every((key) => value[key] === undefined || typeof value[key] === 'string');
}

function isRuntimeSupervisorMessageId(value: string): value is RuntimeSupervisorMessageId {
  switch (value) {
    case 'parseError':
    case 'sessionAlreadyExists':
    case 'sessionNotFound':
    case 'sessionNotLive':
    case 'claudeAgentCtrlZUnsupported':
    case 'claudeCodeSuspended':
    case 'agentSessionDeleted':
    case 'terminalSessionDeleted':
    case 'agentSessionStopped':
    case 'agentSessionEnded':
    case 'terminalStopped':
    case 'terminalSessionEnded':
    case 'recoveredHistoryOnly':
    case 'agentExitedSignal':
    case 'agentExitedCode':
    case 'agentResumeFailedSignal':
    case 'agentResumeFailedCode':
    case 'terminalExitedSignal':
    case 'terminalExitedCode':
    case 'supervisorMissingStorageDir':
    case 'launcherMissingSupervisorScript':
    case 'launcherMissingStorageDir':
    case 'legacySocketPathUnavailable':
    case 'systemdUserUnsupportedOnWindows':
    case 'systemdControlPathUnavailable':
    case 'homeDirectoryUnavailable':
    case 'clientDisposed':
    case 'clientDisconnected':
    case 'clientNotConnected':
    case 'clientConnectionClosed':
    case 'clientSocketUnavailable':
    case 'clientSocketRefused':
    case 'clientReadyTimeout':
    case 'executionSpawnFailed':
    case 'systemdBackendMissingPaths':
    case 'systemdCommandFailed':
    case 'terminalAuthorityMismatch':
    case 'terminalRevisionInvalid':
    case 'terminalJournalUnavailable':
    case 'terminalJournalPersistenceFailed':
      return true;
    default:
      return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
