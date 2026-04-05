import * as vscode from 'vscode';

type CanvasSurfaceLocation = 'editor' | 'panel';

interface CanvasWebviewHtmlOptions {
  mode: 'active' | 'standby';
  surface: CanvasSurfaceLocation;
  activeSurface?: CanvasSurfaceLocation;
}

export function getWebviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  options: CanvasWebviewHtmlOptions
): string {
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'webview.js'));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'webview.css'));
  const nonce = createNonce();
  const shell = getSharedShell(webview, nonce, styleUri);

  if (options.mode === 'standby') {
    return buildStandbyHtml(shell, options);
  }

  return buildActiveHtml(shell, scriptUri, nonce);
}

function getSharedShell(webview: vscode.Webview, nonce: string, styleUri: vscode.Uri): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Dev Session Canvas</title>
    <link rel="stylesheet" href="${styleUri}" />
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

      .react-flow__attribution {
        display: none;
      }

      .surface-standby {
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 24px;
      }

      .surface-standby-card {
        width: min(100%, 460px);
        display: grid;
        gap: 14px;
        padding: 24px;
        border-radius: 18px;
        border: 1px solid color-mix(in srgb, var(--panel-border) 80%, #1e3a5f 20%);
        background: color-mix(in srgb, var(--panel-bg) 92%, #0b1426 8%);
        box-shadow: 0 18px 40px rgba(8, 15, 28, 0.24);
      }

      .surface-standby-eyebrow {
        margin: 0;
        font-size: 12px;
        font-weight: 600;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: var(--panel-muted);
      }

      .surface-standby-card h1 {
        margin: 0;
        font-size: 20px;
        line-height: 1.3;
      }

      .surface-standby-card p {
        margin: 0;
        font-size: 13px;
        line-height: 1.6;
        color: var(--panel-muted);
      }

      .surface-standby-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }

      .surface-standby-link {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 34px;
        padding: 0 14px;
        border-radius: 999px;
        border: 1px solid color-mix(in srgb, var(--accent) 58%, var(--panel-border) 42%);
        color: var(--panel-fg);
        background: color-mix(in srgb, var(--accent) 18%, var(--panel-bg) 82%);
        text-decoration: none;
      }

      .surface-standby-link.is-secondary {
        border-color: color-mix(in srgb, var(--panel-border) 82%, #0f172a 18%);
        background: transparent;
      }
    </style>
  </head>`;
}

function buildActiveHtml(shell: string, scriptUri: vscode.Uri, nonce: string): string {
  return `${shell}
  <body>
    <div id="app"></div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`;
}

function buildStandbyHtml(shell: string, options: CanvasWebviewHtmlOptions): string {
  const targetCommand = options.surface === 'editor' ? 'command:opencove.openCanvasInEditor' : 'command:opencove.openCanvasInPanel';
  const activeSurface = options.activeSurface ? humanizeSurfaceLocation(options.activeSurface) : '另一个宿主承载面';

  return `${shell}
  <body>
    <div class="surface-standby">
      <div class="surface-standby-card">
        <p class="surface-standby-eyebrow">Dev Session Canvas</p>
        <h1>当前主画布正在${activeSurface}中运行</h1>
        <p>
          DevSessionCanvas 当前采用单主 surface 模型。为了避免同一个 Agent 或 Terminal 会话被两个宿主区域重复附着，
          这里仅保留切换入口，不再渲染第二个可交互画布。
        </p>
        <div class="surface-standby-actions">
          <a class="surface-standby-link" href="${targetCommand}">切换到${humanizeSurfaceLocation(options.surface)}</a>
          <a class="surface-standby-link is-secondary" href="command:opencove.openCanvas">按默认位置打开</a>
        </div>
      </div>
    </div>
  </body>
</html>`;
}

function humanizeSurfaceLocation(surface: CanvasSurfaceLocation): string {
  return surface === 'panel' ? '面板' : '编辑区';
}

function createNonce(): string {
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let value = '';

  for (let index = 0; index < 32; index += 1) {
    value += possible.charAt(Math.floor(Math.random() * possible.length));
  }

  return value;
}
