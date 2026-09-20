import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { StringDecoder } from 'node:string_decoder';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: {
  output: { type: 'string' },
  'verify-saved': { type: 'string' },
  'self-test': { type: 'boolean', default: false }
} });
const settings = Object.freeze({ runs: 3, lines: 90000, readBytes: 65536,
  idleMs: 2, pauseMs: 350, exitDeadlineMs: 1000, sampleDeadlineMs: 30000 });
const cases = ['natural-zero', 'natural-nonzero', 'paused-tail', 'split-unicode',
  'descendant-tail', 'descendant-held', 'signal-stop'];
const readers = ['stock', 'owned-async'];
const require = createRequire(import.meta.url);

if (values['self-test']) {
  assert.equal(normalize('a\r\r\nb\r\n'), 'a\nb\n');
  for (const text of ['a\rX\nb\n', 'a\n\nb\n', 'a\nb', 'a\n']) {
    assert.notEqual(normalize(text), 'a\nb\n');
  }
  const decoder = new StringDecoder('utf8');
  const bytes = Buffer.from('\u4e2d\u{1f642}');
  assert.equal(decoder.write(bytes.subarray(0, 2)), '');
  assert.equal(decoder.write(bytes.subarray(2, 5)), '\u4e2d');
  assert.equal(decoder.write(bytes.subarray(5)) + decoder.end(), '\u{1f642}');
  for (const scenario of cases) assert.equal(typeof fixture(scenario, '/tmp/receipt').command, 'string');
  assert.equal(assess({ scenario: 'descendant-held', reader: 'owned-async',
    source: 'exit-deadline', exact: true, exit: { code: 0, signal: 0 }, timedOut: false, fdClosed: true }).pass, true);
  assert.equal(assess({ scenario: 'natural-zero', reader: 'owned-async',
    source: 'exit-deadline', exact: true, receipt: 'complete:0', exit: { code: 0 }, timedOut: false }).pass, false);
  assert.equal(assess({ scenario: 'natural-zero', reader: 'owned-async',
    source: 'read-eio', exact: false, receipt: 'complete:0', exit: { code: 0 }, timedOut: false }).pass, false);
  const complete = { reader: 'owned-async', source: 'read-eio', exact: true,
    receipt: 'complete:0', exit: { code: 0, signal: 0 }, fdClosed: true };
  assert.equal(assess({ ...complete, scenario: 'paused-tail', paused: false }).pass, false);
  assert.equal(assess({ ...complete, scenario: 'paused-tail', paused: true }).pass, true);
  assert.equal(assess({ ...complete, scenario: 'signal-stop', exit: { code: 7 }, stopSent: false }).pass, false);
  assert.equal(assess({ ...complete, scenario: 'signal-stop', exit: { code: 7 }, stopSent: true }).pass, true);
  console.log('Reader comparison analyzer self-test passed. No PTY launched.');
} else if (values['verify-saved']) {
  const dir = path.resolve(values['verify-saved']);
  const results = JSON.parse(fs.readFileSync(path.join(dir, 'summary.json'), 'utf8'));
  assert.equal(results.length, cases.length * settings.runs * readers.length);
  const keys = new Set(results.map(r => `${r.scenario}:${r.run}:${r.reader}`));
  assert.equal(keys.size, results.length);
  for (const scenario of cases) for (let run = 1; run <= settings.runs; run++) for (const reader of readers) {
    assert(keys.has(`${scenario}:${run}:${reader}`));
  }
  for (const result of results) {
    const content = fs.readFileSync(path.join(dir, `${result.scenario}-${result.run}-${result.reader}`, 'raw.txt'), 'utf8');
    assert.equal(hash(content), result.hash);
    assert.equal(result.exact, normalize(content) === normalize(fixture(result.scenario, '/unused').expected));
    if (result.reader === 'owned-async') assert(assess(result).pass, JSON.stringify(result));
  }
  console.log(`Saved evidence verified: ${results.length} samples, content hashes and candidate gates. No PTY launched.`);
} else {
  assert(['linux', 'darwin'].includes(process.platform), 'This isolated candidate requires Unix.');
  assert(values.output, '--output must name a new evidence directory');
  const output = path.resolve(values.output);
  assert(!fs.existsSync(output), `Refusing to overwrite evidence: ${output}`);
  fs.mkdirSync(output, { recursive: true });
  const pty = require('node-pty');
  const nativeInfo = require('node-pty/lib/utils').loadNativeModule('pty');
  const helper = path.resolve(path.dirname(require.resolve('node-pty/lib/unixTerminal')), nativeInfo.dir, 'spawn-helper');
  const sourceFiles = [import.meta.filename, require.resolve('node-pty/lib/unixTerminal'),
    path.resolve(path.dirname(require.resolve('node-pty/lib/unixTerminal')), nativeInfo.dir, 'pty.node')];
  const environment = { executable: process.execPath, versions: process.versions,
    platform: process.platform, arch: process.arch, kernel: os.release(),
    ptyVersion: require('node-pty/package.json').version, settings, cases, readers,
    sourceHashes: Object.fromEntries(sourceFiles.map(file => [file, hash(fs.readFileSync(file))])),
    github: { sha: process.env.GITHUB_SHA, runId: process.env.GITHUB_RUN_ID,
      attempt: process.env.GITHUB_RUN_ATTEMPT, image: process.env.ImageOS, imageVersion: process.env.ImageVersion },
    scope: 'isolated Unix PTY; no Host, Supervisor, Webview, or production adapter changes' };
  fs.writeFileSync(path.join(output, 'environment.json'), JSON.stringify(environment, null, 2));
  const results = [];
  fs.writeFileSync(path.join(output, 'schedule.json'), JSON.stringify({ settings, cases, readers }, null, 2));
  // The complete schedule is fixed before the first spawn, including failing baseline samples.
  for (const scenario of cases) for (let run = 1; run <= settings.runs; run++) for (const reader of readers) {
    const dir = path.join(output, `${scenario}-${run}-${reader}`);
    fs.mkdirSync(dir);
    const result = await sample({ scenario, run, reader, dir, pty, nativeInfo, helper });
    results.push(result);
    fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(results, null, 2));
    console.log(JSON.stringify({ scenario, run, reader, exact: result.exact,
      source: result.source, receipt: result.receipt, exit: result.exit,
      pass: result.assessment.pass, durationMs: result.durationMs }));
  }
  assert.equal(results.length, cases.length * settings.runs * readers.length);
  const failures = results.filter(r => r.reader === 'owned-async' && !r.assessment.pass);
  const remaining = fixtureGroupMembers(results.map(r => r.pid));
  fs.writeFileSync(path.join(output, 'cleanup.json'), JSON.stringify({ remaining }, null, 2));
  assert.equal(remaining.length, 0, 'Fixture process group members remain after cleanup');
  console.log(JSON.stringify({ evidence: output, samples: results.length,
    candidateFailures: failures.length, baselineContentMismatches: results.filter(r => r.reader === 'stock' && !r.exact).length,
    scope: environment.scope }));
  if (failures.length) process.exitCode = 1;
}

async function sample({ scenario, run, reader, dir, pty, nativeInfo, helper }) {
  const receiptPath = path.join(dir, 'writer-receipt.txt');
  const spec = fixture(scenario, receiptPath);
  const started = performance.now();
  const events = [];
  const raw = [];
  const decoder = new StringDecoder('utf8');
  const buffer = Buffer.alloc(settings.readBytes);
  const loop = monitorEventLoopDelay({ resolution: 10 });
  const cpuStart = process.cpuUsage();
  let exit, source, terminal, fd, pid;
  let closed = false, closing = false, pending = false, timedOut = false;
  let idleTimer, exitTimer, deadlineTimer, hardDeadlineTimer, paused = false, pauseUntil = 0, stopSent = false;
  let tail = '', chunks = 0, readCalls = 0, eagain = 0, bytesAfterExit = 0;
  let resolveDone;
  const done = new Promise(resolve => { resolveDone = resolve; });
  const mark = (event, detail = {}) => events.push({ ms: round(performance.now() - started), event, ...detail });
  const settle = () => { if (exit && closed) resolveDone(); };
  const signalGroup = signal => {
    assert(pid > 0 && pid !== process.pid);
    try { process.kill(-pid, signal); mark('fixture-group-signal', { signal }); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  };
  const onData = chunk => {
    raw.push(chunk);
    chunks++;
    if (exit) bytesAfterExit += Buffer.byteLength(chunk);
    const boundary = tail + chunk;
    tail = boundary.slice(-160);
    if (scenario === 'paused-tail' && !paused && boundary.includes('DSC_COMPLETED_STREAM_89800_')) {
      paused = true;
      pauseUntil = performance.now() + settings.pauseMs;
      mark('injected-reader-pause', { durationMs: settings.pauseMs });
      if (reader === 'stock') {
        terminal.pause();
        idleTimer = setTimeout(() => { mark('reader-resume'); terminal.resume(); }, settings.pauseMs);
      }
    }
    if (scenario === 'signal-stop' && !stopSent && boundary.includes('READY')) {
      stopSent = true;
      mark('fixture-stop-request', { signal: 'SIGTERM' });
      process.kill(pid, 'SIGTERM');
    }
  };
  const onProcessExit = (code, signal) => {
    exit = { code, signal };
    mark('native-exit', exit);
    if (reader === 'owned-async' && !source) exitTimer = setTimeout(() => {
      finishSource('exit-deadline');
      signalGroup('SIGKILL');
    }, settings.exitDeadlineMs);
    settle();
  };
  const closeFd = () => {
    if (pending || closing || closed) return;
    closing = true;
    fs.close(fd, error => {
      closed = true;
      mark('owned-fd-close', { error: error?.code });
      if (error) source = 'close-error';
      settle();
    });
  };
  const finishSource = reason => {
    if (source) return;
    source = reason;
    clearTimeout(idleTimer);
    clearTimeout(exitTimer);
    // This prototype never shares a master with tty.ReadStream and never reads after cancellation.
    if (reason === 'read-eof' || reason === 'read-eio') {
      const last = decoder.end();
      if (last) onData(last);
    }
    mark('source-ended', { reason });
    closeFd();
  };
  const readNext = () => {
    if (source) { closeFd(); return; }
    const pauseRemaining = pauseUntil - performance.now();
    if (pauseRemaining > 0) { idleTimer = setTimeout(readNext, pauseRemaining); return; }
    assert(!pending, 'Only one read may own the fd');
    pending = true;
    readCalls++;
    fs.read(fd, buffer, 0, buffer.length, null, (error, count) => {
      pending = false;
      if (source) { mark('read-cancelled', { count, error: error?.code }); closeFd(); return; }
      if (error?.code === 'EAGAIN' || error?.code === 'EWOULDBLOCK') {
        eagain++;
        idleTimer = setTimeout(readNext, settings.idleMs);
      } else if (error?.code === 'EINTR') {
        setImmediate(readNext);
      } else if (error) {
        finishSource(error.code === 'EIO' ? 'read-eio' : `read-error:${error.code}`);
      } else if (count === 0) {
        finishSource('read-eof');
      } else {
        const chunk = decoder.write(buffer.subarray(0, count));
        if (chunk) onData(chunk);
        setImmediate(readNext);
      }
    });
  };
  loop.enable();
  try {
    const env = { ...process.env, TERM: 'xterm-256color', LANG: 'C.UTF-8', HISTFILE: '/dev/null' };
    const args = ['--noprofile', '--norc', '-c', spec.command];
    if (reader === 'stock') {
      const originalFork = nativeInfo.module.fork;
      nativeInfo.module.fork = function (...args) {
        const originalExit = args.at(-1);
        args[args.length - 1] = (code, signal) => { onProcessExit(code, signal); originalExit(code, signal); };
        return originalFork.apply(this, args);
      };
      try { terminal = pty.spawn('/bin/bash', args, { cols: 96, rows: 28, cwd: dir, env }); }
      finally { nativeInfo.module.fork = originalFork; }
      pid = terminal.pid;
      terminal.onData(onData);
      terminal._socket.on('end', () => mark('stock-socket-end'));
      terminal._socket.on('error', error => mark('stock-socket-error', { code: error.code }));
      const destroy = terminal._socket.destroy;
      terminal._socket.destroy = function (...args) {
        mark('stock-socket-destroy', { readableLength: this.readableLength, stack: new Error().stack });
        return destroy.apply(this, args);
      };
      terminal.onExit(event => {
        source = 'legacy-unverified-close';
        closed = true;
        mark('stock-on-exit', event);
        settle();
      });
    } else {
      const term = nativeInfo.module.fork('/bin/bash', args,
        Object.entries(env).filter(([, value]) => value !== undefined).map(([key, value]) => `${key}=${value}`),
        dir, 96, 28, -1, -1, true, helper, onProcessExit);
      ({ fd, pid } = term);
      readNext();
    }
    mark('spawn', { pid, reader });
    deadlineTimer = setTimeout(() => {
      timedOut = true;
      mark('sample-deadline');
      if (reader === 'owned-async') finishSource('sample-deadline');
      else terminal.destroy();
      signalGroup('SIGKILL');
    }, settings.sampleDeadlineMs);
    // Independent of provider callbacks: a broken exit/close contract must not hang this probe.
    hardDeadlineTimer = setTimeout(() => {
      mark('hard-cleanup-deadline');
      signalGroup('SIGKILL');
      fs.writeFileSync(path.join(dir, 'incomplete.json'), JSON.stringify({ scenario, reader, pid, exit, source, events }, null, 2));
      fs.writeFileSync(path.join(dir, 'raw.txt'), raw.join(''));
      process.exit(2);
    }, settings.sampleDeadlineMs + 2000);
    await done;
    clearTimeout(deadlineTimer);
    if (scenario === 'descendant-tail') await waitForFile(receiptPath, 2000);
  } finally {
    clearTimeout(idleTimer);
    clearTimeout(exitTimer);
    clearTimeout(deadlineTimer);
    clearTimeout(hardDeadlineTimer);
    if (pid) signalGroup('SIGKILL');
    if (reader === 'owned-async' && fd !== undefined && !closed) finishSource('fixture-cleanup');
    loop.disable();
  }
  const content = raw.join('');
  const receipt = fs.existsSync(receiptPath) ? fs.readFileSync(receiptPath, 'utf8').trim() : null;
  const result = { scenario, run, reader, pid, source, exit, timedOut,
    exact: normalize(content) === normalize(spec.expected), rawExact: content === spec.expected,
    extraCRBeforeLF: [...content.matchAll(/\r{2,}\n/g)].reduce((n, match) => n + match[0].length - 2, 0),
    bytes: Buffer.byteLength(content), hash: hash(content),
    expectedBytes: Buffer.byteLength(spec.expected), expectedHash: hash(spec.expected),
    receipt, chunks, readCalls, eagain, bytesAfterExit, paused, stopSent,
    durationMs: round(performance.now() - started), cpuMicros: process.cpuUsage(cpuStart),
    eventLoopP99Ms: round(loop.percentile(99) / 1e6), eventLoopMaxMs: round(loop.max / 1e6),
    fdClosed: closed, events };
  result.assessment = assess(result);
  fs.writeFileSync(path.join(dir, 'raw.txt'), content);
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(result, null, 2));
  return result;
}

function fixture(scenario, receiptPath) {
  const receipt = `printf 'complete:%s\\n' "$failed" > ${quote(receiptPath)}`;
  if (['natural-zero', 'natural-nonzero', 'paused-tail'].includes(scenario)) {
    const exitCode = scenario === 'natural-nonzero' ? 7 : 0;
    return { command: `failed=0; i=1; while [ "$i" -le ${settings.lines} ]; do ` +
      `printf 'DSC_COMPLETED_STREAM_%05d_%032d\\n' "$i" 0 || failed=1; i=$((i+1)); done; ${receipt}; exit ${exitCode}`,
    expected: Array.from({ length: settings.lines }, (_, i) =>
      `DSC_COMPLETED_STREAM_${String(i + 1).padStart(5, '0')}_${'0'.repeat(32)}\r\n`).join('') };
  }
  if (scenario === 'split-unicode') return {
    command: `failed=0; printf 'UNICODE:\\xe4\\xb8' || failed=1; sleep 0.03; ` +
      `printf '\\xad\\xf0\\x9f' || failed=1; sleep 0.03; printf '\\x99\\x82\\n\\033[3' || failed=1; ` +
      `sleep 0.03; printf '1mRED\\033[0m\\n\\033]0;title' || failed=1; sleep 0.03; ` +
      `printf '\\007DONE\\n' || failed=1; ${receipt}; exit 0`,
    expected: 'UNICODE:\u4e2d\u{1f642}\r\n\x1b[31mRED\x1b[0m\r\n\x1b]0;title\x07DONE\r\n'
  };
  if (scenario === 'descendant-tail') return {
    command: `trap '' HUP; (sleep 0.35; failed=0; printf 'CHILD_TAIL\\n' || failed=1; ${receipt}) & ` +
      `printf 'PARENT\\n'; exit 0`, expected: 'PARENT\r\nCHILD_TAIL\r\n'
  };
  if (scenario === 'descendant-held') return {
    command: "trap '' HUP; (sleep 1.5) & printf 'PARENT\\n'; exit 0", expected: 'PARENT\r\n'
  };
  assert.equal(scenario, 'signal-stop');
  return { command: `failed=0; trap ${quote(`sleep 0.03; printf 'STOP_TAIL\\n' || failed=1; ${receipt}; exit 7`)} TERM; ` +
    "printf 'READY\\n'; while :; do sleep 0.01; done", expected: 'READY\r\nSTOP_TAIL\r\n' };
}

function assess(result) {
  if (result.reader === 'stock') return { pass: null, note: 'baseline observation, not an integrity guarantee' };
  const held = result.scenario === 'descendant-held';
  const sourceOK = held ? result.source === 'exit-deadline' : ['read-eio', 'read-eof'].includes(result.source);
  const exitCode = ['natural-nonzero', 'signal-stop'].includes(result.scenario) ? 7 : 0;
  const injected = (result.scenario !== 'paused-tail' || result.paused === true) &&
    (result.scenario !== 'signal-stop' || result.stopSent === true);
  return { pass: !result.timedOut && result.fdClosed === true && injected && sourceOK && result.exact && result.exit?.code === exitCode &&
    (!result.exit?.signal) && (held || result.receipt === 'complete:0'),
  note: held ? 'explicit cancellation; never classify as drained' : 'content + writer receipt + actual read termination' };
}

async function waitForFile(file, timeoutMs) {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    if (fs.existsSync(file) && fs.readFileSync(file, 'utf8').endsWith('\n')) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

function fixtureGroupMembers(pids) {
  const groups = new Set(pids);
  return execFileSync('ps', ['-eo', 'pid=,ppid=,pgid=,stat=,args='], { encoding: 'utf8' })
    .trim().split('\n').map(line => line.trim().split(/\s+/)).filter(fields => groups.has(Number(fields[2])));
}

function quote(value) { return `'${value.replaceAll("'", "'\\''")}'`; }
function normalize(text) { return text.replace(/\r+\n/g, '\n'); }
function hash(value) { return createHash('sha256').update(value).digest('hex'); }
function round(value) { return Math.round(value * 1000) / 1000; }
