import { execFile } from 'child_process';
import { promisify } from 'util';
import * as vscode from 'vscode';

import type { ExecutionCandidateProfile } from '../common/executionLifecycle';
import type {
  RuntimeHostBackendKind,
  RuntimePersistenceGuarantee
} from '../common/protocol';
import {
  resolveLegacyRuntimeSupervisorPaths,
  resolveSystemdUserRuntimeSupervisorPaths
} from '../common/runtimeSupervisorPaths';
import type { RuntimeSupervisorPaths } from '../common/runtimeSupervisorProtocol';
import {
  SYSTEMD_COMMAND_TIMEOUT_MS,
  resolveSystemctlCommand,
  startRuntimeSupervisor
} from '../supervisor/runtimeSupervisorStart';

const execFileAsync = promisify(execFile);
const RUNTIME_HOST_BACKEND_OVERRIDE_ENV = 'DEV_SESSION_CANVAS_RUNTIME_HOST_BACKEND_OVERRIDE';

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
  executionProfile?: ExecutionCandidateProfile;
  runtimeLaunchToken?: string;
}

export interface RuntimeHostBackendFactoryOptions {
  baseStoragePath: string;
  extensionMode: vscode.ExtensionMode;
}

export interface InactiveSystemdUserSupervisorObservation {
  stateToken: string;
  controlGroupStopped: boolean;
}

export async function observeInactiveSystemdUserSupervisor(
  backend: RuntimeHostBackendDescriptor
): Promise<InactiveSystemdUserSupervisorObservation | undefined> {
  if (process.platform !== 'linux' || backend.kind !== 'systemd-user' || !backend.paths.unitName) return undefined;
  const requiredProperties = ['Id', 'LoadState', 'ActiveState', 'SubState', 'MainPID', 'ControlPID', 'ControlGroup',
    'Job', 'InvocationID', 'StateChangeTimestampMonotonic', 'InactiveEnterTimestampMonotonic'];
  const properties = [...requiredProperties, 'KillMode', 'SendSIGKILL'];
  const command = resolveSystemctlCommand();
  try {
    const { stdout } = await execFileAsync(command.file, [...command.prefixArgs, '--user', 'show', '--all',
      '--no-pager', `--property=${properties.join(',')}`, backend.paths.unitName], {
      timeout: SYSTEMD_COMMAND_TIMEOUT_MS, maxBuffer: 16384, encoding: 'utf8', windowsHide: true
    });
    const values = new Map<string, string>();
    for (const line of stdout.trimEnd().split('\n')) {
      const separator = line.indexOf('=');
      if (separator < 1) return undefined;
      const key = line.slice(0, separator);
      if (!properties.includes(key) || values.has(key)) return undefined;
      values.set(key, line.slice(separator + 1));
    }
    if (requiredProperties.some(key => !values.has(key)) || values.get('Id') !== backend.paths.unitName
      || values.get('LoadState') !== 'loaded' || values.get('ActiveState') !== 'inactive'
      || values.get('SubState') !== 'dead' || values.get('MainPID') !== '0' || values.get('ControlPID') !== '0'
      || values.get('ControlGroup') !== '' || !['', '0'].includes(values.get('Job')!)
      || !/^(?:[a-f0-9]{32})?$/.test(values.get('InvocationID')!)
      || ['StateChangeTimestampMonotonic', 'InactiveEnterTimestampMonotonic']
        .some(key => !/^[0-9]+$/.test(values.get(key)!))) return undefined;
    return {
      stateToken: JSON.stringify(properties.map(key => values.get(key))),
      controlGroupStopped: values.get('KillMode') === 'control-group' && values.get('SendSIGKILL') === 'yes'
    };
  } catch {
    return undefined;
  }
}

export function listPreferredRuntimeHostBackendKinds(
  options: RuntimeHostBackendFactoryOptions
): RuntimeHostBackendKind[] {
  const override = readRuntimeHostBackendOverride();
  if (override === 'systemd-user') {
    return ['systemd-user', 'legacy-detached'];
  }

  if (override === 'legacy-detached') {
    return ['legacy-detached'];
  }

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
    startSupervisor: (args) => startRuntimeSupervisor(descriptor, args)
  };
}

function readRuntimeHostBackendOverride(): RuntimeHostBackendKind | undefined {
  const value = process.env[RUNTIME_HOST_BACKEND_OVERRIDE_ENV]?.trim();
  if (value === 'systemd-user' || value === 'legacy-detached') {
    return value;
  }

  return undefined;
}
