import * as vscode from 'vscode';

import { CONFIG_KEYS } from '../common/extensionIdentity';
import {
  inspectConfiguredTerminalShell,
  resolveConfiguredTerminalShell,
  type InspectedConfiguredTerminalShell,
  type ResolvedConfiguredTerminalShell
} from './terminalShellConfiguration';

export function getConfigurationValue<T>(key: keyof typeof CONFIG_KEYS, defaultValue: T): T {
  const configuration = vscode.workspace.getConfiguration();
  return configuration.get<T>(CONFIG_KEYS[key], defaultValue);
}

export function getConfiguredTerminalShell(): ResolvedConfiguredTerminalShell {
  return resolveConfiguredTerminalShell({
    configuredShell: getConfigurationValue('terminalShell', 'default'),
    configuredPath: getConfigurationValue('terminalShellPath', ''),
    defaultShellPath: vscode.env.shell
  });
}

export function inspectCurrentConfiguredTerminalShell(): InspectedConfiguredTerminalShell {
  return inspectConfiguredTerminalShell({
    configuredShell: getConfigurationValue('terminalShell', 'default'),
    configuredPath: getConfigurationValue('terminalShellPath', ''),
    defaultShellPath: vscode.env.shell
  });
}
