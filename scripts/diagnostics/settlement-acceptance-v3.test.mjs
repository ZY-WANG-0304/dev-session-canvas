import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { assessDiagnosticEvidence, evaluateRunAcceptance, fullSchedule } from './diagnose-settlement-v3.mjs';
import { startObservedCase, startPublication } from './diagnostic-settlement-v3.mjs';
import { VirtualClock, fakeTransport, makeProtocolFrame } from './settlement-fixtures-v3.mjs';
import { verifySavedCase, verifyPublicationSnapshot } from './settlement-oracle-v3.mjs';

assert.equal(process.version, 'v22.23.2', 'Settlement acceptance tests require frozen Node 22.23.2');
const copy = value => structuredClone(value);
const hash = value => createHash('sha256').update(value).digest('hex');
const overflowEntry = fullSchedule().find(entry => entry.scenario === 'D3v3-08');

async function execution(scenario, caseId, publication = false) {
  const clock = new VirtualClock();
  const transport = fakeTransport(clock);
  const spec = { id: { schema: 'diagnostic-settlement-v3', runId: 'acceptance-test', caseId, generation: 'g1', nonce: 'acceptance-nonce' },
    scenario, entryPath: '/fixture/unused.mjs', artifactDirectory: '/fixture/artifacts',
    ...(publication ? { archiveAttemptId: 'publication-1', snapshotOrdinal: 1, payloadBase64: 'e30=' } : {}) };
  const handle = (publication ? startPublication : startObservedCase)(spec, { clock, spawnRole: transport.spawnRole, pathStyle: 'posix' });
  await clock.flush();
  const send = (role, type, payload) => {
    const child = transport.children.get(role);
    assert(child, `Missing fake ${role}`);
    const frame = { ...makeProtocolFrame(spec.id, role, ++child.sequence, type, payload, clock.time),
      attemptId: child.request.attemptId, requestId: child.request.requestId };
    const stream = type === 'caller-after-await' ? child.stdio[3] : child.stdout;
    stream.emit('data', Buffer.from(`${JSON.stringify(frame)}\n`));
  };
  const end = async (role, code = 0) => {
    const child = transport.children.get(role);
    child.emit('exit', code, null);
    for (const stream of [child.stdout, child.stderr, child.stdio[3]]) stream.emit('end');
    await clock.flush();
  };
  const helper = async (role, failed = false) => {
    const action = { writer: 'write', verifier: 'verify', publisher: 'publish' }[role];
    send(role, 'start', { scenario });
    send(role, `${action}-entered`, { mode: action });
    if (failed) send(role, 'failed', { code: 'EEXIST', message: 'Expected exclusive-create failure' });
    else {
      let claim = { files: 1, manifestSha256: '1'.repeat(64) };
      if (role !== 'publisher') {
        const request = transport.children.get(role).request;
        const encoded = role === 'writer' ? request.payloadBase64 : JSON.parse(Buffer.from(request.payloadBase64, 'base64')).expectedPayloadBase64;
        const payload = Buffer.from(encoded, 'base64');
        claim = { bytes: payload.length, sha256: hash(payload), manifestSha256: '1'.repeat(64) };
      }
      send(role, { writer: 'seal-claim', verifier: 'verified', publisher: 'publish-claim' }[role], claim);
    }
    await end(role, failed ? 1 : 0);
  };
  return { clock, transport, handle, send, end, helper };
}

let overflowPromise;
function overflowCase() {
  overflowPromise ??= (async () => {
    const c = await execution('D3v3-08', overflowEntry.id);
    c.send('caller', 'caller-start', { scenario: 'D3v3-08' });
    c.send('caller', 'result-ready', {});
    c.send('caller', 'operation-returned', { kind: 'returned' });
    c.send('caller', 'caller-after-await', { kind: 'returned' });
    const caller = c.transport.children.get('caller');
    const ack = JSON.parse(caller.stdio[4].writes.at(-1));
    assert.equal(ack.payload.forType, 'caller-after-await');
    assert.equal(ack.requestId, caller.request.requestId);
    for (let index = 1; index <= 4296; index++) c.send('caller', 'bulk', { index, body: 'x'.repeat(220) });
    c.send('caller', 'caller-finished', { exitCode: 0 });
    assert.equal(caller.sequence, 4301);
    await c.end('caller');
    await c.helper('writer');
    await c.helper('verifier');
    const snapshot = c.handle.getEvidenceSnapshot();
    const verification = verifySavedCase(snapshot);
    assert.equal(verification.pass, true, JSON.stringify(verification.errors));
    return { snapshot, verification };
  })();
  return overflowPromise;
}

function assessment(entry, phase, snapshot, verification) {
  return assessDiagnosticEvidence(entry, phase, [snapshot, snapshot], [verification, verification]);
}

test('D3v3-08 accepts proved bulk overflow without claiming complete diagnostics', async () => {
  const { snapshot, verification } = await overflowCase();
  assert.equal(verification.errorDiagnosticsComplete, false);
  assert.equal(snapshot.reports.evidenceSettlement.kind, 'incomplete');
  assert.equal(snapshot.owner.traceCapacity.controlOverflow, false);
  assert.deepEqual(assessment(overflowEntry, 'case', snapshot, verification), {
    id: overflowEntry.id, phase: 'case', complete: false, sufficient: true, basis: 'expected-trace-capacity',
  });
});

test('publisher oracle success validates the expected outcome, not unconditional publication', async () => {
  for (const [scenario, failed, kind] of [['publisher-normal', false, 'published'], ['publisher-eexist', true, 'failed']]) {
    const entry = fullSchedule().find(value => value.scenario === scenario);
    const c = await execution(scenario, entry.id, true);
    await c.helper('publisher', failed);
    const snapshot = c.handle.getEvidenceSnapshot();
    const verification = verifyPublicationSnapshot(snapshot);
    assert.equal(verification.pass, true, JSON.stringify(verification.errors));
    assert.equal(snapshot.reports.publication.kind, kind);
    assert.equal(assessment(entry, 'publication', snapshot, verification).sufficient, true);
    if (failed) {
      assert.notEqual(snapshot.reports.publication.kind, 'published');
      const wrongExpectation = copy(snapshot);
      wrongExpectation.spec.scenario = 'publisher-normal';
      assert.equal(verifyPublicationSnapshot(wrongExpectation).pass, false);
    }
  }
});

test('the overflow exception excludes other scenarios and publication detail loss', async () => {
  const { snapshot, verification } = await overflowCase();
  assert.equal(assessment({ ...overflowEntry, scenario: 'D3v3-01' }, 'case', snapshot, verification).sufficient, false);
  assert.equal(assessment(overflowEntry, 'publication', snapshot, verification).sufficient, false);
  const entry = fullSchedule().find(value => value.scenario === 'publisher-normal');
  const c = await execution(entry.scenario, entry.id, true);
  await c.helper('publisher');
  const initial = c.handle.getEvidenceSnapshot();
  c.handle.subscribeLateFacts(() => { throw { name: 'x'.repeat(129), code: 'EIO', message: 'late listener failure' }; });
  c.transport.children.get('publisher').emit('close', 0, null);
  await c.clock.flush();
  const final = c.handle.getEvidenceSnapshot();
  const before = verifyPublicationSnapshot(initial), after = verifyPublicationSnapshot(final);
  assert.equal(before.pass, true);
  assert.equal(after.pass, true, JSON.stringify(after.errors));
  assert.equal(after.errorDiagnosticsComplete, false);
  assert.equal(assessDiagnosticEvidence(entry, 'publication', [initial, final], [before, after]).sufficient, false);
});

test('D3v3-08 does not excuse lost error details, summaries, control facts, or overflow binding', async () => {
  const { snapshot, verification } = await overflowCase();
  const mutations = [
    value => { value.reports.evidenceSettlement.artifactVerified = false; },
    value => { value.reports.evidenceSettlement.helpers.pop(); },
    value => { value.reports.evidenceSettlement.helpers[1].exit.signal = 'SIGTERM'; },
    value => { value.reports.evidenceSettlement.helpers[1].exit.code = 1; },
    value => { value.reports.evidenceSettlement.helpers[0].controlAttempts.push({ signal: 'SIGTERM' }); },
    value => { value.reports.evidenceSettlement.helpers[1].exit.receiptNs = String(BigInt(value.reports.evidenceSettlement.deadlineNs) - 1_000_000_000n); },
    value => { value.reports.evidenceSettlement.helpers[1].streams.stdout.end = false; },
    value => { value.reports.evidenceSettlement.helpers[1].streams.stdout.cancelled = true; },
    value => { value.trace.find(fact => fact.event === 'ack-sent').details.error = { truncatedFields: ['message'] }; },
    value => { value.owner.roles[0].errorCapacity.omitted = true; },
    value => { delete value.owner.roles[0].errorCapacity; },
    value => { value.owner.listenerFailureCapacity.fieldsTruncated = true; },
    value => { value.owner.traceCapacity.controlOverflow = true; },
    value => { value.owner.lateCapacity.overflow = true; },
    value => { value.owner.traceCapacity.overflow.firstOmittedOrdinal++; },
    value => {
      delete value.owner.traceCapacity.overflow.firstOmittedOrdinal;
      delete value.trace.find(fact => fact.event === 'trace-overflow').details.firstOmittedOrdinal;
    },
    value => {
      value.owner.traceCapacity.overflow.firstOmittedOrdinal = null;
      value.trace.find(fact => fact.event === 'trace-overflow').details.firstOmittedOrdinal = null;
    },
    value => { value.trace.find(fact => fact.event === 'trace-overflow').eventOrdinal = value.owner.traceCapacity.overflow.firstOmittedOrdinal; },
    value => { value.trace = value.trace.filter(fact => fact.event !== 'trace-overflow'); },
  ];
  for (const mutate of mutations) {
    const changed = copy(snapshot); mutate(changed);
    // Hold the oracle verdict fixed to test the assessment's additional guards.
    assert.equal(assessment(overflowEntry, 'case', changed, verification).sufficient, false);
  }
});

test('removing ACK causality makes the bulk-overflow evidence fail independent replay', async () => {
  const { snapshot } = await overflowCase();
  const changed = copy(snapshot);
  changed.trace = changed.trace.filter(fact => !(fact.event === 'ack-sent' && fact.role === 'caller' && fact.details.forType === 'caller-after-await'));
  changed.owner.traceCapacity.events = changed.trace.length;
  changed.owner.traceCapacity.bytes = changed.trace.reduce((total, fact) => total + Buffer.byteLength(JSON.stringify(fact)), 0);
  const verification = verifySavedCase(changed);
  assert.equal(verification.pass, false);
  assert(verification.errors.includes('after-await-ack-prerequisite'), JSON.stringify(verification.errors));
  assert.equal(assessment(overflowEntry, 'case', changed, verification).sufficient, false);
});

async function simulatedFullReport() {
  const { snapshot, verification } = await overflowCase();
  const expectedOverflow = assessment(overflowEntry, 'case', snapshot, verification);
  const report = { pass: true, consumerDeliveries: [], errorDiagnostics: [] };
  const schedule = fullSchedule();
  assert.equal(schedule.length, 42);
  for (const entry of schedule) {
    for (const phase of entry.group === 'publisher' ? ['publication'] : ['publication', 'case']) {
      report.errorDiagnostics.push(phase === 'case' && entry.scenario === 'D3v3-08' ? { ...expectedOverflow, id: entry.id } :
        { id: entry.id, phase, complete: true, sufficient: true, basis: 'complete-error-diagnostics' });
      report.consumerDeliveries.push({ id: entry.id, phase, receipts: (phase === 'case' ? ['observation', 'processSettlement', 'evidenceSettlement'] : ['publication'])
        .map(name => ({ name, status: 'within-consumer-budget' })) });
    }
  }
  return report;
}

test('the full 42-entry aggregate permits three expected overflows but reports detail incompleteness', async () => {
  const report = await simulatedFullReport();
  assert.equal(report.errorDiagnostics.length, 80);
  assert.equal(report.errorDiagnostics.filter(item => !item.complete).length, 3);
  assert.deepEqual(evaluateRunAcceptance({ mode: 'full' }, report), {
    boundedConsumerDelivery: true, errorDiagnosticsComplete: false, scenarioEvidenceSufficient: true, acceptanceReady: true,
  });
});

test('missing evidence, late consumers, self-tests, and synthetic archives cannot be acceptance ready', async () => {
  const report = await simulatedFullReport();
  for (const alter of [
    value => { value.pass = false; },
    value => { value.errorDiagnostics = []; },
    value => { value.errorDiagnostics[0].sufficient = false; },
    value => { value.consumerDeliveries = []; },
    value => { value.consumerDeliveries[0].receipts[0].status = 'consumer-delivery-late'; },
  ]) {
    const changed = copy(report); alter(changed);
    assert.equal(evaluateRunAcceptance({ mode: 'full' }, changed).acceptanceReady, false);
  }
  for (const run of [{ mode: 'self-test' }, { mode: 'full', syntheticArchiveFixture: true }, { mode: 'full', syntheticProducer: {} }]) {
    assert.equal(evaluateRunAcceptance(run, report).acceptanceReady, false);
  }
});

test('both initial and final snapshots require successful independent verification', async () => {
  const { snapshot, verification } = await overflowCase();
  for (const [snapshots, verifications] of [
    [[snapshot], [verification, verification]],
    [[snapshot, snapshot], [verification]],
    [[snapshot, snapshot], [verification, { ...verification, pass: false }]],
  ]) assert.equal(assessDiagnosticEvidence(overflowEntry, 'case', snapshots, verifications).sufficient, false);
});

test('consumer coverage uses the trusted 80 phases independently of report pass or saved schedule', async () => {
  const report = await simulatedFullReport();
  assert.equal(report.consumerDeliveries.length, 80);
  assert.equal(evaluateRunAcceptance({ mode: 'full' }, report).boundedConsumerDelivery, true);
  const rejectedReport = copy(report);
  rejectedReport.pass = false;
  assert.deepEqual(evaluateRunAcceptance({ mode: 'full' }, rejectedReport), {
    boundedConsumerDelivery: true, errorDiagnosticsComplete: false, scenarioEvidenceSufficient: true, acceptanceReady: false,
  });
  const reducedSchedule = fullSchedule().slice(0, 1);
  const reducedReport = copy(report);
  reducedReport.consumerDeliveries = reducedReport.consumerDeliveries.filter(item => item.id === reducedSchedule[0].id);
  assert.equal(reducedReport.consumerDeliveries.length, 2);
  const reduced = evaluateRunAcceptance({ mode: 'full', schedule: reducedSchedule }, reducedReport);
  assert.equal(reduced.boundedConsumerDelivery, false, 'A saved one-entry schedule cannot reduce the trusted denominator');
  assert.equal(reduced.acceptanceReady, false);
});

test('missing or duplicated consumer phases and receipts cannot count as complete delivery', async () => {
  const report = await simulatedFullReport();
  const overflowIds = new Set(fullSchedule().filter(entry => entry.scenario === 'D3v3-08').map(entry => entry.id));
  assert.equal(overflowIds.size, 3);
  const gaps = [
    ['three overflow case phases are missing', value => {
      value.consumerDeliveries = value.consumerDeliveries.filter(item => item.phase !== 'case' || !overflowIds.has(item.id));
      assert.equal(value.consumerDeliveries.length, 77);
    }],
    ['a duplicate phase replaces a required phase without changing the count', value => {
      value.consumerDeliveries[1] = copy(value.consumerDeliveries[0]);
      assert.equal(value.consumerDeliveries.length, 80);
    }],
    ['an unknown case id replaces a required id', value => { value.consumerDeliveries[0].id = 'D3v3-unknown'; }],
    ['an unknown phase replaces publication', value => { value.consumerDeliveries[0].phase = 'capture'; }],
    ['a publication has no receipt', value => { value.consumerDeliveries[0].receipts = []; }],
    ['a case is missing its evidence settlement receipt', value => {
      value.consumerDeliveries.find(item => item.phase === 'case').receipts.pop();
    }],
    ['a duplicate observation name replaces the evidence settlement receipt', value => {
      const receipts = value.consumerDeliveries.find(item => item.phase === 'case').receipts;
      receipts[2] = copy(receipts[0]);
      assert.equal(receipts.length, 3);
    }],
  ];
  for (const [gap, alter] of gaps) {
    const changed = copy(report); alter(changed);
    assert.equal(changed.pass, true);
    const result = evaluateRunAcceptance({ mode: 'full' }, changed);
    assert.equal(result.boundedConsumerDelivery, false, gap);
    assert.equal(result.acceptanceReady, false, gap);
  }
});
