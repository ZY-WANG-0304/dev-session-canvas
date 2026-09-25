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
      budgets: { startMs: 100, gracefulMs: 10, forceMs: 10, cancelMs: 10, settleMs: 10 },
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
              tasks.push(() => this.fact({ type: 'operationObservation', operationId: message.operationId,
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
