import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
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
const processExits = [];
const compiled = { exports: {} };
const guardedRequire = (name) => {
  if (name === 'node-pty') { forbiddenAcquisitions++; assert.fail('No native loading is permitted'); }
  if (name === 'child_process' || name === 'node:child_process') {
    return { ...require(name), spawn() { forbiddenAcquisitions++; assert.fail('No child process is permitted'); },
      spawnSync() { forbiddenAcquisitions++; assert.fail('No synchronous child process is permitted'); } };
  }
  if (name === 'net' || name === 'node:net') {
    return { ...require(name), createServer() { forbiddenAcquisitions++; assert.fail('No real listener is permitted'); } };
  }
  return require(name);
};
guardedRequire.main = require.main;
new Function('module', 'exports', 'require', 'process', bundle.outputFiles[0].text)(compiled, compiled.exports, guardedRequire,
  { ...process, exit(code) { processExits.push(code); } });
const { RuntimeSupervisorServer, TerminalSessionJournal } = compiled.exports;
const lifecycleBundle = await esbuild.build({
  entryPoints: [path.resolve('extensions/vscode/dev-session-canvas/src/common/executionLifecycle.ts')],
  bundle: true, platform: 'node', format: 'cjs', write: false
});
const lifecycleModule = { exports: {} };
new Function('module', 'exports', 'require', lifecycleBundle.outputFiles[0].text)(
  lifecycleModule, lifecycleModule.exports, require);
const { encodeOutputFrame, EXECUTION_CANDIDATE_PROFILE, EXECUTION_CANDIDATE_BUDGETS } = lifecycleModule.exports;
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
      ...(behavior.profile ? { profile: behavior.profile, profileMode: behavior.profileMode ?? 'live-runtime' } : {}),
      budgets: { startMs: 100, gracefulMs: 10, forceMs: 10, cancelMs: 10, settleMs: 10, ...behavior.budgets },
      createTransport(identity) {
        const parentClosed = deferred();
        const cleanupResult = deferred();
        const transport = {
          identity, sent: [], frameId: 0, cleanupRequests: [], cleanupResult,
          connect(sink) {
            this.sink = sink;
            if (behavior.connectThrows) throw new Error('injected connect failure');
            if (!behavior.holdReady) sink.message({ type: 'ready', identity,
              capabilities: behavior.readyCapabilities ?? ['execution-lifecycle-v1'] });
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
            parentClosed.resolve({ kind: 'closed', exitCode: 0, signal: null });
          }
        };
        if (behavior.exposeParentControl) transport.parentControl = Object.freeze({
          identity, scheduler, expectedNativeResourceIds: Object.freeze(['subject']), closed: parentClosed.promise,
          terminate(budget) { transport.cleanupRequests.push(budget); return cleanupResult.promise; }
        });
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
      const result = await server.createSession(socket, { ...params(sessionId, kind),
        ...(behavior.profile ? { executionProfile: behavior.profile } : {}) });
      await this.pump();
      return { result, session: server.sessions.get(sessionId), transport: transports.at(-1) };
    }
  };
  fixtures.push(f);
  return f;

  function addSocket() {
    const socket = Object.assign(new EventEmitter(), {
      destroyed: false, messages: [], endCalls: 0,
      write(line) { this.messages.push(JSON.parse(line)); },
      end() { this.endCalls++; },
      destroy() { this.destroyed = true; this.emit('close'); }
    });
    socket.on('close', () => server.cleanupSocket(socket));
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
  for (const kind of ['terminal', 'agent']) {
    await check(`${kind} ordinary Supervisor consumption does not serialize terminal state`, async () => {
      const f = fixture();
      const { session, transport } = await f.create(kind);
      const addon = session.terminalStateTracker.serializeAddon;
      const serialize = addon.serialize.bind(addon);
      let serializations = 0;
      addon.serialize = (...args) => { serializations++; return serialize(...args); };
      for (let revision = 1; revision <= 3; revision++) {
        transport.output(`${kind}-drain-${revision}\r\n`);
        await f.until(() => session.ownedExecution.snapshot().adapter.consumedThrough === revision,
          `${kind} ordinary consumption ${revision}`);
        assert.equal(serializations, 0, 'ordinary consumer acknowledgement must not serialize the whole terminal.');
      }
      await finish(f, session, transport);
      assert.ok(serializations > 0, 'final application must still serialize terminal state.');
      assert.match(session.terminalStateTracker.getSerializedState().data, new RegExp(`${kind}-drain-3`));
    });
  }

  const candidateCapabilities = ['execution-lifecycle-v1', 'execution-close-observation-v1',
    'execution-parent-cleanup-v1', 'execution-owner-boundary-v1', 'terminal-read-settlement-v1', 'terminal-interaction-v1'];
  const candidateBehavior = { profile: EXECUTION_CANDIDATE_PROFILE, budgets: EXECUTION_CANDIDATE_BUDGETS,
    exposeParentControl: true, readyCapabilities: ['execution-lifecycle-v1', 'terminal-interaction-v1'] };

  await check('candidate factory and profile requirements reject before journal or execution acquisition', async () => {
    const original = TerminalSessionJournal.create;
    let journals = 0;
    TerminalSessionJournal.create = async () => { journals++; throw new Error('journal must not be reached'); };
    try {
      const f = fixture();
      const requested = { ...params('candidate-missing'), executionProfile: EXECUTION_CANDIDATE_PROFILE };
      await assert.rejects(f.server.createSession(f.socket, requested), /does not match/);
      await assert.rejects(f.server.createSession(f.socket, { ...requested, executionProfile: 'unknown-profile' }), /Unsupported/);
      const absent = new RuntimeSupervisorServer({ storageDir: directory }, 'legacy-detached', 'best-effort',
        undefined, EXECUTION_CANDIDATE_PROFILE);
      await assert.rejects(absent.createSession(f.socket, requested), /factory is unavailable/);
      assert.throws(() => new RuntimeSupervisorServer({ storageDir: directory }, 'legacy-detached', 'best-effort',
        undefined, 'unknown-profile'), /Unsupported/);
      const candidate = fixture(candidateCapabilities, candidateBehavior);
      await assert.rejects(candidate.server.createSession(candidate.socket, params('candidate-omitted')), /does not match/);
      assert.equal(candidate.transports.length, 0);
      assert.equal(candidate.server.executionOwner.snapshot().pending, 0);
      assert.equal(f.transports.length, 0);
      assert.equal(journals, 0);
    } finally { TerminalSessionJournal.create = original; }
  });

  await check('candidate hello advertises only complete matching live injection and legacy remains unchanged', async () => {
    for (const missing of candidateCapabilities) {
      assert.throws(() => fixture(candidateCapabilities.filter(capability => capability !== missing), candidateBehavior),
        /capabilities missing/);
    }
    assert.throws(() => fixture(candidateCapabilities, { ...candidateBehavior, profileMode: 'snapshot-only' }), /matching live-runtime/);
    const legacy = fixture();
    assert.equal((await request(legacy, legacy.socket, 'hello')).result.capabilities.executionCandidateProfiles, undefined);
    const absent = new RuntimeSupervisorServer({ storageDir: directory }, 'legacy-detached', 'best-effort',
      undefined, EXECUTION_CANDIDATE_PROFILE);
    assert.equal((await request({ server: absent }, legacy.socket, 'hello')).result.capabilities.executionCandidateProfiles, undefined);
    const f = fixture(candidateCapabilities, candidateBehavior);
    const hello = await request(f, f.socket, 'hello');
    assert.deepEqual(hello.result.capabilities.executionCandidateProfiles, [EXECUTION_CANDIDATE_PROFILE]);
    const { session, transport } = await f.create();
    assert.equal(session.process, undefined, 'controlled candidate must be owned by Supervisor, not legacy bridge');
    assert.equal(transport.sent.filter(message => message.type === 'start').length, 1);
    await finish(f, session, transport);
    session.ownedExecution.settleReaders('lost');
  });

  await check('candidate declaration cannot substitute provider ready interaction and control responsibility survives refusal', async () => {
    const f = fixture(candidateCapabilities, { ...candidateBehavior, readyCapabilities: ['execution-lifecycle-v1'] });
    await assert.rejects(f.create(), /Execution start was failed/);
    await f.pump();
    const transport = f.transports[0];
    const session = [...f.server.sessions.values()][0];
    assert.equal(transport.sent.filter(message => message.type === 'start').length, 0);
    assert.equal(session.live, false);
    assert.equal(session.lifecycle, 'error');
    assert.equal(session.ownedExecution.snapshot().retired, false);
    assert.equal(f.server.executionOwner.snapshot().pending, 1);
    await f.advance(11000);
    assert.equal(transport.cleanupRequests.length, 1);
    assert.equal(session.ownedExecution.snapshot().retired, false);
    transport.cleanupResult.resolve({ kind: 'closed', exitCode: 0, signal: null });
    transport.sink.controlResourceResult({ kind: 'released' });
    await f.pump();
    assert.equal(transport.sent.length, 0);
    assert.equal(session.ownedExecution.snapshot().adapter.state, 'settled');
  });

  await check('candidate Supervisor uses one twenty-second boundary and late cleanup cannot replace first', async () => {
    const f = fixture(candidateCapabilities, candidateBehavior);
    const { session, transport } = await f.create();
    const closing = f.server.prepareForShutdown('candidate boundary');
    assert.equal(f.server.shutdownBoundary.startedAt, 0);
    assert.equal(f.server.shutdownBoundary.deadline, 20000);
    assert.equal(session.ownedExecution.snapshot().closeObservation.finishAt, 13000);
    await f.advance(19000);
    assert.strictEqual(f.server.prepareForShutdown('repeated'), closing);
    assert.equal(f.server.shutdownBoundary.deadline, 20000);
    await f.advance(1000);
    const first = await closing;
    assert.equal(first.kind, 'unconfirmed');
    assert.equal(f.socket.endCalls, 0);
    await finish(f, session, transport);
    session.ownedExecution.settleReaders('lost');
    await f.pump();
    assert.strictEqual(await closing, first);
    assert.equal(first.kind, 'unconfirmed');
    assert.equal(f.socket.endCalls, 0, 'late settlement cannot authorize a new socket close beyond B');
  });

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
    await check(`${kind}: disk backlog holds consumption credit and finalization without blocking another session`, async () => {
      const f = fixture();
      const { session, transport } = await f.create(kind);
      const second = await f.create(kind);
      const journal = session.terminalJournal;
      const gate = deferred();
      let appendEntered = false;
      const originalAppend = fs.promises.appendFile;
      fs.promises.appendFile = async (file, ...args) => {
        if (path.dirname(String(file)) === journal.sessionDirectory) {
          appendEntered = true;
          await gate.promise;
        }
        return originalAppend(file, ...args);
      };
      try {
        for (let index = 0; index < 8; index++) transport.output(String(index));
        await f.until(() => appendEntered, 'actual journal append blocked');
        await f.pump();
        assert.equal(session.ownedExecution.snapshot().adapter.acceptedThrough, 8);
        assert.equal(session.ownedExecution.snapshot().adapter.consumedThrough, 0,
          'unpersisted output must still occupy the existing consumption window');
        assert.equal(transport.sent.some(message => message.type === 'consumed'), false);
        second.transport.output('independent');
        await f.until(() => second.session.ownedExecution.snapshot().adapter.consumedThrough === 1,
          'other session consumes while the first disk write is blocked');
        transport.process(); transport.seal(); transport.release();
        await f.pump();
        assert.equal(session.ownedExecution.snapshot().terminal, undefined);
        assert.equal(session.live, true);
        gate.resolve();
        await f.until(() => session.ownedExecution.snapshot().settled, 'disk backlog and final flush settled');
        assert.equal(session.ownedExecution.snapshot().adapter.consumedThrough, 8);
        assert.equal(session.ownedExecution.snapshot().terminal.finalRevision, 8);
        assert.equal(session.output, '01234567');
        const events = await journal.readAllEvents();
        assert.deepEqual(events.map(event => event.revision), [1, 2, 3, 4, 5, 6, 7, 8]);
        assert.equal(events.map(event => event.data).join(''), '01234567');
        await finish(f, second.session, second.transport);
      } finally {
        gate.resolve();
        fs.promises.appendFile = originalAppend;
        await journal.flush();
      }
    });

    for (const operation of ['appendOutput', 'flush']) {
      await check(`${kind}: failed journal ${operation} retains credit and live responsibility`, async () => {
        const f = fixture();
        const { session, transport } = await f.create(kind);
        const second = await f.create(kind);
        const journal = session.terminalJournal;
        const original = journal[operation];
        const failure = new Error(`injected journal ${operation} failure`);
        journal[operation] = operation === 'flush'
          ? async () => { throw failure; }
          : () => { throw failure; };
        try {
          transport.output('unsettled');
          await f.until(() => Boolean(session.ownedExecution.snapshot().adapter.authorityFailure),
            'failed journal retains authority responsibility');
          assert.strictEqual(session.terminalJournalError, failure);
          assert.equal(session.lifecycle, 'error');
          assert.equal(session.live, true, 'journal failure is not evidence that the process has exited');
          assert.equal(session.ownedExecution.snapshot().adapter.consumedThrough, 0);
          assert.equal(transport.sent.some(message => message.type === 'consumed'), false);
          assert.ok(transport.sent.some(message => message.type === 'requestStop'));
          assert.equal(session.ownedExecution.snapshot().settled, false);
          assert.notEqual(session.ownedExecution.snapshot().terminal?.kind, 'applied');
          second.transport.output('still independent');
          await f.until(() => second.session.ownedExecution.snapshot().adapter.consumedThrough === 1,
            'other existing session consumes after journal failure');
          await finish(f, second.session, second.transport);
        } finally { journal[operation] = original; }
      });
    }

    await check(`${kind}: seal cannot overtake paused consumption and later accepted batches`, async () => {
      const f = fixture();
      const { session, transport } = await f.create(kind);
      assert.equal(transport.identity.executionId, session.sessionId);
      const entered = deferred();
      const gate = deferred();
      const originalDrain = session.terminalStateTracker.drain.bind(session.terminalStateTracker);
      const originalFlush = session.terminalStateTracker.flush.bind(session.terminalStateTracker);
      let drainCalls = 0;
      let flushCalls = 0;
      session.terminalStateTracker.drain = async () => {
        if (++drainCalls === 1) { entered.resolve(); await gate.promise; }
        return originalDrain();
      };
      session.terminalStateTracker.flush = async () => { flushCalls++; return originalFlush(); };
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
      assert.equal(drainCalls, 1, 'first real consumption is still pending');
      assert.equal(flushCalls, 0, 'final flush must not enter the terminal chain yet');
      assert.equal(session.ownedReaderAdmissionOpen, true);
      gate.resolve();
      await f.until(() => session.ownedExecution.snapshot().settled, 'all batches and final flush');
      assert.equal(session.output, '01234567');
      assert.equal(drainCalls, 2, 'both accepted consume batches must actually drain');
      assert.equal(flushCalls, 1, 'final application still requires its separate serialization');
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

  for (const kind of ['terminal', 'agent']) {
    await checkReader(`${kind}: Host final credit pins the journal without blocking preserving delete`, async () => {
      const f = fixture(readerCapabilities);
      const { session, transport } = await f.create(kind);
      const read = await openReader(f, session);
      const journalDirectory = session.terminalJournal.sessionDirectory;
      const subscription = await request(f, f.socket, 'subscribeSession', {
        sessionId: session.sessionId, authorityId: session.terminalAuthorityId, afterRevision: 0,
        terminalStreamMode: 'paged-until-exit', hostOutputCredit: 'journal-pages-v1'
      });
      assert.equal(subscription.ok, true);
      assert.ok(subscription.result.subscriptionId);
      transport.output('owned final tail');
      await f.until(() => transport.sent.some(message => message.type === 'accepted' && message.throughFrameId === 1),
        'the provider observes accepted credit before declaring sourceEnd');
      await finish(f, session, transport);
      assert.equal(session.ownedExecution.snapshot().readerOutcome, 'pending',
        'Host consumption credit must not claim Webview final application');
      const page = await request(f, f.socket, 'readTerminalPage', { ...read, afterRevision: 0 });
      assert.equal(page.ok, true);
      assert.equal(page.result.revision, 1);
      assertSettlement(await closeReader(f, read, { kind: 'applied', finalRevision: 1 }), 'recorded');
      assert.equal(session.ownedReaderResults.applied, 1);

      let finalBatch;
      let consumedRevision = 0;
      let content = '';
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await f.until(() => Boolean(f.server.hostOutputSubscriptions.get(f.socket)?.get(session.sessionId)?.inFlight),
          'Host batch sent');
        const batch = f.socket.messages.filter(message => message.event === 'sessionTerminalBatch').at(-1).payload;
        assert.equal(batch.afterRevision, consumedRevision);
        content += batch.events.map(event => event.type === 'output' ? event.data : '').join('');
        if (batch.snapshot?.live === false) { finalBatch = batch; break; }
        assert.equal((await request(f, f.socket, 'ackTerminalBatch', {
          ...batch, outcome: 'consumed'
        })).ok, true);
        consumedRevision = batch.revision;
      }
      assert.ok(finalBatch, 'the complete terminal result must reach a finite Host batch');
      assert.equal(content, 'owned final tail');
      assert.equal(finalBatch.snapshot.terminalFinalRevision, 1);
      assert.equal(finalBatch.snapshot.terminalRevision, finalBatch.revision);
      const deleted = await request(f, f.socket, 'deleteSession', {
        sessionId: session.sessionId, preserveTerminalReads: true
      });
      assert.equal(deleted.ok, true, 'delete must return while its caller still owes the Host final ACK');
      assert.equal(f.server.sessions.get(session.sessionId), session);
      assert.equal(session.retiring, true);
      assert.equal((await fs.promises.stat(journalDirectory)).isDirectory(), true);
      assert.equal(session.ownedReaderResults.applied, 1, 'preserving delete must not manufacture reader settlement');
      assert.equal((await request(f, f.socket, 'ackTerminalBatch', { ...finalBatch, outcome: 'consumed' })).ok, true);
      await f.until(() => !f.server.sessions.has(session.sessionId), 'Host final ACK permits physical retirement');
      await assert.rejects(fs.promises.stat(journalDirectory), { code: 'ENOENT' });
      assert.equal(f.server.hostOutputSubscriptions.has(f.socket), false);
    });
  }

  await checkReader('steady Host output credit does not turn each acknowledged output into a state update', async () => {
    const f = fixture();
    const { session, transport } = await f.create();
    transport.output('warm-up');
    await f.until(() => session.ownedExecution.snapshot().adapter.consumedThrough === 1, 'terminal reaches live output');
    const subscribed = await request(f, f.socket, 'subscribeSession', {
      sessionId: session.sessionId, authorityId: session.terminalAuthorityId, afterRevision: 1,
      terminalStreamMode: 'paged-until-exit', hostOutputCredit: 'journal-pages-v1'
    });
    assert.equal(subscribed.ok, true);
    const nextBatch = async () => {
      await f.until(() => Boolean(f.server.hostOutputSubscriptions.get(f.socket)?.get(session.sessionId)?.inFlight),
        'next Host batch available');
      return f.socket.messages.filter(message => message.event === 'sessionTerminalBatch').at(-1).payload;
    };
    const initial = await nextBatch();
    assert.ok(initial.snapshot, 'subscription delivers its initial lightweight state');
    assert.equal((await request(f, f.socket, 'ackTerminalBatch', { ...initial, outcome: 'consumed' })).ok, true);
    for (let index = 1; index <= 3; index += 1) {
      transport.output(`steady-${index}`);
      const batch = await nextBatch();
      assert.equal(batch.revision, index + 1);
      assert.equal(batch.events[0].data, `steady-${index}`);
      assert.equal(batch.snapshot, undefined, 'ordinary output must not bypass Host state throttling');
      assert.equal((await request(f, f.socket, 'ackTerminalBatch', { ...batch, outcome: 'consumed' })).ok, true);
    }
    await finish(f, session, transport);
    const final = await nextBatch();
    assert.equal(final.snapshot.live, false, 'the final state still crosses the consumption boundary');
    assert.equal((await request(f, f.socket, 'ackTerminalBatch', { ...final, outcome: 'consumed' })).ok, true);
  });

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
    const originalDrain = session.terminalStateTracker.drain.bind(session.terminalStateTracker);
    let paused = true;
    session.terminalStateTracker.drain = async () => { if (paused) await gate.promise; return originalDrain(); };
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
      const appliedBuffer = session.terminalStateTracker.terminal.buffer.active;
      assert.match(Array.from({ length: appliedBuffer.length }, (_, index) =>
        appliedBuffer.getLine(index)?.translateToString(true) ?? '').join('\n'),
      new RegExp(`${kind}-observed-supervisor-tail`), 'consumed tail must exist in the real parser, without forcing a snapshot');
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

  for (const kind of ['terminal', 'agent']) {
    await check(`${kind} real Supervisor parent cleanup is independent of tracker and reader settlement`, async () => {
      const f = fixture([...closeObservationCapabilities, 'execution-parent-cleanup-v1'], {
        exposeParentControl: true, budgets: { naturalDrainMs: 15, parentTermMs: 5, parentKillMs: 5 }
      });
      const { session, transport } = await f.create(kind);
      const read = await openReader(f, session);
      const gate = deferred();
      const drain = session.terminalStateTracker.drain.bind(session.terminalStateTracker);
      session.terminalStateTracker.drain = async () => { await gate.promise; return drain(); };
      try {
        transport.process();
        transport.output(`${kind}-parent-cleanup-tail`);
        await f.until(() => session.ownedExecution.snapshot().adapter.acceptedThrough === 1, 'parent received tail');
        transport.fact({ type: 'resourceResult', resourceId: 'subject', operationId: 'release-subject', result: { kind: 'released' } });
        transport.seal();
        await f.until(() => transport.sent.some(message => message.type === 'sourceEndAccepted'), 'source acknowledgment sent');
        await f.advance(24);
        assert.equal(transport.cleanupRequests.length, 0);
        await f.advance(1);
        await f.until(() => transport.cleanupRequests.length === 1, 'original Supervisor parent cleanup');
        const request = transport.cleanupRequests[0];
        assert.equal(request.termDeadline, 30);
        assert.equal(request.killDeadline, 35);
        assert.equal(request.canSignal(), true);
        assert.equal(session.ownedExecution.snapshot().adapter.consumedThrough, 0);
        transport.cleanupResult.resolve({ kind: 'closed', exitCode: 0, signal: null });
        await f.pump();
        assert.notEqual(session.ownedExecution.snapshot().adapter.resources['provider-control'].current?.kind, 'released');
        assert.equal(session.ownedExecution.snapshot().settled, false);
        transport.release();
        await f.pump();
        assert.equal(session.ownedExecution.snapshot().adapter.resources['provider-control'].current.kind, 'released');
        assert.equal(session.ownedExecution.snapshot().settled, false);
        gate.resolve();
        await f.until(() => session.ownedExecution.snapshot().settled, `${kind} actual tracker completion`);
        assert.match(session.terminalStateTracker.getSerializedState().data, new RegExp(`${kind}-parent-cleanup-tail`));
        assert.equal(session.ownedExecution.snapshot().closeObservation.first.kind, 'settled');
        assert.equal(session.ownedExecution.snapshot().terminal.finalRevision, 1);
        assert.equal(session.ownedExecution.snapshot().readerOutcome, 'pending');
        assert.equal(f.server.executionOwner.snapshot().pending, 1);
        assert.equal(f.server.executionOwner.snapshot().blockedReason, undefined);
        assertSettlement(await closeReader(f, read, { kind: 'cancelled', reason: 'parent cleanup reader complete' }), 'recorded');
        assert.equal(f.server.executionOwner.snapshot().pending, 0);
        assert.equal(transport.cleanupRequests.length, 1);
      } finally { gate.resolve(); }
    });
  }

  const boundaryCapabilities = [...closeObservationCapabilities, 'execution-owner-boundary-v1'];
  const boundaryFixture = (boundaryMs = 100) => {
    const f = fixture(boundaryCapabilities, { budgets: { naturalDrainMs: 15, boundaryMs } });
    f.listener = { closeCalls: 0, close(callback) { this.closeCalls++; this.callback = callback; } };
    f.server.server = f.listener;
    return f;
  };

  for (const kind of ['terminal', 'agent']) {
    await check(`${kind} boundary saves real journal after reader application and confirms original socket/server close`, async () => {
      const f = boundaryFixture();
      const { session, transport } = await f.create(kind);
      const read = await openReader(f, session);
      transport.output(`${kind}-boundary-tail`);
      await f.until(() => session.outputSequence === 1, 'actual boundary tail consumption');
      const closing = f.server.prepareForShutdown('normal boundary');
      assert.strictEqual(f.server.prepareForShutdown('repeat without a new budget'), closing);
      assert.equal(f.listener.closeCalls, 1);
      assert.equal(session.terminalMutationAdmissionOpen, false);
      assert.equal(session.ownedReaderAdmissionOpen, false);
      await assert.rejects(f.server.createSession(f.socket, params('boundary-new-session')), /admission is closed/u);
      for (const method of ['attachSession', 'subscribeSession', 'openTerminalRead', 'stopSession', 'deleteSession']) {
        const response = await request(f, f.socket, method, { sessionId: session.sessionId,
          authorityId: session.terminalAuthorityId, consumerId: 'editor', afterRevision: 0 });
        assert.equal(response.ok, false, method);
      }
      const lateSocket = { destroyed: false, destroy() { this.destroyed = true; } };
      f.server.acceptSocket(lateSocket);
      assert.equal(lateSocket.destroyed, true);
      assert.equal(f.server.connections.has(lateSocket), false);
      await finish(f, session, transport);
      assert.equal(f.server.shutdownBoundary.registryStarted, false);
      assert.equal(f.socket.endCalls, 0);
      const page = await request(f, f.socket, 'readTerminalPage', {
        sessionId: session.sessionId, authorityId: session.terminalAuthorityId,
        readId: read.readId, afterRevision: read.checkpoint.revision
      });
      assert.equal(page.ok, true);
      assert.equal(page.result.revision, 1);
      assertSettlement(await closeReader(f, read, { kind: 'applied', finalRevision: 1 }), 'recorded');
      await f.until(() => f.socket.endCalls === 1, 'socket end only after strict registry flush');
      const registry = JSON.parse(await readFile(path.join(f.storageDir, 'registry.json'), 'utf8'));
      assert.equal(registry.sessions[0].sessionId, session.sessionId);
      assert.equal(registry.sessions[0].live, false);
      assert.equal(f.server.shutdownBoundary.first, undefined);
      f.listener.callback();
      assert.equal(f.server.shutdownBoundary.first, undefined, 'listener callback alone does not close original socket');
      f.socket.destroy();
      const report = await closing;
      assert.equal(report.kind, 'settled');
      assert.deepEqual(report.pending, []);
      assert.equal(report.deadline, 100);
      assert.equal(Object.isFrozen(report), true);
      assert.equal(Object.isFrozen(report.domains), true);
      assert.equal(session.ownedReaderResults.applied, 1);
      assert.equal(session.ownedReaderResults.lost, 0);
    });
  }

  await check('slow admitted reader remains valid after boundary deadline and does not authorize late save or socket end', async () => {
    const f = boundaryFixture(20);
    const { session, transport } = await f.create();
    const read = await openReader(f, session);
    const closing = f.server.prepareForShutdown('slow reader');
    await finish(f, session, transport);
    await f.advance(20);
    const first = await closing;
    assert.equal(first.kind, 'unconfirmed');
    assert.equal(first.domains.execution, 'settled');
    assert.equal(first.domains.readers, 'pending');
    assert.equal(session.ownedReaders.size, 1);
    assert.equal(session.ownedReaderResults.lost, 0);
    assertSettlement(await closeReader(f, read, { kind: 'applied', finalRevision: 0 }), 'recorded');
    await f.pump();
    assert.equal(f.server.executionOwner.snapshot().pending, 0);
    assert.equal(f.server.shutdownBoundary.registryStarted, false);
    assert.equal(f.socket.endCalls, 0);
    assert.strictEqual(await f.server.prepareForShutdown('late repeat'), first);
  });

  await check('boundary unknown retains original execution and late tail consumption without starting late shutdown work', async () => {
    const f = boundaryFixture(5);
    const { session, transport } = await f.create();
    const closing = f.server.prepareForShutdown('short observer');
    await f.advance(5);
    const first = await closing;
    assert.equal(first.kind, 'unconfirmed');
    assert.equal(first.domains.execution, 'pending');
    assert.strictEqual(f.server.sessions.get(session.sessionId), session);
    transport.output('late-accepted-tail');
    await f.until(() => session.ownedExecution.snapshot().adapter.acceptedThrough === 1, 'late tail frame actually accepted');
    await finish(f, session, transport);
    await f.pump();
    assert.match(session.terminalStateTracker.getSerializedState().data, /late-accepted-tail/u);
    assert.equal(f.server.executionOwner.snapshot().pending, 0);
    assert.equal(f.server.shutdownBoundary.registryStarted, false);
    assert.equal(f.socket.endCalls, 0);
    assert.strictEqual(f.server.shutdownBoundary.first, first);
  });

  for (const source of ['existing-error', 'flush-rejection']) {
    await check(`strict boundary persistence propagates ${source} without fallback success or socket end`, async () => {
      const f = boundaryFixture();
      const { session, transport } = await f.create();
      await finish(f, session, transport);
      const flush = session.terminalJournal.flush;
      if (source === 'existing-error') session.terminalJournalError = new Error('existing journal failure');
      else session.terminalJournal.flush = async () => { throw new Error('strict journal flush failure'); };
      try {
        const report = await f.server.prepareForShutdown('strict save failure');
        assert.equal(report.kind, 'failed');
        assert.equal(report.domains.registry, 'failed');
        assert.match(report.errors.registry, /journal.*failure/u);
        assert.equal(f.socket.endCalls, 0);
        assert.equal(f.server.executionOwner.snapshot().closing, true);
        assert.strictEqual(f.server.sessions.get(session.sessionId), session);
      } finally { session.terminalJournal.flush = flush; session.terminalJournalError = undefined; }
    });
  }

  await check('late actual journal save freezes deadline before result even while timer callbacks are held', async () => {
    const f = boundaryFixture(10);
    const { session, transport } = await f.create();
    await finish(f, session, transport);
    const gate = deferred();
    const entered = deferred();
    const flush = session.terminalJournal.flush.bind(session.terminalJournal);
    session.terminalJournal.flush = async () => { entered.resolve(); await gate.promise; return flush(); };
    try {
      const closing = f.server.prepareForShutdown('held registry flush');
      await entered.promise;
      f.elapse(10);
      gate.resolve();
      const first = await closing;
      assert.equal(first.kind, 'unconfirmed');
      assert.equal(first.domains.registry, 'pending');
      await f.until(() => f.server.shutdownBoundary.registry === 'settled', 'late actual registry saved');
      assert.equal(f.socket.endCalls, 0);
      assert.strictEqual(await f.server.prepareForShutdown('late save repeat'), first);
    } finally { gate.resolve(); session.terminalJournal.flush = flush; }
  });

  await check('pending registry chain reaches a finite boundary report without pretending save completion', async () => {
    const f = boundaryFixture(10);
    const { session, transport } = await f.create();
    await finish(f, session, transport);
    const gate = deferred();
    f.server.persistRegistryChain = gate.promise;
    const closing = f.server.prepareForShutdown('pending periodic save');
    await f.advance(10);
    const first = await closing;
    assert.equal(first.kind, 'unconfirmed');
    assert.equal(first.domains.registry, 'pending');
    assert.equal(f.socket.endCalls, 0);
    gate.resolve();
    await f.until(() => f.server.shutdownBoundary.registry === 'settled', 'original save eventually completes');
    assert.equal(f.socket.endCalls, 0);
    assert.strictEqual(f.server.shutdownBoundary.first, first);
  });

  await check('socket end intent and server close intent remain unknown until original callbacks arrive', async () => {
    const f = boundaryFixture(10);
    const { session, transport } = await f.create();
    await finish(f, session, transport);
    const closing = f.server.prepareForShutdown('held socket and listener close');
    await f.until(() => f.socket.endCalls === 1, 'original socket end requested');
    f.elapse(10);
    f.socket.destroy();
    const first = await closing;
    assert.equal(first.kind, 'unconfirmed');
    assert.equal(first.domains.sockets, 'pending');
    f.listener.callback();
    assert.equal(f.server.shutdownBoundary.server, 'settled');
    assert.equal(f.server.shutdownBoundary.sockets.get(f.socket), 'settled');
    assert.strictEqual(f.server.shutdownBoundary.first, first);
    assert.equal(f.socket.endCalls, 1);
  });

  await check('server close callback failure keeps original sockets open and reports a real failure', async () => {
    const f = boundaryFixture();
    const { session, transport } = await f.create();
    const closing = f.server.prepareForShutdown('listener failure');
    f.listener.callback(new Error('listener close failed'));
    const report = await closing;
    assert.equal(report.kind, 'failed');
    assert.equal(report.domains.server, 'failed');
    assert.equal(f.socket.endCalls, 0);
    await finish(f, session, transport);
    assert.equal(f.server.shutdownBoundary.registryStarted, false);
  });

  for (const method of ['attachSession', 'subscribeSession']) {
    await check(`in-flight ${method} cannot publish new admission after the boundary starts`, async () => {
      const f = boundaryFixture(10);
      const { session, transport } = await f.create();
      const gate = deferred();
      const entered = deferred();
      const snapshot = f.server.createFreshSnapshot.bind(f.server);
      f.server.createFreshSnapshot = async (...args) => { entered.resolve(); await gate.promise; return snapshot(...args); };
      const pending = request(f, f.socket, method, { sessionId: session.sessionId,
        authorityId: session.terminalAuthorityId, afterRevision: 0,
        terminalStreamMode: 'paged-until-exit', deferSubscription: true });
      await entered.promise;
      const closing = f.server.prepareForShutdown('admission race');
      gate.resolve();
      assert.equal((await pending).ok, false);
      f.server.createFreshSnapshot = snapshot;
      await f.advance(10);
      assert.equal((await closing).kind, 'unconfirmed');
      await finish(f, session, transport);
      assert.equal(f.socket.endCalls, 0);
    });
  }

  await check('reader admitted before boundary may finish its in-flight checkpoint and explicitly apply final state', async () => {
    const f = boundaryFixture();
    const { session, transport } = await f.create();
    const gate = deferred();
    const entered = deferred();
    const snapshot = f.server.createFreshSnapshot.bind(f.server);
    f.server.createFreshSnapshot = async (...args) => { entered.resolve(); await gate.promise; return snapshot(...args); };
    const opening = openReader(f, session);
    await entered.promise;
    assert.equal(session.ownedReaders.size, 1);
    const closing = f.server.prepareForShutdown('reader already admitted');
    gate.resolve();
    const read = await opening;
    f.server.createFreshSnapshot = snapshot;
    assert.equal(session.ownedReaderResults.lost, 0);
    await finish(f, session, transport);
    assertSettlement(await closeReader(f, read, { kind: 'applied', finalRevision: 0 }), 'recorded');
    await f.until(() => f.socket.endCalls === 1, 'in-flight reader completed before socket end');
    f.socket.destroy();
    f.listener.callback();
    assert.equal((await closing).kind, 'settled');
  });

  await check('boundary waits original journal preparation cleanup without acquiring an execution', async () => {
    const f = boundaryFixture();
    const entered = deferred();
    const gate = deferred();
    const create = TerminalSessionJournal.create;
    TerminalSessionJournal.create = async (...args) => { entered.resolve(); await gate.promise; return create(...args); };
    try {
      const creating = f.server.createSession(f.socket, params('40000000-0000-4000-8000-999999999991'));
      const rejection = assert.rejects(creating, /admission is closed/u);
      await entered.promise;
      const closing = f.server.prepareForShutdown('journal preparation race');
      assert.equal(f.server.shutdownBoundary.registryStarted, false);
      gate.resolve();
      await rejection;
      await f.until(() => f.socket.endCalls === 1, 'preparation is actually cleaned and registry saved');
      assert.equal(f.server.executionOwner.snapshot().pending, 0);
      assert.equal(f.transports.length, 0);
      assert.equal(f.server.sessions.size, 0);
      f.socket.destroy();
      f.listener.callback();
      assert.equal((await closing).kind, 'settled');
    } finally { gate.resolve(); TerminalSessionJournal.create = create; }
  });

  await check('new gate delete propagates journal failure without disposing its retained tracker', async () => {
    const f = boundaryFixture();
    const { session, transport } = await f.create();
    await finish(f, session, transport);
    let disposals = 0;
    const dispose = session.terminalStateTracker.dispose.bind(session.terminalStateTracker);
    session.terminalStateTracker.dispose = () => { disposals++; dispose(); };
    const deleteJournal = session.terminalJournal.delete.bind(session.terminalJournal);
    session.terminalJournal.delete = async () => { throw new Error('journal deletion failed'); };
    try {
      await assert.rejects(f.server.deleteSession({ sessionId: session.sessionId }), /journal deletion failed/u);
      assert.equal(disposals, 0);
      assert.strictEqual(f.server.sessions.get(session.sessionId), session);
      assert.equal(session.retiring, true);
    } finally { session.terminalJournal.delete = deleteJournal; }
    await f.server.deleteSession({ sessionId: session.sessionId });
    assert.equal(disposals, 1);
    assert.equal(f.server.sessions.has(session.sessionId), false);
  });

  await check('legacy cursor responsibility is not replaced by owned reader retirement at boundary', async () => {
    const f = boundaryFixture(10);
    const { session, transport } = await f.create();
    await finish(f, session, transport);
    f.server.sessions.set(session.sessionId, { ...session, ownedExecution: undefined, ownedReaders: undefined });
    f.server.terminalReads.get(f.socket).set('retained-legacy-cursor', {
      readId: 'retained-legacy-cursor', sessionId: session.sessionId, authorityId: session.terminalAuthorityId,
      consumerId: 'panel', appliedRevision: 0, sentRevision: 0, checkpoint: session.terminalCheckpoint
    });
    assert.equal(f.server.executionOwner.snapshot().pending, 0);
    const closing = f.server.prepareForShutdown('retained cursor');
    for (const method of ['openTerminalRead', 'attachSession', 'subscribeSession']) {
      const response = await request(f, f.socket, method, { sessionId: session.sessionId,
        authorityId: session.terminalAuthorityId, consumerId: 'editor', afterRevision: 0 });
      assert.equal(response.ok, false, `legacy ${method} must reject new reader admission`);
    }
    await f.advance(10);
    const report = await closing;
    assert.equal(report.kind, 'unconfirmed');
    assert.equal(report.domains.readers, 'pending');
    assert.equal(f.server.terminalReads.get(f.socket).has('retained-legacy-cursor'), true);
    assert.equal(f.socket.endCalls, 0);
  });

  await check('new gate idle failure keeps closing alive while successful idle waits for listener close', async () => {
    assert.deepEqual(processExits, []);
    const failing = boundaryFixture();
    const failedSession = await failing.create();
    await finish(failing, failedSession.session, failedSession.transport);
    failedSession.session.terminalJournalError = new Error('idle journal failure');
    failing.socket.destroy();
    failing.server.clearIdleShutdownTimer();
    failing.server.runIdleShutdown();
    await failing.until(() => failing.server.shutdownBoundary.first, 'idle save failure reported');
    assert.equal(failing.server.shutdownBoundary.first.kind, 'failed');
    assert.equal(failing.server.executionOwner.snapshot().closing, true);
    assert.equal(failing.server.shutdownBoundary.keepAlive.hasRef(), true);
    assert.deepEqual(processExits, []);
    failedSession.session.terminalJournalError = undefined;

    const successful = boundaryFixture();
    const completed = await successful.create();
    await finish(successful, completed.session, completed.transport);
    successful.socket.destroy();
    successful.server.clearIdleShutdownTimer();
    successful.server.runIdleShutdown();
    await successful.until(() => successful.server.shutdownBoundary.registry === 'settled', 'idle actual registry saved');
    assert.equal(successful.server.shutdownBoundary.keepAlive.hasRef(), true);
    assert.deepEqual(processExits, []);
    successful.listener.callback();
    await successful.pump();
    assert.deepEqual(processExits, [0]);
    assert.equal(successful.server.shutdownBoundary.keepAlive, undefined);
  });

  await check('S6 unstarted cleanup and S7 boundary settle a genuinely empty admitted-reader collection', async () => {
    const f = fixture([...boundaryCapabilities, 'execution-parent-cleanup-v1'], {
      holdReady: true, exposeParentControl: true,
      budgets: { naturalDrainMs: 15, boundaryMs: 100, parentTermMs: 5, parentKillMs: 5 }
    });
    f.listener = { close(callback) { this.callback = callback; } };
    f.server.server = f.listener;
    const creating = f.server.createSession(f.socket, params('40000000-0000-4000-8000-999999999992'));
    const rejection = assert.rejects(creating, /Execution start was failed/u);
    await f.until(() => f.transports.length === 1, 'original provider acquired without ready');
    const session = [...f.server.sessions.values()][0];
    const transport = f.transports[0];
    assert.equal(session.ownedReaders.size, 0);
    const closing = f.server.prepareForShutdown('unstarted boundary');
    await f.advance(30);
    await rejection;
    assert.equal(transport.cleanupRequests.length, 1);
    assert.equal(session.ownedExecution.snapshot().adapter.parentCleanup, 'unstarted');
    transport.cleanupResult.resolve({ kind: 'closed', exitCode: 0, signal: null });
    transport.sink.controlResourceResult({ kind: 'released' });
    await f.until(() => session.ownedExecution.snapshot().settled, 'unstarted original control released');
    assert.equal(session.ownedExecution.snapshot().terminal, undefined);
    assert.equal(session.ownedExecution.snapshot().adapter.process, undefined);
    assert.equal(session.ownedExecution.snapshot().adapter.source, undefined);
    assert.equal(session.ownedExecution.snapshot().readerOutcome, 'settled');
    await f.until(() => f.socket.endCalls === 1, 'empty readers permit strict registry and socket end');
    f.socket.destroy();
    f.listener.callback();
    assert.equal((await closing).kind, 'settled');
  });

  async function interactiveSupervisorFixture(kind = 'terminal', provider = 'codex') {
    const f = fixture(candidateCapabilities, candidateBehavior);
    const sessionId = `s10-${kind}-${++fixtureId}`;
    const create = params(sessionId, kind);
    create.launchSpec.cols = 113; create.launchSpec.rows = 39;
    await f.server.createSession(f.socket, { ...create, provider: kind === 'agent' ? provider : undefined,
      executionProfile: EXECUTION_CANDIDATE_PROFILE });
    const session = f.server.sessions.get(sessionId);
    const transport = f.transports[0];
    const interactions = [];
    const send = transport.send.bind(transport);
    transport.send = async message => {
      await send(message);
      if (message.type === 'input' || message.type === 'resize') interactions.push(message);
    };
    const reply = (message, result) => transport.fact({ type: 'interactionObservation', interactionId: message.interactionId, result });
    return { ...f, session, transport, interactions, reply };
  }

  await check('S10 Supervisor initial dimensions and stop policy represent Terminal, Codex and Claude without legacy process', async () => {
    for (const [kind, provider, strategy] of [
      ['terminal', 'codex', 'hangup'], ['agent', 'codex', 'interrupt-then-hangup'], ['agent', 'claude', 'hangup']
    ]) {
      const f = await interactiveSupervisorFixture(kind, provider);
      const start = f.transport.sent.find(message => message.type === 'start');
      assert.equal(start.spec.cols, 113); assert.equal(start.spec.rows, 39);
      assert.equal(start.spec.stopStrategy, strategy);
      assert.equal(f.session.process, undefined);
      assert.equal(f.session.terminalCheckpoint.cols, 113);
      assert.equal(f.session.terminalCheckpoint.rows, 39);
      await finish(f, f.session, f.transport);
    }
  });

  await check('S10 Supervisor write RPC waits actual written and never marks Agent running after failed input', async () => {
    for (const outcome of ['failed', 'written']) {
      const f = await interactiveSupervisorFixture('agent');
      f.session.lifecycle = 'waiting-input';
      const writing = request(f, f.socket, 'writeInput', { sessionId: f.session.sessionId, data: 'go\r' });
      await f.until(() => f.interactions.length === 1, `${outcome} original Supervisor input`);
      assert.equal(f.session.lifecycle, 'waiting-input');
      assert.equal(f.socket.messages.some(message => message.type === 'response' && message.id.startsWith('reader-request-')), false);
      f.reply(f.interactions[0], outcome === 'written' ? { kind: 'written', writtenBytes: 3 }
        : { kind: 'failed', reason: 'controlled input failure', writtenBytes: 0 });
      const response = await writing;
      assert.equal(response.ok, outcome === 'written');
      assert.equal(f.session.lifecycle, outcome === 'written' ? 'running' : 'waiting-input');
      await finish(f, f.session, f.transport);
    }
  });

  await check('S10 Supervisor resize orders native confirmation before journal tracker and scrollback revisions', async () => {
    const f = await interactiveSupervisorFixture();
    const resizing = f.server.resizeSession({ sessionId: f.session.sessionId, cols: 99, rows: 30 });
    await f.until(() => f.interactions.length === 1, 'Supervisor resize dispatch');
    assert.equal(f.session.cols, 113); assert.equal(f.session.rows, 39);
    assert.equal(f.session.outputSequence, 0);
    assert.equal(f.session.terminalJournal.getRevision(), 0);
    f.reply(f.interactions[0], { kind: 'resized' });
    await resizing;
    assert.equal(f.session.cols, 99); assert.equal(f.session.rows, 30);
    assert.equal(f.session.outputSequence, 1);
    assert.equal(f.session.terminalJournal.getRevision(), 1);
    await f.server.updateSessionScrollback({ sessionId: f.session.sessionId, scrollback: 120 });
    assert.equal(f.session.terminalStateTracker.getScrollback(), 120);
    assert.equal(f.session.outputSequence, 2);
    assert.equal(f.interactions.length, 1);
    f.transport.output('tail-after-owned-resize\r\n');
    await f.until(() => f.session.ownedExecution.snapshot().adapter.consumedThrough === 1, 'owned resized output consumed');
    assert.equal(f.session.outputSequence, 3);
    await finish(f, f.session, f.transport);
  });

  await check('S10 Supervisor failed resize does not mutate dimensions and confirmed resize journal failure closes admission', async () => {
    for (const outcome of ['provider-failed', 'journal-failed']) {
      const f = await interactiveSupervisorFixture();
      const append = f.session.terminalJournal.appendResize.bind(f.session.terminalJournal);
      if (outcome === 'journal-failed') f.session.terminalJournal.appendResize = () => { throw new Error('controlled resize journal failure'); };
      const resizing = f.server.resizeSession({ sessionId: f.session.sessionId, cols: 98, rows: 29 });
      const rejected = assert.rejects(resizing, /resize|journal/i);
      await f.until(() => f.interactions.length === 1, `${outcome} resize dispatch`);
      f.reply(f.interactions[0], outcome === 'provider-failed' ? { kind: 'failed', reason: 'controlled resize failure' } : { kind: 'resized' });
      await rejected;
      assert.equal(f.session.cols, 113);
      assert.equal(f.session.rows, 39);
      assert.equal(f.session.outputSequence, 0);
      if (outcome === 'journal-failed') {
        assert.equal(f.session.live, true, 'failed persistence must retain the unconfirmed live process');
        assert.equal(f.session.lifecycle, 'error');
        assert.ok(f.transport.sent.some(message => message.type === 'requestStop'));
        assert.match(f.session.terminalJournalError.message, /controlled resize journal failure/);
        await assert.rejects(f.server.writeInput({ sessionId: f.session.sessionId, data: 'no' }), /not live|not running|active|not available/i);
      }
      f.session.terminalJournal.appendResize = append;
      if (outcome === 'journal-failed') {
        f.transport.process(); f.transport.seal(); f.transport.release();
        await f.until(() => f.session.ownedExecution.snapshot().terminal?.kind === 'failed', 'native resize journal failure cannot claim complete authority');
      } else await finish(f, f.session, f.transport);
    }
  });

  await check('S10 Supervisor title replies remain independent of output consumption and preserve Agent resume activity', async () => {
    for (const kind of ['terminal', 'agent']) {
      const f = await interactiveSupervisorFixture(kind);
      f.transport.output('\x1b]2;supervisor-title\x07\x1b[21t\r\nready\r\n');
      await f.until(() => f.session.ownedExecution.snapshot().adapter.consumedThrough === 1, `${kind} title query consumed`);
      await f.until(() => f.interactions.length === 1, `${kind} title reply dispatched`);
      assert.equal(f.session.terminalTitle, 'supervisor-title');
      assert.match(f.interactions[0].data, /supervisor-title/);
      if (kind === 'terminal') assert.equal(f.session.lifecycle, 'live');
      else {
        f.transport.output('\r\nTo continue this session, run codex resume 7e57d004-2b97-4001-9455-5d94020a94cd\r\n');
        await f.until(() => f.session.ownedExecution.snapshot().adapter.consumedThrough === 2, 'Supervisor Agent hint consumed');
        assert.equal(f.session.resumeSessionId, '7e57d004-2b97-4001-9455-5d94020a94cd');
        assert.equal(typeof f.session.agentActivity.lastOutputAtMs, 'number');
      }
      f.server.stopSession({ sessionId: f.session.sessionId });
      await f.until(() => f.transport.sent.some(message => message.type === 'requestStop'), 'stop bypasses title reply');
      assert.equal(f.session.lifecycle, 'stopping');
      await finish(f, f.session, f.transport);
    }
  });

  await check('S10 Supervisor owned subject exit and Claude input restrictions reject mutation without a legacy process', async () => {
    const f = await interactiveSupervisorFixture('agent', 'claude');
    await assert.rejects(f.server.writeInput({ sessionId: f.session.sessionId, data: '\x1a' }), /Ctrl-Z|ctrl|suspend/i);
    f.session.lifecycle = 'suspended';
    await assert.rejects(f.server.writeInput({ sessionId: f.session.sessionId, data: 'go\r' }), /suspend/i);
    f.session.lifecycle = 'running';
    f.transport.process();
    await assert.rejects(f.server.writeInput({ sessionId: f.session.sessionId, data: 'late' }), /not live|not running|active|not available/i);
    await assert.rejects(f.server.resizeSession({ sessionId: f.session.sessionId, cols: 90, rows: 30 }), /not live|not running|active|not available/i);
    assert.equal(f.interactions.length, 0);
    await finish(f, f.session, f.transport);
  });

  await check('S10 Supervisor uncertain resize retains original late evidence while consuming tail and refusing complete authority', async () => {
    const f = await interactiveSupervisorFixture();
    const resizing = f.server.resizeSession({ sessionId: f.session.sessionId, cols: 91, rows: 33 });
    const rejected = assert.rejects(resizing, /unconfirmed/);
    await f.until(() => f.interactions.length === 1, 'original uncertain Supervisor resize');
    f.reply(f.interactions[0], { kind: 'unconfirmed', reason: 'controlled resize observation deadline' });
    await rejected;
    const original = f.session.ownedResizeObservation;
    assert.equal(original.current.kind, 'unconfirmed');
    assert.match(f.session.ownedMutationError, /effect is unconfirmed/);
    f.reply(f.interactions[0], { kind: 'resized' });
    await f.until(() => original.current.kind === 'resized', 'Supervisor original late resize evidence');
    assert.strictEqual(f.session.ownedResizeObservation, original);
    await assert.rejects(f.server.writeInput({ sessionId: f.session.sessionId, data: 'blocked' }), /not live|not running|active|not available/i);
    await assert.rejects(f.server.resizeSession({ sessionId: f.session.sessionId, cols: 92, rows: 34 }), /not live|not running|active|not available/i);
    assert.equal(f.interactions.length, 1);
    f.transport.output('\x1b]2;uncertain-title\x07\x1b[21ttail-after-uncertain-resize\r\n');
    await f.until(() => f.session.ownedExecution.snapshot().adapter.consumedThrough === 1, 'uncertain Supervisor authority consumes tail');
    assert.equal(f.transport.sent.filter(message => message.type === 'input').length, 0,
      'automatic title reply cannot bypass closed mutation admission');
    f.transport.process(); f.transport.seal(); f.transport.release();
    await f.until(() => f.session.ownedExecution.snapshot().terminal?.kind === 'failed', 'uncertain Supervisor final authority rejected');
    assert.equal(f.session.cols, 113); assert.equal(f.session.rows, 39);
    assert.equal(f.session.outputSequence, 1);
    assert.equal(f.session.terminalJournal.getRevision(), 1);
    assert.match(f.session.terminalStateTracker.getSerializedState().data, /tail-after-uncertain-resize/);
  });

  assert.equal(forbiddenAcquisitions, 0);
  console.log(`Supervisor execution owner wiring: ${passed}/${passed} pure cases passed`);
} finally {
  for (const f of fixtures) {
    f.server.clearIdleShutdownTimer();
    if (f.server.shutdownBoundary?.keepAlive) clearInterval(f.server.shutdownBoundary.keepAlive);
    for (const session of f.server.sessions.values()) {
      if (session.lifecycleTimer) clearTimeout(session.lifecycleTimer);
      await session.terminalJournal?.flush();
      session.terminalStateTracker.dispose();
    }
  }
  await rm(directory, { recursive: true, force: true });
}
