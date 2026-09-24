import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createU16Fixture, legacyReadyGate } from './macos-native-failure-fixture-v1.mjs';
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
    termination: { kind: 'exited', exitCode: 7, rawStatus: 1792 },
    failures: []
  });
});

test('the legacy kqueueRegistered gate remains closed for U1-6', () => {
  const input = createU16Fixture();
  const ready = input.report.controlMessages[0];
  assert.equal(ready.kqueueRegistered, false);
  assert.equal(legacyReadyGate({ ready, kqueueRegistered: ready.kqueueRegistered }), false);
  assert.equal(input.report.permissionSent, false);
  assert.equal(input.report.readCalls, 0);
});

test('real registration, wait or output facts cannot be smuggled into the substitute scenario', () => {
  for (const mutate of [
    input => { input.native.registrationCallInvoked = true; },
    input => { input.native.registrationError = 'EPERM'; },
    input => { input.native.events.find(item => item.name === 'kqueue-register-failure').name = 'kqueue-register-return'; },
    input => { input.native.events.find(item => item.name === 'kqueue-register-failure').name = 'kqueue-wait-return'; },
    input => { input.report.controlMessages.push({ type: 'go', token: input.config.token, pid: input.native.pid }); },
    input => { input.report.permissionSent = true; },
    input => { input.report.readCalls = 1; },
    input => { input.report.rawBase64 = 'AQ=='; }
  ]) {
    const input = createU16Fixture();
    mutate(input);
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
