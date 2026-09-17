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
    ['subscribeSession', { ...identity, afterRevision: 0, terminalStreamMode: 'paged' }]
  ]) {
    await assert.rejects(client[method](params), /original endpoint unavailable/u);
    assert.equal(attempts.at(-1), false, `${method} must not restart a paged runtime`);
  }
  await client.closeTerminalRead(identity);
  assert.equal(attempts.length, 4, 'reader cleanup must not reconnect a closed socket');
  await assert.rejects(client.attachSession({ sessionId: 'legacy' }), /original endpoint unavailable/u);
  assert.equal(attempts.at(-1), true, 'legacy attach retains its existing connection policy');
  client.dispose();
}

async function verifySupervisorRetention(directory) {
  const filename = path.resolve('extensions/vscode/dev-session-canvas/src/supervisor/runtimeSupervisorMain.ts');
  const source = await readFile(filename, 'utf8');
  const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const calls = ast.statements.filter((node) => ts.isExpressionStatement(node) && node.getText(ast).startsWith('void main()'));
  assert.equal(calls.length, 1);
  const contents = source.slice(0, calls[0].pos) + source.slice(calls[0].end) +
    '\nexport { RuntimeSupervisorServer, TerminalSessionJournal, SerializedTerminalStateTracker };';
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
    'subscribeRuntimeSupervisorTerminalStream'];
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
    class Harness { ${methods.join('\n')} }
    export { Harness, timers };
  `, resolveDir: path.dirname(path.dirname(filename)), loader: 'ts' }, bundle: true,
    platform: 'node', format: 'cjs', write: false });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', bundle.outputFiles[0].text)(module, module.exports, createRequire(import.meta.url));
  const { Harness, timers } = module.exports;
  const subscriber = new Harness();
  let subscribedWithoutRestart = false;
  subscriber.getRuntimeSupervisorClientForKind = async (backend, options, storage) => {
    assert.equal(backend, 'legacy-detached');
    assert.equal(options.allowRestart, false, 'paged resubscription must not restart the original endpoint');
    assert.equal(storage, '/same-runtime');
    return {
      supportsTerminalSessionStream: () => true,
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
}
