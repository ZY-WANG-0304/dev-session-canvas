import { buildTemplateDetailHref } from './routing';

const VSCODE_EXTENSION_AUTHORITY = 'devsessioncanvas.dev-session-canvas';
const DEFAULT_MARKETPLACE_ORIGIN = 'https://dscanvas.dev';

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

export function buildVSCodeInstallHref(template: TemplateVSCodeInstallTarget, marketplaceOrigin = getMarketplaceOrigin()): string {
  const sourceUrl = new URL(buildTemplateDetailHref(template.slug), normalizeMarketplaceOrigin(marketplaceOrigin));
  const params = new URLSearchParams({
    template: template.slug,
    version: template.latestVersion.id,
    source: sourceUrl.toString()
  });
  return `vscode://${VSCODE_EXTENSION_AUTHORITY}/install-template?${params.toString()}`;
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
