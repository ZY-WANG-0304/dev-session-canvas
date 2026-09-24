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
    advanceTo(time) {
      assert.ok(time >= now, 'the test clock must be monotonic');
      now = time;
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
  const { encodeOutputFrame, OutputCreditWindow, parseProviderMessage } = require(path.join(tempDir, 'executionLifecycle.cjs'));
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
      connect(value) {
        connectCount += 1;
        sink = value;
        options.connect?.(sink);
        if (options.autoReady !== false) {
          sink.message({
            type: 'ready',
            identity: executionIdentity,
            capabilities: ['execution-lifecycle-v1']
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
      env: {}
    }, { authority, transport, scheduler });
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
