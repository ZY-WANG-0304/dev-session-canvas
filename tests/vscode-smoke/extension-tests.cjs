const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const vscode = require('vscode');

const EXTENSION_ID = 'devsessioncanvas.dev-session-canvas';
const COMMAND_IDS = {
  openCanvas: 'devSessionCanvas.openCanvas',
  openCanvasInEditor: 'devSessionCanvas.openCanvasInEditor',
  openCanvasInPanel: 'devSessionCanvas.openCanvasInPanel',
  createNode: 'devSessionCanvas.createNode',
  testGetDebugState: 'devSessionCanvas.__test.getDebugState',
  testGetRuntimeSupervisorState: 'devSessionCanvas.__test.getRuntimeSupervisorState',
  testGetHostMessages: 'devSessionCanvas.__test.getHostMessages',
  testClearHostMessages: 'devSessionCanvas.__test.clearHostMessages',
  testGetDiagnosticEvents: 'devSessionCanvas.__test.getDiagnosticEvents',
  testClearDiagnosticEvents: 'devSessionCanvas.__test.clearDiagnosticEvents',
  testLocateCodexSessionId: 'devSessionCanvas.__test.locateCodexSessionId',
  testGetAgentCliResolutionCacheKey: 'devSessionCanvas.__test.getAgentCliResolutionCacheKey',
  testWaitForCanvasReady: 'devSessionCanvas.__test.waitForCanvasReady',
  testCaptureWebviewProbe: 'devSessionCanvas.__test.captureWebviewProbe',
  testPerformWebviewDomAction: 'devSessionCanvas.__test.performWebviewDomAction',
  testSetPersistedState: 'devSessionCanvas.__test.setPersistedState',
  testReloadPersistedState: 'devSessionCanvas.__test.reloadPersistedState',
  testSimulateRuntimeReload: 'devSessionCanvas.__test.simulateRuntimeReload',
  testDispatchWebviewMessage: 'devSessionCanvas.__test.dispatchWebviewMessage',
  testStartExecutionSession: 'devSessionCanvas.__test.startExecutionSession',
  testSetQuickPickSelections: 'devSessionCanvas.__test.setQuickPickSelections',
  testCreateNode: 'devSessionCanvas.__test.createNode',
  testResetState: 'devSessionCanvas.__test.resetState'
};

const artifactDir = process.env.DEV_SESSION_CANVAS_SMOKE_ARTIFACT_DIR;
const smokeScenario = process.env.DEV_SESSION_CANVAS_SMOKE_SCENARIO || 'trusted';
const REAL_DOM_AGENT_TITLE = 'Agent Title Through DOM';
const REAL_DOM_TERMINAL_TITLE = 'Terminal Title Through DOM';
const REAL_DOM_NOTE_TITLE = 'Host Smoke Note Through DOM';
const REAL_DOM_NOTE_BODY = 'Drive the note edit through the real VS Code webview DOM.';
const DISPOSED_EDITOR_NOTE_BODY = 'This note update should never commit after the editor closes.';
const WEBVIEW_FAULT_INJECTION_DELAY_MS = 1500;
const AGENT_STOP_RACE_SLEEP_SECONDS = 5;
const HOST_BOUNDARY_FLUSH_AGENT_MARKER = 'HOST_BOUNDARY_AGENT_FLUSH';
const HOST_BOUNDARY_FLUSH_TERMINAL_MARKER = 'HOST_BOUNDARY_TERMINAL_FLUSH';
const RESIZED_NODE_SIZES = {
  agent: { width: 640, height: 500 },
  terminal: { width: 620, height: 460 },
  note: { width: 500, height: 500 }
};
const BUILTIN_WORKBENCH_TERMINAL_THEME_EXPECTATIONS = {
  panel: {
    'Dark Modern': {
      background: '#181818',
      foreground: '#CCCCCC',
      ansiBlue: '#2472c8'
    },
    'Light Modern': {
      background: '#F8F8F8',
      foreground: '#3B3B3B',
      ansiBlue: '#0451a5'
    }
  },
  editor: {
    'Dark Modern': {
      background: '#1F1F1F',
      foreground: '#CCCCCC',
      ansiBlue: '#2472c8'
    },
    'Light Modern': {
      background: '#FFFFFF',
      foreground: '#3B3B3B',
      ansiBlue: '#0451a5'
    }
  }
};
let lastWebviewProbe;

module.exports = {
  run
};

async function run() {
  try {
    await runSmoke();
  } catch (error) {
    await writeFailureArtifacts(error);
    throw error;
  }
}

async function runSmoke() {
  const extension = vscode.extensions.getExtension(EXTENSION_ID);
  assert.ok(extension, `Missing extension ${EXTENSION_ID}.`);
  await extension.activate();

  const commands = await vscode.commands.getCommands(true);
  for (const command of Object.values(COMMAND_IDS)) {
    assert.ok(commands.includes(command), `Missing command ${command}.`);
  }

  await vscode.commands.executeCommand(COMMAND_IDS.testResetState);
  await clearHostMessages();
  await clearDiagnosticEvents();

  if (smokeScenario === 'restricted') {
    await runRestrictedSmoke();
    return;
  }

  await runTrustedSmoke();
}

async function createBaseNodes() {
  await dispatchWebviewMessage({
    type: 'webview/createDemoNode',
    payload: {
      kind: 'agent',
      preferredPosition: { x: 40, y: 40 }
    }
  });
  await dispatchWebviewMessage({
    type: 'webview/createDemoNode',
    payload: {
      kind: 'terminal',
      preferredPosition: { x: 420, y: 40 }
    }
  });
  await dispatchWebviewMessage({
    type: 'webview/createDemoNode',
    payload: {
      kind: 'note',
      preferredPosition: { x: 420, y: 320 }
    }
  });
}

async function runTrustedSmoke() {
  await vscode.commands.executeCommand(COMMAND_IDS.openCanvas);
  await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'panel', 20000);
  await clearHostMessages();

  let snapshot = await getDebugSnapshot();
  assert.strictEqual(snapshot.activeSurface, 'panel');
  assert.strictEqual(snapshot.sidebar.configuredSurface, 'panel');
  assert.strictEqual(snapshot.sidebar.surfaceLocation, 'panel');
  assert.strictEqual(snapshot.surfaceReady.panel, true);
  assert.strictEqual(snapshot.state.nodes.length, 0);

  await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInEditor);
  await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'editor', 20000);
  await clearHostMessages();

  snapshot = await getDebugSnapshot();
  assert.strictEqual(snapshot.activeSurface, 'editor');
  assert.strictEqual(snapshot.sidebar.configuredSurface, 'panel');
  assert.strictEqual(snapshot.sidebar.canvasSurface, 'visible');
  assert.strictEqual(snapshot.sidebar.workspaceTrusted, true);
  assert.strictEqual(snapshot.surfaceReady.editor, true);
  assert.strictEqual(snapshot.state.nodes.length, 0);

  await verifyCodexSessionIdLocator();
  await verifyAgentCliRelativePathCacheIsolation();

  await dispatchWebviewMessage({ type: 'webview/not-a-real-message' });
  let hostMessages = await getHostMessages();
  assert.ok(
    hostMessages.some(
      (message) =>
        message.type === 'host/error' &&
        message.payload.message === '收到无法识别的消息，已忽略。'
    )
  );
  snapshot = await getDebugSnapshot();
  assert.strictEqual(snapshot.state.nodes.length, 0);

  await verifyCreateNodeCommandQuickPick();
  await clearHostMessages();
  await clearDiagnosticEvents();
  snapshot = await getDebugSnapshot();
  assert.strictEqual(snapshot.state.nodes.length, 0);

  await clearHostMessages();
  await createBaseNodes();
  snapshot = await getDebugSnapshot();
  assert.deepStrictEqual(
    snapshot.state.nodes.map((node) => node.kind).sort(),
    ['agent', 'note', 'terminal']
  );

  const noteNode = findNodeByKind(snapshot, 'note');
  const terminalNode = findNodeByKind(snapshot, 'terminal');
  const agentNode = findNodeByKind(snapshot, 'agent');
  await dispatchWebviewMessage({
    type: 'webview/updateNodeTitle',
    payload: {
      nodeId: noteNode.id,
      title: 'Host Smoke Note'
    }
  });
  await dispatchWebviewMessage({
    type: 'webview/updateNoteNode',
    payload: {
      nodeId: noteNode.id,
      content: 'Exercise the real webview-to-host update path.'
    }
  });
  await dispatchWebviewMessage({
    type: 'webview/moveNode',
    payload: {
      id: noteNode.id,
      position: {
        x: 680,
        y: 260
      }
    }
  });

  snapshot = await getDebugSnapshot();
  assert.strictEqual(findNodeById(snapshot, noteNode.id).title, 'Host Smoke Note');
  assert.strictEqual(
    findNodeById(snapshot, noteNode.id).metadata.note.content,
    'Exercise the real webview-to-host update path.'
  );
  assert.deepStrictEqual(findNodeById(snapshot, noteNode.id).position, { x: 680, y: 260 });

  await verifyLegacyTaskFiltering();
  await verifyRealWebviewProbe(agentNode.id, terminalNode.id, noteNode.id);
  await verifyRealWebviewDomInteractions(agentNode.id, terminalNode.id, noteNode.id);
  await verifyNodeResizePersistence(agentNode.id, terminalNode.id, noteNode.id);
  await verifyAutoStartOnCreate(agentNode.id, terminalNode.id);
  await verifyAgentExecutionFlow(agentNode.id);
  await verifyTerminalExecutionFlow(terminalNode.id);
  await verifyEmbeddedTerminalThemeFollowWorkbench(agentNode.id, terminalNode.id);
  await verifyRuntimeReloadRecovery(agentNode.id, terminalNode.id);
  await verifyLiveSessionCutoverAndReload(terminalNode.id);
  await verifyPtyRobustness(agentNode.id, terminalNode.id);
  await verifyFailurePaths(agentNode.id, terminalNode.id, noteNode.id);
  await verifyPersistenceAndRecovery(noteNode.id, agentNode.id, terminalNode.id);
  await verifyStandbySurfaceIgnoresMessages(noteNode.id);
  await verifyPendingWebviewRequestFaultInjection(noteNode.id);
  await verifyStopVsQueuedExitRace(agentNode.id);
  await verifyLiveRuntimePersistence(agentNode.id, terminalNode.id);
  await verifyLiveRuntimeReconnectFallbackToResume(agentNode.id, terminalNode.id);
  await verifyHistoryRestoredResumeReadyIgnoresStaleResumeSupported(agentNode.id, terminalNode.id);
  await verifyLiveRuntimeResumeExitClassification(agentNode.id);
  await verifyImmediateReloadAfterLiveRuntimeLaunch(agentNode.id, terminalNode.id);
  await verifyDisablingRuntimePersistenceStopsReattach(agentNode.id, terminalNode.id);
  await verifyHostBoundaryFlushesRecentLocalState(agentNode.id, terminalNode.id);
  await verifyTrustedDiagnostics(agentNode.id, terminalNode.id);
  await verifyRealDeleteButton(noteNode.id);

  snapshot = await getDebugSnapshot();
  assert.strictEqual(snapshot.state.nodes.some((node) => node.id === noteNode.id), false);
  assert.strictEqual(snapshot.state.nodes.length, 2);

  await dispatchWebviewMessage({ type: 'webview/resetDemoState' });
  snapshot = await waitForSnapshot((currentSnapshot) => currentSnapshot.state.nodes.length === 0, 20000);
  assert.strictEqual(snapshot.state.nodes.length, 0);

  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
}

async function verifyCreateNodeCommandQuickPick() {
  await clearHostMessages();
  await clearDiagnosticEvents();

  await setQuickPickSelections(['create-agent-claude']);
  await vscode.commands.executeCommand(COMMAND_IDS.createNode);

  let snapshot = await waitForSnapshot((currentSnapshot) => {
    return currentSnapshot.state.nodes.some(
      (node) => node.kind === 'agent' && node.metadata?.agent?.provider === 'claude'
    );
  }, 20000);

  const claudeAgentNode = snapshot.state.nodes.find(
    (node) => node.kind === 'agent' && node.metadata?.agent?.provider === 'claude'
  );
  assert.ok(claudeAgentNode, 'Expected createNode command to create a Claude agent.');
  await waitForDiagnosticEvents(
    (events) =>
      events.some(
        (event) =>
          event.kind === 'execution/startRequested' &&
          event.detail?.nodeId === claudeAgentNode.id &&
          event.detail?.provider === 'claude'
      ),
    20000
  );

  await clearDiagnosticEvents();
  await setQuickPickSelections(['create-agent-default']);
  await vscode.commands.executeCommand(COMMAND_IDS.createNode);

  snapshot = await waitForSnapshot((currentSnapshot) => {
    return currentSnapshot.state.nodes.filter((node) => node.kind === 'agent').length >= 2;
  }, 20000);

  const codexAgentNode = snapshot.state.nodes.find(
    (node) =>
      node.kind === 'agent' &&
      node.id !== claudeAgentNode.id &&
      node.metadata?.agent?.provider === 'codex'
  );
  assert.ok(codexAgentNode, 'Expected default Agent quick pick item to create a Codex agent.');
  await waitForDiagnosticEvents(
    (events) =>
      events.some(
        (event) =>
          event.kind === 'execution/startRequested' &&
          event.detail?.nodeId === codexAgentNode.id &&
          event.detail?.provider === 'codex'
      ),
    20000
  );

  await clearDiagnosticEvents();
  await setQuickPickSelections(['create-note']);
  await vscode.commands.executeCommand(COMMAND_IDS.createNode);

  snapshot = await waitForSnapshot((currentSnapshot) => {
    return currentSnapshot.state.nodes.some((node) => node.kind === 'note');
  }, 20000);
  assert.ok(snapshot.state.nodes.some((node) => node.kind === 'note'));

  await dispatchWebviewMessage({ type: 'webview/resetDemoState' });
  snapshot = await waitForSnapshot((currentSnapshot) => currentSnapshot.state.nodes.length === 0, 20000);
  assert.strictEqual(snapshot.state.nodes.length, 0);

  await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInEditor);
  await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'editor', 20000);
}

async function runRestrictedSmoke() {
  await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInEditor);
  await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'editor', 20000);
  await clearHostMessages();

  let snapshot = await getDebugSnapshot();
  assert.strictEqual(snapshot.activeSurface, 'editor');
  assert.strictEqual(snapshot.sidebar.canvasSurface, 'visible');
  assert.strictEqual(snapshot.sidebar.workspaceTrusted, false);
  assert.deepStrictEqual(snapshot.sidebar.creatableKinds, ['note']);
  assert.strictEqual(snapshot.surfaceReady.editor, true);
  assert.strictEqual(snapshot.state.nodes.length, 0);

  await dispatchWebviewMessage({
    type: 'webview/createDemoNode',
    payload: {
      kind: 'agent',
      preferredPosition: { x: 40, y: 40 }
    }
  });
  await dispatchWebviewMessage({
    type: 'webview/createDemoNode',
    payload: {
      kind: 'terminal',
      preferredPosition: { x: 420, y: 40 }
    }
  });
  await dispatchWebviewMessage({
    type: 'webview/createDemoNode',
    payload: {
      kind: 'note',
      preferredPosition: { x: 420, y: 320 }
    }
  });

  snapshot = await getDebugSnapshot();
  assert.deepStrictEqual(
    snapshot.state.nodes.map((node) => node.kind).sort(),
    ['note']
  );

  let hostMessages = await getHostMessages();
  assert.ok(
    hostMessages.some(
      (message) =>
        message.type === 'host/error' &&
        message.payload.message === '当前 workspace 未受信任，已禁止创建 Agent / Terminal 节点。'
    )
  );

  await vscode.commands.executeCommand(COMMAND_IDS.testCreateNode, 'agent');
  await vscode.commands.executeCommand(COMMAND_IDS.testCreateNode, 'terminal');
  snapshot = await getDebugSnapshot();

  const agentNode = findNodeByKind(snapshot, 'agent');
  const terminalNode = findNodeByKind(snapshot, 'terminal');

  await clearHostMessages();
  await dispatchWebviewMessage({
    type: 'webview/startExecutionSession',
    payload: {
      nodeId: agentNode.id,
      kind: 'agent',
      cols: 84,
      rows: 26,
      provider: 'codex'
    }
  });
  await dispatchWebviewMessage({
    type: 'webview/startExecutionSession',
    payload: {
      nodeId: terminalNode.id,
      kind: 'terminal',
      cols: 84,
      rows: 26
    }
  });
  await dispatchWebviewMessage({
    type: 'webview/executionInput',
    payload: {
      nodeId: agentNode.id,
      kind: 'agent',
      data: 'hello restricted\r'
    }
  });
  await dispatchWebviewMessage({
    type: 'webview/executionInput',
    payload: {
      nodeId: terminalNode.id,
      kind: 'terminal',
      data: 'echo restricted\r'
    }
  });

  hostMessages = await getHostMessages();
  assert.ok(
    hostMessages.some(
      (message) =>
        message.type === 'host/error' &&
        message.payload.message === '当前 workspace 未受信任，已禁止 Agent 运行。'
    )
  );
  assert.ok(
    hostMessages.some(
      (message) =>
        message.type === 'host/error' &&
        message.payload.message === '当前 workspace 未受信任，已禁止终端操作。'
    )
  );
  assert.ok(
    hostMessages.some(
      (message) =>
        message.type === 'host/error' &&
        message.payload.message === '当前 workspace 未受信任，已禁止 Agent 输入。'
    )
  );
  assert.ok(
    hostMessages.some(
      (message) =>
        message.type === 'host/error' &&
        message.payload.message === '当前 workspace 未受信任，已禁止终端输入。'
    )
  );

  snapshot = await getDebugSnapshot();
  assert.strictEqual(findNodeById(snapshot, agentNode.id).metadata.agent.liveSession, false);
  assert.strictEqual(findNodeById(snapshot, terminalNode.id).metadata.terminal.liveSession, false);

  const probe = await waitForWebviewProbe((currentProbe) => {
    const currentAgent = currentProbe.nodes.find((node) => node.nodeId === agentNode.id);
    const currentTerminal = currentProbe.nodes.find((node) => node.nodeId === terminalNode.id);

    return Boolean(
      currentProbe.hasCanvasShell &&
        currentProbe.hasReactFlow &&
        currentAgent &&
        currentAgent.overlayTitle === 'Restricted Mode' &&
        currentAgent.overlayMessage === '当前 workspace 未受信任，Agent 会话入口已禁用。' &&
        currentTerminal &&
        currentTerminal.overlayTitle === 'Restricted Mode' &&
        currentTerminal.overlayMessage === '当前 workspace 未受信任，嵌入式终端入口已禁用。'
    );
  });

  const probeAgent = probe.nodes.find((node) => node.nodeId === agentNode.id);
  const probeTerminal = probe.nodes.find((node) => node.nodeId === terminalNode.id);
  assert.strictEqual(probeAgent?.overlayTitle, 'Restricted Mode');
  assert.strictEqual(probeTerminal?.overlayTitle, 'Restricted Mode');
  await verifyRestrictedLiveRuntimeReconnectBlocked(agentNode.id, terminalNode.id);
  await verifyRestrictedDiagnostics(agentNode.id, terminalNode.id);
  await verifyRestrictedDisablingRuntimePersistenceCleansLiveRuntime(agentNode.id, terminalNode.id);
  await verifyRestrictedDeleteCleansHistoryOnlyLiveRuntime(agentNode.id, terminalNode.id);

  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
}

async function waitForAgentLive(agentNodeId) {
  return waitForSnapshot((currentSnapshot) => {
    const currentAgent = currentSnapshot.state.nodes.find((node) => node.id === agentNodeId);
    return Boolean(
      currentAgent?.metadata?.agent?.liveSession &&
        (currentAgent.status === 'starting' ||
          currentAgent.status === 'running' ||
          currentAgent.status === 'waiting-input' ||
          currentAgent.status === 'resuming')
    );
  });
}

async function waitForTerminalLive(terminalNodeId) {
  return waitForSnapshot((currentSnapshot) => {
    const currentNode = currentSnapshot.state.nodes.find((node) => node.id === terminalNodeId);
    return Boolean(
      currentNode?.metadata?.terminal?.liveSession &&
        (currentNode.status === 'launching' || currentNode.status === 'live')
    );
  });
}

async function ensureAgentStopped(agentNodeId) {
  const snapshot = await getDebugSnapshot();
  const agentNode = findNodeById(snapshot, agentNodeId);
  if (!agentNode.metadata?.agent?.liveSession) {
    return snapshot;
  }

  await dispatchWebviewMessage({
    type: 'webview/stopExecutionSession',
    payload: {
      nodeId: agentNodeId,
      kind: 'agent'
    }
  });

  return waitForSnapshot((currentSnapshot) => {
    const currentNode = currentSnapshot.state.nodes.find((node) => node.id === agentNodeId);
    return Boolean(currentNode && !currentNode.metadata?.agent?.liveSession);
  });
}

async function ensureTerminalStopped(terminalNodeId) {
  const snapshot = await getDebugSnapshot();
  const terminalNode = findNodeById(snapshot, terminalNodeId);
  if (!terminalNode.metadata?.terminal?.liveSession) {
    return snapshot;
  }

  await dispatchWebviewMessage({
    type: 'webview/stopExecutionSession',
    payload: {
      nodeId: terminalNodeId,
      kind: 'terminal'
    }
  });

  return waitForSnapshot((currentSnapshot) => {
    const currentNode = currentSnapshot.state.nodes.find((node) => node.id === terminalNodeId);
    return Boolean(currentNode && !currentNode.metadata?.terminal?.liveSession);
  });
}

async function verifyAutoStartOnCreate(agentNodeId, terminalNodeId) {
  const snapshot = await waitForAgentLive(agentNodeId);
  const agentNode = findNodeById(snapshot, agentNodeId);
  assert.strictEqual(agentNode.metadata.agent.liveSession, true);
  assert.ok(
    agentNode.status === 'starting' ||
      agentNode.status === 'running' ||
      agentNode.status === 'waiting-input'
  );

  const terminalSnapshot = await waitForTerminalLive(terminalNodeId);
  const terminalNode = findNodeById(terminalSnapshot, terminalNodeId);
  assert.strictEqual(terminalNode.metadata.terminal.liveSession, true);
  assert.ok(terminalNode.status === 'launching' || terminalNode.status === 'live');
}

async function verifyAgentExecutionFlow(agentNodeId) {
  await clearHostMessages();

  let snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentNode = currentSnapshot.state.nodes.find((node) => node.id === agentNodeId);
    return Boolean(
      currentNode?.metadata?.agent?.liveSession &&
        (currentNode.status === 'starting' ||
          currentNode.status === 'running' ||
          currentNode.status === 'waiting-input')
    );
  });
  let agentNode = findNodeById(snapshot, agentNodeId);
  assert.strictEqual(agentNode.metadata.agent.liveSession, true);
  assert.ok(agentNode.metadata.agent.lastCols > 0);
  assert.ok(agentNode.metadata.agent.lastRows > 0);
  assert.ok(
    agentNode.status === 'starting' ||
      agentNode.status === 'running' ||
      agentNode.status === 'waiting-input'
  );

  await dispatchWebviewMessage({
    type: 'webview/executionInput',
    payload: {
      nodeId: agentNodeId,
      kind: 'agent',
      data: 'burst 1\r'
    }
  });

  snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentNode = currentSnapshot.state.nodes.find((node) => node.id === agentNodeId);
    return Boolean(currentNode?.metadata?.agent?.liveSession && currentNode.status === 'running');
  });
  agentNode = findNodeById(snapshot, agentNodeId);
  assert.strictEqual(agentNode.status, 'running');

  snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentNode = currentSnapshot.state.nodes.find((node) => node.id === agentNodeId);
    return Boolean(
      currentNode?.metadata?.agent?.recentOutput?.includes('[fake-agent] burst 001') &&
        currentNode.status === 'waiting-input'
    );
  });
  agentNode = findNodeById(snapshot, agentNodeId);
  assert.ok(agentNode.metadata.agent.recentOutput.includes('[fake-agent] burst 001'));
  assert.strictEqual(agentNode.status, 'waiting-input');

  await requestExecutionSnapshot('agent', agentNodeId);
  let hostMessages = await getHostMessages();
  assert.ok(
    hostMessages.some(
      (message) =>
        message.type === 'host/executionSnapshot' &&
        message.payload.kind === 'agent' &&
        message.payload.nodeId === agentNodeId
    )
  );

  await dispatchWebviewMessage({
    type: 'webview/executionInput',
    payload: {
      nodeId: agentNodeId,
      kind: 'agent',
      data: 'h'
    }
  });

  await sleep(300);
  snapshot = await getDebugSnapshot();
  agentNode = findNodeById(snapshot, agentNodeId);
  assert.strictEqual(agentNode.status, 'waiting-input');

  await dispatchWebviewMessage({
    type: 'webview/executionInput',
    payload: {
      nodeId: agentNodeId,
      kind: 'agent',
      data: 'ello smoke\r'
    }
  });

  snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentNode = currentSnapshot.state.nodes.find((node) => node.id === agentNodeId);
    return Boolean(
      currentNode?.metadata?.agent?.recentOutput?.includes('[fake-agent] hello smoke') &&
        currentNode.status === 'waiting-input'
    );
  });
  agentNode = findNodeById(snapshot, agentNodeId);
  assert.ok(agentNode.metadata.agent.recentOutput.includes('[fake-agent] hello smoke'));
  assert.strictEqual(agentNode.status, 'waiting-input');

  await dispatchWebviewMessage({
    type: 'webview/executionInput',
    payload: {
      nodeId: agentNodeId,
      kind: 'agent',
      data: 'sleep 1\r'
    }
  });

  snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentNode = currentSnapshot.state.nodes.find((node) => node.id === agentNodeId);
    return Boolean(currentNode?.metadata?.agent?.liveSession && currentNode.status === 'running');
  });
  agentNode = findNodeById(snapshot, agentNodeId);
  assert.strictEqual(agentNode.status, 'running');

  await sleep(500);
  snapshot = await getDebugSnapshot();
  agentNode = findNodeById(snapshot, agentNodeId);
  assert.strictEqual(agentNode.status, 'running');

  snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentNode = currentSnapshot.state.nodes.find((node) => node.id === agentNodeId);
    return Boolean(
      currentNode?.metadata?.agent?.recentOutput?.includes('[fake-agent] woke after 1s') &&
        currentNode.status === 'waiting-input'
    );
  });
  agentNode = findNodeById(snapshot, agentNodeId);
  assert.ok(agentNode.metadata.agent.recentOutput.includes('[fake-agent] woke after 1s'));
  assert.strictEqual(agentNode.status, 'waiting-input');

  await dispatchWebviewMessage({
    type: 'webview/executionInput',
    payload: {
      nodeId: agentNodeId,
      kind: 'agent',
      data: 'slowspin 3\r'
    }
  });

  snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentNode = currentSnapshot.state.nodes.find((node) => node.id === agentNodeId);
    return Boolean(currentNode?.metadata?.agent?.liveSession && currentNode.status === 'running');
  });
  agentNode = findNodeById(snapshot, agentNodeId);
  assert.strictEqual(agentNode.status, 'running');

  await sleep(430);
  snapshot = await getDebugSnapshot();
  agentNode = findNodeById(snapshot, agentNodeId);
  assert.strictEqual(agentNode.status, 'running');

  snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentNode = currentSnapshot.state.nodes.find((node) => node.id === agentNodeId);
    return Boolean(
      currentNode?.metadata?.agent?.recentOutput?.includes('[fake-agent] slowspin done 003') &&
        currentNode.status === 'waiting-input'
    );
  });
  agentNode = findNodeById(snapshot, agentNodeId);
  assert.ok(agentNode.metadata.agent.recentOutput.includes('[fake-agent] slowspin done 003'));
  assert.strictEqual(agentNode.status, 'waiting-input');

  await dispatchWebviewMessage({
    type: 'webview/executionInput',
    payload: {
      nodeId: agentNodeId,
      kind: 'agent',
      data: 'exit 0\r'
    }
  });

  snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentNode = currentSnapshot.state.nodes.find((node) => node.id === agentNodeId);
    return Boolean(currentNode && currentNode.status === 'stopped' && !currentNode.metadata?.agent?.liveSession);
  });
  agentNode = findNodeById(snapshot, agentNodeId);
  assert.strictEqual(agentNode.status, 'stopped');
  assert.strictEqual(agentNode.metadata.agent.liveSession, false);
  assert.strictEqual(agentNode.metadata.agent.lastExitCode, 0);
  assert.match(agentNode.summary, /Codex 会话已结束/);

  await clearHostMessages();
  await dispatchWebviewMessage({
    type: 'webview/startExecutionSession',
    payload: {
      nodeId: agentNodeId,
      kind: 'agent',
      cols: 90,
      rows: 28,
      provider: 'codex'
    }
  });

  await waitForAgentLive(agentNodeId);

  await dispatchWebviewMessage({
    type: 'webview/startExecutionSession',
    payload: {
      nodeId: agentNodeId,
      kind: 'agent',
      cols: 90,
      rows: 28,
      provider: 'codex'
    }
  });
  hostMessages = await getHostMessages();
  assert.ok(
    hostMessages.some(
      (message) =>
        message.type === 'host/error' &&
        message.payload.message === '该 Agent 已在运行中。'
    )
  );

  await dispatchWebviewMessage({
    type: 'webview/stopExecutionSession',
    payload: {
      nodeId: agentNodeId,
      kind: 'agent'
    }
  });

  snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentNode = currentSnapshot.state.nodes.find((node) => node.id === agentNodeId);
    return Boolean(currentNode && currentNode.status === 'stopped' && !currentNode.metadata?.agent?.liveSession);
  });
  agentNode = findNodeById(snapshot, agentNodeId);
  assert.strictEqual(agentNode.metadata.agent.liveSession, false);
  assert.strictEqual(agentNode.status, 'stopped');
  assert.match(agentNode.summary, /已停止 Codex 会话/);
}

async function verifyLegacyTaskFiltering() {
  const beforeSnapshot = await getDebugSnapshot();
  const beforeState = beforeSnapshot.state;

  let snapshot = await setPersistedState({
    version: 1,
    updatedAt: '2026-04-07T14:00:00.000Z',
    nodes: [
      {
        id: 'legacy-task-1',
        kind: 'task',
        title: 'Legacy Task',
        status: 'running',
        summary: 'Should be filtered when the canvas state reloads.',
        position: { x: 120, y: 80 },
        size: { width: 420, height: 320 },
        metadata: {
          task: {
            description: 'Outdated task node payload.',
            assignee: 'Codex'
          }
        }
      }
    ]
  });
  assert.strictEqual(snapshot.state.nodes.length, 0);

  snapshot = await setPersistedState({
    ...beforeState,
    nodes: [
      ...beforeState.nodes,
      {
        id: 'legacy-task-2',
        kind: 'task',
        title: 'Legacy Task Kept Out',
        status: 'done',
        summary: 'Should not survive beside current nodes.',
        position: { x: 960, y: 120 },
        size: { width: 420, height: 320 },
        metadata: {
          task: {
            description: 'Mixed legacy state.',
            assignee: 'Codex'
          }
        }
      }
    ]
  });
  assert.deepStrictEqual(
    snapshot.state.nodes.map((node) => node.kind).sort(),
    beforeState.nodes.map((node) => node.kind).sort()
  );
  assert.strictEqual(snapshot.state.nodes.some((node) => node.id === 'legacy-task-2'), false);
}

async function verifyRealWebviewProbe(agentNodeId, terminalNodeId, noteNodeId) {
  let probe = await waitForWebviewProbe((currentProbe) => {
    const agentNode = currentProbe.nodes.find((node) => node.nodeId === agentNodeId);
    const terminalNode = currentProbe.nodes.find((node) => node.nodeId === terminalNodeId);
    const noteNode = currentProbe.nodes.find((node) => node.nodeId === noteNodeId);

    return Boolean(
      currentProbe.hasCanvasShell &&
        currentProbe.hasReactFlow &&
        currentProbe.nodeCount === 3 &&
        agentNode &&
        agentNode.kind === 'agent' &&
        typeof agentNode.titleInputValue === 'string' &&
        agentNode.titleInputValue.length > 0 &&
        terminalNode &&
        terminalNode.kind === 'terminal' &&
        typeof terminalNode.titleInputValue === 'string' &&
        terminalNode.titleInputValue.length > 0 &&
        noteNode &&
        noteNode.kind === 'note' &&
        noteNode.chromeTitle === 'Host Smoke Note' &&
        noteNode.chromeSubtitle === null &&
        noteNode.statusText === null &&
        noteNode.titleInputValue === 'Host Smoke Note' &&
        noteNode.bodyValue === 'Exercise the real webview-to-host update path.'
    );
  });

  assert.strictEqual(probe.hasCanvasShell, true);
  assert.strictEqual(probe.hasReactFlow, true);
  assert.strictEqual(probe.nodeCount, 3);

  await dispatchWebviewMessage({ type: 'webview/not-a-real-message' });
  probe = await waitForWebviewProbe(
    (currentProbe) => currentProbe.toastMessage === '收到无法识别的消息，已忽略。'
  );
  assert.strictEqual(probe.toastMessage, '收到无法识别的消息，已忽略。');
}

async function verifyRealWebviewDomInteractions(agentNodeId, terminalNodeId, noteNodeId) {
  await performWebviewDomAction({
    kind: 'setNodeTextField',
    nodeId: agentNodeId,
    field: 'title',
    value: REAL_DOM_AGENT_TITLE
  });

  let snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentAgent = currentSnapshot.state.nodes.find((node) => node.id === agentNodeId);
    return Boolean(currentAgent?.title === REAL_DOM_AGENT_TITLE);
  });
  assert.strictEqual(findNodeById(snapshot, agentNodeId).title, REAL_DOM_AGENT_TITLE);

  await performWebviewDomAction({
    kind: 'setNodeTextField',
    nodeId: terminalNodeId,
    field: 'title',
    value: REAL_DOM_TERMINAL_TITLE
  });

  snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentTerminal = currentSnapshot.state.nodes.find((node) => node.id === terminalNodeId);
    return Boolean(currentTerminal?.title === REAL_DOM_TERMINAL_TITLE);
  });
  assert.strictEqual(findNodeById(snapshot, terminalNodeId).title, REAL_DOM_TERMINAL_TITLE);

  await performWebviewDomAction({
    kind: 'setNodeTextField',
    nodeId: noteNodeId,
    field: 'title',
    value: REAL_DOM_NOTE_TITLE
  });

  snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentNote = currentSnapshot.state.nodes.find((node) => node.id === noteNodeId);
    return Boolean(currentNote?.title === REAL_DOM_NOTE_TITLE);
  });
  assert.strictEqual(findNodeById(snapshot, noteNodeId).title, REAL_DOM_NOTE_TITLE);

  let probe = await waitForWebviewProbe((currentProbe) => {
    const currentAgent = currentProbe.nodes.find((node) => node.nodeId === agentNodeId);
    const currentTerminal = currentProbe.nodes.find((node) => node.nodeId === terminalNodeId);
    const currentNote = currentProbe.nodes.find((node) => node.nodeId === noteNodeId);
    return Boolean(
      currentAgent &&
        currentAgent.titleInputValue === REAL_DOM_AGENT_TITLE &&
        currentTerminal &&
        currentTerminal.titleInputValue === REAL_DOM_TERMINAL_TITLE &&
      currentNote &&
        currentNote.chromeTitle === REAL_DOM_NOTE_TITLE &&
        currentNote.titleInputValue === REAL_DOM_NOTE_TITLE
    );
  });
  assert.strictEqual(
    probe.nodes.find((node) => node.nodeId === agentNodeId)?.titleInputValue,
    REAL_DOM_AGENT_TITLE
  );
  assert.strictEqual(
    probe.nodes.find((node) => node.nodeId === terminalNodeId)?.titleInputValue,
    REAL_DOM_TERMINAL_TITLE
  );
  assert.strictEqual(
    probe.nodes.find((node) => node.nodeId === noteNodeId)?.titleInputValue,
    REAL_DOM_NOTE_TITLE
  );

  await performWebviewDomAction({
    kind: 'setNodeTextField',
    nodeId: noteNodeId,
    field: 'body',
    value: REAL_DOM_NOTE_BODY
  });

  snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentNote = currentSnapshot.state.nodes.find((node) => node.id === noteNodeId);
    return Boolean(currentNote?.metadata?.note?.content === REAL_DOM_NOTE_BODY);
  });
  assert.strictEqual(findNodeById(snapshot, noteNodeId).metadata.note.content, REAL_DOM_NOTE_BODY);

  probe = await waitForWebviewProbe((currentProbe) => {
    const currentNote = currentProbe.nodes.find((node) => node.nodeId === noteNodeId);
    return Boolean(
      currentNote &&
        currentNote.titleInputValue === REAL_DOM_NOTE_TITLE &&
        currentNote.bodyValue === REAL_DOM_NOTE_BODY
    );
  });
  assert.strictEqual(
    probe.nodes.find((node) => node.nodeId === noteNodeId)?.bodyValue,
    REAL_DOM_NOTE_BODY
  );
}

async function verifyNodeResizePersistence(agentNodeId, terminalNodeId, noteNodeId) {
  let snapshot = await waitForSnapshot((currentSnapshot) => {
    return (
      currentSnapshot.state.nodes.some((node) => node.id === agentNodeId) &&
      currentSnapshot.state.nodes.some((node) => node.id === terminalNodeId) &&
      currentSnapshot.state.nodes.some((node) => node.id === noteNodeId)
    );
  });
  const agentNode = findNodeById(snapshot, agentNodeId);
  const terminalNode = findNodeById(snapshot, terminalNodeId);
  const noteNode = findNodeById(snapshot, noteNodeId);

  await dispatchWebviewMessage({
    type: 'webview/resizeNode',
    payload: {
      nodeId: agentNodeId,
      position: agentNode.position,
      size: RESIZED_NODE_SIZES.agent
    }
  });
  await dispatchWebviewMessage({
    type: 'webview/resizeNode',
    payload: {
      nodeId: terminalNodeId,
      position: terminalNode.position,
      size: RESIZED_NODE_SIZES.terminal
    }
  });
  await dispatchWebviewMessage({
    type: 'webview/resizeNode',
    payload: {
      nodeId: noteNodeId,
      position: noteNode.position,
      size: RESIZED_NODE_SIZES.note
    }
  });

  snapshot = await waitForSnapshot((currentSnapshot) => {
    return (
      hasNodeSize(currentSnapshot, agentNodeId, RESIZED_NODE_SIZES.agent) &&
      hasNodeSize(currentSnapshot, terminalNodeId, RESIZED_NODE_SIZES.terminal) &&
      hasNodeSize(currentSnapshot, noteNodeId, RESIZED_NODE_SIZES.note)
    );
  });

  assert.deepStrictEqual(findNodeById(snapshot, agentNodeId).size, RESIZED_NODE_SIZES.agent);
  assert.deepStrictEqual(findNodeById(snapshot, terminalNodeId).size, RESIZED_NODE_SIZES.terminal);
  assert.deepStrictEqual(findNodeById(snapshot, noteNodeId).size, RESIZED_NODE_SIZES.note);

  const probe = await waitForWebviewProbe((currentProbe) => {
    return (
      hasRenderedNodeSize(currentProbe, agentNodeId, RESIZED_NODE_SIZES.agent) &&
      hasRenderedNodeSize(currentProbe, terminalNodeId, RESIZED_NODE_SIZES.terminal) &&
      hasRenderedNodeSize(currentProbe, noteNodeId, RESIZED_NODE_SIZES.note)
    );
  });

  assert.ok(hasRenderedNodeSize(probe, agentNodeId, RESIZED_NODE_SIZES.agent));
  assert.ok(hasRenderedNodeSize(probe, terminalNodeId, RESIZED_NODE_SIZES.terminal));
  assert.ok(hasRenderedNodeSize(probe, noteNodeId, RESIZED_NODE_SIZES.note));

  snapshot = await reloadPersistedState();
  assert.deepStrictEqual(findNodeById(snapshot, agentNodeId).size, RESIZED_NODE_SIZES.agent);
  assert.deepStrictEqual(findNodeById(snapshot, terminalNodeId).size, RESIZED_NODE_SIZES.terminal);
  assert.deepStrictEqual(findNodeById(snapshot, noteNodeId).size, RESIZED_NODE_SIZES.note);
}

async function verifyTerminalExecutionFlow(terminalNodeId) {
  await clearHostMessages();

  let snapshot = await waitForTerminalLive(terminalNodeId);
  let terminalNode = findNodeById(snapshot, terminalNodeId);
  assert.strictEqual(terminalNode.metadata.terminal.liveSession, true);
  assert.ok(terminalNode.metadata.terminal.lastCols > 0);
  assert.ok(terminalNode.metadata.terminal.lastRows > 0);

  await dispatchWebviewMessage({
    type: 'webview/startExecutionSession',
    payload: {
      nodeId: terminalNodeId,
      kind: 'terminal',
      cols: 84,
      rows: 26
    }
  });

  let hostMessages = await getHostMessages();
  assert.ok(
    hostMessages.some(
      (message) =>
        message.type === 'host/error' &&
        message.payload.message === '该终端已在运行中。'
    )
  );

  const outputMarker = 'DEV_SESSION_CANVAS_TERMINAL_SMOKE';
  await dispatchWebviewMessage({
    type: 'webview/executionInput',
    payload: {
      nodeId: terminalNodeId,
      kind: 'terminal',
      data: `echo ${outputMarker}\r`
    }
  });

  snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentNode = currentSnapshot.state.nodes.find((node) => node.id === terminalNodeId);
    return Boolean(currentNode?.metadata?.terminal?.recentOutput?.includes(outputMarker));
  });
  terminalNode = findNodeById(snapshot, terminalNodeId);
  assert.ok(terminalNode.metadata.terminal.recentOutput.includes(outputMarker));
  assert.strictEqual(terminalNode.status, 'live');

  await dispatchWebviewMessage({
    type: 'webview/stopExecutionSession',
    payload: {
      nodeId: terminalNodeId,
      kind: 'terminal'
    }
  });

  snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentNode = currentSnapshot.state.nodes.find((node) => node.id === terminalNodeId);
    return Boolean(currentNode && currentNode.status === 'closed' && !currentNode.metadata?.terminal?.liveSession);
  });
  terminalNode = findNodeById(snapshot, terminalNodeId);
  assert.strictEqual(terminalNode.status, 'closed');
  assert.strictEqual(terminalNode.metadata.terminal.liveSession, false);
  assert.match(terminalNode.summary, /终端/);

  snapshot = await dispatchWebviewMessage({
    type: 'webview/resizeExecutionSession',
    payload: {
      nodeId: terminalNodeId,
      kind: 'terminal',
      cols: 100,
      rows: 30
    }
  });
  terminalNode = findNodeById(snapshot, terminalNodeId);
  assert.strictEqual(terminalNode.metadata.terminal.lastCols, 100);
  assert.strictEqual(terminalNode.metadata.terminal.lastRows, 30);
}

async function verifyRuntimeReloadRecovery(agentNodeId, terminalNodeId) {
  await clearHostMessages();

  await ensureAgentStopped(agentNodeId);
  await ensureTerminalStopped(terminalNodeId);

  await dispatchWebviewMessage({
    type: 'webview/startExecutionSession',
    payload: {
      nodeId: agentNodeId,
      kind: 'agent',
      cols: 90,
      rows: 28,
      provider: 'codex'
    }
  });
  await dispatchWebviewMessage({
    type: 'webview/startExecutionSession',
    payload: {
      nodeId: terminalNodeId,
      kind: 'terminal',
      cols: 90,
      rows: 28
    }
  });

  await waitForAgentLive(agentNodeId);
  await waitForTerminalLive(terminalNodeId);

  let snapshot = await simulateRuntimeReload();
  let agentNode = findNodeById(snapshot, agentNodeId);
  let terminalNode = findNodeById(snapshot, terminalNodeId);

  assert.strictEqual(agentNode.status, 'resume-ready');
  assert.strictEqual(agentNode.metadata.agent.pendingLaunch, 'resume');
  assert.strictEqual(terminalNode.status, 'interrupted');
  assert.strictEqual(terminalNode.metadata.terminal.liveSession, false);

  snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentAgent = currentSnapshot.state.nodes.find((node) => node.id === agentNodeId);
    return Boolean(
      currentAgent?.metadata?.agent?.liveSession && currentAgent.status === 'resuming'
    );
  }, 20000);

  await dispatchWebviewMessage({
    type: 'webview/executionInput',
    payload: {
      nodeId: agentNodeId,
      kind: 'agent',
      data: 'burst 1\r'
    }
  });

  snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentAgent = currentSnapshot.state.nodes.find((node) => node.id === agentNodeId);
    return Boolean(currentAgent?.metadata?.agent?.liveSession && currentAgent.status === 'running');
  }, 20000);

  agentNode = findNodeById(snapshot, agentNodeId);
  assert.strictEqual(agentNode.status, 'running');

  snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentAgent = currentSnapshot.state.nodes.find((node) => node.id === agentNodeId);
    return Boolean(
      currentAgent?.metadata?.agent?.liveSession &&
        currentAgent.status === 'waiting-input' &&
        currentAgent.metadata?.agent?.recentOutput?.includes('[fake-agent] resumed session') &&
        currentAgent.metadata?.agent?.recentOutput?.includes('[fake-agent] burst 001')
    );
  }, 20000);

  agentNode = findNodeById(snapshot, agentNodeId);
  assert.strictEqual(agentNode.status, 'waiting-input');
  assert.ok(agentNode.metadata.agent.recentOutput.includes('[fake-agent] resumed session'));
  assert.ok(agentNode.metadata.agent.recentOutput.includes('[fake-agent] burst 001'));

  await dispatchWebviewMessage({
    type: 'webview/executionInput',
    payload: {
      nodeId: agentNodeId,
      kind: 'agent',
      data: 'exit 19\r'
    }
  });

  snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentAgent = currentSnapshot.state.nodes.find((node) => node.id === agentNodeId);
    return Boolean(
      currentAgent &&
        !currentAgent.metadata?.agent?.liveSession &&
        (currentAgent.status === 'error' || currentAgent.status === 'resume-failed')
    );
  });

  agentNode = findNodeById(snapshot, agentNodeId);
  assert.strictEqual(agentNode.status, 'error');
  assert.strictEqual(agentNode.metadata.agent.lastExitCode, 19);
  assert.match(agentNode.summary, /退出码 19/);

  await dispatchWebviewMessage({
    type: 'webview/startExecutionSession',
    payload: {
      nodeId: terminalNodeId,
      kind: 'terminal',
      cols: 90,
      rows: 28
    }
  });
  await waitForTerminalLive(terminalNodeId);
}

async function verifyLiveSessionCutoverAndReload(terminalNodeId) {
  const editorMarker = 'LIVE_CUTOVER_EDITOR';
  const panelMarker = 'LIVE_CUTOVER_PANEL';
  const reloadMarker = 'LIVE_CUTOVER_RELOAD';
  const returnMarker = 'LIVE_CUTOVER_RETURN';

  await clearHostMessages();
  await dispatchWebviewMessage({
    type: 'webview/startExecutionSession',
    payload: {
      nodeId: terminalNodeId,
      kind: 'terminal',
      cols: 96,
      rows: 28
    }
  });

  await waitForSnapshot((currentSnapshot) => {
    const currentNode = currentSnapshot.state.nodes.find((node) => node.id === terminalNodeId);
    return Boolean(currentNode?.metadata?.terminal?.liveSession && currentNode.status === 'live');
  });

  await dispatchWebviewMessage({
    type: 'webview/executionInput',
    payload: {
      nodeId: terminalNodeId,
      kind: 'terminal',
      data: `echo ${editorMarker}\r`
    }
  });
  await waitForSnapshot((currentSnapshot) => {
    const currentNode = currentSnapshot.state.nodes.find((node) => node.id === terminalNodeId);
    return Boolean(currentNode?.metadata?.terminal?.recentOutput?.includes(editorMarker));
  });

  await clearHostMessages();
  await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInPanel);
  await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'panel', 20000);

  let snapshot = await getDebugSnapshot();
  assert.strictEqual(snapshot.activeSurface, 'panel');
  assert.strictEqual(snapshot.surfaceReady.panel, true);

  await waitForHostMessages((messages) =>
    messages.some(
      (message) =>
        message.type === 'host/executionSnapshot' &&
        message.payload.kind === 'terminal' &&
        message.payload.nodeId === terminalNodeId &&
        message.payload.liveSession === true
    )
  );

  await dispatchWebviewMessage(
    {
      type: 'webview/executionInput',
      payload: {
        nodeId: terminalNodeId,
        kind: 'terminal',
        data: `echo ${panelMarker}\r`
      }
    },
    'panel'
  );
  await waitForSnapshot((currentSnapshot) => {
    const currentNode = currentSnapshot.state.nodes.find((node) => node.id === terminalNodeId);
    return Boolean(currentNode?.metadata?.terminal?.recentOutput?.includes(panelMarker));
  });

  snapshot = await reloadPersistedState();
  assert.strictEqual(snapshot.activeSurface, 'panel');
  assert.strictEqual(findNodeById(snapshot, terminalNodeId).metadata.terminal.liveSession, true);
  assert.strictEqual(findNodeById(snapshot, terminalNodeId).status, 'live');

  await dispatchWebviewMessage(
    {
      type: 'webview/executionInput',
      payload: {
        nodeId: terminalNodeId,
        kind: 'terminal',
        data: `echo ${reloadMarker}\r`
      }
    },
    'panel'
  );
  await waitForSnapshot((currentSnapshot) => {
    const currentNode = currentSnapshot.state.nodes.find((node) => node.id === terminalNodeId);
    return Boolean(currentNode?.metadata?.terminal?.recentOutput?.includes(reloadMarker));
  });

  await clearHostMessages();
  await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInEditor);
  await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'editor', 20000);

  await waitForHostMessages((messages) =>
    messages.some(
      (message) =>
        message.type === 'host/executionSnapshot' &&
        message.payload.kind === 'terminal' &&
        message.payload.nodeId === terminalNodeId &&
        message.payload.liveSession === true
    )
  );

  await dispatchWebviewMessage(
    {
      type: 'webview/executionInput',
      payload: {
        nodeId: terminalNodeId,
        kind: 'terminal',
        data: `echo ${returnMarker}\r`
      }
    },
    'editor'
  );
  snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentNode = currentSnapshot.state.nodes.find((node) => node.id === terminalNodeId);
    return Boolean(currentNode?.metadata?.terminal?.recentOutput?.includes(returnMarker));
  });
  assert.strictEqual(findNodeById(snapshot, terminalNodeId).metadata.terminal.liveSession, true);

  await dispatchWebviewMessage({
    type: 'webview/stopExecutionSession',
    payload: {
      nodeId: terminalNodeId,
      kind: 'terminal'
    }
  });
  snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentNode = currentSnapshot.state.nodes.find((node) => node.id === terminalNodeId);
    return Boolean(currentNode && currentNode.status === 'closed' && !currentNode.metadata?.terminal?.liveSession);
  });
  assert.ok(findNodeById(snapshot, terminalNodeId).metadata.terminal.recentOutput.includes(returnMarker));
}

async function verifyPtyRobustness(agentNodeId, terminalNodeId) {
  await clearHostMessages();
  await ensureAgentStopped(agentNodeId);
  await ensureTerminalStopped(terminalNodeId);
  await clearHostMessages();

  await dispatchWebviewMessage({
    type: 'webview/startExecutionSession',
    payload: {
      nodeId: agentNodeId,
      kind: 'agent',
      cols: 90,
      rows: 28,
      provider: 'codex'
    }
  });
  await waitForSnapshot((currentSnapshot) => {
    const currentAgent = currentSnapshot.state.nodes.find((node) => node.id === agentNodeId);
    return Boolean(currentAgent?.metadata?.agent?.liveSession);
  });

  await dispatchWebviewMessage({
    type: 'webview/executionInput',
    payload: {
      nodeId: agentNodeId,
      kind: 'agent',
      data: 'burst 80\r'
    }
  });
  let snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentAgent = currentSnapshot.state.nodes.find((node) => node.id === agentNodeId);
    return Boolean(currentAgent?.metadata?.agent?.recentOutput?.includes('[fake-agent] burst 080'));
  });
  assert.ok(findNodeById(snapshot, agentNodeId).metadata.agent.recentOutput.includes('[fake-agent] burst 080'));

  await dispatchWebviewMessage({
    type: 'webview/executionInput',
    payload: {
      nodeId: agentNodeId,
      kind: 'agent',
      data: 'exit 17\r'
    }
  });
  snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentAgent = currentSnapshot.state.nodes.find((node) => node.id === agentNodeId);
    return Boolean(currentAgent?.status === 'error' && currentAgent.metadata?.agent?.lastExitCode === 17);
  });
  let agentNode = findNodeById(snapshot, agentNodeId);
  assert.strictEqual(agentNode.metadata.agent.lastExitCode, 17);
  assert.match(agentNode.summary, /退出码 17/);

  await dispatchWebviewMessage({
    type: 'webview/startExecutionSession',
    payload: {
      nodeId: agentNodeId,
      kind: 'agent',
      cols: 88,
      rows: 28,
      provider: 'codex'
    }
  });
  await waitForSnapshot((currentSnapshot) => {
    const currentAgent = currentSnapshot.state.nodes.find((node) => node.id === agentNodeId);
    return Boolean(currentAgent?.metadata?.agent?.liveSession);
  });
  await dispatchWebviewMessage({
    type: 'webview/stopExecutionSession',
    payload: {
      nodeId: agentNodeId,
      kind: 'agent'
    }
  });
  await waitForSnapshot((currentSnapshot) => {
    const currentAgent = currentSnapshot.state.nodes.find((node) => node.id === agentNodeId);
    return Boolean(currentAgent?.status === 'stopped' && !currentAgent.metadata?.agent?.liveSession);
  });

  await clearHostMessages();
  await dispatchWebviewMessage({
    type: 'webview/startExecutionSession',
    payload: {
      nodeId: agentNodeId,
      kind: 'agent',
      cols: 92,
      rows: 28,
      provider: 'codex'
    }
  });
  await dispatchWebviewMessage({
    type: 'webview/startExecutionSession',
    payload: {
      nodeId: terminalNodeId,
      kind: 'terminal',
      cols: 92,
      rows: 28
    }
  });
  snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentAgent = currentSnapshot.state.nodes.find((node) => node.id === agentNodeId);
    const currentTerminal = currentSnapshot.state.nodes.find((node) => node.id === terminalNodeId);
    return Boolean(
      currentAgent?.metadata?.agent?.liveSession &&
        currentTerminal?.metadata?.terminal?.liveSession
    );
  });
  agentNode = findNodeById(snapshot, agentNodeId);
  const terminalNode = findNodeById(snapshot, terminalNodeId);
  assert.strictEqual(agentNode.metadata.agent.liveSession, true);
  assert.strictEqual(terminalNode.metadata.terminal.liveSession, true);

  await requestExecutionSnapshot('agent', agentNodeId);
  await requestExecutionSnapshot('terminal', terminalNodeId);
  await dispatchWebviewMessage({
    type: 'webview/executionInput',
    payload: {
      nodeId: agentNodeId,
      kind: 'agent',
      data: 'hello concurrency\r'
    }
  });
  await dispatchWebviewMessage({
    type: 'webview/executionInput',
    payload: {
      nodeId: terminalNodeId,
      kind: 'terminal',
      data: 'echo TERMINAL_CONCURRENCY\r'
    }
  });
  snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentAgent = currentSnapshot.state.nodes.find((node) => node.id === agentNodeId);
    const currentTerminal = currentSnapshot.state.nodes.find((node) => node.id === terminalNodeId);
    return Boolean(
      currentAgent?.metadata?.agent?.recentOutput?.includes('[fake-agent] hello concurrency') &&
        currentTerminal?.metadata?.terminal?.recentOutput?.includes('TERMINAL_CONCURRENCY')
    );
  });
  assert.ok(findNodeById(snapshot, agentNodeId).metadata.agent.recentOutput.includes('[fake-agent] hello concurrency'));
  assert.ok(findNodeById(snapshot, terminalNodeId).metadata.terminal.recentOutput.includes('TERMINAL_CONCURRENCY'));

  const hostMessages = await getHostMessages();
  assert.ok(
    hostMessages.some(
      (message) =>
        message.type === 'host/executionSnapshot' &&
        message.payload.nodeId === agentNodeId &&
        message.payload.kind === 'agent'
    )
  );
  assert.ok(
    hostMessages.some(
      (message) =>
        message.type === 'host/executionSnapshot' &&
        message.payload.nodeId === terminalNodeId &&
        message.payload.kind === 'terminal'
    )
  );

  await dispatchWebviewMessage({
    type: 'webview/stopExecutionSession',
    payload: {
      nodeId: agentNodeId,
      kind: 'agent'
    }
  });
  await dispatchWebviewMessage({
    type: 'webview/stopExecutionSession',
    payload: {
      nodeId: terminalNodeId,
      kind: 'terminal'
    }
  });
  snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentAgent = currentSnapshot.state.nodes.find((node) => node.id === agentNodeId);
    const currentTerminal = currentSnapshot.state.nodes.find((node) => node.id === terminalNodeId);
    return Boolean(
      currentAgent?.status === 'stopped' &&
        !currentAgent.metadata?.agent?.liveSession &&
        currentTerminal?.status === 'closed' &&
        !currentTerminal.metadata?.terminal?.liveSession
    );
  });
  assert.strictEqual(findNodeById(snapshot, agentNodeId).status, 'stopped');
  assert.strictEqual(findNodeById(snapshot, terminalNodeId).status, 'closed');
}

async function verifyFailurePaths(agentNodeId, terminalNodeId, noteNodeId) {
  await clearHostMessages();
  const diagnosticStartIndex = (await getDiagnosticEvents()).length;

  await performWebviewDomAction({
    kind: 'selectNodeOption',
    nodeId: agentNodeId,
    field: 'provider',
    value: 'claude'
  });
  let probe = await waitForWebviewProbe((currentProbe) => {
    const currentAgent = currentProbe.nodes.find((node) => node.nodeId === agentNodeId);
    return Boolean(currentAgent?.providerValue === 'claude');
  });
  assert.strictEqual(probe.nodes.find((node) => node.nodeId === agentNodeId)?.providerValue, 'claude');

  await performWebviewDomAction({
    kind: 'clickNodeActionButton',
    nodeId: agentNodeId,
    label: '重启'
  });

  let snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentNode = currentSnapshot.state.nodes.find((node) => node.id === agentNodeId);
    return Boolean(currentNode?.status === 'error');
  });
  let agentNode = findNodeById(snapshot, agentNodeId);
  assert.ok(
    /没有找到 Claude Code 命令/.test(agentNode.summary) ||
      /Claude Code .*No such file or directory/.test(agentNode.summary)
  );
  assert.strictEqual(agentNode.metadata.agent.liveSession, false);

  const failureDiagnostics = (await getDiagnosticEvents()).slice(diagnosticStartIndex);
  assert.ok(
    failureDiagnostics.some(
      (event) =>
        event.kind === 'execution/startRequested' &&
        event.detail?.kind === 'agent' &&
        event.detail?.nodeId === agentNodeId &&
        event.detail?.provider === 'claude'
    )
  );

  let hostMessages = await getHostMessages();
  assert.ok(
    hostMessages.some(
      (message) =>
        message.type === 'host/error' &&
        (/没有找到 Claude Code 命令/.test(message.payload.message) ||
          /Claude Code .*No such file or directory/.test(message.payload.message))
    )
  );

  await clearHostMessages();
  await dispatchWebviewMessage({
    type: 'webview/startExecutionSession',
    payload: {
      nodeId: 'agent-missing',
      kind: 'agent',
      cols: 80,
      rows: 24,
      provider: 'codex'
    }
  });
  await dispatchWebviewMessage({
    type: 'webview/startExecutionSession',
    payload: {
      nodeId: 'terminal-missing',
      kind: 'terminal',
      cols: 80,
      rows: 24
    }
  });
  await dispatchWebviewMessage({
    type: 'webview/deleteNode',
    payload: {
      nodeId: 'note-missing'
    }
  });

  hostMessages = await getHostMessages();
  assert.ok(
    hostMessages.some(
      (message) =>
        message.type === 'host/error' &&
        message.payload.message === '未找到可启动的 Agent 节点。'
    )
  );
  assert.ok(
    hostMessages.some(
      (message) =>
        message.type === 'host/error' &&
        message.payload.message === '未找到可启动的终端节点。'
    )
  );
  assert.ok(
    hostMessages.some(
      (message) =>
        message.type === 'host/error' &&
        message.payload.message === '未找到可删除的节点。'
    )
  );

  snapshot = await getDebugSnapshot();
  assert.strictEqual(findNodeById(snapshot, agentNodeId).title, REAL_DOM_AGENT_TITLE);
  assert.strictEqual(findNodeById(snapshot, terminalNodeId).title, REAL_DOM_TERMINAL_TITLE);
  assert.strictEqual(findNodeById(snapshot, noteNodeId).title, REAL_DOM_NOTE_TITLE);
  assert.strictEqual(findNodeById(snapshot, noteNodeId).metadata.note.content, REAL_DOM_NOTE_BODY);
  assert.strictEqual(findNodeById(snapshot, terminalNodeId).status, 'closed');
}

async function verifyEmbeddedTerminalThemeFollowWorkbench(agentNodeId, terminalNodeId) {
  const workbenchConfiguration = vscode.workspace.getConfiguration('workbench');
  const originalColorTheme = workbenchConfiguration.inspect('colorTheme')?.globalValue;

  try {
    await verifyEmbeddedTerminalThemeOnSurface('panel', agentNodeId, terminalNodeId);
    await verifyEmbeddedTerminalThemeOnSurface('editor', agentNodeId, terminalNodeId);
  } finally {
    await setWorkbenchColorTheme(originalColorTheme);
    await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInEditor);
    await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'editor', 20000);
  }
}

async function verifyEmbeddedTerminalThemeOnSurface(surface, agentNodeId, terminalNodeId) {
  if (surface === 'panel') {
    await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInPanel);
  } else {
    await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInEditor);
  }
  await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, surface, 20000);

  const expectationsByTheme = BUILTIN_WORKBENCH_TERMINAL_THEME_EXPECTATIONS[surface];
  for (const [themeName, expectedTheme] of Object.entries(expectationsByTheme)) {
    await setWorkbenchColorTheme(themeName);

    const probe = await waitForWebviewProbeOnSurface(surface, (currentProbe) => {
      const agentNode = currentProbe.nodes.find((node) => node.nodeId === agentNodeId);
      const terminalNode = currentProbe.nodes.find((node) => node.nodeId === terminalNodeId);

      return (
        terminalThemeMatches(agentNode?.terminalTheme, expectedTheme) &&
        terminalThemeMatches(terminalNode?.terminalTheme, expectedTheme)
      );
    }, 15000);

    const agentTheme = probe.nodes.find((node) => node.nodeId === agentNodeId)?.terminalTheme;
    const terminalTheme = probe.nodes.find((node) => node.nodeId === terminalNodeId)?.terminalTheme;
    assertTerminalThemeMatches(agentTheme, expectedTheme, `${surface}/${themeName}/agent`);
    assertTerminalThemeMatches(terminalTheme, expectedTheme, `${surface}/${themeName}/terminal`);
  }
}

async function verifyPersistenceAndRecovery(noteNodeId, agentNodeId, terminalNodeId) {
  await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInPanel);
  await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'panel', 20000);

  let snapshot = await reloadPersistedState();
  assert.strictEqual(snapshot.activeSurface, 'panel');
  assert.strictEqual(snapshot.sidebar.surfaceLocation, 'panel');
  assert.strictEqual(snapshot.surfaceReady.panel, true);
  assert.strictEqual(snapshot.state.nodes.length, 3);
  assert.strictEqual(findNodeById(snapshot, agentNodeId).title, REAL_DOM_AGENT_TITLE);
  assert.strictEqual(findNodeById(snapshot, terminalNodeId).title, REAL_DOM_TERMINAL_TITLE);
  assert.strictEqual(findNodeById(snapshot, noteNodeId).title, REAL_DOM_NOTE_TITLE);
  assert.strictEqual(findNodeById(snapshot, noteNodeId).metadata.note.content, REAL_DOM_NOTE_BODY);
  assert.strictEqual(findNodeById(snapshot, agentNodeId).status, 'error');
  assert.strictEqual(findNodeById(snapshot, terminalNodeId).status, 'closed');
}

async function verifyStandbySurfaceIgnoresMessages(noteNodeId) {
  await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInEditor);
  await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'editor', 20000);
  await clearHostMessages();

  const beforeSnapshot = await getDebugSnapshot();
  const beforeNote = findNodeById(beforeSnapshot, noteNodeId);

  await dispatchWebviewMessage(
    {
      type: 'webview/updateNodeTitle',
      payload: {
        nodeId: noteNodeId,
        title: 'Standby Should Not Win'
      }
    },
    'panel'
  );
  await dispatchWebviewMessage(
    {
      type: 'webview/updateNoteNode',
      payload: {
        nodeId: noteNodeId,
        content: 'This payload comes from a standby surface.'
      }
    },
    'panel'
  );
  await dispatchWebviewMessage({ type: 'webview/not-a-real-message' }, 'panel');

  const afterSnapshot = await getDebugSnapshot();
  const afterNote = findNodeById(afterSnapshot, noteNodeId);
  assert.strictEqual(afterNote.title, beforeNote.title);
  assert.strictEqual(afterNote.status, beforeNote.status);
  assert.strictEqual(afterNote.metadata.note.content, beforeNote.metadata.note.content);

  const hostMessages = await getHostMessages();
  assert.strictEqual(hostMessages.length, 0);
}

async function verifyPendingWebviewRequestFaultInjection(noteNodeId) {
  await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInEditor);
  await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'editor', 20000);

  let snapshot = await getDebugSnapshot();
  assert.strictEqual(findNodeById(snapshot, noteNodeId).metadata.note.content, REAL_DOM_NOTE_BODY);

  const domActionDiagnosticStartIndex = (await getDiagnosticEvents()).length;
  const pendingDomAction = performWebviewDomAction(
    {
      kind: 'setNodeTextField',
      nodeId: noteNodeId,
      field: 'body',
      value: DISPOSED_EDITOR_NOTE_BODY,
      delayMs: WEBVIEW_FAULT_INJECTION_DELAY_MS
    },
    'editor',
    WEBVIEW_FAULT_INJECTION_DELAY_MS + 2000
  );
  await sleep(150);
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  await assert.rejects(pendingDomAction, /编辑区 Webview 已被关闭/);

  snapshot = await waitForSnapshot((currentSnapshot) => currentSnapshot.surfaceReady.editor === false);
  assert.strictEqual(findNodeById(snapshot, noteNodeId).metadata.note.content, REAL_DOM_NOTE_BODY);
  let raceDiagnostics = (await getDiagnosticEvents()).slice(domActionDiagnosticStartIndex);
  assert.ok(
    raceDiagnostics.some(
      (event) => event.kind === 'surface/disposed' && event.detail?.surface === 'editor'
    )
  );

  await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInEditor);
  await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'editor', 20000);
  let probe = await waitForWebviewProbe((currentProbe) => {
    const currentNote = currentProbe.nodes.find((node) => node.nodeId === noteNodeId);
    return Boolean(currentNote && currentNote.bodyValue === REAL_DOM_NOTE_BODY);
  });
  assert.strictEqual(
    probe.nodes.find((node) => node.nodeId === noteNodeId)?.bodyValue,
    REAL_DOM_NOTE_BODY
  );

  const probeDiagnosticStartIndex = (await getDiagnosticEvents()).length;
  const pendingProbe = captureWebviewProbe(
    'editor',
    WEBVIEW_FAULT_INJECTION_DELAY_MS + 2000,
    WEBVIEW_FAULT_INJECTION_DELAY_MS
  );
  await sleep(150);
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  await assert.rejects(pendingProbe, /编辑区 Webview 已被关闭/);

  snapshot = await waitForSnapshot((currentSnapshot) => currentSnapshot.surfaceReady.editor === false);
  assert.strictEqual(findNodeById(snapshot, noteNodeId).metadata.note.content, REAL_DOM_NOTE_BODY);
  raceDiagnostics = (await getDiagnosticEvents()).slice(probeDiagnosticStartIndex);
  assert.ok(
    raceDiagnostics.some(
      (event) => event.kind === 'surface/disposed' && event.detail?.surface === 'editor'
    )
  );

  await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInEditor);
  await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'editor', 20000);
  probe = await waitForWebviewProbe((currentProbe) => {
    const currentNote = currentProbe.nodes.find((node) => node.nodeId === noteNodeId);
    return Boolean(currentNote && currentNote.bodyValue === REAL_DOM_NOTE_BODY);
  });
  assert.strictEqual(
    probe.nodes.find((node) => node.nodeId === noteNodeId)?.bodyValue,
    REAL_DOM_NOTE_BODY
  );
}

async function verifyStopVsQueuedExitRace(agentNodeId) {
  await clearHostMessages();
  const diagnosticStartIndex = (await getDiagnosticEvents()).length;

  await dispatchWebviewMessage({
    type: 'webview/startExecutionSession',
    payload: {
      nodeId: agentNodeId,
      kind: 'agent',
      cols: 88,
      rows: 28,
      provider: 'codex'
    }
  });
  await waitForSnapshot((currentSnapshot) => {
    const currentAgent = currentSnapshot.state.nodes.find((node) => node.id === agentNodeId);
    return Boolean(currentAgent?.metadata?.agent?.liveSession);
  });

  await dispatchWebviewMessage({
    type: 'webview/executionInput',
    payload: {
      nodeId: agentNodeId,
      kind: 'agent',
      data: `sleep ${AGENT_STOP_RACE_SLEEP_SECONDS}\rexit 9\r`
    }
  });
  await waitForSnapshot((currentSnapshot) => {
    const currentAgent = currentSnapshot.state.nodes.find((node) => node.id === agentNodeId);
    return Boolean(currentAgent?.metadata?.agent?.recentOutput?.includes(`[fake-agent] sleeping ${AGENT_STOP_RACE_SLEEP_SECONDS}s`));
  });

  await sleep(150);
  await dispatchWebviewMessage({
    type: 'webview/stopExecutionSession',
    payload: {
      nodeId: agentNodeId,
      kind: 'agent'
    }
  });

  const snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentAgent = currentSnapshot.state.nodes.find((node) => node.id === agentNodeId);
    return Boolean(currentAgent && currentAgent.status === 'stopped' && !currentAgent.metadata?.agent?.liveSession);
  });
  const agentNode = findNodeById(snapshot, agentNodeId);
  assert.strictEqual(agentNode.status, 'stopped');
  assert.strictEqual(agentNode.metadata.agent.liveSession, false);
  assert.match(agentNode.summary, /已停止 Codex 会话/);

  const raceDiagnostics = (await getDiagnosticEvents()).slice(diagnosticStartIndex);
  const scopedDiagnostics = raceDiagnostics.filter(
    (event) => event.detail?.kind === 'agent' && event.detail?.nodeId === agentNodeId
  );
  assert.strictEqual(
    scopedDiagnostics.filter((event) => event.kind === 'execution/stopRequested').length,
    1
  );
  const exitEvents = scopedDiagnostics.filter((event) => event.kind === 'execution/exited');
  assert.strictEqual(exitEvents.length, 1);
  assert.strictEqual(exitEvents[0].detail?.stopRequested, true);
  assert.strictEqual(exitEvents[0].detail?.status, 'stopped');

  const hostMessages = await getHostMessages();
  assert.strictEqual(
    hostMessages.filter(
      (message) =>
        message.type === 'host/executionExit' &&
        message.payload.kind === 'agent' &&
        message.payload.nodeId === agentNodeId
    ).length,
    1
  );
}

async function verifyLiveRuntimePersistence(agentNodeId, terminalNodeId) {
  await setRuntimePersistenceEnabled(true);

  try {
    await clearHostMessages();
    await ensureAgentStopped(agentNodeId);
    await ensureTerminalStopped(terminalNodeId);

    await dispatchWebviewMessage({
      type: 'webview/startExecutionSession',
      payload: {
        nodeId: agentNodeId,
        kind: 'agent',
        cols: 92,
        rows: 28,
        provider: 'codex'
      }
    });
    await dispatchWebviewMessage({
      type: 'webview/startExecutionSession',
      payload: {
        nodeId: terminalNodeId,
        kind: 'terminal',
        cols: 92,
        rows: 28
      }
    });

    await waitForSnapshot((currentSnapshot) => {
      const currentAgent = currentSnapshot.state.nodes.find((node) => node.id === agentNodeId);
      return Boolean(
        currentAgent?.metadata?.agent?.liveSession &&
          currentAgent.metadata.agent.attachmentState === 'attached-live' &&
          currentAgent.metadata.agent.runtimeSessionId &&
          currentAgent.status === 'starting'
      );
    }, 20000);
    await waitForTerminalLive(terminalNodeId);

    await dispatchWebviewMessage({
      type: 'webview/executionInput',
      payload: {
        nodeId: agentNodeId,
        kind: 'agent',
        data: 'sleep 1\rburst 3\r'
      }
    });

    let snapshot = await waitForSnapshot((currentSnapshot) => {
      const currentAgent = currentSnapshot.state.nodes.find((node) => node.id === agentNodeId);
      return Boolean(currentAgent?.metadata?.agent?.liveSession && currentAgent.status === 'running');
    }, 20000);
    let agentNode = findNodeById(snapshot, agentNodeId);
    assert.strictEqual(agentNode.status, 'running');

    await sleep(500);
    snapshot = await getDebugSnapshot();
    agentNode = findNodeById(snapshot, agentNodeId);
    assert.strictEqual(agentNode.status, 'running');

    await dispatchWebviewMessage({
      type: 'webview/executionInput',
      payload: {
        nodeId: terminalNodeId,
        kind: 'terminal',
        data: 'sleep 1; echo LIVE_RUNTIME_TERMINAL\r'
      }
    });

    snapshot = await simulateRuntimeReload();
    agentNode = findNodeById(snapshot, agentNodeId);
    let terminalNode = findNodeById(snapshot, terminalNodeId);

    assert.strictEqual(agentNode.status, 'reattaching');
    assert.strictEqual(agentNode.metadata.agent.attachmentState, 'reattaching');
    assert.strictEqual(agentNode.metadata.agent.persistenceMode, 'live-runtime');
    assert.strictEqual(terminalNode.status, 'reattaching');
    assert.strictEqual(terminalNode.metadata.terminal.attachmentState, 'reattaching');
    assert.strictEqual(terminalNode.metadata.terminal.persistenceMode, 'live-runtime');

    snapshot = await waitForSnapshot((currentSnapshot) => {
      const currentAgent = currentSnapshot.state.nodes.find((node) => node.id === agentNodeId);
      const currentTerminal = currentSnapshot.state.nodes.find((node) => node.id === terminalNodeId);
      return Boolean(
        currentAgent?.metadata?.agent?.liveSession &&
          currentAgent.metadata?.agent?.attachmentState === 'attached-live' &&
          currentAgent.metadata?.agent?.recentOutput?.includes('[fake-agent] burst 003') &&
          currentTerminal?.metadata?.terminal?.liveSession &&
          currentTerminal.metadata?.terminal?.attachmentState === 'attached-live' &&
          currentTerminal.metadata?.terminal?.recentOutput?.includes('LIVE_RUNTIME_TERMINAL')
      );
    }, 20000);

    agentNode = findNodeById(snapshot, agentNodeId);
    terminalNode = findNodeById(snapshot, terminalNodeId);

    assert.strictEqual(agentNode.metadata.agent.liveSession, true);
    assert.strictEqual(agentNode.metadata.agent.attachmentState, 'attached-live');
    assert.ok(agentNode.metadata.agent.recentOutput.includes('[fake-agent] burst 003'));
    assert.strictEqual(terminalNode.metadata.terminal.liveSession, true);
    assert.strictEqual(terminalNode.metadata.terminal.attachmentState, 'attached-live');
    assert.ok(terminalNode.metadata.terminal.recentOutput.includes('LIVE_RUNTIME_TERMINAL'));

    await ensureAgentStopped(agentNodeId);
    await ensureTerminalStopped(terminalNodeId);

    snapshot = await waitForSnapshot((currentSnapshot) => {
      const currentAgent = currentSnapshot.state.nodes.find((node) => node.id === agentNodeId);
      const currentTerminal = currentSnapshot.state.nodes.find((node) => node.id === terminalNodeId);
      return Boolean(
        currentAgent &&
          !currentAgent.metadata?.agent?.liveSession &&
          currentAgent.status === 'stopped' &&
          currentTerminal &&
          !currentTerminal.metadata?.terminal?.liveSession &&
          currentTerminal.status === 'closed'
      );
    });

    agentNode = findNodeById(snapshot, agentNodeId);
    terminalNode = findNodeById(snapshot, terminalNodeId);
    assert.strictEqual(agentNode.status, 'stopped');
    assert.strictEqual(terminalNode.status, 'closed');
  } finally {
    await setRuntimePersistenceEnabled(false);
  }
}

async function verifyLiveRuntimeResumeExitClassification(agentNodeId) {
  await setRuntimePersistenceEnabled(true);

  try {
    await clearHostMessages();
    await ensureAgentStopped(agentNodeId);

    await dispatchWebviewMessage({
      type: 'webview/startExecutionSession',
      payload: {
        nodeId: agentNodeId,
        kind: 'agent',
        cols: 92,
        rows: 28,
        provider: 'codex',
        resume: true
      }
    });

    let snapshot = await waitForSnapshot((currentSnapshot) => {
      const currentAgent = currentSnapshot.state.nodes.find((node) => node.id === agentNodeId);
      return Boolean(
        currentAgent?.metadata?.agent?.liveSession && currentAgent.status === 'resuming'
      );
    }, 20000);

    await dispatchWebviewMessage({
      type: 'webview/executionInput',
      payload: {
        nodeId: agentNodeId,
        kind: 'agent',
        data: 'burst 1\r'
      }
    });

    snapshot = await waitForSnapshot((currentSnapshot) => {
      const currentAgent = currentSnapshot.state.nodes.find((node) => node.id === agentNodeId);
      return Boolean(currentAgent?.metadata?.agent?.liveSession && currentAgent.status === 'running');
    }, 20000);

    let agentNode = findNodeById(snapshot, agentNodeId);
    assert.strictEqual(agentNode.status, 'running');

    snapshot = await waitForSnapshot((currentSnapshot) => {
      const currentAgent = currentSnapshot.state.nodes.find((node) => node.id === agentNodeId);
      return Boolean(
        currentAgent?.metadata?.agent?.liveSession &&
          currentAgent.status === 'waiting-input' &&
          currentAgent.metadata?.agent?.recentOutput?.includes('[fake-agent] resumed session') &&
          currentAgent.metadata?.agent?.recentOutput?.includes('[fake-agent] burst 001')
      );
    }, 20000);

    agentNode = findNodeById(snapshot, agentNodeId);
    assert.strictEqual(agentNode.status, 'waiting-input');
    assert.ok(agentNode.metadata.agent.recentOutput.includes('[fake-agent] resumed session'));
    assert.ok(agentNode.metadata.agent.recentOutput.includes('[fake-agent] burst 001'));

    await dispatchWebviewMessage({
      type: 'webview/executionInput',
      payload: {
        nodeId: agentNodeId,
        kind: 'agent',
        data: 'exit 23\r'
      }
    });

    snapshot = await waitForSnapshot((currentSnapshot) => {
      const currentAgent = currentSnapshot.state.nodes.find((node) => node.id === agentNodeId);
      return Boolean(
        currentAgent &&
          !currentAgent.metadata?.agent?.liveSession &&
          (currentAgent.status === 'error' || currentAgent.status === 'resume-failed')
      );
    }, 20000);

    agentNode = findNodeById(snapshot, agentNodeId);
    assert.strictEqual(agentNode.status, 'error');
    assert.strictEqual(agentNode.metadata.agent.lastExitCode, 23);
    assert.match(agentNode.summary, /退出码 23/);
  } finally {
    await setRuntimePersistenceEnabled(false);
  }
}

async function verifyLiveRuntimeReconnectFallbackToResume(agentNodeId, terminalNodeId) {
  await setRuntimePersistenceEnabled(true);
  const diagnosticStartIndex = (await getDiagnosticEvents()).length;
  const baselineSnapshot = await getDebugSnapshot();
  const baselineAgent = findNodeById(baselineSnapshot, agentNodeId);
  const baselineTerminal = findNodeById(baselineSnapshot, terminalNodeId);
  let shouldRestoreBaseline = false;

  const fakeStorageDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dev-session-canvas-runtime-fallback-'));
  const fallbackSessionId = '44444444-4444-4444-8444-444444444444';

  try {
    await fs.writeFile(path.join(fakeStorageDir, 'last-session'), `${fallbackSessionId}\n`, 'utf8');

    const currentSnapshot = await getDebugSnapshot();
    const noteNode = findNodeByKind(currentSnapshot, 'note');
    const agentNode = findNodeById(currentSnapshot, agentNodeId);
    const terminalNode = findNodeById(currentSnapshot, terminalNodeId);

    let snapshot = await setPersistedState({
      version: 1,
      updatedAt: '2026-04-12T09:30:00.000Z',
      nodes: [
        {
          ...agentNode,
          status: 'reattaching',
          summary: '正在重新连接原 Agent live runtime。',
          metadata: {
            ...agentNode.metadata,
            agent: {
              ...agentNode.metadata.agent,
              provider: 'codex',
              lifecycle: 'waiting-input',
              persistenceMode: 'live-runtime',
              attachmentState: 'reattaching',
              liveSession: false,
              runtimeBackend: 'legacy-detached',
              runtimeGuarantee: 'best-effort',
              runtimeSessionId: 'missing-agent-runtime-session',
              resumeSupported: false,
              resumeStrategy: 'fake-provider',
              resumeSessionId: fallbackSessionId,
              resumeStoragePath: fakeStorageDir,
              pendingLaunch: undefined,
              lastRuntimeError: undefined,
              lastResumeError: undefined
            }
          }
        },
        {
          ...terminalNode,
          status: 'reattaching',
          summary: '正在重新连接原终端 live runtime。',
          metadata: {
            ...terminalNode.metadata,
            terminal: {
              ...terminalNode.metadata.terminal,
              lifecycle: 'live',
              persistenceMode: 'live-runtime',
              attachmentState: 'reattaching',
              liveSession: false,
              runtimeBackend: 'legacy-detached',
              runtimeGuarantee: 'best-effort',
              runtimeSessionId: 'missing-terminal-runtime-session',
              pendingLaunch: undefined,
              lastRuntimeError: undefined
            }
          }
        },
        noteNode
      ]
    });

    snapshot = await waitForSnapshot((currentState) => {
      const currentAgent = currentState.state.nodes.find((node) => node.id === agentNodeId);
      const currentTerminal = currentState.state.nodes.find((node) => node.id === terminalNodeId);
      return Boolean(
        currentAgent?.metadata?.agent?.liveSession &&
          currentAgent.status === 'waiting-input' &&
          currentAgent.metadata?.agent?.attachmentState === 'attached-live' &&
          currentAgent.metadata?.agent?.recentOutput?.includes('[fake-agent] resumed session') &&
          currentTerminal?.status === 'history-restored' &&
          currentTerminal.metadata?.terminal?.attachmentState === 'history-restored' &&
          currentTerminal.metadata?.terminal?.liveSession === false
      );
    }, 20000);

    const restoredAgent = findNodeById(snapshot, agentNodeId);
    const restoredTerminal = findNodeById(snapshot, terminalNodeId);
    assert.strictEqual(restoredAgent.metadata.agent.persistenceMode, 'live-runtime');
    assert.ok(restoredAgent.metadata.agent.runtimeSessionId);
    assert.strictEqual(restoredAgent.metadata.agent.resumeSupported, true);
    assert.ok(restoredAgent.metadata.agent.recentOutput.includes('[fake-agent] resumed session'));
    assert.strictEqual(restoredTerminal.metadata.terminal.liveSession, false);
    assert.match(restoredTerminal.summary, /runtime session/);
    assert.match(restoredTerminal.metadata.terminal.lastRuntimeError ?? '', /runtime session/);

    const reconnectDiagnostics = (await getDiagnosticEvents()).slice(diagnosticStartIndex);
    assert.ok(
      reconnectDiagnostics.some(
        (event) =>
          event.kind === 'agent/liveRuntimeReconnectFallbackToResume' &&
          event.detail?.nodeId === agentNodeId &&
          event.detail?.resumeSessionId === fallbackSessionId
      )
    );

    await ensureAgentStopped(agentNodeId);
    shouldRestoreBaseline = true;
  } finally {
    await setRuntimePersistenceEnabled(false);
    if (shouldRestoreBaseline) {
      await setPersistedState(baselineSnapshot.state);
      await waitForSnapshot((currentState) => {
        const currentAgent = currentState.state.nodes.find((node) => node.id === agentNodeId);
        const currentTerminal = currentState.state.nodes.find((node) => node.id === terminalNodeId);
        return Boolean(
          !currentAgent?.metadata?.agent?.liveSession &&
            currentAgent.metadata?.agent?.resumeSessionId === baselineAgent.metadata?.agent?.resumeSessionId &&
            currentAgent.metadata?.agent?.resumeStoragePath === baselineAgent.metadata?.agent?.resumeStoragePath &&
            !currentTerminal?.metadata?.terminal?.liveSession &&
            currentTerminal.metadata?.terminal?.recentOutput ===
              baselineTerminal.metadata?.terminal?.recentOutput
        );
      }, 20000);
    }
    await fs.rm(fakeStorageDir, { recursive: true, force: true });
  }
}

async function verifyHistoryRestoredResumeReadyIgnoresStaleResumeSupported(agentNodeId, terminalNodeId) {
  await setRuntimePersistenceEnabled(true);

  const baselineSnapshot = await getDebugSnapshot();
  const baselineAgent = findNodeById(baselineSnapshot, agentNodeId);
  const baselineTerminal = findNodeById(baselineSnapshot, terminalNodeId);
  let shouldRestoreBaseline = false;

  const fakeStorageDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dev-session-canvas-history-resume-'));
  const fallbackSessionId = '55555555-5555-4555-8555-555555555555';

  try {
    await fs.writeFile(path.join(fakeStorageDir, 'last-session'), `${fallbackSessionId}\n`, 'utf8');

    const currentSnapshot = await getDebugSnapshot();
    const noteNode = findNodeByKind(currentSnapshot, 'note');
    const agentNode = findNodeById(currentSnapshot, agentNodeId);
    const terminalNode = findNodeById(currentSnapshot, terminalNodeId);

    let snapshot = await setPersistedState({
      version: 1,
      updatedAt: '2026-04-12T09:40:00.000Z',
      nodes: [
        {
          ...agentNode,
          status: 'history-restored',
          summary: '原 Agent live runtime 已断开，将等待恢复。',
          metadata: {
            ...agentNode.metadata,
            agent: {
              ...agentNode.metadata.agent,
              provider: 'codex',
              lifecycle: 'resume-ready',
              persistenceMode: 'live-runtime',
              attachmentState: 'history-restored',
              liveSession: false,
              runtimeBackend: 'legacy-detached',
              runtimeGuarantee: 'best-effort',
              runtimeSessionId: undefined,
              resumeSupported: false,
              resumeStrategy: 'fake-provider',
              resumeSessionId: fallbackSessionId,
              resumeStoragePath: fakeStorageDir,
              pendingLaunch: 'resume',
              lastRuntimeError: '未找到 runtime session old-runtime-session。',
              lastResumeError: undefined
            }
          }
        },
        terminalNode,
        noteNode
      ]
    });

    let restoredAgent = findNodeById(snapshot, agentNodeId);
    assert.strictEqual(restoredAgent.status, 'resume-ready');
    assert.strictEqual(restoredAgent.metadata.agent.resumeSupported, true);

    snapshot = await waitForSnapshot((currentState) => {
      const currentAgent = currentState.state.nodes.find((node) => node.id === agentNodeId);
      return Boolean(
        currentAgent?.metadata?.agent?.liveSession &&
          currentAgent.status === 'waiting-input' &&
          currentAgent.metadata?.agent?.recentOutput?.includes('[fake-agent] resumed session')
      );
    }, 20000);

    restoredAgent = findNodeById(snapshot, agentNodeId);
    assert.strictEqual(restoredAgent.metadata.agent.resumeSupported, true);
    assert.ok(restoredAgent.metadata.agent.recentOutput.includes('[fake-agent] resumed session'));

    await ensureAgentStopped(agentNodeId);
    shouldRestoreBaseline = true;
  } finally {
    await setRuntimePersistenceEnabled(false);
    if (shouldRestoreBaseline) {
      await setPersistedState(baselineSnapshot.state);
      await waitForSnapshot((currentState) => {
        const currentAgent = currentState.state.nodes.find((node) => node.id === agentNodeId);
        const currentTerminal = currentState.state.nodes.find((node) => node.id === terminalNodeId);
        return Boolean(
          !currentAgent?.metadata?.agent?.liveSession &&
            currentAgent.metadata?.agent?.resumeSessionId === baselineAgent.metadata?.agent?.resumeSessionId &&
            currentAgent.metadata?.agent?.resumeStoragePath === baselineAgent.metadata?.agent?.resumeStoragePath &&
            !currentTerminal?.metadata?.terminal?.liveSession &&
            currentTerminal.metadata?.terminal?.recentOutput ===
              baselineTerminal.metadata?.terminal?.recentOutput
        );
      }, 20000);
    }
    await fs.rm(fakeStorageDir, { recursive: true, force: true });
  }
}

async function verifyImmediateReloadAfterLiveRuntimeLaunch(agentNodeId, terminalNodeId) {
  await setRuntimePersistenceEnabled(true);

  try {
    await clearHostMessages();
    await ensureAgentStopped(agentNodeId);
    await ensureTerminalStopped(terminalNodeId);

    await dispatchWebviewMessage({
      type: 'webview/startExecutionSession',
      payload: {
        nodeId: agentNodeId,
        kind: 'agent',
        cols: 92,
        rows: 28,
        provider: 'codex'
      }
    });
    await dispatchWebviewMessage({
      type: 'webview/startExecutionSession',
      payload: {
        nodeId: terminalNodeId,
        kind: 'terminal',
        cols: 92,
        rows: 28
      }
    });

    let snapshot = await simulateRuntimeReload();
    let agentNode = findNodeById(snapshot, agentNodeId);
    let terminalNode = findNodeById(snapshot, terminalNodeId);

    assert.notStrictEqual(agentNode.status, 'history-restored');
    assert.notStrictEqual(terminalNode.status, 'history-restored');
    assert.strictEqual(agentNode.metadata.agent.persistenceMode, 'live-runtime');
    assert.strictEqual(terminalNode.metadata.terminal.persistenceMode, 'live-runtime');

    snapshot = await waitForSnapshot((currentSnapshot) => {
      const currentAgent = currentSnapshot.state.nodes.find((node) => node.id === agentNodeId);
      const currentTerminal = currentSnapshot.state.nodes.find((node) => node.id === terminalNodeId);
      return Boolean(
        currentAgent?.metadata?.agent?.liveSession &&
          currentAgent.metadata?.agent?.attachmentState === 'attached-live' &&
          currentAgent.metadata?.agent?.runtimeSessionId &&
          currentTerminal?.metadata?.terminal?.liveSession &&
          currentTerminal.metadata?.terminal?.attachmentState === 'attached-live' &&
          currentTerminal.metadata?.terminal?.runtimeSessionId
      );
    }, 20000);

    agentNode = findNodeById(snapshot, agentNodeId);
    terminalNode = findNodeById(snapshot, terminalNodeId);

    assert.strictEqual(agentNode.metadata.agent.liveSession, true);
    assert.strictEqual(agentNode.metadata.agent.attachmentState, 'attached-live');
    assert.ok(agentNode.metadata.agent.runtimeSessionId);
    assert.strictEqual(terminalNode.metadata.terminal.liveSession, true);
    assert.strictEqual(terminalNode.metadata.terminal.attachmentState, 'attached-live');
    assert.ok(terminalNode.metadata.terminal.runtimeSessionId);

    await ensureAgentStopped(agentNodeId);
    await ensureTerminalStopped(terminalNodeId);
  } finally {
    await setRuntimePersistenceEnabled(false);
  }
}

async function verifyDisablingRuntimePersistenceStopsReattach(agentNodeId, terminalNodeId) {
  await setRuntimePersistenceEnabled(true);

  try {
    await clearHostMessages();
    await ensureAgentStopped(agentNodeId);
    await ensureTerminalStopped(terminalNodeId);

    await dispatchWebviewMessage({
      type: 'webview/startExecutionSession',
      payload: {
        nodeId: agentNodeId,
        kind: 'agent',
        cols: 92,
        rows: 28,
        provider: 'codex'
      }
    });
    await dispatchWebviewMessage({
      type: 'webview/startExecutionSession',
      payload: {
        nodeId: terminalNodeId,
        kind: 'terminal',
        cols: 92,
        rows: 28
      }
    });

    await waitForAgentLive(agentNodeId);
    await waitForTerminalLive(terminalNodeId);

    await dispatchWebviewMessage({
      type: 'webview/executionInput',
      payload: {
        nodeId: agentNodeId,
        kind: 'agent',
        data: 'echo SHOULD_NOT_REATTACH\r'
      }
    });
    await dispatchWebviewMessage({
      type: 'webview/executionInput',
      payload: {
        nodeId: terminalNodeId,
        kind: 'terminal',
        data: 'echo SHOULD_NOT_REATTACH\r'
      }
    });

    await setRuntimePersistenceEnabled(false);

    let snapshot = await simulateRuntimeReload();
    let agentNode = findNodeById(snapshot, agentNodeId);
    let terminalNode = findNodeById(snapshot, terminalNodeId);

    assert.strictEqual(agentNode.status, 'history-restored');
    assert.strictEqual(agentNode.metadata.agent.attachmentState, 'history-restored');
    assert.strictEqual(agentNode.metadata.agent.liveSession, false);
    assert.strictEqual(terminalNode.status, 'history-restored');
    assert.strictEqual(terminalNode.metadata.terminal.attachmentState, 'history-restored');
    assert.strictEqual(terminalNode.metadata.terminal.liveSession, false);

    await sleep(600);
    snapshot = await getDebugSnapshot();
    agentNode = findNodeById(snapshot, agentNodeId);
    terminalNode = findNodeById(snapshot, terminalNodeId);

    assert.strictEqual(agentNode.status, 'history-restored');
    assert.strictEqual(agentNode.metadata.agent.liveSession, false);
    assert.strictEqual(terminalNode.status, 'history-restored');
    assert.strictEqual(terminalNode.metadata.terminal.liveSession, false);
  } finally {
    await setRuntimePersistenceEnabled(false);
  }
}

async function verifyHostBoundaryFlushesRecentLocalState(agentNodeId, terminalNodeId) {
  await setRuntimePersistenceEnabled(false);
  await clearHostMessages();
  await ensureAgentStopped(agentNodeId);
  await ensureTerminalStopped(terminalNodeId);

  await dispatchWebviewMessage({
    type: 'webview/startExecutionSession',
    payload: {
      nodeId: agentNodeId,
      kind: 'agent',
      cols: 92,
      rows: 28,
      provider: 'codex'
    }
  });
  await dispatchWebviewMessage({
    type: 'webview/startExecutionSession',
    payload: {
      nodeId: terminalNodeId,
      kind: 'terminal',
      cols: 92,
      rows: 28
    }
  });

  await waitForAgentLive(agentNodeId);
  await waitForTerminalLive(terminalNodeId);
  await clearHostMessages();

  await dispatchWebviewMessage({
    type: 'webview/executionInput',
    payload: {
      nodeId: agentNodeId,
      kind: 'agent',
      data: `echo ${HOST_BOUNDARY_FLUSH_AGENT_MARKER}\r`
    }
  });
  await dispatchWebviewMessage({
    type: 'webview/executionInput',
    payload: {
      nodeId: terminalNodeId,
      kind: 'terminal',
      data: `echo ${HOST_BOUNDARY_FLUSH_TERMINAL_MARKER}\r`
    }
  });

  await waitForHostMessages((messages) => {
    const sawAgentMarker = messages.some(
      (message) =>
        message.type === 'host/executionOutput' &&
        message.payload.kind === 'agent' &&
        message.payload.nodeId === agentNodeId &&
        message.payload.chunk.includes(HOST_BOUNDARY_FLUSH_AGENT_MARKER)
    );
    const sawTerminalMarker = messages.some(
      (message) =>
        message.type === 'host/executionOutput' &&
        message.payload.kind === 'terminal' &&
        message.payload.nodeId === terminalNodeId &&
        message.payload.chunk.includes(HOST_BOUNDARY_FLUSH_TERMINAL_MARKER)
    );
    return sawAgentMarker && sawTerminalMarker;
  }, 8000);

  const snapshot = await simulateRuntimeReload();
  const agentNode = findNodeById(snapshot, agentNodeId);
  const terminalNode = findNodeById(snapshot, terminalNodeId);

  assert.match(agentNode.metadata.agent.recentOutput || '', new RegExp(HOST_BOUNDARY_FLUSH_AGENT_MARKER));
  assert.match(terminalNode.metadata.terminal.recentOutput || '', new RegExp(HOST_BOUNDARY_FLUSH_TERMINAL_MARKER));
}

async function verifyRestrictedLiveRuntimeReconnectBlocked(agentNodeId, terminalNodeId) {
  await setRuntimePersistenceEnabled(true);

  try {
    const currentSnapshot = await getDebugSnapshot();
    const noteNode = findNodeByKind(currentSnapshot, 'note');
    const agentNode = findNodeById(currentSnapshot, agentNodeId);
    const terminalNode = findNodeById(currentSnapshot, terminalNodeId);

    await clearHostMessages();
    let snapshot = await setPersistedState({
      version: 1,
      updatedAt: '2026-04-10T09:00:00.000Z',
      nodes: [
        {
          ...agentNode,
          status: 'reattaching',
          summary: '正在重新连接原 Agent live runtime。',
          metadata: {
            ...agentNode.metadata,
            agent: {
              ...agentNode.metadata.agent,
              lifecycle: 'waiting-input',
              persistenceMode: 'live-runtime',
              attachmentState: 'reattaching',
              liveSession: false,
              runtimeSessionId: 'restricted-agent-live-session',
              pendingLaunch: undefined
            }
          }
        },
        {
          ...terminalNode,
          status: 'reattaching',
          summary: '正在重新连接原终端 live runtime。',
          metadata: {
            ...terminalNode.metadata,
            terminal: {
              ...terminalNode.metadata.terminal,
              lifecycle: 'live',
              persistenceMode: 'live-runtime',
              attachmentState: 'reattaching',
              liveSession: false,
              runtimeSessionId: 'restricted-terminal-live-session',
              pendingLaunch: undefined
            }
          }
        },
        noteNode
      ]
    });

    snapshot = await waitForSnapshot((currentState) => {
      const currentAgent = currentState.state.nodes.find((node) => node.id === agentNodeId);
      const currentTerminal = currentState.state.nodes.find((node) => node.id === terminalNodeId);
      return Boolean(
        currentAgent?.status === 'history-restored' &&
          currentAgent.summary === '当前 workspace 未受信任，暂不重新连接原 Agent live runtime，仅展示历史结果。' &&
          currentTerminal?.status === 'history-restored' &&
          currentTerminal.summary === '当前 workspace 未受信任，暂不重新连接原终端 live runtime，仅展示历史结果。'
      );
    });

    assert.strictEqual(findNodeById(snapshot, agentNodeId).metadata.agent.attachmentState, 'reattaching');
    assert.strictEqual(findNodeById(snapshot, agentNodeId).metadata.agent.liveSession, false);
    assert.strictEqual(findNodeById(snapshot, terminalNodeId).metadata.terminal.attachmentState, 'reattaching');
    assert.strictEqual(findNodeById(snapshot, terminalNodeId).metadata.terminal.liveSession, false);

    await clearHostMessages();
    await requestExecutionSnapshot('agent', agentNodeId);
    await requestExecutionSnapshot('terminal', terminalNodeId);
    await sleep(400);

    snapshot = await getDebugSnapshot();
    assert.strictEqual(findNodeById(snapshot, agentNodeId).status, 'history-restored');
    assert.strictEqual(findNodeById(snapshot, terminalNodeId).status, 'history-restored');

    const hostMessages = await getHostMessages();
    assert.ok(
      hostMessages.some(
        (message) =>
          message.type === 'host/executionSnapshot' &&
          message.payload.kind === 'agent' &&
          message.payload.nodeId === agentNodeId &&
          message.payload.liveSession === false
      )
    );
    assert.ok(
      hostMessages.some(
        (message) =>
          message.type === 'host/executionSnapshot' &&
          message.payload.kind === 'terminal' &&
          message.payload.nodeId === terminalNodeId &&
          message.payload.liveSession === false
      )
    );
    assert.strictEqual(
      hostMessages.some(
        (message) =>
          message.type === 'host/error' &&
          /runtime session|重新附着 live runtime/.test(message.payload.message)
      ),
      false
    );
  } finally {
    await setRuntimePersistenceEnabled(false);
  }
}

async function verifyRestrictedDisablingRuntimePersistenceCleansLiveRuntime(agentNodeId, terminalNodeId) {
  await setRuntimePersistenceEnabled(true);

  try {
    await startExecutionSessionForTest({
      kind: 'agent',
      nodeId: agentNodeId,
      cols: 88,
      rows: 26,
      provider: 'codex'
    });
    await startExecutionSessionForTest({
      kind: 'terminal',
      nodeId: terminalNodeId,
      cols: 88,
      rows: 26
    });

    await waitForRuntimeSupervisorState(
      (runtimeSupervisorState) => listRuntimeSupervisorSessions(runtimeSupervisorState).length === 2,
      20000
    );

    await setRuntimePersistenceEnabled(false);

    const snapshot = await simulateRuntimeReload();
    const agentNode = findNodeById(snapshot, agentNodeId);
    const terminalNode = findNodeById(snapshot, terminalNodeId);

    assert.strictEqual(agentNode.status, 'history-restored');
    assert.strictEqual(agentNode.metadata.agent.attachmentState, 'history-restored');
    assert.strictEqual(agentNode.metadata.agent.liveSession, false);
    assert.strictEqual(terminalNode.status, 'history-restored');
    assert.strictEqual(terminalNode.metadata.terminal.attachmentState, 'history-restored');
    assert.strictEqual(terminalNode.metadata.terminal.liveSession, false);

    const runtimeSupervisorState = await waitForRuntimeSupervisorState(
      (currentState) =>
        listRuntimeSupervisorSessions(currentState).length === 0 && currentState.bindings.length === 0,
      20000
    );
    assert.deepStrictEqual(listRuntimeSupervisorSessions(runtimeSupervisorState), []);
  } finally {
    await setRuntimePersistenceEnabled(false);
  }
}

async function verifyRestrictedDeleteCleansHistoryOnlyLiveRuntime(agentNodeId, terminalNodeId) {
  await setRuntimePersistenceEnabled(true);

  try {
    await startExecutionSessionForTest({
      kind: 'agent',
      nodeId: agentNodeId,
      cols: 88,
      rows: 26,
      provider: 'codex'
    });
    await startExecutionSessionForTest({
      kind: 'terminal',
      nodeId: terminalNodeId,
      cols: 88,
      rows: 26
    });

    await waitForRuntimeSupervisorState(
      (runtimeSupervisorState) => listRuntimeSupervisorSessions(runtimeSupervisorState).length === 2,
      20000
    );

    let snapshot = await simulateRuntimeReload();
    let agentNode = findNodeById(snapshot, agentNodeId);
    let terminalNode = findNodeById(snapshot, terminalNodeId);
    assert.strictEqual(agentNode.status, 'history-restored');
    assert.strictEqual(agentNode.metadata.agent.attachmentState, 'reattaching');
    assert.strictEqual(terminalNode.status, 'history-restored');
    assert.strictEqual(terminalNode.metadata.terminal.attachmentState, 'reattaching');

    const agentRuntimeSessionId = agentNode.metadata.agent.runtimeSessionId;
    const terminalRuntimeSessionId = terminalNode.metadata.terminal.runtimeSessionId;
    assert.ok(agentRuntimeSessionId);
    assert.ok(terminalRuntimeSessionId);

    await performWebviewDomAction({
      kind: 'clickNodeActionButton',
      nodeId: agentNodeId,
      label: '删除'
    });

    snapshot = await waitForSnapshot(
      (currentSnapshot) => !currentSnapshot.state.nodes.some((node) => node.id === agentNodeId),
      20000
    );
    assert.ok(snapshot.state.nodes.some((node) => node.id === terminalNodeId));

    let runtimeSupervisorState = await waitForRuntimeSupervisorState((currentState) => {
      const sessionIds = listRuntimeSupervisorSessions(currentState).map((session) => session.sessionId);
      return (
        sessionIds.length === 1 &&
        !sessionIds.includes(agentRuntimeSessionId) &&
        sessionIds.includes(terminalRuntimeSessionId) &&
        currentState.bindings.length === 0
      );
    }, 20000);
    assert.strictEqual(listRuntimeSupervisorSessions(runtimeSupervisorState).length, 1);

    await performWebviewDomAction({
      kind: 'clickNodeActionButton',
      nodeId: terminalNodeId,
      label: '删除'
    });

    snapshot = await waitForSnapshot(
      (currentSnapshot) => !currentSnapshot.state.nodes.some((node) => node.id === terminalNodeId),
      20000
    );
    assert.strictEqual(snapshot.state.nodes.some((node) => node.id === terminalNodeId), false);

    runtimeSupervisorState = await waitForRuntimeSupervisorState(
      (currentState) =>
        listRuntimeSupervisorSessions(currentState).length === 0 && currentState.bindings.length === 0,
      20000
    );
    assert.deepStrictEqual(listRuntimeSupervisorSessions(runtimeSupervisorState), []);
  } finally {
    await setRuntimePersistenceEnabled(false);
  }
}

async function verifyRealDeleteButton(noteNodeId) {
  await performWebviewDomAction({
    kind: 'clickNodeActionButton',
    nodeId: noteNodeId,
    label: '删除'
  });

  const snapshot = await waitForSnapshot(
    (currentSnapshot) => currentSnapshot.state.nodes.some((node) => node.id === noteNodeId) === false
  );
  assert.strictEqual(snapshot.state.nodes.some((node) => node.id === noteNodeId), false);
}

async function verifyCodexSessionIdLocator() {
  const matchingHomeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dev-session-canvas-codex-locator-'));
  try {
    const matchingStartedAtMs = Date.now();
    const expectedSessionId = '11111111-1111-4111-8111-111111111111';
    const matchingCwd = '/tmp/dev-session-canvas-codex-match';

    await writeCodexRolloutSessionMeta({
      homeDir: matchingHomeDir,
      sessionId: expectedSessionId,
      cwd: matchingCwd,
      timestampMs: matchingStartedAtMs
    });

    const detectedSessionId = await locateCodexSessionIdForTest({
      cwd: matchingCwd,
      startedAtMs: matchingStartedAtMs,
      homeDir: matchingHomeDir,
      timeoutMs: 800
    });
    assert.strictEqual(detectedSessionId, expectedSessionId);

    const missedSessionId = await locateCodexSessionIdForTest({
      cwd: '/tmp/dev-session-canvas-codex-miss',
      startedAtMs: matchingStartedAtMs,
      homeDir: matchingHomeDir,
      timeoutMs: 450
    });
    assert.strictEqual(missedSessionId, null);
  } finally {
    await fs.rm(matchingHomeDir, { recursive: true, force: true });
  }

  const ambiguousHomeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dev-session-canvas-codex-locator-'));
  try {
    const ambiguousStartedAtMs = Date.now();
    const ambiguousCwd = '/tmp/dev-session-canvas-codex-ambiguous';

    await writeCodexRolloutSessionMeta({
      homeDir: ambiguousHomeDir,
      sessionId: '22222222-2222-4222-8222-222222222222',
      cwd: ambiguousCwd,
      timestampMs: ambiguousStartedAtMs
    });
    await writeCodexRolloutSessionMeta({
      homeDir: ambiguousHomeDir,
      sessionId: '33333333-3333-4333-8333-333333333333',
      cwd: ambiguousCwd,
      timestampMs: ambiguousStartedAtMs + 5,
      fileSuffix: 'second'
    });

    const ambiguousSessionId = await locateCodexSessionIdForTest({
      cwd: ambiguousCwd,
      startedAtMs: ambiguousStartedAtMs,
      homeDir: ambiguousHomeDir,
      timeoutMs: 450
    });
    assert.strictEqual(ambiguousSessionId, null);
  } finally {
    await fs.rm(ambiguousHomeDir, { recursive: true, force: true });
  }
}

async function verifyAgentCliRelativePathCacheIsolation() {
  const workspaceA = await fs.mkdtemp(path.join(os.tmpdir(), 'dev-session-canvas-cli-cache-a-'));
  const workspaceB = await fs.mkdtemp(path.join(os.tmpdir(), 'dev-session-canvas-cli-cache-b-'));

  try {
    const relativeKeyA = await getAgentCliResolutionCacheKeyForTest({
      provider: 'codex',
      requestedCommand: './tools/codex-wrapper',
      workspaceCwd: workspaceA
    });
    const relativeKeyB = await getAgentCliResolutionCacheKeyForTest({
      provider: 'codex',
      requestedCommand: './tools/codex-wrapper',
      workspaceCwd: workspaceB
    });
    const absoluteKeyA = await getAgentCliResolutionCacheKeyForTest({
      provider: 'codex',
      requestedCommand: 'codex',
      workspaceCwd: workspaceA
    });
    const absoluteKeyB = await getAgentCliResolutionCacheKeyForTest({
      provider: 'codex',
      requestedCommand: 'codex',
      workspaceCwd: workspaceB
    });

    assert.notStrictEqual(relativeKeyA, relativeKeyB);
    assert.strictEqual(absoluteKeyA, absoluteKeyB);
  } finally {
    await fs.rm(workspaceA, { recursive: true, force: true });
    await fs.rm(workspaceB, { recursive: true, force: true });
  }
}

async function getDebugSnapshot() {
  return vscode.commands.executeCommand(COMMAND_IDS.testGetDebugState);
}

async function getRuntimeSupervisorState() {
  return vscode.commands.executeCommand(COMMAND_IDS.testGetRuntimeSupervisorState);
}

async function getHostMessages() {
  return vscode.commands.executeCommand(COMMAND_IDS.testGetHostMessages);
}

async function getDiagnosticEvents() {
  return vscode.commands.executeCommand(COMMAND_IDS.testGetDiagnosticEvents);
}

async function locateCodexSessionIdForTest({ cwd, startedAtMs, homeDir, timeoutMs }) {
  return vscode.commands.executeCommand(
    COMMAND_IDS.testLocateCodexSessionId,
    cwd,
    startedAtMs,
    homeDir,
    timeoutMs
  );
}

async function getAgentCliResolutionCacheKeyForTest({ provider, requestedCommand, workspaceCwd }) {
  return vscode.commands.executeCommand(
    COMMAND_IDS.testGetAgentCliResolutionCacheKey,
    provider,
    requestedCommand,
    workspaceCwd
  );
}

async function clearHostMessages() {
  await vscode.commands.executeCommand(COMMAND_IDS.testClearHostMessages);
}

async function clearDiagnosticEvents() {
  await vscode.commands.executeCommand(COMMAND_IDS.testClearDiagnosticEvents);
}

async function setQuickPickSelections(selectionIds) {
  return vscode.commands.executeCommand(COMMAND_IDS.testSetQuickPickSelections, selectionIds);
}

async function reloadPersistedState() {
  return vscode.commands.executeCommand(COMMAND_IDS.testReloadPersistedState);
}

async function setPersistedState(rawState) {
  return vscode.commands.executeCommand(COMMAND_IDS.testSetPersistedState, rawState);
}

async function simulateRuntimeReload() {
  return vscode.commands.executeCommand(COMMAND_IDS.testSimulateRuntimeReload);
}

async function captureWebviewProbe(surface, timeoutMs, delayMs = 0) {
  const probe = await vscode.commands.executeCommand(
    COMMAND_IDS.testCaptureWebviewProbe,
    surface,
    timeoutMs,
    delayMs
  );
  lastWebviewProbe = probe;
  await persistLastWebviewProbe();
  return probe;
}

async function performWebviewDomAction(action, surface = 'editor', timeoutMs = 5000) {
  return vscode.commands.executeCommand(
    COMMAND_IDS.testPerformWebviewDomAction,
    action,
    surface,
    timeoutMs
  );
}

async function dispatchWebviewMessage(message, surface) {
  return vscode.commands.executeCommand(COMMAND_IDS.testDispatchWebviewMessage, message, surface);
}

async function startExecutionSessionForTest({ kind, nodeId, cols, rows, provider, resumeRequested = false }) {
  return vscode.commands.executeCommand(
    COMMAND_IDS.testStartExecutionSession,
    kind,
    nodeId,
    cols,
    rows,
    provider,
    resumeRequested
  );
}

async function setRuntimePersistenceEnabled(enabled) {
  await vscode.workspace
    .getConfiguration()
    .update('devSessionCanvas.runtimePersistence.enabled', enabled, vscode.ConfigurationTarget.Global);
}

async function setWorkbenchColorTheme(themeName) {
  await vscode.workspace
    .getConfiguration('workbench')
    .update('colorTheme', themeName, vscode.ConfigurationTarget.Global);
}

async function requestExecutionSnapshot(kind, nodeId, surface) {
  return dispatchWebviewMessage(
    {
      type: 'webview/attachExecutionSession',
      payload: {
        kind,
        nodeId
      }
    },
    surface
  );
}

async function waitForWebviewProbe(predicate, timeoutMs = 8000) {
  return waitForWebviewProbeOnSurface('editor', predicate, timeoutMs);
}

async function waitForWebviewProbeOnSurface(surface, predicate, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  let lastProbe = await captureWebviewProbe(surface, 2000);

  while (Date.now() < deadline) {
    if (predicate(lastProbe)) {
      return lastProbe;
    }

    await sleep(100);
    lastProbe = await captureWebviewProbe(surface, 2000);
  }

  assert.fail(
    `Timed out while waiting for ${surface} webview probe. Last probe: ${JSON.stringify(lastProbe)}`
  );
}

async function waitForSnapshot(predicate, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let lastSnapshot = await getDebugSnapshot();

  while (Date.now() < deadline) {
    if (predicate(lastSnapshot)) {
      return lastSnapshot;
    }

    await sleep(100);
    lastSnapshot = await getDebugSnapshot();
  }

  assert.fail(`Timed out while waiting for smoke test state. Last snapshot: ${JSON.stringify(lastSnapshot)}`);
}

async function waitForDiagnosticEvents(predicate, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  let lastEvents = await getDiagnosticEvents();

  while (Date.now() < deadline) {
    if (predicate(lastEvents)) {
      return lastEvents;
    }

    await sleep(100);
    lastEvents = await getDiagnosticEvents();
  }

  assert.fail(`Timed out while waiting for diagnostic events. Last events: ${JSON.stringify(lastEvents)}`);
}

function terminalThemeMatches(actualTheme, expectedTheme) {
  return (
    normalizeColorValue(actualTheme?.background) === normalizeColorValue(expectedTheme.background) &&
    normalizeColorValue(actualTheme?.foreground) === normalizeColorValue(expectedTheme.foreground) &&
    normalizeColorValue(actualTheme?.ansiBlue) === normalizeColorValue(expectedTheme.ansiBlue)
  );
}

function assertTerminalThemeMatches(actualTheme, expectedTheme, label) {
  assert.ok(actualTheme, `Missing terminal theme snapshot for ${label}.`);
  assert.strictEqual(
    normalizeColorValue(actualTheme.background),
    normalizeColorValue(expectedTheme.background),
    `${label} background did not match.`
  );
  assert.strictEqual(
    normalizeColorValue(actualTheme.foreground),
    normalizeColorValue(expectedTheme.foreground),
    `${label} foreground did not match.`
  );
  assert.strictEqual(
    normalizeColorValue(actualTheme.ansiBlue),
    normalizeColorValue(expectedTheme.ansiBlue),
    `${label} ansiBlue did not match.`
  );
}

function normalizeColorValue(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : null;
}

function listRuntimeSupervisorSessions(runtimeSupervisorState) {
  const dedupedSessions = new Map();

  for (const registryState of Object.values(runtimeSupervisorState?.registries || {})) {
    const sessions = registryState?.registry?.sessions;
    if (!Array.isArray(sessions)) {
      continue;
    }

    for (const session of sessions) {
      if (session?.sessionId) {
        dedupedSessions.set(session.sessionId, session);
      }
    }
  }

  return Array.from(dedupedSessions.values());
}

async function waitForRuntimeSupervisorState(predicate, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let lastState = await getRuntimeSupervisorState();

  while (Date.now() < deadline) {
    if (predicate(lastState)) {
      return lastState;
    }

    await sleep(100);
    lastState = await getRuntimeSupervisorState();
  }

  assert.fail(`Timed out while waiting for runtime supervisor state. Last state: ${JSON.stringify(lastState)}`);
}

async function waitForHostMessages(predicate, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  let messages = await getHostMessages();

  while (Date.now() < deadline) {
    if (predicate(messages)) {
      return messages;
    }

    await sleep(100);
    messages = await getHostMessages();
  }

  assert.fail(`Timed out while waiting for host messages. Last messages: ${JSON.stringify(messages)}`);
}

function findNodeByKind(snapshot, kind) {
  const node = snapshot.state.nodes.find((currentNode) => currentNode.kind === kind);
  assert.ok(node, `Missing ${kind} node in smoke snapshot.`);
  return node;
}

function findNodeById(snapshot, nodeId) {
  const node = snapshot.state.nodes.find((currentNode) => currentNode.id === nodeId);
  assert.ok(node, `Missing node ${nodeId} in smoke snapshot.`);
  return node;
}

function hasNodeSize(snapshot, nodeId, targetSize) {
  const node = snapshot.state.nodes.find((currentNode) => currentNode.id === nodeId);
  return Boolean(
    node &&
      node.size?.width === targetSize.width &&
      node.size?.height === targetSize.height
  );
}

function hasRenderedNodeSize(probe, nodeId, targetSize, tolerance = 8) {
  const node = probe.nodes.find((currentNode) => currentNode.nodeId === nodeId);
  return Boolean(
    node &&
      Math.abs(node.renderedWidth - targetSize.width) <= tolerance &&
      Math.abs(node.renderedHeight - targetSize.height) <= tolerance
  );
}

function sleep(timeoutMs) {
  return new Promise((resolve) => setTimeout(resolve, timeoutMs));
}

async function writeCodexRolloutSessionMeta({
  homeDir,
  sessionId,
  cwd,
  timestampMs,
  fileSuffix = 'match'
}) {
  const [year, month, day] = toDateDirectoryParts(timestampMs);
  const sessionsDir = path.join(homeDir, '.codex', 'sessions', year, month, day);
  await fs.mkdir(sessionsDir, { recursive: true });
  const timestamp = new Date(timestampMs).toISOString();
  const payload = {
    timestamp,
    type: 'session_meta',
    payload: {
      id: sessionId,
      timestamp,
      cwd,
      originator: 'smoke-test'
    }
  };

  await fs.writeFile(
    path.join(sessionsDir, `rollout-${sessionId}-${fileSuffix}.jsonl`),
    `${JSON.stringify(payload)}\n`,
    'utf8'
  );
}

function toDateDirectoryParts(timestampMs) {
  const date = new Date(timestampMs);
  return [
    String(date.getFullYear()),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ];
}

async function persistLastWebviewProbe() {
  if (!artifactDir || lastWebviewProbe === undefined) {
    return;
  }

  await fs.mkdir(artifactDir, { recursive: true });
  await fs.writeFile(
    path.join(artifactDir, 'last-webview-probe.json'),
    `${JSON.stringify(lastWebviewProbe, null, 2)}\n`,
    'utf8'
  );
}

async function verifyTrustedDiagnostics(agentNodeId, terminalNodeId) {
  const diagnosticEvents = await getDiagnosticEvents();

  assert.ok(
    diagnosticEvents.some(
      (event) => event.kind === 'surface/revealRequested' && event.detail?.to === 'panel'
    )
  );
  assert.ok(
    diagnosticEvents.some(
      (event) => event.kind === 'surface/ready' && event.detail?.surface === 'panel'
    )
  );
  assert.ok(
    diagnosticEvents.some(
      (event) =>
        event.kind === 'execution/started' &&
        event.detail?.kind === 'agent' &&
        event.detail?.nodeId === agentNodeId
    )
  );
  assert.ok(
    diagnosticEvents.some(
      (event) =>
        event.kind === 'execution/exited' &&
        event.detail?.kind === 'agent' &&
        event.detail?.nodeId === agentNodeId
    )
  );
  assert.ok(
    diagnosticEvents.some(
      (event) =>
        event.kind === 'execution/started' &&
        event.detail?.kind === 'terminal' &&
        event.detail?.nodeId === terminalNodeId
    )
  );
  assert.ok(
    diagnosticEvents.some(
      (event) =>
        event.kind === 'execution/snapshotPosted' &&
        event.detail?.kind === 'terminal' &&
        event.detail?.nodeId === terminalNodeId &&
        event.detail?.liveSession === true
    )
  );
  assert.ok(
    diagnosticEvents.some(
      (event) =>
        ((event.kind === 'execution/spawnError' &&
          event.detail?.kind === 'agent' &&
          event.detail?.nodeId === agentNodeId) ||
          (event.kind === 'execution/exited' &&
            event.detail?.kind === 'agent' &&
            event.detail?.nodeId === agentNodeId &&
            event.detail?.status === 'error'))
    )
  );
}

async function verifyRestrictedDiagnostics(agentNodeId, terminalNodeId) {
  const diagnosticEvents = await getDiagnosticEvents();

  assert.ok(
    diagnosticEvents.some(
      (event) => event.kind === 'surface/ready' && event.detail?.surface === 'editor'
    )
  );
  assert.ok(
    diagnosticEvents.some(
      (event) =>
        event.kind === 'execution/startRejected' &&
        event.detail?.kind === 'agent' &&
        event.detail?.nodeId === agentNodeId &&
        event.detail?.reason === 'workspace-untrusted'
    )
  );
  assert.ok(
    diagnosticEvents.some(
      (event) =>
        event.kind === 'execution/startRejected' &&
        event.detail?.kind === 'terminal' &&
        event.detail?.nodeId === terminalNodeId &&
        event.detail?.reason === 'workspace-untrusted'
    )
  );
  assert.ok(
    diagnosticEvents.some(
      (event) =>
        event.kind === 'execution/inputRejected' &&
        event.detail?.kind === 'agent' &&
        event.detail?.nodeId === agentNodeId &&
        event.detail?.reason === 'workspace-untrusted'
    )
  );
  assert.ok(
    diagnosticEvents.some(
      (event) =>
        event.kind === 'execution/inputRejected' &&
        event.detail?.kind === 'terminal' &&
        event.detail?.nodeId === terminalNodeId &&
        event.detail?.reason === 'workspace-untrusted'
    )
  );
}

async function writeFailureArtifacts(error) {
  if (!artifactDir) {
    return;
  }

  await fs.mkdir(artifactDir, { recursive: true });
  await fs.writeFile(path.join(artifactDir, 'failure-error.txt'), formatError(error), 'utf8');

  const snapshot = await safeGet(() => getDebugSnapshot());
  if (snapshot !== undefined) {
    await fs.writeFile(
      path.join(artifactDir, 'failure-snapshot.json'),
      `${JSON.stringify(snapshot, null, 2)}\n`,
      'utf8'
    );
  }

  const hostMessages = await safeGet(() => getHostMessages());
  if (hostMessages !== undefined) {
    await fs.writeFile(
      path.join(artifactDir, 'failure-host-messages.json'),
      `${JSON.stringify(hostMessages, null, 2)}\n`,
      'utf8'
    );
  }

  const diagnosticEvents = await safeGet(() => getDiagnosticEvents());
  if (diagnosticEvents !== undefined) {
    await fs.writeFile(
      path.join(artifactDir, 'failure-diagnostic-events.json'),
      `${JSON.stringify(diagnosticEvents, null, 2)}\n`,
      'utf8'
    );
  }

  if (lastWebviewProbe !== undefined) {
    await fs.writeFile(
      path.join(artifactDir, 'failure-webview-probe.json'),
      `${JSON.stringify(lastWebviewProbe, null, 2)}\n`,
      'utf8'
    );
  }
}

async function safeGet(loader) {
  try {
    return await loader();
  } catch {
    return undefined;
  }
}

function formatError(error) {
  if (error instanceof Error) {
    return error.stack || error.message;
  }

  return String(error);
}
