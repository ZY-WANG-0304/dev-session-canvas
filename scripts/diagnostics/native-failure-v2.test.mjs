import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';
import { fixtureBytes } from './diagnose-native-failure-v1.mjs';
import { assessCase } from './native-failure-verifier-v2.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
function ordinal(events) {
  events.forEach((event, index) => { event.ord = index + 1; event.monoNs = `${index + 1}`; });
}
function setExit(input, status) {
  input.n.events.find(event => event.name === 'wait-return').aux = status;
  input.n.signalCode = status & 127;
  input.n.exitCode = input.n.signalCode === 0 ? (status >> 8) & 255 : 0;
  input.report.callback = { exitCode: input.n.exitCode, signalCode: input.n.signalCode };
}
function cancellation(status = 256) {
  const token = '1234567890abcdef1234567890abcdef';
  const config = { token, scenario: 'U1-1', binary: '/fixed/pty.node', binaryHash: 'fixed' };
  const n = { token, scenario: 'U1-1', configured: true, forkAttempted: true, masterAcquired: true,
    pid: 1234, master: 20, creationFailed: true, nonblockCalled: false, nonblockResult: -1, nonblockError: 5,
    masterCloseCalls: 1, masterCloseReturned: true, masterCloseError: 0, masterStatValid: true,
    masterFlagsBefore: 32770, masterFlagsAfter: 32770, waitConfirmed: true, waitError: 0,
    threadStarted: true, threadFinished: true, threadJoined: true, threadJoinError: 0,
    tsfnCreated: true, tsfnFinalized: true, tsfnCreateStatus: 0, tsfnReleaseStatus: 0,
    payloadAllocated: true, payloadFreed: true, notificationStatus: 0, notificationCallbackStatus: 0,
    clockError: 0, overflow: false, controlCalls: 1, controlReturned: true, controlError: 0 };
  n.events = [
    ['configured'], ['fork-enter'], ['fork-return', 1234, 0, 20], ['owner-registered', 1234, 0, 20],
    ['nonblock-skipped', -1, 5, 20], ['master-fgetfl-before', 32770, 0, 20], ['master-fstat', 0, 0, 20],
    ['master-fgetfl-after', 32770, 0, 20], ['master-close-enter', 20], ['master-close-return', 0, 0, 20],
    ['control-enter', 1234, 0, 15], ['control-return', 0, 0, 15], ['tsfn-create-enter'], ['tsfn-create-return'],
    ['thread-started', 1234], ['wait-enter', 1234], ['wait-return', 1234, 0, status], ['payload-allocated'],
    ['notification-enter'], ['notification-return'], ['notification-callback'], ['payload-freed'],
    ['tsfn-release-enter'], ['tsfn-release-return'], ['thread-finished', 1234], ['tsfn-finalizer-enter'],
    ['thread-joined'], ['tsfn-finalized'],
  ].map(([name, value = 0, error = 0, aux = 0]) => ({ name, value, error, aux }));
  ordinal(n.events);
  const report = { token, scenario: 'U1-1', native: n, loaded: { path: config.binary, hash: config.binaryHash, node: 'v22.23.2' },
    error: null, rawBase64: '', events: [], controlMessages: [], source: 'explicit-cancel/not-started',
    state: null, readPending: 0, readCalls: 0, parserAccepted: 0, parserCompleted: 0, permissionSent: false };
  const observation = { token, messages: [
    { ms: 15, value: { type: 'after-await', token, callerMs: 10, result: { kind: 'result', report } } },
    { ms: 20, value: { type: 'caller-final', token, closed: { code: 0, signal: null, ms: 15 },
      exit: { code: 0, signal: null }, stdout: '', stderr: '', events: [
        { name: 'driver-result', ms: 9 }, { name: 'after-await', ms: 10 }] } },
  ], callerExit: { code: 0, signal: null, ms: 21 }, callerClose: { code: 0, signal: null, ms: 22 } };
  const input = { config, observation, n, report };
  setExit(input, status);
  return input;
}
function assessment(input, editEvidence = () => {}) {
  const bytes = JSON.stringify(input.observation, null, 2) + '\n';
  const evidence = { error: null, close: { code: 0, signal: null, ms: 30 },
    receipt: { ms: 25, value: { bytes: Buffer.byteLength(bytes), hash: hash(bytes) } } };
  editEvidence(evidence);
  return assessCase(input.config, input.observation, evidence);
}
function normal() {
  const input = cancellation(1792), { config, n, report } = input;
  config.scenario = n.scenario = report.scenario = 'U1-0';
  Object.assign(n, { creationFailed: false, nonblockCalled: true, nonblockResult: 0, nonblockError: 0,
    masterFlagsBefore: 32770 | fs.constants.O_NONBLOCK, masterFlagsAfter: 32770 | fs.constants.O_NONBLOCK,
    controlCalls: 0, controlReturned: false });
  n.events = n.events.filter(event => !['nonblock-skipped', 'control-enter', 'control-return'].includes(event.name));
  const close = n.events.filter(event => event.name.startsWith('master-'));
  n.events = n.events.filter(event => !event.name.startsWith('master-'));
  n.events.splice(4, 0, { name: 'nonblock-enter', value: 20, error: 0, aux: 0 },
    { name: 'nonblock-return', value: 0, error: 0, aux: 0 });
  for (const event of close) if (event.name.startsWith('master-fgetfl')) event.value = n.masterFlagsBefore;
  n.events.push(...close); ordinal(n.events);
  const written = fixtureBytes(config.token), wire = Buffer.from(written.toString().replaceAll('\n', '\r\n'));
  const state = { cursorX: 6, cursorY: 4, fixtureState: 'same complete state object' };
  config.expected = { writtenBytes: written.length, writtenHash: hash(written), wireBytes: wire.length,
    wireHash: hash(wire), wireBase64: wire.toString('base64'), state };
  Object.assign(report, { source: 'linux-eio', rawBase64: wire.toString('base64'), permissionSent: true,
    state: structuredClone(state), readCalls: 2, parserAccepted: 1, parserCompleted: 1,
    controlMessages: [{ type: 'ready', token: config.token, pid: n.pid, stdinTTY: true, stdoutTTY: true },
      { type: 'written', token: config.token, pid: n.pid, bytes: written.length, hash: hash(written), calls: 1, intendedExitCode: 7 }],
    events: [{ name: 'write-permission', ms: 1 }, { name: 'read-enter', ms: 2 },
      { name: 'read-return', ms: 3, count: wire.length, error: null }, { name: 'parser-enter', ms: 4, bytes: wire.length },
      { name: 'parser-complete', ms: 5 }, { name: 'read-enter', ms: 6 }, { name: 'read-return', ms: 7, count: 0, error: 'EIO' },
      { name: 'source-end', ms: 8 }, { name: 'final-state', ms: 9 },
      { name: 'master-close-request', ms: 10, readPending: 0, parserPending: 0 }] });
  return input;
}

test('U1-1 accepts independent real exit or signal results without deriving them from kill', () => {
  for (const [status, termination] of [[256, { kind: 'exited', exitCode: 1, rawStatus: 256 }],
    [0, { kind: 'exited', exitCode: 0, rawStatus: 0 }],
    ...[1, 9, 15].map(signalCode => [signalCode, { kind: 'signaled', signalCode, coreDumped: false, rawStatus: signalCode }]),
    [139, { kind: 'signaled', signalCode: 11, coreDumped: true, rawStatus: 139 }]]) {
    assert.deepEqual(assessment(cancellation(status)), { pass: true, scenarioMatches: true, resourcesSettled: true,
      evidenceSufficient: true, safeToContinue: true, termination, failures: [] });
  }
});

test('stopped, continued and invalid raw statuses cannot prove a collected terminal child', () => {
  for (const status of [0x137f, 0xffff, -1, 65536, 1.5]) {
    const result = assessment(cancellation(status));
    assert.equal(result.pass, false); assert.equal(result.resourcesSettled, false);
    assert.equal(result.safeToContinue, false); assert.equal(result.termination, null);
  }
});

test('fixture self-limit and control errors fail their scenario without inventing unsettled owners', () => {
  for (const exitCode of [124, 125]) {
    const result = assessment(cancellation(exitCode << 8));
    assert.equal(result.pass, false); assert.equal(result.scenarioMatches, false);
    assert.equal(result.resourcesSettled, true); assert.equal(result.evidenceSufficient, true);
    assert.equal(result.safeToContinue, true);
    assert(result.failures.every(failure => failure.domain === 'scenario'));
  }
});

test('close, control, wait and payload failures stop admission even when injection matches', () => {
  for (const mutate of [input => { input.n.masterCloseReturned = false; input.n.masterCloseError = 9; },
    input => { input.n.controlError = 3; input.n.events.find(event => event.name === 'control-return').value = -1; },
    input => { input.n.events.find(event => event.name === 'wait-return').value++; },
    input => { input.n.waitConfirmed = false; }, input => { input.n.payloadFreed = false; },
    input => { input.n.threadJoined = false; }, input => { input.n.notificationStatus = 1; }]) {
    const input = cancellation(); mutate(input); const result = assessment(input);
    assert.equal(result.pass, false); assert.equal(result.resourcesSettled, false);
    assert.equal(result.safeToContinue, false);
  }
});

test('identity, callback and evidence defects stop admission without erasing observed owner returns', () => {
  for (const mutate of [input => { input.report.token = 'wrong'; }, input => { input.observation.token = 'wrong'; },
    input => { input.report.loaded.hash = 'wrong'; }, input => { input.report.callback.exitCode = 0; },
    input => { input.n.events = input.n.events.filter(event => event.name !== 'owner-registered'); ordinal(input.n.events); }]) {
    const input = cancellation(); mutate(input); const result = assessment(input);
    assert.equal(result.pass, false); assert.equal(result.evidenceSufficient, false);
    assert.equal(result.safeToContinue, false);
  }
  const result = assessment(cancellation(), evidence => { evidence.receipt.value.hash = 'wrong'; });
  assert.equal(result.resourcesSettled, true); assert.equal(result.evidenceSufficient, false);
  assert.equal(result.safeToContinue, false);
});

test('U1-1 cannot claim EOF or permit output, and none of these scenario failures proves a leak', () => {
  for (const mutate of [input => { input.report.source = 'linux-eio'; },
    input => { input.report.permissionSent = true; },
    input => { input.report.events.push({ name: 'write-permission' }); },
    input => { input.report.controlMessages.push({ type: 'written' }); }]) {
    const input = cancellation(); mutate(input); const result = assessment(input);
    assert.equal(result.scenarioMatches, false); assert.equal(result.resourcesSettled, true);
    assert.equal(result.evidenceSufficient, true); assert.equal(result.safeToContinue, true);
  }
});

test('normal content or final-state mismatch remains separate from complete owner settlement', () => {
  assert.equal(assessment(normal()).pass, true);
  for (const mutate of [input => { input.config.expected.wireHash = 'different'; },
    input => { input.report.state.cursorY = 3; }, input => { setExit(input, 8 << 8); }]) {
    const input = normal(); mutate(input); const result = assessment(input);
    assert.equal(result.scenarioMatches, false); assert.equal(result.resourcesSettled, true);
    assert.equal(result.evidenceSufficient, true); assert.equal(result.safeToContinue, true);
  }
});

test('callback can run before the worker records notification return', () => {
  const input = cancellation(), events = input.n.events;
  const returned = events.splice(events.findIndex(event => event.name === 'notification-return'), 1)[0];
  events.splice(events.findIndex(event => event.name === 'payload-freed') + 1, 0, returned);
  ordinal(events);
  assert.equal(assessment(input).pass, true);
});

test('missing native facts or an interrupted assessment cannot claim scenario matching', () => {
  for (const mutate of [input => { delete input.report.native; }, input => { input.n.events = null; }]) {
    const input = cancellation(); mutate(input); const result = assessment(input);
    assert.equal(result.scenarioMatches, false); assert.equal(result.resourcesSettled, false);
    assert.equal(result.evidenceSufficient, false); assert.equal(result.pass, false);
    assert.equal(result.safeToContinue, false);
  }
});
