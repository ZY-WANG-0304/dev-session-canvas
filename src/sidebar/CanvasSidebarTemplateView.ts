import * as vscode from 'vscode';

import {
  buildCanvasTemplateNodeDetailLines,
  formatCanvasTemplateStats,
  type CanvasTemplate
} from '../common/canvasTemplates';
import { COMMAND_IDS } from '../common/extensionIdentity';
import { getVersionedWebviewResourceUri } from '../common/webviewResourceUri';
import { CanvasPanelManager } from '../panel/CanvasPanelManager';
import type { CanvasTemplateCatalog } from '../panel/CanvasTemplateStore';

const SIDEBAR_BUNDLED_CODICON_PATH_SEGMENTS = ['dist', 'sidebar-codicon.css'] as const;

export interface CanvasSidebarTemplateItemSnapshot {
  id: string;
  templateId: string;
  name: string;
  category: CanvasTemplate['category'];
  locationLabel: string;
  statsLabel: string;
  detailTooltip: string;
  isDefault: boolean;
  canDelete: boolean;
}

interface CanvasSidebarTemplateStateSnapshot {
  items: CanvasSidebarTemplateItemSnapshot[];
  issueMessages: string[];
  isLoading: boolean;
  loadErrorMessage?: string;
}

type SidebarTemplateInboundMessage =
  | {
      type: 'sidebarTemplates/ready';
    }
  | {
      type: 'sidebarTemplates/applyTemplate';
      payload: {
        templateId: string;
      };
    }
  | {
      type: 'sidebarTemplates/resetToTemplate';
      payload: {
        templateId: string;
      };
    }
  | {
      type: 'sidebarTemplates/setDefaultTemplate';
      payload: {
        templateId: string;
      };
    }
  | {
      type: 'sidebarTemplates/exportTemplate';
      payload: {
        templateId: string;
      };
    }
  | {
      type: 'sidebarTemplates/deleteTemplate';
      payload: {
        templateId: string;
      };
    };

type SidebarTemplateOutboundMessage = {
  type: 'sidebarTemplates/state';
  payload: CanvasSidebarTemplateStateSnapshot;
};

export class CanvasSidebarTemplateView implements vscode.WebviewViewProvider, vscode.Disposable {
  private readonly templateSubscription: vscode.Disposable;
  private view: vscode.WebviewView | undefined;
  private state: CanvasSidebarTemplateStateSnapshot = {
    items: [],
    issueMessages: [],
    isLoading: true
  };

  public constructor(
    private readonly panelManager: CanvasPanelManager,
    private readonly extensionUri: vscode.Uri
  ) {
    this.templateSubscription = this.panelManager.onDidChangeTemplateCatalog(() => {
      void this.refresh();
    });
  }

  public dispose(): void {
    this.view = undefined;
    this.templateSubscription.dispose();
  }

  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist')]
    };

    webviewView.webview.onDidReceiveMessage((message) => {
      void this.handleMessage(message);
    });
    webviewView.webview.html = buildSidebarTemplateHtml(webviewView.webview, this.extensionUri, this.state);

    webviewView.onDidDispose(() => {
      if (this.view === webviewView) {
        this.view = undefined;
      }
    });
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        void this.refresh();
      }
    });

    void this.refresh();
  }

  public async refresh(): Promise<CanvasSidebarTemplateStateSnapshot> {
    try {
      const catalog = await this.panelManager.getCanvasTemplateCatalog();
      const defaultTemplateId = this.panelManager.getDefaultCanvasTemplateId();
      this.state = {
        items: getCanvasSidebarTemplateItems(catalog, defaultTemplateId),
        issueMessages: catalog.issues.map((issue) => `${issue.fileName}：${issue.message}`),
        isLoading: false
      };
    } catch (error) {
      this.state = {
        items: [],
        issueMessages: [],
        isLoading: false,
        loadErrorMessage: error instanceof Error ? error.message : String(error)
      };
    }

    await this.postState();
    return this.state;
  }

  private async postState(): Promise<void> {
    if (!this.view) {
      return;
    }

    await this.view.webview.postMessage({
      type: 'sidebarTemplates/state',
      payload: this.state
    } satisfies SidebarTemplateOutboundMessage);
  }

  private async handleMessage(message: unknown): Promise<void> {
    const parsed = parseSidebarTemplateMessage(message);
    if (!parsed) {
      return;
    }

    switch (parsed.type) {
      case 'sidebarTemplates/ready':
        await this.refresh();
        return;
      case 'sidebarTemplates/applyTemplate':
        await vscode.commands.executeCommand(COMMAND_IDS.applyTemplate, parsed.payload.templateId);
        return;
      case 'sidebarTemplates/resetToTemplate':
        await vscode.commands.executeCommand(COMMAND_IDS.resetToTemplate, parsed.payload.templateId);
        return;
      case 'sidebarTemplates/setDefaultTemplate':
        await vscode.commands.executeCommand(COMMAND_IDS.setDefaultTemplate, parsed.payload.templateId);
        return;
      case 'sidebarTemplates/exportTemplate':
        await vscode.commands.executeCommand(COMMAND_IDS.exportTemplate, parsed.payload.templateId);
        return;
      case 'sidebarTemplates/deleteTemplate':
        await vscode.commands.executeCommand(COMMAND_IDS.deleteTemplate, parsed.payload.templateId);
        return;
    }
  }
}

export function getCanvasSidebarTemplateItems(
  catalog: CanvasTemplateCatalog,
  defaultTemplateId: string
): CanvasSidebarTemplateItemSnapshot[] {
  return catalog.templates.map((storedTemplate) => ({
    id: `template/${storedTemplate.template.id}`,
    templateId: storedTemplate.template.id,
    name: storedTemplate.template.name,
    category: storedTemplate.template.category,
    locationLabel: resolveCanvasSidebarTemplateLocationLabel(storedTemplate),
    statsLabel: formatCanvasTemplateStats(storedTemplate.template),
    detailTooltip: buildCanvasTemplateTooltip(storedTemplate),
    isDefault: storedTemplate.template.id === defaultTemplateId,
    canDelete: storedTemplate.template.category === 'user'
  }));
}

function resolveCanvasSidebarTemplateLocationLabel(storedTemplate: CanvasTemplateCatalog['templates'][number]): string {
  if (storedTemplate.template.category === 'builtin') {
    return '内置';
  }

  return storedTemplate.storageLocation?.scope === 'workspace' ? '工作区' : '用户';
}

function buildCanvasTemplateTooltip(storedTemplate: CanvasTemplateCatalog['templates'][number]): string {
  const detailLines = buildCanvasTemplateNodeDetailLines(storedTemplate.template);
  const locationLine = buildCanvasTemplateLocationTooltipLine(storedTemplate);
  return [...detailLines, '', locationLine].join('\n');
}

function buildCanvasTemplateLocationTooltipLine(storedTemplate: CanvasTemplateCatalog['templates'][number]): string {
  if (storedTemplate.template.category === 'builtin') {
    const builtinLayer = storedTemplate.relativeDirectory || '根目录';
    return `模板所在层级：内置模板 / ${builtinLayer}`;
  }

  const locationLabel = storedTemplate.storageLocation?.label ?? '用户模板';
  const relativeDirectory = storedTemplate.relativeDirectory || '根目录';
  return `模板所在层级：${locationLabel} / ${relativeDirectory}`;
}

function parseSidebarTemplateMessage(message: unknown): SidebarTemplateInboundMessage | null {
  if (!isRecord(message) || typeof message.type !== 'string') {
    return null;
  }

  if (message.type === 'sidebarTemplates/ready') {
    return {
      type: 'sidebarTemplates/ready'
    };
  }

  if (
    message.type === 'sidebarTemplates/applyTemplate' ||
    message.type === 'sidebarTemplates/resetToTemplate' ||
    message.type === 'sidebarTemplates/setDefaultTemplate' ||
    message.type === 'sidebarTemplates/exportTemplate' ||
    message.type === 'sidebarTemplates/deleteTemplate'
  ) {
    const payload = isRecord(message.payload) ? message.payload : null;
    if (!payload || typeof payload.templateId !== 'string' || payload.templateId.trim().length === 0) {
      return null;
    }

    return {
      type: message.type,
      payload: {
        templateId: payload.templateId
      }
    };
  }

  return null;
}

function buildSidebarTemplateHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  initialState: CanvasSidebarTemplateStateSnapshot
): string {
  const nonce = createNonce();
  const codiconCssUri = getVersionedWebviewResourceUri(
    webview,
    extensionUri,
    ...SIDEBAR_BUNDLED_CODICON_PATH_SEGMENTS
  );
  const initialStateJson = serializeSidebarTemplateStateForInlineScript(initialState);

  return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="stylesheet" href="${codiconCssUri}" />
    <style>
      :root {
        color-scheme: light dark;
        --bg: var(--vscode-sideBar-background);
        --fg: var(--vscode-sideBar-foreground);
        --muted: var(--vscode-descriptionForeground);
        --focus: var(--vscode-focusBorder);
        --list-hover: var(--vscode-list-hoverBackground, color-mix(in srgb, var(--fg) 6%, transparent));
        --list-active: var(--vscode-list-activeSelectionBackground, color-mix(in srgb, var(--focus) 18%, transparent));
        --list-active-fg: var(--vscode-list-activeSelectionForeground, var(--fg));
        --badge-bg: color-mix(in srgb, var(--focus) 18%, transparent);
        --badge-fg: var(--vscode-list-highlightForeground, var(--fg));
        --warning-bg: color-mix(in srgb, var(--vscode-errorForeground, #c74e39) 12%, transparent);
        --warning-fg: var(--vscode-errorForeground, #c74e39);
        --border: color-mix(in srgb, var(--vscode-panel-border, var(--focus)) 72%, transparent);
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        padding: 8px 0 0;
        background: var(--bg);
        color: var(--fg);
        font-family: var(--vscode-font-family);
        font-size: 12px;
      }

      button {
        font: inherit;
      }

      .shell {
        display: grid;
        gap: 8px;
      }

      .status-note,
      .empty-state {
        margin: 0 12px;
        padding: 8px 10px;
        line-height: 1.45;
        border: 1px solid var(--border);
        border-radius: 4px;
        display: none;
      }

      .status-note {
        color: var(--warning-fg);
        background: var(--warning-bg);
      }

      .empty-state {
        color: var(--muted);
        background: color-mix(in srgb, var(--focus) 10%, transparent);
      }

      .status-note.is-visible,
      .empty-state.is-visible {
        display: block;
      }

      .status-line + .status-line {
        margin-top: 4px;
      }

      .list {
        display: grid;
      }

      .template-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: 4px;
        padding: 9px 12px;
        border: 0;
        border-left: 2px solid transparent;
        background: transparent;
        color: var(--fg);
        text-align: left;
        cursor: default;
      }

      .template-row:hover {
        background: var(--list-hover);
      }

      .template-row.is-selected,
      .template-row:focus-visible {
        background: var(--list-active);
        color: var(--list-active-fg);
        border-left-color: var(--focus);
        outline: none;
      }

      .template-main {
        min-width: 0;
        display: grid;
        gap: 4px;
      }

      .template-title-line {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
      }

      .template-icon {
        flex: 0 0 auto;
        width: 14px;
        height: 14px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        color: var(--muted);
        font-size: 14px;
        line-height: 1;
      }

      .template-title {
        flex: 1 1 auto;
        min-width: 0;
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
      }

      .template-meta {
        display: flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
        padding-left: 22px;
        overflow: hidden;
        flex-wrap: nowrap;
      }

      .template-stats {
        min-width: 0;
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
        color: var(--muted);
        font-size: 11px;
      }

      .badge {
        display: inline-flex;
        align-items: center;
        min-height: 16px;
        padding: 0 6px;
        border-radius: 999px;
        font-size: 10px;
        line-height: 1;
        white-space: nowrap;
        background: var(--badge-bg);
        color: var(--badge-fg);
      }

      .badge.is-default {
        background: color-mix(in srgb, var(--focus) 22%, transparent);
      }

      .template-actions {
        display: flex;
        align-items: center;
        gap: 2px;
        flex: 0 0 auto;
        margin-left: auto;
        opacity: 0.56;
        transition: opacity 120ms ease;
      }

      .template-row:hover .template-actions,
      .template-row:focus-within .template-actions,
      .template-row.is-selected .template-actions {
        opacity: 1;
      }

      .row-action {
        width: 22px;
        height: 22px;
        border: 0;
        border-radius: 4px;
        background: transparent;
        color: var(--muted);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
      }

      .row-action:hover,
      .row-action:focus-visible {
        background: color-mix(
          in srgb,
          var(--vscode-button-secondaryHoverBackground, var(--vscode-button-hoverBackground)) 50%,
          transparent
        );
        color: var(--fg);
        outline: none;
      }

      .row-action.is-danger:hover,
      .row-action.is-danger:focus-visible {
        color: var(--warning-fg);
      }

      .row-action[hidden] {
        display: none;
      }

      .row-action .codicon {
        font-size: 14px;
      }

    </style>
  </head>
  <body>
      <div class="shell">
        <div id="statusNote" class="status-note" role="status" aria-live="polite"></div>
        <div id="list" class="list" role="listbox" aria-label="模板列表"></div>
        <div id="emptyState" class="empty-state" role="status" aria-live="polite"></div>
      </div>
    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      const state = {
        data: ${initialStateJson},
        selectedId: undefined
      };

      const statusNote = document.getElementById('statusNote');
      const list = document.getElementById('list');
      const emptyState = document.getElementById('emptyState');

      function syncRenderedSelection() {
        const rows = list.querySelectorAll('[data-sidebar-template-item-id]');
        for (const row of rows) {
          const isSelected = row.getAttribute('data-sidebar-template-item-id') === state.selectedId;
          row.setAttribute('aria-selected', isSelected ? 'true' : 'false');
          row.classList.toggle('is-selected', isSelected);
        }
      }

      function setSelectedId(nextId) {
        if (state.selectedId === nextId) {
          syncRenderedSelection();
          return;
        }
        state.selectedId = nextId;
        syncRenderedSelection();
      }

      function postTemplateMessage(type, templateId) {
        vscode.postMessage({
          type,
          payload: {
            templateId
          }
        });
      }

      function renderStatusNote(messages) {
        const lines = Array.isArray(messages) ? messages.filter((message) => typeof message === 'string' && message.trim().length > 0) : [];
        if (lines.length === 0) {
          statusNote.textContent = '';
          statusNote.classList.remove('is-visible');
          return;
        }

        statusNote.replaceChildren();
        for (const message of lines) {
          const line = document.createElement('div');
          line.className = 'status-line';
          line.textContent = message;
          statusNote.append(line);
        }
        statusNote.classList.add('is-visible');
      }

      function renderRow(item) {
        const row = document.createElement('div');
        row.className = 'template-row';
        row.tabIndex = 0;
        row.title = item.detailTooltip;
        row.setAttribute('data-sidebar-template-item-id', item.id);
        row.setAttribute('role', 'option');
        row.setAttribute('aria-selected', item.id === state.selectedId ? 'true' : 'false');
        row.setAttribute(
          'aria-label',
          item.name + '，' + item.locationLabel + '模板，' + (item.isDefault ? '默认模板，' : '') + item.statsLabel
        );
        if (item.id === state.selectedId) {
          row.classList.add('is-selected');
        }

        row.addEventListener('click', () => {
          setSelectedId(item.id);
        });
        row.addEventListener('focus', () => {
          setSelectedId(item.id);
        });
        row.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setSelectedId(item.id);
          }
        });

        const main = document.createElement('div');
        main.className = 'template-main';

        const titleLine = document.createElement('div');
        titleLine.className = 'template-title-line';

        const icon = document.createElement('span');
        icon.className = 'template-icon codicon ' + (item.category === 'builtin' ? 'codicon-library' : 'codicon-file-code');
        icon.setAttribute('aria-hidden', 'true');

        const title = document.createElement('div');
        title.className = 'template-title';
        title.textContent = item.name;

        titleLine.replaceChildren(icon, title);

        if (item.isDefault) {
          const defaultBadge = document.createElement('span');
          defaultBadge.className = 'badge is-default';
          defaultBadge.textContent = '默认';
          titleLine.append(defaultBadge);
        }

        main.append(titleLine);

        const meta = document.createElement('div');
        meta.className = 'template-meta';

        const stats = document.createElement('div');
        stats.className = 'template-stats';
        stats.textContent = item.statsLabel;

        const locationBadge = document.createElement('span');
        locationBadge.className = 'badge';
        locationBadge.textContent = item.locationLabel;

        meta.append(locationBadge, stats);
        main.append(meta);

        const actions = document.createElement('div');
        actions.className = 'template-actions';

        const applyAction = document.createElement('button');
        applyAction.className = 'row-action';
        applyAction.type = 'button';
        applyAction.title = '追加模板到当前画布';
        applyAction.setAttribute('aria-label', applyAction.title);
        applyAction.innerHTML = '<span class="codicon codicon-run" aria-hidden="true"></span>';
        applyAction.addEventListener('click', (event) => {
          event.stopPropagation();
          postTemplateMessage('sidebarTemplates/applyTemplate', item.templateId);
        });

        const resetAction = document.createElement('button');
        resetAction.className = 'row-action';
        resetAction.type = 'button';
        resetAction.title = '重置当前画布为此模板';
        resetAction.setAttribute('aria-label', resetAction.title);
        resetAction.innerHTML = '<span class="codicon codicon-discard" aria-hidden="true"></span>';
        resetAction.addEventListener('click', (event) => {
          event.stopPropagation();
          postTemplateMessage('sidebarTemplates/resetToTemplate', item.templateId);
        });

        const defaultAction = document.createElement('button');
        defaultAction.className = 'row-action';
        defaultAction.type = 'button';
        defaultAction.title = item.isDefault ? '当前已是默认模板' : '设为默认模板';
        defaultAction.setAttribute('aria-label', defaultAction.title);
        defaultAction.hidden = item.isDefault;
        defaultAction.innerHTML = '<span class="codicon codicon-star-empty" aria-hidden="true"></span>';
        defaultAction.addEventListener('click', (event) => {
          event.stopPropagation();
          postTemplateMessage('sidebarTemplates/setDefaultTemplate', item.templateId);
        });

        const exportAction = document.createElement('button');
        exportAction.className = 'row-action';
        exportAction.type = 'button';
        exportAction.title = '导出模板';
        exportAction.setAttribute('aria-label', exportAction.title);
        exportAction.innerHTML = '<span class="codicon codicon-export" aria-hidden="true"></span>';
        exportAction.addEventListener('click', (event) => {
          event.stopPropagation();
          postTemplateMessage('sidebarTemplates/exportTemplate', item.templateId);
        });

        const deleteAction = document.createElement('button');
        deleteAction.className = 'row-action is-danger';
        deleteAction.type = 'button';
        deleteAction.title = '删除模板';
        deleteAction.setAttribute('aria-label', deleteAction.title);
        deleteAction.hidden = !item.canDelete;
        deleteAction.innerHTML = '<span class="codicon codicon-trash" aria-hidden="true"></span>';
        deleteAction.addEventListener('click', (event) => {
          event.stopPropagation();
          postTemplateMessage('sidebarTemplates/deleteTemplate', item.templateId);
        });

        actions.append(defaultAction, applyAction, resetAction, exportAction, deleteAction);
        titleLine.append(actions);
        row.append(main);
        return row;
      }

      function render() {
        const currentState = state.data && typeof state.data === 'object' ? state.data : ${initialStateJson};
        const items = Array.isArray(currentState.items) ? currentState.items : [];
        if (!state.selectedId || !items.some((item) => item.id === state.selectedId)) {
          state.selectedId = items[0] ? items[0].id : undefined;
        }

        list.replaceChildren();
        for (const item of items) {
          list.append(renderRow(item));
        }

        renderStatusNote(currentState.issueMessages);

        if (currentState.isLoading) {
          emptyState.textContent = '正在加载模板列表...';
          emptyState.classList.add('is-visible');
          return;
        }

        if (typeof currentState.loadErrorMessage === 'string' && currentState.loadErrorMessage.length > 0) {
          emptyState.textContent = currentState.loadErrorMessage;
          emptyState.classList.add('is-visible');
          return;
        }

        if (items.length === 0) {
          emptyState.textContent = '当前还没有可显示的模板。';
          emptyState.classList.add('is-visible');
          return;
        }

        emptyState.textContent = '';
        emptyState.classList.remove('is-visible');
      }

      window.addEventListener('message', (event) => {
        const message = event.data;
        if (!message || typeof message.type !== 'string') {
          return;
        }

        if (message.type !== 'sidebarTemplates/state' || !message.payload) {
          return;
        }

        state.data = message.payload;
        render();
      });

      render();
      vscode.postMessage({ type: 'sidebarTemplates/ready' });
    </script>
  </body>
</html>`;
}

function serializeSidebarTemplateStateForInlineScript(state: CanvasSidebarTemplateStateSnapshot): string {
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
