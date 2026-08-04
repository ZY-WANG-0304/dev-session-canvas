import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  enWebviewMessages,
  formatWebviewMessage,
  normalizeWebviewLocale,
  resolveWebviewI18n
} from '../../extensions/vscode/dev-session-canvas/src/webview/i18n/webviewI18n.ts';

const hostRuntimeSourceFiles = [
  'extensions/vscode/dev-session-canvas/src/extension.ts',
  'extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts',
  'extensions/vscode/dev-session-canvas/src/panel/agentLaunchLocalization.ts',
  'extensions/vscode/dev-session-canvas/src/panel/canvasTemplateLocalization.ts',
  'extensions/vscode/dev-session-canvas/src/panel/runtimeSupervisorLocalization.ts',
  'extensions/vscode/dev-session-canvas/src/panel/TemplateMarketplaceClient.ts',
  'extensions/vscode/dev-session-canvas/src/panel/CanvasTemplateMarketplacePanel.ts',
  'extensions/vscode/dev-session-canvas/src/panel/CanvasTemplateSaveFormPanel.ts',
  'extensions/vscode/dev-session-canvas/src/sidebar/CanvasSidebarActionsView.ts',
  'extensions/vscode/dev-session-canvas/src/sidebar/CanvasSidebarNodeListView.ts',
  'extensions/vscode/dev-session-canvas/src/sidebar/CanvasSidebarSessionHistoryView.ts',
  'extensions/vscode/dev-session-canvas/src/sidebar/CanvasSidebarTemplateView.ts',
  'extensions/vscode/dev-session-canvas/src/sidebar/CanvasSidebarView.ts'
];
const webviewMainSource = readFileSync(
  path.join(process.cwd(), 'extensions/vscode/dev-session-canvas/src/webview/main.tsx'),
  'utf8'
);
const webviewStylesSource = readFileSync(
  path.join(process.cwd(), 'extensions/vscode/dev-session-canvas/src/webview/styles.css'),
  'utf8'
);
const canvasPanelManagerSource = readFileSync(
  path.join(process.cwd(), 'extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts'),
  'utf8'
);
const templateMarketplacePanelSource = readFileSync(
  path.join(process.cwd(), 'extensions/vscode/dev-session-canvas/src/panel/CanvasTemplateMarketplacePanel.ts'),
  'utf8'
);
const templateMarketplaceClientSource = readFileSync(
  path.join(process.cwd(), 'extensions/vscode/dev-session-canvas/src/panel/TemplateMarketplaceClient.ts'),
  'utf8'
);
const sharedPresentationSourceFiles = [
  'extensions/vscode/dev-session-canvas/src/common/protocol.ts',
  'extensions/vscode/dev-session-canvas/src/common/agentLaunchPresets.ts',
  'extensions/vscode/dev-session-canvas/src/common/canvasTemplates.ts',
  'extensions/vscode/dev-session-canvas/src/common/canvasNodeStatusPresentation.ts',
  'extensions/vscode/dev-session-canvas/src/common/executionCwdLabel.ts',
  'extensions/vscode/dev-session-canvas/src/common/runtimeSupervisorPaths.ts',
  'extensions/vscode/dev-session-canvas/src/common/runtimeSupervisorProtocol.ts',
  'extensions/vscode/dev-session-canvas/src/panel/agentCliResolver.ts',
  'extensions/vscode/dev-session-canvas/src/panel/CanvasTemplateStore.ts'
];
const runtimeSupervisorSourceFiles = [
  'extensions/vscode/dev-session-canvas/src/supervisor/runtimeSupervisorMain.ts',
  'extensions/vscode/dev-session-canvas/src/supervisor/runtimeSupervisorLauncher.ts',
  'extensions/vscode/dev-session-canvas/src/panel/runtimeHostBackend.ts',
  'extensions/vscode/dev-session-canvas/src/panel/runtimeSupervisorClient.ts',
  'extensions/vscode/dev-session-canvas/src/panel/runtimeSupervisorLocalization.ts'
];
const runtimeSupervisorLocalizationSource = readFileSync(
  path.join(process.cwd(), 'extensions/vscode/dev-session-canvas/src/panel/runtimeSupervisorLocalization.ts'),
  'utf8'
);
const sharedPresentationSources = sharedPresentationSourceFiles.map((filePath) => ({
  filePath,
  source: readFileSync(path.join(process.cwd(), filePath), 'utf8')
}));
const runtimeSupervisorSources = runtimeSupervisorSourceFiles.map((filePath) => ({
  filePath,
  source: readFileSync(path.join(process.cwd(), filePath), 'utf8')
}));
const extensionHostSource = hostRuntimeSourceFiles
  .map((filePath) => readFileSync(path.join(process.cwd(), filePath), 'utf8'))
  .join('\n');
const runtimeChineseBundle = JSON.parse(
  readFileSync(
    path.join(process.cwd(), 'extensions/vscode/dev-session-canvas/l10n/bundle.l10n.zh-cn.json'),
    'utf8'
  )
) as Record<string, string>;

assert.equal(normalizeWebviewLocale('en'), 'en');
assert.equal(normalizeWebviewLocale('zh-cn'), 'zh-CN');
assert.equal(normalizeWebviewLocale('zh-CN'), 'zh-CN');
assert.equal(normalizeWebviewLocale('ja'), 'en');

const english = resolveWebviewI18n('en');
const chinese = resolveWebviewI18n('zh-cn');

assert.deepEqual(
  Object.keys(chinese.messages).sort(),
  Object.keys(enWebviewMessages).sort(),
  'Expected Chinese Webview messages to have the same keys as the English defaults.'
);
assert.equal(
  formatWebviewMessage(english.messages, 'standby.switch', { surface: 'workbench view' }),
  'Switch to workbench view'
);
assert.equal(
  formatWebviewMessage(chinese.messages, 'standby.switch', { surface: '工作台视图' }),
  '切换到工作台视图'
);
assert.equal(
  formatWebviewMessage(english.messages, 'agent.overlay.notStarted'),
  'Agent not started yet'
);
assert.equal(
  formatWebviewMessage(chinese.messages, 'agent.overlay.notStarted'),
  'Agent 尚未启动'
);
assert.equal(formatWebviewMessage(english.messages, 'action.resume'), 'Resume');
assert.equal(formatWebviewMessage(chinese.messages, 'action.resume'), '恢复');
assert.equal(formatWebviewMessage(english.messages, 'action.restart'), 'Restart');
assert.equal(formatWebviewMessage(chinese.messages, 'action.restart'), '重启');
assert.equal(
  formatWebviewMessage(english.messages, 'agent.action.resume.aria'),
  'Resume original session'
);
assert.equal(formatWebviewMessage(chinese.messages, 'agent.action.resume.aria'), '恢复原会话');

const webviewSourceKeys = extractWebviewI18nKeys(webviewMainSource);
assert.ok(
  webviewSourceKeys.length > 20,
  'Expected main Webview source to use the typed Webview i18n dictionary.'
);
for (const key of webviewSourceKeys) {
  assert.ok(Object.hasOwn(enWebviewMessages, key), `Expected English Webview messages to include key: ${key}`);
  assert.ok(Object.hasOwn(chinese.messages, key), `Expected Chinese Webview messages to include key: ${key}`);
  assert.ok(enWebviewMessages[key]?.trim(), `Expected English Webview message to be non-empty: ${key}`);
  assert.ok(chinese.messages[key]?.trim(), `Expected Chinese Webview message to be non-empty: ${key}`);
}

for (const finding of findUnexpectedWebviewMainChineseLines(webviewMainSource)) {
  assert.fail(
    `Unexpected hard-coded Chinese in main Webview source at line ${finding.lineNumber}: ${finding.line}`
  );
}

assert.match(
  canvasPanelManagerSource,
  /vscode\.window\s*\.withProgress\(/u,
  'Expected Runtime Supervisor recovery to use the VS Code progress API.'
);
assert.match(
  canvasPanelManagerSource,
  /vscode\.ProgressLocation\.Notification/u,
  'Expected Runtime Supervisor recovery progress to appear in the VS Code notification area.'
);
assert.match(
  canvasPanelManagerSource,
  /cancellable:\s*false/u,
  'Expected Runtime Supervisor recovery progress to remain non-cancellable.'
);
const recoveryProgressMessage =
  '{completed} session(s) completed, {pending} saved session(s) remaining. New sessions are ready to start.';
assert.match(
  canvasPanelManagerSource,
  /completed:\s*summary\.completedSessionCount/u,
  'Expected recovery progress to report the completed-session count.'
);
assert.match(
  canvasPanelManagerSource,
  /pending:\s*summary\.pendingSessionCount/u,
  'Expected recovery progress to report the remaining saved-session count.'
);
assert.equal(
  runtimeChineseBundle[recoveryProgressMessage],
  '已完成 {completed} 个会话，还剩 {pending} 个已保存会话；新会话可立即启动。',
  'Expected the recovery progress message to localize completed and remaining counts.'
);
assert.doesNotMatch(
  webviewMainSource,
  /runtimeRecovery|runtime-recovery-indicator/u,
  'Expected Runtime Supervisor recovery to stay out of the Canvas Webview.'
);
assert.doesNotMatch(
  webviewStylesSource,
  /runtime-recovery-indicator/u,
  'Expected the Canvas recovery indicator style to be removed.'
);

for (const finding of findUnexpectedTemplateMarketplacePanelChineseLines(templateMarketplacePanelSource)) {
  assert.fail(
    `Unexpected hard-coded Chinese in Template Marketplace panel source at line ${finding.lineNumber}: ${finding.line}`
  );
}

for (const finding of findUnexpectedTemplateMarketplaceClientChineseLines(templateMarketplaceClientSource)) {
  assert.fail(
    `Unexpected hard-coded Chinese in Template Marketplace client source at line ${finding.lineNumber}: ${finding.line}`
  );
}

for (const { filePath, source } of sharedPresentationSources) {
  for (const finding of findUnexpectedSharedPresentationChineseLines(source)) {
    assert.fail(`Unexpected hard-coded Chinese in ${filePath} at line ${finding.lineNumber}: ${finding.line}`);
  }
}

for (const { filePath, source } of runtimeSupervisorSources) {
  for (const finding of findUnexpectedRuntimeSupervisorChineseLines(source)) {
    assert.fail(`Unexpected hard-coded Chinese in ${filePath} at line ${finding.lineNumber}: ${finding.line}`);
  }
}

const hostRuntimeSourceStrings = extractHostRuntimeL10nSourceStrings(extensionHostSource);
assert.ok(
  hostRuntimeSourceStrings.length > 0,
  'Expected Host runtime source files to contain vscode.l10n.t source strings.'
);

for (const source of hostRuntimeSourceStrings) {
  assert.ok(
    Object.hasOwn(runtimeChineseBundle, source),
    `Expected zh-cn runtime l10n bundle to include Host source string: ${source}`
  );
  assert.ok(
    runtimeChineseBundle[source]?.trim(),
    `Expected zh-cn runtime l10n bundle translation to be non-empty: ${source}`
  );
}

for (const descriptorId of [
  'terminalAuthorityMismatch',
  'terminalRevisionInvalid',
  'terminalJournalUnavailable',
  'terminalJournalPersistenceFailed'
]) {
  assert.match(
    runtimeSupervisorLocalizationSource,
    new RegExp(`case '${descriptorId}':\\s*return vscode\\.l10n\\.t\\(`, 'u'),
    `Expected controlled runtime supervisor descriptor ${descriptorId} to localize at the Host boundary.`
  );
}

console.log('ui copy localization tests passed');

function extractHostRuntimeL10nSourceStrings(source: string): string[] {
  const regex = /vscode\.l10n\.t\(\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/gu;
  const messages = new Set<string>();
  for (const match of source.matchAll(regex)) {
    const message = match[2];
    if (message) {
      messages.add(message);
    }
  }
  return [...messages].sort();
}

function extractWebviewI18nKeys(source: string): Array<keyof typeof enWebviewMessages> {
  const regex = /\bt\(\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/gu;
  const keys = new Set<keyof typeof enWebviewMessages>();
  for (const match of source.matchAll(regex)) {
    const key = match[2] as keyof typeof enWebviewMessages;
    keys.add(key);
  }
  const countRegex =
    /\btCount\(\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1\s*,\s*(['"`])((?:\\.|(?!\3)[\s\S])*?)\3/gu;
  for (const match of source.matchAll(countRegex)) {
    keys.add(match[2] as keyof typeof enWebviewMessages);
    keys.add(match[4] as keyof typeof enWebviewMessages);
  }
  return [...keys].sort();
}

function findUnexpectedWebviewMainChineseLines(
  source: string
): Array<{ lineNumber: number; line: string }> {
  return source
    .split(/\r?\n/u)
    .map((line, index) => ({ lineNumber: index + 1, line }))
    .filter(({ line }) => /[\p{Script=Han}]/u.test(line));
}

function findUnexpectedTemplateMarketplacePanelChineseLines(
  source: string
): Array<{ lineNumber: number; line: string }> {
  return source
    .split(/\r?\n/u)
    .map((line, index) => ({ lineNumber: index + 1, line }))
    .filter(({ line }) => /[\p{Script=Han}]|zh-CN/u.test(line));
}

function findUnexpectedTemplateMarketplaceClientChineseLines(
  source: string
): Array<{ lineNumber: number; line: string }> {
  return source
    .split(/\r?\n/u)
    .map((line, index) => ({ lineNumber: index + 1, line }))
    .filter(({ line }) => /[\p{Script=Han}]|zh-CN/u.test(line));
}

function findUnexpectedSharedPresentationChineseLines(
  source: string
): Array<{ lineNumber: number; line: string }> {
  return source
    .split(/\r?\n/u)
    .map((line, index) => ({ lineNumber: index + 1, line }))
    .filter(({ line }) => /[\p{Script=Han}]|zh-CN/u.test(line));
}

function findUnexpectedRuntimeSupervisorChineseLines(
  source: string
): Array<{ lineNumber: number; line: string }> {
  return source
    .split(/\r?\n/u)
    .map((line, index) => ({ lineNumber: index + 1, line }))
    .filter(({ line }) => /[\p{Script=Han}]|zh-CN/u.test(line));
}
