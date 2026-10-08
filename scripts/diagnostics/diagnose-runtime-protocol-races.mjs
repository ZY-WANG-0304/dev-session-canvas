import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import esbuild from 'esbuild';

// Finite RCA only: real Supervisor, socket and PTY; gates and instrumentation are explicit.
const root = process.cwd();
const evidence = path.resolve(process.argv[2] ?? '.debug/runtime-protocol-races');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'dsc-races-'));
await mkdir(evidence, { recursive: true });
const traceFile = path.join(evidence, 'server.ndjson');
await writeFile(traceFile, '');
const sourcePath = path.join(root, 'extensions/vscode/dev-session-canvas/src/supervisor/runtimeSupervisorMain.ts');
const source = await readFile(sourcePath, 'utf8');
const instrumentation = `
const rcaFs = require('node:fs');
const rcaPath = require('node:path');
const rcaDir = ${JSON.stringify(temporary)};
let rcaSequence = 0;
function rcaRecord(event, session, detail = {}) {
  rcaFs.appendFileSync(${JSON.stringify(traceFile)}, JSON.stringify({ sequence: ++rcaSequence,
    time: Date.now(), event, sessionId: session.sessionId,
    live: session.live, admission: session.terminalMutationAdmissionOpen,
    revision: session.terminalJournal?.getRevision(), ...detail }) + '\\n');
}
async function rcaGate(name) {
  const end = Date.now() + 15000;
  while (!rcaFs.existsSync(rcaPath.join(rcaDir, name))) {
    if (Date.now() >= end) throw new Error('RCA gate expired: ' + name);
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}
const rcaPrototype = RuntimeSupervisorServer.prototype;
const rcaBind = rcaPrototype.bindSessionProcess;
rcaPrototype.bindSessionProcess = function(session) {
  const process = session.process;
  const onExit = process.onExit.bind(process);
  process.onExit = listener => onExit(event => {
    rcaRecord('pty-exit-callback', session, { exitCode: event.exitCode });
    if (session.sessionId === 'exit-callback-held') {
      void rcaGate('release-exit-callback').then(() => {
        rcaRecord('exit-delivered', session); listener(event);
      });
    } else { rcaRecord('exit-delivered', session); listener(event); }
  });
  return rcaBind.call(this, session);
};
const rcaEmit = rcaPrototype.emitTerminalStreamEvent;
rcaPrototype.emitTerminalStreamEvent = function(session, event) {
  if (event.type !== 'output' || event.data.includes('RCA-') || event.data.includes('trigger')) {
    rcaRecord('terminal-event', session, { type: event.type, eventRevision: event.revision,
      ...(event.type === 'output' ? { data: event.data.slice(-120) } : {}) });
  }
  return rcaEmit.call(this, session, event);
};
const rcaSubscribe = rcaPrototype.subscribeSessionAtSettledRevision;
rcaPrototype.subscribeSessionAtSettledRevision = async function(socket, session, params) {
  rcaRecord('subscribe-enter', session);
  const result = await rcaSubscribe.call(this, socket, session, params);
  rcaRecord('subscribe-result', session, { resultRevision: result.revision });
  return result;
};
const rcaResize = rcaPrototype.resizeSession;
rcaPrototype.resizeSession = async function(params) {
  const session = this.sessions.get(params.sessionId);
  rcaRecord('resize-enter', session);
  try {
    const result = await rcaResize.call(this, params);
    rcaRecord('resize-result', session, { ok: true });
    return result;
  } catch (error) {
    rcaRecord('resize-result', session, { ok: false, code: error.code, message: error.message });
    throw error;
  }
};
const rcaFinalize = rcaPrototype.finalizeSession;
rcaPrototype.finalizeSession = async function(sessionId, ...args) {
  const session = this.sessions.get(sessionId);
  rcaRecord('finalize-enter', session);
  if (sessionId === 'exit-admission-closed') await rcaGate('release-finalize');
  const result = await rcaFinalize.call(this, sessionId, ...args);
  rcaRecord('finalize-result', session);
  return result;
};
`;
assert.equal(source.split('if (require.main === module) {').length, 2);
const outfile = path.join(temporary, 'supervisor.cjs');
const built = await esbuild.build({ stdin: { contents: source.replace('if (require.main === module) {',
  instrumentation + '\nif (require.main === module) {'), resolveDir: path.dirname(sourcePath), loader: 'ts' },
  bundle: true, platform: 'node', format: 'cjs', outfile, external: ['node-pty'], metafile: true });
assert.ok(!Object.keys(built.metafile.inputs).some(file => file.endsWith('/runtimeSupervisorClient.ts')),
  'The diagnostic server must not include the F-01 client.');
await writeFile(path.join(evidence, 'inputs.json'), JSON.stringify(Object.keys(built.metafile.inputs), null, 2));
const storageDir = path.join(temporary, 'storage');
const socketPath = process.platform === 'win32' ? `\\\\.\\pipe\\dsc-rca-${path.basename(temporary)}`
  : path.join(temporary, 'supervisor.sock');
const supervisor = spawn(process.execPath, [outfile, '--storage-dir', storageDir, '--socket-path', socketPath], {
  cwd: root, env: { ...process.env, NODE_PATH: path.join(root, 'node_modules') }, stdio: ['ignore', 'ignore', 'pipe']
});
let stderr = '';
supervisor.stderr.on('data', chunk => { stderr += chunk; });
let socket;
let sequence = 0;
const messages = [];
const wire = [];
const summaries = [];
const activeSessions = new Set();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(read, label, timeoutMs = 15000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const value = await read();
    if (value) return value;
    await delay(5);
  }
  throw new Error('RCA timeout: ' + label + '\n' + stderr);
}
async function trace() {
  return (await readFile(traceFile, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
}
async function observed(sessionId, event) {
  return until(async () => (await trace()).find(row => row.sessionId === sessionId && row.event === event), event);
}
async function request(method, params, raw = false, timeoutMs = 15000) {
  const id = String(++sequence);
  socket.write(JSON.stringify({ type: 'request', id, method, params }) + '\n');
  const response = await until(() => messages.find(message => message.type === 'response' && message.id === id), method, timeoutMs);
  if (method === 'deleteSession' && response.ok) activeSessions.delete(params.sessionId);
  if (raw) return response;
  assert.equal(response.ok, true, response.error?.message);
  return response.result;
}
async function registry(sessionId, predicate) {
  return until(async () => {
    let value;
    try { value = JSON.parse(await readFile(path.join(storageDir, 'registry.json'), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return; throw error; }
    const session = value.sessions?.find(item => item.sessionId === sessionId);
    return session && predicate(session) ? session : undefined;
  }, 'registry ' + sessionId);
}
async function create(sessionId, script, scrollback = 1000) {
  const scriptPath = path.join(temporary, sessionId + '.js');
  await writeFile(scriptPath, script);
  activeSessions.add(sessionId);
  return request('createSession', { sessionId, kind: 'terminal', displayLabel: sessionId, launchMode: 'start',
    scrollback, deferSubscription: true, launchSpec: { file: process.execPath, args: [scriptPath], cwd: temporary,
      cols: 96, rows: 24, env: process.env, terminalName: 'xterm-256color' } });
}
const outputEvent = (sessionId, marker) => messages.find(message => message.event === 'sessionTerminalEvent' &&
  message.payload?.sessionId === sessionId && message.payload.event?.type === 'output' &&
  message.payload.event.data.includes(marker));
async function gap(mode) {
  const sessionId = 'gap-' + mode;
  const marker = 'RCA-GAP-' + mode;
  const release = path.join(temporary, sessionId + '.release');
  const script = `const fs = require('node:fs');
process.stdin.setEncoding('utf8');
process.stdin.once('data', () => {
  const timer = setInterval(() => {
    if (!fs.existsSync(${JSON.stringify(release)})) return;
    clearInterval(timer); process.stdout.write(${JSON.stringify(marker + '\r\n')});
  }, 5);
});
setInterval(() => {}, 1000);`;
  const initial = await create(sessionId, script);
  await request('writeInput', { sessionId, data: 'trigger\n' });
  const advanced = await registry(sessionId, session => session.terminalRevision > initial.terminalRevision);
  assert.ok(advanced.output.includes('trigger'), 'Real PTY input echo satisfies the original revision predicate.');
  assert.ok(!advanced.output.includes(marker));
  const checkpoint = await request('getSessionCheckpoint', { sessionId, authorityId: initial.terminalAuthorityId,
    afterCheckpointRevision: initial.terminalStream.checkpoint.revision });
  assert.ok(checkpoint.checkpoint.revision > initial.terminalStream.checkpoint.revision);
  if (mode === 'before-subscribe') {
    await writeFile(release, 'release');
    await registry(sessionId, session => session.output.includes(marker));
  }
  const subscribed = await request('subscribeSession', { sessionId, authorityId: initial.terminalAuthorityId,
    afterRevision: initial.terminalRevision });
  if (mode === 'after-subscribe') await writeFile(release, 'release');
  const markerEvent = await until(() => outputEvent(sessionId, marker), marker);
  const markerRevision = markerEvent.payload.event.revision;
  const originalAssertion = subscribed.revision >= markerRevision;
  assert.equal(originalAssertion, mode === 'before-subscribe');
  const replay = messages.filter(message => message.event === 'sessionTerminalEvent' &&
    message.payload?.sessionId === sessionId && message.payload.event.revision <= subscribed.revision);
  assert.deepEqual(replay.map(message => message.payload.event.revision),
    Array.from({ length: subscribed.revision - initial.terminalRevision }, (_, index) => initial.terminalRevision + index + 1));
  summaries.push({ sessionId, control: 'child marker gated by file; real PTY echo unmodified',
    initialRevision: initial.terminalRevision, registryRevision: advanced.terminalRevision,
    registryOutput: advanced.output, checkpointRevision: checkpoint.checkpoint.revision,
    subscribedRevision: subscribed.revision, markerRevision, originalAssertion, replayContiguous: true });
  await request('deleteSession', { sessionId });
}
async function exitRace(mode) {
  const sessionId = 'exit-' + mode;
  const marker = 'RCA-FINAL-' + mode;
  const script = `process.stdin.setEncoding('utf8');
process.stdin.once('data', () => {
  process.stdout.write('f'.repeat(2 * 1024 * 1024));
  process.stdout.write(${JSON.stringify(marker + '\r\n')});
  setTimeout(() => process.exit(0), 5);
});
setInterval(() => {}, 1000);`;
  const initial = await create(sessionId, script, 100000);
  await request('subscribeSession', { sessionId, authorityId: initial.terminalAuthorityId,
    afterRevision: initial.terminalRevision });
  await request('writeInput', { sessionId, data: 'exit\n' });
  await until(() => outputEvent(sessionId, marker), marker);
  const markerObservedAt = Date.now();
  await delay(25); // Preserve the original fixture's observation window.
  if (mode === 'callback-held') await observed(sessionId, 'pty-exit-callback');
  if (mode === 'admission-closed') await observed(sessionId, 'finalize-enter');
  const before = (await trace()).filter(row => row.sessionId === sessionId);
  const response = await request('resizeSession', { sessionId, cols: 77, rows: 19 }, true);
  const assertion = !response.ok && response.error?.code === 'DEV_SESSION_CANVAS_RUNTIME_SESSION_NOT_LIVE';
  if (mode === 'callback-held') assert.equal(assertion, false);
  if (mode === 'admission-closed') {
    assert.equal(assertion, true);
    assert.equal(before.some(row => row.event === 'finalize-result'), false);
  }
  if (mode === 'callback-held') await writeFile(path.join(temporary, 'release-exit-callback'), 'release');
  if (mode === 'admission-closed') await writeFile(path.join(temporary, 'release-finalize'), 'release');
  await observed(sessionId, 'finalize-result');
  const afterExit = await request('resizeSession', { sessionId, cols: 76, rows: 18 }, true);
  assert.equal(afterExit.error?.code, 'DEV_SESSION_CANVAS_RUNTIME_SESSION_NOT_LIVE');
  const rows = (await trace()).filter(row => row.sessionId === sessionId);
  const resizeEntry = rows.find(row => row.event === 'resize-enter');
  if (mode === 'callback-held') assert.equal(resizeEntry.admission, true);
  if (mode === 'admission-closed') assert.equal(resizeEntry.admission, false);
  summaries.push({ sessionId, control: mode === 'natural' ? 'none; original 2 MiB / child exit 5ms / observer 25ms'
    : mode === 'callback-held' ? 'hold delivery of actual node-pty exit callback' : 'hold finalization after admission closes',
    markerObservedAt, resizeEntry, resizeResponse: response, originalAssertion: assertion,
    exitCallback: rows.find(row => row.event === 'pty-exit-callback'),
    exitDelivered: rows.find(row => row.event === 'exit-delivered'), afterExitCode: afterExit.error.code });
  await request('deleteSession', { sessionId });
}

try {
  socket = await until(async () => {
    const candidate = net.createConnection(socketPath);
    try { await once(candidate, 'connect'); return candidate; }
    catch { candidate.destroy(); if (supervisor.exitCode !== null) throw new Error(stderr); }
  }, 'Supervisor connection');
  socket.setEncoding('utf8');
  let buffer = '';
  socket.on('data', chunk => {
    buffer += chunk;
    while (buffer.includes('\n')) {
      const newline = buffer.indexOf('\n');
      const message = JSON.parse(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      messages.push(message);
      wire.push({ time: Date.now(), type: message.type, id: message.id, event: message.event,
        sessionId: message.payload?.sessionId, ok: message.ok, revision: message.payload?.event?.revision });
    }
  });
  await request('hello');
  await gap('after-subscribe');
  await gap('before-subscribe');
  await exitRace('natural');
  await exitRace('callback-held');
  await exitRace('admission-closed');
  await writeFile(path.join(evidence, 'summary.json'), JSON.stringify(summaries, null, 2));
  console.log(JSON.stringify(summaries, null, 2));
  console.log('RCA: 5 finite scenarios verified; original test assertions were evaluated without weakening them.');
} finally {
  // A failed assertion can leave a child or a diagnostic gate active.
  await writeFile(path.join(temporary, 'release-exit-callback'), 'cleanup');
  await writeFile(path.join(temporary, 'release-finalize'), 'cleanup');
  if (socket && !socket.destroyed) {
    for (const sessionId of activeSessions) {
      await request('deleteSession', { sessionId }, true, 2000).catch(() => undefined);
    }
  }
  await writeFile(path.join(evidence, 'wire.json'), JSON.stringify(wire, null, 2));
  await writeFile(path.join(evidence, 'stderr.log'), stderr);
  socket?.destroy();
  if (supervisor.exitCode === null && supervisor.signalCode === null) {
    const exited = once(supervisor, 'exit');
    supervisor.kill('SIGTERM');
    await exited;
  }
  await rm(temporary, { recursive: true, force: true });
}
