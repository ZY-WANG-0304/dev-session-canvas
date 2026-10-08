import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { test } from 'node:test';
import esbuild from 'esbuild';

const require = createRequire(import.meta.url);
const build = await esbuild.build({
  stdin: { contents: `
    export { RuntimeSupervisorClient } from './extensions/vscode/dev-session-canvas/src/panel/runtimeSupervisorClient';
    export * from './extensions/vscode/dev-session-canvas/src/common/runtimeSupervisorProtocol';
  `, resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, platform: 'node', format: 'cjs', write: false
});
function load(clock, connect) {
  const module = { exports: {} };
  const controlledRequire = name => {
    if (clock && name === 'node:perf_hooks') return { performance: { now: () => clock.now } };
    if (connect && (name === 'net' || name === 'node:net')) return { ...net, createConnection: connect };
    return require(name);
  };
  new Function('require', 'module', 'exports', 'setTimeout', 'clearTimeout', build.outputFiles[0].text)(
    controlledRequire, module, module.exports, clock?.setTimeout ?? setTimeout, clock?.clearTimeout ?? clearTimeout);
  return module.exports;
}
const protocol = load();
const timeoutCode = 'DEV_SESSION_CANVAS_RUNTIME_SUPERVISOR_REQUEST_TIMEOUT';
const hello = { serverVersion: 1, pid: 1, runtimeBackend: 'legacy-detached', runtimeGuarantee: 'best-effort' };
const turns = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
class Clock {
  now = 0;
  timers = new Map();
  next = 0;
  setTimeout = (fn, ms) => { const id = ++this.next; this.timers.set(id, { at: this.now + ms, fn }); return id; };
  clearTimeout = id => { this.timers.delete(id); };
  advance(ms) {
    this.now += ms;
    for (const [id, timer] of [...this.timers]) {
      if (timer.at <= this.now && this.timers.delete(id)) timer.fn();
    }
  }
  scheduler = {
    now: () => this.now,
    scheduleTask: fn => this.setTimeout(fn, 0),
    scheduleDeadline: (deadline, fn) => {
      const id = this.setTimeout(fn, deadline - this.now);
      return () => this.clearTimeout(id);
    }
  };
}
class Socket extends EventEmitter {
  destroyed = false;
  messages = [];
  respond = request => { if (request.method === 'hello') this.reply(request, hello); };
  setEncoding() {}
  write(line) { const request = JSON.parse(line); this.messages.push(request); this.respond(request); return true; }
  reply(request, result, error) {
    this.emit('data', JSON.stringify({ type: 'response', id: request.id, ok: !error, result, error }) + '\n');
  }
  destroy() { if (!this.destroyed) { this.destroyed = true; this.emit('close'); } }
}
function options(extra = {}) {
  return { backend: { paths: { socketPath: '/unused' }, startSupervisor: () => assert.fail('Unexpected restart') },
    supervisorScriptPath: '/unused', supervisorLauncherScriptPath: '/unused', ...extra };
}
async function fixture(t) {
  const clock = new Clock();
  const socket = new Socket();
  const { RuntimeSupervisorClient } = load(clock);
  const client = new RuntimeSupervisorClient(options());
  t.after(() => { client.dispose(); assert.equal(clock.timers.size, 0); });
  client.attachSocket(socket);
  await client.ensureConnected();
  return { client, socket, clock };
}
function assertUnknown(error, method) {
  assert.equal(error.code, timeoutCode);
  assert.equal(error.descriptor.id, 'clientRequestTimeout');
  assert.equal(error.descriptor.params.method, method);
  assert.match(error.message, /may already have occurred.*unknown.*not automatically retried/);
  const restored = protocol.createRuntimeSupervisorError(protocol.serializeRuntimeSupervisorError(error));
  assert.equal(restored.code, timeoutCode);
  assert.deepEqual(protocol.getRuntimeSupervisorErrorDescriptor(restored), error.descriptor);
  return true;
}

for (const method of ['getSessionSnapshot', 'createSession', 'writeInput', 'resizeSession', 'stopSession', 'deleteSession']) {
  test(`${method} expires with an unknown result and is sent once despite unrelated output`, async t => {
    const { client, socket, clock } = await fixture(t);
    const result = client[method]({ sessionId: method, data: 'effect', cols: 80, rows: 24 });
    const rejected = assert.rejects(result, error => assertUnknown(error, method));
    await turns();
    clock.advance(14_999);
    socket.emit('data', JSON.stringify({ type: 'event', event: 'sessionOutput', payload: {} }) + '\n');
    assert.equal(client.pendingRequests.size, 1);
    clock.advance(1);
    assert.equal(client.pendingRequests.size, 0, 'The expired ordinary request must release its pending entry.');
    await rejected;
    assert.equal(client.hasPendingRequests(), false);
    assert.equal(clock.timers.size, 0);
    assert.equal(socket.destroyed, false);
    socket.reply(socket.messages.at(-1), { ok: true });
    assert.equal(client.pendingRequests.size, 0);
    assert.equal(socket.messages.filter(request => request.method === method).length, 1);
  });
}

for (const outcome of ['success', 'error', 'write-error', 'disconnect', 'replacement', 'dispose']) {
  test(`${outcome} clears request timers before the deadline`, async t => {
    const { client, socket, clock } = await fixture(t);
    if (outcome === 'write-error') socket.respond = () => { throw new Error('write failed'); };
    const result = client.writeInput({ sessionId: 's', data: 'x' });
    const settled = outcome === 'success' ? result : assert.rejects(result);
    await turns();
    if (outcome === 'success') socket.reply(socket.messages.at(-1), { ok: true });
    if (outcome === 'error') socket.reply(socket.messages.at(-1), undefined, { message: 'rejected', code: 'REJECTED' });
    if (outcome === 'disconnect') socket.destroy();
    if (outcome === 'replacement') client.attachSocket(new Socket());
    if (outcome === 'dispose') client.dispose();
    await settled;
    assert.equal(client.pendingRequests.size, 0);
    assert.equal(clock.timers.size, 0);
    clock.advance(20_000);
  });
}

test('response at the deadline cannot beat a delayed timer or become a server rejection', async t => {
  const { client, socket, clock } = await fixture(t);
  for (const ok of [true, false]) {
    let responseCallbacks = 0;
    const result = client.requestOnConnectedSocket('deleteSession', {}, socket,
      () => responseCallbacks++, () => responseCallbacks++);
    const rejected = assert.rejects(result, error => assertUnknown(error, 'deleteSession'));
    clock.now += 15_000; // Deliberately do not dispatch the timer.
    socket.reply(socket.messages.at(-1), {}, ok ? undefined : { message: 'missing', code: 'DEV_SESSION_CANVAS_RUNTIME_SESSION_NOT_FOUND' });
    await rejected;
    assert.equal(responseCallbacks, 0);
    assert.equal(clock.timers.size, 0);
  }
});

test('one request timeout does not release another request or poison a healthy connection', async t => {
  const { client, socket, clock } = await fixture(t);
  const first = client.writeInput({ sessionId: 's', data: 'one' });
  const rejected = assert.rejects(first, error => assertUnknown(error, 'writeInput'));
  await turns();
  const old = socket.messages.at(-1);
  clock.advance(1000);
  const second = client.getSessionSnapshot({ sessionId: 's' });
  await turns();
  const current = socket.messages.at(-1);
  clock.advance(14_000);
  await rejected;
  assert.equal(client.pendingRequests.size, 1);
  socket.reply(old, { wrong: true });
  socket.reply(current, { sessionId: 's' });
  assert.deepEqual(await second, { sessionId: 's' });
  assert.equal(clock.timers.size, 0);
});

test('hello timeout releases concurrent callers, never restarts the peer, and permits an explicit fresh connection', async t => {
  const clock = new Clock();
  const sockets = [];
  const { RuntimeSupervisorClient } = load(clock, () => {
    const socket = new Socket();
    if (sockets.length === 0) socket.respond = () => {};
    sockets.push(socket);
    queueMicrotask(() => socket.emit('connect'));
    return socket;
  });
  let disconnected = 0;
  const client = new RuntimeSupervisorClient(options({ onDisconnected: () => disconnected++ }));
  t.after(() => client.dispose());
  const results = [client.ensureConnected(), client.ensureConnected()].map(result =>
    assert.rejects(result, error => assertUnknown(error, 'hello')));
  await turns();
  clock.advance(5000);
  await Promise.all(results);
  assert.equal(sockets.length, 1);
  assert.equal(sockets[0].destroyed, true);
  assert.equal(disconnected, 1);
  assert.equal(client.connectPromise, undefined);
  assert.equal(clock.timers.size, 0);
  await client.ensureConnected();
  assert.equal(sockets.length, 2);
  sockets[0].reply(sockets[0].messages[0], { ...hello, pid: 999 });
  assert.equal((await client.hello()).pid, 1);
  assert.equal(clock.timers.size, 0);
});

test('ready gives a late connection only its remaining hello budget', async t => {
  const clock = new Clock();
  const socket = new Socket();
  socket.respond = () => {};
  const { RuntimeSupervisorClient } = load(clock, () => socket);
  const client = new RuntimeSupervisorClient(options());
  t.after(() => client.dispose());
  const rejected = assert.rejects(client.waitForSupervisorReady(), error => assertUnknown(error, 'hello'));
  clock.advance(4000);
  socket.emit('connect');
  await turns();
  assert.equal(socket.messages[0].method, 'hello');
  clock.advance(1000);
  await rejected;
  assert.equal(clock.now, 5000);
  assert.equal(clock.timers.size, 0);
});

for (const action of ['timeout', 'dispose']) test(`a pending connection cleans up on ${action} and cannot attach later`, async t => {
  const clock = new Clock();
  const socket = new Socket();
  const { RuntimeSupervisorClient } = load(clock, () => socket);
  const client = new RuntimeSupervisorClient(options());
  t.after(() => client.dispose());
  const rejected = assert.rejects(client.ensureConnected(), { code: action === 'timeout'
    ? 'DEV_SESSION_CANVAS_RUNTIME_SUPERVISOR_READY_TIMEOUT' : 'DEV_SESSION_CANVAS_RUNTIME_SUPERVISOR_CLIENT_DISPOSED' });
  if (action === 'timeout') clock.advance(5000);
  else client.dispose();
  await rejected;
  assert.equal(socket.destroyed, true);
  socket.emit('connect');
  assert.equal(client.socket, undefined);
  assert.equal(clock.timers.size, 0);
});

test('strict deletion retains late evidence even beyond the ordinary RPC timeout', async t => {
  const { client, socket, clock } = await fixture(t);
  const observation = client.deleteSessionStrict({ sessionId: 'strict' }, { deadline: 20, scheduler: clock.scheduler });
  clock.advance(20);
  const first = await observation.first;
  assert.equal(first.kind, 'unconfirmed');
  clock.advance(30_000);
  assert.equal(client.pendingRequests.size, 1);
  assert.equal(observation.attemptSettled, false);
  assert.strictEqual(client.deleteSessionStrict({ sessionId: 'strict' },
    { deadline: clock.now + 100, scheduler: clock.scheduler }), observation);
  socket.reply(socket.messages.at(-1), { ok: true });
  await turns();
  assert.equal(observation.current().kind, 'legacy-acknowledged');
  assert.strictEqual(await observation.first, first);
  assert.equal(socket.messages.filter(request => request.method === 'deleteSession').length, 1);
});

test('an unknown output ACK is not resubmitted as cancellation', async t => {
  const { client, socket, clock } = await fixture(t);
  client.options.onSessionTerminalBatch = async () => 'consumed';
  client.hostOutputSubscriptions.set('s', { socket, sessionId: 's', authorityId: 'a', subscriptionId: 'sub',
    revision: 0, batchId: 0, consuming: false });
  const operation = client.consumeTerminalBatch({ sessionId: 's', authorityId: 'a', subscriptionId: 'sub',
    batchId: 1, afterRevision: 0, revision: 0, events: [] }, socket);
  await turns();
  clock.advance(15_000);
  await operation;
  const requests = socket.messages.filter(request => request.method === 'ackTerminalBatch');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].params.outcome, 'consumed');
  assert.equal(socket.destroyed, true);
  assert.equal(client.hasPendingRequests(), false);
});

for (const mode of ['hello', 'ready', 'writeInput']) {
  test(`real socket: silent ${mode} has a finite wait and no automatic replay`, { timeout: 25_000 }, async t => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'dsc-rpc-'));
    const socketPath = process.platform === 'win32' ? `\\\\.\\pipe\\dsc-rpc-${path.basename(dir)}` : path.join(dir, 's');
    const sockets = new Set();
    const requests = [];
    const server = net.createServer(socket => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
      socket.on('error', () => {});
      let buffer = '';
      socket.setEncoding('utf8');
      socket.on('data', chunk => {
        buffer += chunk;
        while (buffer.includes('\n')) {
          const newline = buffer.indexOf('\n');
          const request = JSON.parse(buffer.slice(0, newline));
          buffer = buffer.slice(newline + 1);
          requests.push(request);
          if (mode === 'writeInput' && request.method === 'hello') {
            socket.write(JSON.stringify({ type: 'response', id: request.id, ok: true, result: hello }) + '\n');
          }
        }
      });
    });
    const listen = async () => { server.listen(socketPath); await once(server, 'listening'); };
    let starts = 0;
    const client = new protocol.RuntimeSupervisorClient(options({ backend: { paths: { socketPath },
      startSupervisor: async () => { starts++; await listen(); } } }));
    t.after(async () => {
      client.dispose();
      for (const socket of sockets) socket.destroy();
      if (server.listening) await new Promise(resolve => server.close(resolve));
      await rm(dir, { recursive: true, force: true });
    });
    if (mode !== 'ready') await listen();
    if (mode === 'writeInput') await client.ensureConnected();
    const start = performance.now();
    await assert.rejects(mode === 'writeInput'
      ? client.writeInput({ sessionId: 's', data: 'side effect' }) : client.ensureConnected(),
    error => assertUnknown(error, mode === 'writeInput' ? mode : 'hello'));
    const elapsed = performance.now() - start;
    const expected = mode === 'writeInput' ? 15_000 : 5000;
    assert.ok(elapsed >= expected - 100 && elapsed < expected + 3000, `elapsed ${elapsed}ms`);
    assert.equal(client.pendingRequests.size, 0);
    assert.equal(client.connectPromise, undefined);
    assert.equal(starts, mode === 'ready' ? 1 : 0);
    assert.equal(requests.filter(request => request.method === (mode === 'writeInput' ? mode : 'hello')).length, 1);
  });
}
