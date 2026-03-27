import * as vscode from 'vscode';

export function getWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'webview.js'));
  const nonce = createNonce();

  return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>OpenCove Canvas Prototype</title>
    <style>
      :root {
        color-scheme: light dark;
        --panel-bg: var(--vscode-editor-background);
        --panel-fg: var(--vscode-editor-foreground);
        --panel-muted: var(--vscode-descriptionForeground);
        --panel-border: var(--vscode-panel-border);
        --accent: var(--vscode-focusBorder);
        --card-bg: color-mix(in srgb, var(--panel-bg) 92%, #4f8cff 8%);
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        font-family: var(--vscode-font-family);
        color: var(--panel-fg);
        background:
          radial-gradient(circle at top left, color-mix(in srgb, var(--accent) 28%, transparent) 0%, transparent 38%),
          linear-gradient(180deg, color-mix(in srgb, var(--panel-bg) 94%, #0b1020 6%), var(--panel-bg));
      }

      #app {
        min-height: 100vh;
      }
    </style>
  </head>
  <body>
    <div id="app"></div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`;
}

function createNonce(): string {
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let value = '';

  for (let index = 0; index < 32; index += 1) {
    value += possible.charAt(Math.floor(Math.random() * possible.length));
  }

  return value;
}
