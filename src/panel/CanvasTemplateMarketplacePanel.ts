import * as vscode from 'vscode';

import {
  parseTrustedMarketplaceSourceUrl,
  TemplateMarketplaceClient,
  type TemplateMarketplaceInstallTargetSummary,
  type TemplateMarketplaceInstalledTemplateSummary,
  type TemplateMarketplaceInlineInstallParams
} from './TemplateMarketplaceClient';
import { COMMAND_IDS } from '../common/extensionIdentity';
import { isTestHarnessMode } from '../common/testHarness';
import { getVersionedWebviewResourceUri } from '../common/webviewResourceUri';

const MARKETPLACE_OFFICIAL_ORIGIN = 'https://dscanvas.dev';
const MARKETPLACE_DEBUG_ORIGIN = 'https://dscanvas-template-marketplace.wzy0304.workers.dev';
const MARKETPLACE_OFFICIAL_SOURCE_URL = `${MARKETPLACE_OFFICIAL_ORIGIN}/templates`;
const MARKETPLACE_DEBUG_SOURCE_URL = `${MARKETPLACE_DEBUG_ORIGIN}/templates`;
const MARKETPLACE_SOURCE_URL_ENV_KEY = 'DEV_SESSION_CANVAS_TEMPLATE_MARKETPLACE_SOURCE_URL';
const MARKETPLACE_OFFICIAL_HOSTS = new Set(['dscanvas.dev', 'www.dscanvas.dev', 'templates.dscanvas.dev']);
const MARKETPLACE_DEBUG_HOSTS = new Set(['dscanvas-template-marketplace.wzy0304.workers.dev']);
const MARKETPLACE_LOCAL_DEVELOPMENT_SOURCES = [
  'http://localhost:*',
  'https://localhost:*',
  'http://127.0.0.1:*',
  'https://127.0.0.1:*',
  'http://0.0.0.0:*',
  'https://0.0.0.0:*',
  'http://[::1]:*',
  'https://[::1]:*'
];
const MARKETPLACE_CONNECT_SOURCES = [
  MARKETPLACE_OFFICIAL_ORIGIN,
  'https://www.dscanvas.dev',
  'https://templates.dscanvas.dev',
  MARKETPLACE_DEBUG_ORIGIN,
  ...MARKETPLACE_LOCAL_DEVELOPMENT_SOURCES
].join(' ');
const MARKETPLACE_IMAGE_SOURCES = [
  'https:',
  'data:',
  ...MARKETPLACE_LOCAL_DEVELOPMENT_SOURCES
].join(' ');
const MARKETPLACE_PANEL_VIEW_TYPE = 'devSessionCanvas.templateMarketplace';
const MARKETPLACE_BUNDLED_CODICON_PATH_SEGMENTS = ['dist', 'sidebar-codicon.css'] as const;

type MarketplaceSourceFlavor = 'official' | 'debug';

type MarketplacePanelInboundMessage =
  | {
      type: 'marketplace/installTemplate';
      payload: TemplateMarketplaceInlineInstallParams;
    }
  | {
      type: 'marketplace/openInBrowser';
      payload?: {
        sourceUrl?: string;
      };
    }
  | {
      type: 'marketplace/publishTemplate';
    }
  | {
      type: 'marketplace/refreshInstalledTemplates';
    };

interface MarketplaceTemplateDetailRequest {
  templateIdOrSlug: string;
  versionId?: string;
  sourceUrl?: string;
}

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
    }
  | {
      type: 'marketplace/openTemplateIndex';
      payload: {
        sourceUrl: string;
      };
    }
  | {
      type: 'marketplace/openTemplateDetail';
      payload: MarketplaceTemplateDetailRequest;
    };

type MarketplacePanelTestResultMessage =
  | {
      type: 'marketplace/testProbeResult';
      payload: {
        requestId?: string;
        probe?: unknown;
      };
    }
  | {
      type: 'marketplace/testActionResult';
      payload: {
        requestId?: string;
        ok?: boolean;
        probe?: unknown;
        message?: string;
      };
    };

interface PendingMarketplaceTestRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

export class CanvasTemplateMarketplacePanelController implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly pendingTestProbeRequests = new Map<string, PendingMarketplaceTestRequest>();
  private readonly pendingTestActionRequests = new Map<string, PendingMarketplaceTestRequest>();
  private pendingDetailRequest: MarketplaceTemplateDetailRequest | undefined;
  private readonly defaultMarketplaceSourceUrl: URL;
  private marketplaceSourceUrl: URL;
  private readonly testHarnessEnabled: boolean;

  public constructor(
    private readonly marketplaceClient: TemplateMarketplaceClient,
    private readonly extensionUri: vscode.Uri,
    extensionMode: vscode.ExtensionMode
  ) {
    this.testHarnessEnabled = isTestHarnessMode(extensionMode);
    this.defaultMarketplaceSourceUrl = resolveDefaultMarketplaceSourceUrl(extensionMode);
    this.marketplaceSourceUrl = new URL(this.defaultMarketplaceSourceUrl);
  }

  public reveal(): void {
    this.marketplaceSourceUrl = new URL(this.defaultMarketplaceSourceUrl);
    this.pendingDetailRequest = undefined;
    this.revealPanel();
    void this.postOpenTemplateIndex();
  }

  public openTemplateDetail(templateIdOrSlug: string, versionId?: string, sourceUrl?: URL): void {
    const resolvedSourceUrl = sourceUrl
      ? resolveCompatibleMarketplaceSourceUrl(sourceUrl, this.defaultMarketplaceSourceUrl)
      : undefined;
    if (resolvedSourceUrl) {
      this.marketplaceSourceUrl = resolvedSourceUrl;
    }
    this.pendingDetailRequest = {
      templateIdOrSlug,
      versionId,
      sourceUrl: resolvedSourceUrl?.toString()
    };
    this.revealPanel();
    void this.postOpenTemplateDetail();
  }

  public openTemplateDetailFromUri(uri: vscode.Uri): void {
    const detailRequest = parseMarketplaceTemplateDetailRequest(uri);
    const sourceUrl = detailRequest.sourceUrl
      ? parseTrustedMarketplaceSourceUrl(detailRequest.sourceUrl)
      : new URL(this.defaultMarketplaceSourceUrl);
    this.openTemplateDetail(
      detailRequest.templateIdOrSlug,
      detailRequest.versionId,
      sourceUrl
    );
  }

  public dispose(): void {
    this.rejectPendingTestRequests(new Error('模板市场面板已关闭。'));
    this.panel?.dispose();
    this.panel = undefined;
    this.pendingDetailRequest = undefined;
    this.marketplaceSourceUrl = new URL(this.defaultMarketplaceSourceUrl);
    while (this.disposables.length > 0) {
      this.disposables.pop()?.dispose();
    }
  }

  public async captureTestProbe(timeoutMs = 5000): Promise<unknown> {
    if (!this.testHarnessEnabled) {
      throw new Error('captureTestProbe 仅在测试模式下可用。');
    }
    return this.sendTestRequest('marketplace/testProbeRequest', this.pendingTestProbeRequests, undefined, timeoutMs);
  }

  public async performTestAction(action: unknown, timeoutMs = 5000): Promise<unknown> {
    if (!this.testHarnessEnabled) {
      throw new Error('performTestAction 仅在测试模式下可用。');
    }
    return this.sendTestRequest('marketplace/testAction', this.pendingTestActionRequests, action, timeoutMs);
  }

  private revealPanel(): void {
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
    panel.webview.html = buildTemplateMarketplaceHtml(panel.webview, this.extensionUri, this.marketplaceSourceUrl);
    panel.webview.onDidReceiveMessage((message) => {
      void this.handleMessage(message);
    }, undefined, this.disposables);
    panel.onDidDispose(() => {
      this.panel = undefined;
      this.rejectPendingTestRequests(new Error('模板市场面板已关闭。'));
    }, undefined, this.disposables);
    void this.postInstalledTemplates();
  }

  private async sendTestRequest(
    type: 'marketplace/testProbeRequest' | 'marketplace/testAction',
    pendingRequests: Map<string, PendingMarketplaceTestRequest>,
    action: unknown,
    timeoutMs: number
  ): Promise<unknown> {
    this.revealPanel();
    const panel = this.panel;
    if (!panel) {
      throw new Error('模板市场面板尚未打开。');
    }
    const requestId = `marketplace-test-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    return new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingRequests.delete(requestId);
        reject(new Error(`等待模板市场测试动作返回超时（${timeoutMs}ms）。`));
      }, timeoutMs);
      pendingRequests.set(requestId, { resolve, reject, timeout });
      void panel.webview.postMessage({
        type,
        payload: {
          requestId,
          action
        }
      });
    });
  }

  private rejectPendingTestRequests(error: Error): void {
    for (const pendingRequests of [this.pendingTestProbeRequests, this.pendingTestActionRequests]) {
      for (const [requestId, request] of pendingRequests) {
        clearTimeout(request.timeout);
        request.reject(error);
        pendingRequests.delete(requestId);
      }
    }
  }

  private async handleMessage(message: unknown): Promise<void> {
    const testResult = parseMarketplacePanelTestResultMessage(message);
    if (testResult) {
      this.handleTestResultMessage(testResult);
      return;
    }

    const parsed = parseMarketplacePanelMessage(message);
    if (!parsed) {
      return;
    }

    switch (parsed.type) {
      case 'marketplace/openInBrowser':
        try {
          this.marketplaceSourceUrl = resolveCompatibleMarketplaceSourceUrl(
            parseTrustedMarketplaceSourceUrl(parsed.payload?.sourceUrl ?? this.marketplaceSourceUrl.toString()),
            this.defaultMarketplaceSourceUrl
          );
          await vscode.env.openExternal(vscode.Uri.parse(this.marketplaceSourceUrl.toString()));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          await vscode.window.showErrorMessage(`打开模板市场失败：${message}`);
        }
        return;
      case 'marketplace/installTemplate':
        await this.installTemplate(parsed.payload);
        return;
      case 'marketplace/publishTemplate':
        await this.publishTemplateToMarketplace();
        return;
      case 'marketplace/refreshInstalledTemplates':
        await this.postInstalledTemplates();
        return;
    }
  }

  private handleTestResultMessage(message: MarketplacePanelTestResultMessage): void {
    const requestId = message.payload.requestId;
    if (!requestId) {
      return;
    }
    const pendingRequests =
      message.type === 'marketplace/testProbeResult'
        ? this.pendingTestProbeRequests
        : this.pendingTestActionRequests;
    const pendingRequest = pendingRequests.get(requestId);
    if (!pendingRequest) {
      return;
    }
    pendingRequests.delete(requestId);
    clearTimeout(pendingRequest.timeout);
    if (message.type === 'marketplace/testActionResult' && message.payload.ok === false) {
      pendingRequest.reject(new Error(message.payload.message ?? '模板市场测试动作失败。'));
      return;
    }
    pendingRequest.resolve(message.payload.probe);
  }

  private async publishTemplateToMarketplace(): Promise<void> {
    try {
      await vscode.commands.executeCommand(COMMAND_IDS.publishTemplateToMarketplace);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await vscode.window.showErrorMessage(`发布自建模板失败：${message}`);
    }
  }

  private async installTemplate(payload: TemplateMarketplaceInlineInstallParams): Promise<void> {
    try {
      resolveCompatibleMarketplaceSourceUrl(
        parseTrustedMarketplaceSourceUrl(payload.sourceUrl),
        this.defaultMarketplaceSourceUrl
      );
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

  private async postOpenTemplateDetail(): Promise<void> {
    if (!this.panel || !this.pendingDetailRequest) {
      return;
    }

    const detailRequest = this.pendingDetailRequest;
    this.pendingDetailRequest = undefined;
    await this.panel.webview.postMessage({
      type: 'marketplace/openTemplateDetail',
      payload: detailRequest
    } satisfies MarketplacePanelOutboundMessage);
  }

  private async postOpenTemplateIndex(): Promise<void> {
    if (!this.panel) {
      return;
    }
    await this.panel.webview.postMessage({
      type: 'marketplace/openTemplateIndex',
      payload: {
        sourceUrl: this.marketplaceSourceUrl.toString()
      }
    } satisfies MarketplacePanelOutboundMessage);
  }
}

function resolveDefaultMarketplaceSourceUrl(extensionMode: vscode.ExtensionMode): URL {
  const override = resolveNonProductionMarketplaceSourceUrlOverride(extensionMode);
  if (override) {
    return override;
  }
  return new URL(
    extensionMode === vscode.ExtensionMode.Production
      ? MARKETPLACE_OFFICIAL_SOURCE_URL
      : MARKETPLACE_DEBUG_SOURCE_URL
  );
}

function resolveNonProductionMarketplaceSourceUrlOverride(extensionMode: vscode.ExtensionMode): URL | undefined {
  if (extensionMode === vscode.ExtensionMode.Production) {
    return undefined;
  }
  const value = process.env[MARKETPLACE_SOURCE_URL_ENV_KEY]?.trim();
  if (!value) {
    return undefined;
  }
  return parseTrustedMarketplaceSourceUrl(value);
}

function resolveCompatibleMarketplaceSourceUrl(sourceUrl: URL, defaultMarketplaceSourceUrl: URL): URL {
  const expectedFlavor = getMarketplaceSourceFlavor(defaultMarketplaceSourceUrl);
  const actualFlavor = getMarketplaceSourceFlavor(sourceUrl);
  if (!expectedFlavor || !actualFlavor || expectedFlavor !== actualFlavor) {
    throw new Error(formatMarketplaceSourceMismatchError(expectedFlavor, actualFlavor));
  }
  return sourceUrl;
}

function getMarketplaceSourceFlavor(sourceUrl: URL): MarketplaceSourceFlavor | undefined {
  if (sourceUrl.protocol === 'https:' && MARKETPLACE_OFFICIAL_HOSTS.has(sourceUrl.hostname)) {
    return 'official';
  }
  if (sourceUrl.protocol === 'https:' && MARKETPLACE_DEBUG_HOSTS.has(sourceUrl.hostname)) {
    return 'debug';
  }
  if (
    (sourceUrl.protocol === 'http:' || sourceUrl.protocol === 'https:') &&
    isLocalDevelopmentHost(sourceUrl.hostname)
  ) {
    return 'debug';
  }
  return undefined;
}

function formatMarketplaceSourceMismatchError(
  expectedFlavor: MarketplaceSourceFlavor | undefined,
  actualFlavor: MarketplaceSourceFlavor | undefined
): string {
  const expectedInstall = expectedFlavor === 'official'
    ? '正式版'
    : expectedFlavor === 'debug'
      ? '调试版'
      : '当前版本';
  const expectedMarket = expectedFlavor === 'official'
    ? '正式市场'
    : expectedFlavor === 'debug'
      ? '调试市场'
      : '对应市场';
  const actualMarket = actualFlavor === 'official'
    ? '正式市场'
    : actualFlavor === 'debug'
      ? '调试市场'
      : '未知来源';
  return `当前扩展为${expectedInstall}，仅支持${expectedMarket}链接；该链接来自${actualMarket}，请从对应市场重新打开。`;
}

function isLocalDevelopmentHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '0.0.0.0' ||
    hostname === '::1' ||
    hostname === '[::1]'
  );
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
      type: 'marketplace/openInBrowser',
      payload: isRecord(message.payload)
        ? {
            sourceUrl: readOptionalString(message.payload.sourceUrl)
          }
        : undefined
    };
  }

  if (message.type === 'marketplace/publishTemplate') {
    return {
      type: 'marketplace/publishTemplate'
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

function parseMarketplacePanelTestResultMessage(message: unknown): MarketplacePanelTestResultMessage | null {
  if (!isRecord(message) || (message.type !== 'marketplace/testProbeResult' && message.type !== 'marketplace/testActionResult')) {
    return null;
  }
  const payload = isRecord(message.payload) ? message.payload : {};
  return {
    type: message.type,
    payload: {
      requestId: readOptionalString(payload.requestId),
      ok: typeof payload.ok === 'boolean' ? payload.ok : undefined,
      probe: payload.probe,
      message: readOptionalString(payload.message)
    }
  } as MarketplacePanelTestResultMessage;
}

function parseMarketplaceTemplateDetailRequest(uri: vscode.Uri): MarketplaceTemplateDetailRequest {
  if (uri.path !== '/install-template') {
    throw new Error('不支持的市场链接路径。');
  }

  const params = new URLSearchParams(uri.query);
  const templateIdOrSlug = readRequiredQueryParam(params, 'template');
  return {
    templateIdOrSlug,
    versionId: readOptionalString(params.get('version')),
    sourceUrl: readOptionalString(params.get('source'))
  };
}

function readRequiredQueryParam(params: URLSearchParams, key: string): string {
  const value = readOptionalString(params.get(key));
  if (!value) {
    throw new Error(`市场链接缺少必要参数 ${key}。`);
  }
  return value;
}

function buildTemplateMarketplaceHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  marketplaceSourceUrl: URL
): string {
  const nonce = createNonce();
  const codiconCssUri = getVersionedWebviewResourceUri(
    webview,
    extensionUri,
    ...MARKETPLACE_BUNDLED_CODICON_PATH_SEGMENTS
  );
  const stateJson = JSON.stringify({
    apiOrigin: marketplaceSourceUrl.origin,
    marketplaceSourceUrl: marketplaceSourceUrl.toString()
  });

  return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; connect-src ${MARKETPLACE_CONNECT_SOURCES}; img-src ${MARKETPLACE_IMAGE_SOURCES}; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="stylesheet" href="${codiconCssUri}" />
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

      [hidden] {
        display: none !important;
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

      .header-actions {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: flex-end;
        gap: 6px;
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
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
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

      .single-action {
        grid-template-columns: minmax(0, 1fr);
      }

      .split-install {
        position: relative;
        display: grid;
        grid-template-columns: minmax(0, 1fr) 26px;
        min-width: 0;
      }

      .list-install {
        grid-template-columns: minmax(0, 1fr);
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
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 26px;
        margin-left: 1px;
        border-radius: 0 2px 2px 0;
        padding: 0 7px;
      }

      .split-toggle-icon {
        font-size: 14px;
        line-height: 1;
      }

      .list-install .split-primary {
        border-radius: 2px;
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

      .detail-view {
        display: grid;
        gap: 16px;
        margin-top: 10px;
      }

      .detail-shell {
        border: 1px solid var(--border);
        background: var(--surface);
        box-shadow: 0 10px 28px color-mix(in srgb, var(--vscode-editor-foreground) 10%, transparent);
      }

      .detail-header {
        border-bottom: 1px solid var(--border);
        padding: 16px 16px 18px;
      }

      .detail-back {
        border: 0;
        background: transparent;
        color: var(--vscode-textLink-foreground, var(--secondary-fg));
        padding: 0;
        cursor: pointer;
        font-size: 12px;
        font-weight: 600;
      }

      .detail-back:hover {
        text-decoration: underline;
      }

      .detail-summary {
        display: grid;
        grid-template-columns: 96px minmax(0, 1fr);
        gap: 12px;
        margin-top: 12px;
      }

      .detail-thumb {
        min-height: 88px;
        border: 1px solid var(--border);
        border-radius: 2px;
        overflow: hidden;
        background: var(--surface);
      }

      .detail-thumb img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      .detail-title {
        margin: 0;
        font-size: 19px;
        font-weight: 700;
        line-height: 1.25;
      }

      .detail-description {
        margin: 8px 0 0;
        color: var(--muted);
        font-size: 13px;
        line-height: 1.6;
      }

      .detail-tags {
        display: flex;
        flex-wrap: wrap;
        gap: 5px 8px;
        margin-top: 10px;
      }

      .detail-body {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 18rem;
      }

      .detail-readme {
        border-right: 1px solid var(--border);
        padding: 18px 16px 20px;
      }

      .detail-readme-title {
        margin: 0;
        font-size: 13px;
        font-weight: 700;
        letter-spacing: 0.14em;
        text-transform: uppercase;
      }

      .detail-readme-body {
        margin-top: 12px;
        white-space: pre-wrap;
        color: var(--fg);
        font-size: 13px;
        line-height: 1.8;
      }

      .detail-sidebar {
        display: grid;
        gap: 14px;
        padding: 16px;
      }

      .detail-controls {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
      }

      .detail-controls .install-target-row {
        grid-area: auto;
        grid-column: 1 / -1;
        width: 100%;
      }

      .detail-metrics {
        display: grid;
        gap: 10px;
        border-top: 1px solid var(--border);
        padding-top: 12px;
      }

      .detail-metric dt {
        color: var(--muted);
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }

      .detail-metric dd {
        margin: 4px 0 0;
        font-size: 16px;
        font-weight: 700;
        line-height: 1.3;
      }

      .detail-section {
        border-top: 1px solid var(--border);
        padding-top: 12px;
      }

      .detail-section-title {
        margin: 0;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: var(--muted);
      }

      .detail-section-body {
        margin-top: 8px;
        color: var(--fg);
        font-size: 12px;
        line-height: 1.6;
      }

      .detail-version-list {
        display: grid;
        gap: 12px;
        margin: 0;
        padding: 0;
        list-style: none;
      }

      .detail-version-item {
        display: grid;
        gap: 4px;
      }

      .detail-version-row {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 12px;
      }

      .detail-version-label {
        font-weight: 700;
      }

      .detail-version-status {
        color: var(--muted);
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }

      .detail-version-changelog {
        margin: 0;
        color: var(--muted);
        font-size: 12px;
        line-height: 1.6;
      }

      .detail-integrity-value {
        margin: 0;
        word-break: break-all;
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

        .detail-controls {
          grid-template-columns: 1fr;
        }

        .detail-summary {
          grid-template-columns: 1fr;
        }

        .detail-body {
          grid-template-columns: 1fr;
        }

        .detail-readme {
          border-right: 0;
          border-bottom: 1px solid var(--border);
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
          <div class="header-actions">
            <button class="open-browser publish-template" id="publishTemplateButton" type="button">
              <span class="codicon codicon-cloud-upload" aria-hidden="true"></span>
              <span>发布自建模板</span>
            </button>
            <button class="open-browser" id="openBrowserButton" type="button">浏览器中打开</button>
          </div>
        </div>
        <p class="panel-note">在详情页中选择版本并安装到本地模板库。</p>
      </section>

      <section class="toolbar" id="marketplaceToolbar" aria-label="模板市场筛选">
        <input id="searchInput" type="search" placeholder="搜索模板名称、标签或关键词..." />
        <select id="sortSelect" aria-label="排序">
          <option value="hot">Hot</option>
          <option value="downloads">Downloads</option>
          <option value="likes">Likes</option>
          <option value="newest">Newest</option>
          <option value="updated">Updated</option>
        </select>
      </section>

      <p class="status" id="status">正在加载...</p>
      <section class="grid" id="templateGrid" aria-label="模板列表"></section>
      <section class="detail-view" id="detailView" aria-label="模板详情" hidden></section>
    </main>

    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      const initialState = ${stateJson};
      let apiOrigin = normalizeApiOrigin(initialState.apiOrigin, initialState.marketplaceSourceUrl);
      const persistedState = normalizePersistedState(vscode.getState && vscode.getState());
      const initialInstallTargets = normalizeInstallTargets(initialState.installTargets);
      const state = {
        templates: [],
        installingSlug: undefined,
        loadError: undefined,
        storageMode: undefined,
        installedTemplates: normalizeInstalledTemplates(initialState.installedTemplates),
        installTargets: initialInstallTargets,
        installTargetIdsByTemplateSlug: persistedState.installTargetIdsByTemplateSlug,
        activeTemplateSlug: undefined,
        activeTemplateVersionId: undefined,
        openInstallVersionMenuSlug: undefined,
        openDownloadVersionMenuSlug: undefined,
        loadingVersionMenuSlug: undefined,
        templateDetailsBySlug: {},
        detailLoadErrorsBySlug: {},
        versionMenuErrorsBySlug: {},
        apiOrigin,
        marketplaceSourceUrl: normalizeMarketplaceSourceUrl(initialState.marketplaceSourceUrl, apiOrigin)
      };

      const searchInput = document.getElementById('searchInput');
      const sortSelect = document.getElementById('sortSelect');
      const statusElement = document.getElementById('status');
      const toolbarElement = document.getElementById('marketplaceToolbar');
      const templateGrid = document.getElementById('templateGrid');
      const detailViewElement = document.getElementById('detailView');
      const openBrowserButton = document.getElementById('openBrowserButton');
      const publishTemplateButton = document.getElementById('publishTemplateButton');
      searchInput.value = persistedState.searchQuery;
      if ([...sortSelect.options].some((option) => option.value === persistedState.sort)) {
        sortSelect.value = persistedState.sort;
      }

      publishTemplateButton.addEventListener('click', () => {
        closeVersionMenus();
        vscode.postMessage({ type: 'marketplace/publishTemplate' });
      });
      openBrowserButton.addEventListener('click', () => {
        postOpenInBrowserMessage();
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

        if (message.type === 'marketplace/testProbeRequest') {
          postTestProbeResult(message.payload && message.payload.requestId);
          return;
        }

        if (message.type === 'marketplace/testAction') {
          void handleTestAction(message.payload && message.payload.requestId, message.payload && message.payload.action);
          return;
        }

        if (message.type === 'marketplace/installedTemplates') {
          state.installedTemplates = normalizeInstalledTemplates(message.payload && message.payload.installedTemplates);
          syncInstallTargets(normalizeInstallTargets(message.payload && message.payload.installTargets));
          renderTemplates();
          return;
        }

        if (message.type === 'marketplace/installedTemplatesError') {
          statusElement.textContent = '读取已安装状态失败：' + (message.payload && message.payload.message ? message.payload.message : '未知错误') + '。浏览不受影响，已安装模板可从侧栏使用。';
          return;
        }

        if (message.type === 'marketplace/openTemplateIndex') {
          const sourceChanged = setMarketplaceSourceUrl(message.payload && message.payload.sourceUrl);
          closeTemplateDetail();
          if (sourceChanged || state.templates.length === 0) {
            void loadTemplates();
          }
          return;
        }

        if (message.type === 'marketplace/openTemplateDetail') {
          const templateIdOrSlug = message.payload && message.payload.templateIdOrSlug ? String(message.payload.templateIdOrSlug).trim() : '';
          if (!templateIdOrSlug) {
            return;
          }
          const sourceChanged = setMarketplaceSourceUrl(message.payload && message.payload.sourceUrl);
          if (sourceChanged) {
            void loadTemplates();
          }
          openTemplateDetail(
            templateIdOrSlug,
            message.payload && message.payload.versionId ? String(message.payload.versionId).trim() : undefined
          );
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
          statusElement.textContent = '安装失败：' + (message.payload && message.payload.message ? message.payload.message : '未知错误') + '。模板未写入本地，请确认安装位置后重试。';
        }
        renderTemplates();
      });

      function postTestProbeResult(requestId) {
        if (!requestId) {
          return;
        }
        vscode.postMessage({
          type: 'marketplace/testProbeResult',
          payload: {
            requestId: String(requestId),
            probe: collectTestProbe()
          }
        });
      }

      async function handleTestAction(requestId, action) {
        if (!requestId) {
          return;
        }
        try {
          await performTestAction(action);
          vscode.postMessage({
            type: 'marketplace/testActionResult',
            payload: {
              requestId: String(requestId),
              ok: true,
              probe: collectTestProbe()
            }
          });
        } catch (error) {
          vscode.postMessage({
            type: 'marketplace/testActionResult',
            payload: {
              requestId: String(requestId),
              ok: false,
              message: formatErrorMessage(error),
              probe: collectTestProbe()
            }
          });
        }
      }

      async function performTestAction(action) {
        const kind = action && typeof action.kind === 'string' ? action.kind : '';
        if (kind === 'search') {
          searchInput.value = typeof action.value === 'string' ? action.value : '';
          closeVersionMenus();
          persistState();
          await loadTemplates();
          return;
        }
        if (kind === 'sort') {
          sortSelect.value = typeof action.value === 'string' ? action.value : sortSelect.value;
          closeVersionMenus();
          persistState();
          await loadTemplates();
          return;
        }
        if (kind === 'openDetail') {
          const slug = readString(action && action.slug) || state.templates[0]?.slug;
          if (!slug) {
            throw new Error('缺少要打开的模板。');
          }
          openTemplateDetail(slug, readString(action.versionId));
          if (!state.templateDetailsBySlug[slug]) {
            await loadTemplateDetail(slug);
          }
          return;
        }
        if (kind === 'backToList') {
          closeTemplateDetail();
          return;
        }
        if (kind === 'toggleInstallVersionMenu' || kind === 'toggleDownloadVersionMenu') {
          const template = resolveTestActionTemplate(action);
          await toggleVersionMenu(template, kind === 'toggleDownloadVersionMenu' ? 'download' : 'install');
          return;
        }
        if (kind === 'clickOutside') {
          document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          return;
        }
        if (kind === 'installActiveVersion') {
          const template = resolveTestActionTemplate(action);
          const version = resolvePreferredDetailVersion(template, state.activeTemplateVersionId);
          await installTemplateVersion(template, version);
          return;
        }
        if (kind === 'publish') {
          publishTemplateButton.click();
          return;
        }
        throw new Error('不支持的模板市场测试动作：' + kind);
      }

      function resolveTestActionTemplate(action) {
        const slug = readString(action && action.slug) || state.activeTemplateSlug || state.templates[0]?.slug;
        const template = state.templateDetailsBySlug[slug] || state.templates.find((candidate) => candidate.slug === slug || candidate.id === slug);
        if (!template) {
          throw new Error('找不到测试动作目标模板：' + (slug || '未指定'));
        }
        return template;
      }

      function collectTestProbe() {
        const visibleTemplateNames = Array.from(templateGrid.querySelectorAll('.card-title, .offline-template-card h2'))
          .map((element) => element.textContent || '')
          .filter(Boolean);
        const versionMenuItems = Array.from(document.querySelectorAll('.version-menu-item, .version-menu-note'))
          .map((element) => element.textContent || '')
          .filter(Boolean);
        const buttonTexts = Array.from(document.querySelectorAll('button'))
          .map((element) => element.textContent || element.getAttribute('aria-label') || '')
          .filter(Boolean);
        return {
          view: state.activeTemplateSlug ? 'detail' : 'list',
          apiOrigin,
          marketplaceSourceUrl: state.marketplaceSourceUrl,
          statusText: statusElement.textContent || '',
          templateCount: state.templates.length,
          visibleTemplateNames,
          activeTemplateSlug: state.activeTemplateSlug,
          detailTitle: detailViewElement.querySelector('.detail-title')?.textContent || undefined,
          detailReadmeText: detailViewElement.querySelector('.detail-readme-body')?.textContent || undefined,
          hasVersionMenu: Boolean(document.querySelector('.version-menu')),
          versionMenuItems,
          installTargetLabels: Array.from(document.querySelectorAll('.install-target option'))
            .map((element) => element.textContent || '')
            .filter(Boolean),
          buttonTexts
        };
      }

      function postOpenInBrowserMessage() {
        vscode.postMessage({
          type: 'marketplace/openInBrowser',
          payload: {
            sourceUrl: buildMarketplaceBrowserUrl()
          }
        });
      }

      function setMarketplaceSourceUrl(value) {
        const nextSourceUrl = normalizeMarketplaceSourceUrl(value, apiOrigin);
        const nextApiOrigin = normalizeApiOrigin(nextSourceUrl, apiOrigin);
        if (!nextApiOrigin || nextApiOrigin === apiOrigin) {
          state.marketplaceSourceUrl = nextSourceUrl;
          return false;
        }
        apiOrigin = nextApiOrigin;
        state.apiOrigin = nextApiOrigin;
        state.marketplaceSourceUrl = nextSourceUrl;
        state.templates = [];
        state.storageMode = undefined;
        state.loadError = undefined;
        state.templateDetailsBySlug = {};
        state.detailLoadErrorsBySlug = {};
        state.versionMenuErrorsBySlug = {};
        return true;
      }

      function normalizeApiOrigin(value, fallback) {
        try {
          return new URL(String(value || '')).origin;
        } catch {
          try {
            return new URL(String(fallback || '')).origin;
          } catch {
            return '';
          }
        }
      }

      function normalizeMarketplaceSourceUrl(value, fallbackApiOrigin) {
        try {
          const url = new URL(String(value || ''));
          return url.toString();
        } catch {
          return new URL('/templates', fallbackApiOrigin || apiOrigin).toString();
        }
      }

      function buildMarketplaceBrowserUrl() {
        return state.activeTemplateSlug ? buildTemplateSourceUrl(state.activeTemplateSlug) : buildMarketplaceIndexUrl();
      }

      function buildMarketplaceIndexUrl() {
        return new URL('/templates', apiOrigin).toString();
      }

      function buildTemplateSourceUrl(templateSlug) {
        return new URL('/templates/' + encodeURIComponent(templateSlug), apiOrigin).toString();
      }

      async function loadTemplates() {
        const params = new URLSearchParams();
        const query = searchInput.value.trim();
        if (query) {
          params.set('q', query);
        }
        params.set('sort', sortSelect.value);
        statusElement.textContent = '正在加载...';
        try {
          const response = await fetch(apiOrigin + '/api/v1/templates?' + params.toString(), {
            headers: { accept: 'application/json' }
          });
          if (!response.ok) {
            throw new Error('HTTP ' + response.status);
          }
          const body = await response.json();
          state.templates = Array.isArray(body.items) ? body.items : [];
          state.storageMode = body.storageMode || 'unknown';
          state.loadError = undefined;
          refreshListStatus();
          renderTemplates();
        } catch (error) {
          const message = formatErrorMessage(error);
          state.loadError = message;
          refreshListStatus();
          renderTemplates();
        }
      }

      function refreshListStatus() {
        if (state.activeTemplateSlug) {
          return;
        }

        if (state.loadError) {
          statusElement.textContent = state.templates.length > 0
            ? '刷新失败，显示上次结果：' + state.loadError
            : '无法连接市场：' + state.loadError + '。已安装模板可从侧栏使用。';
          return;
        }

        statusElement.textContent = state.templates.length > 0
          ? '共 ' + state.templates.length + ' 个模板'
          : '没有匹配的模板，试试其他关键词。';
      }

      function renderTemplates() {
        if (state.activeTemplateSlug) {
          renderDetailView(state.activeTemplateSlug);
          return;
        }

        toolbarElement.hidden = false;
        templateGrid.hidden = false;
        detailViewElement.hidden = true;

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

      function renderDetailView(templateIdOrSlug) {
        toolbarElement.hidden = true;
        templateGrid.hidden = true;
        detailViewElement.hidden = false;

        const detailError = state.detailLoadErrorsBySlug[templateIdOrSlug];
        if (detailError) {
          detailViewElement.replaceChildren(buildDetailErrorShell(templateIdOrSlug, detailError));
          return;
        }

        const detail = state.templateDetailsBySlug[templateIdOrSlug];
        detailViewElement.replaceChildren(
          detail
            ? buildDetailShell(detail)
            : buildLoadingDetailShell(templateIdOrSlug)
        );
      }

      function renderLoadErrorCard() {
        const article = document.createElement('article');
        article.className = 'card notice-card';
        const title = document.createElement('h2');
        title.textContent = '无法连接市场';
        const body = document.createElement('p');
        body.textContent = '请检查网络连接或代理设置。已安装模板仍可从侧栏应用到画布。';
        const detail = document.createElement('p');
        detail.textContent = state.loadError ? '错误信息：' + state.loadError : '';
        const actions = document.createElement('div');
        actions.className = 'actions';
        const retryButton = document.createElement('button');
        retryButton.className = 'primary';
        retryButton.type = 'button';
        retryButton.textContent = '重试';
        retryButton.addEventListener('click', () => {
          void loadTemplates();
        });
        const browserButton = document.createElement('button');
        browserButton.className = 'secondary';
        browserButton.type = 'button';
        browserButton.textContent = '浏览器中打开';
        browserButton.addEventListener('click', () => {
          postOpenInBrowserMessage();
        });
        actions.append(retryButton, browserButton);
        article.append(title, body);
        if (detail.textContent) {
          article.append(detail);
        }
        article.append(actions);
        return article;
      }

      function buildLoadingDetailShell(templateIdOrSlug) {
        const shell = document.createElement('article');
        shell.className = 'detail-shell';

        const header = document.createElement('div');
        header.className = 'detail-header';

        const backButton = document.createElement('button');
        backButton.className = 'detail-back';
        backButton.type = 'button';
        backButton.textContent = '← 返回列表';
        backButton.addEventListener('click', closeTemplateDetail);

        const loadingTitle = document.createElement('h2');
        loadingTitle.className = 'detail-title';
        loadingTitle.textContent = '正在加载模板详情...';

        const loadingDescription = document.createElement('p');
        loadingDescription.className = 'detail-description';
        loadingDescription.textContent = '正在获取 ' + templateIdOrSlug + ' 的信息。';

        header.append(backButton, loadingTitle, loadingDescription);

        const loadingBody = document.createElement('div');
        loadingBody.className = 'detail-body';

        const loadingReadme = document.createElement('article');
        loadingReadme.className = 'detail-readme';
        const loadingReadmeTitle = document.createElement('h3');
        loadingReadmeTitle.className = 'detail-readme-title';
        loadingReadmeTitle.textContent = 'README';
        const loadingReadmeBody = document.createElement('div');
        loadingReadmeBody.className = 'detail-readme-body';
        loadingReadmeBody.textContent = '加载中...';
        loadingReadme.append(loadingReadmeTitle, loadingReadmeBody);

        const loadingSidebar = document.createElement('aside');
        loadingSidebar.className = 'detail-sidebar';
        const loadingSidebarBody = document.createElement('div');
        loadingSidebarBody.className = 'detail-section';
        const loadingSidebarTitle = document.createElement('h3');
        loadingSidebarTitle.className = 'detail-section-title';
        loadingSidebarTitle.textContent = '详情';
        const loadingSidebarText = document.createElement('p');
        loadingSidebarText.className = 'detail-section-body';
        loadingSidebarText.textContent = '加载完成后将显示安装、下载和版本信息。';
        loadingSidebarBody.append(loadingSidebarTitle, loadingSidebarText);
        loadingSidebar.append(loadingSidebarBody);

        loadingBody.append(loadingReadme, loadingSidebar);
        shell.append(header, loadingBody);
        return shell;
      }

      function buildDetailErrorShell(templateIdOrSlug, errorMessage) {
        const shell = document.createElement('article');
        shell.className = 'detail-shell';

        const header = document.createElement('div');
        header.className = 'detail-header';

        const backButton = document.createElement('button');
        backButton.className = 'detail-back';
        backButton.type = 'button';
        backButton.textContent = '← 返回列表';
        backButton.addEventListener('click', closeTemplateDetail);

        const title = document.createElement('h2');
        title.className = 'detail-title';
        title.textContent = '加载模板详情失败';

        const description = document.createElement('p');
        description.className = 'detail-description';
        description.textContent = '无法获取 ' + templateIdOrSlug + ' 的详情信息。';

        header.append(backButton, title, description);

        const body = document.createElement('div');
        body.className = 'detail-body';

        const readme = document.createElement('article');
        readme.className = 'detail-readme';
        const readmeTitle = document.createElement('h3');
        readmeTitle.className = 'detail-readme-title';
        readmeTitle.textContent = '错误信息';
        const readmeBody = document.createElement('div');
        readmeBody.className = 'detail-readme-body';
        readmeBody.textContent = errorMessage;
        readme.append(readmeTitle, readmeBody);

        const sidebar = document.createElement('aside');
        sidebar.className = 'detail-sidebar';
        const retryButton = document.createElement('button');
        retryButton.className = 'primary';
        retryButton.type = 'button';
        retryButton.textContent = '重试';
        retryButton.addEventListener('click', () => {
          delete state.detailLoadErrorsBySlug[templateIdOrSlug];
          renderTemplates();
          void loadTemplateDetail(templateIdOrSlug);
        });
        const backHint = document.createElement('p');
        backHint.className = 'detail-section-body';
        backHint.textContent = '多次失败时，可返回列表后重新打开。';
        sidebar.append(retryButton, backHint);

        body.append(readme, sidebar);
        shell.append(header, body);
        return shell;
      }

      function buildDetailShell(template) {
        const selectedVersion = resolvePreferredDetailVersion(template, state.activeTemplateVersionId);
        const shell = document.createElement('article');
        shell.className = 'detail-shell';

        const header = document.createElement('div');
        header.className = 'detail-header';

        const backButton = document.createElement('button');
        backButton.className = 'detail-back';
        backButton.type = 'button';
        backButton.textContent = '← 返回列表';
        backButton.addEventListener('click', closeTemplateDetail);

        const summary = document.createElement('div');
        summary.className = 'detail-summary';

        const thumbnail = document.createElement('div');
        thumbnail.className = 'detail-thumb';
        const thumbnailImage = document.createElement('img');
        thumbnailImage.src = buildTemplateThumbnailUrl(template);
        thumbnailImage.alt = '';
        thumbnailImage.loading = 'lazy';
        thumbnailImage.addEventListener('error', () => {
          thumbnailImage.remove();
        });
        thumbnail.append(thumbnailImage);

        const summaryBody = document.createElement('div');
        const title = document.createElement('h2');
        title.className = 'detail-title';
        title.textContent = template.name;

        const description = document.createElement('p');
        description.className = 'detail-description';
        description.textContent = template.description || '';

        const tags = document.createElement('div');
        tags.className = 'detail-tags';
        for (const tag of template.tags || []) {
          const tagElement = document.createElement('span');
          tagElement.className = 'tag';
          tagElement.textContent = '#' + tag;
          tags.append(tagElement);
        }

        summaryBody.append(title, description, tags);
        summary.append(thumbnail, summaryBody);
        header.append(backButton, summary);

        const body = document.createElement('div');
        body.className = 'detail-body';

        const readme = document.createElement('article');
        readme.className = 'detail-readme';
        const readmeTitle = document.createElement('h3');
        readmeTitle.className = 'detail-readme-title';
        readmeTitle.textContent = 'README';
        const readmeBody = document.createElement('div');
        readmeBody.className = 'detail-readme-body';
        readmeBody.textContent = (template.readme || '').trim() || '未提供 README。';
        readme.append(readmeTitle, readmeBody);

        const sidebar = document.createElement('aside');
        sidebar.className = 'detail-sidebar';

        const installedTemplate = findInstalledTemplate(template);

        const controls = document.createElement('div');
        controls.className = 'detail-controls';
        const installTargetRow = createInstallTargetSelectRow(template);
        const installButtonGroup = createInstallSplitButton(template, installedTemplate, selectedVersion.id);
        const downloadButtonGroup = createDownloadSplitButton(template, selectedVersion.id, {
          openDetailFirst: false
        });
        controls.append(installButtonGroup, downloadButtonGroup, installTargetRow);

        const metrics = document.createElement('dl');
        metrics.className = 'detail-metrics';
        metrics.append(
          createDetailMetricItem('Downloads', (template.downloadCount || 0).toLocaleString()),
          createDetailMetricItem('Likes', (template.likeCount || 0).toLocaleString()),
          createDetailMetricItem('Latest', 'v' + template.latestVersion.versionNumber)
        );

        const versionSection = document.createElement('section');
        versionSection.className = 'detail-section';
        const versionTitle = document.createElement('h3');
        versionTitle.className = 'detail-section-title';
        versionTitle.textContent = '版本历史';
        const versionBody = document.createElement('div');
        versionBody.className = 'detail-section-body';
        const versionList = document.createElement('ol');
        versionList.className = 'detail-version-list';
        for (const version of collectInstallableVersions(template)) {
          const item = document.createElement('li');
          item.className = 'detail-version-item';
          const row = document.createElement('div');
          row.className = 'detail-version-row';
          const label = document.createElement('span');
          label.textContent = 'v' + version.versionNumber;
          label.className = 'detail-version-label';
          const status = document.createElement('span');
          status.className = 'detail-version-status';
          const isSelectedVersion = selectedVersion.id === version.id;
          status.textContent = isSelectedVersion
            ? '当前'
            : version.status;
          row.append(label, status);
          const changelog = document.createElement('p');
          changelog.className = 'detail-version-changelog';
          changelog.textContent = version.changelog || '';
          item.append(row, changelog);
          versionList.append(item);
        }
        versionBody.append(versionList);
        versionSection.append(versionTitle, versionBody);

        const integritySection = document.createElement('section');
        integritySection.className = 'detail-section';
        const integrityTitle = document.createElement('h3');
        integrityTitle.className = 'detail-section-title';
        integrityTitle.textContent = '校验 · v' + selectedVersion.versionNumber;
        const integrityBody = document.createElement('div');
        integrityBody.className = 'detail-section-body';
        const integrityValue = document.createElement('p');
        integrityValue.className = 'detail-integrity-value';
        integrityValue.textContent = selectedVersion.sha256;
        integrityBody.append(integrityValue);
        integritySection.append(integrityTitle, integrityBody);

        const sourceSection = document.createElement('section');
        sourceSection.className = 'detail-section';
        const sourceTitle = document.createElement('h3');
        sourceTitle.className = 'detail-section-title';
        sourceTitle.textContent = '来源';
        const sourceBody = document.createElement('div');
        sourceBody.className = 'detail-section-body';
        const sourceText = document.createElement('p');
        sourceText.textContent = '来源：当前市场 API';
        sourceBody.append(sourceText);
        sourceSection.append(sourceTitle, sourceBody);

        sidebar.append(controls, metrics, versionSection, integritySection, sourceSection);
        body.append(readme, sidebar);
        shell.append(header, body);
        return shell;
      }

      function closeTemplateDetail() {
        if (!state.activeTemplateSlug) {
          return;
        }
        closeVersionMenus();
        state.activeTemplateSlug = undefined;
        state.activeTemplateVersionId = undefined;
        refreshListStatus();
        renderTemplates();
        window.scrollTo(0, 0);
      }

      function openTemplateDetail(templateIdOrSlug, versionId) {
        closeVersionMenus();
        state.activeTemplateSlug = templateIdOrSlug;
        state.activeTemplateVersionId = versionId;
        delete state.detailLoadErrorsBySlug[templateIdOrSlug];
        const cachedDetail = state.templateDetailsBySlug[templateIdOrSlug];
        statusElement.textContent = cachedDetail
          ? cachedDetail.name
          : '加载中：' + templateIdOrSlug;
        renderTemplates();
        if (!cachedDetail) {
          void loadTemplateDetail(templateIdOrSlug);
        }
        window.scrollTo(0, 0);
      }

      function createDetailMetricItem(label, value) {
        const item = document.createElement('div');
        item.className = 'detail-metric';
        const title = document.createElement('dt');
        title.textContent = label;
        const content = document.createElement('dd');
        content.textContent = value;
        item.append(title, content);
        return item;
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
        description.textContent = '已安装到' + formatInstalledTemplateLocationLabel(installedTemplate) + '，可在侧栏模板列表中应用到画布。';

        const badge = document.createElement('div');
        badge.className = 'installed-badge';
        badge.textContent = formatInstalledTemplateBadge(installedTemplate);

        const actions = document.createElement('div');
        actions.className = 'actions single-action';
        if (installedTemplate.sourceUrl) {
          const detailButton = document.createElement('button');
          detailButton.className = 'secondary detail-link';
          detailButton.type = 'button';
          detailButton.textContent = '在浏览器查看';
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
        detailButton.textContent = '查看详情';
        detailButton.addEventListener('click', () => {
          openTemplateDetail(template.slug, template.latestVersion.id);
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
        const installedBadge = document.createElement('div');
        installedBadge.className = 'installed-badge';
        installedBadge.textContent = installedTemplate
          ? formatInstalledTemplateBadge(installedTemplate)
          : '';

        const installTargetRow = createInstallTargetSelectRow(template);

        const actions = document.createElement('div');
        actions.className = 'actions';
        const installButtonGroup = createOpenDetailInstallButton(template, installedTemplate);
        const downloadButtonGroup = createDownloadSplitButton(template, undefined, {
          openDetailFirst: true
        });
        actions.append(installButtonGroup, downloadButtonGroup);

        article.append(thumb, titleRow, description, tags, meta);
        if (installedTemplate) {
          article.append(installedBadge);
        }
        article.append(installTargetRow);
        article.append(actions);
        return article;
      }

      function createOpenDetailInstallButton(template, installedTemplate) {
        const group = document.createElement('div');
        const isLatestVersionInstalled = Boolean(installedTemplate && installedTemplate.marketVersionId === template.latestVersion.id);
        group.className = isLatestVersionInstalled ? 'split-install' : 'split-install list-install';
        const installButton = document.createElement('button');
        installButton.className = 'primary split-primary';
        installButton.type = 'button';
        installButton.textContent = isLatestVersionInstalled
          ? '已安装 v' + installedTemplate.installedVersionNumber
          : installedTemplate
            ? '有新版本'
          : '查看详情';
        installButton.disabled = isLatestVersionInstalled;
        if (isLatestVersionInstalled) {
          installButton.classList.add('is-installed');
        }
        installButton.addEventListener('click', () => {
          openTemplateDetail(template.slug, template.latestVersion.id);
        });
        group.append(installButton);
        if (isLatestVersionInstalled) {
          const detailButton = document.createElement('button');
          detailButton.className = 'primary split-toggle';
          detailButton.type = 'button';
          detailButton.setAttribute('aria-label', '查看模板详情');
          detailButton.append(createDropdownChevronIcon());
          detailButton.addEventListener('click', () => {
            openTemplateDetail(template.slug, template.latestVersion.id);
          });
          group.append(detailButton);
        }
        return group;
      }

      function createDropdownChevronIcon() {
        const icon = document.createElement('span');
        icon.className = 'codicon codicon-chevron-down split-toggle-icon';
        icon.setAttribute('aria-hidden', 'true');
        return icon;
      }

      function createInstallSplitButton(template, installedTemplate, preferredVersionId) {
        const group = document.createElement('div');
        group.className = 'split-install';
        const installVersion = resolvePreferredDetailVersion(template, preferredVersionId);
        const isPreferredVersionInstalled = Boolean(
          installedTemplate && installedTemplate.marketVersionId === installVersion.id
        );
        const installButton = document.createElement('button');
        installButton.className = 'primary split-primary';
        installButton.type = 'button';
        let installButtonLabel = '安装';
        if (state.installingSlug === template.slug) {
          installButtonLabel = '安装中...';
        } else if (!resolveTemplateInstallTargetId(template)) {
          installButtonLabel = '请先选择位置';
        } else if (isPreferredVersionInstalled) {
          installButtonLabel = '已安装 v' + installedTemplate.installedVersionNumber;
        } else if (installedTemplate) {
          installButtonLabel = '更新到 v' + installVersion.versionNumber;
        } else if (installVersion.versionNumber === template.latestVersion.versionNumber) {
          installButtonLabel = '安装';
        } else {
          installButtonLabel = '安装 v' + installVersion.versionNumber;
        }
        installButton.textContent = installButtonLabel;
        installButton.disabled = state.installingSlug === template.slug || isPreferredVersionInstalled || !resolveTemplateInstallTargetId(template);
        if (isPreferredVersionInstalled) {
          installButton.classList.add('is-installed');
        }
        installButton.addEventListener('click', () => {
          closeVersionMenus();
          void installTemplateVersion(template, installVersion);
        });

        const versionButton = document.createElement('button');
        versionButton.className = 'primary split-toggle';
        versionButton.type = 'button';
        versionButton.setAttribute('aria-label', '切换安装版本');
        versionButton.append(createDropdownChevronIcon());
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

      function createDownloadSplitButton(template, preferredVersionId, options) {
        const openDetailFirst = Boolean(options && options.openDetailFirst);
        const group = document.createElement('div');
        group.className = 'split-install';
        const downloadVersion = resolvePreferredDetailVersion(template, preferredVersionId);
        const downloadButton = document.createElement('button');
        downloadButton.className = 'secondary split-primary';
        downloadButton.type = 'button';
        downloadButton.textContent = '下载 JSON';
        downloadButton.addEventListener('click', () => {
          closeVersionMenus();
          downloadTemplateVersion(template, downloadVersion, { openDetailFirst });
        });

        const versionButton = document.createElement('button');
        versionButton.className = 'secondary split-toggle';
        versionButton.type = 'button';
        versionButton.setAttribute('aria-label', '切换下载版本');
        versionButton.append(createDropdownChevronIcon());
        versionButton.addEventListener('click', () => {
          void toggleVersionMenu(template, 'download');
        });

        group.append(downloadButton, versionButton);
        if (state.openDownloadVersionMenuSlug === getTemplateInstallTargetKey(template)) {
          group.append(renderVersionMenu(template, 'download', { openDetailFirst }));
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

      function downloadTemplateVersion(template, version, options) {
        const targetVersion = version || template.latestVersion;
        const openDetailFirst = Boolean(options && options.openDetailFirst);
        state.openDownloadVersionMenuSlug = undefined;
        if (openDetailFirst) {
          openTemplateDetail(template.slug, targetVersion.id);
        } else if (state.activeTemplateSlug) {
          state.activeTemplateVersionId = targetVersion.id;
          renderTemplates();
        }
        window.open(buildTemplateDownloadUrl(template, targetVersion), '_blank', 'noopener');
      }

      function renderVersionMenu(template, action, options) {
        const openDetailFirst = action === 'download' && Boolean(options && options.openDetailFirst);
        const key = getTemplateInstallTargetKey(template);
        const menu = document.createElement('div');
        menu.className = 'version-menu';
        menu.setAttribute('role', 'menu');

        if (state.loadingVersionMenuSlug === key) {
          const note = document.createElement('div');
          note.className = 'version-menu-note';
          note.textContent = '正在加载版本列表...';
          menu.append(note);
          return menu;
        }

        const error = state.versionMenuErrorsBySlug[key];
        if (error) {
          const note = document.createElement('div');
          note.className = 'version-menu-note';
          note.textContent = '加载版本失败：' + error;
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
              downloadTemplateVersion(template, version, { openDetailFirst });
              return;
            }
            state.openInstallVersionMenuSlug = undefined;
            void installTemplateVersion(template, version);
          });
          menu.append(item);
        }
        return menu;
      }

      async function loadTemplateDetail(templateOrSlug) {
        const key = typeof templateOrSlug === 'string' ? templateOrSlug : templateOrSlug.slug;
        try {
          const response = await fetch(apiOrigin + '/api/v1/templates/' + encodeURIComponent(key), {
            headers: { accept: 'application/json' }
          });
          if (!response.ok) {
            throw new Error('HTTP ' + response.status);
          }
          const body = await response.json();
          if (!body || typeof body !== 'object' || !body.template) {
            throw new Error('接口返回了无法识别的数据');
          }
          state.templateDetailsBySlug[key] = body.template;
          delete state.detailLoadErrorsBySlug[key];
          delete state.versionMenuErrorsBySlug[key];
          if (state.activeTemplateSlug === key) {
            statusElement.textContent = body.template.name;
          }
        } catch (error) {
          const message = formatErrorMessage(error);
          state.detailLoadErrorsBySlug[key] = message;
          state.versionMenuErrorsBySlug[key] = message;
          if (state.activeTemplateSlug === key) {
            statusElement.textContent = '加载失败：' + message;
          }
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
              sourceUrl: buildTemplateSourceUrl(template.slug),
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
          statusElement.textContent = '安装失败：无法下载模板 JSON（' + formatErrorMessage(error) + '）。请检查网络后重试，或在详情页使用下载 JSON。';
          renderTemplates();
        }
      }

      function resolvePreferredDetailVersion(template, preferredVersionId) {
        const versions = collectInstallableVersions(template);
        if (preferredVersionId) {
          const preferredVersion = versions.find((version) => version.id === preferredVersionId);
          if (preferredVersion) {
            return preferredVersion;
          }
        }
        return versions[0] || template.latestVersion;
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

      function createInstallTargetSelectRow(template) {
        const row = document.createElement('div');
        row.className = 'install-target-row';
        const label = document.createElement('span');
        label.className = 'install-target-label';
        label.textContent = '安装位置';
        row.append(label, createInstallTargetSelect(template));
        return row;
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
          return '网络请求失败，可能无法访问模板市场 API 或代理阻断';
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
