import { describe, expect, it } from 'vitest';

import { createMarketplaceWorkerApp } from './app';
import { createFakeD1Database } from './testD1Database';
import { createFakeR2Bucket } from './testR2Bucket';

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

  it('uses D1 repository when the binding is present', async () => {
    const response = await app.request('http://localhost/api/v1/templates?q=d1', {}, { MARKETPLACE_DB: createFakeD1Database() });
    const body = await response.json<{ items: Array<{ slug: string }>; storageMode: string }>();

    expect(response.status).toBe(200);
    expect(body.storageMode).toBe('d1');
    expect(body.items.map((item) => item.slug)).toEqual(['d1-review-loop']);
  });

  it('returns template details by slug', async () => {
    const response = await app.request('http://localhost/api/v1/templates/release-readiness');
    const body = await response.json<{ template: { id: string; versions: unknown[] } }>();

    expect(response.status).toBe(200);
    expect(body.template.id).toBe('tmpl-release-readiness');
    expect(body.template.versions).toHaveLength(1);
  });

  it('builds seed download metadata', async () => {
    const response = await app.request('http://localhost/api/v1/templates/review-loop/download');
    const body = await response.json<{ storageMode: string; objectKey: string }>();

    expect(response.status).toBe(200);
    expect(body.storageMode).toBe('seed');
    expect(body.objectKey).toContain('/versions/2/template.json');
  });

  it('streams template JSON from R2 when the bucket binding is present', async () => {
    const objectKey = 'templates/tmpl-d1-review/versions/2/template.json';
    const runLog: Array<{ sql: string; boundValues: unknown[] }> = [];
    const expectedDay = new Date().toISOString().slice(0, 10);
    const response = await app.request(
      'http://localhost/api/v1/templates/d1-review-loop/download',
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

  it('returns a structured 404 when D1 metadata points to a missing R2 object', async () => {
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
    expect(body.error.code).toBe('template_object_not_found');
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
});
