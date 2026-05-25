import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { chromium } from 'playwright';
import { createServer } from 'vite';

const projectRoot = process.cwd();
const appRoot = path.join(projectRoot, 'apps', 'template-marketplace');
const templateFile = path.join(projectRoot, 'resources', 'templates', '01-getting-started.json');
const runtimeTmpDir = path.join(projectRoot, '.debug', 'template-marketplace-e2e', 'tmp');
process.env.TMPDIR = runtimeTmpDir;
process.env.TMP = runtimeTmpDir;
process.env.TEMP = runtimeTmpDir;

await fs.mkdir(runtimeTmpDir, { recursive: true });

const reviewTemplateDocument = JSON.parse(await fs.readFile(templateFile, 'utf8'));
const releaseTemplateDocument = {
  version: 1,
  template: {
    id: 'release-readiness-smoke',
    name: 'Release Readiness Smoke',
    category: 'user',
    nodes: [
      {
        kind: 'note',
        title: 'Release checklist',
        position: { x: 0, y: 0 },
        size: { width: 360, height: 220 },
        metadata: { note: { content: 'Ship only after checks pass.' } }
      }
    ],
    edges: [],
    createdAt: '2026-05-15T00:00:00.000Z',
    updatedAt: '2026-05-15T00:00:00.000Z'
  }
};

const fixtures = createMarketplaceFixtures();
let signedIn = false;
const requests = [];

const server = await createServer({
  configFile: path.join(appRoot, 'vite.config.ts'),
  root: appRoot,
  server: {
    host: '127.0.0.1',
    port: 0,
    strictPort: false
  }
});

let browser;

try {
  await server.listen();
  const localUrl = server.resolvedUrls?.local?.find((url) => url.startsWith('http://127.0.0.1'));
  assert.ok(localUrl, 'Expected Vite to provide a local URL.');

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const diagnostics = collectPageDiagnostics(page);
  await installApiRoutes(page);

  await verifyListPage(page, localUrl);
  await verifyDetailPage(page, localUrl);
  await verifyMyTemplatesPage(page, localUrl);
  await verifyPublishPage(page, localUrl);

  assert.deepEqual(diagnostics.pageErrors, [], 'Marketplace browser E2E should not throw page errors.');
  console.log('marketplace browser page e2e passed');
} finally {
  await browser?.close();
  await server.close();
}

async function verifyListPage(page, localUrl) {
  signedIn = false;
  await page.goto(localUrl, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'DevSessionCanvas Templates' }).waitFor();
  assert.match(await page.locator('body').innerText(), /Worker API · Storage: d1/u);
  assert.match(await page.locator('body').innerText(), /by Codex Tester @codex-tester/u);
  assert.equal(await page.locator('article').count(), 2);
  await assertVisibleText(page, 'Review Loop');
  await assertVisibleText(page, 'Release Readiness');

  const uploadHref = await page.getByRole('link', { name: 'Upload your template' }).getAttribute('href');
  assert.equal(uploadHref, '/templates/publish');

  await Promise.all([
    waitForTemplateListResponse(page, (url) => url.searchParams.get('q') === 'review'),
    page.getByRole('textbox', { name: 'Search templates' }).fill('review')
  ]);
  await assertVisibleText(page, 'Review Loop');
  assert.equal(await page.locator('article').count(), 1);

  await Promise.all([
    waitForTemplateListResponse(page, (url) => url.searchParams.getAll('tag').includes('quality')),
    page.getByRole('button', { name: '#quality' }).click()
  ]);
  assert.ok(requests.some((request) => request.url.includes('q=review') && request.url.includes('tag=quality')));

  await Promise.all([
    waitForTemplateListResponse(page, (url) => url.searchParams.get('sort') === 'newest'),
    page.getByLabel('Sort').selectOption('newest')
  ]);
  assert.ok(requests.some((request) => request.url.includes('sort=newest')));
}

async function verifyDetailPage(page, localUrl) {
  await page.goto(`${localUrl}review-loop`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Review Loop' }).waitFor();
  await page.getByRole('heading', { name: 'README' }).waitFor();
  const detailText = await page.locator('body').innerText();
  assert.match(detailText, /Published by Codex Tester @codex-tester/u);
  assert.match(detailText, /README/u);
  assert.match(detailText, /Use this template to drive implementation/u);
  assert.doesNotMatch(detailText, /Featured/u);
  assert.doesNotMatch(detailText, /Search templates by name/u);
  await page.getByRole('tab', { name: 'CHANGELOG' }).click();
  await page.getByRole('heading', { name: 'CHANGELOG' }).waitFor();
  await assertVisibleText(page, 'Improve review readiness.');
  await assertVisibleText(page, 'Initial version.');
  await page.getByRole('tab', { name: 'README' }).click();
  await assertVisibleText(page, 'Use this template to drive implementation');

  const installLink = page.getByRole('link', { name: /Install Review Loop v2 in VS Code/u });
  const installHref = await installLink.getAttribute('href');
  assert.ok(installHref?.startsWith('vscode://devsessioncanvas.dev-session-canvas/install-template?'));
  assert.ok(installHref?.includes('source='));

  const downloadHref = await page.getByRole('link', { name: /Download Review Loop v2 as JSON/u }).getAttribute('href');
  assert.equal(downloadHref, '/api/v1/templates/review-loop/download?version=ver-review-loop-2');

  await page.getByRole('link', { name: 'Back to all templates' }).click();
  await page.waitForLoadState('networkidle');
  const homeText = await page.locator('body').innerText();
  assert.match(homeText, /DevSessionCanvas Templates/u);
}

async function verifyMyTemplatesPage(page, localUrl) {
  signedIn = false;
  await page.goto(`${localUrl}me`, { waitUntil: 'networkidle' });
  await assertVisibleText(page, 'GitHub sign-in required');
  const signInHref = await page.getByRole('link', { name: 'Sign in with GitHub' }).getAttribute('href');
  assert.equal(signInHref, '/api/v1/auth/github/start?return_to=%2Ftemplates%2Fme');

  signedIn = true;
  await page.reload({ waitUntil: 'networkidle' });
  await assertVisibleText(page, 'Signed in as codex-tester');
  await assertVisibleText(page, 'Review Loop');
  assert.equal(await page.locator('article').count(), 1);
  const publishHref = await page.getByRole('link', { name: 'Publish template' }).getAttribute('href');
  assert.equal(publishHref, '/templates/publish');
}

async function verifyPublishPage(page, localUrl) {
  signedIn = true;
  await page.goto(`${localUrl}publish`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Publish a template' }).waitFor();
  await assertVisibleText(page, 'Signed in as codex-tester');

  const templateFileSection = page.locator('section').filter({ hasText: 'Template file' }).first();
  await page.getByRole('button', { name: 'Publish template' }).click();
  await templateFileSection.getByRole('alert').filter({ hasText: 'Choose a template JSON before publishing.' }).waitFor();

  await page.locator('input[type="file"]').first().setInputFiles({
    name: 'invalid-template.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{not valid json', 'utf8')
  });
  await templateFileSection.getByRole('alert').filter({ hasText: 'invalid-template.json: Template JSON is not valid JSON.' }).waitFor();

  await page.locator('input[type="file"]').first().setInputFiles(templateFile);
  await page.waitForFunction(() => document.body.textContent?.includes('01-getting-started.json'));
  await page.getByText('Optional README, changelog, and JSON preview').click();
  const templateJsonPreview = page.getByRole('textbox', { name: /Template JSON preview/u });
  await templateJsonPreview.waitFor();
  const templateJson = await templateJsonPreview.inputValue();
  assert.match(templateJson, /"template"/u);

  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Codex Smoke Template');
  const slugField = page.getByRole('textbox', { name: 'Slug', exact: true });
  await slugField.fill('review-loop');
  await page.getByRole('alert').filter({ hasText: 'Slug is already used by another template.' }).waitFor();
  await slugField.fill('codex-smoke-template');
  await page.getByRole('status').filter({ hasText: 'Slug is available.' }).waitFor();
  await page.getByRole('textbox', { name: 'Description', exact: true }).fill('A regression smoke test for publish button behavior.');
  await page.getByRole('textbox', { name: 'Tags', exact: true }).fill('smoke, publish');
  await page.getByRole('textbox', { name: 'README', exact: true }).fill('# Smoke README');
  const changelog = page.getByRole('textbox', { name: 'Changelog', exact: true });
  assert.equal(await changelog.evaluate((element) => element.tagName), 'TEXTAREA');
  await changelog.fill('Initial smoke pass.\nManual publish checklist covered.');

  const publishRequestsBeforeEnter = requests.filter((request) => request.method === 'POST' && request.url.endsWith('/api/v1/templates')).length;
  await slugField.press('Enter');
  await page.waitForTimeout(150);
  assert.equal(
    requests.filter((request) => request.method === 'POST' && request.url.endsWith('/api/v1/templates')).length,
    publishRequestsBeforeEnter,
    'Enter in a single-line publish field must not submit the form.'
  );

  await page.getByRole('button', { name: 'Publish template' }).click();
  await page.getByRole('status').filter({ hasText: 'Publishing template...' }).waitFor();
  await page.getByRole('status').filter({ hasText: 'Template published successfully' }).waitFor();
  assert.ok(page.url().includes('/templates/publish/success?template=codex-smoke-template'));
  assert.ok(requests.some((request) => request.method === 'POST' && request.url.endsWith('/api/v1/templates')));

  await page.getByRole('link', { name: 'View template detail' }).click();
  await page.getByRole('heading', { name: 'Codex Smoke Template' }).waitFor();
  await assertVisibleText(page, '# Smoke README');
}

async function installApiRoutes(page) {
  page.on('request', (request) => {
    if (request.url().includes('/api/v1/')) {
      requests.push({ method: request.method(), url: request.url() });
    }
  });

  await page.route('**/api/v1/auth/me', (route) => {
    if (!signedIn) {
      return route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'auth_required', message: 'Authentication is required.' } })
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user: {
          githubUserId: 'user-codex',
          githubLogin: 'codex-tester',
          displayName: 'Codex Tester',
          avatarUrl: ''
        }
      })
    });
  });

  await page.route(/\/api\/v1\/me\/templates(?:\?.*)?$/u, (route) => fulfillJson(route, { items: [fixtures.templates[0]], pagination: { page: 1, pageSize: 50, total: 1, hasMore: false }, storageMode: 'd1' }));
  await page.route(/\/api\/v1\/templates\/slug-availability(?:\?.*)?$/u, (route) => {
    const slug = new URL(route.request().url()).searchParams.get('slug') ?? '';
    return fulfillJson(route, { slug, available: !fixtures.details.has(slug), storageMode: 'd1' });
  });
  await page.route('**/api/v1/templates/*/thumbnail?*', (route) => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#22c55e"/></svg>' }));
  await page.route('**/api/v1/templates/*/download?*', (route) => {
    const slug = readSlugFromRoute(route.request().url(), '/download');
    const detail = fixtures.details.get(slug);
    const document = fixtures.documents.get(slug) ?? reviewTemplateDocument;
    if (!detail) {
      return fulfillJson(route, { error: { code: 'template_not_found', message: 'Template was not found.' } }, 404);
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(document) });
  });
  await page.route(/\/api\/v1\/templates\/(?!slug-availability(?:\?|$))[^/]+(?:\?.*)?$/u, (route) => {
    if (route.request().method() !== 'GET') {
      return route.continue();
    }
    const slug = readSlugFromRoute(route.request().url());
    const detail = fixtures.details.get(slug);
    if (!detail) {
      return fulfillJson(route, { error: { code: 'template_not_found', message: 'Template was not found.' } }, 404);
    }
    return fulfillJson(route, { template: detail, storageMode: 'd1' });
  });
  await page.route(/\/api\/v1\/templates(?:\?.*)?$/u, async (route) => {
    if (route.request().method() === 'POST') {
      const payload = route.request().postDataJSON();
      assert.equal(payload.name, 'Codex Smoke Template');
      assert.equal(payload.slug, 'codex-smoke-template');
      assert.equal(payload.description, 'A regression smoke test for publish button behavior.');
      assert.deepEqual(payload.tags, ['smoke', 'publish']);
      assert.equal(payload.readme, '# Smoke README');
      assert.equal(payload.changelog, 'Initial smoke pass.\nManual publish checklist covered.');
      assert.ok(typeof payload.templateDocument === 'object');
      assert.ok(typeof payload.thumbnailPngBase64 === 'string');

      const published = createTemplateDetail({
        id: 'tmpl-codex',
        slug: 'codex-smoke-template',
        name: 'Codex Smoke Template',
        description: payload.description,
        tags: payload.tags,
        readme: payload.readme,
        versionId: 'ver-codex-1',
        versionNumber: 1,
        document: payload.templateDocument
      });
      fixtures.templates.push(toSummary(published));
      fixtures.details.set(published.slug, published);
      fixtures.documents.set(published.slug, payload.templateDocument);

      await new Promise((resolve) => setTimeout(resolve, 250));
      return fulfillJson(route, { template: published, storageMode: 'd1' }, 201);
    }

    const url = new URL(route.request().url());
    const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
    const tags = url.searchParams.getAll('tag');
    const filtered = fixtures.templates.filter((template) => {
      const matchesQuery = !q || [template.name, template.description, ...template.tags].join(' ').toLowerCase().includes(q);
      const matchesTags = tags.every((tag) => template.tags.includes(tag));
      return matchesQuery && matchesTags;
    });
    return fulfillJson(route, {
      items: filtered,
      pagination: { page: 1, pageSize: 12, total: filtered.length, hasMore: false },
      storageMode: 'd1'
    });
  });
}

function createMarketplaceFixtures() {
  const review = createTemplateDetail({
    id: 'tmpl-review-loop',
    slug: 'review-loop',
    name: 'Review Loop',
    description: 'Plan, implement, test, and review a focused change.',
    tags: ['quality', 'review'],
    readme: 'Use this template to drive implementation through tests and review.',
    versionId: 'ver-review-loop-2',
    versionNumber: 2,
    document: reviewTemplateDocument,
    versions: [
      { id: 'ver-review-loop-2', versionNumber: 2, changelog: 'Improve review readiness.', document: reviewTemplateDocument },
      { id: 'ver-review-loop-1', versionNumber: 1, changelog: 'Initial version.', document: reviewTemplateDocument }
    ]
  });
  const release = createTemplateDetail({
    id: 'tmpl-release-readiness',
    slug: 'release-readiness',
    name: 'Release Readiness',
    description: 'Coordinate final checks before publishing a release.',
    tags: ['release', 'quality'],
    readme: 'Use this checklist before a release goes out.',
    versionId: 'ver-release-readiness-1',
    versionNumber: 1,
    document: releaseTemplateDocument
  });
  return {
    templates: [toSummary(review), toSummary(release)],
    details: new Map([[review.slug, review], [release.slug, release]]),
    documents: new Map([[review.slug, reviewTemplateDocument], [release.slug, releaseTemplateDocument]])
  };
}

function createTemplateDetail({ id, slug, name, description, tags, readme, versionId, versionNumber, document, versions }) {
  const latestVersion = createVersion({ id: versionId, templateId: id, versionNumber, changelog: versions?.[0]?.changelog ?? 'Initial version.', document });
  return {
    id,
    slug,
    name,
    description,
    tags,
    publisher: { id: 'publisher', githubLogin: 'codex-tester', displayName: 'Codex Tester', avatarUrl: '' },
    latestVersion,
    versions: versions
      ? versions.map((version) => createVersion({ ...version, templateId: id }))
      : [latestVersion],
    status: 'published',
    downloadCount: 12,
    likeCount: 3,
    hotScore: 10,
    createdAt: '2026-05-15T00:00:00.000Z',
    updatedAt: '2026-05-15T00:00:00.000Z',
    readme,
    providerWarnings: []
  };
}

function createVersion({ id, templateId, versionNumber, changelog, document }) {
  const text = JSON.stringify(document);
  return {
    id,
    templateId,
    versionNumber,
    changelog,
    objectKey: `templates/${templateId}/versions/${versionNumber}/template.json`,
    thumbnailKey: `templates/${templateId}/versions/${versionNumber}/thumbnail.png`,
    sha256: createHash('sha256').update(text).digest('hex'),
    sizeBytes: Buffer.byteLength(text),
    schemaVersion: 1,
    status: 'published',
    createdAt: '2026-05-15T00:00:00.000Z'
  };
}

function toSummary(detail) {
  const { versions, readme, providerWarnings, ...summary } = detail;
  return summary;
}

function readSlugFromRoute(url, suffix = '') {
  const pathname = new URL(url).pathname;
  const prefix = '/api/v1/templates/';
  const raw = pathname.slice(prefix.length, suffix ? -suffix.length : undefined);
  return decodeURIComponent(raw.replace(/^\/+|\/+$/g, ''));
}

async function assertVisibleText(page, text) {
  await page.getByText(text).first().waitFor();
  assert.match(await page.locator('body').innerText(), new RegExp(escapeRegExp(text), 'u'));
}

function waitForTemplateListResponse(page, predicate) {
  return page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      response.request().method() === 'GET' &&
      url.pathname === '/api/v1/templates' &&
      predicate(url)
    );
  });
}

function fulfillJson(route, body, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body)
  });
}

function collectPageDiagnostics(page) {
  const diagnostics = { pageErrors: [], consoleErrors: [] };
  page.on('pageerror', (error) => diagnostics.pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      diagnostics.consoleErrors.push(message.text());
    }
  });
  return diagnostics;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
