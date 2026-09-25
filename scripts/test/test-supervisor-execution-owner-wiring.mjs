import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import esbuild from 'esbuild';

const require = createRequire(import.meta.url);
const filename = path.resolve('extensions/vscode/dev-session-canvas/src/supervisor/runtimeSupervisorMain.ts');
const source = await readFile(filename, 'utf8');
const bundle = await esbuild.build({
  stdin: { contents: source + '\nexport { TerminalSessionJournal };', resolveDir: path.dirname(filename), loader: 'ts' },
  bundle: true, platform: 'node', format: 'cjs', write: false, external: ['node-pty']
});
let forbiddenAcquisitions = 0;
const compiled = { exports: {} };
const guardedRequire = (name) => {
  if (name === 'node-pty') { forbiddenAcquisitions++; assert.fail('No native loading is permitted'); }
  if (name === 'child_process' || name === 'node:child_process') {
    return { ...require(name), spawn() { forbiddenAcquisitions++; assert.fail('No child process is permitted'); },
      spawnSync() { forbiddenAcquisitions++; assert.fail('No synchronous child process is permitted'); } };
  }
  return require(name);
};
guardedRequire.main = require.main;
new Function('module', 'exports', 'require', bundle.outputFiles[0].text)(compiled, compiled.exports, guardedRequire);
const { RuntimeSupervisorServer, TerminalSessionJournal } = compiled.exports;
const lifecycleBundle = await esbuild.build({
  entryPoints: [path.resolve('extensions/vscode/dev-session-canvas/src/common/executionLifecycle.ts')],
  bundle: true, platform: 'node', format: 'cjs', write: false
});
const lifecycleModule = { exports: {} };
new Function('module', 'exports', 'require', lifecycleBundle.outputFiles[0].text)(
  lifecycleModule, lifecycleModule.exports, require);
const { encodeOutputFrame } = lifecycleModule.exports;
const directory = await mkdtemp(path.join(os.tmpdir(), 'dsc-supervisor-owner-'));
const fixtures = [];
let fixtureId = 0;
let passed = 0;

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function fixture(capabilities = ['execution-lifecycle-v1'], behavior = {}) {
  let now = 0;
  const tasks = [];
  const deadlines = new Set();
  const scheduler = {
    now: () => now,
    scheduleTask: callback => tasks.push(callback),
    scheduleDeadline(deadline, callback) {
      const item = { deadline, callback };
      deadlines.add(item);
      return () => deadlines.delete(item);
    }
  };
  const transports = [];
  const storageDir = path.join(directory, String(++fixtureId));
  const server = new RuntimeSupervisorServer({ storageDir, registryPath: path.join(storageDir, 'registry.json') },
    'legacy-detached', 'best-effort', {
      kind: 'non-native', capabilities, scheduler,
      budgets: { startMs: 100, gracefulMs: 10, forceMs: 10, cancelMs: 10, settleMs: 10, ...behavior.budgets },
      createTransport(identity) {
        const transport = {
          identity, sent: [], frameId: 0,
          connect(sink) {
            this.sink = sink;
            if (behavior.connectThrows) throw new Error('injected connect failure');
            sink.message({ type: 'ready', identity, capabilities: ['execution-lifecycle-v1'] });
          },
          async send(message) {
            this.sent.push(message);
            if (message.type === 'start') {
              const started = () => {
                this.fact({ type: 'resourceAcquired', resourceId: 'subject' });
                this.fact({ type: 'operationObservation', operationId: message.operationId,
                  result: { kind: 'started', pid: 100 + transports.length } });
              };
              if (behavior.holdStart) behavior.releaseStart = () => tasks.push(started);
              else queueMicrotask(started);
            } else if (message.type === 'requestStop' || message.type === 'cancelOutput') {
              if (!behavior.holdCloseAck) tasks.push(() => this.fact({ type: 'operationObservation', operationId: message.operationId,
                result: { kind: 'accepted' } }));
            }
          },
          fact(message) { this.sink.message({ ...message, identity }); },
          output(text) {
            this.sink.data(encodeOutputFrame({ version: 1, identity, frameId: ++this.frameId, text }));
          },
          process(result = { kind: 'exited', exitCode: 0 }) { this.fact({ type: 'processResult', result }); },
          seal(disposition = { kind: 'eof' }) {
            this.fact({ type: 'sourceEnd', finalFrameId: this.frameId, disposition });
          },
          release() {
            this.fact({ type: 'resourceResult', resourceId: 'subject', operationId: 'release-subject',
              result: { kind: 'released' } });
            this.sink.controlResourceResult({ kind: 'released' });
          }
        };
        transports.push(transport);
        return transport;
      }
    });
  server.schedulePersist = () => {};
  const socket = addSocket();
  const f = { server, socket, scheduler, tasks, deadlines, transports, storageDir,
    async pump() {
      for (let count = 0; count < 5; count++) {
        const current = tasks.splice(0);
        for (const task of current) task();
        await new Promise(resolve => setTimeout(resolve, 1));
      }
    },
    async until(predicate, label) {
      for (let count = 0; count < 100; count++) {
        if (predicate()) return;
        await this.pump();
      }
      assert.fail(`Condition not reached: ${label}`);
    },
    async advance(ms) {
      now += ms;
      for (const item of [...deadlines].sort((a, b) => a.deadline - b.deadline)) {
        if (item.deadline <= now && deadlines.delete(item)) item.callback();
      }
      await this.pump();
    },
    elapse(ms) { now += ms; },
    addSocket,
    async create(kind = 'terminal', sessionId = `40000000-0000-4000-8000-${String(++fixtureId).padStart(12, '0')}`) {
      const result = await server.createSession(socket, params(sessionId, kind));
      await this.pump();
      return { result, session: server.sessions.get(sessionId), transport: transports.at(-1) };
    }
  };
  fixtures.push(f);
  return f;

  function addSocket() {
    const socket = { destroyed: false, messages: [], write(line) { this.messages.push(JSON.parse(line)); } };
    server.connections.add(socket);
    server.subscriptions.set(socket, new Map());
    server.deferredSubscriptionRevisions.set(socket, new Map());
    server.terminalReads.set(socket, new Map());
    server.appliedRevisionAcks.set(socket, new Map());
    return socket;
  }
}

function params(sessionId, kind = 'terminal') {
  return { sessionId, kind, displayLabel: 'Owner wiring fixture', launchMode: 'start', scrollback: 100,
    terminalStreamMode: 'paged-until-exit',
    launchSpec: { file: '/not-executed', args: [], cwd: '/project', env: {}, cols: 80, rows: 24 } };
}

async function finish(f, session, transport) {
  transport.process();
  transport.seal();
  transport.release();
  await f.until(() => session.ownedExecution.snapshot().settled, 'execution content and resources settled');
}

async function check(name, run) {
  await run();
  passed++;
  console.log(`PASS ${name}`);
}

const readerCapabilities = ['execution-lifecycle-v1', 'terminal-read-settlement-v1'];
let requestId = 0;

async function request(f, socket, method, requestParams) {
  const id = `reader-request-${++requestId}`;
  await f.server.handleRequest(socket, { type: 'request', id, method, params: requestParams });
  const response = socket.messages.find(message => message.type === 'response' && message.id === id);
  assert.ok(response, `${method} must actually send its response`);
  return response;
}

async function openReader(f, session, consumerId = 'editor', socket = f.socket, settlement = true) {
  const response = await request(f, socket, 'openTerminalRead', {
    sessionId: session.sessionId, authorityId: session.terminalAuthorityId, consumerId,
    ...(settlement ? { settlementMode: 'final-application-v1' } : {})
  });
  assert.equal(response.ok, true, JSON.stringify(response));
  return response.result;
}

function closeReader(f, read, outcome, socket = f.socket, overrides = {}) {
  return request(f, socket, 'closeTerminalRead', {
    sessionId: read.sessionId, authorityId: read.authorityId, readId: read.readId,
    ...(outcome ? { outcome } : {}), ...overrides
  });
}

function assertSettlement(response, settlement) {
  assert.equal(response.ok, true, JSON.stringify(response));
  assert.deepEqual(response.result, { ok: true, settlement });
}

async function checkReader(name, run) {
  await check(`reader settlement: ${name}`, async () => {
    let timeout;
    try {
      await Promise.race([
        run(),
        new Promise((_resolve, reject) => {
          timeout = setTimeout(() => reject(new Error(`${name}: test exceeded 3000 ms`)), 3000);
        })
      ]);
    } finally { clearTimeout(timeout); }
  });
}

try {
  await check('import is inert and missing capability acquires nothing', async () => {
    assert.equal(forbiddenAcquisitions, 0);
    const f = fixture([]);
    await assert.rejects(f.server.createSession(f.socket, params('40000000-0000-4000-8000-000000000001')), /capability/u);
    assert.equal(f.transports.length, 0);
    assert.equal(f.server.sessions.size, 0);
    assert.equal(f.server.executionOwner.snapshot().pending, 0);
  });

  await check('shutdown reserves before journal await and cancels delayed start after cleanup', async () => {
    const f = fixture();
    const entered = deferred();
    const gate = deferred();
    const original = TerminalSessionJournal.create;
    TerminalSessionJournal.create = async (...args) => { entered.resolve(); await gate.promise; return original(...args); };
    try {
      const sessionId = '40000000-0000-4000-8000-000000000002';
      const creating = f.server.createSession(f.socket, params(sessionId));
      const rejected = assert.rejects(creating, /admission is closed/u);
      await entered.promise;
      assert.equal(f.server.executionOwner.snapshot().pending, 1);
      await assert.rejects(f.server.createSession(f.socket, params(sessionId)), /reserved/u);
      const closing = f.server.prepareForShutdown('test shutdown');
      assert.equal(f.server.executionOwner.snapshot().closing, true);
      assert.equal(f.server.executionOwner.snapshot().pending, 1);
      gate.resolve();
      await rejected;
      assert.deepEqual(await closing, { kind: 'settled', pending: [] });
      assert.equal(f.transports.length, 0);
      assert.equal(f.server.sessions.size, 0);
      assert.equal(f.server.executionOwner.snapshot().pending, 0);
    } finally { TerminalSessionJournal.create = original; gate.resolve(); }
  });

  await check('unconfirmed journal preparation cannot release the reserved owner', async () => {
    const f = fixture();
    const original = TerminalSessionJournal.create;
    TerminalSessionJournal.create = async () => { throw new Error('partial journal creation'); };
    try {
      await assert.rejects(f.server.createSession(f.socket,
        params('40000000-0000-4000-8000-000000000003')), /partial journal/u);
      assert.equal(f.transports.length, 0);
      assert.equal(f.server.executionOwner.snapshot().pending, 1);
      await f.advance(40);
      assert.ok(f.server.executionOwner.snapshot().blockedReason);
      await assert.rejects(f.server.createSession(f.socket,
        params('40000000-0000-4000-8000-000000000004')), /admission/u);
    } finally { TerminalSessionJournal.create = original; }
  });

  await check('acquired start failure keeps the owner responsibility', async () => {
    const f = fixture(['execution-lifecycle-v1'], { connectThrows: true });
    await assert.rejects(f.server.createSession(f.socket,
      params('40000000-0000-4000-0000-000000000006')), /failed/u);
    assert.equal(f.server.executionOwner.snapshot().pending, 1);
    assert.equal(f.server.sessions.size, 1);
    const session = [...f.server.sessions.values()][0];
    assert.equal(session.lifecycle, 'error');
    await f.advance(40);
    assert.equal(f.server.executionOwner.snapshot().pending, 1);
  });

  for (const kind of ['terminal', 'agent']) {
    await check(`${kind}: seal cannot overtake paused consumption and later accepted batches`, async () => {
      const f = fixture();
      const { session, transport } = await f.create(kind);
      assert.equal(transport.identity.executionId, session.sessionId);
      const entered = deferred();
      const gate = deferred();
      const originalFlush = session.terminalStateTracker.flush.bind(session.terminalStateTracker);
      let flushCalls = 0;
      session.terminalStateTracker.flush = async () => {
        if (++flushCalls === 1) { entered.resolve(); await gate.promise; }
        return originalFlush();
      };
      for (let index = 0; index < 8; index++) transport.output(String(index));
      await f.until(() => session.ownedExecution.snapshot().adapter.acceptedThrough === 8, 'eight accepted frames');
      await entered.promise;
      transport.process();
      assert.equal(session.terminalMutationAdmissionOpen, true, 'process exit cannot close output admission');
      transport.seal();
      transport.release();
      await f.pump();
      assert.equal(session.ownedExecution.snapshot().terminal, undefined);
      assert.equal(session.ownedExecution.snapshot().adapter.consumedThrough, 0);
      assert.equal(flushCalls, 1, 'final flush must not enter the terminal chain yet');
      assert.equal(session.ownedReaderAdmissionOpen, true);
      gate.resolve();
      await f.until(() => session.ownedExecution.snapshot().settled, 'all batches and final flush');
      assert.equal(session.output, '01234567');
      assert.equal(flushCalls, 3, 'two consume batches and one final flush');
      assert.equal(session.ownedExecution.snapshot().terminal.finalRevision, 8);
      assert.equal(session.ownedReaderAdmissionOpen, false);
      assert.equal(session.live, false);
      assert.equal(session.ownedExecution.snapshot().readerOutcome, 'pending');
      assert.equal(f.server.executionOwner.snapshot().pending, 1, 'no synthetic reader applied result');
      await assert.rejects(f.server.openTerminalRead(f.socket, { sessionId: session.sessionId,
        authorityId: session.terminalAuthorityId, consumerId: 'editor' }), /readers are closed/u);
      await f.server.deleteSession({ sessionId: session.sessionId });
      assert.equal(session.ownedExecution.snapshot().readerOutcome, 'cancelled');
      assert.equal(f.server.sessions.has(session.sessionId), false);
    });
  }

  await check('socket loss only detaches readers and the last owner prevents idle retirement', async () => {
    const f = fixture();
    const { session, transport } = await f.create();
    const second = f.addSocket();
    await f.server.openTerminalRead(second, { sessionId: session.sessionId,
      authorityId: session.terminalAuthorityId, consumerId: 'panel' });
    f.socket.destroyed = true;
    f.server.cleanupSocket(f.socket);
    assert.equal(session.ownedExecution.snapshot().readerOutcome, 'pending');
    assert.equal(transport.sent.some(message => message.type === 'requestStop'), false);
    await finish(f, session, transport);
    await f.server.deleteSession({ sessionId: session.sessionId, preserveTerminalReads: true });
    assert.equal(f.server.sessions.has(session.sessionId), true);
    f.server.connections.delete(second);
    f.server.scheduleIdleShutdownIfNeeded();
    assert.equal(f.server.idleShutdownTimer, undefined, 'live=false cannot hide a pending reader owner');
    second.destroyed = true;
    f.server.cleanupSocket(second);
    await f.until(() => !f.server.sessions.has(session.sessionId), 'last socket loss retires preserved readers');
    assert.equal(session.ownedExecution.snapshot().readerOutcome, 'lost');
    assert.equal(transport.sent.some(message => message.type === 'requestStop'), false);
    f.server.clearIdleShutdownTimer();
  });

  await check('a live reconnect obtains reader responsibility before final admission closes', async () => {
    const f = fixture();
    const { session, transport } = await f.create();
    f.socket.destroyed = true;
    f.server.cleanupSocket(f.socket);
    assert.equal(session.ownedExecution.snapshot().readerOutcome, 'pending');
    const next = f.addSocket();
    const read = await f.server.openTerminalRead(next, { sessionId: session.sessionId,
      authorityId: session.terminalAuthorityId, consumerId: 'editor' });
    await finish(f, session, transport);
    assert.equal(session.ownedExecution.snapshot().terminal.finalRevision, 0, 'empty output uses revision zero');
    await f.server.closeTerminalRead(next, read);
    assert.equal(session.ownedExecution.snapshot().readerOutcome, 'pending', 'legacy close is not final applied');
    assert.equal(f.server.executionOwner.snapshot().pending, 1);
    next.destroyed = true;
    f.server.cleanupSocket(next);
    await f.pump();
    assert.equal(session.ownedExecution.snapshot().readerOutcome, 'lost');
    assert.equal(f.server.executionOwner.snapshot().pending, 0);
    assert.ok(f.server.idleShutdownTimer, 'idle is checked again after owner retirement');
    f.server.clearIdleShutdownTimer();
    await f.server.deleteSession({ sessionId: session.sessionId });
    f.server.clearIdleShutdownTimer();
  });

  for (const interruption of ['socket cleanup', 'session replacement']) {
    await check(`reader opening rejects ${interruption} during checkpoint flush`, async () => {
      const f = fixture();
      const { session, transport } = await f.create();
      const openingSocket = interruption === 'socket cleanup' ? f.socket : f.addSocket();
      const reads = f.server.terminalReads.get(openingSocket);
      const entered = deferred();
      const gate = deferred();
      const originalFlush = session.terminalStateTracker.flushValidatedCheckpoint.bind(session.terminalStateTracker);
      session.terminalStateTracker.flushValidatedCheckpoint = async (...args) => {
        entered.resolve();
        await gate.promise;
        return originalFlush(...args);
      };
      const opening = f.server.openTerminalRead(openingSocket, { sessionId: session.sessionId,
        authorityId: session.terminalAuthorityId, consumerId: 'editor' });
      const rejected = assert.rejects(opening,
        interruption === 'socket cleanup' ? /reader connection/u : /replaced execution/u);
      await entered.promise;
      const replacement = { ...session, output: 'replacement' };
      if (interruption === 'socket cleanup') {
        // Error cleanup can remove the connection maps before socket.destroyed changes.
        f.server.cleanupSocket(openingSocket);
      } else {
        f.server.sessions.set(session.sessionId, replacement);
      }
      gate.resolve();
      await rejected;
      assert.equal(reads.size, 0, 'an invalidated open must not publish a cursor');
      assert.equal(session.ownedReaderSockets.has(openingSocket), false,
        'an invalidated open must not reacquire reader responsibility');
      if (interruption === 'session replacement') {
        assert.equal(f.server.sessions.get(session.sessionId), replacement);
        assert.equal(replacement.output, 'replacement');
        f.server.sessions.set(session.sessionId, session);
        f.server.cleanupSocket(f.socket);
      }
      await finish(f, session, transport);
      assert.equal(session.ownedExecution.snapshot().readerOutcome, 'lost');
      assert.equal(f.server.executionOwner.snapshot().pending, 0);
      assert.equal(transport.sent.some(message => message.type === 'requestStop'), false);
      f.server.clearIdleShutdownTimer();
    });
  }

  await check('stop and delete preserve the paused consumer until actual settlement', async () => {
    const f = fixture();
    const { session, transport } = await f.create();
    const gate = deferred();
    const originalFlush = session.terminalStateTracker.flush.bind(session.terminalStateTracker);
    let paused = true;
    session.terminalStateTracker.flush = async () => { if (paused) await gate.promise; return originalFlush(); };
    transport.output('TAIL');
    await f.until(() => session.ownedExecution.snapshot().adapter.acceptedThrough === 1, 'tail accepted');
    f.server.stopSession({ sessionId: session.sessionId });
    const deleting = f.server.deleteSession({ sessionId: session.sessionId });
    await f.pump();
    assert.equal(transport.sent.filter(message => message.type === 'requestStop').length, 1);
    assert.equal(f.server.sessions.get(session.sessionId), session);
    transport.process({ kind: 'signaled', signal: 'SIGTERM' });
    transport.seal();
    transport.release();
    await f.pump();
    assert.equal(f.server.sessions.get(session.sessionId), session);
    paused = false;
    gate.resolve();
    await deleting;
    assert.equal(session.output, 'TAIL');
    assert.equal(session.ownedExecution.snapshot().settled, true);
    assert.equal(f.server.sessions.has(session.sessionId), false);
  });

  await check('failed final flush retains responsibility and prevents new acquisition', async () => {
    const f = fixture();
    const { session, transport } = await f.create();
    const second = await f.create();
    session.terminalStateTracker.flush = async () => { throw new Error('injected parser failure'); };
    transport.process();
    transport.seal();
    transport.release();
    await f.until(() => session.ownedExecution.snapshot().terminal?.kind === 'failed', 'honest final failure');
    assert.equal(session.lifecycle, 'error');
    assert.equal(session.ownedExecution.snapshot().settled, false);
    await assert.rejects(f.server.createSession(f.socket, params('40000000-0000-4000-8000-000000000099')), /admission/u);
    assert.equal(f.transports.length, 2);
    second.transport.output('independent');
    await f.until(() => second.session.ownedExecution.snapshot().adapter.acceptedThrough === 1, 'second execution accepted');
    await finish(f, second.session, second.transport);
    assert.equal(second.session.output, 'independent');
    await f.server.deleteSession({ sessionId: second.session.sessionId });
    const closing = f.server.prepareForShutdown('failed parser');
    await f.advance(40);
    assert.equal((await closing).kind, 'unconfirmed');
    assert.equal(f.server.executionOwner.snapshot().pending, 1);
  });

  await check('late finalization cannot overwrite a replacement mapping', async () => {
    const f = fixture();
    const { session, transport } = await f.create();
    const replacement = { ...session, live: true, lifecycle: 'live', output: 'replacement' };
    f.server.sessions.set(session.sessionId, replacement);
    transport.output('old tail');
    await f.until(() => session.ownedExecution.snapshot().adapter.acceptedThrough === 1, 'old tail accepted');
    await finish(f, session, transport);
    assert.equal(session.output, 'old tail');
    assert.equal(replacement.output, 'replacement');
    assert.equal(replacement.live, true);
    assert.equal(replacement.lifecycle, 'live');
    assert.equal(f.server.sessions.get(session.sessionId), replacement);
    session.ownedExecution.settleReaders('cancelled');
  });

  await checkReader('editor and panel on one socket settle independently, including final revision zero', async () => {
    const f = fixture(readerCapabilities);
    const { session, transport } = await f.create();
    const editor = await openReader(f, session, 'editor');
    const panel = await openReader(f, session, 'panel');
    assert.equal(session.ownedReaders.size, 2);
    assert.equal((await closeReader(f, editor, { kind: 'applied', finalRevision: 0 })).ok, false,
      'a checkpoint revision is not a fixed execution final revision');
    await finish(f, session, transport);
    assert.equal(session.ownedExecution.snapshot().terminal.finalRevision, 0);
    assertSettlement(await closeReader(f, editor, { kind: 'applied', finalRevision: 0 }), 'recorded');
    assert.equal(session.ownedReaderResults.applied, 1);
    assert.equal(session.ownedReaders.size, 1);
    assert.equal(session.ownedExecution.snapshot().readerOutcome, 'pending');
    assert.equal(f.server.executionOwner.snapshot().pending, 1);
    assertSettlement(await closeReader(f, panel, { kind: 'cancelled', reason: 'surface disposed' }), 'recorded');
    assert.equal(session.ownedReaderResults.cancelled, 1);
    assert.equal(session.ownedReaders.size, 0);
    assert.equal(session.ownedExecution.snapshot().readerOutcome, 'settled');
    assert.equal(f.server.executionOwner.snapshot().pending, 0);
    assertSettlement(await closeReader(f, editor, { kind: 'applied', finalRevision: 0 }), 'duplicate');
    assert.equal(session.ownedReaderResults.applied, 1, 'duplicate does not count twice');
  });

  await checkReader('applied requires the exact fixed final revision to have been sent on that reader', async () => {
    const f = fixture(readerCapabilities);
    const { session, transport } = await f.create();
    const read = await openReader(f, session);
    transport.output('final-tail');
    await f.until(() => session.ownedExecution.snapshot().adapter.consumedThrough === 1, 'final tail consumed');
    await finish(f, session, transport);
    for (const finalRevision of [0, 1, 2]) {
      assert.equal((await closeReader(f, read, { kind: 'applied', finalRevision })).ok, false,
        `unsent or non-final revision ${finalRevision} must be rejected`);
    }
    assert.equal(session.ownedReaderResults.applied, 0);
    const page = await request(f, f.socket, 'readTerminalPage', { ...read, afterRevision: 0 });
    assert.equal(page.ok, true, JSON.stringify(page));
    assert.equal(page.result.revision, 1);
    assertSettlement(await closeReader(f, read, { kind: 'applied', finalRevision: 1 }), 'recorded');
    assert.equal(session.ownedReaderResults.applied, 1);
  });

  await checkReader('wrong identity, foreign socket and conflicting results never settle the original reader', async () => {
    const f = fixture(readerCapabilities);
    const { session, transport } = await f.create();
    const read = await openReader(f, session);
    await finish(f, session, transport);
    const applied = { kind: 'applied', finalRevision: 0 };
    assert.equal((await closeReader(f, read, applied, f.socket, { authorityId: 'wrong-authority' })).ok, false);
    assertSettlement(await closeReader(f, read, applied, f.socket, { sessionId: 'wrong-session' }), 'unconfirmed');
    assertSettlement(await closeReader(f, read, applied, f.addSocket()), 'unconfirmed');
    assert.equal((await closeReader(f, read, { kind: 'cancelled', reason: '' })).ok, false);
    assert.equal(session.ownedReaders.size, 1);
    assert.equal(session.ownedReaderResults.applied, 0);
    assertSettlement(await closeReader(f, read, applied), 'recorded');
    assert.equal((await closeReader(f, read, { kind: 'cancelled', reason: 'conflicting retry' })).ok, false);
    assert.equal((await closeReader(f, read, { kind: 'applied', finalRevision: 1 })).ok, false);
    assert.equal(session.ownedReaderResults.applied, 1);
    assert.equal(session.ownedReaderResults.cancelled, 0);
  });

  await checkReader('same result remains idempotent after session deletion but expires after sixty seconds', async () => {
    const f = fixture(readerCapabilities);
    const { session, transport } = await f.create();
    const read = await openReader(f, session);
    const outcome = { kind: 'applied', finalRevision: 0 };
    await finish(f, session, transport);
    assertSettlement(await closeReader(f, read, outcome), 'recorded');
    await f.server.deleteSession({ sessionId: session.sessionId });
    assert.equal(f.server.sessions.has(session.sessionId), false);
    assertSettlement(await closeReader(f, read, outcome), 'duplicate');
    await f.advance(60001);
    assertSettlement(await closeReader(f, read, outcome), 'unconfirmed');
    assert.equal(session.ownedReaderResults.applied, 1);
    f.server.clearIdleShutdownTimer();
  });

  await checkReader('per-socket retention keeps only 128 recent results without rewriting older outcomes', async () => {
    const f = fixture(readerCapabilities);
    const { session, transport } = await f.create();
    const reads = [];
    const outcome = { kind: 'cancelled', reason: 'bounded retention fixture' };
    for (let index = 0; index < 129; index++) {
      const read = await openReader(f, session);
      reads.push(read);
      assertSettlement(await closeReader(f, read, outcome), 'recorded');
    }
    assert.equal(session.ownedReaderResults.cancelled, 129);
    assertSettlement(await closeReader(f, reads[0], outcome), 'unconfirmed');
    assertSettlement(await closeReader(f, reads.at(-1), outcome), 'duplicate');
    assert.equal(session.ownedReaderResults.cancelled, 129);
    await finish(f, session, transport);
    assert.equal(session.ownedExecution.snapshot().readerOutcome, 'settled');
  });

  await checkReader('the 129th pending reader is rejected without evicting admitted opens', async () => {
    const f = fixture(readerCapabilities);
    const { session, transport } = await f.create();
    const gate = deferred();
    session.terminalOperationChain = session.terminalOperationChain.then(() => gate.promise);
    const sockets = [];
    const openings = [];
    for (let index = 0; index < 128; index++) {
      const socket = f.addSocket();
      sockets.push(socket);
      openings.push(openReader(f, session, 'editor', socket));
    }
    assert.equal(session.ownedReaders.size, 128);
    const rejected = await request(f, f.addSocket(), 'openTerminalRead', {
      sessionId: session.sessionId, authorityId: session.terminalAuthorityId,
      consumerId: 'editor', settlementMode: 'final-application-v1'
    });
    assert.equal(rejected.ok, false);
    assert.equal(session.ownedReaders.size, 128);
    assert.equal(session.ownedReaderResults.cancelled, 0);
    assert.equal(session.ownedReaderResults.lost, 0);
    gate.resolve();
    const reads = await Promise.all(openings);
    for (let index = 0; index < reads.length; index++) {
      assertSettlement(await closeReader(f, reads[index], { kind: 'cancelled', reason: 'capacity fixture complete' },
        sockets[index]), 'recorded');
    }
    await finish(f, session, transport);
    assert.equal(session.ownedReaderResults.cancelled, 128);
    assert.equal(session.ownedExecution.snapshot().readerOutcome, 'settled');
  });

  await checkReader('socket write backpressure still counts as submitted response evidence', async () => {
    const f = fixture(readerCapabilities);
    const { session, transport } = await f.create();
    const write = f.socket.write.bind(f.socket);
    f.socket.write = line => { write(line); return false; };
    const read = await openReader(f, session);
    await finish(f, session, transport);
    assertSettlement(await closeReader(f, read, { kind: 'applied', finalRevision: 0 }), 'recorded');
    assert.equal(session.ownedReaderResults.applied, 1);
  });

  await checkReader('legacy close is only legacy-released and cannot claim applied', async () => {
    const f = fixture(readerCapabilities);
    const { session, transport } = await f.create();
    const read = await openReader(f, session, 'editor', f.socket, false);
    await finish(f, session, transport);
    assert.equal((await closeReader(f, read, { kind: 'applied', finalRevision: 0 })).ok, false,
      'server capability cannot replace reader opt-in');
    const closed = await closeReader(f, read);
    assertSettlement(closed, 'recorded');
    assert.equal(session.ownedReaderResults['legacy-released'], 1);
    assert.equal(session.ownedReaderResults.applied, 0);
    assert.equal(session.ownedExecution.snapshot().readerOutcome, 'settled');
  });

  await checkReader('a replacement receipt cannot grant settlement capability to the legacy reader', async () => {
    const f = fixture(readerCapabilities);
    const { session, transport } = await f.create();
    const legacy = await openReader(f, session, 'editor', f.socket, false);
    const next = await openReader(f, session);
    assert.equal(session.ownedReaderResults.cancelled, 1);
    const retry = await closeReader(f, legacy, { kind: 'cancelled', reason: 'reader-replaced' });
    assert.equal(retry.ok, false, 'matching automatic cancellation is not an opt-in handshake');
    assert.equal(session.ownedReaders.size, 1);
    assert.equal(session.ownedReaderResults.cancelled, 1);
    await finish(f, session, transport);
    assertSettlement(await closeReader(f, next, { kind: 'applied', finalRevision: 0 }), 'recorded');
    assert.equal(session.ownedReaderResults.applied, 1);
  });

  await checkReader('missing receiver capability rejects opt-in and explicit outcomes while preserving legacy close', async () => {
    const f = fixture();
    const { session, transport } = await f.create();
    const opening = await request(f, f.socket, 'openTerminalRead', {
      sessionId: session.sessionId, authorityId: session.terminalAuthorityId,
      consumerId: 'editor', settlementMode: 'final-application-v1'
    });
    assert.equal(opening.ok, false);
    const read = await openReader(f, session, 'editor', f.socket, false);
    await finish(f, session, transport);
    assert.equal((await closeReader(f, read, { kind: 'applied', finalRevision: 0 })).ok, false);
    const closed = await closeReader(f, read);
    assert.equal(closed.ok, true);
    assert.deepEqual(closed.result, { ok: true });
    assert.equal(session.ownedExecution.snapshot().readerOutcome, 'pending');
    f.server.cleanupSocket(f.socket);
    assert.equal(session.ownedExecution.snapshot().readerOutcome, 'lost');
  });

  await checkReader('same-surface replacement cancels one reader and disconnect loses each remaining reader', async () => {
    const f = fixture(readerCapabilities);
    const { session, transport } = await f.create();
    const first = await openReader(f, session);
    await openReader(f, session, 'panel');
    const next = await openReader(f, session);
    assert.notEqual(first.readId, next.readId);
    assert.equal(session.ownedReaderResults.cancelled, 1);
    assert.equal(session.ownedReaders.size, 2);
    assert.equal(f.server.terminalReads.get(f.socket).has(first.readId), false);
    f.server.cleanupSocket(f.socket);
    assert.equal(session.ownedReaderResults.lost, 2);
    assert.equal(session.ownedReaders.size, 0);
    await finish(f, session, transport);
    assert.equal(session.ownedExecution.snapshot().readerOutcome, 'settled');
    assert.equal(transport.sent.some(message => message.type === 'requestStop'), false);
    f.server.clearIdleShutdownTimer();
  });

  await checkReader('open admitted while final flush is blocked remains owned after reader admission closes', async () => {
    const f = fixture(readerCapabilities);
    const { session, transport } = await f.create();
    const entered = deferred();
    const gate = deferred();
    const flush = session.terminalStateTracker.flush.bind(session.terminalStateTracker);
    session.terminalStateTracker.flush = async () => { entered.resolve(); await gate.promise; return flush(); };
    transport.process();
    transport.seal();
    transport.release();
    await f.until(() => session.ownedExecution.snapshot().adapter.seal !== undefined, 'seal before final flush');
    await entered.promise;
    const opening = openReader(f, session);
    assert.equal(session.ownedReaders.size, 1, 'queued open is registered synchronously before finalization');
    gate.resolve();
    const read = await opening;
    assert.equal(session.ownedReaderAdmissionOpen, false);
    assert.equal(session.ownedExecution.snapshot().readerOutcome, 'pending');
    assert.equal(session.ownedReaders.size, 1);
    assertSettlement(await closeReader(f, read, { kind: 'applied', finalRevision: 0 }), 'recorded');
    assert.equal(session.ownedExecution.snapshot().readerOutcome, 'settled');
  });

  for (const preserveTerminalReads of [true, false]) {
    await checkReader(`queued admitted open ${preserveTerminalReads ? 'survives preserving' : 'is cancelled by non-preserving'} deletion`, async () => {
      const f = fixture(readerCapabilities);
      const { session, transport } = await f.create();
      const flushEntered = deferred();
      const flushGate = deferred();
      const queueGate = deferred();
      const flush = session.terminalStateTracker.flush.bind(session.terminalStateTracker);
      session.terminalStateTracker.flush = async () => { flushEntered.resolve(); await flushGate.promise; return flush(); };
      transport.process();
      transport.seal();
      transport.release();
      await f.until(() => session.ownedExecution.snapshot().adapter.seal !== undefined, 'retirement seal');
      await flushEntered.promise;
      session.terminalOperationChain = session.terminalOperationChain.then(() => queueGate.promise);
      const opening = request(f, f.socket, 'openTerminalRead', {
        sessionId: session.sessionId, authorityId: session.terminalAuthorityId,
        consumerId: 'editor', settlementMode: 'final-application-v1'
      });
      assert.equal(session.ownedReaders.size, 1);
      flushGate.resolve();
      await f.until(() => session.live === false, 'finalization before pending open dequeues');
      const deleting = f.server.deleteSession({ sessionId: session.sessionId, preserveTerminalReads });
      assert.equal(session.retiring, true);
      assert.equal(session.ownedReaders.size, preserveTerminalReads ? 1 : 0);
      queueGate.resolve();
      const response = await opening;
      await deleting;
      assert.equal(response.ok, preserveTerminalReads, JSON.stringify(response));
      if (preserveTerminalReads) {
        assert.equal(f.server.sessions.get(session.sessionId), session);
        assert.equal(session.ownedExecution.snapshot().readerOutcome, 'pending');
        assertSettlement(await closeReader(f, response.result, { kind: 'applied', finalRevision: 0 }), 'recorded');
        assert.equal(session.ownedReaderResults.applied, 1);
      } else {
        assert.equal(session.ownedReaderResults.cancelled, 1);
        assert.equal(session.ownedReaderResults.applied, 0);
      }
      await f.until(() => !f.server.sessions.has(session.sessionId), 'reader settlement completes retirement');
      assert.equal(session.ownedExecution.snapshot().readerOutcome, 'settled');
      f.server.clearIdleShutdownTimer();
    });
  }

  await checkReader('a prepared open reply is not sent evidence until handleRequest writes it', async () => {
    const f = fixture(readerCapabilities);
    const { session, transport } = await f.create();
    const entered = deferred();
    const gate = deferred();
    const open = f.server.openTerminalRead.bind(f.server);
    let descriptor;
    f.server.openTerminalRead = async (...args) => {
      descriptor = await open(...args);
      entered.resolve();
      await gate.promise;
      return descriptor;
    };
    const opening = openReader(f, session);
    await entered.promise;
    await finish(f, session, transport);
    const prematurePage = await request(f, f.socket, 'readTerminalPage', { ...descriptor, afterRevision: 0 });
    assert.equal(prematurePage.ok, false, 'an unsent open checkpoint cannot be skipped with an empty page');
    assert.equal((await closeReader(f, descriptor, { kind: 'applied', finalRevision: 0 })).ok, false);
    assert.equal(session.ownedExecution.snapshot().readerOutcome, 'pending');
    gate.resolve();
    const read = await opening;
    assertSettlement(await closeReader(f, read, { kind: 'applied', finalRevision: 0 }), 'recorded');
  });

  await checkReader('a prepared page reply cannot advance sent evidence before handleRequest writes it', async () => {
    const f = fixture(readerCapabilities);
    const { session, transport } = await f.create();
    const read = await openReader(f, session);
    transport.output('reply-tail');
    await f.until(() => session.ownedExecution.snapshot().adapter.consumedThrough === 1, 'reply tail consumed');
    await finish(f, session, transport);
    const entered = deferred();
    const gate = deferred();
    const readPage = f.server.readTerminalPage.bind(f.server);
    f.server.readTerminalPage = async (...args) => {
      const result = await readPage(...args);
      entered.resolve();
      await gate.promise;
      return result;
    };
    const reading = request(f, f.socket, 'readTerminalPage', { ...read, afterRevision: 0 });
    await entered.promise;
    assert.equal((await closeReader(f, read, { kind: 'applied', finalRevision: 1 })).ok, false);
    assert.equal(session.ownedReaderResults.applied, 0);
    assert.equal(session.ownedExecution.snapshot().readerOutcome, 'pending');
    gate.resolve();
    const page = await reading;
    assert.equal(page.ok, true, JSON.stringify(page));
    assert.equal(page.result.revision, 1);
    assertSettlement(await closeReader(f, read, { kind: 'applied', finalRevision: 1 }), 'recorded');
  });

  for (const failure of ['throw once', 'destroy connection']) {
    await checkReader(`response write ${failure} records loss without applied evidence`, async () => {
      const f = fixture(readerCapabilities);
      const { session, transport } = await f.create();
      const write = f.socket.write.bind(f.socket);
      let attempted;
      f.socket.write = line => {
        const message = JSON.parse(line);
        if (!attempted && message.type === 'response' && message.ok && message.result.readId) {
          attempted = message.result;
          if (failure === 'throw once') throw new Error('controlled response write failure');
          write(line);
          f.socket.destroyed = true;
          f.server.cleanupSocket(f.socket);
          return false;
        }
        return write(line);
      };
      const opening = await request(f, f.socket, 'openTerminalRead', {
        sessionId: session.sessionId, authorityId: session.terminalAuthorityId,
        consumerId: 'editor', settlementMode: 'final-application-v1'
      });
      assert.ok(attempted, 'the failure occurs at response submission, after the actual open');
      if (failure === 'throw once') assert.equal(opening.ok, false);
      assert.equal(session.ownedReaders.size, 0);
      assert.equal(session.ownedReaderResults.lost, 1);
      assert.equal(session.ownedReaderResults.applied, 0);
      await finish(f, session, transport);
      if (failure === 'throw once') {
        assert.equal((await closeReader(f, attempted, { kind: 'applied', finalRevision: 0 })).ok, false);
      } else {
        assertSettlement(await closeReader(f, attempted, { kind: 'applied', finalRevision: 0 }, f.addSocket()), 'unconfirmed');
      }
      assert.equal(session.ownedReaderResults.applied, 0);
      assert.equal(session.ownedExecution.snapshot().readerOutcome, 'settled');
      f.server.clearIdleShutdownTimer();
    });
  }

  for (const interruption of ['close', 'replace']) {
    await checkReader(`page waiting for journal output rejects reader ${interruption}`, async () => {
      const f = fixture(readerCapabilities);
      const { session, transport } = await f.create();
      const read = await openReader(f, session);
      transport.output('page-tail');
      await f.until(() => session.ownedExecution.snapshot().adapter.consumedThrough === 1, 'page output consumed');
      const entered = deferred();
      const gate = deferred();
      const pages = session.terminalJournal.readEventPagesAfter.bind(session.terminalJournal);
      session.terminalJournal.readEventPagesAfter = async function* (...args) {
        entered.resolve();
        await gate.promise;
        yield* pages(...args);
      };
      const reading = request(f, f.socket, 'readTerminalPage', { ...read, afterRevision: 0 });
      await entered.promise;
      let replacing;
      if (interruption === 'close') {
        assertSettlement(await closeReader(f, read, { kind: 'cancelled', reason: 'surface disposed' }), 'recorded');
      } else {
        replacing = openReader(f, session);
        assert.equal(session.ownedReaderResults.cancelled, 1, 'replacement cancels at admission, not after page completion');
      }
      gate.resolve();
      const page = await reading;
      assert.equal(page.ok, false, 'invalidated in-flight page cannot publish sent evidence');
      if (replacing) {
        const next = await replacing;
        assertSettlement(await closeReader(f, next, { kind: 'cancelled', reason: 'replacement cleanup' }), 'recorded');
      }
      await finish(f, session, transport);
      assert.equal(session.ownedExecution.snapshot().readerOutcome, 'settled');
    });
  }

  await checkReader('hello, session and open each advertise only their actual settlement capability', async () => {
    const legacy = fixture();
    const legacyHello = await request(legacy, legacy.socket, 'hello');
    assert.equal(legacyHello.result.capabilities.terminalReadSettlementV1, undefined);
    const old = await legacy.create();
    assert.equal(old.result.capabilities, undefined);
    await finish(legacy, old.session, old.transport);
    assert.equal(legacy.server.toSnapshot(old.session).terminalFinalRevision, undefined);

    const f = fixture(readerCapabilities);
    const greeting = await request(f, f.socket, 'hello');
    assert.equal(greeting.result.capabilities.terminalReadSettlementV1, true);
    const { session, transport, result } = await f.create();
    assert.equal(result.capabilities.terminalReadSettlementV1, true);
    assert.equal(result.terminalFinalRevision, undefined);
    assert.equal(f.server.toSnapshot({ ...session, ownedReaders: undefined }).capabilities, undefined,
      'server support must not upgrade a session without a reader owner');
    const plain = await openReader(f, session, 'panel', f.socket, false);
    assert.equal(plain.settlementMode, undefined);
    const opted = await openReader(f, session);
    assert.equal(opted.settlementMode, 'final-application-v1');
    await finish(f, session, transport);
    assert.equal(f.server.toSnapshot(session).terminalFinalRevision, 0);
    assertSettlement(await closeReader(f, opted, { kind: 'applied', finalRevision: 0 }), 'recorded');
    assertSettlement(await closeReader(f, plain), 'recorded');
  });

  await checkReader('final revision notification waits for the actual final tracker flush', async () => {
    const f = fixture(readerCapabilities);
    const { session, transport } = await f.create();
    const read = await openReader(f, session);
    transport.output('advertised-tail');
    await f.until(() => session.ownedExecution.snapshot().adapter.consumedThrough === 1, 'notification tail consumed');
    const entered = deferred();
    const gate = deferred();
    const flush = session.terminalStateTracker.flush.bind(session.terminalStateTracker);
    session.terminalStateTracker.flush = async () => { entered.resolve(); await gate.promise; return flush(); };
    transport.process();
    transport.seal();
    transport.release();
    await f.until(() => session.ownedExecution.snapshot().adapter.seal !== undefined, 'notification seal');
    await entered.promise;
    assert.equal(f.server.toSnapshot(session).terminalFinalRevision, undefined);
    gate.resolve();
    await f.until(() => session.ownedExecution.snapshot().settled, 'notification final flush');
    const notifications = f.socket.messages.filter(message => message.type === 'event' &&
      message.event === 'sessionState' && message.payload.sessionId === session.sessionId && !message.payload.live);
    assert.equal(notifications.at(-1).payload.terminalFinalRevision, 1);
    assert.equal(notifications.at(-1).payload.capabilities.terminalReadSettlementV1, true);
    await closeReader(f, read, { kind: 'cancelled', reason: 'notification fixture complete' });
  });

  await checkReader('failed authority finalization never advertises a final applied revision', async () => {
    const f = fixture(readerCapabilities);
    const { session, transport } = await f.create();
    session.terminalStateTracker.flush = async () => { throw new Error('controlled final tracker failure'); };
    transport.process();
    transport.seal();
    transport.release();
    await f.until(() => session.ownedExecution.snapshot().terminal?.kind === 'failed', 'failed authority result');
    const snapshot = f.server.toSnapshot(session);
    assert.equal(snapshot.live, false);
    assert.equal(snapshot.lifecycle, 'error');
    assert.equal(snapshot.terminalRevision, 0);
    assert.equal(snapshot.terminalFinalRevision, undefined, 'live=false and head revision do not prove final application');
  });

  const closeObservationCapabilities = [...readerCapabilities, 'execution-close-observation-v1'];
  for (const kind of ['terminal', 'agent']) {
    await check(`${kind} real Supervisor natural close keeps first timeout separate from late tracker and reader settlement`, async () => {
      const f = fixture(closeObservationCapabilities, { budgets: { naturalDrainMs: 15 }, holdCloseAck: true });
      const { session, transport } = await f.create(kind);
      const read = await openReader(f, session);
      transport.process();
      const initial = session.ownedExecution.snapshot().closeObservation;
      assert.equal(initial.trigger, 'natural-exit');
      assert.equal(initial.startedAt, 0);
      assert.equal(initial.cancelAt, 15);
      assert.equal(initial.finishAt, 35);
      assert.equal(initial.forceAt, undefined);
      transport.output(`${kind}-observed-supervisor-tail`);
      await f.until(() => session.ownedExecution.snapshot().adapter.consumedThrough === 1, `${kind} observed tracker consumption`);
      assert.match(session.terminalStateTracker.getSerializedState().data, new RegExp(`${kind}-observed-supervisor-tail`));
      await f.advance(15);
      assert.equal(transport.sent.filter(message => message.type === 'cancelOutput').length, 1);
      assert.equal(transport.sent.filter(message => message.type === 'requestStop').length, 0);
      assert.equal(session.ownedExecution.snapshot().adapter.source, undefined);
      assert.equal(session.ownedExecution.snapshot().closeObservation.first, undefined);
      const cancel = transport.sent.find(message => message.type === 'cancelOutput');
      const cancelObservation = session.ownedExecution.execution.operations.get('cancel').view;
      let cancelFirst;
      void cancelObservation.first.then(result => { cancelFirst = result; });
      f.elapse(20);
      transport.fact({ type: 'operationObservation', operationId: cancel.operationId, result: { kind: 'accepted' } });
      await f.until(() => cancelFirst !== undefined, 'actual adapter late cancel first result');
      assert.equal(cancelFirst.kind, 'unconfirmed', 'Supervisor owner capability must enable the actual adapter deadline policy');
      assert.equal(cancelObservation.current.kind, 'accepted');
      const timedOut = session.ownedExecution.snapshot().closeObservation;
      assert.deepEqual(timedOut.first, { kind: 'unconfirmed', pending: [session.sessionId] });
      assert.equal(timedOut.current.kind, 'unconfirmed');
      assert.ok(timedOut.pendingDomains.includes('source'));
      assert.ok(timedOut.pendingDomains.includes('resources'));
      const stop = await request(f, f.socket, 'stopSession', { sessionId: session.sessionId });
      assert.equal(stop.ok, true, 'Supervisor stop RPC acknowledges the request, not completed resource cleanup');
      assert.equal(session.ownedExecution.snapshot().closeObservation.finishAt, initial.finishAt);
      transport.seal({ kind: 'interrupted', reason: 'controlled natural drain cancellation' });
      transport.release();
      await f.until(() => session.ownedExecution.snapshot().settled, `${kind} late original Supervisor completion`);
      const late = session.ownedExecution.snapshot();
      assert.deepEqual(late.closeObservation.first, timedOut.first);
      assert.equal(late.closeObservation.current.kind, 'settled');
      assert.equal((await cancelObservation.first).kind, 'unconfirmed');
      assert.deepEqual(late.closeObservation.pendingDomains, []);
      assert.equal(late.adapter.source.kind, 'interrupted');
      assert.equal(late.terminal.finalRevision, 1);
      assert.equal(late.readerOutcome, 'pending');
      assert.equal(late.retired, false);
      assert.equal(f.server.executionOwner.snapshot().pending, 1);
      assert.equal(f.server.idleShutdownTimer, undefined);
      assert.ok(f.server.executionOwner.snapshot().blockedReason);
      assertSettlement(await closeReader(f, read, { kind: 'cancelled', reason: 'observed reader cleanup' }), 'recorded');
      assert.equal(session.ownedExecution.snapshot().retired, true);
      assert.equal(f.server.executionOwner.snapshot().pending, 0);
      assert.equal(f.server.executionOwner.tryResume(), false);
      assert.equal(transport.sent.filter(message => message.type === 'requestStop').length, 0);
      assert.equal(transport.sent.filter(message => message.type === 'cancelOutput').length, 1);
    });
  }

  await check('real Supervisor delete retains a timed-out final flush and retires only after late actual completion', async () => {
    const f = fixture(closeObservationCapabilities, { budgets: { naturalDrainMs: 15 } });
    const { session, transport } = await f.create();
    await openReader(f, session);
    transport.output('delete-observed-tail');
    await f.until(() => session.ownedExecution.snapshot().adapter.consumedThrough === 1, 'delete observed tail consumption');
    const gate = deferred();
    const flush = session.terminalStateTracker.flush.bind(session.terminalStateTracker);
    let finalFlushEntered = false;
    let finalState;
    session.terminalStateTracker.flush = async () => {
      finalFlushEntered = true;
      await gate.promise;
      finalState = await flush();
      return finalState;
    };
    try {
      const deleting = request(f, f.socket, 'deleteSession', { sessionId: session.sessionId });
      let response;
      void deleting.then(result => { response = result; });
      await f.until(() => transport.sent.some(message => message.type === 'requestStop'), 'delete observed graceful request');
      transport.process();
      transport.seal();
      transport.release();
      await f.until(() => finalFlushEntered, 'actual delete final tracker flush');
      assert.equal(session.ownedExecution.snapshot().closeObservation.trigger, 'stop');
      assert.equal(session.ownedExecution.snapshot().closeObservation.finishAt, 40);
      assert.equal(session.ownedExecution.snapshot().readerOutcome, 'settled');
      await f.advance(40);
      await f.until(() => response !== undefined, 'delete first timeout response');
      assert.equal(response.ok, false);
      const first = session.ownedExecution.snapshot().closeObservation.first;
      assert.deepEqual(first, { kind: 'unconfirmed', pending: [session.sessionId] });
      assert.ok(session.ownedExecution.snapshot().closeObservation.pendingDomains.includes('final-flush'));
      assert.equal(session.ownedExecution.snapshot().terminal, undefined);
      assert.equal(f.server.sessions.get(session.sessionId), session);
      assert.equal(f.server.executionOwner.snapshot().pending, 1);
      assert.equal(f.server.idleShutdownTimer, undefined);
      gate.resolve();
      await f.until(() => !f.server.sessions.has(session.sessionId), 'late actual delete tracker completion');
      assert.equal(finalState.outputSequence, 1);
      assert.match(finalState.data, /delete-observed-tail/);
      assert.deepEqual(session.ownedExecution.snapshot().closeObservation.first, first);
      assert.equal(session.ownedExecution.snapshot().closeObservation.current.kind, 'settled');
      assert.equal(f.server.executionOwner.snapshot().pending, 0);
      assert.ok(f.server.executionOwner.snapshot().blockedReason);
      assert.equal(f.server.executionOwner.tryResume(), false);
      assert.equal(transport.sent.filter(message => message.type === 'requestStop').length, 1);
      assert.equal(transport.sent.filter(message => message.type === 'cancelOutput').length, 0);
    } finally { gate.resolve(); }
  });

  await check('real Supervisor without close observation capability keeps natural-exit timers disabled', async () => {
    const f = fixture();
    const { session, transport } = await f.create();
    transport.process();
    await f.advance(1000);
    assert.equal(session.ownedExecution.snapshot().closeObservation, undefined);
    assert.equal(transport.sent.some(message => message.type === 'requestStop' || message.type === 'cancelOutput'), false);
    assert.equal(f.server.executionOwner.snapshot().blockedReason, undefined);
    transport.seal();
    transport.release();
    await f.until(() => session.ownedExecution.snapshot().settled, 'legacy Supervisor natural completion');
    session.ownedExecution.settleReaders('cancelled');
    assert.equal(f.server.executionOwner.snapshot().pending, 0);
  });

  assert.equal(forbiddenAcquisitions, 0);
  console.log(`Supervisor execution owner wiring: ${passed}/${passed} pure cases passed`);
} finally {
  for (const f of fixtures) {
    f.server.clearIdleShutdownTimer();
    for (const session of f.server.sessions.values()) {
      if (session.lifecycleTimer) clearTimeout(session.lifecycleTimer);
      await session.terminalJournal?.flush();
      session.terminalStateTracker.dispose();
    }
  }
  await rm(directory, { recursive: true, force: true });
}
