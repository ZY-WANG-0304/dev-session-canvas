import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { startObservedCase, startPublication } from './diagnostic-settlement-v3.mjs';
import { verifySavedCase, verifyPublicationSnapshot } from './settlement-oracle-v3.mjs';

assert.equal(process.version, 'v22.23.2', 'ACK lifecycle tests require frozen Node 22.23.2');
const entry = fileURLToPath(new URL('./diagnose-settlement-v3.mjs', import.meta.url));
const debug = path.resolve(path.dirname(entry), '../../.debug');
const now = () => process.hrtime.bigint();
const identity = caseId => ({ schema: 'diagnostic-settlement-v3', runId: 'ack-lifecycle-test', caseId, generation: 1, nonce: randomUUID() });
const alive = tracked => !tracked.exit && !tracked.closed;

async function waitFor(predicate, milliseconds, label, signal) {
  const deadline = now() + BigInt(milliseconds) * 1000000n;
  while (!predicate()) {
    signal?.throwIfAborted();
    assert(now() < deadline, `Timed out: ${label}`);
    await delay(5, undefined, { signal });
  }
}

function evidence(t, name) {
  fs.mkdirSync(debug, { recursive: true });
  const directory = fs.mkdtempSync(path.join(debug, `settlement-ack-${name}-`));
  const timeline = [], children = [];
  const mark = (event, details = {}) => timeline.push({ event, atNs: String(now()), ...details });
  const track = (child, role) => {
    const tracked = { child, role, exit: null, closed: false, error: null };
    children.push(tracked);
    child.on('spawn', () => mark('spawn', { role, pid: child.pid }));
    child.on('error', error => { tracked.error = String(error); mark('child-error', { role, error: tracked.error }); });
    child.on('exit', (code, signal) => { tracked.exit = { code, signal }; mark('exit', { role, code, signal }); });
    child.on('close', (code, signal) => { tracked.closed = true; mark('close', { role, code, signal }); });
    return tracked;
  };
  t.diagnostic(`Evidence directory: ${directory}`);
  t.after(async () => {
    for (const tracked of children) if (alive(tracked)) {
      mark('cleanup-signal', { role: tracked.role, signal: 'SIGTERM' });
      tracked.child.kill('SIGTERM');
    }
    await waitFor(() => children.every(tracked => !alive(tracked)), 1000, 'cleanup TERM').catch(() => {});
    for (const tracked of children) if (alive(tracked)) {
      mark('cleanup-signal', { role: tracked.role, signal: 'SIGKILL' });
      tracked.child.kill('SIGKILL');
    }
    await waitFor(() => children.every(tracked => !alive(tracked)), 3000, 'cleanup KILL');
    for (const { child } of children) for (const stream of child.stdio) stream?.destroy?.();
    await waitFor(() => children.every(tracked => tracked.closed), 3000, 'owned child handles to close');
    fs.writeFileSync(path.join(directory, 'cleanup.json'), JSON.stringify({ timeline, children: children.map(({ role, exit, closed, error }) => ({ role, exit, closed, error })) }, null, 2), { flag: 'wx' });
  });
  return { directory, timeline, children, mark, track,
    save(value) { fs.writeFileSync(path.join(directory, 'evidence.json'), JSON.stringify({ node: process.version, timeline, ...value }, null, 2), { flag: 'wx' }); },
  };
}

const readObserver = String.raw`
import fs from 'node:fs';
const original = fs.read;
let active = 0, started = 0, completed = 0;
const note = (event, details = {}) => process.stderr.write(JSON.stringify({ event, atNs: String(process.hrtime.bigint()), active, started, completed, ...details }) + '\n');
fs.read = function (...args) {
  if (args[0] !== 4) return Reflect.apply(original, this, args);
  const callback = args.at(-1);
  active++; started++; note('ack-read-start');
  args[args.length - 1] = function (...result) {
    active--; completed++;
    note('ack-read-callback', { bytesRead: result[1] ?? null, error: result[0]?.code ?? null });
    return Reflect.apply(callback, this, result);
  };
  return Reflect.apply(original, this, args);
};
const { runRole } = await import(process.argv[1]);
await runRole('caller');
note('role-returned');
`;

test('ending the owned ACK writer releases an observed post-role fd4 read', { timeout: 20000 }, async t => {
  const e = evidence(t, 'causal');
  const child = spawn(process.execPath, ['--input-type=module', '-e', readObserver, pathToFileURL(entry).href], {
    stdio: ['pipe', 'pipe', 'pipe', 'pipe', 'pipe'], shell: false, windowsHide: true,
  });
  const tracked = e.track(child, 'caller');
  const id = identity('causal-caller01');
  const request = { schema: 'diagnostic-settlement-request-v3', id, role: 'caller', attemptId: 'caller-attempt', requestId: 'caller-request',
    scenario: 'D3v3-01', artifactDirectory: path.join(e.directory, 'unused'), payloadBase64: '' };
  let stderr = '', target = '', stdout = '', active = 0, started = 0, completed = 0, returned = false, fd3Ended = false, ackSent = false;
  const observations = [], parseErrors = [];
  child.stdout.on('data', bytes => { stdout += bytes.toString('utf8'); });
  child.stderr.on('data', bytes => {
    stderr += bytes.toString('utf8');
    let newline;
    while ((newline = stderr.indexOf('\n')) >= 0) {
      const line = stderr.slice(0, newline); stderr = stderr.slice(newline + 1);
      try {
        const value = JSON.parse(line); observations.push(value);
        active = value.active; started = value.started; completed = value.completed;
        returned ||= value.event === 'role-returned';
        e.mark('child-observation', { value });
      } catch (error) { parseErrors.push({ line, error: String(error) }); }
    }
  });
  child.stdio[3].on('data', bytes => {
    target += bytes.toString('utf8');
    let newline;
    while ((newline = target.indexOf('\n')) >= 0) {
      const line = target.slice(0, newline); target = target.slice(newline + 1);
      try {
        const frame = JSON.parse(line);
        for (const field of ['runId', 'caseId', 'generation', 'nonce']) assert.equal(frame[field], id[field]);
        assert.equal(frame.schema, 'diagnostic-settlement-frame-v3'); assert.equal(frame.role, 'caller');
        assert.equal(frame.attemptId, request.attemptId); assert.equal(frame.requestId, request.requestId);
        assert.equal(frame.type, 'caller-after-await'); assert.equal(ackSent, false);
        ackSent = true;
        const ack = { schema: 'diagnostic-settlement-ack-v3', role: 'caller', runId: id.runId, caseId: id.caseId, generation: id.generation,
          nonce: id.nonce, attemptId: request.attemptId, requestId: request.requestId, type: 'ack', payload: { forType: frame.type } };
        e.mark('ack-write'); child.stdio[4].write(`${JSON.stringify(ack)}\n`);
      } catch (error) { parseErrors.push({ line, error: String(error) }); }
    }
  });
  child.stdio[3].on('end', () => { fd3Ended = true; e.mark('fd3-eof'); });
  child.stdin.end(JSON.stringify(request));
  try {
    await waitFor(() => {
      assert.equal(parseErrors.length, 0, JSON.stringify(parseErrors));
      assert(alive(tracked), 'Caller exited before the ACK-read holding premise was established');
      return returned && fd3Ended && active > 0;
    }, 5000, 'role return, fd3 EOF, and pending fd4 read', t.signal);
    const heldFrom = now(); e.mark('hold-start', { active, started, completed });
    while (now() - heldFrom < 100000000n) {
      assert(alive(tracked), 'Caller exited during the holding interval'); assert(active > 0, 'Pending ACK read ended before intervention');
      await delay(5, undefined, { signal: t.signal });
    }
    assert(alive(tracked)); assert(active > 0);
    const heldNs = now() - heldFrom;
    e.mark('ack-write-side-end', { heldNs: String(heldNs), active, started, completed });
    child.stdio[4].end();
    await waitFor(() => tracked.closed, 5000, 'natural caller close after ACK EOF', t.signal);
    assert.deepEqual(tracked.exit, { code: 0, signal: null });
    assert.equal(active, 0); assert.equal(completed, started); assert(started > 0);
    assert.equal(parseErrors.length, 0); assert.equal(stderr, ''); assert.equal(target, '');
    t.diagnostic(JSON.stringify({ heldNs: String(heldNs), started, completed, active, exit: tracked.exit }));
  } finally { e.save({ request, observations, parseErrors, stdout, pendingStderr: stderr, pendingTarget: target, returned, fd3Ended, active, started, completed, exit: tracked.exit }); }
});

function observedSpawn(e) {
  return role => {
    const child = spawn(process.execPath, [entry, '--role', role], { stdio: ['pipe', 'pipe', 'pipe', 'pipe', 'pipe'], shell: false, windowsHide: true });
    e.track(child, role);
    const ack = child.stdio[4], write = ack.write, end = ack.end;
    ack.write = function (chunk, ...args) {
      const frame = JSON.parse(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : chunk);
      e.mark('ack-write', { role, forType: frame.payload.forType, writableEnded: this.writableEnded });
      return Reflect.apply(write, this, [chunk, ...args]);
    };
    ack.end = function (...args) { e.mark('ack-end', { role }); return Reflect.apply(end, this, args); };
    return child;
  };
}

function assertNaturalRoles(e, snapshot, roles) {
  assert.deepEqual(e.children.map(value => value.role), roles);
  for (const role of roles) {
    const child = e.children.find(value => value.role === role);
    assert.deepEqual(child.exit, { code: 0, signal: null }, `${role} must exit naturally`);
    const owner = snapshot.owner.roles.find(value => value.role === role);
    assert.equal(owner.controlAttempts.length, 0, `${role} must not need termination signals`);
    for (const channel of ['stdout', 'stderr', 'fd3']) assert.equal(owner.streams[channel].end, true, `${role}/${channel} must reach EOF`);
    const ended = e.timeline.find(value => value.event === 'ack-end' && value.role === role);
    const exited = e.timeline.find(value => value.event === 'exit' && value.role === role);
    assert(ended && exited && BigInt(ended.atNs) < BigInt(exited.atNs), `${role} ACK writer must end before process exit`);
  }
}

for (const scenario of ['D3v3-01', 'D3v3-05', 'D3v3-09']) {
  test(`${scenario} and its actual writer/verifier exit naturally`, { timeout: 25000 }, async t => {
    const e = evidence(t, scenario);
    const spec = { id: identity(scenario), scenario, entryPath: entry, artifactDirectory: path.join(e.directory, 'writer-artifacts') };
    const handle = startObservedCase(spec, { spawnRole: observedSpawn(e) });
    let settled = false, verification;
    Promise.all([handle.observation, handle.processSettlement, handle.evidenceSettlement]).then(() => { settled = true; });
    try {
      await waitFor(() => settled, 15000, `${scenario} settlements`, t.signal);
      await waitFor(() => e.children.every(value => value.closed), 3000, `${scenario} child closes`, t.signal);
      const snapshot = handle.getEvidenceSnapshot(); verification = verifySavedCase(snapshot);
      assertNaturalRoles(e, snapshot, ['caller', 'writer', 'verifier']);
      assert.equal(snapshot.reports.processSettlement.code, 0);
      assert.equal(snapshot.reports.processSettlement.signal, null);
      assert.equal(snapshot.reports.evidenceSettlement.kind, 'sealed');
      assert.equal(snapshot.reports.evidenceSettlement.artifactVerified, true);
      assert.equal(verification.pass, true, JSON.stringify(verification.errors));
      const writes = e.timeline.filter(value => value.event === 'ack-write' && value.role === 'caller');
      assert.deepEqual(writes.map(value => value.forType), scenario === 'D3v3-05' ? [] : scenario === 'D3v3-09' ? ['after-await-ready', 'caller-after-await'] : ['caller-after-await']);
      assert(writes.every(value => value.writableEnded === false));
      if (scenario === 'D3v3-09') {
        const firstEnd = e.timeline.findIndex(value => value.event === 'ack-end' && value.role === 'caller');
        const secondWrite = e.timeline.findIndex(value => value.event === 'ack-write' && value.role === 'caller' && value.forType === 'caller-after-await');
        assert(firstEnd > secondWrite, 'Caller09 ACK writer must remain open until its second response');
      }
      t.diagnostic(JSON.stringify({ scenario, process: snapshot.reports.processSettlement.kind, evidence: snapshot.reports.evidenceSettlement.kind, acknowledgements: writes }));
    } finally { e.save({ spec, snapshot: handle.getEvidenceSnapshot(), verification }); }
  });
}

test('the actual normal publisher exits naturally after its final ACK', { timeout: 15000 }, async t => {
  const e = evidence(t, 'publisher');
  const id = identity('publisher-normal');
  const payload = { schema: 'diagnostic-settlement-publication-payload-v3', id, archiveAttemptId: 'publication-1', snapshotOrdinal: 1,
    files: [{ path: 'probe.json', bytesBase64: Buffer.from('{}').toString('base64') }] };
  const spec = { id, scenario: 'publisher-normal', entryPath: entry, artifactDirectory: path.join(e.directory, 'published'),
    archiveAttemptId: payload.archiveAttemptId, snapshotOrdinal: payload.snapshotOrdinal, payloadBase64: Buffer.from(JSON.stringify(payload)).toString('base64') };
  const handle = startPublication(spec, { spawnRole: observedSpawn(e) });
  let settled = false, verification;
  handle.publication.then(() => { settled = true; });
  try {
    await waitFor(() => settled, 5000, 'publication settlement', t.signal);
    await waitFor(() => e.children.every(value => value.closed), 3000, 'publisher close', t.signal);
    const snapshot = handle.getEvidenceSnapshot(); verification = verifyPublicationSnapshot(snapshot);
    assertNaturalRoles(e, snapshot, ['publisher']);
    assert.equal(snapshot.reports.publication.kind, 'published');
    assert.equal(verification.pass, true, JSON.stringify(verification.errors));
    t.diagnostic(JSON.stringify({ publication: snapshot.reports.publication.kind, acknowledgements: e.timeline.filter(value => value.event === 'ack-write') }));
  } finally { e.save({ spec, snapshot: handle.getEvidenceSnapshot(), verification }); }
});
