import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import path from 'node:path';
import esbuild from 'esbuild';

const tasks = [];
const timers = [];
const deadlines = new Set();
const scheduler = {
  now: () => 0,
  scheduleTask: callback => tasks.push(callback),
  scheduleDeadline(_deadline, callback) {
    deadlines.add(callback);
    return () => deadlines.delete(callback);
  }
};
const providerProcess = new EventEmitter();
Object.assign(providerProcess, { platform: 'linux', connected: true, env: {}, cwd: () => '/' });
const messages = [];
let sink;
providerProcess.send = (message, callback) => {
  messages.push(message);
  tasks.push(() => { sink.message(message); callback(null); });
  return true;
};
providerProcess.disconnect = () => {
  providerProcess.connected = false;
  tasks.push(() => {
    providerProcess.emit('disconnect');
    sink.controlResourceResult({ kind: 'released' });
  });
};
class ControlledSocket extends EventEmitter {
  constructor(options) {
    super();
    assert.deepEqual(options, { fd: 4, readable: false, writable: true });
  }
  write(bytes, callback) {
    const owned = Uint8Array.from(bytes);
    tasks.push(() => { sink.data(owned); callback(null); });
    return true;
  }
  end(callback) { tasks.push(() => { sink.dataEnded(); callback(); }); }
  destroy() { tasks.push(() => this.emit('close')); }
}

// Only OS boundaries are replaced; adapter, channel, credit and provider run together.
const require = createRequire(import.meta.url);
async function load(name) {
  const { outputFiles } = await esbuild.build({
    entryPoints: [path.resolve(`extensions/vscode/dev-session-canvas/src/panel/${name}.ts`)],
    bundle: true, platform: 'node', format: 'cjs', target: 'node18', write: false
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'process', 'setTimeout', outputFiles[0].text)(
    specifier => {
      if (specifier === 'node:net') return { Socket: ControlledSocket };
      assert.ok(['node:os', 'node:string_decoder'].includes(specifier), `forbidden dependency: ${specifier}`);
      return require(specifier);
    }, module, module.exports, providerProcess,
    (callback, milliseconds) => { assert.equal(milliseconds, 5); timers.push(callback); }
  );
  return module.exports;
}
const { createExecutionAuthority, prepareExecution } = await load('executionSessionAdapter');
const { runLinuxExecutionProvider } = await load('linuxExecutionProvider');
const identity = { executionId: 's10-interaction-chain', generation: 'binding-1' };
const waitStatus = { kind: 'pending', exitCode: null, signalCode: null, rawStatus: null, errno: null };
const state = {
  token: identity.executionId, configured: false, forkAttempted: false,
  childAcquired: false, masterAcquired: false, nonblockConfirmed: false,
  pid: null, masterFd: null, waitStatus, closeAttempted: false, closeResult: null
};
const written = [];
const sizes = [];
const signals = [];
let readCount = 0;
let writeCount = 0;
let resizeCompleted = false;
const binding = {
  executionConfigure: token => { assert.equal(token, state.token); state.configured = true; },
  fork(_file, _args, _env, _cwd, cols, rows) {
    sizes.push([cols, rows]);
    Object.assign(state, { forkAttempted: true, childAcquired: true, masterAcquired: true,
      nonblockConfirmed: true, pid: 1234, masterFd: 42 });
    return { pid: 1234, fd: 42 };
  },
  executionSnapshot: () => ({ ...state, waitStatus: { ...waitStatus } }),
  executionPollWait: () => ({ ...waitStatus }),
  executionRead(_token, buffer) {
    assert.equal(state.closeAttempted, false);
    if (++readCount > 17) return { kind: 'eof', reason: 'eio' };
    const bytes = Buffer.from(`tail-${readCount}\u001b[3;7H`);
    bytes.copy(buffer);
    return { kind: 'data', bytes: bytes.length };
  },
  executionWrite(token, bytes) {
    assert.equal(token, state.token);
    assert.equal(state.closeAttempted, false);
    writeCount++;
    if (writeCount > 1 && !resizeCompleted) return { kind: 'retry', errno: 11 };
    const count = writeCount === 1 ? 2 : bytes.length;
    written.push(Buffer.from(bytes.subarray(0, count)));
    return { kind: 'written', bytes: count };
  },
  executionResize(_token, cols, rows) {
    assert.equal(Buffer.concat(written).length, 2, 'resize must bypass the blocked input suffix');
    resizeCompleted = true;
    sizes.push([cols, rows]);
    return { kind: 'resized' };
  },
  executionSignal(_token, signal) {
    signals.push(signal);
    Object.assign(waitStatus, { kind: 'signaled', signalCode: 1, rawStatus: 1 });
    return { kind: 'sent', errno: null };
  },
  executionClose() {
    assert.equal(state.closeAttempted, false);
    Object.assign(state, { closeAttempted: true, closeResult: 0 });
    return { kind: 'closed', errno: null };
  }
};
let completed;
const parentMessages = [];
const session = prepareExecution(identity,
  { file: 'controlled-subject', args: [], cwd: '/', cols: 107, rows: 33, stopStrategy: 'hangup' },
  {
    authority: createExecutionAuthority(), scheduler, profile: 'linux-owner-v1-candidate',
    transport: {
      connect(value) {
        sink = value;
        void runLinuxExecutionProvider({ identity, binding, cols: 80, rows: 24,
          pollIntervalMs: 5, interactionV1: true }).then(result => { completed = result; });
      },
      send(message) {
        parentMessages.push(message);
        return new Promise(resolve => tasks.push(() => { providerProcess.emit('message', message); resolve(); }));
      }
    }
  });
const data = [];
const faults = [];
const heldConsumption = [];
let consume = false;
const control = session.bind({
  data: batch => data.push(batch.text), processResult() {}, outputSeal() {}, resourceResult() {},
  fault: (_identity, reason) => faults.push(reason)
}, () => consume ? Promise.resolve() : new Promise(resolve => heldConsumption.push(resolve)));
async function until(condition) {
  for (let turn = 0; turn < 3000; turn++) {
    if (condition()) return;
    const task = tasks.shift() ?? timers.shift();
    task?.();
    await Promise.resolve();
    await Promise.resolve();
  }
  assert.fail(`interaction chain did not settle: ${JSON.stringify({ snapshot: session.snapshot(), faults, completed })}`);
}
const started = control.start('start', 1000);
await until(() => started.current?.kind === 'started' && session.snapshot().pendingFrames === 16);
assert.equal(session.snapshot().consumedThrough, 0);
const input = 'A\u4e2d\u001b\\\"'.repeat(1700);
const write = session.write(input, 1000);
const resize = session.resize(119, 41, 1000);
await until(() => Boolean(resize.current) && Boolean(write.current));
assert.deepEqual(await write.first, { kind: 'written', writtenBytes: Buffer.byteLength(input) });
assert.deepEqual(await resize.first, { kind: 'resized' });
assert.deepEqual(Buffer.concat(written), Buffer.from(input), 'partial writes and IPC chunks must not repeat or omit bytes');
assert.deepEqual(sizes, [[107, 33], [119, 41]]);
assert.ok(parentMessages.filter(message => message.type === 'input').length > 1);
assert.ok(parentMessages.every(message => Buffer.byteLength(JSON.stringify(message)) <= 4096));
assert.equal(session.snapshot().consumedThrough, 0, 'input and resize must complete with output credit exhausted');
const stop = control.requestStop('stop', 'graceful', 1000);
await until(() => Boolean(stop.current) && Boolean(session.snapshot().process));
assert.equal((await stop.first).kind, 'accepted');
assert.deepEqual(signals, ['SIGHUP']);
assert.equal(state.closeAttempted, false, 'held native output must survive process exit');
consume = true;
heldConsumption.splice(0).forEach(resolve => resolve());
await until(() => Boolean(completed) && session.snapshot().state === 'settled');
assert.equal(completed.kind, 'closed', completed.reason);
assert.equal(completed.resourcesSettled, true);
assert.equal(completed.source.kind, 'eof');
assert.equal(session.snapshot().consumedThrough, 17);
assert.equal(data.length, 17);
assert.equal(data.at(-1), 'tail-17\u001b[3;7H');
assert.deepEqual(faults, []);
assert.equal(messages.filter(message => message.type === 'sourceEnd').length, 1);
console.log('PASS real adapter/channel/provider chain: chunked partial input, resize and stop at zero output credit, then tail consumption and resource settlement');
console.log('linux interaction chain tests passed (1 controlled case; fake OS boundary, no native load, PTY or socket)');
