import { describe, expect, it, vi } from 'vitest';
import { unzipSync, zipSync } from 'fflate';

import { buildMarketplacePackageObjectKey } from '@dev-session-canvas/marketplace-shared';
import { createMarketplaceWorkerApp } from './app';
import { createFakeD1Database, type FakeD1Run } from './testD1Database';
import { createFakeR2Bucket } from './testR2Bucket';

const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04] as const;

describe('template marketplace worker api', () => {
  const app = createMarketplaceWorkerApp();

  it('returns a health payload', async () => {
    const response = await app.request('http://localhost/api/v1/health');
    const body = await response.json<{ ok: boolean; storageMode: string }>();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.storageMode).toBe('seed');
  });

  it('lists templates with query filtering', async () => {
    const response = await app.request('http://localhost/api/v1/templates?q=review&tag=quality');
    const body = await response.json<{ items: Array<{ slug: string }>; storageMode: string }>();

    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(body.storageMode).toBe('seed');
    expect(body.items.map((item) => item.slug)).toEqual(['review-loop']);
  });

  it('allows Webview and browser clients to preflight public API requests', async () => {
    const response = await app.request('http://localhost/api/v1/templates', {
      method: 'OPTIONS',
      headers: {
        origin: 'vscode-webview://dev-session-canvas',
        'access-control-request-method': 'GET'
      }
    });

    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('access-control-allow-methods')).toContain('GET');
  });

  it('does not apply public CORS to authenticated write API preflights', async () => {
    const response = await app.request('http://localhost/api/v1/templates', {
      method: 'OPTIONS',
      headers: {
        origin: 'https://dscanvas.dev',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization,content-type'
      }
    });

    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(response.headers.get('access-control-allow-methods')).toBeNull();
  });

  it('does not add public CORS headers to authenticated write API responses', async () => {
    const response = await app.request('http://localhost/api/v1/templates', {
      method: 'POST',
      body: JSON.stringify(buildPublishRequest()),
      headers: {
        origin: 'https://dscanvas.dev',
        'content-type': 'application/json'
      }
    });

    expect(response.status).toBe(401);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('uses D1 repository when the binding is present', async () => {
    const response = await app.request('http://localhost/api/v1/templates?q=d1', {}, { MARKETPLACE_DB: createFakeD1Database() });
    const body = await response.json<{ items: Array<{ slug: string }>; storageMode: string }>();

    expect(response.status).toBe(200);
    expect(body.storageMode).toBe('d1');
    expect(body.items.map((item) => item.slug)).toEqual(['d1-review-loop']);
  });

  it('checks template slug availability from D1 metadata', async () => {
    const existing = await app.request('http://localhost/api/v1/templates/slug-availability?slug=d1-review-loop', {}, { MARKETPLACE_DB: createFakeD1Database() });
    const existingBody = await existing.json<{ slug: string; available: boolean; storageMode: string }>();
    const available = await app.request('http://localhost/api/v1/templates/slug-availability?slug=new-template', {}, { MARKETPLACE_DB: createFakeD1Database() });
    const availableBody = await available.json<{ slug: string; available: boolean; storageMode: string }>();

    expect(existing.status).toBe(200);
    expect(existingBody).toEqual({ slug: 'd1-review-loop', available: false, storageMode: 'd1' });
    expect(available.status).toBe(200);
    expect(availableBody).toEqual({ slug: 'new-template', available: true, storageMode: 'd1' });
  });

  it('returns template details by slug', async () => {
    const response = await app.request('http://localhost/api/v1/templates/release-readiness');
    const body = await response.json<{ template: { id: string; versions: unknown[] } }>();

    expect(response.status).toBe(200);
    expect(body.template.id).toBe('tmpl-release-readiness');
    expect(body.template.versions).toHaveLength(1);
  });

  it('builds seed full package download metadata', async () => {
    const response = await app.request('http://localhost/api/v1/templates/review-loop/download');
    const body = await response.json<{ storageMode: string; packageObjectKey: string; packageDownloadUrl: string }>();

    expect(response.status).toBe(200);
    expect(body.storageMode).toBe('seed');
    expect(body.packageObjectKey).toContain('/versions/2/package.zip');
    expect(body.packageDownloadUrl).toBe('/api/v1/templates/tmpl-review-loop/download?version=ver-review-loop-2');
  });

  it('builds seed lightweight template JSON export metadata', async () => {
    const response = await app.request('http://localhost/api/v1/templates/review-loop/template.json');
    const body = await response.json<{ storageMode: string; objectKey: string; downloadUrl: string }>();

    expect(response.status).toBe(200);
    expect(body.storageMode).toBe('seed');
    expect(body.objectKey).toContain('/versions/2/template.json');
    expect(body.downloadUrl).toBe('/api/v1/templates/tmpl-review-loop/template.json?version=ver-review-loop-2');
  });

  it('streams lightweight template JSON exports from R2 when the bucket binding is present', async () => {
    const objectKey = 'templates/tmpl-d1-review/versions/2/template.json';
    const runLog: Array<{ sql: string; boundValues: unknown[] }> = [];
    const expectedDay = new Date().toISOString().slice(0, 10);
    const response = await app.request(
      'http://localhost/api/v1/templates/d1-review-loop/template.json',
      {},
      {
        MARKETPLACE_DB: createFakeD1Database(runLog),
        TEMPLATE_BUCKET: createFakeR2Bucket({
          [objectKey]: JSON.stringify({
            version: 1,
            template: {
              id: 'downloaded-from-r2',
              name: 'Downloaded from R2',
              category: 'user',
              createdAt: '2026-05-10T00:00:00.000Z',
              updatedAt: '2026-05-10T00:00:00.000Z',
              nodes: [{ kind: 'note', title: 'R2 object', position: { x: 0, y: 0 }, size: { width: 300, height: 200 } }],
              edges: []
            }
          })
        })
      }
    );
    const body = await response.json<{ template: { id: string } }>();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="tmpl-d1-review-v2.json"');
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('access-control-expose-headers')).toContain('x-marketplace-sha256');
    expect(response.headers.get('x-marketplace-storage-mode')).toBe('r2');
    expect(response.headers.get('x-marketplace-catalog-storage-mode')).toBe('d1');
    expect(response.headers.get('x-marketplace-template-id')).toBe('tmpl-d1-review');
    expect(body.template.id).toBe('downloaded-from-r2');
    expect(runLog).toHaveLength(2);
    expect(runLog[0]?.sql).toContain('UPDATE templates SET download_count = download_count + 1');
    expect(runLog[0]?.boundValues).toEqual(['tmpl-d1-review']);
    expect(runLog[1]?.sql).toContain('INSERT INTO template_daily_stats');
    expect(runLog[1]?.boundValues).toEqual(['tmpl-d1-review', expectedDay]);
  });

  it('streams full template packages from R2 through the primary download endpoint when the bucket binding is present', async () => {
    const packageKey = 'templates/tmpl-d1-review/versions/2/package.zip';
    const runLog: Array<{ sql: string; boundValues: unknown[] }> = [];
    const expectedDay = new Date().toISOString().slice(0, 10);
    const response = await app.request(
      'http://localhost/api/v1/templates/d1-review-loop/download',
      {},
      {
        MARKETPLACE_DB: createFakeD1Database(runLog),
        TEMPLATE_BUCKET: createFakeR2Bucket({
          [packageKey]: {
            content: new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
            contentType: 'application/zip'
          }
        })
      }
    );
    const body = new Uint8Array(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="tmpl-d1-review-v2.zip"');
    expect(response.headers.get('content-type')).toBe('application/zip');
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('x-marketplace-storage-mode')).toBe('r2');
    expect(response.headers.get('x-marketplace-catalog-storage-mode')).toBe('d1');
    expect(response.headers.get('x-marketplace-template-id')).toBe('tmpl-d1-review');
    expect(Array.from(body)).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(runLog).toHaveLength(2);
    expect(runLog[0]?.sql).toContain('UPDATE templates SET download_count = download_count + 1');
    expect(runLog[0]?.boundValues).toEqual(['tmpl-d1-review']);
    expect(runLog[1]?.sql).toContain('INSERT INTO template_daily_stats');
    expect(runLog[1]?.boundValues).toEqual(['tmpl-d1-review', expectedDay]);
  });

  it('generates a full template package download when legacy R2 versions only have template.json', async () => {
    const objectKey = 'templates/tmpl-d1-review/versions/2/template.json';
    const thumbnailKey = 'templates/tmpl-d1-review/versions/2/thumbnail.png';
    const runLog: Array<{ sql: string; boundValues: unknown[] }> = [];
    const response = await app.request(
      'http://localhost/api/v1/templates/d1-review-loop/download',
      {},
      {
        MARKETPLACE_DB: createFakeD1Database(runLog),
        TEMPLATE_BUCKET: createFakeR2Bucket({
          [objectKey]: JSON.stringify(buildPublishRequest().templateDocument),
          [thumbnailKey]: {
            content: decodeBase64Png(),
            contentType: 'image/png'
          }
        })
      }
    );
    const body = new Uint8Array(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="tmpl-d1-review-v2.zip"');
    expect(response.headers.get('content-type')).toBe('application/zip');
    expect(response.headers.get('x-marketplace-package-source')).toBe('generated-from-template-json');
    expect(Array.from(body.slice(0, 4))).toEqual(ZIP_SIGNATURE);
    expect(runLog[0]?.sql).toContain('UPDATE templates SET download_count = download_count + 1');
  });

  it('keeps the transitional package endpoint as a full template package alias', async () => {
    const packageKey = 'templates/tmpl-d1-review/versions/2/package.zip';
    const response = await app.request(
      'http://localhost/api/v1/templates/d1-review-loop/package',
      {},
      {
        MARKETPLACE_DB: createFakeD1Database(),
        TEMPLATE_BUCKET: createFakeR2Bucket({
          [packageKey]: {
            content: new Uint8Array([0x50, 0x4b]),
            contentType: 'application/zip'
          }
        })
      }
    );
    const body = new Uint8Array(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="tmpl-d1-review-v2.zip"');
    expect(Array.from(body)).toEqual([0x50, 0x4b]);
  });

  it('forces application/zip for package downloads even if R2 kept stale JSON metadata', async () => {
    const packageKey = 'templates/tmpl-d1-review/versions/2/package.zip';
    const response = await app.request(
      'http://localhost/api/v1/templates/d1-review-loop/download',
      {},
      {
        MARKETPLACE_DB: createFakeD1Database(),
        TEMPLATE_BUCKET: createFakeR2Bucket({
          [packageKey]: {
            content: new Uint8Array(ZIP_SIGNATURE),
            contentType: 'application/json'
          }
        })
      }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="tmpl-d1-review-v2.zip"');
    expect(response.headers.get('content-type')).toBe('application/zip');
  });

  it('streams thumbnails from R2 without recording a download', async () => {
    const thumbnailKey = 'templates/tmpl-d1-review/versions/2/thumbnail.png';
    const runLog: Array<{ sql: string; boundValues: unknown[] }> = [];
    const response = await app.request(
      'http://localhost/api/v1/templates/d1-review-loop/thumbnail',
      {},
      {
        MARKETPLACE_DB: createFakeD1Database(runLog),
        TEMPLATE_BUCKET: createFakeR2Bucket({
          [thumbnailKey]: {
            content: new Uint8Array([137, 80, 78, 71]),
            contentType: 'image/png'
          }
        })
      }
    );
    const body = new Uint8Array(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('cache-control')).toContain('s-maxage=86400');
    expect(response.headers.get('x-marketplace-storage-mode')).toBe('r2');
    expect(Array.from(body)).toEqual([137, 80, 78, 71]);
    expect(runLog).toHaveLength(0);
  });

  it('returns a generated seed thumbnail when no bucket binding is present', async () => {
    const response = await app.request('http://localhost/api/v1/templates/review-loop/thumbnail');
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('image/svg+xml');
    expect(response.headers.get('x-marketplace-storage-mode')).toBe('seed');
    expect(body).toContain('Review Loop');
  });

  it('returns a structured 404 when D1 metadata points to a missing template JSON object', async () => {
    const response = await app.request(
      'http://localhost/api/v1/templates/d1-review-loop/template.json',
      {},
      {
        MARKETPLACE_DB: createFakeD1Database(),
        TEMPLATE_BUCKET: createFakeR2Bucket({})
      }
    );
    const body = await response.json<{ error: { code: string } }>();

    expect(response.status).toBe(404);
    expect(body.error.code).toBe('template_object_not_found');
  });

  it('returns a structured 404 when a package object is missing from the primary download endpoint', async () => {
    const response = await app.request(
      'http://localhost/api/v1/templates/d1-review-loop/download',
      {},
      {
        MARKETPLACE_DB: createFakeD1Database(),
        TEMPLATE_BUCKET: createFakeR2Bucket({})
      }
    );
    const body = await response.json<{ error: { code: string } }>();

    expect(response.status).toBe(404);
    expect(body.error.code).toBe('template_package_object_not_found');
  });

  it('returns a structured 404 when a thumbnail object is missing', async () => {
    const response = await app.request(
      'http://localhost/api/v1/templates/d1-review-loop/thumbnail',
      {},
      {
        MARKETPLACE_DB: createFakeD1Database(),
        TEMPLATE_BUCKET: createFakeR2Bucket({})
      }
    );
    const body = await response.json<{ error: { code: string } }>();

    expect(response.status).toBe(404);
    expect(body.error.code).toBe('thumbnail_object_not_found');
  });

  it('returns a structured 404 when a thumbnail version is unknown', async () => {
    const response = await app.request('http://localhost/api/v1/templates/review-loop/thumbnail?version=missing-version');
    const body = await response.json<{ error: { code: string } }>();

    expect(response.status).toBe(404);
    expect(body.error.code).toBe('template_version_not_found');
  });

  it('returns structured 404 errors', async () => {
    const response = await app.request('http://localhost/api/v1/templates/missing-template');
    const body = await response.json<{ error: { code: string } }>();

    expect(response.status).toBe(404);
    expect(body.error.code).toBe('template_not_found');
  });

  it('starts GitHub OAuth with state and PKCE parameters', async () => {
    const response = await app.request(
      'https://marketplace.test/api/v1/auth/github/start',
      {},
      {
        GITHUB_CLIENT_ID: 'client-id',
        MARKETPLACE_SESSION_SECRET: 'session-secret'
      }
    );
    const location = new URL(response.headers.get('location') ?? '');

    expect(response.status).toBe(302);
    expect(location.origin).toBe('https://github.com');
    expect(location.searchParams.get('client_id')).toBe('client-id');
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    expect(location.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(response.headers.get('set-cookie')).toContain('dsc_marketplace_oauth_state=');
  });

  it('returns to the initiating marketplace page after GitHub OAuth', async () => {
    stubGithubOAuthFetch();
    try {
      const response = await runGithubOAuthRoundTrip(app, '/templates/publish');

      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toBe('https://marketplace.test/templates/publish');
      expect(response.headers.get('set-cookie')).toContain('dsc_marketplace_session=');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('falls back to the marketplace home for unsafe OAuth return paths', async () => {
    stubGithubOAuthFetch();
    try {
      const response = await runGithubOAuthRoundTrip(app, 'https://evil.example/templates/publish');

      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toBe('https://marketplace.test/templates');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('clears browser sessions on sign out and returns to a safe marketplace path', async () => {
    const response = await app.request('https://marketplace.test/api/v1/auth/logout?return_to=%2Ftemplates%2Fme', {
      method: 'POST'
    });

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://marketplace.test/templates/me');
    expect(response.headers.get('set-cookie')).toContain('dsc_marketplace_session=');
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it('lists templates for the authenticated publisher', async () => {
    const response = await app.request(
      'http://localhost/api/v1/me/templates',
      {
        headers: {
          'x-marketplace-test-github-login': 'dscanvas-admin'
        }
      },
      {
        MARKETPLACE_ALLOW_TEST_AUTH: 'true',
        MARKETPLACE_DB: createFakeD1Database()
      }
    );
    const body = await response.json<{ items: Array<{ slug: string }>; storageMode: string }>();

    expect(response.status).toBe(200);
    expect(body.storageMode).toBe('d1');
    expect(body.items.map((template) => template.slug)).toEqual(['d1-review-loop']);
  });

  it('requires authentication before listing publisher templates', async () => {
    const response = await app.request('http://localhost/api/v1/me/templates');
    const body = await response.json<{ error: { code: string } }>();

    expect(response.status).toBe(401);
    expect(body.error.code).toBe('auth_required');
  });

  it('likes templates for authenticated users', async () => {
    const runLog: FakeD1Run[] = [];
    const response = await app.request(
      'http://localhost/api/v1/templates/d1-review-loop/like',
      {
        method: 'POST',
        body: JSON.stringify({ liked: true }),
        headers: {
          'content-type': 'application/json',
          'x-marketplace-test-github-login': 'community-user',
          'x-marketplace-test-github-user-id': 'test-community-user'
        }
      },
      {
        MARKETPLACE_ALLOW_TEST_AUTH: 'true',
        MARKETPLACE_DB: createFakeD1Database(runLog, { viewerUserId: 'github-test-community-user' })
      }
    );
    const body = await response.json<{ liked: boolean; likeCount: number; storageMode: string }>();

    expect(response.status).toBe(200);
    expect(body).toEqual({ templateId: 'tmpl-d1-review', liked: true, likeCount: 10, storageMode: 'd1' });
    expect(runLog.some((entry) => entry.sql.includes('INSERT INTO template_likes'))).toBe(true);
    expect(runLog.some((entry) => entry.sql.includes('UPDATE templates SET like_count = like_count + 1'))).toBe(true);
    expect(runLog.some((entry) => entry.sql.includes('INSERT INTO template_daily_stats'))).toBe(true);
  });

  it('unlikes templates for authenticated users', async () => {
    const runLog: FakeD1Run[] = [];
    const response = await app.request(
      'http://localhost/api/v1/templates/d1-review-loop/like',
      {
        method: 'POST',
        body: JSON.stringify({ liked: false }),
        headers: {
          'content-type': 'application/json',
          'x-marketplace-test-github-login': 'community-user',
          'x-marketplace-test-github-user-id': 'test-community-user'
        }
      },
      {
        MARKETPLACE_ALLOW_TEST_AUTH: 'true',
        MARKETPLACE_DB: createFakeD1Database(runLog, { viewerUserId: 'github-test-community-user', viewerLiked: true })
      }
    );
    const body = await response.json<{ liked: boolean; likeCount: number }>();

    expect(response.status).toBe(200);
    expect(body.liked).toBe(false);
    expect(body.likeCount).toBe(8);
    expect(runLog.some((entry) => entry.sql.includes('DELETE FROM template_likes'))).toBe(true);
    expect(runLog.some((entry) => entry.sql.includes('like_count = CASE WHEN like_count > 0 THEN like_count - 1 ELSE 0'))).toBe(true);
  });

  it('requires authentication before liking templates', async () => {
    const response = await app.request('http://localhost/api/v1/templates/d1-review-loop/like', { method: 'POST' });
    const body = await response.json<{ error: { code: string } }>();

    expect(response.status).toBe(401);
    expect(body.error.code).toBe('auth_required');
  });

  it('rejects invalid like request bodies', async () => {
    const response = await app.request(
      'http://localhost/api/v1/templates/d1-review-loop/like',
      {
        method: 'POST',
        body: JSON.stringify({ liked: 'yes' }),
        headers: {
          'content-type': 'application/json',
          'x-marketplace-test-github-login': 'community-user'
        }
      },
      {
        MARKETPLACE_ALLOW_TEST_AUTH: 'true',
        MARKETPLACE_DB: createFakeD1Database()
      }
    );
    const body = await response.json<{ error: { code: string } }>();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('like_request_invalid');
  });

  it('lists templates liked by the authenticated user', async () => {
    const response = await app.request(
      'http://localhost/api/v1/me/likes',
      {
        headers: {
          'x-marketplace-test-github-login': 'dscanvas-admin'
        }
      },
      {
        MARKETPLACE_ALLOW_TEST_AUTH: 'true',
        MARKETPLACE_DB: createFakeD1Database([], { viewerLiked: true })
      }
    );
    const body = await response.json<{ items: Array<{ slug: string }>; storageMode: string }>();

    expect(response.status).toBe(200);
    expect(body.storageMode).toBe('d1');
    expect(body.items.map((template) => template.slug)).toEqual(['d1-review-loop']);
  });

  it('returns the authenticated user like state for one template', async () => {
    const response = await app.request(
      'http://localhost/api/v1/templates/d1-review-loop/like',
      {
        headers: {
          'x-marketplace-test-github-login': 'community-user',
          'x-marketplace-test-github-user-id': 'test-community-user'
        }
      },
      {
        MARKETPLACE_ALLOW_TEST_AUTH: 'true',
        MARKETPLACE_DB: createFakeD1Database([], { viewerUserId: 'github-test-community-user', viewerLiked: true })
      }
    );
    const body = await response.json<{ templateId: string; liked: boolean; likeCount: number; storageMode: string }>();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      templateId: 'tmpl-d1-review',
      liked: true,
      likeCount: 9,
      storageMode: 'd1'
    });
  });

  it('returns publisher dashboard stats for the authenticated user', async () => {
    const response = await app.request(
      'http://localhost/api/v1/me/stats',
      {
        headers: {
          'x-marketplace-test-github-login': 'dscanvas-admin'
        }
      },
      {
        MARKETPLACE_ALLOW_TEST_AUTH: 'true',
        MARKETPLACE_DB: createFakeD1Database()
      }
    );
    const body = await response.json<{
      totals: { templateCount: number; downloadCount: number; likeCount: number; publishCount: number };
      daily: Array<{ day: string; downloadCount: number; likeCount: number; publishCount: number }>;
      templates: Array<{ template: { slug: string }; downloadCount: number; likeCount: number }>;
      storageMode: string;
    }>();

    expect(response.status).toBe(200);
    expect(body.storageMode).toBe('d1');
    expect(body.totals).toEqual({ templateCount: 1, downloadCount: 44, likeCount: 9, publishCount: 2 });
    expect(body.daily[0]).toEqual({ day: '2026-05-10', downloadCount: 3, likeCount: 2, publishCount: 1 });
    expect(body.templates[0]).toEqual(expect.objectContaining({ downloadCount: 44, likeCount: 9, publishCount: 2 }));
    expect(body.templates[0]?.template.slug).toBe('d1-review-loop');
  });

  it('exchanges VSCode GitHub identity for a marketplace bearer token in test auth mode', async () => {
    const response = await app.request(
      'http://localhost/api/v1/auth/vscode/exchange',
      {
        method: 'POST',
        body: JSON.stringify({ accessToken: 'test-token' }),
        headers: {
          'content-type': 'application/json',
          'x-marketplace-test-github-login': 'publisher'
        }
      },
      {
        MARKETPLACE_ALLOW_TEST_AUTH: 'true',
        MARKETPLACE_TOKEN_SECRET: 'token-secret',
        MARKETPLACE_DB: createFakeD1Database()
      }
    );
    const body = await response.json<{ token: string; user: { githubLogin: string } }>();

    expect(response.status).toBe(200);
    expect(body.token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(body.user.githubLogin).toBe('publisher');
  });

  it('accepts marketplace bearer tokens for publishing templates', async () => {
    const tokenResponse = await app.request(
      'http://localhost/api/v1/auth/vscode/exchange',
      {
        method: 'POST',
        body: JSON.stringify({ accessToken: 'test-token' }),
        headers: {
          'content-type': 'application/json',
          'x-marketplace-test-github-login': 'publisher'
        }
      },
      {
        MARKETPLACE_ALLOW_TEST_AUTH: 'true',
        MARKETPLACE_TOKEN_SECRET: 'token-secret',
        MARKETPLACE_DB: createFakeD1Database()
      }
    );
    const tokenBody = await tokenResponse.json<{ token: string }>();
    const response = await app.request(
      'http://localhost/api/v1/templates',
      {
        method: 'POST',
        body: JSON.stringify(buildPublishRequest()),
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${tokenBody.token}`
        }
      },
      {
        MARKETPLACE_TOKEN_SECRET: 'token-secret',
        MARKETPLACE_DB: createFakeD1Database(),
        TEMPLATE_BUCKET: createFakeR2Bucket({})
      }
    );

    expect(response.status).toBe(201);
  });

  it('requires authentication before publishing templates', async () => {
    const response = await app.request('http://localhost/api/v1/templates', {
      method: 'POST',
      body: JSON.stringify(buildPublishRequest()),
      headers: { 'content-type': 'application/json' }
    });
    const body = await response.json<{ error: { code: string } }>();

    expect(response.status).toBe(401);
    expect(body.error.code).toBe('auth_required');
  });

  it('publishes a template into D1 metadata and R2 objects with test auth enabled', async () => {
    const runLog: FakeD1Run[] = [];
    const bucket = createFakeR2Bucket({});
    const response = await app.request(
      'http://localhost/api/v1/templates',
      {
        method: 'POST',
        body: JSON.stringify(buildPublishRequest()),
        headers: {
          'content-type': 'application/json',
          'x-marketplace-test-github-login': 'publisher'
        }
      },
      {
        MARKETPLACE_ALLOW_TEST_AUTH: 'true',
        MARKETPLACE_DB: createFakeD1Database(runLog),
        TEMPLATE_BUCKET: bucket,
        MARKETPLACE_ADMIN_GITHUB_LOGINS: 'publisher'
      }
    );
    const body = await response.json<{ template: { slug: string; latestVersion: { versionNumber: number; sha256: string; objectKey: string } }; storageMode: string }>();

    expect(response.status).toBe(201);
    expect(body.storageMode).toBe('d1');
    expect(body.template.slug).toBe('published-review-loop');
    expect(body.template.latestVersion.versionNumber).toBe(1);
    expect(body.template.latestVersion.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(runLog.some((entry) => entry.sql.includes('INSERT INTO users'))).toBe(true);
    expect(runLog.some((entry) => entry.sql.includes('INSERT INTO admin_roles'))).toBe(true);
    expect(runLog.some((entry) => entry.sql.includes('INSERT INTO templates'))).toBe(true);
    expect(runLog.some((entry) => entry.sql.includes('INSERT INTO template_versions'))).toBe(true);
    expect(runLog.some((entry) => entry.sql.includes('INSERT INTO template_daily_stats'))).toBe(true);
    await expect(bucket.get(buildMarketplacePackageObjectKey(body.template.latestVersion.objectKey))).resolves.not.toBeNull();
  });

  it('publishes a template package zip into D1 metadata and canonical R2 objects', async () => {
    const runLog: FakeD1Run[] = [];
    const bucket = createFakeR2Bucket({});
    const formData = new FormData();
    const packageBytes = buildPackageZipFixture({
      templateDocument: {
        ...buildPublishRequest().templateDocument,
        template: {
          ...buildPublishRequest().templateDocument.template,
          name: 'Package Upload Original',
          updatedAt: '2026-05-01T00:00:00.000Z'
        }
      }
    });
    formData.set('package', new File([packageBytes], 'template-package.zip', { type: 'application/zip' }));

    const response = await app.request(
      'http://localhost/api/v1/templates/package',
      {
        method: 'POST',
        body: formData,
        headers: {
          'x-marketplace-test-github-login': 'publisher'
        }
      },
      {
        MARKETPLACE_ALLOW_TEST_AUTH: 'true',
        MARKETPLACE_DB: createFakeD1Database(runLog),
        TEMPLATE_BUCKET: bucket
      }
    );
    const body = await response.json<{
      template: { slug: string; readme: string; latestVersion: { objectKey: string; thumbnailKey: string; sha256: string } };
      storageMode: string;
    }>();

    expect(response.status).toBe(201);
    expect(body.storageMode).toBe('d1');
    expect(body.template.slug).toBe('package-upload-smoke');
    expect(body.template.readme).toContain('![Screenshot](./media/screenshot.png)');
    await expect(bucket.get(body.template.latestVersion.objectKey)).resolves.not.toBeNull();
    await expect(bucket.get(body.template.latestVersion.thumbnailKey)).resolves.not.toBeNull();
    const storedPackage = await bucket.get(buildMarketplacePackageObjectKey(body.template.latestVersion.objectKey));
    const storedManifest = await bucket.get(body.template.latestVersion.objectKey.replace(/template\.json$/u, 'manifest.json'));
    expect(storedPackage).not.toBeNull();
    expect(storedManifest).not.toBeNull();
    const storedPackageEntries = unzipSync(await storedPackage!.bytes());
    const storedTemplateJsonBytes = storedPackageEntries['template.json'];
    const storedManifestJson = JSON.parse(new TextDecoder().decode(storedPackageEntries['template-package.json'])) as { checksums?: { templateSha256?: string } };
    const storedTemplateDocument = JSON.parse(new TextDecoder().decode(storedTemplateJsonBytes)) as { template: { name: string; updatedAt: string } };
    expect(await sha256Hex(storedTemplateJsonBytes)).toBe(body.template.latestVersion.sha256);
    expect(storedManifestJson.checksums?.templateSha256).toBe(body.template.latestVersion.sha256);
    expect(storedTemplateDocument.template.name).toBe('Package Upload Smoke');
    expect(storedTemplateDocument.template.updatedAt).not.toBe('2026-05-01T00:00:00.000Z');
    expect(storedPackageEntries['media/screenshot.png']).toBeDefined();
    expect(runLog.some((entry) => entry.sql.includes('INSERT INTO templates'))).toBe(true);
  });

  it('rejects package uploads with missing README media', async () => {
    const formData = new FormData();
    formData.set('package', new File([buildPackageZipFixture({ readme: '# Broken\n\n![Missing](./media/missing.png)\n' })], 'broken.zip', { type: 'application/zip' }));

    const response = await app.request(
      'http://localhost/api/v1/templates/package',
      {
        method: 'POST',
        body: formData,
        headers: {
          'x-marketplace-test-github-login': 'publisher'
        }
      },
      {
        MARKETPLACE_ALLOW_TEST_AUTH: 'true',
        MARKETPLACE_DB: createFakeD1Database(),
        TEMPLATE_BUCKET: createFakeR2Bucket({})
      }
    );
    const body = await response.json<{ error: { code: string; message: string } }>();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('package_readme_media_missing');
    expect(body.error.message).toContain('missing.png');
  });

  it('rejects banned package publishers before reading multipart body', async () => {
    let bodyRead = false;
    const request = new Request('http://localhost/api/v1/templates/package', {
      method: 'POST',
      headers: {
        'content-type': 'multipart/form-data; boundary=marketplace-test',
        'x-marketplace-test-github-login': 'publisher'
      }
    });
    vi.spyOn(request, 'formData').mockImplementation(async () => {
      bodyRead = true;
      throw new Error('banned package upload body was read');
    });

    const response = await app.fetch(request, {
      MARKETPLACE_ALLOW_TEST_AUTH: 'true',
      MARKETPLACE_DB: createFakeD1Database([], { viewerBanned: true }),
      TEMPLATE_BUCKET: createFakeR2Bucket({})
    });
    const body = await response.json<{ error: { code: string } }>();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe('user_banned');
    expect(bodyRead).toBe(false);
  });

  it('rejects invalid publish payloads with structured errors', async () => {
    const request = buildPublishRequest();
    request.templateDocument.template.edges = [
      {
        sourceNodeIndex: 0,
        targetNodeIndex: 99,
        sourceAnchor: 'right',
        targetAnchor: 'left',
        arrowMode: 'forward'
      }
    ];

    const response = await app.request(
      'http://localhost/api/v1/templates',
      {
        method: 'POST',
        body: JSON.stringify(request),
        headers: {
          'content-type': 'application/json',
          'x-marketplace-test-github-login': 'publisher'
        }
      },
      {
        MARKETPLACE_ALLOW_TEST_AUTH: 'true',
        MARKETPLACE_DB: createFakeD1Database(),
        TEMPLATE_BUCKET: createFakeR2Bucket({})
      }
    );
    const body = await response.json<{ error: { code: string; message: string } }>();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('publish_request_invalid');
    expect(body.error.message).toContain('targetNodeIndex');
  });

  it('rejects unsafe publish text with structured errors', async () => {
    const request = buildPublishRequest();
    request.readme = '[Open](javascript:alert(1))';

    const response = await app.request(
      'http://localhost/api/v1/templates',
      {
        method: 'POST',
        body: JSON.stringify(request),
        headers: {
          'content-type': 'application/json',
          'x-marketplace-test-github-login': 'publisher'
        }
      },
      {
        MARKETPLACE_ALLOW_TEST_AUTH: 'true',
        MARKETPLACE_DB: createFakeD1Database(),
        TEMPLATE_BUCKET: createFakeR2Bucket({})
      }
    );
    const body = await response.json<{ error: { code: string; message: string } }>();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('content_safety_failed');
    expect(body.error.message).toContain('readme');
  });

  it('rejects unsafe associated Markdown paths with structured errors', async () => {
    const request = buildPublishRequest();
    request.templateDocument.template.nodes[0].metadata.note = {
      content: '',
      templateContentMode: 'workspace-file-path-only',
      relativePath: '../private.md'
    };

    const response = await app.request(
      'http://localhost/api/v1/templates',
      {
        method: 'POST',
        body: JSON.stringify(request),
        headers: {
          'content-type': 'application/json',
          'x-marketplace-test-github-login': 'publisher'
        }
      },
      {
        MARKETPLACE_ALLOW_TEST_AUTH: 'true',
        MARKETPLACE_DB: createFakeD1Database(),
        TEMPLATE_BUCKET: createFakeR2Bucket({})
      }
    );
    const body = await response.json<{ error: { code: string; message: string } }>();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('publish_request_invalid');
    expect(body.error.message).toContain('relativePath');
  });

  it('checks associated Markdown relative paths during content safety validation', async () => {
    const request = buildPublishRequest();
    request.templateDocument.template.nodes[0].metadata.note = {
      content: '',
      templateContentMode: 'workspace-file-path-only',
      relativePath: 'docs/javascript:alert.md'
    };

    const response = await app.request(
      'http://localhost/api/v1/templates',
      {
        method: 'POST',
        body: JSON.stringify(request),
        headers: {
          'content-type': 'application/json',
          'x-marketplace-test-github-login': 'publisher'
        }
      },
      {
        MARKETPLACE_ALLOW_TEST_AUTH: 'true',
        MARKETPLACE_DB: createFakeD1Database(),
        TEMPLATE_BUCKET: createFakeR2Bucket({})
      }
    );
    const body = await response.json<{ error: { code: string; message: string } }>();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('content_safety_failed');
    expect(body.error.message).toContain('metadata.note.relativePath');
  });

  it('checks canvas group titles during content safety validation', async () => {
    const request = buildPublishRequest();
    request.templateDocument.template.groups = [
      {
        title: 'javascript:alert review lane',
        position: { x: -32, y: -32 },
        size: { width: 400, height: 260 }
      }
    ];
    request.templateDocument.template.nodes[0].groupIndex = 0;

    const response = await app.request(
      'http://localhost/api/v1/templates',
      {
        method: 'POST',
        body: JSON.stringify(request),
        headers: {
          'content-type': 'application/json',
          'x-marketplace-test-github-login': 'publisher'
        }
      },
      {
        MARKETPLACE_ALLOW_TEST_AUTH: 'true',
        MARKETPLACE_DB: createFakeD1Database(),
        TEMPLATE_BUCKET: createFakeR2Bucket({})
      }
    );
    const body = await response.json<{ error: { code: string; message: string } }>();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('content_safety_failed');
    expect(body.error.message).toContain('template.groups[0].title');
  });

  it('rejects template JSON that exceeds the configured size limit', async () => {
    const response = await app.request(
      'http://localhost/api/v1/templates',
      {
        method: 'POST',
        body: JSON.stringify(buildPublishRequest()),
        headers: {
          'content-type': 'application/json',
          'x-marketplace-test-github-login': 'publisher'
        }
      },
      {
        MARKETPLACE_ALLOW_TEST_AUTH: 'true',
        MARKETPLACE_DB: createFakeD1Database(),
        TEMPLATE_BUCKET: createFakeR2Bucket({}),
        MARKETPLACE_MAX_TEMPLATE_BYTES: '64'
      }
    );
    const body = await response.json<{ error: { code: string; message: string } }>();

    expect(response.status).toBe(413);
    expect(body.error.code).toBe('template_too_large');
    expect(body.error.message).toContain('64 byte limit');
  });

  it('allows the real preview seed publisher to publish new versions', async () => {
    const runLog: FakeD1Run[] = [];
    const bucket = createFakeR2Bucket({});
    const response = await app.request(
      'http://localhost/api/v1/templates/d1-review-loop/versions',
      {
        method: 'POST',
        body: JSON.stringify(buildPublishVersionRequest()),
        headers: {
          'content-type': 'application/json',
          'x-marketplace-test-github-login': 'ZY-WANG-0304',
          'x-marketplace-test-github-user-id': '8197085'
        }
      },
      {
        MARKETPLACE_ALLOW_TEST_AUTH: 'true',
        MARKETPLACE_DB: createFakeD1Database(runLog, {
          publisherId: 'github-8197085',
          publisherGithubUserId: '8197085',
          publisherGithubLogin: 'ZY-WANG-0304'
        }),
        TEMPLATE_BUCKET: bucket
      }
    );
    const body = await response.json<{ template: { latestVersion: { versionNumber: number; objectKey: string } } }>();

    expect(response.status).toBe(201);
    expect(body.template.latestVersion.versionNumber).toBe(3);
    await expect(bucket.get(body.template.latestVersion.objectKey)).resolves.not.toBeNull();
    expect(runLog.some((entry) => entry.sql.includes('INSERT INTO template_versions'))).toBe(true);
  });

  it('rejects version publishing when login matches but the stable GitHub user id differs', async () => {
    const response = await app.request(
      'http://localhost/api/v1/templates/d1-review-loop/versions',
      {
        method: 'POST',
        body: JSON.stringify(buildPublishVersionRequest()),
        headers: {
          'content-type': 'application/json',
          'x-marketplace-test-github-login': 'dscanvas-admin',
          'x-marketplace-test-github-user-id': 'test-reclaimed-login'
        }
      },
      {
        MARKETPLACE_ALLOW_TEST_AUTH: 'true',
        MARKETPLACE_DB: createFakeD1Database(),
        TEMPLATE_BUCKET: createFakeR2Bucket({})
      }
    );
    const body = await response.json<{ error: { code: string } }>();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe('template_author_required');
  });

  it('publishes a new template version for the original publisher', async () => {
    const runLog: FakeD1Run[] = [];
    const bucket = createFakeR2Bucket({});
    const response = await app.request(
      'http://localhost/api/v1/templates/d1-review-loop/versions',
      {
        method: 'POST',
        body: JSON.stringify(buildPublishVersionRequest()),
        headers: {
          'content-type': 'application/json',
          'x-marketplace-test-github-login': 'dscanvas-admin'
        }
      },
      {
        MARKETPLACE_ALLOW_TEST_AUTH: 'true',
        MARKETPLACE_DB: createFakeD1Database(runLog),
        TEMPLATE_BUCKET: bucket
      }
    );
    const body = await response.json<{
      template: {
        latestVersion: { id: string; versionNumber: number; objectKey: string; thumbnailKey: string };
        versions: Array<{ versionNumber: number }>
      }
    }>();

    expect(response.status).toBe(201);
    expect(body.template.latestVersion.versionNumber).toBe(3);
    expect(body.template.latestVersion.objectKey).toBe(
      `templates/tmpl-d1-review/versions/${body.template.latestVersion.id}/template.json`
    );
    expect(body.template.latestVersion.thumbnailKey).toBe(
      `templates/tmpl-d1-review/versions/${body.template.latestVersion.id}/thumbnail.png`
    );
    expect(body.template.latestVersion.objectKey).not.toBe('templates/tmpl-d1-review/versions/3/template.json');
    await expect(bucket.get(body.template.latestVersion.objectKey)).resolves.not.toBeNull();
    await expect(bucket.get(body.template.latestVersion.thumbnailKey)).resolves.not.toBeNull();
    expect(body.template.versions.map((version) => version.versionNumber)).toEqual([3, 2, 1]);
    expect(runLog.some((entry) => entry.sql.includes('INSERT INTO template_versions'))).toBe(true);
    expect(runLog.some((entry) => entry.sql.includes('UPDATE templates SET latest_version_id'))).toBe(true);
  });

  it('prevents non-authors from publishing new versions', async () => {
    const response = await app.request(
      'http://localhost/api/v1/templates/d1-review-loop/versions',
      {
        method: 'POST',
        body: JSON.stringify(buildPublishVersionRequest()),
        headers: {
          'content-type': 'application/json',
          'x-marketplace-test-github-login': 'someone-else'
        }
      },
      {
        MARKETPLACE_ALLOW_TEST_AUTH: 'true',
        MARKETPLACE_DB: createFakeD1Database(),
        TEMPLATE_BUCKET: createFakeR2Bucket({})
      }
    );
    const body = await response.json<{ error: { code: string } }>();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe('template_author_required');
  });

  it('creates template reports for authenticated users', async () => {
    const runLog: FakeD1Run[] = [];
    const response = await app.request(
      'http://localhost/api/v1/templates/d1-review-loop/report',
      {
        method: 'POST',
        body: JSON.stringify({ reason: 'malicious' }),
        headers: {
          'content-type': 'application/json',
          'x-marketplace-test-github-login': 'community-user',
          'x-marketplace-test-github-user-id': 'test-community-user'
        }
      },
      {
        MARKETPLACE_ALLOW_TEST_AUTH: 'true',
        MARKETPLACE_DB: createFakeD1Database(runLog)
      }
    );
    const body = await response.json<{ report: { status: string; reason: string; template: { slug: string } } }>();

    expect(response.status).toBe(201);
    expect(body.report.status).toBe('open');
    expect(body.report.reason).toBe('malicious');
    expect(body.report.template.slug).toBe('d1-review-loop');
    expect(runLog.some((entry) => entry.sql.includes('INSERT INTO reports'))).toBe(true);
  });

  it('requires authentication before reporting templates', async () => {
    const response = await app.request('http://localhost/api/v1/templates/d1-review-loop/report', {
      method: 'POST',
      body: JSON.stringify({ reason: 'spam' }),
      headers: { 'content-type': 'application/json' }
    });
    const body = await response.json<{ error: { code: string } }>();

    expect(response.status).toBe(401);
    expect(body.error.code).toBe('auth_required');
  });

  it('rejects banned users from write APIs', async () => {
    const response = await app.request(
      'http://localhost/api/v1/templates/d1-review-loop/report',
      {
        method: 'POST',
        body: JSON.stringify({ reason: 'spam' }),
        headers: {
          'content-type': 'application/json',
          'x-marketplace-test-github-login': 'community-user',
          'x-marketplace-test-github-user-id': 'test-community-user'
        }
      },
      {
        MARKETPLACE_ALLOW_TEST_AUTH: 'true',
        MARKETPLACE_DB: createFakeD1Database([], { viewerBanned: true })
      }
    );
    const body = await response.json<{ error: { code: string } }>();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe('user_banned');
  });

  it('requires admin permission for the moderation queue', async () => {
    const response = await app.request(
      'http://localhost/api/v1/admin/reports',
      {
        headers: {
          'x-marketplace-test-github-login': 'community-user',
          'x-marketplace-test-github-user-id': 'test-community-user'
        }
      },
      {
        MARKETPLACE_ALLOW_TEST_AUTH: 'true',
        MARKETPLACE_DB: createFakeD1Database()
      }
    );
    const body = await response.json<{ error: { code: string } }>();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe('admin_required');
  });

  it('requires admin permission for global marketplace stats', async () => {
    const response = await app.request(
      'http://localhost/api/v1/admin/stats',
      {
        headers: {
          'x-marketplace-test-github-login': 'community-user',
          'x-marketplace-test-github-user-id': 'test-community-user'
        }
      },
      {
        MARKETPLACE_ALLOW_TEST_AUTH: 'true',
        MARKETPLACE_DB: createFakeD1Database()
      }
    );
    const body = await response.json<{ error: { code: string } }>();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe('admin_required');
  });

  it('bootstraps admins by stable GitHub user id before checking admin roles', async () => {
    const runLog: FakeD1Run[] = [];
    const env = {
      MARKETPLACE_ALLOW_TEST_AUTH: 'true',
      MARKETPLACE_ADMIN_GITHUB_IDS: '8197085',
      MARKETPLACE_DB: createFakeD1Database(runLog)
    };
    const response = await app.request(
      'http://localhost/api/v1/admin/reports?status=open',
      {
        headers: {
          'x-marketplace-test-github-login': 'reclaimed-login',
          'x-marketplace-test-github-user-id': '8197085'
        }
      },
      env
    );
    const body = await response.json<{ items: Array<{ id: string }> }>();

    expect(response.status).toBe(200);
    expect(body.items[0]?.id).toBe('report-d1-review');
    expect(runLog.some((entry) => entry.sql.includes('INSERT INTO admin_roles') && entry.boundValues[0] === 'github-8197085')).toBe(true);
  });

  it('lets admins list and resolve reports with optional template delisting', async () => {
    const runLog: FakeD1Run[] = [];
    const env = {
      MARKETPLACE_ALLOW_TEST_AUTH: 'true',
      MARKETPLACE_ADMIN_GITHUB_LOGINS: 'dscanvas-admin',
      MARKETPLACE_DB: createFakeD1Database(runLog, { adminUserIds: ['github-test-dscanvas-admin'] })
    };
    const listResponse = await app.request(
      'http://localhost/api/v1/admin/reports?status=open',
      {
        headers: {
          'x-marketplace-test-github-login': 'dscanvas-admin'
        }
      },
      env
    );
    const listBody = await listResponse.json<{ items: Array<{ id: string; status: string }> }>();
    const resolveResponse = await app.request(
      'http://localhost/api/v1/admin/reports/report-d1-review',
      {
        method: 'PATCH',
        body: JSON.stringify({ status: 'resolved', resolution: 'Confirmed.', delistTemplate: true }),
        headers: {
          'content-type': 'application/json',
          'x-marketplace-test-github-login': 'dscanvas-admin'
        }
      },
      env
    );
    const resolveBody = await resolveResponse.json<{ report: { status: string; template: { status: string } } }>();

    expect(listResponse.status).toBe(200);
    expect(listBody.items[0]?.status).toBe('open');
    expect(resolveResponse.status).toBe(200);
    expect(resolveBody.report.status).toBe('resolved');
    expect(resolveBody.report.template.status).toBe('delisted');
    expect(runLog.some((entry) => entry.sql.includes('UPDATE reports SET status = ?1'))).toBe(true);
    expect(runLog.filter((entry) => entry.sql.includes('INSERT INTO admin_audit_logs'))).toHaveLength(2);
  });

  it('lets admins load global marketplace stats', async () => {
    const env = {
      MARKETPLACE_ALLOW_TEST_AUTH: 'true',
      MARKETPLACE_ADMIN_GITHUB_LOGINS: 'dscanvas-admin',
      MARKETPLACE_DB: createFakeD1Database([], { adminUserIds: ['github-test-dscanvas-admin'] })
    };
    const response = await app.request(
      'http://localhost/api/v1/admin/stats',
      {
        headers: {
          'x-marketplace-test-github-login': 'dscanvas-admin'
        }
      },
      env
    );
    const body = await response.json<{
      totals: { templateCount: number; downloadCount: number; publishCount: number; openReportCount: number };
      topTemplates: Array<{ template: { slug: string }; publishCount: number }>;
    }>();

    expect(response.status).toBe(200);
    expect(body.totals.templateCount).toBe(1);
    expect(body.totals.downloadCount).toBe(44);
    expect(body.totals.publishCount).toBe(2);
    expect(body.totals.openReportCount).toBe(1);
    expect(body.topTemplates[0]?.template.slug).toBe('d1-review-loop');
    expect(body.topTemplates[0]?.publishCount).toBe(2);
  });

  it('lets admins change template status and user ban state', async () => {
    const runLog: FakeD1Run[] = [];
    const env = {
      MARKETPLACE_ALLOW_TEST_AUTH: 'true',
      MARKETPLACE_ADMIN_GITHUB_LOGINS: 'dscanvas-admin',
      MARKETPLACE_DB: createFakeD1Database(runLog, { adminUserIds: ['github-test-dscanvas-admin'] })
    };
    const templateResponse = await app.request(
      'http://localhost/api/v1/admin/templates/d1-review-loop',
      {
        method: 'PATCH',
        body: JSON.stringify({ status: 'delisted' }),
        headers: {
          'content-type': 'application/json',
          'x-marketplace-test-github-login': 'dscanvas-admin'
        }
      },
      env
    );
    const userResponse = await app.request(
      'http://localhost/api/v1/admin/users/github-test-community-user',
      {
        method: 'PATCH',
        body: JSON.stringify({ banned: true }),
        headers: {
          'content-type': 'application/json',
          'x-marketplace-test-github-login': 'dscanvas-admin'
        }
      },
      env
    );
    const templateBody = await templateResponse.json<{ template: { status: string } }>();
    const userBody = await userResponse.json<{ user: { bannedAt?: string } }>();

    expect(templateResponse.status).toBe(200);
    expect(templateBody.template.status).toBe('delisted');
    expect(userResponse.status).toBe(200);
    expect(userBody.user.bannedAt).toBeTruthy();
    expect(runLog.some((entry) => entry.sql.includes('UPDATE users SET banned_at = ?1'))).toBe(true);
  });
});

async function runGithubOAuthRoundTrip(
  app: ReturnType<typeof createMarketplaceWorkerApp>,
  returnTo: string
): Promise<Response> {
  const env = {
    GITHUB_CLIENT_ID: 'client-id',
    GITHUB_CLIENT_SECRET: 'client-secret',
    MARKETPLACE_SESSION_SECRET: 'session-secret'
  };
  const startResponse = await app.request(
    `https://marketplace.test/api/v1/auth/github/start?return_to=${encodeURIComponent(returnTo)}`,
    {},
    env
  );
  const authorizeUrl = new URL(startResponse.headers.get('location') ?? '');
  const state = authorizeUrl.searchParams.get('state');
  const stateCookie = startResponse.headers.get('set-cookie')?.split(';')[0];
  if (!state || !stateCookie) {
    throw new Error('OAuth start response did not include state and state cookie.');
  }

  return app.request(
    `https://marketplace.test/api/v1/auth/github/callback?code=github-code&state=${encodeURIComponent(state)}`,
    {
      headers: {
        cookie: stateCookie
      }
    },
    env
  );
}

function stubGithubOAuthFetch(): void {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === 'https://github.com/login/oauth/access_token') {
      return Response.json({ access_token: 'github-access-token' });
    }
    if (url === 'https://api.github.com/user') {
      return Response.json({
        id: 42,
        login: 'publisher',
        name: 'Publisher',
        avatar_url: 'https://github.com/publisher.png'
      });
    }
    return Response.json({ error: 'unexpected_url' }, { status: 500 });
  });
}

function buildPublishRequest(): {
  slug: string;
  name: string;
  description: string;
  tags: string[];
  readme: string;
  templateDocument: {
    version: 1;
    template: {
      id: string;
      name: string;
      category: 'user';
      createdAt: string;
      updatedAt: string;
      nodes: Array<{
        kind: 'note';
        title: string;
        position: { x: number; y: number };
        size: { width: number; height: number };
        groupIndex?: number;
        metadata: {
          note: {
            content: string;
            templateContentMode?: 'embedded-snapshot' | 'workspace-file-path-only' | 'workspace-file-with-content';
            relativePath?: string;
          };
        };
      }>;
      edges: Array<{
        sourceNodeIndex: number;
        targetNodeIndex: number;
        sourceAnchor: 'right';
        targetAnchor: 'left';
        arrowMode: 'forward';
      }>;
      groups?: Array<{
        title: string;
        position: { x: number; y: number };
        size: { width: number; height: number };
        parentGroupIndex?: number;
      }>;
    };
  };
} {
  return {
    slug: 'published-review-loop',
    name: 'Published Review Loop',
    description: 'A template published from the API test.',
    tags: ['review', 'quality'],
    readme: '# Published Review Loop\n\nUse this for API publish tests.',
    templateDocument: {
      version: 1,
      template: {
        id: 'published-review-loop',
        name: 'Published Review Loop',
        category: 'user',
        createdAt: '2026-05-14T00:00:00.000Z',
        updatedAt: '2026-05-14T00:00:00.000Z',
        nodes: [
          {
            kind: 'note',
            title: 'Review notes',
            position: { x: 0, y: 0 },
            size: { width: 320, height: 200 },
            metadata: { note: { content: 'Track review notes.' } }
          }
        ],
        edges: []
      }
    }
  };
}

function buildPackageZipFixture(options: { readme?: string; templateDocument?: ReturnType<typeof buildPublishRequest>['templateDocument'] } = {}): Uint8Array {
  const templateDocument = options.templateDocument ?? buildPublishRequest().templateDocument;
  const manifest = {
    schemaVersion: 1,
    slug: 'package-upload-smoke',
    name: 'Package Upload Smoke',
    description: 'A package zip uploaded by the API test.',
    tags: ['package', 'smoke'],
    template: 'template.json',
    readme: 'README.md',
    changelog: 'CHANGELOG.md',
    media: {
      thumbnail: 'media/thumbnail.png',
      gallery: [{ type: 'image', path: 'media/screenshot.png', alt: 'Screenshot' }]
    }
  };
  return zipSync({
    'template-package.json': new TextEncoder().encode(JSON.stringify(manifest, null, 2)),
    'template.json': new TextEncoder().encode(JSON.stringify(templateDocument, null, 2)),
    'README.md': new TextEncoder().encode(options.readme ?? '# Package Upload Smoke\n\n![Screenshot](./media/screenshot.png)\n'),
    'CHANGELOG.md': new TextEncoder().encode('Initial package upload.\n'),
    media: {
      'thumbnail.png': decodeBase64Png(),
      'screenshot.png': decodeBase64Png()
    }
  });
}

function decodeBase64Png(): Uint8Array {
  const binary = atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+P+/HgAFeAKB0nKcJwAAAABJRU5ErkJggg==');
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function buildPublishVersionRequest(): {
  changelog: string;
  templateDocument: {
    version: 1;
    template: {
      id: string;
      name: string;
      category: 'user';
      createdAt: string;
      updatedAt: string;
      nodes: Array<{
        kind: 'note';
        title: string;
        position: { x: number; y: number };
        size: { width: number; height: number };
        metadata: { note: { content: string } };
      }>;
      edges: [];
    };
  };
} {
  return {
    changelog: 'Adds an extra checklist note.',
    templateDocument: {
      version: 1,
      template: {
        id: 'd1-review-loop',
        name: 'D1 Review Loop',
        category: 'user',
        createdAt: '2026-05-14T00:00:00.000Z',
        updatedAt: '2026-05-14T00:00:00.000Z',
        nodes: [
          {
            kind: 'note',
            title: 'Updated review notes',
            position: { x: 0, y: 0 },
            size: { width: 320, height: 200 },
            metadata: { note: { content: 'Track updated review notes.' } }
          }
        ],
        edges: []
      }
    }
  };
}
