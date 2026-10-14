import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const source = await readFile('tests/vscode-smoke/template-marketplace-tests.cjs', 'utf8');
let passed = 0;

// Execute the real scenario functions, including their original interceptors and
// assertions. Virtual time controls delivery after the fixture receives a request.
async function runScenario(kind, { delayMs = 300, requestCount = 1, message } = {}) {
  let clock = 0;
  let notification;
  let state = 'list';
  const isVersion = kind === 'version';
  const name = isVersion ? 'Panel Review Loop' : 'VS Code Publish Smoke';
  const slug = isVersion ? 'panel-review-loop' : 'vs-code-publish-smoke';
  const versionNumber = isVersion ? 3 : 1;
  const expectedMessage = `Template "${name}" has been published to Template Marketplace v${versionNumber}.`;
  const originalInformationMessage = async () => undefined;
  const originalAuthenticationSession = async () => undefined;
  const originalQuickPick = async () => undefined;
  const originalInputBox = async () => undefined;
  const vscode = {
    window: {
      showInformationMessage: originalInformationMessage,
      showQuickPick: originalQuickPick,
      showInputBox: originalInputBox
    },
    authentication: { getSession: originalAuthenticationSession },
    commands: { executeCommand }
  };
  const context = vm.createContext({
    module: { exports: {} },
    require: (id) => id === 'vscode' ? vscode : id === 'assert' ? require('node:assert') : {},
    Date: class extends Date { static now() { return clock; } },
    setTimeout: (callback, ms) => {
      clock += ms;
      if (notification && clock >= notification.at) {
        const { text } = notification;
        notification = undefined;
        void vscode.window.showInformationMessage(text);
      }
      callback();
    }
  });
  vm.runInContext(source + '\nmodule.exports = { verifyMarketplacePanelPublish, verifyMarketplacePanelPublishVersion };', context);
  const fixture = vm.runInContext('({ publishedRequests: [], publishedVersionRequests: [] })', context);
  if (!isVersion) vm.runInContext('verifyMarketplacePanelPublishVersion = async () => {};', context);

  function probe() {
    return {
      view: state,
      publishMode: isVersion ? 'version' : 'new',
      publishTemplateIdOrSlug: slug,
      publishSelectedTemplateId: 'saved-template',
      publishTemplateNames: ['VS Code Publish Source'],
      publishVersionTargetName: name,
      publishForm: {
        name: isVersion ? name : 'VS Code Publish Source',
        templateJson: isVersion ? name : 'VS Code Publish Source'
      },
      publishedTemplate: { name, slug, versionNumber },
      publishStatusText: `Template "${name}" has been published to Template Marketplace v${versionNumber}.`,
      activeTemplateSlug: slug,
      detailTitle: name,
      detailReadmeText: 'Published from the VS Code marketplace panel.',
      versionMenuItems: ['Update to v3'],
      visibleTemplateNames: [name]
    };
  }

  async function executeCommand(command, action) {
    if (command.endsWith('saveCanvasAsTemplate')) return { template: { id: 'saved-template' } };
    if (command.endsWith('captureTemplateMarketplaceProbe')) return probe();
    if (!command.endsWith('performTemplateMarketplaceAction')) return;
    if (action.kind === 'openDetail') state = 'detail';
    if (action.kind === 'backToList') state = 'list';
    if (action.kind === 'publish' || action.kind === 'publishVersion') state = 'publish';
    if (action.kind === 'submitPublishForm') {
      await vscode.authentication.getSession('github', [], {});
      const requests = isVersion ? fixture.publishedVersionRequests : fixture.publishedRequests;
      const tags = vm.runInContext('["smoke", "vscode"]', context);
      for (let index = 0; index < requestCount; index++) requests.push({
        authorization: 'Bearer marketplace-e2e-token',
        templateIdOrSlug: slug,
        body: {
          name, slug, tags,
          changelog: 'Add a VS Code publisher version from fixture E2E.',
          templateDocument: { template: { nodes: [{}] } },
          thumbnailPngBase64: 'thumbnail'
        }
      });
      if (delayMs !== null) {
        notification = { at: clock + delayMs, text: message ?? expectedMessage };
        if (delayMs === 0) {
          notification = undefined;
          await vscode.window.showInformationMessage(message ?? expectedMessage);
        }
      }
    }
    return probe();
  }

  try {
    const run = isVersion ? context.module.exports.verifyMarketplacePanelPublishVersion : context.module.exports.verifyMarketplacePanelPublish;
    await run(fixture);
    return clock;
  } catch (error) {
    error.elapsedMs = clock;
    throw error;
  } finally {
    assert.equal(vscode.window.showInformationMessage, originalInformationMessage, 'notification interceptor must be restored');
    assert.equal(vscode.authentication.getSession, originalAuthenticationSession, 'authentication interceptor must be restored');
    assert.equal(vscode.window.showQuickPick, originalQuickPick, 'quick-pick interceptor must be restored');
    assert.equal(vscode.window.showInputBox, originalInputBox, 'input interceptor must be restored');
  }
}

for (const kind of ['new', 'version']) {
  for (const delayMs of [0, 300, 19900]) {
    assert.equal(await runScenario(kind, { delayMs }), delayMs);
    passed++;
    console.log(`PASS ${kind}: notification after ${delayMs} ms preserves original request and UI assertions`);
  }
  for (const [label, options] of [
    ['missing notification', { delayMs: null }],
    ['wrong version notification', { message: `Template "${kind === 'version' ? 'Panel Review Loop' : 'VS Code Publish Smoke'}" has been published to Template Marketplace v2.` }],
    ['wrong template notification', { message: 'Template "Other" has been published to Template Marketplace v3.' }],
    ['unrelated notification', { message: 'An unrelated operation completed.' }],
    ['notification after deadline', { delayMs: 20100 }],
    ['missing request', { requestCount: 0, delayMs: 0 }],
    ['duplicate requests', { requestCount: 2, delayMs: 0 }]
  ]) {
    await assert.rejects(runScenario(kind, options), (error) => {
      assert.equal(error.code, 'ERR_ASSERTION');
      assert.match(error.message, /Timed out waiting for publish.*request and success information message/);
      assert.equal(error.elapsedMs, 20000, 'request and notification share the original total budget');
      assert.match(error.message, /Requests: [012]\. Messages: /);
      return true;
    });
    passed++;
    console.log(`PASS ${kind}: ${label} fails at the original 20000 ms deadline`);
  }
}
console.log(`Marketplace publish smoke regression: ${passed} passed.`);
