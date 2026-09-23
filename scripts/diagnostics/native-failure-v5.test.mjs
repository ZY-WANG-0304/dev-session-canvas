import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';
import { fixtureBytes } from './diagnose-native-failure-v1.mjs';
import { assessCase } from './native-failure-verifier-v5.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const event = (name, value = 0, error = 0, aux = 0) => ({ name, value, error, aux });
function ordinals(events) {
  events.forEach((item, index) => { item.ord = index + 1; item.monoNs = String(1000000 + index); });
}
function fixture(scenario = 'U1-4') {
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
    notificationCallInvoked: scenario === 'U1-0', notificationFailureInjected: scenario === 'U1-4',
    notificationStatus: scenario === 'U1-4' ? 16 : 0, notificationCallbackStatus: scenario === 'U1-4' ? null : 0,
    clockError: 0, overflow: false,
    controlCalls: 0, controlReturned: false, controlError: 0, firstAttempt: null };
  n.events = [event('configured'), event('fork-enter'), event('fork-return', n.pid, 0, n.master),
    event('owner-registered', n.pid, 0, n.master), event('nonblock-enter', n.master),
    event('nonblock-return', 0, 0, n.master), event('tsfn-create-enter'), event('tsfn-create-return'),
    event('thread-construction-enter', n.pid), event('thread-started', n.pid),
    event('thread-construction-return', 0, 0, n.pid), event('wait-enter', n.pid), event('wait-return', n.pid, 0, 1792),
    event('payload-allocated'), ...(scenario === 'U1-4' ? [event('notification-call-skipped', 16), event('payload-freed')] :
      [event('notification-enter'), event('notification-callback'), event('payload-freed'), event('notification-return')]),
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
    error: null, creationError: null, pollWaitCalls: 0, callback: scenario === 'U1-4' ? null : { exitCode: 7, signalCode: 0 },
    rawBase64: wire.toString('base64'), source: 'linux-eio', state: structuredClone(state),
    readPending: 0, readCalls: 2, parserAccepted: 1, parserCompleted: 1, permissionSent: true,
    controlMessages: [{ type: 'ready', token, pid: n.pid, stdinTTY: true, stdoutTTY: true },
      { type: 'written', token, pid: n.pid, bytes: written.length, hash: hash(written), calls: 1, intendedExitCode: 7 }],
    events: [{ name: 'write-permission', ms: 1 }, { name: 'read-enter', ms: 2 },
      { name: 'read-return', ms: 3, count: wire.length, error: null }, { name: 'parser-enter', ms: 4, bytes: wire.length },
      { name: 'parser-complete', ms: 5 },
      ...(scenario === 'U1-0' ? [{ name: 'exit-callback', ms: 5, exitCode: 7, signalCode: 0 }] : []),
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
}

test('control and skipped notification preserve actual wait, full output and settled resources', () => {
  for (const scenario of ['U1-0', 'U1-4']) assert.deepEqual(assessment(fixture(scenario)), {
    pass: true, scenarioMatches: true, resourcesSettled: true, evidenceSufficient: true,
    safeToContinue: true, termination: { kind: 'exited', exitCode: 7, rawStatus: 1792 }, failures: [] });
});

test('synthetic closing is explicitly distinguished from a real notification call', () => {
  for (const mutate of [input => { input.n.notificationCallInvoked = true; },
    input => { input.n.notificationFailureInjected = false; },
    input => { input.n.notificationStatus = 0; },
    input => { input.n.events.find(item => item.name === 'notification-call-skipped').value = 0; },
    input => { input.n.events.find(item => item.name === 'notification-call-skipped').error = 16; },
    input => { input.n.events.find(item => item.name === 'notification-call-skipped').aux = 1; },
    input => { input.n.events = input.n.events.filter(item => item.name !== 'notification-call-skipped'); }]) {
    const input = fixture(); mutate(input); ordinals(input.n.events);
    assert.equal(assessment(input).safeToContinue, false);
  }
  for (const name of ['notification-enter', 'notification-return', 'notification-call-skipped', 'notification-env-unavailable']) {
    const input = fixture(); input.n.events.push(event(name)); ordinals(input.n.events);
    assert.equal(assessment(input).safeToContinue, false, name);
  }
});

test('unsubmitted notification cannot acquire a fabricated native or JS callback', () => {
  for (const mutate of [input => { input.n.notificationCallbackStatus = 0; },
    input => { input.report.callback = { exitCode: 7, signalCode: 0 }; },
    input => { input.n.events.push(event('notification-callback')); ordinals(input.n.events); },
    input => { input.report.events.push({ name: 'exit-callback', ms: 11, exitCode: 7, signalCode: 0 }); }]) {
    const input = fixture(); mutate(input); const result = assessment(input);
    assert.equal(result.pass, false); assert.equal(result.safeToContinue, false);
  }
});

test('worker frees exactly one owned payload after skipped call and before actual Release', () => {
  for (const name of ['payload-allocated', 'payload-freed']) {
    const missing = fixture(); missing.n.events = missing.n.events.filter(item => item.name !== name);
    ordinals(missing.n.events); assert.equal(assessment(missing).safeToContinue, false, name);
    const duplicate = fixture(); duplicate.n.events.push(event(name)); ordinals(duplicate.n.events);
    assert.equal(assessment(duplicate).safeToContinue, false, name);
  }
  for (const target of ['notification-call-skipped', 'tsfn-release-return']) {
    const input = fixture(), events = input.n.events;
    const freed = events.splice(events.findIndex(item => item.name === 'payload-freed'), 1)[0];
    events.splice(events.findIndex(item => item.name === target), 0, freed); ordinals(events);
    assert.equal(assessment(input).safeToContinue, false, target);
  }
});

test('synthetic closing still requires real Release, finalizer, join and master close', () => {
  for (const mutate of [input => { input.n.tsfnReleaseStatus = null; },
    input => { input.n.tsfnReleaseStatus = 16; }, input => { input.n.tsfnFinalized = false; },
    input => { input.n.threadJoined = false; }, input => { input.n.threadJoinable = true; },
    input => { input.n.threadFinished = false; }, input => { input.n.payloadFreed = false; },
    input => { input.n.masterCloseReturned = false; },
    input => { input.n.events = input.n.events.filter(item => !item.name.startsWith('tsfn-release-')); },
    input => { input.n.events.push(event('tsfn-release-return')); }]) {
    const input = fixture(); mutate(input); ordinals(input.n.events);
    assert.equal(assessment(input).safeToContinue, false);
  }
});

test('confirmed real wait remains independent of unavailable notification', () => {
  const interrupted = fixture(); addWait(interrupted, -1, 4); assert.equal(assessment(interrupted).pass, true);
  for (const mutate of [input => { input.n.waitConfirmed = false; },
    input => { input.n.exitCode = null; input.n.signalCode = null; },
    input => { input.n.exitCode = 0; },
    input => { input.n.events.find(item => item.name === 'wait-return').value++; },
    input => { input.n.events.find(item => item.name === 'wait-return').aux = 0x137f; },
    input => { input.n.events.find(item => item.name === 'wait-return').aux = 0xffff; },
    input => { addWait(input, -1, 10); }, input => { addWait(input, input.n.pid, 0); }]) {
    const input = fixture(); mutate(input); assert.equal(assessment(input).safeToContinue, false);
  }
  const wrongExit = fixture(); wrongExit.n.events.find(item => item.name === 'wait-return').aux = 0;
  wrongExit.n.exitCode = 0;
  const result = assessment(wrongExit);
  assert.equal(result.scenarioMatches, false); assert.equal(result.resourcesSettled, true);
  assert.equal(result.safeToContinue, true); assert.equal(result.termination.exitCode, 0);
});

test('normal control still requires actual notification and one matching callback', () => {
  for (const mutate of [input => { input.n.notificationCallInvoked = false; },
    input => { input.n.notificationFailureInjected = true; }, input => { input.n.notificationStatus = 16; },
    input => { input.n.notificationCallbackStatus = null; }, input => { input.report.callback = null; },
    input => { input.report.events = input.report.events.filter(item => item.name !== 'exit-callback'); },
    input => { input.n.events.push(event('notification-call-skipped', 16)); ordinals(input.n.events); }]) {
    const input = fixture('U1-0'); mutate(input); assert.equal(assessment(input).safeToContinue, false);
  }
});

test('notification failure cannot excuse incomplete output, state or pending consumers', () => {
  for (const scenario of ['U1-0', 'U1-4']) {
    for (const mutate of [input => { input.report.state.cursorY = 3; },
      input => { input.report.source = 'explicit-cancel'; }, input => { input.config.expected.wireHash = 'different'; }]) {
      const input = fixture(scenario); mutate(input); const result = assessment(input);
      assert.equal(result.scenarioMatches, false); assert.equal(result.resourcesSettled, true);
      assert.equal(result.evidenceSufficient, true); assert.equal(result.safeToContinue, true);
    }
  }
  for (const mutate of [input => { input.report.readPending = 1; },
    input => { input.report.parserCompleted = 0; }]) {
    const input = fixture(); mutate(input); assert.equal(assessment(input).safeToContinue, false);
  }
});

test('previous wait injections, alternate waiters, polling and control remain excluded', () => {
  for (const mutate of [input => { input.n.firstAttempt = {}; }, input => { input.report.firstWaitObservation = {}; },
    input => { input.report.initialNative.firstAttempt = {}; }, input => { input.n.pollWaitCalls = 1; },
    input => { input.report.pollWaitCalls = 1; }, input => { input.n.controlCalls = 1; },
    input => { input.report.events.push({ name: 'initial-wait-result', ms: 11 }); },
    input => { input.observation.messages.push({ ms: 10, value: { type: 'initial-wait-result' } }); }]) {
    const input = fixture(); mutate(input); assert.equal(assessment(input).safeToContinue, false);
  }
  for (const name of ['thread-started', 'thread-construction-enter', 'wait-poll-enter', 'control-enter', 'first-wait-unconfirmed']) {
    const input = fixture(); input.n.events.push(event(name)); ordinals(input.n.events);
    assert.equal(assessment(input).safeToContinue, false, name);
  }
});

test('constructor return and worker start remain unordered', () => {
  for (const scenario of ['U1-0', 'U1-4']) {
    const input = fixture(scenario), events = input.n.events;
    const returned = events.splice(events.findIndex(item => item.name === 'thread-construction-return'), 1)[0];
    events.splice(events.findIndex(item => item.name === 'thread-started'), 0, returned); ordinals(events);
    assert.equal(assessment(input).pass, true);
  }
});

test('identity, explicit fixture mapping and separate evidence receipt remain mandatory', () => {
  for (const mutate of [input => { input.report.token = 'wrong'; }, input => { delete input.config.fixtureScenario; },
    input => { input.report.fixtureScenario = 'U1-4'; }, input => { input.config.scenario = 'U1-3'; },
    input => { delete input.report.native; }, input => { input.n.events = null; }]) {
    const input = fixture(); mutate(input); assert.equal(assessment(input).safeToContinue, false);
  }
  assert.equal(assessment(fixture(), evidence => { evidence.receipt.value.hash = 'bad'; }).safeToContinue, false);
});
