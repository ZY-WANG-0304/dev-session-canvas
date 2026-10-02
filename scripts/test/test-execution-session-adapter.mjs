import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import esbuild from 'esbuild';

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'dsc-execution-session-adapter-'));
let identityCounter = 0;

function identity() {
  identityCounter += 1;
  return {
    executionId: `00000000-0000-4000-8000-${String(identityCounter).padStart(12, '0')}`,
    generation: `binding-${identityCounter}`
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function createScheduler() {
  let now = 0;
  const tasks = [];
  const deadlines = new Set();
  return {
    now: () => now,
    scheduleTask: (callback) => tasks.push(callback),
    scheduleDeadline(deadline, callback) {
      const entry = { deadline, callback };
      deadlines.add(entry);
      return () => deadlines.delete(entry);
    },
    advanceTo(time, { runDeadlines = true } = {}) {
      assert.ok(time >= now, 'the test clock must be monotonic');
      now = time;
      if (!runDeadlines) return;
      for (const entry of [...deadlines].sort((a, b) => a.deadline - b.deadline)) {
        if (entry.deadline <= now && deadlines.delete(entry)) {
          entry.callback();
        }
      }
    },
    runOneTask() {
      const callback = tasks.shift();
      if (!callback) return false;
      callback();
      return true;
    },
    get taskCount() {
      return tasks.length;
    }
  };
}

// Flush only already scheduled continuations; never advance an observation deadline.
async function settle(scheduler) {
  let idleTurns = 0;
  for (let turn = 0; turn < 200; turn += 1) {
    const ranTask = scheduler.runOneTask();
    await Promise.resolve();
    await Promise.resolve();
    idleTurns = !ranTask && scheduler.taskCount === 0 ? idleTurns + 1 : 0;
    if (idleTurns === 8) return;
  }
  assert.fail('the adapter did not quiesce within the bounded test task queue');
}

function joinBytes(...chunks) {
  const joined = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined;
}

try {
  await esbuild.build({
    entryPoints: {
      executionLifecycle: path.resolve('extensions/vscode/dev-session-canvas/src/common/executionLifecycle.ts'),
      executionSessionAdapter: path.resolve('extensions/vscode/dev-session-canvas/src/panel/executionSessionAdapter.ts')
    },
    bundle: true,
    format: 'cjs',
    outdir: tempDir,
    outExtension: { '.js': '.cjs' },
    platform: 'node',
    target: 'node18'
  });

  const require = createRequire(import.meta.url);
  const { encodeOutputFrame, OutputCreditWindow, parseProviderMessage, parseParentMessage, validateLaunchSpec,
    normalizeExecutionAdmissionLimits, EXECUTION_PRODUCTION_ADMISSION, hasExecutionAdmissionCapacity, EXECUTION_CANDIDATE_PROFILE,
    EXECUTION_INTERACTION_LIMITS } = require(path.join(tempDir, 'executionLifecycle.cjs'));
  const { createExecutionAuthority, prepareExecution } = require(path.join(tempDir, 'executionSessionAdapter.cjs'));
  const tests = [];
  const test = (name, callback) => tests.push({ name, callback });

  function createHarness(options = {}) {
    const executionIdentity = options.identity ?? identity();
    const scheduler = options.scheduler ?? createScheduler();
    const authority = options.authority ?? createExecutionAuthority();
    const messages = [];
    const events = { data: [], processes: [], seals: [], resources: [], faults: [] };
    const consumptions = [];
    let sink;
    let connectCount = 0;
    const transport = {
      ...(options.parentControl ? { parentControl: options.parentControl } : {}),
      connect(value) {
        connectCount += 1;
        sink = value;
        options.connect?.(sink);
        if (options.autoReady !== false) {
          sink.message({
            type: 'ready',
            identity: executionIdentity,
            capabilities: options.readyCapabilities ?? ['execution-lifecycle-v1']
          });
        }
      },
      send(message) {
        messages.push(message);
        return options.send ? options.send(message) : Promise.resolve();
      }
    };
    const session = prepareExecution(executionIdentity, {
      file: 'controlled-fixture',
      args: [],
      cwd: '/',
      env: {},
      ...(options.profile ? { cols: 80, rows: 24, stopStrategy: 'hangup' } : {}),
      ...options.spec
    }, { authority, transport, scheduler, ...(options.profile ? { profile: options.profile } : {}),
      ...(options.closeObservationV1 ? { closeObservationV1: true } : {}),
      ...(options.parentCleanupV1 ? { parentCleanupV1: true } : {}) });
    const observer = {
      data: (batch) => events.data.push(batch),
      processResult: (eventIdentity, result) => events.processes.push({ identity: eventIdentity, result }),
      outputSeal: (seal) => events.seals.push(seal),
      resourceResult: (eventIdentity, resourceId, result) => events.resources.push({ identity: eventIdentity, resourceId, result }),
      fault: (eventIdentity, reason) => events.faults.push({ identity: eventIdentity, reason }),
      ...(options.stateChanged ? { stateChanged: (eventIdentity) => options.stateChanged(eventIdentity, session.snapshot()) } : {})
    };
    const consumeBatch = (batches) => {
      const pending = deferred();
      consumptions.push({ batches, ...pending });
      if (options.autoConsume) pending.resolve();
      return pending.promise;
    };
    let control;
    function bind() {
      control = session.bind(observer, consumeBatch);
      return control;
    }
    if (options.bind !== false) bind();
    return {
      identity: executionIdentity,
      scheduler,
      authority,
      session,
      events,
      messages,
      consumptions,
      bind,
      get control() { return control; },
      get sink() {
        assert.ok(sink, 'transport must be connected before emitting provider facts');
        return sink;
      },
      get connectCount() { return connectCount; },
      snapshot: () => session.snapshot(),
      message(message) { this.sink.message({ ...message, identity: executionIdentity }); },
      frame(frameId, text) { return encodeOutputFrame({ version: 1, identity: executionIdentity, frameId, text }); },
      output(frameId, text) {
        const bytes = this.frame(frameId, text);
        this.sink.data(bytes);
        return bytes;
      },
      sent(type) { return messages.filter((message) => message.type === type); },
      async start(operationId = 'start', deadline = 100) {
        const observation = control.start(operationId, deadline);
        await settle(scheduler);
        return observation;
      },
      async started(operationId = 'start', deadline = 100) {
        const observation = await this.start(operationId, deadline);
        this.message({ type: 'operationObservation', operationId, result: { kind: 'started', pid: 1234 } });
        await settle(scheduler);
        assert.equal(observation.current?.kind, 'started');
        assert.equal((await observation.first).kind, 'started');
        return observation;
      },
      async consumeAll() {
        for (let turn = 0; turn < 20; turn += 1) {
          for (const consumption of consumptions) consumption.resolve();
          await settle(scheduler);
          if (this.snapshot().pendingFrames === 0) return;
        }
        assert.fail('accepted output did not finish its explicit consumption batches');
      },
      async retire() {
        this.message({ type: 'processResult', result: { kind: 'exited', exitCode: 0 } });
        this.message({ type: 'sourceEnd', finalFrameId: this.snapshot().acceptedThrough, disposition: { kind: 'eof' } });
        await this.consumeAll();
        this.sink.controlResourceResult({ kind: 'released' });
        await settle(scheduler);
        assert.equal(this.snapshot().state, 'settled');
      }
    };
  }

  test('production admission bounds pending responsibility without imposing a running-session maximum', async () => {
    assert.deepEqual(EXECUTION_PRODUCTION_ADMISSION, { executions: null, starting: 1, pending: 2 });
    assert.ok(Object.isFrozen(EXECUTION_PRODUCTION_ADMISSION));
    const policy = normalizeExecutionAdmissionLimits(EXECUTION_PRODUCTION_ADMISSION);
    assert.deepEqual(policy, EXECUTION_PRODUCTION_ADMISSION);
    assert.equal(hasExecutionAdmissionCapacity(policy, { executions: 10, pending: 1 }), true);
    assert.equal(hasExecutionAdmissionCapacity(policy, { executions: 10, pending: 2 }), false);
    for (const invalid of [{ executions: null, starting: 1 }, { executions: null, starting: 1, pending: 0 },
      { executions: null, starting: 3, pending: 2 }, { executions: 2, starting: 1, pending: 2 },
      { executions: null, starting: 1, pending: Infinity }]) {
      assert.throws(() => normalizeExecutionAdmissionLimits(invalid), /admission/);
    }
    const authority = createExecutionAuthority(policy);
    const scheduler = createScheduler();
    const running = [];
    for (let index = 0; index < 11; index++) {
      const h = createHarness({ authority, scheduler });
      await h.started();
      running.push(h);
    }
    assert.equal(authority.snapshot().active, 11);
    assert.equal(authority.snapshot().admissionPending, 0);
    running[0].output(1, 'bounded-live-consumption');
    await settle(scheduler);
    assert.ok(running[0].snapshot().pendingBytes > 0);
    assert.equal(authority.snapshot().admissionPending, 0, 'normal bounded live output is not an exit responsibility slot');
    const preparation = createHarness({ authority, scheduler });
    const starting = createHarness({ authority, scheduler });
    assert.equal(authority.snapshot().admissionPending, 2);
    assert.throws(() => createHarness({ authority, scheduler }), /capacity/);
    await starting.started();
    assert.equal(authority.snapshot().admissionPending, 1);
    assert.equal(preparation.session.cancelReservation(), true);
    for (const h of running) h.message({ type: 'processResult', result: { kind: 'exited', exitCode: 0 } });
    assert.equal(authority.snapshot().admissionPending, 11, 'existing executions may close together; their obligations are retained');
    assert.throws(() => createHarness({ authority, scheduler }), /capacity/);
    for (const h of running) await h.retire();
    assert.equal(authority.snapshot().admissionPending, 0);
    await starting.retire();
  });

  test('production admission retains one start allowance and sticky unknown quarantine', async () => {
    const authority = createExecutionAuthority(EXECUTION_PRODUCTION_ADMISSION);
    const scheduler = createScheduler();
    const first = createHarness({ authority, scheduler });
    const second = createHarness({ authority, scheduler });
    await first.start();
    const denied = await second.start();
    assert.equal((await denied.first).kind, 'rejected-before-acquire');
    assert.equal(second.connectCount, 0);
    first.message({ type: 'operationObservation', operationId: 'start', result: { kind: 'started', pid: 1234 } });
    await settle(scheduler);
    first.sink.controlResourceResult({ kind: 'unknown', reason: 'unconfirmed provider release' });
    assert.throws(() => createHarness({ authority, scheduler }), /quarantined/);
    first.sink.controlResourceResult({ kind: 'released' });
    await first.retire();
    assert.ok(authority.snapshot().blockedReason);
    assert.throws(() => createHarness({ authority, scheduler }), /quarantined/);
  });

  test('production admission observes a transport boundary before the next adapter task', async () => {
    const authority = createExecutionAuthority(EXECUTION_PRODUCTION_ADMISSION);
    const scheduler = createScheduler();
    const first = createHarness({ authority, scheduler });
    const second = createHarness({ authority, scheduler });
    await first.started();
    await second.started();
    first.sink.dataEnded();
    second.sink.exited();
    assert.equal(first.snapshot().state, 'running');
    assert.equal(second.snapshot().state, 'running');
    assert.equal(authority.snapshot().admissionPending, 2);
    assert.throws(() => createHarness({ authority, scheduler }), /capacity/);
  });

  test('admission limits preserve S1 defaults and validate a frozen independent policy', () => {
    assert.deepEqual(normalizeExecutionAdmissionLimits(), { executions: 2, starting: 1 });
    const input = { executions: 10, starting: 2 };
    const policy = normalizeExecutionAdmissionLimits(input);
    assert.notStrictEqual(policy, input);
    assert.ok(Object.isFrozen(policy));
    input.executions = 1;
    assert.deepEqual(policy, { executions: 10, starting: 2 });
    for (const invalid of [null, [], {}, { executions: 2 }, { executions: 0, starting: 1 },
      { executions: -1, starting: 1 }, { executions: 2.5, starting: 1 },
      { executions: Number.MAX_SAFE_INTEGER + 1, starting: 1 }, { executions: Infinity, starting: 1 },
      { executions: 2, starting: 0 }, { executions: 2, starting: NaN },
      { executions: 2, starting: 1.5 }, { executions: 2, starting: 3 },
      { executions: '10', starting: 2 }, { executions: 10, starting: 2, extra: true }]) {
      assert.throws(() => normalizeExecutionAdmissionLimits(invalid));
      assert.throws(() => createExecutionAuthority(invalid));
    }
  });

  test('explicit ten execution two start policy rejects overflow before acquisition', async () => {
    const input = { executions: 10, starting: 2 };
    const authority = createExecutionAuthority(input);
    const scheduler = createScheduler();
    input.executions = 1;
    input.starting = 1;
    assert.deepEqual(authority.admissionLimits, { executions: 10, starting: 2 });
    assert.ok(Object.isFrozen(authority.admissionLimits));
    const entries = Array.from({ length: 10 }, () => createHarness({ authority, scheduler }));
    assert.throws(() => createHarness({ authority, scheduler }), /capacity/);
    assert.equal(entries.reduce((sum, entry) => sum + entry.connectCount, 0), 0);
    await entries[0].start();
    await entries[1].start();
    const denied = entries[2].control.start('overflow-start', 100);
    assert.equal((await denied.first).kind, 'rejected-before-acquire');
    assert.equal(entries[2].connectCount, 0);
    assert.equal(authority.snapshot().starting, 2);
    entries[0].message({ type: 'operationObservation', operationId: 'start', result: { kind: 'started', pid: 1234 } });
    await settle(scheduler);
    await entries[3].start();
    assert.equal(entries[3].connectCount, 1);
    assert.equal(authority.snapshot().starting, 2);
  });

  test('expanded admission still quarantines unknown while existing consumers progress', async () => {
    const authority = createExecutionAuthority({ executions: 10, starting: 2 });
    const scheduler = createScheduler();
    const a = createHarness({ authority, scheduler });
    const b = createHarness({ authority, scheduler });
    const reserved = createHarness({ authority, scheduler });
    await a.started();
    await b.started();
    a.sink.controlResourceResult({ kind: 'unknown', reason: 'release not confirmed' });
    assert.throws(() => createHarness({ authority, scheduler }), /quarantined/);
    const denied = reserved.control.start('quarantined-start', 100);
    assert.equal((await denied.first).kind, 'rejected-before-acquire');
    assert.equal(reserved.connectCount, 0);
    b.output(1, 'existing-consumer');
    await b.consumeAll();
    assert.equal(b.snapshot().consumedThrough, 1);
    a.sink.controlResourceResult({ kind: 'released' });
    await settle(scheduler);
    assert.ok(authority.snapshot().blockedReason);
    assert.equal(authority.tryResume(), false);
  });

  test('bind is required and the same start never repeats native intent', async () => {
    const h = createHarness({ bind: false });
    assert.equal(h.connectCount, 0);
    assert.throws(() => h.session.start('before-bind', 100));
    h.bind();
    const first = h.control.start('start', 100);
    assert.strictEqual(h.control.start('start', 100), first);
    assert.throws(() => h.control.start('replacement-start', 100));
    assert.throws(() => h.bind());
    await settle(h.scheduler);
    assert.equal(h.connectCount, 1);
    assert.equal(h.sent('start').length, 1);
  });

  test('ready does not prove that the execution process started', async () => {
    const h = createHarness();
    const observation = await h.start();
    assert.equal(observation.current, undefined);
    assert.equal(h.snapshot().process, undefined);
    assert.equal(h.events.seals.length, 0);
    assert.equal(h.authority.snapshot().starting, 1);
  });

  test('accepted transfers ownership without returning byte or frame credit', async () => {
    const h = createHarness();
    await h.started();
    const bytes = h.output(1, 'tail\u001b[2D');
    await settle(h.scheduler);
    assert.equal(h.snapshot().acceptedThrough, 1);
    assert.equal(h.snapshot().consumedThrough, 0);
    assert.equal(h.snapshot().pendingBytes, bytes.byteLength);
    assert.equal(h.snapshot().pendingFrames, 1);
    assert.equal(h.sent('accepted').at(-1)?.throughFrameId, 1);
    assert.equal(h.sent('consumed').length, 0);
    assert.equal(h.events.data[0].text, 'tail\u001b[2D');
    assert.equal(h.events.data[0].sequence, 1);
    assert.equal(h.events.data[0].byteLength, bytes.byteLength);
    h.consumptions[0].resolve();
    await settle(h.scheduler);
    assert.equal(h.snapshot().consumedThrough, 1);
    assert.equal(h.snapshot().pendingBytes, 0);
    assert.equal(h.snapshot().pendingFrames, 0);
    assert.equal(h.sent('consumed').filter((message) => message.throughFrameId === 1).length, 1);
    h.consumptions[0].resolve();
    await settle(h.scheduler);
    assert.equal(h.sent('consumed').filter((message) => message.throughFrameId === 1).length, 1);
  });

  test('provider credit returns only after a valid consumed receipt', () => {
    const executionIdentity = identity();
    const window = new OutputCreditWindow(executionIdentity);
    let totalBytes = 0;
    for (let frameId = 1; frameId <= 16; frameId += 1) {
      totalBytes += window.reserve({ version: 1, identity: executionIdentity, frameId, text: 'x' }).byteLength;
    }
    const full = window.snapshot();
    assert.equal(full.pendingFrames, 16);
    assert.equal(full.pendingBytes, totalBytes);
    assert.throws(() => window.reserve({ version: 1, identity: executionIdentity, frameId: 17, text: 'x' }));
    assert.deepEqual(window.snapshot(), full);
    window.acknowledge({ type: 'accepted', identity: executionIdentity, throughFrameId: 16 });
    assert.equal(window.snapshot().pendingBytes, totalBytes);
    assert.throws(() => window.reserve({ version: 1, identity: executionIdentity, frameId: 17, text: 'x' }));
    window.acknowledge({ type: 'consumed', identity: executionIdentity, throughFrameId: 16 });
    assert.equal(window.snapshot().pendingBytes, 0);
    window.acknowledge({ type: 'consumed', identity: executionIdentity, throughFrameId: 16 });
    assert.equal(window.snapshot().pendingFrames, 0);
    window.reserve({ version: 1, identity: executionIdentity, frameId: 17, text: 'after-consumption' });
    assert.equal(window.snapshot().pendingFrames, 1);
  });

  test('payload headers also consume the provider byte window', () => {
    const executionIdentity = identity();
    const window = new OutputCreditWindow(executionIdentity);
    const fullFrame = (frameId) => {
      const frame = { version: 1, identity: executionIdentity, frameId, text: 'x' };
      const overhead = encodeOutputFrame(frame).byteLength - 4 - 1;
      return { ...frame, text: 'x'.repeat(32 * 1024 - overhead) };
    };
    for (let frameId = 1; frameId <= 7; frameId += 1) {
      assert.equal(window.reserve(fullFrame(frameId)).byteLength, 32 * 1024 + 4);
    }
    const before = window.snapshot();
    assert.throws(() => window.reserve(fullFrame(8)));
    assert.deepEqual(window.snapshot(), before);
    window.reserve({ version: 1, identity: executionIdentity, frameId: 8, text: 'smaller-final-frame' });
    assert.equal(window.snapshot().pendingFrames, 8);
  });

  test('a slow accepted send cannot let coalesced consumed overtake ownership ACK', async () => {
    const holdAcceptedOne = deferred();
    const h = createHarness({
      autoConsume: true,
      send(message) {
        return message.type === 'accepted' && message.throughFrameId === 1
          ? holdAcceptedOne.promise
          : Promise.resolve();
      }
    });
    await h.started();
    const window = new OutputCreditWindow(h.identity);
    h.sink.data(window.reserve({ version: 1, identity: h.identity, frameId: 1, text: 'first' }));
    await settle(h.scheduler);
    h.sink.data(window.reserve({ version: 1, identity: h.identity, frameId: 2, text: 'second' }));
    await settle(h.scheduler);
    assert.equal(h.snapshot().consumedThrough, 2);
    holdAcceptedOne.resolve();
    await settle(h.scheduler);
    for (const message of h.messages) {
      if (message.type === 'accepted' || message.type === 'consumed') {
        assert.doesNotThrow(() => window.acknowledge(message), `receipt order: ${JSON.stringify(h.messages)}`);
      }
    }
    assert.equal(window.snapshot().pendingBytes, 0);
  });

  test('fragmented frames and the four-frame task budget preserve ordering', async () => {
    const h = createHarness();
    await h.started();
    const first = h.frame(1, 'fragmented');
    h.sink.data(first.subarray(0, 2));
    await settle(h.scheduler);
    assert.equal(h.events.data.length, 0);
    assert.equal(h.snapshot().rawBytes, 2);
    h.sink.data(first.subarray(2));
    const remaining = Array.from({ length: 8 }, (_, index) => h.frame(index + 2, `frame-${index + 2}`));
    h.sink.data(joinBytes(...remaining));
    assert.ok(h.snapshot().rawBytes > 0);
    h.scheduler.runOneTask();
    assert.ok(h.events.data.length <= 4, 'one scheduled task must not consume an unbounded frame burst');
    await settle(h.scheduler);
    assert.deepEqual(h.events.data.map((batch) => batch.sequence), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
    assert.equal(h.snapshot().rawBytes, 0);
    assert.equal(h.snapshot().pendingFrames, 9);
    await h.consumeAll();
  });

  test('an oversized payload is rejected from its prefix without a body', async () => {
    const h = createHarness();
    await h.started();
    const prefix = new Uint8Array(4);
    new DataView(prefix.buffer).setUint32(0, 32 * 1024 + 1, false);
    h.sink.data(prefix);
    await settle(h.scheduler);
    assert.ok(h.snapshot().firstFault);
    assert.equal(h.events.data.length, 0);
    assert.equal(h.events.seals.length, 0);
  });

  test('the raw receive queue cannot bypass the byte window before parsing', async () => {
    const h = createHarness();
    await h.started();
    const bytes = joinBytes(...Array.from({ length: 9 }, (_, index) => h.frame(index + 1, 'x'.repeat(30 * 1024))));
    assert.ok(bytes.byteLength > 256 * 1024);
    h.sink.data(bytes);
    assert.ok(h.snapshot().rawBytes <= 256 * 1024);
    assert.ok(h.snapshot().pendingBytes <= 256 * 1024);
    await settle(h.scheduler);
    assert.ok(h.snapshot().firstFault);
    assert.equal(h.events.data.length, 0);
  });

  test('rejecting a new over-budget chunk still delivers the retained raw prefix', async () => {
    const h = createHarness();
    await h.started();
    const retained = h.output(1, 'complete-frame-awaiting-its-task');
    assert.equal(h.events.data.length, 0);
    assert.equal(h.snapshot().rawBytes, retained.byteLength);
    const rejected = new Uint8Array(256 * 1024);
    h.sink.data(rejected);
    assert.equal(h.snapshot().rawBytes, retained.byteLength);
    assert.equal(h.snapshot().rejectedDataBytes, rejected.byteLength);
    await settle(h.scheduler);
    assert.deepEqual(h.events.data.map((batch) => batch.text), ['complete-frame-awaiting-its-task']);
    assert.equal(h.snapshot().acceptedThrough, 1);
    h.message({ type: 'processResult', result: { kind: 'exited', exitCode: 0 } });
    h.message({ type: 'sourceEnd', finalFrameId: 1, disposition: { kind: 'eof' } });
    await settle(h.scheduler);
    assert.equal(h.events.seals.length, 0);
    h.sink.dataEnded();
    await settle(h.scheduler);
    assert.equal(h.events.seals.length, 1);
    assert.equal(h.events.seals[0].source.kind, 'error');
    assert.equal(h.events.seals[0].lastDataSequence, 1);
    await h.consumeAll();
  });

  test('zero output credit does not block the bounded stop operations', async () => {
    const h = createHarness();
    await h.started();
    h.sink.data(joinBytes(...Array.from({ length: 16 }, (_, index) => h.frame(index + 1, 'pending'))));
    await settle(h.scheduler);
    assert.equal(h.snapshot().pendingFrames, 16);
    const chargedBytes = h.snapshot().pendingBytes;
    const graceful = h.control.requestStop('graceful', 'graceful', 100);
    assert.strictEqual(h.control.requestStop('graceful', 'graceful', 100), graceful);
    assert.throws(() => h.control.requestStop('another-graceful', 'graceful', 100));
    const force = h.control.requestStop('force', 'force', 100);
    assert.strictEqual(h.control.requestStop('force', 'force', 100), force);
    await settle(h.scheduler);
    assert.deepEqual(h.sent('requestStop').map((message) => message.mode), ['graceful', 'force']);
    h.message({ type: 'operationObservation', operationId: 'graceful', result: { kind: 'accepted' } });
    h.message({ type: 'operationObservation', operationId: 'force', result: { kind: 'accepted' } });
    h.output(17, 'beyond-the-frame-window');
    await settle(h.scheduler);
    assert.ok(h.snapshot().firstFault);
    assert.equal(h.snapshot().acceptedThrough, 16);
    assert.equal(h.snapshot().pendingFrames, 16);
    assert.equal(h.snapshot().pendingBytes, chargedBytes);
    assert.equal(h.snapshot().process, undefined, 'stop acceptance must not invent a process exit');
    assert.equal(h.events.seals.length, 0);
  });

  test('process exit does not discard later tail or await authority consumption to seal', async () => {
    const h = createHarness();
    await h.started();
    h.message({ type: 'processResult', result: { kind: 'exited', exitCode: 7 } });
    h.output(1, 'final-tail\u001b[3;7H');
    await settle(h.scheduler);
    assert.equal(h.events.data[0].text, 'final-tail\u001b[3;7H');
    assert.equal(h.events.seals.length, 0);
    h.message({ type: 'sourceEnd', finalFrameId: 1, disposition: { kind: 'eof' } });
    await settle(h.scheduler);
    assert.equal(h.events.seals.length, 1);
    assert.equal(h.events.seals[0].source.kind, 'eof');
    assert.equal(h.events.seals[0].process.exitCode, 7);
    assert.equal(h.events.seals[0].lastDataSequence, 1);
    assert.equal(h.snapshot().consumedThrough, 0);
    await h.consumeAll();
    assert.equal(h.events.seals.length, 1);
  });

  test('a source result cannot seal while the process observation remains pending', async () => {
    const h = createHarness();
    await h.started();
    h.message({ type: 'sourceEnd', finalFrameId: 0, disposition: { kind: 'eof' } });
    await settle(h.scheduler);
    assert.equal(h.events.seals.length, 0);
    h.message({ type: 'processResult', result: { kind: 'unconfirmed', reason: 'wait-observation-expired' } });
    await settle(h.scheduler);
    assert.equal(h.events.seals.length, 1);
    assert.equal(h.events.seals[0].process.kind, 'unconfirmed');
    assert.equal(h.events.seals[0].lastDataSequence, 0);
  });

  for (const finalFrameId of [0, 2]) {
    test(`sourceEnd rejects ${finalFrameId === 0 ? 'underreported' : 'unaccepted'} final frame`, async () => {
      const h = createHarness();
      await h.started();
      h.message({ type: 'processResult', result: { kind: 'exited', exitCode: 0 } });
      h.output(1, 'owned-tail');
      await settle(h.scheduler);
      h.message({ type: 'sourceEnd', finalFrameId, disposition: { kind: 'eof' } });
      await settle(h.scheduler);
      assert.ok(h.snapshot().firstFault);
      assert.equal(h.events.seals.length, 0);
      assert.equal(h.events.data[0].text, 'owned-tail');
    });
  }

  test('cancel does not erase accepted content or fabricate source EOF', async () => {
    const h = createHarness();
    await h.started();
    h.output(1, 'before-cancel');
    await settle(h.scheduler);
    const cancellation = h.control.cancelOutput('cancel', 'user-delete', 100);
    assert.strictEqual(h.control.cancelOutput('cancel', 'user-delete', 100), cancellation);
    assert.throws(() => h.control.cancelOutput('second-cancel', 'user-delete', 100));
    assert.throws(() => h.control.cancelOutput('cancel', 'different-reason', 100));
    await settle(h.scheduler);
    assert.equal(h.sent('cancelOutput').length, 1);
    assert.equal(h.events.seals.length, 0);
    assert.equal(h.snapshot().pendingFrames, 1);
    h.output(2, 'already-in-flight');
    await settle(h.scheduler);
    assert.deepEqual(h.events.data.map((batch) => batch.text), ['before-cancel', 'already-in-flight']);
    h.message({ type: 'processResult', result: { kind: 'exited', exitCode: 0 } });
    h.message({ type: 'sourceEnd', finalFrameId: 2, disposition: { kind: 'interrupted', reason: 'cancel-effective' } });
    await settle(h.scheduler);
    assert.equal(h.events.seals[0].source.kind, 'interrupted');
    await h.consumeAll();
  });

  test('control disconnect preserves complete data until the data channel ends', async () => {
    const h = createHarness();
    await h.started();
    h.output(1, 'before-disconnect');
    await settle(h.scheduler);
    h.sink.disconnected('control-lost');
    h.sink.exited();
    h.output(2, 'buffered-after-disconnect');
    await settle(h.scheduler);
    assert.equal(h.events.seals.length, 0);
    assert.deepEqual(h.events.data.map((batch) => batch.text), ['before-disconnect', 'buffered-after-disconnect']);
    h.sink.dataEnded();
    await settle(h.scheduler);
    assert.equal(h.events.seals.length, 1);
    assert.notEqual(h.events.seals[0].source.kind, 'eof');
    assert.equal(h.events.seals[0].lastDataSequence, 2);
    await h.consumeAll();
  });

  test('provider exit alone is not IPC disconnect or an execution process result', async () => {
    const h = createHarness();
    await h.started();
    h.sink.exited();
    assert.equal(h.snapshot().transport.exited, true);
    assert.equal(h.snapshot().transport.disconnected, false);
    assert.equal(h.snapshot().process, undefined);
    h.output(1, 'still-buffered-on-the-data-channel');
    await settle(h.scheduler);
    assert.equal(h.events.data[0].text, 'still-buffered-on-the-data-channel');
    assert.equal(h.events.seals.length, 0);
  });

  test('invalid UTF-8 and a truncated final frame remain errors after data end', async () => {
    for (const kind of ['invalid-utf8', 'partial-frame']) {
      const h = createHarness();
      await h.started();
      h.output(1, 'complete-prefix');
      await settle(h.scheduler);
      const invalid = kind === 'invalid-utf8'
        ? Uint8Array.of(0, 0, 0, 2, 0xc3, 0x28)
        : h.frame(2, 'truncated-final-frame').subarray(0, -3);
      h.sink.data(invalid);
      await settle(h.scheduler);
      h.sink.disconnected('transport-ended');
      h.sink.dataEnded();
      await settle(h.scheduler);
      assert.equal(h.events.seals.length, 1, kind);
      assert.equal(h.events.seals[0].source.kind, 'error', kind);
      assert.equal(h.events.seals[0].lastDataSequence, 1, kind);
      assert.deepEqual(h.events.data.map((batch) => batch.text), ['complete-prefix'], kind);
      assert.ok(h.snapshot().rawBytes > 0, 'unsettled raw responsibility must remain visible');
    }
  });

  test('duplicate or skipped frame ids cannot enter authority a second time', async () => {
    for (const frameId of [1, 3]) {
      const h = createHarness();
      await h.started();
      h.output(1, 'accepted-once');
      await settle(h.scheduler);
      h.output(frameId, 'must-not-be-applied');
      await settle(h.scheduler);
      assert.ok(h.snapshot().firstFault);
      assert.equal(h.snapshot().acceptedThrough, 1);
      assert.deepEqual(h.events.data.map((batch) => batch.text), ['accepted-once']);
    }
  });

  test('new operation deadlines must be finite and future while old observations remain idempotent', async () => {
    const h = createHarness();
    for (const deadline of [NaN, Infinity, -Infinity, 0, -1]) {
      assert.throws(() => h.control.start('invalid-start', deadline));
    }
    assert.equal(h.connectCount, 0);
    const original = await h.start('start', 100);
    h.scheduler.advanceTo(100);
    await settle(h.scheduler);
    assert.equal(original.current?.kind, 'unconfirmed');
    assert.strictEqual(h.control.start('start', 100), original);
    assert.throws(() => h.control.requestStop('stop', 'graceful', 100));
    assert.throws(() => h.control.cancelOutput('cancel', 'reason', Infinity));
    assert.equal(h.sent('start').length, 1);
  });

  test('late ready sends the original start once and preserves an existing stop intent', async () => {
    const h = createHarness({ autoReady: false });
    const start = await h.start('start', 100);
    const stop = h.control.requestStop('stop', 'graceful', 200);
    await settle(h.scheduler);
    assert.equal(h.messages.length, 0, 'ready must precede sending start or its queued stop');
    h.scheduler.advanceTo(100);
    await settle(h.scheduler);
    const first = await start.first;
    assert.equal(first.kind, 'unconfirmed');
    h.message({ type: 'ready', capabilities: ['execution-lifecycle-v1'] });
    await settle(h.scheduler);
    assert.deepEqual(h.messages.map((message) => message.type), ['start', 'requestStop']);
    h.message({ type: 'operationObservation', operationId: 'start', result: { kind: 'started', pid: 1234 } });
    h.message({ type: 'operationObservation', operationId: 'stop', result: { kind: 'accepted' } });
    h.message({ type: 'ready', capabilities: ['execution-lifecycle-v1'] });
    await settle(h.scheduler);
    assert.equal(h.snapshot().state, 'closing');
    assert.equal(start.current.kind, 'started');
    assert.equal(stop.current.kind, 'accepted');
    assert.strictEqual(await start.first, first);
    assert.equal(h.sent('start').length, 1);
    assert.equal(h.sent('requestStop').length, 1);
  });

  test('first timeout remains immutable when the original start is later confirmed', async () => {
    const h = createHarness();
    const observation = await h.start('start', 100);
    h.scheduler.advanceTo(100);
    await settle(h.scheduler);
    assert.equal(observation.current?.kind, 'unconfirmed');
    const first = await observation.first;
    assert.equal(first.kind, 'unconfirmed');
    assert.ok(h.authority.snapshot().blockedReason);
    h.message({ type: 'operationObservation', operationId: 'start', result: { kind: 'started', pid: 1234 } });
    await settle(h.scheduler);
    assert.equal(observation.current.kind, 'started');
    assert.strictEqual(await observation.first, first);
    assert.equal(first.kind, 'unconfirmed');
    assert.equal(h.sent('start').length, 1);
    assert.equal(h.connectCount, 1);
  });

  test('a failed consumption keeps credit charged and preserves the accepted prefix', async () => {
    const h = createHarness();
    await h.started();
    const bytes = h.output(1, 'accepted-before-parser-error');
    await settle(h.scheduler);
    h.consumptions[0].reject(new Error('controlled-consumer-failure'));
    await settle(h.scheduler);
    assert.ok(h.snapshot().authorityFailure);
    assert.equal(h.snapshot().pendingBytes, bytes.byteLength);
    assert.equal(h.snapshot().consumedThrough, 0);
    assert.equal(h.sent('consumed').length, 0);
    assert.equal(h.events.data[0].text, 'accepted-before-parser-error');
    assert.ok(h.authority.snapshot().blockedReason);
  });

  test('an old identity cannot change resource responsibility in the current execution', async () => {
    const h = createHarness();
    await h.started();
    h.sink.resourceAcquired('pty-owner');
    const resources = h.snapshot().resources;
    h.sink.message({
      type: 'resourceResult',
      identity: { ...h.identity, generation: 'old-binding' },
      resourceId: 'pty-owner',
      operationId: 'release',
      result: { kind: 'released' }
    });
    await settle(h.scheduler);
    assert.deepEqual(h.snapshot().resources, resources);
    assert.equal(h.events.resources.length, 0);
    assert.ok(h.snapshot().firstFault);
    assert.equal(h.authority.snapshot().active, 1);
  });

  test('late resource proof preserves first unknown and never rewrites an earlier seal', async () => {
    const h = createHarness();
    await h.started();
    h.sink.resourceAcquired('pty-owner');
    h.message({
      type: 'resourceResult', resourceId: 'pty-owner', operationId: 'release-pty',
      result: { kind: 'unknown', reason: 'release-observation-expired' }
    });
    const firstResource = h.snapshot().resources['pty-owner'].first;
    assert.equal(firstResource.kind, 'unknown');
    h.message({ type: 'processResult', result: { kind: 'unconfirmed', reason: 'wait-not-yet-confirmed' } });
    h.message({ type: 'sourceEnd', finalFrameId: 0, disposition: { kind: 'eof' } });
    await settle(h.scheduler);
    const seal = h.events.seals[0];
    assert.equal(seal.process.kind, 'unconfirmed');
    h.message({
      type: 'resourceResult', resourceId: 'pty-owner', operationId: 'release-pty', result: { kind: 'released' }
    });
    h.message({ type: 'processResult', result: { kind: 'exited', exitCode: 0 } });
    await settle(h.scheduler);
    assert.strictEqual(h.snapshot().resources['pty-owner'].first, firstResource);
    assert.equal(h.snapshot().resources['pty-owner'].current.kind, 'released');
    assert.equal(h.snapshot().process.kind, 'exited');
    assert.equal(h.events.seals.length, 1);
    assert.strictEqual(h.snapshot().seal, seal);
    assert.equal(seal.process.kind, 'unconfirmed');
  });

  test('incomplete acquisition accounting cannot retire after the known owners release', async () => {
    const h = createHarness();
    await h.started();
    h.sink.resourceAcquired('pty-owner');
    h.sink.resourceAcquired('pty-owner');
    assert.equal(h.snapshot().resourceLedgerIncomplete, true);
    assert.deepEqual(Object.keys(h.snapshot().resources).sort(), ['provider-control', 'pty-owner']);
    for (const resourceId of ['provider-control', 'pty-owner']) {
      if (resourceId === 'provider-control') h.sink.controlResourceResult({ kind: 'released' });
      else h.message({
        type: 'resourceResult', resourceId, operationId: `release-${resourceId}`, result: { kind: 'released' }
      });
    }
    h.message({ type: 'processResult', result: { kind: 'exited', exitCode: 0 } });
    h.message({ type: 'sourceEnd', finalFrameId: 0, disposition: { kind: 'eof' } });
    await settle(h.scheduler);
    assert.equal(h.events.seals.length, 1);
    assert.equal(h.snapshot().resourceLedgerIncomplete, true);
    assert.notEqual(h.snapshot().state, 'settled');
    assert.equal(h.authority.snapshot().active, 1);
    assert.ok(h.authority.snapshot().blockedReason);
    assert.equal(h.snapshot().resources['pty-owner'].current.kind, 'released');
    assert.equal(h.snapshot().resources['provider-control'].current.kind, 'released');
    h.sink.disconnected('provider-ended-with-incomplete-ledger');
    await settle(h.scheduler);
    assert.equal(h.authority.snapshot().active, 1);
    assert.notEqual(h.snapshot().state, 'settled');
  });

  test('connect failure after entering acquisition retains all owned responsibilities', async () => {
    const h = createHarness({
      connect(sink) {
        sink.resourceAcquired('partial-owner');
        throw new Error('controlled-connect-failure');
      }
    });
    const observation = await h.start();
    assert.equal(observation.current?.kind, 'failed');
    assert.equal(observation.current.stage, 'connect');
    assert.equal((await observation.first).kind, 'failed');
    assert.equal(h.snapshot().resources['provider-control'].current, undefined);
    h.sink.controlResourceResult({ kind: 'unknown', reason: 'external-close-observation-expired' });
    assert.equal(h.snapshot().resources['provider-control'].current.kind, 'unknown');
    assert.equal(h.snapshot().resources['partial-owner'].current.kind, 'unknown');
    assert.equal(h.authority.snapshot().active, 1);
    assert.ok(h.authority.snapshot().blockedReason);
    assert.strictEqual(h.control.start('start', 100), observation);
    assert.equal(h.connectCount, 1);
    assert.equal(h.events.seals.length, 0);
  });

  test('provider messages cannot release the parent-owned control resource', async () => {
    const h = createHarness();
    await h.started();
    h.message({
      type: 'resourceResult', resourceId: 'provider-control', operationId: 'forged-release', result: { kind: 'released' }
    });
    assert.ok(h.snapshot().firstFault);
    assert.equal(h.snapshot().resources['provider-control'].current, undefined);
    h.sink.controlResourceResult({ kind: 'released' });
    assert.equal(h.snapshot().resources['provider-control'].current.kind, 'released');
  });

  test('provider acquisition messages register bounded native responsibilities before release', async () => {
    const h = createHarness();
    await h.started();
    const message = { type: 'resourceAcquired', identity: h.identity, resourceId: 'pty-master' };
    assert.deepEqual(parseProviderMessage(message), message);
    assert.throws(() => parseProviderMessage({ ...message, resourceId: 'x'.repeat(4096) }), /byte limit/);
    assert.throws(() => parseProviderMessage({ ...message, result: { kind: 'released' } }), /Unexpected protocol field/);
    h.sink.message(message);
    assert.deepEqual(h.snapshot().resources['pty-master'], {});
    h.message({ type: 'processResult', result: { kind: 'exited', exitCode: 7 } });
    h.message({ type: 'sourceEnd', finalFrameId: 0, disposition: { kind: 'eof' } });
    h.sink.controlResourceResult({ kind: 'released' });
    assert.equal(h.authority.snapshot().active, 1, 'native responsibility must prevent early retirement');
    h.message({
      type: 'resourceResult', resourceId: 'pty-master', operationId: 'release-master', result: { kind: 'released' }
    });
    assert.equal(h.snapshot().resources['pty-master'].current.kind, 'released');
    assert.equal(h.snapshot().state, 'settled');
    assert.equal(h.authority.snapshot().active, 0);
    assert.equal(h.snapshot().firstFault, undefined);
  });

  test('provider acquisition messages cannot claim the parent-owned control resource', async () => {
    const h = createHarness();
    await h.started();
    const resources = h.snapshot().resources;
    h.message({ type: 'resourceAcquired', resourceId: 'provider-control' });
    assert.match(h.snapshot().firstFault, /cannot acquire parent control/);
    assert.deepEqual(h.snapshot().resources, resources);
    assert.ok(h.authority.snapshot().blockedReason);
    h.sink.controlResourceResult({ kind: 'released' });
    assert.equal(h.snapshot().resources['provider-control'].current.kind, 'released');
  });

  test('invalid duplicate or excessive provider acquisition keeps the responsibility ledger incomplete', async () => {
    for (const mode of ['invalid', 'duplicate', 'excessive']) {
      const h = createHarness();
      await h.started();
      h.message({ type: 'resourceAcquired', resourceId: 'pty-master' });
      if (mode === 'excessive') {
        for (let index = 0; index < 15; index += 1) {
          h.message({ type: 'resourceAcquired', resourceId: `native-owner-${index}` });
        }
        assert.equal(Object.keys(h.snapshot().resources).length, 16);
      } else {
        h.message({ type: 'resourceAcquired', resourceId: mode === 'invalid' ? '../pty-master' : 'pty-master' });
      }
      assert.equal(h.snapshot().resourceLedgerIncomplete, true, mode);
      for (const resourceId of Object.keys(h.snapshot().resources)) {
        if (resourceId === 'provider-control') h.sink.controlResourceResult({ kind: 'released' });
        else h.message({
          type: 'resourceResult', resourceId, operationId: `release-${resourceId}`, result: { kind: 'released' }
        });
      }
      h.message({ type: 'processResult', result: { kind: 'exited', exitCode: 7 } });
      h.message({ type: 'sourceEnd', finalFrameId: 0, disposition: { kind: 'eof' } });
      await settle(h.scheduler);
      assert.equal(h.snapshot().resourceLedgerIncomplete, true, mode);
      assert.notEqual(h.snapshot().state, 'settled', mode);
      assert.equal(h.authority.snapshot().active, 1, mode);
      assert.ok(h.authority.snapshot().blockedReason, mode);
    }
  });

  test('pre-start failure retires only after parent control release without inventing subject facts', async () => {
    const h = createHarness({ autoReady: false });
    const observation = await h.start();
    h.sink.disconnected('startup-disconnect');
    const first = await observation.first;
    assert.equal(first.kind, 'unconfirmed');
    h.sink.startupFailed('provider-spawn-failed');
    assert.equal(observation.current.kind, 'failed');
    assert.equal(observation.current.stage, 'provider-spawn');
    assert.equal(h.authority.snapshot().active, 1);
    h.sink.controlResourceResult({ kind: 'released' });
    await settle(h.scheduler);
    assert.equal(h.snapshot().state, 'settled');
    assert.equal(h.authority.snapshot().active, 0);
    assert.equal(h.snapshot().process, undefined);
    assert.equal(h.snapshot().source, undefined);
    assert.equal(h.events.seals.length, 0);
    h.message({ type: 'ready', capabilities: ['execution-lifecycle-v1'] });
    await settle(h.scheduler);
    assert.equal(h.sent('start').length, 0);
    assert.strictEqual(await observation.first, first);
  });

  test('pre-start failure cannot discard an independently acquired unknown resource', async () => {
    const h = createHarness({ autoReady: false });
    await h.start();
    h.sink.resourceAcquired('startup-extra');
    h.sink.startupFailed('startup-aborted');
    h.sink.controlResourceResult({ kind: 'released' });
    await settle(h.scheduler);
    assert.equal(h.authority.snapshot().active, 1);
    assert.notEqual(h.snapshot().state, 'settled');
    assert.equal(h.snapshot().resources['startup-extra'].current, undefined);
    assert.equal(h.events.seals.length, 0);
  });

  test('the shared startup slot rejects another start before acquisition', async () => {
    const authority = createExecutionAuthority();
    const scheduler = createScheduler();
    const a = createHarness({ authority, scheduler });
    const b = createHarness({ authority, scheduler });
    await a.start();
    const denied = b.control.start('b-start', 100);
    assert.equal(denied.current?.kind, 'rejected-before-acquire');
    assert.equal((await denied.first).kind, 'rejected-before-acquire');
    assert.equal(b.connectCount, 0);
    assert.equal(authority.snapshot().active, 1);
    assert.equal(authority.snapshot().starting, 1);
  });

  test('transport shutdown after complete retirement does not quarantine the authority', async () => {
    const h = createHarness();
    await h.started();
    await h.retire();
    assert.equal(h.authority.snapshot().active, 0);
    h.sink.exited();
    h.sink.disconnected('expected-provider-close');
    h.sink.dataEnded();
    await settle(h.scheduler);
    assert.equal(h.snapshot().state, 'settled');
    assert.equal(h.snapshot().firstFault, undefined);
    assert.equal(h.authority.snapshot().blockedReason, undefined);
    assert.doesNotThrow(() => createHarness({ authority: h.authority, scheduler: h.scheduler }));
  });

  test('source confirmation drains an in-flight receipt and removes queued production credit', async () => {
    const receipt = deferred();
    const h = createHarness({
      send: (message) => message.type === 'consumed' ? receipt.promise : Promise.resolve()
    });
    await h.started();
    h.output(1, 'first');
    await settle(h.scheduler);
    h.output(2, 'tail');
    await settle(h.scheduler);
    assert.equal(h.sent('accepted').at(-1).throughFrameId, 2);
    h.consumptions[0].resolve();
    await settle(h.scheduler);
    h.consumptions[1].resolve();
    await settle(h.scheduler);
    assert.equal(h.snapshot().consumedThrough, 2);
    assert.deepEqual(h.sent('consumed').map((message) => message.throughFrameId), [1]);
    h.message({ type: 'sourceEnd', finalFrameId: 2, disposition: { kind: 'eof' } });
    await settle(h.scheduler);
    assert.equal(h.sent('sourceEndAccepted').length, 0, 'confirmation must not overtake an old receipt');
    receipt.resolve();
    await settle(h.scheduler);
    assert.deepEqual(h.sent('consumed').map((message) => message.throughFrameId), [1]);
    assert.deepEqual(h.sent('sourceEndAccepted'), [{ type: 'sourceEndAccepted', identity: h.identity, finalFrameId: 2 }]);
    await h.retire();
    assert.equal(h.sent('sourceEndAccepted').length, 1, 'a repeated source fact does not create another handshake');
    assert.equal(h.authority.snapshot().blockedReason, undefined);
  });

  test('source confirmation permits provider close without waiting for local consumption', async () => {
    const h = createHarness();
    await h.started();
    h.output(1, 'owned-tail');
    await settle(h.scheduler);
    h.message({ type: 'processResult', result: { kind: 'exited', exitCode: 7 } });
    h.message({ type: 'sourceEnd', finalFrameId: 1, disposition: { kind: 'eof' } });
    await settle(h.scheduler);
    assert.equal(h.sent('sourceEndAccepted').length, 1);
    assert.equal(h.snapshot().consumedThrough, 0);
    h.sink.disconnected('confirmed-source-close');
    h.sink.exited();
    h.sink.dataEnded();
    h.sink.controlResourceResult({ kind: 'released' });
    await settle(h.scheduler);
    assert.equal(h.authority.snapshot().active, 1, 'local ownership remains until actual consumption');
    await h.consumeAll();
    assert.equal(h.sent('consumed').length, 0, 'consumption after source end must not write into a retiring provider');
    assert.equal(h.snapshot().consumedThrough, 1);
    assert.equal(h.authority.snapshot().active, 0);
    assert.equal(h.authority.snapshot().blockedReason, undefined);
  });

  test('an invalid source boundary is never acknowledged', async () => {
    const h = createHarness();
    await h.started();
    h.output(1, 'accepted');
    await settle(h.scheduler);
    h.message({ type: 'sourceEnd', finalFrameId: 2, disposition: { kind: 'eof' } });
    await settle(h.scheduler);
    assert.equal(h.sent('sourceEndAccepted').length, 0);
    assert.equal(h.snapshot().source, undefined);
    assert.ok(h.authority.snapshot().blockedReason);
  });

  test('source confirmation cannot replace missing process or native release facts', async () => {
    const h = createHarness();
    await h.started();
    h.sink.resourceAcquired('pty-master');
    h.message({ type: 'sourceEnd', finalFrameId: 0, disposition: { kind: 'eof' } });
    await settle(h.scheduler);
    assert.equal(h.sent('sourceEndAccepted').length, 1);
    h.sink.disconnected('missing-final-facts');
    h.sink.dataEnded();
    h.sink.controlResourceResult({ kind: 'released' });
    await settle(h.scheduler);
    assert.equal(h.snapshot().process.kind, 'unconfirmed');
    assert.equal(h.snapshot().resources['pty-master'].current.kind, 'unknown');
    assert.equal(h.authority.snapshot().active, 1);
    assert.ok(h.authority.snapshot().blockedReason);
  });

  test('real command and receipt send failures remain faults, including after source settlement', async () => {
    for (const failedType of ['start', 'requestStop', 'cancelOutput', 'accepted', 'consumed', 'sourceEndAccepted']) {
      const h = createHarness({
        send(message) {
          if (message.type === failedType) return Promise.reject(new Error(`controlled-${failedType}-failure`));
          return Promise.resolve();
        }
      });
      if (failedType === 'start') await h.start();
      else {
        await h.started();
        if (failedType === 'requestStop') h.control.requestStop('stop', 'graceful', 100);
        else if (failedType === 'cancelOutput') h.control.cancelOutput('cancel', 'explicit-cancel', 100);
        else if (failedType === 'sourceEndAccepted') {
          h.message({ type: 'processResult', result: { kind: 'exited', exitCode: 0 } });
          h.message({ type: 'sourceEnd', finalFrameId: 0, disposition: { kind: 'eof' } });
        } else {
          h.output(1, 'owned-data');
          await settle(h.scheduler);
          if (failedType === 'consumed') await h.consumeAll();
        }
      }
      await settle(h.scheduler);
      assert.equal(h.snapshot().firstFault, 'Control send failed', failedType);
      assert.equal(h.authority.snapshot().blockedReason, 'Control send failed', failedType);
    }
  });

  test('a late start observation cannot resurrect an already retired execution', async () => {
    const h = createHarness();
    const observation = await h.start();
    await h.retire();
    assert.equal(h.authority.snapshot().active, 0);
    h.message({ type: 'operationObservation', operationId: 'start', result: { kind: 'started', pid: 1234 } });
    await settle(h.scheduler);
    assert.equal(observation.current?.kind, 'started');
    assert.equal(h.snapshot().state, 'settled');
    assert.equal(h.authority.snapshot().active, 0);
    assert.equal(h.events.seals.length, 1);
  });

  test('two executions share admission but never share output credit or consumers', async () => {
    const authority = createExecutionAuthority();
    const scheduler = createScheduler();
    const a = createHarness({ authority, scheduler });
    const b = createHarness({ authority, scheduler });
    assert.equal(authority.snapshot().active, 2);
    assert.throws(() => createHarness({ authority, scheduler }));
    await a.started();
    await b.started();
    a.output(1, 'A');
    b.output(1, 'B');
    await settle(scheduler);
    a.consumptions[0].resolve();
    await settle(scheduler);
    assert.equal(a.snapshot().pendingFrames, 0);
    assert.equal(b.snapshot().pendingFrames, 1);
    assert.equal(a.snapshot().consumedThrough, 1);
    assert.equal(b.snapshot().consumedThrough, 0);
    const stop = a.control.requestStop('stop', 'graceful', 100);
    scheduler.advanceTo(100);
    await settle(scheduler);
    assert.equal(stop.current?.kind, 'unconfirmed');
    assert.ok(authority.snapshot().blockedReason);
    b.output(2, 'B-still-active');
    await settle(scheduler);
    assert.deepEqual(b.events.data.map((batch) => batch.text), ['B', 'B-still-active']);
    await b.consumeAll();
    assert.equal(b.snapshot().consumedThrough, 2);
    await b.retire();
    assert.equal(authority.snapshot().active, 1, 'the unknown gate must be tested with a free execution slot');
    assert.throws(() => createHarness({ authority, scheduler }));
  });

  test('normal authority closure retains reservations and resumes only after they are cancelled', async () => {
    const authority = createExecutionAuthority();
    const prepared = createHarness({ authority, bind: false });
    const bound = createHarness({ authority });
    const retained = authority.closeAdmission();
    assert.deepEqual(retained, [prepared.session, bound.session]);
    assert.ok(Object.isFrozen(retained));
    assert.deepEqual(authority.listExecutions(), retained);
    assert.equal(authority.snapshot().closing, true);
    assert.equal(authority.snapshot().permanent, false);
    assert.equal(authority.snapshot().blockedReason, undefined);
    assert.throws(() => createHarness({ authority }), /closing/);
    assert.equal(authority.tryResume(), false);
    assert.equal(prepared.session.cancelReservation(), true);
    assert.equal(prepared.session.cancelReservation(), true);
    assert.throws(() => prepared.bind());
    assert.equal(bound.session.cancelReservation(), true);
    assert.equal(prepared.connectCount + bound.connectCount, 0);
    assert.equal(prepared.snapshot().process, undefined);
    assert.equal(prepared.snapshot().source, undefined);
    assert.equal(prepared.snapshot().seal, undefined);
    assert.deepEqual(prepared.snapshot().resources, {});
    assert.equal(authority.tryResume(), true);
    assert.equal(authority.snapshot().closing, false);
    assert.equal(authority.tryResume(), false);
    const next = createHarness({ authority });
    assert.equal(next.session.cancelReservation(), true);
    const start = bound.control.start('cancelled-reservation', 100);
    assert.equal((await start.first).kind, 'rejected-before-acquire');
    assert.equal(bound.connectCount, 0);
  });

  test('closure rejects a reserved start but retains an acquired startup and its stop intent', async () => {
    const authority = createExecutionAuthority();
    const starting = createHarness({ authority, autoReady: false });
    const first = await starting.start();
    const reserved = createHarness({ authority });
    assert.deepEqual(authority.closeAdmission(), [starting.session, reserved.session]);
    assert.equal(authority.snapshot().starting, 1);
    const rejected = reserved.control.start('closed-before-start', 100);
    assert.equal((await rejected.first).kind, 'rejected-before-acquire');
    assert.equal(reserved.connectCount, 0);
    assert.equal(reserved.session.cancelReservation(), false);
    assert.equal(starting.session.cancelReservation(), false);
    assert.equal(authority.tryResume(), false);
    const stop = starting.control.requestStop('close-stop', 'graceful', 200);
    starting.message({ type: 'ready', capabilities: ['execution-lifecycle-v1'] });
    await settle(starting.scheduler);
    assert.deepEqual(starting.messages.map(message => message.type), ['start', 'requestStop']);
    starting.message({ type: 'operationObservation', operationId: 'start', result: { kind: 'started', pid: 1234 } });
    starting.message({ type: 'operationObservation', operationId: 'close-stop', result: { kind: 'accepted' } });
    assert.equal((await first.first).kind, 'started');
    assert.equal((await stop.first).kind, 'accepted');
    await starting.retire();
    assert.equal(starting.session.cancelReservation(), false);
    assert.equal(authority.tryResume(), true);
  });

  test('permanent closure and quarantine cannot be cleared by emptying the execution map', () => {
    const permanent = createExecutionAuthority();
    const pending = createHarness({ authority: permanent });
    permanent.closeAdmission();
    permanent.closeAdmission(true);
    permanent.closeAdmission(false);
    assert.equal(pending.session.cancelReservation(), true);
    assert.equal(permanent.snapshot().permanent, true);
    assert.equal(permanent.tryResume(), false);
    assert.throws(() => createHarness({ authority: permanent }), /closing/);
    const quarantined = createExecutionAuthority();
    quarantined.closeAdmission();
    quarantined.quarantine('retained-unknown');
    assert.equal(quarantined.tryResume(), false);
    assert.equal(quarantined.snapshot().blockedReason, 'retained-unknown');
    assert.throws(() => createHarness({ authority: quarantined }), /quarantined/);
  });

  test('sealed consumption waits for later batches instead of only the already queued first batch', async () => {
    const h = createHarness();
    await h.started();
    assert.throws(() => h.session.waitForSealedConsumption(), /sealed/);
    h.sink.data(joinBytes(...Array.from({ length: 9 }, (_, index) => h.frame(index + 1, `tail-${index}`))));
    await settle(h.scheduler);
    assert.equal(h.snapshot().acceptedThrough, 9);
    assert.equal(h.consumptions.length, 1);
    h.message({ type: 'processResult', result: { kind: 'exited', exitCode: 7 } });
    h.message({ type: 'sourceEnd', finalFrameId: 9, disposition: { kind: 'eof' } });
    h.sink.controlResourceResult({ kind: 'released' });
    const waiting = h.session.waitForSealedConsumption();
    assert.strictEqual(h.session.waitForSealedConsumption(), waiting);
    let observed;
    void waiting.then(result => { observed = result; });
    await settle(h.scheduler);
    assert.equal(observed, undefined);
    h.consumptions[0].resolve();
    await settle(h.scheduler);
    assert.equal(h.snapshot().consumedThrough, 4);
    assert.equal(observed, undefined);
    h.consumptions[1].resolve();
    await settle(h.scheduler);
    assert.equal(h.snapshot().consumedThrough, 8);
    assert.equal(observed, undefined);
    h.consumptions[2].resolve();
    await settle(h.scheduler);
    assert.deepEqual(await waiting, { kind: 'consumed', throughDataSequence: 9 });
    assert.ok(Object.isFrozen(await waiting));
    assert.equal(h.snapshot().state, 'settled');
  });

  test('zero-frame sealed consumption does not pretend the control resource was released', async () => {
    const h = createHarness();
    await h.started();
    h.message({ type: 'processResult', result: { kind: 'exited', exitCode: 0 } });
    h.message({ type: 'sourceEnd', finalFrameId: 0, disposition: { kind: 'eof' } });
    assert.deepEqual(await h.session.waitForSealedConsumption(), { kind: 'consumed', throughDataSequence: 0 });
    assert.equal(h.snapshot().resources['provider-control'].current, undefined);
    assert.equal(h.authority.snapshot().active, 1);
    h.authority.closeAdmission();
    assert.equal(h.authority.tryResume(), false);
    h.sink.controlResourceResult({ kind: 'released' });
    await settle(h.scheduler);
    assert.equal(h.authority.tryResume(), true);
  });

  test('sealed consumption failure remains failed when resource facts arrive later', async () => {
    const h = createHarness();
    await h.started();
    h.output(1, 'retained-on-consumer-failure');
    await settle(h.scheduler);
    h.message({ type: 'processResult', result: { kind: 'exited', exitCode: 0 } });
    h.message({ type: 'sourceEnd', finalFrameId: 1, disposition: { kind: 'eof' } });
    const waiting = h.session.waitForSealedConsumption();
    h.consumptions[0].reject(new Error('intentional-consumption-failure'));
    await settle(h.scheduler);
    const first = await waiting;
    assert.deepEqual(first, { kind: 'failed', throughDataSequence: 0, reason: 'Authority consumption failed' });
    h.sink.controlResourceResult({ kind: 'released' });
    await settle(h.scheduler);
    assert.strictEqual(await h.session.waitForSealedConsumption(), first);
    assert.equal(h.snapshot().pendingFrames, 1);
    assert.notEqual(h.snapshot().state, 'settled');
  });

  test('state notifications coalesce settled facts and preserve first unknown after late release', async () => {
    const observed = [];
    const h = createHarness({ stateChanged: (eventIdentity, snapshot) => observed.push({ eventIdentity, snapshot }) });
    await h.started();
    const initialCount = observed.length;
    h.sink.resourceAcquired('late-owner');
    h.message({ type: 'resourceResult', resourceId: 'late-owner', operationId: 'late-release',
      result: { kind: 'unknown', reason: 'release-not-confirmed' } });
    const first = h.snapshot().resources['late-owner'].first;
    h.message({ type: 'processResult', result: { kind: 'exited', exitCode: 0 } });
    h.message({ type: 'sourceEnd', finalFrameId: 0, disposition: { kind: 'eof' } });
    h.sink.controlResourceResult({ kind: 'released' });
    h.authority.closeAdmission();
    await settle(h.scheduler);
    assert.equal(observed.length, initialCount + 1);
    assert.deepEqual(observed.at(-1).eventIdentity, h.identity);
    assert.equal(observed.at(-1).snapshot.resources['provider-control'].current.kind, 'released');
    assert.equal(observed.at(-1).snapshot.resources['late-owner'].current.kind, 'unknown');
    assert.equal(h.authority.tryResume(), false);
    h.message({ type: 'resourceResult', resourceId: 'late-owner', operationId: 'late-release', result: { kind: 'released' } });
    await settle(h.scheduler);
    assert.equal(observed.length, initialCount + 2);
    assert.equal(observed.at(-1).snapshot.state, 'settled');
    assert.strictEqual(observed.at(-1).snapshot.resources['late-owner'].first, first);
    assert.equal(h.authority.snapshot().active, 0);
    assert.equal(h.authority.tryResume(), false, 'late evidence does not erase quarantine');
  });

  test('an idempotent state observer can cancel a reservation without recursively notifying', async () => {
    let notifications = 0;
    let h;
    h = createHarness({ stateChanged: () => {
      notifications++;
      assert.equal(h.session.cancelReservation(), true);
    } });
    assert.equal(notifications, 0, 'state changes are observed after the synchronous transition');
    await settle(h.scheduler);
    assert.equal(notifications, 2);
    assert.equal(h.snapshot().state, 'settled');
    assert.equal(h.connectCount, 0);
    assert.equal(h.scheduler.taskCount, 0);
  });

  test('state notifications expose stop intent and source settlement before process confirmation', async () => {
    const observed = [];
    const h = createHarness({ stateChanged: (_eventIdentity, snapshot) => observed.push(snapshot) });
    await h.started();
    const initialCount = observed.length;
    h.control.requestStop('observed-stop', 'graceful', 200);
    await settle(h.scheduler);
    assert.equal(observed.length, initialCount + 1);
    assert.equal(observed.at(-1).state, 'closing');
    assert.equal(observed.at(-1).process, undefined);
    h.message({ type: 'sourceEnd', finalFrameId: 0, disposition: { kind: 'eof' } });
    await settle(h.scheduler);
    assert.equal(observed.length, initialCount + 2);
    assert.equal(observed.at(-1).source.kind, 'eof');
    assert.equal(observed.at(-1).seal, undefined);
  });

  test('a throwing state observer is disabled without an unbounded fault notification loop', async () => {
    let notifications = 0;
    const h = createHarness({ stateChanged: () => { notifications++; throw new Error('observer-failure'); } });
    await settle(h.scheduler);
    assert.equal(notifications, 1);
    assert.equal(h.snapshot().firstFault, 'Execution state observer failed');
    assert.equal(h.events.faults.length, 1);
    assert.equal(h.session.cancelReservation(), true);
    await settle(h.scheduler);
    assert.equal(notifications, 1);
    assert.equal(h.scheduler.taskCount, 0);
  });

  test('the old gate preserves callback-order results when the deadline task is withheld', async () => {
    const h = createHarness();
    const start = await h.start('start', 100);
    h.scheduler.advanceTo(100, { runDeadlines: false });
    h.message({ type: 'operationObservation', operationId: 'start', result: { kind: 'started', pid: 1234 } });
    assert.equal((await start.first).kind, 'started');
    assert.equal(h.authority.snapshot().blockedReason, undefined);
    const stop = h.control.requestStop('stop', 'graceful', 200);
    await settle(h.scheduler);
    h.scheduler.advanceTo(201, { runDeadlines: false });
    h.message({ type: 'operationObservation', operationId: 'stop', result: { kind: 'accepted' } });
    assert.equal((await stop.first).kind, 'accepted');
    h.scheduler.advanceTo(201);
    assert.equal(h.authority.snapshot().blockedReason, undefined);
  });

  test('close observation freezes a late start timeout before updating the current result', async () => {
    for (const observedAt of [100, 101]) {
      const h = createHarness({ closeObservationV1: true });
      const start = await h.start('start', 100);
      h.scheduler.advanceTo(observedAt, { runDeadlines: false });
      h.message({ type: 'operationObservation', operationId: 'start', result: { kind: 'started', pid: 1234 } });
      const first = await start.first;
      assert.equal(first.kind, 'unconfirmed');
      assert.equal(first.stage, 'start');
      assert.equal(start.current.kind, 'started');
      assert.equal(h.authority.snapshot().starting, 0);
      assert.ok(h.authority.snapshot().blockedReason);
      h.scheduler.advanceTo(observedAt);
      assert.strictEqual(await start.first, first);
      assert.equal(start.current.kind, 'started');
      assert.equal(h.sent('start').length, 1);
    }
  });

  test('close observation classifies late control ACKs by deadline while the execution remains active', async () => {
    for (const kind of ['graceful', 'force', 'cancel']) {
      const h = createHarness({ closeObservationV1: true });
      await h.started();
      const observation = kind === 'cancel'
        ? h.control.cancelOutput(kind, 'bounded-close', 200)
        : h.control.requestStop(kind, kind, 200);
      await settle(h.scheduler);
      h.scheduler.advanceTo(200, { runDeadlines: false });
      h.message({ type: 'operationObservation', operationId: kind, result: { kind: 'accepted' } });
      const first = await observation.first;
      assert.equal(first.kind, 'unconfirmed', kind);
      assert.equal(observation.current.kind, 'accepted', kind);
      assert.ok(h.authority.snapshot().blockedReason, kind);
      h.scheduler.advanceTo(200);
      assert.strictEqual(await observation.first, first);
      assert.equal(h.snapshot().process, undefined);
      assert.equal(h.snapshot().source, undefined);
    }
  });

  test('close observation preserves a timely ACK when scheduled notifications run after its deadline', async () => {
    const h = createHarness({ closeObservationV1: true, stateChanged: () => {} });
    await h.started();
    const stop = h.control.requestStop('stop', 'graceful', 200);
    await settle(h.scheduler);
    h.scheduler.advanceTo(199, { runDeadlines: false });
    h.message({ type: 'operationObservation', operationId: 'stop', result: { kind: 'accepted' } });
    h.scheduler.advanceTo(201);
    await settle(h.scheduler);
    assert.equal((await stop.first).kind, 'accepted');
    assert.equal(stop.current.kind, 'accepted');
    assert.equal(h.authority.snapshot().blockedReason, undefined);
  });

  test('missing control ACKs after factual retirement remain unknown without new quarantine', async () => {
    for (const kind of ['graceful', 'force', 'cancel']) {
      const h = createHarness({ closeObservationV1: true });
      await h.started();
      const observation = kind === 'cancel'
        ? h.control.cancelOutput(kind, 'bounded-close', 200)
        : h.control.requestStop(kind, kind, 200);
      await settle(h.scheduler);
      h.output(1, 'retained tail');
      await settle(h.scheduler);
      await h.retire();
      assert.equal(h.snapshot().consumedThrough, 1);
      assert.equal(h.authority.snapshot().active, 0);
      h.scheduler.advanceTo(200);
      const first = await observation.first;
      assert.equal(first.kind, 'unconfirmed', kind);
      assert.equal(observation.current.kind, 'unconfirmed', kind);
      assert.equal(h.authority.snapshot().blockedReason, undefined, kind);
      const repeated = kind === 'cancel'
        ? h.control.cancelOutput(kind, 'bounded-close', 200)
        : h.control.requestStop(kind, kind, 200);
      assert.strictEqual(repeated, observation);
      h.message({ type: 'operationObservation', operationId: kind, result: { kind: 'accepted' } });
      assert.equal(observation.current.kind, 'accepted');
      assert.strictEqual(await observation.first, first);
      assert.equal(h.authority.snapshot().blockedReason, undefined);
    }

    const inFlightStart = deferred();
    const queued = createHarness({ closeObservationV1: true,
      send: message => message.type === 'start' ? inFlightStart.promise : Promise.resolve() });
    await queued.started();
    const stop = queued.control.requestStop('queued-stop', 'graceful', 200);
    try {
      await settle(queued.scheduler);
      assert.equal(queued.sent('requestStop').length, 0);
      await queued.retire();
      queued.scheduler.advanceTo(200);
      assert.equal((await stop.first).kind, 'unconfirmed');
      assert.ok(queued.authority.snapshot().blockedReason, 'an undispatched intent is not a missing provider ACK');
    } finally {
      inFlightStart.resolve();
      await settle(queued.scheduler);
    }
    assert.equal(queued.sent('requestStop').length, 1, 'the original queued intent may still be delivered after its deadline');
    assert.equal((await stop.first).kind, 'unconfirmed');
  });

  test('a late ACK at the result entry preserves the same retired missing-ACK classification', async () => {
    const h = createHarness({ closeObservationV1: true });
    await h.started();
    const stop = h.control.requestStop('stop', 'graceful', 200);
    await settle(h.scheduler);
    await h.retire();
    h.scheduler.advanceTo(200, { runDeadlines: false });
    h.message({ type: 'operationObservation', operationId: 'stop', result: { kind: 'accepted' } });
    assert.equal((await stop.first).kind, 'unconfirmed');
    assert.equal(stop.current.kind, 'accepted');
    assert.equal(h.authority.snapshot().blockedReason, undefined);
  });

  test('late factual retirement cannot retroactively exempt an ACK before a delayed deadline task', async () => {
    for (const settledAt of [199, 200, 201]) {
      const h = createHarness({ closeObservationV1: true });
      await h.started();
      const stop = h.control.requestStop('stop', 'graceful', 200);
      await settle(h.scheduler);
      h.scheduler.advanceTo(settledAt, { runDeadlines: false });
      await h.retire();
      h.scheduler.advanceTo(201);
      assert.equal((await stop.first).kind, 'unconfirmed');
      assert.equal(Boolean(h.authority.snapshot().blockedReason), settledAt >= 200, String(settledAt));
      assert.equal(h.snapshot().state, 'settled');
    }
  });

  test('provider-reported unconfirmed is never exempt as a missing control ACK', async () => {
    for (const timing of ['before-deadline', 'after-timeout', 'at-late-result']) {
      const h = createHarness({ closeObservationV1: true });
      await h.started();
      const stop = h.control.requestStop('stop', 'graceful', 200);
      await settle(h.scheduler);
      await h.retire();
      if (timing !== 'before-deadline') {
        h.scheduler.advanceTo(200, { runDeadlines: timing === 'after-timeout' });
      }
      h.message({ type: 'operationObservation', operationId: 'stop',
        result: { kind: 'unconfirmed', reason: 'provider-could-not-confirm-stop' } });
      assert.equal((await stop.first).kind, 'unconfirmed', timing);
      assert.ok(h.authority.snapshot().blockedReason, timing);
      assert.equal(h.snapshot().state, 'settled');
    }
  });

  test('start handshake and unfinished consumption do not receive the retired ACK exemption', async () => {
    const startup = createHarness({ closeObservationV1: true });
    const start = await startup.start();
    await startup.retire();
    startup.scheduler.advanceTo(100);
    assert.equal((await start.first).kind, 'unconfirmed');
    assert.ok(startup.authority.snapshot().blockedReason);

    const pending = createHarness({ closeObservationV1: true });
    await pending.started();
    const stop = pending.control.requestStop('stop', 'graceful', 200);
    await settle(pending.scheduler);
    pending.output(1, 'pending-consumption');
    await settle(pending.scheduler);
    pending.message({ type: 'processResult', result: { kind: 'exited', exitCode: 0 } });
    pending.message({ type: 'sourceEnd', finalFrameId: 1, disposition: { kind: 'eof' } });
    pending.sink.controlResourceResult({ kind: 'released' });
    assert.notEqual(pending.snapshot().state, 'settled');
    pending.scheduler.advanceTo(200);
    assert.equal((await stop.first).kind, 'unconfirmed');
    const blocked = pending.authority.snapshot().blockedReason;
    assert.ok(blocked);
    await pending.consumeAll();
    assert.equal(pending.snapshot().state, 'settled');
    assert.equal(pending.authority.snapshot().blockedReason, blocked);
  });

  test('real send failures still quarantine a retired execution after an exempt ACK timeout', async () => {
    const send = deferred();
    const h = createHarness({ closeObservationV1: true,
      send: message => message.type === 'requestStop' ? send.promise : Promise.resolve() });
    await h.started();
    const stop = h.control.requestStop('stop', 'graceful', 200);
    await settle(h.scheduler);
    await h.retire();
    h.scheduler.advanceTo(200);
    assert.equal((await stop.first).kind, 'unconfirmed');
    assert.equal(h.authority.snapshot().blockedReason, undefined);
    send.reject(new Error('actual-send-failure'));
    await settle(h.scheduler);
    assert.equal(h.snapshot().firstFault, 'Control send failed');
    assert.equal(h.authority.snapshot().blockedReason, 'Control send failed');
  });

  test('close observation preserves late-ready intent and never clears an earlier quarantine', async () => {
    const h = createHarness({ closeObservationV1: true, autoReady: false });
    const start = await h.start('start', 100);
    const stop = h.control.requestStop('stop', 'graceful', 200);
    h.scheduler.advanceTo(100);
    assert.equal((await start.first).kind, 'unconfirmed');
    const blocked = h.authority.snapshot().blockedReason;
    assert.ok(blocked);
    h.message({ type: 'ready', capabilities: ['execution-lifecycle-v1'] });
    await settle(h.scheduler);
    assert.deepEqual(h.messages.filter(message => 'operationId' in message).map(message => message.operationId), ['start', 'stop']);
    h.message({ type: 'operationObservation', operationId: 'start', result: { kind: 'started', pid: 1234 } });
    await h.retire();
    h.scheduler.advanceTo(200);
    assert.equal((await stop.first).kind, 'unconfirmed');
    assert.equal(h.authority.snapshot().blockedReason, blocked);
    assert.equal(h.sent('start').length, 1);
  });

  function createParentHarness(options = {}) {
    const executionIdentity = options.identity ?? identity();
    const scheduler = options.scheduler ?? createScheduler();
    const parentClosed = deferred();
    const terminations = [];
    const parentControl = {
      identity: executionIdentity,
      scheduler,
      expectedNativeResourceIds: options.expectedNativeResourceIds ?? ['subject'],
      closed: parentClosed.promise,
      terminate(budget) {
        terminations.push({ receiver: this, budget });
        return options.terminate?.(budget) ?? Promise.resolve({ kind: 'unknown' });
      }
    };
    const h = createHarness({ ...options, identity: executionIdentity, scheduler, parentControl,
      closeObservationV1: true, parentCleanupV1: true });
    return Object.assign(h, { parentControl, parentClosed, terminations });
  }

  async function transferParentTail(h, disposition = { kind: 'eof' }, resourceIds = ['subject']) {
    for (const resourceId of resourceIds) h.message({ type: 'resourceAcquired', resourceId });
    h.message({ type: 'processResult', result: { kind: 'exited', exitCode: 0 } });
    h.message({ type: 'sourceEnd', finalFrameId: h.snapshot().acceptedThrough, disposition });
    for (const resourceId of resourceIds) {
      h.message({ type: 'resourceResult', resourceId, operationId: `release-${resourceId}`, result: { kind: 'released' } });
    }
    await settle(h.scheduler);
  }

  test('parent cleanup validates the original contract before reserving or connecting', async () => {
    const executionIdentity = identity();
    const scheduler = createScheduler();
    const base = { identity: executionIdentity, scheduler, expectedNativeResourceIds: ['subject'],
      closed: deferred().promise, terminate: () => Promise.resolve({ kind: 'unknown' }) };
    const variants = [undefined, { ...base, identity: identity() }, { ...base, scheduler: createScheduler() },
      ...[[], Array(1), ['provider-control'], ['subject', 'subject'], ['Not-Legal'], Array.from({ length: 16 }, (_, n) => `resource-${n}`)]
        .map(expectedNativeResourceIds => ({ ...base, expectedNativeResourceIds })),
      { ...base, closed: undefined }, { ...base, terminate: undefined }];
    for (const parentControl of variants) {
      const authority = createExecutionAuthority();
      let connects = 0;
      assert.throws(() => createHarness({ identity: executionIdentity, scheduler, authority, parentControl,
        closeObservationV1: true, parentCleanupV1: true, connect: () => { connects += 1; } }));
      assert.equal(authority.snapshot().active, 0);
      assert.equal(connects, 0);
    }
    const authority = createExecutionAuthority();
    assert.throws(() => createHarness({ identity: executionIdentity, scheduler, authority,
      parentControl: base, parentCleanupV1: true }), /close observation/);
    assert.equal(authority.snapshot().active, 0);
    const legacy = createHarness({ parentControl: { malformed: true } });
    assert.equal(legacy.session.tryBeginParentCleanup(), undefined, 'the default path does not inspect or enable parent cleanup');
  });

  test('parent cleanup captures the original contract and resource inventory against later mutation', async () => {
    const ids = ['subject'];
    const h = createParentHarness({ expectedNativeResourceIds: ids });
    const originalClosed = h.parentClosed.promise;
    h.parentControl.identity = identity();
    h.parentControl.scheduler = createScheduler();
    h.parentControl.closed = Promise.resolve({ kind: 'closed', exitCode: 91, signal: null });
    h.parentControl.terminate = () => { throw new Error('mutated terminate must not be selected'); };
    ids.splice(0, 1, 'different-subject');
    await h.started();
    await transferParentTail(h);
    const claim = h.session.tryBeginParentCleanup();
    assert.equal(claim.kind, 'transferred');
    assert.strictEqual(claim.closed, originalClosed);
    assert.ok(Object.isFrozen(claim));
    assert.strictEqual(h.session.tryBeginParentCleanup(), claim);
    assert.deepEqual(await claim.terminate({ termDeadline: 20, killDeadline: 30 }), { kind: 'unknown' });
    assert.strictEqual(h.terminations[0].receiver, h.parentControl);
    assert.equal(h.terminations[0].budget.canSignal(), true);
    assert.equal(h.snapshot().resources['provider-control'].current, undefined);
  });

  test('unstarted parent claim seals late ready and queued intents with named failures', async () => {
    const h = createParentHarness({ autoReady: false });
    const start = await h.start();
    const graceful = h.control.requestStop('graceful', 'graceful', 200);
    const force = h.control.requestStop('force', 'force', 210);
    const cancel = h.control.cancelOutput('cancel', 'bounded-close', 220);
    const claim = h.session.tryBeginParentCleanup();
    assert.equal(claim.kind, 'unstarted');
    assert.strictEqual(h.session.tryBeginParentCleanup(), claim);
    assert.deepEqual(await start.first, { kind: 'failed', stage: 'parent-cleanup-before-start',
      reason: 'Parent cleanup sealed start before dispatch' });
    for (const [kind, operation] of [['graceful', graceful], ['force', force], ['cancel', cancel]]) {
      assert.deepEqual(await operation.first, { kind: 'failed', reason: `Parent cleanup sealed ${kind} before dispatch` });
    }
    assert.strictEqual(h.control.start('start', 100), start);
    assert.strictEqual(h.control.requestStop('graceful', 'graceful', 200), graceful);
    assert.strictEqual(h.control.requestStop('force', 'force', 210), force);
    assert.strictEqual(h.control.cancelOutput('cancel', 'bounded-close', 220), cancel);
    h.message({ type: 'ready', capabilities: ['execution-lifecycle-v1'] });
    await settle(h.scheduler);
    assert.deepEqual(h.messages, []);
    assert.equal(h.snapshot().process, undefined);
    assert.equal(h.snapshot().source, undefined);
    assert.equal(h.snapshot().seal, undefined);
    assert.equal(h.snapshot().firstFault, undefined);
    assert.notEqual(h.snapshot().state, 'settled');
    h.sink.controlResourceResult({ kind: 'released' });
    assert.equal(h.snapshot().state, 'settled');
    assert.equal(h.authority.snapshot().active, 0);
  });

  test('unstarted parent claim refuses new intents while exact prior observations remain addressable', async () => {
    const beforeStart = createParentHarness();
    assert.equal(beforeStart.session.tryBeginParentCleanup(), undefined);
    assert.equal(beforeStart.connectCount, 0);
    assert.equal(beforeStart.session.cancelReservation(), true);
    const h = createParentHarness({ autoReady: false });
    const start = await h.start();
    h.session.tryBeginParentCleanup();
    assert.strictEqual(h.control.start('start', 100), start);
    assert.throws(() => h.control.start('different', 100), /different parameters/);
    assert.throws(() => h.control.requestStop('new-stop', 'graceful', 200), /sealed execution intent/);
    assert.throws(() => h.control.cancelOutput('new-cancel', 'closed', 200), /sealed execution intent/);
    assert.deepEqual(h.messages, []);
  });

  test('unstarted parent claim preserves expired first observations and their quarantine', async () => {
    for (const runDeadlines of [true, false]) {
      const h = createParentHarness({ autoReady: false });
      const start = await h.start('start', 100);
      const stop = h.control.requestStop('stop', 'graceful', 100);
      h.scheduler.advanceTo(100, { runDeadlines });
      assert.equal(h.session.tryBeginParentCleanup().kind, 'unstarted');
      assert.equal((await start.first).kind, 'unconfirmed');
      assert.equal((await stop.first).kind, 'unconfirmed');
      assert.equal(start.current.kind, 'failed');
      assert.equal(start.current.stage, 'parent-cleanup-before-start');
      assert.equal(stop.current.kind, 'failed');
      const blocked = h.authority.snapshot().blockedReason;
      assert.ok(blocked);
      h.sink.controlResourceResult({ kind: 'released' });
      assert.equal(h.snapshot().state, 'settled');
      assert.equal(h.authority.snapshot().blockedReason, blocked);
    }
  });

  test('dispatched start and an in-flight send cannot claim the unstarted cleanup branch', async () => {
    const sent = deferred();
    const h = createParentHarness({ send: () => sent.promise });
    await h.start();
    assert.equal(h.sent('start').length, 1);
    assert.equal(h.session.tryBeginParentCleanup(), undefined);
    sent.resolve();
    await settle(h.scheduler);
    assert.equal(h.session.tryBeginParentCleanup(), undefined, 'send fulfillment does not undo actual start dispatch');
  });

  test('unstarted parent cleanup refuses unexpected native acquisition and pre-existing faults', async () => {
    const acquired = createParentHarness({ autoReady: false });
    await acquired.start();
    acquired.sink.resourceAcquired('subject');
    assert.equal(acquired.session.tryBeginParentCleanup(), undefined);
    const faulted = createParentHarness({ autoReady: false });
    await faulted.start();
    faulted.sink.transportFault('actual connect failure');
    assert.equal(faulted.session.tryBeginParentCleanup(), undefined);
    assert.equal(faulted.snapshot().firstFault, 'actual connect failure');
  });

  test('transferred cleanup requires the exact acquired and released native inventory', async () => {
    for (const ids of [[], ['other'], ['subject', 'extra']]) {
      const h = createParentHarness();
      await h.started();
      await transferParentTail(h, { kind: 'eof' }, ids);
      assert.equal(h.session.tryBeginParentCleanup(), undefined, JSON.stringify(ids));
    }
    for (const result of [undefined, { kind: 'unknown', reason: 'not-yet' }, { kind: 'failed', reason: 'cannot-release' }]) {
      const h = createParentHarness();
      await h.started();
      h.message({ type: 'resourceAcquired', resourceId: 'subject' });
      h.message({ type: 'processResult', result: { kind: 'exited', exitCode: 0 } });
      h.message({ type: 'sourceEnd', finalFrameId: 0, disposition: { kind: 'eof' } });
      if (result) h.message({ type: 'resourceResult', resourceId: 'subject', operationId: 'release-subject', result });
      await settle(h.scheduler);
      assert.equal(h.session.tryBeginParentCleanup(), undefined, result?.kind ?? 'unresolved');
    }
    const complete = createParentHarness({ expectedNativeResourceIds: ['subject', 'reader'] });
    await complete.started();
    await transferParentTail(complete, { kind: 'eof' }, ['reader', 'subject']);
    assert.equal(complete.session.tryBeginParentCleanup().kind, 'transferred');
  });

  test('transferred cleanup waits for the exact source acknowledgement send and all control sends', async () => {
    const ack = deferred();
    const stopSend = deferred();
    const h = createParentHarness({ send: message => message.type === 'sourceEndAccepted' ? ack.promise
      : message.type === 'requestStop' ? stopSend.promise : Promise.resolve() });
    await h.started();
    await transferParentTail(h);
    assert.equal(h.sent('sourceEndAccepted').length, 1);
    assert.equal(h.session.tryBeginParentCleanup(), undefined);
    const stop = h.control.requestStop('stop', 'graceful', 100);
    assert.equal(h.sent('requestStop').length, 0, 'queued controls block the claim as well');
    ack.resolve();
    await settle(h.scheduler);
    assert.equal(h.sent('requestStop').length, 1);
    assert.equal(h.session.tryBeginParentCleanup(), undefined);
    stopSend.resolve();
    await settle(h.scheduler);
    const claim = h.session.tryBeginParentCleanup();
    assert.equal(claim.kind, 'transferred');
    assert.strictEqual(h.control.requestStop('stop', 'graceful', 100), stop);
    assert.throws(() => h.control.requestStop('force', 'force', 200), /sealed execution intent/);
  });

  test('source acknowledgement fulfillment notifies the owner that parent cleanup became eligible', async () => {
    const ack = deferred();
    let h;
    let claimed;
    h = createParentHarness({ send: message => message.type === 'sourceEndAccepted' ? ack.promise : Promise.resolve(),
      stateChanged: () => { claimed ??= h.session.tryBeginParentCleanup(); } });
    // The first state observer sees an already-dispatched start, not an unstarted reservation.
    await h.started();
    await transferParentTail(h);
    assert.equal(claimed, undefined);
    ack.resolve();
    await settle(h.scheduler);
    assert.equal(claimed.kind, 'transferred');
  });

  test('explicit interrupted error and unknown sources remain classified during parent cleanup', async () => {
    for (const disposition of [{ kind: 'interrupted', reason: 'cancelled' }, { kind: 'error', reason: 'source-error' },
      { kind: 'unknown', reason: 'source-unknown' }]) {
      const h = createParentHarness();
      await h.started();
      await transferParentTail(h, disposition);
      const blocked = h.authority.snapshot().blockedReason;
      assert.equal(h.session.tryBeginParentCleanup().kind, 'transferred');
      assert.deepEqual(h.snapshot().source, { ...disposition, lastDataSequence: 0 });
      h.sink.disconnected('expected cleanup disconnect');
      h.sink.dataClosed('expected cleanup data close');
      h.sink.controlResourceResult({ kind: 'released' });
      await settle(h.scheduler);
      assert.equal(h.snapshot().source.kind, disposition.kind);
      assert.equal(h.snapshot().firstFault, undefined);
      assert.equal(h.authority.snapshot().blockedReason, blocked);
    }
  });

  test('synthetic lost source and rejected tail content never qualify as transferred cleanup', async () => {
    const lost = createParentHarness();
    await lost.started();
    lost.message({ type: 'resourceAcquired', resourceId: 'subject' });
    lost.message({ type: 'processResult', result: { kind: 'exited', exitCode: 0 } });
    lost.message({ type: 'resourceResult', resourceId: 'subject', operationId: 'release-subject', result: { kind: 'released' } });
    lost.sink.dataEnded();
    lost.sink.disconnected('unexpected IPC loss');
    await settle(lost.scheduler);
    assert.equal(lost.snapshot().source.kind, 'unknown');
    assert.equal(lost.session.tryBeginParentCleanup(), undefined);
    const rejected = createParentHarness();
    await rejected.started();
    await transferParentTail(rejected);
    rejected.output(1, 'outside the explicit source boundary');
    assert.ok(rejected.snapshot().rejectedDataBytes > 0);
    assert.equal(rejected.session.tryBeginParentCleanup(), undefined);
  });

  test('parent cleanup leaves accepted consumption and its final seal independent of parent termination', async () => {
    const h = createParentHarness({ terminate: () => Promise.resolve({ kind: 'closed', exitCode: 0, signal: null }) });
    await h.started();
    h.output(1, 'accepted terminal tail');
    await settle(h.scheduler);
    await transferParentTail(h);
    const consumption = h.session.waitForSealedConsumption();
    const seal = h.snapshot().seal;
    const claim = h.session.tryBeginParentCleanup();
    assert.equal(claim.kind, 'transferred');
    assert.ok(h.snapshot().pendingBytes > 0);
    assert.deepEqual(await claim.terminate({ termDeadline: 20, killDeadline: 30 }), { kind: 'closed', exitCode: 0, signal: null });
    assert.equal(h.snapshot().resources['provider-control'].current, undefined, 'terminate cannot fabricate release');
    h.sink.controlResourceResult({ kind: 'released' });
    assert.notEqual(h.snapshot().state, 'settled', 'original control release does not consume accepted content');
    await h.consumeAll();
    assert.deepEqual(await consumption, { kind: 'consumed', throughDataSequence: 1 });
    assert.equal(h.snapshot().state, 'settled');
    assert.strictEqual(h.snapshot().seal, seal);
    assert.deepEqual(h.events.data.map(batch => batch.text), ['accepted terminal tail']);
  });

  test('expected unstarted parent teardown does not fabricate execution facts or hide real transport errors', async () => {
    const h = createParentHarness({ autoReady: false });
    await h.start();
    const claim = h.session.tryBeginParentCleanup();
    await claim.terminate({ termDeadline: 20, killDeadline: 30 });
    const { canSignal } = h.terminations[0].budget;
    h.sink.disconnected('expected parent disconnect');
    h.sink.dataClosed('expected parent output close');
    h.sink.exited();
    await settle(h.scheduler);
    assert.equal(canSignal(), true);
    assert.equal(h.snapshot().process, undefined);
    assert.equal(h.snapshot().source, undefined);
    assert.equal(h.snapshot().seal, undefined);
    assert.equal(h.snapshot().firstFault, undefined);
    h.sink.transportFault('real pipe error');
    assert.equal(canSignal(), false);
    assert.equal(h.snapshot().firstFault, 'real pipe error');
    assert.ok(h.authority.snapshot().blockedReason);
  });

  test('illegal late acquisition content and conflicting original facts revoke the signal claim', async () => {
    const violations = [
      h => h.message({ type: 'resourceAcquired', resourceId: 'late-resource' }),
      h => h.output(1, 'late content'),
      h => h.message({ type: 'processResult', result: { kind: 'exited', exitCode: 1 } }),
      h => h.message({ type: 'sourceEnd', finalFrameId: 0, disposition: { kind: 'interrupted', reason: 'conflict' } }),
      h => h.message({ type: 'resourceResult', resourceId: 'subject', operationId: 'release-subject',
        result: { kind: 'failed', reason: 'conflict' } })
    ];
    for (const violate of violations) {
      const h = createParentHarness();
      await h.started();
      await transferParentTail(h);
      const claim = h.session.tryBeginParentCleanup();
      await claim.terminate({ termDeadline: 20, killDeadline: 30 });
      const { canSignal } = h.terminations[0].budget;
      assert.equal(canSignal(), true);
      violate(h);
      assert.equal(canSignal(), false);
      assert.ok(h.snapshot().firstFault);
      assert.strictEqual(h.session.tryBeginParentCleanup(), claim, 'revocation cannot create a replacement parent control');
    }
    const unstarted = createParentHarness({ autoReady: false });
    await unstarted.start();
    const claim = unstarted.session.tryBeginParentCleanup();
    await claim.terminate({ termDeadline: 20, killDeadline: 30 });
    unstarted.message({ type: 'processResult', result: { kind: 'exited', exitCode: 0 } });
    assert.equal(unstarted.terminations[0].budget.canSignal(), false);
    assert.ok(unstarted.snapshot().firstFault);
  });

  test('legal duplicate original facts and expected parent disconnect preserve an existing signal claim', async () => {
    const h = createParentHarness();
    const start = await h.started();
    await transferParentTail(h);
    const claim = h.session.tryBeginParentCleanup();
    await claim.terminate({ termDeadline: 20, killDeadline: 30 });
    h.message({ type: 'operationObservation', operationId: 'start', result: { kind: 'started', pid: 1234 } });
    h.message({ type: 'processResult', result: { kind: 'exited', exitCode: 0 } });
    h.message({ type: 'sourceEnd', finalFrameId: 0, disposition: { kind: 'eof' } });
    h.message({ type: 'resourceResult', resourceId: 'subject', operationId: 'release-subject', result: { kind: 'released' } });
    h.sink.disconnected('expected parent disconnect');
    h.sink.dataClosed('expected parent output close');
    await settle(h.scheduler);
    assert.equal(h.terminations[0].budget.canSignal(), true);
    assert.equal(h.snapshot().firstFault, undefined);
    assert.strictEqual(h.control.start('start', 100), start);
    assert.equal(h.sent('sourceEndAccepted').length, 1);
    h.sink.controlResourceResult({ kind: 'released' });
    assert.equal(h.snapshot().state, 'settled');
  });

  test('revoked unstarted parent claims cannot retire an unproved startup after parent release', async () => {
    for (const violate of [h => h.output(1, 'unexpected content'),
      h => h.sink.message({ type: 'ready', identity: identity(), capabilities: ['execution-lifecycle-v1'] })]) {
      const h = createParentHarness({ autoReady: false });
      await h.start();
      const claim = h.session.tryBeginParentCleanup();
      await claim.terminate({ termDeadline: 20, killDeadline: 30 });
      violate(h);
      h.sink.controlResourceResult({ kind: 'released' });
      await settle(h.scheduler);
      assert.equal(h.terminations[0].budget.canSignal(), false);
      assert.notEqual(h.snapshot().state, 'settled');
      assert.equal(h.authority.snapshot().active, 1);
      assert.equal(h.snapshot().process, undefined);
      assert.equal(h.snapshot().source, undefined);
      assert.equal(h.snapshot().seal, undefined);
    }
  });

  test('candidate ready requires actual interaction capability before start and retains acquired control', async () => {
    const h = createParentHarness({ profile: EXECUTION_CANDIDATE_PROFILE });
    const start = h.session.start('start', 10000);
    assert.deepEqual(await start.first, { kind: 'failed', stage: 'provider-ready',
      reason: 'Execution candidate provider lacks terminal-interaction-v1.' });
    await settle(h.scheduler);
    assert.equal(h.sent('start').length, 0);
    assert.equal(h.session.snapshot().resources['provider-control'].current, undefined);
    assert.equal(h.authority.snapshot().active, 1);
    const claim = h.session.tryBeginParentCleanup();
    assert.equal(claim.kind, 'unstarted');
    await claim.terminate({ termDeadline: 12000, killDeadline: 13000 });
    assert.equal(h.authority.snapshot().active, 1, 'termination response is not a released control resource');
    h.sink.controlResourceResult({ kind: 'released' });
    await settle(h.scheduler);
    assert.equal(h.session.snapshot().state, 'settled');
    assert.equal(h.sent('start').length, 0);
  });

  test('candidate fixture interaction declaration permits controlled start without granting legacy ready the capability', async () => {
    const h = createHarness({ profile: EXECUTION_CANDIDATE_PROFILE,
      readyCapabilities: ['execution-lifecycle-v1', 'terminal-interaction-v1'] });
    h.session.start('start', 10000);
    await settle(h.scheduler);
    assert.equal(h.sent('start').length, 1);
    const legacy = parseProviderMessage({ type: 'ready', identity: identity(), capabilities: ['execution-lifecycle-v1'] });
    assert.deepEqual(legacy.capabilities, ['execution-lifecycle-v1']);
    for (const capabilities of [['terminal-interaction-v1'], ['execution-lifecycle-v1', 'other'],
      ['execution-lifecycle-v1', 'terminal-interaction-v1', 'terminal-interaction-v1']]) {
      assert.throws(() => parseProviderMessage({ type: 'ready', identity: identity(), capabilities }));
    }
  });

  const interactive = (options = {}) => createHarness({
    readyCapabilities: ['execution-lifecycle-v1', 'terminal-interaction-v1'], ...options
  });
  const interactionMessages = h => h.messages.filter(message => message.type === 'input' || message.type === 'resize');
  const answerInteraction = (h, message, result) => h.message({
    type: 'interactionObservation', interactionId: message.interactionId, result
  });

  test('candidate launch dimensions and stop strategy reject before reserving or connecting', () => {
    for (const spec of [{ cols: undefined, rows: undefined }, { stopStrategy: undefined }]) {
      const authority = createExecutionAuthority();
      assert.throws(() => createHarness({ profile: EXECUTION_CANDIDATE_PROFILE, authority, spec }), /initial dimensions/);
      assert.equal(authority.snapshot().active, 0);
    }
    for (const extra of [{ cols: 0, rows: 24 }, { cols: 80 }, { cols: 1001, rows: 24 },
      { cols: 80, rows: 1.5 }, { stopStrategy: 'SIGTERM' }]) {
      assert.throws(() => validateLaunchSpec({ file: 'fixture', args: [], ...extra }));
    }
    assert.deepEqual(validateLaunchSpec({ file: 'fixture', args: [] }), { file: 'fixture', args: [] });
    for (const stopStrategy of ['hangup', 'interrupt-then-hangup']) {
      assert.equal(validateLaunchSpec({ file: 'fixture', args: [], cols: 90, rows: 30, stopStrategy }).stopStrategy, stopStrategy);
    }
  });

  test('interaction admission needs actual ready capability, running subject, valid sizes and a finite future deadline', async () => {
    const old = createHarness();
    await old.started();
    assert.throws(() => old.session.write('a', 100), /unsupported/);
    const h = interactive();
    assert.throws(() => h.session.write('a', 100), /admission/);
    await h.started();
    for (const value of ['', 42, '\ud800']) assert.throws(() => h.session.write(value, 100));
    for (const deadline of [0, NaN, Infinity]) assert.throws(() => h.session.write('a', deadline));
    for (const [cols, rows] of [[0, 24], [80, 0], [1001, 24], [80, 1.5]]) assert.throws(() => h.session.resize(cols, rows, 100));
    h.message({ type: 'processResult', result: { kind: 'exited', exitCode: 0 } });
    assert.throws(() => h.session.resize(80, 24, 100), /admission/);
    assert.equal(interactionMessages(h).length, 0);
  });

  test('bounded input chunks preserve Unicode and escaping, writes stay ordered while resize advances independently', async () => {
    const h = interactive();
    await h.started();
    h.output(1, 'paused output');
    await settle(h.scheduler);
    assert.equal(h.snapshot().consumedThrough, 0);
    const text = '\u{1f642}\u001b"\\'.repeat(700);
    const first = h.session.write(text, 5000);
    const resize = h.session.resize(111, 37, 5000);
    const second = h.session.write('after-resize', 5000);
    const chunks = [];
    let answered = 0;
    for (let step = 0; step < 20 && h.snapshot().interactions.pending; step++) {
      await settle(h.scheduler);
      const message = interactionMessages(h)[answered++];
      assert.ok(message);
      assert.ok(Buffer.byteLength(JSON.stringify(message)) <= 4096);
      assert.deepEqual(parseParentMessage(message), message);
      if (message.type === 'input') {
        assert.equal(Buffer.from(message.data).toString('utf8'), message.data);
        chunks.push(message.data);
        answerInteraction(h, message, { kind: 'written', writtenBytes: Buffer.byteLength(message.data) });
      } else answerInteraction(h, message, { kind: 'resized' });
    }
    assert.deepEqual(await first.first, { kind: 'written', writtenBytes: Buffer.byteLength(text) });
    assert.equal((await resize.first).kind, 'resized');
    assert.equal((await second.first).writtenBytes, Buffer.byteLength('after-resize'));
    assert.equal(chunks.slice(0, -1).join(''), text);
    assert.equal(chunks.at(-1), 'after-resize');
    const messages = interactionMessages(h);
    assert.ok(messages.filter(message => message.type === 'input').length > 2);
    assert.deepEqual(messages.map(message => message.interactionId), messages.map((_, index) => index + 1));
    assert.equal(messages[1].type, 'resize');
    assert.equal(h.snapshot().consumedThrough, 0, 'resize results must not depend on a paused output consumer');
    assert.equal(h.snapshot().interactions.pending, 0);
    assert.equal(h.snapshot().interactions.inputBytes, 0);
  });

  test('four pending caller operations reject overflow and successful calls release their bounded records', async () => {
    const h = interactive();
    await h.started();
    const calls = Array.from({ length: 4 }, (_, index) => h.session.write(`call-${index}`, 5000));
    assert.equal(EXECUTION_INTERACTION_LIMITS.pendingOperations, 4);
    assert.throws(() => h.session.resize(90, 30, 5000), /capacity/);
    assert.equal(h.snapshot().interactions.pending, 4);
    for (let index = 0; index < calls.length; index++) {
      await settle(h.scheduler);
      const message = interactionMessages(h)[index];
      answerInteraction(h, message, { kind: 'written', writtenBytes: Buffer.byteLength(message.data) });
      assert.equal((await calls[index].first).kind, 'written');
    }
    for (let index = 0; index < 12; index++) {
      const observation = h.session.resize(80 + index, 24, 5000);
      await settle(h.scheduler);
      answerInteraction(h, interactionMessages(h).at(-1), { kind: 'resized' });
      assert.equal((await observation.first).kind, 'resized');
      assert.equal(h.snapshot().interactions.pending, 0);
    }
    assert.equal(interactionMessages(h).length, 16);
  });

  test('raw input byte bound counts originals, output ACK and urgent stop remain independent, partial failure is not replayed', async () => {
    const h = interactive();
    await h.started();
    const observation = h.session.write('x'.repeat(EXECUTION_INTERACTION_LIMITS.pendingInputBytes), 5000);
    assert.throws(() => h.session.write('y', 5000), /capacity/);
    assert.equal(h.snapshot().interactions.inputBytes, 32768);
    const queued = h.session.resize(100, 40, 5000);
    h.output(1, 'tail');
    await settle(h.scheduler);
    assert.equal(h.sent('accepted').at(-1).throughFrameId, 1);
    assert.equal(h.snapshot().consumedThrough, 0);
    answerInteraction(h, interactionMessages(h).find(message => message.type === 'resize'), { kind: 'resized' });
    assert.equal((await queued.first).kind, 'resized');
    h.session.requestStop('force', 'force', 5000);
    await settle(h.scheduler);
    assert.equal(h.sent('requestStop').length, 1);
    const input = interactionMessages(h)[0];
    answerInteraction(h, input, { kind: 'failed', reason: 'partial native write', writtenBytes: 3 });
    assert.deepEqual(await observation.first, { kind: 'failed', reason: 'partial native write', writtenBytes: 3 });
    assert.equal(interactionMessages(h).length, 2);
    assert.equal(h.snapshot().interactions.pending, 0);
    assert.equal(h.snapshot().interactions.inputBytes, 0);
    assert.throws(() => h.session.write('retry', 5000), /admission/);
  });

  test('sent interaction timeout freezes first, cancels unsent calls and retains original late evidence without replay', async () => {
    const h = interactive();
    await h.started();
    const observation = h.session.write('x'.repeat(8000), 10);
    const queued = h.session.write('queued input', 10);
    await settle(h.scheduler);
    const input = interactionMessages(h)[0];
    h.scheduler.advanceTo(10);
    assert.deepEqual(await observation.first, { kind: 'unconfirmed', reason: 'Interaction observation deadline reached', writtenBytes: 0 });
    assert.equal((await queued.first).kind, 'cancelled');
    assert.equal(h.snapshot().interactions.pending, 1);
    answerInteraction(h, input, { kind: 'written', writtenBytes: Buffer.byteLength(input.data) });
    await settle(h.scheduler);
    assert.equal(observation.current.kind, 'cancelled');
    assert.equal(observation.current.writtenBytes, Buffer.byteLength(input.data));
    assert.equal((await observation.first).kind, 'unconfirmed');
    assert.equal(interactionMessages(h).length, 1);
    assert.equal(h.snapshot().interactions.pending, 0);
  });

  test('partial unknown retains its known prefix and only original late result advances current', async () => {
    const h = interactive();
    await h.started();
    const observation = h.session.write('abcdef', 10);
    await settle(h.scheduler);
    const input = interactionMessages(h)[0];
    answerInteraction(h, input, { kind: 'unconfirmed', writtenBytes: 2, reason: 'write completion unknown' });
    assert.equal((await observation.first).writtenBytes, 2);
    h.sink.disconnected('connection lost');
    assert.equal(observation.current.writtenBytes, 2);
    answerInteraction(h, input, { kind: 'failed', writtenBytes: 3, reason: 'original result' });
    assert.equal(observation.current.writtenBytes, 3);
    assert.equal((await observation.first).kind, 'unconfirmed');
    assert.equal(h.snapshot().interactions.pending, 0);
    assert.equal(interactionMessages(h).length, 1);
  });

  test('input IPC failure retains unknown sent responsibility while cancelling queued mutations', async () => {
    const gate = deferred();
    const h = interactive({ send: message => message.type === 'input' ? gate.promise : Promise.resolve() });
    await h.started();
    const input = h.session.write('command', 5000);
    const resize = h.session.resize(100, 40, 5000);
    gate.reject(new Error('controlled IPC write error'));
    await settle(h.scheduler);
    assert.equal((await input.first).kind, 'unconfirmed');
    assert.equal((await resize.first).kind, 'cancelled');
    assert.equal(h.snapshot().interactions.pending, 1);
    assert.equal(interactionMessages(h).length, 1);
    assert.throws(() => h.session.write('command', 5000), /admission/);
  });

  test('queued input checks original deadline at dispatch even when deadline callbacks are late', async () => {
    const gate = deferred();
    const h = interactive({ send: message => message.type === 'accepted' ? gate.promise : Promise.resolve() });
    await h.started();
    h.output(1, 'blocked ACK send');
    await settle(h.scheduler);
    const input = h.session.write('never sent', 10);
    h.scheduler.advanceTo(10, { runDeadlines: false });
    gate.resolve();
    await settle(h.scheduler);
    assert.equal((await input.first).kind, 'cancelled');
    assert.equal(input.current.writtenBytes, 0);
    assert.equal(interactionMessages(h).length, 0);
  });

  test('closing cancels unsent input without blocking the original urgent stop lane', async () => {
    const gate = deferred();
    const h = interactive({ send: message => message.type === 'accepted' ? gate.promise : Promise.resolve() });
    await h.started();
    h.output(1, 'blocked ACK send');
    await settle(h.scheduler);
    const input = h.session.write('never sent', 100);
    h.session.requestStop('force', 'force', 100);
    assert.equal((await input.first).kind, 'cancelled');
    gate.resolve();
    await settle(h.scheduler);
    assert.equal(interactionMessages(h).length, 0);
    assert.equal(h.sent('requestStop').length, 1);
  });

  test('invalid or stale interaction results cannot fabricate write completion', async () => {
    for (const result of [{ kind: 'written', writtenBytes: 99 }, { kind: 'written', writtenBytes: 2 },
      { kind: 'resized' }, { kind: 'failed', reason: 'missing prefix' }]) {
      const h = interactive();
      await h.started();
      const input = h.session.write('abc', 100);
      await settle(h.scheduler);
      answerInteraction(h, interactionMessages(h)[0], result);
      assert.equal((await input.first).kind, 'unconfirmed');
      assert.equal(h.snapshot().interactions.pending, 1);
      assert.match(h.snapshot().firstFault, /Invalid terminal interaction result/);
    }
  });

  test('resize bypasses an unconfirmed blocked input without reordering input or depending on output credit', async () => {
    const h = interactive();
    await h.started();
    h.output(1, 'consumer is paused');
    await settle(h.scheduler);
    const first = h.session.write('first input', 5000);
    const second = h.session.write('second input', 5000);
    const resize = h.session.resize(132, 43, 5000);
    await settle(h.scheduler);
    assert.deepEqual(interactionMessages(h).map(message => message.type), ['input', 'resize']);
    const original = interactionMessages(h)[0];
    answerInteraction(h, original, { kind: 'unconfirmed', writtenBytes: 2, reason: 'write is blocked' });
    assert.equal((await first.first).kind, 'unconfirmed');
    answerInteraction(h, interactionMessages(h)[1], { kind: 'resized' });
    assert.equal((await resize.first).kind, 'resized');
    assert.equal(h.snapshot().consumedThrough, 0);
    assert.equal(h.snapshot().interactions.pending, 2);
    assert.equal(interactionMessages(h).filter(message => message.type === 'input').length, 1);
    answerInteraction(h, original, { kind: 'written', writtenBytes: Buffer.byteLength(original.data) });
    await settle(h.scheduler);
    const next = interactionMessages(h).at(-1);
    assert.equal(next.type, 'input');
    assert.equal(next.data, 'second input');
    answerInteraction(h, next, { kind: 'written', writtenBytes: Buffer.byteLength(next.data) });
    assert.equal((await second.first).kind, 'written');
    assert.equal((await first.first).kind, 'unconfirmed');
    assert.equal(first.current.kind, 'written');
    assert.deepEqual(interactionMessages(h).map(message => message.interactionId), [1, 2, 3]);
    assert.equal(h.snapshot().interactions.pending, 0);
  });

  const failures = [];
  for (const { name, callback } of tests) {
    try {
      await callback();
      console.log(`PASS ${name}`);
    } catch (error) {
      failures.push(name);
      console.error(`FAIL ${name}`);
      console.error(error);
    }
  }
  assert.equal(failures.length, 0, `Failed adapter cases: ${failures.join('; ')}`);
  console.log(`executionSessionAdapter tests passed (${tests.length} cases; no native sessions)`);
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
