import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const script = fileURLToPath(import.meta.url);
const require = createRequire(import.meta.url);
const settings = Object.freeze({ runs: 3, readyHoldMs: 100, collectionMs: 8000,
  cleanupMs: 2000, hardDeadlineMs: 12000, pollMs: 5 });
const scenarios = ['direct-subject', 'shell-exec', 'node-wait', 'node-nonwait'];
const scope = 'Actual bridge with controlled POSIX fixtures; no real Agent, source EOF, Host/Webview, or Windows acceptance.';
const { values } = parseArgs({ options: {
  output: { type: 'string' }, 'verify-saved': { type: 'string' },
  fixture: { type: 'string' }, dir: { type: 'string' }, token: { type: 'string' },
  negative: { type: 'boolean', default: false }
} });
let ownedOutput;

if (values.fixture) {
  await runFixture(values);
} else if (values['verify-saved']) {
  verifySaved(path.resolve(values['verify-saved']));
} else {
  try { await main(); }
  catch (error) {
    if (ownedOutput) {
      if (!fs.existsSync(path.join(ownedOutput, 'startup-error.json'))) {
        writeJson(path.join(ownedOutput, 'startup-error.json'), { error: serializeError(error), scriptHash: hash(fs.readFileSync(script)) });
      }
    }
    throw error;
  }
}

async function main() {
  assert(['linux', 'darwin'].includes(process.platform), 'POSIX-only: Windows requires its own native launch-chain protocol.');
  assert(values.output, '--output must name a new evidence directory');
  const output = path.resolve(values.output);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.mkdirSync(output);
  ownedOutput = output;
  const schedule = scenarios.flatMap(scenario => Array.from({ length: settings.runs }, (_, index) => ({
    scenario, run: index + 1, name: `${scenario}-${index + 1}`, token: randomUUID()
  })));
  writeJson(path.join(output, 'schedule.json'), schedule);
  const bridgePath = path.resolve('extensions/vscode/dev-session-canvas/src/panel/executionSessionBridge.ts');
  const { build } = await import('esbuild');
  const bundle = await build({ entryPoints: [bridgePath], bundle: true, write: false,
    external: ['node-pty'], format: 'cjs', platform: 'node', target: 'node18' });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', '__filename', '__dirname', bundle.outputFiles[0].text)(
    require, module, module.exports, bridgePath, path.dirname(bridgePath));
  const { createExecutionSessionProcess } = module.exports;
  const nativeInfo = require('node-pty/lib/utils').loadNativeModule('pty');
  const unixPath = require.resolve('node-pty/lib/unixTerminal');
  const nativePath = path.resolve(path.dirname(unixPath), nativeInfo.dir, 'pty.node');
  const helperPath = path.resolve(path.dirname(unixPath), nativeInfo.dir, 'spawn-helper');
  if (process.platform === 'darwin') {
    assert(fs.statSync(helperPath).mode & 0o111, 'The existing macOS spawn-helper must already be executable.');
  }
  writeJson(path.join(output, 'environment.json'), {
    scope, executable: process.execPath, platform: process.platform, arch: process.arch,
    kernel: os.release(), versions: process.versions, ptyVersion: require('node-pty/package.json').version,
    settings, scenarios, bundleHash: hash(bundle.outputFiles[0].contents),
    helper: { path: helperPath, present: fs.existsSync(helperPath), requiredByPlatform: process.platform === 'darwin' },
    sourceHashes: Object.fromEntries([script, bridgePath, unixPath, nativePath, helperPath]
      .filter(file => fs.existsSync(file))
      .map(file => [file, hash(fs.readFileSync(file))]))
  });
  const results = [];
  for (const item of schedule) {
    const result = await sample(item, output, createExecutionSessionProcess, nativeInfo.module);
    results.push(result);
    writeJson(path.join(output, 'summary.json'), results);
    console.log(JSON.stringify({ name: item.name, pass: result.assessment.pass,
      nativeExit: result.nativeExit?.exitCode, publicExit: result.publicExit?.exitCode,
      cleanupLive: result.cleanup.live.length, cleanupZombies: result.cleanup.zombies.length }));
  }
  const cleanup = classifyProcesses(processTable(), new Set(results.map(result => result.bridgePid)),
    new Set(results.flatMap(result => result.confirmedPids)));
  writeJson(path.join(output, 'cleanup.json'), cleanup);
  const failures = results.filter(result => !result.assessment.pass);
  console.log(JSON.stringify({ output, samples: results.length, failures: failures.length,
    cleanupLive: cleanup.live.length, cleanupZombies: cleanup.zombies.length, scope }));
  if (failures.length || cleanup.live.length) process.exitCode = 1;
}

async function sample(item, output, createProcess, native) {
  const dir = path.join(output, item.name);
  fs.mkdirSync(dir);
  const started = performance.now();
  const raw = [];
  const trace = [];
  const confirmedPids = new Set();
  let bridge, bridgePid, nativeExit, publicExit, failure, readyObservation, gateReleased;
  let timedOut = false, cleanup = { live: [], zombies: [] };
  let outputSubscription, exitSubscription;
  const negative = item.scenario === 'node-nonwait';
  const expected = `READY:${item.token}\r\n${negative ? '' : `TAIL:${item.token}\r\n`}`;
  const env = { PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`, TERM: 'xterm-256color',
    LANG: 'C.UTF-8', ELECTRON_RUN_AS_NODE: '1' };
  const args = [script, '--fixture', item.scenario === 'node-wait' ? 'wait' : negative ? 'nonwait' : 'subject',
    '--dir', dir, '--token', item.token];
  let file = process.execPath;
  let launchArgs = args;
  if (item.scenario === 'shell-exec') {
    file = '/bin/sh';
    launchArgs = ['-c', `exec ${[process.execPath, ...args].map(quote).join(' ')}`];
  }
  const launchSpec = { file, args: launchArgs, env, cwd: dir, cols: 96, rows: 28 };
  writeJson(path.join(dir, 'launch.json'), { ...item, launchSpec });
  const mark = (event, details = {}) => trace.push({ ms: round(performance.now() - started), event, ...details });
  const readReceipt = name => readJson(path.join(dir, `${name}.json`));
  const subjectState = () => {
    const receipt = readReceipt('subject-ready');
    const valid = receipt?.token === item.token && receipt?.role === 'subject' && Number.isInteger(receipt.pid);
    const entry = valid ? processTable().find(entry => entry.pid === receipt.pid) : undefined;
    const confirmed = entry && entry.args.includes(script) && entry.args.includes(item.token);
    if (confirmed) confirmedPids.add(receipt.pid);
    return { receipt: receipt ?? null, process: entry ?? null,
      live: Boolean(confirmed && !entry.stat.startsWith('Z')) };
  };
  const snapshot = () => ({ ...item, bridgePid, nativeExit, publicExit, readyObservation, gateReleased,
    timedOut, failure, confirmedPids: [...confirmedPids], cleanup,
    rawHash: hash(raw.join('')), expectedHash: hash(expected), expected,
    rawBytes: Buffer.byteLength(raw.join('')), exact: raw.join('') === expected,
    receipts: { subjectReady: readReceipt('subject-ready'), subjectExit: readReceipt('subject-exit'),
      wrapperReady: readReceipt('wrapper-ready'), wrapperExit: readReceipt('wrapper-exit'),
      fixtureError: readReceipt('fixture-error') }, durationMs: round(performance.now() - started) });
  const save = (fileName = 'result.json') => {
    const result = snapshot();
    result.assessment = assess(result);
    fs.writeFileSync(path.join(dir, 'raw.txt'), raw.join(''));
    writeJson(path.join(dir, 'trace.json'), trace);
    writeJson(path.join(dir, fileName), result);
    return result;
  };
  const cleanupSignals = () => {
    const table = processTable();
    const group = table.filter(entry => entry.pgid === bridgePid && entry.pid !== process.pid);
    // The group was created by this PTY; reject a reused/unrelated process identity before signalling.
    const liveGroup = group.filter(entry => !entry.stat.startsWith('Z'));
    if (liveGroup.length && liveGroup.every(entry => entry.args.includes(script) && entry.args.includes(item.token))) {
      safeKill(-bridgePid);
      mark('fixture-group-killed', { pgid: bridgePid });
    }
    for (const pid of confirmedPids) {
      const entry = table.find(entry => entry.pid === pid);
      if (entry && !entry.stat.startsWith('Z') && entry.args.includes(script) && entry.args.includes(item.token)) {
        safeKill(pid);
        mark('confirmed-fixture-killed', { pid });
      }
    }
  };
  const fatal = (error, origin) => {
    failure = { origin, ...serializeError(error instanceof Error ? error : new Error(String(error))) };
    mark('fatal-process-error', failure);
    try { cleanupSignals(); } catch (cleanupError) { mark('fatal-cleanup-error', serializeError(cleanupError)); }
    try { cleanup = classifyProcesses(processTable(), new Set([bridgePid]), confirmedPids); }
    catch (cleanupError) { mark('fatal-process-table-error', serializeError(cleanupError)); }
    try { save('fatal-error.json'); }
    catch (saveError) {
      fs.writeFileSync(path.join(dir, 'fatal-save-error.json'), JSON.stringify({ failure,
        saveError: serializeError(saveError), bridgePid, confirmedPids: [...confirmedPids], trace, raw }));
    }
    process.exit(2);
  };
  const onUncaughtException = error => fatal(error, 'uncaughtException');
  const onUnhandledRejection = error => fatal(error, 'unhandledRejection');
  process.on('uncaughtException', onUncaughtException);
  process.on('unhandledRejection', onUnhandledRejection);
  const hardDeadline = setTimeout(() => {
    failure = { message: 'In-process diagnostic deadline reached' };
    mark('hard-deadline');
    try { cleanupSignals(); } catch (error) { mark('hard-cleanup-error', serializeError(error)); }
    try { cleanup = classifyProcesses(processTable(), new Set([bridgePid]), confirmedPids); }
    catch (error) { mark('hard-process-table-error', serializeError(error)); }
    save('hard-deadline.json');
    process.exit(2);
  }, settings.hardDeadlineMs);
  try {
    const originalFork = native.fork;
    native.fork = function (...forkArgs) {
      const originalExit = forkArgs.at(-1);
      forkArgs[forkArgs.length - 1] = (exitCode, signal) => {
        try {
          nativeExit = { exitCode, signal, ms: round(performance.now() - started), subject: subjectState() };
          mark('native-process-exit', nativeExit);
        } catch (error) {
          failure = serializeError(error);
          mark('native-observation-error', failure);
        } finally { originalExit(exitCode, signal); }
      };
      return originalFork.apply(this, forkArgs);
    };
    try { bridge = createProcess(launchSpec); }
    finally { native.fork = originalFork; }
    bridgePid = bridge.pid;
    assert(bridgePid > 0 && bridgePid !== process.pid);
    confirmedPids.add(bridgePid);
    mark('bridge-spawn', { bridgePid });
    outputSubscription = bridge.onData(data => {
      raw.push(data);
      mark('bridge-data', { data, bytes: Buffer.byteLength(data), hash: hash(data) });
    });
    exitSubscription = bridge.onExit(event => {
      try {
        publicExit = { ...event, ms: round(performance.now() - started), subject: subjectState() };
        mark('bridge-public-exit-not-source-eof', publicExit);
      } catch (error) { failure = serializeError(error); mark('public-observation-error', failure); }
    });
    let readyAt;
    while (performance.now() - started < settings.collectionMs) {
      const receipt = readReceipt('subject-ready');
      if (receipt && readyAt === undefined) {
        readyAt = performance.now();
        mark('ready-receipt-observed', { receipt });
        subjectState();
      }
      if (!negative && readyAt !== undefined && !gateReleased && performance.now() - readyAt >= settings.readyHoldMs) {
        readyObservation = { heldMs: round(performance.now() - readyAt), subject: subjectState(),
          nativeExited: Boolean(nativeExit), publicExited: Boolean(publicExit) };
        mark('ready-hold-check', readyObservation);
        if (!readyObservation.subject.live || nativeExit || publicExit) {
          failure = { message: 'The actual subject must remain live before gate release, without bridge/native exit' };
          break;
        }
        fs.writeFileSync(path.join(dir, 'release-gate'), `${item.token}\n`);
        gateReleased = { ms: round(performance.now() - started) };
        mark('release-gate', gateReleased);
      }
      if (nativeExit && publicExit) break;
      await delay(settings.pollMs);
    }
    if (!nativeExit || !publicExit) {
      timedOut = !failure;
      if (timedOut) mark('collection-deadline');
    }
  } catch (error) {
    failure = serializeError(error);
    mark('sample-error', failure);
  } finally {
    const cleanupStarted = performance.now();
    try {
      subjectState();
      cleanupSignals();
      do {
        cleanup = classifyProcesses(processTable(), new Set([bridgePid]), confirmedPids);
        if (!cleanup.live.length) break;
        await delay(settings.pollMs);
      } while (performance.now() - cleanupStarted < settings.cleanupMs);
      mark('cleanup-complete', cleanup);
    } catch (error) {
      failure ??= serializeError(error);
      mark('cleanup-error', serializeError(error));
    }
    outputSubscription?.dispose();
    exitSubscription?.dispose();
    const result = save();
    clearTimeout(hardDeadline);
    process.removeListener('uncaughtException', onUncaughtException);
    process.removeListener('unhandledRejection', onUnhandledRejection);
    return result;
  }
}

function assess(result) {
  const checks = {};
  const negative = result.scenario === 'node-nonwait';
  const ready = result.receipts.subjectReady;
  checks.noTimeoutOrError = !result.timedOut && !result.failure && !result.receipts.fixtureError;
  checks.readyIdentity = ready?.token === result.token && ready?.role === 'subject';
  checks.terminalAttached = ready?.tty?.stdin === true && ready?.tty?.stdout === true && ready?.tty?.stderr === true;
  checks.exactCallbackContent = result.exact === true;
  checks.nativeExit = result.nativeExit?.exitCode === (negative ? 0 : 7) && !result.nativeExit?.signal;
  checks.publicExit = result.publicExit?.exitCode === (negative ? 0 : 7) && !result.publicExit?.signal;
  checks.cleanup = result.cleanup.live.length === 0;
  if (['node-wait', 'node-nonwait'].includes(result.scenario)) {
    checks.wrapperIdentity = result.receipts.wrapperReady?.token === result.token &&
      result.receipts.wrapperReady?.pid === result.bridgePid && result.receipts.wrapperReady?.childPid === ready?.pid;
  }
  if (negative) {
    checks.distinctSubjectPid = ready?.pid > 0 && ready.pid !== result.bridgePid;
    checks.aliveAtNativeExit = result.nativeExit?.subject.live === true;
    checks.aliveAtPublicExit = result.publicExit?.subject.live === true;
    checks.noFutureOutput = !result.gateReleased && !result.receipts.subjectExit && ready?.negative === true;
    checks.wrapperDidNotWait = result.receipts.wrapperExit?.role === 'nonwait' &&
      result.receipts.wrapperExit?.childPid === ready?.pid && result.receipts.wrapperExit?.exitCode === 0;
  } else {
    checks.heldLive = result.readyObservation?.heldMs >= settings.readyHoldMs &&
      result.readyObservation?.subject.live === true && !result.readyObservation?.nativeExited &&
      !result.readyObservation?.publicExited && Boolean(result.gateReleased);
    checks.subjectTailWritten = result.receipts.subjectExit?.token === result.token &&
      result.receipts.subjectExit?.exitCode === 7 && result.receipts.subjectExit?.tailWritten === true;
    checks.subjectIdentity = result.scenario === 'node-wait' ? ready?.pid !== result.bridgePid : ready?.pid === result.bridgePid;
    if (result.scenario === 'node-wait') {
      checks.wrapperWaited = result.receipts.wrapperExit?.role === 'wait' &&
        result.receipts.wrapperExit?.childPid === ready?.pid && result.receipts.wrapperExit?.exitCode === 7;
    }
  }
  return { pass: Object.values(checks).every(Boolean), checks,
    interpretation: negative ? 'Controlled non-wait launcher does not represent its subject; not evidence of a real Agent defect.' :
      'Controlled launch-chain lifecycle and callback content only; public exit is not proof of source EOF.' };
}

async function runFixture(options) {
  const { fixture: role, dir, token, negative } = options;
  assert(dir && token && ['subject', 'wait', 'nonwait'].includes(role));
  try {
    if (role === 'subject') {
      if (negative) process.on('SIGHUP', () => {});
      const ready = { role, token, negative, pid: process.pid, ppid: process.ppid,
        tty: { stdin: Boolean(process.stdin.isTTY), stdout: Boolean(process.stdout.isTTY), stderr: Boolean(process.stderr.isTTY) } };
      fs.writeSync(1, `READY:${token}\n`);
      writeJson(path.join(dir, 'subject-ready.json'), ready);
      while (!fs.existsSync(path.join(dir, 'release-gate'))) await delay(settings.pollMs);
      assert(!negative, 'A non-wait subject must never be released to write future terminal output');
      assert.equal(fs.readFileSync(path.join(dir, 'release-gate'), 'utf8'), `${token}\n`);
      fs.writeSync(1, `TAIL:${token}\n`);
      writeJson(path.join(dir, 'subject-exit.json'), { role, token, pid: process.pid, exitCode: 7, tailWritten: true });
      process.exit(7);
    }
    const child = spawn(process.execPath, [script, '--fixture', 'subject', '--dir', dir, '--token', token,
      ...(role === 'nonwait' ? ['--negative'] : [])], { stdio: 'inherit', env: process.env });
    writeJson(path.join(dir, 'wrapper-ready.json'), { role, token, pid: process.pid, childPid: child.pid });
    const exit = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (exitCode, signal) => resolve({ exitCode, signal }));
    });
    if (role === 'wait') {
      const result = await exit;
      writeJson(path.join(dir, 'wrapper-exit.json'), { role, token, pid: process.pid, childPid: child.pid, ...result });
      process.exit(result.exitCode ?? 71);
    }
    while (!readJson(path.join(dir, 'subject-ready.json'))) {
      const exited = await Promise.race([exit, delay(settings.pollMs).then(() => null)]);
      assert.equal(exited, null, 'The negative-control subject exited before readiness');
    }
    writeJson(path.join(dir, 'wrapper-exit.json'), { role, token, pid: process.pid, childPid: child.pid, exitCode: 0 });
    process.exit(0);
  } catch (error) {
    writeJson(path.join(dir, 'fixture-error.json'), { role, token, pid: process.pid, ...serializeError(error) });
    process.exit(70);
  }
}

function verifySaved(output) {
  const environment = readJson(path.join(output, 'environment.json'));
  assert.equal(environment?.scope, scope, 'Saved evidence must retain its controlled-fixture scope');
  assert.deepEqual(environment.settings, settings);
  assert.deepEqual(environment.scenarios, scenarios);
  assert(['linux', 'darwin'].includes(environment.platform), 'Saved evidence is not from a supported POSIX platform');
  const cleanup = readJson(path.join(output, 'cleanup.json'));
  assert(Array.isArray(cleanup?.live) && Array.isArray(cleanup?.zombies), 'Missing or invalid total cleanup evidence');
  assert(cleanup.live.every(entry => !entry.stat.startsWith('Z')) &&
    cleanup.zombies.every(entry => entry.stat.startsWith('Z')), 'Cleanup must distinguish live processes and zombies');
  const schedule = readJson(path.join(output, 'schedule.json'));
  const results = readJson(path.join(output, 'summary.json'));
  assert.equal(schedule?.length, scenarios.length * settings.runs);
  assert.equal(results?.length, schedule.length);
  assert.deepEqual(schedule.map(item => `${item.scenario}:${item.run}`), scenarios.flatMap(scenario =>
    Array.from({ length: settings.runs }, (_, index) => `${scenario}:${index + 1}`)));
  for (let index = 0; index < schedule.length; index++) {
    const item = schedule[index];
    const result = results[index];
    assert.equal(result.name, item.name);
    assert.equal(result.token, item.token);
    const dir = path.join(output, item.name);
    const raw = fs.readFileSync(path.join(dir, 'raw.txt'), 'utf8');
    const expected = `READY:${item.token}\r\n${item.scenario === 'node-nonwait' ? '' : `TAIL:${item.token}\r\n`}`;
    assert.equal(result.expected, expected);
    assert.equal(result.rawHash, hash(raw));
    assert.equal(result.expectedHash, hash(expected));
    assert.equal(result.exact, raw === expected);
    assert.equal(readJson(path.join(dir, 'trace.json')).filter(event => event.event === 'bridge-data')
      .map(event => event.data).join(''), raw);
    assert.deepEqual(readJson(path.join(dir, 'result.json')), result);
    for (const [name, key] of [['subject-ready', 'subjectReady'], ['subject-exit', 'subjectExit'],
      ['wrapper-ready', 'wrapperReady'], ['wrapper-exit', 'wrapperExit'], ['fixture-error', 'fixtureError']]) {
      assert.deepEqual(readJson(path.join(dir, `${name}.json`)), result.receipts[key]);
    }
    assert.deepEqual(assess(result), result.assessment);
  }
  const failures = results.filter(result => !result.assessment.pass).length;
  console.log(JSON.stringify({ verified: results.length, failures,
    cleanupLive: cleanup.live.length, cleanupZombies: cleanup.zombies.length, evidenceScope: environment.scope,
    scope: 'Offline verification of saved schedule, callbacks, receipts and assessments; no new native samples.' }));
  if (failures || cleanup.live.length) process.exitCode = 1;
}

function processTable() {
  return execFileSync('ps', ['-axo', 'pid=,ppid=,pgid=,stat=,args='], { encoding: 'utf8', timeout: 300 })
    .split('\n').map(line => line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/))
    .filter(Boolean).map(([, pid, ppid, pgid, stat, args]) => ({ pid: Number(pid), ppid: Number(ppid), pgid: Number(pgid), stat, args }));
}
function classifyProcesses(table, groups, pids) {
  const entries = table.filter(entry => groups.has(entry.pgid) || pids.has(entry.pid));
  return { live: entries.filter(entry => !entry.stat.startsWith('Z')), zombies: entries.filter(entry => entry.stat.startsWith('Z')) };
}
function safeKill(pid) { try { process.kill(pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; } }
function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
function writeJson(file, value) {
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, file);
}
function hash(value) { return createHash('sha256').update(value).digest('hex'); }
function quote(value) { return `'${value.replaceAll("'", "'\\''")}'`; }
function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function round(value) { return Math.round(value * 1000) / 1000; }
function serializeError(error) { return { message: error.message, code: error.code, stack: error.stack }; }
