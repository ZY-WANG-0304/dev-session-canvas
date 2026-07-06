import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { ATTENTION_NOTIFICATION_PROTOCOL_VERSION } from '../../../../packages/attention-protocol/src/index.ts';
import {
  buildLinuxNotifySendInvocation,
  buildMacOSAppleScriptInvocation,
  buildMacOSTerminalNotifierInvocation,
  buildWindowsToastInvocation,
  launchShellInvocation
} from '../src/platformNotification.ts';
import { buildNotifierEnvironmentSnapshot } from '../src/sidebarEnvironment.ts';
import { formatNotifierLocalizedMessage, type NotifierLocalize } from '../src/notifierLocalization.ts';

const zhCnBundle = (await import('../l10n/bundle.l10n.zh-cn.json', { with: { type: 'json' } })).default as Record<string, string>;
const zhCnLocalize: NotifierLocalize = (message, args) =>
  formatNotifierLocalizedMessage(zhCnBundle[message] ?? message, args);

const request = {
  version: ATTENTION_NOTIFICATION_PROTOCOL_VERSION,
  kind: 'execution-attention' as const,
  title: 'Dev Session Canvas',
  message: 'Agent「Notifier」: ready',
  dedupeKey: 'osc9:notifier-ready',
  focusAction: {
    command: 'devSessionCanvas.__internal.centerAttentionNode',
    arguments: ['node-1']
  }
};
const callbackUri = 'vscode://devsessioncanvas.dev-session-canvas-notifier/focus?token=test-token';

const linuxInvocation = buildLinuxNotifySendInvocation({
  request,
  callbackUri,
  onDidActivate: () => undefined,
  playSound: true
});
assert.equal(linuxInvocation.command, 'notify-send');
assert.equal(linuxInvocation.activationMode, 'direct-action');
assert.ok(linuxInvocation.args.includes('--wait'));
assert.ok(linuxInvocation.args.includes('--action=view=View Node'));

const localizedLinuxInvocation = buildLinuxNotifySendInvocation({
  request,
  callbackUri,
  onDidActivate: () => undefined,
  playSound: true,
  actionLabel: '查看节点'
});
assert.ok(localizedLinuxInvocation.args.includes('--action=view=查看节点'));
assert.ok(linuxInvocation.args.includes('--hint=string:sound-name:message-new-instant'));

const silentLinuxInvocation = buildLinuxNotifySendInvocation({
  request,
  callbackUri,
  onDidActivate: () => undefined,
  playSound: false
});
assert.ok(silentLinuxInvocation.args.includes('--hint=boolean:suppress-sound:true'));

const terminalNotifierInvocation = buildMacOSTerminalNotifierInvocation({
  request,
  callbackUri,
  playSound: true
});
assert.equal(terminalNotifierInvocation?.command, 'terminal-notifier');
assert.equal(terminalNotifierInvocation?.activationMode, 'protocol');
assert.ok(terminalNotifierInvocation?.args.includes(callbackUri));
assert.ok(terminalNotifierInvocation?.args.includes('-sound'));
assert.ok(terminalNotifierInvocation?.args.includes('default'));

const silentTerminalNotifierInvocation = buildMacOSTerminalNotifierInvocation({
  request,
  callbackUri,
  playSound: false
});
assert.equal(silentTerminalNotifierInvocation?.args.includes('-sound'), false);

const osascriptInvocation = buildMacOSAppleScriptInvocation({ request, playSound: true });
assert.equal(osascriptInvocation.command, 'osascript');
assert.equal(osascriptInvocation.activationMode, 'none');
assert.match(osascriptInvocation.args.join(' '), /display notification/);
assert.match(osascriptInvocation.args.join(' '), /sound name "Submarine"/);

const silentOsascriptInvocation = buildMacOSAppleScriptInvocation({ request, playSound: false });
assert.doesNotMatch(silentOsascriptInvocation.args.join(' '), /sound name "Submarine"/);

const windowsInvocation = buildWindowsToastInvocation({
  request,
  callbackUri,
  playSound: true
});
assert.equal(windowsInvocation.command, 'powershell.exe');
assert.equal(windowsInvocation.activationMode, 'protocol');
assert.ok(windowsInvocation.args.includes('-EncodedCommand'));
const encodedCommand = windowsInvocation.args[windowsInvocation.args.indexOf('-EncodedCommand') + 1];
const windowsScript = Buffer.from(encodedCommand, 'base64').toString('utf16le');
assert.match(windowsScript, /\$toastXml = @'\r?\n<toast activationType="protocol"/);
assert.match(windowsScript, /\r?\n'@\r?\n\$xml\.LoadXml\(\$toastXml\)/);
assert.match(windowsScript, /<audio src="ms-winsoundevent:Notification\.Default"\/>/);

const silentWindowsInvocation = buildWindowsToastInvocation({
  request,
  callbackUri,
  playSound: false
});
const silentWindowsCommand = silentWindowsInvocation.args[silentWindowsInvocation.args.indexOf('-EncodedCommand') + 1];
const silentWindowsScript = Buffer.from(silentWindowsCommand, 'base64').toString('utf16le');
assert.match(silentWindowsScript, /<audio silent="true"\/>/);

const sidebarSnapshot = buildNotifierEnvironmentSnapshot({
  platform: 'darwin',
  modeLabel: 'development',
  playSoundEnabled: false,
  terminalNotifierAvailable: true
}, zhCnLocalize);
assert.equal(sidebarSnapshot.soundLabel, '已关闭');
assert.match(sidebarSnapshot.soundDetail, /静音通知/);
assert.equal(sidebarSnapshot.activationKind, 'protocol');
assert.equal(sidebarSnapshot.installRequirements[0]?.statusLabel, '已安装');
assert.match(sidebarSnapshot.installRequirements[0]?.hints?.join('\n') ?? '', /brew install terminal-notifier/);
assert.equal(sidebarSnapshot.platformGuides.length, 3);
assert.equal(sidebarSnapshot.platformGuides[0]?.platformLabel, 'macOS');
assert.equal(sidebarSnapshot.platformGuides[0]?.sections?.[0]?.title, 'terminal-notifier');
assert.equal(sidebarSnapshot.platformGuides[0]?.sections?.[1]?.title, 'osascript');
assert.equal(sidebarSnapshot.platformGuides[1]?.platformLabel, 'Linux');
assert.equal(sidebarSnapshot.platformGuides[2]?.platformLabel, 'Windows');
assert.equal(sidebarSnapshot.agentConfigurationGuides[0]?.agentLabel, 'Codex');
assert.match(sidebarSnapshot.agentConfigurationGuides[0]?.recommendedSnippet ?? '', /\[tui\]/);
assert.match(sidebarSnapshot.agentConfigurationGuides[1]?.recommendedSnippet ?? '', /preferredNotifChannel/);
assert.match(sidebarSnapshot.notes.join('\n'), /Agent 实际运行宿主/);

const linuxSnapshot = buildNotifierEnvironmentSnapshot({
  platform: 'linux',
  modeLabel: 'production',
  playSoundEnabled: true,
  notifySendAvailable: false
}, zhCnLocalize);
assert.equal(linuxSnapshot.activationKind, 'none');
assert.equal(linuxSnapshot.installRequirements[0]?.statusLabel, '未安装');
assert.match(linuxSnapshot.installRequirements[0]?.hints?.join('\n') ?? '', /libnotify-bin/);
assert.equal(linuxSnapshot.platformGuides[1]?.statusLabel, '当前平台');

const macOSFallbackSnapshot = buildNotifierEnvironmentSnapshot({
  platform: 'darwin',
  modeLabel: 'production',
  playSoundEnabled: true,
  terminalNotifierAvailable: false
}, zhCnLocalize);
assert.equal(macOSFallbackSnapshot.currentRouteLabel, 'osascript');
assert.equal(macOSFallbackSnapshot.installRequirements[0]?.name, 'terminal-notifier');
assert.equal(macOSFallbackSnapshot.installRequirements[1]?.name, 'osascript');

type LaunchOptions = Parameters<typeof launchShellInvocation>[1];

function createUnsupportedNotifySendSpawn(): NonNullable<LaunchOptions['spawnCommand']> {
  // Keep the unsupported-option fixture deterministic instead of racing a real child process.
  return (() => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter & { setEncoding: (encoding: BufferEncoding) => void };
      stderr: EventEmitter & { setEncoding: (encoding: BufferEncoding) => void };
      stdin: { end: (input?: string, encoding?: BufferEncoding) => void };
    };
    child.stdout = new EventEmitter() as EventEmitter & { setEncoding: (encoding: BufferEncoding) => void };
    child.stderr = new EventEmitter() as EventEmitter & { setEncoding: (encoding: BufferEncoding) => void };
    child.stdin = { end: () => undefined };
    child.stdout.setEncoding = () => undefined;
    child.stderr.setEncoding = () => undefined;

    queueMicrotask(() => {
      child.emit('spawn');
      queueMicrotask(() => {
        child.stderr.emit('data', 'unknown option\n');
        child.emit('close', 1);
      });
    });

    return child;
  }) as NonNullable<LaunchOptions['spawnCommand']>;
}

const downgradedLinuxResult = await launchShellInvocation(
  {
    backend: 'linux-notify-send',
    activationMode: 'direct-action',
    command: 'notify-send',
    args: ['--action=view=View Node', '--wait']
  },
  {
    settlePostedOnSpawn: true,
    spawnSuccessDelayMs: 50,
    spawnCommand: createUnsupportedNotifySendSpawn(),
    fallback: async (failure) => {
      assert.match(failure.detail, /unknown option/);
      return {
        status: 'posted',
        backend: 'linux-notify-send',
        activationMode: 'none',
        detail: 'posted-without-activation'
      };
    }
  }
);
assert.deepEqual(downgradedLinuxResult, {
  status: 'posted',
  backend: 'linux-notify-send',
  activationMode: 'none',
  detail: 'posted-without-activation'
});

console.log('notifier platform notification tests passed');
