import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
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

const require = createRequire(import.meta.url);
const script = fileURLToPath(import.meta.url);
const workerURL = new URL('./runtime-launch-tail-conout-worker.mjs', import.meta.url);
const bridgeFile = path.resolve('extensions/vscode/dev-session-canvas/src/panel/executionSessionBridge.ts');
const settings = Object.freeze({ runs: 3, lines: 90000, readyHoldMs: 100, pauseMs: 1500,
  collectionMs: 30000, exitObservationMs: 2500, resourceGuardMs: 2000, hardMs: 35000,
  cleanupMs: 2000, cols: 120, rows: 40, scrollback: 100000, pollMs: 5 });
const cases = ['direct-zero', 'direct-nonzero', 'direct-paused-tail', 'cmd-wait-zero',
  'cmd-wait-nonzero', 'bat-wait-nonzero', 'cmd-nonwait-control'];
const transports = ['actual-bridge', 'owned-dll'];
const snapshotNames = ['0-diagnose-windows-launch-tail.mjs', '1-runtime-launch-tail-conout-worker.mjs',
  '2-executionSessionBridge.ts', '3-windowsPtyAgent.js', '4-windowsTerminal.js',
  '5-windowsConoutConnection.js', '6-conoutSocketWorker.js', '7-conpty.node', '8-conpty.dll'];
const scope = 'Controlled Windows launch fixtures, no real provider. actual-bridge uses createExecutionSessionProcess; owned-dll only shares resolveExecutionSessionSpawnSpec. Public onExit is not source EOF. No native handle-growth or cancellation-in-flight acceptance.';
const { values } = parseArgs({ options: { output: { type: 'string' }, sample: { type: 'string' },
  'verify-saved': { type: 'string' }, 'self-test': { type: 'boolean' },
  fixture: { type: 'string' }, config: { type: 'string' }, token: { type: 'string' } } });

if (values.fixture) await runFixture(values);
else if (values['self-test']) await selfTest();
else if (values['verify-saved']) await verifySaved(path.resolve(values['verify-saved']));
else if (values.sample) await runSample(readJSON(values.sample));
else await runSchedule();

function makeSchedule() {
  return cases.flatMap(scenario => Array.from({ length: settings.runs }, (_, index) =>
    transports.map(transport => ({ scenario, transport, run: index + 1,
      name: `${scenario}-${index + 1}-${transport}`, token: randomUUID() })))).flat();
}

async function runSchedule() {
  assert.equal(process.platform, 'win32', 'Native Windows experiment requires Windows');
  assert(values.output, '--output must name a new directory');
  const dir = path.resolve(values.output);
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  fs.mkdirSync(dir);
  const schedule = makeSchedule();
  save(dir, 'schedule.json', schedule);
  save(dir, 'protocol.json', { scope, settings, cases, transports });
  try {
    const native = require('node-pty/lib/utils').loadNativeModule('conpty');
    const lib = path.dirname(require.resolve('node-pty/lib/windowsPtyAgent'));
    const files = [script, fileURLToPath(workerURL), bridgeFile,
      require.resolve('node-pty/lib/windowsPtyAgent'), require.resolve('node-pty/lib/windowsTerminal'),
      require.resolve('node-pty/lib/windowsConoutConnection'),
      require.resolve('node-pty/lib/worker/conoutSocketWorker'),
      path.resolve(lib, native.dir, 'conpty.node'), path.resolve(lib, native.dir, 'conpty/conpty.dll')];
    const snapshots = path.join(dir, 'source-snapshot');
    fs.mkdirSync(snapshots);
    const hashes = {};
    for (const [index, file] of files.entries()) {
      const bytes = fs.readFileSync(file);
      const snapshot = `${index}-${path.basename(file)}`;
      assert.equal(snapshot, snapshotNames[index]);
      fs.writeFileSync(path.join(snapshots, snapshot), bytes);
      hashes[file] = { sha256: hash(bytes), snapshot };
    }
    save(dir, 'environment.json', { scope, settings, platform: process.platform, arch: process.arch,
      release: os.release(), versions: process.versions, executable: process.execPath,
      nodePty: require('node-pty/package.json').version, hashes,
      github: { sha: process.env.GITHUB_SHA, runId: process.env.GITHUB_RUN_ID,
        attempt: process.env.GITHUB_RUN_ATTEMPT, image: process.env.ImageOS, imageVersion: process.env.ImageVersion } });
    const results = [];
    for (const item of schedule) {
      const sampleDir = path.join(dir, item.name);
      fs.mkdirSync(sampleDir);
      save(sampleDir, 'config.json', { ...item, dir: sampleDir });
      const driver = await guardedChild([script, '--sample', path.join(sampleDir, 'config.json')], settings.hardMs);
      save(sampleDir, 'driver-exit.json', driver);
      const result = readJSON(path.join(sampleDir, 'result.json')) ?? { ...item, error: 'No sample result' };
      result.driver = driver;
      result.naturalExit = readJSON(path.join(sampleDir, 'natural-exit.json'));
      result.resourceTimeout = readJSON(path.join(sampleDir, 'resource-timeout.json'));
      result.cleanup = await cleanupFixture(sampleDir, item.token);
      result.assessment = assess(result);
      save(sampleDir, 'final-result.json', result);
      results.push(result);
      save(dir, 'summary.json', results);
      console.log(JSON.stringify({ name: item.name, assessment: result.assessment,
        nativeExit: result.nativeExit?.code, source: result.source,
        naturalExit: Boolean(result.naturalExit), cleanup: result.cleanup.remaining.length }));
    }
    report(results);
    if (failed(results)) process.exitCode = 1;
  } catch (error) {
    save(dir, 'startup-or-driver-error.json', { error: serializeError(error), scriptHash: hash(fs.readFileSync(script)) });
    throw error;
  }
}

async function guardedChild(args, deadlineMs) {
  const started = performance.now();
  const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const logs = { stdout: '', stderr: '' };
  let closed = false;
  child.once('close', () => { closed = true; });
  child.stdout.on('data', chunk => { logs.stdout += chunk; });
  child.stderr.on('data', chunk => { logs.stderr += chunk; });
  let hardTimeout = false;
  const timer = setTimeout(() => { hardTimeout = true; child.kill('SIGKILL'); }, deadlineMs);
  const exit = await new Promise(resolve => {
    child.on('error', error => resolve({ error: serializeError(error) }));
    child.on('exit', (code, signal) => resolve({ code, signal }));
  });
  clearTimeout(timer);
  // A leaked inherited log pipe must not turn successful SIGKILL into an unbounded close wait.
  let logsTruncated = false;
  await new Promise(resolve => {
    const drain = setTimeout(() => {
      logsTruncated = true;
      child.stdout.destroy();
      child.stderr.destroy();
      resolve();
    }, 500);
    child.once('close', () => { clearTimeout(drain); resolve(); });
    if (closed || child.stdout.destroyed && child.stderr.destroyed) { clearTimeout(drain); resolve(); }
  });
  return { ...exit, pid: child.pid, hardTimeout, logsTruncated,
    elapsedMs: Math.round(performance.now() - started), logs };
}

async function loadBridge() {
  const { build } = await import('esbuild');
  const bundle = await build({ entryPoints: [bridgeFile], bundle: true, write: false,
    external: ['node-pty'], format: 'cjs', platform: 'node', target: 'node18' });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', '__filename', '__dirname', bundle.outputFiles[0].text)(
    require, module, module.exports, bridgeFile, path.dirname(bridgeFile));
  return { ...module.exports, bundleHash: hash(bundle.outputFiles[0].contents) };
}

async function runSample(config) {
  assert.equal(process.platform, 'win32');
  assert(cases.includes(config.scenario) && transports.includes(config.transport));
  const { dir, token, scenario, transport } = config;
  const started = performance.now();
  const events = [];
  const raw = [];
  const nativeRaw = [];
  fs.writeFileSync(path.join(dir, 'events.ndjson'), '');
  fs.writeFileSync(path.join(dir, 'raw.txt'), '');
  if (transport === 'owned-dll') fs.writeFileSync(path.join(dir, 'raw.bin'), Buffer.alloc(0));
  const mark = (event, details = {}) => {
    const entry = { ms: Math.round(performance.now() - started), event, ...details };
    events.push(entry);
    fs.appendFileSync(path.join(dir, 'events.ndjson'), `${JSON.stringify(entry)}\n`);
  };
  mark('sample-initialized-before-native-or-bridge-load', { token, scenario, transport });
  const negative = scenario === 'cmd-nonwait-control';
  let terminal, underlying, worker, input, nativeExit, publicExit, source, readyObservation;
  let gateReleased, cancelRequested, paused = false, timedOut = false, error, bundleHash;
  let tail = '', collectionTimer, exitTimer, pauseTimer, pollingTimer, nativeId;
  let pauseComplete;
  let workerSequence = 0, decoderEnded = false, consumerComplete = false;
  let resolveDone;
  const done = new Promise(resolve => { resolveDone = resolve; });
  const decoder = new StringDecoder('utf8');
  const resourceInfo = () => process.getActiveResourcesInfo();
  const subject = () => {
    const receipt = readJSON(path.join(dir, 'subject-ready.json'));
    const valid = receipt?.token === token && receipt?.role === 'subject' && Number.isInteger(receipt.pid);
    return { receipt, live: Boolean(valid && isAlive(receipt.pid)) };
  };
  const settle = () => {
    if (nativeExit && source && (transport !== 'actual-bridge' || publicExit)) resolveDone();
  };
  const output = text => {
    if (!text) return;
    raw.push(text);
    fs.appendFileSync(path.join(dir, 'raw.txt'), text);
    mark('accepted-output', { sequence: raw.length, bytes: Buffer.byteLength(text), hash: hash(text) });
    const boundary = tail + text;
    tail = boundary.slice(-250);
    if (transport === 'actual-bridge' && scenario === 'direct-paused-tail' && !paused && boundary.includes('DSC_MAIN_LINE_89800')) {
      paused = true;
      underlying.pause();
      mark('reader-paused', { durationMs: settings.pauseMs });
      pauseComplete = new Promise(resolve => {
        pauseTimer = setTimeout(() => { mark('reader-resumed'); underlying.resume(); resolve(); }, settings.pauseMs);
      });
    }
  };
  const flushDecoder = () => {
    if (!decoderEnded) { decoderEnded = true; output(decoder.end()); mark('decoder-ended'); }
  };
  const finishSource = result => {
    if (source) return;
    source = result;
    clearTimeout(exitTimer);
    mark('source-result', { result });
    input?.destroy();
    settle();
  };
  const interrupt = reason => {
    if (cancelRequested || source) return;
    cancelRequested = { reason, ms: Math.round(performance.now() - started) };
    mark('cancel-requested', cancelRequested);
    if (worker) worker.postMessage('cancel');
    else finishSource(`interrupted:${reason}`);
  };
  const onNative = code => {
    nativeExit = { code, subject: subject(), ms: Math.round(performance.now() - started) };
    mark('native-main-exit', nativeExit);
    if (negative) interrupt('nonwaiting-launcher-observed');
    else if (transport === 'owned-dll' && !source) {
      exitTimer = setTimeout(() => interrupt('exit-observation-deadline'), settings.exitObservationMs);
    }
    settle();
  };
  process.on('beforeExit', code => save(dir, 'natural-exit.json', { code, events, resources: resourceInfo() }));
  process.on('exit', code => save(dir, 'process-exit.json', { code, events, resources: resourceInfo() }));
  const fatal = caught => {
    save(dir, 'fatal-error.json', { error: serializeError(caught), events, rawHash: hash(raw.join('')) });
    fs.writeFileSync(path.join(dir, 'raw-at-fatal.txt'), raw.join(''));
    process.exit(2);
  };
  process.on('uncaughtException', fatal);
  process.on('unhandledRejection', caught => fatal(caught instanceof Error ? caught : new Error(String(caught))));
  try {
    const bridge = await loadBridge();
    bundleHash = bridge.bundleHash;
    const launch = createLaunch(config);
    const resolved = bridge.resolveExecutionSessionSpawnSpec(launch, 'win32');
    save(dir, 'launch.json', { launch, resolved, scope, bundleHash,
      fixtureHashes: Object.fromEntries(['fixture-launch.cmd', 'fixture-launch.bat'].map(name => path.join(dir, name))
        .filter(file => fs.existsSync(file)).map(file => [path.basename(file), hash(fs.readFileSync(file))])) });
    collectionTimer = setTimeout(() => {
      timedOut = true;
      mark('collection-deadline');
      interrupt('collection-deadline');
      resolveDone();
    }, settings.collectionMs);
    if (transport === 'owned-dll') {
      const native = require('node-pty/lib/utils').loadNativeModule('conpty').module;
      const { argsToCommandLine } = require('node-pty/lib/windowsPtyAgent');
      const term = native.startProcess(resolved.file, settings.cols, settings.rows, false,
        `dsc-launch-${process.pid}-${token}`, false, true);
      nativeId = term.pty;
      input = new net.Socket({ fd: fs.openSync(term.conin, 'w'), readable: false, writable: true });
      input.on('error', caught => mark('input-error', serializeError(caught)));
      worker = new Worker(workerURL, { workerData: { pipe: term.conout,
        pauseMarker: scenario === 'direct-paused-tail' ? 'DSC_MAIN_LINE_89800' : null, pauseMs: settings.pauseMs } });
      worker.on('error', caught => { mark('worker-error', serializeError(caught)); error = serializeError(caught); resolveDone(); });
      worker.on('exit', code => { mark('worker-exit', { code }); });
      worker.on('message', message => {
        if (message.event === 'worker-data') {
          assert.equal(message.sequence, ++workerSequence);
          const bytes = Buffer.from(message.bytes);
          nativeRaw.push(bytes);
          fs.appendFileSync(path.join(dir, 'raw.bin'), bytes);
          mark('native-worker-buffer', { sequence: message.sequence, bytes: bytes.length, hash: hash(bytes) });
          output(decoder.write(bytes));
          return;
        }
        mark(message.event, message);
        if (message.event === 'worker-ready') {
          const connected = native.connect(nativeId, argsToCommandLine(resolved.file, resolved.args), launch.cwd,
            Object.entries(launch.env).filter(([, value]) => value !== undefined).map(([key, value]) => `${key}=${value}`), true, onNative);
          save(dir, 'main-pid.json', { pid: connected.pid, token, role: 'main' });
          mark('native-connected', { pid: connected.pid });
        } else if (message.event === 'reader-paused') paused = true;
        else if (message.event === 'pipe-end') {
          flushDecoder();
          finishSource(message.cancelled ? 'interrupted:cancel-before-pipe-end' : 'pipe-eof');
        } else if (message.event === 'pipe-close') {
          flushDecoder();
          if (!source) finishSource(cancelRequested ? `interrupted:${cancelRequested.reason}` : 'interrupted:close-without-end');
        } else if (message.event === 'pipe-error') interrupt('pipe-error');
      });
    } else {
      const { WindowsPtyAgent } = require('node-pty/lib/windowsPtyAgent');
      const originalExit = WindowsPtyAgent.prototype._$onProcessExit;
      WindowsPtyAgent.prototype._$onProcessExit = function (code) { onNative(code); return originalExit.call(this, code); };
      const pty = require('node-pty');
      const originalSpawn = pty.spawn;
      pty.spawn = function (...args) { underlying = originalSpawn.apply(this, args); return underlying; };
      try { terminal = bridge.createExecutionSessionProcess(launch); }
      finally { pty.spawn = originalSpawn; }
      underlying.on('error', caught => mark('terminal-error', serializeError(caught)));
      underlying._socket.on('ready_datapipe', () => {
        save(dir, 'main-pid.json', { pid: terminal.pid, token, role: 'main' });
        mark('native-connected', { pid: terminal.pid });
      });
      underlying._socket.on('end', () => mark('stock-socket-end-not-independent-source-eof'));
      underlying._socket.on('close', () => mark('stock-socket-close'));
      underlying._agent._conoutSocketWorker._worker.on('exit', code => mark('worker-exit', { code }));
      terminal.onData(output);
      terminal.onExit(event => {
        publicExit = { ...event, subject: subject(), ms: Math.round(performance.now() - started) };
        mark('public-on-exit-not-source-eof', publicExit);
        finishSource(negative ? 'interrupted:nonwaiting-launcher-observed' : 'legacy-unverified-close');
        settle();
      });
    }
    let readyAt;
    pollingTimer = setInterval(() => {
      const state = subject();
      if (state.receipt && readyAt === undefined) {
        readyAt = performance.now();
        mark('subject-ready-observed', state);
      }
      if (negative && state.receipt && raw.join('').includes(`READY:${token}`) && !gateReleased) {
        writeAtomic(path.join(dir, 'nonwait-exit-gate'), token);
        gateReleased = { ms: Math.round(performance.now() - started), kind: 'launcher-may-exit' };
        mark('nonwait-ready-output-gate', gateReleased);
      }
      if (negative || readyAt === undefined || gateReleased || performance.now() - readyAt < settings.readyHoldMs) return;
      readyObservation = { heldMs: Math.round(performance.now() - readyAt), subject: state,
        nativeExited: Boolean(nativeExit), publicExited: Boolean(publicExit) };
      mark('ready-hold-check', readyObservation);
      writeAtomic(path.join(dir, 'release-gate'), token);
      gateReleased = { ms: Math.round(performance.now() - started) };
      mark('release-gate', gateReleased);
    }, settings.pollMs);
    await done;
  } catch (caught) {
    error = serializeError(caught);
    mark('sample-error', error);
    interrupt('sample-error');
  } finally {
    clearTimeout(collectionTimer);
    clearTimeout(exitTimer);
    clearInterval(pollingTimer);
  }
  // Paused readers must finish their scheduled resume before content is assessed.
  if (pauseComplete) await pauseComplete;
  const content = raw.join('');
  mark('consumer-application-start', { acceptedChunks: raw.length });
  const actual = await render(content);
  consumerComplete = true;
  mark('consumer-application-complete', { acceptedChunks: raw.length });
  const expected = await render(expectedText(config));
  const result = { ...config, scope, bundleHash, nativeExit, publicExit, source, readyObservation,
    gateReleased, cancelRequested, paused, timedOut, error, consumerComplete,
    rawHash: hash(content), rawBytes: Buffer.byteLength(content), contentMatched: sameRender(actual, expected),
    rawKind: transport === 'owned-dll' ? 'native-pipe-buffer-and-decoded-text' : 'public-callback-text-not-native-bytes',
    nativeRawHash: transport === 'owned-dll' ? hash(Buffer.concat(nativeRaw)) : null,
    nativeRawBytes: transport === 'owned-dll' ? Buffer.concat(nativeRaw).length : null,
    rendered: actual, expected, events, subjectReady: readJSON(path.join(dir, 'subject-ready.json')),
    mainPid: readJSON(path.join(dir, 'main-pid.json')),
    subjectExit: readJSON(path.join(dir, 'subject-exit.json')),
    wrapperReady: readJSON(path.join(dir, 'wrapper-ready.json')),
    wrapperExit: readJSON(path.join(dir, 'wrapper-exit.json')),
    fixtureError: readJSON(path.join(dir, 'fixture-error.json')), resources: resourceInfo() };
  assert.equal(fs.readFileSync(path.join(dir, 'raw.txt'), 'utf8'), content);
  save(dir, 'trace.json', events);
  save(dir, 'result.json', result);
  const guard = setTimeout(() => {
    save(dir, 'resource-timeout.json', { events, resources: resourceInfo() });
    process.exit(3);
  }, settings.resourceGuardMs);
  guard.unref();
}

function createLaunch(config) {
  const { dir, token, scenario } = config;
  const allowed = new Set(['path', 'systemroot', 'windir', 'comspec', 'temp', 'tmp', 'pathext',
    'userprofile', 'localappdata', 'homedrive', 'homepath']);
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => allowed.has(key.toLowerCase()))),
    ELECTRON_RUN_AS_NODE: '1' };
  const fixture = scenario === 'cmd-nonwait-control' ? 'nonwait' : scenario.startsWith('direct-') ? 'subject' : 'wait';
  const args = [script, '--fixture', fixture, '--config', path.join(dir, 'config.json'), '--token', token];
  let file = process.execPath;
  let launchArgs = args;
  if (!scenario.startsWith('direct-')) {
    file = path.join(dir, scenario.startsWith('bat-') ? 'fixture-launch.bat' : 'fixture-launch.cmd');
    // The batch launcher is itself part of the tested waiting chain, without `start`.
    fs.writeFileSync(file, `@echo off\r\n"${process.execPath}" ${args.map(value => `"${value}"`).join(' ')}\r\nexit /b %errorlevel%\r\n`);
    launchArgs = [];
  }
  return { file, args: launchArgs, cwd: dir, env, cols: settings.cols, rows: settings.rows };
}

async function runFixture(options) {
  if (options.fixture === 'watchdog-hang') { for (;;) {} }
  const config = readJSON(options.config);
  const { dir, token, scenario } = config;
  assert.equal(options.token, token);
  const receipt = (name, detail) => save(dir, `${name}.json`, { token, ...detail });
  const fail = caught => {
    receipt('fixture-error', { pid: process.pid, role: options.fixture, error: serializeError(caught) });
    process.exit(77);
  };
  process.on('uncaughtException', fail);
  process.on('unhandledRejection', fail);
  if (options.fixture === 'subject') {
    const negative = scenario === 'cmd-nonwait-control';
    await writeOutput(`READY:${token}\n`);
    receipt('subject-ready', { role: 'subject', pid: process.pid, parentPid: process.ppid,
      stdoutIsTTY: process.stdout.isTTY === true });
    if (negative) {
      setInterval(() => {}, 1000);
      return;
    }
    while (!fs.existsSync(path.join(dir, 'release-gate'))) await delay(settings.pollMs);
    assert.equal(fs.readFileSync(path.join(dir, 'release-gate'), 'utf8'), token);
    if (scenario === 'direct-paused-tail') await writeOutput(numberedLines('\n'));
    await writeOutput(`\x1b[31mTAIL:${token}:\u4e2d\u{1f642}\x1b[0m\n`);
    const code = exitCode(scenario);
    receipt('subject-exit', { role: 'subject', pid: process.pid, written: true, code });
    process.exit(code);
  }
  receipt('wrapper-ready', { role: 'wrapper', pid: process.pid, parentPid: process.ppid });
  const args = [script, '--fixture', 'subject', '--config', options.config, '--token', token];
  if (options.fixture === 'wait') {
    const child = spawn(process.execPath, args, { stdio: 'inherit' });
    child.on('error', fail);
    child.on('exit', (code, signal) => {
      receipt('wrapper-exit', { role: 'wrapper', pid: process.pid, childPid: child.pid, code, signal, waited: true });
      process.exit(code ?? 78);
    });
    return;
  }
  assert.equal(options.fixture, 'nonwait');
  // cmd creates the subject outside this Node parent's private kill-on-close Job.
  const command = `start "" /b ${[process.execPath, ...args].map(value => `"${value}"`).join(' ')}`;
  const starter = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command],
    { stdio: 'inherit', windowsVerbatimArguments: true });
  starter.on('error', fail);
  while (!fs.existsSync(path.join(dir, 'subject-ready.json'))) await delay(settings.pollMs);
  const subject = readJSON(path.join(dir, 'subject-ready.json'));
  while (!fs.existsSync(path.join(dir, 'nonwait-exit-gate'))) await delay(settings.pollMs);
  assert.equal(fs.readFileSync(path.join(dir, 'nonwait-exit-gate'), 'utf8'), token);
  receipt('wrapper-exit', { role: 'wrapper', pid: process.pid, childPid: subject.pid, code: 0, waited: false });
  process.exit(0);
}

function numberedLines(newline) {
  return Array.from({ length: settings.lines }, (_, index) => `DSC_MAIN_LINE_${String(index + 1).padStart(5, '0')}${newline}`).join('');
}
function expectedText(config) {
  const ready = `READY:${config.token}\r\n`;
  if (config.scenario === 'cmd-nonwait-control') return ready;
  return ready + (config.scenario === 'direct-paused-tail' ? numberedLines('\r\n') : '') +
    `\x1b[31mTAIL:${config.token}:\u4e2d\u{1f642}\x1b[0m\r\n`;
}
function exitCode(scenario) { return scenario.endsWith('nonzero') ? 7 : 0; }

async function render(text) {
  const { Terminal } = require('@xterm/headless');
  const terminal = new Terminal({ cols: settings.cols, rows: settings.rows,
    scrollback: settings.scrollback, allowProposedApi: true });
  try {
    await new Promise(resolve => terminal.write(text, resolve));
    const lines = [];
    for (let index = 0; index < terminal.buffer.active.length; index++) {
      lines.push(terminal.buffer.active.getLine(index).translateToString(true));
    }
    return { text: lines.join('\n').trimEnd(), cursorX: terminal.buffer.active.cursorX,
      cursorLine: terminal.buffer.active.baseY + terminal.buffer.active.cursorY };
  } finally { terminal.dispose(); }
}
function sameRender(left, right) { return JSON.stringify(left) === JSON.stringify(right); }

function assess(result) {
  const negative = result.scenario === 'cmd-nonwait-control';
  const ready = result.readyObservation;
  const tokenOK = result.subjectReady?.token === result.token && result.subjectReady?.role === 'subject';
  const readyOK = tokenOK && Number.isInteger(result.subjectReady?.pid) && result.subjectReady.pid > 0 &&
    result.subjectReady?.stdoutIsTTY === true && result.mainPid?.token === result.token &&
    result.mainPid?.role === 'main' && Number.isInteger(result.mainPid?.pid) && result.mainPid.pid > 0;
  const code = exitCode(result.scenario);
  const direct = result.scenario.startsWith('direct-');
  const wrapper = direct ? result.mainPid?.pid === result.subjectReady?.pid :
    result.wrapperReady?.token === result.token && result.wrapperReady?.role === 'wrapper' &&
    Number.isInteger(result.wrapperReady?.pid) && result.wrapperReady.pid > 0 &&
    result.wrapperReady?.parentPid === result.mainPid?.pid &&
    result.wrapperExit?.token === result.token && result.wrapperExit?.role === 'wrapper' &&
    result.wrapperExit?.pid === result.wrapperReady.pid && result.wrapperExit?.childPid === result.subjectReady?.pid &&
    result.wrapperExit?.code === code && (negative || result.subjectReady?.parentPid === result.wrapperReady.pid);
  const subjectExit = result.subjectExit?.token === result.token && result.subjectExit?.role === 'subject' &&
    result.subjectExit?.pid === result.subjectReady?.pid && result.subjectExit?.written === true && result.subjectExit?.code === code;
  const lifecycle = readyOK && result.nativeExit?.code === code &&
    wrapper && (negative ? result.nativeExit?.subject?.live === true && result.wrapperExit?.waited === false :
      Boolean(ready?.subject?.live && ready.heldMs >= settings.readyHoldMs && !ready.nativeExited && !ready.publicExited &&
        result.gateReleased && subjectExit && (direct || result.wrapperExit?.waited === true))) &&
    (result.transport !== 'actual-bridge' || result.publicExit?.exitCode === code);
  const workerReleased = result.naturalExit?.events.some(event => event.event === 'worker-exit' && event.code === 0) === true;
  const resources = Boolean(result.naturalExit && !result.resourceTimeout && result.driver?.code === 0 && workerReleased);
  const content = result.contentMatched === true && result.consumerComplete === true &&
    (result.scenario !== 'direct-paused-tail' || result.paused === true);
  const source = negative ? result.source === 'interrupted:nonwaiting-launcher-observed' : result.source === 'pipe-eof';
  const infrastructure = !result.error && !result.fixtureError && !result.timedOut && !result.driver?.hardTimeout &&
    !result.driver?.error && result.driver?.logsTruncated === false &&
    result.cleanup?.remaining?.length === 0 && result.cleanup?.unconfirmed?.length === 0 &&
    result.cleanup?.errors?.length === 0;
  return { lifecycle: Boolean(lifecycle), content, resources, source,
    pass: result.transport === 'owned-dll' ? Boolean(lifecycle && content && resources && source && infrastructure) : null,
    infrastructure: Boolean(infrastructure),
    classification: result.transport === 'actual-bridge' ? 'baseline-observations-not-candidate-acceptance' :
      negative ? 'nonwaiting-launcher-detected-explicit-interruption' : 'main-tail-launch-lifecycle-pipe-end-consumer-worker' };
}

function processTable() {
  const output = execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
    'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress'],
  { encoding: 'utf8', windowsHide: true, timeout: 5000 });
  const parsed = JSON.parse(output.replace(/^\uFEFF/, ''));
  return Array.isArray(parsed) ? parsed : [parsed];
}
async function cleanupFixture(dir, token) {
  const records = ['main-pid', 'subject-ready', 'wrapper-ready'].map(name => readJSON(path.join(dir, `${name}.json`)))
    .filter(record => record?.token === token && Number.isInteger(record.pid) && record.pid > 0 && record.pid !== process.pid);
  let pids = [...new Set(records.map(record => record.pid))];
  const belongs = entry => {
    const command = entry.CommandLine ?? '';
    return command.includes(token) || command.includes(dir) && /fixture-launch\.(?:cmd|bat)/i.test(command);
  };
  const result = { token, knownPids: pids, discovered: [], before: [], killed: [], unconfirmed: [], errors: [], remaining: [] };
  try {
    const table = processTable();
    result.discovered = table.filter(entry => entry.ProcessId !== process.pid && belongs(entry));
    pids = [...new Set([...pids, ...result.discovered.map(entry => entry.ProcessId)])];
    result.knownPids = pids;
    for (const pid of pids) {
      const entry = table.find(item => item.ProcessId === pid);
      if (!entry) continue;
      result.before.push(entry);
      if (!belongs(entry)) { result.unconfirmed.push(entry); continue; }
      try { process.kill(pid); result.killed.push(pid); }
      catch (caught) { if (caught.code !== 'ESRCH') result.errors.push({ pid, ...serializeError(caught) }); }
    }
    const deadline = performance.now() + settings.cleanupMs;
    while (pids.some(isAlive) && performance.now() < deadline) await delay(10);
    result.remaining = pids.filter(isAlive);
  } catch (caught) {
    result.errors.push(serializeError(caught));
    result.remaining = pids.filter(isAlive);
  }
  save(dir, 'fixture-cleanup.json', result);
  return result;
}

async function verifySaved(dir) {
  const protocol = readJSON(path.join(dir, 'protocol.json'));
  assert.deepEqual(protocol, { scope, settings, cases, transports });
  const schedule = readJSON(path.join(dir, 'schedule.json'));
  const results = readJSON(path.join(dir, 'summary.json'));
  assert.equal(schedule.length, 42);
  assert.equal(results.length, schedule.length);
  assert.equal(new Set(schedule.map(item => item.name)).size, 42);
  const expectedKeys = makeSchedule().map(item => item.name);
  assert.deepEqual(schedule.map(item => item.name), expectedKeys);
  const environment = readJSON(path.join(dir, 'environment.json'));
  assert.equal(environment.platform, 'win32');
  assert.equal(environment.nodePty, '1.2.0-beta.12');
  assert.equal(environment.scope, scope);
  assert.deepEqual(environment.settings, settings);
  assert.deepEqual(Object.values(environment.hashes).map(entry => entry.snapshot), snapshotNames);
  for (const entry of Object.values(environment.hashes)) {
    assert.match(entry.sha256, /^[a-f0-9]{64}$/);
    assert.equal(hash(fs.readFileSync(path.join(dir, 'source-snapshot', entry.snapshot))), entry.sha256);
  }
  for (const [index, item] of schedule.entries()) {
    const result = results[index];
    assert.equal(result.name, item.name);
    assert.equal(result.token, item.token);
    assert.equal(result.scenario, item.scenario);
    assert.equal(result.transport, item.transport);
    assert.equal(result.run, item.run);
    const sampleDir = path.join(dir, item.name);
    assert.deepEqual(readJSON(path.join(sampleDir, 'final-result.json')), result);
    assert.deepEqual(readJSON(path.join(sampleDir, 'driver-exit.json')), result.driver);
    assert.deepEqual(readJSON(path.join(sampleDir, 'fixture-cleanup.json')), result.cleanup);
    assert.deepEqual(readJSON(path.join(sampleDir, 'natural-exit.json')), result.naturalExit);
    assert.deepEqual(readJSON(path.join(sampleDir, 'resource-timeout.json')), result.resourceTimeout);
    if (!result.error) {
      const raw = fs.readFileSync(path.join(sampleDir, 'raw.txt'), 'utf8');
      assert.equal(hash(raw), result.rawHash);
      assert.equal(Buffer.byteLength(raw), result.rawBytes);
      if (item.transport === 'owned-dll') {
        const bytes = fs.readFileSync(path.join(sampleDir, 'raw.bin'));
        assert.equal(hash(bytes), result.nativeRawHash);
        assert.equal(bytes.length, result.nativeRawBytes);
        assert.equal(bytes.toString('utf8'), raw);
      } else {
        assert.equal(result.nativeRawHash, null);
        assert.equal(result.rawKind, 'public-callback-text-not-native-bytes');
      }
      const actual = await render(raw);
      const expected = await render(expectedText(item));
      assert.deepEqual(actual, result.rendered);
      assert.deepEqual(expected, result.expected);
      assert.equal(sameRender(actual, expected), result.contentMatched);
      assert.deepEqual(readJSON(path.join(sampleDir, 'trace.json')), result.events);
      const journal = fs.readFileSync(path.join(sampleDir, 'events.ndjson'), 'utf8').trimEnd().split('\n').map(line => JSON.parse(line));
      assert.deepEqual(journal.slice(0, result.events.length), result.events);
      assert.deepEqual(result.events.find(event => event.event === 'native-main-exit')?.subject, result.nativeExit?.subject);
      assert.equal(result.events.find(event => event.event === 'native-main-exit')?.code, result.nativeExit?.code);
      assert.equal(result.events.find(event => event.event === 'source-result')?.result, result.source);
      assert.equal(result.events.some(event => event.event === 'consumer-application-complete'), result.consumerComplete);
      assert.deepEqual(readJSON(path.join(sampleDir, 'main-pid.json')), result.mainPid);
      for (const [key, file] of Object.entries({ subjectReady: 'subject-ready', subjectExit: 'subject-exit',
        wrapperReady: 'wrapper-ready', wrapperExit: 'wrapper-exit', fixtureError: 'fixture-error' })) {
        assert.deepEqual(readJSON(path.join(sampleDir, `${file}.json`)), result[key]);
      }
      const launch = readJSON(path.join(sampleDir, 'launch.json'));
      assert.equal(launch.bundleHash, result.bundleHash);
      for (const [name, digest] of Object.entries(launch.fixtureHashes)) {
        assert.equal(hash(fs.readFileSync(path.join(sampleDir, name))), digest);
      }
    }
    assert.deepEqual(assess(result), result.assessment);
  }
  report(results);
  console.log('Saved evidence verified; this is not another native run.');
  if (failed(results)) process.exitCode = 1;
}

function report(results) {
  console.log(JSON.stringify({ scope, samples: results.length,
    candidateFailures: results.filter(result => result.transport === 'owned-dll' && !result.assessment.pass).length,
    baselineLifecycleFailures: results.filter(result => result.transport === 'actual-bridge' && !result.assessment.lifecycle).length,
    baselineContentFailures: results.filter(result => result.transport === 'actual-bridge' && !result.assessment.content).length,
    baselineResourceFailures: results.filter(result => result.transport === 'actual-bridge' && !result.assessment.resources).length }));
}
function failed(results) {
  return results.some(result => !result.assessment.infrastructure || !result.assessment.lifecycle ||
    result.transport === 'owned-dll' && !result.assessment.pass);
}

async function selfTest() {
  assert.equal(makeSchedule().length, 42);
  const ready = { token: 'self-test', role: 'subject', pid: 123, parentPid: 122, stdoutIsTTY: true };
  const complete = { token: 'self-test', scenario: 'cmd-wait-nonzero', transport: 'owned-dll',
    subjectReady: ready, mainPid: { token: 'self-test', role: 'main', pid: 121 }, nativeExit: { code: 7 }, source: 'pipe-eof',
    subjectExit: { token: 'self-test', role: 'subject', pid: 123, written: true, code: 7 },
    wrapperReady: { token: 'self-test', role: 'wrapper', pid: 122, parentPid: 121 },
    wrapperExit: { token: 'self-test', role: 'wrapper', pid: 122, childPid: 123, waited: true, code: 7 },
    readyObservation: { heldMs: 100, subject: { live: true } }, gateReleased: {},
    contentMatched: true, consumerComplete: true, driver: { code: 0, logsTruncated: false },
    naturalExit: { events: [{ event: 'worker-exit', code: 0 }] }, cleanup: { remaining: [], unconfirmed: [], errors: [] } };
  assert.equal(assess(complete).pass, true);
  for (const change of [{ source: 'legacy-unverified-close' }, { source: 'interrupted:exit-observation-deadline' },
    { subjectExit: { written: false, code: 7 } }, { wrapperExit: { waited: false, code: 7 } },
    { readyObservation: { heldMs: 99, subject: { live: true } } }, { nativeExit: { code: 0 } },
    { contentMatched: false }, { consumerComplete: false }, { naturalExit: null }, { resourceTimeout: {} },
    { driver: { code: 0, hardTimeout: true } }, { cleanup: { remaining: [123], unconfirmed: [], errors: [] } }]) {
    assert.equal(assess({ ...complete, ...change }).pass, false);
  }
  const negative = { ...complete, scenario: 'cmd-nonwait-control', nativeExit: { code: 0, subject: { live: true } },
    source: 'interrupted:nonwaiting-launcher-observed', wrapperExit: { ...complete.wrapperExit, waited: false, code: 0 } };
  assert.equal(assess(negative).pass, true);
  assert.equal(assess({ ...negative, source: 'pipe-eof' }).pass, false);
  assert.equal(assess({ ...negative, nativeExit: { code: 0, subject: { live: false } } }).pass, false);
  const expected = await render('READY\r\nTAIL\r\n');
  assert(!sameRender(expected, await render('READY\r\nTAIL')));
  assert(!sameRender(expected, await render('READY\r\nTAI\r\n')));
  for (const mode of ['eof', 'pause', 'cancel']) await testWorker(mode);
  const watchdog = await guardedChild([script, '--fixture', 'watchdog-hang'], 150);
  assert(watchdog.hardTimeout && watchdog.elapsedMs < 5000 && watchdog.code !== 0);
  console.log('Windows launch/tail oracle, TCP worker, external watchdog self-tests passed; no native ConPTY or provider launched.');
}

async function testWorker(mode) {
  let socket;
  const server = net.createServer(client => { socket = client; });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const worker = new Worker(workerURL, { workerData: { pipe: { host: '127.0.0.1', port: server.address().port },
    pauseMarker: mode === 'pause' ? 'HEAD' : null, pauseMs: 20 } });
  const messages = [];
  const raw = [];
  try {
    const code = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`TCP worker ${mode} timeout`)), 2000);
      worker.on('error', caught => { clearTimeout(timer); reject(caught); });
      worker.on('exit', code => { clearTimeout(timer); resolve(code); });
      worker.on('message', message => {
        messages.push(message);
        if (message.event === 'worker-ready') {
          if (mode === 'cancel') worker.postMessage('cancel');
          else if (mode === 'pause') socket.write('HEAD');
          else socket.end('HEAD\u4e2d\r\n');
        }
        if (message.event === 'reader-resumed') socket.end('\u4e2d\r\n');
        if (message.event === 'worker-data') raw.push(Buffer.from(message.bytes));
      });
    });
    assert.equal(code, 0);
    assert(messages.some(message => message.event === 'pipe-close'));
    if (mode === 'cancel') {
      assert(messages.some(message => message.event === 'cancel-applied'));
      assert(!messages.some(message => message.event === 'pipe-end'));
    } else {
      assert.equal(Buffer.concat(raw).toString('utf8'), 'HEAD\u4e2d\r\n');
      assert(messages.some(message => message.event === 'pipe-end' && !message.cancelled));
    }
  } finally {
    socket?.destroy();
    await worker.terminate();
    await new Promise(resolve => server.close(resolve));
  }
}

function writeOutput(text) { return new Promise((resolve, reject) => process.stdout.write(text, caught => caught ? reject(caught) : resolve())); }
function isAlive(pid) { try { process.kill(pid, 0); return true; } catch (caught) { return caught.code !== 'ESRCH'; } }
function readJSON(file) { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null; }
function save(dir, name, value) { writeAtomic(path.join(dir, name), JSON.stringify(value, null, 2)); }
function writeAtomic(file, value) {
  const temporary = `${file}.${process.pid}.pending`;
  fs.writeFileSync(temporary, value);
  fs.renameSync(temporary, file);
}
function hash(value) { return createHash('sha256').update(value).digest('hex'); }
function serializeError(error) { return { name: error.name, code: error.code, message: error.message, stack: error.stack }; }
function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
