import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  BUDGETS, CAPACITY, CASES, SCHEMA, caseId, clone, createTraceLedger,
  encode, expectedCase, makeFrame, makeNonce, schedule,
} from './diagnostic-observation-envelope-v1.mjs';

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
  const sendTarget = (event, detail = {}, onDone) => target.write(`${JSON.stringify({ schema: SCHEMA, event, detail, atNs: String(nowNs()) })}\n`, onDone);
  let ackResolve;
  const ack = new Promise(resolve => { ackResolve = resolve; });
  if (config.scenario === 'D3-04') {
    let buffer = '';
    const input = fs.createReadStream(null, { fd: 4, autoClose: true });
    input.on('data', chunk => {
      buffer += chunk.toString();
      if (buffer.includes('after-await-ack')) ackResolve();
    });
  }
  emitLine('caller-start', { case: config.id, generation: config.generation });
  if (config.scenario === 'D3-03') {
    emitLine('result-ready');
    // The synchronous section prevents the promise continuation from running.
    busyWait(effective(config.blockMs, scale));
    emitLine('operation-returned', { kind: 'returned' });
  } else if (config.scenario === 'D3-02') {
    emitLine('operation-pending');
    await wait(config.operationDeadlineMs);
    emitLine('operation-returned', { kind: 'timeout' });
  } else {
    emitLine('result-ready');
    await Promise.resolve({ kind: 'returned' });
    emitLine('operation-returned', { kind: 'returned' });
  }
  await Promise.resolve();
  if (config.scenario === 'D3-05') {
    // Closing the dedicated inherited pipe is the scenario fact; no frame is sent.
    target.end();
    targetClosed = true;
  } else {
    await new Promise((resolve, reject) => sendTarget('caller-after-await', { target: 'dedicated-control-frame' }, error => error ? reject(error) : resolve()));
    if (config.scenario === 'D3-04') await ack;
  }
  if (config.scenario === 'D3-03' || config.scenario === 'D3-04') {
    busyWait(effective(config.blockMs, scale));
  }
  if (config.scenario === 'D3-08') {
    const body = 'x'.repeat(220);
    for (let i = 1; i <= config.bulkEvents; i += 1) emitLine('bulk', { index: i, body });
  }
  emitLine('caller-finished', { exitCode: 0 });
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

function streamLineReader(stream, onLine) {
  let buffer = '';
  const consume = chunk => {
    buffer += chunk.toString();
    for (;;) {
      const at = buffer.indexOf('\n');
      if (at < 0) break;
      const line = buffer.slice(0, at);
      buffer = buffer.slice(at + 1);
      if (line) onLine(line);
    }
  };
  stream.on('data', consume);
}

function childLineReader(child, onLine) {
  streamLineReader(child.stdout, onLine);
  streamLineReader(child.stderr, onLine);
}

async function observeCaller(config) {
  const started = nowNs();
  const ledger = createTraceLedger();
  const raw = [];
  let frameSequence = 0;
  let afterAwaitAt = null;
  let resultReady = false;
  let operation = null;
  let channelClosed = false;
  let overflowRecorded = false;
  let closeInfo = null;
  let forced = false;
  let actionTimer;
  let observationTimer;
  let settlementTimer;
  let resolveClose;
  const closePromise = new Promise(resolve => { resolveClose = resolve; });
  const child = spawn(process.execPath, [ENTRY, '--caller', config.configPath], { stdio: ['ignore', 'pipe', 'pipe', 'pipe', 'pipe'] });
  const record = (event, kind = 'control', actor = 'caller') => {
    const observedMs = elapsedMs(started);
    const envelope = actor === 'caller'
      ? { actor, observedNs: String(nowNs()), observedMs, frame: makeFrame({ run: config.run, caseId: config.id, generation: config.generation,
        nonce: config.nonce, sequence: ++frameSequence, type: event.event, detail: event.detail ?? {} }) }
      : { actor, observedNs: String(nowNs()), observedMs, event: event.event, detail: event.detail ?? {} };
    const accepted = ledger.append(envelope, kind);
    if (!accepted && kind === 'bulk' && !overflowRecorded) {
      overflowRecorded = true;
      ledger.append({ actor: 'observer', observedNs: String(nowNs()), observedMs: elapsedMs(started), event: 'capacity-overflow',
        detail: { kind: 'bulk', stats: ledger.stats } }, 'control');
    }
    raw.push({ ...event, accepted, kind });
  };
  childLineReader(child, line => {
    let message;
    try { message = JSON.parse(line); }
    catch { record({ event: 'invalid-caller-frame', detail: { line: line.slice(0, 128) } }); return; }
    const type = message.event;
    const kind = type === 'bulk' ? 'bulk' : 'control';
    record({ event: type, detail: message.detail }, kind);
    if (type === 'result-ready') resultReady = true;
    if (type === 'operation-returned') operation = message.detail?.kind ?? 'returned';
    if (type === 'caller-after-await') afterAwaitAt = elapsedMs(started);
    if (type === 'after-await-channel-closed') channelClosed = true;
  });
  streamLineReader(child.stdio[3], line => {
    let message;
    try { message = JSON.parse(line); }
    catch { record({ event: 'invalid-control-frame', detail: { line: line.slice(0, 128) } }, 'control', 'observer'); return; }
    if (message.event === 'caller-after-await') {
      afterAwaitAt = elapsedMs(started);
      if (config.scenario === 'D3-04' && !child.stdio[4].destroyed) child.stdio[4].write('after-await-ack\n');
    }
    record({ event: message.event, detail: message.detail }, 'control');
  });
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
  const observation = afterAwaitAt !== null && afterAwaitAt <= effective(BUDGETS.callerObservationMs, scale)
    ? { kind: 'observed-within-budget', atMs: afterAwaitAt }
    : { kind: afterAwaitAt === null ? 'not-observed' : 'observed-late', atMs: afterAwaitAt };
  const settlement = forced ? { kind: 'forced-exit-observed', ...closeInfo } : { kind: 'natural-exit', ...closeInfo };
  const result = {
    observation, process: settlement,
    operation: { kind: operation === 'timeout' ? 'timeout' : operation ? 'returned' : 'not-returned' },
    source: { resultReady }, channel: { closed: channelClosed },
    trace: ledger.trace, raw, capacity: ledger.stats,
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

const SOURCE_FILES = Object.freeze([ENTRY, fileURLToPath(new URL('./diagnostic-observation-envelope-v1.mjs', import.meta.url))]);
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
  const afterAwait = trace.find(item => item.actor === 'caller' && item.frame?.type === 'caller-after-await');
  const observedMs = afterAwait?.observedMs ?? null;
  const observation = afterAwait
    ? { kind: typeof observedMs === 'number' && observedMs <= effective(BUDGETS.callerObservationMs, config.scale) ? 'observed-within-budget' : 'observed-late', atMs: observedMs }
    : { kind: 'not-observed', atMs: null };
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
  const derived = deriveFacts(config, trace);
  const scenarioVerdict = expectedCase(config, derived);
  const result = {
    schema: SCHEMA, id: entry.id, scenario: entry.scenario, run: entry.run, generation: entry.generation,
    declaredBudgets: BUDGETS, effectiveScale: scale, ...derived,
    writer, scenarioVerdict, evidenceIntegrity: 'sealed',
  };
  fs.writeFileSync(path.join(dir, 'trace.ndjson'), `${trace.map(event => JSON.stringify(event)).join('\n')}\n`, { flag: 'wx' });
  exclusive(path.join(dir, 'result.json'), result);
  // This final publisher is intentionally outside the injected writer process.
  exclusive(path.join(dir, 'publisher.json'), { schema: SCHEMA, source: 'independent-publisher', result: clone(result) });
  writeManifest(dir);
  return result;
}

function verifyCase(directory, entry) {
  const dir = path.join(directory, 'cases', entry.id);
  assert(fs.existsSync(dir), 'missing case directory');
  const config = readJSON(path.join(dir, 'config.json'));
  assert.equal(config.id, entry.id, 'case identity differs');
  assert.equal(config.schema, SCHEMA, 'case schema differs');
  verifyManifest(dir);
  const traceText = fs.readFileSync(path.join(dir, 'trace.ndjson'), 'utf8');
  assert(traceText.endsWith('\n'), 'truncated trace');
  const trace = traceText.trimEnd().split('\n').filter(Boolean).map(line => {
    const event = JSON.parse(line);
    assert(event && typeof event === 'object' && !Array.isArray(event), 'trace line is not an object');
    return event;
  });
  const callerFrames = trace.filter(event => event.actor === 'caller' && event.frame).map(event => event.frame);
  const frameSequences = callerFrames.map(frame => frame.sequence);
  assert.equal(frameSequences[0], 1, 'caller frame sequence does not start at one');
  assert(frameSequences.every((sequence, index) => index === 0 || sequence > frameSequences[index - 1]), 'caller frame sequence is not strictly increasing');
  assert.equal(new Set(callerFrames.map(frame => frame.nonce)).size, 1, 'caller frame nonce is not stable');
  const callerTypes = callerFrames.map(frame => frame.type);
  const position = type => callerTypes.indexOf(type);
  if (position('operation-returned') >= 0 && entry.scenario !== 'D3-02') assert(position('result-ready') >= 0 && position('result-ready') < position('operation-returned'), 'operation returned before result-ready');
  if (position('caller-after-await') >= 0) assert(position('operation-returned') >= 0 && position('operation-returned') < position('caller-after-await'), 'after-await preceded operation return');
  if (entry.scenario === 'D3-04' && position('caller-after-await') >= 0) {
    const afterIndex = trace.findIndex(event => event.actor === 'caller' && event.frame?.type === 'caller-after-await');
    const actionIndex = trace.findIndex(event => event.actor === 'observer' && event.event === 'observer-process-action');
    assert(actionIndex < 0 || afterIndex < actionIndex, 'D3-04 action preceded after-await confirmation');
  }
  for (const event of trace) {
    if (event.frame) {
      const size = encode(event.frame).byteLength;
      assert(size <= CAPACITY.frameBytes, 'frame exceeds frozen limit');
      assert.equal(event.frame.schema, SCHEMA, 'frame schema differs');
      assert.equal(event.frame.case, entry.id, 'frame case identity differs');
      assert.equal(event.frame.generation, config.generation, 'frame generation differs');
      assert.equal(event.frame.nonce, config.nonce, 'frame nonce differs');
      assert.equal(event.frame.run, config.run, 'frame run differs');
      assert(Number.isSafeInteger(event.frame.sequence) && event.frame.sequence > 0, 'frame sequence invalid');
    }
  }
  const result = readJSON(path.join(dir, 'result.json'));
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
  try {
    verifyManifest(directory);
    const run = readJSON(path.join(directory, 'run.json'));
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
    try { verifyCase(directory, entry); report.verified += 1; }
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

async function selfTest() {
  const root = path.resolve(process.env.DSC_OBSERVATION_ENVELOPE_SELFTEST_EVIDENCE
    ?? path.join(REPO, '.debug', `observation-envelope-selftest-${randomUUID()}`));
  assert(!fs.existsSync(root), `Refusing to overwrite self-test directory: ${root}`);
  const output = path.join(root, 'positive');
  const report = await runEvidence(output, { scale: 0.25 });
  assert(report.pass, `self-test positive schedule failed: ${JSON.stringify(report)}`);
  const tampered = path.join(root, 'tampered');
  fs.cpSync(output, tampered, { recursive: true, errorOnExist: true });
  const first = path.join(tampered, 'cases', 'D3-01-1', 'result.json');
  const original = readJSON(first);
  fs.writeFileSync(first, json({ ...original, scenarioVerdict: { pass: true, checks: {} } }));
  const rejected = verifyEvidence(tampered);
  assert(!rejected.pass && rejected.evidenceErrors.some(item => item.id === 'D3-01-1'), 'tampered verdict was accepted');
  const result = {
    schema: SCHEMA,
    scope: SCOPE,
    synthetic: true,
    nativeProcesses: 0,
    pass: true,
    checks: ['24-case-positive-schedule', 'raw-verdict-tamper-rejected'],
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
