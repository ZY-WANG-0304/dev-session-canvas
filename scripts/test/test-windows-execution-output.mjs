import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import esbuild from 'esbuild';

const { outputFiles } = await esbuild.build({
  entryPoints: [path.resolve('extensions/vscode/dev-session-canvas/src/panel/windowsExecutionOutput.ts')],
  bundle: true, format: 'cjs', platform: 'node', target: 'node18', write: false
});
const module = { exports: {} };
new Function('require', 'module', 'exports', outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { attachWindowsOutputReader } = module.exports;
const turn = () => new Promise(resolve => setImmediate(resolve));

function harness() {
  const socket = new PassThrough({ highWaterMark: 4096 });
  const messages = [];
  let closed = false;
  const reader = attachWindowsOutputReader(socket, value => messages.push(value), () => { closed = true; });
  socket.emit('connect');
  return { socket, messages, reader, get closed() { return closed; } };
}

{
  const h = harness();
  const bytes = Buffer.alloc(20000, 7);
  h.socket.end(bytes);
  await turn();
  assert.equal(h.messages.filter(message => message.type === 'data').length, 1);
  const received = [];
  for (let id = 1; id <= 5; id++) {
    const message = h.messages.find(value => value.type === 'data' && value.id === id);
    assert(message);
    assert(message.bytes.length <= 4096);
    received.push(message.bytes);
    h.reader.acknowledge(id);
    await turn();
  }
  assert(Buffer.concat(received).equals(bytes));
  assert.deepEqual(h.messages.at(-1), { type: 'source', disposition: { kind: 'eof' } });
  assert(h.closed);
}

{
  const h = harness();
  const bytes = Buffer.alloc(17000, 4);
  h.socket.write(bytes);
  await turn();
  h.reader.cancel('controlled cancellation');
  await turn();
  assert.equal(h.messages.filter(message => message.type === 'data').length, 1,
    'cancellation does not bypass the in-flight delivery');
  const received = [];
  for (let id = 1; id <= 5; id++) {
    const message = h.messages.find(value => value.type === 'data' && value.id === id);
    assert(message);
    received.push(message.bytes);
    h.reader.acknowledge(id);
    await turn();
  }
  assert(Buffer.concat(received).equals(bytes), 'all bytes already owned at cancel must be delivered');
  assert.equal(h.messages.at(-1).disposition.kind, 'interrupted');
  assert(h.closed);
}

{
  const h = harness();
  h.socket.destroy();
  await turn();
  assert.equal(h.messages.at(-1).disposition.kind, 'interrupted');
  assert(h.closed);
}

{
  const h = harness();
  h.socket.destroy(new Error('controlled read failure'));
  await turn();
  assert.equal(h.messages.at(-1).disposition.kind, 'error');
  assert(h.closed);
}

console.log('Windows output reader: 4 controlled stream cases passed; no Windows native calls.');
