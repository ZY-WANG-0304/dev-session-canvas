import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadMarketplaceTemplateDetail, loadMarketplaceTemplates } from './api';

describe('marketplace web api client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads templates from the Worker API when available', async () => {
    const requests: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        requests.push(String(input));
        return new Response(
          JSON.stringify({
            items: [
              {
                id: 'from-api',
                slug: 'from-api',
                name: 'From API',
                description: 'API result',
                tags: [],
                publisher: { id: 'publisher', githubLogin: 'publisher', displayName: 'Publisher', avatarUrl: '' },
                latestVersion: {
                  id: 'version',
                  templateId: 'from-api',
                  versionNumber: 1,
                  changelog: '',
                  objectKey: 'templates/from-api/versions/1/template.json',
                  thumbnailKey: 'templates/from-api/versions/1/thumbnail.png',
                  sha256: 'sha',
                  sizeBytes: 1,
                  schemaVersion: 1,
                  status: 'published',
                  createdAt: '2026-05-10T00:00:00.000Z'
                },
                status: 'published',
                downloadCount: 1,
                likeCount: 1,
                hotScore: 1,
                createdAt: '2026-05-10T00:00:00.000Z',
                updatedAt: '2026-05-10T00:00:00.000Z'
              }
            ],
            pagination: { page: 1, pageSize: 12, total: 1, hasMore: false },
            storageMode: 'seed'
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      })
    );

    const result = await loadMarketplaceTemplates({ q: 'api', sort: 'hot', tags: ['review', 'quality'] });

    expect(result.source).toBe('api');
    expect(result.templates[0]?.slug).toBe('from-api');
    expect(requests[0]).toBe('/api/v1/templates?q=api&tag=review&tag=quality&sort=hot');
  });

  it('falls back to seed templates during local development', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not found', { status: 404 })));

    const result = await loadMarketplaceTemplates({ q: 'review', sort: 'hot', tags: ['quality'] });

    expect(result.source).toBe('seed-fallback');
    expect(result.templates.map((template) => template.slug)).toEqual(['review-loop']);
  });

  it('loads template detail from the Worker API', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            template: {
              id: 'from-api',
              slug: 'from-api',
              name: 'From API',
              description: 'API detail',
              tags: ['api'],
              publisher: { id: 'publisher', githubLogin: 'publisher', displayName: 'Publisher', avatarUrl: '' },
              latestVersion: {
                id: 'version',
                templateId: 'from-api',
                versionNumber: 1,
                changelog: 'Initial version.',
                objectKey: 'templates/from-api/versions/1/template.json',
                thumbnailKey: 'templates/from-api/versions/1/thumbnail.png',
                sha256: 'sha',
                sizeBytes: 1,
                schemaVersion: 1,
                status: 'published',
                createdAt: '2026-05-10T00:00:00.000Z'
              },
              versions: [],
              status: 'published',
              downloadCount: 1,
              likeCount: 1,
              hotScore: 1,
              createdAt: '2026-05-10T00:00:00.000Z',
              updatedAt: '2026-05-10T00:00:00.000Z',
              readme: 'API detail readme',
              providerWarnings: []
            },
            storageMode: 'd1'
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )
    );

    const result = await loadMarketplaceTemplateDetail('from-api');

    expect(result.source).toBe('api');
    expect(result.storageMode).toBe('d1');
    expect(result.template?.readme).toBe('API detail readme');
  });

  it('falls back to seed template detail during local development', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not found', { status: 404 })));

    const result = await loadMarketplaceTemplateDetail('review-loop');

    expect(result.source).toBe('seed-fallback');
    expect(result.template?.slug).toBe('review-loop');
  });
});
