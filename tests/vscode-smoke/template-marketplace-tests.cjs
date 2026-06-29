const assert = require('assert');
const vscode = require('vscode');
const { activateVisibleExtension, waitForCommand } = require('./test-helpers.cjs');
const { closeServer, createMarketplaceFixture, startMarketplaceFixtureServer } = require('./template-marketplace-fixture.cjs');

const EXTENSION_ID = 'devsessioncanvas.dev-session-canvas';
const COMMAND_IDS = {
  openCanvasInEditor: 'devSessionCanvas.openCanvasInEditor',
  openTemplateMarketplace: 'devSessionCanvas.openTemplateMarketplace',
  testWaitForCanvasReady: 'devSessionCanvas.__test.waitForCanvasReady',
  testCaptureTemplateMarketplaceProbe: 'devSessionCanvas.__test.captureTemplateMarketplaceProbe',
  testPerformTemplateMarketplaceAction: 'devSessionCanvas.__test.performTemplateMarketplaceAction',
  testGetCanvasTemplateItems: 'devSessionCanvas.__test.getCanvasTemplateItems',
  testGetSidebarTemplateItems: 'devSessionCanvas.__test.getSidebarTemplateItems',
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
    probe.visibleTemplateNames.includes('Panel Release Checklist') &&
    probe.installTargetLabels.length > 0 &&
    probe.buttonTexts.some((text) => /^(?:安装(?: v\d+)?|更新到 v\d+|已安装 v\d+)$/u.test(text))
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
  assert.ok(detailProbe.buttonTexts.includes('举报模板'), 'Expected detail view to expose a report entry.');
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
  assert.ok(menuProbe.versionMenuItems.some((item) => /安装 v1/u.test(item)));

  const closedProbe = await performMarketplaceAction({ kind: 'clickOutside' }, 10000);
  assert.strictEqual(closedProbe.hasVersionMenu, false);

  const backProbe = await performMarketplaceAction({ kind: 'backToList' }, 10000);
  assert.strictEqual(backProbe.view, 'list');
  assert.strictEqual(backProbe.activeTemplateSlug, undefined);
  assert.deepStrictEqual(backProbe.visibleTemplateNames, ['Panel Review Loop']);

  await performMarketplaceAction({ kind: 'openDetail', slug: 'panel-review-loop' }, 10000);
  await performMarketplaceAction({ kind: 'installVersion', slug: 'panel-review-loop', versionNumber: 1 }, 10000);

  let installedEntry = await waitForTemplateCatalogEntry((entry) =>
    entry.marketplace?.marketTemplateSlug === 'panel-review-loop' &&
    entry.marketplace?.marketVersionId === 'ver-panel-review-1'
  );
  assert.strictEqual(installedEntry.marketplace.marketVersionId, 'ver-panel-review-1');
  assert.strictEqual(installedEntry.marketplace.installedVersionNumber, 1);
  assert.strictEqual(installedEntry.marketplace.sourceUrl, `${fixture.sourceUrl}/panel-review-loop`);
  assert.ok(installedEntry.storageLocation?.id, 'Expected installed marketplace template to record its storage location.');
  assert.strictEqual(installedEntry.marketplace.templatePath, 'template.json');
  assert.ok(installedEntry.marketplace.packageSha256, 'Expected installed marketplace template to record package checksum.');
  assert.match(installedEntry.filePath, /marketplace[\\/]panel-review-loop[\\/]template\.json$/u);

  const sidebarUpdateItem = await waitForSidebarTemplateItem((item) =>
    item.marketplace?.marketTemplateSlug === 'panel-review-loop' &&
    item.marketplace?.updateAvailable === true
  );
  assert.strictEqual(sidebarUpdateItem.marketplace.installedVersionNumber, 1);
  assert.strictEqual(sidebarUpdateItem.marketplace.latestVersionNumber, 2);
  assert.strictEqual(sidebarUpdateItem.canUpdateMarketplace, true);
  assert.strictEqual(sidebarUpdateItem.canManageMarketplace, true);
  assert.strictEqual(sidebarUpdateItem.canReportMarketplace, true);

  await performMarketplaceAction({ kind: 'installActiveVersion', slug: 'panel-review-loop' }, 10000);
  installedEntry = await waitForTemplateCatalogEntry((entry) =>
    entry.marketplace?.marketTemplateSlug === 'panel-review-loop' &&
    entry.marketplace?.marketVersionId === 'ver-panel-review-2'
  );
  assert.strictEqual(installedEntry.marketplace.installedVersionNumber, 2);
  const updatedProbe = await waitForMarketplaceProbe((probe) =>
    probe.buttonTexts.some((text) => /已安装 v2/u.test(text))
  );
  assert.ok(
    updatedProbe.buttonTexts.some((text) => /已安装 v2/u.test(text)),
    `Expected latest install action to update the installed state. Buttons: ${JSON.stringify(updatedProbe.buttonTexts)}`
  );

  menuProbe = await performMarketplaceAction({ kind: 'toggleInstallVersionMenu', slug: 'panel-review-loop' }, 10000);
  if (!menuProbe.hasVersionMenu) {
    menuProbe = await waitForMarketplaceProbe((probe) => probe.hasVersionMenu);
  }
  assert.ok(menuProbe.versionMenuItems.some((item) => /回滚到 v1/u.test(item)), 'Expected version menu to label older versions as rollback.');
  await performMarketplaceAction({ kind: 'installVersion', slug: 'panel-review-loop', versionNumber: 1 }, 10000);
  installedEntry = await waitForTemplateCatalogEntry((entry) =>
    entry.marketplace?.marketTemplateSlug === 'panel-review-loop' &&
    entry.marketplace?.marketVersionId === 'ver-panel-review-1'
  );
  assert.strictEqual(installedEntry.marketplace.installedVersionNumber, 1);

  await withInterceptedExternalOpen(async (externalCalls) => {
    await performMarketplaceAction({ kind: 'openReport', slug: 'panel-review-loop' }, 10000);
    await waitForCondition(() => externalCalls.length === 1, 10000, () => `report external open. Calls: ${externalCalls.map(String).join(', ')}`);
    assert.strictEqual(externalCalls.length, 1);
    assert.strictEqual(String(externalCalls[0]), `${fixture.sourceUrl}/panel-review-loop#report`);
  });
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

  await verifyMarketplacePanelPublishVersion(fixture);
}

async function verifyMarketplacePanelPublishVersion(fixture) {
  await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInEditor);
  await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'editor', 20000);
  await vscode.commands.executeCommand(COMMAND_IDS.testResetState);
  await vscode.commands.executeCommand(COMMAND_IDS.testCreateNode, 'note');
  const savedTemplate = await saveCanvasTemplateForTest('Panel Review Loop');

  fixture.publishedVersionRequests.length = 0;
  await withInterceptedAuthenticationSession(async (authCalls) => {
    await withInterceptedInformationMessages(
      async (informationCalls) => {
        await performMarketplaceAction({ kind: 'openDetail', slug: 'panel-review-loop' }, 10000);
        await performMarketplaceAction({ kind: 'publishVersion', slug: 'panel-review-loop' }, 10000);
        const formProbe = await waitForMarketplaceProbe((probe) =>
          probe.view === 'publish' &&
          probe.publishMode === 'version' &&
          probe.publishTemplateIdOrSlug === 'panel-review-loop' &&
          probe.publishSelectedTemplateId === savedTemplate.template.id
        );
        assert.strictEqual(formProbe.publishVersionTargetName, 'Panel Review Loop');
        assert.strictEqual(formProbe.publishForm.name, 'Panel Review Loop');
        assert.match(formProbe.publishForm.templateJson, /Panel Review Loop/u);

        await performMarketplaceAction(
          {
            kind: 'fillPublishForm',
            fields: {
              changelog: 'Add a VS Code publisher version from fixture E2E.'
            }
          },
          10000
        );
        await performMarketplaceAction({ kind: 'submitPublishForm' }, 10000);
        await waitForCondition(() => fixture.publishedVersionRequests.length === 1, 20000, 'publish version request');
        assert.strictEqual(authCalls.length, 1);
        assert.ok(
          informationCalls.some((call) => String(call.message).includes('模板“Panel Review Loop”已发布到模板市场 v3。')),
          'Expected publish-version success information message.'
        );
      },
      () => undefined
    );
  });

  const versionRequest = fixture.publishedVersionRequests[0];
  assert.strictEqual(versionRequest.authorization, 'Bearer marketplace-e2e-token');
  assert.strictEqual(versionRequest.templateIdOrSlug, 'panel-review-loop');
  assert.strictEqual(versionRequest.body.changelog, 'Add a VS Code publisher version from fixture E2E.');
  assert.ok(versionRequest.body.templateDocument?.template?.nodes?.length > 0);
  assert.ok(typeof versionRequest.body.thumbnailPngBase64 === 'string' && versionRequest.body.thumbnailPngBase64.length > 0);

  const successProbe = await waitForMarketplaceProbe((probe) =>
    probe.view === 'publish' &&
    probe.publishedTemplate?.slug === 'panel-review-loop' &&
    probe.publishedTemplate?.versionNumber === 3 &&
    /v3/u.test(probe.publishStatusText || '')
  );
  assert.strictEqual(successProbe.publishedTemplate.name, 'Panel Review Loop');

  await performMarketplaceAction({ kind: 'openDetail', slug: 'panel-review-loop' }, 10000);
  await performMarketplaceAction({ kind: 'toggleInstallVersionMenu', slug: 'panel-review-loop' }, 10000);
  const detailProbe = await waitForMarketplaceProbe((probe) =>
    probe.view === 'detail' &&
    probe.activeTemplateSlug === 'panel-review-loop' &&
    probe.versionMenuItems.some((text) => /更新到 v3/u.test(text))
  );
  assert.ok(
    detailProbe.versionMenuItems.some((text) => /更新到 v3/u.test(text)),
    `Expected version menu to mention v3. Items: ${JSON.stringify(detailProbe.versionMenuItems)}`
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

async function waitForSidebarTemplateItem(predicate, timeoutMs = 20000) {
  let lastItems;
  await waitForCondition(async () => {
    lastItems = await vscode.commands.executeCommand(COMMAND_IDS.testGetSidebarTemplateItems);
    return Array.isArray(lastItems) && lastItems.some(predicate);
  }, timeoutMs, () => `sidebar template item. Last items: ${JSON.stringify(lastItems)}`);
  return lastItems.find(predicate);
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

async function withInterceptedExternalOpen(runIntercepted) {
  const originalOpenExternal = vscode.env.openExternal;
  const calls = [];
  vscode.env.openExternal = async (uri) => {
    calls.push(uri);
    return true;
  };

  try {
    return await runIntercepted(calls);
  } finally {
    vscode.env.openExternal = originalOpenExternal;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
