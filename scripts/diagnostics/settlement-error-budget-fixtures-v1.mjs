import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { ERROR_POLICY, ErrorBudget, normalizeError } from './settlement-error-budget-v1.mjs';

const jsonBytes = value => Buffer.byteLength(JSON.stringify(value));
const clone = value => structuredClone(value);
const sha = value => createHash('sha256').update(value).digest('hex');
const ordinary = () => ({ name: 'Error', code: 'EIO', message: 'diagnostic failure' });
const record = length => ({ name: 'Error', code: 'EIO', message: 'x'.repeat(length) });

function observer() {
  const checks = [];
  return { checks, equal(label, actual, expected) {
    checks.push({ label, actual: clone(actual), expected: clone(expected), pass: JSON.stringify(actual) === JSON.stringify(expected) });
    assert.deepEqual(actual, expected, label);
  } };
}

export async function runErrorBudgetHelperTests({ onCase } = {}) {
  const cases = [];
  const run = async (id, input, operation) => {
    const o = observer(); let error = null;
    try { await operation(o); } catch (caught) { error = caught.stack ?? String(caught); }
    const result = { id, layer: 'helper-original-input', input, checks: o.checks, pass: error === null, error };
    cases.push(result); await onCase?.(result);
  };
  for (const field of ['name', 'code', 'message']) for (const delta of [-1, 0, 1]) {
    const limit = field === 'message' ? 2048 : 128;
    const value = 'x'.repeat(limit + delta);
    await run(`${field}-ascii-${limit + delta}`, { field, value, limit }, o => {
      const input = { ...ordinary(), [field]: value };
      o.equal('normalized', normalizeError(input), { ...input, [field]: value.slice(0, limit), ...(delta > 0 ? { truncatedFields: [field] } : {}) });
    });
  }
  for (const field of ['name', 'code', 'message']) for (const delta of [-1, 0, 1]) {
    const limit = field === 'message' ? 2048 : 128;
    const value = `${'x'.repeat(limit + delta - 3)}\u20ac`;
    await run(`${field}-utf8-${limit + delta}`, { field, value, limit }, o => {
      const input = { ...ordinary(), [field]: value };
      const expected = delta > 0 ? 'x'.repeat(limit - 2) : value;
      o.equal('normalized', normalizeError(input), { ...input, [field]: expected, ...(delta > 0 ? { truncatedFields: [field] } : {}) });
      o.equal('well-formed', normalizeError(input)[field].isWellFormed(), true);
    });
  }
  for (const field of ['name', 'code', 'message']) {
    const limit = field === 'message' ? 2048 : 128;
    const value = '\u0000'.repeat(limit + 1);
    await run(`${field}-json-escaping`, { field, value, limit }, o => {
      const normalized = normalizeError({ ...ordinary(), [field]: value });
      o.equal('utf8-field-bytes', Buffer.byteLength(normalized[field]), limit);
      o.equal('encoded-field-bytes', jsonBytes(normalized[field]), limit * 6 + 2);
      const budget = new ErrorBudget(); budget.append(normalized, 'source-1', true);
      o.equal('actual-array-bytes', budget.snapshot().retainedJsonBytes, jsonBytes([normalized]));
      o.equal('sticky-fields-truncated', budget.snapshot().fieldsTruncated, true);
    });
  }
  for (const field of ['name', 'code', 'message']) for (const failure of ['getter', 'conversion']) {
    await run(`${field}-${failure}-failure`, { field, failure, fallback: field === 'code' ? null : field === 'name' ? 'Error' : 'Uninspectable error' }, o => {
      const input = ordinary();
      if (failure === 'getter') Object.defineProperty(input, field, { get() { throw new Error('synthetic access failure'); } });
      else input[field] = { toString() { throw new Error('synthetic conversion failure'); } };
      const expected = { ...ordinary(), [field]: field === 'code' ? null : field === 'name' ? 'Error' : 'Uninspectable error', truncatedFields: [field] };
      o.equal('normalized', normalizeError(input), expected);
    });
  }
  await run('single-field-read', { accessorReadsExpected: { name: 1, code: 1, message: 1 } }, o => {
    const reads = { name: 0, code: 0, message: 0 }, input = {};
    for (const field of Object.keys(reads)) Object.defineProperty(input, field, { get() { reads[field]++; return ordinary()[field]; } });
    o.equal('normalized', normalizeError(input), ordinary());
    o.equal('read-counts', reads, { name: 1, code: 1, message: 1 });
  });
  await run('primitive-and-null', { values: ['text', null, 42, false], nullCode: true }, o => {
    for (const value of ['text', null, 42, false]) o.equal(`primitive:${String(value)}`, normalizeError(value), { name: 'Error', code: null, message: String(value) });
    o.equal('null-code-preserved', normalizeError({ name: 'Error', code: null, message: 'm' }), { name: 'Error', code: null, message: 'm' });
  });
  await run('isolated-surrogate', { message: 'a\ud800b\udc00c', expected: 'a\ufffdb\ufffdc' }, o => {
    o.equal('normalized', normalizeError({ ...ordinary(), message: 'a\ud800b\udc00c' }), { ...ordinary(), message: 'a\ufffdb\ufffdc', truncatedFields: ['message'] });
  });
  for (const target of [65535, 65536, 65537]) await run(`helper-array-bytes-${target}`, { attemptedJsonArrayBytes: target, includesBracketsAndCommas: true }, o => {
    const budget = new ErrorBudget(); let ordinal = 0;
    while (jsonBytes(budget.records) + 1 + jsonBytes(record(2048)) + 1 + jsonBytes(record(0)) <= target) budget.append(record(2048), `source-${++ordinal}`);
    const length = target - jsonBytes(budget.records) - (budget.records.length ? 1 : 0) - jsonBytes(record(0));
    o.equal('final-message-in-range', length >= 0 && length <= 2048, true);
    const final = record(length), attempted = [...budget.records, final];
    o.equal('exact-target', jsonBytes(attempted), target);
    const accepted = budget.append(final, `source-${++ordinal}`);
    o.equal('accepted-boundary', accepted, target <= 65536);
    o.equal('retained-bytes-independent', budget.snapshot().retainedJsonBytes, jsonBytes(budget.records));
    o.equal('count-not-preempted', budget.records.length < 256, true);
    o.equal('omitted', budget.snapshot().omitted, target > 65536);
    o.equal('first-omitted-source', budget.snapshot().firstOmittedSourceFactId, target > 65536 ? `source-${ordinal}` : null);
  });
  for (const target of [255, 256, 257]) await run(`helper-array-count-${target}`, { attemptedRecords: target }, o => {
    const budget = new ErrorBudget();
    for (let index = 1; index <= target; index++) budget.append(record(0), `source-${index}`);
    o.equal('retained-count', budget.snapshot().retainedCount, Math.min(target, 256));
    o.equal('bytes-not-preempted', budget.snapshot().retainedJsonBytes < 65536, true);
    o.equal('actual-array-bytes', budget.snapshot().retainedJsonBytes, jsonBytes(budget.records));
    o.equal('first-omitted-source', budget.snapshot().firstOmittedSourceFactId, target > 256 ? 'source-257' : null);
  });
  await run('omitted-prefix-remains-sealed', { accepted: 256, omittedSource: 'first-omitted', laterShortRecord: true }, o => {
    const budget = new ErrorBudget();
    for (let index = 0; index < 256; index++) budget.append(record(0), `source-${index}`);
    budget.append(record(0), 'first-omitted');
    const before = clone(budget.records); budget.append({}, 'later-short-record', true);
    o.equal('records-unchanged', budget.records, before);
    o.equal('first-source-sticky', budget.snapshot().firstOmittedSourceFactId, 'first-omitted');
    o.equal('omitted-field-loss-still-observed', budget.snapshot().fieldsTruncated, true);
  });
  await run('input-and-snapshot-isolation', { inputMutation: true, snapshotMutation: true }, o => {
    const budget = new ErrorBudget(), input = { ...record(0), truncatedFields: ['message'] };
    budget.append(input, 'source', true); input.message = 'changed'; input.truncatedFields.push('name');
    const snapshot = budget.snapshot(); snapshot.retainedJsonBytes = -1; snapshot.fieldsTruncated = false;
    o.equal('input-copy', budget.records, [{ ...record(0), truncatedFields: ['message'] }]);
    o.equal('fresh-snapshot', budget.snapshot(), { retainedCount: 1, retainedJsonBytes: jsonBytes(budget.records), omitted: false, firstOmittedSourceFactId: null, fieldsTruncated: true });
  });
  await run('fixed-policy', { expectedPolicy: { schema: 'diagnostic-error-retention-v1', nameBytes: 128, codeBytes: 128, messageBytes: 2048, entries: 256, jsonBytes: 65536 } }, o => {
    o.equal('policy', ERROR_POLICY, { schema: 'diagnostic-error-retention-v1', nameBytes: 128, codeBytes: 128, messageBytes: 2048, entries: 256, jsonBytes: 65536 });
    o.equal('frozen', Object.isFrozen(ERROR_POLICY), true);
    o.equal('empty-array-bytes', new ErrorBudget().snapshot().retainedJsonBytes, 2);
  });
  assert.equal(cases.length, 39);
  return { schema: 'diagnostic-error-budget-fixtures-v1', layer: 'helper-original-input', attempted: cases.length, passed: cases.filter(value => value.pass).length,
    pass: cases.every(value => value.pass), acceptanceReady: false, realNodeCases: 0, nativeProcesses: 0, pty: false, cases };
}

export async function runErrorBudgetPublicTests({ onCase } = {}) {
  const { startObservedCase, startPublication } = await import('./diagnostic-settlement-v3.mjs');
  const { verifySavedCase, verifyPublicationSnapshot } = await import('./settlement-oracle-v3.mjs');
  const { VirtualClock, fakeTransport, makeProtocolFrame } = await import('./settlement-fixtures-v3.mjs');
  const cases = [], channels = ['stdout', 'stderr', 'fd3'];
  const NS = 1000000n;
  const context = (options = {}) => {
    const clock = new VirtualClock(), transport = fakeTransport(clock, { spawnEvent: false });
    const publication = Boolean(options.publication), actions = [];
    const spec = { id: { schema: 'diagnostic-settlement-v3', runId: 'r', caseId: 'c', generation: 'g', nonce: 'n' }, scenario: 'synthetic-error-budget', entryPath: '/fixture/unused.mjs', artifactDirectory: '/a',
      ...(publication ? { archiveAttemptId: 'a', snapshotOrdinal: 1, payloadBase64: options.payloadBase64 ?? 'e30=' } : {}) };
    const spawnRole = (role, request) => {
      if (role === 'caller' && options.synchronousFailure) throw Object.assign(new Error('sync spawn failure'), { code: 'EIO' });
      const child = transport.spawnRole(role, request);
      if (role !== 'caller' || !options.asynchronousFailure) clock.queueMicrotask(() => child.emit('spawn'));
      return child;
    };
    const handle = (publication ? startPublication : startObservedCase)(spec, { clock, spawnRole, pathStyle: 'posix' });
    const c = { clock, transport, handle, spec, publication, actions,
      mark(action, details = {}) { actions.push({ action, atNs: String(clock.time), ...clone(details) }); },
      snap() { return handle.getEvidenceSnapshot(); },
      owner(role) { return handle.getOwnerSnapshot().roles.find(value => value.role === role); },
      child(role) { const child = transport.children.get(role); assert(child, `missing fake role ${role}`); return child; },
      stream(role, channel) { return channel === 'fd3' ? c.child(role).stdio[3] : c.child(role)[channel]; },
      async flush() { await clock.flush(); },
      raw(role, channel, data) { c.mark('data', { role, channel, bytesBase64: data.toString('base64') }); c.stream(role, channel).emit('data', data); },
      send(role, type, payload) {
        const child = c.child(role), frame = { ...makeProtocolFrame(spec.id, role, ++child.sequence, type, payload, clock.time), attemptId: child.request.attemptId, requestId: child.request.requestId };
        c.raw(role, type === 'caller-after-await' ? 'fd3' : 'stdout', Buffer.from(`${JSON.stringify(frame)}\n`));
      },
      event(role, event) { c.mark('process-event', { role, event }); c.child(role).emit(event, 0, null); },
      end(role) { for (const channel of channels) { c.mark('stream-end', { role, channel }); c.stream(role, channel).emit('end'); } },
      initial() { c.send('caller', 'caller-start', { scenario: spec.scenario }); c.send('caller', 'result-ready', {}); c.send('caller', 'operation-returned', { kind: 'returned' }); c.send('caller', 'caller-after-await', { kind: 'returned' }); c.send('caller', 'caller-finished', { exitCode: 0 }); },
      async caller() { c.initial(); c.event('caller', 'exit'); c.end('caller'); await c.flush(); },
      claim(role) {
        if (role === 'publisher') return { files: 1, manifestSha256: '1'.repeat(64) };
        const request = c.child(role).request;
        const payload = Buffer.from(role === 'writer' ? request.payloadBase64 : JSON.parse(Buffer.from(request.payloadBase64, 'base64')).expectedPayloadBase64, 'base64');
        return { bytes: payload.length, sha256: sha(payload), manifestSha256: '1'.repeat(64) };
      },
      async helper(role) {
        const action = { writer: 'write', verifier: 'verify', publisher: 'publish' }[role];
        c.send(role, 'start', { scenario: spec.scenario }); c.send(role, `${action}-entered`, { mode: action });
        c.send(role, { writer: 'seal-claim', verifier: 'verified', publisher: 'publish-claim' }[role], c.claim(role));
        c.event(role, 'exit'); c.end(role); await c.flush();
      },
      nextFactId() { return `n:fact:${c.snap().trace.at(-1).eventOrdinal + 1}`; },
      async finish() {
        if (publication) { if (!c.owner('publisher').spawnFailed && !c.owner('publisher').exit) await c.helper('publisher'); }
        else {
          if (!c.owner('caller').spawnFailed && !c.owner('caller').exit) c.event('caller', 'exit');
          if (!c.snap().capture && transport.children.has('caller')) c.end('caller');
          await c.flush();
          for (const role of ['writer', 'verifier']) if (transport.children.has(role) && !c.owner(role).exit && !c.owner(role).spawnFailed) await c.helper(role);
        }
        const reports = publication ? ['publication'] : ['observation', 'processSettlement', 'evidenceSettlement'];
        if (reports.some(name => !c.snap().reports[name])) { c.mark('advance', { toNs: String(clock.time + 10000n * NS) }); await clock.advance(clock.time + 10000n * NS); }
        for (const name of reports) assert(c.snap().reports[name], `missing first report ${name}`);
      },
    };
    return c;
  };
  const run = async (id, input, operation, options = {}) => {
    const o = observer(); let c, evidence, verification, error = null;
    try {
      c = context(options); await c.flush(); await operation(c, o); await c.finish(); evidence = c.snap();
      verification = (c.publication ? verifyPublicationSnapshot : verifySavedCase)(evidence);
      o.equal('independent-replay', verification.pass, true);
    } catch (caught) { error = caught.stack ?? String(caught); evidence = c?.snap() ?? null; }
    const result = { id, layer: 'public-api', input: { ...input, spec: c?.spec, actions: c?.actions ?? [] }, checks: o.checks, evidence, verification, pass: error === null, error };
    cases.push(result); await onCase?.(result);
  };
  const recordsOf = (c, kind) => kind === 'role' ? c.owner('caller').errors : kind === 'stream' ? c.owner('caller').streams.stderr.errors : c.handle.getOwnerSnapshot().listenerFailures;
  const capacityOf = (c, kind) => kind === 'role' ? c.owner('caller').errorCapacity : kind === 'stream' ? c.owner('caller').streams.stderr.errorCapacity : c.handle.getOwnerSnapshot().listenerFailureCapacity;
  const prepare = async (c, kind) => {
    if (kind === 'listener') {
      await c.helper('publisher');
      c.listenerInput = null;
      c.handle.subscribeLateFacts(() => { throw c.listenerInput; });
    } else c.initial();
  };
  const predictedRecord = (c, kind, value) => kind === 'role' ? { ...value, factId: c.nextFactId() } : kind === 'stream' ? value : { factId: c.nextFactId(), error: value };
  const inject = async (c, kind, value) => {
    c.mark('error-input', { kind, value });
    if (kind === 'role') c.child('caller').emit('error', value);
    else if (kind === 'stream') c.stream('caller', 'stderr').emit('error', value);
    else { c.listenerInput = value; c.event('publisher', 'close'); await c.flush(); }
    return c.snap().trace.filter(fact => fact.event === ({ role: 'process-error', stream: 'stream-error', listener: 'listener-error' })[kind]).at(-1).factId;
  };
  for (const kind of ['role', 'stream', 'listener']) for (const target of [255, 256, 257]) {
    await run(`${kind}-count-${target}`, { kind, attemptedRecords: target }, async (c, o) => {
      if (kind === 'listener') {
        await c.helper('publisher');
        c.mark('register-throwing-listeners', { count: target, value: record(0), distinctClosures: true });
        for (let index = 0; index < target; index++) c.handle.subscribeLateFacts(() => { throw record(0); });
        c.event('publisher', 'close'); await c.flush();
      } else {
        await prepare(c, kind);
        for (let index = 0; index < target; index++) await inject(c, kind, record(0));
      }
      const capacity = capacityOf(c, kind), retained = recordsOf(c, kind);
      o.equal('retained-count', capacity.retainedCount, Math.min(target, 256));
      o.equal('retained-array-bytes', capacity.retainedJsonBytes, jsonBytes(retained));
      o.equal('bytes-not-preempted', capacity.retainedJsonBytes < 65536, true);
      o.equal('omitted-boundary', capacity.omitted, target > 256);
      const sources = c.snap().trace.filter(fact => fact.event === ({ role: 'process-error', stream: 'stream-error', listener: 'listener-error' })[kind]);
      o.equal('first-omitted-source', capacity.firstOmittedSourceFactId, target > 256 ? sources[256].factId : null);
      if (kind === 'listener') o.equal('no-recursive-listener-error-delivery', c.snap().lateJournal.length, 1);
      if (target > 256 && kind !== 'listener') { await inject(c, kind, record(0)); o.equal('sealed-prefix', recordsOf(c, kind), retained); }
      o.equal('owner-diagnostic-completeness', c.handle.getOwnerSnapshot().errorDiagnosticsComplete, target <= 256);
    }, { publication: kind === 'listener' });
  }
  for (const kind of ['role', 'stream', 'listener']) for (const target of [65535, 65536, 65537]) {
    await run(`${kind}-bytes-${target}`, { kind, attemptedJsonArrayBytes: target, includesBracketsAndCommas: true }, async (c, o) => {
      await prepare(c, kind);
      while (jsonBytes(recordsOf(c, kind)) + 1 + jsonBytes(predictedRecord(c, kind, record(2048))) + 1 + jsonBytes(predictedRecord(c, kind, record(0))) <= target) await inject(c, kind, record(2048));
      const remainingMessage = target - jsonBytes(recordsOf(c, kind)) - (recordsOf(c, kind).length ? 1 : 0) - jsonBytes(predictedRecord(c, kind, record(0)));
      if (remainingMessage > 2048) await inject(c, kind, record(1024));
      const before = recordsOf(c, kind);
      const length = target - jsonBytes(before) - (before.length ? 1 : 0) - jsonBytes(predictedRecord(c, kind, record(0)));
      o.equal('final-message-in-range', length >= 0 && length <= 2048, true);
      o.equal('exact-attempted-array-bytes', jsonBytes([...before, predictedRecord(c, kind, record(length))]), target);
      const finalSource = await inject(c, kind, record(length));
      const capacity = capacityOf(c, kind), retained = recordsOf(c, kind);
      o.equal('retained-array-bytes', capacity.retainedJsonBytes, jsonBytes(retained));
      o.equal('retained-exact-target', capacity.retainedJsonBytes, target <= 65536 ? target : jsonBytes(before));
      o.equal('count-not-preempted', capacity.retainedCount < 256, true);
      o.equal('first-omitted-source', capacity.firstOmittedSourceFactId, target > 65536 ? finalSource : null);
      if (target > 65536) { await inject(c, kind, record(0)); o.equal('sealed-prefix', recordsOf(c, kind), retained); }
      o.equal('owner-diagnostic-completeness', c.handle.getOwnerSnapshot().errorDiagnosticsComplete, target <= 65536);
    }, { publication: kind === 'listener' });
  }
  await run('late-loss-preserves-first-report', { oversizedFieldBytes: 129, reportBeforeLoss: true }, async (c, o) => {
    await c.helper('publisher'); const first = c.snap().reports.publication;
    c.handle.subscribeLateFacts(() => { throw { ...record(0), name: 'n'.repeat(129) }; });
    c.event('publisher', 'close'); await c.flush();
    o.equal('first-report-immutable', c.snap().reports.publication, first);
    o.equal('first-complete-before-loss', first.errorDiagnosticsComplete, true);
    o.equal('owner-loss-now-visible', c.handle.getOwnerSnapshot().errorDiagnosticsComplete, false);
    o.equal('listener-loss-summary', c.handle.getOwnerSnapshot().listenerFailureCapacity.fieldsTruncated, true);
  }, { publication: true });
  await run('destroy-error-recorded-once', { role: 'writer', channel: 'stderr', stderrBytes: 16385, destroyThrows: true }, async (c, o) => {
    await c.caller(); let calls = 0;
    c.stream('writer', 'stderr').destroy = () => { calls++; throw { ...record(0), name: 'n'.repeat(129) }; };
    c.raw('writer', 'stderr', Buffer.alloc(16385, 120)); c.raw('writer', 'stderr', Buffer.alloc(1, 120));
    o.equal('destroy-called-once', calls, 1);
    const facts = c.snap().trace.filter(fact => fact.event === 'stream-destroy-error');
    o.equal('destroy-fact-count', facts.length, 1);
    o.equal('destroy-stream-ledger', c.owner('writer').streams.stderr.errors, [facts[0].details.error]);
    o.equal('destroy-field-loss', c.owner('writer').streams.stderr.errorCapacity.fieldsTruncated, true);
    await c.helper('writer');
    o.equal('existing-outcome-preserved', c.snap().reports.evidenceSettlement.kind, 'incomplete');
  });
  await run('public-input-snapshot-isolation', { mutateOriginalAfterEmit: true, attemptSnapshotMutation: true }, async (c, o) => {
    c.initial(); const input = record(3); await inject(c, 'role', input); input.message = 'changed';
    const owner = c.handle.getOwnerSnapshot(); let rejected = false;
    try { owner.roles[0].errors[0].message = 'changed by observer'; } catch (error) { rejected = error instanceof TypeError; }
    o.equal('snapshot-frozen', rejected, true);
    o.equal('stored-input-isolated', c.owner('caller').errors[0].message, 'xxx');
  });
  await run('request-error-entry', { source: 'stdin.error' }, async (c, o) => {
    c.initial(); c.mark('request-error', { value: record(5) }); c.child('caller').stdin.emit('error', record(5));
    const fact = c.snap().trace.find(fact => fact.event === 'request-error');
    o.equal('request-ledger-record', c.owner('caller').errors, [{ ...record(5), factId: fact.factId }]);
  });
  await run('synchronous-spawn-error-entry', { source: 'spawnRole throws' }, async (c, o) => {
    const fact = c.snap().trace.find(fact => fact.event === 'spawn-error');
    o.equal('spawn-failed', c.owner('caller').spawnFailed, true);
    o.equal('spawn-ledger-record', c.owner('caller').errors, [{ ...fact.details, factId: fact.factId }]);
  }, { synchronousFailure: true });
  await run('asynchronous-spawn-error-entry', { source: 'child.error before spawn' }, async (c, o) => {
    c.mark('spawn-error', { value: record(5) }); c.child('caller').emit('error', record(5)); c.end('caller'); await c.flush();
    const fact = c.snap().trace.find(fact => fact.event === 'spawn-error');
    o.equal('spawn-failed', c.owner('caller').spawnFailed, true);
    o.equal('spawn-ledger-record', c.owner('caller').errors, [{ ...record(5), factId: fact.factId }]);
  }, { asynchronousFailure: true });
  await run('launch-rejected-entry', { payloadBase64Bytes: 4194304, requestOverheadExceedsLimit: true }, async (c, o) => {
    const fact = c.snap().trace.find(fact => fact.event === 'launch-rejected');
    o.equal('never-spawned', c.transport.children.has('publisher'), false);
    o.equal('rejection-ledger-record', c.owner('publisher').errors, [{ ...fact.details.error, factId: fact.factId }]);
  }, { publication: true, payloadBase64: 'A'.repeat(4194304) });
  await run('kill-error-entry', { source: 'kill throws', atNs: '5000000000' }, async (c, o) => {
    c.initial(); c.child('caller').kill = () => { throw { ...record(0), code: 'c'.repeat(129) }; };
    c.mark('advance', { toNs: '5000000000' }); await c.clock.advance(5000n * NS);
    const attempt = c.owner('caller').controlAttempts[0];
    o.equal('control-error-normalized', attempt.error, { ...record(0), code: 'c'.repeat(128), truncatedFields: ['code'] });
    o.equal('control-loss-visible', c.handle.getOwnerSnapshot().errorDiagnosticsComplete, false);
  });
  for (const mode of ['write-throw', 'emitted-error']) await run(`ack-${mode}-entry`, { source: mode }, async (c, o) => {
    if (mode === 'write-throw') c.child('caller').stdio[4].write = () => { throw { ...record(0), message: 'm'.repeat(2049) }; };
    c.initial();
    if (mode === 'emitted-error') c.child('caller').stdio[4].emit('error', { ...record(0), message: 'm'.repeat(2049) });
    const fact = c.snap().trace.find(fact => fact.event === 'ack-error');
    o.equal('ack-error-normalized', fact.details.error, { ...record(0), message: 'm'.repeat(2048), truncatedFields: ['message'] });
    o.equal('ack-loss-visible', c.handle.getOwnerSnapshot().errorDiagnosticsComplete, false);
  });
  await run('core-normalizes-error-once', { accessorReadsExpected: { name: 1, code: 1, message: 1 } }, async (c, o) => {
    c.initial(); const input = {}, reads = { name: 0, code: 0, message: 0 };
    for (const field of Object.keys(reads)) Object.defineProperty(input, field, { get() { reads[field]++; return ordinary()[field]; } });
    c.mark('accessor-error', { expectedValues: ordinary() }); c.child('caller').emit('error', input);
    const fact = c.snap().trace.find(fact => fact.event === 'process-error');
    o.equal('single-normalization', reads, { name: 1, code: 1, message: 1 });
    o.equal('trace-and-ledger-reuse', c.owner('caller').errors, [{ ...fact.details, factId: fact.factId }]);
  });
  assert.equal(cases.length, 29);
  return { schema: 'diagnostic-error-budget-fixtures-v1', layer: 'public-api', attempted: cases.length, passed: cases.filter(value => value.pass).length,
    pass: cases.every(value => value.pass), acceptanceReady: false, realNodeCases: 0, nativeProcesses: 0, pty: false, cases };
}

async function main() {
  assert.equal(process.version, 'v22.23.2', 'Error-budget fixtures require frozen Node 22.23.2');
  const args = process.argv.slice(2);
  assert(args.length === 3 && ['--helpers-only', '--public-only'].includes(args[0]) && args[1] === '--out', 'Usage: node settlement-error-budget-fixtures-v1.mjs --helpers-only|--public-only --out NEW_DIRECTORY');
  const publicOnly = args[0] === '--public-only';
  const output = path.resolve(args[2]); fs.mkdirSync(output); fs.mkdirSync(path.join(output, 'sources')); fs.mkdirSync(path.join(output, 'cases'));
  const sourceFiles = ['settlement-error-budget-v1.mjs', 'settlement-error-budget-fixtures-v1.mjs', ...(publicOnly ? ['diagnostic-settlement-v3.mjs', 'settlement-oracle-v3.mjs', 'settlement-fixtures-v3.mjs'] : [])];
  const sources = sourceFiles.map(file => {
    const source = fs.readFileSync(new URL(file, import.meta.url));
    fs.writeFileSync(path.join(output, 'sources', file), source, { flag: 'wx' });
    return { file, sha256: sha(source) };
  });
  fs.writeFileSync(path.join(output, 'input.json'), JSON.stringify({ node: process.version, helperCases: publicOnly ? 0 : 39, publicCases: publicOnly ? 29 : 0, sources,
    scope: publicOnly ? 'Public API with virtual clock and fake transport; no native/PTY execution.' : 'Pure helper inputs; no core/native/PTY execution.' }, null, 2), { flag: 'wx' });
  const result = await (publicOnly ? runErrorBudgetPublicTests : runErrorBudgetHelperTests)({ onCase: value => {
    fs.writeFileSync(path.join(output, 'cases', `${value.id}.json`), JSON.stringify(value, null, 2), { flag: 'wx' });
    console.log(JSON.stringify({ id: value.id, pass: value.pass, error: value.error?.split('\n')[0] ?? null }));
  } });
  const summary = { ...result, cases: result.cases.map(({ id, pass, error }) => ({ id, pass, error })),
    sourcesUnchanged: sources.every(source => sha(fs.readFileSync(new URL(source.file, import.meta.url))) === source.sha256) };
  fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ output, attempted: summary.attempted, passed: summary.passed, sourcesUnchanged: summary.sourcesUnchanged }));
  if (!summary.pass || !summary.sourcesUnchanged) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
