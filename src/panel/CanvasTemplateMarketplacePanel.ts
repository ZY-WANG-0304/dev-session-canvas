import * as vscode from 'vscode';

import {
  TemplateMarketplaceClient,
  type TemplateMarketplaceInstallTargetSummary,
  type TemplateMarketplaceInstalledTemplateSummary,
  type TemplateMarketplaceInlineInstallParams
} from './TemplateMarketplaceClient';

const MARKETPLACE_PREVIEW_ORIGIN = 'https://dscanvas-template-marketplace.wzy0304.workers.dev';
const MARKETPLACE_PANEL_VIEW_TYPE = 'devSessionCanvas.templateMarketplace';

type MarketplacePanelInboundMessage =
  | {
      type: 'marketplace/installTemplate';
      payload: TemplateMarketplaceInlineInstallParams;
    }
  | {
      type: 'marketplace/openInBrowser';
    }
  | {
      type: 'marketplace/refreshInstalledTemplates';
    };

type MarketplacePanelOutboundMessage =
  | {
      type: 'marketplace/installResult';
      payload:
        | {
            ok: true;
            templateName: string;
            versionNumber: number;
            operation: 'installed' | 'updated' | 'reinstalled';
            installedTemplates: TemplateMarketplaceInstalledTemplateSummary[];
            installTargets: TemplateMarketplaceInstallTargetSummary[];
          }
        | {
            ok: false;
            message: string;
          };
    }
  | {
      type: 'marketplace/installedTemplates';
      payload: {
        installedTemplates: TemplateMarketplaceInstalledTemplateSummary[];
        installTargets: TemplateMarketplaceInstallTargetSummary[];
      };
    }
  | {
      type: 'marketplace/installedTemplatesError';
      payload: {
        message: string;
      };
    };

export class CanvasTemplateMarketplacePanelController implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  public constructor(private readonly marketplaceClient: TemplateMarketplaceClient) {}

  public reveal(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.One);
      void this.postInstalledTemplates();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      MARKETPLACE_PANEL_VIEW_TYPE,
      '模板市场',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true
      }
    );
    this.panel = panel;
    panel.webview.html = buildTemplateMarketplaceHtml(panel.webview);
    panel.webview.onDidReceiveMessage((message) => {
      void this.handleMessage(message);
    }, undefined, this.disposables);
    panel.onDidDispose(() => {
      this.panel = undefined;
    }, undefined, this.disposables);
    void this.postInstalledTemplates();
  }

  public dispose(): void {
    this.panel?.dispose();
    this.panel = undefined;
    while (this.disposables.length > 0) {
      this.disposables.pop()?.dispose();
    }
  }

  private async handleMessage(message: unknown): Promise<void> {
    const parsed = parseMarketplacePanelMessage(message);
    if (!parsed) {
      return;
    }

    switch (parsed.type) {
      case 'marketplace/openInBrowser':
        await vscode.env.openExternal(vscode.Uri.parse(`${MARKETPLACE_PREVIEW_ORIGIN}/templates`));
        return;
      case 'marketplace/installTemplate':
        await this.installTemplate(parsed.payload);
        return;
      case 'marketplace/refreshInstalledTemplates':
        await this.postInstalledTemplates();
        return;
    }
  }

  private async installTemplate(payload: TemplateMarketplaceInlineInstallParams): Promise<void> {
    try {
      const result = await this.marketplaceClient.installTemplateFromInlinePayload(payload);
      const installedTemplates = await this.marketplaceClient.listInstalledTemplates();
      const installTargets = this.marketplaceClient.listInstallTargets();
      await this.panel?.webview.postMessage({
        type: 'marketplace/installResult',
        payload: {
          ok: true,
          templateName: result.savedTemplate.template.name,
          versionNumber: result.version.versionNumber,
          operation: result.operation,
          installedTemplates,
          installTargets
        }
      } satisfies MarketplacePanelOutboundMessage);
      const actionLabel = formatMarketplaceInstallOperationLabel(result.operation);
      await vscode.window.showInformationMessage(
        `${actionLabel}市场模板「${result.savedTemplate.template.name}」v${result.version.versionNumber}，可在模板侧栏应用到 Canvas。`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.panel?.webview.postMessage({
        type: 'marketplace/installResult',
        payload: {
          ok: false,
          message
        }
      } satisfies MarketplacePanelOutboundMessage);
      await vscode.window.showErrorMessage(`安装市场模板失败：${message}`);
    }
  }

  private async postInstalledTemplates(): Promise<void> {
    if (!this.panel) {
      return;
    }

    try {
      const installedTemplates = await this.marketplaceClient.listInstalledTemplates();
      const installTargets = this.marketplaceClient.listInstallTargets();
      await this.panel.webview.postMessage({
        type: 'marketplace/installedTemplates',
        payload: {
          installedTemplates,
          installTargets
        }
      } satisfies MarketplacePanelOutboundMessage);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.panel.webview.postMessage({
        type: 'marketplace/installedTemplatesError',
        payload: {
          message
        }
      } satisfies MarketplacePanelOutboundMessage);
    }
  }
}

function formatMarketplaceInstallOperationLabel(operation: 'installed' | 'updated' | 'reinstalled'): string {
  if (operation === 'updated') {
    return '已更新';
  }
  if (operation === 'reinstalled') {
    return '已重新安装';
  }
  return '已安装';
}

function parseMarketplacePanelMessage(message: unknown): MarketplacePanelInboundMessage | null {
  if (!isRecord(message) || typeof message.type !== 'string') {
    return null;
  }

  if (message.type === 'marketplace/openInBrowser') {
    return {
      type: 'marketplace/openInBrowser'
    };
  }

  if (message.type === 'marketplace/refreshInstalledTemplates') {
    return {
      type: 'marketplace/refreshInstalledTemplates'
    };
  }

  if (message.type === 'marketplace/installTemplate') {
    const payload = isRecord(message.payload) ? message.payload : null;
    if (
      !payload ||
      typeof payload.templateIdOrSlug !== 'string' ||
      typeof payload.sourceUrl !== 'string' ||
      typeof payload.templateJson !== 'string'
    ) {
      return null;
    }

    return {
      type: 'marketplace/installTemplate',
      payload: {
        templateIdOrSlug: payload.templateIdOrSlug,
        versionId: readOptionalString(payload.versionId),
        targetStorageLocationId: readOptionalString(payload.targetStorageLocationId),
        sourceUrl: payload.sourceUrl,
        templateJson: payload.templateJson,
        payloadSha256: readOptionalString(payload.payloadSha256),
        marketTemplateId: readOptionalString(payload.marketTemplateId),
        installedVersionNumber: readOptionalNumber(payload.installedVersionNumber),
        sha256: readOptionalString(payload.sha256),
        sizeBytes: readOptionalNumber(payload.sizeBytes),
        publisher: isRecord(payload.publisher)
          ? {
              id: readOptionalString(payload.publisher.id),
              githubLogin: readOptionalString(payload.publisher.githubLogin),
              displayName: readOptionalString(payload.publisher.displayName),
              avatarUrl: readOptionalString(payload.publisher.avatarUrl)
            }
          : undefined
      }
    };
  }

  return null;
}

function buildTemplateMarketplaceHtml(webview: vscode.Webview): string {
  const nonce = createNonce();
  const stateJson = JSON.stringify({
    apiOrigin: MARKETPLACE_PREVIEW_ORIGIN
  });

  return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; connect-src ${MARKETPLACE_PREVIEW_ORIGIN}; img-src https: data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>
      :root {
        color-scheme: light dark;
        --bg: var(--vscode-editor-background);
        --fg: var(--vscode-editor-foreground);
        --muted: var(--vscode-descriptionForeground);
        --border: color-mix(in srgb, var(--vscode-widget-border, var(--vscode-panel-border, var(--vscode-focusBorder))) 70%, transparent);
        --row-hover: color-mix(in srgb, var(--vscode-list-hoverBackground, var(--vscode-editor-foreground)) 16%, transparent);
        --surface: var(--vscode-editorWidget-background, var(--vscode-editor-background));
        --input-bg: var(--vscode-input-background, var(--bg));
        --input-fg: var(--vscode-input-foreground, var(--fg));
        --input-border: var(--vscode-input-border, var(--border));
        --primary-bg: var(--vscode-button-background);
        --primary-fg: var(--vscode-button-foreground);
        --primary-hover: var(--vscode-button-hoverBackground, var(--primary-bg));
        --secondary-bg: var(--vscode-button-secondaryBackground, transparent);
        --secondary-fg: var(--vscode-button-secondaryForeground, var(--fg));
        --focus: var(--vscode-focusBorder);
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        background: var(--bg);
        color: var(--fg);
        font-family: var(--vscode-font-family);
      }

      body.vscode-high-contrast,
      body.vscode-high-contrast-light {
        --border: var(--vscode-contrastBorder, var(--focus));
        --row-hover: transparent;
        --surface: var(--bg);
      }

      button,
      input,
      select {
        font: inherit;
      }

      .shell {
        min-height: 100vh;
        padding: 12px 16px 20px;
      }

      .panel-header,
      .toolbar,
      .status,
      .grid {
        max-width: 1180px;
      }

      .panel-title-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }

      h1 {
        margin: 0;
        font-size: 18px;
        font-weight: 600;
        line-height: 1.3;
      }

      .panel-note {
        max-width: 720px;
        margin: 4px 0 0;
        color: var(--muted);
        font-size: 12px;
        line-height: 1.5;
      }

      .open-browser {
        border: 1px solid var(--border);
        background: var(--secondary-bg);
        color: var(--secondary-fg);
        min-height: 26px;
        padding: 3px 8px;
        border-radius: 2px;
        cursor: pointer;
        white-space: nowrap;
      }

      .toolbar {
        display: grid;
        gap: 8px;
        grid-template-columns: minmax(0, 1fr) 148px;
        margin-top: 12px;
      }

      input,
      select {
        width: 100%;
        min-height: 28px;
        border: 1px solid var(--input-border);
        border-radius: 2px;
        background: var(--input-bg);
        color: var(--input-fg);
        padding: 0 8px;
        outline: none;
      }

      input:focus,
      select:focus,
      button:focus-visible {
        outline: 1px solid var(--focus);
        outline-offset: 2px;
      }

      .status {
        min-height: 20px;
        margin: 10px 0 0;
        color: var(--muted);
        font-size: 12px;
      }

      .grid {
        display: grid;
        gap: 0;
        grid-template-columns: 1fr;
        margin-top: 6px;
        border-top: 1px solid var(--border);
      }

      .card {
        display: grid;
        grid-template-columns: 112px minmax(0, 1fr) minmax(224px, 284px);
        grid-template-areas:
          "thumb title target"
          "thumb description target"
          "thumb tags actions"
          "thumb meta actions"
          "thumb badge actions";
        align-items: start;
        gap: 5px 12px;
        border: 0;
        border-bottom: 1px solid var(--border);
        border-radius: 0;
        background: transparent;
        padding: 10px 0;
        box-shadow: none;
      }

      .card:hover {
        background: var(--row-hover);
      }

      .notice-card {
        grid-template-columns: 1fr;
        grid-template-areas: none;
        align-content: start;
        gap: 8px;
        border: 1px dashed var(--border);
        padding: 12px;
      }

      .notice-card h2 {
        margin: 0;
        font-size: 20px;
        letter-spacing: -0.02em;
      }

      .title-row {
        grid-area: title;
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: 4px 10px;
      }

      .card-title {
        margin: 0;
        color: var(--fg);
        font-size: 14px;
        font-weight: 600;
        line-height: 1.25;
      }

      .notice-card p {
        margin: 0;
        color: var(--muted);
        line-height: 1.6;
      }

      .offline-template-card .thumb {
        background: var(--surface);
        padding: 8px;
      }

      .thumb {
        grid-area: thumb;
        position: relative;
        overflow: hidden;
        height: 72px;
        min-height: 0;
        border: 1px solid var(--border);
        border-radius: 2px;
        padding: 0;
        background: var(--surface);
        color: var(--fg);
      }

      .thumb::after {
        content: "";
        position: absolute;
        inset: 0;
        z-index: 1;
        background: none;
      }

      .thumb img {
        position: absolute;
        inset: 0;
        z-index: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      .thumb p,
      .thumb h2 {
        position: relative;
        z-index: 2;
        margin: 0;
      }

      .thumb p {
        opacity: 0.75;
        font-size: 9px;
        font-weight: 700;
        letter-spacing: 0.24em;
        text-transform: uppercase;
      }

      .thumb h2 {
        margin-top: 8px;
        max-width: 96px;
        font-size: 12px;
        line-height: 1.2;
        letter-spacing: -0.01em;
      }

      .description {
        grid-area: description;
        margin: 0;
        color: var(--muted);
        font-size: 12px;
        line-height: 1.5;
        overflow: hidden;
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
      }

      .tags {
        grid-area: tags;
        display: flex;
        flex-wrap: wrap;
        gap: 5px 8px;
      }

      .tag {
        border-radius: 0;
        padding: 0;
        background: transparent;
        color: var(--muted);
        font-size: 11px;
        font-weight: 600;
      }

      .meta {
        grid-area: meta;
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        color: var(--muted);
        font-size: 12px;
      }

      .installed-badge {
        grid-area: badge;
        width: fit-content;
        border: 1px solid color-mix(in srgb, var(--focus) 42%, transparent);
        border-radius: 2px;
        padding: 2px 6px;
        background: color-mix(in srgb, var(--focus) 18%, transparent);
        color: var(--fg);
        font-size: 11px;
        font-weight: 700;
      }

      .install-target-row {
        grid-area: target;
        display: grid;
        gap: 4px;
      }

      .install-target-label {
        color: var(--muted);
        font-size: 11px;
        font-weight: 700;
      }

      .install-target {
        min-height: 28px;
      }

      .actions {
        grid-area: actions;
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 6px;
        align-items: start;
      }

      .split-install {
        position: relative;
        display: grid;
        grid-template-columns: minmax(0, 1fr) 26px;
        min-width: 0;
      }

      .primary,
      .secondary {
        min-height: 26px;
        border-radius: 2px;
        padding: 0 8px;
        cursor: pointer;
        white-space: nowrap;
      }

      .primary {
        border: 0;
        background: var(--primary-bg);
        color: var(--primary-fg);
        font-weight: 700;
      }

      .primary:hover {
        background: var(--primary-hover);
      }

      .split-primary {
        border-radius: 2px 0 0 2px;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .split-toggle {
        min-width: 26px;
        margin-left: 1px;
        border-radius: 0 2px 2px 0;
        padding: 0 7px;
      }

      .version-menu {
        position: absolute;
        z-index: 10;
        top: calc(100% + 6px);
        left: 0;
        display: grid;
        min-width: 184px;
        gap: 4px;
        border: 1px solid var(--border);
        border-radius: 4px;
        background: var(--surface);
        padding: 4px;
        box-shadow: 0 16px 38px color-mix(in srgb, var(--vscode-editor-foreground) 18%, transparent);
      }

      .version-menu-item,
      .version-menu-note {
        min-height: 30px;
        border: 0;
        border-radius: 2px;
        background: transparent;
        color: var(--fg);
        padding: 0 10px;
        text-align: left;
      }

      .version-menu-item {
        cursor: pointer;
      }

      .version-menu-item:hover {
        background: color-mix(in srgb, var(--focus) 16%, transparent);
      }

      .version-menu-item[disabled] {
        cursor: default;
        color: var(--muted);
      }

      .version-menu-note {
        display: flex;
        align-items: center;
        color: var(--muted);
        font-size: 12px;
        line-height: 1.45;
      }

      .secondary {
        border: 1px solid var(--border);
        background: var(--secondary-bg);
        color: var(--secondary-fg);
      }

      .detail-link {
        min-height: 22px;
        border: 0;
        background: transparent;
        color: var(--vscode-textLink-foreground, var(--secondary-fg));
        padding: 0;
        font-size: 12px;
      }

      .detail-link:hover {
        text-decoration: underline;
      }

      .primary[disabled],
      .secondary[disabled] {
        cursor: wait;
        opacity: 0.65;
      }

      .primary.is-installed[disabled] {
        cursor: default;
        opacity: 0.82;
      }

      @media (max-width: 720px) {
        .shell {
          padding: 12px;
        }

        .toolbar {
          grid-template-columns: 1fr;
        }

        .panel-title-row {
          align-items: flex-start;
          flex-direction: column;
        }

        .card {
          grid-template-columns: 96px minmax(0, 1fr);
          grid-template-areas:
            "thumb title"
            "thumb description"
            "thumb tags"
            "thumb meta"
            "thumb badge"
            "target target"
            "actions actions";
        }

        .actions {
          grid-template-columns: minmax(0, 1fr);
        }

        .thumb {
          height: 64px;
        }
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <section class="panel-header">
        <div class="panel-title-row">
          <h1>模板市场</h1>
          <button class="open-browser" id="openBrowserButton" type="button">在浏览器打开</button>
        </div>
        <p class="panel-note">读取公开模板，并通过 Webview payload 安装到本地模板库。</p>
      </section>

      <section class="toolbar" aria-label="模板市场筛选">
        <input id="searchInput" type="search" placeholder="搜索 review / release / starter..." />
        <select id="sortSelect" aria-label="排序">
          <option value="hot">Hot</option>
          <option value="downloads">Downloads</option>
          <option value="likes">Likes</option>
          <option value="newest">Newest</option>
          <option value="updated">Updated</option>
        </select>
      </section>

      <p class="status" id="status">正在加载模板市场...</p>
      <section class="grid" id="templateGrid" aria-label="模板列表"></section>
    </main>

    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      const initialState = ${stateJson};
      const apiOrigin = initialState.apiOrigin;
      const persistedState = normalizePersistedState(vscode.getState && vscode.getState());
      const initialInstallTargets = normalizeInstallTargets(initialState.installTargets);
      const state = {
        templates: [],
        installingSlug: undefined,
        loadError: undefined,
        installedTemplates: normalizeInstalledTemplates(initialState.installedTemplates),
        installTargets: initialInstallTargets,
        installTargetIdsByTemplateSlug: persistedState.installTargetIdsByTemplateSlug,
        openInstallVersionMenuSlug: undefined,
        openDownloadVersionMenuSlug: undefined,
        loadingVersionMenuSlug: undefined,
        templateDetailsBySlug: {},
        versionMenuErrorsBySlug: {}
      };

      const searchInput = document.getElementById('searchInput');
      const sortSelect = document.getElementById('sortSelect');
      const statusElement = document.getElementById('status');
      const templateGrid = document.getElementById('templateGrid');
      const openBrowserButton = document.getElementById('openBrowserButton');
      searchInput.value = persistedState.searchQuery;
      if ([...sortSelect.options].some((option) => option.value === persistedState.sort)) {
        sortSelect.value = persistedState.sort;
      }

      openBrowserButton.addEventListener('click', () => {
        vscode.postMessage({ type: 'marketplace/openInBrowser' });
      });
      searchInput.addEventListener('input', debounce(() => {
        closeVersionMenus();
        persistState();
        void loadTemplates();
      }, 180));
      sortSelect.addEventListener('change', () => {
        closeVersionMenus();
        persistState();
        void loadTemplates();
      });
      document.addEventListener('click', (event) => {
        const target = event.target;
        if (target instanceof Element && target.closest('.split-install')) {
          return;
        }
        closeVersionMenus(false);
      });
      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && closeVersionMenus(false)) {
          event.preventDefault();
        }
      });
      window.addEventListener('message', (event) => {
        const message = event.data;
        if (!message) {
          return;
        }

        if (message.type === 'marketplace/installedTemplates') {
          state.installedTemplates = normalizeInstalledTemplates(message.payload && message.payload.installedTemplates);
          syncInstallTargets(normalizeInstallTargets(message.payload && message.payload.installTargets));
          renderTemplates();
          return;
        }

        if (message.type === 'marketplace/installedTemplatesError') {
          statusElement.textContent = '读取已安装状态失败：' + (message.payload && message.payload.message ? message.payload.message : '未知错误') + '。市场浏览不受影响，已安装模板仍可从侧栏使用。';
          return;
        }

        if (message.type !== 'marketplace/installResult') {
          return;
        }
        state.installingSlug = undefined;
        if (message.payload && message.payload.ok) {
          state.installedTemplates = normalizeInstalledTemplates(message.payload.installedTemplates);
          syncInstallTargets(normalizeInstallTargets(message.payload.installTargets));
          statusElement.textContent = formatInstallResultStatus(message.payload);
        } else {
          statusElement.textContent = '安装失败：' + (message.payload && message.payload.message ? message.payload.message : '未知错误') + '。模板没有写入本地库，请检查安装位置后重试。';
        }
        renderTemplates();
      });

      async function loadTemplates() {
        const params = new URLSearchParams();
        const query = searchInput.value.trim();
        if (query) {
          params.set('q', query);
        }
        params.set('sort', sortSelect.value);
        statusElement.textContent = '正在加载模板市场...';
        try {
          const response = await fetch(apiOrigin + '/api/v1/templates?' + params.toString(), {
            headers: { accept: 'application/json' }
          });
          if (!response.ok) {
            throw new Error('HTTP ' + response.status);
          }
          const body = await response.json();
          state.templates = Array.isArray(body.items) ? body.items : [];
          state.loadError = undefined;
          statusElement.textContent = state.templates.length > 0
            ? '共 ' + state.templates.length + ' 个模板，数据来源：' + (body.storageMode || 'unknown')
            : '没有匹配的模板。';
          renderTemplates();
        } catch (error) {
          const message = formatErrorMessage(error);
          state.loadError = message;
          statusElement.textContent = state.templates.length > 0
            ? '刷新市场失败，继续显示上次加载结果：' + message
            : '暂时无法连接模板市场：' + message + '。已安装模板仍可从侧栏使用。';
          renderTemplates();
        }
      }

      function renderTemplates() {
        if (state.templates.length > 0) {
          templateGrid.replaceChildren(...state.templates.map(renderTemplateCard));
          return;
        }

        if (state.loadError) {
          const cards = [renderLoadErrorCard()];
          if (state.installedTemplates.length > 0) {
            cards.push(...state.installedTemplates.map(renderOfflineInstalledTemplateCard));
          }
          templateGrid.replaceChildren(...cards);
          return;
        }

        templateGrid.replaceChildren();
      }

      function renderLoadErrorCard() {
        const article = document.createElement('article');
        article.className = 'card notice-card';
        const title = document.createElement('h2');
        title.textContent = '无法连接模板市场';
        const body = document.createElement('p');
        body.textContent = '请检查网络、代理或 workers.dev 访问权限。已安装模板仍保留在侧栏，可以继续从侧栏应用到 Canvas。';
        const detail = document.createElement('p');
        detail.textContent = state.loadError ? '错误信息：' + state.loadError : '';
        const actions = document.createElement('div');
        actions.className = 'actions';
        const retryButton = document.createElement('button');
        retryButton.className = 'primary';
        retryButton.type = 'button';
        retryButton.textContent = '重试加载';
        retryButton.addEventListener('click', () => {
          void loadTemplates();
        });
        const browserButton = document.createElement('button');
        browserButton.className = 'secondary';
        browserButton.type = 'button';
        browserButton.textContent = '在浏览器打开';
        browserButton.addEventListener('click', () => {
          vscode.postMessage({ type: 'marketplace/openInBrowser' });
        });
        actions.append(retryButton, browserButton);
        article.append(title, body);
        if (detail.textContent) {
          article.append(detail);
        }
        article.append(actions);
        return article;
      }

      function renderOfflineInstalledTemplateCard(installedTemplate) {
        const article = document.createElement('article');
        article.className = 'card offline-template-card';
        const thumb = document.createElement('div');
        thumb.className = 'thumb';
        const eyebrow = document.createElement('p');
        eyebrow.textContent = 'Installed';
        const title = document.createElement('h2');
        title.textContent = installedTemplate.localTemplateName || installedTemplate.marketTemplateSlug || installedTemplate.marketTemplateId;
        thumb.append(eyebrow, title);

        const description = document.createElement('p');
        description.className = 'description';
        description.textContent = '已安装到 ' + formatInstalledTemplateLocationLabel(installedTemplate) + '。请在模板侧栏应用到 Canvas。';

        const badge = document.createElement('div');
        badge.className = 'installed-badge';
        badge.textContent = formatInstalledTemplateBadge(installedTemplate);

        const actions = document.createElement('div');
        actions.className = 'actions';
        if (installedTemplate.sourceUrl) {
          const detailButton = document.createElement('button');
          detailButton.className = 'secondary detail-link';
          detailButton.type = 'button';
          detailButton.textContent = '浏览器详情';
          detailButton.addEventListener('click', () => {
            window.open(installedTemplate.sourceUrl, '_blank', 'noopener');
          });
          actions.append(detailButton);
        }

        article.append(thumb, description, badge);
        if (actions.childElementCount > 0) {
          article.append(actions);
        }
        return article;
      }

      function renderTemplateCard(template) {
        const article = document.createElement('article');
        article.className = 'card';

        const thumb = document.createElement('div');
        thumb.className = 'thumb';
        const thumbnailImage = document.createElement('img');
        thumbnailImage.src = buildTemplateThumbnailUrl(template);
        thumbnailImage.alt = '';
        thumbnailImage.loading = 'lazy';
        thumbnailImage.addEventListener('error', () => {
          thumbnailImage.remove();
        });
        thumb.append(thumbnailImage);

        const titleRow = document.createElement('div');
        titleRow.className = 'title-row';
        const title = document.createElement('h2');
        title.className = 'card-title';
        title.textContent = template.name;
        const detailButton = document.createElement('button');
        detailButton.className = 'secondary detail-link';
        detailButton.type = 'button';
        detailButton.textContent = '浏览器详情';
        detailButton.addEventListener('click', () => {
          window.open(apiOrigin + '/templates/' + encodeURIComponent(template.slug), '_blank', 'noopener');
        });
        titleRow.append(title, detailButton);

        const description = document.createElement('p');
        description.className = 'description';
        description.textContent = template.description || '';

        const tags = document.createElement('div');
        tags.className = 'tags';
        for (const tag of template.tags || []) {
          const tagElement = document.createElement('span');
          tagElement.className = 'tag';
          tagElement.textContent = '#' + tag;
          tags.append(tagElement);
        }

        const meta = document.createElement('div');
        meta.className = 'meta';
        meta.textContent = (template.downloadCount || 0).toLocaleString() + ' downloads · ' + (template.likeCount || 0).toLocaleString() + ' likes · v' + template.latestVersion.versionNumber;

        const installedTemplate = findInstalledTemplate(template);
        const isCurrentVersionInstalled = Boolean(installedTemplate && installedTemplate.marketVersionId === template.latestVersion.id);
        const installedBadge = document.createElement('div');
        installedBadge.className = 'installed-badge';
        installedBadge.textContent = installedTemplate
          ? formatInstalledTemplateBadge(installedTemplate)
          : '';

        const installTargetRow = document.createElement('div');
        installTargetRow.className = 'install-target-row';
        const installTargetLabel = document.createElement('span');
        installTargetLabel.className = 'install-target-label';
        installTargetLabel.textContent = '安装位置';
        const installTargetSelect = createInstallTargetSelect(template);
        installTargetRow.append(installTargetLabel, installTargetSelect);

        const actions = document.createElement('div');
        actions.className = 'actions';
        const installButtonGroup = createInstallSplitButton(template, installedTemplate, isCurrentVersionInstalled);
        const downloadButtonGroup = createDownloadSplitButton(template);
        actions.append(installButtonGroup, downloadButtonGroup);

        article.append(thumb, titleRow, description, tags, meta);
        if (installedTemplate) {
          article.append(installedBadge);
        }
        article.append(installTargetRow);
        article.append(actions);
        return article;
      }

      function createInstallSplitButton(template, installedTemplate, isCurrentVersionInstalled) {
        const group = document.createElement('div');
        group.className = 'split-install';
        const installButton = document.createElement('button');
        installButton.className = 'primary split-primary';
        installButton.type = 'button';
        let installButtonLabel = '安装到 VSCode';
        if (state.installingSlug === template.slug) {
          installButtonLabel = '安装中...';
        } else if (!resolveTemplateInstallTargetId(template)) {
          installButtonLabel = '选择安装位置';
        } else if (isCurrentVersionInstalled) {
          installButtonLabel = '已安装 v' + installedTemplate.installedVersionNumber;
        } else if (installedTemplate) {
          installButtonLabel = '更新到 v' + template.latestVersion.versionNumber;
        }
        installButton.textContent = installButtonLabel;
        installButton.disabled = state.installingSlug === template.slug || isCurrentVersionInstalled || !resolveTemplateInstallTargetId(template);
        if (isCurrentVersionInstalled) {
          installButton.classList.add('is-installed');
        }
        installButton.addEventListener('click', () => {
          closeVersionMenus();
          void installTemplateVersion(template, template.latestVersion);
        });

        const versionButton = document.createElement('button');
        versionButton.className = 'primary split-toggle';
        versionButton.type = 'button';
        versionButton.textContent = '▼';
        versionButton.setAttribute('aria-label', '选择安装版本');
        versionButton.disabled = state.installingSlug === template.slug || !resolveTemplateInstallTargetId(template);
        versionButton.addEventListener('click', () => {
          void toggleVersionMenu(template, 'install');
        });

        group.append(installButton, versionButton);
        if (state.openInstallVersionMenuSlug === getTemplateInstallTargetKey(template)) {
          group.append(renderVersionMenu(template, 'install'));
        }
        return group;
      }

      function createDownloadSplitButton(template) {
        const group = document.createElement('div');
        group.className = 'split-install';
        const downloadButton = document.createElement('button');
        downloadButton.className = 'secondary split-primary';
        downloadButton.type = 'button';
        downloadButton.textContent = '下载 JSON';
        downloadButton.addEventListener('click', () => {
          closeVersionMenus();
          window.open(buildTemplateDownloadUrl(template, template.latestVersion), '_blank', 'noopener');
        });

        const versionButton = document.createElement('button');
        versionButton.className = 'secondary split-toggle';
        versionButton.type = 'button';
        versionButton.textContent = '▼';
        versionButton.setAttribute('aria-label', '选择下载版本');
        versionButton.addEventListener('click', () => {
          void toggleVersionMenu(template, 'download');
        });

        group.append(downloadButton, versionButton);
        if (state.openDownloadVersionMenuSlug === getTemplateInstallTargetKey(template)) {
          group.append(renderVersionMenu(template, 'download'));
        }
        return group;
      }

      function closeVersionMenus(render = true) {
        const hadOpenMenu = Boolean(state.openInstallVersionMenuSlug || state.openDownloadVersionMenuSlug);
        if (!hadOpenMenu) {
          return false;
        }
        state.openInstallVersionMenuSlug = undefined;
        state.openDownloadVersionMenuSlug = undefined;
        if (render) {
          renderTemplates();
        } else {
          document.querySelectorAll('.version-menu').forEach((menu) => {
            menu.remove();
          });
        }
        return true;
      }

      async function toggleVersionMenu(template, action) {
        const key = getTemplateInstallTargetKey(template);
        const openKey = action === 'download' ? 'openDownloadVersionMenuSlug' : 'openInstallVersionMenuSlug';
        const closedKey = action === 'download' ? 'openInstallVersionMenuSlug' : 'openDownloadVersionMenuSlug';
        if (state[openKey] === key) {
          state[openKey] = undefined;
          renderTemplates();
          return;
        }

        state[openKey] = key;
        state[closedKey] = undefined;
        if (!state.templateDetailsBySlug[key]) {
          state.loadingVersionMenuSlug = key;
          delete state.versionMenuErrorsBySlug[key];
          renderTemplates();
          await loadTemplateDetail(template);
          return;
        }
        renderTemplates();
      }

      function renderVersionMenu(template, action) {
        const key = getTemplateInstallTargetKey(template);
        const menu = document.createElement('div');
        menu.className = 'version-menu';
        menu.setAttribute('role', 'menu');

        if (state.loadingVersionMenuSlug === key) {
          const note = document.createElement('div');
          note.className = 'version-menu-note';
          note.textContent = '正在读取可安装版本...';
          menu.append(note);
          return menu;
        }

        const error = state.versionMenuErrorsBySlug[key];
        if (error) {
          const note = document.createElement('div');
          note.className = 'version-menu-note';
          note.textContent = '读取版本失败：' + error;
          menu.append(note);
          return menu;
        }

        const versions = collectInstallableVersions(template);
        for (const version of versions) {
          const item = document.createElement('button');
          item.className = 'version-menu-item';
          item.type = 'button';
          item.setAttribute('role', 'menuitem');
          const installedTemplate = findInstalledTemplate(template);
          const isInstalledVersion = Boolean(installedTemplate && installedTemplate.marketVersionId === version.id);
          item.textContent = action === 'download'
            ? '下载 v' + version.versionNumber
            : isInstalledVersion
            ? '已安装 v' + version.versionNumber
            : '安装 v' + version.versionNumber;
          item.disabled = action === 'install'
            ? state.installingSlug === template.slug || isInstalledVersion || !resolveTemplateInstallTargetId(template)
            : false;
          item.addEventListener('click', () => {
            if (action === 'download') {
              state.openDownloadVersionMenuSlug = undefined;
              window.open(buildTemplateDownloadUrl(template, version), '_blank', 'noopener');
              renderTemplates();
              return;
            }
            state.openInstallVersionMenuSlug = undefined;
            void installTemplateVersion(template, version);
          });
          menu.append(item);
        }
        return menu;
      }

      async function loadTemplateDetail(template) {
        const key = getTemplateInstallTargetKey(template);
        try {
          const response = await fetch(apiOrigin + '/api/v1/templates/' + encodeURIComponent(template.slug), {
            headers: { accept: 'application/json' }
          });
          if (!response.ok) {
            throw new Error('HTTP ' + response.status);
          }
          const body = await response.json();
          if (!body || typeof body !== 'object' || !body.template) {
            throw new Error('版本接口返回了无法识别的数据');
          }
          state.templateDetailsBySlug[key] = body.template;
        } catch (error) {
          state.versionMenuErrorsBySlug[key] = formatErrorMessage(error);
        } finally {
          if (state.loadingVersionMenuSlug === key) {
            state.loadingVersionMenuSlug = undefined;
          }
          renderTemplates();
        }
      }

      function collectInstallableVersions(template) {
        const detail = state.templateDetailsBySlug[getTemplateInstallTargetKey(template)];
        const candidateVersions = Array.isArray(detail && detail.versions) ? detail.versions : [];
        const versionsById = new Map();
        for (const version of [template.latestVersion, ...candidateVersions]) {
          if (version && typeof version.id === 'string' && typeof version.versionNumber === 'number') {
            versionsById.set(version.id, version);
          }
        }
        return [...versionsById.values()].sort((left, right) => right.versionNumber - left.versionNumber);
      }

      async function installTemplateVersion(template, version) {
        const targetId = resolveTemplateInstallTargetId(template);
        const target = resolveInstallTargetById(targetId);
        state.installingSlug = template.slug;
        statusElement.textContent = '正在下载并安装 ' + template.name + ' v' + version.versionNumber + (target ? ' 到 ' + formatInstallTargetLabel(target) : '') + '...';
        renderTemplates();
        try {
          const response = await fetch(apiOrigin + '/api/v1/templates/' + encodeURIComponent(template.slug) + '/download?version=' + encodeURIComponent(version.id), {
            headers: { accept: 'application/json' }
          });
          if (!response.ok) {
            throw new Error('HTTP ' + response.status);
          }
          const templateJson = await response.text();
          vscode.postMessage({
            type: 'marketplace/installTemplate',
            payload: {
              templateIdOrSlug: template.slug,
              versionId: version.id,
              targetStorageLocationId: targetId,
              sourceUrl: apiOrigin + '/templates/' + encodeURIComponent(template.slug),
              templateJson,
              payloadSha256: version.sha256,
              marketTemplateId: template.id,
              installedVersionNumber: version.versionNumber,
              sha256: version.sha256,
              sizeBytes: version.sizeBytes,
              publisher: template.publisher
            }
          });
        } catch (error) {
          state.installingSlug = undefined;
          statusElement.textContent = '安装失败：无法下载模板 JSON（' + formatErrorMessage(error) + '）。请检查网络后重试，或在浏览器详情页下载。';
          renderTemplates();
        }
      }

      function debounce(callback, waitMs) {
        let timer = 0;
        return () => {
          window.clearTimeout(timer);
          timer = window.setTimeout(callback, waitMs);
        };
      }

      function findInstalledTemplate(template) {
        const selectedInstallTargetId = resolveTemplateInstallTargetId(template);
        return state.installedTemplates.find((installedTemplate) => {
          const matchesTemplate = installedTemplate.marketTemplateSlug === template.slug || installedTemplate.marketTemplateId === template.id;
          const matchesTarget = !selectedInstallTargetId || installedTemplate.storageLocationId === selectedInstallTargetId;
          return matchesTemplate && matchesTarget;
        });
      }

      function buildTemplateDownloadUrl(template, version) {
        const targetVersion = version || template.latestVersion;
        return apiOrigin + '/api/v1/templates/' + encodeURIComponent(template.slug) + '/download?version=' + encodeURIComponent(targetVersion.id);
      }

      function buildTemplateThumbnailUrl(template) {
        return apiOrigin + '/api/v1/templates/' + encodeURIComponent(template.slug) + '/thumbnail?version=' + encodeURIComponent(template.latestVersion.id);
      }

      function createInstallTargetSelect(template) {
        const select = document.createElement('select');
        select.className = 'install-target';
        select.setAttribute('aria-label', '安装位置');
        if (state.installTargets.length === 0) {
          const option = document.createElement('option');
          option.value = '';
          option.textContent = '正在读取安装位置...';
          select.replaceChildren(option);
          select.disabled = true;
          return select;
        }

        const options = state.installTargets.map((target) => {
          const option = document.createElement('option');
          option.value = target.id;
          option.textContent = formatInstallTargetLabel(target);
          return option;
        });
        select.replaceChildren(...options);
        select.value = resolveTemplateInstallTargetId(template) || state.installTargets[0].id;
        select.addEventListener('change', () => {
          state.installTargetIdsByTemplateSlug[getTemplateInstallTargetKey(template)] = select.value || undefined;
          persistState();
          renderTemplates();
        });
        return select;
      }

      function resolveTemplateInstallTargetId(template) {
        const key = getTemplateInstallTargetKey(template);
        const selectedTargetId = state.installTargetIdsByTemplateSlug[key];
        if (selectedTargetId && state.installTargets.some((target) => target.id === selectedTargetId)) {
          return selectedTargetId;
        }
        return resolveDefaultInstallTargetId(state.installTargets);
      }

      function getTemplateInstallTargetKey(template) {
        return template.slug || template.id;
      }

      function resolveInstallTargetById(targetId) {
        return state.installTargets.find((target) => target.id === targetId);
      }

      function syncInstallTargets(nextInstallTargets) {
        state.installTargets = nextInstallTargets;
        for (const [key, targetId] of Object.entries(state.installTargetIdsByTemplateSlug)) {
          if (targetId && !nextInstallTargets.some((target) => target.id === targetId)) {
            delete state.installTargetIdsByTemplateSlug[key];
          }
        }
        persistState();
      }

      function resolveDefaultInstallTargetId(installTargets) {
        return installTargets.find((target) => target.scope === 'global')?.id || installTargets[0]?.id;
      }

      function formatInstallTargetLabel(target) {
        if (target.scope === 'workspace') {
          return formatWorkspaceLocationLabel(target.label);
        }
        return '本地 · ' + target.label;
      }

      function formatInstalledTemplateBadge(installedTemplate) {
        return '已安装到 ' + formatInstalledTemplateLocationLabel(installedTemplate) + ' · v' + installedTemplate.installedVersionNumber;
      }

      function formatInstalledTemplateLocationLabel(installedTemplate) {
        if (installedTemplate.storageScope === 'workspace') {
          return formatWorkspaceLocationLabel(installedTemplate.storageLocationLabel || '当前workspace');
        }
        return '本地 · ' + (installedTemplate.storageLocationLabel || '当前设备');
      }

      function formatWorkspaceLocationLabel(label) {
        return (label || '当前workspace').replace(/^当前 workspace(?:\\s*·\\s*)?/, (match) => match.includes('·') ? '当前workspace · ' : '当前workspace');
      }

      function formatInstallResultStatus(payload) {
        const actionLabel = payload.operation === 'updated'
          ? '已更新模板：'
          : payload.operation === 'reinstalled'
            ? '已重新安装模板：'
            : '已安装模板：';
        return actionLabel + payload.templateName + ' v' + payload.versionNumber + '。请到模板侧栏应用到 Canvas。';
      }

      function persistState() {
        vscode.setState({
          searchQuery: searchInput.value,
          sort: sortSelect.value,
          installTargetIdsByTemplateSlug: state.installTargetIdsByTemplateSlug
        });
      }

      function normalizePersistedState(value) {
        const emptyState = {
          searchQuery: '',
          sort: 'hot',
          installTargetIdsByTemplateSlug: {}
        };
        if (!value || typeof value !== 'object') {
          return emptyState;
        }
        const installTargetIdsByTemplateSlug = {};
        if (value.installTargetIdsByTemplateSlug && typeof value.installTargetIdsByTemplateSlug === 'object') {
          for (const [key, targetId] of Object.entries(value.installTargetIdsByTemplateSlug)) {
            const normalizedKey = readString(key);
            const normalizedTargetId = readString(targetId);
            if (normalizedKey && normalizedTargetId) {
              installTargetIdsByTemplateSlug[normalizedKey] = normalizedTargetId;
            }
          }
        }
        return {
          searchQuery: readString(value.searchQuery) || '',
          sort: readString(value.sort) || 'hot',
          installTargetIdsByTemplateSlug
        };
      }

      function formatErrorMessage(error) {
        const message = String(error && error.message ? error.message : error || '未知错误');
        if (/Failed to fetch/i.test(message)) {
          return '网络请求失败，可能无法访问 workers.dev 或代理阻断';
        }
        return message;
      }

      function normalizeInstallTargets(value) {
        if (!Array.isArray(value)) {
          return [];
        }
        return value
          .map((entry) => {
            if (!entry || typeof entry !== 'object') {
              return undefined;
            }
            const id = readString(entry.id);
            const label = readString(entry.label);
            const scope = entry.scope === 'workspace' ? 'workspace' : entry.scope === 'global' ? 'global' : undefined;
            if (!id || !label || !scope) {
              return undefined;
            }
            return { id, label, scope };
          })
          .filter(Boolean);
      }

      function normalizeInstalledTemplates(value) {
        if (!Array.isArray(value)) {
          return [];
        }
        return value
          .map((entry) => {
            if (!entry || typeof entry !== 'object') {
              return undefined;
            }
            const marketTemplateId = readString(entry.marketTemplateId);
            const marketVersionId = readString(entry.marketVersionId);
            const installedVersionNumber = typeof entry.installedVersionNumber === 'number' && Number.isFinite(entry.installedVersionNumber)
              ? entry.installedVersionNumber
              : undefined;
            if (!marketTemplateId || !marketVersionId || installedVersionNumber === undefined) {
              return undefined;
            }
            return {
              localTemplateId: readString(entry.localTemplateId),
              localTemplateName: readString(entry.localTemplateName),
              storageLocationId: readString(entry.storageLocationId),
              storageLocationLabel: readString(entry.storageLocationLabel),
              storageScope: entry.storageScope === 'workspace' ? 'workspace' : entry.storageScope === 'global' ? 'global' : undefined,
              marketTemplateId,
              marketTemplateSlug: readString(entry.marketTemplateSlug),
              marketVersionId,
              installedVersionNumber,
              sourceUrl: readString(entry.sourceUrl)
            };
          })
          .filter(Boolean);
      }

      function readString(value) {
        return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
      }

      vscode.postMessage({ type: 'marketplace/refreshInstalledTemplates' });
      void loadTemplates();
    </script>
  </body>
</html>`;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function readOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function createNonce(): string {
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let index = 0; index < 32; index += 1) {
    nonce += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return nonce;
}
