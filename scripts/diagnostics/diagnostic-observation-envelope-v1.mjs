import fs from 'node:fs';
import path from 'node:path';

export const SCHEMA = 'diagnostic-observation-envelope-v1';
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
