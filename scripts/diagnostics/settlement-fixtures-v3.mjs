import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { inspectFrame, verifySavedCase, verifyPublicationSnapshot } from './settlement-oracle-v3.mjs';

const NS = 1_000_000n;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const identity = caseId => ({ schema: 'diagnostic-settlement-v3', runId: 'fixture-run', caseId, generation: 'g1', nonce: 'fixture-nonce' });
const clone = value => structuredClone(value);

export function makeProtocolFrame(id, role, sequence, type, payload, at = 1n) {
  return { schema: 'diagnostic-settlement-frame-v3', role, runId: id.runId, caseId: id.caseId,
    generation: id.generation, nonce: id.nonce, attemptId: `${role}-1`, requestId: `${role}-request`,
    sourceSequence: sequence, sentNs: String(at), type, payload };
}

export function makeNormalOracleFixture() {
  const id = identity('oracle-normal');
  const spec = { id, scenario: 'D3v3-01', entryPath: '/fixture/entry.mjs', artifactDirectory: '/fixture/payload' };
  const trace = [];
  const reports = {};
  let clock = 0n;
  const fact = (event, role, details, at = clock + NS) => {
    clock = at;
    const n = trace.length + 1;
    const value = { factId: `f${n}`, eventOrdinal: n, receiptNs: String(at), event, role,
      attemptId: `${role}-1`, details };
    trace.push(value);
    return value;
  };
  const request = (role, payloadBase64 = '') => ({ schema: 'diagnostic-settlement-request-v3', id, role,
    attemptId: `${role}-1`, requestId: `${role}-request`, scenario: spec.scenario,
    artifactDirectory: spec.artifactDirectory, payloadBase64 });
  const send = (role, sequence, type, payload, channel = 'stdout') => {
    const frame = makeProtocolFrame(id, role, sequence, type, payload, clock + NS);
    return fact('stream-data', role, { channel, bytesBase64: Buffer.from(`${JSON.stringify(frame)}\n`).toString('base64') });
  };
  const end = role => { for (const channel of ['stdout', 'stderr', 'fd3']) fact('stream-end', role, { channel }); };
  const report = (name, kind, deadlineNs, extra = {}) => {
    const reportId = `${id.caseId}:${name}`;
    const e = fact('report-frozen', 'observer', { name, reportId, kind, reason: 'fixture' });
    reports[name] = { id, reportId, deadlineNs: String(deadlineNs), frozenNs: e.receiptNs,
      eventOrdinal: e.eventOrdinal, kind, reason: 'fixture', factIds: trace.slice(0, -1).map(v => v.factId), ...extra };
  };
  fact('case-start', 'observer', { t0Ns: '0', deadlines: { observationNs: '2000000000', termNs: '5000000000', killNs: '5500000000', hardNs: '6000000000' } }, 0n);
  fact('spawn-request', 'caller', { request: request('caller') });
  fact('spawn', 'caller', { pid: 100 });
  send('caller', 1, 'caller-start', { scenario: spec.scenario });
  send('caller', 2, 'result-ready', {});
  send('caller', 3, 'operation-returned', { kind: 'returned' });
  send('caller', 4, 'caller-after-await', { kind: 'returned' }, 'fd3');
  report('observation', 'observed-within-budget', 2000n * NS);
  send('caller', 5, 'caller-finished', { exitCode: 0 });
  fact('exit', 'caller', { code: 0, signal: null });
  report('processSettlement', 'exit-observed', 6000n * NS, { code: 0, signal: null });
  end('caller');
  fact('capture-settled', 'observer', { integrity: 'complete', reasons: [], streams: {} });
  const payload = Buffer.from(JSON.stringify({ spec, reports: clone(reports) }));
  const payloadBase64 = payload.toString('base64');
  const e0 = clock + NS;
  fact('evidence-start', 'observer', { e0Ns: String(e0), payloadBase64,
    deadlines: { workNs: String(e0 + 1000n * NS), killNs: String(e0 + 1500n * NS), hardNs: String(e0 + 2000n * NS) } });
  const claim = { bytes: payload.length, sha256: sha(payload), manifestSha256: '1'.repeat(64) };
  for (const role of ['writer', 'verifier']) {
    const body = role === 'writer' ? payloadBase64 : Buffer.from(JSON.stringify({
      schema: 'diagnostic-settlement-verification-input-v3', expectedPayloadBase64: payloadBase64,
      writerAttemptId: 'writer-1', writerRequestId: 'writer-request',
    })).toString('base64');
    fact('spawn-request', role, { request: request(role, body) });
    fact('spawn', role, { pid: role === 'writer' ? 101 : 102 });
    send(role, 1, 'start', { scenario: spec.scenario });
    send(role, 2, role === 'writer' ? 'write-entered' : 'verify-entered', { mode: role === 'writer' ? 'write' : 'verify' });
    send(role, 3, role === 'writer' ? 'seal-claim' : 'verified', claim);
    fact('exit', role, { code: 0, signal: null });
    end(role);
  }
  report('evidenceSettlement', 'sealed', e0 + 2000n * NS, { artifactVerified: true });
  return { spec, trace, reports };
}

function mutateFrame(input, role, type, mutate) {
  const fact = input.trace.find(f => f.event === 'stream-data' && f.role === role &&
    JSON.parse(Buffer.from(f.details.bytesBase64, 'base64').toString('utf8')).type === type);
  const frame = JSON.parse(Buffer.from(fact.details.bytesBase64, 'base64').toString('utf8'));
  mutate(frame);
  fact.details.bytesBase64 = Buffer.from(`${JSON.stringify(frame)}\n`).toString('base64');
}

function renumber(input) {
  for (const [index, event] of input.trace.entries()) { event.eventOrdinal = index + 1; event.factId = `f${index + 1}`; }
  for (const [name, report] of Object.entries(input.reports)) {
    const event = input.trace.find(f => f.event === 'report-frozen' && f.details.name === name);
    if (event) { report.eventOrdinal = event.eventOrdinal; report.frozenNs = event.receiptNs; }
    report.factIds = input.trace.filter(f => f.eventOrdinal < (event?.eventOrdinal ?? 1)).map(f => f.factId);
  }
}

function makePublicationOracleFixture() {
  const original = makeNormalOracleFixture();
  const id = identity('oracle-publication');
  const spec = { id, scenario: 'publisher-normal' };
  const trace = [];
  const add = (event, role, details) => {
    const ordinal = trace.length + 1;
    trace.push({ factId: `p${ordinal}`, eventOrdinal: ordinal, receiptNs: String(BigInt(ordinal - 1) * NS),
      event, role, attemptId: role === 'publisher' ? 'publisher-1' : null, details });
  };
  add('publication-start', null, { p0Ns: '0', deadlines: { workNs: '1000000000', killNs: '1500000000', hardNs: '2000000000' } });
  const request = { ...original.trace.find(f => f.role === 'writer' && f.event === 'spawn-request').details.request,
    id, role: 'publisher', attemptId: 'publisher-1', requestId: 'publisher-request', scenario: spec.scenario };
  add('spawn-request', 'publisher', { request }); add('spawn', 'publisher', { pid: 200 });
  for (const [index, [type, payload]] of [['start', { scenario: spec.scenario }], ['publish-entered', { mode: 'publish' }],
    ['publish-claim', { files: 1, manifestSha256: '1'.repeat(64) }]].entries()) {
    add('stream-data', 'publisher', { channel: 'stdout', bytesBase64: Buffer.from(`${JSON.stringify(makeProtocolFrame(id, 'publisher', index + 1, type, payload))}\n`).toString('base64') });
  }
  add('exit', 'publisher', { code: 0, signal: null });
  for (const channel of ['stdout', 'stderr', 'fd3']) add('stream-end', 'publisher', { channel });
  add('report-frozen', null, { name: 'publication', reportId: 'publication-first', kind: 'published', reason: 'fixture' });
  const event = trace.at(-1);
  const report = { id, reportId: 'publication-first', deadlineNs: '2000000000', frozenNs: event.receiptNs,
    eventOrdinal: event.eventOrdinal, kind: 'published', reason: 'fixture', factIds: trace.slice(0, -1).map(f => f.factId) };
  return { spec, trace, reports: { publication: report } };
}

export function runOracleSelfTests() {
  const cases = [];
  const run = (id, input, expected, operation) => {
    let actual;
    try { actual = operation(); } catch (error) { actual = { pass: false, errors: [error.message] }; }
    cases.push({ id, input, expected, actual, pass: actual.pass === expected });
  };
  const baseline = makeNormalOracleFixture();
  run('valid-complete-trace', baseline, true, () => verifySavedCase(baseline));
  const late = clone(baseline);
  const last = late.trace.at(-1);
  late.trace.push({ factId: 'late-error', eventOrdinal: last.eventOrdinal + 1, receiptNs: String(BigInt(last.receiptNs) + 1n),
    event: 'process-error', role: 'writer', attemptId: 'writer-1', details: { name: 'Error', code: 'LATE', message: 'late diagnostic' } });
  run('late-error-does-not-rewrite-first-reports', late, true, () => verifySavedCase(late));
  const simultaneous = clone(baseline);
  const writerExit = simultaneous.trace.findIndex(f => f.role === 'writer' && f.event === 'exit');
  const verifierSpawn = simultaneous.trace.findIndex(f => f.role === 'verifier' && f.event === 'spawn-request');
  for (let index = writerExit; index <= verifierSpawn; index++) simultaneous.trace[index].receiptNs = simultaneous.trace[writerExit].receiptNs;
  run('same-time-writer-completion-before-verifier', simultaneous, true, () => verifySavedCase(simultaneous));
  const reordered = clone(simultaneous);
  const endIndex = reordered.trace.findIndex(f => f.role === 'writer' && f.event === 'stream-end' && f.details.channel === 'fd3');
  const [writerEnd] = reordered.trace.splice(endIndex, 1);
  reordered.trace.splice(reordered.trace.findIndex(f => f.role === 'verifier' && f.event === 'spawn-request') + 1, 0, writerEnd);
  renumber(reordered);
  run('same-time-writer-EOF-after-verifier-spawn', reordered, false, () => verifySavedCase(reordered));
  const modifications = [
    ['report-kind', v => { v.reports.processSettlement.kind = 'unconfirmed'; }],
    ['report-full-identity', v => { v.reports.observation.id = { ...v.reports.observation.id, nonce: 'foreign' }; }],
    ['report-future-reference', v => { v.reports.observation.factIds.push(v.trace.at(-1).factId); }],
    ['unknown-event', v => { v.trace[2].event = 'unknown-observer-event'; }],
    ['wrong-helper-scenario', v => mutateFrame(v, 'writer', 'start', f => { f.payload.scenario = 'foreign'; })],
    ['wrong-artifact-proof-flag', v => { v.reports.evidenceSettlement.artifactVerified = false; }],
    ['report-deadline', v => { v.reports.observation.deadlineNs = '2000000001'; }],
    ['report-receipt', v => { v.reports.observation.frozenNs = '0'; }],
    ['snapshot-summary-tamper', v => { v.reports.evidenceSettlement.kind = 'incomplete'; v.trace.find(f => f.details.name === 'evidenceSettlement').details.kind = 'incomplete'; }],
    ['missing-exit-renumbered', v => { v.trace = v.trace.filter(f => !(f.role === 'caller' && f.event === 'exit')); renumber(v); }],
    ['missing-EOF-renumbered', v => { v.trace = v.trace.filter(f => !(f.role === 'caller' && f.event === 'stream-end' && f.details.channel === 'fd3')); renumber(v); }],
    ['close-is-not-EOF', v => { v.trace.find(f => f.role === 'caller' && f.event === 'stream-end').event = 'stream-close'; }],
    ['destroy-is-not-EOF', v => { v.trace.find(f => f.role === 'caller' && f.event === 'stream-end').event = 'stream-cancel'; }],
    ['wrong-caller-identity', v => mutateFrame(v, 'caller', 'caller-after-await', f => { f.caseId = 'foreign'; })],
    ['wrong-helper-content', v => mutateFrame(v, 'verifier', 'verified', f => { f.payload.sha256 = '2'.repeat(64); })],
    ['helper-claim-double', v => mutateFrame(v, 'writer', 'write-entered', f => { f.type = 'seal-claim'; f.payload = { bytes: 0, sha256: '0'.repeat(64), manifestSha256: '0'.repeat(64) }; })],
    ['wrong-receipt-nan', v => { v.trace[3].receiptNs = 'NaN'; }],
    ['wrong-receipt-negative', v => { v.trace[3].receiptNs = '-1'; }],
    ['wrong-source-sequence', v => mutateFrame(v, 'caller', 'caller-after-await', f => { f.sourceSequence = 1; })],
    ['wrong-channel', v => { v.trace.find(f => f.role === 'caller' && f.details.channel === 'fd3').details.channel = 'stdout'; }],
    ['wrong-writer-deadline', v => { v.trace.find(f => f.event === 'evidence-start').details.deadlines.workNs = '9999999999'; }],
    ['early-control', v => { const at = v.trace.findIndex(f => f.event === 'exit' && f.role === 'caller'); v.trace.splice(at, 0, { ...v.trace[at], event: 'control-attempt', details: { signal: 'SIGTERM', returned: true, error: null } }); renumber(v); }],
  ];
  for (const [id, mutate] of modifications) {
    const input = clone(baseline); mutate(input);
    run(id, input, false, () => verifySavedCase(input));
  }
  for (const role of ['caller', 'writer', 'verifier', 'publisher']) {
    const id = identity(`protocol-${role}`);
    const type = role === 'caller' ? 'caller-after-await' : 'start';
    const payload = role === 'caller' ? { kind: 'returned' } : { scenario: 'D3v3-01' };
    const frame = makeProtocolFrame(id, role, 1, type, payload);
    const context = { id, role, attemptId: `${role}-1`, requestId: `${role}-request`, channel: role === 'caller' ? 'fd3' : 'stdout' };
    run(`${role}-valid`, { frame, context }, true, () => ({ pass: inspectFrame(frame, context).length === 0 }));
    for (const key of ['schema', 'role', 'runId', 'caseId', 'generation', 'nonce', 'attemptId', 'requestId', 'sourceSequence', 'sentNs', 'type', 'payload']) {
      const bad = clone(frame); bad[key] = key === 'payload' ? { unexpected: true } : key === 'sourceSequence' ? 0 : 'invalid';
      run(`${role}-bad-${key}`, { frame: bad, context }, false, () => ({ pass: inspectFrame(bad, context).length === 0 }));
    }
    const extra = { ...frame, unexpected: true };
    run(`${role}-extra-field`, { frame: extra, context }, false, () => ({ pass: inspectFrame(extra, context).length === 0 }));
    const source = role === 'publisher' ? makePublicationOracleFixture() : clone(baseline);
    const verify = role === 'publisher' ? verifyPublicationSnapshot : verifySavedCase;
    if (role === 'publisher') run('publisher-valid-raw', source, true, () => verify(source));
    const mutations = [
      ['raw-invalid-utf8', v => { v.trace.find(f => f.role === role && f.event === 'stream-data').details.bytesBase64 = Buffer.from([0xff, 10]).toString('base64'); }],
      ['raw-oversize', v => { v.trace.find(f => f.role === role && f.event === 'stream-data').details.bytesBase64 = Buffer.from('x'.repeat(4097)).toString('base64'); }],
      ['raw-truncated', v => { v.trace.filter(f => f.role === role && f.event === 'stream-data').at(-1).details.bytesBase64 = Buffer.from('{').toString('base64'); }],
      ['raw-negative-time', v => mutateFrame(v, role, role === 'caller' ? 'caller-start' : 'start', f => { f.sentNs = '-1'; })],
      ['raw-missing-first', v => { const at = v.trace.findIndex(f => f.role === role && f.event === 'stream-data'); v.trace.splice(at, 1); renumber(v); }],
      ['raw-duplicate', v => { const at = v.trace.findIndex(f => f.role === role && f.event === 'stream-data'); v.trace.splice(at, 0, clone(v.trace[at])); renumber(v); }],
      ['raw-wrong-channel', v => { v.trace.find(f => f.role === role && f.event === 'stream-data').details.channel = 'fd3'; }],
      ['raw-reverse-sequence', v => mutateFrame(v, role, role === 'caller' ? 'caller-start' : 'start', f => { f.sourceSequence = 3; })],
      ['raw-after-terminal', v => {
        const at = v.trace.findLastIndex(f => f.role === role && f.event === 'stream-data');
        const event = clone(v.trace[at]);
        const frame = JSON.parse(Buffer.from(event.details.bytesBase64, 'base64'));
        frame.sourceSequence++; event.details.bytesBase64 = Buffer.from(`${JSON.stringify(frame)}\n`).toString('base64');
        v.trace.splice(at + 1, 0, event); renumber(v);
      }],
    ];
    for (const [name, mutate] of mutations) {
      const input = clone(source); mutate(input);
      run(`${role}-${name}`, input, false, () => verify(input));
    }
  }
  return { pass: cases.every(c => c.pass), attempted: cases.length, passed: cases.filter(c => c.pass).length, cases };
}

class VirtualClock {
  time = 0n;
  next = 1;
  timers = new Map();
  microtasks = [];
  nowNs = () => this.time;
  setTimeout = (fn, ms) => {
    const key = this.next++;
    this.timers.set(key, { at: this.time + BigInt(Math.ceil(ms * 1e6)), fn });
    return key;
  };
  clearTimeout = key => this.timers.delete(key);
  queueMicrotask = fn => this.microtasks.push(fn);
  async flush() {
    for (let i = 0; i < 12; i++) {
      while (this.microtasks.length) this.microtasks.shift()();
      await Promise.resolve();
    }
  }
  async advance(to, runTimers = true) {
    assert(to >= this.time);
    if (runTimers) for (let safety = 0; safety < 1000; safety++) {
      const next = [...this.timers.entries()].filter(([, v]) => v.at <= to).sort((a, b) => a[1].at < b[1].at ? -1 : a[1].at > b[1].at ? 1 : a[0] - b[0])[0];
      if (!next) break;
      this.time = next[1].at;
      this.timers.delete(next[0]); next[1].fn(); await this.flush();
      assert(safety < 999, 'virtual timer loop');
    }
    this.time = to;
    await this.flush();
  }
}

class FakeStream extends EventEmitter {
  destroyed = false;
  writes = [];
  write(data, callback) { this.writes.push(Buffer.from(data)); callback?.(); return true; }
  end(data) { if (data) this.write(data); this.emit('finish'); }
  destroy() { this.destroyed = true; this.emit('close'); }
  resume() { return this; }
  pause() { return this; }
  unref() { return this; }
}

function fakeTransport(clock) {
  const children = new Map();
  const spawnRole = (role, request) => {
    const child = new EventEmitter();
    child.pid = 200 + children.size;
    child.stdin = new FakeStream(); child.stdout = new FakeStream(); child.stderr = new FakeStream();
    child.stdio = [child.stdin, child.stdout, child.stderr, new FakeStream(), new FakeStream()];
    child.request = request; child.sequence = 0; child.killAttempts = [];
    child.kill = signal => { child.killAttempts.push(signal); return true; };
    child.unref = () => child;
    children.set(role, child);
    clock.queueMicrotask(() => child.emit('spawn'));
    return child;
  };
  return { children, spawnRole };
}

export async function runCoreSelfTests() {
  const { startObservedCase, startPublication } = await import('./diagnostic-settlement-v3.mjs');
  const cases = [];
  async function run(id, operation, scenario = 'D3v3-01', generation = 'g1') {
    const clock = new VirtualClock();
    const transport = fakeTransport(clock);
    const spec = { id: { ...identity(id), generation }, scenario, entryPath: '/fixture/unused.mjs', artifactDirectory: '/fixture/unused' };
    const handle = startObservedCase(spec, { clock, spawnRole: transport.spawnRole });
    const send = (role, type, payload, channel = type === 'caller-after-await' ? 'fd3' : 'stdout') => {
      const child = transport.children.get(role);
      assert(child, `missing fake ${role}`);
      const frame = makeProtocolFrame(spec.id, role, ++child.sequence, type, payload, clock.time);
      frame.attemptId = child.request.attemptId; frame.requestId = child.request.requestId;
      (channel === 'fd3' ? child.stdio[3] : child[channel]).emit('data', Buffer.from(`${JSON.stringify(frame)}\n`));
    };
    const end = role => {
      const child = transport.children.get(role);
      for (const channel of ['stdout', 'stderr', 'fd3']) {
        const stream = channel === 'fd3' ? child.stdio[3] : child[channel];
        stream.emit('end'); stream.emit('close');
      }
      child.emit('close', 0, null);
    };
    const exit = (role, code = 0) => transport.children.get(role).emit('exit', code, null);
    const initial = () => {
      send('caller', 'caller-start', { scenario: spec.scenario });
      send('caller', 'result-ready', {}); send('caller', 'operation-returned', { kind: 'returned' });
    };
    const claim = role => {
      const child = transport.children.get(role);
      const content = role === 'verifier' ? JSON.parse(Buffer.from(child.request.payloadBase64, 'base64').toString('utf8')).expectedPayloadBase64 : child.request.payloadBase64;
      const bytes = Buffer.from(content, 'base64');
      return { bytes: bytes.length, sha256: sha(bytes), manifestSha256: '1'.repeat(64) };
    };
    const finishHelper = async role => {
      send(role, 'start', { scenario: spec.scenario });
      send(role, role === 'writer' ? 'write-entered' : 'verify-entered', { mode: role === 'writer' ? 'write' : 'verify' });
      send(role, role === 'writer' ? 'seal-claim' : 'verified', claim(role));
      exit(role); end(role); await clock.flush();
    };
    const finishCaller = async () => {
      initial(); send('caller', 'caller-after-await', { kind: 'returned' });
      send('caller', 'caller-finished', { exitCode: 0 }); exit('caller'); end('caller'); await clock.flush();
    };
    let error = null, watchdog;
    try {
      await clock.flush();
      await Promise.race([
        operation({ clock, transport, handle, send, initial, end, exit, claim, finishHelper, finishCaller }),
        new Promise((_, reject) => { watchdog = setTimeout(() => reject(new Error('synthetic-test-did-not-settle')), 2000); }),
      ]);
    }
    catch (caught) { error = caught.stack ?? String(caught); }
    finally { clearTimeout(watchdog); }
    cases.push({ id, synthetic: true, native: false, pass: error === null, error, evidence: handle.getEvidenceSnapshot() });
  }
  await run('core-independent-promises', async c => {
    c.initial(); c.send('caller', 'caller-after-await', { kind: 'returned' }); await c.clock.flush();
    assert.equal((await c.handle.observation).kind, 'observed-within-budget');
    assert.equal(c.transport.children.has('writer'), false);
    c.exit('caller'); await c.clock.flush();
    assert.equal((await c.handle.processSettlement).kind, 'exit-observed');
    assert.equal(c.transport.children.has('writer'), false, 'capture must still hold writer');
    c.send('caller', 'caller-finished', { exitCode: 0 }); c.end('caller'); await c.clock.flush();
    await c.finishHelper('writer'); await c.finishHelper('verifier');
    const report = await c.handle.evidenceSettlement;
    assert.equal(report.kind, 'sealed'); assert(Object.isFrozen(report));
    assert.throws(() => { report.kind = 'changed'; });
    const verified = verifySavedCase(c.handle.getEvidenceSnapshot());
    assert.equal(verified.pass, true, verified.errors.join('; '));
    for (const [name, mutate] of [
      ['owner-blocked', v => { v.owner.blocked = true; }],
      ['owner-stream-proof', v => { v.owner.roles[0].streams.stdout.end = false; }],
      ['owner-process-proof', v => { v.owner.roles[0].processResponsibility = 'unconfirmed'; }],
      ['owner-role-identity', v => { v.owner.roles[0].attemptId = 'foreign'; }],
      ['owner-byte-count', v => { v.owner.roles[0].streams.stdout.retainedBytes++; }],
      ['owner-trace-count', v => { v.owner.traceCapacity.events++; }],
      ['owner-late-count', v => { v.owner.lateCapacity.events++; }],
      ['report-helper-inventory', v => { v.reports.evidenceSettlement.helpers = []; }],
      ['report-forged-errors', v => { v.reports.evidenceSettlement.errors = ['forged']; }],
      ['report-helper-exit', v => { v.reports.evidenceSettlement.helpers[0].exit.code = 1; }],
      ['missing-reader-registration', v => { v.trace.find(f => f.event === 'readers-registered').details.channels = []; }],
    ]) {
      const evidence = clone(c.handle.getEvidenceSnapshot()); mutate(evidence);
      const verification = verifySavedCase(evidence);
      cases.push({ id: `core-saved-tamper-${name}`, synthetic: true, native: false, pass: !verification.pass,
        error: verification.pass ? 'tampered-ledger-accepted' : null, evidence, verification, expected: false });
    }
  });
  for (const delta of [-1n, 0n, 1n]) await run(`observation-boundary-${delta}`, async c => {
    c.initial(); await c.clock.advance(2000n * NS + delta, false);
    c.send('caller', 'caller-after-await', { kind: 'returned' }); await c.clock.flush();
    assert.equal((await c.handle.observation).kind, delta < 0n ? 'observed-within-budget' : 'not-observed');
  });
  await run('core-process-before-target-frame', async c => {
    c.initial(); c.exit('caller'); await c.clock.flush();
    assert.equal((await c.handle.processSettlement).kind, 'exit-observed');
    c.send('caller', 'caller-after-await', { kind: 'returned' }); await c.clock.flush();
    assert.equal((await c.handle.observation).kind, 'observed-within-budget');
  });
  await run('core-hard-unknown-and-late-exit', async c => {
    c.initial(); await c.clock.advance(6000n * NS);
    const first = await c.handle.processSettlement, saved = JSON.stringify(first);
    assert.equal(first.kind, 'unconfirmed');
    assert.deepEqual(c.transport.children.get('caller').killAttempts, ['SIGTERM', 'SIGKILL']);
    await c.clock.advance(6100n * NS); c.exit('caller'); await c.clock.flush();
    assert.equal(JSON.stringify(await c.handle.processSettlement), saved);
  });
  await run('core-close-without-end', async c => {
    c.initial(); c.send('caller', 'caller-after-await', { kind: 'returned' }); c.exit('caller');
    for (const s of [c.transport.children.get('caller').stdout, c.transport.children.get('caller').stderr, c.transport.children.get('caller').stdio[3]]) s.emit('close');
    await c.clock.advance(6000n * NS);
    assert.equal(c.handle.getEvidenceSnapshot().trace.find(f => f.event === 'capture-settled').details.integrity, 'incomplete');
  });
  for (const delta of [-1n, 0n, 1n]) await run(`writer-work-exit-${delta}`, async c => {
    await c.finishCaller();
    const e0 = BigInt(c.handle.getEvidenceSnapshot().trace.find(f => f.event === 'evidence-start').details.e0Ns);
    await c.clock.advance(e0 + 1000n * NS + delta, false); await c.finishHelper('writer');
    if (delta < 0n) {
      assert(c.transport.children.has('verifier'));
    } else {
      assert.equal(c.transport.children.has('verifier'), false);
      await c.clock.advance(e0 + 2000n * NS);
      assert.notEqual((await c.handle.evidenceSettlement).kind, 'sealed');
    }
  });
  await run('writer-exit-before-work-tail-after', async c => {
    await c.finishCaller();
    const e0 = BigInt(c.handle.getEvidenceSnapshot().trace.find(f => f.event === 'evidence-start').details.e0Ns);
    c.send('writer', 'start', { scenario: 'D3v3-01' }); c.send('writer', 'write-entered', { mode: 'write' }); c.exit('writer');
    await c.clock.advance(e0 + 1001n * NS);
    c.send('writer', 'seal-claim', c.claim('writer')); c.end('writer'); await c.clock.flush();
    assert.equal(c.transport.children.has('verifier'), false);
    await c.clock.advance(e0 + 2000n * NS);
    assert.notEqual((await c.handle.evidenceSettlement).kind, 'sealed');
  });
  for (const delta of [-1n, 0n, 1n]) await run(`verifier-work-exit-${delta}`, async c => {
    await c.finishCaller(); await c.finishHelper('writer');
    const e0 = BigInt(c.handle.getEvidenceSnapshot().trace.find(f => f.event === 'evidence-start').details.e0Ns);
    await c.clock.advance(e0 + 1000n * NS + delta, false); await c.finishHelper('verifier');
    await c.clock.advance(e0 + 2000n * NS);
    assert.equal((await c.handle.evidenceSettlement).kind, delta < 0n ? 'sealed' : 'incomplete');
  });
  for (const delta of [-1n, 0n, 1n]) await run(`verifier-hard-tail-${delta}`, async c => {
    await c.finishCaller(); await c.finishHelper('writer');
    const e0 = BigInt(c.handle.getEvidenceSnapshot().trace.find(f => f.event === 'evidence-start').details.e0Ns);
    c.send('verifier', 'start', { scenario: 'D3v3-01' }); c.send('verifier', 'verify-entered', { mode: 'verify' }); c.exit('verifier');
    await c.clock.advance(e0 + 2000n * NS + delta, false);
    c.send('verifier', 'verified', c.claim('verifier')); c.end('verifier'); await c.clock.flush();
    assert.equal((await c.handle.evidenceSettlement).kind, delta < 0n ? 'sealed' : 'incomplete');
  });
  await run('core-sticky-invalid-writer', async c => {
    await c.finishCaller();
    c.transport.children.get('writer').stdout.emit('data', Buffer.from('{invalid}\n'));
    await c.finishHelper('writer'); await c.clock.advance(8000n * NS);
    assert.equal((await c.handle.evidenceSettlement).kind, 'failed');
    assert.equal(c.transport.children.has('verifier'), false);
  });
  for (const [id, bytes, finish] of [
    ['invalid-utf8', Buffer.from([0xff, 10]), false],
    ['oversize-frame', Buffer.from('x'.repeat(4097)), false],
    ['EOF-fragment', Buffer.from('{'), true],
  ]) await run(`core-${id}`, async c => {
    c.transport.children.get('caller').stdio[3].emit('data', bytes);
    if (finish) c.transport.children.get('caller').stdio[3].emit('end');
    await c.clock.flush(); assert.equal((await c.handle.observation).kind, 'protocol-failed');
  });
  await run('core-postspawn-error-is-not-spawn-failure', async c => {
    c.initial(); c.transport.children.get('caller').emit('error', Object.assign(new Error('kill error'), { code: 'EPERM' }));
    c.send('caller', 'caller-after-await', { kind: 'returned' });
    c.send('caller', 'caller-finished', { exitCode: 0 }); c.exit('caller'); c.end('caller'); await c.clock.flush();
    assert.equal((await c.handle.processSettlement).kind, 'exit-observed');
    await c.finishHelper('writer'); await c.finishHelper('verifier');
    assert.equal((await c.handle.evidenceSettlement).kind, 'failed');
    assert.equal(c.handle.getEvidenceSnapshot().capture.integrity, 'complete');
    const result = verifySavedCase(c.handle.getEvidenceSnapshot());
    assert.equal(result.pass, true, result.errors.join('; '));
  }, 'synthetic-process-error');
  await run('core-numeric-generation-full-replay', async c => {
    await c.finishCaller(); await c.finishHelper('writer'); await c.finishHelper('verifier');
    const result = verifySavedCase(c.handle.getEvidenceSnapshot());
    assert.equal(result.pass, true, result.errors.join('; '));
  }, 'D3v3-01', 1);
  await run('core-report-reference-deep-frozen', async c => {
    await c.clock.advance(6000n * NS);
    const report = await c.handle.processSettlement;
    assert(Object.isFrozen(report.id)); assert(Object.isFrozen(report.controlAttempts));
    assert.throws(() => report.controlAttempts.push({ signal: 'fake' }));
    assert.throws(() => { report.id.caseId = 'changed'; });
  });
  for (const boundary of ['work', 'hard']) for (const delta of [-1n, 0n, 1n]) {
    const id = `publisher-${boundary}-${delta}`, clock = new VirtualClock(), transport = fakeTransport(clock);
    const spec = { id: identity(id), scenario: 'publisher-normal', entryPath: '/fixture/unused.mjs',
      artifactDirectory: '/fixture/unused', archiveAttemptId: 'archive-1', snapshotOrdinal: 1, payloadBase64: 'e30=' };
    const handle = startPublication(spec, { clock, spawnRole: transport.spawnRole });
    let error = null, watchdog;
    try {
      await clock.flush();
      const child = transport.children.get('publisher');
      const send = (sequence, type, payload) => {
        const frame = makeProtocolFrame(spec.id, 'publisher', sequence, type, payload, clock.time);
        frame.attemptId = child.request.attemptId; frame.requestId = child.request.requestId;
        child.stdout.emit('data', Buffer.from(`${JSON.stringify(frame)}\n`));
      };
      send(1, 'start', { scenario: spec.scenario }); send(2, 'publish-entered', { mode: 'publish' });
      if (boundary === 'hard') child.emit('exit', 0, null);
      await clock.advance(BigInt(boundary === 'work' ? 1000 : 2000) * NS + delta, false);
      send(3, 'publish-claim', { files: 1, manifestSha256: '1'.repeat(64) });
      if (boundary === 'work') child.emit('exit', 0, null);
      for (const stream of [child.stdout, child.stderr, child.stdio[3]]) { stream.emit('end'); stream.emit('close'); }
      await clock.advance(2100n * NS);
      const report = await Promise.race([handle.publication, new Promise((_, reject) => {
        watchdog = setTimeout(() => reject(new Error('publication-test-did-not-settle')), 2000);
      })]);
      assert.equal(report.kind, delta < 0n ? 'published' : 'incomplete');
    } catch (caught) { error = caught.stack ?? String(caught); }
    finally { clearTimeout(watchdog); }
    cases.push({ id, synthetic: true, native: false, pass: error === null, error, evidence: handle.getEvidenceSnapshot() });
  }
  return { pass: cases.every(c => c.pass), attempted: cases.length, passed: cases.filter(c => c.pass).length, cases };
}
