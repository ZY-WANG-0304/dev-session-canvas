import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  checkMarketplaceSlugAvailability,
  loadCurrentMarketplaceUser,
  loadMarketplaceTemplateDetail,
  loadMarketplaceTemplates,
  loadMyMarketplaceTemplates,
  normalizeTemplateSearchQuery,
  publishMarketplaceTemplate
} from './api';

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

  it('clamps overlong search queries for API and seed fallback paths', async () => {
    const requests: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        requests.push(String(input));
        return new Response('not found', { status: 404 });
      })
    );

    const result = await loadMarketplaceTemplates({ q: 'x'.repeat(120), sort: 'hot' });
    const requestUrl = new URL(requests[0] ?? '', 'http://localhost');

    expect(requestUrl.searchParams.get('q')).toHaveLength(80);
    expect(result.source).toBe('seed-fallback');
    expect(result.templates).toHaveLength(0);
  });

  it('normalizes search queries to the public schema limit', () => {
    expect(normalizeTemplateSearchQuery(`  ${'x'.repeat(120)}  `)).toHaveLength(80);
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

  it('loads the current marketplace user when authenticated', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ user: { githubUserId: '1', githubLogin: 'publisher', displayName: 'Publisher', avatarUrl: '' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      )
    );

    const result = await loadCurrentMarketplaceUser();

    expect(result.user?.githubLogin).toBe('publisher');
  });

  it('treats a 401 current user response as signed out', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 'auth_required' } }), { status: 401 })));

    await expect(loadCurrentMarketplaceUser()).resolves.toEqual({});
  });

  it('loads templates published by the current user', async () => {
    const requests: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        requests.push(String(input));
        return new Response(
          JSON.stringify({
            items: [
              {
                id: 'mine',
                slug: 'mine',
                name: 'Mine',
                description: 'Published by me.',
                tags: ['mine'],
                publisher: { id: 'publisher', githubLogin: 'publisher', displayName: 'Publisher', avatarUrl: '' },
                latestVersion: {
                  id: 'version',
                  templateId: 'mine',
                  versionNumber: 1,
                  changelog: '',
                  objectKey: 'templates/mine/versions/1/template.json',
                  thumbnailKey: 'templates/mine/versions/1/thumbnail.png',
                  sha256: 'sha',
                  sizeBytes: 1,
                  schemaVersion: 1,
                  status: 'published',
                  createdAt: '2026-05-14T00:00:00.000Z'
                },
                status: 'published',
                downloadCount: 1,
                likeCount: 0,
                hotScore: 1,
                createdAt: '2026-05-14T00:00:00.000Z',
                updatedAt: '2026-05-14T00:00:00.000Z'
              }
            ],
            pagination: { page: 1, pageSize: 50, total: 1, hasMore: false },
            storageMode: 'd1'
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      })
    );

    const result = await loadMyMarketplaceTemplates();

    expect(requests[0]).toBe('/api/v1/me/templates');
    expect(result.items.map((template) => template.slug)).toEqual(['mine']);
  });

  it('checks slug availability through the Worker API', async () => {
    const requests: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        requests.push(String(input));
        return new Response(JSON.stringify({ slug: 'review-loop', available: false, storageMode: 'd1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      })
    );

    const result = await checkMarketplaceSlugAvailability('Review Loop');

    expect(requests[0]).toBe('/api/v1/templates/slug-availability?slug=review-loop');
    expect(result.available).toBe(false);
  });

  it('posts publish requests to the Worker API', async () => {
    const requests: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requests.push({ input, init });
        return new Response(
          JSON.stringify({
            template: {
              id: 'tmpl-published',
              slug: 'published-template',
              name: 'Published Template',
              description: 'Published from web.',
              tags: ['review'],
              publisher: { id: 'publisher', githubLogin: 'publisher', displayName: 'Publisher', avatarUrl: '' },
              latestVersion: {
                id: 'ver-published-1',
                templateId: 'tmpl-published',
                versionNumber: 1,
                changelog: 'Initial version.',
                objectKey: 'templates/tmpl-published/versions/1/template.json',
                thumbnailKey: 'templates/tmpl-published/versions/1/thumbnail.png',
                sha256: 'sha',
                sizeBytes: 1,
                schemaVersion: 1,
                status: 'published',
                createdAt: '2026-05-14T00:00:00.000Z'
              },
              versions: [],
              status: 'published',
              downloadCount: 0,
              likeCount: 0,
              hotScore: 0,
              createdAt: '2026-05-14T00:00:00.000Z',
              updatedAt: '2026-05-14T00:00:00.000Z',
              readme: 'Readme',
              providerWarnings: []
            },
            storageMode: 'd1'
          }),
          { status: 201, headers: { 'content-type': 'application/json' } }
        );
      })
    );

    const result = await publishMarketplaceTemplate({
      name: 'Published Template',
      description: 'Published from web.',
      tags: ['review'],
      templateDocument: {
        version: 1,
        template: {
          id: 'published-template',
          name: 'Published Template',
          category: 'user',
          nodes: [{ kind: 'note', title: 'Readme', position: { x: 0, y: 0 }, size: { width: 320, height: 200 } }],
          edges: [],
          createdAt: '2026-05-14T00:00:00.000Z',
          updatedAt: '2026-05-14T00:00:00.000Z'
        }
      }
    });

    expect(result.template.slug).toBe('published-template');
    expect(requests[0]?.input).toBe('/api/v1/templates');
    expect(requests[0]?.init?.method).toBe('POST');
  });

  it('surfaces publish API errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ error: { code: 'template_slug_conflict', message: 'A template with this slug already exists.' } }), {
          status: 409,
          headers: { 'content-type': 'application/json' }
        })
      )
    );

    await expect(
      publishMarketplaceTemplate({
        name: 'Duplicate',
        description: 'Duplicate slug.',
        tags: [],
        templateDocument: {
          version: 1,
          template: {
            id: 'duplicate',
            name: 'Duplicate',
            category: 'user',
            nodes: [{ kind: 'note', title: 'Note', position: { x: 0, y: 0 }, size: { width: 320, height: 200 } }],
            edges: [],
            createdAt: '2026-05-14T00:00:00.000Z',
            updatedAt: '2026-05-14T00:00:00.000Z'
          }
        }
      })
    ).rejects.toThrow('A template with this slug already exists.');
  });
});
