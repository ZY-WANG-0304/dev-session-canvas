import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { startObservedCase, startPublication } from './diagnostic-settlement-v3.mjs';
import { verifySavedCase, verifyPublicationSnapshot } from './settlement-oracle-v3.mjs';
import { VirtualClock, fakeTransport, makeProtocolFrame } from './settlement-fixtures-v3.mjs';

const CHANNELS = ['stdout', 'stderr', 'fd3'];
const bytes = value => Buffer.byteLength(JSON.stringify(value));
const clone = value => structuredClone(value);
const sha = value => createHash('sha256').update(value).digest('hex');
const ownerRole = input => input.owner.roles.find(role => role.role === 'publisher');
const firstRole = input => input.reports.publication.helpers.find(role => role.role === 'publisher');
const error = (message, code = 'EIO') => ({ name: 'Error', code, message });
const verify = input => (input.reports.publication ? verifyPublicationSnapshot : verifySavedCase)(input);

function context(id, publication = true) {
  const clock = new VirtualClock();
  const transport = fakeTransport(clock);
  const spec = { id: { schema: 'diagnostic-settlement-v3', runId: 'error-tamper', caseId: id, generation: 'g', nonce: id },
    scenario: 'synthetic-error-retention', entryPath: '/fixture/unused.mjs', artifactDirectory: '/fixture/a',
    ...(publication ? { archiveAttemptId: 'a', snapshotOrdinal: 1, payloadBase64: 'e30=' } : {}) };
  const actions = [{ action: publication ? 'start-publication' : 'start-case', atNs: '0', spec: clone(spec) }];
  const handle = (publication ? startPublication : startObservedCase)(spec, { clock, spawnRole: transport.spawnRole, pathStyle: 'posix' });
  const c = {
    clock, transport, spec, actions, handle,
    mark(action, details = {}) { actions.push({ action, atNs: String(clock.time), ...clone(details) }); },
    child(role = 'publisher') { return transport.children.get(role); },
    stream(channel, role = 'publisher') { return channel === 'fd3' ? c.child(role).stdio[3] : c.child(role)[channel]; },
    snapshot() { return handle.getEvidenceSnapshot(); },
    send(type, payload, role = 'publisher') {
      const child = c.child(role);
      const frame = { ...makeProtocolFrame(spec.id, role, ++child.sequence, type, payload, clock.time),
        attemptId: child.request.attemptId, requestId: child.request.requestId };
      const data = Buffer.from(`${JSON.stringify(frame)}\n`);
      const channel = type === 'caller-after-await' ? 'fd3' : 'stdout';
      c.mark('stream-data', { role, channel, bytesBase64: data.toString('base64') });
      c.stream(channel, role).emit('data', data);
    },
    emitError(record, channel = null) {
      c.mark('emit-error', { channel, error: record });
      (channel ? c.stream(channel) : c.child()).emit('error', clone(record));
    },
    async finish() {
      c.send('start', { scenario: spec.scenario });
      c.send('publish-entered', { mode: 'publish' });
      c.send('publish-claim', { files: 1, manifestSha256: '1'.repeat(64) });
      await c.exitAndEnd('publisher');
    },
    async exitAndEnd(role) {
      c.mark('exit', { role, code: 0, signal: null }); c.child(role).emit('exit', 0, null);
      for (const channel of CHANNELS) { c.mark('stream-end', { role, channel }); c.stream(channel, role).emit('end'); }
      await clock.flush();
    },
    async finishCase() {
      for (const [type, payload] of [['caller-start', { scenario: spec.scenario }], ['result-ready', {}],
        ['operation-returned', { kind: 'returned' }], ['caller-after-await', { kind: 'returned' }], ['caller-finished', { exitCode: 0 }]])
        c.send(type, payload, 'caller');
      await c.exitAndEnd('caller');
      for (const role of ['writer', 'verifier']) {
        c.send('start', { scenario: spec.scenario }, role);
        c.send(role === 'writer' ? 'write-entered' : 'verify-entered', { mode: role === 'writer' ? 'write' : 'verify' }, role);
        const encoded = c.child(role).request.payloadBase64;
        const payload = Buffer.from(role === 'writer' ? encoded : JSON.parse(Buffer.from(encoded, 'base64')).expectedPayloadBase64, 'base64');
        c.send(role === 'writer' ? 'seal-claim' : 'verified', { bytes: payload.length, sha256: sha(payload), manifestSha256: '1'.repeat(64) }, role);
        await c.exitAndEnd(role);
      }
    },
  };
  return c;
}

function recount(list, summary) {
  summary.retainedCount = list.length;
  summary.retainedJsonBytes = bytes(list);
}

// Keep unrelated structural accounting valid so the error proof must reject the mutation.
function refresh(input) {
  const facts = new Map();
  for (const [index, fact] of input.trace.entries()) { fact.eventOrdinal = index + 1; facts.set(fact.factId, fact); }
  for (const [name, report] of Object.entries(input.reports)) {
    const frozen = input.trace.find(fact => fact.event === 'report-frozen' && fact.details.name === name);
    if (frozen) report.eventOrdinal = frozen.eventOrdinal;
    report.factIds = report.factIds.filter(id => facts.has(id));
  }
  for (const ledger of [...input.owner.roles, ...Object.values(input.reports).flatMap(report => report.helpers ?? [])]) {
    if (ledger.exit && facts.has(ledger.exit.factId)) ledger.exit.eventOrdinal = facts.get(ledger.exit.factId).eventOrdinal;
  }
  input.lateJournal = input.lateJournal.filter(entry => facts.has(entry.factId)).map(entry => ({
    ...clone(facts.get(entry.factId)), lateFactId: entry.lateFactId, firstReportIds: entry.firstReportIds,
  }));
  input.owner.traceCapacity.events = input.trace.length;
  input.owner.traceCapacity.bytes = input.trace.reduce((size, fact) => size + bytes(fact), 0);
  input.owner.lateCapacity.events = input.lateJournal.length;
  input.owner.lateCapacity.bytes = input.lateJournal.reduce((size, fact) => size + bytes(fact), 0);
}

function replaceLateSource(input, change) {
  const source = input.trace.find(fact => fact.event === 'process-error');
  change(source.details);
  const role = ownerRole(input);
  role.errors[0] = { ...clone(source.details), factId: source.factId };
  role.errorCapacity.fieldsTruncated = Boolean(source.details.truncatedFields?.length);
  recount(role.errors, role.errorCapacity);
  input.owner.errorDiagnosticsComplete = !role.errorCapacity.fieldsTruncated;
}

export async function runErrorRetentionTamperSelfTests({ onBaseline, onCase } = {}) {
  const baselines = [];
  const sources = new Map();
  const baseline = async (id, operation, expectedComplete, publication = true) => {
    let c, snapshot, verification, failure = null;
    try {
      c = context(id, publication); await c.clock.flush(); await operation(c);
      snapshot = c.snapshot(); verification = verify(snapshot);
      if (!verification.pass || verification.errorDiagnosticsComplete !== expectedComplete)
        throw new Error(`baseline-proof:${JSON.stringify(verification)}`);
      if (snapshot.owner.traceCapacity.overflow || snapshot.owner.traceCapacity.controlOverflow)
        throw new Error('baseline-source-capacity-overflow');
      sources.set(id, snapshot);
    } catch (caught) { failure = caught.stack ?? String(caught); snapshot ??= c?.snapshot() ?? null; }
    const result = { id, synthetic: true, native: false, input: { spec: c?.spec, actions: c?.actions ?? [] },
      expected: { pass: true, errorDiagnosticsComplete: expectedComplete }, snapshot, verification, pass: failure === null, failure };
    baselines.push(result); await onBaseline?.(result);
  };
  await baseline('normal', c => c.finish(), true);
  await baseline('role-count', async c => {
    for (let index = 0; index < 258; index++) c.emitError(error(`role-${index}`));
    c.emitError(error('small-after-omission'));
    await c.finish();
  }, false);
  await baseline('stream-bytes', async c => {
    for (let index = 0; index < 34; index++) c.emitError(error(`${index}:`.padEnd(2048, 'x')), 'stderr');
    c.emitError(error('small-after-omission'), 'stderr');
    await c.finish();
  }, false);
  await baseline('listener-count', async c => {
    await c.finish();
    for (let index = 0; index < 258; index++) {
      const record = error(`listener-${index}`);
      c.mark('subscribe-throwing-late-listener', { error: record });
      c.handle.subscribeLateFacts(() => { throw clone(record); });
    }
    c.mark('consumer-after-await', { name: 'publication' });
    c.handle.recordConsumerAwait('publication');
    await c.clock.flush();
  }, false);
  await baseline('late-role', async c => { await c.finish(); c.emitError(error('late-0')); c.emitError(error('late-1')); }, true);
  await baseline('single-role', async c => { c.emitError(error('before-freeze')); await c.finish(); }, true);
  await baseline('destroy', async c => {
    c.mark('replace-destroy-with-throw', { channel: 'stderr', error: error('destroy') });
    c.stream('stderr').destroy = () => { throw error('destroy'); };
    c.mark('advance', { toNs: '2000000000' }); await c.clock.advance(2_000_000_000n);
  }, true);
  await baseline('case-listener', async c => {
    await c.finishCase();
    const record = error('case-listener');
    c.mark('subscribe-throwing-late-listener', { error: record });
    c.handle.subscribeLateFacts(() => { throw clone(record); });
    c.mark('consumer-after-await', { name: 'evidenceSettlement' });
    c.handle.recordConsumerAwait('evidenceSettlement'); await c.clock.flush();
  }, true, false);

  const cases = [];
  const run = async (id, variants) => {
    const results = [];
    for (const [name, source, mutate, expectedError] of variants) {
      let input = null, verification = null, failure = null;
      try {
        if (!sources.has(source)) throw new Error(`unavailable-baseline:${source}`);
        input = clone(sources.get(source)); mutate(input); refresh(input);
        verification = verify(input);
        if (verification.pass || !verification.errors.some(reason => expectedError.test(reason)))
          throw new Error(`mutation-not-rejected-by-error-proof:${JSON.stringify(verification)}`);
        if (verification.errorDiagnosticsComplete !== false)
          throw new Error(`invalid-error-proof-claimed-complete:${JSON.stringify(verification)}`);
      } catch (caught) { failure = caught.stack ?? String(caught); }
      results.push({ name, source, expectedError: expectedError.source, input, verification, pass: failure === null, failure });
    }
    const result = { id, expected: 'reject', synthetic: true, native: false, variants: results, pass: results.every(item => item.pass) };
    cases.push(result); await onCase?.(result);
  };
  for (const [number, field, limit] of [[1, 'name', 128], [2, 'code', 128], [3, 'message', 2048]])
    await run(`${number}-oversized-${field}`, [['utf8-byte-bound', 'late-role', v => replaceLateSource(v, e => { e[field] = '\u00e9'.repeat(limit / 2 + 1); }), /normalized-error/]]);
  await run('4-invalid-normalized-fields', [
    ['unknown-truncated-field', 'late-role', v => replaceLateSource(v, e => { e.truncatedFields = ['stack']; }), /normalized-error/],
    ['duplicate-truncated-field', 'late-role', v => replaceLateSource(v, e => { e.truncatedFields = ['message', 'message']; }), /normalized-error/],
    ['reversed-truncated-fields', 'late-role', v => replaceLateSource(v, e => { e.truncatedFields = ['message', 'name']; }), /normalized-error/],
    ['unpaired-surrogate', 'late-role', v => replaceLateSource(v, e => { e.message = '\ud800'; }), /normalized-error/],
  ]);
  await run('5-replaced-retained-text', [['stream', 'stream-bytes', v => { ownerRole(v).streams.stderr.errors[0].message = 'forged'; }, /owner-publisher-stderr-error-prefix/]]);
  await run('6-removed-retained-item', [['self-consistent-summary', 'role-count', v => {
    const role = ownerRole(v); role.errors.shift(); recount(role.errors, role.errorCapacity);
  }, /owner-publisher-error-prefix/]]);
  await run('7-over-cap-retention', [
    ['count', 'role-count', v => {
      const role = ownerRole(v), source = v.trace.find(f => f.factId === role.errorCapacity.firstOmittedSourceFactId);
      role.errors.push({ ...source.details, factId: source.factId }); recount(role.errors, role.errorCapacity);
    }, /owner-publisher-error-(prefix|capacity)/],
    ['bytes', 'stream-bytes', v => {
      const stream = ownerRole(v).streams.stderr, source = v.trace.find(f => f.factId === stream.errorCapacity.firstOmittedSourceFactId);
      stream.errors.push(source.details.error); recount(stream.errors, stream.errorCapacity);
    }, /owner-publisher-stderr-error-(prefix|capacity)/],
  ]);
  await run('8-reordered-prefix', [['role', 'role-count', v => { ownerRole(v).errors.reverse(); }, /owner-publisher-error-prefix/]]);
  await run('9-foreign-omission-source', [
    ['nonexistent', 'role-count', v => { ownerRole(v).errorCapacity.firstOmittedSourceFactId = 'absent'; }, /owner-publisher-error-capacity/],
    ['wrong-container', 'stream-bytes', v => { ownerRole(v).streams.stderr.errorCapacity.firstOmittedSourceFactId = v.trace[0].factId; }, /owner-publisher-stderr-error-capacity/],
  ]);
  await run('10-shifted-first-omission', [['later-source', 'role-count', v => {
    const summary = ownerRole(v).errorCapacity, index = v.trace.findIndex(f => f.factId === summary.firstOmittedSourceFactId);
    summary.firstOmittedSourceFactId = v.trace[index + 1].factId;
  }, /owner-publisher-error-capacity/]]);
  await run('11-forged-accounting', [
    ['count', 'role-count', v => { ownerRole(v).errorCapacity.retainedCount--; }, /owner-publisher-error-capacity/],
    ['json-array-bytes', 'stream-bytes', v => { ownerRole(v).streams.stderr.errorCapacity.retainedJsonBytes -= 2; }, /owner-publisher-stderr-error-capacity/],
  ]);
  await run('12-suppressed-omission', [['role', 'role-count', v => {
    Object.assign(ownerRole(v).errorCapacity, { omitted: false, firstOmittedSourceFactId: null }); v.owner.errorDiagnosticsComplete = true;
  }, /owner-publisher-error-capacity/]]);
  await run('13-invented-omission', [['all-inputs-fit', 'single-role', v => {
    Object.assign(ownerRole(v).errorCapacity, { omitted: true, firstOmittedSourceFactId: ownerRole(v).errors[0].factId }); v.owner.errorDiagnosticsComplete = false;
  }, /owner-publisher-error-capacity/]]);
  await run('14-missing-omission-source', [['summary-cannot-repair', 'role-count', v => {
    const missing = ownerRole(v).errorCapacity.firstOmittedSourceFactId; v.trace = v.trace.filter(f => f.factId !== missing);
  }, /owner-publisher-error-capacity/]]);
  await run('15-late-error-rewrites-first', [['ordinal-prefix', 'late-role', v => {
    firstRole(v).errors = clone(ownerRole(v).errors); firstRole(v).errorCapacity = clone(ownerRole(v).errorCapacity);
  }, /report-publication-publisher-error-prefix/]]);
  await run('16-first-error-suppressed', [['forged-success', 'single-role', v => {
    const report = v.reports.publication; report.kind = 'published'; report.errors = [];
    v.trace.find(f => f.event === 'report-frozen').details.kind = 'published';
    for (const role of [ownerRole(v), firstRole(v)]) { role.errors = []; recount(role.errors, role.errorCapacity); }
  }, /report-kind:publication:failed|owner-publisher-error-prefix/]]);
  await run('17-listener-without-source', [
    ['retained-summary-is-not-proof', 'listener-count', v => {
      v.trace = v.trace.filter(f => f.event !== 'listener-error');
    }, /owner-listener-error-(prefix|capacity)/],
    ['report-frozen-is-not-deliverable', 'case-listener', v => {
      const source = v.trace.find(f => f.event === 'report-frozen' && f.details.name === 'processSettlement');
      const failure = v.trace.find(f => f.event === 'listener-error');
      failure.details.sourceFactId = source.factId;
      v.owner.listenerFailures[0].factId = source.factId;
      recount(v.owner.listenerFailures, v.owner.listenerFailureCapacity);
      v.lateJournal = [{ ...clone(source), lateFactId: `${source.factId}:late`, firstReportIds: [v.reports.observation.reportId] }];
    }, /listener-error-delivery-source|ineligible-late-error-source/],
  ]);
  await run('18-destroy-without-source', [['retained-summary-is-not-proof', 'destroy', v => {
    v.trace = v.trace.filter(f => f.event !== 'stream-destroy-error');
  }, /owner-publisher-stderr-error-prefix/]]);
  await run('19-bounded-unique-reasons', [
    ['duplicate', 'single-role', v => { v.reports.publication.errors.push(v.reports.publication.errors[0]); }, /report-errors-bounded-unique-reasons/],
    ['unknown', 'destroy', v => { v.reports.publication.incomplete.push('new-unreviewed-reason'); }, /report-incomplete-bounded-unique-reasons/],
    ['unbounded', 'single-role', v => { v.reports.publication.errors.push('x'.repeat(65537)); }, /report-errors-bounded-unique-reasons/],
    ['unaccepted-failed-code', 'single-role', v => { v.reports.publication.errors.push('publisher-reported-failure:FOREIGN'); }, /report-errors-bounded-unique-reasons/],
  ]);
  await run('20-required-new-contract-fields', [
    ['policy', 'normal', v => { delete v.owner.errorPolicy; }, /owner-error-policy/],
    ['role-summary', 'normal', v => { delete ownerRole(v).errorCapacity; }, /owner-publisher-error-capacity/],
    ['stream-summary', 'normal', v => { delete ownerRole(v).streams.stdout.errorCapacity; }, /owner-publisher-stdout-error-capacity/],
    ['listener-summary', 'normal', v => { delete v.owner.listenerFailureCapacity; }, /owner-listener-error-capacity/],
    ['owner-completeness', 'normal', v => { delete v.owner.errorDiagnosticsComplete; }, /owner-error-diagnostics-complete/],
    ['report-completeness', 'normal', v => { delete v.reports.publication.errorDiagnosticsComplete; }, /report-publication-error-diagnostics-complete/],
  ]);
  return { baselines, cases, pass: baselines.every(item => item.pass) && cases.every(item => item.pass) };
}

async function main() {
  if (process.argv.length !== 4 || process.argv[2] !== '--out') throw new Error('Usage: settlement-error-retention-tamper-v3.mjs --out NEW_DIRECTORY');
  const out = path.resolve(process.argv[3]);
  fs.mkdirSync(out, { recursive: false });
  fs.mkdirSync(path.join(out, 'sources'));
  const names = ['diagnostic-settlement-v3.mjs', 'settlement-error-budget-v1.mjs', 'settlement-oracle-v3.mjs',
    'settlement-fixtures-v3.mjs', 'settlement-error-retention-tamper-v3.mjs'];
  const sources = names.map(name => {
    const source = new URL(name, import.meta.url), content = fs.readFileSync(source);
    fs.writeFileSync(path.join(out, 'sources', name), content, { flag: 'wx' });
    return { name, trustedSource: source.pathname, bytes: content.length, sha256: sha(content), archivedSourceExecuted: false };
  });
  const write = (name, value) => fs.writeFileSync(path.join(out, name), `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
  write('input.json', { schema: 'diagnostic-error-retention-tamper-v3', synthetic: true, native: false,
    execution: { entry: import.meta.url, node: process.execPath, nodeVersion: process.version }, sources });
  const result = await runErrorRetentionTamperSelfTests({
    onBaseline: item => write(`baseline-${item.id}.json`, item),
    onCase: item => write(`tamper-${item.id}.json`, item),
  });
  const sourceUnchanged = sources.every(source => sha(fs.readFileSync(new URL(source.name, import.meta.url))) === source.sha256);
  const summary = { pass: result.pass && sourceUnchanged, synthetic: true, native: false, sourceUnchanged,
    baselines: result.baselines.map(({ id, pass, failure, verification }) => ({ id, pass, failure, verification })),
    groups: result.cases.map(({ id, pass, variants }) => ({ id, pass, variants: variants.map(({ name, pass, failure, verification }) => ({ name, pass, failure, verification })) })),
    groupCount: result.cases.length, mutationCount: result.cases.reduce((count, item) => count + item.variants.length, 0), sources };
  write('result.json', summary);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (!summary.pass) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { process.stderr.write(`${error.stack ?? error}\n`); process.exitCode = 1; });
}
