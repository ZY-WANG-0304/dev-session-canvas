import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { parseArgs } from 'node:util';
import esbuild from 'esbuild';
import { SourceCompletionModel, ReadSettlementModel, negotiateSettlement } from './runtime-exit-contract-model.mjs';

const { values } = parseArgs({ options: { output: { type: 'string' } } });
assert(values.output, '--output must name a new evidence directory');
const output = path.resolve(values.output);
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.mkdirSync(output);
const projectionFile = 'extensions/vscode/dev-session-canvas/src/webview/terminalPagedProjection.ts';
const files = ['scripts/diagnostics/diagnose-runtime-exit-contract.mjs',
  'scripts/diagnostics/runtime-exit-contract-model.mjs', projectionFile,
  'extensions/vscode/dev-session-canvas/src/common/terminalStreamPaging.ts'];
const scope = 'Deterministic design models and actual projection callbacks; no native PTY, Supervisor/Host integration, or UI acceptance.';
write('environment.json', { scope, platform: process.platform, arch: process.arch, versions: process.versions,
  sourceHashes: Object.fromEntries(files.map(file => [file, hash(fs.readFileSync(file))])) });
const tests = [];
const test = (name, run) => tests.push({ name, run });

for (const exitCode of [0, 7]) {
  for (const order of ['data-process-source', 'process-data-source', 'data-source-process']) {
    test(`source/${exitCode}/${order}`, () => {
      const fixture = sourceFixture();
      for (const step of order.split('-')) {
        if (step === 'data') fixture.model.data('TAIL\r\n');
        if (step === 'process') fixture.model.processExit({ exitCode });
        if (step === 'source') fixture.model.sourceEnd({ kind: 'eof' });
      }
      assert.deepEqual(fixture.trace.map(event => event.type), ['data', 'final']);
      assert.equal(fixture.model.final.process.exitCode, exitCode);
      assert.equal(fixture.model.final.source.kind, 'eof');
      return fixture.trace;
    });
  }
}
for (const processFirst of [true, false]) {
  test(`source/empty/${processFirst ? 'process-first' : 'source-first'}`, () => {
    const { model, trace } = sourceFixture();
    if (processFirst) model.processExit({ exitCode: 7 });
    else model.sourceEnd({ kind: 'eof' });
    assert.equal(trace.length, 0, 'one fact cannot settle the session');
    if (processFirst) model.sourceEnd({ kind: 'eof' });
    else model.processExit({ exitCode: 7 });
    assert.equal(trace.length, 1);
    return trace;
  });
}
test('source/duplicate-terminal-events', () => {
  const { model, trace } = sourceFixture();
  for (let i = 0; i < 2; i++) {
    model.processExit({ exitCode: 7, signal: 'SIGTERM' });
    model.sourceEnd({ kind: 'eof' });
  }
  assert.equal(trace.length, 1);
  return trace;
});
test('source/conflicting-terminal-events', () => {
  const { model, trace } = sourceFixture();
  model.processExit({ exitCode: 7 });
  model.sourceEnd({ kind: 'eof' });
  assert.throws(() => model.processExit({ exitCode: 0 }), /conflicting process/);
  assert.throws(() => model.sourceEnd({ kind: 'interrupted', reason: 'late-cancel' }), /conflicting source/);
  assert.equal(trace.length, 1);
  assert.equal(model.final.source.kind, 'eof');
});
test('source/data-after-source-end-is-a-violation', () => {
  const { model, trace } = sourceFixture();
  model.sourceEnd({ kind: 'eof' });
  assert.throws(() => model.data('LATE'), /data after source end/);
  model.processExit({ exitCode: 0 });
  assert.throws(() => model.data('LATER'), /data after source end/);
  assert.equal(trace.length, 1);
});
test('source/stop-intent-does-not-interrupt-drain', () => {
  const { model, trace } = sourceFixture();
  model.requestStop();
  model.processExit({ exitCode: 7 });
  assert.equal(model.final, undefined);
  model.data('STOP_TAIL');
  model.sourceEnd({ kind: 'eof' });
  assert.equal(model.final.source.kind, 'eof');
  return trace;
});
for (const kind of ['interrupted', 'error', 'legacy-unknown']) {
  test(`source/${kind}-is-not-complete`, () => {
    const { model, trace } = sourceFixture();
    model.sourceEnd({ kind, reason: 'fixture' });
    assert.equal(model.final, undefined, 'cannot invent exit zero');
    model.processExit({ exitCode: 0 });
    assert.equal(model.final.source.kind, kind);
    return trace;
  });
}
test('source/decoder-tail-before-source-end', () => {
  const { model, trace } = sourceFixture();
  const decoder = new StringDecoder('utf8');
  const bytes = Buffer.from('TAIL_\u2603');
  model.data(decoder.write(bytes.subarray(0, -1)));
  model.processExit({ exitCode: 0 });
  model.data(decoder.write(bytes.subarray(-1)));
  model.data(decoder.end());
  model.sourceEnd({ kind: 'eof' });
  assert.equal(trace.filter(event => event.type === 'data').map(event => event.chunk).join(''), 'TAIL_\u2603');
  assert.equal(trace.at(-1).type, 'final');
  return trace;
});
test('source/resource-cleanup-is-not-completion', () => {
  const { model, trace } = sourceFixture();
  model.releaseResources();
  model.processExit({ exitCode: 0 });
  assert.equal(model.final, undefined);
  assert.equal(trace.length, 0);
});
test('source/legacy-provider-cannot-claim-eof', () => {
  const { model } = sourceFixture({ sourceEndV1: false });
  model.processExit({ exitCode: 0 });
  assert.throws(() => model.sourceEnd({ kind: 'eof' }), /legacy provider/);
  model.sourceEnd({ kind: 'legacy-unknown', reason: 'node-pty-onExit' });
  assert.equal(model.final.source.kind, 'legacy-unknown');
});
test('source/missing-process-result-is-not-exit-zero', () => {
  const { model } = sourceFixture();
  model.sourceEnd({ kind: 'eof' });
  assert.throws(() => model.processExit({}), /missing process/);
  assert.equal(model.final, undefined);
});

test('readers/final-target-before-last-page', () => {
  const { model, identity } = readerFixture();
  model.complete(2);
  assert.equal(model.settle(identity, { kind: 'applied', revision: 2 }), 'invalid');
  assert.equal(model.retirable, false);
  model.deliver(identity, 2);
  assert.equal(model.settle(identity, { kind: 'applied', revision: 2 }), 'accepted');
  assert.equal(model.retirable, true);
});
test('readers/applied-before-final-rejected', () => {
  const { model, identity } = readerFixture();
  model.deliver(identity, 2);
  assert.equal(model.settle(identity, { kind: 'applied', revision: 2 }), 'invalid');
  assert.equal(model.retirable, false);
});
for (const revision of [0, 1, 3, 2.5]) {
  test(`readers/wrong-final-revision/${revision}`, () => {
    const { model, identity } = readerFixture();
    model.deliver(identity, 2);
    model.complete(2);
    assert.equal(model.settle(identity, { kind: 'applied', revision }), 'invalid');
    assert.equal(model.retirable, false);
  });
}
for (const field of ['sessionId', 'authorityId', 'readId', 'ownerId']) {
  test(`readers/stale-identity/${field}`, () => {
    const { model, identity } = readerFixture();
    model.complete(0);
    assert.equal(model.settle({ ...identity, [field]: 'stale' }, { kind: 'applied', revision: 0 }), 'ignored');
    assert.equal(model.retirable, false);
  });
}
test('readers/applied-retry-is-idempotent', () => {
  const { model, identity } = readerFixture();
  model.complete(0);
  assert.equal(model.settle(identity, { kind: 'applied', revision: 0 }), 'accepted');
  assert.equal(model.settle(identity, { kind: 'applied', revision: 0 }), 'duplicate');
  assert.equal(model.settle(identity, { kind: 'cancelled' }), 'invalid');
  assert.equal(model.find(identity).settlement.kind, 'applied');
});
test('readers/cancel-one-reader-does-not-release-another', () => {
  const { model, identity } = readerFixture();
  const second = model.open('panel-read', 'panel-owner');
  model.resolveOpen(second, 0);
  model.complete(2);
  assert.equal(model.settle(identity, { kind: 'cancelled' }), 'accepted');
  assert.equal(model.retirable, false);
  model.deliver(second, 2);
  assert.equal(model.settle(second, { kind: 'applied', revision: 2 }), 'accepted');
  assert.equal(model.retirable, true);
});
test('readers/open-in-flight-at-final-retains-source', () => {
  const model = new ReadSettlementModel('session', 'authority');
  const identity = model.open('read', 'owner');
  model.complete(2);
  assert.equal(model.open('new', 'new-owner'), undefined);
  assert.equal(model.retirable, false);
  assert.equal(model.settle(identity, { kind: 'applied', revision: 2 }), 'invalid');
  assert.equal(model.resolveOpen(identity, 1), true);
  model.deliver(identity, 2);
  assert.equal(model.settle(identity, { kind: 'applied', revision: 2 }), 'accepted');
  assert.equal(model.retirable, true);
});
test('readers/cancelled-open-cannot-resurrect', () => {
  const model = new ReadSettlementModel('session', 'authority');
  const identity = model.open('read', 'owner');
  assert.equal(model.settle(identity, { kind: 'cancelled' }), 'accepted');
  assert.equal(model.settle(identity, { kind: 'cancelled' }), 'duplicate');
  model.complete(2);
  assert.equal(model.resolveOpen(identity, 0), false);
  assert.equal(model.settle(identity, { kind: 'applied', revision: 2 }), 'invalid');
  assert.equal(model.retirable, true);
});
test('readers/legacy-close-does-not-prove-application', () => {
  const { model, identity } = readerFixture();
  model.complete(2);
  model.closeLegacy(identity);
  assert.equal(model.find(identity).settlement.kind, 'legacy-released');
  assert.equal(model.retirable, true);
});
test('readers/disconnect-is-owner-scoped-loss', () => {
  const { model, identity } = readerFixture();
  const second = model.open('second', 'other-owner');
  model.complete(0);
  assert.equal(model.settle(identity, { kind: 'lost' }), 'invalid');
  model.disconnect(identity.ownerId);
  assert.equal(model.find(identity).settlement.kind, 'lost');
  assert.equal(model.retirable, false);
  model.disconnect(second.ownerId);
  assert.equal(model.retirable, true);
});
test('readers/no-readers-needs-no-new-page', () => {
  const model = new ReadSettlementModel('session', 'authority');
  assert.equal(model.retirable, false);
  model.complete(0);
  assert.equal(model.retirable, true);
});
test('readers/final-revision-is-immutable-and-covers-delivery', () => {
  const { model, identity } = readerFixture();
  model.deliver(identity, 2);
  assert.throws(() => model.complete(1));
  model.complete(2);
  model.complete(2);
  assert.throws(() => model.complete(3), /conflicting final/);
  assert.throws(() => model.deliver(identity, 3), /exceeds final/);
});
test('capabilities/protocol-is-independent-of-source-proof', () => {
  const supported = { terminalReadSettlementV1: true };
  const legacy = { terminalAppliedRevisionAckV1: true };
  for (const host of [undefined, legacy, supported]) {
    for (const supervisor of [undefined, legacy, supported]) {
      for (const sourceEndV1 of [false, true]) {
        assert.deepEqual(negotiateSettlement(host, supervisor, { sourceEndV1 }), {
          settlementV1: host === supported && supervisor === supported, sourceEndV1
        });
      }
    }
  }
  return { combinations: 18, bindingMigration: 'not performed' };
});
test('actual-projection/complete-and-cancel-share-legacy-close', async () => {
  const { TerminalPagedProjection } = await loadProjection();
  const completed = projectionFixture(TerminalPagedProjection);
  const cancelled = projectionFixture(TerminalPagedProjection);
  try {
    for (const fixture of [completed, cancelled]) {
      assert.equal(fixture.projection.start(fixture.descriptor), true);
      fixture.writes.shift().done();
      const request = fixture.requests[0];
      fixture.projection.available('session', 'authority', 1, true);
      fixture.projection.showExit('ended', 'session');
      fixture.projection.accept('read', request.requestId, { sessionId: 'session', authorityId: 'authority',
        readId: 'read', afterRevision: 0, revision: 1, headRevision: 1,
        events: [{ type: 'output', revision: 1, createdAtMs: 1, data: 'TAIL' }] });
      assert.equal(fixture.closes.length, 0, 'pending xterm write is not applied');
    }
    completed.writes.shift().done();
    assert.deepEqual(completed.exits, ['ended']);
    const pendingWrite = cancelled.writes.shift();
    cancelled.projection.stop();
    assert.equal(pendingWrite.current(), false);
    pendingWrite.done();
    assert.deepEqual(cancelled.exits, []);
    assert.deepEqual(completed.closes, cancelled.closes,
      'actual legacy close carries identity but cannot distinguish applied from cancelled');
    return { completedClose: completed.closes, cancelledClose: cancelled.closes,
      finding: 'Missing receipt semantics, not a newly reproduced missing-output bug.' };
  } finally {
    completed.projection.stop();
    cancelled.projection.stop();
  }
});

write('schedule.json', tests.map(({ name }) => name));
const results = [];
for (const { name, run } of tests) {
  try {
    results.push({ name, passed: true, evidence: await run() ?? null });
  } catch (error) {
    results.push({ name, passed: false, error: error.stack ?? String(error) });
  }
  write('results.json', results);
  console.log(`${results.at(-1).passed ? 'PASS' : 'FAIL'} ${name}`);
}
const failed = results.filter(result => !result.passed).length;
write('summary.json', { scope, total: results.length, passed: results.length - failed, failed });
if (failed) process.exitCode = 1;
console.log(JSON.stringify({ output, total: results.length, failed, scope }));

function sourceFixture(options = {}) {
  const trace = [];
  const model = new SourceCompletionModel({ ...options,
    onData: chunk => trace.push({ type: 'data', chunk }),
    onFinal: result => trace.push({ type: 'final', result }) });
  return { model, trace };
}

function readerFixture() {
  const model = new ReadSettlementModel('session', 'authority');
  const identity = model.open('read', 'owner');
  model.resolveOpen(identity, 0);
  return { model, identity };
}

async function loadProjection() {
  const bundle = await esbuild.build({ entryPoints: [projectionFile], bundle: true,
    platform: 'node', format: 'cjs', target: 'node18', write: false });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', bundle.outputFiles[0].text)(
    module, module.exports, createRequire(import.meta.url));
  return module.exports;
}

function projectionFixture(TerminalPagedProjection) {
  const fixture = { requests: [], writes: [], closes: [], exits: [], descriptor: {
    sessionId: 'session', authorityId: 'authority', readId: 'read', headRevision: 1,
    checkpoint: { version: 1, sessionId: 'session', authorityId: 'authority', revision: 0,
      cols: 80, rows: 24, scrollback: 1000, createdAtMs: 1,
      serializedState: { format: 'xterm-serialize-v1', data: '', outputSequence: 0 } }
  } };
  fixture.projection = new TerminalPagedProjection({
    request: (read, afterRevision, requestId) => fixture.requests.push({ read, afterRevision, requestId }),
    checkpoint: (read, current, done) => fixture.writes.push({ current, done }),
    events: (events, current, done) => fixture.writes.push({ current, done }),
    close: read => fixture.closes.push(structuredClone(read)),
    exit: message => fixture.exits.push(message)
  });
  return fixture;
}

function write(name, value) { fs.writeFileSync(path.join(output, name), `${JSON.stringify(value, null, 2)}\n`); }
function hash(value) { return createHash('sha256').update(value).digest('hex'); }
