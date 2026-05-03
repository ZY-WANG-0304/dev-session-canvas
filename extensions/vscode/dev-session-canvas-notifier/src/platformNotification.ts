import { spawn } from 'node:child_process';

import type {
  AttentionNotificationDeliveryResult,
  AttentionNotificationRequest
} from '../../../../packages/attention-protocol/src/index';

export interface DesktopNotificationOptions {
  request: AttentionNotificationRequest;
  callbackUri?: string;
  onDidActivate?: () => void | Promise<void>;
}

export interface ShellInvocation {
  backend: AttentionNotificationDeliveryResult['backend'];
  activationMode: AttentionNotificationDeliveryResult['activationMode'];
  command: string;
  args: string[];
  stdin?: string;
  waitForAction?: boolean;
  onActionOutput?: (stdout: string) => void | Promise<void>;
  postedDetail?: string;
}

export async function postDesktopNotification(
  options: DesktopNotificationOptions
): Promise<AttentionNotificationDeliveryResult> {
  if (process.platform === 'linux') {
    return postLinuxNotification(options);
  }

  if (process.platform === 'darwin') {
    return postMacOSNotification(options);
  }

  if (process.platform === 'win32') {
    return postWindowsNotification(options);
  }

  return {
    status: 'unsupported',
    backend: 'unsupported',
    activationMode: 'none',
    detail: `Unsupported platform: ${process.platform}`
  };
}

export function buildLinuxNotifySendInvocation(options: DesktopNotificationOptions): ShellInvocation {
  const args = ['--app-name=Dev Session Canvas'];
  if (options.callbackUri) {
    args.push('--action=view=查看节点', '--wait');
  }
  args.push(options.request.title, options.request.message);
  return {
    backend: 'linux-notify-send',
    activationMode: options.callbackUri ? 'direct-action' : 'none',
    command: 'notify-send',
    args,
    waitForAction: Boolean(options.callbackUri),
    onActionOutput:
      options.callbackUri && options.onDidActivate
        ? async (stdout) => {
            if (stdout.trim() === 'view') {
              await options.onDidActivate?.();
            }
          }
        : undefined
  };
}

export function buildMacOSTerminalNotifierInvocation(
  options: DesktopNotificationOptions
): ShellInvocation | undefined {
  if (!options.callbackUri) {
    return undefined;
  }

  return {
    backend: 'macos-terminal-notifier',
    activationMode: 'protocol',
    command: 'terminal-notifier',
    args: ['-title', options.request.title, '-message', options.request.message, '-open', options.callbackUri]
  };
}

export function buildMacOSAppleScriptInvocation(options: DesktopNotificationOptions): ShellInvocation {
  const script = `display notification ${appleScriptString(options.request.message)} with title ${appleScriptString(
    options.request.title
  )}`;
  return {
    backend: 'macos-osascript',
    activationMode: 'none',
    command: 'osascript',
    args: ['-e', script],
    postedDetail: options.callbackUri ? 'posted-without-activation' : undefined
  };
}

export function buildWindowsToastInvocation(options: DesktopNotificationOptions): ShellInvocation {
  const script = buildWindowsToastScript(options.request.title, options.request.message, options.callbackUri);
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return {
    backend: 'windows-toast',
    activationMode: options.callbackUri ? 'protocol' : 'none',
    command: 'powershell.exe',
    args: ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded]
  };
}

async function postLinuxNotification(options: DesktopNotificationOptions): Promise<AttentionNotificationDeliveryResult> {
  const invocation = buildLinuxNotifySendInvocation(options);
  return launchShellInvocation(invocation, {
    fallback: async (failure) => {
      if (!options.callbackUri) {
        return undefined;
      }

      const detail = failure.detail;
      if (!/unknown option|unrecognized option/i.test(detail)) {
        return undefined;
      }

      return launchShellInvocation(
        {
          backend: 'linux-notify-send',
          activationMode: 'none',
          command: 'notify-send',
          args: ['--app-name=Dev Session Canvas', options.request.title, options.request.message],
          postedDetail: 'posted-without-activation'
        },
        { settlePostedOnSpawn: false }
      );
    },
    settlePostedOnSpawn: invocation.waitForAction === true,
    spawnSuccessDelayMs: 150
  });
}

async function postMacOSNotification(options: DesktopNotificationOptions): Promise<AttentionNotificationDeliveryResult> {
  const terminalNotifierInvocation = buildMacOSTerminalNotifierInvocation(options);
  if (terminalNotifierInvocation) {
    const terminalNotifierResult = await launchShellInvocation(terminalNotifierInvocation, {
      settlePostedOnSpawn: false
    });
    if (terminalNotifierResult.status === 'posted') {
      return terminalNotifierResult;
    }
  }

  const appleScriptInvocation = buildMacOSAppleScriptInvocation(options);
  if (terminalNotifierInvocation && options.callbackUri) {
    appleScriptInvocation.postedDetail = 'posted-without-activation';
  }

  return launchShellInvocation(appleScriptInvocation, {
    settlePostedOnSpawn: false
  });
}

async function postWindowsNotification(options: DesktopNotificationOptions): Promise<AttentionNotificationDeliveryResult> {
  return launchShellInvocation(buildWindowsToastInvocation(options), {
    settlePostedOnSpawn: false
  });
}

export function launchShellInvocation(
  invocation: ShellInvocation,
  options: {
    settlePostedOnSpawn: boolean;
    spawnSuccessDelayMs?: number;
    fallback?: (failure: {
      detail: string;
      code?: number;
      stderr: string;
      stdout: string;
    }) => Promise<AttentionNotificationDeliveryResult | undefined>;
  }
): Promise<AttentionNotificationDeliveryResult> {
  return new Promise((resolve) => {
    let settled = false;
    let stdout = '';
    let stderr = '';
    let spawnSuccessTimer: NodeJS.Timeout | undefined;

    const child = spawn(invocation.command, invocation.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      detached: false
    });

    const settle = (result: AttentionNotificationDeliveryResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(result);
    };

    child.on('error', async (error) => {
      if (spawnSuccessTimer) {
        clearTimeout(spawnSuccessTimer);
      }
      if (options.fallback) {
        const detail = error instanceof Error ? error.message : String(error);
        const fallbackResult = await options.fallback({
          detail,
          stderr,
          stdout
        });
        if (fallbackResult) {
          settle(fallbackResult);
          return;
        }
      }

      settle({
        status: 'error',
        backend: invocation.backend,
        activationMode: 'none',
        detail: error instanceof Error ? error.message : String(error)
      });
    });

    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk) => {
      stderr += chunk;
    });

    child.on('spawn', () => {
      if (options.settlePostedOnSpawn) {
        const delayMs = options.spawnSuccessDelayMs ?? 0;
        spawnSuccessTimer = setTimeout(() => {
          settle({
            status: 'posted',
            backend: invocation.backend,
            activationMode: invocation.activationMode,
            detail: invocation.postedDetail
          });
        }, delayMs);
      }
    });

    child.on('close', async (code) => {
      if (spawnSuccessTimer) {
        clearTimeout(spawnSuccessTimer);
      }

      if (invocation.onActionOutput && stdout) {
        try {
          await invocation.onActionOutput(stdout);
        } catch {
          // Keep notification posting best-effort; activation failures should not surface as command failures.
        }
      }

      if (code !== 0 && options.fallback && !settled) {
        const detail = stderr.trim() || `exit code ${code ?? 'unknown'}`;
        const fallbackResult = await options.fallback({
          detail,
          code: code ?? undefined,
          stderr,
          stdout
        });
        if (fallbackResult) {
          settle(fallbackResult);
          return;
        }
      }

      if (!settled) {
        settle({
          status: code === 0 ? 'posted' : 'error',
          backend: invocation.backend,
          activationMode: code === 0 ? invocation.activationMode : 'none',
          detail: code === 0 ? invocation.postedDetail : stderr.trim() || `exit code ${code ?? 'unknown'}`
        });
      }
    });

    if (invocation.stdin) {
      child.stdin?.end(invocation.stdin, 'utf8');
      return;
    }

    child.stdin?.end();
  });
}

function appleScriptString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function buildWindowsToastScript(title: string, message: string, callbackUri?: string): string {
  const xml = buildWindowsToastXml(title, message, callbackUri);
  return [
    '[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null',
    '[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] > $null',
    "$xml = New-Object Windows.Data.Xml.Dom.XmlDocument",
    `$xml.LoadXml(@"${xml}"@)`,
    '$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)',
    '$notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("Dev Session Canvas")',
    '$notifier.Show($toast)'
  ].join('\n');
}

function buildWindowsToastXml(title: string, message: string, callbackUri?: string): string {
  const activationAttributes = callbackUri
    ? ` activationType="protocol" launch="${escapeXml(callbackUri)}"`
    : '';
  return [
    `<toast${activationAttributes}>`,
    '  <visual>',
    '    <binding template="ToastGeneric">',
    `      <text>${escapeXml(title)}</text>`,
    `      <text>${escapeXml(message)}</text>`,
    '    </binding>',
    '  </visual>',
    '</toast>'
  ].join('\n');
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
