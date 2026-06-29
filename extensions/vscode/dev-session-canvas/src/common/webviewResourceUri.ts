import * as crypto from 'crypto';
import * as fs from 'fs';
import * as vscode from 'vscode';

const webviewResourceVersionCache = new Map<string, { mtimeMs: number; version: string }>();

export function getVersionedWebviewResourceUri(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  ...pathSegments: string[]
): vscode.Uri {
  const resourceUri = vscode.Uri.joinPath(extensionUri, ...pathSegments);
  return webview.asWebviewUri(appendResourceVersionQuery(resourceUri));
}

function appendResourceVersionQuery(resourceUri: vscode.Uri): vscode.Uri {
  if (resourceUri.scheme !== 'file') {
    return resourceUri;
  }

  try {
    const stat = fs.statSync(resourceUri.fsPath);
    const cachedVersion = webviewResourceVersionCache.get(resourceUri.fsPath);
    const version =
      cachedVersion?.mtimeMs === stat.mtimeMs
        ? cachedVersion.version
        : crypto.createHash('sha1').update(fs.readFileSync(resourceUri.fsPath)).digest('hex').slice(0, 12);

    if (cachedVersion?.version !== version || cachedVersion?.mtimeMs !== stat.mtimeMs) {
      webviewResourceVersionCache.set(resourceUri.fsPath, {
        mtimeMs: stat.mtimeMs,
        version
      });
    }

    return resourceUri.with({
      query: resourceUri.query ? `${resourceUri.query}&v=${version}` : `v=${version}`
    });
  } catch {
    return resourceUri;
  }
}
