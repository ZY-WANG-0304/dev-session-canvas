import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';
import { fixtureBytes } from './diagnose-native-failure-v1.mjs';
import { assessCase } from './native-failure-verifier-v3.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const event = (name, value = 0, error = 0, aux = 0) => ({ name, value, error, aux });
function ordinals(events) {
  let ns = 1000000n;
  events.forEach((item, index) => {
    if (item.name === 'wait-poll-enter' && events[index - 1]?.name === 'wait-poll-return') ns += 500000000n;
    item.ord = index + 1; item.monoNs = String(ns++);
  });
}
function setExit(input, status) {
  input.n.events.filter(item => ['wait-return', 'wait-poll-return'].includes(item.name)).at(-1).aux = status;
  input.n.signalCode = status & 127;
  input.n.exitCode = input.n.signalCode === 0 ? (status >> 8) & 255 : 0;
  if (input.config.scenario === 'U1-0')
    input.report.callback = { exitCode: input.n.exitCode, signalCode: input.n.signalCode };
}
function partial(status = 256) {
  const token = '1234567890abcdef1234567890abcdef';
  const config = { token, scenario: 'U1-2', binary: '/fixed/pty.node', binaryHash: 'fixed' };
  const n = { token, scenario: 'U1-2', configured: true, forkAttempted: true, masterAcquired: true,
    pid: 1234, master: 20, creationFailed: true, nonblockCalled: true, nonblockResult: 0, nonblockError: 0,
    masterCloseCalls: 1, masterCloseReturned: true, masterCloseError: 0, masterStatValid: true,
    masterFlagsBefore: 32770 | fs.constants.O_NONBLOCK, masterFlagsAfter: 32770 | fs.constants.O_NONBLOCK,
    waitConfirmed: true, waitError: 0, threadStarted: false, threadFinished: false, threadJoined: false,
    threadJoinError: 0, threadJoinable: false, threadConstructCalled: false, threadConstructReturned: false,
    threadFailureInjected: true, threadStartFailed: true, threadStartError: 11,
    pollWaitCalls: 1, pollWaitStopped: true, pollWaitInFlight: false, pollWaitDisposition: 'terminal',
    tsfnCreated: true, tsfnFinalized: true, tsfnCreateStatus: 0, tsfnReleaseStatus: 0,
    payloadAllocated: false, payloadFreed: false, notificationStatus: null, notificationCallbackStatus: null,
    clockError: 0, overflow: false, controlCalls: 1, controlReturned: true, controlError: 0 };
  n.events = [event('configured'), event('fork-enter'), event('fork-return', 1234, 0, 20),
    event('owner-registered', 1234, 0, 20), event('nonblock-enter', 20), event('nonblock-return', 0, 0, 20),
    event('tsfn-create-enter'), event('tsfn-create-return'), event('thread-construction-skipped', -1, 11),
    event('thread-start-error', -1, 11), event('master-fgetfl-before', n.masterFlagsBefore, 0, 20),
    event('master-fstat', 0, 0, 20), event('master-fgetfl-after', n.masterFlagsAfter, 0, 20),
    event('master-close-enter', 20), event('master-close-return', 0, 0, 20),
    event('control-enter', 1234, 0, 15), event('control-return', 0, 0, 15),
    event('tsfn-release-enter'), event('tsfn-release-return'),
    event('tsfn-finalizer-enter'), event('thread-not-joinable'), event('tsfn-finalized'),
    event('wait-poll-enter', 1234, 0, 1), event('wait-poll-return', 1234, 0, status)];
  ordinals(n.events);
  const report = { token, scenario: 'U1-2', native: n,
    loaded: { path: config.binary, hash: config.binaryHash, node: 'v22.23.2' },
    error: null, creationError: { name: 'Error', message: 'Could not start diagnostic waiter', code: 'DSC_THREAD_START_FAILED' },
    pollWaitCalls: 1, callback: null, rawBase64: '', controlMessages: [], source: 'explicit-cancel/not-started',
    state: null, readPending: 0, readCalls: 0, parserAccepted: 0, parserCompleted: 0, permissionSent: false,
    events: [{ name: 'source-cancel', ms: 1 }, { name: 'poll-wait-call', ms: 2 },
      { name: 'poll-wait-return', ms: 3, disposition: 'terminal' }] };
  const observation = { token, messages: [
    { ms: 2015, value: { type: 'after-await', token, callerMs: 2010, result: { kind: 'result', report } } },
    { ms: 2020, value: { type: 'caller-final', token, closed: { code: 0, signal: null, ms: 2015 },
      exit: { code: 0, signal: null }, stdout: '', stderr: '', events: [
        { name: 'driver-result', ms: 2009 }, { name: 'after-await', ms: 2010 }] } },
  ], callerExit: { code: 0, signal: null, ms: 2021 }, callerClose: { code: 0, signal: null, ms: 2022 } };
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
function addPending(input, value, error) {
  const index = input.n.events.findIndex(item => item.name === 'wait-poll-enter');
  input.n.events.splice(index, 0, event('wait-poll-enter', input.n.pid, 0, 1), event('wait-poll-return', value, error));
  ordinals(input.n.events);
  input.n.pollWaitCalls++; input.report.pollWaitCalls++;
  input.report.events = [{ name: 'source-cancel', ms: 1 }, { name: 'poll-wait-call', ms: 2 },
    { name: 'poll-wait-return', ms: 3, disposition: 'pending' }, { name: 'poll-wait-call', ms: 504 },
    { name: 'poll-wait-return', ms: 505, disposition: 'terminal' }];
}
function normal() {
  const input = partial(1792), { config, n, report } = input;
  config.scenario = n.scenario = report.scenario = 'U1-0';
  Object.assign(n, { creationFailed: false, threadStarted: true, threadFinished: true, threadJoined: true,
    threadConstructCalled: true, threadConstructReturned: true, threadFailureInjected: false,
    threadStartFailed: false, threadStartError: 0, pollWaitCalls: 0, pollWaitStopped: false,
    pollWaitDisposition: 'not-started', payloadAllocated: true, payloadFreed: true,
    notificationStatus: 0, notificationCallbackStatus: 0, controlCalls: 0, controlReturned: false });
  const close = n.events.filter(item => item.name.startsWith('master-'));
  n.events = n.events.slice(0, 8).concat([event('thread-construction-enter', 1234),
    event('thread-started', 1234), event('thread-construction-return', 0, 0, 1234),
    event('wait-enter', 1234), event('wait-return', 1234, 0, 1792), event('payload-allocated'),
    event('notification-enter'), event('notification-callback'), event('payload-freed'),
    event('notification-return'), event('tsfn-release-enter'), event('tsfn-release-return'),
    event('thread-finished', 1234), event('tsfn-finalizer-enter'), event('thread-joined'), event('tsfn-finalized')], close);
  ordinals(n.events);
  const written = fixtureBytes(config.token), wire = Buffer.from(written.toString().replaceAll('\n', '\r\n'));
  const state = { cursorX: 6, cursorY: 4, fixtureState: 'full object equality fixture' };
  config.expected = { writtenBytes: written.length, writtenHash: hash(written), wireBytes: wire.length,
    wireHash: hash(wire), wireBase64: wire.toString('base64'), state };
  Object.assign(report, { creationError: null, pollWaitCalls: 0, source: 'linux-eio',
    callback: { exitCode: 7, signalCode: 0 }, rawBase64: wire.toString('base64'), permissionSent: true,
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

test('uncreated thread and payload require absence, not fabricated release', () => {
  const result = assessment(partial());
  assert.deepEqual(result, { pass: true, scenarioMatches: true, resourcesSettled: true,
    evidenceSufficient: true, safeToContinue: true, termination: { kind: 'exited', exitCode: 1, rawStatus: 256 }, failures: [] });
  for (const name of ['thread-started', 'thread-joined', 'payload-freed', 'notification-callback', 'wait-enter']) {
    const input = partial(); input.n.events.push(event(name)); ordinals(input.n.events);
    const failed = assessment(input);
    assert.equal(failed.resourcesSettled, false); assert.equal(failed.safeToContinue, false);
  }
});

test('poll pending and EINTR retain no status, followed by one owned terminal wait', () => {
  for (const [value, error] of [[0, 0], [-1, 4]]) {
    const input = partial(); addPending(input, value, error);
    assert.equal(assessment(input).pass, true);
    input.n.events.find(item => item.name === 'wait-poll-return').aux = 1792;
    assert.equal(assessment(input).safeToContinue, false);
  }
});

test('wait errors, wrong pid, repeated terminal, stopped and continued do not prove reap', () => {
  for (const mutate of [
    input => { input.n.events.filter(item => item.name === 'wait-poll-return').at(-1).value++; },
    input => { input.n.events.filter(item => item.name === 'wait-poll-return').at(-1).value = 0; },
    input => { addPending(input, -1, 10); }, input => { addPending(input, input.n.pid, 0); },
    input => { setExit(input, 0x137f); }, input => { setExit(input, 0xffff); },
    input => { input.n.waitConfirmed = false; }, input => { input.n.pollWaitDisposition = 'unknown'; },
  ]) {
    const input = partial(); mutate(input); const result = assessment(input);
    assert.equal(result.resourcesSettled, false); assert.equal(result.safeToContinue, false);
  }
});

test('real close, control, TSFN release and finalizer remain mandatory', () => {
  for (const mutate of [input => { input.n.masterCloseReturned = false; },
    input => { input.n.controlReturned = false; input.n.controlError = 3; },
    input => { input.n.tsfnReleaseStatus = 1; }, input => { input.n.tsfnFinalized = false; },
    input => { input.n.threadJoinable = true; }, input => { input.report.callback = { exitCode: 1, signalCode: 0 }; }]) {
    const input = partial(); mutate(input); const result = assessment(input);
    assert.equal(result.resourcesSettled, false); assert.equal(result.safeToContinue, false);
  }
});

test('TSFN finalizer and child terminal wait have no required relative order', () => {
  const input = partial(), events = input.n.events;
  const finalizer = events.splice(events.findIndex(item => item.name === 'tsfn-finalizer-enter'), 3);
  events.push(...finalizer); ordinals(events);
  assert.equal(assessment(input).pass, true);
});

test('signal or exit termination is independent; safety exits and output fail scenario only', () => {
  for (const status of [0, 256, 1, 9, 15, 139]) assert.equal(assessment(partial(status)).pass, true);
  for (const input of [partial(124 << 8), partial(125 << 8),
    Object.assign(partial(), {})]) {
    if (input.n.exitCode === 1) input.report.permissionSent = true;
    const result = assessment(input);
    assert.equal(result.scenarioMatches, false); assert.equal(result.resourcesSettled, true);
    assert.equal(result.evidenceSufficient, true); assert.equal(result.safeToContinue, true);
  }
});

test('identity, status agreement, poll delay and evidence defects stop admission', () => {
  for (const mutate of [input => { input.report.token = 'wrong'; }, input => { input.n.exitCode = 2; },
    input => { addPending(input, 0, 0); const polls = input.n.events.filter(item => item.name.startsWith('wait-poll-'));
      polls[2].monoNs = String(BigInt(polls[1].monoNs) + 1n); },
    input => { input.report.pollWaitCalls++; }]) {
    const input = partial(); mutate(input); const result = assessment(input);
    assert.equal(result.pass, false); assert.equal(result.safeToContinue, false);
  }
  assert.equal(assessment(partial(), evidence => { evidence.receipt.value.hash = 'bad'; }).safeToContinue, false);
});

test('normal control retains full data, callback and resources without constructor pseudo-order', () => {
  assert.equal(assessment(normal()).pass, true);
  const input = normal(); input.report.state.cursorY = 3;
  const result = assessment(input);
  assert.equal(result.scenarioMatches, false); assert.equal(result.resourcesSettled, true);
  assert.equal(result.evidenceSufficient, true); assert.equal(result.safeToContinue, true);
});

test('missing native or malformed facts never claim scenario or resources established', () => {
  for (const mutate of [input => { delete input.report.native; }, input => { input.n.events = null; }]) {
    const input = partial(); mutate(input); const result = assessment(input);
    assert.equal(result.scenarioMatches, false); assert.equal(result.resourcesSettled, false);
    assert.equal(result.evidenceSufficient, false); assert.equal(result.safeToContinue, false);
  }
});
