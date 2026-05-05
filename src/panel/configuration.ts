import * as vscode from 'vscode';

import { CONFIG_KEYS } from '../common/extensionIdentity';
import {
  resolveEffectiveTerminalShellConfiguration,
  inspectConfiguredTerminalShell,
  resolveConfiguredTerminalShell,
  type EffectiveTerminalShellConfiguration,
  type InspectedConfiguredTerminalShell,
  type ResolvedConfiguredTerminalShell
} from './terminalShellConfiguration';

type InspectConfigurationResult<T> =
  | {
      workspaceValue?: T;
      workspaceFolderValue?: T;
    }
  | undefined;

export function getConfigurationValue<T>(key: keyof typeof CONFIG_KEYS, defaultValue: T): T {
  const configuration = vscode.workspace.getConfiguration();
  return configuration.get<T>(CONFIG_KEYS[key], defaultValue);
}

function getWorkspaceScopedConfigurationValue<T>(
  inspection: InspectConfigurationResult<T>
): T | undefined {
  return typeof inspection?.workspaceFolderValue !== 'undefined'
    ? inspection.workspaceFolderValue
    : inspection?.workspaceValue;
}

export function getEffectiveTerminalShellConfiguration(): EffectiveTerminalShellConfiguration {
  const configuration = vscode.workspace.getConfiguration();
  const configuredShell = configuration.inspect<string>(CONFIG_KEYS.terminalShell);
  const configuredPath = configuration.inspect<string>(CONFIG_KEYS.terminalShellPath);
  return resolveEffectiveTerminalShellConfiguration({
    defaultConfiguredShell: configuredShell?.defaultValue,
    globalConfiguredShell: configuredShell?.globalValue,
    workspaceConfiguredShell: getWorkspaceScopedConfigurationValue(configuredShell),
    defaultConfiguredPath: configuredPath?.defaultValue,
    globalConfiguredPath: configuredPath?.globalValue,
    workspaceConfiguredPath: getWorkspaceScopedConfigurationValue(configuredPath),
    hasWorkspace: Boolean(vscode.workspace.workspaceFile || (vscode.workspace.workspaceFolders?.length ?? 0) > 0)
  });
}

export function getConfiguredTerminalShell(): ResolvedConfiguredTerminalShell {
  const effectiveConfiguration = getEffectiveTerminalShellConfiguration();
  return resolveConfiguredTerminalShell({
    configuredShell: effectiveConfiguration.configuredShell,
    configuredPath: effectiveConfiguration.configuredPath,
    defaultShellPath: vscode.env.shell
  });
}

export function inspectCurrentConfiguredTerminalShell(): InspectedConfiguredTerminalShell {
  const effectiveConfiguration = getEffectiveTerminalShellConfiguration();
  return inspectConfiguredTerminalShell({
    configuredShell: effectiveConfiguration.configuredShell,
    configuredPath: effectiveConfiguration.configuredPath,
    defaultShellPath: vscode.env.shell
  });
}
