import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { fixtureBytes } from './diagnose-native-failure-v1.mjs';
import { assessCase } from './macos-native-baseline-verifier-v1.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const event = (name, value = 0, error = 0, aux = 0) => ({ name, value, error, aux });
function snapshots(input) {
  const { n, report } = input;
  n.events.forEach((item, index) => { item.ord = index + 1; item.monoNs = String(1000000 + index); });
  report.beforeCloseNative = { ...structuredClone(n), events: structuredClone(n.events.slice(0, -5)),
    masterCloseCalls: 0, masterCloseReturned: false, masterCloseError: 0, masterFlagsBefore: -1,
    masterFlagsAfter: -1, masterStatValid: false, masterStatDev: '0', masterStatIno: '0', masterStatRdev: '0' };
  const registered = n.events.findLastIndex(item => item.name === 'kqueue-register-return');
  report.writeGate = { ready: report.controlMessages[0], native: { ...structuredClone(report.beforeCloseNative),
    events: structuredClone(n.events.slice(0, registered + 1)), kqueueWaitReturned: false,
    kqueueExitEventValid: false, kqueueExitEvent: { ident: 0, filter: 0, flags: 0, fflags: 0 },
    kqueueCloseCalls: 0, kqueueCloseReturned: false, waitConfirmed: false, threadFinished: false,
    threadJoined: false, threadJoinable: true, tsfnFinalized: false, payloadAllocated: false, payloadFreed: false } };
  report.events.find(item => item.name === 'write-gate-ready').gate = report.writeGate;
}
function fixture() {
  const token = '1234567890abcdef1234567890abcdef';
  const config = { token, scenario: 'U1-0', fixtureScenario: 'U1-0', platform: 'darwin',
    binary: '/fixed/pty.node', binaryHash: 'fixed-binary', helper: '/fixed/spawn-helper', helperHash: 'fixed-helper',
    executablePath: '/fixed/node', constants: { O_NONBLOCK: 4 } };
  const resources = [['low-fd-0', 10], ['spawn-actions', 0], ['spawn-attrs', 0], ['slave', 21]].map(([id, value]) =>
    ({ id, value, acquired: true, releaseCalls: 1, releaseReturned: true, releaseResult: 0, releaseError: 0 }));
  const n = { token, scenario: 'U1-0', platform: 'darwin', configured: true, spawnAttempted: true, masterAcquired: true,
    helperPath: config.helper, executablePath: config.executablePath, nonblockMask: 4,
    procFilter: -5, noteExitMask: 0x80000000, eventErrorMask: 0x4000,
    pid: 1234, master: 20, creationFailed: false, nonblockCalled: true, nonblockResult: 0, nonblockError: 0,
    masterCloseCalls: 1, masterCloseReturned: true, masterCloseError: 0, masterStatValid: true,
    masterFlagsBefore: 6, masterFlagsAfter: 6, masterStatDev: '1', masterStatIno: '2', masterStatRdev: '3',
    waitConfirmed: true, waitError: 0, exitCode: 7, signalCode: 0,
    threadStarted: true, threadFinished: true, threadJoined: true, threadJoinError: 0, threadJoinable: false,
    threadConstructCalled: true, threadConstructReturned: true, threadFailureInjected: false,
    threadStartFailed: false, threadStartError: 0, tsfnCreated: true, tsfnFinalized: true,
    tsfnCreateStatus: 0, tsfnReleaseStatus: 0, payloadAllocated: true, payloadFreed: true,
    notificationCallInvoked: true, notificationFailureInjected: false, notificationStatus: 0, notificationCallbackStatus: 0,
    kqueueFd: 22, kqueueAcquired: true, kqueueRegistered: true, kqueueWaitReturned: true, kqueueExitEventValid: true,
    kqueueCloseCalls: 1, kqueueCloseReturned: true, kqueueCloseError: 0,
    kqueueExitEvent: { ident: 1234, filter: -5, flags: 0x8000, fflags: 0x80000000 },
    resources, clockError: 0, overflow: false };
  n.events = [event('configured'),
    ...resources.flatMap(owner => [event(`${owner.id}-acquire-enter`), event(`${owner.id}-acquire-return`, owner.value)]),
    event('master-open-enter'), event('master-open-return', n.master), event('spawn-enter'), event('spawn-return', 0, 0, n.pid),
    event('owner-registered', n.pid, 0, n.master),
    ...resources.flatMap(owner => [event(`${owner.id}-release-enter`, owner.value), event(`${owner.id}-release-return`, 0, 0, owner.value)]),
    event('nonblock-enter', n.master), event('nonblock-return', 0, 0, n.master),
    event('tsfn-create-enter'), event('tsfn-create-return'), event('thread-construction-enter', n.pid),
    event('thread-started', n.pid), event('thread-construction-return', 0, 0, n.pid),
    event('kqueue-enter'), event('kqueue-return', n.kqueueFd), event('kqueue-register-enter', n.kqueueFd, 0, n.pid),
    event('kqueue-register-return', 0, 0, n.kqueueFd), event('kqueue-wait-enter', n.kqueueFd),
    event('kqueue-wait-return', 1, 0, n.kqueueFd), event('kqueue-exit-event', n.pid, 0x8000, 0x80000000),
    event('wait-enter', n.pid), event('wait-return', n.pid, 0, 1792),
    event('kqueue-close-enter', n.kqueueFd), event('kqueue-close-return', 0, 0, n.kqueueFd),
    event('payload-allocated'), event('notification-enter'), event('notification-callback'), event('payload-freed'),
    event('notification-return'), event('tsfn-release-enter'), event('tsfn-release-return'),
    event('thread-finished', n.pid), event('tsfn-finalizer-enter'), event('thread-joined'), event('tsfn-finalized'),
    event('master-fgetfl-before', n.masterFlagsBefore, 0, n.master), event('master-fstat', 0, 0, n.master),
    event('master-fgetfl-after', n.masterFlagsAfter, 0, n.master), event('master-close-enter', n.master),
    event('master-close-return', 0, 0, n.master)];
  const written = fixtureBytes(token), wire = Buffer.from(written.toString().replaceAll('\n', '\r\n'));
  const state = { cursorX: 6, cursorY: 4, fixtureState: 'full object equality fixture' };
  config.expected = { writtenBytes: written.length, writtenHash: hash(written), wireBytes: wire.length,
    wireHash: hash(wire), wireBase64: wire.toString('base64'), state };
  const report = { token, scenario: 'U1-0', fixtureScenario: 'U1-0', native: n,
    loaded: { path: config.binary, hash: config.binaryHash, node: 'v22.23.2', platform: 'darwin',
      helper: config.helper, helperHash: config.helperHash, executablePath: config.executablePath },
    error: null, creationError: null, callback: { exitCode: 7, signalCode: 0 },
    rawBase64: wire.toString('base64'), source: 'darwin-read-zero', state: structuredClone(state),
    readPending: 0, readCalls: 2, parserAccepted: 1, parserCompleted: 1, permissionSent: true,
    controlMessages: [{ type: 'ready', token, pid: n.pid, stdinTTY: true, stdoutTTY: true },
      { type: 'written', token, pid: n.pid, bytes: written.length, hash: hash(written), calls: 1, intendedExitCode: 7 }],
    events: [{ name: 'write-gate-ready', ms: 0 }, { name: 'write-permission', ms: 1 }, { name: 'read-enter', ms: 2 },
      { name: 'read-return', ms: 3, count: wire.length, error: null }, { name: 'parser-enter', ms: 4, bytes: wire.length },
      { name: 'parser-complete', ms: 5 }, { name: 'exit-callback', ms: 5, exitCode: 7, signalCode: 0 },
      { name: 'read-enter', ms: 6 }, { name: 'read-return', ms: 7, count: 0, error: null },
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
  snapshots(input);
  return input;
}
function assessment(input, editEvidence = () => {}) {
  const bytes = JSON.stringify(input.observation, null, 2) + '\n';
  const evidence = { error: null, close: { code: 0, signal: null, ms: 30 },
    receipt: { ms: 25, value: { bytes: Buffer.byteLength(bytes), hash: hash(bytes) } } };
  editEvidence(evidence);
  return assessCase(input.config, input.observation, evidence);
}

test('Darwin normal path accepts actual EOF, EV_EOF, callback races and EINTR-only retries', () => {
  assert.deepEqual(assessment(fixture()), { pass: true, scenarioMatches: true, resourcesSettled: true,
    evidenceSufficient: true, safeToContinue: true, termination: { kind: 'exited', exitCode: 7, rawStatus: 1792 }, failures: [] });
  const raced = fixture(), events = raced.n.events;
  const constructor = events.splice(events.findIndex(item => item.name === 'thread-construction-return'), 1)[0];
  events.splice(events.findIndex(item => item.name === 'thread-started'), 0, constructor);
  const callback = events.splice(events.findIndex(item => item.name === 'notification-callback'), 2);
  events.splice(events.findIndex(item => item.name === 'thread-finished') + 1, 0, ...callback);
  snapshots(raced);
  assert.equal(assessment(raced).pass, true);
  for (const name of ['spawn', 'kqueue', 'kqueue-register', 'kqueue-wait', 'wait']) {
    const input = fixture(), index = input.n.events.findIndex(item => item.name === `${name}-enter`);
    const entered = { ...input.n.events[index] };
    const interrupted = event(`${name}-return`, name === 'spawn' ? 4 : -1, 4,
      name === 'spawn' ? -1 : name.startsWith('kqueue-') ? input.n.kqueueFd : 0);
    input.n.events.splice(index, 0, entered, interrupted);
    snapshots(input);
    assert.equal(assessment(input).pass, true, name);
  }
});

test('Darwin helper, executable and direct spawn return identify the actual child', () => {
  for (const mutate of [input => { input.n.helperPath = '/different/helper'; },
    input => { input.report.loaded.helperHash = 'different'; }, input => { input.n.executablePath = '/different/node'; },
    input => { input.n.platform = 'linux'; }, input => { input.n.spawnAttempted = false; },
    input => { input.n.events.find(item => item.name === 'spawn-return').aux++; },
    input => { input.n.events.find(item => item.name === 'spawn-return').value = input.n.pid; }]) {
    const input = fixture(); mutate(input); assert.equal(assessment(input).safeToContinue, false);
  }
});

test('write permission requires fixture identity and a recorded successful kqueue registration', () => {
  for (const mutate of [input => { input.report.writeGate.native.kqueueRegistered = false; },
    input => { input.report.writeGate.native.pid++; },
    input => { input.report.writeGate.native.events.pop(); },
    input => { input.report.events.find(item => item.name === 'write-gate-ready').ms = 2; },
    input => { delete input.report.writeGate; },
    input => { input.report.controlMessages[0] = { ...input.report.controlMessages[0], token: 'wrong' }; }]) {
    const input = fixture(); mutate(input); assert.equal(assessment(input).safeToContinue, false);
  }
});

test('the real kevent must name the owned process, EVFILT_PROC and NOTE_EXIT without EV_ERROR', () => {
  for (const mutate of [input => { input.n.kqueueExitEvent.ident++; },
    input => { input.n.kqueueExitEvent.filter = -1; }, input => { input.n.kqueueExitEvent.fflags = 0; },
    input => { input.n.kqueueExitEvent.flags |= 0x4000; },
    input => { input.n.events.find(item => item.name === 'kqueue-exit-event').value++; },
    input => { input.n.kqueueExitEventValid = false; }]) {
    const input = fixture(); mutate(input); snapshots(input);
    assert.equal(assessment(input).scenarioMatches, false);
  }
});

test('temporary spawn owners, kqueue and master must each be released exactly once', () => {
  for (const mutate of [input => { input.n.resources[0].releaseCalls = 2; },
    input => { input.n.resources[1].releaseReturned = false; },
    input => { input.n.resources[2].releaseError = 22; }, input => { input.n.kqueueCloseCalls = 2; },
    input => { input.n.kqueueCloseReturned = false; }, input => { input.n.masterCloseReturned = false; },
    input => { input.n.events.find(item => item.name === 'slave-release-return').value = -1; }]) {
    const input = fixture(); mutate(input); assert.equal(assessment(input).resourcesSettled, false);
  }
  const missing = fixture(); missing.n.resources.pop(); assert.equal(assessment(missing).safeToContinue, false);
  const duplicate = fixture(); duplicate.n.resources.push({ ...duplicate.n.resources[0] });
  assert.equal(assessment(duplicate).safeToContinue, false);
  for (const name of ['master-open-enter', 'master-open-return']) {
    const input = fixture(); input.n.events = input.n.events.filter(item => item.name !== name);
    snapshots(input); assert.equal(assessment(input).safeToContinue, false, name);
  }
  const wrongMaster = fixture(); wrongMaster.n.events.find(item => item.name === 'master-open-return').value++;
  snapshots(wrongMaster); assert.equal(assessment(wrongMaster).safeToContinue, false);
});

test('output or EOF mismatches fail the scenario without fabricating a resource failure', () => {
  for (const mutate of [input => { input.report.state.cursorY = 3; },
    input => { input.report.source = 'explicit-cancel'; }, input => { input.config.expected.wireHash = 'different'; },
    input => { input.report.events.findLast(item => item.name === 'read-return').error = 'EIO'; },
    input => { input.report.controlMessages[1].hash = 'different'; }]) {
    const input = fixture(); mutate(input); const result = assessment(input);
    assert.equal(result.scenarioMatches, false); assert.equal(result.resourcesSettled, true);
    assert.equal(result.evidenceSufficient, true); assert.equal(result.safeToContinue, true);
  }
});

test('master close follows settled native owners and all read and parser consumers', () => {
  for (const mutate of [input => { input.report.beforeCloseNative.threadJoined = false; },
    input => { input.report.beforeCloseNative.payloadFreed = false; },
    input => { input.report.beforeCloseNative.masterCloseCalls = 1; },
    input => { input.report.beforeCloseNative.events.pop(); }, input => { input.report.readPending = 1; },
    input => { input.report.parserCompleted = 0; }, input => { input.n.threadJoinable = true; },
    input => { input.n.tsfnFinalized = false; },
    input => { input.report.events.find(item => item.name === 'master-close-request').parserPending = 1; }]) {
    const input = fixture(); mutate(input); assert.equal(assessment(input).safeToContinue, false);
  }
});

test('identity, terminal wait, separate evidence and sticky diagnostic failures remain mandatory', () => {
  for (const mutate of [input => { input.report.token = 'wrong'; }, input => { delete input.config.fixtureScenario; },
    input => { delete input.report.native; }, input => { input.n.events = null; },
    input => { input.n.events.find(item => item.name === 'wait-return').aux = 0x137f; },
    input => { input.n.events.find(item => item.name === 'wait-return').aux = 0xffff; },
    input => { input.report.events.push({ name: 'control-protocol-error', ms: 11 }); },
    input => { input.caller.events.push({ name: 'driver-send-error', ms: 11 }); },
    input => { input.observation.events = [{ name: 'caller-error', ms: 11 }]; }]) {
    const input = fixture(); mutate(input); assert.equal(assessment(input).safeToContinue, false);
  }
  assert.equal(assessment(fixture(), evidence => { evidence.receipt.value.hash = 'wrong'; }).safeToContinue, false);
});
