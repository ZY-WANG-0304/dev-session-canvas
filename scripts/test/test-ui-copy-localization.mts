import assert from 'node:assert/strict';

import {
  enWebviewMessages,
  formatWebviewMessage,
  normalizeWebviewLocale,
  resolveWebviewI18n
} from '../../extensions/vscode/dev-session-canvas/src/webview/i18n/webviewI18n.ts';

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

console.log('ui copy localization tests passed');
