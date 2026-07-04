import { createHash } from 'node:crypto';
import * as http from 'node:http';
import * as https from 'node:https';

import * as vscode from 'vscode';
import { unzipSync } from 'fflate';

import {
  buildMarketplaceSlugFromName,
  marketplaceTemplatePackageManifestSchema,
  normalizeMarketplacePackagePath,
  generateMarketplaceTemplateThumbnailPngBase64,
  marketplaceTemplateDocumentSchema,
  type MarketplaceTemplateDocument
} from '@dev-session-canvas/marketplace-shared';

import { encodeCanvasTemplateDocument } from '../common/canvasTemplates';
import type { CanvasTemplateMarketMetadata, CanvasTemplateStorageLocation, CanvasStoredTemplate } from './CanvasTemplateStore';
import type { CanvasPanelManager } from './CanvasPanelManager';

const MARKETPLACE_INSTALL_URI_PATH = '/install-template';
const DEFAULT_MARKETPLACE_SOURCE_ORIGIN = 'https://dscanvas.dev';
const MARKETPLACE_OFFICIAL_SOURCE_URL = `${DEFAULT_MARKETPLACE_SOURCE_ORIGIN}/templates`;
const MARKETPLACE_DEBUG_SOURCE_URL = 'https://dscanvas-template-marketplace.wzy0304.workers.dev/templates';
const MARKETPLACE_SOURCE_URL_ENV_KEY = 'DEV_SESSION_CANVAS_TEMPLATE_MARKETPLACE_SOURCE_URL';
const MAX_TEMPLATE_DOWNLOAD_BYTES = 5 * 1024 * 1024;
const MAX_TEMPLATE_PACKAGE_DOWNLOAD_BYTES = 50 * 1024 * 1024;
const MAX_TEMPLATE_PACKAGE_UNZIPPED_BYTES = 100 * 1024 * 1024;
const MAX_TEMPLATE_PACKAGE_FILES = 100;
const MAX_REDIRECTS = 3;
const MARKETPLACE_TOKEN_SECRET_KEY = 'devSessionCanvas.templateMarketplace.token';
const MARKETPLACE_INSTALLED_UPDATE_CHECK_TIMEOUT_MS = 3500;

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
  templateJson?: string;
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

export interface TemplateMarketplaceInstalledTemplateUpdateSummary extends TemplateMarketplaceInstalledTemplateSummary {
  latestVersionId?: string;
  latestVersionNumber?: number;
  updateAvailable: boolean;
  updateCheckError?: string;
}

export interface TemplateMarketplaceInstallTargetSummary {
  id: string;
  label: string;
  scope: CanvasTemplateStorageLocation['scope'];
}

export interface TemplateMarketplacePublishResult {
  templateId: string;
  slug: string;
  name: string;
  versionId: string;
  versionNumber: number;
  sourceUrl: string;
}

export interface TemplateMarketplacePublishDraft {
  templateId: string;
  templateName: string;
  storageLocationLabel?: string;
  nodeCount: number;
  defaultName: string;
  defaultSlug: string;
  defaultDescription: string;
  defaultTags: string[];
  defaultReadme: string;
  defaultChangelog: string;
  templateJson: string;
  thumbnailPngBase64: string;
}

export interface TemplateMarketplacePublishDraftRequest {
  templateId: string;
  templateIdOrSlug?: string;
  slug?: string;
  name: string;
  description: string;
  tags: string[];
  readme?: string;
  changelog?: string;
  templateJson: string;
  publishMode?: 'template' | 'version';
  sourceUrl?: string;
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

interface HttpBufferResponse {
  statusCode: number;
  body: Buffer;
}

interface MarketplaceTemplatePackageInstallPayload {
  packageBytes: Uint8Array;
  extractedFiles: Map<string, Uint8Array>;
  manifestPath: string;
  templatePath: string;
  readmePath: string;
  changelogPath: string;
  thumbnailPath: string;
  templateDocument: unknown;
}

interface MarketplaceVSCodeTokenResponseShape {
  token: string;
  expiresAt: string;
  user: MarketplaceAuthenticatedUserShape;
}

interface MarketplaceAuthenticatedUserShape {
  githubUserId: string;
  githubLogin: string;
  displayName: string;
  avatarUrl: string;
}

interface ResolvedMarketplaceInstallTarget {
  id: string;
  rootPath: string;
}

class MarketplaceTemplatePackageError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'MarketplaceTemplatePackageError';
  }
}

export class TemplateMarketplaceClient {
  private readonly marketplaceSourceUrl: URL;

  public constructor(
    private readonly panelManager: CanvasPanelManager,
    private readonly context: vscode.ExtensionContext,
    extensionMode: vscode.ExtensionMode
  ) {
    this.marketplaceSourceUrl = resolveDefaultMarketplaceSourceUrl(extensionMode);
  }

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

  public async listInstalledTemplateUpdateStatuses(): Promise<TemplateMarketplaceInstalledTemplateUpdateSummary[]> {
    const installedTemplates = await this.listInstalledTemplates();
    return Promise.all(
      installedTemplates.map(async (installedTemplate) => {
        try {
          const detail = await this.fetchInstalledTemplateDetail(installedTemplate, {
            timeoutMs: MARKETPLACE_INSTALLED_UPDATE_CHECK_TIMEOUT_MS
          });
          return {
            ...installedTemplate,
            latestVersionId: detail.latestVersion.id,
            latestVersionNumber: detail.latestVersion.versionNumber,
            updateAvailable: isMarketplaceVersionNewer(installedTemplate, detail.latestVersion)
          };
        } catch (error) {
          return {
            ...installedTemplate,
            updateAvailable: false,
            updateCheckError: error instanceof Error ? error.message : String(error)
          };
        }
      })
    );
  }

  public async updateInstalledTemplateToLatest(localTemplateId: string): Promise<TemplateMarketplaceInstallResult> {
    const installedTemplate = await this.findInstalledTemplateSummary(localTemplateId);
    if (!installedTemplate) {
      throw new Error(vscode.l10n.t('Could not find the marketplace template to update.'));
    }
    return this.installTemplateFromUri(buildMarketplaceInstallUriFromInstalledTemplate(installedTemplate));
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
      throw new Error(vscode.l10n.t('Failed to fetch template details: HTTP {status}.', {
        status: detailResponse.statusCode
      }));
    }

    const detail = parseTemplateDetailResponse(JSON.parse(detailResponse.text)).template;
    const version = resolveTemplateVersion(detail, request.versionId);
    const downloadUrl = buildTemplateDownloadApiUrl(request, version.id);
    const downloadResponse = await requestBuffer(downloadUrl, { accept: 'application/zip' });
    if (downloadResponse.statusCode < 200 || downloadResponse.statusCode >= 300) {
      throw new Error(vscode.l10n.t('Failed to download the full template package: HTTP {status}.', {
        status: downloadResponse.statusCode
      }));
    }

    const packagePayload = parseMarketplaceTemplatePackageForInstall(downloadResponse.body);
    const packageSha256 = createHash('sha256').update(downloadResponse.body).digest('hex');
    const templateSha256 = createHash('sha256').update(packagePayload.extractedFiles.get(packagePayload.templatePath) ?? new Uint8Array()).digest('hex');
    if (version.sha256 && templateSha256 !== version.sha256) {
      throw new Error(vscode.l10n.t('Template package verification failed (template.json SHA-256 mismatch), so installation was stopped.'));
    }

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
        sha256: templateSha256,
        sizeBytes: version.sizeBytes
      },
      packageSha256,
      packageSizeBytes: downloadResponse.body.byteLength,
      manifestPath: packagePayload.manifestPath,
      templatePath: packagePayload.templatePath,
      readmePath: packagePayload.readmePath,
      changelogPath: packagePayload.changelogPath,
      thumbnailPath: packagePayload.thumbnailPath
    };
    const { savedTemplate, operation } = await this.saveMarketplaceTemplatePackage(
      packagePayload,
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

  public async listPublishableTemplateDrafts(preferredTemplateId?: string): Promise<TemplateMarketplacePublishDraft[]> {
    const catalog = await this.panelManager.getCanvasTemplateCatalog();
    const publishableTemplates = catalog.templates.filter(isPublishableStoredTemplate);
    if (preferredTemplateId) {
      const preferredTemplate = publishableTemplates.find((candidate) => candidate.template.id === preferredTemplateId);
      if (!preferredTemplate) {
        await this.findPublishableStoredTemplate(preferredTemplateId);
      }
      return publishableTemplates
        .slice()
        .sort((left, right) => Number(right.template.id === preferredTemplateId) - Number(left.template.id === preferredTemplateId))
        .map((storedTemplate) => buildPublishDraft(storedTemplate));
    }
    return publishableTemplates.map((storedTemplate) => buildPublishDraft(storedTemplate));
  }

  public async publishTemplateDraft(request: TemplateMarketplacePublishDraftRequest): Promise<TemplateMarketplacePublishResult> {
    const storedTemplate = await this.findPublishableStoredTemplate(request.templateId);
    if (request.publishMode === 'version') {
      return this.publishTemplateDraftVersion(storedTemplate, request);
    }
    const name = request.name.trim();
    const description = request.description.trim();
    if (!name) {
      throw new Error(vscode.l10n.t('Template name cannot be empty.'));
    }
    if (!description) {
      throw new Error(vscode.l10n.t('Template description cannot be empty.'));
    }

    const sourceUrl = request.sourceUrl ? parseTrustedMarketplaceSourceUrl(request.sourceUrl) : this.marketplaceSourceUrl;
    const token = await this.exchangeVSCodeMarketplaceToken(sourceUrl);
    const templateDocument = parseMarketplaceTemplateDocumentJson(request.templateJson);
    const requestBody = {
      slug: request.slug?.trim() || undefined,
      name,
      description,
      tags: request.tags,
      readme: request.readme?.trim() || buildTemplatePublishReadme(name, description),
      changelog: request.changelog?.trim() || vscode.l10n.t('Initial marketplace version.'),
      templateDocument,
      thumbnailPngBase64: generateMarketplaceTemplateThumbnailPngBase64(templateDocument)
    };
    const response = await requestJson(
      new URL('/api/v1/templates', sourceUrl.origin),
      'POST',
      requestBody,
      token
    );
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(vscode.l10n.t('Failed to publish template: {message}', {
        message: extractMarketplaceErrorMessage(response.text, response.statusCode)
      }));
    }
    const publishResponse = parseTemplatePublishResponse(JSON.parse(response.text));
    const publishedSourceUrl = new URL(`/templates/${encodeURIComponent(publishResponse.template.slug)}`, sourceUrl.origin);
    return {
      templateId: publishResponse.template.id,
      slug: publishResponse.template.slug,
      name: publishResponse.template.name,
      versionId: publishResponse.template.latestVersion.id,
      versionNumber: publishResponse.template.latestVersion.versionNumber,
      sourceUrl: publishedSourceUrl.toString()
    };
  }

  public async publishTemplateDraftVersion(
    storedTemplate: CanvasStoredTemplate,
    request: TemplateMarketplacePublishDraftRequest
  ): Promise<TemplateMarketplacePublishResult> {
    const templateIdOrSlug = request.templateIdOrSlug?.trim();
    if (!templateIdOrSlug) {
      throw new Error(vscode.l10n.t('Publishing a new version requires a target marketplace template.'));
    }

    const sourceUrl = request.sourceUrl ? parseTrustedMarketplaceSourceUrl(request.sourceUrl) : this.marketplaceSourceUrl;
    const detail = await this.fetchTemplateDetailFromMarketplace(templateIdOrSlug, sourceUrl);
    if (!isTemplateDraftLikelyMatchingMarketplaceTemplate(storedTemplate, detail)) {
      throw new Error(vscode.l10n.t('The local template name does not match the target marketplace template, so publishing a new version was stopped.'));
    }

    const token = await this.exchangeVSCodeMarketplaceToken(sourceUrl);
    const templateDocument = parseMarketplaceTemplateDocumentJson(request.templateJson);
    const requestBody = {
      changelog: request.changelog?.trim() || vscode.l10n.t('Version {version}.', {
        version: detail.latestVersion.versionNumber + 1
      }),
      templateDocument,
      thumbnailPngBase64: generateMarketplaceTemplateThumbnailPngBase64(templateDocument)
    };
    const response = await requestJson(
      new URL(`/api/v1/templates/${encodeURIComponent(templateIdOrSlug)}/versions`, sourceUrl.origin),
      'POST',
      requestBody,
      token
    );
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(vscode.l10n.t('Failed to publish a new template version: {message}', {
        message: extractMarketplaceErrorMessage(response.text, response.statusCode)
      }));
    }
    const publishResponse = parseTemplatePublishResponse(JSON.parse(response.text));
    const publishedSourceUrl = new URL(`/templates/${encodeURIComponent(publishResponse.template.slug)}`, sourceUrl.origin);
    return {
      templateId: publishResponse.template.id,
      slug: publishResponse.template.slug,
      name: publishResponse.template.name,
      versionId: publishResponse.template.latestVersion.id,
      versionNumber: publishResponse.template.latestVersion.versionNumber,
      sourceUrl: publishedSourceUrl.toString()
    };
  }

  private async installInlineTemplate(request: TemplateMarketplaceInstallRequest): Promise<TemplateMarketplaceInstallResult> {
    const versionId = request.versionId ?? 'inline-version';
    const versionNumber = request.installedVersionNumber ?? 1;
    const actualSha256 = createHash('sha256').update(request.inlineTemplateJson ?? '').digest('hex');
    const expectedSha256 = request.inlineSha256 ?? request.sha256;
    if (expectedSha256 && actualSha256 !== expectedSha256) {
      throw new Error(vscode.l10n.t('Inline template verification failed (SHA-256 mismatch), so installation was stopped.'));
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


  private async saveMarketplaceTemplatePackage(
    packagePayload: MarketplaceTemplatePackageInstallPayload,
    metadata: CanvasTemplateMarketMetadata,
    targetStorageLocationId: string | undefined
  ): Promise<{
    savedTemplate: CanvasStoredTemplate;
    operation: TemplateMarketplaceInstallOperation;
  }> {
    const targetLocation = this.resolveInstallTarget(targetStorageLocationId);
    const existingTemplate = await this.findInstalledMarketplaceTemplate(metadata, targetLocation);
    const operation = resolveMarketplaceInstallOperation(existingTemplate, metadata);
    const savedTemplate = await this.panelManager.installMarketplaceTemplatePackage(
      packagePayload.packageBytes,
      packagePayload.extractedFiles,
      metadata,
      {
        targetRootPath: targetLocation?.rootPath,
        packageDirectoryName: sanitizeMarketplacePackageDirectoryName(metadata.marketTemplateSlug ?? metadata.marketTemplateId),
        preserveTemplateId: existingTemplate?.template.id,
        preserveCreatedAt: existingTemplate?.template.createdAt,
        legacyTemplateFilePath: existingTemplate?.filePath
      }
    );
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

  private async findInstalledTemplateSummary(localTemplateId: string): Promise<TemplateMarketplaceInstalledTemplateSummary | undefined> {
    const normalizedTemplateId = localTemplateId.trim();
    if (!normalizedTemplateId) {
      return undefined;
    }
    const installedTemplates = await this.listInstalledTemplates();
    return installedTemplates.find((installedTemplate) => installedTemplate.localTemplateId === normalizedTemplateId);
  }

  private async fetchInstalledTemplateDetail(
    installedTemplate: TemplateMarketplaceInstalledTemplateSummary,
    options: { timeoutMs?: number } = {}
  ): Promise<MarketplaceTemplateDetailShape> {
    const sourceUrl = parseTrustedMarketplaceSourceUrl(installedTemplate.sourceUrl);
    const request: TemplateMarketplaceInstallRequest = {
      templateIdOrSlug: installedTemplate.marketTemplateSlug ?? installedTemplate.marketTemplateId,
      sourceUrl
    };
    const detailUrl = buildTemplateDetailApiUrl(request);
    const detailResponse = await requestText(detailUrl, { timeoutMs: options.timeoutMs });
    if (detailResponse.statusCode < 200 || detailResponse.statusCode >= 300) {
      throw new Error(vscode.l10n.t('Failed to fetch template details: HTTP {status}.', {
        status: detailResponse.statusCode
      }));
    }
    return parseTemplateDetailResponse(JSON.parse(detailResponse.text)).template;
  }

  private async fetchTemplateDetailFromMarketplace(
    templateIdOrSlug: string,
    sourceUrl: URL = this.marketplaceSourceUrl,
    options: { timeoutMs?: number } = {}
  ): Promise<MarketplaceTemplateDetailShape> {
    const request: TemplateMarketplaceInstallRequest = {
      templateIdOrSlug,
      sourceUrl
    };
    const detailResponse = await requestText(buildTemplateDetailApiUrl(request), { timeoutMs: options.timeoutMs });
    if (detailResponse.statusCode < 200 || detailResponse.statusCode >= 300) {
      throw new Error(vscode.l10n.t('Failed to fetch template details: {message}', {
        message: extractMarketplaceErrorMessage(detailResponse.text, detailResponse.statusCode)
      }));
    }
    return parseTemplateDetailResponse(JSON.parse(detailResponse.text)).template;
  }

  private resolveInstallTarget(targetStorageLocationId: string | undefined): ResolvedMarketplaceInstallTarget | undefined {
    const locations = this.panelManager.getCanvasTemplateStorageLocations();
    if (targetStorageLocationId) {
      const explicitLocation = locations.find((location) => location.id === targetStorageLocationId);
      if (!explicitLocation) {
        throw new Error(vscode.l10n.t('The selected install location does not exist.'));
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

  private async findPublishableStoredTemplate(templateId: string): Promise<CanvasStoredTemplate> {
    const catalog = await this.panelManager.getCanvasTemplateCatalog();
    const storedTemplate = catalog.templates.find((candidate) => candidate.template.id === templateId);
    if (!storedTemplate) {
      throw new Error(vscode.l10n.t('Could not find the template to publish.'));
    }
    if (storedTemplate.template.category !== 'user' || storedTemplate.marketplace) {
      throw new Error(vscode.l10n.t('Only custom templates can be published right now. Built-in templates and installed marketplace templates cannot be published directly.'));
    }
    return storedTemplate;
  }

  private async exchangeVSCodeMarketplaceToken(sourceUrl: URL = this.marketplaceSourceUrl): Promise<string> {
    const session = await vscode.authentication.getSession('github', ['read:user'], { createIfNone: true });
    const response = await requestJson(
      new URL('/api/v1/auth/vscode/exchange', sourceUrl.origin),
      'POST',
      { accessToken: session.accessToken },
      undefined
    );
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(vscode.l10n.t('Failed to exchange GitHub identity for a marketplace token: {message}', {
        message: extractMarketplaceErrorMessage(response.text, response.statusCode)
      }));
    }
    const tokenResponse = parseMarketplaceTokenResponse(JSON.parse(response.text));
    await this.context.secrets.store(MARKETPLACE_TOKEN_SECRET_KEY, tokenResponse.token);
    return tokenResponse.token;
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

function isMarketplaceVersionNewer(
  installedTemplate: TemplateMarketplaceInstalledTemplateSummary,
  latestVersion: MarketplaceTemplateVersionShape
): boolean {
  return latestVersion.versionNumber > installedTemplate.installedVersionNumber;
}

function isTemplateDraftLikelyMatchingMarketplaceTemplate(
  storedTemplate: CanvasStoredTemplate,
  detail: MarketplaceTemplateDetailShape
): boolean {
  return storedTemplate.template.name.trim().toLowerCase() === detail.name.trim().toLowerCase();
}

function buildMarketplaceInstallUriFromInstalledTemplate(installedTemplate: TemplateMarketplaceInstalledTemplateSummary): vscode.Uri {
  const params = new URLSearchParams({
    template: installedTemplate.marketTemplateSlug ?? installedTemplate.marketTemplateId,
    source: installedTemplate.sourceUrl
  });
  if (installedTemplate.storageLocationId) {
    params.set('targetStorageLocationId', installedTemplate.storageLocationId);
  }
  return vscode.Uri.parse(`vscode://devsessioncanvas.dev-session-canvas/install-template?${params.toString()}`);
}

function resolveDefaultMarketplaceSourceUrl(extensionMode: vscode.ExtensionMode): URL {
  const override = resolveNonProductionMarketplaceSourceUrlOverride(extensionMode);
  if (override) {
    return override;
  }
  return new URL(extensionMode === vscode.ExtensionMode.Production ? MARKETPLACE_OFFICIAL_SOURCE_URL : MARKETPLACE_DEBUG_SOURCE_URL);
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

function isPublishableStoredTemplate(storedTemplate: CanvasStoredTemplate): boolean {
  return storedTemplate.template.category === 'user' && !storedTemplate.marketplace;
}

function buildPublishDraft(storedTemplate: CanvasStoredTemplate): TemplateMarketplacePublishDraft {
  const templateDocument = parseMarketplaceTemplateDocumentJson(encodeCanvasTemplateDocument(storedTemplate.template));
  const defaultName = storedTemplate.template.name;
  const defaultDescription = vscode.l10n.t('{name} template for Dev Session Canvas.', {
    name: defaultName
  });
  return {
    templateId: storedTemplate.template.id,
    templateName: storedTemplate.template.name,
    storageLocationLabel: storedTemplate.storageLocation?.label,
    nodeCount: storedTemplate.template.nodes.length,
    defaultName,
    defaultSlug: buildMarketplaceSlugFromName(defaultName),
    defaultDescription,
    defaultTags: ['workflow'],
    defaultReadme: buildTemplatePublishReadme(defaultName, defaultDescription),
    defaultChangelog: vscode.l10n.t('Initial marketplace version.'),
    templateJson: JSON.stringify(templateDocument, null, 2),
    thumbnailPngBase64: generateMarketplaceTemplateThumbnailPngBase64(templateDocument)
  };
}

function parseMarketplaceTemplateDocumentJson(value: string): MarketplaceTemplateDocument {
  const parsed = JSON.parse(value) as unknown;
  return marketplaceTemplateDocumentSchema.parse(parsed);
}

function buildTemplatePublishReadme(name: string, description: string): string {
  const trimmedDescription = description.trim() || vscode.l10n.t('{name} template for Dev Session Canvas.', {
    name
  });
  return `# ${name}\n\n${trimmedDescription}\n`;
}

function parseMarketplaceTokenResponse(value: unknown): MarketplaceVSCodeTokenResponseShape {
  if (!isRecord(value)) {
    throw new Error(vscode.l10n.t('The marketplace token API returned unrecognized data.'));
  }
  return {
    token: readRequiredString(value.token, 'token'),
    expiresAt: readRequiredString(value.expiresAt, 'expiresAt'),
    user: parseAuthenticatedUser(value.user)
  };
}

function parseAuthenticatedUser(value: unknown): MarketplaceAuthenticatedUserShape {
  if (!isRecord(value)) {
    throw new Error(vscode.l10n.t('The marketplace token API response is missing user information.'));
  }
  return {
    githubUserId: readRequiredString(value.githubUserId, 'user.githubUserId'),
    githubLogin: readRequiredString(value.githubLogin, 'user.githubLogin'),
    displayName: readRequiredString(value.displayName, 'user.displayName'),
    avatarUrl: typeof value.avatarUrl === 'string' ? value.avatarUrl : ''
  };
}

function parseTemplatePublishResponse(value: unknown): { template: MarketplaceTemplateDetailShape } {
  return parseTemplateDetailResponse(value);
}

function parseInstallUri(uri: vscode.Uri): TemplateMarketplaceInstallRequest {
  if (uri.path !== MARKETPLACE_INSTALL_URI_PATH) {
    throw new Error(vscode.l10n.t('Unsupported install link path.'));
  }

  const params = new URLSearchParams(uri.query);
  const templateIdOrSlug = readRequiredQueryParam(params, 'template');
  const versionId = readOptionalQueryParam(params, 'version');
  const inlinePayload = readOptionalQueryParam(params, 'payload');
  const inlinePayloadSha256 = readOptionalQueryParam(params, 'payloadSha256');
  // External vscode:// install links cannot carry inline payloads; inline installs only come through the Webview message bridge.
  if (inlinePayload || inlinePayloadSha256) {
    throw new Error(vscode.l10n.t('External install links do not support inline payloads. Try again from the marketplace page.'));
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
    throw new Error(vscode.l10n.t('The install link is missing required parameter {key}.', {
      key
    }));
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
    throw new Error(vscode.l10n.t('Marketplace source URL is invalid.'));
  }

  if (!isTrustedMarketplaceUrl(url)) {
    throw new Error(vscode.l10n.t('Marketplace source is not on the allowed host list.'));
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


function parseMarketplaceTemplatePackageForInstall(packageBytes: Buffer): MarketplaceTemplatePackageInstallPayload {
  if (packageBytes.byteLength > MAX_TEMPLATE_PACKAGE_DOWNLOAD_BYTES) {
    throw new MarketplaceTemplatePackageError(vscode.l10n.t('The full template package exceeds the size limit.'));
  }

  let totalUnzippedBytes = 0;
  let rawEntries: Record<string, Uint8Array>;
  try {
    rawEntries = unzipSync(packageBytes, {
      filter: (file) => {
        if (file.name.endsWith('/')) {
          return true;
        }
        if (!normalizeMarketplacePackagePath(file.name)) {
          throw new MarketplaceTemplatePackageError(vscode.l10n.t('The full template package contains an unsafe path: {path}', {
            path: file.name
          }));
        }
        totalUnzippedBytes += file.originalSize;
        if (totalUnzippedBytes > MAX_TEMPLATE_PACKAGE_UNZIPPED_BYTES) {
          throw new MarketplaceTemplatePackageError(vscode.l10n.t('The full template package exceeds the unzipped size limit.'));
        }
        return true;
      }
    });
  } catch (error) {
    if (error instanceof MarketplaceTemplatePackageError) {
      throw error;
    }
    throw new MarketplaceTemplatePackageError(vscode.l10n.t('The full template package is not a valid zip file.'));
  }

  const extractedFiles = new Map<string, Uint8Array>();
  for (const [entryPath, bytes] of Object.entries(rawEntries)) {
    if (entryPath.endsWith('/')) {
      continue;
    }
    const normalizedPath = normalizeMarketplacePackagePath(entryPath);
    if (!normalizedPath) {
      throw new MarketplaceTemplatePackageError(vscode.l10n.t('The full template package contains an unsafe path: {path}', {
        path: entryPath
      }));
    }
    extractedFiles.set(normalizedPath, bytes);
  }

  if (extractedFiles.size > MAX_TEMPLATE_PACKAGE_FILES) {
    throw new MarketplaceTemplatePackageError(vscode.l10n.t('The full template package contains too many files.'));
  }

  const manifestPath = 'template-package.json';
  const manifestBytes = extractedFiles.get(manifestPath);
  if (!manifestBytes) {
    throw new MarketplaceTemplatePackageError(vscode.l10n.t('The full template package is missing template-package.json.'));
  }

  let manifest: ReturnType<typeof marketplaceTemplatePackageManifestSchema.parse>;
  try {
    manifest = marketplaceTemplatePackageManifestSchema.parse(JSON.parse(decodeUtf8(manifestBytes, manifestPath)));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new MarketplaceTemplatePackageError(vscode.l10n.t('The full template package manifest is invalid: {message}', {
      message
    }));
  }

  const templateBytes = requirePackageEntryForInstall(extractedFiles, manifest.template);
  requirePackageEntryForInstall(extractedFiles, manifest.readme);
  requirePackageEntryForInstall(extractedFiles, manifest.changelog);
  requirePackageEntryForInstall(extractedFiles, manifest.thumbnail);
  let templateDocument: unknown;
  try {
    templateDocument = JSON.parse(decodeUtf8(templateBytes, manifest.template));
    marketplaceTemplateDocumentSchema.parse(templateDocument);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new MarketplaceTemplatePackageError(vscode.l10n.t('The full template package template.json is invalid: {message}', {
      message
    }));
  }

  return {
    packageBytes: new Uint8Array(packageBytes),
    extractedFiles,
    manifestPath,
    templatePath: manifest.template,
    readmePath: manifest.readme,
    changelogPath: manifest.changelog,
    thumbnailPath: manifest.thumbnail,
    templateDocument
  };
}

function requirePackageEntryForInstall(entries: ReadonlyMap<string, Uint8Array>, entryPath: string): Uint8Array {
  const normalizedPath = normalizeMarketplacePackagePath(entryPath);
  if (!normalizedPath) {
    throw new MarketplaceTemplatePackageError(vscode.l10n.t('The full template package contains an unsafe path: {path}', {
      path: entryPath
    }));
  }
  const bytes = entries.get(normalizedPath);
  if (!bytes) {
    throw new MarketplaceTemplatePackageError(vscode.l10n.t('The full template package is missing {path}.', {
      path: normalizedPath
    }));
  }
  return bytes;
}

function decodeUtf8(bytes: Uint8Array, fileName: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    throw new MarketplaceTemplatePackageError(vscode.l10n.t('{fileName} is not valid UTF-8 text.', {
      fileName
    }));
  }
}

function sanitizeMarketplacePackageDirectoryName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'template';
}

function parseTemplateDetailResponse(value: unknown): MarketplaceTemplateDetailResponseShape {
  if (!isRecord(value) || !isRecord(value.template)) {
    throw new Error(vscode.l10n.t('The detail API returned unrecognized data.'));
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
    throw new Error(vscode.l10n.t('The detail API response is missing publisher information.'));
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
    throw new Error(vscode.l10n.t('The detail API response is missing field {fieldName}.', {
      fieldName
    }));
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
    throw new Error(vscode.l10n.t('The detail API response did not include the requested version.'));
  }
  return version;
}

function readRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(vscode.l10n.t('The detail API response is missing field {fieldName}.', {
      fieldName
    }));
  }
  return value.trim();
}

function readRequiredNumber(value: unknown, fieldName: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(vscode.l10n.t('The detail API response is missing field {fieldName}.', {
      fieldName
    }));
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function requestText(
  url: URL,
  options: { maxBytes?: number; timeoutMs?: number } = {},
  redirectCount = 0
): Promise<HttpTextResponse> {
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
            reject(new Error(vscode.l10n.t('Too many request redirects.')));
            return;
          }
          const nextUrl = new URL(location, url);
          if (!isTrustedMarketplaceUrl(nextUrl) && !isTrustedApiUrl(nextUrl, url)) {
            reject(new Error(vscode.l10n.t('The request was redirected to an untrusted URL.')));
            return;
          }
          void requestText(nextUrl, options, redirectCount + 1).then(resolve, reject);
          return;
        }

        const chunks: Buffer[] = [];
        let byteLength = 0;
        const maxBytes = options.maxBytes ?? MAX_TEMPLATE_DOWNLOAD_BYTES;
        response.on('data', (chunk: Buffer) => {
          byteLength += chunk.length;
          if (byteLength > maxBytes) {
            request.destroy(new Error(vscode.l10n.t('The template file exceeds the size limit.')));
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

    request.setTimeout(options.timeoutMs ?? 30_000, () => {
      request.destroy(new Error(vscode.l10n.t('Marketplace request timed out.')));
    });
    request.on('error', reject);
  });
}


async function requestBuffer(
  url: URL,
  options: { accept: string; maxBytes?: number } = { accept: 'application/octet-stream' },
  redirectCount = 0
): Promise<HttpBufferResponse> {
  return new Promise<HttpBufferResponse>((resolve, reject) => {
    const request = (url.protocol === 'http:' ? http : https).get(
      url,
      {
        headers: {
          accept: options.accept,
          'user-agent': 'dev-session-canvas-template-marketplace'
        }
      },
      (response) => {
        const statusCode = response.statusCode ?? 0;
        const location = response.headers.location;
        if (location && isRedirectStatus(statusCode)) {
          response.resume();
          if (redirectCount >= MAX_REDIRECTS) {
            reject(new Error(vscode.l10n.t('Too many request redirects.')));
            return;
          }
          const nextUrl = new URL(location, url);
          if (!isTrustedMarketplaceUrl(nextUrl) && !isTrustedApiUrl(nextUrl, url)) {
            reject(new Error(vscode.l10n.t('The request was redirected to an untrusted URL.')));
            return;
          }
          void requestBuffer(nextUrl, options, redirectCount + 1).then(resolve, reject);
          return;
        }

        const chunks: Buffer[] = [];
        let byteLength = 0;
        const maxBytes = options.maxBytes ?? MAX_TEMPLATE_PACKAGE_DOWNLOAD_BYTES;
        response.on('data', (chunk: Buffer) => {
          byteLength += chunk.length;
          if (byteLength > maxBytes) {
            request.destroy(new Error(vscode.l10n.t('The full template package exceeds the size limit.')));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => {
          resolve({
            statusCode,
            body: Buffer.concat(chunks)
          });
        });
      }
    );

    request.setTimeout(30_000, () => {
      request.destroy(new Error(vscode.l10n.t('Marketplace request timed out.')));
    });
    request.on('error', reject);
  });
}

async function requestJson(url: URL, method: 'POST', body: unknown, bearerToken: string | undefined): Promise<HttpTextResponse> {
  const payload = JSON.stringify(body);
  return new Promise<HttpTextResponse>((resolve, reject) => {
    const request = (url.protocol === 'http:' ? http : https).request(
      url,
      {
        method,
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
          'user-agent': 'dev-session-canvas-template-marketplace',
          ...(bearerToken ? { authorization: `Bearer ${bearerToken}` } : {})
        }
      },
      (response) => {
        const chunks: Buffer[] = [];
        let byteLength = 0;
        response.on('data', (chunk: Buffer) => {
          byteLength += chunk.length;
          if (byteLength > MAX_TEMPLATE_DOWNLOAD_BYTES) {
            request.destroy(new Error(vscode.l10n.t('Marketplace response exceeds the size limit.')));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => {
          resolve({
            statusCode: response.statusCode ?? 0,
            text: Buffer.concat(chunks).toString('utf8')
          });
        });
      }
    );

    request.setTimeout(30_000, () => {
      request.destroy(new Error(vscode.l10n.t('Marketplace request timed out.')));
    });
    request.on('error', reject);
    request.end(payload);
  });
}

function extractMarketplaceErrorMessage(text: string, statusCode: number): string {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (isRecord(parsed) && isRecord(parsed.error) && typeof parsed.error.message === 'string') {
      return parsed.error.message;
    }
  } catch {
    // Fall back to the status code when the server does not return JSON.
  }
  return `HTTP ${statusCode}`;
}

function isRedirectStatus(statusCode: number): boolean {
  return statusCode === 301 || statusCode === 302 || statusCode === 303 || statusCode === 307 || statusCode === 308;
}

function isTrustedApiUrl(candidate: URL, original: URL): boolean {
  return candidate.origin === original.origin && candidate.pathname.startsWith('/api/v1/templates/');
}
