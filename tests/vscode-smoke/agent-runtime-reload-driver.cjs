const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const net = require('node:net');
const path = require('node:path');
const vscode = require('vscode');
const { activateVisibleExtension, waitForCommand } = require('./test-helpers.cjs');
const { captureInstalledExtensionReceipt } = require('./installed-execution-candidate.cjs');
const { AgentProcessObserver, executionEnded } = require('./agent-candidate-process-observer.cjs');
const { resolveSystemdUserRuntimeSupervisorPaths, resolveLegacyRuntimeSupervisorPaths } = require('./runtime-reload-paths.cjs');
const { readIdentity, sameIdentity, sameLiveIdentity, exitedIdentity } = require('./runtime-reload-contract.cjs');

const artifacts = process.env.DEV_SESSION_CANVAS_SMOKE_ARTIFACT_DIR;
const controlPath = process.env.DEV_SESSION_CANVAS_AGENT_RELOAD_CONTROL;
const surface = 'editor';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const command = (name, ...args) => vscode.commands.executeCommand(`devSessionCanvas.__test.${name}`, ...args);
const snapshot = () => command('getDebugState');
const probe = () => command('captureWebviewProbe', surface, 10000);
const dom = action => command('performWebviewDomAction', action, surface, 10000);
const countMarker = (text, marker) => text.split(marker).length - 1;
const sendAgentTurn = async (nodeId, marker) => {
  // Codex treats Enter in a fast paste burst as an inserted newline; submit separately.
  await dom({ kind: 'sendExecutionInput', nodeId, data: `Reply with exactly ${marker} and nothing else.` });
  await sleep(200);
  await dom({ kind: 'sendExecutionInput', nodeId, data: '\r' });
};
const write = (name, value) => fs.writeFile(path.join(artifacts, name), `${JSON.stringify(value, null, 2)}\n`);
const read = async name => JSON.parse(await fs.readFile(path.join(artifacts, name), 'utf8'));
const atomic = async (file, value) => {
  const next = `${file}.next`;
  await fs.writeFile(next, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
  await fs.rename(next, file);
};
const nodeOf = (state, id) => state?.state?.nodes?.find(node => node.id === id);
// A marker can straddle xterm's soft-wrap boundary; preserve adjacency when matching it.
const textOf = value => value.nodes.find(node => node.nodeId === currentNodeId)?.terminalVisibleLines?.join('') ?? '';
let config;
let control;
let currentNodeId;
let observer;
let phase = 'initialization';
let reloading = false;

exports.activate = () => {
  void run().catch(async error => {
    try { await write(`${phase}-failure.json`, { phase, error: String(error), stack: error.stack }); }
    catch (writeError) { console.error(writeError); }
  });
};

async function poll(label, get, accept, timeoutMs = 30000) {
  const deadline = Math.min(Date.now() + timeoutMs, control.deadlineAt - 30000);
  while (Date.now() < deadline) {
    const value = await get();
    if (accept(value)) return value;
    if (observer?.error) throw new Error(observer.error);
    await sleep(50);
  }
  throw new Error(`Timed out: ${label}`);
}

async function run() {
  let failure;
  try {
    control = JSON.parse(await fs.readFile(controlPath, 'utf8'));
    config = JSON.parse(await fs.readFile(process.env.DEV_SESSION_CANVAS_AGENT_RELOAD_CONFIG, 'utf8'));
    phase = control.phase;
    await write(`${phase}-activation.json`, { phase, host: await readIdentity(process.pid), nonce: control.nonce });
    const extension = await activateVisibleExtension(vscode, 'devsessioncanvas.dev-session-canvas');
    await waitForCommand(vscode, 'devSessionCanvas.__test.getDebugState');
    const installedVsix = await captureInstalledExtensionReceipt(extension, config.installedVsixExpectation);
    await write(`${phase}-environment.json`, { phase, nonce: control.nonce, vscode: vscode.version,
      versions: process.versions, installedVsix });
    await vscode.commands.executeCommand('devSessionCanvas.openCanvasInEditor');
    await command('waitForCanvasReady', surface, 30000);
    if (phase === 'setup') await setup(extension);
    else await verify(extension);
  } catch (error) {
    failure = error;
    await write(`${phase}-failure.json`, { phase, nonce: control?.nonce, error: String(error), stack: error.stack });
    for (const name of ['getDebugState', 'getRuntimeSupervisorState', 'getDiagnosticEvents']) {
      try { await write(`failure-${name}.json`, await command(name)); } catch { /* Preserve the first failure. */ }
    }
  } finally {
    if (!reloading) {
      try { await cleanup(); } catch (error) { failure ??= error; await write('cleanup-failure.json', { error: String(error) }); }
      await write('driver-finished.json', { nonce: control?.nonce, phase, pass: !failure });
      void vscode.commands.executeCommand('workbench.action.closeWindow').catch(console.error);
    }
  }
}

function runtimePaths(metadata) {
  return metadata.runtimeBackend === 'systemd-user'
    ? resolveSystemdUserRuntimeSupervisorPaths(metadata.runtimeStoragePath)
    : resolveLegacyRuntimeSupervisorPaths(metadata.runtimeStoragePath);
}

function rpc(socketPath, method, id = 'agent-reload') {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let data = '';
    const timer = setTimeout(() => finish(new Error(`Supervisor ${method} timed out.`)), 5000);
    const finish = (error, value) => { clearTimeout(timer); socket.destroy(); error ? reject(error) : resolve(value); };
    socket.once('error', finish);
    socket.once('connect', () => socket.write(`${JSON.stringify({ type: 'request', id, method })}\n`));
    socket.on('data', chunk => {
      data += chunk.toString();
      if (data.length > 65536) return finish(new Error('Unexpectedly large Supervisor response.'));
      const end = data.indexOf('\n');
      if (end < 0) return;
      try {
        const response = JSON.parse(data.slice(0, end));
        assert(response.ok && response.id === id, JSON.stringify(response.error));
        finish(undefined, response.result);
      } catch (error) { finish(error); }
    });
  });
}

async function mountedReader(id) {
  return (await poll('live Agent reader', async () => ({ probe: await probe(), messages: await command('getHostMessages') }),
    value => value.probe.nodes.some(node => node.nodeId === id && node.terminalCols >= 64) &&
      value.messages.some(message => message.type === 'host/executionSnapshot' && message.payload.nodeId === id &&
        message.payload.terminalRead?.sessionId))).messages.findLast(message =>
          message.type === 'host/executionSnapshot' && message.payload.nodeId === id).payload.terminalRead;
}

async function setup(extension) {
  await command('resetState');
  await command('clearHostMessages');
  await command('clearDiagnosticEvents');
  observer = new AgentProcessObserver(config.cli, extension.extensionPath, config.processObserver);
  observer.start();
  await observer.addRoot(process.pid, 'host');
  const custom = [config.cli.entry, ...config.launchArguments].map(value => `'${String(value).replaceAll("'", "'\\''")}'`).join(' ');
  await command('createNode', 'agent', 'codex', { agentLaunchPreset: 'custom', agentCustomLaunchCommand: custom,
    cwdOverride: config.workspacePath });
  const created = await poll('Agent node created', snapshot, state => state.state.nodes.some(node => node.kind === 'agent'));
  currentNodeId = created.state.nodes.find(node => node.kind === 'agent').id;
  const position = nodeOf(created, currentNodeId).position;
  await command('dispatchWebviewMessage', { type: 'webview/resizeNode', payload: {
    nodeId: currentNodeId, position, size: { width: 960, height: 700 } } }, surface);
  const active = await poll('Agent live runtime', snapshot, state => {
    const metadata = nodeOf(state, currentNodeId)?.metadata?.agent;
    if (metadata?.lastRuntimeError) throw new Error(`Agent startup failed: ${metadata.lastRuntimeError}`);
    return metadata?.liveSession === true;
  }, 60000);
  const metadata = nodeOf(active, currentNodeId).metadata.agent;
  assert.equal(metadata.persistenceMode, 'live-runtime');
  const paths = runtimePaths(metadata);
  const hello = await rpc(paths.socketPath, 'hello');
  const supervisor = await readIdentity(hello.pid);
  assert(supervisor && supervisor.startTicks);
  await observer.addRoot(supervisor.pid, 'supervisor');
  const reader = await mountedReader(currentNodeId);
  await waitForAgentReady();
  const before = `DSC_AGENT_RELOAD_BEFORE_${control.nonce}`;
  const beforeBaseline = countMarker(textOf(await probe()), before);
  await sendAgentTurn(currentNodeId, before);
  await poll('pre-reload Agent response', probe,
    value => countMarker(textOf(value), before) >= beforeBaseline + 2, 90000);
  await observer.sample();
  const resources = observer.result().entries.filter(entry => ['cli', 'wrapper', 'provider'].includes(entry.role));
  assert(resources.some(entry => entry.role === 'cli'), 'The real Codex CLI must be observed before reload.');
  const setup = { phase: 'setup', nonce: control.nonce, host: await readIdentity(process.pid), nodeId: currentNodeId,
    binding: { runtimeBackend: metadata.runtimeBackend, runtimeStoragePath: metadata.runtimeStoragePath,
      runtimeSessionId: metadata.runtimeSessionId }, supervisor, hello, reader, resources,
    frameId: (await snapshot()).surfaceLifecycle[surface].frameId, before };
  await write('ownership.json', { supervisor, resources });
  await write('setup.json', setup);
  control = { ...control, phase: 'verify', reloadRequests: 1, setup };
  await atomic(controlPath, control);
  reloading = true;
  void vscode.commands.executeCommand('workbench.action.reloadWindow').catch(error => write('reload-command-rejection.json', { error: String(error) }));
}

async function waitForAgentReady() {
  const prompts = new Set();
  const deadline = Math.min(Date.now() + 90000, control.deadlineAt - 30000);
  while (Date.now() < deadline) {
    const value = await probe();
    const text = textOf(value);
    let handledPrompt = false;
    for (const [name, pattern] of [['workspace-trust', /(?:Yes, I trust|Do you trust|Trust this (?:folder|directory))/i],
      ['theme', /(?:Choose the text style|Choose.*theme|Select.*theme)/i],
      ['update', /Update available.*\n[\s\S]*\b1\.\s*Update now[\s\S]*\b2\.\s*Skip/i]]) {
      if (pattern.test(text) && !prompts.has(name)) {
        prompts.add(name);
        await dom({ kind: 'sendExecutionInput', nodeId: currentNodeId, data: name === 'update' ? '\u001b[B\r' : '\r' });
        handledPrompt = true;
        break;
      }
    }
    if (handledPrompt) { await sleep(100); continue; }
    if (/(?:codex|ask|prompt|send|shortcuts)/i.test(text)) return;
    await sleep(100);
  }
  throw new Error('Timed out: Codex interactive surface');
}

async function verify(extension) {
  const setup = control.setup;
  currentNodeId = setup.nodeId;
  const oldHost = await poll('original Agent Host exited', () => readIdentity(setup.host.pid), value => exitedIdentity(setup.host, value));
  const activation = await read('verify-activation.json');
  assert(!sameIdentity(setup.host, activation.host), 'Reload must use a new Host identity.');
  const state = await snapshot();
  const node = nodeOf(state, setup.nodeId);
  assert(node?.metadata?.agent?.liveSession === true, 'Reload must retain the live Agent node.');
  const metadata = node.metadata.agent;
  for (const [key, value] of Object.entries(setup.binding)) assert.equal(metadata[key], value);
  const paths = runtimePaths(metadata);
  const hello = await rpc(paths.socketPath, 'hello');
  assert.equal(hello.pid, setup.supervisor.pid);
  assert(sameLiveIdentity(setup.supervisor, await readIdentity(setup.supervisor.pid)));
  const reader = await mountedReader(setup.nodeId);
  assert.equal(reader.sessionId, setup.binding.runtimeSessionId);
  assert.equal(reader.authorityId, setup.reader.authorityId);
  assert.notEqual(reader.readId, setup.reader.readId, 'Reload must mount a new reader on the same authority.');
  assert.notEqual(state.surfaceLifecycle[surface].frameId, setup.frameId);
  const starts = (await command('getDiagnosticEvents')).filter(event =>
    ['execution/startRequested', 'execution/started'].includes(event.kind) && event.detail?.nodeId === setup.nodeId);
  assert.deepEqual(starts, [], 'Reload must not start a second Agent.');
  observer = new AgentProcessObserver(config.cli, extension.extensionPath, config.processObserver);
  observer.start();
  await observer.addRoot(process.pid, 'host');
  await observer.addRoot(setup.supervisor.pid, 'supervisor');
  await waitForAgentReady();
  const after = `DSC_AGENT_RELOAD_AFTER_${control.nonce}`;
  const afterBaseline = countMarker(textOf(await probe()), after);
  await sendAgentTurn(setup.nodeId, after);
  await poll('post-reload Agent response', probe,
    value => countMarker(textOf(value), after) >= afterBaseline + 2, 90000);
  await dom({ kind: 'stopExecutionSession', nodeId: setup.nodeId });
  const ended = await poll('Agent stop final state', snapshot, value => {
    const current = nodeOf(value, setup.nodeId);
    return current?.metadata?.agent?.liveSession === false && current.status === 'stopped' &&
      current.metadata.agent.terminalHistoryDiscarded === true;
  }, 60000);
  const events = await command('getDiagnosticEvents');
  assert(events.some(event => event.kind === 'runtime/terminalReadSettled' && event.detail?.nodeId === setup.nodeId &&
    event.detail.sessionId === setup.binding.runtimeSessionId && event.detail.readId === reader.readId &&
    event.detail.outcome?.kind === 'applied'));
  await poll('runtime binding removed', command.bind(null, 'getRuntimeSupervisorState'), value =>
    !value.bindings.some(binding => binding.nodeId === setup.nodeId));
  await observer.stop();
  await observer.sample();
  assert.equal(observer.failures.length, 0);
  const identities = await Promise.all(setup.resources.map(expected => readIdentity(expected.pid)));
  const allEnded = setup.resources.every((expected, index) => exitedIdentity(expected, identities[index]));
  assert(allEnded, 'Original Agent CLI/provider resources must exit after post-reload stop.');
  await write('verify.json', { phase: 'verify', nonce: control.nonce, pass: true, oldHost, node: nodeOf(ended, setup.nodeId),
    binding: setup.binding, supervisor: await readIdentity(setup.supervisor.pid), reader, after,
    noNewExecution: true, originalResourcesExited: allEnded });
}

async function cleanup() {
  if (!observer) return;
  try { await command('resetState'); } catch { /* The original product failure remains authoritative. */ }
  const expected = control?.setup?.supervisor;
  if (expected && sameLiveIdentity(expected, await readIdentity(expected.pid))) {
    process.kill(expected.pid, 'SIGTERM');
    await poll('idle Supervisor exit', () => readIdentity(expected.pid), value => exitedIdentity(expected, value), 10000);
  }
  try { await observer.stop(); } catch { /* Preserve the original assertion. */ }
}
