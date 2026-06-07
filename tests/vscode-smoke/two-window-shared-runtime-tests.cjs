const assert = require('assert');
const path = require('path');
const fs = require('fs/promises');
const vscode = require('vscode');
const { activateVisibleExtension, waitForCommand } = require('./test-helpers.cjs');

const EXTENSION_ID = 'devsessioncanvas.dev-session-canvas';
const COMMAND_IDS = {
  openCanvasInEditor: 'devSessionCanvas.openCanvasInEditor',
  testGetDebugState: 'devSessionCanvas.__test.getDebugState',
  testGetRuntimeSupervisorState: 'devSessionCanvas.__test.getRuntimeSupervisorState',
  testWaitForCanvasReady: 'devSessionCanvas.__test.waitForCanvasReady',
  testDispatchWebviewMessage: 'devSessionCanvas.__test.dispatchWebviewMessage',
  testFlushPersistedState: 'devSessionCanvas.__test.flushPersistedState',
  testSimulateRuntimeReload: 'devSessionCanvas.__test.simulateRuntimeReload',
  testSetPersistedState: 'devSessionCanvas.__test.setPersistedState',
  testResetState: 'devSessionCanvas.__test.resetState'
};

const MARKERS = {
  attacherAgent: 'TWO_WINDOW_FROM_ATTACHER_AGENT',
  attacherTerminal: 'TWO_WINDOW_FROM_ATTACHER_TERMINAL',
  ownerAgent: 'TWO_WINDOW_FROM_OWNER_AGENT',
  ownerTerminal: 'TWO_WINDOW_FROM_OWNER_TERMINAL'
};
const RESIZE_COLS = 101;
const RESIZE_ROWS = 31;
const expectedRuntimeBackend =
  process.env.DEV_SESSION_CANVAS_EXPECTED_RUNTIME_BACKEND || 'legacy-detached';
const expectedRuntimeGuarantee =
  process.env.DEV_SESSION_CANVAS_EXPECTED_RUNTIME_GUARANTEE || 'best-effort';

let role = 'owner';
let artifactDir;
let sharedDir;

module.exports = {
  run
};

async function run() {
  try {
    await resolveRuntimeInputs();
    console.log(`[two-window-shared-runtime] role=${role} start`);
    if (role === 'owner') {
      await runOwnerWindow();
    } else if (role === 'attacher') {
      await runAttacherWindow();
    } else {
      throw new Error(`Unknown two-window shared runtime role: ${role}`);
    }
    console.log(`[two-window-shared-runtime] role=${role} completed`);
  } catch (error) {
    await writeFailureArtifacts(error);
    throw error;
  }
}

async function runOwnerWindow() {
  await activateExtension();
  await vscode.commands.executeCommand(COMMAND_IDS.testResetState);
  await waitForRuntimeSupervisorSettled(0, 20000);
  await configureAgentCommandOverrides();
  await setRuntimePersistenceEnabled(true);
  let snapshot = await simulateRuntimeReload();
  assert.strictEqual(snapshot.state.nodes.length, 0);

  await openCanvasEditor();
  await createExecutionNodes();
  snapshot = await getDebugSnapshot();
  const agentNode = findNodeByKind(snapshot, 'agent');
  const terminalNode = findNodeByKind(snapshot, 'terminal');

  await startExecution(agentNode.id, 'agent', {
    cols: 92,
    rows: 28,
    provider: 'codex'
  });
  await startExecution(terminalNode.id, 'terminal', {
    cols: 92,
    rows: 28
  });

  snapshot = await waitForBothLive(agentNode.id, terminalNode.id);
  const liveAgentNode = findNodeById(snapshot, agentNode.id);
  const liveTerminalNode = findNodeById(snapshot, terminalNode.id);
  assertExecutionRuntimeMetadata(liveAgentNode, 'agent');
  assertExecutionRuntimeMetadata(liveTerminalNode, 'terminal');
  const runtimeState = await waitForRuntimeSupervisorSettled(2, 20000);
  assertRuntimeSupervisorSessions(runtimeState, [
    {
      sessionId: liveAgentNode.metadata.agent.runtimeSessionId,
      nodeId: agentNode.id,
      kind: 'agent',
      runtimeStoragePath: liveAgentNode.metadata.agent.runtimeStoragePath
    },
    {
      sessionId: liveTerminalNode.metadata.terminal.runtimeSessionId,
      nodeId: terminalNode.id,
      kind: 'terminal',
      runtimeStoragePath: liveTerminalNode.metadata.terminal.runtimeStoragePath
    }
  ]);

  const flushResult = await flushPersistedState();
  assert.strictEqual(flushResult.lastError, undefined);
  assert.strictEqual(flushResult.exists, true);
  await writeJsonFile(sharedPath('owner-ready.json'), {
    agentNodeId: agentNode.id,
    terminalNodeId: terminalNode.id,
    agentSessionId: liveAgentNode.metadata.agent.runtimeSessionId,
    terminalSessionId: liveTerminalNode.metadata.terminal.runtimeSessionId,
    agentRuntimeStoragePath: liveAgentNode.metadata.agent.runtimeStoragePath,
    terminalRuntimeStoragePath: liveTerminalNode.metadata.terminal.runtimeStoragePath,
    state: snapshot.state
  });

  await waitForJsonFile(sharedPath('attacher-attached.json'), 60000);

  snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentAgent = findOptionalNodeById(currentSnapshot, agentNode.id);
    const currentTerminal = findOptionalNodeById(currentSnapshot, terminalNode.id);
    return Boolean(
      currentAgent?.metadata?.agent?.recentOutput?.includes(MARKERS.attacherAgent) &&
        currentTerminal?.metadata?.terminal?.recentOutput?.includes(MARKERS.attacherTerminal)
    );
  }, 30000);
  await writeJsonFile(sharedPath('owner-saw-attacher-input.json'), {
    ok: true
  });

  await sendExecutionInput(agentNode.id, 'agent', `${MARKERS.ownerAgent}\r`);
  await sendExecutionInput(terminalNode.id, 'terminal', `echo ${MARKERS.ownerTerminal}\r`);
  snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentAgent = findOptionalNodeById(currentSnapshot, agentNode.id);
    const currentTerminal = findOptionalNodeById(currentSnapshot, terminalNode.id);
    return Boolean(
      currentAgent?.metadata?.agent?.recentOutput?.includes(MARKERS.ownerAgent) &&
        currentTerminal?.metadata?.terminal?.recentOutput?.includes(MARKERS.ownerTerminal)
    );
  }, 30000);
  await writeJsonFile(sharedPath('owner-sent-input.json'), {
    ok: true
  });

  await waitForJsonFile(sharedPath('attacher-saw-owner-input.json'), 60000);
  await waitForJsonFile(sharedPath('attacher-resized-terminal.json'), 60000);
  snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentTerminal = findOptionalNodeById(currentSnapshot, terminalNode.id);
    return Boolean(
      currentTerminal?.metadata?.terminal?.lastCols === RESIZE_COLS &&
        currentTerminal.metadata.terminal.lastRows === RESIZE_ROWS
    );
  }, 30000);
  await writeJsonFile(sharedPath('owner-saw-resize.json'), {
    ok: true
  });

  await waitForJsonFile(sharedPath('attacher-stopped-terminal.json'), 60000);
  snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentTerminal = findOptionalNodeById(currentSnapshot, terminalNode.id);
    return Boolean(
      currentTerminal &&
        currentTerminal.metadata?.terminal?.liveSession === false &&
        currentTerminal.metadata.terminal.runtimeSessionId === undefined &&
        currentTerminal.status !== 'live'
    );
  }, 30000);
  await writeJsonFile(sharedPath('owner-saw-terminal-stop.json'), {
    ok: true
  });

  await waitForJsonFile(sharedPath('attacher-deleted-agent.json'), 60000);
  snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentAgent = findOptionalNodeById(currentSnapshot, agentNode.id);
    return Boolean(
      currentAgent &&
        currentAgent.metadata?.agent?.liveSession === false &&
        currentAgent.metadata.agent.runtimeSessionId === undefined &&
        currentAgent.metadata.agent.lastExitMessage?.includes('Agent 会话已删除')
    );
  }, 30000);
  await writeJsonFile(sharedPath('owner-saw-agent-delete.json'), {
    ok: true
  });

  await vscode.commands.executeCommand(COMMAND_IDS.testResetState);
  await waitForRuntimeSupervisorSettled(0, 20000);
  await setRuntimePersistenceEnabled(false);
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
}

async function runAttacherWindow() {
  const ownerReady = await waitForJsonFile(sharedPath('owner-ready.json'), 60000);
  await activateExtension();
  await vscode.commands.executeCommand(COMMAND_IDS.testResetState);
  await configureAgentCommandOverrides();
  await setRuntimePersistenceEnabled(true);
  await simulateRuntimeReload();
  await openCanvasEditor();

  await vscode.commands.executeCommand(COMMAND_IDS.testSetPersistedState, ownerReady.state);
  let snapshot = await waitForBothLive(ownerReady.agentNodeId, ownerReady.terminalNodeId);
  let agentNode = findNodeById(snapshot, ownerReady.agentNodeId);
  let terminalNode = findNodeById(snapshot, ownerReady.terminalNodeId);
  assert.strictEqual(agentNode.metadata.agent.runtimeSessionId, ownerReady.agentSessionId);
  assert.strictEqual(terminalNode.metadata.terminal.runtimeSessionId, ownerReady.terminalSessionId);
  assert.strictEqual(agentNode.metadata.agent.runtimeStoragePath, ownerReady.agentRuntimeStoragePath);
  assert.strictEqual(terminalNode.metadata.terminal.runtimeStoragePath, ownerReady.terminalRuntimeStoragePath);
  assertExecutionRuntimeMetadata(agentNode, 'agent');
  assertExecutionRuntimeMetadata(terminalNode, 'terminal');
  const runtimeState = await waitForRuntimeSupervisorSettled(2, 20000);
  assertRuntimeSupervisorSessions(runtimeState, [
    {
      sessionId: ownerReady.agentSessionId,
      nodeId: ownerReady.agentNodeId,
      kind: 'agent',
      runtimeStoragePath: ownerReady.agentRuntimeStoragePath
    },
    {
      sessionId: ownerReady.terminalSessionId,
      nodeId: ownerReady.terminalNodeId,
      kind: 'terminal',
      runtimeStoragePath: ownerReady.terminalRuntimeStoragePath
    }
  ]);
  await writeJsonFile(sharedPath('attacher-attached.json'), {
    ok: true
  });

  await sendExecutionInput(ownerReady.agentNodeId, 'agent', `${MARKERS.attacherAgent}\r`);
  await sendExecutionInput(ownerReady.terminalNodeId, 'terminal', `echo ${MARKERS.attacherTerminal}\r`);
  snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentAgent = findOptionalNodeById(currentSnapshot, ownerReady.agentNodeId);
    const currentTerminal = findOptionalNodeById(currentSnapshot, ownerReady.terminalNodeId);
    return Boolean(
      currentAgent?.metadata?.agent?.recentOutput?.includes(MARKERS.attacherAgent) &&
        currentTerminal?.metadata?.terminal?.recentOutput?.includes(MARKERS.attacherTerminal)
    );
  }, 30000);
  await writeJsonFile(sharedPath('attacher-saw-own-input.json'), {
    ok: true
  });

  await waitForJsonFile(sharedPath('owner-saw-attacher-input.json'), 60000);
  await waitForJsonFile(sharedPath('owner-sent-input.json'), 60000);
  snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentAgent = findOptionalNodeById(currentSnapshot, ownerReady.agentNodeId);
    const currentTerminal = findOptionalNodeById(currentSnapshot, ownerReady.terminalNodeId);
    return Boolean(
      currentAgent?.metadata?.agent?.recentOutput?.includes(MARKERS.ownerAgent) &&
        currentTerminal?.metadata?.terminal?.recentOutput?.includes(MARKERS.ownerTerminal)
    );
  }, 30000);
  await writeJsonFile(sharedPath('attacher-saw-owner-input.json'), {
    ok: true
  });

  await resizeExecution(ownerReady.terminalNodeId, 'terminal', RESIZE_COLS, RESIZE_ROWS);
  snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentTerminal = findOptionalNodeById(currentSnapshot, ownerReady.terminalNodeId);
    return Boolean(
      currentTerminal?.metadata?.terminal?.lastCols === RESIZE_COLS &&
        currentTerminal.metadata.terminal.lastRows === RESIZE_ROWS
    );
  }, 30000);
  await writeJsonFile(sharedPath('attacher-resized-terminal.json'), {
    ok: true
  });

  await waitForJsonFile(sharedPath('owner-saw-resize.json'), 60000);
  await stopExecution(ownerReady.terminalNodeId, 'terminal');
  snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentTerminal = findOptionalNodeById(currentSnapshot, ownerReady.terminalNodeId);
    return Boolean(
      currentTerminal &&
        currentTerminal.metadata?.terminal?.liveSession === false &&
        currentTerminal.metadata.terminal.runtimeSessionId === undefined &&
        currentTerminal.status !== 'live'
    );
  }, 30000);
  await writeJsonFile(sharedPath('attacher-stopped-terminal.json'), {
    ok: true
  });

  await waitForJsonFile(sharedPath('owner-saw-terminal-stop.json'), 60000);
  await deleteNode(ownerReady.agentNodeId);
  snapshot = await waitForSnapshot(
    (currentSnapshot) => !findOptionalNodeById(currentSnapshot, ownerReady.agentNodeId),
    30000
  );
  await writeJsonFile(sharedPath('attacher-deleted-agent.json'), {
    ok: true
  });

  await waitForJsonFile(sharedPath('owner-saw-agent-delete.json'), 60000);
  await vscode.commands.executeCommand(COMMAND_IDS.testResetState);
  await setRuntimePersistenceEnabled(false);
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
}

async function activateExtension() {
  await activateVisibleExtension(vscode, EXTENSION_ID);
  await waitForCommand(vscode, COMMAND_IDS.openCanvasInEditor);
  await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInEditor);
  await waitForCommand(vscode, COMMAND_IDS.testResetState);
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
}

async function openCanvasEditor() {
  await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInEditor);
  await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'editor', 20000);
}

async function createExecutionNodes() {
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
}

async function startExecution(nodeId, kind, payload) {
  await dispatchWebviewMessage({
    type: 'webview/startExecutionSession',
    payload: {
      nodeId,
      kind,
      ...payload
    }
  });
}

async function sendExecutionInput(nodeId, kind, data) {
  await dispatchWebviewMessage({
    type: 'webview/executionInput',
    payload: {
      nodeId,
      kind,
      data
    }
  });
}

async function resizeExecution(nodeId, kind, cols, rows) {
  await dispatchWebviewMessage({
    type: 'webview/resizeExecutionSession',
    payload: {
      nodeId,
      kind,
      cols,
      rows
    }
  });
}

async function stopExecution(nodeId, kind) {
  await dispatchWebviewMessage({
    type: 'webview/stopExecutionSession',
    payload: {
      nodeId,
      kind
    }
  });
}

async function deleteNode(nodeId) {
  await dispatchWebviewMessage({
    type: 'webview/deleteNode',
    payload: {
      nodeId
    }
  });
}

async function dispatchWebviewMessage(message) {
  return vscode.commands.executeCommand(COMMAND_IDS.testDispatchWebviewMessage, message, 'editor');
}

async function getDebugSnapshot() {
  return vscode.commands.executeCommand(COMMAND_IDS.testGetDebugState);
}

async function getRuntimeSupervisorState() {
  return vscode.commands.executeCommand(COMMAND_IDS.testGetRuntimeSupervisorState);
}

async function flushPersistedState() {
  return vscode.commands.executeCommand(COMMAND_IDS.testFlushPersistedState);
}

async function simulateRuntimeReload() {
  return vscode.commands.executeCommand(COMMAND_IDS.testSimulateRuntimeReload);
}

async function waitForBothLive(agentNodeId, terminalNodeId) {
  return waitForSnapshot((snapshot) => {
    const agentNode = findOptionalNodeById(snapshot, agentNodeId);
    const terminalNode = findOptionalNodeById(snapshot, terminalNodeId);
    return Boolean(
      agentNode?.metadata?.agent?.liveSession &&
        agentNode.metadata.agent.attachmentState === 'attached-live' &&
        agentNode.metadata.agent.runtimeSessionId &&
        terminalNode?.metadata?.terminal?.liveSession &&
        terminalNode.metadata.terminal.attachmentState === 'attached-live' &&
        terminalNode.metadata.terminal.runtimeSessionId
    );
  }, 30000);
}

async function waitForRuntimeSupervisorSettled(expectedSessionCount, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let lastState = await getRuntimeSupervisorState();

  while (Date.now() < deadline) {
    const sessions = getExpectedRuntimeRegistrySessions(lastState).filter((session) => session.live);
    if (
      sessions.length === expectedSessionCount &&
      lastState.bindings.length === expectedSessionCount &&
      lastState.pendingRuntimeSupervisorOperationCount === 0
    ) {
      return lastState;
    }

    await sleep(100);
    lastState = await getRuntimeSupervisorState();
  }

  assert.fail(
    `Timed out while waiting for runtime supervisor live sessions to settle. Last state: ${JSON.stringify(lastState)}`
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

  assert.fail(`Timed out while waiting for two-window shared runtime state. Last snapshot: ${JSON.stringify(lastSnapshot)}`);
}

async function setRuntimePersistenceEnabled(enabled) {
  await vscode.workspace
    .getConfiguration()
    .update('devSessionCanvas.runtimePersistence.enabled', enabled, vscode.ConfigurationTarget.Global);
}

async function configureAgentCommandOverrides() {
  const codexCommand = await resolveSmokeCommand('DEV_SESSION_CANVAS_TEST_CODEX_COMMAND', ['fixtures', 'fake-agent-provider']);
  assert.ok(codexCommand, 'Missing fake agent provider for two-window shared runtime smoke.');
  const claudeCommand =
    (await resolveSmokeCommand('DEV_SESSION_CANVAS_TEST_CLAUDE_COMMAND', ['fixtures', 'missing-agent-provider'])) ||
    path.join(__dirname, 'fixtures', 'missing-agent-provider');

  const configuration = vscode.workspace.getConfiguration();
  await configuration.update('devSessionCanvas.agent.codexCommand', codexCommand, vscode.ConfigurationTarget.Global);
  await configuration.update('devSessionCanvas.agent.claudeCommand', claudeCommand, vscode.ConfigurationTarget.Global);
}

async function resolveSmokeCommand(envKey, relativePathSegments) {
  const configuredPath = process.env[envKey]?.trim();
  if (configuredPath) {
    return configuredPath;
  }

  const fallbackPath = path.join(__dirname, ...relativePathSegments);
  try {
    await fs.access(fallbackPath);
    return fallbackPath;
  } catch {
    return undefined;
  }
}

function findNodeByKind(snapshot, kind) {
  const node = snapshot.state.nodes.find((currentNode) => currentNode.kind === kind);
  assert.ok(node, `Missing ${kind} node in snapshot.`);
  return node;
}

function findNodeById(snapshot, nodeId) {
  const node = findOptionalNodeById(snapshot, nodeId);
  assert.ok(node, `Missing node ${nodeId}.`);
  return node;
}

function findOptionalNodeById(snapshot, nodeId) {
  return snapshot.state.nodes.find((currentNode) => currentNode.id === nodeId);
}

function assertExecutionRuntimeMetadata(node, kind) {
  const metadata = kind === 'agent' ? node.metadata.agent : node.metadata.terminal;
  assert.strictEqual(
    metadata.runtimeBackend,
    expectedRuntimeBackend,
    `${kind} runtime backend mismatch`
  );
  assert.strictEqual(
    metadata.runtimeGuarantee,
    expectedRuntimeGuarantee,
    `${kind} runtime guarantee mismatch`
  );
  assert.ok(metadata.runtimeStoragePath, `${kind} runtime storage path mismatch`);
}

function getExpectedRuntimeRegistrySessions(runtimeSupervisorState) {
  const registryState = runtimeSupervisorState?.registries?.[expectedRuntimeBackend];
  assert.ok(registryState, `Missing runtime supervisor registry for backend ${expectedRuntimeBackend}.`);
  assert.strictEqual(
    registryState.error,
    undefined,
    `Unexpected runtime supervisor registry error for backend ${expectedRuntimeBackend}: ${registryState.error}`
  );

  const dedupedSessions = new Map();
  const registryEntries =
    Array.isArray(registryState.entries) && registryState.entries.length > 0
      ? registryState.entries
      : [registryState];

  for (const entry of registryEntries) {
    const sessions = Array.isArray(entry?.registry?.sessions) ? entry.registry.sessions : [];
    for (const session of sessions) {
      if (session?.sessionId) {
        dedupedSessions.set(session.sessionId, session);
      }
    }
  }

  return Array.from(dedupedSessions.values());
}

function assertRuntimeSupervisorSessions(runtimeSupervisorState, expectedSessions) {
  const sessions = getExpectedRuntimeRegistrySessions(runtimeSupervisorState);
  assert.strictEqual(
    sessions.length,
    expectedSessions.length,
    `Expected ${expectedSessions.length} runtime supervisor sessions, got ${sessions.length}.`
  );
  assert.strictEqual(
    runtimeSupervisorState.bindings.length,
    expectedSessions.length,
    `Expected ${expectedSessions.length} runtime supervisor bindings, got ${runtimeSupervisorState.bindings.length}.`
  );

  for (const expectedSession of expectedSessions) {
    const session = sessions.find((currentSession) => currentSession.sessionId === expectedSession.sessionId);
    assert.ok(session, `Missing runtime supervisor session ${expectedSession.sessionId}.`);
    assert.strictEqual(session.kind, expectedSession.kind);

    const binding = runtimeSupervisorState.bindings.find(
      (currentBinding) => currentBinding.runtimeSessionId === expectedSession.sessionId
    );
    assert.ok(binding, `Missing runtime supervisor binding for session ${expectedSession.sessionId}.`);
    assert.strictEqual(binding.nodeId, expectedSession.nodeId);
    assert.strictEqual(binding.kind, expectedSession.kind);
    assert.strictEqual(binding.runtimeBackend, expectedRuntimeBackend);
    assert.strictEqual(binding.runtimeStoragePath, expectedSession.runtimeStoragePath);
  }
}

async function waitForJsonFile(filePath, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      return JSON.parse(await fs.readFile(filePath, 'utf8'));
    } catch (error) {
      lastError = error;
      await sleep(100);
    }
  }

  throw new Error(`Timed out waiting for ${filePath}: ${lastError?.message ?? 'not found'}`);
}

async function writeJsonFile(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function sharedPath(fileName) {
  return path.join(sharedDir, fileName);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function writeFailureArtifacts(error) {
  if (!artifactDir) {
    return;
  }

  await fs.mkdir(artifactDir, { recursive: true });
  await fs.writeFile(
    path.join(artifactDir, `two-window-shared-runtime-${role}-failure-error.txt`),
    formatError(error),
    'utf8'
  );

  try {
    const snapshot = await getDebugSnapshot();
    await fs.writeFile(
      path.join(artifactDir, `two-window-shared-runtime-${role}-failure-snapshot.json`),
      `${JSON.stringify(snapshot, null, 2)}\n`,
      'utf8'
    );
  } catch {
    // Ignore snapshot capture errors during teardown.
  }

  try {
    const runtimeSupervisorState = await getRuntimeSupervisorState();
    await fs.writeFile(
      path.join(artifactDir, `two-window-shared-runtime-${role}-failure-runtime-supervisor.json`),
      `${JSON.stringify(runtimeSupervisorState, null, 2)}\n`,
      'utf8'
    );
  } catch {
    // Ignore runtime supervisor capture errors during teardown.
  }
}

function formatError(error) {
  if (error instanceof Error) {
    return error.stack || error.message;
  }

  return String(error);
}

async function resolveRuntimeInputs() {
  const workspaceRoot =
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
  const controlFilePath =
    process.env.DEV_SESSION_CANVAS_TWO_WINDOW_CONTROL_FILE ||
    path.join(workspaceRoot, '.debug', 'vscode-smoke', 'two-window-shared-runtime-control.json');
  const defaultArtifactDir =
    process.env.DEV_SESSION_CANVAS_SMOKE_ARTIFACT_DIR ||
    path.join(workspaceRoot, '.debug', 'vscode-smoke', 'artifacts');

  let controlPayload = null;
  try {
    controlPayload = JSON.parse(await fs.readFile(controlFilePath, 'utf8'));
  } catch (error) {
    if (error && typeof error === 'object' && error.code !== 'ENOENT') {
      throw error;
    }
  }

  role = controlPayload?.role || process.env.DEV_SESSION_CANVAS_TWO_WINDOW_ROLE || 'owner';
  artifactDir = controlPayload?.artifactDir || defaultArtifactDir;
  sharedDir =
    controlPayload?.sharedDir ||
    process.env.DEV_SESSION_CANVAS_TWO_WINDOW_SHARED_DIR ||
    path.join(defaultArtifactDir, 'two-window-shared-runtime');
  await fs.mkdir(sharedDir, { recursive: true });
}
