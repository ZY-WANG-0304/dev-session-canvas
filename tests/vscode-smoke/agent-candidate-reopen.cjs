const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const { Terminal } = require('@xterm/headless');

const REOPEN_CHECKS = ['attempted', 'newHost', 'sameRuntime', 'sameWorkspace', 'sameUserData', 'persistedNodeLoaded',
  'stoppedNodeRetained', 'emptyStateRetained', 'sequenceRetained', 'freshPage', 'pageBufferEmpty',
  'pageCursorOrigin', 'pageViewportOrigin', 'pageNormalBuffer', 'noNewExecution', 'cleanupComplete'];
const GENERIC_REOPEN_CHECKS = ['attempted', 'newHost', 'sameRuntime', 'sameWorkspace', 'sameUserData', 'persistedNodeLoaded',
  'stoppedNodeRetained', 'stateRetained', 'sequenceRetained', 'freshPage', 'pageBufferMatched',
  'pageGeometryMatched', 'noNewExecution', 'cleanupComplete'];
const same = isDeepStrictEqual;
const nodeIn = (value, id) => value?.state?.nodes?.find(node => node.id === id);
const emptySessions = value => Array.isArray(value?.executionSessions?.agent) && value.executionSessions.agent.length === 0 &&
  Array.isArray(value.executionSessions.terminal) && value.executionSessions.terminal.length === 0 &&
  value.runtimeSessionBindingCount === 0 && value.pendingRuntimeSupervisorOperationCount === 0;
const emptyBindings = value => Array.isArray(value?.bindings) && value.bindings.length === 0 &&
  value.pendingRuntimeSupervisorOperationCount === 0;

function reopenReportPassed(value) {
  const legacy = value?.schemaVersion === 1 && value.pass === true && REOPEN_CHECKS.every(key => value[key] === true);
  const generic = value?.stateRetained !== undefined
    ? GENERIC_REOPEN_CHECKS.every(key => value[key] === true) : true;
  return legacy && generic;
}

async function completeSnapshotReopen({ firstResult, launch, readReport }) {
  assert.equal(firstResult?.pass, true, 'Original Agent scenario did not pass.');
  assert.equal(typeof firstResult.reopenRequired, 'boolean', 'Missing conditional reopen decision.');
  if (!firstResult.reopenRequired) return false;
  assert.equal(firstResult.reopenHandoffReady, true, 'Original Host did not complete the reopen handoff.');
  await launch();
  assert(reopenReportPassed(await readReport()), 'Required snapshot reopen report is missing or incomplete.');
  return true;
}

// Keep the old entry point for existing empty-snapshot fixtures.
const completeEmptySnapshotReopen = completeSnapshotReopen;

function terminalState(data, cols, rows) {
  const terminal = new Terminal({ cols, rows, scrollback: 10000, allowProposedApi: true });
  const dispose = () => terminal.dispose();
  return { terminal, dispose };
}

async function hydrateState(savedState, cols, rows) {
  const runtime = terminalState(savedState.data, cols, rows);
  try {
    if (savedState.data) await new Promise(resolve => runtime.terminal.write(savedState.data, resolve));
    if (savedState.viewportY !== undefined) runtime.terminal.scrollToLine(savedState.viewportY);
    const buffer = runtime.terminal.buffer.active;
    const lines = Array.from({ length: buffer.length }, (_, index) => buffer.getLine(index)?.translateToString(true) ?? '');
    return { cols: runtime.terminal.cols, rows: runtime.terminal.rows, lines,
      visibleLines: Array.from({ length: runtime.terminal.rows }, (_, index) => lines[buffer.viewportY + index] ?? ''),
      cursorX: buffer.cursorX, cursorY: buffer.cursorY, viewportY: buffer.viewportY, bufferType: buffer.type };
  } finally { runtime.dispose(); }
}

async function runSnapshotReopen({ config, hostPid, workspaceFolders, activate, command, openCanvas,
  probe, assertBuffer, readJson, writeJson, realpath = fs.realpath, requireEmpty = false }) {
  const report = { schemaVersion: 1, pass: false,
    ...Object.fromEntries([...REOPEN_CHECKS, ...GENERIC_REOPEN_CHECKS].map(key => [key, false])), attempted: true };
  let failure;
  let activated = false;
  const check = (key, condition) => { report[key] = condition === true; assert(report[key], `Snapshot reopen: ${key}.`); };
  const samePath = async (first, second) => typeof first === 'string' && typeof second === 'string' &&
    path.isAbsolute(first) && path.isAbsolute(second) && path.relative(await realpath(first), await realpath(second)) === '';
  const diagnostics = async () => readJson((await command('dumpHostDiagnostics')).summaryPath);
  const noExecution = async summary => {
    const events = await command('getDiagnosticEvents');
    const messages = await command('getHostMessages');
    return emptySessions(summary.runtime) && emptyBindings(await command('getRuntimeSupervisorState')) &&
      Array.isArray(events) && events.length < 2000 &&
      !events.some(event => ['execution/startRequested', 'execution/started'].includes(event.kind)) &&
      Array.isArray(messages) && messages.length < 200 && !messages.some(message =>
        ['host/executionOutput', 'host/executionExit'].includes(message.type) ||
        (message.type === 'host/executionSnapshot' && (message.payload?.liveSession !== false ||
          message.payload.executionSessionId !== undefined)));
  };
  try {
    await activate();
    activated = true;
    assert.equal(config.mode, 'snapshot-only');
    assert.equal(config.lifecycle, 'stop');
    const handoff = await readJson(config.reopenHandoffPath);
    assert.equal(handoff.schemaVersion, 1);
    assert.equal(handoff.originalChecksPassed, true, 'Original CLI/wrapper/provider checks must precede reopen.');
    assert.equal(typeof handoff.nodeId, 'string');
    assert(handoff.nodeId.length > 0);
    assert(Number.isSafeInteger(handoff.outputSequence) && handoff.outputSequence > 0);
    assert.equal(handoff.savedState?.format, 'xterm-serialize-v1');
    assert.equal(typeof handoff.savedState?.data, 'string');
    if (requireEmpty) assert.equal(handoff.savedState.data, '');
    assert.equal(handoff.savedState.outputSequence, handoff.outputSequence);
    check('newHost', Number.isSafeInteger(handoff.hostPid) && handoff.hostPid > 0 &&
      Number.isSafeInteger(hostPid) && hostPid > 0 && hostPid !== handoff.hostPid);
    check('sameRuntime', await samePath(config.runtimeDir, handoff.runtimeDir));
    check('sameWorkspace', workspaceFolders.length === 1 && await samePath(workspaceFolders[0], handoff.workspacePath) &&
      await samePath(config.workspacePath, handoff.workspacePath));
    assert(await samePath(config.userDataDir, handoff.userDataDir), 'Reopen must retain the original user-data directory.');

    // Read the actual startup selection before any diagnostic dump can flush current state.
    const loaded = await command('getDebugState');
    const loadEvents = await command('getDiagnosticEvents');
    const selected = loadEvents?.findLast(event => event.kind === 'state/loadSelected')?.detail;
    assert(selected?.snapshotAvailable === true && ['snapshot', 'rootLocalSnapshot'].includes(selected.source),
      'Reopen must observe an actual persisted startup load.');
    assert.equal(typeof selected.snapshotPath, 'string');
    if (selected.source === 'rootLocalSnapshot') assert(await samePath(selected.rootPath, handoff.workspacePath));
    const persisted = await readJson(selected.snapshotPath);
    const nodes = [nodeIn(loaded, handoff.nodeId), nodeIn(persisted, handoff.nodeId)];
    check('persistedNodeLoaded', nodes.every(node => node?.id === handoff.nodeId && node.kind === 'agent'));
    check('stoppedNodeRetained', nodes.every(node => node.status === 'stopped' &&
      node.metadata?.agent?.liveSession === false && node.metadata.agent.persistenceMode === 'snapshot-only'));
    check('stateRetained', nodes.every(node => same(node.metadata.agent.serializedTerminalState, handoff.savedState)));
    report.emptyStateRetained = report.stateRetained;
    check('sequenceRetained', nodes.every(node => node.metadata.agent.outputSequence === handoff.outputSequence));
    const before = await diagnostics();
    check('sameUserData', before.host?.pid === hostPid && before.workspace?.folders?.length === 1 &&
      await samePath(before.workspace.folders[0], handoff.workspacePath) &&
      await samePath(before.storage?.persistedCanvasSnapshotPath, handoff.snapshotPath));
    check('noNewExecution', await noExecution(before));

    await openCanvas();
    await command('waitForCanvasReady', config.surface, 20000);
    const page = await probe(handoff.nodeId);
    const terminal = page?.nodes?.find(node => node.nodeId === handoff.nodeId);
    const after = await command('getDebugState');
    const frameId = after.surfaceLifecycle?.[config.surface]?.frameId;
    check('freshPage', typeof handoff.readerFrameId === 'string' && handoff.readerFrameId.length > 0 &&
      typeof frameId === 'string' && frameId.length > 0 && frameId !== handoff.readerFrameId && !!terminal &&
      Number.isSafeInteger(terminal.terminalCols) && terminal.terminalCols > 1 &&
      Number.isSafeInteger(terminal.terminalRows) && terminal.terminalRows > 0);
    let expected;
    const emptySnapshot = handoff.savedState.data === '';
    if (!emptySnapshot && Number.isSafeInteger(handoff.savedCols) && handoff.savedCols > 1 &&
        Number.isSafeInteger(handoff.savedRows) && handoff.savedRows > 0) {
      expected = await hydrateState(handoff.savedState, handoff.savedCols, handoff.savedRows);
    } else {
      // Empty snapshots retain the existing page-origin contract; nonempty snapshots require saved dimensions.
      assert.equal(handoff.savedState.data, '');
      expected = { cols: terminal.terminalCols, rows: terminal.terminalRows, lines: [],
        visibleLines: Array(terminal.terminalRows).fill(''), cursorX: 0, cursorY: 0, viewportY: 0, bufferType: 'normal' };
    }
    check('pageBufferMatched', await assertBuffer(handoff.nodeId, expected.lines.filter(line => line.length > 0)) === true &&
      Array.isArray(terminal.terminalVisibleLines) && terminal.terminalVisibleLines.length === terminal.terminalRows &&
      same(terminal.terminalVisibleLines, expected.visibleLines));
    check('pageGeometryMatched', terminal.terminalCols === expected.cols && terminal.terminalRows === expected.rows &&
      terminal.terminalCursorX === expected.cursorX && terminal.terminalCursorY === expected.cursorY &&
      terminal.terminalViewportY === expected.viewportY && terminal.terminalBufferType === expected.bufferType);
    report.pageBufferEmpty = report.pageBufferMatched;
    report.pageCursorOrigin = report.pageGeometryMatched;
    report.pageViewportOrigin = report.pageGeometryMatched;
    report.pageNormalBuffer = report.pageGeometryMatched;
    const finalNode = nodeIn(after, handoff.nodeId);
    assert(finalNode?.status === 'stopped' && finalNode.metadata?.agent?.liveSession === false &&
      same(finalNode.metadata.agent.serializedTerminalState, handoff.savedState) &&
      finalNode.metadata.agent.outputSequence === handoff.outputSequence, 'Page mount must not change the completed state.');
    check('noNewExecution', await noExecution(await diagnostics()));
  } catch (error) { failure = error; }
  finally {
    try {
      assert(activated, 'Reopen activation did not complete; product cleanup is unconfirmed.');
      await command('resetState');
      const saved = await command('flushPersistedState');
      const state = await command('getDebugState');
      const runtime = await command('getRuntimeSupervisorState');
      const summary = await diagnostics();
      check('cleanupComplete', saved?.exists === true && Array.isArray(saved.snapshot?.state?.nodes) &&
        saved.snapshot.state.nodes.length === 0 && Array.isArray(state?.state?.nodes) && state.state.nodes.length === 0 &&
        emptyBindings(runtime) && emptySessions(summary.runtime));
    } catch (error) {
      failure ??= error;
      await writeJson('reopen-cleanup-failure.json', { error: String(error) });
    }
    report.pass = !failure && REOPEN_CHECKS.every(key => report[key] === true);
    await writeJson('reopen-result.json', report);
    if (failure) await writeJson('reopen-failure.json', { error: String(failure) });
  }
  if (failure) throw failure;
  return report;
}

async function runEmptySnapshotReopen(options) {
  return runSnapshotReopen({ ...options, requireEmpty: true });
}

module.exports = { runSnapshotReopen, runEmptySnapshotReopen, reopenReportPassed,
  completeSnapshotReopen, completeEmptySnapshotReopen, REOPEN_CHECKS };
