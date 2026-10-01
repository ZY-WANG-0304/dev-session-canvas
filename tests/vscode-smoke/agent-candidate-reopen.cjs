const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');

const REOPEN_CHECKS = ['attempted', 'newHost', 'sameRuntime', 'sameWorkspace', 'sameUserData', 'persistedNodeLoaded',
  'stoppedNodeRetained', 'emptyStateRetained', 'sequenceRetained', 'freshPage', 'pageBufferEmpty',
  'pageCursorOrigin', 'pageViewportOrigin', 'pageNormalBuffer', 'noNewExecution', 'cleanupComplete'];
const same = isDeepStrictEqual;
const nodeIn = (value, id) => value?.state?.nodes?.find(node => node.id === id);
const emptySessions = value => Array.isArray(value?.executionSessions?.agent) && value.executionSessions.agent.length === 0 &&
  Array.isArray(value.executionSessions.terminal) && value.executionSessions.terminal.length === 0 &&
  value.runtimeSessionBindingCount === 0 && value.pendingRuntimeSupervisorOperationCount === 0;
const emptyBindings = value => Array.isArray(value?.bindings) && value.bindings.length === 0 &&
  value.pendingRuntimeSupervisorOperationCount === 0;

function reopenReportPassed(value) {
  return value?.schemaVersion === 1 && value.pass === true && REOPEN_CHECKS.every(key => value[key] === true);
}

async function completeEmptySnapshotReopen({ firstResult, launch, readReport }) {
  assert.equal(firstResult?.pass, true, 'Original Agent scenario did not pass.');
  assert.equal(typeof firstResult.reopenRequired, 'boolean', 'Missing conditional reopen decision.');
  if (!firstResult.reopenRequired) return false;
  assert.equal(firstResult.reopenHandoffReady, true, 'Original Host did not complete the reopen handoff.');
  await launch();
  assert(reopenReportPassed(await readReport()), 'Required empty snapshot reopen report is missing or incomplete.');
  return true;
}

async function runEmptySnapshotReopen({ config, hostPid, workspaceFolders, activate, command, openCanvas,
  probe, assertBuffer, readJson, writeJson, realpath = fs.realpath }) {
  const report = { schemaVersion: 1, pass: false, ...Object.fromEntries(REOPEN_CHECKS.map(key => [key, false])), attempted: true };
  let failure;
  let activated = false;
  const check = (key, condition) => { report[key] = condition === true; assert(report[key], `Empty snapshot reopen: ${key}.`); };
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
    assert.equal(handoff.savedState?.data, '');
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
    check('emptyStateRetained', nodes.every(node => same(node.metadata.agent.serializedTerminalState, handoff.savedState)));
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
    check('pageBufferEmpty', await assertBuffer(handoff.nodeId, []) === true &&
      Array.isArray(terminal.terminalVisibleLines) && terminal.terminalVisibleLines.length === terminal.terminalRows &&
      terminal.terminalVisibleLines.every(line => line === ''));
    check('pageCursorOrigin', terminal.terminalCursorX === 0 && terminal.terminalCursorY === 0);
    check('pageViewportOrigin', terminal.terminalViewportY === 0);
    check('pageNormalBuffer', terminal.terminalBufferType === 'normal');
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

module.exports = { runEmptySnapshotReopen, reopenReportPassed, completeEmptySnapshotReopen, REOPEN_CHECKS };
