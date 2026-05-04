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
  onDidActivate: () => undefined
});
assert.equal(linuxInvocation.command, 'notify-send');
assert.equal(linuxInvocation.activationMode, 'direct-action');
assert.ok(linuxInvocation.args.includes('--wait'));
assert.ok(linuxInvocation.args.includes('--action=view=查看节点'));

const terminalNotifierInvocation = buildMacOSTerminalNotifierInvocation({
  request,
  callbackUri
});
assert.equal(terminalNotifierInvocation?.command, 'terminal-notifier');
assert.equal(terminalNotifierInvocation?.activationMode, 'protocol');
assert.ok(terminalNotifierInvocation?.args.includes(callbackUri));

const osascriptInvocation = buildMacOSAppleScriptInvocation({ request });
assert.equal(osascriptInvocation.command, 'osascript');
assert.equal(osascriptInvocation.activationMode, 'none');
assert.match(osascriptInvocation.args.join(' '), /display notification/);

const windowsInvocation = buildWindowsToastInvocation({
  request,
  callbackUri
});
assert.equal(windowsInvocation.command, 'powershell.exe');
assert.equal(windowsInvocation.activationMode, 'protocol');
assert.ok(windowsInvocation.args.includes('-EncodedCommand'));
const encodedCommand = windowsInvocation.args[windowsInvocation.args.indexOf('-EncodedCommand') + 1];
const windowsScript = Buffer.from(encodedCommand, 'base64').toString('utf16le');
assert.match(windowsScript, /\$toastXml = @'\r?\n<toast activationType="protocol"/);
assert.match(windowsScript, /\r?\n'@\r?\n\$xml\.LoadXml\(\$toastXml\)/);

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
