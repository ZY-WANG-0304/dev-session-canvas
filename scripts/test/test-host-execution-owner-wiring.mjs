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

async function until(clock, condition, label) {
  await pump(clock, condition);
  assert.equal(condition(), true, `${label} did not complete within 100 scheduler turns`);
}

async function completed(clock, promise, label) {
  let outcome;
  promise.then(value => { outcome = { value }; }, error => { outcome = { error }; });
  await until(clock, () => outcome !== undefined, label);
  if (outcome.error) throw outcome.error;
  return outcome.value;
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
  const persisted = [];
  const rootWrites = [];
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
    postMessage() {}, postState() {}, persistState: detail => persisted.push(detail), notifySidebarStateChanged() {},
    waitForPendingRuntimeSupervisorOperations: async () => {},
    flushAllExecutionSessionStatesForHostBoundary: async () => {},
    flushDeferredCanvasStatePersist: async () => {}, waitForPendingWorkspaceStateUpdates: async () => {},
    collectPersistedLiveRuntimeSessions: () => [], clearPendingTerminalInitialInputs() {},
    disposeRuntimeSupervisorClients() {}, getAgentCliConfig: () => ({ defaultProvider: 'codex' }),
    getMultiRootWorkspaceFoldersForComposition: () => options.roots ?? [],
    dropPendingTerminalInitialInput() {},
    writeRootLocalCanvasSnapshot: (rootPath, state) => rootWrites.push({ rootPath, state })
  });
  function start(kind) {
    return kind === 'agent'
      ? host.startAgentSession('agent-1', 80, 24, false)
      : host.startTerminalSession('terminal-1', 80, 24);
  }
  function record(kind) { return host.nonNativeHostExecutions.get(`${kind}:${kind}-1`); }
  async function started(kind) {
    await completed(clock, start(kind), `${kind} real Host start`);
    assert.equal(providers.length, 1, `${kind} start must reach the injected provider`);
    assert.equal(providers[0].messages[0].type, 'start');
    return { record: record(kind), provider: providers[0] };
  }
  return { host, owner, injection, clock, providers, diagnostics, persisted, rootWrites, start, started, record, nodes };
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
  test(`${kind} real Host tracker drains accepted batches before freezing its final revision`, async () => {
    const f = fixture();
    const { record, provider } = await f.started(kind);
    const gate = deferred();
    const flush = record.tracker.flush.bind(record.tracker);
    let flushes = 0;
    record.tracker.flush = async () => {
      if (++flushes === 1) await gate.promise;
      return flush();
    };
    try {
      provider.process();
      for (let frame = 1; frame <= 10; frame += 1) provider.output(frame, `${kind}-tail-${frame}\r\n`);
      // sourceEnd is valid only after the provider observes acceptance of its full tail.
      await until(f.clock, () => record.execution.snapshot().adapter.acceptedThrough === 10, `${kind} acceptance`);
      provider.seal(10);
      provider.release();
      await pump(f.clock);
      assert.equal(record.execution.snapshot().adapter.seal.lastDataSequence, 10);
      assert.equal(record.execution.snapshot().adapter.consumedThrough, 0);
      assert.equal(record.finalRevision, undefined);
      assert.equal(record.readerAdmissionClosed, false);
      assert.equal(record.execution.snapshot().settled, false);
      assert.equal(flushes, 1);
      gate.resolve();
      await until(f.clock, () => record.execution.snapshot().settled, `${kind} terminal completion`);
      assert.match(record.tracker.getSerializedState().data, new RegExp(`${kind}-tail-10`));
      assert.equal(record.finalRevision, 10);
      assert.equal(record.execution.snapshot().terminal.finalRevision, 10);
      assert.equal(record.readerAdmissionClosed, true);
      assert.equal(flushes, 4, 'three real consumer flushes must precede the final tracker flush');
      assert.equal(record.execution.snapshot().readerOutcome, 'pending');
      assert.equal(f.record(kind), record, 'final tracker remains owned until reader cancellation or loss');
      assert.equal(f.owner.snapshot().pending, 1);
      record.execution.settleReaders('cancelled');
      assert.equal(f.owner.snapshot().pending, 0);
      assert.equal(f.record(kind), undefined);
    } finally {
      gate.resolve();
      record.tracker.dispose();
    }
  });

  test(`${kind} stop waits for facts while tail consumption continues; delete releases only the reader`, async () => {
    const f = fixture();
    const { record, provider } = await f.started(kind);
    let stopped = false;
    const stop = f.host.stopExecutionSession(kind, `${kind}-1`).then(() => { stopped = true; });
    try {
      await until(f.clock, () => provider.messages.some(message => message.type === 'requestStop'), `${kind} stop request`);
      assert.equal(stopped, false, 'accepted stop is not a process or resource result');
      assert.equal(record.execution.snapshot().readerOutcome, 'pending');
      provider.output(1, `${kind}-stop-tail`);
      await until(f.clock, () => record.execution.snapshot().adapter.consumedThrough === 1, `${kind} consumption during stop`);
      provider.process();
      provider.seal(1);
      await pump(f.clock);
      assert.equal(stopped, false, 'process and source results cannot replace resource release');
      assert.equal(record.finalRevision, 1);
      provider.release();
      await completed(f.clock, stop, `${kind} stop settlement`);
      assert.equal(f.record(kind), record);
      assert.equal(record.execution.snapshot().readerOutcome, 'pending');
      assert.match(record.tracker.getSerializedState().data, new RegExp(`${kind}-stop-tail`));
      await completed(f.clock, f.host.terminateExecutionNodeForDeletion(f.nodes.find(node => node.kind === kind)), `${kind} deletion`);
      assert.equal(record.execution.snapshot().readerOutcome, 'cancelled');
      assert.equal(f.record(kind), undefined);
      assert.equal(f.owner.snapshot().pending, 0);
      assert.equal(provider.messages.filter(message => message.type === 'requestStop').length, 1);
    } finally { record.tracker.dispose(); }
  });

  test(`${kind} deletion retains the tracker until active resource settlement`, async () => {
    const f = fixture();
    const { record, provider } = await f.started(kind);
    let deleted = false;
    const deletion = f.host.terminateExecutionNodeForDeletion(f.nodes.find(node => node.kind === kind))
      .then(() => { deleted = true; });
    try {
      await until(f.clock, () => provider.messages.some(message => message.type === 'requestStop'), `${kind} delete stop`);
      assert.equal(record.execution.snapshot().readerOutcome, 'cancelled');
      assert.equal(deleted, false);
      provider.output(1, `${kind}-delete-tail`);
      await until(f.clock, () => record.execution.snapshot().adapter.acceptedThrough === 1, `${kind} delete acceptance`);
      provider.process();
      provider.seal(1);
      await until(f.clock, () => record.finalRevision === 1, `${kind} delete final flush`);
      assert.equal(deleted, false);
      assert.equal(f.record(kind), record);
      assert.match(record.tracker.getSerializedState().data, new RegExp(`${kind}-delete-tail`));
      provider.release();
      await completed(f.clock, deletion, `${kind} delete resource settlement`);
      assert.equal(f.record(kind), undefined);
      assert.equal(f.owner.snapshot().pending, 0);
    } finally { record.tracker.dispose(); }
  });

  for (const failure of ['consumer', 'final']) {
    test(`${kind} ${failure} tracker flush failure retains unknown responsibility without cached success`, async () => {
      const f = fixture();
      const { record, provider } = await f.started(kind);
      try {
        if (failure === 'final') {
          provider.output(1, `${kind}-consumed`);
          await until(f.clock, () => record.execution.snapshot().adapter.consumedThrough === 1, `${kind} initial real flush`);
        }
        let failedFlushes = 0;
        record.tracker.flush = async () => { failedFlushes += 1; throw new Error(`${failure} tracker failure`); };
        if (failure === 'consumer') {
          provider.output(1, `${kind}-unapplied`);
          await until(f.clock, () => record.execution.snapshot().adapter.acceptedThrough === 1, `${kind} failed-consumer acceptance`);
        }
        provider.process();
        provider.seal(1);
        provider.release();
        await until(f.clock, () => record.execution.snapshot().terminal?.kind === 'failed', `${kind} ${failure} failure`);
        assert.equal(failedFlushes, 1);
        assert.equal(record.finalRevision, undefined);
        assert.equal(record.execution.snapshot().settled, false);
        assert.equal(record.execution.snapshot().adapter.consumedThrough, failure === 'final' ? 1 : 0);
        record.execution.settleReaders('cancelled');
        assert.equal(f.record(kind), record);
        assert.equal(f.owner.snapshot().pending, 1);
        await assert.rejects(f.start(kind), /admission is closed/);
        assert.equal(f.providers.length, 1);
      } finally { record.tracker.dispose(); }
    });
  }

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

for (const scope of ['single-root', 'multi-root']) {
  const roots = scope === 'single-root' ? [] : [
    { path: '/controlled/root-a', name: 'root-a' },
    { path: '/controlled/root-b', name: 'root-b' }
  ];
  test(`${scope} real reset preserves state and owner when preparation cleanup is unknown`, async () => {
    const f = fixture({ roots });
    const before = f.host.state;
    const stateSnapshot = structuredClone(before);
    const execution = f.owner.reserve('terminal:terminal-1');
    const reset = f.host.resetState({ reason: 'owner-test' });
    const result = scope === 'single-root' ? assert.rejects(reset, /cleanup is unconfirmed/) : reset;
    assert.equal(f.owner.snapshot().closing, true);
    assert.equal(execution.snapshot().readerOutcome, 'cancelled');
    f.clock.advance(40);
    await completed(f.clock, result, `${scope} unknown reset result`);
    assert.equal(f.host.state, before);
    assert.deepEqual(f.host.state, stateSnapshot);
    assert.equal(f.host.nonNativeExecutionOwner, f.owner);
    assert.equal(f.owner.get('terminal:terminal-1'), execution);
    assert.equal(f.owner.snapshot().pending, 1);
    assert.equal(f.owner.snapshot().closing, true);
    assert.equal(f.persisted.length, 0);
    assert.equal(f.rootWrites.length, 0);
    await assert.rejects(f.start('terminal'), /admission is closed/);
    await assert.rejects(f.start('agent'), /admission is closed/);
    assert.equal(f.providers.length, 0);
    execution.abandon('late preparation cleanup');
    assert.equal(f.owner.snapshot().pending, 0);
    assert.equal(f.owner.tryResume(), false, 'late evidence cannot undo the first unknown close');
  });

  test(`${scope} successful real reset resumes the same owner only after reservation cleanup`, async () => {
    const f = fixture({ roots });
    const execution = f.owner.reserve('terminal:terminal-1');
    let resetReturned = false;
    const reset = f.host.resetState({ reason: 'owner-test' }).then(() => { resetReturned = true; });
    assert.equal(f.owner.snapshot().closing, true);
    assert.equal(resetReturned, false);
    assert.equal(f.persisted.length, 0);
    assert.equal(f.rootWrites.length, 0);
    execution.abandon('preparation cleanup complete');
    await completed(f.clock, reset, `${scope} successful reset`);
    assert.equal(f.host.nonNativeExecutionOwner, f.owner);
    assert.equal(f.owner.snapshot().pending, 0);
    assert.equal(f.owner.snapshot().closing, false);
    assert.equal(f.persisted.length, 1);
    assert.deepEqual(f.rootWrites.map(write => write.rootPath), roots.map(root => root.path));
    assert.equal(f.host.state.nodes.length, 0);
    f.host.state.nodes.push({ id: 'terminal-1', kind: 'terminal', metadata: {} });
    const { record, provider } = await f.started('terminal');
    try {
      assert.notEqual(record.execution.identity.executionId, execution.identity.executionId);
      provider.process();
      provider.seal(0);
      provider.release();
      await until(f.clock, () => record.execution.snapshot().settled, `${scope} post-reset completion`);
      record.execution.settleReaders('cancelled');
    } finally { record.tracker.dispose(); }
  });
}

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
  let timeout;
  try {
    await Promise.race([
      run(),
      new Promise((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(`${name}: test exceeded 3000 ms`)), 3000);
      })
    ]);
  } finally { clearTimeout(timeout); }
  console.log(`ok - ${name}`);
}
console.log(`Host execution owner wiring: ${tests.length}/${tests.length} passed (non-native only).`);
