const assert = require('assert');
const { spawn } = require('child_process');
const { createHash } = require('crypto');
const fs = require('fs/promises');
const net = require('net');
const os = require('os');
const path = require('path');
const vscode = require('vscode');
const { activateVisibleExtension, waitForCommand } = require('./test-helpers.cjs');

const EXTENSION_ID = 'devsessioncanvas.dev-session-canvas';
const COMMAND_IDS = {
  openCanvasInPanel: 'devSessionCanvas.openCanvasInPanel',
  testGetDebugState: 'devSessionCanvas.__test.getDebugState',
  testGetDiagnosticEvents: 'devSessionCanvas.__test.getDiagnosticEvents',
  testClearDiagnosticEvents: 'devSessionCanvas.__test.clearDiagnosticEvents',
  testWaitForCanvasReady: 'devSessionCanvas.__test.waitForCanvasReady',
  testCaptureWebviewProbe: 'devSessionCanvas.__test.captureWebviewProbe',
  testPerformWebviewDomAction: 'devSessionCanvas.__test.performWebviewDomAction',
  testDispatchWebviewMessage: 'devSessionCanvas.__test.dispatchWebviewMessage',
  testFlushPersistedState: 'devSessionCanvas.__test.flushPersistedState',
  testSimulateRuntimeReload: 'devSessionCanvas.__test.simulateRuntimeReload',
  testSetPersistedState: 'devSessionCanvas.__test.setPersistedState',
  testResetState: 'devSessionCanvas.__test.resetState'
};
const LEGACY_AGENT_NODE_ID = 'legacy-upgrade-agent';
const LEGACY_TERMINAL_NODE_ID = 'legacy-upgrade-terminal';
const PREVIOUS_GENERATION_STREAM_TERMINAL_NODE_ID = 'previous-generation-stream-terminal';
const LEGACY_AGENT_MARKER = 'LEGACY_UPGRADE_AGENT_READY';
const LEGACY_TERMINAL_MARKER = 'LEGACY_UPGRADE_TERMINAL_READY';
const PREVIOUS_GENERATION_STREAM_MARKER = 'PREVIOUS_GENERATION_STREAM_READY';
const LEGACY_WEBVIEW_INPUT_MARKER = 'LEGACY_WEBVIEW_INPUT_REACHED_PTY';
const LEGACY_HOST_AGENT_INPUT_MARKER = 'LEGACY_HOST_AGENT_INPUT_REACHED_PTY';
const LEGACY_HOST_TERMINAL_INPUT_MARKER = 'LEGACY_HOST_TERMINAL_INPUT_REACHED_PTY';
const CURRENT_TERMINAL_INPUT_MARKER = 'CURRENT_TERMINAL_INPUT_REACHED_PTY';
const SHORT_FALLBACK_SOCKET_DIGEST_LENGTH = 16;

module.exports = {
  run
};

async function run() {
  const legacySupervisorScript = process.env.DEV_SESSION_CANVAS_LEGACY_SUPERVISOR_SCRIPT;
  const legacySupervisorRef = process.env.DEV_SESSION_CANVAS_LEGACY_SUPERVISOR_REF;
  assert.ok(legacySupervisorScript, 'Expected a historical Supervisor binary path from the smoke runner.');
  assert.ok(legacySupervisorRef, 'Expected a historical Supervisor source ref from the smoke runner.');

  const extension = await activateVisibleExtension(vscode, EXTENSION_ID);
  await waitForCommand(vscode, COMMAND_IDS.openCanvasInPanel);
  await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInPanel);
  await waitForCommand(vscode, COMMAND_IDS.testResetState);

  const configuration = vscode.workspace.getConfiguration();
  const previousRuntimePersistenceEnabled = configuration.get('devSessionCanvas.runtimePersistence.enabled', false);
  let legacySupervisorProcess;
  let previousGenerationStreamSupervisorProcess;
  let supervisorPaths;
  let previousGenerationStreamSupervisorPaths;
  let currentSupervisorPaths;
  let legacyAgentSessionId;
  let legacyTerminalSessionId;
  let previousGenerationStreamTerminalSessionId;
  let previousGenerationStreamRuntimeStoragePath;
  let currentTerminalSessionId;

  try {
    await setRuntimePersistenceEnabled(true);
    await vscode.commands.executeCommand(COMMAND_IDS.testResetState);
    await simulateRuntimeReload();
    await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInPanel);
    await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'panel', 20000);

    const baselineFlush = await flushPersistedState();
    assert.strictEqual(baselineFlush.lastError, undefined);
    assert.strictEqual(baselineFlush.exists, true);
    const runtimeStoragePath = path.dirname(baselineFlush.snapshotPath);
    supervisorPaths = resolveLegacyRuntimeSupervisorPathsFromStorageDir(
      path.join(runtimeStoragePath, 'runtime-supervisor')
    );
    previousGenerationStreamRuntimeStoragePath = path.join(runtimeStoragePath, 'previous-generation-stream');
    previousGenerationStreamSupervisorPaths = resolveLegacyRuntimeSupervisorPathsFromStorageDir(
      path.join(previousGenerationStreamRuntimeStoragePath, 'runtime-supervisor')
    );
    await fs.rm(supervisorPaths.storageDir, { recursive: true, force: true });
    await fs.rm(previousGenerationStreamSupervisorPaths.storageDir, { recursive: true, force: true });

    legacySupervisorProcess = startLegacyRuntimeSupervisor(
      legacySupervisorScript,
      extension.extensionPath,
      supervisorPaths.storageDir
    );
    const legacyHello = await waitForRuntimeSupervisorReady(supervisorPaths, 20000);
    assert.strictEqual(legacyHello.serverVersion, 1);
    assert.strictEqual(legacyHello.pid, legacySupervisorProcess.pid);
    assert.strictEqual(legacyHello.capabilities, undefined);

    previousGenerationStreamSupervisorProcess = startLegacyRuntimeSupervisor(
      path.join(extension.extensionPath, 'dist', 'runtime-supervisor.js'),
      extension.extensionPath,
      previousGenerationStreamSupervisorPaths.storageDir
    );
    const previousGenerationStreamHello = await waitForRuntimeSupervisorReady(
      previousGenerationStreamSupervisorPaths,
      20000
    );
    assert.strictEqual(previousGenerationStreamHello.pid, previousGenerationStreamSupervisorProcess.pid);
    assert.strictEqual(previousGenerationStreamHello.capabilities?.terminalSessionStreamV1, true);

    const legacyAgentSnapshot = await createLegacyAgentSession(supervisorPaths);
    const legacyTerminalSnapshot = await createLegacyTerminalSession(supervisorPaths);
    legacyAgentSessionId = legacyAgentSnapshot.sessionId;
    legacyTerminalSessionId = legacyTerminalSnapshot.sessionId;
    const previousGenerationStreamTerminalSnapshot = await createLegacyTerminalSession(
      previousGenerationStreamSupervisorPaths,
      PREVIOUS_GENERATION_STREAM_MARKER
    );
    previousGenerationStreamTerminalSessionId = previousGenerationStreamTerminalSnapshot.sessionId;
    await waitForRuntimeSupervisorOutput(
      supervisorPaths,
      legacyAgentSessionId,
      LEGACY_AGENT_MARKER,
      20000
    );
    await waitForRuntimeSupervisorOutput(
      supervisorPaths,
      legacyTerminalSessionId,
      LEGACY_TERMINAL_MARKER,
      20000
    );
    await waitForRuntimeSupervisorOutput(
      previousGenerationStreamSupervisorPaths,
      previousGenerationStreamTerminalSessionId,
      PREVIOUS_GENERATION_STREAM_MARKER,
      20000
    );
    await waitForRegistrySessions(supervisorPaths.registryPath, [legacyAgentSessionId, legacyTerminalSessionId]);

    await setPersistedState(
      createLegacyRuntimeState({
        runtimeStoragePath,
        agentSnapshot: legacyAgentSnapshot,
        terminalSnapshot: legacyTerminalSnapshot,
        previousGenerationStreamRuntimeStoragePath,
        previousGenerationStreamTerminalSnapshot
      })
    );
    await simulateRuntimeReload();
    await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInPanel);
    await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'panel', 20000);

    let snapshot = await waitForSnapshot((currentSnapshot) => {
      const agentNode = findOptionalNodeById(currentSnapshot, LEGACY_AGENT_NODE_ID);
      const terminalNode = findOptionalNodeById(currentSnapshot, LEGACY_TERMINAL_NODE_ID);
      const previousGenerationStreamNode = findOptionalNodeById(
        currentSnapshot,
        PREVIOUS_GENERATION_STREAM_TERMINAL_NODE_ID
      );
      return Boolean(
        agentNode?.metadata?.agent?.liveSession &&
          agentNode.metadata.agent.attachmentState === 'attached-live' &&
          agentNode.metadata.agent.terminalProjectionMode === 'legacy-interactive' &&
          agentNode.metadata.agent.recentOutput?.includes(LEGACY_AGENT_MARKER) &&
          terminalNode?.metadata?.terminal?.liveSession &&
          terminalNode.metadata.terminal.attachmentState === 'attached-live' &&
          terminalNode.metadata.terminal.terminalProjectionMode === 'legacy-interactive' &&
          terminalNode.metadata.terminal.recentOutput?.includes(LEGACY_TERMINAL_MARKER) &&
          previousGenerationStreamNode?.metadata?.terminal?.liveSession &&
          previousGenerationStreamNode.metadata.terminal.attachmentState === 'attached-live' &&
          previousGenerationStreamNode.metadata.terminal.terminalProjectionMode === 'terminal-stream-v1' &&
          previousGenerationStreamNode.metadata.terminal.recentOutput?.includes(PREVIOUS_GENERATION_STREAM_MARKER)
      );
    }, 30000);
    assertLegacyInteractiveNode(findNodeById(snapshot, LEGACY_AGENT_NODE_ID), 'agent', LEGACY_AGENT_MARKER);
    assertLegacyInteractiveNode(findNodeById(snapshot, LEGACY_TERMINAL_NODE_ID), 'terminal', LEGACY_TERMINAL_MARKER);
    assert.strictEqual(
      findNodeById(snapshot, PREVIOUS_GENERATION_STREAM_TERMINAL_NODE_ID).metadata.terminal.runtimeStoragePath,
      previousGenerationStreamRuntimeStoragePath
    );

    const probe = await waitForWebviewProbe((currentProbe) => {
      const agentNode = findOptionalProbeNodeById(currentProbe, LEGACY_AGENT_NODE_ID);
      const terminalNode = findOptionalProbeNodeById(currentProbe, LEGACY_TERMINAL_NODE_ID);
      return Boolean(
        agentNode?.terminalVisibleLines?.join('\n').includes(LEGACY_AGENT_MARKER) &&
          terminalNode?.terminalVisibleLines?.join('\n').includes(LEGACY_TERMINAL_MARKER)
      );
    });
    assertLegacyInteractiveProjection(findProbeNodeById(probe, LEGACY_AGENT_NODE_ID), LEGACY_AGENT_MARKER);
    assertLegacyInteractiveProjection(findProbeNodeById(probe, LEGACY_TERMINAL_NODE_ID), LEGACY_TERMINAL_MARKER);
    const legacyAgentProbeBeforeResize = findProbeNodeById(probe, LEGACY_AGENT_NODE_ID);
    const legacyTerminalProbeBeforeResize = findProbeNodeById(probe, LEGACY_TERMINAL_NODE_ID);
    assert.ok(legacyAgentProbeBeforeResize.terminalCols && legacyAgentProbeBeforeResize.terminalRows);
    assert.ok(legacyTerminalProbeBeforeResize.terminalCols && legacyTerminalProbeBeforeResize.terminalRows);

    await clearDiagnosticEvents();
    await performWebviewDomAction({
      kind: 'sendExecutionInput',
      nodeId: LEGACY_TERMINAL_NODE_ID,
      data: `printf '${LEGACY_WEBVIEW_INPUT_MARKER}\\n'\r`
    });
    await waitForRuntimeSupervisorOutput(
      supervisorPaths,
      legacyTerminalSessionId,
      LEGACY_WEBVIEW_INPUT_MARKER,
      20000
    );
    await dispatchWebviewMessage({
      type: 'webview/executionInput',
      payload: {
        nodeId: LEGACY_AGENT_NODE_ID,
        kind: 'agent',
        data: `${LEGACY_HOST_AGENT_INPUT_MARKER}\r`
      }
    });
    await dispatchWebviewMessage({
      type: 'webview/executionInput',
      payload: {
        nodeId: LEGACY_TERMINAL_NODE_ID,
        kind: 'terminal',
        data: `printf '${LEGACY_HOST_TERMINAL_INPUT_MARKER}\\n'\r`
      }
    });
    const legacyAgentNodeBeforeResize = findNodeById(snapshot, LEGACY_AGENT_NODE_ID);
    const legacyTerminalNodeBeforeResize = findNodeById(snapshot, LEGACY_TERMINAL_NODE_ID);
    const resizedLegacyAgentNodeSize = { width: 680, height: 520 };
    const resizedLegacyTerminalNodeSize = { width: 700, height: 540 };
    await dispatchWebviewMessage({
      type: 'webview/resizeNode',
      payload: {
        nodeId: LEGACY_AGENT_NODE_ID,
        position: legacyAgentNodeBeforeResize.position,
        size: resizedLegacyAgentNodeSize
      }
    });
    await dispatchWebviewMessage({
      type: 'webview/resizeNode',
      payload: {
        nodeId: LEGACY_TERMINAL_NODE_ID,
        position: legacyTerminalNodeBeforeResize.position,
        size: resizedLegacyTerminalNodeSize
      }
    });
    snapshot = await waitForSnapshot((currentSnapshot) => {
      const agentNode = findOptionalNodeById(currentSnapshot, LEGACY_AGENT_NODE_ID);
      const terminalNode = findOptionalNodeById(currentSnapshot, LEGACY_TERMINAL_NODE_ID);
      return Boolean(
        agentNode?.size?.width === resizedLegacyAgentNodeSize.width &&
          agentNode.size.height === resizedLegacyAgentNodeSize.height &&
          terminalNode?.size?.width === resizedLegacyTerminalNodeSize.width &&
          terminalNode.size.height === resizedLegacyTerminalNodeSize.height
      );
    }, 20000);
    const resizedLegacyProbe = await waitForWebviewProbe((currentProbe) => {
      const agentNode = findOptionalProbeNodeById(currentProbe, LEGACY_AGENT_NODE_ID);
      const terminalNode = findOptionalProbeNodeById(currentProbe, LEGACY_TERMINAL_NODE_ID);
      return Boolean(
        agentNode?.terminalCols &&
          agentNode.terminalRows &&
          terminalNode?.terminalCols &&
          terminalNode.terminalRows &&
          (agentNode.terminalCols !== legacyAgentProbeBeforeResize.terminalCols ||
            agentNode.terminalRows !== legacyAgentProbeBeforeResize.terminalRows) &&
          (terminalNode.terminalCols !== legacyTerminalProbeBeforeResize.terminalCols ||
            terminalNode.terminalRows !== legacyTerminalProbeBeforeResize.terminalRows)
      );
    });
    const resizedLegacyAgentProbe = findProbeNodeById(resizedLegacyProbe, LEGACY_AGENT_NODE_ID);
    const resizedLegacyTerminalProbe = findProbeNodeById(resizedLegacyProbe, LEGACY_TERMINAL_NODE_ID);
    const agentAfterCompatibilityOperations = await waitForRuntimeSupervisorSession(
      supervisorPaths,
      legacyAgentSessionId,
      (session) =>
        session.output?.includes(LEGACY_HOST_AGENT_INPUT_MARKER) &&
        session.cols === resizedLegacyAgentProbe.terminalCols &&
        session.rows === resizedLegacyAgentProbe.terminalRows,
      20000
    );
    const terminalAfterCompatibilityOperations = await waitForRuntimeSupervisorSession(
      supervisorPaths,
      legacyTerminalSessionId,
      (session) =>
        session.output?.includes(LEGACY_HOST_TERMINAL_INPUT_MARKER) &&
        session.cols === resizedLegacyTerminalProbe.terminalCols &&
        session.rows === resizedLegacyTerminalProbe.terminalRows,
      20000
    );
    assert.ok(agentAfterCompatibilityOperations.output.includes(LEGACY_HOST_AGENT_INPUT_MARKER));
    assert.ok(terminalAfterCompatibilityOperations.output.includes(LEGACY_WEBVIEW_INPUT_MARKER));
    assert.ok(terminalAfterCompatibilityOperations.output.includes(LEGACY_HOST_TERMINAL_INPUT_MARKER));
    assert.deepStrictEqual(
      [agentAfterCompatibilityOperations.cols, agentAfterCompatibilityOperations.rows],
      [resizedLegacyAgentProbe.terminalCols, resizedLegacyAgentProbe.terminalRows]
    );
    assert.deepStrictEqual(
      [terminalAfterCompatibilityOperations.cols, terminalAfterCompatibilityOperations.rows],
      [resizedLegacyTerminalProbe.terminalCols, resizedLegacyTerminalProbe.terminalRows]
    );

    const nodeIdsBeforeCurrentCreate = new Set(snapshot.state.nodes.map((node) => node.id));
    await dispatchWebviewMessage({
      type: 'webview/createDemoNode',
      payload: {
        kind: 'terminal',
        preferredPosition: { x: 1180, y: 120 }
      }
    });
    snapshot = await waitForSnapshot(
      (currentSnapshot) => currentSnapshot.state.nodes.some((node) => !nodeIdsBeforeCurrentCreate.has(node.id)),
      20000
    );
    const currentTerminalNode = snapshot.state.nodes.find((node) => !nodeIdsBeforeCurrentCreate.has(node.id));
    assert.ok(currentTerminalNode);
    await dispatchWebviewMessage({
      type: 'webview/startExecutionSession',
      payload: {
        nodeId: currentTerminalNode.id,
        kind: 'terminal',
        cols: 92,
        rows: 28
      }
    });
    snapshot = await waitForSnapshot((currentSnapshot) => {
      const node = findOptionalNodeById(currentSnapshot, currentTerminalNode.id);
      return Boolean(
        node?.metadata?.terminal?.liveSession &&
          node.metadata.terminal.attachmentState === 'attached-live' &&
          node.metadata.terminal.terminalProjectionMode === 'terminal-stream-v1' &&
          node.metadata.terminal.runtimeStoragePath &&
          node.metadata.terminal.runtimeSessionId
      );
    }, 30000);
    const currentTerminalMetadata = findNodeById(snapshot, currentTerminalNode.id).metadata.terminal;
    currentTerminalSessionId = currentTerminalMetadata.runtimeSessionId;
    assert.ok(currentTerminalSessionId);
    assert.notStrictEqual(path.normalize(currentTerminalMetadata.runtimeStoragePath), path.normalize(runtimeStoragePath));
    assert.ok(currentTerminalMetadata.runtimeStoragePath.includes('runtime-supervisor-generations'));
    currentSupervisorPaths = resolveLegacyRuntimeSupervisorPathsFromStorageDir(
      path.join(currentTerminalMetadata.runtimeStoragePath, 'runtime-supervisor')
    );
    const currentHello = await waitForRuntimeSupervisorReady(currentSupervisorPaths, 20000);
    assert.strictEqual(currentHello.capabilities?.terminalSessionStreamV1, true);
    assert.strictEqual(currentHello.capabilities?.terminalProjectionSnapshotV1, true);
    assert.notStrictEqual(currentHello.pid, legacyHello.pid);
    await waitForRegistrySessions(currentSupervisorPaths.registryPath, [currentTerminalSessionId]);

    const legacyRegistry = await readRegistry(supervisorPaths.registryPath);
    assert.deepStrictEqual(
      new Set(legacyRegistry.sessions.map((session) => session.sessionId)),
      new Set([legacyAgentSessionId, legacyTerminalSessionId])
    );
    await performWebviewDomAction({
      kind: 'sendExecutionInput',
      nodeId: currentTerminalNode.id,
      data: `printf '${CURRENT_TERMINAL_INPUT_MARKER}\\n'\r`
    });
    await waitForRuntimeSupervisorOutput(
      currentSupervisorPaths,
      currentTerminalSessionId,
      CURRENT_TERMINAL_INPUT_MARKER,
      20000
    );

    await clearDiagnosticEvents();
    await performWebviewDomAction({
      kind: 'clickNodeActionButton',
      nodeId: PREVIOUS_GENERATION_STREAM_TERMINAL_NODE_ID,
      action: 'stop'
    });
    const completedPreviousGenerationStreamSnapshot = await waitForSnapshot((currentSnapshot) => {
      const node = findOptionalNodeById(currentSnapshot, PREVIOUS_GENERATION_STREAM_TERMINAL_NODE_ID);
      return Boolean(node && node.metadata?.terminal?.liveSession === false && node.status !== 'live');
    }, 30000);
    assert.strictEqual(
      findNodeById(completedPreviousGenerationStreamSnapshot, PREVIOUS_GENERATION_STREAM_TERMINAL_NODE_ID)
        .metadata.terminal.terminalProjectionMode,
      undefined
    );

    await performWebviewDomAction({
      kind: 'clickNodeActionButton',
      nodeId: LEGACY_TERMINAL_NODE_ID,
      action: 'stop'
    });
    await waitForSnapshot((currentSnapshot) => {
      const node = findOptionalNodeById(currentSnapshot, LEGACY_TERMINAL_NODE_ID);
      return Boolean(node && node.metadata?.terminal?.liveSession === false && node.status !== 'live');
    }, 30000);

    await performWebviewDomAction({
      kind: 'clickNodeActionButton',
      nodeId: LEGACY_AGENT_NODE_ID,
      action: 'delete'
    });
    await waitForSnapshot(
      (currentSnapshot) => !findOptionalNodeById(currentSnapshot, LEGACY_AGENT_NODE_ID),
      30000
    );
    await waitForDiagnosticEvent(
      (event) =>
        event.kind === 'runtime/legacySupervisorClientRetired' &&
        path.normalize(event.detail?.runtimeStoragePath) === path.normalize(previousGenerationStreamRuntimeStoragePath),
      20000
    );
    await waitForDiagnosticEvent(
      (event) =>
        event.kind === 'runtime/legacySupervisorClientRetired' &&
        path.normalize(event.detail?.runtimeStoragePath) === path.normalize(runtimeStoragePath),
      20000
    );

    const [legacyExit, previousGenerationStreamExit] = await Promise.all([
      waitForChildProcessExit(legacySupervisorProcess, 45000),
      waitForChildProcessExit(previousGenerationStreamSupervisorProcess, 45000)
    ]);
    assert.deepStrictEqual(legacyExit, { code: 0, signal: null });
    assert.deepStrictEqual(previousGenerationStreamExit, { code: 0, signal: null });
    legacySupervisorProcess = undefined;
    previousGenerationStreamSupervisorProcess = undefined;

    await performWebviewDomAction({
      kind: 'sendExecutionInput',
      nodeId: currentTerminalNode.id,
      data: `printf 'CURRENT_AFTER_LEGACY_EXIT\\n'\r`
    });
    await waitForRuntimeSupervisorOutput(
      currentSupervisorPaths,
      currentTerminalSessionId,
      'CURRENT_AFTER_LEGACY_EXIT',
      20000
    );

    await dispatchWebviewMessage({
      type: 'webview/deleteNode',
      payload: { nodeId: currentTerminalNode.id }
    });
    await waitForSnapshot(
      (currentSnapshot) => !findOptionalNodeById(currentSnapshot, currentTerminalNode.id),
      30000
    );
  } finally {
    if (supervisorPaths) {
      for (const sessionId of [legacyAgentSessionId, legacyTerminalSessionId].filter(Boolean)) {
        await sendRuntimeSupervisorRequest(supervisorPaths, 'deleteSession', { sessionId }).catch(() => undefined);
      }
    }
    if (currentSupervisorPaths && currentTerminalSessionId) {
      await sendRuntimeSupervisorRequest(currentSupervisorPaths, 'deleteSession', {
        sessionId: currentTerminalSessionId
      }).catch(() => undefined);
    }
    if (previousGenerationStreamSupervisorPaths && previousGenerationStreamTerminalSessionId) {
      await sendRuntimeSupervisorRequest(previousGenerationStreamSupervisorPaths, 'deleteSession', {
        sessionId: previousGenerationStreamTerminalSessionId
      }).catch(() => undefined);
    }
    await stopProcess(legacySupervisorProcess);
    await stopProcess(previousGenerationStreamSupervisorProcess);
    await vscode.commands.executeCommand(COMMAND_IDS.testResetState).catch(() => undefined);
    await setRuntimePersistenceEnabled(previousRuntimePersistenceEnabled).catch(() => undefined);
  }
}

function createLegacyRuntimeState({
  runtimeStoragePath,
  agentSnapshot,
  terminalSnapshot,
  previousGenerationStreamRuntimeStoragePath,
  previousGenerationStreamTerminalSnapshot
}) {
  const workspaceRoot = getWorkspaceRoot();
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    nodes: [
      {
        id: LEGACY_AGENT_NODE_ID,
        kind: 'agent',
        title: 'Legacy Supervisor Agent',
        status: 'reattaching',
        summary: 'Reattaching legacy Agent runtime.',
        position: { x: 80, y: 100 },
        size: { width: 560, height: 430 },
        metadata: {
          agent: {
            backend: 'node-pty',
            lifecycle: agentSnapshot.lifecycle,
            provider: 'codex',
            runtimeKind: 'pty-cli',
            resumeSupported: false,
            resumeStrategy: 'none',
            shellPath: process.env.DEV_SESSION_CANVAS_TEST_CODEX_COMMAND,
            cwd: workspaceRoot,
            persistenceMode: 'live-runtime',
            attachmentState: 'reattaching',
            runtimeBackend: 'legacy-detached',
            runtimeGuarantee: 'best-effort',
            liveSession: false,
            runtimeSessionId: agentSnapshot.sessionId,
            runtimeStoragePath,
            recentOutput: '',
            outputSequence: agentSnapshot.outputSequence,
            lastCols: agentSnapshot.cols,
            lastRows: agentSnapshot.rows,
            lastBackendLabel: 'Codex'
          }
        }
      },
      {
        id: LEGACY_TERMINAL_NODE_ID,
        kind: 'terminal',
        title: 'Legacy Supervisor Terminal',
        status: 'reattaching',
        summary: 'Reattaching legacy Terminal runtime.',
        position: { x: 720, y: 100 },
        size: { width: 560, height: 430 },
        metadata: {
          terminal: {
            backend: 'node-pty',
            lifecycle: terminalSnapshot.lifecycle,
            shellPath: resolveShellPath(),
            cwd: workspaceRoot,
            persistenceMode: 'live-runtime',
            attachmentState: 'reattaching',
            runtimeBackend: 'legacy-detached',
            runtimeGuarantee: 'best-effort',
            liveSession: false,
            runtimeSessionId: terminalSnapshot.sessionId,
            runtimeStoragePath,
            recentOutput: '',
            outputSequence: terminalSnapshot.outputSequence,
            lastCols: terminalSnapshot.cols,
            lastRows: terminalSnapshot.rows
          }
        }
      },
      {
        id: PREVIOUS_GENERATION_STREAM_TERMINAL_NODE_ID,
        kind: 'terminal',
        title: 'Previous Generation Stream Terminal',
        status: 'reattaching',
        summary: 'Reattaching previous-generation stream Terminal runtime.',
        position: { x: 1360, y: 100 },
        size: { width: 560, height: 430 },
        metadata: {
          terminal: {
            backend: 'node-pty',
            lifecycle: previousGenerationStreamTerminalSnapshot.lifecycle,
            shellPath: resolveShellPath(),
            cwd: workspaceRoot,
            persistenceMode: 'live-runtime',
            attachmentState: 'reattaching',
            runtimeBackend: 'legacy-detached',
            runtimeGuarantee: 'best-effort',
            liveSession: false,
            runtimeSessionId: previousGenerationStreamTerminalSnapshot.sessionId,
            runtimeStoragePath: previousGenerationStreamRuntimeStoragePath,
            recentOutput: '',
            outputSequence: previousGenerationStreamTerminalSnapshot.outputSequence,
            lastCols: previousGenerationStreamTerminalSnapshot.cols,
            lastRows: previousGenerationStreamTerminalSnapshot.rows
          }
        }
      }
    ]
  };
}

function startLegacyRuntimeSupervisor(scriptPath, extensionPath, storageDir) {
  const child = spawn(
    process.env.DEV_SESSION_CANVAS_TEST_NODE_PATH || process.execPath,
    [
      scriptPath,
      '--storage-dir',
      storageDir,
      '--runtime-backend',
      'legacy-detached',
      '--runtime-guarantee',
      'best-effort'
    ],
    {
      cwd: extensionPath,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        ELECTRON_NO_ATTACH_CONSOLE: '1',
        NODE_PATH: path.join(extensionPath, 'node_modules')
      },
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true
    }
  );
  child.stderr?.on('data', (chunk) => {
    process.stderr.write(`[legacy-supervisor] ${chunk}`);
  });
  return child;
}

async function createLegacyAgentSession(supervisorPaths) {
  const providerPath = process.env.DEV_SESSION_CANVAS_TEST_CODEX_COMMAND;
  assert.ok(providerPath, 'Expected fake Agent provider path for legacy Supervisor smoke.');
  const snapshot = await sendRuntimeSupervisorRequest(supervisorPaths, 'createSession', {
    kind: 'agent',
    displayLabel: 'Codex',
    launchMode: 'start',
    provider: 'codex',
    resumeStrategy: 'none',
    scrollback: 1200,
    launchSpec: {
      file: providerPath,
      args: [],
      cwd: getWorkspaceRoot(),
      cols: 92,
      rows: 28,
      env: serializeProcessEnv(process.env),
      terminalName: 'xterm-256color'
    }
  });
  await sendRuntimeSupervisorRequest(supervisorPaths, 'writeInput', {
    sessionId: snapshot.sessionId,
    data: `${LEGACY_AGENT_MARKER}\r`
  });
  return snapshot;
}

async function createLegacyTerminalSession(supervisorPaths, marker = LEGACY_TERMINAL_MARKER) {
  const snapshot = await sendRuntimeSupervisorRequest(supervisorPaths, 'createSession', {
    kind: 'terminal',
    displayLabel: resolveShellPath(),
    launchMode: 'start',
    scrollback: 1200,
    launchSpec: {
      file: resolveShellPath(),
      args: [],
      cwd: getWorkspaceRoot(),
      cols: 92,
      rows: 28,
      env: serializeProcessEnv(process.env),
      terminalName: 'xterm-256color'
    }
  });
  await sendRuntimeSupervisorRequest(supervisorPaths, 'writeInput', {
    sessionId: snapshot.sessionId,
    data: `printf '\\033[31m${marker}\\033[0m\\n'\r`
  });
  return snapshot;
}

function assertLegacyInteractiveNode(node, kind, marker) {
  const metadata = node.metadata?.[kind];
  assert.strictEqual(metadata?.terminalProjectionMode, 'legacy-interactive');
  assert.strictEqual(metadata?.liveSession, true);
  assert.strictEqual(metadata?.attachmentState, 'attached-live');
  assert.ok(metadata?.recentOutput?.includes(marker));
  assert.strictEqual(metadata?.recentOutput?.includes('\u001b'), false);
  assert.strictEqual(metadata?.terminalStream, undefined);
}

function assertLegacyInteractiveProjection(node, marker) {
  assert.ok(node.terminalVisibleLines?.join('\n').includes(marker));
}

async function waitForRuntimeSupervisorReady(supervisorPaths, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      return await sendRuntimeSupervisorRequest(supervisorPaths, 'hello');
    } catch (error) {
      lastError = error;
    }
    await sleep(100);
  }
  assert.fail(`Timed out waiting for Supervisor socket ${supervisorPaths.socketPath}: ${lastError?.message}`);
}

async function waitForRuntimeSupervisorOutput(supervisorPaths, sessionId, marker, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastSnapshot;
  while (Date.now() < deadline) {
    lastSnapshot = await sendRuntimeSupervisorRequest(supervisorPaths, 'attachSession', { sessionId });
    if (lastSnapshot.output?.includes(marker)) {
      return lastSnapshot;
    }
    await sleep(100);
  }
  assert.fail(`Timed out waiting for ${marker}. Last snapshot: ${JSON.stringify(lastSnapshot)}`);
}

async function waitForRuntimeSupervisorSession(supervisorPaths, sessionId, predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastSnapshot;
  while (Date.now() < deadline) {
    lastSnapshot = await sendRuntimeSupervisorRequest(supervisorPaths, 'attachSession', { sessionId });
    if (predicate(lastSnapshot)) {
      return lastSnapshot;
    }
    await sleep(100);
  }
  assert.fail(`Timed out waiting for runtime session state. Last snapshot: ${JSON.stringify(lastSnapshot)}`);
}

async function sendRuntimeSupervisorRequest(supervisorPaths, method, params) {
  const socket = net.createConnection(supervisorPaths.socketPath);
  const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let settled = false;
  let buffer = '';

  return new Promise((resolve, reject) => {
    const finalize = (callback, value) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      callback(value);
    };

    socket.setEncoding('utf8');
    socket.once('error', (error) => finalize(reject, error));
    socket.once('connect', () => {
      socket.write(JSON.stringify(params === undefined
        ? { type: 'request', id: requestId, method }
        : { type: 'request', id: requestId, method, params }) + '\n');
    });
    socket.on('data', (chunk) => {
      buffer += chunk;
      while (true) {
        const newlineIndex = buffer.indexOf('\n');
        if (newlineIndex < 0) {
          return;
        }
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!line) {
          continue;
        }
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (message.type !== 'response' || message.id !== requestId) {
          continue;
        }
        if (message.ok) {
          finalize(resolve, message.result);
        } else {
          finalize(reject, new Error(message.error?.message || `Supervisor request ${method} failed.`));
        }
        return;
      }
    });
    socket.once('close', () => {
      if (!settled) {
        finalize(reject, new Error(`Supervisor socket closed before ${method} completed.`));
      }
    });
  });
}

function resolveLegacyRuntimeSupervisorPathsFromStorageDir(storageDir) {
  const normalizedStorageDir = path.resolve(storageDir);
  const registryPath = path.join(normalizedStorageDir, 'registry.json');
  const digest = createHash('sha1').update(normalizedStorageDir).digest('hex').slice(0, 24);
  const storageSocketPath = path.join(normalizedStorageDir, 'supervisor.sock');
  if (isUnixSocketPathWithinLimit(storageSocketPath)) {
    return { storageDir: normalizedStorageDir, socketPath: storageSocketPath, registryPath };
  }

  for (const runtimeDir of resolvePrivateRuntimeDirCandidates(path.resolve(os.tmpdir()))) {
    for (const socketFileName of resolveLegacyRuntimePrivateSocketFileNames(digest)) {
      const socketPath = path.join(runtimeDir, socketFileName);
      if (isUnixSocketPathWithinLimit(socketPath)) {
        return { storageDir: normalizedStorageDir, socketPath, registryPath };
      }
    }
  }

  throw new Error('Unable to resolve a Unix socket path for the legacy runtime Supervisor.');
}

function resolvePrivateRuntimeDirCandidates(tmpDir) {
  const candidates = [];
  const xdgRuntimeDir = normalizeAbsoluteDirectory(process.env.XDG_RUNTIME_DIR);
  if (xdgRuntimeDir) {
    candidates.push(path.join(xdgRuntimeDir, 'dev-session-canvas'));
  }
  const userId = typeof process.getuid === 'function' ? String(process.getuid()) : 'shared';
  candidates.push(path.join(tmpDir, `dev-session-canvas-${userId}`));
  candidates.push(path.join(tmpDir, `dsc-${userId}`));
  return Array.from(new Set(candidates));
}

function resolveLegacyRuntimePrivateSocketFileNames(digest) {
  return Array.from(new Set([
    `supervisor-${digest}.sock`,
    `${digest}.sock`,
    `${digest.slice(0, SHORT_FALLBACK_SOCKET_DIGEST_LENGTH)}.sock`
  ]));
}

function isUnixSocketPathWithinLimit(value) {
  return Buffer.byteLength(value, 'utf8') <= 104;
}

function normalizeAbsoluteDirectory(value) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized && path.isAbsolute(normalized) ? path.normalize(normalized) : undefined;
}

async function waitForRegistrySessions(registryPath, sessionIds, timeoutMs = 10000) {
  const expected = new Set(sessionIds);
  const deadline = Date.now() + timeoutMs;
  let lastRegistry;
  while (Date.now() < deadline) {
    try {
      lastRegistry = await readRegistry(registryPath);
      const actual = new Set(lastRegistry.sessions.map((session) => session.sessionId));
      if (actual.size === expected.size && [...expected].every((sessionId) => actual.has(sessionId))) {
        return lastRegistry;
      }
    } catch {
      // Wait for the old Supervisor's deferred registry write.
    }
    await sleep(100);
  }
  assert.fail(`Timed out waiting for legacy registry sessions. Last registry: ${JSON.stringify(lastRegistry)}`);
}

async function readRegistry(registryPath) {
  return JSON.parse(await fs.readFile(registryPath, 'utf8'));
}

async function waitForChildProcessExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return { code: child.exitCode, signal: child.signalCode };
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.removeListener('exit', onExit);
      reject(new Error(`Legacy Supervisor ${child.pid} did not exit within ${timeoutMs}ms.`));
    }, timeoutMs);
    const onExit = (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal });
    };
    child.once('exit', onExit);
  });
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  await new Promise((resolve) => {
    const forceKill = setTimeout(() => child.kill('SIGKILL'), 1500);
    child.once('exit', () => {
      clearTimeout(forceKill);
      resolve();
    });
    child.kill('SIGTERM');
  });
}

async function waitForSnapshot(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastSnapshot = await getDebugSnapshot();
  while (Date.now() < deadline) {
    if (predicate(lastSnapshot)) {
      return lastSnapshot;
    }
    await sleep(100);
    lastSnapshot = await getDebugSnapshot();
  }
  assert.fail(`Timed out waiting for legacy upgrade state. Last snapshot: ${JSON.stringify(lastSnapshot)}`);
}

async function waitForWebviewProbe(predicate, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let lastProbe;
  while (Date.now() < deadline) {
    lastProbe = await vscode.commands.executeCommand(COMMAND_IDS.testCaptureWebviewProbe, 'panel', 5000, 0);
    if (predicate(lastProbe)) {
      return lastProbe;
    }
    await sleep(100);
  }
  assert.fail(`Timed out waiting for legacy Webview transcript. Last probe: ${JSON.stringify(lastProbe)}`);
}

async function waitForDiagnosticEvent(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let events = await getDiagnosticEvents();
  while (Date.now() < deadline) {
    const match = events.find(predicate);
    if (match) {
      return match;
    }
    await sleep(100);
    events = await getDiagnosticEvents();
  }
  assert.fail(`Timed out waiting for diagnostic event. Last events: ${JSON.stringify(events)}`);
}

function findOptionalNodeById(snapshot, nodeId) {
  return snapshot.state.nodes.find((node) => node.id === nodeId);
}

function findNodeById(snapshot, nodeId) {
  const node = findOptionalNodeById(snapshot, nodeId);
  assert.ok(node, `Missing node ${nodeId}.`);
  return node;
}

function findOptionalProbeNodeById(probe, nodeId) {
  return probe?.nodes?.find((node) => node.nodeId === nodeId);
}

function findProbeNodeById(probe, nodeId) {
  const node = findOptionalProbeNodeById(probe, nodeId);
  assert.ok(node, `Missing Webview probe node ${nodeId}.`);
  return node;
}

function getWorkspaceRoot() {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(workspaceFolder, 'Expected an open workspace for legacy Supervisor smoke.');
  return workspaceFolder.uri.fsPath;
}

function resolveShellPath() {
  return process.env.SHELL || '/bin/bash';
}

function serializeProcessEnv(env) {
  return Object.fromEntries(Object.entries(env).filter((entry) => typeof entry[1] === 'string'));
}

async function getDebugSnapshot() {
  return vscode.commands.executeCommand(COMMAND_IDS.testGetDebugState);
}

async function getDiagnosticEvents() {
  return vscode.commands.executeCommand(COMMAND_IDS.testGetDiagnosticEvents);
}

async function clearDiagnosticEvents() {
  return vscode.commands.executeCommand(COMMAND_IDS.testClearDiagnosticEvents);
}

async function dispatchWebviewMessage(message) {
  return vscode.commands.executeCommand(COMMAND_IDS.testDispatchWebviewMessage, message, 'panel');
}

async function performWebviewDomAction(action) {
  return vscode.commands.executeCommand(COMMAND_IDS.testPerformWebviewDomAction, action, 'panel', 5000);
}

async function flushPersistedState() {
  return vscode.commands.executeCommand(COMMAND_IDS.testFlushPersistedState);
}

async function setPersistedState(state) {
  return vscode.commands.executeCommand(COMMAND_IDS.testSetPersistedState, state);
}

async function simulateRuntimeReload() {
  return vscode.commands.executeCommand(COMMAND_IDS.testSimulateRuntimeReload);
}

async function setRuntimePersistenceEnabled(enabled) {
  return vscode.workspace
    .getConfiguration()
    .update('devSessionCanvas.runtimePersistence.enabled', enabled, vscode.ConfigurationTarget.Global);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
