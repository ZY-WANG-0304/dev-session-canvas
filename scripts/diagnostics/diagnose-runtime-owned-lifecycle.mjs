// Frozen, isolated diagnostic. No production reader or historical probe is changed.
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
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

const require = createRequire(import.meta.url), script = fileURLToPath(import.meta.url);
const workerURL = new URL('./runtime-owned-cancel-worker.mjs', import.meta.url);
const settings = Object.freeze({ runs: 3, warmup: 3, measured: 20, snapshots: 5, snapshotMs: 20,
  settleMs: 100, sampleMs: 30000, resourceGuardMs: 2000, cancelHardMs: 35000, batchHardMs: 150000,
  cols: 96, rows: 28, pollMs: 2 });
const scenarios = ['cancel-idle', 'cancel-worker-held', 'cancel-parent-held', 'read-through'];
const payload = Buffer.from(`DSC_OWNED_BEGIN\n${'C'.repeat(2048)}\nDSC_OWNED_END\n`);
const { values } = parseArgs({ options: { output: { type: 'string' }, driver: { type: 'string' }, fixture: { type: 'string' },
  'verify-saved': { type: 'string' }, 'self-test': { type: 'boolean' }, 'watchdog-block': { type: 'boolean' } } });
try {
  if (values.fixture) await fixture(readJSON(values.fixture));
  else if (values.driver) await driver(readJSON(values.driver));
  else if (values['watchdog-block']) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30000);
  else if (values['self-test']) await selfTest();
  else if (values['verify-saved']) process.exitCode = (await verifySaved(path.resolve(values['verify-saved']))).pass ? 0 : 1;
  else await run();
} catch (error) { console.error(error.stack ?? error); process.exitCode = 1; }

function makeSchedule(platform) {
  const entries = platform === 'win32' ? scenarios.flatMap(scenario => Array.from({ length: settings.runs }, (_, i) =>
    ({ id: `${scenario}-${i + 1}`, kind: 'cancel', scenario, run: i + 1 }))) : [];
  for (let run = 1; run <= 2; run++) for (const mode of ['control', 'native']) entries.push({ id: `${mode}-${run}`, kind: 'resources', mode, run });
  return entries;
}
async function fixture(config) {
  const { dir, token } = config;
  save(dir, 'fixture-owner.json', { pid: process.pid, token, stdinTTY: Boolean(process.stdin.isTTY), stdoutTTY: Boolean(process.stdout.isTTY) });
  const bytes = config.scenario === 'cancel-idle' ? Buffer.alloc(0) : payload;
  try {
    if (bytes.length) await new Promise((resolve, reject) => process.stdout.write(bytes, error => error ? reject(error) : resolve()));
    save(dir, 'writer-receipt.json', { token, pid: process.pid, bytes: bytes.length, hash: hash(bytes), written: true, ns: now() });
    while (!readJSON(path.join(dir, 'exit-gate.json'))) await sleep(settings.pollMs);
    assert.equal(readJSON(path.join(dir, 'exit-gate.json')).token, token);
    save(dir, 'fixture-gate.json', { token, pid: process.pid, ns: now() });
  } catch (error) { save(dir, 'fixture-error.json', { token, pid: process.pid, error: String(error) }); throw error; }
}

function compile(dir) {
  const build = path.join(dir, 'compiled'); fs.mkdirSync(build);
  const source = path.join(path.dirname(script), 'native-runtime-resources.c');
  const binary = path.join(build, 'native-runtime-resources.node');
  const compiler = process.platform === 'win32' ? 'cl.exe' : process.platform === 'darwin' ? 'clang' : 'gcc';
  const candidates = process.env.DSC_NODE_INCLUDE_DIR ? [process.env.DSC_NODE_INCLUDE_DIR] :
    [path.resolve(path.dirname(fs.realpathSync(process.execPath)), '../include/node'), '/usr/include/node'];
  const headers = candidates.find(p => fs.existsSync(path.join(p, 'node_api.h')));
  const record = { compiler, headers, binary, sources: [] };
  try {
    assert(headers, 'Missing Node headers; set DSC_NODE_INCLUDE_DIR');
    const versionHeader = fs.readFileSync(path.join(headers, 'node_version.h'), 'utf8');
    record.headerVersion = ['MAJOR', 'MINOR', 'PATCH'].map(part => versionHeader.match(new RegExp(`#define NODE_${part}_VERSION\\s+(\\d+)`))[1]).join('.');
    assert.equal(record.headerVersion, process.versions.node, 'Compilation headers must match the running Node');
    for (const file of [source, ...['node_api.h', 'node_api_types.h', 'js_native_api.h', 'js_native_api_types.h', 'node_version.h'].map(n => path.join(headers, n)),
      ...(process.platform === 'win32' ? [process.env.DSC_NODE_LIB] : [])]) {
      assert(file && fs.existsSync(file), 'Missing compilation input');
      const snapshot = `compiled/${path.basename(file)}`;
      fs.copyFileSync(file, path.join(dir, snapshot)); record.sources.push({ file, snapshot, hash: hash(fs.readFileSync(file)) });
    }
    record.args = process.platform === 'win32' ? ['/nologo', '/LD', '/W4', '/WX', `/I${headers}`,
      '/DNODE_GYP_MODULE_NAME=native_runtime_resources', path.join(build, path.basename(source)), process.env.DSC_NODE_LIB, '/link', `/OUT:${binary}`] :
      ['-std=c99', '-Wall', '-Wextra', '-Werror', '-I', headers, '-DNODE_GYP_MODULE_NAME=native_runtime_resources',
        ...(process.platform === 'darwin' ? ['-bundle', '-undefined', 'dynamic_lookup'] : ['-shared', '-fPIC']),
        path.join(build, path.basename(source)), ...(process.platform === 'darwin' ? ['-lproc'] : []), '-o', binary];
    const compiled = spawnSync(compiler, record.args, { cwd: build, encoding: 'utf8', timeout: 30000 });
    Object.assign(record, { status: compiled.status, stdout: compiled.stdout, stderr: compiled.stderr, error: compiled.error?.message });
    assert.equal(compiled.status, 0, `Compilation failed: ${compiled.stderr || compiled.stdout}`);
    record.binarySnapshot = 'compiled/native-runtime-resources.node'; record.hash = hash(fs.readFileSync(binary));
  } catch (error) { record.error = error.stack ?? String(error); }
  save(dir, 'compilation.json', record);
  assert(!record.error, record.error);
  return binary;
}
function environment(dir) {
  const type = process.platform === 'win32' ? 'conpty' : 'pty';
  const native = require('node-pty/lib/utils').loadNativeModule(type);
  const lib = path.dirname(require.resolve('node-pty/lib/index'));
  const files = [script, fileURLToPath(workerURL), require.resolve('@xterm/headless'), path.resolve(lib, native.dir, `${type}.node`),
    path.resolve(lib, `../src/${process.platform === 'win32' ? 'win/conpty.cc' : 'unix/pty.cc'}`)];
  if (process.platform === 'win32') files.push(path.resolve(lib, native.dir, 'conpty/conpty.dll'));
  if (process.platform === 'darwin') files.push(path.resolve(lib, native.dir, 'spawn-helper'));
  fs.mkdirSync(path.join(dir, 'source-snapshot'));
  const sources = files.map((file, i) => {
    const snapshot = `source-snapshot/${i}-${path.basename(file)}`; fs.copyFileSync(file, path.join(dir, snapshot));
    return { file, snapshot, hash: hash(fs.readFileSync(file)) };
  });
  save(dir, 'environment.json', { platform: process.platform, arch: process.arch, kernel: os.release(), versions: process.versions,
    nodePty: require('node-pty/package.json').version, settings, sources,
    github: { sha: process.env.GITHUB_SHA, run: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT, image: process.env.ImageVersion } });
}
async function run() {
  assert(values.output && ['linux', 'darwin', 'win32'].includes(process.platform));
  const dir = path.resolve(values.output); assert(!fs.existsSync(dir), 'Refusing to overwrite evidence'); fs.mkdirSync(dir, { recursive: true });
  const schedule = makeSchedule(process.platform); save(dir, 'schedule.json', { platform: process.platform, settings, entries: schedule });
  const observer = compile(dir); environment(dir);
  const results = [];
  for (const entry of schedule) {
    const sampleDir = path.join(dir, entry.id); fs.mkdirSync(sampleDir);
    const config = { ...entry, dir: sampleDir, token: randomUUID(), observer, platform: process.platform };
    save(sampleDir, 'config.json', config);
    const result = await guarded(['--driver', path.join(sampleDir, 'config.json')], entry.kind === 'cancel' ? settings.cancelHardMs : settings.batchHardMs);
    save(sampleDir, 'driver.json', { ...result, stdout: undefined, stderr: undefined });
    fs.writeFileSync(path.join(sampleDir, 'stdout.log'), result.stdout); fs.writeFileSync(path.join(sampleDir, 'stderr.log'), result.stderr);
    save(sampleDir, 'cleanup.json', await cleanup(sampleDir, config.token));
    let assessment;
    try { assessment = await assessDriver(sampleDir, config); }
    catch (error) { assessment = { pass: false, evidenceError: String(error) }; }
    save(sampleDir, 'assessment.json', assessment);
    manifest(sampleDir); results.push({ id: entry.id, ...assessment });
    console.log(JSON.stringify(results.at(-1)));
  }
  save(dir, 'results.json', results);
  const verified = await verifySaved(dir);
  process.exitCode = verified.pass ? 0 : 1;
}
async function guarded(args, milliseconds) {
  const child = spawn(process.execPath, [script, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '', timedOut = false, timer, lastResort;
  child.stdout.on('data', b => { stdout += b; }); child.stderr.on('data', b => { stderr += b; });
  const exit = await new Promise(resolve => {
    const done = value => { clearTimeout(timer); clearTimeout(lastResort); resolve(value); };
    child.on('error', error => done({ error: String(error) })); child.on('exit', (code, signal) => done({ code, signal }));
    timer = setTimeout(() => {
      timedOut = true; child.kill('SIGKILL');
      lastResort = setTimeout(() => done({ error: 'No exit after SIGKILL' }), 2000);
    }, milliseconds);
  });
  child.stdout.destroy(); child.stderr.destroy();
  return { pid: child.pid, ...exit, timedOut, stdout, stderr };
}

async function driver(config) {
  const dir = config.dir, observe = require(config.observer).observe;
  const results = [], counts = [];
  let error;
  process.on('beforeExit', code => save(dir, 'natural-exit.json', { pid: process.pid, code, resources: process.getActiveResourcesInfo() }));
  process.on('exit', code => save(dir, 'process-exit.json', { pid: process.pid, code, resources: process.getActiveResourcesInfo() }));
  try {
    if (config.kind === 'cancel') {
      const sessionDir = path.join(dir, 'session'); fs.mkdirSync(sessionDir);
      results.push(await session({ ...config, dir: sessionDir }));
    } else {
      for (let index = 0; index < settings.warmup + settings.measured; index++) {
        if (config.mode === 'native') {
          const sessionDir = path.join(dir, `session-${index}`); fs.mkdirSync(sessionDir);
          const result = await session({ ...config, scenario: 'read-through', dir: sessionDir });
          results.push(result);
          if (result.error || !(await assessSession(sessionDir, config.platform)).pass) throw new Error(`Session ${index} incomplete; stopping this driver`);
        }
        if (index >= settings.warmup - 1) {
          await sleepAtLeast(settings.settleMs);
          const samples = [];
          for (let sample = 0; sample < settings.snapshots; sample++) {
            samples.push({ ns: now(), native: observe(), js: process.getActiveResourcesInfo() });
            if (sample + 1 < settings.snapshots) await sleepAtLeast(settings.snapshotMs);
          }
          counts.push({ index, samples }); save(dir, 'counts.json', counts);
        }
      }
    }
  } catch (caught) { error = caught.stack ?? String(caught); }
  save(dir, 'summary.json', { pid: process.pid, config, results, error });
  if (error) process.exitCode = 1;
  const guard = setTimeout(() => {
    save(dir, 'resource-timeout.json', { pid: process.pid, resources: process.getActiveResourcesInfo() }); process.exit(2);
  }, settings.resourceGuardMs); guard.unref();
}

async function session(config) {
  const { dir, scenario, token } = config; save(dir, 'config.json', config);
  const events = [], observed = [], deliveries = [], pending = [], jobs = [];
  const decoder = new StringDecoder('utf8'), terminal = makeTerminal();
  let accepted = 0, applied = 0, source, nativeExit, workerExit, inputClosed = false, error, fd, pid, input, worker;
  let cancelSent = false, cancelApplied = false, held = false, parentHeld = false, releaseParent = false, gate = false;
  let boundary = '', timer, unixJob, closed = false, sourceEnded = false;
  const started = performance.now();
  fs.writeFileSync(path.join(dir, 'observed.bin'), ''); fs.writeFileSync(path.join(dir, 'delivered.bin'), '');
  const mark = (event, details = {}) => {
    const record = { index: events.length, ns: now(), event, ...details }; events.push(record); append(dir, 'events.ndjson', record);
  };
  const enqueue = text => {
    if (!text) return;
    const id = ++accepted; mark('consumer-enqueue', { id, hash: hash(text) });
    jobs.push(new Promise(resolve => terminal.write(text, () => { applied++; mark('consumer-applied', { id }); resolve(); })));
  };
  const consume = bytes => enqueue(decoder.write(bytes));
  const deliver = bytes => {
    deliveries.push(bytes); fs.appendFileSync(path.join(dir, 'delivered.bin'), bytes);
    boundary = (boundary + bytes.toString('utf8')).slice(-8192);
    if (scenario === 'cancel-parent-held' && !releaseParent && (parentHeld || boundary.includes('DSC_OWNED_BEGIN'))) {
      pending.push(bytes); parentHeld = true; mark('parent-held', { bytes: bytes.length, pending: pending.length });
    } else consume(bytes);
  };
  const flush = () => { releaseParent = true; mark('parent-release', { pending: pending.length }); for (const bytes of pending.splice(0)) consume(bytes); };
  const output = bytes => { observed.push(bytes); fs.appendFileSync(path.join(dir, 'observed.bin'), bytes); };
  const fail = caught => { error ??= caught.stack ?? String(caught); mark('error', { error }); };
  const check = () => { if (error) throw new Error(error); if (performance.now() - started > settings.sampleMs) throw new Error('Session deadline'); };
  const publishGate = () => { save(dir, 'exit-gate.json', { token, ns: now() }); gate = true; mark('gate-published'); };
  const onExit = (code, signal = 0) => { nativeExit = { code, signal }; mark('native-exit', nativeExit); input?.destroy(); };
  const coordinate = () => {
    try {
      const receipt = readJSON(path.join(dir, 'writer-receipt.json'));
      if (!receipt || gate) return;
      assert.equal(receipt.token, token); assert.equal(receipt.pid, pid); assert(receipt.written);
      if (scenario === 'read-through') publishGate();
      else if (!cancelSent && (scenario === 'cancel-idle' || (scenario === 'cancel-worker-held' && held) || (scenario === 'cancel-parent-held' && parentHeld))) {
        cancelSent = true; mark('cancel-request', { held, parentHeld, receipt }); worker.postMessage('cancel');
      }
      if (cancelApplied && !gate) publishGate();
    } catch (caught) { fail(caught); }
  };
  try {
    if (process.platform === 'win32') {
      const native = require('node-pty/lib/utils').loadNativeModule('conpty').module;
      const { argsToCommandLine } = require('node-pty/lib/windowsPtyAgent');
      const term = native.startProcess(process.execPath, settings.cols, settings.rows, false, `owned-${process.pid}-${randomUUID()}`, false, true);
      input = new net.Socket({ fd: fs.openSync(term.conin, 'w'), readable: false, writable: true });
      input.on('error', fail); input.on('close', () => { inputClosed = true; mark('input-close'); });
      worker = new Worker(workerURL, { workerData: { pipe: term.conout, hold: scenario === 'cancel-worker-held' } });
      worker.on('error', fail); worker.on('exit', code => { workerExit = code; mark('worker-exit', { code }); });
      worker.on('message', message => {
        try {
          const bytes = message.bytes instanceof Uint8Array ? Buffer.from(message.bytes) : undefined;
          mark(`worker-${message.event}`, { ...message, event: `worker-${message.event}`, bytes: bytes ? bytes.length : message.bytes, hash: bytes ? hash(bytes) : undefined, workerNs: message.ns, ns: now() });
          if (message.event === 'ready') {
            const connected = native.connect(term.pty, argsToCommandLine(process.execPath, [script, '--fixture', path.join(dir, 'config.json')]), dir,
              Object.entries(process.env).map(([k, v]) => `${k}=${v}`), true, onExit);
            pid = connected.pid; save(dir, 'native-owner.json', { pid, token, config: path.join(dir, 'config.json') }); mark('native-connected', { pid });
          } else if (message.event === 'observed') output(bytes);
          else if (message.event === 'delivery') deliver(bytes);
          else if (message.event === 'held') held = true;
          else if (message.event === 'cancel-applied') { cancelApplied = true; flush(); }
          else if (message.event === 'source') { source = message.reason; mark('source', { reason: source }); }
          else if (message.event === 'pipe-close') { closed = true; if (message.hadError) fail(new Error('Unexpected pipe close error')); }
          else if (message.event === 'pipe-error') fail(new Error(`Pipe error: ${message.code}`));
        } catch (caught) { fail(caught); }
      });
    } else {
      const native = require('node-pty/lib/utils').loadNativeModule('pty');
      const helper = path.resolve(path.dirname(require.resolve('node-pty/lib/unixTerminal')), native.dir, 'spawn-helper');
      const env = { ...process.env, TERM: 'xterm-256color', LANG: 'C.UTF-8' };
      ({ fd, pid } = native.module.fork(process.execPath, [script, '--fixture', path.join(dir, 'config.json')],
        Object.entries(env).map(([k, v]) => `${k}=${v}`), dir, settings.cols, settings.rows, -1, -1, true, helper, onExit));
      save(dir, 'native-owner.json', { pid, token, config: path.join(dir, 'config.json') }); mark('native-connected', { pid, fd });
      unixJob = (async () => {
        let id = 0;
        while (!source) {
          check(); const buffer = Buffer.alloc(65536);
          const answer = await new Promise(resolve => fs.read(fd, buffer, 0, buffer.length, null, (caught, count = 0) => resolve({ error: caught?.code, count })));
          const bytes = Buffer.from(buffer.subarray(0, answer.count)); mark('read-callback', { id: ++id, ...answer, hash: hash(bytes), capacity: buffer.length });
          if (bytes.length) { output(bytes); deliver(bytes); }
          if (answer.error === 'EIO' || (!answer.error && answer.count === 0)) { source = answer.error === 'EIO' ? 'pty-eio' : 'pty-eof'; mark('source', { reason: source }); }
          else if (answer.error && !['EAGAIN', 'EWOULDBLOCK'].includes(answer.error)) throw new Error(answer.error);
          else if (!answer.count) await sleep(settings.pollMs);
        }
        await new Promise((resolve, reject) => fs.close(fd, caught => caught ? reject(caught) : resolve()));
        let probe; try { fs.fstatSync(fd); probe = 'open'; } catch (caught) { probe = caught.code; }
        closed = probe === 'EBADF'; mark('fd-close', { fd, probe }); assert(closed);
      })().catch(fail);
    }
    timer = setInterval(coordinate, settings.pollMs);
    while (!source || !nativeExit || !closed || (worker && (workerExit === undefined || !inputClosed))) { check(); await sleep(settings.pollMs); }
    await unixJob; check();
    if (pending.length) flush(); enqueue(decoder.end()); sourceEnded = true; mark('decoder-end');
    await Promise.all(jobs); check();
    save(dir, 'terminal-state.json', state(terminal)); mark('consumer-complete', { accepted, applied });
  } catch (caught) { fail(caught); }
  finally { clearInterval(timer); terminal.dispose(); mark('terminal-disposed'); }
  const summary = { pid: process.pid, scenario, source, sourceEnded, nativeExit, workerExit, inputClosed, closed, gate,
    cancelSent, cancelApplied, held, parentHeld, accepted, applied, pending: pending.length, observed: observed.reduce((n, b) => n + b.length, 0),
    delivered: deliveries.reduce((n, b) => n + b.length, 0), error, elapsedMs: performance.now() - started };
  save(dir, 'session.json', summary); return summary;
}

function makeTerminal() { const { Terminal } = require('@xterm/headless'); return new Terminal({ cols: settings.cols, rows: settings.rows, scrollback: 10000, allowProposedApi: true }); }
function state(terminal) {
  const buffer = terminal.buffer.active, lines = [];
  for (let i = 0; i < buffer.length; i++) lines.push(buffer.getLine(i).translateToString(true));
  return { text: lines.join('\n').trimEnd(), cursorX: buffer.cursorX, cursorLine: buffer.baseY + buffer.cursorY };
}
async function render(bytes) {
  const terminal = makeTerminal();
  try { await new Promise(resolve => terminal.write(bytes.toString('utf8'), resolve)); return state(terminal); }
  finally { terminal.dispose(); }
}
function ranges(samples) {
  const keys = Object.keys(samples[0].native).filter(key => ['fds', 'threads', 'handles'].includes(key));
  return Object.fromEntries(keys.map(key => [key, { min: Math.min(...samples.map(s => s.native[key])), max: Math.max(...samples.map(s => s.native[key])) }]));
}
function resourceAssessment(counts) {
  if (counts?.length !== settings.measured + 1 || counts.some((c, i) => c.index !== i + settings.warmup - 1 || c.samples?.length !== settings.snapshots)) return { pass: false, reason: 'Incomplete resource schedule' };
  const baseline = ranges(counts[0].samples), checkpoints = counts.slice(1).map(c => ({ index: c.index, ranges: ranges(c.samples) }));
  const growth = checkpoints.flatMap(c => Object.entries(c.ranges).filter(([key, value]) => value.min > baseline[key].max)
    .map(([key, value]) => ({ index: c.index, key, delta: value.min - baseline[key].max })));
  return { pass: growth.length === 0, baseline, final: checkpoints.at(-1).ranges, growth };
}
function messageOwnership(events, raw, delivered) {
  const observations = events.filter(e => e.event === 'worker-observed'), sends = events.filter(e => e.event === 'worker-delivery');
  const messages = observations.length === sends.length && observations.every((e, i) => e.id === i + 1 && sends[i].id === e.id && sends[i].hash === e.hash && sends[i].bytes === e.bytes && sends[i].index > e.index);
  let offset = 0;
  const chunks = observations.every(e => { const chunk = raw.subarray(offset, offset += e.bytes); return e.bytes > 0 && hash(chunk) === e.hash; }) && offset === raw.length;
  return messages && chunks && raw.equals(delivered);
}
function sourceMatches(scenario, source, events, platform) {
  if (scenario !== 'read-through') return source === 'interrupted:diagnostic-cancel' && events.some(e => e.event === 'worker-cancel-applied');
  if (platform === 'win32') return source === 'pipe-eof' && events.some(e => e.event === 'worker-pipe-end' && !e.cancelled);
  return ['pty-eio', 'pty-eof'].includes(source) && events.some(e => e.event === 'read-callback' && e.capacity > 0 && (e.error === 'EIO' || (!e.error && e.count === 0)));
}
async function assessSession(dir, platform) {
  const s = readJSON(path.join(dir, 'session.json')), config = readJSON(path.join(dir, 'config.json'));
  if (!s || !config) return { pass: false, reason: 'Missing session summary/config' };
  const events = readEvents(path.join(dir, 'events.ndjson')), receipt = readJSON(path.join(dir, 'writer-receipt.json'));
  const fixtureOwner = readJSON(path.join(dir, 'fixture-owner.json')), owner = readJSON(path.join(dir, 'native-owner.json'));
  const raw = fs.readFileSync(path.join(dir, 'observed.bin')), delivered = fs.readFileSync(path.join(dir, 'delivered.bin'));
  const cancelling = config.scenario !== 'read-through', bytes = config.scenario === 'cancel-idle' ? Buffer.alloc(0) : payload;
  const checks = {};
  checks.writer = receipt?.written === true && receipt.token === config.token && receipt.pid === owner?.pid &&
    receipt.bytes === bytes.length && receipt.hash === hash(bytes) && fixtureOwner?.pid === owner?.pid && fixtureOwner?.token === config.token && fixtureOwner.stdinTTY && fixtureOwner.stdoutTTY;
  checks.ownership = raw.equals(delivered) && raw.length === s.observed && delivered.length === s.delivered;
  checks.consumer = s.sourceEnded && s.pending === 0 && s.accepted === s.applied && events.filter(e => e.event === 'consumer-enqueue').every((e, i) => e.id === i + 1) &&
    JSON.stringify(events.filter(e => e.event === 'consumer-enqueue').map(e => e.id)) === JSON.stringify(events.filter(e => e.event === 'consumer-applied').map(e => e.id)) &&
    equal(readJSON(path.join(dir, 'terminal-state.json')), await render(delivered));
  const position = event => events.findIndex(e => e.event === event);
  checks.consumerOrder = position('source') >= 0 && position('decoder-end') > position('source') &&
    position('consumer-complete') > position('decoder-end') && position('terminal-disposed') > position('consumer-complete') &&
    events.filter(e => e.event === 'consumer-applied').every(e => e.index < position('consumer-complete'));
  const decode = new StringDecoder('utf8'), expectedEnqueues = []; let consumerOffset = 0;
  const acceptedChunks = events.filter(e => e.event === (platform === 'win32' ? 'worker-delivery' : 'read-callback'));
  for (const entry of acceptedChunks) {
    const size = platform === 'win32' ? entry.bytes : entry.count;
    const text = decode.write(delivered.subarray(consumerOffset, consumerOffset += size)); if (text) expectedEnqueues.push(hash(text));
  }
  const tail = decode.end(); if (tail) expectedEnqueues.push(hash(tail));
  checks.consumerBytes = consumerOffset === delivered.length && equal(expectedEnqueues, events.filter(e => e.event === 'consumer-enqueue').map(e => e.hash));
  checks.content = cancelling || equal(await render(delivered), await render(Buffer.from(payload.toString().replaceAll('\n', '\r\n'))));
  checks.source = sourceMatches(config.scenario, s.source, events, platform) && (!cancelling || (s.cancelSent && s.cancelApplied));
  checks.lifecycle = s.nativeExit?.code === 0 && !s.nativeExit.signal && s.closed && s.gate &&
    readJSON(path.join(dir, 'fixture-gate.json'))?.token === config.token && !s.error &&
    (platform !== 'win32' || (s.workerExit === 0 && s.inputClosed));
  if (platform === 'win32') {
    checks.messages = messageOwnership(events, raw, delivered);
    if (cancelling) checks.cancelOrder = events.findIndex(e => e.event === 'worker-cancel-applied') > events.findIndex(e => e.event === 'cancel-request') &&
      events.some(e => e.event === 'worker-owned-settled' && e.observed === e.delivered && e.bufferedRemaining === 0) &&
      position('gate-published') > position('worker-cancel-applied') && position('source') > position('worker-owned-settled') &&
      events.filter(e => e.event === 'worker-observed' && e.origin === 'readable-at-cancel').reduce((n, e) => n + e.bytes, 0) === events.find(e => e.event === 'worker-cancel-applied')?.buffered;
    if (config.scenario === 'cancel-worker-held') {
      const held = events.find(e => e.event === 'worker-held');
      checks.held = s.held && held?.bytes > 0 && held.index < position('cancel-request') &&
        events.find(e => e.event === 'worker-delivery' && e.id === held.id)?.index > position('worker-cancel-applied');
    }
    if (config.scenario === 'cancel-parent-held') checks.held = s.parentHeld && events.some(e => e.event === 'parent-held' && e.bytes > 0) &&
      position('parent-held') < position('cancel-request') && position('parent-release') > position('worker-cancel-applied');
  } else {
    let offset = 0;
    checks.raw = events.filter(e => e.event === 'read-callback').every(e => {
      const bytes = raw.subarray(offset, offset += e.count); return e.capacity > 0 && e.count <= e.capacity && hash(bytes) === e.hash;
    }) && offset === raw.length;
  }
  return { pass: Object.values(checks).every(Boolean), checks };
}
async function assessDriver(dir, config) {
  const summary = readJSON(path.join(dir, 'summary.json')), child = readJSON(path.join(dir, 'driver.json'));
  const natural = readJSON(path.join(dir, 'natural-exit.json')), cleanupResult = readJSON(path.join(dir, 'cleanup.json'));
  const sessions = [];
  const sessionDirs = fs.readdirSync(dir).filter(n => /^session(?:-\d+)?$/.test(n)).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  for (const name of sessionDirs) sessions.push({ name, ...await assessSession(path.join(dir, name), config.platform) });
  const resources = config.kind === 'resources' ? resourceAssessment(readJSON(path.join(dir, 'counts.json'))) : null;
  const expected = config.kind === 'cancel' ? 1 : config.mode === 'native' ? settings.warmup + settings.measured : 0;
  const lifecycle = Boolean(summary && !summary.error && child?.code === 0 && !child.timedOut && natural?.code === 0 &&
    child.pid === summary.pid && natural.pid === summary.pid && !readJSON(path.join(dir, 'resource-timeout.json')) &&
    cleanupResult && !cleanupResult.killed.length && !cleanupResult.remaining.length && !cleanupResult.errors.length);
  const sameProcess = sessions.every(s => readJSON(path.join(dir, s.name, 'session.json'))?.pid === summary?.pid) &&
    (config.kind !== 'resources' || (readJSON(path.join(dir, 'counts.json')) ?? []).every(c => c.samples.every(s => s.native.pid === summary?.pid)));
  return { pass: lifecycle && sameProcess && sessions.length === expected && sessions.every(s => s.pass) && (!resources || resources.pass), lifecycle, sameProcess, sessions, resources };
}

async function cleanup(dir, token) {
  const result = { killed: [], remaining: [], errors: [] };
  for (const relative of allFiles(dir).filter(n => n.endsWith('native-owner.json'))) {
    const owner = readJSON(path.join(dir, relative));
    if (owner.token !== token) { result.errors.push('Owner token mismatch'); continue; }
    if (!alive(owner.pid)) continue;
    try {
      const command = process.platform === 'win32' ? execFileSync('powershell.exe', ['-NoProfile', '-Command', `(Get-CimInstance Win32_Process -Filter 'ProcessId=${owner.pid}').CommandLine`], { encoding: 'utf8', timeout: 10000 }) :
        execFileSync('ps', ['-p', String(owner.pid), '-o', 'args='], { encoding: 'utf8', timeout: 10000 });
      if (!command.includes(owner.config)) { result.errors.push({ pid: owner.pid, reason: 'Cannot confirm fixture command' }); continue; }
      result.killed.push(owner.pid);
      if (process.platform === 'win32') execFileSync('taskkill.exe', ['/PID', String(owner.pid), '/T', '/F'], { timeout: 10000 });
      else process.kill(owner.pid, 'SIGKILL');
      await sleep(100);
      if (alive(owner.pid)) result.remaining.push(owner.pid);
    } catch (error) { result.errors.push({ pid: owner.pid, error: String(error) }); }
  }
  return result;
}
function allFiles(dir, prefix = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const relative = path.posix.join(prefix, entry.name);
    return entry.isDirectory() ? allFiles(path.join(dir, entry.name), relative) : [relative];
  }).sort();
}
function manifest(dir) { save(dir, 'manifest.json', allFiles(dir).filter(n => n !== 'manifest.json').map(file => ({ file, hash: hash(fs.readFileSync(path.join(dir, file))) }))); }
async function verifySaved(dir, quiet = false) {
  const schedule = readJSON(path.join(dir, 'schedule.json')); assert(schedule, 'Missing schedule');
  assert.deepEqual(schedule.settings, settings); assert.deepEqual(schedule.entries, makeSchedule(schedule.platform));
  for (const record of [readJSON(path.join(dir, 'environment.json')), readJSON(path.join(dir, 'compilation.json'))]) {
    assert(record, 'Missing environment/compilation');
    for (const item of record.sources) assert.equal(hash(fs.readFileSync(path.join(dir, item.snapshot))), item.hash, item.snapshot);
    if (record.binarySnapshot) assert.equal(hash(fs.readFileSync(path.join(dir, record.binarySnapshot))), record.hash);
  }
  const report = { attempted: 0, verified: 0, failures: [], evidenceErrors: [] };
  for (const entry of schedule.entries) {
    report.attempted++; const sampleDir = path.join(dir, entry.id);
    try {
      const recorded = readJSON(path.join(sampleDir, 'manifest.json')); assert(recorded, 'Missing sample manifest');
      assert.deepEqual(recorded.map(r => r.file).sort(), allFiles(sampleDir).filter(n => n !== 'manifest.json'));
      for (const record of recorded) assert.equal(hash(fs.readFileSync(path.join(sampleDir, record.file))), record.hash, record.file);
      const config = readJSON(path.join(sampleDir, 'config.json'));
      for (const [key, value] of Object.entries(entry)) assert.equal(config[key], value);
      assert.equal(config.platform, schedule.platform);
      const result = await assessDriver(sampleDir, config);
      assert.deepEqual(result, readJSON(path.join(sampleDir, 'assessment.json')));
      report.verified++; if (!result.pass) report.failures.push({ id: entry.id, lifecycle: result.lifecycle, resources: result.resources });
    } catch (error) { report.evidenceErrors.push({ id: entry.id, error: String(error) }); }
  }
  report.pass = report.verified === schedule.entries.length && !report.failures.length && !report.evidenceErrors.length;
  if (!quiet) console.log(JSON.stringify({ ...report, note: 'Offline verification, not new native execution.' }));
  return report;
}
async function selfTest() {
  const dir = process.env.DSC_OWNED_SELFTEST_EVIDENCE ? path.resolve(process.env.DSC_OWNED_SELFTEST_EVIDENCE) : fs.mkdtempSync(path.join(os.tmpdir(), 'dsc-owned-selftest-'));
  fs.mkdirSync(dir, { recursive: true }); const observer = require(compile(dir)).observe;
  for (const file of [script, fileURLToPath(workerURL)]) fs.copyFileSync(file, path.join(dir, path.basename(file)));
  const before = observer(), handles = [];
  try {
    for (let i = 0; i < 3; i++) handles.push(fs.openSync(path.join(dir, `file-${i}`), 'w'));
    const during = observer(), key = process.platform === 'win32' ? 'handles' : 'fds';
    assert.equal(during[key], before[key] + 3);
    for (const fd of handles.splice(0)) fs.closeSync(fd);
    const after = observer(); assert.equal(after[key], before[key]); save(dir, 'counter-control.json', { before, during, after });
  } finally { for (const fd of handles) fs.closeSync(fd); }
  const stable = Array.from({ length: settings.measured + 1 }, (_, i) => ({ index: i + 2, samples: Array.from({ length: 5 }, () => ({ native: { fds: 10, threads: 7 } })) }));
  assert(resourceAssessment(stable).pass); const growth = structuredClone(stable); growth.at(-1).samples.forEach(s => s.native.fds++); assert(!resourceAssessment(growth).pass);
  assert(!resourceAssessment(stable.slice(1)).pass);
  for (const scenario of scenarios) await testWorker(scenario, dir);
  assert(!sourceMatches('cancel-idle', 'pipe-eof', [{ event: 'worker-cancel-applied' }], 'win32'));
  assert(!sourceMatches('read-through', 'pipe-eof', [], 'win32'));
  assert(!sourceMatches('read-through', 'pty-eof', [{ event: 'read-callback', capacity: 0, count: 0 }], 'darwin'));
  const synthetic = path.join(dir, 'saved-failures'); fs.mkdirSync(synthetic);
  const entries = makeSchedule('linux'); save(synthetic, 'schedule.json', { platform: 'linux', settings, entries });
  save(synthetic, 'environment.json', { sources: [], synthetic: true }); save(synthetic, 'compilation.json', { sources: [], synthetic: true });
  for (const entry of entries) {
    const sampleDir = path.join(synthetic, entry.id); fs.mkdirSync(sampleDir);
    const config = { ...entry, dir: sampleDir, platform: 'linux', token: 'synthetic' }; save(sampleDir, 'config.json', config);
    save(sampleDir, 'assessment.json', await assessDriver(sampleDir, config)); manifest(sampleDir);
  }
  const failures = await verifySaved(synthetic, true);
  assert.equal(failures.attempted, 4); assert.equal(failures.verified, 4); assert.equal(failures.failures.length, 4); assert.equal(failures.evidenceErrors.length, 0);
  fs.appendFileSync(path.join(synthetic, entries[0].id, 'config.json'), 'corrupt');
  const corrupt = await verifySaved(synthetic, true);
  assert.equal(corrupt.attempted, 4); assert.equal(corrupt.verified, 3); assert.equal(corrupt.evidenceErrors.length, 1); assert.equal(corrupt.failures.at(-1).id, entries.at(-1).id);
  save(dir, 'verifier-negative-results.json', { failures, corrupt });
  const watchdog = await guarded(['--watchdog-block'], 100); assert(watchdog.timedOut && watchdog.signal === 'SIGKILL'); save(dir, 'watchdog.json', watchdog);
  console.log(`Counter/ownership/TCP/watchdog self-tests passed: ${dir}. No native PTY sessions or product acceptance.`);
}
async function testWorker(scenario, dir) {
  let connection; const server = net.createServer(socket => { connection = socket; socket.on('error', () => {}); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const worker = new Worker(workerURL, { workerData: { pipe: { host: '127.0.0.1', port: server.address().port }, hold: scenario === 'cancel-worker-held' } });
  const messages = [], raw = [], delivered = []; let cancelling = false, timer;
  try {
    const exit = await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`TCP ${scenario} timeout`)), 2000);
      worker.on('error', reject); worker.on('exit', resolve);
      worker.on('message', m => {
        messages.push({ ...m, bytes: m.bytes instanceof Uint8Array ? Buffer.from(m.bytes).toString('base64') : m.bytes });
        if (m.event === 'ready') {
          if (scenario === 'cancel-idle') { cancelling = true; worker.postMessage('cancel'); }
          else if (scenario === 'read-through') connection.end(payload);
          else connection.write(payload);
        }
        if (m.event === 'observed') raw.push(Buffer.from(m.bytes));
        if (m.event === 'delivery') delivered.push(Buffer.from(m.bytes));
        if (!cancelling && ((scenario === 'cancel-worker-held' && m.event === 'held') || (scenario === 'cancel-parent-held' && m.event === 'delivery'))) {
          cancelling = true; worker.postMessage('cancel');
        }
      });
    });
    assert.equal(exit, 0); assert(Buffer.concat(raw).equals(Buffer.concat(delivered)));
    const source = messages.find(m => m.event === 'source'); assert.equal(source.reason, scenario === 'read-through' ? 'pipe-eof' : 'interrupted:diagnostic-cancel');
    if (scenario !== 'cancel-idle') assert(Buffer.concat(raw).equals(payload));
    const events = messages.map((m, index) => {
      const bytes = typeof m.bytes === 'string' ? Buffer.from(m.bytes, 'base64') : null;
      return { ...m, index, event: `worker-${m.event}`, bytes: bytes?.length ?? m.bytes, hash: bytes ? hash(bytes) : undefined };
    });
    assert(messageOwnership(events, Buffer.concat(raw), Buffer.concat(delivered)));
    if (raw.length) assert(!messageOwnership(events.filter(e => e.event !== 'worker-delivery'), Buffer.concat(raw), Buffer.concat(delivered)));
    save(dir, `${scenario}.json`, messages);
  } finally { clearTimeout(timer); connection?.destroy(); await worker.terminate(); await new Promise(resolve => server.close(resolve)); }
}
function now() { return process.hrtime.bigint().toString(); }
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
async function sleepAtLeast(ms) { const deadline = performance.now() + ms; while (performance.now() < deadline) await sleep(Math.max(1, deadline - performance.now())); }
function hash(value) { return createHash('sha256').update(value).digest('hex'); }
function equal(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function alive(pid) { try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; } }
function readJSON(file) { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null; }
function readEvents(file) { return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : []; }
function save(dir, name, value) { const file = path.join(dir, name), tmp = `${file}.tmp`; fs.writeFileSync(tmp, JSON.stringify(value, null, 2)); fs.renameSync(tmp, file); }
function append(dir, name, value) { fs.appendFileSync(path.join(dir, name), `${JSON.stringify(value)}\n`); }
