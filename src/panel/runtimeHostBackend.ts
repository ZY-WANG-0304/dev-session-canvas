import { execFile, spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import { promisify } from 'util';
import * as vscode from 'vscode';

import type {
  RuntimeHostBackendKind,
  RuntimePersistenceGuarantee
} from '../common/protocol';
import {
  resolveLegacyRuntimeSupervisorPaths,
  resolveSystemdUserRuntimeSupervisorPaths
} from '../common/runtimeSupervisorPaths';
import type { RuntimeSupervisorPaths } from '../common/runtimeSupervisorProtocol';

const execFileAsync = promisify(execFile);
const SYSTEMD_COMMAND_TIMEOUT_MS = 4000;

export interface RuntimeHostBackendDescriptor {
  kind: RuntimeHostBackendKind;
  guarantee: RuntimePersistenceGuarantee;
  label: string;
  paths: RuntimeSupervisorPaths;
}

export interface RuntimeHostBackend extends RuntimeHostBackendDescriptor {
  startSupervisor(args: RuntimeHostBackendStartArgs): Promise<void>;
}

export interface RuntimeHostBackendStartArgs {
  supervisorScriptPath: string;
  supervisorLauncherScriptPath: string;
}

export interface RuntimeHostBackendFactoryOptions {
  baseStoragePath: string;
  extensionMode: vscode.ExtensionMode;
}

export function listPreferredRuntimeHostBackendKinds(
  options: RuntimeHostBackendFactoryOptions
): RuntimeHostBackendKind[] {
  if (options.extensionMode !== vscode.ExtensionMode.Test && process.platform === 'linux') {
    return ['systemd-user', 'legacy-detached'];
  }

  return ['legacy-detached'];
}

export function createRuntimeHostBackend(
  kind: RuntimeHostBackendKind,
  options: RuntimeHostBackendFactoryOptions
): RuntimeHostBackend {
  const paths =
    kind === 'systemd-user'
      ? resolveSystemdUserRuntimeSupervisorPaths(options.baseStoragePath)
      : resolveLegacyRuntimeSupervisorPaths(options.baseStoragePath);

  const descriptor: RuntimeHostBackendDescriptor =
    kind === 'systemd-user'
      ? {
          kind,
          guarantee: 'strong',
          label: 'systemd --user',
          paths
        }
      : {
          kind,
          guarantee: 'best-effort',
          label: 'Detached Supervisor',
          paths
        };

  return {
    ...descriptor,
    startSupervisor: async (args) => {
      if (kind === 'systemd-user') {
        await startSystemdUserSupervisor(descriptor, args);
        return;
      }

      startLegacyDetachedSupervisor(descriptor, args);
    }
  };
}

function startLegacyDetachedSupervisor(
  backend: RuntimeHostBackendDescriptor,
  args: RuntimeHostBackendStartArgs
): void {
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

  const child = spawn(process.execPath, childArgs, {
    detached: true,
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
    throw new Error('systemd-user backend 缺少 unit 或 controlDir 路径。');
  }

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
    supervisorScriptPath: args.supervisorScriptPath
  });
  await fs.writeFile(unitFilePath, unitContent, 'utf8');

  await runSystemdUserCommand(['daemon-reload']);
  await runSystemdUserCommand(['start', unitName]);
}

async function runSystemdUserCommand(args: string[]): Promise<void> {
  try {
    await execFileAsync('systemctl', ['--user', ...args], {
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
    return new Error(`${commandLabel} 失败。`);
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
  return new Error(`${commandLabel} 失败：${detail || '未知错误。'}`);
}

function renderSystemdUserUnit(params: {
  unitName: string;
  backend: RuntimeHostBackendDescriptor;
  supervisorScriptPath: string;
}): string {
  const execArgs = [
    process.execPath,
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

  return [
    '[Unit]',
    `Description=Dev Session Canvas Runtime Supervisor (${escapeSystemdValue(params.unitName)})`,
    'After=default.target',
    '',
    '[Service]',
    'Type=simple',
    `WorkingDirectory=${quoteSystemdExecArg(params.backend.paths.storageDir)}`,
    `ExecStart=${execArgs.map((value) => quoteSystemdExecArg(value)).join(' ')}`,
    'Restart=on-failure',
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
