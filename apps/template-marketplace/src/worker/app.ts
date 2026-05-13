import { Hono } from 'hono';
import { cors } from 'hono/cors';

import {
  makeMarketplaceApiError,
  MARKETPLACE_SORT_VALUES,
  type MarketplaceListTemplatesRequest,
  type MarketplaceTemplateDetail,
  type MarketplaceTemplateVersion
} from '@dev-session-canvas/marketplace-shared';

import { buildR2TemplateDownloadResponse, buildR2TemplateThumbnailResponse } from './download';
import { createTemplateRepository } from './repository';

export interface MarketplaceWorkerEnv {
  ASSETS?: Fetcher;
  MARKETPLACE_DB?: D1Database;
  TEMPLATE_BUCKET?: R2Bucket;
}

export function createMarketplaceWorkerApp(): Hono<{ Bindings: MarketplaceWorkerEnv }> {
  const app = new Hono<{ Bindings: MarketplaceWorkerEnv }>();

  app.use(
    '/api/v1/*',
    cors({
      origin: '*',
      allowMethods: ['GET', 'OPTIONS'],
      allowHeaders: ['accept', 'content-type'],
      exposeHeaders: [
        'content-disposition',
        'x-marketplace-storage-mode',
        'x-marketplace-catalog-storage-mode',
        'x-marketplace-template-id',
        'x-marketplace-version-id',
        'x-marketplace-sha256'
      ],
      maxAge: 600
    })
  );

  app.get('/api/v1/health', (context) =>
    context.json({
      ok: true,
      service: 'template-marketplace',
      storageMode: 'seed'
    })
  );

  app.get('/api/v1/templates', async (context) => {
    const query = parseListTemplatesQuery(new URL(context.req.url));
    const repository = createTemplateRepository(context.env?.MARKETPLACE_DB);
    return context.json(await repository.listTemplates(query));
  });

  app.get('/api/v1/templates/:id', async (context) => {
    const repository = createTemplateRepository(context.env?.MARKETPLACE_DB);
    const detail = await repository.getTemplateDetail(context.req.param('id'));
    if (!detail) {
      return context.json(makeMarketplaceApiError('template_not_found', 'Template was not found.'), 404);
    }
    return context.json(detail);
  });

  app.get('/api/v1/templates/:id/download', async (context) => {
    const repository = createTemplateRepository(context.env?.MARKETPLACE_DB);
    const response = await repository.buildDownloadResponse(context.req.param('id'), context.req.query('version'));
    if (!response) {
      return context.json(makeMarketplaceApiError('template_or_version_not_found', 'Template version was not found.'), 404);
    }
    if (context.env?.TEMPLATE_BUCKET) {
      const objectResponse = await buildR2TemplateDownloadResponse(context.env.TEMPLATE_BUCKET, response);
      if (!objectResponse) {
        return context.json(makeMarketplaceApiError('template_object_not_found', 'Template object was not found in R2.'), 404);
      }
      await repository.recordDownload(response.templateId, response.versionId);
      return objectResponse;
    }
    return context.json(response);
  });

  app.get('/api/v1/templates/:id/thumbnail', async (context) => {
    const repository = createTemplateRepository(context.env?.MARKETPLACE_DB);
    const detail = await repository.getTemplateDetail(context.req.param('id'));
    if (!detail) {
      return context.json(makeMarketplaceApiError('template_not_found', 'Template was not found.'), 404);
    }

    const version = selectTemplateVersion(detail.template, context.req.query('version'));
    if (!version) {
      return context.json(makeMarketplaceApiError('template_version_not_found', 'Template version was not found.'), 404);
    }

    if (context.env?.TEMPLATE_BUCKET) {
      const objectResponse = await buildR2TemplateThumbnailResponse(context.env.TEMPLATE_BUCKET, version.thumbnailKey);
      if (!objectResponse) {
        return context.json(makeMarketplaceApiError('thumbnail_object_not_found', 'Template thumbnail was not found in R2.'), 404);
      }
      return objectResponse;
    }

    return buildSeedTemplateThumbnailResponse(detail.template, version);
  });

  app.notFound((context) => context.json(makeMarketplaceApiError('not_found', 'Route was not found.'), 404));

  return app;
}

function selectTemplateVersion(template: MarketplaceTemplateDetail, versionId?: string): MarketplaceTemplateVersion | undefined {
  if (!versionId) {
    return template.latestVersion;
  }
  return template.versions.find((version) => version.id === versionId);
}

function buildSeedTemplateThumbnailResponse(template: MarketplaceTemplateDetail, version: MarketplaceTemplateVersion): Response {
  const escapedName = escapeSvgText(template.name);
  const escapedVersion = escapeSvgText(`v${version.versionNumber}`);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360" role="img" aria-label="${escapedName} thumbnail">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#365346"/>
      <stop offset="1" stop-color="#d8bf96"/>
    </linearGradient>
    <radialGradient id="glow" cx="24%" cy="18%" r="58%">
      <stop offset="0" stop-color="#fff4d8" stop-opacity="0.8"/>
      <stop offset="1" stop-color="#fff4d8" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="640" height="360" fill="url(#bg)"/>
  <rect width="640" height="360" fill="url(#glow)"/>
  <g fill="#fff8e8" fill-opacity="0.92" stroke="#fff" stroke-opacity="0.62" stroke-width="4">
    <rect x="82" y="62" width="190" height="78" rx="24"/>
    <rect x="82" y="178" width="190" height="98" rx="24"/>
    <rect x="330" y="178" width="190" height="98" rx="24"/>
  </g>
  <path d="M178 140v87h152" fill="none" stroke="#fff8e8" stroke-opacity="0.56" stroke-width="8" stroke-linecap="round"/>
  <text x="82" y="314" fill="#fff" font-family="ui-sans-serif, system-ui, sans-serif" font-size="34" font-weight="700">${escapedName}</text>
  <text x="558" y="70" fill="#fff" fill-opacity="0.78" text-anchor="end" font-family="ui-sans-serif, system-ui, sans-serif" font-size="18" font-weight="700">${escapedVersion}</text>
</svg>`;
  return new Response(svg, {
    headers: {
      'content-type': 'image/svg+xml; charset=utf-8',
      'cache-control': 'public, max-age=300',
      'x-marketplace-storage-mode': 'seed'
    }
  });
}

function escapeSvgText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function parseListTemplatesQuery(url: URL): MarketplaceListTemplatesRequest {
  const sort = url.searchParams.get('sort');
  const page = Number.parseInt(url.searchParams.get('page') ?? '', 10);
  const pageSize = Number.parseInt(url.searchParams.get('pageSize') ?? '', 10);
  const tags = url.searchParams
    .getAll('tag')
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter(Boolean);
  const parsedSort = MARKETPLACE_SORT_VALUES.find((value) => value === sort);

  return {
    q: url.searchParams.get('q') ?? undefined,
    tags: tags.length > 0 ? tags : undefined,
    sort: parsedSort,
    page: Number.isFinite(page) ? page : undefined,
    pageSize: Number.isFinite(pageSize) ? pageSize : undefined
  };
}
