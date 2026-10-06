const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const net = require('node:net');
const path = require('node:path');
const { createHash } = require('node:crypto');
const vscode = require('vscode');
const { activateVisibleExtension, expectedExecutionCandidateGeneration, waitForCommand } = require('./test-helpers.cjs');
const { captureInstalledExtensionReceipt } = require('./installed-execution-candidate.cjs');
const { resolveLegacyRuntimeSupervisorPaths, resolveSystemdUserRuntimeSupervisorPaths } = require('./runtime-reload-paths.cjs');
const { completedMarker, assertControl, assertRuntimeDiscarded, readIdentity, sameLiveIdentity,
  exitedIdentity, assertSnapshotNode, replaySnapshotTail, snapshotTail, readSnapshotHandshake } = require('./runtime-reload-contract.cjs');

const artifacts = process.env.DEV_SESSION_CANVAS_SMOKE_ARTIFACT_DIR;
const controlPath = process.env.DEV_SESSION_CANVAS_RELOAD_CONTROL;
const surface = 'panel';
const currentStateAcceptance = process.env.DEV_SESSION_CANVAS_EXPECT_CURRENT_STATE === '1';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const command = (name, ...args) => vscode.commands.executeCommand(`devSessionCanvas.__test.${name}`, ...args);
const snapshot = () => command('getDebugState');
const probe = () => command('captureWebviewProbe', surface, 3000);
const dom = action => command('performWebviewDomAction', action, surface, 5000);
const getNode = (state, id) => state.state.nodes.find(node => node.id === id);
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
const read = async name => JSON.parse(await fs.readFile(path.join(artifacts, `${name}.json`), 'utf8'));
const archive = (name, value) => fs.writeFile(path.join(artifacts, `${name}.json`), `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
let control;
let phase = 'initialization';
let owned = { resources: [], expectedSubjects: [], readySubjects: [] };
let activated = false;
let originalDisk;
let productActivationAtDiskRead;
const hash = value => createHash('sha256').update(value).digest('hex');

exports.activate = () => {
  // Do not keep extensionTestsExecute or activation RPC pending across a real reload.
  if (activated) return;
  activated = true;
  void run().catch(async error => {
    try { await archive('driver-unhandled-failure', { phase, error: String(error), stack: error.stack }); }
    catch (failure) { console.error(failure); }
  });
};

async function poll(label, get, accept, timeoutMs = 15000) {
  const deadline = Math.min(Date.now() + timeoutMs, control.deadlineAt - 30000);
  while (Date.now() < deadline) {
    const value = await get();
    if (accept(value)) return value;
    await sleep(50);
  }
  throw new Error(`Timed out: ${label}`);
}

async function atomic(file, value) {
  await fs.writeFile(`${file}.next`, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
  await fs.rename(`${file}.next`, file);
}

async function run() {
  let reloading = false;
  let failure;
  try {
    control = assertControl(JSON.parse(await fs.readFile(controlPath, 'utf8')));
    phase = control.phase;
    await archive(`${phase}-activation`, { nonce: control.nonce, host: await readIdentity(process.pid) });
    if (phase === 'verify') owned = await read('ownership');
    if (phase === 'verify' && control.mode === 'snapshot-only') {
      await poll('original snapshot Host exited', () => readIdentity(control.setup.host.pid),
        value => exitedIdentity(control.setup.host, value));
      originalDisk = [];
      const product = vscode.extensions.getExtension('devsessioncanvas.dev-session-canvas');
      assert(product, 'The installed product must remain registered after reload.');
      productActivationAtDiskRead = { before: product.isActive };
      // Panel restoration may already have activated the product. This only precedes driver calls.
      for (const file of control.setup.diskPaths) {
        const bytes = await fs.readFile(file);
        const node = getNode(JSON.parse(bytes), control.setup.a.id);
        assertSnapshotNode(node);
        originalDisk.push({ path: file, sha256: hash(bytes), node });
        await fs.writeFile(path.join(artifacts, `original-disk-${originalDisk.length}.json`), bytes, { flag: 'wx' });
      }
      productActivationAtDiskRead.after = product.isActive;
      await archive('original-disk', { capturedBeforeDriverProductCalls: true, productActivationAtDiskRead,
        oldHostExclusiveDiskWriteClaim: false, files: originalDisk });
    }
    const extension = await activateVisibleExtension(vscode, 'devsessioncanvas.dev-session-canvas');
    await waitForCommand(vscode, 'devSessionCanvas.__test.getDebugState');
    const installedVsix = await captureInstalledExtensionReceipt(extension, process.env.DEV_SESSION_CANVAS_INSTALLED_VSIX_EXPECTATION);
    const launcher = await poll('original launcher identity', async () => {
      try { return await read('launcher'); } catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
    }, Boolean);
    assert(sameLiveIdentity(launcher.ui, await readIdentity(launcher.ui.pid)));
    let ancestor = await readIdentity(process.pid);
    for (let depth = 0; ancestor && ancestor.pid !== launcher.ui.pid && depth < 12; depth += 1) {
      ancestor = ancestor.ppid > 1 ? await readIdentity(ancestor.ppid) : undefined;
    }
    assert(sameLiveIdentity(launcher.ui, ancestor), 'Driver Host must belong to the original UI child.');
    await archive(`${phase}-environment`, { nonce: control.nonce, phase, versions: process.versions,
      vscode: vscode.version, installedVsix });
    assert.equal(vscode.version, '1.117.0');
    if (phase === 'setup') await command('resetState');
    await vscode.commands.executeCommand('devSessionCanvas.openCanvasInPanel');
    await command('waitForCanvasReady', surface, 20000);
    if (control.mode !== 'snapshot-only') await dom({ kind: 'configureCapacityCalibration', nodeId: 'reload', enabled: true });
    if (phase === 'setup') {
      if (control.mode === 'snapshot-only') await setupSnapshot(launcher, installedVsix);
      else await setup(launcher);
      reloading = true;
      // A disposed workbench RPC may reject during shutdown; only the new Host's
      // independent verify receipt proves reload, never this promise's outcome.
      void vscode.commands.executeCommand('workbench.action.reloadWindow').catch(error => {
        void archive('reload-command-rejection', { error: String(error) }).catch(console.error);
      });
    } else if (control.mode === 'snapshot-only') await verifySnapshot(launcher);
    else await verify(launcher);
  } catch (error) {
    failure = error;
    await archive(`${phase}-failure`, { phase, nonce: control?.nonce, error: String(error), stack: error.stack });
    for (const name of ['getDebugState', 'getRuntimeSupervisorState', 'getDiagnosticEvents']) {
      try { await archive(`failure-${name}`, await command(name)); } catch { /* Original failure remains authoritative. */ }
    }
  } finally {
    if (!reloading) {
      try { await cleanup(); }
      catch (error) { failure ??= error; await archive('cleanup-failure', { error: String(error) }); }
      await archive('driver-finished', { nonce: control?.nonce, pass: !failure, phase });
      void vscode.commands.executeCommand('workbench.action.closeWindow').catch(console.error);
    }
  }
}

async function recordOwnership() {
  await atomic(path.join(artifacts, 'ownership.json'), owned);
}

async function recordInitialExecutionIdentities() {
  await live(owned.supervisor);
  const children = await fs.readFile(`/proc/${owned.supervisor.pid}/task/${owned.supervisor.pid}/children`, 'utf8');
  for (const pid of children.trim().split(/\s+/).filter(Boolean).map(Number)) {
    const argv = (await fs.readFile(`/proc/${pid}/cmdline`, 'utf8')).split('\0');
    if (!argv.some(arg => arg.endsWith('/dist/linux-execution-provider.js'))) continue;
    const provider = await readIdentity(pid);
    assert(provider?.ppid === owned.supervisor.pid);
    const shellPids = (await fs.readFile(`/proc/${pid}/task/${pid}/children`, 'utf8')).trim().split(/\s+/).filter(Boolean).map(Number);
    for (const entry of [provider, ...await Promise.all(shellPids.map(readIdentity))]) {
      if (!entry) continue;
      owned.resources = owned.resources.filter(value => value.pid !== entry.pid || value.startTicks !== entry.startTicks);
      owned.resources.push(entry);
    }
  }
  await recordOwnership();
}

async function live(expected) {
  const actual = await readIdentity(expected.pid);
  assert(sameLiveIdentity(expected, actual), `Original process ${expected.pid} changed or exited.`);
  return actual;
}

async function captureProviderAndSubject(subject) {
  const receipt = await poll('small controlled subject ready', async () => {
    try { return JSON.parse(await fs.readFile(subject.receiptPath, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
  }, value => value.state === 'ready');
  subject.identity = await readIdentity(receipt.pid);
  assert(subject.identity);
  let ancestor = subject.identity;
  for (let depth = 0; ancestor && ancestor.pid !== subject.supervisor.pid && depth < 8; depth += 1) {
    const argv = (await fs.readFile(`/proc/${ancestor.pid}/cmdline`, 'utf8')).split('\0');
    if (argv.some(arg => arg.endsWith('/dist/linux-execution-provider.js'))) subject.provider = ancestor;
    ancestor = ancestor.ppid > 1 ? await readIdentity(ancestor.ppid) : undefined;
  }
  assert(sameLiveIdentity(subject.supervisor, ancestor));
  assert(subject.provider, 'Real subject must descend from the installed provider.');
  for (const entry of [subject.provider, subject.identity]) {
    owned.resources = owned.resources.filter(value => value.pid !== entry.pid || value.startTicks !== entry.startTicks);
    owned.resources.push(entry);
  }
  owned.readySubjects.push(subject.role);
  await recordOwnership();
}

async function createSubject(role) {
  const previous = new Set((await snapshot()).state.nodes.map(node => node.id));
  owned.expectedSubjects.push(role);
  await recordOwnership();
  await command('createNode', 'terminal');
  const state = await poll(`${role} live Terminal`, snapshot, value => value.state.nodes.some(node =>
    !previous.has(node.id) && node.kind === 'terminal' && node.metadata?.terminal?.liveSession));
  const node = state.state.nodes.find(entry => !previous.has(entry.id) && entry.kind === 'terminal');
  const metadata = node.metadata.terminal;
  assert.equal(metadata.persistenceMode, 'live-runtime');
  assert.match(metadata.runtimeStoragePath, new RegExp(currentStateAcceptance
    ? `${expectedExecutionCandidateGeneration()}$` : 'terminal-exit-v1'));
  const relative = path.relative(path.resolve(artifacts, '..', 'user-data'), path.resolve(metadata.runtimeStoragePath));
  assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'Require isolated workspace storage.');
  const paths = metadata.runtimeBackend === 'systemd-user' ? resolveSystemdUserRuntimeSupervisorPaths(metadata.runtimeStoragePath)
    : resolveLegacyRuntimeSupervisorPaths(metadata.runtimeStoragePath);
  const hello = await rpc(paths.socketPath, 'hello');
  assert(hello.capabilities?.executionCandidateProfiles?.includes('linux-owner-v1-candidate'));
  const supervisor = { ...await readIdentity(hello.pid), socketPath: paths.socketPath };
  assert(supervisor.startTicks && supervisor.executable);
  if (owned.supervisor) assert(sameLiveIdentity(owned.supervisor, supervisor));
  owned.supervisor = supervisor;
  await recordOwnership();
  // Preserve the initial provider/shell ownership before replacing the shell
  // with the controlled subject, including failure before its ready receipt.
  await recordInitialExecutionIdentities();
  const subject = { id: node.id, role, supervisor, binding: Object.fromEntries(
    ['runtimeBackend', 'runtimeStoragePath', 'runtimeSessionId'].map(key => [key, metadata[key]])),
    receiptPath: path.join(artifacts, `subject-${role}.json`) };
  await command('dispatchWebviewMessage', { type: 'webview/resizeNode', payload: {
    nodeId: node.id, position: node.position, size: { width: 900, height: 540 } } }, surface);
  subject.reader = await mountedReader(subject.id);
  if (currentStateAcceptance) assertCurrentStateReader(subject.reader, `${role} initial reader`);
  const fixture = path.join(__dirname, 'fixtures', role === 'a'
    ? 'execution-capacity-subject.cjs' : 'runtime-reload-completed-subject.cjs');
  const args = role === 'a' ? ` b color ${quote(subject.receiptPath)}` : ` ${quote(subject.receiptPath)}`;
  await dom({ kind: 'sendExecutionInput', nodeId: node.id,
    data: `stty -echo -onlcr; exec ${quote(process.env.DEV_SESSION_CANVAS_RELOAD_SUBJECT_NODE)} ${quote(fixture)}${args}\r` });
  await captureProviderAndSubject(subject);
  await archive(`started-${role}`, subject);
  return subject;
}

async function mountedReader(id) {
  const value = await poll('actual mounted terminal and reader', async () => ({
    probe: await probe(), messages: await command('getHostMessages')
  }), entry => entry.probe.nodes.some(node => node.nodeId === id && node.terminalCols >= 78 && node.terminalRows >= 3) &&
    entry.messages.some(message => message.type === 'host/executionSnapshot' && message.payload.nodeId === id && message.payload.terminalRead));
  return value.messages.findLast(message => message.type === 'host/executionSnapshot' &&
    message.payload.nodeId === id && message.payload.terminalRead).payload.terminalRead;
}

function assertCurrentStateReader(reader, label) {
  assert.equal(reader?.currentState?.format, 'xterm-current-state-v1', `${label} must negotiate current state.`);
  assert(Number.isSafeInteger(reader.currentState.length) && reader.currentState.length > 0,
    `${label} must declare a non-empty current state.`);
  assert.equal(reader.checkpoint.serializedState.data, '', `${label} must not carry an ANSI history checkpoint.`);
}

async function completed(subject) {
  const state = await poll('natural completed no-history', snapshot, value => {
    const node = getNode(value, subject.id);
    return node?.status === 'closed' && node.metadata?.terminal?.terminalHistoryDiscarded === true;
  });
  const node = getNode(state, subject.id);
  assertRuntimeDiscarded(node);
  const events = await poll('same reader applied final output', () => command('getDiagnosticEvents'), value =>
    value.some(event => event.kind === 'runtime/terminalReadSettled' && event.detail?.nodeId === subject.id &&
      event.detail.sessionId === subject.binding.runtimeSessionId && event.detail.readId === subject.reader.readId &&
      event.detail.outcome?.kind === 'applied'));
  await poll('completed binding removed', () => command('getRuntimeSupervisorState'), value =>
    !value.bindings.some(binding => binding.nodeId === subject.id));
  await poll('original subject and provider exited', async () => Promise.all(
    [subject.identity, subject.provider].map(async expected => exitedIdentity(expected, await readIdentity(expected.pid)))),
  value => value.every(Boolean));
  const saved = await command('flushPersistedState');
  assert.equal(saved.lastError, undefined);
  assert(saved.exists);
  assertRuntimeDiscarded(getNode(saved.snapshot, subject.id));
  return { node, events, savedNode: getNode(saved.snapshot, subject.id) };
}

async function interaction(id, nonce) {
  await dom({ kind: 'measureCapacityInteraction', nodeId: id, loadNodeId: id, nonce });
  const result = (await probe()).capacityCalibration?.interaction;
  assert.equal(result?.nonce, nonce);
  assert.equal(result.applied, true, 'Actual terminal must parse the matching new nonce response.');
  return result;
}

async function setup(launcher) {
  const a = await createSubject('a');
  await interaction(a.id, `before_${control.nonce}`);
  if (currentStateAcceptance) {
    await dom({ kind: 'sendExecutionInput', nodeId: a.id,
      data: 'current-state-marker\r' });
    await poll('current-state marker before reload', () => probe(), value =>
      value.nodes.some(node => node.nodeId === a.id &&
        node.terminalVisibleLines.some(line => line.includes('DSC_RELOAD_CURRENT_STATE_MARKER'))));
  }
  const b = await createSubject('b');
  await dom({ kind: 'sendExecutionInput', nodeId: b.id, data: 'finish\r' });
  const bCompleted = await completed(b);
  await dom({ kind: 'assertExecutionTerminalBuffer', nodeId: b.id, linePrefix: 'DSC_A6_', expectedLines: [completedMarker] });
  const state = await snapshot();
  const runtime = await command('getRuntimeSupervisorState');
  assert.equal(runtime.bindings.length, 1);
  assert.equal(runtime.bindings[0].runtimeSessionId, a.binding.runtimeSessionId);
  const saved = await command('flushPersistedState');
  assert(saved.exists && saved.snapshot?.state);
  assert.equal(saved.lastError, undefined);
  assertRuntimeDiscarded(getNode(saved.snapshot, b.id));
  for (const [key, value] of Object.entries(a.binding)) assert.equal(getNode(saved.snapshot, a.id).metadata.terminal[key], value);
  const result = { nonce: control.nonce, pass: true, ui: await live(launcher.ui), host: await readIdentity(process.pid),
    a, b, bCompleted, runtime, persisted: true, frameId: state.surfaceLifecycle[surface].frameId };
  await archive('setup', result);
  control = { ...control, phase: 'verify', reloadRequests: 1, setup: result };
  await atomic(controlPath, control);
}

async function verify(launcher) {
  const setup = control.setup;
  const oldHostAtVerify = await poll('original Host exited', () => readIdentity(setup.host.pid), value => exitedIdentity(setup.host, value));
  const a = { ...setup.a, reader: await mountedReader(setup.a.id) };
  if (currentStateAcceptance) {
    assertCurrentStateReader(a.reader, 'reloaded reader');
    await poll('reloaded current-state descriptor diagnostic', () => command('getDiagnosticEvents'), events =>
      events.some(event => event.kind === 'runtime/terminalPagedReadOpened' && event.detail?.nodeId === a.id &&
        event.detail?.currentState === 'xterm-current-state-v1' &&
        Number.isSafeInteger(event.detail?.stateLength) && event.detail.stateLength > 0));
    await poll('reloaded current-state first chunk', () => command('getHostMessages'), messages =>
      messages.some(message => message.type === 'host/executionTerminalPage' && message.payload.nodeId === a.id &&
        message.payload.page?.stateChunk?.offset === 0));
    await poll('reloaded current-state marker', () => probe(), value =>
      value.nodes.some(node => node.nodeId === a.id &&
        node.terminalVisibleLines.some(line => line.includes('DSC_RELOAD_CURRENT_STATE_MARKER'))));
  }
  for (const role of ['supervisor', 'provider', 'identity']) a[role] = { ...setup.a[role], ...await live(setup.a[role]) };
  const hello = await rpc(a.supervisor.socketPath, 'hello');
  assert.equal(hello.pid, a.supervisor.pid);
  const state = await snapshot();
  const runtime = await command('getRuntimeSupervisorState');
  const binding = runtime.bindings.find(value => value.nodeId === a.id);
  assert(binding);
  for (const [key, value] of Object.entries(a.binding)) {
    assert.equal(binding[key], value);
    assert.equal(getNode(state, a.id).metadata.terminal[key], value);
  }
  assert.equal(runtime.bindings.length, 1);
  assert.equal(a.reader.sessionId, a.binding.runtimeSessionId);
  assert.equal(a.reader.authorityId, setup.a.reader.authorityId);
  assert.notEqual(a.reader.readId, setup.a.reader.readId);
  assert.notEqual(state.surfaceLifecycle[surface].frameId, setup.frameId);
  const completedNode = getNode(state, setup.b.id);
  assertRuntimeDiscarded(completedNode);
  for (const expected of [setup.b.identity, setup.b.provider]) {
    assert(exitedIdentity(expected, await readIdentity(expected.pid)), 'Completed B must remain exited.');
  }
  await command('dispatchWebviewMessage', { type: 'webview/attachExecutionSession',
    payload: { kind: 'terminal', nodeId: setup.b.id } }, surface);
  await poll('completed attach empty snapshot', () => command('getHostMessages'), messages => messages.some(message =>
    message.type === 'host/executionSnapshot' && message.payload.nodeId === setup.b.id && message.payload.liveSession === false &&
    message.payload.output === '' && !message.payload.terminalRead && !message.payload.terminalStream && !message.payload.serializedTerminalState));
  await dom({ kind: 'assertExecutionTerminalBuffer', nodeId: setup.b.id, expectedLines: [] });
  const restartedExecutionEvents = (await command('getDiagnosticEvents')).filter(event =>
    ['execution/startRequested', 'execution/started'].includes(event.kind) && event.detail?.nodeId === setup.b.id);
  assert.deepEqual(restartedExecutionEvents, [], 'Reload must not restart completed B.');
  const response = await interaction(a.id, control.nonce);
  await dom({ kind: 'sendExecutionInput', nodeId: a.id, data: 'finish\r' });
  const finished = await completed(a);
  await archive('verify', { nonce: control.nonce, pass: true, reloadRequests: 1,
    ui: await live(launcher.ui), host: await readIdentity(process.pid), oldHostAtVerify: oldHostAtVerify ?? null,
    a, frameId: state.surfaceLifecycle[surface].frameId, interaction: response,
    completedNodeId: setup.b.id, completedNode, completedAttachEmpty: true,
    restartedExecutionEvents, aCompletedApplied: true, finishedNode: finished.node, finished });
}

async function snapshotProviders(providerPath) {
  const children = (await fs.readFile(`/proc/${process.pid}/task/${process.pid}/children`, 'utf8'))
    .trim().split(/\s+/).filter(Boolean).map(Number);
  const providers = [];
  for (const pid of children) {
    const argv = (await fs.readFile(`/proc/${pid}/cmdline`, 'utf8')).split('\0');
    if (argv.includes(providerPath)) providers.push(await readIdentity(pid));
  }
  return providers;
}

async function snapshotProcessIdentities(providerPath) {
  const providers = await snapshotProviders(providerPath);
  assert.equal(providers.length, 1, 'The single snapshot Terminal must have one direct Host-owned provider.');
  const provider = providers[0];
  assert.equal(provider.ppid, process.pid);
  const subjects = (await fs.readFile(`/proc/${provider.pid}/task/${provider.pid}/children`, 'utf8'))
    .trim().split(/\s+/).filter(Boolean).map(Number);
  assert.equal(subjects.length, 1, 'The controlled exec subject must be the original PTY child.');
  const identity = await readIdentity(subjects[0]);
  assert(identity && identity.ppid === provider.pid);
  owned.resources = [provider, identity];
  await recordOwnership();
  return { provider, identity };
}

async function setupSnapshot(launcher, installedVsix) {
  assert.equal(vscode.workspace.getConfiguration('devSessionCanvas.runtimePersistence').get('enabled'), false);
  owned.host = await readIdentity(process.pid);
  owned.expectedSubjects.push('snapshot');
  await recordOwnership();
  await command('createNode', 'terminal');
  const state = await poll('snapshot-only Terminal started', snapshot, value => value.state.nodes.some(node =>
    node.kind === 'terminal' && node.metadata?.terminal?.liveSession));
  const nodes = state.state.nodes.filter(node => node.kind === 'terminal');
  assert.equal(nodes.length, 1);
  const node = nodes[0];
  assert.equal(node.metadata.terminal.persistenceMode, 'snapshot-only');
  assert.equal(node.metadata.terminal.runtimeSessionId, undefined);
  await command('dispatchWebviewMessage', { type: 'webview/resizeNode', payload: {
    nodeId: node.id, position: node.position, size: { width: 900, height: 540 } } }, surface);
  const mounted = await poll('snapshot-only mounted execution identity', async () => ({
    page: (await probe()).nodes.find(entry => entry.nodeId === node.id), messages: await command('getHostMessages')
  }), value => value.page?.terminalCols >= 64 && value.page.terminalRows >= 5 && value.messages.some(message =>
    message.type === 'host/executionSnapshot' && message.payload.nodeId === node.id && message.payload.executionSessionId));
  const initial = mounted.messages.findLast(message => message.type === 'host/executionSnapshot' && message.payload.nodeId === node.id);
  const providerPath = path.join(installedVsix.extensionPath, 'dist/linux-execution-provider.js');
  const beforeExec = await snapshotProcessIdentities(providerPath);
  const subjectPath = path.join(__dirname, 'fixtures/linux-lifecycle-subject.mjs');
  const auditPrefix = path.join(artifacts, 'snapshot-subject');
  await dom({ kind: 'sendExecutionInput', nodeId: node.id,
    data: `stty -echo -onlcr; exec ${quote(process.env.DEV_SESSION_CANVAS_RELOAD_SUBJECT_NODE)} ${quote(subjectPath)} ${quote(auditPrefix)}\r` });
  const ready = await poll('original lifecycle subject ready', async () => {
    try { return await fs.readFile(`${auditPrefix}-written.bin`, 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') return ''; throw error; }
  }, text => /^READY:\d+x\d+\n$/.test(text));
  const dimensions = /^READY:(\d+)x(\d+)\n$/.exec(ready);
  const initialCols = Number(dimensions[1]), initialRows = Number(dimensions[2]);
  assert(initialCols >= 64 && initialRows >= 5);
  // Resize after the PTY subject exists; startup geometry can race the first Webview resize.
  const beforeResize = (await probe()).nodes.find(entry => entry.nodeId === node.id);
  await command('dispatchWebviewMessage', { type: 'webview/resizeNode', payload: {
    nodeId: node.id, position: node.position,
    size: { width: node.size.width + 20, height: node.size.height + 20 }
  } }, surface);
  await poll('post-start terminal resize applied', async () =>
    (await probe()).nodes.find(entry => entry.nodeId === node.id),
  value => value && (value.terminalCols !== beforeResize?.terminalCols || value.terminalRows !== beforeResize?.terminalRows));
  const processes = await snapshotProcessIdentities(providerPath);
  assert(sameLiveIdentity(beforeExec.provider, processes.provider));
  assert.equal(processes.identity.pid, beforeExec.identity.pid);
  assert.equal(processes.identity.startTicks, beforeExec.identity.startTicks);
  assert.equal(processes.identity.executable, process.env.DEV_SESSION_CANVAS_RELOAD_SUBJECT_NODE);
  const argv = (await fs.readFile(`/proc/${processes.identity.pid}/cmdline`, 'utf8')).split('\0');
  assert(argv.includes(subjectPath) && argv.includes(auditPrefix));
  owned.readySubjects.push('snapshot');
  await recordOwnership();
  const subjectNonce = control.nonce.replaceAll('-', '');
  const expectedHash = hash(subjectNonce);
  await dom({ kind: 'sendExecutionInput', nodeId: node.id, data: `nonce:${subjectNonce}\n` });
  await poll('subject nonce response applied', async () => fs.readFile(`${auditPrefix}-written.bin`, 'utf8'),
    written => written === `${ready}HASH:${expectedHash}\n`);
  await dom({ kind: 'sendExecutionInput', nodeId: node.id, data: 'size\n' });
  const confirmed = await poll('ready nonce and dimensions actually applied', async () => {
    const page = (await probe()).nodes.find(entry => entry.nodeId === node.id);
    const written = await fs.readFile(`${auditPrefix}-written.bin`, 'utf8');
    return { page, handshake: readSnapshotHandshake(written, ready, subjectNonce, page) };
  }, value => value.handshake &&
    value.page.terminalVisibleLines.join('').includes(`HASH:${expectedHash}`) &&
    value.page.terminalVisibleLines.join('').includes(`SIZE:${value.handshake.cols}x${value.handshake.rows}`));
  const { cols, rows, expectedPrefix } = confirmed.handshake;
  const saved = await command('flushPersistedState');
  assert(saved.exists && !saved.lastError);
  assert.equal(getNode(saved.snapshot, node.id).metadata.terminal.liveSession, true);
  const userData = path.resolve(artifacts, '..', 'user-data');
  const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
  const rootFile = path.join(userData, 'User/globalStorage/devsessioncanvas.dev-session-canvas/root-local-canvas',
    hash(path.resolve(root)).slice(0, 24), 'canvas-state.json');
  for (const file of [saved.snapshotPath, rootFile]) {
    const relative = path.relative(userData, file);
    assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
    assert.equal(getNode(JSON.parse(await fs.readFile(file, 'utf8')), node.id).metadata.terminal.liveSession, true);
  }
  const current = await snapshot();
  const result = { nonce: control.nonce, mode: 'snapshot-only', pass: true, ui: await live(launcher.ui),
    host: owned.host, a: { id: node.id, ...processes, executionId: initial.payload.executionSessionId,
      initialReady: ready, initialCols, initialRows, cols, rows, auditPrefix, expectedPrefix, providerPath },
    diskPaths: [saved.snapshotPath, rootFile],
    frameId: current.surfaceLifecycle[surface].frameId };
  await live(processes.provider);
  await live(processes.identity);
  await archive('setup', result);
  control = { ...control, phase: 'verify', reloadRequests: 1, setup: result };
  await atomic(controlPath, control);
}

async function verifySnapshot(launcher) {
  const setup = control.setup;
  assert(originalDisk?.length === 2);
  assert.deepEqual(originalDisk[0].node.metadata.terminal, originalDisk[1].node.metadata.terminal);
  const metadata = assertSnapshotNode(originalDisk[0].node);
  const written = await fs.readFile(`${setup.a.auditPrefix}-written.bin`);
  assert.equal(written.toString('utf8'), setup.a.expectedPrefix + snapshotTail);
  const subjectSignal = JSON.parse(await fs.readFile(`${setup.a.auditPrefix}-signal.json`, 'utf8'));
  const subjectCompleted = JSON.parse(await fs.readFile(`${setup.a.auditPrefix}-complete.json`, 'utf8'));
  assert.deepEqual(subjectSignal, { signal: 'SIGHUP' });
  assert.deepEqual(subjectCompleted, { exitCode: 7, writtenComplete: true });
  assert.equal(metadata.lastCols, setup.a.cols);
  assert.equal(metadata.lastRows, setup.a.rows);
  const replay = await replaySnapshotTail(written, metadata);
  await poll('old local execution resources exited', async () => Promise.all(owned.resources.map(async expected =>
    exitedIdentity(expected, await readIdentity(expected.pid)))), values => values.every(Boolean));
  const resourceChecks = await Promise.all([setup.a.provider, setup.a.identity].map(async expected =>
    ({ expected, after: await readIdentity(expected.pid) ?? null })));
  assert(resourceChecks.every(entry => exitedIdentity(entry.expected, entry.after)));
  const state = await snapshot();
  const node = getNode(state, setup.a.id);
  assertSnapshotNode(node);
  assert.deepEqual(node.metadata.terminal.serializedTerminalState, metadata.serializedTerminalState);
  await command('dispatchWebviewMessage', { type: 'webview/attachExecutionSession',
    payload: { kind: 'terminal', nodeId: setup.a.id } }, surface);
  const page = await poll('restored snapshot full content and cursor', async () => {
    try { await dom({ kind: 'assertExecutionTerminalBuffer', nodeId: node.id, expectedLines: replay.lines.filter(Boolean) }); }
    catch (error) {
      if (/Execution terminal .* (has|differs|is not mounted)/.test(String(error))) return undefined;
      throw error;
    }
    return (await probe()).nodes.find(entry => entry.nodeId === node.id);
  }, value => value?.terminalCols === replay.cols && value.terminalRows === replay.rows &&
    value.terminalCursorX === replay.cursorX && value.terminalCursorY === replay.cursorY &&
    value.terminalViewportY === replay.viewportY && value.terminalBufferType === replay.bufferType &&
    JSON.stringify(value.terminalVisibleLines) === JSON.stringify(replay.visibleLines));
  const restartedExecutionEvents = (await command('getDiagnosticEvents')).filter(event =>
    ['execution/startRequested', 'execution/started'].includes(event.kind) && event.detail?.nodeId === node.id);
  assert.deepEqual(restartedExecutionEvents, []);
  const replacementProviders = await snapshotProviders(setup.a.providerPath);
  assert.deepEqual(replacementProviders, [], 'Restoring the closed snapshot must not create a local provider.');
  const runtime = await command('getRuntimeSupervisorState');
  assert.equal(runtime.bindings.length, 0);
  assert.equal(runtime.pendingRuntimeSupervisorOperationCount, 0);
  await archive('verify', { nonce: control.nonce, mode: 'snapshot-only', pass: true, reloadRequests: 1,
    ui: await live(launcher.ui), host: await readIdentity(process.pid), oldHostAtVerify: await readIdentity(setup.host.pid) ?? null,
    node, disk: originalDisk, diskReadBeforeDriverProductCalls: true, productActivationAtDiskRead,
    oldHostExclusiveDiskWriteClaim: false, subjectSignal, subjectCompleted,
    writtenMatches: true, writtenSha256: hash(written), replayMatches: true, replay,
    page: { applied: true, cursorX: page.terminalCursorX, cursorY: page.terminalCursorY, visibleLines: page.terminalVisibleLines },
    frameId: state.surfaceLifecycle[surface].frameId, resourcesExited: true, resourceChecks, runtime,
    restartedExecutionEvents, replacementProviders,
    oldReaderOutcome: 'not-observed', sourceEofClaim: false });
}

async function cleanup() {
  let timer;
  try {
    await Promise.race([command('resetState'), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Product cleanup exceeded 15 seconds.')), 15000);
    })]);
  } finally { clearTimeout(timer); }
  const runtime = await command('getRuntimeSupervisorState');
  assert.equal(runtime.bindings.length, 0);
  assert.equal(runtime.pendingRuntimeSupervisorOperationCount, 0);
  const nodesRemaining = (await snapshot()).state.nodes.filter(node => ['terminal', 'agent'].includes(node.kind)).length;
  assert.equal(nodesRemaining, 0);
  const deadline = Math.min(Date.now() + 5000, control.deadlineAt - 10000);
  let resourcesExited = false;
  do {
    resourcesExited = (await Promise.all(owned.resources.map(async expected => exitedIdentity(expected, await readIdentity(expected.pid))))).every(Boolean);
    if (resourcesExited) break;
    await sleep(50);
  } while (Date.now() < deadline);
  assert(resourcesExited, 'Product reset must release original owned execution resources without fallback.');
  assert.deepEqual(owned.readySubjects, owned.expectedSubjects,
    'Incomplete subject identity acquisition leaves resource release unknown, not successful.');
  let supervisorExit = 'not-started';
  if (owned.supervisor) {
    await live(owned.supervisor);
    assert.equal((await rpc(owned.supervisor.socketPath, 'hello')).pid, owned.supervisor.pid);
    await live(owned.supervisor);
    process.kill(owned.supervisor.pid, 'SIGTERM');
    supervisorExit = 'owned-isolated-idle-supervisor-SIGTERM';
    const stopDeadline = Math.min(Date.now() + 5000, control.deadlineAt - 5000);
    while (!exitedIdentity(owned.supervisor, await readIdentity(owned.supervisor.pid))) {
      assert(Date.now() < stopDeadline, 'Owned idle Supervisor did not exit.');
      await sleep(50);
    }
  }
  await archive('cleanup', { nonce: control.nonce, pass: true, runtime, nodesRemaining, resourcesExited, supervisorExit });
}

function rpc(socketPath, method) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let data = '';
    const finish = (error, value) => { clearTimeout(timer); socket.destroy(); error ? reject(error) : resolve(value); };
    const timer = setTimeout(() => finish(new Error(`Bound Supervisor ${method} timed out.`)), 3000);
    socket.once('error', finish);
    socket.once('connect', () => socket.write(`${JSON.stringify({ type: 'request', id: 'a6-reload', method })}\n`));
    socket.on('data', chunk => {
      data += chunk.toString();
      if (data.length > 65536) return finish(new Error('Unexpected hello response size.'));
      const end = data.indexOf('\n');
      if (end < 0) return;
      try {
        const response = JSON.parse(data.slice(0, end));
        assert(response.ok && response.id === 'a6-reload', JSON.stringify(response.error));
        finish(undefined, response.result);
      } catch (error) { finish(error); }
    });
  });
}
