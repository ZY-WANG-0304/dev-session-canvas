import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SCHEMA, clone, deriveObservation, makeFrame, schedule, validateCallerFrame,
  validateCallerTrace, validateCaseConfig,
} from './diagnostic-observation-envelope-v2.mjs';

function caseConfig(scenario = 'D3-01', scale = 1) {
  return { ...schedule().find(entry => entry.scenario === scenario && entry.run === 1),
    schema: SCHEMA, nonce: 'oracle-fixed-nonce', scale, blockMs: 5500,
    operationDeadlineMs: 1000, bulkEvents: 4296, writerBlockMs: 1500 };
}

function callerEvent(config, sequence, type, detail = {}) {
  return { actor: 'caller', channel: type === 'caller-after-await' ? 'control-fd3' : 'stdout',
    frame: { ...makeFrame({ run: config.run, caseId: config.id, generation: config.generation,
      nonce: config.nonce, sequence, type, detail }), sentNs: String(sequence * 1000) } };
}

function observerEvent(event, detail = {}) { return { actor: 'observer', event, detail }; }

function stampReceipts(trace, start = 10, step = 10) {
  for (const [index, event] of trace.entries()) {
    event.observedMs = start + index * step;
    event.observedNs = String(1000000000n + BigInt(Math.round(event.observedMs * 1000000)));
  }
  return trace;
}

function fixture(scenario = 'D3-01', scale = 1) {
  const config = caseConfig(scenario, scale);
  const trace = [callerEvent(config, 1, 'caller-start', { case: config.id, generation: config.generation }),
    callerEvent(config, 2, scenario === 'D3-02' ? 'operation-pending' : 'result-ready')];
  if (scenario !== 'D3-03') {
    trace.push(callerEvent(config, 3, 'operation-returned', { kind: scenario === 'D3-02' ? 'timeout' : 'returned' }));
    if (scenario !== 'D3-05') trace.push(callerEvent(config, 4, 'caller-after-await', { target: 'dedicated-control-frame' }));
    if (scenario === 'D3-04' || scenario === 'D3-08') trace.push(observerEvent('after-await-ack'));
    if (scenario === 'D3-04') trace.push(observerEvent('observer-process-action', { action: 'kill', signal: 'SIGTERM' }));
    else if (scenario === 'D3-08') {
      for (let index = 1; index <= 3; index += 1) trace.push(callerEvent(config, index + 4, 'bulk', { index, body: 'x'.repeat(220) }));
      trace.push(observerEvent('capacity-overflow', { kind: 'bulk' }));
      trace.push(observerEvent('bulk-omitted', { firstSequence: 8, lastSequence: 4300, count: 4293 }));
      trace.push(callerEvent(config, 4301, 'caller-finished', { exitCode: 0 }));
    } else trace.push(callerEvent(config, scenario === 'D3-05' ? 4 : 5, 'caller-finished', { exitCode: 0 }));
  }
  return { mode: 'trace', config, trace: stampReceipts(trace), expected: 'accept' };
}

const afterAwait = value => value.trace.find(event => event.frame?.type === 'caller-after-await');
const omitted = value => value.trace.find(event => event.event === 'bulk-omitted');

function makeFixtures() {
  const fixtures = [];
  const add = (id, value, mutate, expectedError) => {
    const saved = clone(value);
    saved.id = id;
    if (mutate) { mutate(saved); saved.expected = 'reject'; }
    if (expectedError) saved.expectedError = expectedError;
    fixtures.push(saved);
    return saved;
  };
  for (const entry of schedule().filter(entry => entry.run === 1)) add(`grammar-${entry.scenario}`, fixture(entry.scenario));
  const base = fixture();
  const controlFirst = add('cross-pipe-control-first', base);
  controlFirst.trace = stampReceipts([controlFirst.trace[3], ...controlFirst.trace.slice(0, 3), controlFirst.trace[4]]);
  controlFirst.expectedObservation = { kind: 'observed-within-budget', atMs: 10 };
  const controlLast = add('cross-pipe-control-last', base);
  controlLast.trace = stampReceipts([...controlLast.trace.slice(0, 3), controlLast.trace[4], controlLast.trace[3]]);
  controlLast.expectedObservation = { kind: 'observed-within-budget', atMs: 50 };
  const late = add('early-send-late-fd3-receipt', controlLast);
  afterAwait(late).observedMs = 2001;
  afterAwait(late).observedNs = '3001000000';
  late.expectedObservation = { kind: 'observed-late', atMs: 2001 };
  const atDeadline = add('fd3-exactly-at-deadline', controlLast);
  afterAwait(atDeadline).observedMs = 2000;
  afterAwait(atDeadline).observedNs = '3000000000';
  atDeadline.expectedObservation = { kind: 'observed-within-budget', atMs: 2000 };
  const scaled = add('self-test-scale-quarter', fixture('D3-01', 0.25));
  scaled.expectedObservation = { kind: 'observed-within-budget', atMs: 40 };

  add('same-pipe-inverted', base, value => {
    [value.trace[0], value.trace[1]] = [value.trace[1], value.trace[0]];
    stampReceipts(value.trace);
  }, 'within one channel');
  add('duplicate-global-sequence', base, value => { afterAwait(value).frame.sequence = 3; }, 'duplicated');
  add('missing-source-start', base, value => { value.trace.shift(); }, 'missing caller source sequence 1');
  add('missing-source-control', base, value => { value.trace.splice(2, 1); }, 'missing caller source sequence 3');
  add('bad-source-causality', base, value => {
    value.trace[2].frame.sequence = 4;
    afterAwait(value).frame.sequence = 3;
  }, 'source grammar');
  add('unexpected-extra-source-frame', base, value => {
    value.trace.push(callerEvent(value.config, 6, 'caller-finished', { exitCode: 0 }));
    stampReceipts(value.trace);
  }, 'unexpected caller source sequence');
  for (const [field, replacement] of [
    ['schema', 'other-schema'], ['run', 2], ['case', 'D3-01-2'],
    ['generation', 'generation-2'], ['nonce', 'other-nonce'],
  ]) add(`wrong-frame-${field}`, base, value => { afterAwait(value).frame[field] = replacement; }, 'identity or payload');
  for (const channel of ['stdout', 'stderr', 'unknown']) {
    add(`after-await-wrong-channel-${channel}`, base, value => { afterAwait(value).channel = channel; }, 'channel differs');
  }
  add('result-on-control-channel', base, value => { value.trace[2].channel = 'control-fd3'; }, 'channel differs');
  add('duplicate-after-await', base, value => {
    value.trace.push(clone(afterAwait(value)));
    stampReceipts(value.trace);
  }, 'duplicated');
  add('invalid-source-record-must-fail', base, value => {
    value.trace.push(observerEvent('invalid-control-frame', { error: 'wrong nonce' }));
    stampReceipts(value.trace);
  }, 'invalid source frame');
  add('caller-protocol-error-must-fail', base, value => {
    value.trace.push(observerEvent('caller-protocol-error', { error: 'oversized frame' }));
    stampReceipts(value.trace);
  }, 'invalid source frame');
  add('oversized-whole-source-frame', base, value => { afterAwait(value).frame.sentNs = '1'.repeat(4096); }, 'complete caller frame');
  for (const value of ['', '0', '-1', '+1', '01', '1.2', 'NaN', 'Infinity']) {
    add(`invalid-sent-clock-${value || 'empty'}`, base, target => { afterAwait(target).frame.sentNs = value; }, 'caller sentNs');
  }
  add('regressed-source-clock', base, value => { afterAwait(value).frame.sentNs = '1'; }, 'source clock regressed');
  add('negative-receipt-ms', base, value => { afterAwait(value).observedMs = -1; }, 'invalid observer observedMs');
  for (const value of ['NaN', 'Infinity', '-Infinity']) {
    const item = add(`nonfinite-receipt-ms-${value}`, base);
    item.expected = 'reject';
    item.expectedError = 'invalid observer observedMs';
    // JSON cannot carry NaN/Infinity; this declarative mutation preserves the full fixture.
    item.numberMutation = { index: 3, field: 'observedMs', value };
  }
  for (const value of ['-1', '1.5', 'NaN', 'Infinity', '01']) {
    add(`invalid-receipt-ns-${value}`, base, target => { afterAwait(target).observedNs = value; }, 'observer observedNs');
  }
  add('regressed-observer-ms', base, value => { afterAwait(value).observedMs = 1; }, 'observer receipt order regressed');
  add('regressed-observer-ns', base, value => { afterAwait(value).observedNs = '1'; }, 'observer clock regressed');
  for (const [field, replacement] of [
    ['run', 2], ['scenario', 'D3-02'], ['generation', 'generation-2'], ['title', 'changed'],
    ['blockMs', 5501], ['operationDeadlineMs', 1001], ['bulkEvents', 4295], ['writerBlockMs', 1501],
  ]) add(`wrong-config-${field}`, base, value => { value.config[field] = replacement; });
  add('unsupported-scale', base, value => { value.config.scale = 2; }, 'unsupported observation scale');
  const scaleMismatch = add('run-config-scale-mismatch', base);
  scaleMismatch.mode = 'config';
  scaleMismatch.rootScale = 0.25;
  scaleMismatch.expected = 'reject';
  scaleMismatch.expectedError = 'config scale differs';

  const blocked = fixture('D3-04');
  add('ack-before-fd3-receipt', blocked, value => {
    [value.trace[3], value.trace[4]] = [value.trace[4], value.trace[3]];
    stampReceipts(value.trace);
  }, 'ACK preceded fd3 receipt');
  add('action-before-ack', blocked, value => {
    [value.trace[4], value.trace[5]] = [value.trace[5], value.trace[4]];
    stampReceipts(value.trace);
  }, 'action preceded ACK');
  add('missing-ack', blocked, value => { value.trace.splice(4, 1); }, 'missing or repeated after-await ACK');
  add('duplicate-ack', blocked, value => {
    value.trace.splice(5, 0, clone(value.trace[4]));
    stampReceipts(value.trace);
  }, 'missing or repeated after-await ACK');
  const bulk = fixture('D3-08');
  add('bulk-before-ack', bulk, value => {
    [value.trace[4], value.trace[5]] = [value.trace[5], value.trace[4]];
    stampReceipts(value.trace);
  }, 'bulk preceded ACK');
  add('bulk-gap-without-omission', bulk, value => { value.trace = value.trace.filter(event => event.event !== 'bulk-omitted'); }, 'requires one bulk omission');
  add('bulk-gap-without-overflow', bulk, value => { value.trace = value.trace.filter(event => event.event !== 'capacity-overflow'); }, 'lacks overflow evidence');
  add('wrong-omission-count', bulk, value => { omitted(value).detail.count += 1; }, 'omission count differs');
  add('omission-covers-control', bulk, value => {
    Object.assign(omitted(value).detail, { firstSequence: 4, count: 4297 });
  }, 'not a tail bulk range');
  add('omission-covers-finish', bulk, value => {
    Object.assign(omitted(value).detail, { lastSequence: 4301, count: 4294 });
  }, 'not a tail bulk range');
  add('omission-not-tail', bulk, value => {
    Object.assign(omitted(value).detail, { lastSequence: 4299, count: 4292 });
  }, 'not a tail bulk range');
  add('omission-overlaps-received-bulk', bulk, value => {
    Object.assign(omitted(value).detail, { firstSequence: 7, count: 4294 });
  }, 'overlaps bulk omission');
  add('undeclared-bulk-gap', bulk, value => { value.trace = value.trace.filter(event => event.frame?.sequence !== 6); }, 'missing caller source sequence 6');
  add('overflow-does-not-excuse-control-gap', bulk, value => { value.trace = value.trace.filter(event => event.frame?.sequence !== 3); }, 'missing caller source sequence 3');
  add('wrong-bulk-index', bulk, value => { value.trace.find(event => event.frame?.type === 'bulk').frame.detail.index = 2; }, 'source detail differs');
  add('omission-outside-bulk-case', base, value => {
    value.trace.push(observerEvent('bulk-omitted', { firstSequence: 5, lastSequence: 5, count: 1 }));
    stampReceipts(value.trace);
  }, 'outside D3-08');
  return fixtures;
}

export function runOracleTests() {
  const fixtures = makeFixtures();
  const outcomes = fixtures.map(value => {
    const config = clone(value.config);
    const trace = clone(value.trace);
    if (value.numberMutation) {
      const { index, field, value: replacement } = value.numberMutation;
      trace[index][field] = Number(replacement);
    }
    let accepted = false;
    let error = null;
    let observation = null;
    try {
      const entry = schedule().find(item => item.id === config.id);
      validateCaseConfig(config, entry, value.rootScale ?? config.scale);
      if (value.mode !== 'config') {
        for (const event of trace.filter(event => event.actor === 'caller')) validateCallerFrame(event.frame, config, event.channel);
        validateCallerTrace(config, trace);
        observation = deriveObservation(config, trace);
      }
      accepted = true;
    } catch (caught) { error = caught.message; }
    const observationMatches = !value.expectedObservation || JSON.stringify(observation) === JSON.stringify(value.expectedObservation);
    const errorMatches = !value.expectedError || (typeof error === 'string' && error.includes(value.expectedError));
    return { id: value.id, pass: accepted === (value.expected === 'accept') && observationMatches && errorMatches,
      accepted, observation, error };
  });
  return { schema: `${SCHEMA}-oracle-tests`, scope: 'Deterministic protocol replay; no processes or PTY.',
    pass: outcomes.every(outcome => outcome.pass), attempted: outcomes.length,
    verified: outcomes.filter(outcome => outcome.pass).length, fixtures, outcomes };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = runOracleTests();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.pass) process.exitCode = 1;
}
