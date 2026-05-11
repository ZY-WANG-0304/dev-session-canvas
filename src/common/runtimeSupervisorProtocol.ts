import type {
  AgentProviderKind,
  AgentResumeStrategy,
  ExecutionNodeKind,
  PendingExecutionLaunch,
  RuntimeHostBackendKind,
  RuntimePersistenceGuarantee,
  TerminalNodeStatus,
  AgentNodeStatus
} from './protocol';
import type { SerializedTerminalState } from './serializedTerminalState';
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
  serializedTerminalState?: SerializedTerminalState;
  displayLabel: string;
  launchMode: PendingExecutionLaunch;
  provider?: AgentProviderKind;
  resumeStrategy?: AgentResumeStrategy;
  resumeSessionId?: string;
  resumeStoragePath?: string;
  lastExitCode?: number;
  lastExitSignal?: string;
  lastExitMessage?: string;
}

export interface RuntimeSupervisorErrorPayload {
  message: string;
  code?: string;
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
  launchSpec: SerializedExecutionSessionLaunchSpec;
}

export interface RuntimeSupervisorAttachSessionParams {
  sessionId: string;
}

export interface RuntimeSupervisorWriteInputParams {
  sessionId: string;
  data: string;
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
      };
    }
  | {
      type: 'event';
      event: 'sessionState';
      payload: RuntimeSupervisorSessionSnapshot;
    };

export type RuntimeSupervisorMessage =
  | RuntimeSupervisorRequest
  | RuntimeSupervisorResponse
  | RuntimeSupervisorEvent;

export interface RuntimeSupervisorClientEventHandlers {
  onSessionOutput?: (event: Extract<RuntimeSupervisorEvent, { event: 'sessionOutput' }>['payload']) => void;
  onSessionState?: (snapshot: RuntimeSupervisorSessionSnapshot) => void;
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
  return code ? { message, code } : { message };
}

export function createRuntimeSupervisorError(payload: RuntimeSupervisorErrorPayload): Error & { code?: string } {
  const error = new Error(payload.message) as Error & { code?: string };
  if (payload.code) {
    error.code = payload.code;
  }
  return error;
}

function readRuntimeSupervisorErrorCode(error: unknown): string | undefined {
  if (!isRecord(error)) {
    return undefined;
  }

  const code = error.code;
  return typeof code === 'string' && code.trim() ? code.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
