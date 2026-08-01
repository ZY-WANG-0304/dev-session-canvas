const assert = require('assert');
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
  testGetRuntimeSupervisorState: 'devSessionCanvas.__test.getRuntimeSupervisorState',
  testGetHostMessages: 'devSessionCanvas.__test.getHostMessages',
  testClearHostMessages: 'devSessionCanvas.__test.clearHostMessages',
  testWaitForCanvasReady: 'devSessionCanvas.__test.waitForCanvasReady',
  testDispatchWebviewMessage: 'devSessionCanvas.__test.dispatchWebviewMessage',
  testSetPersistedState: 'devSessionCanvas.__test.setPersistedState',
  testSimulateRuntimeReload: 'devSessionCanvas.__test.simulateRuntimeReload',
  testCreateNode: 'devSessionCanvas.__test.createNode',
  testStartExecutionSession: 'devSessionCanvas.__test.startExecutionSession',
  testResetState: 'devSessionCanvas.__test.resetState'
};
const OLD_TERMINAL_MARKER = 'REBOOT_RECOVERY_OLD_TERMINAL';
const OLD_TERMINAL_PID_PREFIX = 'REBOOT_RECOVERY_OLD_TERMINAL_PID=';
const JOURNAL_ONLY_LATE_OUTPUT_MARKER = 'REBOOT_RECOVERY_JOURNAL_ONLY_LATE_OUTPUT';
const OLD_AGENT_MARKER = 'REBOOT_RECOVERY_OLD_AGENT_SNAPSHOT';
const OLD_AGENT_BURST_COUNT = 512;
const NEW_AGENT_MARKER = 'REBOOT_RECOVERY_NEW_AGENT';
const NEW_TERMINAL_MARKER = 'REBOOT_RECOVERY_NEW_TERMINAL';
const SHORT_FALLBACK_SOCKET_DIGEST_LENGTH = 16;
const recoveryGatePath = process.env.DEV_SESSION_CANVAS_TEST_RUNTIME_SUPERVISOR_RECOVERY_GATE_PATH;
const recoveryJournalByteBudget = Number(
  process.env.DEV_SESSION_CANVAS_TEST_RUNTIME_SUPERVISOR_MAX_RECOVERY_JOURNAL_BYTES
);

module.exports = { run };

async function run() {
  assert.notStrictEqual(process.platform, 'win32', 'This smoke validates a Unix socket reset.');
  assert.ok(recoveryGatePath, 'Missing test-only Runtime Supervisor recovery gate path.');
  assert.ok(
    Number.isSafeInteger(recoveryJournalByteBudget) && recoveryJournalByteBudget > 0,
    'Missing a positive test-only Runtime Supervisor recovery Journal byte budget.'
  );
  await fs.rm(recoveryGatePath, { force: true });

  const extension = await activateVisibleExtension(vscode, EXTENSION_ID);
  assert.ok(extension, 'Expected the Dev Session Canvas extension to activate.');
  await waitForCommand(vscode, COMMAND_IDS.openCanvasInPanel);
  await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInPanel);
  await waitForCommand(vscode, COMMAND_IDS.testResetState);

  await setRuntimePersistenceEnabled(true);
  await vscode.commands.executeCommand(COMMAND_IDS.testResetState);
  await vscode.commands.executeCommand(COMMAND_IDS.testSimulateRuntimeReload);
  await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInPanel);
  await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'panel', 20000);

  let oldAgent;
  let oldAgentProcessId;
  let oldTerminal;
  let oldTerminalProcessId;
  let newAgent;
  let newTerminal;
  try {
    oldAgent = await createNode('agent', 'codex');
    await startExecution('agent', oldAgent.id, 'codex');
    await waitForNode((node) => isAttachedLiveAgent(node), 20000, oldAgent.id);
    const oldAgentReadyNode = await waitForNode(
      (node) => node.metadata?.agent?.recentOutput?.includes('[fake-agent] ready pid='),
      20000,
      oldAgent.id
    );
    oldAgentProcessId = parseAgentProcessId(oldAgentReadyNode.metadata.agent.recentOutput);
    await dispatchWebviewMessage({
      type: 'webview/executionInput',
      payload: {
        nodeId: oldAgent.id,
        kind: 'agent',
        data: `raw ${OLD_AGENT_MARKER}\r`
      }
    });
    await dispatchWebviewMessage({
      type: 'webview/executionInput',
      payload: {
        nodeId: oldAgent.id,
        kind: 'agent',
        data: `burst ${OLD_AGENT_BURST_COUNT}\r`
      }
    });
    const oldAgentLiveNode = await waitForNode(
      (node) =>
        node.metadata?.agent?.recentOutput?.includes(`[fake-agent] burst ${String(OLD_AGENT_BURST_COUNT).padStart(3, '0')}`) &&
        node.metadata.agent.resumeSupported === true &&
        Boolean(node.metadata.agent.resumeSessionId) &&
        Boolean(node.metadata.agent.resumeStoragePath),
      30000,
      oldAgent.id
    );
    const oldAgentRuntimeSessionId = oldAgentLiveNode.metadata.agent.runtimeSessionId;
    const oldAgentRuntimeStoragePath = oldAgentLiveNode.metadata.agent.runtimeStoragePath;
    const oldAgentOutputSequence = oldAgentLiveNode.metadata.agent.outputSequence;
    const oldAgentSerializedState = createSerializedTerminalStateFixture(OLD_AGENT_MARKER, oldAgentOutputSequence);
    const oldAgentResumeSessionId = oldAgentLiveNode.metadata.agent.resumeSessionId;
    const oldAgentResumeStoragePath = oldAgentLiveNode.metadata.agent.resumeStoragePath;
    assert.ok(oldAgentRuntimeSessionId, 'The old Agent must have a persisted Runtime Supervisor session id.');
    assert.ok(oldAgentRuntimeStoragePath, 'The old Agent must have a runtime storage path.');
    assert.ok(oldAgentResumeSessionId, 'The old Agent must have a resumable provider session id.');
    assert.ok(oldAgentResumeStoragePath, 'The old Agent must have a resumable provider storage path.');
    await synchronizeFakeProviderSession(oldAgentResumeStoragePath, oldAgentResumeSessionId);
    await waitForRegistrySession(oldAgentRuntimeSessionId, 20000);
    await waitForJournalBytes(
      path.join(oldAgentRuntimeStoragePath, 'runtime-supervisor'),
      oldAgentRuntimeSessionId,
      recoveryJournalByteBudget,
      30000
    );

    oldTerminal = await createNode('terminal');
    await startExecution('terminal', oldTerminal.id);
    await waitForNode((node) => isAttachedLiveTerminal(node), 20000, oldTerminal.id);
    await dispatchWebviewMessage({
      type: 'webview/executionInput',
      payload: {
        nodeId: oldTerminal.id,
        kind: 'terminal',
        data: `echo ${OLD_TERMINAL_MARKER}; echo ${OLD_TERMINAL_PID_PREFIX}$$\r`
      }
    });
    const oldLiveNode = await waitForNode(
      (node) => node.metadata?.terminal?.recentOutput?.includes(OLD_TERMINAL_MARKER),
      20000,
      oldTerminal.id
    );
    const oldRuntimeSessionId = oldLiveNode.metadata.terminal.runtimeSessionId;
    const oldRuntimeStoragePath = oldLiveNode.metadata.terminal.runtimeStoragePath;
    assert.ok(oldRuntimeSessionId, 'The old Terminal must have a persisted Runtime Supervisor session id.');
    assert.ok(oldRuntimeStoragePath, 'The old Terminal must have a runtime storage path.');
    oldTerminalProcessId = parseTerminalProcessId(oldLiveNode.metadata.terminal.recentOutput);
    await waitForRegistrySession(oldRuntimeSessionId, 20000);
    const oldTerminalOutputSequence = oldLiveNode.metadata.terminal.outputSequence;
    const oldTerminalSerializedState = createSerializedTerminalStateFixture(
      OLD_TERMINAL_MARKER,
      oldTerminalOutputSequence
    );

    const supervisorPaths = resolveLegacyRuntimeSupervisorPathsFromStorageDir(
      path.join(oldRuntimeStoragePath, 'runtime-supervisor')
    );
    assertIsolatedSupervisorSocketPath(supervisorPaths.socketPath, oldRuntimeStoragePath);
    const helloBeforeReboot = await sendRuntimeSupervisorRequest(supervisorPaths.socketPath, 'hello');
    assert.ok(Number.isInteger(helloBeforeReboot?.pid), 'Expected the old Supervisor hello response to expose its pid.');

    // This is the host-level reboot model: retain durable data, but lose the isolated volatile socket.
    await fs.writeFile(recoveryGatePath, 'hold journal recovery\n', 'utf8');
    process.kill(helloBeforeReboot.pid, 'SIGKILL');
    await waitForProcessExit(helloBeforeReboot.pid, 10000);
    await fs.rm(supervisorPaths.socketPath, { force: true });
    const journalMutation = await appendJournalOnlyV1Output(
      path.join(oldRuntimeStoragePath, 'runtime-supervisor'),
      oldRuntimeSessionId,
      `${JOURNAL_ONLY_LATE_OUTPUT_MARKER}\r\n`
    );
    assert.ok(
      journalMutation.lastRevision > oldTerminalOutputSequence,
      'The Journal fixture must be newer than the Host-persisted Terminal screen snapshot.'
    );

    const reloadedSnapshot = await vscode.commands.executeCommand(COMMAND_IDS.testSimulateRuntimeReload);
    const seededHistoryState = JSON.parse(JSON.stringify(reloadedSnapshot.state));
    const seededAgent = seededHistoryState.nodes.find((node) => node.id === oldAgent.id);
    const seededTerminal = seededHistoryState.nodes.find((node) => node.id === oldTerminal.id);
    assert.ok(seededAgent?.metadata?.agent, 'The Host reload must retain the old Agent metadata to seed its screen snapshot.');
    assert.ok(seededTerminal?.metadata?.terminal, 'The Host reload must retain the old Terminal metadata to seed its screen snapshot.');
    seededAgent.metadata.agent.outputSequence = oldAgentOutputSequence;
    seededAgent.metadata.agent.serializedTerminalState = oldAgentSerializedState;
    seededTerminal.metadata.terminal.outputSequence = oldTerminalOutputSequence;
    seededTerminal.metadata.terminal.serializedTerminalState = oldTerminalSerializedState;
    const seededHistorySnapshot = await vscode.commands.executeCommand(
      COMMAND_IDS.testSetPersistedState,
      seededHistoryState
    );
    const seededHistoryTerminal = seededHistorySnapshot.state.nodes.find((node) => node.id === oldTerminal.id);
    assert.deepStrictEqual(
      seededHistoryTerminal?.metadata?.terminal?.serializedTerminalState,
      oldTerminalSerializedState,
      'The fixture must retain a Host-persisted Terminal screen paired with the pre-reboot sequence.'
    );
    await vscode.commands.executeCommand(COMMAND_IDS.testClearHostMessages);
    // A new Host-side create is the deterministic trigger that recreates the killed Supervisor.
    newAgent = await createNode('agent', 'codex');
    await startExecution('agent', newAgent.id, 'codex');
    const recoveringHello = await waitForRecoveryPhase(supervisorPaths.socketPath, 'recovering', 20000);
    assert.ok(
      recoveringHello.recovery.pendingSessionCount >= 1,
      `Expected old journal recovery to report pending sessions: ${JSON.stringify(recoveringHello)}`
    );
    await waitForNode(
      (node) => node.status === 'reattaching' && node.metadata?.terminal?.attachmentState === 'reattaching',
      20000,
      oldTerminal.id
    );

    newTerminal = await createNode('terminal');
    await startExecution('terminal', newTerminal.id);

    const newAgentLive = await waitForNode((node) => isAttachedLiveAgent(node), 20000, newAgent.id);
    const newTerminalLive = await waitForNode((node) => isAttachedLiveTerminal(node), 20000, newTerminal.id);
    assert.ok(newAgentLive.metadata.agent.runtimeSessionId, 'Expected a new Agent session during journal recovery.');
    assert.ok(newTerminalLive.metadata.terminal.runtimeSessionId, 'Expected a new Terminal session during journal recovery.');

    await dispatchWebviewMessage({
      type: 'webview/executionInput',
      payload: {
        nodeId: newAgent.id,
        kind: 'agent',
        data: `${NEW_AGENT_MARKER}\r`
      }
    });
    await dispatchWebviewMessage({
      type: 'webview/executionInput',
      payload: {
        nodeId: newTerminal.id,
        kind: 'terminal',
        data: `echo ${NEW_TERMINAL_MARKER}\r`
      }
    });
    await waitForNode(
      (node) => node.metadata?.agent?.recentOutput?.includes(NEW_AGENT_MARKER),
      20000,
      newAgent.id
    );
    await waitForNode(
      (node) => node.metadata?.terminal?.recentOutput?.includes(NEW_TERMINAL_MARKER),
      20000,
      newTerminal.id
    );

    const messagesDuringRecovery = await vscode.commands.executeCommand(COMMAND_IDS.testGetHostMessages);
    assert.ok(
      messagesDuringRecovery.some(
        (message) =>
          message.type === 'host/stateUpdated' &&
          message.payload?.runtime?.runtimeRecovery?.pendingSessionCount >= 1
      ),
      `Expected Host to project the nonblocking recovery state: ${JSON.stringify(messagesDuringRecovery)}`
    );
    assert.ok(
      !JSON.stringify(messagesDuringRecovery).includes('Could not find'),
      `Supervisor recovery must not be rendered as a missing executable: ${JSON.stringify(messagesDuringRecovery)}`
    );

    await fs.rm(recoveryGatePath, { force: true });
    const readyHello = await waitForRecoveryPhase(supervisorPaths.socketPath, 'ready', 30000);
    assert.strictEqual(
      readyHello.recovery.failureCount ?? 0,
      0,
      `Dead-PTY recovery must not hydrate the over-budget V1 Journal: ${JSON.stringify(readyHello)}`
    );
    await waitForNode(
      (node) =>
        node.status === 'resume-ready' &&
        node.metadata?.agent?.lifecycle === 'resume-ready' &&
        node.metadata.agent.attachmentState === 'history-restored' &&
        node.metadata.agent.liveSession === false &&
        node.metadata.agent.pendingLaunch === undefined &&
        node.metadata.agent.resumeSupported === true &&
        Boolean(node.metadata.agent.resumeSessionId) &&
        Boolean(node.metadata.agent.resumeStoragePath) &&
        node.metadata.agent.serializedTerminalState?.data.includes(OLD_AGENT_MARKER),
      30000,
      oldAgent.id
    );
    await delay(750);
    const oldAgentBeforeExplicitResume = await getNode(oldAgent.id);
    assert.strictEqual(
      oldAgentBeforeExplicitResume.status,
      'resume-ready',
      `The dead Agent PTY must not auto-start a replacement resume process: ${JSON.stringify(oldAgentBeforeExplicitResume)}`
    );
    assert.strictEqual(oldAgentBeforeExplicitResume.metadata.agent.liveSession, false);
    assert.strictEqual(oldAgentBeforeExplicitResume.metadata.agent.pendingLaunch, undefined);
    assert.ok(
      !oldAgentBeforeExplicitResume.metadata.agent.recentOutput?.includes('[fake-agent] resumed session'),
      'No provider resume output may appear before the user explicitly requests Resume.'
    );
    const oldTerminalHistoryNode = await waitForNode(
      (node) =>
        node.metadata?.terminal?.attachmentState === 'history-restored' &&
        node.metadata.terminal.persistenceMode === 'snapshot-only' &&
        node.metadata.terminal.recentOutput?.includes(OLD_TERMINAL_MARKER) &&
        node.metadata.terminal.outputSequence === oldTerminalOutputSequence &&
        node.metadata.terminal.serializedTerminalState?.outputSequence === oldTerminalOutputSequence &&
        node.metadata.terminal.serializedTerminalState?.data.includes(OLD_TERMINAL_MARKER),
      30000,
      oldTerminal.id
    );
    assert.deepStrictEqual(
      oldTerminalHistoryNode.metadata.terminal.serializedTerminalState,
      oldTerminalSerializedState,
      'A Journal revision that the Host never rendered must not invalidate its saved Terminal screen.'
    );
    await waitForRegistrySessions(
      [
        newAgentLive.metadata.agent.runtimeSessionId,
        newTerminalLive.metadata.terminal.runtimeSessionId
      ],
      30000
    );

    await startExecution('agent', oldAgent.id, 'codex', true);
    await waitForNode(
      (node) =>
        isAttachedLiveAgent(node) &&
        node.metadata?.agent?.recentOutput?.includes('[fake-agent] resumed session'),
      30000,
      oldAgent.id
    );
  } finally {
    await fs.rm(recoveryGatePath, { force: true });
    stopProcessIfRunning(oldAgentProcessId);
    stopProcessIfRunning(oldTerminalProcessId);
    await vscode.commands.executeCommand(COMMAND_IDS.testResetState).catch(() => undefined);
    await setRuntimePersistenceEnabled(false).catch(() => undefined);
  }
}

function parseTerminalProcessId(output) {
  const match = new RegExp(`${OLD_TERMINAL_PID_PREFIX}(\\d+)`).exec(output ?? '');
  assert.ok(match, `Expected old Terminal output to include its shell pid: ${output ?? '<empty>'}`);
  const pid = Number(match[1]);
  assert.ok(Number.isInteger(pid) && pid > 0, `Expected a valid old Terminal shell pid: ${match[1]}`);
  return pid;
}

function parseAgentProcessId(output) {
  const match = /\[fake-agent\] ready pid=(\d+)/u.exec(output ?? '');
  assert.ok(match, `Expected old Agent output to include its provider pid: ${output ?? '<empty>'}`);
  const pid = Number(match[1]);
  assert.ok(Number.isInteger(pid) && pid > 0, `Expected a valid old Agent pid: ${match[1]}`);
  return pid;
}

function stopProcessIfRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return;
  }
  try {
    process.kill(pid, 'SIGKILL');
  } catch (error) {
    if (error?.code !== 'ESRCH') {
      throw error;
    }
  }
}

async function createNode(kind, provider) {
  const snapshot = await vscode.commands.executeCommand(COMMAND_IDS.testCreateNode, kind, provider);
  const nodes = snapshot?.state?.nodes ?? [];
  const node = [...nodes].reverse().find((candidate) => candidate?.kind === kind);
  assert.ok(node?.id, `Expected test node creation to return a ${kind} node.`);
  return node;
}

async function startExecution(kind, nodeId, provider, resumeRequested = false) {
  return vscode.commands.executeCommand(
    COMMAND_IDS.testStartExecutionSession,
    kind,
    nodeId,
    92,
    28,
    provider,
    resumeRequested
  );
}

async function dispatchWebviewMessage(message) {
  return vscode.commands.executeCommand(COMMAND_IDS.testDispatchWebviewMessage, message, 'panel');
}

async function setRuntimePersistenceEnabled(enabled) {
  await vscode.workspace
    .getConfiguration()
    .update('devSessionCanvas.runtimePersistence.enabled', enabled, vscode.ConfigurationTarget.Global);
}

async function waitForNode(predicate, timeoutMs, nodeId) {
  const deadline = Date.now() + timeoutMs;
  let lastSnapshot;
  while (Date.now() < deadline) {
    lastSnapshot = await vscode.commands.executeCommand(COMMAND_IDS.testGetDebugState);
    const node = lastSnapshot?.state?.nodes?.find((candidate) => candidate.id === nodeId);
    if (node && predicate(node)) {
      return node;
    }
    await delay(100);
  }
  assert.fail(`Timed out waiting for ${nodeId}. Last snapshot: ${JSON.stringify(lastSnapshot)}`);
}

async function getNode(nodeId) {
  const snapshot = await vscode.commands.executeCommand(COMMAND_IDS.testGetDebugState);
  const node = snapshot?.state?.nodes?.find((candidate) => candidate.id === nodeId);
  assert.ok(node, `Expected ${nodeId} to remain in the canvas state.`);
  return node;
}

function isAttachedLiveAgent(node) {
  return Boolean(
    node.metadata?.agent?.liveSession &&
      node.metadata.agent.attachmentState === 'attached-live' &&
      node.metadata.agent.runtimeSessionId
  );
}

function isAttachedLiveTerminal(node) {
  return Boolean(
    node.metadata?.terminal?.liveSession &&
      node.metadata.terminal.attachmentState === 'attached-live' &&
      node.metadata.terminal.runtimeSessionId
  );
}

async function waitForRegistrySession(sessionId, timeoutMs) {
  return waitForRegistrySessions([sessionId], timeoutMs);
}

async function waitForJournalBytes(storageDir, sessionId, minimumBytes, timeoutMs) {
  const sessionDirectory = path.join(
    storageDir,
    'terminal-journals',
    createHash('sha256').update(sessionId).digest('hex').slice(0, 32)
  );
  const deadline = Date.now() + timeoutMs;
  let lastManifest;
  let lastBytes = 0;
  while (Date.now() < deadline) {
    try {
      lastManifest = JSON.parse(await fs.readFile(path.join(sessionDirectory, 'manifest.json'), 'utf8'));
      const segmentBytes = await Promise.all(
        (lastManifest.segments ?? []).map(async (segment) => {
          const stats = await fs.stat(path.join(sessionDirectory, segment.file));
          return stats.size;
        })
      );
      lastBytes = segmentBytes.reduce((total, bytes) => total + bytes, 0);
      if (lastManifest.version === 1 && lastBytes > minimumBytes) {
        return;
      }
    } catch {
      // The Supervisor may still be flushing the synthetic fixture Journal.
    }
    await delay(100);
  }
  assert.fail(
    `Timed out waiting for an over-budget V1 Journal for ${sessionId}. ` +
      `Last manifest: ${JSON.stringify(lastManifest)} bytes=${lastBytes}`
  );
}

async function appendJournalOnlyV1Output(storageDir, sessionId, data) {
  const sessionDirectory = path.join(
    storageDir,
    'terminal-journals',
    createHash('sha256').update(sessionId).digest('hex').slice(0, 32)
  );
  const manifestPath = path.join(sessionDirectory, 'manifest.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  assert.strictEqual(manifest.version, 1, 'The late-output fixture intentionally covers legacy V1 Journal recovery.');
  const segment = manifest.segments?.at(-1);
  assert.ok(segment?.file, 'The V1 Journal fixture must have a writable tail segment.');

  const revision = manifest.lastRevision + 1;
  const recordWithoutChecksum = {
    version: 1,
    sessionId,
    authorityId: manifest.authorityId,
    previousChecksum: manifest.lastChecksum,
    type: 'output',
    revision,
    createdAtMs: Date.now(),
    data
  };
  const record = {
    ...recordWithoutChecksum,
    checksum: checksumJson(recordWithoutChecksum)
  };
  const line = `${JSON.stringify(record)}\n`;
  await fs.appendFile(path.join(sessionDirectory, segment.file), line, 'utf8');

  segment.endRevision = revision;
  segment.recordCount += 1;
  segment.bytes += Buffer.byteLength(line, 'utf8');
  manifest.lastRevision = revision;
  manifest.lastChecksum = record.checksum;
  manifest.checksum = checksumV1Manifest(manifest);
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return { lastRevision: revision };
}

function checksumV1Manifest(manifest) {
  return checksumJson({
    version: 1,
    sessionId: manifest.sessionId,
    authorityId: manifest.authorityId,
    createdAtMs: manifest.createdAtMs,
    initialCols: manifest.initialCols,
    initialRows: manifest.initialRows,
    initialScrollback: manifest.initialScrollback,
    lastRevision: manifest.lastRevision,
    lastChecksum: manifest.lastChecksum,
    segments: manifest.segments
  });
}

function checksumJson(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function createSerializedTerminalStateFixture(marker, outputSequence) {
  return {
    format: 'xterm-serialize-v1',
    data: `${marker}\r\n${marker} retained Host screen\r\n`,
    outputSequence
  };
}

async function synchronizeFakeProviderSession(storagePath, sessionId) {
  const sessionFile = path.join(storagePath, 'last-session');
  await fs.writeFile(sessionFile, `${sessionId}\n`, 'utf8');
  assert.strictEqual(
    (await fs.readFile(sessionFile, 'utf8')).trim(),
    sessionId,
    'The isolated fake provider must retain the same session id as the saved Agent resume metadata.'
  );
}

async function waitForRegistrySessions(sessionIds, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastState;
  while (Date.now() < deadline) {
    lastState = await vscode.commands.executeCommand(COMMAND_IDS.testGetRuntimeSupervisorState);
    const sessions = lastState?.registries?.['legacy-detached']?.registry?.sessions ?? [];
    if (sessionIds.every((sessionId) => sessions.some((session) => session.sessionId === sessionId))) {
      return lastState;
    }
    await delay(100);
  }
  assert.fail(`Timed out waiting for Supervisor registry sessions. Last state: ${JSON.stringify(lastState)}`);
}

async function waitForProcessExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await delay(50);
  }
  assert.fail(`Timed out waiting for Supervisor pid ${pid} to exit.`);
}

async function waitForRecoveryPhase(socketPath, expectedPhase, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastHello;
  while (Date.now() < deadline) {
    try {
      lastHello = await sendRuntimeSupervisorRequest(socketPath, 'hello');
      if (lastHello?.recovery?.phase === expectedPhase) {
        return lastHello;
      }
    } catch {
      // The Host is still re-establishing the Supervisor after its volatile socket was removed.
    }
    await delay(100);
  }
  assert.fail(`Timed out waiting for recovery phase ${expectedPhase}. Last hello: ${JSON.stringify(lastHello)}`);
}

async function sendRuntimeSupervisorRequest(socketPath, method, params) {
  const socket = net.createConnection(socketPath);
  const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let settled = false;
  let buffer = '';

  return new Promise((resolve, reject) => {
    const finish = (callback, value) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      callback(value);
    };
    const timeout = setTimeout(() => finish(reject, new Error(`Runtime Supervisor request ${method} timed out.`)), 5000);
    const complete = (callback, value) => {
      clearTimeout(timeout);
      finish(callback, value);
    };

    socket.setEncoding('utf8');
    socket.once('error', (error) => complete(reject, error));
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
        const message = JSON.parse(line);
        if (message.type !== 'response' || message.id !== requestId) {
          continue;
        }
        if (message.ok) {
          complete(resolve, message.result);
        } else {
          complete(reject, new Error(message.error?.message || `Runtime Supervisor ${method} failed.`));
        }
        return;
      }
    });
    socket.once('connect', () => {
      socket.write(`${JSON.stringify({
        type: 'request',
        id: requestId,
        method,
        ...(params === undefined ? {} : { params })
      })}\n`);
    });
  });
}

function resolveLegacyRuntimeSupervisorPathsFromStorageDir(storageDir) {
  const normalizedStorageDir = path.resolve(storageDir);
  const digest = createHash('sha1').update(normalizedStorageDir).digest('hex').slice(0, 24);
  const storageSocketPath = path.join(normalizedStorageDir, 'supervisor.sock');
  if (isUnixSocketPathWithinLimit(storageSocketPath)) {
    return { socketPath: storageSocketPath };
  }

  for (const runtimeDir of resolvePrivateRuntimeDirCandidates()) {
    for (const socketFileName of resolveLegacyRuntimePrivateSocketFileNames(digest)) {
      const socketPath = path.join(runtimeDir, socketFileName);
      if (isUnixSocketPathWithinLimit(socketPath)) {
        return { socketPath };
      }
    }
  }

  for (const runtimeDir of resolveFallbackRuntimeDirCandidates()) {
    for (const socketFileName of resolveLegacyRuntimeFallbackSocketFileNames(digest)) {
      const socketPath = path.join(runtimeDir, socketFileName);
      if (isUnixSocketPathWithinLimit(socketPath)) {
        return { socketPath };
      }
    }
  }

  throw new Error('Unable to resolve the isolated Runtime Supervisor socket path.');
}

function assertIsolatedSupervisorSocketPath(socketPath, runtimeStoragePath) {
  const normalizedSocketPath = path.resolve(socketPath);
  const roots = [runtimeStoragePath, process.env.XDG_RUNTIME_DIR]
    .filter((candidate) => typeof candidate === 'string' && path.isAbsolute(candidate))
    .map((candidate) => path.resolve(candidate));
  assert.ok(
    roots.some((root) => normalizedSocketPath === root || normalizedSocketPath.startsWith(`${root}${path.sep}`)),
    `Refusing to remove a Supervisor socket outside the isolated smoke runtime: ${normalizedSocketPath}`
  );
}

function resolvePrivateRuntimeDirCandidates() {
  const candidates = [];
  if (path.isAbsolute(process.env.XDG_RUNTIME_DIR || '')) {
    candidates.push(path.join(process.env.XDG_RUNTIME_DIR, 'dev-session-canvas'));
  }
  const userId = typeof process.getuid === 'function' ? String(process.getuid()) : 'shared';
  candidates.push(path.join(os.tmpdir(), `dev-session-canvas-${userId}`));
  candidates.push(path.join(os.tmpdir(), `dsc-${userId}`));
  return Array.from(new Set(candidates.map((candidate) => path.resolve(candidate))));
}

function resolveLegacyRuntimePrivateSocketFileNames(digest) {
  return [`supervisor-${digest}.sock`, `${digest}.sock`, `${digest.slice(0, SHORT_FALLBACK_SOCKET_DIGEST_LENGTH)}.sock`];
}

function resolveFallbackRuntimeDirCandidates() {
  const candidates = [os.tmpdir(), '/tmp', '/private/tmp', '/var/tmp', path.join(os.homedir(), '.dsc')];
  return Array.from(new Set(candidates.map((candidate) => path.resolve(candidate))));
}

function resolveLegacyRuntimeFallbackSocketFileNames(digest) {
  return [`${digest}.sock`, `${digest.slice(0, SHORT_FALLBACK_SOCKET_DIGEST_LENGTH)}.sock`];
}

function isUnixSocketPathWithinLimit(value) {
  return Buffer.byteLength(value, 'utf8') <= 104;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
