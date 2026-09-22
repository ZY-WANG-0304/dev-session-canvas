import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

export const SCHEMA = 'diagnostic-observation-envelope-v2';
export const CASES = Object.freeze([
  ['D3-01', 'normal-resolve'],
  ['D3-02', 'operation-pending'],
  ['D3-03', 'sync-block-before-resolve'],
  ['D3-04', 'sync-block-after-await'],
  ['D3-05', 'after-await-channel-cut'],
  ['D3-06', 'writer-eexist'],
  ['D3-07', 'writer-blocked'],
  ['D3-08', 'bulk-overflow'],
]);

// These are the frozen D3 limits. A self-test may use a smaller wall-clock
// factor, but it never changes the recorded contract values.
export const BUDGETS = Object.freeze({
  callerWorkMs: 1000,
  callerObservationMs: 2000,
  observerProcessActionMs: 5000,
  observerProcessSettlementMs: 6000,
  writerWorkMs: 1000,
  writerSettlementMs: 2000,
});

export const CAPACITY = Object.freeze({
  frameBytes: 4096,
  maxEvents: 4096,
  maxBytes: 1024 * 1024,
  controlEvents: 64,
  controlBytes: 64 * 1024,
});

export const clone = value => structuredClone(value);
export const encode = value => Buffer.from(JSON.stringify(value));

export function caseId(scenario, run) {
  if (!CASES.some(([id]) => id === scenario) || !Number.isInteger(run) || run < 1 || run > 3) {
    throw new Error(`invalid D3 case ${scenario}/${run}`);
  }
  return `${scenario}-${run}`;
}

export function makeNonce() {
  return `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function makeFrame({ run, caseId: id, generation = 'generation-1', nonce, sequence, type, detail = {} }) {
  if (!Number.isInteger(run) || run < 1 || run > 3) throw new Error('invalid frame run');
  if (typeof id !== 'string' || !CASES.some(([scenario]) => scenario === id.split('-').slice(0, 2).join('-'))) {
    throw new Error('invalid frame case');
  }
  if (typeof generation !== 'string' || !generation || typeof nonce !== 'string' || !nonce) throw new Error('invalid frame identity');
  if (!Number.isSafeInteger(sequence) || sequence < 1) throw new Error('invalid frame sequence');
  if (typeof type !== 'string' || !type) throw new Error('invalid frame type');
  const frame = { schema: SCHEMA, run, case: id, generation, nonce, sequence, type, detail };
  const bytes = encode(frame).byteLength;
  if (bytes > CAPACITY.frameBytes) throw new Error(`control frame exceeds ${CAPACITY.frameBytes} bytes`);
  return frame;
}

// The ledger reserves space for control facts so bulk output cannot erase the
// after-await, process-settlement, or evidence-settlement evidence.
export function createTraceLedger() {
  const trace = [];
  let bytes = 0;
  let bulkBytes = 0;
  let controlBytes = 0;
  let bulkEvents = 0;
  let controlEvents = 0;
  let overflow = null;
  const controlReserveBytes = CAPACITY.controlBytes;
  const bulkLimit = CAPACITY.maxBytes - controlReserveBytes;
  const bulkEventLimit = CAPACITY.maxEvents - CAPACITY.controlEvents;

  function append(event, kind = 'control') {
    const value = clone(event);
    const size = encode(value).byteLength;
    if (size > CAPACITY.frameBytes) {
      if (!overflow) overflow = { reason: 'frame-too-large', size, kind };
      return false;
    }
    if (kind === 'bulk') {
      if (bulkEvents >= bulkEventLimit || bulkBytes + size > bulkLimit) {
        if (!overflow) overflow = { reason: bulkEvents >= bulkEventLimit ? 'event-capacity' : 'byte-capacity', size, kind };
        return false;
      }
      bulkEvents += 1;
      bulkBytes += size;
    } else {
      if (controlEvents >= CAPACITY.controlEvents || trace.length >= CAPACITY.maxEvents || bytes + size > CAPACITY.maxBytes ||
        controlBytes + size > controlReserveBytes) {
        if (!overflow) overflow = { reason: 'control-capacity', size, kind };
        return false;
      }
      controlEvents += 1;
      controlBytes += size;
    }
    trace.push(value);
    bytes += size;
    return true;
  }

  return {
    append,
    get trace() { return trace.map(clone); },
    get stats() { return { events: trace.length, bytes, controlEvents, bulkEvents, bulkBytes, controlBytes, overflow: clone(overflow) }; },
  };
}

export function schedule() {
  return CASES.flatMap(([scenario, title]) => [1, 2, 3].map(run => ({
    id: caseId(scenario, run), scenario, title, run, generation: 'generation-1',
  })));
}

const CALLER_TYPES = new Set([
  'caller-start', 'result-ready', 'operation-pending', 'operation-returned',
  'caller-after-await', 'bulk', 'caller-finished',
]);
const TIMED_OBSERVER_EVENTS = new Set([
  'after-await-ack', 'bulk-omitted', 'capacity-overflow', 'observer-process-action',
  'observer-after-await-deadline', 'observer-process-settlement-deadline',
  'observer-process-action-error', 'after-await-channel-closed', 'control-channel-ended',
]);

function decimalClock(value, label, positive = false) {
  assert.equal(typeof value, 'string', `${label} must be a decimal string`);
  assert((positive ? /^[1-9][0-9]*$/ : /^(0|[1-9][0-9]*)$/).test(value), `${label} is not a valid clock`);
  return BigInt(value);
}

function validateReceipt(event) {
  assert(Number.isFinite(event.observedMs) && event.observedMs >= 0, 'invalid observer observedMs');
  return decimalClock(event.observedNs, 'observer observedNs');
}

export function validateCaseConfig(config, entry, scale) {
  const frozen = schedule().find(item => item.id === entry.id);
  assert(frozen, 'case is not in the frozen schedule');
  assert.deepEqual(entry, frozen, 'schedule entry differs');
  assert(scale === 1 || scale === 0.25, 'unsupported observation scale');
  for (const key of ['id', 'scenario', 'title', 'run', 'generation']) {
    assert.equal(config[key], frozen[key], `case config ${key} differs`);
  }
  assert.equal(config.schema, SCHEMA, 'case config schema differs');
  assert.equal(config.scale, scale, 'case config scale differs');
  assert.equal(typeof config.nonce, 'string', 'case nonce is missing');
  assert(config.nonce.length > 0, 'case nonce is empty');
  assert.equal(config.blockMs, 5500, 'caller block budget differs');
  assert.equal(config.operationDeadlineMs, 1000, 'operation deadline differs');
  assert.equal(config.bulkEvents, 4296, 'bulk event count differs');
  assert.equal(config.writerBlockMs, 1500, 'writer block budget differs');
  return config;
}

export function validateCallerFrame(message, config, channel) {
  assert(message && typeof message === 'object' && !Array.isArray(message), 'caller frame is not an object');
  assert(encode(message).byteLength <= CAPACITY.frameBytes, 'complete caller frame exceeds frozen limit');
  const { sentNs, ...candidate } = message;
  decimalClock(sentNs, 'caller sentNs', true);
  const frame = makeFrame({ run: config.run, caseId: config.id, generation: config.generation,
    nonce: config.nonce, sequence: candidate.sequence, type: candidate.type, detail: candidate.detail });
  assert.deepEqual(candidate, frame, 'caller frame identity or payload differs');
  assert(CALLER_TYPES.has(frame.type), 'unsupported caller frame type');
  assert.equal(channel, frame.type === 'caller-after-await' ? 'control-fd3' : 'stdout', 'caller frame channel differs');
  return clone(message);
}

function sourceGrammar(config) {
  const grammar = [
    ['caller-start', { case: config.id, generation: config.generation }],
    [config.scenario === 'D3-02' ? 'operation-pending' : 'result-ready', {}],
  ];
  if (config.scenario === 'D3-03') return grammar;
  grammar.push(['operation-returned', { kind: config.scenario === 'D3-02' ? 'timeout' : 'returned' }]);
  if (config.scenario !== 'D3-05') grammar.push(['caller-after-await', { target: 'dedicated-control-frame' }]);
  if (config.scenario === 'D3-04') return grammar;
  if (config.scenario === 'D3-08') {
    for (let index = 1; index <= config.bulkEvents; index += 1) grammar.push(['bulk', { index, body: 'x'.repeat(220) }]);
  }
  grammar.push(['caller-finished', { exitCode: 0 }]);
  return grammar;
}

export function validateCallerTrace(config, trace) {
  assert(Array.isArray(trace), 'caller trace is not an array');
  const entry = schedule().find(item => item.id === config.id);
  assert(entry, 'unknown caller case');
  validateCaseConfig(config, entry, config.scale);
  const caller = [];
  const seen = new Set();
  const lastByChannel = new Map();
  let previousReceiptNs = null;
  let previousReceiptMs = null;
  for (const event of trace) {
    assert(event && typeof event === 'object' && !Array.isArray(event), 'trace event is not an object');
    if (event.actor === 'observer' && typeof event.event === 'string' &&
        (event.event.startsWith('invalid-') || event.event === 'caller-protocol-error')) {
      assert.fail('observer recorded an invalid source frame');
    }
    if (event.actor === 'caller' || (event.actor === 'observer' && TIMED_OBSERVER_EVENTS.has(event.event))) {
      const receiptNs = validateReceipt(event);
      assert(previousReceiptNs === null || receiptNs >= previousReceiptNs, 'observer clock regressed');
      assert(previousReceiptMs === null || event.observedMs >= previousReceiptMs, 'observer receipt order regressed');
      previousReceiptNs = receiptNs;
      previousReceiptMs = event.observedMs;
    }
    if (event.actor !== 'caller') continue;
    const frame = validateCallerFrame(event.frame, config, event.channel);
    assert(!seen.has(frame.sequence), 'caller source sequence is duplicated');
    seen.add(frame.sequence);
    const previous = lastByChannel.get(event.channel);
    assert(previous === undefined || frame.sequence > previous, 'caller sequence regressed within one channel');
    lastByChannel.set(event.channel, frame.sequence);
    caller.push({ event, frame });
  }

  const grammar = sourceGrammar(config);
  const omitted = trace.filter(event => event.actor === 'observer' && event.event === 'bulk-omitted');
  assert(omitted.length <= 1, 'multiple bulk omission ranges');
  let omittedFirst = null;
  let omittedLast = null;
  if (omitted.length) {
    assert.equal(config.scenario, 'D3-08', 'bulk omission outside D3-08');
    const detail = omitted[0].detail;
    assert(detail && typeof detail === 'object' && !Array.isArray(detail), 'invalid bulk omission detail');
    assert.deepEqual(Object.keys(detail).sort(), ['count', 'firstSequence', 'lastSequence'], 'bulk omission fields differ');
    const { firstSequence, lastSequence, count } = detail;
    assert([firstSequence, lastSequence, count].every(value => Number.isSafeInteger(value) && value > 0), 'invalid bulk omission range');
    assert(firstSequence >= 5 && lastSequence === 4 + config.bulkEvents && firstSequence <= lastSequence, 'omission is not a tail bulk range');
    assert.equal(count, lastSequence - firstSequence + 1, 'bulk omission count differs');
    assert(trace.some(event => event.actor === 'observer' && event.event === 'capacity-overflow' && event.detail?.kind === 'bulk'), 'bulk omission lacks overflow evidence');
    omittedFirst = firstSequence;
    omittedLast = lastSequence;
  }
  if (config.scenario === 'D3-08') assert.equal(omitted.length, 1, 'D3-08 requires one bulk omission range');

  // Source order is independent of delivery order across stdout and fd3.
  const ordered = [...caller].sort((a, b) => a.frame.sequence - b.frame.sequence);
  let previousSentNs = null;
  for (const { frame } of ordered) {
    assert(frame.sequence <= grammar.length, 'unexpected caller source sequence');
    assert(omittedFirst === null || frame.sequence < omittedFirst || frame.sequence > omittedLast, 'received frame overlaps bulk omission');
    const [type, detail] = grammar[frame.sequence - 1];
    assert.equal(frame.type, type, 'caller source grammar differs');
    assert.deepEqual(frame.detail, detail, 'caller source detail differs');
    const sentNs = decimalClock(frame.sentNs, 'caller sentNs', true);
    assert(previousSentNs === null || sentNs >= previousSentNs, 'caller source clock regressed');
    previousSentNs = sentNs;
  }
  for (let sequence = 1; sequence <= grammar.length; sequence += 1) {
    if (omittedFirst !== null && sequence >= omittedFirst && sequence <= omittedLast) continue;
    assert(seen.has(sequence), `missing caller source sequence ${sequence}`);
  }

  const acknowledgements = trace.filter(event => event.actor === 'observer' && event.event === 'after-await-ack');
  if (config.scenario === 'D3-04' || config.scenario === 'D3-08') {
    assert.equal(acknowledgements.length, 1, 'missing or repeated after-await ACK');
    const afterIndex = trace.findIndex(event => event.actor === 'caller' && event.channel === 'control-fd3' && event.frame?.type === 'caller-after-await');
    const ackIndex = trace.indexOf(acknowledgements[0]);
    assert(afterIndex >= 0 && ackIndex > afterIndex, 'ACK preceded fd3 receipt');
    if (config.scenario === 'D3-04') {
      const actions = trace.filter(event => event.actor === 'observer' && event.event === 'observer-process-action');
      assert.equal(actions.length, 1, 'missing or repeated D3-04 action');
      assert(trace.indexOf(actions[0]) > ackIndex, 'D3-04 action preceded ACK');
    } else {
      for (const event of trace) {
        if ((event.actor === 'caller' && event.frame?.type === 'bulk') ||
            (event.actor === 'observer' && (event.event === 'bulk-omitted' || event.event === 'capacity-overflow'))) {
          assert(trace.indexOf(event) > ackIndex, 'D3-08 bulk preceded ACK');
        }
      }
    }
  } else assert.equal(acknowledgements.length, 0, 'unexpected after-await ACK');
  return ordered.map(item => clone(item.frame));
}

export function deriveObservation(config, trace) {
  validateCallerTrace(config, trace);
  const afterAwait = trace.find(event => event.actor === 'caller' && event.channel === 'control-fd3' && event.frame.type === 'caller-after-await');
  if (!afterAwait) return { kind: 'not-observed', atMs: null };
  return { kind: afterAwait.observedMs <= BUDGETS.callerObservationMs * config.scale ? 'observed-within-budget' : 'observed-late', atMs: afterAwait.observedMs };
}

export function expectedCase(config, facts) {
  const scenario = config.scenario;
  const afterAwait = facts.observation?.kind === 'observed-within-budget';
  const natural = facts.process?.kind === 'natural-exit';
  const forced = facts.process?.kind === 'forced-exit-observed';
  const checks = {
    'D3-01': afterAwait && natural && facts.writer?.kind === 'sealed',
    'D3-02': afterAwait && natural && facts.operation?.kind === 'timeout' && facts.writer?.kind === 'sealed',
    'D3-03': !afterAwait && forced && facts.source?.resultReady === true && facts.operation?.kind === 'not-returned',
    'D3-04': afterAwait && forced && facts.source?.resultReady === true && facts.operation?.kind === 'returned',
    'D3-05': !afterAwait && natural && facts.channel?.closed === true && facts.operation?.kind === 'returned',
    'D3-06': afterAwait && natural && facts.writer?.kind === 'failed' && facts.writer?.code === 'EEXIST',
    'D3-07': afterAwait && natural && facts.writer?.kind === 'forced-exit-observed',
    'D3-08': afterAwait && natural && facts.capacity?.overflow?.kind === 'bulk' && facts.writer?.kind === 'sealed',
  };
  return { pass: checks[scenario] === true, checks, classification: 'd3-observation-envelope' };
}

export function manifest(directory) {
  const files = [];
  function visit(current, prefix = '') {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) visit(path.join(current, entry.name), relative);
      else if (relative !== 'manifest.json') files.push(relative);
    }
  }
  visit(directory);
  return files;
}
