import { afterEach, describe, expect, it, vi } from 'vitest';
import { unzipSync, zipSync } from 'fflate';

import {
  checkMarketplaceSlugAvailability,
  loadCurrentMarketplaceUser,
  loadMarketplaceTemplateDetail,
  loadMarketplaceTemplates,
  loadMyMarketplaceLikes,
  loadMyMarketplaceStats,
  loadMyMarketplaceTemplates,
  normalizeTemplateSearchQuery,
  publishMarketplaceTemplate,
  publishMarketplaceTemplatePackage,
  setMarketplaceTemplateLike
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

  it('loads templates liked by the current user', async () => {
    const requests: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        requests.push(String(input));
        return new Response(
          JSON.stringify({
            items: [
              {
                id: 'liked',
                slug: 'liked-template',
                name: 'Liked Template',
                description: 'Liked by me.',
                tags: ['liked'],
                publisher: { id: 'publisher', githubLogin: 'publisher', displayName: 'Publisher', avatarUrl: '' },
                latestVersion: {
                  id: 'version',
                  templateId: 'liked',
                  versionNumber: 1,
                  changelog: '',
                  objectKey: 'templates/liked/versions/1/template.json',
                  thumbnailKey: 'templates/liked/versions/1/thumbnail.png',
                  sha256: 'sha',
                  sizeBytes: 1,
                  schemaVersion: 1,
                  status: 'published',
                  createdAt: '2026-05-14T00:00:00.000Z'
                },
                status: 'published',
                downloadCount: 1,
                likeCount: 1,
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

    const result = await loadMyMarketplaceLikes();

    expect(requests[0]).toBe('/api/v1/me/likes');
    expect(result.items.map((template) => template.slug)).toEqual(['liked-template']);
  });

  it('loads publisher dashboard stats', async () => {
    const requests: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        requests.push(String(input));
        return new Response(
          JSON.stringify({
            totals: { templateCount: 1, downloadCount: 44, likeCount: 9, publishCount: 2 },
            daily: [{ day: '2026-05-10', downloadCount: 3, likeCount: 2, publishCount: 1 }],
            templates: [],
            storageMode: 'd1'
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      })
    );

    const result = await loadMyMarketplaceStats();

    expect(requests[0]).toBe('/api/v1/me/stats');
    expect(result.totals.downloadCount).toBe(44);
    expect(result.daily[0]?.likeCount).toBe(2);
  });

  it('posts template like target states to the Worker API', async () => {
    const requests: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requests.push({ input, init });
        return new Response(JSON.stringify({ templateId: 'tmpl-liked', liked: true, likeCount: 10, storageMode: 'd1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      })
    );

    const result = await setMarketplaceTemplateLike('review-loop', true);

    expect(result.liked).toBe(true);
    expect(requests[0]?.input).toBe('/api/v1/templates/review-loop/like');
    expect(requests[0]?.init?.method).toBe('POST');
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({ liked: true });
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

  it('posts package zip publish requests to the Worker API', async () => {
    const requests: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requests.push({ input, init });
        return new Response(
          JSON.stringify({
            template: {
              id: 'tmpl-package',
              slug: 'package-template',
              name: 'Package Template',
              description: 'Published from a package.',
              tags: ['package'],
              publisher: { id: 'publisher', githubLogin: 'publisher', displayName: 'Publisher', avatarUrl: '' },
              latestVersion: {
                id: 'ver-package-1',
                templateId: 'tmpl-package',
                versionNumber: 1,
                changelog: 'Initial version.',
                objectKey: 'templates/tmpl-package/versions/ver-package-1/template.json',
                thumbnailKey: 'templates/tmpl-package/versions/ver-package-1/thumbnail.png',
                sha256: 'sha',
                sizeBytes: 1,
                schemaVersion: 1,
                status: 'published',
                createdAt: '2026-05-28T00:00:00.000Z'
              },
              versions: [],
              status: 'published',
              downloadCount: 0,
              likeCount: 0,
              hotScore: 0,
              createdAt: '2026-05-28T00:00:00.000Z',
              updatedAt: '2026-05-28T00:00:00.000Z',
              readme: 'Readme',
              providerWarnings: []
            },
            storageMode: 'd1'
          }),
          { status: 201, headers: { 'content-type': 'application/json' } }
        );
      })
    );

    const result = await publishMarketplaceTemplatePackage(new File([new Uint8Array([0x50, 0x4b])], 'package.zip', { type: 'application/zip' }));

    expect(result.template.slug).toBe('package-template');
    expect(requests[0]?.input).toBe('/api/v1/templates/package');
    expect(requests[0]?.init?.method).toBe('POST');
    expect(requests[0]?.init?.body).toBeInstanceOf(FormData);
    expect((requests[0]?.init?.headers as Record<string, string>)['content-type']).toBeUndefined();
  });

  it('sends the provided rebuilt package zip bytes', async () => {
    let uploadedFile: File | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        uploadedFile = (init?.body as FormData).get('package') as File;
        return new Response(
          JSON.stringify({
            template: {
              id: 'tmpl-package',
              slug: 'edited-package',
              name: 'Edited Package',
              description: 'Published from a rebuilt package.',
              tags: ['package'],
              publisher: { id: 'publisher', githubLogin: 'publisher', displayName: 'Publisher', avatarUrl: '' },
              latestVersion: {
                id: 'ver-package-1',
                templateId: 'tmpl-package',
                versionNumber: 1,
                changelog: 'Initial version.',
                objectKey: 'templates/tmpl-package/versions/ver-package-1/template.json',
                thumbnailKey: 'templates/tmpl-package/versions/ver-package-1/thumbnail.png',
                sha256: 'sha',
                sizeBytes: 1,
                schemaVersion: 1,
                status: 'published',
                createdAt: '2026-05-28T00:00:00.000Z'
              },
              versions: [],
              status: 'published',
              downloadCount: 0,
              likeCount: 0,
              hotScore: 0,
              createdAt: '2026-05-28T00:00:00.000Z',
              updatedAt: '2026-05-28T00:00:00.000Z',
              readme: 'Readme',
              providerWarnings: []
            },
            storageMode: 'd1'
          }),
          { status: 201, headers: { 'content-type': 'application/json' } }
        );
      })
    );

    const zipBytes = zipSync({
      'template-package.json': new TextEncoder().encode(JSON.stringify({ schemaVersion: 1, slug: 'edited-package', name: 'Edited Package' }))
    });
    await publishMarketplaceTemplatePackage(new File([zipBytes], 'rebuilt-package.zip', { type: 'application/zip' }));

    expect(uploadedFile?.name).toBe('rebuilt-package.zip');
    const entries = unzipSync(new Uint8Array(await uploadedFile!.arrayBuffer()));
    expect(JSON.parse(new TextDecoder().decode(entries['template-package.json']))).toEqual(expect.objectContaining({ slug: 'edited-package' }));
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
