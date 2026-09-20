// Frozen side-effect diagnostic: no PTY data is read or written by this driver or fixture.
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const require = createRequire(import.meta.url);
const script = fileURLToPath(import.meta.url);
const settings = Object.freeze({ runs: 3, sampleMs: 10000, hardMs: 15000, resourceGuardMs: 1000, idleMs: 2 });
const scenarios = ['helper-stdin-master', 'helper-stdin-null'];
const schedule = scenarios.flatMap(scenario => Array.from({ length: settings.runs }, (_, index) => ({ scenario, run: index + 1 })));
const scope = 'Silent-PTY helper-spawn file-status-flag side-effect reproduction; no PTY data IO, cancellation acceptance, or product result.';
const { values } = parseArgs({ options: { output: { type: 'string' }, sample: { type: 'string' }, fixture: { type: 'string' },
  'self-test': { type: 'boolean' }, 'verify-saved': { type: 'string' } } });

try {
  if (values.fixture) await fixture(readJSON(values.fixture));
  else if (values.sample) await sample(readJSON(values.sample));
  else if (values['verify-saved']) await verifySaved(path.resolve(values['verify-saved']));
  else if (values['self-test']) selfTest();
  else await run();
} catch (error) {
  if (values.fixture) {
    const config = readJSON(values.fixture);
    save(config.dir, 'fixture-error.json', { pid: process.pid, token: config.token, error: error.stack ?? String(error) });
  } else console.error(error.stack ?? error);
  process.exitCode = 1;
}

async function fixture(config) {
  save(config.dir, 'fixture-owner.json', { pid: process.pid, token: config.token,
    configPath: path.join(config.dir, 'config.json'), stdinTTY: Boolean(process.stdin.isTTY), stdoutTTY: Boolean(process.stdout.isTTY) });
  save(config.dir, 'fixture-ready.json', { pid: process.pid, token: config.token, silent: true });
  while (!fs.existsSync(path.join(config.dir, 'exit-gate.json'))) await sleep(settings.idleMs);
  assert.equal(readJSON(path.join(config.dir, 'exit-gate.json')).token, config.token);
}

function findHeaders() {
  const candidates = process.env.DSC_NODE_INCLUDE_DIR ? [{ source: 'DSC_NODE_INCLUDE_DIR', dir: path.resolve(process.env.DSC_NODE_INCLUDE_DIR) }] :
    [{ source: 'node-executable-prefix', dir: path.resolve(path.dirname(fs.realpathSync(process.execPath)), '..', 'include', 'node') },
      { source: 'system-include', dir: '/usr/include/node' }];
  const selected = candidates.find(candidate => fs.existsSync(path.join(candidate.dir, 'node_api.h')));
  assert(selected, 'Node N-API headers are required; set DSC_NODE_INCLUDE_DIR to the Node include directory');
  const versionText = fs.readFileSync(path.join(selected.dir, 'node_version.h'), 'utf8');
  const version = ['MAJOR', 'MINOR', 'PATCH'].map(part => {
    const match = versionText.match(new RegExp(`^#define\\s+NODE_${part}_VERSION\\s+(\\d+)`, 'm'));
    assert(match, `Missing Node header ${part} version`);
    return match[1];
  }).join('.');
  return { ...selected, candidates, version };
}

function compile(output) {
  const dir = path.join(output, 'compiled');
  fs.mkdirSync(dir);
  const compiler = process.platform === 'darwin' ? 'clang' : 'gcc';
  const record = { compiler, platform: process.platform, steps: [] };
  try {
    const version = spawnSync(compiler, ['--version'], { encoding: 'utf8', timeout: 10000 });
    record.compilerVersion = { code: version.status, signal: version.signal, stdout: version.stdout ?? '', stderr: version.stderr ?? '' };
    assert.equal(version.status, 0, 'Compiler version query failed');
    record.headers = findHeaders();
    record.headers.files = [];
    fs.mkdirSync(path.join(dir, 'node-headers'));
    for (const name of ['node_api.h', 'node_api_types.h', 'js_native_api.h', 'js_native_api_types.h', 'node_version.h']) {
      const source = path.join(record.headers.dir, name), snapshot = `compiled/node-headers/${name}`;
      fs.copyFileSync(source, path.join(output, snapshot));
      record.headers.files.push({ name, source, snapshot, hash: hash(fs.readFileSync(source)) });
    }
    const specifications = [
      { sourceName: 'unix-fd-inspect.c', binaryName: 'unix-fd-inspect.node', flags: ['-I', record.headers.dir,
        '-DNODE_GYP_MODULE_NAME=unix_fd_inspect', ...(process.platform === 'darwin' ? ['-bundle', '-undefined', 'dynamic_lookup'] : ['-shared', '-fPIC'])] },
      { sourceName: 'unix-pty-readiness.c', binaryName: 'unix-pty-readiness', flags: [] },
    ];
    for (const specification of specifications) {
      const source = path.join(path.dirname(script), specification.sourceName);
      const snapshot = `compiled/${specification.sourceName}`, binary = `compiled/${specification.binaryName}`;
      fs.copyFileSync(source, path.join(output, snapshot));
      const args = ['-std=c99', '-Wall', '-Wextra', '-Werror', ...specification.flags, path.join(output, snapshot), '-o', path.join(output, binary)];
      const result = spawnSync(compiler, args, { encoding: 'utf8', timeout: 10000 });
      const step = { source, snapshot, sourceHash: hash(fs.readFileSync(source)), binary, args,
        code: result.status, signal: result.signal, stdout: result.stdout ?? '', stderr: result.stderr ?? '', error: result.error?.message };
      record.steps.push(step);
      assert.equal(result.status, 0, `Compilation failed for ${specification.sourceName}`);
      step.binaryHash = hash(fs.readFileSync(path.join(output, binary)));
    }
    record.complete = true;
  } catch (error) { record.error = error.stack ?? String(error); }
  save(output, 'compilation.json', record);
  assert(record.complete && !record.error, `Compilation failed; see ${output}/compilation.json`);
  return { inspector: path.join(dir, 'unix-fd-inspect.node'), helper: path.join(dir, 'unix-pty-readiness') };
}

function environment(output) {
  const native = require('node-pty/lib/utils').loadNativeModule('pty');
  const lib = path.dirname(require.resolve('node-pty/lib/unixTerminal'));
  const sources = [script, require.resolve('node-pty/lib/unixTerminal'), path.resolve(lib, native.dir, 'pty.node')];
  if (process.platform === 'darwin') sources.push(path.resolve(lib, native.dir, 'spawn-helper'));
  fs.mkdirSync(path.join(output, 'source-snapshot'));
  const hashes = sources.map((source, index) => {
    const snapshot = `source-snapshot/${index}-${path.basename(source)}`;
    fs.copyFileSync(source, path.join(output, snapshot));
    return { source, snapshot, hash: hash(fs.readFileSync(source)) };
  });
  save(output, 'environment.json', { platform: process.platform, arch: process.arch, kernel: os.release(), settings, scope,
    executable: process.execPath, versions: process.versions, nodePty: require('node-pty/package.json').version, hashes,
    github: { sha: process.env.GITHUB_SHA, runId: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT,
      image: process.env.ImageOS, imageVersion: process.env.ImageVersion } });
}

async function run() {
  assert(['linux', 'darwin'].includes(process.platform));
  assert(values.output, '--output must name a new directory');
  const output = path.resolve(values.output);
  assert(!fs.existsSync(output), 'Refusing to overwrite evidence');
  fs.mkdirSync(output, { recursive: true });
  save(output, 'schedule.json', { settings, entries: schedule });
  const binaries = compile(output);
  environment(output);
  const results = [];
  for (const entry of schedule) {
    const dir = path.join(output, name(entry));
    fs.mkdirSync(dir);
    const config = { ...entry, dir, token: randomUUID(), ...binaries };
    save(dir, 'config.json', config);
    const driver = await watchDriver(config);
    save(dir, 'driver-exit.json', driver);
    const cleanup = await cleanupFixture(config);
    save(dir, 'cleanup.json', cleanup);
    const result = capturedResult(config);
    Object.assign(result, { driver, cleanup, naturalExit: readOptional(path.join(dir, 'natural-exit.json')) });
    result.assessment = assess(result);
    results.push(result);
    save(output, 'summary.json', results);
    console.log(JSON.stringify({ ...entry, pass: result.assessment.pass, before: result.before?.[0]?.flags,
      after: result.after?.[0]?.flags, mask: result.nonblockMask, failures: result.assessment.failures }));
  }
  console.log(JSON.stringify({ samples: results.length, failures: results.filter(result => !result.assessment.pass).length, evidence: output }));
  if (results.some(result => !result.assessment.pass)) process.exitCode = 1;
}

async function sample(config) {
  const { dir, scenario, run } = config;
  assert(scenarios.includes(scenario));
  fs.writeFileSync(path.join(dir, 'events.ndjson'), '');
  const started = performance.now(), events = [], before = [], after = [];
  const mark = (event, detail = {}) => {
    const entry = { ms: round(performance.now() - started), event, ...detail };
    events.push(entry);
    fs.appendFileSync(path.join(dir, 'events.ndjson'), JSON.stringify(entry) + '\n');
  };
  let fd, pid, identity, nonblockMask, exit, helper, activeHelper, errorDetail;
  let closed = false, closeError = null, closeProbe = null, timedOut = false, deadlineTimer;
  let resolveExit, rejectDeadline;
  const exited = new Promise(resolve => { resolveExit = resolve; });
  const deadline = new Promise((_, reject) => { rejectDeadline = reject; });
  const bounded = promise => Promise.race([promise, deadline]);
  const close = async () => {
    assert(!activeHelper, 'Helper must have released its inherited descriptor');
    if (fd === undefined || closed) return;
    mark('fd-close-request');
    await new Promise(resolve => fs.close(fd, error => {
      closed = true; closeError = error?.code ?? null;
      try { fs.fstatSync(fd); closeProbe = 'still-open'; } catch (probeError) { closeProbe = probeError.code; }
      mark('fd-close-complete', { error: closeError, probe: closeProbe });
      resolve();
    }));
  };
  process.on('beforeExit', code => save(dir, 'natural-exit.json', { code, resources: process.getActiveResourcesInfo() }));
  process.on('exit', code => save(dir, 'process-exit.json', { code, resources: process.getActiveResourcesInfo() }));
  try {
    deadlineTimer = setTimeout(() => {
      timedOut = true;
      mark('sample-deadline', { helperPid: activeHelper?.child.pid });
      rejectDeadline(new Error('Silent-PTY sample deadline expired'));
    }, settings.sampleMs);
    const inspector = require(config.inspector);
    nonblockMask = inspector.nonblockMask;
    const native = require('node-pty/lib/utils').loadNativeModule('pty');
    const spawnHelper = path.resolve(path.dirname(require.resolve('node-pty/lib/unixTerminal')), native.dir, 'spawn-helper');
    const env = { ...process.env, TERM: 'xterm-256color', LANG: 'C.UTF-8', HISTFILE: '/dev/null' };
    ({ fd, pid } = native.module.fork(process.execPath, [script, '--fixture', path.join(dir, 'config.json')],
      Object.entries(env).filter(([, value]) => value !== undefined).map(([key, value]) => `${key}=${value}`),
      dir, 96, 28, -1, -1, true, spawnHelper, (code, signal) => { exit = { code, signal }; mark('native-exit', exit); resolveExit(); }));
    identity = fdIdentity(fd);
    save(dir, 'native-owner.json', { pid, token: config.token, identity });
    mark('spawn', { fd, pid, identity });
    while (!fs.existsSync(path.join(dir, 'fixture-ready.json'))) await bounded(sleep(settings.idleMs));
    mark('fixture-ready', { ready: readJSON(path.join(dir, 'fixture-ready.json')), fixtureAlive: alive(pid) });
    for (let observation = 1; observation <= 2; observation++) {
      const report = inspector.inspect(fd);
      before.push(report);
      mark('inspect-before', { observation, report, fixtureAlive: alive(pid) });
    }
    const child = spawn(config.helper, [], { stdio: [scenario === 'helper-stdin-master' ? fd : 'ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    helper = { pid: child.pid, stdin: scenario === 'helper-stdin-master' ? 'master' : 'null', code: null, signal: null, stdioClosed: false };
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    mark('helper-spawn', { pid: child.pid, stdin: helper.stdin });
    const completion = new Promise(resolve => {
      child.once('error', error => { helper.error = error.message; });
      child.once('close', (code, signal) => {
        Object.assign(helper, { code, signal, stdioClosed: true, stdout, stderr });
        try { helper.report = JSON.parse(stdout); } catch (error) { helper.parseError = error.message; }
        save(dir, 'helper-result.json', helper);
        mark('helper-close', { pid: child.pid, code, signal, stdioClosed: true });
        activeHelper = undefined;
        resolve();
      });
    });
    activeHelper = { child, completion };
    await bounded(completion);
    for (let observation = 1; observation <= 2; observation++) {
      const report = inspector.inspect(fd);
      after.push(report);
      mark('inspect-after', { observation, report, fixtureAlive: alive(pid) });
    }
    mark('fixture-exit-gate', { fixtureAlive: alive(pid) });
    save(dir, 'exit-gate.json', { token: config.token });
    await bounded(exited);
    await bounded(close());
  } catch (error) {
    errorDetail = error.stack ?? String(error);
    mark('driver-error', { error: errorDetail });
    process.exitCode = 1;
  } finally {
    clearTimeout(deadlineTimer);
    const guard = setTimeout(() => {
      save(dir, 'resource-timeout.json', { resources: process.getActiveResourcesInfo(), helperPid: activeHelper?.child.pid, closed, closeProbe });
      process.exit(3);
    }, settings.resourceGuardMs);
    guard.unref();
    if (activeHelper) { activeHelper.child.kill('SIGKILL'); await activeHelper.completion; }
    await close();
  }
  save(dir, 'summary.json', { scenario, run, token: config.token, pid, identity, nonblockMask, before, after, helper: helper ?? null,
    exit: exit ?? null, closed, closeError, closeProbe, error: errorDetail, timedOut, events,
    owner: readOptional(path.join(dir, 'fixture-owner.json')), ready: readOptional(path.join(dir, 'fixture-ready.json')),
    fixtureError: readOptional(path.join(dir, 'fixture-error.json')), durationMs: round(performance.now() - started) });
}

function flagsInvariant(result) {
  assert(scenarios.includes(result.scenario));
  const { before, after, identity, nonblockMask } = result;
  assert(Number.isInteger(nonblockMask) && nonblockMask > 0 && (nonblockMask & (nonblockMask - 1)) === 0);
  assert.equal(before.length, 2); assert.equal(after.length, 2);
  assert.deepEqual(before[0], before[1]); assert.deepEqual(after[0], after[1]);
  for (const report of [...before, ...after]) {
    assert(Number.isInteger(report.flags) && report.flags >= 0);
    assert.equal(report.nonblocking, Boolean(report.flags & nonblockMask));
    assert.equal(report.tty, true); assert.deepEqual(report.identity, identity);
    for (const key of ['dev', 'ino', 'rdev']) assert.match(report.identity[key], /^\d+$/);
  }
  assert.equal(before[0].nonblocking, true);
  assert.equal(after[0].flags, result.scenario === 'helper-stdin-master' ? before[0].flags & ~nonblockMask : before[0].flags);
}

function assess(result) {
  const failures = [], need = (ok, label) => { if (!ok) failures.push(label); };
  const events = result.events ?? [], helper = result.helper;
  const all = event => events.filter(entry => entry.event === event);
  const index = event => events.findIndex(entry => entry.event === event);
  let flagsMatch = false;
  try { flagsInvariant(result); flagsMatch = true; } catch { /* Unexpected flags are the experiment's native failure result. */ }
  need(flagsMatch, 'expected-open-file-flags-effect');
  need(!result.error && !result.timedOut && !result.fixtureError, 'driver-error-or-deadline');
  need(result.driver?.code === 0 && result.driver?.signal === null && !result.driver?.hardTimeout &&
    result.driver?.stdioClosed === true && result.driver?.detached === true && result.naturalExit?.code === 0, 'driver-natural-exit');
  need(result.cleanup?.remaining?.length === 0 && result.cleanup?.errors?.length === 0, 'fixture-cleanup');
  need(result.owner?.pid === result.pid && result.owner?.token === result.token && result.owner?.stdinTTY === true &&
    result.owner?.stdoutTTY === true && result.ready?.pid === result.pid && result.ready?.token === result.token && result.ready?.silent === true, 'silent-fixture-identity');
  need(result.exit?.code === 0 && result.exit?.signal === 0 && index('native-exit') > index('fixture-exit-gate'), 'fixture-natural-exit');
  need(result.closed === true && result.closeError === null && result.closeProbe === 'EBADF' && index('fd-close-request') > index('native-exit') &&
    index('fd-close-complete') > index('fd-close-request'), 'master-release-after-exit');
  need(helper && !helper.error && !helper.parseError && helper.code === 0 && helper.signal === null && helper.stdioClosed === true &&
    helper.stderr === '' && helper.report?.version === 1 && helper.report?.pid === helper.pid && !helper.report?.failure, 'helper-natural-close-and-report');
  need(helper?.stdin === (result.scenario === 'helper-stdin-master' ? 'master' : 'null') &&
    helper?.report?.tty === (result.scenario === 'helper-stdin-master') &&
    (result.scenario !== 'helper-stdin-master' || same(helper?.report?.identity, result.identity)), 'helper-stdin-control');
  need(all('inspect-before').length === 2 && all('inspect-after').length === 2 && all('helper-spawn').length === 1 && all('helper-close').length === 1 &&
    index('fixture-ready') < index('inspect-before') && events.indexOf(all('inspect-before')[1]) < index('helper-spawn') &&
    index('helper-spawn') < index('helper-close') && index('helper-close') < index('inspect-after') &&
    events.indexOf(all('inspect-after')[1]) < index('fixture-exit-gate'), 'observation-spawn-close-order');
  need([...all('inspect-before'), ...all('inspect-after'), ...all('fixture-ready'), ...all('fixture-exit-gate')].every(entry => entry.fixtureAlive === true),
    'main-remains-live-through-observation');
  need(all('helper-spawn')[0]?.pid === helper?.pid && all('helper-close')[0]?.pid === helper?.pid &&
    all('helper-close')[0]?.code === helper?.code && all('helper-close')[0]?.signal === helper?.signal &&
    all('helper-close')[0]?.stdioClosed === helper?.stdioClosed, 'helper-event-identity');
  need(all('spawn').length === 1 && all('spawn')[0].pid === result.pid && same(all('spawn')[0].identity, result.identity) &&
    all('fixture-ready').length === 1 && same(all('fixture-ready')[0].ready, result.ready), 'fixture-event-identity');
  need(all('fixture-exit-gate').length === 1 && all('native-exit').length === 1 &&
    all('native-exit')[0].code === result.exit?.code && all('native-exit')[0].signal === result.exit?.signal &&
    all('fd-close-request').length === 1 && all('fd-close-complete').length === 1 &&
    all('fd-close-complete')[0].error === result.closeError && all('fd-close-complete')[0].probe === result.closeProbe,
  'exit-and-close-event-agreement');
  return { pass: failures.length === 0, failures, classification: 'helper-spawn-side-effect-reproduction-not-product-acceptance' };
}

function capturedResult(config) {
  const dir = config.dir, saved = readOptional(path.join(dir, 'summary.json'));
  if (saved) return saved;
  const events = readEvents(path.join(dir, 'events.ndjson'));
  const owner = readOptional(path.join(dir, 'native-owner.json'));
  return { scenario: config.scenario, run: config.run, token: config.token, pid: owner?.pid, identity: owner?.identity,
    error: 'Driver wrote no summary', events,
    before: events.filter(event => event.event === 'inspect-before').map(event => event.report),
    after: events.filter(event => event.event === 'inspect-after').map(event => event.report),
    helper: readOptional(path.join(dir, 'helper-result.json')), owner: readOptional(path.join(dir, 'fixture-owner.json')),
    ready: readOptional(path.join(dir, 'fixture-ready.json')), fixtureError: readOptional(path.join(dir, 'fixture-error.json')) };
}

async function watchDriver(config) {
  const child = spawn(process.execPath, [script, '--sample', path.join(config.dir, 'config.json')],
    { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const logs = { stdout: '', stderr: '' };
  child.stdout.on('data', chunk => { logs.stdout += chunk; }); child.stderr.on('data', chunk => { logs.stderr += chunk; });
  let hardTimeout = false, hardCleanup, closeTimer, groupKill;
  const killGroup = () => {
    try { process.kill(-child.pid, 'SIGKILL'); groupKill = { pgid: child.pid, signalled: true }; }
    catch (error) { groupKill = { pgid: child.pid, error: error.code }; }
  };
  const timer = setTimeout(() => { hardTimeout = true; hardCleanup = cleanupFixture(config); killGroup(); }, settings.hardMs);
  const result = await new Promise(resolve => {
    child.once('error', error => resolve({ error: error.message, stdioClosed: false }));
    child.once('close', (code, signal) => { clearTimeout(closeTimer); resolve({ code, signal, stdioClosed: true }); });
    child.once('exit', (code, signal) => {
      closeTimer = setTimeout(() => {
        killGroup(); child.stdout.destroy(); child.stderr.destroy(); resolve({ code, signal, stdioClosed: false });
      }, settings.resourceGuardMs);
    });
  });
  clearTimeout(timer); clearTimeout(closeTimer);
  return { ...result, pid: child.pid, detached: true, hardTimeout, groupKill,
    watchdogCleanup: hardCleanup ? await hardCleanup : undefined, logs };
}

async function cleanupFixture(config) {
  const registered = readOptional(path.join(config.dir, 'fixture-owner.json'));
  const nativeOwner = readOptional(path.join(config.dir, 'native-owner.json'));
  const owner = registered ?? nativeOwner;
  const result = { scope: config.token, pid: owner?.pid, signalled: false, remaining: [], errors: [] };
  if (!owner) { result.errors.push('fixture-owner-not-registered'); return result; }
  const configPath = path.join(config.dir, 'config.json');
  if (owner.token !== config.token || (registered && owner.configPath !== configPath) ||
    !Number.isSafeInteger(owner.pid) || owner.pid <= 1 || owner.pid === process.pid) {
    result.errors.push('owner-identity-mismatch'); return result;
  }
  if (alive(owner.pid)) {
    try {
      const row = execFileSync('ps', ['-ww', '-p', String(owner.pid), '-o', 'pgid=', '-o', 'args='],
        { encoding: 'utf8', timeout: 500, maxBuffer: 65536 }).trim();
      if (Number(row.match(/^\s*(\d+)/)?.[1]) !== owner.pid || !row.includes(script) || !row.includes(configPath)) {
        result.errors.push('live-process-scope-mismatch');
      } else { process.kill(-owner.pid, 'SIGKILL'); result.signalled = true; }
    } catch (error) { if (alive(owner.pid) && error.code !== 'ESRCH') result.errors.push(error.message); }
  }
  const until = performance.now() + settings.resourceGuardMs;
  while (alive(owner.pid) && performance.now() < until) await sleep(10);
  if (alive(owner.pid)) result.remaining.push(owner.pid);
  return result;
}

async function verifySaved(dir) {
  assert.deepEqual(readJSON(path.join(dir, 'schedule.json')), { settings, entries: schedule });
  const env = readJSON(path.join(dir, 'environment.json'));
  assert.deepEqual(env.settings, settings); assert.equal(env.scope, scope);
  assert(['linux', 'darwin'].includes(env.platform));
  assert(env.versions?.node && env.versions?.uv && env.kernel && env.arch);
  assert.equal(env.nodePty, '1.2.0-beta.12');
  const names = ['diagnose-unix-helper-fd-flags.mjs', 'unixTerminal.js', 'pty.node'];
  if (env.platform === 'darwin') names.push('spawn-helper');
  assert.equal(env.hashes.length, names.length);
  env.hashes.forEach((item, i) => {
    assert.equal(item.snapshot, `source-snapshot/${i}-${names[i]}`);
    assert.equal(path.basename(item.source), names[i]);
    assert.equal(hash(fs.readFileSync(path.join(dir, item.snapshot))), item.hash);
  });
  const compilation = readJSON(path.join(dir, 'compilation.json'));
  assert(compilation.complete && !compilation.error);
  assert.equal(compilation.compiler, env.platform === 'darwin' ? 'clang' : 'gcc');
  assert.equal(compilation.compilerVersion.code, 0);
  assert.equal(compilation.steps.length, 2);
  assert(compilation.headers.source && compilation.headers.version && compilation.headers.dir);
  assert.deepEqual(compilation.headers.files.map(file => file.name),
    ['node_api.h', 'node_api_types.h', 'js_native_api.h', 'js_native_api_types.h', 'node_version.h']);
  for (const header of compilation.headers.files) {
    assert.equal(header.snapshot, `compiled/node-headers/${header.name}`);
    assert.equal(hash(fs.readFileSync(path.join(dir, header.snapshot))), header.hash);
  }
  for (const [i, step] of compilation.steps.entries()) {
    assert.equal(step.code, 0); assert.equal(step.signal, null); assert(!step.error);
    assert.equal(step.snapshot, `compiled/${i === 0 ? 'unix-fd-inspect.c' : 'unix-pty-readiness.c'}`);
    assert.equal(step.binary, `compiled/${i === 0 ? 'unix-fd-inspect.node' : 'unix-pty-readiness'}`);
    assert.deepEqual(step.args.slice(0, 4), ['-std=c99', '-Wall', '-Wextra', '-Werror']);
    assert.equal(hash(fs.readFileSync(path.join(dir, step.snapshot))), step.sourceHash);
    assert.equal(hash(fs.readFileSync(path.join(dir, step.binary))), step.binaryHash);
  }
  const results = readJSON(path.join(dir, 'summary.json'));
  assert.equal(results.length, schedule.length);
  const failures = [], evidenceErrors = [];
  for (const [i, entry] of schedule.entries()) {
    const result = results[i], sampleDir = path.join(dir, name(entry));
    try {
      assert.equal(name(result), name(entry));
      const config = readJSON(path.join(sampleDir, 'config.json'));
      assert.equal(config.token, result.token); assert.equal(config.scenario, entry.scenario); assert.equal(config.run, entry.run);
      const captured = capturedResult({ ...config, dir: sampleDir });
      const { driver, cleanup, naturalExit, assessment, ...sampleResult } = result;
      assert.deepEqual(sampleResult, JSON.parse(JSON.stringify(captured)));
      const nativeOwner = readOptional(path.join(sampleDir, 'native-owner.json'));
      if (nativeOwner) assert.deepEqual(nativeOwner, { pid: result.pid, token: result.token, identity: result.identity });
      for (const [property, file] of [['owner', 'fixture-owner.json'], ['ready', 'fixture-ready.json'], ['fixtureError', 'fixture-error.json'],
        ['helper', 'helper-result.json'], ['driver', 'driver-exit.json'], ['cleanup', 'cleanup.json'], ['naturalExit', 'natural-exit.json']]) {
        assert.deepEqual(result[property], readOptional(path.join(sampleDir, file)));
      }
      if (result.owner) assert.equal(result.owner.configPath, path.join(config.dir, 'config.json'));
      const gate = readOptional(path.join(sampleDir, 'exit-gate.json'));
      const announcedGate = result.events.some(event => event.event === 'fixture-exit-gate');
      if (gate) { assert(announcedGate); assert.deepEqual(gate, { token: config.token }); }
      else assert(!announcedGate || !result.assessment.pass, 'Successful gate requires its saved token');
      assert.deepEqual(result.events, readEvents(path.join(sampleDir, 'events.ndjson')));
      verifyObservations(result);
      assert.deepEqual(result.assessment, assess(result));
      if (!result.assessment.pass) failures.push(name(entry));
    } catch (error) { evidenceErrors.push({ sample: name(entry), error: error.message }); }
  }
  console.log(JSON.stringify({ attempted: results.length, verified: results.length - evidenceErrors.length, failures, evidenceErrors,
    note: 'Offline artifact verification, not new native execution.' }));
  if (failures.length || evidenceErrors.length) process.exitCode = 1;
}

function verifyObservations(result) {
  for (const phase of ['before', 'after']) {
    const records = result.events.filter(entry => entry.event === `inspect-${phase}`);
    assert.deepEqual(records.map(entry => entry.report), result[phase]);
    assert.deepEqual(records.map(entry => entry.observation), Array.from({ length: result[phase].length }, (_, i) => i + 1));
  }
  if (result.helper && !result.helper.parseError) assert.deepEqual(result.helper.report, JSON.parse(result.helper.stdout));
  let last = 0;
  for (const event of result.events) { assert(Number.isFinite(event.ms) && event.ms >= last); last = event.ms; }
}

function selfTest() {
  assert.equal(schedule.length, 6);
  assert.equal(new Set(schedule.map(name)).size, 6);
  let dir;
  if (process.env.DSC_FD_FLAGS_SELFTEST_EVIDENCE) {
    dir = path.resolve(process.env.DSC_FD_FLAGS_SELFTEST_EVIDENCE);
    assert(!fs.existsSync(dir), 'Refusing to overwrite self-test evidence');
    fs.mkdirSync(dir, { recursive: true });
  } else dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsc-unix-fd-flags-selftest-'));
  const identity = { dev: '1', ino: '2', rdev: '3' };
  const report = flags => ({ flags, nonblocking: Boolean(flags & 2048), tty: true, identity });
  const baseline = { scenario: 'helper-stdin-master', identity, nonblockMask: 2048, before: [report(2050), report(2050)], after: [report(2), report(2)] };
  flagsInvariant(baseline);
  flagsInvariant({ ...baseline, scenario: 'helper-stdin-null', after: baseline.before });
  const outcomes = [];
  for (const [label, mutate] of [
    ['nonblock-not-cleared', result => { result.after = structuredClone(result.before); }],
    ['other-flag-changed', result => { result.after = [report(0), report(0)]; }],
    ['unstable-before', result => { result.before[1].flags++; }],
    ['unstable-after', result => { result.after[1].flags++; }],
    ['wrong-identity', result => { result.after[0].identity = { ...result.identity, ino: '9' }; }],
    ['false-nonblock-boolean', result => { result.before[0].nonblocking = false; }],
    ['null-arm-has-side-effect', result => { result.scenario = 'helper-stdin-null'; }],
  ]) {
    const result = structuredClone(baseline); mutate(result);
    assert.throws(() => flagsInvariant(result));
    outcomes.push({ label, rejected: true, input: result });
  }
  assert.equal(assess(baseline).pass, false, 'Flags alone cannot establish native lifecycle success');
  save(dir, 'negative-controls.json', outcomes);
  console.log(JSON.stringify({ selfTest: 'passed', evidence: dir, ptyLaunched: false, scope: 'Synthetic flag-contract negatives only; no native execution.' }));
}

function fdIdentity(fd) { const stat = fs.fstatSync(fd, { bigint: true }); return { dev: String(stat.dev), ino: String(stat.ino), rdev: String(stat.rdev) }; }
function alive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
function name(entry) { return `${entry.scenario}-${entry.run}`; }
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function hash(value) { return createHash('sha256').update(value).digest('hex'); }
function readJSON(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function readOptional(file) { return fs.existsSync(file) ? readJSON(file) : null; }
function readEvents(file) { return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : []; }
function save(dir, file, value) {
  const destination = path.join(dir, file), temporary = `${destination}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n'); fs.renameSync(temporary, destination);
}
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function round(value) { return Math.round(value * 1000) / 1000; }
