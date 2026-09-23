import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fixtureBytes, terminalState } from './diagnose-native-failure-v1.mjs';
import { assessCase } from './native-failure-verifier-v1.mjs';
import { patchUnixSource } from './unix-native-failure-patch-v1.mjs';

const dependencyRoot = process.env.DSC_DEPENDENCY_ROOT;
const hash = value => createHash('sha256').update(value).digest('hex');

function controlledCancellation() {
  const token = '1234567890abcdef1234567890abcdef';
  const config = { token, scenario: 'U1-1', binary: '/fixed/pty.node', binaryHash: 'fixed' };
  const n = { token, scenario: 'U1-1', configured: true, forkAttempted: true, masterAcquired: true,
    pid: 1234, master: 20, creationFailed: true, nonblockCalled: false, nonblockResult: -1, nonblockError: 5,
    masterCloseCalls: 1, masterCloseReturned: true, masterCloseError: 0, masterStatValid: true,
    masterFlagsBefore: 2, masterFlagsAfter: 2, waitConfirmed: true, waitError: 0, exitCode: 0, signalCode: 15,
    threadStarted: true, threadFinished: true, threadJoined: true, threadJoinError: 0,
    tsfnCreated: true, tsfnFinalized: true, tsfnCreateStatus: 0, tsfnReleaseStatus: 0,
    payloadAllocated: true, payloadFreed: true, notificationStatus: 0, notificationCallbackStatus: 0,
    clockError: 0, overflow: false, controlCalls: 1, controlReturned: true, controlError: 0 };
  n.events = [
    ['configured'], ['fork-enter'], ['fork-return', 1234, 0, 20], ['owner-registered', 1234, 0, 20],
    ['nonblock-skipped', -1, 5, 20], ['master-fgetfl-before', 2, 0, 20], ['master-fstat', 0, 0, 20],
    ['master-fgetfl-after', 2, 0, 20], ['master-close-enter', 20], ['master-close-return', 0, 0, 20],
    ['control-enter', 1234, 0, 15], ['control-return', 0, 0, 15], ['tsfn-create-enter'], ['tsfn-create-return'],
    ['thread-started', 1234], ['wait-enter', 1234], ['wait-return', 1234, 0, 15], ['payload-allocated'],
    ['notification-enter'], ['notification-return'], ['notification-callback'], ['payload-freed'],
    ['tsfn-release-enter'], ['tsfn-release-return'], ['thread-finished', 1234], ['tsfn-finalizer-enter'],
    ['thread-joined'], ['tsfn-finalized'],
  ].map(([name, value = 0, error = 0, aux = 0], index) => ({ name, value, error, aux, ord: index + 1, monoNs: `${index + 1}` }));
  const report = { token, scenario: 'U1-1', native: n, loaded: { path: config.binary, hash: config.binaryHash, node: 'v22.23.2' },
    error: null, callback: { exitCode: 0, signalCode: 15 }, rawBase64: '', events: [], controlMessages: [],
    source: 'explicit-cancel/not-started', state: null, readPending: 0, readCalls: 0,
    parserAccepted: 0, parserCompleted: 0, permissionSent: false };
  const observation = { token, messages: [
    { ms: 15, value: { type: 'after-await', token, callerMs: 10, result: { kind: 'result', report } } },
    { ms: 20, value: { type: 'caller-final', token, closed: { code: 0, signal: null, ms: 15 },
      exit: { code: 0, signal: null }, stdout: '', stderr: '', events: [
        { name: 'driver-result', ms: 9 }, { name: 'after-await', ms: 10 }] } },
  ], callerExit: { code: 0, signal: null, ms: 21 }, callerClose: { code: 0, signal: null, ms: 22 } };
  return { config, observation, n, report };
}

function assess(input) {
  const bytes = JSON.stringify(input.observation, null, 2) + '\n';
  return assessCase(input.config, input.observation, { error: null, close: { code: 0, signal: null, ms: 30 },
    receipt: { ms: 25, value: { bytes: Buffer.byteLength(bytes), hash: hash(bytes) } } });
}

test('strict source patch records ownership before post-fork work and keeps one selected waiter', () => {
  assert(dependencyRoot, 'Set DSC_DEPENDENCY_ROOT to the locked read-only node_modules');
  const original = fs.readFileSync(path.join(dependencyRoot, 'node-pty/src/unix/pty.cc'), 'utf8');
  const patched = patchUnixSource(original);
  assert(patched.indexOf('if (pid != 0) dsc_failure::ForkReturned') < patched.indexOf('  if (!pid)'));
  assert.equal(patched.split('  dsc_failure::SetupExitCallback(napiEnv, cb, pid);').length - 1, 1);
  assert.equal(patched.split('  SetupExitCallback(napiEnv, cb, pid);').length - 1, 0);
  assert.throws(() => patchUnixSource(original + '\n'), /Unexpected Unix/);
});

test('fixed payload independently preserves full headless state and cursor after Linux ONLCR', async () => {
  const require = createRequire(import.meta.url);
  const { Terminal } = require(path.join(dependencyRoot, '@xterm/headless'));
  const token = '1234567890abcdef1234567890abcdef';
  const source = fixtureBytes(token);
  assert.equal(source.length, 2102);
  const wire = Buffer.from(source.toString().replaceAll('\n', '\r\n'));
  assert.equal(wire.length, 2104);
  const term = new Terminal({ cols: 80, rows: 24, scrollback: 1000, allowProposedApi: true });
  await new Promise(resolve => term.write(wire, resolve));
  const state = terminalState(term);
  assert.equal(state.cursorX, 6);
  assert.equal(state.cursorY, 4);
  assert.equal(state.lines.length, state.length);
  assert(state.lines.every(line => line.cells.length === 80));
  term.dispose();
});

test('expected cancellation is accepted only with actual native owner evidence', () => {
  assert.deepEqual(assess(controlledCancellation()), { pass: true, safeToContinue: true, failures: [] });
});

test('close failure and incomplete payload release stop further admission', () => {
  const close = controlledCancellation();
  close.n.masterCloseReturned = false;
  close.n.masterCloseError = 9;
  assert.equal(assess(close).pass, false);
  assert.equal(assess(close).safeToContinue, false);
  const payload = controlledCancellation();
  payload.n.payloadFreed = false;
  assert.equal(assess(payload).safeToContinue, false);
});

test('raw wait cannot be replaced by claimed notification or cancellation relabeled EOF', () => {
  const status = controlledCancellation();
  status.n.events.find(event => event.name === 'wait-return').aux = 0;
  assert.equal(assess(status).pass, false);
  assert.equal(assess(status).safeToContinue, false);
  const source = controlledCancellation();
  source.report.source = 'linux-eio';
  assert.equal(assess(source).pass, false);
});

test('callback may run before worker records notification return without imposing false cross-thread order', () => {
  const input = controlledCancellation();
  const events = input.n.events;
  const returned = events.splice(events.findIndex(event => event.name === 'notification-return'), 1)[0];
  events.splice(events.findIndex(event => event.name === 'payload-freed') + 1, 0, returned);
  events.forEach((event, index) => { event.ord = index + 1; event.monoNs = `${index + 1}`; });
  assert.equal(assess(input).pass, true);
});
