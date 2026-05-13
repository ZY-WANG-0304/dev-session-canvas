import { Hono } from 'hono';

import {
  makeMarketplaceApiError,
  MARKETPLACE_SORT_VALUES,
  type MarketplaceListTemplatesRequest
} from '@dev-session-canvas/marketplace-shared';

import { buildR2TemplateDownloadResponse } from './download';
import { createTemplateRepository } from './repository';

export interface MarketplaceWorkerEnv {
  ASSETS?: Fetcher;
  MARKETPLACE_DB?: D1Database;
  TEMPLATE_BUCKET?: R2Bucket;
}

export function createMarketplaceWorkerApp(): Hono<{ Bindings: MarketplaceWorkerEnv }> {
  const app = new Hono<{ Bindings: MarketplaceWorkerEnv }>();

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

  app.notFound((context) => context.json(makeMarketplaceApiError('not_found', 'Route was not found.'), 404));

  return app;
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
