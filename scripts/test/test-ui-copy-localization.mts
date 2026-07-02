import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  enWebviewMessages,
  formatWebviewMessage,
  normalizeWebviewLocale,
  resolveWebviewI18n
} from '../../extensions/vscode/dev-session-canvas/src/webview/i18n/webviewI18n.ts';

const extensionHostSource = readFileSync(
  path.join(process.cwd(), 'extensions/vscode/dev-session-canvas/src/extension.ts'),
  'utf8'
);
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

const hostRuntimeSourceStrings = extractHostRuntimeL10nSourceStrings(extensionHostSource);
assert.ok(
  hostRuntimeSourceStrings.length > 0,
  'Expected extension.ts to contain Host runtime vscode.l10n.t source strings.'
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
