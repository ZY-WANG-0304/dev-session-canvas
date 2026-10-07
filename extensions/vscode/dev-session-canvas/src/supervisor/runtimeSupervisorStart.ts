import { execFile, spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import { promisify } from 'util';

import type { ExecutionCandidateProfile } from '../common/executionLifecycle';
import {
  assertExecutionCandidateRuntimeSupervisorStorageDir,
  isRootOwnerRuntimeSupervisorStorageDir
} from '../common/runtimeSupervisorPaths';
import {
  RUNTIME_SUPERVISOR_ERROR_CODES,
  createRuntimeSupervisorProtocolError
} from '../common/runtimeSupervisorProtocol';
import type { RuntimeHostBackendDescriptor, RuntimeHostBackendStartArgs } from '../panel/runtimeHostBackend';

const execFileAsync = promisify(execFile);
export const SYSTEMD_COMMAND_TIMEOUT_MS = 4000;
const TEST_SYSTEMCTL_SHIM_ENV = 'DEV_SESSION_CANVAS_TEST_SYSTEMCTL_SHIM';
const TEST_NODE_PATH_ENV = 'DEV_SESSION_CANVAS_TEST_NODE_PATH';
const SUPERVISOR_PROCESS_ENV = {
  ELECTRON_RUN_AS_NODE: '1',
  ELECTRON_NO_ATTACH_CONSOLE: '1'
} as const;

export async function startRuntimeSupervisor(
  backend: RuntimeHostBackendDescriptor,
  args: RuntimeHostBackendStartArgs
): Promise<void> {
  if (args.executionProfile !== undefined) {
    assertExecutionCandidateRuntimeSupervisorStorageDir(backend.paths.storageDir, args.executionProfile);
  }

  if (backend.kind === 'systemd-user') {
    await startSystemdUserSupervisor(backend, args);
    return;
  }

  startLegacyDetachedSupervisor(backend, args);
}

function startLegacyDetachedSupervisor(
  backend: RuntimeHostBackendDescriptor,
  args: RuntimeHostBackendStartArgs
): void {
  const executablePath = resolveSupervisorExecPath();
  const childArgs = [
    args.supervisorLauncherScriptPath,
    '--supervisor-script',
    args.supervisorScriptPath,
    '--storage-dir',
    backend.paths.storageDir,
    '--socket-path',
    backend.paths.socketPath,
    '--runtime-backend',
    backend.kind,
    '--runtime-guarantee',
    backend.guarantee
  ];

  if (backend.paths.runtimeDir) {
    childArgs.push('--runtime-dir', backend.paths.runtimeDir);
  }

  if (backend.paths.controlDir) {
    childArgs.push('--control-dir', backend.paths.controlDir);
  }

  if (args.executionProfile !== undefined) {
    childArgs.push('--execution-profile', args.executionProfile);
  }

  if (args.runtimeLaunchToken !== undefined) {
    childArgs.push('--runtime-launch-token', args.runtimeLaunchToken);
  }

  const child = spawn(executablePath, childArgs, {
    detached: true,
    env: buildSupervisorProcessEnv(),
    stdio: 'ignore',
    windowsHide: true
  });
  child.unref();
}

async function startSystemdUserSupervisor(
  backend: RuntimeHostBackendDescriptor,
  args: RuntimeHostBackendStartArgs
): Promise<void> {
  const unitName = backend.paths.unitName;
  const unitFilePath = backend.paths.unitFilePath;
  const controlDir = backend.paths.controlDir;
  if (!unitName || !unitFilePath || !controlDir) {
    throw createRuntimeSupervisorProtocolError({
      id: 'systemdBackendMissingPaths'
    }, RUNTIME_SUPERVISOR_ERROR_CODES.systemdBackendMissingPaths);
  }

  await fs.mkdir(backend.paths.storageDir, {
    recursive: true,
    ...(isRootOwnerRuntimeSupervisorStorageDir(backend.paths.storageDir) ? { mode: 0o700 } : {})
  });
  await fs.mkdir(path.dirname(unitFilePath), { recursive: true });
  await fs.mkdir(controlDir, { recursive: true, mode: 0o700 });
  try {
    await fs.chmod(controlDir, 0o700);
  } catch {
    // Best effort only.
  }

  const unitContent = renderSystemdUserUnit({
    unitName,
    backend,
    supervisorScriptPath: args.supervisorScriptPath,
    executionProfile: args.executionProfile,
    runtimeLaunchToken: args.runtimeLaunchToken
  });
  await fs.writeFile(unitFilePath, unitContent, 'utf8');

  await runSystemdUserCommand(['daemon-reload']);
  await runSystemdUserCommand(['start', unitName]);
}

async function runSystemdUserCommand(args: string[]): Promise<void> {
  const command = resolveSystemctlCommand();
  try {
    await execFileAsync(command.file, [...command.prefixArgs, '--user', ...args], {
      timeout: SYSTEMD_COMMAND_TIMEOUT_MS,
      windowsHide: true
    });
  } catch (error) {
    throw normalizeSystemdCommandError(args, error);
  }
}

function normalizeSystemdCommandError(args: string[], error: unknown): Error {
  const commandLabel = `systemctl --user ${args.join(' ')}`;
  if (!(error instanceof Error)) {
    return createRuntimeSupervisorProtocolError({
      id: 'systemdCommandFailed',
      params: {
        command: commandLabel
      }
    }, RUNTIME_SUPERVISOR_ERROR_CODES.systemdCommandFailed);
  }

  const stderr =
    typeof (error as Error & { stderr?: string }).stderr === 'string'
      ? (error as Error & { stderr?: string }).stderr?.trim()
      : '';
  const stdout =
    typeof (error as Error & { stdout?: string }).stdout === 'string'
      ? (error as Error & { stdout?: string }).stdout?.trim()
      : '';
  const detail = stderr || stdout || error.message;
  return createRuntimeSupervisorProtocolError({
    id: 'systemdCommandFailed',
    params: {
      command: commandLabel,
      detail: detail || 'Unknown error.'
    }
  }, RUNTIME_SUPERVISOR_ERROR_CODES.systemdCommandFailed);
}

function renderSystemdUserUnit(params: {
  unitName: string;
  backend: RuntimeHostBackendDescriptor;
  supervisorScriptPath: string;
  executionProfile?: ExecutionCandidateProfile;
  runtimeLaunchToken?: string;
}): string {
  const executablePath = resolveSupervisorExecPath();
  const execArgs = [
    executablePath,
    params.supervisorScriptPath,
    '--storage-dir',
    params.backend.paths.storageDir,
    '--socket-path',
    params.backend.paths.socketPath,
    '--runtime-backend',
    params.backend.kind,
    '--runtime-guarantee',
    params.backend.guarantee
  ];
  if (params.backend.paths.controlDir) {
    execArgs.push('--control-dir', params.backend.paths.controlDir);
  }

  if (params.backend.paths.runtimeDir) {
    execArgs.push('--runtime-dir', params.backend.paths.runtimeDir);
  }

  if (params.executionProfile !== undefined) {
    execArgs.push('--execution-profile', params.executionProfile);
  }

  if (params.runtimeLaunchToken !== undefined) {
    execArgs.push('--runtime-launch-token', params.runtimeLaunchToken);
  }

  return [
    '[Unit]',
    `Description=Dev Session Canvas Runtime Supervisor (${escapeSystemdValue(params.unitName)})`,
    'After=default.target',
    '',
    '[Service]',
    'Type=simple',
    ...Object.entries(SUPERVISOR_PROCESS_ENV).map(
      ([key, value]) => `Environment=${quoteSystemdExecArg(`${key}=${value}`)}`
    ),
    `WorkingDirectory=${quoteSystemdExecArg(params.backend.paths.storageDir)}`,
    `ExecStart=${execArgs.map((value) => quoteSystemdExecArg(value)).join(' ')}`,
    params.executionProfile === undefined ? 'Restart=on-failure' : 'Restart=no',
    'RestartSec=1',
    '',
    '[Install]',
    'WantedBy=default.target',
    ''
  ].join('\n');
}

function quoteSystemdExecArg(value: string): string {
  return `"${escapeSystemdValue(value)}"`;
}

function escapeSystemdValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/%/g, '%%');
}

function resolveSupervisorExecPath(): string {
  return process.env[TEST_NODE_PATH_ENV]?.trim() || process.execPath;
}

function buildSupervisorProcessEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...SUPERVISOR_PROCESS_ENV
  };
}

export function resolveSystemctlCommand(): {
  file: string;
  prefixArgs: string[];
} {
  const shimPath = process.env[TEST_SYSTEMCTL_SHIM_ENV]?.trim();
  if (shimPath) {
    return {
      file: process.env[TEST_NODE_PATH_ENV]?.trim() || process.execPath,
      prefixArgs: [shimPath]
    };
  }

  return {
    file: 'systemctl',
    prefixArgs: []
  };
}
