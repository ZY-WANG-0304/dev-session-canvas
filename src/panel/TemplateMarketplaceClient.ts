import { createHash } from 'node:crypto';
import * as http from 'node:http';
import * as https from 'node:https';

import * as vscode from 'vscode';

import type { CanvasTemplateMarketMetadata, CanvasTemplateStorageLocation, CanvasStoredTemplate } from './CanvasTemplateStore';
import type { CanvasPanelManager } from './CanvasPanelManager';

const MARKETPLACE_INSTALL_URI_PATH = '/install-template';
const DEFAULT_MARKETPLACE_SOURCE_ORIGIN = 'https://dscanvas.dev';
const MAX_TEMPLATE_DOWNLOAD_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 3;

const TRUSTED_MARKETPLACE_HOSTS = new Set([
  'dscanvas.dev',
  'www.dscanvas.dev',
  'templates.dscanvas.dev',
  'dscanvas-template-marketplace.wzy0304.workers.dev'
]);

export interface TemplateMarketplaceInstallResult {
  savedTemplate: CanvasStoredTemplate;
  detail: MarketplaceTemplateDetailShape;
  version: MarketplaceTemplateVersionShape;
  operation: TemplateMarketplaceInstallOperation;
}

export type TemplateMarketplaceInstallOperation = 'installed' | 'updated' | 'reinstalled';

export interface TemplateMarketplaceInlineInstallParams {
  templateIdOrSlug: string;
  versionId?: string;
  targetStorageLocationId?: string;
  sourceUrl: string;
  templateJson: string;
  payloadSha256?: string;
  marketTemplateId?: string;
  installedVersionNumber?: number;
  sha256?: string;
  sizeBytes?: number;
  publisher?: CanvasTemplateMarketMetadata['publisher'];
}

export interface TemplateMarketplaceInstalledTemplateSummary {
  localTemplateId: string;
  localTemplateName: string;
  storageLocationId?: string;
  storageLocationLabel?: string;
  storageScope?: CanvasTemplateStorageLocation['scope'];
  marketTemplateId: string;
  marketTemplateSlug?: string;
  marketVersionId: string;
  installedVersionNumber: number;
  sourceUrl: string;
}

export interface TemplateMarketplaceInstallTargetSummary {
  id: string;
  label: string;
  scope: CanvasTemplateStorageLocation['scope'];
}

interface TemplateMarketplaceInstallRequest {
  templateIdOrSlug: string;
  versionId?: string;
  targetStorageLocationId?: string;
  sourceUrl: URL;
  inlineTemplateJson?: string;
  inlineSha256?: string;
  marketTemplateId?: string;
  installedVersionNumber?: number;
  sha256?: string;
  sizeBytes?: number;
  publisher?: CanvasTemplateMarketMetadata['publisher'];
}

interface MarketplaceTemplateDetailResponseShape {
  template: MarketplaceTemplateDetailShape;
}

interface MarketplaceTemplateDetailShape {
  id: string;
  slug: string;
  name: string;
  publisher: MarketplacePublisherShape;
  latestVersion: MarketplaceTemplateVersionShape;
  versions: MarketplaceTemplateVersionShape[];
}

interface MarketplacePublisherShape {
  id: string;
  githubLogin: string;
  displayName: string;
  avatarUrl: string;
}

interface MarketplaceTemplateVersionShape {
  id: string;
  versionNumber: number;
  thumbnailKey?: string;
  sha256: string;
  sizeBytes: number;
}

interface HttpTextResponse {
  statusCode: number;
  text: string;
}

interface ResolvedMarketplaceInstallTarget {
  id: string;
  rootPath: string;
}

export class TemplateMarketplaceClient {
  public constructor(private readonly panelManager: CanvasPanelManager) {}

  public listInstallTargets(): TemplateMarketplaceInstallTargetSummary[] {
    return this.panelManager.getCanvasTemplateStorageLocations().map((location) => ({
      id: location.id,
      label: location.label,
      scope: location.scope
    }));
  }

  public async listInstalledTemplates(): Promise<TemplateMarketplaceInstalledTemplateSummary[]> {
    const catalog = await this.panelManager.getCanvasTemplateCatalog();
    return catalog.templates.flatMap((storedTemplate) => {
      const marketplace = storedTemplate.marketplace;
      if (!marketplace) {
        return [];
      }

      return [
        {
          localTemplateId: storedTemplate.template.id,
          localTemplateName: storedTemplate.template.name,
          storageLocationId: storedTemplate.storageLocation?.id,
          storageLocationLabel: storedTemplate.storageLocation?.label,
          storageScope: storedTemplate.storageLocation?.scope,
          marketTemplateId: marketplace.marketTemplateId,
          marketTemplateSlug: marketplace.marketTemplateSlug,
          marketVersionId: marketplace.marketVersionId,
          installedVersionNumber: marketplace.installedVersionNumber,
          sourceUrl: marketplace.sourceUrl
        }
      ];
    });
  }

  public async installTemplateFromInlinePayload(
    params: TemplateMarketplaceInlineInstallParams
  ): Promise<TemplateMarketplaceInstallResult> {
    return this.installInlineTemplate({
      templateIdOrSlug: params.templateIdOrSlug,
      versionId: params.versionId,
      targetStorageLocationId: params.targetStorageLocationId,
      sourceUrl: parseTrustedMarketplaceSourceUrl(params.sourceUrl),
      inlineTemplateJson: params.templateJson,
      inlineSha256: params.payloadSha256,
      marketTemplateId: params.marketTemplateId,
      installedVersionNumber: params.installedVersionNumber,
      sha256: params.sha256,
      sizeBytes: params.sizeBytes,
      publisher: params.publisher
    });
  }

  public async installTemplateFromUri(uri: vscode.Uri): Promise<TemplateMarketplaceInstallResult> {
    const request = parseInstallUri(uri);
    if (request.inlineTemplateJson) {
      return this.installInlineTemplate(request);
    }

    const detailUrl = buildTemplateDetailApiUrl(request);
    const detailResponse = await requestText(detailUrl);
    if (detailResponse.statusCode < 200 || detailResponse.statusCode >= 300) {
      throw new Error(`获取模板详情失败：HTTP ${detailResponse.statusCode}。`);
    }

    const detail = parseTemplateDetailResponse(JSON.parse(detailResponse.text)).template;
    const version = resolveTemplateVersion(detail, request.versionId);
    const downloadUrl = buildTemplateDownloadApiUrl(request, version.id);
    const downloadResponse = await requestText(downloadUrl);
    if (downloadResponse.statusCode < 200 || downloadResponse.statusCode >= 300) {
      throw new Error(`下载模板失败：HTTP ${downloadResponse.statusCode}。`);
    }

    const actualSha256 = createHash('sha256').update(downloadResponse.text).digest('hex');
    if (version.sha256 && actualSha256 !== version.sha256) {
      throw new Error('模板文件校验失败（SHA-256 不匹配），已中止安装。');
    }

    const document = JSON.parse(downloadResponse.text) as unknown;
    const metadata: CanvasTemplateMarketMetadata = {
      marketTemplateId: detail.id,
      marketTemplateSlug: detail.slug,
      marketVersionId: version.id,
      installedVersionNumber: version.versionNumber,
      installedAt: new Date().toISOString(),
      sourceUrl: request.sourceUrl.toString(),
      publisher: { ...detail.publisher },
      thumbnailKey: version.thumbnailKey,
      checksum: {
        sha256: actualSha256,
        sizeBytes: version.sizeBytes
      }
    };
    const { savedTemplate, operation } = await this.saveMarketplaceTemplateDocument(
      document,
      metadata,
      request.targetStorageLocationId
    );
    return {
      savedTemplate,
      detail,
      version,
      operation
    };
  }

  private async installInlineTemplate(request: TemplateMarketplaceInstallRequest): Promise<TemplateMarketplaceInstallResult> {
    const versionId = request.versionId ?? 'inline-version';
    const versionNumber = request.installedVersionNumber ?? 1;
    const actualSha256 = createHash('sha256').update(request.inlineTemplateJson ?? '').digest('hex');
    const expectedSha256 = request.inlineSha256 ?? request.sha256;
    if (expectedSha256 && actualSha256 !== expectedSha256) {
      throw new Error('内联模板校验失败（SHA-256 不匹配），已中止安装。');
    }

    const document = JSON.parse(request.inlineTemplateJson ?? '') as unknown;
    const metadata: CanvasTemplateMarketMetadata = {
      marketTemplateId: request.marketTemplateId ?? request.templateIdOrSlug,
      marketTemplateSlug: request.templateIdOrSlug,
      marketVersionId: versionId,
      installedVersionNumber: versionNumber,
      installedAt: new Date().toISOString(),
      sourceUrl: request.sourceUrl.toString(),
      publisher: request.publisher,
      checksum: {
        sha256: actualSha256,
        sizeBytes: request.sizeBytes
      }
    };
    const { savedTemplate, operation } = await this.saveMarketplaceTemplateDocument(
      document,
      metadata,
      request.targetStorageLocationId
    );
    return {
      savedTemplate,
      detail: {
        id: metadata.marketTemplateId,
        slug: request.templateIdOrSlug,
        name: savedTemplate.template.name,
        publisher: normalizePublisherForResult(request.publisher),
        latestVersion: {
          id: versionId,
          versionNumber,
          sha256: actualSha256,
          sizeBytes: request.sizeBytes ?? Buffer.byteLength(request.inlineTemplateJson ?? '', 'utf8')
        },
        versions: []
      },
      version: {
        id: versionId,
        versionNumber,
        sha256: actualSha256,
        sizeBytes: request.sizeBytes ?? Buffer.byteLength(request.inlineTemplateJson ?? '', 'utf8')
      },
      operation
    };
  }

  private async saveMarketplaceTemplateDocument(
    document: unknown,
    metadata: CanvasTemplateMarketMetadata,
    targetStorageLocationId: string | undefined
  ): Promise<{
    savedTemplate: CanvasStoredTemplate;
    operation: TemplateMarketplaceInstallOperation;
  }> {
    const targetLocation = this.resolveInstallTarget(targetStorageLocationId);
    const existingTemplate = await this.findInstalledMarketplaceTemplate(metadata, targetLocation);
    const operation = resolveMarketplaceInstallOperation(existingTemplate, metadata);
    const savedTemplate = await this.panelManager.installMarketplaceTemplateDocument(document, metadata, {
      targetRootPath: targetLocation?.rootPath,
      overwriteFilePath: existingTemplate?.filePath,
      preserveTemplateId: existingTemplate?.template.id,
      preserveCreatedAt: existingTemplate?.template.createdAt
    });
    return {
      savedTemplate,
      operation
    };
  }

  private async findInstalledMarketplaceTemplate(
    metadata: CanvasTemplateMarketMetadata,
    targetLocation: ResolvedMarketplaceInstallTarget | undefined
  ): Promise<CanvasStoredTemplate | undefined> {
    const catalog = await this.panelManager.getCanvasTemplateCatalog();
    return catalog.templates.find((candidate) => {
      const marketplace = candidate.marketplace;
      if (!marketplace) {
        return false;
      }
      const matchesTemplate =
        marketplace.marketTemplateId === metadata.marketTemplateId ||
        (metadata.marketTemplateSlug ? marketplace.marketTemplateSlug === metadata.marketTemplateSlug : false);
      const matchesTarget = targetLocation ? candidate.storageLocation?.id === targetLocation.id : true;
      return matchesTemplate && matchesTarget;
    });
  }

  private resolveInstallTarget(targetStorageLocationId: string | undefined): ResolvedMarketplaceInstallTarget | undefined {
    const locations = this.panelManager.getCanvasTemplateStorageLocations();
    if (targetStorageLocationId) {
      const explicitLocation = locations.find((location) => location.id === targetStorageLocationId);
      if (!explicitLocation) {
        throw new Error('指定的安装位置不存在。');
      }
      return {
        id: explicitLocation.id,
        rootPath: explicitLocation.rootPath
      };
    }

    const fallbackLocation = locations.find((location) => location.scope === 'global') ?? locations[0];
    return fallbackLocation
      ? {
          id: fallbackLocation.id,
          rootPath: fallbackLocation.rootPath
        }
      : undefined;
  }
}

function resolveMarketplaceInstallOperation(
  existingTemplate: CanvasStoredTemplate | undefined,
  metadata: CanvasTemplateMarketMetadata
): TemplateMarketplaceInstallOperation {
  if (!existingTemplate) {
    return 'installed';
  }
  return existingTemplate.marketplace?.marketVersionId === metadata.marketVersionId ? 'reinstalled' : 'updated';
}

function parseInstallUri(uri: vscode.Uri): TemplateMarketplaceInstallRequest {
  if (uri.path !== MARKETPLACE_INSTALL_URI_PATH) {
    throw new Error('不支持的安装链接路径。');
  }

  const params = new URLSearchParams(uri.query);
  const templateIdOrSlug = readRequiredQueryParam(params, 'template');
  const versionId = readOptionalQueryParam(params, 'version');
  const inlinePayload = readOptionalQueryParam(params, 'payload');
  const inlinePayloadSha256 = readOptionalQueryParam(params, 'payloadSha256');
  // 外部 vscode:// 安装链接不接受内联 payload；inline 安装只允许从 Webview message bridge 进入。
  if (inlinePayload || inlinePayloadSha256) {
    throw new Error('外部安装链接不支持内联 payload，请从市场页面重新操作。');
  }
  const sourceUrl = parseTrustedMarketplaceSourceUrl(
    readOptionalQueryParam(params, 'source') ?? `${DEFAULT_MARKETPLACE_SOURCE_ORIGIN}/templates/${encodeURIComponent(templateIdOrSlug)}`
  );

  return {
    templateIdOrSlug,
    versionId,
    targetStorageLocationId: readOptionalQueryParam(params, 'targetStorageLocationId'),
    sourceUrl,
    marketTemplateId: readOptionalQueryParam(params, 'marketTemplateId'),
    installedVersionNumber: parseOptionalNumber(readOptionalQueryParam(params, 'versionNumber')),
    sha256: readOptionalQueryParam(params, 'sha256'),
    sizeBytes: parseOptionalNumber(readOptionalQueryParam(params, 'sizeBytes')),
    publisher: parsePublisherFromQuery(params)
  };
}

function readRequiredQueryParam(params: URLSearchParams, key: string): string {
  const value = readOptionalQueryParam(params, key);
  if (!value) {
    throw new Error(`安装链接缺少必要参数 ${key}。`);
  }
  return value;
}

function readOptionalQueryParam(params: URLSearchParams, key: string): string | undefined {
  const value = params.get(key)?.trim();
  return value ? value : undefined;
}

function parseOptionalNumber(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parsePublisherFromQuery(params: URLSearchParams): CanvasTemplateMarketMetadata['publisher'] {
  const id = readOptionalQueryParam(params, 'publisherId');
  const githubLogin = readOptionalQueryParam(params, 'publisherLogin');
  const displayName = readOptionalQueryParam(params, 'publisherName');
  const avatarUrl = readOptionalQueryParam(params, 'publisherAvatarUrl');
  return id || githubLogin || displayName || avatarUrl
    ? {
        id,
        githubLogin,
        displayName,
        avatarUrl
      }
    : undefined;
}

function normalizePublisherForResult(publisher: CanvasTemplateMarketMetadata['publisher']): MarketplacePublisherShape {
  return {
    id: publisher?.id ?? 'unknown',
    githubLogin: publisher?.githubLogin ?? 'unknown',
    displayName: publisher?.displayName ?? publisher?.githubLogin ?? 'Unknown publisher',
    avatarUrl: publisher?.avatarUrl ?? ''
  };
}

export function parseTrustedMarketplaceSourceUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('市场来源地址无效。');
  }

  if (!isTrustedMarketplaceUrl(url)) {
    throw new Error('市场来源不在允许的域名列表内。');
  }
  return url;
}

function isTrustedMarketplaceUrl(url: URL): boolean {
  if (url.protocol === 'https:' && TRUSTED_MARKETPLACE_HOSTS.has(url.hostname)) {
    return url.pathname === '/templates' || url.pathname.startsWith('/templates/');
  }

  if ((url.protocol === 'http:' || url.protocol === 'https:') && isLocalDevelopmentHost(url.hostname)) {
    return url.pathname === '/templates' || url.pathname.startsWith('/templates/');
  }

  return false;
}

function isLocalDevelopmentHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0' || hostname === '[::1]';
}

function buildTemplateDetailApiUrl(request: TemplateMarketplaceInstallRequest): URL {
  return new URL(`/api/v1/templates/${encodeURIComponent(request.templateIdOrSlug)}`, request.sourceUrl.origin);
}

function buildTemplateDownloadApiUrl(request: TemplateMarketplaceInstallRequest, versionId: string): URL {
  const url = new URL(`/api/v1/templates/${encodeURIComponent(request.templateIdOrSlug)}/download`, request.sourceUrl.origin);
  url.searchParams.set('version', versionId);
  return url;
}

function parseTemplateDetailResponse(value: unknown): MarketplaceTemplateDetailResponseShape {
  if (!isRecord(value) || !isRecord(value.template)) {
    throw new Error('详情接口返回了无法识别的数据格式。');
  }
  return {
    template: parseTemplateDetail(value.template)
  };
}

function parseTemplateDetail(value: Record<string, unknown>): MarketplaceTemplateDetailShape {
  const id = readRequiredString(value.id, 'template.id');
  const slug = readRequiredString(value.slug, 'template.slug');
  const name = readRequiredString(value.name, 'template.name');
  const publisher = parsePublisher(value.publisher);
  const latestVersion = parseVersion(value.latestVersion, 'template.latestVersion');
  const versions = Array.isArray(value.versions) ? value.versions.map((entry, index) => parseVersion(entry, `template.versions[${index}]`)) : [];
  return {
    id,
    slug,
    name,
    publisher,
    latestVersion,
    versions: versions.length > 0 ? versions : [latestVersion]
  };
}

function parsePublisher(value: unknown): MarketplacePublisherShape {
  if (!isRecord(value)) {
    throw new Error('详情接口缺少发布者信息。');
  }
  return {
    id: readRequiredString(value.id, 'publisher.id'),
    githubLogin: readRequiredString(value.githubLogin, 'publisher.githubLogin'),
    displayName: readRequiredString(value.displayName, 'publisher.displayName'),
    avatarUrl: typeof value.avatarUrl === 'string' ? value.avatarUrl : ''
  };
}

function parseVersion(value: unknown, fieldName: string): MarketplaceTemplateVersionShape {
  if (!isRecord(value)) {
    throw new Error(`详情接口缺少字段 ${fieldName}。`);
  }
  return {
    id: readRequiredString(value.id, `${fieldName}.id`),
    versionNumber: readRequiredNumber(value.versionNumber, `${fieldName}.versionNumber`),
    thumbnailKey: typeof value.thumbnailKey === 'string' && value.thumbnailKey.trim().length > 0 ? value.thumbnailKey : undefined,
    sha256: readRequiredString(value.sha256, `${fieldName}.sha256`),
    sizeBytes: readRequiredNumber(value.sizeBytes, `${fieldName}.sizeBytes`)
  };
}

function resolveTemplateVersion(detail: MarketplaceTemplateDetailShape, versionId: string | undefined): MarketplaceTemplateVersionShape {
  if (!versionId) {
    return detail.latestVersion;
  }

  const version = detail.versions.find((entry) => entry.id === versionId) ?? (detail.latestVersion.id === versionId ? detail.latestVersion : undefined);
  if (!version) {
    throw new Error('详情接口未返回指定版本。');
  }
  return version;
}

function readRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`详情接口缺少字段 ${fieldName}。`);
  }
  return value.trim();
}

function readRequiredNumber(value: unknown, fieldName: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`详情接口缺少字段 ${fieldName}。`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function requestText(url: URL, redirectCount = 0): Promise<HttpTextResponse> {
  return new Promise<HttpTextResponse>((resolve, reject) => {
    const request = (url.protocol === 'http:' ? http : https).get(
      url,
      {
        headers: {
          accept: 'application/json',
          'user-agent': 'dev-session-canvas-template-marketplace'
        }
      },
      (response) => {
        const statusCode = response.statusCode ?? 0;
        const location = response.headers.location;
        if (location && isRedirectStatus(statusCode)) {
          response.resume();
          if (redirectCount >= MAX_REDIRECTS) {
            reject(new Error('请求重定向次数过多。'));
            return;
          }
          const nextUrl = new URL(location, url);
          if (!isTrustedMarketplaceUrl(nextUrl) && !isTrustedApiUrl(nextUrl, url)) {
            reject(new Error('请求被重定向到不受信任的地址。'));
            return;
          }
          void requestText(nextUrl, redirectCount + 1).then(resolve, reject);
          return;
        }

        const chunks: Buffer[] = [];
        let byteLength = 0;
        response.on('data', (chunk: Buffer) => {
          byteLength += chunk.length;
          if (byteLength > MAX_TEMPLATE_DOWNLOAD_BYTES) {
            request.destroy(new Error('模板文件超过大小限制。'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => {
          resolve({
            statusCode,
            text: Buffer.concat(chunks).toString('utf8')
          });
        });
      }
    );

    request.setTimeout(30_000, () => {
      request.destroy(new Error('市场请求超时。'));
    });
    request.on('error', reject);
  });
}

function isRedirectStatus(statusCode: number): boolean {
  return statusCode === 301 || statusCode === 302 || statusCode === 303 || statusCode === 307 || statusCode === 308;
}

function isTrustedApiUrl(candidate: URL, original: URL): boolean {
  return candidate.origin === original.origin && candidate.pathname.startsWith('/api/v1/templates/');
}
