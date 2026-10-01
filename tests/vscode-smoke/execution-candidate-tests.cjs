const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const vscode = require('vscode');
const { activateVisibleExtension, waitForCommand } = require('./test-helpers.cjs');
const windows = require('./windows-execution-candidate.cjs');
const { captureInstalledExtensionReceipt } = require('./installed-execution-candidate.cjs');

const mode = process.env.DEV_SESSION_CANVAS_CANDIDATE_MODE;
const phase = process.env.DEV_SESSION_CANVAS_CANDIDATE_PHASE;
const artifacts = process.env.DEV_SESSION_CANVAS_SMOKE_ARTIFACT_DIR;
const surface = mode === 'live-runtime' ? 'editor' : 'panel';
const prefix = 'DSC_CANDIDATE_';
const expectedLines = Array.from({ length: 90000 }, (_, index) =>
  `${prefix}${String(index + 1).padStart(5, '0')}_${'0'.repeat(40)}`);
expectedLines.push(`${prefix}UTF8_\u4e2d\u6587_\u00e9`, `${prefix}ANSI`);
const command = (name, ...args) => vscode.commands.executeCommand(`devSessionCanvas.__test.${name}`, ...args);
const snapshot = () => command('getDebugState');
const nodeById = (state, id) => state.state.nodes.find(node => node.id === id);
const writeJson = (name, value) => fs.writeFile(path.join(artifacts, name), `${JSON.stringify(value, null, 2)}\n`);
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let windowsObserver, windowsReceiptPath;

async function optionalJson(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
}

module.exports = { run };

async function poll(label, read, accept, timeoutMs = 30000) {
  const end = Date.now() + timeoutMs;
  let latest;
  while (Date.now() < end) {
    latest = await read();
    if (accept(latest)) return latest;
    await sleep(50);
  }
  throw new Error(`Timed out: ${label}`);
}

async function openSurface() {
  await vscode.commands.executeCommand(surface === 'editor'
    ? 'devSessionCanvas.openCanvasInEditor' : 'devSessionCanvas.openCanvasInPanel');
  await command('waitForCanvasReady', surface, 20000);
}

async function probe() {
  return command('captureWebviewProbe', surface, 10000);
}

async function dispatch(type, payload) {
  return command('dispatchWebviewMessage', { type, payload }, surface);
}

async function assertBuffer(id, lines) {
  return command('performWebviewDomAction', {
    kind: 'assertExecutionTerminalBuffer', nodeId: id, linePrefix: prefix, expectedLines: lines
  }, surface, 30000);
}

function assertRuntimeDiscarded(metadata) {
  assert.equal(metadata.terminalHistoryDiscarded, true);
  assert.equal(metadata.liveSession, false);
  for (const key of ['terminalStream', 'serializedTerminalState', 'recentOutput', 'runtimeSessionId', 'pendingLaunch']) {
    assert.equal(metadata[key], undefined, `Completed Runtime must not retain ${key}.`);
  }
}

async function run() {
  assert(['live-runtime', 'snapshot-only'].includes(mode));
  assert(['complete', 'reopen'].includes(phase));
  assert(artifacts);
  try {
    const extension = await activateVisibleExtension(vscode, 'devsessioncanvas.dev-session-canvas');
    const installedExpectation = process.env.DEV_SESSION_CANVAS_INSTALLED_VSIX_EXPECTATION;
    const installedVsix = installedExpectation
      ? await captureInstalledExtensionReceipt(extension, installedExpectation) : undefined;
    await waitForCommand(vscode, 'devSessionCanvas.__test.getDebugState');
    await openSurface();
    if (process.platform === 'win32') {
      assert.equal(vscode.version, '1.117.0'); assert.equal(process.versions.electron, '39.8.7');
      assert.equal(process.versions.node, '22.22.1'); assert.equal(process.versions.modules, '140');
    }
    assert.equal(vscode.workspace.getConfiguration('terminal.integrated').get('scrollback'), 100000);
    await writeJson(`${phase}-environment.json`, { mode, phase, surface, pid: process.pid,
      versions: process.versions, vscode: vscode.version, executable: process.execPath,
      ...(installedVsix ? { installedVsix } : {}) });
    if (phase === 'complete') await complete();
    else await reopen();
  } catch (error) {
    await writeJson(`${phase}-failure.json`, { error: String(error), stack: error.stack });
    for (const [file, read] of [['snapshot', snapshot], ['events', () => command('getDiagnosticEvents')],
      ['messages', () => command('getHostMessages')], ['probe', probe],
      ['runtime', () => command('getRuntimeSupervisorState')]]) {
      try { await writeJson(`${phase}-failure-${file}.json`, await read()); }
      catch (captureError) { await writeJson(`${phase}-failure-${file}-error.json`, { error: String(captureError) }); }
    }
    // Preserve the failed state first; cleanup failures must not erase the original result.
    let resetStateComplete = true;
    try { await command('resetState'); }
    catch (cleanupError) { resetStateComplete = false; await writeJson(`${phase}-cleanup-error.json`, { error: String(cleanupError) }); }
    if (process.platform === 'win32' && phase === 'complete') {
      let observationError, safety, productCleanup;
      if (windowsObserver) {
        try { await poll('original Windows writer cleanup observation', async () => windowsObserver.result, Boolean, 30000); }
        catch (error) { observationError = String(error); }
      }
      try {
        safety = windowsReceiptPath ? await optionalJson(`${windowsReceiptPath}.safety.json`) : undefined;
        const runtime = await command('getRuntimeSupervisorState');
        productCleanup = { bindings: runtime.bindings.length,
          terminalNodes: (await snapshot()).state.nodes.filter(entry => entry.kind === 'terminal').length };
      } catch (error) { observationError ??= String(error); }
      await writeJson(`${phase}-windows-cleanup.json`, {
        safe: resetStateComplete && !observationError && productCleanup?.bindings === 0
          && productCleanup?.terminalNodes === 0 && Boolean(windows.exitFact(windowsObserver)),
        subjectExit: windows.exitFact(windowsObserver), observer: windowsObserver, observationError,
        resetStateComplete, productCleanup, safety,
        processTreeKillUsed: false, unknownPidConsideredExited: false });
    }
    throw error;
  }
}

async function complete() {
  await command('resetState');
  await openSurface();
  await command('createNode', 'terminal');
  const started = await poll('real Terminal started', snapshot, state => state.state.nodes.some(node =>
    node.kind === 'terminal' && node.metadata?.terminal?.liveSession));
  const node = started.state.nodes.find(candidate => candidate.kind === 'terminal');
  const id = node.id;
  const metadata = node.metadata.terminal;
  assert.equal(metadata.persistenceMode, mode);
  if (mode === 'live-runtime') {
    assert.match(metadata.runtimeStoragePath, process.platform === 'win32' ? /terminal-exit-windows-v1/
      : process.platform === 'darwin' ? /terminal-exit-macos-v1/ : /terminal-exit-v1/);
    assert(metadata.runtimeSessionId);
  }
  await dispatch('webview/resizeNode', { nodeId: id, position: node.position,
    size: { width: 900, height: 540 } });
  const mounted = await poll('terminal mounted in actual Webview', async () => {
    const layout = await probe();
    const messages = await command('getHostMessages');
    return { layout, snapshot: messages.findLast(message => message.type === 'host/executionSnapshot' &&
      message.payload.nodeId === id && typeof message.payload.executionSessionId === 'string') };
  }, value => value.layout.nodes.some(entry =>
    entry.nodeId === id && entry.terminalCols >= 64 && entry.terminalRows >= 3) && Boolean(value.snapshot));
  const initialSnapshot = mounted.snapshot;
  assert(initialSnapshot, 'An actual mounted reader must expose the original execution identity.');
  const executionId = initialSnapshot.payload.executionSessionId;
  if (mode === 'live-runtime') assert.equal(executionId, metadata.runtimeSessionId);
  await writeJson('started.json', { node, executionId, runtime: await command('getRuntimeSupervisorState') });
  await command('clearHostMessages');
  await command('clearDiagnosticEvents');
  const receiptPath = path.join(artifacts, 'subject-write-receipt.json');
  const subject = path.join(__dirname, process.platform === 'win32'
    ? 'fixtures/execution-candidate-windows.cjs' : 'fixtures/execution-candidate-subject.cjs');
  const subjectNode = process.env.DEV_SESSION_CANVAS_CANDIDATE_SUBJECT_NODE;
  assert(subjectNode);
  if (process.platform === 'win32') {
    windowsReceiptPath = receiptPath;
    await dispatch('webview/executionInput', { kind: 'terminal', nodeId: id,
      data: windows.terminalCommand(path.join(__dirname, 'fixtures/execution-candidate-windows.cmd'), subjectNode, subject, receiptPath) });
    const ready = await poll('Windows writer ready for identity binding', () => optionalJson(`${receiptPath}.ready.json`), Boolean);
    assert(ready.stdinTTY && ready.stdoutTTY); assert.equal(ready.executable, subjectNode);
    windowsObserver = windows.startObserver(ready, subjectNode,
      path.join(__dirname, 'fixtures/execution-candidate-windows-observer.ps1'));
    await poll('original Windows writer handle acquired', async () => windowsObserver,
      value => value.events.length || value.result || value.error);
    assert.equal(windowsObserver.events[0]?.kind, 'observing');
    await dispatch('webview/executionInput', { kind: 'terminal', nodeId: id, data: `observe:${windowsObserver.nonce}\r` });
    const observed = await poll('original Windows writer identity response', () => optionalJson(`${receiptPath}.observed.json`), Boolean);
    windows.bindObserver(windowsObserver, observed);
    await writeJson('windows-subject-bound.json', windowsObserver);
    await dispatch('webview/executionInput', { kind: 'terminal', nodeId: id, data: `run:${windowsObserver.nonce}\r` });
  } else {
    await dispatch('webview/executionInput', { kind: 'terminal', nodeId: id,
      data: `exec ${quote(subjectNode)} ${quote(subject)} ${quote(receiptPath)}\r` });
  }
  await poll('subject successful terminal-write receipt', async () => {
    try { return JSON.parse(await fs.readFile(receiptPath, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
  }, value => value?.terminalWriteComplete === true, 120000);
  const receipt = JSON.parse(await fs.readFile(receiptPath, 'utf8'));
  const digest = createHash('sha256');
  let expectedBytes = 0;
  const expectBytes = text => { const bytes = Buffer.from(text); digest.update(bytes); expectedBytes += bytes.length; };
  expectBytes('\x1b[2J\x1b[H');
  for (const line of expectedLines.slice(0, 90000)) expectBytes(`${line}\r\n`);
  expectBytes(`${expectedLines[90000]}\r\n`);
  expectBytes(`\x1b[31m${expectedLines[90001]}\x1b[0m\r\n`);
  expectBytes('\x1b]2;DSC_CANDIDATE_FINAL_TITLE\x07\x1b[3;7H');
  assert.equal(receipt.bytesWritten, expectedBytes);
  assert.equal(receipt.sha256, digest.digest('hex'));
  assert.equal(receipt.lineCount, 90000);
  if (process.platform === 'win32') {
    assert.equal(receipt.pid, windowsObserver.subject.pid); assert.equal(receipt.ppid, windowsObserver.subject.ppid);
    const source = await fs.readFile(`${receiptPath}.source.bin`);
    assert.equal(source.length, expectedBytes); assert.equal(createHash('sha256').update(source).digest('hex'), receipt.sha256);
  }
  const ended = await poll('natural exit and final product state', snapshot, state => {
    const current = nodeById(state, id);
    return current?.status === 'closed' && current.metadata.terminal.liveSession === false &&
      (mode !== 'live-runtime' || current.metadata.terminal.terminalHistoryDiscarded === true);
  }, 120000);
  assert.equal(nodeById(ended, id).metadata.terminal.lastExitCode, 0);
  await poll('actual xterm buffer fully applied', async () => {
    try { await assertBuffer(id, expectedLines); return true; }
    catch (error) { if (!/Execution terminal .* (has|differs)/.test(String(error))) throw error; return false; }
  }, Boolean, 30000);
  const finalProbe = await probe();
  const terminalProbe = finalProbe.nodes.find(entry => entry.nodeId === id);
  assert.equal(terminalProbe.terminalCursorX, 6, 'Final CSI column must be applied.');
  assert.equal(terminalProbe.terminalCursorY, 2, 'Final CSI row must be applied.');
  if (process.platform === 'win32') {
    await poll('original Windows writer exited', async () => windowsObserver.result, Boolean);
    const subjectExit = windows.assertCompleted(windowsObserver, await optionalJson(`${receiptPath}.safety.json`));
    await writeJson('windows-subject-exited.json', { subjectExit, observer: windowsObserver,
      processObjectDisappearanceRequired: false });
  } else {
    await poll('real subject process reaped', async () => {
      try { process.kill(receipt.pid, 0); return false; }
      catch (error) { if (error.code === 'ESRCH') return true; throw error; }
    }, Boolean);
  }
  const saved = await command('flushPersistedState');
  assert(saved.exists && saved.snapshot?.state);
  const savedNode = saved.snapshot.state.nodes.find(entry => entry.id === id);
  if (mode === 'live-runtime') {
    assertRuntimeDiscarded(nodeById(ended, id).metadata.terminal);
    assertRuntimeDiscarded(savedNode.metadata.terminal);
    assert(Buffer.byteLength(JSON.stringify(savedNode)) < 16384, 'Completed Runtime node must remain lightweight.');
    await poll('completed Runtime binding removed', () => command('getRuntimeSupervisorState'), state =>
      !state.bindings.some(binding => binding.nodeId === id));
    await poll('same Runtime reader applied settlement', () => command('getDiagnosticEvents'), events =>
      events.some(event => event.kind === 'runtime/terminalReadSettled' && event.detail?.nodeId === id &&
        event.detail.sessionId === executionId && event.detail.outcome?.kind === 'applied'));
  } else {
    assert(savedNode.metadata.terminal.serializedTerminalState?.data.includes(`${prefix}90000_`),
      'Snapshot-only keeps its final snapshot.');
    await poll('same owned local reader applied final revision', () => command('getDiagnosticEvents'), events =>
      events.some(event => event.kind === 'execution/localTerminalReaderSettled' &&
        event.detail?.nodeId === id && event.detail.executionSessionId === executionId &&
        event.detail.outcome?.kind === 'applied' &&
        event.detail.outcome.finalOutputSequence === savedNode.metadata.terminal.outputSequence));
  }
  await writeJson('completed.json', { mode, id, executionId, runtimeSessionId: metadata.runtimeSessionId,
    ...(process.platform === 'win32' ? { subjectExit: windows.exitFact(windowsObserver), sourceByteIdentityWithConptyClaim: false } : {}),
    receipt, savedNodeBytes: Buffer.byteLength(JSON.stringify(savedNode)), finalProbe,
    runtime: await command('getRuntimeSupervisorState'), events: await command('getDiagnosticEvents'), pass: true });
}

async function reopen() {
  const completed = JSON.parse(await fs.readFile(path.join(artifacts, 'completed.json'), 'utf8'));
  const id = completed.id;
  const reopened = await snapshot();
  const node = nodeById(reopened, id);
  assert(node, 'The same persisted node must reopen.');
  assert.equal(node.metadata.terminal.liveSession, false);
  assert.equal(node.status, 'closed');
  await dispatch('webview/attachExecutionSession', { kind: 'terminal', nodeId: id });
  if (mode === 'live-runtime') {
    assertRuntimeDiscarded(node.metadata.terminal);
    await poll('reopened completed Runtime empty snapshot', () => command('getHostMessages'), messages =>
      messages.some(message => message.type === 'host/executionSnapshot' && message.payload.nodeId === id &&
        message.payload.liveSession === false && message.payload.output === '' &&
        !message.payload.terminalRead && !message.payload.terminalStream && !message.payload.serializedTerminalState));
    await assertBuffer(id, []);
  } else {
    await poll('reopened snapshot-only xterm restored', async () => {
      try { await assertBuffer(id, expectedLines); return true; }
      catch (error) { if (!/Execution terminal .* (has|differs|is not mounted)/.test(String(error))) throw error; return false; }
    }, Boolean, 30000);
  }
  await writeJson('reopened.json', { mode, id, node, probe: await probe(),
    runtime: await command('getRuntimeSupervisorState'), pass: true });
  await command('resetState');
  const cleanup = await command('getRuntimeSupervisorState');
  assert.equal(cleanup.bindings.length, 0);
  assert.equal((await snapshot()).state.nodes.filter(entry => entry.kind === 'terminal').length, 0);
  await writeJson('cleanup.json', { runtime: cleanup, pass: true,
    scope: process.platform === 'win32'
      ? 'Original writer object observed exited; node and Host bindings removed. Does not require object disappearance or assert all OS resources or A5.'
      : 'Subject process reaped; node and Host bindings removed. Does not assert all OS resources or A5.' });
}
