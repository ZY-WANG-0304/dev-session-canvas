import * as vscode from 'vscode';

import {
  isCanvasTemplateAssociatedNoteSaveMode,
  type CanvasTemplateAgentProviderKind,
  type CanvasTemplateAssociatedNoteSaveMode,
  type CanvasTemplateSaveAgentProviderSelection
} from '../common/canvasTemplates';
import { EXTENSION_DISPLAY_NAME } from '../common/extensionIdentity';
import type { AgentProviderKind } from '../common/protocol';
import type { CanvasTemplateStorageLocation } from './CanvasTemplateStore';

const SAVE_TEMPLATE_FORM_VIEW_TYPE = 'devSessionCanvas.saveTemplateForm';

export interface CanvasTemplateSaveFormAgentItem {
  nodeId: string;
  title: string;
  currentProvider: AgentProviderKind;
}

export interface CanvasTemplateSaveFormAssociatedNoteItem {
  nodeId: string;
  title: string;
  displayPath: string;
  status: string;
  isWorkspaceRelative: boolean;
  defaultMode: CanvasTemplateAssociatedNoteSaveMode;
}

export interface CanvasTemplateSaveFormResult {
  name: string;
  targetStorageLocationId: string;
  agentProviderSelection: CanvasTemplateSaveAgentProviderSelection;
  associatedNoteSaveModes: Readonly<Record<string, CanvasTemplateAssociatedNoteSaveMode>>;
}

interface CanvasTemplateSaveFormOptions {
  mode: 'save' | 'import';
  title: string;
  submitLabel: string;
  initialName?: string;
  initialTargetStorageLocationId?: string;
  agentNodes: CanvasTemplateSaveFormAgentItem[];
  associatedNoteNodes?: CanvasTemplateSaveFormAssociatedNoteItem[];
  storageLocations: CanvasTemplateStorageLocation[];
}

interface CanvasTemplateSaveFormInlineState {
  mode: 'save' | 'import';
  title: string;
  submitLabel: string;
  initialName: string;
  initialTargetStorageLocationId: string;
  agentNodes: CanvasTemplateSaveFormAgentItem[];
  associatedNoteNodes: CanvasTemplateSaveFormAssociatedNoteItem[];
  storageLocations: CanvasTemplateStorageLocation[];
}

type SaveTemplateFormInboundMessage =
  | {
      type: 'saveTemplateForm/cancel';
    }
  | {
      type: 'saveTemplateForm/submit';
      payload: {
        name: string;
        targetStorageLocationId: string;
        agentProviders: Record<string, string>;
        associatedNoteModes: Record<string, string>;
      };
    };

type SaveTemplateFormOutboundMessage = {
  type: 'saveTemplateForm/error';
  payload: {
    message: string;
  };
};

export async function showCanvasTemplateSaveForm(
  options: CanvasTemplateSaveFormOptions
): Promise<CanvasTemplateSaveFormResult | undefined> {
  return CanvasTemplateSaveFormPanel.show(options);
}

class CanvasTemplateSaveFormPanel implements vscode.Disposable {
  private static currentPanel: CanvasTemplateSaveFormPanel | undefined;

  public static show(options: CanvasTemplateSaveFormOptions): Promise<CanvasTemplateSaveFormResult | undefined> {
    if (CanvasTemplateSaveFormPanel.currentPanel) {
      CanvasTemplateSaveFormPanel.currentPanel.reveal();
      return CanvasTemplateSaveFormPanel.currentPanel.result;
    }

    const panel = vscode.window.createWebviewPanel(
      SAVE_TEMPLATE_FORM_VIEW_TYPE,
      `${EXTENSION_DISPLAY_NAME}: ${options.title}`,
      {
        preserveFocus: false,
        viewColumn: vscode.ViewColumn.Active
      },
      {
        enableScripts: true,
        retainContextWhenHidden: false
      }
    );
    const instance = new CanvasTemplateSaveFormPanel(panel, options);
    CanvasTemplateSaveFormPanel.currentPanel = instance;
    return instance.result;
  }

  private readonly disposables: vscode.Disposable[] = [];
  private resultResolver!: (value: CanvasTemplateSaveFormResult | undefined) => void;
  private readonly resultPromise: Promise<CanvasTemplateSaveFormResult | undefined>;
  private readonly storageLocationsById: ReadonlyMap<string, CanvasTemplateStorageLocation>;
  private settled = false;

  private constructor(private readonly panel: vscode.WebviewPanel, options: CanvasTemplateSaveFormOptions) {
    this.resultPromise = new Promise<CanvasTemplateSaveFormResult | undefined>((resolve) => {
      this.resultResolver = resolve;
    });
    this.storageLocationsById = new Map(options.storageLocations.map((location) => [location.id, location] as const));

    panel.webview.html = buildCanvasTemplateSaveFormHtml(panel.webview, {
      mode: options.mode,
      title: options.title,
      submitLabel: options.submitLabel,
      initialName: options.initialName?.trim() ?? '',
      initialTargetStorageLocationId: options.initialTargetStorageLocationId?.trim() ?? '',
      agentNodes: options.agentNodes,
      associatedNoteNodes: options.associatedNoteNodes ?? [],
      storageLocations: options.storageLocations
    });

    this.disposables.push(
      panel.onDidDispose(() => {
        this.finish(undefined);
      }),
      panel.webview.onDidReceiveMessage((message) => {
        void this.handleMessage(message);
      })
    );
  }

  public get result(): Promise<CanvasTemplateSaveFormResult | undefined> {
    return this.resultPromise;
  }

  public dispose(): void {
    while (this.disposables.length > 0) {
      this.disposables.pop()?.dispose();
    }
  }

  private reveal(): void {
    this.panel.reveal(this.panel.viewColumn, false);
  }

  private async handleMessage(message: unknown): Promise<void> {
    const parsed = parseSaveTemplateFormMessage(message);
    if (!parsed) {
      return;
    }

    if (parsed.type === 'saveTemplateForm/cancel') {
      this.finish(undefined);
      this.panel.dispose();
      return;
    }

    const name = parsed.payload.name.trim();
    if (name.length === 0) {
      await this.postError('模板名称不能为空。');
      return;
    }

    if (!this.storageLocationsById.has(parsed.payload.targetStorageLocationId)) {
      await this.postError('请选择有效的模板保存位置。');
      return;
    }

    const agentProviderSelection = buildAgentProviderSelection(parsed.payload.agentProviders);
    if (!agentProviderSelection) {
      await this.postError('存在无效的 Agent Provider 选择。');
      return;
    }

    const associatedNoteSaveModes = buildAssociatedNoteModeSelection(parsed.payload.associatedNoteModes);
    if (!associatedNoteSaveModes) {
      await this.postError('存在无效的关联 Markdown Note 处理方式。');
      return;
    }

    this.finish({
      name,
      targetStorageLocationId: parsed.payload.targetStorageLocationId,
      agentProviderSelection,
      associatedNoteSaveModes
    });
    this.panel.dispose();
  }

  private finish(value: CanvasTemplateSaveFormResult | undefined): void {
    if (this.settled) {
      return;
    }

    this.settled = true;
    if (CanvasTemplateSaveFormPanel.currentPanel === this) {
      CanvasTemplateSaveFormPanel.currentPanel = undefined;
    }
    this.dispose();
    this.resultResolver(value);
  }

  private async postError(message: string): Promise<void> {
    await this.panel.webview.postMessage({
      type: 'saveTemplateForm/error',
      payload: {
        message
      }
    } satisfies SaveTemplateFormOutboundMessage);
  }
}

function buildAgentProviderSelection(
  value: Record<string, string>
): Readonly<Record<string, CanvasTemplateAgentProviderKind>> | null {
  const selection: Record<string, CanvasTemplateAgentProviderKind> = {};
  for (const [nodeId, provider] of Object.entries(value)) {
    const normalizedNodeId = nodeId.trim();
    if (normalizedNodeId.length === 0) {
      return null;
    }

    if (!isCanvasTemplateAgentProviderKind(provider)) {
      return null;
    }

    selection[normalizedNodeId] = provider;
  }

  return selection;
}

function buildAssociatedNoteModeSelection(
  value: Record<string, string>
): Readonly<Record<string, CanvasTemplateAssociatedNoteSaveMode>> | null {
  const selection: Record<string, CanvasTemplateAssociatedNoteSaveMode> = {};
  for (const [nodeId, mode] of Object.entries(value)) {
    const normalizedNodeId = nodeId.trim();
    if (normalizedNodeId.length === 0 || !isCanvasTemplateAssociatedNoteSaveMode(mode)) {
      return null;
    }
    selection[normalizedNodeId] = mode;
  }

  return selection;
}

function parseSaveTemplateFormMessage(message: unknown): SaveTemplateFormInboundMessage | null {
  if (!isRecord(message) || typeof message.type !== 'string') {
    return null;
  }

  if (message.type === 'saveTemplateForm/cancel') {
    return {
      type: 'saveTemplateForm/cancel'
    };
  }

  if (message.type !== 'saveTemplateForm/submit') {
    return null;
  }

  const payload = isRecord(message.payload) ? message.payload : null;
  if (
    !payload ||
    typeof payload.name !== 'string' ||
    typeof payload.targetStorageLocationId !== 'string' ||
    !isRecord(payload.agentProviders)
  ) {
    return null;
  }

  const agentProviders: Record<string, string> = {};
  for (const [nodeId, provider] of Object.entries(payload.agentProviders)) {
    if (typeof provider !== 'string') {
      return null;
    }
    agentProviders[nodeId] = provider;
  }

  const associatedNoteModesValue = isRecord(payload.associatedNoteModes) ? payload.associatedNoteModes : {};
  const associatedNoteModes: Record<string, string> = {};
  for (const [nodeId, mode] of Object.entries(associatedNoteModesValue)) {
    if (typeof mode !== 'string') {
      return null;
    }
    associatedNoteModes[nodeId] = mode;
  }

  return {
    type: 'saveTemplateForm/submit',
    payload: {
      name: payload.name,
      targetStorageLocationId: payload.targetStorageLocationId,
      agentProviders,
      associatedNoteModes
    }
  };
}

function buildCanvasTemplateSaveFormHtml(webview: vscode.Webview, state: CanvasTemplateSaveFormInlineState): string {
  const nonce = createNonce();
  const initialStateJson = serializeStateForInlineScript(state);

  return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(`${EXTENSION_DISPLAY_NAME}: ${state.title}`)}</title>
    <style>
      :root {
        color-scheme: light dark;
        --bg: var(--vscode-editor-background);
        --fg: var(--vscode-editor-foreground);
        --muted: var(--vscode-descriptionForeground);
        --border: color-mix(in srgb, var(--vscode-panel-border, var(--vscode-focusBorder)) 72%, transparent);
        --input-bg: var(--vscode-input-background);
        --input-fg: var(--vscode-input-foreground);
        --input-border: var(--vscode-input-border, transparent);
        --input-placeholder: var(--vscode-input-placeholderForeground, var(--muted));
        --focus: var(--vscode-focusBorder);
        --primary-bg: var(--vscode-button-background);
        --primary-fg: var(--vscode-button-foreground);
        --primary-hover: var(--vscode-button-hoverBackground);
        --secondary-bg: var(--vscode-button-secondaryBackground, transparent);
        --secondary-fg: var(--vscode-button-secondaryForeground, var(--fg));
        --secondary-hover: var(
          --vscode-button-secondaryHoverBackground,
          color-mix(in srgb, var(--fg) 8%, transparent)
        );
        --error-bg: color-mix(in srgb, var(--vscode-errorForeground, #c74e39) 12%, transparent);
        --error-fg: var(--vscode-errorForeground, #c74e39);
        --row-hover: color-mix(in srgb, var(--focus) 8%, transparent);
      }

      * {
        box-sizing: border-box;
      }

      html,
      body {
        height: 100%;
      }

      body {
        margin: 0;
        padding: 12px;
        background: var(--bg);
        color: var(--fg);
        font-family: var(--vscode-font-family);
        font-size: 12px;
      }

      button,
      input,
      select {
        font: inherit;
      }

      .shell {
        min-height: 100%;
        display: grid;
        place-items: center;
      }

      .dialog {
        width: min(720px, 100%);
        padding: 12px 14px;
        border: 1px solid var(--border);
        border-radius: 6px;
        background: var(--vscode-editorWidget-background, var(--bg));
        box-shadow: 0 12px 28px rgba(0, 0, 0, 0.18);
      }

      .title {
        margin: 0;
        text-align: left;
        font-size: 13px;
        font-weight: 600;
        line-height: 1.4;
      }

      .form {
        display: grid;
        gap: 8px;
        margin-top: 6px;
      }

      .field {
        display: grid;
        grid-template-columns: 86px minmax(0, 1fr);
        gap: 4px;
        align-items: start;
      }

      .field-label {
        padding-top: 5px;
        font-size: 11px;
        font-weight: 600;
        line-height: 1.3;
        color: var(--muted);
      }

      .field-control {
        display: grid;
        gap: 4px;
      }

      .text-input,
      .select-input {
        width: 100%;
        min-height: 28px;
        padding: 0 8px;
        border: 1px solid var(--input-border);
        border-radius: 2px;
        background: var(--input-bg);
        color: var(--input-fg);
      }

      .text-input::placeholder {
        color: var(--input-placeholder);
      }

      .text-input:focus,
      .select-input:focus,
      .action-button:focus-visible,
      .mini-button:focus-visible {
        outline: 1px solid var(--focus);
        outline-offset: 0;
      }

      .field-help {
        color: var(--muted);
        font-size: 11px;
        line-height: 1.4;
      }

      .error-message {
        min-height: 18px;
        padding: 7px 8px;
        border-radius: 2px;
        display: none;
        background: var(--error-bg);
        color: var(--error-fg);
        font-size: 11px;
        line-height: 1.4;
      }

      .error-message.is-visible {
        display: block;
      }

      .agent-toolbar {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
      }

      .mini-button {
        min-height: 24px;
        padding: 0 8px;
        border: 1px solid var(--border);
        border-radius: 2px;
        background: var(--secondary-bg);
        color: var(--secondary-fg);
        cursor: pointer;
        font-size: 11px;
      }

      .mini-button:hover {
        background: var(--secondary-hover);
      }

      .agent-list,
      .associated-note-list {
        display: grid;
        border: 1px solid var(--border);
        border-radius: 4px;
        overflow: hidden;
      }

      .agent-row,
      .associated-note-row {
        display: grid;
        grid-template-columns: 132px minmax(0, 1fr);
        justify-content: start;
        gap: 8px;
        padding: 5px 8px;
        align-items: center;
        background: transparent;
      }

      .agent-row + .agent-row,
      .associated-note-row + .associated-note-row {
        border-top: 1px solid color-mix(in srgb, var(--border) 72%, transparent);
      }

      .agent-row:hover,
      .associated-note-row:hover {
        background: var(--row-hover);
      }

      .agent-title,
      .associated-note-title {
        min-width: 0;
        font-weight: 600;
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
      }

      .associated-note-path {
        min-width: 0;
        margin-top: 2px;
        color: var(--muted);
        font-size: 11px;
        line-height: 1.3;
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
      }

      .agent-provider-select,
      .associated-note-mode-select {
        width: 100%;
      }

      .empty-note {
        padding: 8px 10px;
        border: 1px solid var(--border);
        border-radius: 4px;
        color: var(--muted);
        font-size: 11px;
        line-height: 1.45;
      }

      .actions {
        display: flex;
        justify-content: flex-end;
        gap: 12px;
        margin-top: 10px;
      }

      .action-button {
        min-width: 96px;
        min-height: 28px;
        padding: 0 14px;
        border: 1px solid var(--border);
        border-radius: 2px;
        cursor: pointer;
        font-size: 12px;
      }

      .action-button.primary {
        background: var(--primary-bg);
        color: var(--primary-fg);
        border-color: transparent;
      }

      .action-button.primary:hover {
        background: var(--primary-hover);
      }

      .action-button.secondary {
        background: var(--secondary-bg);
        color: var(--secondary-fg);
      }

      .action-button.secondary:hover {
        background: var(--secondary-hover);
      }

      .action-button[disabled] {
        opacity: 0.5;
        cursor: default;
      }

      @media (max-width: 560px) {
        body {
          padding: 10px;
        }

        .dialog {
          padding: 10px 12px;
        }

        .field,
        .agent-row,
        .associated-note-row {
          grid-template-columns: 1fr;
        }

        .field-label {
          padding-top: 0;
        }

        .agent-row,
        .associated-note-row {
          gap: 6px;
        }

        .agent-provider-select,
        .associated-note-mode-select {
          width: 100%;
        }

        .actions {
          flex-direction: column-reverse;
          justify-content: stretch;
        }

        .action-button {
          width: 100%;
        }
      }
    </style>
  </head>
  <body>
    <div class="shell">
      <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dialogTitle">
        <h1 id="dialogTitle" class="title">${escapeHtml(state.title)}</h1>
        <form id="templateForm" class="form">
          <div id="errorMessage" class="error-message" role="alert"></div>

          <div class="field">
            <label for="nameInput" class="field-label">名称:</label>
            <div class="field-control">
              <input
                id="nameInput"
                class="text-input"
                type="text"
                placeholder="例如：我的日常开发工作流"
                autocomplete="off"
                spellcheck="false"
              />
            </div>
          </div>

          <div class="field">
            <label for="storageLocationSelect" class="field-label">保存位置:</label>
            <div class="field-control">
              <select id="storageLocationSelect" class="select-input"></select>
              <div class="field-help">先选择模板库根位置；可在当前 workspace 和当前设备之间切换。</div>
            </div>
          </div>

          <div id="agentField" class="field">
            <div class="field-label">Agents:</div>
            <div class="field-control">
              <div id="agentToolbar" class="agent-toolbar" hidden>
                <button id="setAllDefaultButton" type="button" class="mini-button">全部设为 default</button>
                <button id="restoreCurrentProvidersButton" type="button" class="mini-button">按当前 Provider 填充</button>
              </div>
              <div id="agentList" class="agent-list" hidden></div>
              <div id="agentEmptyNote" class="empty-note" hidden>当前画布没有 Agent 节点，本次只会保存 Terminal / Note 节点。</div>
            </div>
          </div>

          <div id="associatedNoteField" class="field">
            <div class="field-label">关联 Note:</div>
            <div class="field-control">
              <div class="field-help">为关联 Markdown 文件的 Note 选择模板保存方式；workspace 外文件不能保留相对路径关联。</div>
              <div id="associatedNoteList" class="associated-note-list" hidden></div>
            </div>
          </div>
        </form>

        <div class="actions">
          <button id="submitButton" type="submit" form="templateForm" class="action-button primary">${escapeHtml(state.submitLabel)}</button>
          <button id="cancelButton" type="button" class="action-button secondary">取消</button>
        </div>
      </div>
    </div>

    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      const state = ${initialStateJson};
      const nameInput = document.getElementById('nameInput');
      const storageLocationSelect = document.getElementById('storageLocationSelect');
      const agentField = document.getElementById('agentField');
      const agentToolbar = document.getElementById('agentToolbar');
      const agentList = document.getElementById('agentList');
      const agentEmptyNote = document.getElementById('agentEmptyNote');
      const associatedNoteField = document.getElementById('associatedNoteField');
      const associatedNoteList = document.getElementById('associatedNoteList');
      const errorMessage = document.getElementById('errorMessage');
      const submitButton = document.getElementById('submitButton');
      const cancelButton = document.getElementById('cancelButton');
      const setAllDefaultButton = document.getElementById('setAllDefaultButton');
      const restoreCurrentProvidersButton = document.getElementById('restoreCurrentProvidersButton');
      const form = document.getElementById('templateForm');

      const storageLocations = Array.isArray(state.storageLocations) ? state.storageLocations : [];
      const agentNodes = Array.isArray(state.agentNodes) ? state.agentNodes : [];
      const associatedNoteNodes = Array.isArray(state.associatedNoteNodes) ? state.associatedNoteNodes : [];
      const showAgentSection = state.mode === 'save';
      const agentSelectsByNodeId = new Map();
      const associatedNoteSelectsByNodeId = new Map();

      function renderError(message) {
        const nextMessage = typeof message === 'string' ? message.trim() : '';
        errorMessage.textContent = nextMessage;
        errorMessage.classList.toggle('is-visible', nextMessage.length > 0);
      }

      function syncSubmitState() {
        submitButton.disabled = nameInput.value.trim().length === 0 || storageLocationSelect.value.trim().length === 0;
      }

      function setAllAgentProviders(provider) {
        for (const select of agentSelectsByNodeId.values()) {
          select.value = provider;
        }
      }

      function restoreCurrentProviders() {
        for (const agent of agentNodes) {
          const select = agentSelectsByNodeId.get(agent.nodeId);
          if (select) {
            select.value = agent.currentProvider;
          }
        }
      }

      function buildStorageLocationOption(location) {
        const option = document.createElement('option');
        option.value = location.id;
        option.textContent = location.label;
        return option;
      }

      function buildAgentRow(agent) {
        const row = document.createElement('div');
        row.className = 'agent-row';

        const meta = document.createElement('div');

        const title = document.createElement('div');
        title.className = 'agent-title';
        title.textContent = agent.title;
        meta.append(title);

        const select = document.createElement('select');
        select.className = 'select-input agent-provider-select';
        select.innerHTML = [
          '<option value="default">default（跟随当前默认 Provider）</option>',
          '<option value="codex">codex</option>',
          '<option value="claude">claude</option>'
        ].join('');
        select.value = agent.currentProvider;
        select.addEventListener('change', () => {
          renderError('');
        });
        agentSelectsByNodeId.set(agent.nodeId, select);

        row.append(meta, select);
        return row;
      }

      function buildAssociatedNoteRow(note) {
        const row = document.createElement('div');
        row.className = 'associated-note-row';

        const meta = document.createElement('div');

        const title = document.createElement('div');
        title.className = 'associated-note-title';
        title.textContent = note.title;
        meta.append(title);

        const path = document.createElement('div');
        path.className = 'associated-note-path';
        path.textContent = String(note.displayPath || '') + (note.status && note.status !== 'ok' ? ' · ' + note.status : '');
        path.title = path.textContent;
        meta.append(path);

        const select = document.createElement('select');
        select.className = 'select-input associated-note-mode-select';
        const options = [
          ['embedded-snapshot', '保存为普通 Note 内容快照']
        ];
        if (note.isWorkspaceRelative) {
          options.push(
            ['workspace-file-path-only', '仅保留 workspace 相对路径'],
            ['workspace-file-with-content', '保留相对路径和文件内容']
          );
        }
        options.push(['skip', '不保存此 Note']);
        select.replaceChildren(...options.map(([value, label]) => {
          const option = document.createElement('option');
          option.value = value;
          option.textContent = label;
          return option;
        }));
        select.value = options.some(([value]) => value === note.defaultMode)
          ? note.defaultMode
          : 'embedded-snapshot';
        select.addEventListener('change', () => {
          renderError('');
        });
        associatedNoteSelectsByNodeId.set(note.nodeId, select);

        row.append(meta, select);
        return row;
      }

      function renderAgentSection() {
        if (!showAgentSection) {
          agentField.hidden = true;
          agentToolbar.hidden = true;
          agentList.hidden = true;
          agentEmptyNote.hidden = true;
          return;
        }

        agentField.hidden = false;
        agentList.replaceChildren();
        if (agentNodes.length === 0) {
          agentToolbar.hidden = true;
          agentList.hidden = true;
          agentEmptyNote.hidden = false;
          return;
        }

        agentToolbar.hidden = false;
        agentList.hidden = false;
        agentEmptyNote.hidden = true;

        for (const agent of agentNodes) {
          agentList.append(buildAgentRow(agent));
        }
      }

      function renderAssociatedNoteSection() {
        if (state.mode !== 'save' || associatedNoteNodes.length === 0) {
          associatedNoteField.hidden = true;
          associatedNoteList.hidden = true;
          return;
        }

        associatedNoteField.hidden = false;
        associatedNoteList.hidden = false;
        associatedNoteList.replaceChildren();
        for (const note of associatedNoteNodes) {
          associatedNoteList.append(buildAssociatedNoteRow(note));
        }
      }

      nameInput.value = typeof state.initialName === 'string' ? state.initialName : '';
      storageLocationSelect.replaceChildren(...storageLocations.map(buildStorageLocationOption));
      const initialStorageLocationId =
        typeof state.initialTargetStorageLocationId === 'string' ? state.initialTargetStorageLocationId : '';
      if (initialStorageLocationId && storageLocations.some((location) => location.id === initialStorageLocationId)) {
        storageLocationSelect.value = initialStorageLocationId;
      } else if (storageLocations[0]) {
        storageLocationSelect.value = storageLocations[0].id;
      }
      renderAgentSection();
      renderAssociatedNoteSection();
      syncSubmitState();

      form.addEventListener('submit', (event) => {
        event.preventDefault();
        renderError('');
        const agentProviders = {};
        for (const [nodeId, select] of agentSelectsByNodeId.entries()) {
          agentProviders[nodeId] = select.value;
        }
        const associatedNoteModes = {};
        for (const [nodeId, select] of associatedNoteSelectsByNodeId.entries()) {
          associatedNoteModes[nodeId] = select.value;
        }
        vscode.postMessage({
          type: 'saveTemplateForm/submit',
          payload: {
            name: nameInput.value,
            targetStorageLocationId: storageLocationSelect.value,
            agentProviders,
            associatedNoteModes
          }
        });
      });

      nameInput.addEventListener('input', () => {
        renderError('');
        syncSubmitState();
      });
      storageLocationSelect.addEventListener('change', () => {
        renderError('');
        syncSubmitState();
      });

      setAllDefaultButton.addEventListener('click', () => {
        setAllAgentProviders('default');
        renderError('');
      });
      restoreCurrentProvidersButton.addEventListener('click', () => {
        restoreCurrentProviders();
        renderError('');
      });
      cancelButton.addEventListener('click', () => {
        vscode.postMessage({ type: 'saveTemplateForm/cancel' });
      });

      window.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          vscode.postMessage({ type: 'saveTemplateForm/cancel' });
        }
      });

      window.addEventListener('message', (event) => {
        const message = event.data;
        if (!message || message.type !== 'saveTemplateForm/error' || !message.payload) {
          return;
        }

        renderError(message.payload.message);
      });

      nameInput.focus();
      nameInput.select();
    </script>
  </body>
</html>`;
}

function isCanvasTemplateAgentProviderKind(value: unknown): value is CanvasTemplateAgentProviderKind {
  return value === 'default' || value === 'codex' || value === 'claude';
}

function serializeStateForInlineScript(state: CanvasTemplateSaveFormInlineState): string {
  return JSON.stringify(state)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\\u2028/g, '\\u2028')
    .replace(/\\u2029/g, '\\u2029');
}

function createNonce(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let value = '';
  for (let index = 0; index < 32; index += 1) {
    value += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
