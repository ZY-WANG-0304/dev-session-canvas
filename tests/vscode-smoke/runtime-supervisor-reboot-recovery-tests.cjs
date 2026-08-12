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
  testGetDiagnosticEvents: 'devSessionCanvas.__test.getDiagnosticEvents',
  testClearDiagnosticEvents: 'devSessionCanvas.__test.clearDiagnosticEvents',
  testCaptureWebviewProbe: 'devSessionCanvas.__test.captureWebviewProbe',
  testWaitForCanvasReady: 'devSessionCanvas.__test.waitForCanvasReady',
  testDispatchWebviewMessage: 'devSessionCanvas.__test.dispatchWebviewMessage',
  testSimulateRuntimeReload: 'devSessionCanvas.__test.simulateRuntimeReload',
  testCreateNode: 'devSessionCanvas.__test.createNode',
  testStartExecutionSession: 'devSessionCanvas.__test.startExecutionSession',
  testResetState: 'devSessionCanvas.__test.resetState'
};
const OLD_TERMINAL_MARKER = 'REBOOT_RECOVERY_OLD_TERMINAL';
const OLD_TERMINAL_PID_PREFIX = 'REBOOT_RECOVERY_OLD_TERMINAL_PID=';
const OLD_AGENT_MARKER = 'REBOOT_RECOVERY_OLD_AGENT_SNAPSHOT';
const OLD_AGENT_BURST_COUNT = 512;
const NEW_AGENT_MARKER = 'REBOOT_RECOVERY_NEW_AGENT';
const NEW_TERMINAL_MARKER = 'REBOOT_RECOVERY_NEW_TERMINAL';
const SHORT_FALLBACK_SOCKET_DIGEST_LENGTH = 16;

module.exports = { run };

async function run() {
  assert.notStrictEqual(process.platform, 'win32', 'This smoke validates a Unix socket reset.');

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
    const oldAgentReadyTranscript = await waitForTerminalTranscript(
      oldAgent.id,
      (transcript) => transcript.includes('[fake-agent] ready pid='),
      20000
    );
    oldAgentProcessId = parseAgentProcessId(oldAgentReadyTranscript);
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
    await waitForTerminalTranscript(
      oldAgent.id,
      (transcript) => transcript.includes(`[fake-agent] burst ${String(OLD_AGENT_BURST_COUNT).padStart(3, '0')}`),
      30000
    );
    const oldAgentLiveNode = await waitForNode(
      (node) =>
        node.metadata?.agent?.resumeSupported === true &&
        Boolean(node.metadata.agent.resumeSessionId) &&
        Boolean(node.metadata.agent.resumeStoragePath),
      30000,
      oldAgent.id
    );
    const oldAgentRuntimeSessionId = oldAgentLiveNode.metadata.agent.runtimeSessionId;
    const oldAgentRuntimeStoragePath = oldAgentLiveNode.metadata.agent.runtimeStoragePath;
    const oldAgentSupervisorInstanceId = oldAgentLiveNode.metadata.agent.supervisorInstanceId;
    const oldAgentResumeSessionId = oldAgentLiveNode.metadata.agent.resumeSessionId;
    const oldAgentResumeStoragePath = oldAgentLiveNode.metadata.agent.resumeStoragePath;
    assert.ok(oldAgentRuntimeSessionId, 'The old Agent must have a persisted Runtime Supervisor session id.');
    assert.ok(oldAgentRuntimeStoragePath, 'The old Agent must have a runtime storage path.');
    assert.ok(oldAgentSupervisorInstanceId, 'The old Agent must persist its Supervisor instance identity.');
    assert.ok(oldAgentResumeSessionId, 'The old Agent must have a resumable provider session id.');
    assert.ok(oldAgentResumeStoragePath, 'The old Agent must have a resumable provider storage path.');
    await synchronizeFakeProviderSession(oldAgentResumeStoragePath, oldAgentResumeSessionId);
    await waitForRegistrySession(oldAgentRuntimeSessionId, 20000);

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
    const oldTerminalTranscript = await waitForTerminalTranscript(
      oldTerminal.id,
      (transcript) => transcript.includes(OLD_TERMINAL_MARKER),
      20000
    );
    const oldLiveNode = await getNode(oldTerminal.id);
    const oldRuntimeSessionId = oldLiveNode.metadata.terminal.runtimeSessionId;
    const oldRuntimeStoragePath = oldLiveNode.metadata.terminal.runtimeStoragePath;
    const oldTerminalSupervisorInstanceId = oldLiveNode.metadata.terminal.supervisorInstanceId;
    assert.ok(oldRuntimeSessionId, 'The old Terminal must have a persisted Runtime Supervisor session id.');
    assert.ok(oldRuntimeStoragePath, 'The old Terminal must have a runtime storage path.');
    assert.ok(oldTerminalSupervisorInstanceId, 'The old Terminal must persist its Supervisor instance identity.');
    oldTerminalProcessId = parseTerminalProcessId(oldTerminalTranscript);
    await waitForRegistrySession(oldRuntimeSessionId, 20000);

    const supervisorPaths = resolveLegacyRuntimeSupervisorPathsFromStorageDir(
      path.join(oldRuntimeStoragePath, 'runtime-supervisor')
    );
    assertIsolatedSupervisorSocketPath(supervisorPaths.socketPath, oldRuntimeStoragePath);
    const helloBeforeReboot = await sendRuntimeSupervisorRequest(supervisorPaths.socketPath, 'hello');
    assert.ok(Number.isInteger(helloBeforeReboot?.pid), 'Expected the old Supervisor hello response to expose its pid.');
    assert.strictEqual(helloBeforeReboot.capabilities?.supervisorInstanceIdentityV1, true);
    assert.strictEqual(helloBeforeReboot.supervisorInstanceId, oldAgentSupervisorInstanceId);
    assert.strictEqual(helloBeforeReboot.supervisorInstanceId, oldTerminalSupervisorInstanceId);
    assert.strictEqual(helloBeforeReboot.recovery, undefined, 'A current Supervisor must not publish a recovery barrier.');

    // A Supervisor restart loses the PTY authority even though its old registry and journals remain on disk.
    process.kill(helloBeforeReboot.pid, 'SIGKILL');
    await waitForProcessExit(helloBeforeReboot.pid, 10000);
    await fs.rm(supervisorPaths.socketPath, { force: true });
    await vscode.commands.executeCommand(COMMAND_IDS.testClearHostMessages);
    await vscode.commands.executeCommand(COMMAND_IDS.testClearDiagnosticEvents);
    await vscode.commands.executeCommand(COMMAND_IDS.testSimulateRuntimeReload);

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
        node.metadata.agent.runtimeSessionId === undefined &&
        node.metadata.agent.supervisorInstanceId === undefined,
      30000,
      oldAgent.id
    );
    const oldTerminalHistoryNode = await waitForNode(
      (node) =>
        node.status === 'history-restored' &&
        node.metadata?.terminal?.lifecycle === 'closed' &&
        node.metadata.terminal.attachmentState === 'history-restored' &&
        node.metadata.terminal.persistenceMode === 'snapshot-only' &&
        node.metadata.terminal.liveSession === false &&
        node.metadata.terminal.runtimeSessionId === undefined &&
        node.metadata.terminal.supervisorInstanceId === undefined,
      30000,
      oldTerminal.id
    );
    assert.strictEqual(oldTerminalHistoryNode.metadata.terminal.pendingLaunch, undefined);

    await assert.rejects(
      sendRuntimeSupervisorRequest(supervisorPaths.socketPath, 'hello'),
      (error) => error?.code === 'ENOENT' || error?.code === 'ECONNREFUSED',
      'Classifying dead PTYs must not start a replacement Supervisor.'
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
    const oldAgentBeforeExplicitResumeTranscript = await readTerminalTranscript(oldAgent.id);
    assert.ok(
      !oldAgentBeforeExplicitResumeTranscript.includes('[fake-agent] resumed session'),
      'No provider resume output may appear before the user explicitly requests Resume.'
    );

    // This explicit create starts a replacement Supervisor with an empty runtime namespace.
    newAgent = await createNode('agent', 'codex');
    await startExecution('agent', newAgent.id, 'codex');
    const newAgentLive = await waitForNode((node) => isAttachedLiveAgent(node), 20000, newAgent.id);
    const helloAfterReboot = await sendRuntimeSupervisorRequest(supervisorPaths.socketPath, 'hello');
    assert.notStrictEqual(helloAfterReboot.supervisorInstanceId, helloBeforeReboot.supervisorInstanceId);
    assert.strictEqual(helloAfterReboot.recovery, undefined, 'A replacement Supervisor must not recover old journals.');
    assert.strictEqual(newAgentLive.metadata.agent.supervisorInstanceId, helloAfterReboot.supervisorInstanceId);

    newTerminal = await createNode('terminal');
    await startExecution('terminal', newTerminal.id);
    const newTerminalLive = await waitForNode((node) => isAttachedLiveTerminal(node), 20000, newTerminal.id);
    assert.strictEqual(newTerminalLive.metadata.terminal.supervisorInstanceId, helloAfterReboot.supervisorInstanceId);

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
    await waitForTerminalTranscript(
      newAgent.id,
      (transcript) => transcript.includes(NEW_AGENT_MARKER),
      20000
    );
    await waitForTerminalTranscript(
      newTerminal.id,
      (transcript) => transcript.includes(NEW_TERMINAL_MARKER),
      20000
    );

    const replacementRuntimeState = await waitForRegistrySessions(
      [
        newAgentLive.metadata.agent.runtimeSessionId,
        newTerminalLive.metadata.terminal.runtimeSessionId
      ],
      30000
    );
    const replacementSessionIds = replacementRuntimeState.registries['legacy-detached'].registry.sessions.map(
      (session) => session.sessionId
    );
    assert.strictEqual(replacementSessionIds.includes(oldAgentRuntimeSessionId), false);
    assert.strictEqual(replacementSessionIds.includes(oldRuntimeSessionId), false);

    const messagesAfterReboot = await vscode.commands.executeCommand(COMMAND_IDS.testGetHostMessages);
    const diagnosticEventsAfterReboot = await getDiagnosticEvents();
    assert.ok(
      diagnosticEventsAfterReboot.every((event) => !event.kind?.startsWith('runtime/recovery')),
      `Supervisor restart must not publish recovery progress: ${JSON.stringify(diagnosticEventsAfterReboot)}`
    );
    assert.ok(
      !messagesAfterReboot.some(
        (message) => message.type === 'host/stateUpdated' && Object.hasOwn(message.payload?.runtime ?? {}, 'runtimeRecovery')
      ),
      `Supervisor restart state must not expose a recovery barrier: ${JSON.stringify(messagesAfterReboot)}`
    );

    await startExecution('agent', oldAgent.id, 'codex', true);
    const resumedAgent = await waitForNode(
      (node) => isAttachedLiveAgent(node),
      30000,
      oldAgent.id
    );
    await waitForTerminalTranscript(
      oldAgent.id,
      (transcript) => transcript.includes('[fake-agent] resumed session'),
      30000
    );
    assert.strictEqual(resumedAgent.metadata.agent.supervisorInstanceId, helloAfterReboot.supervisorInstanceId);
    assert.notStrictEqual(resumedAgent.metadata.agent.runtimeSessionId, oldAgentRuntimeSessionId);
  } finally {
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
  let currentMessage = message;
  if (message?.type === 'webview/executionInput') {
    const identity = await waitForReadyProjectionIdentity(
      message.payload.nodeId,
      message.payload.kind,
      20000
    );
    currentMessage = {
      ...message,
      payload: {
        ...message.payload,
        controllerGeneration: identity.controllerGeneration,
        projectionId: identity.projectionId
      }
    };
  }
  return vscode.commands.executeCommand(COMMAND_IDS.testDispatchWebviewMessage, currentMessage, 'panel');
}

async function waitForReadyProjectionIdentity(nodeId, kind, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastProjectionMessages = [];
  while (Date.now() < deadline) {
    const messages = await vscode.commands.executeCommand(COMMAND_IDS.testGetHostMessages);
    lastProjectionMessages = messages.filter(
      (message) =>
        message.type === 'host/executionProjectionState' &&
        message.payload?.nodeId === nodeId &&
        message.payload?.kind === kind
    );
    const ready = [...lastProjectionMessages].reverse().find(
      (message) =>
        message.payload.state === 'ready' &&
        typeof message.payload.controllerGeneration === 'string' &&
        typeof message.payload.projectionId === 'string'
    );
    if (ready) {
      return ready.payload;
    }
    await delay(100);
  }
  assert.fail(
    `Timed out waiting for ready projection ${kind}:${nodeId}. Last projection messages: ${JSON.stringify(lastProjectionMessages)}`
  );
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

async function getDiagnosticEvents() {
  return vscode.commands.executeCommand(COMMAND_IDS.testGetDiagnosticEvents);
}

async function readTerminalTranscript(nodeId) {
  const probe = await vscode.commands.executeCommand(
    COMMAND_IDS.testCaptureWebviewProbe,
    'panel',
    5000,
    0
  );
  const node = probe?.nodes?.find((candidate) => candidate.nodeId === nodeId);
  return Array.isArray(node?.terminalVisibleLines) ? node.terminalVisibleLines.join('\n') : '';
}

async function waitForTerminalTranscript(nodeId, predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastTranscript = '';
  while (Date.now() < deadline) {
    lastTranscript = await readTerminalTranscript(nodeId);
    if (predicate(lastTranscript)) {
      return lastTranscript;
    }
    await delay(100);
  }
  assert.fail(`Timed out waiting for terminal transcript ${nodeId}. Last transcript: ${lastTranscript}`);
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
