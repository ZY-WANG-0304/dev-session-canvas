import * as vscode from 'vscode';
import { randomBytes } from 'crypto';

import {
  ATTENTION_NOTIFICATION_PROTOCOL_VERSION,
  NOTIFIER_COMMAND_IDS,
  NOTIFIER_TEST_COMMAND_IDS,
  isAttentionNotificationFocusAction,
  parseAttentionNotificationRequest,
  type AttentionNotificationDebugRecord,
  type AttentionNotificationDeliveryResult,
  type AttentionNotificationFocusAction,
  type AttentionNotificationRequest
} from '../../../../packages/attention-protocol/src/index';
import { COMMAND_IDS } from '../../dev-session-canvas/src/common/extensionIdentity';
import { isTestHarnessMode } from '../../dev-session-canvas/src/common/testHarness';
import { buildManualNotificationMessage } from './manualNotificationCopy.ts';
import { notifierHtmlLang, resolveNotifierLocale } from './notifierLocalization.ts';
import { postDesktopNotification } from './platformNotification.ts';
import {
  NotifierSidebarViewProvider,
  NOTIFIER_SIDEBAR_VIEW_IDS,
  type NotifierSidebarSection
} from './sidebarView.ts';
import {
  probeNotifierEnvironmentSnapshot,
  type NotifierExtensionModeLabel
} from './sidebarEnvironment.ts';

const FOCUS_URI_PATH = '/focus';
const MAX_DEBUG_RECORDS = 20;
const OUTPUT_CHANNEL_NAME = 'Dev Session Canvas Notifier';
const MAX_PENDING_FOCUS_ACTIONS = 64;
const PENDING_FOCUS_ACTION_TTL_MS = 1000 * 60 * 60 * 24;
const PENDING_FOCUS_ACTIONS_STORAGE_KEY = 'devSessionCanvasNotifier.pendingFocusActions';
const CONFIGURATION_KEYS = {
  playSound: 'devSessionCanvasNotifier.notifications.playSound'
} as const;
const MANUAL_COMMAND_IDS = {
  sendTestNotification: 'devSessionCanvasNotifier.sendTestNotification',
  openDiagnosticOutput: 'devSessionCanvasNotifier.openDiagnosticOutput',
  openSettings: 'devSessionCanvasNotifier.openSettings',
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

interface StoredPendingFocusAction {
  action: AttentionNotificationFocusAction;
  createdAt: string;
}

interface WorkbenchPromptRecord {
  kind: 'information' | 'warning';
  message: string;
  actions: string[];
  selectedAction?: string;
}

export function activate(context: vscode.ExtensionContext): void {
  const postedNotifications: AttentionNotificationDebugRecord[] = [];
  const manualNotificationAttempts = new Map<string, ManualNotificationAttempt>();
  let lastWorkbenchPrompt: WorkbenchPromptRecord | undefined;
  const pendingFocusActions = restorePendingFocusActions(context.globalState);
  const outputChannel = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
  const sidebarViewProvider = new NotifierSidebarViewProvider({
    getModeLabel: () => getExtensionModeLabel(context.extensionMode),
    getPlaySoundEnabled: () => readPlaySoundEnabled(),
    getLocale: () => resolveNotifierLocale(vscode.env.language),
    localize: (message, args) => localizeNotifierMessage(message, args),
    getLatestRecord: () => postedNotifications.at(-1),
    getLatestManualAttempt: () => getLatestManualNotificationAttempt(manualNotificationAttempts),
    sendTestNotification: async () => sendTestNotification(),
    openDiagnosticOutput: () => openDiagnosticOutput()
  });

  context.subscriptions.push(outputChannel, sidebarViewProvider);
  appendOutputLine(
    outputChannel,
    `activated platform=${process.platform} mode=${getExtensionModeLabel(context.extensionMode)} playSound=${describeBooleanFlag(
      readPlaySoundEnabled()
    )}`
  );
  if (prunePendingFocusActions(pendingFocusActions)) {
    void persistPendingFocusActions(context.globalState, pendingFocusActions);
  }

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

  const registerPendingFocusAction = async (action: AttentionNotificationFocusAction): Promise<string> => {
    prunePendingFocusActions(pendingFocusActions);
    const token = createFocusActionToken();
    pendingFocusActions.set(token, {
      action: {
        command: action.command,
        arguments: action.arguments?.slice()
      },
      createdAt: new Date().toISOString()
    });
    prunePendingFocusActions(pendingFocusActions);
    await persistPendingFocusActions(context.globalState, pendingFocusActions);
    return token;
  };

  const consumePendingFocusAction = async (
    token: string
  ): Promise<AttentionNotificationFocusAction | undefined> => {
    const didPrune = prunePendingFocusActions(pendingFocusActions);
    const currentAction = pendingFocusActions.get(token);
    if (!currentAction) {
      if (didPrune) {
        await persistPendingFocusActions(context.globalState, pendingFocusActions);
      }
      return undefined;
    }

    pendingFocusActions.delete(token);
    await persistPendingFocusActions(context.globalState, pendingFocusActions);
    return cloneFocusAction(currentAction.action);
  };

  const handleFocusUri = async (uri: vscode.Uri): Promise<boolean> => {
    if (uri.path !== FOCUS_URI_PATH) {
      appendOutputLine(outputChannel, `ignored uri path=${uri.path}`);
      return false;
    }

    const query = new URLSearchParams(uri.query);
    const token = query.get('token')?.trim();
    if (!token) {
      appendOutputLine(outputChannel, 'ignored focus callback without token');
      return false;
    }

    const action = await consumePendingFocusAction(token);
    if (!action) {
      appendOutputLine(outputChannel, `ignored focus callback with unknown or expired token=${token}`);
      return false;
    }

    appendOutputLine(outputChannel, `received focus callback uri=${uri.toString(true)}`);
    await executeFocusAction(action);
    return true;
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

    const focusAction = normalizeSupportedFocusAction(request.focusAction, source);
    if (request.focusAction && !focusAction) {
      const result = {
        status: 'error',
        backend: 'unsupported',
        activationMode: 'none',
        detail: 'unsupported-focus-action'
      } satisfies AttentionNotificationDeliveryResult;
      appendOutputLine(
        outputChannel,
        `source=${source} rejected unsupported focus action command=${request.focusAction.command}`
      );
      return { result };
    }

    const normalizedRequest = focusAction
      ? {
          ...request,
          focusAction
        }
      : {
          ...request,
          focusAction: undefined
        };
    const callbackUri = focusAction
      ? await buildFocusCallbackUri(context, registerPendingFocusAction, focusAction)
      : undefined;
    const playSound = readPlaySoundEnabled();
    const result =
      isTestHarnessMode(context.extensionMode)
        ? ({
            status: 'posted',
            backend: 'test',
            activationMode: focusAction ? 'test-replay' : 'none'
          } satisfies AttentionNotificationDeliveryResult)
        : await postDesktopNotification({
            request: normalizedRequest,
            callbackUri,
            onDidActivate: () => executeFocusAction(focusAction),
            playSound,
            actionLabel: vscode.l10n.t('View Node')
          });

    recordDebugNotification(postedNotifications, {
      request: normalizedRequest,
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
        `playSound=${describeBooleanFlag(playSound)}`,
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
    lastWorkbenchPrompt = {
      kind: 'information',
      message: vscode.l10n.t('Dev Session Canvas Notifier received the test notification click callback.'),
      actions: []
    };
    void vscode.window.showInformationMessage(
      lastWorkbenchPrompt.message
    );
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

    const actions = [vscode.l10n.t('Open Output')];
    const message = buildManualNotificationMessage(outcome.result, localizeNotifierMessage);
    const promptKind = outcome.result.status === 'posted' ? 'information' : 'warning';
    const selectedAction = await showManualNotificationPrompt(promptKind, message, actions);

    if (selectedAction === actions[0]) {
      outputChannel.show(true);
      logPlatformSnapshot(outputChannel, postedNotifications.at(-1), readPlaySoundEnabled());
    }
  };

  const showManualNotificationPrompt = async (
    kind: WorkbenchPromptRecord['kind'],
    message: string,
    actions: string[]
  ): Promise<string | undefined> => {
    lastWorkbenchPrompt = {
      kind,
      message,
      actions: actions.slice()
    };

    const promptPromise =
      kind === 'information'
        ? vscode.window.showInformationMessage(message, ...actions)
        : vscode.window.showWarningMessage(message, ...actions);

    if (isTestHarnessMode(context.extensionMode)) {
      void promptPromise.then(
        (selectedAction) => {
          if (lastWorkbenchPrompt?.message === message) {
            lastWorkbenchPrompt = {
              kind,
              message,
              actions: actions.slice(),
              selectedAction
            };
          }
        },
        () => {
          // Test smoke must not hang on VS Code notification lifetime.
        }
      );
      return undefined;
    }

    const selectedAction = await promptPromise;
    lastWorkbenchPrompt = {
      kind,
      message,
      actions: actions.slice(),
      selectedAction
    };
    return selectedAction;
  };

  const openDiagnosticOutput = (): void => {
    outputChannel.show(true);
    logPlatformSnapshot(outputChannel, postedNotifications.at(-1), readPlaySoundEnabled());
  };

  const openSettings = async (): Promise<void> => {
    await vscode.commands.executeCommand(
      'workbench.action.openSettings',
      '@ext:devsessioncanvas.dev-session-canvas-notifier devSessionCanvasNotifier'
    );
  };

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration(CONFIGURATION_KEYS.playSound)) {
        return;
      }

      appendOutputLine(outputChannel, `config playSound=${describeBooleanFlag(readPlaySoundEnabled())}`);
      void sidebarViewProvider.refresh();
    }),
    vscode.window.registerUriHandler({
      handleUri: (uri) => {
        void handleFocusUri(uri);
      }
    }),
    ...Object.values(NOTIFIER_SIDEBAR_VIEW_IDS).map((viewId) =>
      vscode.window.registerWebviewViewProvider(viewId, sidebarViewProvider)
    ),
    vscode.commands.registerCommand(NOTIFIER_COMMAND_IDS.postSystemNotification, async (rawRequest?: unknown) => {
      const outcome = await postNotificationRequest(rawRequest, 'main-extension');
      return outcome.result;
    }),
    vscode.commands.registerCommand(MANUAL_COMMAND_IDS.sendTestNotification, () => sendTestNotification()),
    vscode.commands.registerCommand(MANUAL_COMMAND_IDS.openDiagnosticOutput, () => openDiagnosticOutput()),
    vscode.commands.registerCommand(MANUAL_COMMAND_IDS.openSettings, () => openSettings()),
    vscode.commands.registerCommand(
      MANUAL_COMMAND_IDS.acknowledgeTestNotification,
      async (requestId?: unknown) => acknowledgeManualNotification(requestId)
    )
  );

  if (isTestHarnessMode(context.extensionMode)) {
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

        return handleFocusUri(vscode.Uri.parse(lastRecord.callbackUri));
      }),
      vscode.commands.registerCommand(NOTIFIER_TEST_COMMAND_IDS.getLocalizationSnapshot, async () =>
        buildNotifierLocalizationSnapshot(
          context,
          sidebarViewProvider,
          getExtensionModeLabel(context.extensionMode),
          readPlaySoundEnabled(),
          localizeNotifierMessage
        )
      ),
      vscode.commands.registerCommand(NOTIFIER_TEST_COMMAND_IDS.getLastWorkbenchPrompt, () =>
        lastWorkbenchPrompt
          ? {
              ...lastWorkbenchPrompt,
              actions: lastWorkbenchPrompt.actions.slice()
            }
          : undefined
      )
    );
  }
}

async function buildNotifierLocalizationSnapshot(
  context: vscode.ExtensionContext,
  sidebarViewProvider: NotifierSidebarViewProvider,
  modeLabel: NotifierExtensionModeLabel,
  playSoundEnabled: boolean,
  localize: typeof localizeNotifierMessage
): Promise<Record<string, unknown>> {
  return {
    language: vscode.env.language,
    manifest: buildNotifierManifestLocalizationSnapshot(context.extension.packageJSON),
    sidebar: await buildNotifierSidebarLocalizationSnapshot(modeLabel, playSoundEnabled, localize),
    renderedSidebar: buildRenderedSidebarSnapshot(sidebarViewProvider),
    manualNotification: buildManualNotificationMessage(
      {
        status: 'posted',
        backend: 'test',
        activationMode: 'test-replay'
      },
      localize
    ),
    actionLabel: vscode.l10n.t('View Node'),
    openOutputAction: vscode.l10n.t('Open Output'),
    callbackMessage: vscode.l10n.t('Dev Session Canvas Notifier received the test notification click callback.')
  };
}

async function buildNotifierSidebarLocalizationSnapshot(
  modeLabel: NotifierExtensionModeLabel,
  playSoundEnabled: boolean,
  localize: typeof localizeNotifierMessage
): Promise<Record<string, string>> {
  const snapshot = await probeNotifierEnvironmentSnapshot(
    process.platform,
    modeLabel,
    playSoundEnabled,
    localize
  );
  return {
    htmlLang: notifierHtmlLang(resolveNotifierLocale(vscode.env.language)),
    currentRouteLabel: snapshot.currentRouteLabel,
    activationLabel: snapshot.activationLabel,
    soundLabel: snapshot.soundLabel,
    note: snapshot.notes[0] ?? '',
    platformGuideStatusLabel: snapshot.platformGuides.find((guide) => guide.platformLabel === snapshot.platformLabel)?.statusLabel ?? '',
    agentGuideDetail: snapshot.agentConfigurationGuides[0]?.detail ?? ''
  };
}

function buildRenderedSidebarSnapshot(
  sidebarViewProvider: NotifierSidebarViewProvider
): Record<string, string | string[] | undefined> {
  const sections: Partial<Record<NotifierSidebarSection, string>> = {};
  const visibleSections = sidebarViewProvider.getVisibleSections();
  for (const section of visibleSections) {
    sections[section] = sidebarViewProvider.getRenderedSectionHtml(section);
  }

  return {
    visibleSections,
    statusHtml: sections.status,
    notesHtml: sections.notes,
    codexHtml: sections.codex
  };
}

function buildNotifierManifestLocalizationSnapshot(packageJSON: unknown): Record<string, string | undefined> {
  if (!isRecord(packageJSON)) {
    return {};
  }

  const contributes = isRecord(packageJSON.contributes) ? packageJSON.contributes : {};
  const commands = Array.isArray(contributes.commands) ? contributes.commands : [];
  const views = isRecord(contributes.views) ? contributes.views : {};
  const notifierViews = Array.isArray(views.devSessionCanvasNotifier) ? views.devSessionCanvasNotifier : [];
  const configuration = isRecord(contributes.configuration) ? contributes.configuration : {};
  const properties = isRecord(configuration.properties) ? configuration.properties : {};
  const playSoundConfiguration = isRecord(properties[CONFIGURATION_KEYS.playSound])
    ? properties[CONFIGURATION_KEYS.playSound]
    : {};

  return {
    displayName: typeof packageJSON.displayName === 'string' ? packageJSON.displayName : undefined,
    description: typeof packageJSON.description === 'string' ? packageJSON.description : undefined,
    statusViewName: getManifestContributionString(
      notifierViews.find((view) => isRecord(view) && view.id === NOTIFIER_SIDEBAR_VIEW_IDS.status),
      'name'
    ),
    notesViewName: getManifestContributionString(
      notifierViews.find((view) => isRecord(view) && view.id === NOTIFIER_SIDEBAR_VIEW_IDS.notes),
      'name'
    ),
    sendTestCommandTitle: getManifestContributionString(
      commands.find((command) => isRecord(command) && command.command === MANUAL_COMMAND_IDS.sendTestNotification),
      'title'
    ),
    diagnosticCommandTitle: getManifestContributionString(
      commands.find((command) => isRecord(command) && command.command === MANUAL_COMMAND_IDS.openDiagnosticOutput),
      'title'
    ),
    configurationTitle: typeof configuration.title === 'string' ? configuration.title : undefined,
    playSoundDescription:
      typeof playSoundConfiguration.markdownDescription === 'string'
        ? playSoundConfiguration.markdownDescription
        : undefined
  };
}

function getManifestContributionString(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const candidate = value[key];
  if (typeof candidate === 'string') {
    return candidate;
  }

  if (isRecord(candidate) && typeof candidate.value === 'string') {
    return candidate.value;
  }

  return undefined;
}

export function deactivate(): void {
  // No-op.
}

function localizeNotifierMessage(message: string, args?: Record<string, string | number | boolean>): string {
  return args ? vscode.l10n.t(message, args) : vscode.l10n.t(message);
}

async function buildFocusCallbackUri(
  context: vscode.ExtensionContext,
  registerPendingFocusAction: (action: AttentionNotificationFocusAction) => Promise<string>,
  focusAction: AttentionNotificationFocusAction
): Promise<string> {
  const token = await registerPendingFocusAction(focusAction);
  const localUri = vscode.Uri.parse(`${vscode.env.uriScheme}://${context.extension.id}${FOCUS_URI_PATH}`).with({
    query: `token=${encodeURIComponent(token)}`
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
    focusAction: cloneFocusAction(request.focusAction)
  };
}

function buildManualNotificationRequest(requestId: string): AttentionNotificationRequest {
  const createdAt = new Date();
  const createdAtLabel = formatLocalClock(createdAt);
  return {
    version: ATTENTION_NOTIFICATION_PROTOCOL_VERSION,
    kind: 'execution-attention',
    title: 'DSCanvas · Notifier',
    message: vscode.l10n.t(
      'Test desktop notification {time}. If the current backend supports click callbacks, it should return to VS Code and write diagnostic output.',
      { time: createdAtLabel }
    ),
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

function createFocusActionToken(): string {
  return randomBytes(16).toString('hex');
}

function cloneFocusAction(
  action: AttentionNotificationFocusAction | undefined
): AttentionNotificationFocusAction | undefined {
  return action
    ? {
        command: action.command,
        arguments: action.arguments?.slice()
      }
    : undefined;
}

function normalizeSupportedFocusAction(
  action: AttentionNotificationFocusAction | undefined,
  source: 'main-extension' | 'manual-test'
): AttentionNotificationFocusAction | undefined {
  if (!action) {
    return undefined;
  }

  const normalizedArgument = normalizeSingleStringArgument(action.arguments);
  if (!normalizedArgument) {
    return undefined;
  }

  if (source === 'main-extension' && action.command === COMMAND_IDS.centerAttentionNode) {
    return {
      command: COMMAND_IDS.centerAttentionNode,
      arguments: [normalizedArgument]
    };
  }

  if (source === 'manual-test' && action.command === MANUAL_COMMAND_IDS.acknowledgeTestNotification) {
    return {
      command: MANUAL_COMMAND_IDS.acknowledgeTestNotification,
      arguments: [normalizedArgument]
    };
  }

  return undefined;
}

function normalizeSingleStringArgument(argumentsList: string[] | undefined): string | undefined {
  if (!Array.isArray(argumentsList) || argumentsList.length !== 1) {
    return undefined;
  }

  const [value] = argumentsList;
  if (typeof value !== 'string' || value.trim().length === 0) {
    return undefined;
  }

  return value.trim();
}

function restorePendingFocusActions(memento: vscode.Memento): Map<string, StoredPendingFocusAction> {
  const restored = new Map<string, StoredPendingFocusAction>();
  const rawValue = memento.get<Record<string, unknown>>(PENDING_FOCUS_ACTIONS_STORAGE_KEY);
  if (!rawValue || typeof rawValue !== 'object') {
    return restored;
  }

  for (const [token, candidate] of Object.entries(rawValue)) {
    if (typeof token !== 'string' || token.trim().length === 0 || !isRecord(candidate)) {
      continue;
    }

    if (!isAttentionNotificationFocusAction(candidate.action) || typeof candidate.createdAt !== 'string') {
      continue;
    }

    restored.set(token, {
      action: {
        command: candidate.action.command.trim(),
        arguments: candidate.action.arguments?.slice()
      },
      createdAt: candidate.createdAt
    });
  }

  prunePendingFocusActions(restored);
  return restored;
}

async function persistPendingFocusActions(
  memento: vscode.Memento,
  pendingFocusActions: Map<string, StoredPendingFocusAction>
): Promise<void> {
  const serialized: Record<string, StoredPendingFocusAction> = {};
  for (const [token, storedAction] of pendingFocusActions.entries()) {
    serialized[token] = {
      action: cloneFocusAction(storedAction.action)!,
      createdAt: storedAction.createdAt
    };
  }

  await memento.update(PENDING_FOCUS_ACTIONS_STORAGE_KEY, serialized);
}

function prunePendingFocusActions(pendingFocusActions: Map<string, StoredPendingFocusAction>): boolean {
  let changed = false;
  const cutoff = Date.now() - PENDING_FOCUS_ACTION_TTL_MS;
  for (const [token, storedAction] of pendingFocusActions.entries()) {
    const createdAtMs = Date.parse(storedAction.createdAt);
    if (!Number.isFinite(createdAtMs) || createdAtMs < cutoff) {
      pendingFocusActions.delete(token);
      changed = true;
    }
  }

  if (pendingFocusActions.size <= MAX_PENDING_FOCUS_ACTIONS) {
    return changed;
  }

  const sortedEntries = [...pendingFocusActions.entries()].sort((left, right) => {
    return Date.parse(right[1].createdAt) - Date.parse(left[1].createdAt);
  });
  pendingFocusActions.clear();
  for (const [index, entry] of sortedEntries.entries()) {
    if (index >= MAX_PENDING_FOCUS_ACTIONS) {
      changed = true;
      continue;
    }

    pendingFocusActions.set(entry[0], entry[1]);
  }

  return changed;
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object';
}

function logPlatformSnapshot(
  outputChannel: vscode.OutputChannel,
  lastRecord: AttentionNotificationDebugRecord | undefined,
  playSoundEnabled: boolean
): void {
  appendOutputLine(outputChannel, '--- platform snapshot ---');
  appendOutputLine(outputChannel, `platform=${process.platform}`);
  appendOutputLine(outputChannel, `playSound=${describeBooleanFlag(playSoundEnabled)}`);
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

function getExtensionModeLabel(mode: vscode.ExtensionMode): NotifierExtensionModeLabel {
  if (isTestHarnessMode(mode)) {
    return 'test';
  }

  if (mode === vscode.ExtensionMode.Development) {
    return 'development';
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

function readPlaySoundEnabled(): boolean {
  return vscode.workspace.getConfiguration().get<boolean>(CONFIGURATION_KEYS.playSound, true) !== false;
}

function describeBooleanFlag(value: boolean): string {
  return value ? 'on' : 'off';
}
