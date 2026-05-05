import * as vscode from 'vscode';

export const SMOKE_TEST_MODE_ENV_KEY = 'DEV_SESSION_CANVAS_SMOKE_TEST_MODE';

export function isSmokeTestModeEnabled(): boolean {
  const rawValue = process.env[SMOKE_TEST_MODE_ENV_KEY]?.trim().toLowerCase();
  return rawValue === '1' || rawValue === 'true';
}

export function isTestHarnessMode(extensionMode: vscode.ExtensionMode): boolean {
  return extensionMode === vscode.ExtensionMode.Test || isSmokeTestModeEnabled();
}
