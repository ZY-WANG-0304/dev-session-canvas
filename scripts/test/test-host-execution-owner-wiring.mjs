import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import esbuild from 'esbuild';
import ts from 'typescript';

// Load the actual class without activation, source rewriting or a native process boundary.
const bundled = await esbuild.build({
  stdin: {
    contents: `
      export { composeMultiRootCanvasState, decomposeMultiRootCanvasState, namespaceCanvasObjectId } from './extensions/vscode/dev-session-canvas/src/common/canvasMultiRootComposition';
      export { CanvasPanelManager } from './extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager';
      export { ExecutionOwnerLifecycle } from './extensions/vscode/dev-session-canvas/src/panel/executionOwnerLifecycle';
      export { encodeOutputFrame } from './extensions/vscode/dev-session-canvas/src/common/executionLifecycle';
      export { EXECUTION_CANDIDATE_PROFILE, EXECUTION_CANDIDATE_BUDGETS, EXECUTION_PRODUCTION_ADMISSION, EXECUTION_INTERACTION_LIMITS } from './extensions/vscode/dev-session-canvas/src/common/executionLifecycle';
      export { RuntimeTerminalReadRelay } from './extensions/vscode/dev-session-canvas/src/panel/runtimeTerminalReadRelay';
      export { RuntimeSupervisorClient } from './extensions/vscode/dev-session-canvas/src/panel/runtimeSupervisorClient';
      export { TerminalAvailableNotifications } from './extensions/vscode/dev-session-canvas/src/panel/terminalAvailableNotifications';
      export { parseWebviewMessage } from './extensions/vscode/dev-session-canvas/src/common/protocol';
      export { env as testEnvironment, window as testWindow, l10n as testL10n, workspace as testWorkspace, Uri as testUri } from 'vscode';
      export { serializeRuntimeSupervisorError, createRuntimeSupervisorError } from './extensions/vscode/dev-session-canvas/src/common/runtimeSupervisorProtocol';
      export { testLegacyHistoryInspector } from './extensions/vscode/dev-session-canvas/src/panel/legacyRuntimeHistory';
      export { testNativeHistoryInspector } from './extensions/vscode/dev-session-canvas/src/panel/nativeRuntimeHistory';
      export { testRootRuntimePreparation } from './extensions/vscode/dev-session-canvas/src/panel/runtimeRootSupervisorPreparation';
      export { createRuntimeOwnerDescriptor, createRuntimeUserStorageScopeKey, resolveRootRuntimeSupervisorGeneration,
        resolveRuntimeRootOwnerBaseStoragePath } from './extensions/vscode/dev-session-canvas/src/common/runtimeRootOwnership';
    `,
    resolveDir: process.cwd(), sourcefile: 'host-owner-wiring-entry.ts'
  },
  bundle: true, write: false, platform: 'node', format: 'cjs', target: 'node18', external: ['node-pty'],
  plugins: [{
    name: 'host-boundaries-only',
    setup(build) {
      build.onResolve({ filter: /\/runtimeRootSupervisorPreparation$/ }, () => ({ path: 'runtimeRootSupervisorPreparation', namespace: 'root-runtime-preparation-boundary' }));
      build.onLoad({ filter: /.*/, namespace: 'root-runtime-preparation-boundary' }, () => ({ loader: 'js', contents: `
        const testRootRuntimePreparation = { run: async () => { throw new Error('Unexpected root runtime preparation'); } };
        module.exports = { testRootRuntimePreparation,
          prepareRootRuntimeSupervisor: (...args) => testRootRuntimePreparation.run(...args) };
      ` }));
      build.onResolve({ filter: /\/legacyRuntimeHistory$/ }, () => ({ path: 'legacyRuntimeHistory', namespace: 'legacy-history-boundary' }));
      build.onLoad({ filter: /.*/, namespace: 'legacy-history-boundary' }, () => ({ loader: 'js', contents: `
        const testLegacyHistoryInspector = { run: async () => undefined };
        module.exports = { testLegacyHistoryInspector,
          inspectStoppedLegacyRuntimeSession: (...args) => testLegacyHistoryInspector.run(...args) };
      ` }));
      build.onResolve({ filter: /\/nativeRuntimeHistory$/ }, () => ({ path: 'nativeRuntimeHistory', namespace: 'native-history-boundary' }));
      build.onLoad({ filter: /.*/, namespace: 'native-history-boundary' }, () => ({ loader: 'js', contents: `
        const testNativeHistoryInspector = { run: async () => undefined };
        module.exports = { testNativeHistoryInspector,
          inspectRetiredNativeRuntimeNamespace: (...args) => testNativeHistoryInspector.run(...args) };
      ` }));
      build.onResolve({ filter: /^(vscode|node-pty|(?:node:)?child_process)$/ }, args => ({
        path: args.path, namespace: 'host-boundary'
      }));
      build.onLoad({ filter: /.*/, namespace: 'host-boundary' }, args => ({
        loader: 'js', contents: args.path === 'vscode' ? `
          class Disposable { dispose() {} }
          class EventEmitter { event = () => new Disposable(); fire() {} dispose() {} }
          class ThemeIcon { constructor(id) { this.id = id; } }
          class TreeItem {}
          class Range {
            constructor(line, character, endLine, endCharacter) {
              this.start = { line, character }; this.end = { line: endLine, character: endCharacter };
            }
          }
          module.exports = {
            Disposable, EventEmitter, ThemeIcon, TreeItem, Range, FileType: { File: 1, Directory: 2 },
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
const { composeMultiRootCanvasState, decomposeMultiRootCanvasState, namespaceCanvasObjectId, CanvasPanelManager, ExecutionOwnerLifecycle, encodeOutputFrame,
  RuntimeTerminalReadRelay, RuntimeSupervisorClient, TerminalAvailableNotifications, parseWebviewMessage, EXECUTION_CANDIDATE_PROFILE, EXECUTION_CANDIDATE_BUDGETS, EXECUTION_PRODUCTION_ADMISSION, EXECUTION_INTERACTION_LIMITS,
  testEnvironment, testWindow, testL10n, testWorkspace, testUri, serializeRuntimeSupervisorError, createRuntimeSupervisorError,
  testLegacyHistoryInspector, testNativeHistoryInspector, testRootRuntimePreparation,
  createRuntimeOwnerDescriptor, createRuntimeUserStorageScopeKey, resolveRootRuntimeSupervisorGeneration,
  resolveRuntimeRootOwnerBaseStoragePath } = loaded.exports;

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
    admissionLimits: options.admissionLimits,
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
    enabledAttentionSignals: ['bel', 'osc9', 'osc777'], attentionNotificationBridgeMode: 'none',
    agentSessions: new Map(), terminalSessions: new Map(), runtimeSessionBindings: new Map(),
    pendingTerminalInitialInputs: new Map(), pendingTerminalInitialInputDispatches: new Map(),
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
const test = (name, run, timeoutMs = 3000) => tests.push({ name, run, timeoutMs });

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

test('production Host admits eleven live subjects but retains final-save responsibility in the pending budget', async () => {
  const f = fixture({ admissionLimits: EXECUTION_PRODUCTION_ADMISSION, capabilities: persistenceCapabilities,
    budgets: { naturalDrainMs: 15, boundaryMs: 50 } });
  const saves = [];
  const records = [];
  f.host.persistState = () => { const save = deferred(); saves.push(save); return save.promise; };
  const start = index => {
    const nodeId = `production-${index}`;
    f.host.state.nodes.push({ id: nodeId, kind: 'terminal', metadata: {} });
    return f.host.startNonNativeHostExecution('terminal', nodeId, 80, 24,
      async () => ({ file: '/controlled/shell', args: [], env: {} }));
  };
  try {
    for (let index = 0; index < 11; index++) records.push(await completed(f.clock, start(index), 'production live start'));
    assert.equal(f.providers.length, 11);
    assert.equal(f.owner.snapshot().admissionPending, 0);
    for (const provider of f.providers.slice(0, 2)) { provider.process(); provider.seal(0); provider.release(); }
    await until(f.clock, () => saves.length === 2 && records.slice(0, 2).every(record => record.execution.snapshot().retired),
      'native and reader retired while saves are held');
    assert.equal(f.owner.snapshot().admissionPending, 0, 'save responsibility outlives the owner map');
    await assert.rejects(start(11), /Host capacity/);
    assert.equal(f.providers.length, 11, 'no new acquisition when two final saves remain');
    saves[0].resolve();
    await until(f.clock, () => records[0].persistence.result?.kind === 'saved', 'original first save');
    records.push(await completed(f.clock, start(12), 'admission after real save'));
    assert.equal(f.providers.length, 12);
  } finally {
    for (const save of saves) save.resolve();
    for (const record of records) record.tracker.dispose();
  }
});

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
    send(surface, 'webview/ready', enabled ? { capabilities: { terminalLocalSettlementV1: true,
      ...(options.outputCredit ? { terminalLocalOutputCreditV1: true } : {}) } } : undefined, lifecycle);
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
  test(`${kind} local consumption credit waits for exact page application, including initial and final snapshots`, async () => {
    const f = localFixture({ outputCredit: true });
    const { record, provider } = await f.started(kind);
    const messages = () => f.posted.filter(entry => entry.message.payload?.localOutputReceipt);
    const receipt = (entry, overrides = {}, lifecycle) => {
      const { payload } = entry.message;
      f.send('editor', 'webview/executionLocalOutputApplied', { nodeId: payload.nodeId, kind,
        executionSessionId: payload.executionSessionId, ...payload.localOutputReceipt,
        outcome: 'applied', ...overrides }, lifecycle);
    };
    try {
      await until(f.clock, () => f.posted.length > 0, 'initial snapshot delivery');
      const initial = f.posted.find(entry => entry.message.type === 'host/executionSnapshot');
      assert.ok(initial.message.payload.localOutputReceipt, 'initial snapshot must require application credit');
      const reader = record.localReaders.get('editor');
      assert.equal(reader.initialPublished, false, 'postMessage true is not page consumption');
      provider.output(1, 'page-credit-tail');
      await pump(f.clock);
      assert.equal(record.execution.snapshot().adapter.consumedThrough, 0);
      receipt(initial, { receiptId: 'wrong-receipt' });
      receipt(initial, { outputSequence: 99 });
      receipt(initial, { executionSessionId: 'old-subject' });
      receipt(initial, {}, { ...initial.message.lifecycle, frameId: 'old-frame' });
      await pump(f.clock);
      assert.equal(reader.initialPublished, false);
      receipt(initial);
      await until(f.clock, () => messages().length === 2, 'first credited output');
      assert.equal(record.execution.snapshot().adapter.consumedThrough, 0);
      provider.output(2, 'second-credit-tail');
      await until(f.clock, () => record.execution.snapshot().adapter.acceptedThrough === 2, 'accepted continuous source tail');
      provider.process(); provider.seal(2); provider.release();
      await pump(f.clock);
      assert.equal(messages().length, 2, 'a slow page admits no second body publication');
      assert.equal(record.finalRevision, undefined, 'final flush cannot overtake held consumption');
      receipt(initial);
      await pump(f.clock);
      assert.equal(messages().length, 2, 'duplicate old receipt grants no new credit');
      receipt(messages()[1]);
      await until(f.clock, () => messages().length === 3, 'second credited output');
      receipt(messages()[2]);
      await pump(f.clock, () => messages().length === 4);
      assert.equal(messages().length, 4, `final snapshot: ${JSON.stringify(record.execution.snapshot())}`);
      assert.equal(f.completions().length, 0, 'exit follows final snapshot application');
      receipt(messages()[3]);
      await until(f.clock, () => f.completions().length === 1, 'credited final publication');
      assert.equal(record.execution.snapshot().readerOutcome, 'pending', 'output receipt is not final settlement');
      f.settle(kind, record, { kind: 'applied', finalOutputSequence: 2 });
      await until(f.clock, () => record.execution.snapshot().retired, 'reader final settlement');
    } finally {
      f.host.cancelLocalExecutionReaders('editor', 'cancelled', 'test-cleanup');
      record.tracker.dispose();
    }
  });
}

test('local mount racing a cancelled eager snapshot retries with a new reader instead of deadlocking', async () => {
  const f = localFixture({ outputCredit: true });
  const { record, provider } = await f.started('terminal');
  try {
    await until(f.clock, () => f.posted.some(entry => entry.message.type === 'host/executionSnapshot'), 'eager snapshot');
    const first = f.posted.find(entry => entry.message.type === 'host/executionSnapshot').message;
    assert.ok(first.payload.localOutputReceipt);
    const oldReader = record.localReaders.get('editor');
    const attach = f.host.postLocalExecutionSnapshot(record, { surface: 'editor' });
    f.send('editor', 'webview/executionLocalOutputApplied', { nodeId: 'terminal-1', kind: 'terminal',
      executionSessionId: record.execution.identity.executionId, ...first.payload.localOutputReceipt,
      outcome: 'cancelled', reason: 'controller-unmounted' });
    await until(f.clock, () => f.posted.filter(entry => entry.message.type === 'host/executionSnapshot').length === 2,
      'mounted reader retry');
    const second = f.posted.filter(entry => entry.message.type === 'host/executionSnapshot')[1].message;
    assert.notEqual(record.localReaders.get('editor'), oldReader);
    assert.equal(oldReader.outcome.kind, 'cancelled');
    f.send('editor', 'webview/executionLocalOutputApplied', { nodeId: 'terminal-1', kind: 'terminal',
      executionSessionId: record.execution.identity.executionId, ...second.payload.localOutputReceipt, outcome: 'applied' });
    await completed(f.clock, attach, 'new mounted initial application');
    assert.equal(record.localReaders.get('editor').initialPublished, true);
    provider.output(1, 'cancel-held-write');
    await until(f.clock, () => f.posted.some(entry => entry.message.type === 'host/executionOutput'), 'held local write');
    f.host.cancelLocalExecutionReaders('editor', 'cancelled', 'surface-hidden');
    await until(f.clock, () => record.execution.snapshot().adapter.consumedThrough === 1, 'cancel releases wait');
    assert.equal(record.localReaders.get('editor').outcome.kind, 'cancelled');
    provider.process(); provider.seal(1); provider.release();
    await until(f.clock, () => record.execution.snapshot().settled, 'cancelled reader native settlement');
  } finally { record.tracker.dispose(); }
});

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

for (const outputCredit of [false, true]) {
test(`actual local Host to main/headless to Host preserves owner responsibility until the real tail callback (credit=${outputCredit})`, async () => {
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
  const f = localFixture({ outputCredit, onHostMessage: message => {
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
    if (outputCredit) {
      await pump(f.clock);
      assert.equal(f.completions().length, 0, 'the actual write holds final publication behind source credit');
      assert.equal(record.execution.snapshot().adapter.consumedThrough, 0);
      assert.equal(record.finalRevision, undefined);
    } else {
      await until(f.clock, () => f.completions().length === 1, 'real local final barrier announcement');
      assert.equal(record.finalRevision, 1);
    }
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
}

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
  const client = { dispose: () => f.detach.push('client'), ensureConnected: () => connected.promise,
    matchesRuntimeOwner: owner => owner === undefined };
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
  const f = (options.candidate ? candidateFixture : fixture)({ ...options, capabilities: persistenceCapabilities,
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
      if (options.candidate) provider.message({ type: 'resourceResult', resourceId: 'subject', operationId: 'subject-release', result: { kind: 'released' } });
      provider.release();
      await until(f.clock, () => record.persistence?.result !== undefined, `${kind} final persistence result`);
      return record.persistence.result;
    },
    async cleanup() {
      f.host.clearDeferredCanvasStatePersistTimer();
      for (const record of f.host.nonNativeHostExecutions.values()) {
        record.business?.cancelActivityPoll?.(); record.business?.lineContextTracker.dispose(); record.tracker.dispose();
      }
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

  test(`${kind} large final snapshot survives actual Host reload and tracker restoration`, async () => {
    const f = await persistenceFixture();
    const row = index => `SNAPSHOT-${String(index).padStart(5, '0')}-${'x'.repeat(46)}`;
    const lineCount = 90000;
    f.host.getTerminalScrollback = () => 100000;
    f.host.fileFilterState = { includeGlobs: [], excludeGlobs: [] };
    f.host.context.workspaceState.get = key => f.updates.get(key);
    let record;
    let restored;
    try {
      const started = await f.started(kind);
      record = started.record;
      let frame = 0;
      for (let offset = 0; offset < lineCount; offset += 128) {
        const count = Math.min(128, lineCount - offset);
        started.provider.output(++frame,
          `${Array.from({ length: count }, (_, index) => row(offset + index)).join('\r\n')}\r\n`);
        await until(f.clock, () => record.execution.snapshot().adapter.consumedThrough === frame,
          `${kind} large snapshot original frame ${frame}`);
      }
      started.provider.output(++frame, '\x1b[3;7H');
      await until(f.clock, () => record.execution.snapshot().adapter.consumedThrough === frame,
        `${kind} large snapshot final cursor`);
      started.provider.message({ type: 'processResult', result: { kind: 'exited', exitCode: 0 } });
      started.provider.seal(frame);
      started.provider.release();
      await until(f.clock, () => record.persistence?.result !== undefined, `${kind} large final save`);
      assert.equal(record.persistence.result.kind, 'saved', record.persistence.result.reason);
      const disk = await f.read();
      const rootDisk = await f.read(f.rootFile);
      const metadata = disk.state.nodes.find(node => node.id === `${kind}-1`).metadata[kind];
      assert.ok(metadata.serializedTerminalState.data.length > 5 * 1024 * 1024);
      assert.equal(metadata.serializedTerminalState.outputSequence, frame);
      assert.deepEqual(rootDisk.state.nodes.find(node => node.id === `${kind}-1`).metadata[kind], metadata);
      assert.equal(f.record(kind), undefined);
      assert.equal(f.host.getExecutionSessions(kind).size, 0, 'Reload must not borrow a live session tracker.');
      const loaded = f.host.loadState();
      const loadedMetadata = loaded.nodes.find(node => node.id === `${kind}-1`).metadata[kind];
      assert.ok(loadedMetadata.serializedTerminalState,
        `${kind} actual root-local normalization must retain the saved large snapshot.`);
      assert.deepEqual(loadedMetadata.serializedTerminalState, metadata.serializedTerminalState);
      assert.equal(loadedMetadata.liveSession, false);
      f.host.state = loaded;
      const messages = [];
      f.host.postMessage = message => messages.push(message);
      await f.host.postExecutionSnapshot(kind, `${kind}-1`);
      const payload = messages.find(message => message.type === 'host/executionSnapshot').payload;
      assert.deepEqual(payload.serializedTerminalState, metadata.serializedTerminalState);
      assert.equal(payload.liveSession, false);
      assert.equal(f.providers.length, 1, 'Restoring history must not launch a replacement process.');
      restored = new record.tracker.constructor(payload.cols, payload.rows, {
        scrollback: 100000, initialState: payload.serializedTerminalState,
        initialOutput: payload.output, initialOutputSequence: payload.outputSequence
      });
      const restoredState = await restored.flush();
      assert.equal(restoredState.data, metadata.serializedTerminalState.data);
      assert.equal(restoredState.outputSequence, frame);
      const buffer = restored.terminal.buffer.active;
      for (let index = 0; index < lineCount; index++) {
        assert.equal(buffer.getLine(index).translateToString(true), row(index), `${kind} reloaded line ${index}`);
      }
      assert.equal(buffer.cursorX, 6);
      assert.equal(buffer.cursorY, 2);
      const stale = structuredClone(rootDisk);
      stale.state.nodes.find(node => node.id === `${kind}-1`).metadata[kind].outputSequence = frame + 1;
      f.host.writePersistedCanvasSnapshotToDisk(f.rootFile, stale);
      assert.equal(f.host.loadState().nodes.find(node => node.id === `${kind}-1`).metadata[kind].serializedTerminalState,
        undefined, 'Removing a size policy must not make a stale snapshot authoritative.');
      const invalid = structuredClone(rootDisk);
      invalid.state.nodes.find(node => node.id === `${kind}-1`).metadata[kind].serializedTerminalState.format = 'unknown-format';
      f.host.writePersistedCanvasSnapshotToDisk(f.rootFile, invalid);
      assert.equal(f.host.loadState().nodes.find(node => node.id === `${kind}-1`).metadata[kind].serializedTerminalState,
        undefined, 'Removing a size policy must not admit an unknown serialization format.');
    } finally {
      restored?.dispose();
      record?.tracker.dispose();
      await f.cleanup();
    }
  }, 15000);
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

for (const kind of ['agent', 'terminal']) {
  for (const outcome of ['saved', 'failed']) {
    test(`${kind} reset final persistence aborts while pending and preserves the later ${outcome} outcome`, async () => {
      const f = await persistenceFixture();
      const gate = deferred();
      const entered = deferred();
      const originalUpdate = f.host.context.workspaceState.update;
      f.host.context.workspaceState.update = async (...args) => {
        entered.resolve();
        await gate.promise;
        if (outcome === 'failed') throw new Error('controlled reset final update failure');
        return originalUpdate(...args);
      };
      let record;
      try {
        const started = await f.started(kind);
        record = started.record;
        const provider = started.provider;
        const nodeIds = f.host.state.nodes.map(node => node.id);
        const resetEvents = () => f.diagnostics.filter(event => event.name === 'state/reset');
        let resetResult;
        const resetting = f.host.resetState({ reason: 'pending-final-save-investigation' }).then(
          () => { resetResult = { kind: 'resolved' }; },
          error => { resetResult = { kind: 'rejected', error }; }
        );
        await until(f.clock, () => provider.messages.some(message => message.type === 'requestStop'), 'reset requested stop');
        assert.equal(resetResult, undefined, 'reset must await the original execution close');
        // No resize or other terminal mutation is needed to reproduce the reset refusal.
        provider.output(1, `${kind}-reset-final-tail`);
        await until(f.clock, () => record.execution.snapshot().adapter.acceptedThrough === 1, 'reset accepted final tail');
        provider.process(); provider.seal(1); provider.release();
        await completed(f.clock, entered.promise, 'reset final workspace update entered');
        await completed(f.clock, resetting, 'reset pending save refusal');
        assert.equal(resetResult.kind, 'rejected');
        assert.match(resetResult.error.message, /Local final snapshot persistence is pending/);
        assert.equal(record.execution.snapshot().retired, true);
        assert.equal(record.persistence.submitted, true);
        assert.equal(record.persistence.result, undefined);
        assert.strictEqual(f.record(kind), record);
        assert.equal(f.owner.snapshot().pending, 0, 'execution retirement does not include Host persistence');
        assert.equal(f.owner.snapshot().closing, true);
        assert.deepEqual(f.host.state.nodes.map(node => node.id), nodeIds);
        assert.equal(resetEvents().length, 0);
        const writesBeforeSettlement = [...f.writes];
        for (const filename of [f.rootFile, f.workspaceFile]) {
          const disk = await f.read(filename);
          const metadata = disk.state.nodes.find(node => node.id === `${kind}-1`).metadata[kind];
          assert.match(metadata.serializedTerminalState.data, new RegExp(`${kind}-reset-final-tail`));
          assert.equal(metadata.outputSequence, 1, 'the file is final even though workspaceState remains pending');
        }
        gate.resolve();
        const saved = await completed(f.clock, record.persistence.promise, 'reset original final save settled');
        assert.equal(saved.kind, outcome);
        assert.equal(f.diagnostics.filter(event => event.name === 'execution/localFinalPersistence').length, 1);
        assert.equal(resetResult.kind, 'rejected', 'late settlement must not rewrite the original reset outcome');
        assert.deepEqual(f.host.state.nodes.map(node => node.id), nodeIds, 'settlement does not resume an aborted reset');
        assert.equal(resetEvents().length, 0);
        assert.equal(f.owner.snapshot().closing, true, 'only a successful explicit reset resumes admission');
        assert.deepEqual(f.writes, writesBeforeSettlement, 'settlement does not resubmit persistence');
        if (outcome === 'saved') {
          assert.equal(f.record(kind), undefined, 'successful final persistence releases its original record');
          await completed(f.clock, f.host.resetState({ reason: 'explicit-reset-after-save' }), 'explicit reset after saved');
          await f.host.pendingWorkspaceStateUpdate;
          assert.equal(f.host.state.nodes.length, 0);
          assert.equal((await f.read()).state.nodes.length, 0);
          assert.equal((await f.read(f.rootFile)).state.nodes.length, 0);
          assert.equal(resetEvents().length, 1);
          assert.equal(f.owner.snapshot().closing, false);
        } else {
          assert.match(saved.reason, /controlled reset final update failure/);
          await assert.rejects(completed(f.clock, f.host.resetState(), 'explicit reset after failed save'),
            /Local final snapshot persistence is failed/);
          assert.strictEqual(f.record(kind), record);
          assert.deepEqual(f.host.state.nodes.map(node => node.id), nodeIds);
          assert.deepEqual(f.writes, writesBeforeSettlement, 'a second reset must not bypass a failed save');
          assert.equal(resetEvents().length, 0);
        }
      } finally { gate.resolve(); record?.tracker.dispose(); await f.cleanup(); }
    });
  }
}

test('explicit Host capacity includes retired executions whose original final save is still pending', async () => {
  const f = await persistenceFixture({ admissionLimits: { executions: 10, starting: 1 } });
  const saved = deferred();
  const entered = deferred();
  const originalUpdate = f.host.context.workspaceState.update;
  f.host.context.workspaceState.update = async (...args) => {
    entered.resolve();
    await saved.promise;
    return originalUpdate(...args);
  };
  const active = [];
  let first;
  try {
    first = await f.started('terminal');
    first.provider.process(); first.provider.seal(0); first.provider.release();
    await completed(f.clock, entered.promise, 'capacity original save entered');
    await until(f.clock, () => first.record.execution.snapshot().retired, 'capacity first owner retired');
    assert.equal(first.record.persistence.result, undefined);
    const create = async index => {
      const id = `terminal-${index}`;
      const node = { ...f.nodes[0], id, metadata: {}, title: id };
      f.host.state.nodes.push(node);
      await completed(f.clock, f.host.startTerminalSession(id, 80, 24), `capacity ${id} start`);
      active.push({ record: f.host.nonNativeHostExecutions.get(`terminal:${id}`), provider: f.providers.at(-1) });
    };
    for (let index = 2; index <= 10; index += 1) await create(index);
    assert.equal(f.host.nonNativeHostExecutions.size, 10);
    assert.equal(f.owner.snapshot().pending, 9, 'pending final persistence is no longer an owner execution');
    const acquired = f.providers.length;
    f.host.state.nodes.push({ ...f.nodes[0], id: 'terminal-11', metadata: {} });
    await assert.rejects(f.host.startTerminalSession('terminal-11', 80, 24), /Host capacity/);
    assert.equal(f.providers.length, acquired, 'the retained save refuses before transport acquisition');
    saved.resolve();
    assert.equal((await completed(f.clock, first.record.persistence.promise, 'original capacity save')).kind, 'saved');
    await completed(f.clock, f.host.startTerminalSession('terminal-11', 80, 24), 'released Host capacity');
    active.push({ record: f.host.nonNativeHostExecutions.get('terminal:terminal-11'), provider: f.providers.at(-1) });
    assert.equal(f.owner.snapshot().pending, 10);
  } finally {
    saved.resolve();
    for (const entry of active) await f.finish('terminal', entry.record, entry.provider);
    first?.record.tracker.dispose();
    await f.cleanup();
  }
});

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

for (const kind of ['terminal', 'agent']) {
  test(`${kind} completed Runtime actual root write failure retains its original binding and managed session`, async () => {
    const f = await persistenceFixture();
    const session = addCandidateLegacyBinding(f, kind);
    const authorityId = `original-${kind}-authority`;
    const disposals = [];
    const managed = { owner: 'supervisor', sessionId: session.sessionId,
      terminalProjectionMode: 'terminal-stream-v1', terminalAuthorityId: authorityId, outputSequence: 1,
      terminalStateTracker: { dispose: () => disposals.push('terminal') },
      lineContextTracker: { dispose: () => disposals.push('line-context') } };
    f.host.getExecutionSessions(kind).set(session.nodeId, managed);
    f.host.executionCandidateProfile = EXECUTION_CANDIDATE_PROFILE;
    f.host.terminalReadRelay = new RuntimeTerminalReadRelay();
    const posted = [];
    const settled = [];
    f.host.postMessage = (message, surface) => posted.push({ message, surface });
    f.host.surfaceLifecycle = { editor: { terminalReadSettlementV1: true } };
    const readKey = `editor:${kind}:${session.nodeId}`;
    const readId = `root-failure-${kind}-reader`;
    await f.host.terminalReadRelay.open(readKey, {
      openTerminalRead: async () => ({ readId, sessionId: session.sessionId, authorityId, headRevision: 1,
        settlementMode: 'final-application-v1', checkpoint: { version: 1, sessionId: session.sessionId,
          authorityId, revision: 0, cols: 80, rows: 24, scrollback: 100, createdAtMs: 1,
          serializedState: { format: 'xterm-serialize-v1', data: '', outputSequence: 0 } } }),
      readTerminalPage: async params => ({ ...params, revision: 1, headRevision: 1,
        events: [{ type: 'output', revision: 1, createdAtMs: 2, data: 'original-final-tail' }] }),
      closeTerminalRead: async params => { settled.push(params); return { ok: true, settlement: 'recorded' }; }
    }, session.sessionId, authorityId, 'editor', undefined, 'final-application-v1');
    await f.host.terminalReadRelay.read(readKey, { readId, sessionId: session.sessionId, authorityId, afterRevision: 0 });
    f.host.isRuntimePersistenceEnabled = () => true;
    f.host.appliedStartupConfiguration.runtimePersistenceEnabled = true;
    let strictDeletes = 0;
    f.host.deleteRuntimeSupervisorSessionStrict = async () => {
      strictDeletes++;
      throw new Error('A failed completed save must not submit a strict delete.');
    };
    try {
      assert.strictEqual(f.host.persistState, CanvasPanelManager.prototype.persistState);
      await f.host.persistState({ workspaceStateMode: 'full', requireRootLocalDurability: true });
      const beforeState = f.host.state;
      const beforeRootStates = f.host.lastLoadedRootLocalStates;
      const beforeRoot = await readFile(f.rootFile, 'utf8');
      const beforeWorkspace = await readFile(f.workspaceFile, 'utf8');
      const bindings = [...f.host.runtimeSessionBindings.entries()];
      f.writes.length = 0;
      await mkdir(`${f.rootFile}.tmp`);
      const snapshot = candidateCompletedSnapshot(session, {
        lifecycle: kind === 'agent' ? 'stopped' : 'closed',
        terminalStreamPaged: true, terminalAuthorityId: authorityId, terminalRevision: 1,
        terminalFinalRevision: 1, capabilities: { terminalReadSettlementV1: true }
      });
      await assert.rejects(f.host.applyCompletedRuntimeSupervisorSnapshot(session.nodeId, kind, snapshot),
        /EISDIR|illegal operation on a directory/i);
      const final = posted.find(entry => entry.message.type === 'host/executionTerminalAvailable' &&
        entry.message.payload.completed === true);
      assert(final, 'A failed root save must not hide the confirmed final watermark from the original reader.');
      assert.equal(final.surface, 'editor');
      assert.equal(final.message.payload.executionSessionId, session.sessionId);
      assert.equal(final.message.payload.authorityId, authorityId);
      assert.equal(final.message.payload.finalRevision, 1);
      assert.deepEqual(settled, [], 'Publishing the final watermark is not a reader application acknowledgement.');
      assert.equal((await f.host.closeExecutionTerminalRead('editor', { nodeId: session.nodeId, kind,
        executionSessionId: session.sessionId, authorityId, readId,
        outcome: { kind: 'applied', finalRevision: 1 } })).settlement, 'recorded');
      assert.equal(settled.length, 1);
      assert.deepEqual(f.writes, [f.rootFile], 'the original root writer fails before a workspace save');
      assert.equal(await readFile(f.rootFile, 'utf8'), beforeRoot);
      assert.equal(await readFile(f.workspaceFile, 'utf8'), beforeWorkspace);
      const rootMetadata = (await f.read(f.rootFile)).state.nodes.find(node => node.kind === kind).metadata[kind];
      const workspaceMetadata = (await f.read()).state.nodes.find(node => node.kind === kind).metadata[kind];
      for (const metadata of [rootMetadata, workspaceMetadata]) {
        assert.equal(metadata.runtimeSessionId, session.sessionId);
        assert.equal(metadata.runtimeStoragePath, session.runtimeStoragePath);
        assert.equal(metadata.persistenceMode, 'live-runtime');
      }
      assert.strictEqual(f.host.state, beforeState);
      assert.strictEqual(f.host.lastLoadedRootLocalStates, beforeRootStates);
      const metadata = f.host.requireNode(session.nodeId, kind).metadata[kind];
      assert.equal(metadata.runtimeSessionId, session.sessionId);
      assert.equal(metadata.runtimeStoragePath, session.runtimeStoragePath);
      assert.deepEqual([...f.host.runtimeSessionBindings.entries()], bindings);
      for (const [key, binding] of bindings) assert.strictEqual(f.host.runtimeSessionBindings.get(key), binding);
      assert.strictEqual(f.host.getExecutionSessions(kind).get(session.nodeId), managed);
      assert.deepEqual(disposals, []);
      assert.equal(strictDeletes, 0);
      assert.equal(f.providers.length, 0);
      assert.ok(f.diagnostics.some(event => event.name === 'state/rootLocalPersistFailed' && event.detail.rootPath === f.root));
    } finally {
      f.host.getExecutionSessions(kind).delete(session.nodeId);
      await f.cleanup();
    }
  });
}

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

for (const kind of ['terminal', 'agent']) {
  for (const disposition of [
    { kind: 'eof' },
    { kind: 'interrupted', reason: 'controlled persisted source interruption' },
    { kind: 'error', reason: 'controlled persisted source failure' },
    { kind: 'unknown', reason: 'controlled persisted source observation missing' }
  ]) {
    test(`${kind} completed persistence saves and reloads ${disposition.kind} without inferring source state`, async () => {
      const f = await persistenceFixture();
      let record;
      try {
        f.host.fileFilterState = { includeGlobs: [], excludeGlobs: [] };
        f.host.context.workspaceState.get = key => f.updates.get(key);
        const started = await f.started(kind);
        record = started.record;
        const result = await f.finish(kind, record, started.provider, {
          text: `persisted-${kind}-${disposition.kind}\r\n`,
          disposition
        });
        assert.equal(result.kind, 'saved', result.reason);
        const disk = await f.read();
        const rootDisk = await f.read(f.rootFile);
        const savedNode = disk.state.nodes.find(node => node.id === `${kind}-1`);
        const savedMetadata = savedNode.metadata[kind];
        assert.deepEqual(rootDisk.state.nodes.find(node => node.id === `${kind}-1`).metadata[kind], savedMetadata);
        const loaded = f.host.loadState();
        const loadedMetadata = loaded.nodes.find(node => node.id === `${kind}-1`).metadata[kind];
        assert.equal(loadedMetadata.liveSession, false);
        if (disposition.kind === 'eof') {
          assert.equal(loadedMetadata.lastRuntimeError, undefined);
          assert.equal(/Output is incomplete/.test(loadedMetadata.lastExitMessage ?? ''), false);
        } else {
          assert.equal(loadedMetadata.lastRuntimeError, disposition.reason);
          // The Host wiring stub intentionally leaves vscode.l10n placeholders untouched;
          // the persisted reason is asserted separately above.
          assert.match(loadedMetadata.lastExitMessage, /Output is incomplete/);
        }

        // A completed snapshot written by an older version has no source fields; load must not invent an error.
        const legacy = structuredClone(disk);
        delete legacy.state.nodes.find(node => node.id === `${kind}-1`).metadata[kind].lastRuntimeError;
        delete legacy.state.nodes.find(node => node.id === `${kind}-1`).metadata[kind].lastExitMessage;
        delete legacy.state.nodes.find(node => node.id === `${kind}-1`).metadata[kind].terminalSourceDisposition;
        f.host.writePersistedCanvasSnapshotToDisk(f.workspaceFile, legacy);
        f.host.writePersistedCanvasSnapshotToDisk(f.rootFile, legacy);
        const loadedLegacy = f.host.loadState();
        const legacyMetadata = loadedLegacy.nodes.find(node => node.id === `${kind}-1`).metadata[kind];
        assert.equal(legacyMetadata.lastRuntimeError, undefined);
        assert.equal(/Output is incomplete/.test(legacyMetadata.lastExitMessage ?? ''), false);
      } finally { record?.tracker.dispose(); await f.cleanup(); }
    });
  }
}

const candidateCapabilities = [
  'execution-lifecycle-v1', 'execution-close-observation-v1', 'execution-parent-cleanup-v1',
  'execution-owner-boundary-v1', 'terminal-interaction-v1',
  'terminal-local-settlement-v1', 'terminal-local-persistence-v1'
];

function candidateFixture(options = {}) {
  const f = localFixture({ ...options, exposeParentControl: true });
  f.host.state.fileReferences = [];
  f.host.state.suppressedFileActivityEdgeIds = [];
  f.host.state.suppressedAutomaticFileArtifactNodeIds = [];
  f.host.appliedStartupConfiguration = { filesFeatureEnabled: false };
  f.host.fileFilterState = { includeGlobs: [], excludeGlobs: [] };
  for (const [index, node] of f.host.state.nodes.entries()) Object.assign(node, {
    position: { x: 800 * index, y: 0 }, size: { width: 640, height: 360 }
  });
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
    ready: true, bootstrapAck: true, terminalLocalSettlementV1: true, terminalReadSettlementV1: true,
    ...(options.outputCredit ? { terminalLocalOutputCreditV1: true } : {}) },
    panel: { generation: 1, mode: 'inactive', frameId: 'candidate-panel', ready: false, bootstrapAck: false } };
  f.host.resolveRuntimeStoragePath = value => value || '/controlled/current-runtime';
  f.host.getPersistedRuntimeStoragePath = metadata => metadata.runtimeStoragePath;
  f.host.promptAgentCliSelectionAfterCommandNotFound = () => {};
  f.host.retireLegacyRuntimeSupervisorClientIfUnused = () => {};
  f.host.pendingRuntimeSupervisorOperations = new Set();
  f.host.pendingTerminalProjectionRefreshes = new Map();
  f.host.runtimeSupervisorClients = new Map();
  f.host.preferredRootRuntimeBackends = new Map();
  const posted = [];
  f.host.postMessage = message => posted.push(message);
  function start(kind) {
    return kind === 'agent' ? f.host.startAgentSession('agent-1', 80, 24, undefined, false)
      : f.host.startTerminalSession('terminal-1', 80, 24);
  }
  return { ...f, owner, injection, posted, start };
}

for (const queuedResize of [false, true]) {
  test(`profile reset final persistence rejects independently of a queued resize (${queuedResize})`, async () => {
    const f = candidateFixture();
    const save = deferred();
    const mutation = deferred();
    let finalWrites = 0;
    f.host.persistState = async options => {
      if (options?.reason === 'local-final-snapshot') {
        finalWrites++;
        await save.promise;
      }
    };
    let record;
    try {
      await completed(f.clock, f.start('agent'), 'profile Agent start');
      record = f.record('agent');
      const provider = f.providers[0];
      f.host.assertNonNativeHostMutation(record);
      let resized;
      if (queuedResize) {
        record.terminalChain = mutation.promise;
        resized = f.host.resizeNonNativeHostExecution(record, 100, 30).then(result => assert.equal(result, 'cancelled'));
      }
      const resetting = assert.rejects(f.host.resetState(), /Local final snapshot persistence is pending/);
      assert.equal(record.execution.snapshot().stopRequested, true);
      mutation.resolve();
      if (resized) await completed(f.clock, resized, 'queued resize refused after stop');
      assert.equal(record.mutationError, undefined, 'a refused resize must not mark the final terminal authority uncertain');
      assert.equal(provider.messages.some(message => message.type === 'resize'), false);
      provider.output(1, 'profile-reset-final-tail');
      await until(f.clock, () => record.execution.snapshot().adapter.acceptedThrough === 1, 'profile reset final tail');
      provider.process(); provider.seal(1);
      provider.message({ type: 'resourceResult', resourceId: 'subject', operationId: 'subject-release',
        result: { kind: 'released' } });
      provider.release();
      await completed(f.clock, resetting, 'profile reset pending save refusal');
      assert.equal(finalWrites, 1);
      assert.equal(record.execution.snapshot().retired, true);
      assert.equal(record.persistence.result, undefined);
      assert.equal(f.host.strictRuntimeMutationBoundary, undefined, 'the failed command is no longer in flight');
      assert.equal(f.host.state.nodes.length, 2);
      save.resolve();
      assert.equal((await completed(f.clock, record.persistence.promise, 'profile final save')).kind, 'saved');
      assert.equal(f.host.state.nodes.length, 2, 'successful persistence does not resume the rejected reset');
      await completed(f.clock, f.host.resetState(), 'profile explicit reset after save');
      assert.equal(f.host.state.nodes.length, 0);
      assert.equal(f.owner.snapshot().closing, false);
      assert.equal(finalWrites, 1, 'explicit reset does not repeat the original final save');
    } finally {
      save.resolve(); mutation.resolve();
      record?.business?.cancelActivityPoll?.();
      record?.business?.lineContextTracker.dispose();
      record?.tracker.dispose();
    }
  });
}

function simulatedReloadFixture() {
  const f = candidateFixture();
  Object.assign(f.host, {
    readStartupConfiguration: () => ({ ...f.host.appliedStartupConfiguration }),
    shouldPreserveLiveRuntimeAcrossHostBoundary: () => false,
    applyWorkbenchContextKeys() {}, refreshStorageRecoverySelection() {},
    loadStoredCanvasFileFilterState: () => f.host.fileFilterState,
    loadReconciledState: () => f.host.state,
    readCanvasTemplateInitializedFlag: () => true,
    loadStoredSurface: () => 'editor',
    isInteractiveSurface: () => false,
    scheduleRestoreLiveRuntimeSessions() {},
    getDebugSnapshot: () => ({ state: f.host.state })
  });
  return f;
}

for (const kind of ['agent', 'terminal']) {
  test(`simulated reload reopens admission for a new ${kind} execution`, async () => {
    const f = simulatedReloadFixture();
    for (let reload = 0; reload < 2; reload++) {
      await completed(f.clock, f.host.simulateRuntimeReloadForTest(), 'simulated reload');
      assert.equal(f.owner.snapshot().closing, false, 'a successful simulated reload must reopen its reused owner');
    }
    try {
      await completed(f.clock, f.start(kind), `${kind} start after simulated reload`);
      assert.equal(f.providers.length, 1);
      assert.equal(f.providers[0].messages[0].type, 'start');
      assert.ok(f.diagnostics.some(event => event.name === 'execution/startRequested' && event.detail.kind === kind));
    } finally {
      const record = f.record(kind);
      record?.business?.cancelActivityPoll?.();
      record?.business?.lineContextTracker.dispose();
      record?.tracker.dispose();
    }
  });
}

test('simulated reload keeps admission closed when the Host boundary fails', async () => {
  const f = simulatedReloadFixture();
  f.host.waitForPendingWorkspaceStateUpdates = async () => { throw new Error('controlled save failure'); };
  await assert.rejects(completed(f.clock, f.host.simulateRuntimeReloadForTest(), 'failed simulated reload'),
    /controlled save failure/);
  assert.equal(f.owner.snapshot().closing, true);
  assert.throws(() => f.owner.reserve('after-failed-reload'), /admission is closed/);
});

test('simulated reload reports failure instead of reopening a permanently closed owner', async () => {
  const f = simulatedReloadFixture();
  f.owner.closeAdmission(true);
  await assert.rejects(completed(f.clock, f.host.simulateRuntimeReloadForTest(), 'permanent simulated reload'),
    /Execution owner admission could not resume after simulated reload/);
  assert.equal(f.owner.snapshot().closing, true);
  assert.equal(f.owner.snapshot().permanent, true);
  assert.throws(() => f.owner.reserve('after-permanent-close'), /admission is closed/);
});

test('candidate Host retains both admitted preparations when production or finite reservation capacity is full', async () => {
  for (const admissionLimits of [EXECUTION_PRODUCTION_ADMISSION, { executions: 2, starting: 1 }]) {
    const f = candidateFixture({ admissionLimits });
    f.host.activeSurface = undefined;
    const gates = [deferred(), deferred()];
    const records = [];
    const launches = gates.map((gate, index) => f.host.startNonNativeHostExecution(
      index ? 'agent' : 'terminal', index ? 'agent-1' : 'terminal-1', 80, 24, () => gate.promise));
    try {
      assert.equal(f.owner.snapshot().admissionPending, 2);
      await assert.rejects(f.host.startNonNativeHostExecution('terminal', 'third', 80, 24,
        async () => ({ file: '/controlled/shell', args: [], env: {} })), /capacity/);
      gates[0].resolve({ file: '/controlled/shell', args: [], env: {} });
      records.push(await completed(f.clock, launches[0], 'first existing reservation'));
      gates[1].resolve({ file: '/controlled/agent', args: [], env: {} });
      records.push(await completed(f.clock, launches[1], 'second existing reservation'));
      assert.equal(f.providers.length, 2);
      assert.equal(f.owner.snapshot().admissionPending, 0);
    } finally {
      for (const record of records) {
        record.business?.cancelActivityPoll?.();
        record.business?.lineContextTracker.dispose();
        record.tracker.dispose();
      }
    }
  }
});

function candidateRuntimeFixture(options = {}) {
  const f = candidateFixture(options);
  const creates = [];
  const applies = [];
  const subscriptions = [];
  const errors = [];
  let rejectBeforeAcquire = options.rejectBeforeAcquire === true;
  for (const method of ['startAgentSessionWithSupervisor', 'startTerminalSessionWithSupervisor']) {
    const start = f.host[method].bind(f.host);
    f.host[method] = async (...args) => {
      try { return await start(...args); }
      catch (error) { errors.push(error instanceof Error ? error.message : String(error)); throw error; }
    };
  }
  const backend = { kind: 'legacy-detached', guarantee: 'best-effort' };
  const client = {
    supportsTerminalSessionStream: () => true,
    supportsTerminalPagedRead: () => false,
    supportsExecutionCandidateProfile: profile => profile === EXECUTION_CANDIDATE_PROFILE,
    async createSession(request) {
      if (rejectBeforeAcquire) throw createRuntimeSupervisorError({ message: 'Execution start was rejected-before-acquire.',
        createSessionOutcome: { kind: 'not-acquired', sessionId: request.sessionId, sessionKind: request.kind } });
      creates.push(request);
      return { sessionId: request.sessionId, kind: request.kind, runtimeBackend: backend.kind,
        live: true, lifecycle: request.kind === 'agent' ? 'running' : 'live' };
    },
    deleteSession: () => assert.fail('candidate replacement must not use ordinary delete/reconnect')
  };
  Object.assign(f.host, {
    isRuntimePersistenceEnabled: () => true,
    resolveRuntimeCreationTarget: async rootPath => ({ rootPath, runtimeStoragePath: '/controlled/new-runtime' }),
    getPreferredRuntimeSupervisorClient: async target => ({ client, backend, ...target }),
    disposeAgentFileActivitySession: async () => {},
    createConfiguredAgentFileActivitySession: () => ({ extraArgs: [], extraEnv: {}, dispose: async () => {} }),
    bindAgentFileActivitySession() {},
    applyRuntimeSupervisorSnapshot: async (...args) => { applies.push(args); },
    subscribeRuntimeSupervisorTerminalStream: async (...args) => { subscriptions.push(args); }
  });
  return { ...f, client, backend, creates, applies, subscriptions, errors,
    setRejectBeforeAcquire: value => { rejectBeforeAcquire = value; } };
}

for (const action of ['agent', 'resume', 'terminal']) {
  for (const rejection of ['plain-admission', 'legacy-string', 'acquired', 'unconfirmed', 'wrong-session', 'wrong-kind', 'malformed']) {
    test(`${action} retains original creation protection for ${rejection}`, async () => {
      const f = candidateRuntimeFixture();
      const kind = action === 'terminal' ? 'terminal' : 'agent';
      const nodeId = `${kind}-1`;
      let creates = 0;
      f.client.createSession = async request => {
        creates++;
        const outcome = { kind: 'not-acquired', sessionId: request.sessionId, sessionKind: kind };
        if (rejection === 'acquired' || rejection === 'unconfirmed') outcome.kind = rejection;
        if (rejection === 'wrong-session') outcome.sessionId = 'different-session';
        if (rejection === 'wrong-kind') outcome.sessionKind = kind === 'agent' ? 'terminal' : 'agent';
        if (rejection === 'malformed') delete outcome.sessionId;
        throw createRuntimeSupervisorError({ message: rejection === 'legacy-string'
          ? 'Execution start was rejected-before-acquire.' : 'Execution owner admission is closed: controlled failure',
          ...(['plain-admission', 'legacy-string'].includes(rejection) ? {} : { createSessionOutcome: outcome }) });
      };
      f.host.resolveAgentCli = async () => ({ command: '/controlled/agent', provider: 'codex', label: 'Codex' });
      f.host.resolveAgentResumeContext = () => ({ supported: true, strategy: 'fake-provider' });
      const start = () => action === 'resume'
        ? f.host.startAgentSession(nodeId, 80, 24, undefined, true) : f.start(kind);
      await completed(f.clock, start(), 'unconfirmed creation');
      const original = f.host.state.nodes.find(node => node.id === nodeId);
      assert.equal(original.status, action === 'terminal' ? 'launching' : action === 'resume' ? 'resuming' : 'starting');
      assert.ok(original.metadata[kind].runtimeSessionId);
      assert.equal(f.host.candidateRuntimeStarts.size, 1);
      await completed(f.clock, start(), 'protected retry');
      await completed(f.clock, f.host.deleteNode(nodeId), 'protected delete');
      assert.equal(creates, 1);
      assert.equal(f.host.candidateRuntimeStarts.size, 1);
      assert.ok(f.host.state.nodes.some(node => node.id === nodeId));
    });
  }

  for (const nextAction of ['retry', 'delete']) {
    test(`${action} settles a typed admission rejection and allows ${nextAction}`, async () => {
      const f = candidateRuntimeFixture();
      const kind = action === 'terminal' ? 'terminal' : 'agent';
      const nodeId = `${kind}-1`;
      const reason = 'Execution owner admission is closed: Authority consumption failed: ENOSPC';
      const create = f.client.createSession;
      const requests = [];
      f.client.createSession = async request => {
        requests.push(request);
        throw createRuntimeSupervisorError(JSON.parse(JSON.stringify({ message: reason,
          createSessionOutcome: { kind: 'not-acquired', sessionId: request.sessionId, sessionKind: kind } })));
      };
      f.host.resolveAgentCli = async () => ({ command: '/controlled/agent', provider: 'codex', label: 'Codex' });
      f.host.resolveAgentResumeContext = () => ({ supported: true, strategy: 'fake-provider', sessionId: 'resume-original' });
      const start = () => action === 'resume'
        ? f.host.startAgentSession(nodeId, 80, 24, undefined, true) : f.start(kind);
      await completed(f.clock, start(), 'typed admission rejection');
      const node = f.host.state.nodes.find(node => node.id === nodeId);
      assert.equal(node.status, 'error');
      assert.equal(node.metadata[kind].lifecycle, 'error');
      assert.equal(node.metadata[kind].lastRuntimeError, reason);
      for (const key of ['runtimeSessionId', 'runtimeStoragePath', 'runtimeBackend', 'runtimeOwner', 'pendingLaunch']) {
        assert.equal(node.metadata[kind][key], undefined, key);
      }
      assert.equal(node.metadata[kind].liveSession, false);
      if (action === 'resume') assert.equal(node.metadata.agent.resumeSessionId, 'resume-original');
      assert.equal(f.host.candidateRuntimeStarts.size, 0);
      assert.equal(requests.length, 1);
      if (nextAction === 'retry') {
        f.client.createSession = create;
        await completed(f.clock, start(), 'retry after admission rejection');
        assert.equal(f.creates.length, 1);
        assert.notEqual(f.creates[0].sessionId, requests[0].sessionId);
      } else {
        await completed(f.clock, f.host.deleteNode(nodeId), 'delete after admission rejection');
        assert.equal(f.host.state.nodes.some(node => node.id === nodeId), false);
      }
    });
  }

  test(`${action} launch displays the serialized owner failure detail`, async () => {
    const f = candidateRuntimeFixture();
    f.host.resolveAgentCli = async () => ({ command: '/controlled/agent', provider: 'codex', label: 'Codex' });
    const reason = "Authority consumption failed: ENOSPC: no space left on device, open '/journal/manifest.json.tmp'";
    f.owner.authority.quarantine(reason);
    f.client.createSession = async () => {
      try { f.owner.assertAdmission(); }
      catch (error) { throw createRuntimeSupervisorError(JSON.parse(JSON.stringify(serializeRuntimeSupervisorError(error)))); }
      assert.fail('the quarantined owner must reject');
    };
    const originalTranslate = testL10n.t;
    testL10n.t = (message, values = {}) => message.replace(/\{(\w+)\}/g, (match, key) => values[key] ?? match);
    try {
      if (action === 'resume') {
        f.host.resolveAgentResumeContext = () => ({ supported: true, strategy: 'fake-provider' });
      }
      const start = action === 'resume'
        ? f.host.startAgentSession('agent-1', 80, 24, undefined, true) : f.start(action);
      await completed(f.clock, start, `${action} admission rejection`);
      const messages = f.posted.filter(message => message.type === 'host/error').map(message => message.payload.message);
      const prefix = action === 'terminal' ? 'Failed to start embedded Terminal' : `Failed to ${action === 'resume' ? 'resume' : 'start'} Codex`;
      assert.deepEqual(messages, [`${prefix}: Execution owner admission is closed: ${reason}`]);
      assert.equal(f.creates.length, 0);
    } finally { testL10n.t = originalTranslate; }
  });
}

for (const kind of ['terminal', 'agent']) {
  for (const replacement of ['node-binding', 'start-record']) {
    test(`${kind} late no-acquisition reply preserves a replacement ${replacement}`, async () => {
      const f = candidateRuntimeFixture();
      const nodeId = `${kind}-1`;
      const entered = deferred();
      const reply = deferred();
      f.client.createSession = async request => {
        entered.resolve(request);
        await reply.promise;
        throw createRuntimeSupervisorError({ message: 'original creation rejected',
          createSessionOutcome: { kind: 'not-acquired', sessionId: request.sessionId, sessionKind: kind } });
      };
      const starting = f.start(kind);
      await completed(f.clock, entered.promise, 'original creation submitted');
      const node = f.host.state.nodes.find(node => node.id === nodeId);
      const metadata = { ...node.metadata[kind], runtimeSessionId: 'replacement-session' };
      node.metadata[kind] = metadata;
      node.status = kind === 'agent' ? 'running' : 'live';
      const key = f.host.getExecutionSessionOperationKey(kind, nodeId);
      const newRecord = { submitted: true, settled: false, sessionId: 'replacement-session' };
      if (replacement === 'start-record') f.host.candidateRuntimeStarts.set(key, newRecord);
      reply.resolve();
      await completed(f.clock, starting, 'late rejection');
      assert.strictEqual(f.host.state.nodes.find(node => node.id === nodeId).metadata[kind], metadata);
      assert.equal(node.status, kind === 'agent' ? 'running' : 'live');
      if (replacement === 'start-record') assert.strictEqual(f.host.candidateRuntimeStarts.get(key), newRecord);
      else assert.equal(f.host.candidateRuntimeStarts.size, 0);
    });
  }

  for (const bindingKind of ['root', 'invalid-owner', 'legacy']) {
    for (const timing of ['before-prepare', 'during-prepare']) {
      test(`snapshot-only ${kind} rejects ${bindingKind} Runtime responsibility ${timing}`, async () => {
        const gate = deferred();
        let preparations = 0, reservations = 0;
        const f = candidateFixture({ environment: async () => {
          preparations += 1;
          await gate.promise;
          return { TEST: 'value' };
        } });
        f.host.activeSurface = undefined;
        const reserve = f.owner.reserve.bind(f.owner);
        f.owner.reserve = key => { reservations += 1; return reserve(key); };
        const node = f.host.state.nodes.find(value => value.kind === kind);
        const runtimeOwner = bindingKind === 'root' ? createRuntimeOwnerDescriptor({
          environmentKey: 'a'.repeat(64), userStorageScopeKey: 'b'.repeat(64),
          rootPath: path.resolve('/controlled/root'), generation: resolveRootRuntimeSupervisorGeneration(EXECUTION_CANDIDATE_PROFILE)
        }) : bindingKind === 'invalid-owner' ? null : undefined;
        const original = { persistenceMode: 'live-runtime', attachmentState: 'history-restored', liveSession: false,
          lifecycle: kind === 'agent' ? 'stopped' : 'closed', provider: kind === 'agent' ? 'codex' : undefined,
          runtimeOwner, ...(bindingKind === 'invalid-owner' ? {} : {
            runtimeBackend: 'legacy-detached', runtimeSessionId: 'original-session',
            runtimeStoragePath: bindingKind === 'root'
              ? resolveRuntimeRootOwnerBaseStoragePath(path.resolve('/controlled/global-storage'), runtimeOwner)
              : '/controlled/original-workspace-slot'
          }) };
        if (timing === 'before-prepare') { node.metadata[kind] = original; gate.resolve(); }
        const starting = f.start(kind);
        const rejected = assert.rejects(starting, /original Runtime execution.*bound/);
        if (timing === 'during-prepare') {
          await until(f.clock, () => preparations === 1, `${kind} local preparation entered`);
          f.host.state.nodes.find(value => value.kind === kind).metadata[kind] = original;
          gate.resolve();
        }
        await completed(f.clock, rejected, `${kind} retained Runtime binding refused`);
        assert.equal(preparations, timing === 'before-prepare' ? 0 : 1);
        assert.equal(reservations, timing === 'before-prepare' ? 0 : 1);
        assert.equal(f.providers.length, 0, 'No provider may be acquired for a retained Runtime binding.');
        assert.equal(f.owner.snapshot().pending, 0);
        assert.equal(f.host.nonNativeHostExecutions.size, 0);
        assert.deepEqual(f.host.state.nodes.find(value => value.kind === kind).metadata[kind], original,
          'A refusal preserves the original binding, including null.');
      });
    }
  }
  test(`snapshot-only ${kind} starts an already-settled node without a Runtime binding`, async () => {
    const f = candidateFixture();
    f.host.activeSurface = undefined;
    const node = f.host.state.nodes.find(value => value.kind === kind);
    node.metadata[kind] = { persistenceMode: 'snapshot-only', attachmentState: 'history-restored',
      lifecycle: kind === 'agent' ? 'stopped' : 'closed', liveSession: false, terminalHistoryDiscarded: true };
    await completed(f.clock, f.start(kind), `${kind} settled local start`);
    const record = f.record(kind);
    try {
      assert.equal(f.providers.length, 1);
      f.providers[0].process();
      f.providers[0].message({ type: 'resourceResult', resourceId: 'subject', operationId: 'subject-release',
        result: { kind: 'released' } });
      f.providers[0].seal(0); f.providers[0].release();
      await until(f.clock, () => record.execution.snapshot().settled, `${kind} settled local finalization`);
    } finally {
      record.tracker.dispose();
      record.business?.cancelActivityPoll?.();
      record.business?.lineContextTracker.dispose();
    }
  });
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
  f.host.getRuntimeHostBackend = (kind, runtimeStoragePath) => ({ kind, runtimeStoragePath, guarantee: 'best-effort',
    paths: { storageDir: path.join(runtimeStoragePath, 'runtime-supervisor') } });
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

function addStoppedHistoryBinding(f, kind) {
  const session = addCandidateLegacyBinding(f, kind, 'systemd-user');
  const node = f.host.state.nodes.find(value => value.id === session.nodeId);
  node.status = 'history-restored';
  Object.assign(node.metadata[kind], { attachmentState: 'history-restored', liveSession: false,
    lifecycle: kind === 'agent' ? 'stopped' : 'closed', lastExitCode: 0 });
  return session;
}

function unsubmittedDelete() {
  return { ...settledLegacyDelete('unconfirmed', 'controlled refused connection'), submitted: false, attemptSettled: true };
}

for (const evidence of ['recorded-exit', 'stopped-runtime']) {
for (const kind of ['agent', 'terminal']) {
  for (const action of ['delete', 'restart', 'reset']) {
    test(`stopped legacy ${kind} history ${action} uses ${evidence} after an unsubmitted failure without rewriting its evidence`, async () => {
      const f = candidateRuntimeFixture();
      const session = addStoppedHistoryBinding(f, kind);
      const metadata = f.host.state.nodes.find(value => value.id === session.nodeId).metadata[kind];
      if (evidence === 'stopped-runtime') {
        metadata.lifecycle = kind === 'agent' ? 'waiting-input' : 'live';
        delete metadata.lastExitCode;
      }
      const originalMetadata = structuredClone(metadata);
      const other = structuredClone(f.host.state.nodes.find(value => value.id !== session.nodeId));
      const observation = unsubmittedDelete();
      const strict = candidateStrictDeletes(f, () => observation);
      let inspections = 0;
      testLegacyHistoryInspector.run = async (backend, target) => {
        inspections++;
        assert.equal(backend.runtimeStoragePath, session.runtimeStoragePath);
        assert.deepEqual(target, { sessionId: session.sessionId, kind });
        return inspections > 1 ? evidence : undefined;
      };
      try {
        await assert.rejects(f.host.deleteRuntimeSupervisorSessionStrict(session, { allowRestart: true }), /unconfirmed/);
        const original = await observation.first;
        await pump(f.clock, () => [...f.host.strictRuntimeDeletes.values()][0].attemptSettled === true);
        if (action === 'reset') {
          delete f.host.collectPersistedLiveRuntimeSessions;
          await completed(f.clock, f.host.resetState(), 'stopped legacy reset');
          assert.equal(f.host.state.nodes.length, 0);
        } else if (action === 'delete') {
          await completed(f.clock, f.host.deleteNode(session.nodeId), 'stopped legacy delete');
          assert(!f.host.state.nodes.some(value => value.id === session.nodeId), JSON.stringify({
            posted: f.posted, inspections, calls: strict.calls.length, diagnostics: f.diagnostics,
            node: f.host.state.nodes.find(value => value.id === session.nodeId)
          }));
        } else {
          await completed(f.clock, f.start(kind), 'stopped legacy restart');
          assert.equal(f.creates.length, 1);
          assert.notEqual(f.creates[0].sessionId, session.sessionId);
          assert.equal(f.errors.length, 0);
        }
        if (action !== 'reset') assert.deepEqual(f.host.state.nodes.find(value => value.id === other.id), other);
        assert.equal(inspections, 2);
        assert.equal(strict.calls.length, 1, 'historical retirement does not send a second old delete');
        assert.strictEqual(await observation.first, original);
        assert.equal(observation.current().kind, 'unconfirmed');
        assert.equal(f.providers.length, 0);
        assert.deepEqual(metadata, originalMetadata, 'retirement cannot fabricate an exit or EOF on the old execution');
        const retired = f.diagnostics.filter(event => event.name === 'runtime/legacyHistoryRetired');
        assert.equal(retired.length, 1);
        assert.equal(retired[0].detail.retirementEvidence, evidence);
      } finally { testLegacyHistoryInspector.run = async () => undefined; }
    });
  }
}
}

test('an ended unsubmitted delete can reconnect on a later operation, not while its original attempt is pending', async () => {
  const f = candidateFixture();
  const session = addCandidateLegacyBinding(f, 'terminal');
  const first = unsubmittedDelete();
  first.attemptSettled = false;
  const strict = candidateStrictDeletes(f, () => strict.calls.length === 1 ? first : settledLegacyDelete('legacy-absent'));
  await assert.rejects(f.host.deleteRuntimeSupervisorSessionStrict(session, { allowRestart: true }), /unconfirmed/);
  await pump(f.clock, () => [...f.host.strictRuntimeDeletes.values()][0].attemptSettled === true);
  await assert.rejects(f.host.deleteRuntimeSupervisorSessionStrict(session, { allowRestart: true }), /unconfirmed/);
  assert.equal(strict.calls.length, 1);
  first.attemptSettled = true;
  await f.host.deleteRuntimeSupervisorSessionStrict(session, { allowRestart: true });
  assert.equal(strict.calls.length, 2);
  assert.equal((await first.first).kind, 'unconfirmed');
});

for (const protection of ['live', 'attached', 'submitted-start', 'submitted-delete', 'pending-delete',
  'finalization', 'failed-finalization', 'unknown-finalization', 'reader', 'projection', 'state-callback']) {
  test(`stopped history inspection cannot bypass ${protection}`, async () => {
    const f = candidateRuntimeFixture();
    const session = addStoppedHistoryBinding(f, 'agent');
    const node = f.host.state.nodes.find(value => value.id === session.nodeId);
    const key = f.host.getExecutionSessionOperationKey('agent', session.nodeId);
    const strict = candidateStrictDeletes(f, () => unsubmittedDelete());
    let inspected = 0;
    testLegacyHistoryInspector.run = async () => { inspected++; return 'stopped-runtime'; };
    if (protection === 'live') node.metadata.agent.liveSession = true;
    if (protection === 'attached') f.host.agentSessions.set(session.nodeId, { owner: 'supervisor' });
    if (protection === 'submitted-start') f.host.candidateRuntimeStarts = new Map([[key, { submitted: true }]]);
    if (protection === 'reader') f.host.terminalReadRelay.usesSession = () => true;
    if (protection === 'projection') f.host.pendingTerminalProjectionRefreshes.set(
      f.host.getTerminalProjectionRefreshKey('agent', session.nodeId, session.sessionId), Promise.resolve());
    if (protection === 'state-callback') f.host.pendingRuntimeSupervisorStateCallbacks = new Set([Promise.resolve()]);
    if (['submitted-delete', 'pending-delete', 'finalization', 'failed-finalization', 'unknown-finalization'].includes(protection)) {
      const result = { kind: 'unconfirmed' };
      const record = { session, deadline: 20, first: Promise.resolve(result), result, attemptSettled: true,
        observation: { first: Promise.resolve(result), current: () => result,
          submitted: protection === 'submitted-delete', attemptSettled: protection !== 'pending-delete' } };
      if (protection === 'finalization') record.finalization = Promise.resolve();
      if (protection === 'failed-finalization') record.finalizationError = 'controlled save failure';
      if (protection === 'unknown-finalization') record.finalizationUnconfirmed = true;
      f.host.strictRuntimeDeletes = new Map([[f.host.strictRuntimeDeleteKey(session), record]]);
    }
    try {
      await assert.rejects(f.host.deleteRuntimeSupervisorSessionStrict(session, { allowRestart: true }), /unconfirmed|failed|pending/);
      assert.equal(inspected, 0);
      assert.equal(f.creates.length, 0);
      assert.equal(node.metadata.agent.runtimeSessionId, session.sessionId);
    } finally { testLegacyHistoryInspector.run = async () => undefined; }
  });
}

for (const change of ['binding', 'metadata', 'deadline']) {
  test(`stopped history rechecks ${change} after the read-only inspection`, async () => {
    const f = candidateRuntimeFixture();
    const session = addStoppedHistoryBinding(f, 'terminal');
    candidateStrictDeletes(f, () => unsubmittedDelete());
    const gate = deferred();
    const entered = deferred();
    testLegacyHistoryInspector.run = async () => { entered.resolve(); return gate.promise; };
    try {
      const operation = f.host.deleteRuntimeSupervisorSessionStrict(session, { allowRestart: true });
      const rejected = assert.rejects(operation, /unconfirmed|deadline/);
      await entered.promise;
      const node = f.host.state.nodes.find(value => value.id === session.nodeId);
      if (change === 'binding') node.metadata.terminal.runtimeSessionId = 'new-binding';
      if (change === 'metadata') node.metadata.terminal = { ...node.metadata.terminal, liveSession: true };
      if (change === 'deadline') f.clock.advance(EXECUTION_CANDIDATE_BUDGETS.boundaryMs);
      if (change !== 'deadline') gate.resolve('stopped-runtime');
      await completed(f.clock, rejected, 'changed history inspection');
      gate.resolve('stopped-runtime');
      assert(f.host.state.nodes.some(value => value.id === session.nodeId));
      assert.equal(f.creates.length, 0);
    } finally { testLegacyHistoryInspector.run = async () => undefined; }
  });
}

for (const change of ['metadata', 'reader', 'submitted-start']) {
  test(`batch history cleanup rechecks ${change} after waiting for another binding`, async () => {
    const f = candidateRuntimeFixture();
    const first = addStoppedHistoryBinding(f, 'agent');
    const second = addStoppedHistoryBinding(f, 'terminal');
    const inspected = deferred();
    const gate = deferred();
    const strict = candidateStrictDeletes(f, () => unsubmittedDelete());
    const prepare = f.host.prepareStoppedLegacyHistoryRetirement.bind(f.host);
    f.host.prepareStoppedLegacyHistoryRetirement = async (...args) => {
      const result = await prepare(...args);
      if (args[0].sessionId === first.sessionId) inspected.resolve();
      return result;
    };
    testLegacyHistoryInspector.run = async (_backend, target) => target.sessionId === first.sessionId ? 'stopped-runtime' : gate.promise;
    try {
      const operation = f.host.deleteRuntimeSupervisorSessionsWithCandidate([first, second]);
      const rejected = assert.rejects(operation, /old-agent: unconfirmed/);
      await inspected.promise;
      const node = f.host.state.nodes.find(value => value.id === first.nodeId);
      if (change === 'metadata') node.metadata.agent = { ...node.metadata.agent, liveSession: true };
      if (change === 'reader') f.host.terminalReadRelay.usesSession = id => id === first.sessionId;
      if (change === 'submitted-start') f.host.candidateRuntimeStarts = new Map([
        [f.host.getExecutionSessionOperationKey(first.kind, first.nodeId), { submitted: true }]
      ]);
      gate.resolve('stopped-runtime');
      await completed(f.clock, rejected, 'changed batch history eligibility');
      assert.equal(f.host.state.nodes.length, 2);
      assert.equal(strict.calls.length, 0);
      assert.equal(f.diagnostics.some(event => event.name === 'runtime/legacyHistoryRetired'), false);
    } finally { gate.resolve(undefined); testLegacyHistoryInspector.run = async () => undefined; }
  });
}

const nativeHistoryStoragePath = '/controlled/runtime-supervisor-generations/terminal-exit-v1';
const detachedHistoryStoragePath = '/controlled/runtime-supervisor-generations/terminal-stream-v1';
const unversionedHistoryStoragePaths = ['legacy-slot', 'legacy-slot-1'].map(slot =>
  `/controlled/workspaceStorage/${slot}/devsessioncanvas.dev-session-canvas`);

function addDetachedRestoredHistoryBinding(f, kind, runtimeStoragePath = detachedHistoryStoragePath) {
  const session = addCandidateLegacyBinding(f, kind);
  f.host.unbindRuntimeSession(session.sessionId, session.runtimeStoragePath, kind, session.backendKind);
  session.runtimeStoragePath = runtimeStoragePath;
  const node = f.host.state.nodes.find(value => value.id === session.nodeId);
  node.status = 'history-restored';
  Object.assign(node.metadata[kind], { attachmentState: 'history-restored', liveSession: false,
    lifecycle: kind === 'agent' ? 'stopped' : 'closed', runtimeStoragePath });
  f.host.bindRuntimeSession(node.id, kind, session.sessionId, runtimeStoragePath, session.backendKind);
  return session;
}

for (const [runtimeStoragePath, kind] of [detachedHistoryStoragePath, ...unversionedHistoryStoragePaths]
  .flatMap(storage => ['agent', 'terminal'].map(kind => [storage, kind]))) {
  for (const action of ['delete', 'restart', 'reset']) {
    test(`detached restored ${kind} ${action} uses target evidence after an unsubmitted failure: ${runtimeStoragePath}`, async () => {
      const f = candidateRuntimeFixture();
      const session = addDetachedRestoredHistoryBinding(f, kind, runtimeStoragePath);
      const metadata = f.host.state.nodes.find(node => node.id === session.nodeId).metadata[kind];
      const originalMetadata = structuredClone(metadata);
      const other = structuredClone(f.host.state.nodes.find(node => node.id !== session.nodeId));
      const observation = unsubmittedDelete();
      const strict = candidateStrictDeletes(f, () => observation);
      let inspections = 0;
      let preferredCalled = false;
      let capabilityChecked = false;
      const preferred = f.host.getPreferredRuntimeSupervisorClient;
      const supports = f.client.supportsExecutionCandidateProfile;
      f.host.getPreferredRuntimeSupervisorClient = async (...args) => {
        assert.equal(inspections, 2, 'old-generation cleanup must finish before starting the new Supervisor');
        preferredCalled = true;
        return preferred(...args);
      };
      f.client.supportsExecutionCandidateProfile = (...args) => { capabilityChecked = true; return supports(...args); };
      testNativeHistoryInspector.run = async () => assert.fail('old detached history cannot use namespace absence evidence');
      testLegacyHistoryInspector.run = async (backend, target, signal) => {
        assert.equal(backend.runtimeStoragePath, session.runtimeStoragePath);
        assert.deepEqual(target, { sessionId: session.sessionId, kind });
        assert.equal(signal.aborted, false);
        if (++inspections === 1) return undefined;
        if (action === 'restart') {
          assert.equal(preferredCalled, false);
          assert.equal(capabilityChecked, false, 'old history cleanup must precede new-owner acquisition');
        }
        return 'detached-recovered-history';
      };
      try {
        await assert.rejects(f.host.deleteRuntimeSupervisorSessionStrict(session, { allowRestart: false }), /unconfirmed/);
        await pump(f.clock, () => [...f.host.strictRuntimeDeletes.values()][0].attemptSettled === true);
        const original = await observation.first;
        if (action === 'delete') {
          await completed(f.clock, f.host.deleteNode(session.nodeId), 'old detached history delete');
          assert(!f.host.state.nodes.some(node => node.id === session.nodeId), JSON.stringify(f.posted));
        } else if (action === 'reset') {
          delete f.host.collectPersistedLiveRuntimeSessions;
          await completed(f.clock, f.host.resetState(), 'old detached history reset');
          assert.equal(f.host.state.nodes.length, 0);
        } else {
          await completed(f.clock, f.start(kind), 'old detached history restart');
          assert.equal(f.creates.length, 1, JSON.stringify(f.errors));
          assert.notEqual(f.creates[0].sessionId, session.sessionId);
        }
        if (action !== 'reset') assert.deepEqual(f.host.state.nodes.find(node => node.id === other.id), other);
        assert.equal(inspections, 2);
        assert.equal(strict.calls.length, 1);
        assert.strictEqual(await observation.first, original);
        assert.equal(observation.current().kind, 'unconfirmed');
        assert.deepEqual(metadata, originalMetadata, 'restored history cleanup cannot synthesize an exit or EOF');
        assert.equal(f.diagnostics.filter(event => event.detail?.retirementEvidence === 'detached-recovered-history').length, 1);
        assert.equal(f.providers.length, 0);
      } finally {
        testLegacyHistoryInspector.run = async () => undefined;
        testNativeHistoryInspector.run = async () => undefined;
      }
    });
  }

  test(`detached restored ${kind} retires confirmed history before rejecting an incompatible replacement: ${runtimeStoragePath}`, async () => {
    const f = candidateRuntimeFixture();
    const session = addDetachedRestoredHistoryBinding(f, kind, runtimeStoragePath);
    const node = f.host.state.nodes.find(value => value.id === session.nodeId);
    const metadata = structuredClone(node.metadata[kind]);
    const strict = candidateStrictDeletes(f, () => unsubmittedDelete());
    f.client.supportsExecutionCandidateProfile = () => false;
    let inspections = 0;
    testLegacyHistoryInspector.run = async () => { inspections++; return 'detached-recovered-history'; };
    testNativeHistoryInspector.run = async () => assert.fail('old generation cannot enter native preflight');
    try {
      await completed(f.clock, f.start(kind), 'old detached incompatible replacement');
      assert(f.errors.some(message => /support.*profile/i.test(message)), JSON.stringify(f.errors));
      assert.equal(inspections, 1);
      assert.equal(strict.calls.length, 0);
      assert.equal(f.creates.length, 0);
      assert.deepEqual(node.metadata[kind], metadata);
      assert.equal(f.host.runtimeSessionBindings.size, 0);
      assert.equal(f.diagnostics.some(event => event.detail?.retirementEvidence === 'detached-recovered-history'), true);
    } finally {
      testLegacyHistoryInspector.run = async () => undefined;
      testNativeHistoryInspector.run = async () => undefined;
    }
  });
}

test('detached restored history in one storage does not share target-specific qualification', async () => {
  const f = candidateRuntimeFixture();
  const sessions = [addDetachedRestoredHistoryBinding(f, 'agent'), addDetachedRestoredHistoryBinding(f, 'terminal')];
  const nodes = structuredClone(f.host.state.nodes);
  const strict = candidateStrictDeletes(f, () => unsubmittedDelete());
  const targets = [];
  testNativeHistoryInspector.run = async () => assert.fail('old target records cannot share native owner evidence');
  testLegacyHistoryInspector.run = async (backend, target) => {
    assert.equal(backend.runtimeStoragePath, detachedHistoryStoragePath);
    targets.push(target.sessionId);
    return target.sessionId === sessions[0].sessionId ? 'detached-recovered-history' : undefined;
  };
  try {
    await assert.rejects(f.host.deleteRuntimeSupervisorSessionsWithCandidate(sessions), /old-terminal: unconfirmed/);
    assert.deepEqual(targets.sort(), sessions.map(session => session.sessionId).sort());
    assert.equal(strict.calls.length, 1);
    assert.equal(strict.calls[0].params.sessionId, sessions[1].sessionId);
    assert.deepEqual(f.host.state.nodes, nodes);
    assert.equal(f.diagnostics.some(event => event.detail?.retirementEvidence === 'detached-recovered-history'), false);
  } finally {
    testLegacyHistoryInspector.run = async () => undefined;
    testNativeHistoryInspector.run = async () => undefined;
  }
});

for (const change of ['metadata', 'reader']) {
  test(`detached restored history rechecks ${change} after target inspection`, async () => {
    const f = candidateRuntimeFixture();
    const session = addDetachedRestoredHistoryBinding(f, 'agent');
    const node = f.host.state.nodes.find(value => value.id === session.nodeId);
    const bindings = new Map(f.host.runtimeSessionBindings);
    candidateStrictDeletes(f, () => unsubmittedDelete());
    const entered = deferred();
    const gate = deferred();
    testLegacyHistoryInspector.run = async () => { entered.resolve(); return gate.promise; };
    testNativeHistoryInspector.run = async () => assert.fail('old generation cannot use native evidence');
    try {
      const rejected = assert.rejects(f.host.deleteRuntimeSupervisorSessionStrict(session, { allowRestart: false }), /unconfirmed/);
      await entered.promise;
      if (change === 'metadata') node.metadata.agent = { ...node.metadata.agent, liveSession: true };
      if (change === 'reader') f.host.terminalReadRelay.usesSession = () => true;
      gate.resolve('detached-recovered-history');
      await completed(f.clock, rejected, 'old detached target eligibility changed');
      assert.strictEqual(f.host.state.nodes.find(value => value.id === session.nodeId), node);
      assert.deepEqual(f.host.runtimeSessionBindings, bindings);
      assert.equal(f.diagnostics.some(event => event.detail?.retirementEvidence === 'detached-recovered-history'), false);
    } finally {
      gate.resolve(undefined);
      testLegacyHistoryInspector.run = async () => undefined;
      testNativeHistoryInspector.run = async () => undefined;
    }
  });
}

for (const runtimeStoragePath of [detachedHistoryStoragePath, ...unversionedHistoryStoragePaths,
  '/controlled/runtime-supervisor-generations/terminal-stream-v1-alias',
  '/controlled/runtime-supervisor-generations/unknown-generation']) {
  test(`detached history inspector rejection stays protected without native fallback: ${path.basename(runtimeStoragePath)}`, async () => {
    const f = candidateRuntimeFixture();
    const session = addDetachedRestoredHistoryBinding(f, 'terminal', runtimeStoragePath);
    const strict = candidateStrictDeletes(f, () => unsubmittedDelete());
    let inspections = 0;
    testLegacyHistoryInspector.run = async () => { inspections++; return undefined; };
    testNativeHistoryInspector.run = async () => assert.fail('rejected old history cannot fall back to native evidence');
    try {
      await assert.rejects(f.host.deleteRuntimeSupervisorSessionStrict(session, { allowRestart: false }), /unconfirmed/);
      assert.equal(inspections, 1);
      assert.equal(strict.calls.length, 1);
      assert.equal(f.host.state.nodes.find(node => node.id === session.nodeId).metadata.terminal.runtimeSessionId, session.sessionId);
      assert.equal(f.diagnostics.some(event => event.detail?.retirementEvidence === 'detached-recovered-history'), false);
    } finally {
      testLegacyHistoryInspector.run = async () => undefined;
      testNativeHistoryInspector.run = async () => undefined;
    }
  });
}

function addNativeHistoryBinding(f, kind) {
  const session = addCandidateLegacyBinding(f, kind);
  f.host.unbindRuntimeSession(session.sessionId, session.runtimeStoragePath, kind, session.backendKind);
  session.runtimeStoragePath = nativeHistoryStoragePath;
  const node = f.host.state.nodes.find(value => value.id === session.nodeId);
  node.status = 'history-restored';
  Object.assign(node.metadata[kind], { attachmentState: 'history-restored', liveSession: false,
    runtimeStoragePath: session.runtimeStoragePath });
  f.host.bindRuntimeSession(node.id, kind, session.sessionId, session.runtimeStoragePath, session.backendKind);
  return session;
}

function nativeHistoryStrictDeletes(f, behavior) {
  const strict = candidateStrictDeletes(f, behavior);
  const original = f.host.getRuntimeHostBackend;
  f.host.getRuntimeHostBackend = (kind, runtimeStoragePath) => ({ ...original(kind, runtimeStoragePath),
    paths: { storageDir: path.join(runtimeStoragePath, 'runtime-supervisor') } });
  return strict;
}

for (const kind of ['agent', 'terminal']) {
  for (const action of ['delete', 'restart', 'reset']) {
    test(`native ${kind} history ${action} retries ended unsubmitted failure without fabricating termination`, async () => {
      const f = candidateRuntimeFixture();
      const session = addNativeHistoryBinding(f, kind);
      const metadata = f.host.state.nodes.find(value => value.id === session.nodeId).metadata[kind];
      const originalMetadata = structuredClone(metadata);
      const other = structuredClone(f.host.state.nodes.find(value => value.id !== session.nodeId));
      const observation = unsubmittedDelete();
      const strict = nativeHistoryStrictDeletes(f, () => observation);
      const preferred = f.host.getPreferredRuntimeSupervisorClient;
      let ownerStarted = false;
      let inspections = 0;
      f.host.getPreferredRuntimeSupervisorClient = async (...args) => {
        assert.equal(inspections, 2, 'native predecessor is inspected before starting the preferred Supervisor');
        ownerStarted = true;
        return preferred(...args);
      };
      testNativeHistoryInspector.run = async backend => {
        assert.equal(ownerStarted, false, 'a newly started owner must not block its predecessor preflight');
        assert.equal(backend.runtimeStoragePath, session.runtimeStoragePath);
        return ++inspections > 1 ? 'native-owner-absent' : undefined;
      };
      try {
        await assert.rejects(f.host.deleteRuntimeSupervisorSessionStrict(session, { allowRestart: false }), /unconfirmed/);
        await pump(f.clock, () => [...f.host.strictRuntimeDeletes.values()][0].attemptSettled === true);
        const original = await observation.first;
        if (action === 'delete') {
          await completed(f.clock, f.host.deleteNode(session.nodeId), 'native history delete');
          assert(!f.host.state.nodes.some(node => node.id === session.nodeId), JSON.stringify(f.posted));
        } else if (action === 'reset') {
          delete f.host.collectPersistedLiveRuntimeSessions;
          await completed(f.clock, f.host.resetState(), 'native history reset');
          assert.equal(f.host.state.nodes.length, 0);
        } else {
          await completed(f.clock, f.start(kind), 'native history replacement');
          assert.equal(f.creates.length, 1, JSON.stringify(f.errors));
          assert.notEqual(f.creates[0].sessionId, session.sessionId);
          assert.equal(ownerStarted, true);
        }
        if (action !== 'reset') assert.deepEqual(f.host.state.nodes.find(node => node.id === other.id), other);
        assert.equal(inspections, 2);
        assert.equal(strict.calls.length, 1);
        assert.strictEqual(await observation.first, original);
        assert.equal(observation.current().kind, 'unconfirmed');
        assert.deepEqual(metadata, originalMetadata, 'native absence is not a process exit or terminal EOF');
        assert.equal(f.providers.length, 0);
      } finally { testNativeHistoryInspector.run = async () => undefined; }
    });
  }
}

test('native history batch shares one namespace observation and keeps separate target eligibility', async () => {
  const f = candidateRuntimeFixture();
  const sessions = [addNativeHistoryBinding(f, 'agent'), addNativeHistoryBinding(f, 'terminal')];
  const strict = nativeHistoryStrictDeletes(f, () => unsubmittedDelete());
  let inspections = 0;
  testNativeHistoryInspector.run = async () => { inspections++; return 'native-owner-absent'; };
  try {
    await completed(f.clock, f.host.deleteRuntimeSupervisorSessionsWithCandidate(sessions), 'shared native observation');
    assert.equal(inspections, 1);
    assert.equal(strict.calls.length, 0);
    assert.deepEqual(f.diagnostics.filter(event => event.detail?.retirementEvidence === 'native-owner-absent')
      .map(event => event.detail.sessionId).sort(), sessions.map(session => session.sessionId).sort());
  } finally { testNativeHistoryInspector.run = async () => undefined; }
});

test('native history batch cannot let shared evidence bypass a changed target reader', async () => {
  const f = candidateRuntimeFixture();
  const sessions = [addNativeHistoryBinding(f, 'agent'), addNativeHistoryBinding(f, 'terminal')];
  nativeHistoryStrictDeletes(f, () => unsubmittedDelete());
  const entered = deferred();
  const gate = deferred();
  let inspections = 0;
  testNativeHistoryInspector.run = async () => { inspections++; entered.resolve(); return gate.promise; };
  try {
    const rejected = assert.rejects(f.host.deleteRuntimeSupervisorSessionsWithCandidate(sessions), /old-terminal: unconfirmed/);
    await entered.promise;
    f.host.terminalReadRelay.usesSession = sessionId => sessionId === sessions[1].sessionId;
    gate.resolve('native-owner-absent');
    await completed(f.clock, rejected, 'shared native evidence changed reader');
    assert.equal(inspections, 1);
    assert.equal(f.host.state.nodes.length, 2);
    assert.equal(f.diagnostics.some(event => event.detail?.retirementEvidence === 'native-owner-absent'), false);
  } finally { gate.resolve(undefined); testNativeHistoryInspector.run = async () => undefined; }
});

test('native history observation deadline aborts inspection and cannot admit its late absence result', async () => {
  const f = candidateRuntimeFixture();
  const session = addNativeHistoryBinding(f, 'terminal');
  const node = f.host.state.nodes.find(value => value.id === session.nodeId);
  const metadata = structuredClone(node.metadata.terminal);
  const bindings = [...f.host.runtimeSessionBindings.entries()];
  const strict = nativeHistoryStrictDeletes(f, () => unsubmittedDelete());
  const entered = deferred();
  const gate = deferred();
  let signal;
  testNativeHistoryInspector.run = async (_backend, observedSignal) => {
    signal = observedSignal;
    entered.resolve();
    return gate.promise;
  };
  try {
    const rejected = assert.rejects(
      f.host.deleteRuntimeSupervisorSessionStrict(session, { allowRestart: false }), /unconfirmed|deadline/);
    await entered.promise;
    assert.equal(signal.aborted, false);
    f.clock.advance(f.clock.now() + EXECUTION_CANDIDATE_BUDGETS.boundaryMs);
    assert.equal(signal.aborted, true, 'the Host deadline must cancel the outstanding native inspection');
    await completed(f.clock, rejected, 'native inspection deadline');
    gate.resolve('native-owner-absent');
    await pump(f.clock);
    assert.equal(strict.calls.length, 0, 'expiration cannot dispatch a late strict deletion');
    assert.deepEqual(f.host.runtimeSessionBindings, new Map(bindings));
    assert.strictEqual(f.host.state.nodes.find(value => value.id === session.nodeId), node);
    assert.deepEqual(node.metadata.terminal, metadata);
    assert.equal(f.diagnostics.some(event => event.detail?.retirementEvidence === 'native-owner-absent'), false);
  } finally { gate.resolve(undefined); testNativeHistoryInspector.run = async () => undefined; }
});

test('native history evidence is not cached across independent user operations', async () => {
  const f = candidateRuntimeFixture();
  const session = addNativeHistoryBinding(f, 'agent');
  const strict = nativeHistoryStrictDeletes(f, () => unsubmittedDelete());
  f.client.supportsExecutionCandidateProfile = () => false;
  const observations = ['native-owner-absent', undefined, 'native-owner-absent'];
  let inspections = 0;
  testNativeHistoryInspector.run = async () => observations[inspections++];
  try {
    await completed(f.clock, f.start('agent'), 'native preflight before incompatible replacement');
    assert.equal(inspections, 1);
    assert.equal(f.creates.length, 0);
    assert(f.host.state.nodes.some(node => node.id === session.nodeId));
    assert.equal(f.diagnostics.filter(event => event.detail?.retirementEvidence === 'native-owner-absent').length, 1);

    await completed(f.clock, f.host.deleteNode(session.nodeId), 'independent unknown native delete');
    assert.equal(inspections, 2, 'the next operation must inspect, even after a successful preflight');
    assert(f.host.state.nodes.some(node => node.id === session.nodeId), 'previous absence cannot authorize the new unknown operation');
    assert.equal(strict.calls.length, 1);
    assert.equal(f.diagnostics.filter(event => event.detail?.retirementEvidence === 'native-owner-absent').length, 1);
    await pump(f.clock, () => [...f.host.strictRuntimeDeletes.values()][0].attemptSettled === true);

    await completed(f.clock, f.host.deleteNode(session.nodeId), 'independent confirmed native delete');
    assert.equal(inspections, 3);
    assert(!f.host.state.nodes.some(node => node.id === session.nodeId));
    assert.equal(f.diagnostics.filter(event => event.detail?.retirementEvidence === 'native-owner-absent').length, 2);
  } finally { testNativeHistoryInspector.run = async () => undefined; }
});

for (const kind of ['agent', 'terminal']) {
  test(`native ${kind} history remains bound when owner absence is not established`, async () => {
    const f = candidateRuntimeFixture();
    const session = addNativeHistoryBinding(f, kind);
    const strict = nativeHistoryStrictDeletes(f, () => unsubmittedDelete());
    let inspections = 0;
    testNativeHistoryInspector.run = async () => { inspections++; return undefined; };
    try {
      await assert.rejects(f.host.deleteRuntimeSupervisorSessionStrict(session, { allowRestart: false }), /unconfirmed/);
      assert.equal(inspections, 1);
      assert.equal(strict.calls.length, 1);
      assert.equal(f.host.state.nodes.find(node => node.id === session.nodeId).metadata[kind].runtimeSessionId, session.sessionId);
    } finally { testNativeHistoryInspector.run = async () => undefined; }
  });
}

for (const protection of ['submitted-start', 'submitted-delete', 'reader', 'finalization', 'failed-finalization', 'unknown-finalization']) {
  test(`native owner absence cannot bypass ${protection}`, async () => {
    const f = candidateRuntimeFixture();
    const session = addNativeHistoryBinding(f, 'agent');
    nativeHistoryStrictDeletes(f, () => unsubmittedDelete());
    let inspections = 0;
    testNativeHistoryInspector.run = async () => { inspections++; return 'native-owner-absent'; };
    const key = f.host.getExecutionSessionOperationKey('agent', session.nodeId);
    if (protection === 'submitted-start') f.host.candidateRuntimeStarts = new Map([[key, { submitted: true }]]);
    if (protection === 'reader') f.host.terminalReadRelay.usesSession = () => true;
    if (protection.includes('delete') || protection.includes('finalization')) {
      const result = { kind: 'unconfirmed' };
      const record = { session, deadline: 20, first: Promise.resolve(result), result, attemptSettled: true,
        observation: { first: Promise.resolve(result), current: () => result, submitted: protection === 'submitted-delete', attemptSettled: true } };
      if (protection === 'finalization') record.finalization = Promise.resolve();
      if (protection === 'failed-finalization') record.finalizationError = 'controlled final save failure';
      if (protection === 'unknown-finalization') record.finalizationUnconfirmed = true;
      f.host.strictRuntimeDeletes = new Map([[f.host.strictRuntimeDeleteKey(session), record]]);
    }
    try {
      await assert.rejects(f.host.deleteRuntimeSupervisorSessionStrict(session, { allowRestart: false }), /unconfirmed|failed|pending/);
      assert.equal(inspections, 0);
      assert.equal(f.host.state.nodes.find(node => node.id === session.nodeId).metadata.agent.runtimeSessionId, session.sessionId);
    } finally { testNativeHistoryInspector.run = async () => undefined; }
  });
}

for (const kind of ['agent', 'terminal']) {
  test(`native ${kind} restart retires confirmed predecessor before rejecting an incompatible new client`, async () => {
    const f = candidateRuntimeFixture();
    const session = addNativeHistoryBinding(f, kind);
    const metadata = structuredClone(f.host.state.nodes.find(node => node.id === session.nodeId).metadata[kind]);
    const strict = nativeHistoryStrictDeletes(f, () => unsubmittedDelete());
    f.client.supportsExecutionCandidateProfile = () => false;
    let inspections = 0;
    testNativeHistoryInspector.run = async () => { inspections++; return 'native-owner-absent'; };
    try {
      await completed(f.clock, f.start(kind), 'incompatible native replacement');
      assert.equal(inspections, 1);
      assert.equal(strict.calls.length, 0, 'confirmed absence must not submit a predecessor delete');
      assert.equal(f.creates.length, 0);
      assert(f.errors.some(message => /support.*profile/i.test(message)), JSON.stringify(f.errors));
      assert.deepEqual(f.host.state.nodes.find(node => node.id === session.nodeId).metadata[kind], metadata);
      assert.equal(f.host.runtimeSessionBindings.size, 0);
      assert.equal(f.diagnostics.some(event => event.detail?.retirementEvidence === 'native-owner-absent'), true);
    } finally { testNativeHistoryInspector.run = async () => undefined; }
  });

  for (const change of ['metadata', 'reader', 'token']) {
    test(`native ${kind} restart rechecks ${change} after preferred startup`, async () => {
      const f = candidateRuntimeFixture();
      const session = addNativeHistoryBinding(f, kind);
      nativeHistoryStrictDeletes(f, () => unsubmittedDelete());
      const preferred = f.host.getPreferredRuntimeSupervisorClient;
      const entered = deferred();
      const gate = deferred();
      let inspections = 0;
      testNativeHistoryInspector.run = async () => { inspections++; return 'native-owner-absent'; };
      f.host.getPreferredRuntimeSupervisorClient = async (...args) => {
        assert.equal(inspections, 1);
        entered.resolve();
        await gate.promise;
        return preferred(...args);
      };
      try {
        const operation = f.start(kind);
        await entered.promise;
        const node = f.host.state.nodes.find(value => value.id === session.nodeId);
        if (change === 'metadata') node.metadata[kind] = { ...node.metadata[kind], runtimeSessionId: 'replacement-binding' };
        if (change === 'reader') f.host.terminalReadRelay.usesSession = () => true;
        if (change === 'token') f.host.beginExecutionSessionOperation(kind, session.nodeId);
        gate.resolve();
        await completed(f.clock, operation, 'native replacement changed identity');
        assert.equal(f.creates.length, 0);
        assert(f.errors.length > 0);
        assert.equal(node.metadata[kind].runtimeSessionId, change === 'metadata' ? 'replacement-binding' : session.sessionId);
        assert.equal(f.diagnostics.some(event => event.detail?.retirementEvidence === 'native-owner-absent'), true);
      } finally { gate.resolve(); testNativeHistoryInspector.run = async () => undefined; }
    });
  }

  test(`native ${kind} replacement retains same-start absence evidence after a slow preferred startup`, async () => {
    const f = candidateRuntimeFixture();
    const session = addNativeHistoryBinding(f, kind);
    const strict = nativeHistoryStrictDeletes(f, () => unsubmittedDelete());
    const preferred = f.host.getPreferredRuntimeSupervisorClient;
    let inspections = 0;
    testNativeHistoryInspector.run = async () => { inspections++; return 'native-owner-absent'; };
    f.host.getPreferredRuntimeSupervisorClient = async (...args) => {
      assert.equal(inspections, 1);
      f.clock.advance(f.clock.now() + EXECUTION_CANDIDATE_BUDGETS.boundaryMs + 1);
      return preferred(...args);
    };
    try {
      await completed(f.clock, f.start(kind), 'native replacement after slow startup');
      assert.equal(f.creates.length, 1, JSON.stringify(f.errors));
      assert.notEqual(f.creates[0].sessionId, session.sessionId);
      assert.equal(inspections, 1, 'same-start evidence cannot reacquire a namespace now owned by the new Supervisor');
      assert.equal(strict.calls.length, 0);
    } finally { testNativeHistoryInspector.run = async () => undefined; }
  });
}

function candidateRuntimeRoutingFixture() {
  const f = candidateRuntimeFixture();
  const baseStoragePath = path.resolve('/controlled/workspace-runtime');
  f.host.context = { extensionMode: 3, extensionUri: { fsPath: '/controlled/extension' } };
  f.host.getExtensionStoragePath = () => baseStoragePath;
  f.host.resolveRuntimeStoragePath = CanvasPanelManager.prototype.resolveRuntimeStoragePath;
  f.host.resolveRuntimeCreationTarget = CanvasPanelManager.prototype.resolveRuntimeCreationTarget;
  f.host.getPreferredRuntimeSupervisorClient = CanvasPanelManager.prototype.getPreferredRuntimeSupervisorClient;
  return { ...f, baseStoragePath,
    candidateStoragePath: path.join(baseStoragePath, 'runtime-supervisor-generations', 'terminal-current-state-linux-v1') };
}

async function withRootCandidateRuntimeFixture(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'host-root-runtime-owner-'));
  const globalStoragePath = await realpath(directory);
  const roots = [{ path: path.resolve('/controlled/project-root'), name: 'project-root' }];
  const f = candidateRuntimeFixture({ roots });
  f.host.context = { extensionMode: 3, extensionUri: { fsPath: '/controlled/extension' },
    globalStorageUri: { fsPath: globalStoragePath } };
  f.host.resolveRuntimeCreationTarget = CanvasPanelManager.prototype.resolveRuntimeCreationTarget;
  f.host.resolveRuntimeStoragePath = CanvasPanelManager.prototype.resolveRuntimeStoragePath;
  f.host.getExtensionStoragePath = () => path.join(globalStoragePath, 'workspace-slot');
  const environment = { environmentKey: 'a'.repeat(64), userIdentity: 'controlled-test-user' };
  f.host.runtimeExecutionEnvironmentPromise = Promise.resolve(environment);
  const owner = createRuntimeOwnerDescriptor({ environmentKey: environment.environmentKey,
    userStorageScopeKey: createRuntimeUserStorageScopeKey(environment.userIdentity, globalStoragePath),
    rootPath: roots[0].path, generation: resolveRootRuntimeSupervisorGeneration(EXECUTION_CANDIDATE_PROFILE) });
  const target = { rootPath: roots[0].path, runtimeOwner: owner,
    runtimeStoragePath: resolveRuntimeRootOwnerBaseStoragePath(globalStoragePath, owner) };
  try { await run({ ...f, roots, owner, target, globalStoragePath }); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

for (const kind of ['terminal', 'agent']) {
  test(`root ${kind} new creation routes its confirmed owner through preparation client metadata and subscription`, async () => {
    if (process.platform !== 'linux') return;
    await withRootCandidateRuntimeFixture(async f => {
      const preparations = [];
      f.host.getPreferredRuntimeSupervisorClient = CanvasPanelManager.prototype.getPreferredRuntimeSupervisorClient;
      testRootRuntimePreparation.run = async request => {
        preparations.push(request);
        assert.deepEqual(request.owner, f.owner);
        assert.equal(request.storageDir, path.join(f.target.runtimeStoragePath, 'runtime-supervisor'));
        assert.equal(request.executionProfile, EXECUTION_CANDIDATE_PROFILE);
        return { kind: 'ready', backend: 'legacy-detached' };
      };
      try {
        await withRuntimeConnectionBoundary(async ({ connections, creates }) => {
          await completed(f.clock, f.start(kind), `${kind} root owner creation`);
          assert.deepEqual(f.errors, []);
          assert.equal(preparations.length, 1);
          assert.equal(connections.length, 1);
          assert.equal(connections[0].options.allowRestart, false, 'root startup belongs to the preparation owner');
          assert.deepEqual(connections[0].options.expectedRuntimeOwner, f.owner);
          assert.equal(connections[0].client.matchesRuntimeOwner(f.owner), true);
          assert.equal(creates.length, 1);
          assert.equal(creates[0].request.kind, kind);
          assert.equal(creates[0].request.launchSpec.cwd, '/controlled', 'execution cwd is not the runtime root identity');
          const metadata = f.host.state.nodes.find(node => node.kind === kind).metadata[kind];
          assert.deepEqual(metadata.runtimeOwner, f.owner);
          assert.equal(metadata.runtimeStoragePath, f.target.runtimeStoragePath);
          assert.equal(metadata.runtimeSessionId, creates[0].request.sessionId);
          assert.equal([...f.host.runtimeSessionBindings.values()][0].runtimeStoragePath, f.target.runtimeStoragePath);
          assert.deepEqual(f.host.getPersistedLiveRuntimeSessionForNode(
            f.host.state.nodes.find(node => node.kind === kind)).runtimeOwner, f.owner);
          assert.equal(f.subscriptions.length, 1);
          assert.deepEqual(f.subscriptions[0][2], f.owner);
        });
      } finally {
        testRootRuntimePreparation.run = async () => { throw new Error('Unexpected root runtime preparation'); };
      }
    });
  });

  test(`root ${kind} confirms its original binding cleanup before resolving or acquiring the new owner`, async () => {
    if (process.platform !== 'linux') return;
    await withRootCandidateRuntimeFixture(async f => {
      const previous = addCandidateLegacyBinding(f, kind);
      const oldOwner = createRuntimeOwnerDescriptor({ ...f.owner, rootPath: '/controlled/previous-root' });
      previous.runtimeOwner = oldOwner;
      previous.runtimeStoragePath = resolveRuntimeRootOwnerBaseStoragePath(f.globalStoragePath, oldOwner);
      const node = f.host.state.nodes.find(value => value.kind === kind);
      Object.assign(node.metadata[kind], { runtimeOwner: oldOwner, runtimeStoragePath: previous.runtimeStoragePath });
      f.host.bindRuntimeSession(node.id, kind, previous.sessionId, previous.runtimeStoragePath, previous.backendKind);
      const cleanup = deferred();
      let outcome;
      const strict = candidateStrictDeletes(f, () => ({ first: cleanup.promise, current: () => outcome, submitted: true }));
      const resolveTarget = f.host.resolveRuntimeCreationTarget.bind(f.host);
      const preferred = f.host.getPreferredRuntimeSupervisorClient;
      const order = [];
      f.host.resolveRuntimeCreationTarget = async rootPath => {
        assert.equal(outcome?.kind, 'legacy-acknowledged');
        assert.equal(f.host.runtimeSessionBindings.size, 0);
        order.push('target');
        return resolveTarget(rootPath);
      };
      f.host.getPreferredRuntimeSupervisorClient = async target => {
        assert.deepEqual(target, f.target);
        order.push('owner');
        return preferred(target);
      };
      const starting = f.start(kind);
      await until(f.clock, () => strict.calls.length === 1, `${kind} original owner deletion`);
      assert.equal(strict.calls[0].backend.runtimeStoragePath, previous.runtimeStoragePath);
      assert.equal(strict.calls[0].params.sessionId, previous.sessionId);
      assert.deepEqual(strict.connections[0].options.expectedRuntimeOwner, oldOwner);
      assert.deepEqual(order, []);
      assert.equal(f.creates.length, 0);
      outcome = { kind: 'legacy-acknowledged' };
      cleanup.resolve(outcome);
      await completed(f.clock, starting, `${kind} replacement after original cleanup`);
      assert.deepEqual(f.errors, []);
      assert.deepEqual(order, ['target', 'owner']);
      assert.equal(f.creates.length, 1);
      assert.notEqual(f.creates[0].sessionId, previous.sessionId);
      assert.deepEqual(f.host.state.nodes.find(value => value.kind === kind).metadata[kind].runtimeOwner, f.owner);
    });
  });

  for (const waitingAt of ['environment', 'preflight', 'cleanup', 'target', 'connection']) {
    test(`root ${kind} refuses create when root ownership changes during ${waitingAt}`, async () => {
      if (process.platform !== 'linux') return;
      await withRootCandidateRuntimeFixture(async f => {
        if (waitingAt === 'cleanup') {
          addCandidateLegacyBinding(f, kind);
          candidateStrictDeletes(f, () => settledLegacyDelete('legacy-acknowledged'));
        }
        const entered = deferred();
        const resume = deferred();
        const method = waitingAt === 'environment' ? 'resolveExecutionEnvironment'
          : waitingAt === 'preflight' ? 'prepareNativeHistoryReplacementPreflight'
          : waitingAt === 'cleanup' ? 'prepareExecutionCandidateReplacement'
          : waitingAt === 'target' ? 'resolveRuntimeCreationTarget' : 'getPreferredRuntimeSupervisorClient';
        const original = f.host[method].bind(f.host);
        f.host[method] = async (...args) => {
          const value = await original(...args);
          entered.resolve();
          await resume.promise;
          return value;
        };
        const starting = f.start(kind);
        try {
          await completed(f.clock, entered.promise, `${kind} pending root ${waitingAt}`);
          f.roots[0] = { path: '/controlled/different-root', name: 'different-root' };
          resume.resolve();
          await completed(f.clock, starting, `${kind} changed runtime root`);
          assert.equal(f.creates.length, 0);
          assert.equal(f.host.runtimeSessionBindings.size, 0);
          assert.equal(f.host.candidateRuntimeStarts.size, 0);
          assert(f.errors.some(message => /root.*changed|superseded/i.test(message)), JSON.stringify(f.errors));
          assert.equal(f.host.state.nodes.find(node => node.kind === kind).metadata[kind]?.runtimeOwner, undefined);
        } finally { resume.resolve(); }
      });
    });
  }
}

for (const kind of ['terminal', 'agent']) {
  for (const result of ['late-success', 'disconnected']) {
    test(`root ${kind} ${result} create retains its submitted owner and prevents duplicate mutation`, async () => {
      if (process.platform !== 'linux') return;
      await withRootCandidateRuntimeFixture(async f => {
        delete f.host.collectPersistedLiveRuntimeSessions;
        const acquired = deferred();
        let resolveCreate;
        let rejectCreate;
        const reply = new Promise((resolve, reject) => { resolveCreate = resolve; rejectCreate = reject; });
        f.client.createSession = async request => { f.creates.push(request); acquired.resolve(request); return reply; };
        const staleDeletes = [];
        f.client.deleteSession = async request => { staleDeletes.push(request); };
        const strict = candidateStrictDeletes(f, () => settledLegacyDelete('legacy-absent'));
        const launching = f.start(kind);
        const request = await completed(f.clock, acquired.promise, `${kind} root create submitted`);
        const before = structuredClone(f.host.state);
        const nodeId = `${kind}-1`;
        const token = f.host.executionSessionOperationTokens.get(`${kind}:${nodeId}`);
        assert.deepEqual(before.nodes.find(node => node.id === nodeId).metadata[kind].runtimeOwner, f.owner);
        f.roots[0] = { path: '/controlled/replaced-workspace-root', name: 'replaced-workspace-root' };
        await completed(f.clock, f.start(kind), `${kind} root duplicate create refusal`);
        await completed(f.clock, f.host.deleteNode(nodeId), `${kind} root pending create delete refusal`);
        await assert.rejects(completed(f.clock, f.host.resetState(), `${kind} root pending create reset refusal`),
          /creation|pending|unconfirmed/i);
        assert.equal(f.host.executionSessionOperationTokens.get(`${kind}:${nodeId}`), token);
        assert.deepEqual(f.host.state, before);
        assert.equal(f.creates.length, 1);
        assert.equal(strict.calls.length, 0);
        assert.deepEqual(staleDeletes, [], 'unknown creation cannot enter known-response cleanup');
        if (result === 'late-success') {
          resolveCreate({ sessionId: request.sessionId, kind, runtimeBackend: 'legacy-detached',
            live: true, lifecycle: kind === 'agent' ? 'running' : 'live' });
        } else rejectCreate(new Error('root create connection lost after submission'));
        await completed(f.clock, launching, `${kind} root original create ${result}`);
        const metadata = f.host.state.nodes.find(node => node.id === nodeId).metadata[kind];
        assert.deepEqual(metadata.runtimeOwner, f.owner);
        assert.equal(metadata.runtimeStoragePath, f.target.runtimeStoragePath);
        assert.equal(metadata.runtimeSessionId, request.sessionId);
        assert.equal(f.creates.length, 1);
        assert.equal(strict.calls.length, 0);
        if (result === 'late-success') {
          assert.equal(f.applies.length, 0);
          assert.equal(f.subscriptions.length, 0);
          assert.equal(f.host.runtimeSessionBindings.size, 0);
          assert.deepEqual(staleDeletes, [{ sessionId: request.sessionId }]);
          assert.equal(f.host.candidateRuntimeStarts.size, 0);
        } else {
          assert.equal(f.applies.length, 0);
          assert.deepEqual(staleDeletes, []);
          assert.equal(f.host.candidateRuntimeStarts.size, 1);
          await completed(f.clock, f.start(kind), `${kind} root disconnected create retry refusal`);
          assert.equal(f.creates.length, 1);
          assert.equal(strict.calls.length, 0);
        }
      });
    });
  }

  test(`B2 ${kind} clears a confirmed pre-acquire rejection and permits a later retry`, async () => {
    const f = candidateRuntimeFixture({ rejectBeforeAcquire: true });
    await completed(f.clock, f.start(kind), `${kind} pre-acquire rejection`);
    assert(f.errors.some(message => /rejected-before-acquire/.test(message)), f.errors.join('\n'));
    assert.equal(f.host.candidateRuntimeStarts.size, 0);
    f.setRejectBeforeAcquire(false);
    await completed(f.clock, f.start(kind), `${kind} retry after pre-acquire rejection`);
    assert.equal(f.host.candidateRuntimeStarts.size, 0);
    assert.equal(f.creates.length, 1);
  });
}

for (const kind of ['terminal', 'agent']) {
  for (const waitingAt of ['environment', 'connection', 'prepared']) {
    test(`B2 ${kind} pending ${waitingAt} accepts only its own viewport changes and launches at the latest size`, async () => {
      const f = candidateRuntimeFixture();
      f.host.pendingTerminalInitialInputs = new Map();
      const entered = deferred();
      const resume = deferred();
      const method = waitingAt === 'environment' ? 'resolveExecutionEnvironment'
        : waitingAt === 'connection' ? 'getPreferredRuntimeSupervisorClient' : 'prepareExecutionCandidateReplacement';
      const original = f.host[method].bind(f.host);
      f.host[method] = async (...args) => {
        const result = waitingAt === 'prepared' ? await original(...args) : undefined;
        entered.resolve();
        await resume.promise;
        return waitingAt === 'prepared' ? result : original(...args);
      };
      const starting = f.start(kind);
      await completed(f.clock, entered.promise, `${kind} pending ${waitingAt}`);
      const nodeId = `${kind}-1`;
      f.host.resizeExecutionSession(kind, nodeId, 100, 35);
      f.host.resizeExecutionSession(kind, nodeId, 119, 41);
      resume.resolve();
      await completed(f.clock, starting, `${kind} start after ${waitingAt} resize`);
      assert.equal(f.creates.length, 1, 'A legitimate viewport update must not supersede its original launch.');
      assert.equal(f.creates[0].launchSpec.cols, 119);
      assert.equal(f.creates[0].launchSpec.rows, 41);
      const metadata = f.host.state.nodes.find(node => node.id === nodeId).metadata[kind];
      assert.equal(metadata.lastCols, 119);
      assert.equal(metadata.lastRows, 41);
      assert.equal(f.host.candidateRuntimeStarts.size, 0);
      assert.equal(f.posted.some(message => message.type === 'host/error'), false);
    });
  }

  for (const change of ['same-id-replacement', 'launch-config', 'old-binding', 'prepared-replacement']) {
    test(`B2 ${kind} viewport changes cannot rebase a pending launch onto ${change}`, async () => {
      const f = candidateRuntimeFixture();
      if (change === 'old-binding') addCandidateLegacyBinding(f, kind);
      const strict = candidateStrictDeletes(f, () => settledLegacyDelete('legacy-acknowledged'));
      const entered = deferred();
      const resume = deferred();
      if (change === 'prepared-replacement') {
        const prepare = f.host.prepareExecutionCandidateReplacement.bind(f.host);
        f.host.prepareExecutionCandidateReplacement = async (...args) => {
          const currentViewport = await prepare(...args);
          entered.resolve();
          await resume.promise;
          return currentViewport;
        };
      } else {
        f.host.resolveExecutionEnvironment = async () => { entered.resolve(); await resume.promise; return {}; };
      }
      const starting = f.start(kind);
      await completed(f.clock, entered.promise, `${kind} original pending launch`);
      const nodeId = `${kind}-1`;
      f.host.resizeExecutionSession(kind, nodeId, 100, 35);
      f.host.state = { ...f.host.state, nodes: f.host.state.nodes.map(node => node.id !== nodeId ? node : {
        ...node, metadata: { ...node.metadata, [kind]: { ...node.metadata[kind],
          ...(change === 'launch-config' ? { cwd: '/controlled/reconfigured' } : {}),
          ...(change === 'old-binding' ? { runtimeSessionId: 'replacement-binding' } : {})
        } }
      }) };
      const replacementMetadata = f.host.state.nodes.find(node => node.id === nodeId).metadata[kind];
      f.host.resizeExecutionSession(kind, nodeId, 119, 41);
      resume.resolve();
      await completed(f.clock, starting, `${kind} rejected ${change}`);
      assert.equal(f.creates.length, 0);
      assert.equal(strict.calls.length, 0, 'A replaced binding must not delete the originally captured execution.');
      assert(f.errors.some(message => /superseded/.test(message)), JSON.stringify(f.errors));
      assert(f.posted.some(message => message.type === 'host/error'));
      const metadata = f.host.state.nodes.find(node => node.id === nodeId).metadata[kind];
      if (change === 'launch-config') assert.equal(metadata.cwd, replacementMetadata.cwd);
      if (change === 'old-binding') assert.equal(metadata.runtimeSessionId, 'replacement-binding');
      assert.equal(f.host.candidateRuntimeStarts.size, 0);
    });
  }
}

async function withRuntimeConnectionBoundary(run, connect = () => {}) {
  const connections = [];
  const creates = [];
  const methods = {
    async ensureConnected(options = {}) {
      const observation = { client: this, backend: this.options.backend, profile: this.options.executionProfile, options };
      connections.push(observation);
      await connect(observation);
    },
    supportsExecutionCandidateProfile(profile) { return profile === this.options.executionProfile; },
    supportsTerminalSessionStream() { return true; },
    supportsTerminalPagedRead() { return false; },
    async createSession(request) {
      creates.push({ client: this, request });
      return { sessionId: request.sessionId, kind: request.kind, runtimeBackend: this.options.backend.kind,
        live: true, lifecycle: request.kind === 'agent' ? 'running' : 'live' };
    }
  };
  const originals = new Map(Object.keys(methods).map(name => [name, RuntimeSupervisorClient.prototype[name]]));
  Object.assign(RuntimeSupervisorClient.prototype, methods);
  try { await run({ connections, creates }); }
  finally { for (const [name, original] of originals) RuntimeSupervisorClient.prototype[name] = original; }
}

for (const kind of ['terminal', 'agent']) {
  test(`B2 ${kind} actual Host routing selects isolated candidate with new-session startup permission`, async () => {
    const f = candidateRuntimeRoutingFixture();
    await withRuntimeConnectionBoundary(async ({ connections, creates }) => {
      await completed(f.clock, f.start(kind), `${kind} actual Host candidate route`);
      assert.equal(creates.length, 1, JSON.stringify({ posted: f.posted, errors: f.errors }));
      assert.equal(connections.length, 1);
      assert.equal(connections[0].profile, EXECUTION_CANDIDATE_PROFILE);
      assert.equal(connections[0].backend.paths.storageDir, path.join(f.candidateStoragePath, 'runtime-supervisor'));
      assert.equal(connections[0].options.allowRestart, true);
      assert.equal(creates[0].request.executionProfile, EXECUTION_CANDIDATE_PROFILE);
      assert.equal([...f.host.runtimeSessionBindings.values()][0].runtimeStoragePath, f.candidateStoragePath);
    });
  });
}

test('B2 actual bound Host routing preserves old raw and stream slots without candidate profile or startup permission', async () => {
  const f = candidateRuntimeRoutingFixture();
  const streamStoragePath = path.join(f.baseStoragePath, 'runtime-supervisor-generations', 'terminal-stream-v1');
  await withRuntimeConnectionBoundary(async ({ connections }) => {
    await f.host.getRuntimeSupervisorClientForKind('legacy-detached');
    await f.host.getRuntimeSupervisorClientForKind('legacy-detached', {}, streamStoragePath);
    assert.deepEqual(connections.map(value => value.backend.paths.storageDir),
      [f.baseStoragePath, streamStoragePath].map(value => path.join(value, 'runtime-supervisor')));
    assert.deepEqual(connections.map(value => value.profile), [undefined, undefined]);
    assert.deepEqual(connections.map(value => value.options.allowRestart), [false, false]);
  });
});

test('B2 candidate bound-first and new-first cache reuse retains profile and per-call startup permission', async () => {
  for (const first of ['bound', 'new']) {
    const f = candidateRuntimeRoutingFixture();
    await withRuntimeConnectionBoundary(async ({ connections }) => {
      const bound = () => f.host.getRuntimeSupervisorClientForKind('legacy-detached', { allowRestart: true }, f.candidateStoragePath);
      const prepare = async () => (await f.host.getPreferredRuntimeSupervisorClient(
        await f.host.resolveRuntimeCreationTarget(undefined), { allowRestart: true })).client;
      const a = await (first === 'bound' ? bound() : prepare());
      const b = await (first === 'bound' ? prepare() : bound());
      assert.strictEqual(a, b);
      assert.equal(f.host.runtimeSupervisorClients.size, 1);
      assert.deepEqual(connections.map(value => value.profile), [EXECUTION_CANDIDATE_PROFILE, EXECUTION_CANDIDATE_PROFILE]);
      assert.deepEqual(connections.map(value => value.options.allowRestart), first === 'bound' ? [false, true] : [true, false]);
    });
  }
});

test('B2 actual stock Host new route remains stream generation while candidate bindings retain their own profile', async () => {
  const f = candidateRuntimeRoutingFixture();
  f.host.executionCandidateProfile = undefined;
  f.host.nonNativeExecutionOwner = undefined;
  await withRuntimeConnectionBoundary(async ({ connections }) => {
    const current = await f.host.getPreferredRuntimeSupervisorClient(await f.host.resolveRuntimeCreationTarget(undefined));
    assert.equal(current.runtimeStoragePath,
      path.join(f.baseStoragePath, 'runtime-supervisor-generations', 'terminal-stream-v1'));
    assert.equal(connections[0].profile, undefined);
    await f.host.getRuntimeSupervisorClientForKind('legacy-detached', {}, f.candidateStoragePath);
    assert.equal(connections[1].profile, EXECUTION_CANDIDATE_PROFILE);
    assert.equal(connections[1].options.allowRestart, false);
  });
});

test('B2 actual cached backend fallback preserves candidate generation and profile', async () => {
  if (process.platform !== 'linux') return;
  const f = candidateRuntimeRoutingFixture();
  f.host.context.extensionMode = 1;
  f.host.preferredRuntimeHostBackendKind = 'systemd-user';
  await withRuntimeConnectionBoundary(async ({ connections }) => {
    const result = await f.host.getPreferredRuntimeSupervisorClient(
      await f.host.resolveRuntimeCreationTarget(undefined), { allowRestart: true });
    assert.equal(result.backend.kind, 'legacy-detached');
    assert.match(result.fallbackReason, /controlled systemd unavailable/);
    assert.ok(connections.some(value => value.backend.kind === 'systemd-user'));
    assert.ok(connections.some(value => value.backend.kind === 'legacy-detached'));
    for (const value of connections) {
      assert.equal(value.backend.paths.storageDir, path.join(f.candidateStoragePath, 'runtime-supervisor'));
      assert.equal(value.profile, EXECUTION_CANDIDATE_PROFILE);
      assert.equal(value.options.allowRestart, true);
    }
  }, value => { if (value.backend.kind === 'systemd-user') throw new Error('controlled systemd unavailable'); });
});

test('B2 strict deletion resolves missing legacy binding storage before actual backend selection', async () => {
  for (const candidate of [false, true]) {
    for (const candidateBinding of [false, true]) {
      const f = candidateRuntimeRoutingFixture();
      if (!candidate) { f.host.executionCandidateProfile = undefined; f.host.nonNativeExecutionOwner = undefined; }
      const selected = [];
      f.host.getRuntimeSupervisorClientForBackend = async (backend, options) => {
        selected.push({ backend, options });
        return { deleteSession: async () => {}, deleteSessionStrict: () => settledLegacyDelete('legacy-acknowledged') };
      };
      await f.host.deleteRuntimeSupervisorSessionStrict(
        { kind: 'terminal', backendKind: 'legacy-detached', sessionId: 'old-terminal',
          ...(candidateBinding ? { runtimeStoragePath: f.candidateStoragePath } : {}) }, { allowRestart: candidateBinding });
      assert.equal(selected.length, 1);
      assert.equal(selected[0].backend.paths.storageDir,
        path.join(candidateBinding ? f.candidateStoragePath : f.baseStoragePath, 'runtime-supervisor'));
      assert.equal(selected[0].options.allowRestart, false);
    }
  }
});

for (const kind of ['terminal', 'agent']) {
  for (const stop of [false, true]) {
    test(`snapshot ${kind} projects live ownership through output and ${stop ? 'pending stop' : 'natural exit'}`, async () => {
      const f = candidateFixture();
      f.host.persistState = async detail => { f.persisted.push(detail); };
      await completed(f.clock, f.start(kind), `${kind} live projection start`);
      const record = f.record(kind);
      const provider = f.providers[0];
      const metadata = () => f.host.state.nodes.find(node => node.id === `${kind}-1`).metadata[kind];
      const assertLive = () => {
        assert.equal(metadata().persistenceMode, 'snapshot-only');
        assert.equal(metadata().liveSession, true, 'An owned running subject must be live in the actual node metadata.');
        assert.equal(metadata().attachmentState, 'attached-live');
        assert.equal(metadata().runtimeSessionId, undefined, 'Current local ownership is not a Supervisor binding.');
      };
      let stopping;
      try {
        assertLive();
        provider.output(1, 'running output');
        await until(f.clock, () => record.execution.snapshot().adapter.consumedThrough === 1, `${kind} live output`);
        assertLive();
        if (stop) {
          stopping = f.host.stopExecutionSession(kind, `${kind}-1`);
          assert.equal(record.execution.snapshot().stopRequested, true);
          assert.equal(metadata().lifecycle, 'stopping');
          assertLive();
          provider.output(2, ' output while stopping');
          await until(f.clock, () => record.execution.snapshot().adapter.consumedThrough === 2, `${kind} stopping output`);
          assertLive();
        }
        provider.message({ type: 'processResult', result: { kind: 'exited', exitCode: 0 } });
        f.host.projectNonNativeHostBusiness(record);
        assert.equal(metadata().liveSession, false, 'A confirmed subject exit must not remain live while final output settles.');
        assert.equal(metadata().attachmentState, 'history-restored');
        provider.message({ type: 'resourceResult', resourceId: 'subject', operationId: 'subject-release',
          result: { kind: 'released' } });
        provider.seal(stop ? 2 : 1);
        provider.release();
        await until(f.clock, () => record.execution.snapshot().settled, `${kind} live projection finalization`);
        if (stopping) await completed(f.clock, stopping, `${kind} stop settled`);
        assert.equal((await record.persistence.promise).kind, 'saved');
        assert.equal(metadata().persistenceMode, 'snapshot-only');
        assert.equal(metadata().liveSession, false);
        assert.equal(metadata().outputSequence, stop ? 2 : 1);
        assert.equal(metadata().lastExitCode, 0);
        assert(metadata().serializedTerminalState?.data.includes('running output'));
        assert.equal(f.persisted.filter(detail => detail.reason === 'local-final-snapshot').length, 1);
      } finally {
        record.tracker.dispose();
        record.business?.cancelActivityPoll?.();
        record.business?.lineContextTracker.dispose();
      }
    });
  }

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

  test(`production ${kind} confirms predecessor cleanup then rejects missing Host output credit before preparing a launch`, async () => {
    for (const previousBinding of [false, true]) {
      const f = candidateRuntimeFixture({ admissionLimits: EXECUTION_PRODUCTION_ADMISSION });
      f.client.supportsTerminalHostOutputCredit = () => false;
      if (previousBinding) addCandidateLegacyBinding(f, kind);
      const before = structuredClone(f.host.state);
      const effects = [];
      const strict = candidateStrictDeletes(f, () => {
        effects.push('delete');
        return settledLegacyDelete('legacy-acknowledged');
      });
      f.host[kind === 'agent' ? 'buildAgentLaunchSpec' : 'buildTerminalLaunchSpec'] = () => {
        effects.push('prepare'); assert.fail('must reject before preparing the launch');
      };
      f.host.submitExecutionCandidateStart = () => { effects.push('submit'); assert.fail('must reject before submitting'); };
      await completed(f.clock, f.start(kind), `${kind} missing production credit`);
      assert(f.errors.some(message => /Host output consumption credit/.test(message)), f.errors.join('\n'));
      assert.deepEqual(effects, previousBinding ? ['delete'] : []);
      assert.equal(strict.calls.length, previousBinding ? 1 : 0);
      assert.equal(f.creates.length, 0);
      assert.equal(f.providers.length, 0);
      assert.equal(f.applies.length, 0);
      assert.equal(f.subscriptions.length, 0);
      assert.equal(f.persisted.length, 0);
      assert.deepEqual(f.host.state, before);
      assert.equal(f.host.runtimeSessionBindings.size, 0);
      assert.equal(f.host.candidateRuntimeStarts.size, 0);
    }
  });

  test(`production ${kind} admits new Runtime execution when Host output credit is supported`, async () => {
    const f = candidateRuntimeFixture({ admissionLimits: EXECUTION_PRODUCTION_ADMISSION });
    f.client.supportsTerminalHostOutputCredit = () => true;
    await completed(f.clock, f.start(kind), `${kind} production credit admission`);
    assert.deepEqual(f.errors, []);
    assert.equal(f.creates.length, 1);
    assert.equal(f.creates[0].executionProfile, EXECUTION_CANDIDATE_PROFILE);
    assert.equal(f.providers.length, 0);
    assert.equal(f.subscriptions.length, 1);
  });

  test(`S9 ${kind} old live attachment preserves original binding without new profile requirements`, async () => {
    for (const admissionLimits of [undefined, EXECUTION_PRODUCTION_ADMISSION]) {
      const f = candidateRuntimeFixture({ admissionLimits });
      const previous = addCandidateLegacyBinding(f, kind, 'systemd-user');
      f.client.supportsExecutionCandidateProfile = () => assert.fail('old attachment is not new admission');
      f.client.supportsTerminalHostOutputCredit = () => assert.fail('old attachment does not require production credit');
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
    }
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

async function interactiveHostFixture(kind = 'terminal', providerKind = 'codex', options = {}) {
  const f = candidateFixture(options);
  const persist = f.host.persistState.bind(f.host);
  f.host.persistState = async (...args) => { await persist(...args); };
  if (kind === 'agent') {
    f.host.state.nodes.find(node => node.kind === kind).metadata.agent = { provider: providerKind, ...options.agentMetadata };
    if (options.resumeContext) f.host.resolveAgentResumeContext = () => options.resumeContext;
    f.host.resolveAgentCli = async () => ({ command: '/controlled/agent', provider: providerKind });
  }
  await completed(f.clock, kind === 'agent'
    ? f.host.startAgentSession('agent-1', 113, 39, providerKind, options.resumeRequested ?? false)
    : f.host.startTerminalSession('terminal-1', 113, 39), `${kind} interactive owner start`);
  const record = f.record(kind);
  f.host.state.nodes.find(node => node.kind === kind).metadata[kind].cwd = '/controlled';
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

for (const kind of ['agent', 'terminal']) {
  test(`${kind} owned started diagnostic uses the confirmed execution identity and launch spec`, async () => {
    const f = await interactiveHostFixture(kind);
    try {
      const events = f.diagnostics.filter(entry => entry.name === 'execution/started');
      assert.equal(events.length, 1);
      const { spec, identity } = f.provider.messages.find(message => message.type === 'start');
      const detail = events[0].detail;
      assert.equal(detail.kind, kind);
      assert.equal(detail.nodeId, `${kind}-1`);
      assert.equal(detail.sessionId, identity.executionId);
      assert.equal(detail.sessionId, f.record.execution.identity.executionId);
      assert.equal(detail.shellPath, spec.file);
      assert.equal(detail.cwd, spec.cwd);
      assert.equal(detail.cols, spec.cols);
      assert.equal(detail.rows, spec.rows);
      assert.deepEqual(detail.launchArgs, spec.args);
      if (kind === 'agent') assert.equal(detail.provider, 'codex');
    } finally { await f.cleanup(); }
  });
}

test('owned preparation rejection does not emit a started diagnostic', async () => {
  const f = candidateFixture({ environment: async () => { throw new Error('start preparation rejected'); } });
  await assert.rejects(f.start('terminal'), /start preparation rejected/);
  assert.equal(f.providers.length, 0);
  assert.equal(f.diagnostics.some(entry => entry.name === 'execution/started'), false);
});

for (const kind of ['agent', 'terminal']) {
  test(`${kind} owned attention bridges split signals without blocking output and preserves final persistence`, async () => {
    const f = await interactiveHostFixture(kind);
    const delivery = deferred();
    const requests = [];
    const metadata = () => f.host.state.nodes.find(node => node.kind === kind).metadata[kind];
    f.host.attentionNotificationBridgeMode = 'system';
    f.host.postExecutionAttentionNotificationToCompanion = request => {
      requests.push(request);
      return delivery.promise;
    };
    let sequence = 0;
    const output = async text => {
      f.provider.output(++sequence, text);
      await until(f.clock, () => f.record.execution.snapshot().adapter.consumedThrough === sequence,
        'attention output consumed even while companion delivery is pending');
    };
    try {
      await output('\x1b]9;split');
      assert.equal(requests.length, 0);
      await output(' notification\x07');
      assert.equal(requests.length, 1);
      assert.match(requests[0].message, /split notification/);
      assert.equal(metadata().attentionPending, true);
      assert.strictEqual(f.record.persistence.metadata, metadata());
      f.host.acknowledgeExecutionAttentionForNode(f.record.nodeId);
      assert.equal(metadata().attentionPending, false);
      assert.strictEqual(f.record.persistence.metadata, metadata(), 'acknowledgement advances only its original binding');
      await output('\x1b]9;split notification\x07');
      assert.equal(requests.length, 1, 'same notification is suppressed by cooldown');
      assert.equal(metadata().attentionPending, false);
      f.host.enabledAttentionSignals = [];
      await output('\x07\x1b]777;notify;title;disabled\x07');
      assert.equal(requests.length, 1);
      f.host.enabledAttentionSignals = ['bel', 'osc9', 'osc777'];
      await output('\x1b]777;notify;title;enabled\x07');
      await output('\x07');
      assert.equal(requests.length, 3, 'OSC 777 and BEL both reach the shared bridge');
      assert.equal(f.record.mutationError, undefined);
      assert.strictEqual(f.record.persistence.metadata, metadata());
      delivery.resolve({ status: 'posted', backend: 'test', activationMode: 'test-replay' });
      await until(f.clock, () => f.diagnostics.filter(event =>
        event.name === 'execution/attentionNotificationCompanionPosted').length === 3, 'companion diagnostics');
      f.provider.process();
      f.provider.message({ type: 'resourceResult', resourceId: 'subject', operationId: 'subject-release', result: { kind: 'released' } });
      f.provider.seal(sequence); f.provider.release();
      const saved = await completed(f.clock, f.record.persistence.promise, 'attention final snapshot');
      assert.equal(saved.kind, 'saved', saved.reason);
    } finally {
      delivery.resolve({ status: 'posted', backend: 'test', activationMode: 'test-replay' });
      f.record.business.cancelActivityPoll?.();
      f.record.business.lineContextTracker.dispose();
      f.record.tracker.dispose();
    }
  });
}

for (const mode of ['none', 'workbench', 'system']) {
  test(`owned attention ${mode} preserves node attention and workbench fallback semantics`, async () => {
    const f = await interactiveHostFixture();
    let companionCalls = 0;
    let workbenchCalls = 0;
    f.host.attentionNotificationBridgeMode = mode;
    f.host.postExecutionAttentionNotificationToCompanion = async () => {
      companionCalls++;
      return { status: 'unsupported', backend: 'unsupported', activationMode: 'none' };
    };
    f.host.showExecutionAttentionNotification = async () => { workbenchCalls++; };
    try {
      f.provider.output(1, '\x1b]9;mode notification\x07');
      await until(f.clock, () => f.record.execution.snapshot().adapter.consumedThrough === 1, 'mode output');
      assert.equal(f.host.state.nodes.find(node => node.kind === 'terminal').metadata.terminal.attentionPending, true);
      assert.equal(companionCalls, mode === 'system' ? 1 : 0);
      assert.equal(workbenchCalls, mode === 'none' ? 0 : 1);
    } finally { await f.cleanup(); }
  });
}

for (const replacement of ['metadata', 'execution']) {
  test(`owned attention rejects stale ${replacement} without adopting an unrelated persistence binding`, async () => {
    const f = await interactiveHostFixture();
    const original = f.record.persistence.metadata;
    const node = f.host.state.nodes.find(node => node.kind === 'terminal');
    if (replacement === 'metadata') node.metadata.terminal = { ...original, attentionPending: false };
    else f.host.nonNativeHostExecutions.delete(f.record.execution.key);
    try {
      f.provider.output(1, '\x1b]9;stale notification\x07');
      await until(f.clock, () => f.record.execution.snapshot().adapter.consumedThrough === 1, 'stale output');
      assert.notEqual(node.metadata.terminal.attentionPending, true);
      assert.strictEqual(f.record.persistence.metadata, original);
      if (replacement === 'metadata') {
        f.host.setExecutionAttentionPending('terminal', node.id, true);
        assert.strictEqual(f.record.persistence.metadata, original, 'an unrelated metadata replacement remains a conflict');
        assert.match(f.record.mutationError, /metadata binding changed/);
      }
    } finally { await f.cleanup(); }
  });
}

test('held local output credit retains only the latest unstarted Host resize request', async () => {
  const messages = [];
  const f = await interactiveHostFixture('terminal', 'codex', {
    outputCredit: true, onHostMessage: message => messages.push(message)
  });
  const acknowledge = message => f.host.handleLocalExecutionOutputApplied('editor', {
    nodeId: 'terminal-1', kind: 'terminal', executionSessionId: f.record.execution.identity.executionId,
    ...message.payload.localOutputReceipt, outcome: 'applied'
  }, f.host.getSurfaceLifecycleIdentity('editor'), f.webviews.editor);
  try {
    await until(f.clock, () => messages.some(message => message.payload?.localOutputReceipt), 'initial credited snapshot');
    acknowledge(messages.find(message => message.payload?.localOutputReceipt));
    await until(f.clock, () => f.record.localReaders.get('editor').initialPublished, 'initial snapshot applied');
    f.provider.output(1, 'held-before-resize\r\n');
    await until(f.clock, () => messages.some(message => message.type === 'host/executionOutput'), 'held output receipt');
    let merged = 0;
    const changes = Array.from({ length: 24 }, (_, index) =>
      f.host.resizeNonNativeHostExecution(f.record, 120 + index, 40).then(() => { merged += 1; }));
    const allChanges = Promise.all(changes);
    void allChanges.catch(() => {});
    await pump(f.clock, () => merged === 23);
    assert.equal(merged, 23, 'superseded controls must settle without retaining a chain continuation each');
    assert.equal(f.requests.filter(request => request.type === 'resize').length, 0);
    acknowledge(messages.find(message => message.type === 'host/executionOutput'));
    await until(f.clock, () => f.requests.some(request => request.type === 'resize'), 'latest desired resize');
    const resize = f.requests.find(request => request.type === 'resize');
    assert.equal(resize.cols, 143);
    assert.equal(resize.rows, 40);
    let laterMerged = false;
    const laterSuperseded = f.host.resizeNonNativeHostExecution(f.record, 144, 41).then(() => { laterMerged = true; });
    const laterLatest = f.host.resizeNonNativeHostExecution(f.record, 145, 42);
    void laterLatest.catch(() => {});
    await until(f.clock, () => laterMerged, 'in-flight resize keeps one latest target');
    assert.equal(f.requests.filter(request => request.type === 'resize').length, 1);
    f.reply(resize, { kind: 'resized' });
    await until(f.clock, () => messages.filter(message => message.type === 'host/executionSnapshot').length === 2,
      'resized terminal snapshot');
    const resizingChain = f.record.terminalChain;
    f.provider.output(2, 'output-before-latest-resize\r\n');
    await until(f.clock, () => f.record.terminalChain !== resizingChain, 'accepted output queued before latest resize');
    acknowledge(messages.filter(message => message.type === 'host/executionSnapshot').at(-1));
    await completed(f.clock, allChanges, 'merged Host resize requests');
    await until(f.clock, () => messages.filter(message => message.type === 'host/executionOutput').length === 2,
      'accepted output is not overtaken by latest resize');
    assert.equal(f.requests.filter(request => request.type === 'resize').length, 1);
    acknowledge(messages.filter(message => message.type === 'host/executionOutput').at(-1));
    await until(f.clock, () => f.requests.filter(request => request.type === 'resize').length === 2, 'later latest native resize');
    const lastResize = f.requests.filter(request => request.type === 'resize').at(-1);
    assert.equal(lastResize.cols, 145);
    assert.equal(lastResize.rows, 42);
    assert.equal(f.record.cols, 143);
    assert.equal(f.record.rows, 40);
    f.reply(lastResize, { kind: 'resized' });
    await until(f.clock, () => messages.filter(message => message.type === 'host/executionSnapshot').length === 3,
      'later latest snapshot');
    acknowledge(messages.filter(message => message.type === 'host/executionSnapshot').at(-1));
    await completed(f.clock, Promise.all([laterSuperseded, laterLatest]), 'later native geometry confirmation');
    assert.equal(f.record.cols, 145);
    assert.equal(f.record.rows, 42);
    f.provider.output(3, 'hold-until-original-resize-deadline\r\n');
    await until(f.clock, () => messages.filter(message => message.type === 'host/executionOutput').length === 3, 'deadline output held');
    const expired = assert.rejects(f.host.resizeNonNativeHostExecution(f.record, 146, 43), /expired before execution/);
    f.clock.elapse(f.clock.now() + EXECUTION_INTERACTION_LIMITS.observationMs + 1);
    acknowledge(messages.filter(message => message.type === 'host/executionOutput').at(-1));
    await completed(f.clock, expired, 'original resize deadline still applies');
    assert.equal(f.requests.filter(request => request.type === 'resize').length, 2);
    assert.equal(f.record.mutationError, undefined, 'a nonexecuted expired control cannot claim an unknown native mutation');
  } finally {
    f.host.cancelLocalExecutionReaders('editor', 'cancelled', 'test-complete');
    await f.cleanup();
  }
});

function prepareInitialTerminalInput(f, text = 'controlled-install\n') {
  delete f.host.dropPendingTerminalInitialInput;
  delete f.host.clearPendingTerminalInitialInputs;
  f.host.pendingTerminalInitialInputs = new Map([['terminal-1', text]]);
  f.host.pendingTerminalInitialInputDispatches = new Map();
  return f.host.waitForPendingTerminalInitialInputDispatch('terminal-1', text);
}

async function disposeStartedCandidate(f, kind = 'terminal') {
  const record = f.record(kind);
  const provider = f.providers[0];
  if (!record || !provider) return;
  provider.process();
  provider.message({ type: 'resourceResult', resourceId: 'subject', operationId: 'subject-release', result: { kind: 'released' } });
  provider.seal(provider.messages.filter(message => message.type === 'consumed').at(-1)?.throughFrameId ?? 0);
  provider.release();
  await pump(f.clock, () => true);
  record.business?.cancelActivityPoll?.();
  record.business?.lineContextTracker.dispose();
  record.tracker.dispose();
}

for (const result of ['written', 'failed', 'unconfirmed']) {
  test(`owned Terminal initial install input settles only the actual ${result} write observation`, async () => {
    const f = candidateFixture();
    let dispatched = false;
    const dispatch = prepareInitialTerminalInput(f).then(value => { dispatched = true; return value; });
    const starting = f.start('terminal');
    try {
      await until(f.clock, () => f.providers[0]?.messages.some(message => message.type === 'input'), 'initial install write');
      assert.equal(dispatched, false, 'start acknowledgement is not an input write acknowledgement');
      assert.equal(f.host.terminalSessions.size, 0, 'owned input does not need a legacy process facade');
      const input = f.providers[0].messages.find(message => message.type === 'input');
      assert.equal(input.data, 'controlled-install\n');
      f.providers[0].message({ type: 'interactionObservation', interactionId: input.interactionId,
        result: result === 'written' ? { kind: result, writtenBytes: Buffer.byteLength(input.data) }
          : { kind: result, reason: 'controlled install write result', writtenBytes: 0 } });
      await completed(f.clock, starting, 'install Terminal start');
      const outcome = await dispatch;
      assert.equal(outcome.dispatched, result === 'written');
      assert.equal(Boolean(outcome.errorMessage), result !== 'written');
      await f.host.flushPendingTerminalInitialInput('terminal-1');
      assert.equal(f.providers[0].messages.filter(message => message.type === 'input').length, 1);
      assert.equal(f.host.pendingTerminalInitialInputDispatches.size, 0);
    } finally {
      f.host.clearPendingTerminalInitialInputs('controlled cleanup');
      await disposeStartedCandidate(f);
    }
  });
}

test('owned Terminal initial install input settles immediately when launch preparation fails', async () => {
  const f = candidateFixture({ environment: async () => { throw new Error('controlled install preparation failure'); } });
  const dispatch = prepareInitialTerminalInput(f);
  try {
    await assert.rejects(f.start('terminal'), /controlled install preparation failure/);
    assert.equal(f.host.pendingTerminalInitialInputDispatches.size, 0);
    const outcome = await dispatch;
    assert.equal(outcome.dispatched, false);
    assert.match(outcome.errorMessage, /controlled install preparation failure/);
    assert.equal(f.providers.length, 0);
  } finally { f.host.clearPendingTerminalInitialInputs('controlled cleanup'); }
});

test('owned Terminal initial install input cannot cross a replacement before start returns', async () => {
  const f = candidateFixture();
  const dispatch = prepareInitialTerminalInput(f);
  const startOwned = f.host.startNonNativeHostExecution.bind(f.host);
  let original;
  f.host.startNonNativeHostExecution = async (...args) => {
    const result = await startOwned(...args);
    original = f.record('terminal');
    f.host.nonNativeHostExecutions.set('terminal:terminal-1', { ...original });
    return result;
  };
  try {
    await completed(f.clock, f.start('terminal'), 'superseded install Terminal start');
    assert.equal((await dispatch).dispatched, false);
    assert.equal(f.providers[0].messages.filter(message => message.type === 'input').length, 0);
  } finally {
    if (original) f.host.nonNativeHostExecutions.set('terminal:terminal-1', original);
    f.host.clearPendingTerminalInitialInputs('controlled cleanup');
    await disposeStartedCandidate(f);
  }
});

async function withFileLinkBoundary(run) {
  const previousFs = testWorkspace.fs;
  const previousFile = testUri.file;
  const paths = [];
  testWorkspace.fs = { stat: async uri => {
    paths.push(uri.fsPath);
    if (!uri.fsPath.endsWith('/link-target.ts')) throw new Error('Missing controlled file');
    return { type: 1 };
  } };
  testUri.file = fsPath => ({ ...previousFile(fsPath), toString: () => `file://${fsPath}` });
  try { await run(paths); }
  finally { testWorkspace.fs = previousFs; testUri.file = previousFile; }
}

function initializeFileLinkCache(host) {
  host.executionFileLinkResolveCache = { entries: new Map(), inFlight: new Map(), lastBackgroundStartedAt: 0 };
  host.executionFileLinkResolveQueueByNode = new Map();
}

function multilineFileCandidate(bufferStartLine = 1) {
  return { candidateId: 'multiline:2:8', text: '2:8', path: 'link-target.ts',
    line: 2, column: 8, bufferStartLine, startIndex: 0, endIndexExclusive: 25, source: 'detected' };
}

async function deliverFileLinkOutput(f, sequence, text) {
  f.provider.output(sequence, text);
  await until(f.clock, () => f.record.execution.snapshot().adapter.consumedThrough === sequence, 'file link context output');
  await f.record.business.lineContextTracker.flush();
}

for (const kind of ['terminal', 'agent']) {
  test(`owned ${kind} file link context resolves original and changed directories through the real helper`, async () => {
    const f = await interactiveHostFixture(kind);
    initializeFileLinkCache(f.host);
    try {
      await deliverFileLinkOutput(f, 1, 'link-target.ts\r\n  2:8  original\r\n');
      if (kind === 'terminal') {
        const writing = f.host.writeExecutionInput(kind, `${kind}-1`, 'cd /controlled/subdir\r');
        await until(f.clock, () => f.requests.length === 1, 'file link context cd');
        f.reply(f.requests[0], { kind: 'written', writtenBytes: Buffer.byteLength(f.requests[0].data) });
        await completed(f.clock, writing, 'file link context cd acknowledgement');
      }
      await deliverFileLinkOutput(f, 2,
        (kind === 'agent' ? '\x1b]7;file:///controlled/subdir\x07' : '') + 'link-target.ts\r\n  2:8  changed\r\n');
      const context = f.host.getExecutionTerminalPathContext(kind, `${kind}-1`);
      await withFileLinkBoundary(async () => {
        for (const [bufferLine, expectedCwd] of [[1, '/controlled'], [3, '/controlled/subdir']]) {
          const result = await f.host.runExecutionFileLinkResolveForNode(kind, `${kind}-1`,
            [multilineFileCandidate(bufferLine)], context, 'interactive');
          assert.equal(result.resolvedCandidates[0]?.resolved.uri.fsPath, `${expectedCwd}/link-target.ts`);
          assert.deepEqual(result.resolvedCandidates[0].resolved.selection.start, { line: 1, character: 7 });
        }
      });
      const node = f.host.state.nodes.find(node => node.id === `${kind}-1`);
      node.metadata[kind].shellPath = 'C:\\stale-shell.exe'; node.metadata[kind].cwd = 'C:\\stale-cwd';
      const refreshed = f.host.getExecutionTerminalPathContext(kind, `${kind}-1`);
      assert.equal(refreshed.cwd, f.record.launchSpec.cwd);
      assert.equal(refreshed.shellPath, f.record.launchSpec.file);
    } finally { await f.cleanup(); }
  });

  test(`owned ${kind} file link context remains readable after stop`, async () => {
    const f = await interactiveHostFixture(kind);
    try {
      await deliverFileLinkOutput(f, 1, '\x1b]7;file:///controlled/subdir\x07link-target.ts\r\n  2:8  result\r\n');
      void f.host.stopExecutionSession(kind, `${kind}-1`).catch(() => {});
      assert.equal(f.record.execution.snapshot().stopRequested, true);
      const context = f.host.getExecutionTerminalPathContext(kind, `${kind}-1`);
      assert.equal(await context.resolveCwdForBufferLine?.(1), '/controlled/subdir');
    } finally { await f.cleanup(); }
  });

  test(`owned ${kind} file link context captures its tracker across an asynchronous replacement`, async () => {
    const f = await interactiveHostFixture(kind);
    const gate = deferred();
    try {
      await deliverFileLinkOutput(f, 1, '\x1b]7;file:///controlled/original\x07link-target.ts\r\n  2:8  result\r\n');
      const tracker = f.record.business.lineContextTracker;
      const originalLookup = tracker.getCwdForBufferLine.bind(tracker);
      let entered = false;
      tracker.getCwdForBufferLine = async line => { entered = true; await gate.promise; return originalLookup(line); };
      const context = f.host.getExecutionTerminalPathContext(kind, `${kind}-1`);
      const lookup = context.resolveCwdForBufferLine?.(1);
      assert.equal(entered, true);
      let replacementLookups = 0;
      f.host.nonNativeHostExecutions.set(`${kind}:${kind}-1`, { ...f.record,
        business: { ...f.record.business, lineContextTracker: {
          getCwdForBufferLine: async () => { replacementLookups++; return '/controlled/replacement'; }
        } }
      });
      gate.resolve();
      assert.equal(await lookup, '/controlled/original');
      assert.equal(replacementLookups, 0);
    } finally {
      gate.resolve(); f.host.nonNativeHostExecutions.set(`${kind}:${kind}-1`, f.record); await f.cleanup();
    }
  });
}

test('owned file link context does not reuse relative results across executions of the same node', async () => {
  const first = await interactiveHostFixture();
  const second = await interactiveHostFixture();
  initializeFileLinkCache(first.host);
  second.host.executionFileLinkResolveCache = first.host.executionFileLinkResolveCache;
  second.host.executionFileLinkResolveQueueByNode = first.host.executionFileLinkResolveQueueByNode;
  try {
    await withFileLinkBoundary(async () => {
      for (const [f, cwd] of [[first, '/controlled/first'], [second, '/controlled/second']]) {
        await deliverFileLinkOutput(f, 1, `\x1b]7;file://${cwd}\x07link-target.ts\r\n  2:8  result\r\n`);
        const context = f.host.getExecutionTerminalPathContext('terminal', 'terminal-1');
        const candidate = multilineFileCandidate();
        const resolved = await f.host.runExecutionFileLinkResolveForNode('terminal', 'terminal-1', [candidate], context, 'interactive');
        assert.equal(resolved.resolvedCandidates[0]?.resolved.uri.fsPath, `${cwd}/link-target.ts`);
        const cached = await f.host.runExecutionFileLinkResolveForNode('terminal', 'terminal-1', [candidate], context, 'interactive');
        assert.equal(cached.cacheHitCount, 1, 'same original execution still uses the cache');
        assert.equal(cached.resolvedCandidates[0]?.resolved.uri.fsPath, `${cwd}/link-target.ts`);
      }
    });
  } finally { await first.cleanup(); await second.cleanup(); }
});

test('legacy and history file link context retain their directory sources', async () => {
  const f = fixture();
  const tracker = f.host.createExecutionTerminalLineContextTracker(80, 24, '/bin/bash', '/legacy', 100);
  f.host.terminalSessions.set('terminal-1', {
    sessionId: 'legacy-session', shellPath: '/bin/bash', cwd: '/legacy', lineContextTracker: tracker, stopRequested: true
  });
  try {
    tracker.write('\x1b]7;file:///legacy/subdir\x07link-target.ts\r\n  2:8  result\r\n');
    const context = f.host.getExecutionTerminalPathContext('terminal', 'terminal-1');
    assert.equal(context.cwd, '/legacy');
    assert.equal(await context.resolveCwdForBufferLine(1), '/legacy/subdir');
    f.host.terminalSessions.clear();
    f.host.state.nodes[0].metadata.terminal = { shellPath: '/bin/zsh', cwd: '/history' };
    const history = f.host.getExecutionTerminalPathContext('terminal', 'terminal-1');
    assert.equal(history.shellPath, '/bin/zsh'); assert.equal(history.cwd, '/history');
    assert.equal(history.resolveCwdForBufferLine, undefined);
  } finally { tracker.dispose(); }
});

for (const kind of ['terminal', 'agent']) {
  test(`owned ${kind} resource drop uses original launch context and waits for written`, async () => {
    const f = await interactiveHostFixture(kind);
    const sessions = f.host.getExecutionSessions(kind);
    try {
      // Current configuration and stale legacy sessions must not choose the quoting rules.
      const node = f.host.state.nodes.find(node => node.id === `${kind}-1`);
      node.metadata[kind].shellPath = 'C:\\Windows\\pwsh.exe';
      node.metadata[kind].cwd = 'C:\\replacement';
      sessions.set(`${kind}-1`, { shellPath: 'C:\\Windows\\pwsh.exe', cwd: 'C:\\stale' });
      let resolved = false;
      const dropping = f.host.handleDroppedExecutionResource(kind, `${kind}-1`, {
        source: 'files', valueKind: 'path', value: "/controlled/it's a file.txt"
      }).then(() => { resolved = true; });
      await until(f.clock, () => f.requests.length === 1, `${kind} resource drop input`);
      assert.equal(resolved, false, 'preparation is not a write acknowledgement');
      assert.equal(f.requests[0].data, "'/controlled/it'\\''s a file.txt'");
      assert.deepEqual(f.requests[0].identity, f.record.execution.identity);
      f.reply(f.requests[0], { kind: 'written', writtenBytes: Buffer.byteLength(f.requests[0].data) });
      await completed(f.clock, dropping, `${kind} resource drop acknowledgement`);
      assert.equal(resolved, true);
      assert.equal(f.diagnostics.some(event => event.name === 'execution/dropResourceRejected'), false);
    } finally { sessions.delete(`${kind}-1`); await f.cleanup(); }
  });

  for (const change of ['stop', 'metadata', 'removed-node', 'suspended', 'quarantined', 'missing-launch']) {
    test(`owned ${kind} resource drop rejects ${change} before dispatch`, async () => {
      const f = await interactiveHostFixture(kind);
      try {
        if (change === 'stop') void f.host.stopExecutionSession(kind, `${kind}-1`).catch(() => {});
        if (change === 'metadata') {
          const node = f.host.state.nodes.find(node => node.id === `${kind}-1`);
          node.metadata = { ...node.metadata, [kind]: { ...node.metadata[kind] } };
        }
        if (change === 'removed-node') f.host.state.nodes = f.host.state.nodes.filter(node => node.id !== `${kind}-1`);
        if (change === 'suspended') f.record.business.lifecycleStatus = 'suspended';
        if (change === 'quarantined') f.record.mutationError = 'Controlled quarantine';
        if (change === 'missing-launch') f.record.launchSpec = undefined;
        await f.host.handleDroppedExecutionResource(kind, `${kind}-1`, {
          source: 'files', valueKind: 'path', value: '/controlled/drop target.txt'
        });
        assert.equal(f.requests.length, 0);
        assert.equal(f.diagnostics.some(event => event.name === 'execution/dropResourcePrepared'), false);
        assert.equal(f.diagnostics.some(event => event.name === 'execution/dropResourceRejected'), true);
      } finally { await f.cleanup(); }
    });
  }

  test(`owned ${kind} resource drop does not retarget or project after replacement during write`, async () => {
    const f = await interactiveHostFixture(kind);
    try {
      const dropping = f.host.handleDroppedExecutionResource(kind, `${kind}-1`, {
        source: 'files', valueKind: 'path', value: '/controlled/drop target.txt'
      });
      await until(f.clock, () => f.requests.length === 1, `${kind} resource drop input`);
      let replacementWrites = 0;
      f.host.nonNativeHostExecutions.set(`${kind}:${kind}-1`, {
        ...f.record, execution: { write: () => { replacementWrites++; throw new Error('Unexpected replacement input'); } }
      });
      let projections = 0;
      f.host.projectNonNativeHostBusiness = () => { projections++; };
      f.reply(f.requests[0], { kind: 'written', writtenBytes: Buffer.byteLength(f.requests[0].data) });
      await completed(f.clock, dropping, `${kind} old resource drop acknowledgement`);
      assert.equal(replacementWrites, 0);
      assert.equal(projections, 0);
      assert.equal(f.requests.length, 1);
    } finally {
      f.host.nonNativeHostExecutions.set(`${kind}:${kind}-1`, f.record);
      await f.cleanup();
    }
  });
}

test('legacy resource drop keeps session shell rules and missing-session diagnostics', async () => {
  const f = fixture();
  const writes = [];
  f.host.writeExecutionInput = async (...args) => { writes.push(args); return true; };
  const resource = { source: 'files', valueKind: 'path', value: "C:\\drop target's file.txt" };
  await f.host.handleDroppedExecutionResource('terminal', 'terminal-1', resource);
  assert.equal(writes.length, 0);
  assert.equal(f.diagnostics.at(-1).detail.reason, 'missing-session');
  f.host.terminalSessions.set('terminal-1', { shellPath: 'C:\\Windows\\pwsh.exe', cwd: 'C:\\repo' });
  await f.host.handleDroppedExecutionResource('terminal', 'terminal-1', resource);
  assert.deepEqual(writes, [['terminal', 'terminal-1', "'C:\\drop target''s file.txt'"]]);
});

for (const kind of ['terminal', 'agent']) {
  test(`owned ${kind} text paste reaches the existing actual input acknowledgement`, async () => {
    const f = await interactiveHostFixture(kind);
    const previous = testEnvironment.clipboard;
    const messages = [];
    testEnvironment.clipboard = { readText: async () => 'controlled clipboard text' };
    f.host.postMessageToSurface = (_surface, message) => messages.push(message);
    try {
      await f.host.handleExecutionPasteRequest('editor', kind, `${kind}-1`, 'controlled-paste', true);
      const paste = messages.find(message => message.type === 'host/executionPasteText');
      assert.equal(paste?.payload.text, 'controlled clipboard text');
      assert.equal(paste.payload.requestId, 'controlled-paste');
      // This is the Host boundary; the actual Webview's terminal.paste route is separately accepted.
      let resolved = false;
      const writing = f.host.writeExecutionInput(kind, `${kind}-1`, paste.payload.text).then(value => { resolved = true; return value; });
      await until(f.clock, () => f.requests.length === 1, `${kind} pasted input`);
      assert.equal(resolved, false);
      f.reply(f.requests[0], { kind: 'written', writtenBytes: Buffer.byteLength(paste.payload.text) });
      assert.equal(await completed(f.clock, writing, `${kind} pasted write acknowledgement`), true);
    } finally { testEnvironment.clipboard = previous; await f.cleanup(); }
  });
}

test('owned paste captures the original execution across clipboard and confirmation waits', async () => {
  for (const change of ['clipboard-replacement', 'clipboard-metadata', 'confirmation-stop', 'confirmation-cancel']) {
    const f = await interactiveHostFixture();
    const previousClipboard = testEnvironment.clipboard;
    const previousWarning = testWindow.showWarningMessage;
    const clipboard = deferred();
    const confirmation = deferred();
    const messages = [];
    let confirming = false;
    testEnvironment.clipboard = { readText: () => clipboard.promise };
    testWindow.showWarningMessage = () => { confirming = true; return confirmation.promise; };
    f.host.postMessageToSurface = (_surface, message) => messages.push(message);
    try {
      const pasting = f.host.handleExecutionPasteRequest('editor', 'terminal', 'terminal-1', 'controlled-paste', false);
      if (change === 'clipboard-replacement') {
        f.host.nonNativeHostExecutions.set('terminal:terminal-1', { ...f.record });
      } else if (change === 'clipboard-metadata') {
        const node = f.host.state.nodes.find(node => node.id === 'terminal-1');
        node.metadata = { ...node.metadata, terminal: { ...node.metadata.terminal, cwd: '/replacement' } };
      }
      clipboard.resolve(change.startsWith('confirmation') ? 'first\nsecond' : 'single-line');
      if (change.startsWith('confirmation')) {
        await until(f.clock, () => confirming, 'multiline paste confirmation');
        if (change === 'confirmation-stop') {
          void f.host.stopExecutionSession('terminal', 'terminal-1').catch(() => {});
          assert.equal(f.record.execution.snapshot().stopRequested, true);
        }
        confirmation.resolve(change === 'confirmation-cancel' ? undefined : 'Continue Paste');
      }
      await pasting;
      assert.equal(messages.some(message => message.type === 'host/executionPasteText'), false, change);
      assert.equal(messages.some(message => message.type === 'host/executionPasteCancelled'), true, change);
      assert.equal(f.requests.length, 0);
    } finally {
      f.host.nonNativeHostExecutions.set('terminal:terminal-1', f.record);
      testEnvironment.clipboard = previousClipboard;
      testWindow.showWarningMessage = previousWarning;
      await f.cleanup();
    }
  }
});

test('paste retains legacy session identity and Terminal screenshot rejection', async () => {
  const f = fixture();
  const previous = testEnvironment.clipboard;
  const gate = deferred();
  const messages = [];
  f.host.postMessageToSurface = (_surface, message) => messages.push(message);
  testEnvironment.clipboard = { readText: () => gate.promise };
  const session = { owner: 'local', stopRequested: false };
  f.host.terminalSessions.set('terminal-1', session);
  try {
    const pasting = f.host.handleExecutionPasteRequest('editor', 'terminal', 'terminal-1', 'legacy-paste', true);
    f.host.terminalSessions.set('terminal-1', { ...session });
    gate.resolve('old-session text');
    await pasting;
    assert.equal(messages.some(message => message.type === 'host/executionPasteText'), false);
    messages.length = 0;
    await f.host.handleExecutionPasteRequest('editor', 'terminal', 'terminal-1', 'current-paste', true);
    assert.equal(messages.find(message => message.type === 'host/executionPasteText')?.payload.text, 'old-session text');
    messages.length = 0;
    await f.host.handleExecutionImagePasteRequest('editor', 'terminal', 'terminal-1', 'terminal-image', 'image/png', '', 0);
    assert.equal(messages.some(message => message.type === 'host/executionPasteCancelled'), true);
    assert.equal(messages.some(message => message.type === 'host/executionPasteText'), false);
  } finally { testEnvironment.clipboard = previous; }
});

test('owned Agent screenshot paste preserves validation, provider and original execution identity', async () => {
  const f = await interactiveHostFixture('agent', 'claude');
  const messages = [];
  const files = [];
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  f.host.postMessageToSurface = (_surface, message) => messages.push(message);
  f.host.writeExecutionImagePasteFile = (nodeId, mimeType, image) => {
    files.push({ nodeId, mimeType, image });
    return '/controlled/image with spaces.png';
  };
  try {
    await f.host.handleExecutionImagePasteRequest('editor', 'agent', 'agent-1', 'image-paste', 'image/png', png.toString('base64'), png.length);
    const paste = messages.find(message => message.type === 'host/executionPasteText');
    assert.match(paste?.payload.text ?? '', /image with spaces\.png/);
    assert.equal(files.length, 1);
    assert.deepEqual(files[0].image, png);
    assert.equal(f.diagnostics.find(item => item.name === 'execution/imagePastePrepared')?.detail.provider, 'claude');
    const writing = f.host.writeExecutionInput('agent', 'agent-1', paste.payload.text);
    await until(f.clock, () => f.requests.length === 1, 'Agent pasted image path');
    f.reply(f.requests[0], { kind: 'written', writtenBytes: Buffer.byteLength(paste.payload.text) });
    assert.equal(await completed(f.clock, writing, 'Agent image path acknowledgement'), true);
    messages.length = 0;
    await f.host.handleExecutionImagePasteRequest('editor', 'agent', 'agent-1', 'invalid-image', 'image/png', 'aW52YWxpZA==', 7);
    assert.equal(files.length, 1);
    assert.equal(messages.some(message => message.type === 'host/executionPasteText'), false);
    f.host.writeExecutionImagePasteFile = () => {
      f.host.nonNativeHostExecutions.set('agent:agent-1', { ...f.record });
      return '/controlled/old-image.png';
    };
    messages.length = 0;
    await f.host.handleExecutionImagePasteRequest('editor', 'agent', 'agent-1', 'superseded-image', 'image/png', png.toString('base64'), png.length);
    assert.equal(messages.some(message => message.type === 'host/executionPasteText'), false);
    assert.equal(messages.some(message => message.type === 'host/executionPasteCancelled'), true);
  } finally {
    f.host.nonNativeHostExecutions.set('agent:agent-1', f.record);
    await f.cleanup();
  }
});

test('test-mode Codex resume context uses fake storage only for an actual fake command', () => {
  const f = fixture();
  delete f.host.resolveAgentResumeContext;
  f.host.getAgentRuntimeStorageRoot = () => '/controlled/agent-runtime';
  f.host.ensureRuntimeDirectory = value => value;
  const metadata = { provider: 'codex', resumeSessionId: 'original-session', resumeStoragePath: '/controlled/original' };
  assert.deepEqual(f.host.resolveAgentResumeContext('agent-1', 'codex', 'start', '/installed/codex', metadata),
    { supported: false, strategy: 'none' });
  assert.deepEqual(f.host.resolveAgentResumeContext('agent-1', 'codex', 'resume', '/installed/codex', metadata),
    { supported: true, strategy: 'codex-session-id', sessionId: 'original-session' });
  const fakeStart = f.host.resolveAgentResumeContext('agent-1', 'codex', 'start', '/controlled/fake-codex-provider', metadata);
  assert.equal(fakeStart.strategy, 'fake-provider');
  assert.equal(fakeStart.storagePath, '/controlled/agent-runtime/agent-1');
  assert.notEqual(fakeStart.sessionId, metadata.resumeSessionId);
  assert.deepEqual(f.host.resolveAgentResumeContext('agent-1', 'codex', 'resume', '/controlled/fake-codex-provider', metadata),
    { supported: true, strategy: 'fake-provider', sessionId: 'original-session', storagePath: '/controlled/original' });
  assert.deepEqual(f.host.resolveAgentResumeContext('agent-1', 'claude', 'resume', '/installed/claude',
    { provider: 'claude', resumeSessionId: 'original-claude' }),
  { supported: true, strategy: 'claude-session-id', sessionId: 'original-claude' });
});

test('actual Agent start selects resume context from its parsed configured command', async () => {
  for (const [command, strategy] of [['/installed/codex', 'none'], ['/controlled/fake-codex-provider', 'fake-provider']]) {
    const f = candidateFixture();
    delete f.host.resolveAgentResumeContext;
    f.host.getAgentRuntimeStorageRoot = () => '/controlled/agent-runtime';
    f.host.ensureRuntimeDirectory = value => value;
    f.host.resolveAgentFreshLaunch = () => ({ commandLine: command, requestedCommand: command, launchArgs: [], launchPreset: 'custom' });
    f.host.getRequestedAgentCliSpec = CanvasPanelManager.prototype.getRequestedAgentCliSpec;
    f.host.resolveAgentCli = async () => ({ command, requestedCommand: command, provider: 'codex' });
    try {
      await completed(f.clock, f.start('agent'), `${strategy} Agent resume context through real start`);
      assert.equal(f.record('agent').business.agentResume.strategy, strategy);
      const metadata = f.host.state.nodes.find(node => node.id === 'agent-1').metadata.agent;
      assert.equal(metadata.resumeStrategy, strategy);
      assert.equal(Boolean(metadata.resumeStoragePath), strategy === 'fake-provider');
    } finally { await disposeStartedCandidate(f, 'agent'); }
  }
});

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


function configureCanvasRecomposition(f) {
  delete f.host.dropPendingTerminalInitialInput;
  Object.assign(f.host, {
    lastComposedWorkspaceRootPaths: f.host.getMultiRootWorkspaceFoldersForComposition().map(folder => folder.path),
    getLiveRuntimeReconnectBlockReason: () => undefined,
    reconcileCanvasFileArtifacts: state => state,
    invalidateResolvedShellEnvironmentPatch() {}, clearAgentCliResolutionCache() {},
    resolvePreferredCanvasCenter: () => undefined,
    resolveWorkspaceRootGroupForAddedFolder: () => undefined,
    reconcileDefaultExecutionMetadataCwd() {}, refreshConfiguredTerminalShellMetadata() {},
    refreshStorageRecoverySelection() {}, loadStoredCanvasFileFilterState: () => f.host.fileFilterState,
    readCanvasTemplateInitializedFlag: () => true, loadStoredSurface: () => 'editor',
    applyWorkbenchContextKeys() {}, isInteractiveSurface: () => false,
    scheduleRestoreLiveRuntimeSessions() {}, getDebugSnapshot: () => ({ state: f.host.state })
  });
}

for (const kind of ['agent', 'terminal']) {
  test(`canvas reconciliation keeps ${kind} identity through reload, root round trip and final disk save`, async () => {
    const f = await persistenceFixture({ candidate: true });
    configureCanvasRecomposition(f);
    let record;
    try {
      await completed(f.clock, f.start(kind), 'original local start');
      record = f.record(kind);
      const identity = record.execution.identity;
      const originalKey = record.execution.key;
      const provider = f.providers[0];
      const originalMetadata = record.persistence.metadata;
      f.host.loadState = () => structuredClone(f.host.state);
      await f.host.reloadPersistedStateForTest();
      assert.strictEqual(f.host.state.nodes.find(node => node.kind === kind).metadata[kind], originalMetadata);
      assert.equal(f.host.state.nodes.find(node => node.kind === kind).metadata[kind].liveSession, true);
      const localState = structuredClone(f.host.state);
      let folders = [{ path: f.root, name: 'original' }, { path: path.join(f.directory, 'other'), name: 'other' }];
      f.host.getMultiRootWorkspaceFoldersForComposition = () => folders;
      f.host.loadState = () => composeMultiRootCanvasState({ workspaceFolders: folders,
        rootStates: [{ rootPath: f.root, state: localState }] });
      await completed(f.clock, f.host.reconcileWorkspaceFolders(), 'add workspace root');
      const newId = namespaceCanvasObjectId(f.root, `${kind}-1`);
      assert.equal(record.nodeId, newId);
      assert.strictEqual(record.execution.identity, identity);
      assert.strictEqual(f.owner.get(`${kind}:${newId}`), record.execution);
      assert.equal(f.owner.get(originalKey), undefined);
      assert.strictEqual(f.host.state.nodes.find(node => node.id === newId).metadata[kind], originalMetadata);
      provider.output(1, 'tail-after-remap\r\n');
      await until(f.clock, () => record.execution.snapshot().adapter.consumedThrough === 1, 'remapped output');
      assert.equal(record.mutationError, undefined);
      const resizing = f.host.resizeNonNativeHostExecution(record, 91, 31);
      await until(f.clock, () => provider.messages.some(message => message.type === 'resize'), 'resize after remap');
      const request = provider.messages.find(message => message.type === 'resize');
      // Move the route again while the native resize reply is in flight.
      const decomposed = decomposeMultiRootCanvasState({ composedState: f.host.state, workspaceFolders: folders, previousRootStates: [] });
      folders = [folders[0]];
      f.host.loadState = () => decomposed.rootStates.find(root => root.rootPath === f.root).state;
      await completed(f.clock, f.host.reconcileWorkspaceFolders(), 'remove unrelated root');
      provider.message({ type: 'interactionObservation', interactionId: request.interactionId, result: { kind: 'resized' } });
      await completed(f.clock, resizing, 'same resize commits on returned route');
      assert.equal(record.nodeId, `${kind}-1`);
      assert.equal(record.mutationError, undefined);
      assert.strictEqual(f.owner.get(originalKey), record.execution);
      assert.equal(f.providers.length, 1, 'no replacement provider during root changes');
      // No page reader is required for this persistence-only fixture.
      for (const reader of record.localReaders.values()) f.host.settleLocalExecutionReader(record, reader, { kind: 'cancelled', reason: 'test-end' });
      provider.process(); provider.seal(1);
      provider.message({ type: 'resourceResult', resourceId: 'subject', operationId: 'subject-release', result: { kind: 'released' } });
      provider.release();
      assert.equal((await completed(f.clock, record.persistence.promise, 'final save after remap')).kind, 'saved');
      await until(f.clock, () => f.host.nonNativeHostExecutions.size === 0, 'retired remapped record');
      assert.match((await f.read(f.rootFile)).state.nodes.find(node => node.kind === kind).metadata[kind].serializedTerminalState.data, /tail-after-remap/);
    } finally { record?.business?.cancelActivityPoll?.(); record?.business?.lineContextTracker.dispose(); record?.tracker.dispose(); await f.cleanup(); }
  });

  test(`canvas reconciliation rejects replacement of the original ${kind} without changing its route`, async () => {
    const f = candidateFixture();
    let record;
    try {
      await completed(f.clock, f.start(kind), 'original protected local start');
      record = f.record(kind);
      const oldState = f.host.state;
      assert.throws(() => f.host.reconcileOwnedCanvasState({ ...oldState, nodes: oldState.nodes.filter(node => node.kind !== kind) }), /Stop the original execution/);
      assert.strictEqual(f.host.state, oldState);
      assert.strictEqual(f.owner.get(record.execution.key), record.execution);
      f.host.state = { ...oldState, nodes: oldState.nodes.map(node => node.kind === kind
        ? { ...node, metadata: { ...node.metadata, [kind]: { ...node.metadata[kind] } } } : node) };
      assert.throws(() => f.host.reconcileOwnedCanvasState(structuredClone(f.host.state)), /original execution binding changed/);
      assert.strictEqual(f.owner.get(record.execution.key), record.execution);
    } finally { record?.business?.cancelActivityPoll?.(); record?.business?.lineContextTracker.dispose(); record?.tracker.dispose(); }
  });

  test(`workspace removal waits for ${kind} final save before replacing canvas and saves the removed root`, async () => {
    const f = await persistenceFixture({ candidate: true });
    configureCanvasRecomposition(f);
    let record;
    const save = deferred();
    try {
      f.host.lastComposedWorkspaceRootPaths = [f.root];
      await completed(f.clock, f.start(kind), 'removed root original start');
      record = f.record(kind);
      const provider = f.providers[0];
      const oldState = f.host.state;
      const persist = f.host.persistState.bind(f.host);
      f.host.persistState = async options => {
        if (options.reason === 'local-final-snapshot') await save.promise;
        return persist(options);
      };
      f.host.getMultiRootWorkspaceFoldersForComposition = () => [];
      f.host.loadState = () => ({ ...oldState, nodes: [] });
      let finished = false;
      const replacing = f.host.reconcileWorkspaceFolders().then(() => { finished = true; });
      provider.output(1, 'removed-root-final-tail\r\n');
      await until(f.clock, () => record.execution.snapshot().adapter.consumedThrough === 1, 'removed root tail');
      provider.process(); provider.seal(1);
      provider.message({ type: 'resourceResult', resourceId: 'subject', operationId: 'subject-release', result: { kind: 'released' } });
      provider.release();
      await until(f.clock, () => record.persistence.submitted, 'removed root save submission');
      assert.equal(finished, false);
      assert.equal(f.host.workspaceRecompositionPending, true);
      assert.equal(f.host.state.nodes.some(node => node.id === record.nodeId), true);
      await assert.rejects(f.start(kind), /admission is closed/);
      save.resolve();
      await completed(f.clock, replacing, 'removed root saved then recomposed');
      assert.equal(f.host.state.nodes.length, 0);
      assert.equal(f.host.nonNativeHostExecutions.size, 0);
      assert.match((await f.read(f.rootFile)).state.nodes.find(node => node.kind === kind).metadata[kind].serializedTerminalState.data, /removed-root-final-tail/);
    } finally { save.resolve(); record?.business?.cancelActivityPoll?.(); record?.business?.lineContextTracker.dispose(); record?.tracker.dispose(); await f.cleanup(); }
  });
}


test('execution route migration validates all original reservations before changing any key', async () => {
  const f = fixture();
  const one = f.owner.reserve('one');
  const two = f.owner.reserve('two');
  const identity = one.identity;
  assert.throws(() => f.owner.rekey([{ execution: one, key: 'two' }]), /original reservations/);
  assert.strictEqual(f.owner.get('one'), one);
  assert.strictEqual(f.owner.get('two'), two);
  const foreign = fixture().owner.reserve('foreign');
  assert.throws(() => f.owner.rekey([{ execution: one, key: 'new' }, { execution: foreign, key: 'other' }]), /original reservations/);
  assert.strictEqual(f.owner.get('one'), one);
  f.owner.rekey([{ execution: one, key: 'two' }, { execution: two, key: 'one' }]);
  assert.strictEqual(one.identity, identity);
  assert.strictEqual(f.owner.get('two'), one);
  assert.strictEqual(f.owner.get('one'), two);
  one.abandon('test-end'); two.abandon('test-end'); foreign.abandon('test-end');
});

for (const outcome of ['failed', 'deadline']) {
  test(`workspace removal retains original canvas and save responsibility after ${outcome}`, async () => {
    const f = await persistenceFixture({ candidate: true });
    configureCanvasRecomposition(f);
    const save = deferred();
    let record;
    try {
      await completed(f.clock, f.start('terminal'), 'original terminal before failed removal');
      record = f.record('terminal');
      const beforeDisk = await f.read(f.rootFile);
      const provider = f.providers[0];
      const persist = f.host.persistState.bind(f.host);
      f.host.persistState = async options => {
        if (options.reason === 'local-final-snapshot') {
          await save.promise;
          if (outcome === 'failed') throw new Error('controlled removed-root save failure');
        }
        return persist(options);
      };
      f.host.getMultiRootWorkspaceFoldersForComposition = () => [];
      f.host.loadState = () => assert.fail('Failed original save must not replace the canvas');
      const rejection = assert.rejects(f.host.reconcileWorkspaceFolders(), outcome === 'failed'
        ? /Local final snapshot persistence is failed/ : /did not complete within the boundary/);
      provider.process(); provider.seal(0);
      provider.message({ type: 'resourceResult', resourceId: 'subject', operationId: 'subject-release', result: { kind: 'released' } });
      provider.release();
      await until(f.clock, () => record.persistence.submitted, 'removed-root original final submission');
      if (outcome === 'failed') save.resolve();
      else f.clock.advance(EXECUTION_CANDIDATE_BUDGETS.boundaryMs + 1);
      await completed(f.clock, rejection, 'removed root failure reported');
      assert.strictEqual(f.host.nonNativeHostExecutions.get(record.execution.key), record);
      assert.equal(f.host.workspaceRecompositionPending, true);
      assert.ok(f.host.state.nodes.some(node => node.id === record.nodeId));
      assert.deepEqual(await f.read(f.rootFile), beforeDisk);
      if (outcome === 'deadline') {
        save.resolve();
        assert.equal((await completed(f.clock, record.persistence.promise, 'late original save')).kind, 'saved');
        assert.ok(f.host.state.nodes.some(node => node.id === record.nodeId), 'Late save cannot resume a rejected recomposition');
      }
    } finally { save.resolve(); record?.business?.cancelActivityPoll?.(); record?.business?.lineContextTracker.dispose(); record?.tracker.dispose(); await f.cleanup(); }
  });
}

test('simulated reload checks creation boundary before stopping an existing execution', async () => {
  const f = simulatedReloadFixture();
  let record;
  try {
    await completed(f.clock, f.start('terminal'), 'original before rejected reload');
    record = f.record('terminal');
    f.host.candidateRuntimeStarts = new Map([['pending', {}]]);
    await assert.rejects(f.host.simulateRuntimeReloadForTest(), /Runtime creation is still pending/);
    assert.equal(record.execution.snapshot().stopRequested, false);
    assert.equal(f.owner.snapshot().closing, false);
    assert.equal(f.providers[0].messages.some(message => message.type === 'requestStop'), false);
  } finally { record?.business?.lineContextTracker.dispose(); record?.tracker.dispose(); }
});

for (const deadline of [false, true]) {
  test(`single simulated reload waits for original final save within the existing boundary (deadline=${deadline})`, async () => {
    const f = simulatedReloadFixture();
    const save = deferred();
    let writes = 0;
    let record;
    try {
      await completed(f.clock, f.start('terminal'), 'original before saving reload');
      record = f.record('terminal');
      f.host.persistState = async options => {
        if (options?.reason === 'local-final-snapshot') { writes++; await save.promise; }
      };
      let finished = false;
      const reload = f.host.simulateRuntimeReloadForTest().then(() => { finished = true; });
      const result = deadline ? assert.rejects(reload, /boundary is unconfirmed|boundary expired/) : reload;
      await until(f.clock, () => record.execution.snapshot().stopRequested, 'reload requests original stop');
      const provider = f.providers[0];
      provider.process(); provider.seal(0);
      provider.message({ type: 'resourceResult', resourceId: 'subject', operationId: 'subject-release', result: { kind: 'released' } });
      provider.release();
      await until(f.clock, () => record.persistence.submitted, 'reload original save submitted');
      assert.equal(finished, false);
      assert.equal(f.owner.snapshot().closing, true);
      if (deadline) f.clock.advance(EXECUTION_CANDIDATE_BUDGETS.boundaryMs + 1);
      else save.resolve();
      await completed(f.clock, result, 'bounded reload result');
      save.resolve();
      assert.equal((await completed(f.clock, record.persistence.promise, 'original save result')).kind, 'saved');
      await pump(f.clock);
      assert.equal(writes, 1);
      assert.equal(finished, !deadline);
      assert.equal(f.owner.snapshot().closing, deadline, 'late save must not reopen a rejected reload');
    } finally { save.resolve(); record?.business?.lineContextTracker.dispose(); record?.tracker.dispose(); }
  });
}

for (const retained of [true, false]) {
  test(`workspace recomposition preserves only already reserved preparations in retained roots (${retained})`, async () => {
    const f = candidateFixture({ roots: [{ path: '/controlled/root', name: 'root' }] });
    const gate = deferred();
    const started = f.host.startNonNativeHostExecution('terminal', 'terminal-1', 80, 24, () => gate.promise);
    const result = retained ? started : assert.rejects(started, /admission is closed/);
    const record = f.record('terminal');
    try {
      assert.equal(record.canvasRootPath, '/controlled/root');
      f.host.workspaceRecompositionPending = true;
      f.host.getMultiRootWorkspaceFoldersForComposition = () => retained ? [{ path: '/controlled/root', name: 'root' }] : [];
      await assert.rejects(f.start('agent'), /admission is closed/);
      gate.resolve({ file: '/controlled/shell', args: [], cwd: '/controlled/root', env: {} });
      await completed(f.clock, result, 'original reservation finishes preparation');
      assert.equal(f.providers.length, retained ? 1 : 0);
      if (retained) assert.strictEqual(f.record('terminal'), record);
    } finally { gate.resolve({ file: '/controlled/shell' }); record?.business?.lineContextTracker.dispose(); record?.tracker.dispose(); }
  });
}

for (const closeDuringSave of [false, true]) {
  test(`workspace recomposition cannot replace state after permanent Host closure (during-save=${closeDuringSave})`, async () => {
    const f = await persistenceFixture({ candidate: true });
    configureCanvasRecomposition(f);
    const save = deferred();
    let record;
    try {
      await completed(f.clock, f.start('terminal'), 'original before permanent boundary');
      record = f.record('terminal');
      f.host.getMultiRootWorkspaceFoldersForComposition = () => [];
      f.host.loadState = () => assert.fail('Permanently closed Host must not recompose its state');
      f.host.persistState = async options => { if (options?.reason === 'local-final-snapshot') await save.promise; };
      if (!closeDuringSave) f.host.closeRuntimeSupervisorEventAdmission();
      const rejection = assert.rejects(f.host.reconcileWorkspaceFolders(), /permanent boundary/);
      if (closeDuringSave) {
        const provider = f.providers[0];
        provider.process(); provider.seal(0);
        provider.message({ type: 'resourceResult', resourceId: 'subject', operationId: 'subject-release', result: { kind: 'released' } });
        provider.release();
        await until(f.clock, () => record.persistence.submitted, 'save before permanent closure');
        f.host.closeRuntimeSupervisorEventAdmission();
        save.resolve();
      } else assert.equal(record.execution.snapshot().stopRequested, false);
      await completed(f.clock, rejection, 'permanent closure rejects recomposition');
      assert.ok(f.host.state.nodes.some(node => node.id === record.nodeId));
    } finally { save.resolve(); await f.cleanup(); }
  });
}

for (const failPreparation of [false, true]) {
  test(`workspace remap keeps pending preparation on its original identity and clears rejected input (${failPreparation})`, async () => {
    const f = await persistenceFixture({ candidate: true });
    configureCanvasRecomposition(f);
    const gate = deferred();
    const started = f.host.startNonNativeHostExecution('terminal', 'terminal-1', 80, 24, async () => {
      const spec = await gate.promise;
      if (failPreparation) throw new Error('controlled preparation failure');
      return spec;
    });
    const result = failPreparation ? assert.rejects(started, /controlled preparation failure/) : started;
    const record = f.record('terminal');
    try {
      const identity = record.execution.identity;
      f.host.pendingTerminalInitialInputs.set('terminal-1', 'original-initial-input');
      const localState = structuredClone(f.host.state);
      const folders = [{ path: f.root, name: 'original' }, { path: path.join(f.directory, 'other'), name: 'other' }];
      f.host.getMultiRootWorkspaceFoldersForComposition = () => folders;
      f.host.loadState = () => composeMultiRootCanvasState({ workspaceFolders: folders,
        rootStates: [{ rootPath: f.root, state: localState }] });
      await completed(f.clock, f.host.reconcileWorkspaceFolders(), 'root added during preparation');
      const mapped = namespaceCanvasObjectId(f.root, 'terminal-1');
      assert.equal(record.nodeId, mapped);
      assert.strictEqual(record.execution.identity, identity);
      assert.equal(f.host.pendingTerminalInitialInputs.has('terminal-1'), false);
      assert.equal(f.host.pendingTerminalInitialInputs.get(mapped), 'original-initial-input');
      gate.resolve({ file: '/controlled/shell', args: [], cwd: f.root, env: {} });
      await completed(f.clock, result, 'remapped preparation result');
      if (failPreparation) {
        assert.equal(f.host.pendingTerminalInitialInputs.has(mapped), false);
        assert.equal(f.host.nonNativeHostExecutions.size, 0);
        assert.equal(record.persistence.result.kind, 'not-required');
        assert.equal(f.providers.length, 0);
      } else {
        assert.strictEqual(f.host.nonNativeHostExecutions.get(`terminal:${mapped}`), record);
        assert.equal(record.mutationError, undefined);
        assert.ok(f.diagnostics.some(event => event.name === 'execution/started' && event.detail.nodeId === mapped
          && event.detail.sessionId === identity.executionId));
      }
    } finally { gate.resolve({ file: '/controlled/shell' }); await f.cleanup(); }
  });
}

for (const kind of ['agent', 'terminal']) {
  test(`candidate duplicate running ${kind} reports its original execution instead of rejecting unhandled`, async () => {
    const f = candidateFixture();
    let original;
    try {
      await completed(f.clock, f.start(kind), 'original before duplicate');
      original = f.record(kind);
      const metadata = original.persistence.metadata;
      const starts = f.diagnostics.filter(event => event.name === 'execution/started');
      await completed(f.clock, f.start(kind), 'duplicate handled without throwing');
      assert.strictEqual(f.record(kind), original);
      assert.strictEqual(original.persistence.metadata, metadata);
      assert.equal(f.providers.length, 1);
      assert.deepEqual(f.diagnostics.filter(event => event.name === 'execution/started'), starts);
      assert.ok(f.diagnostics.some(event => event.name === 'execution/startRejected' &&
        event.detail.kind === kind && event.detail.reason === 'already-running'));
      assert.ok(f.posted.some(message => message.type === 'host/error' &&
        message.payload.message === `This ${kind === 'agent' ? 'Agent' : 'Terminal'} is already running.`));
      assert.equal(original.execution.snapshot().stopRequested, false);
    } finally { original?.business?.cancelActivityPoll?.(); original?.business?.lineContextTracker.dispose(); original?.tracker.dispose(); }
  });
}


function startupResizeFixture(kind, waitingAt, options = {}) {
  const preparing = deferred();
  const f = candidateFixture({ ...options, ...(waitingAt === 'prepare' ? { environment: async () => {
    const result = await preparing.promise; if (result instanceof Error) throw result; return result;
  } } : {}) });
  const originalFactory = f.injection.createTransport;
  let held;
  let released = false;
  f.injection.createTransport = identity => {
    const transport = originalFactory(identity);
    const connect = transport.connect.bind(transport);
    transport.connect = sink => connect({ ...sink, message(message) {
      if (!released && message.type === waitingAt && (waitingAt !== 'operationObservation' || message.operationId === 'owner-start')) held = result => sink.message(result ? { ...message, result } : message);
      else sink.message(message);
    } });
    return transport;
  };
  const owner = new ExecutionOwnerLifecycle(f.injection);
  f.host.nonNativeExecutionOwner = owner;
  const starting = f.start(kind);
  void starting.catch(() => {});
  return { ...f, owner, starting,
    waiting: () => waitingAt === 'prepare' ? Boolean(f.record(kind)) : Boolean(held),
    release: result => { released = true; if (waitingAt === 'prepare') preparing.resolve(result ?? {}); else held(result); },
    async cleanup() {
      const record = f.record(kind);
      const provider = f.providers[0];
      if (provider && record && !record.execution.snapshot().settled) {
        provider.process();
        provider.message({ type: 'resourceResult', resourceId: 'subject', operationId: 'subject-release', result: { kind: 'released' } });
        provider.seal(record.lastDataSequence); provider.release();
        await pump(f.clock, () => record.execution.snapshot().settled);
      }
      record?.business?.cancelActivityPoll?.(); record?.business?.lineContextTracker.dispose(); record?.tracker.dispose();
    }
  };
}

for (const kind of ['agent', 'terminal']) {
  for (const waitingAt of ['prepare', 'ready', 'operationObservation']) {
    test(`startup resize ${kind} retains latest viewport while waiting for ${waitingAt}`, async () => {
      const f = startupResizeFixture(kind, waitingAt);
      try {
        await until(f.clock, f.waiting, 'startup barrier');
        const record = f.record(kind);
        const identity = record.execution.identity;
        const chain = record.terminalChain;
        f.host.resizeExecutionSession(kind, `${kind}-1`, 101, 31);
        f.host.resizeExecutionSession(kind, `${kind}-1`, 107, 37);
        await pump(f.clock, () => true);
        assert.equal(record.pendingResize?.cols, 107, 'latest viewport must be retained');
        assert.equal(record.terminalChain, chain, 'waiting for start cannot block output consumption');
        assert.equal(f.posted.some(message => message.type === 'host/error'), false);
        assert.equal(f.providers[0]?.messages.some(message => message.type === 'resize') ?? false, false);
        if (waitingAt === 'operationObservation') {
          f.providers[0].output(1, 'accepted-before-start-confirmation\r\n');
          await until(f.clock, () => record.execution.snapshot().adapter.consumedThrough === 1, 'startup output consumed');
        }
        f.release();
        await completed(f.clock, f.starting, 'original started');
        await until(f.clock, () => f.providers[0].messages.some(message => message.type === 'resize'), 'latest viewport dispatch');
        const requests = f.providers[0].messages.filter(message => message.type === 'resize');
        assert.equal(requests.length, 1);
        assert.deepEqual(requests[0].identity, identity);
        assert.equal(requests[0].cols, 107); assert.equal(requests[0].rows, 37);
        assert.equal(record.cols, 80, 'only native confirmation may change authority dimensions');
        f.providers[0].message({ type: 'interactionObservation', interactionId: requests[0].interactionId, result: { kind: 'resized' } });
        await until(f.clock, () => record.cols === 107 && record.rows === 37, 'confirmed viewport commit');
        assert.equal(record.pendingResize, undefined);
        assert.equal(f.providers.length, 1);
        assert.equal(f.posted.some(message => message.type === 'host/error'), false);
        if (waitingAt === 'operationObservation') assert.match(record.tracker.getSerializedState().data, /accepted-before-start-confirmation/);
      } finally { await f.cleanup(); }
    });
  }
}


for (const waitingAt of ['prepare', 'operationObservation']) {
  test(`startup resize rejects original pending intent when ${waitingAt} fails`, async () => {
    const f = startupResizeFixture('terminal', waitingAt);
    try {
      await until(f.clock, f.waiting, 'failing startup barrier');
      const record = f.record('terminal');
      const resizing = assert.rejects(f.host.resizeNonNativeHostExecution(record, 99, 29), /preparation failed|start was failed|controlled start failed/);
      const starting = assert.rejects(f.starting, /preparation failed|start was failed|controlled start failed/);
      f.release(waitingAt === 'prepare' ? new Error('controlled preparation failed')
        : { kind: 'failed', stage: 'spawn', reason: 'controlled start failed' });
      await completed(f.clock, starting, 'startup failure');
      await completed(f.clock, resizing, 'pending viewport failure');
      assert.equal(record.pendingResize, undefined);
      assert.equal(f.providers[0]?.messages.some(message => message.type === 'resize') ?? false, false);
      assert.equal(record.cols, 80);
    } finally { await f.cleanup(); }
  });
}

test('startup resize waits for startup budget and receives a fresh interaction budget when ready', async () => {
  const f = startupResizeFixture('terminal', 'ready');
  try {
    await until(f.clock, f.waiting, 'unready provider');
    const record = f.record('terminal');
    const resizing = f.host.resizeNonNativeHostExecution(record, 101, 31);
    f.clock.advance(EXECUTION_INTERACTION_LIMITS.observationMs + 1);
    assert.equal(record.pendingResize.deadline, undefined, 'starting is not a submitted terminal interaction');
    f.release();
    await completed(f.clock, f.starting, 'later original startup');
    await until(f.clock, () => f.providers[0].messages.some(message => message.type === 'resize'), 'late startup viewport');
    const request = f.providers[0].messages.find(message => message.type === 'resize');
    f.providers[0].message({ type: 'interactionObservation', interactionId: request.interactionId, result: { kind: 'resized' } });
    assert.equal(await completed(f.clock, resizing, 'viewport after long startup'), 'applied');
    assert.equal(record.cols, 101);
  } finally { await f.cleanup(); }
});

test('startup resize settles when the original provider startup times out', async () => {
  const f = startupResizeFixture('terminal', 'ready');
  try {
    await until(f.clock, f.waiting, 'provider never ready');
    const record = f.record('terminal');
    const resizing = assert.rejects(f.host.resizeNonNativeHostExecution(record, 101, 31));
    const starting = assert.rejects(f.starting, /unconfirmed|failed/);
    f.clock.advance(EXECUTION_CANDIDATE_BUDGETS.startMs);
    await completed(f.clock, starting, 'startup observation deadline');
    await completed(f.clock, resizing, 'startup timeout settles viewport');
    assert.equal(record.pendingResize, undefined);
    assert.equal(f.providers[0].messages.some(message => message.type === 'resize'), false);
    assert.equal(record.cols, 80);
  } finally { await f.cleanup(); }
});

test('startup resize is cancelled immediately when Host stops an execution still preparing', async () => {
  const f = startupResizeFixture('terminal', 'prepare');
  try {
    await until(f.clock, f.waiting, 'preparing original');
    const record = f.record('terminal');
    const resizing = f.host.resizeNonNativeHostExecution(record, 101, 31);
    const stopping = f.host.stopExecutionSession('terminal', 'terminal-1');
    assert.equal(await completed(f.clock, resizing, 'preparation viewport cancellation'), 'cancelled');
    assert.equal(record.pendingResize, undefined);
    const starting = assert.rejects(f.starting);
    f.release();
    await completed(f.clock, starting, 'cancelled preparation');
    await completed(f.clock, stopping, 'preparation stop');
    assert.equal(f.providers.length, 0);
  } finally { await f.cleanup(); }
});

for (const boundary of ['stop', 'source', 'authority-close']) {
  test(`startup resize cancels before dispatch at ${boundary} without changing final state`, async () => {
    const f = startupResizeFixture('terminal', 'operationObservation');
    try {
      await until(f.clock, f.waiting, 'started observation held');
      const record = f.record('terminal');
      const resizing = f.host.resizeNonNativeHostExecution(record, 101, 31);
      if (boundary === 'stop') void record.execution.requestStop('test-before-started');
      if (boundary === 'source') f.providers[0].seal(0);
      if (boundary === 'authority-close') f.owner.closeAdmission(false);
      f.release();
      await completed(f.clock, f.starting, 'startup result with closing boundary');
      assert.equal(await completed(f.clock, resizing, 'cancelled viewport intent'), 'cancelled');
      assert.equal(record.pendingResize, undefined);
      assert.equal(f.providers[0].messages.some(message => message.type === 'resize'), false);
      assert.equal(f.posted.some(message => message.type === 'host/error'), false);
      assert.equal(record.cols, 80); assert.equal(record.rows, 24);
      assert.equal(record.terminalRevision, 0);
      assert.equal(record.mutationError, undefined);
    } finally { await f.cleanup(); }
  });
}

for (const boundary of ['stop', 'source']) {
  test(`queued resize cancels at ${boundary} after running admission and preserves the tail`, async () => {
    const f = await interactiveHostFixture();
    const held = deferred();
    try {
      f.record.terminalChain = held.promise;
      const resizing = f.host.resizeNonNativeHostExecution(f.record, 101, 31);
      if (boundary === 'stop') void f.record.execution.requestStop('test-pending-viewport');
      else f.provider.seal(0);
      held.resolve();
      assert.equal(await completed(f.clock, resizing, 'no longer live viewport'), 'cancelled');
      assert.equal(f.requests.length, 0);
      assert.equal(f.record.cols, 113); assert.equal(f.record.terminalRevision, 0);
      assert.equal(f.record.mutationError, undefined);
      assert.equal(f.posted.some(message => message.type === 'host/error'), false);
    } finally { held.resolve(); await f.cleanup(); }
  });
}

test('startup resize keeps quarantine errors instead of classifying them as viewport cancellation', async () => {
  const f = startupResizeFixture('terminal', 'ready');
  try {
    await until(f.clock, f.waiting, 'startup before quarantine');
    const record = f.record('terminal');
    const resizing = assert.rejects(f.host.resizeNonNativeHostExecution(record, 101, 31), /controlled quarantine/);
    f.owner.authority.quarantine('controlled quarantine');
    f.host.queueNonNativeHostResize(record);
    await completed(f.clock, resizing, 'quarantined pending viewport');
    assert.equal(record.pendingResize, undefined);
    assert.equal(f.providers[0].messages.some(message => message.type === 'resize'), false);
  } finally { await f.cleanup(); }
});


test('startup resize lets real page output credit complete before started and serializes only the confirmed viewport', async () => {
  const messages = [];
  const f = startupResizeFixture('terminal', 'operationObservation', {
    outputCredit: true, onHostMessage: message => messages.push(message)
  });
  const acknowledge = message => f.send('editor', 'webview/executionLocalOutputApplied', {
    nodeId: message.payload.nodeId, kind: 'terminal', executionSessionId: message.payload.executionSessionId,
    ...message.payload.localOutputReceipt, outcome: 'applied'
  }, message.lifecycle);
  try {
    await until(f.clock, f.waiting, 'held started with page credit');
    const record = f.record('terminal');
    const attach = f.host.postLocalExecutionSnapshot(record, { surface: 'editor' });
    await until(f.clock, () => messages.some(message => message.payload?.localOutputReceipt), 'pre-start attach');
    const firstResize = f.host.resizeNonNativeHostExecution(record, 101, 31);
    const resizing = f.host.resizeNonNativeHostExecution(record, 107, 37);
    assert.equal(await firstResize, 'superseded');
    acknowledge(messages.find(message => message.payload?.localOutputReceipt));
    await completed(f.clock, attach, 'pre-start snapshot applied');
    f.providers[0].output(1, 'startup-page-credit-tail\r\n');
    await until(f.clock, () => messages.some(message => message.type === 'host/executionOutput'), 'pre-start output delivered');
    assert.equal(record.execution.snapshot().adapter.consumedThrough, 0);
    acknowledge(messages.find(message => message.type === 'host/executionOutput'));
    await until(f.clock, () => record.execution.snapshot().adapter.consumedThrough === 1, 'page consumption while awaiting started');
    assert.equal(f.providers[0].messages.some(message => message.type === 'resize'), false);
    f.release();
    await completed(f.clock, f.starting, 'started after page consumption');
    await until(f.clock, () => f.providers[0].messages.some(message => message.type === 'resize'), 'ready viewport request');
    const request = f.providers[0].messages.find(message => message.type === 'resize');
    f.providers[0].message({ type: 'interactionObservation', interactionId: request.interactionId, result: { kind: 'resized' } });
    await until(f.clock, () => messages.some(message => message.type === 'host/executionSnapshot' && message.payload.cols === 107), 'confirmed resized snapshot');
    const snapshot = messages.find(message => message.type === 'host/executionSnapshot' && message.payload.cols === 107);
    assert.equal(snapshot.payload.rows, 37);
    assert.match(snapshot.payload.serializedTerminalState.data, /startup-page-credit-tail/);
    acknowledge(snapshot);
    assert.equal(await completed(f.clock, resizing, 'page applied confirmed geometry'), 'applied');
    assert.equal(f.posted.some(message => message.type === 'host/error'), false);
  } finally { f.host.cancelLocalExecutionReaders('editor', 'cancelled', 'test-complete'); await f.cleanup(); }
});

for (const queued of [false, true]) {
  test(`startup resize refuses a replaced metadata binding before native dispatch (${queued})`, async () => {
    const f = startupResizeFixture('terminal', 'ready');
    const held = deferred();
    try {
      await until(f.clock, f.waiting, 'original metadata');
      const record = f.record('terminal');
      if (queued) { f.release(); await completed(f.clock, f.starting, 'running before held queue'); record.terminalChain = held.promise; }
      const resizing = assert.rejects(f.host.resizeNonNativeHostExecution(record, 101, 31), /original resize authority binding changed/);
      const node = f.host.state.nodes.find(node => node.id === 'terminal-1');
      node.metadata = { terminal: { ...node.metadata.terminal } };
      if (queued) held.resolve();
      else { f.release(); await completed(f.clock, f.starting, 'started with replaced metadata'); }
      await completed(f.clock, resizing, 'original binding rejected');
      assert.equal(f.providers[0].messages.some(message => message.type === 'resize'), false);
      assert.equal(record.cols, 80);
    } finally { held.resolve(); await f.cleanup(); }
  });
}


async function ownedAbnormalExitFixture(providerKind = 'codex') {
  const f = await interactiveHostFixture('agent', providerKind);
  const shown = [];
  const finalStates = [];
  const saves = [];
  f.host.enabledAttentionSignals = ['agentAbnormalExit'];
  f.host.attentionNotificationBridgeMode = 'workbench';
  f.host.showExecutionAttentionNotification = async (...args) => { shown.push(args); };
  const persist = f.host.persistState.bind(f.host);
  f.host.persistState = async options => {
    saves.push(options);
    if (options?.reason === 'local-final-snapshot') finalStates.push(structuredClone(f.host.state));
    await persist(options);
  };
  const writing = f.host.writeExecutionInput('agent', 'agent-1', 'go\r');
  await until(f.clock, () => f.requests.some(m => m.type === 'input'), 'Agent input reached provider');
  f.reply(f.requests.find(m => m.type === 'input'), { kind: 'written', writtenBytes: 3 });
  assert.equal(await completed(f.clock, writing, 'Agent input written'), true);
  assert.equal(f.record.business.lifecycleStatus, 'running');
  f.provider.output(1, 'original final output\r\n');
  await until(f.clock, () => f.record.execution.snapshot().adapter.consumedThrough === 1, 'original output consumed');
  async function finish(result = { kind: 'exited', exitCode: 27 }) {
    f.provider.message({ type: 'processResult', result });
    f.provider.message({ type: 'resourceResult', resourceId: 'subject', operationId: 'subject-release', result: { kind: 'released' } });
    f.provider.seal(1); f.provider.release();
    await until(f.clock, () => f.record.persistence.result !== undefined, 'original final persistence completed');
  }
  return { ...f, shown, finalStates, saves, finish,
    node: () => f.host.state.nodes.find(node => node.id === 'agent-1'),
    posted: () => f.diagnostics.filter(event => event.name === 'execution/attentionNotificationPosted') };
}

for (const providerKind of ['codex', 'claude']) {
  for (const lifecycle of ['running', 'waiting-input']) {
    test(`owned abnormal exit ${providerKind} ${lifecycle} notifies once and saves attention with final output`, async () => {
      const f = await ownedAbnormalExitFixture(providerKind);
      try {
        f.record.business.lifecycleStatus = lifecycle;
        await f.finish();
        assert.equal(f.record.persistence.result.kind, 'saved');
        assert.equal(f.node().status, 'error');
        assert.equal(f.node().metadata.agent.lastExitCode, 27);
        assert.equal(f.node().metadata.agent.attentionPending, true);
        assert.equal(f.shown.length, 1);
        assert.equal(f.posted().length, 1);
        assert.equal(f.posted()[0].detail.trigger, 'agent-abnormal-interruption');
        assert.equal(f.posted()[0].detail.provider, providerKind);
        assert.equal(f.posted()[0].detail.lifecycleStatus, 'error');
        assert.equal(f.posted()[0].detail.exitCode, 27);
        assert.equal(f.posted()[0].detail.sessionId, f.record.execution.identity.executionId);
        const saved = f.finalStates[0].nodes.find(node => node.id === 'agent-1');
        assert.equal(saved.status, 'error');
        assert.equal(saved.metadata.agent.attentionPending, true, 'attention must be in the original final save');
        assert.match(saved.metadata.agent.serializedTerminalState.data, /original final output/);
        assert.equal(f.saves.filter(options => options?.reason === 'execution-attention').length, 0,
          'final save owns the attention write');
        f.host.persistNonNativeHostFinal(f.record, { kind: 'applied', finalRevision: 1, throughDataSequence: 1 });
        assert.equal(f.shown.length, 1, 'duplicate finalization cannot notify twice');
        assert.equal(f.finalStates.length, 1);
      } finally { await f.cleanup(); }
    });
  }
}

for (const scenario of ['exit-zero', 'user-stop', 'starting', 'resuming', 'signal', 'disabled']) {
  test(`owned abnormal exit preserves suppression for ${scenario}`, async () => {
    const f = await ownedAbnormalExitFixture();
    try {
      let stopping;
      if (scenario === 'user-stop') {
        stopping = f.host.stopExecutionSession('agent', 'agent-1');
        await until(f.clock, () => f.record.execution.snapshot().stopRequested, 'explicit Host stop');
      }
      if (scenario === 'starting' || scenario === 'resuming') f.record.business.lifecycleStatus = scenario;
      if (scenario === 'disabled') f.host.enabledAttentionSignals = [];
      await f.finish(scenario === 'signal' ? { kind: 'signaled', signal: 'SIGTERM' }
        : { kind: 'exited', exitCode: scenario === 'exit-zero' ? 0 : 27 });
      if (stopping) await completed(f.clock, stopping, 'Host stop completed');
      assert.equal(f.record.persistence.result.kind, 'saved');
      assert.equal(f.node().status, ['exit-zero', 'user-stop'].includes(scenario) ? 'stopped' : 'error');
      assert.notEqual(f.node().metadata.agent.attentionPending, true);
      assert.equal(f.shown.length, 0);
      assert.equal(f.posted().length, 0);
    } finally { await f.cleanup(); }
  });
}

for (const scenario of ['bridge-none', 'covered-by-stream']) {
  test(`owned abnormal exit saves attention without new delivery for ${scenario}`, async () => {
    const f = await ownedAbnormalExitFixture();
    try {
      if (scenario === 'bridge-none') f.host.attentionNotificationBridgeMode = 'none';
      else f.record.business.attentionSignalState = { lastAbnormalStreamNotificationAtMs: Date.now() };
      await f.finish();
      assert.equal(f.record.persistence.result.kind, 'saved');
      assert.equal(f.finalStates[0].nodes.find(node => node.id === 'agent-1').metadata.agent.attentionPending, true);
      assert.equal(f.shown.length, 0);
      assert.equal(f.posted().length, 0);
      if (scenario === 'covered-by-stream') assert.equal(f.diagnostics.some(event =>
        event.name === 'execution/attentionNotificationSuppressed' && event.detail.reason === 'covered-by-abnormal-stream'), true);
    } finally { await f.cleanup(); }
  });
}

for (const scenario of ['pending-delivery', 'failed-delivery', 'failed-workbench', 'failed-save']) {
  test(`owned abnormal exit isolates ${scenario} from the other completion responsibility`, async () => {
    const f = await ownedAbnormalExitFixture();
    const delivery = deferred();
    const requests = [];
    f.host.attentionNotificationBridgeMode = 'system';
    f.host.postExecutionAttentionNotificationToCompanion = request => {
      requests.push(request);
      return scenario === 'failed-delivery' ? Promise.reject(new Error('controlled notification rejection')) : delivery.promise;
    };
    if (scenario === 'failed-workbench') {
      f.host.attentionNotificationBridgeMode = 'workbench';
      f.host.showExecutionAttentionNotification = async () => { throw new Error('controlled workbench rejection'); };
    }
    if (scenario === 'failed-save') f.host.persistState = async () => { throw new Error('controlled final save failure'); };
    try {
      await f.finish();
      assert.equal(f.record.persistence.result.kind, scenario === 'failed-save' ? 'failed' : 'saved');
      assert.equal(requests.length, scenario === 'failed-workbench' ? 0 : 1);
      assert.equal(f.node().metadata.agent.attentionPending, true);
      if (scenario === 'failed-save') assert.match(f.record.persistence.result.reason, /controlled final save failure/);
      for (const reader of f.record.localReaders.values()) {
        await reader.finalPublication;
        await f.host.handleLocalExecutionTerminalSettled('editor', { kind: 'agent', nodeId: 'agent-1',
          executionSessionId: f.record.execution.identity.executionId,
          outcome: { kind: 'applied', finalOutputSequence: 1 } }, reader.lifecycle, reader.webview);
      }
      if (scenario !== 'failed-save') await until(f.clock, () => !f.host.nonNativeHostExecutions.has('agent:agent-1'),
        'execution retires while delivery is still pending');
      if (scenario === 'failed-delivery' || scenario === 'failed-workbench') await until(f.clock, () => f.diagnostics.some(event =>
        event.name === 'execution/attentionNotificationFailed' && event.detail.sessionId === f.record.execution.identity.executionId),
      'notification failure recorded separately');
      // Late completion may report delivery, but cannot reset attention on a replacement node.
      const replacement = structuredClone(f.node());
      replacement.metadata.agent.attentionPending = false;
      f.host.state.nodes = f.host.state.nodes.map(node => node.id === replacement.id ? replacement : node);
      delivery.resolve({ status: 'posted', backend: 'test', activationMode: 'test' });
      await pump(f.clock, () => f.diagnostics.some(event => event.name === 'execution/attentionNotificationCompanionPosted'));
      assert.equal(f.node().metadata.agent.attentionPending, false);
    } finally {
      delivery.resolve({ status: 'posted', backend: 'test', activationMode: 'test' });
      await f.cleanup();
    }
  });
}

for (const replacement of ['metadata', 'record', 'node']) {
  test(`owned abnormal exit rejects stale ${replacement} before notification`, async () => {
    const f = await ownedAbnormalExitFixture();
    try {
      if (replacement === 'metadata') f.node().metadata.agent = { ...f.node().metadata.agent };
      else if (replacement === 'record') f.host.nonNativeHostExecutions.delete('agent:agent-1');
      else f.host.state.nodes = f.host.state.nodes.filter(node => node.id !== 'agent-1');
      await f.finish();
      assert.notEqual(f.record.persistence.result.kind, 'saved');
      assert.equal(f.shown.length, 0);
      assert.equal(f.posted().length, 0);
      assert.notEqual(f.node()?.metadata.agent.attentionPending, true);
    } finally { await f.cleanup(); }
  });
}


for (const providerKind of ['codex', 'claude']) {
  for (const scenario of ['failure', 'signal', 'exit-zero', 'stop', 'input', 'prompt', 'unknown']) {
    test(`owned resume final ${providerKind} ${scenario} preserves phase and recovery metadata`, async () => {
      const f = await interactiveHostFixture('agent', providerKind, {
        resumeRequested: true,
        agentMetadata: { lastResumeError: 'previous attempt failed' },
        resumeContext: { supported: true, strategy: 'fake-provider', sessionId: 'original-resume-id' }
      });
      const initialResumeError = f.host.state.nodes.find(node => node.id === 'agent-1').metadata.agent.lastResumeError;
      const shown = [];
      const finalStates = [];
      f.host.enabledAttentionSignals = ['agentAbnormalExit'];
      f.host.attentionNotificationBridgeMode = 'workbench';
      f.host.showExecutionAttentionNotification = async (...args) => { shown.push(args); };
      const persist = f.host.persistState.bind(f.host);
      f.host.persistState = async options => {
        if (options?.reason === 'local-final-snapshot') finalStates.push(structuredClone(f.host.state));
        await persist(options);
      };
      try {
        assert.equal(f.record.business.launchMode, 'resume');
        assert.equal(f.record.business.lifecycleStatus, 'resuming');
        assert.equal(f.record.business.resumePhaseActive, true);
        assert.deepEqual(f.provider.messages.find(message => message.type === 'start').spec.args,
          ['resume', 'original-resume-id']);
        if (scenario === 'input') {
          const writing = f.host.writeExecutionInput('agent', 'agent-1', 'continue\r');
          await until(f.clock, () => f.requests.some(m => m.type === 'input'), 'resume input submitted');
          f.reply(f.requests.find(m => m.type === 'input'), { kind: 'written', writtenBytes: 9 });
          assert.equal(await completed(f.clock, writing, 'resume input confirmed'), true);
          assert.equal(f.record.business.lifecycleStatus, 'running');
          assert.equal(f.record.business.resumePhaseActive, false);
        }
        f.provider.output(1, scenario === 'prompt' ? 'restored\r\n> ' : 'resume transport ended\r\n');
        await until(f.clock, () => f.record.execution.snapshot().adapter.consumedThrough === 1, 'original resume output consumed');
        if (scenario === 'prompt') {
          f.clock.advance(300);
          assert.equal(f.record.business.lifecycleStatus, 'waiting-input');
          assert.equal(f.record.business.resumePhaseActive, false);
        }
        let stopping;
        if (scenario === 'stop') {
          stopping = f.host.stopExecutionSession('agent', 'agent-1');
          await until(f.clock, () => f.record.execution.snapshot().stopRequested, 'explicit resume stop');
        }
        const result = scenario === 'signal' ? { kind: 'signaled', signal: 'SIGTERM' }
          : scenario === 'unknown' ? { kind: 'unconfirmed', reason: 'resume process outcome unknown' }
          : { kind: 'exited', exitCode: scenario === 'exit-zero' ? 0 : 33 };
        f.provider.message({ type: 'processResult', result });
        f.provider.message({ type: 'resourceResult', resourceId: 'subject', operationId: 'subject-release', result: { kind: 'released' } });
        f.provider.seal(1); f.provider.release();
        await until(f.clock, () => f.record.persistence.result !== undefined, 'original resume final persistence');
        if (stopping) await completed(f.clock, stopping, 'resume stop completed');
        const node = f.host.state.nodes.find(node => node.id === 'agent-1');
        if (scenario === 'unknown') {
          assert.equal(f.record.persistence.result.kind, 'unconfirmed');
          assert.equal(finalStates.length, 0);
          assert.notEqual(node.status, 'resume-failed');
          assert.equal(shown.length, 0);
        } else {
          const resumeFailed = scenario === 'failure' || scenario === 'signal';
          const status = resumeFailed ? 'resume-failed' : ['stop', 'exit-zero'].includes(scenario) ? 'stopped' : 'error';
          assert.equal(f.record.persistence.result.kind, 'saved');
          assert.equal(node.status, status);
          const saved = finalStates[0].nodes.find(node => node.id === 'agent-1');
          assert.equal(saved.status, status);
          assert.equal(saved.metadata.agent.lifecycle, status);
          assert.equal(saved.metadata.agent.lastExitCode, result.exitCode);
          assert.equal(saved.metadata.agent.lastExitSignal, result.signal);
          assert.equal(saved.metadata.agent.resumeSessionId, 'original-resume-id');
          assert.equal(saved.metadata.agent.liveSession, false);
          assert.equal(saved.metadata.agent.lastExitMessage, saved.summary);
          assert.match(saved.metadata.agent.serializedTerminalState.data, /restored|resume transport ended/);
          assert.equal(saved.metadata.agent.lastResumeError, resumeFailed ? saved.summary : undefined);
          if (resumeFailed) assert.match(saved.summary, /while resuming/);
          assert.equal(shown.length, status === 'error' ? 1 : 0);
          assert.equal(saved.metadata.agent.attentionPending === true, status === 'error');
          f.host.persistNonNativeHostFinal(f.record, { kind: 'applied', finalRevision: 1, throughDataSequence: 1 });
          assert.equal(finalStates.length, 1, 'same original final is persisted only once');
        }
        assert.equal(initialResumeError, undefined, 'a new attempt clears the previous resume error');
      } finally { await f.cleanup(); }
    });
  }
}

const testNameFilter = process.env.DEV_SESSION_CANVAS_HOST_TEST_FILTER;
const testNamePattern = testNameFilter ? new RegExp(testNameFilter) : undefined;
const selectedTests = testNamePattern ? tests.filter(({ name }) => testNamePattern.test(name)) : tests;
assert(selectedTests.length > 0, 'Host test-name filter must select at least one test.');
for (const { name, run, timeoutMs } of selectedTests) {
  let timeout;
  try {
    await Promise.race([
      run(),
      new Promise((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(`${name}: test exceeded ${timeoutMs} ms`)), timeoutMs);
      })
    ]);
  } finally { clearTimeout(timeout); }
  console.log(`ok - ${name}`);
}
console.log(`Host execution owner wiring: ${selectedTests.length}/${selectedTests.length} passed (selected ${selectedTests.length}/${tests.length}; non-native only).`);
