import * as vscode from 'vscode';

import { COMMAND_IDS } from '../common/extensionIdentity';
import { type CanvasSidebarState, CanvasPanelManager } from '../panel/CanvasPanelManager';

type SidebarActionsInboundMessage =
  | {
      type: 'sidebarActions/ready';
    }
  | {
      type: 'sidebarActions/openCanvas';
    }
  | {
      type: 'sidebarActions/createNode';
    }
  | {
      type: 'sidebarActions/resetToDefaultTemplate';
    }
  | {
      type: 'sidebarActions/resetCanvas';
    }
;

type SidebarActionsOutboundMessage = {
  type: 'sidebarActions/state';
  payload: {
    state: Pick<CanvasSidebarState, 'canvasSurface'>;
  };
};

interface SidebarActionsCopy {
  openCanvas: string;
  revealCanvas: string;
  createNode: string;
  resetToDefaultTemplate: string;
  resetCanvas: string;
}

export class CanvasSidebarActionsView implements vscode.WebviewViewProvider, vscode.Disposable {
  private readonly stateSubscription: vscode.Disposable;
  private view: vscode.WebviewView | undefined;
  private lastPostedState: string | undefined;

  public constructor(private readonly panelManager: CanvasPanelManager) {
    this.stateSubscription = this.panelManager.onDidChangeSidebarState((state) => {
      void this.postState(state);
    });
  }

  public dispose(): void {
    this.view = undefined;
    this.stateSubscription.dispose();
  }

  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    this.lastPostedState = undefined;
    webviewView.webview.options = {
      enableScripts: true
    };
    webviewView.webview.html = buildSidebarActionsHtml(webviewView.webview, this.panelManager.getSidebarState());

    webviewView.onDidDispose(() => {
      if (this.view === webviewView) {
        this.view = undefined;
      }
    });

    webviewView.onDidChangeVisibility(() => {
      if (this.view === webviewView && webviewView.visible) void this.postState(undefined, true);
    });

    webviewView.webview.onDidReceiveMessage((message) => {
      void this.handleMessage(message);
    });
  }

  private async postState(state?: CanvasSidebarState, force = false): Promise<void> {
    const view = this.view;
    if (!view || !view.visible) return;
    const current = state ?? this.panelManager.getSidebarState();
    const displayed = {
      canvasSurface: current.canvasSurface
    };
    const key = JSON.stringify(displayed);
    if (!force && key === this.lastPostedState) return;
    // Reserve in posting order; a failed delivery must remain retryable.
    this.lastPostedState = key;
    const message: SidebarActionsOutboundMessage = { type: 'sidebarActions/state', payload: { state: displayed } };
    try {
      if (await view.webview.postMessage(message)) return;
    } catch { /* The next event or visibility/ready handshake retries the current state. */ }
    if (this.view === view && this.lastPostedState === key) this.lastPostedState = undefined;
  }

  private async handleMessage(message: unknown): Promise<void> {
    const parsed = parseSidebarActionsMessage(message);
    if (!parsed) {
      return;
    }

    switch (parsed.type) {
      case 'sidebarActions/ready':
        await this.postState(undefined, true);
        return;
      case 'sidebarActions/openCanvas': {
        const state = this.panelManager.getSidebarState();
        if (state.canvasSurface === 'closed') {
          await this.panelManager.revealOrCreate();
          return;
        }

        if (state.surfaceLocation === 'panel') {
          await this.panelManager.revealInPanel();
          return;
        }

        await this.panelManager.revealInEditor();
        return;
      }
      case 'sidebarActions/createNode':
        await vscode.commands.executeCommand(COMMAND_IDS.createNode);
        return;
      case 'sidebarActions/resetToDefaultTemplate':
        await vscode.commands.executeCommand(COMMAND_IDS.resetToDefaultTemplate);
        return;
      case 'sidebarActions/resetCanvas':
        await vscode.commands.executeCommand(COMMAND_IDS.resetCanvasState);
        return;
    }
  }
}

function buildSidebarActionsHtml(webview: vscode.Webview, state: CanvasSidebarState): string {
  const nonce = createNonce();
  const initialState = serializeStateForInlineScript(state);
  const copy = buildSidebarActionsCopy();

  return `<!DOCTYPE html>
<html lang="${resolveWebviewHtmlLang()}">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>
      :root {
        color-scheme: light dark;
        --fg: var(--vscode-sideBar-foreground);
        --muted: var(--vscode-descriptionForeground);
        --bg: var(--vscode-sideBar-background);
        --border: var(--vscode-panel-border);
        --input-bg: var(--vscode-input-background);
        --input-fg: var(--vscode-input-foreground);
        --input-border: var(--vscode-input-border, transparent);
        --placeholder: var(--vscode-input-placeholderForeground, var(--muted));
        --button-border: color-mix(in srgb, var(--border) 72%, transparent);
        --primary-button-bg: var(--vscode-button-background);
        --primary-button-fg: var(--vscode-button-foreground);
        --primary-button-hover: var(
          --vscode-button-hoverBackground,
          color-mix(in srgb, var(--vscode-focusBorder) 18%, var(--vscode-button-background) 82%)
        );
        --danger-button-bg: color-mix(in srgb, var(--vscode-errorForeground) 10%, transparent);
        --danger-button-fg: var(--vscode-errorForeground, var(--fg));
        --danger-button-hover: color-mix(in srgb, var(--vscode-errorForeground) 16%, transparent);
        --danger-border: color-mix(in srgb, var(--vscode-errorForeground) 34%, var(--button-border) 66%);
        --focus: var(--vscode-focusBorder);
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        padding: 8px 0 10px;
        background: var(--bg);
        color: var(--fg);
        font-family: var(--vscode-font-family);
        font-size: 12px;
      }

      button,
      input {
        font: inherit;
      }

      .shell {
        display: grid;
        gap: 8px;
      }

      .actions {
        display: grid;
        gap: 4px;
        padding: 0 12px 8px;
        border-bottom: 1px solid color-mix(in srgb, var(--border) 78%, transparent);
      }

      .action-button {
        appearance: none;
        width: 100%;
        min-height: 24px;
        padding: 0 8px;
        border: 1px solid var(--button-border);
        border-radius: 2px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--vscode-button-secondaryBackground, var(--vscode-button-background));
        color: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground));
        text-align: center;
        font-size: 11px;
        font-weight: 500;
        line-height: 1.2;
        cursor: pointer;
      }

      .action-button:hover {
        background: var(
          --vscode-button-secondaryHoverBackground,
          var(--vscode-button-hoverBackground)
        );
      }

      .action-button.is-primary {
        border-color: transparent;
        background: var(--primary-button-bg);
        color: var(--primary-button-fg);
      }

      .action-button.is-primary:hover {
        background: var(--primary-button-hover);
      }

      .action-button.is-danger {
        border-color: var(--danger-border);
        background: var(--danger-button-bg);
        color: var(--danger-button-fg);
      }

      .action-button.is-danger:hover {
        background: var(--danger-button-hover);
      }

      .fields {
        display: grid;
        gap: 8px;
        padding: 0 12px;
      }

      .field-group {
        display: grid;
        gap: 3px;
      }

      .field-label {
        color: var(--muted);
        font-size: 11px;
        font-weight: 500;
        line-height: 16px;
      }

      .input-wrap {
        position: relative;
      }

      .field-input {
        width: 100%;
        min-height: 28px;
        padding: 0 28px 0 8px;
        border: 1px solid var(--input-border);
        border-radius: 2px;
        background: var(--input-bg);
        color: var(--input-fg);
      }

      .field-input::placeholder {
        color: var(--placeholder);
      }

      .field-clear {
        position: absolute;
        top: 50%;
        right: 4px;
        transform: translateY(-50%);
        width: 20px;
        height: 20px;
        border: none;
        border-radius: 2px;
        background: transparent;
        color: var(--muted);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .field-clear:hover {
        background: color-mix(
          in srgb,
          var(--vscode-button-secondaryHoverBackground, var(--vscode-button-hoverBackground)) 50%,
          transparent
        );
        color: var(--fg);
      }

      .field-clear[hidden] {
        display: none;
      }

      .field-hint {
        color: var(--muted);
        font-size: 11px;
        line-height: 1.35;
      }

      .feature-disabled {
        color: var(--muted);
        font-size: 11px;
        line-height: 1.4;
        padding: 0 12px;
      }

      .action-button:focus-visible,
      .field-input:focus-visible,
      .field-clear:focus-visible {
        outline: 1px solid var(--focus);
        outline-offset: 0;
      }
    </style>
  </head>
  <body>
      <div class="shell">
      <div class="actions">
        <button class="action-button is-primary" type="button" data-action="openCanvas"></button>
        <button class="action-button is-primary" type="button" data-action="createNode">${copy.createNode}</button>
        <button class="action-button is-danger" type="button" data-action="resetToDefaultTemplate">${copy.resetToDefaultTemplate}</button>
        <button class="action-button is-danger" type="button" data-action="resetCanvas">${copy.resetCanvas}</button>
      </div>

    </div>

    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      const initialState = ${initialState};
      const copy = ${serializeForInlineScript(copy)};
      const openCanvasButton = document.querySelector('.action-button[data-action="openCanvas"]');

      function applyState(state) {
        openCanvasButton.textContent = state.canvasSurface === 'closed' ? copy.openCanvas : copy.revealCanvas;
      }

      function bindActionButtons(action, messageType) {
        document.querySelectorAll('[data-action="' + action + '"]').forEach((button) => {
          button.addEventListener('click', () => {
            vscode.postMessage({ type: messageType });
          });
        });
      }

      bindActionButtons('openCanvas', 'sidebarActions/openCanvas');
      bindActionButtons('createNode', 'sidebarActions/createNode');
      bindActionButtons('resetToDefaultTemplate', 'sidebarActions/resetToDefaultTemplate');
      bindActionButtons('resetCanvas', 'sidebarActions/resetCanvas');

      window.addEventListener('message', (event) => {
        const message = event.data;
        if (!message || message.type !== 'sidebarActions/state' || !message.payload || !message.payload.state) {
          return;
        }
        applyState(message.payload.state);
      });

      applyState(initialState);
      vscode.postMessage({ type: 'sidebarActions/ready' });
    </script>
  </body>
</html>`;
}

function buildSidebarActionsCopy(): SidebarActionsCopy {
  return {
    openCanvas: vscode.l10n.t('Open Canvas'),
    revealCanvas: vscode.l10n.t('Reveal Canvas'),
    createNode: vscode.l10n.t('Create Node'),
    resetToDefaultTemplate: vscode.l10n.t('Reset to Template'),
    resetCanvas: vscode.l10n.t('Clear Canvas')
  };
}

function parseSidebarActionsMessage(value: unknown): SidebarActionsInboundMessage | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const message = value as {
    type?: unknown;
    payload?: {
      kind?: unknown;
      value?: unknown;
    };
  };

  switch (message.type) {
    case 'sidebarActions/ready':
    case 'sidebarActions/openCanvas':
    case 'sidebarActions/createNode':
    case 'sidebarActions/resetToDefaultTemplate':
    case 'sidebarActions/resetCanvas':
      return {
        type: message.type
      };
    default:
      return undefined;
  }
}

function createNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let value = '';
  for (let index = 0; index < 32; index += 1) {
    value += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return value;
}

function serializeStateForInlineScript(state: CanvasSidebarState): string {
  return serializeForInlineScript(state);
}

function serializeForInlineScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
}

function resolveWebviewHtmlLang(): string {
  return (vscode.env?.language || 'en').replace(/"/g, '');
}
