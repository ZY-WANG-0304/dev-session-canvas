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
      type: 'sidebarActions/resetCanvas';
    }
  | {
      type: 'sidebarActions/updateFileFilter';
      payload: {
        kind: 'include' | 'exclude';
        value: string;
      };
    }
  | {
      type: 'sidebarActions/clearFileFilter';
      payload: {
        kind: 'include' | 'exclude';
      };
    };

type SidebarActionsOutboundMessage = {
  type: 'sidebarActions/state';
  payload: {
    state: CanvasSidebarState;
  };
};

export class CanvasSidebarActionsView implements vscode.WebviewViewProvider, vscode.Disposable {
  private readonly stateSubscription: vscode.Disposable;
  private view: vscode.WebviewView | undefined;

  public constructor(private readonly panelManager: CanvasPanelManager) {
    this.stateSubscription = this.panelManager.onDidChangeSidebarState(() => {
      void this.postState();
    });
  }

  public dispose(): void {
    this.view = undefined;
    this.stateSubscription.dispose();
  }

  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true
    };
    webviewView.webview.html = buildSidebarActionsHtml(webviewView.webview, this.panelManager.getSidebarState());

    webviewView.onDidDispose(() => {
      if (this.view === webviewView) {
        this.view = undefined;
      }
    });

    webviewView.webview.onDidReceiveMessage((message) => {
      void this.handleMessage(message);
    });
  }

  private async postState(): Promise<void> {
    if (!this.view) {
      return;
    }

    const message: SidebarActionsOutboundMessage = {
      type: 'sidebarActions/state',
      payload: {
        state: this.panelManager.getSidebarState()
      }
    };
    await this.view.webview.postMessage(message);
  }

  private async handleMessage(message: unknown): Promise<void> {
    const parsed = parseSidebarActionsMessage(message);
    if (!parsed) {
      return;
    }

    switch (parsed.type) {
      case 'sidebarActions/ready':
        await this.postState();
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
      case 'sidebarActions/resetCanvas':
        await vscode.commands.executeCommand(COMMAND_IDS.resetCanvasState);
        return;
      case 'sidebarActions/updateFileFilter':
        await vscode.commands.executeCommand(
          parsed.payload.kind === 'include' ? COMMAND_IDS.editFileIncludeFilter : COMMAND_IDS.editFileExcludeFilter,
          parsed.payload.value
        );
        return;
      case 'sidebarActions/clearFileFilter':
        await vscode.commands.executeCommand(
          parsed.payload.kind === 'include' ? COMMAND_IDS.clearFileIncludeFilter : COMMAND_IDS.clearFileExcludeFilter
        );
        return;
    }
  }
}

function buildSidebarActionsHtml(webview: vscode.Webview, state: CanvasSidebarState): string {
  const nonce = createNonce();
  const initialState = serializeStateForInlineScript(state);

  return `<!DOCTYPE html>
<html lang="zh-CN">
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
        --button-bg: var(--vscode-button-secondaryBackground, var(--vscode-button-background));
        --button-fg: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground));
        --button-hover: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-hoverBackground));
        --button-border: color-mix(in srgb, var(--border) 72%, transparent);
        --danger-border: color-mix(in srgb, var(--vscode-errorForeground) 34%, var(--button-border) 66%);
        --focus: var(--vscode-focusBorder);
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        padding: 10px 12px 12px;
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
        gap: 12px;
      }

      .actions {
        display: grid;
        gap: 6px;
        padding-bottom: 10px;
        border-bottom: 1px solid color-mix(in srgb, var(--border) 78%, transparent);
      }

      .action-button {
        width: 100%;
        min-height: 28px;
        padding: 0 10px;
        border: 1px solid var(--button-border);
        border-radius: 2px;
        background: var(--button-bg);
        color: var(--button-fg);
        text-align: left;
        cursor: pointer;
      }

      .action-button:hover {
        background: var(--button-hover);
      }

      .action-button.is-danger {
        border-color: var(--danger-border);
      }

      .fields {
        display: grid;
        gap: 10px;
      }

      .field-group {
        display: grid;
        gap: 4px;
      }

      .field-label {
        color: var(--muted);
        font-size: 12px;
        line-height: 18px;
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
        background: color-mix(in srgb, var(--button-hover) 50%, transparent);
        color: var(--fg);
      }

      .field-clear[hidden] {
        display: none;
      }

      .field-hint {
        color: var(--muted);
        line-height: 1.4;
      }

      .feature-disabled {
        color: var(--muted);
        line-height: 1.5;
        padding-top: 2px;
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
        <button class="action-button" type="button" data-action="openCanvas"></button>
        <button class="action-button" type="button" data-action="createNode">创建节点</button>
        <button class="action-button is-danger" type="button" data-action="resetCanvas">重置画布状态</button>
      </div>

      <div class="fields">
        <div class="field-group">
          <label class="field-label" for="include-input">包含文件</label>
          <div class="input-wrap">
            <input
              id="include-input"
              class="field-input"
              type="text"
              spellcheck="false"
              placeholder="例如 src/**/*.ts, docs/**/*.md"
            />
            <button class="field-clear" type="button" data-clear-kind="include" aria-label="清空包含文件">&times;</button>
          </div>
        </div>

        <div class="field-group">
          <label class="field-label" for="exclude-input">排除文件</label>
          <div class="input-wrap">
            <input
              id="exclude-input"
              class="field-input"
              type="text"
              spellcheck="false"
              placeholder="例如 **/dist/**, **/*.snap"
            />
            <button class="field-clear" type="button" data-clear-kind="exclude" aria-label="清空排除文件">&times;</button>
          </div>
        </div>

        <div class="field-hint">只影响文件对象与自动边的显示投影，不会修改文件引用。</div>
      </div>

      <div class="feature-disabled" hidden>文件功能当前已关闭。重新加载窗口并启用设置后，文件活动视图和文件过滤入口才会可用。</div>
    </div>

    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      const initialState = ${initialState};
      const includeInput = document.getElementById('include-input');
      const excludeInput = document.getElementById('exclude-input');
      const openCanvasButton = document.querySelector('.action-button[data-action="openCanvas"]');
      const fields = document.querySelector('.fields');
      const featureDisabledMessage = document.querySelector('.feature-disabled');
      const clearButtons = {
        include: document.querySelector('[data-clear-kind="include"]'),
        exclude: document.querySelector('[data-clear-kind="exclude"]')
      };

      const draft = {
        include: '',
        exclude: ''
      };
      const dirty = {
        include: false,
        exclude: false
      };

      function joinGlobs(globs) {
        return Array.isArray(globs) ? globs.join(', ') : '';
      }

      function currentOpenCanvasLabel(state) {
        return state.canvasSurface === 'closed' ? '打开画布' : '定位画布';
      }

      function setClearButtonVisibility(kind, value) {
        clearButtons[kind].hidden = value.trim().length === 0;
      }

      function applyState(state) {
        const openCanvasLabel = currentOpenCanvasLabel(state);
        openCanvasButton.textContent = openCanvasLabel;
        fields.hidden = !state.filesFeatureEnabled;
        featureDisabledMessage.hidden = state.filesFeatureEnabled;

        const includeValue = joinGlobs(state.fileFilters.includeGlobs);
        const excludeValue = joinGlobs(state.fileFilters.excludeGlobs);

        if (!dirty.include && document.activeElement !== includeInput) {
          draft.include = includeValue;
          includeInput.value = includeValue;
        }
        if (!dirty.exclude && document.activeElement !== excludeInput) {
          draft.exclude = excludeValue;
          excludeInput.value = excludeValue;
        }

        setClearButtonVisibility('include', includeInput.value);
        setClearButtonVisibility('exclude', excludeInput.value);
      }

      function submitFilter(kind) {
        const input = kind === 'include' ? includeInput : excludeInput;
        const nextValue = input.value;
        draft[kind] = nextValue;
        dirty[kind] = false;
        setClearButtonVisibility(kind, nextValue);
        vscode.postMessage({
          type: 'sidebarActions/updateFileFilter',
          payload: {
            kind,
            value: nextValue
          }
        });
      }

      function bindFilterInput(kind, input) {
        input.addEventListener('input', () => {
          draft[kind] = input.value;
          dirty[kind] = true;
          setClearButtonVisibility(kind, input.value);
        });

        input.addEventListener('blur', () => {
          submitFilter(kind);
        });

        input.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            input.blur();
          }
        });
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
      bindActionButtons('resetCanvas', 'sidebarActions/resetCanvas');

      clearButtons.include.addEventListener('click', () => {
        includeInput.value = '';
        draft.include = '';
        dirty.include = false;
        setClearButtonVisibility('include', '');
        vscode.postMessage({ type: 'sidebarActions/clearFileFilter', payload: { kind: 'include' } });
      });
      clearButtons.exclude.addEventListener('click', () => {
        excludeInput.value = '';
        draft.exclude = '';
        dirty.exclude = false;
        setClearButtonVisibility('exclude', '');
        vscode.postMessage({ type: 'sidebarActions/clearFileFilter', payload: { kind: 'exclude' } });
      });

      bindFilterInput('include', includeInput);
      bindFilterInput('exclude', excludeInput);

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
    case 'sidebarActions/resetCanvas':
      return {
        type: message.type
      };
    case 'sidebarActions/updateFileFilter':
      if (
        (message.payload?.kind === 'include' || message.payload?.kind === 'exclude') &&
        typeof message.payload.value === 'string'
      ) {
        return {
          type: 'sidebarActions/updateFileFilter',
          payload: {
            kind: message.payload.kind,
            value: message.payload.value
          }
        };
      }
      return undefined;
    case 'sidebarActions/clearFileFilter':
      if (message.payload?.kind === 'include' || message.payload?.kind === 'exclude') {
        return {
          type: 'sidebarActions/clearFileFilter',
          payload: {
            kind: message.payload.kind
          }
        };
      }
      return undefined;
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
  return JSON.stringify(state).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
}
