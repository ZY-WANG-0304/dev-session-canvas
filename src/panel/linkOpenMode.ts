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
    let simpleBrowserTargetUri: vscode.Uri;
    try {
      simpleBrowserTargetUri = await resolveSimpleBrowserTargetUri(uri);
    } catch {
      return {
        opened: false,
        openerKind: SIMPLE_BROWSER_OPEN_COMMAND,
        targetUri
      };
    }

    const simpleBrowserTarget = simpleBrowserTargetUri.toString();
    try {
      // The generic VS Code opener can delegate web URLs to the system browser;
      // Simple Browser is the explicit in-workbench/editor preview path.
      await vscode.commands.executeCommand(SIMPLE_BROWSER_OPEN_COMMAND, simpleBrowserTargetUri, {
        preserveFocus: false,
        viewColumn: vscode.ViewColumn.Active
      });
      return {
        opened: true,
        openerKind: SIMPLE_BROWSER_OPEN_COMMAND,
        targetUri: simpleBrowserTarget
      };
    } catch {
      return {
        opened: false,
        openerKind: SIMPLE_BROWSER_OPEN_COMMAND,
        targetUri: simpleBrowserTarget
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

async function resolveSimpleBrowserTargetUri(uri: vscode.Uri): Promise<vscode.Uri> {
  const forwardableUri = getForwardableLocalWebUri(uri);
  if (!forwardableUri) {
    return uri;
  }

  return vscode.env.asExternalUri(forwardableUri);
}

function getForwardableLocalWebUri(uri: vscode.Uri): vscode.Uri | undefined {
  const url = parseWebUrl(uri);
  if (!url || !isLocalWebHost(url.hostname)) {
    return undefined;
  }

  const normalizedHostname = normalizeWebHostname(url.hostname);
  if (normalizedHostname === 'localhost' || isAllInterfaceWebHost(normalizedHostname)) {
    // Dev servers often print 0.0.0.0/[::], but forwarding needs a connectable loopback host.
    url.hostname = 'localhost';
  }

  return vscode.Uri.parse(url.toString());
}

function parseWebUrl(uri: vscode.Uri): URL | undefined {
  try {
    return new URL(uri.toString(true));
  } catch {
    return undefined;
  }
}

function isLocalWebHost(hostname: string): boolean {
  const normalizedHostname = normalizeWebHostname(hostname);
  return (
    normalizedHostname === 'localhost' ||
    normalizedHostname === '[::1]' ||
    isIpv4LoopbackHost(normalizedHostname) ||
    isIpv6MappedIpv4LoopbackHost(normalizedHostname) ||
    isAllInterfaceWebHost(normalizedHostname)
  );
}

function isAllInterfaceWebHost(hostname: string): boolean {
  const normalizedHostname = normalizeWebHostname(hostname);
  return normalizedHostname === '0.0.0.0' || normalizedHostname === '[::]';
}

function isIpv4LoopbackHost(hostname: string): boolean {
  const octets = hostname.split('.');
  return (
    octets.length === 4 &&
    octets.every((octet) => /^\d+$/u.test(octet) && Number(octet) >= 0 && Number(octet) <= 255) &&
    octets[0] === '127'
  );
}

function isIpv6MappedIpv4LoopbackHost(hostname: string): boolean {
  const match = /^\[::ffff:([0-9a-f]+):([0-9a-f]+)\]$/u.exec(hostname);
  if (!match) {
    return false;
  }

  const high = Number.parseInt(match[1], 16);
  const low = Number.parseInt(match[2], 16);
  if (high < 0 || high > 0xffff || low < 0 || low > 0xffff) {
    return false;
  }

  return high >> 8 === 127;
}

function normalizeWebHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/\.$/u, '');
}

function isHttpOrHttpsUri(uri: vscode.Uri): boolean {
  return uri.scheme === 'http' || uri.scheme === 'https';
}
