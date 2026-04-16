const assert = require('assert');
const { spawn } = require('child_process');
const { createHash } = require('crypto');
const fs = require('fs/promises');
const net = require('net');
const os = require('os');
const path = require('path');
const vscode = require('vscode');

const EXTENSION_ID = 'devsessioncanvas.dev-session-canvas';
const COMMAND_IDS = {
  openCanvasInPanel: 'devSessionCanvas.openCanvasInPanel',
  testGetDebugState: 'devSessionCanvas.__test.getDebugState',
  testGetDiagnosticEvents: 'devSessionCanvas.__test.getDiagnosticEvents',
  testClearDiagnosticEvents: 'devSessionCanvas.__test.clearDiagnosticEvents',
  testWaitForCanvasReady: 'devSessionCanvas.__test.waitForCanvasReady',
  testDispatchWebviewMessage: 'devSessionCanvas.__test.dispatchWebviewMessage',
  testFlushPersistedState: 'devSessionCanvas.__test.flushPersistedState',
  testReloadPersistedState: 'devSessionCanvas.__test.reloadPersistedState',
  testSetPersistedState: 'devSessionCanvas.__test.setPersistedState',
  testResetState: 'devSessionCanvas.__test.resetState'
};
const STORAGE_SLOT_RUNTIME_READY_MARKER = 'SIBLING_SLOT_RUNTIME_READY';
const STORAGE_SLOT_RUNTIME_CONTINUE_MARKER = 'SIBLING_SLOT_RUNTIME_CONTINUE';

module.exports = {
  run
};

async function run() {
  const extension = vscode.extensions.getExtension(EXTENSION_ID);
  assert.ok(extension, `Missing extension ${EXTENSION_ID}.`);
  await extension.activate();

  await vscode.commands.executeCommand(COMMAND_IDS.testResetState);
  await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInPanel);
  await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'panel', 20000);

  await dispatchWebviewMessage({
    type: 'webview/createDemoNode',
    payload: {
      kind: 'note',
      preferredPosition: { x: 180, y: 140 }
    }
  });

  let snapshot = await waitForSnapshot((currentSnapshot) => currentSnapshot.state.nodes.length === 1, 20000);
  const noteNode = findNodeByKind(snapshot, 'note');
  await dispatchWebviewMessage({
    type: 'webview/updateNodeTitle',
    payload: {
      nodeId: noteNode.id,
      title: 'Current Slot Baseline'
    }
  });
  await dispatchWebviewMessage({
    type: 'webview/updateNoteNode',
    payload: {
      nodeId: noteNode.id,
      content: 'BASELINE_CURRENT_SLOT'
    }
  });
  await dispatchWebviewMessage({
    type: 'webview/moveNode',
    payload: {
      id: noteNode.id,
      position: { x: 520, y: 320 }
    }
  });

  snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentNote = currentSnapshot.state.nodes.find((node) => node.id === noteNode.id);
    return Boolean(
      currentNote?.title === 'Current Slot Baseline' &&
        currentNote.metadata?.note?.content === 'BASELINE_CURRENT_SLOT' &&
        currentNote.position?.x === 520 &&
        currentNote.position?.y === 320
    );
  }, 20000);

  const baselineFlush = await flushPersistedState();
  assert.strictEqual(baselineFlush.lastError, undefined);
  assert.strictEqual(baselineFlush.exists, true);
  assert.ok(baselineFlush.snapshot?.state, 'Expected flushPersistedState to return baseline state.');

  const baselineState = cloneJsonValue(baselineFlush.snapshot.state);
  const currentStoragePath = path.dirname(baselineFlush.snapshotPath);
  const currentSnapshotPath = baselineFlush.snapshotPath;
  const siblingStoragePath = deriveSiblingStoragePath(currentStoragePath);
  const siblingSnapshotPath = path.join(siblingStoragePath, 'canvas-state.json');
  const olderCurrentState = updateNoteStateFixture(baselineState, noteNode.id, {
    title: 'Current Slot Older Snapshot',
    content: 'CURRENT_SLOT_OLDER_SNAPSHOT',
    position: { x: 160, y: 180 },
    updatedAt: '2026-04-15T08:00:00.000Z'
  });
  const fresherSiblingState = updateNoteStateFixture(baselineState, noteNode.id, {
    title: 'Sibling Slot Fresher Snapshot',
    content: 'SIBLING_SLOT_FRESHER_SNAPSHOT',
    position: { x: 860, y: 260 },
    updatedAt: '2026-04-16T08:00:00.000Z'
  });
  const fresherSiblingStateHash = hashJsonValue(fresherSiblingState);

  await fs.rm(siblingStoragePath, { recursive: true, force: true });
  try {
    await writePersistedSnapshotFixture(currentSnapshotPath, {
      version: 1,
      writtenAt: '2026-04-15T08:01:00.000Z',
      stateHash: hashJsonValue(olderCurrentState),
      state: olderCurrentState,
      activeSurface: 'panel'
    });
    await writePersistedSnapshotFixture(siblingSnapshotPath, {
      version: 1,
      writtenAt: '2026-04-16T08:01:00.000Z',
      stateHash: fresherSiblingStateHash,
      state: fresherSiblingState,
      activeSurface: 'panel'
    });

    await clearDiagnosticEvents();
    snapshot = await reloadPersistedState();
    const recoveredNote = findNodeById(snapshot, noteNode.id);
    assert.strictEqual(recoveredNote.title, 'Sibling Slot Fresher Snapshot');
    assert.strictEqual(recoveredNote.metadata.note.content, 'SIBLING_SLOT_FRESHER_SNAPSHOT');
    assert.deepStrictEqual(recoveredNote.position, { x: 860, y: 260 });

    const recoveryDiagnostics = await getDiagnosticEvents();
    const slotSelectedEvent = recoveryDiagnostics.find((event) => event.kind === 'storage/slotSelected');
    assert.ok(slotSelectedEvent, 'Expected storage/slotSelected diagnostic.');
    assert.strictEqual(slotSelectedEvent.detail?.sourcePath, siblingStoragePath);
    assert.strictEqual(slotSelectedEvent.detail?.writePath, currentStoragePath);
    assert.strictEqual(slotSelectedEvent.detail?.selectionBasis, 'freshest-snapshot');
    assert.strictEqual(slotSelectedEvent.detail?.sourceStateHash, fresherSiblingStateHash);

    const migratedEvent = recoveryDiagnostics.find(
      (event) => event.kind === 'storage/stateMigratedToCurrentSlot'
    );
    assert.ok(migratedEvent, 'Expected storage/stateMigratedToCurrentSlot diagnostic.');
    assert.strictEqual(migratedEvent.detail?.sourcePath, siblingStoragePath);
    assert.strictEqual(migratedEvent.detail?.targetPath, currentStoragePath);

    const loadSelectedEvent = recoveryDiagnostics.find((event) => event.kind === 'state/loadSelected');
    assert.ok(loadSelectedEvent, 'Expected state/loadSelected diagnostic.');
    assert.strictEqual(loadSelectedEvent.detail?.storagePath, currentStoragePath);
    assert.strictEqual(loadSelectedEvent.detail?.recoverySourcePath, siblingStoragePath);
    assert.strictEqual(loadSelectedEvent.detail?.snapshotStateHash, fresherSiblingStateHash);
    assert.strictEqual(loadSelectedEvent.detail?.stateHash, fresherSiblingStateHash);

    const migratedCurrentSnapshot = JSON.parse(await fs.readFile(currentSnapshotPath, 'utf8'));
    assert.strictEqual(migratedCurrentSnapshot.stateHash, fresherSiblingStateHash);
    assert.strictEqual(
      findNodeById({ state: migratedCurrentSnapshot.state }, noteNode.id).metadata.note.content,
      'SIBLING_SLOT_FRESHER_SNAPSHOT'
    );

    await clearDiagnosticEvents();
    await dispatchWebviewMessage({
      type: 'webview/updateNoteNode',
      payload: {
        nodeId: noteNode.id,
        content: 'CURRENT_SLOT_WRITE_AFTER_RECOVERY'
      }
    });

    snapshot = await waitForSnapshot((currentSnapshot) => {
      const currentNote = currentSnapshot.state.nodes.find((node) => node.id === noteNode.id);
      return Boolean(currentNote?.metadata?.note?.content === 'CURRENT_SLOT_WRITE_AFTER_RECOVERY');
    }, 20000);
    assert.strictEqual(
      findNodeById(snapshot, noteNode.id).metadata.note.content,
      'CURRENT_SLOT_WRITE_AFTER_RECOVERY'
    );

    const flushedAfterMutation = await flushPersistedState();
    assert.strictEqual(flushedAfterMutation.snapshotPath, currentSnapshotPath);
    const currentSnapshotAfterMutation = JSON.parse(await fs.readFile(currentSnapshotPath, 'utf8'));
    const siblingSnapshotAfterMutation = JSON.parse(await fs.readFile(siblingSnapshotPath, 'utf8'));
    assert.strictEqual(
      findNodeById({ state: currentSnapshotAfterMutation.state }, noteNode.id).metadata.note.content,
      'CURRENT_SLOT_WRITE_AFTER_RECOVERY'
    );
    assert.strictEqual(
      findNodeById({ state: siblingSnapshotAfterMutation.state }, noteNode.id).metadata.note.content,
      'SIBLING_SLOT_FRESHER_SNAPSHOT'
    );

    const mutationDiagnostics = await getDiagnosticEvents();
    assert.ok(
      mutationDiagnostics.some(
        (event) =>
          event.kind === 'state/persistWritten' &&
          event.detail?.snapshotPath === currentSnapshotPath &&
          event.detail?.stateHash === hashJsonValue(currentSnapshotAfterMutation.state)
      ),
      'Expected post-recovery writes to persist through the current slot snapshot path.'
    );
  } finally {
    await fs.rm(siblingStoragePath, { recursive: true, force: true });
    const restoredSnapshot = await setPersistedState(baselineState);
    const restoredNote = findNodeById(restoredSnapshot, noteNode.id);
    assert.strictEqual(restoredNote.title, 'Current Slot Baseline');
    assert.strictEqual(restoredNote.metadata.note.content, 'BASELINE_CURRENT_SLOT');
    await vscode.commands.executeCommand(COMMAND_IDS.testResetState);
  }

  await runLiveRuntimeStorageRecoveryScenario(extension);
}

async function runLiveRuntimeStorageRecoveryScenario(extension) {
  const configuration = vscode.workspace.getConfiguration();
  const previousRuntimePersistenceEnabled = configuration.get('devSessionCanvas.runtimePersistence.enabled', false);
  let siblingStoragePath;
  let supervisorProcess;
  let supervisorPaths;
  let runtimeSessionId;

  try {
    await setRuntimePersistenceEnabled(true);
    await vscode.commands.executeCommand(COMMAND_IDS.testResetState);
    await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInPanel);
    await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'panel', 20000);

    const baselineFlush = await flushPersistedState();
    assert.strictEqual(baselineFlush.lastError, undefined);
    assert.strictEqual(baselineFlush.exists, true);

    const currentStoragePath = path.dirname(baselineFlush.snapshotPath);
    const currentSnapshotPath = baselineFlush.snapshotPath;
    siblingStoragePath = deriveSiblingStoragePath(currentStoragePath);
    await fs.rm(siblingStoragePath, { recursive: true, force: true });

    supervisorPaths = resolveLegacyRuntimeSupervisorPathsFromStorageDir(
      path.join(siblingStoragePath, 'runtime-supervisor')
    );
    supervisorProcess = startLegacyRuntimeSupervisor(extension.extensionPath, supervisorPaths.storageDir);
    await waitForRuntimeSupervisorReady(supervisorPaths, 20000);

    runtimeSessionId = await createSiblingLiveTerminalSession(supervisorPaths);
    await waitForRuntimeSupervisorOutput(supervisorPaths, runtimeSessionId, STORAGE_SLOT_RUNTIME_READY_MARKER, 20000);

    const currentState = {
      version: 1,
      updatedAt: '2026-04-15T08:00:00.000Z',
      nodes: [
        {
          id: 'current-slot-note',
          kind: 'note',
          title: 'Current Slot Older Snapshot',
          status: 'idle',
          summary: '',
          position: { x: 120, y: 120 },
          size: { width: 320, height: 220 },
          metadata: {
            note: {
              content: 'CURRENT_SLOT_RUNTIME_OLDER'
            }
          }
        }
      ]
    };
    const siblingState = {
      version: 1,
      updatedAt: '2026-04-16T08:00:00.000Z',
      nodes: [
        {
          id: 'sibling-slot-note',
          kind: 'note',
          title: 'Sibling Slot Runtime Snapshot',
          status: 'idle',
          summary: '',
          position: { x: 180, y: 120 },
          size: { width: 320, height: 220 },
          metadata: {
            note: {
              content: 'SIBLING_SLOT_RUNTIME_NOTE'
            }
          }
        },
        {
          id: 'sibling-slot-terminal',
          kind: 'terminal',
          title: 'Sibling Slot Terminal',
          status: 'live',
          summary: STORAGE_SLOT_RUNTIME_READY_MARKER,
          position: { x: 560, y: 140 },
          size: { width: 560, height: 360 },
          metadata: {
            terminal: {
              backend: 'node-pty',
              lifecycle: 'live',
              shellPath: resolveShellPath(),
              cwd: getWorkspaceRoot(),
              persistenceMode: 'live-runtime',
              attachmentState: 'attached-live',
              runtimeBackend: 'legacy-detached',
              runtimeGuarantee: 'best-effort',
              liveSession: true,
              runtimeSessionId,
              recentOutput: STORAGE_SLOT_RUNTIME_READY_MARKER,
              lastCols: 92,
              lastRows: 28
            }
          }
        }
      ]
    };
    const siblingStateHash = hashJsonValue(siblingState);

    await writePersistedSnapshotFixture(currentSnapshotPath, {
      version: 1,
      writtenAt: '2026-04-15T08:01:00.000Z',
      stateHash: hashJsonValue(currentState),
      state: currentState,
      activeSurface: 'panel'
    });
    await writePersistedSnapshotFixture(path.join(siblingStoragePath, 'canvas-state.json'), {
      version: 1,
      writtenAt: '2026-04-16T08:01:00.000Z',
      stateHash: siblingStateHash,
      state: siblingState,
      activeSurface: 'panel'
    });

    await clearDiagnosticEvents();
    let snapshot = await reloadPersistedState();
    snapshot = await waitForSnapshot((currentSnapshot) => {
      const terminalNode = currentSnapshot.state.nodes.find((node) => node.id === 'sibling-slot-terminal');
      return Boolean(
        terminalNode?.metadata?.terminal?.liveSession &&
          terminalNode.metadata.terminal.attachmentState === 'attached-live' &&
          terminalNode.metadata.terminal.runtimeSessionId === runtimeSessionId &&
          terminalNode.metadata.terminal.runtimeStoragePath === siblingStoragePath &&
          terminalNode.metadata.terminal.recentOutput?.includes(STORAGE_SLOT_RUNTIME_READY_MARKER)
      );
    }, 30000);

    const terminalNode = findNodeById(snapshot, 'sibling-slot-terminal');
    assert.strictEqual(terminalNode.status, 'live');
    assert.strictEqual(terminalNode.metadata.terminal.runtimeStoragePath, siblingStoragePath);
    assert.strictEqual(terminalNode.metadata.terminal.runtimeSessionId, runtimeSessionId);
    assert.strictEqual(terminalNode.metadata.terminal.liveSession, true);

    await dispatchWebviewMessage({
      type: 'webview/executionInput',
      payload: {
        nodeId: terminalNode.id,
        kind: 'terminal',
        data: `echo ${STORAGE_SLOT_RUNTIME_CONTINUE_MARKER}\r`
      }
    });

    snapshot = await waitForSnapshot((currentSnapshot) => {
      const currentTerminal = currentSnapshot.state.nodes.find((node) => node.id === terminalNode.id);
      return Boolean(
        currentTerminal?.metadata?.terminal?.recentOutput?.includes(STORAGE_SLOT_RUNTIME_CONTINUE_MARKER) &&
          currentTerminal.metadata.terminal.runtimeStoragePath === siblingStoragePath
      );
    }, 30000);

    const recoveryDiagnostics = await getDiagnosticEvents();
    const slotSelectedEvent = recoveryDiagnostics.find((event) => event.kind === 'storage/slotSelected');
    assert.ok(slotSelectedEvent, 'Expected storage/slotSelected diagnostic for live-runtime slot recovery.');
    assert.strictEqual(slotSelectedEvent.detail?.sourcePath, siblingStoragePath);
    assert.strictEqual(slotSelectedEvent.detail?.writePath, currentStoragePath);
    assert.strictEqual(slotSelectedEvent.detail?.selectionBasis, 'freshest-snapshot');
    assert.strictEqual(slotSelectedEvent.detail?.sourceStateHash, siblingStateHash);

    const migratedEvent = recoveryDiagnostics.find(
      (event) => event.kind === 'storage/stateMigratedToCurrentSlot'
    );
    assert.ok(migratedEvent, 'Expected storage/stateMigratedToCurrentSlot diagnostic for live-runtime slot recovery.');
    assert.deepStrictEqual(migratedEvent.detail?.copiedPaths, ['canvas-state.json']);

    const loadSelectedEvent = recoveryDiagnostics.find((event) => event.kind === 'state/loadSelected');
    assert.ok(loadSelectedEvent, 'Expected state/loadSelected diagnostic for live-runtime slot recovery.');
    assert.strictEqual(loadSelectedEvent.detail?.storagePath, currentStoragePath);
    assert.strictEqual(loadSelectedEvent.detail?.recoverySourcePath, siblingStoragePath);
    assert.strictEqual(loadSelectedEvent.detail?.snapshotStateHash, siblingStateHash);
    assert.strictEqual(loadSelectedEvent.detail?.stateHash, siblingStateHash);

    const flushedAfterAttach = await flushPersistedState();
    assert.strictEqual(flushedAfterAttach.snapshotPath, currentSnapshotPath);
    const persistedSnapshot = JSON.parse(await fs.readFile(currentSnapshotPath, 'utf8'));
    const persistedTerminal = findNodeById({ state: persistedSnapshot.state }, terminalNode.id);
    assert.strictEqual(persistedTerminal.metadata.terminal.runtimeStoragePath, siblingStoragePath);
    assert.strictEqual(
      persistedTerminal.metadata.terminal.recentOutput.includes(STORAGE_SLOT_RUNTIME_CONTINUE_MARKER),
      true
    );
  } finally {
    await vscode.commands.executeCommand(COMMAND_IDS.testResetState).catch(() => undefined);
    if (runtimeSessionId && supervisorPaths) {
      await sendRuntimeSupervisorRequest(supervisorPaths, 'deleteSession', {
        sessionId: runtimeSessionId
      }).catch(() => undefined);
    }
    await stopProcess(supervisorProcess);
    if (siblingStoragePath) {
      await fs.rm(siblingStoragePath, { recursive: true, force: true }).catch(() => undefined);
    }
    await setRuntimePersistenceEnabled(previousRuntimePersistenceEnabled);
  }
}

async function dispatchWebviewMessage(message) {
  return vscode.commands.executeCommand(COMMAND_IDS.testDispatchWebviewMessage, message, 'panel');
}

async function getDebugSnapshot() {
  return vscode.commands.executeCommand(COMMAND_IDS.testGetDebugState);
}

async function getDiagnosticEvents() {
  return vscode.commands.executeCommand(COMMAND_IDS.testGetDiagnosticEvents);
}

async function clearDiagnosticEvents() {
  await vscode.commands.executeCommand(COMMAND_IDS.testClearDiagnosticEvents);
}

async function reloadPersistedState() {
  return vscode.commands.executeCommand(COMMAND_IDS.testReloadPersistedState);
}

async function flushPersistedState() {
  return vscode.commands.executeCommand(COMMAND_IDS.testFlushPersistedState);
}

async function setPersistedState(rawState) {
  return vscode.commands.executeCommand(COMMAND_IDS.testSetPersistedState, rawState);
}

async function setRuntimePersistenceEnabled(enabled) {
  await vscode.workspace
    .getConfiguration()
    .update('devSessionCanvas.runtimePersistence.enabled', enabled, vscode.ConfigurationTarget.Global);
}

function getWorkspaceRoot() {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(workspaceFolder, 'Expected an open workspace folder for storage-slot smoke.');
  return workspaceFolder.uri.fsPath;
}

function resolveShellPath() {
  return process.env.SHELL || '/bin/bash';
}

function startLegacyRuntimeSupervisor(extensionPath, storageDir) {
  const nodePath = process.env.DEV_SESSION_CANVAS_TEST_NODE_PATH || process.execPath;
  const child = spawn(
    nodePath,
    [
      path.join(extensionPath, 'dist', 'runtime-supervisor.js'),
      '--storage-dir',
      storageDir,
      '--runtime-backend',
      'legacy-detached',
      '--runtime-guarantee',
      'best-effort'
    ],
    {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        ELECTRON_NO_ATTACH_CONSOLE: '1'
      },
      stdio: 'ignore',
      windowsHide: true
    }
  );
  return child;
}

async function createSiblingLiveTerminalSession(supervisorPaths) {
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
  assert.ok(snapshot?.sessionId, 'Expected sibling-slot supervisor to create a runtime session.');

  await sendRuntimeSupervisorRequest(supervisorPaths, 'writeInput', {
    sessionId: snapshot.sessionId,
    data: `echo ${STORAGE_SLOT_RUNTIME_READY_MARKER}\r`
  });
  return snapshot.sessionId;
}

async function waitForRuntimeSupervisorReady(supervisorPaths, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const hello = await sendRuntimeSupervisorRequest(supervisorPaths, 'hello');
      if (hello?.serverVersion === 1) {
        return;
      }
    } catch {
      // Wait for the child process to finish binding the socket.
    }
    await sleep(100);
  }

  assert.fail(`Timed out while waiting for runtime supervisor socket: ${supervisorPaths.socketPath}`);
}

async function waitForRuntimeSupervisorOutput(supervisorPaths, sessionId, marker, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastSnapshot;
  while (Date.now() < deadline) {
    try {
      lastSnapshot = await sendRuntimeSupervisorRequest(supervisorPaths, 'attachSession', {
        sessionId
      });
      if (lastSnapshot?.output?.includes(marker)) {
        return lastSnapshot;
      }
    } catch {
      // Retry until the shell has emitted the expected output.
    }
    await sleep(100);
  }

  assert.fail(
    `Timed out while waiting for runtime supervisor output "${marker}". Last snapshot: ${JSON.stringify(lastSnapshot)}`
  );
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
      socket.write(
        `${JSON.stringify(
          params === undefined
            ? { type: 'request', id: requestId, method }
            : { type: 'request', id: requestId, method, params }
        )}\n`
      );
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
        finalize(reject, new Error(`Runtime supervisor socket closed before ${method} completed.`));
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
    return {
      storageDir: normalizedStorageDir,
      runtimeDir: normalizedStorageDir,
      socketPath: storageSocketPath,
      registryPath,
      socketLocation: 'storage'
    };
  }

  const tmpDir = path.resolve(os.tmpdir());
  for (const runtimeDir of resolvePrivateRuntimeDirCandidates(tmpDir)) {
    const socketPath = path.join(runtimeDir, `supervisor-${digest}.sock`);
    if (!isUnixSocketPathWithinLimit(socketPath)) {
      continue;
    }

    return {
      storageDir: normalizedStorageDir,
      runtimeDir,
      socketPath,
      registryPath,
      socketLocation: 'runtime-private'
    };
  }

  return {
    storageDir: normalizedStorageDir,
    runtimeDir: tmpDir,
    socketPath: path.join(tmpDir, `${digest}.sock`),
    registryPath,
    socketLocation: 'runtime-fallback'
  };
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

function isUnixSocketPathWithinLimit(value) {
  return Buffer.byteLength(value, 'utf8') <= 104;
}

function normalizeAbsoluteDirectory(value) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized && path.isAbsolute(normalized) ? path.normalize(normalized) : undefined;
}

function serializeProcessEnv(env) {
  const serialized = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') {
      serialized[key] = value;
    }
  }
  return serialized;
}

async function stopProcess(childProcess) {
  if (!childProcess || childProcess.exitCode !== null || childProcess.killed) {
    return;
  }

  await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      childProcess.kill('SIGKILL');
    }, 1000);
    childProcess.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
    childProcess.kill('SIGTERM');
  }).catch(() => undefined);
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

  assert.fail(`Timed out while waiting for storage-slot smoke state. Last snapshot: ${JSON.stringify(lastSnapshot)}`);
}

function findNodeByKind(snapshot, kind) {
  const node = snapshot.state.nodes.find((candidate) => candidate.kind === kind);
  assert.ok(node, `Missing ${kind} node in snapshot.`);
  return node;
}

function findNodeById(snapshot, nodeId) {
  const node = snapshot.state.nodes.find((candidate) => candidate.id === nodeId);
  assert.ok(node, `Missing node ${nodeId} in snapshot.`);
  return node;
}

async function writePersistedSnapshotFixture(snapshotPath, snapshot) {
  await fs.mkdir(path.dirname(snapshotPath), { recursive: true });
  await fs.writeFile(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
}

function updateNoteStateFixture(state, noteNodeId, { title, content, position, updatedAt }) {
  const nextState = cloneJsonValue(state);
  nextState.updatedAt = updatedAt;
  nextState.nodes = nextState.nodes.map((node) => {
    if (node.id !== noteNodeId) {
      return node;
    }

    return {
      ...node,
      title,
      position,
      metadata: {
        ...node.metadata,
        note: {
          ...node.metadata.note,
          content
        }
      }
    };
  });
  return nextState;
}

function deriveSiblingStoragePath(currentStoragePath) {
  const currentSlotDir = path.dirname(currentStoragePath);
  const extensionDirName = path.basename(currentStoragePath);
  const currentSlotName = path.basename(currentSlotDir);
  const match = currentSlotName.match(/^(.*)-([1-9]\d*)$/);
  const siblingSlotName = match ? match[1] : `${currentSlotName}-1`;
  return path.join(path.dirname(currentSlotDir), siblingSlotName, extensionDirName);
}

function cloneJsonValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function hashJsonValue(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 12);
}

function sleep(timeoutMs) {
  return new Promise((resolve) => setTimeout(resolve, timeoutMs));
}
