import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import esbuild from 'esbuild';
import ts from 'typescript';

const directory = await mkdtemp(path.join(os.tmpdir(), 'dsc-paged-projection-'));
try {
  const require = createRequire(import.meta.url);
  const modules = {};
  for (const entry of ['common/terminalStreamPaging', 'webview/terminalPagedProjection',
    'panel/runtimeTerminalReadRelay', 'panel/runtimeSupervisorClient']) {
    const outfile = path.join(directory, `${path.basename(entry)}.cjs`);
    await esbuild.build({ entryPoints: [`extensions/vscode/dev-session-canvas/src/${entry}.ts`],
      outfile, bundle: true, platform: 'node', format: 'cjs', target: 'node18' });
    Object.assign(modules, require(outfile));
  }
  const { TerminalPagedProjection, RuntimeTerminalReadRelay, normalizeTerminalStreamPage,
    normalizeTerminalStreamRead, takeTerminalStreamPage, TERMINAL_STREAM_PAGE_MAX_BYTES } = modules;
  const checkpoint = { version: 1, sessionId: 'session', authorityId: 'authority', revision: 0,
    cols: 80, rows: 24, scrollback: 1000, createdAtMs: 1,
    serializedState: { format: 'xterm-serialize-v1', data: '', outputSequence: 0, viewportY: undefined } };
  const descriptor = { readId: 'reader', sessionId: 'session', authorityId: 'authority', checkpoint, headRevision: 4 };
  const event = (revision, data = `row-${revision}`) => ({ type: 'output', revision, createdAtMs: 1, data });
  const page = (afterRevision, events, headRevision = 4) => ({ readId: descriptor.readId,
    sessionId: descriptor.sessionId, authorityId: descriptor.authorityId, afterRevision,
    revision: afterRevision + events.length, headRevision, events });
  assert.ok(normalizeTerminalStreamRead(descriptor));
  assert.equal(normalizeTerminalStreamRead({ ...descriptor, authorityId: 'wrong' }), undefined);
  assert.equal(normalizeTerminalStreamPage(page(0, [event(2)])), undefined);
  assert.equal(normalizeTerminalStreamPage(page(0, [])), undefined);
  assert.equal(normalizeTerminalStreamPage({ ...page(0, [event(1)]), revision: 4 }), undefined);
  const oversized = event(1, 'x'.repeat(TERMINAL_STREAM_PAGE_MAX_BYTES));
  assert.ok(normalizeTerminalStreamPage(page(0, [oversized])));
  assert.equal(normalizeTerminalStreamPage(page(0, [oversized, event(2)])), undefined);
  assert.equal(takeTerminalStreamPage([oversized, event(2)], 0).length, 1);
  assert.equal(takeTerminalStreamPage(Array.from({ length: 300 }, (_, index) => event(index + 1)), 0).length, 256);

  const requests = [];
  const writes = [];
  const closes = [];
  const exits = [];
  const projection = new TerminalPagedProjection({
    request: (read, afterRevision, requestId) => requests.push({ read, afterRevision, requestId }),
    close: (read) => closes.push(read),
    checkpoint: (read, current, done) => writes.push({ checkpoint: read, current, done }),
    events: (events, current, done) => writes.push({ events, current, done }),
    exit: (message) => exits.push(message)
  });
  projection.start(descriptor);
  projection.start(descriptor);
  assert.equal(writes.length, 1, 'duplicate open must not reset a healthy projection');
  assert.equal(requests.length, 0, 'checkpoint must be applied before reading');
  writes.shift().done();
  const first = requests[0];
  projection.accept('wrong', first.requestId, page(0, [event(1), event(2)]));
  assert.equal(writes.length, 0);
  projection.accept('reader', first.requestId, page(0, [event(1), event(2)]));
  projection.accept('reader', first.requestId, page(0, [event(1), event(2)]));
  projection.available('session', 'authority', 5);
  assert.equal(requests.length, 1, 'slow xterm must not admit a second page');
  assert.equal(writes.length, 1, 'duplicate response must not enqueue twice');
  writes.shift().done();
  assert.equal(requests[1].afterRevision, 2);
  projection.accept('reader', requests[1].requestId, page(2, [event(3), event(4)], 5));
  writes.shift().done();
  projection.showExit('ended', 'session');
  projection.available('session', 'authority', 5, true);
  assert.equal(exits.length, 0, 'exit must wait for the final page');
  projection.accept('reader', requests[2].requestId, page(4, [event(5)], 5));
  writes.shift().done();
  assert.deepEqual(exits, ['ended']);
  assert.equal(requests.length, 3, 'caught-up reader must not poll');
  assert.equal(closes.length, 1, 'final consumption must release the transient completed source');
  projection.start({ ...descriptor, readId: 'retry-reader', headRevision: 5 });
  writes.shift().done();
  projection.accept('retry-reader', requests[3].requestId, page(0, [event(1), event(2), event(3), event(4), event(5)], 5));
  // The response identity must match the newly opened reader.
  await new Promise((resolve) => setTimeout(resolve, 300));
  projection.accept('retry-reader', requests[4].requestId, { ...page(0,
    [event(1), event(2), event(3), event(4), event(5)], 5), readId: 'retry-reader' });
  writes.shift().done();
  projection.available('session', 'authority', 6);
  projection.accept('retry-reader', requests[5].requestId, undefined);
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(requests[6].afterRevision, 5, 'failed page must retry the same applied position');
  projection.accept('retry-reader', requests[6].requestId, { ...page(5, [event(6)], 6), readId: 'retry-reader' });
  const stale = writes.shift();
  projection.start({ ...descriptor, readId: 'replacement' });
  assert.equal(stale.current(), false);
  stale.done();
  assert.equal(requests.length, 7, 'cancelled write must not acknowledge');
  projection.stop();
  assert.equal(closes.length, 3);

  writes.length = 0;
  projection.start({ ...descriptor, readId: 'closed-reader' });
  writes.shift().done();
  const closedRequest = requests.at(-1);
  projection.accept('stale-reader', closedRequest.requestId, undefined, 'must be ignored');
  assert.equal(projection.active, true);
  projection.accept('closed-reader', closedRequest.requestId, undefined, 'Terminal reader disconnected.');
  assert.equal(projection.active, false);
  assert.equal(exits.at(-1), 'Terminal reader disconnected.');
  const requestCount = requests.length;
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(requests.length, requestCount, 'closed completed readers must not retry forever');

  await verifyControllerSettlement(directory);

  const relay = new RuntimeTerminalReadRelay();
  let opens = 0;
  let remoteFailure = false;
  const released = [];
  const client = {
    openTerminalRead: async () => { opens += 1; return descriptor; },
    closeTerminalRead: async (read) => { released.push(read.readId); },
    readTerminalPage: async () => {
      if (remoteFailure) { throw new Error('journal deleted after durable handoff'); }
      return page(0, [event(1), event(2)]);
    }
  };
  assert.deepEqual(await relay.open('editor:terminal:n', client, 'session', 'authority', 'editor'), descriptor);
  assert.equal(relay.has('editor:terminal:n', 'session'), false, 'an open RPC is not delivery to the Webview');
  await relay.open('editor:terminal:n', client, 'session', 'authority', 'editor');
  assert.equal(opens, 1);
  const params = { sessionId: 'session', authorityId: 'authority', readId: 'reader', afterRevision: 0 };
  const firstPage = await relay.read('editor:terminal:n', params);
  assert.equal(relay.has('editor:terminal:n', 'session'), true, 'the first request proves checkpoint consumption');
  assert.equal(firstPage.revision, 2);
  await assert.rejects(relay.read('editor:terminal:n', { ...params, afterRevision: 1 }));
  await assert.rejects(relay.read('panel:terminal:n', params));
  remoteFailure = true;
  const stream = { version: 1, ...descriptor, revision: 4, events: [1, 2, 3, 4].map((revision) => event(revision)) };
  relay.complete('editor:terminal:n', stream);
  assert.equal(relay.getCompleted('editor:terminal:n').revision, 4);
  const completedPage = await relay.read('editor:terminal:n', { ...params, afterRevision: 2 });
  assert.deepEqual(completedPage.events, [event(3), event(4)]);
  assert.equal(completedPage.headRevision, 4);
  relay.close('editor:terminal:n', 'wrong');
  assert.equal(relay.has('editor:terminal:n', 'session'), true);
  relay.closeMatching(() => true);
  assert.equal(relay.getCompleted('editor:terminal:n'), undefined, 'closing a reader releases its history');
  assert.deepEqual(released, ['reader']);
  let finishOpen;
  const lateOpen = relay.open('editor:terminal:late', {
    ...client, openTerminalRead: () => new Promise((resolve) => { finishOpen = resolve; })
  }, 'session', 'authority', 'editor');
  relay.closeMatching(() => true);
  finishOpen(descriptor);
  assert.equal(await lateOpen, undefined);
  assert.deepEqual(released, ['reader', 'reader'], 'cancelled open must release the late result');
  await verifyClientReconnectPolicy(modules.RuntimeSupervisorClient);
  await verifySupervisorRetention(directory);
  await verifyHostReconnect();
  await verifyHostBatches(directory);
  console.log('terminal paged projection: validation, backpressure, cancellation, retry and ephemeral completion passed');
} finally {
  await rm(directory, { recursive: true, force: true });
}

async function verifyClientReconnectPolicy(RuntimeSupervisorClient) {
  const client = new RuntimeSupervisorClient({});
  const attempts = [];
  client.connectWithRestart = async (allowRestart) => {
    attempts.push(allowRestart);
    throw new Error('original endpoint unavailable');
  };
  const identity = { sessionId: 'session', authorityId: 'authority', readId: 'reader' };
  for (const [method, params] of [
    ['openTerminalRead', { ...identity, consumerId: 'editor' }],
    ['readTerminalPage', { ...identity, afterRevision: 0 }],
    ['attachSession', { sessionId: 'session', terminalStreamMode: 'paged' }],
    ['subscribeSession', { ...identity, afterRevision: 0, terminalStreamMode: 'paged' }],
    ['attachSession', { sessionId: 'session', terminalStreamMode: 'paged-until-exit' }],
    ['subscribeSession', { ...identity, afterRevision: 0, terminalStreamMode: 'paged-until-exit' }],
    ['deleteSession', { sessionId: 'session', preserveTerminalReads: true }]
  ]) {
    await assert.rejects(client[method](params), /original endpoint unavailable/u);
    assert.equal(attempts.at(-1), false, `${method} must not restart a paged runtime`);
  }
  await client.closeTerminalRead(identity);
  assert.equal(attempts.length, 7, 'reader cleanup must not reconnect a closed socket');
  await assert.rejects(client.attachSession({ sessionId: 'legacy' }), /original endpoint unavailable/u);
  assert.equal(attempts.at(-1), true, 'legacy attach retains its existing connection policy');
  client.dispose();
}

async function verifySupervisorRetention(directory) {
  const filename = path.resolve('extensions/vscode/dev-session-canvas/src/supervisor/runtimeSupervisorMain.ts');
  const source = await readFile(filename, 'utf8');
  const contents = source + '\nexport { TerminalSessionJournal, SerializedTerminalStateTracker };';
  const bundle = await esbuild.build({ stdin: { contents, resolveDir: path.dirname(filename), loader: 'ts' },
    bundle: true, platform: 'node', format: 'cjs', write: false, external: ['node-pty'] });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', bundle.outputFiles[0].text)(module, module.exports, createRequire(import.meta.url));
  const { RuntimeSupervisorServer, TerminalSessionJournal, SerializedTerminalStateTracker } = module.exports;
  const tracker = new SerializedTerminalStateTracker(80, 24, { scrollback: 100, initialOutputSequence: 0 });
  const journal = await TerminalSessionJournal.create({ storageDir: directory, sessionId: 'retention',
    initialCols: 80, initialRows: 24, initialScrollback: 100, segmentMaxBytes: 300, compactionMinBytes: 1,
    checkpointProfiles: { 'xterm-serialize-v1': 'test' } });
  const server = new RuntimeSupervisorServer({ storageDir: directory }, 'legacy-detached', 'best-effort');
  const session = { sessionId: 'retention', kind: 'terminal', live: true, output: '', outputSequence: 0,
    cols: 80, rows: 24, scrollback: 100, terminalAuthorityId: journal.getAuthorityId(), terminalJournal: journal,
    terminalStateTracker: tracker, terminalOperationChain: Promise.resolve(), terminalMutationAdmissionOpen: true,
    terminalCheckpoint: { version: 1, sessionId: 'retention', authorityId: journal.getAuthorityId(), revision: 0,
      cols: 80, rows: 24, scrollback: 100, createdAtMs: 1, serializedState: tracker.getSerializedState() } };
  server.sessions.set(session.sessionId, session);
  const socket = { destroyed: false };
  const otherSocket = { destroyed: false };
  server.terminalReads.set(socket, new Map());
  server.terminalReads.set(otherSocket, new Map());
  const identity = { sessionId: session.sessionId, authorityId: session.terminalAuthorityId };
  try {
    const slow = await server.openTerminalRead(socket, { ...identity, consumerId: 'panel' });
    const fast = await server.openTerminalRead(otherSocket, { ...identity, consumerId: 'editor' });
    const events = [];
    for (let index = 0; index < 12; index += 1) {
      const event = journal.appendOutput(`row-${index}\r\n`);
      events.push(event);
      tracker.write(event.data, { outputSequence: event.revision });
      session.outputSequence = event.revision;
    }
    await server.toFreshSnapshot(session);
    assert.equal(session.terminalCheckpoint.revision, events.length, 'safe checkpoint should advance');
    assert.equal(server.getTerminalJournalRetentionRevision(session), 0, 'slow checkpoint must pin history');
    const first = await server.readTerminalPage(otherSocket, { ...identity, readId: fast.readId, afterRevision: 0 });
    await assert.rejects(server.readTerminalPage(socket, { ...identity, readId: fast.readId, afterRevision: 0 }),
      /invalid/u, 'a different socket cannot use another reader');
    await server.readTerminalPage(otherSocket, { ...identity, readId: fast.readId, afterRevision: first.revision });
    assert.equal(server.getTerminalJournalRetentionRevision(session), 0, 'sending/fast consumption cannot release slow history');
    assert.deepEqual((await server.readTerminalPage(socket, { ...identity, readId: slow.readId, afterRevision: 0 })).events, events);
    session.live = false;
    const completed = await server.toFreshSnapshot(session, 'never');
    assert.equal(completed.terminalStream.checkpoint.revision, 0,
      'completed handoff must include a checkpoint that every existing reader can continue from');
    assert.deepEqual(completed.terminalStream.events, events);
    server.closeTerminalRead(socket, slow);
    assert.equal(server.getTerminalJournalRetentionRevision(session), events.length);
    const replacement = await server.openTerminalRead(otherSocket, { ...identity, consumerId: 'editor' });
    assert.notEqual(replacement.readId, fast.readId);
    await assert.rejects(server.readTerminalPage(otherSocket, { ...identity, readId: fast.readId, afterRevision: first.revision }));
    server.cleanupSocket(otherSocket);
    assert.equal(server.getTerminalJournalRetentionRevision(session), undefined, 'disconnect releases only its readers');
    server.clearIdleShutdownTimer();
  } finally {
    tracker.dispose();
    await journal.flush();
    server.clearIdleShutdownTimer();
  }
}

async function verifyHostReconnect() {
  const filename = path.resolve('extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts');
  const source = await readFile(filename, 'utf8');
  const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const manager = ast.statements.find((node) => ts.isClassDeclaration(node) && node.name?.text === 'CanvasPanelManager');
  const names = ['handleRuntimeSupervisorDisconnected', 'reconnectPagedRuntimeSession',
    'subscribeRuntimeSupervisorTerminalStream', 'isRuntimeSupervisorEventAdmitted'];
  const methods = names.map((name) => {
    const method = manager.members.find((node) => ts.isMethodDeclaration(node) && node.name.getText(ast) === name);
    assert.ok(method);
    return method.getText(ast);
  });
  const bundle = await esbuild.build({ stdin: { contents: `
    import { RUNTIME_SUPERVISOR_ERROR_CODES } from './common/runtimeSupervisorProtocol';
    import { normalizeTerminalStreamAttachPayload, normalizeTerminalStreamRevision } from './common/terminalSessionStream';
    const timers = [];
    const setTimeout = (callback) => { timers.push(callback); return {}; };
    const formatUnknownError = (error) => String(error);
    const updateExecutionNode = (state, nodeId, kind, patch) => ({ ...state, ...patch });
    const buildExecutionMetadataPatch = (state, nodeId, kind, patch) => patch;
    class Harness {
      runtimeSupervisorEventAdmissionOpen = true;
      runtimeSupervisorClientEpochs = new Map();
      ${methods.join('\n')}
    }
    export { Harness, timers, RUNTIME_SUPERVISOR_ERROR_CODES };
  `, resolveDir: path.dirname(path.dirname(filename)), loader: 'ts' }, bundle: true,
    platform: 'node', format: 'cjs', write: false });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', bundle.outputFiles[0].text)(module, module.exports, createRequire(import.meta.url));
  const { Harness, timers, RUNTIME_SUPERVISOR_ERROR_CODES } = module.exports;
  const subscriber = new Harness();
  let subscribedWithoutRestart = false;
  subscriber.getRuntimeSupervisorClientForKind = async (backend, options, storage) => {
    assert.equal(backend, 'legacy-detached');
    assert.equal(options.allowRestart, false, 'paged resubscription must not restart the original endpoint');
    assert.equal(storage, '/same-runtime');
    return {
      supportsTerminalSessionStream: () => true,
      supportsTerminalPagedCompletion: () => false,
      supportsTerminalHostOutputCredit: () => false,
      subscribeSession: async (params) => {
        assert.equal(params.terminalStreamMode, 'paged');
        assert.equal(params.sessionId, 'original');
        subscribedWithoutRestart = true;
      }
    };
  };
  await subscriber.subscribeRuntimeSupervisorTerminalStream({ sessionId: 'original', live: true,
    runtimeBackend: 'legacy-detached', terminalStreamPaged: true, terminalAuthorityId: 'authority', terminalRevision: 0
  }, '/same-runtime');
  assert.equal(subscribedWithoutRestart, true);
  const host = new Harness();
  const original = { owner: 'supervisor', sessionId: 'original', runtimeSessionId: 'original',
    runtimeBackend: 'legacy-detached', runtimeStoragePath: '/same-runtime', terminalStreamPaged: true,
    terminalStreamHealthy: true };
  host.agentSessions = new Map();
  host.terminalSessions = new Map([['node', original]]);
  host.state = {};
  host.getExecutionSessions = () => host.terminalSessions;
  host.resolveRuntimeStoragePath = (storage) => storage;
  host.requireNode = () => ({ status: 'live', summary: '' });
  host.terminalReadRelay = { closeMatching() {} };
  host.postState = () => {};
  host.getLiveRuntimeReconnectBlockReason = () => undefined;
  let pending;
  host.trackRuntimeSupervisorOperation = (operation) => { pending = operation; };
  host.markExecutionNodeAsHistoryRestored = () => assert.fail('A transport failure is not session loss');
  host.maybeFallbackAgentLiveRuntimeToResume = () => assert.fail('Transport reconnect cannot launch a new Agent');
  host.getRuntimeSupervisorClientForKind = async (backend, options, storage) => {
    assert.equal(options.allowRestart, false);
    assert.equal(storage, '/same-runtime');
    throw new Error('temporary connection failure');
  };
  host.handleRuntimeSupervisorDisconnected('legacy-detached', '/same-runtime', new Error('socket closed'));
  assert.equal(host.state.metadata.attachmentState, 'reattaching');
  assert.equal(timers.length, 1);
  timers.shift()();
  await pending;
  assert.equal(timers.length, 1, 'failed reconnect schedules one retry');
  assert.equal(host.terminalSessions.get('node'), original);
  host.getRuntimeSupervisorClientForKind = async () => ({});
  host.requestRuntimeSupervisorSessionAttach = async (client, sessionId) => {
    assert.equal(sessionId, 'original');
    return { snapshot: { sessionId, kind: 'terminal', live: true }, terminalProjectionMode: 'terminal-stream-v1' };
  };
  let subscribed = false;
  host.applyRuntimeSupervisorSnapshot = async (nodeId, kind, snapshot) => {
    assert.equal(snapshot.sessionId, 'original');
    host.terminalSessions.set('node', { ...original, terminalStreamHealthy: true });
  };
  host.subscribeRuntimeSupervisorTerminalStream = async (snapshot, storage) => {
    assert.equal(snapshot.sessionId, 'original');
    assert.equal(storage, '/same-runtime');
    subscribed = true;
  };
  timers.shift()();
  await pending;
  assert.equal(subscribed, true);
  assert.equal(timers.length, 0);
  const current = host.terminalSessions.get('node');
  const reconnectFlush = deferredHostOperation();
  const flushStarted = deferredHostOperation();
  current.hostOutputCredit = true;
  current.reconnectPending = false;
  current.outputSequence = 7;
  current.terminalAuthorityId = 'authority';
  current.lineContextTracker = { flush: async () => {
    flushStarted.resolve();
    await reconnectFlush.promise;
  } };
  const creditSubscriptions = [];
  const reopenedProjections = [];
  host.postPagedExecutionSnapshot = async (...args) => reopenedProjections.push(args);
  host.getRuntimeSupervisorClientForKind = async (backend, options, storage) => {
    assert.equal(options.allowRestart, false);
    assert.equal(storage, '/same-runtime');
    return {
      supportsTerminalHostOutputCredit: () => true,
      subscribeSession: async params => { creditSubscriptions.push(params); }
    };
  };
  host.requestRuntimeSupervisorSessionAttach = async () => assert.fail('credit reconnect must not attach the latest head');
  host.reconnectPagedRuntimeSession('terminal', 'node', current);
  timers.shift()();
  await flushStarted.promise;
  assert.equal(creditSubscriptions.length, 0, 'Host pending consumption must settle before resubscription');
  reconnectFlush.resolve();
  await pending;
  assert.deepEqual(creditSubscriptions, [{ sessionId: 'original', authorityId: 'authority',
    afterRevision: 7, terminalStreamMode: 'paged-until-exit', hostOutputCredit: 'journal-pages-v1' }]);
  assert.strictEqual(host.terminalSessions.get('node'), current, 'credit reconnect must preserve Host business state');
  assert.equal(current.outputSequence, 7);
  assert.equal(current.terminalStreamHealthy, true);
  assert.equal(reopenedProjections.length, 1, 'exact Host cursor reconnect must also replace closed Webview readers');
  assert.equal(reopenedProjections[0][0], 'terminal');
  assert.equal(reopenedProjections[0][1], 'node');
  assert.strictEqual(reopenedProjections[0][2], current);
  for (const failure of ['compacted', 'corrupt']) {
    const retryHost = new Harness();
    const retryCalls = [];
    const retrySession = { ...current, reconnectPending: false, reconnectTimer: undefined,
      lineContextTracker: { flush: async () => retryCalls.push('flush') } };
    retryHost.terminalSessions = new Map([['node', retrySession]]);
    retryHost.getExecutionSessions = () => retryHost.terminalSessions;
    retryHost.state = {};
    retryHost.requireNode = host.requireNode;
    retryHost.terminalReadRelay = host.terminalReadRelay;
    retryHost.postState = () => {};
    retryHost.recordDiagnosticEvent = (name, detail) => retryCalls.push({ name, detail });
    retryHost.getLiveRuntimeReconnectBlockReason = () => undefined;
    retryHost.markExecutionNodeAsHistoryRestored = () => assert.fail('compaction or corruption is not session loss');
    let retryOperation;
    retryHost.trackRuntimeSupervisorOperation = operation => { retryOperation = operation; };
    const error = Object.assign(new Error(`controlled ${failure} cursor failure`), {
      code: failure === 'compacted' ? RUNTIME_SUPERVISOR_ERROR_CODES.terminalHostCursorCompacted
        : RUNTIME_SUPERVISOR_ERROR_CODES.terminalJournalUnavailable
    });
    assert.equal(typeof error.code, 'string');
    retryHost.getRuntimeSupervisorClientForKind = async (_backend, options, storage) => {
      assert.equal(options.allowRestart, false);
      assert.equal(storage, '/same-runtime');
      return { supportsTerminalHostOutputCredit: () => true, subscribeSession: async params => {
        retryCalls.push(['resume', params.afterRevision]);
        throw error;
      } };
    };
    retryHost.requestRuntimeSupervisorSessionAttach = async (_client, sessionId) => {
      assert.equal(failure, 'compacted', 'journal corruption must not fall back to a newer checkpoint');
      retryCalls.push('attach');
      return { snapshot: { sessionId, kind: 'terminal', live: true, terminalRevision: 19 },
        terminalProjectionMode: 'terminal-stream-v1' };
    };
    retryHost.applyRuntimeSupervisorSnapshot = async (_nodeId, _kind, snapshot, options) => {
      assert.equal(options.postSnapshot, true, 'compacted recovery must rebuild the actual projection');
      retryCalls.push(['rebuild', snapshot.terminalRevision]);
      retryHost.terminalSessions.set('node', { ...retrySession, outputSequence: snapshot.terminalRevision,
        terminalStreamHealthy: true, reconnectPending: false });
    };
    retryHost.subscribeRuntimeSupervisorTerminalStream = async snapshot => retryCalls.push(['new-baseline', snapshot.terminalRevision]);
    retryHost.reconnectPagedRuntimeSession('terminal', 'node', retrySession);
    timers.shift()();
    await retryOperation;
    assert.deepEqual(retryCalls.slice(0, 2), ['flush', ['resume', 7]]);
    if (failure === 'compacted') {
      assert.equal(retryCalls.includes('attach'), true);
      assert.ok(retryCalls.some(call => Array.isArray(call) && call[0] === 'rebuild' && call[1] === 19));
      assert.ok(retryCalls.some(call => Array.isArray(call) && call[0] === 'new-baseline' && call[1] === 19));
      assert.ok(retryCalls.some(call => call?.name), 'compacted reset must be explicitly diagnosed');
      assert.equal(retrySession.outputSequence, 7, 'a new baseline must not claim the missing old revisions were consumed');
      assert.equal(timers.length, 0);
    } else {
      assert.equal(retryCalls.includes('attach'), false);
      assert.equal(retryHost.terminalSessions.get('node'), retrySession);
      assert.equal(retrySession.terminalStreamHealthy, false);
      assert.equal(timers.length, 1, 'non-compaction failure keeps its existing explicit retry path');
      timers.length = 0;
    }
  }
  host.runtimeSupervisorEventAdmissionOpen = false;
  host.handleRuntimeSupervisorDisconnected('legacy-detached', '/same-runtime', new Error('late socket close'));
  assert.equal(timers.length, 0, 'closed admission must not schedule a reconnect');
  assert.strictEqual(host.terminalSessions.get('node'), current);
}

async function verifyHostBatches(directory) {
  const filename = path.resolve('extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts');
  const source = await readFile(filename, 'utf8');
  const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const manager = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'CanvasPanelManager');
  const methodNames = ['handleRuntimeSupervisorTerminalBatch', 'handleRuntimeSupervisorTerminalEvent',
    'applyRuntimeSupervisorOutputChunk', 'handleRuntimeSupervisorState', 'queueExecutionOutput',
    'postTerminalAvailable', 'isRuntimeSupervisorEventAdmitted'];
  const methods = methodNames.map(name => {
    const method = manager.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(ast) === name);
    assert.ok(method, `actual Host method ${name} must exist`);
    return method.getText(ast);
  });
  const functions = ['updateExecutionTerminalTitle', 'appendTerminalBuffer', 'trimStoredTerminalText'].map(name => {
    const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
    assert.ok(declaration, `actual Host function ${name} must exist`);
    return declaration.getText(ast);
  });
  const outfile = path.join(directory, 'actual-host-terminal-batch.cjs');
  await esbuild.build({ stdin: { contents: `
    import { cloneTerminalStreamEvent } from './common/terminalSessionStream';
    import { formatExecutionTerminalTitleReport, normalizeExecutionTerminalTitle,
      processExecutionTerminalTitleControls, stripExecutionTerminalTitleMarkers } from './common/executionTerminalTitle';
    import { ExecutionTerminalLineContextTracker } from './panel/executionTerminalLineContextTracker';
    const formatUnknownError = error => String(error);
    const EXECUTION_OUTPUT_STATE_SYNC_INTERVAL_MS = 1;
    const localizeRuntimeSupervisorSnapshotExitMessage = snapshot => snapshot.lastExitMessage;
    const vscode = { l10n: { t: value => value } };
    const updateExecutionNode = (state, nodeId, kind, patch) => ({ ...state, ...patch });
    const buildExecutionMetadataPatch = (state, nodeId, kind, patch) => patch;
    ${functions.join('\n')}
    class Harness {
      runtimeSupervisorEventAdmissionOpen = true;
      runtimeSupervisorClientEpochs = new Map();
      ${methods.join('\n')}
    }
    export { Harness, ExecutionTerminalLineContextTracker };
  `, resolveDir: path.dirname(path.dirname(filename)), loader: 'ts' }, outfile, bundle: true,
    platform: 'node', format: 'cjs', target: 'node18' });
  const require = createRequire(import.meta.url);
  const { Harness, ExecutionTerminalLineContextTracker } = require(outfile);
  let passed = 0;
  const fixture = (kind = 'terminal', live = false) => {
    const host = new Harness();
    const calls = [];
    const posts = [];
    host.state = {};
    host.requireNode = () => ({ status: 'live', summary: '' });
    host.postState = () => calls.push({ name: 'state-updated' });
    const tracker = new ExecutionTerminalLineContextTracker(80, 24, {
      cwd: '/repo', pathStyle: 'posix', scrollback: 100
    });
    const session = { owner: 'supervisor', sessionId: 'session', runtimeSessionId: 'session',
      runtimeBackend: 'legacy-detached', runtimeStoragePath: '/runtime', terminalStreamPaged: true,
      terminalStreamHealthy: true, terminalAuthorityId: 'authority', outputSequence: 0,
      terminalProjectionMode: 'terminal-stream-v1', terminalStateTrusted: false,
      cols: 80, rows: 24, buffer: '', pendingOutput: '', terminalTitle: 'initial-title',
      lifecycleStatus: 'live', lineContextTracker: tracker };
    const binding = { kind, nodeId: 'node' };
    const sessions = new Map([['node', session]]);
    host.buildRuntimeSessionBindingKey = (...parts) => JSON.stringify(parts);
    const key = host.buildRuntimeSessionBindingKey(kind, 'session', '/runtime', 'legacy-detached');
    host.runtimeSessionBindings = new Map([[key, binding]]);
    host.getExecutionSessions = candidate => {
      assert.equal(candidate, kind);
      return sessions;
    };
    host.postMessage = message => posts.push(message);
    host.recordDiagnosticEvent = (name, detail) => calls.push({ name, detail });
    host.recordExecutionPerformanceDiagnostics = () => {};
    host.queueExecutionStateSync = () => {};
    host.clearExecutionTerminalProjectionRefreshTimers = () => {};
    host.flushExecutionOutputImmediately = () => calls.push({ name: 'flush-output' });
    host.reconnectPagedRuntimeSession = () => calls.push({ name: 'unexpected-reconnect' });
    host.bridgeExecutionAttentionSignals = async (_kind, _nodeId, _session, text) => calls.push({ name: 'attention', text });
    host.maybeSyncAgentResumeContextFromOutput = () => calls.push({ name: 'agent-resume' });
    host.recordAgentOutputHeuristicsAndNotifyAbnormalStream = (_nodeId, _session, text) => calls.push({ name: 'agent-output', text });
    const applyEvent = host.handleRuntimeSupervisorTerminalEvent.bind(host);
    host.handleRuntimeSupervisorTerminalEvent = (...args) => {
      calls.push({ name: 'event', type: args[2].event.type, revision: args[2].event.revision });
      return applyEvent(...args);
    };
    host.applyRuntimeSupervisorSnapshot = async (_nodeId, _kind, snapshot) => {
      calls.push({ name: 'snapshot', snapshot });
      assert.equal(session.outputSequence, snapshot.terminalRevision);
      assert.equal(tracker.terminal.cols, 40);
      assert.equal(tracker.terminal.rows, 8);
      assert.equal(tracker.terminal.options.scrollback, 60);
      const lines = Array.from({ length: tracker.terminal.buffer.active.length }, (_, index) =>
        tracker.terminal.buffer.active.getLine(index)?.translateToString(true));
      assert.ok(lines.includes('TAIL'), 'final state dispatch must follow actual tail application');
      session.terminalTitle = snapshot.terminalTitle ?? undefined;
      if (!snapshot.live) {
        tracker.dispose();
        sessions.delete('node');
        host.runtimeSessionBindings.delete(key);
      }
    };
    host.postExecutionExitWithFinalSnapshot = async () => calls.push({ name: 'exit' });
    const events = [
      // Supervisor journals redact title controls; title arrives separately in the caught-up state.
      { type: 'output', revision: 1, createdAtMs: 1, data: '\0HEAD\r\n' },
      { type: 'resize', revision: 2, createdAtMs: 1, cols: 40, rows: 8 },
      { type: 'scrollback', revision: 3, createdAtMs: 1, scrollback: 60 },
      { type: 'output', revision: 4, createdAtMs: 1, data: 'TAIL\r\n' }
    ];
    const batch = { sessionId: 'session', kind, authorityId: 'authority', subscriptionId: 'subscription', batchId: 1,
      afterRevision: 0, revision: 4, events,
      snapshot: { sessionId: 'session', kind, live, lifecycle: live ? 'live' : 'closed',
        terminalAuthorityId: 'authority', terminalRevision: 4, terminalTitle: live ? 'batch-title' : null,
        lastExitMessage: 'ended' } };
    let current = true;
    return { host, calls, posts, tracker, session, sessions, batch, key, binding,
      run: () => host.handleRuntimeSupervisorTerminalBatch('legacy-detached', '/runtime', batch, () => current),
      invalidate: () => { current = false; },
      dispose: () => tracker.dispose() };
  };
  const holdWriteCallback = tracker => {
    const ready = deferredHostOperation();
    const write = tracker.terminal.write.bind(tracker.terminal);
    let held;
    tracker.terminal.write = (text, done) => write(text, () => {
      if (!held) { held = done; ready.resolve(); }
      else done?.();
    });
    return { ready: ready.promise, release: () => held?.() };
  };
  for (const kind of ['terminal', 'agent']) {
    const f = fixture(kind);
    const write = holdWriteCallback(f.tracker);
    let settled = false;
    try {
      const result = f.run().then(value => { settled = true; return value; });
      await write.ready;
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(settled, false, 'a queued business event is not Host consumption credit');
      assert.equal(f.calls.filter(call => call.name === 'snapshot').length, 0);
      assert.equal(f.session.terminalTitle, 'initial-title', 'sanitized journal output does not carry a newer title');
      assert.deepEqual(f.calls.filter(call => call.name === 'event').map(({ type, revision }) => [type, revision]),
        [['output', 1], ['resize', 2], ['scrollback', 3], ['output', 4]]);
      write.release();
      assert.equal(await result, 'consumed');
      assert.equal(f.session.terminalTitle, undefined);
      assert.equal(f.posts.every(message => message.type === 'host/executionTerminalAvailable'), true);
      assert.equal(f.posts.every(message => message.payload.terminalTitle === undefined), true);
      assert.equal(f.calls.find(call => call.name === 'snapshot').snapshot.terminalTitle, null);
      assert.deepEqual(f.calls.filter(call => ['snapshot', 'exit'].includes(call.name)).map(call => call.name), ['snapshot', 'exit']);
      assert.equal(f.calls.filter(call => call.name === 'attention').length, 2);
      assert.equal(f.calls.filter(call => call.name === 'agent-resume').length, kind === 'agent' ? 2 : 0);
      assert.equal(f.calls.filter(call => call.name === 'agent-output').length, kind === 'agent' ? 2 : 0);
      passed++;
    } finally { write.release(); f.dispose(); }
  }

  {
    const f = fixture('terminal', true);
    const snapshotReached = deferredHostOperation();
    const applySnapshot = f.host.applyRuntimeSupervisorSnapshot;
    let write;
    let settled = false;
    f.host.applyRuntimeSupervisorSnapshot = async (...args) => {
      await applySnapshot(...args);
      write = holdWriteCallback(f.tracker);
      f.tracker.write('AFTER-SNAPSHOT\r\n');
      snapshotReached.resolve();
    };
    try {
      const result = f.run().then(value => { settled = true; return value; });
      await snapshotReached.promise;
      await write.ready;
      assert.equal(settled, false, 'live snapshot work must drain before credit is returned');
      write.release();
      assert.equal(await result, 'consumed');
      assert.equal(f.calls.some(call => call.name === 'exit'), false);
      assert.equal(f.session.terminalTitle, 'batch-title');
      passed++;
    } finally { write?.release(); f.dispose(); }
  }

  for (const boundary of ['dispose', 'connection-replaced', 'session-replaced', 'binding-replaced']) {
    const f = fixture();
    const write = holdWriteCallback(f.tracker);
    try {
      const result = f.run();
      await write.ready;
      if (boundary === 'dispose') f.tracker.dispose();
      else if (boundary === 'connection-replaced') f.invalidate();
      else if (boundary === 'session-replaced') f.sessions.set('node', { ...f.session });
      else f.host.runtimeSessionBindings.set(f.key, { ...f.binding });
      write.release();
      assert.equal(await result, 'cancelled', `${boundary} must not acknowledge the old batch`);
      assert.equal(f.calls.some(call => call.name === 'snapshot' || call.name === 'exit'), false);
      assert.equal(f.host.runtimeSessionBindings.has(f.key), true, 'stale completion must not unbind a successor');
      passed++;
    } finally { write.release(); f.dispose(); }
  }
  for (const failure of ['write-error', 'server-error', 'ahead-snapshot']) {
    const f = fixture();
    try {
      if (failure === 'write-error') f.tracker.terminal.write = () => { throw new Error('controlled Host line write failure'); };
      else if (failure === 'server-error') f.batch.error = 'controlled journal failure';
      else f.batch.snapshot.terminalRevision = 5;
      assert.equal(await f.run(), 'cancelled');
      assert.equal(f.session.terminalStreamHealthy, false);
      assert.equal(f.calls.some(call => call.name === 'snapshot' || call.name === 'exit'), false);
      assert.equal(f.calls.filter(call => call.name === 'runtime/hostOutputConsumptionFailed').length, 1);
      assert.equal(typeof f.host.state.metadata.lastRuntimeError, 'string');
      assert.equal(f.calls.some(call => call.name === 'state-updated'), true);
      passed++;
    } finally { f.dispose(); }
  }
  console.log(`Actual Host batch handling: ${passed}/${passed} passed (real event/state dispatch and line callbacks; sanitized title input, snapshot application, persistence and notification delivery controlled).`);
}

function deferredHostOperation() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function verifyControllerSettlement(directory) {
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
    const scheduleExecutionTerminalDrain = () => {};
    const EXECUTION_PERFORMANCE_DIAGNOSTIC_MIN_DURATION_MS = 0;
    const EXECUTION_PERFORMANCE_DIAGNOSTIC_MIN_CHARACTERS = 0;
    const EXECUTION_TERMINAL_APPLIED_ACK_INTERVAL_MS = 5;
    const EXECUTION_TERMINAL_SNAPSHOT_OUTPUT_BATCH_MAX_CHARACTERS = 32768;
    ${extract('applyTerminalStreamEvents')}
    ${extract('restoreExecutionTerminalSnapshot')}
    ${extract('normalizeTerminalSnapshotOutputSequence')}
    export function createController(terminal, postMessage, options, reportExecutionPerformanceDiagnostic, environment = {}) {
      const pendingExecutionTerminalSnapshotWrites = environment.snapshotTasks ?? [];
      const activeExecutionTerminalSnapshotWrite = undefined;
      const scheduleExecutionTerminalSnapshotWrite = task => environment.snapshotTasks
        ? pendingExecutionTerminalSnapshotWrites.push(task) : task.run(() => {});
      ${extract('createExecutionTerminalController')}
      return createExecutionTerminalController('node', environment.kind ?? 'terminal', terminal, options);
    }
    export function routeExit(detail, postMessage, executionTerminalRegistry) {
      ${extract('routeExecutionTerminalExit')}
      routeExecutionTerminalExit(detail);
    }
  `;
  const outfile = path.join(directory, 'actual-webview-controller.cjs');
  await esbuild.build({ stdin: { contents, resolveDir: path.dirname(filename), loader: 'ts' },
    outfile, bundle: true, platform: 'node', format: 'cjs', target: 'node18' });
  const require = createRequire(import.meta.url);
  const { createController, routeExit } = require(outfile);
  const { Terminal } = require('@xterm/headless');
  let passed = 0;
  const defer = () => {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
  };
  const until = async (condition, label) => {
    for (let turn = 0; turn < 200; turn++) {
      if (condition()) return;
      await new Promise(resolve => setTimeout(resolve, 1));
    }
    assert.fail(`Actual controller condition not reached: ${label}`);
  };
  const check = async (name, run) => {
    let timer;
    try {
      await Promise.race([run(), new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`Actual controller ${name} exceeded 3000 ms`)), 3000);
      })]);
      passed++;
      console.log(`PASS actual Webview writer: ${name}`);
    } finally { clearTimeout(timer); }
  };
  const fixture = (readId = 'reader', headRevision = 0, settlementMode = 'final-application-v1', environment = {}) => {
    const messages = [];
    const readErrors = [];
    const terminal = new Terminal({ cols: 80, rows: 24, scrollback: 100, allowProposedApi: true });
    terminal.refresh = () => {};
    let snapshotNotifications = 0;
    const diagnostics = { failNext: false, released: 0, releaseFails: false };
    const controller = createController(terminal, message => messages.push(message), {
      onReadError: message => { readErrors.push(message); },
      onSnapshotApplied: () => { snapshotNotifications++; },
      beginSnapshotRestoreDiagnosticsSuppression: () => () => {
        diagnostics.released++;
        if (diagnostics.releaseFails) throw new Error('controlled suppression release failure');
      }
    }, () => {
      if (diagnostics.failNext) { diagnostics.failNext = false; throw new Error('controlled diagnostic callback failure'); }
    }, environment);
    const descriptor = {
      readId, sessionId: 'session', authorityId: 'authority', headRevision,
      ...(settlementMode ? { settlementMode } : {}),
      checkpoint: { version: 1, sessionId: 'session', authorityId: 'authority', revision: 0,
        cols: 80, rows: 24, scrollback: 100, createdAtMs: 1,
        serializedState: { format: 'xterm-serialize-v1', data: '', outputSequence: 0 } }
    };
    const start = (read = descriptor) => controller.applySnapshot({
      type: 'snapshot', nodeId: 'node', kind: 'terminal', output: '', cols: 80, rows: 24,
      liveSession: true, executionSessionId: read.sessionId, terminalRead: read
    });
    const requests = () => messages.filter(message => message.type === 'webview/readExecutionTerminalPage');
    const closes = () => messages.filter(message => message.type === 'webview/closeExecutionTerminalRead');
    const localResults = () => messages.filter(message => message.type === 'webview/executionLocalTerminalSettled');
    const localStart = (output = '', outputSequence = 0, executionSessionId = 'session') => controller.applySnapshot({
      type: 'snapshot', nodeId: 'node', kind: environment.kind ?? 'terminal', output, outputSequence,
      cols: 80, rows: 24, liveSession: true, executionSessionId
    });
    const localFinish = (finalOutputSequence = 0, executionSessionId = 'session', message = 'ended') =>
      controller.showExit(message, executionSessionId, { executionSessionId, finalOutputSequence });
    const sendPage = events => {
      const request = requests().at(-1).payload;
      controller.applyTerminalPage(request.readId, request.requestId, {
        readId: request.readId, sessionId: descriptor.sessionId, authorityId: descriptor.authorityId,
        afterRevision: request.afterRevision, revision: request.afterRevision + events.length,
        headRevision: Math.max(headRevision, request.afterRevision + events.length), events
      });
    };
    return { terminal, controller, messages, readErrors, diagnostics, descriptor, start, requests, closes, sendPage,
      localStart, localFinish, localResults,
      snapshotNotifications: () => snapshotNotifications,
      dispose() { controller.dispose(); terminal.dispose(); } };
  };

  for (const kind of ['terminal', 'agent']) {
    for (const mode of ['runtime', 'local', 'legacy-paged', 'legacy-stream']) {
      await check(`${kind} ${mode} exit status preserves all terminal cells and final cursor`, async () => {
        const f = fixture('reader', 1, mode === 'runtime' ? 'final-application-v1' : null, { kind });
        const paged = mode === 'runtime' || mode === 'legacy-paged';
        const tail = 'FIRST\r\nSECOND\r\nTAIL\x1b[31m-RED\x1b[0m\x1b]2;FINAL_TITLE\x07\x1b[?25l\x1b[2;3H';
        const screen = () => ({
          lines: Array.from({ length: f.terminal.buffer.active.length }, (_, index) =>
            f.terminal.buffer.active.getLine(index).translateToString(true)),
          cursorX: f.terminal.buffer.active.cursorX,
          cursorY: f.terminal.buffer.active.cursorY,
          baseY: f.terminal.buffer.active.baseY,
          hidden: f.terminal._core.coreService.isCursorHidden
        });
        try {
          if (paged) {
            f.start();
            await until(() => f.requests().length === 1, 'reader opened for terminal body');
            f.sendPage([{ type: 'output', revision: 1, createdAtMs: 1, data: tail }]);
          } else {
            f.localStart(tail, 1);
          }
          await until(() => f.controller.getQueuedWriteCount() === 0, 'subject tail fully applied');
          const expected = screen();
          assert.equal(expected.cursorX, 2);
          assert.equal(expected.cursorY, 1);
          assert.equal(expected.lines[2], 'TAIL-RED');
          if (paged) f.controller.terminalAvailable('session', 'authority', 1, true,
            mode === 'runtime' ? 1 : undefined);
          if (mode === 'local') f.localFinish(1, 'session', 'Session ended.');
          else f.controller.showExit('Session ended.', 'session');
          await until(() => f.controller.getQueuedWriteCount() === 0, 'exit notification and final application drained');
          if (mode === 'local') {
            assert.deepEqual(f.localResults()[0].payload.outcome, { kind: 'applied', finalOutputSequence: 1 });
          } else if (paged) {
            assert.equal(f.closes().length, 1);
            if (mode === 'runtime') assert.deepEqual(f.closes()[0].payload.outcome, { kind: 'applied', finalRevision: 1 });
            else assert.equal(Object.hasOwn(f.closes()[0].payload, 'outcome'), false);
          }
          assert.deepEqual(screen(), expected, 'Lifecycle status must not append or overwrite subject terminal bytes.');
          assert.deepEqual(f.readErrors, [], 'Natural exit must not create an error notification.');
        } finally { f.dispose(); }
      });
    }
  }

  for (const kind of ['terminal', 'agent']) {
    for (const settlementMode of ['final-application-v1', null]) {
      await check(`${kind} ${settlementMode ?? 'legacy'} reader errors notify once without touching terminal bytes`, async () => {
        const f = fixture('reader', 1, settlementMode, { kind });
        f.descriptor.checkpoint.serializedState.data = 'FIRST\r\nTAIL\x1b[1;3H';
        const screen = () => ({ lines: Array.from({ length: f.terminal.buffer.active.length }, (_, index) =>
          f.terminal.buffer.active.getLine(index).translateToString(true)),
          cursorX: f.terminal.buffer.active.cursorX, cursorY: f.terminal.buffer.active.cursorY });
        try {
          f.start();
          await until(() => f.requests().length === 1, 'original reader request');
          const original = f.requests()[0].payload;
          f.controller.applyTerminalPage('unrelated-reader', original.requestId, undefined, 'wrong-reader error');
          f.controller.applyTerminalPage(original.readId, 'unrelated-request', undefined, 'wrong-request error');
          assert.deepEqual(f.readErrors, []);
          const successor = { ...f.descriptor, readId: 'successor-reader' };
          f.start(successor);
          await until(() => f.requests().length === 2, 'successor reader request');
          const expected = screen();
          f.controller.applyTerminalPage(original.readId, original.requestId, undefined, 'replaced-reader error');
          assert.deepEqual(f.readErrors, []);
          assert.deepEqual(screen(), expected);
          const current = f.requests()[1].payload;
          f.controller.applyTerminalPage(current.readId, current.requestId, undefined, 'Terminal reader disconnected.');
          f.controller.applyTerminalPage(current.readId, current.requestId, undefined, 'duplicate error');
          await until(() => f.controller.getQueuedWriteCount() === 0, 'reader cancellation');
          assert.deepEqual(f.readErrors, ['Terminal reader disconnected.']);
          assert.deepEqual(screen(), expected, 'Read error feedback belongs outside the terminal byte stream.');
          assert.equal(f.closes().length, 2);
          if (settlementMode) assert.deepEqual(f.closes()[1].payload.outcome,
            { kind: 'cancelled', reason: 'terminal-reader-closed' });
          else assert.equal(Object.hasOwn(f.closes()[1].payload, 'outcome'), false);
        } finally { f.dispose(); }
      });
    }
  }

  await check('final zero waits for the real empty xterm callback, not snapshot notification or exit text', async () => {
    const f = fixture();
    const write = f.terminal.write.bind(f.terminal);
    const callbackReady = defer();
    let release;
    f.terminal.write = (text, done) => write(text, () => {
      assert.equal(text, '');
      release = done;
      callbackReady.resolve();
    });
    try {
      f.start();
      f.controller.terminalAvailable('session', 'authority', 0, true, 0);
      await callbackReady.promise;
      assert.equal(f.snapshotNotifications(), 1);
      assert.equal(f.closes().length, 0);
      assert.equal(f.requests().length, 0);
      assert.equal(f.controller.getQueuedWriteCount(), 1);
      release();
      await until(() => f.closes().length === 1, 'empty checkpoint callback settlement');
      assert.deepEqual(f.closes()[0].payload.outcome, { kind: 'applied', finalRevision: 0 });
      assert.equal(f.controller.getQueuedWriteCount(), 0);
    } finally { f.dispose(); }
  });

  await check('final arrives before the last page callback and waits for real output and cursor state', async () => {
    const f = fixture('reader', 1);
    try {
      f.start();
      await until(() => f.requests().length === 1, 'first page request after checkpoint callback');
      const write = f.terminal.write.bind(f.terminal);
      const callbackReady = defer();
      let release;
      f.terminal.write = (text, done) => write(text, () => { release = done; callbackReady.resolve(); });
      f.sendPage([{ type: 'output', revision: 1, createdAtMs: 1, data: 'TAIL\x1b[?25l' }]);
      f.controller.terminalAvailable('session', 'authority', 1, true, 1);
      await callbackReady.promise;
      assert.equal(f.closes().length, 0);
      assert.match(f.terminal.buffer.active.getLine(0).translateToString(true), /TAIL/);
      assert.equal(f.terminal._core.coreService.isCursorHidden, true);
      release();
      await until(() => f.closes().length === 1, 'tail callback settlement');
      assert.deepEqual(f.closes()[0].payload.outcome, { kind: 'applied', finalRevision: 1 });
    } finally { f.dispose(); }
  });

  await check('completed and head revision alone cannot create an applied result', async () => {
    const f = fixture();
    try {
      f.start();
      await until(() => f.requests().length === 1, 'empty checkpoint request');
      f.sendPage([]);
      f.controller.terminalAvailable('session', 'authority', 0, true);
      f.controller.showExit('ended', 'session');
      await until(() => f.controller.getQueuedWriteCount() === 0, 'empty page callback');
      assert.equal(f.closes().length, 0);
      f.controller.terminalAvailable('session', 'authority', 0, true, 0);
      await until(() => f.closes().length === 1, 'explicit final result');
      assert.equal(f.closes()[0].payload.outcome.kind, 'applied');
    } finally { f.dispose(); }
  });

  for (const failure of ['checkpoint', 'output', 'async resize']) {
    await check(`${failure} failure cancels without a later successful sentinel masking the failure`, async () => {
      const f = fixture('reader', failure === 'async resize' ? 2 : failure === 'output' ? 1 : 0);
      try {
        if (failure === 'checkpoint') f.terminal.write = () => { throw new Error('checkpoint write failed'); };
        f.start();
        if (failure !== 'checkpoint') {
          await until(() => f.requests().length === 1, 'failure page request');
          if (failure === 'output') f.terminal.write = () => { throw new Error('output write failed'); };
          else f.terminal.resize = () => { throw new Error('asynchronous resize failed'); };
          const events = [{ type: 'output', revision: 1, createdAtMs: 1, data: 'prefix' }];
          if (failure === 'async resize') events.push({ type: 'resize', revision: 2, createdAtMs: 1, cols: 81, rows: 24 });
          f.sendPage(events);
        }
        const finalRevision = failure === 'async resize' ? 2 : failure === 'output' ? 1 : 0;
        f.controller.terminalAvailable('session', 'authority', finalRevision, true, finalRevision);
        await until(() => f.closes().length === 1, `${failure} cancellation`);
        assert.equal(f.closes()[0].payload.outcome.kind, 'cancelled');
        assert.match(f.closes()[0].payload.outcome.reason, /write-failed/);
        assert.equal(f.controller.getQueuedWriteCount(), 0);
      } finally { f.dispose(); }
    });
  }

  await check('a failed earlier write in the same generation cannot be hidden by a successful checkpoint', async () => {
    const f = fixture();
    const write = f.terminal.write.bind(f.terminal);
    try {
      f.terminal.write = () => { throw new Error('prior output failure'); };
      f.controller.enqueueOutput('prefix', { executionSessionId: 'session', outputSequence: 1 });
      f.controller.flushPendingOutput();
      await until(() => f.controller.getQueuedWriteCount() === 0, 'failed prefix writer cleanup');
      f.terminal.write = write;
      f.start();
      f.controller.terminalAvailable('session', 'authority', 0, true, 0);
      await until(() => f.closes().length === 1, 'prefix failure cancellation');
      assert.equal(f.closes()[0].payload.outcome.kind, 'cancelled');
      assert.equal(f.requests().length, 0);
    } finally { f.dispose(); }
  });

  for (const sameGeneration of [true, false]) {
    await check(`replacement invalidates a real old callback in ${sameGeneration ? 'the same' : 'a new'} generation`, async () => {
      const f = fixture();
      const write = f.terminal.write.bind(f.terminal);
      const callbackReady = defer();
      let release;
      let held = false;
      f.terminal.write = (text, done) => write(text, () => {
        if (!held) { held = true; release = done; callbackReady.resolve(); }
        else done();
      });
      try {
        f.start();
        f.controller.terminalAvailable('session', 'authority', 0, true, 0);
        await callbackReady.promise;
        const sessionId = sameGeneration ? 'session' : 'next-session';
        const authorityId = sameGeneration ? 'authority' : 'next-authority';
        const next = { ...f.descriptor, readId: 'next-reader', sessionId, authorityId,
          checkpoint: { ...f.descriptor.checkpoint, sessionId, authorityId } };
        f.start(next);
        f.controller.terminalAvailable(sessionId, authorityId, 0, true, 0);
        assert.equal(f.closes().length, 1);
        assert.deepEqual(f.closes()[0].payload.outcome, { kind: 'cancelled', reason: 'reader-replaced' });
        release();
        await until(() => f.closes().length === 2, 'replacement callback settlement');
        assert.equal(f.closes()[1].payload.readId, 'next-reader');
        assert.deepEqual(f.closes()[1].payload.outcome, { kind: 'applied', finalRevision: 0 });
        assert.equal(f.controller.getQueuedWriteCount(), 0);
      } finally { f.dispose(); }
    });
  }

  for (const failure of ['diagnostics', 'delivery']) {
    await check(`${failure} callback failure settles the real write queue without manufacturing delivery`, async () => {
      const f = fixture();
      const push = f.messages.push.bind(f.messages);
      let deliveryAttempted = false;
      try {
        if (failure === 'diagnostics') f.diagnostics.failNext = true;
        else f.messages.push = message => {
          if (message.type === 'webview/closeExecutionTerminalRead' && !deliveryAttempted) {
            deliveryAttempted = true;
            throw new Error('controlled postMessage failure');
          }
          return push(message);
        };
        f.start();
        f.controller.terminalAvailable('session', 'authority', 0, true, 0);
        await until(() => f.controller.getQueuedWriteCount() === 0, 'callback failure queue cleanup');
        if (failure === 'delivery') {
          assert.equal(deliveryAttempted, true);
          assert.equal(f.closes().length, 0, 'a thrown delivery is not a sent applied result');
          f.start({ ...f.descriptor, readId: 'next-reader' });
          f.controller.terminalAvailable('session', 'authority', 0, true, 0);
          await until(() => f.closes().length === 1, 'failed generation cannot hide behind another checkpoint');
        }
        assert.equal(f.closes().length, 1);
        assert.equal(f.closes()[0].payload.outcome.kind, 'cancelled');
      } finally { f.dispose(); }
    });
  }

  await check('dispose cancels a pending write and its late callback cannot emit applied', async () => {
    const f = fixture();
    const write = f.terminal.write.bind(f.terminal);
    const callbackReady = defer();
    let release;
    f.terminal.write = (text, done) => write(text, () => { release = done; callbackReady.resolve(); });
    try {
      f.start();
      f.controller.terminalAvailable('session', 'authority', 0, true, 0);
      await callbackReady.promise;
      f.controller.dispose();
      assert.deepEqual(f.closes()[0].payload.outcome, { kind: 'cancelled', reason: 'controller-disposed' });
      release();
      await new Promise(resolve => setTimeout(resolve, 10));
      assert.equal(f.closes().length, 1);
    } finally { f.dispose(); }
  });

  await check('legacy descriptors keep close without outcome through the actual writer', async () => {
    const f = fixture('reader', 0, null);
    try {
      f.start();
      await until(() => f.requests().length === 1, 'legacy empty page');
      f.sendPage([]);
      f.controller.terminalAvailable('session', 'authority', 0, true);
      f.controller.showExit('ended', 'session');
      await until(() => f.closes().length === 1, 'legacy close after actual callback');
      assert.equal(Object.hasOwn(f.closes()[0].payload, 'outcome'), false);
    } finally { f.dispose(); }
  });
  for (const kind of ['terminal', 'agent']) {
    await check(`local ${kind} tail waits for all partial drains, real callbacks and final cursor state`, async () => {
      const f = fixture('reader', 0, null, { kind });
      try {
        f.localStart('BASE', 0);
        await until(() => f.controller.getQueuedWriteCount() === 0, 'initial local snapshot');
        const write = f.terminal.write.bind(f.terminal);
        let release;
        f.terminal.write = (text, done) => write(text, () => {
          if (text === '') release = done;
          else done();
        });
        f.controller.enqueueOutput('TAIL\x1b[?25l', {
          executionSessionId: 'session', outputStartSequence: 1, outputSequence: 1, persisted: true
        });
        f.localStart('DUPLICATE MUST NOT REPLACE', 1);
        f.localFinish(1);
        f.controller.flushPendingOutput(2);
        await until(() => f.controller.getQueuedWriteCount() === 0, 'partial output callback');
        assert.equal(f.localResults().length, 0);
        assert.ok(f.controller.getPendingOutputLength() > 0);
        f.controller.flushPendingOutput();
        await until(() => release !== undefined, 'local real sentinel callback');
        assert.equal(f.localResults().length, 0);
        assert.equal(f.terminal.buffer.active.getLine(0).translateToString(true), 'BASETAIL');
        assert.equal(f.terminal._core.coreService.isCursorHidden, true);
        release();
        await until(() => f.localResults().length === 1, 'local final application');
        assert.deepEqual(f.localResults()[0].payload, { nodeId: 'node', kind, executionSessionId: 'session',
          outcome: { kind: 'applied', finalOutputSequence: 1 } });
        f.localFinish(1);
        assert.equal(f.localResults().length, 1, 'duplicate final does not create a second result');
      } finally { f.dispose(); }
    });
  }

  await check('local final zero waits for scheduled snapshot and both actual empty callbacks', async () => {
    const snapshotTasks = [];
    const f = fixture('reader', 0, null, { snapshotTasks });
    const callbacks = [];
    let schedulerFinished = 0;
    const write = f.terminal.write.bind(f.terminal);
    f.terminal.write = (text, done) => write(text, () => text === '' ? callbacks.push(done) : done());
    try {
      f.localFinish(0, 'session', '');
      assert.equal(f.localResults().length, 0, 'no snapshot is not an applied empty terminal');
      f.localStart();
      await until(() => snapshotTasks.length === 1, 'scheduled local snapshot');
      assert.equal(f.snapshotNotifications(), 1);
      assert.equal(callbacks.length, 0);
      snapshotTasks.shift().run(() => { schedulerFinished++; });
      await until(() => callbacks.length === 1, 'empty snapshot callback');
      assert.equal(f.localResults().length, 0);
      callbacks.shift()();
      await until(() => callbacks.length === 1, 'empty final barrier callback');
      assert.equal(schedulerFinished, 1);
      assert.equal(f.localResults().length, 0);
      callbacks.shift()();
      await until(() => f.localResults().length === 1, 'empty local completion');
      assert.deepEqual(f.localResults()[0].payload.outcome, { kind: 'applied', finalOutputSequence: 0 });
      assert.equal(f.controller.getQueuedWriteCount(), 0, 'empty local exit message queues no decorative write');
      assert.equal(f.terminal.buffer.active.getLine(0).translateToString(true), '');
    } finally { f.dispose(); }
  });

  await check('local gap and persistence barrier cannot be acknowledged until recovery is applied', async () => {
    const f = fixture();
    try {
      f.localStart();
      await until(() => f.controller.getQueuedWriteCount() === 0, 'local gap initial snapshot');
      f.controller.enqueueOutput('GAP', {
        executionSessionId: 'session', outputStartSequence: 2, outputSequence: 2, persisted: false
      });
      f.localFinish(2);
      assert.equal(f.localResults().length, 0);
      assert.equal(f.messages.filter(message => message.type === 'webview/attachExecutionSession').length, 1);
      f.localStart('RECOVERED', 2);
      await until(() => f.controller.getQueuedWriteCount() === 0, 'local recovery snapshot');
      assert.equal(f.localResults().length, 0, 'persist barrier still blocks after snapshot');
      f.controller.enqueueOutput('', { executionSessionId: 'session', outputSequence: 2, persisted: true });
      await until(() => f.localResults().length === 1, 'local recovered completion');
      assert.deepEqual(f.localResults()[0].payload.outcome, { kind: 'applied', finalOutputSequence: 2 });
    } finally { f.dispose(); }
  });

  await check('unsequenced local output cannot prove the declared final prefix', async () => {
    const f = fixture();
    try {
      f.localStart();
      await until(() => f.controller.getQueuedWriteCount() === 0, 'unsequenced initial snapshot');
      f.controller.enqueueOutput('UNTRACKED', { executionSessionId: 'session' });
      f.controller.flushPendingOutput();
      f.localFinish();
      await until(() => f.controller.getQueuedWriteCount() === 0, 'unsequenced output callback');
      assert.equal(f.localResults().length, 0);
      f.controller.dispose();
      assert.deepEqual(f.localResults()[0].payload.outcome, { kind: 'cancelled', reason: 'controller-disposed' });
    } finally { f.dispose(); }
  });

  await check('a lower recovery snapshot keeps legacy flow but cannot prove the local final sequence', async () => {
    const f = fixture();
    const attaches = () => f.messages.filter(message => message.type === 'webview/attachExecutionSession');
    try {
      f.localStart('NEWER', 2);
      await until(() => f.controller.getQueuedWriteCount() === 0, 'newer local snapshot');
      f.controller.requestAttachSnapshot();
      f.localStart('OLDER', 1);
      await until(() => f.controller.getQueuedWriteCount() === 0, 'lower recovery snapshot');
      assert.equal(f.controller.isOutputDrainBlocked(), false, 'legacy recovery barrier rule remains unchanged');
      assert.equal(attaches().length, 1, 'legacy path does not introduce a new recovery request');
      f.localFinish(2);
      assert.equal(f.localResults().length, 0);
      assert.equal(attaches().length, 2, 'only the new local completion requests a trusted projection');
      f.localStart('FINAL', 2);
      await until(() => f.localResults().length === 1, 'trusted local final snapshot');
      assert.deepEqual(f.localResults()[0].payload.outcome, { kind: 'applied', finalOutputSequence: 2 });
    } finally { f.dispose(); }
  });

  for (const failure of ['scheduled snapshot', 'suppression release', 'output', 'final sentinel']) {
    await check(`local ${failure} failure cancels and releases the actual queue`, async () => {
      const snapshotTasks = [];
      const f = fixture('reader', 0, null, { snapshotTasks });
      let schedulerFinished = 0;
      try {
        f.localStart('BASE');
        await until(() => snapshotTasks.length === 1, 'local failure scheduled snapshot');
        const write = f.terminal.write.bind(f.terminal);
        if (failure === 'scheduled snapshot') f.terminal.reset = () => { throw new Error('scheduled reset failed'); };
        if (failure === 'suppression release') f.diagnostics.releaseFails = true;
        snapshotTasks.shift().run(() => { schedulerFinished++; });
        await until(() => f.controller.getQueuedWriteCount() === 0, 'local snapshot failure cleanup');
        f.terminal.write = (text, done) => {
          if ((failure === 'output' && text === 'TAIL') || (failure === 'final sentinel' && text === '')) {
            throw new Error('controlled local write failure');
          }
          write(text, done);
        };
        if (failure === 'output') {
          f.controller.enqueueOutput('TAIL', { executionSessionId: 'session', outputStartSequence: 1, outputSequence: 1 });
          f.controller.flushPendingOutput();
        }
        f.localFinish(failure === 'output' ? 1 : 0);
        await until(() => f.localResults().length === 1 && f.controller.getQueuedWriteCount() === 0, 'local failed settlement');
        assert.deepEqual(f.localResults()[0].payload.outcome, { kind: 'cancelled', reason: 'terminal-write-failed' });
        assert.equal(schedulerFinished, 1);
        assert.equal(f.diagnostics.released, 1);
      } finally { f.dispose(); }
    });
  }

  for (const boundary of ['replacement', 'dispose']) {
    await check(`local ${boundary} cancels the old execution before its held real callback`, async () => {
      const f = fixture();
      try {
        f.localStart('BASE');
        await until(() => f.controller.getQueuedWriteCount() === 0, 'local boundary snapshot');
        const write = f.terminal.write.bind(f.terminal);
        let release;
        f.terminal.write = (text, done) => write(text, () => {
          if (text === '' && !release) release = done;
          else done();
        });
        f.localFinish();
        await until(() => release !== undefined, 'local old callback');
        if (boundary === 'dispose') f.controller.dispose();
        else { f.localStart('NEXT', 0, 'next-session'); f.localFinish(0, 'next-session'); }
        assert.deepEqual(f.localResults()[0].payload, { nodeId: 'node', kind: 'terminal', executionSessionId: 'session',
          outcome: { kind: 'cancelled', reason: boundary === 'dispose' ? 'controller-disposed' : 'execution-replaced' } });
        release();
        await until(() => f.controller.getQueuedWriteCount() === 0, 'local old callback cleanup');
        if (boundary === 'replacement') {
          assert.equal(f.localResults().length, 2);
          assert.equal(f.localResults()[1].payload.executionSessionId, 'next-session');
          assert.deepEqual(f.localResults()[1].payload.outcome, { kind: 'applied', finalOutputSequence: 0 });
        } else assert.equal(f.localResults().length, 1);
      } finally { f.dispose(); }
    });
  }

  await check('missing or wrong-kind controller explicitly cancels local completion routing', async () => {
    for (const entries of [[], [['node', { controller: { kind: 'agent', showExit() { assert.fail('wrong controller'); } } }]]]) {
      const messages = [];
      routeExit({ type: 'exit', nodeId: 'node', kind: 'terminal', message: 'ended', executionSessionId: 'session',
        localCompletion: { executionSessionId: 'session', finalOutputSequence: 0 } }, message => messages.push(message), new Map(entries));
      assert.deepEqual(messages[0], { type: 'webview/executionLocalTerminalSettled', payload: {
        nodeId: 'node', kind: 'terminal', executionSessionId: 'session',
        outcome: { kind: 'cancelled', reason: 'controller-unavailable' }
      } });
    }
  });
  await check('cancelling an enqueued local snapshot releases its write chain without running the restore', async () => {
    const snapshotTasks = [];
    const f = fixture('reader', 0, null, { snapshotTasks });
    try {
      f.localStart('MUST NOT APPLY');
      f.localFinish();
      await until(() => snapshotTasks.length === 1, 'queued snapshot before cancellation');
      const task = snapshotTasks[0];
      f.controller.dispose();
      assert.equal(snapshotTasks.length, 0);
      assert.equal(f.localResults().length, 1);
      assert.deepEqual(f.localResults()[0].payload.outcome, { kind: 'cancelled', reason: 'controller-disposed' });
      let finished = 0;
      task.run(() => { finished++; });
      await new Promise(resolve => setTimeout(resolve, 10));
      assert.equal(finished, 1);
      assert.equal(f.controller.getQueuedWriteCount(), 0);
      assert.equal(f.localResults().length, 1);
      assert.equal(f.terminal.buffer.active.getLine(0).translateToString(true), '');
    } finally { f.dispose(); }
  });
  console.log(`Actual Webview controller settlement: ${passed}/${passed} passed (real headless xterm callbacks, no UI/native).`);
}
