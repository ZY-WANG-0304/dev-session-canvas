import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import esbuild from 'esbuild';

const require = createRequire(import.meta.url);
const build = await esbuild.build({
  stdin: { contents: `
    export { RuntimeSupervisorClient } from './extensions/vscode/dev-session-canvas/src/panel/runtimeSupervisorClient';
    export { normalizeTerminalStreamRead, normalizeTerminalReadOutcome } from './extensions/vscode/dev-session-canvas/src/common/terminalStreamPaging';
  `, resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, platform: 'node', format: 'cjs', write: false
});
let forbiddenAcquisitions = 0;
const forbidden = () => { forbiddenAcquisitions++; assert.fail('No network, native or child acquisition is permitted'); };
const guardedRequire = name => {
  if (name === 'net' || name === 'node:net') return { ...require(name), createConnection: forbidden, createServer: forbidden };
  if (name === 'node-pty') return { spawn: forbidden };
  if (name === 'child_process' || name === 'node:child_process') return {
    spawn: forbidden, spawnSync: forbidden, fork: forbidden, exec: forbidden, execFile: forbidden,
    execSync: forbidden, execFileSync: forbidden
  };
  return require(name);
};
const loaded = { exports: {} };
new Function('require', 'module', 'exports', build.outputFiles[0].text)(guardedRequire, loaded, loaded.exports);
const { RuntimeSupervisorClient, normalizeTerminalStreamRead, normalizeTerminalReadOutcome } = loaded.exports;

const hello = { serverVersion: 1, pid: 123, runtimeBackend: 'legacy-detached', runtimeGuarantee: 'best-effort',
  capabilities: { terminalPagedReadV1: true, terminalPagedCompletionV1: true, terminalReadSettlementV1: true } };
let nextReadId = 0;
function descriptor(params, mode = params.settlementMode) {
  return { sessionId: params.sessionId, authorityId: params.authorityId, readId: `read-${++nextReadId}`,
    headRevision: 0, ...(mode === undefined ? {} : { settlementMode: mode }),
    checkpoint: { version: 1, sessionId: params.sessionId, authorityId: params.authorityId, revision: 0,
      cols: 80, rows: 24, scrollback: 100, createdAtMs: 1,
      serializedState: { format: 'xterm-serialize-v1', data: '', outputSequence: 0 } } };
}
const openParams = { sessionId: 'session', authorityId: 'authority', consumerId: 'editor',
  settlementMode: 'final-application-v1' };
const closeParams = read => ({ sessionId: read.sessionId, authorityId: read.authorityId, readId: read.readId,
  outcome: { kind: 'applied', finalRevision: 0 } });

class ControlledSocket extends EventEmitter {
  destroyed = false;
  messages = [];
  closed = new Set();
  respond = request => {
    if (request.method === 'hello') return hello;
    if (request.method === 'openTerminalRead') return descriptor(request.params);
    if (request.method === 'readTerminalPage') return { ...request.params, revision: 0, headRevision: 0, events: [] };
    if (request.method === 'closeTerminalRead') {
      if (!request.params.outcome) return { ok: true };
      const duplicate = this.closed.has(request.params.readId);
      this.closed.add(request.params.readId);
      return { ok: true, settlement: duplicate ? 'duplicate' : 'recorded' };
    }
    throw new Error(`Unexpected request ${request.method}`);
  };
  setEncoding() {}
  write(line) {
    const request = JSON.parse(line);
    this.messages.push(request);
    const result = this.respond(request);
    if (result !== undefined) queueMicrotask(() => this.reply(request, result));
    return true;
  }
  reply(request, result) { this.emit('data', `${JSON.stringify({ type: 'response', id: request.id, ok: true, result })}\n`); }
  destroy() { this.destroyed = true; this.emit('close'); }
}

const clients = [];
async function fixture(socket = new ControlledSocket()) {
  const disconnected = [];
  const client = new RuntimeSupervisorClient({ backend: { startSupervisor: forbidden },
    onDisconnected: error => disconnected.push(error), supervisorScriptPath: '/never', supervisorLauncherScriptPath: '/never' });
  clients.push(client);
  client.attachSocket(socket);
  await client.performHelloHandshake();
  return { client, socket, disconnected };
}
async function turns(count = 3) { for (let turn = 0; turn < count; turn++) await Promise.resolve(); }
const tests = [];
const test = (name, run) => tests.push({ name, run });

test('read descriptors and outcomes retain only valid settlement values', () => {
  const read = descriptor(openParams);
  assert.equal(normalizeTerminalStreamRead(read).settlementMode, 'final-application-v1');
  assert.equal(normalizeTerminalStreamRead({ ...read, settlementMode: 'future' }), undefined);
  assert.deepEqual(normalizeTerminalReadOutcome({ kind: 'applied', finalRevision: 0 }), { kind: 'applied', finalRevision: 0 });
  for (const value of [null, { kind: 'applied', finalRevision: -1 }, { kind: 'applied', finalRevision: 0.5 },
    { kind: 'applied', finalRevision: Number.MAX_SAFE_INTEGER + 1 }, { kind: 'lost' },
    { kind: 'cancelled', reason: '' }, { kind: 'cancelled', reason: 'x'.repeat(1025) }]) {
    assert.equal(normalizeTerminalReadOutcome(value), undefined);
  }
  assert.deepEqual(normalizeTerminalReadOutcome({ kind: 'cancelled', reason: 'surface disposed' }),
    { kind: 'cancelled', reason: 'surface disposed' });
});

test('hello capability is required before opt-in open; legacy open and close remain available', async () => {
  const socket = new ControlledSocket();
  const respond = socket.respond;
  socket.respond = request => request.method === 'hello' ? { ...hello, capabilities: { terminalPagedReadV1: true } } : respond(request);
  const { client } = await fixture(socket);
  assert.equal(client.supportsTerminalReadSettlement(), false);
  await assert.rejects(client.openTerminalRead(openParams), /capability/);
  assert.equal(socket.messages.length, 1);
  const read = await client.openTerminalRead({ ...openParams, settlementMode: undefined });
  assert.equal(read.settlementMode, undefined);
  assert.deepEqual(await client.closeTerminalRead({ ...closeParams(read), outcome: undefined }), { ok: true });
  socket.destroy();
  assert.deepEqual(await client.closeTerminalRead({ ...closeParams(read), outcome: undefined }), { ok: true });
});

test('negotiated reader uses actual request responses and preserves explicit receipt outcomes', async () => {
  const { client, socket } = await fixture();
  assert.equal(client.supportsTerminalReadSettlement(), true);
  const read = await client.openTerminalRead(openParams);
  assert.equal(read.settlementMode, 'final-application-v1');
  assert.equal((await client.readTerminalPage({ ...read, afterRevision: 0 })).revision, 0);
  assert.deepEqual(await client.closeTerminalRead(closeParams(read)), { ok: true, settlement: 'recorded' });
  assert.deepEqual(await client.closeTerminalRead(closeParams(read)), { ok: true, settlement: 'duplicate' });
  assert.deepEqual(socket.messages.at(-1).params.outcome, { kind: 'applied', finalRevision: 0 });
  await assert.rejects(client.readTerminalPage({ ...read, afterRevision: 0 }), /already closed/);
});

test('settlement capability cannot replace the required paged completion capability', async () => {
  const socket = new ControlledSocket();
  const respond = socket.respond;
  socket.respond = request => request.method === 'hello' ? { ...hello,
    capabilities: { terminalPagedReadV1: true, terminalReadSettlementV1: true } } : respond(request);
  const { client } = await fixture(socket);
  assert.equal(client.supportsTerminalPagedRead(), true);
  assert.equal(client.supportsTerminalPagedCompletion(), false);
  assert.equal(client.supportsTerminalReadSettlement(), false);
  await assert.rejects(client.openTerminalRead(openParams), /capability/);
  assert.equal(socket.messages.length, 1, 'missing completion capability refuses before sending open');
});

test('missing open echo cannot silently downgrade an opted-in reader', async () => {
  const socket = new ControlledSocket();
  const respond = socket.respond;
  socket.respond = request => request.method === 'openTerminalRead'
    ? descriptor({ ...request.params, settlementMode: undefined }) : respond(request);
  const { client } = await fixture(socket);
  await assert.rejects(client.openTerminalRead(openParams), /not negotiated/);
  await turns();
  assert.equal(client.terminalReadConnections.size, 0);
  assert.equal(socket.messages.at(-1).method, 'closeTerminalRead');
  assert.equal(socket.messages.at(-1).params.outcome, undefined, 'cleanup must not claim unnegotiated application');
});

test('lost negotiated reader cannot reconnect or settle on a later socket', async () => {
  const { client, socket } = await fixture();
  const read = await client.openTerminalRead(openParams);
  socket.destroy();
  await assert.rejects(client.readTerminalPage({ ...read, afterRevision: 0 }), /connection/);
  const next = new ControlledSocket();
  client.attachSocket(next);
  await client.performHelloHandshake();
  assert.deepEqual(await client.closeTerminalRead(closeParams(read)), { ok: true, settlement: 'unconfirmed' });
  assert.equal(next.messages.length, 1, 'old outcome must not be written to the new socket');
  await assert.rejects(client.readTerminalPage({ ...read, afterRevision: 0 }), /connection/);
});

test('old socket data, close and error cannot affect the new connection or its pending requests', async () => {
  const { client, socket, disconnected } = await fixture();
  const next = new ControlledSocket();
  client.attachSocket(next);
  await client.performHelloHandshake();
  next.respond = () => undefined;
  const opening = client.openTerminalRead(openParams);
  await turns();
  const request = next.messages.at(-1);
  socket.emit('data', '{');
  socket.reply(request, descriptor(openParams));
  socket.emit('close');
  socket.emit('error', new Error('late old socket error'));
  assert.equal(client.socket, next);
  assert.equal(client.supportsTerminalReadSettlement(), true);
  assert.equal(client.pendingRequests.size, 1);
  assert.equal(disconnected.length, 0);
  const result = descriptor(openParams);
  next.reply(request, result);
  assert.equal((await opening).readId, result.readId);
  assert.equal(client.pendingRequests.size, 0);
});

test('replacing a connection rejects only its old pending requests', async () => {
  const { client, socket } = await fixture();
  socket.respond = () => undefined;
  const opening = client.openTerminalRead(openParams);
  const rejected = assert.rejects(opening, /replaced/);
  await turns();
  const next = new ControlledSocket();
  client.attachSocket(next);
  await client.performHelloHandshake();
  await rejected;
  assert.equal(client.terminalReadConnections.size, 0);
  assert.equal((await client.openTerminalRead(openParams)).settlementMode, 'final-application-v1');
});

test('a hello response cannot commit capabilities after its connection was replaced', async () => {
  const { client, socket } = await fixture();
  socket.respond = () => undefined;
  const handshake = client.performHelloHandshake();
  const rejected = assert.rejects(handshake, /changed during handshake/);
  socket.reply(socket.messages.at(-1), hello);
  const next = new ControlledSocket();
  client.attachSocket(next);
  await rejected;
  assert.equal(client.helloResult, undefined);
  await client.performHelloHandshake();
  assert.equal(client.supportsTerminalReadSettlement(), true);
});

test('an open response cannot bind its reader to a replacement connection', async () => {
  const { client, socket } = await fixture();
  socket.respond = () => undefined;
  const opening = client.openTerminalRead(openParams);
  const rejected = assert.rejects(opening, /changed while opening/);
  await turns();
  socket.reply(socket.messages.at(-1), descriptor(openParams));
  client.attachSocket(new ControlledSocket());
  await rejected;
  assert.equal(client.terminalReadConnections.size, 0);
});

test('a write exception removes its pending request without reporting settlement', async () => {
  const { client, socket } = await fixture();
  const read = await client.openTerminalRead(openParams);
  socket.write = () => { throw new Error('controlled write failure'); };
  await assert.rejects(client.closeTerminalRead(closeParams(read)), /controlled write failure/);
  assert.equal(client.pendingRequests.size, 0);
  assert.equal(client.terminalReadConnections.get(read.readId).closed, false);
});

test('legacy-shaped close response cannot confirm an explicit settlement', async () => {
  const { client, socket } = await fixture();
  const read = await client.openTerminalRead(openParams);
  socket.respond = () => ({ ok: true });
  await assert.rejects(client.closeTerminalRead(closeParams(read)), /Invalid terminal reader settlement response/);
  assert.equal(client.terminalReadConnections.get(read.readId).closed, false);
});

test('closed reader connection bindings are bounded without evicting an active surface', async () => {
  const { client } = await fixture();
  const active = await client.openTerminalRead({ ...openParams, consumerId: 'panel' });
  for (let count = 0; count < 130; count++) {
    const read = await client.openTerminalRead(openParams);
    await client.closeTerminalRead(closeParams(read));
  }
  assert.equal(client.terminalReadConnections.size, 129);
  assert.equal(client.terminalReadConnections.get(active.readId).closed, false);
  assert.equal((await client.readTerminalPage({ ...active, afterRevision: 0 })).revision, 0);
});

try {
  for (const { name, run } of tests) {
    let timeout;
    try {
      await Promise.race([run(), new Promise((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(`${name}: exceeded 3000 ms`)), 3000);
      })]);
    } finally { clearTimeout(timeout); }
    console.log(`PASS ${name}`);
  }
  assert.equal(forbiddenAcquisitions, 0);
  console.log(`Runtime supervisor reader client: ${tests.length}/${tests.length} non-native cases passed`);
} finally {
  for (const client of clients) client.dispose();
}
