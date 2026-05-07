const assert = require('assert');
const path = require('path');
const vscode = require('vscode');

const MAIN_EXTENSION_ID = 'devsessioncanvas.dev-session-canvas';
const MAIN_COMMAND_IDS = {
  openCanvasInEditor: 'devSessionCanvas.openCanvasInEditor',
  testGetDebugState: 'devSessionCanvas.__test.getDebugState',
  testGetHostMessages: 'devSessionCanvas.__test.getHostMessages',
  testClearHostMessages: 'devSessionCanvas.__test.clearHostMessages',
  testGetDiagnosticEvents: 'devSessionCanvas.__test.getDiagnosticEvents',
  testClearDiagnosticEvents: 'devSessionCanvas.__test.clearDiagnosticEvents',
  testWaitForCanvasReady: 'devSessionCanvas.__test.waitForCanvasReady',
  testDispatchWebviewMessage: 'devSessionCanvas.__test.dispatchWebviewMessage',
  testStartExecutionSession: 'devSessionCanvas.__test.startExecutionSession',
  testCreateNode: 'devSessionCanvas.__test.createNode',
  testResetState: 'devSessionCanvas.__test.resetState'
};
const NOTIFIER_COMMAND_IDS = {
  postSystemNotification: 'devSessionCanvasNotifier.postSystemNotification'
};
const NOTIFIER_TEST_COMMAND_IDS = {
  getPostedNotifications: 'devSessionCanvasNotifier.__test.getPostedNotifications',
  clearPostedNotifications: 'devSessionCanvasNotifier.__test.clearPostedNotifications',
  replayLastFocusAction: 'devSessionCanvasNotifier.__test.replayLastFocusAction'
};

module.exports = {
  run
};

async function run() {
  const mainExtension = await waitForVisibleExtension(MAIN_EXTENSION_ID);

  await mainExtension.activate();

  await waitForCommand(MAIN_COMMAND_IDS.testResetState);
  await waitForCommand(NOTIFIER_TEST_COMMAND_IDS.clearPostedNotifications);
  await activateNotifierSmokeHarness();

  await vscode.commands.executeCommand(MAIN_COMMAND_IDS.testResetState);
  await clearDiagnosticEvents();
  await clearHostMessages();
  await clearNotifierPostedNotifications();
  await verifyUnsupportedFocusActionIsRejected();

  const configuration = vscode.workspace.getConfiguration();
  const originalBridgeMode = normalizeAttentionNotificationBridgeMode(
    configuration.get('devSessionCanvas.notifications.attentionSignalBridge', 'system')
  );

  let agentNodeId;
  try {
    await ensureAttentionNotificationBridgeMode('system');

    await vscode.commands.executeCommand(MAIN_COMMAND_IDS.openCanvasInEditor);
    await vscode.commands.executeCommand(MAIN_COMMAND_IDS.testWaitForCanvasReady, 'editor', 20000);

    await vscode.commands.executeCommand(MAIN_COMMAND_IDS.testCreateNode, 'agent');
    let snapshot = await waitForSnapshot((currentSnapshot) =>
      currentSnapshot.state.nodes.some((node) => node.kind === 'agent')
    );
    const agentNode = snapshot.state.nodes.find((node) => node.kind === 'agent');
    assert.ok(agentNode, 'Expected the smoke scenario to create an agent node.');
    agentNodeId = agentNode.id;

    await vscode.commands.executeCommand(
      MAIN_COMMAND_IDS.testStartExecutionSession,
      'agent',
      agentNodeId,
      120,
      40,
      'codex',
      false
    );
    await waitForSnapshot((currentSnapshot) => {
      const currentAgent = currentSnapshot.state.nodes.find((node) => node.id === agentNodeId);
      return Boolean(
        currentAgent?.metadata?.agent?.liveSession &&
          (currentAgent.status === 'starting' ||
            currentAgent.status === 'running' ||
            currentAgent.status === 'waiting-input')
      );
    });

    await clearDiagnosticEvents();
    await clearHostMessages();
    await clearNotifierPostedNotifications();

    const attentionMessage = 'notifier companion smoke';
    await dispatchWebviewMessage({
      type: 'webview/executionInput',
      payload: {
        nodeId: agentNodeId,
        kind: 'agent',
        data: `notify ${attentionMessage}\r`
      }
    });

    const diagnostics = await waitForDiagnosticEvents(
      (events) =>
        events.some(
          (event) =>
            event.kind === 'execution/attentionNotificationCompanionPosted' &&
            event.detail?.nodeId === agentNodeId &&
            event.detail?.backend === 'test' &&
            event.detail?.activationMode === 'test-replay'
        ),
      20000
    );
    assert.ok(
      diagnostics.some(
        (event) =>
          event.kind === 'execution/attentionNotificationCompanionPosted' &&
          event.detail?.nodeId === agentNodeId
      ),
      'Expected the main extension to record a notifier companion delivery diagnostic.'
    );
    assert.strictEqual(
      diagnostics.some((event) => event.kind === 'execution/attentionNotificationPosted'),
      false,
      'Companion delivery should bypass the VS Code workbench notification fallback.'
    );

    snapshot = await waitForSnapshot((currentSnapshot) => {
      const currentAgent = currentSnapshot.state.nodes.find((node) => node.id === agentNodeId);
      return Boolean(
        currentAgent?.metadata?.agent?.recentOutput?.includes(`[fake-agent] notified ${attentionMessage}`) &&
          currentAgent?.metadata?.agent?.attentionPending === true
      );
    });
    assert.strictEqual(
      snapshot.state.nodes.find((node) => node.id === agentNodeId)?.metadata?.agent?.attentionPending,
      true,
      'Companion delivery should still set the execution node attention state.'
    );

    const postedNotifications = await getNotifierPostedNotifications();
    assert.strictEqual(postedNotifications.length, 1, 'Expected the notifier companion to record one posted notification.');
    assert.strictEqual(postedNotifications[0].result.backend, 'test');
    assert.strictEqual(postedNotifications[0].result.activationMode, 'test-replay');
    assert.strictEqual(
      postedNotifications[0].request.title,
      `DSCanvas · ${vscode.workspace.name ?? path.basename(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '')} · Agent`
    );
    assert.match(postedNotifications[0].request.message, /notifier companion smoke/);
    assert.deepStrictEqual(postedNotifications[0].request.focusAction, {
      command: 'devSessionCanvas.__internal.centerAttentionNode',
      arguments: [agentNodeId]
    });
    assert.ok(postedNotifications[0].callbackUri, 'Expected the notifier companion to build a callback URI.');

    await clearHostMessages();
    const replayed = await vscode.commands.executeCommand(NOTIFIER_TEST_COMMAND_IDS.replayLastFocusAction);
    assert.strictEqual(replayed, true, 'Expected the notifier test helper to replay the focus callback URI.');

    const hostMessages = await waitForHostMessages(
      (messages) => messages.some((message) => message.type === 'host/centerNode' && message.payload.nodeId === agentNodeId),
      20000
    );
    assert.ok(
      hostMessages.some((message) => message.type === 'host/centerNode' && message.payload.nodeId === agentNodeId),
      'Expected replaying the notifier callback to center the execution node without selecting it.'
    );
    assert.ok(
      hostMessages.some(
        (message) => message.type === 'host/visibilityRestored' && message.payload?.restoreFocus === false
      ),
      'Expected replaying the notifier callback to return to the canvas without restoring Webview focus.'
    );
    assert.strictEqual(
      hostMessages.some((message) => message.type === 'host/focusNode' && message.payload?.nodeId === agentNodeId),
      false,
      'Replaying the notifier callback should not send a focus-node host message.'
    );

    snapshot = await getDebugSnapshot();
    assert.strictEqual(
      snapshot.state.nodes.find((node) => node.id === agentNodeId)?.metadata?.agent?.attentionPending,
      true,
      'Replaying the notifier callback should keep the attention state until the user clicks the node.'
    );

    const replayedAgain = await vscode.commands.executeCommand(NOTIFIER_TEST_COMMAND_IDS.replayLastFocusAction);
    assert.strictEqual(replayedAgain, false, 'Expected focus callback tokens to be single-use.');
  } finally {
    if (agentNodeId) {
      await ensureAgentStopped(agentNodeId);
    }
    await configuration.update(
      'devSessionCanvas.notifications.attentionSignalBridge',
      originalBridgeMode,
      vscode.ConfigurationTarget.Global
    );
    await clearDiagnosticEvents();
    await clearHostMessages();
    await clearNotifierPostedNotifications();
  }
}

async function verifyUnsupportedFocusActionIsRejected() {
  const postedNotificationsBefore = await getNotifierPostedNotifications();
  const result = await vscode.commands.executeCommand(NOTIFIER_COMMAND_IDS.postSystemNotification, {
    version: 1,
    kind: 'execution-attention',
    title: 'notifier smoke invalid action',
    message: 'invalid focus action should be rejected',
    dedupeKey: `notifier-smoke-invalid-focus:${Date.now()}`,
    focusAction: {
      command: 'workbench.action.closeWindow',
      arguments: ['unexpected']
    }
  });

  assert.deepStrictEqual(result, {
    status: 'error',
    backend: 'unsupported',
    activationMode: 'none',
    detail: 'unsupported-focus-action'
  });

  const postedNotificationsAfter = await getNotifierPostedNotifications();
  assert.strictEqual(
    postedNotificationsAfter.length,
    postedNotificationsBefore.length,
    'Rejected focus actions should not be recorded as posted notifications.'
  );
}

async function getDebugSnapshot() {
  return vscode.commands.executeCommand(MAIN_COMMAND_IDS.testGetDebugState);
}

async function clearHostMessages() {
  await vscode.commands.executeCommand(MAIN_COMMAND_IDS.testClearHostMessages);
}

async function getHostMessages() {
  return vscode.commands.executeCommand(MAIN_COMMAND_IDS.testGetHostMessages);
}

async function clearDiagnosticEvents() {
  await vscode.commands.executeCommand(MAIN_COMMAND_IDS.testClearDiagnosticEvents);
}

async function getDiagnosticEvents() {
  return vscode.commands.executeCommand(MAIN_COMMAND_IDS.testGetDiagnosticEvents);
}

async function clearNotifierPostedNotifications() {
  await vscode.commands.executeCommand(NOTIFIER_TEST_COMMAND_IDS.clearPostedNotifications);
}

async function getNotifierPostedNotifications() {
  return vscode.commands.executeCommand(NOTIFIER_TEST_COMMAND_IDS.getPostedNotifications);
}

async function dispatchWebviewMessage(message) {
  return vscode.commands.executeCommand(MAIN_COMMAND_IDS.testDispatchWebviewMessage, message, 'editor');
}

async function waitForSnapshot(predicate, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snapshot = await getDebugSnapshot();
    if (predicate(snapshot)) {
      return snapshot;
    }
    await sleep(100);
  }

  throw new Error('Timed out waiting for canvas snapshot.');
}

async function waitForDiagnosticEvents(predicate, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const events = await getDiagnosticEvents();
    if (predicate(events)) {
      return events;
    }
    await sleep(100);
  }

  throw new Error('Timed out waiting for diagnostic events.');
}

async function waitForHostMessages(predicate, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const messages = await getHostMessages();
    if (predicate(messages)) {
      return messages;
    }
    await sleep(100);
  }

  throw new Error('Timed out waiting for host messages.');
}

async function waitForCommand(commandId, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const commands = await vscode.commands.getCommands(true);
    if (commands.includes(commandId)) {
      return;
    }
    await sleep(100);
  }

  throw new Error(`Timed out waiting for command ${commandId}.`);
}

async function waitForVisibleExtension(extensionId, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const extension = vscode.extensions.all.find((candidate) => candidate.id === extensionId);
    if (extension) {
      return extension;
    }
    await sleep(100);
  }

  const visibleIds = vscode.extensions.all
    .map((extension) => extension.id)
    .filter((id) => id.startsWith('devsessioncanvas'))
    .sort();
  throw new Error(
    `Timed out waiting for extension ${extensionId}. Visible devsessioncanvas extensions: ${visibleIds.join(', ')}`
  );
}

async function activateNotifierSmokeHarness() {
  await vscode.commands.executeCommand(NOTIFIER_COMMAND_IDS.postSystemNotification, {
    version: 1,
    kind: 'execution-attention',
    title: 'notifier smoke bootstrap',
    message: 'bootstrap notifier smoke command surface',
    dedupeKey: `notifier-smoke-bootstrap:${Date.now()}`
  });
  await waitForCommand(NOTIFIER_TEST_COMMAND_IDS.clearPostedNotifications);
  await clearNotifierPostedNotifications();
}

async function ensureAttentionNotificationBridgeMode(mode) {
  const configuration = vscode.workspace.getConfiguration();
  const currentMode = normalizeAttentionNotificationBridgeMode(
    configuration.get('devSessionCanvas.notifications.attentionSignalBridge', 'system')
  );
  if (currentMode === mode) {
    return;
  }

  await clearDiagnosticEvents();
  await configuration.update(
    'devSessionCanvas.notifications.attentionSignalBridge',
    mode,
    vscode.ConfigurationTarget.Global
  );
  await waitForDiagnosticEvents(
    (events) =>
      events.some(
        (event) =>
          event.kind === 'execution/attentionNotificationBridgeConfigChanged' && event.detail?.mode === mode
      ),
    20000
  );
}

function normalizeAttentionNotificationBridgeMode(value) {
  if (value === 'none' || value === 'workbench' || value === 'system') {
    return value;
  }

  if (value === false) {
    return 'none';
  }

  if (value === true) {
    return 'workbench';
  }

  return 'system';
}

async function ensureAgentStopped(agentNodeId) {
  const snapshot = await getDebugSnapshot();
  const currentAgent = snapshot.state.nodes.find((node) => node.id === agentNodeId);
  if (!currentAgent?.metadata?.agent?.liveSession) {
    return;
  }

  await dispatchWebviewMessage({
    type: 'webview/stopExecutionSession',
    payload: {
      nodeId: agentNodeId,
      kind: 'agent'
    }
  });
  await waitForSnapshot((currentSnapshot) => {
    const nextAgent = currentSnapshot.state.nodes.find((node) => node.id === agentNodeId);
    return Boolean(nextAgent && nextAgent.status === 'stopped' && !nextAgent.metadata?.agent?.liveSession);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
