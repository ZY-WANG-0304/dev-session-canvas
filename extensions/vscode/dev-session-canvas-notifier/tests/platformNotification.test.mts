import assert from 'node:assert/strict';

import {
  ATTENTION_NOTIFICATION_PROTOCOL_VERSION,
  encodeAttentionNotificationFocusAction
} from '../../../../packages/attention-protocol/src/index.ts';
import {
  buildLinuxNotifySendInvocation,
  buildMacOSAppleScriptInvocation,
  buildMacOSTerminalNotifierInvocation,
  buildWindowsToastInvocation,
  launchShellInvocation
} from '../src/platformNotification.ts';
import { buildNotifierEnvironmentSnapshot } from '../src/sidebarEnvironment.ts';

const request = {
  version: ATTENTION_NOTIFICATION_PROTOCOL_VERSION,
  kind: 'execution-attention' as const,
  title: 'Dev Session Canvas',
  message: 'Agent「Notifier」: ready',
  dedupeKey: 'osc9:notifier-ready',
  focusAction: {
    command: 'devSessionCanvas.__internal.focusNode',
    arguments: ['node-1']
  }
};
const callbackUri = `vscode://devsessioncanvas.dev-session-canvas-notifier/focus?payload=${encodeURIComponent(
  encodeAttentionNotificationFocusAction(request.focusAction)
)}`;

const linuxInvocation = buildLinuxNotifySendInvocation({
  request,
  callbackUri,
  onDidActivate: () => undefined,
  playSound: true
});
assert.equal(linuxInvocation.command, 'notify-send');
assert.equal(linuxInvocation.activationMode, 'direct-action');
assert.ok(linuxInvocation.args.includes('--wait'));
assert.ok(linuxInvocation.args.includes('--action=view=查看节点'));
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
assert.match(osascriptInvocation.args.join(' '), /beep/);

const silentOsascriptInvocation = buildMacOSAppleScriptInvocation({ request, playSound: false });
assert.doesNotMatch(silentOsascriptInvocation.args.join(' '), /beep/);

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
});
assert.equal(sidebarSnapshot.soundLabel, '已关闭');
assert.match(sidebarSnapshot.soundDetail, /静音路径/);

const downgradedLinuxResult = await launchShellInvocation(
  {
    backend: 'linux-notify-send',
    activationMode: 'direct-action',
    command: process.execPath,
    args: ['-e', 'console.error("unknown option"); process.exit(1)']
  },
  {
    settlePostedOnSpawn: true,
    spawnSuccessDelayMs: 50,
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
