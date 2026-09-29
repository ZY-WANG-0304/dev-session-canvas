import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import path from 'node:path';
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
let controlledConnect;
const forbidden = () => { forbiddenAcquisitions++; assert.fail('No network, native or child acquisition is permitted'); };
const guardedRequire = name => {
  if (name === 'net' || name === 'node:net') return { ...require(name),
    createConnection: (...args) => controlledConnect ? controlledConnect(...args) : forbidden(), createServer: forbidden };
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
async function fixture(socket = new ControlledSocket(), options = {}) {
  const disconnected = [];
  const client = new RuntimeSupervisorClient({ backend: { startSupervisor: forbidden },
    onDisconnected: error => disconnected.push(error), supervisorScriptPath: '/never', supervisorLauncherScriptPath: '/never', ...options });
  clients.push(client);
  client.attachSocket(socket);
  await client.performHelloHandshake();
  return { client, socket, disconnected };
}
async function turns(count = 3) { for (let turn = 0; turn < count; turn++) await Promise.resolve(); }
const tests = [];
const test = (name, run) => tests.push({ name, run });

const candidateProfile = 'linux-owner-v1-candidate';
const candidateHello = { ...hello, capabilities: { ...hello.capabilities, executionCandidateProfiles: [candidateProfile] } };
const candidateStorageDir = path.resolve('controlled-only/runtime-supervisor-generations/terminal-exit-v1/runtime-supervisor');
function startupClient({ executionProfile = candidateProfile, storageDir = candidateStorageDir, startSupervisor = forbidden } = {}) {
  const client = new RuntimeSupervisorClient({
    backend: { paths: { storageDir, socketPath: '/controlled-only' }, startSupervisor },
    ...(executionProfile === null ? {} : { executionProfile }),
    supervisorScriptPath: '/supervisor', supervisorLauncherScriptPath: '/launcher'
  });
  clients.push(client);
  return client;
}

test('startup profile and generation reject before any connection or process acquisition', () => {
  for (const executionProfile of ['', 'unknown-profile']) {
    assert.throws(() => startupClient({ executionProfile }), /Unsupported execution candidate profile/);
  }
  for (const storageDir of [path.resolve('old/runtime-supervisor'), candidateStorageDir.replace('terminal-exit-v1', 'terminal-stream-v1')]) {
    assert.throws(() => startupClient({ storageDir }), /isolated/);
  }
});

test('connection preparation forwards the selected profile once; stock startup arguments remain unchanged', async () => {
  for (const executionProfile of [candidateProfile, null]) {
    let connects = 0;
    const starts = [];
    const socket = new ControlledSocket();
    socket.respond = request => request.method === 'hello' ? candidateHello : { sessionId: 'new-session', live: true };
    controlledConnect = () => {
      connects++;
      if (connects === 1) {
        const absent = new ControlledSocket();
        queueMicrotask(() => absent.emit('error', Object.assign(new Error('endpoint absent'), { code: 'ENOENT' })));
        return absent;
      }
      queueMicrotask(() => socket.emit('connect'));
      return socket;
    };
    const client = startupClient({ executionProfile, startSupervisor: async args => starts.push(args) });
    try {
      await Promise.all([client.ensureConnected(), client.ensureConnected()]);
      assert.deepEqual(starts, [{ supervisorScriptPath: '/supervisor', supervisorLauncherScriptPath: '/launcher',
        ...(executionProfile ? { executionProfile } : {}) }]);
      assert.equal(connects, 2);
      assert.equal(socket.messages.filter(message => message.method === 'hello').length, 1);
      assert.equal(socket.messages.some(message => message.method === 'createSession'), false);
      if (executionProfile) {
        await client.createSession({ sessionId: 'new-session', executionProfile });
        assert.equal(socket.messages.at(-1).params.executionProfile, candidateProfile);
        assert.equal(connects, 2, 'create must use the already accepted original connection');
      }
    } finally { client.dispose(); controlledConnect = undefined; }
  }
});

test('startup profile rejects a mismatched hello without restart retry or a cached accepted connection', async () => {
  const invalidHellos = [hello, { ...hello, capabilities: { executionCandidateProfiles: [candidateProfile] } },
    ...[null, {}, candidateProfile, ['future-profile']].map(executionCandidateProfiles => ({
      ...candidateHello, capabilities: { ...candidateHello.capabilities, executionCandidateProfiles }
    })),
    ...['terminalPagedReadV1', 'terminalPagedCompletionV1', 'terminalReadSettlementV1'].map(missing => ({
      ...candidateHello, capabilities: { ...candidateHello.capabilities, [missing]: false }
    }))];
  for (const initiallyAbsent of [false, true]) {
    for (const response of invalidHellos) {
      let connects = 0;
      let starts = 0;
      const socket = new ControlledSocket();
      socket.respond = () => response;
      controlledConnect = () => {
        connects++;
        if (initiallyAbsent && connects === 1) {
          const absent = new ControlledSocket();
          queueMicrotask(() => absent.emit('error', Object.assign(new Error('endpoint absent'), { code: 'ECONNREFUSED' })));
          return absent;
        }
        queueMicrotask(() => socket.emit('connect'));
        return socket;
      };
      const client = startupClient({ startSupervisor: async () => { starts++; } });
      try {
        await assert.rejects(client.ensureConnected(), /candidate profile/);
        assert.equal(starts, Number(initiallyAbsent));
        assert.equal(connects, 1 + Number(initiallyAbsent));
        assert.equal(socket.destroyed, true);
        assert.equal(client.helloResult, undefined);
        assert.deepEqual(socket.messages.map(message => message.method), ['hello']);
      } finally { client.dispose(); controlledConnect = undefined; }
    }
  }
});

test('selected startup profile does not override an existing binding no-restart request', async () => {
  let connects = 0;
  controlledConnect = () => {
    connects++;
    const socket = new ControlledSocket();
    queueMicrotask(() => socket.emit('error', Object.assign(new Error('bound endpoint absent'), { code: 'ENOENT' })));
    return socket;
  };
  const client = startupClient();
  try {
    await assert.rejects(client.ensureConnected({ allowRestart: false }), /bound endpoint absent/);
    assert.equal(connects, 1);
  } finally { client.dispose(); controlledConnect = undefined; }
});

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

function deleteClock() {
  let now = 0;
  const deadlines = new Set();
  return {
    now: () => now, scheduleTask: task => queueMicrotask(task),
    scheduleDeadline(at, run) {
      const item = { at, run };
      deadlines.add(item);
      return () => deadlines.delete(item);
    },
    elapse(value) { now = value; },
    advance(value) {
      now = value;
      for (const item of [...deadlines]) if (item.at <= now && deadlines.delete(item)) item.run();
    }
  };
}

function replyDeleteError(socket, request, code = 'CONTROLLED_DELETE_FAILED') {
  socket.emit('data', `${JSON.stringify({ type: 'response', id: request.id, ok: false,
    error: { message: 'Controlled original delete error', code } })}\n`);
}

test('strict delete sends once on the original socket and separates old acknowledgements absence and errors', async () => {
  for (const result of ['acknowledged', 'absent', 'failed']) {
    const { client, socket } = await fixture();
    const clock = deleteClock();
    socket.respond = () => undefined;
    const params = { sessionId: `strict-${result}` };
    const observation = client.deleteSessionStrict(params, { deadline: 20, scheduler: clock });
    assert.equal(observation.submitted, true);
    assert.strictEqual(client.deleteSessionStrict(params, { deadline: 200, scheduler: clock }), observation,
      'a second call cannot register another request or extend the original deadline');
    assert.throws(() => client.deleteSessionStrict({ ...params, preserveTerminalReads: true },
      { deadline: 20, scheduler: clock }), /different terminal reader semantics/);
    const request = socket.messages.at(-1);
    assert.equal(socket.messages.filter(message => message.method === 'deleteSession').length, 1);
    if (result === 'acknowledged') socket.reply(request, { ok: true });
    else replyDeleteError(socket, request, result === 'absent'
      ? 'DEV_SESSION_CANVAS_RUNTIME_SESSION_NOT_FOUND' : undefined);
    const first = await observation.first;
    assert.equal(first.kind, result === 'acknowledged' ? 'legacy-acknowledged' : result === 'absent' ? 'legacy-absent' : 'failed');
    assert.ok(Object.isFrozen(first));
    assert.deepEqual(observation.current(), first);
  }
});

test('strict delete freezes timeout before a late response without dropping or replaying the submitted request', async () => {
  for (const trigger of ['timer', 'late-response']) {
    const { client, socket } = await fixture();
    const clock = deleteClock();
    socket.respond = () => undefined;
    const params = { sessionId: `strict-${trigger}` };
    const observation = client.deleteSessionStrict(params, { deadline: 20, scheduler: clock });
    const request = socket.messages.at(-1);
    if (trigger === 'timer') clock.advance(20);
    else clock.elapse(20);
    assert.strictEqual(client.deleteSessionStrict(params, { deadline: 100, scheduler: clock }), observation);
    assert.equal(client.pendingRequests.size, 1, 'timeout does not cancel the original remote delete');
    socket.reply(request, { ok: true });
    const first = await observation.first;
    await turns();
    assert.equal(first.kind, 'unconfirmed');
    assert.equal(observation.current().kind, 'legacy-acknowledged');
    assert.strictEqual(await observation.first, first);
    assert.equal(socket.messages.filter(message => message.method === 'deleteSession').length, 1);
    assert.equal(client.pendingRequests.size, 0);
  }
});

test('strict delete retains uncertainty after disconnect replacement or write failure and never reconnects', async () => {
  for (const failure of ['disconnect', 'replace', 'write']) {
    const { client, socket } = await fixture();
    const clock = deleteClock();
    socket.respond = () => undefined;
    if (failure === 'write') socket.write = () => { throw new Error('controlled strict write failure'); };
    const params = { sessionId: `strict-${failure}` };
    const observation = client.deleteSessionStrict(params, { deadline: 20, scheduler: clock });
    let next;
    if (failure === 'disconnect') socket.destroy();
    if (failure === 'replace') {
      next = new ControlledSocket();
      client.attachSocket(next);
      await client.performHelloHandshake();
    }
    const first = await observation.first;
    assert.equal(first.kind, 'unconfirmed');
    assert.strictEqual(client.deleteSessionStrict(params, { deadline: 100, scheduler: clock }), observation);
    assert.equal(observation.submitted, true);
    assert.equal(next?.messages.filter(message => message.method === 'deleteSession').length ?? 0, 0);
  }
});

test('strict delete rejects an expired stale or unrelated connecting binding before any deletion', async () => {
  const { client, socket } = await fixture();
  const clock = deleteClock();
  const expired = client.deleteSessionStrict({ sessionId: 'expired' }, { deadline: 0, scheduler: clock });
  assert.equal((await expired.first).kind, 'unconfirmed');
  assert.equal(expired.submitted, false);
  const stale = client.deleteSessionStrict({ sessionId: 'stale' }, { deadline: 20, scheduler: clock, isCurrent: () => false });
  assert.equal((await stale.first).kind, 'unconfirmed');
  socket.destroy();
  client.connectPromise = new Promise(() => {});
  const unrelated = client.deleteSessionStrict({ sessionId: 'connecting' }, { deadline: 20, scheduler: clock });
  assert.equal((await unrelated.first).kind, 'unconfirmed');
  assert.equal(unrelated.submitted, false);
  assert.equal(socket.messages.filter(message => message.method === 'deleteSession').length, 0);
});

test('strict deletion connects without restart and rechecks the original deadline and binding after hello', async () => {
  for (const timing of ['success', 'connect-cutoff', 'connect-timeout', 'hello-cutoff', 'hello-timeout', 'stale-binding']) {
    const clock = deleteClock();
    const socket = new ControlledSocket();
    socket.respond = () => undefined;
    let acquisitions = 0;
    controlledConnect = () => { acquisitions++; return socket; };
    const client = new RuntimeSupervisorClient({ backend: { paths: { socketPath: '/controlled-only' }, startSupervisor: forbidden },
      supervisorScriptPath: '/never', supervisorLauncherScriptPath: '/never' });
    clients.push(client);
    let current = true;
    try {
      const observation = client.deleteSessionStrict({ sessionId: timing },
        { deadline: 20, scheduler: clock, isCurrent: () => current });
      assert.equal(acquisitions, 1);
      if (timing === 'connect-cutoff') clock.elapse(20);
      if (timing === 'connect-timeout') clock.advance(20);
      else socket.emit('connect');
      await turns(8);
      if (!timing.startsWith('connect-')) {
        const handshake = socket.messages.at(-1);
        assert.equal(handshake.method, 'hello');
        if (timing === 'hello-cutoff') clock.elapse(20);
        if (timing === 'hello-timeout') {
          clock.advance(20);
          assert.equal((await observation.first).kind, 'unconfirmed');
          assert.strictEqual(client.deleteSessionStrict({ sessionId: timing }, { deadline: 200, scheduler: clock }), observation);
        }
        if (timing === 'stale-binding') current = false;
        socket.reply(handshake, hello);
        await turns(8);
      }
      if (timing === 'success') {
        assert.equal(observation.submitted, true);
        assert.equal(socket.messages.at(-1).method, 'deleteSession');
        socket.reply(socket.messages.at(-1), { ok: true });
        assert.equal((await observation.first).kind, 'legacy-acknowledged');
      } else {
        assert.equal((await observation.first).kind, 'unconfirmed');
        assert.equal(observation.submitted, false);
        assert.equal(socket.messages.filter(message => message.method === 'deleteSession').length, 0);
      }
    } finally { client.dispose(); controlledConnect = undefined; }
  }
});

test('candidate create requires both the announced profile and reader chain on the original connection', async () => {
  const profile = 'linux-owner-v1-candidate';
  for (const capability of ['none', 'profile-only', 'complete']) {
    const socket = new ControlledSocket();
    socket.respond = request => request.method === 'hello' ? { ...hello, capabilities: capability === 'none' ? hello.capabilities
      : capability === 'profile-only' ? { executionCandidateProfiles: [profile] }
        : { ...hello.capabilities, executionCandidateProfiles: [profile] } } : { sessionId: 'candidate', live: true };
    const { client } = await fixture(socket);
    const params = { sessionId: 'candidate', executionProfile: profile };
    if (capability === 'complete') {
      assert.equal(client.supportsExecutionCandidateProfile(profile), true);
      assert.equal((await client.createSession(params)).sessionId, 'candidate');
      assert.equal(socket.messages.at(-1).params.executionProfile, profile);
    } else {
      assert.equal(client.supportsExecutionCandidateProfile(profile), false);
      await assert.rejects(client.createSession(params), /candidate profile/);
      assert.equal(socket.messages.length, 1);
    }
    socket.destroy();
    await assert.rejects(client.createSession(params), /candidate profile/);
  }
});

test('candidate create does not bind an old response to a replacement socket or replay an unknown create', async () => {
  const socket = new ControlledSocket();
  socket.respond = request => request.method === 'hello' ? { ...hello,
    capabilities: { ...hello.capabilities, executionCandidateProfiles: ['linux-owner-v1-candidate'] } } : undefined;
  const { client } = await fixture(socket);
  const creation = client.createSession({ sessionId: 'known-before-submit', executionProfile: 'linux-owner-v1-candidate' });
  const rejected = assert.rejects(creation, /connection changed/);
  socket.reply(socket.messages.at(-1), { sessionId: 'known-before-submit', live: true });
  const next = new ControlledSocket();
  client.attachSocket(next);
  await rejected;
  assert.equal(next.messages.length, 0);
  assert.equal(socket.messages.filter(message => message.method === 'createSession').length, 1);
});

const creditParams = { sessionId: 'session', authorityId: 'authority', afterRevision: 0,
  terminalStreamMode: 'paged-until-exit', hostOutputCredit: 'journal-pages-v1' };
function creditSocket() {
  const socket = new ControlledSocket();
  socket.respond = request => {
    if (request.method === 'hello') return { ...hello, capabilities: { ...hello.capabilities, terminalHostOutputCreditV1: true } };
    if (request.method === 'subscribeSession') return { sessionId: 'session', authorityId: 'authority', revision: 0, subscriptionId: request.id };
    if (request.method === 'ackTerminalBatch') return { ok: true };
    throw new Error(`Unexpected credit request ${request.method}`);
  };
  return socket;
}
function terminalBatch(subscriptionId, revision = 1) {
  return { type: 'event', event: 'sessionTerminalBatch', payload: { sessionId: 'session', kind: 'terminal', authorityId: 'authority',
    subscriptionId, batchId: revision, afterRevision: revision - 1, revision,
    events: [{ type: 'output', revision, data: `row-${revision}\r\n` }] } };
}

test('Host credit requires explicit capability and an async consumer', async () => {
  const legacy = await fixture();
  assert.equal(legacy.client.supportsTerminalHostOutputCredit(), false);
  await assert.rejects(legacy.client.subscribeSession(creditParams), /unavailable/);
  assert.equal(legacy.socket.messages.length, 1);
  const supported = await fixture(creditSocket());
  assert.equal(supported.client.supportsTerminalHostOutputCredit(), true);
  await assert.rejects(supported.client.subscribeSession(creditParams), /unavailable/);
  assert.equal(supported.socket.messages.length, 1);
});

test('Host subscription binds before a same-chunk batch and does not ACK before actual consumption', async () => {
  const socket = creditSocket();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let consuming = false;
  const { client } = await fixture(socket, { onSessionTerminalBatch: async (_batch, isCurrent) => {
    assert.equal(isCurrent(), true); consuming = true; await gate; return 'consumed';
  } });
  const reply = socket.reply.bind(socket);
  socket.reply = (request, result) => {
    if (request.method !== 'subscribeSession') return reply(request, result);
    socket.emit('data', `${JSON.stringify({ type: 'response', id: request.id, ok: true, result })}\n${JSON.stringify(terminalBatch(result.subscriptionId))}\n`);
  };
  await client.subscribeSession(creditParams);
  assert.equal(consuming, true);
  assert.equal(client.hasPendingRequests(), true);
  assert.equal(socket.messages.some(message => message.method === 'ackTerminalBatch'), false);
  release();
  await turns(8);
  assert.equal(socket.messages.at(-1).params.outcome, 'consumed');
  assert.equal(client.hasPendingRequests(), false);
});

test('late Host consumption cannot credit a replacement subscription or socket', async () => {
  const socket = creditSocket();
  let release;
  let current;
  const gate = new Promise(resolve => { release = resolve; });
  const { client } = await fixture(socket, { onSessionTerminalBatch: async (_batch, isCurrent) => {
    current = isCurrent; await gate; return 'consumed';
  } });
  const first = await client.subscribeSession(creditParams);
  socket.emit('data', `${JSON.stringify(terminalBatch(first.subscriptionId))}\n`);
  const second = await client.subscribeSession(creditParams);
  assert.notEqual(first.subscriptionId, second.subscriptionId);
  assert.equal(current(), false);
  release();
  await turns(8);
  assert.equal(socket.messages.some(message => message.method === 'ackTerminalBatch'), false);
  socket.emit('data', `${JSON.stringify(terminalBatch(second.subscriptionId))}\n`);
  const next = creditSocket();
  client.attachSocket(next);
  await turns(8);
  assert.equal(current(), false);
  assert.equal(socket.messages.some(message => message.method === 'ackTerminalBatch'), false);
  assert.equal(next.messages.length, 0);
});

test('Host consumer cancellation is explicit and cannot become successful credit', async () => {
  const socket = creditSocket();
  const { client } = await fixture(socket, { onSessionTerminalBatch: async () => 'cancelled' });
  const subscription = await client.subscribeSession(creditParams);
  socket.emit('data', `${JSON.stringify(terminalBatch(subscription.subscriptionId))}\n`);
  await turns(8);
  assert.equal(socket.messages.at(-1).params.outcome, 'cancelled');
  assert.equal(client.hostOutputSubscriptions.size, 0);
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
