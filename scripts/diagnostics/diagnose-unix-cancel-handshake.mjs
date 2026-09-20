// Separate frozen experiment; the earlier Unix probes and their failures stay unchanged.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const require = createRequire(import.meta.url);
const script = fileURLToPath(import.meta.url);
const helperSource = path.join(path.dirname(script), 'unix-pty-readiness.c');
const settings = Object.freeze({ runs: 3, payloadBytes: 2048, firstReadBytes: 64, readBytes: 65536,
  idleMs: 2, callbackHoldMs: 100, sampleMs: 10000, hardMs: 15000, resourceGuardMs: 1000,
  cols: 96, rows: 28, scrollback: 100000 });
const cases = ['cancel-request-pending', 'cancel-callback-held', 'read-through-control'];
const schedule = cases.flatMap(scenario => Array.from({ length: settings.runs }, (_, i) => ({ scenario, run: i + 1 })));
const scope = 'Readiness-handshake owned-read cancellation diagnostic; not kernel-pending proof, production policy, or long-term resource acceptance.';
const payload = Buffer.from('C'.repeat(settings.payloadBytes));
const { values } = parseArgs({ options: { output: { type: 'string' }, sample: { type: 'string' },
  fixture: { type: 'string' }, 'self-test': { type: 'boolean' }, 'verify-saved': { type: 'string' },
  'watchdog-block': { type: 'string' }, 'watchdog-fixture': { type: 'string' }, 'watchdog-helper': { type: 'string' } } });

try {
  if (values.fixture) await runFixture(readJSON(values.fixture));
  else if (values['watchdog-fixture']) await watchdogFixture(readJSON(values['watchdog-fixture']));
  else if (values['watchdog-helper']) await watchdogHelper(readJSON(values['watchdog-helper']));
  else if (values['watchdog-block']) await watchdogBlock(readJSON(values['watchdog-block']));
  else if (values['self-test']) await selfTest();
  else if (values['verify-saved']) await verifySaved(path.resolve(values['verify-saved']));
  else if (values.sample) await runSample(readJSON(values.sample));
  else await runSchedule();
} catch (error) {
  if (values.fixture) {
    const config = readJSON(values.fixture);
    save(config.dir, 'fixture-error.json', { token: config.token, pid: process.pid,
      error: error.message, code: error.code, errno: error.errno });
  } else console.error(error.stack ?? error);
  process.exitCode = 1;
}

async function runFixture(config) {
  const { dir, token } = config;
  save(dir, 'fixture-owner.json', { pid: process.pid, token, configPath: path.join(dir, 'config.json'),
    stdinTTY: Boolean(process.stdin.isTTY), stdoutTTY: Boolean(process.stdout.isTTY) });
  let written = 0, call = 0;
  const trace = detail => {
    const entry = { token, pid: process.pid, call, monotonicNs: process.hrtime.bigint().toString(), ...detail };
    fs.appendFileSync(path.join(dir, 'writer-events.ndjson'), JSON.stringify(entry) + '\n');
    save(dir, 'write-progress.json', entry);
  };
  while (written < payload.length) {
    call++;
    trace({ phase: 'enter', requested: payload.length - written, written });
    let count;
    try { count = fs.writeSync(1, payload, written, payload.length - written); }
    catch (error) {
      trace({ phase: 'error', code: error.code, errno: error.errno, message: error.message, written });
      throw error;
    }
    assert(count > 0 && count <= payload.length - written, 'Synchronous write must make valid progress');
    written += count;
    trace({ phase: 'returned', count, written });
  }
  save(dir, 'writer-receipt.json', { pid: process.pid, token, written, hash: hash(payload), complete: true,
    stdoutTTY: Boolean(process.stdout.isTTY), intendedExitCode: 0 });
  while (!fs.existsSync(path.join(dir, 'exit-gate.json'))) await sleep(settings.idleMs);
  assert.equal(readJSON(path.join(dir, 'exit-gate.json')).token, token);
}

function compileHelper(output) {
  const dir = path.join(output, 'readiness-helper');
  fs.mkdirSync(dir);
  const source = path.join(dir, 'unix-pty-readiness.c');
  const binary = path.join(dir, 'unix-pty-readiness');
  fs.copyFileSync(helperSource, source);
  const compiler = process.platform === 'darwin' ? 'clang' : 'gcc';
  const args = ['-std=c99', '-Wall', '-Wextra', '-Werror', source, '-o', binary];
  const record = { compiler, args, source: 'readiness-helper/unix-pty-readiness.c',
    binary: 'readiness-helper/unix-pty-readiness', sourceHash: hash(fs.readFileSync(source)) };
  try {
    record.version = execFileSync(compiler, ['--version'], { encoding: 'utf8', timeout: 10000 });
    record.stdout = execFileSync(compiler, args, { encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'] });
    record.stderr = '';
    record.code = 0;
    record.binaryHash = hash(fs.readFileSync(binary));
  } catch (error) {
    record.code = error.status ?? null;
    record.signal = error.signal ?? null;
    record.error = error.message;
    record.stdout = String(error.stdout ?? '');
    record.stderr = String(error.stderr ?? '');
  }
  save(output, 'helper-compilation.json', record);
  assert(!record.error && record.code === 0, `Readiness helper compilation failed; see ${output}/helper-compilation.json`);
  return binary;
}

function recordEnvironment(output) {
  const native = require('node-pty/lib/utils').loadNativeModule('pty');
  const lib = path.dirname(require.resolve('node-pty/lib/unixTerminal'));
  const sources = [script, require.resolve('node-pty/lib/unixTerminal'), require.resolve('@xterm/headless'),
    path.resolve(lib, native.dir, 'pty.node')];
  if (process.platform === 'darwin') sources.push(path.resolve(lib, native.dir, 'spawn-helper'));
  fs.mkdirSync(path.join(output, 'source-snapshot'));
  const hashes = sources.map((source, index) => {
    const snapshot = `source-snapshot/${index}-${path.basename(source)}`;
    fs.copyFileSync(source, path.join(output, snapshot));
    return { source, snapshot, hash: hash(fs.readFileSync(source)) };
  });
  save(output, 'environment.json', { settings, platform: process.platform, arch: process.arch,
    kernel: os.release(), versions: process.versions, executable: process.execPath,
    nodePty: require('node-pty/package.json').version, hashes, scope,
    github: { sha: process.env.GITHUB_SHA, runId: process.env.GITHUB_RUN_ID,
      attempt: process.env.GITHUB_RUN_ATTEMPT, image: process.env.ImageOS, imageVersion: process.env.ImageVersion } });
}

async function runSchedule() {
  assert(['linux', 'darwin'].includes(process.platform), 'This native experiment requires Linux or macOS');
  assert(values.output, '--output must name a new evidence directory');
  const output = path.resolve(values.output);
  assert(!fs.existsSync(output), 'Refusing to overwrite evidence');
  fs.mkdirSync(output, { recursive: true });
  save(output, 'schedule.json', { settings, entries: schedule });
  const helperBinary = compileHelper(output);
  recordEnvironment(output);
  const results = [];
  for (const entry of schedule) {
    const dir = path.join(output, sampleName(entry));
    fs.mkdirSync(dir);
    const config = { ...entry, dir, token: randomUUID(), helperBinary };
    save(dir, 'config.json', config);
    const driver = await watchDriver(config, ['--sample', path.join(dir, 'config.json')], settings.hardMs);
    save(dir, 'driver-exit.json', driver);
    const cleanup = await cleanupFixture(config);
    save(dir, 'cleanup.json', cleanup);
    const result = readOptional(path.join(dir, 'summary.json')) ?? { ...entry, token: config.token, error: 'Driver wrote no summary' };
    Object.assign(result, { driver, cleanup, naturalExit: readOptional(path.join(dir, 'natural-exit.json')) });
    result.assessment = assess(result);
    results.push(result);
    save(output, 'summary.json', results);
    console.log(JSON.stringify({ ...entry, pass: result.assessment.pass, receivedBytes: result.receivedBytes,
      auditBytes: result.auditBytes, source: result.source, failures: result.assessment.failures }));
  }
  console.log(JSON.stringify({ samples: results.length, failures: results.filter(result => !result.assessment.pass).length, evidence: output }));
  if (results.some(result => !result.assessment.pass)) process.exitCode = 1;
}

async function runSample(config) {
  const { scenario, run, dir } = config;
  assert(cases.includes(scenario));
  const cancellation = scenario !== 'read-through-control';
  const started = performance.now();
  const events = [], received = [], audit = [], callbacks = [], consumerJobs = [], readinessAttempts = [];
  for (const file of ['received.bin', 'audit.bin', 'candidate-callback.bin', 'events.ndjson']) fs.writeFileSync(path.join(dir, file), '');
  const mark = (event, detail = {}) => {
    const entry = { ms: round(performance.now() - started), event, ...detail };
    events.push(entry);
    fs.appendFileSync(path.join(dir, 'events.ndjson'), JSON.stringify(entry) + '\n');
    return entry;
  };
  const { Terminal } = require('@xterm/headless');
  const terminal = new Terminal({ cols: settings.cols, rows: settings.rows, scrollback: settings.scrollback, allowProposedApi: true });
  let title = '';
  terminal.onTitleChange(value => { title = value; });
  const decoder = new StringDecoder('utf8');
  let fd, pid, identity, exit, source, auditSource, errorDetail, helperActive;
  let pendingOwner = null, callbackHeld = false, cancelled = false, timedOut = false, stopping = false;
  let accepted = 0, completed = 0, readCalls = 0, receivedBytes = 0, auditBytes = 0;
  let closed = false, closeError, closeProbe, decoderEnded = false, exitGate = false;
  let rejectDeadline, resourceTimer;
  let resolveExit;
  const exited = new Promise(resolve => { resolveExit = resolve; });
  const deadline = new Promise((_, reject) => { rejectDeadline = reject; });
  // Every asynchronous ownership step shares the same original sample deadline.
  const bounded = promise => Promise.race([promise, deadline]);
  const deadlineTimer = setTimeout(() => {
    timedOut = true; stopping = true;
    mark('sample-deadline', { pendingOwner, callbackHeld, source });
    rejectDeadline(new Error('Sample deadline is interruption, not EOF'));
  }, settings.sampleMs);
  const enqueue = text => {
    if (!text) return;
    const sequence = ++accepted;
    mark('consumer-enqueue', { sequence, bytes: Buffer.byteLength(text), hash: hash(text) });
    consumerJobs.push(new Promise(resolve => terminal.write(text, () => {
      mark('parser-applied', { sequence });
      completed++;
      mark('consumer-complete', { sequence });
      resolve();
    })));
  };
  const finishCandidate = (reason, readId = null) => {
    assert(!source && !pendingOwner && !callbackHeld, 'Candidate completion must settle its owned read first');
    const tail = decoder.end();
    decoderEnded = true;
    mark('decoder-end', { bytes: Buffer.byteLength(tail), hash: hash(tail) });
    enqueue(tail);
    source = reason;
    mark('candidate-source-end', { reason, readId, pendingOwner, callbackHeld, consumerPending: accepted - completed });
  };
  const cancel = () => {
    assert(!cancelled && !source);
    cancelled = true;
    mark('cancel-effective', { pending: pendingOwner === 'candidate', callbackHeld, fixtureAlive: alive(pid),
      writeProgress: readOptional(path.join(dir, 'write-progress.json')), receipt: readOptional(path.join(dir, 'writer-receipt.json')) });
  };
  const read = (owner, capacity, first = false) => {
    assert(!pendingOwner && !callbackHeld && !stopping);
    assert(Number.isInteger(capacity) && capacity > 0 && capacity <= settings.readBytes);
    if (owner === 'candidate') assert(!source && !cancelled);
    else assert(source && !pendingOwner && !callbackHeld);
    const buffer = Buffer.alloc(capacity), id = ++readCalls;
    pendingOwner = owner;
    mark('read-submit', { owner, id, capacity });
    const operation = new Promise(resolve => fs.read(fd, buffer, 0, capacity, null, (error, count) => {
      pendingOwner = null;
      const bytes = Buffer.from(buffer.subarray(0, count ?? 0));
      mark('read-callback', { owner, id, count: count ?? 0, error: error?.code ?? null, hash: hash(bytes), cancelled });
      if (owner === 'candidate' && bytes.length) {
        callbacks.push(bytes);
        fs.appendFileSync(path.join(dir, 'candidate-callback.bin'), bytes);
      }
      if (first && scenario === 'cancel-callback-held' && !error && bytes.length > 0) {
        callbackHeld = true;
        mark('read-result-held', { id, bytes: bytes.length, hash: hash(bytes), durationMs: settings.callbackHoldMs });
        cancel();
      }
      resolve({ error: error?.code ?? null, bytes, count: count ?? 0, id });
    }));
    if (first && scenario === 'cancel-request-pending') cancel();
    return operation;
  };
  const deliver = answer => {
    const bytes = answer.bytes;
    if (!bytes.length) return;
    received.push(bytes); receivedBytes += bytes.length;
    fs.appendFileSync(path.join(dir, 'received.bin'), bytes);
    mark('reader-deliver', { id: answer.id, bytes: bytes.length, hash: hash(bytes), afterCancel: cancelled });
    enqueue(decoder.write(bytes));
  };
  const collectAudit = answer => {
    if (!answer.bytes.length) return;
    audit.push(answer.bytes); auditBytes += answer.bytes.length;
    fs.appendFileSync(path.join(dir, 'audit.bin'), answer.bytes);
    mark('audit-read-data', { id: answer.id, bytes: answer.bytes.length, hash: hash(answer.bytes), fixtureAlive: alive(pid) });
  };
  const openExitGate = () => {
    if (exitGate || receivedBytes + auditBytes !== payload.length) return;
    const receipt = readOptional(path.join(dir, 'writer-receipt.json'));
    if (!receipt) return;
    assert(validReceipt(receipt, config.token, pid), 'Final receipt identity, size, and hash must match');
    verifyWriterTrace({ token: config.token, pid, writerEvents: readEvents(path.join(dir, 'writer-events.ndjson')),
      writeProgress: readOptional(path.join(dir, 'write-progress.json')), receipt });
    assert(Buffer.concat([...received, ...audit]).equals(payload), 'Receipt cannot replace exact byte accounting');
    mark('fixture-exit-gate', { receivedBytes, auditBytes, receipt, fixtureAlive: alive(pid) });
    save(dir, 'exit-gate.json', { token: config.token });
    exitGate = true;
  };
  const close = async () => {
    assert(!pendingOwner && !callbackHeld && !helperActive, 'Cannot close while an owned operation or helper retains the master');
    if (fd === undefined || closed) return;
    mark('fd-close-request', { pendingOwner, callbackHeld, helperActive: false });
    await new Promise(resolve => fs.close(fd, error => {
      closed = true; closeError = error?.code;
      try { fs.fstatSync(fd); closeProbe = 'still-open'; } catch (probeError) { closeProbe = probeError.code; }
      mark('fd-close-complete', { error: closeError, probe: closeProbe, consumerPending: accepted - completed });
      resolve();
    }));
  };
  const probe = async () => {
    const number = readinessAttempts.length + 1;
    const child = spawn(config.helperBinary, [], { stdio: [fd, 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    const attempt = { number, pid: child.pid, identity, code: null, signal: null, stdioClosed: false };
    mark('helper-spawn', { number, pid: child.pid, identity });
    const complete = new Promise(resolve => {
      child.once('error', error => { attempt.spawnError = error.message; });
      child.once('close', (code, signal) => {
        Object.assign(attempt, { code, signal, stdioClosed: true, stdout, stderr });
        try { attempt.report = JSON.parse(stdout); } catch (error) { attempt.parseError = error.message; }
        save(dir, `readiness-${String(number).padStart(3, '0')}.json`, attempt);
        readinessAttempts.push(attempt);
        mark('helper-close', { number, pid: child.pid, code, signal, stdioClosed: true });
        helperActive = undefined;
        resolve(attempt);
      });
    });
    helperActive = { child, complete };
    const result = await bounded(complete);
    const readable = validateReadiness(result, identity);
    mark(readable ? 'helper-ready' : 'helper-not-ready', { number, fixtureAlive: alive(pid), report: result.report });
    assert(alive(pid) && !exit, 'Main process must remain live during the readability handshake');
    return readable;
  };
  process.on('beforeExit', code => save(dir, 'natural-exit.json', { code, resources: process.getActiveResourcesInfo() }));
  process.on('exit', code => save(dir, 'process-exit.json', { code, resources: process.getActiveResourcesInfo() }));
  try {
    const native = require('node-pty/lib/utils').loadNativeModule('pty');
    const helper = path.resolve(path.dirname(require.resolve('node-pty/lib/unixTerminal')), native.dir, 'spawn-helper');
    const env = { ...process.env, TERM: 'xterm-256color', LANG: 'C.UTF-8', HISTFILE: '/dev/null' };
    ({ fd, pid } = native.module.fork(process.execPath, [script, '--fixture', path.join(dir, 'config.json')],
      Object.entries(env).filter(([, value]) => value !== undefined).map(([key, value]) => `${key}=${value}`),
      dir, settings.cols, settings.rows, -1, -1, true, helper, (code, signal) => {
        exit = { code, signal }; mark('native-exit', exit); resolveExit();
      }));
    identity = fdIdentity(fd);
    mark('spawn', { pid, fd, identity });
    save(dir, 'native-owner.json', { pid, token: config.token, identity });
    while (!readEvents(path.join(dir, 'writer-events.ndjson')).some(entry => entry.phase === 'enter')) await bounded(sleep(settings.idleMs));
    mark('write-enter-observed', { progress: readOptional(path.join(dir, 'write-progress.json')), fixtureAlive: alive(pid) });
    while (!await probe()) await bounded(sleep(settings.idleMs));
    mark('candidate-read-premise', { fixtureAlive: alive(pid), pendingOwner, callbackHeld, helperActive: Boolean(helperActive),
      writeProgress: readOptional(path.join(dir, 'write-progress.json')), receipt: readOptional(path.join(dir, 'writer-receipt.json')) });
    const first = await bounded(read('candidate', settings.firstReadBytes, true));
    if (callbackHeld) {
      const heldAt = events.find(entry => entry.event === 'read-result-held').ms;
      while (performance.now() - started - heldAt < settings.callbackHoldMs) await bounded(sleep(settings.idleMs));
      callbackHeld = false;
      mark('held-result-release', { id: first.id, bytes: first.bytes.length });
    }
    deliver(first);
    const premiseFailed = Boolean(first.error) || first.count <= 0 || first.count > settings.firstReadBytes;
    if (premiseFailed) {
      errorDetail = `First readable candidate callback did not establish successful owned bytes: ${first.error ?? first.count}`;
      mark('candidate-premise-failed', { error: first.error, count: first.count });
      process.exitCode = 1;
    }
    if (cancellation || premiseFailed) {
      finishCandidate(cancelled && !premiseFailed ? 'interrupted:diagnostic-cancel' : 'interrupted:failed-premise');
      mark('audit-reader-start', { pendingOwner, callbackHeld, source });
    }
    const owner = source ? 'audit' : 'candidate';
    while (true) {
      openExitGate();
      const answer = await bounded(read(owner, settings.readBytes));
      if (owner === 'audit') collectAudit(answer); else deliver(answer);
      assert(receivedBytes + auditBytes <= payload.length, 'Unexpected extra bytes exceed the frozen writer payload');
      if (answer.error === 'EAGAIN' || answer.error === 'EWOULDBLOCK' || answer.error === 'EINTR') {
        await bounded(sleep(settings.idleMs));
        continue;
      }
      if (answer.error || answer.count === 0) {
        const reason = answer.error === 'EIO' ? 'read-eio' : answer.error ? `read-error:${answer.error}` : 'read-eof';
        if (owner === 'audit') { auditSource = reason; mark('audit-source-end', { reason, readId: answer.id }); }
        else finishCandidate(reason, answer.id);
        assert(exitGate && ['read-eof', 'read-eio'].includes(reason), 'Only real EOF/EIO after the complete receipt gate is accepted');
        break;
      }
    }
    await bounded(close());
    await bounded(exited);
    mark('consumer-barrier-wait', { pending: accepted - completed, fdClosed: closed });
    await bounded(Promise.all(consumerJobs));
    mark('consumer-barrier-complete', { accepted, completed });
  } catch (error) {
    errorDetail = [errorDetail, error.stack ?? String(error)].filter(Boolean).join('\n');
    mark('driver-error', { error: errorDetail });
    process.exitCode = 1;
  } finally {
    stopping = true;
    clearTimeout(deadlineTimer);
    resourceTimer = setTimeout(() => {
      save(dir, 'resource-timeout.json', { resources: process.getActiveResourcesInfo(), pendingOwner,
        callbackHeld, helperPid: helperActive?.child.pid, closed, closeProbe });
      process.exit(3);
    }, settings.resourceGuardMs);
    resourceTimer.unref();
    if (helperActive) {
      mark('helper-abort', { pid: helperActive.child.pid });
      helperActive.child.kill('SIGKILL');
      await helperActive.complete;
    }
    if (!pendingOwner && !callbackHeld) {
      if (!source) finishCandidate('interrupted:diagnostic-failure');
      await close();
      await Promise.all(consumerJobs);
    }
  }
  const actual = snapshot(terminal, title);
  terminal.dispose();
  mark('terminal-dispose', { accepted, completed });
  const raw = Buffer.concat(received), auditRaw = Buffer.concat(audit), callbackRaw = Buffer.concat(callbacks);
  const expected = cancellation ? callbackRaw : payload;
  const expectedRendered = await render(expected.toString('utf8'));
  fs.writeFileSync(path.join(dir, 'rendered.txt'), actual.text);
  const result = { scenario, run, token: config.token, pid, identity, source, auditSource, exit, error: errorDetail,
    timedOut, cancelled, pendingOwner, callbackHeld, decoderEnded, readinessAttempts, events,
    receivedBytes: raw.length, receivedHash: hash(raw), auditBytes: auditRaw.length, auditHash: hash(auditRaw),
    callbackBytes: callbackRaw.length, callbackHash: hash(callbackRaw), exact: raw.equals(expected),
    partitionExact: Buffer.concat([raw, auditRaw]).equals(payload), renderedExact: same(actual, expectedRendered),
    rendered: withoutText(actual), expectedRendered: withoutText(expectedRendered), accepted, completed,
    closed, closeError, closeProbe, readCalls, receipt: readOptional(path.join(dir, 'writer-receipt.json')),
    owner: readOptional(path.join(dir, 'fixture-owner.json')), writerEvents: readEvents(path.join(dir, 'writer-events.ndjson')),
    writeProgress: readOptional(path.join(dir, 'write-progress.json')), fixtureError: readOptional(path.join(dir, 'fixture-error.json')),
    durationMs: round(performance.now() - started) };
  save(dir, 'summary.json', result);
}

function validateReadiness(attempt, identity) {
  assert(!attempt.spawnError && !attempt.parseError && attempt.code === 0 && attempt.signal === null && attempt.stdioClosed === true,
    'Readiness helper must naturally close all stdio before the candidate read');
  assert.equal(attempt.stderr, '');
  const report = attempt.report;
  assert.equal(report?.version, 1);
  assert.equal(report.pid, attempt.pid);
  assert.equal(report.tty, true);
  assert.deepEqual(report.identity, identity);
  assert.deepEqual(attempt.identity, identity);
  assert(!report.failure && report.hup === false && report.error === false && report.invalid === false,
    'Hangup, error, invalid fd, or failed system calls are not readiness');
  assert.equal(typeof report.readable, 'boolean');
  assert(Number.isInteger(report.revents) && report.revents >= 0);
  assert.equal(Boolean(report.revents & 1), report.readable);
  assert.equal(report.revents & (8 | 16 | 32), 0);
  return report.readable;
}

function assess(result) {
  const failures = [];
  const need = (ok, name) => { if (!ok) failures.push(name); };
  const events = result.events ?? [], attempts = result.readinessAttempts ?? [];
  const index = name => events.findIndex(entry => entry.event === name);
  const event = name => events.find(entry => entry.event === name);
  const cancellation = result.scenario !== 'read-through-control';
  const reads = events.filter(entry => entry.event === 'read-submit' && entry.owner === 'candidate');
  const first = events.find(entry => entry.event === 'read-callback' && entry.owner === 'candidate');
  const sources = events.filter(entry => entry.event === 'candidate-source-end');
  need(!result.error && !result.timedOut && !result.fixtureError, 'driver-error-or-deadline');
  need(result.driver?.code === 0 && result.driver?.signal === null && !result.driver?.hardTimeout &&
    result.driver?.stdioClosed === true && result.driver?.detached === true, 'driver-natural-success');
  need(result.naturalExit?.code === 0, 'natural-exit-evidence');
  need(result.cleanup?.remaining?.length === 0 && result.cleanup?.errors?.length === 0, 'fixture-cleanup');
  need(result.exact && result.partitionExact && result.renderedExact, 'content-partition-and-final-state');
  need(validReceipt(result.receipt, result.token, result.pid), 'writer-receipt');
  need(result.owner?.pid === result.pid && result.owner?.token === result.token && result.owner?.stdoutTTY && result.owner?.stdinTTY, 'fixture-identity');
  need(result.exit?.code === 0 && result.exit?.signal === 0, 'main-exit');
  need(result.closed && !result.closeError && result.closeProbe === 'EBADF', 'fd-release');
  need(result.accepted > 0 && result.accepted === result.completed && index('consumer-barrier-complete') > index('fd-close-complete') &&
    index('terminal-dispose') > index('consumer-barrier-complete'), 'consumer-retirement-barrier');
  const expectedSequences = Array.from({ length: result.accepted ?? 0 }, (_, i) => i + 1);
  for (const name of ['consumer-enqueue', 'parser-applied', 'consumer-complete']) need(same(events.filter(entry => entry.event === name)
    .map(entry => entry.sequence).sort((a, b) => a - b), expectedSequences), `${name}-exactly-once`);
  for (const owner of ['candidate', 'audit']) {
    const callbackIds = events.filter(entry => entry.event === 'read-callback' && entry.owner === owner && entry.count > 0).map(entry => entry.id);
    const deliveryIds = events.filter(entry => entry.event === (owner === 'candidate' ? 'reader-deliver' : 'audit-read-data')).map(entry => entry.id);
    need(new Set(callbackIds).size === callbackIds.length && same(callbackIds, deliveryIds), `${owner}-callback-delivery-exactly-once`);
  }
  need(expectedSequences.every(sequence => {
    const at = name => events.findIndex(entry => entry.event === name && entry.sequence === sequence);
    return at('consumer-enqueue') < at('parser-applied') && at('parser-applied') < at('consumer-complete') &&
      at('consumer-complete') < index('consumer-barrier-complete');
  }), 'consumer-application-order');
  need(result.decoderEnded && sources.length === 1 && index('decoder-end') >= 0 && index('decoder-end') < index('candidate-source-end'), 'decoder-and-source-settlement');
  need(sources.length === 1 && sources[0].reason === result.source, 'candidate-source-record-agrees');
  need(event('fd-close-request')?.pendingOwner === null && event('fd-close-request')?.callbackHeld === false &&
    event('fd-close-request')?.helperActive === false && result.pendingOwner === null && result.callbackHeld === false, 'no-close-owned-operation');
  need(events.filter(entry => entry.event === 'read-submit').every(entry => Number.isInteger(entry.capacity) &&
    entry.capacity > 0 && entry.capacity <= settings.readBytes) && reads[0]?.capacity === settings.firstReadBytes, 'positive-bounded-read-capacity');
  let ready = false;
  try { ready = attempts.length > 0 && attempts.every((attempt, i) => validateReadiness(attempt, result.identity) === (i === attempts.length - 1)); }
  catch { /* Invalid captured readiness is a failed premise, not evidence corruption. */ }
  need(ready && index('helper-ready') > index('helper-close') && index('candidate-read-premise') > index('helper-ready') &&
    index('read-submit') > index('candidate-read-premise') && event('candidate-read-premise')?.fixtureAlive === true &&
    event('candidate-read-premise')?.helperActive === false && event('write-enter-observed')?.fixtureAlive === true, 'closed-helper-readable-live-premise');
  need(events.filter(entry => entry.event === 'helper-close').length === attempts.length &&
    events.filter(entry => entry.event === 'helper-spawn').length === attempts.length &&
    attempts.every(attempt => {
      const spawned = events.findIndex(entry => entry.event === 'helper-spawn' && entry.number === attempt.number);
      const closedAt = events.findIndex(entry => entry.event === 'helper-close' && entry.number === attempt.number);
      return spawned >= 0 && spawned < closedAt && closedAt < index('read-submit');
    }), 'all-helper-copies-closed-before-read');
  let chain = false;
  try { verifyReadinessChain(result); chain = true; } catch { /* A failed helper chain remains a failed sample. */ }
  need(chain, 'readiness-attempt-evidence-chain');
  need(first && !first.error && first.count > 0 && first.count <= settings.firstReadBytes, 'successful-first-callback');
  const gate = event('fixture-exit-gate');
  need(gate?.receivedBytes + gate?.auditBytes === settings.payloadBytes && validReceipt(gate?.receipt, result.token, result.pid) &&
    gate?.fixtureAlive === true && index('native-exit') > index('fixture-exit-gate'), 'complete-receipt-before-main-exit');
  if (cancellation) {
    need(result.source === 'interrupted:diagnostic-cancel' && ['read-eof', 'read-eio'].includes(result.auditSource), 'honest-cancel-source');
    need(terminalSourceEvidence(events, 'audit', result.auditSource), 'audit-eof-backed-by-real-callback');
    need(result.receivedBytes === first?.count && result.callbackBytes === first?.count &&
      result.auditBytes === settings.payloadBytes - first?.count, 'actual-owned-byte-partition');
    need(reads.length === 1 && index('read-submit') < index('cancel-effective') && index('reader-deliver') > index('cancel-effective') &&
      index('candidate-source-end') > index('reader-deliver') && index('audit-reader-start') > index('candidate-source-end') &&
      event('audit-reader-start')?.pendingOwner === null && event('audit-reader-start')?.callbackHeld === false &&
      event('audit-reader-start')?.source === result.source, 'cancel-settles-before-audit');
    need(events.every((entry, i) => entry.event !== 'read-submit' || entry.owner !== 'audit' || i > index('audit-reader-start')),
      'audit-submits-only-after-transfer');
    need(event('cancel-effective')?.fixtureAlive === true && event('reader-deliver')?.afterCancel === true &&
      index('audit-source-end') > index('fixture-exit-gate'), 'live-cancel-and-post-gate-audit-eof');
    if (result.scenario === 'cancel-request-pending') need(event('cancel-effective')?.pending === true &&
      event('cancel-effective')?.callbackHeld === false && index('cancel-effective') === index('read-submit') + 1 &&
      index('read-callback') > index('cancel-effective'), 'js-request-pending-at-cancel');
    else need(event('cancel-effective')?.pending === false && event('cancel-effective')?.callbackHeld === true &&
      index('read-callback') < index('read-result-held') && index('read-result-held') < index('cancel-effective') &&
      event('read-result-held')?.bytes === first?.count && event('reader-deliver')?.ms - event('read-result-held')?.ms >= settings.callbackHoldMs,
    'successful-callback-held-at-cancel');
  } else {
    need(['read-eof', 'read-eio'].includes(result.source) && !event('cancel-effective') && result.auditBytes === 0 &&
      !event('audit-reader-start') && result.receivedBytes === settings.payloadBytes && index('candidate-source-end') > index('fixture-exit-gate'), 'control-natural-source');
    need(terminalSourceEvidence(events, 'candidate', result.source), 'candidate-eof-backed-by-real-callback');
  }
  return { pass: failures.length === 0, failures, classification: 'readiness-handshake-owned-read-diagnostic' };
}

function terminalSourceEvidence(events, owner, reason) {
  const callbacks = events.filter(entry => entry.event === 'read-callback' && entry.owner === owner);
  const last = callbacks.at(-1);
  const ends = events.filter(entry => entry.event === `${owner}-source-end`);
  const end = ends[0];
  const actualEof = last && last.count === 0 && (reason === 'read-eof' ? last.error === null : reason === 'read-eio' && last.error === 'EIO');
  return Boolean(actualEof && ends.length === 1 && end.reason === reason && end.readId === last.id &&
    events.indexOf(end) > events.indexOf(last));
}

function verifyReadinessChain(result) {
  const events = result.events, attempts = result.readinessAttempts;
  const firstRead = events.findIndex(entry => entry.event === 'read-submit');
  const premise = events.findIndex(entry => entry.event === 'candidate-read-premise');
  assert(attempts.length > 0 && premise >= 0 && premise < firstRead);
  let previousEnd = -1;
  for (const [index, attempt] of attempts.entries()) {
    assert.equal(attempt.number, index + 1);
    const matches = name => events.filter(entry => entry.event === name && entry.number === attempt.number);
    const spawned = matches('helper-spawn'), closed = matches('helper-close');
    const decisions = events.filter(entry => ['helper-ready', 'helper-not-ready'].includes(entry.event) && entry.number === attempt.number);
    assert.equal(spawned.length, 1);
    assert.equal(closed.length, 1);
    assert.equal(decisions.length, 1);
    assert.equal(spawned[0].pid, attempt.pid);
    assert.deepEqual(spawned[0].identity, result.identity);
    assert.equal(closed[0].pid, attempt.pid);
    assert.equal(closed[0].code, attempt.code);
    assert.equal(closed[0].signal, attempt.signal);
    assert.equal(closed[0].stdioClosed, attempt.stdioClosed);
    assert.deepEqual(decisions[0].report, attempt.report);
    assert.equal(decisions[0].fixtureAlive, true);
    assert.equal(decisions[0].event, index === attempts.length - 1 ? 'helper-ready' : 'helper-not-ready');
    assert.equal(validateReadiness(attempt, result.identity), index === attempts.length - 1);
    const start = events.indexOf(spawned[0]), close = events.indexOf(closed[0]), end = events.indexOf(decisions[0]);
    assert(previousEnd < start && start < close && close < end && end < premise);
    previousEnd = end;
  }
}

async function watchDriver(config, args, deadlineMs) {
  const child = spawn(process.execPath, [script, ...args], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const logs = { stdout: '', stderr: '' };
  child.stdout.on('data', chunk => { logs.stdout += chunk; });
  child.stderr.on('data', chunk => { logs.stderr += chunk; });
  let hardTimeout = false, hardCleanup, closeTimer, closed = false, groupKill;
  const killGroup = () => {
    try { process.kill(-child.pid, 'SIGKILL'); groupKill = { pgid: child.pid, signalled: true }; }
    catch (error) { groupKill = { pgid: child.pid, error: error.code }; }
  };
  const timer = setTimeout(() => { hardTimeout = true; hardCleanup = cleanupFixture(config); killGroup(); }, deadlineMs);
  const result = await new Promise(resolve => {
    child.once('error', error => resolve({ error: error.message, stdioClosed: false }));
    child.once('close', (code, signal) => { closed = true; clearTimeout(closeTimer); resolve({ code, signal, stdioClosed: true }); });
    child.once('exit', (code, signal) => {
      if (closed) return;
      closeTimer = setTimeout(() => {
        killGroup();
        child.stdout.destroy(); child.stderr.destroy();
        resolve({ code, signal, stdioClosed: false });
      }, settings.resourceGuardMs);
    });
  });
  clearTimeout(timer);
  clearTimeout(closeTimer);
  return { ...result, pid: child.pid, detached: true, hardTimeout, groupKill,
    watchdogCleanup: hardCleanup ? await hardCleanup : undefined, logs };
}

async function cleanupFixture(config) {
  const owner = readOptional(path.join(config.dir, 'fixture-owner.json'));
  const result = { scope: config.token, pid: owner?.pid, signalled: false, remaining: [], errors: [] };
  if (!owner) {
    result.evidence = 'fixture-owner-not-registered';
    if (config.scenario) result.errors.push('fixture-cleanup-not-proven');
    return result;
  }
  if (owner.token !== config.token || owner.configPath !== path.join(config.dir, 'config.json') ||
      !Number.isSafeInteger(owner.pid) || owner.pid <= 1 || owner.pid === process.pid) {
    result.errors.push('owner-identity-mismatch');
    return result;
  }
  if (alive(owner.pid)) {
    try {
      const row = execFileSync('ps', ['-ww', '-p', String(owner.pid), '-o', 'pgid=', '-o', 'args='],
        { encoding: 'utf8', timeout: 500, maxBuffer: 65536 }).trim();
      const group = Number(row.match(/^\s*(\d+)/)?.[1]);
      if (group !== owner.pid || !row.includes(script) || !row.includes(owner.configPath)) result.errors.push('live-process-scope-mismatch');
      else { process.kill(-owner.pid, 'SIGKILL'); result.signalled = true; }
    } catch (error) { if (alive(owner.pid) && error.code !== 'ESRCH') result.errors.push(error.message); }
  }
  const until = performance.now() + 1000;
  while (alive(owner.pid) && performance.now() < until) await sleep(10);
  if (alive(owner.pid)) result.remaining.push(owner.pid);
  return result;
}

async function verifySaved(dir, quiet = false) {
  assert.deepEqual(readJSON(path.join(dir, 'schedule.json')), { settings, entries: schedule });
  verifyEnvironment(dir);
  const results = readJSON(path.join(dir, 'summary.json'));
  assert.equal(results.length, schedule.length);
  const failures = [], evidenceErrors = [];
  for (let i = 0; i < schedule.length; i++) {
    const entry = schedule[i], result = results[i];
    try {
      assert.equal(sampleName(result), sampleName(entry));
      const sampleDir = path.join(dir, sampleName(entry)), config = readJSON(path.join(sampleDir, 'config.json'));
      assert.equal(config.scenario, entry.scenario);
      assert.equal(config.run, entry.run);
      assert.equal(config.token, result.token);
      const owner = readOptional(path.join(sampleDir, 'native-owner.json'));
      if (owner) assert.deepEqual(owner, { pid: result.pid, token: result.token, identity: result.identity });
      const raw = fs.readFileSync(path.join(sampleDir, 'received.bin'));
      const audit = fs.readFileSync(path.join(sampleDir, 'audit.bin'));
      const callbacks = fs.readFileSync(path.join(sampleDir, 'candidate-callback.bin'));
      await verifySampleBytes(result, raw, audit, callbacks);
      assert.equal(fs.readFileSync(path.join(sampleDir, 'rendered.txt'), 'utf8'), (await render(raw.toString('utf8'))).text);
      assert.deepEqual(result.events, readEvents(path.join(sampleDir, 'events.ndjson')));
      for (const attempt of result.readinessAttempts) {
        assert.deepEqual(attempt, readJSON(path.join(sampleDir, `readiness-${String(attempt.number).padStart(3, '0')}.json`)));
        if (!attempt.parseError) assert.deepEqual(attempt.report, JSON.parse(attempt.stdout));
      }
      for (const [property, file] of [['receipt', 'writer-receipt.json'], ['owner', 'fixture-owner.json'],
        ['writeProgress', 'write-progress.json'], ['fixtureError', 'fixture-error.json'], ['naturalExit', 'natural-exit.json']]) {
        assert.deepEqual(result[property], readOptional(path.join(sampleDir, file)));
      }
      if (result.owner) assert.equal(result.owner.configPath, path.join(config.dir, 'config.json'));
      assert.deepEqual(result.writerEvents, readEvents(path.join(sampleDir, 'writer-events.ndjson')));
      verifyWriterTrace(result);
      assert.deepEqual(result.driver, readJSON(path.join(sampleDir, 'driver-exit.json')));
      assert.deepEqual(result.cleanup, readJSON(path.join(sampleDir, 'cleanup.json')));
      assert.deepEqual(result.assessment, assess(result));
      if (!result.assessment.pass) failures.push(sampleName(result));
    } catch (error) { evidenceErrors.push({ sample: sampleName(entry), message: error.message }); }
  }
  const report = { attempted: results.length, verified: results.length - evidenceErrors.length, failures, evidenceErrors,
    note: 'Offline artifact verification, not new native execution.' };
  if (!quiet) {
    console.log(JSON.stringify(report));
    if (failures.length || evidenceErrors.length) process.exitCode = 1;
  }
  return report;
}

function verifyEnvironment(dir) {
  const environment = readJSON(path.join(dir, 'environment.json'));
  assert.deepEqual(environment.settings, settings);
  assert(['linux', 'darwin'].includes(environment.platform));
  assert.equal(environment.scope, scope);
  assert.equal(environment.nodePty, '1.2.0-beta.12');
  assert(environment.versions?.node && environment.versions?.uv && environment.kernel && environment.arch);
  const names = ['diagnose-unix-cancel-handshake.mjs', 'unixTerminal.js', 'xterm-headless.js', 'pty.node'];
  if (environment.platform === 'darwin') names.push('spawn-helper');
  assert.equal(environment.hashes.length, names.length);
  environment.hashes.forEach((source, i) => {
    assert.equal(source.snapshot, `source-snapshot/${i}-${names[i]}`);
    assert.equal(path.basename(source.source), names[i]);
    assert.equal(hash(fs.readFileSync(path.join(dir, source.snapshot))), source.hash);
  });
  const compilation = readJSON(path.join(dir, 'helper-compilation.json'));
  assert.equal(compilation.compiler, environment.platform === 'darwin' ? 'clang' : 'gcc');
  assert.equal(compilation.code, 0);
  assert(!compilation.error && compilation.version);
  assert.deepEqual(compilation.args.slice(0, 4), ['-std=c99', '-Wall', '-Wextra', '-Werror']);
  assert.equal(compilation.args[5], '-o');
  assert.equal(compilation.source, 'readiness-helper/unix-pty-readiness.c');
  assert.equal(compilation.binary, 'readiness-helper/unix-pty-readiness');
  assert.equal(hash(fs.readFileSync(path.join(dir, compilation.source))), compilation.sourceHash);
  assert.equal(hash(fs.readFileSync(path.join(dir, compilation.binary))), compilation.binaryHash);
}

async function verifySampleBytes(result, raw, audit, callbacks) {
  for (const [bytes, prefix] of [[raw, 'received'], [audit, 'audit'], [callbacks, 'callback']]) {
    assert.equal(bytes.length, result[`${prefix}Bytes`]);
    assert.equal(hash(bytes), result[`${prefix}Hash`]);
  }
  const expected = result.scenario === 'read-through-control' ? payload : callbacks;
  assert.equal(result.exact, raw.equals(expected));
  assert.equal(result.partitionExact, Buffer.concat([raw, audit]).equals(payload));
  const actual = await render(raw.toString('utf8')), expectedRendered = await render(expected.toString('utf8'));
  assert.deepEqual(result.rendered, withoutText(actual));
  assert.deepEqual(result.expectedRendered, withoutText(expectedRendered));
  assert.equal(result.renderedExact, same(actual, expectedRendered));
  const decoder = new StringDecoder('utf8'), decodedWrites = [];
  for (const [bytes, name] of [[raw, 'reader-deliver'], [audit, 'audit-read-data'], [callbacks, 'read-callback']]) {
    let offset = 0;
    for (const event of result.events.filter(entry => entry.event === name &&
        (name !== 'read-callback' || entry.owner === 'candidate' && entry.count > 0))) {
      const count = name === 'read-callback' ? event.count : event.bytes;
      assert(Number.isInteger(count) && count > 0);
      const part = bytes.subarray(offset, offset + count);
      assert.equal(part.length, count);
      assert.equal(hash(part), event.hash);
      offset += count;
      if (name === 'reader-deliver') {
        const text = decoder.write(part);
        if (text) decodedWrites.push(text);
      }
    }
    assert.equal(offset, bytes.length);
  }
  const tail = decoder.end();
  if (tail) decodedWrites.push(tail);
  const decoderEvents = result.events.filter(entry => entry.event === 'decoder-end');
  assert.equal(decoderEvents.length, result.decoderEnded ? 1 : 0);
  if (result.decoderEnded) {
    assert.equal(decoderEvents[0].bytes, Buffer.byteLength(tail));
    assert.equal(decoderEvents[0].hash, hash(tail));
  }
  assert.deepEqual(result.events.filter(entry => entry.event === 'consumer-enqueue').map(entry =>
    ({ sequence: entry.sequence, bytes: entry.bytes, hash: entry.hash })), decodedWrites.map((text, index) =>
    ({ sequence: index + 1, bytes: Buffer.byteLength(text), hash: hash(text) })));
  for (const owner of ['candidate', 'audit']) {
    const successful = result.events.filter(entry => entry.event === 'read-callback' && entry.owner === owner && entry.count > 0);
    const deliveries = result.events.filter(entry => entry.event === (owner === 'candidate' ? 'reader-deliver' : 'audit-read-data'));
    // Missing delivery is a semantic failure; any claimed delivery must match its actual callback.
    for (const delivery of deliveries) {
      const callback = successful.find(entry => entry.id === delivery.id);
      assert(callback);
      assert.equal(delivery.bytes, callback.count);
      assert.equal(delivery.hash, callback.hash);
      assert(result.events.indexOf(delivery) > result.events.indexOf(callback));
    }
  }
  let pending = null;
  let readId = 0;
  let previousMs = 0;
  for (const entry of result.events) {
    assert(Number.isFinite(entry.ms) && entry.ms >= previousMs);
    previousMs = entry.ms;
    if (entry.event === 'read-submit') {
      assert.equal(pending, null);
      assert.equal(entry.id, ++readId);
      pending = entry;
    }
    if (entry.event === 'read-callback') {
      assert(pending);
      assert.equal(entry.id, pending.id);
      assert.equal(entry.owner, pending.owner);
      assert(entry.count >= 0 && entry.count <= pending.capacity);
      pending = null;
    }
  }
  assert.equal(pending?.owner ?? null, result.pendingOwner);
}

function verifyWriterTrace(result) {
  let call = 0, written = 0, pending = false, monotonic = -1n;
  for (const entry of result.writerEvents) {
    assert.equal(entry.token, result.token);
    assert.equal(entry.pid, result.pid);
    assert.match(entry.monotonicNs, /^\d+$/);
    assert(BigInt(entry.monotonicNs) >= monotonic); monotonic = BigInt(entry.monotonicNs);
    if (entry.phase === 'enter') {
      assert(!pending);
      assert.equal(entry.call, ++call);
      assert.equal(entry.written, written);
      assert.equal(entry.requested, settings.payloadBytes - written);
      pending = true;
    } else {
      assert(pending);
      assert.equal(entry.call, call);
      if (entry.phase === 'returned') {
        assert(Number.isInteger(entry.count) && entry.count > 0 && written + entry.count <= settings.payloadBytes);
        written += entry.count;
      } else assert.equal(entry.phase, 'error');
      assert.equal(entry.written, written);
      pending = false;
    }
  }
  assert.deepEqual(result.writeProgress, result.writerEvents.at(-1) ?? null);
  if (result.receipt?.complete) { assert(!pending); assert.equal(written, settings.payloadBytes); }
}

async function selfTest() {
  assert.equal(schedule.length, 9);
  assert.equal(new Set(schedule.map(sampleName)).size, 9);
  let dir;
  if (process.env.DSC_CANCEL_SELFTEST_EVIDENCE) {
    dir = path.resolve(process.env.DSC_CANCEL_SELFTEST_EVIDENCE);
    assert(!fs.existsSync(dir), 'Refusing to overwrite self-test evidence');
    fs.mkdirSync(dir, { recursive: true });
  } else dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsc-unix-cancel-handshake-selftest-'));
  compileHelper(dir);
  const identity = { dev: '1', ino: '2', rdev: '3' };
  const good = { number: 1, pid: 123, identity, code: 0, signal: null, stdioClosed: true, stderr: '',
    report: { version: 1, pid: 123, tty: true, identity, readable: true, hup: false, error: false, invalid: false, revents: 1 } };
  assert.equal(validateReadiness(good, identity), true);
  const negative = [];
  for (const [name, mutate] of [
    ['bad-ready', attempt => { attempt.report.hup = true; }],
    ['fd-identity', attempt => { attempt.report.identity = { ...identity, ino: '99' }; }],
    ['helper-not-closed', attempt => { attempt.stdioClosed = false; }],
    ['invalid-readability-bit', attempt => { attempt.report.revents = 0; }],
  ]) {
    const attempt = structuredClone(good); mutate(attempt);
    assert.throws(() => validateReadiness(attempt, identity));
    negative.push({ name, rejected: true, input: attempt });
  }
  const baseline = await syntheticResult('cancel-request-pending', identity, good);
  assert.equal(assess(baseline).pass, true, JSON.stringify(assess(baseline)));
  const multi = structuredClone(baseline);
  const notReady = structuredClone(good);
  notReady.report.readable = false; notReady.report.revents = 0;
  const readyAgain = structuredClone(good); readyAgain.number = 2; readyAgain.pid++;
  readyAgain.report.pid = readyAgain.pid;
  multi.readinessAttempts = [notReady, readyAgain];
  const originalHelperEvents = multi.events.filter(entry => entry.event.startsWith('helper-'));
  originalHelperEvents[2].event = 'helper-not-ready'; originalHelperEvents[2].report = notReady.report;
  const additional = structuredClone(originalHelperEvents);
  for (const entry of additional) { entry.number = 2; if (entry.pid) entry.pid = readyAgain.pid; }
  additional[2].event = 'helper-ready'; additional[2].report = readyAgain.report;
  multi.events.splice(multi.events.indexOf(originalHelperEvents[2]) + 1, 0, ...additional);
  multi.events.forEach((entry, i) => { entry.ms = i; });
  assert.equal(assess(multi).pass, true, JSON.stringify(assess(multi)));
  const lateClose = structuredClone(multi);
  const lateIndex = lateClose.events.findIndex(entry => entry.event === 'helper-close' && entry.number === 2);
  const [late] = lateClose.events.splice(lateIndex, 1);
  lateClose.events.push(late);
  lateClose.events.forEach((entry, i) => { entry.ms = i; });
  assert.equal(assess(lateClose).pass, false);
  negative.push({ name: 'second-helper-closes-after-read', rejected: true, assessment: assess(lateClose) });
  for (const [name, mutate] of [
    ['fake-eof', result => { result.source = 'read-eof'; }],
    ['fake-eof-from-eagain', result => { result.events.findLast(entry => entry.event === 'read-callback').error = 'EAGAIN'; }],
    ['early-audit', result => { result.events.find(entry => entry.event === 'audit-reader-start').pendingOwner = 'candidate'; }],
    ['lost-owned-bytes', result => { result.receivedBytes--; }],
    ['missing-receipt', result => { result.receipt = null; }],
    ['wrong-partition', result => { result.auditBytes++; }],
    ['duplicate-audit-delivery-id', result => {
      const index = result.events.findIndex(entry => entry.event === 'audit-read-data');
      result.events.splice(index + 1, 0, structuredClone(result.events[index]));
    }],
  ]) {
    const result = structuredClone(baseline); mutate(result);
    const assessment = assess(result);
    assert.equal(assessment.pass, false);
    negative.push({ name, rejected: true, assessment });
  }
  await verifySampleBytes(baseline, payload.subarray(0, 17), payload.subarray(17), payload.subarray(0, 17));
  await assert.rejects(() => verifySampleBytes(baseline, Buffer.from('X'.repeat(17)), payload.subarray(17), payload.subarray(0, 17)));
  negative.push({ name: 'corrupt-raw', rejected: true });
  save(dir, 'negative-tests.json', negative);
  await verifierTraversalSelfTest(dir, identity, good);
  for (const fixture of [false, true]) {
    const sampleDir = path.join(dir, fixture ? 'watchdog-with-fixture' : 'watchdog-helper-only');
    fs.mkdirSync(sampleDir);
    const config = { dir: sampleDir, token: randomUUID() };
    save(sampleDir, 'config.json', config);
    let fixtureExit;
    if (fixture) {
      const child = spawn(process.execPath, [script, '--watchdog-fixture', path.join(sampleDir, 'config.json')], { detached: true, stdio: 'ignore' });
      fixtureExit = new Promise(resolve => child.once('close', resolve));
      await waitFile(path.join(sampleDir, 'fixture-owner.json'), 1000);
    }
    const result = await watchDriver(config, ['--watchdog-block', path.join(sampleDir, 'config.json')], 1000);
    if (fixtureExit) await fixtureExit;
    save(sampleDir, 'driver-exit.json', result);
    assert.equal(result.hardTimeout, true);
    assert.equal(result.signal, 'SIGKILL');
    assert.equal(result.groupKill.signalled, true);
    const helper = readJSON(path.join(sampleDir, 'watchdog-helper-owner.json'));
    assert.equal(helper.pgid, result.pid);
    const until = performance.now() + settings.resourceGuardMs;
    while (runnable(helper.pid) && performance.now() < until) await sleep(10);
    assert.equal(runnable(helper.pid), false, 'Hard watchdog must stop the resource-holding helper too');
    const cleanup = await cleanupFixture(config);
    save(sampleDir, 'cleanup.json', { ...cleanup, helper: { ...helper, runnable: runnable(helper.pid),
      scope: 'Non-PTY process-group cleanup; zombies are not running resource owners.' } });
    assert.equal(cleanup.remaining.length, 0);
    assert.equal(cleanup.errors.length, 0);
  }
  console.log(JSON.stringify({ selfTest: 'passed', ptyLaunched: false, evidence: dir,
    scope: 'Compiled helper, synthetic contract rejection, and non-PTY process-group watchdog only.' }));
}

async function syntheticResult(scenario, identity, good) {
  const bytes = payload.subarray(0, 17), remainder = payload.subarray(17), token = 'synthetic-only', pid = 456;
  const receipt = { pid, token, written: payload.length, hash: hash(payload), complete: true, stdoutTTY: true };
  const events = [], mark = (event, details = {}) => events.push({ ms: events.length, event, ...details });
  mark('write-enter-observed', { fixtureAlive: true });
  mark('helper-spawn', { number: 1, pid: good.pid, identity });
  mark('helper-close', { number: 1, pid: good.pid, code: 0, signal: null, stdioClosed: true });
  mark('helper-ready', { number: 1, fixtureAlive: true, report: good.report });
  mark('candidate-read-premise', { fixtureAlive: true, helperActive: false });
  mark('read-submit', { owner: 'candidate', id: 1, capacity: 64 });
  mark('cancel-effective', { pending: true, callbackHeld: false, fixtureAlive: true });
  mark('read-callback', { owner: 'candidate', id: 1, count: 17, error: null, hash: hash(bytes) });
  mark('reader-deliver', { id: 1, bytes: 17, hash: hash(bytes), afterCancel: true });
  mark('consumer-enqueue', { sequence: 1, bytes: 17, hash: hash(bytes) });
  mark('parser-applied', { sequence: 1 }); mark('consumer-complete', { sequence: 1 });
  mark('decoder-end', { bytes: 0, hash: hash('') });
  mark('candidate-source-end', { reason: 'interrupted:diagnostic-cancel' });
  mark('audit-reader-start', { pendingOwner: null, callbackHeld: false, source: 'interrupted:diagnostic-cancel' });
  mark('read-submit', { owner: 'audit', id: 2, capacity: settings.readBytes });
  mark('read-callback', { owner: 'audit', id: 2, count: remainder.length, error: null, hash: hash(remainder) });
  mark('audit-read-data', { id: 2, bytes: remainder.length, hash: hash(remainder) });
  mark('fixture-exit-gate', { receivedBytes: 17, auditBytes: remainder.length, receipt, fixtureAlive: true });
  mark('read-submit', { owner: 'audit', id: 3, capacity: settings.readBytes });
  mark('read-callback', { owner: 'audit', id: 3, count: 0, error: 'EIO', hash: hash('') });
  mark('audit-source-end', { reason: 'read-eio', readId: 3 }); mark('native-exit');
  mark('fd-close-request', { pendingOwner: null, callbackHeld: false, helperActive: false });
  mark('fd-close-complete'); mark('consumer-barrier-complete'); mark('terminal-dispose');
  const rendered = withoutText(await render(bytes.toString('utf8')));
  return { scenario, run: 1, token, pid, identity, source: 'interrupted:diagnostic-cancel', auditSource: 'read-eio',
    driver: { code: 0, signal: null, stdioClosed: true, detached: true }, naturalExit: { code: 0 },
    cleanup: { remaining: [], errors: [] }, exact: true, partitionExact: true, renderedExact: true, rendered, expectedRendered: rendered,
    receipt, owner: { pid, token, stdoutTTY: true, stdinTTY: true }, exit: { code: 0, signal: 0 },
    closed: true, closeProbe: 'EBADF', accepted: 1, completed: 1, decoderEnded: true,
    pendingOwner: null, callbackHeld: false, readinessAttempts: [good], events,
    receivedBytes: 17, receivedHash: hash(bytes), auditBytes: remainder.length, auditHash: hash(remainder),
    callbackBytes: 17, callbackHash: hash(bytes) };
}

async function verifierTraversalSelfTest(parent, identity, good) {
  const dir = path.join(parent, 'synthetic-verifier-input');
  fs.mkdirSync(dir);
  save(dir, 'scope.json', { synthetic: true, ptyLaunched: false,
    purpose: 'Verify that missing receipts and one corrupted raw file do not hide later samples.' });
  fs.cpSync(path.join(parent, 'readiness-helper'), path.join(dir, 'readiness-helper'), { recursive: true });
  fs.copyFileSync(path.join(parent, 'helper-compilation.json'), path.join(dir, 'helper-compilation.json'));
  recordEnvironment(dir);
  save(dir, 'schedule.json', { settings, entries: schedule });
  const results = [];
  for (const entry of schedule) {
    const sampleDir = path.join(dir, sampleName(entry));
    fs.mkdirSync(sampleDir);
    const result = await syntheticResult(entry.scenario, identity, structuredClone(good));
    result.run = entry.run;
    result.error = 'Synthetic failure only; no native execution occurred.';
    result.owner.configPath = path.join(sampleDir, 'config.json');
    result.readinessAttempts[0].stdout = JSON.stringify(result.readinessAttempts[0].report) + '\n';
    result.writerEvents = [
      { token: result.token, pid: result.pid, call: 1, monotonicNs: '1', phase: 'enter', requested: payload.length, written: 0 },
      { token: result.token, pid: result.pid, call: 1, monotonicNs: '2', phase: 'returned', count: payload.length, written: payload.length },
    ];
    result.writeProgress = result.writerEvents[1];
    result.fixtureError = null;
    if (results.length === 0) result.receipt = null;
    const raw = payload.subarray(0, 17), audit = payload.subarray(17);
    if (entry.scenario === 'read-through-control') {
      result.exact = false;
      result.expectedRendered = withoutText(await render(payload.toString('utf8')));
      result.renderedExact = false;
    }
    result.assessment = assess(result);
    const config = { ...entry, token: result.token, dir: sampleDir };
    save(sampleDir, 'config.json', config);
    save(sampleDir, 'native-owner.json', { pid: result.pid, token: result.token, identity });
    save(sampleDir, 'summary.json', result);
    for (const [property, file] of [['receipt', 'writer-receipt.json'], ['owner', 'fixture-owner.json'],
      ['writeProgress', 'write-progress.json'], ['driver', 'driver-exit.json'], ['cleanup', 'cleanup.json'],
      ['naturalExit', 'natural-exit.json']]) {
      if (result[property] !== null) save(sampleDir, file, result[property]);
    }
    save(sampleDir, 'readiness-001.json', result.readinessAttempts[0]);
    fs.writeFileSync(path.join(sampleDir, 'events.ndjson'), result.events.map(event => JSON.stringify(event) + '\n').join(''));
    fs.writeFileSync(path.join(sampleDir, 'writer-events.ndjson'), result.writerEvents.map(event => JSON.stringify(event) + '\n').join(''));
    fs.writeFileSync(path.join(sampleDir, 'received.bin'), raw);
    fs.writeFileSync(path.join(sampleDir, 'audit.bin'), audit);
    fs.writeFileSync(path.join(sampleDir, 'candidate-callback.bin'), raw);
    fs.writeFileSync(path.join(sampleDir, 'rendered.txt'), (await render(raw.toString('utf8'))).text);
    results.push(result);
  }
  save(dir, 'summary.json', results);
  const complete = await verifySaved(dir, true);
  save(parent, 'verifier-valid-failures.json', complete);
  assert.equal(complete.attempted, 9);
  assert.equal(complete.verified, 9);
  assert.equal(complete.failures.length, 9);
  assert.equal(complete.evidenceErrors.length, 0);
  fs.writeFileSync(path.join(dir, sampleName(schedule[1]), 'received.bin'), Buffer.from('X'.repeat(17)));
  const corrupted = await verifySaved(dir, true);
  save(parent, 'verifier-one-corrupt-raw.json', corrupted);
  assert.equal(corrupted.attempted, 9);
  assert.equal(corrupted.verified, 8);
  assert.equal(corrupted.evidenceErrors.length, 1);
  assert.equal(corrupted.evidenceErrors[0].sample, sampleName(schedule[1]));
  assert.equal(corrupted.failures.length, 8);
  assert(corrupted.failures.includes(sampleName(schedule.at(-1))), 'Corruption must not stop later verification');
}

async function watchdogBlock(config) {
  const child = spawn(process.execPath, [script, '--watchdog-helper', path.join(config.dir, 'config.json')],
    { stdio: ['ignore', 'inherit', 'inherit'] });
  child.on('error', error => { throw error; });
  await waitFile(path.join(config.dir, 'watchdog-helper-owner.json'), 1000);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30000);
}
async function watchdogHelper(config) {
  const fd = fs.openSync(path.join(config.dir, 'held-resource.bin'), 'w');
  const pgid = Number(execFileSync('ps', ['-p', String(process.pid), '-o', 'pgid='], { encoding: 'utf8' }).trim());
  save(config.dir, 'watchdog-helper-owner.json', { pid: process.pid, token: config.token, pgid, fd });
  await sleep(30000);
  fs.closeSync(fd);
}
async function watchdogFixture(config) {
  save(config.dir, 'fixture-owner.json', { pid: process.pid, token: config.token,
    configPath: path.join(config.dir, 'config.json'), watchdogOnly: true });
  await sleep(30000);
}
async function waitFile(file, ms) {
  const until = performance.now() + ms;
  while (!fs.existsSync(file) && performance.now() < until) await sleep(settings.idleMs);
  assert(fs.existsSync(file), `Expected control artifact: ${file}`);
}
async function render(text) {
  const { Terminal } = require('@xterm/headless');
  const terminal = new Terminal({ cols: settings.cols, rows: settings.rows, scrollback: settings.scrollback, allowProposedApi: true });
  let title = '';
  terminal.onTitleChange(value => { title = value; });
  try { if (text) await new Promise(resolve => terminal.write(text, resolve)); return snapshot(terminal, title); }
  finally { terminal.dispose(); }
}
function snapshot(terminal, title) {
  const buffer = terminal.buffer.active;
  return { text: Array.from({ length: buffer.length }, (_, i) => buffer.getLine(i).translateToString(true)).join('\n'),
    cursorX: buffer.cursorX, cursorLine: buffer.baseY + buffer.cursorY, title };
}
function fdIdentity(fd) { const stat = fs.fstatSync(fd, { bigint: true }); return { dev: String(stat.dev), ino: String(stat.ino), rdev: String(stat.rdev) }; }
function validReceipt(receipt, token, pid) {
  return Boolean(receipt?.complete && receipt.written === payload.length && receipt.hash === hash(payload) &&
    receipt.token === token && receipt.pid === pid && receipt.stdoutTTY);
}
function withoutText(value) { const { text, ...state } = value; return { ...state, textHash: hash(text) }; }
function same(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
function sampleName(entry) { return `${entry.scenario}-${entry.run}`; }
function alive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
function runnable(pid) {
  try { return !execFileSync('ps', ['-p', String(pid), '-o', 'stat='], { encoding: 'utf8' }).trim().startsWith('Z'); }
  catch { return false; }
}
function hash(value) { return createHash('sha256').update(value).digest('hex'); }
function readJSON(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function readOptional(file) { return fs.existsSync(file) ? readJSON(file) : null; }
function readEvents(file) { return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : []; }
function save(dir, file, value) {
  const destination = path.join(dir, file), temporary = `${destination}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(temporary, destination);
}
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function round(value) { return Math.round(value * 1000) / 1000; }
