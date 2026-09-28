import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import esbuild from 'esbuild';

const directory = await mkdtemp(path.join(os.tmpdir(), 'dsc-host-credit-'));
const sockets = new Set();
const clients = new Set();
const sessions = [];
const baselineRef = process.argv.find(value => value.startsWith('--baseline-ref='))?.split('=')[1];
let listener;
let server;
try {
  const outfile = path.join(directory, 'runtime-host-credit.cjs');
  if (baselineRef) console.log(`Committed transport baseline: ${execFileSync('git', ['rev-parse', baselineRef],
    { encoding: 'utf8' }).trim()}`);
  await esbuild.build({
    stdin: {
      contents: `
        export { RuntimeSupervisorServer } from './extensions/vscode/dev-session-canvas/src/supervisor/runtimeSupervisorMain';
        export { RuntimeSupervisorClient } from './extensions/vscode/dev-session-canvas/src/panel/runtimeSupervisorClient';
        export { TerminalSessionJournal } from './extensions/vscode/dev-session-canvas/src/supervisor/terminalSessionJournal';
        export { SerializedTerminalStateTracker, SERIALIZED_TERMINAL_CHECKPOINT_PROFILES } from './extensions/vscode/dev-session-canvas/src/common/serializedTerminalState';
      `,
      resolveDir: process.cwd(), loader: 'ts'
    },
    bundle: true, outfile, platform: 'node', format: 'cjs', target: 'node18', external: ['node-pty'],
    plugins: baselineRef ? [{ name: 'committed-transport-baseline', setup(build) {
      build.onLoad({ filter: /(?:runtimeSupervisorMain|runtimeSupervisorClient|runtimeSupervisorProtocol)\.ts$/ }, args => ({
        contents: execFileSync('git', ['show', `${baselineRef}:${path.relative(process.cwd(), args.path)}`],
          { encoding: 'utf8' }), loader: 'ts'
      }));
    } }] : []
  });
  const require = createRequire(import.meta.url);
  const modules = require(outfile);
  const socketPath = process.platform === 'win32'
    ? `\\\\.\\pipe\\dsc-host-credit-${process.pid}-${Date.now()}` : path.join(directory, 'runtime.sock');
  const paths = { storageDir: directory, socketPath, registryPath: path.join(directory, 'registry.json'),
    socketLocation: process.platform === 'win32' ? 'named-pipe' : 'storage' };
  server = new modules.RuntimeSupervisorServer(paths, 'legacy-detached', 'best-effort');
  server.schedulePersist = () => {};
  server.scheduleIdleShutdownIfNeeded = () => {};
  listener = net.createServer(socket => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    server.acceptSocket(socket);
  });
  await new Promise((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(socketPath, resolve);
  });
  const backend = { kind: 'legacy-detached', guarantee: 'best-effort', label: 'Controlled socket runtime', paths,
    startSupervisor: async () => assert.fail('This test must not start a Supervisor process.') };
  const createClient = handlers => {
    const client = new modules.RuntimeSupervisorClient({
      backend, supervisorScriptPath: '/unused/runtimeSupervisorMain.js',
      supervisorLauncherScriptPath: '/unused/runtimeSupervisorLauncher.js', ...handlers
    });
    clients.add(client);
    return client;
  };
  const createSession = async (sessionId, kind = 'terminal', segmentMaxBytes) => {
    const journal = await modules.TerminalSessionJournal.create({
      storageDir: directory, sessionId, initialCols: 80, initialRows: 24, initialScrollback: 1000,
      eventCacheMaxBytes: 0, segmentMaxBytes, checkpointProfiles: modules.SERIALIZED_TERMINAL_CHECKPOINT_PROFILES
    });
    const tracker = new modules.SerializedTerminalStateTracker(80, 24, { scrollback: 1000, initialOutputSequence: 0 });
    let dataListener;
    const input = [];
    const resized = [];
    const session = {
      sessionId, kind, live: true, lifecycle: kind === 'terminal' ? 'live' : 'running',
      provider: kind === 'agent' ? 'codex' : undefined, launchMode: 'resume', displayLabel: sessionId,
      runtimeBackend: 'legacy-detached', runtimeGuarantee: 'best-effort', shellPath: '/controlled-shell',
      cwd: directory, cols: 80, rows: 24, scrollback: 1000, output: '', outputSequence: 0,
      startedAtMs: Date.now(), terminalAuthorityId: journal.getAuthorityId(), terminalJournal: journal,
      terminalStateTracker: tracker, terminalOperationChain: Promise.resolve(), terminalMutationAdmissionOpen: true,
      terminalCheckpoint: { version: 1, sessionId, authorityId: journal.getAuthorityId(), revision: 0,
        cols: 80, rows: 24, scrollback: 1000, createdAtMs: Date.now(), serializedState: tracker.getSerializedState() },
      process: {
        write: data => input.push(data), resize: (cols, rows) => resized.push({ cols, rows }),
        onData: callback => { dataListener = callback; return { dispose() {} }; },
        onExit: () => ({ dispose() {} }), kill: () => assert.fail('The fixture must not kill an execution.')
      }
    };
    sessions.push(session);
    server.sessions.set(sessionId, session);
    server.bindSessionProcess(session);
    return { session, input, resized, emit: data => dataListener(data), settle: async () => {
      await session.terminalOperationChain;
      await journal.flush();
      await tracker.flush();
    } };
  };
  await verifyCreditFlow({ createClient, createSession, server, baselineRef });
  if (!baselineRef) {
    await verifyReplacementAndDisconnect({ createClient, createSession, server });
    await verifyCompactedCursor({ createClient, createSession, server });
    await verifySteadyOutput({ createClient, createSession, server });
    await verifyLegacy({ createClient, createSession, server });
  }
  console.log('runtime Host output credit: real socket backpressure, controls, tail ordering and lifecycle passed');
} finally {
  for (const client of clients) client.dispose();
  for (const socket of sockets) socket.destroy();
  if (listener) await new Promise(resolve => listener.close(resolve));
  if (server) {
    clearTimeout(server.idleShutdownTimer);
    clearTimeout(server.persistTimer);
  }
  for (const session of sessions) {
    clearTimeout(session.lifecycleTimer);
    await session.terminalOperationChain;
    session.terminalStateTracker.dispose();
    await session.terminalJournal.delete();
  }
  await rm(directory, { recursive: true, force: true });
}

async function verifyCreditFlow({ createClient, createSession, server, baselineRef }) {
  const a = await createSession('slow-terminal');
  const b = await createSession('responsive-agent', 'agent');
  const gate = deferred();
  const received = [];
  const consumed = new Map();
  const snapshots = [];
  const raw = [];
  const states = [];
  let held = false;
  const client = createClient({
    onSessionTerminalEvent: event => raw.push(event),
    onSessionOutput: event => raw.push(event),
    onSessionState: snapshot => states.push(snapshot),
    onSessionTerminalBatch: async (batch, isCurrent) => {
      received.push(batch);
      if (batch.sessionId === a.session.sessionId && !held) {
        held = true;
        await gate.promise;
      }
      if (!isCurrent()) return 'cancelled';
      assert.equal(batch.error, undefined);
      assert.equal(batch.kind, batch.sessionId === a.session.sessionId ? 'terminal' : 'agent');
      assert.ok(batch.events.length <= 256);
      assert.ok(Buffer.byteLength(JSON.stringify(batch.events)) <= 256 * 1024);
      const events = consumed.get(batch.sessionId) ?? [];
      assert.equal(batch.afterRevision, events.length);
      for (const event of batch.events) {
        assert.equal(event.revision, events.length + 1);
        events.push(event);
      }
      assert.equal(batch.revision, events.length);
      consumed.set(batch.sessionId, events);
      if (batch.snapshot) {
        assert.equal(batch.snapshot.output, '');
        assert.equal(batch.snapshot.terminalStream, undefined);
        assert.equal(batch.snapshot.serializedTerminalState, undefined);
        snapshots.push({ snapshot: batch.snapshot, consumedRevision: events.length });
      }
      return 'consumed';
    }
  });
  try {
    await client.ensureConnected({ allowRestart: false });
    if (!baselineRef) assert.equal((await client.hello()).capabilities.terminalHostOutputCreditV1, true);
    await bounded(client.subscribeSession(subscription(a.session)), 'subscribe delayed Terminal');
    const expectedOutput = [];
    for (let index = 0; index < 96; index += 1) {
      const data = `${String(index).padStart(4, '0')}:${'x'.repeat(8185)}\r\n`;
      expectedOutput.push(data);
      a.emit(data);
      if (index % 4 === 0) server.emitSessionState(a.session);
    }
    await a.settle();
    await until(() => received.length > 0 || raw.length > 0, 'first terminal delivery');
    assert.equal(raw.length, 0, 'A credit subscription must not flood raw events while Host consumption is stalled.');
    await pause(60);
    assert.equal(received.filter(batch => batch.sessionId === a.session.sessionId).length, 1,
      'A stalled Host must have exactly one in-flight terminal batch.');
    assert.equal(states.length, 0, 'Session state updates must share credit instead of flooding a stalled Host.');
    assert.equal(server.getTerminalJournalRetentionRevision(a.session), 0,
      'The unconsumed Host cursor must pin its journal prefix.');

    await bounded(client.subscribeSession(subscription(b.session)), 'subscribe second session');
    b.emit('second-session-progress\r\n');
    await b.settle();
    await until(() => consumed.get(b.session.sessionId)?.length === 1, 'second session consumes while A is blocked');
    assert.equal(consumed.get(b.session.sessionId)[0].data, 'second-session-progress\r\n');
    await bounded(client.writeInput({ sessionId: a.session.sessionId, data: 'still-responsive\r' }), 'same-session input');
    await bounded(client.resizeSession({ sessionId: a.session.sessionId, cols: 91, rows: 29 }), 'same-session resize');
    assert.deepEqual(a.input, ['still-responsive\r']);
    assert.deepEqual(a.resized, [{ cols: 91, rows: 29 }]);
    await server.finalizeSession(a.session.sessionId, 0);
    const finalRevision = a.session.terminalJournal.getRevision();
    await pause(40);
    assert.equal(received.filter(batch => batch.sessionId === a.session.sessionId).length, 1);
    assert.equal(snapshots.filter(item => item.snapshot.sessionId === a.session.sessionId && !item.snapshot.live).length, 0,
      'Completed state must not bypass the pending output batch.');

    gate.resolve();
    await until(() => snapshots.some(item => item.snapshot.sessionId === a.session.sessionId && !item.snapshot.live),
      'completed state after all output');
    const events = consumed.get(a.session.sessionId);
    assert.equal(events.length, finalRevision);
    assert.deepEqual(events.filter(event => event.type === 'output').map(event => event.data), expectedOutput);
    assert.deepEqual(events.at(-1), { type: 'resize', revision: finalRevision, createdAtMs: events.at(-1).createdAtMs,
      cols: 91, rows: 29 });
    assert.equal(snapshots.find(item => item.snapshot.sessionId === a.session.sessionId && !item.snapshot.live).consumedRevision,
      finalRevision, 'Terminal final state must follow its complete accepted tail.');
    await until(() => !findFlow(server, a.session.sessionId), 'completed Host cursor release');
    assert.equal(server.getTerminalJournalRetentionRevision(a.session), undefined);
    assert.ok(findFlow(server, b.session.sessionId), 'Releasing completed A must not cancel live B.');
    assert.equal(raw.length, 0);
    assert.equal(states.length, 0);
    console.log(`Host credit: ${events.length} ordered Terminal events; Agent and input/resize progressed during stalled consumption`);
  } finally {
    gate.resolve();
    client.dispose();
  }
}

async function verifyReplacementAndDisconnect({ createClient, createSession, server }) {
  const fixture = await createSession('replace-cancel');
  const pending = [];
  const client = createClient({ onSessionTerminalBatch: async (batch, isCurrent) => {
    const gate = deferred();
    pending.push({ batch, isCurrent, gate });
    return gate.promise;
  } });
  try {
    await client.ensureConnected({ allowRestart: false });
    const first = await client.subscribeSession(subscription(fixture.session));
    await until(() => pending.length === 1, 'first replaceable subscription');
    fixture.emit('replace-pending\r\n');
    await fixture.settle();
    const replacement = await client.subscribeSession(subscription(fixture.session));
    await until(() => pending.length === 2, 'replacement subscription delivery');
    assert.notEqual(replacement.subscriptionId, first.subscriptionId);
    assert.equal(pending[0].isCurrent(), false);
    assert.equal(pending[1].isCurrent(), true);
    pending[0].gate.resolve('consumed');
    await pause(40);
    assert.equal(findFlow(server, fixture.session.sessionId).subscriptionId, replacement.subscriptionId);
    assert.equal(findFlow(server, fixture.session.sessionId).appliedRevision, 0,
      'A late old callback must not consume replacement output.');
    pending[1].gate.resolve('cancelled');
    await until(() => !findFlow(server, fixture.session.sessionId), 'cancelled Host cursor release');
    assert.equal(server.getTerminalJournalRetentionRevision(fixture.session), undefined);
    const delivered = pending.length;
    fixture.emit('not-subscribed\r\n');
    await fixture.settle();
    await pause(40);
    assert.equal(pending.length, delivered);
  } finally {
    for (const entry of pending) entry.gate.resolve('cancelled');
    client.dispose();
  }

  const disconnected = await createSession('disconnect');
  const gate = deferred();
  let entered = false;
  let current;
  const remote = createClient({ onSessionTerminalBatch: async (_batch, isCurrent) => {
    entered = true;
    current = isCurrent;
    return gate.promise;
  } });
  try {
    await remote.ensureConnected({ allowRestart: false });
    await remote.subscribeSession(subscription(disconnected.session));
    await until(() => entered, 'disconnect in-flight batch');
    assert.ok(findFlow(server, disconnected.session.sessionId));
    remote.dispose();
    await until(() => !findFlow(server, disconnected.session.sessionId), 'disconnect releases Host cursor');
    assert.equal(server.getTerminalJournalRetentionRevision(disconnected.session), undefined);
    assert.equal(current(), false);
    gate.resolve('consumed');
    await pause(40);
    assert.equal(findFlow(server, disconnected.session.sessionId), undefined);
  } finally {
    gate.resolve('cancelled');
    remote.dispose();
  }
  console.log('Host credit: replacement, cancellation and disconnect release only their own cursor');
}

async function verifyCompactedCursor({ createClient, createSession, server }) {
  const fixture = await createSession('compacted-cursor', 'terminal', 512);
  const { session } = fixture;
  const gate = deferred();
  let entered = false;
  const paused = createClient({ onSessionTerminalBatch: async () => {
    entered = true;
    return gate.promise;
  } });
  const observed = [];
  const raw = [];
  const resumed = createClient({
    onSessionTerminalBatch: async batch => { observed.push(batch); return 'consumed'; },
    onSessionTerminalEvent: event => raw.push(event), onSessionOutput: event => raw.push(event)
  });
  const commit = async () => {
    const validated = await session.terminalStateTracker.flushValidatedCheckpoint();
    assert.equal(validated.eligible, true, 'the compaction fixture needs a real eligible checkpoint.');
    const checkpoint = { ...session.terminalCheckpoint, revision: session.terminalJournal.getRevision(),
      createdAtMs: Date.now(), serializedState: validated.state };
    const result = await session.terminalJournal.commitCheckpoint(checkpoint, {
      force: true, retainAfterRevision: server.getTerminalJournalRetentionRevision(session)
    });
    assert.equal(result.committed, true);
    session.terminalCheckpoint = checkpoint;
    return result;
  };
  try {
    await paused.ensureConnected({ allowRestart: false });
    await paused.subscribeSession(subscription(session));
    await until(() => entered, 'paused cursor before compaction');
    fixture.emit('pinned-prefix-one\r\n');
    await fixture.settle();
    await commit();
    fixture.emit('pinned-prefix-two\r\n');
    await fixture.settle();
    const pinnedCommit = await commit();
    assert.equal(pinnedCommit.compactedSegments, 0);
    assert.equal(session.terminalJournal.getRetainedStartRevision(), 1,
      'actual checkpoint compaction must keep the active unconsumed Host prefix.');

    paused.dispose();
    await until(() => !findFlow(server, session.sessionId), 'disconnected compaction pin release');
    gate.resolve('consumed');
    fixture.emit('retained-tail-three\r\n');
    await fixture.settle();
    const reclaimed = await commit();
    assert.ok(reclaimed.compactedSegments >= 2, 'disconnection must permit reclaiming the old checkpoint segments.');
    const retainedCursor = session.terminalJournal.getRetainedStartRevision() - 1;
    assert.equal(retainedCursor, 2);

    await resumed.ensureConnected({ allowRestart: false });
    await assert.rejects(resumed.subscribeSession(subscription(session)), error => {
      assert.equal(error.code, 'DEV_SESSION_CANVAS_RUNTIME_TERMINAL_HOST_CURSOR_COMPACTED');
      return true;
    }, 'a stale disconnected cursor must be rejected explicitly, not turned into a failed output flow.');
    await pause(30);
    assert.equal(findFlow(server, session.sessionId), undefined);
    assert.deepEqual(observed, []);
    assert.deepEqual(raw, []);
    await resumed.subscribeSession({ ...subscription(session), afterRevision: retainedCursor });
    await until(() => observed.some(batch => batch.revision === 3), 'retained cursor delivery');
    assert.equal(observed[0].afterRevision, retainedCursor);
    assert.deepEqual(observed.flatMap(batch => batch.events).map(event => event.data), ['retained-tail-three\r\n']);
    assert.equal(observed[0].error, undefined);
    await until(() => findFlow(server, session.sessionId)?.appliedRevision === 3, 'retained cursor consumption');
  } finally {
    gate.resolve('cancelled');
    paused.dispose();
    resumed.dispose();
  }
  console.log('Host credit: active cursor pins real compaction; disconnected stale cursor is typed rejection; retained cursor replays');
}

async function verifySteadyOutput({ createClient, createSession, server }) {
  const fixture = await createSession('steady-output');
  const batches = [];
  const client = createClient({ onSessionTerminalBatch: async batch => {
    batches.push(batch);
    return 'consumed';
  } });
  try {
    await client.ensureConnected({ allowRestart: false });
    await client.subscribeSession(subscription(fixture.session));
    await until(() => batches.length === 1 && !findFlow(server, fixture.session.sessionId)?.inFlight,
      'initial steady-output state ACK');
    assert.ok(batches[0].snapshot);
    for (let index = 1; index <= 3; index += 1) {
      fixture.emit(`steady-${index}\r\n`);
      await fixture.settle();
      await until(() => findFlow(server, fixture.session.sessionId)?.appliedRevision === index,
        `steady output ${index} ACK`);
    }
    assert.deepEqual(batches.slice(1).flatMap(batch => batch.events).map(event => event.data),
      ['steady-1\r\n', 'steady-2\r\n', 'steady-3\r\n']);
    assert.ok(batches.slice(1).every(batch => batch.snapshot === undefined),
      'ordinary consumed output pages must not each send an unchanged session state.');
    await server.finalizeSession(fixture.session.sessionId, 0);
    await until(() => batches.some(batch => batch.snapshot?.live === false), 'steady-output final state');
    assert.equal(batches.at(-1).revision, 3);
    assert.equal(batches.at(-1).events.length, 0);
  } finally {
    client.dispose();
  }
  console.log('Host credit: steady output consumes without repeated state snapshots; completion still publishes state');
}

async function verifyLegacy({ createClient, createSession, server }) {
  const fixture = await createSession('legacy-no-credit');
  const events = [];
  const states = [];
  const writeMessage = server.writeMessage.bind(server);
  server.writeMessage = (socket, message) => {
    if (message.type === 'response' && message.result?.capabilities) {
      const { terminalHostOutputCreditV1: _credit, ...capabilities } = message.result.capabilities;
      return writeMessage(socket, { ...message, result: { ...message.result, capabilities } });
    }
    return writeMessage(socket, message);
  };
  const legacy = createClient({
    onSessionTerminalEvent: event => events.push(event), onSessionState: snapshot => states.push(snapshot),
    onSessionTerminalBatch: () => assert.fail('A server without Host credit must keep the legacy event contract.')
  });
  try {
    await legacy.ensureConnected({ allowRestart: false });
    assert.equal(legacy.supportsTerminalHostOutputCredit(), false);
    const { hostOutputCredit: _credit, ...params } = subscription(fixture.session);
    await legacy.subscribeSession(params);
    fixture.emit('legacy-output\r\n');
    await fixture.settle();
    await until(() => events.length === 1 && states.length > 0, 'legacy event and state delivery');
    assert.equal(events[0].event.data, 'legacy-output\r\n');
    assert.equal(findFlow(server, fixture.session.sessionId), undefined);
  } finally {
    server.writeMessage = writeMessage;
    legacy.dispose();
  }
  console.log('Host credit: absent hello capability preserves legacy subscription delivery');
}

function subscription(session) {
  return { sessionId: session.sessionId, authorityId: session.terminalAuthorityId, afterRevision: 0,
    terminalStreamMode: 'paged-until-exit', hostOutputCredit: 'journal-pages-v1' };
}

function findFlow(server, sessionId) {
  for (const entries of server.hostOutputSubscriptions?.values() ?? []) {
    if (entries.has(sessionId)) return entries.get(sessionId);
  }
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function pause(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function until(predicate, label) {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, `Timed out: ${label}`);
    await pause(5);
  }
}

async function bounded(promise, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Control blocked while Host is stalled: ${label}`)), 1500);
    })]);
  } finally {
    clearTimeout(timer);
  }
}
