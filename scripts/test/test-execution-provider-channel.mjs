import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import path from 'node:path';

import esbuild from 'esbuild';

const { outputFiles } = await esbuild.build({
  entryPoints: [path.resolve('extensions/vscode/dev-session-canvas/src/panel/executionProviderChannel.ts')],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  write: false
});

const tasks = [];
const messages = [];
const commands = [];
const faults = [];
const observations = [];
let socket;
let heldSend;
let heldOperationId;
let disconnectCount = 0;
let ownerLossCount = 0;

class ControlledSocket extends EventEmitter {
  writes = [];
  destroyed = false;
  closed = false;
  endCallback;
  writeCallback;

  constructor(options) {
    super();
    assert.deepEqual(options, { fd: 4, readable: false, writable: true });
    assert.equal(socket, undefined, 'the test must not acquire a second output socket');
    socket = this;
  }

  write(bytes, callback) {
    assert.equal(this.writeCallback, undefined);
    this.writes.push(Uint8Array.from(bytes));
    this.writeCallback = callback;
    return true;
  }

  end(callback) {
    assert.equal(this.endCallback, undefined);
    this.endCallback = callback;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    tasks.push(() => {
      this.closed = true;
      this.emit('close');
    });
  }
}

const providerProcess = new EventEmitter();
providerProcess.platform = 'linux';
providerProcess.connected = true;
providerProcess.send = (message, callback) => {
  messages.push(message);
  if (message.operationId === heldOperationId && heldOperationId !== undefined) {
    assert.equal(heldSend, undefined);
    heldSend = callback;
  } else {
    tasks.push(() => callback(null));
  }
  return true;
};
providerProcess.disconnect = () => {
  disconnectCount += 1;
  providerProcess.connected = false;
  tasks.push(() => providerProcess.emit('disconnect'));
};

// Substitute only Node handles; all lifecycle and credit decisions run in the real module.
const module = { exports: {} };
new Function('require', 'module', 'exports', 'process', outputFiles[0].text)(
  (specifier) => {
    assert.equal(specifier, 'node:net');
    return { Socket: ControlledSocket };
  }, module, module.exports, providerProcess
);

function observe(promise) {
  const result = { state: 'pending', error: undefined };
  result.done = promise.then(() => { result.state = 'fulfilled'; }, (error) => {
    result.state = 'rejected';
    result.error = error;
  });
  return result;
}

async function flush() {
  let idle = 0;
  for (let turn = 0; turn < 100; turn += 1) {
    const task = tasks.shift();
    task?.();
    await Promise.resolve();
    await Promise.resolve();
    idle = !task && tasks.length === 0 ? idle + 1 : 0;
    if (idle === 4) return;
  }
  assert.fail('channel continuations did not settle within the bounded task queue');
}

const identity = { executionId: 'channel-close-regression', generation: 'binding-1' };
const channel = module.exports.createExecutionProviderChannel(identity, {
  onCommand(command) {
    commands.push(command);
    if (command.type !== 'start') {
      observations.push(observe(channel.send({
        type: 'operationObservation', identity, operationId: command.operationId,
        result: { kind: 'accepted' }
      })));
    }
  },
  onFault: (reason) => faults.push(reason),
  onOwnerLost: () => { ownerLossCount += 1; }
});

const ready = observe(channel.ready());
await flush();
assert.equal(ready.state, 'fulfilled');
providerProcess.emit('message', {
  type: 'start', identity, operationId: 'start-1', spec: { file: 'fixture', args: [] }
});

const write = observe(channel.write('owned-tail'));
const end = observe(channel.end({ kind: 'eof' }));
const closePromise = channel.close();
const close = observe(closePromise);
assert.equal(channel.close(), closePromise);
await assert.rejects(channel.write('second-write'), /Only one provider write/);

providerProcess.emit('message', {
  type: 'requestStop', identity, operationId: 'stop-graceful', mode: 'graceful'
});
providerProcess.emit('message', {
  type: 'cancelOutput', identity, operationId: 'cancel-1', reason: 'stop new backend reads'
});
await flush();
assert.deepEqual(faults, []);
assert.deepEqual(commands.map((command) => command.operationId), ['start-1', 'stop-graceful', 'cancel-1']);
assert.ok(observations.every((result) => result.state === 'fulfilled'));
assert.equal(write.state, 'pending');
assert.equal(end.state, 'pending');
assert.equal(close.state, 'pending');
assert.equal(socket.destroyed, false, 'control requests must not discard an owned write');

socket.writeCallback(null);
await flush();
assert.equal(write.state, 'fulfilled');
await assert.rejects(channel.write('after-end'), /after start and before end/);
assert.equal(end.state, 'pending', 'source end must await acceptance of the final frame');
assert.equal(messages.some((message) => message.type === 'sourceEnd'), false);
providerProcess.emit('message', { type: 'accepted', identity, throughFrameId: 1 });
await flush();
assert.equal(end.state, 'fulfilled');
assert.equal(channel.snapshot().consumedThrough, 0, 'source end must not require consumption');
assert.equal(messages.find((message) => message.type === 'sourceEnd')?.finalFrameId, 1);
assert.equal(typeof socket.endCallback, 'function');
assert.equal(disconnectCount, 0);

heldOperationId = 'stop-force';
providerProcess.emit('message', {
  type: 'requestStop', identity, operationId: heldOperationId, mode: 'force'
});
await flush();
assert.equal(typeof heldSend, 'function');
socket.endCallback();
await flush();
assert.equal(socket.closed, true);
assert.equal(close.state, 'pending');
assert.equal(disconnectCount, 0, 'socket close must not overtake an in-flight control response');
assert.deepEqual(faults, []);

heldSend(null);
await flush();
assert.ok(observations.every((result) => result.state === 'fulfilled'));
assert.equal(close.state, 'fulfilled', close.error?.stack);
assert.equal(channel.snapshot().closed, true);
assert.equal(disconnectCount, 1);
assert.equal(ownerLossCount, 0);
assert.equal(socket.writes.length, 1);
assert.deepEqual(faults, []);
for (const event of ['message', 'disconnect', 'error']) {
  assert.equal(providerProcess.listenerCount(event), 0, `${event} listener must be released`);
}
console.log('ok - end/close preserves owned output and drains concurrent control responses');
