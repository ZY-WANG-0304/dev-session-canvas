import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

export async function runSupervisorScenario(context, mode) {
  assert.ok(['normal', 'paused-stop', 'isolation'].includes(mode), `Unknown Supervisor scenario: ${mode}`);
  const { RuntimeSupervisorServer } = await context.load(
    'extensions/vscode/dev-session-canvas/src/supervisor/runtimeSupervisorMain.ts');
  const { SerializedTerminalStateTracker } = await context.load(
    'extensions/vscode/dev-session-canvas/src/common/serializedTerminalState.ts');
  const { EXECUTION_CANDIDATE_PROFILE, S1_LIMITS } = await context.load(
    'extensions/vscode/dev-session-canvas/src/common/executionLifecycle.ts');
  const storageDir = path.join(context.directory, 'runtime-storage');
  await mkdir(storageDir, { recursive: true });
  const options = context.ownerOptions('live-runtime');
  const server = new RuntimeSupervisorServer({ storageDir, registryPath: path.join(storageDir, 'registry.json') },
    'legacy-detached', 'best-effort', options);
  context.trackOwner(server.executionOwner);
  // Daemon listener/idle exit is outside this in-process authority scenario.
  server.scheduleIdleShutdownIfNeeded = () => {};
  const sockets = [];
  const sessions = [];
  const replayTrackers = [];
  const releasePauses = [];
  let requestId = 0;

  // The authority is real; only its RPC connection is in memory. start() is never called.
  function socket() {
    const connection = Object.assign(new EventEmitter(), {
      destroyed: false,
      messages: [],
      write(line) {
        assert.equal(this.destroyed, false, 'A closed fixture connection cannot receive a reply');
        this.messages.push(JSON.parse(line));
        return true;
      },
      end() { this.destroy(); },
      destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.emit('close');
      }
    });
    connection.on('close', () => server.cleanupSocket(connection));
    server.connections.add(connection);
    server.subscriptions.set(connection, new Map());
    server.deferredSubscriptionRevisions.set(connection, new Map());
    server.terminalReads.set(connection, new Map());
    server.appliedRevisionAcks.set(connection, new Map());
    sockets.push(connection);
    return connection;
  }

  async function rpc(connection, method, params, expectSuccess = true) {
    const id = `s11-${++requestId}`;
    await context.before(server.handleRequest(connection, { type: 'request', id, method, params }), `${mode}:${method}`);
    const response = connection.messages.find(message => message.type === 'response' && message.id === id);
    assert.ok(response, `${method} must publish its original RPC response`);
    assert.equal(response.ok, expectSuccess, `${method}: ${JSON.stringify(response)}`);
    return expectSuccess ? response.result : response;
  }

  async function open(record, connection = record.socket) {
    const read = await rpc(connection, 'openTerminalRead', { sessionId: record.session.sessionId,
      authorityId: record.session.terminalAuthorityId, consumerId: 'editor', settlementMode: 'final-application-v1' });
    const checkpoint = read.checkpoint;
    const tracker = new SerializedTerminalStateTracker(checkpoint.cols, checkpoint.rows, {
      initialState: checkpoint.serializedState, initialOutputSequence: checkpoint.revision,
      scrollback: checkpoint.scrollback
    });
    replayTrackers.push(tracker);
    record.reader = { descriptor: read, socket: connection, tracker, revision: checkpoint.revision, pages: 0 };
    return read;
  }

  async function create(label, connection = socket()) {
    const sessionId = `s11-${mode}-${label}`;
    const launchSpec = context.launchSpec(label);
    assert.equal(launchSpec.cols, 107);
    assert.equal(launchSpec.rows, 33);
    await rpc(connection, 'createSession', { sessionId, kind: 'terminal', displayLabel: `S11 ${label}`,
      launchMode: 'start', scrollback: 100, terminalStreamMode: 'paged-until-exit',
      executionProfile: EXECUTION_CANDIDATE_PROFILE, launchSpec });
    const session = server.sessions.get(sessionId);
    assert.ok(session?.ownedExecution, 'The actual create route must reserve an owned execution');
    assert.equal(session.process, undefined, 'The candidate cannot create a legacy process facade');
    const execution = session.ownedExecution;
    context.trackExecution(execution);
    const record = { label, socket: connection, session, execution, journalOutput: [session.output] };
    const appendOutput = session.terminalJournal.appendOutput.bind(session.terminalJournal);
    session.terminalJournal.appendOutput = data => {
      const event = appendOutput(data);
      record.journalOutput.push(data);
      return event;
    };
    sessions.push(record);
    await context.until(() => context.output(execution).includes('READY:107x33'), `${label}: subject READY`);
    await context.until(() => execution.snapshot().adapter.consumedThrough === execution.snapshot().adapter.acceptedThrough,
      `${label}: initial output consumed`);
    await open(record);
    return record;
  }

  async function input(record, data) {
    return rpc(record.socket, 'writeInput', { sessionId: record.session.sessionId, data });
  }

  async function exercise(record) {
    await input(record, `nonce:${context.nonce}\n`);
    await context.until(() => context.output(record.execution).includes(`HASH:${context.expectedHash}`),
      `${record.label}: computed nonce response`);
    await rpc(record.socket, 'resizeSession', { sessionId: record.session.sessionId, cols: 119, rows: 41 });
    await input(record, 'size\n');
    await context.until(() => context.output(record.execution).includes('SIZE:119x41'), `${record.label}: actual terminal dimensions`);
    assert.equal(record.session.cols, 119);
    assert.equal(record.session.rows, 41);
  }

  function facts(record) {
    const current = record.execution.snapshot();
    return { identity: current.identity, process: current.adapter?.process, source: current.adapter?.source,
      terminal: current.terminal, settled: current.settled, retired: current.retired,
      readerOutcome: current.readerOutcome, resources: current.adapter?.resources,
      acceptedThrough: current.adapter?.acceptedThrough, consumedThrough: current.adapter?.consumedThrough,
      closeObservation: current.closeObservation };
  }

  async function settle(record, normal = false) {
    await context.until(() => record.execution.snapshot().settled, `${record.label}: original execution settled`, 16000);
    const current = record.execution.snapshot();
    assert.equal(current.terminal?.kind, 'applied');
    assert.equal(current.adapter.firstFault, undefined);
    assert.equal(current.adapter.consumedThrough, current.adapter.seal.lastDataSequence);
    assert.equal(current.adapter.pendingBytes, 0);
    assert.equal(current.adapter.rawBytes, 0);
    for (const resourceId of ['provider-control', 'pty-master', 'pty-child', 'pty-source']) {
      assert.equal(current.adapter.resources[resourceId]?.current?.kind, 'released', `${record.label}:${resourceId}`);
    }
    if (normal) {
      assert.equal(current.adapter.process.kind, 'exited');
      assert.equal(current.adapter.process.exitCode, 7);
      assert.equal(current.adapter.source.kind, 'eof');
      await context.assertScreen(record.session.terminalStateTracker);
      await context.verifyWritten(record.label, record.execution);
    } else {
      assert.equal(current.adapter.process.kind, 'signaled');
      assert.equal(current.adapter.process.signal, 'SIGHUP');
    }
    assert.equal(record.journalOutput.join(''),
      context.output(record.execution), 'Every provider output frame must reach the actual journal');
    return facts(record);
  }

  async function applyReader(record, normal = false) {
    const reader = record.reader;
    const finalRevision = record.execution.snapshot().terminal.finalRevision;
    while (reader.revision < finalRevision) {
      const page = await rpc(reader.socket, 'readTerminalPage', { sessionId: record.session.sessionId,
        authorityId: reader.descriptor.authorityId, readId: reader.descriptor.readId, afterRevision: reader.revision });
      assert.ok(page.revision > reader.revision, 'A final reader page must advance its original revision');
      assert.ok(page.revision <= finalRevision);
      for (const event of page.events) {
        assert.equal(event.revision, reader.revision + 1, 'Reader replay cannot skip an authority operation');
        if (event.type === 'output') reader.tracker.write(event.data, { outputSequence: event.revision });
        else if (event.type === 'resize') reader.tracker.resize(event.cols, event.rows, { outputSequence: event.revision });
        else if (event.type === 'scrollback') await reader.tracker.setScrollback(event.scrollback, { outputSequence: event.revision });
        else assert.fail(`Unexpected terminal stream event ${event.type}`);
        reader.revision = event.revision;
      }
      assert.equal(reader.revision, page.revision);
      reader.pages++;
    }
    const state = await context.before(reader.tracker.flush(), `${record.label}: real reader consumption`);
    assert.equal(state.outputSequence, finalRevision);
    if (normal) await context.assertScreen(reader.tracker);
    const closed = await rpc(reader.socket, 'closeTerminalRead', { sessionId: record.session.sessionId,
      authorityId: reader.descriptor.authorityId, readId: reader.descriptor.readId,
      outcome: { kind: 'applied', finalRevision } });
    assert.equal(closed.settlement, 'recorded');
    await context.until(() => record.execution.snapshot().retired, `${record.label}: reader responsibility retired`);
    return { finalRevision, pages: reader.pages, result: closed, screen: screen(reader.tracker) };
  }

  function pause(record) {
    const tracker = record.session.terminalStateTracker;
    const original = tracker.flush.bind(tracker);
    let resume;
    const gate = new Promise(resolve => { resume = resolve; });
    let entered = false;
    let released = false;
    tracker.flush = async () => {
      entered = true;
      await gate;
      return original();
    };
    const release = () => {
      if (released) return;
      released = true;
      tracker.flush = original;
      resume();
    };
    releasePauses.push(release);
    context.addCleanup(async () => { release(); });
    return { release, entered: () => entered, released: () => released };
  }

  async function stopWhilePaused(record, gate) {
    await input(record, 'flood\n');
    await context.until(() => gate.entered(), `${record.label}: actual tracker flush paused`);
    await context.until(() => {
      const adapter = record.execution.snapshot().adapter;
      return adapter.acceptedThrough - adapter.consumedThrough === S1_LIMITS.pendingFrames;
    }, `${record.label}: finite output credit exhausted`);
    const held = facts(record);
    await rpc(record.socket, 'stopSession', { sessionId: record.session.sessionId });
    await context.until(() => {
      const process = record.execution.snapshot().adapter.process;
      return process && process.kind !== 'unconfirmed';
    }, `${record.label}: stop observed while consumption remains paused`);
    assert.equal(gate.released(), false);
    assert.equal(record.execution.snapshot().settled, false);
    assert.equal(record.execution.snapshot().adapter.consumedThrough, held.consumedThrough);
    return { beforeStop: held, afterProcessExit: facts(record) };
  }

  async function deleteAndReopen(record) {
    const original = record.execution;
    await rpc(record.socket, 'deleteSession', { sessionId: record.session.sessionId });
    assert.equal(server.sessions.has(record.session.sessionId), false);
    const reopened = await rpc(record.socket, 'attachSession', { sessionId: record.session.sessionId,
      terminalStreamMode: 'paged-until-exit' }, false);
    assert.equal(reopened.result, undefined);
    assert.equal(reopened.error.code, 'DEV_SESSION_CANVAS_RUNTIME_SESSION_NOT_FOUND');
    const absent = await rpc(record.socket, 'getSessionSnapshot', { sessionId: record.session.sessionId }, false);
    assert.equal(absent.result, undefined);
    assert.equal(absent.error.code, 'DEV_SESSION_CANVAS_RUNTIME_SESSION_NOT_FOUND');
    assert.equal(original.snapshot().retired, true);
    assert.equal(server.executionOwner.list().includes(original), false);
    return { attachRejected: true, snapshotRejected: true, originalIdentity: original.identity };
  }

  context.addCleanup(async () => {
    for (const release of releasePauses) release();
    for (const connection of sockets) if (!connection.destroyed) connection.destroy();
    server.clearIdleShutdownTimer();
    if (server.persistTimer) clearTimeout(server.persistTimer);
    server.persistTimer = undefined;
    for (const record of sessions) {
      if (record.session.lifecycleTimer) clearTimeout(record.session.lifecycleTimer);
      record.session.lifecycleTimer = undefined;
    }
    for (const tracker of replayTrackers) tracker.dispose();
    await context.before(server.persistRegistryChain, `${mode}: original registry writes during cleanup`);
  });

  if (mode === 'normal') {
    const record = await create('supervisor-normal');
    await exercise(record);
    const identity = record.execution.identity;
    const original = record.execution;
    const oldReaderId = record.reader.descriptor.readId;
    record.socket.destroy();
    assert.equal(record.execution.snapshot().stopRequested, false, 'A live detach must not stop the subject');
    assert.equal(record.session.ownedReaders.has(oldReaderId), false);
    record.socket = socket();
    const attached = await rpc(record.socket, 'attachSession', { sessionId: record.session.sessionId,
      terminalStreamMode: 'paged-until-exit' });
    assert.equal(attached.live, true);
    assert.strictEqual(server.sessions.get(record.session.sessionId).ownedExecution, original);
    assert.deepEqual(original.identity, identity);
    await open(record);
    await input(record, `nonce:${context.nonce}\n`);
    await context.until(() => context.output(original).split(`HASH:${context.expectedHash}`).length >= 3,
      'live reattach still reaches the original execution');
    await input(record, 'finish\n');
    const terminal = await settle(record, true);
    const reader = await applyReader(record, true);
    const reopen = await deleteAndReopen(record);
    return { mode, listener: 'not-started', daemonIdle: 'not-exercised', terminal, reader, detachPreservedIdentity: true, reopen };
  }

  const a = await create(mode === 'isolation' ? 'supervisor-isolation-a' : 'supervisor-paused-stop');
  const b = mode === 'isolation' ? await create('supervisor-isolation-b') : undefined;
  const gate = pause(a);
  const stopped = await stopWhilePaused(a, gate);
  let independent;
  if (b) {
    assert.equal(gate.released(), false);
    await exercise(b);
    await input(b, 'finish\n');
    const terminal = await settle(b, true);
    const reader = await applyReader(b, true);
    assert.equal(gate.released(), false, 'B must finish without releasing A consumption');
    assert.equal(a.execution.snapshot().settled, false);
    independent = { terminal, reader, reopen: await deleteAndReopen(b) };
  }
  gate.release();
  const terminal = await settle(a);
  const reader = await applyReader(a);
  const reopen = await deleteAndReopen(a);
  return { mode, listener: 'not-started', daemonIdle: 'not-exercised', stopped, terminal, reader, reopen,
    ...(independent ? { independent } : {}) };
}

function screen(tracker) {
  const terminal = tracker.terminal;
  const buffer = terminal.buffer.active;
  return { cols: terminal.cols, rows: terminal.rows, cursorX: buffer.cursorX, cursorY: buffer.cursorY,
    lines: Array.from({ length: 6 }, (_, index) => buffer.getLine(buffer.baseY + index)?.translateToString(true) ?? '') };
}
