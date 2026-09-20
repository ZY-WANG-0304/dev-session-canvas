// Versioned diagnostic: keep the f4600844 probe and its first failures unchanged.
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
const settings = Object.freeze({ runs: 3, lines: 90000, pauseLine: 89800, pauseMs: 350,
  readBytes: 65536, cancelReadBytes: 64, cancelPayloadBytes: 2048, idleMs: 2,
  callbackHoldMs: 100, consumerHoldMs: 100, sampleMs: 10000, hardMs: 15000,
  resourceGuardMs: 1000, cols: 96, rows: 28, scrollback: 100000 });
const cases = ['natural-zero', 'natural-nonzero', 'paused-tail', 'split-state',
  'consumer-held', 'cancel-read-pending', 'cancel-callback-held', 'write-no-read', 'write-release'];
const scope = 'Version 2 positive-capacity Unix reader and synchronous-write controls; no production cancellation policy or native handle no-growth proof.';
const schedule = cases.flatMap(scenario => Array.from({ length: settings.runs }, (_, i) => ({ scenario, run: i + 1 })));
const { values } = parseArgs({ options: { output: { type: 'string' }, sample: { type: 'string' },
  fixture: { type: 'string' }, 'self-test': { type: 'boolean' }, 'verify-saved': { type: 'string' },
  'watchdog-block': { type: 'string' }, 'watchdog-fixture': { type: 'string' } } });

try {
  if (values.fixture) await runFixture(readJSON(values.fixture));
  else if (values['watchdog-fixture']) await watchdogFixture(readJSON(values['watchdog-fixture']));
  else if (values['watchdog-block']) watchdogBlock(readJSON(values['watchdog-block']));
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

function payload(scenario) {
  if (isWriteProbe(scenario)) return 'C'.repeat(settings.cancelPayloadBytes);
  if (scenario === 'split-state') return 'UNICODE:\u4e2d\u{1f642}\n\x1b[2G!\x1b]0;tail-title\x07END\n';
  if (scenario === 'consumer-held') return 'HEAD\nTAIL\n';
  return Array.from({ length: settings.lines }, (_, i) => `DSC_TAIL_${String(i + 1).padStart(5, '0')}_0123456789\n`).join('');
}

async function runFixture(config) {
  const { scenario, dir, token } = config;
  assert(cases.includes(scenario));
  save(dir, 'fixture-owner.json', { pid: process.pid, token, configPath: path.join(dir, 'config.json'),
    stdoutTTY: Boolean(process.stdout.isTTY), stdinTTY: Boolean(process.stdin.isTTY) });
  const bytes = Buffer.from(payload(scenario));
  let written = 0, call = 0;
  const traceWrite = detail => {
    if (!isWriteProbe(scenario)) return;
    const entry = { token, pid: process.pid, call, monotonicNs: process.hrtime.bigint().toString(), ...detail };
    fs.appendFileSync(path.join(dir, 'writer-events.ndjson'), JSON.stringify(entry) + '\n');
    save(dir, 'write-progress.json', entry);
  };
  const write = part => {
    let offset = 0;
    while (offset < part.length) {
      call++;
      traceWrite({ phase: 'enter', requested: part.length - offset, written: written + offset });
      let count;
      try { count = fs.writeSync(1, part, offset, part.length - offset); }
      catch (error) {
        traceWrite({ phase: 'error', code: error.code, errno: error.errno, message: error.message, written: written + offset });
        throw error;
      }
      traceWrite({ phase: 'returned', count, written: written + offset + count });
      assert(count > 0 && count <= part.length - offset, 'Write must make valid progress');
      offset += count;
    }
    written += offset;
  };
  if (scenario === 'split-state') {
    for (const part of [bytes.subarray(0, 10), bytes.subarray(10, 13), bytes.subarray(13, 20), bytes.subarray(20)]) {
      write(part);
      await sleep(10);
    }
  } else {
    for (let offset = 0; offset < bytes.length; offset += 8192) write(bytes.subarray(offset, offset + 8192));
  }
  save(dir, 'writer-receipt.json', { pid: process.pid, token, written, hash: hash(bytes),
    complete: written === bytes.length, stdoutTTY: Boolean(process.stdout.isTTY),
    intendedExitCode: scenario === 'natural-nonzero' ? 7 : 0 });
  if (isWriteProbe(scenario)) {
    while (!fs.existsSync(path.join(dir, 'exit-gate'))) await sleep(settings.idleMs);
  }
  process.exitCode = scenario === 'natural-nonzero' ? 7 : 0;
}

async function runSchedule() {
  assert(['linux', 'darwin'].includes(process.platform), 'Unix native probe requires Linux or macOS');
  assert(values.output, '--output must name a new evidence directory');
  const output = path.resolve(values.output);
  assert(!fs.existsSync(output), 'Refusing to overwrite evidence');
  fs.mkdirSync(output, { recursive: true });
  save(output, 'schedule.json', { settings, entries: schedule });
  const sources = [script, require.resolve('node-pty/lib/unixTerminal'), require.resolve('@xterm/headless')];
  const native = require('node-pty/lib/utils').loadNativeModule('pty');
  const lib = path.dirname(require.resolve('node-pty/lib/unixTerminal'));
  sources.push(path.resolve(lib, native.dir, 'pty.node'));
  if (process.platform === 'darwin') sources.push(path.resolve(lib, native.dir, 'spawn-helper'));
  const hashes = sources.map((source, index) => {
    const name = `${index}-${path.basename(source)}`;
    fs.mkdirSync(path.join(output, 'source-snapshot'), { recursive: true });
    fs.copyFileSync(source, path.join(output, 'source-snapshot', name));
    return { source, snapshot: `source-snapshot/${name}`, hash: hash(fs.readFileSync(source)) };
  });
  save(output, 'environment.json', { settings, platform: process.platform, arch: process.arch,
    kernel: os.release(), versions: process.versions, executable: process.execPath,
    nodePty: require('node-pty/package.json').version, hashes,
    github: { sha: process.env.GITHUB_SHA, runId: process.env.GITHUB_RUN_ID,
      attempt: process.env.GITHUB_RUN_ATTEMPT, image: process.env.ImageOS, imageVersion: process.env.ImageVersion },
    scope });
  const results = [];
  for (const entry of schedule) {
    const dir = path.join(output, sampleName(entry));
    fs.mkdirSync(dir);
    const config = { ...entry, dir, token: randomUUID() };
    save(dir, 'config.json', config);
    const driver = await watchDriver(config, ['--sample', path.join(dir, 'config.json')], settings.hardMs);
    save(dir, 'driver-exit.json', driver);
    const cleanup = await cleanupFixture(config);
    save(dir, 'cleanup.json', cleanup);
    const result = readOptional(path.join(dir, 'summary.json')) ?? { ...entry, error: 'Driver did not write a summary' };
    result.driver = driver;
    result.cleanup = cleanup;
    result.naturalExit = readOptional(path.join(dir, 'natural-exit.json'));
    result.assessment = assess(result);
    results.push(result);
    save(output, 'summary.json', results);
    console.log(JSON.stringify({ ...entry, pass: result.assessment.pass, source: result.source,
      receivedBytes: result.receivedBytes, auditBytes: result.auditBytes, failures: result.assessment.failures }));
  }
  const failures = results.filter(result => !result.assessment.pass);
  console.log(JSON.stringify({ samples: results.length, failures: failures.length, evidence: output }));
  if (failures.length) process.exitCode = 1;
}

async function runSample(config) {
  const { scenario, run, dir } = config;
  assert(cases.includes(scenario));
  const cancellation = isCancellation(scenario);
  const started = performance.now();
  const events = [];
  const received = [];
  const audit = [];
  const decoder = new StringDecoder('utf8');
  const { Terminal } = require('@xterm/headless');
  const terminal = new Terminal({ cols: settings.cols, rows: settings.rows,
    scrollback: settings.scrollback, allowProposedApi: true });
  let title = '';
  terminal.onTitleChange(value => { title = value; });
  const consumerJobs = [];
  let accepted = 0, completed = 0, pending = false, callbackHeld = false;
  let fd, pid, exit, source, auditSource, closed = false, closeError, closeProbe;
  let cancelled = false, timedOut = false, paused = false, pauseUntil = 0;
  let loopTimer, deadlineTimer, resourceTimer, holdTimer, readCalls = 0, eagain = 0;
  let deliveredBytes = 0, logicalBytes = 0;
  let tail = '', pendingAtClose = 0, sourceEndPending = 0, errorDetail;
  let resolveDone;
  const done = new Promise(resolve => { resolveDone = resolve; });
  const mark = (event, detail = {}) => {
    const entry = { ms: round(performance.now() - started), event, ...detail };
    events.push(entry);
    fs.appendFileSync(path.join(dir, 'events.ndjson'), JSON.stringify(entry) + '\n');
  };
  const ready = () => { if (exit && closed) resolveDone(); };
  const enqueue = text => {
    if (!text) return;
    const sequence = ++accepted;
    mark('consumer-enqueue', { sequence, bytes: Buffer.byteLength(text), hash: hash(text) });
    consumerJobs.push(new Promise(resolve => terminal.write(text, () => {
      mark('parser-applied', { sequence });
      const finish = () => { completed++; mark('consumer-complete', { sequence }); resolve(); };
      if (scenario === 'consumer-held') {
        mark('consumer-notification-held', { sequence, durationMs: settings.consumerHoldMs });
        setTimeout(finish, settings.consumerHoldMs);
      } else finish();
    })));
  };
  const acceptBytes = bytes => {
    const copy = Buffer.from(bytes);
    received.push(copy);
    deliveredBytes += copy.length;
    if (scenario === 'paused-tail') logicalBytes += nonCrBytes(copy);
    fs.appendFileSync(path.join(dir, 'received.bin'), copy);
    mark('reader-deliver', { bytes: copy.length, hash: hash(copy), afterCancel: cancelled });
    const text = decoder.write(copy);
    enqueue(text);
    const boundary = tail + text;
    tail = boundary.slice(-100);
    if (scenario === 'paused-tail' && !paused && boundary.includes(`DSC_TAIL_${settings.pauseLine}_`)) {
      paused = true;
      pauseUntil = performance.now() + settings.pauseMs;
      mark('reader-pause', { durationMs: settings.pauseMs, deliveredBytes });
    }
  };
  const close = () => {
    assert(!pending && !callbackHeld, 'Close cannot race an owned read');
    mark('fd-close-request', { pending, callbackHeld });
    fs.close(fd, error => {
      closed = true;
      closeError = error?.code;
      try { fs.fstatSync(fd); closeProbe = 'still-open'; } catch (probeError) { closeProbe = probeError.code; }
      pendingAtClose = accepted - completed;
      mark('fd-close-complete', { error: closeError, probe: closeProbe, consumerPending: pendingAtClose });
      ready();
    });
  };
  const finish = reason => {
    assert(!source, 'Candidate source may settle only once');
    source = reason;
    clearTimeout(loopTimer);
    enqueue(decoder.end());
    sourceEndPending = accepted - completed;
    mark('candidate-source-end', { reason, consumerPending: sourceEndPending });
    if (cancellation && reason === 'interrupted:diagnostic-cancel') {
      // This second reader is an oracle only; its bytes never enter the candidate consumer.
      mark('audit-reader-start', { pending, callbackHeld });
      auditRead();
    } else close();
  };
  const cancel = () => {
    assert(!cancelled && !source);
    cancelled = true;
    mark('cancel-effective', { pending, callbackHeld, fixtureAlive: alive(pid) });
  };
  const readNext = () => {
    assert(!source && !cancelled && !pending);
    const wait = pauseUntil - performance.now();
    if (wait > 0) { loopTimer = setTimeout(() => { mark('reader-resume'); readNext(); }, wait); return; }
    const buffer = Buffer.alloc(readCapacity(scenario, paused, logicalBytes));
    pending = true;
    readCalls++;
    mark('read-submit', { readCalls, capacity: buffer.length });
    fs.read(fd, buffer, 0, buffer.length, null, (error, count) => {
      pending = false;
      const bytes = Buffer.from(buffer.subarray(0, count ?? 0));
      mark('read-callback', { count, error: error?.code, cancelled });
      const deliver = () => {
        callbackHeld = false;
        if (bytes.length) acceptBytes(bytes);
        if (cancelled) { finish('interrupted:diagnostic-cancel'); return; }
        if (error?.code === 'EAGAIN' || error?.code === 'EWOULDBLOCK') {
          if (scenario === 'write-release' && deliveredBytes === settings.cancelPayloadBytes &&
              readOptional(path.join(dir, 'writer-receipt.json'))?.complete && !fs.existsSync(path.join(dir, 'exit-gate'))) {
            mark('write-control-exit-gate', { deliveredBytes });
            save(dir, 'exit-gate', { token: config.token });
          }
          eagain++; loopTimer = setTimeout(readNext, settings.idleMs);
        } else if (error?.code === 'EINTR') loopTimer = setTimeout(readNext, 0);
        else if (error) finish(error.code === 'EIO' ? 'read-eio' : `read-error:${error.code}`);
        else if (count === 0) finish('read-eof');
        else setImmediate(readNext);
      };
      if (scenario === 'cancel-callback-held') {
        callbackHeld = true;
        mark('read-result-held', { bytes: bytes.length, durationMs: settings.callbackHoldMs });
        cancel();
        holdTimer = setTimeout(deliver, settings.callbackHoldMs);
      } else deliver();
    });
    if (scenario === 'cancel-read-pending') cancel();
  };
  const auditRead = () => {
    assert(source === 'interrupted:diagnostic-cancel' && !pending && !callbackHeld);
    const buffer = Buffer.alloc(settings.readBytes);
    pending = true;
    fs.read(fd, buffer, 0, buffer.length, null, (error, count) => {
      pending = false;
      if (count) {
        const bytes = Buffer.from(buffer.subarray(0, count));
        audit.push(bytes);
        fs.appendFileSync(path.join(dir, 'audit.bin'), bytes);
        mark('audit-read-data', { bytes: count, hash: hash(bytes), fixtureAlive: alive(pid) });
      }
      if (error?.code === 'EAGAIN' || error?.code === 'EWOULDBLOCK') {
        mark('audit-would-block', { fixtureAlive: alive(pid) });
        fs.writeFileSync(path.join(dir, 'exit-gate'), 'audit-observed-current-buffer\n');
        loopTimer = setTimeout(auditRead, settings.idleMs);
      } else if (error?.code === 'EINTR') loopTimer = setTimeout(auditRead, 0);
      else if (error || count === 0) {
        auditSource = error?.code === 'EIO' ? 'read-eio' : error ? `read-error:${error.code}` : 'read-eof';
        mark('audit-source-end', { reason: auditSource });
        close();
      } else setImmediate(auditRead);
    });
  };
  process.on('beforeExit', code => save(dir, 'natural-exit.json', { code, resources: process.getActiveResourcesInfo() }));
  process.on('exit', code => save(dir, 'process-exit.json', { code, resources: process.getActiveResourcesInfo() }));
  for (const file of ['received.bin', 'audit.bin', 'events.ndjson']) fs.writeFileSync(path.join(dir, file), '');
  try {
    deadlineTimer = setTimeout(() => {
      timedOut = true;
      mark('sample-deadline', { pending, callbackHeld, source });
      process.exitCode = 2;
      save(dir, 'incomplete.json', { scenario, pid, source, auditSource, exit, events });
      // The independent parent owns hard cleanup, including a pending read that never returns.
      resolveDone();
    }, settings.sampleMs);
    const native = require('node-pty/lib/utils').loadNativeModule('pty');
    const helper = path.resolve(path.dirname(require.resolve('node-pty/lib/unixTerminal')), native.dir, 'spawn-helper');
    const env = { ...process.env, TERM: 'xterm-256color', LANG: 'C.UTF-8', HISTFILE: '/dev/null' };
    const term = native.module.fork(process.execPath, [script, '--fixture', path.join(dir, 'config.json')],
      Object.entries(env).filter(([, value]) => value !== undefined).map(([key, value]) => `${key}=${value}`),
      dir, settings.cols, settings.rows, -1, -1, true, helper, (code, signal) => {
        exit = { code, signal }; mark('native-exit', exit); ready();
      });
    ({ fd, pid } = term);
    mark('spawn', { pid, fd });
    save(dir, 'native-owner.json', { pid, token: config.token });
    if (isWriteControl(scenario)) {
      while (!fs.existsSync(path.join(dir, 'write-progress.json')) && !timedOut) await sleep(settings.idleMs);
      assert(!timedOut, 'Writer did not enter its write call');
      mark('write-enter-observed', { progress: readJSON(path.join(dir, 'write-progress.json')) });
      const observedAt = events.at(-1).ms;
      while (performance.now() - started - observedAt < settings.callbackHoldMs) await sleep(settings.idleMs);
      mark('write-control-observation', { progress: readJSON(path.join(dir, 'write-progress.json')),
        receipt: readOptional(path.join(dir, 'writer-receipt.json')), fixtureAlive: alive(pid), exit });
    }
    if (cancellation) {
      while (!fs.existsSync(path.join(dir, 'writer-receipt.json')) && !timedOut) await sleep(settings.idleMs);
      assert(!timedOut, 'Writer did not establish buffered-data premise');
      mark('receipt-before-candidate-read', { receipt: readJSON(path.join(dir, 'writer-receipt.json')), fixtureAlive: alive(pid) });
    }
    if (scenario === 'write-no-read') finish('interrupted:diagnostic-no-read-control');
    else readNext();
    await done;
    assert(!timedOut, 'Sample deadline is interruption, not EOF');
    mark('consumer-barrier-wait', { pending: accepted - completed, fdClosed: closed });
    await Promise.all(consumerJobs);
    assert.equal(accepted, completed);
    mark('consumer-barrier-complete', { accepted, completed });
  } catch (error) {
    errorDetail = error.stack ?? String(error);
    mark('driver-error', { error: errorDetail });
    process.exitCode = 1;
  } finally {
    clearTimeout(deadlineTimer);
    if (closed) { clearTimeout(loopTimer); clearTimeout(holdTimer); }
  }
  const actual = snapshot(terminal, title);
  terminal.dispose();
  mark('terminal-dispose', { accepted, completed });
  const raw = Buffer.concat(received);
  const auditBytes = Buffer.concat(audit);
  const expected = payload(scenario);
  const renderedExpected = await render(expectedConsumer(scenario));
  fs.writeFileSync(path.join(dir, 'rendered.txt'), actual.text);
  const result = { scenario, run, token: config.token, pid, source, auditSource, exit, error: errorDetail, timedOut,
    receivedBytes: raw.length, receivedHash: hash(raw), auditBytes: auditBytes.length, auditHash: hash(auditBytes),
    decoded: hash(new StringDecoder('utf8').end(raw)),
    exact: normalize(raw.toString('utf8')) === expectedConsumer(scenario).replace(/\r\n/g, '\n'),
    partitionExact: cancellation ? Buffer.concat([raw, auditBytes]).equals(Buffer.from(expected)) : auditBytes.length === 0,
    receipt: readOptional(path.join(dir, 'writer-receipt.json')), owner: readOptional(path.join(dir, 'fixture-owner.json')),
    writerEvents: readEvents(path.join(dir, 'writer-events.ndjson')),
    writeProgress: readOptional(path.join(dir, 'write-progress.json')),
    fixtureError: readOptional(path.join(dir, 'fixture-error.json')),
    rendered: { ...actual, text: undefined, textHash: hash(actual.text) },
    expectedRendered: { ...renderedExpected, text: undefined, textHash: hash(renderedExpected.text) },
    renderedExact: JSON.stringify(actual) === JSON.stringify(renderedExpected),
    accepted, completed, pendingAtClose, sourceEndPending, closed, closeError, closeProbe,
    paused, readCalls, eagain, events, durationMs: round(performance.now() - started) };
  save(dir, 'summary.json', result);
  resourceTimer = setTimeout(() => {
    save(dir, 'resource-timeout.json', { resources: process.getActiveResourcesInfo(), closed, closeProbe });
    process.exit(3);
  }, settings.resourceGuardMs);
  resourceTimer.unref();
}

function assess(result) {
  const failures = [];
  const need = (value, name) => { if (!value) failures.push(name); };
  const cancellation = isCancellation(result.scenario);
  const events = result.events ?? [];
  const index = name => events.findIndex(event => event.event === name);
  const event = name => events.find(entry => entry.event === name);
  const noRead = result.scenario === 'write-no-read';
  need(!result.error && !result.timedOut && !result.fixtureError, 'driver-error-or-deadline');
  need(result.driver?.code === 0 && !result.driver?.signal && !result.driver?.hardTimeout &&
    result.driver?.stdioClosed === true, 'driver-natural-success');
  need(result.naturalExit?.code === 0, 'natural-exit-evidence');
  need(result.cleanup?.remaining?.length === 0 && result.cleanup?.errors?.length === 0, 'fixture-cleanup');
  need(result.exact && result.partitionExact && result.renderedExact, 'content-partition-and-final-state');
  need(noRead || result.receipt?.complete && result.receipt?.written === Buffer.byteLength(payload(result.scenario)) &&
    result.receipt?.hash === hash(payload(result.scenario)) && result.receipt?.token === result.token &&
    result.receipt?.pid === result.pid && result.receipt?.stdoutTTY, 'writer-receipt');
  need(result.owner?.pid === result.pid && result.owner?.token === result.token && result.owner?.stdoutTTY, 'fixture-identity');
  need(noRead ? result.exit && index('native-exit') > index('fd-close-request') :
    result.exit?.code === (result.scenario === 'natural-nonzero' ? 7 : 0) && result.exit?.signal === 0, 'main-exit');
  need(result.closed && !result.closeError && result.closeProbe === 'EBADF', 'fd-release');
  need((noRead ? result.accepted === 0 : result.accepted > 0) && result.accepted === result.completed &&
    index('consumer-barrier-complete') > index('fd-close-complete') &&
    index('terminal-dispose') > index('consumer-barrier-complete'), 'consumer-retirement-barrier');
  const sequences = name => events.filter(entry => entry.event === name).map(entry => entry.sequence).sort((a, b) => a - b);
  const expectedSequences = Array.from({ length: result.accepted ?? 0 }, (_, i) => i + 1);
  need(['consumer-enqueue', 'parser-applied', 'consumer-complete'].every(name =>
    JSON.stringify(sequences(name)) === JSON.stringify(expectedSequences)), 'consumer-one-completion-per-accepted-write');
  need(event('fd-close-request')?.pending === false && event('fd-close-request')?.callbackHeld === false, 'no-close-owned-read');
  need(events.filter(entry => entry.event === 'read-submit').every(entry => Number.isInteger(entry.capacity) && entry.capacity > 0), 'positive-read-capacity');
  if (cancellation) {
    need(result.source === 'interrupted:diagnostic-cancel' && ['read-eof', 'read-eio'].includes(result.auditSource), 'honest-cancel-source');
    need(event('receipt-before-candidate-read')?.fixtureAlive === true && event('cancel-effective')?.fixtureAlive === true, 'live-main-cancel-premise');
    need(result.receivedBytes === settings.cancelReadBytes && result.auditBytes === settings.cancelPayloadBytes - settings.cancelReadBytes, 'os-buffer-partition');
    need(index('read-submit') < index('cancel-effective') && index('reader-deliver') > index('cancel-effective') &&
      index('candidate-source-end') > index('reader-deliver') && index('audit-reader-start') > index('candidate-source-end') &&
      event('audit-reader-start')?.pending === false && event('audit-reader-start')?.callbackHeld === false, 'cancel-owned-read-order');
    need(events.filter(entry => entry.event === 'read-submit').length === 1, 'cancel-closes-new-read-admission');
    need(event('reader-deliver')?.afterCancel === true && events.some(entry => entry.event === 'audit-read-data' && entry.fixtureAlive), 'owned-vs-os-bytes');
    if (result.scenario === 'cancel-read-pending') need(event('cancel-effective')?.pending === true &&
      index('read-callback') > index('cancel-effective'), 'pending-read-premise');
    else need(event('cancel-effective')?.callbackHeld === true && index('read-callback') < index('cancel-effective') &&
      event('read-result-held')?.bytes === settings.cancelReadBytes, 'successful-held-read-premise');
  } else if (noRead) need(result.source === 'interrupted:diagnostic-no-read-control' && result.readCalls === 0 &&
    result.receivedBytes === 0 && result.auditBytes === 0, 'no-read-control-not-eof');
  else need(['read-eof', 'read-eio'].includes(result.source) && !event('cancel-effective'), 'natural-source-end');
  if (isWriteControl(result.scenario)) {
    const observed = event('write-control-observation');
    need(observed?.fixtureAlive && observed.progress?.token === result.token && observed.progress.pid === result.pid &&
      observed.ms - event('write-enter-observed')?.ms >= settings.callbackHoldMs &&
      (noRead || index('read-submit') > index('write-control-observation')), 'write-control-premise');
    need(result.writerEvents?.some(entry => entry.phase === 'enter') &&
      result.writerEvents.every(entry => entry.pid === result.pid && entry.token === result.token), 'writer-trace-identity');
    if (!noRead) need(event('write-control-exit-gate')?.deliveredBytes === settings.cancelPayloadBytes, 'released-write-completed');
  }
  if (result.scenario === 'paused-tail') need(result.paused && index('reader-resume') > index('reader-pause') &&
    events.slice(index('reader-resume') + 1).some(entry => entry.event === 'reader-deliver' && entry.bytes > 0), 'read-pause-with-unread-tail');
  if (result.scenario === 'consumer-held') need(result.pendingAtClose > 0 && result.sourceEndPending > 0 &&
    event('consumer-barrier-wait')?.pending > 0 &&
    index('consumer-notification-held') > index('parser-applied') && index('consumer-complete') > index('fd-close-complete'), 'consumer-hold-premise');
  return { pass: failures.length === 0, failures,
    classification: isWriteControl(result.scenario) ? 'write-premise-control-not-cancellation-acceptance' : 'original-tail-matrix' };
}

async function watchDriver(config, args, deadlineMs) {
  const child = spawn(process.execPath, [script, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  const logs = { stdout: '', stderr: '' };
  child.stdout.on('data', chunk => { logs.stdout += chunk; });
  child.stderr.on('data', chunk => { logs.stderr += chunk; });
  let hardTimeout = false, hardCleanup, closeTimer, closed = false;
  const timer = setTimeout(() => {
    hardTimeout = true;
    hardCleanup = cleanupFixture(config);
    child.kill('SIGKILL');
  }, deadlineMs);
  const result = await new Promise(resolve => {
    child.once('error', error => resolve({ error: error.message }));
    child.once('close', (code, signal) => { closed = true; clearTimeout(closeTimer); resolve({ code, signal, stdioClosed: true }); });
    child.once('exit', (code, signal) => {
      if (closed) return;
      closeTimer = setTimeout(() => {
        child.stdout.destroy(); child.stderr.destroy();
        resolve({ code, signal, stdioClosed: false });
      }, 100);
    });
  });
  clearTimeout(timer);
  const watchdogCleanup = hardCleanup ? await hardCleanup : undefined;
  return { ...result, hardTimeout, watchdogCleanup, logs };
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
      if (group !== owner.pid || !row.includes(script) || !row.includes(owner.configPath)) {
        result.errors.push('live-process-scope-mismatch');
      } else {
        process.kill(-owner.pid, 'SIGKILL'); result.signalled = true;
      }
    } catch (error) { if (alive(owner.pid) && error.code !== 'ESRCH') result.errors.push(String(error.message)); }
  }
  const until = performance.now() + 1000;
  while (alive(owner.pid) && performance.now() < until) await sleep(10);
  if (alive(owner.pid)) result.remaining.push(owner.pid);
  return result;
}

async function verifySaved(dir) {
  assert.deepEqual(readJSON(path.join(dir, 'schedule.json')), { settings, entries: schedule });
  const environment = readJSON(path.join(dir, 'environment.json'));
  assert.deepEqual(environment.settings, settings);
  assert(['linux', 'darwin'].includes(environment.platform));
  assert.equal(environment.scope, scope);
  assert.equal(environment.nodePty, '1.2.0-beta.12');
  assert(environment.versions?.node && environment.versions?.uv && environment.kernel && environment.arch);
  const sourceNames = ['diagnose-unix-exit-tail-v2.mjs', 'unixTerminal.js', 'xterm-headless.js', 'pty.node'];
  if (environment.platform === 'darwin') sourceNames.push('spawn-helper');
  assert.equal(environment.hashes.length, sourceNames.length);
  for (let i = 0; i < sourceNames.length; i++) {
    const source = environment.hashes[i];
    assert.equal(source.snapshot, `source-snapshot/${i}-${sourceNames[i]}`);
    assert.equal(path.basename(source.source), sourceNames[i]);
    assert.match(source.hash, /^[a-f0-9]{64}$/);
    assert.equal(hash(fs.readFileSync(path.join(dir, source.snapshot))), source.hash);
  }
  const results = readJSON(path.join(dir, 'summary.json'));
  assert.equal(results.length, schedule.length);
  const failures = [], evidenceErrors = [];
  for (let i = 0; i < schedule.length; i++) {
    const entry = schedule[i], result = results[i];
    try {
    assert.equal(sampleName(result), sampleName(entry));
    const sampleDir = path.join(dir, sampleName(entry));
    const config = readJSON(path.join(sampleDir, 'config.json'));
    assert.equal(config.scenario, entry.scenario);
    assert.equal(config.run, entry.run);
    assert.equal(config.token, result.token);
    assert.deepEqual(readJSON(path.join(sampleDir, 'native-owner.json')), { pid: result.pid, token: result.token });
    const raw = fs.readFileSync(path.join(sampleDir, 'received.bin'));
    const audit = fs.readFileSync(path.join(sampleDir, 'audit.bin'));
    assert.equal(hash(raw), result.receivedHash);
    assert.equal(raw.length, result.receivedBytes);
    assert.equal(hash(audit), result.auditHash);
    assert.equal(audit.length, result.auditBytes);
    const cancellation = isCancellation(entry.scenario);
    assert.equal(result.exact, normalize(raw.toString('utf8')) === expectedConsumer(entry.scenario).replace(/\r\n/g, '\n'));
    assert.equal(result.partitionExact, cancellation ? Buffer.concat([raw, audit]).equals(Buffer.from(payload(entry.scenario))) : audit.length === 0);
    const actual = await render(raw.toString('utf8'));
    const expected = await render(expectedConsumer(entry.scenario));
    assert.equal(result.renderedExact, JSON.stringify(actual) === JSON.stringify(expected));
    assert.deepEqual(result.rendered, withoutText(actual));
    assert.deepEqual(result.expectedRendered, withoutText(expected));
    assert.equal(fs.readFileSync(path.join(sampleDir, 'rendered.txt'), 'utf8'), actual.text);
    assert.deepEqual(result.receipt, readOptional(path.join(sampleDir, 'writer-receipt.json')));
    assert.deepEqual(result.owner, readOptional(path.join(sampleDir, 'fixture-owner.json')));
    if (result.owner) assert.equal(result.owner.configPath, path.join(config.dir, 'config.json'));
    assert.deepEqual(result.writerEvents, readEvents(path.join(sampleDir, 'writer-events.ndjson')));
    assert.deepEqual(result.writeProgress, readOptional(path.join(sampleDir, 'write-progress.json')));
    assert.deepEqual(result.fixtureError, readOptional(path.join(sampleDir, 'fixture-error.json')));
    verifyWriterTrace(result);
    assert.deepEqual(result.events, fs.readFileSync(path.join(sampleDir, 'events.ndjson'), 'utf8').trim().split('\n').map(line => JSON.parse(line)));
    const decoder = new StringDecoder('utf8');
    const decodedWrites = [];
    for (const [bytes, eventName] of [[raw, 'reader-deliver'], [audit, 'audit-read-data']]) {
      let offset = 0;
      for (const event of result.events.filter(event => event.event === eventName)) {
        assert(Number.isInteger(event.bytes) && event.bytes > 0);
        const part = bytes.subarray(offset, offset + event.bytes);
        assert.equal(part.length, event.bytes);
        assert.equal(hash(part), event.hash);
        offset += event.bytes;
        if (eventName === 'reader-deliver') {
          const text = decoder.write(part);
          if (text) decodedWrites.push(text);
        }
      }
      assert.equal(offset, bytes.length);
    }
    const decoderTail = decoder.end();
    if (decoderTail) decodedWrites.push(decoderTail);
    assert.deepEqual(result.events.filter(event => event.event === 'consumer-enqueue').map(event =>
      ({ sequence: event.sequence, bytes: event.bytes, hash: event.hash })), decodedWrites.map((text, index) =>
      ({ sequence: index + 1, bytes: Buffer.byteLength(text), hash: hash(text) })));
    assert.deepEqual(result.driver, readJSON(path.join(sampleDir, 'driver-exit.json')));
    assert.deepEqual(result.cleanup, readJSON(path.join(sampleDir, 'cleanup.json')));
    assert.deepEqual(result.naturalExit, readOptional(path.join(sampleDir, 'natural-exit.json')));
    assert.deepEqual(result.assessment, assess(result));
    if (!result.assessment.pass) failures.push(sampleName(result));
    } catch (error) {
      evidenceErrors.push({ sample: sampleName(entry), message: error.message });
    }
  }
  console.log(JSON.stringify({ attempted: results.length, verified: results.length - evidenceErrors.length,
    failures, evidenceErrors, note: 'Offline evidence verification, not new native execution.' }));
  if (failures.length || evidenceErrors.length) process.exitCode = 1;
}

async function selfTest() {
  assert.equal(schedule.length, 27);
  assert.equal(new Set(schedule.map(sampleName)).size, 27);
  assert.equal(Buffer.byteLength(payload('cancel-read-pending')), 2048);
  assert.equal(normalize('a\r\r\nb\r\n'), 'a\nb\n');
  assert.notEqual(normalize('a\rb\n'), 'ab\n');
  const full = await render('HEAD\r\nTAIL\r\n');
  assert.notDeepEqual(await render('HEAD\r\nTAIL'), full);
  assert.equal(assess({ scenario: 'natural-zero' }).pass, false);
  assert.equal(assess({ scenario: 'cancel-read-pending', source: 'read-eof' }).pass, false);
  assert.throws(() => readCapacity('paused-tail', false, settings.pauseLine * Buffer.byteLength('DSC_TAIL_00001_0123456789\n')));
  const crReplay = Buffer.from(payload('paused-tail').replace(/\n/g, '\r\r\n'));
  let offset = 0, logical = 0, paused = false, tail = '';
  while (offset < crReplay.length) {
    const capacity = readCapacity('paused-tail', paused, logical);
    assert(capacity > 0 && capacity <= settings.readBytes);
    const part = crReplay.subarray(offset, offset + capacity);
    logical += nonCrBytes(part); offset += part.length;
    const boundary = tail + part.toString('ascii');
    tail = boundary.slice(-100);
    if (!paused && boundary.includes(`DSC_TAIL_${settings.pauseLine}_`)) {
      paused = true;
      assert(offset < crReplay.length, 'The pause must precede unread tail');
    }
  }
  assert(paused);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsc-unix-tail-watchdog-'));
  for (const fixture of [false, true]) {
    const sampleDir = path.join(dir, fixture ? 'with-fixture' : 'blocked-preflight');
    fs.mkdirSync(sampleDir);
    const config = { dir: sampleDir, token: randomUUID() };
    save(sampleDir, 'config.json', config);
    let fixtureExit;
    if (fixture) {
      // The controller owns this non-PTY control so it can independently reap it too.
      const child = spawn(process.execPath, [script, '--watchdog-fixture', path.join(sampleDir, 'config.json')],
        { detached: true, stdio: 'ignore' });
      fixtureExit = new Promise(resolve => child.once('close', resolve));
      const until = performance.now() + 1000;
      while (!fs.existsSync(path.join(sampleDir, 'fixture-owner.json')) && performance.now() < until) await sleep(5);
      assert(fs.existsSync(path.join(sampleDir, 'fixture-owner.json')), 'Watchdog fixture did not start');
    }
    const result = await watchDriver(config, ['--watchdog-block', path.join(sampleDir, 'config.json')], 1000);
    if (fixtureExit) await fixtureExit;
    save(sampleDir, 'driver-exit.json', result);
    assert.equal(result.hardTimeout, true);
    assert.equal(result.signal, 'SIGKILL');
    const cleanup = await cleanupFixture(config);
    save(sampleDir, 'cleanup.json', cleanup);
    if (fixture) assert(readOptional(path.join(sampleDir, 'fixture-owner.json')), 'Watchdog cleanup fixture must have launched');
    assert.equal(cleanup.remaining.length, 0);
    assert.equal(cleanup.errors.length, 0);
  }
  console.log(JSON.stringify({ selfTest: 'passed', ptyLaunched: false, watchdogEvidence: dir,
    scope: 'real subprocess watchdog and scoped cleanup; no native PTY evidence' }));
}

function watchdogBlock() {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30000);
}

async function watchdogFixture(config) {
  save(config.dir, 'fixture-owner.json', { pid: process.pid, token: config.token,
    configPath: path.join(config.dir, 'config.json'), watchdogOnly: true });
  await sleep(30000);
}

async function render(text) {
  const { Terminal } = require('@xterm/headless');
  const terminal = new Terminal({ cols: settings.cols, rows: settings.rows, scrollback: settings.scrollback, allowProposedApi: true });
  let title = '';
  terminal.onTitleChange(value => { title = value; });
  try { await new Promise(resolve => terminal.write(text, resolve)); return snapshot(terminal, title); }
  finally { terminal.dispose(); }
}
function snapshot(terminal, title) {
  const buffer = terminal.buffer.active;
  const lines = Array.from({ length: buffer.length }, (_, i) => buffer.getLine(i).translateToString(true));
  return { text: lines.join('\n'), cursorX: buffer.cursorX, cursorLine: buffer.baseY + buffer.cursorY, title };
}
function withoutText(value) { const { text, ...state } = value; return { ...state, textHash: hash(text) }; }
function isCancellation(scenario) { return scenario.startsWith('cancel-'); }
function isWriteControl(scenario) { return scenario.startsWith('write-'); }
function isWriteProbe(scenario) { return isCancellation(scenario) || isWriteControl(scenario); }
function nonCrBytes(bytes) { let count = 0; for (const byte of bytes) if (byte !== 13) count++; return count; }
function readCapacity(scenario, paused, logicalBytes) {
  const untilPause = scenario === 'paused-tail' && !paused
    ? settings.pauseLine * Buffer.byteLength('DSC_TAIL_00001_0123456789\n') - logicalBytes : settings.readBytes;
  const capacity = isCancellation(scenario) ? settings.cancelReadBytes : Math.min(settings.readBytes, untilPause);
  assert(Number.isInteger(capacity) && capacity > 0, 'A zero-length read is not an EOF probe');
  return capacity;
}
function expectedConsumer(scenario) {
  if (scenario === 'write-no-read') return '';
  return isCancellation(scenario) ? 'C'.repeat(settings.cancelReadBytes) : payload(scenario).replace(/\n/g, '\r\n');
}
function readEvents(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
}
function verifyWriterTrace(result) {
  let call = 0, written = 0, pending = false;
  for (const entry of result.writerEvents) {
    assert.equal(entry.token, result.token);
    assert.equal(entry.pid, result.pid);
    assert.match(entry.monotonicNs, /^\d+$/);
    if (entry.phase === 'enter') {
      assert(!pending);
      assert.equal(entry.call, ++call);
      assert.equal(entry.written, written);
      assert.equal(entry.requested, settings.cancelPayloadBytes - written);
      pending = true;
    } else {
      assert(pending);
      assert.equal(entry.call, call);
      if (entry.phase === 'returned') {
        assert(Number.isInteger(entry.count) && entry.count > 0 && written + entry.count <= settings.cancelPayloadBytes);
        written += entry.count;
      } else assert.equal(entry.phase, 'error');
      assert.equal(entry.written, written);
      pending = false;
    }
  }
  assert.deepEqual(result.writeProgress, result.writerEvents.at(-1) ?? null);
  if (isWriteProbe(result.scenario) && result.receipt?.complete) {
    assert(!pending);
    assert.equal(written, settings.cancelPayloadBytes);
  }
}
function sampleName(entry) { return `${entry.scenario}-${entry.run}`; }
function normalize(text) { return text.replace(/\r+\n/g, '\n'); }
function alive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
function hash(value) { return createHash('sha256').update(value).digest('hex'); }
function readJSON(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function readOptional(file) { return fs.existsSync(file) ? readJSON(file) : null; }
function save(dir, file, value) {
  const destination = path.join(dir, file);
  const temporary = `${destination}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(temporary, destination);
}
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function round(value) { return Math.round(value * 1000) / 1000; }
