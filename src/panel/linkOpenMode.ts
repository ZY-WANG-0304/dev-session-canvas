import * as vscode from 'vscode';

import type { CanvasLinkOpenMode } from '../common/protocol';

const SIMPLE_BROWSER_OPEN_COMMAND = 'simpleBrowser.api.open';

export type CanvasExternalLinkOpenerKind =
  | 'simpleBrowser.api.open'
  | 'vscode.open'
  | 'vscode.env.openExternal';

export interface OpenCanvasExternalLinkResult {
  opened: boolean;
  openerKind: CanvasExternalLinkOpenerKind;
  targetUri: string;
}

export async function openCanvasExternalLink(
  uri: vscode.Uri,
  linkOpenMode: CanvasLinkOpenMode
): Promise<OpenCanvasExternalLinkResult> {
  const targetUri = uri.toString();
  if (linkOpenMode === 'externalBrowser') {
    try {
      return {
        opened: await vscode.env.openExternal(uri),
        openerKind: 'vscode.env.openExternal',
        targetUri
      };
    } catch {
      return {
        opened: false,
        openerKind: 'vscode.env.openExternal',
        targetUri
      };
    }
  }

  if (isHttpOrHttpsUri(uri)) {
    try {
      // The generic VS Code opener can delegate web URLs to the system browser;
      // Simple Browser is the explicit in-workbench/editor preview path.
      await vscode.commands.executeCommand(SIMPLE_BROWSER_OPEN_COMMAND, uri, {
        preserveFocus: false,
        viewColumn: vscode.ViewColumn.Active
      });
      return {
        opened: true,
        openerKind: SIMPLE_BROWSER_OPEN_COMMAND,
        targetUri
      };
    } catch {
      return {
        opened: false,
        openerKind: SIMPLE_BROWSER_OPEN_COMMAND,
        targetUri
      };
    }
  }

  try {
    await vscode.commands.executeCommand('vscode.open', uri);
    return {
      opened: true,
      openerKind: 'vscode.open',
      targetUri
    };
  } catch {
    return {
      opened: false,
      openerKind: 'vscode.open',
      targetUri
    };
  }
}

function isHttpOrHttpsUri(uri: vscode.Uri): boolean {
  return uri.scheme === 'http' || uri.scheme === 'https';
}
