import * as vscode from 'vscode';

const SMOKE_TEST_MODE_ENV_KEY = 'DEV_SESSION_CANVAS_SMOKE_TEST_MODE';

export function isTestHarnessMode(extensionMode: vscode.ExtensionMode): boolean {
  const rawValue = process.env[SMOKE_TEST_MODE_ENV_KEY]?.trim().toLowerCase();
  return extensionMode === vscode.ExtensionMode.Test || rawValue === '1' || rawValue === 'true';
}
