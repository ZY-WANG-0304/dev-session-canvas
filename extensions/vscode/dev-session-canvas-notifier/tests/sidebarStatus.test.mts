import assert from 'node:assert/strict';

import { ATTENTION_NOTIFICATION_PROTOCOL_VERSION } from '../../../../packages/attention-protocol/src/index.ts';
import { buildNotifierEnvironmentSnapshot } from '../src/sidebarEnvironment.ts';
import {
  activationModeSupportsCallback,
  resolveSidebarActivationMode
} from '../src/sidebarStatus.ts';

const request = {
  version: ATTENTION_NOTIFICATION_PROTOCOL_VERSION,
  kind: 'execution-attention' as const,
  title: 'Dev Session Canvas',
  message: 'Agent「Notifier」: ready',
  dedupeKey: 'osc9:notifier-ready'
};

const linuxSnapshot = buildNotifierEnvironmentSnapshot({
  platform: 'linux',
  modeLabel: 'production',
  playSoundEnabled: true,
  notifySendAvailable: true
});

assert.equal(linuxSnapshot.activationKind, 'direct-action');
assert.equal(
  resolveSidebarActivationMode(linuxSnapshot, undefined),
  'direct-action',
  '缺少最新投递结果时，应继续使用 snapshot 的平台能力判断。'
);
assert.equal(
  activationModeSupportsCallback(resolveSidebarActivationMode(linuxSnapshot, undefined)),
  true,
  '默认 Linux notify-send 主路径应视为支持点击回跳。'
);

const downgradedLinuxRecord = {
  request,
  result: {
    status: 'posted' as const,
    backend: 'linux-notify-send' as const,
    activationMode: 'none' as const,
    detail: 'posted-without-activation'
  }
};

assert.equal(
  resolveSidebarActivationMode(linuxSnapshot, downgradedLinuxRecord),
  'none',
  '最近一次已投递结果明确降级为 none 时，应覆盖 snapshot 的 direct-action 预估。'
);
assert.equal(
  activationModeSupportsCallback(resolveSidebarActivationMode(linuxSnapshot, downgradedLinuxRecord)),
  false,
  'Linux 降级投递结果不应再被渲染成支持点击回跳。'
);

console.log('notifier sidebar status tests passed');
