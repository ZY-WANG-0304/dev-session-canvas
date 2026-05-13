import { buildTemplateDetailHref } from './routing';

const VSCODE_EXTENSION_AUTHORITY = 'devsessioncanvas.dev-session-canvas';
const DEFAULT_MARKETPLACE_ORIGIN = 'https://dscanvas.dev';
const MAX_INLINE_TEMPLATE_INSTALL_BYTES = 8 * 1024;

export interface TemplateVSCodeInstallTarget {
  id?: string;
  slug: string;
  publisher?: {
    id?: string;
    githubLogin?: string;
    displayName?: string;
    avatarUrl?: string;
  };
  latestVersion: {
    id: string;
    versionNumber?: number;
    sha256?: string;
    sizeBytes?: number;
  };
}

export interface VSCodeInstallHrefOptions {
  inlineTemplateJson?: string;
}

export function buildVSCodeInstallHref(
  template: TemplateVSCodeInstallTarget,
  marketplaceOrigin = getMarketplaceOrigin(),
  options: VSCodeInstallHrefOptions = {}
): string {
  const sourceUrl = new URL(buildTemplateDetailHref(template.slug), normalizeMarketplaceOrigin(marketplaceOrigin));
  const params = new URLSearchParams({
    template: template.slug,
    version: template.latestVersion.id,
    source: sourceUrl.toString()
  });
  appendOptionalParam(params, 'marketTemplateId', template.id);
  appendOptionalParam(params, 'versionNumber', formatOptionalNumber(template.latestVersion.versionNumber));
  appendOptionalParam(params, 'sha256', template.latestVersion.sha256);
  appendOptionalParam(params, 'sizeBytes', formatOptionalNumber(template.latestVersion.sizeBytes));
  appendOptionalParam(params, 'publisherId', template.publisher?.id);
  appendOptionalParam(params, 'publisherLogin', template.publisher?.githubLogin);
  appendOptionalParam(params, 'publisherName', template.publisher?.displayName);
  appendOptionalParam(params, 'publisherAvatarUrl', template.publisher?.avatarUrl);
  if (options.inlineTemplateJson) {
    params.set('payload', encodeTemplatePayload(options.inlineTemplateJson));
    appendOptionalParam(params, 'payloadSha256', template.latestVersion.sha256);
  }
  return `vscode://${VSCODE_EXTENSION_AUTHORITY}/install-template?${params.toString()}`;
}

export async function buildVSCodeInstallHrefWithBrowserPayload(
  template: TemplateVSCodeInstallTarget,
  downloadHref: string,
  marketplaceOrigin = getMarketplaceOrigin()
): Promise<string> {
  if (!shouldInlineTemplateForInstall(template.latestVersion.sizeBytes)) {
    return buildVSCodeInstallHref(template, marketplaceOrigin);
  }

  const response = await fetch(downloadHref, {
    headers: {
      accept: 'application/json'
    }
  });
  if (!response.ok) {
    throw new Error(`Download API returned ${response.status}`);
  }
  const templateJson = await response.text();
  if (!shouldInlineTemplateTextForInstall(templateJson)) {
    return buildVSCodeInstallHref(template, marketplaceOrigin);
  }
  return buildVSCodeInstallHref(template, marketplaceOrigin, {
    inlineTemplateJson: templateJson
  });
}

export function getMarketplaceOrigin(): string {
  return typeof window !== 'undefined' && window.location?.origin ? window.location.origin : DEFAULT_MARKETPLACE_ORIGIN;
}

function normalizeMarketplaceOrigin(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    return DEFAULT_MARKETPLACE_ORIGIN;
  }
}

function shouldInlineTemplateForInstall(sizeBytes: number | undefined): boolean {
  return typeof sizeBytes === 'number' && Number.isFinite(sizeBytes) && sizeBytes > 0 && sizeBytes <= MAX_INLINE_TEMPLATE_INSTALL_BYTES;
}

function shouldInlineTemplateTextForInstall(value: string): boolean {
  return new TextEncoder().encode(value).byteLength <= MAX_INLINE_TEMPLATE_INSTALL_BYTES;
}

function encodeTemplatePayload(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

function appendOptionalParam(params: URLSearchParams, key: string, value: string | undefined): void {
  if (value && value.trim().length > 0) {
    params.set(key, value);
  }
}

function formatOptionalNumber(value: number | undefined): string | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : undefined;
}
