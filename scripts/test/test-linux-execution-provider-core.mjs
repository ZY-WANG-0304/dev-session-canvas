import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';

import esbuild from 'esbuild';

const { outputFiles } = await esbuild.build({
  entryPoints: [path.resolve('extensions/vscode/dev-session-canvas/src/panel/linuxExecutionProvider.ts')],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  write: false,
  plugins: [{
    name: 'controlled-provider-channel',
    setup(build) {
      build.onResolve({ filter: /^\.\/executionProviderChannel$/ }, () => ({
        path: 'controlled-provider-channel', external: true
      }));
    }
  }]
});

const require = createRequire(import.meta.url);
let active;
const providerProcess = { ...process, platform: 'linux' };
const module = { exports: {} };
new Function('require', 'module', 'exports', 'setTimeout', 'process', outputFiles[0].text)(
  (specifier) => specifier === 'controlled-provider-channel'
    ? { createExecutionProviderChannel: (...args) => active.createChannel(...args) }
    : require(specifier),
  module, module.exports,
  (callback, milliseconds) => {
    assert.equal(milliseconds, 5);
    active.timers.push(callback);
  }, providerProcess
);
const { runLinuxExecutionProvider, runUnixExecutionProvider, validateLinuxExecutionReadBudget } = module.exports;

async function flush() {
  for (let turn = 0; turn < 40; turn += 1) await Promise.resolve();
}

function createHarness(chunks) {
  const identity = { executionId: 'controlled-linux-native-owner', generation: 'binding-1' };
  const state = {
    token: identity.executionId, configured: false, forkAttempted: false,
    pid: null, masterFd: null, childAcquired: false, masterAcquired: false,
    nonblockConfirmed: false, nonblockErrno: null,
    waitStatus: { kind: 'not-started', exitCode: null, signalCode: null, rawStatus: null, errno: null },
    closeAttempted: false, closeResult: null, closeErrno: null,
    readCalls: 0, pollCalls: 0, termCalls: 0, killCalls: 0
  };
  let sink;
  let bufferIdentity;
  let completed;
  const writes = [];
  const messages = [];
  const timers = [];
  const dispositions = [];
  const signals = [];
  const native = {
    executionConfigure(token) {
      assert.equal(token, identity.executionId);
      assert.equal(state.configured, false);
      state.configured = true;
    },
    fork(...args) {
      harness.forkArgs = args;
      assert.equal(state.forkAttempted, false);
      Object.assign(state, {
        forkAttempted: true, childAcquired: true, masterAcquired: true,
        nonblockConfirmed: true, pid: 1234, masterFd: 42,
        waitStatus: { ...state.waitStatus, kind: 'pending' }
      });
      return { pid: 1234, fd: 42 };
    },
    executionSnapshot: () => ({ ...state, waitStatus: { ...state.waitStatus } }),
    executionRead(token, buffer) {
      assert.equal(token, identity.executionId);
      assert.equal(buffer.byteLength, 4096);
      bufferIdentity ??= buffer;
      assert.equal(buffer, bufferIdentity, 'every read must reuse the single reserved raw slot');
      assert.equal(state.closeAttempted, false);
      state.readCalls += 1;
      const chunk = chunks.shift();
      assert.ok(chunk, 'the provider must not read past the controlled source');
      if (Buffer.isBuffer(chunk)) {
        chunk.copy(buffer);
        return { kind: 'data', bytes: chunk.byteLength };
      }
      return chunk;
    },
    executionPollWait(token) {
      assert.equal(token, identity.executionId);
      state.pollCalls += 1;
      return { ...state.waitStatus };
    },
    executionSignal(token, signal) {
      assert.equal(token, identity.executionId);
      signals.push(signal);
      state[signal === 'SIGTERM' ? 'termCalls' : 'killCalls'] += 1;
      const signalCode = signal === 'SIGHUP' ? 1 : signal === 'SIGTERM' ? 15 : 9;
      state.waitStatus = { kind: 'signaled', signalCode,
        exitCode: null, rawStatus: signalCode, errno: null };
      return { kind: 'sent', errno: null };
    },
    executionClose(token) {
      assert.equal(token, identity.executionId);
      assert.equal(state.closeAttempted, false, 'master close must only be attempted once');
      assert.ok(writes.every((entry) => entry.resolved), 'close must not discard an owned write or decoder tail');
      Object.assign(state, { closeAttempted: true, closeResult: 0 });
      return { kind: 'closed', errno: null };
    }
  };
  const harness = {
    identity, state, writes, messages, timers, dispositions, signals, native,
    get result() { return completed; },
    createChannel(receivedIdentity, handlers) {
      assert.deepEqual(receivedIdentity, identity);
      sink = handlers;
      return {
        ready: () => Promise.resolve(),
        send(message) {
          if (message.type === 'resourceResult') {
            assert.ok(messages.some((entry) => entry.type === 'resourceAcquired' && entry.resourceId === message.resourceId),
              'resource acquisition must precede its settlement');
          }
          messages.push(message);
          return Promise.resolve();
        },
        write(text) {
          assert.equal(writes.some((entry) => !entry.resolved), false, 'there must be at most one owned write');
          return new Promise((resolve) => {
            const entry = { text, resolved: false, resolve() { this.resolved = true; resolve(); } };
            writes.push(entry);
          });
        },
        end(disposition) {
          assert.ok(writes.every((entry) => entry.resolved));
          dispositions.push(disposition);
          return Promise.resolve();
        },
        close() {
          assert.equal(dispositions.length, 1);
          return Promise.resolve();
        }
      };
    },
    async start(options = {}) {
      active = this;
      validateLinuxExecutionReadBudget(identity);
      assert.throws(() => validateLinuxExecutionReadBudget({ ...identity, generation: 'g'.repeat(9000) }), /insufficient room/);
      providerProcess.platform = options.platform ?? 'linux';
      const run = options.platform === 'darwin' ? runUnixExecutionProvider : runLinuxExecutionProvider;
      void run({ identity, binding: native, cols: 80, rows: 24, pollIntervalMs: 5,
        ...(options.platform ? { platform: options.platform, helperPath: options.helperPath } : {}),
        ...(options.interactionV1 ? { interactionV1: true } : {}) })
        .then((result) => { completed = result; });
      this.command({ type: 'start', operationId: 'start', spec: { file: 'controlled-subject', args: [], cwd: '/', ...options.spec } });
      await flush();
    },
    command(command) { sink.onCommand({ ...command, identity }); },
    async tick() {
      const callback = timers.shift();
      assert.equal(typeof callback, 'function', 'process observation must retain a bounded scheduled continuation');
      callback();
      await flush();
    },
    async releaseWrite(index) {
      assert.equal(writes[index]?.resolved, false);
      writes[index].resolve();
      await flush();
    }
  };
  return harness;
}

const normal = createHarness([
  Buffer.from([0x41, 0xe4]), Buffer.from([0xb8, 0xad, 0xe2, 0x82]), { kind: 'eof', reason: 'eio' }
]);
await normal.start();
assert.equal(normal.state.readCalls, 1);
assert.deepEqual(normal.writes.map((entry) => entry.text), ['A']);
await normal.tick();
assert.ok(normal.state.pollCalls >= 2, 'wait polling must continue while the writer waits for credit');
assert.equal(normal.state.readCalls, 1, 'credit waiting must not initiate another read');
normal.command({ type: 'requestStop', operationId: 'stop', mode: 'graceful' });
await flush();
assert.deepEqual(normal.signals, ['SIGTERM']);
assert.equal(normal.messages.find((message) => message.operationId === 'stop')?.result.kind, 'accepted');
await normal.tick();
assert.equal(normal.messages.find((message) => message.type === 'processResult')?.result.kind, 'signaled');
assert.equal(normal.state.readCalls, 1, 'process exit must not discard or replace the held read');
await normal.releaseWrite(0);
assert.deepEqual(normal.writes.map((entry) => entry.text), ['A', '\u4e2d']);
assert.equal(normal.state.readCalls, 2);
await normal.releaseWrite(1);
assert.deepEqual(normal.writes.map((entry) => entry.text), ['A', '\u4e2d', '\ufffd']);
assert.equal(normal.state.closeAttempted, false);
await normal.releaseWrite(2);
assert.equal(normal.result?.kind, 'closed');
assert.deepEqual(normal.dispositions, [{ kind: 'eof' }]);
assert.equal(normal.result.sourceEndEvidence, 'eio');
assert.equal(normal.result.resourcesSettled, true);
assert.deepEqual(normal.messages.filter((message) => message.type === 'resourceResult').map((message) => message.result.kind),
  ['released', 'released', 'released']);
assert.equal(normal.timers.length, 0);
console.log('PASS single read slot, independent stop/wait, and decoder tail before source EOF');

const cancelled = createHarness([Buffer.from([0x58, 0xe2, 0x82]), Buffer.from('must-not-read')]);
await cancelled.start();
cancelled.command({ type: 'cancelOutput', operationId: 'cancel', reason: 'controlled cancellation' });
cancelled.command({ type: 'requestStop', operationId: 'stop', mode: 'graceful' });
await flush();
await cancelled.tick();
assert.equal(cancelled.messages.find((message) => message.operationId === 'cancel')?.result.kind, 'accepted');
assert.equal(cancelled.dispositions.length, 0, 'cancel acceptance must not pretend that owned output already settled');
assert.equal(cancelled.state.readCalls, 1);
assert.equal(cancelled.state.closeAttempted, false);
await cancelled.releaseWrite(0);
assert.deepEqual(cancelled.writes.map((entry) => entry.text), ['X', '\ufffd']);
assert.equal(cancelled.state.readCalls, 1, 'cancellation must prevent the next native read');
assert.equal(cancelled.state.closeAttempted, false);
await cancelled.releaseWrite(1);
assert.equal(cancelled.result?.kind, 'closed');
assert.equal(cancelled.result.sourceEndEvidence, 'cancelled');
assert.equal(cancelled.dispositions[0]?.kind, 'interrupted');
assert.equal(cancelled.result.resourcesSettled, true);
assert.equal(cancelled.timers.length, 0);
console.log('PASS cancellation preserves the owned write and decoder tail without inventing EOF');
console.log('linuxExecutionProvider core tests passed (2 pure cases; zero native calls or child processes)');

async function until(h, condition) {
  for (let turn = 0; turn < 100; turn++) {
    await flush();
    if (condition()) return;
    if (h.timers.length) await h.tick();
  }
  assert.fail('controlled provider interaction did not settle');
}

function interactiveHarness(write = (_token, bytes) => ({ kind: 'written', bytes: bytes.length }), resize = () => ({ kind: 'resized' })) {
  const h = createHarness([Buffer.from('held-output'), { kind: 'eof', reason: 'eio' }]);
  h.native.executionWrite = write;
  h.native.executionResize = resize;
  h.interaction = id => h.messages.find(message => message.type === 'interactionObservation' && message.interactionId === id)?.result;
  return h;
}

async function finishInteractive(h) {
  if (h.state.waitStatus.kind === 'pending') {
    h.state.waitStatus = { kind: 'exited', exitCode: 7, signalCode: null, rawStatus: 7 << 8, errno: null };
  }
  await until(h, () => h.messages.some(message => message.type === 'processResult'));
  await h.releaseWrite(0);
  await until(h, () => Boolean(h.result));
  assert.equal(h.result.kind, 'closed', h.result.reason);
  assert.equal(h.result.resourcesSettled, true);
  assert.equal(h.timers.length, 0);
}

const spec = { cols: 107, rows: 33, stopStrategy: 'hangup' };
{
  const attempts = [];
  const results = [{ kind: 'written', bytes: 2 }, { kind: 'retry', errno: 11 }, { kind: 'retry', errno: 4 }];
  const resizes = [];
  const h = interactiveHarness((_token, bytes) => {
    attempts.push(Buffer.from(bytes));
    return results.shift() ?? { kind: 'written', bytes: bytes.length };
  }, (_token, cols, rows) => { resizes.push([cols, rows]); return { kind: 'resized' }; });
  await h.start({ interactionV1: true, spec });
  assert.deepEqual(h.forkArgs.slice(4, 6), [107, 33]);
  h.command({ type: 'input', interactionId: 1, data: 'A\u4e2dBC' });
  h.command({ type: 'resize', interactionId: 2, cols: 119, rows: 41 });
  await until(h, () => Boolean(h.interaction(1)) && Boolean(h.interaction(2)));
  const expected = Buffer.from('A\u4e2dBC');
  assert.deepEqual(attempts, [expected, expected.subarray(2), expected.subarray(2), expected.subarray(2)]);
  assert.deepEqual(h.interaction(1), { kind: 'written', writtenBytes: expected.length });
  assert.deepEqual(h.interaction(2), { kind: 'resized' });
  assert.deepEqual(resizes, [[119, 41]]);
  assert.equal(h.writes[0].resolved, false, 'interaction responses cannot wait for output credit');
  await finishInteractive(h);
  console.log('PASS explicit initial size, partial UTF-8 byte prefixes, EINTR/EAGAIN and resize while output is held');
}

for (const strategy of ['hangup', 'interrupt-then-hangup']) {
  const attempts = [];
  const h = interactiveHarness((_token, bytes) => {
    attempts.push(Buffer.from(bytes));
    if (bytes.length === 1 && bytes[0] === 3) return { kind: 'written', bytes: 1 };
    return attempts.length === 1 ? { kind: 'written', bytes: 1 } : { kind: 'retry', errno: 11 };
  });
  await h.start({ interactionV1: true, spec: { ...spec, stopStrategy: strategy } });
  h.command({ type: 'input', interactionId: 1, data: 'pending-input' });
  await flush();
  assert.equal(h.interaction(1), undefined);
  h.command({ type: 'requestStop', operationId: 'stop-graceful', mode: 'graceful' });
  await flush();
  if (strategy === 'hangup') assert.deepEqual(h.signals, ['SIGHUP']);
  else {
    assert.equal(attempts.some(bytes => bytes.length === 1 && bytes[0] === 3), true,
      'stop interrupt bypasses the closed ordinary queue');
    assert.deepEqual(h.signals, []);
  }
  h.command({ type: 'requestStop', operationId: 'stop-force', mode: 'force' });
  await flush();
  assert.equal(h.signals.every(signal => signal === 'SIGHUP'), true);
  assert.equal(h.messages.find(message => message.operationId === 'stop-force')?.result.kind, 'accepted');
  await until(h, () => Boolean(h.interaction(1)));
  assert.equal(h.interaction(1).kind, 'cancelled');
  assert.equal(h.interaction(1).writtenBytes, 1, 'cancellation must retain the actual written prefix');
  const before = attempts.length;
  h.command({ type: 'input', interactionId: 2, data: 'must-not-write' });
  await flush();
  assert.equal(h.interaction(2).kind, 'cancelled');
  assert.equal(attempts.length, before);
  assert.equal(h.writes[0].resolved, false);
  await finishInteractive(h);
  console.log(`PASS ${strategy} stop preserves its signal strategy and bypasses blocked input without discarding output`);
}

{
  const h = interactiveHarness(() => ({ kind: 'error', reason: 'syscall', errno: 5 }),
    () => ({ kind: 'rejected', reason: 'process-unknown', errno: 10 }));
  await h.start({ interactionV1: true, spec });
  h.command({ type: 'input', interactionId: 1, data: 'error' });
  h.command({ type: 'resize', interactionId: 2, cols: 80, rows: 24 });
  await until(h, () => Boolean(h.interaction(2)));
  assert.equal(h.interaction(1).kind, 'failed');
  assert.equal(h.interaction(1).writtenBytes, 0);
  assert.equal(h.interaction(2).kind, 'cancelled');
  assert.deepEqual(h.signals, []);
  await finishInteractive(h);
  console.log('PASS native input failure and resize rejection are not reported as successful mutation');
}

{
  const h = createHarness([]);
  active = h;
  assert.throws(() => runLinuxExecutionProvider({ identity: h.identity, binding: h.native,
    cols: 80, rows: 24, pollIntervalMs: 5, interactionV1: true }), /does not support/);
  assert.equal(h.state.configured, false);
  assert.equal(h.messages.length, 0);
  console.log('PASS missing interaction exports reject before channel readiness or native configuration');
}
{
  let interruptAttempts = 0;
  const h = interactiveHarness((_token, bytes) => {
    assert.deepEqual(bytes, Buffer.from([3]));
    interruptAttempts += 1;
    return { kind: 'retry', errno: interruptAttempts % 2 ? 11 : 4 };
  });
  await h.start({ interactionV1: true, spec: { ...spec, stopStrategy: 'interrupt-then-hangup' } });
  h.command({ type: 'requestStop', operationId: 'stop-graceful', mode: 'graceful' });
  await until(h, () => interruptAttempts >= 3);
  assert.equal(h.messages.some(message => message.operationId === 'stop-graceful'), false);
  assert.deepEqual(h.signals, []);
  const beforeForce = interruptAttempts;
  h.command({ type: 'requestStop', operationId: 'stop-force', mode: 'force' });
  await flush();
  assert.deepEqual(h.signals, ['SIGHUP']);
  assert.equal(h.messages.find(message => message.operationId === 'stop-force')?.result.kind, 'accepted');
  assert.equal(h.messages.some(message => message.operationId === 'stop-graceful'), false,
    'force must complete while the prior Ctrl-C retry is still waiting');
  assert.equal(h.writes[0].resolved, false, 'force must not discard the held output');
  await finishInteractive(h);
  assert.equal(interruptAttempts, beforeForce, 'force must prevent another native Ctrl-C write');
  assert.ok(h.messages.some(message => message.operationId === 'stop-graceful'));
  console.log('PASS force proceeds independently while internal Ctrl-C keeps returning EAGAIN/EINTR');
}

for (const boundary of ['process-first', 'source-first']) {
  const attempts = [];
  const events = [];
  let releaseInteraction;
  const h = interactiveHarness((_token, bytes) => {
    attempts.push(Buffer.from(bytes));
    return attempts.length === 1 ? { kind: 'written', bytes: 2 } : { kind: 'retry', errno: 11 };
  }, () => ({ kind: 'retry', errno: 4 }));
  const createChannel = h.createChannel;
  h.createChannel = (...args) => {
    const channel = createChannel(...args);
    const send = channel.send;
    channel.send = message => {
      const sent = send(message);
      if (message.type !== 'interactionObservation' || message.interactionId !== 1) return sent;
      events.push('interaction-pending');
      return new Promise(resolve => {
        releaseInteraction = () => { events.push('interaction-settled'); resolve(); };
      });
    };
    return channel;
  };
  const close = h.native.executionClose;
  h.native.executionClose = token => {
    assert.deepEqual(events, ['interaction-pending', 'interaction-settled'],
      'native close must wait for the original partial input result to settle');
    events.push('native-close');
    return close(token);
  };
  await h.start({ interactionV1: true, spec });
  h.command({ type: 'input', interactionId: 1, data: 'partial-input' });
  h.command({ type: 'resize', interactionId: 2, cols: 120, rows: 40 });
  await until(h, () => attempts.length >= 2);
  assert.equal(h.interaction(1), undefined);
  const writtenBeforeBoundary = attempts.length;
  if (boundary === 'process-first') {
    h.state.waitStatus = { kind: 'exited', exitCode: 7, signalCode: null, rawStatus: 7 << 8, errno: null };
    await until(h, () => h.messages.some(message => message.type === 'processResult'));
    assert.equal(h.writes[0].resolved, false);
  } else {
    await h.releaseWrite(0);
    assert.equal(h.messages.some(message => message.type === 'processResult'), false);
  }
  await until(h, () => typeof releaseInteraction === 'function');
  assert.equal(h.interaction(1).kind, 'cancelled');
  assert.equal(h.interaction(1).writtenBytes, 2);
  assert.equal(attempts.length, writtenBeforeBoundary, 'natural end must not retry the unwritten suffix');
  assert.equal(h.state.closeAttempted, false);
  if (boundary === 'process-first') await h.releaseWrite(0);
  assert.equal(h.state.closeAttempted, false, 'EOF does not bypass a pending interaction settlement');
  h.command({ type: 'input', interactionId: 3, data: 'after-natural-end' });
  await flush();
  assert.equal(h.interaction(3).kind, 'cancelled');
  assert.equal(h.interaction(3).writtenBytes, 0);
  releaseInteraction();
  await until(h, () => Boolean(h.interaction(2)) && h.state.closeAttempted);
  assert.equal(h.interaction(2).kind, 'cancelled');
  assert.deepEqual(events, ['interaction-pending', 'interaction-settled', 'native-close']);
  if (boundary === 'source-first') {
    assert.equal(h.result, undefined, 'source completion cannot invent the still-pending process result');
    h.state.waitStatus = { kind: 'exited', exitCode: 7, signalCode: null, rawStatus: 7 << 8, errno: null };
  }
  await until(h, () => Boolean(h.result));
  assert.equal(h.result.kind, 'closed', h.result.reason);
  assert.equal(h.result.resourcesSettled, true);
  assert.equal(h.result.sourceEndEvidence, 'eio');
  assert.deepEqual(h.signals, []);
  assert.equal(attempts.length, writtenBeforeBoundary);
  assert.equal(h.timers.length, 0);
  console.log(`PASS ${boundary} cancels partial input and retrying resize before native close`);
}

console.log('linuxExecutionProvider interaction tests passed (8 pure cases; fake native boundary, no PTY)');

for (const releaseResult of [0, -1]) {
  const h = createHarness([{ kind: 'eof', reason: 'zero' }]);
  h.state.creationResources = [{ resourceId: 'pty-low-fd-0', acquired: true, releaseAttempted: true,
    releaseResult, releaseErrno: releaseResult === 0 ? null : 4 }];
  await h.start({ platform: 'darwin', helperPath: '/controlled/spawn-helper' });
  assert.equal(h.forkArgs[9], '/controlled/spawn-helper');
  if (releaseResult === 0) {
    h.state.waitStatus = { kind: 'exited', exitCode: 0, signalCode: null, rawStatus: 0, errno: null };
  }
  await until(h, () => Boolean(h.result));
  const creation = h.messages.filter(message => message.type === 'resourceResult' && message.resourceId === 'pty-creation');
  assert.equal(creation.length, 1);
  assert.equal(creation[0].result.kind, releaseResult === 0 ? 'released' : 'unknown');
  assert.equal(h.messages.some(message => message.resourceId === 'pty-low-fd-1'), false,
    'A creation transaction cannot invent acquisition of absent temporary OS resources.');
  assert.equal(h.result.kind, releaseResult === 0 ? 'closed' : 'failed');
  assert.equal(h.result.resourcesSettled, releaseResult === 0);
  assert.equal(h.result.sourceEndEvidence, releaseResult === 0 ? 'zero' : 'not-established');
  console.log(`PASS controlled Darwin helper and creation-resource ${releaseResult === 0 ? 'release' : 'unknown'}`);
}
{
  const h = createHarness([{ kind: 'eof', reason: 'eio' }]);
  h.state.creationResources = [];
  await h.start({ platform: 'darwin', helperPath: '/controlled/spawn-helper' });
  await until(h, () => Boolean(h.result));
  assert.equal(h.result.kind, 'failed');
  assert.equal(h.dispositions[0].kind, 'error');
  assert.notEqual(h.result.sourceEndEvidence, 'eio');
  console.log('PASS controlled Darwin does not inherit Linux EIO-to-EOF classification');
}
console.log('Darwin provider adaptation: 3 controlled cases; no Darwin native execution claimed.');
