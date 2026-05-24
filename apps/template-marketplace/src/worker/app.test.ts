import { describe, expect, it, vi } from 'vitest';

import { createMarketplaceWorkerApp } from './app';
import { createFakeD1Database, type FakeD1Run } from './testD1Database';
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
        TEMPLATE_BUCKET: createFakeR2Bucket({}),
        MARKETPLACE_ADMIN_GITHUB_LOGINS: 'publisher'
      }
    );
    const body = await response.json<{ template: { slug: string; latestVersion: { versionNumber: number; sha256: string } }; storageMode: string }>();

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
        metadata: { note: { content: string } };
      }>;
      edges: Array<{
        sourceNodeIndex: number;
        targetNodeIndex: number;
        sourceAnchor: 'right';
        targetAnchor: 'left';
        arrowMode: 'forward';
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
