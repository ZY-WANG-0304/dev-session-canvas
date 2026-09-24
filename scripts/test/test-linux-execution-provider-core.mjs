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
const module = { exports: {} };
new Function('require', 'module', 'exports', 'setTimeout', outputFiles[0].text)(
  (specifier) => specifier === 'controlled-provider-channel'
    ? { createExecutionProviderChannel: (...args) => active.createChannel(...args) }
    : require(specifier),
  module, module.exports,
  (callback, milliseconds) => {
    assert.equal(milliseconds, 5);
    active.timers.push(callback);
  }
);
const { runLinuxExecutionProvider, validateLinuxExecutionReadBudget } = module.exports;

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
    fork() {
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
      state.waitStatus = { kind: 'signaled', signalCode: signal === 'SIGTERM' ? 15 : 9,
        exitCode: null, rawStatus: signal === 'SIGTERM' ? 15 : 9, errno: null };
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
    identity, state, writes, messages, timers, dispositions, signals,
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
    async start() {
      active = this;
      validateLinuxExecutionReadBudget(identity);
      assert.throws(() => validateLinuxExecutionReadBudget({ ...identity, generation: 'g'.repeat(9000) }), /insufficient room/);
      void runLinuxExecutionProvider({ identity, binding: native, cols: 80, rows: 24, pollIntervalMs: 5 })
        .then((result) => { completed = result; });
      this.command({ type: 'start', operationId: 'start', spec: { file: 'controlled-subject', args: [], cwd: '/' } });
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
