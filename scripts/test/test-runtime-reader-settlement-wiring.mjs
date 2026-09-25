import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import esbuild from 'esbuild';

const bundled = await esbuild.build({
  stdin: {
    contents: `
      export { CanvasPanelManager } from './extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager';
      export { RuntimeTerminalReadRelay } from './extensions/vscode/dev-session-canvas/src/panel/runtimeTerminalReadRelay';
      export { RuntimeSupervisorClient } from './extensions/vscode/dev-session-canvas/src/panel/runtimeSupervisorClient';
      export { parseWebviewMessage } from './extensions/vscode/dev-session-canvas/src/common/protocol';
      export { TerminalProjectionRefreshScheduler } from './extensions/vscode/dev-session-canvas/src/common/terminalProjectionRefreshScheduler';
      export { RuntimeSupervisorServer } from './extensions/vscode/dev-session-canvas/src/supervisor/runtimeSupervisorMain';
      export { TerminalPagedProjection } from './extensions/vscode/dev-session-canvas/src/webview/terminalPagedProjection';
      export { encodeOutputFrame } from './extensions/vscode/dev-session-canvas/src/common/executionLifecycle';
    `,
    resolveDir: process.cwd(), sourcefile: 'runtime-reader-settlement-wiring-entry.ts'
  },
  bundle: true, write: false, platform: 'node', format: 'cjs', target: 'node18', external: ['node-pty'],
  plugins: [{
    name: 'reader-io-boundaries-only',
    setup(build) {
      build.onResolve({ filter: /^vscode$/ }, args => ({
        path: args.path, namespace: 'reader-boundary'
      }));
      build.onLoad({ filter: /.*/, namespace: 'reader-boundary' }, args => ({
        loader: 'js', contents: `
          class Disposable { dispose() {} }
          class EventEmitter { event = () => new Disposable(); fire() {} dispose() {} }
          class ThemeIcon { constructor(id) { this.id = id; } }
          class TreeItem {}
          module.exports = {
            Disposable, EventEmitter, ThemeIcon, TreeItem,
            ExtensionMode: { Production: 1, Development: 2, Test: 3 },
            TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
            l10n: { t: message => message },
            env: { appName: 'VS Code Test', shell: '/controlled/shell' },
            workspace: { isTrusted: true, workspaceFolders: [],
              getConfiguration: () => ({ get: (_key, fallback) => fallback, inspect: () => undefined }) },
            window: { showErrorMessage: async () => undefined },
            Uri: { file: fsPath => ({ fsPath, path: fsPath, scheme: 'file' }) }
          };
        `
      }));
    }
  }]
});
const loaded = { exports: {} };
const forbiddenAcquisitions = [];
const require = createRequire(import.meta.url);
function forbidden(name) {
  forbiddenAcquisitions.push(name);
  throw new Error(`Native processes and real sockets are forbidden in reader wiring tests: ${name}`);
}
const guardedRequire = name => {
  if (name === 'node-pty') return forbidden(name);
  if (/^(?:node:)?(?:child_process|net)$/.test(name)) {
    return Object.fromEntries(['spawn', 'spawnSync', 'fork', 'exec', 'execSync', 'execFile', 'execFileSync',
      'createConnection', 'connect', 'createServer', 'Socket'].map(method => [method, () => forbidden(`${name}.${method}`)]));
  }
  return require(name);
};
guardedRequire.resolve = name => name === 'node-pty' ? forbidden(name) : require.resolve(name);
new Function('require', 'module', 'exports', '__filename', '__dirname', bundled.outputFiles[0].text)(
  guardedRequire, loaded, loaded.exports,
  path.resolve('scripts/test/runtime-reader-settlement-wiring.cjs'), path.resolve('scripts/test')
);
const { CanvasPanelManager, RuntimeTerminalReadRelay, RuntimeSupervisorClient, parseWebviewMessage,
  TerminalProjectionRefreshScheduler, RuntimeSupervisorServer, TerminalPagedProjection, encodeOutputFrame } = loaded.exports;
const mode = 'final-application-v1';
const clients = new Set();

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function until(condition, label) {
  for (let turn = 0; turn < 200; turn++) {
    if (condition()) return;
    await new Promise(resolve => setTimeout(resolve, 1));
  }
  assert.equal(condition(), true, `${label} did not settle within the bounded task turns`);
}

function checkpoint(sessionId, authorityId, revision = 0) {
  return {
    version: 1, sessionId, authorityId, revision, cols: 80, rows: 24, scrollback: 100, createdAtMs: 1,
    serializedState: { format: 'xterm-serialize-v1', data: '', outputSequence: revision }
  };
}

async function controlledClient(options = {}) {
  const requests = [];
  let nextRead = 0;
  class ControlledSocket extends EventEmitter {
    destroyed = false;
    setEncoding() { return this; }
    write(bytes) {
      assert.equal(this.destroyed, false, 'no RPC may be sent on a destroyed socket');
      const request = JSON.parse(String(bytes));
      assert.equal(request.type, 'request');
      requests.push(request);
      const reply = (ok, value) => {
        if (!this.destroyed) this.emit('data', `${JSON.stringify({ type: 'response', id: request.id, ok,
          ...(ok ? { result: value } : { error: { message: String(value?.message ?? value) } }) })}\n`);
      };
      Promise.resolve().then(() => handle(request)).then(value => reply(true, value), error => reply(false, error));
      return true;
    }
    destroy() {
      if (!this.destroyed) {
        this.destroyed = true;
        this.emit('close');
      }
      return this;
    }
  }
  function descriptor(params) {
    return {
      readId: `read-${++nextRead}`, sessionId: params.sessionId, authorityId: params.authorityId,
      checkpoint: checkpoint(params.sessionId, params.authorityId, options.checkpointRevision ?? 0),
      headRevision: options.headRevision ?? options.checkpointRevision ?? 0,
      ...(params.settlementMode && options.echoMode !== false ? { settlementMode: params.settlementMode } : {})
    };
  }
  function handle(request) {
    if (options.handle) {
      const overridden = options.handle(request, descriptor);
      if (overridden !== undefined) return overridden;
    }
    const { params } = request;
    if (request.method === 'hello') return {
      serverVersion: 1, pid: 1, runtimeBackend: 'legacy-detached', runtimeGuarantee: 'best-effort',
      capabilities: { terminalPagedReadV1: true, terminalPagedCompletionV1: true,
        ...(options.helloCapability !== false ? { terminalReadSettlementV1: true } : {}) }
    };
    if (request.method === 'openTerminalRead') return descriptor(params);
    if (request.method === 'readTerminalPage') {
      const headRevision = options.headRevision ?? params.afterRevision;
      const events = Array.from({ length: headRevision - params.afterRevision }, (_, index) => ({
        type: 'output', revision: params.afterRevision + index + 1, createdAtMs: 1, data: `tail-${index}`
      }));
      return { ...params, revision: headRevision, headRevision, events };
    }
    if (request.method === 'closeTerminalRead') return options.closeResult ?? { ok: true, settlement: 'recorded' };
    throw new Error(`Unexpected controlled RPC: ${request.method}`);
  }
  const socket = new ControlledSocket();
  const backend = { paths: { socketPath: '/forbidden-test-socket' },
    startSupervisor() { forbidden('startSupervisor'); } };
  const client = new RuntimeSupervisorClient({ backend, supervisorScriptPath: '/forbidden-supervisor',
    supervisorLauncherScriptPath: '/forbidden-launcher' });
  clients.add(client);
  client.attachSocket(socket);
  await client.performHelloHandshake();
  return { client, socket, requests, descriptor, rpc: method => requests.filter(request => request.method === method) };
}

async function fixture(options = {}) {
  const remote = options.remote ?? await controlledClient(options);
  const relay = new RuntimeTerminalReadRelay();
  const host = Object.create(CanvasPanelManager.prototype);
  const posted = [];
  const diagnostics = [];
  const released = [];
  const webviews = { editor: {}, panel: {} };
  let session = {
    owner: 'supervisor', sessionId: 'session-1', terminalAuthorityId: 'authority-1',
    runtimeBackend: 'legacy-detached', runtimeStoragePath: '/controlled-runtime',
    terminalStreamPaged: true, terminalStreamHealthy: true,
    terminalReadSettlementV1: options.sessionCapability !== false,
    outputSequence: options.headRevision ?? 0, cols: 80, rows: 24,
    terminalStateTracker: { dispose() {} }, lineContextTracker: { dispose() {} }
  };
  Object.assign(host, {
    context: { extensionMode: 3 }, activeSurface: 'editor', terminalReadRelay: relay,
    state: { nodes: [{ id: 'terminal-1', kind: 'terminal', metadata: {} }], edges: [], groups: [] },
    terminalSessions: new Map([['terminal-1', session]]), agentSessions: new Map(),
    surfaceMode: { editor: 'active', panel: 'active' }, surfaceReady: { editor: false, panel: false },
    surfaceLifecycle: {
      editor: { generation: 1, mode: 'active', frameId: 'editor-frame-1', ready: false, bootstrapAck: false },
      panel: { generation: 1, mode: 'active', frameId: 'panel-frame-1', ready: false, bootstrapAck: false }
    },
    surfaceMessageWebview: webviews, renderedWebviewLifecycle: new WeakMap(), pendingBootstrapHostMessages: {},
    pendingRuntimeSupervisorOperations: new Set(),
    scheduledExecutionOutputPosts: new Map(),
    runtimeSessionBindings: new Map(), terminalProjectionRefreshScheduler: new TerminalProjectionRefreshScheduler({}),
    recordDiagnosticEvent: (name, detail) => diagnostics.push({ name, detail }),
    postMessage: (message, surface) => {
      posted.push({ message, surface: surface ?? host.activeSurface });
      options.onHostMessage?.(message);
    },
    postMessageToSurface: (surface, message) => {
      posted.push({ message, surface });
      options.onHostMessage?.(message);
    },
    postWorkspaceRootFocusGroupMessageForCurrentLifecycle() {}, bootstrapInteractiveSurface: async () => {},
    rejectPendingWebviewProbeRequests() {}, rejectPendingWebviewDomActionRequests() {},
    persistState: async () => {}, postState() {}, deleteRuntimeSupervisorSessionStrict: async () => {},
    getRuntimeSupervisorClientForKind: async () => remote.client,
    getRuntimeHostBackend: () => remote.client.options.backend,
    retireLegacyRuntimeSupervisorClientIfUnused: (_backend, client, result) => released.push({ client, result })
  });
  if (options.sessionSnapshot) {
    session = host.createSupervisorExecutionSession(options.sessionSnapshot, options.runtimeStoragePath);
    host.terminalSessions.set('terminal-1', session);
    host.state.nodes[0].metadata.terminal = {
      runtimeSessionId: session.sessionId, runtimeBackend: session.runtimeBackend,
      runtimeStoragePath: session.runtimeStoragePath
    };
    host.runtimeSessionBindings.set(host.buildRuntimeSessionBindingKey('terminal', session.sessionId,
      session.runtimeStoragePath, session.runtimeBackend), {
      kind: 'terminal', nodeId: 'terminal-1', runtimeSessionId: session.sessionId,
      runtimeStoragePath: session.runtimeStoragePath, runtimeBackend: session.runtimeBackend
    });
  }
  for (const surface of ['editor', 'panel']) {
    host.renderedWebviewLifecycle.set(webviews[surface], host.getSurfaceLifecycleIdentity(surface));
  }
  function send(surface, type, payload, lifecycle = host.getSurfaceLifecycleIdentity(surface), webview = webviews[surface]) {
    host.handleWebviewMessage(surface, { type, ...(payload === undefined ? {} : { payload }), lifecycle }, webview);
  }
  function ready(surface = 'editor', capability = options.readyCapability !== false, lifecycle) {
    host.activeSurface = surface;
    send(surface, 'webview/ready', capability ? { capabilities: { terminalReadSettlementV1: true } } : undefined, lifecycle);
  }
  async function open(surface = 'editor') {
    host.activeSurface = surface;
    await host.postPagedExecutionSnapshot('terminal', 'terminal-1', session, { surface });
    return posted.filter(entry => entry.surface === surface && entry.message.type === 'host/executionSnapshot').at(-1)?.message.payload.terminalRead;
  }
  function payload(read, outcome = { kind: 'applied', finalRevision: 0 }) {
    return { nodeId: 'terminal-1', kind: 'terminal', executionSessionId: read.sessionId,
      authorityId: read.authorityId, readId: read.readId, outcome };
  }
  async function closeMessage(surface, read, outcome, overrides = {}) {
    host.activeSurface = surface;
    send(surface, 'webview/closeExecutionTerminalRead', { ...payload(read, outcome), ...overrides });
    await host.waitForPendingRuntimeSupervisorOperations();
  }
  async function final(surface = 'editor', revision = options.finalRevision ?? 0) {
    await relay.completeRemote(`${surface}:terminal:terminal-1`, {
      sessionId: session.sessionId, authorityId: session.terminalAuthorityId, revision, finalRevision: revision
    });
  }
  ready();
  return { ...remote, host, relay, posted, diagnostics, released, session, webviews, send, ready, open, payload, closeMessage, final };
}

const tests = [];
const test = (name, run) => tests.push({ name, run });

test('real ready parsing retains only an explicit settlement capability', () => {
  assert.equal(parseWebviewMessage({ type: 'webview/ready' }).payload, undefined);
  assert.deepEqual(parseWebviewMessage({ type: 'webview/ready', payload: { capabilities: { terminalReadSettlementV1: true } } }).payload,
    { capabilities: { terminalReadSettlementV1: true } });
  assert.equal(parseWebviewMessage({ type: 'webview/ready', payload: { capabilities: { terminalReadSettlementV1: false } } }), null);
});

for (const missing of ['readyCapability', 'helloCapability', 'sessionCapability']) {
  test(`Host does not negotiate final application when ${missing} is absent`, async () => {
    const f = await fixture({ [missing]: false });
    const read = await f.open();
    assert.equal(f.rpc('openTerminalRead').length, 1);
    assert.equal(f.rpc('openTerminalRead')[0].params.settlementMode, undefined);
    assert.equal(read.settlementMode, undefined);
  });
}

test('Host requests the negotiated mode and refuses a descriptor without its echo', async () => {
  const accepted = await fixture();
  const read = await accepted.open();
  assert.equal(accepted.rpc('openTerminalRead')[0].params.settlementMode, mode);
  assert.equal(read.settlementMode, mode);
  const rejected = await fixture({ echoMode: false });
  await assert.rejects(rejected.open());
  assert.equal(rejected.posted.filter(entry => entry.message.type === 'host/executionSnapshot').length, 0);
});

test('wrong frame and complete-but-wrong reader identities cannot close the current reader', async () => {
  const f = await fixture();
  const read = await f.open();
  await f.final();
  f.send('editor', 'webview/closeExecutionTerminalRead', f.payload(read),
    { ...f.host.getSurfaceLifecycleIdentity('editor'), frameId: 'retired-frame' });
  await f.host.waitForPendingRuntimeSupervisorOperations();
  assert.equal(f.rpc('closeTerminalRead').length, 0);
  for (const overrides of [{ executionSessionId: 'foreign-session' }, { authorityId: 'foreign-authority' }, { readId: 'foreign-read' }]) {
    await f.closeMessage('editor', read, { kind: 'applied', finalRevision: 0 }, overrides);
    assert.equal(f.rpc('closeTerminalRead').length, 0);
  }
  await f.closeMessage('editor', read, { kind: 'applied', finalRevision: 0 });
  assert.deepEqual(f.rpc('closeTerminalRead')[0].params,
    { sessionId: read.sessionId, authorityId: read.authorityId, readId: read.readId, outcome: { kind: 'applied', finalRevision: 0 } });
});

test('malformed close outcomes are rejected by the real parser instead of downgraded to legacy close', async () => {
  const f = await fixture();
  const read = await f.open();
  for (const outcome of [{ kind: 'applied', finalRevision: -1 }, { kind: 'cancelled', reason: '' }, { kind: 'unknown' }]) {
    assert.equal(parseWebviewMessage({ type: 'webview/closeExecutionTerminalRead', payload: f.payload(read, outcome) }), null);
    await f.closeMessage('editor', read, outcome);
  }
  assert.equal(f.rpc('closeTerminalRead').length, 0);
});

for (const settlement of ['recorded', 'duplicate', 'unconfirmed']) {
  test(`relay and Host preserve the complete ${settlement} close result`, async () => {
    const f = await fixture({ closeResult: { ok: true, settlement } });
    const read = await f.open();
    await f.final();
    const result = await f.host.closeExecutionTerminalRead('editor', f.payload(read));
    assert.deepEqual(result, { ok: true, settlement });
    assert.equal(f.rpc('closeTerminalRead').length, 1);
    assert.deepEqual(f.rpc('closeTerminalRead')[0].params.outcome, { kind: 'applied', finalRevision: 0 });
  });
}

test('a close RPC error returns unconfirmed without fabricating an application acknowledgment', async () => {
  const f = await fixture({ handle: request => {
    if (request.method === 'closeTerminalRead') return Promise.reject(new Error('controlled close failure'));
  } });
  const read = await f.open();
  await f.final();
  assert.deepEqual(await f.host.closeExecutionTerminalRead('editor', f.payload(read)), { ok: true, settlement: 'unconfirmed' });
});

test('the completed Host snapshot announces the fixed zero final before exit without opening another reader', async () => {
  const f = await fixture();
  const read = await f.open();
  f.host.postTerminalAvailable('terminal', 'terminal-1', f.session);
  const ordinary = f.posted.at(-1).message;
  assert.equal(ordinary.type, 'host/executionTerminalAvailable');
  assert.equal(ordinary.payload.finalRevision, undefined);
  const snapshot = {
    sessionId: read.sessionId, kind: 'terminal', lifecycle: 'completed',
    runtimeBackend: 'legacy-detached', runtimeGuarantee: 'best-effort',
    terminalStreamPaged: true, terminalAuthorityId: read.authorityId,
    terminalRevision: 0, terminalFinalRevision: 0, outputSequence: 0,
    output: '', cols: 80, rows: 24, capabilities: { terminalReadSettlementV1: true }
  };
  await f.host.applyCompletedRuntimeSupervisorSnapshot('terminal-1', 'terminal', snapshot);
  assert.equal(f.host.terminalSessions.size, 0);
  await f.host.postExecutionExitWithFinalSnapshot('terminal', 'terminal-1', 'completed', read.sessionId, {
    snapshot, surface: 'editor', lifecycle: f.host.getSurfaceLifecycleIdentity('editor')
  });
  const terminalMessages = f.posted.map(entry => entry.message);
  const finalIndex = terminalMessages.findIndex(message => message.type === 'host/executionTerminalAvailable' &&
    message.payload.finalRevision === 0);
  const exitIndex = terminalMessages.findIndex(message => message.type === 'host/executionExit');
  assert.ok(finalIndex >= 0 && finalIndex < exitIndex);
  assert.equal(terminalMessages[finalIndex].payload.completed, true);
  assert.equal(f.rpc('openTerminalRead').length, 1);
  assert.deepEqual(await f.host.closeExecutionTerminalRead('editor', f.payload(read)), { ok: true, settlement: 'recorded' });
});

test('ordinary head and unsent final cannot be reported as applied; actual Host page delivery authorizes it', async () => {
  const f = await fixture({ headRevision: 2 });
  const read = await f.open();
  await f.closeMessage('editor', read, { kind: 'applied', finalRevision: 2 });
  assert.equal(f.rpc('closeTerminalRead').length, 0);
  await f.final('editor', 2);
  await f.closeMessage('editor', read, { kind: 'applied', finalRevision: 2 });
  assert.equal(f.rpc('closeTerminalRead').length, 0);
  f.send('editor', 'webview/readExecutionTerminalPage', {
    nodeId: 'terminal-1', kind: 'terminal', executionSessionId: read.sessionId,
    authorityId: read.authorityId, readId: read.readId, requestId: 'page-1', afterRevision: 0
  });
  await f.host.waitForPendingRuntimeSupervisorOperations();
  const posted = f.posted.find(entry => entry.message.type === 'host/executionTerminalPage');
  assert.equal(posted?.message.payload.page?.revision, 2);
  assert.equal(posted.message.payload.page.events.length, 2);
  await f.closeMessage('editor', read, { kind: 'applied', finalRevision: 2 });
  assert.equal(f.rpc('closeTerminalRead').length, 1);
  assert.deepEqual(f.rpc('closeTerminalRead')[0].params.outcome, { kind: 'applied', finalRevision: 2 });
});

test('an unconfirmed completed snapshot cancels the negotiated reader without manufacturing a final revision', async () => {
  const f = await fixture();
  const read = await f.open();
  await f.relay.completeRemote('editor:terminal:terminal-1', {
    sessionId: read.sessionId, authorityId: read.authorityId, revision: 0
  });
  await until(() => f.rpc('closeTerminalRead').length === 1, 'missing-final cancellation');
  assert.deepEqual(f.rpc('closeTerminalRead')[0].params.outcome,
    { kind: 'cancelled', reason: 'terminal-final-state-unconfirmed' });
  assert.equal(f.relay.getCompleted('editor:terminal:terminal-1'), undefined);
});

test('client references and local release notification remain pending until the remote close result', async () => {
  const gate = deferred();
  const f = await fixture({ handle: request => request.method === 'closeTerminalRead' ? gate.promise : undefined });
  const read = await f.open();
  await f.final();
  const closing = f.host.closeExecutionTerminalRead('editor', f.payload(read));
  await until(() => f.rpc('closeTerminalRead').length === 1, 'close RPC');
  assert.equal(f.relay.usesClient(f.client), true);
  assert.equal(f.released.length, 0);
  f.relay.closeMatching(() => true);
  assert.equal(f.rpc('closeTerminalRead').length, 1);
  gate.resolve({ ok: true, settlement: 'unconfirmed' });
  assert.deepEqual(await closing, { ok: true, settlement: 'unconfirmed' });
  assert.equal(f.relay.usesClient(f.client), false);
  assert.equal(f.released.length, 1);
  assert.equal(f.diagnostics.some(entry => entry.name === 'runtime/terminalReadSettled'), false);
  assert.equal(f.diagnostics.some(entry => entry.name === 'runtime/terminalReadSettlementUnconfirmed'), true);
});

test('connection loss yields unconfirmed without reconnecting or forwarding the close to another server', async () => {
  const f = await fixture();
  const read = await f.open();
  await f.final();
  f.socket.destroy();
  assert.deepEqual(await f.host.closeExecutionTerminalRead('editor', f.payload(read)), { ok: true, settlement: 'unconfirmed' });
  assert.equal(f.rpc('hello').length, 1);
  assert.equal(f.rpc('closeTerminalRead').length, 0);
  assert.equal(f.relay.usesClient(f.client), false);
  assert.equal(f.diagnostics.some(entry => entry.name === 'runtime/terminalReadSettled'), false);
});

test('an in-flight open cancelled by a new frame closes its original descriptor once it arrives', async () => {
  const gate = deferred();
  let opened;
  const f = await fixture({ handle: (request, descriptor) => {
    if (request.method === 'openTerminalRead') { opened = descriptor(request.params); return gate.promise; }
  } });
  const opening = f.open();
  await until(() => opened !== undefined, 'open RPC');
  f.ready('editor', true, { ...f.host.getSurfaceLifecycleIdentity('editor'), frameId: 'editor-frame-2' });
  assert.equal(f.rpc('closeTerminalRead').length, 0);
  gate.resolve(opened);
  assert.equal(await opening, undefined);
  await until(() => f.rpc('closeTerminalRead').length === 1, 'late descriptor cancellation');
  const close = f.rpc('closeTerminalRead')[0].params;
  assert.equal(close.readId, opened.readId);
  assert.equal(close.sessionId, opened.sessionId);
  assert.equal(close.authorityId, opened.authorityId);
  assert.equal(close.outcome.kind, 'cancelled');
  assert.ok(close.outcome.reason);
  assert.equal(f.posted.filter(entry => entry.message.type === 'host/executionSnapshot').length, 0);
});

test('ready capability changes cancel the established reader even when its frame identity is unchanged', async () => {
  const f = await fixture();
  const old = await f.open();
  f.ready('editor', false);
  await until(() => f.rpc('closeTerminalRead').length === 1, 'capability-change cancellation');
  assert.equal(f.rpc('closeTerminalRead')[0].params.readId, old.readId);
  assert.equal(f.rpc('closeTerminalRead')[0].params.outcome.kind, 'cancelled');
  const legacy = await f.open();
  assert.equal(legacy.settlementMode, undefined);
  assert.equal(f.rpc('openTerminalRead').at(-1).params.settlementMode, undefined);
});

test('two surfaces retain independent reader identities and only close their own projection', async () => {
  const f = await fixture();
  const editor = await f.open('editor');
  f.ready('panel');
  const panel = await f.open('panel');
  assert.notEqual(editor.readId, panel.readId);
  await f.final('editor');
  await f.final('panel');
  await f.closeMessage('editor', editor, { kind: 'applied', finalRevision: 0 });
  assert.equal(f.rpc('closeTerminalRead').length, 1);
  assert.equal(f.rpc('closeTerminalRead')[0].params.readId, editor.readId);
  await f.closeMessage('panel', editor, { kind: 'applied', finalRevision: 0 });
  assert.equal(f.rpc('closeTerminalRead').length, 1);
  await f.closeMessage('panel', panel, { kind: 'cancelled', reason: 'panel-hidden' });
  assert.equal(f.rpc('closeTerminalRead').length, 2);
  assert.equal(f.rpc('closeTerminalRead')[1].params.readId, panel.readId);
  assert.deepEqual(f.rpc('closeTerminalRead')[1].params.outcome, { kind: 'cancelled', reason: 'panel-hidden' });
});

test('real Supervisor, client, Host and headless projection settle only after the actual tail write callback', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dsc-reader-wire-'));
  const deadlines = new Set();
  const scheduler = {
    now: () => Date.now(), scheduleTask: callback => queueMicrotask(callback),
    scheduleDeadline(at, callback) {
      const timer = setTimeout(() => { deadlines.delete(timer); callback(); }, Math.max(0, at - Date.now()));
      deadlines.add(timer);
      return () => { clearTimeout(timer); deadlines.delete(timer); };
    }
  };
  let provider;
  const server = new RuntimeSupervisorServer({ storageDir: directory, registryPath: path.join(directory, 'registry.json') },
    'legacy-detached', 'best-effort', {
      kind: 'non-native', capabilities: ['execution-lifecycle-v1', 'terminal-read-settlement-v1'], scheduler,
      budgets: { startMs: 500, gracefulMs: 100, forceMs: 100, cancelMs: 100, settleMs: 100 },
      createTransport(identity) {
        provider = {
          frameId: 0,
          connect(sink) {
            this.sink = sink;
            sink.message({ type: 'ready', identity, capabilities: ['execution-lifecycle-v1'] });
          },
          async send(message) {
            queueMicrotask(() => {
              if (message.type === 'start') {
                this.fact({ type: 'resourceAcquired', resourceId: 'subject' });
                this.fact({ type: 'operationObservation', operationId: message.operationId,
                  result: { kind: 'started', pid: 100 } });
              } else {
                this.fact({ type: 'operationObservation', operationId: message.operationId, result: { kind: 'accepted' } });
              }
            });
          },
          fact(message) { this.sink.message({ ...message, identity }); },
          output(text) { this.sink.data(encodeOutputFrame({ version: 1, identity, frameId: ++this.frameId, text })); },
          finish() {
            this.fact({ type: 'processResult', result: { kind: 'exited', exitCode: 0 } });
            this.fact({ type: 'sourceEnd', finalFrameId: this.frameId, disposition: { kind: 'eof' } });
            this.fact({ type: 'resourceResult', resourceId: 'subject', operationId: 'release-subject', result: { kind: 'released' } });
            this.sink.controlResourceResult({ kind: 'released' });
          }
        };
        return provider;
      }
    });
  server.schedulePersist = () => {};
  const replies = new Map();
  let remote;
  const serverSocket = new EventEmitter();
  serverSocket.destroyed = false;
  serverSocket.write = line => {
    const message = JSON.parse(String(line));
    if (message.type === 'response') replies.set(message.id, message);
    else remote?.socket.emit('data', line);
    return true;
  };
  server.connections.add(serverSocket);
  for (const map of [server.subscriptions, server.deferredSubscriptionRevisions, server.terminalReads, server.appliedRevisionAcks]) {
    map.set(serverSocket, new Map());
  }
  const { Terminal } = require('@xterm/headless');
  const terminal = new Terminal({ cols: 80, rows: 24, scrollback: 100, allowProposedApi: true });
  let f;
  let projection;
  let session;
  let releaseTail;
  let initialPageApplied = false;
  const stateOperations = [];
  const exits = [];
  const callbacks = [];
  try {
    remote = await controlledClient({ handle: async request => {
      await server.handleRequest(serverSocket, request);
      const response = replies.get(request.id);
      replies.delete(request.id);
      assert.ok(response, `Supervisor must publish the ${request.method} response`);
      if (!response.ok) throw new Error(response.error.message);
      return response.result;
    } });
    const live = await remote.client.createSession({
      sessionId: '40000000-0000-4000-8000-000000000020', kind: 'terminal', launchMode: 'start',
      displayLabel: 'Reader integration', scrollback: 100, terminalStreamMode: 'paged-until-exit',
      launchSpec: { file: '/not-executed', args: [], cwd: directory, env: {}, cols: 80, rows: 24 }
    });
    session = server.sessions.get(live.sessionId);
    assert.equal(live.capabilities.terminalReadSettlementV1, true);
    f = await fixture({ remote, sessionSnapshot: live, runtimeStoragePath: directory, onHostMessage: message => {
      const p = message.payload;
      if (message.type === 'host/executionSnapshot' && p.terminalRead) projection.start(p.terminalRead);
      if (message.type === 'host/executionTerminalAvailable') {
        projection.available(p.executionSessionId, p.authorityId, p.revision, p.completed, p.finalRevision);
      }
      if (message.type === 'host/executionTerminalPage') projection.accept(p.readId, p.requestId, p.page,
        p.readClosed ? p.error : undefined);
      if (message.type === 'host/executionExit') projection.showExit(p.message, p.executionSessionId);
    } });
    f.host.deleteRuntimeSupervisorSessionStrict = async (reference, options) => {
      await remote.client.deleteSession({ sessionId: reference.sessionId, preserveTerminalReads: options.preserveTerminalReads });
    };
    remote.client.options.onSessionState = snapshot => {
      if (!snapshot.live) {
        const operation = f.host.handleRuntimeSupervisorState('legacy-detached', directory, snapshot);
        void operation.catch(() => {});
        stateOperations.push(operation);
      }
    };
    projection = new TerminalPagedProjection({
      request(read, afterRevision, requestId) {
        f.send('editor', 'webview/readExecutionTerminalPage', {
          nodeId: 'terminal-1', kind: 'terminal', executionSessionId: read.sessionId,
          authorityId: read.authorityId, readId: read.readId, afterRevision, requestId
        });
      },
      close(read, outcome) { f.send('editor', 'webview/closeExecutionTerminalRead', f.payload(read, outcome)); },
      checkpoint(read, current, done) {
        terminal.write(read.checkpoint.serializedState.data, () => done(current()));
      },
      events(events, current, done) {
        assert.equal(events.every(event => event.type === 'output'), true);
        terminal.write(events.map(event => event.data).join(''), () => {
          if (events.length) {
            callbacks.push('tail-write-complete');
            releaseTail = () => done(current());
          } else { initialPageApplied = true; done(current()); }
        });
      },
      exit(message) { exits.push(message); }
    });
    const read = await f.open();
    assert.equal(read.settlementMode, mode);
    await until(() => initialPageApplied, 'initial real xterm page callback');
    provider.output('last-line\r\n\x1b[3;7H');
    await until(() => session.ownedExecution.snapshot().adapter.consumedThrough === 1, 'Supervisor tail consumption');
    provider.finish();
    await until(() => releaseTail !== undefined, 'actual headless tail write callback');
    const messages = f.posted.map(entry => entry.message);
    const finalIndex = messages.findIndex(message => message.type === 'host/executionTerminalAvailable' &&
      message.payload.finalRevision === 1);
    const tailIndex = messages.findIndex(message => message.type === 'host/executionTerminalPage' &&
      message.payload.page?.revision === 1);
    assert.ok(finalIndex >= 0 && tailIndex > finalIndex, 'fixed final must reach the projection before the tail page');
    assert.deepEqual(callbacks, ['tail-write-complete']);
    assert.equal(terminal.buffer.active.getLine(0).translateToString(true), 'last-line');
    assert.equal(terminal.buffer.active.cursorX, 6);
    assert.equal(terminal.buffer.active.cursorY, 2);
    assert.equal(remote.rpc('closeTerminalRead').length, 0);
    assert.equal(session.ownedReaderResults.applied, 0);
    assert.equal(session.ownedExecution.snapshot().retired, false);
    assert.equal(server.executionOwner.snapshot().pending, 1);
    releaseTail();
    await until(() => f.diagnostics.some(entry => entry.name === 'runtime/terminalReadSettled'), 'end-to-end recorded result');
    await Promise.all(stateOperations);
    await f.host.waitForPendingRuntimeSupervisorOperations();
    await until(() => !server.sessions.has(live.sessionId), 'completed Supervisor session retirement');
    assert.deepEqual(remote.rpc('closeTerminalRead').map(request => request.params.outcome), [{ kind: 'applied', finalRevision: 1 }]);
    assert.equal(session.ownedReaderResults.applied, 1);
    assert.equal(session.ownedReaderResults.cancelled, 0);
    assert.equal(session.ownedReaderResults.lost, 0);
    assert.equal(session.ownedExecution.snapshot().retired, true);
    assert.equal(server.executionOwner.snapshot().pending, 0);
    assert.equal(exits.length, 1);
  } finally {
    projection?.stop();
    releaseTail?.();
    remote?.client.dispose();
    serverSocket.destroyed = true;
    server.cleanupSocket(serverSocket);
    server.clearIdleShutdownTimer();
    for (const timer of deadlines) clearTimeout(timer);
    if (session) {
      if (session.lifecycleTimer) clearTimeout(session.lifecycleTimer);
      await session.terminalOperationChain.catch(() => undefined);
      if (server.sessions.has(session.sessionId)) await session.terminalJournal.flush();
      session.terminalStateTracker.dispose();
    }
    if (f) for (const managed of f.host.terminalSessions.values()) f.host.disposeManagedExecutionSession(managed);
    terminal.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

try {
  for (const { name, run } of tests) {
    let timer;
    try {
      await Promise.race([run(), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Reader wiring case timed out: ${name}`)), 3000);
      })]);
      assert.deepEqual(forbiddenAcquisitions, [], 'no native acquisition or reconnect attempt may be hidden by error handling');
      console.log(`ok - ${name}`);
    } finally { clearTimeout(timer); }
  }
  console.log(`runtime reader settlement wiring: ${tests.length}/${tests.length} passed (no native or real sockets)`);
} finally {
  for (const client of clients) client.dispose();
}
