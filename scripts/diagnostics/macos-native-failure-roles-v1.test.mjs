import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { caller, driver, registrationGate } from './macos-native-failure-roles-v1.mjs';
import { runFixture } from './macos-native-failure-fixture-process-v1.mjs';
import { createU16Fixture } from './macos-native-failure-fixture-v1.mjs';
import { assessCase } from './macos-native-failure-verifier-v1.mjs';

const token = '1234567890abcdef1234567890abcdef';
const ready = { type: 'ready', token, pid: 1234, stdinTTY: true, stdoutTTY: true };
const snapshot = () => ({ token, scenario: 'U1-6', pid: 1234, master: 20, masterAcquired: true,
  masterCloseCalls: 0, kqueueAcquired: true, kqueueOwnerRegistered: true, kqueueFd: 22,
  registerApiEntered: true, registrationFailureInjected: true, registrationCallInvoked: false,
  registrationInFlight: false, registrationResult: -1, registrationError: 5,
  registrationErrorSource: 'native-substitute', kqueueRegistered: false, kqueueWaitReturned: false,
  events: [{ name: 'kqueue-register-failure' }] });
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
function fakeClock() {
  const timers = new Map();
  let now = 0;
  return { timers, now: () => now, setTimeout: (callback, ms) => { timers.set(ms, callback); return ms; },
    clearTimeout: timer => timers.delete(timer), fire: ms => { now = ms; timers.get(ms)?.(); } };
}

test('registration gate binds ready to actual owners without inventing native fixture knowledge', () => {
  assert.equal(registrationGate(snapshot(), ready, token, { pid: 1234, fd: 20 }), true);
  assert.equal(ready.registrationFailureInjected, undefined);
  for (const change of [{ registrationInFlight: true }, { registrationCallInvoked: true },
    { registrationErrorSource: 'system' }, { kqueueOwnerRegistered: false }, { kqueueRegistered: true },
    { masterCloseCalls: 1 }, { pid: 1235 }, { master: 21 }])
    assert.equal(registrationGate({ ...snapshot(), ...change }, ready, token, { pid: 1234, fd: 20 }), false);
  assert.equal(registrationGate(snapshot(), { ...ready, token: 'wrong' }, token, { pid: 1234, fd: 20 }), false);
});

test('driver uses array environment, saves gate and pre-close facts, and only sends abort', async () => {
  const server = new EventEmitter(), socket = new EventEmitter(), messages = [], written = [];
  let onConnection, state = snapshot(), exitCallback, forkArguments, disconnected = false;
  server.listen = (_port, _host, done) => done(); server.address = () => ({ port: 12345 });
  server.close = done => done(); socket.destroy = () => socket.emit('close');
  socket.write = (data, done) => {
    written.push(JSON.parse(data));
    queueMicrotask(() => {
      socket.emit('data', JSON.stringify({ type: 'abort-ack', token, pid: 1234 }) + '\n');
      state = { ...state, waitConfirmed: true, kqueueCloseReturned: true, tsfnFinalized: true,
        threadJoined: true, payloadFreed: true, events: [...state.events, { name: 'tsfn-finalized' }] };
      exitCallback(0, 0); done();
    });
  };
  const native = { failureConfigure: () => {}, failureSnapshot: () => structuredClone(state),
    fork: (...args) => {
      forkArguments = args; exitCallback = args.at(-1);
      queueMicrotask(() => { onConnection(socket); socket.emit('data', JSON.stringify(ready) + '\n'); });
      return { pid: 1234, fd: 20 };
    },
    failureCloseMaster: () => {
      state.masterCloseCalls++;
      state.events.push({ name: 'master-close-return' });
    } };
  const bytes = Buffer.from('fixed input'), digest = createHash('sha256').update(bytes).digest('hex');
  const report = await driver({ token, scenario: 'U1-6', fixtureScenario: 'U1-6', platform: 'darwin',
    binary: '/fixed/pty.node', binaryHash: digest, helper: '/fixed/spawn-helper', helperHash: digest, cwd: '/fixed' },
  { platform: 'darwin', readFile: () => bytes, load: () => native, env: { FIXTURE: 'yes' },
    createServer: callback => { onConnection = callback; return server; },
    send: async message => { messages.push(message); }, sleep: async () => flush(),
    disconnect: () => { disconnected = true; } });
  assert.equal(report.error, null);
  assert.deepEqual(forkArguments[2], ['FIXTURE=yes', 'TERM=xterm-256color']);
  assert.deepEqual(written, [{ type: 'abort', token, pid: 1234 }]);
  assert.deepEqual(report.controlMessages.map(item => item.type), ['ready', 'abort', 'abort-ack']);
  assert.deepEqual(report.writeGate.native.events, report.native.events.slice(0, 1));
  assert.deepEqual(report.beforeCloseNative.events, report.native.events.slice(0, -1));
  assert.equal(report.readCalls, 0); assert.equal(report.permissionSent, false); assert.equal(report.state, null);
  assert.equal(report.rawBase64, ''); assert.equal(report.native.masterCloseCalls, 1);
  assert.deepEqual(messages.map(item => item.type), ['driver-started', 'driver-result']);
  assert.equal(disconnected, true);
});

function fixtureHarness() {
  const socket = new EventEmitter(), clock = fakeClock(), frames = [], exited = [];
  let endCallback;
  socket.write = (frame, done) => { frames.push(JSON.parse(frame)); done(); };
  socket.end = (frame, done) => { frames.push(JSON.parse(frame)); endCallback = done; };
  socket.destroy = () => socket.emit('close');
  const result = runFixture({ scenario: 'U1-6', token, port: 12345 },
    { connect: () => socket, ...clock, exit: code => exited.push(code), pid: 1234, stdinTTY: true, stdoutTTY: true });
  return { socket, clock, frames, exited, result, finishAck: () => endCallback() };
}

test('fixture waits for its abort acknowledgement to flush before exit 0', async () => {
  const h = fixtureHarness(); h.socket.emit('connect');
  h.socket.emit('data', JSON.stringify({ type: 'abort', token, pid: 1234 }) + '\n');
  assert.deepEqual(h.frames, [ready, { type: 'abort-ack', token, pid: 1234 }]);
  assert.deepEqual(h.exited, []); assert.equal(h.clock.timers.has(20000), true);
  h.finishAck(); assert.equal(await h.result, 0); assert.deepEqual(h.exited, [0]);
  assert.equal(h.clock.timers.size, 0);
});

test('fixture errors, wrong controls and safety expiry finish instead of hanging', async () => {
  for (const frame of ['{\n', JSON.stringify({ type: 'go', token, pid: 1234 }) + '\n',
    JSON.stringify({ type: 'abort', token: 'wrong', pid: 1234 }) + '\n']) {
    const h = fixtureHarness(); h.socket.emit('data', frame); assert.equal(await h.result, 125);
    assert.deepEqual(h.exited, [125]);
  }
  const errored = fixtureHarness(); errored.socket.emit('error', new Error('connection failed'));
  assert.equal(await errored.result, 125);
  const expired = fixtureHarness(); expired.clock.fire(20000); assert.equal(await expired.result, 124);
});

function callerHarness() {
  const child = new EventEmitter(), clock = fakeClock(), messages = [], kills = [], exits = [];
  child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
  child.kill = signal => { kills.push(signal); return true; };
  const result = caller({ token, configPath: '/fixed/config.json' }, { ...clock, spawn: () => child,
    send: async message => { messages.push(structuredClone(message)); }, disconnect: () => {}, exit: code => exits.push(code) });
  return { child, clock, messages, kills, exits, result };
}

test('caller preserves result, real await continuation, process exit and stdio close separately', async () => {
  const h = callerHarness();
  h.child.emit('message', { type: 'driver-started', token, snapshot: {} });
  h.child.emit('message', { type: 'driver-result', token, report: { token } });
  await flush();
  assert.deepEqual(h.messages.map(item => item.type), ['driver-started', 'after-await']);
  h.child.emit('exit', 0, null); h.child.stdout.emit('data', 'evidence'); h.child.emit('close', 0, null);
  await h.result;
  const final = h.messages.at(-1);
  assert.equal(final.type, 'caller-final'); assert.deepEqual(final.exit, { code: 0, signal: null });
  assert.equal(final.closed.code, 0); assert.equal(final.stdout, 'evidence');
  assert.deepEqual(h.kills, []); assert.equal(h.clock.timers.size, 0);
});

test('caller keeps frozen failure budgets without presenting forced termination as successful settlement', async () => {
  const h = callerHarness();
  assert.deepEqual([...h.clock.timers.keys()], [30000, 31000, 32000]);
  h.clock.fire(30000); await flush();
  assert.equal(h.messages[0].type, 'after-await'); assert.equal(h.messages[0].result.kind, 'deadline');
  h.clock.fire(31000); h.clock.fire(32000); await h.result;
  assert.deepEqual(h.kills, ['SIGTERM', 'SIGKILL']); assert.deepEqual(h.exits, [2]);
  assert.equal(h.messages.at(-1).closed, null); assert.equal(h.messages.at(-1).exit, null);
});

test('actual driver report matches the verifier contract using only injected native snapshots', async () => {
  const input = createU16Fixture(), { config, report: fixed } = input;
  const socket = new EventEmitter(), server = new EventEmitter();
  let onConnection, callback, current = fixed.writeGate.native, time = 0;
  const bytes = Buffer.from('fixed pure-test candidate');
  const digest = createHash('sha256').update(bytes).digest('hex');
  Object.assign(config, { binaryHash: digest, helper: '/fixed/spawn-helper', helperHash: digest, cwd: '/fixed' });
  server.listen = (_port, _host, done) => done(); server.address = () => ({ port: 12345 });
  server.close = done => done(); socket.destroy = () => socket.emit('close');
  socket.write = (frame, done) => {
    assert.deepEqual(JSON.parse(frame), fixed.controlMessages[1]);
    queueMicrotask(() => {
      socket.emit('data', JSON.stringify(fixed.controlMessages[2]) + '\n');
      current = fixed.beforeCloseNative; callback(0, 0); done();
    });
  };
  const report = await driver(config, {
    platform: 'darwin', version: 'v22.23.2', now: () => (time += 0.01), readFile: () => bytes,
    createServer: onSocket => { onConnection = onSocket; return server; },
    send: async () => {}, sleep: async () => flush(), disconnect: () => {},
    load: () => ({ failureConfigure: () => {}, failureSnapshot: () => structuredClone(current),
      fork: (...args) => {
        callback = args.at(-1);
        queueMicrotask(() => { onConnection(socket); socket.emit('data', JSON.stringify(fixed.controlMessages[0]) + '\n'); });
        return { pid: input.native.pid, fd: input.native.master };
      },
      failureCloseMaster: boundToken => { assert.equal(boundToken, config.token); current = input.native; }
    })
  });
  input.observation.messages.find(item => item.value.type === 'after-await').value.result.report = report;
  const raw = JSON.stringify(input.observation, null, 2) + '\n';
  input.evidence.receipt.value = { bytes: Buffer.byteLength(raw), hash: createHash('sha256').update(raw).digest('hex') };
  const assessed = assessCase(config, input.observation, input.evidence);
  assert.equal(assessed.pass, true, JSON.stringify(assessed.failures));
  assert.equal(report.loaded.helperHash, config.helperHash);
  assert.equal(report.loaded.hash, config.binaryHash);
});
