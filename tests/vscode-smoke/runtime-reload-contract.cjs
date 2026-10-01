const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { createHash } = require('node:crypto');

const fixedVsixSha256 = '604494fdebc917d3e12b54fceec75a764ed064e486dd0e76ff20513ddca61656';
const completedMarker = 'DSC_A6_COMPLETED';
const snapshotTail = 'SIGNAL:SIGHUP\n\x1b[3J\x1b[2J\x1b[HROOT\n\x1b[3;5H\x1b[31m\u4e2d\u6587\x1b[0m\x1b[5;7H';
const sameIdentity = (expected, actual) => Boolean(expected && actual && Number.isInteger(expected.pid) &&
  expected.pid > 1 && typeof expected.startTicks === 'string' && expected.startTicks.length > 0 &&
  typeof expected.executable === 'string' && expected.executable.startsWith('/') &&
  expected.pid === actual.pid && expected.startTicks === actual.startTicks && expected.executable === actual.executable);
const sameLiveIdentity = (expected, actual) => sameIdentity(expected, actual) && !['Z', 'X'].includes(actual.state);
const exitedIdentity = (expected, actual) => !actual || expected.startTicks !== actual.startTicks || ['Z', 'X'].includes(actual.state);

function readSnapshotHandshake(written, ready, nonce, page) {
  const match = /^(READY:(\d+)x(\d+)\n)HASH:([a-f0-9]{64})\nSIZE:(\d+)x(\d+)\n$/.exec(written);
  if (!match || match[0] !== written || match[1] !== ready ||
      match[4] !== createHash('sha256').update(nonce).digest('hex')) return undefined;
  const initialCols = Number(match[2]), initialRows = Number(match[3]);
  const cols = Number(match[5]), rows = Number(match[6]);
  if (![initialCols, initialRows, cols, rows].every(Number.isSafeInteger) ||
      initialCols < 64 || initialRows < 5 || cols < 64 || rows < 5 ||
      page?.terminalCols !== cols || page.terminalRows !== rows) return undefined;
  return { initialCols, initialRows, cols, rows, expectedPrefix: written };
}

async function readIdentity(pid) {
  assert(Number.isInteger(pid) && pid > 1);
  try {
    const stat = await fs.readFile(`/proc/${pid}/stat`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    return { pid, ppid: Number(fields[1]), state: fields[0], startTicks: fields[19],
      executable: await fs.readlink(`/proc/${pid}/exe`).catch(error => {
        if (['ENOENT', 'ESRCH'].includes(error.code)) return null;
        throw error;
      }) };
  } catch (error) { if (['ENOENT', 'ESRCH'].includes(error.code)) return undefined; throw error; }
}

function assertControl(value) {
  assert.equal(value?.schemaVersion, 1);
  assert(['setup', 'verify'].includes(value.phase));
  assert.match(value.nonce, /^[a-f0-9-]{36}$/);
  assert(Number.isSafeInteger(value.deadlineAt));
  assert(['live-runtime', 'snapshot-only'].includes(value.mode ?? 'live-runtime'));
  if (value.phase === 'verify') {
    assert.equal(value.reloadRequests, 1);
    assert(value.setup?.host && value.setup?.a?.identity);
    if (value.mode !== 'snapshot-only') assert(value.setup?.b?.identity);
  }
  return value;
}

function assertRuntimeDiscarded(node) {
  assert.equal(node?.status, 'closed');
  const metadata = node.metadata?.terminal;
  assert.equal(metadata?.terminalHistoryDiscarded, true);
  assert.equal(metadata.liveSession, false);
  assert.equal(metadata.lastExitCode, 0);
  for (const key of ['terminalStream', 'serializedTerminalState', 'recentOutput', 'runtimeSessionId', 'pendingLaunch']) {
    assert.equal(metadata[key], undefined, `Completed Runtime must not retain ${key}.`);
  }
}

function assertSnapshotNode(node) {
  assert.equal(node?.status, 'closed');
  const metadata = node.metadata?.terminal;
  assert.equal(metadata?.persistenceMode, 'snapshot-only');
  assert.equal(metadata.liveSession, false);
  assert.equal(metadata.lastExitCode, 7);
  assert.equal(metadata.lifecycle, 'closed');
  assert(Number.isSafeInteger(metadata.outputSequence) && metadata.outputSequence > 0);
  assert(typeof metadata.serializedTerminalState?.data === 'string' && metadata.serializedTerminalState.data.length > 0);
  assert(Number.isInteger(metadata.lastCols) && metadata.lastCols >= 8);
  assert(Number.isInteger(metadata.lastRows) && metadata.lastRows >= 5);
  for (const key of ['runtimeBackend', 'runtimeStoragePath', 'runtimeSessionId', 'pendingLaunch']) {
    assert.equal(metadata[key], undefined, `Snapshot-only must not retain ${key}.`);
  }
  return metadata;
}

async function replaySnapshotTail(written, metadata) {
  const { Terminal } = require('@xterm/headless');
  const render = async data => {
    const terminal = new Terminal({ cols: metadata.lastCols, rows: metadata.lastRows,
      scrollback: 100000, allowProposedApi: true });
    try {
      await new Promise(resolve => terminal.write(data, resolve));
      const buffer = terminal.buffer.active;
      const lines = Array.from({ length: buffer.length }, (_, index) => buffer.getLine(index)?.translateToString(true) ?? '');
      return { cols: terminal.cols, rows: terminal.rows, lines, visibleLines: lines.slice(buffer.viewportY, buffer.viewportY + terminal.rows),
        cursorX: buffer.cursorX, cursorY: buffer.cursorY, viewportY: buffer.viewportY, bufferType: buffer.type,
        chineseForeground: buffer.getLine(2)?.getCell(4)?.getFgColor() };
    } finally { terminal.dispose(); }
  };
  assert(Buffer.isBuffer(written) && written.subarray(-Buffer.byteLength(snapshotTail)).equals(Buffer.from(snapshotTail)),
    'Require the independently written complete SIGHUP tail.');
  const original = await render(written);
  const saved = await render(metadata.serializedTerminalState.data);
  assert.deepEqual(saved, original, 'Persisted snapshot must match independent successful-write replay.');
  assert.equal(original.lines[0], 'ROOT');
  assert.equal(original.lines[2], '    \u4e2d\u6587');
  assert.equal(original.chineseForeground, 1);
  assert.equal(original.cursorX, 6);
  assert.equal(original.cursorY, 4);
  return original;
}

function assertReloadReceipts({ control, launcher, setup, verify, cleanup, exit, fallback }) {
  assertControl(control);
  assert.equal(control.phase, 'verify');
  assert.deepEqual(control.setup, setup, 'Verify must use the original durable setup handoff.');
  for (const receipt of [setup, verify, cleanup]) {
    assert(receipt, 'Missing explicit reload receipt.');
    assert.equal(receipt.nonce, control.nonce);
    assert.equal(receipt.pass, true);
  }
  assert.equal(launcher.spawnCount, 1);
  assert.equal(verify.reloadRequests, 1);
  assert(sameLiveIdentity(launcher.ui, setup.ui));
  assert(sameLiveIdentity(launcher.ui, verify.ui), 'Reload must retain the original UI process.');
  assert(!sameIdentity(setup.host, verify.host), 'Reload must start a different Extension Host.');
  assert(exitedIdentity(setup.host, verify.oldHostAtVerify), 'Original Host must exit.');
  if (control.mode === 'snapshot-only') {
    assert.equal(verify.mode, 'snapshot-only');
    assert.equal(verify.node.id, setup.a.id);
    assert.equal(verify.diskReadBeforeDriverProductCalls, true);
    assert.equal(typeof verify.productActivationAtDiskRead.before, 'boolean');
    assert.equal(typeof verify.productActivationAtDiskRead.after, 'boolean');
    assert.equal(verify.oldHostExclusiveDiskWriteClaim, false);
    assert.deepEqual(verify.disk.map(entry => entry.path), setup.diskPaths);
    for (const entry of verify.disk) {
      assert.equal(entry.node.id, setup.a.id);
      assertSnapshotNode(entry.node);
      assert.deepEqual(entry.node.metadata.terminal, verify.disk[0].node.metadata.terminal);
    }
    assert.equal(verify.disk.length, 2);
    assertSnapshotNode(verify.node);
    assert.deepEqual(verify.node.metadata.terminal.serializedTerminalState,
      verify.disk[0].node.metadata.terminal.serializedTerminalState);
    assert.deepEqual(verify.subjectSignal, { signal: 'SIGHUP' });
    assert.deepEqual(verify.subjectCompleted, { exitCode: 7, writtenComplete: true });
    assert.equal(verify.writtenMatches, true);
    assert.equal(verify.replayMatches, true);
    assert.equal(verify.page.applied, true);
    assert.equal(verify.page.cursorX, 6);
    assert.equal(verify.page.cursorY, 4);
    assert.equal(verify.page.visibleLines[0], 'ROOT');
    assert.equal(verify.page.visibleLines[2], '    \u4e2d\u6587');
    assert.equal(verify.oldReaderOutcome, 'not-observed');
    assert.equal(verify.sourceEofClaim, false);
    assert.equal(verify.resourcesExited, true);
    assert.deepEqual(verify.resourceChecks.map(entry => entry.expected), [setup.a.provider, setup.a.identity]);
    for (const entry of verify.resourceChecks) assert(exitedIdentity(entry.expected, entry.after));
    assert.deepEqual(verify.restartedExecutionEvents, []);
    assert.deepEqual(verify.replacementProviders, []);
    assert(verify.frameId && setup.frameId && verify.frameId !== setup.frameId);
  } else {
    for (const role of ['supervisor', 'provider', 'identity']) {
      assert(sameLiveIdentity(setup.a[role], verify.a[role]), `Reload replaced the original ${role}.`);
    }
    assert.deepEqual(verify.a.binding, setup.a.binding);
    assert.equal(verify.a.reader.sessionId, setup.a.binding.runtimeSessionId);
    assert.equal(verify.a.reader.authorityId, setup.a.reader.authorityId);
    assert.notEqual(verify.a.reader.readId, setup.a.reader.readId);
    assert(verify.frameId && setup.frameId && verify.frameId !== setup.frameId);
    assert.equal(verify.interaction.nonce, control.nonce);
    assert.equal(verify.interaction.applied, true);
    assert.equal(verify.completedNodeId, setup.b.id);
    assertRuntimeDiscarded(verify.completedNode);
    assert.equal(verify.completedAttachEmpty, true);
    assert.deepEqual(verify.restartedExecutionEvents, []);
    assert.equal(verify.aCompletedApplied, true);
    assertRuntimeDiscarded(verify.finishedNode);
  }
  assert.equal(cleanup.runtime.bindings.length, 0);
  assert.equal(cleanup.runtime.pendingRuntimeSupervisorOperationCount, 0);
  assert.equal(cleanup.nodesRemaining, 0);
  assert.equal(cleanup.resourcesExited, true);
  assert.equal(exit.code, 0);
  assert.equal(exit.signal, null);
  assert.deepEqual(fallback, [], 'Fallback cannot count as successful product cleanup.');
}

async function signalOwned(expected, signal, { read = readIdentity, kill = process.kill.bind(process) } = {}) {
  const actual = await read(expected.pid);
  if (exitedIdentity(expected, actual)) return { action: 'already-exited', expected, actual: actual ?? null };
  if (!sameLiveIdentity(expected, actual)) return { action: 'identity-mismatch-no-signal', expected, actual };
  try {
    kill(expected.pid, signal);
    return { action: 'owned-fallback-signal', signal, expected, actual, productCleanupPass: false };
  } catch (error) {
    if (error.code === 'ESRCH') return { action: 'exited-before-signal', expected, actual };
    return { action: 'signal-failed', expected, actual, error: String(error) };
  }
}

module.exports = { fixedVsixSha256, completedMarker, sameIdentity, sameLiveIdentity, exitedIdentity,
  readIdentity, readSnapshotHandshake, assertControl, assertRuntimeDiscarded, assertSnapshotNode, replaySnapshotTail, snapshotTail,
  assertReloadReceipts, signalOwned };
