// Frozen, injected contract cases. The evidence verifier never executes the model.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { MODEL_SCHEMA, openExecution } from './runtime-provider-lifecycle-model-v1.mjs';

const script = fileURLToPath(import.meta.url);
const modelPath = path.join(path.dirname(script), 'runtime-provider-lifecycle-model-v1.mjs');
const repo = path.resolve(path.dirname(script), '../..');
const schema = 'runtime-provider-lifecycle-evidence-v1';
const scope = 'Injected D1 contract model only; no PTY, native failure, actual Host/Webview, or production acceptance.';
const owners = ['reader', 'input', 'waiter', 'native'];
const defaultCapabilities = { source: true, resources: true, settlement: true };
const finalKeys = ['identity', 'binding', 'capabilities', 'process', 'source', 'seal', 'authority', 'data', 'revision', 'throughDataSequence', 'resources'];
const clone = value => structuredClone(value);
const sha256 = value => createHash('sha256').update(value).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const load = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const save = (file, value) => fs.writeFileSync(file, json(value), { flag: 'wx' });
const project = (value, keys) => Object.fromEntries(keys.map(key => [key, clone(value[key])]));

// This declarative expectation builder is separate from the async model. Its
// full input/expected-event schedule is fixed before any model is instantiated.
class Scenario {
  constructor(id, title) {
    this.entry = { id, group: id.slice(0, 3), title, steps: [] };
    this.states = new Map();
  }

  identity(execution) { return { executionId: `${this.entry.id}/${execution}`, generation: 'generation-1' }; }
  binding(execution) { return { backend: 'legacy-detached', storagePath: `/injected/${this.entry.id}/${execution}`, sessionId: `${this.entry.id}/${execution}`, authorityId: `${this.entry.id}/${execution}/authority`, generation: 'generation-1' }; }
  event(execution, event, detail = {}) { return { event, identity: this.identity(execution), detail: clone(detail) }; }
  add(action, events = []) {
    this.entry.steps.push({ action: clone(action), expected: clone(events) });
    for (const event of events) this.recordExpected(event);
    return this;
  }

  recordExpected({ identity, event, detail }) {
    const s = [...this.states.values()].find(state => state.identity.executionId === identity?.executionId);
    if (!s) return;
    if (event === 'data') { s.data.push(clone(detail)); s.queue.push({ type: 'data', sequence: detail.sequence, text: detail.text }); }
    if (event === 'resize') s.queue.push({ type: 'resize', ...detail });
    if (event === 'process') s.process = clone(detail.result);
    if (event === 'source') s.source = clone(detail.result);
    if (event === 'seal') s.seal = clone(detail.seal);
    if (event === 'parse-complete') { s.queue.shift(); s.revision = detail.revision; s.throughDataSequence = detail.throughDataSequence; }
    if (event === 'authority-final' || event === 'authority-failed') s.authority = clone(detail.result);
    if (event === 'resource') s.resources = clone(detail.result);
  }

  open(execution = 'a', capabilities = defaultCapabilities, startup = []) {
    const state = { identity: this.identity(execution), binding: this.binding(execution), capabilities: clone(capabilities),
      process: null, source: null, seal: null, authority: null, data: [], revision: 0, throughDataSequence: 0,
      resources: { kind: 'retained', reason: 'owner-created' }, queue: [] };
    this.states.set(execution, state);
    const first = this.entry.steps.length;
    this.add({ type: 'open', execution, identity: state.identity, binding: state.binding, capabilities, startup: [] },
      [this.event(execution, 'sink-ready', { binding: state.binding, capabilities })]);
    for (const action of startup) {
      if (action.type === 'process') this.process(action.result, execution);
      else if (action.type === 'data') this.data(action.text, execution);
      else if (action.type === 'source') this.end(action.result, execution);
      else throw new Error('Unsupported synchronous startup action');
    }
    const initial = this.entry.steps.splice(first);
    this.entry.steps.push({ action: { ...initial[0].action, startup: clone(startup) },
      expected: [...initial.flatMap(step => step.expected), this.event(execution, 'open-return')] });
    return this;
  }

  sealEvents(execution, process, source, lastDataSequence) {
    const s = this.states.get(execution);
    if (s.seal || !process || !source) return [];
    const seal = { ...s.identity, process, source, lastDataSequence };
    const events = [this.event(execution, 'seal', { seal })];
    if (s.queue.length === 0 && !s.authority) events.push(this.event(execution, 'authority-final', {
      result: { kind: 'applied', finalRevision: s.revision, throughDataSequence: s.throughDataSequence }
    }));
    return events;
  }

  process(result = { kind: 'exited', exitCode: 0 }, execution = 'a') {
    const s = this.states.get(execution);
    return this.add({ type: 'process', execution, result }, [this.event(execution, 'process', { result }),
      ...this.sealEvents(execution, result, s.source, s.data.length)]);
  }

  data(text = 'TAIL\r\n', execution = 'a') {
    return this.add({ type: 'data', execution, text }, [this.event(execution, 'data', {
      sequence: this.states.get(execution).data.length + 1, text, origin: 'provider'
    })]);
  }

  end(disposition = { kind: 'eof' }, execution = 'a') {
    const s = this.states.get(execution);
    const result = s.capabilities.source ? { ...disposition, lastDataSequence: s.data.length } :
      { kind: 'unknown', reason: 'provider-capability-unproven', lastDataSequence: s.data.length };
    return this.add({ type: 'source', execution, result: disposition }, [this.event(execution, 'source', { result }),
      ...this.sealEvents(execution, s.process, result, s.data.length)]);
  }

  parseStart(execution = 'a') {
    return this.add({ type: 'parse-start', execution }, [this.event(execution, 'parse-start', { operation: this.states.get(execution).queue[0] }),
      this.event(execution, 'parser-promise-observed', { status: 'pending' })]);
  }

  parseComplete(execution = 'a') {
    const s = this.states.get(execution);
    const revision = s.revision + 1;
    const throughDataSequence = s.queue[0].type === 'data' ? s.queue[0].sequence : s.throughDataSequence;
    const events = [this.event(execution, 'parse-complete', { revision, throughDataSequence })];
    if (s.seal && s.queue.length === 1) events.push(this.event(execution, 'authority-final', {
      result: { kind: 'applied', finalRevision: revision, throughDataSequence }
    }));
    events.push(this.event(execution, 'parser-promise-observed', { status: 'fulfilled' }));
    return this.add({ type: 'parse-complete', execution }, events);
  }

  drain(execution = 'a') {
    while (this.states.get(execution).queue.length) this.parseStart(execution).parseComplete(execution);
    return this;
  }

  probe(expected, execution = 'a') {
    return this.add({ type: 'probe', execution, expected }, [this.event(execution, 'observation', { actual: expected })]);
  }

  reject(action, code, execution = 'a') {
    return this.add({ ...action, execution }, [this.event(execution, 'fault', { code })]);
  }

  simple(action, event, detail = {}, execution = 'a') {
    return this.add({ ...action, execution }, [this.event(execution, event, detail)]);
  }

  release(execution = 'a', requestId = 'release-1', params = { reason: 'source-sealed' }) {
    this.states.get(execution).releaseHandleCount = 1;
    return this.add({ type: 'release', execution, requestId, params }, [this.event(execution, 'release-start', { requestId, params, owners }),
      this.event(execution, 'release-handle-observed', { requestId, actualPromise: true, reused: false })]);
  }

  released(execution = 'a', requestId = 'release-1') {
    const result = this.states.get(execution).capabilities.resources ? { kind: 'released' } : { kind: 'unknown', reason: 'resource-capability-unproven' };
    return this.add({ type: 'release-return', execution, requestId }, [this.event(execution, 'resource', { operationId: requestId, result }),
      this.event(execution, 'release-promises-observed', { requestId,
        results: Array.from({ length: this.states.get(execution).releaseHandleCount }, () => ({ status: 'fulfilled', value: result })) })]);
  }

  readAction(type, readId = 'read-1', execution = 'a', rest = {}) {
    return { type, execution, readId, owner: 'connection-1', authorityId: this.binding(execution).authorityId, ...rest };
  }

  readOpen(readId = 'read-1', execution = 'a', ready = true, surface = 'editor') {
    const action = this.readAction('read-open', readId, execution, { surface });
    this.add(action, [this.event(execution, 'read-begin', { readId, owner: action.owner, authorityId: action.authorityId, surface })]);
    if (ready) this.readReady(readId, execution);
    return this;
  }

  readReady(readId = 'read-1', execution = 'a') {
    return this.add(this.readAction('read-ready', readId, execution), [this.event(execution, 'read-ready', { readId })]);
  }

  page(readId = 'read-1', execution = 'a') {
    const revision = this.states.get(execution).revision;
    this.add(this.readAction('page-send', readId, execution, { revision }), [this.event(execution, 'page-sent', { readId, revision })]);
    this.add(this.readAction('page-apply', readId, execution, { revision }), [this.event(execution, 'consumer-write-start', { readId, revision }),
      this.event(execution, 'consumer-write-callback', { readId, revision }), this.event(execution, 'page-applied', { readId, revision })]);
    return this;
  }

  settle(outcome, readId = 'read-1', execution = 'a') {
    const action = this.readAction('read-settle', readId, execution, outcome ? { outcome } : {});
    return this.add(action, [this.event(execution, 'reader-settled', { readId, outcome: outcome ?? { kind: 'legacy-released' } })]);
  }

  applied(readId = 'read-1', execution = 'a') {
    return this.settle({ kind: 'applied', finalRevision: this.states.get(execution).revision }, readId, execution);
  }

  finish() {
    this.entry.final = [...this.states.values()].map(s => project(s, finalKeys));
    return clone(this.entry);
  }
}

export function makeSchedule() {
  const cases = [];
  const add = b => cases.push(b.finish());
  const scenario = (id, title) => new Scenario(id, title);
  const exited = { kind: 'exited', exitCode: 7 };
  let b = scenario('M01', 'Synchronous pre-return startup and process-before-tail');
  b.open('a', defaultCapabilities, [{ type: 'process', result: exited }, { type: 'data', text: 'FIRST\r\n' }, { type: 'source', result: { kind: 'eof' } }])
    .probe({ authority: null, queuedOperations: 1 }).drain(); add(b);
  add(scenario('M02', 'Empty source before process').open().end().probe({ seal: null }).process().probe({ revision: 0 }));
  add(scenario('M03', 'Signal-only without invented exit code').open().process({ kind: 'signaled', signal: 'SIGTERM' }).end());
  b = scenario('M04', 'Wait unknown, continued data and late termination proof').open();
  b.process({ kind: 'unconfirmed', reason: 'wait-channel-lost' }).data('KNOWN\r\n').end()
    .process(exited).drain().probe({ openAdmission: false }); add(b);
  add(scenario('M05', 'Termination proven but status unavailable').open().process({ kind: 'terminated', reason: 'exit-status-query-failed' }).end());
  b = scenario('M06', 'Decoder tail is transferred before source end').open().data('UTF8:');
  b.simple({ type: 'decoder-buffer', text: '\ufffd' }, 'decoder-buffered', { text: '\ufffd' });
  b.reject({ type: 'source', result: { kind: 'eof' } }, 'source-has-owned-data');
  b.add({ type: 'decoder-flush', execution: 'a' }, [b.event('a', 'decoder-flushed'), b.event('a', 'data', { sequence: 2, text: '\ufffd', origin: 'decoder' })]);
  b.process().end().drain(); add(b);
  add(scenario('M07-gap', 'Reject non-contiguous authority transfer').open().reject({ type: 'inject-transfer', sequence: 2, text: 'GAP' }, 'non-contiguous-data-sequence').probe({ queuedOperations: 0, data: [] }));
  add(scenario('M07-conflict', 'Reject conflicting duplicate transfer').open().data('ONE').reject({ type: 'inject-transfer', sequence: 1, text: 'OTHER' }, 'conflicting-data-sequence').drain());
  add(scenario('M07-late', 'Reject data after source seal').open().process().end().reject({ type: 'data', text: 'LATE' }, 'data-after-source'));
  add(scenario('M07-seal', 'Reject inconsistent final sequence').open().data('ONE').reject({ type: 'inject-seal', lastDataSequence: 2, sourceLastDataSequence: 1 }, 'seal-watermark-mismatch').probe({ seal: null }).process().end().drain());
  b = scenario('M08', 'Repeated exact terminal observations are idempotent').open().process(exited).end();
  b.simple({ type: 'process', result: exited }, 'process-duplicate', { result: exited });
  b.simple({ type: 'source', result: { kind: 'eof' } }, 'source-duplicate', { result: { kind: 'eof', lastDataSequence: 0 } }); add(b);
  b = scenario('M09', 'Stop intent still permits natural EOF').open();
  b.simple({ type: 'stop', requestId: 'stop-1', mode: 'graceful' }, 'request', { kind: 'stop', requestId: 'stop-1', params: { mode: 'graceful' } });
  b.data().process(exited).end().drain(); add(b);
  b = scenario('M10', 'EOF before cancellation takes effect').open();
  b.simple({ type: 'cancel', requestId: 'cancel-1', reason: 'owner-request' }, 'request', { kind: 'cancel', requestId: 'cancel-1', params: { reason: 'owner-request' } });
  b.process().end().reject({ type: 'cancel-effective' }, 'invalid-cancel-effect').probe({ cancelRequested: true, cancelEffective: false }); add(b);
  b = scenario('M11', 'Effective cancellation preserves successful in-flight data').open();
  b.simple({ type: 'read-start', id: 'native-read-1' }, 'read-start', { id: 'native-read-1' });
  b.simple({ type: 'cancel', requestId: 'cancel-1', reason: 'delete' }, 'request', { kind: 'cancel', requestId: 'cancel-1', params: { reason: 'delete' } });
  b.simple({ type: 'cancel-effective' }, 'cancel-effective');
  b.reject({ type: 'read-start', id: 'native-read-2' }, 'read-admission-closed');
  b.reject({ type: 'source', result: { kind: 'interrupted', reason: 'cancel-effective' } }, 'source-has-owned-data');
  b.add({ type: 'read-return', execution: 'a', id: 'native-read-1', text: 'IN-FLIGHT' }, [b.event('a', 'read-return', { id: 'native-read-1' }), b.event('a', 'data', { sequence: 1, text: 'IN-FLIGHT', origin: 'read' })]);
  b.process().end({ kind: 'interrupted', reason: 'cancel-effective' }).drain(); add(b);
  b = scenario('M12', 'Pending native read cannot be sealed by a deadline').open().process();
  b.simple({ type: 'read-start', id: 'never-returned' }, 'read-start', { id: 'never-returned' });
  b.simple({ type: 'source-budget' }, 'source-observation', { kind: 'pending', pendingReads: ['never-returned'], pendingMessages: [] });
  b.probe({ source: null, seal: null, pendingReads: ['never-returned'], resources: { kind: 'retained', reason: 'owner-created' } }); add(b);
  b = scenario('M13', 'Worker loss preserves already-owned messages').open();
  b.simple({ type: 'queue-message', id: 'message-1', text: 'OWNED' }, 'worker-queued', { id: 'message-1', text: 'OWNED' });
  b.reject({ type: 'source', result: { kind: 'unknown', reason: 'worker-lost' } }, 'source-has-owned-data');
  b.add({ type: 'deliver-message', execution: 'a', id: 'message-1' }, [b.event('a', 'worker-delivered', { id: 'message-1' }), b.event('a', 'data', { sequence: 1, text: 'OWNED', origin: 'worker' })]);
  b.process().end({ kind: 'unknown', reason: 'worker-lost' }).drain(); add(b);
  b = scenario('M14', 'Actual deferred parser gates final authority revision').open().data('A');
  b.simple({ type: 'resize', cols: 100, rows: 40 }, 'resize', { cols: 100, rows: 40 });
  b.process().end().parseStart().probe({ parserPending: true, authority: null, revision: 0, queuedOperations: 2 });
  b.parseComplete().parseStart().probe({ parserPending: true, authority: null, revision: 1 }).parseComplete(); add(b);
  b = scenario('M15', 'Parser failure preserves only the applied prefix').open().data('FIRST').data('REJECTED').process().end();
  b.parseStart().parseComplete().parseStart();
  b.add({ type: 'parse-fail', execution: 'a', reason: 'injected-parser-rejection' }, [b.event('a', 'authority-failed', {
    result: { kind: 'failed', throughDataSequence: 1, reason: 'injected-parser-rejection' } }),
  b.event('a', 'parser-promise-observed', { status: 'rejected', reason: 'injected-parser-rejection' })]);
  b.probe({ revision: 1, queuedOperations: 1, parserPending: false }); add(b);
  b = scenario('M16', 'Native owner can release before page and tracker application').open().readOpen().data('INDEPENDENT').process().end().release().released();
  b.probe({ authority: null, queuedOperations: 1 }).drain().page().applied(); add(b);
  b = scenario('M17', 'Late same-operation release does not rewrite unknown observation').open().data().process().end().release();
  b.simple({ type: 'release-timeout', requestId: 'release-1' }, 'resource', { operationId: 'release-1', result: { kind: 'unknown', reason: 'observation-deadline' } });
  b.probe({ resources: { kind: 'unknown', reason: 'observation-deadline' } }).released().drain(); add(b);
  b = scenario('M18-repeat', 'Repeated release shares the original pending promise').open().process().end().release();
  b.add({ type: 'release', execution: 'a', requestId: 'release-1', params: { reason: 'source-sealed' } }, [b.event('a', 'release-reused', { requestId: 'release-1' }),
    b.event('a', 'release-handle-observed', { requestId: 'release-1', actualPromise: true, reused: true })]);
  b.states.get('a').releaseHandleCount = 2;
  b.released(); add(b);
  b = scenario('M18-conflict', 'Conflicting release parameters are rejected').open().process().end().release();
  b.reject({ type: 'release', requestId: 'release-1', params: { reason: 'different' } }, 'conflicting-release').released(); add(b);
  b = scenario('M19', 'Execution identities isolate equal data sequences').open('a').open('b').data('A', 'a').data('B', 'b');
  b.reject({ type: 'data', text: 'STALE', identity: { ...b.identity('a'), generation: 'old-generation' } }, 'execution-identity');
  b.process(undefined, 'a').end(undefined, 'a').drain('a').process(undefined, 'b').end(undefined, 'b').drain('b'); add(b);
  b = scenario('M20', 'Independent readers apply and cancel separately').open().readOpen('read-1').readOpen('read-2', 'a', true, 'panel').data().process().end().drain();
  b.settle({ kind: 'cancelled', reason: 'panel-closed' }, 'read-2').page('read-1').applied('read-1').probe({ readers: [] }); add(b);
  b = scenario('M21-before-final', 'Reject applied before final target exists').open().readOpen();
  b.reject(b.readAction('read-settle', 'read-1', 'a', { outcome: { kind: 'applied', finalRevision: 0 } }), 'unproven-final-application'); add(b);
  b = scenario('M21-not-delivered', 'Reject applied beyond delivered data').open().readOpen().data().process().end().drain();
  b.reject(b.readAction('read-settle', 'read-1', 'a', { outcome: { kind: 'applied', finalRevision: 1 } }), 'unproven-final-application'); add(b);
  b = scenario('M21-old-reader', 'Reject stale read identity').open().readOpen().process().end();
  b.reject(b.readAction('read-settle', 'old-read', 'a', { outcome: { kind: 'applied', finalRevision: 0 } }), 'reader-identity'); add(b);
  b = scenario('M22', 'In-flight open blocks retirement but final target blocks new opens').open().readOpen('read-1', 'a', false).data().process().end().drain().release().released();
  b.simple({ type: 'metadata-save' }, 'metadata-saved').reject({ type: 'retire' }, 'retirement-precondition');
  b.reject(b.readAction('read-open', 'read-2', 'a', { surface: 'panel' }), 'open-after-final').readReady().page().applied();
  b.probe({ retireEligible: true }).simple({ type: 'retire' }, 'retired'); add(b);
  b = scenario('M23', 'Lost and legacy readers release without applied claims').open().readOpen('read-1').readOpen('read-2', 'a', true, 'panel').process().end();
  b.settle(undefined, 'read-2');
  b.simple({ type: 'disconnect', owner: 'connection-1' }, 'reader-settled', { readId: 'read-1', outcome: { kind: 'lost', reason: 'connection-closed' } });
  b.probe({ readers: [] }); add(b);
  for (let mask = 0; mask < 8; mask += 1) {
    const capabilities = { source: Boolean(mask & 4), resources: Boolean(mask & 2), settlement: Boolean(mask & 1) };
    b = scenario(`M24-${mask.toString(2).padStart(3, '0')}`, 'Independent source, resource, and reader capabilities').open('a', capabilities).readOpen().data().process().end().drain().release().released().page();
    if (capabilities.settlement) b.applied();
    else {
      b.reject(b.readAction('read-settle', 'read-1', 'a', { outcome: { kind: 'applied', finalRevision: 1 } }), 'settlement-not-negotiated');
      b.settle();
    }
    b.probe({ binding: b.binding('a') }); add(b);
  }
  assert.equal(cases.length, 37);
  assert.equal(new Set(cases.map(entry => entry.group)).size, 24);
  return { schema, modelSchema: MODEL_SCHEMA, scope, groups: 24, subcases: 37, entries: cases };
}

function expectedTrace(entry) {
  const rows = [];
  const append = (step, event) => rows.push({ index: rows.length + 1, step, ...clone(event) });
  entry.steps.forEach((step, index) => {
    append(index + 1, { event: 'input', detail: step.action });
    for (const event of step.expected) append(index + 1, event);
  });
  append(entry.steps.length + 1, { event: 'case-finish', detail: { states: entry.final } });
  return rows;
}

async function executeCase(entry, sink = () => {}) {
  const models = new Map();
  const parserObservations = new Map();
  const releaseHandles = new Map();
  const rows = [];
  let stepNumber = 0;
  const emit = event => {
    const row = { index: rows.length + 1, step: stepNumber, ...clone(event) };
    rows.push(row);
    sink(row);
  };
  for (const step of entry.steps) {
    stepNumber += 1;
    const action = step.action;
    emit({ event: 'input', detail: action });
    if (action.type === 'open') {
      assert(!models.has(action.execution));
      const model = openExecution(action, emit, execution => {
        for (const startup of action.startup) execution.perform(startup);
      });
      models.set(action.execution, model);
      emit({ event: 'open-return', identity: model.identity, detail: {} });
    } else if (action.type === 'probe') {
      const model = models.get(action.execution);
      emit({ event: 'observation', identity: model.identity, detail: { actual: project(model.inspect(), Object.keys(action.expected)) } });
    } else {
      const model = models.get(action.execution);
      if (action.type === 'page-apply') {
        const detail = { readId: action.readId, revision: action.revision };
        emit({ event: 'consumer-write-start', identity: model.identity, detail });
        await new Promise(resolve => setImmediate(() => {
          emit({ event: 'consumer-write-callback', identity: model.identity, detail });
          resolve();
        }));
      }
      const returned = model.perform(action);
      if (action.type === 'parse-start' && model.parsing) {
        parserObservations.set(action.execution, watchPromise(model.parsing.parserPromise, false));
      }
      const result = await returned;
      if (action.type === 'parse-start' || action.type === 'parse-complete' || action.type === 'parse-fail') {
        emit({ event: 'parser-promise-observed', identity: model.identity, detail: parserObservations.get(action.execution)() });
      }
      if (action.type === 'release' && result?.promise !== false) {
        const actualPromise = result?.promise instanceof Promise;
        const handles = releaseHandles.get(action.execution) ?? [];
        const reused = handles.length > 0 && handles[0].promise === result?.promise;
        handles.push({ promise: result?.promise, observe: actualPromise ? watchPromise(result.promise, true) : () => ({ status: 'not-a-promise' }) });
        releaseHandles.set(action.execution, handles);
        emit({ event: 'release-handle-observed', identity: model.identity, detail: { requestId: action.requestId, actualPromise, reused } });
      }
      if (action.type === 'release-return') {
        emit({ event: 'release-promises-observed', identity: model.identity, detail: {
          requestId: action.requestId, results: (releaseHandles.get(action.execution) ?? []).map(handle => handle.observe())
        } });
      }
    }
  }
  stepNumber += 1;
  emit({ event: 'case-finish', detail: { states: [...models.values()].map(model => project(model.inspect(), finalKeys)) } });
  return rows;
}

function watchPromise(promise, includeValue) {
  let observation = { status: 'pending' };
  promise.then(value => { observation = { status: 'fulfilled', ...(includeValue ? { value: clone(value) } : {}) }; },
    error => { observation = { status: 'rejected', reason: error.message }; });
  return () => clone(observation);
}

// Expected traces come only from the frozen declarative fixtures, not model
// replay, saved summary booleans, or expectations supplied by an artifact.
export function validateTrace(entry, trace) {
  assert(Array.isArray(trace), 'Trace must be an array');
  const expected = expectedTrace(entry);
  assert.equal(trace.length, expected.length, `${entry.id}: event count`);
  for (let index = 0; index < expected.length; index += 1) {
    assert.deepEqual(trace[index], expected[index], `${entry.id}: raw event ${index + 1}`);
  }
  const bound = new Set();
  const ended = new Set();
  const final = new Set();
  const sequences = new Map();
  const consumerWrites = new Map();
  const consumerApplied = new Map();
  for (const event of trace) {
    const id = event.identity?.executionId;
    if (event.event === 'sink-ready') bound.add(id);
    if (event.identity && event.event !== 'sink-ready') assert(bound.has(id), 'Event before authority sink');
    if (event.event === 'data') {
      assert(!ended.has(id), 'Data after source end');
      const next = (sequences.get(id) ?? 0) + 1;
      assert.equal(event.detail.sequence, next);
      sequences.set(id, next);
    }
    if (event.event === 'source') {
      assert(!ended.has(id));
      assert.equal(event.detail.result.lastDataSequence, sequences.get(id) ?? 0);
      ended.add(id);
    }
    if (event.event === 'seal') {
      assert(ended.has(id));
      assert(!final.has(id), 'Repeated output seal');
      assert.equal(event.detail.seal.lastDataSequence, sequences.get(id) ?? 0);
      assert.equal(event.detail.seal.source.lastDataSequence, event.detail.seal.lastDataSequence);
      final.add(id);
    }
    if (event.event === 'authority-final') assert(final.has(id), 'Authority final before source seal');
    const readerKey = `${id}/${event.detail?.readId}`;
    if (event.event === 'consumer-write-start') consumerWrites.set(readerKey, { revision: event.detail.revision, callback: false });
    if (event.event === 'consumer-write-callback') {
      assert.equal(consumerWrites.get(readerKey)?.revision, event.detail.revision, 'Consumer callback without matching write');
      consumerWrites.get(readerKey).callback = true;
    }
    if (event.event === 'page-applied') {
      assert(consumerWrites.get(readerKey)?.callback, 'Applied before the simulated consumer callback');
      assert.equal(consumerWrites.get(readerKey).revision, event.detail.revision);
      consumerApplied.set(readerKey, event.detail.revision);
    }
    if (event.event === 'reader-settled' && event.detail.outcome.kind === 'applied') {
      assert.equal(consumerApplied.get(readerKey), event.detail.outcome.finalRevision, 'Applied receipt lacks a consumer callback');
    }
  }
  return { events: trace.length, injections: entry.steps.length, expectedFaults: trace.filter(event => event.event === 'fault').map(event => event.detail.code) };
}

function walk(dir, relative = '') {
  return fs.readdirSync(path.join(dir, relative), { withFileTypes: true }).flatMap(entry => {
    assert(!entry.isSymbolicLink(), 'Evidence must not contain symlinks');
    const name = relative ? `${relative}/${entry.name}` : entry.name;
    return entry.isDirectory() ? walk(dir, name) : [name];
  }).sort();
}

function sealDirectory(dir) {
  save(path.join(dir, 'manifest.json'), walk(dir).map(file => ({ file, sha256: sha256(fs.readFileSync(path.join(dir, file))) })));
}

function verifyManifest(dir) {
  const manifest = load(path.join(dir, 'manifest.json'));
  const files = walk(dir).filter(file => file !== 'manifest.json');
  assert.deepEqual(manifest.map(row => row.file), files, 'Manifest inventory differs');
  for (const row of manifest) {
    assert.equal(sha256(fs.readFileSync(path.join(dir, row.file))), row.sha256, `Hash mismatch: ${row.file}`);
  }
}

function environment(dir) {
  fs.mkdirSync(path.join(dir, 'sources'));
  const sources = [script, modelPath].map(source => {
    const file = `sources/${path.basename(source)}`;
    const bytes = fs.readFileSync(source);
    fs.writeFileSync(path.join(dir, file), bytes, { flag: 'wx' });
    return { file, sha256: sha256(bytes), normalizedLfSha256: sha256(bytes.toString('utf8').replace(/\r\n/g, '\n')) };
  });
  let git;
  try {
    git = { head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
      status: execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' }) };
  } catch (error) { git = { error: error.message }; }
  const result = { schema, scope, createdAt: new Date().toISOString(), platform: process.platform, arch: process.arch,
    kernel: os.release(), executable: process.execPath, versions: process.versions, pid: process.pid, sources, git,
    github: { sha: process.env.GITHUB_SHA ?? null, runId: process.env.GITHUB_RUN_ID ?? null,
      attempt: process.env.GITHUB_RUN_ATTEMPT ?? null, image: process.env.ImageOS ?? null, imageVersion: process.env.ImageVersion ?? null } };
  save(path.join(dir, 'environment.json'), result);
  return result;
}

async function runEvidence(output) {
  assert(!fs.existsSync(output), 'Refusing to overwrite evidence');
  fs.mkdirSync(output, { recursive: true });
  const schedule = makeSchedule();
  save(path.join(output, 'schedule.json'), schedule);
  environment(output);
  fs.mkdirSync(path.join(output, 'cases'));
  sealDirectory(path.join(output, 'sources'));
  const assessments = [];
  for (const entry of schedule.entries) {
    const dir = path.join(output, 'cases', entry.id);
    fs.mkdirSync(dir);
    save(path.join(dir, 'case.json'), entry);
    const traceFile = path.join(dir, 'trace.ndjson');
    fs.writeFileSync(traceFile, '', { flag: 'wx' });
    let result;
    try {
      const trace = await executeCase(entry, event => fs.appendFileSync(traceFile, JSON.stringify(event) + '\n'));
      const evaluation = validateTrace(entry, trace);
      result = { id: entry.id, pass: true, ...evaluation };
    } catch (error) {
      save(path.join(dir, 'execution-error.json'), { message: error.message, stack: error.stack });
      result = { id: entry.id, pass: false, error: error.message };
    }
    save(path.join(dir, 'assessment.json'), result);
    sealDirectory(dir);
    assessments.push(result);
  }
  save(path.join(output, 'summary.json'), { schema, scope, attempted: assessments.length, assessments });
  save(path.join(output, 'shared-manifest.json'), ['schedule.json', 'environment.json', 'summary.json'].map(file => ({ file, sha256: sha256(fs.readFileSync(path.join(output, file))) })));
  return verifyEvidence(output);
}

export function verifyEvidence(output) {
  const expected = makeSchedule();
  const report = { schema, scope, output, attempted: 0, verified: 0, groups: 24, subcases: 37, failures: [], evidenceErrors: [] };
  try {
    assert.deepEqual(load(path.join(output, 'schedule.json')), expected, 'Frozen schedule differs');
    const shared = load(path.join(output, 'shared-manifest.json'));
    assert.deepEqual(shared.map(entry => entry.file), ['schedule.json', 'environment.json', 'summary.json']);
    for (const entry of shared) assert.equal(sha256(fs.readFileSync(path.join(output, entry.file))), entry.sha256, `Shared hash mismatch: ${entry.file}`);
    const env = load(path.join(output, 'environment.json'));
    assert.equal(env.schema, schema);
    assert.equal(env.scope, scope);
    assert(['linux', 'darwin', 'win32'].includes(env.platform));
    assert(env.versions.node && env.versions.uv && env.executable && env.arch && env.kernel);
    assert(/^[a-f0-9]{40}$/.test(env.git.head), 'Missing input commit');
    assert.equal(env.sources.length, 2);
    assert.deepEqual(env.sources.map(source => source.file), [script, modelPath].map(source => `sources/${path.basename(source)}`));
    verifyManifest(path.join(output, 'sources'));
    for (const [index, source] of env.sources.entries()) {
      const bytes = fs.readFileSync(path.join(output, source.file));
      assert.equal(sha256(bytes), source.sha256);
      assert.equal(sha256(bytes.toString('utf8').replace(/\r\n/g, '\n')), source.normalizedLfSha256);
      const current = fs.readFileSync([script, modelPath][index], 'utf8').replace(/\r\n/g, '\n');
      assert.equal(sha256(current), source.normalizedLfSha256, 'Verifier/source version mismatch');
    }
    const caseDirs = fs.readdirSync(path.join(output, 'cases')).sort();
    assert.deepEqual(caseDirs, expected.entries.map(entry => entry.id).sort(), 'Case inventory differs');
  } catch (error) { report.evidenceErrors.push({ id: 'shared', error: error.message }); }
  // Always visit the complete compiled-in schedule, even if the shared input or
  // the first artifact is missing/corrupt. Never execute saved JavaScript.
  for (const entry of expected.entries) {
    report.attempted += 1;
    const dir = path.join(output, 'cases', entry.id);
    let trace;
    try {
      verifyManifest(dir);
      assert.deepEqual(load(path.join(dir, 'case.json')), entry, 'Case input differs');
      const raw = fs.readFileSync(path.join(dir, 'trace.ndjson'), 'utf8');
      assert(raw.endsWith('\n'), 'Truncated trace');
      trace = raw.trimEnd().split('\n').map(line => JSON.parse(line));
      report.verified += 1;
    } catch (error) {
      report.evidenceErrors.push({ id: entry.id, error: error.message });
      continue;
    }
    try { validateTrace(entry, trace); }
    catch (error) { report.failures.push({ id: entry.id, error: error.message }); }
  }
  report.pass = report.attempted === 37 && report.verified === 37 && !report.failures.length && !report.evidenceErrors.length;
  return report;
}

function reseal(dir) {
  fs.unlinkSync(path.join(dir, 'manifest.json'));
  sealDirectory(dir);
}

async function selfTest() {
  const output = path.resolve(process.env.DSC_PROVIDER_LIFECYCLE_SELFTEST_EVIDENCE ?? path.join(repo, '.debug', `provider-lifecycle-selftest-${randomUUID()}`));
  assert(!fs.existsSync(output), 'Refusing to overwrite self-test evidence');
  fs.mkdirSync(output, { recursive: true });
  const positive = path.join(output, 'positive');
  const baseline = await runEvidence(positive);
  save(path.join(output, 'positive-report.json'), baseline);
  assert(baseline.pass, 'Positive fixtures failed; evidence retained');
  const schedule = makeSchedule();
  const entry = schedule.entries[0];
  const original = await executeCase(entry);
  const checks = [];
  const reject = (name, mutate, expectedEntry = entry, baselineTrace = original) => {
    const trace = clone(baselineTrace);
    mutate(trace);
    let error;
    try { validateTrace(expectedEntry, trace); } catch (caught) { error = caught.message; }
    save(path.join(output, `${name}.json`), { name, trace, rejection: error ?? null });
    assert(error, `${name} must be rejected`);
    checks.push(name);
  };
  reject('deleted-data', trace => trace.splice(trace.findIndex(event => event.event === 'data'), 1));
  reject('changed-sequence', trace => { trace.find(event => event.event === 'data').detail.sequence += 1; });
  reject('changed-identity', trace => { trace.find(event => event.event === 'data').identity.generation = 'wrong'; });
  reject('missing-terminal-state', trace => trace.splice(trace.findIndex(event => event.event === 'authority-final'), 1));
  reject('forged-exit', trace => { trace.find(event => event.event === 'process').detail.result.exitCode = 0; });
  reject('parser-not-pending', trace => { trace.find(event => event.event === 'parser-promise-observed').detail.status = 'fulfilled'; });
  const consumerEntry = schedule.entries.find(item => item.id === 'M16');
  reject('missing-consumer-callback', trace => trace.splice(trace.findIndex(event => event.event === 'consumer-write-callback'), 1), consumerEntry, await executeCase(consumerEntry));
  const sharedPromiseEntry = schedule.entries.find(item => item.id === 'M18-repeat');
  reject('different-release-promise', trace => { trace.filter(event => event.event === 'release-handle-observed')[1].detail.reused = false; }, sharedPromiseEntry, await executeCase(sharedPromiseEntry));
  reject('shared-release-pending-after-return', trace => { trace.find(event => event.event === 'release-promises-observed').detail.results[1] = { status: 'pending' }; }, sharedPromiseEntry, await executeCase(sharedPromiseEntry));
  const combined = path.join(output, 'first-corrupt-last-semantic-failure');
  fs.cpSync(positive, combined, { recursive: true });
  fs.appendFileSync(path.join(combined, 'cases', entry.id, 'trace.ndjson'), 'corrupt');
  const last = schedule.entries.at(-1);
  const lastDir = path.join(combined, 'cases', last.id);
  const lastTrace = fs.readFileSync(path.join(lastDir, 'trace.ndjson'), 'utf8').trimEnd().split('\n').map(JSON.parse);
  lastTrace.find(event => event.event === 'resource').detail.result = { kind: 'unknown', reason: 'forged' };
  fs.writeFileSync(path.join(lastDir, 'trace.ndjson'), lastTrace.map(event => JSON.stringify(event)).join('\n') + '\n');
  reseal(lastDir);
  const combinedReport = verifyEvidence(combined);
  save(path.join(output, 'combined-report.json'), combinedReport);
  assert.equal(combinedReport.attempted, 37);
  assert.equal(combinedReport.verified, 36);
  assert(combinedReport.evidenceErrors.some(result => result.id === entry.id));
  assert(combinedReport.failures.some(result => result.id === last.id));
  checks.push('first-corruption-does-not-hide-last-failure');
  const missing = path.join(output, 'missing-artifact');
  fs.cpSync(positive, missing, { recursive: true });
  fs.unlinkSync(path.join(missing, 'cases', entry.id, 'trace.ndjson'));
  const missingReport = verifyEvidence(missing);
  save(path.join(output, 'missing-report.json'), missingReport);
  assert.equal(missingReport.attempted, 37);
  assert.equal(missingReport.verified, 36);
  assert(!missingReport.pass);
  checks.push('missing-first-artifact-still-visits-37');
  const forged = path.join(output, 'forged-summary');
  fs.cpSync(combined, forged, { recursive: true });
  const summary = load(path.join(forged, 'summary.json'));
  for (const assessment of summary.assessments) assessment.pass = true;
  fs.writeFileSync(path.join(forged, 'summary.json'), json(summary));
  const shared = load(path.join(forged, 'shared-manifest.json'));
  shared.find(record => record.file === 'summary.json').sha256 = sha256(fs.readFileSync(path.join(forged, 'summary.json')));
  fs.writeFileSync(path.join(forged, 'shared-manifest.json'), json(shared));
  const forgedReport = verifyEvidence(forged);
  save(path.join(output, 'forged-summary-report.json'), forgedReport);
  assert(!forgedReport.pass && forgedReport.failures.some(result => result.id === last.id));
  checks.push('forged-pass-flags-do-not-override-raw-trace');
  const report = { schema, scope, pass: true, checks, evidence: output, positiveSubcases: 37 };
  save(path.join(output, 'self-test.json'), report);
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === script) {
  try {
    const { values } = parseArgs({ options: { output: { type: 'string' }, 'verify-saved': { type: 'string' }, 'self-test': { type: 'boolean' } } });
    assert.equal([values.output, values['verify-saved'], values['self-test']].filter(Boolean).length, 1,
      'Choose exactly one of --output NEW_DIR, --verify-saved DIR, or --self-test');
    const report = values['self-test'] ? await selfTest() : values['verify-saved'] ? verifyEvidence(path.resolve(values['verify-saved'])) : await runEvidence(path.resolve(values.output));
    console.log(JSON.stringify(report, null, 2));
    if (!report.pass) process.exitCode = 1;
  } catch (error) {
    console.error(error.stack ?? error);
    process.exitCode = 1;
  }
}
