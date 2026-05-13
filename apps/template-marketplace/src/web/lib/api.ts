import {
  getSeedTemplateDetail,
  listSeedTemplates,
  type MarketplaceListTemplatesResponse,
  type MarketplaceSort,
  type MarketplaceTemplateDetail,
  type MarketplaceTemplateDetailResponse,
  type MarketplaceTemplateSummary
} from '@dev-session-canvas/marketplace-shared';

export interface TemplateQueryState {
  q: string;
  sort: MarketplaceSort;
  tags?: string[];
}

export interface MarketplaceTemplateLoadResult {
  templates: MarketplaceTemplateSummary[];
  storageMode: string;
  source: 'api' | 'seed-fallback';
}

export interface MarketplaceTemplateDetailLoadResult {
  template?: MarketplaceTemplateDetail;
  storageMode: string;
  source: 'api' | 'seed-fallback';
}

export async function loadMarketplaceTemplates(query: TemplateQueryState): Promise<MarketplaceTemplateLoadResult> {
  const params = new URLSearchParams();
  if (query.q.trim()) {
    params.set('q', query.q.trim());
  }
  for (const tag of query.tags ?? []) {
    params.append('tag', tag);
  }
  params.set('sort', query.sort);

  try {
    const response = await fetch(`/api/v1/templates?${params.toString()}`);
    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }
    const body = (await response.json()) as MarketplaceListTemplatesResponse;
    return {
      templates: body.items,
      storageMode: body.storageMode,
      source: 'api'
    };
  } catch {
    const fallback = listSeedTemplates({ q: query.q, sort: query.sort, tags: query.tags });
    return {
      templates: fallback.items,
      storageMode: fallback.storageMode,
      source: 'seed-fallback'
    };
  }
}

export async function loadMarketplaceTemplateDetail(templateIdOrSlug: string): Promise<MarketplaceTemplateDetailLoadResult> {
  try {
    const response = await fetch(`/api/v1/templates/${encodeURIComponent(templateIdOrSlug)}`);
    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }
    const body = (await response.json()) as MarketplaceTemplateDetailResponse;
    return {
      template: body.template,
      storageMode: body.storageMode,
      source: 'api'
    };
  } catch {
    const template = getSeedTemplateDetail(templateIdOrSlug);
    return {
      template,
      storageMode: 'seed',
      source: 'seed-fallback'
    };
  }
}
