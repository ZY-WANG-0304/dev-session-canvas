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
const templateMarketplacePanelSource = readFileSync(
  path.join(process.cwd(), 'extensions/vscode/dev-session-canvas/src/panel/CanvasTemplateMarketplacePanel.ts'),
  'utf8'
);
const templateMarketplaceClientSource = readFileSync(
  path.join(process.cwd(), 'extensions/vscode/dev-session-canvas/src/panel/TemplateMarketplaceClient.ts'),
  'utf8'
);
const sharedPresentationSourceFiles = [
  'extensions/vscode/dev-session-canvas/src/common/agentLaunchPresets.ts',
  'extensions/vscode/dev-session-canvas/src/common/canvasNodeStatusPresentation.ts',
  'extensions/vscode/dev-session-canvas/src/common/executionCwdLabel.ts',
  'extensions/vscode/dev-session-canvas/src/panel/agentCliResolver.ts'
];
const sharedPresentationSources = sharedPresentationSourceFiles.map((filePath) => ({
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
  const allowedPatterns = [
    /^\s*throw new Error\(`节点 \$\{nodeId\}/u,
    /^\s*throw new Error\(`未找到节点 \$\{nodeId\}/u,
    /^\s*throw new Error\(`未找到连线 \$\{edgeId\}。`\);$/u,
    /^\s*case '(?:删除|启动|停止|新建|重启|恢复|重新加载|复制草稿|覆盖文件|创建空文件并关联)':$/u
  ];
  return source
    .split(/\r?\n/u)
    .map((line, index) => ({ lineNumber: index + 1, line }))
    .filter(({ line }) => /[\p{Script=Han}]/u.test(line))
    .filter(({ line }) => !allowedPatterns.some((pattern) => pattern.test(line)));
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
