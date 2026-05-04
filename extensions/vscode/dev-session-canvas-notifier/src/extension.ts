import * as vscode from 'vscode';

import {
  ATTENTION_NOTIFICATION_PROTOCOL_VERSION,
  decodeAttentionNotificationFocusAction,
  encodeAttentionNotificationFocusAction,
  NOTIFIER_COMMAND_IDS,
  NOTIFIER_TEST_COMMAND_IDS,
  parseAttentionNotificationRequest,
  type AttentionNotificationActivationMode,
  type AttentionNotificationDebugRecord,
  type AttentionNotificationDeliveryResult,
  type AttentionNotificationFocusAction,
  type AttentionNotificationRequest
} from '../../../../packages/attention-protocol/src/index';
import { postDesktopNotification } from './platformNotification';
import { NotifierSidebarViewProvider } from './sidebarView';
import type { NotifierExtensionModeLabel } from './sidebarEnvironment';

const FOCUS_URI_PATH = '/focus';
const MAX_DEBUG_RECORDS = 20;
const OUTPUT_CHANNEL_NAME = 'Dev Session Canvas Notifier';
const MANUAL_COMMAND_IDS = {
  sendTestNotification: 'devSessionCanvasNotifier.sendTestNotification',
  openDiagnosticOutput: 'devSessionCanvasNotifier.openDiagnosticOutput',
  acknowledgeTestNotification: 'devSessionCanvasNotifier.__internal.acknowledgeTestNotification'
} as const;

interface NotificationDeliveryOutcome {
  request?: AttentionNotificationRequest;
  callbackUri?: string;
  result: AttentionNotificationDeliveryResult;
}

interface ManualNotificationAttempt {
  request: AttentionNotificationRequest;
  callbackUri?: string;
  result: AttentionNotificationDeliveryResult;
  requestedAt: string;
  activatedAt?: string;
}

export function activate(context: vscode.ExtensionContext): void {
  const postedNotifications: AttentionNotificationDebugRecord[] = [];
  const manualNotificationAttempts = new Map<string, ManualNotificationAttempt>();
  const outputChannel = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
  const sidebarViewProvider = new NotifierSidebarViewProvider({
    getModeLabel: () => getExtensionModeLabel(context.extensionMode),
    getLatestRecord: () => postedNotifications.at(-1),
    getLatestManualAttempt: () => getLatestManualNotificationAttempt(manualNotificationAttempts),
    sendTestNotification: async () => sendTestNotification(),
    openDiagnosticOutput: () => openDiagnosticOutput()
  });

  context.subscriptions.push(outputChannel, sidebarViewProvider);
  appendOutputLine(
    outputChannel,
    `activated platform=${process.platform} mode=${getExtensionModeLabel(context.extensionMode)}`
  );

  const executeFocusAction = async (action: AttentionNotificationFocusAction | undefined): Promise<void> => {
    if (!action) {
      return;
    }

    appendOutputLine(
      outputChannel,
      `executing focus action command=${action.command} args=${JSON.stringify(action.arguments ?? [])}`
    );
    await vscode.commands.executeCommand(action.command, ...(action.arguments ?? []));
  };

  const handleFocusUri = async (uri: vscode.Uri): Promise<void> => {
    if (uri.path !== FOCUS_URI_PATH) {
      appendOutputLine(outputChannel, `ignored uri path=${uri.path}`);
      return;
    }

    const query = new URLSearchParams(uri.query);
    const action = decodeAttentionNotificationFocusAction(query.get('payload') ?? undefined);
    if (!action) {
      appendOutputLine(outputChannel, 'ignored focus callback with invalid payload');
      return;
    }

    appendOutputLine(outputChannel, `received focus callback uri=${uri.toString(true)}`);
    await executeFocusAction(action);
  };

  const postNotificationRequest = async (
    rawRequest: unknown,
    source: 'main-extension' | 'manual-test'
  ): Promise<NotificationDeliveryOutcome> => {
    const request = parseAttentionNotificationRequest(rawRequest);
    if (!request) {
      const result = {
        status: 'error',
        backend: 'unsupported',
        activationMode: 'none',
        detail: 'invalid-attention-notification-request'
      } satisfies AttentionNotificationDeliveryResult;
      appendOutputLine(outputChannel, `source=${source} invalid attention notification request`);
      return { result };
    }

    const callbackUri = request.focusAction
      ? await buildFocusCallbackUri(context, request.focusAction)
      : undefined;
    const result =
      context.extensionMode === vscode.ExtensionMode.Test
        ? ({
            status: 'posted',
            backend: 'test',
            activationMode: request.focusAction ? 'test-replay' : 'none'
          } satisfies AttentionNotificationDeliveryResult)
        : await postDesktopNotification({
            request,
            callbackUri,
            onDidActivate: () => executeFocusAction(request.focusAction)
          });

    recordDebugNotification(postedNotifications, {
      request,
      callbackUri,
      result
    });
    appendOutputLine(
      outputChannel,
      [
        `source=${source}`,
        `status=${result.status}`,
        `backend=${result.backend}`,
        `activation=${result.activationMode}`,
        `dedupeKey=${request.dedupeKey}`,
        result.detail ? `detail=${result.detail}` : undefined,
        callbackUri ? `callback=${callbackUri}` : undefined
      ]
        .filter(Boolean)
        .join(' ')
    );
    void sidebarViewProvider.refresh();
    return { request, callbackUri, result };
  };

  const acknowledgeManualNotification = async (requestId?: unknown): Promise<void> => {
    if (typeof requestId !== 'string' || requestId.trim().length === 0) {
      appendOutputLine(outputChannel, 'manual notification callback missing request id');
      return;
    }

    const normalizedRequestId = requestId.trim();
    const currentAttempt = manualNotificationAttempts.get(normalizedRequestId);
    const activatedAt = new Date().toISOString();
    if (currentAttempt) {
      currentAttempt.activatedAt = activatedAt;
    }

    appendOutputLine(outputChannel, `manual notification activated requestId=${normalizedRequestId}`);
    void sidebarViewProvider.refresh();
    void vscode.window.showInformationMessage('Dev Session Canvas Notifier 已收到测试通知点击回调。');
  };

  const sendTestNotification = async (): Promise<void> => {
    const requestId = createManualNotificationRequestId();
    const request = buildManualNotificationRequest(requestId);
    const outcome = await postNotificationRequest(request, 'manual-test');
    manualNotificationAttempts.set(requestId, {
      request,
      callbackUri: outcome.callbackUri,
      result: outcome.result,
      requestedAt: new Date().toISOString()
    });

    const actions = ['打开输出'];
    const message = buildManualNotificationMessage(outcome.result);
    const selectedAction =
      outcome.result.status === 'posted'
        ? await vscode.window.showInformationMessage(message, ...actions)
        : await vscode.window.showWarningMessage(message, ...actions);

    if (selectedAction === '打开输出') {
      outputChannel.show(true);
      logPlatformSnapshot(outputChannel, postedNotifications.at(-1));
    }
  };

  const openDiagnosticOutput = (): void => {
    outputChannel.show(true);
    logPlatformSnapshot(outputChannel, postedNotifications.at(-1));
  };

  context.subscriptions.push(
    vscode.window.registerUriHandler({
      handleUri: (uri) => {
        void handleFocusUri(uri);
      }
    }),
    vscode.window.registerWebviewViewProvider(NotifierSidebarViewProvider.viewType, sidebarViewProvider),
    vscode.commands.registerCommand(NOTIFIER_COMMAND_IDS.postSystemNotification, async (rawRequest?: unknown) => {
      const outcome = await postNotificationRequest(rawRequest, 'main-extension');
      return outcome.result;
    }),
    vscode.commands.registerCommand(MANUAL_COMMAND_IDS.sendTestNotification, () => sendTestNotification()),
    vscode.commands.registerCommand(MANUAL_COMMAND_IDS.openDiagnosticOutput, () => openDiagnosticOutput()),
    vscode.commands.registerCommand(
      MANUAL_COMMAND_IDS.acknowledgeTestNotification,
      async (requestId?: unknown) => acknowledgeManualNotification(requestId)
    )
  );

  if (context.extensionMode === vscode.ExtensionMode.Test) {
    context.subscriptions.push(
      vscode.commands.registerCommand(NOTIFIER_TEST_COMMAND_IDS.getPostedNotifications, () =>
        cloneDebugRecords(postedNotifications)
      ),
      vscode.commands.registerCommand(NOTIFIER_TEST_COMMAND_IDS.clearPostedNotifications, () => {
        postedNotifications.length = 0;
      }),
      vscode.commands.registerCommand(NOTIFIER_TEST_COMMAND_IDS.replayLastFocusAction, async () => {
        const lastRecord = postedNotifications.at(-1);
        if (!lastRecord?.callbackUri) {
          return false;
        }

        await handleFocusUri(vscode.Uri.parse(lastRecord.callbackUri));
        return true;
      })
    );
  }
}

export function deactivate(): void {
  // No-op.
}

async function buildFocusCallbackUri(
  context: vscode.ExtensionContext,
  focusAction: AttentionNotificationFocusAction
): Promise<string> {
  const payload = encodeAttentionNotificationFocusAction(focusAction);
  const localUri = vscode.Uri.parse(`${vscode.env.uriScheme}://${context.extension.id}${FOCUS_URI_PATH}`).with({
    query: `payload=${encodeURIComponent(payload)}`
  });
  const externalUri = await vscode.env.asExternalUri(localUri);
  return externalUri.toString(true);
}

function recordDebugNotification(
  records: AttentionNotificationDebugRecord[],
  record: AttentionNotificationDebugRecord
): void {
  records.push({
    request: cloneRequest(record.request),
    callbackUri: record.callbackUri,
    result: { ...record.result }
  });
  if (records.length > MAX_DEBUG_RECORDS) {
    records.splice(0, records.length - MAX_DEBUG_RECORDS);
  }
}

function cloneDebugRecords(records: AttentionNotificationDebugRecord[]): AttentionNotificationDebugRecord[] {
  return records.map((record) => ({
    request: cloneRequest(record.request),
    callbackUri: record.callbackUri,
    result: { ...record.result }
  }));
}

function cloneRequest(request: AttentionNotificationRequest): AttentionNotificationRequest {
  return {
    ...request,
    focusAction: request.focusAction
      ? {
          command: request.focusAction.command,
          arguments: request.focusAction.arguments?.slice()
        }
      : undefined
  };
}

function buildManualNotificationRequest(requestId: string): AttentionNotificationRequest {
  const createdAt = new Date();
  const createdAtLabel = formatLocalClock(createdAt);
  return {
    version: ATTENTION_NOTIFICATION_PROTOCOL_VERSION,
    kind: 'execution-attention',
    title: 'Dev Session Canvas Notifier',
    message: `测试桌面通知 ${createdAtLabel}；若当前后端支持点击回调，应回到 VS Code 并写入诊断输出。`,
    dedupeKey: `manual-test:${requestId}`,
    focusAction: {
      command: MANUAL_COMMAND_IDS.acknowledgeTestNotification,
      arguments: [requestId]
    }
  };
}

function createManualNotificationRequestId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildManualNotificationMessage(result: AttentionNotificationDeliveryResult): string {
  if (result.status !== 'posted') {
    return `测试桌面通知发送失败（backend=${result.backend}）。${result.detail ?? '请打开诊断输出查看原因。'}`;
  }

  if (result.activationMode === 'none') {
    return `测试桌面通知已发出（backend=${result.backend}），但当前后端只保证通知出现，不支持点击回到 VS Code。`;
  }

  return `测试桌面通知已发出（backend=${result.backend}，activation=${describeActivationMode(
    result.activationMode
  )}）。请点击系统通知完成人工验收。`;
}

function logPlatformSnapshot(
  outputChannel: vscode.OutputChannel,
  lastRecord: AttentionNotificationDebugRecord | undefined
): void {
  appendOutputLine(outputChannel, '--- platform snapshot ---');
  appendOutputLine(outputChannel, `platform=${process.platform}`);
  for (const line of getPlatformGuidanceLines(process.platform)) {
    appendOutputLine(outputChannel, line);
  }
  if (!lastRecord) {
    appendOutputLine(outputChannel, 'lastDelivery=none');
    return;
  }

  appendOutputLine(
    outputChannel,
    [
      'lastDelivery',
      `status=${lastRecord.result.status}`,
      `backend=${lastRecord.result.backend}`,
      `activation=${lastRecord.result.activationMode}`,
      lastRecord.result.detail ? `detail=${lastRecord.result.detail}` : undefined,
      lastRecord.callbackUri ? `callback=${lastRecord.callbackUri}` : undefined
    ]
      .filter(Boolean)
      .join(' ')
  );
}

function getPlatformGuidanceLines(platform: NodeJS.Platform): string[] {
  if (platform === 'linux') {
    return [
      'linux: primary backend is notify-send.',
      'linux: activation=direct-action only when the desktop environment supports notify-send --action --wait.',
      'linux: activation=none is an accepted degraded outcome and means you only verify that the desktop notification appeared.'
    ];
  }

  if (platform === 'darwin') {
    return [
      'darwin: primary backend is terminal-notifier with protocol activation.',
      'darwin: fallback backend is osascript display notification.',
      'darwin: activation=none means terminal-notifier was unavailable or unsupported, so manual acceptance only verifies notification appearance.'
    ];
  }

  if (platform === 'win32') {
    return [
      'win32: backend is PowerShell toast with protocol activation.',
      'win32: if Focus Assist or OS notification permissions suppress the popup, check Action Center before concluding that delivery failed.',
      'win32: activation should return through the VS Code URI handler when the toast is clickable.'
    ];
  }

  return ['unsupported: the current platform is not mapped to a desktop notification backend.'];
}

function appendOutputLine(outputChannel: vscode.OutputChannel, message: string): void {
  outputChannel.appendLine(`[${new Date().toISOString()}] ${message}`);
}

function formatLocalClock(value: Date): string {
  const hours = String(value.getHours()).padStart(2, '0');
  const minutes = String(value.getMinutes()).padStart(2, '0');
  const seconds = String(value.getSeconds()).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

function describeActivationMode(mode: AttentionNotificationActivationMode): string {
  if (mode === 'direct-action') {
    return 'direct-action';
  }

  if (mode === 'protocol') {
    return 'protocol';
  }

  if (mode === 'test-replay') {
    return 'test-replay';
  }

  return 'none';
}

function getExtensionModeLabel(mode: vscode.ExtensionMode): NotifierExtensionModeLabel {
  if (mode === vscode.ExtensionMode.Development) {
    return 'development';
  }

  if (mode === vscode.ExtensionMode.Test) {
    return 'test';
  }

  return 'production';
}

function getLatestManualNotificationAttempt(
  attempts: Map<string, ManualNotificationAttempt>
): { requestedAt: string; activatedAt?: string } | undefined {
  const latestAttempt = Array.from(attempts.values()).at(-1);
  if (!latestAttempt) {
    return undefined;
  }

  return {
    requestedAt: latestAttempt.requestedAt,
    activatedAt: latestAttempt.activatedAt
  };
}
