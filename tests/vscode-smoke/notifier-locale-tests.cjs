const assert = require('assert');
const vscode = require('vscode');
const { activateVisibleExtension, waitForCommand } = require('./test-helpers.cjs');

const NOTIFIER_EXTENSION_ID = 'devsessioncanvas.dev-session-canvas-notifier';
const NOTIFIER_COMMAND_IDS = {
  sendTestNotification: 'devSessionCanvasNotifier.sendTestNotification'
};
const NOTIFIER_TEST_COMMAND_IDS = {
  getPostedNotifications: 'devSessionCanvasNotifier.__test.getPostedNotifications',
  clearPostedNotifications: 'devSessionCanvasNotifier.__test.clearPostedNotifications',
  getLocalizationSnapshot: 'devSessionCanvasNotifier.__test.getLocalizationSnapshot',
  getLastWorkbenchPrompt: 'devSessionCanvasNotifier.__test.getLastWorkbenchPrompt',
  replayLastFocusAction: 'devSessionCanvasNotifier.__test.replayLastFocusAction'
};

const EXPECTED_COPY_BY_LOCALE = {
  en: {
    envLanguage: 'en',
    htmlLang: 'en',
    commandTitle: 'Dev Session Canvas Notifier: Send Test Desktop Notification',
    statusViewName: 'Overview',
    notesViewName: 'Notes',
    playSoundDescriptionPrefix: 'Controls whether the notifier companion requests an alert sound',
    currentRouteLabel: 'In-memory test backend',
    activationLabel: 'Test replay',
    soundLabel: 'On',
    noteText: 'local UI side',
    agentGuideDetail: 'Enable notifications in the Codex TUI configuration',
    manualNotification: 'Test desktop notification was sent',
    actionLabel: 'View Node',
    openOutputAction: 'Open Output',
    callbackMessage: 'Dev Session Canvas Notifier received the test notification click callback.',
    renderedStatusText: 'Current environment',
    renderedButtonText: 'Send Test Notification',
    renderedNotesText: 'local UI side',
    renderedAgentText: 'Enable notifications in the Codex TUI configuration'
  },
  'zh-cn': {
    envLanguage: 'zh-cn',
    htmlLang: 'zh-CN',
    commandTitle: 'Dev Session Canvas Notifier: 发送测试桌面通知',
    statusViewName: '概览',
    notesViewName: '注意事项',
    playSoundDescriptionPrefix: '控制 notifier companion',
    currentRouteLabel: '内存测试后端',
    activationLabel: '测试回放',
    soundLabel: '已开启',
    noteText: '本机 UI 端',
    agentGuideDetail: '在 Agent 实际运行宿主上的 Codex TUI 配置里开启通知',
    manualNotification: '测试桌面通知已发出',
    actionLabel: '查看节点',
    openOutputAction: '打开输出',
    callbackMessage: 'Dev Session Canvas Notifier 已收到测试通知点击回调。',
    renderedStatusText: '当前环境',
    renderedButtonText: '发送测试通知',
    renderedNotesText: '本机 UI 端',
    renderedAgentText: '在 Agent 实际运行宿主上的 Codex TUI 配置里开启通知'
  }
};

module.exports = {
  run
};

async function run() {
  const locale = normalizeExpectedLocale(process.env.DEV_SESSION_CANVAS_EXPECTED_LOCALE);
  const expected = EXPECTED_COPY_BY_LOCALE[locale];

  const extension = await activateVisibleExtension(vscode, NOTIFIER_EXTENSION_ID);
  await waitForCommand(vscode, NOTIFIER_TEST_COMMAND_IDS.getLocalizationSnapshot);
  await waitForCommand(vscode, NOTIFIER_TEST_COMMAND_IDS.clearPostedNotifications);
  await vscode.commands.executeCommand(NOTIFIER_TEST_COMMAND_IDS.clearPostedNotifications);

  assert.strictEqual(
    vscode.env.language.toLowerCase(),
    expected.envLanguage,
    `Expected VS Code to start with ${expected.envLanguage} locale.`
  );

  await openNotifierSidebar();
  let snapshot = await getLocalizationSnapshot();
  verifyLocalizedManifest(snapshot.manifest, expected);
  verifyLocalizedSidebarSnapshot(snapshot.sidebar, expected);
  verifyRenderedSidebarSnapshot(snapshot.renderedSidebar, expected);

  await verifyManualNotificationCommand(expected);

  snapshot = await getLocalizationSnapshot();
  verifyLocalizedManualNotificationSnapshot(snapshot, expected);

  const postedNotifications = await vscode.commands.executeCommand(NOTIFIER_TEST_COMMAND_IDS.getPostedNotifications);
  assert.strictEqual(postedNotifications.length, 1, 'Expected the locale smoke to post one manual test notification.');
  assert.strictEqual(postedNotifications[0].result.backend, 'test');
  assert.strictEqual(postedNotifications[0].result.activationMode, 'test-replay');
  assert.strictEqual(
    postedNotifications[0].request.message.includes(expected.renderedStatusText),
    false,
    'System notification body should use the manual notification copy, not sidebar section labels.'
  );
  assert.ok(
    postedNotifications[0].request.message.includes(locale === 'zh-cn' ? '测试桌面通知' : 'Test desktop notification'),
    'Expected system notification body to follow the active locale.'
  );

  const replayed = await vscode.commands.executeCommand(NOTIFIER_TEST_COMMAND_IDS.replayLastFocusAction);
  assert.strictEqual(replayed, true, 'Expected the manual test callback URI to replay once.');

  console.log(`Notifier locale smoke assertions passed for ${locale}.`);
}

async function openNotifierSidebar() {
  const commands = [
    'workbench.view.extension.devSessionCanvasNotifier',
    'devSessionCanvasNotifier.status.focus',
    'devSessionCanvasNotifier.notes.focus',
    'devSessionCanvasNotifier.codex.focus',
    'devSessionCanvasNotifier.status.focus'
  ];

  for (const command of commands) {
    await vscode.commands.executeCommand(command);
  }

  await waitForRenderedSidebarSections(['status', 'notes', 'codex']);
}

async function waitForRenderedSidebarSections(sections, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let lastSnapshot;

  while (Date.now() < deadline) {
    lastSnapshot = await getLocalizationSnapshot();
    const visibleSections = Array.isArray(lastSnapshot.renderedSidebar?.visibleSections)
      ? lastSnapshot.renderedSidebar.visibleSections
      : [];
    if (sections.every((section) => visibleSections.includes(section))) {
      return lastSnapshot;
    }
    await sleep(100);
  }

  assert.fail(
    `Timed out waiting for notifier sidebar sections ${sections.join(', ')}. Last snapshot: ${JSON.stringify(lastSnapshot ?? null)}`
  );
}

async function verifyManualNotificationCommand(expected) {
  await vscode.commands.executeCommand(NOTIFIER_COMMAND_IDS.sendTestNotification);
  const prompt = await vscode.commands.executeCommand(NOTIFIER_TEST_COMMAND_IDS.getLastWorkbenchPrompt);
  assert.strictEqual(prompt?.kind, 'information');
  assert.ok(
    prompt.message.includes(expected.manualNotification),
    `Expected workbench prompt to include localized text "${expected.manualNotification}", got "${prompt?.message}".`
  );
  assert.ok(
    prompt.actions.includes(expected.openOutputAction),
    `Expected workbench prompt action to include localized "${expected.openOutputAction}".`
  );
}

function verifyLocalizedManifest(manifest, expected) {
  assert.strictEqual(manifest?.sendTestCommandTitle, expected.commandTitle);
  assert.strictEqual(manifest?.statusViewName, expected.statusViewName);
  assert.strictEqual(manifest?.notesViewName, expected.notesViewName);
  assert.ok(
    manifest?.playSoundDescription?.startsWith(expected.playSoundDescriptionPrefix),
    `Expected playSound setting description to start with "${expected.playSoundDescriptionPrefix}", got "${manifest?.playSoundDescription}".`
  );
}

function verifyLocalizedSidebarSnapshot(sidebar, expected) {
  assert.strictEqual(sidebar?.htmlLang, expected.htmlLang);
  assert.strictEqual(sidebar?.currentRouteLabel, expected.currentRouteLabel);
  assert.strictEqual(sidebar?.activationLabel, expected.activationLabel);
  assert.strictEqual(sidebar?.soundLabel, expected.soundLabel);
  assert.ok(
    sidebar?.note?.includes(expected.noteText),
    `Expected localized sidebar note to include "${expected.noteText}", got "${sidebar?.note}".`
  );
  assert.ok(
    sidebar?.agentGuideDetail?.includes(expected.agentGuideDetail),
    `Expected localized agent guide to include "${expected.agentGuideDetail}", got "${sidebar?.agentGuideDetail}".`
  );
}

function verifyRenderedSidebarSnapshot(renderedSidebar, expected) {
  assert.ok(Array.isArray(renderedSidebar?.visibleSections), 'Expected rendered sidebar snapshot to include visible sections.');
  assert.ok(renderedSidebar.visibleSections.includes('status'), 'Expected the real notifier status view to be opened.');
  assert.ok(renderedSidebar.visibleSections.includes('notes'), 'Expected the real notifier notes view to be opened.');
  assert.ok(renderedSidebar.visibleSections.includes('codex'), 'Expected the real notifier Codex view to be opened.');

  assertHtmlContains(renderedSidebar.statusHtml, `lang="${expected.htmlLang}"`);
  assertHtmlContains(renderedSidebar.statusHtml, expected.renderedStatusText);
  assertHtmlContains(renderedSidebar.statusHtml, expected.renderedButtonText);
  assertHtmlContains(renderedSidebar.notesHtml, expected.renderedNotesText);
  assertHtmlContains(renderedSidebar.codexHtml, expected.renderedAgentText);
}

function verifyLocalizedManualNotificationSnapshot(snapshot, expected) {
  assert.ok(
    snapshot?.manualNotification?.includes(expected.manualNotification),
    `Expected manual notification snapshot to include "${expected.manualNotification}", got "${snapshot?.manualNotification}".`
  );
  assert.strictEqual(snapshot?.actionLabel, expected.actionLabel);
  assert.strictEqual(snapshot?.openOutputAction, expected.openOutputAction);
  assert.strictEqual(snapshot?.callbackMessage, expected.callbackMessage);
}

function assertHtmlContains(html, expectedText) {
  assert.strictEqual(typeof html, 'string', `Expected rendered sidebar HTML to be a string for "${expectedText}".`);
  assert.ok(html.includes(expectedText), `Expected rendered sidebar HTML to include "${expectedText}".`);
}

async function getLocalizationSnapshot() {
  return vscode.commands.executeCommand(NOTIFIER_TEST_COMMAND_IDS.getLocalizationSnapshot);
}

function normalizeExpectedLocale(value) {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'en' || normalized === 'zh-cn') {
    return normalized;
  }
  throw new Error(`DEV_SESSION_CANVAS_EXPECTED_LOCALE must be "en" or "zh-cn", got ${value ?? '<unset>'}.`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
