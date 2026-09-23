import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';
import { fixtureBytes } from './diagnose-native-failure-v1.mjs';
import { assessCase } from './native-failure-verifier-v4.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const event = (name, value = 0, error = 0, aux = 0) => ({ name, value, error, aux });
function ordinals(events) {
  events.forEach((item, index) => { item.ord = index + 1; item.monoNs = String(1000000 + index); });
}
function bindFirst(input, confirmed = false) {
  const first = input.n.events.find(item => item.name === 'first-wait-unconfirmed');
  input.n.firstAttempt = { synthetic: true, syscallCalled: false, result: -1, error: 10,
    statusValid: false, rawStatus: null, disposition: 'unconfirmed', nativeOrdinal: first.ord, monoNs: first.monoNs };
  input.report.firstWaitObservation = { firstAttempt: structuredClone(input.n.firstAttempt),
    currentWaitConfirmed: confirmed, exitCode: confirmed ? input.n.exitCode : null,
    signalCode: confirmed ? input.n.signalCode : null };
  input.report.events.find(item => item.name === 'initial-wait-result').snapshot = structuredClone(input.report.firstWaitObservation);
  input.observation.messages.find(item => item.value.type === 'initial-wait-result').value.snapshot =
    structuredClone(input.report.firstWaitObservation);
}
function fixture(scenario = 'U1-3') {
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
    notificationStatus: 0, notificationCallbackStatus: 0, clockError: 0, overflow: false,
    controlCalls: 0, controlReturned: false, controlError: 0, firstAttempt: null };
  n.events = [event('configured'), event('fork-enter'), event('fork-return', n.pid, 0, n.master),
    event('owner-registered', n.pid, 0, n.master), event('nonblock-enter', n.master),
    event('nonblock-return', 0, 0, n.master), event('tsfn-create-enter'), event('tsfn-create-return'),
    event('thread-construction-enter', n.pid), event('thread-started', n.pid),
    ...(scenario === 'U1-3' ? [event('first-wait-unconfirmed', -1, 10)] : []),
    event('thread-construction-return', 0, 0, n.pid), event('wait-enter', n.pid), event('wait-return', n.pid, 0, 1792),
    event('payload-allocated'), event('notification-enter'), event('notification-callback'), event('payload-freed'),
    event('notification-return'), event('tsfn-release-enter'), event('tsfn-release-return'),
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
    events: [...(scenario === 'U1-3' ? [{ name: 'initial-wait-result', ms: 0 }] : []),
      { name: 'write-permission', ms: 1 }, { name: 'read-enter', ms: 2 },
      { name: 'read-return', ms: 3, count: wire.length, error: null }, { name: 'parser-enter', ms: 4, bytes: wire.length },
      { name: 'parser-complete', ms: 5 }, { name: 'exit-callback', ms: 5, exitCode: 7, signalCode: 0 },
      { name: 'read-enter', ms: 6 }, { name: 'read-return', ms: 7, count: 0, error: 'EIO' },
      { name: 'source-end', ms: 8 }, { name: 'final-state', ms: 9 },
      { name: 'master-close-request', ms: 10, readPending: 0, parserPending: 0 }] };
  const caller = { type: 'caller-final', token, closed: { code: 0, signal: null, ms: 2015 },
    exit: { code: 0, signal: null }, stdout: '', stderr: '', events: [
      ...(scenario === 'U1-3' ? [{ name: 'initial-wait-result', ms: 100, token }] : []),
      { name: 'driver-result', ms: 2009 }, { name: 'after-await', ms: 2010 }] };
  const observation = { token, messages: [
    ...(scenario === 'U1-3' ? [{ ms: 110, value: { type: 'initial-wait-result', token, callerMs: 101 } }] : []),
    { ms: 2015, value: { type: 'after-await', token, callerMs: 2010, result: { kind: 'result', report } } },
    { ms: 2020, value: caller }], callerExit: { code: 0, signal: null, ms: 2021 },
  callerClose: { code: 0, signal: null, ms: 2022 } };
  const input = { config, observation, caller, n, report };
  if (scenario === 'U1-3') bindFirst(input);
  return input;
}
function assessment(input, editEvidence = () => {}) {
  const bytes = JSON.stringify(input.observation, null, 2) + '\n';
  const evidence = { error: null, close: { code: 0, signal: null, ms: 30 },
    receipt: { ms: 25, value: { bytes: Buffer.byteLength(bytes), hash: hash(bytes) } } };
  editEvidence(evidence);
  return assessCase(input.config, input.observation, evidence);
}
function addWait(input, value, error, status = 0) {
  const index = input.n.events.findIndex(item => item.name === 'wait-enter');
  input.n.events.splice(index, 0, event('wait-enter', input.n.pid), event('wait-return', value, error, status));
  ordinals(input.n.events);
  if (input.config.scenario === 'U1-3') bindFirst(input);
}

test('control and synthetic first failure both require full normal output and real lifecycle', () => {
  for (const scenario of ['U1-0', 'U1-3']) assert.deepEqual(assessment(fixture(scenario)), {
    pass: true, scenarioMatches: true, resourcesSettled: true, evidenceSufficient: true,
    safeToContinue: true, termination: { kind: 'exited', exitCode: 7, rawStatus: 1792 }, failures: [] });
});

test('first synthetic result is immutable, unconfirmed and has no decoded status', () => {
  for (const [field, value] of [['synthetic', false], ['syscallCalled', true], ['result', 1234], ['error', 0],
    ['statusValid', true], ['rawStatus', 0], ['disposition', 'terminal'], ['nativeOrdinal', 1], ['monoNs', '1']]) {
    const input = fixture(); input.n.firstAttempt[field] = value;
    assert.equal(assessment(input).safeToContinue, false, field);
  }
  for (const mutate of [input => { input.n.firstAttempt = null; },
    input => { delete input.report.firstWaitObservation; },
    input => { input.report.firstWaitObservation.firstAttempt = { exitCode: 7 }; },
    input => { input.report.initialNative.firstAttempt = { exitCode: 7 }; },
    input => { input.n.events.find(item => item.name === 'first-wait-unconfirmed').aux = 1792; }]) {
    const input = fixture(); mutate(input); assert.equal(assessment(input).safeToContinue, false);
  }
  const control = fixture('U1-0'); control.n.firstAttempt = fixture().n.firstAttempt;
  assert.equal(assessment(control).safeToContinue, false);
});

test('unconfirmed JS snapshot cannot fabricate exit zero or final status', () => {
  for (const [field, value] of [['exitCode', 0], ['exitCode', 7], ['signalCode', 0], ['currentWaitConfirmed', 'false']]) {
    const input = fixture(); input.report.firstWaitObservation[field] = value;
    input.report.events[0].snapshot = structuredClone(input.report.firstWaitObservation);
    input.observation.messages[0].value.snapshot = structuredClone(input.report.firstWaitObservation);
    assert.equal(assessment(input).safeToContinue, false, field);
  }
});

test('first observation may occur after real recovery and after exit callback', () => {
  const input = fixture(); bindFirst(input, true);
  const initial = input.report.events.shift(); initial.ms = 11; input.report.events.push(initial);
  assert.equal(assessment(input).pass, true);
  input.report.firstWaitObservation.exitCode = 0;
  assert.equal(assessment(input).safeToContinue, false);
});

test('native, JS event and forwarded IPC must preserve the same first attempt', () => {
  for (const mutate of [input => { input.report.events[0].snapshot.firstAttempt.error = 4; },
    input => { input.observation.messages[0].value.snapshot.firstAttempt.rawStatus = 1792; },
    input => { input.observation.messages[0].value.token = 'wrong'; },
    input => { input.observation.messages.shift(); },
    input => { input.caller.events.shift(); },
    input => { input.observation.messages.push(structuredClone(input.observation.messages[0])); },
    input => { input.observation.messages[0].value.callerMs = 2010; },
    input => { input.observation.messages[0].ms = 2020; }]) {
    const input = fixture(); mutate(input); assert.equal(assessment(input).safeToContinue, false);
  }
});

test('first synthetic event stays after the sole thread start and before real wait', () => {
  for (const name of ['thread-started', 'wait-enter']) {
    const input = fixture(), events = input.n.events;
    const first = events.splice(events.findIndex(item => item.name === 'first-wait-unconfirmed'), 1)[0];
    events.splice(events.findIndex(item => item.name === name) + (name === 'wait-enter' ? 1 : 0), 0, first);
    ordinals(events); bindFirst(input);
    assert.equal(assessment(input).safeToContinue, false);
  }
});

test('only real EINTR permits a repeated blocking wait', () => {
  const input = fixture(); addWait(input, -1, 4); assert.equal(assessment(input).pass, true);
  input.n.events.find(item => item.name === 'wait-return').aux = 1792;
  assert.equal(assessment(input).safeToContinue, false);
  for (const [value, error] of [[-1, 10], [-1, 5], [0, 0], [1234, 0]]) {
    const failed = fixture(); addWait(failed, value, error);
    assert.equal(assessment(failed).resourcesSettled, false);
  }
  const failed = fixture(), wait = failed.n.events.find(item => item.name === 'wait-return');
  Object.assign(wait, { value: -1, error: 10, aux: 0 }); failed.n.exitCode = 0;
  failed.report.callback.exitCode = 0;
  const result = assessment(failed);
  assert.equal(result.resourcesSettled, false); assert.equal(result.safeToContinue, false);
  assert.equal(result.termination, null);
});

test('wrong pid, stopped or continued status never establishes child reap', () => {
  for (const mutate of [input => { input.n.events.find(item => item.name === 'wait-return').value++; },
    input => { input.n.events.find(item => item.name === 'wait-return').aux = 0x137f; },
    input => { input.n.events.find(item => item.name === 'wait-return').aux = 0xffff; },
    input => { input.n.waitConfirmed = false; }]) {
    const input = fixture(); mutate(input); const result = assessment(input);
    assert.equal(result.resourcesSettled, false); assert.equal(result.safeToContinue, false);
  }
});

test('alternate waiter, polling and control cannot satisfy admission', () => {
  for (const name of ['thread-started', 'thread-construction-enter', 'payload-allocated', 'notification-enter',
    'wait-poll-enter', 'wait-poll-return', 'control-enter', 'control-return', 'first-wait-unconfirmed']) {
    const input = fixture(); input.n.events.push(event(name)); ordinals(input.n.events);
    assert.equal(assessment(input).safeToContinue, false, name);
  }
  for (const mutate of [input => { input.n.pollWaitCalls = 1; }, input => { input.report.pollWaitCalls = 1; },
    input => { input.n.controlCalls = 1; }, input => { input.n.pollWaitInFlight = true; }]) {
    const input = fixture(); mutate(input); assert.equal(assessment(input).safeToContinue, false);
  }
});

test('thread constructor return and actual start are allowed to race', () => {
  for (const scenario of ['U1-0', 'U1-3']) {
    const input = fixture(scenario), events = input.n.events;
    const returned = events.splice(events.findIndex(item => item.name === 'thread-construction-return'), 1)[0];
    events.splice(events.findIndex(item => item.name === 'thread-started'), 0, returned);
    ordinals(events); if (scenario === 'U1-3') bindFirst(input);
    assert.equal(assessment(input).pass, true);
  }
});

test('resource settlement, content match and evidence are independent verdicts', () => {
  for (const mutate of [input => { input.n.masterCloseReturned = false; }, input => { input.n.tsfnReleaseStatus = 1; },
    input => { input.n.tsfnFinalized = false; }, input => { input.n.threadJoined = false; },
    input => { input.n.threadJoinable = true; }, input => { input.n.payloadFreed = false; },
    input => { input.report.readPending = 1; }, input => { input.report.parserCompleted = 0; }]) {
    const input = fixture(); mutate(input); const result = assessment(input);
    assert.equal(result.resourcesSettled, false); assert.equal(result.safeToContinue, false);
  }
  for (const scenario of ['U1-0', 'U1-3']) {
    const input = fixture(scenario); input.report.state.cursorY = 3;
    const result = assessment(input);
    assert.equal(result.scenarioMatches, false); assert.equal(result.resourcesSettled, true);
    assert.equal(result.evidenceSufficient, true); assert.equal(result.safeToContinue, true);
  }
});

test('missing identities, fixture mapping and raw evidence block admission', () => {
  for (const mutate of [input => { input.report.token = 'wrong'; }, input => { delete input.config.fixtureScenario; },
    input => { input.report.fixtureScenario = 'U1-3'; }, input => { input.n.exitCode = 0; },
    input => { delete input.report.native; }, input => { input.n.events = null; }]) {
    const input = fixture(); mutate(input); assert.equal(assessment(input).safeToContinue, false);
  }
  assert.equal(assessment(fixture(), evidence => { evidence.receipt.value.hash = 'bad'; }).safeToContinue, false);
});
