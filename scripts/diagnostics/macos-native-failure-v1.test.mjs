import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createU16Fixture, legacyReadyGate, refreshU16Snapshots } from './macos-native-failure-fixture-v1.mjs';
import { assessCase } from './macos-native-failure-verifier-v1.mjs';

function assessment(input) {
  return assessCase(input.config, input.observation, input.evidence);
}

function refreshEvidence(input) {
  const bytes = JSON.stringify(input.observation, null, 2) + '\n';
  input.evidence.receipt.value = {
    bytes: Buffer.byteLength(bytes),
    hash: createHash('sha256').update(bytes).digest('hex')
  };
}

test('U1-6 accepts synthetic registration failure with closed data gate and one reaper', () => {
  const input = createU16Fixture();
  assert.deepEqual(assessment(input), {
    pass: true,
    scenarioMatches: true,
    resourcesSettled: true,
    evidenceSufficient: true,
    safeToContinue: true,
    termination: { kind: 'exited', exitCode: 0, rawStatus: 0 },
    failures: []
  });
});

test('the legacy kqueueRegistered gate remains closed for U1-6', () => {
  const input = createU16Fixture();
  const ready = input.report.controlMessages[0], snapshot = input.report.writeGate.native;
  assert.equal(snapshot.kqueueRegistered, false);
  assert.equal(legacyReadyGate({ ready, kqueueRegistered: snapshot.kqueueRegistered }), false);
  assert.equal(input.report.permissionSent, false);
  assert.equal(input.report.readCalls, 0);
});

test('real registration, wait or output facts cannot be smuggled into the substitute scenario', () => {
  for (const mutate of [
    input => { input.native.registrationCallInvoked = true; },
    input => { input.native.registrationError = 1; },
    input => { input.native.events.find(item => item.name === 'kqueue-register-failure').name = 'kqueue-register-return'; },
    input => { input.native.events.find(item => item.name === 'kqueue-register-failure').name = 'kqueue-wait-return'; },
    input => { input.report.controlMessages.push({ type: 'go', token: input.config.token, pid: input.native.pid }); },
    input => { input.report.permissionSent = true; },
    input => { input.report.readCalls = 1; },
    input => { input.report.rawBase64 = 'AQ=='; }
  ]) {
    const input = createU16Fixture();
    mutate(input);
    refreshU16Snapshots(input);
    refreshEvidence(input);
    const result = assessment(input);
    assert.equal(result.scenarioMatches, false);
    assert.equal(result.resourcesSettled, true);
    assert.equal(result.evidenceSufficient, true);
    assert.equal(result.safeToContinue, true);
  }
});

test('abort must be token and pid bound and acknowledged before native settlement', () => {
  for (const mutate of [
    input => { input.report.controlMessages = input.report.controlMessages.filter(item => item.type !== 'abort-ack'); },
    input => { input.report.controlMessages.find(item => item.type === 'abort').token = 'wrong'; },
    input => { input.report.controlMessages.find(item => item.type === 'abort-ack').pid++; },
    input => { input.report.events.find(item => item.name === 'abort-ack').ms = 1; }
  ]) {
    const input = createU16Fixture();
    mutate(input);
    refreshEvidence(input);
    const result = assessment(input);
    assert.equal(result.scenarioMatches, true);
    assert.equal(result.resourcesSettled, false);
    assert.equal(result.evidenceSufficient, true);
    assert.equal(result.safeToContinue, false);
  }
});

test('only the owning wait thread can reap and close the kqueue once, in order', () => {
  for (const mutate of [
    input => { input.native.waitpidCalls = 2; },
    input => { input.native.events.push({ name: 'wait-enter', value: input.native.pid, thread: 'other', ord: 99, monoNs: '2000' }); },
    input => { input.native.events.find(item => item.name === 'kqueue-close-enter').ord = 10; },
    input => { input.native.kqueueCloseCalls = 2; },
    input => { input.native.kqueueCloseReturned = false; },
    input => { input.native.events.find(item => item.name === 'kqueue-close-return').error = 9; },
    input => { input.native.threadJoined = false; },
    input => { input.native.events.find(item => item.name === 'master-close-return').ord = 2; }
  ]) {
    const input = createU16Fixture();
    mutate(input);
    refreshEvidence(input);
    const result = assessment(input);
    assert.equal(result.pass, false);
    assert.equal(result.resourcesSettled, false);
    assert.equal(result.safeToContinue, false);
  }
});

test('expected scenario mismatch and evidence failure stay in separate domains', () => {
  const scenario = createU16Fixture();
  scenario.report.controlMessages.push({ type: 'written', token: scenario.config.token, pid: scenario.native.pid });
  refreshEvidence(scenario);
  const scenarioResult = assessment(scenario);
  assert.equal(scenarioResult.scenarioMatches, false);
  assert.equal(scenarioResult.resourcesSettled, true);
  assert.equal(scenarioResult.evidenceSufficient, true);
  assert.equal(scenarioResult.safeToContinue, true);

  const evidence = createU16Fixture();
  evidence.evidence.receipt.value.hash = 'tampered';
  const evidenceResult = assessment(evidence);
  assert.equal(evidenceResult.scenarioMatches, true);
  assert.equal(evidenceResult.resourcesSettled, true);
  assert.equal(evidenceResult.evidenceSufficient, false);
  assert.equal(evidenceResult.safeToContinue, false);
});

test('raw wait status, acquisition order and caller budgets cannot be replaced by summary flags', () => {
  for (const [name, mutate] of [
    ['wait-status', input => { input.native.events.find(item => item.name === 'wait-return').aux = 127; }],
    ['owner-record', input => { input.native.events.find(item => item.name === 'kqueue-owner-registered').value = -1; }],
    ['caller-budget', input => { input.observation.messages[0].ms = 36001; }],
    ['master-enter', input => { input.native.events.find(item => item.name === 'master-close-enter').value++; }],
    ['driver-exit', input => { input.caller.exit.code = 1; }],
    ['callback', input => { input.report.callback = null; }]
  ]) {
    const input = createU16Fixture(); mutate(input); refreshEvidence(input);
    assert.equal(assessment(input).safeToContinue, false, name);
  }
});

test('nonzero exit or a collected signal fails controlled abort without inventing a resource leak', () => {
  for (const [status, exitCode, signalCode] of [[1792, 7, 0], [31744, 124, 0], [32000, 125, 0], [15, 0, 15]]) {
    const input = createU16Fixture();
    Object.assign(input.native, { waitStatus: status, exitCode, signalCode });
    input.native.events.find(item => item.name === 'wait-return').aux = status;
    Object.assign(input.report.callback, { exitCode, signalCode });
    Object.assign(input.report.events.find(item => item.name === 'exit-callback'), { exitCode, signalCode });
    refreshU16Snapshots(input); refreshEvidence(input);
    const result = assessment(input);
    assert.equal(result.scenarioMatches, false);
    assert.equal(result.resourcesSettled, true);
    assert.equal(result.evidenceSufficient, true);
  }
});

test('unknown waits, temporary owners and missing release facts stop admission', () => {
  for (const mutate of [
    input => { input.native.waitStatus = 127; input.native.events.find(item => item.name === 'wait-return').aux = 127; },
    input => { input.native.waitStatus = 64; input.native.events.find(item => item.name === 'wait-return').aux = 64; },
    input => { input.native.waitConfirmed = false; },
    input => { input.native.waitPid++; },
    input => { input.native.events.find(item => item.name === 'wait-return').value++; },
    input => { input.native.registrationInFlight = true; },
    input => { input.native.resources[0].releaseResult = 22; },
    input => { input.native.resources = []; },
    input => { input.native.events.find(item => item.name === 'slave-release-return').value = -1; },
    ...['payloadFreed', 'tsfnFinalized', 'threadFinished', 'threadJoined', 'masterCloseReturned']
      .map(field => input => { input.native[field] = false; })
  ]) {
    const input = createU16Fixture(); mutate(input); refreshU16Snapshots(input); refreshEvidence(input);
    assert.equal(assessment(input).resourcesSettled, false);
    assert.equal(assessment(input).safeToContinue, false);
  }
});

test('native owner and release ordering is checked even when the ledger remains well formed', () => {
  for (const [first, second] of [['kqueue-owner-registered', 'kqueue-register-enter'], ['wait-enter', 'wait-return'],
    ['kqueue-close-enter', 'kqueue-close-return'], ['thread-joined', 'tsfn-finalizer-enter'],
    ['tsfn-release-enter', 'tsfn-release-return'], ['payload-freed', 'payload-allocated']]) {
    const input = createU16Fixture(), events = input.native.events;
    const a = events.findIndex(e => e.name === first), b = events.findIndex(e => e.name === second);
    [events[a], events[b]] = [events[b], events[a]];
    events.forEach((e, index) => { e.ord = index + 1; e.monoNs = String(1000000 + index); });
    refreshU16Snapshots(input); refreshEvidence(input);
    assert.equal(assessment(input).safeToContinue, false, `${first}/${second}`);
  }
});

test('gate, provenance and evidence budgets must remain independently auditable', () => {
  for (const mutate of [
    input => { input.report.writeGate = null; },
    input => { input.report.writeGate.native.events[0].value++; },
    input => { input.native.overflow = true; },
    input => { input.native.clockError = 5; },
    input => { input.evidence.receipt.ms = 1001; },
    input => { input.evidence.close.ms = 2001; },
    input => { input.caller.closed.ms = 32001; },
    input => { input.observation.callerClose.ms = 36001; }
  ]) {
    const input = createU16Fixture(); mutate(input); refreshEvidence(input);
    assert.equal(assessment(input).evidenceSufficient, false);
    assert.equal(assessment(input).safeToContinue, false);
  }
});
