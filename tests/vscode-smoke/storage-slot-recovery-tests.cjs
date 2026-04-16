const assert = require('assert');
const { createHash } = require('crypto');
const fs = require('fs/promises');
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
