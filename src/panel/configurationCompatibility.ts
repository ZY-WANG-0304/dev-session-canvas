import * as vscode from 'vscode';

import { CONFIG_KEYS, LEGACY_CONFIG_KEYS } from '../common/extensionIdentity';

interface InspectedConfigurationValue<T> {
  workspaceFolderValue?: T;
  workspaceValue?: T;
  globalValue?: T;
}

export function getCanonicalConfigurationValue<T>(key: keyof typeof CONFIG_KEYS, defaultValue: T): T {
  const configuration = vscode.workspace.getConfiguration();
  const primaryInspection = configuration.inspect<T>(CONFIG_KEYS[key]) as InspectedConfigurationValue<T> | undefined;
  const legacyInspection = configuration.inspect<T>(LEGACY_CONFIG_KEYS[key]) as InspectedConfigurationValue<T> | undefined;
  const explicitValue = getExplicitConfigurationValue(primaryInspection, legacyInspection);

  if (explicitValue !== undefined) {
    return explicitValue;
  }

  return configuration.get<T>(CONFIG_KEYS[key], defaultValue);
}

function getExplicitConfigurationValue<T>(
  primaryInspection: InspectedConfigurationValue<T> | undefined,
  legacyInspection: InspectedConfigurationValue<T> | undefined
): T | undefined {
  const scopes: Array<keyof InspectedConfigurationValue<T>> = ['workspaceFolderValue', 'workspaceValue', 'globalValue'];

  for (const scope of scopes) {
    const primaryValue = primaryInspection?.[scope];
    if (primaryValue !== undefined) {
      return primaryValue;
    }

    const legacyValue = legacyInspection?.[scope];
    if (legacyValue !== undefined) {
      return legacyValue;
    }
  }

  return undefined;
}
