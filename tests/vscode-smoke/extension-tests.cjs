const assert = require('assert');
const fs = require('fs/promises');
const http = require('http');
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
const EDITOR_TAB_SWITCH_TERMINAL_MARKER = 'DEV_SESSION_CANVAS_EDITOR_TAB_SWITCH';
const PANEL_TAB_SWITCH_TERMINAL_MARKER = 'DEV_SESSION_CANVAS_PANEL_TAB_SWITCH';
const TERMINAL_SCROLLBACK_PERSIST_MARKER = 'DEV_SESSION_CANVAS_SCROLLBACK_PERSIST';
const LIVE_RUNTIME_TERMINAL_SCROLLBACK_PERSIST_MARKER = 'DEV_SESSION_CANVAS_LIVE_RUNTIME_SCROLLBACK_PERSIST';
const TERMINAL_FLOOD_OUTPUT_MARKER = 'DEV_SESSION_CANVAS_TERMINAL_FLOOD';
const TERMINAL_FLOOD_SECONDARY_OUTPUT_MARKER = 'DEV_SESSION_CANVAS_TERMINAL_FLOOD_SECONDARY';
const TERMINAL_FLOOD_AGENT_MARKER = '[fake-agent] terminal flood parallel';
const TERMINAL_FLOOD_NEW_AGENT_MARKER = '[fake-agent] terminal flood created agent';
const TERMINAL_FLOOD_AFTER_CTRL_C_MARKER = 'DEV_SESSION_CANVAS_AFTER_CTRL_C';
const TERMINAL_FLOOD_SECONDARY_AFTER_CTRL_C_MARKER = 'DEV_SESSION_CANVAS_SECONDARY_AFTER_CTRL_C';
const TERMINAL_NATIVE_DROP_MARKER = 'DEV_SESSION_CANVAS_NATIVE_DROP';
const RESTRICTED_AGENT_SERIALIZED_MARKER = 'DEV_SESSION_CANVAS_RESTRICTED_AGENT_HISTORY';
const RESTRICTED_TERMINAL_SERIALIZED_MARKER = 'DEV_SESSION_CANVAS_RESTRICTED_TERMINAL_HISTORY';
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

async function prepareTrustedBaseNodesForAppliedRuntimePersistenceMode(enabled) {
  await setRuntimePersistenceEnabled(enabled);

  let snapshot = await simulateRuntimeReload();
  assert.strictEqual(snapshot.state.nodes.length, 0);
  snapshot = await ensureEditorCanvasReady();
  assert.strictEqual(snapshot.activeSurface, 'editor');

  await vscode.commands.executeCommand(COMMAND_IDS.testCreateNode, 'agent');
  await vscode.commands.executeCommand(COMMAND_IDS.testCreateNode, 'terminal');
  await vscode.commands.executeCommand(COMMAND_IDS.testCreateNode, 'note');

  snapshot = await waitForSnapshot(
    (currentSnapshot) =>
      currentSnapshot.state.nodes.filter((node) => node.kind === 'agent').length === 1 &&
      currentSnapshot.state.nodes.filter((node) => node.kind === 'terminal').length === 1 &&
      currentSnapshot.state.nodes.filter((node) => node.kind === 'note').length === 1,
    20000
  );

  return {
    agentNode: findNodeByKind(snapshot, 'agent'),
    terminalNode: findNodeByKind(snapshot, 'terminal'),
    noteNode: findNodeByKind(snapshot, 'note')
  };
}

async function prepareRestrictedBaseNodesForAppliedRuntimePersistenceMode(enabled) {
  await setRuntimePersistenceEnabled(enabled);

  let snapshot = await simulateRuntimeReload();
  assert.strictEqual(snapshot.state.nodes.length, 0);
  snapshot = await ensureEditorCanvasReady();
  assert.strictEqual(snapshot.activeSurface, 'editor');

  await vscode.commands.executeCommand(COMMAND_IDS.testCreateNode, 'agent');
  await vscode.commands.executeCommand(COMMAND_IDS.testCreateNode, 'terminal');
  await vscode.commands.executeCommand(COMMAND_IDS.testCreateNode, 'note');

  snapshot = await waitForSnapshot(
    (currentSnapshot) =>
      currentSnapshot.state.nodes.filter((node) => node.kind === 'agent').length === 1 &&
      currentSnapshot.state.nodes.filter((node) => node.kind === 'terminal').length === 1 &&
      currentSnapshot.state.nodes.filter((node) => node.kind === 'note').length === 1,
    20000
  );

  return {
    agentNode: findNodeByKind(snapshot, 'agent'),
    terminalNode: findNodeByKind(snapshot, 'terminal'),
    noteNode: findNodeByKind(snapshot, 'note')
  };
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

  await verifyRuntimeContextRefreshesDefaultAgentProvider();
  await verifyRuntimeContextRefreshesTerminalScrollback();
  await verifyDefaultSurfaceRequiresReload();
  await verifyCreateNodeCommandQuickPick();
  await verifyPersistedStateFiltersLegacyTaskNodes();
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

  await verifyRealWebviewProbe(agentNode.id, terminalNode.id, noteNode.id);
  await verifyRealWebviewDomInteractions(agentNode.id, terminalNode.id, noteNode.id);
  await verifyNodeResizePersistence(agentNode.id, terminalNode.id, noteNode.id);
  await verifyAutoStartOnCreate(agentNode.id, terminalNode.id);
  await verifyAgentExecutionFlow(agentNode.id);
  await verifyTerminalExecutionFlow(terminalNode.id);
  await verifyExecutionTerminalNativeInteractions(terminalNode.id);
  await verifyRuntimeReloadPreservesConfiguredTerminalScrollbackHistory(terminalNode.id);
  await verifyEditorTerminalTabSwitchPreservesViewport(terminalNode.id);
  await verifyPanelTerminalTabSwitchPreservesViewport(terminalNode.id);
  await verifyEmbeddedTerminalThemeFollowWorkbench(agentNode.id, terminalNode.id);
  await verifyRuntimeReloadRecovery(agentNode.id, terminalNode.id);
  await verifyLiveSessionCutoverAndReload(terminalNode.id);
  await verifyPtyRobustness(agentNode.id, terminalNode.id);
  await verifyTerminalFloodKeepsCanvasResponsive(agentNode.id, terminalNode.id, noteNode.id);
  await verifyFailurePaths(agentNode.id, terminalNode.id, noteNode.id);
  await verifyPersistenceAndRecovery(noteNode.id, agentNode.id, terminalNode.id);
  await verifyStandbySurfaceIgnoresMessages(noteNode.id);
  await verifyPendingWebviewRequestFaultInjection(noteNode.id);
  await verifyStopVsQueuedExitRace(agentNode.id);
  let runtimePersistenceNodes = await prepareTrustedBaseNodesForAppliedRuntimePersistenceMode(true);
  await verifyLiveRuntimePersistence(runtimePersistenceNodes.agentNode.id, runtimePersistenceNodes.terminalNode.id);
  await verifyLiveRuntimeReloadPreservesUpdatedTerminalScrollbackHistory(runtimePersistenceNodes.terminalNode.id);
  await verifyLiveRuntimeReconnectFallbackToResume(
    runtimePersistenceNodes.agentNode.id,
    runtimePersistenceNodes.terminalNode.id
  );
  await verifyHistoryRestoredResumeReadyIgnoresStaleResumeSupported(
    runtimePersistenceNodes.agentNode.id,
    runtimePersistenceNodes.terminalNode.id
  );
  await verifyLiveRuntimeResumeExitClassification(runtimePersistenceNodes.agentNode.id);
  await verifyImmediateReloadAfterLiveRuntimeLaunch(
    runtimePersistenceNodes.agentNode.id,
    runtimePersistenceNodes.terminalNode.id
  );

  runtimePersistenceNodes = await prepareTrustedBaseNodesForAppliedRuntimePersistenceMode(false);
  await verifyHostBoundaryFlushesRecentLocalState(
    runtimePersistenceNodes.agentNode.id,
    runtimePersistenceNodes.terminalNode.id
  );
  await verifyTrustedDiagnostics(runtimePersistenceNodes.agentNode.id, runtimePersistenceNodes.terminalNode.id);
  await verifyRealDeleteButton(runtimePersistenceNodes.noteNode.id);

  snapshot = await getDebugSnapshot();
  assert.strictEqual(snapshot.state.nodes.some((node) => node.id === runtimePersistenceNodes.noteNode.id), false);
  assert.strictEqual(snapshot.state.nodes.length, 2);

  await verifyManualEdgeLifecycle(runtimePersistenceNodes.agentNode.id, runtimePersistenceNodes.terminalNode.id);
  await verifyFileActivityViewsAndOpenFiles();
  await verifyRuntimePersistenceRequiresReloadAndClearsState();

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

async function verifyRuntimeContextRefreshesDefaultAgentProvider() {
  const configuration = vscode.workspace.getConfiguration();
  const originalProvider =
    configuration.get('devSessionCanvas.agent.defaultProvider', 'codex') === 'claude' ? 'claude' : 'codex';
  const updatedProvider = originalProvider === 'claude' ? 'codex' : 'claude';

  await clearHostMessages();
  await setDefaultAgentProvider(updatedProvider);

  try {
    const hostMessages = await waitForHostMessages(
      (messages) =>
        messages.some(
          (message) =>
            message.type === 'host/stateUpdated' &&
            message.payload.runtime?.defaultAgentProvider === updatedProvider
        ),
      20000
    );
    assert.ok(
      hostMessages.some(
        (message) =>
          message.type === 'host/stateUpdated' &&
          message.payload.runtime?.defaultAgentProvider === updatedProvider
      ),
      'Expected host to push an updated runtime context after changing the default Agent provider.'
    );
  } finally {
    await clearHostMessages();
    await setDefaultAgentProvider(originalProvider);
    await waitForHostMessages(
      (messages) =>
        messages.some(
          (message) =>
            message.type === 'host/stateUpdated' &&
            message.payload.runtime?.defaultAgentProvider === originalProvider
        ),
      20000
    );
  }
}

async function verifyRuntimeContextRefreshesTerminalScrollback() {
  const terminalConfiguration = vscode.workspace.getConfiguration('terminal.integrated');
  const originalScrollback = terminalConfiguration.get('scrollback', 1000);
  const updatedScrollback = originalScrollback === 240 ? 320 : 240;

  await clearHostMessages();
  await setTerminalIntegratedScrollback(updatedScrollback);

  try {
    const hostMessages = await waitForHostMessages(
      (messages) =>
        messages.some(
          (message) =>
            message.type === 'host/stateUpdated' &&
            message.payload.runtime?.terminalScrollback === updatedScrollback
        ),
      20000
    );
    assert.ok(
      hostMessages.some(
        (message) =>
          message.type === 'host/stateUpdated' &&
          message.payload.runtime?.terminalScrollback === updatedScrollback
      ),
      'Expected host to push an updated runtime context after changing terminal.integrated.scrollback.'
    );
  } finally {
    await clearHostMessages();
    await setTerminalIntegratedScrollback(originalScrollback);
    await waitForHostMessages(
      (messages) =>
        messages.some(
          (message) =>
            message.type === 'host/stateUpdated' &&
            message.payload.runtime?.terminalScrollback === originalScrollback
        ),
      20000
    );
  }
}

async function verifyDefaultSurfaceRequiresReload() {
  const configuration = vscode.workspace.getConfiguration();
  const originalSurface =
    configuration.get('devSessionCanvas.canvas.defaultSurface', 'panel') === 'editor' ? 'editor' : 'panel';
  const updatedSurface = originalSurface === 'panel' ? 'editor' : 'panel';
  const openSurface = async (surface) => {
    await vscode.commands.executeCommand(
      surface === 'editor' ? COMMAND_IDS.openCanvasInEditor : COMMAND_IDS.openCanvasInPanel
    );
    await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, surface, 20000);
  };

  await openSurface(originalSurface);
  await setDefaultSurface(updatedSurface);

  try {
    let snapshot = await getDebugSnapshot();
    assert.strictEqual(snapshot.activeSurface, originalSurface);
    assert.strictEqual(snapshot.sidebar.configuredSurface, originalSurface);
    assert.strictEqual(snapshot.sidebar.surfaceLocation, originalSurface);

    await vscode.commands.executeCommand(COMMAND_IDS.openCanvas);
    await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, originalSurface, 20000);

    snapshot = await getDebugSnapshot();
    assert.strictEqual(snapshot.activeSurface, originalSurface);
    assert.strictEqual(snapshot.sidebar.configuredSurface, originalSurface);
    assert.strictEqual(snapshot.sidebar.surfaceLocation, originalSurface);

    snapshot = await simulateRuntimeReload();
    assert.strictEqual(snapshot.activeSurface, updatedSurface);
    assert.strictEqual(snapshot.sidebar.configuredSurface, updatedSurface);
    assert.strictEqual(snapshot.sidebar.surfaceLocation, updatedSurface);
    assert.notStrictEqual(snapshot.activeSurface, originalSurface);
    assert.notStrictEqual(snapshot.sidebar.surfaceLocation, originalSurface);

    await vscode.commands.executeCommand(COMMAND_IDS.openCanvas);
    await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, updatedSurface, 20000);

    snapshot = await getDebugSnapshot();
    assert.strictEqual(snapshot.activeSurface, updatedSurface);
    assert.strictEqual(snapshot.sidebar.configuredSurface, updatedSurface);
    assert.strictEqual(snapshot.sidebar.surfaceLocation, updatedSurface);
  } finally {
    await setDefaultSurface(originalSurface);
    await simulateRuntimeReload();
    await openSurface(originalSurface);
  }
}

async function verifyManualEdgeLifecycle(agentNodeId, terminalNodeId) {
  await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInPanel);
  await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'panel', 20000);

  await dispatchWebviewMessage(
    {
      type: 'webview/createEdge',
      payload: {
        sourceNodeId: agentNodeId,
        targetNodeId: terminalNodeId,
        sourceAnchor: 'right',
        targetAnchor: 'left'
      }
    },
    'panel'
  );

  let snapshot = await waitForSnapshot((currentSnapshot) => {
    return currentSnapshot.state.edges.some(
      (edge) =>
        edge.owner === 'user' &&
        edge.sourceNodeId === agentNodeId &&
        edge.targetNodeId === terminalNodeId
    );
  }, 20000);
  let edge = snapshot.state.edges.find(
    (currentEdge) =>
      currentEdge.owner === 'user' &&
      currentEdge.sourceNodeId === agentNodeId &&
      currentEdge.targetNodeId === terminalNodeId
  );
  assert.ok(edge, 'Expected manual edge to be created.');
  assert.strictEqual(edge.arrowMode, 'forward');
  assert.strictEqual(edge.label, undefined);

  let panelProbe = await waitForWebviewProbeOnSurface(
    'panel',
    (currentProbe) => currentProbe.edges.some((currentEdge) => currentEdge.edgeId === edge.id),
    10000
  );
  assert.ok(panelProbe.edges.some((currentEdge) => currentEdge.edgeId === edge.id && !currentEdge.selected));

  await performWebviewDomAction(
    {
      kind: 'selectEdge',
      nodeId: agentNodeId,
      edgeId: edge.id
    },
    'panel',
    10000
  );
  panelProbe = await waitForWebviewProbeOnSurface(
    'panel',
    (currentProbe) => currentProbe.edges.some((currentEdge) => currentEdge.edgeId === edge.id && currentEdge.selected),
    10000
  );
  assert.ok(panelProbe.edges.some((currentEdge) => currentEdge.edgeId === edge.id && currentEdge.selected));

  snapshot = await dispatchWebviewMessage(
    {
      type: 'webview/updateEdge',
      payload: {
        edgeId: edge.id,
        arrowMode: 'both',
        label: '宿主链路'
      }
    },
    'panel'
  );
  edge = findEdgeById(snapshot, edge.id);
  assert.strictEqual(edge.arrowMode, 'both');
  assert.strictEqual(edge.label, '宿主链路');

  snapshot = await reloadPersistedState();
  edge = findEdgeById(snapshot, edge.id);
  assert.strictEqual(edge.arrowMode, 'both');
  assert.strictEqual(edge.label, '宿主链路');

  snapshot = await dispatchWebviewMessage(
    {
      type: 'webview/deleteEdge',
      payload: {
        edgeId: edge.id
      }
    },
    'panel'
  );
  assert.strictEqual(snapshot.state.edges.some((currentEdge) => currentEdge.id === edge.id), false);

  snapshot = await reloadPersistedState();
  assert.strictEqual(snapshot.state.edges.some((currentEdge) => currentEdge.id === edge.id), false);
}

async function verifyFileActivityViewsAndOpenFiles() {
  const configuration = vscode.workspace.getConfiguration();
  const originalPresentationMode =
    configuration.get('devSessionCanvas.files.presentationMode', 'nodes') === 'lists' ? 'lists' : 'nodes';
  const originalPathDisplayMode =
    configuration.get('devSessionCanvas.files.pathDisplayMode', 'basename') === 'relative-path'
      ? 'relative-path'
      : 'basename';
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(workspaceFolder, 'Smoke workspace is missing a workspace folder.');

  const scratchDir = path.join(workspaceFolder.uri.fsPath, '.debug', 'vscode-smoke', 'file-activity');
  const agentOnlyPath = path.join(scratchDir, 'agent-a-only.md');
  const agentOnlySecondaryPath = path.join(scratchDir, 'agent-a-second.txt');
  const sharedPath = path.join(scratchDir, 'shared.ts');
  const agentBOnlyPath = path.join(scratchDir, 'agent-b-only.json');

  await fs.mkdir(scratchDir, { recursive: true });
  await fs.writeFile(agentOnlyPath, '# agent a only\n', 'utf8');
  await fs.writeFile(agentOnlySecondaryPath, 'agent a second\n', 'utf8');
  await fs.writeFile(sharedPath, 'export const shared = true;\n', 'utf8');
  await fs.writeFile(agentBOnlyPath, '{\"owner\":\"agent-b\"}\n', 'utf8');

  await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInPanel);
  await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'panel', 20000);

  const baselineSnapshot = await getDebugSnapshot();
  const baselineNodeIds = baselineSnapshot.state.nodes.map((node) => node.id).sort();
  const baselineAgentIds = new Set(
    baselineSnapshot.state.nodes.filter((node) => node.kind === 'agent').map((node) => node.id)
  );

  await setFilesPresentationMode('nodes');
  await setFilesPathDisplayMode('basename');

  try {
    await vscode.commands.executeCommand(COMMAND_IDS.testCreateNode, 'agent');
    await vscode.commands.executeCommand(COMMAND_IDS.testCreateNode, 'agent');

    let snapshot = await waitForSnapshot((currentSnapshot) => {
      const currentAgents = currentSnapshot.state.nodes.filter((node) => node.kind === 'agent');
      return currentAgents.length === baselineAgentIds.size + 2;
    }, 20000);

    const fileActivityAgentIds = snapshot.state.nodes
      .filter((node) => node.kind === 'agent' && !baselineAgentIds.has(node.id))
      .map((node) => node.id)
      .sort();
    assert.strictEqual(fileActivityAgentIds.length, 2, 'Expected two dedicated file-activity agents.');

    const [agentAId, agentBId] = fileActivityAgentIds;
    await waitForAgentLive(agentAId);
    await waitForAgentLive(agentBId);

    await dispatchWebviewMessage(
      {
        type: 'webview/executionInput',
        payload: {
          nodeId: agentAId,
          kind: 'agent',
          data: `read ${agentOnlyPath}\r`
        }
      },
      'panel'
    );
    snapshot = await waitForSnapshot((currentSnapshot) => {
      const reference = currentSnapshot.state.fileReferences.find((currentReference) => currentReference.filePath === agentOnlyPath);
      return Boolean(reference && reference.owners.some((owner) => owner.nodeId === agentAId && owner.accessMode === 'read'));
    }, 20000);

    await dispatchWebviewMessage(
      {
        type: 'webview/executionInput',
        payload: {
          nodeId: agentAId,
          kind: 'agent',
          data: `write ${agentOnlySecondaryPath}\r`
        }
      },
      'panel'
    );
    snapshot = await waitForSnapshot((currentSnapshot) => {
      const reference = currentSnapshot.state.fileReferences.find(
        (currentReference) => currentReference.filePath === agentOnlySecondaryPath
      );
      return Boolean(reference && reference.owners.some((owner) => owner.nodeId === agentAId && owner.accessMode === 'write'));
    }, 20000);

    await dispatchWebviewMessage(
      {
        type: 'webview/executionInput',
        payload: {
          nodeId: agentAId,
          kind: 'agent',
          data: `readwrite ${sharedPath}\r`
        }
      },
      'panel'
    );
    snapshot = await waitForSnapshot((currentSnapshot) => {
      const reference = currentSnapshot.state.fileReferences.find((currentReference) => currentReference.filePath === sharedPath);
      return Boolean(
        reference && reference.owners.some((owner) => owner.nodeId === agentAId && owner.accessMode === 'read-write')
      );
    }, 20000);

    await dispatchWebviewMessage(
      {
        type: 'webview/executionInput',
        payload: {
          nodeId: agentBId,
          kind: 'agent',
          data: `write ${agentBOnlyPath}\r`
        }
      },
      'panel'
    );
    snapshot = await waitForSnapshot((currentSnapshot) => {
      const reference = currentSnapshot.state.fileReferences.find((currentReference) => currentReference.filePath === agentBOnlyPath);
      return Boolean(reference && reference.owners.some((owner) => owner.nodeId === agentBId && owner.accessMode === 'write'));
    }, 20000);

    await dispatchWebviewMessage(
      {
        type: 'webview/executionInput',
        payload: {
          nodeId: agentBId,
          kind: 'agent',
          data: `write ${sharedPath}\r`
        }
      },
      'panel'
    );
    snapshot = await waitForSnapshot((currentSnapshot) => {
      const reference = currentSnapshot.state.fileReferences.find((currentReference) => currentReference.filePath === sharedPath);
      return Boolean(
        reference &&
          reference.owners.some((owner) => owner.nodeId === agentAId && owner.accessMode === 'read-write') &&
          reference.owners.some((owner) => owner.nodeId === agentBId && owner.accessMode === 'write')
      );
    }, 20000);

    assert.strictEqual(snapshot.state.fileReferences.length, 4);
    assert.strictEqual(snapshot.state.nodes.filter((node) => node.kind === 'file').length, 4);
    assert.strictEqual(snapshot.state.nodes.filter((node) => node.kind === 'file-list').length, 0);

    const agentOnlyFileNode = snapshot.state.nodes.find(
      (node) => node.kind === 'file' && node.metadata?.file?.filePath === agentOnlyPath
    );
    const agentOnlySecondaryFileNode = snapshot.state.nodes.find(
      (node) => node.kind === 'file' && node.metadata?.file?.filePath === agentOnlySecondaryPath
    );
    const agentBOnlyFileNode = snapshot.state.nodes.find(
      (node) => node.kind === 'file' && node.metadata?.file?.filePath === agentBOnlyPath
    );
    const sharedFileNode = snapshot.state.nodes.find(
      (node) => node.kind === 'file' && node.metadata?.file?.filePath === sharedPath
    );
    const agentANode = snapshot.state.nodes.find((node) => node.id === agentAId);
    const agentBNode = snapshot.state.nodes.find((node) => node.id === agentBId);
    assert.ok(agentOnlyFileNode, 'Expected agent-only file node to exist.');
    assert.ok(agentOnlySecondaryFileNode, 'Expected second agent-only file node to exist.');
    assert.ok(agentBOnlyFileNode, 'Expected agent B file node to exist.');
    assert.ok(sharedFileNode, 'Expected shared file node to exist.');
    assert.ok(agentANode, 'Expected agent A node to exist.');
    assert.ok(agentBNode, 'Expected agent B node to exist.');
    assert.deepStrictEqual(agentOnlyFileNode.metadata.file.ownerNodeIds, [agentAId]);
    assert.deepStrictEqual(agentOnlySecondaryFileNode.metadata.file.ownerNodeIds, [agentAId]);
    assert.deepStrictEqual(agentBOnlyFileNode.metadata.file.ownerNodeIds, [agentBId]);
    assert.deepStrictEqual(sharedFileNode.metadata.file.ownerNodeIds.slice().sort(), [agentAId, agentBId].sort());
    assert.notDeepStrictEqual(
      agentOnlyFileNode.position,
      agentOnlySecondaryFileNode.position,
      'Expected same-agent single-file nodes to receive distinct automatic positions.'
    );
    assert.ok(
      !rectanglesOverlap(agentOnlyFileNode, agentOnlySecondaryFileNode),
      'Expected same-agent single-file nodes to avoid overlapping when auto-placed.'
    );

    const agentACenterX = agentANode.position.x + agentANode.size.width / 2;
    const agentBCenterX = agentBNode.position.x + agentBNode.size.width / 2;
    const agentAAnchorY = agentANode.position.y + agentANode.size.height / 3;
    const agentBAnchorY = agentBNode.position.y + agentBNode.size.height / 3;
    const agentOnlyCenterX = agentOnlyFileNode.position.x + agentOnlyFileNode.size.width / 2;
    const agentOnlyCenterY = agentOnlyFileNode.position.y + agentOnlyFileNode.size.height / 2;
    const agentOnlySecondaryCenterX = agentOnlySecondaryFileNode.position.x + agentOnlySecondaryFileNode.size.width / 2;
    const agentOnlySecondaryCenterY = agentOnlySecondaryFileNode.position.y + agentOnlySecondaryFileNode.size.height / 2;
    const agentBOnlyCenterX = agentBOnlyFileNode.position.x + agentBOnlyFileNode.size.width / 2;
    const agentBOnlyCenterY = agentBOnlyFileNode.position.y + agentBOnlyFileNode.size.height / 2;

    assert.ok(
      agentOnlyCenterX < agentACenterX,
      'Expected read-only file nodes to auto-place to the left of the owning agent.'
    );
    assert.ok(
      agentOnlyCenterY <= agentAAnchorY,
      'Expected read-only file nodes to auto-place at or above the owning agent anchor.'
    );
    assert.ok(
      agentOnlySecondaryCenterX > agentACenterX,
      'Expected write-only file nodes to auto-place to the right of the owning agent.'
    );
    assert.ok(
      agentOnlySecondaryCenterY >= agentAAnchorY,
      'Expected write-only file nodes to auto-place at or below the owning agent anchor.'
    );
    assert.ok(
      agentBOnlyCenterX > agentBCenterX,
      'Expected agent B write-only file nodes to auto-place to the right of the owning agent.'
    );
    assert.ok(
      agentBOnlyCenterY >= agentBAnchorY,
      'Expected agent B write-only file nodes to auto-place at or below the owning agent anchor.'
    );

    await dispatchWebviewMessage(
      {
        type: 'webview/deleteNode',
        payload: {
          nodeId: agentOnlyFileNode.id
        }
      },
      'panel'
    );
    snapshot = await waitForSnapshot((currentSnapshot) => {
      return (
        currentSnapshot.state.nodes.filter((node) => node.kind === 'file').length === 3 &&
        !currentSnapshot.state.nodes.some((node) => node.id === agentOnlyFileNode.id) &&
        currentSnapshot.state.fileReferences.some((currentReference) => currentReference.filePath === agentOnlyPath)
      );
    }, 20000);
    assert.strictEqual(
      snapshot.state.nodes.some((node) => node.id === agentOnlyFileNode.id),
      false,
      'Expected manually deleted single-file nodes to stay hidden while file references remain.'
    );

    assert.ok(
      snapshot.state.edges.some(
        (edge) => edge.owner === 'file-activity' && edge.targetNodeId === sharedFileNode.id && edge.sourceNodeId === agentAId
      ),
      'Expected automatic file-activity edge from agent A to the shared file node.'
    );
    assert.ok(
      snapshot.state.edges.some(
        (edge) => edge.owner === 'file-activity' && edge.targetNodeId === sharedFileNode.id && edge.sourceNodeId === agentBId
      ),
      'Expected automatic file-activity edge from agent B to the shared file node.'
    );

    let sharedAutoEdge = snapshot.state.edges.find(
      (edge) => edge.owner === 'file-activity' && edge.targetNodeId === sharedFileNode.id && edge.sourceNodeId === agentAId
    );
    assert.ok(sharedAutoEdge, 'Expected agent A shared file edge to exist before customization.');

    snapshot = await dispatchWebviewMessage(
      {
        type: 'webview/updateEdge',
        payload: {
          edgeId: sharedAutoEdge.id,
          label: '共享写入',
          color: '5'
        }
      },
      'panel'
    );
    sharedAutoEdge = findEdgeById(snapshot, sharedAutoEdge.id);
    assert.strictEqual(sharedAutoEdge.owner, 'user');
    assert.strictEqual(sharedAutoEdge.label, '共享写入');
    assert.strictEqual(sharedAutoEdge.color, '5');
    assert.ok(snapshot.state.suppressedFileActivityEdgeIds.includes(sharedAutoEdge.id));

    snapshot = await reloadPersistedState();
    sharedAutoEdge = findEdgeById(snapshot, sharedAutoEdge.id);
    assert.strictEqual(sharedAutoEdge.owner, 'user');
    assert.strictEqual(sharedAutoEdge.label, '共享写入');
    assert.strictEqual(sharedAutoEdge.color, '5');
    assert.ok(snapshot.state.suppressedFileActivityEdgeIds.includes(sharedAutoEdge.id));

    snapshot = await dispatchWebviewMessage(
      {
        type: 'webview/deleteEdge',
        payload: {
          edgeId: sharedAutoEdge.id
        }
      },
      'panel'
    );
    assert.strictEqual(snapshot.state.edges.some((edge) => edge.id === sharedAutoEdge.id), false);
    assert.ok(snapshot.state.suppressedFileActivityEdgeIds.includes(sharedAutoEdge.id));

    snapshot = await reloadPersistedState();
    assert.strictEqual(snapshot.state.edges.some((edge) => edge.id === sharedAutoEdge.id), false);
    assert.ok(snapshot.state.suppressedFileActivityEdgeIds.includes(sharedAutoEdge.id));

    await performWebviewDomAction(
      {
        kind: 'clickFileEntry',
        nodeId: agentOnlySecondaryFileNode.id,
        filePath: agentOnlySecondaryPath
      },
      'panel',
      10000
    );
    let activeEditor = await waitForActiveEditor(
      (editor) => editor.document.uri.fsPath === agentOnlySecondaryPath,
      10000
    );
    assert.strictEqual(activeEditor.document.uri.fsPath, agentOnlySecondaryPath);
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');

    await setFilesPresentationMode('lists');
    await setFilesPathDisplayMode('relative-path');

    snapshot = await waitForSnapshot((currentSnapshot) => {
      return (
        currentSnapshot.state.nodes.filter((node) => node.kind === 'file').length === 0 &&
        currentSnapshot.state.nodes.filter((node) => node.kind === 'file-list').length === 3
      );
    }, 20000);

    const agentAListNode = snapshot.state.nodes.find(
      (node) => node.kind === 'file-list' && node.metadata?.fileList?.scope === 'agent' && node.metadata.fileList.ownerNodeId === agentAId
    );
    const agentBListNode = snapshot.state.nodes.find(
      (node) => node.kind === 'file-list' && node.metadata?.fileList?.scope === 'agent' && node.metadata.fileList.ownerNodeId === agentBId
    );
    const sharedListNode = snapshot.state.nodes.find(
      (node) => node.kind === 'file-list' && node.metadata?.fileList?.scope === 'shared'
    );
    assert.ok(agentAListNode, 'Expected agent A file list node to exist.');
    assert.ok(agentBListNode, 'Expected agent B file list node to exist.');
    assert.ok(sharedListNode, 'Expected shared file list node to exist.');
    assert.strictEqual(agentAListNode.metadata.fileList.entries.length, 2);
    assert.strictEqual(agentBListNode.metadata.fileList.entries.length, 1);
    assert.strictEqual(sharedListNode.metadata.fileList.entries.length, 1);
    assert.strictEqual(sharedListNode.metadata.fileList.entries[0].filePath, sharedPath);
    assert.strictEqual(sharedListNode.metadata.fileList.entries[0].accessMode, 'read-write');

    await performWebviewDomAction(
      {
        kind: 'clickFileEntry',
        nodeId: sharedListNode.id,
        filePath: sharedPath
      },
      'panel',
      10000
    );
    activeEditor = await waitForActiveEditor(
      (editor) => editor.document.uri.fsPath === sharedPath,
      10000
    );
    assert.strictEqual(activeEditor.document.uri.fsPath, sharedPath);
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');

    await performWebviewDomAction(
      {
        kind: 'clickNodeActionButton',
        nodeId: sharedListNode.id,
        label: '删除'
      },
      'panel',
      10000
    );
    snapshot = await waitForSnapshot((currentSnapshot) => {
      return (
        currentSnapshot.state.nodes.filter((node) => node.kind === 'file-list').length === 2 &&
        !currentSnapshot.state.nodes.some((node) => node.id === sharedListNode.id) &&
        currentSnapshot.state.fileReferences.some((currentReference) => currentReference.filePath === sharedPath)
      );
    }, 20000);
    assert.strictEqual(
      snapshot.state.nodes.some((node) => node.id === sharedListNode.id),
      false,
      'Expected manually deleted file-list nodes to stay hidden while file references remain.'
    );

    await dispatchWebviewMessage(
      {
        type: 'webview/deleteNode',
        payload: {
          nodeId: agentBId
        }
      },
      'panel'
    );
    snapshot = await waitForSnapshot((currentSnapshot) => {
      const sharedReference = currentSnapshot.state.fileReferences.find((currentReference) => currentReference.filePath === sharedPath);
      return (
        !currentSnapshot.state.nodes.some((node) => node.id === agentBId) &&
        !currentSnapshot.state.fileReferences.some((currentReference) => currentReference.filePath === agentBOnlyPath) &&
        Boolean(sharedReference && sharedReference.owners.length === 1 && sharedReference.owners[0].nodeId === agentAId) &&
        currentSnapshot.state.nodes.filter((node) => node.kind === 'file-list').length === 1
      );
    }, 20000);

    const survivingListNode = snapshot.state.nodes.find(
      (node) => node.kind === 'file-list' && node.metadata?.fileList?.scope === 'agent' && node.metadata.fileList.ownerNodeId === agentAId
    );
    assert.ok(survivingListNode, 'Expected agent A file list node to absorb the remaining files.');
    assert.deepStrictEqual(
      survivingListNode.metadata.fileList.entries.map((entry) => entry.filePath).sort(),
      [agentOnlyPath, agentOnlySecondaryPath, sharedPath].sort()
    );

    await dispatchWebviewMessage(
      {
        type: 'webview/deleteNode',
        payload: {
          nodeId: agentAId
        }
      },
      'panel'
    );
    snapshot = await waitForSnapshot((currentSnapshot) => {
      return (
        !currentSnapshot.state.nodes.some((node) => node.id === agentAId) &&
        currentSnapshot.state.fileReferences.length === 0 &&
        currentSnapshot.state.nodes.every((node) => node.kind !== 'file' && node.kind !== 'file-list')
      );
    }, 20000);

    assert.deepStrictEqual(
      snapshot.state.nodes.map((node) => node.id).sort(),
      baselineNodeIds
    );
  } finally {
    await setFilesPresentationMode(originalPresentationMode);
    await setFilesPathDisplayMode(originalPathDisplayMode);
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInPanel);
    await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'panel', 20000);
  }
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
  await verifyRestrictedDiagnostics(agentNode.id, terminalNode.id);
  await verifyRestrictedLiveRuntimeReconnectBlocked();
  const restrictedRuntimeNodes = await prepareRestrictedBaseNodesForAppliedRuntimePersistenceMode(true);
  await verifyRestrictedDeleteCleansHistoryOnlyLiveRuntime(
    restrictedRuntimeNodes.agentNode.id,
    restrictedRuntimeNodes.terminalNode.id
  );
  await verifyRestrictedRuntimePersistenceRequiresReloadAndClearsState();

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

async function verifyPersistedStateFiltersLegacyTaskNodes() {
  const beforeSnapshot = await getDebugSnapshot();
  const beforeState = beforeSnapshot.state;
  const mixedBaselineState =
    beforeState.nodes.length > 0
      ? beforeState
      : {
          version: 1,
          updatedAt: '2026-04-07T14:05:00.000Z',
          nodes: [
            {
              id: 'baseline-agent-1',
              kind: 'agent',
              title: 'Baseline Agent',
              status: 'idle',
              summary: 'A retained agent node.',
              position: { x: 40, y: 40 },
              size: { width: 560, height: 420 },
              metadata: {
                agent: {
                  provider: 'codex',
                  lifecycle: 'idle',
                  liveSession: false,
                  pendingLaunch: undefined
                }
              }
            },
            {
              id: 'baseline-terminal-1',
              kind: 'terminal',
              title: 'Baseline Terminal',
              status: 'idle',
              summary: 'A retained terminal node.',
              position: { x: 640, y: 40 },
              size: { width: 560, height: 420 },
              metadata: {
                terminal: {
                  lifecycle: 'idle',
                  liveSession: false,
                  pendingLaunch: undefined
                }
              }
            },
            {
              id: 'baseline-note-1',
              kind: 'note',
              title: 'Baseline Note',
              status: 'ready',
              summary: 'A retained note node.',
              position: { x: 360, y: 520 },
              size: { width: 420, height: 320 },
              metadata: {
                note: {
                  content: 'Baseline note content.'
                }
              }
            }
          ]
        };

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
    ...mixedBaselineState,
    nodes: [
      ...mixedBaselineState.nodes,
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
    mixedBaselineState.nodes.map((node) => node.kind).sort()
  );
  assert.strictEqual(snapshot.state.nodes.some((node) => node.id === 'legacy-task-2'), false);

  if (beforeState !== mixedBaselineState) {
    snapshot = await setPersistedState(beforeState);
    assert.strictEqual(snapshot.state.nodes.length, beforeState.nodes.length);
  }
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
        typeof agentNode.chromeSubtitle === 'string' &&
        agentNode.chromeSubtitle.includes('Codex') &&
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
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(
      probe.nodes.find((node) => node.nodeId === agentNodeId) ?? {},
      'providerValue'
    ),
    false
  );

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

async function verifyExecutionTerminalNativeInteractions(terminalNodeId) {
  await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInEditor);
  await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'editor', 20000);
  await ensureTerminalStopped(terminalNodeId);
  await clearHostMessages();
  await clearDiagnosticEvents();

  const originalOpenLocalhostLinks = vscode.workspace
    .getConfiguration('workbench')
    .get('browser.openLocalhostLinks', false);

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(workspaceFolder, 'Smoke workspace is missing a workspace folder.');

  const scratchDir = path.join(
    workspaceFolder.uri.fsPath,
    '.debug',
    'vscode-smoke',
    'execution-native-interactions'
  );
  const droppedFilePath = path.join(scratchDir, 'drop target file.txt');
  const ignoredFilePath = path.join(scratchDir, 'ignored-second.txt');
  const linkTargetPath = path.join(scratchDir, 'link-target.ts');

  await fs.mkdir(scratchDir, { recursive: true });
  await fs.writeFile(droppedFilePath, 'drop target\n', 'utf8');
  await fs.writeFile(ignoredFilePath, 'ignored second file\n', 'utf8');
  await fs.writeFile(
    linkTargetPath,
    ['export const one = 1;', 'export const two = 2;', 'export const three = 3;'].join('\n') + '\n',
    'utf8'
  );

  let browserSmokeServer;
  try {
    await dispatchWebviewMessage(
      {
        type: 'webview/startExecutionSession',
        payload: {
          nodeId: terminalNodeId,
          kind: 'terminal',
          cols: 92,
          rows: 28
        }
      },
      'editor'
    );
    await waitForTerminalLive(terminalNodeId);
    await clearHostMessages();
    await clearDiagnosticEvents();

    await performWebviewDomAction(
      {
        kind: 'sendExecutionInput',
        nodeId: terminalNodeId,
        data: `printf '${TERMINAL_NATIVE_DROP_MARKER}:%s\\n' `
      },
      'editor',
      10000
    );
    await performWebviewDomAction(
      {
        kind: 'dropExecutionResources',
        nodeId: terminalNodeId,
        source: 'resourceUrls',
        values: [vscode.Uri.file(droppedFilePath).toString(), vscode.Uri.file(ignoredFilePath).toString()]
      },
      'editor',
      10000
    );
    await performWebviewDomAction(
      {
        kind: 'sendExecutionInput',
        nodeId: terminalNodeId,
        data: '\r'
      },
      'editor',
      10000
    );

    let snapshot = await waitForSnapshot((currentSnapshot) => {
      const currentTerminal = currentSnapshot.state.nodes.find((node) => node.id === terminalNodeId);
      return Boolean(
        currentTerminal?.metadata?.terminal?.recentOutput?.includes(
          `${TERMINAL_NATIVE_DROP_MARKER}:${droppedFilePath}`
        )
      );
    }, 20000);
    let terminalNode = findNodeById(snapshot, terminalNodeId);
    assert.ok(
      terminalNode.metadata.terminal.recentOutput.includes(`${TERMINAL_NATIVE_DROP_MARKER}:${droppedFilePath}`),
      'Dropped resource should be inserted into the live terminal session as shell input.'
    );
    assert.strictEqual(
      terminalNode.metadata.terminal.recentOutput.includes(ignoredFilePath),
      false,
      'Only the first dropped resource should be consumed.'
    );

    await waitForDiagnosticEvents(
      (events) =>
        events.some(
          (event) =>
            event.kind === 'execution/dropResourcePrepared' &&
            event.detail?.kind === 'terminal' &&
            event.detail?.nodeId === terminalNodeId &&
            event.detail?.source === 'resourceUrls'
        ),
      10000
    );

    const relativeLinkPath = path.relative(workspaceFolder.uri.fsPath, linkTargetPath).split(path.sep).join('/');
    const fileLinkText = `${relativeLinkPath}:2:8`;

    await performWebviewDomAction(
      {
        kind: 'sendExecutionInput',
        nodeId: terminalNodeId,
        data: `printf '%s\\n' '${fileLinkText}'\r`
      },
      'editor',
      10000
    );
    snapshot = await waitForSnapshot((currentSnapshot) => {
      const currentTerminal = currentSnapshot.state.nodes.find((node) => node.id === terminalNodeId);
      return Boolean(currentTerminal?.metadata?.terminal?.recentOutput?.includes(fileLinkText));
    }, 20000);
    terminalNode = findNodeById(snapshot, terminalNodeId);
    assert.ok(terminalNode.metadata.terminal.recentOutput.includes(fileLinkText));

    await clearDiagnosticEvents();
    await performWebviewDomAction(
      {
        kind: 'activateExecutionLink',
        nodeId: terminalNodeId,
        text: fileLinkText
      },
      'editor',
      10000
    );

    await waitForDiagnosticEvents(
      (events) =>
        events.some(
          (event) =>
            event.kind === 'execution/linkOpened' &&
            event.detail?.kind === 'terminal' &&
            event.detail?.nodeId === terminalNodeId &&
            event.detail?.text === fileLinkText
        ),
      10000
    );

    const activeEditor = await waitForActiveEditor(
      () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.uri.fsPath !== linkTargetPath) {
          return false;
        }

        return editor.selection.active.line === 1 && editor.selection.active.character === 7;
      },
      10000
    );
    assert.strictEqual(activeEditor.document.uri.fsPath, linkTargetPath);
    assert.strictEqual(activeEditor.selection.active.line, 1);
    assert.strictEqual(activeEditor.selection.active.character, 7);

    await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInEditor);
    await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'editor', 20000);

    const cwdScopedFileLinkText = 'link-target.ts:3:1';
    await performWebviewDomAction(
      {
        kind: 'sendExecutionInput',
        nodeId: terminalNodeId,
        data: `cd ${JSON.stringify(scratchDir)}\r`
      },
      'editor',
      10000
    );
    await performWebviewDomAction(
      {
        kind: 'sendExecutionInput',
        nodeId: terminalNodeId,
        data: `printf '%s\\n' '${cwdScopedFileLinkText}'\r`
      },
      'editor',
      10000
    );
    snapshot = await waitForSnapshot((currentSnapshot) => {
      const currentTerminal = currentSnapshot.state.nodes.find((node) => node.id === terminalNodeId);
      return Boolean(currentTerminal?.metadata?.terminal?.recentOutput?.includes(cwdScopedFileLinkText));
    }, 20000);
    terminalNode = findNodeById(snapshot, terminalNodeId);
    assert.ok(terminalNode.metadata.terminal.recentOutput.includes(cwdScopedFileLinkText));

    await clearDiagnosticEvents();
    await performWebviewDomAction(
      {
        kind: 'activateExecutionLink',
        nodeId: terminalNodeId,
        text: cwdScopedFileLinkText
      },
      'editor',
      10000
    );
    await waitForDiagnosticEvents(
      (events) =>
        events.some(
          (event) =>
            event.kind === 'execution/linkOpened' &&
            event.detail?.kind === 'terminal' &&
            event.detail?.nodeId === terminalNodeId &&
            event.detail?.text === cwdScopedFileLinkText
        ),
      10000
    );
    const cwdScopedEditor = await waitForActiveEditor(
      () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.uri.fsPath !== linkTargetPath) {
          return false;
        }

        return editor.selection.active.line === 2 && editor.selection.active.character === 0;
      },
      10000
    );
    assert.strictEqual(cwdScopedEditor.document.uri.fsPath, linkTargetPath);
    assert.strictEqual(cwdScopedEditor.selection.active.line, 2);
    assert.strictEqual(cwdScopedEditor.selection.active.character, 0);

    await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInEditor);
    await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'editor', 20000);

    const missingSearchLinkText = 'missing-target.ts:9:3';
    await performWebviewDomAction(
      {
        kind: 'sendExecutionInput',
        nodeId: terminalNodeId,
        data: `printf '%s\\n' '${missingSearchLinkText}'\r`
      },
      'editor',
      10000
    );
    snapshot = await waitForSnapshot((currentSnapshot) => {
      const currentTerminal = currentSnapshot.state.nodes.find((node) => node.id === terminalNodeId);
      return Boolean(currentTerminal?.metadata?.terminal?.recentOutput?.includes(missingSearchLinkText));
    }, 20000);
    terminalNode = findNodeById(snapshot, terminalNodeId);
    assert.ok(terminalNode.metadata.terminal.recentOutput.includes(missingSearchLinkText));

    await clearDiagnosticEvents();
    await performWebviewDomAction(
      {
        kind: 'activateExecutionLink',
        nodeId: terminalNodeId,
        text: missingSearchLinkText
      },
      'editor',
      10000
    );
    await waitForDiagnosticEvents(
      (events) =>
        events.some(
          (event) =>
            event.kind === 'execution/linkOpened' &&
            event.detail?.kind === 'terminal' &&
            event.detail?.nodeId === terminalNodeId &&
            event.detail?.text === missingSearchLinkText &&
            event.detail?.linkKind === 'search' &&
            event.detail?.openerKind === 'workbench.action.quickOpen'
        ),
      10000
    );
    await vscode.commands.executeCommand('workbench.action.closeQuickOpen');
    await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInEditor);
    await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'editor', 20000);

    browserSmokeServer = await createLocalBrowserSmokeServer(`Dev Session Canvas URL Smoke ${Date.now()}`);
    await setWorkbenchBrowserOpenLocalhostLinks(true);

    const urlLinkText = browserSmokeServer.url;
    const expectedUrlTooltip = `Follow link (${describeExpectedExecutionLinkModifier()})`;

    await performWebviewDomAction(
      {
        kind: 'sendExecutionInput',
        nodeId: terminalNodeId,
        data: `printf '%s\\n' '${urlLinkText}'\r`
      },
      'editor',
      10000
    );
    snapshot = await waitForSnapshot((currentSnapshot) => {
      const currentTerminal = currentSnapshot.state.nodes.find((node) => node.id === terminalNodeId);
      return Boolean(currentTerminal?.metadata?.terminal?.recentOutput?.includes(urlLinkText));
    }, 20000);
    terminalNode = findNodeById(snapshot, terminalNodeId);
    assert.ok(terminalNode.metadata.terminal.recentOutput.includes(urlLinkText));

    await performWebviewDomAction(
      {
        kind: 'hoverExecutionLink',
        nodeId: terminalNodeId,
        text: urlLinkText
      },
      'editor',
      10000
    );
    const hoverProbe = await waitForWebviewProbe(
      (probe) => probe.executionLinkTooltipText === expectedUrlTooltip,
      10000
    );
    assert.strictEqual(hoverProbe.executionLinkTooltipText, expectedUrlTooltip);

    await performWebviewDomAction(
      {
        kind: 'clearExecutionLinkHover',
        nodeId: terminalNodeId
      },
      'editor',
      10000
    );
    const clearedHoverProbe = await waitForWebviewProbe((probe) => probe.executionLinkTooltipText === null, 10000);
    assert.strictEqual(clearedHoverProbe.executionLinkTooltipText, null);

    await clearDiagnosticEvents();
    await performWebviewDomAction(
      {
        kind: 'activateExecutionLink',
        nodeId: terminalNodeId,
        text: urlLinkText
      },
      'editor',
      10000
    );

    await waitForDiagnosticEvents(
      (events) =>
        events.some(
          (event) =>
            event.kind === 'execution/linkOpened' &&
            event.detail?.kind === 'terminal' &&
            event.detail?.nodeId === terminalNodeId &&
            event.detail?.text === urlLinkText &&
            event.detail?.linkKind === 'url' &&
            event.detail?.openerKind === 'vscode.open' &&
            event.detail?.targetUri === urlLinkText
        ),
      10000
    );

    const explicitUrlLinkText = browserSmokeServer.url.replace('/hit', '/explicit');
    await performWebviewDomAction(
      {
        kind: 'sendExecutionInput',
        nodeId: terminalNodeId,
        data: `printf '\\033]8;;%s\\a%s\\033]8;;\\a\\n' '${explicitUrlLinkText}' 'explicit-url'\r`
      },
      'editor',
      10000
    );
    snapshot = await waitForSnapshot((currentSnapshot) => {
      const currentTerminal = currentSnapshot.state.nodes.find((node) => node.id === terminalNodeId);
      return Boolean(currentTerminal?.metadata?.terminal?.recentOutput?.includes('explicit-url'));
    }, 20000);
    terminalNode = findNodeById(snapshot, terminalNodeId);
    assert.ok(terminalNode.metadata.terminal.recentOutput.includes('explicit-url'));

    await clearDiagnosticEvents();
    await performWebviewDomAction(
      {
        kind: 'activateExecutionLink',
        nodeId: terminalNodeId,
        text: explicitUrlLinkText
      },
      'editor',
      10000
    );
    await waitForDiagnosticEvents(
      (events) =>
        events.some(
          (event) =>
            event.kind === 'execution/linkOpened' &&
            event.detail?.kind === 'terminal' &&
            event.detail?.nodeId === terminalNodeId &&
            event.detail?.text === explicitUrlLinkText &&
            event.detail?.linkKind === 'url' &&
            event.detail?.openerKind === 'vscode.open' &&
            event.detail?.targetUri === explicitUrlLinkText
        ),
      10000
    );
  } finally {
    await Promise.resolve()
      .then(() =>
        performWebviewDomAction(
          {
            kind: 'clearExecutionLinkHover',
            nodeId: terminalNodeId
          },
          'editor',
          3000
        )
      )
      .catch(() => {});
    if (browserSmokeServer) {
      await browserSmokeServer.close();
    }
    await setWorkbenchBrowserOpenLocalhostLinks(originalOpenLocalhostLinks);
    await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInEditor);
    await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'editor', 20000);
  }
}

async function verifyRuntimeReloadPreservesConfiguredTerminalScrollbackHistory(terminalNodeId) {
  const terminalConfiguration = vscode.workspace.getConfiguration('terminal.integrated');
  const originalScrollback = terminalConfiguration.get('scrollback', 1000);
  const initialScrollback = originalScrollback === 80 ? 60 : 80;
  const configuredScrollback = originalScrollback === 240 ? 320 : 240;

  await clearHostMessages();
  await setTerminalIntegratedScrollback(initialScrollback);

  try {
    await waitForHostMessages(
      (messages) =>
        messages.some(
          (message) =>
            message.type === 'host/stateUpdated' &&
            message.payload.runtime?.terminalScrollback === initialScrollback
        ),
      20000
    );

    await ensureTerminalStopped(terminalNodeId);
    await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInEditor);
    await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'editor', 20000);

    await dispatchWebviewMessage(
      {
        type: 'webview/startExecutionSession',
        payload: {
          nodeId: terminalNodeId,
          kind: 'terminal',
          cols: 92,
          rows: 28
        }
      },
      'editor'
    );
    await waitForTerminalLive(terminalNodeId);

    await clearHostMessages();
    await setTerminalIntegratedScrollback(configuredScrollback);
    await waitForHostMessages(
      (messages) =>
        messages.some(
          (message) =>
            message.type === 'host/stateUpdated' &&
            message.payload.runtime?.terminalScrollback === configuredScrollback
        ),
      20000
    );

    await dispatchWebviewMessage(
      {
        type: 'webview/executionInput',
        payload: {
          nodeId: terminalNodeId,
          kind: 'terminal',
          data:
            'i=1; while [ $i -le 220 ]; do printf \'' +
            `${TERMINAL_SCROLLBACK_PERSIST_MARKER}-%03d persisted scrollback verification\\r\\n` +
            '\' "$i"; i=$((i+1)); done\r'
        }
      },
      'editor'
    );

    await waitForSnapshot((currentSnapshot) => {
      const currentNode = currentSnapshot.state.nodes.find((node) => node.id === terminalNodeId);
      return Boolean(
        currentNode?.metadata?.terminal?.recentOutput?.includes(`${TERMINAL_SCROLLBACK_PERSIST_MARKER}-220`)
      );
    }, 20000);

    const reloadedSnapshot = await simulateRuntimeReload();
    const reloadedTerminal = findNodeById(reloadedSnapshot, terminalNodeId);
    const serializedData = reloadedTerminal.metadata.terminal.serializedTerminalState?.data ?? '';
    assert.ok(
      serializedData.includes(`${TERMINAL_SCROLLBACK_PERSIST_MARKER}-001`),
      'Persisted serialized terminal state should keep the earliest configured scrollback line.'
    );
    assert.ok(
      serializedData.includes(`${TERMINAL_SCROLLBACK_PERSIST_MARKER}-220`),
      'Persisted serialized terminal state should keep the latest configured scrollback line.'
    );

    await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'editor', 20000);
    await clearHostMessages();
    await requestExecutionSnapshot('terminal', terminalNodeId, 'editor');

    const hostMessages = await waitForHostMessages(
      (messages) =>
        messages.some(
          (message) =>
            message.type === 'host/executionSnapshot' &&
            message.payload.kind === 'terminal' &&
            message.payload.nodeId === terminalNodeId &&
            typeof message.payload.serializedTerminalState?.data === 'string' &&
            message.payload.serializedTerminalState.data.includes(`${TERMINAL_SCROLLBACK_PERSIST_MARKER}-001`) &&
            message.payload.serializedTerminalState.data.includes(`${TERMINAL_SCROLLBACK_PERSIST_MARKER}-220`)
        ),
      10000
    );
    assert.ok(
      hostMessages.some(
        (message) =>
          message.type === 'host/executionSnapshot' &&
          message.payload.kind === 'terminal' &&
          message.payload.nodeId === terminalNodeId &&
          typeof message.payload.serializedTerminalState?.data === 'string' &&
          message.payload.serializedTerminalState.data.includes(`${TERMINAL_SCROLLBACK_PERSIST_MARKER}-001`) &&
          message.payload.serializedTerminalState.data.includes(`${TERMINAL_SCROLLBACK_PERSIST_MARKER}-220`)
      ),
      'Expected reload-time execution snapshot to retain the configured terminal scrollback history.'
    );
  } finally {
    await clearHostMessages();
    await setTerminalIntegratedScrollback(originalScrollback);
    await waitForHostMessages(
      (messages) =>
        messages.some(
          (message) =>
            message.type === 'host/stateUpdated' &&
            message.payload.runtime?.terminalScrollback === originalScrollback
        ),
      20000
    );
  }
}

async function verifyPanelTerminalTabSwitchPreservesViewport(terminalNodeId) {
  await clearHostMessages();
  await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInPanel);
  await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'panel', 20000);

  await dispatchWebviewMessage(
    {
      type: 'webview/startExecutionSession',
      payload: {
        nodeId: terminalNodeId,
        kind: 'terminal',
        cols: 92,
        rows: 28
      }
    },
    'panel'
  );
  let snapshot = await waitForTerminalLive(terminalNodeId);
  assert.strictEqual(findNodeById(snapshot, terminalNodeId).metadata.terminal.liveSession, true);

  await dispatchWebviewMessage(
    {
      type: 'webview/executionInput',
      payload: {
        nodeId: terminalNodeId,
        kind: 'terminal',
        data:
          "printf '\\033[?1049h\\033[2J\\033[H'; " +
          "i=1; while [ $i -le 18 ]; do printf '" +
          `${PANEL_TAB_SWITCH_TERMINAL_MARKER}-%02d viewport restore verification\\r\\n` +
          "' \"$i\"; i=$((i+1)); done\r"
      }
    },
    'panel'
  );

  const baselineProbe = await waitForWebviewProbeOnSurface('panel', (currentProbe) => {
    const visibleLines = readProbeTerminalVisibleLines(currentProbe, terminalNodeId);
    return visibleLines.some((line) => line.includes(`${PANEL_TAB_SWITCH_TERMINAL_MARKER}-01`));
  }, 10000);
  const baselineVisibleLines = readProbeTerminalVisibleLines(baselineProbe, terminalNodeId);
  assert.ok(baselineVisibleLines.some((line) => line.includes(`${PANEL_TAB_SWITCH_TERMINAL_MARKER}-01`)));
  assert.ok(baselineVisibleLines.some((line) => line.includes(`${PANEL_TAB_SWITCH_TERMINAL_MARKER}-18`)));

  await clearHostMessages();
  const diagnosticStartIndex = (await getDiagnosticEvents()).length;
  await vscode.commands.executeCommand('workbench.action.terminal.new');
  await waitForDiagnosticEvents(
    (events) =>
      events.slice(diagnosticStartIndex).some(
        (event) =>
          event.kind === 'surface/visibilityChanged' &&
          event.detail?.surface === 'panel' &&
          event.detail?.visible === false
      ),
    10000
  );

  await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInPanel);
  await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'panel', 20000);
  await waitForDiagnosticEvents(
    (events) =>
      events.slice(diagnosticStartIndex).some(
        (event) =>
          event.kind === 'surface/visibilityChanged' &&
          event.detail?.surface === 'panel' &&
          event.detail?.visible === true
      ),
    10000
  );

  const hostMessages = await waitForHostMessages(
    (messages) => messages.some((message) => message.type === 'host/visibilityRestored'),
    5000
  );
  assert.ok(hostMessages.some((message) => message.type === 'host/visibilityRestored'));

  const restoredProbe = await waitForWebviewProbeOnSurface('panel', (currentProbe) => {
    const visibleLines = readProbeTerminalVisibleLines(currentProbe, terminalNodeId);
    return visibleLines.some((line) => line.includes(`${PANEL_TAB_SWITCH_TERMINAL_MARKER}-01`));
  }, 10000);
  const restoredVisibleLines = readProbeTerminalVisibleLines(restoredProbe, terminalNodeId);
  assert.deepStrictEqual(restoredVisibleLines, baselineVisibleLines);

  snapshot = await waitForSnapshot((currentSnapshot) => {
    const terminalNode = currentSnapshot.state.nodes.find((node) => node.id === terminalNodeId);
    return Boolean(terminalNode?.metadata?.terminal?.liveSession && terminalNode.status === 'live');
  }, 5000);
  assert.strictEqual(findNodeById(snapshot, terminalNodeId).metadata.terminal.liveSession, true);
}

async function verifyEditorTerminalTabSwitchPreservesViewport(terminalNodeId) {
  await clearHostMessages();
  await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInEditor);
  await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'editor', 20000);

  await dispatchWebviewMessage(
    {
      type: 'webview/startExecutionSession',
      payload: {
        nodeId: terminalNodeId,
        kind: 'terminal',
        cols: 92,
        rows: 28
      }
    },
    'editor'
  );
  let snapshot = await waitForTerminalLive(terminalNodeId);
  assert.strictEqual(findNodeById(snapshot, terminalNodeId).metadata.terminal.liveSession, true);

  await dispatchWebviewMessage(
    {
      type: 'webview/executionInput',
      payload: {
        nodeId: terminalNodeId,
        kind: 'terminal',
        data:
          "printf '\\033[?1049h\\033[2J\\033[H'; " +
          "i=1; while [ $i -le 18 ]; do printf '" +
          `${EDITOR_TAB_SWITCH_TERMINAL_MARKER}-%02d viewport restore verification\\r\\n` +
          "' \"$i\"; i=$((i+1)); done\r"
      }
    },
    'editor'
  );

  const baselineProbe = await waitForWebviewProbeOnSurface('editor', (currentProbe) => {
    const visibleLines = readProbeTerminalVisibleLines(currentProbe, terminalNodeId);
    return visibleLines.some((line) => line.includes(`${EDITOR_TAB_SWITCH_TERMINAL_MARKER}-01`));
  }, 10000);
  const baselineVisibleLines = readProbeTerminalVisibleLines(baselineProbe, terminalNodeId);
  assert.ok(baselineVisibleLines.some((line) => line.includes(`${EDITOR_TAB_SWITCH_TERMINAL_MARKER}-01`)));
  assert.ok(baselineVisibleLines.some((line) => line.includes(`${EDITOR_TAB_SWITCH_TERMINAL_MARKER}-18`)));

  await clearHostMessages();
  const diagnosticStartIndex = (await getDiagnosticEvents()).length;
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(workspaceFolder, 'Smoke workspace is missing a workspace folder.');
  const packageJsonUri = vscode.Uri.joinPath(workspaceFolder.uri, 'package.json');
  const packageJsonDocument = await vscode.workspace.openTextDocument(packageJsonUri);
  await vscode.window.showTextDocument(packageJsonDocument, {
    preview: false,
    viewColumn: vscode.ViewColumn.One
  });
  assert.strictEqual(vscode.window.activeTextEditor?.document.uri.toString(), packageJsonUri.toString());
  await waitForDiagnosticEvents(
    (events) =>
      events.slice(diagnosticStartIndex).some(
        (event) =>
          event.kind === 'surface/visibilityChanged' &&
          event.detail?.surface === 'editor' &&
          event.detail?.visible === false
      ),
    10000
  );

  await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInEditor);
  await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'editor', 20000);
  await waitForDiagnosticEvents(
    (events) =>
      events.slice(diagnosticStartIndex).some(
        (event) =>
          event.kind === 'surface/visibilityChanged' &&
          event.detail?.surface === 'editor' &&
          event.detail?.visible === true
      ),
    10000
  );

  const hostMessages = await waitForHostMessages(
    (messages) => messages.some((message) => message.type === 'host/visibilityRestored'),
    5000
  );
  assert.ok(hostMessages.some((message) => message.type === 'host/visibilityRestored'));

  const restoredProbe = await waitForWebviewProbeOnSurface('editor', (currentProbe) => {
    const visibleLines = readProbeTerminalVisibleLines(currentProbe, terminalNodeId);
    return visibleLines.some((line) => line.includes(`${EDITOR_TAB_SWITCH_TERMINAL_MARKER}-01`));
  }, 10000);
  const restoredVisibleLines = readProbeTerminalVisibleLines(restoredProbe, terminalNodeId);
  assert.deepStrictEqual(restoredVisibleLines, baselineVisibleLines);

  snapshot = await waitForSnapshot((currentSnapshot) => {
    const terminalNode = currentSnapshot.state.nodes.find((node) => node.id === terminalNodeId);
    return Boolean(terminalNode?.metadata?.terminal?.liveSession && terminalNode.status === 'live');
  }, 5000);
  assert.strictEqual(findNodeById(snapshot, terminalNodeId).metadata.terminal.liveSession, true);
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
  const agentSnapshotMessage = hostMessages.find(
    (message) =>
      message.type === 'host/executionSnapshot' &&
      message.payload.nodeId === agentNodeId &&
      message.payload.kind === 'agent'
  );
  const terminalSnapshotMessage = hostMessages.find(
    (message) =>
      message.type === 'host/executionSnapshot' &&
      message.payload.nodeId === terminalNodeId &&
      message.payload.kind === 'terminal'
  );
  assert.ok(agentSnapshotMessage);
  assert.ok(terminalSnapshotMessage);
  assert.strictEqual(agentSnapshotMessage.payload.serializedTerminalState?.format, 'xterm-serialize-v1');
  assert.strictEqual(terminalSnapshotMessage.payload.serializedTerminalState?.format, 'xterm-serialize-v1');

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

async function verifyTerminalFloodKeepsCanvasResponsive(agentNodeId, terminalNodeId, noteNodeId) {
  await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInEditor);
  await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'editor', 20000);
  await clearHostMessages();
  await ensureAgentStopped(agentNodeId);
  await ensureTerminalStopped(terminalNodeId);
  await clearHostMessages();

  const baselineSnapshot = await getDebugSnapshot();
  const baselineAgentIds = new Set(
    baselineSnapshot.state.nodes.filter((node) => node.kind === 'agent').map((node) => node.id)
  );
  const baselineTerminalIds = new Set(
    baselineSnapshot.state.nodes.filter((node) => node.kind === 'terminal').map((node) => node.id)
  );

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

  await performWebviewDomAction({
    kind: 'sendExecutionInput',
    nodeId: terminalNodeId,
    data: `i=0; while :; do printf '${TERMINAL_FLOOD_OUTPUT_MARKER} %06d\\n' "$i"; i=$((i+1)); done\r`
  });

  await waitForHostMessages(
    (messages) =>
      messages.some(
        (message) =>
          message.type === 'host/executionOutput' &&
          message.payload.kind === 'terminal' &&
          message.payload.nodeId === terminalNodeId &&
          message.payload.chunk.includes(TERMINAL_FLOOD_OUTPUT_MARKER)
      ),
    8000
  );

  await performWebviewDomAction({
    kind: 'selectNode',
    nodeId: noteNodeId
  });
  const noteProbe = await waitForWebviewProbe(
    (currentProbe) =>
      currentProbe.nodes.some((node) => node.nodeId === noteNodeId && node.selected === true),
    8000
  );
  assert.ok(noteProbe.nodes.some((node) => node.nodeId === noteNodeId && node.selected === true));

  await performWebviewDomAction({
    kind: 'sendExecutionInput',
    nodeId: agentNodeId,
    data: 'terminal flood parallel\r'
  });

  let snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentAgent = currentSnapshot.state.nodes.find((node) => node.id === agentNodeId);
    return Boolean(
      currentAgent?.metadata?.agent?.liveSession &&
        currentAgent.metadata?.agent?.recentOutput?.includes(TERMINAL_FLOOD_AGENT_MARKER)
    );
  }, 15000);
  assert.ok(findNodeById(snapshot, agentNodeId).metadata.agent.recentOutput.includes(TERMINAL_FLOOD_AGENT_MARKER));

  await dispatchWebviewMessage({
    type: 'webview/createDemoNode',
    payload: {
      kind: 'terminal',
      preferredPosition: { x: 760, y: 40 }
    }
  });
  snapshot = await waitForSnapshot((currentSnapshot) => {
    const createdTerminal = currentSnapshot.state.nodes.find(
      (node) => node.kind === 'terminal' && !baselineTerminalIds.has(node.id)
    );
    return Boolean(createdTerminal?.metadata?.terminal?.liveSession);
  }, 15000);
  const secondaryTerminalNode = snapshot.state.nodes.find(
    (node) => node.kind === 'terminal' && !baselineTerminalIds.has(node.id)
  );
  assert.ok(secondaryTerminalNode, 'Expected flood scenario to create a second terminal node.');
  const secondaryTerminalNodeId = secondaryTerminalNode.id;

  await performWebviewDomAction({
    kind: 'sendExecutionInput',
    nodeId: secondaryTerminalNodeId,
    data: `i=0; while :; do printf '${TERMINAL_FLOOD_SECONDARY_OUTPUT_MARKER} %06d\\n' "$i"; i=$((i+1)); done\r`
  });
  await waitForHostMessages(
    (messages) =>
      messages.some(
        (message) =>
          message.type === 'host/executionOutput' &&
          message.payload.kind === 'terminal' &&
          message.payload.nodeId === secondaryTerminalNodeId &&
          message.payload.chunk.includes(TERMINAL_FLOOD_SECONDARY_OUTPUT_MARKER)
      ),
    8000
  );

  await dispatchWebviewMessage({
    type: 'webview/createDemoNode',
    payload: {
      kind: 'agent',
      agentProvider: 'codex',
      preferredPosition: { x: 760, y: 320 }
    }
  });
  snapshot = await waitForSnapshot((currentSnapshot) => {
    const createdAgent = currentSnapshot.state.nodes.find(
      (node) => node.kind === 'agent' && !baselineAgentIds.has(node.id)
    );
    return Boolean(createdAgent?.metadata?.agent?.liveSession);
  }, 15000);
  const secondaryAgentNode = snapshot.state.nodes.find(
    (node) => node.kind === 'agent' && !baselineAgentIds.has(node.id)
  );
  assert.ok(secondaryAgentNode, 'Expected flood scenario to create a second agent node.');
  const secondaryAgentNodeId = secondaryAgentNode.id;

  await performWebviewDomAction({
    kind: 'sendExecutionInput',
    nodeId: secondaryAgentNodeId,
    data: 'terminal flood created agent\r'
  });
  snapshot = await waitForSnapshot((currentSnapshot) => {
    const createdAgent = currentSnapshot.state.nodes.find((node) => node.id === secondaryAgentNodeId);
    return Boolean(
      createdAgent?.metadata?.agent?.liveSession &&
        createdAgent.metadata?.agent?.recentOutput?.includes(TERMINAL_FLOOD_NEW_AGENT_MARKER)
    );
  }, 15000);
  assert.ok(
    findNodeById(snapshot, secondaryAgentNodeId).metadata.agent.recentOutput.includes(TERMINAL_FLOOD_NEW_AGENT_MARKER)
  );

  await performWebviewDomAction({
    kind: 'sendExecutionInput',
    nodeId: terminalNodeId,
    data: '\u0003'
  });
  await performWebviewDomAction({
    kind: 'sendExecutionInput',
    nodeId: secondaryTerminalNodeId,
    data: '\u0003'
  });
  await sleep(150);
  await performWebviewDomAction({
    kind: 'sendExecutionInput',
    nodeId: terminalNodeId,
    data: `echo ${TERMINAL_FLOOD_AFTER_CTRL_C_MARKER}\r`
  });
  await performWebviewDomAction({
    kind: 'sendExecutionInput',
    nodeId: secondaryTerminalNodeId,
    data: `echo ${TERMINAL_FLOOD_SECONDARY_AFTER_CTRL_C_MARKER}\r`
  });

  snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentTerminal = currentSnapshot.state.nodes.find((node) => node.id === terminalNodeId);
    const secondaryTerminal = currentSnapshot.state.nodes.find((node) => node.id === secondaryTerminalNodeId);
    return Boolean(
      currentTerminal?.metadata?.terminal?.liveSession &&
        currentTerminal.metadata?.terminal?.recentOutput?.includes(TERMINAL_FLOOD_AFTER_CTRL_C_MARKER) &&
        secondaryTerminal?.metadata?.terminal?.liveSession &&
        secondaryTerminal.metadata?.terminal?.recentOutput?.includes(TERMINAL_FLOOD_SECONDARY_AFTER_CTRL_C_MARKER)
    );
  }, 15000);
  assert.strictEqual(findNodeById(snapshot, terminalNodeId).metadata.terminal.liveSession, true);
  assert.ok(
    findNodeById(snapshot, terminalNodeId).metadata.terminal.recentOutput.includes(
      TERMINAL_FLOOD_AFTER_CTRL_C_MARKER
    )
  );
  assert.strictEqual(findNodeById(snapshot, secondaryTerminalNodeId).metadata.terminal.liveSession, true);
  assert.ok(
    findNodeById(snapshot, secondaryTerminalNodeId).metadata.terminal.recentOutput.includes(
      TERMINAL_FLOOD_SECONDARY_AFTER_CTRL_C_MARKER
    )
  );

  await ensureAgentStopped(agentNodeId);
  await ensureAgentStopped(secondaryAgentNodeId);
  await ensureTerminalStopped(terminalNodeId);
  await ensureTerminalStopped(secondaryTerminalNodeId);

  await dispatchWebviewMessage({
    type: 'webview/deleteNode',
    payload: {
      nodeId: secondaryAgentNodeId
    }
  });
  await dispatchWebviewMessage({
    type: 'webview/deleteNode',
    payload: {
      nodeId: secondaryTerminalNodeId
    }
  });
  await waitForSnapshot(
    (currentSnapshot) =>
      !currentSnapshot.state.nodes.some(
        (node) => node.id === secondaryAgentNodeId || node.id === secondaryTerminalNodeId
      ),
    20000
  );
}

async function verifyFailurePaths(agentNodeId, terminalNodeId, noteNodeId) {
  await clearHostMessages();
  const diagnosticStartIndex = (await getDiagnosticEvents()).length;

  await dispatchWebviewMessage({
    type: 'webview/createDemoNode',
    payload: {
      kind: 'agent',
      agentProvider: 'claude'
    }
  });

  let snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentNode = currentSnapshot.state.nodes.find(
      (node) =>
        node.id !== agentNodeId &&
        node.kind === 'agent' &&
        node.metadata?.agent?.provider === 'claude'
    );
    return Boolean(currentNode?.status === 'error');
  });
  const claudeAgentNode = snapshot.state.nodes.find(
    (node) =>
      node.id !== agentNodeId &&
      node.kind === 'agent' &&
      node.metadata?.agent?.provider === 'claude'
  );
  assert.ok(claudeAgentNode, 'Expected failure-path setup to create a Claude agent node.');
  let agentNode = findNodeById(snapshot, claudeAgentNode.id);
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
        event.detail?.nodeId === claudeAgentNode.id &&
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

  await dispatchWebviewMessage({
    type: 'webview/deleteNode',
    payload: {
      nodeId: claudeAgentNode.id
    }
  });
  snapshot = await waitForSnapshot(
    (currentSnapshot) => !currentSnapshot.state.nodes.some((node) => node.id === claudeAgentNode.id),
    20000
  );
  assert.strictEqual(snapshot.state.nodes.some((node) => node.id === claudeAgentNode.id), false);

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
  assert.strictEqual(findNodeById(snapshot, agentNodeId).status, 'stopped');
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

async function verifyLiveRuntimeReloadPreservesUpdatedTerminalScrollbackHistory(terminalNodeId) {
  const terminalConfiguration = vscode.workspace.getConfiguration('terminal.integrated');
  const originalScrollback = terminalConfiguration.get('scrollback', 1000);
  const initialScrollback = originalScrollback === 80 ? 60 : 80;
  const configuredScrollback = originalScrollback === 240 ? 320 : 240;

  await setRuntimePersistenceEnabled(true);
  await clearHostMessages();
  await setTerminalIntegratedScrollback(initialScrollback);

  try {
    await waitForHostMessages(
      (messages) =>
        messages.some(
          (message) =>
            message.type === 'host/stateUpdated' &&
            message.payload.runtime?.terminalScrollback === initialScrollback
        ),
      20000
    );

    await ensureTerminalStopped(terminalNodeId);
    await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInEditor);
    await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'editor', 20000);

    await dispatchWebviewMessage(
      {
        type: 'webview/startExecutionSession',
        payload: {
          nodeId: terminalNodeId,
          kind: 'terminal',
          cols: 92,
          rows: 28
        }
      },
      'editor'
    );

    let snapshot = await waitForSnapshot((currentSnapshot) => {
      const currentNode = currentSnapshot.state.nodes.find((node) => node.id === terminalNodeId);
      return Boolean(
        currentNode?.metadata?.terminal?.liveSession &&
          currentNode.metadata.terminal.attachmentState === 'attached-live' &&
          currentNode.metadata.terminal.persistenceMode === 'live-runtime' &&
          currentNode.metadata.terminal.runtimeSessionId &&
          currentNode.status === 'live'
      );
    }, 20000);
    let terminalNode = findNodeById(snapshot, terminalNodeId);
    const runtimeSessionId = terminalNode.metadata.terminal.runtimeSessionId;
    assert.ok(runtimeSessionId, 'Live-runtime terminal should expose a runtimeSessionId.');

    await clearHostMessages();
    await setTerminalIntegratedScrollback(configuredScrollback);
    await waitForHostMessages(
      (messages) =>
        messages.some(
          (message) =>
            message.type === 'host/stateUpdated' &&
            message.payload.runtime?.terminalScrollback === configuredScrollback
        ),
      20000
    );

    await waitForRuntimeSupervisorState((runtimeState) => {
      return listRuntimeSupervisorSessions(runtimeState).some(
        (session) => session.sessionId === runtimeSessionId && session.scrollback === configuredScrollback
      );
    }, 20000);

    await dispatchWebviewMessage(
      {
        type: 'webview/executionInput',
        payload: {
          nodeId: terminalNodeId,
          kind: 'terminal',
          data:
            'i=1; while [ $i -le 220 ]; do printf \'' +
            `${LIVE_RUNTIME_TERMINAL_SCROLLBACK_PERSIST_MARKER}-%03d live runtime scrollback verification\\r\\n` +
            '\' "$i"; i=$((i+1)); done\r'
        }
      },
      'editor'
    );

    snapshot = await waitForSnapshot((currentSnapshot) => {
      const currentNode = currentSnapshot.state.nodes.find((node) => node.id === terminalNodeId);
      return Boolean(
        currentNode?.metadata?.terminal?.recentOutput?.includes(
          `${LIVE_RUNTIME_TERMINAL_SCROLLBACK_PERSIST_MARKER}-220`
        )
      );
    }, 20000);
    terminalNode = findNodeById(snapshot, terminalNodeId);
    assert.ok(
      terminalNode.metadata.terminal.recentOutput.includes(
        `${LIVE_RUNTIME_TERMINAL_SCROLLBACK_PERSIST_MARKER}-220`
      )
    );

    const runtimeState = await waitForRuntimeSupervisorState((currentRuntimeState) => {
      return listRuntimeSupervisorSessions(currentRuntimeState).some(
        (session) =>
          session.sessionId === runtimeSessionId &&
          session.scrollback === configuredScrollback &&
          typeof session.serializedTerminalState?.data === 'string' &&
          session.serializedTerminalState.data.includes(
            `${LIVE_RUNTIME_TERMINAL_SCROLLBACK_PERSIST_MARKER}-001`
          ) &&
          session.serializedTerminalState.data.includes(
            `${LIVE_RUNTIME_TERMINAL_SCROLLBACK_PERSIST_MARKER}-220`
          )
      );
    }, 20000);
    assert.ok(
      listRuntimeSupervisorSessions(runtimeState).some(
        (session) =>
          session.sessionId === runtimeSessionId &&
          session.scrollback === configuredScrollback &&
          typeof session.serializedTerminalState?.data === 'string' &&
          session.serializedTerminalState.data.includes(
            `${LIVE_RUNTIME_TERMINAL_SCROLLBACK_PERSIST_MARKER}-001`
          ) &&
          session.serializedTerminalState.data.includes(
            `${LIVE_RUNTIME_TERMINAL_SCROLLBACK_PERSIST_MARKER}-220`
          )
      ),
      'Expected runtime supervisor snapshots to retain the updated terminal scrollback history.'
    );

    snapshot = await simulateRuntimeReload();
    terminalNode = findNodeById(snapshot, terminalNodeId);
    assert.strictEqual(terminalNode.metadata.terminal.attachmentState, 'reattaching');

    snapshot = await waitForSnapshot((currentSnapshot) => {
      const currentNode = currentSnapshot.state.nodes.find((node) => node.id === terminalNodeId);
      return Boolean(
        currentNode?.metadata?.terminal?.liveSession &&
          currentNode.metadata.terminal.attachmentState === 'attached-live' &&
          currentNode.metadata.terminal.runtimeSessionId === runtimeSessionId &&
          typeof currentNode.metadata.terminal.serializedTerminalState?.data === 'string' &&
          currentNode.metadata.terminal.serializedTerminalState.data.includes(
            `${LIVE_RUNTIME_TERMINAL_SCROLLBACK_PERSIST_MARKER}-001`
          ) &&
          currentNode.metadata.terminal.serializedTerminalState.data.includes(
            `${LIVE_RUNTIME_TERMINAL_SCROLLBACK_PERSIST_MARKER}-220`
          )
      );
    }, 20000);

    terminalNode = findNodeById(snapshot, terminalNodeId);
    const serializedData = terminalNode.metadata.terminal.serializedTerminalState?.data ?? '';
    assert.ok(
      serializedData.includes(`${LIVE_RUNTIME_TERMINAL_SCROLLBACK_PERSIST_MARKER}-001`),
      'Reloaded live-runtime terminal should keep the earliest line allowed by the updated scrollback.'
    );
    assert.ok(
      serializedData.includes(`${LIVE_RUNTIME_TERMINAL_SCROLLBACK_PERSIST_MARKER}-220`),
      'Reloaded live-runtime terminal should keep the latest line after scrollback reconfiguration.'
    );

    await ensureTerminalStopped(terminalNodeId);
  } finally {
    await clearHostMessages();
    await setRuntimePersistenceEnabled(false);
    await setTerminalIntegratedScrollback(originalScrollback);
    await waitForHostMessages(
      (messages) =>
        messages.some(
          (message) =>
            message.type === 'host/stateUpdated' &&
            message.payload.runtime?.terminalScrollback === originalScrollback
        ),
      20000
    );
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
    assert.ok(
      restoredAgent.status === 'resume-ready' || restoredAgent.status === 'history-restored',
      `Expected restored agent to stay resumable after history restore, got ${restoredAgent.status}.`
    );
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

async function verifyRuntimePersistenceRequiresReloadAndClearsState() {
  const configuration = vscode.workspace.getConfiguration();
  const originalDefaultSurface =
    configuration.get('devSessionCanvas.canvas.defaultSurface', 'panel') === 'editor' ? 'editor' : 'panel';
  const runtimeResetSurface = 'panel';

  if (originalDefaultSurface !== runtimeResetSurface) {
    await setDefaultSurface(runtimeResetSurface);
  }
  await setRuntimePersistenceEnabled(true);

  try {
    let snapshot = await simulateRuntimeReload();
    assert.strictEqual(snapshot.state.nodes.length, 0);
    assert.strictEqual(snapshot.sidebar.configuredSurface, runtimeResetSurface);

    await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInEditor);
    await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'editor', 20000);
    snapshot = await getDebugSnapshot();
    assert.strictEqual(snapshot.activeSurface, 'editor');
    assert.strictEqual(snapshot.sidebar.configuredSurface, runtimeResetSurface);

    await vscode.commands.executeCommand(COMMAND_IDS.testCreateNode, 'agent');
    await vscode.commands.executeCommand(COMMAND_IDS.testCreateNode, 'terminal');
    snapshot = await waitForSnapshot(
      (currentSnapshot) =>
        currentSnapshot.state.nodes.filter((node) => node.kind === 'agent').length === 1 &&
        currentSnapshot.state.nodes.filter((node) => node.kind === 'terminal').length === 1,
      20000
    );

    const agentNode = findNodeByKind(snapshot, 'agent');
    const terminalNode = findNodeByKind(snapshot, 'terminal');

    await startExecutionSessionForTest({
      kind: 'agent',
      nodeId: agentNode.id,
      cols: 92,
      rows: 28,
      provider: 'codex'
    });
    await startExecutionSessionForTest({
      kind: 'terminal',
      nodeId: terminalNode.id,
      cols: 92,
      rows: 28
    });

    await waitForAgentLive(agentNode.id);
    await waitForTerminalLive(terminalNode.id);
    await waitForRuntimeSupervisorState(
      (runtimeSupervisorState) => listLiveRuntimeSupervisorSessions(runtimeSupervisorState).length === 2,
      20000
    );

    await setRuntimePersistenceEnabled(false);

    await vscode.commands.executeCommand(COMMAND_IDS.testCreateNode, 'terminal');
    snapshot = await waitForSnapshot(
      (currentSnapshot) => currentSnapshot.state.nodes.filter((node) => node.kind === 'terminal').length === 2,
      20000
    );
    const extraTerminalNode = snapshot.state.nodes.find(
      (node) => node.kind === 'terminal' && node.id !== terminalNode.id
    );
    assert.ok(extraTerminalNode, 'Expected a second terminal node before reload.');

    await startExecutionSessionForTest({
      kind: 'terminal',
      nodeId: extraTerminalNode.id,
      cols: 92,
      rows: 28
    });

    snapshot = await waitForSnapshot((currentSnapshot) => {
      const currentTerminalNode = currentSnapshot.state.nodes.find((node) => node.id === extraTerminalNode.id);
      return Boolean(
        currentTerminalNode?.metadata?.terminal?.liveSession &&
        currentTerminalNode?.metadata?.terminal?.persistenceMode === 'live-runtime'
      );
    }, 20000);
    const currentAgentNode = findNodeById(snapshot, agentNode.id);
    const currentTerminalNode = findNodeById(snapshot, terminalNode.id);
    const currentExtraTerminalNode = findNodeById(snapshot, extraTerminalNode.id);
    assert.strictEqual(currentExtraTerminalNode.metadata.terminal.persistenceMode, 'live-runtime');

    const expectedRuntimeSessionIds = [
      currentAgentNode.metadata.agent.runtimeSessionId,
      currentTerminalNode.metadata.terminal.runtimeSessionId,
      currentExtraTerminalNode.metadata.terminal.runtimeSessionId
    ];
    assert.ok(expectedRuntimeSessionIds.every(Boolean), 'Expected all live-runtime nodes to have runtimeSessionId.');

    await waitForRuntimeSupervisorState(
      (runtimeSupervisorState) => {
        const liveSessionIds = listLiveRuntimeSupervisorSessions(runtimeSupervisorState).map((session) => session.sessionId);
        return expectedRuntimeSessionIds.every((sessionId) => liveSessionIds.includes(sessionId));
      },
      20000
    );

    await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInEditor);
    await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'editor', 20000);
    snapshot = await getDebugSnapshot();
    assert.strictEqual(snapshot.activeSurface, 'editor');
    assert.strictEqual(snapshot.sidebar.configuredSurface, runtimeResetSurface);

    snapshot = await simulateRuntimeReload();
    assert.strictEqual(snapshot.state.nodes.length, 0);
    assert.strictEqual(snapshot.activeSurface, runtimeResetSurface);
    assert.strictEqual(snapshot.sidebar.configuredSurface, runtimeResetSurface);
    assert.strictEqual(snapshot.sidebar.surfaceLocation, runtimeResetSurface);

    const runtimeSupervisorState = await waitForRuntimeSupervisorState(
      (currentState) => {
        const sessionIds = listRuntimeSupervisorSessions(currentState).map((session) => session.sessionId);
        return (
          currentState.bindings.length === 0 &&
          expectedRuntimeSessionIds.every((sessionId) => !sessionIds.includes(sessionId))
        );
      },
      20000
    );
    const remainingSessionIds = listRuntimeSupervisorSessions(runtimeSupervisorState).map((session) => session.sessionId);
    assert.ok(expectedRuntimeSessionIds.every((sessionId) => !remainingSessionIds.includes(sessionId)));
  } finally {
    await setRuntimePersistenceEnabled(false);
    if (originalDefaultSurface !== runtimeResetSurface) {
      await setDefaultSurface(originalDefaultSurface);
      await simulateRuntimeReload();
    }
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

async function verifyRestrictedLiveRuntimeReconnectBlocked() {
  await setRuntimePersistenceEnabled(true);
  let baselineSnapshot;

  try {
    baselineSnapshot = await simulateRuntimeReload();
    assert.strictEqual(baselineSnapshot.state.nodes.length, 0);
    baselineSnapshot = await ensureEditorCanvasReady();
    assert.strictEqual(baselineSnapshot.activeSurface, 'editor');
    let snapshot = baselineSnapshot;

    const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
    const agentNodeId = 'restricted-history-agent';
    const terminalNodeId = 'restricted-history-terminal';

    await clearHostMessages();
    snapshot = await setPersistedState({
      version: 1,
      updatedAt: '2026-04-10T09:00:00.000Z',
      nodes: [
        {
          id: agentNodeId,
          kind: 'agent',
          title: 'Agent 1',
          status: 'reattaching',
          summary: '正在重新连接原 Agent live runtime。',
          position: { x: 0, y: 0 },
          size: { width: 560, height: 430 },
          metadata: {
            agent: {
              backend: 'node-pty',
              lifecycle: 'waiting-input',
              provider: 'codex',
              runtimeKind: 'pty-cli',
              resumeSupported: false,
              resumeStrategy: 'none',
              shellPath: 'codex',
              cwd: workspacePath,
              persistenceMode: 'live-runtime',
              attachmentState: 'reattaching',
              runtimeBackend: 'legacy-detached',
              runtimeGuarantee: 'best-effort',
              liveSession: false,
              runtimeSessionId: 'restricted-agent-live-session',
              lastCols: 67,
              lastRows: 22,
              serializedTerminalState: createSerializedTerminalStateFixture(
                RESTRICTED_AGENT_SERIALIZED_MARKER
              ),
              lastBackendLabel: 'Codex'
            }
          }
        },
        {
          id: terminalNodeId,
          kind: 'terminal',
          title: 'Terminal 2',
          status: 'reattaching',
          summary: '正在重新连接原终端 live runtime。',
          position: { x: 680, y: 0 },
          size: { width: 540, height: 420 },
          metadata: {
            terminal: {
              backend: 'node-pty',
              lifecycle: 'live',
              shellPath: '/bin/bash',
              cwd: workspacePath,
              persistenceMode: 'live-runtime',
              attachmentState: 'reattaching',
              runtimeBackend: 'legacy-detached',
              runtimeGuarantee: 'best-effort',
              liveSession: false,
              runtimeSessionId: 'restricted-terminal-live-session',
              lastCols: 68,
              lastRows: 23,
              serializedTerminalState: createSerializedTerminalStateFixture(
                RESTRICTED_TERMINAL_SERIALIZED_MARKER
              )
            }
          }
        },
        {
          id: 'restricted-history-note',
          kind: 'note',
          title: 'Note 3',
          status: 'ready',
          summary: '等待记录笔记内容。',
          position: { x: 640, y: 480 },
          size: { width: 380, height: 400 },
          metadata: {
            note: {
              content: ''
            }
          }
        }
      ]
    });

    assert.strictEqual(findNodeById(snapshot, agentNodeId).status, 'history-restored');
    assert.strictEqual(
      findNodeById(snapshot, agentNodeId).summary,
      '当前 workspace 未受信任，暂不重新连接原 Agent live runtime，仅展示历史结果。'
    );
    assert.strictEqual(findNodeById(snapshot, terminalNodeId).status, 'history-restored');
    assert.strictEqual(
      findNodeById(snapshot, terminalNodeId).summary,
      '当前 workspace 未受信任，暂不重新连接原终端 live runtime，仅展示历史结果。'
    );
    assert.strictEqual(findNodeById(snapshot, agentNodeId).metadata.agent.attachmentState, 'reattaching');
    assert.strictEqual(findNodeById(snapshot, agentNodeId).metadata.agent.liveSession, false);
    assert.strictEqual(findNodeById(snapshot, terminalNodeId).metadata.terminal.attachmentState, 'reattaching');
    assert.strictEqual(findNodeById(snapshot, terminalNodeId).metadata.terminal.liveSession, false);

    await dispatchWebviewMessage({
      type: 'webview/resizeExecutionSession',
      payload: {
        nodeId: agentNodeId,
        kind: 'agent',
        cols: 41,
        rows: 9
      }
    });
    await dispatchWebviewMessage({
      type: 'webview/resizeExecutionSession',
      payload: {
        nodeId: terminalNodeId,
        kind: 'terminal',
        cols: 43,
        rows: 10
      }
    });

    snapshot = await getDebugSnapshot();
    assert.strictEqual(findNodeById(snapshot, agentNodeId).status, 'history-restored');
    assert.strictEqual(findNodeById(snapshot, terminalNodeId).status, 'history-restored');
    assert.strictEqual(findNodeById(snapshot, agentNodeId).metadata.agent.lastCols, 67);
    assert.strictEqual(findNodeById(snapshot, agentNodeId).metadata.agent.lastRows, 22);
    assert.strictEqual(findNodeById(snapshot, terminalNodeId).metadata.terminal.lastCols, 68);
    assert.strictEqual(findNodeById(snapshot, terminalNodeId).metadata.terminal.lastRows, 23);
  } finally {
    if (baselineSnapshot) {
      await setPersistedState(baselineSnapshot.state);
    }
    await setRuntimePersistenceEnabled(false);
  }
}

async function verifyRestrictedRuntimePersistenceRequiresReloadAndClearsState() {
  const configuration = vscode.workspace.getConfiguration();
  const originalDefaultSurface =
    configuration.get('devSessionCanvas.canvas.defaultSurface', 'panel') === 'editor' ? 'editor' : 'panel';
  const runtimeResetSurface = 'panel';

  if (originalDefaultSurface !== runtimeResetSurface) {
    await setDefaultSurface(runtimeResetSurface);
  }
  await setRuntimePersistenceEnabled(true);

  try {
    await vscode.commands.executeCommand(COMMAND_IDS.testResetState);
    let snapshot = await simulateRuntimeReload();
    assert.strictEqual(snapshot.state.nodes.length, 0);
    assert.strictEqual(snapshot.sidebar.configuredSurface, runtimeResetSurface);

    await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInEditor);
    await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'editor', 20000);
    snapshot = await getDebugSnapshot();
    assert.strictEqual(snapshot.activeSurface, 'editor');
    assert.strictEqual(snapshot.sidebar.configuredSurface, runtimeResetSurface);

    await vscode.commands.executeCommand(COMMAND_IDS.testCreateNode, 'agent');
    await vscode.commands.executeCommand(COMMAND_IDS.testCreateNode, 'terminal');
    snapshot = await waitForSnapshot(
      (currentSnapshot) =>
        currentSnapshot.state.nodes.filter((node) => node.kind === 'agent').length === 1 &&
        currentSnapshot.state.nodes.filter((node) => node.kind === 'terminal').length === 1,
      20000
    );

    const agentNode = findNodeByKind(snapshot, 'agent');
    const terminalNode = findNodeByKind(snapshot, 'terminal');

    await startExecutionSessionForTest({
      kind: 'agent',
      nodeId: agentNode.id,
      cols: 88,
      rows: 26,
      provider: 'codex'
    });
    await startExecutionSessionForTest({
      kind: 'terminal',
      nodeId: terminalNode.id,
      cols: 88,
      rows: 26
    });

    await waitForRuntimeSupervisorState(
      (runtimeSupervisorState) => listLiveRuntimeSupervisorSessions(runtimeSupervisorState).length === 2,
      20000
    );

    await setRuntimePersistenceEnabled(false);

    await vscode.commands.executeCommand(COMMAND_IDS.testCreateNode, 'terminal');
    snapshot = await waitForSnapshot(
      (currentSnapshot) => currentSnapshot.state.nodes.filter((node) => node.kind === 'terminal').length === 2,
      20000
    );
    const extraTerminalNode = snapshot.state.nodes.find(
      (node) => node.kind === 'terminal' && node.id !== terminalNode.id
    );
    assert.ok(extraTerminalNode, 'Expected a second restricted terminal node before reload.');

    await startExecutionSessionForTest({
      kind: 'terminal',
      nodeId: extraTerminalNode.id,
      cols: 88,
      rows: 26
    });

    snapshot = await waitForSnapshot((currentSnapshot) => {
      const currentTerminalNode = currentSnapshot.state.nodes.find((node) => node.id === extraTerminalNode.id);
      return Boolean(
        currentTerminalNode?.metadata?.terminal?.liveSession &&
        currentTerminalNode?.metadata?.terminal?.persistenceMode === 'live-runtime'
      );
    }, 20000);

    const currentAgentNode = findNodeById(snapshot, agentNode.id);
    const currentTerminalNode = findNodeById(snapshot, terminalNode.id);
    const currentExtraTerminalNode = findNodeById(snapshot, extraTerminalNode.id);
    const expectedRuntimeSessionIds = [
      currentAgentNode.metadata.agent.runtimeSessionId,
      currentTerminalNode.metadata.terminal.runtimeSessionId,
      currentExtraTerminalNode.metadata.terminal.runtimeSessionId
    ];
    assert.ok(expectedRuntimeSessionIds.every(Boolean), 'Expected restricted live-runtime nodes to have runtimeSessionId.');

    await waitForRuntimeSupervisorState(
      (runtimeSupervisorState) => {
        const liveSessionIds = listLiveRuntimeSupervisorSessions(runtimeSupervisorState).map((session) => session.sessionId);
        return expectedRuntimeSessionIds.every((sessionId) => liveSessionIds.includes(sessionId));
      },
      20000
    );

    await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInEditor);
    await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'editor', 20000);
    snapshot = await getDebugSnapshot();
    assert.strictEqual(snapshot.activeSurface, 'editor');
    assert.strictEqual(snapshot.sidebar.configuredSurface, runtimeResetSurface);

    snapshot = await simulateRuntimeReload();
    assert.strictEqual(snapshot.state.nodes.length, 0);
    assert.strictEqual(snapshot.activeSurface, runtimeResetSurface);
    assert.strictEqual(snapshot.sidebar.configuredSurface, runtimeResetSurface);
    assert.strictEqual(snapshot.sidebar.surfaceLocation, runtimeResetSurface);

    const runtimeSupervisorState = await waitForRuntimeSupervisorState(
      (currentState) => {
        const sessionIds = listRuntimeSupervisorSessions(currentState).map((session) => session.sessionId);
        return (
          currentState.bindings.length === 0 &&
          expectedRuntimeSessionIds.every((sessionId) => !sessionIds.includes(sessionId))
        );
      },
      20000
    );
    const remainingSessionIds = listRuntimeSupervisorSessions(runtimeSupervisorState).map((session) => session.sessionId);
    assert.ok(expectedRuntimeSessionIds.every((sessionId) => !remainingSessionIds.includes(sessionId)));
  } finally {
    await setRuntimePersistenceEnabled(false);
    if (originalDefaultSurface !== runtimeResetSurface) {
      await setDefaultSurface(originalDefaultSurface);
      await simulateRuntimeReload();
    }
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
      (runtimeSupervisorState) => listLiveRuntimeSupervisorSessions(runtimeSupervisorState).length === 2,
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
      const liveSessionIds = listLiveRuntimeSupervisorSessions(currentState).map((session) => session.sessionId);
      return (
        liveSessionIds.length === 1 &&
        !sessionIds.includes(agentRuntimeSessionId) &&
        liveSessionIds.includes(terminalRuntimeSessionId) &&
        currentState.bindings.length === 0
      );
    }, 20000);
    assert.strictEqual(listLiveRuntimeSupervisorSessions(runtimeSupervisorState).length, 1);

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
      (currentState) => {
        const sessionIds = listRuntimeSupervisorSessions(currentState).map((session) => session.sessionId);
        return (
          listLiveRuntimeSupervisorSessions(currentState).length === 0 &&
          currentState.bindings.length === 0 &&
          !sessionIds.includes(agentRuntimeSessionId) &&
          !sessionIds.includes(terminalRuntimeSessionId)
        );
      },
      20000
    );
    const remainingSessionIds = listRuntimeSupervisorSessions(runtimeSupervisorState).map((session) => session.sessionId);
    assert.strictEqual(remainingSessionIds.includes(agentRuntimeSessionId), false);
    assert.strictEqual(remainingSessionIds.includes(terminalRuntimeSessionId), false);
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

async function ensureEditorCanvasReady() {
  await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInEditor);
  await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'editor', 20000);
  return getDebugSnapshot();
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

async function setDefaultSurface(surface) {
  await vscode.workspace
    .getConfiguration()
    .update('devSessionCanvas.canvas.defaultSurface', surface, vscode.ConfigurationTarget.Global);
}

async function setDefaultAgentProvider(provider) {
  await vscode.workspace
    .getConfiguration()
    .update('devSessionCanvas.agent.defaultProvider', provider, vscode.ConfigurationTarget.Global);
}

async function setFilesPresentationMode(mode) {
  await vscode.workspace
    .getConfiguration()
    .update('devSessionCanvas.files.presentationMode', mode, vscode.ConfigurationTarget.Global);
}

async function setFilesPathDisplayMode(mode) {
  await vscode.workspace
    .getConfiguration()
    .update('devSessionCanvas.files.pathDisplayMode', mode, vscode.ConfigurationTarget.Global);
}

async function setTerminalIntegratedScrollback(scrollback) {
  await vscode.workspace
    .getConfiguration('terminal.integrated')
    .update('scrollback', scrollback, vscode.ConfigurationTarget.Global);
}

async function setWorkbenchColorTheme(themeName) {
  await vscode.workspace
    .getConfiguration('workbench')
    .update('colorTheme', themeName, vscode.ConfigurationTarget.Global);
}

async function setWorkbenchBrowserOpenLocalhostLinks(enabled) {
  await vscode.workspace
    .getConfiguration('workbench')
    .update('browser.openLocalhostLinks', enabled, vscode.ConfigurationTarget.Global);
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

function createSerializedTerminalStateFixture(marker) {
  return {
    format: 'xterm-serialize-v1',
    data: `${marker}\r\n${marker} restored snapshot\r\n`
  };
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

function cloneJsonValue(value) {
  return JSON.parse(JSON.stringify(value));
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

function listLiveRuntimeSupervisorSessions(runtimeSupervisorState) {
  return listRuntimeSupervisorSessions(runtimeSupervisorState).filter((session) => session?.live === true);
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

async function waitForActiveEditor(predicate, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  let editor = vscode.window.activeTextEditor;

  while (Date.now() < deadline) {
    if (editor && predicate(editor)) {
      return editor;
    }

    await sleep(100);
    editor = vscode.window.activeTextEditor;
  }

  assert.fail(
    `Timed out while waiting for active editor. Last editor: ${JSON.stringify(
      editor
        ? {
            uri: editor.document.uri.toString(),
            selection: {
              line: editor.selection.active.line,
              character: editor.selection.active.character
            }
          }
        : null
    )}`
  );
}

function describeExpectedExecutionLinkModifier() {
  const configuredModifier = vscode.workspace
    .getConfiguration('editor')
    .get('multiCursorModifier', 'alt');
  if (configuredModifier === 'ctrlCmd') {
    return process.platform === 'darwin' ? 'option + click' : 'alt + click';
  }

  return process.platform === 'darwin' ? 'cmd + click' : 'ctrl + click';
}

async function createLocalBrowserSmokeServer(title) {
  const server = http.createServer((request, response) => {
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store'
    });
    response.end(
      `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body>${title}:${request.url}</body></html>`
    );
  });

  await new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(0, '127.0.0.1');
  });

  const address = server.address();
  assert.ok(address && typeof address === 'object' && typeof address.port === 'number');
  const hostLabel = `127.0.0.1:${address.port}`;
  const pathname = '/dev-session-canvas-url-smoke';

  return {
    title,
    hostLabel,
    pathname,
    url: `http://${hostLabel}${pathname}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      })
  };
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

function findEdgeById(snapshot, edgeId) {
  const edge = snapshot.state.edges.find((currentEdge) => currentEdge.id === edgeId);
  assert.ok(edge, `Missing edge ${edgeId} in smoke snapshot.`);
  return edge;
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

function readProbeTerminalVisibleLines(probe, nodeId) {
  const node = probe.nodes.find((currentNode) => currentNode.nodeId === nodeId);
  return Array.isArray(node?.terminalVisibleLines) ? node.terminalVisibleLines : [];
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
      (event) =>
        event.kind === 'storage/slotSelected' &&
        typeof event.detail?.writePath === 'string' &&
        typeof event.detail?.sourceStateHash === 'string'
    )
  );
  assert.ok(
    diagnosticEvents.some(
      (event) =>
        event.kind === 'state/loadSelected' &&
        event.detail?.source === 'snapshot' &&
        typeof event.detail?.storagePath === 'string' &&
        typeof event.detail?.stateHash === 'string' &&
        event.detail?.snapshotStateHash === event.detail?.stateHash
    )
  );
  assert.ok(
    diagnosticEvents.some(
      (event) =>
        event.kind === 'execution/started' &&
        event.detail?.kind === 'agent' &&
        typeof event.detail?.nodeId === 'string'
    )
  );
  assert.ok(
    diagnosticEvents.some(
      (event) =>
        event.kind === 'execution/exited' &&
        event.detail?.kind === 'agent' &&
        typeof event.detail?.nodeId === 'string'
    )
  );
  assert.ok(
    diagnosticEvents.some(
      (event) =>
        event.kind === 'execution/started' &&
        event.detail?.kind === 'terminal' &&
        typeof event.detail?.nodeId === 'string'
    )
  );
  assert.ok(
    diagnosticEvents.some(
      (event) =>
        event.kind === 'execution/snapshotPosted' &&
        event.detail?.kind === 'terminal' &&
        typeof event.detail?.nodeId === 'string' &&
        event.detail?.liveSession === true
    )
  );
  assert.ok(
    diagnosticEvents.some(
      (event) =>
        ((event.kind === 'execution/spawnError' &&
          event.detail?.kind === 'agent') ||
          (event.kind === 'execution/exited' &&
            event.detail?.kind === 'agent' &&
            event.detail?.status === 'error'))
    )
  );
  assert.ok(
    diagnosticEvents.some(
      (event) =>
        event.kind === 'state/persistWritten' &&
        typeof event.detail?.snapshotPath === 'string' &&
        typeof event.detail?.stateHash === 'string'
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

function rectanglesOverlap(left, right) {
  return (
    left.position.x < right.position.x + right.size.width &&
    left.position.x + left.size.width > right.position.x &&
    left.position.y < right.position.y + right.size.height &&
    left.position.y + left.size.height > right.position.y
  );
}

function formatError(error) {
  if (error instanceof Error) {
    return error.stack || error.message;
  }

  return String(error);
}
