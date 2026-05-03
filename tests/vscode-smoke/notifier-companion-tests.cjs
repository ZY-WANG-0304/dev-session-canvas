const assert = require('assert');
const path = require('path');
const vscode = require('vscode');

const MAIN_EXTENSION_ID = 'devsessioncanvas.dev-session-canvas';
const NOTIFIER_EXTENSION_ID = 'devsessioncanvas.dev-session-canvas-notifier';
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
const NOTIFIER_TEST_COMMAND_IDS = {
  getPostedNotifications: 'devSessionCanvasNotifier.__test.getPostedNotifications',
  clearPostedNotifications: 'devSessionCanvasNotifier.__test.clearPostedNotifications',
  replayLastFocusAction: 'devSessionCanvasNotifier.__test.replayLastFocusAction'
};

module.exports = {
  run
};

async function run() {
  const mainExtension = vscode.extensions.getExtension(MAIN_EXTENSION_ID);
  assert.ok(mainExtension, `Missing extension ${MAIN_EXTENSION_ID}.`);
  await mainExtension.activate();

  const notifierExtension = vscode.extensions.getExtension(NOTIFIER_EXTENSION_ID);
  assert.ok(notifierExtension, `Missing extension ${NOTIFIER_EXTENSION_ID}.`);
  await notifierExtension.activate();

  await vscode.commands.executeCommand(MAIN_COMMAND_IDS.testResetState);
  await clearDiagnosticEvents();
  await clearHostMessages();
  await clearNotifierPostedNotifications();

  const configuration = vscode.workspace.getConfiguration();
  const originalPreferNotifier = configuration.get('devSessionCanvas.notifications.preferNotifierCompanion', false) === true;
  const originalBridgeEnabled =
    configuration.get('devSessionCanvas.notifications.bridgeTerminalAttentionSignals', true) === true;

  let agentNodeId;
  try {
    await ensurePreferNotifierCompanionEnabled(true);
    await ensureBridgeTerminalAttentionSignalsEnabled(true);

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
    assert.match(postedNotifications[0].request.message, /notifier companion smoke/);
    assert.ok(postedNotifications[0].callbackUri, 'Expected the notifier companion to build a callback URI.');

    await clearHostMessages();
    const replayed = await vscode.commands.executeCommand(NOTIFIER_TEST_COMMAND_IDS.replayLastFocusAction);
    assert.strictEqual(replayed, true, 'Expected the notifier test helper to replay the focus callback URI.');

    const hostMessages = await waitForHostMessages(
      (messages) => messages.some((message) => message.type === 'host/focusNode' && message.payload.nodeId === agentNodeId),
      20000
    );
    assert.ok(
      hostMessages.some((message) => message.type === 'host/focusNode' && message.payload.nodeId === agentNodeId),
      'Expected replaying the notifier callback to focus the execution node.'
    );

    snapshot = await waitForSnapshot((currentSnapshot) => {
      const currentAgent = currentSnapshot.state.nodes.find((node) => node.id === agentNodeId);
      return Boolean(currentAgent && currentAgent.metadata?.agent?.attentionPending === false);
    });
    assert.strictEqual(
      snapshot.state.nodes.find((node) => node.id === agentNodeId)?.metadata?.agent?.attentionPending,
      false,
      'Replaying the notifier callback should clear the attention state.'
    );
  } finally {
    if (agentNodeId) {
      await ensureAgentStopped(agentNodeId);
    }
    await configuration.update(
      'devSessionCanvas.notifications.preferNotifierCompanion',
      originalPreferNotifier,
      vscode.ConfigurationTarget.Global
    );
    await configuration.update(
      'devSessionCanvas.notifications.bridgeTerminalAttentionSignals',
      originalBridgeEnabled,
      vscode.ConfigurationTarget.Global
    );
    await clearDiagnosticEvents();
    await clearHostMessages();
    await clearNotifierPostedNotifications();
  }
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

async function ensurePreferNotifierCompanionEnabled(enabled) {
  const configuration = vscode.workspace.getConfiguration();
  const currentEnabled = configuration.get('devSessionCanvas.notifications.preferNotifierCompanion', false) === true;
  if (currentEnabled === enabled) {
    return;
  }

  await clearDiagnosticEvents();
  await configuration.update(
    'devSessionCanvas.notifications.preferNotifierCompanion',
    enabled,
    vscode.ConfigurationTarget.Global
  );
  await waitForDiagnosticEvents(
    (events) =>
      events.some(
        (event) =>
          event.kind === 'execution/attentionNotifierCompanionConfigChanged' && event.detail?.enabled === enabled
      ),
    20000
  );
}

async function ensureBridgeTerminalAttentionSignalsEnabled(enabled) {
  const configuration = vscode.workspace.getConfiguration();
  const currentEnabled =
    configuration.get('devSessionCanvas.notifications.bridgeTerminalAttentionSignals', true) === true;
  if (currentEnabled === enabled) {
    return;
  }

  await clearDiagnosticEvents();
  await configuration.update(
    'devSessionCanvas.notifications.bridgeTerminalAttentionSignals',
    enabled,
    vscode.ConfigurationTarget.Global
  );
  await waitForDiagnosticEvents(
    (events) =>
      events.some(
        (event) =>
          event.kind === 'execution/attentionNotificationBridgeConfigChanged' && event.detail?.enabled === enabled
      ),
    20000
  );
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
