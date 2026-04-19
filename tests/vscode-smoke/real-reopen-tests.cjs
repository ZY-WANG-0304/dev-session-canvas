const assert = require('assert');
const path = require('path');
const fs = require('fs/promises');
const vscode = require('vscode');

const EXTENSION_ID = 'devsessioncanvas.dev-session-canvas';
const COMMAND_IDS = {
  openCanvasInEditor: 'devSessionCanvas.openCanvasInEditor',
  testGetDebugState: 'devSessionCanvas.__test.getDebugState',
  testGetRuntimeSupervisorState: 'devSessionCanvas.__test.getRuntimeSupervisorState',
  testWaitForCanvasReady: 'devSessionCanvas.__test.waitForCanvasReady',
  testDispatchWebviewMessage: 'devSessionCanvas.__test.dispatchWebviewMessage',
  testFlushPersistedState: 'devSessionCanvas.__test.flushPersistedState',
  testSimulateRuntimeReload: 'devSessionCanvas.__test.simulateRuntimeReload',
  testResetState: 'devSessionCanvas.__test.resetState'
};

const OFFLINE_SLEEP_SECONDS = 12;
const AGENT_REOPEN_OUTPUT = '[fake-agent] REAL_REOPEN_AGENT';
const AGENT_POST_REOPEN_OUTPUT = '[fake-agent] AFTER_REOPEN_AGENT';
const AGENT_SETUP_OUTPUT = `[fake-agent] sleeping ${OFFLINE_SLEEP_SECONDS}s`;
const TERMINAL_SETUP_OUTPUT = 'REAL_REOPEN_TERMINAL_SLEEPING';
const TERMINAL_REOPEN_OUTPUT = 'REAL_REOPEN_TERMINAL';
const TERMINAL_POST_REOPEN_OUTPUT = 'AFTER_REOPEN_TERMINAL';
const expectedRuntimeBackend =
  process.env.DEV_SESSION_CANVAS_EXPECTED_RUNTIME_BACKEND || 'legacy-detached';
const expectedRuntimeGuarantee =
  process.env.DEV_SESSION_CANVAS_EXPECTED_RUNTIME_GUARANTEE || 'best-effort';
let artifactDir;
let phase = 'verify';
let stateFile;

module.exports = {
  run
};

async function run() {
  try {
    await resolveRuntimeInputs();
    console.log(`[real-reopen] phase=${phase} start`);
    if (phase === 'setup') {
      await runSetupPhase();
      console.log('[real-reopen] phase=setup ready-for-exit');
      return;
    }

    if (phase === 'verify') {
      await runVerifyPhase();
      console.log('[real-reopen] phase=verify completed');
      return;
    }

    throw new Error(`Unknown real reopen smoke phase: ${phase}`);
  } catch (error) {
    await writeFailureArtifacts(error);
    throw error;
  }
}

async function runSetupPhase() {
  await activateExtension();
  await vscode.commands.executeCommand(COMMAND_IDS.testResetState);
  await waitForRuntimeSupervisorSettled(0, 20000);
  await fs.mkdir(path.dirname(stateFile), { recursive: true });
  await fs.rm(stateFile, { force: true });
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

  let liveSnapshot = await waitForAgentLive(agentNode.id);
  liveSnapshot = await waitForTerminalLive(terminalNode.id);

  const liveAgentNode = findNodeById(liveSnapshot, agentNode.id);
  const liveTerminalNode = findNodeById(liveSnapshot, terminalNode.id);
  assertExecutionRuntimeMetadata(liveAgentNode, 'agent');
  assertExecutionRuntimeMetadata(liveTerminalNode, 'terminal');
  const liveRuntimeState = await waitForRuntimeSupervisorSettled(2, 20000);
  assertRuntimeSupervisorSessions(liveRuntimeState, [
    {
      sessionId: liveAgentNode.metadata.agent.runtimeSessionId,
      nodeId: agentNode.id,
      kind: 'agent'
    },
    {
      sessionId: liveTerminalNode.metadata.terminal.runtimeSessionId,
      nodeId: terminalNode.id,
      kind: 'terminal'
    }
  ]);

  await sendExecutionInput(agentNode.id, 'agent', `sleep ${OFFLINE_SLEEP_SECONDS}\rREAL_REOPEN_AGENT\r`);
  await sendExecutionInput(
    terminalNode.id,
    'terminal',
    `echo ${TERMINAL_SETUP_OUTPUT}; sleep ${OFFLINE_SLEEP_SECONDS}; echo ${TERMINAL_REOPEN_OUTPUT}\r`
  );

  await waitForSnapshot((currentSnapshot) => {
    const currentAgent = currentSnapshot.state.nodes.find((node) => node.id === agentNode.id);
    const currentTerminal = currentSnapshot.state.nodes.find((node) => node.id === terminalNode.id);
    return Boolean(
      currentAgent?.metadata?.agent?.recentOutput?.includes(AGENT_SETUP_OUTPUT) &&
        currentTerminal?.metadata?.terminal?.recentOutput?.includes(TERMINAL_SETUP_OUTPUT)
    );
  }, 15000);

  const flushResult = await flushPersistedState();
  assert.strictEqual(flushResult.lastError, undefined);
  assert.strictEqual(flushResult.exists, true);
  assert.ok(flushResult.snapshotPath, 'Missing persisted canvas snapshot path.');
  assert.strictEqual(flushResult.snapshot?.activeSurface, 'editor');
  assert.strictEqual(flushResult.snapshot?.state?.nodes?.length, 2);

  if (artifactDir) {
    await fs.writeFile(
      path.join(artifactDir, 'real-reopen-flush-result.json'),
      `${JSON.stringify(flushResult, null, 2)}\n`,
      'utf8'
    );
  }

  await fs.writeFile(
    stateFile,
    `${JSON.stringify(
      {
        agentNodeId: agentNode.id,
        terminalNodeId: terminalNode.id,
        agentSessionId: liveAgentNode.metadata.agent.runtimeSessionId,
        terminalSessionId: liveTerminalNode.metadata.terminal.runtimeSessionId,
        agentRuntimeStoragePath: liveAgentNode.metadata.agent.runtimeStoragePath,
        terminalRuntimeStoragePath: liveTerminalNode.metadata.terminal.runtimeStoragePath
      },
      null,
      2
    )}\n`,
    'utf8'
  );
}

async function runVerifyPhase() {
  await activateExtension();
  await openCanvasEditor();

  const expected = JSON.parse(await fs.readFile(stateFile, 'utf8'));

  let snapshot = await waitForSnapshot((currentSnapshot) => {
    const agentNode = currentSnapshot.state.nodes.find((node) => node.id === expected.agentNodeId);
    const terminalNode = currentSnapshot.state.nodes.find((node) => node.id === expected.terminalNodeId);
    return Boolean(agentNode && terminalNode);
  }, 20000);

  let agentNode = findNodeById(snapshot, expected.agentNodeId);
  let terminalNode = findNodeById(snapshot, expected.terminalNodeId);
  assert.strictEqual(agentNode.metadata.agent.persistenceMode, 'live-runtime');
  assert.strictEqual(terminalNode.metadata.terminal.persistenceMode, 'live-runtime');
  assert.notStrictEqual(agentNode.status, 'history-restored');
  assert.notStrictEqual(terminalNode.status, 'history-restored');
  assertExecutionRuntimeMetadata(agentNode, 'agent');
  assertExecutionRuntimeMetadata(terminalNode, 'terminal');

  snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentAgent = currentSnapshot.state.nodes.find((node) => node.id === expected.agentNodeId);
    const currentTerminal = currentSnapshot.state.nodes.find((node) => node.id === expected.terminalNodeId);
    return Boolean(
        currentAgent?.metadata?.agent?.liveSession &&
        currentAgent.metadata.agent.attachmentState === 'attached-live' &&
        currentAgent.metadata.agent.runtimeSessionId === expected.agentSessionId &&
        currentAgent.metadata.agent.runtimeStoragePath === expected.agentRuntimeStoragePath &&
        currentAgent.metadata.agent.recentOutput?.includes(AGENT_REOPEN_OUTPUT) &&
        currentTerminal?.metadata?.terminal?.liveSession &&
        currentTerminal.metadata.terminal.attachmentState === 'attached-live' &&
        currentTerminal.metadata.terminal.runtimeSessionId === expected.terminalSessionId &&
        currentTerminal.metadata.terminal.runtimeStoragePath === expected.terminalRuntimeStoragePath &&
        currentTerminal.metadata.terminal.recentOutput?.includes(TERMINAL_REOPEN_OUTPUT)
    );
  }, 35000);

  agentNode = findNodeById(snapshot, expected.agentNodeId);
  terminalNode = findNodeById(snapshot, expected.terminalNodeId);
  const reopenedRuntimeState = await waitForRuntimeSupervisorSettled(2, 20000);
  assertRuntimeSupervisorSessions(reopenedRuntimeState, [
    {
      sessionId: expected.agentSessionId,
      nodeId: expected.agentNodeId,
      kind: 'agent',
      runtimeStoragePath: expected.agentRuntimeStoragePath
    },
    {
      sessionId: expected.terminalSessionId,
      nodeId: expected.terminalNodeId,
      kind: 'terminal',
      runtimeStoragePath: expected.terminalRuntimeStoragePath
    }
  ]);

  assert.strictEqual(agentNode.metadata.agent.runtimeSessionId, expected.agentSessionId);
  assert.strictEqual(agentNode.metadata.agent.runtimeStoragePath, expected.agentRuntimeStoragePath);
  assert.strictEqual(agentNode.metadata.agent.liveSession, true);
  assert.strictEqual(agentNode.metadata.agent.attachmentState, 'attached-live');
  assert.ok(agentNode.metadata.agent.recentOutput.includes(AGENT_REOPEN_OUTPUT));
  assertExecutionRuntimeMetadata(agentNode, 'agent');

  assert.strictEqual(terminalNode.metadata.terminal.runtimeSessionId, expected.terminalSessionId);
  assert.strictEqual(
    terminalNode.metadata.terminal.runtimeStoragePath,
    expected.terminalRuntimeStoragePath
  );
  assert.strictEqual(terminalNode.metadata.terminal.liveSession, true);
  assert.strictEqual(terminalNode.metadata.terminal.attachmentState, 'attached-live');
  assert.ok(terminalNode.metadata.terminal.recentOutput.includes(TERMINAL_REOPEN_OUTPUT));
  assertExecutionRuntimeMetadata(terminalNode, 'terminal');

  await sendExecutionInput(expected.agentNodeId, 'agent', 'AFTER_REOPEN_AGENT\r');
  await sendExecutionInput(expected.terminalNodeId, 'terminal', `echo ${TERMINAL_POST_REOPEN_OUTPUT}\r`);

  snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentAgent = currentSnapshot.state.nodes.find((node) => node.id === expected.agentNodeId);
    const currentTerminal = currentSnapshot.state.nodes.find((node) => node.id === expected.terminalNodeId);
    return Boolean(
      currentAgent?.metadata?.agent?.recentOutput?.includes(AGENT_POST_REOPEN_OUTPUT) &&
        currentTerminal?.metadata?.terminal?.recentOutput?.includes(TERMINAL_POST_REOPEN_OUTPUT)
    );
  }, 15000);

  agentNode = findNodeById(snapshot, expected.agentNodeId);
  terminalNode = findNodeById(snapshot, expected.terminalNodeId);
  assert.ok(agentNode.metadata.agent.recentOutput.includes(AGENT_POST_REOPEN_OUTPUT));
  assert.ok(terminalNode.metadata.terminal.recentOutput.includes(TERMINAL_POST_REOPEN_OUTPUT));

  await vscode.commands.executeCommand(COMMAND_IDS.testResetState);
  await waitForRuntimeSupervisorSettled(0, 20000);
  await setRuntimePersistenceEnabled(false);
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
}

async function activateExtension() {
  const extension = vscode.extensions.getExtension(EXTENSION_ID);
  assert.ok(extension, `Missing extension ${EXTENSION_ID}.`);
  await extension.activate();
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

async function waitForRuntimeSupervisorSettled(expectedSessionCount, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let lastState = await getRuntimeSupervisorState();

  while (Date.now() < deadline) {
    const sessions = getExpectedRuntimeRegistrySessions(lastState);
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
    `Timed out while waiting for runtime supervisor to settle. Last state: ${JSON.stringify(lastState)}`
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

  assert.fail(`Timed out while waiting for real reopen smoke state. Last snapshot: ${JSON.stringify(lastSnapshot)}`);
}

async function waitForAgentLive(agentNodeId) {
  return waitForSnapshot((snapshot) => {
    const node = snapshot.state.nodes.find((currentNode) => currentNode.id === agentNodeId);
    return Boolean(
      node?.metadata?.agent?.liveSession &&
        node.metadata.agent.attachmentState === 'attached-live' &&
        node.metadata.agent.runtimeSessionId
    );
  }, 20000);
}

async function waitForTerminalLive(terminalNodeId) {
  return waitForSnapshot((snapshot) => {
    const node = snapshot.state.nodes.find((currentNode) => currentNode.id === terminalNodeId);
    return Boolean(
      node?.metadata?.terminal?.liveSession &&
        node.metadata.terminal.attachmentState === 'attached-live' &&
        node.metadata.terminal.runtimeSessionId
    );
  }, 20000);
}

async function setRuntimePersistenceEnabled(enabled) {
  await vscode.workspace
    .getConfiguration()
    .update('devSessionCanvas.runtimePersistence.enabled', enabled, vscode.ConfigurationTarget.Global);
}

async function configureAgentCommandOverrides() {
  const codexCommand = await resolveSmokeCommand('DEV_SESSION_CANVAS_TEST_CODEX_COMMAND', ['fixtures', 'fake-agent-provider']);
  assert.ok(codexCommand, 'Missing fake agent provider for real reopen smoke.');
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
  const node = snapshot.state.nodes.find((currentNode) => currentNode.id === nodeId);
  assert.ok(node, `Missing node ${nodeId}.`);
  return node;
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
    const sessions = entry?.registry?.sessions;
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
    if (expectedSession.runtimeStoragePath) {
      assert.strictEqual(binding.runtimeStoragePath, expectedSession.runtimeStoragePath);
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function writeFailureArtifacts(error) {
  if (!artifactDir) {
    return;
  }

  await fs.mkdir(artifactDir, { recursive: true });
  await fs.writeFile(path.join(artifactDir, `real-reopen-${phase}-failure-error.txt`), formatError(error), 'utf8');

  try {
    const snapshot = await getDebugSnapshot();
    await fs.writeFile(
      path.join(artifactDir, `real-reopen-${phase}-failure-snapshot.json`),
      `${JSON.stringify(snapshot, null, 2)}\n`,
      'utf8'
    );
  } catch {
    // Ignore snapshot capture errors during teardown.
  }

  try {
    const runtimeSupervisorState = await getRuntimeSupervisorState();
    await fs.writeFile(
      path.join(artifactDir, `real-reopen-${phase}-failure-runtime-supervisor.json`),
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
    process.env.DEV_SESSION_CANVAS_REAL_REOPEN_CONTROL_FILE ||
    path.join(workspaceRoot, '.debug', 'vscode-smoke', 'real-reopen-control.json');
  const defaultArtifactDir =
    process.env.DEV_SESSION_CANVAS_SMOKE_ARTIFACT_DIR || path.join(workspaceRoot, '.debug', 'vscode-smoke', 'artifacts');
  const defaultStateFile =
    process.env.DEV_SESSION_CANVAS_REAL_REOPEN_STATE_FILE ||
    path.join(defaultArtifactDir, 'real-reopen-state.json');

  let controlPayload = null;
  try {
    controlPayload = JSON.parse(await fs.readFile(controlFilePath, 'utf8'));
  } catch (error) {
    if (error && typeof error === 'object' && error.code !== 'ENOENT') {
      throw error;
    }
  }

  artifactDir = controlPayload?.artifactDir || defaultArtifactDir;
  phase = controlPayload?.phase || process.env.DEV_SESSION_CANVAS_REAL_REOPEN_PHASE || 'verify';
  stateFile = controlPayload?.stateFile || defaultStateFile;
}
