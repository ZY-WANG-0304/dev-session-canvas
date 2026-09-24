import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import esbuild from 'esbuild';

// Load the actual class without activation, source rewriting or a native process boundary.
const bundled = await esbuild.build({
  stdin: {
    contents: `
      export { CanvasPanelManager } from './extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager';
      export { ExecutionOwnerLifecycle } from './extensions/vscode/dev-session-canvas/src/panel/executionOwnerLifecycle';
      export { encodeOutputFrame } from './extensions/vscode/dev-session-canvas/src/common/executionLifecycle';
    `,
    resolveDir: process.cwd(), sourcefile: 'host-owner-wiring-entry.ts'
  },
  bundle: true, write: false, platform: 'node', format: 'cjs', target: 'node18', external: ['node-pty'],
  plugins: [{
    name: 'host-boundaries-only',
    setup(build) {
      build.onResolve({ filter: /^(vscode|node-pty|(?:node:)?child_process)$/ }, args => ({
        path: args.path, namespace: 'host-boundary'
      }));
      build.onLoad({ filter: /.*/, namespace: 'host-boundary' }, args => ({
        loader: 'js', contents: args.path === 'vscode' ? `
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
        ` : `
          function blocked() { throw new Error('Native process creation is forbidden in the Host owner test'); }
          module.exports = { spawn: blocked, spawnSync: blocked, fork: blocked,
            exec: blocked, execSync: blocked, execFile: blocked, execFileSync: blocked };
        `
      }));
    }
  }]
});
const loaded = { exports: {} };
new Function('require', 'module', 'exports', '__filename', '__dirname', bundled.outputFiles[0].text)(
  createRequire(import.meta.url), loaded, loaded.exports,
  path.resolve('scripts/test/host-owner-wiring.cjs'), path.resolve('scripts/test')
);
const { CanvasPanelManager, ExecutionOwnerLifecycle, encodeOutputFrame } = loaded.exports;

function deferred() {
  let resolve;
  const promise = new Promise(value => { resolve = value; });
  return { promise, resolve };
}

function scheduler() {
  let now = 0;
  const tasks = [];
  const deadlines = new Set();
  return {
    now: () => now,
    scheduleTask: task => tasks.push(task),
    scheduleDeadline(at, run) {
      const item = { at, run };
      deadlines.add(item);
      return () => deadlines.delete(item);
    },
    tick() { const task = tasks.shift(); task?.(); return Boolean(task); },
    advance(at) {
      now = at;
      for (const item of [...deadlines].sort((a, b) => a.at - b.at)) {
        if (item.at <= now && deadlines.delete(item)) item.run();
      }
    }
  };
}

async function pump(clock, condition = () => false) {
  for (let turn = 0; turn < 100; turn += 1) {
    clock.tick();
    await new Promise(resolve => setTimeout(resolve, 0));
    if (condition()) return;
  }
}

function fixture(options = {}) {
  const clock = scheduler();
  const providers = [];
  const injection = {
    kind: 'non-native', capabilities: options.capabilities ?? ['execution-lifecycle-v1'], scheduler: clock,
    budgets: { startMs: 10, gracefulMs: 10, forceMs: 10, cancelMs: 10, settleMs: 10 },
    createTransport(identity) {
      const messages = [];
      let sink;
      const provider = {
        identity, messages,
        message(message) { sink.message({ ...message, identity }); },
        output(frameId, text) { sink.data(encodeOutputFrame({ version: 1, identity, frameId, text })); },
        process() { this.message({ type: 'processResult', result: { kind: 'exited', exitCode: 7 } }); },
        seal(finalFrameId) {
          this.message({ type: 'sourceEnd', finalFrameId, disposition: { kind: 'eof' } });
          sink.dataEnded();
        },
        release() { sink.controlResourceResult({ kind: 'released' }); sink.exited(); },
        transport: {
          connect(value) {
            sink = value;
            provider.message({ type: 'ready', capabilities: ['execution-lifecycle-v1'] });
          },
          async send(message) {
            messages.push(message);
            if (message.type === 'start') {
              provider.message({ type: 'operationObservation', operationId: message.operationId,
                result: { kind: 'started', pid: 123 } });
            } else if (message.type === 'requestStop' || message.type === 'cancelOutput') {
              provider.message({ type: 'operationObservation', operationId: message.operationId,
                result: { kind: 'accepted' } });
            }
          }
        }
      };
      providers.push(provider);
      return provider.transport;
    }
  };
  const owner = new ExecutionOwnerLifecycle(injection);
  const host = Object.create(CanvasPanelManager.prototype);
  const diagnostics = [];
  const nodes = [
    { id: 'terminal-1', kind: 'terminal', metadata: {} },
    { id: 'agent-1', kind: 'agent', metadata: {} }
  ];
  Object.assign(host, {
    context: { extensionMode: 3 },
    nonNativeExecutionOwner: owner, nonNativeHostExecutions: new Map(),
    agentSessions: new Map(), terminalSessions: new Map(), runtimeSessionBindings: new Map(),
    executionSessionOperationTokens: new Map(), activeAssociatedNoteMarkdownEdits: new Map(),
    state: { nodes, edges: [], groups: [] },
    terminalProjectionRefreshScheduler: { clearMatching() {} },
    assertExecutionAllowed: () => true,
    getExecutionNodeCwd: () => '/controlled', describeUnavailableExecutionCwd: () => undefined,
    getTerminalShellPath: () => '/controlled/shell', getTerminalShellArgs: () => ['--controlled'],
    getTerminalScrollback: () => 100, isRuntimePersistenceEnabled: () => false,
    resolveExecutionEnvironment: options.environment ?? (async () => ({ TEST: 'value', ABSENT: undefined })),
    resolveAgentFreshLaunch: () => ({ commandLine: 'controlled-agent', requestedCommand: 'controlled-agent', launchArgs: [], launchPreset: 'default' }),
    getRequestedAgentCliSpec: () => ({ command: '/controlled/agent', requestedCommand: 'controlled-agent', provider: 'codex' }),
    resolveAgentCli: async () => ({ command: '/controlled/agent', provider: 'codex' }),
    resolveAgentResumeContext: () => ({ supported: false, strategy: 'none' }),
    buildAgentDisplayLaunchCommandLine: () => 'controlled-agent',
    recordDiagnosticEvent: (name, detail) => diagnostics.push({ name, detail }),
    postMessage() {}, postState() {}, persistState() {}, notifySidebarStateChanged() {},
    waitForPendingRuntimeSupervisorOperations: async () => {},
    flushAllExecutionSessionStatesForHostBoundary: async () => {},
    flushDeferredCanvasStatePersist: async () => {}, waitForPendingWorkspaceStateUpdates: async () => {},
    collectPersistedLiveRuntimeSessions: () => [], clearPendingTerminalInitialInputs() {},
    disposeRuntimeSupervisorClients() {}, getAgentCliConfig: () => ({ defaultProvider: 'codex' }),
    getMultiRootWorkspaceFoldersForComposition: () => options.roots ?? [],
    dropPendingTerminalInitialInput() {}, writeRootLocalCanvasSnapshot() {}
  });
  function start(kind) {
    return kind === 'agent'
      ? host.startAgentSession('agent-1', 80, 24, false)
      : host.startTerminalSession('terminal-1', 80, 24);
  }
  function record(kind) { return host.nonNativeHostExecutions.get(`${kind}:${kind}-1`); }
  return { host, owner, injection, clock, providers, diagnostics, start, record, nodes };
}

const tests = [];
const test = (name, run) => tests.push({ name, run });

test('constructor injection requires strict Test mode, not a smoke environment override', () => {
  const f = fixture();
  const previous = process.env.DEV_SESSION_CANVAS_SMOKE_TEST_MODE;
  process.env.DEV_SESSION_CANVAS_SMOKE_TEST_MODE = '1';
  try {
    assert.throws(() => new CanvasPanelManager({ extensionMode: 1 }, f.injection), /requires VS Code test mode/);
    assert.throws(() => new CanvasPanelManager({ extensionMode: 2 }, f.injection), /requires VS Code test mode/);
    assert.equal(f.providers.length, 0);
  } finally {
    if (previous === undefined) delete process.env.DEV_SESSION_CANVAS_SMOKE_TEST_MODE;
    else process.env.DEV_SESSION_CANVAS_SMOKE_TEST_MODE = previous;
  }
});

for (const kind of ['terminal', 'agent']) {
  test(`${kind} reserves before async preparation; boundary prevents late start and waits cleanup`, async () => {
    const gate = deferred();
    const f = fixture({ environment: () => gate.promise });
    const start = f.start(kind);
    await new Promise(resolve => setTimeout(resolve, 0));
    if (f.owner.snapshot().pending === 0) await start;
    const rejected = assert.rejects(start, /admission is closed/);
    assert.equal(f.owner.snapshot().pending, 1);
    const record = f.record(kind);
    let closed = false;
    const close = f.host.prepareForHostBoundary({ preserveLiveRuntime: true, allowRuntimeSupervisorRestart: false })
      .then(() => { closed = true; });
    assert.equal(f.owner.snapshot().closing, true);
    assert.equal(record.execution.snapshot().readerOutcome, 'lost');
    await pump(f.clock);
    assert.equal(closed, false);
    assert.equal(f.providers.length, 0);
    gate.resolve({});
    await rejected;
    await close;
    assert.equal(f.owner.snapshot().pending, 0);
    assert.equal(f.host.nonNativeHostExecutions.size, 0);
    assert.equal(f.providers.length, 0);
  });

}

test('missing capability rejects both real start entries before transport creation', async () => {
  const f = fixture({ capabilities: [] });
  await assert.rejects(f.start('terminal'), /capability is required/);
  await assert.rejects(f.start('agent'), /capability is required/);
  assert.equal(f.providers.length, 0);
  assert.equal(f.owner.snapshot().pending, 0);
});

test('live Host departure only detaches and never sends supervisor stop or delete', async () => {
  const f = fixture();
  const supervisorSession = { owner: 'supervisor', runtimeSessionId: 'live-runtime' };
  f.host.terminalSessions.set('terminal-1', supervisorSession);
  let detached = 0;
  f.host.collectPersistedLiveRuntimeSessions = () => assert.fail('live boundary must not collect for deletion');
  f.host.deleteRuntimeSupervisorSessions = () => assert.fail('live boundary must not delete');
  f.host.getRuntimeSupervisorClientForKind = () => assert.fail('live boundary must not stop');
  f.host.disposeExecutionSession = () => assert.fail('live boundary must not kill');
  f.host.disposeRuntimeSupervisorClients = () => { detached += 1; };
  await f.host.prepareForHostBoundary({ preserveLiveRuntime: true, allowRuntimeSupervisorRestart: false });
  assert.equal(detached, 1);
  assert.equal(f.host.terminalSessions.size, 0);
  assert.equal(f.providers.length, 0);
});

for (const { name, run } of tests) {
  await run();
  console.log(`ok - ${name}`);
}
console.log(`Host execution owner wiring: ${tests.length}/${tests.length} passed (non-native only).`);
