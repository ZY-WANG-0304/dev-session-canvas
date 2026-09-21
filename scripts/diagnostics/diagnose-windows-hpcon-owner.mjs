// Frozen Windows-only diagnostic for the known HPCON owner lifecycle candidate.
// This file deliberately does not change the production reader or historical probes.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { Worker } from 'node:worker_threads';

const require = createRequire(import.meta.url);
const script = fileURLToPath(import.meta.url);
const workerURL = new URL('./runtime-owned-cancel-worker.mjs', import.meta.url);
const legacyPath = path.join(path.dirname(script), 'diagnose-runtime-owned-lifecycle.mjs');
const frozen = Object.freeze({
  'diagnose-runtime-owned-lifecycle.mjs': '4c2e3decf149c120c06faa9fcb3f997aa6f6dc2990dcad7cedece7b622cfb09d',
  'runtime-owned-cancel-worker.mjs': '8630eab630bb085c843e92467d578b59f3f4480cccef4c6b56e5b3a75ebc1489',
  'native-runtime-resources.c': 'fcd2cc8d55d8033b53c5e23e647e8ce7bb8b39f2c8931bcd50a302cb06b72adb',
});
for (const [name, expected] of Object.entries(frozen)) {
  assert.equal(hash(fs.readFileSync(path.join(path.dirname(script), name), 'utf8').replaceAll('\r\n', '\n')), expected, 'Frozen input changed: ' + name);
}
const legacySource = fs.readFileSync(legacyPath, 'utf8').replaceAll('\r\n', '\n');
const legacy = await frozenHelpers(legacySource);
const { settings, payload } = legacy;
const arms = Object.freeze([
  { id: 'prebuilt-stock/no-close', build: 'prebuilt-stock', close: false },
  { id: 'rebuilt-owner-retain/no-close', build: 'rebuilt-owner-retain', close: false },
  { id: 'rebuilt-owner-retain/explicit-close', build: 'rebuilt-owner-retain', close: true },
]);
const driverModes = Object.freeze(['control-1', 'native-1', 'control-2', 'native-2']);
const { values } = parseArgs({ options: {
  output: { type: 'string' }, 'verify-saved': { type: 'string' }, 'self-test': { type: 'boolean' },
  driver: { type: 'string' }, fixture: { type: 'string' }, 'watchdog-block': { type: 'boolean' },
} });

try {
  if (values['self-test']) await selfTest();
  else if (values['verify-saved']) process.exitCode = (await verifySaved(path.resolve(values['verify-saved']))).pass ? 0 : 1;
  else if (values.driver) await driver(readJSON(values.driver));
  else if (values.fixture) await legacy.fixture(readJSON(values.fixture));
  else if (values['watchdog-block']) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30000);
  else await run();
} catch (error) {
  console.error(error.stack ?? error);
  process.exitCode = 1;
}

function hash(value) { return createHash('sha256').update(value).digest('hex'); }
function now() { return process.hrtime.bigint().toString(); }
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function readJSON(file) { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null; }
function save(dir, name, value) { fs.writeFileSync(path.join(dir, name), `${JSON.stringify(value, null, 2)}\n`); }
function allFiles(dir, prefix = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const relative = path.posix.join(prefix, entry.name);
    return entry.isDirectory() ? allFiles(path.join(dir, entry.name), relative) : [relative];
  }).sort();
}
function manifest(dir) { save(dir, 'manifest.json', allFiles(dir).filter(f => f !== 'manifest.json').map(file => ({ file, hash: hash(fs.readFileSync(path.join(dir, file))) }))); }
function equal(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
async function frozenHelpers(source) {
  const start = source.indexOf('const { values } = parseArgs(');
  const end = source.indexOf('function makeSchedule(platform) {', start);
  assert(start > 0 && end > start, 'Frozen helper entry anchors missing');
  let derived = source.slice(0, start) + source.slice(end);
  const header = 'const require = createRequire(import.meta.url), script = fileURLToPath(import.meta.url);';
  assert(derived.includes(header), 'Frozen require anchor missing');
  derived = derived.replace(header, `const require = createRequire(${JSON.stringify(import.meta.url)}), script = ${JSON.stringify(script)};`);
  derived = derived.replace("const workerURL = new URL('./runtime-owned-cancel-worker.mjs', import.meta.url);",
    `const workerURL = new URL(${JSON.stringify(workerURL.href)});`);
  derived += '\nexport { settings, payload, fixture, compile, assessSession, resourceAssessment, makeTerminal, state, render };\n';
  return import(`data:text/javascript;base64,${Buffer.from(derived).toString('base64')}`);
}
function ownerSnapshot(native, dir, label = 'latest') {
  if (typeof native.ownerSnapshot !== 'function') {
    const snapshot = { supported: false, owners: [], events: [] };
    save(dir, `owner-snapshot-${label}.json`, snapshot);
    return snapshot;
  }
  const snapshot = native.ownerSnapshot();
  assert.equal(snapshot?.schema, 1, 'Unexpected owner snapshot schema');
  save(dir, `owner-snapshot-${label}.json`, snapshot);
  return snapshot;
}
function ownerFor(snapshot, id, generation) {
  return snapshot?.owners?.find(owner => owner.id === id && String(owner.generation) === String(generation)) ?? null;
}
function closeGate(owner) {
  return Boolean(owner && owner.shellExited && owner.shellHandleClosed && owner.releaseSucceeded &&
    owner.exitEventEnqueued && owner.exitCallbackDelivered && owner.nativeExitThreadDone &&
    owner.pipeEof && owner.consumerComplete && !owner.lifecycleFailed && owner.hpcPresent &&
    !owner.hShellPresent && !owner.closeInvoked && !owner.closeInFlight && !owner.ownerClosed && !owner.batonRemoved);
}

function schedule() {
  return arms.flatMap(arm => driverModes.map(mode => ({ arm: arm.id, build: arm.build, close: arm.close,
    mode, kind: mode.startsWith('native') ? 'native' : 'control', id: `${arm.id.replaceAll('/', '__')}__${mode}` })));
}

async function loadTransformer() {
  const file = path.resolve(path.dirname(script), 'windows-hpcon-owner-patch.mjs');
  assert(fs.existsSync(file), `Missing native transformer: ${file}`);
  return import(pathToFileURL(file));
}

function resolveNodePtyRoot() {
  const packageJson = require.resolve('node-pty/package.json');
  return path.dirname(packageJson);
}

function snapshot(file, dir, relative) {
  assert(fs.existsSync(file), `Missing input: ${file}`);
  const target = path.join(dir, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(file, target);
  return { file, snapshot: relative, hash: hash(fs.readFileSync(file)) };
}

async function buildArm(root, kind) {
  const dir = path.join(root, 'builds', kind); fs.mkdirSync(dir, { recursive: true });
  const record = { kind, dir, platform: process.platform, arch: process.arch, node: process.versions.node, inputs: [] };
  try {
    assert.equal(process.platform, 'win32');
    assert.equal(process.versions.node, '22.23.2', 'Frozen Node version mismatch');
    const packageRoot = resolveNodePtyRoot(), lib = path.join(packageRoot, 'lib');
    const loaded = require('node-pty/lib/utils').loadNativeModule('conpty');
    const binary = path.resolve(lib, loaded.dir, 'conpty.node');
    const dll = path.resolve(lib, loaded.dir, 'conpty/conpty.dll');
    record.stockBinary = snapshot(binary, dir, 'stock/conpty.node');
    record.stockDll = snapshot(dll, dir, 'stock/conpty/conpty.dll');
    record.stockHelper = snapshot(path.join(path.dirname(dll), 'OpenConsole.exe'), dir, 'stock/conpty/OpenConsole.exe');
    record.source = snapshot(path.join(packageRoot, 'src/win/conpty.cc'), dir, 'source-before/conpty.cc');
    record.header = snapshot(path.join(packageRoot, 'src/win/conpty.h'), dir, 'source-before/conpty.h');
    record.inputs.push(record.stockBinary, record.stockDll, record.stockHelper, record.source, record.header);
    record.nativeModule = path.join(dir, kind === 'prebuilt-stock' ? 'stock/conpty.node' : 'compiled/conpty.node');
    record.dll = path.join(path.dirname(record.nativeModule), 'conpty/conpty.dll');
    record.helper = path.join(path.dirname(record.dll), 'OpenConsole.exe');
    if (kind !== 'prebuilt-stock') {
      const transformer = await loadTransformer();
      const patched = transformer.patchConptyOwnerFile(path.join(dir, record.source.snapshot));
      const compiled = path.join(dir, 'compiled'); fs.mkdirSync(compiled);
      fs.cpSync(path.join(packageRoot, 'src'), path.join(dir, 'src'), { recursive: true });
      const transformed = path.join(dir, 'src/win/conpty.cc');
      fs.writeFileSync(transformed, patched.source);
      fs.writeFileSync(path.join(dir, 'source.patch'), patched.patch);
      record.transform = { sourceHash: patched.sourceHash, patchedSourceHash: patched.patchedSourceHash, patchHash: patched.patchHash,
        headerHash: patched.headerHash, api: patched.api };
      record.inputs.push(snapshot(transformed, dir, 'source-after/conpty.cc'));
      record.inputs.push({ snapshot: 'source.patch', hash: hash(fs.readFileSync(path.join(dir, 'source.patch'))) });
      const addonRoot = path.dirname(createRequire(path.join(packageRoot, 'package.json')).resolve('node-addon-api/package.json'));
      assert.equal(readJSON(path.join(addonRoot, 'package.json')).version, '7.1.1');
      fs.cpSync(addonRoot, path.join(dir, 'node-addon-api'), { recursive: true });
      const headers = process.env.DSC_NODE_INCLUDE_DIR, nodeLib = process.env.DSC_NODE_LIB;
      assert(headers && nodeLib, 'Matching DSC_NODE_INCLUDE_DIR and DSC_NODE_LIB are required');
      const version = fs.readFileSync(path.join(headers, 'node_version.h'), 'utf8');
      assert.equal(['MAJOR', 'MINOR', 'PATCH'].map(p => version.match(new RegExp('#define NODE_' + p + '_VERSION\\s+(\\d+)'))[1]).join('.'), process.versions.node);
      fs.cpSync(headers, path.join(dir, 'node-headers'), { recursive: true });
      record.inputs.push(snapshot(nodeLib, dir, 'node.lib'));
      record.toolchain = { compiler: 'cl.exe', sdk: process.env.WindowsSDKVersion, sdkDir: process.env.WindowsSdkDir,
        vcTools: process.env.VCToolsInstallDir, headerVersion: process.versions.node, nodeAddonApi: '7.1.1' };
      const located = spawnSync('where.exe', ['cl.exe'], { encoding: 'utf8' });
      assert.equal(located.status, 0, 'Cannot resolve compiler executable');
      const compilerPath = located.stdout.trim().split(/\r?\n/)[0];
      record.toolchain.executable = snapshot(compilerPath, dir, 'toolchain/cl.exe');
      record.inputs.push(record.toolchain.executable);
      record.args = ['/nologo', '/Bv', '/LD', '/MD', '/EHsc', '/std:c++17', '/DNOMINMAX', '/DNODE_GYP_MODULE_NAME=conpty',
        '/I' + path.join(dir, 'node-addon-api'), '/I' + path.join(dir, 'node-headers'), transformed,
        path.join(dir, 'src/win/path_util.cc'), path.join(dir, 'node.lib'), 'Shlwapi.lib', '/link', '/OUT:' + record.nativeModule];
      const result = spawnSync(compilerPath, record.args, { cwd: compiled, encoding: 'utf8', timeout: 120000 });
      record.compilation = { status: result.status, error: result.error?.message, stdout: result.stdout, stderr: result.stderr };
      fs.writeFileSync(path.join(dir, 'compiler-stdout.log'), result.stdout ?? '');
      fs.writeFileSync(path.join(dir, 'compiler-stderr.log'), result.stderr ?? '');
      assert.equal(result.status, 0, 'Candidate compilation failed; inspect compiler logs');
      fs.mkdirSync(path.dirname(record.dll), { recursive: true }); fs.copyFileSync(dll, record.dll);
      fs.copyFileSync(path.join(dir, record.stockHelper.snapshot), record.helper);
    }
    record.nativeSnapshot = path.relative(dir, record.nativeModule).replaceAll('\\', '/');
    record.dllSnapshot = path.relative(dir, record.dll).replaceAll('\\', '/');
    record.helperSnapshot = path.relative(dir, record.helper).replaceAll('\\', '/');
    record.nativeHash = hash(fs.readFileSync(record.nativeModule)); record.dllHash = hash(fs.readFileSync(record.dll));
    record.helperHash = hash(fs.readFileSync(record.helper));
    assert.equal(record.dllHash, record.stockDll.hash, 'Candidate DLL differs from stock');
    assert.equal(record.helperHash, record.stockHelper.hash, 'Candidate OpenConsole.exe differs from stock');
    record.pass = true;
  } catch (error) { record.pass = false; record.error = error.stack ?? String(error); }
  save(dir, 'build.json', record); manifest(dir); return record;
}

async function run() {
  assert.equal(process.platform, 'win32', 'Use --self-test outside Windows');
  assert(values.output, '--output is required');
  const root = path.resolve(values.output); assert(!fs.existsSync(root), 'Refusing to overwrite evidence'); fs.mkdirSync(root, { recursive: true });
  const entries = schedule(); save(root, 'schedule.json', { schema: 1, platform: 'win32', settings, entries });
  const sources = [script, legacyPath, fileURLToPath(workerURL), path.join(path.dirname(script), 'windows-hpcon-owner-patch.mjs'),
    path.join(path.dirname(script), 'native-runtime-resources.c'),
    require.resolve('@xterm/headless')].map((file, i) => snapshot(file, root, 'source-snapshot/' + i + '-' + path.basename(file)));
  save(root, 'environment.json', { platform: process.platform, arch: process.arch, versions: process.versions, kernel: os.release(), settings, sources,
    github: { sha: process.env.GITHUB_SHA, run: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT, image: process.env.ImageVersion } });
  let observer;
  try { observer = legacy.compile(root); }
  catch (error) { save(root, 'observer-build-failure.json', { error: String(error) }); }
  const builds = {};
  for (const kind of ['prebuilt-stock', 'rebuilt-owner-retain']) builds[kind] = await buildArm(root, kind);
  save(root, 'builds.json', builds);
  const matrixReady = Boolean(observer) && Object.values(builds).every(build => build.pass);
  save(root, 'preparation.json', { matrixReady, reason: matrixReady ? null : 'Entire matrix unattempted because a build prerequisite failed' });
  const results = [];
  for (const entry of entries) {
    const dir = path.join(root, entry.id); fs.mkdirSync(dir);
    const config = { ...entry, dir, token: randomUUID(), platform: 'win32', observer, matrixReady, buildRecord: builds[entry.build] };
    save(dir, 'config.json', config);
    const result = matrixReady
      ? await guarded(['--driver', path.join(dir, 'config.json')], settings.batchHardMs)
      : { code: 1, error: 'Build precondition failed', timedOut: false, stdout: '', stderr: '' };
    save(dir, 'driver.json', { ...result, stdout: undefined, stderr: undefined });
    fs.writeFileSync(path.join(dir, 'stdout.log'), result.stdout); fs.writeFileSync(path.join(dir, 'stderr.log'), result.stderr);
    let assessment;
    try { assessment = await assessDriver(dir, config); }
    catch (error) { assessment = { pass: false, classification: 'evidence-error', error: String(error) }; }
    save(dir, 'assessment.json', assessment); manifest(dir); results.push({ id: entry.id, ...assessment });
    console.log(JSON.stringify(results.at(-1)));
  }
  save(root, 'results.json', results); manifest(root);
  process.exitCode = (await verifySaved(root)).pass ? 0 : 1;
}

async function guarded(args, timeout) {
  const child = spawn(process.execPath, [script, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '', timedOut = false, timer;
  child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
  const exit = await new Promise(resolve => {
    const done = value => { clearTimeout(timer); resolve(value); };
    child.on('error', error => done({ error: String(error) }));
    child.on('close', (code, signal) => done({ code, signal }));
    timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeout);
  });
  return { pid: child.pid, ...exit, timedOut, stdout, stderr };
}

function nativeModule(config) { return require(config.buildRecord.nativeModule); }

async function oneNativeSession(config, dir, index) {
  const sessionConfig = { ...config, dir, scenario: 'read-through', index }; save(dir, 'config.json', sessionConfig);
  const native = nativeModule(config), { argsToCommandLine } = require('node-pty/lib/windowsPtyAgent');
  const events = [], observed = [], deliveries = [], jobs = [], decoder = new StringDecoder('utf8'), terminal = legacy.makeTerminal();
  let accepted = 0, applied = 0, nativeExit, workerExit, inputClosed = false, closed = false, source, sourceEnded = false, gate = false;
  let term, input, worker, pid, error, classification, timer, consumerComplete = false;
  const started = Date.now(), rebuilt = config.build === 'rebuilt-owner-retain';
  fs.writeFileSync(path.join(dir, 'observed.bin'), ''); fs.writeFileSync(path.join(dir, 'delivered.bin'), '');
  const mark = (event, details = {}) => {
    const record = { ...details, index: events.length, ns: now(), event }; events.push(record);
    fs.appendFileSync(path.join(dir, 'events.ndjson'), JSON.stringify(record) + '\n');
  };
  const enqueue = text => {
    if (!text) return;
    const id = ++accepted; mark('consumer-enqueue', { id, hash: hash(text) });
    jobs.push(new Promise(resolve => terminal.write(text, () => { applied++; mark('consumer-applied', { id }); resolve(); })));
  };
  const fail = caught => { error ??= caught.stack ?? String(caught); mark('error', { error }); };
  const check = () => { if (error) throw new Error(error); assert(Date.now() - started < settings.sampleMs, 'Session deadline'); };
  const gateCall = (api, evidence) => {
    if (!rebuilt) { mark(api, { supported: false, invoked: false }); return; }
    const result = native[api](term.pty, term.generation); save(dir, evidence, result); mark(api, { result });
    assert(result.ok, api + ' rejected: ' + result.error);
  };
  try {
    if (rebuilt) for (const api of ['ownerSnapshot', 'markPipeEof', 'markConsumerComplete', 'closeAfterExit']) assert.equal(typeof native[api], 'function', 'Missing rebuilt API: ' + api);
    term = native.startProcess(process.execPath, settings.cols, settings.rows, false, 'owned-' + process.pid + '-' + randomUUID(), false, true);
    if (rebuilt) assert.match(term.generation, /^[1-9][0-9]*$/);
    save(dir, 'owner-created.json', { id: term.pty, generation: term.generation, supported: rebuilt });
    ownerSnapshot(native, dir, 'start');
    input = new net.Socket({ fd: fs.openSync(term.conin, 'w'), readable: false, writable: true });
    input.on('error', fail); input.on('close', () => { inputClosed = true; mark('input-close'); });
    worker = new Worker(workerURL, { workerData: { pipe: term.conout, hold: false } });
    worker.on('error', fail); worker.on('exit', code => { workerExit = code; mark('worker-exit', { code }); });
    worker.on('message', message => {
      try {
        const bytes = message.bytes instanceof Uint8Array ? Buffer.from(message.bytes) : undefined;
        mark('worker-' + message.event, { ...message, bytes: bytes ? bytes.length : message.bytes,
          hash: bytes ? hash(bytes) : undefined, workerNs: message.ns });
        if (message.event === 'ready') {
          assert.equal(pid, undefined, 'Duplicate worker-ready/connect');
          const connected = native.connect(term.pty, argsToCommandLine(process.execPath, [script, '--fixture', path.join(dir, 'config.json')]),
            dir, Object.entries(process.env).map(([k, v]) => k + '=' + v), true, (code, signal = 0) => {
              nativeExit = { code, signal }; mark('native-exit', nativeExit); input.destroy();
            });
          pid = connected.pid; if (rebuilt) assert.equal(connected.generation, term.generation);
          save(dir, 'native-owner.json', { pid, token: config.token, id: term.pty, generation: term.generation,
            config: path.join(dir, 'config.json') }); mark('native-connected', { pid, id: term.pty, generation: term.generation });
        } else if (message.event === 'observed') { observed.push(bytes); fs.appendFileSync(path.join(dir, 'observed.bin'), bytes); }
        else if (message.event === 'delivery') { deliveries.push(bytes); fs.appendFileSync(path.join(dir, 'delivered.bin'), bytes); enqueue(decoder.write(bytes)); }
        else if (message.event === 'pipe-end') {
          assert(!message.cancelled, 'Cancelled pipe-end is not EOF'); gateCall('markPipeEof', 'pipe-eof-result.json');
        } else if (message.event === 'source') { source = message.reason; mark('source', { reason: source }); }
        else if (message.event === 'pipe-close') { closed = true; assert(!message.hadError, 'Unexpected pipe error'); }
        else if (message.event === 'pipe-error') throw new Error('Pipe error: ' + message.code);
      } catch (caught) { fail(caught); }
    });
    timer = setInterval(() => {
      try {
        if (gate) return;
        const receipt = readJSON(path.join(dir, 'writer-receipt.json')); if (!receipt) return;
        assert.equal(receipt.pid, pid); assert.equal(receipt.token, config.token); assert(receipt.written);
        save(dir, 'exit-gate.json', { token: config.token, ns: now() }); gate = true; mark('gate-published');
      } catch (caught) { fail(caught); }
    }, settings.pollMs);
    while (!source || !nativeExit || !closed || workerExit === undefined || !inputClosed) { check(); await sleep(settings.pollMs); }
    assert.equal(source, 'pipe-eof'); assert.equal(workerExit, 0);
    enqueue(decoder.end()); sourceEnded = true; mark('decoder-end');
    await Promise.all(jobs); check(); assert.equal(accepted, applied);
    save(dir, 'terminal-state.json', legacy.state(terminal)); mark('consumer-complete', { accepted, applied }); consumerComplete = true;
    gateCall('markConsumerComplete', 'consumer-complete-result.json');
    if (rebuilt) {
      while (!closeGate(ownerFor(native.ownerSnapshot(), term.pty, term.generation))) { check(); await sleep(settings.pollMs); }
    }
    const before = ownerSnapshot(native, dir, 'before-close');
    save(dir, 'resources-before-close.json', resourceSample(config));
    const beforeBytes = Buffer.concat(deliveries), beforeState = legacy.state(terminal), eventCount = events.length;
    if (config.close) {
      assert(closeGate(ownerFor(before, term.pty, term.generation)), 'Native close gates missing');
      mark('close-call', { id: term.pty, generation: term.generation });
      const result = native.closeAfterExit(term.pty, term.generation, true);
      save(dir, 'close-result.json', result); mark('close-result', { result });
      if (!result.ok) { classification = 'close-failure'; throw new Error('close rejected: ' + result.error); }
    } else save(dir, 'close-result.json', { skipped: true });
    await sleepAtLeast(settings.settleMs);
    save(dir, 'resources-after-close.json', resourceSample(config));
    const after = ownerSnapshot(native, dir, 'after-close');
    const postClose = { observedUnchanged: Buffer.concat(observed).equals(beforeBytes), deliveredUnchanged: Buffer.concat(deliveries).equals(beforeBytes),
      stateUnchanged: equal(legacy.state(terminal), beforeState),
      events: events.slice(eventCount).filter(e => !['close-call', 'close-result'].includes(e.event)) };
    save(dir, 'post-close.json', postClose);
    assert(postClose.observedUnchanged && postClose.deliveredUnchanged && postClose.stateUnchanged && !postClose.events.length, 'Close side effect');
    if (config.close) assert.equal(after.owners.length, 0, 'Known owners remain after Close');
    else if (rebuilt) assert.equal(after.owners.length, index + 1, 'No-close owner positive control changed');
  } catch (caught) {
    classification ??= (!source || !consumerComplete) ? 'precondition-failure' : 'natural-lifecycle-failure';
    fail(caught);
  } finally { clearInterval(timer); terminal.dispose(); mark('terminal-disposed'); }
  const summary = { pid: process.pid, scenario: 'read-through', source, sourceEnded, nativeExit, workerExit, inputClosed, closed, gate,
    cancelSent: false, cancelApplied: false, held: false, parentHeld: false, accepted, applied, pending: 0,
    observed: observed.reduce((n, b) => n + b.length, 0), delivered: deliveries.reduce((n, b) => n + b.length, 0),
    error, classification, elapsedMs: Date.now() - started };
  save(dir, 'session.json', summary); return summary;
}

function resourceSample(config) {
  return { ns: now(), native: require(config.observer).observe(), js: process.getActiveResourcesInfo() };
}
async function sleepAtLeast(ms) {
  const deadline = process.hrtime.bigint() + BigInt(ms) * 1000000n;
  while (process.hrtime.bigint() < deadline) {
    await sleep(Math.max(1, Math.ceil(Number(deadline - process.hrtime.bigint()) / 1000000)));
  }
}
async function driver(config) {
  const results = [], counts = []; let error;
  process.on('beforeExit', code => save(config.dir, 'natural-exit.json', { pid: process.pid, code, resources: process.getActiveResourcesInfo() }));
  process.on('exit', code => save(config.dir, 'process-exit.json', { pid: process.pid, code, resources: process.getActiveResourcesInfo() }));
  try {
    const native = nativeModule(config);
    save(config.dir, 'loaded-native.json', { path: require.resolve(config.buildRecord.nativeModule),
      hash: hash(fs.readFileSync(config.buildRecord.nativeModule)), dll: config.buildRecord.dll,
      dllHash: hash(fs.readFileSync(config.buildRecord.dll)), helper: config.buildRecord.helper,
      helperHash: hash(fs.readFileSync(config.buildRecord.helper)), patched: typeof native.ownerSnapshot === 'function' });
    for (let index = 0; index < settings.warmup + settings.measured; index++) {
      if (config.kind === 'native') {
        const dir = path.join(config.dir, 'session-' + index); fs.mkdirSync(dir);
        const result = await oneNativeSession(config, dir, index); results.push(result);
        if (result.error || !(await legacy.assessSession(dir, 'win32')).pass) throw new Error('Session ' + index + ' incomplete');
      }
      if (index >= settings.warmup - 1) {
        await sleepAtLeast(settings.settleMs); const samples = [];
        for (let n = 0; n < settings.snapshots; n++) {
          samples.push(resourceSample(config)); if (n + 1 < settings.snapshots) await sleepAtLeast(settings.snapshotMs);
        }
        counts.push({ index, samples }); save(config.dir, 'counts.json', counts);
      }
    }
  } catch (caught) { error = caught.stack ?? String(caught); }
  save(config.dir, 'summary.json', { pid: process.pid, results, error });
  if (error) process.exitCode = 1;
  const guard = setTimeout(() => { save(config.dir, 'resource-timeout.json', { pid: process.pid, resources: process.getActiveResourcesInfo() }); process.exit(2); }, settings.resourceGuardMs);
  guard.unref();
}

function assessOwner(dir, config, index) {
  const created = readJSON(path.join(dir, 'owner-created.json'));
  const before = readJSON(path.join(dir, 'owner-snapshot-before-close.json'));
  const after = readJSON(path.join(dir, 'owner-snapshot-after-close.json'));
  const close = readJSON(path.join(dir, 'close-result.json'));
  const post = readJSON(path.join(dir, 'post-close.json'));
  if (!created || !before || !after || !close || !post) return { pass: false, reason: 'Incomplete owner evidence' };
  const sideEffects = post.observedUnchanged && post.deliveredUnchanged && post.stateUnchanged && post.events?.length === 0;
  const boundary = assessBoundary(dir, config);
  if (config.build === 'prebuilt-stock') return { pass: boundary && before.supported === false && after.supported === false && close.skipped === true && sideEffects, supported: false, boundary };
  const owner = ownerFor(before, created.id, created.generation);
  const selected = snapshot => snapshot.events.filter(e => e.id === created.id && e.generation === created.generation);
  const events = selected(after), names = events.map(e => e.event);
  const pos = name => names.indexOf(name);
  const once = name => names.filter(n => n === name).length === 1;
  const ordered = (first, last) => pos(first) >= 0 && pos(first) < pos(last);
  const baseNames = ['owner-created', 'release-called', 'release-returned', 'shell-exited', 'shell-handle-closed',
    'exit-enqueue-request', 'exit-event-enqueued', 'exit-callback-delivered', 'exit-tsfn-release',
    'native-exit-thread-done', 'mark-pipe-eof', 'mark-consumer-complete'];
  const checks = {
    schema: before.schema === 1 && after.schema === 1,
    gate: closeGate(owner) && before.owners.length === (config.close ? 1 : index + 1),
    boundary,
    identity: Number.isInteger(created.id) && typeof created.generation === 'string' && created.generation.length > 0,
    events: baseNames.every(once) && events.every(e => e.ok === true &&
      (e.event === 'release-returned' ? Number.isInteger(e.error) && e.error >= 0 && e.error < 0x80000000 && e.error === owner?.releaseHresult : e.error === 0) && Number.isFinite(e.seq) &&
      (typeof e.qpcTicks === 'number' || typeof e.qpcTicks === 'string') && Number.isInteger(e.threadId)) &&
      events.every((e, i) => i === 0 || e.seq > events[i - 1].seq),
    partialOrder: ordered('owner-created', 'release-called') && ordered('release-called', 'release-returned') &&
      ordered('shell-exited', 'shell-handle-closed') && ordered('shell-handle-closed', 'exit-enqueue-request') &&
      ordered('exit-enqueue-request', 'exit-callback-delivered') && ordered('exit-enqueue-request', 'exit-event-enqueued') &&
      ordered('exit-event-enqueued', 'exit-tsfn-release') && ordered('exit-tsfn-release', 'native-exit-thread-done') &&
      ordered('exit-callback-delivered', 'native-exit-thread-done') &&
      ordered('mark-pipe-eof', 'mark-consumer-complete'),
    prefix: equal(before.events, after.events.slice(0, before.events.length)),
    sideEffects,
  };
  const js = readEvents(path.join(dir, 'events.ndjson')), at = name => js.findIndex(e => e.event === name);
  checks.consumerGate = at('markPipeEof') > at('worker-pipe-end') && at('markConsumerComplete') > at('consumer-complete');
  if (config.close) {
    const closes = ['close-request', 'close-invoked', 'close-returned', 'owner-closed', 'baton-removed'];
    checks.close = close.ok === true && close.state?.ownerClosed && close.state.batonRemoved &&
      close.state.id === created.id && close.state.generation === created.generation && close.state.pid === owner.pid && close.state.exitCode === owner.exitCode &&
      close.state.releaseHresult === owner.releaseHresult &&
      !close.state.hpcPresent && !close.state.closeInFlight && close.state.closeInvoked &&
      closes.every(once) && baseNames.every(name => ordered(name, 'close-request')) &&
      closes.slice(1).every((name, i) => ordered(closes[i], name)) &&
      after.owners.length === 0 && at('close-call') > at('markConsumerComplete');
  } else checks.retained = close.skipped === true && !names.some(n => n.startsWith('close-') || n === 'owner-closed' || n === 'baton-removed') &&
    after.owners.length === index + 1 && after.owners.every(o => o.hpcPresent && !o.closeInvoked && !o.ownerClosed && !o.batonRemoved);
  return { pass: Object.values(checks).every(Boolean), supported: true, checks, ownerCount: after.owners.length };
}

function assessBoundary(dir, config) {
  const events = readEvents(path.join(dir, 'events.ndjson')), session = readJSON(path.join(dir, 'session.json'));
  const owner = readJSON(path.join(dir, 'native-owner.json')), created = readJSON(path.join(dir, 'owner-created.json'));
  const before = readJSON(path.join(dir, 'resources-before-close.json')), after = readJSON(path.join(dir, 'resources-after-close.json'));
  const one = name => events.filter(e => e.event === name).length === 1;
  const at = name => events.findIndex(e => e.event === name), event = name => events.find(e => e.event === name);
  const names = ['worker-ready', 'native-connected', 'worker-pipe-end', 'worker-pipe-close', 'native-exit', 'input-close', 'worker-exit', 'consumer-complete'];
  if (!names.every(one) || !events.every((e, i) => e.index === i) || !before || !after || !owner || !created || !session) return false;
  const validResource = sample => sample.native?.pid === session.pid && Number.isInteger(sample.native.handles) && sample.native.handles >= 0 &&
    Number.isInteger(sample.native.threads) && sample.native.threads >= 0 && Array.isArray(sample.js) && /^[0-9]+$/.test(sample.ns);
  if (!validResource(before) || !validResource(after) || BigInt(after.ns) - BigInt(before.ns) < BigInt(settings.settleMs) * 1000000n) return false;
  if (owner.id !== created.id || owner.generation !== created.generation ||
    event('native-exit').code !== session.nativeExit?.code || event('native-exit').signal !== session.nativeExit?.signal ||
    event('worker-exit').code !== 0 || event('worker-pipe-close').hadError || !event('worker-pipe-close').ended || event('worker-pipe-close').cancelled ||
    event('worker-pipe-end').cancelled || at('worker-ready') >= at('native-connected')) return false;
  if (config.close && (!one('close-call') || !one('close-result') || names.some(name => at(name) >= at('close-call')) ||
    events.slice(at('close-call') + 1).some(e => !['close-result', 'terminal-disposed'].includes(e.event)))) return false;
  return true;
}

function readEvents(file) {
  return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
}
async function assessDriver(dir, config) {
  const summary = readJSON(path.join(dir, 'summary.json')), child = readJSON(path.join(dir, 'driver.json'));
  const natural = readJSON(path.join(dir, 'natural-exit.json')), processExit = readJSON(path.join(dir, 'process-exit.json'));
  const loaded = readJSON(path.join(dir, 'loaded-native.json'));
  const counts = readJSON(path.join(dir, 'counts.json')), sessions = [];
  const dirs = fs.readdirSync(dir).filter(n => /^session-\d+$/.test(n)).sort((a, b) => Number(a.slice(8)) - Number(b.slice(8)));
  for (const [index, name] of dirs.entries()) {
    const sessionDir = path.join(dir, name), summary = readJSON(path.join(sessionDir, 'session.json'));
    try { sessions.push({ name, natural: await legacy.assessSession(sessionDir, 'win32'), owner: assessOwner(sessionDir, config, index), classification: summary?.classification ?? null }); }
    catch (error) { sessions.push({ name, natural: { pass: false }, owner: { pass: false }, classification: 'evidence-error', error: String(error) }); }
  }
  const expected = config.kind === 'native' ? settings.warmup + settings.measured : 0;
  const lifecycle = Boolean(summary && !summary.error && child?.code === 0 && !child.timedOut &&
    child.pid === summary.pid && natural?.pid === summary.pid && natural.code === 0 &&
    processExit?.pid === summary.pid && processExit.code === 0 && !readJSON(path.join(dir, 'resource-timeout.json')) &&
    sessions.length === expected && sessions.every(s => s.natural.pass));
  const binding = Boolean(loaded && loaded.path === config.buildRecord.nativeModule && loaded.hash === config.buildRecord.nativeHash &&
    loaded.dll === config.buildRecord.dll && loaded.dllHash === config.buildRecord.dllHash &&
    loaded.helper === config.buildRecord.helper && loaded.helperHash === config.buildRecord.helperHash &&
    loaded.patched === (config.build === 'rebuilt-owner-retain'));
  const sameProcess = Boolean(summary && (counts ?? []).every(c => c.samples.every(s => s.native.pid === summary.pid)) &&
    dirs.every(n => readJSON(path.join(dir, n, 'session.json'))?.pid === summary.pid));
  const resources = legacy.resourceAssessment(counts);
  const owner = sessions.length === expected && sessions.every(s => s.owner.pass);
  const classification = config.matrixReady === false || !config.buildRecord.pass || !config.observer ? 'inconclusive' :
    sessions.find(s => s.classification)?.classification ?? (!lifecycle ? 'natural-lifecycle-failure' :
      !binding || !sameProcess ? 'evidence-error' : !owner ? 'close-failure' : !resources.pass ? 'resource-failure' : 'passed');
  return { pass: lifecycle && owner && binding && sameProcess && resources.pass, classification, lifecycle, owner, binding, sameProcess,
    ownerMeaning: config.build === 'prebuilt-stock' ? 'uninstrumented-stock' : config.close ? 'known-owner-cleared' : 'intentional-owner-retention-positive-control',
    resources, resourceMeaning: 'unchanged legacy same-process oracle; not a cross-control global-zero requirement', sessions };
}

function verifyManifest(dir) {
  const recorded = readJSON(path.join(dir, 'manifest.json')); assert(Array.isArray(recorded), 'Missing manifest');
  const files = allFiles(dir).filter(n => n !== 'manifest.json');
  assert.deepEqual(recorded.map(r => r.file).sort(), files, 'Manifest member mismatch');
  for (const record of recorded) assert.equal(hash(fs.readFileSync(path.join(dir, record.file))), record.hash, 'Manifest hash: ' + record.file);
}
async function verifyBuild(root, kind, record, synthetic) {
  const dir = path.join(root, 'builds', kind); verifyManifest(dir);
  assert.deepEqual(readJSON(path.join(dir, 'build.json')), record);
  if (!record.pass) return;
  assert.equal(record.kind, kind); assert.equal(record.node, '22.23.2');
  for (const input of record.inputs) assert.equal(hash(fs.readFileSync(path.join(dir, input.snapshot))), input.hash, input.snapshot);
  assert.equal(hash(fs.readFileSync(path.join(dir, record.nativeSnapshot))), record.nativeHash);
  assert.equal(hash(fs.readFileSync(path.join(dir, record.dllSnapshot))), record.dllHash);
  assert.equal(hash(fs.readFileSync(path.join(dir, record.helperSnapshot))), record.helperHash);
  assert.equal(record.dllHash, record.stockDll.hash);
  assert.equal(record.helperHash, record.stockHelper.hash);
  if (kind === 'rebuilt-owner-retain') {
    assert.equal(record.compilation.status, 0); assert.equal(record.transform.sourceHash, record.source.hash);
    assert.equal(hash(fs.readFileSync(path.join(dir, 'source-after/conpty.cc'))), record.transform.patchedSourceHash);
    assert.equal(hash(fs.readFileSync(path.join(dir, 'source.patch'))), record.transform.patchHash);
    assert.equal(hash(fs.readFileSync(path.join(dir, 'src/win/conpty.cc'))), record.transform.patchedSourceHash);
    if (!synthetic) {
      assert.equal(record.transform.headerHash, record.header.hash);
      assert.equal(hash(fs.readFileSync(path.join(dir, 'src/win/conpty.h'))), record.transform.headerHash);
      const transformer = await loadTransformer();
      const expected = transformer.patchConptyOwnerFile(path.join(dir, record.source.snapshot), path.join(dir, record.header.snapshot));
      assert.equal(expected.patchedSourceHash, record.transform.patchedSourceHash);
      assert.equal(expected.patchHash, record.transform.patchHash); assert.equal(expected.headerHash, record.transform.headerHash);
      assert.equal(hash(fs.readFileSync(path.join(dir, record.toolchain.executable.snapshot))), record.toolchain.executable.hash);
    }
  }
}
async function verifySaved(root, quiet = false) {
  const entries = schedule(), report = { attempted: 0, verified: 0, failures: [], evidenceErrors: [] };
  let builds;
  try {
    verifyManifest(root);
    const saved = readJSON(path.join(root, 'schedule.json')); assert(saved, 'Missing schedule');
    assert.equal(saved.schema, 1); assert.equal(saved.platform, 'win32'); assert.deepEqual(saved.settings, settings); assert.deepEqual(saved.entries, entries);
    const env = readJSON(path.join(root, 'environment.json')); assert(env?.sources?.length >= 5, 'Missing source provenance');
    report.synthetic = env.synthetic === true;
    assert(!report.synthetic || values['self-test'], 'Synthetic evidence cannot qualify as a native saved run');
    for (const source of env.sources) assert.equal(hash(fs.readFileSync(path.join(root, source.snapshot))), source.hash, source.snapshot);
    if (!report.synthetic) for (const [name, expected] of Object.entries(frozen)) {
      const source = env.sources.find(item => item.snapshot.endsWith('-' + name)); assert(source, 'Missing frozen snapshot: ' + name);
      assert.equal(hash(fs.readFileSync(path.join(root, source.snapshot), 'utf8').replaceAll('\r\n', '\n')), expected, 'Frozen snapshot: ' + name);
    }
    const compiled = readJSON(path.join(root, 'compilation.json')); assert(compiled, 'Missing observer provenance');
    for (const source of compiled.sources) assert.equal(hash(fs.readFileSync(path.join(root, source.snapshot))), source.hash, source.snapshot);
    if (compiled.binarySnapshot) assert.equal(hash(fs.readFileSync(path.join(root, compiled.binarySnapshot))), compiled.hash);
    builds = readJSON(path.join(root, 'builds.json')); assert(builds, 'Missing builds');
    for (const kind of ['prebuilt-stock', 'rebuilt-owner-retain']) await verifyBuild(root, kind, builds[kind], report.synthetic);
  } catch (error) { report.evidenceErrors.push({ id: 'provenance', error: String(error) }); }
  for (const entry of entries) {
    report.attempted++; const dir = path.join(root, entry.id);
    try {
      verifyManifest(dir); const config = readJSON(path.join(dir, 'config.json')); assert(config);
      for (const [key, value] of Object.entries(entry)) assert.deepEqual(config[key], value);
      if (builds?.[entry.build]) assert.deepEqual(config.buildRecord, builds[entry.build]);
      const assessment = await assessDriver(dir, config); assert.deepEqual(assessment, readJSON(path.join(dir, 'assessment.json')));
      report.verified++; if (!assessment.pass) report.failures.push({ id: entry.id, classification: assessment.classification });
    } catch (error) { report.evidenceErrors.push({ id: entry.id, error: String(error) }); }
  }
  report.pass = report.verified === entries.length && !report.failures.length && !report.evidenceErrors.length;
  if (!quiet) console.log(JSON.stringify({ ...report, note: 'Offline verification, not native execution' }));
  return report;
}

function syntheticOwner(id, generation) {
  return { id, generation, hpcPresent: true, hShellPresent: false, shellExited: true, shellHandleClosed: true,
    releaseCalled: true, releaseSucceeded: true, releaseHresult: 0, exitEventEnqueued: true, exitCallbackDelivered: true,
    nativeExitThreadDone: true, pipeEof: true, consumerComplete: true, closeInFlight: false, closeInvoked: false,
    ownerClosed: false, batonRemoved: false, lifecycleFailed: false, pid: 700, exitCode: 0 };
}
function syntheticOwnerEvidence(config, index) {
  const owner = syntheticOwner(index + 1, String(index + 1)), owners = Array.from({ length: index + 1 }, (_, i) => syntheticOwner(i + 1, String(i + 1)));
  const base = ['owner-created', 'release-called', 'release-returned', 'shell-exited', 'shell-handle-closed',
    'exit-enqueue-request', 'exit-callback-delivered', 'exit-event-enqueued', 'exit-tsfn-release',
    'native-exit-thread-done', 'mark-pipe-eof', 'mark-consumer-complete'];
  const events = base.map((event, i) => ({ seq: i + 1, event, id: owner.id, generation: owner.generation, qpcTicks: i + 1, threadId: 11, ok: true, error: 0 }));
  const before = { schema: 1, owners: config.close ? [owner] : owners, events }, after = structuredClone(before);
  let close = { skipped: true };
  if (config.close) {
    const state = { ...owner, hpcPresent: false, closeInvoked: true, ownerClosed: true, batonRemoved: true };
    close = { ok: true, error: null, state }; after.owners = [];
    for (const event of ['close-request', 'close-invoked', 'close-returned', 'owner-closed', 'baton-removed']) {
      after.events.push({ seq: after.events.length + 1, event, id: owner.id, generation: owner.generation, qpcTicks: after.events.length + 1, threadId: 11, ok: true, error: 0 });
    }
  }
  if (config.build === 'prebuilt-stock') return { owner, before: { supported: false, owners: [], events: [] }, after: { supported: false, owners: [], events: [] }, close };
  return { owner, before, after, close };
}
async function syntheticSession(config, dir, index) {
  fs.mkdirSync(dir); const raw = Buffer.from(payload.toString().replaceAll('\n', '\r\n'));
  save(dir, 'config.json', { ...config, dir, scenario: 'read-through', index });
  save(dir, 'fixture-owner.json', { pid: 700, token: config.token, stdinTTY: true, stdoutTTY: true });
  save(dir, 'writer-receipt.json', { pid: 700, token: config.token, written: true, bytes: payload.length, hash: hash(payload) });
  save(dir, 'fixture-gate.json', { token: config.token });
  save(dir, 'native-owner.json', { pid: 700, token: config.token, id: index + 1, generation: String(index + 1) });
  fs.writeFileSync(path.join(dir, 'observed.bin'), raw); fs.writeFileSync(path.join(dir, 'delivered.bin'), raw);
  save(dir, 'terminal-state.json', await legacy.render(raw));
  const events = [
    { event: 'worker-ready' }, { event: 'native-connected' }, { event: 'gate-published' },
    { event: 'worker-observed', id: 1, hash: hash(raw), bytes: raw.length },
    { event: 'worker-delivery', id: 1, hash: hash(raw), bytes: raw.length },
    { event: 'consumer-enqueue', id: 1, hash: hash(raw) }, { event: 'consumer-applied', id: 1 },
    { event: 'worker-pipe-end', cancelled: false }, { event: 'markPipeEof' },
    { event: 'worker-pipe-close', hadError: false, ended: true, cancelled: false },
    { event: 'source', reason: 'pipe-eof' }, { event: 'native-exit', code: 0, signal: 0 }, { event: 'input-close' },
    { event: 'worker-exit', code: 0 }, { event: 'decoder-end' }, { event: 'consumer-complete' }, { event: 'markConsumerComplete' },
    ...(config.close ? [{ event: 'close-call' }, { event: 'close-result' }] : []), { event: 'terminal-disposed' },
  ].map((e, i) => ({ ...e, index: i, ns: String(i + 1) }));
  fs.writeFileSync(path.join(dir, 'events.ndjson'), events.map(e => JSON.stringify(e)).join('\n') + '\n');
  save(dir, 'session.json', { pid: 900, scenario: 'read-through', source: 'pipe-eof', sourceEnded: true, nativeExit: { code: 0, signal: 0 },
    workerExit: 0, inputClosed: true, closed: true, gate: true, accepted: 1, applied: 1, pending: 0, observed: raw.length, delivered: raw.length });
  const evidence = syntheticOwnerEvidence(config, index);
  save(dir, 'owner-created.json', { id: evidence.owner.id, generation: evidence.owner.generation });
  save(dir, 'owner-snapshot-before-close.json', evidence.before); save(dir, 'owner-snapshot-after-close.json', evidence.after);
  save(dir, 'close-result.json', evidence.close);
  save(dir, 'post-close.json', { observedUnchanged: true, deliveredUnchanged: true, stateUnchanged: true, events: [] });
  for (const [name, ns] of [['before', '1'], ['after', '100000001']]) save(dir, 'resources-' + name + '-close.json', { ns, native: { pid: 900, handles: 10, threads: 7 }, js: [] });
}
function syntheticBuild(root, kind) {
  const dir = path.join(root, 'builds', kind); fs.mkdirSync(dir, { recursive: true });
  const files = ['conpty.node', 'conpty.dll', 'OpenConsole.exe', 'source-before/conpty.cc', 'source-after/conpty.cc', 'src/win/conpty.cc', 'source.patch'];
  for (const file of files) { fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true }); fs.writeFileSync(path.join(dir, file), 'synthetic:' + file.split('/').at(-1)); }
  const input = file => ({ snapshot: file, hash: hash(fs.readFileSync(path.join(dir, file))) });
  const record = { kind, dir, node: '22.23.2', pass: true, synthetic: true,
    nativeModule: path.join(dir, 'conpty.node'), dll: path.join(dir, 'conpty.dll'), helper: path.join(dir, 'OpenConsole.exe'),
    nativeSnapshot: 'conpty.node', dllSnapshot: 'conpty.dll', helperSnapshot: 'OpenConsole.exe',
    nativeHash: input('conpty.node').hash, dllHash: input('conpty.dll').hash, helperHash: input('OpenConsole.exe').hash,
    stockDll: input('conpty.dll'), stockHelper: input('OpenConsole.exe'), source: input('source-before/conpty.cc'),
    inputs: files.map(input), compilation: { status: 0 }, transform: { sourceHash: input('source-before/conpty.cc').hash,
      patchedSourceHash: input('source-after/conpty.cc').hash, patchHash: input('source.patch').hash } };
  save(dir, 'build.json', record); manifest(dir); return record;
}
async function syntheticEvidence(root) {
  fs.mkdirSync(root); save(root, 'schedule.json', { schema: 1, platform: 'win32', settings, entries: schedule() });
  const inputs = Array.from({ length: 5 }, (_, i) => {
    const file = 'source-' + i; fs.writeFileSync(path.join(root, file), 'synthetic source ' + i);
    return { snapshot: file, hash: hash(fs.readFileSync(path.join(root, file))) };
  });
  save(root, 'environment.json', { synthetic: true, sources: inputs }); save(root, 'compilation.json', { synthetic: true, sources: [] });
  const builds = Object.fromEntries(['prebuilt-stock', 'rebuilt-owner-retain'].map(kind => [kind, syntheticBuild(root, kind)])); save(root, 'builds.json', builds);
  for (const entry of schedule()) {
    const dir = path.join(root, entry.id); fs.mkdirSync(dir);
    const config = { ...entry, dir, token: 'synthetic-only', observer: 'synthetic', buildRecord: builds[entry.build] }; save(dir, 'config.json', config);
    if (entry.kind === 'native') for (let i = 0; i < settings.warmup + settings.measured; i++) await syntheticSession(config, path.join(dir, 'session-' + i), i);
    save(dir, 'summary.json', { pid: 900 });
    save(dir, 'driver.json', { pid: 900, code: 0, timedOut: false }); save(dir, 'natural-exit.json', { pid: 900, code: 0 }); save(dir, 'process-exit.json', { pid: 900, code: 0 });
    save(dir, 'loaded-native.json', { path: config.buildRecord.nativeModule, hash: config.buildRecord.nativeHash,
      dll: config.buildRecord.dll, dllHash: config.buildRecord.dllHash, helper: config.buildRecord.helper, helperHash: config.buildRecord.helperHash,
      patched: entry.build === 'rebuilt-owner-retain' });
    const counts = Array.from({ length: settings.measured + 1 }, (_, i) => ({ index: i + settings.warmup - 1,
      samples: Array.from({ length: settings.snapshots }, () => ({ ns: '1', native: { pid: 900, handles: 10, threads: 7 }, js: [] })) }));
    save(dir, 'counts.json', counts); save(dir, 'assessment.json', await assessDriver(dir, config)); manifest(dir);
  }
  manifest(root);
}
async function selfTest() {
  const dir = process.env.DSC_HPCON_OWNER_SELFTEST_EVIDENCE ? path.resolve(process.env.DSC_HPCON_OWNER_SELFTEST_EVIDENCE) : fs.mkdtempSync(path.join(os.tmpdir(), 'dsc-hpcon-owner-selftest-'));
  fs.mkdirSync(dir, { recursive: true });
  const sourceFiles = [script, path.join(path.dirname(script), 'windows-hpcon-owner-patch.mjs'),
    ...Object.keys(frozen).map(name => path.join(path.dirname(script), name))];
  save(dir, 'sources.json', sourceFiles.map((file, i) => ({ ...snapshot(file, dir, 'source-snapshot/' + i + '-' + path.basename(file)),
    lfHash: hash(fs.readFileSync(file, 'utf8').replaceAll('\r\n', '\n')) })));
  const transformer = await loadTransformer(), transform = transformer.selfTest(); assert(transform.ok);
  const root = path.join(dir, 'synthetic'); await syntheticEvidence(root);
  const positive = await verifySaved(root, true); assert(positive.pass, JSON.stringify(positive));
  const entry = schedule().find(e => e.close && e.kind === 'native'), config = readJSON(path.join(root, entry.id, 'config.json'));
  const sample = path.join(root, entry.id, 'session-0'), negatives = [];
  const testMutation = (name, file, mutate) => {
    const location = path.join(sample, file), original = fs.readFileSync(location);
    const next = JSON.parse(original); mutate(next); save(sample, file, next);
    const assessment = assessOwner(sample, config, 0); assert(!assessment.pass, name + ' unexpectedly passed');
    negatives.push({ name, rejected: true }); fs.writeFileSync(location, original);
  };
  for (const gate of ['shellExited', 'pipeEof', 'consumerComplete', 'nativeExitThreadDone']) testMutation('missing-' + gate, 'owner-snapshot-before-close.json', v => { v.owners[0][gate] = false; });
  testMutation('unknown-id', 'owner-created.json', v => { v.id = 99; });
  testMutation('wrong-generation', 'owner-created.json', v => { v.generation = '999'; });
  testMutation('double-close', 'owner-snapshot-after-close.json', v => { v.events.push({ ...v.events.find(e => e.event === 'close-invoked'), seq: 99 }); });
  testMutation('owner-not-removed', 'owner-snapshot-after-close.json', v => { v.owners.push(syntheticOwner(1, '1')); });
  testMutation('close-before-exit', 'owner-snapshot-after-close.json', v => { [v.events[0], v.events[10]] = [v.events[10], v.events[0]]; });
  testMutation('close-side-effect-output', 'post-close.json', v => { v.deliveredUnchanged = false; });
  testMutation('illegal-owner-ledger', 'close-result.json', v => { v.state.hpcPresent = true; });
  testMutation('failed-release-hresult', 'owner-snapshot-after-close.json', v => { v.events.find(e => e.event === 'release-returned').error = 0x80004005; });
  const releaseFiles = ['owner-snapshot-before-close.json', 'owner-snapshot-after-close.json', 'close-result.json'];
  const originals = releaseFiles.map(file => fs.readFileSync(path.join(sample, file)));
  for (const [i, file] of releaseFiles.entries()) {
    const value = JSON.parse(originals[i]);
    if (value.events) value.events.find(e => e.event === 'release-returned').error = 1;
    if (value.owners?.length) value.owners[0].releaseHresult = 1;
    if (value.state) value.state.releaseHresult = 1;
    save(sample, file, value);
  }
  assert(assessOwner(sample, config, 0).pass, 'SUCCEEDED nonzero HRESULT must remain successful');
  for (const [i, file] of releaseFiles.entries()) fs.writeFileSync(path.join(sample, file), originals[i]);
  const noCloseEntry = schedule().find(e => e.build === 'rebuilt-owner-retain' && !e.close && e.kind === 'native');
  const noCloseDir = path.join(root, noCloseEntry.id, 'session-22');
  assert.equal(assessOwner(noCloseDir, readJSON(path.join(root, noCloseEntry.id, 'config.json')), 22).ownerCount, 23);
  const first = path.join(root, schedule()[0].id), firstConfig = readJSON(path.join(first, 'config.json'));
  const counts = readJSON(path.join(first, 'counts.json')); counts.at(-1).samples.forEach(s => { s.native.handles++; }); save(first, 'counts.json', counts);
  save(first, 'assessment.json', await assessDriver(first, firstConfig)); manifest(first); manifest(root);
  const resourceFailure = await verifySaved(root, true); assert.equal(resourceFailure.failures.length, 1); assert.equal(resourceFailure.failures[0].classification, 'resource-failure'); assert.equal(resourceFailure.evidenceErrors.length, 0);
  fs.appendFileSync(path.join(first, 'config.json'), 'corrupt');
  const corrupt = await verifySaved(root, true); assert.equal(corrupt.attempted, 12); assert.equal(corrupt.verified, 11); assert(corrupt.evidenceErrors.some(e => e.id === schedule()[0].id));
  const binary = path.join(root, 'builds/rebuilt-owner-retain/conpty.node'); fs.appendFileSync(binary, 'wrong hash');
  const badHash = await verifySaved(root, true); assert(badHash.evidenceErrors.some(e => e.id === 'provenance')); assert.equal(badHash.attempted, 12);
  const missing = path.join(root, schedule().at(-1).id, 'manifest.json'); fs.renameSync(missing, missing + '.missing');
  const missingEvidence = await verifySaved(root, true); assert(missingEvidence.evidenceErrors.some(e => e.id === schedule().at(-1).id));
  const watchdog = await guarded(['--watchdog-block'], 100); assert(watchdog.timedOut);
  save(dir, 'self-test.json', { transform, positive, negatives, resourceFailure, corrupt, badHash, missingEvidence, watchdog });
  console.log('HPCON owner source/three-arm/ledger/provenance/watchdog self-tests passed: ' + dir + '. Synthetic evidence only; no Windows PTY execution.');
}
