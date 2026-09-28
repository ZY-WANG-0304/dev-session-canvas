import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import esbuild from 'esbuild';
import ts from 'typescript';

// Load the actual class without activation, source rewriting or a native process boundary.
const bundled = await esbuild.build({
  stdin: {
    contents: `
      export { CanvasPanelManager } from './extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager';
      export { ExecutionOwnerLifecycle } from './extensions/vscode/dev-session-canvas/src/panel/executionOwnerLifecycle';
      export { encodeOutputFrame } from './extensions/vscode/dev-session-canvas/src/common/executionLifecycle';
      export { EXECUTION_CANDIDATE_PROFILE, EXECUTION_CANDIDATE_BUDGETS } from './extensions/vscode/dev-session-canvas/src/common/executionLifecycle';
      export { RuntimeTerminalReadRelay } from './extensions/vscode/dev-session-canvas/src/panel/runtimeTerminalReadRelay';
      export { TerminalAvailableNotifications } from './extensions/vscode/dev-session-canvas/src/panel/terminalAvailableNotifications';
      export { parseWebviewMessage } from './extensions/vscode/dev-session-canvas/src/common/protocol';
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
const { CanvasPanelManager, ExecutionOwnerLifecycle, encodeOutputFrame,
  RuntimeTerminalReadRelay, TerminalAvailableNotifications, parseWebviewMessage, EXECUTION_CANDIDATE_PROFILE, EXECUTION_CANDIDATE_BUDGETS } = loaded.exports;

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
    elapse(at) { now = at; },
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
    budgets: { startMs: 10, gracefulMs: 10, forceMs: 10, cancelMs: 10, settleMs: 10, ...options.budgets },
    createTransport(identity) {
      const messages = [];
      const parentClosed = deferred();
      const cleanupResult = deferred();
      const cleanupRequests = [];
      let sink;
      const provider = {
        identity, messages, cleanupResult, cleanupRequests,
        message(message) { sink.message({ ...message, identity }); },
        output(frameId, text) { sink.data(encodeOutputFrame({ version: 1, identity, frameId, text })); },
        process() { this.message({ type: 'processResult', result: { kind: 'exited', exitCode: 7 } }); },
        seal(finalFrameId) {
          this.message({ type: 'sourceEnd', finalFrameId, disposition: { kind: 'eof' } });
          sink.dataEnded();
        },
        release() {
          sink.controlResourceResult({ kind: 'released' }); sink.exited();
          parentClosed.resolve({ kind: 'closed', exitCode: 0, signal: null });
        },
        transport: {
          connect(value) {
            sink = value;
            provider.message({ type: 'ready', capabilities: ['execution-lifecycle-v1'] });
          },
          async send(message) {
            messages.push(message);
            if (message.type === 'start') {
              if (options.exposeParentControl) provider.message({ type: 'resourceAcquired', resourceId: 'subject' });
              provider.message({ type: 'operationObservation', operationId: message.operationId,
                result: { kind: 'started', pid: 123 } });
            } else if (message.type === 'requestStop' || message.type === 'cancelOutput') {
              if (!options.holdCloseAck) provider.message({ type: 'operationObservation', operationId: message.operationId,
                result: { kind: 'accepted' } });
            }
          }
        }
      };
      if (options.exposeParentControl) provider.transport.parentControl = Object.freeze({
        identity, scheduler: clock, expectedNativeResourceIds: Object.freeze(['subject']), closed: parentClosed.promise,
        terminate(budget) { cleanupRequests.push(budget); return cleanupResult.promise; }
      });
      providers.push(provider);
      return provider.transport;
    }
  };
  const owner = new ExecutionOwnerLifecycle(injection);
  const host = Object.create(CanvasPanelManager.prototype);
  host.terminalAvailableNotifications = new TerminalAvailableNotifications();
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

for (const kind of ['terminal', 'agent']) {
  test(`${kind} ordinary Host consumption does not serialize terminal state`, async () => {
    const f = fixture();
    const { record, provider } = await f.started(kind);
    const addon = record.tracker.serializeAddon;
    const serialize = addon.serialize.bind(addon);
    let serializations = 0;
    addon.serialize = (...args) => { serializations++; return serialize(...args); };
    try {
      for (let revision = 1; revision <= 3; revision++) {
        provider.output(revision, `${kind}-drain-${revision}\r\n`);
        await until(f.clock, () => record.execution.snapshot().adapter.consumedThrough === revision,
          `${kind} ordinary consumption ${revision}`);
        assert.equal(serializations, 0, 'ordinary consumer acknowledgement must not serialize the whole terminal.');
      }
      provider.process();
      provider.seal(3);
      provider.release();
      await until(f.clock, () => record.execution.snapshot().settled, `${kind} final serialization`);
      assert.ok(serializations > 0, 'final application must still serialize terminal state.');
      assert.match(record.tracker.getSerializedState().data, new RegExp(`${kind}-drain-3`));
    } finally { record.tracker.dispose(); }
  });
}

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
    const drain = record.tracker.drain.bind(record.tracker);
    const flush = record.tracker.flush.bind(record.tracker);
    let drains = 0;
    let flushes = 0;
    record.tracker.drain = async () => {
      if (++drains === 1) await gate.promise;
      return drain();
    };
    record.tracker.flush = async () => { flushes++; return flush(); };
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
      assert.equal(drains, 1);
      assert.equal(flushes, 0, 'final serialization must not overtake pending consumption');
      gate.resolve();
      await until(f.clock, () => record.execution.snapshot().settled, `${kind} terminal completion`);
      assert.match(record.tracker.getSerializedState().data, new RegExp(`${kind}-tail-10`));
      assert.equal(record.finalRevision, 10);
      assert.equal(record.execution.snapshot().terminal.finalRevision, 10);
      assert.equal(record.readerAdmissionClosed, true);
      assert.equal(drains, 3, 'three real consumer drains must precede the final tracker flush');
      assert.equal(flushes, 1, 'final application still requires its separate serialization');
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
    test(`${kind} ${failure} tracker failure retains unknown responsibility without cached success`, async () => {
      const f = fixture();
      const { record, provider } = await f.started(kind);
      try {
        if (failure === 'final') {
          provider.output(1, `${kind}-consumed`);
          await until(f.clock, () => record.execution.snapshot().adapter.consumedThrough === 1, `${kind} initial real drain`);
        }
        let failedFlushes = 0;
        record.tracker[failure === 'consumer' ? 'drain' : 'flush'] = async () => {
          failedFlushes += 1;
          throw new Error(`${failure} tracker failure`);
        };
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

function localFixture(options = {}) {
  const f = fixture({ ...options,
    capabilities: options.capabilities ?? ['execution-lifecycle-v1', 'terminal-local-settlement-v1'] });
  const posted = [];
  const host = f.host;
  const webviews = Object.fromEntries(['editor', 'panel'].map(surface => [surface, {
    postMessage(message) {
      posted.push({ surface, message });
      options.onHostMessage?.(message, surface);
      return options.send ? options.send(message, surface) : Promise.resolve(true);
    }
  }]));
  delete host.postMessage;
  Object.assign(host, {
    activeSurface: 'editor', terminalReadRelay: new RuntimeTerminalReadRelay(),
    surfaceMode: { editor: 'active', panel: 'active' }, surfaceReady: { editor: false, panel: false },
    surfaceLifecycle: {
      editor: { generation: 1, mode: 'active', frameId: 'editor-frame-1', ready: false, bootstrapAck: false },
      panel: { generation: 1, mode: 'active', frameId: 'panel-frame-1', ready: false, bootstrapAck: false }
    },
    surfaceMessageWebview: webviews, renderedWebviewLifecycle: new WeakMap(), pendingBootstrapHostMessages: {},
    pendingRuntimeSupervisorOperations: new Set(), scheduledExecutionOutputPosts: new Map(),
    recordHostMessage() {}, bootstrapInteractiveSurface: async () => {},
    postWorkspaceRootFocusGroupMessageForCurrentLifecycle() {},
    rejectPendingWebviewProbeRequests() {}, rejectPendingWebviewDomActionRequests() {}
  });
  for (const surface of ['editor', 'panel']) {
    host.renderedWebviewLifecycle.set(webviews[surface], host.getSurfaceLifecycleIdentity(surface));
  }
  function send(surface, type, payload, lifecycle = host.getSurfaceLifecycleIdentity(surface)) {
    host.handleWebviewMessage(surface, { type, ...(payload === undefined ? {} : { payload }), lifecycle }, webviews[surface]);
  }
  function ready(surface = 'editor', enabled = options.readyCapability !== false, lifecycle) {
    host.activeSurface = surface;
    send(surface, 'webview/ready', enabled ? { capabilities: { terminalLocalSettlementV1: true } } : undefined, lifecycle);
    host.surfaceLifecycle[surface].bootstrapAck = true;
  }
  async function attach(kind, surface = 'editor') {
    host.activeSurface = surface;
    await completed(f.clock, host.postExecutionSnapshot(kind, `${kind}-1`, { surface }), `${kind} local snapshot`);
    return posted.filter(entry => entry.surface === surface && entry.message.type === 'host/executionSnapshot').at(-1)?.message;
  }
  function settle(kind, record, outcome, surface = 'editor', overrides = {}, lifecycle) {
    host.activeSurface = surface;
    send(surface, 'webview/executionLocalTerminalSettled', {
      nodeId: `${kind}-1`, kind, executionSessionId: record.execution.identity.executionId, outcome, ...overrides
    }, lifecycle);
  }
  const completions = (surface = 'editor') => posted.filter(entry => entry.surface === surface &&
    entry.message.type === 'host/executionExit' && entry.message.payload.localCompletion);
  async function finish(kind, record, provider, text) {
    const final = text === undefined ? 0 : 1;
    if (text !== undefined) {
      provider.output(1, text);
      await until(f.clock, () => record.execution.snapshot().adapter.acceptedThrough === final, `${kind} local tail accepted`);
    }
    provider.process();
    provider.seal(final);
    provider.release();
    await until(f.clock, () => record.execution.snapshot().settled, `${kind} local authority settled`);
    return final;
  }
  ready();
  return { ...f, posted, webviews, send, ready, attach, settle, completions, finish };
}

for (const kind of ['terminal', 'agent']) {
  test(`${kind} local final settlement requires the exact published identity, not an ordinary application ACK`, async () => {
    const f = localFixture();
    const { record, provider } = await f.started(kind);
    try {
      const initial = await f.attach(kind);
      assert.equal(initial.payload.executionSessionId, record.execution.identity.executionId);
      assert.equal(initial.payload.outputSequence, 0);
      assert.equal(f.completions().length, 0);
      f.settle(kind, record, { kind: 'applied', finalOutputSequence: 0 });
      assert.equal(record.execution.snapshot().readerOutcome, 'pending');
      await f.finish(kind, record, provider, `${kind}-final-tail`);
      await until(f.clock, () => f.completions().length === 1, `${kind} published local final`);
      await pump(f.clock, () => false);
      const completion = f.completions()[0].message;
      assert.deepEqual(completion.payload.localCompletion, {
        executionSessionId: record.execution.identity.executionId, finalOutputSequence: 1
      });
      assert.equal(f.owner.snapshot().pending, 1);
      const outcome = { kind: 'applied', finalOutputSequence: 1 };
      for (const overrides of [{ executionSessionId: 'different-execution' }, { nodeId: 'different-node' },
        { kind: kind === 'terminal' ? 'agent' : 'terminal' }]) {
        f.settle(kind, record, outcome, 'editor', overrides);
      }
      f.settle(kind, record, outcome, 'editor', {}, { ...completion.lifecycle, frameId: 'retired-frame' });
      f.settle(kind, record, { kind: 'applied', finalOutputSequence: 2 });
      f.send('editor', 'webview/executionTerminalApplied', {
        nodeId: `${kind}-1`, kind, executionSessionId: record.execution.identity.executionId,
        authorityId: 'not-a-local-authority', revision: 1
      });
      assert.equal(record.execution.snapshot().readerOutcome, 'pending');
      assert.equal(f.owner.snapshot().pending, 1);
      f.settle(kind, record, outcome);
      await until(f.clock, () => record.execution.snapshot().retired, `${kind} exact local final applied`);
      assert.equal(f.record(kind), undefined);
      assert.equal(f.owner.snapshot().pending, 0);
      f.settle(kind, record, outcome);
      f.settle(kind, record, { kind: 'cancelled', reason: 'late-conflict' });
      assert.equal(f.owner.snapshot().pending, 0, 'late results cannot recreate a retired owner');
    } finally { record.tracker.dispose(); }
  });
}

test('local final zero is explicitly published and remains pending until its empty-output application result', async () => {
  const f = localFixture();
  const { record, provider } = await f.started('terminal');
  try {
    await f.attach('terminal');
    await f.finish('terminal', record, provider);
    await until(f.clock, () => f.completions().length === 1, 'zero final notification');
    assert.equal(f.completions()[0].message.payload.localCompletion.finalOutputSequence, 0);
    assert.equal(record.execution.snapshot().readerOutcome, 'pending');
    await pump(f.clock);
    f.ready('panel');
    await f.attach('terminal', 'panel');
    assert.equal(record.localReaders.has('panel'), false, 'fixed final closes admission for a later surface');
    assert.equal(f.completions('panel').length, 0);
    f.settle('terminal', record, { kind: 'applied', finalOutputSequence: 0 });
    await until(f.clock, () => record.execution.snapshot().retired, 'zero final application');
    assert.equal(f.owner.snapshot().pending, 0);
  } finally { record.tracker.dispose(); }
});

test('local frozen completion permits recovery only for the original admitted page and still accepts its final ACK', async () => {
  const f = localFixture();
  const { record, provider } = await f.started('terminal');
  try {
    await f.attach('terminal');
    const reader = record.localReaders.get('editor');
    await f.finish('terminal', record, provider, 'frozen-recovery-tail');
    await until(f.clock, () => reader.finalPublishedSequence === 1, 'original final publication');
    assert.equal(record.readerAdmissionClosed, true);
    assert.equal(reader.outcome, undefined);
    const snapshotsBefore = f.posted.filter(entry => entry.message.type === 'host/executionSnapshot').length;
    record.tracker.flush = async () => assert.fail('recovery must reuse the frozen final, not flush a new version');
    const recovery = await f.attach('terminal');
    assert.equal(f.posted.filter(entry => entry.message.type === 'host/executionSnapshot').length, snapshotsBefore + 1);
    assert.equal(recovery.payload.liveSession, false);
    assert.equal(recovery.payload.outputSequence, 1);
    assert.deepEqual(recovery.payload.serializedTerminalState, record.finalTerminal);
    assert.match(recovery.payload.serializedTerminalState.data, /frozen-recovery-tail/);
    assert.equal(record.localReaders.get('editor'), reader);
    assert.equal(record.localReaders.size, 1);
    assert.equal(reader.outcome, undefined);
    f.ready('panel', true, { ...f.host.getSurfaceLifecycleIdentity('panel'), frameId: 'new-panel-frame' });
    await f.attach('terminal', 'panel');
    assert.equal(record.localReaders.has('panel'), false, 'recovery must not admit a new page after final freeze');
    assert.equal(f.completions('panel').length, 0);
    f.settle('terminal', record, { kind: 'applied', finalOutputSequence: 1 });
    await until(f.clock, () => record.execution.snapshot().retired, 'original recovered page final application');
    assert.deepEqual(reader.outcome, { kind: 'applied', finalOutputSequence: 1 });
    assert.equal(f.owner.snapshot().pending, 0);
    assert.equal(f.record('terminal'), undefined);
  } finally { record.tracker.dispose(); }
});

test('local settlement capability is explicit and absent consumers do not fabricate applied readers', async () => {
  for (const options of [{ readyCapability: false }, { noWebview: true },
    { capabilities: ['execution-lifecycle-v1'] }]) {
    const f = localFixture(options);
    if (options.noWebview) f.host.surfaceMessageWebview.editor = undefined;
    if (options.noWebview) f.host.getSurfaceWebview = () => undefined;
    const { record, provider } = await f.started('terminal');
    try {
      await f.attach('terminal');
      await f.finish('terminal', record, provider);
      await pump(f.clock);
      assert.equal(f.completions().length, 0);
      if (options.capabilities) {
        assert.equal(record.execution.snapshot().readerOutcome, 'pending', 'legacy injection retains its original unfinished reader semantics');
        record.execution.settleReaders('cancelled');
      } else {
        assert.equal(record.execution.snapshot().readerOutcome, 'settled', 'zero consumers settle neutrally, not as applied');
        assert.equal([...(record.localReaders?.values() ?? [])].some(reader => reader.outcome?.kind === 'applied'), false);
      }
      assert.equal(f.owner.snapshot().pending, 0);
    } finally { record.tracker.dispose(); }
  }
});

test('local ACK cannot settle a final publication whose actual webview send is still pending', async () => {
  const gate = deferred();
  const f = localFixture({ send: message => message.type === 'host/executionExit' && message.payload.localCompletion
    ? gate.promise : Promise.resolve(true) });
  const { record, provider } = await f.started('terminal');
  try {
    await f.attach('terminal');
    const reader = record.localReaders.get('editor');
    assert.equal(reader.pendingPublications.size, 0, 'successful initial send releases its cancellation resolver');
    await f.finish('terminal', record, provider, 'send-pending-tail');
    await until(f.clock, () => f.completions().length === 1, 'pending final send');
    assert.equal(reader.pendingPublications.size, 1);
    f.settle('terminal', record, { kind: 'applied', finalOutputSequence: 1 });
    f.settle('terminal', record, { kind: 'applied', finalOutputSequence: 1 });
    assert.equal(record.execution.snapshot().readerOutcome, 'pending');
    assert.equal(f.owner.snapshot().pending, 1);
    gate.resolve(true);
    await pump(f.clock);
    await until(f.clock, () => record.execution.snapshot().retired, 'acknowledged final send');
    assert.equal(f.owner.snapshot().pending, 0);
    assert.equal(reader.pendingPublications.size, 0, 'successful final send releases its cancellation resolver');
    const results = f.diagnostics.filter(entry => entry.name === 'execution/localTerminalResult');
    assert.deepEqual(results.map(entry => entry.detail.status), ['recorded', 'duplicate']);
    assert.equal(f.diagnostics.filter(entry => entry.name === 'execution/localTerminalReaderSettled' &&
      entry.detail.outcome.kind === 'applied').length, 1, 'concurrent matching ACKs settle the original reader only once');
  } finally { gate.resolve(true); record.tracker.dispose(); }
});

test('local page invalidation releases responsibility even when its final snapshot send never resolves', async () => {
  const f = localFixture({ send: message => message.type === 'host/executionSnapshot' && message.payload.liveSession === false
    ? new Promise(() => {}) : Promise.resolve(true) });
  const { record, provider } = await f.started('terminal');
  try {
    await f.attach('terminal');
    await f.finish('terminal', record, provider);
    await until(f.clock, () => f.posted.some(entry => entry.message.type === 'host/executionSnapshot' &&
      entry.message.payload.liveSession === false), 'never-resolving final snapshot publication');
    assert.equal(f.completions().length, 0, 'exit must not overtake an unconfirmed final snapshot');
    f.settle('terminal', record, { kind: 'applied', finalOutputSequence: 0 });
    assert.equal(f.owner.snapshot().pending, 1);
    const reader = record.localReaders.get('editor');
    assert.equal(reader.pendingPublications.size, 1);
    f.host.invalidateSurfaceLifecycle('editor', 'active');
    assert.equal(reader.pendingPublications.size, 0, 'cancellation releases the pending final snapshot resolver');
    await until(f.clock, () => record.execution.snapshot().retired, 'invalidation does not await old postMessage');
    assert.equal(f.owner.snapshot().pending, 0);
  } finally { record.tracker.dispose(); }
});

test('local page invalidation unblocks accepted tail consumption when an output send never resolves', async () => {
  const f = localFixture({ send: message => message.type === 'host/executionOutput'
    ? new Promise(() => {}) : Promise.resolve(true) });
  const { record, provider } = await f.started('terminal');
  try {
    await f.attach('terminal');
    provider.output(1, 'accepted-tail-with-blocked-page');
    await until(f.clock, () => f.posted.some(entry => entry.message.type === 'host/executionOutput'), 'pending output publication');
    assert.equal(record.execution.snapshot().adapter.acceptedThrough, 1);
    assert.equal(record.execution.snapshot().adapter.consumedThrough, 0);
    provider.process();
    provider.seal(1);
    provider.release();
    await pump(f.clock);
    assert.equal(record.finalRevision, undefined);
    assert.equal(f.owner.snapshot().pending, 1);
    const reader = record.localReaders.get('editor');
    assert.equal(reader.pendingPublications.size, 1);
    f.host.invalidateSurfaceLifecycle('editor', 'active');
    assert.equal(reader.pendingPublications.size, 0, 'cancellation releases the pending output resolver');
    await until(f.clock, () => record.execution.snapshot().retired, 'tail consumption after page invalidation');
    assert.equal(record.execution.snapshot().adapter.consumedThrough, 1);
    assert.equal(record.finalRevision, 1);
    assert.ok(['cancelled', 'lost'].includes(record.localReaders.get('editor').outcome?.kind));
    assert.equal(f.owner.snapshot().pending, 0);
  } finally { record.tracker.dispose(); }
});

for (const behavior of ['false', 'throw']) {
  test(`local final send returning ${behavior} ends the reader without claiming application`, async () => {
    const f = localFixture({ send: message => {
      if (message.type === 'host/executionExit' && message.payload.localCompletion) {
        if (behavior === 'throw') throw new Error('controlled final send failure');
        return Promise.resolve(false);
      }
      return Promise.resolve(true);
    } });
    const { record, provider } = await f.started('terminal');
    try {
      await f.attach('terminal');
      await f.finish('terminal', record, provider, 'unsent-tail');
      await until(f.clock, () => record.execution.snapshot().retired, `local ${behavior} reader cancellation`);
      assert.equal(f.owner.snapshot().pending, 0);
      assert.equal(record.execution.snapshot().readerOutcome, 'settled');
      assert.ok(['cancelled', 'lost'].includes(record.localReaders.get('editor').outcome?.kind));
      f.settle('terminal', record, { kind: 'applied', finalOutputSequence: 1 });
      assert.equal(f.owner.snapshot().pending, 0);
    } finally { record.tracker.dispose(); }
  });
}

test('local surface switching loses only the old consumer and preserves the active consumer responsibility', async () => {
  const f = localFixture();
  const { record, provider } = await f.started('terminal');
  try {
    await f.attach('terminal', 'editor');
    f.ready('panel');
    await f.attach('terminal', 'panel');
    await f.finish('terminal', record, provider, 'two-surface-tail');
    await until(f.clock, () => f.completions('panel').length === 1, 'active panel final notification');
    await pump(f.clock);
    assert.equal(record.localReaders.get('editor').outcome?.kind, 'lost');
    assert.equal(f.completions('editor').length, 0);
    f.settle('terminal', record, { kind: 'applied', finalOutputSequence: 1 }, 'editor');
    assert.equal(f.owner.snapshot().pending, 1);
    f.settle('terminal', record, { kind: 'applied', finalOutputSequence: 1 }, 'editor');
    f.settle('terminal', record, { kind: 'cancelled', reason: 'conflicting-first-result' }, 'editor');
    assert.equal(f.owner.snapshot().pending, 1);
    f.settle('terminal', record, { kind: 'applied', finalOutputSequence: 1 }, 'panel');
    await until(f.clock, () => record.execution.snapshot().retired, 'all local surface results');
    assert.deepEqual(record.localReaders.get('panel').outcome, { kind: 'applied', finalOutputSequence: 1 });
    assert.equal(f.owner.snapshot().pending, 0);
  } finally { record.tracker.dispose(); }
});

test('local rerender releases the original consumer and a late old-frame result cannot settle its replacement execution', async () => {
  const f = localFixture();
  const first = await f.started('terminal');
  let replacement;
  try {
    await f.attach('terminal');
    const oldLifecycle = f.host.getSurfaceLifecycleIdentity('editor');
    await f.finish('terminal', first.record, first.provider, 'old-tail');
    await until(f.clock, () => f.completions().length === 1, 'old final');
    f.host.invalidateSurfaceLifecycle('editor', 'active');
    await until(f.clock, () => first.record.execution.snapshot().retired, 'invalidated local reader');
    f.ready('editor', true, { ...f.host.getSurfaceLifecycleIdentity('editor'), frameId: 'editor-frame-2' });
    await completed(f.clock, f.start('terminal'), 'replacement local execution');
    replacement = { record: f.record('terminal'), provider: f.providers.at(-1) };
    await f.attach('terminal');
    f.settle('terminal', first.record, { kind: 'applied', finalOutputSequence: 1 }, 'editor', {}, oldLifecycle);
    assert.equal(f.record('terminal'), replacement.record);
    assert.equal(replacement.record.execution.snapshot().readerOutcome, 'pending');
    await f.finish('terminal', replacement.record, replacement.provider);
    f.host.beginSurfaceRender('editor', 'active');
    await until(f.clock, () => replacement.record.execution.snapshot().retired, 'replacement rerender cancellation');
  } finally { first.record.tracker.dispose(); replacement?.record.tracker.dispose(); }
});

test('local reader cancellation is not reopened by a repeated attach in the same page identity', async () => {
  const f = localFixture();
  const { record, provider } = await f.started('terminal');
  try {
    await f.attach('terminal');
    f.settle('terminal', record, { kind: 'cancelled', reason: 'controller-disposed' });
    await f.attach('terminal');
    await f.finish('terminal', record, provider);
    await until(f.clock, () => record.execution.snapshot().retired, 'cancelled consumer remains closed');
    assert.equal(f.completions().length, 0);
    assert.equal(f.owner.snapshot().pending, 0);
  } finally { record.tracker.dispose(); }
});

test('local node deletion cancels its consumers but still waits for the provider resource result', async () => {
  const f = localFixture();
  const { record, provider } = await f.started('terminal');
  try {
    await f.attach('terminal');
    let deleted = false;
    const deletion = f.host.terminateExecutionNodeForDeletion(f.nodes.find(node => node.kind === 'terminal'))
      .then(() => { deleted = true; });
    await until(f.clock, () => provider.messages.some(message => message.type === 'requestStop'), 'local delete stop');
    provider.process();
    provider.seal(0);
    await until(f.clock, () => record.finalRevision === 0, 'local delete final flush');
    assert.equal(deleted, false);
    assert.equal(f.owner.snapshot().pending, 1);
    provider.release();
    await completed(f.clock, deletion, 'local delete resource settlement');
    assert.equal(f.owner.snapshot().pending, 0);
    assert.equal(f.completions().length, 0, 'deleted projection must not receive a new final request');
  } finally { record.tracker.dispose(); }
});

test('local final terminal application cannot announce process exit when the controlled process result is unconfirmed', async () => {
  const f = localFixture();
  const { record, provider } = await f.started('terminal');
  try {
    await f.attach('terminal');
    provider.output(1, 'tail-before-unconfirmed-process');
    await until(f.clock, () => record.execution.snapshot().adapter.consumedThrough === 1, 'accepted tail actually consumed');
    provider.message({ type: 'processResult', result: { kind: 'unconfirmed', reason: 'controlled provider control lost' } });
    provider.seal(1);
    provider.release();
    await until(f.clock, () => record.execution.snapshot().terminal?.kind === 'applied', 'final tracker applied with unknown process');
    await pump(f.clock);
    assert.equal(record.finalRevision, 1);
    assert.match(record.tracker.getSerializedState().data, /tail-before-unconfirmed-process/);
    assert.equal(record.execution.snapshot().adapter.process.kind, 'unconfirmed');
    assert.equal(record.execution.snapshot().settled, false);
    assert.equal(record.execution.snapshot().retired, false);
    assert.ok(f.owner.snapshot().blockedReason);
    assert.equal(f.owner.snapshot().pending, 1);
    assert.equal(f.record('terminal'), record);
    assert.equal(f.posted.some(entry => entry.message.type === 'host/executionExit'), false,
      'a terminal flush cannot become a process exit announcement');
    assert.ok(['cancelled', 'lost'].includes(record.localReaders.get('editor').outcome?.kind));
    assert.equal(record.execution.snapshot().readerOutcome, 'settled', 'reader release remains separate from unknown execution responsibility');
    await assert.rejects(f.start('terminal'), /admission is closed/);
    assert.equal(f.providers.length, 1);
    f.ready('panel');
    await f.attach('terminal', 'panel');
    assert.equal(record.localReaders.has('panel'), false);
    assert.equal(f.owner.snapshot().pending, 1);
  } finally { record.tracker.dispose(); }
});

async function loadActualLocalController() {
  const filename = path.resolve('extensions/vscode/dev-session-canvas/src/webview/main.tsx');
  const source = await readFile(filename, 'utf8');
  const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const extract = name => {
    const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
    assert.ok(declaration, `actual Webview function ${name} must exist`);
    return declaration.getText(ast);
  };
  const contents = `
    import { TerminalPagedProjection } from './terminalPagedProjection';
    import { normalizeTerminalStreamAttachPayload } from '../common/terminalSessionStream';
    import { normalizeLocalTerminalCompletion } from '../common/protocol';
    const window = { setTimeout, clearTimeout, requestAnimationFrame: callback => setTimeout(callback, 0) };
    const readPerformanceNow = () => performance.now();
    const removePendingExecutionTerminalDrain = () => {};
    const scheduleExecutionTerminalDrain = controller => controller.flushPendingOutput();
    const scheduleExecutionTerminalSnapshotWrite = task => task.run(() => {});
    const pendingExecutionTerminalSnapshotWrites = [];
    const activeExecutionTerminalSnapshotWrite = undefined;
    const EXECUTION_PERFORMANCE_DIAGNOSTIC_MIN_DURATION_MS = 0;
    const EXECUTION_PERFORMANCE_DIAGNOSTIC_MIN_CHARACTERS = 0;
    const EXECUTION_TERMINAL_APPLIED_ACK_INTERVAL_MS = 5;
    const EXECUTION_TERMINAL_SNAPSHOT_OUTPUT_BATCH_MAX_CHARACTERS = 32768;
    ${extract('applyTerminalStreamEvents')}
    ${extract('restoreExecutionTerminalSnapshot')}
    ${extract('normalizeTerminalSnapshotOutputSequence')}
    export function createController(nodeId, kind, terminal, postMessage, options) {
      const reportExecutionPerformanceDiagnostic = () => {};
      ${extract('createExecutionTerminalController')}
      return createExecutionTerminalController(nodeId, kind, terminal, options);
    }
  `;
  const bundle = await esbuild.build({ stdin: { contents, resolveDir: path.dirname(filename), loader: 'ts' },
    bundle: true, platform: 'node', format: 'cjs', write: false, target: 'node18' });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', bundle.outputFiles[0].text)(module, module.exports, createRequire(import.meta.url));
  return module.exports.createController;
}

test('actual local Host to main/headless to Host preserves owner responsibility until the real tail callback', async () => {
  const createController = await loadActualLocalController();
  const { Terminal } = createRequire(import.meta.url)('@xterm/headless');
  const terminal = new Terminal({ cols: 80, rows: 24, scrollback: 100, allowProposedApi: true });
  terminal.refresh = () => {};
  let controller;
  let releaseTail;
  let holdTail = true;
  const pageMessages = [];
  const tail = 'real-local-tail\r\n\x1b[4;9H';
  const write = terminal.write.bind(terminal);
  terminal.write = (text, done) => write(text, () => {
    if (holdTail && text.includes('real-local-tail')) {
      holdTail = false;
      releaseTail = done;
    } else done?.();
  });
  const f = localFixture({ onHostMessage: message => {
    const p = message.payload;
    if (message.type === 'host/executionSnapshot') controller.applySnapshot({ ...p, type: 'snapshot' });
    if (message.type === 'host/executionOutput') {
      controller.enqueueOutput(p.chunk, p);
      controller.flushPendingOutput();
    }
    if (message.type === 'host/executionExit') controller.showExit(p.message, p.executionSessionId, p.localCompletion);
  } });
  controller = createController('terminal-1', 'terminal', terminal, message => {
    pageMessages.push(message);
    assert.ok(parseWebviewMessage(message), `real local controller message must parse: ${message.type}`);
    f.send('editor', message.type, message.payload);
  });
  const { record, provider } = await f.started('terminal');
  try {
    await f.attach('terminal');
    await until(f.clock, () => controller.getQueuedWriteCount() === 0, 'real local checkpoint application');
    provider.output(1, tail);
    await until(f.clock, () => releaseTail !== undefined, 'actual local tail callback paused');
    provider.process();
    provider.seal(1);
    provider.release();
    await until(f.clock, () => f.completions().length === 1, 'real local final barrier announcement');
    assert.equal(record.finalRevision, 1);
    assert.equal(record.execution.snapshot().readerOutcome, 'pending');
    assert.equal(f.owner.snapshot().pending, 1);
    assert.equal(pageMessages.filter(message => message.type === 'webview/executionLocalTerminalSettled').length, 0);
    assert.equal(terminal.buffer.active.getLine(0).translateToString(true), 'real-local-tail');
    assert.equal(terminal.buffer.active.cursorX, 8);
    assert.equal(terminal.buffer.active.cursorY, 3);
    releaseTail();
    await until(f.clock, () => record.execution.snapshot().retired, 'real local callback application result');
    const outcomes = pageMessages.filter(message => message.type === 'webview/executionLocalTerminalSettled');
    assert.equal(outcomes.length, 1);
    assert.deepEqual(outcomes[0].payload, { nodeId: 'terminal-1', kind: 'terminal',
      executionSessionId: record.execution.identity.executionId,
      outcome: { kind: 'applied', finalOutputSequence: 1 } });
    assert.equal(f.owner.snapshot().pending, 0);
    assert.equal(f.record('terminal'), undefined);
  } finally {
    holdTail = false;
    releaseTail?.();
    controller.dispose();
    terminal.dispose();
    record.tracker.dispose();
  }
});

const closeObservationCapabilities = ['execution-lifecycle-v1', 'execution-close-observation-v1'];

for (const kind of ['terminal', 'agent']) {
  test(`${kind} real Host natural close preserves its first timeout while late tail facts settle the original owner`, async () => {
    const f = fixture({ capabilities: closeObservationCapabilities, budgets: { naturalDrainMs: 15 }, holdCloseAck: true });
    const { record, provider } = await f.started(kind);
    try {
      provider.process();
      const initial = record.execution.snapshot().closeObservation;
      assert.equal(initial.trigger, 'natural-exit');
      assert.equal(initial.startedAt, 0);
      assert.equal(initial.cancelAt, 15);
      assert.equal(initial.finishAt, 35);
      assert.equal(initial.forceAt, undefined);
      provider.output(1, `${kind}-natural-tail`);
      await until(f.clock, () => record.execution.snapshot().adapter.consumedThrough === 1, `${kind} natural tail tracker`);
      const appliedBuffer = record.tracker.terminal.buffer.active;
      assert.match(Array.from({ length: appliedBuffer.length }, (_, index) =>
        appliedBuffer.getLine(index)?.translateToString(true) ?? '').join('\n'),
      new RegExp(`${kind}-natural-tail`), 'consumed tail must exist in the real parser, without forcing a snapshot');
      f.clock.advance(15);
      await until(f.clock, () => provider.messages.some(message => message.type === 'cancelOutput'), `${kind} natural cancel`);
      assert.equal(provider.messages.filter(message => message.type === 'requestStop').length, 0);
      assert.equal(record.execution.snapshot().adapter.source, undefined, 'cancel accepted is not source EOF');
      assert.equal(record.execution.snapshot().closeObservation.first, undefined);
      const cancel = provider.messages.find(message => message.type === 'cancelOutput');
      const cancelObservation = record.execution.execution.operations.get('cancel').view;
      f.clock.elapse(35);
      provider.message({ type: 'operationObservation', operationId: cancel.operationId, result: { kind: 'accepted' } });
      assert.equal((await cancelObservation.first).kind, 'unconfirmed', 'owner capability must enable adapter absolute-deadline classification');
      assert.equal(cancelObservation.current.kind, 'accepted', 'late accepted is current evidence, not first success');
      await until(f.clock, () => record.execution.snapshot().closeObservation.first !== undefined, `${kind} owner receives late ACK notification`);
      const timedOut = record.execution.snapshot().closeObservation;
      assert.deepEqual(timedOut.first, { kind: 'unconfirmed', pending: [`${kind}:${kind}-1`] });
      assert.equal(timedOut.current.kind, 'unconfirmed');
      assert.ok(timedOut.pendingDomains.includes('source'));
      assert.ok(timedOut.pendingDomains.includes('resources'));
      assert.equal(f.record(kind), record);
      assert.equal(f.owner.snapshot().pending, 1);
      await assert.rejects(f.host.stopExecutionSession(kind, `${kind}-1`), /stop is unconfirmed/);
      assert.equal(record.execution.snapshot().closeObservation.finishAt, initial.finishAt);
      provider.message({ type: 'sourceEnd', finalFrameId: 1,
        disposition: { kind: 'interrupted', reason: 'controlled natural drain cancellation' } });
      provider.release();
      await until(f.clock, () => record.execution.snapshot().settled, `${kind} late original Host settlement`);
      const late = record.execution.snapshot();
      assert.deepEqual(late.closeObservation.first, timedOut.first);
      assert.equal(late.closeObservation.current.kind, 'settled');
      assert.equal((await cancelObservation.first).kind, 'unconfirmed');
      assert.deepEqual(late.closeObservation.pendingDomains, []);
      assert.equal(late.adapter.source.kind, 'interrupted');
      assert.equal(late.terminal.finalRevision, 1);
      assert.equal(late.readerOutcome, 'pending', 'native close observation does not settle a slow reader');
      assert.equal(late.retired, false);
      assert.equal(f.owner.snapshot().pending, 1);
      assert.ok(f.owner.snapshot().blockedReason);
      record.execution.settleReaders('cancelled');
      assert.equal(f.record(kind), undefined);
      assert.equal(f.owner.snapshot().pending, 0);
      assert.equal(f.owner.tryResume(), false);
      assert.equal(provider.messages.filter(message => message.type === 'requestStop').length, 0);
      assert.equal(provider.messages.filter(message => message.type === 'cancelOutput').length, 1);
    } finally { record.tracker.dispose(); }
  });
}

test('real Host boundary preserves a timed-out final tracker obligation and accepts only its late actual completion', async () => {
  const f = fixture({ capabilities: closeObservationCapabilities, budgets: { naturalDrainMs: 15 } });
  const { record, provider } = await f.started('terminal');
  const gate = deferred();
  const entered = deferred();
  const flush = record.tracker.flush.bind(record.tracker);
  let finalState;
  try {
    provider.output(1, 'boundary-observed-tail');
    await until(f.clock, () => record.execution.snapshot().adapter.consumedThrough === 1, 'boundary tail consumed');
    record.tracker.flush = async () => {
      entered.resolve();
      await gate.promise;
      finalState = await flush();
      return finalState;
    };
    const before = f.host.state;
    const closing = f.host.prepareForHostBoundary({ preserveLiveRuntime: true, allowRuntimeSupervisorRestart: false });
    const rejected = assert.rejects(closing, /cleanup is unconfirmed/);
    await until(f.clock, () => provider.messages.some(message => message.type === 'requestStop'), 'boundary graceful request');
    provider.process();
    provider.seal(1);
    provider.release();
    await entered.promise;
    const observation = record.execution.snapshot().closeObservation;
    assert.equal(observation.trigger, 'stop');
    assert.equal(observation.finishAt, 40);
    assert.equal(record.execution.snapshot().readerOutcome, 'lost');
    f.clock.advance(40);
    await completed(f.clock, rejected, 'boundary first timeout report');
    const first = record.execution.snapshot().closeObservation.first;
    assert.deepEqual(first, { kind: 'unconfirmed', pending: ['terminal:terminal-1'] });
    assert.ok(record.execution.snapshot().closeObservation.pendingDomains.includes('final-flush'));
    assert.equal(record.execution.snapshot().terminal, undefined, 'observation timeout is not a failed flush');
    assert.equal(f.host.state, before);
    assert.equal(f.record('terminal'), record);
    assert.equal(f.owner.snapshot().pending, 1);
    gate.resolve();
    await until(f.clock, () => record.execution.snapshot().retired, 'late actual boundary tracker completion');
    assert.equal(finalState.outputSequence, 1);
    assert.match(finalState.data, /boundary-observed-tail/);
    assert.deepEqual(record.execution.snapshot().closeObservation.first, first);
    assert.equal(record.execution.snapshot().closeObservation.current.kind, 'settled');
    assert.equal(f.record('terminal'), undefined);
    assert.equal(f.owner.snapshot().pending, 0);
    assert.ok(f.owner.snapshot().blockedReason);
    assert.equal(f.owner.tryResume(), false);
    assert.equal(provider.messages.filter(message => message.type === 'requestStop').length, 1);
    assert.equal(provider.messages.filter(message => message.type === 'cancelOutput').length, 0);
  } finally { gate.resolve(); record.tracker.dispose(); }
});

test('real Host without close observation capability keeps natural-exit timers disabled', async () => {
  const f = fixture();
  const { record, provider } = await f.started('terminal');
  try {
    provider.process();
    f.clock.advance(1000);
    await pump(f.clock, () => true);
    assert.equal(record.execution.snapshot().closeObservation, undefined);
    assert.equal(provider.messages.some(message => message.type === 'requestStop' || message.type === 'cancelOutput'), false);
    assert.equal(f.owner.snapshot().blockedReason, undefined);
    provider.seal(0);
    provider.release();
    await until(f.clock, () => record.execution.snapshot().settled, 'legacy Host natural completion');
    record.execution.settleReaders('cancelled');
    assert.equal(f.owner.snapshot().pending, 0);
  } finally { record.tracker.dispose(); }
});

for (const kind of ['terminal', 'agent']) {
  test(`${kind} real Host parent cleanup preserves paused tracker work and requires the original resource result`, async () => {
    const f = fixture({
      capabilities: [...closeObservationCapabilities, 'execution-parent-cleanup-v1'], exposeParentControl: true,
      budgets: { naturalDrainMs: 15, parentTermMs: 5, parentKillMs: 5 }
    });
    const { record, provider } = await f.started(kind);
    const gate = deferred();
    const drain = record.tracker.drain.bind(record.tracker);
    record.tracker.drain = async () => { await gate.promise; return drain(); };
    try {
      provider.process();
      provider.output(1, `${kind}-parent-cleanup-tail`);
      await until(f.clock, () => record.execution.snapshot().adapter.acceptedThrough === 1, `${kind} transferred tail`);
      provider.message({ type: 'resourceResult', resourceId: 'subject', operationId: 'subject-release', result: { kind: 'released' } });
      provider.seal(1);
      await until(f.clock, () => provider.messages.some(message => message.type === 'sourceEndAccepted'), 'source acknowledgment sent');
      f.clock.advance(24);
      await pump(f.clock, () => true);
      assert.equal(provider.cleanupRequests.length, 0);
      f.clock.advance(25);
      await until(f.clock, () => provider.cleanupRequests.length === 1, 'original Host parent cleanup');
      const request = provider.cleanupRequests[0];
      assert.equal(request.termDeadline, 30);
      assert.equal(request.killDeadline, 35);
      assert.equal(request.canSignal(), true);
      assert.equal(record.execution.snapshot().adapter.consumedThrough, 0);
      assert.equal(record.execution.snapshot().terminal, undefined);
      provider.cleanupResult.resolve({ kind: 'closed', exitCode: 0, signal: null });
      await pump(f.clock, () => true);
      assert.notEqual(record.execution.snapshot().adapter.resources['provider-control'].current?.kind, 'released');
      assert.equal(record.execution.snapshot().settled, false, 'cleanup return cannot replace the resource result');
      provider.release();
      await pump(f.clock, () => true);
      assert.equal(record.execution.snapshot().adapter.resources['provider-control'].current.kind, 'released');
      assert.equal(record.execution.snapshot().settled, false, 'parent release cannot replace pending tracker work');
      gate.resolve();
      await until(f.clock, () => record.execution.snapshot().settled, `${kind} original tracker completion`);
      assert.match(record.tracker.getSerializedState().data, new RegExp(`${kind}-parent-cleanup-tail`));
      assert.equal(record.execution.snapshot().closeObservation.first.kind, 'settled');
      assert.equal(record.execution.snapshot().terminal.finalRevision, 1);
      assert.equal(record.execution.snapshot().readerOutcome, 'pending');
      assert.equal(record.execution.snapshot().retired, false);
      assert.equal(f.owner.snapshot().blockedReason, undefined);
      record.execution.settleReaders('cancelled');
      assert.equal(f.owner.snapshot().pending, 0);
      assert.equal(provider.cleanupRequests.length, 1);
    } finally { gate.resolve(); record.tracker.dispose(); }
  });
}

const boundaryCapabilities = [...closeObservationCapabilities, 'execution-owner-boundary-v1'];

function boundaryFixture(options = {}) {
  const f = fixture({ ...options, capabilities: boundaryCapabilities,
    budgets: { naturalDrainMs: 15, boundaryMs: 50, ...options.budgets } });
  const writes = [];
  const detach = [];
  delete f.host.persistState;
  delete f.host.disposeRuntimeSupervisorClients;
  Object.assign(f.host, {
    readStartupConfiguration: () => ({}), shouldPreserveLiveRuntimeAcrossHostBoundary: () => true,
    syncNoteMarkdownFileWatchers() {}, cleanupUnreferencedNoteMarkdownRecoverableDraftFiles() {},
    recordStatePersistPerformance() {},
    queuePersistedCanvasSnapshotWrite(snapshot, options) {
      writes.push({ snapshot, options });
      return Promise.resolve();
    },
    terminalReadRelay: { closeMatching: () => detach.push('relay') },
    runtimeSupervisorClients: new Map([['original-client', { dispose: () => detach.push('client') }]])
  });
  return { ...f, writes, detach };
}

for (const kind of ['terminal', 'agent']) {
  test(`${kind} permanent departure reports local unknown while saving the canvas and detaching original live clients`, async () => {
    const f = boundaryFixture();
    const { record, provider } = await f.started(kind);
    const remote = { owner: 'supervisor', runtimeSessionId: 'original-live' };
    const binding = { nodeId: 'live-node', runtimeSessionId: 'original-live' };
    f.host.terminalSessions.set('live-node', remote);
    f.host.runtimeSessionBindings.set('original-live', binding);
    f.host.waitForPendingRuntimeSupervisorOperations = () => new Promise(() => {});
    f.host.shouldPreserveLiveRuntimeAcrossHostBoundary = () => false;
    f.host.collectPersistedLiveRuntimeSessions = () => assert.fail('permanent departure must not collect live deletion');
    f.host.deleteRuntimeSupervisorSessions = () => assert.fail('permanent departure must not delete live executions');
    try {
      const closing = f.host.prepareForDeactivation();
      assert.equal(f.owner.snapshot().permanent, true);
      assert.deepEqual(f.detach, ['relay', 'client']);
      assert.equal(f.writes.length, 1);
      f.clock.advance(40);
      const report = await completed(f.clock, closing, `${kind} permanent failure report`);
      assert.equal(report.kind, 'unconfirmed');
      assert.equal(report.local.kind, 'unconfirmed');
      assert.equal(report.canvasSnapshot.kind, 'settled');
      assert.equal(report.remoteDetach.kind, 'settled');
      assert.equal(report.startedAt, 0);
      assert.equal(report.deadline, 50);
      assert.ok(Object.isFrozen(report));
      assert.ok(Object.isFrozen(report.local));
      assert.strictEqual(await f.host.prepareForDeactivation(), report);
      assert.equal(f.writes[0].options.workspaceStateMode, 'full');
      assert.strictEqual(f.host.terminalSessions.get('live-node'), remote);
      assert.strictEqual(f.host.runtimeSessionBindings.get('original-live'), binding);
      assert.strictEqual(f.record(kind), record);
      assert.equal(f.host.state.nodes.length, 2);
      assert.equal(f.diagnostics.filter(item => item.name === 'execution/hostDeactivationBoundary').length, 1);
      provider.process(); provider.seal(0); provider.release();
      await until(f.clock, () => record.execution.snapshot().retired, `${kind} original late responsibility`);
      assert.strictEqual(await f.host.prepareForDeactivation(), report);
      assert.equal(f.writes.length, 1, 'late local settlement must not submit a new save');
      assert.equal(f.owner.tryResume(), false);
    } finally { record.tracker.dispose(); }
  });
}

test('permanent departure uses the original canvas write promise and classifies cutoff completion as unconfirmed', async () => {
  for (const trigger of ['completion', 'timer']) {
    const f = boundaryFixture({ budgets: { boundaryMs: 20 } });
    const write = deferred();
    let writes = 0;
    f.host.queuePersistedCanvasSnapshotWrite = () => { writes++; return write.promise; };
    const preparation = f.owner.reserve('terminal:preparing');
    const closing = f.host.prepareForDeactivation();
    assert.deepEqual(f.detach, ['relay', 'client']);
    assert.equal(writes, 1);
    if (trigger === 'completion') { f.clock.elapse(20); write.resolve(); }
    else f.clock.advance(20);
    const report = await completed(f.clock, closing, `cutoff canvas snapshot from ${trigger}`);
    assert.equal(report.local.kind, 'unconfirmed');
    assert.equal(report.canvasSnapshot.kind, 'unconfirmed');
    assert.equal(report.remoteDetach.kind, 'settled');
    assert.equal(report.deadline, 20);
    assert.equal(f.owner.get(preparation.key), preparation);
    preparation.abandon('late original cleanup');
    write.resolve();
    assert.strictEqual(await f.host.prepareForDeactivation(), report);
    assert.equal(writes, 1);
  }
});

test('permanent departure reports settled only after the original terminal tracker actually finishes', async () => {
  const f = boundaryFixture();
  const { record, provider } = await f.started('terminal');
  const gate = deferred();
  const entered = deferred();
  const flush = record.tracker.flush.bind(record.tracker);
  let finalState;
  let reported = false;
  f.host.collectPersistedLiveRuntimeSessions = () => assert.fail('normal permanent departure must not delete remote live');
  f.host.deleteRuntimeSupervisorSessions = () => assert.fail('normal permanent departure must not delete remote live');
  try {
    provider.output(1, 'permanent-final-tail');
    await until(f.clock, () => record.execution.snapshot().adapter.consumedThrough === 1, 'permanent accepted tail');
    record.tracker.flush = async () => {
      entered.resolve();
      await gate.promise;
      finalState = await flush();
      return finalState;
    };
    const closing = f.host.prepareForDeactivation().then(report => { reported = true; return report; });
    await until(f.clock, () => provider.messages.some(message => message.type === 'requestStop'), 'permanent local stop');
    provider.process(); provider.seal(1); provider.release();
    await entered.promise;
    await pump(f.clock, () => true);
    assert.equal(reported, false);
    assert.equal(record.execution.snapshot().readerOutcome, 'lost');
    assert.equal(record.execution.snapshot().terminal, undefined);
    assert.equal(f.owner.snapshot().pending, 1);
    assert.deepEqual(f.detach, ['relay', 'client']);
    gate.resolve();
    const report = await completed(f.clock, closing, 'permanent original final flush');
    assert.equal(report.kind, 'settled');
    assert.equal(report.local.kind, 'settled');
    assert.equal(report.canvasSnapshot.kind, 'settled');
    assert.equal(report.remoteDetach.kind, 'settled');
    assert.match(finalState.data, /permanent-final-tail/);
    assert.equal(record.execution.snapshot().terminal.finalRevision, 1);
    assert.equal(record.execution.snapshot().retired, true);
    assert.equal(f.owner.snapshot().pending, 0);
    assert.equal(f.writes.length, 1, 'the current canvas save is not a second terminal-history save');
  } finally { gate.resolve(); record.tracker.dispose(); }
});

test('permanent departure keeps independent save and detach failures without losing successful local closure', async () => {
  for (const failure of ['root-local', 'snapshot-write']) {
    const f = boundaryFixture({ roots: failure === 'root-local' ? [{ path: '/controlled/root', name: 'root' }] : [] });
    if (failure === 'root-local') f.host.writeRootLocalCanvasSnapshot = () => { throw new Error('root-local rejected'); };
    else f.host.queuePersistedCanvasSnapshotWrite = () => Promise.reject(new Error('snapshot-write rejected'));
    f.host.terminalReadRelay.closeMatching = () => { throw new Error('detach rejected'); };
    const failedClient = { dispose: () => { throw new Error('original client rejected'); } };
    f.host.runtimeSupervisorClients.set('first-failed-client', failedClient);
    f.host.runtimeSupervisorClients.set('later-client', { dispose: () => f.detach.push('later-client') });
    const diagnostic = f.host.recordDiagnosticEvent;
    f.host.recordDiagnosticEvent = (name, detail) => {
      if (name === 'execution/hostDeactivationBoundary') throw new Error('diagnostic observer rejected');
      diagnostic(name, detail);
    };
    const report = await completed(f.clock, f.host.prepareForDeactivation(), failure);
    assert.equal(report.kind, 'unconfirmed');
    assert.equal(report.local.kind, 'settled');
    assert.equal(report.canvasSnapshot.kind, 'failed');
    assert.match(report.canvasSnapshot.reason, new RegExp(failure));
    assert.equal(report.remoteDetach.kind, 'failed');
    assert.match(report.remoteDetach.reason, /detach rejected/);
    assert.deepEqual(f.detach, ['client', 'later-client'], 'one detach failure cannot skip other original clients');
    assert.strictEqual(f.host.runtimeSupervisorClients.get('first-failed-client'), failedClient);
    assert.equal(f.host.runtimeSupervisorClients.size, 1);
    assert.equal(f.host.state.nodes.length, 2);
    assert.equal(f.owner.snapshot().permanent, true);
  }
  const f = boundaryFixture();
  const originalFailure = new Error('original pending runtime operation disconnected');
  const unhandled = [];
  const onUnhandled = error => unhandled.push(error);
  let reject;
  const pending = new Promise((_resolve, no) => { reject = no; });
  const observedFailure = pending.catch(error => error);
  f.host.pendingRuntimeSupervisorOperations = new Set();
  f.host.trackRuntimeSupervisorOperation(pending);
  f.host.runtimeSupervisorClients = new Map([['pending-client', { dispose: () => reject(originalFailure) }]]);
  process.on('unhandledRejection', onUnhandled);
  try {
    const report = await completed(f.clock, f.host.prepareForDeactivation(), 'pending operation detach');
    assert.equal(report.kind, 'settled');
    assert.strictEqual(await observedFailure, originalFailure, 'the original caller still receives its rejection');
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(unhandled, [], 'tracking must not create a second unhandled rejection during detach');
    assert.equal(f.host.pendingRuntimeSupervisorOperations.size, 0);
  } finally { process.off('unhandledRejection', onUnhandled); }
});

test('permanent boundary rejects both new client acquisition and late in-flight connection completion', async () => {
  const f = boundaryFixture();
  const connected = deferred();
  let acquired = 0;
  const client = { dispose: () => f.detach.push('client'), ensureConnected: () => connected.promise };
  f.host.runtimeSupervisorClients = new Map([['original-client', client]]);
  f.host.getRuntimeStoragePathFromBackend = () => { acquired++; return '/controlled/original'; };
  f.host.buildRuntimeSupervisorClientKey = () => 'original-client';
  const pending = f.host.getRuntimeSupervisorClientForBackend({ kind: 'controlled' });
  const rejected = assert.rejects(pending, /permanent.*boundary/i);
  const report = await completed(f.clock, f.host.prepareForDeactivation(), 'empty permanent departure');
  assert.equal(report.kind, 'settled');
  connected.resolve();
  await rejected;
  await assert.rejects(f.host.getRuntimeSupervisorClientForBackend({ kind: 'controlled' }), /permanent.*boundary/i);
  assert.equal(acquired, 1, 'new acquisition is rejected before the factory path');
  assert.equal(f.host.runtimeSupervisorClients.size, 0);
});

test('boundary capability leaves failed reset and delete abortable with original nodes and bindings', async () => {
  for (const scope of ['single-root', 'multi-root', 'delete']) {
    const f = boundaryFixture({ roots: scope === 'multi-root'
      ? [{ path: '/controlled/a', name: 'a' }, { path: '/controlled/b', name: 'b' }] : [] });
    const before = f.host.state;
    const binding = { nodeId: 'terminal-1', runtimeSessionId: 'original' };
    f.host.runtimeSessionBindings.set('original', binding);
    const execution = f.owner.reserve('terminal:terminal-1');
    const errors = [];
    f.host.postMessage = value => errors.push(value);
    const pending = scope === 'delete' ? f.host.deleteNode('terminal-1') : f.host.resetState();
    const outcome = scope === 'single-root' ? assert.rejects(pending, /cleanup is unconfirmed/) : pending;
    f.clock.advance(40);
    await completed(f.clock, outcome, `${scope} abortable failure`);
    assert.strictEqual(f.host.state, before, scope);
    assert.strictEqual(f.owner.get(execution.key), execution, scope);
    assert.strictEqual(f.host.runtimeSessionBindings.get('original'), binding, scope);
    assert.equal(f.writes.length, 0, scope);
    assert.equal(f.owner.snapshot().permanent, false, scope);
    if (scope === 'delete') assert.equal(errors.at(-1).type, 'host/error');
  }
});

test('actual extension deactivate preserves manager references across controlled concurrent calls', async () => {
  const filename = path.resolve('extensions/vscode/dev-session-canvas/src/extension.ts');
  const source = await readFile(filename, 'utf8');
  const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'deactivate');
  assert.ok(declaration?.body, 'the actual extension deactivate function must exist');
  // Execute the unchanged function with a controlled lexical binding, not the full activation lifecycle.
  const bundle = await esbuild.build({ stdin: { loader: 'ts', contents: `
    let activePanelManager;
    ${declaration.getText(ast)}
    export function setManager(value) { activePanelManager = value; }
    export function getManager() { return activePanelManager; }
  ` }, bundle: false, write: false, platform: 'node', format: 'cjs', target: 'node18' });
  const loaded = { exports: {} };
  new Function('module', 'exports', bundle.outputFiles[0].text)(loaded, loaded.exports);
  const { deactivate, setManager, getManager } = loaded.exports;
  await deactivate();
  assert.equal(getManager(), undefined);

  const close = deferred();
  let calls = 0;
  const manager = { prepareForDeactivation() { calls += 1; return close.promise; } };
  setManager(manager);
  const first = deactivate();
  assert.strictEqual(getManager(), manager, 'await must retain the original manager');
  const repeated = deactivate();
  assert.equal(calls, 2, 'concurrent calls must reach the same manager');
  assert.strictEqual(getManager(), manager);
  close.resolve();
  await Promise.all([first, repeated]);
  assert.equal(getManager(), undefined);

  const oldClose = deferred();
  const oldManager = { prepareForDeactivation: () => oldClose.promise };
  let replacementCalls = 0;
  const replacement = { async prepareForDeactivation() { replacementCalls += 1; } };
  setManager(oldManager);
  const oldResult = deactivate();
  setManager(replacement);
  oldClose.resolve();
  await oldResult;
  assert.strictEqual(getManager(), replacement, 'an old finally must not clear a replacement');
  await deactivate();
  assert.equal(replacementCalls, 1);
  assert.equal(getManager(), undefined);

  const failure = new Error('controlled deactivation failure');
  setManager({ prepareForDeactivation() { throw failure; } });
  await assert.rejects(deactivate(), error => error === failure);
  assert.equal(getManager(), undefined, 'same-manager cleanup still runs when preparation throws');

  const failClose = deferred();
  const failingManager = { prepareForDeactivation: () => failClose.promise.then(() => { throw failure; }) };
  setManager(failingManager);
  const rejection = assert.rejects(deactivate(), error => error === failure);
  assert.strictEqual(getManager(), failingManager);
  setManager(replacement);
  failClose.resolve();
  await rejection;
  assert.strictEqual(getManager(), replacement, 'a failed old finally must not clear a replacement');
  await deactivate();
  assert.equal(replacementCalls, 2);
  assert.equal(getManager(), undefined);
});

const persistenceCapabilities = [...boundaryCapabilities, 'terminal-local-settlement-v1', 'terminal-local-persistence-v1'];

async function persistenceFixture(options = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dsc-host-final-persistence-'));
  const root = path.join(directory, 'root');
  await mkdir(root);
  const f = fixture({ ...options, capabilities: persistenceCapabilities,
    budgets: { naturalDrainMs: 15, boundaryMs: 50, ...options.budgets }, roots: [{ path: root, name: 'root' }] });
  const updates = new Map();
  const writes = [];
  const configuration = { defaultSurface: 'editor', runtimePersistenceEnabled: false, filesFeatureEnabled: false };
  delete f.host.persistState;
  delete f.host.writeRootLocalCanvasSnapshot;
  Object.assign(f.host, {
    rawExtensionStoragePath: path.join(directory, 'workspace-storage'),
    context: { extensionMode: 3, globalStorageUri: { fsPath: path.join(directory, 'global-storage') },
      workspaceState: { async update(key, value) { updates.set(key, structuredClone(value)); } } },
    appliedStartupConfiguration: configuration, readStartupConfiguration: () => configuration,
    pendingWorkspaceStateUpdate: Promise.resolve(), lastLoadedRootLocalStates: [],
    syncNoteMarkdownFileWatchers() {}, cleanupUnreferencedNoteMarkdownRecoverableDraftFiles() {},
    recordStatePersistPerformance() {}, shouldPreserveLiveRuntimeAcrossHostBoundary: () => false,
    terminalReadRelay: { closeMatching() {} }, runtimeSupervisorClients: new Map()
  });
  Object.assign(f.host.state, { version: 1, updatedAt: '2026-09-26T00:00:00.000Z', nextGroupSequence: 1,
    fileReferences: [], suppressedFileActivityEdgeIds: [], suppressedAutomaticFileArtifactNodeIds: [] });
  for (const node of f.nodes) Object.assign(node, { title: `Original ${node.kind}`, position: { x: 10, y: 20 },
    size: { width: 640, height: 360 } });
  const write = f.host.writePersistedCanvasSnapshotToDisk.bind(f.host);
  f.host.writePersistedCanvasSnapshotToDisk = (filename, snapshot) => {
    writes.push(filename);
    return write(filename, snapshot);
  };
  const workspaceFile = f.host.getPersistedCanvasSnapshotPath();
  const rootFile = f.host.getRootLocalCanvasSnapshotPath(root);
  await f.host.persistState({ workspaceStateMode: 'full', requireRootLocalDurability: true });
  writes.length = 0;
  return { ...f, directory, root, updates, writes, workspaceFile, rootFile,
    async read(filename = workspaceFile) { return JSON.parse(await readFile(filename, 'utf8')); },
    async finish(kind, record, provider, { text, exitCode = 0, disposition = { kind: 'eof' } } = {}) {
      const frames = text === undefined ? 0 : 1;
      if (text !== undefined) {
        provider.output(1, text);
        await until(f.clock, () => record.execution.snapshot().adapter.acceptedThrough === frames, `${kind} disk tail accepted`);
      }
      provider.message({ type: 'processResult', result: { kind: 'exited', exitCode } });
      provider.message({ type: 'sourceEnd', finalFrameId: frames, disposition });
      provider.release();
      await until(f.clock, () => record.persistence?.result !== undefined, `${kind} final persistence result`);
      return record.persistence.result;
    },
    async cleanup() {
      f.host.clearDeferredCanvasStatePersistTimer();
      for (const record of f.host.nonNativeHostExecutions.values()) record.tracker.dispose();
      await f.host.pendingWorkspaceStateUpdate;
      await rm(directory, { recursive: true, force: true });
    }
  };
}

for (const kind of ['terminal', 'agent']) {
  test(`${kind} final snapshot-only persistence reads back actual root and workspace files before retirement`, async () => {
    for (const frames of [0, 1]) {
      const f = await persistenceFixture();
      let record;
      try {
        if (kind === 'agent') f.nodes.find(node => node.kind === kind).metadata.agent = {
          provider: 'codex', resumeStrategy: 'codex-session-id', resumeSessionId: 'explicit-provider-session'
        };
        const started = await f.started(kind);
        record = started.record;
        const exitCode = frames === 0 ? 0 : 7;
        const result = await f.finish(kind, record, started.provider,
          { text: frames ? 'disk-final-tail\r\n\x1b[4;9H' : undefined, exitCode });
        assert.equal(result.kind, 'saved', result.reason);
        assert.ok(Object.isFrozen(result));
        assert.strictEqual(await record.persistence.promise, result);
        assert.equal(record.persistence.submitted, true);
        assert.equal(record.execution.snapshot().terminal.kind, 'applied');
        assert.equal(record.execution.snapshot().retired, true);
        assert.equal(f.record(kind), undefined, 'only a successful save releases the retired Host record');
        const disk = await f.read();
        const rootDisk = await f.read(f.rootFile);
        const metadata = disk.state.nodes.find(node => node.id === `${kind}-1`).metadata[kind];
        assert.equal(metadata.persistenceMode, 'snapshot-only');
        assert.equal(metadata.liveSession, false);
        assert.equal(metadata.lifecycle, frames ? 'error' : kind === 'terminal' ? 'closed' : 'stopped');
        assert.equal(metadata.lastExitCode, exitCode);
        assert.equal(metadata.outputSequence, frames);
        assert.deepEqual(metadata.serializedTerminalState, { ...record.finalTerminal, outputSequence: frames });
        assert.deepEqual(rootDisk.state.nodes.find(node => node.id === `${kind}-1`).metadata[kind], metadata);
        assert.deepEqual(f.host.loadPersistedCanvasSnapshot().state, disk.state);
        assert.deepEqual(f.host.loadPersistedRootLocalCanvasSnapshot(f.root).state, rootDisk.state);
        for (const field of ['runtimeSessionId', 'runtimeBackend', 'runtimeStoragePath', 'terminalStream', 'terminalHistoryDiscarded']) {
          assert.equal(metadata[field], undefined, field);
        }
        if (kind === 'agent') assert.equal(metadata.resumeSessionId, 'explicit-provider-session');
        assert.deepEqual(f.writes, [f.rootFile, f.workspaceFile], 'one final save uses both original writers');
        const projectedState = [...f.updates.values()].find(value => Array.isArray(value?.nodes));
        const projectedMetadata = projectedState.nodes.find(node => node.id === `${kind}-1`).metadata[kind];
        assert.equal(projectedMetadata.serializedTerminalState, undefined,
          'the actual workspaceState projection must not copy the recovery snapshot');
        assert.equal(projectedMetadata.terminalStream, undefined);
        const { Terminal } = createRequire(import.meta.url)('@xterm/headless');
        const terminal = new Terminal({ cols: 80, rows: 24, allowProposedApi: true });
        try {
          await new Promise(resolve => terminal.write(metadata.serializedTerminalState.data, resolve));
          if (frames) {
            assert.equal(terminal.buffer.active.getLine(0).translateToString(true), 'disk-final-tail');
            assert.equal(terminal.buffer.active.cursorX, 8);
            assert.equal(terminal.buffer.active.cursorY, 3);
          } else {
            assert.equal(terminal.buffer.active.cursorX, 0);
            assert.equal(terminal.buffer.active.cursorY, 0);
          }
        } finally { terminal.dispose(); }
      } finally { record?.tracker.dispose(); await f.cleanup(); }
    }
  });
}

async function assertFinalSaveRetainsHost(f, record, kind, expected) {
  assert.equal(record.execution.snapshot().terminal.kind, 'applied');
  assert.equal(record.execution.snapshot().retired, true);
  assert.strictEqual(f.record(kind), record, 'owner retirement does not release pending or failed persistence');
  assert.equal(record.persistence.result?.kind, expected);
  const providers = f.providers.length;
  await assert.rejects(f.start(kind), /snapshot responsibility/i);
  assert.equal(f.providers.length, providers, 'a retained Host record blocks transport replacement');
  const node = f.host.state.nodes.find(node => node.id === `${kind}-1`);
  const errors = [];
  f.host.postMessage = message => errors.push(message);
  await completed(f.clock, f.host.deleteNode(node.id), 'retained final save delete');
  assert.strictEqual(f.host.state.nodes.find(candidate => candidate.id === node.id), node);
  assert.equal(errors.at(-1)?.type, 'host/error');
  await assert.rejects(completed(f.clock, f.host.resetState(), 'retained final save reset'), /snapshot persistence/i);
  assert.strictEqual(f.host.state.nodes.find(candidate => candidate.id === node.id), node);
  assert.strictEqual(f.record(kind), record);
}

test('final snapshot disk and workspaceState failures retain the original Host responsibility after owner retirement', async () => {
  for (const failure of ['root-file', 'workspace-file', 'workspace-update']) {
    const f = await persistenceFixture();
    const beforeRoot = await f.read(f.rootFile);
    const beforeWorkspace = await f.read();
    const { record, provider } = await f.started('terminal');
    try {
      if (failure === 'workspace-update') {
        f.host.context.workspaceState.update = async () => { throw new Error('controlled workspaceState update rejected'); };
      } else {
        await mkdir(`${failure === 'root-file' ? f.rootFile : f.workspaceFile}.tmp`);
      }
      const result = await f.finish('terminal', record, provider, { text: `final-${failure}` });
      assert.equal(result.kind, 'failed', failure);
      assert.equal(record.persistence.submitted, true);
      if (failure === 'workspace-update') assert.match(result.reason, /workspaceState update rejected/);
      else assert.match(result.reason, /EISDIR|illegal operation on a directory/i);
      if (failure === 'root-file') assert.deepEqual(await f.read(f.rootFile), beforeRoot);
      else assert.match((await f.read(f.rootFile)).state.nodes[0].metadata.terminal.serializedTerminalState.data, /final-/);
      if (failure !== 'workspace-update') assert.deepEqual(await f.read(), beforeWorkspace);
      else assert.match((await f.read()).state.nodes[0].metadata.terminal.serializedTerminalState.data, /final-/);
      const attempts = [...f.writes];
      await assertFinalSaveRetainsHost(f, record, 'terminal', 'failed');
      assert.deepEqual(f.writes, attempts, 'abortable operations cannot bypass a failed save by writing a fresh snapshot');
    } finally { record.tracker.dispose(); await f.cleanup(); }
  }
});

test('pending final persistence blocks restart delete and reset while the original submitted write may complete after cutoff', async () => {
  const f = await persistenceFixture();
  const update = deferred();
  const entered = deferred();
  const originalUpdate = f.host.context.workspaceState.update;
  f.host.context.workspaceState.update = async (...args) => {
    entered.resolve();
    await update.promise;
    return originalUpdate(...args);
  };
  const { record, provider } = await f.started('agent');
  try {
    provider.output(1, 'submitted-before-cutoff');
    await until(f.clock, () => record.execution.snapshot().adapter.acceptedThrough === 1, 'pending save tail');
    provider.process(); provider.seal(1); provider.release();
    await completed(f.clock, entered.promise, 'pending original workspace update');
    await until(f.clock, () => record.execution.snapshot().retired, 'pending save owner retired');
    assert.equal(record.persistence.submitted, true);
    assert.equal(record.persistence.result, undefined);
    assert.match((await f.read()).state.nodes.find(node => node.kind === 'agent').metadata.agent.serializedTerminalState.data,
      /submitted-before-cutoff/, 'a delayed workspaceState update is not a delayed disk write');
    await assertFinalSaveRetainsHost(f, record, 'agent', undefined);
    const closing = f.host.prepareForDeactivation();
    const attempts = [...f.writes];
    await pump(f.clock, () => true);
    f.clock.advance(50);
    const report = await completed(f.clock, closing, 'pending save permanent cutoff');
    assert.equal(report.canvasSnapshot.kind, 'unconfirmed');
    assert.equal(report.local.kind, 'settled');
    assert.equal(record.persistence.result, undefined, 'a Host deadline does not settle the original submitted operation');
    update.resolve();
    const saved = await completed(f.clock, record.persistence.promise, 'late original workspace update');
    assert.equal(saved.kind, 'saved');
    assert.equal(f.record('agent'), undefined);
    assert.strictEqual(await f.host.prepareForDeactivation(), report);
    assert.deepEqual(f.writes, attempts, 'late completion cannot submit another disk write');
  } finally { update.resolve(); record.tracker.dispose(); await f.cleanup(); }
});

test('a final tracker flush after the permanent cutoff cannot patch metadata or submit final persistence', async () => {
  const f = await persistenceFixture();
  const { record, provider } = await f.started('terminal');
  const gate = deferred();
  const entered = deferred();
  const flush = record.tracker.flush.bind(record.tracker);
  try {
    provider.output(1, 'flush-after-cutoff');
    await until(f.clock, () => record.execution.snapshot().adapter.consumedThrough === 1, 'cutoff consumed tail');
    const metadata = f.host.state.nodes.find(node => node.kind === 'terminal').metadata.terminal;
    record.tracker.flush = async () => { entered.resolve(); await gate.promise; return flush(); };
    const closing = f.host.prepareForDeactivation();
    provider.process(); provider.seal(1); provider.release();
    await completed(f.clock, entered.promise, 'cutoff original final flush');
    const attempts = [...f.writes];
    const atCutoff = await f.read();
    f.clock.advance(50);
    const report = await completed(f.clock, closing, 'final flush cutoff report');
    assert.equal(report.canvasSnapshot.kind, 'unconfirmed');
    assert.equal(record.persistence.submitted, false);
    gate.resolve();
    const result = await completed(f.clock, record.persistence.promise, 'late flush persistence observation');
    assert.equal(result.kind, 'unconfirmed');
    assert.match(result.reason, /boundary ended/);
    assert.equal(record.execution.snapshot().terminal.kind, 'applied');
    assert.equal(record.persistence.submitted, false);
    assert.strictEqual(f.host.state.nodes.find(node => node.kind === 'terminal').metadata.terminal, metadata);
    assert.strictEqual(f.record('terminal'), record);
    assert.deepEqual(f.writes, attempts);
    assert.deepEqual(await f.read(), atCutoff);
    assert.strictEqual(await f.host.prepareForDeactivation(), report);
  } finally { gate.resolve(); record.tracker.dispose(); await f.cleanup(); }
});

test('final persistence follows the original execution metadata while preserving current layout and unrelated nodes', async () => {
  for (const replacement of ['layout-only', 'execution-metadata']) {
    const f = await persistenceFixture();
    const { record, provider } = await f.started('agent');
    const before = await f.read();
    const original = f.host.state.nodes.find(node => node.kind === 'agent');
    const changed = { ...original, title: 'Changed during execution', position: { x: 401, y: 902 },
      metadata: replacement === 'layout-only' ? original.metadata
        : { ...original.metadata, agent: { ...original.metadata.agent, resumeSessionId: 'replacement-session' } } };
    f.host.state = { ...f.host.state,
      nodes: [...f.host.state.nodes.map(node => node === original ? changed : node),
        { id: 'concurrent-note', kind: 'note', title: 'Concurrent note', position: { x: 5, y: 6 },
          size: { width: 200, height: 160 }, metadata: {} }] };
    try {
      const result = await f.finish('agent', record, provider, { text: 'identity-checked-tail' });
      if (replacement === 'layout-only') {
        assert.equal(result.kind, 'saved', result.reason);
        const saved = (await f.read()).state;
        assert.equal(saved.nodes.find(node => node.kind === 'agent').title, changed.title);
        assert.deepEqual(saved.nodes.find(node => node.kind === 'agent').position, changed.position);
        assert.equal(saved.nodes.some(node => node.id === 'concurrent-note'), true);
      } else {
        assert.equal(result.kind, 'unconfirmed');
        assert.match(result.reason, /metadata binding changed/);
        assert.equal(record.persistence.submitted, false);
        assert.strictEqual(f.host.state.nodes.find(node => node.kind === 'agent'), changed);
        assert.deepEqual(await f.read(), before);
        assert.deepEqual(f.writes, []);
        await assertFinalSaveRetainsHost(f, record, 'agent', 'unconfirmed');
      }
    } finally { record.tracker.dispose(); await f.cleanup(); }
  }
});

test('unknown process and failed final flush preserve old disk state while interrupted output keeps its actual disposition', async () => {
  for (const outcome of ['process-unknown', 'flush-failed', 'source-interrupted']) {
    const f = await persistenceFixture();
    const { record, provider } = await f.started('terminal');
    const metadata = f.host.state.nodes.find(node => node.kind === 'terminal').metadata.terminal;
    const before = await f.read();
    try {
      provider.output(1, 'original-received-tail');
      await until(f.clock, () => record.execution.snapshot().adapter.consumedThrough === 1, 'invalid final state tail');
      if (outcome === 'flush-failed') record.tracker.flush = async () => { throw new Error('controlled final disk-state flush failed'); };
      provider.message({ type: 'processResult', result: outcome === 'process-unknown'
        ? { kind: 'unconfirmed', reason: 'original process result unavailable' } : { kind: 'exited', exitCode: 0 } });
      provider.message({ type: 'sourceEnd', finalFrameId: 1, disposition: outcome === 'source-interrupted'
        ? { kind: 'interrupted', reason: 'original source was cancelled' } : { kind: 'eof' } });
      provider.release();
      const result = await completed(f.clock, record.persistence.promise, `${outcome} persistence result`);
      if (outcome === 'source-interrupted') {
        assert.equal(result.kind, 'saved', result.reason);
        const saved = (await f.read()).state.nodes.find(node => node.kind === 'terminal').metadata.terminal;
        assert.equal(saved.lastRuntimeError, 'original source was cancelled');
        assert.match(saved.lastExitMessage, /Output is incomplete/);
        assert.equal(record.execution.snapshot().adapter.seal.source.kind, 'interrupted');
        assert.match(saved.serializedTerminalState.data, /original-received-tail/);
      } else {
        assert.equal(result.kind, outcome === 'flush-failed' ? 'failed' : 'unconfirmed');
        assert.equal(record.persistence.submitted, false);
        assert.strictEqual(f.host.state.nodes.find(node => node.kind === 'terminal').metadata.terminal, metadata);
        assert.deepEqual(await f.read(), before);
        assert.deepEqual(f.writes, []);
        assert.strictEqual(f.record('terminal'), record);
        assert.equal(record.execution.snapshot().terminal.kind, outcome === 'flush-failed' ? 'failed' : 'applied');
      }
    } finally { record.tracker.dispose(); await f.cleanup(); }
  }
});

const candidateCapabilities = [
  'execution-lifecycle-v1', 'execution-close-observation-v1', 'execution-parent-cleanup-v1',
  'execution-owner-boundary-v1', 'terminal-interaction-v1',
  'terminal-local-settlement-v1', 'terminal-local-persistence-v1'
];

function candidateFixture(options = {}) {
  const f = localFixture({ ...options, exposeParentControl: true });
  const originalFactory = f.injection.createTransport;
  const injection = {
    ...f.injection, profile: EXECUTION_CANDIDATE_PROFILE, profileMode: 'snapshot-only',
    capabilities: candidateCapabilities, budgets: EXECUTION_CANDIDATE_BUDGETS,
    createTransport(identity) {
      const transport = originalFactory(identity);
      const connect = transport.connect.bind(transport);
      transport.connect = sink => connect({ ...sink, message(message) {
        sink.message(message.type === 'ready'
          ? { ...message, capabilities: ['execution-lifecycle-v1', 'terminal-interaction-v1'] } : message);
      } });
      return transport;
    }
  };
  const owner = new ExecutionOwnerLifecycle(injection);
  f.host.nonNativeExecutionOwner = options.withOwner === false ? undefined : owner;
  f.host.executionCandidateProfile = EXECUTION_CANDIDATE_PROFILE;
  f.host.activeSurface = 'editor';
  f.host.surfaceLifecycle = { editor: { generation: 1, mode: 'active', frameId: 'candidate-editor',
    ready: true, bootstrapAck: true, terminalLocalSettlementV1: true, terminalReadSettlementV1: true },
    panel: { generation: 1, mode: 'inactive', frameId: 'candidate-panel', ready: false, bootstrapAck: false } };
  f.host.resolveRuntimeStoragePath = value => value || '/controlled/current-runtime';
  f.host.getPersistedRuntimeStoragePath = metadata => metadata.runtimeStoragePath;
  f.host.promptAgentCliSelectionAfterCommandNotFound = () => {};
  f.host.retireLegacyRuntimeSupervisorClientIfUnused = () => {};
  f.host.pendingRuntimeSupervisorOperations = new Set();
  f.host.runtimeSupervisorClients = new Map();
  const posted = [];
  f.host.postMessage = message => posted.push(message);
  function start(kind) {
    return kind === 'agent' ? f.host.startAgentSession('agent-1', 80, 24, undefined, false)
      : f.host.startTerminalSession('terminal-1', 80, 24);
  }
  return { ...f, owner, injection, posted, start };
}

function candidateRuntimeFixture(options = {}) {
  const f = candidateFixture(options);
  const creates = [];
  const applies = [];
  const subscriptions = [];
  const errors = [];
  const agentStart = f.host.startAgentSessionWithSupervisor.bind(f.host);
  f.host.startAgentSessionWithSupervisor = async (...args) => {
    try { return await agentStart(...args); }
    catch (error) { errors.push(error instanceof Error ? error.message : String(error)); throw error; }
  };
  const backend = { kind: 'legacy-detached', guarantee: 'best-effort' };
  const client = {
    supportsTerminalSessionStream: () => true,
    supportsTerminalPagedRead: () => false,
    supportsExecutionCandidateProfile: profile => profile === EXECUTION_CANDIDATE_PROFILE,
    async createSession(request) {
      creates.push(request);
      return { sessionId: request.sessionId, kind: request.kind, runtimeBackend: backend.kind,
        live: true, lifecycle: request.kind === 'agent' ? 'running' : 'live' };
    },
    deleteSession: () => assert.fail('candidate replacement must not use ordinary delete/reconnect')
  };
  Object.assign(f.host, {
    isRuntimePersistenceEnabled: () => true,
    getPreferredRuntimeSupervisorClient: async () => ({ client, backend, runtimeStoragePath: '/controlled/new-runtime' }),
    disposeAgentFileActivitySession: async () => {},
    createConfiguredAgentFileActivitySession: () => ({ extraArgs: [], extraEnv: {}, dispose: async () => {} }),
    bindAgentFileActivitySession() {},
    applyRuntimeSupervisorSnapshot: async (...args) => { applies.push(args); },
    subscribeRuntimeSupervisorTerminalStream: async (...args) => { subscriptions.push(args); }
  });
  return { ...f, client, backend, creates, applies, subscriptions, errors };
}

function addCandidateLegacyBinding(f, kind, backendKind = 'legacy-detached') {
  const node = f.host.state.nodes.find(value => value.kind === kind);
  const sessionId = `old-${kind}`;
  const runtimeStoragePath = `/controlled/original-${kind}`;
  node.metadata[kind] = { persistenceMode: 'live-runtime', attachmentState: 'reattaching',
    liveSession: true, runtimeSessionId: sessionId, runtimeStoragePath, runtimeBackend: backendKind,
    lifecycle: kind === 'agent' ? 'running' : 'live', provider: kind === 'agent' ? 'codex' : undefined };
  f.host.bindRuntimeSession(node.id, kind, sessionId, runtimeStoragePath, backendKind);
  return { nodeId: node.id, kind, backendKind, sessionId, runtimeStoragePath };
}

function candidateStrictDeletes(f, behavior) {
  const calls = [];
  const connections = [];
  f.host.getRuntimeHostBackend = (kind, runtimeStoragePath) => ({ kind, runtimeStoragePath, guarantee: 'best-effort' });
  f.host.getRuntimeSupervisorClientForBackend = async (backend, options) => {
    connections.push({ backend, options });
    assert.equal(options.allowRestart, false);
    assert.equal(options.deferConnection, true);
    return {
      deleteSession: () => assert.fail('strict deletion must not enter ordinary RPC'),
      deleteSessionStrict(params, observed) {
        calls.push({ backend, params, observed });
        return behavior(params, observed, backend);
      }
    };
  };
  return { calls, connections };
}

function settledLegacyDelete(kind, reason) {
  const result = Object.freeze({ kind, ...(reason ? { reason } : {}) });
  return { first: Promise.resolve(result), current: () => result, submitted: true };
}

for (const kind of ['terminal', 'agent']) {
  test(`S9 ${kind} snapshot candidate starts only the explicitly profiled local owner`, async () => {
    const f = candidateFixture();
    f.host.getPreferredRuntimeSupervisorClient = () => assert.fail('snapshot-only must not acquire a Supervisor');
    await completed(f.clock, f.start(kind), `${kind} candidate local start`);
    assert.equal(f.providers.length, 1);
    assert.equal(f.providers[0].messages.filter(message => message.type === 'start').length, 1);
    assert.equal(f.owner.options.profile, EXECUTION_CANDIDATE_PROFILE);
    assert.equal(f.owner.options.profileMode, 'snapshot-only');
    assert.deepEqual(f.owner.options.budgets, EXECUTION_CANDIDATE_BUDGETS);
    const record = f.record(kind);
    try {
      f.providers[0].process();
      f.providers[0].message({ type: 'resourceResult', resourceId: 'subject', operationId: 'subject-release',
        result: { kind: 'released' } });
      f.providers[0].seal(0); f.providers[0].release();
      await until(f.clock, () => record.execution.snapshot().settled, `${kind} candidate finalization`);
    } finally { record.tracker.dispose(); }
  });

  test(`S9 ${kind} explicit candidate without a local factory rejects before native creation`, async () => {
    const f = candidateFixture({ withOwner: false });
    const before = structuredClone(f.host.state);
    await assert.rejects(f.start(kind), /candidate|profile|factory|provider/i);
    assert.equal(f.providers.length, 0);
    assert.deepEqual(f.host.state, before);
    assert.equal(f.persisted.length, 0);
  });

  test(`S9 ${kind} Runtime candidate reaches Supervisor and never the local owner`, async () => {
    const f = candidateRuntimeFixture();
    await completed(f.clock, f.start(kind), `${kind} candidate Runtime create`);
    assert.equal(f.providers.length, 0);
    assert.equal(f.owner.snapshot().pending, 0);
    assert.equal(f.creates.length, 1, JSON.stringify({ posted: f.posted, errors: f.errors }));
    assert.equal(f.creates[0].executionProfile, EXECUTION_CANDIDATE_PROFILE);
    assert.equal(f.creates[0].kind, kind);
    assert.equal(typeof f.creates[0].sessionId, 'string');
    assert.ok(f.creates[0].sessionId.length > 0);
    assert.equal(f.applies.length, 1);
    assert.equal(f.subscriptions.length, 1);
    const binding = [...f.host.runtimeSessionBindings.values()][0];
    assert.equal(binding.runtimeSessionId, f.creates[0].sessionId);
    assert.equal(binding.runtimeStoragePath, '/controlled/new-runtime');
  });

  test(`S9 ${kind} Runtime candidate rejects missing server or current-page capability before create`, async () => {
    for (const missing of ['server', 'page']) {
      const f = candidateRuntimeFixture();
      if (missing === 'server') f.client.supportsExecutionCandidateProfile = () => false;
      else delete f.host.surfaceLifecycle.editor.terminalReadSettlementV1;
      if (missing === 'page') {
        await assert.rejects(f.start(kind), /page.*settlement/i);
      } else {
        await completed(f.clock, f.start(kind), `${kind} missing ${missing} capability`);
        assert.equal(f.posted.some(message => message.type === 'host/error'), true, missing);
      }
      assert.equal(f.creates.length, 0, missing);
      assert.equal(f.providers.length, 0, missing);
      assert.equal(f.host.runtimeSessionBindings.size, 0, missing);
    }
  });

  test(`S9 ${kind} old live attachment preserves original binding without new profile requirements`, async () => {
    const f = candidateRuntimeFixture();
    const previous = addCandidateLegacyBinding(f, kind, 'systemd-user');
    f.client.supportsExecutionCandidateProfile = () => assert.fail('old attachment is not new admission');
    f.host.getPreferredRuntimeSupervisorClient = () => assert.fail('old attachment must not select a new Supervisor');
    delete f.host.surfaceLifecycle.editor.terminalReadSettlementV1;
    let attached = 0;
    await f.host.attachPersistedRuntimeSession(kind, previous.nodeId, previous.sessionId, async () => {
      attached += 1;
      return { snapshot: { sessionId: previous.sessionId, kind, runtimeBackend: 'legacy-detached', live: true },
        terminalProjectionMode: 'legacy' };
    });
    assert.equal(attached, 1);
    assert.equal(f.applies.length, 1);
    assert.equal(f.subscriptions[0][1], previous.runtimeStoragePath);
    const binding = [...f.host.runtimeSessionBindings.values()][0];
    assert.equal(binding.runtimeSessionId, previous.sessionId);
    assert.equal(binding.runtimeStoragePath, previous.runtimeStoragePath);
    assert.equal(binding.runtimeBackend, previous.backendKind);
    assert.equal(binding.kind, kind);
    assert.equal(f.providers.length, 0);
    assert.equal(f.creates.length, 0);
  });

  test(`S9 ${kind} failed old live deletion preserves original metadata through the outer start entry`, async () => {
    const f = candidateRuntimeFixture();
    addCandidateLegacyBinding(f, kind);
    const before = structuredClone(f.host.state);
    const bindings = [...f.host.runtimeSessionBindings.entries()];
    const strict = candidateStrictDeletes(f, () => settledLegacyDelete('failed', 'original Supervisor delete failed'));
    await completed(f.clock, f.start(kind), `${kind} failed replacement`);
    assert.equal(strict.calls.length, 1);
    assert.equal(f.creates.length, 0);
    assert.equal(f.providers.length, 0);
    assert.deepEqual(f.host.state, before);
    assert.deepEqual([...f.host.runtimeSessionBindings.entries()], bindings);
    assert.equal(f.persisted.length, 0);
    assert.equal(f.posted.some(message => message.type === 'host/error'), true);
  });
}

test('S9 reset attempts both original backends but does not clear nodes or bindings after partial failure', async () => {
  const f = candidateFixture();
  addCandidateLegacyBinding(f, 'terminal', 'legacy-detached');
  addCandidateLegacyBinding(f, 'agent', 'systemd-user');
  delete f.host.collectPersistedLiveRuntimeSessions;
  const before = structuredClone(f.host.state);
  const bindings = [...f.host.runtimeSessionBindings.entries()];
  const strict = candidateStrictDeletes(f, params => settledLegacyDelete(
    params.sessionId === 'old-terminal' ? 'failed' : 'legacy-acknowledged', 'controlled first-backend failure'));
  await assert.rejects(completed(f.clock, f.host.resetState(), 'candidate partial reset'), /delete|failed|unconfirmed/i);
  assert.deepEqual(strict.calls.map(call => call.params.sessionId).sort(), ['old-agent', 'old-terminal']);
  assert.deepEqual(strict.calls.map(call => call.observed.deadline), [20000, 20000]);
  assert.deepEqual(f.host.state, before);
  assert.deepEqual([...f.host.runtimeSessionBindings.entries()], bindings);
  assert.equal(f.persisted.length, 0);
  assert.equal(f.rootWrites.length, 0);
});

test('S9 strict delete reports only legacy acknowledgements and absence as permitted old-protocol results', async () => {
  for (const kind of ['legacy-acknowledged', 'legacy-absent']) {
    const f = candidateFixture();
    const session = addCandidateLegacyBinding(f, 'terminal');
    const strict = candidateStrictDeletes(f, () => settledLegacyDelete(kind));
    await f.host.deleteRuntimeSupervisorSessionStrict(session, { allowRestart: true });
    assert.equal(strict.calls.length, 1);
    assert.equal(strict.calls[0].observed.deadline, 20000);
    assert.equal(strict.connections[0].options.allowRestart, false);
    assert.equal(f.providers.length, 0);
  }
});

test('S9 explicit snapshot profile does not inherit a legacy injected owner capability promise', async () => {
  const f = fixture();
  f.host.executionCandidateProfile = EXECUTION_CANDIDATE_PROFILE;
  for (const kind of ['terminal', 'agent']) {
    await assert.rejects(f.start(kind), /profile|candidate|capabilit/i);
  }
  assert.equal(f.providers.length, 0);
  assert.equal(f.owner.snapshot().pending, 0);
  assert.equal(f.persisted.length, 0);
});

test('S9 reset clears the canvas only after every original legacy deletion has an allowed result', async () => {
  const f = candidateFixture();
  addCandidateLegacyBinding(f, 'terminal', 'legacy-detached');
  addCandidateLegacyBinding(f, 'agent', 'systemd-user');
  delete f.host.collectPersistedLiveRuntimeSessions;
  const strict = candidateStrictDeletes(f, params => settledLegacyDelete(
    params.sessionId === 'old-terminal' ? 'legacy-absent' : 'legacy-acknowledged'));
  await completed(f.clock, f.host.resetState(), 'candidate acknowledged reset');
  assert.equal(strict.calls.length, 2);
  assert.equal(f.host.state.nodes.length, 0);
  assert.equal(f.host.runtimeSessionBindings.size, 0);
  assert.equal(f.persisted.length, 1);
  assert.equal(f.providers.length, 0);
});

test('S9 expired reset retains its original delete and late success cannot clear the canvas or resend', async () => {
  const f = candidateFixture();
  addCandidateLegacyBinding(f, 'terminal');
  delete f.host.collectPersistedLiveRuntimeSessions;
  const before = structuredClone(f.host.state);
  const bindings = [...f.host.runtimeSessionBindings.entries()];
  const first = deferred();
  let current;
  const strict = candidateStrictDeletes(f, (_params, observed) => {
    observed.scheduler.scheduleDeadline(observed.deadline, () => first.resolve(
      { kind: 'unconfirmed', reason: 'original delete deadline elapsed' }));
    return { first: first.promise, current: () => current, submitted: true };
  });
  const resetting = f.host.resetState();
  const failed = assert.rejects(resetting, /delete|unconfirmed|deadline/i);
  await until(f.clock, () => strict.calls.length === 1, 'candidate original pending delete');
  await assert.rejects(f.start('terminal'), /boundary|admission|delete/i);
  assert.equal(f.providers.length, 0);
  f.clock.advance(20000);
  await completed(f.clock, failed, 'candidate reset deadline');
  await assert.rejects(completed(f.clock, f.host.resetState(), 'candidate repeated pending reset'), /delete|unconfirmed|deadline/i);
  assert.equal(strict.calls.length, 1, 'the same binding must retain its original request');
  current = { kind: 'legacy-acknowledged' };
  await pump(f.clock, () => true);
  assert.deepEqual(f.host.state, before);
  assert.deepEqual([...f.host.runtimeSessionBindings.entries()], bindings);
  assert.equal(f.persisted.length, 0);
  assert.equal(f.rootWrites.length, 0);
});

test('S9 multi-root reset shares one delete deadline and preserves root files after an independent backend fails', async () => {
  const roots = [{ path: '/controlled/root-a', name: 'root-a' }, { path: '/controlled/root-b', name: 'root-b' }];
  const f = candidateFixture({ roots });
  addCandidateLegacyBinding(f, 'terminal', 'legacy-detached');
  addCandidateLegacyBinding(f, 'agent', 'systemd-user');
  delete f.host.collectPersistedLiveRuntimeSessions;
  const before = structuredClone(f.host.state);
  const bindings = [...f.host.runtimeSessionBindings.entries()];
  const pending = deferred();
  const strict = candidateStrictDeletes(f, (params, observed) => {
    if (params.sessionId === 'old-terminal') return settledLegacyDelete('failed', 'first root backend failed');
    observed.scheduler.scheduleDeadline(observed.deadline, () => pending.resolve(
      { kind: 'unconfirmed', reason: 'second root original request deadline' }));
    return { first: pending.promise, current: () => undefined, submitted: true };
  });
  const resetting = f.host.resetState();
  await until(f.clock, () => strict.calls.length === 2, 'both multi-root original backends attempted');
  assert.deepEqual(strict.calls.map(call => call.observed.deadline), [20000, 20000]);
  assert.deepEqual(strict.calls.map(call => call.params.sessionId).sort(), ['old-agent', 'old-terminal']);
  assert.deepEqual(f.host.state, before);
  assert.equal(f.rootWrites.length, 0);
  f.clock.advance(20000);
  await completed(f.clock, resetting, 'multi-root reset fixed cutoff');
  assert.deepEqual(f.host.state, before);
  assert.deepEqual([...f.host.runtimeSessionBindings.entries()], bindings);
  assert.equal(f.rootWrites.length, 0);
  assert.equal(f.persisted.length, 0);
});

for (const kind of ['terminal', 'agent']) {
  for (const result of ['late-success', 'disconnected']) {
    test(`S9 ${kind} submitted create blocks duplicate start delete and reset while ${result} retains its identity`, async () => {
      const f = candidateRuntimeFixture();
      delete f.host.collectPersistedLiveRuntimeSessions;
      const originalCreate = f.client.createSession.bind(f.client);
      const acquired = deferred();
      let rejectCreate;
      const reply = new Promise((resolve, reject) => { acquired.resolveReply = resolve; rejectCreate = reject; });
      f.client.createSession = async request => {
        f.creates.push(request);
        acquired.resolve(request);
        return reply;
      };
      const strict = candidateStrictDeletes(f, () => settledLegacyDelete('legacy-absent'));
      const launching = f.start(kind);
      const request = await completed(f.clock, acquired.promise, `${kind} original create submission`);
      const before = structuredClone(f.host.state);
      const token = f.host.executionSessionOperationTokens.get(`${kind}:${kind}-1`);
      const errorsBeforeDuplicate = f.posted.filter(message => message.type === 'host/error').length;
      await completed(f.clock, f.start(kind), `${kind} pending create duplicate refusal`);
      assert.equal(f.posted.filter(message => message.type === 'host/error').length, errorsBeforeDuplicate + 1);
      await completed(f.clock, f.host.deleteNode(`${kind}-1`), `${kind} pending create delete refusal`);
      await assert.rejects(completed(f.clock, f.host.resetState(), `${kind} pending create reset refusal`),
        /creation|pending|unconfirmed/i);
      assert.equal(f.host.executionSessionOperationTokens.get(`${kind}:${kind}-1`), token,
        'refused mutation cannot invalidate the original creation token');
      assert.deepEqual(f.host.state, before);
      assert.equal(f.creates.length, 1);
      assert.equal(strict.calls.length, 0, 'record absence cannot settle an in-flight original create');
      if (result === 'late-success') {
        acquired.resolveReply({ sessionId: request.sessionId, kind, runtimeBackend: 'legacy-detached', live: true,
          lifecycle: kind === 'agent' ? 'running' : 'live' });
      } else {
        rejectCreate(new Error('original create connection lost after submission'));
      }
      await completed(f.clock, launching, `${kind} ${result} original create result`);
      assert.equal(f.creates.length, 1);
      assert.equal(strict.calls.length, 0);
      assert.equal(f.providers.length, 0);
      const metadata = f.host.state.nodes.find(node => node.kind === kind).metadata[kind];
      assert.equal(metadata.runtimeSessionId, request.sessionId);
      assert.equal(metadata.runtimeStoragePath, '/controlled/new-runtime');
      if (result === 'late-success') {
        assert.equal(f.applies.length, 1);
        assert.equal(f.applies[0][2].sessionId, request.sessionId);
        assert.equal([...f.host.runtimeSessionBindings.values()][0].runtimeSessionId, request.sessionId);
      } else {
        assert.equal(f.applies.length, 0);
        const errorsBeforeRetry = f.posted.filter(message => message.type === 'host/error').length;
        await completed(f.clock, f.start(kind), `${kind} unconfirmed create duplicate refusal`);
        assert.equal(f.posted.filter(message => message.type === 'host/error').length, errorsBeforeRetry + 1);
        await completed(f.clock, f.host.deleteNode(`${kind}-1`), `${kind} unconfirmed create delete refusal`);
        assert.equal(f.host.state.nodes.some(node => node.id === `${kind}-1`), true);
        assert.equal(strict.calls.length, 0);
      }
      f.client.createSession = originalCreate;
    });
  }

  test(`S9 ${kind} completed broadcast during strict delete retains binding and no Runtime body or second delete`, async () => {
    const f = candidateFixture();
    const session = addCandidateLegacyBinding(f, kind);
    const bindings = [...f.host.runtimeSessionBindings.entries()];
    const metadata = f.host.state.nodes.find(node => node.kind === kind).metadata[kind];
    metadata.recentOutput = 'old-inline-body';
    metadata.serializedTerminalState = { data: 'old-inline-state', cols: 80, rows: 24, revision: 1 };
    const reply = deferred();
    const strict = candidateStrictDeletes(f, () => ({ first: reply.promise, current: () => undefined, submitted: true }));
    Object.assign(f.host, {
      flushExecutionStateSyncTimer() {}, clearExecutionTerminalProjectionRefreshTimers() {},
      disposeManagedExecutionSession() {}, disposeAgentFileActivitySession: async () => {}
    });
    const deleting = f.host.deleteRuntimeSupervisorSessionStrict(session, { allowRestart: false });
    const rejected = assert.rejects(deleting, /delete|failed|unconfirmed/i);
    await until(f.clock, () => strict.calls.length === 1, `${kind} original strict delete sent`);
    await f.host.applyCompletedRuntimeSupervisorSnapshot(session.nodeId, kind, {
      sessionId: session.sessionId, kind, runtimeBackend: session.backendKind, live: false, lifecycle: 'exited',
      cols: 80, rows: 24, output: 'completed-body-must-not-persist', outputSequence: 1,
      serializedTerminalState: { data: 'completed-state-must-not-persist', cols: 80, rows: 24, revision: 1 },
      lastExitCode: 0, cwd: '/controlled', shellPath: '/controlled/shell'
    });
    assert.equal(strict.calls.length, 1, 'completion broadcast must not create a second cleanup request');
    assert.deepEqual([...f.host.runtimeSessionBindings.entries()], bindings);
    const completedMetadata = f.host.state.nodes.find(node => node.kind === kind).metadata[kind];
    assert.equal(completedMetadata.runtimeSessionId, session.sessionId);
    assert.equal(completedMetadata.runtimeStoragePath, session.runtimeStoragePath);
    assert.equal(completedMetadata.liveSession, false);
    assert.equal(completedMetadata.terminalHistoryDiscarded, true);
    assert.equal(completedMetadata.recentOutput, undefined);
    assert.equal(completedMetadata.serializedTerminalState, undefined);
    assert.equal(completedMetadata.terminalStream, undefined);
    assert.equal(f.persisted.length, 1);
    reply.resolve({ kind: 'failed', reason: 'original delete acknowledgement failed' });
    await completed(f.clock, rejected, `${kind} strict failure after completion broadcast`);
    assert.deepEqual([...f.host.runtimeSessionBindings.entries()], bindings);
    assert.equal(f.host.state.nodes.find(node => node.kind === kind).metadata[kind].runtimeSessionId, session.sessionId);
    assert.equal(strict.calls.length, 1);
    assert.equal(f.providers.length, 0);
  });
}

function candidateCompletedSnapshot(session, options = {}) {
  return { sessionId: session.sessionId, kind: session.kind, runtimeBackend: session.backendKind,
    live: false, lifecycle: 'exited', cols: 80, rows: 24, output: 'must-not-persist', outputSequence: 1,
    lastExitCode: 0, cwd: '/controlled', shellPath: '/controlled/shell', ...options };
}

function configureCandidateCompletionBoundaries(f) {
  Object.assign(f.host, {
    flushExecutionStateSyncTimer() {}, clearExecutionTerminalProjectionRefreshTimers() {},
    disposeManagedExecutionSession() {}, disposeAgentFileActivitySession: async () => {}
  });
}

for (const kind of ['terminal', 'agent']) {
  for (const timing of ['reader-opening-crosses-cutoff', 'broadcast-after-cutoff']) {
    test(`S9 ${kind} strict finalization ${timing} cannot persist or release the original delete responsibility`, async () => {
      const f = candidateFixture();
      configureCandidateCompletionBoundaries(f);
      const session = addCandidateLegacyBinding(f, kind);
      const before = structuredClone(f.host.state);
      const bindings = [...f.host.runtimeSessionBindings.entries()];
      const deleteReply = deferred();
      let deleteCurrent;
      const strict = candidateStrictDeletes(f, () => ({ first: deleteReply.promise,
        current: () => deleteCurrent, submitted: true }));
      const deleting = f.host.deleteRuntimeSupervisorSessionStrict(session, { allowRestart: false });
      const deleteRejected = assert.rejects(deleting, /delete|expired|unconfirmed/i);
      await until(f.clock, () => strict.calls.length === 1, `${kind} strict request before finalization cutoff`);
      const record = [...f.host.strictRuntimeDeletes.values()][0];
      assert.equal(record.deadline, 20000);
      const authorityId = `original-${kind}-authority`;
      const snapshot = candidateCompletedSnapshot(session, { terminalStreamPaged: true, terminalAuthorityId: authorityId,
        terminalRevision: 1, terminalFinalRevision: 1, capabilities: { terminalReadSettlementV1: true } });
      const openReply = deferred();
      let opening;
      let finalizing;
      let finalizationRejected;
      const key = `editor:${kind}:${session.nodeId}`;
      if (timing === 'reader-opening-crosses-cutoff') {
        opening = f.host.terminalReadRelay.open(key, { openTerminalRead: () => openReply.promise },
          session.sessionId, authorityId, 'editor', undefined, 'final-application-v1');
        finalizing = f.host.applyCompletedRuntimeSupervisorSnapshot(session.nodeId, kind, snapshot);
        finalizationRejected = assert.rejects(finalizing, /finalization deadline expired/i);
        await until(f.clock, () => f.host.terminalReadRelay.getCompleted(key)?.revision === 1,
          `${kind} actual relay waiting for original open`);
        assert.equal(f.persisted.length, 0);
      }
      f.clock.advance(20000);
      await completed(f.clock, deleteRejected, `${kind} original delete first cutoff`);
      const first = await record.first;
      assert.equal(first.kind, 'unconfirmed');
      deleteCurrent = { kind: 'legacy-acknowledged' };
      deleteReply.resolve(deleteCurrent);
      if (timing === 'reader-opening-crosses-cutoff') {
        openReply.resolve({ readId: 'original-reader', sessionId: session.sessionId, authorityId,
          checkpoint: { version: 1, sessionId: session.sessionId, authorityId, revision: 0,
            cols: 80, rows: 24, scrollback: 100, createdAtMs: 1,
            serializedState: { format: 'xterm-serialize-v1', data: '', outputSequence: 0 } },
          headRevision: 1, settlementMode: 'final-application-v1' });
        await completed(f.clock, opening, `${kind} late original reader opening`);
        await completed(f.clock, finalizationRejected, `${kind} reader-gated finalization cutoff`);
      } else {
        await pump(f.clock, () => true);
        await assert.rejects(f.host.applyCompletedRuntimeSupervisorSnapshot(session.nodeId, kind, snapshot),
          /finalization deadline expired/i);
      }
      await pump(f.clock, () => true);
      assert.equal(record.finalizationUnconfirmed, true);
      assert.equal(f.host.currentStrictRuntimeDeleteResult(record).kind, 'unconfirmed');
      assert.strictEqual(await record.first, first, 'late ACK and reader state cannot rewrite the first report');
      assert.strictEqual([...f.host.strictRuntimeDeletes.values()][0], record);
      assert.deepEqual(f.host.state, before);
      assert.deepEqual([...f.host.runtimeSessionBindings.entries()], bindings);
      assert.equal(f.persisted.length, 0);
      await assert.rejects(f.host.deleteRuntimeSupervisorSessionStrict(session, { allowRestart: false }), /unconfirmed/i);
      await assert.rejects(f.host.applyCompletedRuntimeSupervisorSnapshot(session.nodeId, kind, snapshot),
        /finalization deadline expired/i);
      assert.equal(strict.calls.length, 1);
      assert.equal(f.persisted.length, 0);
      assert.equal(f.providers.length, 0);
    });
  }

  test(`S9 ${kind} natural completed cleanup retires allowed records but retains a canonical unknown obligation`, async () => {
    const f = candidateFixture();
    configureCandidateCompletionBoundaries(f);
    let nextResult = 'legacy-acknowledged';
    const seen = [];
    const strict = candidateStrictDeletes(f, params => {
      const entry = [...f.host.strictRuntimeDeletes.entries()].find(([, record]) => record.session.sessionId === params.sessionId);
      assert.ok(entry, 'actual natural cleanup registers its original obligation before dispatch');
      assert.equal(entry[1].session.kind, kind);
      assert.equal(entry[1].session.nodeId, undefined);
      assert.equal(JSON.parse(entry[0])[2], kind, 'the map key includes the canonical execution kind');
      seen.push(entry);
      return settledLegacyDelete(nextResult, nextResult === 'unconfirmed' ? 'original cleanup acknowledgement unavailable' : undefined);
    });
    async function completeRound(index) {
      const session = addCandidateLegacyBinding(f, kind);
      session.sessionId = `natural-${kind}-${index}`;
      const node = f.host.state.nodes.find(value => value.kind === kind);
      node.metadata[kind].runtimeSessionId = session.sessionId;
      f.host.bindRuntimeSession(node.id, kind, session.sessionId, session.runtimeStoragePath, session.backendKind);
      await f.host.applyCompletedRuntimeSupervisorSnapshot(node.id, kind, candidateCompletedSnapshot(session));
      const metadata = f.host.state.nodes.find(value => value.kind === kind).metadata[kind];
      assert.equal(metadata.runtimeSessionId, undefined);
      assert.equal(metadata.terminalHistoryDiscarded, true);
      assert.equal(metadata.recentOutput, undefined);
      assert.equal(metadata.serializedTerminalState, undefined);
      assert.equal(f.host.runtimeSessionBindings.size, 0);
      return session;
    }
    for (let index = 0; index < 4; index += 1) {
      nextResult = index % 2 === 0 ? 'legacy-acknowledged' : 'legacy-absent';
      await completeRound(index);
      assert.equal(f.host.strictRuntimeDeletes.size, 0, `${nextResult} completed records must not accumulate`);
      assert.equal(strict.calls.length, index + 1);
    }
    nextResult = 'unconfirmed';
    const unknownSession = await completeRound(4);
    assert.equal(f.host.strictRuntimeDeletes.size, 1);
    const [unknownKey, unknownRecord] = [...f.host.strictRuntimeDeletes.entries()][0];
    assert.equal(unknownRecord.session.sessionId, unknownSession.sessionId);
    assert.equal(f.host.currentStrictRuntimeDeleteResult(unknownRecord).kind, 'unconfirmed');
    nextResult = 'legacy-acknowledged';
    await completeRound(5);
    assert.equal(f.host.strictRuntimeDeletes.size, 1, 'later successful cleanup cannot prune the unrelated unknown obligation');
    assert.strictEqual(f.host.strictRuntimeDeletes.get(unknownKey), unknownRecord);
    assert.equal(strict.calls.length, 6);
    assert.equal(seen.length, 6);
    assert.equal(f.persisted.length, 6);
    assert.equal(f.providers.length, 0);
  });
}

async function interactiveHostFixture(kind = 'terminal', providerKind = 'codex') {
  const f = candidateFixture();
  const persist = f.host.persistState.bind(f.host);
  f.host.persistState = async (...args) => { await persist(...args); };
  if (kind === 'agent') {
    f.host.state.nodes.find(node => node.kind === kind).metadata.agent = { provider: providerKind };
    f.host.resolveAgentCli = async () => ({ command: '/controlled/agent', provider: providerKind });
  }
  await completed(f.clock, kind === 'agent'
    ? f.host.startAgentSession('agent-1', 113, 39, providerKind, false)
    : f.host.startTerminalSession('terminal-1', 113, 39), `${kind} interactive owner start`);
  const record = f.record(kind);
  const provider = f.providers[0];
  const requests = [];
  const send = provider.transport.send.bind(provider.transport);
  provider.transport.send = async message => {
    await send(message);
    if (message.type === 'input' || message.type === 'resize') requests.push(message);
  };
  function reply(message, result) {
    provider.message({ type: 'interactionObservation', interactionId: message.interactionId, result });
  }
  async function cleanup() {
    provider.process();
    provider.message({ type: 'resourceResult', resourceId: 'subject', operationId: 'subject-release', result: { kind: 'released' } });
    provider.seal(provider.messages.filter(message => message.type === 'consumed').at(-1)?.throughFrameId ?? 0);
    provider.release();
    await pump(f.clock, () => true);
    record.business?.cancelActivityPoll?.();
    record.business?.lineContextTracker.dispose();
    record.tracker.dispose();
  }
  return { ...f, record, provider, requests, reply, cleanup };
}

test('S10 actual Host start forwards non-default size and kind/provider hangup policy without a process facade', async () => {
  for (const [kind, providerKind, strategy] of [
    ['terminal', 'codex', 'hangup'], ['agent', 'codex', 'interrupt-then-hangup'], ['agent', 'claude', 'hangup']
  ]) {
    const f = await interactiveHostFixture(kind, providerKind);
    try {
      const start = f.provider.messages.find(message => message.type === 'start');
      assert.equal(start.spec.cols, 113);
      assert.equal(start.spec.rows, 39);
      assert.equal(start.spec.stopStrategy, strategy);
      assert.equal(f.record.cols, 113);
      assert.equal(f.record.rows, 39);
      assert.equal(f.host.getExecutionSessions(kind).has(`${kind}-1`), false);
      assert.equal(f.record.process, undefined);
    } finally { await f.cleanup(); }
  }
});

test('S10 Host Agent input commits running only after written and preserves waiting state on failed or unknown writes', async () => {
  const f = await interactiveHostFixture('agent');
  try {
    for (const result of ['failed', 'unconfirmed', 'written']) {
      f.record.business.lifecycleStatus = 'waiting-input';
      const before = f.requests.length;
      const writing = f.host.writeExecutionInput('agent', 'agent-1', 'instruction\r');
      await until(f.clock, () => f.requests.length === before + 1, `${result} input submitted`);
      assert.equal(f.record.business.lifecycleStatus, 'waiting-input');
      f.reply(f.requests.at(-1), result === 'written' ? { kind: 'written', writtenBytes: Buffer.byteLength('instruction\r') }
        : { kind: result, reason: 'controlled original input result', writtenBytes: 0 });
      assert.equal(await completed(f.clock, writing, `${result} input response`), result === 'written');
      assert.equal(f.record.business.lifecycleStatus, result === 'written' ? 'running' : 'waiting-input');
      if (result === 'unconfirmed') break;
    }
  } finally { await f.cleanup(); }
  const success = await interactiveHostFixture('agent');
  try {
    success.record.business.lifecycleStatus = 'waiting-input';
    const writing = success.host.writeExecutionInput('agent', 'agent-1', 'go\r');
    await until(success.clock, () => success.requests.length === 1, 'successful Agent instruction');
    success.reply(success.requests[0], { kind: 'written', writtenBytes: 3 });
    assert.equal(await completed(success.clock, writing, 'successful Agent instruction result'), true);
    assert.equal(success.record.business.lifecycleStatus, 'running');
    assert.equal(success.record.business.resumePhaseActive, false);
  } finally { await success.cleanup(); }
});

test('S10 Host owned resize applies only confirmed dimensions and preserves tracker order through scrollback', async () => {
  const f = await interactiveHostFixture();
  try {
    f.host.resizeExecutionSession('terminal', 'terminal-1', 101, 31);
    await until(f.clock, () => f.requests.length === 1, 'original Host resize');
    assert.equal(f.record.cols, 113);
    assert.equal(f.record.rows, 39);
    assert.equal(f.record.terminalRevision, 0);
    f.reply(f.requests[0], { kind: 'resized' });
    await until(f.clock, () => f.record.terminalRevision === 1, 'Host confirmed resize commit');
    assert.equal(f.record.cols, 101);
    assert.equal(f.record.rows, 31);
    assert.equal(f.record.tracker.getSerializedState().outputSequence, 1);
    f.host.resizeExecutionSession('terminal', 'terminal-1', 99, 29);
    await until(f.clock, () => f.requests.length === 2, 'Host rejected resize');
    f.reply(f.requests[1], { kind: 'failed', reason: 'controlled resize failed' });
    await pump(f.clock, () => f.posted.some(message => message.type === 'host/error'));
    assert.equal(f.record.cols, 101);
    assert.equal(f.record.terminalRevision, 1);
    await completed(f.clock, f.host.refreshLiveExecutionSessionScrollback(120), 'Host owned scrollback');
    assert.equal(f.record.tracker.getScrollback(), 120);
    assert.equal(f.record.terminalRevision, 2);
    assert.equal(f.requests.length, 2, 'scrollback is authority state, not a provider interaction');
  } finally { await f.cleanup(); }
});

test('S10 Host native resize success followed by tracker failure retains mutation failure instead of reporting rollback', async () => {
  const f = await interactiveHostFixture();
  const resize = f.record.tracker.resize.bind(f.record.tracker);
  try {
    f.record.tracker.resize = () => { throw new Error('controlled tracker resize failure'); };
    const resizing = f.host.resizeNonNativeHostExecution(f.record, 90, 28);
    const rejected = assert.rejects(resizing, /tracker resize failure/);
    await until(f.clock, () => f.requests.length === 1, 'Host partially committed resize');
    f.reply(f.requests[0], { kind: 'resized' });
    await completed(f.clock, rejected, 'Host resize authority failure');
    assert.match(f.record.mutationError, /applied.*commit failed/i);
    assert.equal(f.record.cols, 113);
    assert.equal(await f.host.writeExecutionInput('terminal', 'terminal-1', 'blocked'), false);
    assert.equal(f.requests.length, 1);
    await f.record.terminalChain.catch(() => {});
  } finally { f.record.tracker.resize = resize; await f.cleanup(); }
});

test('S10 Host title query input cannot block owned output, Agent resume hints or Terminal launch state', async () => {
  for (const kind of ['terminal', 'agent']) {
    const f = await interactiveHostFixture(kind);
    try {
      f.provider.output(1, '\x1b]2;controlled-title\x07\x1b[21t\r\nready\r\n');
      await until(f.clock, () => f.record.execution.snapshot().adapter.consumedThrough === 1, `${kind} query output consumed`);
      await until(f.clock, () => f.requests.some(message => message.type === 'input'), `${kind} title reply submitted`);
      assert.equal(f.record.business.terminalTitle, 'controlled-title');
      assert.match(f.requests[0].data, /controlled-title/);
      if (kind === 'terminal') assert.equal(f.record.business.lifecycleStatus, 'live');
      else {
        f.provider.output(2, '\r\nTo continue this session, run codex resume 7e57d004-2b97-4001-9455-5d94020a94cd\r\n');
        await until(f.clock, () => f.record.execution.snapshot().adapter.consumedThrough === 2, 'Agent resume hint consumed');
        assert.equal(f.record.business.agentResume.sessionId, '7e57d004-2b97-4001-9455-5d94020a94cd');
        assert.equal(typeof f.record.business.agentActivity.lastOutputAtMs, 'number');
      }
      const stopping = f.host.stopExecutionSession(kind, `${kind}-1`);
      const stopped = stopping.catch(() => {});
      await until(f.clock, () => f.provider.messages.some(message => message.type === 'requestStop'), `${kind} stop bypasses title reply`);
      assert.equal(f.record.business.lifecycleStatus, 'stopping');
      f.clock.advance(13000);
      await completed(f.clock, stopped, `${kind} controlled stop observation`);
    } finally { await f.cleanup(); }
  }
});

test('S10 owned Host keeps Claude Ctrl-Z and suspended input restrictions before interaction dispatch', async () => {
  const f = await interactiveHostFixture('agent', 'claude');
  try {
    assert.equal(await f.host.writeExecutionInput('agent', 'agent-1', '\x1a'), false);
    f.record.business.lifecycleStatus = 'suspended';
    assert.equal(await f.host.writeExecutionInput('agent', 'agent-1', 'go\r'), false);
    assert.equal(f.requests.length, 0);
  } finally { await f.cleanup(); }
});

test('S10 confirmed Host resize still commits before accepted tail when process exit or stop arrives in the same turn', async () => {
  for (const closing of ['process-exit', 'stop']) {
    const f = await interactiveHostFixture();
    try {
      const resizing = f.host.resizeNonNativeHostExecution(f.record, 91, 33);
      await until(f.clock, () => f.requests.length === 1, `${closing} original resize dispatched`);
      f.provider.output(1, 'tail-after-confirmed-resize\r\n');
      await until(f.clock, () => f.record.execution.snapshot().adapter.acceptedThrough === 1, `${closing} tail accepted behind resize`);
      f.reply(f.requests[0], { kind: 'resized' });
      const stopping = closing === 'stop' ? f.host.stopExecutionSession('terminal', 'terminal-1') : undefined;
      const stopResult = stopping?.catch(error => error);
      f.provider.process();
      f.provider.message({ type: 'resourceResult', resourceId: 'subject', operationId: 'subject-release', result: { kind: 'released' } });
      f.provider.seal(1); f.provider.release();
      await completed(f.clock, resizing, `${closing} resize commit`);
      await pump(f.clock, () => f.record.execution.snapshot().terminal?.kind === 'applied');
      assert.equal(f.record.execution.snapshot().terminal?.kind, 'applied', `${closing}: ${JSON.stringify(f.record.execution.snapshot())}`);
      assert.equal(f.record.mutationError, undefined);
      assert.equal(f.record.cols, 91);
      assert.equal(f.record.rows, 33);
      assert.equal(f.record.terminalRevision, 2);
      assert.equal(f.record.lastDataSequence, 1);
      assert.match(f.record.tracker.getSerializedState().data, /tail-after-confirmed-resize/);
      if (stopResult) await completed(f.clock, stopResult, 'confirmed resize stop settlement');
    } finally {
      f.record.business.cancelActivityPoll?.();
      f.record.business.lineContextTracker.dispose();
      f.record.tracker.dispose();
    }
  }
});

test('S10 Host final Agent hint replaces an earlier resume identity before its final snapshot persistence', async () => {
  const f = await interactiveHostFixture('agent');
  try {
    f.record.business.agentResume = { supported: true, strategy: 'codex-session-id', sessionId: 'earlier-confirmed-id' };
    f.host.projectNonNativeHostBusiness(f.record);
    f.provider.output(1, 'To continue this session, run codex resume 7e57d004-2b97-4001-9455-5d94020a94cd\r\n');
    await until(f.clock, () => f.record.execution.snapshot().adapter.consumedThrough === 1, 'normal final hint consumed');
    assert.equal(f.record.business.agentResume.sessionId, 'earlier-confirmed-id', 'running output preserves its confirmed earlier identity');
    f.provider.process();
    f.provider.message({ type: 'resourceResult', resourceId: 'subject', operationId: 'subject-release', result: { kind: 'released' } });
    f.provider.seal(1); f.provider.release();
    const saved = await completed(f.clock, f.record.persistence.promise, 'final corrected resume metadata persistence');
    assert.equal(saved.kind, 'saved', saved.reason);
    assert.equal(f.host.state.nodes.find(node => node.kind === 'agent').metadata.agent.resumeSessionId,
      '7e57d004-2b97-4001-9455-5d94020a94cd');
  } finally {
    f.record.business.cancelActivityPoll?.();
    f.record.business.lineContextTracker.dispose();
    f.record.tracker.dispose();
  }
});

test('S10 Host uncertain resize retains its observation and accepted tail without claiming a complete final authority', async () => {
  const f = await interactiveHostFixture();
  try {
    const resizing = f.host.resizeNonNativeHostExecution(f.record, 91, 33);
    const rejected = assert.rejects(resizing, /unconfirmed/);
    await until(f.clock, () => f.requests.length === 1, 'original uncertain Host resize');
    f.reply(f.requests[0], { kind: 'unconfirmed', reason: 'controlled resize observation deadline' });
    await completed(f.clock, rejected, 'uncertain Host resize returns');
    const original = f.record.resizeObservation;
    assert.equal(original.current.kind, 'unconfirmed');
    assert.match(f.record.mutationError, /effect is unconfirmed/);
    f.reply(f.requests[0], { kind: 'resized' });
    await until(f.clock, () => original.current.kind === 'resized', 'same original late resize evidence');
    assert.strictEqual(f.record.resizeObservation, original);
    assert.equal(await f.host.writeExecutionInput('terminal', 'terminal-1', 'blocked'), false);
    await assert.rejects(f.host.resizeNonNativeHostExecution(f.record, 92, 34), /unconfirmed/);
    assert.equal(f.requests.length, 1, 'late evidence does not reopen mutation admission');
    f.provider.output(1, 'tail-after-uncertain-resize\r\n');
    await until(f.clock, () => f.record.execution.snapshot().adapter.consumedThrough === 1, 'uncertain authority still consumes accepted tail');
    f.provider.process();
    f.provider.message({ type: 'resourceResult', resourceId: 'subject', operationId: 'subject-release', result: { kind: 'released' } });
    f.provider.seal(1); f.provider.release();
    const saved = await completed(f.clock, f.record.persistence.promise, 'uncertain Host final persistence outcome');
    assert.notEqual(saved.kind, 'saved');
    assert.equal(f.record.execution.snapshot().terminal.kind, 'failed');
    assert.equal(f.record.finalRevision, undefined);
    assert.equal(f.record.cols, 113); assert.equal(f.record.rows, 39);
    assert.match(f.record.tracker.getSerializedState().data, /tail-after-uncertain-resize/);
  } finally {
    f.record.business.cancelActivityPoll?.();
    f.record.business.lineContextTracker.dispose();
    f.record.tracker.dispose();
  }
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
