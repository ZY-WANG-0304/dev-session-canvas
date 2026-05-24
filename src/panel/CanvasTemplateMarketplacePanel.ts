import * as vscode from 'vscode';

import {
  parseTrustedMarketplaceSourceUrl,
  TemplateMarketplaceClient,
  type TemplateMarketplaceInstallTargetSummary,
  type TemplateMarketplaceInstalledTemplateSummary,
  type TemplateMarketplaceInlineInstallParams,
  type TemplateMarketplacePublishDraft,
  type TemplateMarketplacePublishDraftRequest
} from './TemplateMarketplaceClient';
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
      type: 'marketplace/submitTemplatePublish';
      payload: TemplateMarketplacePublishDraftRequest;
    }
  | {
      type: 'marketplace/refreshInstalledTemplates';
    };

interface MarketplaceTemplateDetailRequest {
  templateIdOrSlug: string;
  versionId?: string;
  sourceUrl?: string;
  refreshList?: boolean;
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
    }
  | {
      type: 'marketplace/openTemplatePublishForm';
      payload: {
        drafts: TemplateMarketplacePublishDraft[];
        selectedTemplateId?: string;
        sourceUrl: string;
        error?: string;
      };
    }
  | {
      type: 'marketplace/templatePublishResult';
      payload:
        | {
            ok: true;
            templateName: string;
            slug: string;
            versionId: string;
            versionNumber: number;
            sourceUrl: string;
          }
        | {
            ok: false;
            message: string;
          };
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

  public openTemplateDetail(
    templateIdOrSlug: string,
    versionId?: string,
    sourceUrl?: URL,
    options: { refreshList?: boolean } = {}
  ): void {
    const resolvedSourceUrl = sourceUrl
      ? resolveCompatibleMarketplaceSourceUrl(sourceUrl, this.defaultMarketplaceSourceUrl)
      : undefined;
    if (resolvedSourceUrl) {
      this.marketplaceSourceUrl = resolvedSourceUrl;
    }
    this.pendingDetailRequest = {
      templateIdOrSlug,
      versionId,
      sourceUrl: resolvedSourceUrl?.toString(),
      refreshList: options.refreshList === true
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

  public openTemplatePublishForm(templateId?: string): void {
    this.revealPanel();
    void this.postOpenTemplatePublishForm(templateId);
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
        await this.postOpenTemplatePublishForm();
        return;
      case 'marketplace/submitTemplatePublish':
        await this.submitTemplatePublish(parsed.payload);
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

  private async postOpenTemplatePublishForm(templateId?: string): Promise<void> {
    this.revealPanel();
    if (!this.panel) {
      return;
    }
    try {
      const drafts = await this.marketplaceClient.listPublishableTemplateDrafts(templateId);
      await this.panel.webview.postMessage({
        type: 'marketplace/openTemplatePublishForm',
        payload: {
          drafts,
          selectedTemplateId: templateId,
          sourceUrl: this.marketplaceSourceUrl.toString()
        }
      } satisfies MarketplacePanelOutboundMessage);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.panel.webview.postMessage({
        type: 'marketplace/openTemplatePublishForm',
        payload: {
          drafts: [],
          selectedTemplateId: templateId,
          sourceUrl: this.marketplaceSourceUrl.toString(),
          error: message
        }
      } satisfies MarketplacePanelOutboundMessage);
      await vscode.window.showErrorMessage(`打开模板发布表单失败：${message}`);
    }
  }

  private async submitTemplatePublish(payload: TemplateMarketplacePublishDraftRequest): Promise<void> {
    try {
      const result = await this.marketplaceClient.publishTemplateDraft(payload);
      const detailSourceUrl = new URL(result.sourceUrl);
      this.marketplaceSourceUrl = resolveCompatibleMarketplaceSourceUrl(detailSourceUrl, this.defaultMarketplaceSourceUrl);
      await this.panel?.webview.postMessage({
        type: 'marketplace/templatePublishResult',
        payload: {
          ok: true,
          templateName: result.name,
          slug: result.slug,
          versionId: result.versionId,
          versionNumber: result.versionNumber,
          sourceUrl: result.sourceUrl
        }
      } satisfies MarketplacePanelOutboundMessage);
      await vscode.window.showInformationMessage(`模板“${result.name}”已发布到模板市场 v${result.versionNumber}。`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.panel?.webview.postMessage({
        type: 'marketplace/templatePublishResult',
        payload: {
          ok: false,
          message
        }
      } satisfies MarketplacePanelOutboundMessage);
      await vscode.window.showErrorMessage(`发布模板到市场失败：${message}`);
    }
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

  if (message.type === 'marketplace/submitTemplatePublish') {
    const payload = isRecord(message.payload) ? message.payload : null;
    if (
      !payload ||
      typeof payload.templateId !== 'string' ||
      typeof payload.name !== 'string' ||
      typeof payload.description !== 'string' ||
      typeof payload.templateJson !== 'string' ||
      !Array.isArray(payload.tags)
    ) {
      return null;
    }

    return {
      type: 'marketplace/submitTemplatePublish',
      payload: {
        templateId: payload.templateId,
        slug: readOptionalString(payload.slug),
        name: payload.name,
        description: payload.description,
        tags: payload.tags.filter((tag): tag is string => typeof tag === 'string'),
        readme: readOptionalString(payload.readme),
        changelog: readOptionalString(payload.changelog),
        templateJson: payload.templateJson
      }
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
        --error-bg: var(--vscode-inputValidation-errorBackground, color-mix(in srgb, var(--vscode-errorForeground, #f14c4c) 12%, transparent));
        --error-fg: var(--vscode-errorForeground, var(--fg));
        --error-border: var(--vscode-inputValidation-errorBorder, var(--vscode-errorForeground, var(--border)));
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
      select,
      textarea {
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
      select,
      textarea {
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
      textarea:focus,
      button:focus-visible {
        outline: 1px solid var(--focus);
        outline-offset: 2px;
      }

      textarea {
        min-height: 96px;
        padding: 6px 8px;
        resize: vertical;
        line-height: 1.5;
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
          "thumb title actions"
          "thumb description actions"
          "thumb publisher actions"
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
        object-fit: contain;
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

      .publisher,
      .detail-publisher {
        margin: 6px 0 0;
        color: var(--muted);
        font-size: 12px;
        line-height: 1.4;
      }

      .publisher {
        grid-area: publisher;
        margin: 0;
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
        align-self: start;
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
        align-self: start;
        display: grid;
        grid-template-columns: minmax(0, 1fr);
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
        opacity: 1;
      }

      .split-install.is-installed-split .primary {
        border: 1px solid var(--border);
        background: var(--secondary-bg);
        color: var(--secondary-fg);
      }

      .split-install.is-installed-split .primary:hover {
        background: var(--secondary-bg);
      }

      .split-install.is-installed-split .split-primary {
        border-right: 0;
      }

      .split-install.is-installed-split .split-toggle {
        margin-left: 0;
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
        object-fit: contain;
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

      .detail-tabs {
        display: flex;
        flex-wrap: wrap;
        gap: 2px;
        border-bottom: 1px solid var(--border);
        margin-bottom: 12px;
      }

      .detail-tab {
        min-height: 28px;
        border: 0;
        border-bottom: 2px solid transparent;
        border-radius: 0;
        padding: 0 10px;
        background: transparent;
        color: var(--muted);
        cursor: pointer;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }

      .detail-tab:hover {
        color: var(--fg);
      }

      .detail-tab[aria-selected="true"] {
        border-bottom-color: var(--focus);
        color: var(--fg);
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
        grid-template-columns: minmax(0, 1fr);
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

      .detail-changelog-body {
        margin-top: 12px;
      }

      .detail-changelog-list {
        display: grid;
        gap: 14px;
        margin: 0;
        padding: 0;
        list-style: none;
      }

      .detail-changelog-item {
        display: grid;
        gap: 6px;
        border-bottom: 1px solid var(--border);
        padding-bottom: 12px;
      }

      .detail-changelog-item:last-child {
        border-bottom: 0;
        padding-bottom: 0;
      }

      .detail-integrity-value {
        margin: 0;
        word-break: break-all;
      }

      .publish-view {
        max-width: 1180px;
        margin-top: 10px;
      }

      .publish-shell {
        border: 1px solid var(--border);
        background: var(--surface);
      }

      .publish-header {
        border-bottom: 1px solid var(--border);
        padding: 14px 16px;
      }

      .publish-body {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 18rem;
      }

      .publish-main,
      .publish-side {
        display: grid;
        gap: 14px;
        padding: 16px;
      }

      .publish-side {
        align-content: start;
        border-left: 1px solid var(--border);
        background: color-mix(in srgb, var(--surface) 78%, var(--bg));
      }

      .publish-section {
        display: grid;
        gap: 10px;
      }

      .publish-field-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
        align-items: start;
      }

      .publish-field {
        display: grid;
        grid-template-rows: 16px 28px 18px;
        gap: 5px;
        color: var(--fg);
        font-size: 12px;
        font-weight: 700;
      }

      .publish-field-label {
        min-height: 16px;
        line-height: 16px;
      }

      .publish-field input,
      .publish-field select,
      .publish-field textarea {
        min-width: 0;
      }

      .publish-field input,
      .publish-field select {
        min-height: 28px;
      }

      .publish-field-textarea {
        grid-template-rows: auto auto auto;
      }

      .publish-field-textarea .publish-field-label {
        line-height: 1.4;
      }

      .publish-field-textarea textarea {
        box-sizing: border-box;
        width: 100%;
        min-height: 112px;
        resize: vertical;
        line-height: 1.5;
      }

      .publish-field-textarea textarea.publish-readme {
        min-height: 140px;
      }

      .publish-field-textarea textarea.publish-changelog {
        min-height: 96px;
      }

      .publish-field-note {
        overflow: hidden;
        min-height: 18px;
      }

      .publish-help,
      .publish-message,
      .publish-field-note {
        margin: 0;
        color: var(--muted);
        font-size: 12px;
        line-height: 1.5;
      }

      .publish-field-note.is-ok {
        color: var(--vscode-testing-iconPassed, var(--muted));
      }

      .publish-field-note.is-error,
      .publish-message.is-error {
        color: var(--error-fg);
      }

      .publish-message {
        border: 1px solid var(--border);
        border-radius: 2px;
        padding: 8px 10px;
        background: var(--bg);
      }

      .publish-message.is-error {
        border-color: var(--error-border);
        background: var(--error-bg);
      }

      .publish-message.is-success {
        border-color: color-mix(in srgb, var(--focus) 44%, var(--border));
        background: color-mix(in srgb, var(--focus) 12%, transparent);
        color: var(--fg);
      }

      .publish-json {
        min-height: 220px;
        font-family: var(--vscode-editor-font-family, monospace);
        font-size: var(--vscode-editor-font-size, 12px);
      }

      .publish-thumbnail {
        display: block;
        width: 100%;
        aspect-ratio: 16 / 9;
        border: 1px solid var(--border);
        background: var(--bg);
        object-fit: contain;
      }

      .publish-actions {
        display: grid;
        gap: 8px;
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
            "thumb publisher"
            "thumb tags"
            "thumb meta"
            "thumb badge"
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

        .publish-body,
        .publish-field-grid {
          grid-template-columns: 1fr;
        }

        .publish-side {
          border-left: 0;
          border-top: 1px solid var(--border);
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
        <p class="panel-note">选择安装位置后可安装模板；进入详情页可查看 README、CHANGELOG 和版本历史。</p>
      </section>

      <section class="toolbar" id="marketplaceToolbar" aria-label="模板市场筛选">
        <input id="searchInput" type="search" placeholder="搜索模板名称、标签或关键词..." />
        <select id="sortSelect" aria-label="排序">
          <option value="hot">热度</option>
          <option value="downloads">下载</option>
          <option value="likes">点赞</option>
          <option value="newest">最新</option>
          <option value="updated">最近更新</option>
        </select>
      </section>

      <p class="status" id="status">正在加载...</p>
      <section class="grid" id="templateGrid" aria-label="模板列表"></section>
      <section class="detail-view" id="detailView" aria-label="模板详情" hidden></section>
      <section class="publish-view" id="publishView" aria-label="发布模板" hidden></section>
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
        activeView: 'list',
        activeTemplateSlug: undefined,
        activeTemplateVersionId: undefined,
        activeDetailTab: 'readme',
        publishDrafts: [],
        activePublishTemplateId: undefined,
        publishForm: undefined,
        publishStatus: { kind: 'idle' },
        publishSlugCheck: { kind: 'idle' },
        publishFieldErrors: {},
        publishingTemplate: false,
        publishedTemplate: undefined,
        publishSlugCheckTimer: undefined,
        openInstallVersionMenuSlug: undefined,
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
      const publishViewElement = document.getElementById('publishView');
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
          setMarketplaceSourceUrl(message.payload && message.payload.sourceUrl);
          showTemplateList();
          void loadTemplates();
          return;
        }

        if (message.type === 'marketplace/openTemplateDetail') {
          const templateIdOrSlug = message.payload && message.payload.templateIdOrSlug ? String(message.payload.templateIdOrSlug).trim() : '';
          if (!templateIdOrSlug) {
            return;
          }
          const sourceChanged = setMarketplaceSourceUrl(message.payload && message.payload.sourceUrl);
          if (sourceChanged || Boolean(message.payload && message.payload.refreshList)) {
            void loadTemplates();
          }
          openTemplateDetail(
            templateIdOrSlug,
            message.payload && message.payload.versionId ? String(message.payload.versionId).trim() : undefined
          );
          return;
        }

        if (message.type === 'marketplace/openTemplatePublishForm') {
          const sourceChanged = setMarketplaceSourceUrl(message.payload && message.payload.sourceUrl);
          if (sourceChanged) {
            void loadTemplates();
          }
          openTemplatePublishForm(
            Array.isArray(message.payload && message.payload.drafts) ? message.payload.drafts : [],
            message.payload && message.payload.selectedTemplateId ? String(message.payload.selectedTemplateId) : undefined,
            message.payload && message.payload.error ? String(message.payload.error) : undefined
          );
          return;
        }

        if (message.type === 'marketplace/templatePublishResult') {
          state.publishingTemplate = false;
          if (message.payload && message.payload.ok) {
            state.publishedTemplate = {
              name: message.payload.templateName,
              slug: message.payload.slug,
              versionId: message.payload.versionId,
              versionNumber: message.payload.versionNumber,
              sourceUrl: message.payload.sourceUrl
            };
            state.publishStatus = {
              kind: 'success',
              message: '模板“' + message.payload.templateName + '”已发布到模板市场 v' + message.payload.versionNumber + '。'
            };
            searchInput.value = '';
            sortSelect.value = 'updated';
            persistState();
            void loadTemplates();
          } else {
            state.publishStatus = {
              kind: 'error',
              message: '发布失败：' + (message.payload && message.payload.message ? message.payload.message : '未知错误')
            };
          }
          renderTemplates();
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
        if (kind === 'selectDetailTab') {
          setDetailTab(readString(action && action.tab));
          return;
        }
        if (kind === 'toggleInstallVersionMenu') {
          const template = resolveTestActionTemplate(action);
          await toggleVersionMenu(template);
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
        if (kind === 'fillPublishForm') {
          if (state.activeView !== 'publish' || !state.publishForm) {
            throw new Error('发布表单尚未打开。');
          }
          const fields = action && typeof action.fields === 'object' && action.fields ? action.fields : {};
          for (const field of ['name', 'slug', 'description', 'tags', 'readme', 'changelog', 'templateJson']) {
            if (typeof fields[field] === 'string') {
              updatePublishField(field, fields[field]);
            }
          }
          await flushPublishSlugCheckForTest();
          renderTemplates();
          return;
        }
        if (kind === 'submitPublishForm') {
          if (state.activeView !== 'publish' || !state.publishForm) {
            throw new Error('发布表单尚未打开。');
          }
          submitPublishForm();
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
          view: state.activeView === 'publish' ? 'publish' : state.activeTemplateSlug ? 'detail' : 'list',
          apiOrigin,
          marketplaceSourceUrl: state.marketplaceSourceUrl,
          statusText: statusElement.textContent || '',
          templateCount: state.templates.length,
          visibleTemplateNames,
          activeTemplateSlug: state.activeTemplateSlug,
          activeDetailTab: state.activeDetailTab,
          detailTitle: detailViewElement.querySelector('.detail-title')?.textContent || undefined,
          detailReadmeText: detailViewElement.querySelector('.detail-readme-body')?.textContent || undefined,
          detailChangelogText: detailViewElement.querySelector('.detail-changelog-body')?.textContent || undefined,
          hasVersionMenu: Boolean(document.querySelector('.version-menu')),
          versionMenuItems,
          publisherTexts: Array.from(document.querySelectorAll('.publisher, .detail-publisher'))
            .map((element) => element.textContent || '')
            .filter(Boolean),
          installTargetLabels: Array.from(document.querySelectorAll('.install-target option'))
            .map((element) => element.textContent || '')
            .filter(Boolean),
          buttonTexts,
          publishTemplateNames: state.publishDrafts.map((draft) => draft.templateName),
          publishSelectedTemplateId: state.activePublishTemplateId,
          publishForm: state.publishForm ? { ...state.publishForm } : undefined,
          publishStatusText: state.publishStatus && state.publishStatus.message ? state.publishStatus.message : '',
          publishSlugCheckText: formatPublishSlugCheckMessage(),
          publishedTemplate: state.publishedTemplate ? { ...state.publishedTemplate } : undefined
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
        if (state.activeView !== 'list') {
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
        if (state.activeView === 'publish') {
          renderPublishView();
          return;
        }

        if (state.activeTemplateSlug) {
          renderDetailView(state.activeTemplateSlug);
          return;
        }

        toolbarElement.hidden = false;
        templateGrid.hidden = false;
        detailViewElement.hidden = true;
        publishViewElement.hidden = true;

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
        publishViewElement.hidden = true;

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

      function renderPublishView() {
        toolbarElement.hidden = true;
        templateGrid.hidden = true;
        detailViewElement.hidden = true;
        publishViewElement.hidden = false;
        statusElement.textContent = state.publishStatus.message || '发布前请确认模板名称、Slug、描述、README、CHANGELOG 和模板 JSON。';

        if (state.publishedTemplate) {
          publishViewElement.replaceChildren(buildPublishSuccessShell(state.publishedTemplate));
          return;
        }

        publishViewElement.replaceChildren(buildPublishFormShell());
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

      function openTemplatePublishForm(drafts, selectedTemplateId, errorMessage) {
        closeVersionMenus(false);
        state.activeView = 'publish';
        state.activeTemplateSlug = undefined;
        state.activeTemplateVersionId = undefined;
        state.activeDetailTab = 'readme';
        state.publishDrafts = normalizePublishDrafts(drafts);
        state.publishedTemplate = undefined;
        state.publishingTemplate = false;
        state.publishFieldErrors = {};
        state.publishStatus = errorMessage
          ? { kind: 'error', message: '无法打开发布表单：' + errorMessage }
          : { kind: 'idle' };
        const selectedDraft = selectPublishDraftById(selectedTemplateId) || state.publishDrafts[0];
        state.activePublishTemplateId = selectedDraft ? selectedDraft.templateId : undefined;
        state.publishForm = selectedDraft ? buildPublishFormState(selectedDraft) : undefined;
        schedulePublishSlugCheck();
        renderTemplates();
        window.scrollTo(0, 0);
      }

      function buildPublishFormShell() {
        const shell = document.createElement('article');
        shell.className = 'publish-shell';

        const header = document.createElement('div');
        header.className = 'publish-header';
        const backButton = document.createElement('button');
        backButton.className = 'detail-back';
        backButton.type = 'button';
        backButton.textContent = '← 返回列表';
        backButton.addEventListener('click', () => {
          showTemplateList();
          void loadTemplates();
        });
        const title = document.createElement('h2');
        title.className = 'detail-title';
        title.textContent = '发布自建模板';
        const description = document.createElement('p');
        description.className = 'detail-description';
        description.textContent = '先选择已保存的本地模板，再确认公开展示内容，最后提交到当前模板市场。';
        header.append(backButton, title, description);

        if (!state.publishForm) {
          const emptyBody = document.createElement('div');
          emptyBody.className = 'publish-main';
          const message = document.createElement('p');
          message.className = 'publish-message is-error';
          message.textContent = state.publishStatus.message || '当前没有可发布的自建模板。请先在 VSCode 中保存一个自建模板。';
          emptyBody.append(message);
          shell.append(header, emptyBody);
          return shell;
        }

        const form = document.createElement('form');
        form.className = 'publish-body';
        form.noValidate = true;
        form.addEventListener('submit', (event) => {
          event.preventDefault();
          submitPublishForm();
        });
        form.addEventListener('keydown', (event) => {
          const target = event.target;
          if (event.key === 'Enter' && target instanceof HTMLInputElement && target.type !== 'submit') {
            event.preventDefault();
          }
        });

        const main = document.createElement('div');
        main.className = 'publish-main';

        const templateSection = document.createElement('section');
        templateSection.className = 'publish-section';
        const templateLabel = document.createElement('label');
        templateLabel.className = 'publish-field';
        templateLabel.textContent = '本地模板';
        const templateSelect = document.createElement('select');
        templateSelect.id = 'publishTemplateSelect';
        templateSelect.value = state.activePublishTemplateId || '';
        for (const draft of state.publishDrafts) {
          const option = document.createElement('option');
          option.value = draft.templateId;
          option.textContent = draft.templateName + ' · ' + draft.nodeCount + ' 个节点' + (draft.storageLocationLabel ? ' · ' + draft.storageLocationLabel : '');
          templateSelect.append(option);
        }
        templateSelect.addEventListener('change', () => {
          switchPublishDraft(templateSelect.value);
        });
        templateLabel.append(templateSelect);
        const templateHelp = document.createElement('p');
        templateHelp.className = 'publish-help';
        templateHelp.textContent = '这里不会直接写入市场；提交前可以编辑市场内容和 JSON 预览。';
        templateSection.append(templateLabel, templateHelp);

        const detailSection = document.createElement('section');
        detailSection.className = 'publish-section';
        const detailGrid = document.createElement('div');
        detailGrid.className = 'publish-field-grid';
        detailGrid.append(
          createPublishInput('name', '名称', state.publishForm.name, { required: true, reserveNote: true }),
          createPublishInput('slug', 'Slug', state.publishForm.slug, {
            noteId: 'publishSlugCheck',
            note: formatPublishSlugCheckMessage(),
            noteKind: state.publishSlugCheck.kind === 'available' ? 'ok' : isPublishSlugCheckBlocking() ? 'error' : undefined
          })
        );
        detailSection.append(detailGrid);
        detailSection.append(
          createPublishInput('description', '描述', state.publishForm.description, { required: true }),
          createPublishInput('tags', '标签', state.publishForm.tags, { placeholder: 'review, quality, agent' })
        );

        const contentSection = document.createElement('section');
        contentSection.className = 'publish-section';
        contentSection.append(
          createPublishTextarea('readme', 'README', state.publishForm.readme, {
            className: 'publish-readme',
            rows: 7
          }),
          createPublishTextarea('changelog', 'CHANGELOG', state.publishForm.changelog, {
            className: 'publish-changelog',
            rows: 5
          }),
          createPublishTextarea('templateJson', 'Template JSON Preview', state.publishForm.templateJson, {
            className: 'publish-json',
            rows: 10,
            note: state.publishFieldErrors.templateJson
          })
        );

        main.append(templateSection, detailSection, contentSection);

        const side = document.createElement('aside');
        side.className = 'publish-side';
        const sideTitle = document.createElement('h3');
        sideTitle.className = 'detail-section-title';
        sideTitle.textContent = '预览与确认';
        const thumbnail = document.createElement('img');
        thumbnail.className = 'publish-thumbnail';
        thumbnail.alt = '自动生成的模板缩略图';
        thumbnail.src = toPngPreviewSrc(state.publishForm.thumbnailPngBase64);

        const stats = document.createElement('dl');
        stats.className = 'detail-metrics';
        const activeDraft = getActivePublishDraft();
        stats.append(
          createDetailMetricItem('节点', String(activeDraft ? activeDraft.nodeCount : 0)),
          createDetailMetricItem('位置', activeDraft?.storageLocationLabel || '本地模板')
        );

        const actions = document.createElement('div');
        actions.className = 'publish-actions';
        const submitButton = document.createElement('button');
        submitButton.className = 'primary';
        submitButton.type = 'submit';
        submitButton.textContent = state.publishingTemplate ? '发布中...' : '确认发布';
        submitButton.disabled = state.publishingTemplate;
        actions.append(submitButton);

        const statusMessage = buildPublishStatusMessage();
        side.append(sideTitle, thumbnail, stats, actions);
        if (statusMessage) {
          side.append(statusMessage);
        }

        form.append(main, side);
        shell.append(header, form);
        return shell;
      }

      function buildPublishSuccessShell(publishedTemplate) {
        const shell = document.createElement('article');
        shell.className = 'publish-shell';
        const header = document.createElement('div');
        header.className = 'publish-header';
        const title = document.createElement('h2');
        title.className = 'detail-title';
        title.textContent = '发布成功';
        const description = document.createElement('p');
        description.className = 'detail-description';
        description.textContent = '模板“' + publishedTemplate.name + '”已发布到当前模板市场。';
        header.append(title, description);

        const body = document.createElement('div');
        body.className = 'publish-main';
        const message = document.createElement('p');
        message.className = 'publish-message is-success';
        message.textContent = '你可以继续查看详情，或返回列表确认新模板已经出现在市场中。';
        const actions = document.createElement('div');
        actions.className = 'publish-actions';
        const detailButton = document.createElement('button');
        detailButton.className = 'primary';
        detailButton.type = 'button';
        detailButton.textContent = '查看模板详情';
        detailButton.addEventListener('click', () => {
          openTemplateDetail(publishedTemplate.slug, publishedTemplate.versionId);
          void loadTemplateDetail(publishedTemplate.slug);
        });
        const listButton = document.createElement('button');
        listButton.className = 'secondary';
        listButton.type = 'button';
        listButton.textContent = '返回市场列表';
        listButton.addEventListener('click', () => {
          showTemplateList();
          void loadTemplates();
        });
        actions.append(detailButton, listButton);
        body.append(message, actions);
        shell.append(header, body);
        return shell;
      }

      function createPublishInput(field, label, value, options = {}) {
        const wrapper = document.createElement('label');
        wrapper.className = 'publish-field';
        const labelText = document.createElement('span');
        labelText.className = 'publish-field-label';
        labelText.textContent = label;
        const input = document.createElement('input');
        input.value = value || '';
        input.required = options.required === true;
        input.placeholder = options.placeholder || '';
        input.addEventListener('input', () => {
          updatePublishField(field, input.value);
        });
        wrapper.append(labelText, input);
        const noteText = options.note || state.publishFieldErrors[field];
        if (options.noteId || options.reserveNote === true || noteText) {
          const note = document.createElement('p');
          note.className = 'publish-field-note' + (options.noteKind === 'ok' ? ' is-ok' : options.noteKind === 'error' ? ' is-error' : '');
          if (options.noteId) {
            note.id = options.noteId;
          }
          note.textContent = noteText || '';
          wrapper.append(note);
        }
        return wrapper;
      }

      function createPublishTextarea(field, label, value, options = {}) {
        const wrapper = document.createElement('label');
        wrapper.className = 'publish-field publish-field-textarea';
        const labelText = document.createElement('span');
        labelText.className = 'publish-field-label';
        labelText.textContent = label;
        const textarea = document.createElement('textarea');
        textarea.value = value || '';
        textarea.rows = options.rows || 4;
        if (options.className) {
          textarea.classList.add(options.className);
        }
        textarea.addEventListener('input', () => {
          updatePublishField(field, textarea.value);
        });
        wrapper.append(labelText, textarea);
        const noteText = options.note || state.publishFieldErrors[field];
        if (noteText) {
          const note = document.createElement('p');
          note.className = 'publish-field-note is-error';
          note.textContent = noteText;
          wrapper.append(note);
        }
        return wrapper;
      }

      function buildPublishStatusMessage() {
        if (!state.publishStatus || state.publishStatus.kind === 'idle' || !state.publishStatus.message) {
          return undefined;
        }
        const message = document.createElement('p');
        message.className = 'publish-message'
          + (state.publishStatus.kind === 'error' ? ' is-error' : '')
          + (state.publishStatus.kind === 'success' ? ' is-success' : '');
        message.textContent = state.publishStatus.message;
        return message;
      }

      function submitPublishForm() {
        if (!state.publishForm || state.publishingTemplate) {
          return;
        }
        if (!validatePublishForm()) {
          renderTemplates();
          return;
        }
        state.publishingTemplate = true;
        state.publishStatus = { kind: 'loading', message: '正在发布模板...' };
        renderTemplates();
        vscode.postMessage({
          type: 'marketplace/submitTemplatePublish',
          payload: {
            templateId: state.activePublishTemplateId,
            slug: state.publishForm.slug.trim() || undefined,
            name: state.publishForm.name,
            description: state.publishForm.description,
            tags: parsePublishTags(state.publishForm.tags),
            readme: state.publishForm.readme,
            changelog: state.publishForm.changelog,
            templateJson: state.publishForm.templateJson
          }
        });
      }

      function validatePublishForm() {
        state.publishFieldErrors = {};
        state.publishStatus = { kind: 'idle' };
        if (!state.activePublishTemplateId) {
          state.publishStatus = { kind: 'error', message: '请选择要发布的本地模板。' };
          return false;
        }
        if (!state.publishForm.name.trim()) {
          state.publishStatus = { kind: 'error', message: '名称不能为空。' };
          return false;
        }
        if (!state.publishForm.description.trim()) {
          state.publishStatus = { kind: 'error', message: '描述不能为空。' };
          return false;
        }
        const slug = state.publishForm.slug.trim();
        if (slug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
          state.publishStatus = { kind: 'error', message: 'Slug 只能使用小写单词和连字符。' };
          state.publishSlugCheck = { kind: 'invalid', message: 'Slug 只能使用小写单词和连字符。' };
          return false;
        }
        if (isPublishSlugCheckBlocking()) {
          state.publishStatus = { kind: 'error', message: '请先解决 Slug 唯一性问题。' };
          return false;
        }
        try {
          JSON.parse(state.publishForm.templateJson);
        } catch {
          state.publishFieldErrors.templateJson = 'Template JSON 不是合法 JSON。';
          state.publishStatus = { kind: 'error', message: '请修正 Template JSON 后再发布。' };
          return false;
        }
        return true;
      }

      function updatePublishField(field, value) {
        if (!state.publishForm) {
          return;
        }
        state.publishForm[field] = value;
        state.publishStatus = { kind: 'idle' };
        if (state.publishFieldErrors[field]) {
          delete state.publishFieldErrors[field];
        }
        if (field === 'slug') {
          schedulePublishSlugCheck();
        }
      }

      function switchPublishDraft(templateId) {
        const draft = selectPublishDraftById(templateId);
        if (!draft) {
          return;
        }
        state.activePublishTemplateId = draft.templateId;
        state.publishForm = buildPublishFormState(draft);
        state.publishFieldErrors = {};
        state.publishStatus = { kind: 'idle' };
        state.publishedTemplate = undefined;
        schedulePublishSlugCheck();
        renderTemplates();
      }

      function schedulePublishSlugCheck() {
        if (state.publishSlugCheckTimer) {
          window.clearTimeout(state.publishSlugCheckTimer);
          state.publishSlugCheckTimer = undefined;
        }
        const slug = state.publishForm ? state.publishForm.slug.trim() : '';
        if (!slug) {
          state.publishSlugCheck = { kind: 'idle' };
          return;
        }
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
          state.publishSlugCheck = { kind: 'invalid', message: 'Slug 只能使用小写单词和连字符。' };
          return;
        }
        state.publishSlugCheck = { kind: 'checking', message: '正在检查 Slug 是否可用...' };
        state.publishSlugCheckTimer = window.setTimeout(() => {
          void checkPublishSlugAvailability(slug);
        }, 300);
      }

      async function checkPublishSlugAvailability(slug) {
        try {
          const params = new URLSearchParams();
          params.set('slug', slug);
          const response = await fetch(apiOrigin + '/api/v1/templates/slug-availability?' + params.toString(), {
            headers: { accept: 'application/json' }
          });
          const body = await response.json();
          if (!response.ok) {
            throw new Error(body && body.error && body.error.message ? body.error.message : 'HTTP ' + response.status);
          }
          if (!state.publishForm || state.publishForm.slug.trim() !== slug) {
            return;
          }
          state.publishSlugCheck = body.available
            ? { kind: 'available', message: 'Slug 可用。' }
            : { kind: 'unavailable', message: 'Slug 已被其他模板使用。' };
        } catch (error) {
          if (!state.publishForm || state.publishForm.slug.trim() !== slug) {
            return;
          }
          state.publishSlugCheck = { kind: 'error', message: formatErrorMessage(error) };
        }
        if (state.activeView === 'publish' && !state.publishingTemplate && !state.publishedTemplate) {
          renderTemplates();
        }
      }

      async function flushPublishSlugCheckForTest() {
        const slug = state.publishForm ? state.publishForm.slug.trim() : '';
        if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
          return;
        }
        if (state.publishSlugCheckTimer) {
          window.clearTimeout(state.publishSlugCheckTimer);
          state.publishSlugCheckTimer = undefined;
        }
        await checkPublishSlugAvailability(slug);
      }

      function formatPublishSlugCheckMessage() {
        return state.publishSlugCheck && state.publishSlugCheck.message ? state.publishSlugCheck.message : '';
      }

      function isPublishSlugCheckBlocking() {
        return state.publishSlugCheck.kind === 'invalid' || state.publishSlugCheck.kind === 'unavailable' || state.publishSlugCheck.kind === 'checking';
      }

      function buildPublishFormState(draft) {
        return {
          name: draft.defaultName || draft.templateName || '',
          slug: draft.defaultSlug || '',
          description: draft.defaultDescription || '',
          tags: Array.isArray(draft.defaultTags) ? draft.defaultTags.join(', ') : '',
          readme: draft.defaultReadme || '',
          changelog: draft.defaultChangelog || '',
          templateJson: draft.templateJson || '',
          thumbnailPngBase64: draft.thumbnailPngBase64 || ''
        };
      }

      function normalizePublishDrafts(drafts) {
        return drafts
          .filter((draft) => draft && typeof draft.templateId === 'string')
          .map((draft) => ({
            templateId: String(draft.templateId),
            templateName: String(draft.templateName || draft.defaultName || draft.templateId),
            storageLocationLabel: readString(draft.storageLocationLabel),
            nodeCount: typeof draft.nodeCount === 'number' && Number.isFinite(draft.nodeCount) ? draft.nodeCount : 0,
            defaultName: String(draft.defaultName || draft.templateName || ''),
            defaultSlug: String(draft.defaultSlug || ''),
            defaultDescription: String(draft.defaultDescription || ''),
            defaultTags: Array.isArray(draft.defaultTags) ? draft.defaultTags.filter((tag) => typeof tag === 'string') : [],
            defaultReadme: String(draft.defaultReadme || ''),
            defaultChangelog: String(draft.defaultChangelog || ''),
            templateJson: String(draft.templateJson || ''),
            thumbnailPngBase64: String(draft.thumbnailPngBase64 || '')
          }));
      }

      function selectPublishDraftById(templateId) {
        return state.publishDrafts.find((draft) => draft.templateId === templateId);
      }

      function getActivePublishDraft() {
        return selectPublishDraftById(state.activePublishTemplateId);
      }

      function parsePublishTags(value) {
        return String(value || '')
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean);
      }

      function toPngPreviewSrc(value) {
        const normalized = String(value || '');
        return normalized.startsWith('data:') ? normalized : 'data:image/png;base64,' + normalized;
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
        loadingSidebarText.textContent = '加载完成后将显示安装位置、安装和版本信息。';
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

        const publisher = document.createElement('p');
        publisher.className = 'detail-publisher';
        publisher.textContent = formatTemplatePublisherLabel(template);

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

        summaryBody.append(title, publisher, description, tags);
        summary.append(thumbnail, summaryBody);
        header.append(backButton, summary);

        const body = document.createElement('div');
        body.className = 'detail-body';

        const detailContent = document.createElement('article');
        detailContent.className = 'detail-readme';
        const activeDetailTab = normalizeDetailTab(state.activeDetailTab);
        detailContent.append(createDetailTabs(activeDetailTab), createDetailTabPanel(template, activeDetailTab, selectedVersion));

        const sidebar = document.createElement('aside');
        sidebar.className = 'detail-sidebar';

        const installedTemplate = findInstalledTemplate(template);

        const controls = document.createElement('div');
        controls.className = 'detail-controls';
        const installTargetRow = createInstallTargetSelectRow(template);
        const installButtonGroup = createInstallSplitButton(template, installedTemplate, selectedVersion.id);
        controls.append(installTargetRow, installButtonGroup);

        const metrics = document.createElement('dl');
        metrics.className = 'detail-metrics';
        metrics.append(
          createDetailMetricItem('下载', (template.downloadCount || 0).toLocaleString()),
          createDetailMetricItem('点赞', (template.likeCount || 0).toLocaleString()),
          createDetailMetricItem('最新版本', 'v' + template.latestVersion.versionNumber)
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

        sidebar.append(controls, metrics, versionSection);
        body.append(detailContent, sidebar);
        shell.append(header, body);
        return shell;
      }

      function createDetailTabs(activeTab) {
        const tabs = document.createElement('div');
        tabs.className = 'detail-tabs';
        tabs.setAttribute('role', 'tablist');
        tabs.setAttribute('aria-label', '模板详情内容');
        tabs.append(
          createDetailTabButton('readme', 'README', activeTab),
          createDetailTabButton('changelog', 'CHANGELOG', activeTab)
        );
        return tabs;
      }

      function createDetailTabButton(tab, label, activeTab) {
        const button = document.createElement('button');
        const isActive = activeTab === tab;
        button.className = 'detail-tab';
        button.type = 'button';
        button.id = 'detail-tab-' + tab;
        button.setAttribute('role', 'tab');
        button.setAttribute('aria-selected', String(isActive));
        button.setAttribute('aria-controls', 'detail-panel-' + tab);
        button.textContent = label;
        button.addEventListener('click', () => {
          setDetailTab(tab);
        });
        return button;
      }

      function createDetailTabPanel(template, activeTab, selectedVersion) {
        const panel = document.createElement('div');
        panel.id = 'detail-panel-' + activeTab;
        panel.setAttribute('role', 'tabpanel');
        panel.setAttribute('aria-labelledby', 'detail-tab-' + activeTab);

        const title = document.createElement('h3');
        title.className = 'detail-readme-title';
        title.textContent = activeTab === 'changelog' ? 'CHANGELOG' : 'README';
        panel.append(title);

        if (activeTab === 'changelog') {
          panel.append(createDetailChangelogBody(template, selectedVersion));
          return panel;
        }

        const readmeBody = document.createElement('div');
        readmeBody.className = 'detail-readme-body';
        readmeBody.textContent = (template.readme || '').trim() || '未提供 README。';
        panel.append(readmeBody);
        return panel;
      }

      function createDetailChangelogBody(template, selectedVersion) {
        const changelogBody = document.createElement('div');
        changelogBody.className = 'detail-changelog-body';
        const versions = collectInstallableVersions(template);
        if (versions.length === 0) {
          changelogBody.textContent = '未提供 CHANGELOG。';
          return changelogBody;
        }

        const list = document.createElement('ol');
        list.className = 'detail-changelog-list';
        for (const version of versions) {
          const item = document.createElement('li');
          item.className = 'detail-changelog-item';
          const row = document.createElement('div');
          row.className = 'detail-version-row';
          const label = document.createElement('span');
          label.className = 'detail-version-label';
          label.textContent = 'v' + version.versionNumber;
          const status = document.createElement('span');
          status.className = 'detail-version-status';
          status.textContent = selectedVersion && selectedVersion.id === version.id ? '当前' : version.status;
          row.append(label, status);

          const changelog = document.createElement('p');
          changelog.className = 'detail-version-changelog';
          changelog.textContent = version.changelog || '未提供该版本 CHANGELOG。';
          item.append(row, changelog);
          list.append(item);
        }
        changelogBody.append(list);
        return changelogBody;
      }

      function closeTemplateDetail() {
        showTemplateList();
      }

      function openTemplateDetail(templateIdOrSlug, versionId) {
        closeVersionMenus();
        state.activeView = 'detail';
        state.activeTemplateSlug = templateIdOrSlug;
        state.activeTemplateVersionId = versionId;
        state.activeDetailTab = 'readme';
        state.activePublishTemplateId = undefined;
        state.publishedTemplate = undefined;
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

      function showTemplateList() {
        closeVersionMenus(false);
        state.activeView = 'list';
        state.activeTemplateSlug = undefined;
        state.activeTemplateVersionId = undefined;
        state.activeDetailTab = 'readme';
        state.activePublishTemplateId = undefined;
        state.publishedTemplate = undefined;
        refreshListStatus();
        renderTemplates();
        window.scrollTo(0, 0);
      }

      function setDetailTab(tab) {
        const normalizedTab = normalizeDetailTab(tab);
        if (state.activeDetailTab === normalizedTab) {
          return;
        }
        closeVersionMenus(false);
        state.activeDetailTab = normalizedTab;
        renderTemplates();
      }

      function normalizeDetailTab(tab) {
        return tab === 'changelog' ? 'changelog' : 'readme';
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
        eyebrow.textContent = '已安装';
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

        const publisher = document.createElement('p');
        publisher.className = 'publisher';
        publisher.textContent = formatTemplatePublisherLabel(template);

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
        meta.textContent = (template.downloadCount || 0).toLocaleString() + ' 次下载 · ' + (template.likeCount || 0).toLocaleString() + ' 次点赞 · v' + template.latestVersion.versionNumber;

        const installedTemplate = findInstalledTemplate(template);
        const installedBadge = document.createElement('div');
        installedBadge.className = 'installed-badge';
        installedBadge.textContent = installedTemplate
          ? formatInstalledTemplateBadge(installedTemplate)
          : '';

        const installTargetRow = createInstallTargetSelectRow(template);

        const actions = document.createElement('div');
        actions.className = 'actions single-action';
        const installButtonGroup = createInstallSplitButton(template, installedTemplate, template.latestVersion.id);
        actions.append(installTargetRow, installButtonGroup);

        article.append(thumb, titleRow, description, publisher, tags, meta);
        if (installedTemplate) {
          article.append(installedBadge);
        }
        article.append(actions);
        return article;
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
        if (isPreferredVersionInstalled) {
          group.classList.add('is-installed-split');
        }
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
          void toggleVersionMenu(template);
        });

        group.append(installButton, versionButton);
        if (state.openInstallVersionMenuSlug === getTemplateInstallTargetKey(template)) {
          group.append(renderVersionMenu(template));
        }
        return group;
      }

      function closeVersionMenus(render = true) {
        const hadOpenMenu = Boolean(state.openInstallVersionMenuSlug);
        if (!hadOpenMenu) {
          return false;
        }
        state.openInstallVersionMenuSlug = undefined;
        if (render) {
          renderTemplates();
        } else {
          document.querySelectorAll('.version-menu').forEach((menu) => {
            menu.remove();
          });
        }
        return true;
      }

      async function toggleVersionMenu(template) {
        const key = getTemplateInstallTargetKey(template);
        if (state.openInstallVersionMenuSlug === key) {
          state.openInstallVersionMenuSlug = undefined;
          renderTemplates();
          return;
        }

        state.openInstallVersionMenuSlug = key;
        if (!state.templateDetailsBySlug[key]) {
          state.loadingVersionMenuSlug = key;
          delete state.versionMenuErrorsBySlug[key];
          renderTemplates();
          await loadTemplateDetail(template);
          return;
        }
        renderTemplates();
      }

      function renderVersionMenu(template) {
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
          item.textContent = isInstalledVersion
            ? '已安装 v' + version.versionNumber
            : '安装 v' + version.versionNumber;
          item.disabled = state.installingSlug === template.slug || isInstalledVersion || !resolveTemplateInstallTargetId(template);
          item.addEventListener('click', () => {
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
          statusElement.textContent = '安装失败：无法下载模板 JSON（' + formatErrorMessage(error) + '）。请检查网络和当前安装位置后重试。';
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

      function formatTemplatePublisherLabel(template) {
        const publisher = template && template.publisher ? template.publisher : undefined;
        const displayName = readString(publisher && publisher.displayName) || readString(publisher && publisher.githubLogin);
        return '作者 ' + (displayName || '未知');
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
