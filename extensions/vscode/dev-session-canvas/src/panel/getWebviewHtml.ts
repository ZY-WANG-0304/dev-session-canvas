import * as vscode from 'vscode';

import { COMMAND_IDS, EXTENSION_DISPLAY_NAME } from '../common/extensionIdentity';
import type {
  CanvasSurfaceLocation,
  CanvasSurfaceMode,
  WebviewLifecycleIdentity
} from '../common/protocol';
import { getVersionedWebviewResourceUri } from '../common/webviewResourceUri';
import {
  formatWebviewMessage,
  resolveWebviewI18n,
  type WebviewI18nBootstrap
} from '../webview/i18n/webviewI18n';

interface CanvasWebviewHtmlOptions {
  mode: CanvasSurfaceMode;
  surface: CanvasSurfaceLocation;
  activeSurface?: CanvasSurfaceLocation;
  lifecycle?: WebviewLifecycleIdentity;
}

export function getWebviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  options: CanvasWebviewHtmlOptions
): string {
  const scriptUri = getVersionedWebviewResourceUri(webview, extensionUri, 'dist', 'webview.js');
  const styleUri = getVersionedWebviewResourceUri(webview, extensionUri, 'dist', 'webview.css');
  const nonce = createNonce();
  const i18n = resolveWebviewI18n(vscode.env.language);
  const shell = getSharedShell(webview, nonce, styleUri, i18n.locale);

  if (options.mode === 'standby') {
    return buildStandbyHtml(shell, options, i18n);
  }

  if (!options.lifecycle) {
    throw new Error('Active canvas webview HTML requires a lifecycle identity.');
  }

  return buildActiveHtml(shell, scriptUri, nonce, options.lifecycle, i18n);
}

function getSharedShell(webview: vscode.Webview, nonce: string, styleUri: vscode.Uri, locale: string): string {
  return `<!DOCTYPE html>
<html lang="${locale}">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${EXTENSION_DISPLAY_NAME}</title>
    <link rel="stylesheet" href="${styleUri}" />
    <style>
      :root {
        color-scheme: light dark;
        --panel-bg: var(--vscode-editor-background);
        --panel-fg: var(--vscode-editor-foreground);
        --panel-muted: var(--vscode-descriptionForeground);
        --panel-border: var(--vscode-panel-border);
        --accent: var(--vscode-focusBorder);
        --card-bg: color-mix(in srgb, var(--panel-bg) 92%, var(--vscode-sideBar-background) 8%);
      }

      * {
        box-sizing: border-box;
      }

      html,
      body,
      #app {
        margin: 0;
        padding: 0;
      }

      body {
        min-height: 100vh;
        font-family: var(--vscode-font-family);
        color: var(--panel-fg);
        background: var(--panel-bg);
      }

      #app {
        min-height: 100vh;
        background: var(--panel-bg);
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
        border: 1px solid color-mix(in srgb, var(--panel-border) 82%, var(--accent) 18%);
        background: color-mix(in srgb, var(--panel-bg) 90%, var(--vscode-sideBar-background) 10%);
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
        border-color: color-mix(in srgb, var(--panel-border) 88%, var(--accent) 12%);
        background: transparent;
      }
    </style>
  </head>`;
}

function buildActiveHtml(
  shell: string,
  scriptUri: vscode.Uri,
  nonce: string,
  lifecycle: WebviewLifecycleIdentity,
  i18n: WebviewI18nBootstrap
): string {
  return `${shell}
  <body>
    <div id="app"></div>
    <script nonce="${nonce}">
      window.__DEV_SESSION_CANVAS_WEBVIEW_IDENTITY__ = ${escapeHtmlScriptJson(lifecycle)};
      window.__DEV_SESSION_CANVAS_I18N__ = ${escapeHtmlScriptJson(i18n)};
    </script>
    <script nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`;
}

function buildStandbyHtml(shell: string, options: CanvasWebviewHtmlOptions, i18n: WebviewI18nBootstrap): string {
  const targetCommand =
    options.surface === 'editor'
      ? `command:${COMMAND_IDS.openCanvasInEditor}`
      : `command:${COMMAND_IDS.openCanvasInPanel}`;
  const activeSurface = options.activeSurface
    ? humanizeSurfaceLocation(options.activeSurface, i18n)
    : formatWebviewMessage(i18n.messages, 'surface.other');
  const targetSurface = humanizeSurfaceLocation(options.surface, i18n);

  return `${shell}
  <body>
    <div class="surface-standby">
      <div class="surface-standby-card">
        <p class="surface-standby-eyebrow">${EXTENSION_DISPLAY_NAME}</p>
        <h1>${escapeHtml(formatWebviewMessage(i18n.messages, 'standby.heading', { surface: activeSurface }))}</h1>
        <p>${escapeHtml(formatWebviewMessage(i18n.messages, 'standby.description'))}</p>
        <div class="surface-standby-actions">
          <a class="surface-standby-link" href="${targetCommand}">${escapeHtml(formatWebviewMessage(i18n.messages, 'standby.switch', { surface: targetSurface }))}</a>
          <a class="surface-standby-link is-secondary" href="command:${COMMAND_IDS.openCanvas}">${escapeHtml(formatWebviewMessage(i18n.messages, 'standby.openDefault'))}</a>
        </div>
      </div>
    </div>
  </body>
</html>`;
}

function humanizeSurfaceLocation(surface: CanvasSurfaceLocation, i18n: WebviewI18nBootstrap): string {
  return formatWebviewMessage(i18n.messages, surface === 'panel' ? 'surface.panel' : 'surface.editor');
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/gu, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return character;
    }
  });
}

function escapeHtmlScriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/gu, (character) => {
    switch (character) {
      case '<':
        return '\\u003C';
      case '>':
        return '\\u003E';
      case '&':
        return '\\u0026';
      case '\u2028':
        return '\\u2028';
      case '\u2029':
        return '\\u2029';
      default:
        return character;
    }
  });
}

function createNonce(): string {
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let value = '';

  for (let index = 0; index < 32; index += 1) {
    value += possible.charAt(Math.floor(Math.random() * possible.length));
  }

  return value;
}
