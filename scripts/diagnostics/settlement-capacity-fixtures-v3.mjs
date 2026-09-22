import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { startObservedCase, startPublication } from './diagnostic-settlement-v3.mjs';
import { verifySavedCase, verifyPublicationSnapshot } from './settlement-oracle-v3.mjs';
import { VirtualClock, fakeTransport, makeProtocolFrame } from './settlement-fixtures-v3.mjs';

const NS = 1000000n;
const SCHEMA = 'diagnostic-settlement-v3';
const CHANNELS = ['stdout', 'stderr', 'fd3'];
const NORMAL_EVENTS = 4032;
const NORMAL_BYTES = 983040;
const sha = value => createHash('sha256').update(value).digest('hex');
const bytes = value => Buffer.byteLength(JSON.stringify(value));
const clone = value => structuredClone(value);
const shortId = () => ({ schema: SCHEMA, runId: 'r', caseId: 'c', generation: 'g', nonce: 'n' });
const roles = { writer: ['write-entered', 'write', 'seal-claim'], verifier: ['verify-entered', 'verify', 'verified'], publisher: ['publish-entered', 'publish', 'publish-claim'] };

function context(options = {}) {
  const clock = new VirtualClock();
  const transport = fakeTransport(clock);
  const publication = options.publication === true;
  const spec = { id: options.id ?? shortId(), scenario: options.scenario ?? 'synthetic-capacity', entryPath: '/fixture/unused.mjs', artifactDirectory: options.artifactDirectory ?? '/a',
    ...(options.capture ? { gates: { capture: true } } : {}),
    ...(publication ? { archiveAttemptId: 'a', snapshotOrdinal: 1, payloadBase64: 'e30=' } : {}) };
  const actions = [{ action: 'start', atNs: '0', spec: clone(spec) }];
  const checks = [];
  const handle = (publication ? startPublication : startObservedCase)(spec, { clock, spawnRole: transport.spawnRole, pathStyle: 'posix' });
  const c = {
    clock, transport, spec, handle, publication, actions, checks,
    mark(action, input = {}) { actions.push({ action, atNs: String(clock.time), ...clone(input) }); },
    check(label, actual, expected) { const check = { label, actual: clone(actual), expected: clone(expected), pass: JSON.stringify(actual) === JSON.stringify(expected) }; checks.push(check); assert.deepEqual(actual, expected, label); },
    snap() { return handle.getEvidenceSnapshot(); },
    owner(role) { return handle.getOwnerSnapshot().roles.find(value => value.role === role); },
    child(role) { const child = transport.children.get(role); assert(child, `fake role not created: ${role}`); return child; },
    stream(role, channel) { const child = c.child(role); return channel === 'fd3' ? child.stdio[3] : child[channel]; },
    async flush() { await clock.flush(); },
    async advance(ns) { c.mark('advance', { toNs: String(ns) }); await clock.advance(ns); },
    raw(role, channel, data) { c.mark('data', { role, channel, bytesBase64: data.toString('base64') }); c.stream(role, channel).emit('data', data); },
    send(role, type, payload) {
      const child = c.child(role);
      const frame = { ...makeProtocolFrame(spec.id, role, ++child.sequence, type, payload, clock.time), attemptId: child.request.attemptId, requestId: child.request.requestId };
      c.raw(role, type === 'caller-after-await' ? 'fd3' : 'stdout', Buffer.from(`${JSON.stringify(frame)}\n`));
    },
    event(role, event) { c.mark('process-event', { role, event }); c.child(role).emit(event, 0, null); },
    end(role) { for (const channel of CHANNELS) { c.mark('stream-end', { role, channel }); c.stream(role, channel).emit('end'); } },
    error(role, length, stream = false) {
      c.mark('error', { role, channel: stream ? 'stderr' : null, name: 'Error', code: 'EIO', messageLength: length });
      const error = Object.assign(new Error('x'.repeat(length)), { code: 'EIO' });
      (stream ? c.stream(role, 'stderr') : c.child(role)).emit('error', error);
    },
    initial() { c.send('caller', 'caller-start', { scenario: spec.scenario }); c.send('caller', 'result-ready', {}); c.send('caller', 'operation-returned', { kind: 'returned' }); c.send('caller', 'caller-after-await', { kind: 'returned' }); c.send('caller', 'caller-finished', { exitCode: 0 }); },
    async caller() { c.initial(); c.event('caller', 'exit'); c.end('caller'); await c.flush(); },
    claim(role) {
      if (role === 'publisher') return { files: 1, manifestSha256: '1'.repeat(64) };
      const request = c.child(role).request;
      const content = role === 'writer' ? request.payloadBase64 : JSON.parse(Buffer.from(request.payloadBase64, 'base64')).expectedPayloadBase64;
      const payload = Buffer.from(content, 'base64');
      return { bytes: payload.length, sha256: sha(payload), manifestSha256: '1'.repeat(64) };
    },
    begin(role) { c.send(role, 'start', { scenario: spec.scenario }); c.send(role, roles[role][0], { mode: roles[role][1] }); },
    terminal(role) { c.send(role, roles[role][2], c.claim(role)); },
    async helper(role) { c.begin(role); c.terminal(role); c.event(role, 'exit'); c.end(role); await c.flush(); },
    async enter(role) { if (['writer', 'verifier'].includes(role)) await c.caller(); if (role === 'verifier') await c.helper('writer'); },
    async finish() {
      if (publication) { if (!c.snap().reports.publication && !c.owner('publisher').exit) await c.helper('publisher'); }
      else {
        if (!c.owner('caller')?.exit) c.event('caller', 'exit');
        if (!c.snap().capture) { if (options.capture) await c.advance(6000n * NS); else c.end('caller'); await c.flush(); }
        for (const role of ['writer', 'verifier']) if (transport.children.has(role) && !c.owner(role).exit && !c.owner(role).spawnFailed) await c.helper(role);
      }
      const names = publication ? ['publication'] : ['observation', 'processSettlement', 'evidenceSettlement'];
      if (names.some(name => !c.snap().reports[name])) await c.advance(10000n * NS);
      for (const name of names) c.check(`first-report:${name}`, Boolean(c.snap().reports[name]), true);
    },
  };
  return c;
}

function nextFact(c, event, role, details, now = c.clock.time) {
  const trace = c.snap().trace;
  const ordinal = trace.at(-1).eventOrdinal + 1;
  return { factId: `${c.spec.id.nonce}:fact:${ordinal}`, eventOrdinal: ordinal, receiptNs: String(now), event, role,
    attemptId: role ? c.owner(role).attemptId : null, details };
}

function rawFact(c, length, now) {
  return nextFact(c, 'stream-data', 'caller', { channel: 'stderr', bytesBase64: Buffer.alloc(length, 120).toString('base64'), ingressNs: String(now), deliveryNs: String(now), receivedBytes: length, retainedBytes: length }, now);
}

function errorFact(c, length, role = 'caller') {
  return nextFact(c, 'process-error', role, { name: 'Error', code: 'EIO', message: 'x'.repeat(length) });
}

function lateBytes(fact, reportId) {
  return bytes({ ...fact, lateFactId: `${fact.factId}:late`, firstReportIds: [reportId] });
}

function selectRawSize(c, remaining) {
  // Three timestamp fields and base64's four-byte quantum give independent residues.
  for (const now of [0n, 10n, 100n, 1000n]) {
    let low = 0, high = remaining;
    while (low <= high) {
      const middle = (low + high) >> 1;
      const size = bytes(rawFact(c, middle, now));
      if (size === remaining) return { length: middle, now, size };
      if (size < remaining) low = middle + 1; else high = middle - 1;
    }
  }
  throw new Error(`No raw input with exact serialized size ${remaining}`);
}

function requestMetadata(id, role, artifactDirectory) {
  return { schema: 'diagnostic-settlement-request-v3', id, role, attemptId: `${id.caseId}:${role}:1`, requestId: `${id.nonce}:${role}:request:1`, scenario: 'synthetic-capacity', artifactDirectory, payloadBase64: '' };
}

function inputSizing(role, target) {
  const id = shortId();
  const wrapper = { schema: 'diagnostic-settlement-verification-input-v3', expectedPayloadBase64: '', writerAttemptId: 'c:writer:1', writerRequestId: 'n:writer:request:1' };
  for (let padding = 0; padding < 12; padding++) {
    const artifactDirectory = `/a${'x'.repeat(padding)}`;
    const encodedPayload = target - bytes(requestMetadata(id, role, artifactDirectory));
    if (encodedPayload % 4 !== 0) continue;
    if (role === 'writer') return { artifactDirectory, payloadBytes: encodedPayload / 4 * 3 };
    for (let remainder = 0; remainder < 3; remainder++) {
      const verifierInput = encodedPayload / 4 * 3 - remainder;
      const writerBase64 = verifierInput - bytes(wrapper);
      if (writerBase64 > 0 && writerBase64 % 4 === 0) return { artifactDirectory, payloadBytes: writerBase64 / 4 * 3 };
    }
  }
  throw new Error(`Unrepresentable request byte target: ${role}/${target}`);
}

function previewCapturePayload(c, futureErrors, totalErrorEvents) {
  const snapshot = c.snap();
  const streams = clone(c.owner('caller').streams);
  for (const stream of Object.values(streams)) stream.end = true;
  streams.stderr.errors.push(...futureErrors);
  const captureOrdinal = snapshot.reports.processSettlement.eventOrdinal + totalErrorEvents + 1 + 4;
  const capture = { integrity: 'failed', reasons: ['trace-capacity'], factId: `n:fact:${captureOrdinal}`, receiptNs: '0', streams };
  return { schema: 'diagnostic-settlement-payload-v3', id: c.spec.id, reports: snapshot.reports, capture,
    controlFacts: snapshot.trace.filter(fact => ['control-attempt', 'deadline', 'stream-cancel', 'spawn-error', 'process-error', 'trace-overflow'].includes(fact.event)) };
}

export async function runCapacitySelfTests({ onCase } = {}) {
  const cases = [];
  const run = async (id, expected, operation, options = {}) => {
    let c, evidence, verification, error = null;
    const classification = options.classification ?? 'complete-replay';
    try {
      c = context(options); await c.flush();
      await operation(c);
      if (classification !== 'structural-upper-bound') {
        await c.finish();
        evidence = c.snap();
        verification = (c.publication ? verifyPublicationSnapshot : verifySavedCase)(evidence);
        c.check('independent-replay', verification.pass, classification === 'complete-replay');
        if (classification === 'expected-unverifiable') c.check('explicit-missing-phase-proof', verification.errors.includes('missing-phase-start'), true);
      } else evidence = c.snap();
    } catch (caught) { error = caught.stack ?? String(caught); evidence = c?.snap() ?? null; }
    const result = { id, classification, synthetic: true, native: false, expected, input: { spec: c?.spec, actions: c?.actions ?? [] }, checks: c?.checks ?? [], evidence, verification, pass: error === null, error };
    cases.push(result); await onCase?.(result);
  };

  const maximum = '\u0000'.repeat(256);
  await run('caller-request-structural-upper-bound', { maximalAcceptedJSONBytes: 207621, inputLimit: 2097152, limitUnreachable: true }, async c => {
    const request = c.snap().requests[0];
    c.check('maximal-caller-request-bytes', bytes(request), 207621);
    c.check('caller-payload-empty', request.payloadBase64, '');
    c.check('caller-under-capacity-for-all-valid-configurations', bytes(request) < 2097152, true);
    c.mark('upper-bound-proof', { maximalJSONBytesPerUTF16Unit: 6, allVariableFieldsMaximal: true, entryPathAndCommandAbsentFromRequest: true });
  }, { id: { schema: SCHEMA, runId: maximum, caseId: maximum, generation: maximum, nonce: maximum }, scenario: maximum,
    artifactDirectory: `/${'\u0000'.repeat(32767)}`, classification: 'structural-upper-bound' });

  for (const role of ['writer', 'verifier']) for (const delta of [-1, 0, 1]) {
    const target = 2097152 + delta;
    const sizing = inputSizing(role, target);
    await run(`${role}-input-${target}`, { inputBytes: target, launchRejected: delta > 0, publicStreamErrorPressure: true, completeEvidence: false }, async c => {
      c.initial(); c.event('caller', 'exit');
      for (let i = 0; i < 540; i++) c.error('caller', 2048, true);
      c.check('prefix-trace-already-overflowed', Boolean(c.handle.getOwnerSnapshot().traceCapacity.overflow), true);
      const empty = Array.from({ length: 260 }, () => ({ name: 'Error', code: 'EIO', message: '' }));
      const baseline = previewCapturePayload(c, empty, 800);
      let extra = sizing.payloadBytes - bytes(baseline);
      c.mark('arithmetic-input-construction', { role, target, baselinePayloadBytes: bytes(baseline), desiredPayloadBytes: sizing.payloadBytes, extraASCIIBytes: extra });
      c.check('input-adjustment-in-public-error-range', extra >= 0 && extra <= 260 * 2048, true);
      for (let i = 0; i < 260; i++) { const length = Math.min(extra, 2048); c.error('caller', length, true); extra -= length; }
      c.end('caller'); await c.flush();
      const writerRequest = c.snap().requests.find(request => request.role === 'writer');
      c.check('constructed-payload-byte-count', Buffer.from(writerRequest.payloadBase64, 'base64').length, sizing.payloadBytes);
      if (role === 'verifier') { c.check('writer-launched-before-verifier-boundary', c.owner('writer').launchRejected, false); await c.helper('writer'); }
      const request = c.snap().requests.find(item => item.role === role);
      c.check('exact-request-boundary', bytes(request), target);
      c.check('request-rejection-boundary', c.owner(role).launchRejected, delta > 0);
      c.check('rejected-request-never-spawned', c.transport.children.has(role), delta <= 0);
    }, { artifactDirectory: sizing.artifactDirectory, classification: 'expected-unverifiable' });
  }

  for (const role of ['writer', 'verifier', 'publisher']) for (const count of [7, 8, 9]) {
    await run(`${role}-raw-frame-count-${count}`, { rawFrames: count, grammarAlreadyFailed: true, frameCapacityTriggered: count > 8 }, async c => {
      await c.enter(role); c.begin(role); c.terminal(role);
      for (let i = 3; i < count; i++) c.raw(role, 'stdout', Buffer.from('{invalid}\n'));
      c.check('raw-frame-capacity-reason', c.owner(role).protocolErrors.some(error => error.reason === 'helper-frame-capacity'), count > 8);
      c.check('raw-frame-capacity-cancel', c.owner(role).streams.stdout.cancelled, count > 8);
      c.check('protocol-error-cap-has-not-preempted-frame-cap', c.owner(role).protocolErrors.length < 8, true);
      c.event(role, 'exit'); c.end(role); await c.flush();
    }, { publication: role === 'publisher' });
  }

  for (const target of [4031, 4032, 4033]) await run(`normal-event-count-${target}`, { attemptedNormalEvents: target, emptyDeliveryPressure: true, firstOmission: target > NORMAL_EVENTS }, async c => {
    c.initial();
    const before = c.snap().trace.length;
    c.mark('repeat-empty-data', { count: target - before, reason: 'event-count-only diagnostic transport pressure' });
    for (let i = before; i < target; i++) c.stream('caller', 'stderr').emit('data', Buffer.alloc(0));
    c.check('normal-count-overflow', Boolean(c.handle.getOwnerSnapshot().traceCapacity.overflow), target > NORMAL_EVENTS);
    c.check('normal-count-not-byte-preempted', c.handle.getOwnerSnapshot().traceCapacity.bytes < NORMAL_BYTES, true);
    if (target > NORMAL_EVENTS) c.check('normal-first-omitted-ordinal', c.handle.getOwnerSnapshot().traceCapacity.overflow.firstOmittedOrdinal, 4033);
  });

  for (const target of [983039, 983040, 983041]) await run(`normal-byte-count-${target}`, { attemptedNormalBytes: target, accepted: target <= NORMAL_BYTES }, async c => {
    c.initial();
    const prefix = c.handle.getOwnerSnapshot().traceCapacity.bytes;
    const selected = selectRawSize(c, target - prefix);
    c.mark('exact-raw-byte-construction', { prefixBytes: prefix, eventBytes: selected.size, target });
    c.clock.time = selected.now;
    const expectedFact = rawFact(c, selected.length, selected.now);
    c.raw('caller', 'stderr', Buffer.alloc(selected.length, 120));
    c.check('exact-attempted-normal-byte-count', prefix + bytes(expectedFact), target);
    c.check('normal-byte-event-retained', c.snap().trace.some(fact => fact.factId === expectedFact.factId), target <= NORMAL_BYTES);
    c.check('normal-byte-overflow', Boolean(c.handle.getOwnerSnapshot().traceCapacity.overflow), target > NORMAL_BYTES);
  });

  const fillNormal = c => {
    c.initial();
    const count = NORMAL_EVENTS - c.snap().trace.length;
    c.mark('repeat-empty-data', { count, reason: 'fill normal event pool before control reserve' });
    for (let i = 0; i < count; i++) c.stream('caller', 'stderr').emit('data', Buffer.alloc(0));
    c.check('normal-pool-exactly-full', c.snap().trace.length, NORMAL_EVENTS);
    c.check('normal-pool-has-no-omission', c.handle.getOwnerSnapshot().traceCapacity.overflow, null);
  };
  for (const target of [63, 64, 65]) await run(`control-reserve-events-${target}`, { attemptedReservedEvents: target, completeEvidence: false }, async c => {
    fillNormal(c);
    for (let i = 0; i < target; i++) c.event('caller', 'close');
    const capacity = c.handle.getOwnerSnapshot().traceCapacity;
    c.check('reserved-event-count', capacity.events - NORMAL_EVENTS, Math.min(target, 64));
    c.check('reserve-count-exhausted', capacity.controlOverflow, target > 64);
    c.check('reserve-bytes-not-preempted', capacity.bytes - c.snap().trace.slice(0, NORMAL_EVENTS).reduce((sum, fact) => sum + bytes(fact), 0) < 65536, true);
  }, { classification: 'expected-unverifiable' });

  for (const target of [65535, 65536, 65537]) await run(`control-reserve-bytes-${target}`, { attemptedReservedBytes: target, acceptedLastFact: target <= 65536, completeEvidence: false }, async c => {
    fillNormal(c);
    const base = c.handle.getOwnerSnapshot().traceCapacity.bytes;
    let used = 0;
    while (used + bytes(errorFact(c, 2048)) + bytes(errorFact(c, 0)) <= target) { c.error('caller', 2048); used = c.handle.getOwnerSnapshot().traceCapacity.bytes - base; }
    const length = target - used - bytes(errorFact(c, 0));
    c.check('final-control-message-in-range', length >= 0 && length <= 2048, true);
    const final = errorFact(c, length);
    c.error('caller', length);
    c.check('exact-attempted-control-bytes', used + bytes(final), target);
    c.check('control-byte-final-fact-retained', c.snap().trace.some(fact => fact.factId === final.factId), target <= 65536);
    c.check('control-byte-not-event-preempted', c.snap().trace.length - NORMAL_EVENTS < 64, true);
    c.check('control-byte-overflow-recorded', Boolean(c.handle.getOwnerSnapshot().traceCapacity.overflow), target > 65536);
  }, { classification: 'expected-unverifiable' });

  for (const target of [255, 256, 257]) await run(`late-events-${target}`, { attemptedLateEvents: target, repeatedClosePressure: true, byteLimitNotReached: true }, async c => {
    await c.helper('publisher'); c.check('late-baseline-empty', c.snap().lateJournal.length, 0);
    for (let i = 0; i < target; i++) c.event('publisher', 'close');
    const capacity = c.handle.getOwnerSnapshot().lateCapacity;
    c.check('late-event-capacity', capacity.events, Math.min(target, 256));
    c.check('late-event-overflow', capacity.overflow, target > 256);
    c.check('late-bytes-not-preempted', capacity.bytes < 65536, true);
  }, { publication: true });
  for (const target of [65535, 65536, 65537]) await run(`late-bytes-${target}`, { attemptedLateBytes: target, countLimitNotReached: true }, async c => {
    await c.helper('publisher'); const reportId = c.snap().reports.publication.reportId;
    let used = c.handle.getOwnerSnapshot().lateCapacity.bytes;
    while (used + lateBytes(errorFact(c, 2048, 'publisher'), reportId) + lateBytes(errorFact(c, 0, 'publisher'), reportId) <= target) {
      c.error('publisher', 2048); used = c.handle.getOwnerSnapshot().lateCapacity.bytes;
    }
    const length = target - used - lateBytes(errorFact(c, 0, 'publisher'), reportId);
    c.check('late-final-message-in-range', length >= 0 && length <= 2048, true);
    const final = errorFact(c, length, 'publisher'); c.error('publisher', length);
    c.check('exact-attempted-late-bytes', used + lateBytes(final, reportId), target);
    c.check('late-last-fact-retained', c.snap().lateJournal.some(fact => fact.factId === final.factId), target <= 65536);
    c.check('late-byte-overflow', c.handle.getOwnerSnapshot().lateCapacity.overflow, target > 65536);
    c.check('late-count-not-preempted', c.snap().lateJournal.length < 256, true);
  }, { publication: true });

  const terminalLike = size => { const line = Buffer.from('{"type":"caller-finished"}\n'); assert(size >= line.length); return Buffer.concat([Buffer.alloc(size - line.length, 32), line]); };
  for (const target of [255, 256, 257]) await run(`capture-held-events-${target}`, { attemptedHeldEvents: target, malformedTerminalPressure: true }, async c => {
    c.send('caller', 'caller-start', { scenario: c.spec.scenario });
    for (let i = 0; i < target; i++) c.raw('caller', 'stdout', terminalLike(27));
    const held = c.snap().trace.filter(fact => fact.event === 'gate-held');
    c.check('capture-held-count', held.length, Math.min(target, 256));
    c.check('capture-count-truncation', c.owner('caller').streams.stdout.cancelled, target > 256);
    c.check('capture-bytes-not-preempted', held.reduce((sum, fact) => sum + Buffer.from(fact.details.bytesBase64, 'base64').length, 0) < 65536, true);
  }, { capture: true });
  for (const target of [65535, 65536, 65537]) await run(`capture-held-bytes-${target}`, { attemptedHeldBytes: target, malformedTerminalPressure: true }, async c => {
    c.send('caller', 'caller-start', { scenario: c.spec.scenario });
    for (let i = 0; i < 16; i++) c.raw('caller', 'stdout', terminalLike(4090));
    c.raw('caller', 'stdout', terminalLike(target - 16 * 4090));
    const held = c.snap().trace.filter(fact => fact.event === 'gate-held');
    c.check('capture-held-byte-count', held.reduce((sum, fact) => sum + Buffer.from(fact.details.bytesBase64, 'base64').length, 0), target <= 65536 ? target : 16 * 4090);
    c.check('capture-byte-truncation', c.owner('caller').streams.stdout.cancelled, target > 65536);
    c.check('capture-count-not-preempted', held.length < 256, true);
  }, { capture: true });

  for (const target of [255, 256, 257]) await run(`listener-failures-${target}`, { throwingListeners: target, retainedLateFacts: 1, retainedFailures: Math.min(target, 256) }, async c => {
    await c.helper('publisher');
    c.mark('register-throwing-listeners', { count: target, distinctClosures: true });
    for (let i = 0; i < target; i++) c.handle.subscribeLateFacts(() => { throw new Error('synthetic listener failure'); });
    c.event('publisher', 'close');
    c.check('listener-not-inline', c.handle.getOwnerSnapshot().listenerFailures.length, 0);
    await c.flush();
    c.check('listener-failure-count', c.handle.getOwnerSnapshot().listenerFailures.length, Math.min(target, 256));
    c.check('one-retained-late-fact', c.snap().lateJournal.length, 1);
    c.check('listener-failure-overflow-marker', c.handle.getOwnerSnapshot().lateCapacity.overflow, target > 256);
  }, { publication: true });

  assert.equal(cases.length, 43);
  const classifications = Object.fromEntries(['structural-upper-bound', 'complete-replay', 'expected-unverifiable'].map(classification => {
    const selected = cases.filter(value => value.classification === classification);
    return [classification, { attempted: selected.length, passed: selected.filter(value => value.pass).length }];
  }));
  return { schema: 'diagnostic-capacity-fixtures-v3', attempted: cases.length, passed: cases.filter(value => value.pass).length,
    pass: cases.every(value => value.pass), classifications, acceptanceReady: false, realNodeCases: 0, nativeProcesses: 0, pty: false, cases };
}

async function main() {
  assert.equal(process.version, 'v22.23.2', 'D3 v3 capacity fixtures require the frozen Node 22.23.2 runtime');
  const args = process.argv.slice(2);
  assert(args.length === 2 && args[0] === '--out', 'Usage: node settlement-capacity-fixtures-v3.mjs --out NEW_DIRECTORY');
  const output = path.resolve(args[1]);
  fs.mkdirSync(output); fs.mkdirSync(path.join(output, 'sources')); fs.mkdirSync(path.join(output, 'cases'));
  const sourceFiles = ['diagnostic-settlement-v3.mjs', 'settlement-oracle-v3.mjs', 'settlement-fixtures-v3.mjs', 'settlement-capacity-fixtures-v3.mjs'];
  const sources = sourceFiles.map(file => {
    const source = fs.readFileSync(new URL(file, import.meta.url));
    fs.writeFileSync(path.join(output, 'sources', file), source, { flag: 'wx' });
    return { file, sha256: sha(source) };
  });
  fs.writeFileSync(path.join(output, 'input.json'), JSON.stringify({ schema: 'diagnostic-capacity-input-v3', node: process.version,
    scope: '43 public-API synthetic capacity cases; no child processes, PTY, runner, or production execution.', sources }, null, 2), { flag: 'wx' });
  const result = await runCapacitySelfTests({ onCase: value => {
    fs.writeFileSync(path.join(output, 'cases', `${value.id}.json`), JSON.stringify(value, null, 2), { flag: 'wx' });
    console.log(JSON.stringify({ id: value.id, pass: value.pass, classification: value.classification, error: value.error?.split('\n')[0] ?? null }));
  } });
  const summary = { ...result, cases: result.cases.map(({ id, pass, classification, error, verification }) => ({ id, pass, classification, error, verification })),
    sourcesUnchanged: sources.every(source => sha(fs.readFileSync(new URL(source.file, import.meta.url))) === source.sha256) };
  fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ output, attempted: summary.attempted, passed: summary.passed, pass: summary.pass, sourcesUnchanged: summary.sourcesUnchanged }));
  if (!summary.pass || !summary.sourcesUnchanged) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
