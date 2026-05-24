const assert = require('assert');
const crypto = require('crypto');
const http = require('http');
const vscode = require('vscode');
const { activateVisibleExtension, waitForCommand } = require('./test-helpers.cjs');

const EXTENSION_ID = 'devsessioncanvas.dev-session-canvas';
const COMMAND_IDS = {
  openCanvasInEditor: 'devSessionCanvas.openCanvasInEditor',
  openTemplateMarketplace: 'devSessionCanvas.openTemplateMarketplace',
  testWaitForCanvasReady: 'devSessionCanvas.__test.waitForCanvasReady',
  testCaptureTemplateMarketplaceProbe: 'devSessionCanvas.__test.captureTemplateMarketplaceProbe',
  testPerformTemplateMarketplaceAction: 'devSessionCanvas.__test.performTemplateMarketplaceAction',
  testGetCanvasTemplateItems: 'devSessionCanvas.__test.getCanvasTemplateItems',
  testSaveCanvasAsTemplate: 'devSessionCanvas.__test.saveCanvasAsTemplate',
  testCreateNode: 'devSessionCanvas.__test.createNode',
  testResetState: 'devSessionCanvas.__test.resetState'
};

module.exports = {
  run
};

async function run() {
  const port = Number(process.env.DEV_SESSION_CANVAS_TEMPLATE_MARKETPLACE_E2E_PORT);
  assert.ok(Number.isInteger(port) && port > 0, 'Expected marketplace E2E port.');

  const fixture = createMarketplaceFixture(port);
  const server = await startMarketplaceFixtureServer(port, fixture);

  try {
    await activateVisibleExtension(vscode, EXTENSION_ID);
    for (const command of Object.values(COMMAND_IDS)) {
      await waitForCommand(vscode, command);
    }

    await vscode.commands.executeCommand(COMMAND_IDS.testResetState);
    await verifyMarketplacePanelOperations(fixture);
    await verifyMarketplacePanelPublish(fixture);
  } finally {
    await closeServer(server);
  }
}

async function verifyMarketplacePanelOperations(fixture) {
  await vscode.commands.executeCommand(COMMAND_IDS.openTemplateMarketplace);

  const listProbe = await waitForMarketplaceProbe((probe) =>
    probe.view === 'list' &&
    probe.apiOrigin === fixture.origin &&
    probe.marketplaceSourceUrl === fixture.sourceUrl &&
    probe.visibleTemplateNames.includes('Panel Review Loop') &&
    probe.visibleTemplateNames.includes('Panel Release Checklist')
  );
  assert.ok(listProbe.installTargetLabels.length > 0, 'Expected plugin marketplace to expose install targets.');
  assert.ok(listProbe.publisherTexts.some((text) => /Codex Tester/u.test(text)), 'Expected list rows to expose publisher information.');
  assert.ok(
    listProbe.buttonTexts.some((text) => /^(?:安装(?: v\d+)?|更新到 v\d+|已安装 v\d+)$/u.test(text)),
    `Expected list row to expose install split button primary action. Buttons: ${JSON.stringify(listProbe.buttonTexts)}`
  );
  assert.ok(
    listProbe.buttonTexts.some((text) => text === '切换安装版本'),
    `Expected list row to expose install split button version toggle. Buttons: ${JSON.stringify(listProbe.buttonTexts)}`
  );
  assert.ok(!listProbe.buttonTexts.some((text) => /下载 JSON/u.test(text)), 'Expected VS Code marketplace to omit JSON download actions.');
  assert.match(listProbe.statusText, /共 2 个模板/);

  const searchProbe = await performMarketplaceAction({ kind: 'search', value: 'review' }, 10000);
  assert.deepStrictEqual(searchProbe.visibleTemplateNames, ['Panel Review Loop']);
  assert.ok(fixture.requests.some((request) => request.url.includes('q=review')));

  let detailProbe = await performMarketplaceAction({ kind: 'openDetail', slug: 'panel-review-loop' }, 10000);
  detailProbe = await waitForMarketplaceProbe((probe) =>
    probe.view === 'detail' &&
    probe.activeTemplateSlug === 'panel-review-loop' &&
    probe.detailTitle === 'Panel Review Loop' &&
    /README-focused marketplace detail/u.test(probe.detailReadmeText || '')
  );
  assert.strictEqual(detailProbe.detailTitle, 'Panel Review Loop');
  assert.ok(detailProbe.publisherTexts.some((text) => /Codex Tester/u.test(text)), 'Expected detail view to expose publisher information.');
  assert.ok(!detailProbe.buttonTexts.some((text) => /下载 JSON/u.test(text)), 'Expected detail view to omit JSON download actions.');
  const changelogProbe = await performMarketplaceAction({ kind: 'selectDetailTab', tab: 'changelog' }, 10000);
  assert.strictEqual(changelogProbe.activeDetailTab, 'changelog');
  assert.match(changelogProbe.detailChangelogText || '', /Tighten panel detail controls/u);
  const readmeProbe = await performMarketplaceAction({ kind: 'selectDetailTab', tab: 'readme' }, 10000);
  assert.strictEqual(readmeProbe.activeDetailTab, 'readme');
  assert.match(readmeProbe.detailReadmeText || '', /README-focused marketplace detail/u);

  let menuProbe = await performMarketplaceAction({ kind: 'toggleInstallVersionMenu', slug: 'panel-review-loop' }, 10000);
  if (!menuProbe.hasVersionMenu) {
    menuProbe = await waitForMarketplaceProbe((probe) => probe.hasVersionMenu);
  }
  assert.ok(menuProbe.versionMenuItems.some((item) => /安装 v2/u.test(item)));

  const closedProbe = await performMarketplaceAction({ kind: 'clickOutside' }, 10000);
  assert.strictEqual(closedProbe.hasVersionMenu, false);

  const backProbe = await performMarketplaceAction({ kind: 'backToList' }, 10000);
  assert.strictEqual(backProbe.view, 'list');
  assert.strictEqual(backProbe.activeTemplateSlug, undefined);
  assert.deepStrictEqual(backProbe.visibleTemplateNames, ['Panel Review Loop']);

  await performMarketplaceAction({ kind: 'openDetail', slug: 'panel-review-loop' }, 10000);
  await performMarketplaceAction({ kind: 'installActiveVersion', slug: 'panel-review-loop' }, 10000);

  const installedEntry = await waitForTemplateCatalogEntry((entry) =>
    entry.marketplace?.marketTemplateSlug === 'panel-review-loop'
  );
  assert.strictEqual(installedEntry.marketplace.marketVersionId, 'ver-panel-review-2');
  assert.strictEqual(installedEntry.marketplace.installedVersionNumber, 2);
  assert.strictEqual(installedEntry.marketplace.sourceUrl, `${fixture.sourceUrl}/panel-review-loop`);
  assert.ok(installedEntry.storageLocation?.id, 'Expected installed marketplace template to record its storage location.');
}

async function verifyMarketplacePanelPublish(fixture) {
  await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInEditor);
  await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'editor', 20000);
  await vscode.commands.executeCommand(COMMAND_IDS.testResetState);
  await vscode.commands.executeCommand(COMMAND_IDS.testCreateNode, 'note');
  const savedTemplate = await saveCanvasTemplateForTest('VS Code Publish Source');

  await vscode.commands.executeCommand(COMMAND_IDS.openTemplateMarketplace);
  await performMarketplaceAction({ kind: 'search', value: '' }, 10000);

  fixture.publishedRequests.length = 0;
  await withInterceptedAuthenticationSession(async (authCalls) => {
    await withInterceptedQuickPicks(
      async (quickPickCalls) => {
        await withInterceptedInputBoxes(
          async (inputBoxCalls) => {
            await withInterceptedInformationMessages(
              async (informationCalls) => {
                await performMarketplaceAction({ kind: 'publish' }, 10000);
                const formProbe = await waitForMarketplaceProbe((probe) =>
                  probe.view === 'publish' &&
                  probe.publishSelectedTemplateId === savedTemplate.template.id &&
                  probe.publishTemplateNames.includes('VS Code Publish Source')
                );
                assert.strictEqual(formProbe.publishForm.name, 'VS Code Publish Source');
                assert.match(formProbe.publishForm.templateJson, /VS Code Publish Source/u);
                await performMarketplaceAction(
                  {
                    kind: 'fillPublishForm',
                    fields: {
                      name: 'VS Code Publish Smoke',
                      slug: 'vs-code-publish-smoke',
                      description: 'Published from the VS Code marketplace panel.',
                      tags: 'smoke, vscode',
                      readme: '# VS Code Publish Smoke\n\nPublished from the VS Code marketplace panel.',
                      changelog: 'Initial VS Code publish.'
                    }
                  },
                  15000
                );
                await performMarketplaceAction({ kind: 'submitPublishForm' }, 10000);
                await waitForCondition(() => fixture.publishedRequests.length === 1, 20000, 'publish request');
                assert.strictEqual(quickPickCalls.length, 0);
                assert.strictEqual(inputBoxCalls.length, 0);
                assert.strictEqual(authCalls.length, 1);
                assert.ok(
                  informationCalls.some((call) => String(call.message).includes('模板“VS Code Publish Smoke”已发布到模板市场 v1。')),
                  'Expected publish success information message.'
                );
              },
              () => undefined
            );
          },
          []
        );
      },
      () => undefined
    );
  });

  const publishRequest = fixture.publishedRequests[0];
  assert.strictEqual(publishRequest.authorization, 'Bearer marketplace-e2e-token');
  assert.strictEqual(publishRequest.body.slug, 'vs-code-publish-smoke');
  assert.strictEqual(publishRequest.body.name, 'VS Code Publish Smoke');
  assert.deepStrictEqual(publishRequest.body.tags, ['smoke', 'vscode']);
  assert.ok(publishRequest.body.templateDocument?.template?.nodes?.length > 0);
  assert.ok(typeof publishRequest.body.thumbnailPngBase64 === 'string' && publishRequest.body.thumbnailPngBase64.length > 0);

  const successProbe = await waitForMarketplaceProbe((probe) =>
    probe.view === 'publish' &&
    probe.publishedTemplate?.slug === 'vs-code-publish-smoke' &&
    /已发布到模板市场/u.test(probe.publishStatusText || probe.statusText || '')
  );
  assert.strictEqual(successProbe.publishedTemplate.name, 'VS Code Publish Smoke');

  await performMarketplaceAction({ kind: 'openDetail', slug: 'vs-code-publish-smoke' }, 10000);
  const detailProbe = await waitForMarketplaceProbe((probe) =>
    probe.view === 'detail' &&
    probe.activeTemplateSlug === 'vs-code-publish-smoke' &&
    probe.detailTitle === 'VS Code Publish Smoke'
  );
  assert.match(detailProbe.detailReadmeText || '', /Published from the VS Code marketplace panel/u);

  await performMarketplaceAction({ kind: 'backToList' }, 10000);
  const backProbe = await waitForMarketplaceProbe((probe) =>
    probe.view === 'list' &&
    probe.visibleTemplateNames.includes('VS Code Publish Smoke')
  );
  assert.ok(
    backProbe.visibleTemplateNames.includes('VS Code Publish Smoke'),
    'Expected published template to appear after returning to marketplace list.'
  );
}

async function saveCanvasTemplateForTest(name) {
  return vscode.commands.executeCommand(COMMAND_IDS.testSaveCanvasAsTemplate, name, 'default');
}

async function captureMarketplaceProbe(timeoutMs = 5000) {
  return vscode.commands.executeCommand(COMMAND_IDS.testCaptureTemplateMarketplaceProbe, timeoutMs);
}

async function performMarketplaceAction(action, timeoutMs = 5000) {
  return vscode.commands.executeCommand(COMMAND_IDS.testPerformTemplateMarketplaceAction, action, timeoutMs);
}

async function waitForMarketplaceProbe(predicate, timeoutMs = 20000) {
  let lastProbe;
  let lastError;
  await waitForCondition(async () => {
    try {
      lastProbe = await captureMarketplaceProbe(5000);
      return predicate(lastProbe);
    } catch (error) {
      lastError = error;
      return false;
    }
  }, timeoutMs, () => `marketplace probe. Last probe: ${JSON.stringify(lastProbe)}. Last error: ${lastError?.message || ''}`);
  return lastProbe;
}

async function waitForTemplateCatalogEntry(predicate, timeoutMs = 20000) {
  let lastCatalog;
  await waitForCondition(async () => {
    lastCatalog = await vscode.commands.executeCommand(COMMAND_IDS.testGetCanvasTemplateItems);
    return lastCatalog.templates.some(predicate);
  }, timeoutMs, () => `template catalog entry. Last catalog: ${JSON.stringify(lastCatalog)}`);
  return lastCatalog.templates.find(predicate);
}

async function waitForCondition(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await sleep(100);
  }
  const message = typeof label === 'function' ? label() : label;
  assert.fail(`Timed out waiting for ${message}.`);
}

async function withInterceptedAuthenticationSession(runIntercepted) {
  const originalGetSession = vscode.authentication.getSession;
  const calls = [];
  vscode.authentication.getSession = async (providerId, scopes, options) => {
    calls.push({ providerId, scopes, options });
    return {
      id: 'marketplace-e2e-session',
      accessToken: 'github-e2e-access-token',
      account: {
        id: 'codex-tester',
        label: 'codex-tester'
      },
      scopes
    };
  };

  try {
    return await runIntercepted(calls);
  } finally {
    vscode.authentication.getSession = originalGetSession;
  }
}

async function withInterceptedQuickPicks(runIntercepted, resolveSelection) {
  const originalShowQuickPick = vscode.window.showQuickPick;
  const calls = [];
  vscode.window.showQuickPick = async (items, options) => {
    const resolvedItems = Array.isArray(items) ? items : await items;
    calls.push({ items: resolvedItems, options });
    return resolveSelection({ items: resolvedItems, options, calls });
  };

  try {
    return await runIntercepted(calls);
  } finally {
    vscode.window.showQuickPick = originalShowQuickPick;
  }
}

async function withInterceptedInputBoxes(runIntercepted, values) {
  const originalShowInputBox = vscode.window.showInputBox;
  const calls = [];
  vscode.window.showInputBox = async (options) => {
    calls.push({ options });
    return values[calls.length - 1];
  };

  try {
    return await runIntercepted(calls);
  } finally {
    vscode.window.showInputBox = originalShowInputBox;
  }
}

async function withInterceptedInformationMessages(runIntercepted, resolveSelection) {
  const originalShowInformationMessage = vscode.window.showInformationMessage;
  const calls = [];
  vscode.window.showInformationMessage = async (message, ...items) => {
    calls.push({ message, items });
    return typeof resolveSelection === 'function' ? resolveSelection({ message, items, calls }) : undefined;
  };

  try {
    return await runIntercepted(calls);
  } finally {
    vscode.window.showInformationMessage = originalShowInformationMessage;
  }
}

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
  const text = JSON.stringify(document);
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
