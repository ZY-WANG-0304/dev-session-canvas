const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const { randomUUID } = require('node:crypto');
const vscode = require('vscode');
const { activateVisibleExtension, waitForCommand } = require('./test-helpers.cjs');
const { captureInstalledExtensionReceipt } = require('./installed-execution-candidate.cjs');
const { readIdentity, sameLiveIdentity, exitedIdentity } = require('./runtime-reload-contract.cjs');
const { bindingKeys, assertBinding, assertContained, assertTopology, assertRestored } = require('./root-owner-contract.cjs');
const { resolveLegacyRuntimeSupervisorPaths, resolveSystemdUserRuntimeSupervisorPaths,
  resolveRuntimeRootOwnerGlobalStoragePath, assertRuntimeOwnerDescriptor } = require('./root-owner-runtime-paths.cjs');

const surface = 'panel';
const command = (name, ...args) => vscode.commands.executeCommand(`devSessionCanvas.__test.${name}`, ...args);
const snapshot = () => command('getDebugState');
const probe = () => command('captureWebviewProbe', surface, 5000);
const dom = action => command('performWebviewDomAction', action, surface, 5000);
const dispatch = (type, payload) => command('dispatchWebviewMessage', { type, payload }, surface);
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let control, role = `unknown-${process.pid}`, environment;
const read = async name => JSON.parse(await fs.readFile(path.join(control.artifacts, `${name}.json`), 'utf8'));
async function archive(name, value) {
  const file = path.join(control.artifacts, `${name}.json`), pending = `${file}.pending-${process.pid}`;
  await fs.writeFile(pending, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
  // Publish a complete receipt without replacing an earlier observation.
  await fs.link(pending, file);
  await fs.unlink(pending);
}

exports.activate = context => { void run(context).catch(async error => {
  const failure = { role, error: String(error), stack: error.stack };
  if (control) await archive(`failure-${role}`, failure).catch(() => {});
  console.error(failure);
}); };

async function poll(label, get, accept, budgetMs = 20000) {
  const deadline = Math.min(Date.now() + budgetMs, control.deadlineAt - 60000);
  while (Date.now() < deadline) {
    const value = await get();
    if (accept(value)) return value;
    await sleep(100);
  }
  throw new Error(`Timed out: ${label}`);
}

async function maybeRead(name) {
  try { return await read(name); } catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
}
const waitFile = name => poll(name, () => maybeRead(name), Boolean, 90000);
const nodeBySession = (state, sessionId) => state.state.nodes.find(node => node.metadata?.terminal?.runtimeSessionId === sessionId);

async function run(context) {
  control = JSON.parse(await fs.readFile(process.env.DEV_SESSION_CANVAS_ROOT_OWNER_CONTROL, 'utf8'));
  assert.equal(process.platform, 'linux');
  assert.equal(control.schema, 1);
  const roots = (vscode.workspace.workspaceFolders ?? []).map(folder => folder.uri.fsPath);
  if (vscode.workspace.workspaceFile?.fsPath === control.multiWorkspace) {
    role = 'multi';
    assert.deepEqual(roots, Object.values(control.roots));
  } else {
    assert.deepEqual(roots, [control.roots.a]);
    role = await maybeRead('single-closing') ? 'single-reopened' : 'single';
  }
  const host = await readIdentity(process.pid);
  await archive(`activated-${role}`, { host, workspaceRoots: roots });
  const launcher = await waitFile('launcher');
  let ancestor = host;
  for (let depth = 0; ancestor && ancestor.pid !== launcher.ui.pid && depth < 12; depth++) {
    ancestor = ancestor.ppid > 1 ? await readIdentity(ancestor.ppid) : undefined;
  }
  assert(sameLiveIdentity(launcher.ui, ancestor), 'Every Host must belong to the original isolated VS Code application.');
  const extension = await activateVisibleExtension(vscode, 'devsessioncanvas.dev-session-canvas');
  await waitForCommand(vscode, 'devSessionCanvas.__test.getDebugState');
  const installedVsix = await captureInstalledExtensionReceipt(extension, control.installedExpectation);
  await vscode.commands.executeCommand('devSessionCanvas.openCanvasInPanel');
  await command('waitForCanvasReady', surface, 20000);
  environment = { host, workspaceRoots: roots, roots: control.roots, vscode: vscode.version,
    versions: process.versions, installedVsix,
    globalStorage: path.join(path.dirname(context.globalStorageUri.fsPath), 'devsessioncanvas.dev-session-canvas') };
  await archive(`environment-${role}`, environment);
  if (role === 'single') await initialSingle();
  else if (role === 'multi') await multiWindow();
  else await reopenedSingle();
}

async function initialSingle() {
  const subject = await createSubject('single-a', control.roots.a);
  environment.globalStorage = await fs.realpath(environment.globalStorage);
  await flush();
  const ready = { ...environment, subject };
  await archive('single-ready', ready);
  await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(control.multiWorkspace), { forceNewWindow: true });
  const multi = await waitFile('multi-ready');
  assertTopology(ready, multi, control.roots);
  await archive('single-closing', { host: environment.host, binding: subject.binding });
  // The peer's exited-Host observation, not this command result, proves closure.
  void vscode.commands.executeCommand('workbench.action.closeWindow').catch(() => {});
}

async function multiWindow() {
  const single = await waitFile('single-ready');
  const subjects = [];
  for (const key of ['a', 'b', 'c']) subjects.push(await createSubject(`multi-${key}`, control.roots[key]));
  environment.globalStorage = await fs.realpath(environment.globalStorage);
  await flush();
  const resources = { owners: await Promise.all(subjects.map(subject => sampleOwner(subject.supervisor))),
    host: await sampleOwner(environment.host), sampleKind: 'one-idle-snapshot-with-four-live-terminal-subjects' };
  const multi = { ...environment, subjects, resources };
  assertTopology(single, multi, control.roots);
  await archive('multi-ready', multi);
  await waitFile('single-closing');
  await poll('original single-root Extension Host exited', () => readIdentity(single.host.pid),
    value => exitedIdentity(single.host, value));
  const peerInteraction = await interact(single.subject.binding.runtimeSessionId);
  const isolatedInteractions = [], isolatedChecks = [];
  for (const subject of subjects.slice(1)) {
    const check = {};
    for (const role of ['supervisor', 'provider', 'identity']) {
      check[role] = await readIdentity(subject[role].pid);
      assert(sameLiveIdentity(subject[role], check[role]));
    }
    isolatedChecks.push(check);
    isolatedInteractions.push(await interact(subject.binding.runtimeSessionId));
  }
  await flush();
  await archive('after-close', { originalHostExited: true, peerInteraction, isolatedInteractions, isolatedChecks,
    persistenceOrder: 'surviving-multi-saved-after-original-host-exit-before-reopen' });
  await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(control.roots.a), { forceNewWindow: true });
  await waitFile('single-reopened-ready');
  const all = [single.subject, ...subjects];
  for (const subject of all) {
    const node = await liveNode(subject.binding.runtimeSessionId);
    assertBinding(node.metadata.terminal, subject.binding);
    await focus(node);
    await dom({ kind: 'sendExecutionInput', nodeId: node.id, data: 'exit\r' });
  }
  await settled(all);
  await archive('cleanup-start', { sessions: all.map(subject => subject.binding.runtimeSessionId) });
  await waitFile('single-finished');
  const reopened = await read('single-reopened-ready');
  await poll('reopened single-root Host exited', () => readIdentity(reopened.host.pid),
    value => exitedIdentity(reopened.host, value));
  await flush();
  const runtime = await command('getRuntimeSupervisorState');
  assert.equal(runtime.bindings.length, 0);
  assert.equal(runtime.pendingRuntimeSupervisorOperationCount, 0);
  await archive('multi-finished', { pass: true, runtime, sessions: all.map(subject => subject.binding.runtimeSessionId) });
  void vscode.commands.executeCommand('workbench.action.closeWindow').catch(() => {});
}

async function reopenedSingle() {
  const single = await read('single-ready');
  const multi = await read('multi-ready');
  assert.notEqual(environment.host.pid, single.host.pid);
  const subjects = [];
  for (const original of [single.subject, multi.subjects[0]]) {
    const node = await liveNode(original.binding.runtimeSessionId);
    const current = await inspectSubject(node, original.rootPath, original.label, original.receiptPath);
    current.interaction = await interact(original.binding.runtimeSessionId);
    assertRestored(original, current);
    subjects.push(current);
  }
  environment.globalStorage = await fs.realpath(environment.globalStorage);
  await archive('single-reopened-ready', { ...environment, subjects });
  await waitFile('cleanup-start');
  await settled(subjects);
  await flush();
  await archive('single-finished', { pass: true, host: environment.host });
  void vscode.commands.executeCommand('workbench.action.closeWindow').catch(() => {});
}

async function flush() {
  const result = await command('flushPersistedState');
  assert(result.exists && !result.lastError);
  assertContained(control.userDataDir, result.snapshotPath);
}

async function liveNode(sessionId) {
  const state = await poll('original live binding', snapshot, value => {
    const node = nodeBySession(value, sessionId);
    return node?.metadata?.terminal?.liveSession === true && node.metadata.terminal.attachmentState === 'attached-live';
  }, 45000);
  return nodeBySession(state, sessionId);
}

async function focus(node) {
  await vscode.commands.executeCommand('devSessionCanvas.__internal.focusNode', node.id);
  await dispatch('webview/resizeNode', { nodeId: node.id, position: node.position, size: { width: 1000, height: 540 } });
  await poll('mounted real terminal', probe, value => value.nodes.some(entry =>
    entry.nodeId === node.id && entry.terminalCols >= 80 && entry.terminalRows >= 5));
}

async function createSubject(label, rootPath) {
  const before = await snapshot();
  const ids = new Set(before.state.nodes.map(node => node.id));
  const group = before.state.groups?.find(entry => entry.role === 'workspace-root' && entry.workspaceRootPath === rootPath);
  if (role === 'multi') assert(group, 'Create through the actual composed root group.');
  await dispatch('webview/createDemoNode', { kind: 'terminal', ...(group ? { targetGroupId: group.id,
    preferredPosition: { x: group.position.x + 40, y: group.position.y + 40 } } : {}) });
  const created = await poll(`${label} created and live`, snapshot, value => value.state.nodes.some(node =>
    !ids.has(node.id) && node.kind === 'terminal' && node.metadata?.terminal?.liveSession), 45000);
  const node = created.state.nodes.find(entry => !ids.has(entry.id) && entry.kind === 'terminal');
  const binding = Object.fromEntries(bindingKeys.map(key => [key, node.metadata.terminal[key]]));
  const owner = await inspectOwner(binding, rootPath);
  await archive(`owned-${label}`, { label, binding, supervisor: owner.supervisor });
  await focus(node);
  const receiptPath = path.join(control.artifacts, `subject-${label}.json`);
  const nonce = randomUUID();
  await dom({ kind: 'sendExecutionInput', nodeId: node.id,
    data: `stty -echo -onlcr; exec ${quote(control.subjectExecutable)} ${quote(path.join(__dirname, 'root-owner-subject.cjs'))} ${quote(receiptPath)} ${quote(nonce)}\r` });
  await poll(`${label} subject receipt`, async () => {
    try { return JSON.parse(await fs.readFile(receiptPath, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
  }, value => value?.nonce === nonce && value.state === 'ready');
  const subject = await inspectSubject(node, rootPath, label, receiptPath);
  await archive(`resources-${label}`, subject);
  subject.interaction = await interact(binding.runtimeSessionId);
  return subject;
}

async function inspectOwner(binding, rootPath) {
  assertRuntimeOwnerDescriptor(binding.runtimeOwner);
  assert.equal(binding.runtimeOwner.root.normalizedPath, rootPath);
  assert.equal(binding.runtimeOwner.generation, 'terminal-root-owner-linux-v1');
  const globalStorage = resolveRuntimeRootOwnerGlobalStoragePath(path.join(binding.runtimeStoragePath, 'runtime-supervisor'), binding.runtimeOwner);
  assert.equal(globalStorage, await fs.realpath(environment.globalStorage));
  assertContained(control.userDataDir, binding.runtimeStoragePath);
  const paths = binding.runtimeBackend === 'systemd-user'
    ? resolveSystemdUserRuntimeSupervisorPaths(binding.runtimeStoragePath)
    : resolveLegacyRuntimeSupervisorPaths(binding.runtimeStoragePath);
  const hello = await rpc(paths.socketPath, 'hello');
  assert.deepEqual(hello.runtimeOwner, binding.runtimeOwner);
  const supervisor = await readIdentity(hello.pid);
  assert(supervisor?.executable && supervisor.startTicks);
  return { supervisor, hello, socketPath: paths.socketPath };
}

async function inspectSubject(node, rootPath, label, receiptPath) {
  const binding = Object.fromEntries(bindingKeys.map(key => [key, node.metadata.terminal[key]]));
  const owner = await inspectOwner(binding, rootPath);
  const receipt = JSON.parse(await fs.readFile(receiptPath, 'utf8'));
  const identity = await readIdentity(receipt.pid);
  assert.equal(identity?.executable, control.subjectExecutable);
  let ancestor = identity, provider;
  for (let depth = 0; ancestor && ancestor.pid !== owner.supervisor.pid && depth < 8; depth++) {
    const args = (await fs.readFile(`/proc/${ancestor.pid}/cmdline`, 'utf8')).split('\0');
    if (args.some(arg => arg.endsWith('/dist/linux-execution-provider.js'))) provider = ancestor;
    ancestor = ancestor.ppid > 1 ? await readIdentity(ancestor.ppid) : undefined;
  }
  assert(provider && sameLiveIdentity(owner.supervisor, ancestor), 'Subject/provider must belong to the original owner.');
  await focus(node);
  const messages = await poll('original live reader', () => command('getHostMessages'), values => values.some(message =>
    message.type === 'host/executionSnapshot' && message.payload.nodeId === node.id && message.payload.terminalRead));
  const reader = messages.findLast(message => message.type === 'host/executionSnapshot' &&
    message.payload.nodeId === node.id && message.payload.terminalRead).payload.terminalRead;
  return { label, rootPath, nodeId: node.id, binding, ...owner, identity, provider, reader, receiptPath };
}

async function interact(sessionId) {
  const node = await liveNode(sessionId);
  await focus(node);
  const nonce = randomUUID(), marker = `DSC_ROOT_REPLY_${nonce}`, started = Date.now();
  await dom({ kind: 'sendExecutionInput', nodeId: node.id, data: `ping ${nonce}\r` });
  await poll('nonce rendered in the real terminal buffer', async () => {
    try { await dom({ kind: 'assertExecutionTerminalBuffer', nodeId: node.id, linePrefix: marker, expectedLines: [marker] }); return true; }
    catch { return false; }
  }, Boolean);
  return { marker, applied: true, elapsedMs: Date.now() - started, sessionId };
}

async function settled(subjects) {
  await poll('all original sessions completed', snapshot, value => subjects.every(subject =>
    !nodeBySession(value, subject.binding.runtimeSessionId)), 30000);
  for (const subject of subjects) await poll('original subject exited', () => readIdentity(subject.identity.pid),
    value => exitedIdentity(subject.identity, value));
}

async function sampleOwner(expected) {
  assert(sameLiveIdentity(expected, await readIdentity(expected.pid)));
  const status = await fs.readFile(`/proc/${expected.pid}/status`, 'utf8');
  const match = /^VmRSS:\s+(\d+) kB$/m.exec(status);
  assert(match);
  assert(sameLiveIdentity(expected, await readIdentity(expected.pid)));
  return { identity: expected, rssBytes: Number(match[1]) * 1024, sameIdentity: true };
}

function rpc(socketPath, method) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath), id = randomUUID();
    let data = '', done = false;
    const finish = (error, value) => { if (done) return; done = true; clearTimeout(timer); socket.destroy(); error ? reject(error) : resolve(value); };
    const timer = setTimeout(() => finish(new Error(`Supervisor ${method} timed out.`)), 5000);
    socket.once('error', finish);
    socket.once('end', () => finish(new Error('Supervisor closed without a complete response.')));
    socket.once('connect', () => socket.write(`${JSON.stringify({ type: 'request', id, method })}\n`));
    socket.on('data', bytes => {
      data += bytes.toString();
      if (data.length > 65536) return finish(new Error('Supervisor response exceeded the fixed limit.'));
      const end = data.indexOf('\n');
      if (end < 0) return;
      try {
        const response = JSON.parse(data.slice(0, end));
        assert(response.ok && response.id === id);
        finish(undefined, response.result);
      } catch (error) { finish(error); }
    });
  });
}
