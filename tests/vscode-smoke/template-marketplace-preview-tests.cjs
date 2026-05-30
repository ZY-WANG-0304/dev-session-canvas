const assert = require('assert');
const vscode = require('vscode');
const { activateVisibleExtension, waitForCommand } = require('./test-helpers.cjs');

const EXTENSION_ID = 'devsessioncanvas.dev-session-canvas';
const COMMAND_IDS = {
  openTemplateMarketplace: 'devSessionCanvas.openTemplateMarketplace',
  testCaptureTemplateMarketplaceProbe: 'devSessionCanvas.__test.captureTemplateMarketplaceProbe',
  testPerformTemplateMarketplaceAction: 'devSessionCanvas.__test.performTemplateMarketplaceAction',
  testGetCanvasTemplateItems: 'devSessionCanvas.__test.getCanvasTemplateItems',
  testResetState: 'devSessionCanvas.__test.resetState'
};

module.exports = {
  run
};

async function run() {
  const sourceUrl = normalizeSourceUrl(process.env.DEV_SESSION_CANVAS_TEMPLATE_MARKETPLACE_SOURCE_URL);
  const sourceOrigin = new URL(sourceUrl).origin;

  await activateVisibleExtension(vscode, EXTENSION_ID);
  for (const command of Object.values(COMMAND_IDS)) {
    await waitForCommand(vscode, command);
  }

  await vscode.commands.executeCommand(COMMAND_IDS.testResetState);
  await vscode.commands.executeCommand(COMMAND_IDS.openTemplateMarketplace);

  const listProbe = await waitForMarketplaceProbe((probe) =>
    probe.view === 'list' &&
    probe.apiOrigin === sourceOrigin &&
    probe.marketplaceSourceUrl === sourceUrl &&
    probe.templateCount > 0 &&
    probe.visibleTemplateNames.length > 0
  );
  assert.ok(listProbe.installTargetLabels.length > 0, 'Expected preview E2E to expose install targets.');
  assert.ok(listProbe.buttonTexts.some((text) => /安装/u.test(text)), 'Expected preview list to expose install split button.');
  assert.ok(!listProbe.buttonTexts.some((text) => /下载 JSON/u.test(text)), 'Expected preview VS Code marketplace to omit JSON download actions.');
  assert.match(listProbe.statusText, /共 \d+ 个模板/u);

  const detailProbe = await openFirstTemplateDetail();
  const activeSlug = detailProbe.activeTemplateSlug;
  assert.ok(activeSlug, 'Expected preview E2E to open a real template detail.');
  assert.ok(detailProbe.detailTitle, 'Expected preview detail title.');
  assert.ok(
    typeof detailProbe.detailReadmeText === 'string' && detailProbe.detailReadmeText.trim().length > 0,
    'Expected preview detail README text.'
  );
  assert.ok(!detailProbe.buttonTexts.some((text) => /下载 JSON/u.test(text)), 'Expected preview detail to omit JSON download actions.');
  const changelogProbe = await performMarketplaceAction({ kind: 'selectDetailTab', tab: 'changelog' }, 15000);
  assert.strictEqual(changelogProbe.activeDetailTab, 'changelog', 'Expected preview detail to switch to CHANGELOG tab.');
  assert.ok(
    typeof changelogProbe.detailChangelogText === 'string' && changelogProbe.detailChangelogText.trim().length > 0,
    'Expected preview detail CHANGELOG text.'
  );
  await performMarketplaceAction({ kind: 'selectDetailTab', tab: 'readme' }, 10000);

  let menuProbe = await performMarketplaceAction({ kind: 'toggleInstallVersionMenu', slug: activeSlug }, 15000);
  if (!menuProbe.hasVersionMenu) {
    menuProbe = await waitForMarketplaceProbe((probe) => probe.hasVersionMenu, 15000);
  }
  assert.ok(menuProbe.versionMenuItems.some((item) => /安装 v\d+/u.test(item)), 'Expected preview install version menu.');

  const closedProbe = await performMarketplaceAction({ kind: 'clickOutside' }, 10000);
  assert.strictEqual(closedProbe.hasVersionMenu, false, 'Expected preview version menu to close on outside click.');

  await performMarketplaceAction({ kind: 'installActiveVersion', slug: activeSlug }, 20000);
  const installedEntry = await waitForTemplateCatalogEntry((entry) =>
    entry.marketplace?.marketTemplateSlug === activeSlug &&
    typeof entry.marketplace?.sourceUrl === 'string' &&
    entry.marketplace.sourceUrl.startsWith(`${sourceUrl}/`)
  );
  assert.ok(installedEntry.storageLocation?.id, 'Expected preview install to record a storage location.');
  assert.ok(installedEntry.marketplace.marketVersionId, 'Expected preview install to record a market version id.');
  assert.strictEqual(installedEntry.marketplace.templatePath, 'template.json');
  assert.ok(installedEntry.marketplace.packageSha256, 'Expected preview install to record package checksum.');
  assert.ok(
    Number.isInteger(installedEntry.marketplace.installedVersionNumber) &&
      installedEntry.marketplace.installedVersionNumber > 0,
    'Expected preview install to record a positive version number.'
  );
}

async function openFirstTemplateDetail() {
  await performMarketplaceAction({ kind: 'openDetail' }, 15000);
  return waitForMarketplaceProbe((probe) =>
    probe.view === 'detail' &&
    typeof probe.activeTemplateSlug === 'string' &&
    probe.activeTemplateSlug.length > 0 &&
    typeof probe.detailTitle === 'string' &&
    probe.detailTitle.length > 0
  );
}

async function captureMarketplaceProbe(timeoutMs = 5000) {
  return vscode.commands.executeCommand(COMMAND_IDS.testCaptureTemplateMarketplaceProbe, timeoutMs);
}

async function performMarketplaceAction(action, timeoutMs = 5000) {
  return vscode.commands.executeCommand(COMMAND_IDS.testPerformTemplateMarketplaceAction, action, timeoutMs);
}

async function waitForMarketplaceProbe(predicate, timeoutMs = 30000) {
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
  }, timeoutMs, () => `marketplace preview probe. Last probe: ${JSON.stringify(lastProbe)}. Last error: ${lastError?.message || ''}`);
  return lastProbe;
}

async function waitForTemplateCatalogEntry(predicate, timeoutMs = 30000) {
  let lastCatalog;
  await waitForCondition(async () => {
    lastCatalog = await vscode.commands.executeCommand(COMMAND_IDS.testGetCanvasTemplateItems);
    return Array.isArray(lastCatalog?.templates) && lastCatalog.templates.some(predicate);
  }, timeoutMs, () => `preview template catalog entry. Last catalog: ${JSON.stringify(lastCatalog)}`);
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

function normalizeSourceUrl(value) {
  assert.ok(value, 'Expected DEV_SESSION_CANVAS_TEMPLATE_MARKETPLACE_SOURCE_URL.');
  const url = new URL(value);
  assert.strictEqual(url.pathname, '/templates', 'Expected preview source URL to point to /templates.');
  url.search = '';
  url.hash = '';
  return url.toString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
