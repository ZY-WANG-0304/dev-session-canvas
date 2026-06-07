import {
  MARKETPLACE_QUERY_MAX_LENGTH,
  normalizeMarketplaceSlug,
  getSeedTemplateDetail,
  listSeedTemplates,
  type MarketplaceAdminReportActionRequest,
  type MarketplaceAdminReportsResponse,
  type MarketplaceAdminTemplateStatusRequest,
  type MarketplaceAdminTemplateStatusResponse,
  type MarketplaceAdminUserBanRequest,
  type MarketplaceAdminUserBanResponse,
  type MarketplaceListTemplatesResponse,
  type MarketplacePublisherStatsResponse,
  type MarketplacePublishTemplateRequest,
  type MarketplacePublishTemplateResponse,
  type MarketplaceSort,
  type MarketplaceSlugAvailabilityResponse,
  type MarketplaceTemplateLikeResponse,
  type MarketplaceTemplateReportRequest,
  type MarketplaceTemplateReportResponse,
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

export interface MarketplaceCurrentUser {
  githubUserId: string;
  githubLogin: string;
  displayName: string;
  avatarUrl: string;
}

export interface MarketplaceCurrentUserResult {
  user?: MarketplaceCurrentUser;
}

export async function loadMarketplaceTemplates(query: TemplateQueryState): Promise<MarketplaceTemplateLoadResult> {
  const normalizedQuery = normalizeTemplateSearchQuery(query.q);
  const params = new URLSearchParams();
  if (normalizedQuery) {
    params.set('q', normalizedQuery);
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
    const fallback = listSeedTemplates({ q: normalizedQuery, sort: query.sort, tags: query.tags });
    return {
      templates: fallback.items,
      storageMode: fallback.storageMode,
      source: 'seed-fallback'
    };
  }
}

export function normalizeTemplateSearchQuery(value: string): string {
  return value.trim().slice(0, MARKETPLACE_QUERY_MAX_LENGTH);
}

export async function loadMarketplaceTemplateDetail(templateIdOrSlug: string): Promise<MarketplaceTemplateDetailLoadResult> {
  try {
    const response = await fetch(`/api/v1/templates/${encodeURIComponent(templateIdOrSlug)}`);
    if (!response.ok) {
      const errorCode = await readMarketplaceErrorCode(response);
      if (response.status === 404 && errorCode === 'template_not_found') {
        return {
          template: undefined,
          storageMode: 'api',
          source: 'api'
        };
      }
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

async function readMarketplaceErrorCode(response: Response): Promise<string | undefined> {
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.includes('application/json')) {
    return undefined;
  }
  try {
    const body = (await response.clone().json()) as { error?: { code?: string } };
    return body.error?.code;
  } catch {
    return undefined;
  }
}

export async function loadCurrentMarketplaceUser(): Promise<MarketplaceCurrentUserResult> {
  const response = await fetch('/api/v1/auth/me', {
    headers: { accept: 'application/json' }
  });
  if (response.status === 401) {
    return {};
  }
  if (!response.ok) {
    throw new Error(`API returned ${response.status}`);
  }
  return (await response.json()) as MarketplaceCurrentUserResult;
}

export async function loadMyMarketplaceTemplates(): Promise<MarketplaceListTemplatesResponse> {
  const response = await fetch('/api/v1/me/templates', {
    headers: { accept: 'application/json' }
  });
  const body = (await response.json()) as MarketplaceListTemplatesResponse | { error?: { message?: string } };
  if (!response.ok) {
    const message = 'error' in body && body.error?.message ? body.error.message : `API returned ${response.status}`;
    throw new Error(message);
  }
  return body as MarketplaceListTemplatesResponse;
}

export async function loadMyMarketplaceLikes(): Promise<MarketplaceListTemplatesResponse> {
  const response = await fetch('/api/v1/me/likes', {
    headers: { accept: 'application/json' }
  });
  const body = (await response.json()) as MarketplaceListTemplatesResponse | { error?: { message?: string } };
  if (!response.ok) {
    const message = 'error' in body && body.error?.message ? body.error.message : `API returned ${response.status}`;
    throw new Error(message);
  }
  return body as MarketplaceListTemplatesResponse;
}

export async function loadMyMarketplaceStats(): Promise<MarketplacePublisherStatsResponse> {
  const response = await fetch('/api/v1/me/stats', {
    headers: { accept: 'application/json' }
  });
  const body = (await response.json()) as MarketplacePublisherStatsResponse | { error?: { message?: string } };
  if (!response.ok) {
    const message = 'error' in body && body.error?.message ? body.error.message : `API returned ${response.status}`;
    throw new Error(message);
  }
  return body as MarketplacePublisherStatsResponse;
}

export async function loadMarketplaceTemplateLikeState(templateIdOrSlug: string): Promise<MarketplaceTemplateLikeResponse> {
  const response = await fetch(`/api/v1/templates/${encodeURIComponent(templateIdOrSlug)}/like`, {
    headers: { accept: 'application/json' }
  });
  const body = (await response.json()) as MarketplaceTemplateLikeResponse | { error?: { message?: string } };
  if (!response.ok) {
    const message = 'error' in body && body.error?.message ? body.error.message : `API returned ${response.status}`;
    throw new Error(message);
  }
  return body as MarketplaceTemplateLikeResponse;
}

export async function setMarketplaceTemplateLike(templateIdOrSlug: string, liked: boolean): Promise<MarketplaceTemplateLikeResponse> {
  const response = await fetch(`/api/v1/templates/${encodeURIComponent(templateIdOrSlug)}/like`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json'
    },
    body: JSON.stringify({ liked })
  });
  const body = (await response.json()) as MarketplaceTemplateLikeResponse | { error?: { message?: string } };
  if (!response.ok) {
    const message = 'error' in body && body.error?.message ? body.error.message : `API returned ${response.status}`;
    throw new Error(message);
  }
  return body as MarketplaceTemplateLikeResponse;
}

export async function reportMarketplaceTemplate(
  templateIdOrSlug: string,
  request: MarketplaceTemplateReportRequest
): Promise<MarketplaceTemplateReportResponse> {
  const response = await fetch(`/api/v1/templates/${encodeURIComponent(templateIdOrSlug)}/report`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json'
    },
    body: JSON.stringify(request)
  });
  return readMarketplaceJsonResponse<MarketplaceTemplateReportResponse>(response);
}

export async function loadMarketplaceAdminReports(status?: 'open' | 'resolved' | 'rejected'): Promise<MarketplaceAdminReportsResponse> {
  const params = new URLSearchParams();
  if (status) {
    params.set('status', status);
  }
  const suffix = params.toString() ? `?${params.toString()}` : '';
  const response = await fetch(`/api/v1/admin/reports${suffix}`, {
    headers: { accept: 'application/json' }
  });
  return readMarketplaceJsonResponse<MarketplaceAdminReportsResponse>(response);
}

export async function resolveMarketplaceAdminReport(
  reportId: string,
  request: MarketplaceAdminReportActionRequest
): Promise<MarketplaceTemplateReportResponse> {
  const response = await fetch(`/api/v1/admin/reports/${encodeURIComponent(reportId)}`, {
    method: 'PATCH',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json'
    },
    body: JSON.stringify(request)
  });
  return readMarketplaceJsonResponse<MarketplaceTemplateReportResponse>(response);
}

export async function setMarketplaceAdminTemplateStatus(
  templateId: string,
  request: MarketplaceAdminTemplateStatusRequest
): Promise<MarketplaceAdminTemplateStatusResponse> {
  const response = await fetch(`/api/v1/admin/templates/${encodeURIComponent(templateId)}`, {
    method: 'PATCH',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json'
    },
    body: JSON.stringify(request)
  });
  return readMarketplaceJsonResponse<MarketplaceAdminTemplateStatusResponse>(response);
}

export async function setMarketplaceAdminUserBan(userId: string, request: MarketplaceAdminUserBanRequest): Promise<MarketplaceAdminUserBanResponse> {
  const response = await fetch(`/api/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json'
    },
    body: JSON.stringify(request)
  });
  return readMarketplaceJsonResponse<MarketplaceAdminUserBanResponse>(response);
}

export async function checkMarketplaceSlugAvailability(slug: string): Promise<MarketplaceSlugAvailabilityResponse> {
  const params = new URLSearchParams();
  params.set('slug', normalizeMarketplaceSlug(slug));
  const response = await fetch(`/api/v1/templates/slug-availability?${params.toString()}`, {
    headers: { accept: 'application/json' }
  });
  const body = (await response.json()) as MarketplaceSlugAvailabilityResponse | { error?: { message?: string } };
  if (!response.ok) {
    const message = 'error' in body && body.error?.message ? body.error.message : `API returned ${response.status}`;
    throw new Error(message);
  }
  return body as MarketplaceSlugAvailabilityResponse;
}

export async function publishMarketplaceTemplate(
  request: MarketplacePublishTemplateRequest
): Promise<MarketplacePublishTemplateResponse> {
  const response = await fetch('/api/v1/templates', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json'
    },
    body: JSON.stringify(request)
  });
  const body = (await response.json()) as MarketplacePublishTemplateResponse | { error?: { message?: string } };
  if (!response.ok) {
    const message = 'error' in body && body.error?.message ? body.error.message : `API returned ${response.status}`;
    throw new Error(message);
  }
  return body as MarketplacePublishTemplateResponse;
}

async function readMarketplaceJsonResponse<T extends object>(response: Response): Promise<T> {
  const body = (await response.json()) as T | { error?: { message?: string } };
  if (!response.ok) {
    const message = 'error' in body && body.error?.message ? body.error.message : `API returned ${response.status}`;
    throw new Error(message);
  }
  return body as T;
}

export async function publishMarketplaceTemplatePackage(file: File): Promise<MarketplacePublishTemplateResponse> {
  const formData = new FormData();
  formData.set('package', file);
  const response = await fetch('/api/v1/templates/package', {
    method: 'POST',
    headers: {
      accept: 'application/json'
    },
    body: formData
  });
  const body = (await response.json()) as MarketplacePublishTemplateResponse | { error?: { message?: string } };
  if (!response.ok) {
    const message = 'error' in body && body.error?.message ? body.error.message : `API returned ${response.status}`;
    throw new Error(message);
  }
  return body as MarketplacePublishTemplateResponse;
}
