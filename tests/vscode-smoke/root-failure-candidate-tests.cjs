const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const vscode = require('vscode');
const { activateVisibleExtension, waitForCommand } = require('./test-helpers.cjs');
const { captureInstalledExtensionReceipt } = require('./installed-execution-candidate.cjs');
const { readIdentity, sameLiveIdentity, exitedIdentity, completedMarker } = require('./runtime-reload-contract.cjs');
const { resolveLegacyRuntimeSupervisorPaths, resolveSystemdUserRuntimeSupervisorPaths } = require('./root-failure-runtime-paths.cjs');
const { hash, bindingKeys, rootSnapshotPath, createObstacle, checkObstacle, removeObstacle,
  assertCaseReport, assertCleanupReport } = require('./root-failure-contract.cjs');

const surface = 'panel';
const artifacts = process.env.DEV_SESSION_CANVAS_SMOKE_ARTIFACT_DIR;
const command = (name, ...args) => vscode.commands.executeCommand(`devSessionCanvas.__test.${name}`, ...args);
const snapshot = () => command('getDebugState');
const probe = () => command('captureWebviewProbe', surface, 3000);
const dom = action => command('performWebviewDomAction', action, surface, 5000);
const dispatch = (type, payload) => command('dispatchWebviewMessage', { type, payload }, surface);
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const archive = (name, value) => fs.writeFile(path.join(artifacts, `${name}.json`), `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
let control, obstacle, files;
const owned = { resources: [], expectedSubjects: [], readySubjects: [] };

exports.run = async () => {
  let failure;
  try {
    control = JSON.parse(await fs.readFile(process.env.DEV_SESSION_CANVAS_ROOT_FAILURE_CONTROL, 'utf8'));
    assert.equal(control.schemaVersion, 1);
    assert.equal(process.platform, 'linux');
    assert.equal(process.arch, 'x64');
    assert.equal(vscode.version, '1.117.0');
    assert.equal(process.versions.electron, '39.8.7');
    assert.equal(process.versions.node, '22.22.1');
    assert.equal(process.versions.modules, '140');
    assert.deepEqual(vscode.workspace.workspaceFolders.map(folder => folder.uri.fsPath), [control.roots.a, control.roots.b]);
    const extension = await activateVisibleExtension(vscode, 'devsessioncanvas.dev-session-canvas');
    const installedVsix = await captureInstalledExtensionReceipt(extension, process.env.DEV_SESSION_CANVAS_INSTALLED_VSIX_EXPECTATION);
    await archive('environment', { versions: process.versions, host: await readIdentity(process.pid), vscode: vscode.version, installedVsix });
    await waitForCommand(vscode, 'devSessionCanvas.__test.getDebugState');
    await command('resetState');
    await vscode.commands.executeCommand('devSessionCanvas.openCanvasInPanel');
    await command('waitForCanvasReady', surface, 20000);
    await dom({ kind: 'configureCapacityCalibration', nodeId: 'root-failure', enabled: true });
    const a = await createSubject('a');
    const b = await createSubject('b');
    await vscode.commands.executeCommand('devSessionCanvas.__internal.focusNode', b.id);
    await interact(b, `before_${control.nonce}`);
    // Let the existing 160ms session sync / 1500ms deferred save finish before freezing the first-failure files.
    await sleep(2000);
    const baselineFlush = await command('flushPersistedState');
    assert(baselineFlush.exists && !baselineFlush.lastError);
    assertContained(control.userDataDir, baselineFlush.snapshotPath);
    files = { a: rootSnapshotPath(control.userDataDir, a.rootPath),
      b: rootSnapshotPath(control.userDataDir, b.rootPath), workspace: baselineFlush.snapshotPath };
    const baseline = await readOnlyState();
    for (const subject of [a, b]) {
      const saved = baseline.files[subject.role].snapshot.state.nodes.find(node =>
        node.metadata?.terminal?.runtimeSessionId === subject.binding.runtimeSessionId);
      assert(saved, 'The original root-local live binding must be saved before the failure.');
    }
    await archive('baseline', baseline);
    await command('clearDiagnosticEvents');
    await command('clearHostMessages');
    obstacle = await createObstacle(files.a);
    await archive('obstacle', obstacle);
    await dom({ kind: 'sendExecutionInput', nodeId: a.id, data: 'finish\r' });
    await poll('root A real completion save failure', () => command('getDiagnosticEvents'), events =>
      events.some(event => event.kind === 'state/rootLocalPersistFailed' && event.detail?.rootPath === a.rootPath &&
        /EISDIR|illegal operation on a directory/i.test(event.detail.message)) &&
      events.some(event => ['runtime/hostOutputConsumptionFailed', 'runtime/sessionStateHandlerFailed'].includes(event.kind) &&
        event.detail?.sessionId === a.binding.runtimeSessionId && /EISDIR|illegal operation on a directory/i.test(event.detail.message)));
    // Freeze read-only failure facts before B legitimately produces new output and persistence.
    const failed = await readOnlyState();
    await archive('expected-first-failure', failed);
    // Snapshot RPC can flush the Supervisor journal; it is not part of the read-only first observation.
    failed.aSession = await rpc(owned.paths.socketPath, 'getSessionSnapshot', { sessionId: a.binding.runtimeSessionId });
    await archive('retained-a-session', failed.aSession);
    const events = await poll('original A reader applied its own final tail', () => command('getDiagnosticEvents'), entries =>
      entries.some(event => event.kind === 'runtime/terminalReadSettled' && event.detail?.nodeId === a.id &&
        event.detail.sessionId === a.binding.runtimeSessionId && event.detail.readId === a.reader.readId &&
        event.detail.outcome?.kind === 'applied'));
    await dom({ kind: 'assertExecutionTerminalBuffer', nodeId: a.id, linePrefix: 'DSC_A6_', expectedLines: [completedMarker] });
    const aFinal = { receipt: JSON.parse(await fs.readFile(a.receiptPath, 'utf8')), fullMarkerVerified: true,
      settlement: events.find(event => event.kind === 'runtime/terminalReadSettled' && event.detail?.nodeId === a.id &&
        event.detail.readId === a.reader.readId && event.detail.outcome?.kind === 'applied').detail,
      subjectAfter: await poll('original A subject exited', () => readIdentity(a.identity.pid), value => exitedIdentity(a.identity, value)) ?? null };
    const interaction = await interact(b, control.nonce);
    const afterInteraction = await readOnlyState();
    Object.assign(afterInteraction, { interaction, obstacle: await checkObstacle(obstacle),
      subject: await readIdentity(b.identity.pid), provider: await readIdentity(b.provider.pid),
      supervisor: await readIdentity(b.supervisor.pid),
      bSession: await rpc(owned.paths.socketPath, 'getSessionSnapshot', { sessionId: b.binding.runtimeSessionId }),
      newStartEvents: afterInteraction.events.filter(event => ['execution/startRequested', 'execution/started'].includes(event.kind) &&
        [a.id, b.id].includes(event.detail?.nodeId)) });
    const report = { schemaVersion: 1, mode: 'live-runtime', nonce: control.nonce,
      a, b, baseline, obstacle, failed, aFinal, afterInteraction };
    assertCaseReport(report, control);
    await archive('case', report);
  } catch (error) {
    failure = error;
    await archive('first-failure', { error: String(error), stack: error.stack });
    try { await archive('failure-read-only', await readOnlyState()); }
    catch (captureError) { await archive('failure-capture-error', { error: String(captureError) }); }
  } finally {
    try { await cleanup(); }
    catch (error) {
      failure ??= error;
      const ownershipComplete = owned.expectedSubjects.length === 2 &&
        JSON.stringify(owned.readySubjects) === JSON.stringify(owned.expectedSubjects);
      await archive('cleanup-failure', { error: String(error), stack: error.stack,
        ownershipComplete, resourceRelease: ownershipComplete ? 'unconfirmed' : 'unknown',
        expectedSubjects: owned.expectedSubjects, readySubjects: owned.readySubjects });
    }
    await archive('driver-finished', { pass: !failure, nonce: control?.nonce });
  }
  if (failure) throw failure;
};

async function readOnlyState() {
  const result = { state: await snapshot(), events: await command('getDiagnosticEvents'),
    messages: await command('getHostMessages'), runtime: await command('getRuntimeSupervisorState'), files: {} };
  for (const [key, file] of Object.entries(files ?? {})) {
    const bytes = await fs.readFile(file);
    result.files[key] = { path: file, bytes: bytes.length, sha256: hash(bytes), snapshot: JSON.parse(bytes) };
  }
  return result;
}

async function poll(label, read, accept, timeoutMs = 15000) {
  const deadline = Math.min(Date.now() + timeoutMs, control.deadlineAt - 30000);
  while (Date.now() < deadline) {
    const value = await read();
    if (accept(value) && Date.now() < deadline) return value;
    await sleep(50);
  }
  throw new Error(`Timed out: ${label}`);
}

function assertContained(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  assert(relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

async function recordOwnership() {
  const file = path.join(artifacts, 'ownership.json');
  await fs.writeFile(`${file}.next`, `${JSON.stringify(owned, null, 2)}\n`);
  await fs.rename(`${file}.next`, file);
}

function own(identity) {
  assert(identity && identity.executable && identity.startTicks);
  owned.resources = owned.resources.filter(entry => entry.pid !== identity.pid || entry.startTicks !== identity.startTicks);
  owned.resources.push(identity);
}

async function captureInitialResources() {
  assert(sameLiveIdentity(owned.supervisor, await readIdentity(owned.supervisor.pid)));
  const children = (await fs.readFile(`/proc/${owned.supervisor.pid}/task/${owned.supervisor.pid}/children`, 'utf8')).trim().split(/\s+/).filter(Boolean).map(Number);
  for (const pid of children) {
    const args = (await fs.readFile(`/proc/${pid}/cmdline`, 'utf8')).split('\0');
    if (!args.some(arg => arg.endsWith('/dist/linux-execution-provider.js'))) continue;
    const provider = await readIdentity(pid);
    assert(provider.ppid === owned.supervisor.pid);
    own(provider);
    const shells = (await fs.readFile(`/proc/${pid}/task/${pid}/children`, 'utf8')).trim().split(/\s+/).filter(Boolean).map(Number);
    for (const shell of shells) own(await readIdentity(shell));
  }
  await recordOwnership();
}

async function createSubject(role) {
  owned.expectedSubjects.push(role);
  await recordOwnership();
  const rootPath = control.roots[role];
  const before = await snapshot();
  const group = before.state.groups.find(entry => entry.role === 'workspace-root' && entry.workspaceRootPath === rootPath);
  assert(group, 'The actual composed view must expose the requested root group.');
  const ids = new Set(before.state.nodes.map(node => node.id));
  await dispatch('webview/createDemoNode', { kind: 'terminal', targetGroupId: group.id,
    preferredPosition: { x: group.position.x + 40, y: group.position.y + 40 } });
  const created = await poll(`${role} real Terminal live`, snapshot, value => value.state.nodes.some(node =>
    !ids.has(node.id) && node.kind === 'terminal' && node.metadata?.terminal?.liveSession));
  const node = created.state.nodes.find(entry => !ids.has(entry.id) && entry.kind === 'terminal');
  assert.equal(node.groupId, group.id);
  const metadata = node.metadata.terminal;
  assert.equal(metadata.persistenceMode, 'live-runtime');
  assert.equal(metadata.cwd, rootPath);
  assert.match(metadata.runtimeStoragePath, /terminal-exit-v1/);
  assertContained(control.userDataDir, metadata.runtimeStoragePath);
  const paths = metadata.runtimeBackend === 'systemd-user'
    ? resolveSystemdUserRuntimeSupervisorPaths(metadata.runtimeStoragePath)
    : resolveLegacyRuntimeSupervisorPaths(metadata.runtimeStoragePath);
  const hello = await rpc(paths.socketPath, 'hello');
  assert(hello.capabilities?.executionCandidateProfiles?.includes('linux-owner-v1-candidate'));
  const supervisor = await readIdentity(hello.pid);
  assert(supervisor?.executable && supervisor.startTicks);
  if (owned.supervisor) assert(sameLiveIdentity(owned.supervisor, supervisor));
  owned.supervisor = supervisor;
  owned.paths = paths;
  await captureInitialResources();
  await dispatch('webview/resizeNode', { nodeId: node.id, position: node.position, size: { width: 900, height: 540 } });
  const mounted = await poll(`${role} actual terminal reader`, async () => ({ layout: await probe(), messages: await command('getHostMessages') }),
    value => value.layout.nodes.some(entry => entry.nodeId === node.id && entry.terminalCols >= 78 && entry.terminalRows >= 3) &&
      value.messages.some(message => message.type === 'host/executionSnapshot' && message.payload.nodeId === node.id && message.payload.terminalRead));
  const reader = mounted.messages.findLast(message => message.type === 'host/executionSnapshot' &&
    message.payload.nodeId === node.id && message.payload.terminalRead).payload.terminalRead;
  const receiptPath = path.join(artifacts, `subject-${role}.json`);
  const fixture = path.join(__dirname, 'fixtures', role === 'a' ? 'runtime-reload-completed-subject.cjs' : 'execution-capacity-subject.cjs');
  const args = role === 'a' ? quote(receiptPath) : `b color ${quote(receiptPath)}`;
  await dom({ kind: 'sendExecutionInput', nodeId: node.id,
    data: `stty -echo -onlcr; exec ${quote(control.subjectExecutable)} ${quote(fixture)} ${args}\r` });
  const receipt = await poll(`${role} original subject ready`, async () => {
    try { return JSON.parse(await fs.readFile(receiptPath, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
  }, value => value?.state === 'ready');
  const identity = await readIdentity(receipt.pid);
  assert.equal(identity?.executable, control.subjectExecutable);
  let ancestor = identity, provider;
  for (let depth = 0; ancestor && ancestor.pid !== supervisor.pid && depth < 8; depth++) {
    const args = (await fs.readFile(`/proc/${ancestor.pid}/cmdline`, 'utf8')).split('\0');
    if (args.some(arg => arg.endsWith('/dist/linux-execution-provider.js'))) provider = ancestor;
    ancestor = ancestor.ppid > 1 ? await readIdentity(ancestor.ppid) : undefined;
  }
  assert(provider && sameLiveIdentity(supervisor, ancestor));
  own(identity); own(provider);
  owned.readySubjects.push(role);
  await recordOwnership();
  const subject = { role, id: node.id, groupId: group.id, rootPath, supervisor, provider, identity, reader, receiptPath,
    binding: Object.fromEntries(bindingKeys.map(key => [key, metadata[key]])) };
  await archive(`started-${role}`, subject);
  return subject;
}

async function interact(subject, nonce) {
  await dom({ kind: 'measureCapacityInteraction', nodeId: subject.id, loadNodeId: subject.id, nonce });
  const result = (await probe()).capacityCalibration?.interaction;
  assert.equal(result?.nonce, nonce);
  assert.equal(result.applied, true);
  return result;
}

async function cleanup() {
  const obstacleResult = obstacle ? await removeObstacle(obstacle) : { notCreated: true };
  let timer;
  try {
    await Promise.race([command('resetState'), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Product reset exceeded 15 seconds.')), 15000);
    })]);
  } finally { clearTimeout(timer); }
  const runtime = await command('getRuntimeSupervisorState');
  assert.equal(runtime.bindings.length, 0);
  assert.equal(runtime.pendingRuntimeSupervisorOperationCount, 0);
  const nodesRemaining = (await snapshot()).state.nodes.filter(node => ['terminal', 'agent'].includes(node.kind)).length;
  assert.equal(nodesRemaining, 0);
  const deadline = Math.min(Date.now() + 5000, control.deadlineAt - 10000);
  let resources;
  do {
    resources = await Promise.all(owned.resources.map(async expected => ({ expected, after: await readIdentity(expected.pid) ?? null })));
    if (resources.every(entry => exitedIdentity(entry.expected, entry.after))) break;
    await sleep(50);
  } while (Date.now() < deadline);
  assert(resources.every(entry => exitedIdentity(entry.expected, entry.after)));
  assert.deepEqual(owned.readySubjects, owned.expectedSubjects);
  let supervisor = { action: 'not-started' };
  if (owned.supervisor) {
    const persistDeadline = Math.min(Date.now() + 5000, control.deadlineAt - 10000);
    let registry;
    do {
      assert(sameLiveIdentity(owned.supervisor, await readIdentity(owned.supervisor.pid)));
      registry = JSON.parse(await fs.readFile(owned.paths.registryPath, 'utf8'));
      if (registry.sessions.length === 0) break;
      await sleep(50);
    } while (Date.now() < persistDeadline);
    assert.deepEqual(registry.sessions, [], 'Wait for actual reset persistence before external Supervisor cleanup.');
    assert(sameLiveIdentity(owned.supervisor, await readIdentity(owned.supervisor.pid)));
    assert.equal((await rpc(owned.paths.socketPath, 'hello')).pid, owned.supervisor.pid);
    assert(sameLiveIdentity(owned.supervisor, await readIdentity(owned.supervisor.pid)));
    process.kill(owned.supervisor.pid, 'SIGTERM');
    const stopDeadline = Math.min(Date.now() + 5000, control.deadlineAt - 5000);
    let after;
    while (!exitedIdentity(owned.supervisor, after = await readIdentity(owned.supervisor.pid))) {
      assert(Date.now() < stopDeadline, 'Owned idle Supervisor exit unconfirmed.');
      await sleep(50);
    }
    supervisor = { action: 'owned-isolated-idle-supervisor-SIGTERM', registryBeforeSignal: registry, after: after ?? null,
      registry: JSON.parse(await fs.readFile(owned.paths.registryPath, 'utf8')) };
    assert.deepEqual(supervisor.registry.sessions, []);
  }
  const report = { pass: true, productResetReturned: true, obstacle: obstacleResult, runtime,
    nodesRemaining, resources, supervisor };
  assertCleanupReport(report, owned);
  await archive('cleanup', report);
}

function rpc(socketPath, method, params) {
  assert(['hello', 'getSessionSnapshot'].includes(method), 'Only the fixed hello and snapshot diagnostics are permitted.');
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let data = '', settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true; clearTimeout(timer); socket.destroy(); error ? reject(error) : resolve(value);
    };
    const timer = setTimeout(() => finish(new Error(`Original Supervisor ${method} timed out.`)), 3000);
    socket.once('error', finish);
    socket.once('connect', () => socket.write(`${JSON.stringify({ type: 'request', id: 'a6-root-failure', method, ...(params ? { params } : {}) })}\n`));
    socket.on('data', chunk => {
      data += chunk.toString();
      if (data.length > 1024 * 1024) return finish(new Error('Unexpected diagnostic snapshot size.'));
      const end = data.indexOf('\n');
      if (end < 0) return;
      try {
        const response = JSON.parse(data.slice(0, end));
        assert(response.ok && response.id === 'a6-root-failure', JSON.stringify(response.error));
        finish(undefined, response.result);
      } catch (error) { finish(error); }
    });
  });
}
