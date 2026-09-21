// Independent Win32 object-lifetime control. No PTY or installed dependency is loaded.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const script = fileURLToPath(import.meta.url);
const settings = Object.freeze({ warmup: 3, measured: 20, inspections: 3, inspectionIntervalMs: 50,
  settleMs: 100, snapshots: 5, snapshotIntervalMs: 20, waitMs: 5000 });
const schedule = [1, 2].flatMap(run => ['control', 'release-each', 'retain-until-end'].map(mode => ({ id: `${mode}-${run}`, mode, run })));
const watchdogMs = 30000;
const boundary = 'The watchdog terminates only its own driver. Logged child PIDs are not retained HANDLE ownership; no PID-based child kill is attempted. A suspended child may remain after driver termination, making the sample failed; runner disposal is not successful resource reclamation.';
const { values } = parseArgs({ options: { output: { type: 'string' }, 'verify-saved': { type: 'string' }, 'self-test': { type: 'boolean' } } });
try {
  if (values['self-test']) await selfTest();
  else if (values['verify-saved']) process.exitCode = verify(path.resolve(values['verify-saved'])).pass ? 0 : 1;
  else await run();
} catch (error) { console.error(error.stack ?? error); process.exitCode = 1; }

function hash(value) { return createHash('sha256').update(value).digest('hex'); }
function fingerprint(file) { const raw = fs.readFileSync(file); return { hash: hash(raw), lfHash: hash(raw.toString('utf8').replaceAll('\r\n', '\n')) }; }
function read(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function save(dir, name, value) { const file = path.join(dir, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2)); }
function list(dir, prefix = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    assert(!entry.isSymbolicLink(), `Unexpected evidence symlink: ${entry.name}`);
    const name = path.posix.join(prefix, entry.name); return entry.isDirectory() ? list(path.join(dir, entry.name), name) : [name];
  }).sort();
}
function seal(dir) { save(dir, 'manifest.json', list(dir).filter(file => file !== 'manifest.json').map(file => ({ file, hash: hash(fs.readFileSync(path.join(dir, file))) }))); }
function checkManifest(dir) {
  const records = read(path.join(dir, 'manifest.json')); assert.deepEqual(records.map(r => r.file).sort(), list(dir).filter(file => file !== 'manifest.json'));
  for (const record of records) assert.equal(hash(fs.readFileSync(path.join(dir, record.file))), record.hash, record.file);
}
function runSync(file, args, options = {}) {
  const result = spawnSync(file, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 120000, ...options });
  return { file, args, cwd: options.cwd, status: result.status, signal: result.signal,
    error: result.error?.message, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}
function compile(dir) {
  const inputs = path.join(dir, 'inputs'); fs.mkdirSync(inputs);
  const source = path.join(path.dirname(script), 'windows-process-object-control.c');
  for (const file of [script, source]) fs.copyFileSync(file, path.join(inputs, path.basename(file)));
  const sources = [script, source].map(file => ({ file, snapshot: `inputs/${path.basename(file)}`, ...fingerprint(file) }));
  const record = { sources, output: 'compiled/windows-process-object-control.exe' };
  record.outputAbsolute = path.resolve(dir, record.output);
  try {
    assert.equal(process.platform, 'win32', 'Native control requires Windows');
    const located = runSync('where.exe', ['cl.exe']); record.locateCompiler = located;
    assert.equal(located.status, 0, located.stderr);
    const compiler = fs.realpathSync(located.stdout.trim().split(/\r?\n/)[0]);
    record.compiler = { path: compiler, hash: hash(fs.readFileSync(compiler)) };
    record.sdkEnvironment = Object.fromEntries(['WindowsSdkDir', 'WindowsSDKVersion', 'VCToolsInstallDir', 'VCToolsVersion', 'VSCMD_VER', 'INCLUDE', 'LIB', 'LIBPATH', 'PATH', 'CL', '_CL_'].map(name => [name, process.env[name] ?? null]));
    assert(!process.env.CL && !process.env._CL_, 'Unexpected compiler option override');
    const headers = [
      ['um', 'Windows.h'], ['um', 'processthreadsapi.h'], ['um', 'handleapi.h'], ['shared', 'windef.h'], ['shared', 'winerror.h'],
    ];
    assert(process.env.WindowsSdkDir && process.env.WindowsSDKVersion, 'Missing Windows SDK environment');
    for (const [kind, name] of headers) {
      const file = path.join(process.env.WindowsSdkDir, 'Include', process.env.WindowsSDKVersion, kind, name);
      const snapshot = `inputs/sdk/${kind}/${name}`; fs.mkdirSync(path.dirname(path.join(dir, snapshot)), { recursive: true });
      fs.copyFileSync(file, path.join(dir, snapshot)); sources.push({ file, snapshot, ...fingerprint(file) });
    }
    const build = path.join(dir, 'compiled'); fs.mkdirSync(build);
    record.command = runSync(compiler, ['/nologo', '/TC', '/W4', '/WX', '/Bv', path.join(inputs, path.basename(source)),
      `/Fe:${path.join(dir, record.output)}`, `/Fo:${path.join(build, 'windows-process-object-control.obj')}`], { cwd: build });
    assert.equal(record.command.status, 0, `Compilation failed: ${record.command.stderr || record.command.stdout}`);
    assert(!record.command.error && !record.command.signal);
    record.binaryHash = hash(fs.readFileSync(path.join(dir, record.output)));
    record.versionOutput = `${record.command.stdout}\n${record.command.stderr}`;
  } catch (error) { record.error = error.stack ?? String(error); }
  save(dir, 'compilation.json', record);
  assert(!record.error, record.error);
  return path.join(dir, record.output);
}
async function executeDriver(binary, entry, dir) {
  const stdout = [], stderr = [];
  const started = process.hrtime.bigint();
  const record = { entry, executable: binary, binaryHash: hash(fs.readFileSync(binary)), args: ['--driver', entry.mode, '--run', String(entry.run)], watchdogMs,
    timedOut: false, killAttempted: false, watchdogBoundary: boundary };
  let timer, lastResort, finished = false;
  await new Promise(resolve => {
    const child = spawn(binary, record.args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }); record.pid = child.pid;
    const finish = () => { if (finished) return; finished = true; clearTimeout(timer); clearTimeout(lastResort); record.elapsedNs = (process.hrtime.bigint() - started).toString(); resolve(); };
    child.stdout.on('data', bytes => stdout.push(Buffer.from(bytes))); child.stderr.on('data', bytes => stderr.push(Buffer.from(bytes)));
    child.on('error', error => { record.error = String(error); });
    child.on('exit', (code, signal) => { record.exitObserved = true; record.code = code; record.signal = signal; });
    child.on('close', (code, signal) => { record.closeObserved = true; record.closeCode = code; record.closeSignal = signal; finish(); });
    timer = setTimeout(() => {
      record.timedOut = true; record.killAttempted = true; record.killNs = (process.hrtime.bigint() - started).toString();
      record.killReturned = child.kill('SIGKILL');
      lastResort = setTimeout(() => { record.noCloseAfterKill = true; child.stdout.destroy(); child.stderr.destroy(); child.unref(); finish(); }, 5000);
    }, watchdogMs);
  });
  const output = Buffer.concat(stdout); fs.writeFileSync(path.join(dir, 'stdout.ndjson'), output); fs.writeFileSync(path.join(dir, 'stderr.log'), Buffer.concat(stderr));
  const owners = new Map();
  for (const line of output.toString('utf8').split(/\r?\n/).filter(Boolean)) {
    try { const e = JSON.parse(line); if (e.event === 'child-created' && e.ok) owners.set(e.ownerId, { ownerId: e.ownerId, pid: e.pid, hProcess: e.hProcess });
      if (e.event === 'process-closed' && e.ok) owners.delete(e.ownerId); } catch { /* A killed writer may leave one incomplete line. */ }
  }
  record.unsettledOwners = [...owners.values()]; save(dir, 'driver.json', record);
}
async function run() {
  assert(values.output, 'Specify --output'); const dir = path.resolve(values.output); assert(!fs.existsSync(dir), 'Refusing to overwrite evidence'); fs.mkdirSync(dir, { recursive: true });
  save(dir, 'schedule.json', { schema: 1, settings, watchdogMs, entries: schedule });
  save(dir, 'environment.json', { kind: 'native', platform: process.platform, arch: process.arch, kernel: os.release(), versions: process.versions,
    github: { sha: process.env.GITHUB_SHA, run: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT, image: process.env.ImageVersion }, watchdogBoundary: boundary });
  let binary;
  try { binary = compile(dir); } catch (error) { save(dir, 'setup-error.json', { error: error.stack ?? String(error) }); }
  fs.mkdirSync(path.join(dir, 'drivers'));
  for (const entry of schedule) {
    const sample = path.join(dir, 'drivers', entry.id); fs.mkdirSync(sample); save(sample, 'config.json', entry);
    if (binary) { try { await executeDriver(binary, entry, sample); } catch (error) { save(sample, 'collection-error.json', { error: error.stack ?? String(error) }); } }
    else save(sample, 'not-run.json', { reason: 'Compilation/setup failed', entry });
    seal(sample);
  }
  save(dir, 'shared-manifest.json', list(dir).filter(file => !file.startsWith('drivers/') && file !== 'shared-manifest.json').map(file => ({ file, hash: hash(fs.readFileSync(path.join(dir, file))) })));
  process.exitCode = verify(dir).pass ? 0 : 1;
}

function decimal(value) { assert.equal(typeof value, 'string'); assert(/^\d+$/.test(value)); return BigInt(value); }
function hex(value) { assert.equal(typeof value, 'string'); assert(/^0x[0-9a-f]+$/i.test(value)); return BigInt(value); }
function windowsPath(value) { assert.equal(typeof value, 'string'); assert(path.win32.isAbsolute(value)); return path.win32.normalize(value).toLowerCase(); }
function binaryBinding(driver, compilation) {
  assert.equal(windowsPath(driver.executable), windowsPath(compilation.outputAbsolute), 'Driver did not use compiled executable');
  assert.equal(driver.binaryHash, compilation.binaryHash, 'Driver executable hash mismatch');
}
function success(value) { assert.equal(value.ok, true); assert.equal(value.error, 0); }
function minimumGap(later, earlier, ms) { assert(decimal(later.elapsedNs) - decimal(earlier.elapsedNs) >= BigInt(ms) * 1000000n, `Expected at least ${ms} ms`); }
function evaluate(events, driver, entry) {
  assert(events.length, 'No native events');
  assert(!driver.error && !driver.timedOut && !driver.killAttempted && !driver.noCloseAfterKill, 'Non-natural driver termination');
  assert(driver.exitObserved && driver.closeObserved); assert.equal(driver.code, 0); assert.equal(driver.closeCode, 0); assert.equal(driver.signal, null); assert.equal(driver.closeSignal, null);
  assert.deepEqual(driver.unsettledOwners, []);
  for (const [index, e] of events.entries()) {
    assert.equal(e.schema, 1); assert.equal(e.seq, index); assert.equal(e.driverPid, driver.pid);
    const ns = decimal(e.elapsedNs), ticks = decimal(e.qpcTicks);
    if (index) { assert(ns >= decimal(events[index - 1].elapsedNs)); assert(ticks >= decimal(events[index - 1].qpcTicks)); }
    assert(!['failure', 'cleanup-terminate'].includes(e.event), `Native failure event: ${e.event}`);
    if ('cleanup' in e) assert.equal(e.cleanup, false);
  }
  let cursor = 0;
  const next = name => { const e = events[cursor++]; assert(e, `Missing event ${name}`); assert.equal(e.event, name, `Event ${cursor - 1}`); return e; };
  const start = next('driver-start'); assert.equal(start.mode, entry.mode); assert.equal(start.run, entry.run); assert.deepEqual(start.settings, settings);
  assert.equal(windowsPath(start.executable), windowsPath(driver.executable)); assert(decimal(start.qpcFrequency) > 0n);
  let baseline, snapshotCount = 0, processClosed = 0, threadClosed = 0, childCount = 0;
  const retained = [];
  const sample = (groupId, phase, sessionIndex, owned) => {
    const begin = next('snapshot-group-begin'); assert.equal(begin.groupId, groupId); assert.equal(begin.phase, phase); assert.equal(begin.sessionIndex, sessionIndex); assert.equal(begin.ownedProcessHandles, owned);
    const samples = [];
    for (let index = 0; index < settings.snapshots; index++) {
      const e = next('snapshot'); assert.equal(e.groupId, groupId); assert.equal(e.sample, index); success(e); assert(Number.isInteger(e.handles) && e.handles > 0);
      minimumGap(e, index ? samples.at(-1) : begin, index ? settings.snapshotIntervalMs : settings.settleMs); samples.push(e); snapshotCount++;
    }
    if (!baseline) baseline = { min: Math.min(...samples.map(e => e.handles)), max: Math.max(...samples.map(e => e.handles)) };
    for (const e of samples) assert(e.handles >= baseline.min + owned && e.handles <= baseline.max + owned,
      `${groupId}: count ${e.handles} outside initial [${baseline.min},${baseline.max}] + ${owned}`);
  };
  sample('initial', 'initial', null, 0);
  for (let index = 0; index < settings.warmup + settings.measured; index++) {
    const begin = next('session-begin'); assert.equal(begin.sessionIndex, index); assert.equal(begin.expectedExit, index % 2 ? 7 : 0); assert.equal(begin.phase, index < 3 ? 'warmup' : 'measured');
    let created;
    if (entry.mode === 'control') {
      let previous;
      for (let inspection = 0; inspection < 3; inspection++) { const e = next('control-inspection'); assert.equal(e.sessionIndex, index); assert.equal(e.inspection, inspection); if (previous) minimumGap(e, previous, 50); previous = e; }
    } else {
      created = next('child-created'); success(created); assert.equal(created.sessionIndex, index); assert.equal(created.ownerId, `session-${index}`);
      assert(Number.isInteger(created.pid) && created.pid > 0 && created.pid !== driver.pid); assert(Number.isInteger(created.threadId) && created.threadId > 0);
      assert(hex(created.hProcess) > 0n); assert(hex(created.hThread) > 0n); assert.notEqual(created.hThread, created.hProcess);
      for (const owner of retained) { assert.notEqual(hex(owner.hProcess), hex(created.hProcess), 'Active process handle slot reused'); assert.notEqual(hex(owner.hProcess), hex(created.hThread), 'Thread handle reused active process slot'); }
      assert.equal(created.flags, 134217732); assert.equal(created.inheritHandles, false); childCount++;
      let creationTime, exitTime;
      const inspect = (phase, inspection) => {
        const e = next('process-inspection'); assert.equal(e.sessionIndex, index); assert.equal(e.ownerId, created.ownerId); assert.equal(e.hProcess, created.hProcess); assert.equal(e.phase, phase); assert.equal(e.inspection, inspection);
        assert.equal(e.wait.timeoutMs, 0); assert.equal(e.wait.error, 0); assert.equal(e.wait.result, phase === 'suspended' ? 258 : 0);
        success(e.pidQuery); assert.equal(e.pidQuery.value, created.pid); success(e.exitCodeQuery); assert.equal(e.exitCodeQuery.value, phase === 'suspended' ? 259 : begin.expectedExit);
        success(e.timesQuery); const time = hex(e.timesQuery.creationTime); assert(time > 0n); hex(e.timesQuery.exitTime); hex(e.timesQuery.kernelTime); hex(e.timesQuery.userTime);
        if (creationTime === undefined) creationTime = time; else assert.equal(time, creationTime);
        if (phase !== 'suspended') { const exited = hex(e.timesQuery.exitTime); assert(exited > 0n); if (exitTime === undefined) exitTime = exited; else assert.equal(exited, exitTime); }
        assert.equal(e.imageQuery.attempted, true); assert.equal(typeof e.imageQuery.ok, 'boolean'); assert(Number.isInteger(e.imageQuery.error) && e.imageQuery.error >= 0);
        if (e.imageQuery.ok) { assert.equal(e.imageQuery.error, 0); assert.equal(typeof e.imageQuery.path, 'string'); }
        else assert.equal(e.imageQuery.path, null);
        return e;
      };
      inspect('suspended', null);
      const resumed = next('child-resumed'); assert.equal(resumed.ownerId, created.ownerId); success(resumed); assert.equal(resumed.previousSuspendCount, 1);
      const thread = next('thread-closed'); assert.equal(thread.ownerId, created.ownerId); assert.equal(thread.hThread, created.hThread); success(thread); assert.equal(thread.cleanup, false); threadClosed++;
      const wait = next('process-wait'); assert.equal(wait.ownerId, created.ownerId); assert.equal(wait.timeoutMs, 5000); assert.equal(wait.result, 0); success(wait); assert.equal(wait.cleanup, false);
      inspect('exited', null); let previous;
      for (let inspection = 0; inspection < 3; inspection++) { const e = inspect('retained', inspection); if (previous) minimumGap(e, previous, 50); previous = e; }
      if (entry.mode === 'release-each') { const e = next('process-closed'); assert.equal(e.ownerId, created.ownerId); assert.equal(e.hProcess, created.hProcess); success(e); assert.equal(e.cleanup, false); processClosed++; }
      else retained.push(created);
    }
    const end = next('session-complete'); assert.equal(end.sessionIndex, index); assert.equal(end.ownerId, created?.ownerId ?? null);
    assert.equal(end.retained, entry.mode === 'retain-until-end'); assert.equal(end.ownedProcessHandles, retained.length);
    if (index >= 2) sample(index === 2 ? 'warmup' : `measured-${index}`, index === 2 ? 'warmup' : 'measured', index, retained.length);
  }
  if (entry.mode === 'retain-until-end') {
    const release = next('final-release-begin'); assert.deepEqual(release.ownerIds, retained.map(owner => owner.ownerId));
    for (const owner of retained) { const e = next('process-closed'); assert.equal(e.ownerId, owner.ownerId); assert.equal(e.hProcess, owner.hProcess); success(e); assert.equal(e.cleanup, false); processClosed++; }
  }
  sample('final', 'final', null, 0);
  const complete = next('driver-complete'); assert.equal(complete.ok, true); assert.equal(complete.created, childCount); assert.equal(complete.threadClosed, threadClosed); assert.equal(complete.processClosed, processClosed);
  assert.equal(complete.retainedCount, 0); assert.equal(complete.forcedTerminations, 0); assert.equal(complete.failures, 0); assert.equal(cursor, events.length);
  assert.equal(snapshotCount, 115); assert.equal(childCount, entry.mode === 'control' ? 0 : 23); assert.equal(threadClosed, childCount); assert.equal(processClosed, childCount);
  return { childCount, snapshotCount, initialHandles: baseline, observedImageResults: events.filter(e => e.event === 'process-inspection').reduce((counts, e) => {
    const key = e.imageQuery.ok ? 'success' : `error-${e.imageQuery.error}`; counts[key] = (counts[key] ?? 0) + 1; return counts;
  }, {}) };
}
function parseEvents(raw, driver) {
  const lines = raw.toString('utf8').split(/\r?\n/).filter(Boolean), events = [];
  for (let index = 0; index < lines.length; index++) {
    try { events.push(JSON.parse(lines[index])); }
    catch (error) { if (driver.timedOut && index === lines.length - 1) return { events, truncatedByWatchdog: true }; throw error; }
  }
  return { events, truncatedByWatchdog: false };
}
function verify(dir, quiet = false, synthetic = false) {
  const report = { kind: synthetic ? 'synthetic-self-test' : 'native-evidence-offline', attempted: 0, verified: 0, results: [], failures: [], evidenceErrors: [] };
  let compilation;
  try {
    assert.deepEqual(read(path.join(dir, 'schedule.json')), { schema: 1, settings, watchdogMs, entries: schedule });
    const shared = read(path.join(dir, 'shared-manifest.json'));
    assert.deepEqual(shared.map(r => r.file).sort(), list(dir).filter(file => !file.startsWith('drivers/') && file !== 'shared-manifest.json'));
    for (const record of shared) assert.equal(hash(fs.readFileSync(path.join(dir, record.file))), record.hash, record.file);
    const env = read(path.join(dir, 'environment.json')); assert.equal(env.platform, 'win32'); assert.equal(env.kind, synthetic ? 'synthetic' : 'native');
    assert(!fs.existsSync(path.join(dir, 'setup-error.json')), 'Setup failed');
    compilation = read(path.join(dir, 'compilation.json')); assert(!compilation.error); assert.equal(compilation.command.status, 0);
    for (const name of ['diagnose-windows-process-objects.mjs', 'windows-process-object-control.c']) assert.equal(compilation.sources.filter(source => source.snapshot === `inputs/${name}`).length, 1, `Missing or duplicated source ${name}`);
    assert.equal(hash(fs.readFileSync(path.join(dir, compilation.output))), compilation.binaryHash);
    for (const source of compilation.sources) { const current = fingerprint(path.join(dir, source.snapshot)); assert.equal(current.hash, source.hash); assert.equal(current.lfHash, source.lfHash); }
  } catch (error) { report.evidenceErrors.push({ scope: 'shared', error: String(error) }); }
  for (const entry of schedule) {
    report.attempted++;
    try {
      const root = path.join(dir, 'drivers', entry.id); checkManifest(root); assert.deepEqual(read(path.join(root, 'config.json')), entry);
      if (fs.existsSync(path.join(root, 'not-run.json'))) { report.verified++; report.failures.push({ id: entry.id, reason: 'Native driver was not run', details: read(path.join(root, 'not-run.json')) }); continue; }
      const driver = read(path.join(root, 'driver.json')); assert.deepEqual(driver.entry, entry); assert.deepEqual(driver.args, ['--driver', entry.mode, '--run', String(entry.run)]);
      binaryBinding(driver, compilation);
      assert.equal(driver.watchdogMs, watchdogMs); assert.equal(driver.watchdogBoundary, boundary);
      const parsed = parseEvents(fs.readFileSync(path.join(root, 'stdout.ndjson')), driver); fs.readFileSync(path.join(root, 'stderr.log'));
      report.verified++;
      try { report.results.push({ id: entry.id, pass: true, ...evaluate(parsed.events, driver, entry) }); }
      catch (error) { report.failures.push({ id: entry.id, error: String(error), timedOut: driver.timedOut, truncatedByWatchdog: parsed.truncatedByWatchdog, unsettledOwners: driver.unsettledOwners,
        nativeFailures: parsed.events.filter(e => e.event === 'failure' || e.event === 'cleanup-terminate'), completion: parsed.events.filter(e => e.event === 'driver-complete') }); }
    } catch (error) { report.evidenceErrors.push({ id: entry.id, error: String(error) }); }
  }
  report.pass = report.verified === schedule.length && !report.failures.length && !report.evidenceErrors.length;
  if (!quiet) console.log(JSON.stringify({ ...report, note: 'Normal process-object semantics only. No PTY or HPCON attribution; offline verification does not execute native code.' }));
  return report;
}

function syntheticDriver(entry) {
  const events = []; let ns = 0n, handles = 0, children = 0; const executable = 'C:\\synthetic\\control.exe';
  const add = (event, details = {}, delayMs = 1) => { ns += BigInt(delayMs) * 1000000n; const e = { schema: 1, event, seq: events.length, driverPid: 100, elapsedNs: ns.toString(), qpcTicks: ns.toString(), ...details }; events.push(e); return e; };
  const samples = (groupId, phase, sessionIndex) => { add('snapshot-group-begin', { groupId, phase, sessionIndex, ownedProcessHandles: handles });
    for (let sample = 0; sample < 5; sample++) add('snapshot', { groupId, sample, handles: 50 + handles, ok: true, error: 0 }, sample ? 20 : 100); };
  add('driver-start', { mode: entry.mode, run: entry.run, executable, qpcFrequency: '1000000000', settings }); samples('initial', 'initial', null);
  for (let index = 0; index < 23; index++) {
    const ownerId = `session-${index}`, expectedExit = index % 2 ? 7 : 0, hProcess = `0x${(1000 + index * 8).toString(16)}`, hThread = `0x${(1004 + index * 8).toString(16)}`;
    add('session-begin', { sessionIndex: index, expectedExit, phase: index < 3 ? 'warmup' : 'measured' });
    if (entry.mode === 'control') { for (let inspection = 0; inspection < 3; inspection++) add('control-inspection', { sessionIndex: index, inspection }, inspection ? 50 : 0); }
    else {
      children++; handles++; add('child-created', { sessionIndex: index, ownerId, pid: 200 + index, threadId: 400 + index, hProcess, hThread, flags: 134217732, inheritHandles: false, ok: true, error: 0 });
      const inspect = (phase, inspection, delay) => add('process-inspection', { sessionIndex: index, ownerId, hProcess, phase, inspection,
        wait: { result: phase === 'suspended' ? 258 : 0, error: 0, timeoutMs: 0 }, pidQuery: { ok: true, value: 200 + index, error: 0 },
        exitCodeQuery: { ok: true, value: phase === 'suspended' ? 259 : expectedExit, error: 0 },
        timesQuery: { ok: true, creationTime: '0x1000', exitTime: phase === 'suspended' ? '0xabcdef' : '0x2000', kernelTime: '0x0', userTime: '0x1', error: 0 },
        imageQuery: index % 2 ? { attempted: true, ok: false, path: null, error: 31 } : { attempted: true, ok: true, path: executable, error: 0 } }, delay ?? 1);
      inspect('suspended', null); add('child-resumed', { ownerId, previousSuspendCount: 1, ok: true, error: 0 }); add('thread-closed', { ownerId, hThread, ok: true, error: 0, cleanup: false });
      add('process-wait', { ownerId, timeoutMs: 5000, result: 0, ok: true, error: 0, cleanup: false }); inspect('exited', null);
      for (let inspection = 0; inspection < 3; inspection++) inspect('retained', inspection, inspection ? 50 : 0);
      if (entry.mode === 'release-each') { add('process-closed', { ownerId, hProcess, ok: true, error: 0, cleanup: false }); handles--; }
    }
    add('session-complete', { sessionIndex: index, ownerId: entry.mode === 'control' ? null : ownerId, retained: entry.mode === 'retain-until-end', ownedProcessHandles: handles });
    if (index >= 2) samples(index === 2 ? 'warmup' : `measured-${index}`, index === 2 ? 'warmup' : 'measured', index);
  }
  if (entry.mode === 'retain-until-end') { add('final-release-begin', { ownerIds: Array.from({ length: 23 }, (_, i) => `session-${i}`) });
    for (let index = 0; index < 23; index++) add('process-closed', { ownerId: `session-${index}`, hProcess: `0x${(1000 + index * 8).toString(16)}`, ok: true, error: 0, cleanup: false }); handles = 0; }
  samples('final', 'final', null); add('driver-complete', { ok: true, created: children, threadClosed: children, processClosed: children, retainedCount: 0, forcedTerminations: 0, failures: 0 });
  return { events, driver: { entry, executable, binaryHash: hash('synthetic-only-not-executable'), args: ['--driver', entry.mode, '--run', String(entry.run)], watchdogMs, watchdogBoundary: boundary,
    pid: 100, timedOut: false, killAttempted: false, exitObserved: true, closeObserved: true, code: 0, closeCode: 0, signal: null, closeSignal: null, unsettledOwners: [] } };
}
function syntheticEvidence(dir) {
  fs.mkdirSync(dir); save(dir, 'schedule.json', { schema: 1, settings, watchdogMs, entries: schedule }); save(dir, 'environment.json', { platform: 'win32', kind: 'synthetic' });
  fs.mkdirSync(path.join(dir, 'inputs')); fs.copyFileSync(script, path.join(dir, 'inputs/diagnose-windows-process-objects.mjs'));
  const c = path.join(dir, 'inputs/windows-process-object-control.c'); fs.writeFileSync(c, '/* Synthetic input, never compiled. */\n'); fs.writeFileSync(path.join(dir, 'inputs/fake.exe'), 'synthetic-only-not-executable');
  save(dir, 'compilation.json', { command: { status: 0 }, output: 'inputs/fake.exe', outputAbsolute: 'C:\\synthetic\\control.exe', binaryHash: hash(fs.readFileSync(path.join(dir, 'inputs/fake.exe'))),
    sources: [{ snapshot: 'inputs/diagnose-windows-process-objects.mjs', ...fingerprint(script) }, { snapshot: 'inputs/windows-process-object-control.c', ...fingerprint(c) }] });
  for (const entry of schedule) {
    const root = path.join(dir, 'drivers', entry.id); fs.mkdirSync(root, { recursive: true }); const fixture = syntheticDriver(entry);
    save(root, 'config.json', entry); save(root, 'driver.json', fixture.driver); fs.writeFileSync(path.join(root, 'stdout.ndjson'), fixture.events.map(e => JSON.stringify(e)).join('\n') + '\n'); fs.writeFileSync(path.join(root, 'stderr.log'), ''); seal(root);
  }
  save(dir, 'shared-manifest.json', list(dir).filter(file => !file.startsWith('drivers/') && file !== 'shared-manifest.json').map(file => ({ file, hash: hash(fs.readFileSync(path.join(dir, file))) })));
}
async function selfTest() {
  const configured = process.env.DSC_PROCESS_OBJECT_SELFTEST_EVIDENCE || process.env.DSC_ATTRIBUTION_SELFTEST_EVIDENCE;
  const dir = configured ? path.resolve(configured) : fs.mkdtempSync(path.join(os.tmpdir(), 'dsc-process-object-selftest-'));
  if (configured) { assert(!fs.existsSync(dir), 'Refusing to overwrite self-test evidence'); fs.mkdirSync(dir, { recursive: true }); }
  console.log(JSON.stringify({ kind: 'synthetic-self-test', dir })); fs.copyFileSync(script, path.join(dir, 'script.mjs'));
  const nativeSource = path.join(path.dirname(script), 'windows-process-object-control.c');
  if (fs.existsSync(nativeSource)) fs.copyFileSync(nativeSource, path.join(dir, 'native-source-input.c'));
  const checks = [];
  try {
    for (const entry of schedule) { const sample = syntheticDriver(entry); evaluate(sample.events, sample.driver, entry); } checks.push('all-six-positive-drivers');
    const binary = syntheticDriver(schedule[1]); assert.throws(() => binaryBinding(binary.driver, { outputAbsolute: 'C:\\wrong\\other.exe', binaryHash: binary.driver.binaryHash }));
    assert.throws(() => binaryBinding(binary.driver, { outputAbsolute: binary.driver.executable, binaryHash: 'wrong' })); checks.push('wrong-binary-path-and-hash-rejected');
    const entry = schedule[1];
    for (const [name, mutate] of [
      ['wrong-count', x => { x.events.filter(e => e.event === 'snapshot').at(-1).handles++; }],
      ['fake-exit', x => { x.events.find(e => e.event === 'process-inspection' && e.phase === 'exited').wait.result = 258; }],
      ['duplicate-close', x => { const at = x.events.findIndex(e => e.event === 'process-closed'); x.events.splice(at, 0, structuredClone(x.events[at])); x.events.forEach((e, i) => e.seq = i); }],
      ['unreleased-owner', x => { x.events.at(-1).retainedCount = 1; }],
      ['forced-termination', x => { x.driver.timedOut = true; x.driver.killAttempted = true; }],
      ['query-after-close', x => { const a = x.events.findIndex(e => e.event === 'process-closed'), b = x.events.findIndex(e => e.event === 'process-inspection'); [x.events[a], x.events[b]] = [x.events[b], x.events[a]]; x.events.forEach((e, i) => e.seq = i); }],
    ]) { const fixture = syntheticDriver(entry); mutate(fixture); assert.throws(() => evaluate(fixture.events, fixture.driver, entry)); checks.push(`${name}-rejected`); }
    const alias = syntheticDriver(schedule[2]); const creates = alias.events.filter(e => e.event === 'child-created'); creates[1].hProcess = creates[0].hProcess;
    assert.throws(() => evaluate(alias.events, alias.driver, schedule[2])); checks.push('active-handle-alias-rejected');
    const saved = path.join(dir, 'synthetic-positive'); syntheticEvidence(saved); const positive = verify(saved, true, true); assert(positive.pass); save(dir, 'positive-report.json', positive);
    const negative = path.join(dir, 'synthetic-negative'); syntheticEvidence(negative);
    const first = path.join(negative, 'drivers', schedule[0].id), last = path.join(negative, 'drivers', schedule.at(-1).id);
    const fixture = syntheticDriver(schedule.at(-1)); fixture.events.at(-1).retainedCount = 1; fs.writeFileSync(path.join(last, 'stdout.ndjson'), fixture.events.map(e => JSON.stringify(e)).join('\n') + '\n'); seal(last);
    const validNegative = verify(negative, true, true); assert.equal(validNegative.verified, 6); assert.equal(validNegative.failures.length, 1); assert.equal(validNegative.evidenceErrors.length, 0); save(dir, 'valid-negative-report.json', validNegative);
    fs.appendFileSync(path.join(first, 'stdout.ndjson'), 'broken'); const corrupt = verify(negative, true, true); assert.equal(corrupt.attempted, 6); assert.equal(corrupt.verified, 5); assert.equal(corrupt.failures[0].id, schedule.at(-1).id); assert.equal(corrupt.evidenceErrors.length, 1); save(dir, 'corrupt-report.json', corrupt); checks.push('first-corrupt-last-failure-still-verified');
    const missing = path.join(dir, 'synthetic-missing'); syntheticEvidence(missing); fs.unlinkSync(path.join(missing, 'drivers', schedule[0].id, 'stdout.ndjson'));
    const incomplete = verify(missing, true, true); assert.equal(incomplete.attempted, 6); assert.equal(incomplete.verified, 5); assert.equal(incomplete.evidenceErrors.length, 1); save(dir, 'missing-report.json', incomplete); checks.push('missing-evidence-continues');
    const watchdog = { timedOut: true }; assert(parseEvents(Buffer.from('{"event":"last-good"}\n{"event":'), watchdog).truncatedByWatchdog); assert.throws(() => parseEvents(Buffer.from('broken\n'), { timedOut: false })); checks.push('watchdog-partial-line-distinguished');
    const absentSource = path.join(dir, 'synthetic-missing-source'); syntheticEvidence(absentSource);
    const compile = read(path.join(absentSource, 'compilation.json')); compile.sources.pop(); save(absentSource, 'compilation.json', compile);
    save(absentSource, 'shared-manifest.json', list(absentSource).filter(file => !file.startsWith('drivers/') && file !== 'shared-manifest.json').map(file => ({ file, hash: hash(fs.readFileSync(path.join(absentSource, file))) })));
    const absent = verify(absentSource, true, true); assert.equal(absent.attempted, 6); assert(absent.evidenceErrors.some(e => e.scope === 'shared')); save(dir, 'missing-source-report.json', absent); checks.push('missing-C-source-rejected');
    save(dir, 'result.json', { kind: 'synthetic-self-test', pass: true, checks }); console.log(JSON.stringify({ kind: 'synthetic-self-test', pass: true, checks, dir }));
  } catch (error) { save(dir, 'result.json', { kind: 'synthetic-self-test', pass: false, checks, error: error.stack ?? String(error) }); throw error; }
}
