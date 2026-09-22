import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { PassThrough } from 'node:stream';
import { once } from 'node:events';
import {
  BUDGETS, CAPACITY, CASES, SCHEMA, caseId, clone, createTraceLedger,
  encode, expectedCase, makeFrame, makeNonce, schedule, validateCallerFrame,
  validateCallerTrace, validateCaseConfig, deriveObservation,
} from './diagnostic-observation-envelope-v2.mjs';
import { runOracleTests } from './observation-envelope-v2-oracle-test.mjs';

const ENTRY = fileURLToPath(import.meta.url);
const REPO = path.resolve(path.dirname(ENTRY), '../..');
const SCOPE = 'D3 caller/observer/writer observation envelope; no PTY, native API, production bridge, or process-tree ownership.';
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const readJSON = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const sha256 = value => createHash('sha256').update(value).digest('hex');
const nowNs = () => process.hrtime.bigint();
const elapsedMs = start => Number(nowNs() - start) / 1e6;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const exclusive = (file, value) => fs.writeFileSync(file, json(value), { flag: 'wx' });
const exclusiveText = (file, value) => fs.writeFileSync(file, value, { flag: 'wx' });
const effective = (value, scale) => Math.max(5, Math.round(value * scale));

function busyWait(ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {}
}

function emitLine(event, detail = {}) {
  process.stdout.write(`${JSON.stringify({ schema: SCHEMA, event, detail, atNs: String(nowNs()) })}\n`);
}

async function runCaller(config) {
  const scale = Number(config.scale ?? 1);
  const wait = ms => sleep(effective(ms, scale));
  const target = fs.createWriteStream(null, { fd: 3, autoClose: true });
  let targetClosed = false;
  let frameSequence = 0;
  const makeCallerFrame = (type, detail = {}) => validateCallerFrame({
    ...makeFrame({ run: config.run, caseId: config.id, generation: config.generation,
      nonce: config.nonce, sequence: ++frameSequence, type, detail }),
    sentNs: String(nowNs()),
  }, config, type === 'caller-after-await' ? 'control-fd3' : 'stdout');
  const emitCallerLine = (type, detail = {}) => process.stdout.write(`${JSON.stringify(makeCallerFrame(type, detail))}\n`);
  const sendTarget = (type, detail = {}, onDone) => target.write(`${JSON.stringify(makeCallerFrame(type, detail))}\n`, onDone);
  let ackResolve;
  const ack = new Promise(resolve => { ackResolve = resolve; });
  if (config.scenario === 'D3-04' || config.scenario === 'D3-08') {
    const input = fs.createReadStream(null, { fd: 4, autoClose: true });
    streamLineReader(input, line => {
      assert.equal(line, 'after-await-ack', 'invalid observer ACK');
      input.destroy();
      ackResolve();
    }, error => { throw error; });
  }
  emitCallerLine('caller-start', { case: config.id, generation: config.generation });
  if (config.scenario === 'D3-03') {
    emitCallerLine('result-ready');
    // The synchronous section prevents the promise continuation from running.
    busyWait(effective(config.blockMs, scale));
    emitCallerLine('operation-returned', { kind: 'returned' });
  } else if (config.scenario === 'D3-02') {
    emitCallerLine('operation-pending');
    await wait(config.operationDeadlineMs);
    emitCallerLine('operation-returned', { kind: 'timeout' });
  } else {
    emitCallerLine('result-ready');
    await Promise.resolve({ kind: 'returned' });
    emitCallerLine('operation-returned', { kind: 'returned' });
  }
  await Promise.resolve();
  if (config.scenario === 'D3-05') {
    // Closing the dedicated inherited pipe is the scenario fact; no frame is sent.
    target.end();
    targetClosed = true;
  } else {
    await new Promise((resolve, reject) => sendTarget('caller-after-await', { target: 'dedicated-control-frame' }, error => error ? reject(error) : resolve()));
    if (config.scenario === 'D3-04' || config.scenario === 'D3-08') await ack;
  }
  if (config.scenario === 'D3-03' || config.scenario === 'D3-04') {
    busyWait(effective(config.blockMs, scale));
  }
  if (config.scenario === 'D3-08') {
    const body = 'x'.repeat(220);
    for (let i = 1; i <= config.bulkEvents; i += 1) emitCallerLine('bulk', { index: i, body });
  }
  emitCallerLine('caller-finished', { exitCode: 0 });
  if (!targetClosed && !target.destroyed) target.end();
}

async function runWriter(config) {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  let payload;
  try { payload = JSON.parse(input || '{}'); }
  catch (error) { emitLine('writer-failed', { code: 'INVALID_INPUT', error: String(error) }); return; }
  if (config.scenario === 'D3-07') {
    emitLine('writer-entered', { mode: 'synchronous-shim' });
    busyWait(config.writerBlockMs);
    return;
  }
  if (config.scenario === 'D3-06') {
    try {
      fs.openSync(config.archivePath, 'wx');
      emitLine('writer-sealed', { unexpected: true });
    } catch (error) {
      emitLine('writer-failed', { code: error.code ?? 'WRITE_FAILED', error: String(error) });
    }
    return;
  }
  fs.writeFileSync(config.archivePath, json({ schema: SCHEMA, payload }), { flag: 'wx' });
  emitLine('writer-sealed', { bytes: encode(payload).byteLength });
}

export function streamLineReader(stream, onLine, onError) {
  let buffer = Buffer.alloc(0);
  let failed = false;
  const fail = message => {
    if (failed) return;
    failed = true;
    buffer = Buffer.alloc(0);
    onError(new Error(message));
  };
  const consume = chunk => {
    if (failed) return;
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    let offset = 0;
    while (offset < bytes.length && !failed) {
      const newline = bytes.indexOf(10, offset);
      const end = newline < 0 ? bytes.length : newline;
      if (buffer.length + end - offset > CAPACITY.frameBytes) {
        fail('line exceeds frozen frame byte limit');
        return;
      }
      buffer = Buffer.concat([buffer, bytes.subarray(offset, end)]);
      if (newline < 0) return;
      if (!buffer.length) { fail('empty protocol line'); return; }
      const line = buffer.toString('utf8');
      if (!Buffer.from(line).equals(buffer)) { fail('invalid UTF-8 protocol line'); return; }
      buffer = Buffer.alloc(0);
      onLine(line);
      offset = newline + 1;
    }
  };
  stream.on('data', consume);
  stream.once('end', () => { if (buffer.length) fail('truncated protocol line'); });
  stream.once('error', error => fail(`protocol stream error: ${error.message}`));
}

function childLineReader(child, onLine) {
  const invalid = error => onLine(JSON.stringify({ event: 'invalid-writer-frame', detail: { error: error.message } }));
  streamLineReader(child.stdout, onLine, invalid);
  streamLineReader(child.stderr, onLine, invalid);
}

async function observeCaller(config) {
  const started = nowNs();
  const ledger = createTraceLedger();
  let afterAwaitAt = null;
  let resultReady = false;
  let operation = null;
  let channelClosed = false;
  let overflowRecorded = false;
  let closeInfo = null;
  let forced = false;
  let protocolFailed = false;
  let omittedBulk = null;
  const receivedSequences = new Set();
  const channelSequence = new Map();
  let actionTimer;
  let observationTimer;
  let settlementTimer;
  let resolveClose;
  const closePromise = new Promise(resolve => { resolveClose = resolve; });
  const child = spawn(process.execPath, [ENTRY, '--caller', config.configPath], { stdio: ['ignore', 'pipe', 'pipe', 'pipe', 'pipe'] });
  const record = (event, kind = 'control', actor = 'observer') => {
    const observedMs = elapsedMs(started);
    const envelope = { actor, observedNs: String(nowNs()), observedMs, event: event.event, detail: event.detail ?? {} };
    const accepted = ledger.append(envelope, kind);
    if (!accepted && kind === 'bulk' && !overflowRecorded) {
      overflowRecorded = true;
      ledger.append({ actor: 'observer', observedNs: String(nowNs()), observedMs: elapsedMs(started), event: 'capacity-overflow',
        detail: { kind: 'bulk', stats: ledger.stats } }, 'control');
    }
    return accepted;
  };
  const protocolError = error => {
    if (protocolFailed) return;
    protocolFailed = true;
    record({ event: 'caller-protocol-error', detail: { error: String(error.message ?? error) } });
    forced = true;
    try { child.kill('SIGTERM'); } catch {}
  };
  const recordCallerFrame = (frame, channel, kind = 'control') => {
    const observedMs = elapsedMs(started);
    const envelope = { actor: 'caller', channel, observedNs: String(nowNs()), observedMs, frame: clone(frame) };
    // Once capacity drops bulk, preserve a single suffix gap even if later
    // encoded timestamps happen to make individual frames slightly smaller.
    const accepted = kind === 'bulk' && omittedBulk ? false : ledger.append(envelope, kind);
    if (!accepted && kind === 'bulk') {
      if (!omittedBulk) omittedBulk = { firstSequence: frame.sequence, lastSequence: frame.sequence, count: 1 };
      else {
        assert.equal(frame.sequence, omittedBulk.lastSequence + 1, 'non-contiguous bulk omission');
        omittedBulk.lastSequence = frame.sequence;
        omittedBulk.count += 1;
      }
      if (!overflowRecorded) {
        overflowRecorded = true;
        record({ event: 'capacity-overflow', detail: { kind: 'bulk', stats: ledger.stats } });
      }
    }
    if (!accepted && kind === 'control') protocolError(new Error('control ledger capacity exceeded'));
    return observedMs;
  };
  for (const [stream, channel] of [[child.stdout, 'stdout'], [child.stderr, 'stderr'], [child.stdio[3], 'control-fd3']]) {
    streamLineReader(stream, line => {
      if (protocolFailed) return;
      try {
        const frame = validateCallerFrame(JSON.parse(line), config, channel);
        assert(!receivedSequences.has(frame.sequence), 'duplicated caller source sequence');
        assert(frame.sequence > (channelSequence.get(channel) ?? 0), 'same-pipe caller sequence reversed');
        receivedSequences.add(frame.sequence);
        channelSequence.set(channel, frame.sequence);
        const atMs = recordCallerFrame(frame, channel, frame.type === 'bulk' ? 'bulk' : 'control');
        if (frame.type === 'result-ready') resultReady = true;
        if (frame.type === 'operation-returned') operation = frame.detail.kind;
        if (frame.type === 'caller-after-await') {
          afterAwaitAt = atMs;
          if (config.scenario === 'D3-04' || config.scenario === 'D3-08') {
            assert(!child.stdio[4].destroyed, 'observer ACK channel closed');
            record({ event: 'after-await-ack', detail: { channel: 'ack-fd4' } });
            child.stdio[4].write('after-await-ack\n', error => { if (error) protocolError(error); });
          }
        }
      } catch (error) { protocolError(error); }
    }, protocolError);
  }
  child.stdio[4].on('error', protocolError);
  child.once('error', protocolError);
  child.stdio[3].once('end', () => {
    if (config.scenario === 'D3-05') {
      channelClosed = true;
      record({ event: 'after-await-channel-closed', detail: { target: 'dedicated-control-frame' } }, 'control', 'observer');
    } else {
      record({ event: 'control-channel-ended', detail: { target: 'dedicated-control-frame' } }, 'control', 'observer');
    }
  });
  child.once('close', (code, signal) => {
    closeInfo = { code, signal, atMs: elapsedMs(started) };
    resolveClose();
  });
  const scale = Number(config.scale ?? 1);
  observationTimer = setTimeout(() => {
    if (afterAwaitAt === null) record({ event: 'observer-after-await-deadline', detail: { budgetMs: BUDGETS.callerObservationMs } }, 'control', 'observer');
  }, effective(BUDGETS.callerObservationMs, scale));
  actionTimer = setTimeout(() => {
    if (closeInfo) return;
    forced = true;
    record({ event: 'observer-process-action', detail: { action: 'kill', signal: 'SIGTERM' } }, 'control', 'observer');
    try { child.kill('SIGTERM'); } catch (error) { record({ event: 'observer-process-action-error', detail: { error: String(error) } }, 'control', 'observer'); }
  }, effective(BUDGETS.observerProcessActionMs, scale));
  settlementTimer = setTimeout(() => {
    if (closeInfo) return;
    record({ event: 'observer-process-settlement-deadline', detail: { budgetMs: BUDGETS.observerProcessSettlementMs } }, 'control', 'observer');
    forced = true;
    try { child.kill('SIGKILL'); } catch (error) { record({ event: 'observer-process-action-error', detail: { error: String(error) } }, 'control', 'observer'); }
  }, effective(BUDGETS.observerProcessSettlementMs, scale));
  await closePromise;
  clearTimeout(observationTimer); clearTimeout(actionTimer); clearTimeout(settlementTimer);
  if (omittedBulk) record({ event: 'bulk-omitted', detail: omittedBulk });
  const observation = afterAwaitAt !== null && afterAwaitAt <= effective(BUDGETS.callerObservationMs, scale)
    ? { kind: 'observed-within-budget', atMs: afterAwaitAt }
    : { kind: afterAwaitAt === null ? 'not-observed' : 'observed-late', atMs: afterAwaitAt };
  const settlement = forced ? { kind: 'forced-exit-observed', ...closeInfo } : { kind: 'natural-exit', ...closeInfo };
  const result = {
    observation, process: settlement,
    operation: { kind: operation === 'timeout' ? 'timeout' : operation ? 'returned' : 'not-returned' },
    source: { resultReady }, channel: { closed: channelClosed },
    trace: ledger.trace, capacity: ledger.stats,
  };
  return result;
}

async function observeWriter(config, payload) {
  const started = nowNs();
  const events = [];
  let closeInfo = null;
  let forced = false;
  let resolveClose;
  const closePromise = new Promise(resolve => { resolveClose = resolve; });
  const child = spawn(process.execPath, [ENTRY, '--writer', config.configPath], { stdio: ['pipe', 'pipe', 'pipe'] });
  childLineReader(child, line => {
    try { events.push(JSON.parse(line)); }
    catch { events.push({ event: 'invalid-writer-frame', detail: { line: line.slice(0, 128) } }); }
  });
  child.once('close', (code, signal) => { closeInfo = { code, signal, atMs: elapsedMs(started) }; resolveClose(); });
  child.stdin.end(JSON.stringify(payload));
  const scale = Number(config.scale ?? 1);
  const timer = setTimeout(() => {
    if (closeInfo) return;
    forced = true;
    try { child.kill('SIGTERM'); } catch {}
  }, effective(BUDGETS.writerWorkMs, scale));
  const hard = setTimeout(() => {
    if (closeInfo) return;
    forced = true;
    try { child.kill('SIGKILL'); } catch {}
  }, effective(BUDGETS.writerSettlementMs, scale));
  await closePromise;
  clearTimeout(timer); clearTimeout(hard);
  const failed = events.find(event => event.event === 'writer-failed');
  const sealed = events.find(event => event.event === 'writer-sealed');
  const kind = forced ? 'forced-exit-observed' : failed ? 'failed' : sealed ? 'sealed' : 'incomplete';
  return { kind, code: failed?.detail?.code ?? null, events, process: closeInfo };
}

function listFiles(directory) {
  const output = [];
  const visit = (current, prefix = '') => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) visit(path.join(current, entry.name), relative);
      else if (relative !== 'manifest.json') output.push(relative);
    }
  };
  visit(directory);
  return output;
}

function writeManifest(directory) {
  const files = Object.fromEntries(listFiles(directory).map(file => [file,
    sha256(fs.readFileSync(path.join(directory, file)))]));
  exclusive(path.join(directory, 'manifest.json'), { schema: `${SCHEMA}-manifest`, algorithm: 'sha256', files });
}

function verifyManifest(directory) {
  const manifest = readJSON(path.join(directory, 'manifest.json'));
  assert.equal(manifest.algorithm, 'sha256', 'manifest algorithm differs');
  const actual = listFiles(directory);
  const listed = Object.keys(manifest.files ?? {}).sort();
  assert.deepEqual(listed, actual, 'manifest file inventory differs');
  for (const file of listed) {
    assert(!path.isAbsolute(file) && !file.split('/').includes('..'), `unsafe manifest path: ${file}`);
    assert.equal(sha256(fs.readFileSync(path.join(directory, file))), manifest.files[file], `manifest hash differs: ${file}`);
  }
}

const SOURCE_FILES = Object.freeze([ENTRY,
  fileURLToPath(new URL('./diagnostic-observation-envelope-v2.mjs', import.meta.url)),
  fileURLToPath(new URL('./observation-envelope-v2-oracle-test.mjs', import.meta.url)),
]);
const sourceHashes = () => Object.fromEntries(SOURCE_FILES.map(file => [path.basename(file), sha256(fs.readFileSync(file))]));

function deriveFacts(config, trace) {
  const caller = trace.filter(item => item.actor === 'caller').map(item => item.frame);
  const has = type => caller.some(frame => frame.type === type);
  const operationFrame = caller.find(frame => frame.type === 'operation-returned');
  const writerEvents = trace.filter(item => item.actor === 'writer');
  const processSettlement = trace.find(item => item.actor === 'observer' && item.event === 'caller-process-settlement')?.detail;
  const writerSettlement = trace.find(item => item.actor === 'observer' && item.event === 'writer-process-settlement')?.detail;
  const writerFailed = writerEvents.find(item => item.event === 'writer-failed');
  const writerSealed = writerEvents.find(item => item.event === 'writer-sealed');
  const writerKind = writerFailed ? 'failed' : writerSealed ? 'sealed' :
    writerSettlement?.forced ? 'forced-exit-observed' : 'incomplete';
  const overflow = trace.find(item => item.actor === 'observer' && item.event === 'capacity-overflow');
  const observation = deriveObservation(config, trace);
  return {
    observation,
    process: processSettlement ?? { kind: 'unconfirmed' },
    operation: { kind: has('operation-returned') ? (operationFrame.detail?.kind === 'timeout' ? 'timeout' : 'returned') : 'not-returned' },
    source: { resultReady: has('result-ready') },
    channel: { closed: trace.some(item => item.actor === 'observer' && item.event === 'after-await-channel-closed') },
    capacity: { overflow: overflow ? { kind: 'bulk', reason: overflow.detail?.reason ?? null } : null },
    writer: { kind: writerKind, code: writerFailed?.detail?.code ?? null },
  };
}

async function runCase(output, entry, scale = 1) {
  const dir = path.join(output, 'cases', entry.id);
  fs.mkdirSync(dir, { recursive: false });
  const config = {
    ...entry, schema: SCHEMA, nonce: makeNonce(), scale,
    configPath: path.join(dir, 'config.json'),
    blockMs: BUDGETS.observerProcessActionMs + 500,
    operationDeadlineMs: BUDGETS.callerWorkMs,
    bulkEvents: CAPACITY.maxEvents + 200,
    writerBlockMs: BUDGETS.writerWorkMs + 500,
    archivePath: path.join(dir, 'writer-archive.json'),
  };
  if (entry.scenario === 'D3-06') fs.writeFileSync(config.archivePath, 'fixture', { flag: 'wx' });
  exclusive(config.configPath, config);
  const caller = await observeCaller(config);
  const payload = { id: entry.id, operation: caller.operation, observation: caller.observation, capacity: caller.capacity };
  const writer = await observeWriter(config, payload);
  const trace = caller.trace.concat([
    { actor: 'observer', observedNs: String(nowNs()), event: 'caller-process-settlement', detail: caller.process },
    ...writer.events.map((event, index) => ({ actor: 'writer', observedNs: String(nowNs()), sequence: index + 1, event: event.event, detail: event.detail })),
    { actor: 'observer', observedNs: String(nowNs()), event: 'writer-process-settlement', detail: { ...writer.process, forced: writer.kind === 'forced-exit-observed' } },
    { actor: 'observer', observedNs: String(nowNs()), event: 'evidence-settlement', detail: { kind: 'sealed' } },
  ]);
  exclusiveText(path.join(dir, 'trace.ndjson'), `${trace.map(event => JSON.stringify(event)).join('\n')}\n`);
  const derived = deriveFacts(config, trace);
  const scenarioVerdict = expectedCase(config, derived);
  const result = {
    schema: SCHEMA, id: entry.id, scenario: entry.scenario, run: entry.run, generation: entry.generation,
    declaredBudgets: BUDGETS, effectiveScale: scale, ...derived,
    writer, scenarioVerdict, evidenceIntegrity: 'sealed',
  };
  exclusive(path.join(dir, 'result.json'), result);
  // This final publisher is intentionally outside the injected writer process.
  exclusive(path.join(dir, 'publisher.json'), { schema: SCHEMA, source: 'independent-publisher', result: clone(result) });
  writeManifest(dir);
  return result;
}

function verifyCase(directory, entry, scale) {
  const dir = path.join(directory, 'cases', entry.id);
  assert(fs.existsSync(dir), 'missing case directory');
  const config = readJSON(path.join(dir, 'config.json'));
  validateCaseConfig(config, entry, scale);
  verifyManifest(dir);
  const traceText = fs.readFileSync(path.join(dir, 'trace.ndjson'), 'utf8');
  assert(traceText.endsWith('\n'), 'truncated trace');
  const trace = traceText.trimEnd().split('\n').filter(Boolean).map(line => {
    const event = JSON.parse(line);
    assert(event && typeof event === 'object' && !Array.isArray(event), 'trace line is not an object');
    return event;
  });
  validateCallerTrace(config, trace);
  const result = readJSON(path.join(dir, 'result.json'));
  for (const key of ['id', 'scenario', 'run', 'generation']) assert.equal(result[key], entry[key], `result ${key} differs`);
  assert.equal(result.schema, SCHEMA, 'result schema differs');
  assert.equal(result.effectiveScale, scale, 'result scale differs');
  assert.deepEqual(result.declaredBudgets, BUDGETS, 'result budgets differ');
  const derivedResult = deriveFacts(config, trace);
  const expected = expectedCase(config, derivedResult);
  assert(expected.pass, `raw trace does not satisfy ${entry.id}: ${JSON.stringify(expected)}`);
  assert.deepEqual(result.scenarioVerdict, expected, 'scenario verdict was not derived from raw facts');
  assert.deepEqual(result.process, derivedResult.process, 'saved process fact differs from raw settlement');
  assert.deepEqual(result.observation, derivedResult.observation, 'saved observation fact differs from raw trace');
  assert.deepEqual(result.operation, derivedResult.operation, 'saved operation fact differs from raw trace');
  assert.deepEqual(result.source, derivedResult.source, 'saved source fact differs from raw trace');
  assert.deepEqual(result.channel, derivedResult.channel, 'saved channel fact differs from raw trace');
  assert.deepEqual(result.capacity, derivedResult.capacity, 'saved capacity fact differs from raw trace');
  assert.deepEqual(result.writer && { kind: result.writer.kind, code: result.writer.code }, derivedResult.writer,
    'saved writer fact differs from raw settlement');
  assert.equal(result.evidenceIntegrity, 'sealed', 'publisher did not seal evidence');
  const publisher = readJSON(path.join(dir, 'publisher.json'));
  assert.deepEqual(publisher.result, result, 'publisher receipt differs from result');
  return { id: entry.id, pass: true };
}

export function verifyEvidence(directory) {
  const report = { schema: SCHEMA, scope: SCOPE, directory, attempted: 0, verified: 0, failures: [], evidenceErrors: [] };
  let scale;
  // An inventory failure must not prevent independent checks of intact cases.
  try { verifyManifest(directory); }
  catch (error) { report.evidenceErrors.push({ id: 'shared-manifest', error: error.message }); }
  try {
    const run = readJSON(path.join(directory, 'run.json'));
    scale = run.scale;
    assert(scale === 1 || scale === 0.25, 'run scale differs from full/self-test schedule');
    assert.equal(run.schema, SCHEMA, 'run schema differs');
    assert.equal(run.nativeProcesses, 0, 'D3 native process count differs');
    assert.equal(run.pty, false, 'D3 PTY scope differs');
    assert.deepEqual(run.schedule, schedule(), 'schedule differs');
    assert.deepEqual(run.budgets, BUDGETS, 'budgets differ');
    assert.deepEqual(run.capacity, CAPACITY, 'capacity differs');
    assert.deepEqual(run.sourceHashes, sourceHashes(), 'diagnostic source hash differs');
    for (const file of SOURCE_FILES) {
      const snapshot = path.join(directory, 'sources', path.basename(file));
      assert.equal(sha256(fs.readFileSync(snapshot)), run.sourceHashes[path.basename(file)], `source snapshot differs: ${file}`);
    }
  } catch (error) {
    report.evidenceErrors.push({ id: 'shared', error: error.message });
  }
  for (const entry of schedule()) {
    report.attempted += 1;
    try { verifyCase(directory, entry, scale); report.verified += 1; }
    catch (error) { report.evidenceErrors.push({ id: entry.id, error: error.message }); }
  }
  try {
    const summary = readJSON(path.join(directory, 'summary.json'));
    assert.equal(summary.schema, SCHEMA, 'summary schema differs');
    assert.equal(summary.nativeProcesses, 0, 'D3 summary native process count differs');
    assert.equal(summary.pty, false, 'D3 summary PTY scope differs');
    assert.deepEqual(summary.results.map(item => item.id), schedule().map(item => item.id), 'summary schedule differs');
    assert(summary.pass === true && summary.results.every(item => item.pass === true), 'summary reports failure');
  } catch (error) {
    report.evidenceErrors.push({ id: 'summary', error: error.message });
  }
  report.pass = report.attempted === schedule().length && report.verified === schedule().length &&
    report.failures.length === 0 && report.evidenceErrors.length === 0;
  return report;
}

export async function runEvidence(output, { scale = 1 } = {}) {
  assert(scale === 1 || scale === 0.25, 'unsupported diagnostic scale');
  assert(!fs.existsSync(output), 'Refusing to overwrite evidence directory');
  fs.mkdirSync(path.join(output, 'cases'), { recursive: true });
  fs.mkdirSync(path.join(output, 'sources'));
  const hashes = sourceHashes();
  for (const file of SOURCE_FILES) fs.copyFileSync(file, path.join(output, 'sources', path.basename(file)), fs.constants.COPYFILE_EXCL);
  const entries = schedule();
  exclusive(path.join(output, 'run.json'), {
    schema: SCHEMA, scope: SCOPE, nativeProcesses: 0, pty: false,
    platform: process.platform, arch: process.arch,
    node: process.version, host: os.hostname(), budgets: BUDGETS, capacity: CAPACITY,
    scale, schedule: entries, sourceHashes: hashes,
    sourceCommit: (() => { try { return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { return null; } })(),
    createdAt: new Date().toISOString(),
  });
  const results = [];
  for (const entry of entries) {
    try {
      const result = await runCase(output, entry, scale);
      results.push({ id: entry.id, pass: result.scenarioVerdict.pass, scenarioVerdict: result.scenarioVerdict,
        observation: result.observation, process: result.process, evidenceIntegrity: result.evidenceIntegrity });
    } catch (error) {
      results.push({ id: entry.id, pass: false, error: String(error.stack ?? error) });
    }
  }
  exclusive(path.join(output, 'summary.json'), {
    schema: SCHEMA, scope: SCOPE, nativeProcesses: 0, pty: false,
    results, pass: results.every(item => item.pass),
  });
  writeManifest(output);
  return verifyEvidence(output);
}

async function runParserTests() {
  const fixtures = [
    { id: 'split-lines', chunks: ['ab', 'c\nd', 'ef\n'], lines: ['abc', 'def'], error: null },
    { id: 'exact-byte-limit', chunks: ['x'.repeat(CAPACITY.frameBytes), '\n'], lines: ['x'.repeat(CAPACITY.frameBytes)], error: null },
    { id: 'oversized-single-chunk', chunks: ['x'.repeat(CAPACITY.frameBytes + 1) + '\nignored\n'], lines: [], error: 'exceeds' },
    { id: 'oversized-split-chunk', chunks: ['x'.repeat(CAPACITY.frameBytes), 'x', '\nignored\n'], lines: [], error: 'exceeds' },
    { id: 'truncated-line', chunks: ['unterminated'], lines: [], error: 'truncated' },
    { id: 'empty-line', chunks: ['\nignored\n'], lines: [], error: 'empty' },
    { id: 'invalid-utf8', chunks: [Buffer.from([255, 10])], lines: [], error: 'UTF-8' },
    { id: 'split-utf8', chunks: [Buffer.from([195]), Buffer.from([169, 10])], lines: ['\u00e9'], error: null },
  ];
  const results = [];
  for (const fixture of fixtures) {
    const stream = new PassThrough();
    const lines = [];
    const errors = [];
    streamLineReader(stream, line => lines.push(line), error => errors.push(error.message));
    const end = once(stream, 'end');
    for (const chunk of fixture.chunks) stream.write(chunk);
    stream.end();
    await end;
    assert.deepEqual(lines, fixture.lines, `${fixture.id}: lines differ`);
    assert.equal(errors.length, fixture.error ? 1 : 0, `${fixture.id}: error count differs`);
    if (fixture.error) assert(errors[0].includes(fixture.error), `${fixture.id}: wrong rejection`);
    results.push({ id: fixture.id, chunksBase64: fixture.chunks.map(chunk => Buffer.from(chunk).toString('base64')),
      expectedLines: fixture.lines, expectedError: fixture.error, lines, errors, pass: true });
  }
  return { scope: 'bounded line parser only; not a native or settlement test', pass: true, results };
}

async function selfTest() {
  const root = path.resolve(process.env.DSC_OBSERVATION_ENVELOPE_SELFTEST_EVIDENCE
    ?? path.join(REPO, '.debug', `observation-envelope-selftest-${randomUUID()}`));
  assert(!fs.existsSync(root), `Refusing to overwrite self-test directory: ${root}`);
  fs.mkdirSync(root, { recursive: true });
  const oracle = runOracleTests();
  exclusive(path.join(root, 'oracle-tests.json'), oracle);
  assert(oracle.pass, 'deterministic oracle replay failed; see oracle-tests.json');
  exclusive(path.join(root, 'parser-tests.json'), await runParserTests());
  const output = path.join(root, 'positive');
  const report = await runEvidence(output, { scale: 0.25 });
  assert(report.pass, `self-test positive schedule failed: ${JSON.stringify(report)}`);
  const tampered = path.join(root, 'tampered');
  fs.cpSync(output, tampered, { recursive: true, errorOnExist: true });
  const first = path.join(tampered, 'cases', 'D3-01-1', 'result.json');
  const original = readJSON(first);
  fs.writeFileSync(first, json({ ...original, scenarioVerdict: { pass: true, checks: {} } }));
  const rejected = verifyEvidence(tampered);
  exclusive(path.join(root, 'tampered-verification.json'), rejected);
  assert(!rejected.pass && rejected.evidenceErrors.some(item => item.id === 'D3-01-1'), 'tampered verdict was accepted');
  assert.equal(rejected.attempted, 24, 'tamper verification did not visit the full schedule');
  assert.equal(rejected.verified, 23, 'tamper verification did not verify all intact cases');
  assert(!rejected.evidenceErrors.some(item => item.id === 'D3-08-3'), 'last intact case failed after first-case tamper');
  const result = {
    schema: SCHEMA,
    scope: SCOPE,
    synthetic: true,
    nativeProcesses: 0,
    pass: true,
    checks: ['deterministic-protocol-replay', 'bounded-line-parser', '24-case-positive-schedule', 'raw-verdict-tamper-rejected'],
    oracleChecks: oracle.verified,
    parserChecks: 8,
    positiveEvidence: 'positive',
    tamperedEvidence: 'tampered',
  };
  exclusive(path.join(root, 'self-test.json'), result);
  writeManifest(root);
  return { ...result, evidence: root };
}

async function main() {
  const { values } = parseArgs({ options: {
    output: { type: 'string' }, 'verify-saved': { type: 'string' }, 'self-test': { type: 'boolean' },
    caller: { type: 'string' }, writer: { type: 'string' },
  } });
  if (values.caller) { await runCaller(readJSON(values.caller)); return; }
  if (values.writer) { await runWriter(readJSON(values.writer)); return; }
  const selected = [values.output, values['verify-saved'], values['self-test']].filter(Boolean);
  assert.equal(selected.length, 1, 'Choose exactly one of --self-test, --output NEW_DIR, or --verify-saved DIRECTORY');
  const report = values['self-test'] ? await selfTest() : values['verify-saved']
    ? verifyEvidence(path.resolve(values['verify-saved'])) : await runEvidence(path.resolve(values.output));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.pass) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === ENTRY) {
  main().catch(error => { console.error(error.stack ?? error); process.exitCode = 1; });
}
