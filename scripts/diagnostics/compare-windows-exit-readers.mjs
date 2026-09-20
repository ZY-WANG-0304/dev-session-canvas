import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { Worker } from 'node:worker_threads';

const require = createRequire(import.meta.url);
const scriptPath = fileURLToPath(import.meta.url);
const workerURL = new URL('./runtime-exit-conout-worker.mjs', import.meta.url);
const settings = Object.freeze({ runs: 3, lines: 90000, pauseMs: 1500,
  descendantTailMs: 1500, heldMs: 5000, exitDeadlineMs: 2500,
  sampleMs: 30000, hardMs: 35000, resourceGuardMs: 2000, cols: 120, rows: 40, scrollback: 100000 });
const cases = ['natural-zero', 'natural-nonzero', 'paused-tail', 'split-unicode',
  'descendant-tail', 'descendant-held', 'cooperative-stop'];
const readers = ['stock-builtin', 'stock-dll', 'owned-dll'];
const { values } = parseArgs({ options: { output: { type: 'string' },
  'self-test': { type: 'boolean' }, sample: { type: 'string' }, 'verify-saved': { type: 'string' } } });

if (values['self-test']) await selfTest();
else if (values['verify-saved']) await verifySaved(path.resolve(values['verify-saved']));
else if (values.sample) await runSample(JSON.parse(fs.readFileSync(values.sample, 'utf8')));
else await runSchedule();

async function runSchedule() {
  assert.equal(process.platform, 'win32', 'Native ConPTY experiment requires Windows');
  assert(values.output, '--output must name a new directory');
  const dir = path.resolve(values.output);
  assert(!fs.existsSync(dir), 'Refusing to overwrite evidence');
  fs.mkdirSync(dir, { recursive: true });
  const native = require('node-pty/lib/utils').loadNativeModule('conpty');
  const lib = path.dirname(require.resolve('node-pty/lib/windowsPtyAgent'));
  const sources = [scriptPath, fileURLToPath(workerURL), require.resolve('node-pty/lib/windowsPtyAgent'),
    require.resolve('node-pty/lib/windowsConoutConnection'), require.resolve('node-pty/lib/worker/conoutSocketWorker'),
    path.resolve(lib, native.dir, 'conpty.node'), path.resolve(lib, native.dir, 'conpty/conpty.dll')];
  save(dir, 'environment.json', { settings, platform: process.platform, arch: process.arch,
    release: os.release(), versions: process.versions, executable: process.execPath,
    nodePty: require('node-pty/package.json').version,
    hashes: Object.fromEntries(sources.map(file => [file, hash(fs.readFileSync(file))])),
    github: { sha: process.env.GITHUB_SHA, runId: process.env.GITHUB_RUN_ID,
      attempt: process.env.GITHUB_RUN_ATTEMPT, image: process.env.ImageOS, imageVersion: process.env.ImageVersion },
    scope: 'isolated native candidate; no production integration or zero-handle proof' });
  const schedule = cases.flatMap(scenario => Array.from({ length: settings.runs }, (_, i) =>
    readers.map(reader => ({ scenario, run: i + 1, reader })))).flat();
  save(dir, 'schedule.json', schedule);
  const results = [];
  for (const entry of schedule) {
    const sampleDir = path.join(dir, `${entry.scenario}-${entry.run}-${entry.reader}`);
    fs.mkdirSync(sampleDir);
    const configPath = path.join(sampleDir, 'config.json');
    save(sampleDir, 'config.json', { ...entry, dir: sampleDir });
    const child = spawn(process.execPath, [scriptPath, '--sample', configPath], { stdio: ['ignore', 'pipe', 'pipe'] });
    const logs = { stdout: '', stderr: '' };
    child.stdout.on('data', chunk => { logs.stdout += chunk; });
    child.stderr.on('data', chunk => { logs.stderr += chunk; });
    let hardTimeout = false;
    const timer = setTimeout(() => { hardTimeout = true; child.kill(); }, settings.hardMs);
    const childExit = await new Promise(resolve => {
      child.on('error', error => resolve({ error: error.message }));
      child.on('close', (code, signal) => resolve({ code, signal }));
    });
    clearTimeout(timer);
    save(sampleDir, 'driver-exit.json', { ...childExit, hardTimeout, logs });
    const result = readJSON(path.join(sampleDir, 'summary.json')) ?? { ...entry, error: 'No sample summary' };
    result.driver = { ...childExit, hardTimeout };
    result.naturalExit = readJSON(path.join(sampleDir, 'natural-exit.json'));
    result.resourceTimeout = readJSON(path.join(sampleDir, 'resource-timeout.json'));
    result.cleanup = await cleanupFixture(sampleDir);
    result.assessment = assess(result);
    results.push(result);
    save(dir, 'summary.json', results);
    console.log(JSON.stringify({ ...entry, source: result.source, exit: result.exit,
      content: result.contentMatched, naturalExit: Boolean(result.naturalExit), pass: result.assessment.pass }));
  }
  assert.equal(results.length, 63);
  const failures = results.filter(r => r.reader === 'owned-dll' && !r.assessment.pass);
  console.log(JSON.stringify({ samples: results.length, candidateFailures: failures.length,
    baselineResourceTimeouts: results.filter(r => r.reader !== 'owned-dll' && r.resourceTimeout).length }));
  if (failures.length || results.some(r => r.cleanup.remaining.length || r.driver.hardTimeout || r.error)) process.exitCode = 1;
}

async function runSample(config) {
  assert.equal(process.platform, 'win32');
  const { scenario, reader, dir } = config;
  assert(cases.includes(scenario) && readers.includes(reader));
  const started = performance.now();
  const events = [];
  const raw = [];
  const mark = (event, details = {}) => events.push({ ms: Math.round(performance.now() - started), event, ...details });
  const receiptPath = path.join(dir, 'writer-receipt.json');
  const fixturePath = path.join(dir, 'fixture.cjs');
  fs.writeFileSync(fixturePath, fixture(scenario, dir));
  let terminal, worker, input, exit, source, sampleTimer, exitTimer, pauseTimer;
  let paused = false, stopped = false, timedOut = false, tail = '', pid = 0, nativeId;
  let resolveDone;
  const done = new Promise(resolve => { resolveDone = resolve; });
  const decoder = new StringDecoder('utf8');
  const settle = () => { if (exit && source) resolveDone(); };
  const output = text => {
    raw.push(text);
    const boundary = tail + text;
    tail = boundary.slice(-200);
    if (scenario === 'cooperative-stop' && !stopped && boundary.includes('READY')) {
      stopped = true;
      mark('cooperative-stop-request');
      if (reader === 'owned-dll') input.write('q');
      else terminal.write('q');
    }
    if (reader !== 'owned-dll' && scenario === 'paused-tail' && !paused && boundary.includes('DSC_WIN_LINE_89800')) {
      paused = true;
      mark('reader-pause', { durationMs: settings.pauseMs });
      terminal.pause();
      pauseTimer = setTimeout(() => { mark('reader-resume'); terminal.resume(); }, settings.pauseMs);
    }
  };
  const finishSource = reason => {
    if (source) return;
    source = reason;
    clearTimeout(exitTimer);
    mark('source-ended', { reason });
    if (reader === 'owned-dll') input?.destroy();
    settle();
  };
  const interrupt = reason => {
    if (source) return;
    finishSource(reason);
    worker?.postMessage('cancel');
    for (const fixturePid of knownPids(dir)) {
      try { process.kill(fixturePid); mark('fixture-kill', { pid: fixturePid }); }
      catch (error) { mark('fixture-kill-result', { pid: fixturePid, code: error.code }); }
    }
  };
  const onProcess = code => {
    exit = { code };
    const childPid = readJSON(path.join(dir, 'child-pid.json'))?.pid;
    let childAlive = false;
    if (childPid) { try { process.kill(childPid, 0); childAlive = true; } catch { /* recorded as not alive */ } }
    mark('native-process-exit', { ...exit, childPid, childAlive });
    if (reader === 'owned-dll' && !source) exitTimer = setTimeout(() => interrupt('exit-deadline'), settings.exitDeadlineMs);
    settle();
  };
  const resources = () => process.getActiveResourcesInfo();
  process.on('beforeExit', code => save(dir, 'natural-exit.json', { code, events, resources: resources() }));
  process.on('exit', code => save(dir, 'process-exit.json', { code, events, resources: resources() }));
  try {
    sampleTimer = setTimeout(() => {
      timedOut = true;
      mark('sample-deadline');
      interrupt('sample-deadline');
      resolveDone();
    }, settings.sampleMs);
    if (reader === 'owned-dll') {
      const native = require('node-pty/lib/utils').loadNativeModule('conpty').module;
      const { argsToCommandLine } = require('node-pty/lib/windowsPtyAgent');
      const term = native.startProcess(process.execPath, settings.cols, settings.rows, false,
        `dsc-probe-${process.pid}-${Date.now()}`, false, true);
      nativeId = term.pty;
      input = new net.Socket({ fd: fs.openSync(term.conin, 'w'), readable: false, writable: true });
      input.on('error', error => mark('input-error', { code: error.code, message: error.message }));
      worker = new Worker(workerURL, { workerData: { pipe: term.conout,
        pauseMarker: scenario === 'paused-tail' ? 'DSC_WIN_LINE_89800' : null, pauseMs: settings.pauseMs } });
      worker.on('error', error => { mark('worker-error', { message: error.message }); interrupt('worker-error'); });
      worker.on('exit', code => { mark('worker-exit', { code }); });
      worker.on('message', message => {
        if (message.event === 'data') { output(decoder.write(Buffer.from(message.bytes))); return; }
        mark(message.event, message);
        if (message.event === 'ready') {
          try {
            const connected = native.connect(nativeId, argsToCommandLine(process.execPath, [fixturePath]), dir,
              Object.entries(process.env).map(([key, value]) => `${key}=${value}`), true, onProcess);
            pid = connected.pid;
            save(dir, 'parent-pid.json', { pid });
            mark('native-connected', { pid });
          } catch (error) {
            mark('connect-error', { message: error.message });
            interrupt('connect-error');
            resolveDone();
          }
        } else if (message.event === 'reader-pause') paused = true;
        else if (message.event === 'pipe-end' && !source) {
          output(decoder.end());
          finishSource('pipe-eof');
        } else if (message.event === 'pipe-error' && !source) interrupt('pipe-error');
        else if (message.event === 'pipe-close' && !message.ended && !source) interrupt('pipe-close-without-eof');
      });
    } else {
      const { WindowsPtyAgent } = require('node-pty/lib/windowsPtyAgent');
      const original = WindowsPtyAgent.prototype._$onProcessExit;
      WindowsPtyAgent.prototype._$onProcessExit = function (code) { onProcess(code); return original.call(this, code); };
      terminal = require('node-pty').spawn(process.execPath, [fixturePath], {
        cols: settings.cols, rows: settings.rows, cwd: dir, env: process.env, useConptyDll: reader === 'stock-dll'
      });
      terminal.on('error', error => mark('terminal-error', { message: error.message }));
      terminal._socket.on('ready_datapipe', () => {
        pid = terminal.pid;
        save(dir, 'parent-pid.json', { pid });
        mark('native-connected', { pid });
      });
      terminal._socket.on('end', () => mark('stock-socket-end'));
      terminal._socket.on('close', () => mark('stock-socket-close'));
      terminal._agent._conoutSocketWorker._worker.on('exit', code => mark('worker-exit', { code }));
      terminal._agent._conoutSocketWorker._worker.on('error', error => mark('stock-worker-error', { message: error.message }));
      terminal.onData(output);
      terminal.onExit(event => { mark('public-on-exit', event); finishSource('legacy-unverified-close'); });
    }
    await done;
  } catch (error) {
    mark('sample-error', { message: error.message, stack: error.stack });
    interrupt('sample-error');
  } finally {
    clearTimeout(sampleTimer);
    clearTimeout(exitTimer);
    clearTimeout(pauseTimer);
  }
  const content = raw.join('');
  const actual = await render(content);
  const expected = await render(expectedText(scenario));
  const result = { ...config, exit, source, paused, stopped, timedOut, events,
    rawHash: hash(content), rawBytes: Buffer.byteLength(content),
    receipt: readJSON(receiptPath), childReady: readJSON(path.join(dir, 'child-ready.json')),
    contentMatched: JSON.stringify(actual) === JSON.stringify(expected),
    rendered: { hash: hash(actual.text), cursorX: actual.cursorX, cursorLine: actual.cursorLine },
    expected: { hash: hash(expected.text), cursorX: expected.cursorX, cursorLine: expected.cursorLine },
    resourcesAfterObservation: resources(), elapsedMs: Math.round(performance.now() - started) };
  fs.writeFileSync(path.join(dir, 'raw.txt'), content);
  fs.writeFileSync(path.join(dir, 'rendered.txt'), actual.text);
  save(dir, 'summary.json', result);
  // An unref'ed deadline observes leaks. It never turns a leaked sample into exit 0.
  const guard = setTimeout(() => {
    save(dir, 'resource-timeout.json', { events, resources: resources() });
    process.exit(3);
  }, settings.resourceGuardMs);
  guard.unref();
}

function expectedText(scenario) {
  if (['natural-zero', 'natural-nonzero', 'paused-tail'].includes(scenario)) {
    return Array.from({ length: settings.lines }, (_, i) => `DSC_WIN_LINE_${String(i + 1).padStart(5, '0')}\r\n`).join('');
  }
  if (scenario === 'split-unicode') return 'UNICODE:\u4e2d\u{1f642}\r\n\x1b[31mRED\x1b[0m\r\nDONE\r\n';
  if (scenario === 'descendant-tail') return 'PARENT\r\nCHILD_TAIL\r\n';
  if (scenario === 'descendant-held') return 'PARENT\r\n';
  assert.equal(scenario, 'cooperative-stop');
  return 'READY\r\nSTOP_TAIL\r\n';
}

function fixture(scenario, dir) {
  const receipt = JSON.stringify(path.join(dir, 'writer-receipt.json'));
  const code = ['natural-nonzero', 'cooperative-stop'].includes(scenario) ? 7 : 0;
  const preamble = `const fs = require('node:fs');\n` +
    `function done(error) { fs.writeFileSync(${receipt}, JSON.stringify({written: !error, error: error?.message, code: ${code}})); process.exit(error ? 77 : ${code}); }\n`;
  if (['natural-zero', 'natural-nonzero', 'paused-tail'].includes(scenario)) {
    return preamble + `process.stdout.write(Array.from({length: ${settings.lines}}, (_, i) => 'DSC_WIN_LINE_' + String(i + 1).padStart(5, '0') + '\\n').join(''), done);\n`;
  }
  if (scenario === 'split-unicode') {
    return preamble + "const chunks = [Buffer.from('UNICODE:'), Buffer.from([0xe4,0xb8]), Buffer.from([0xad,0xf0,0x9f]), Buffer.from([0x99,0x82]), Buffer.from('\\n\\x1b[3'), Buffer.from('1mRED\\x1b[0m\\nDONE\\n')]; let i = 0; function next(error) { if (error || i === chunks.length) done(error); else process.stdout.write(chunks[i++], error => setTimeout(() => next(error), 30)); } next();\n";
  }
  if (scenario.startsWith('descendant-')) {
    const childScript = path.join(dir, 'descendant.cjs');
    const childReady = path.join(dir, 'child-ready.json');
    const childBody = preamble + `fs.writeFileSync(${JSON.stringify(childReady)}, JSON.stringify({pid: process.pid, stdoutIsTTY: process.stdout.isTTY === true}));\n` +
      (scenario === 'descendant-tail' ? `setTimeout(() => process.stdout.write('CHILD_TAIL\\n', done), ${settings.descendantTailMs});\n` :
        `setTimeout(() => process.exit(0), ${settings.heldMs});\n`);
    return preamble + `fs.writeFileSync(${JSON.stringify(childScript)}, ${JSON.stringify(childBody)});\n` +
      // Node's Windows Job kills directly spawned children when this parent exits.
      `process.stdout.write('PARENT\\n', () => { const command = 'start "" /b "' + process.execPath + '" "' + ${JSON.stringify(childScript)} + '"';\n` +
      `const launcher = require('node:child_process').spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command], {stdio: 'inherit', windowsVerbatimArguments: true});\n` +
      `launcher.on('error', done); function ready() { if (fs.existsSync(${JSON.stringify(childReady)})) { const child = JSON.parse(fs.readFileSync(${JSON.stringify(childReady)}, 'utf8')); fs.writeFileSync(${JSON.stringify(path.join(dir, 'child-pid.json'))}, JSON.stringify({pid: child.pid})); process.exit(0); } else setTimeout(ready, 5); } ready(); });\n`;
  }
  return preamble + "process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.once('data', () => process.stdout.write('STOP_TAIL\\n', done)); process.stdout.write('READY\\n');\n";
}

function assess(result) {
  if (result.reader !== 'owned-dll') return { pass: null, note: 'baseline; content and resources reported independently' };
  const held = result.scenario === 'descendant-held';
  const workerExited = result.naturalExit?.events.some(e => e.event === 'worker-exit' && e.code === 0);
  const sourceOK = held ? result.source === 'exit-deadline' : result.source === 'pipe-eof';
  const exitCode = ['natural-nonzero', 'cooperative-stop'].includes(result.scenario) ? 7 : 0;
  const descendantAlive = !result.scenario.startsWith('descendant-') ||
    (result.childReady?.stdoutIsTTY === true && result.events.some(e => e.event === 'native-process-exit' && e.childAlive));
  return { pass: !result.error && !result.timedOut && !result.driver.hardTimeout && result.driver.code === 0 &&
    Boolean(result.naturalExit) && !result.resourceTimeout && workerExited && sourceOK && result.contentMatched &&
    result.exit?.code === exitCode && (held || result.receipt?.written === true) &&
    (result.scenario !== 'paused-tail' || result.paused) && (result.scenario !== 'cooperative-stop' || result.stopped) &&
    result.cleanup.remaining.length === 0 && descendantAlive,
  note: held ? 'explicit interruption, not drained' : 'content + process + pipe end + natural worker/driver exit' };
}

async function render(text) {
  const { Terminal } = require('@xterm/headless');
  const terminal = new Terminal({ cols: settings.cols, rows: settings.rows, scrollback: settings.scrollback, allowProposedApi: true });
  try {
    await new Promise(resolve => terminal.write(text, resolve));
    const lines = [];
    for (let i = 0; i < terminal.buffer.active.length; i++) lines.push(terminal.buffer.active.getLine(i).translateToString(true));
    return { text: lines.join('\n').trimEnd(), cursorX: terminal.buffer.active.cursorX,
      cursorLine: terminal.buffer.active.baseY + terminal.buffer.active.cursorY };
  } finally { terminal.dispose(); }
}

function knownPids(dir) {
  return ['parent-pid.json', 'child-pid.json'].map(file => readJSON(path.join(dir, file))?.pid)
    .filter(pid => Number.isInteger(pid) && pid > 0 && pid !== process.pid);
}
async function verifySaved(dir) {
  const results = readJSON(path.join(dir, 'summary.json'));
  const schedule = readJSON(path.join(dir, 'schedule.json'));
  assert.equal(results.length, cases.length * settings.runs * readers.length);
  assert.equal(schedule.length, results.length);
  const keys = new Set();
  for (const result of results) {
    const key = `${result.scenario}-${result.run}-${result.reader}`;
    assert(!keys.has(key));
    keys.add(key);
    const raw = fs.readFileSync(path.join(dir, key, 'raw.txt'), 'utf8');
    assert.equal(hash(raw), result.rawHash);
    assert.equal(JSON.stringify(await render(raw)) === JSON.stringify(await render(expectedText(result.scenario))), result.contentMatched);
    assert.deepEqual(assess(result), result.assessment);
  }
  for (const entry of schedule) assert(keys.has(`${entry.scenario}-${entry.run}-${entry.reader}`));
  console.log(JSON.stringify({ samples: results.length, candidateFailures: results.filter(r => r.reader === 'owned-dll' && !r.assessment.pass).length,
    note: 'saved evidence verified, not new native validation or candidate success' }));
}
async function cleanupFixture(dir) {
  const pids = knownPids(dir);
  const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; } };
  const before = pids.filter(alive);
  const errors = [];
  for (const pid of before) { try { process.kill(pid); } catch (error) { errors.push({ pid, code: error.code }); } }
  const deadline = performance.now() + 1000;
  while (pids.some(alive) && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  const result = { before, errors, remaining: pids.filter(alive) };
  save(dir, 'fixture-cleanup.json', result);
  return result;
}
async function selfTest() {
  const full = await render('HEAD\r\nTAIL\r\n');
  assert.deepEqual(await render('\x1b[?25lHEAD\r\r\nTAIL\r\n\x1b[?25h'), full);
  assert.notDeepEqual(await render('HEAD\r\nTAIL'), full);
  assert.notDeepEqual(await render('HEAD\r\nTAI\r\n'), full);
  assert.equal(expectedText('natural-zero').split('\n').length, 90001);
  for (const scenario of cases) new Function(fixture(scenario, os.tmpdir()));
  const complete = { reader: 'owned-dll', scenario: 'natural-zero', exit: { code: 0 }, source: 'pipe-eof',
    receipt: { written: true }, contentMatched: true, driver: { code: 0 },
    naturalExit: { events: [{ event: 'worker-exit', code: 0 }] }, cleanup: { remaining: [] } };
  assert.equal(assess(complete).pass, true);
  for (const change of [{ source: 'legacy-unverified-close' }, { contentMatched: false },
    { naturalExit: null }, { resourceTimeout: {} }, { receipt: { written: false } }, { exit: { code: 7 } }]) {
    assert.equal(Boolean(assess({ ...complete, ...change }).pass), false);
  }
  const held = { ...complete, scenario: 'descendant-held', source: 'exit-deadline',
    childReady: { stdoutIsTTY: true }, events: [{ event: 'native-process-exit', childAlive: true }] };
  assert.equal(assess(held).pass, true);
  assert.equal(assess({ ...held, childReady: { stdoutIsTTY: false } }).pass, false);
  assert.equal(assess({ ...held, events: [{ event: 'native-process-exit', childAlive: false }] }).pass, false);
  for (const mode of ['eof', 'pause', 'cancel']) await testWorker(mode);
  console.log('Windows candidate oracle/fixture self-test passed; no native ConPTY launched');
}
async function testWorker(mode) {
  let socket;
  const server = net.createServer(client => { socket = client; });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const worker = new Worker(workerURL, { workerData: { pipe: { host: '127.0.0.1', port: server.address().port },
    pauseMarker: mode === 'pause' ? 'HEAD' : null, pauseMs: 20 } });
  const messages = [];
  const bytes = [];
  try {
    const code = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Worker ${mode} timed out`)), 2000);
      worker.on('error', reject);
      worker.on('exit', code => { clearTimeout(timer); resolve(code); });
      worker.on('message', message => {
        messages.push(message);
        if (message.event === 'ready') {
          if (mode === 'cancel') worker.postMessage('cancel');
          else if (mode === 'pause') socket.write('HEAD');
          else socket.end(Buffer.from('HEAD\u4e2d\r\n'));
        }
        if (message.event === 'reader-resume') socket.end(Buffer.from('\u4e2d\r\n'));
        if (message.event === 'data') bytes.push(Buffer.from(message.bytes));
      });
    });
    assert.equal(code, 0);
    assert(messages.some(m => m.event === 'pipe-close'));
    if (mode === 'cancel') assert(!messages.some(m => m.event === 'pipe-end'));
    else {
      assert.equal(Buffer.concat(bytes).toString('utf8'), 'HEAD\u4e2d\r\n');
      assert(messages.some(m => m.event === 'pipe-end' && !m.cancelled));
    }
    if (mode === 'pause') assert(messages.some(m => m.event === 'reader-resume'));
  } finally {
    socket?.destroy();
    await worker.terminate();
    await new Promise(resolve => server.close(resolve));
  }
}
function readJSON(file) { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null; }
function save(dir, name, value) { fs.writeFileSync(path.join(dir, name), JSON.stringify(value, null, 2)); }
function hash(value) { return createHash('sha256').update(value).digest('hex'); }
