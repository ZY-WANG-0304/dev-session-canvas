const assert = require('assert');
const crypto = require('crypto');
const http = require('http');
const { zipSync } = require('fflate');

module.exports = {
  closeServer,
  createMarketplaceFixture,
  startMarketplaceFixtureServer
};

function createMarketplaceFixture(port) {
  const origin = `http://127.0.0.1:${port}`;
  const sourceUrl = `${origin}/templates`;
  const reviewDocumentV1 = createTemplateDocument('panel-review-loop-v1', 'Panel Review Loop v1');
  const reviewDocumentV2 = createTemplateDocument('panel-review-loop-v2', 'Panel Review Loop v2');
  const releaseDocument = createTemplateDocument('panel-release-checklist', 'Panel Release Checklist');
  const review = createTemplateDetail({
    id: 'tmpl-panel-review',
    slug: 'panel-review-loop',
    name: 'Panel Review Loop',
    description: 'Review implementation from inside the VS Code marketplace panel.',
    tags: ['review', 'quality'],
    readme: 'README-focused marketplace detail for the VS Code panel E2E.',
    versions: [
      { id: 'ver-panel-review-2', versionNumber: 2, changelog: 'Tighten panel detail controls.', document: reviewDocumentV2 },
      { id: 'ver-panel-review-1', versionNumber: 1, changelog: 'Initial panel smoke version.', document: reviewDocumentV1 }
    ]
  });
  const release = createTemplateDetail({
    id: 'tmpl-panel-release',
    slug: 'panel-release-checklist',
    name: 'Panel Release Checklist',
    description: 'Coordinate release checks without leaving VS Code.',
    tags: ['release', 'quality'],
    readme: 'Release checklist detail.',
    versions: [
      { id: 'ver-panel-release-1', versionNumber: 1, changelog: 'Initial release checklist.', document: releaseDocument }
    ]
  });

  return {
    origin,
    sourceUrl,
    requests: [],
    publishedRequests: [],
    templates: [review, release],
    documentsByVersionId: new Map([
      ['ver-panel-review-2', reviewDocumentV2],
      ['ver-panel-review-1', reviewDocumentV1],
      ['ver-panel-release-1', releaseDocument]
    ]),
    packagesByVersionId: new Map([
      ['ver-panel-review-2', createTemplatePackageZip(review, review.latestVersion, reviewDocumentV2)],
      ['ver-panel-review-1', createTemplatePackageZip(review, review.versions[1], reviewDocumentV1)],
      ['ver-panel-release-1', createTemplatePackageZip(release, release.latestVersion, releaseDocument)]
    ])
  };
}

function createTemplateDetail({ id, slug, name, description, tags, readme, versions }) {
  const parsedVersions = versions.map((version) => createVersion({ ...version, templateId: id }));
  const latestVersion = parsedVersions[0];
  return {
    id,
    slug,
    name,
    description,
    tags,
    publisher: {
      id: 'publisher-e2e',
      githubLogin: 'codex-tester',
      displayName: 'Codex Tester',
      avatarUrl: ''
    },
    latestVersion,
    versions: parsedVersions,
    status: 'published',
    downloadCount: 41,
    likeCount: 7,
    hotScore: 99,
    createdAt: '2026-05-15T00:00:00.000Z',
    updatedAt: '2026-05-15T00:00:00.000Z',
    readme,
    providerWarnings: []
  };
}

function createVersion({ id, templateId, versionNumber, changelog, document }) {
  const text = encodeTemplateDocumentForPackage(document);
  return {
    id,
    templateId,
    versionNumber,
    changelog,
    objectKey: `templates/${templateId}/versions/${versionNumber}/template.json`,
    thumbnailKey: `templates/${templateId}/versions/${versionNumber}/thumbnail.png`,
    sha256: crypto.createHash('sha256').update(text).digest('hex'),
    sizeBytes: Buffer.byteLength(text),
    schemaVersion: 1,
    status: 'published',
    createdAt: '2026-05-15T00:00:00.000Z'
  };
}

function createTemplateDocument(id, name) {
  return {
    version: 1,
    template: {
      id,
      name,
      category: 'user',
      createdAt: '2026-05-15T00:00:00.000Z',
      updatedAt: '2026-05-15T00:00:00.000Z',
      nodes: [
        {
          kind: 'note',
          title: name,
          position: { x: 0, y: 0 },
          size: { width: 360, height: 220 },
          metadata: {
            note: {
              content: `# ${name}\n\nMarketplace E2E fixture.`
            }
          }
        }
      ],
      edges: []
    }
  };
}

function encodeTemplateDocumentForPackage(document) {
  return `${JSON.stringify(document, null, 2)}\n`;
}

function createTemplatePackageZip(template, version, document) {
  const encoder = new TextEncoder();
  return zipSync(
    {
      'template-package.json': encoder.encode(JSON.stringify({
        schemaVersion: 1,
        slug: template.slug,
        name: template.name,
        description: template.description,
        tags: template.tags,
        template: 'template.json',
        readme: 'README.md',
        changelog: 'CHANGELOG.md',
        thumbnail: 'media/thumbnail.png'
      }, null, 2)),
      'template.json': encoder.encode(encodeTemplateDocumentForPackage(document)),
      'README.md': encoder.encode(`${template.readme}
`),
      'CHANGELOG.md': encoder.encode(`${version.changelog}
`),
      media: {
        'thumbnail.png': new Uint8Array([137, 80, 78, 71])
      }
    },
    { level: 0 }
  );
}

async function startMarketplaceFixtureServer(port, fixture) {
  const server = http.createServer((request, response) => {
    void handleMarketplaceRequest(request, response, fixture);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  return server;
}

async function handleMarketplaceRequest(request, response, fixture) {
  const url = new URL(request.url || '/', fixture.origin);
  fixture.requests.push({ method: request.method, url: url.toString() });

  if (request.method === 'OPTIONS') {
    writeResponse(response, 204, 'text/plain', '');
    return;
  }

  try {
    if (request.method === 'GET' && url.pathname === '/api/v1/templates') {
      const query = (url.searchParams.get('q') || '').toLowerCase();
      const items = fixture.templates
        .filter((template) => {
          if (!query) {
            return true;
          }
          return [template.name, template.description, ...template.tags].join(' ').toLowerCase().includes(query);
        })
        .map(toTemplateSummary);
      writeJson(response, 200, {
        items,
        pagination: { page: 1, pageSize: 12, total: items.length, hasMore: false },
        storageMode: 'e2e'
      });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/v1/auth/vscode/exchange') {
      const body = await readJsonBody(request);
      assert.strictEqual(body.accessToken, 'github-e2e-access-token');
      writeJson(response, 200, {
        token: 'marketplace-e2e-token',
        expiresAt: '2026-05-15T01:00:00.000Z',
        user: {
          githubUserId: 'codex-tester',
          githubLogin: 'codex-tester',
          displayName: 'Codex Tester',
          avatarUrl: ''
        }
      });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/v1/templates/slug-availability') {
      const slug = slugify(url.searchParams.get('slug') || '');
      writeJson(response, 200, {
        slug,
        available: !findTemplate(fixture, slug),
        storageMode: 'e2e'
      });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/v1/templates') {
      const body = await readJsonBody(request);
      const authorization = request.headers.authorization || '';
      const document = body.templateDocument;
      const slug = slugify(body.slug || body.name || 'published-template');
      const detail = createTemplateDetail({
        id: `tmpl-${slug}`,
        slug,
        name: body.name,
        description: body.description,
        tags: Array.isArray(body.tags) ? body.tags : [],
        readme: body.readme || '',
        versions: [
          { id: `ver-${slug}-1`, versionNumber: 1, changelog: body.changelog || 'Initial version.', document }
        ]
      });
      fixture.templates.push(detail);
      fixture.documentsByVersionId.set(detail.latestVersion.id, document);
      fixture.publishedRequests.push({ authorization, body });
      writeJson(response, 201, { template: detail, storageMode: 'e2e' });
      return;
    }

    const thumbnailMatch = url.pathname.match(/^\/api\/v1\/templates\/([^/]+)\/thumbnail$/);
    if (request.method === 'GET' && thumbnailMatch) {
      writeResponse(
        response,
        200,
        'image/svg+xml',
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 80"><rect width="120" height="80" fill="#1f9f8a"/><circle cx="86" cy="26" r="18" fill="#2589ff"/></svg>'
      );
      return;
    }

    const downloadMatch = url.pathname.match(/^\/api\/v1\/templates\/([^/]+)\/download$/);
    if (request.method === 'GET' && downloadMatch) {
      const template = findTemplate(fixture, downloadMatch[1]);
      const versionId = url.searchParams.get('version') || template?.latestVersion.id;
      const packageBytes = versionId ? fixture.packagesByVersionId.get(versionId) : undefined;
      if (!template || !packageBytes) {
        writeJson(response, 404, { error: { code: 'template_not_found', message: 'Template was not found.' } });
        return;
      }
      writeResponse(response, 200, 'application/zip', Buffer.from(packageBytes));
      return;
    }

    const templateJsonMatch = url.pathname.match(/^\/api\/v1\/templates\/([^/]+)\/template\.json$/);
    if (request.method === 'GET' && templateJsonMatch) {
      const template = findTemplate(fixture, templateJsonMatch[1]);
      const versionId = url.searchParams.get('version') || template?.latestVersion.id;
      const document = versionId ? fixture.documentsByVersionId.get(versionId) : undefined;
      if (!template || !document) {
        writeJson(response, 404, { error: { code: 'template_not_found', message: 'Template was not found.' } });
        return;
      }
      writeJson(response, 200, document);
      return;
    }

    const detailMatch = url.pathname.match(/^\/api\/v1\/templates\/([^/]+)$/);
    if (request.method === 'GET' && detailMatch) {
      const template = findTemplate(fixture, detailMatch[1]);
      if (!template) {
        writeJson(response, 404, { error: { code: 'template_not_found', message: 'Template was not found.' } });
        return;
      }
      writeJson(response, 200, { template, storageMode: 'e2e' });
      return;
    }

    writeJson(response, 404, { error: { code: 'not_found', message: 'Not found.' } });
  } catch (error) {
    writeJson(response, 500, {
      error: {
        code: 'fixture_error',
        message: error instanceof Error ? error.message : String(error)
      }
    });
  }
}

function findTemplate(fixture, slugOrId) {
  const normalized = decodeURIComponent(slugOrId);
  return fixture.templates.find((template) => template.slug === normalized || template.id === normalized);
}

function toTemplateSummary(detail) {
  const { versions, readme, providerWarnings, ...summary } = detail;
  return summary;
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('error', reject);
    request.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function writeJson(response, statusCode, body) {
  writeResponse(response, statusCode, 'application/json', JSON.stringify(body));
}

function writeResponse(response, statusCode, contentType, body) {
  response.writeHead(statusCode, {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'accept,authorization,content-type',
    'content-type': contentType
  });
  response.end(body);
}

function slugify(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'published-template';
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
