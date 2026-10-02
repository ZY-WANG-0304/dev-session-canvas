import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { ExitBarrierModel } from './runtime-exit-barrier-model.mjs';
import { ReadSettlementModel } from './runtime-exit-contract-model.mjs';

const { values } = parseArgs({ options: { output: { type: 'string' } } });
assert(values.output, '--output must name a new evidence directory');
const output = path.resolve(values.output);
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.mkdirSync(output);
const scope = 'Injected read/decoder/queue/resource candidate barriers only; no native PTY, OS-buffer proof, real xterm, business integration, or production budgets.';
const sourceFiles = ['scripts/diagnostics/runtime-exit-barrier-model.mjs',
  'scripts/diagnostics/diagnose-runtime-exit-barriers.mjs',
  'scripts/diagnostics/runtime-exit-contract-model.mjs'];
write('environment.json', { scope, platform: process.platform, arch: process.arch,
  executable: process.execPath, versions: process.versions,
  sourceHashes: Object.fromEntries(sourceFiles.map(file => [file, hash(fs.readFileSync(file))])) });
const tests = [];
const test = (name, run) => tests.push({ name, run });

test('source/process-exit-before-owned-read-data', async trace => {
  const model = fixture(trace);
  const read = model.beginRead();
  model.processExit({ exitCode: 7 });
  assert.equal(model.final, undefined);
  model.completeRead(read, data('TAIL\r\n'));
  assert.equal(model.sourceResult, undefined);
  eof(model);
  await model.settleQueue();
  assertFinal(model, 'eof', 'TAIL\r\n', 7);
});
test('source/eof-before-process-result', async trace => {
  const model = fixture(trace);
  model.completeRead(model.beginRead(), data('TAIL'));
  eof(model);
  await model.settleQueue();
  assert.equal(model.final, undefined);
  model.processExit({ exitCode: 0 });
  assertFinal(model, 'eof', 'TAIL');
});
test('cancel/request-alone-keeps-owned-read-and-is-not-source-end', async trace => {
  const model = fixture(trace);
  const read = model.beginRead();
  model.requestCancel('fixture-cancel');
  assert.throws(() => model.beginRead(), /admission closed/);
  model.completeRead(read, data('ACCEPTED'));
  await model.settleQueue();
  model.processExit({ exitCode: 0 });
  assert.equal(model.sourceResult, undefined);
  assert.equal(model.final, undefined);
  model.applyCancel();
  assertFinal(model, 'interrupted', 'ACCEPTED');
});
test('cancel/applied-before-positive-read-preserves-bytes', async trace => {
  const model = fixture(trace);
  const read = model.beginRead();
  model.processExit({ exitCode: 0 });
  model.requestCancel('fixture-cancel');
  model.applyCancel();
  assert.equal(model.sourceResult, undefined, 'in-flight callback still owns data');
  model.completeRead(read, data('OWNED_TAIL'));
  await model.settleQueue();
  assertFinal(model, 'interrupted', 'OWNED_TAIL');
});
for (const kind of ['eof', 'error']) {
  test(`cancel/applied-before-${kind}-cannot-become-eof`, async trace => {
    const model = fixture(trace);
    const read = model.beginRead();
    model.requestCancel('fixture-cancel');
    model.applyCancel();
    model.completeRead(read, kind === 'eof' ? { kind } : { kind, error: new Error('closed-read') });
    model.processExit({ exitCode: 7 });
    await model.settleQueue();
    assertFinal(model, 'interrupted', '', 7);
    assert.equal(model.sourceResult.observedReadEnd, kind);
    if (kind === 'error') assert.equal(model.sourceResult.readError, 'closed-read');
  });
}
test('cancel/real-eof-before-application-remains-eof', async trace => {
  const model = fixture(trace);
  const read = model.beginRead();
  model.requestCancel('fixture-cancel');
  model.completeRead(read, { kind: 'eof' });
  assert.equal(model.applyCancel(), 'source-already-ended');
  model.processExit({ exitCode: 0 });
  await model.settleQueue();
  assertFinal(model, 'eof', '');
  assert.equal(model.cancelApplied, undefined);
});
test('cancel/after-source-result-cannot-rewrite-it', async trace => {
  const model = fixture(trace);
  eof(model);
  assert.equal(model.requestCancel('late'), 'source-already-ended');
  assert.equal(model.sourceResult.kind, 'eof');
  model.processExit({ exitCode: 0 });
  await model.settleQueue();
  assertFinal(model, 'eof', '');
});
test('cancel/retry-idempotent-conflicting-reason-rejected', async trace => {
  const model = fixture(trace);
  const read = model.beginRead();
  assert.throws(() => model.applyCancel(), /unrequested/);
  assert.equal(model.requestCancel('first'), 'requested');
  assert.equal(model.requestCancel('first'), 'duplicate');
  assert.throws(() => model.requestCancel('second'), /conflicting cancellation/);
  assert.equal(model.applyCancel(), 'applied');
  assert.equal(model.applyCancel(), 'duplicate');
  model.completeRead(read, { kind: 'eof' });
  model.processExit({ exitCode: 0 });
  await model.settleQueue();
  assert.equal(model.sourceResult.reason, 'first');
  assert.equal(trace.filter(event => event.type === 'source-ended').length, 1);
  assert.equal(trace.filter(event => event.type === 'final').length, 1);
});
for (const cancelled of [false, true]) {
  test(`decoder/legal-split/${cancelled ? 'cancel-with-owned-read' : 'eof'}`, async trace => {
    const model = fixture(trace);
    const bytes = Buffer.from('TAIL_\u2603');
    model.completeRead(model.beginRead(), { kind: 'data', bytes: bytes.subarray(0, -1) });
    const read = model.beginRead();
    model.processExit({ exitCode: 0 });
    if (cancelled) { model.requestCancel('fixture-cancel'); model.applyCancel(); }
    model.completeRead(read, { kind: 'data', bytes: bytes.subarray(-1) });
    if (!cancelled) eof(model);
    await model.settleQueue();
    assertFinal(model, cancelled ? 'interrupted' : 'eof', 'TAIL_\u2603');
    assert.equal(trace.filter(event => event.type === 'decoder-ended').length, 1);
  });
}
for (const cancelled of [false, true]) {
  test(`decoder/incomplete-producer-tail/${cancelled ? 'cancel' : 'eof'}`, async trace => {
    const model = fixture(trace);
    model.completeRead(model.beginRead(), { kind: 'data', bytes: Buffer.from([0x41, 0xe2, 0x98]) });
    model.processExit({ exitCode: 0 });
    if (cancelled) { model.requestCancel('fixture-cancel'); model.applyCancel(); }
    else eof(model);
    await model.settleQueue();
    assertFinal(model, cancelled ? 'interrupted' : 'eof', 'A\ufffd');
    const acceptedTail = trace.find(event => event.type === 'operation-accepted' && event.origin === 'decoder-tail');
    const sourceEnded = trace.find(event => event.type === 'source-ended');
    assert(acceptedTail.sequence < sourceEnded.sequence);
    assert.equal(acceptedTail.text, '\ufffd');
  });
}
test('queue/slow-consumer-holds-final-not-source-result', async trace => {
  const started = deferred();
  const gate = deferred();
  const model = fixture(trace, async () => { started.resolve(); await gate.promise; });
  model.completeRead(model.beginRead(), data('TAIL'));
  model.processExit({ exitCode: 0 });
  eof(model);
  await started.promise;
  assert.equal(model.sourceResult.kind, 'eof');
  assert.equal(model.final, undefined);
  await model.releaseResources(async () => {});
  assert.equal(model.resourceState.kind, 'released');
  assert.equal(model.canRetire(), false);
  gate.resolve();
  await model.settleQueue();
  assertFinal(model, 'eof', 'TAIL');
  assert.equal(model.canRetire(), true);
});
test('queue/rejection-is-explicit-and-later-accepted-work-still-settles', async trace => {
  const model = fixture(trace, async (_text, id) => {
    if (id === 1) throw new Error('fixture-downstream-rejection');
  });
  model.completeRead(model.beginRead(), data('FIRST'));
  model.completeRead(model.beginRead(), data('SECOND'));
  model.processExit({ exitCode: 0 });
  eof(model);
  await model.settleQueue();
  assert.equal(model.final.source.kind, 'eof');
  assert.equal(model.final.delivery.kind, 'failed');
  assert.equal(model.final.finalRevision, undefined, 'failed application is not an applied final position');
  assert.deepEqual(model.final.delivery.failures, [{ id: 1, error: 'fixture-downstream-rejection' }]);
  assert.deepEqual(model.operations.map(operation => operation.status), ['failed', 'applied']);
  assertConsumer(model, [
    { id: 1, text: 'FIRST', status: 'failed', error: 'fixture-downstream-rejection' },
    { id: 2, text: 'SECOND', status: 'applied' }
  ]);
  assert.equal(trace.filter(event => event.type === 'final').length, 1);
});
test('queue/cancel-preserves-already-accepted-operations', async trace => {
  const started = deferred();
  const gate = deferred();
  const model = fixture(trace, async (_text, id) => { if (id === 1) { started.resolve(); await gate.promise; } });
  model.completeRead(model.beginRead(), data('FIRST'));
  const read = model.beginRead();
  await started.promise;
  model.requestCancel('fixture-cancel');
  model.applyCancel();
  model.completeRead(read, data('SECOND'));
  model.processExit({ exitCode: 0 });
  assert.equal(model.operations.length, 2);
  assert.equal(model.final, undefined);
  gate.resolve();
  await model.settleQueue();
  assertFinal(model, 'interrupted', 'FIRSTSECOND');
});
test('source/read-error-is-not-eof-and-keeps-decoder-tail', async trace => {
  const model = fixture(trace);
  model.completeRead(model.beginRead(), { kind: 'data', bytes: Buffer.from([0xe2, 0x98]) });
  model.completeRead(model.beginRead(), { kind: 'error', error: new Error('fixture-read-failure') });
  model.processExit({ exitCode: 7 });
  await model.settleQueue();
  assertFinal(model, 'error', '\ufffd', 7);
  assert.equal(model.sourceResult.reason, 'fixture-read-failure');
});
test('source/single-read-invalid-late-and-post-end-callbacks-rejected', async trace => {
  const model = fixture(trace);
  const first = model.beginRead();
  assert.throws(() => model.beginRead(), /one owned read/);
  assert.throws(() => model.completeRead(first + 1, data('FOREIGN')), /foreign/);
  assert.throws(() => model.completeRead(first, { kind: 'data', bytes: Buffer.alloc(0) }), /positive bytes/);
  model.completeRead(first, data('ONCE'));
  assert.throws(() => model.completeRead(first, data('DUPLICATE')), /late/);
  eof(model);
  assert.throws(() => model.beginRead(), /source already ended/);
  assert.throws(() => model.completeRead(first, data('LATE')), /late/);
  model.processExit({ exitCode: 0 });
  await model.settleQueue();
  assertFinal(model, 'eof', 'ONCE');
});
test('source/duplicate-process-result-idempotent-conflict-rejected', async trace => {
  const model = fixture(trace);
  eof(model);
  model.processExit({ exitCode: 7 });
  model.processExit({ exitCode: 7 });
  assert.throws(() => model.processExit({ exitCode: 0 }), /conflicting process/);
  await model.settleQueue();
  assertFinal(model, 'eof', '', 7);
  assert.equal(trace.filter(event => event.type === 'final').length, 1);
});
test('resources/early-release-rejected-with-owned-read-or-open-source', async trace => {
  const model = fixture(trace);
  let released = 0;
  const release = async () => { released += 1; };
  const read = model.beginRead();
  assert.throws(() => model.releaseResources(release), /unfinished source reads/);
  model.completeRead(read, data('TAIL'));
  assert.throws(() => model.releaseResources(release), /unfinished source reads/);
  assert.equal(released, 0);
  model.processExit({ exitCode: 0 });
  eof(model);
  await model.releaseResources(release);
  await model.settleQueue();
  assert.equal(released, 1);
  assertFinal(model, 'eof', 'TAIL');
});
test('resources/release-is-independent-of-missing-process-result', async trace => {
  const model = fixture(trace);
  eof(model);
  await model.releaseResources(async () => {});
  assert.throws(() => model.processExit({}), /missing process/);
  assert.equal(model.final, undefined);
  assert.equal(model.canRetire(), false);
  model.processExit({ exitCode: 7 });
  await model.settleQueue();
  assertFinal(model, 'eof', '', 7);
  assert.equal(model.canRetire(), true);
});
test('resources/failed-release-never-masquerades-as-success', async trace => {
  const model = fixture(trace);
  model.processExit({ exitCode: 0 });
  eof(model);
  const release = () => { throw new Error('fixture-release-failure'); };
  const pending = model.releaseResources(release);
  assert.equal(model.resourceState.kind, 'releasing');
  assert.equal(model.releaseResources(async () => {}), pending);
  const result = await pending;
  assert.deepEqual(result, { kind: 'failed', error: 'fixture-release-failure' });
  assert.equal(model.final.source.kind, 'eof', 'resource failure does not rewrite source evidence');
  assert.equal(model.canRetire(), false);
  assert.equal(trace.filter(event => event.type === 'resources-released').length, 0);
});
test('resources/repeated-release-runs-callback-once', async trace => {
  const model = fixture(trace);
  const gate = deferred();
  let count = 0;
  model.processExit({ exitCode: 0 });
  eof(model);
  const pending = model.releaseResources(async () => { count += 1; await gate.promise; });
  assert.equal(model.releaseResources(async () => { count += 1; }), pending);
  assert.equal(model.canRetire(), false);
  gate.resolve();
  await pending;
  assert.equal(model.releaseResources(async () => { count += 1; }), pending);
  assert.equal(count, 1);
  assert.equal(model.canRetire(), true);
});
test('readers/resources-released-before-one-applied-one-cancelled', async trace => {
  const { model, reads, first, second } = await readersFixture(trace);
  await model.releaseResources(async () => {});
  assert.equal(model.canRetire(reads), false);
  settle(trace, reads, first, { kind: 'cancelled' });
  assert.equal(model.canRetire(reads), false);
  assert.equal(reads.settle(second, { kind: 'applied', revision: model.final.finalRevision }), 'invalid');
  reads.deliver(second, model.final.finalRevision);
  settle(trace, reads, second, { kind: 'applied', revision: model.final.finalRevision });
  assert.equal(model.canRetire(reads), true);
});
test('readers/all-settled-before-resource-release-still-not-retired', async trace => {
  const { model, reads, first, second } = await readersFixture(trace);
  reads.deliver(first, model.final.finalRevision);
  settle(trace, reads, first, { kind: 'applied', revision: model.final.finalRevision });
  settle(trace, reads, second, { kind: 'cancelled' });
  assert.equal(reads.retirable, true);
  assert.equal(model.canRetire(reads), false);
  await model.releaseResources(async () => {});
  assert.equal(model.canRetire(reads), true);
});

write('schedule.json', tests.map(({ name }) => ({ name, repetitions: 1 })));
const results = [];
for (const { name, run } of tests) {
  const trace = [];
  let result;
  try {
    await runDeterministically(run, trace);
    result = { name, passed: true, trace };
  } catch (error) {
    result = { name, passed: false, error: error.stack ?? String(error), trace };
  }
  results.push(result);
  write('results.json', results);
  console.log(`${result.passed ? 'PASS' : 'FAIL'} ${name}`);
}
const failed = results.filter(result => !result.passed).length;
write('summary.json', { scope, total: results.length, passed: results.length - failed, failed });
if (failed) process.exitCode = 1;
console.log(JSON.stringify({ output, total: results.length, failed, scope }));

function fixture(trace, consume) {
  const observations = [];
  const record = (type, details) => {
    const sequence = trace.length + 1;
    trace.push({ sequence, type, ...details });
    return sequence;
  };
  const model = new ExitBarrierModel({ trace, consume: async (text, id) => {
    const observation = { id, text, status: 'consuming',
      startedAt: record('consumer-called', { id, text }) };
    observations.push(observation);
    try {
      await consume?.(text, id);
      observation.status = 'applied';
      observation.finishedAt = record('consumer-completed', { id, text });
    } catch (error) {
      observation.status = 'failed';
      observation.error = error instanceof Error ? error.message : String(error);
      observation.finishedAt = record('consumer-rejected', { id, text, error: observation.error });
      throw error;
    }
  } });
  Object.defineProperty(model, 'consumerObservations', { value: observations });
  return model;
}
function data(text) { return { kind: 'data', bytes: Buffer.from(text) }; }
function eof(model) { model.completeRead(model.beginRead(), { kind: 'eof' }); }
function assertFinal(model, kind, text, exitCode = 0) {
  assert.equal(model.final.source.kind, kind);
  assert.equal(model.final.process.exitCode, exitCode);
  assert.equal(model.final.delivery.kind, 'applied');
  assert.equal(model.operations.map(operation => operation.text).join(''), text);
  assert(model.operations.every(operation => operation.status === 'applied'));
  assertConsumer(model, model.operations.map(({ id, text }) => ({ id, text, status: 'applied' })));
  assert.equal(model.consumerObservations.map(observation => observation.text).join(''), text);
  assert.equal(model.final.finalRevision, model.operations.length);
  const source = model.trace.find(event => event.type === 'source-ended');
  const decoder = model.trace.find(event => event.type === 'decoder-ended');
  assert(decoder.sequence < source.sequence);
  assert.equal(model.trace.filter(event => event.type === 'final').length, 1);
}
function assertConsumer(model, expected) {
  assert.deepEqual(model.consumerObservations.map(({ startedAt, finishedAt, ...result }) => result), expected,
    'actual consumer calls must match every accepted payload exactly once and in order');
  const finalEvent = model.trace.find(event => event.type === 'final');
  assert(finalEvent, 'consumer verification requires a final event');
  for (let index = 0; index < model.consumerObservations.length; index++) {
    const observation = model.consumerObservations[index];
    assert(observation.startedAt < observation.finishedAt, 'consumer must settle after invocation');
    assert(observation.finishedAt < finalEvent.sequence, 'final must follow actual consumer settlement');
    if (index > 0) {
      assert(model.consumerObservations[index - 1].finishedAt < observation.startedAt,
        'later accepted work must wait for earlier consumer settlement');
    }
  }
}
async function readersFixture(trace) {
  const model = fixture(trace);
  const reads = new ReadSettlementModel('session', 'authority');
  const first = reads.open('first', 'owner-1');
  const second = reads.open('second', 'owner-2');
  reads.resolveOpen(first, 0);
  reads.resolveOpen(second, 0);
  model.completeRead(model.beginRead(), data('TAIL'));
  model.processExit({ exitCode: 0 });
  eof(model);
  await model.settleQueue();
  assertFinal(model, 'eof', 'TAIL');
  reads.complete(model.final.finalRevision);
  model.record('readers-final-position', { revision: model.final.finalRevision });
  return { model, reads, first, second };
}
function settle(trace, reads, identity, result) {
  const outcome = reads.settle(identity, result);
  trace.push({ sequence: trace.length + 1, type: 'reader-settlement', identity, result, outcome });
  assert.equal(outcome, 'accepted');
}
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
  return { promise, resolve, reject };
}
async function runDeterministically(run, trace) {
  let guard;
  try {
    // Every injected completion uses microtasks; an idle turn exposes an unreleased fixture barrier.
    await Promise.race([Promise.resolve().then(() => run(trace)), new Promise((_resolve, reject) => {
      guard = setImmediate(() => reject(new Error('Fixture stalled with an unreleased barrier.')));
    })]);
  } finally {
    clearImmediate(guard);
  }
}
function write(name, value) { fs.writeFileSync(path.join(output, name), `${JSON.stringify(value, null, 2)}\n`); }
function hash(value) { return createHash('sha256').update(value).digest('hex'); }
