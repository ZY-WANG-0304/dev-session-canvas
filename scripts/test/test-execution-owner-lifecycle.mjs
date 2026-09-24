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
    async drain() {
      for (let turn = 0; turn < 20; turn++) {
        const task = tasks.shift();
        task?.();
        await new Promise(resolve => setTimeout(resolve, 1));
      }
      assert.equal(tasks.length, 0, 'the bounded owner task queue must quiesce');
    },
    pendingDeadlines: () => deadlines.size
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
  const { encodeOutputFrame } = require(path.join(tempDir, 'protocol.cjs'));
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
      assert.equal((await record.start(spec, hooks(overrides)).first).kind, 'started');
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

  for (const { name, run } of tests) {
    await run();
    console.log(`ok - ${name}`);
  }
  console.log(`execution owner lifecycle: ${tests.length}/${tests.length} passed (no native)`);
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
