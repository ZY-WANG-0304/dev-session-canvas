const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const vscode = require('vscode');
const { activateVisibleExtension, expectedExecutionCandidateGeneration, waitForCommand } = require('./test-helpers.cjs');

const mode = process.env.DEV_SESSION_CANVAS_READER_MODE;
const role = process.env.DEV_SESSION_CANVAS_READER_ROLE;
const shared = process.env.DEV_SESSION_CANVAS_READER_SHARED;
const artifacts = process.env.DEV_SESSION_CANVAS_SMOKE_ARTIFACT_DIR;
const prefix = 'DSC_CANDIDATE_';
const expectedLines = Array.from({ length: 90000 }, (_, index) =>
  `${prefix}${String(index + 1).padStart(5, '0')}_${'0'.repeat(40)}`);
expectedLines.push(`${prefix}UTF8_\u4e2d\u6587_\u00e9`, `${prefix}ANSI`);
const command = (name, ...args) => vscode.commands.executeCommand(`devSessionCanvas.__test.${name}`, ...args);
const snapshot = () => command('getDebugState');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
let surface = role === 'attacher' || mode === 'snapshot-only' ? 'panel' : 'editor';
let nodeId;

module.exports = { run };

async function readJson(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
}
async function publish(file, value) {
  const pending = `${file}.${process.pid}.pending`;
  await fs.writeFile(pending, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
  await fs.link(pending, file);
  await fs.unlink(pending);
}
const sharedFile = name => path.join(shared, name);
const receiptPath = () => sharedFile('subject-write-receipt.json');
async function poll(label, read, accept, timeoutMs = 30000, checkAbort = true) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (checkAbort) {
      const aborted = await readJson(sharedFile('abort.json'));
      if (aborted) throw new Error(`Coordinator aborted: ${aborted.error}`);
      if (await readJson(`${receiptPath()}.gate-timeout.json`)) throw new Error('Writer gate exceeded its fixed 60000ms budget.');
    }
    const value = await read();
    if (accept(value)) return value;
    await sleep(50);
  }
  throw new Error(`Timed out: ${label}`);
}
const waitShared = (name, timeout = 120000) => poll(name, () => readJson(sharedFile(name)), Boolean, timeout);
const probe = () => command('captureWebviewProbe', surface, 10000);
const dispatch = (type, payload) => command('dispatchWebviewMessage', { type, payload }, surface);
const currentNode = state => state.state.nodes.find(node => node.id === nodeId);

async function openSurface(next = surface) {
  surface = next;
  await vscode.commands.executeCommand(surface === 'editor'
    ? 'devSessionCanvas.openCanvasInEditor' : 'devSessionCanvas.openCanvasInPanel');
  await command('waitForCanvasReady', surface, 20000);
  const state = await snapshot();
  assert.equal(state.activeSurface, surface);
  assert.equal(state.surfaceMode[surface], 'active');
  const other = surface === 'editor' ? 'panel' : 'editor';
  assert.notEqual(state.surfaceMode[other], 'active', 'The product must not have two active surfaces in one Host.');
  return state;
}

async function mountedReader(expectedExecution) {
  const mounted = await poll('current real page and execution identity', async () => {
    const state = await snapshot();
    const layout = await probe();
    const messages = await command('getHostMessages');
    const lifecycle = state.surfaceLifecycle[surface];
    const message = messages.findLast(entry => entry.type === 'host/executionSnapshot' &&
      entry.payload.nodeId === nodeId && typeof entry.payload.executionSessionId === 'string' &&
      entry.lifecycle?.surface === surface && entry.lifecycle.generation === lifecycle.generation &&
      entry.lifecycle.frameId === lifecycle.frameId);
    return { state, layout, message };
  }, value => value.layout.nodes.some(node => node.nodeId === nodeId && node.terminalCols >= 64 && node.terminalRows >= 3) &&
    Boolean(value.message) && (mode !== 'live-runtime' || Boolean(value.message.payload.terminalRead)));
  const { payload, lifecycle } = mounted.message;
  if (expectedExecution) assert.equal(payload.executionSessionId, expectedExecution);
  const read = payload.terminalRead;
  if (mode === 'live-runtime') {
    assert.equal(read.sessionId, payload.executionSessionId);
    assert.equal(read.settlementMode, 'final-application-v1');
    assert.equal(typeof read.readId, 'string');
    assert.equal(typeof read.authorityId, 'string');
  }
  return { surface, lifecycle, executionId: payload.executionSessionId,
    ...(read ? { readId: read.readId, authorityId: read.authorityId } : {}) };
}

async function assertBuffer(lines) {
  await poll('actual xterm complete numbered buffer', async () => {
    try {
      await command('performWebviewDomAction', { kind: 'assertExecutionTerminalBuffer', nodeId,
        linePrefix: prefix, expectedLines: lines }, surface, 30000);
      return true;
    } catch (error) {
      if (!/Execution terminal .* (has|differs|is not mounted)/.test(String(error))) throw error;
      return false;
    }
  }, Boolean);
}

function runtimeIdentity(metadata) {
  return { runtimeBackend: metadata.runtimeBackend, runtimeStoragePath: metadata.runtimeStoragePath,
    runtimeSessionId: metadata.runtimeSessionId, kind: 'terminal' };
}
function assertNoHistory(metadata) {
  assert.equal(metadata.terminalHistoryDiscarded, true);
  assert.equal(metadata.liveSession, false);
  for (const key of ['terminalStream', 'serializedTerminalState', 'recentOutput', 'runtimeSessionId', 'pendingLaunch']) {
    assert.equal(metadata[key], undefined, `Completed Runtime cannot retain ${key}.`);
  }
}

async function run() {
  assert.equal(process.platform, 'linux');
  assert(['live-runtime', 'snapshot-only'].includes(mode));
  assert(role === 'owner' || (role === 'attacher' && mode === 'live-runtime'));
  assert(shared && artifacts);
  let failure;
  try {
    await activateVisibleExtension(vscode, 'devsessioncanvas.dev-session-canvas');
    await waitForCommand(vscode, 'devSessionCanvas.__test.getDebugState');
    assert.equal(vscode.workspace.getConfiguration('terminal.integrated').get('scrollback'), 100000);
    await publish(path.join(artifacts, 'environment.json'), { mode, role, hostPid: process.pid,
      versions: process.versions, executable: process.execPath, vscode: vscode.version,
      workspace: vscode.workspace.workspaceFolders.map(folder => folder.uri.fsPath) });
    if (role === 'owner') await runOwner();
    else await runAttacher();
  } catch (error) {
    failure = error;
    await publish(sharedFile(`${role}-failure.json`), { mode, role, error: String(error), stack: error.stack });
    for (const [name, read] of [['state', snapshot], ['probe', probe], ['messages', () => command('getHostMessages')],
      ['events', () => command('getDiagnosticEvents')], ['runtime', () => command('getRuntimeSupervisorState')]]) {
      try { await publish(path.join(artifacts, `failure-${name}.json`), await read()); }
      catch (captureError) { await publish(path.join(artifacts, `failure-${name}-error.json`), { error: String(captureError) }); }
    }
  } finally {
    try {
      await poll('coordinator cleanup order', () => readJson(sharedFile(`cleanup-${role}.json`)), Boolean, 250000, false);
    } catch (error) { failure ??= error; }
    const cleanup = await cleanOriginalExecution();
    if (!cleanup.pass) failure ??= new Error(`${role} original execution cleanup was not confirmed.`);
    await publish(sharedFile(`${role}-cleanup.json`), cleanup);
  }
  if (failure) throw failure;
}

async function runOwner() {
  await command('resetState');
  await openSurface();
  await command('createNode', 'terminal');
  const live = await poll('original Terminal running', snapshot, state =>
    state.state.nodes.some(node => node.kind === 'terminal' && node.metadata.terminal.liveSession));
  const node = live.state.nodes.find(entry => entry.kind === 'terminal');
  nodeId = node.id;
  assert.equal(node.metadata.terminal.persistenceMode, mode);
  await dispatch('webview/resizeNode', { nodeId, position: node.position, size: { width: 900, height: 540 } });
  const initialReader = await mountedReader();
  if (mode === 'live-runtime') {
    assert.equal(initialReader.executionId, node.metadata.terminal.runtimeSessionId);
    assert.match(node.metadata.terminal.runtimeStoragePath, new RegExp(expectedExecutionCandidateGeneration()));
  }
  const saved = await command('flushPersistedState');
  assert(saved.exists && saved.snapshot?.state);
  assert.equal(saved.lastError, undefined);
  const diagnostics = await command('dumpHostDiagnostics');
  const diagnosticSummary = await readJson(diagnostics.summaryPath);
  assert.equal(typeof diagnosticSummary?.storage?.extensionStoragePath, 'string');
  await publish(sharedFile('owner-ready.json'), { hostPid: process.pid, nodeId, initialReader,
    binding: runtimeIdentity(node.metadata.terminal), storage: diagnosticSummary.storage });
  if (mode === 'live-runtime') {
    const attacher = await waitShared('attacher-ready.json');
    assert.notEqual(attacher.hostPid, process.pid);
    assert.equal(attacher.initialReader.executionId, initialReader.executionId);
    assert.equal(attacher.initialReader.authorityId, initialReader.authorityId);
    assert.notEqual(attacher.initialReader.readId, initialReader.readId);
  }
  await command('clearDiagnosticEvents');
  const subjectNode = process.env.DEV_SESSION_CANVAS_CANDIDATE_SUBJECT_NODE;
  assert(subjectNode);
  await publish(sharedFile('subject-command-submitted.json'), { executionId: initialReader.executionId });
  await dispatch('webview/executionInput', { kind: 'terminal', nodeId,
    data: `exec ${quote(subjectNode)} ${quote(path.join(__dirname, 'fixtures/execution-candidate-subject.cjs'))} ${quote(receiptPath())} --reader-isolation-gate\r` });
  const gate = await poll('writer paused after successful line 45000', () => readJson(`${receiptPath()}.gate-ready.json`), Boolean, 120000);
  assert.equal(gate.lineCount, 45000);
  assert.equal(gate.timeoutMs, 60000);
  await assertBuffer(expectedLines.slice(0, 45000));
  if (mode === 'live-runtime') await waitShared('attacher-prefix-applied.json');
  let finalReader = initialReader;
  const transitions = [];
  for (const next of mode === 'live-runtime' ? ['panel', 'editor'] : ['editor']) {
    const before = finalReader;
    await openSurface(next);
    finalReader = await mountedReader(initialReader.executionId);
    if (mode === 'live-runtime') {
      assert.equal(finalReader.authorityId, initialReader.authorityId);
      assert.notEqual(finalReader.readId, before.readId);
    }
    assert.notDeepEqual(finalReader.lifecycle, before.lifecycle);
    await assertBuffer(expectedLines.slice(0, 45000));
    const events = await command('getDiagnosticEvents');
    transitions.push({ before, after: finalReader, state: await snapshot(),
      localCancellations: events.filter(event => event.kind === 'execution/localTerminalReaderSettled' &&
        event.detail?.executionSessionId === initialReader.executionId && event.detail.outcome?.kind !== 'applied') });
  }
  await publish(sharedFile('owner-switches.json'), { transitions, finalReader });
  if (mode === 'live-runtime') await waitShared('attacher-survived.json');
  assert.equal((await readJson(`${receiptPath()}.gate-timeout.json`)), undefined);
  await publish(`${receiptPath()}.gate-release.json`, { gateId: gate.gateId });
  await verifyFinal({ initialReader, finalReader, transitions, gate });
}

async function runAttacher() {
  const owner = await waitShared('owner-ready.json');
  const storageCopy = await waitShared('attacher-storage-ready.json');
  assert.equal(typeof storageCopy.sourcePath, 'string');
  assert.equal(typeof storageCopy.targetPath, 'string');
  assert.equal(storageCopy.mode, 'frozen-owner-flush-before-attacher-start');
  assert.equal(storageCopy.concurrentWorkspacePersistenceClaim, false);
  assert.equal(storageCopy.sourceHash, storageCopy.targetHash);
  assert.equal(JSON.parse(process.env.DEV_SESSION_CANVAS_READER_STORAGE_COPY).targetPath, storageCopy.targetPath);
  nodeId = owner.nodeId;
  await openSurface('panel');
  const loadSelected = (await command('getDiagnosticEvents')).findLast(event => event.kind === 'state/loadSelected')?.detail;
  assert.equal(loadSelected?.source, 'snapshot');
  assert.equal(loadSelected.snapshotPath, path.join(storageCopy.targetPath, 'canvas-state.json'));
  assert.equal(loadSelected.storagePath, storageCopy.targetPath);
  const live = await poll('normal root load restored original live binding', snapshot, state =>
    currentNode(state)?.metadata.terminal.liveSession === true);
  assert.deepEqual(runtimeIdentity(currentNode(live).metadata.terminal), owner.binding);
  const initialReader = await mountedReader(owner.initialReader.executionId);
  assert.equal(initialReader.authorityId, owner.initialReader.authorityId);
  assert.notEqual(initialReader.readId, owner.initialReader.readId);
  await command('clearDiagnosticEvents');
  await publish(sharedFile('attacher-ready.json'), { hostPid: process.pid, nodeId, initialReader });
  const gate = await poll('original writer gate', () => readJson(`${receiptPath()}.gate-ready.json`), Boolean, 120000);
  await assertBuffer(expectedLines.slice(0, 45000));
  await publish(sharedFile('attacher-prefix-applied.json'), { initialReader, lineCount: 45000 });
  await waitShared('owner-switches.json');
  const state = await snapshot();
  assert.equal(state.activeSurface, 'panel');
  const lifecycle = state.surfaceLifecycle.panel;
  assert.equal(lifecycle.generation, initialReader.lifecycle.generation);
  assert.equal(lifecycle.frameId, initialReader.lifecycle.frameId);
  const pages = (await command('getHostMessages')).filter(message =>
    message.type === 'host/executionTerminalPage' && message.payload.nodeId === nodeId && message.payload.page);
  assert(pages.length, 'The original survivor must have actual page delivery evidence.');
  for (const page of pages) assert.equal(page.payload.readId, initialReader.readId);
  await assertBuffer(expectedLines.slice(0, 45000));
  await publish(sharedFile('attacher-survived.json'), { initialReader,
    lastPage: { readId: pages.at(-1).payload.readId, revision: pages.at(-1).payload.page.revision } });
  await verifyFinal({ initialReader, finalReader: initialReader, transitions: [], gate });
}

async function verifyFinal({ initialReader, finalReader, transitions, gate }) {
  const executionId = initialReader.executionId;
  const receipt = await poll('successful original writer receipt', () => readJson(receiptPath()),
    value => value?.terminalWriteComplete === true, 120000);
  const digest = createHash('sha256');
  let bytesWritten = 0;
  const expect = text => { const bytes = Buffer.from(text); bytesWritten += bytes.length; digest.update(bytes); };
  expect('\x1b[2J\x1b[H');
  for (const line of expectedLines.slice(0, 90001)) expect(`${line}\r\n`);
  expect(`\x1b[31m${expectedLines[90001]}\x1b[0m\r\n`);
  expect('\x1b]2;DSC_CANDIDATE_FINAL_TITLE\x07\x1b[3;7H');
  assert.equal(receipt.bytesWritten, bytesWritten);
  assert.equal(receipt.sha256, digest.digest('hex'));
  assert.equal(receipt.pid, gate.identity.pid);
  const ended = await poll('natural completed original execution', snapshot, state => {
    const node = currentNode(state);
    return node?.status === 'closed' && node.metadata.terminal.liveSession === false &&
      (mode !== 'live-runtime' || node.metadata.terminal.terminalHistoryDiscarded === true);
  }, 120000);
  assert.equal(currentNode(ended).metadata.terminal.lastExitCode, 0);
  await assertBuffer(expectedLines);
  const finalTerminal = (await probe()).nodes.find(node => node.nodeId === nodeId);
  assert.equal(finalTerminal.terminalCursorX, 6);
  assert.equal(finalTerminal.terminalCursorY, 2);
  const events = await poll('same original reader final application and real source EOF', () => command('getDiagnosticEvents'), events =>
    events.some(event => event.kind === 'runtime/terminalSourceDisposition' && event.detail?.nodeId === nodeId &&
      (event.detail.sessionId === executionId || event.detail.executionSessionId === executionId)) &&
    events.some(event => matchesSettlement(event, finalReader)));
  const source = events.find(event => event.kind === 'runtime/terminalSourceDisposition' && event.detail?.nodeId === nodeId &&
    (event.detail.sessionId === executionId || event.detail.executionSessionId === executionId)).detail;
  assert.equal(source.sourceDisposition.kind, 'eof');
  const settlement = events.find(event => matchesSettlement(event, finalReader)).detail;
  const finalRevision = mode === 'live-runtime' ? settlement.outcome.finalRevision : settlement.outcome.finalOutputSequence;
  assert.equal(source.finalRevision, finalRevision);
  const saved = await command('flushPersistedState');
  assert(saved.exists && saved.snapshot?.state);
  assert.equal(saved.lastError, undefined);
  const savedNode = saved.snapshot.state.nodes.find(node => node.id === nodeId);
  assert(savedNode);
  if (mode === 'live-runtime') {
    assertNoHistory(currentNode(ended).metadata.terminal);
    assertNoHistory(savedNode.metadata.terminal);
    assert(Buffer.byteLength(JSON.stringify(savedNode)) < 16384);
    await poll('original Runtime binding released', () => command('getRuntimeSupervisorState'), state =>
      !state.bindings.some(binding => binding.nodeId === nodeId));
  } else {
    assert(savedNode.metadata.terminal.serializedTerminalState.data.includes(`${prefix}90000_`));
    assert.equal(savedNode.metadata.terminal.outputSequence, finalRevision);
    assert(transitions.some(transition => transition.localCancellations.some(event =>
      event.detail.lifecycle.surface === 'panel' && event.detail.outcome.kind === 'cancelled')));
  }
  const report = { schemaVersion: 1, mode, role, hostPid: process.pid, nodeId, executionId,
    initialReader, finalReader, transitions, gate, receipt, sourceDisposition: source.sourceDisposition,
    settlement, finalRevision, finalTerminal, completeBufferVerified: true,
    noHistory: mode === 'live-runtime', savedNodeBytes: Buffer.byteLength(JSON.stringify(savedNode)),
    savedSnapshotBytes: Buffer.byteLength(savedNode.metadata.terminal.serializedTerminalState?.data ?? ''),
    remoteCancellationAckClaim: false, slowConsumerClaim: false, pass: true };
  await publish(path.join(artifacts, 'verified.json'), report);
  await publish(sharedFile(`${role}-verified.json`), report);
}

function matchesSettlement(event, reader) {
  const detail = event.detail;
  if (detail?.nodeId !== nodeId || detail.outcome?.kind !== 'applied') return false;
  return mode === 'live-runtime'
    ? event.kind === 'runtime/terminalReadSettled' && detail.sessionId === reader.executionId &&
      detail.readId === reader.readId && ['recorded', 'duplicate'].includes(detail.settlement)
    : event.kind === 'execution/localTerminalReaderSettled' && detail.executionSessionId === reader.executionId &&
      detail.lifecycle?.surface === reader.surface && detail.lifecycle.generation === reader.lifecycle.generation &&
      detail.lifecycle.frameId === reader.lifecycle.frameId;
}

async function cleanOriginalExecution() {
  const errors = [];
  const deadline = Date.now() + 50000;
  const remaining = () => Math.max(0, deadline - Date.now());
  const observe = async (read, label) => {
    let timer;
    try {
      if (!remaining()) throw new Error(`Cleanup observation expired: ${label}`);
      return await Promise.race([read(),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Cleanup observation expired: ${label}`)), remaining()); })]);
    } finally { clearTimeout(timer); }
  };
  try { await observe(() => command('resetState'), 'reset'); }
  catch (error) { errors.push(`reset: ${error}`); }
  let runtime;
  try {
    runtime = await poll('Host bindings and operations released', () => observe(() => command('getRuntimeSupervisorState'), 'runtime state'), state =>
      state.bindings.length === 0 && state.pendingRuntimeSupervisorOperationCount === 0, remaining(), false);
    assert.equal((await observe(snapshot, 'canvas state')).state.nodes.filter(node => node.kind === 'terminal').length, 0);
  } catch (error) { errors.push(`Host cleanup: ${error}`); }
  let subject = { kind: 'not-started' };
  try {
    const gate = await observe(() => readJson(`${receiptPath()}.gate-ready.json`), 'subject identity');
    if (gate) {
      subject = await poll('original subject reaped', async () => {
        try {
          const stat = await observe(() => fs.readFile(`/proc/${gate.identity.pid}/stat`, 'utf8'), 'original process state');
          const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
          return fields[19] === gate.identity.startTicks ? { kind: 'still-present', identity: gate.identity }
            : { kind: 'original-identity-gone', identity: gate.identity, pidReused: true };
        } catch (error) {
          if (error.code !== 'ENOENT' && error.code !== 'ESRCH') throw error;
          return { kind: 'original-identity-gone', identity: gate.identity, pidReused: false };
        }
      }, value => value.kind === 'original-identity-gone', remaining(), false);
    } else if (await observe(() => readJson(sharedFile('subject-command-submitted.json')), 'subject submission')) {
      subject = { kind: 'unconfirmed', reason: 'writer-identity-not-observed' };
      errors.push('The submitted subject did not publish an original identity.');
    }
  } catch (error) { errors.push(`subject cleanup: ${error}`); subject = { kind: 'unconfirmed' }; }
  return { mode, role, hostPid: process.pid, runtime, subject, errors, pass: errors.length === 0,
    scope: 'Original subject identity, node and Host bindings only; not all OS resources.', processTreeKillUsed: false };
}
