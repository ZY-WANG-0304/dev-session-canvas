import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';
import { fixtureBytes } from './diagnose-native-failure-v1.mjs';
import { assessCase } from './native-failure-verifier-v6.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const event = (name, value = 0, error = 0, aux = 0) => ({ name, value, error, aux });
function ordinals(events) {
  events.forEach((item, index) => { item.ord = index + 1; item.monoNs = String(1000000 + index); });
}
function baseFixture() {
  const scenario = 'U1-0';
  const token = '1234567890abcdef1234567890abcdef';
  const config = { token, scenario, fixtureScenario: 'U1-0', binary: '/fixed/pty.node', binaryHash: 'fixed' };
  const n = { token, scenario, configured: true, forkAttempted: true, masterAcquired: true,
    pid: 1234, master: 20, creationFailed: false, nonblockCalled: true, nonblockResult: 0, nonblockError: 0,
    masterCloseCalls: 1, masterCloseReturned: true, masterCloseError: 0, masterStatValid: true,
    masterFlagsBefore: 32770 | fs.constants.O_NONBLOCK, masterFlagsAfter: 32770 | fs.constants.O_NONBLOCK,
    waitConfirmed: true, waitError: 0, exitCode: 7, signalCode: 0,
    threadStarted: true, threadFinished: true, threadJoined: true, threadJoinError: 0, threadJoinable: false,
    threadConstructCalled: true, threadConstructReturned: true, threadFailureInjected: false,
    threadStartFailed: false, threadStartError: 0, pollWaitCalls: 0, pollWaitStopped: false,
    pollWaitInFlight: false, pollWaitDisposition: 'not-started', tsfnCreated: true, tsfnFinalized: true,
    tsfnCreateStatus: 0, tsfnReleaseStatus: 0, payloadAllocated: true, payloadFreed: true,
    notificationCallInvoked: true, notificationFailureInjected: false,
    notificationStatus: 0, notificationCallbackStatus: 0,
    clockError: 0, overflow: false,
    controlCalls: 0, controlReturned: false, controlError: 0, firstAttempt: null };
  n.events = [event('configured'), event('fork-enter'), event('fork-return', n.pid, 0, n.master),
    event('owner-registered', n.pid, 0, n.master), event('nonblock-enter', n.master),
    event('nonblock-return', 0, 0, n.master), event('tsfn-create-enter'), event('tsfn-create-return'),
    event('thread-construction-enter', n.pid), event('thread-started', n.pid),
    event('thread-construction-return', 0, 0, n.pid), event('wait-enter', n.pid), event('wait-return', n.pid, 0, 1792),
    event('payload-allocated'), event('notification-enter'), event('notification-callback'), event('payload-freed'), event('notification-return'),
    event('tsfn-release-enter'), event('tsfn-release-return'),
    event('thread-finished', n.pid), event('tsfn-finalizer-enter'), event('thread-joined'), event('tsfn-finalized'),
    event('master-fgetfl-before', n.masterFlagsBefore, 0, n.master), event('master-fstat', 0, 0, n.master),
    event('master-fgetfl-after', n.masterFlagsAfter, 0, n.master), event('master-close-enter', n.master),
    event('master-close-return', 0, 0, n.master)];
  ordinals(n.events);
  const written = fixtureBytes(token), wire = Buffer.from(written.toString().replaceAll('\n', '\r\n'));
  const state = { cursorX: 6, cursorY: 4, fixtureState: 'full object equality fixture' };
  config.expected = { writtenBytes: written.length, writtenHash: hash(written), wireBytes: wire.length,
    wireHash: hash(wire), wireBase64: wire.toString('base64'), state };
  const report = { token, scenario, fixtureScenario: 'U1-0', native: n,
    initialNative: { firstAttempt: null }, firstWaitObservation: null,
    loaded: { path: config.binary, hash: config.binaryHash, node: 'v22.23.2' },
    error: null, creationError: null, pollWaitCalls: 0, callback: { exitCode: 7, signalCode: 0 },
    rawBase64: wire.toString('base64'), source: 'linux-eio', state: structuredClone(state),
    readPending: 0, readCalls: 2, parserAccepted: 1, parserCompleted: 1, permissionSent: true,
    controlMessages: [{ type: 'ready', token, pid: n.pid, stdinTTY: true, stdoutTTY: true },
      { type: 'written', token, pid: n.pid, bytes: written.length, hash: hash(written), calls: 1, intendedExitCode: 7 }],
    events: [{ name: 'write-permission', ms: 1 }, { name: 'read-enter', ms: 2 },
      { name: 'read-return', ms: 3, count: wire.length, error: null }, { name: 'parser-enter', ms: 4, bytes: wire.length },
      { name: 'parser-complete', ms: 5 },
      { name: 'exit-callback', ms: 5, exitCode: 7, signalCode: 0 },
      { name: 'read-enter', ms: 6 }, { name: 'read-return', ms: 7, count: 0, error: 'EIO' },
      { name: 'source-end', ms: 8 }, { name: 'final-state', ms: 9 },
      { name: 'master-close-request', ms: 10, readPending: 0, parserPending: 0 }] };
  const caller = { type: 'caller-final', token, closed: { code: 0, signal: null, ms: 2015 },
    exit: { code: 0, signal: null }, stdout: '', stderr: '', events: [
      { name: 'driver-result', ms: 2009 }, { name: 'after-await', ms: 2010 }] };
  const observation = { token, messages: [
    { ms: 2015, value: { type: 'after-await', token, callerMs: 2010, result: { kind: 'result', report } } },
    { ms: 2020, value: caller }], callerExit: { code: 0, signal: null, ms: 2021 },
  callerClose: { code: 0, signal: null, ms: 2022 } };
  const input = { config, observation, caller, n, report };
  return input;
}

function fixture(scenario = 'U1-5') {
  const input = baseFixture(), { config, report, n, caller, observation } = input;
  const held = scenario === 'U1-5';
  const operationId = `${config.token}:master-close:1`;
  const identity = { token: config.token, operationId };
  Object.assign(config, { scenario, nativeScenario: 'U1-0', releaseOperationId: operationId,
    releaseBudgets: { observation: 100, unknownObservation: 1000, hold: 100 } });
  Object.assign(report, { scenario, nativeScenario: 'U1-0' });
  Object.assign(n, { masterStatDev: '1', masterStatIno: '2', masterStatRdev: '3' });
  const readyNative = structuredClone(n);
  Object.assign(readyNative, { events: readyNative.events.slice(0, -5), masterCloseCalls: 0,
    masterCloseReturned: false, masterCloseError: 0, masterFlagsBefore: -1, masterFlagsAfter: -1,
    masterStatValid: false, masterStatDev: '0', masterStatIno: '0', masterStatRdev: '0' });
  const ready = { ms: 10, native: readyNative, readPending: 0, parserPending: 0,
    source: 'linux-eio', writtenReceipts: 1 };
  const driverReceiptMs = held ? 219 : 19;
  report.release = { operationId, ready, requestMs: 16, audit: { ms: 17, native: structuredClone(n) },
    receipt: { ms: driverReceiptMs, native: structuredClone(n) }, receiptPermitMs: held ? 218 : null };
  report.events = report.events.filter(item => item.name !== 'master-close-request');
  report.events.push({ name: 'control-message', ms: 8.5, type: 'written' },
    { name: 'release-ready', ms: 10, operationId }, { name: 'release-request', ms: 16, operationId },
    { name: 'master-close-request', ms: 16.5, operationId, readPending: 0, parserPending: 0 },
    { name: 'release-audit', ms: 17, operationId },
    ...(held ? [{ name: 'receipt-permit', ms: 218, operationId }] : []),
    { name: 'release-receipt', ms: driverReceiptMs, operationId },
    { name: 'native-settled', ms: driverReceiptMs + 1 });
  report.events.sort((a, b) => a.ms - b.ms);
  const audit = { type: 'release-audit', ...identity, snapshot: structuredClone(n) };
  const receipt = { type: 'release-receipt', ...identity, snapshot: structuredClone(n) };
  const receiptMs = held ? 1210 : 1010, firstMs = held ? 1105 : receiptMs;
  const first = { disposition: held ? 'observation-unknown' : 'released', ms: firstMs,
    receipt: held ? null : structuredClone(receipt) };
  caller.operationId = operationId;
  caller.release = { operationId, r0: 1005, deadlineMs: 1105, audit: { ms: 1008, value: audit },
    receipt: { ms: receiptMs, value: receipt }, first, current: 'released', currentMs: receiptMs };
  caller.closed.ms = receiptMs + 5;
  caller.events = [
    { name: 'release-ready', ms: 1001, ...identity },
    { name: 'release-permit', ms: 1004, ...identity },
    { name: 'release-request', ms: 1005, r0: 1005, ...identity },
    { name: 'release-audit', ms: 1008, ...identity },
    { name: 'release-observation', ms: firstMs, disposition: first.disposition, ...identity },
    ...(held ? [{ name: 'receipt-permit', ms: 1207, ...identity }] : []),
    { name: 'release-receipt', ms: receiptMs, ...identity },
    { name: 'release-receipt-observed', ms: receiptMs, current: 'released', ...identity },
    { name: 'driver-result', ms: receiptMs + 2 }, { name: 'after-await', ms: receiptMs + 3 }
  ].sort((a, b) => a.ms - b.ms);
  observation.events = [{ name: 'release-permit', ms: 2003, ...identity },
    ...(held ? [{ name: 'receipt-permit', ms: 2206, ...identity }] : [])];
  observation.messages = [
    { ms: 2002, value: { type: 'release-ready', ...identity, callerMs: 1001, ready: structuredClone(ready) } },
    { ms: 2009, value: { type: 'release-audit-observed', ...identity, callerMs: 1008, audit: structuredClone(audit) } },
    { ms: firstMs + 1001, value: { type: 'release-observation', ...identity, callerMs: firstMs, first: structuredClone(first) } },
    { ms: receiptMs + 1002, value: { type: 'release-receipt-observed', ...identity, callerMs: receiptMs,
      first: structuredClone(first), current: 'released', currentMs: receiptMs, receipt: structuredClone(receipt) } },
    { ms: receiptMs + 1004, value: { type: 'after-await', ...identity, callerMs: receiptMs + 3,
      result: { kind: 'result', report } } },
    { ms: receiptMs + 1007, value: caller }
  ];
  observation.callerExit.ms = receiptMs + 1008;
  observation.callerClose.ms = receiptMs + 1009;
  return input;
}
function assessment(input) {
  const bytes = JSON.stringify(input.observation, null, 2) + '\n';
  return assessCase(input.config, input.observation, { error: null,
    close: { code: 0, signal: null, ms: 30 },
    receipt: { ms: 25, value: { bytes: Buffer.byteLength(bytes), hash: hash(bytes) } } });
}
const msg = (input, type) => input.observation.messages.find(item => item.value.type === type);
const callerEvent = (input, name) => input.caller.events.find(item => item.name === name);

test('normal and held receipts preserve full output, real close and distinct first/current facts', () => {
  for (const scenario of ['U1-0', 'U1-5']) assert.deepEqual(assessment(fixture(scenario)), {
    pass: true, scenarioMatches: true, resourcesSettled: true, evidenceSufficient: true,
    safeToContinue: true, termination: { kind: 'exited', exitCode: 7, rawStatus: 1792 }, failures: [] });
});

test('missing audit stops admission while a fully evidenced late audit only fails its premise', () => {
  const missing = fixture();
  missing.observation.messages = missing.observation.messages.filter(item => item.value.type !== 'release-audit-observed');
  assert.equal(assessment(missing).safeToContinue, false);
  const late = fixture(), time = late.caller.release.deadlineMs + 1;
  late.caller.release.audit.ms = time;
  callerEvent(late, 'release-audit').ms = time;
  msg(late, 'release-audit-observed').value.callerMs = time;
  msg(late, 'release-audit-observed').ms = time + 1001;
  late.caller.events.sort((a, b) => a.ms - b.ms);
  late.observation.messages.sort((a, b) => a.ms - b.ms);
  const result = assessment(late);
  assert.equal(result.scenarioMatches, false);
  assert.equal(result.resourcesSettled, true);
  assert.equal(result.evidenceSufficient, true);
  assert.equal(result.safeToContinue, true);
});

test('audit cannot substitute a receipt or erase the immutable unknown observation', () => {
  for (const mutate of [
    input => { input.caller.release.first = { disposition: 'released', ms: 1008, receipt: input.caller.release.audit.value }; },
    input => { input.caller.release.first.receipt = input.caller.release.audit.value; },
    input => { input.caller.release.currentMs = input.caller.release.audit.ms; },
    input => { input.caller.release.receipt = null; }
  ]) { const input = fixture(); mutate(input); assert.equal(assessment(input).safeToContinue, false); }
});

test('only the matching permit after the independent hold may release the cached receipt', () => {
  const missing = fixture();
  missing.observation.events = missing.observation.events.filter(item => item.name !== 'receipt-permit');
  assert.equal(assessment(missing).safeToContinue, false);
  const early = fixture();
  early.observation.events.find(item => item.name === 'receipt-permit').ms--;
  const result = assessment(early);
  assert.equal(result.scenarioMatches, false);
  assert.equal(result.safeToContinue, true);
  const premature = fixture();
  premature.report.release.receiptPermitMs = 16;
  premature.report.events.find(item => item.name === 'receipt-permit').ms = 16;
  assert.equal(assessment(premature).safeToContinue, false);
});

test('a repeated or actually failed close cannot be concealed by driver exit or a receipt', () => {
  for (const mutate of [
    input => { input.n.masterCloseCalls = 2; },
    input => { input.n.masterCloseError = 5; const returned = input.n.events.at(-1); returned.value = -1; returned.error = 5; },
    input => { input.n.masterCloseReturned = false; },
    input => { input.report.release.ready.native.masterCloseCalls = 1; }
  ]) { const input = fixture(); mutate(input); const result = assessment(input);
    assert.equal(result.pass, false); assert.equal(result.safeToContinue, false); }
});

test('case/native mapping and every receipt identity remain explicit and single-use', () => {
  for (const mutate of [
    input => { input.config.nativeScenario = 'U1-5'; },
    input => { input.caller.release.receipt.value.operationId += ':other'; },
    input => { input.caller.release.audit.value.token = 'f'.repeat(32); },
    input => { input.observation.events.push(structuredClone(input.observation.events[0])); },
    input => { input.observation.events.push({ name: 'caller-send-error', ms: 2004 }); }
  ]) { const input = fixture(); mutate(input); assert.equal(assessment(input).safeToContinue, false); }
});

test('same-clock event times cannot diverge from first, request or receipt evidence', () => {
  for (const name of ['release-request', 'release-audit', 'release-receipt', 'release-observation', 'release-receipt-observed']) {
    const input = fixture();
    callerEvent(input, name).ms -= 0.5;
    assert.equal(assessment(input).safeToContinue, false, name);
  }
  const input = fixture();
  msg(input, 'release-observation').value.callerMs += 0.5;
  assert.equal(assessment(input).safeToContinue, false);
});

test('release readiness cannot bypass output, consumer, process or notification completion', () => {
  for (const mutate of [
    input => { input.report.release.ready.native.waitConfirmed = false; },
    input => { input.report.release.ready.readPending = 1; },
    input => { input.report.parserCompleted = 0; },
    input => { input.report.callback = null; },
    input => { input.report.state.cursorX = 0; }
  ]) { const input = fixture(); mutate(input); assert.equal(assessment(input).pass, false); }
});
