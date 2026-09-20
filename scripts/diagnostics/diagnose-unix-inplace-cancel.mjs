// Separate frozen diagnostic; no production API or older experiment is changed.
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const require = createRequire(import.meta.url), script = fileURLToPath(import.meta.url);
const settings = Object.freeze({ runs: 3, payloadBytes: 2048, firstReadBytes: 64, readBytes: 65536,
  idleMs: 2, callbackHoldMs: 100, sampleMs: 10000, resourceGuardMs: 1000, hardMs: 15000, cols: 96, rows: 28 });
const scenarios = ['cancel-request-pending', 'cancel-callback-held', 'read-through-control', 'receipt-held-control'];
const schedule = scenarios.flatMap(scenario => Array.from({ length: settings.runs }, (_, i) => ({ scenario, run: i + 1 })));
const payload = Buffer.alloc(settings.payloadBytes, 'C');
const scope = 'In-place readiness, independent receipt gate, and owned-read cancellation; not production acceptance or historical race replay.';
const { values } = parseArgs({ options: { output: { type: 'string' }, sample: { type: 'string' }, fixture: { type: 'string' },
  'verify-saved': { type: 'string' }, 'self-test': { type: 'boolean' }, 'watchdog-block': { type: 'string' } } });

try {
  if (values.fixture) await fixture(readJSON(values.fixture));
  else if (values.sample) await sample(readJSON(values.sample));
  else if (values['watchdog-block']) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30000);
  else if (values['self-test']) await selfTest();
  else if (values['verify-saved']) await verifySaved(path.resolve(values['verify-saved']));
  else await run();
} catch (error) {
  if (values.fixture) {
    const config = readJSON(values.fixture);
    save(config.dir, 'fixture-error.json', { token: config.token, pid: process.pid, error: String(error), code: error.code });
  } else console.error(error.stack ?? error);
  process.exitCode = 1;
}

async function fixture(config) {
  const { dir, token } = config;
  save(dir, 'fixture-owner.json', { pid: process.pid, token, configPath: path.join(dir, 'config.json'),
    stdinTTY: Boolean(process.stdin.isTTY), stdoutTTY: Boolean(process.stdout.isTTY) });
  let call = 0, written = 0;
  const writer = [];
  const trace = detail => {
    const event = { token, pid: process.pid, ns: now(), ...detail };
    writer.push(event); append(dir, 'writer-events.ndjson', event);
    save(dir, 'writer-state.json', writer);
  };
  while (written < payload.length) {
    trace({ phase: 'enter', call: ++call, written, requested: payload.length - written });
    let count;
    try { count = fs.writeSync(1, payload, written, payload.length - written); }
    catch (error) { trace({ phase: 'error', call, written, code: error.code, errno: error.errno }); throw error; }
    assert(count > 0 && count <= payload.length - written);
    written += count;
    trace({ phase: 'returned', call, written, count });
  }
  if (config.scenario === 'receipt-held-control') {
    trace({ phase: 'receipt-wait' });
    while (!fs.existsSync(path.join(dir, 'receipt-release.json'))) await sleep(settings.idleMs);
    const release = readJSON(path.join(dir, 'receipt-release.json'));
    assert.equal(release.token, token);
    trace({ phase: 'receipt-release-observed', release });
  }
  trace({ phase: 'receipt-publish-start' });
  save(dir, 'writer-receipt.json', { token, pid: process.pid, written, hash: hash(payload), complete: true,
    stdoutTTY: Boolean(process.stdout.isTTY), ns: now() });
  trace({ phase: 'receipt-published' });
  while (!fs.existsSync(path.join(dir, 'exit-gate.json'))) await sleep(settings.idleMs);
  const gate = readJSON(path.join(dir, 'exit-gate.json'));
  assert.equal(gate.token, token);
  trace({ phase: 'gate-observed', gate });
}

function compile(dir) {
  const output = path.join(dir, 'compiled'); fs.mkdirSync(output);
  const record = { compiler: process.platform === 'darwin' ? 'clang' : 'gcc' };
  try {
    const candidates = process.env.DSC_NODE_INCLUDE_DIR ? [path.resolve(process.env.DSC_NODE_INCLUDE_DIR)] :
      [path.resolve(path.dirname(fs.realpathSync(process.execPath)), '../include/node'), '/usr/include/node'];
    record.headers = candidates.find(p => fs.existsSync(path.join(p, 'node_api.h')));
    assert(record.headers, 'Missing Node headers; set DSC_NODE_INCLUDE_DIR');
    record.headerFiles = [];
    fs.mkdirSync(path.join(output, 'headers'));
    for (const name of ['node_api.h', 'node_api_types.h', 'js_native_api.h', 'js_native_api_types.h', 'node_version.h']) {
      const file = path.join(record.headers, name), snapshot = `compiled/headers/${name}`;
      fs.copyFileSync(file, path.join(dir, snapshot));
      record.headerFiles.push({ file, snapshot, hash: hash(fs.readFileSync(file)) });
    }
    record.version = execFileSync(record.compiler, ['--version'], { encoding: 'utf8', timeout: 10000 });
    record.source = 'compiled/unix-pty-observer.c'; record.binary = 'compiled/unix-pty-observer.node';
    fs.copyFileSync(path.join(path.dirname(script), 'unix-pty-observer.c'), path.join(dir, record.source));
    record.sourceHash = hash(fs.readFileSync(path.join(dir, record.source)));
    record.args = ['-std=c99', '-Wall', '-Wextra', '-Werror', '-I', record.headers, '-DNODE_GYP_MODULE_NAME=unix_pty_observer',
      ...(process.platform === 'darwin' ? ['-bundle', '-undefined', 'dynamic_lookup'] : ['-shared', '-fPIC']),
      path.join(dir, record.source), '-o', path.join(dir, record.binary)];
    const result = spawnSync(record.compiler, record.args, { encoding: 'utf8', timeout: 10000 });
    Object.assign(record, { code: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr, error: result.error?.message });
    assert.equal(result.status, 0, 'Observer compilation failed');
    record.binaryHash = hash(fs.readFileSync(path.join(dir, record.binary)));
  } catch (error) { record.error = error.stack ?? String(error); }
  save(dir, 'compilation.json', record);
  assert(!record.error && record.code === 0, `See ${dir}/compilation.json`);
  return path.join(dir, record.binary);
}

function environment(dir) {
  const native = require('node-pty/lib/utils').loadNativeModule('pty');
  const lib = path.dirname(require.resolve('node-pty/lib/unixTerminal'));
  const files = [script, require.resolve('node-pty/lib/unixTerminal'), require.resolve('@xterm/headless'), path.resolve(lib, native.dir, 'pty.node')];
  if (process.platform === 'darwin') files.push(path.resolve(lib, native.dir, 'spawn-helper'));
  fs.mkdirSync(path.join(dir, 'source-snapshot'));
  const sources = files.map((file, i) => {
    const snapshot = `source-snapshot/${i}-${path.basename(file)}`;
    fs.copyFileSync(file, path.join(dir, snapshot));
    return { file, snapshot, hash: hash(fs.readFileSync(file)) };
  });
  save(dir, 'environment.json', { scope, settings, sources, platform: process.platform, arch: process.arch, kernel: os.release(),
    versions: process.versions, nodePty: require('node-pty/package.json').version,
    github: { sha: process.env.GITHUB_SHA, runId: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT,
      image: process.env.ImageOS, imageVersion: process.env.ImageVersion } });
}

async function run() {
  assert(['linux', 'darwin'].includes(process.platform)); assert(values.output);
  const dir = path.resolve(values.output); assert(!fs.existsSync(dir), 'Refusing to overwrite evidence'); fs.mkdirSync(dir, { recursive: true });
  save(dir, 'schedule.json', { settings, entries: schedule });
  const observer = compile(dir); environment(dir);
  const results = [];
  for (const entry of schedule) {
    const config = { ...entry, dir: path.join(dir, name(entry)), token: randomUUID(), observer };
    fs.mkdirSync(config.dir); save(config.dir, 'config.json', config);
    const driver = await watch(config);
    save(config.dir, 'driver-exit.json', driver);
    const cleanup = await cleanupFixture(config); save(config.dir, 'cleanup.json', cleanup);
    const result = capture(config);
    Object.assign(result, { driver, cleanup, natural: optional(config.dir, 'natural-exit.json') });
    result.assessment = assess(result); results.push(result); save(dir, 'summary.json', results);
    console.log(JSON.stringify({ ...entry, candidate: result.receivedBytes, audit: result.auditBytes,
      source: result.source, pass: result.assessment.pass, failures: result.assessment.failures }));
  }
  console.log(JSON.stringify({ samples: results.length, failures: results.filter(r => !r.assessment.pass).length, evidence: dir }));
  if (results.some(r => !r.assessment.pass)) process.exitCode = 1;
}

async function sample(config) {
  const { dir, scenario, token } = config;
  const cancelCase = scenario.startsWith('cancel-');
  const events = [], raw = [], audit = [];
  for (const file of ['events.ndjson', 'received.bin', 'audit.bin', 'callbacks.bin']) fs.writeFileSync(path.join(dir, file), '');
  const mark = (event, detail = {}) => { const entry = { ns: now(), event, ...detail }; events.push(entry); append(dir, 'events.ndjson', entry); };
  const { Terminal } = require('@xterm/headless');
  const terminal = new Terminal({ cols: settings.cols, rows: settings.rows, scrollback: 100000, allowProposedApi: true });
  const decoder = new StringDecoder('utf8'), jobs = [];
  let fd, pid, initial, exit, source, auditSource, errorDetail, closed = false, closeProbe, closeError;
  let pending = null, held = null, readId = 0, receivedBytes = 0, auditBytes = 0, accepted = 0, completed = 0;
  let cancelled = false, gate = false, release = false, controlStop = false, controlJob, heldResolve, timedOut = false, decoderEnded = false;
  let rejectFailure, resolveExit;
  const failure = new Promise((_, reject) => { rejectFailure = reject; }); failure.catch(() => {});
  const exited = new Promise(resolve => { resolveExit = resolve; });
  const bounded = promise => Promise.race([promise, failure]);
  const timer = setTimeout(() => { timedOut = true; mark('deadline', { pending, held }); rejectFailure(new Error('Deadline is interruption, not EOF')); }, settings.sampleMs);
  const inspector = require(config.observer);
  const observe = (stage, id = null) => {
    const report = inspector.observe(fd); mark('observe', { stage, id, report });
    validateObservation(report, initial ?? report); return report;
  };
  const enqueue = text => {
    if (!text) return;
    const sequence = ++accepted; mark('consumer-enqueue', { sequence, bytes: Buffer.byteLength(text), hash: hash(text) });
    jobs.push(new Promise(resolve => terminal.write(text, () => {
      mark('parser-applied', { sequence }); completed++; mark('consumer-complete', { sequence }); resolve();
    })));
  };
  const deliver = (owner, answer) => {
    if (!answer.bytes.length) return;
    if (owner === 'candidate') { raw.push(answer.bytes); receivedBytes += answer.bytes.length; }
    else { audit.push(answer.bytes); auditBytes += answer.bytes.length; }
    fs.appendFileSync(path.join(dir, owner === 'candidate' ? 'received.bin' : 'audit.bin'), answer.bytes);
    mark('deliver', { owner, id: answer.id, bytes: answer.bytes.length, hash: hash(answer.bytes) });
    if (owner === 'candidate') enqueue(decoder.write(answer.bytes));
  };
  const finish = (reason, id = null) => {
    assert(!source && !pending && !held);
    const tail = decoder.end(); decoderEnded = true; mark('decoder-end', { bytes: Buffer.byteLength(tail), hash: hash(tail) }); enqueue(tail);
    source = reason; mark('candidate-source', { reason, id });
  };
  const cancel = () => { assert(!cancelled); cancelled = true; mark('cancel', { pending, held, fixtureAlive: alive(pid) }); };
  const read = (owner, capacity, first = false) => {
    assert(!pending && !held && capacity > 0 && capacity <= settings.readBytes);
    assert(owner === 'candidate' ? !cancelled && !source : Boolean(source));
    const id = ++readId, buffer = Buffer.alloc(capacity);
    observe('submit', id); pending = owner; mark('read-submit', { id, owner, capacity });
    const operation = new Promise((resolve, reject) => fs.read(fd, buffer, 0, capacity, null, (error, count = 0) => {
      pending = null;
      const bytes = Buffer.from(buffer.subarray(0, count));
      const answer = { id, owner, bytes, count, error: error?.code ?? null };
      fs.appendFileSync(path.join(dir, 'callbacks.bin'), bytes);
      mark('read-callback', { id, owner, count, error: answer.error, hash: hash(bytes) });
      try {
        observe('callback', id);
        if (first && scenario === 'cancel-callback-held' && !error && count > 0) {
          held = { kind: 'candidate', id, owner, bytes: count };
          mark('candidate-held', held); cancel();
        }
        if (scenario === 'receipt-held-control' && !release && receivedBytes === payload.length) {
          assert(isAgain(answer.error) && count === 0, 'Held receipt control requires a real empty nonblocking callback');
          assert(!optional(dir, 'writer-receipt.json') && alive(pid));
          held = { kind: 'receipt', id, owner, bytes: 0 }; mark('receipt-held', held);
          heldResolve = () => resolve(answer);
        } else resolve(answer);
      } catch (error) { reject(error); }
    }));
    if (first && scenario === 'cancel-request-pending') cancel();
    return operation;
  };
  const close = async () => {
    assert(!pending && !held, 'Cannot close an owned read or held result');
    if (fd === undefined || closed) return;
    observe('before-close'); mark('fd-close-request', { pending, held });
    await new Promise(resolve => fs.close(fd, error => {
      closed = true; closeError = error?.code ?? null;
      try { fs.fstatSync(fd); closeProbe = 'still-open'; } catch (probe) { closeProbe = probe.code; }
      mark('fd-close-complete', { error: closeError, probe: closeProbe }); resolve();
    }));
  };
  // This coordinator never awaits a read or its logical delivery.
  const control = async () => {
    mark('control-start');
    try {
      while (!controlStop && !gate) {
        if (held?.kind === 'receipt' && !release) {
          const value = { token, ns: now() }; mark('receipt-release-start', { value }); save(dir, 'receipt-release.json', value);
          release = true; mark('receipt-release-published', { value });
        }
        const receipt = optional(dir, 'writer-receipt.json');
        const writer = optional(dir, 'writer-state.json') ?? [];
        if (receipt && writer.some(e => e.phase === 'receipt-published') && receivedBytes + auditBytes === payload.length) {
          assert(validReceipt(receipt, token, pid)); verifyWriter(writer, token, pid, receipt);
          assert(Buffer.concat([...raw, ...audit]).equals(payload));
          mark('receipt-observed', { receipt, receivedBytes, auditBytes, pending, held });
          const value = { token, ns: now() }; mark('gate-publish-start', { value }); save(dir, 'exit-gate.json', value);
          gate = true; mark('gate-published', { value, pending, held });
          if (held?.kind === 'receipt') {
            mark('receipt-held-release', { id: held.id }); held = null; heldResolve(); heldResolve = undefined;
          }
        }
        if (!gate) await bounded(sleep(settings.idleMs));
      }
    } catch (error) { mark('control-error', { error: String(error) }); rejectFailure(error); }
    finally { mark('control-stopped', { gate }); }
  };
  process.on('beforeExit', code => save(dir, 'natural-exit.json', { code, resources: process.getActiveResourcesInfo() }));
  process.on('exit', code => save(dir, 'process-exit.json', { code, resources: process.getActiveResourcesInfo() }));
  try {
    const native = require('node-pty/lib/utils').loadNativeModule('pty');
    const helper = path.resolve(path.dirname(require.resolve('node-pty/lib/unixTerminal')), native.dir, 'spawn-helper');
    const env = { ...process.env, TERM: 'xterm-256color', LANG: 'C.UTF-8', HISTFILE: '/dev/null' };
    ({ fd, pid } = native.module.fork(process.execPath, [script, '--fixture', path.join(dir, 'config.json')],
      Object.entries(env).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${v}`), dir, settings.cols, settings.rows,
      -1, -1, true, helper, (code, signal) => { exit = { code, signal }; mark('native-exit', exit); resolveExit(); }));
    save(dir, 'native-owner.json', { pid, token }); mark('spawn', { fd, pid }); initial = observe('initial');
    controlJob = control();
    while (!(optional(dir, 'writer-state.json') ?? []).some(e => e.phase === 'enter')) await bounded(sleep(settings.idleMs));
    mark('write-enter-observed', { fixtureAlive: alive(pid) });
    while (true) {
      const report = observe('readiness'); assert(!(report.revents & report.invalidMask), 'Readiness cannot be hangup or error');
      assert(alive(pid) && !exit);
      if (report.revents & report.readableMask) { mark('ready', { report, fixtureAlive: true }); break; }
      await bounded(sleep(settings.idleMs));
    }
    const first = await bounded(read('candidate', settings.firstReadBytes, true));
    if (held?.kind === 'candidate') {
      const until = BigInt(events.find(e => e.event === 'candidate-held').ns) + BigInt(settings.callbackHoldMs) * 1000000n;
      while (process.hrtime.bigint() < until) await bounded(sleep(settings.idleMs));
      mark('candidate-held-release', { id: held.id }); held = null;
    }
    deliver('candidate', first);
    assert(!first.error && first.count > 0 && first.count <= settings.firstReadBytes, 'First read did not establish owned successful bytes');
    if (cancelCase) { finish('interrupted:diagnostic-cancel'); mark('audit-start', { pending, held, source }); }
    const owner = cancelCase ? 'audit' : 'candidate';
    while (true) {
      const answer = await bounded(read(owner, settings.readBytes)); deliver(owner, answer);
      assert(receivedBytes + auditBytes <= payload.length);
      if (isAgain(answer.error) || answer.error === 'EINTR') { await bounded(sleep(settings.idleMs)); continue; }
      if (answer.error || answer.count === 0) {
        const reason = answer.error === 'EIO' ? 'read-eio' : answer.error ? `read-error:${answer.error}` : 'read-eof';
        if (owner === 'audit') { auditSource = reason; mark('audit-source', { reason, id: answer.id }); } else finish(reason, answer.id);
        assert(gate && ['read-eof', 'read-eio'].includes(reason), 'Only real EOF after the validated gate can complete'); break;
      }
    }
    await bounded(close()); await bounded(exited); await bounded(Promise.all(jobs));
    mark('consumer-barrier', { accepted, completed });
  } catch (error) { errorDetail = error.stack ?? String(error); mark('driver-error', { error: errorDetail }); process.exitCode = 1; }
  finally {
    clearTimeout(timer); controlStop = true;
    if (controlJob) await controlJob;
    const guard = setTimeout(() => { save(dir, 'resource-timeout.json', { pending, held, closed, resources: process.getActiveResourcesInfo() }); process.exit(3); }, settings.resourceGuardMs);
    guard.unref();
    if (!pending && !held) {
      if (!source) finish('interrupted:diagnostic-failure');
      try { await close(); } catch (error) { errorDetail = [errorDetail, String(error)].filter(Boolean).join('\n'); }
      await Promise.all(jobs);
    }
  }
  const rendered = snapshot(terminal); terminal.dispose(); mark('terminal-dispose', { accepted, completed });
  const contentExact = Buffer.concat([...raw, ...audit]).equals(payload);
  const renderedExact = same(rendered, await render(payload.subarray(0, receivedBytes).toString('utf8')));
  save(dir, 'summary.json', { scenario, run: config.run, token, pid, initial, exit: exit ?? null, source: source ?? null,
    auditSource: auditSource ?? null, error: errorDetail ?? null, timedOut, cancelled, pending, held, closed, closeError: closeError ?? null,
    closeProbe: closeProbe ?? null, decoderEnded, gate, release, accepted, completed, receivedBytes, auditBytes, rendered, contentExact, renderedExact, events,
    receipt: optional(dir, 'writer-receipt.json'), owner: optional(dir, 'fixture-owner.json'), fixtureError: optional(dir, 'fixture-error.json'),
    writer: readEvents(dir, 'writer-events.ndjson') });
}

function validateObservation(report, initial) {
  assert(Number.isInteger(report.nonblockMask) && report.nonblockMask > 0 && (report.nonblockMask & (report.nonblockMask - 1)) === 0);
  assert(Number.isInteger(report.before) && report.before >= 0 && Boolean(report.before & report.nonblockMask));
  assert.equal(report.after, report.before); assert.equal(report.before, initial.before);
  assert.equal(report.nonblockMask, initial.nonblockMask); assert.equal(report.tty, true); assert.deepEqual(report.identity, initial.identity);
  for (const key of ['dev', 'ino', 'rdev']) assert.match(report.identity[key], /^\d+$/);
  assert(Number.isInteger(report.readableMask) && report.readableMask > 0);
  assert(Number.isInteger(report.invalidMask) && report.invalidMask > 0);
  assert.equal(report.readableMask, initial.readableMask); assert.equal(report.invalidMask, initial.invalidMask);
  assert(Number.isInteger(report.revents) && report.revents >= 0 && [0, 1].includes(report.ready));
  assert.equal(report.ready, report.revents ? 1 : 0);
}

function verifyWriter(writer, token, pid, receipt) {
  let call = 0, written = 0, pending = false, previous = 0n;
  for (const event of writer) {
    assert.equal(event.token, token); assert.equal(event.pid, pid); assert(BigInt(event.ns) >= previous); previous = BigInt(event.ns);
    if (event.phase === 'enter') {
      assert(!pending); assert.equal(event.call, ++call); assert.equal(event.written, written); assert.equal(event.requested, payload.length - written); pending = true;
    } else if (event.phase === 'returned' || event.phase === 'error') {
      assert(pending); assert.equal(event.call, call); pending = false;
      if (event.phase === 'returned') { assert(Number.isInteger(event.count) && event.count > 0 && written + event.count <= payload.length); written += event.count; }
      assert.equal(event.written, written);
    } else assert(['receipt-wait', 'receipt-release-observed', 'receipt-publish-start', 'receipt-published', 'gate-observed'].includes(event.phase));
  }
  if (receipt?.complete) { assert(!pending); assert.equal(written, payload.length); }
}

function assess(r) {
  const failures = [], need = (ok, label) => { if (!ok) failures.push(label); };
  const e = r.events ?? [], all = name => e.filter(x => x.event === name), at = name => e.findIndex(x => x.event === name);
  const cancelCase = r.scenario.startsWith('cancel-');
  const reads = all('read-submit'), callbacks = all('read-callback'), first = callbacks[0], delivered = all('deliver');
  need(!r.error && !r.timedOut && !r.fixtureError, 'sample-error-or-deadline');
  need(r.contentExact && r.renderedExact, 'payload-and-final-terminal-state');
  need(r.driver?.code === 0 && r.driver?.signal === null && !r.driver?.hardTimeout && r.driver?.stdioClosed === true && r.natural?.code === 0, 'natural-driver-exit');
  need(r.cleanup?.remaining?.length === 0 && r.cleanup?.errors?.length === 0 && !r.cleanup?.signalled, 'no-cleanup-needed');
  need(r.owner?.pid === r.pid && r.owner?.token === r.token && r.owner?.stdinTTY && r.owner?.stdoutTTY, 'fixture-identity');
  need(r.exit?.code === 0 && r.exit?.signal === 0 && all('native-exit').length === 1 &&
    all('native-exit')[0].code === r.exit.code && all('native-exit')[0].signal === r.exit.signal && at('native-exit') > at('gate-published'), 'native-exit-after-gate');
  need(r.closed && r.closeError === null && r.closeProbe === 'EBADF' && r.pending === null && r.held === null &&
    all('fd-close-request').length === 1 && all('fd-close-complete').length === 1 &&
    all('fd-close-request')[0].pending === null && all('fd-close-request')[0].held === null &&
    all('fd-close-complete')[0].error === r.closeError && all('fd-close-complete')[0].probe === r.closeProbe &&
    at('fd-close-request') < at('fd-close-complete'), 'fd-release');
  let observations = true;
  try {
    assert(r.initial); assert.deepEqual(all('observe')[0]?.report, r.initial);
    for (const item of all('observe')) validateObservation(item.report, r.initial);
    for (const [event, stage] of [['read-submit', 'submit'], ['read-callback', 'callback']]) {
      for (const item of all(event)) {
        const probe = all('observe').filter(x => x.stage === stage && x.id === item.id); assert.equal(probe.length, 1);
        assert.equal(e.indexOf(probe[0]), e.indexOf(item) + (stage === 'submit' ? -1 : 1));
      }
    }
    assert.equal(all('observe').filter(x => x.stage === 'before-close').length, 1);
    const ready = all('ready'); assert.equal(ready.length, 1);
    assert.deepEqual(ready[0].report, e[e.indexOf(ready[0]) - 1]?.report);
    assert.equal(e[e.indexOf(ready[0]) - 1]?.stage, 'readiness');
    assert(ready[0].fixtureAlive && (ready[0].report.revents & ready[0].report.readableMask) && !(ready[0].report.revents & ready[0].report.invalidMask));
    assert(at('write-enter-observed') < at('ready') && at('ready') < at('read-submit'));
  } catch { observations = false; }
  need(observations, 'unchanged-nonblocking-observation-chain');
  need(reads.length > 1 && reads.every(x => Number.isInteger(x.capacity) && x.capacity > 0 && x.capacity <= settings.readBytes) &&
    reads[0]?.owner === 'candidate' && reads[0]?.capacity === settings.firstReadBytes && !first?.error && first?.count > 0 && first?.count <= settings.firstReadBytes,
  'positive-read-and-owned-first-bytes');
  for (const owner of ['candidate', 'audit']) {
    const ids = callbacks.filter(x => x.owner === owner && x.count > 0).map(x => x.id);
    need(same(ids, delivered.filter(x => x.owner === owner).map(x => x.id)) && new Set(ids).size === ids.length, `${owner}-owned-bytes-delivered-once`);
  }
  const sources = all('candidate-source');
  need(r.decoderEnded && sources.length === 1 && sources[0].reason === r.source && at('decoder-end') >= 0 && at('decoder-end') < at('candidate-source'), 'candidate-settlement');
  const eof = (owner, label) => {
    const source = all(label), last = callbacks.filter(x => x.owner === owner).at(-1);
    return source.length === 1 && last && source[0].id === last.id && last.count === 0 &&
      ((source[0].reason === 'read-eof' && last.error === null) || (source[0].reason === 'read-eio' && last.error === 'EIO')) &&
      e.indexOf(source[0]) > e.indexOf(last) && e.indexOf(last) > at('gate-published');
  };
  if (cancelCase) {
    need(r.cancelled && all('cancel').length === 1 && r.source === 'interrupted:diagnostic-cancel' &&
      r.receivedBytes === first?.count && r.auditBytes === payload.length - first?.count && reads.filter(x => x.owner === 'candidate').length === 1,
    'cancel-partition-and-no-new-candidate-read');
    const auditStart = all('audit-start')[0];
    need(all('audit-start').length === 1 && auditStart.pending === null && auditStart.held === null &&
      at('audit-start') > at('candidate-source') && at('audit-start') < e.indexOf(reads.find(x => x.owner === 'audit')), 'audit-ownership-transfer');
    need(eof('audit', 'audit-source') && all('audit-source')[0]?.reason === r.auditSource, 'audit-real-eof');
    if (r.scenario === 'cancel-request-pending') need(at('read-submit') < at('cancel') && at('cancel') < at('read-callback') &&
      all('cancel')[0]?.pending === 'candidate' && all('cancel')[0]?.held === null, 'pending-cancel-before-js-callback');
    else need(at('read-callback') < at('candidate-held') && at('candidate-held') < at('cancel') &&
      at('cancel') < at('candidate-held-release') && at('candidate-held-release') < at('deliver') &&
      Number(BigInt(all('candidate-held-release')[0]?.ns ?? 0) - BigInt(all('candidate-held')[0]?.ns ?? 0)) / 1e6 >= settings.callbackHoldMs,
    'held-owned-callback-order');
  } else need(!r.cancelled && r.receivedBytes === payload.length && r.auditBytes === 0 && all('audit-start').length === 0 &&
    reads.every(x => x.owner === 'candidate') && eof('candidate', 'candidate-source'), 'control-complete-real-eof');
  need(validReceipt(r.receipt, r.token, r.pid) && r.gate && all('receipt-observed').length === 1 &&
    all('gate-published').length === 1 && all('control-start').length === 1 && all('control-stopped').length === 1 &&
    at('receipt-observed') < at('gate-publish-start') && at('gate-publish-start') < at('gate-published') &&
    at('gate-published') < at('control-stopped') && at('control-stopped') < at('terminal-dispose') &&
    all('receipt-observed')[0]?.receivedBytes === r.receivedBytes && all('receipt-observed')[0]?.auditBytes === r.auditBytes &&
    r.receivedBytes + r.auditBytes === payload.length, 'independent-receipt-gate-settlement');
  if (r.scenario === 'receipt-held-control') {
    const names = ['receipt-held', 'receipt-release-start', 'receipt-release-published', 'receipt-observed', 'gate-publish-start', 'gate-published', 'receipt-held-release'];
    need(names.every((x, i) => all(x).length === 1 && (i === 0 || at(names[i - 1]) < at(x))) &&
      all('gate-published')[0]?.held?.kind === 'receipt' && all('receipt-observed')[0]?.held?.kind === 'receipt' &&
      callbacks.some(x => x.id === all('receipt-held')[0]?.id && isAgain(x.error) && x.count === 0 && e.indexOf(x) < at('receipt-held')) &&
      delivered.filter(x => e.indexOf(x) < at('receipt-held')).reduce((total, x) => total + x.bytes, 0) === payload.length && r.release,
    'gate-advances-while-read-loop-held');
  } else need(!r.release && all('receipt-held').length === 0, 'ordinary-receipt-not-artificially-held');
  const sequences = Array.from({ length: r.accepted ?? 0 }, (_, i) => i + 1);
  need(r.accepted > 0 && r.accepted === r.completed && ['consumer-enqueue', 'parser-applied', 'consumer-complete'].every(x =>
    same(all(x).map(x => x.sequence), sequences)) && sequences.every(sequence => {
      const index = name => e.findIndex(x => x.event === name && x.sequence === sequence);
      return index('consumer-enqueue') < index('parser-applied') && index('parser-applied') < index('consumer-complete') && index('consumer-complete') < at('consumer-barrier');
    }) && at('consumer-barrier') > at('fd-close-complete') && at('terminal-dispose') > at('consumer-barrier'), 'consumer-application-retirement');
  return { pass: failures.length === 0, failures, classification: scope };
}

async function verifyBytes(r, dir) {
  const raw = fs.readFileSync(path.join(dir, 'received.bin')), audit = fs.readFileSync(path.join(dir, 'audit.bin'));
  const callbacks = fs.readFileSync(path.join(dir, 'callbacks.bin'));
  assert.equal(raw.length, r.receivedBytes); assert.equal(audit.length, r.auditBytes);
  const offsets = { candidate: 0, audit: 0 }; let offset = 0, pending = null, id = 0, previous = 0n;
  for (const event of r.events) {
    assert(BigInt(event.ns) >= previous); previous = BigInt(event.ns);
    if (event.event === 'read-submit') { assert.equal(pending, null); assert.equal(event.id, ++id); pending = event; }
    if (event.event === 'read-callback') {
      assert(pending && event.id === pending.id && event.owner === pending.owner && Number.isInteger(event.count) && event.count >= 0 && event.count <= pending.capacity);
      const bytes = callbacks.subarray(offset, offset + event.count); assert.equal(bytes.length, event.count); assert.equal(hash(bytes), event.hash);
      offset += event.count; pending = null;
    }
    if (event.event === 'deliver') {
      const callback = r.events.find(x => x.event === 'read-callback' && x.id === event.id);
      assert(callback && callback.owner === event.owner && callback.count === event.bytes && callback.hash === event.hash && r.events.indexOf(callback) < r.events.indexOf(event));
      const data = event.owner === 'candidate' ? raw : audit, start = offsets[event.owner];
      assert.equal(hash(data.subarray(start, start + event.bytes)), event.hash); offsets[event.owner] += event.bytes;
    }
  }
  assert.equal(offset, callbacks.length); assert.equal(offsets.candidate, raw.length); assert.equal(offsets.audit, audit.length);
  assert.equal(pending?.owner ?? null, r.pending);
  const enqueued = r.events.filter(x => x.event === 'consumer-enqueue');
  let consumed = 0; const applied = [];
  for (const item of enqueued) {
    const bytes = raw.subarray(consumed, consumed + item.bytes); assert.equal(hash(bytes), item.hash); consumed += item.bytes;
    if (r.events.some(x => x.event === 'parser-applied' && x.sequence === item.sequence)) applied.push(bytes);
  }
  assert.equal(consumed, raw.length);
  assert.deepEqual(r.rendered, await render(Buffer.concat(applied).toString('utf8')));
  assert.equal(r.contentExact, Buffer.concat([raw, audit]).equals(payload));
  assert.equal(r.renderedExact, same(r.rendered, await render(payload.subarray(0, raw.length).toString('utf8'))));
}

async function verifySaved(dir, quiet = false) {
  assert.deepEqual(readJSON(path.join(dir, 'schedule.json')), { settings, entries: schedule });
  const env = readJSON(path.join(dir, 'environment.json')), compilation = readJSON(path.join(dir, 'compilation.json'));
  assert.equal(env.scope, scope); assert.deepEqual(env.settings, settings); assert(['linux', 'darwin'].includes(env.platform));
  assert.equal(env.nodePty, '1.2.0-beta.12'); assert(env.versions?.node && env.versions?.uv);
  assert.equal(env.sources.length, env.platform === 'darwin' ? 5 : 4);
  assert.equal(path.basename(env.sources[0].file), 'diagnose-unix-inplace-cancel.mjs');
  for (const source of [...env.sources, ...compilation.headerFiles]) assert.equal(hash(fs.readFileSync(path.join(dir, source.snapshot))), source.hash);
  assert.equal(compilation.code, 0); assert(!compilation.error);
  assert.equal(compilation.compiler, env.platform === 'darwin' ? 'clang' : 'gcc');
  assert.equal(compilation.source, 'compiled/unix-pty-observer.c'); assert.equal(compilation.binary, 'compiled/unix-pty-observer.node');
  assert.equal(hash(fs.readFileSync(path.join(dir, compilation.source))), compilation.sourceHash);
  assert.equal(hash(fs.readFileSync(path.join(dir, compilation.binary))), compilation.binaryHash);
  const results = readJSON(path.join(dir, 'summary.json')); assert.equal(results.length, schedule.length);
  const failures = [], evidenceErrors = [];
  for (const [i, entry] of schedule.entries()) {
    const r = results[i], sampleDir = path.join(dir, name(entry));
    try {
      assert.equal(name(r), name(entry));
      const config = readJSON(path.join(sampleDir, 'config.json')); assert.equal(config.token, r.token); assert.equal(name(config), name(entry));
      const { driver, cleanup, natural, assessment, ...captured } = r;
      assert.deepEqual(captured, capture({ ...config, dir: sampleDir }));
      for (const [key, file] of [['driver', 'driver-exit.json'], ['cleanup', 'cleanup.json'], ['natural', 'natural-exit.json'],
        ['receipt', 'writer-receipt.json'], ['owner', 'fixture-owner.json'], ['fixtureError', 'fixture-error.json']]) assert.deepEqual(r[key], optional(sampleDir, file));
      assert.deepEqual(r.events, readEvents(sampleDir, 'events.ndjson')); assert.deepEqual(r.writer, readEvents(sampleDir, 'writer-events.ndjson'));
      if (r.owner) assert.equal(r.owner.configPath, path.join(config.dir, 'config.json'));
      const native = optional(sampleDir, 'native-owner.json'); if (native) assert.deepEqual(native, { pid: r.pid, token: r.token });
      for (const [event, file] of [['gate-published', 'exit-gate.json'], ['receipt-release-published', 'receipt-release.json']]) {
        const records = r.events.filter(x => x.event === event), artifact = optional(sampleDir, file);
        if (records.length) { assert.equal(records.length, 1); assert.deepEqual(artifact, records[0].value); assert.equal(artifact.token, r.token); }
        else assert(!artifact || !r.assessment.pass);
      }
      verifyWriter(r.writer, r.token, r.pid, r.receipt);
      const writerState = optional(sampleDir, 'writer-state.json');
      if (r.assessment.pass) assert.deepEqual(writerState, r.writer);
      assert.deepEqual(r.assessment, assess(r));
      if (!r.missingSummary) await verifyBytes(r, sampleDir);
      if (r.assessment.pass) {
        const gate = r.events.find(x => x.event === 'gate-published').value;
        assert.deepEqual(r.writer.find(x => x.phase === 'gate-observed')?.gate, gate);
        assert.deepEqual(r.events.find(x => x.event === 'receipt-observed')?.receipt, r.receipt);
        if (r.scenario === 'receipt-held-control') assert.deepEqual(r.writer.find(x => x.phase === 'receipt-release-observed')?.release, optional(sampleDir, 'receipt-release.json'));
      } else failures.push(name(entry));
    } catch (error) { evidenceErrors.push({ sample: name(entry), error: error.message }); }
  }
  const report = { attempted: schedule.length, verified: schedule.length - evidenceErrors.length, failures, evidenceErrors, note: 'Offline verification, not new native execution.' };
  if (!quiet) { console.log(JSON.stringify(report)); if (failures.length || evidenceErrors.length) process.exitCode = 1; }
  return report;
}

function capture(config) {
  const saved = optional(config.dir, 'summary.json'); if (saved) return saved;
  const native = optional(config.dir, 'native-owner.json');
  return { scenario: config.scenario, run: config.run, token: config.token, pid: native?.pid ?? null,
    missingSummary: true, error: 'Driver wrote no summary', events: readEvents(config.dir, 'events.ndjson'), writer: readEvents(config.dir, 'writer-events.ndjson'),
    receipt: optional(config.dir, 'writer-receipt.json'), owner: optional(config.dir, 'fixture-owner.json'), fixtureError: optional(config.dir, 'fixture-error.json') };
}

async function watch(config, mode = '--sample', hardMs = settings.hardMs) {
  const child = spawn(process.execPath, [script, mode, path.join(config.dir, 'config.json')], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const logs = { stdout: '', stderr: '' }; child.stdout.on('data', b => { logs.stdout += b; }); child.stderr.on('data', b => { logs.stderr += b; });
  let hardTimeout = false, closeTimer, groupKill, watchdogCleanup;
  const kill = () => { try { process.kill(-child.pid, 'SIGKILL'); groupKill = { pid: child.pid, signalled: true }; } catch (e) { groupKill = { error: e.code }; } };
  const timer = setTimeout(() => { hardTimeout = true; watchdogCleanup = cleanupFixture(config); kill(); }, hardMs);
  const outcome = await new Promise(resolve => {
    child.once('error', error => resolve({ error: String(error), stdioClosed: false }));
    child.once('close', (code, signal) => { clearTimeout(closeTimer); resolve({ code, signal, stdioClosed: true }); });
    child.once('exit', (code, signal) => { closeTimer = setTimeout(() => { kill(); child.stdout.destroy(); child.stderr.destroy(); resolve({ code, signal, stdioClosed: false }); }, settings.resourceGuardMs); });
  });
  clearTimeout(timer); clearTimeout(closeTimer);
  return { ...outcome, pid: child.pid, detached: true, hardTimeout, groupKill, watchdogCleanup: watchdogCleanup ? await watchdogCleanup : undefined, logs };
}
async function cleanupFixture(config) {
  const registered = optional(config.dir, 'fixture-owner.json'), native = optional(config.dir, 'native-owner.json'), owner = registered ?? native;
  const result = { token: config.token, pid: owner?.pid ?? null, signalled: false, remaining: [], errors: [] };
  if (!owner) return result;
  const configPath = path.join(config.dir, 'config.json');
  if (owner.token !== config.token || !Number.isSafeInteger(owner.pid) || owner.pid <= 1 || owner.pid === process.pid ||
    (registered && registered.configPath !== configPath)) { result.errors.push('owner-identity-mismatch'); return result; }
  if (runnable(owner.pid)) {
    try {
      const row = execFileSync('ps', ['-ww', '-p', String(owner.pid), '-o', 'pgid=', '-o', 'args='], { encoding: 'utf8', timeout: 500 }).trim();
      if (Number(row.match(/^\s*(\d+)/)?.[1]) !== owner.pid || !row.includes(script) || !row.includes(configPath)) result.errors.push('live-process-scope-mismatch');
      else { process.kill(-owner.pid, 'SIGKILL'); result.signalled = true; }
    } catch (error) { if (runnable(owner.pid)) result.errors.push(String(error)); }
  }
  const until = performance.now() + settings.resourceGuardMs;
  while (runnable(owner.pid) && performance.now() < until) await sleep(10);
  if (runnable(owner.pid)) result.remaining.push(owner.pid);
  return result;
}

async function selfTest() {
  const dir = process.env.DSC_INPLACE_SELFTEST_EVIDENCE ? path.resolve(process.env.DSC_INPLACE_SELFTEST_EVIDENCE) : fs.mkdtempSync(path.join(os.tmpdir(), 'dsc-inplace-selftest-'));
  if (process.env.DSC_INPLACE_SELFTEST_EVIDENCE) { assert(!fs.existsSync(dir)); fs.mkdirSync(dir, { recursive: true }); }
  const observer = require(compile(dir));
  const file = path.join(dir, 'ordinary-file'); fs.writeFileSync(file, 'test');
  const fd = fs.openSync(file, 'r');
  const before = observer.observe(fd), after = observer.observe(fd); assert.deepEqual(before, after); assert.equal(before.tty, false);
  fs.closeSync(fd); assert.throws(() => observer.observe(fd)); assert.throws(() => observer.observe(-1)); assert.throws(() => observer.observe(1.5));
  const good = { before: 2050, after: 2050, nonblockMask: 2048, tty: true, identity: { dev: '1', ino: '2', rdev: '3' }, readableMask: 1, invalidMask: 56, revents: 1, ready: 1 };
  validateObservation(good, good); const negatives = [];
  for (const [label, mutate] of [
    ['flags-cleared', r => { r.before = 2; r.after = 2; }], ['observer-mutates-flags', r => { r.after = 2; }],
    ['other-flags-changed', r => { r.before++; r.after++; }], ['identity-changed', r => { r.identity.ino = '9'; }],
    ['false-readiness', r => { r.ready = 0; }],
  ]) { const r = structuredClone(good); mutate(r); assert.throws(() => validateObservation(r, good)); negatives.push({ label, rejected: true }); }
  save(dir, 'observer-negatives.json', negatives);
  assert.equal(schedule.length, 12); assert.equal(new Set(schedule.map(name)).size, 12);
  for (const scenario of scenarios) {
    const result = await synthetic(scenario, good);
    assert.equal(assess(result).pass, true, JSON.stringify(assess(result)));
  }
  const baseline = await synthetic('receipt-held-control', good), ownership = await synthetic('cancel-request-pending', good);
  for (const [label, input, mutate] of [
    ['fake-eof-from-eagain', baseline, r => { r.events.findLast(e => e.event === 'read-callback').error = 'EAGAIN'; }],
    ['missing-observation', baseline, r => { r.events.splice(r.events.findIndex(e => e.event === 'observe' && e.stage === 'submit'), 1); }],
    ['changed-flags', baseline, r => { r.events.find(e => e.event === 'observe').report.after = 2; }],
    ['gate-after-read-loop-release', baseline, r => {
      const index = r.events.findIndex(e => e.event === 'receipt-held-release'); const [event] = r.events.splice(index, 1);
      r.events.splice(r.events.findIndex(e => e.event === 'gate-published'), 0, event);
    }],
    ['cancel-upgraded-to-eof', ownership, r => { r.source = 'read-eof'; }],
    ['missing-owned-delivery', ownership, r => { r.events.splice(r.events.findIndex(e => e.event === 'deliver'), 1); }],
    ['early-audit', ownership, r => { r.events.find(e => e.event === 'audit-start').pending = 'candidate'; }],
    ['missing-receipt', baseline, r => { r.receipt = null; }],
  ]) {
    const result = structuredClone(input); mutate(result); const assessment = assess(result);
    assert.equal(assessment.pass, false, label); negatives.push({ label, rejected: true, assessment });
  }
  save(dir, 'contract-negatives.json', negatives);
  await verifierSelfTest(dir, good);
  const sampleDir = path.join(dir, 'watchdog'); fs.mkdirSync(sampleDir);
  const config = { dir: sampleDir, token: randomUUID() }; save(sampleDir, 'config.json', config);
  const result = await watch(config, '--watchdog-block', 1000); save(sampleDir, 'driver-exit.json', result);
  assert(result.hardTimeout && result.signal === 'SIGKILL' && result.groupKill.signalled);
  console.log(JSON.stringify({ selfTest: 'passed', evidence: dir, ptyLaunched: false, scope: 'Synthetic ownership/gate/EOF and artifact verification, regular-file observation, and non-PTY driver watchdog only.' }));
}

async function synthetic(scenario, initial) {
  const token = 'synthetic-not-native', pid = 456, cancelCase = scenario.startsWith('cancel-');
  const r = { scenario, run: 1, token, pid, initial: structuredClone(initial), exit: { code: 0, signal: 0 }, error: null,
    timedOut: false, cancelled: cancelCase, pending: null, held: null, closed: true, closeError: null, closeProbe: 'EBADF', decoderEnded: true,
    gate: true, release: scenario === 'receipt-held-control', receivedBytes: cancelCase ? 17 : payload.length, auditBytes: cancelCase ? payload.length - 17 : 0,
    contentExact: true, renderedExact: true,
    owner: { token, pid, stdinTTY: true, stdoutTTY: true }, fixtureError: null,
    receipt: { token, pid, written: payload.length, hash: hash(payload), complete: true, stdoutTTY: true, ns: '1' },
    source: cancelCase ? 'interrupted:diagnostic-cancel' : 'read-eof', auditSource: cancelCase ? 'read-eof' : null,
    driver: { code: 0, signal: null, hardTimeout: false, stdioClosed: true, detached: true },
    cleanup: { signalled: false, remaining: [], errors: [] }, natural: { code: 0 }, events: [], writer: [] };
  const e = r.events, mark = (event, detail = {}) => e.push({ ns: String((e.length + 1) * 100000000), event, ...detail });
  const observation = (stage, id = null) => mark('observe', { stage, id, report: structuredClone(initial) });
  let sequences = 0;
  const submit = (owner, id, capacity) => { observation('submit', id); mark('read-submit', { owner, id, capacity }); };
  const callback = (owner, id, bytes, error = null) => { mark('read-callback', { owner, id, count: bytes.length, error, hash: hash(bytes) }); observation('callback', id); };
  const deliver = (owner, id, bytes) => {
    mark('deliver', { owner, id, bytes: bytes.length, hash: hash(bytes) });
    if (owner === 'candidate') { const sequence = ++sequences; mark('consumer-enqueue', { sequence, bytes: bytes.length, hash: hash(bytes) }); mark('parser-applied', { sequence }); mark('consumer-complete', { sequence }); }
  };
  const finish = (reason, id = null) => { mark('decoder-end', { bytes: 0, hash: hash('') }); mark('candidate-source', { reason, id }); };
  mark('spawn', { fd: 13, pid }); observation('initial'); mark('control-start'); mark('write-enter-observed', { fixtureAlive: true });
  observation('readiness'); mark('ready', { report: initial, fixtureAlive: true });
  submit('candidate', 1, 64);
  if (scenario === 'cancel-request-pending') mark('cancel', { pending: 'candidate', held: null, fixtureAlive: true });
  callback('candidate', 1, payload.subarray(0, 17));
  if (scenario === 'cancel-callback-held') {
    mark('candidate-held', { id: 1 }); mark('cancel', { pending: null, held: { kind: 'candidate', id: 1 }, fixtureAlive: true }); mark('candidate-held-release', { id: 1 });
  }
  deliver('candidate', 1, payload.subarray(0, 17));
  if (cancelCase) { finish(r.source); mark('audit-start', { pending: null, held: null, source: r.source }); }
  const owner = cancelCase ? 'audit' : 'candidate';
  submit(owner, 2, settings.readBytes); callback(owner, 2, payload.subarray(17)); deliver(owner, 2, payload.subarray(17));
  let eofId = 3, held = null;
  const release = { token, ns: '2' }, gate = { token, ns: '3' };
  if (r.release) {
    eofId = 4; submit(owner, 3, settings.readBytes); callback(owner, 3, Buffer.alloc(0), 'EAGAIN');
    held = { kind: 'receipt', id: 3, owner, bytes: 0 }; mark('receipt-held', held);
    mark('receipt-release-start', { value: release }); mark('receipt-release-published', { value: release });
  }
  mark('receipt-observed', { receipt: r.receipt, receivedBytes: r.receivedBytes, auditBytes: r.auditBytes, pending: null, held });
  mark('gate-publish-start', { value: gate }); mark('gate-published', { value: gate, pending: null, held });
  if (r.release) mark('receipt-held-release', { id: 3 });
  mark('control-stopped', { gate: true });
  submit(owner, eofId, settings.readBytes); callback(owner, eofId, Buffer.alloc(0));
  if (cancelCase) mark('audit-source', { reason: 'read-eof', id: eofId }); else finish(r.source, eofId);
  observation('before-close'); mark('fd-close-request', { pending: null, held: null }); mark('fd-close-complete', { error: null, probe: 'EBADF' });
  mark('native-exit', r.exit); r.accepted = sequences; r.completed = sequences;
  mark('consumer-barrier', { accepted: sequences, completed: sequences }); mark('terminal-dispose', { accepted: sequences, completed: sequences });
  r.rendered = await render(payload.subarray(0, r.receivedBytes).toString('utf8'));
  const trace = detail => r.writer.push({ ns: String(r.writer.length + 1), token, pid, ...detail });
  trace({ phase: 'enter', call: 1, requested: payload.length, written: 0 }); trace({ phase: 'returned', call: 1, count: payload.length, written: payload.length });
  if (r.release) { trace({ phase: 'receipt-wait' }); trace({ phase: 'receipt-release-observed', release }); }
  trace({ phase: 'receipt-publish-start' }); trace({ phase: 'receipt-published' }); trace({ phase: 'gate-observed', gate });
  return r;
}

async function verifierSelfTest(parent, good) {
  const dir = path.join(parent, 'synthetic-verifier'); fs.mkdirSync(dir);
  fs.cpSync(path.join(parent, 'compiled'), path.join(dir, 'compiled'), { recursive: true });
  fs.copyFileSync(path.join(parent, 'compilation.json'), path.join(dir, 'compilation.json'));
  environment(dir); save(dir, 'scope.json', { synthetic: true, ptyLaunched: false }); save(dir, 'schedule.json', { settings, entries: schedule });
  const results = [];
  for (const entry of schedule) {
    const sampleDir = path.join(dir, name(entry)); fs.mkdirSync(sampleDir);
    const r = await synthetic(entry.scenario, good); r.run = entry.run; r.error = 'Synthetic legitimate failure';
    if (results.length === 0) r.receipt = null;
    r.owner.configPath = path.join(sampleDir, 'config.json'); r.assessment = assess(r);
    save(sampleDir, 'config.json', { ...entry, dir: sampleDir, token: r.token }); save(sampleDir, 'native-owner.json', { pid: r.pid, token: r.token });
    const { driver, cleanup, natural, assessment, ...captured } = r;
    const missingSummary = results.length === 2;
    if (!missingSummary) save(sampleDir, 'summary.json', captured);
    for (const [key, file] of [['driver', 'driver-exit.json'], ['cleanup', 'cleanup.json'], ['natural', 'natural-exit.json'], ['owner', 'fixture-owner.json'],
      ['receipt', 'writer-receipt.json'], ['fixtureError', 'fixture-error.json']]) if (r[key] !== null) save(sampleDir, file, r[key]);
    for (const event of r.events) append(sampleDir, 'events.ndjson', event);
    for (const event of r.writer) append(sampleDir, 'writer-events.ndjson', event);
    save(sampleDir, 'writer-state.json', r.writer);
    save(sampleDir, 'exit-gate.json', r.events.find(e => e.event === 'gate-published').value);
    if (r.release) save(sampleDir, 'receipt-release.json', r.events.find(e => e.event === 'receipt-release-published').value);
    fs.writeFileSync(path.join(sampleDir, 'received.bin'), payload.subarray(0, r.receivedBytes));
    fs.writeFileSync(path.join(sampleDir, 'audit.bin'), payload.subarray(r.receivedBytes));
    fs.writeFileSync(path.join(sampleDir, 'callbacks.bin'), payload);
    if (missingSummary) {
      const fallback = { ...capture({ ...entry, token: r.token, dir: sampleDir }), driver, cleanup, natural };
      fallback.assessment = assess(fallback); results.push(fallback);
    } else results.push(r);
  }
  save(dir, 'summary.json', results);
  const full = await verifySaved(dir, true); save(parent, 'verifier-valid-failures.json', full);
  assert.equal(full.verified, 12); assert.equal(full.failures.length, 12); assert.equal(full.evidenceErrors.length, 0);
  fs.writeFileSync(path.join(dir, name(schedule[1]), 'callbacks.bin'), Buffer.alloc(payload.length, 'X'));
  const corrupt = await verifySaved(dir, true); save(parent, 'verifier-corrupt-raw.json', corrupt);
  assert.equal(corrupt.attempted, 12); assert.equal(corrupt.verified, 11); assert.equal(corrupt.failures.length, 11); assert.equal(corrupt.evidenceErrors.length, 1);
  assert(corrupt.failures.includes(name(schedule.at(-1))));
}

async function render(text) {
  const { Terminal } = require('@xterm/headless'); const terminal = new Terminal({ cols: settings.cols, rows: settings.rows, scrollback: 100000, allowProposedApi: true });
  try { if (text) await new Promise(resolve => terminal.write(text, resolve)); return snapshot(terminal); } finally { terminal.dispose(); }
}
function snapshot(terminal) { const b = terminal.buffer.active; return { text: Array.from({ length: b.length }, (_, i) => b.getLine(i).translateToString(true)).join('\n'), cursorX: b.cursorX, cursorLine: b.baseY + b.cursorY }; }
function validReceipt(r, token, pid) { return Boolean(r?.complete && r.token === token && r.pid === pid && r.written === payload.length && r.hash === hash(payload) && r.stdoutTTY); }
function isAgain(error) { return error === 'EAGAIN' || error === 'EWOULDBLOCK'; }
function now() { return process.hrtime.bigint().toString(); }
function hash(value) { return createHash('sha256').update(value).digest('hex'); }
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function name(entry) { return `${entry.scenario}-${entry.run}`; }
function readJSON(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function optional(dir, file) { const p = path.join(dir, file); return fs.existsSync(p) ? readJSON(p) : null; }
function readEvents(dir, file) { const p = path.join(dir, file); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : []; }
function append(dir, file, value) { fs.appendFileSync(path.join(dir, file), JSON.stringify(value) + '\n'); }
function save(dir, file, value) { const p = path.join(dir, file), temp = `${p}.${process.pid}.tmp`; fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n'); fs.renameSync(temp, p); }
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function alive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
function runnable(pid) { try { return !execFileSync('ps', ['-p', String(pid), '-o', 'stat='], { encoding: 'utf8', timeout: 500 }).trim().startsWith('Z'); } catch { return false; } }
