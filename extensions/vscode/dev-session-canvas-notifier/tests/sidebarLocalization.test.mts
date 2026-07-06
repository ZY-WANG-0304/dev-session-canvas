import assert from 'node:assert/strict';

import { ATTENTION_NOTIFICATION_PROTOCOL_VERSION } from '../../../../packages/attention-protocol/src/index.ts';
import { buildManualNotificationMessage } from '../src/manualNotificationCopy.ts';
import {
  formatNotifierLocalizedMessage,
  resolveNotifierLocale,
  type NotifierLocalize
} from '../src/notifierLocalization.ts';
import { buildNotifierEnvironmentSnapshot } from '../src/sidebarEnvironment.ts';
import { renderSectionHtml } from '../src/sidebarView.ts';

const zhCnBundle = (await import('../l10n/bundle.l10n.zh-cn.json', { with: { type: 'json' } })).default as Record<string, string>;
const zhCnLocalize: NotifierLocalize = (message, args) =>
  formatNotifierLocalizedMessage(zhCnBundle[message] ?? message, args);
const englishLocalize: NotifierLocalize = (message, args) => formatNotifierLocalizedMessage(message, args);

assert.equal(resolveNotifierLocale('en'), 'en');
assert.equal(resolveNotifierLocale('zh-cn'), 'zh-CN');
assert.equal(resolveNotifierLocale('zh-hans'), 'zh-CN');
assert.equal(resolveNotifierLocale('fr'), 'en');

const englishSnapshot = buildNotifierEnvironmentSnapshot(
  {
    platform: 'linux',
    modeLabel: 'production',
    playSoundEnabled: true,
    notifySendAvailable: true
  },
  englishLocalize
);
assert.equal(englishSnapshot.currentRouteLabel, 'notify-send');
assert.equal(englishSnapshot.activationLabel, 'Depends on desktop environment');
assert.equal(englishSnapshot.soundLabel, 'On');
assert.match(englishSnapshot.notes.join('\n'), /local UI side/);

const chineseSnapshot = buildNotifierEnvironmentSnapshot(
  {
    platform: 'linux',
    modeLabel: 'production',
    playSoundEnabled: false,
    notifySendAvailable: true
  },
  zhCnLocalize
);
assert.equal(chineseSnapshot.activationLabel, '取决于桌面环境');
assert.equal(chineseSnapshot.soundLabel, '已关闭');
assert.match(chineseSnapshot.notes.join('\n'), /本机 UI 端/);
assert.match(chineseSnapshot.installRequirements[0]?.hints?.join('\n') ?? '', /libnotify-bin/);

const webview = { cspSource: 'vscode-resource:' };
const latestRecord = {
  request: {
    version: ATTENTION_NOTIFICATION_PROTOCOL_VERSION,
    kind: 'execution-attention' as const,
    title: 'Dev Session Canvas',
    message: 'Agent「Notifier」: ready',
    dedupeKey: 'osc9:notifier-ready'
  },
  result: {
    status: 'posted' as const,
    backend: 'linux-notify-send' as const,
    activationMode: 'none' as const,
    detail: 'posted-without-activation'
  }
};

const englishHtml = renderSectionHtml(webview, 'status', englishSnapshot, {
  latestRecord,
  latestManualAttempt: { requestedAt: '2026-07-06T00:00:00.000Z' },
  locale: 'en',
  localize: englishLocalize
});
assert.match(englishHtml, /<html lang="en">/);
assert.match(englishHtml, /Current environment/);
assert.match(englishHtml, /Send Test Notification/);
assert.match(englishHtml, /View Diagnostic Log/);
assert.match(englishHtml, /Notifications are working/);

const chineseHtml = renderSectionHtml(webview, 'status', chineseSnapshot, {
  latestRecord,
  latestManualAttempt: { requestedAt: '2026-07-06T00:00:00.000Z' },
  locale: 'zh-CN',
  localize: zhCnLocalize
});
assert.match(chineseHtml, /<html lang="zh-CN">/);
assert.match(chineseHtml, /当前环境/);
assert.match(chineseHtml, /发送测试通知/);
assert.match(chineseHtml, /查看诊断日志/);
assert.match(chineseHtml, /通知功能正常/);

assert.equal(
  buildManualNotificationMessage(
    {
      status: 'posted',
      backend: 'test',
      activationMode: 'test-replay'
    },
    englishLocalize
  ),
  'Test desktop notification was sent (backend=test, activation=test-replay). Click the system notification to complete manual validation.'
);
assert.equal(
  buildManualNotificationMessage(
    {
      status: 'posted',
      backend: 'test',
      activationMode: 'test-replay'
    },
    zhCnLocalize
  ),
  '测试桌面通知已发出（backend=test，activation=test-replay）。请点击系统通知完成人工验收。'
);

console.log('notifier sidebar localization tests passed');
