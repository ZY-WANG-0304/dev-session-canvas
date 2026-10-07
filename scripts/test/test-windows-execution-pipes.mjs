import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import path from 'node:path';
import esbuild from 'esbuild';

const require = createRequire(import.meta.url);
const { outputFiles } = await esbuild.build({
  entryPoints: [path.resolve('extensions/vscode/dev-session-canvas/src/panel/windowsExecutionPipes.ts')],
  bundle: true, format: 'cjs', platform: 'node', target: 'node18', write: false
});
let active;
class ControlledSocket extends EventEmitter {
  constructor(options) {
    super();
    if (active.failSocket) throw new Error('controlled Socket construction');
    assert.equal(options.fd, 42);
    this.destroyed = false;
    active.socket = this;
  }
  write(bytes, callback) { active.writes.push(Buffer.from(bytes)); callback(); }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.emit('close');
  }
}
class ControlledWorker extends EventEmitter {
  constructor() {
    super();
    if (active.failWorker) throw new Error('controlled Worker construction');
    active.worker = this;
  }
  postMessage(message) { active.controls.push(message); }
  async terminate() { active.terminations++; this.emit('exit', 1); return 1; }
}
const module = { exports: {} };
new Function('require', 'module', 'exports', 'process', outputFiles[0].text)(name => {
  if (name === 'node:fs') return {
    openSync() { if (active.failOpen) throw new Error('controlled open failure'); return 42; },
    closeSync(fd) { assert.equal(fd, 42); active.descriptorsClosed++; }
  };
  if (name === 'node:net') return { Socket: ControlledSocket };
  if (name === 'node:worker_threads') return { Worker: ControlledWorker };
  return require(name);
}, module, module.exports, { ...process, platform: 'win32' });
const { createWindowsExecutionPipes } = module.exports;
const flush = async () => { for (let turn = 0; turn < 20; turn++) await Promise.resolve(); };
function harness(options = {}) {
  active = { controls: [], writes: [], terminations: 0, descriptorsClosed: 0, ...options };
  const state = active;
  state.pipes = createWindowsExecutionPipes({
    conin: '\\\\.\\pipe\\dsc-execution-owned-in', conout: '\\\\.\\pipe\\dsc-execution-owned-out', workerPath: '/verified-reader.js'
  });
  return state;
}

{
  const h = harness();
  let acknowledge;
  const consumed = [];
  const output = h.pipes.output(bytes => new Promise(resolve => { consumed.push(bytes); acknowledge = resolve; }));
  h.worker.emit('message', { type: 'ready' });
  await h.pipes.ready;
  h.worker.emit('message', { type: 'data', id: 1, bytes: Uint8Array.from([1, 2, 3]) });
  assert.equal(h.controls.length, 0);
  await h.pipes.write(Buffer.from('input'));
  assert.equal(h.writes[0].toString(), 'input');
  acknowledge();
  await flush();
  assert.deepEqual(h.controls, [{ type: 'ack', id: 1 }]);
  h.worker.emit('message', { type: 'source', disposition: { kind: 'eof' } });
  h.worker.emit('exit', 0);
  h.pipes.closeInput();
  assert.deepEqual(await output, { kind: 'eof' });
  assert.deepEqual(await h.pipes.closed, { input: true, source: true });
  assert.equal(h.terminations, 0);
}

{
  const h = harness();
  const output = h.pipes.output(async () => { throw new Error('controlled consumer failure'); });
  h.worker.emit('message', { type: 'ready' });
  await h.pipes.ready;
  h.worker.emit('message', { type: 'data', id: 1, bytes: Uint8Array.from([4]) });
  await assert.rejects(output, /controlled consumer failure/);
  assert.equal(h.terminations, 1);
  assert(h.socket.destroyed);
  assert.deepEqual(await h.pipes.closed, { input: true, source: true });
  assert(!h.controls.some(message => message.type === 'ack'), 'a failed consumer does not falsely ACK');
}

{
  const h = harness();
  let acknowledge;
  const output = h.pipes.output(() => new Promise(resolve => { acknowledge = resolve; }));
  h.worker.emit('message', { type: 'ready' });
  await h.pipes.ready;
  h.worker.emit('message', { type: 'data', id: 1, bytes: Uint8Array.from([5, 6, 7]) });
  h.socket.emit('error', Object.assign(new Error('controlled input EPIPE'), { code: 'EPIPE' }));
  assert.equal(h.terminations, 0, 'input EPIPE must not terminate a reader that can still deliver its tail');
  await assert.rejects(h.pipes.write(Buffer.from('later input')), /EPIPE|closed/);
  acknowledge();
  await flush();
  assert.deepEqual(h.controls, [{ type: 'ack', id: 1 }]);
  h.worker.emit('message', { type: 'source', disposition: { kind: 'eof' } });
  h.worker.emit('exit', 0);
  assert.deepEqual(await output, { kind: 'eof' });
  assert.deepEqual(await h.pipes.closed, { input: true, source: true });
}

for (const failure of ['failOpen', 'failSocket', 'failWorker']) {
  const h = harness({ [failure]: true });
  await assert.rejects(h.pipes.ready, /controlled/);
  await assert.rejects(h.pipes.output(async () => {}), /controlled/);
  assert.deepEqual(await h.pipes.closed, { input: true, source: true });
  assert.equal(h.pipes.acquired.input, failure === 'failWorker');
  assert.equal(h.pipes.acquired.source, false);
  assert.equal(h.descriptorsClosed, failure === 'failSocket' ? 1 : 0);
}

console.log('Windows pipe adapter: 6 controlled cases passed; no native pipes or worker threads.');
