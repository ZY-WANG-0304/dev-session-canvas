import * as vscode from 'vscode';

import { CanvasPanelManager } from './panel/CanvasPanelManager';

export function activate(context: vscode.ExtensionContext): void {
  const panelManager = new CanvasPanelManager(context);

  context.subscriptions.push(
    vscode.commands.registerCommand('opencove.openCanvas', async () => {
      await panelManager.revealOrCreate();
    })
  );

  context.subscriptions.push(
    vscode.window.registerWebviewPanelSerializer(CanvasPanelManager.viewType, panelManager)
  );
}

export function deactivate(): void {}
