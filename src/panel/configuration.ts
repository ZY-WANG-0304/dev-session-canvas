import * as vscode from 'vscode';

import { CONFIG_KEYS } from '../common/extensionIdentity';

export function getConfigurationValue<T>(key: keyof typeof CONFIG_KEYS, defaultValue: T): T {
  const configuration = vscode.workspace.getConfiguration();
  return configuration.get<T>(CONFIG_KEYS[key], defaultValue);
}
