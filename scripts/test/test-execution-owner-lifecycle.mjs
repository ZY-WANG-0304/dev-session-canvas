import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import esbuild from 'esbuild';

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'dsc-execution-owner-'));
const require = createRequire(import.meta.url);
const tests = [];
const test = (name, run) => tests.push({ name, run });
const spec = { file: 'non-native-fixture', args: [] };
const budgets = { startMs: 10, gracefulMs: 10, forceMs: 10, cancelMs: 10, settleMs: 10 };
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

function clock() {
  let now = 0;
  const tasks = [];
  const deadlines = new Set();
  return {
    now: () => now,
    scheduleTask: task => tasks.push(task),
    scheduleDeadline(at, run) {
      const entry = { at, run };
      deadlines.add(entry);
      return () => deadlines.delete(entry);
    },
    tick(at) {
      now = at;
      for (const entry of [...deadlines].sort((a, b) => a.at - b.at)) {
        if (entry.at <= now && deadlines.delete(entry)) entry.run();
      }
    },
    jump(at) { now = at; },
    async drain() {
      for (let turn = 0; turn < 20; turn++) {
        const task = tasks.shift();
        task?.();
        await new Promise(resolve => setTimeout(resolve, 1));
      }
      assert.equal(tasks.length, 0, 'the bounded owner task queue must quiesce');
    },
    pendingDeadlines: () => deadlines.size,
    deadlineTimes: () => [...deadlines].map(entry => entry.at).sort((a, b) => a - b)
  };
}

try {
  await esbuild.build({
    entryPoints: {
      owner: 'extensions/vscode/dev-session-canvas/src/panel/executionOwnerLifecycle.ts',
      protocol: 'extensions/vscode/dev-session-canvas/src/common/executionLifecycle.ts',
      tracker: 'extensions/vscode/dev-session-canvas/src/common/serializedTerminalState.ts'
    },
    bundle: true, platform: 'node', format: 'cjs', target: 'node18', outdir: tempDir,
    outExtension: { '.js': '.cjs' }
  });
  const { ExecutionOwnerLifecycle } = require(path.join(tempDir, 'owner.cjs'));
  const { encodeOutputFrame, EXECUTION_CANDIDATE_PROFILE, EXECUTION_CANDIDATE_BUDGETS,
    assertExecutionCandidateCapabilities } = require(path.join(tempDir, 'protocol.cjs'));
  const { SerializedTerminalStateTracker } = require(path.join(tempDir, 'tracker.cjs'));

  function harness(extra = {}) {
    const scheduler = clock();
    const transports = new Map();
    let factories = 0;
    const owner = new ExecutionOwnerLifecycle({
      kind: 'non-native', capabilities: ['execution-lifecycle-v1'], scheduler, budgets,
      createTransport(identity) {
        factories++;
        const transport = {
          messages: [],
          connect(sink) {
            this.sink = sink;
            sink.message({ type: 'ready', identity, capabilities: ['execution-lifecycle-v1'] });
          },
          send(message) {
            this.messages.push(message);
            if (message.type === 'start') {
              this.sink.message({ type: 'operationObservation', identity, operationId: message.operationId,
                result: { kind: 'started', pid: 123 } });
            } else if (message.type === 'requestStop' || message.type === 'cancelOutput') {
              this.sink.message({ type: 'operationObservation', identity, operationId: message.operationId,
                result: { kind: 'accepted' } });
            }
            return Promise.resolve();
          }
        };
        transports.set(identity.executionId, transport);
        return transport;
      },
      ...extra
    });
    const hooks = (overrides = {}) => ({ consume: async () => {}, flushFinal: async () => 0, ...overrides });
    const start = async (key, overrides) => {
      const record = owner.reserve(key);
      const launch = owner.options.profile ? { ...spec, cols: 80, rows: 24, stopStrategy: 'hangup' } : spec;
      assert.equal((await record.start(launch, hooks(overrides)).first).kind, 'started');
      await scheduler.drain();
      return record;
    };
    const frame = (record, frameId, text) => transports.get(record.identity.executionId).sink.data(
      encodeOutputFrame({ version: 1, identity: record.identity, frameId, text }));
    const message = (record, value) => transports.get(record.identity.executionId).sink.message({ ...value, identity: record.identity });
    const complete = async (record, finalFrameId = 0, release = true) => {
      message(record, { type: 'processResult', result: { kind: 'exited', exitCode: 0 } });
      message(record, { type: 'sourceEnd', finalFrameId, disposition: { kind: 'eof' } });
      if (release) transports.get(record.identity.executionId).sink.controlResourceResult({ kind: 'released' });
      await scheduler.drain();
    };
    return { owner, scheduler, transports, start, frame, message, complete, hooks, factories: () => factories };
  }

  test('missing capability and invalid budgets refuse before any transport factory', () => {
    const h = harness({ capabilities: [] });
    assert.throws(() => h.owner.reserve('a'), /capability/);
    assert.equal(h.factories(), 0);
    assert.throws(() => harness({ budgets: { ...budgets, settleMs: Infinity } }), /finite/);
  });

  test('close retains in-flight preparation until caller cleanup and rejects later start', async () => {
    const h = harness();
    const record = h.owner.reserve('a', 'caller-session-id');
    assert.equal(record.identity.executionId, 'caller-session-id');
    const closed = h.owner.close({ reason: 'boundary' });
    let returned = false;
    void closed.then(() => { returned = true; });
    await h.scheduler.drain();
    assert.equal(returned, false);
    assert.throws(() => record.start(spec, h.hooks()), /closed/);
    assert.equal(h.factories(), 0);
    record.abandon('preparation cleanup finished');
    assert.equal((await closed).kind, 'settled');
    assert.equal(h.owner.tryResume(), true);
    assert.equal(h.scheduler.pendingDeadlines(), 0);
  });

  test('unknown preparation cannot be erased by later cleanup or a reset', async () => {
    const h = harness();
    const record = h.owner.reserve('a');
    const closed = h.owner.close({ reason: 'reset' });
    h.scheduler.tick(40);
    assert.equal((await closed).kind, 'unconfirmed');
    record.abandon('late preparation cleanup');
    assert.equal(h.owner.snapshot().pending, 0);
    assert.equal(h.owner.tryResume(), false);
    assert.throws(() => h.owner.reserve('b'), /closed/);
    assert.equal((await closed).kind, 'unconfirmed', 'late cleanup must not rewrite the first result');
  });

  test('permanent close is idempotent and cannot reopen', async () => {
    const h = harness();
    const first = h.owner.close({ reason: 'deactivate', permanent: true });
    assert.equal(h.owner.close({ reason: 'again' }), first);
    assert.equal((await first).kind, 'settled');
    assert.equal(h.owner.tryResume(), false);
    assert.equal(h.owner.snapshot().permanent, true);
  });

  test('seal cannot overtake accepted later batches or the real tracker flush', async () => {
    const h = harness();
    const gate = deferred();
    const tracker = new SerializedTerminalStateTracker(80, 24);
    let calls = 0;
    let flushed = 0;
    let revision = 0;
    let finalState;
    try {
      const record = await h.start('a', {
        async consume(batches) {
          if (++calls === 1) await gate.promise;
          for (const batch of batches) tracker.write(batch.text, { outputSequence: ++revision });
          await tracker.flush();
        },
        async flushFinal() { flushed++; finalState = await tracker.flush(); return revision; }
      });
      for (let i = 1; i <= 10; i++) h.frame(record, i, `tail-${i}\r\n`);
      await h.scheduler.drain();
      await h.complete(record, 10);
      assert.equal(record.snapshot().adapter.seal.lastDataSequence, 10);
      assert.equal(record.snapshot().adapter.consumedThrough, 0);
      assert.equal(flushed, 0);
      gate.resolve();
      await h.scheduler.drain();
      assert.equal(calls, 3);
      assert.equal(flushed, 1);
      assert.match(finalState.data, /tail-10/);
      assert.equal(record.snapshot().terminal.finalRevision, 10);
      assert.equal(record.snapshot().settled, true);
      assert.equal(h.owner.snapshot().pending, 1, 'pending reader keeps final-state responsibility');
      record.settleReaders('lost');
      assert.equal(h.owner.snapshot().pending, 0);
    } finally { tracker.dispose(); }
  });

  test('consumer failure retains unknown responsibility and does not run final flush', async () => {
    const h = harness();
    let flushes = 0;
    const results = [];
    const record = await h.start('a', {
      consume: async () => { throw new Error('parser failed'); },
      flushFinal: async () => { flushes++; return 1; },
      finalized: result => results.push(result)
    });
    h.frame(record, 1, 'unapplied');
    await h.scheduler.drain();
    await h.complete(record, 1);
    assert.equal(flushes, 0);
    assert.equal(results[0].kind, 'failed');
    record.settleReaders('cancelled');
    assert.equal(record.snapshot().retired, false);
    assert.throws(() => h.owner.reserve('b'), /closed/);
  });

  test('final flush failure is notified once and never falls back to cached success', async () => {
    const h = harness();
    const results = [];
    const record = await h.start('a', {
      flushFinal: async () => { throw new Error('flush failed'); },
      finalized: result => results.push(result)
    });
    await h.complete(record);
    assert.equal(results.length, 1);
    assert.equal(results[0].kind, 'failed');
    assert.match(results[0].reason, /flush failed/);
    assert.equal(record.snapshot().settled, false);
  });

  test('stop escalates each command once, accepted is not settled, and late facts preserve first unknown', async () => {
    const h = harness();
    const record = await h.start('a');
    const first = record.requestStop('user-stop');
    assert.equal(record.requestStop('delete'), first);
    await h.scheduler.drain();
    h.scheduler.tick(10);
    await h.scheduler.drain();
    h.scheduler.tick(20);
    await h.scheduler.drain();
    const commands = h.transports.get(record.identity.executionId).messages.filter(m => m.type === 'requestStop' || m.type === 'cancelOutput');
    assert.deepEqual(commands.map(m => m.mode ?? 'cancel'), ['graceful', 'force', 'cancel']);
    assert.equal(record.snapshot().settled, false);
    h.scheduler.tick(40);
    assert.equal((await first).kind, 'unconfirmed');
    await h.complete(record);
    record.settleReaders('cancelled');
    assert.equal(record.snapshot().retired, true);
    assert.equal((await first).kind, 'unconfirmed');
    assert.throws(() => h.owner.reserve('b'), /closed/);
  });

  test('resource release cannot be inferred from a terminal process and source result', async () => {
    const h = harness();
    const record = await h.start('a');
    await h.complete(record, 0, false);
    record.settleReaders('cancelled');
    assert.equal(record.snapshot().terminal.kind, 'applied');
    assert.equal(record.snapshot().settled, false);
    assert.equal(h.owner.snapshot().pending, 1);
    h.transports.get(record.identity.executionId).sink.controlResourceResult({ kind: 'released' });
    await h.scheduler.drain();
    assert.equal(record.snapshot().retired, true);
  });

  test('unknown A rejects admission but does not prevent already admitted B consumption', async () => {
    const h = harness();
    const a = await h.start('a');
    let text = '';
    const b = await h.start('b', { consume: async batches => { text += batches.map(x => x.text).join(''); } });
    h.transports.get(a.identity.executionId).sink.controlResourceResult({ kind: 'unknown', reason: 'unconfirmed close' });
    assert.throws(() => h.owner.reserve('c'), /closed/);
    h.frame(b, 1, 'fresh-B');
    await h.scheduler.drain();
    await h.complete(b, 1);
    b.settleReaders('cancelled');
    assert.equal(text, 'fresh-B');
    assert.equal(b.snapshot().retired, true);
    assert.equal(h.owner.get('a'), a);
  });

  test('old execution reader callbacks cannot remove a new reservation for the same key', async () => {
    const h = harness();
    const old = await h.start('a');
    await h.complete(old);
    old.settleReaders('cancelled');
    const current = h.owner.reserve('a');
    old.settleReaders('lost');
    assert.equal(h.owner.get('a'), current);
    assert.notEqual(old.identity.generation, current.identity.generation);
    current.abandon('unused');
  });

  test('a final state observer failure cannot follow an already published successful close', async () => {
    const h = harness();
    let record;
    record = await h.start('a', {
      changed() {
        if (record?.snapshot().terminal?.kind === 'applied') throw new Error('final observer failed');
      }
    });
    record.settleReaders('cancelled');
    const closed = record.requestStop('stop');
    await h.scheduler.drain();
    await h.complete(record);
    h.scheduler.tick(40);
    assert.equal((await closed).kind, 'unconfirmed');
    assert.equal(h.owner.get('a'), record);
    assert.equal(record.snapshot().settled, false);
  });

  test('reader settlement from a state callback is included in the same retirement decision', async () => {
    const h = harness();
    let record;
    record = await h.start('a', {
      changed() {
        if (record?.snapshot().terminal?.kind === 'applied') record.settleReaders('lost');
      }
    });
    await h.complete(record);
    assert.equal(record.snapshot().retired, true);
    assert.equal(h.owner.snapshot().pending, 0);
  });

  const observedHarness = (extra = {}) => harness({
    capabilities: ['execution-lifecycle-v1', 'execution-close-observation-v1'],
    budgets: { ...budgets, naturalDrainMs: 5 }, ...extra
  });
  const commands = (h, record) => h.transports.get(record.identity.executionId).messages
    .filter(message => message.type === 'requestStop' || message.type === 'cancelOutput');

  test('close observation requires an explicit valid natural budget and leaves the legacy natural path unchanged', async () => {
    for (const naturalDrainMs of [undefined, 0, -1, Infinity, NaN, 0x7fffffff]) {
      assert.throws(() => observedHarness({ budgets: { ...budgets, naturalDrainMs } }), /natural drain budget/);
    }
    const h = harness();
    const record = await h.start('legacy');
    h.message(record, { type: 'processResult', result: { kind: 'exited', exitCode: 0 } });
    h.scheduler.tick(100);
    await h.scheduler.drain();
    assert.equal(record.snapshot().closeObservation, undefined);
    assert.equal(commands(h, record).length, 0);
    assert.equal(h.scheduler.pendingDeadlines(), 0);
    await h.complete(record);
    record.settleReaders('lost');
  });

  test('natural exit drains then cancels the source without stopping the subject or restarting the observation', async () => {
    const h = observedHarness();
    const record = await h.start('natural');
    h.message(record, { type: 'processResult', result: { kind: 'exited', exitCode: 7 } });
    const initial = record.snapshot().closeObservation;
    assert.equal(initial.trigger, 'natural-exit');
    assert.equal(initial.startedAt, 0);
    assert.equal(initial.forceAt, undefined);
    assert.equal(initial.cancelAt, 5);
    assert.equal(initial.finishAt, 25);
    assert.equal(initial.first, undefined);
    const first = record.requestStop('user-stop-after-natural');
    assert.strictEqual(record.requestStop('delete-after-natural'), first);
    h.scheduler.tick(4);
    await h.scheduler.drain();
    assert.equal(commands(h, record).length, 0);
    h.scheduler.tick(5);
    await h.scheduler.drain();
    assert.deepEqual(commands(h, record).map(message => message.type), ['cancelOutput']);
    assert.equal(record.snapshot().adapter.source, undefined, 'cancel acceptance is not source settlement');
    h.message(record, { type: 'sourceEnd', finalFrameId: 0, disposition: { kind: 'interrupted', reason: 'drain cancelled' } });
    h.transports.get(record.identity.executionId).sink.controlResourceResult({ kind: 'released' });
    await h.scheduler.drain();
    assert.equal((await first).kind, 'settled');
    assert.equal(record.snapshot().adapter.seal.source.kind, 'interrupted');
    assert.equal(record.snapshot().closeObservation.trigger, 'natural-exit');
    assert.equal(record.snapshot().closeObservation.finishAt, 25);
    assert.equal(record.snapshot().retired, false, 'a slow reader retains only final-state responsibility');
    assert.deepEqual(record.snapshot().closeObservation.pendingDomains, []);
    record.settleReaders('settled');
    assert.equal(record.snapshot().retired, true);
  });

  test('stop commands share finishAt while delayed phase timers catch up without extending the deadline', async () => {
    const h = observedHarness();
    const record = await h.start('stop');
    const transport = h.transports.get(record.identity.executionId);
    transport.send = function(message) { this.messages.push(message); return Promise.resolve(); };
    const first = record.requestStop('stop');
    await h.scheduler.drain();
    assert.deepEqual(h.scheduler.deadlineTimes(), [10, 20, 40, 40]);
    h.scheduler.jump(21);
    h.scheduler.tick(21);
    await h.scheduler.drain();
    assert.deepEqual(commands(h, record).map(message => message.mode ?? 'cancel'), ['graceful', 'force', 'cancel']);
    assert.deepEqual(h.scheduler.deadlineTimes(), [40, 40, 40, 40]);
    assert.equal(record.snapshot().closeObservation.finishAt, 40);
    h.scheduler.tick(40);
    assert.equal((await first).kind, 'unconfirmed');
    assert.equal(commands(h, record).length, 3);
    await h.complete(record);
    record.settleReaders('lost');
    assert.equal(record.snapshot().closeObservation.current.kind, 'settled');
    assert.equal((await first).kind, 'unconfirmed');
    assert.throws(() => h.owner.reserve('new'), /closed/);
  });

  test('a timer first handled at finishAt reports unknown without adding expired force or cancel intent', async () => {
    const h = observedHarness();
    const record = await h.start('late-timers');
    const first = record.requestStop('stop');
    await h.scheduler.drain();
    h.scheduler.tick(40);
    await h.scheduler.drain();
    assert.equal((await first).kind, 'unconfirmed');
    assert.deepEqual(commands(h, record).map(message => message.mode ?? 'cancel'), ['graceful']);
    assert.equal(record.snapshot().adapter.process, undefined);
    assert.equal(record.snapshot().adapter.source, undefined);
    await h.complete(record);
    record.settleReaders('lost');
  });

  test('facts processed at the absolute cutoff cannot overtake a delayed owner deadline callback', async () => {
    const h = observedHarness();
    const record = await h.start('cutoff');
    const first = record.requestStop('stop');
    h.scheduler.jump(40);
    await h.complete(record);
    assert.equal((await first).kind, 'unconfirmed');
    const observation = record.snapshot().closeObservation;
    assert.strictEqual(observation.first, await first);
    assert.equal(observation.current.kind, 'settled');
    assert.ok(observation.quarantineReason);
    record.settleReaders('lost');
    assert.equal(record.snapshot().retired, true);
  });

  test('late preparation cleanup preserves the original close first result', async () => {
    const h = observedHarness();
    const record = h.owner.reserve('preparing');
    const first = record.requestStop('boundary');
    assert.deepEqual(record.snapshot().closeObservation.pendingDomains, ['preparation']);
    h.scheduler.jump(40);
    record.abandon('cleanup completed at cutoff');
    assert.equal((await first).kind, 'unconfirmed');
    assert.equal(record.snapshot().closeObservation.current.kind, 'settled');
    assert.equal(record.snapshot().retired, true);
    assert.equal(h.factories(), 0);
  });

  test('stopping an already abandoned record resolves without recreating timers or owner responsibility', async () => {
    const h = observedHarness();
    const record = h.owner.reserve('abandoned');
    record.abandon('never acquired');
    const current = h.owner.reserve('abandoned');
    const first = record.requestStop('old object stop');
    assert.strictEqual(record.requestStop('repeat old stop'), first);
    assert.equal((await first).kind, 'settled');
    assert.equal(h.scheduler.pendingDeadlines(), 0);
    assert.equal(record.snapshot().closeObservation, undefined);
    assert.equal(h.owner.get('abandoned'), current);
    current.abandon('unused');
  });

  test('natural accepted output remains charged through timeout and later real tracker consumption', async () => {
    const h = observedHarness();
    const gate = deferred();
    const tracker = new SerializedTerminalStateTracker(80, 24);
    let revision = 0;
    let finalState;
    try {
      const record = await h.start('consumption', {
        async consume(batches) {
          await gate.promise;
          for (const batch of batches) tracker.write(batch.text, { outputSequence: ++revision });
          await tracker.flush();
        },
        async flushFinal() { finalState = await tracker.flush(); return revision; }
      });
      for (let i = 1; i <= 10; i++) h.frame(record, i, `accepted-${i}\r\n`);
      await h.scheduler.drain();
      await h.complete(record, 10);
      const first = record.requestStop('observe-original-natural');
      h.scheduler.tick(25);
      assert.equal((await first).kind, 'unconfirmed');
      assert.equal(record.snapshot().adapter.acceptedThrough, 10);
      assert.equal(record.snapshot().adapter.consumedThrough, 0);
      assert.ok(record.snapshot().adapter.pendingBytes > 0);
      assert.ok(record.snapshot().closeObservation.pendingDomains.includes('consumption'));
      assert.equal(record.snapshot().terminal, undefined);
      assert.equal(commands(h, record).length, 0, 'confirmed source needs no cancellation');
      gate.resolve();
      await h.scheduler.drain();
      assert.match(finalState.data, /accepted-10/);
      assert.equal(record.snapshot().terminal.finalRevision, 10);
      assert.equal(record.snapshot().closeObservation.current.kind, 'settled');
      assert.equal((await first).kind, 'unconfirmed');
      record.settleReaders('settled');
    } finally { tracker.dispose(); }
  });

  test('final flush completing exactly at cutoff preserves timeout while its real result remains applied', async () => {
    const h = observedHarness();
    const flush = deferred();
    const record = await h.start('flush', { flushFinal: () => flush.promise });
    await h.complete(record);
    const first = record.requestStop('join-natural');
    assert.deepEqual(record.snapshot().closeObservation.pendingDomains, ['final-flush']);
    h.scheduler.jump(25);
    flush.resolve(0);
    await h.scheduler.drain();
    assert.equal((await first).kind, 'unconfirmed');
    assert.equal(record.snapshot().terminal.kind, 'applied');
    assert.equal(record.snapshot().closeObservation.current.kind, 'settled');
    record.settleReaders('settled');
  });

  test('unknown resource and source facts start failure observations without borrowing another execution quarantine', async () => {
    const h = observedHarness();
    const a = await h.start('unknown-resource');
    const b = await h.start('healthy-b');
    h.transports.get(a.identity.executionId).sink.controlResourceResult({ kind: 'unknown', reason: 'release pending' });
    assert.equal(a.snapshot().closeObservation.trigger, 'failure');
    assert.equal(a.snapshot().closeObservation.reason, 'release pending');
    assert.equal(b.snapshot().closeObservation, undefined);
    await h.complete(b);
    assert.equal(b.snapshot().closeObservation.trigger, 'natural-exit');
    assert.equal(b.snapshot().closeObservation.first.kind, 'settled');
    b.settleReaders('settled');
    await h.complete(a);
    a.settleReaders('lost');
    assert.throws(() => h.owner.reserve('blocked'), /closed/);

    const source = observedHarness();
    const record = await source.start('unknown-source');
    source.message(record, { type: 'sourceEnd', finalFrameId: 0, disposition: { kind: 'unknown', reason: 'source unknown' } });
    await source.scheduler.drain();
    assert.equal(record.snapshot().closeObservation.trigger, 'failure');
    assert.equal(record.snapshot().closeObservation.reason, 'source unknown');
    source.message(record, { type: 'processResult', result: { kind: 'exited', exitCode: 0 } });
    source.transports.get(record.identity.executionId).sink.controlResourceResult({ kind: 'released' });
    await source.scheduler.drain();
    assert.equal(record.snapshot().adapter.seal.source.kind, 'unknown');
    assert.equal(record.snapshot().closeObservation.first.kind, 'settled');
    assert.ok(record.snapshot().closeObservation.quarantineReason);
    record.settleReaders('lost');
  });

  test('a real consume failure starts one failure observation and never becomes a synthetic applied terminal', async () => {
    const h = observedHarness();
    const record = await h.start('consume-failed', { consume: async () => { throw new Error('consume rejected'); } });
    h.frame(record, 1, 'retained tail');
    await h.scheduler.drain();
    assert.equal(record.snapshot().closeObservation.trigger, 'failure');
    await h.complete(record, 1);
    const first = record.requestStop('same-failure');
    h.scheduler.tick(40);
    assert.equal((await first).kind, 'unconfirmed');
    assert.equal(record.snapshot().terminal.kind, 'failed');
    assert.ok(record.snapshot().closeObservation.pendingDomains.includes('consumption'));
    assert.equal(record.snapshot().retired, false);
  });

  test('real final flush failure remains failed and a reentrant final observer cannot publish successful close', async () => {
    const failedFlush = observedHarness();
    const flushRecord = await failedFlush.start('flush-failed', { flushFinal: async () => { throw new Error('flush rejected'); } });
    await failedFlush.complete(flushRecord);
    const flushFirst = flushRecord.requestStop('same-natural-observation');
    failedFlush.scheduler.tick(25);
    assert.equal((await flushFirst).kind, 'unconfirmed');
    assert.equal(flushRecord.snapshot().terminal.kind, 'failed');
    assert.ok(flushRecord.snapshot().closeObservation.pendingDomains.includes('final-flush'));

    const h = observedHarness();
    let record;
    record = await h.start('observer', {
      finalized() {
        assert.equal(record.snapshot().settled, false);
        record.settleReaders('settled');
        assert.equal(record.snapshot().closeObservation.first, undefined);
        throw new Error('final observer rejected');
      }
    });
    await h.complete(record);
    const first = record.requestStop('join-failed-observer');
    assert.ok(record.snapshot().closeObservation.pendingDomains.includes('observer'));
    h.scheduler.tick(25);
    assert.equal((await first).kind, 'unconfirmed');
    assert.equal(record.snapshot().settled, false);
    assert.equal(record.snapshot().retired, false);
  });

  test('startup first unconfirmed creates a failure observation even without a process fact', async () => {
    let transport;
    const h = observedHarness({
      createTransport(identity) {
        transport = {
          messages: [], connect(sink) { this.sink = sink; },
          send(message) { this.messages.push(message); return Promise.resolve(); }
        };
        return transport;
      }
    });
    const record = h.owner.reserve('starting');
    const start = record.start(spec, h.hooks());
    h.scheduler.tick(10);
    assert.equal((await start.first).kind, 'unconfirmed');
    await h.scheduler.drain();
    const observation = record.snapshot().closeObservation;
    assert.equal(observation.trigger, 'failure');
    assert.equal(observation.startedAt, 10);
    assert.equal(observation.finishAt, 50);
    assert.equal(record.snapshot().adapter.process, undefined);
    const first = record.requestStop('join-start-failure');
    h.scheduler.tick(50);
    assert.equal((await first).kind, 'unconfirmed');
    assert.equal(record.snapshot().retired, false);
    assert.equal(transport.messages.length, 0, 'no ready does not imply a physically dispatched stop');
  });

  const parentCapabilities = ['execution-lifecycle-v1', 'execution-close-observation-v1', 'execution-parent-cleanup-v1'];
  const parentBudgets = { ...budgets, naturalDrainMs: 5, parentTermMs: 3, parentKillMs: 3 };

  function parentHarness({ ready = true, terminate, send, capabilities = parentCapabilities,
    readyCapabilities = ['execution-lifecycle-v1'], ownerOptions = {} } = {}) {
    let h;
    h = harness({
      capabilities, budgets: parentBudgets, ...ownerOptions,
      createTransport(identity) {
        const closed = deferred();
        const transport = {
          messages: [], cleanup: [], closed,
          parentControl: Object.freeze({
            identity, scheduler: h.scheduler, expectedNativeResourceIds: Object.freeze(['subject']),
            closed: closed.promise,
            terminate(budget) {
              transport.cleanup.push(budget);
              return terminate?.(transport, budget) ?? Promise.resolve({ kind: 'closed', exitCode: 0, signal: null });
            }
          }),
          connect(sink) {
            this.sink = sink;
            if (ready) sink.message({ type: 'ready', identity, capabilities: readyCapabilities });
          },
          send(message) {
            this.messages.push(message);
            if (message.type === 'start') {
              this.sink.message({ type: 'resourceAcquired', identity, resourceId: 'subject' });
              this.sink.message({ type: 'operationObservation', identity, operationId: message.operationId,
                result: { kind: 'started', pid: 123 } });
            } else if (message.type === 'requestStop' || message.type === 'cancelOutput') {
              this.sink.message({ type: 'operationObservation', identity, operationId: message.operationId,
                result: { kind: 'accepted' } });
            }
            return send?.(this, message) ?? Promise.resolve();
          }
        };
        h.transports.set(identity.executionId, transport);
        return transport;
      }
    });
    return h;
  }

  const nativeResult = (h, record, result = { kind: 'released' }) => h.message(record, {
    type: 'resourceResult', resourceId: 'subject', operationId: 'subject-release', result
  });

  test('parent cleanup validates capability and fixed budgets before creating any transport', () => {
    let factories = 0;
    const createTransport = () => { factories++; throw new Error('must not create transport'); };
    assert.throws(() => harness({ capabilities: ['execution-lifecycle-v1', 'execution-parent-cleanup-v1'],
      budgets: parentBudgets, createTransport }), /Parent cleanup requires close observation/);
    for (const parentTermMs of [undefined, 0, -1, Infinity, NaN, 8]) {
      assert.throws(() => harness({ capabilities: parentCapabilities,
        budgets: { ...parentBudgets, parentTermMs }, createTransport }), /Parent cleanup requires/);
    }
    for (const parentKillMs of [undefined, 0, -1, Infinity, NaN, 8]) {
      assert.throws(() => harness({ capabilities: parentCapabilities,
        budgets: { ...parentBudgets, parentKillMs }, createTransport }), /Parent cleanup requires/);
    }
    assert.equal(factories, 0);
    assert.doesNotThrow(() => harness({ capabilities: parentCapabilities,
      budgets: { ...parentBudgets, parentTermMs: 5, parentKillMs: 5 }, createTransport }));
  });

  test('transferred parent cleanup runs once while consumption is paused and its return is not release evidence', async () => {
    const consume = deferred();
    let record;
    let flushes = 0;
    const h = parentHarness({ terminate(transport, budget) {
      assert.equal(record.snapshot().closeObservation.parentCleanup.kind, 'transferred');
      assert.equal(budget.canSignal(), true);
      record.requestStop('reentrant-cleanup');
      return Promise.resolve({ kind: 'closed', exitCode: 0, signal: null });
    } });
    record = await h.start('paused', {
      consume: () => consume.promise,
      flushFinal: async () => { flushes++; return 1; }
    });
    const transport = h.transports.get(record.identity.executionId);
    h.frame(record, 1, 'accepted tail');
    await h.scheduler.drain();
    nativeResult(h, record);
    await h.complete(record, 1, false);
    const first = record.requestStop('join-natural');
    assert.deepEqual(record.snapshot().closeObservation.parentCleanup, { at: 19, termDeadline: 22, killDeadline: 25 });
    h.scheduler.tick(18);
    await h.scheduler.drain();
    assert.equal(transport.cleanup.length, 0);
    h.scheduler.tick(19);
    await h.scheduler.drain();
    assert.equal(transport.cleanup.length, 1);
    assert.equal(transport.cleanup[0].termDeadline, 22);
    assert.equal(transport.cleanup[0].killDeadline, 25);
    assert.equal(record.snapshot().adapter.consumedThrough, 0);
    assert.equal(record.snapshot().adapter.resources['provider-control'].current, undefined);
    assert.equal(record.snapshot().closeObservation.parentCleanup.first.kind, 'closed');
    assert.equal(record.snapshot().settled, false);
    assert.equal(flushes, 0);
    transport.sink.controlResourceResult({ kind: 'released' });
    await h.scheduler.drain();
    assert.equal(record.snapshot().settled, false, 'provider release does not consume accepted terminal data');
    consume.resolve();
    await h.scheduler.drain();
    assert.equal((await first).kind, 'settled');
    assert.equal(flushes, 1);
    assert.equal(record.snapshot().retired, false, 'reader responsibility remains independent');
    record.settleReaders('settled');
    assert.equal(record.snapshot().retired, true);
    assert.equal(transport.cleanup.length, 1);
  });

  test('unstarted parent cleanup seals late ready and settles only actual control release without finalizing a terminal', async () => {
    const h = parentHarness({ ready: false });
    let finalized = 0;
    let flushes = 0;
    const record = h.owner.reserve('unstarted');
    const started = record.start(spec, h.hooks({
      flushFinal: async () => { flushes++; return 0; }, finalized: () => { finalized++; }
    }));
    const transport = h.transports.get(record.identity.executionId);
    h.scheduler.tick(10);
    assert.equal((await started.first).kind, 'unconfirmed');
    await h.scheduler.drain();
    const first = record.requestStop('join-start-timeout');
    h.scheduler.tick(44);
    await h.scheduler.drain();
    assert.equal(transport.cleanup.length, 1);
    assert.equal(record.snapshot().adapter.parentCleanup, 'unstarted');
    assert.equal(record.snapshot().closeObservation.parentCleanup.kind, 'unstarted');
    assert.equal(record.snapshot().settled, false);
    h.message(record, { type: 'ready', capabilities: ['execution-lifecycle-v1'] });
    await h.scheduler.drain();
    assert.equal(transport.messages.length, 0, 'late ready cannot send start or queued close commands');
    assert.equal(flushes, 0);
    assert.equal(finalized, 0);
    assert.equal(record.snapshot().adapter.process, undefined);
    assert.equal(record.snapshot().adapter.source, undefined);
    assert.equal(record.snapshot().adapter.seal, undefined);
    transport.sink.controlResourceResult({ kind: 'released' });
    await h.scheduler.drain();
    assert.equal((await first).kind, 'settled');
    assert.equal(record.snapshot().adapter.state, 'settled');
    assert.equal(record.snapshot().terminal, undefined);
    assert.equal(record.snapshot().retired, false);
    assert.equal(finalized, 0);
    record.settleReaders('lost');
    assert.equal(record.snapshot().retired, true);
    assert.equal((await started.first).kind, 'unconfirmed');

    for (const unexpected of ['late-data', 'stale-identity']) {
      const unsafe = parentHarness({ ready: false });
      const pending = unsafe.owner.reserve(unexpected);
      pending.start(spec, unsafe.hooks());
      const original = unsafe.transports.get(pending.identity.executionId);
      unsafe.scheduler.tick(10);
      await unsafe.scheduler.drain();
      const stopped = pending.requestStop('join-start-timeout');
      unsafe.scheduler.tick(44);
      await unsafe.scheduler.drain();
      assert.equal(original.cleanup.length, 1);
      if (unexpected === 'late-data') unsafe.frame(pending, 1, 'cannot belong to an unstarted execution');
      else original.sink.message({ type: 'ready', identity: { ...pending.identity, executionId: 'stale-execution' },
        capabilities: ['execution-lifecycle-v1'] });
      original.sink.controlResourceResult({ kind: 'released' });
      await unsafe.scheduler.drain();
      assert.equal(original.cleanup[0].canSignal(), false, unexpected);
      assert.notEqual(pending.snapshot().adapter.state, 'settled', unexpected);
      assert.equal(pending.snapshot().settled, false, unexpected);
      unsafe.scheduler.tick(50);
      assert.equal((await stopped).kind, 'unconfirmed', unexpected);
      pending.settleReaders('lost');
      assert.equal(pending.snapshot().retired, false, unexpected);
    }
  });

  test('unsafe transfer facts deny parent cleanup without borrowing successful terminal consumption', async () => {
    for (const unsafe of ['missing-release', 'unknown-release', 'missing-source', 'pending-ack']) {
      const ack = deferred();
      const h = parentHarness({ send: (_transport, message) =>
        unsafe === 'pending-ack' && message.type === 'sourceEndAccepted' ? ack.promise : undefined });
      const record = await h.start(unsafe);
      const transport = h.transports.get(record.identity.executionId);
      if (unsafe === 'unknown-release') nativeResult(h, record, { kind: 'unknown', reason: 'release unknown' });
      else if (unsafe !== 'missing-release') nativeResult(h, record);
      h.message(record, { type: 'processResult', result: { kind: 'exited', exitCode: 0 } });
      if (unsafe !== 'missing-source') h.message(record, { type: 'sourceEnd', finalFrameId: 0, disposition: { kind: 'eof' } });
      await h.scheduler.drain();
      h.scheduler.tick(record.snapshot().closeObservation.parentCleanup.at);
      await h.scheduler.drain();
      assert.equal(transport.cleanup.length, 0, unsafe);
      assert.equal(record.snapshot().closeObservation.parentCleanup.kind, undefined, unsafe);
      assert.equal(record.snapshot().settled, false, unsafe);
    }
  });

  test('late parent stage keeps original absolute deadlines and never initiates at the final cutoff', async () => {
    for (const now of [23, 25]) {
      const h = parentHarness();
      const record = await h.start(`late-${now}`);
      const transport = h.transports.get(record.identity.executionId);
      nativeResult(h, record);
      await h.complete(record, 0, false);
      const first = record.requestStop('join-natural');
      h.scheduler.tick(now);
      await h.scheduler.drain();
      assert.equal(transport.cleanup.length, now < 25 ? 1 : 0);
      if (now < 25) {
        assert.equal(transport.cleanup[0].termDeadline, 22);
        assert.equal(transport.cleanup[0].killDeadline, 25);
        h.scheduler.tick(25);
      }
      assert.equal((await first).kind, 'unconfirmed');
      assert.equal(record.snapshot().closeObservation.finishAt, 25);
    }
  });

  test('parent cleanup rejection quarantines and late real release preserves both first results', async () => {
    const failure = deferred();
    const h = parentHarness({ terminate: () => failure.promise });
    const record = await h.start('rejected');
    const transport = h.transports.get(record.identity.executionId);
    nativeResult(h, record);
    await h.complete(record, 0, false);
    const first = record.requestStop('join-natural');
    h.scheduler.tick(19);
    await h.scheduler.drain();
    failure.reject(new Error('original control rejected'));
    await h.scheduler.drain();
    const cleanupFirst = record.snapshot().closeObservation.parentCleanup.first;
    assert.equal(cleanupFirst.kind, 'failed');
    assert.match(cleanupFirst.reason, /original control rejected/);
    assert.throws(() => h.owner.reserve('blocked'), /closed/);
    h.scheduler.tick(25);
    assert.equal((await first).kind, 'unconfirmed');
    transport.sink.controlResourceResult({ kind: 'released' });
    await h.scheduler.drain();
    assert.equal(record.snapshot().closeObservation.current.kind, 'settled');
    assert.strictEqual(record.snapshot().closeObservation.parentCleanup.first, cleanupFirst);
    assert.equal((await first).kind, 'unconfirmed');
    record.settleReaders('lost');
    assert.equal(record.snapshot().retired, true);
    assert.equal(transport.cleanup.length, 1);
  });

  test('S5-only owner never invokes an available parent control', async () => {
    const h = parentHarness({ capabilities: ['execution-lifecycle-v1', 'execution-close-observation-v1'] });
    const record = await h.start('s5-only');
    const transport = h.transports.get(record.identity.executionId);
    nativeResult(h, record);
    await h.complete(record, 0, false);
    const first = record.requestStop('join-natural');
    h.scheduler.tick(25);
    assert.equal((await first).kind, 'unconfirmed');
    assert.equal(record.snapshot().closeObservation.parentCleanup, undefined);
    assert.equal(transport.cleanup.length, 0);
    transport.sink.controlResourceResult({ kind: 'released' });
    await h.scheduler.drain();
    record.settleReaders('lost');
  });

  test('owner boundary requires close observation and an explicit finite frozen budget before acquisition', () => {
    let acquisitions = 0;
    const options = {
      capabilities: ['execution-lifecycle-v1', 'execution-close-observation-v1', 'execution-owner-boundary-v1'],
      budgets: { ...budgets, naturalDrainMs: 5, boundaryMs: 60 },
      createTransport() { acquisitions++; throw new Error('must not acquire'); }
    };
    assert.throws(() => harness({ ...options, capabilities: ['execution-lifecycle-v1', 'execution-owner-boundary-v1'] }),
      /boundary/i);
    for (const value of [undefined, 0, -1, NaN, Infinity, '60', 0x80000000]) {
      assert.throws(() => harness({ ...options, budgets: { ...options.budgets, boundaryMs: value } }), /boundary/i);
    }
    const h = harness(options);
    options.budgets.boundaryMs = 1;
    assert.equal(h.owner.options.budgets.boundaryMs, 60);
    assert.equal(Object.isFrozen(h.owner.options.budgets), true);
    assert.doesNotThrow(() => harness({ ...options, budgets: { ...options.budgets, boundaryMs: 0x7fffffff } }));
    assert.doesNotThrow(() => harness({ capabilities: ['execution-lifecycle-v1'], budgets: { ...budgets, boundaryMs: NaN } }));
    assert.equal(acquisitions, 0);
  });

  test('a shorter outer boundary budget does not replace the original execution close or reader obligations', async () => {
    const h = harness({
      capabilities: ['execution-lifecycle-v1', 'execution-close-observation-v1', 'execution-owner-boundary-v1'],
      budgets: { ...budgets, naturalDrainMs: 5, boundaryMs: 1 }
    });
    const record = await h.start('short-boundary');
    const first = h.owner.close({ reason: 'short boundary', permanent: true });
    assert.equal(record.snapshot().closeObservation.finishAt, 40);
    h.scheduler.tick(1);
    await h.scheduler.drain();
    assert.equal(record.snapshot().closeObservation.first, undefined);
    assert.equal(h.owner.snapshot().pending, 1);
    await h.complete(record);
    assert.equal((await first).kind, 'settled');
    assert.strictEqual(h.owner.close({ reason: 'repeat boundary', permanent: true }), first);
    assert.equal(record.snapshot().readerOutcome, 'pending');
    assert.equal(record.snapshot().retired, false);
    record.settleReaders('lost');
    assert.equal(h.owner.snapshot().pending, 0);
  });

  test('local persistence requires both local settlement and the owner boundary before acquiring resources', () => {
    let acquisitions = 0;
    const options = {
      capabilities: ['execution-lifecycle-v1', 'execution-close-observation-v1', 'execution-owner-boundary-v1',
        'terminal-local-settlement-v1', 'terminal-local-persistence-v1'],
      budgets: { ...budgets, naturalDrainMs: 5, boundaryMs: 60 },
      createTransport() { acquisitions++; throw new Error('must not acquire'); }
    };
    for (const missing of ['terminal-local-settlement-v1', 'execution-owner-boundary-v1']) {
      assert.throws(() => harness({ ...options,
        capabilities: options.capabilities.filter(capability => capability !== missing) }), /local persistence/i);
    }
    const h = harness(options);
    options.capabilities.pop();
    assert.equal(h.owner.options.capabilities.includes('terminal-local-persistence-v1'), true);
    assert.doesNotThrow(() => harness());
    assert.equal(acquisitions, 0);
  });

  const candidateCapabilities = [...parentCapabilities, 'execution-owner-boundary-v1', 'terminal-interaction-v1',
    'terminal-read-settlement-v1'];
  const candidateOptions = { profile: EXECUTION_CANDIDATE_PROFILE, profileMode: 'live-runtime',
    budgets: EXECUTION_CANDIDATE_BUDGETS };
  const candidateHarness = () => parentHarness({ capabilities: candidateCapabilities,
    readyCapabilities: ['execution-lifecycle-v1', 'terminal-interaction-v1'], ownerOptions: candidateOptions });

  test('candidate validates every mode capability and fixed budget before any acquisition', () => {
    let acquired = 0;
    const createTransport = () => { acquired++; throw new Error('must not acquire'); };
    for (const mode of ['live-runtime', 'snapshot-only']) {
      const capabilities = mode === 'live-runtime' ? candidateCapabilities
        : candidateCapabilities.filter(capability => capability !== 'terminal-read-settlement-v1')
          .concat('terminal-local-settlement-v1', 'terminal-local-persistence-v1');
      assert.doesNotThrow(() => harness({ ...candidateOptions, profileMode: mode, capabilities, createTransport }));
      for (const missing of capabilities) {
        assert.throws(() => harness({ ...candidateOptions, profileMode: mode,
          capabilities: capabilities.filter(capability => capability !== missing), createTransport }), /capabilities missing/);
      }
    }
    for (const key of Object.keys(EXECUTION_CANDIDATE_BUDGETS)) {
      for (const value of [undefined, EXECUTION_CANDIDATE_BUDGETS[key] + 1]) {
        assert.throws(() => harness({ ...candidateOptions, capabilities: candidateCapabilities,
          budgets: { ...EXECUTION_CANDIDATE_BUDGETS, [key]: value }, createTransport }), /fixed candidate budgets/);
      }
    }
    assert.throws(() => harness({ ...candidateOptions, capabilities: candidateCapabilities,
      profile: 'unknown-candidate', createTransport }), /Unsupported execution candidate/);
    assert.throws(() => harness({ ...candidateOptions, capabilities: candidateCapabilities,
      profileMode: undefined, createTransport }), /explicit execution candidate mode/);
    assert.throws(() => harness({ profileMode: 'snapshot-only', createTransport }), /explicit profile/);
    assert.throws(() => assertExecutionCandidateCapabilities(candidateCapabilities, 'unknown'), /explicit/);
    assert.equal(Object.isFrozen(EXECUTION_CANDIDATE_BUDGETS), true);
    assert.equal(acquired, 0);
  });

  test('candidate natural close freezes at eight seconds and late settlement cannot replace first', async () => {
    const h = candidateHarness();
    const record = await h.start('candidate-natural');
    h.message(record, { type: 'processResult', result: { kind: 'exited', exitCode: 0 } });
    assert.equal(record.snapshot().closeObservation.cancelAt, 2000);
    assert.equal(record.snapshot().closeObservation.finishAt, 8000);
    assert.deepEqual(record.snapshot().closeObservation.parentCleanup,
      { at: 6000, termDeadline: 7000, killDeadline: 8000 });
    const closed = record.requestStop('join natural timeline');
    h.scheduler.tick(8000);
    assert.equal((await closed).kind, 'unconfirmed');
    nativeResult(h, record);
    await h.complete(record);
    assert.equal(record.snapshot().settled, true);
    assert.equal(record.snapshot().closeObservation.first.kind, 'unconfirmed');
    assert.equal((await record.requestStop('repeat')).kind, 'unconfirmed');
  });

  test('candidate active close uses one thirteen-second timeline and nested stop cannot extend it', async () => {
    const h = candidateHarness();
    const record = await h.start('candidate-stop');
    const closed = record.requestStop('stop');
    assert.equal(record.snapshot().closeObservation.forceAt, 5000);
    assert.equal(record.snapshot().closeObservation.cancelAt, 7000);
    assert.equal(record.snapshot().closeObservation.finishAt, 13000);
    assert.deepEqual(record.snapshot().closeObservation.parentCleanup,
      { at: 11000, termDeadline: 12000, killDeadline: 13000 });
    h.scheduler.tick(12000);
    assert.strictEqual(record.requestStop('again'), closed);
    assert.equal(record.snapshot().closeObservation.finishAt, 13000);
    h.scheduler.tick(13000);
    assert.equal((await closed).kind, 'unconfirmed');
    assert.equal(record.snapshot().retired, false);
  });

  test('explicit Linux factory options require the candidate contract without acquiring any transport', () => {
    let acquired = 0;
    const createTransport = () => { acquired++; throw new Error('must not create transport'); };
    const options = { kind: 'linux-provider', ...candidateOptions, capabilities: candidateCapabilities, createTransport };
    assert.doesNotThrow(() => harness(options));
    for (const missing of ['profile', 'profileMode']) {
      assert.throws(() => harness({ ...options, [missing]: undefined }), /explicit candidate profile and mode/);
    }
    assert.throws(() => harness({ ...options, capabilities: candidateCapabilities.filter(value => value !== 'terminal-interaction-v1') }),
      /capabilities missing/);
    assert.throws(() => harness({ ...options, budgets: { ...EXECUTION_CANDIDATE_BUDGETS, forceMs: 1 } }), /fixed candidate budgets/);
    assert.doesNotThrow(() => harness());
    assert.equal(acquired, 0);
  });

  test('candidate launch prerequisites reject before the owner calls the transport factory', () => {
    let acquired = 0;
    const h = harness({ ...candidateOptions, capabilities: candidateCapabilities,
      createTransport() { acquired++; throw new Error('must not create transport'); } });
    const record = h.owner.reserve('bad-launch');
    assert.throws(() => record.start(spec, h.hooks()), /initial dimensions/);
    assert.throws(() => record.start({ ...spec, cols: 80, rows: 24 }, h.hooks()), /stop strategy/);
    assert.throws(() => record.start({ ...spec, stopStrategy: 'hangup' }, h.hooks()), /initial dimensions/);
    assert.equal(acquired, 0);
    assert.equal(h.owner.authority.snapshot().active, 0);
    record.abandon('invalid launch never acquired');
    assert.equal(record.snapshot().retired, true);
  });

  test('owned input and resize use the original execution while paused output consumes independently', async () => {
    const h = candidateHarness();
    const pending = deferred();
    const record = await h.start('interactive', { consume: () => pending.promise });
    const transport = h.transports.get(record.identity.executionId);
    h.frame(record, 1, 'retained output');
    await h.scheduler.drain();
    const input = record.write('command', 5000);
    const resize = record.resize(120, 40, 5000);
    await h.scheduler.drain();
    const command = transport.messages.find(message => message.type === 'input');
    assert.equal(command.data, 'command');
    h.message(record, { type: 'interactionObservation', interactionId: command.interactionId,
      result: { kind: 'written', writtenBytes: Buffer.byteLength(command.data) } });
    assert.equal((await input.first).kind, 'written');
    await h.scheduler.drain();
    const resized = transport.messages.find(message => message.type === 'resize');
    h.message(record, { type: 'interactionObservation', interactionId: resized.interactionId, result: { kind: 'resized' } });
    assert.equal((await resize.first).kind, 'resized');
    assert.equal(record.snapshot().adapter.consumedThrough, 0);
    assert.equal(transport.messages.filter(message => message.type === 'start').length, 1);
    assert.equal(transport.messages.find(message => message.type === 'start').spec.cols, 80);
    record.requestStop('close input admission');
    assert.throws(() => record.write('retry', 5000), /admission/);
    assert.throws(() => record.resize(80, 24, 5000), /admission/);
    pending.resolve();
    nativeResult(h, record);
    await h.complete(record, 1);
    record.settleReaders('settled');
    assert.equal(record.snapshot().retired, true);
  });

  test('both explicit stop strategies reach the original provider without reopening ordinary input during stop', async () => {
    for (const stopStrategy of ['hangup', 'interrupt-then-hangup']) {
      const h = candidateHarness();
      const record = h.owner.reserve(stopStrategy);
      const launch = { ...spec, cols: 97, rows: 31, stopStrategy };
      assert.equal((await record.start(launch, h.hooks()).first).kind, 'started');
      await h.scheduler.drain();
      const transport = h.transports.get(record.identity.executionId);
      const sent = transport.messages.find(message => message.type === 'start');
      assert.deepEqual(sent.spec, launch);
      const input = record.write('pending', 10000);
      record.requestStop('explicit user stop');
      await h.scheduler.drain();
      assert.throws(() => record.write('after stop', 10000), /admission/);
      assert.equal(transport.messages.filter(message => message.type === 'requestStop').length, 1);
      assert.equal(transport.messages.find(message => message.type === 'requestStop').mode, 'graceful');
      h.scheduler.tick(5000);
      await h.scheduler.drain();
      assert.equal(transport.messages.filter(message => message.type === 'requestStop').at(-1).mode, 'force');
      h.scheduler.tick(10000);
      assert.equal((await input.first).kind, 'unconfirmed');
      assert.equal(record.snapshot().adapter.interactions.pending, 1);
      assert.equal(transport.messages.filter(message => message.type === 'input').length, 1);
    }
  });

  for (const { name, run } of tests) {
    await run();
    console.log(`ok - ${name}`);
  }
  console.log(`execution owner lifecycle: ${tests.length}/${tests.length} passed (no native)`);
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
