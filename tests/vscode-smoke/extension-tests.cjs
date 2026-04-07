const assert = require('assert');
const path = require('path');
const fs = require('fs/promises');
const vscode = require('vscode');

const EXTENSION_ID = 'devsessioncanvas.dev-session-canvas';
const COMMAND_IDS = {
  openCanvasInEditor: 'devSessionCanvas.openCanvasInEditor',
  openCanvasInPanel: 'devSessionCanvas.openCanvasInPanel',
  testGetDebugState: 'devSessionCanvas.__test.getDebugState',
  testGetHostMessages: 'devSessionCanvas.__test.getHostMessages',
  testClearHostMessages: 'devSessionCanvas.__test.clearHostMessages',
  testGetDiagnosticEvents: 'devSessionCanvas.__test.getDiagnosticEvents',
  testClearDiagnosticEvents: 'devSessionCanvas.__test.clearDiagnosticEvents',
  testWaitForCanvasReady: 'devSessionCanvas.__test.waitForCanvasReady',
  testCaptureWebviewProbe: 'devSessionCanvas.__test.captureWebviewProbe',
  testPerformWebviewDomAction: 'devSessionCanvas.__test.performWebviewDomAction',
  testReloadPersistedState: 'devSessionCanvas.__test.reloadPersistedState',
  testDispatchWebviewMessage: 'devSessionCanvas.__test.dispatchWebviewMessage',
  testCreateNode: 'devSessionCanvas.__test.createNode',
  testResetState: 'devSessionCanvas.__test.resetState'
};

const artifactDir = process.env.DEV_SESSION_CANVAS_SMOKE_ARTIFACT_DIR;
const smokeScenario = process.env.DEV_SESSION_CANVAS_SMOKE_SCENARIO || 'trusted';
const REAL_DOM_TASK_STATUS = 'blocked';
const REAL_DOM_NOTE_BODY = 'Drive the note edit through the real VS Code webview DOM.';
const DISPOSED_EDITOR_NOTE_BODY = 'This note update should never commit after the editor closes.';
const WEBVIEW_FAULT_INJECTION_DELAY_MS = 1500;
const AGENT_STOP_RACE_SLEEP_SECONDS = 5;
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
      kind: 'task',
      preferredPosition: { x: 40, y: 320 }
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
  await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInEditor);
  await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'editor', 20000);
  await clearHostMessages();

  let snapshot = await getDebugSnapshot();
  assert.strictEqual(snapshot.activeSurface, 'editor');
  assert.strictEqual(snapshot.sidebar.canvasSurface, 'visible');
  assert.strictEqual(snapshot.sidebar.workspaceTrusted, true);
  assert.strictEqual(snapshot.surfaceReady.editor, true);
  assert.strictEqual(snapshot.state.nodes.length, 0);

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

  await clearHostMessages();
  await createBaseNodes();
  snapshot = await getDebugSnapshot();
  assert.deepStrictEqual(
    snapshot.state.nodes.map((node) => node.kind).sort(),
    ['agent', 'note', 'task', 'terminal']
  );

  const taskNode = findNodeByKind(snapshot, 'task');
  const noteNode = findNodeByKind(snapshot, 'note');
  const terminalNode = findNodeByKind(snapshot, 'terminal');
  const agentNode = findNodeByKind(snapshot, 'agent');

  await dispatchWebviewMessage({
    type: 'webview/updateTaskNode',
    payload: {
      nodeId: taskNode.id,
      title: 'Host Smoke Task',
      status: 'running',
      description: 'Verify execution and recovery in VS Code smoke.',
      assignee: 'Codex'
    }
  });
  await dispatchWebviewMessage({
    type: 'webview/updateNoteNode',
    payload: {
      nodeId: noteNode.id,
      title: 'Host Smoke Note',
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
  assert.strictEqual(findNodeById(snapshot, taskNode.id).title, 'Host Smoke Task');
  assert.strictEqual(findNodeById(snapshot, taskNode.id).status, 'running');
  assert.strictEqual(
    findNodeById(snapshot, taskNode.id).metadata.task.description,
    'Verify execution and recovery in VS Code smoke.'
  );
  assert.strictEqual(findNodeById(snapshot, taskNode.id).metadata.task.assignee, 'Codex');
  assert.strictEqual(findNodeById(snapshot, noteNode.id).title, 'Host Smoke Note');
  assert.strictEqual(
    findNodeById(snapshot, noteNode.id).metadata.note.content,
    'Exercise the real webview-to-host update path.'
  );
  assert.deepStrictEqual(findNodeById(snapshot, noteNode.id).position, { x: 680, y: 260 });

  await verifyRealWebviewProbe(taskNode.id, noteNode.id);
  await verifyRealWebviewDomInteractions(taskNode.id, noteNode.id);
  await verifyAgentExecutionFlow(agentNode.id);
  await verifyTerminalExecutionFlow(terminalNode.id);
  await verifyLiveSessionCutoverAndReload(terminalNode.id);
  await verifyPtyRobustness(agentNode.id, terminalNode.id);
  await verifyFailurePaths(agentNode.id, terminalNode.id, taskNode.id, noteNode.id);
  await verifyPersistenceAndRecovery(taskNode.id, noteNode.id, agentNode.id, terminalNode.id);
  await verifyStandbySurfaceIgnoresMessages(taskNode.id);
  await verifyPendingWebviewRequestFaultInjection(noteNode.id);
  await verifyStopVsQueuedExitRace(agentNode.id);
  await verifyTrustedDiagnostics(agentNode.id, terminalNode.id);
  await verifyRealDeleteButton(noteNode.id);

  snapshot = await getDebugSnapshot();
  assert.strictEqual(snapshot.state.nodes.some((node) => node.id === noteNode.id), false);
  assert.strictEqual(snapshot.state.nodes.length, 3);

  await dispatchWebviewMessage({ type: 'webview/resetDemoState' });
  snapshot = await getDebugSnapshot();
  assert.strictEqual(snapshot.state.nodes.length, 0);

  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
}

async function runRestrictedSmoke() {
  await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInEditor);
  await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'editor', 20000);
  await clearHostMessages();

  let snapshot = await getDebugSnapshot();
  assert.strictEqual(snapshot.activeSurface, 'editor');
  assert.strictEqual(snapshot.sidebar.canvasSurface, 'visible');
  assert.strictEqual(snapshot.sidebar.workspaceTrusted, false);
  assert.deepStrictEqual(snapshot.sidebar.creatableKinds, ['task', 'note']);
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
      kind: 'task',
      preferredPosition: { x: 40, y: 320 }
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
    ['note', 'task']
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

  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
}

async function verifyAgentExecutionFlow(agentNodeId) {
  await clearHostMessages();

  await dispatchWebviewMessage({
    type: 'webview/startExecutionSession',
    payload: {
      nodeId: agentNodeId,
      kind: 'agent',
      cols: 84,
      rows: 26,
      provider: 'codex'
    }
  });

  let snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentAgent = currentSnapshot.state.nodes.find((node) => node.id === agentNodeId);
    return Boolean(currentAgent?.metadata?.agent?.liveSession && currentAgent.status === 'live');
  });
  let agentNode = findNodeById(snapshot, agentNodeId);
  assert.strictEqual(agentNode.metadata.agent.liveSession, true);
  assert.ok(agentNode.metadata.agent.lastCols > 0);
  assert.ok(agentNode.metadata.agent.lastRows > 0);

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
      data: 'hello smoke\r'
    }
  });

  snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentNode = currentSnapshot.state.nodes.find((node) => node.id === agentNodeId);
    return Boolean(currentNode?.metadata?.agent?.recentOutput?.includes('[fake-agent] hello smoke'));
  });
  agentNode = findNodeById(snapshot, agentNodeId);
  assert.ok(agentNode.metadata.agent.recentOutput.includes('[fake-agent] hello smoke'));

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
    return Boolean(currentNode && currentNode.status === 'closed' && !currentNode.metadata?.agent?.liveSession);
  });
  agentNode = findNodeById(snapshot, agentNodeId);
  assert.strictEqual(agentNode.status, 'closed');
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

  await waitForSnapshot((currentSnapshot) => {
    const currentNode = currentSnapshot.state.nodes.find((node) => node.id === agentNodeId);
    return Boolean(currentNode?.metadata?.agent?.liveSession);
  });

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
    return Boolean(currentNode && currentNode.status === 'closed' && !currentNode.metadata?.agent?.liveSession);
  });
  agentNode = findNodeById(snapshot, agentNodeId);
  assert.strictEqual(agentNode.metadata.agent.liveSession, false);
  assert.match(agentNode.summary, /已停止 Codex 会话/);
}

async function verifyRealWebviewProbe(taskNodeId, noteNodeId) {
  let probe = await waitForWebviewProbe((currentProbe) => {
    const taskNode = currentProbe.nodes.find((node) => node.nodeId === taskNodeId);
    const noteNode = currentProbe.nodes.find((node) => node.nodeId === noteNodeId);

    return Boolean(
      currentProbe.hasCanvasShell &&
        currentProbe.hasReactFlow &&
        currentProbe.nodeCount === 4 &&
        taskNode &&
        taskNode.kind === 'task' &&
        taskNode.chromeSubtitle === 'Host Smoke Task' &&
        taskNode.titleInputValue === 'Host Smoke Task' &&
        taskNode.statusValue === 'running' &&
        taskNode.assigneeValue === 'Codex' &&
        taskNode.bodyValue === 'Verify execution and recovery in VS Code smoke.' &&
        noteNode &&
        noteNode.kind === 'note' &&
        noteNode.chromeSubtitle === 'Host Smoke Note' &&
        noteNode.titleInputValue === 'Host Smoke Note' &&
        noteNode.bodyValue === 'Exercise the real webview-to-host update path.'
    );
  });

  assert.strictEqual(probe.hasCanvasShell, true);
  assert.strictEqual(probe.hasReactFlow, true);
  assert.strictEqual(probe.nodeCount, 4);

  await dispatchWebviewMessage({ type: 'webview/not-a-real-message' });
  probe = await waitForWebviewProbe(
    (currentProbe) => currentProbe.toastMessage === '收到无法识别的消息，已忽略。'
  );
  assert.strictEqual(probe.toastMessage, '收到无法识别的消息，已忽略。');
}

async function verifyRealWebviewDomInteractions(taskNodeId, noteNodeId) {
  await performWebviewDomAction({
    kind: 'selectNodeOption',
    nodeId: taskNodeId,
    field: 'status',
    value: REAL_DOM_TASK_STATUS
  });

  let snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentTask = currentSnapshot.state.nodes.find((node) => node.id === taskNodeId);
    return Boolean(currentTask?.status === REAL_DOM_TASK_STATUS);
  });
  assert.strictEqual(findNodeById(snapshot, taskNodeId).status, REAL_DOM_TASK_STATUS);

  let probe = await waitForWebviewProbe((currentProbe) => {
    const currentTask = currentProbe.nodes.find((node) => node.nodeId === taskNodeId);
    return Boolean(currentTask && currentTask.statusValue === REAL_DOM_TASK_STATUS);
  });
  assert.strictEqual(
    probe.nodes.find((node) => node.nodeId === taskNodeId)?.statusValue,
    REAL_DOM_TASK_STATUS
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
    return Boolean(currentNote && currentNote.bodyValue === REAL_DOM_NOTE_BODY);
  });
  assert.strictEqual(
    probe.nodes.find((node) => node.nodeId === noteNodeId)?.bodyValue,
    REAL_DOM_NOTE_BODY
  );
}

async function verifyTerminalExecutionFlow(terminalNodeId) {
  await clearHostMessages();

  await dispatchWebviewMessage({
    type: 'webview/startExecutionSession',
    payload: {
      nodeId: terminalNodeId,
      kind: 'terminal',
      cols: 84,
      rows: 26
    }
  });

  let snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentTerminal = currentSnapshot.state.nodes.find((node) => node.id === terminalNodeId);
    return Boolean(currentTerminal?.metadata?.terminal?.liveSession && currentTerminal.status === 'live');
  });
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
    return Boolean(currentAgent?.status === 'closed' && !currentAgent.metadata?.agent?.liveSession);
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
      currentAgent?.status === 'closed' &&
        !currentAgent.metadata?.agent?.liveSession &&
        currentTerminal?.status === 'closed' &&
        !currentTerminal.metadata?.terminal?.liveSession
    );
  });
  assert.strictEqual(findNodeById(snapshot, agentNodeId).status, 'closed');
  assert.strictEqual(findNodeById(snapshot, terminalNodeId).status, 'closed');
}

async function verifyFailurePaths(agentNodeId, terminalNodeId, taskNodeId, noteNodeId) {
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
  assert.strictEqual(findNodeById(snapshot, taskNodeId).title, 'Host Smoke Task');
  assert.strictEqual(findNodeById(snapshot, noteNodeId).title, 'Host Smoke Note');
  assert.strictEqual(findNodeById(snapshot, noteNodeId).metadata.note.content, REAL_DOM_NOTE_BODY);
  assert.strictEqual(findNodeById(snapshot, terminalNodeId).status, 'closed');
}

async function verifyPersistenceAndRecovery(taskNodeId, noteNodeId, agentNodeId, terminalNodeId) {
  await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInPanel);
  await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'panel', 20000);

  let snapshot = await reloadPersistedState();
  assert.strictEqual(snapshot.activeSurface, 'panel');
  assert.strictEqual(snapshot.sidebar.surfaceLocation, 'panel');
  assert.strictEqual(snapshot.surfaceReady.panel, true);
  assert.strictEqual(snapshot.state.nodes.length, 4);
  assert.strictEqual(findNodeById(snapshot, taskNodeId).title, 'Host Smoke Task');
  assert.strictEqual(findNodeById(snapshot, noteNodeId).title, 'Host Smoke Note');
  assert.strictEqual(findNodeById(snapshot, taskNodeId).status, REAL_DOM_TASK_STATUS);
  assert.strictEqual(findNodeById(snapshot, noteNodeId).metadata.note.content, REAL_DOM_NOTE_BODY);
  assert.strictEqual(findNodeById(snapshot, agentNodeId).status, 'error');
  assert.strictEqual(findNodeById(snapshot, terminalNodeId).status, 'closed');
}

async function verifyStandbySurfaceIgnoresMessages(taskNodeId) {
  await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInEditor);
  await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'editor', 20000);
  await clearHostMessages();

  const beforeSnapshot = await getDebugSnapshot();
  const beforeTask = findNodeById(beforeSnapshot, taskNodeId);

  await dispatchWebviewMessage(
    {
      type: 'webview/updateTaskNode',
      payload: {
        nodeId: taskNodeId,
        title: 'Standby Should Not Win',
        status: 'done',
        description: 'This payload comes from a standby surface.',
        assignee: 'Panel'
      }
    },
    'panel'
  );
  await dispatchWebviewMessage({ type: 'webview/not-a-real-message' }, 'panel');

  const afterSnapshot = await getDebugSnapshot();
  const afterTask = findNodeById(afterSnapshot, taskNodeId);
  assert.strictEqual(afterTask.title, beforeTask.title);
  assert.strictEqual(afterTask.status, beforeTask.status);
  assert.strictEqual(afterTask.metadata.task.description, beforeTask.metadata.task.description);

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
    return Boolean(currentAgent && currentAgent.status === 'closed' && !currentAgent.metadata?.agent?.liveSession);
  });
  const agentNode = findNodeById(snapshot, agentNodeId);
  assert.strictEqual(agentNode.status, 'closed');
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
  assert.strictEqual(exitEvents[0].detail?.status, 'closed');

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

async function getDebugSnapshot() {
  return vscode.commands.executeCommand(COMMAND_IDS.testGetDebugState);
}

async function getHostMessages() {
  return vscode.commands.executeCommand(COMMAND_IDS.testGetHostMessages);
}

async function getDiagnosticEvents() {
  return vscode.commands.executeCommand(COMMAND_IDS.testGetDiagnosticEvents);
}

async function clearHostMessages() {
  await vscode.commands.executeCommand(COMMAND_IDS.testClearHostMessages);
}

async function clearDiagnosticEvents() {
  await vscode.commands.executeCommand(COMMAND_IDS.testClearDiagnosticEvents);
}

async function reloadPersistedState() {
  return vscode.commands.executeCommand(COMMAND_IDS.testReloadPersistedState);
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

async function waitForWebviewProbe(predicate, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  let lastProbe = await captureWebviewProbe('editor', 2000);

  while (Date.now() < deadline) {
    if (predicate(lastProbe)) {
      return lastProbe;
    }

    await sleep(100);
    lastProbe = await captureWebviewProbe('editor', 2000);
  }

  assert.fail(`Timed out while waiting for webview probe. Last probe: ${JSON.stringify(lastProbe)}`);
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

function sleep(timeoutMs) {
  return new Promise((resolve) => setTimeout(resolve, timeoutMs));
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
