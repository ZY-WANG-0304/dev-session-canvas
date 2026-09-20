// Isolated attribution experiment. The frozen session driver and installed dependencies stay unchanged.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const script = fileURLToPath(import.meta.url), require = createRequire(import.meta.url);
const arms = ['prebuilt', 'rebuilt-baseline', 'rebuilt-close'];
const entries = ['control-1', 'native-1', 'control-2', 'native-2'];
const frozen = {
  'diagnose-runtime-owned-lifecycle.mjs': '4c2e3decf149c120c06faa9fcb3f997aa6f6dc2990dcad7cedece7b622cfb09d',
  'runtime-owned-cancel-worker.mjs': '8630eab630bb085c843e92467d578b59f3f4480cccef4c6b56e5b3a75ebc1489',
  'native-runtime-resources.c': 'fcd2cc8d55d8033b53c5e23e647e8ce7bb8b39f2c8931bcd50a302cb06b72adb',
};
const sourceHash = '19210adfdaba3cd09809b56bb3281b14e74a8e5efc1f35d467d3c423c30856db';
const anchor = '    }\n#else\n    while (true) {';
const replacement = '    }\n    if (kq >= 0) {\n      close(kq);\n    }\n#else\n    while (true) {';
const settings = { runs: 3, warmup: 3, measured: 20, snapshots: 5, snapshotMs: 20, settleMs: 100,
  sampleMs: 30000, resourceGuardMs: 2000, cancelHardMs: 35000, batchHardMs: 150000, cols: 96, rows: 28, pollMs: 2 };
const { values } = parseArgs({ options: { output: { type: 'string' }, 'verify-saved': { type: 'string' }, 'self-test': { type: 'boolean' } } });
try {
  if (values['self-test']) await selfTest();
  else if (values['verify-saved']) process.exitCode = (await verify(path.resolve(values['verify-saved']))).pass ? 0 : 1;
  else await run();
} catch (error) { console.error(error.stack ?? error); process.exitCode = 1; }

function patchSource(source) {
  assert.equal(hash(source), sourceHash, 'Unexpected pty.cc input');
  assert.equal(source.split(anchor).length - 1, 1, 'Nonunique Apple exit-wait anchor');
  const patched = source.replace(anchor, replacement);
  assert.equal(patched.replace(replacement, anchor), source);
  return patched;
}
function files(dir, prefix = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    assert(!entry.isSymbolicLink(), `Unexpected symlink in evidence: ${prefix}/${entry.name}`);
    const relative = path.posix.join(prefix, entry.name);
    return entry.isDirectory() ? files(path.join(dir, entry.name), relative) : [relative];
  }).sort();
}
function copyTree(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const relative of files(source)) {
    const target = path.join(destination, relative); fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(source, relative), target);
    fs.chmodSync(target, fs.statSync(path.join(source, relative)).mode & 0o777);
  }
}
function copyFile(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(source, target);
  fs.chmodSync(target, fs.statSync(source).mode & 0o777);
}
function command(file, args, options = {}) {
  const result = spawnSync(file, args, { encoding: 'utf8', timeout: 120000, maxBuffer: 32 * 1024 * 1024, ...options });
  return { file, args, cwd: options.cwd, status: result.status, signal: result.signal,
    error: result.error?.message, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}
function successful(result, context) {
  assert(!result.error && !result.signal && result.status === 0, `${context}: ${result.error || result.stderr || result.status}`);
}
function seal(dir) {
  save(dir, 'manifest.json', files(dir).filter(file => file !== 'manifest.json').map(file => ({ file, hash: hash(fs.readFileSync(path.join(dir, file))) })));
}
function validateManifest(dir, records, prefix, exclude = () => false) {
  const selected = file => (prefix ? file.startsWith(prefix) : !file.startsWith('arms/')) && !exclude(file);
  const expected = records.filter(record => selected(record.file));
  const all = files(dir).filter(file => file !== 'manifest.json').filter(selected);
  assert.deepEqual(expected.map(record => record.file).sort(), all);
  for (const record of expected) assert.equal(hash(fs.readFileSync(path.join(dir, record.file))), record.hash, record.file);
}
function removeBuildLinks(build, prefix = '') {
  if (!fs.existsSync(build)) return [];
  return fs.readdirSync(build, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(build, entry.name), relative = path.posix.join(prefix, entry.name);
    if (entry.isSymbolicLink()) {
      const target = fs.readlinkSync(full); fs.unlinkSync(full); return [{ path: relative, target, removedAfterBuild: true }];
    }
    return entry.isDirectory() ? removeBuildLinks(full, relative) : [];
  });
}

function prepare(dir) {
  assert.equal(process.platform, 'darwin', 'Native experiment requires macOS');
  const ptyRoot = path.dirname(require.resolve('node-pty/package.json'));
  const ptyRequire = createRequire(path.join(ptyRoot, 'package.json'));
  const addonRoot = path.dirname(ptyRequire.resolve('node-addon-api/package.json'));
  assert.equal(ptyRequire('node-addon-api/package.json').version, '7.1.1');
  assert.equal(require('node-pty/package.json').version, '1.2.0-beta.12');
  const inputs = path.join(dir, 'inputs'); fs.mkdirSync(inputs);
  copyFile(script, path.join(inputs, 'diagnose-macos-kqueue-release.mjs'));
  for (const [name, expected] of Object.entries(frozen)) {
    const original = path.join(path.dirname(script), name);
    assert.equal(hash(fs.readFileSync(original)), expected, `Frozen input changed: ${name}`);
    copyFile(original, path.join(inputs, name));
  }
  const original = fs.readFileSync(path.join(ptyRoot, 'src/unix/pty.cc'), 'utf8');
  const patched = patchSource(original);
  fs.writeFileSync(path.join(inputs, 'pty-before.cc'), original); fs.writeFileSync(path.join(inputs, 'pty-after.cc'), patched);
  fs.writeFileSync(path.join(inputs, 'close.patch'), '--- a/src/unix/pty.cc\n+++ b/src/unix/pty.cc\n@@ -203,6 +203,9 @@\n' +
    '         }\n       }\n     }\n+    if (kq >= 0) {\n+      close(kq);\n+    }\n #else\n     while (true) {\n       errno = 0;\n');
  const headers = process.env.DSC_NODE_INCLUDE_DIR || path.resolve(path.dirname(fs.realpathSync(process.execPath)), '../include/node');
  const headerVersion = fs.readFileSync(path.join(headers, 'node_version.h'), 'utf8');
  const version = ['MAJOR', 'MINOR', 'PATCH'].map(part => headerVersion.match(new RegExp(`#define NODE_${part}_VERSION\\s+(\\d+)`))[1]).join('.');
  assert.equal(version, process.versions.node, 'Header/runtime mismatch');
  const headerRoot = path.join(inputs, 'node-headers'); copyTree(headers, path.join(headerRoot, 'include/node'));
  for (const name of ['node_api.h', 'node_version.h', 'common.gypi', 'config.gypi']) assert(fs.existsSync(path.join(headerRoot, 'include/node', name)), `Missing Node compilation input: ${name}`);
  const gyp = fs.realpathSync(process.env.DSC_NODE_GYP || '');
  const gypRoot = path.dirname(path.dirname(gyp));
  const gypPackage = JSON.parse(fs.readFileSync(path.join(gypRoot, 'package.json')));
  assert.equal(gypPackage.name, 'node-gyp'); assert.equal(path.basename(gyp), 'node-gyp.js');
  copyTree(gypRoot, path.join(inputs, 'node-gyp'));
  const toolLock = path.resolve(gypRoot, '../../package-lock.json');
  assert(fs.existsSync(toolLock), 'Pinned node-gyp tooling must retain its package-lock.json');
  copyFile(toolLock, path.join(inputs, 'tooling-package-lock.json'));
  const metadata = { platform: process.platform, arch: process.arch, kernel: os.release(), versions: process.versions,
    nodePty: ptyRequire('./package.json').version, addon: { originalRoot: addonRoot, version: '7.1.1' },
    gyp: { path: gyp, version: gypPackage.version, hash: hash(fs.readFileSync(gyp)), lockPath: toolLock, lockHash: hash(fs.readFileSync(toolLock)) }, headers: { originalRoot: headers, version },
    github: { sha: process.env.GITHUB_SHA, run: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT, image: process.env.ImageVersion },
    compilerEnvironment: Object.fromEntries(['CC', 'CXX', 'CFLAGS', 'CXXFLAGS', 'LDFLAGS', 'SDKROOT', 'MACOSX_DEPLOYMENT_TARGET', 'PYTHON', 'npm_config_python'].map(name => [name, process.env[name] ?? null])),
    tools: [['clang', ['--version']], ['xcrun', ['--show-sdk-path']], ['sw_vers', []], ['python3', ['--version']], ['make', ['--version']]].map(([file, args]) => {
      const result = command(file, args), located = command('which', [file]); successful(located, `Locate ${file}`);
      result.resolvedPath = fs.realpathSync(located.stdout.trim()); result.binaryHash = hash(fs.readFileSync(result.resolvedPath)); return result;
    }) };
  metadata.tools.forEach(result => successful(result, `Tool inspection ${result.file}`));
  metadata.sdkCompilers = ['clang', 'clang++'].map(name => {
    const located = command('xcrun', ['--find', name]); successful(located, `Locate SDK ${name}`);
    const resolvedPath = fs.realpathSync(located.stdout.trim()), version = command(resolvedPath, ['--version']);
    successful(version, `SDK ${name} version`);
    return { name, resolvedPath, binaryHash: hash(fs.readFileSync(resolvedPath)), version };
  });
  save(dir, 'environment.json', metadata);
  const prebuilt = path.join(ptyRoot, `prebuilds/darwin-${process.arch}`);
  assert(fs.existsSync(path.join(prebuilt, 'pty.node')) && fs.existsSync(path.join(prebuilt, 'spawn-helper')));
  return { ptyRoot, addonRoot, prebuilt, headerRoot, gyp, inputs, patched,
    headlessRoot: path.dirname(require.resolve('@xterm/headless/package.json')) };
}

function runArm(dir, arm, shared) {
  const root = path.join(dir, 'arms', arm); fs.mkdirSync(root, { recursive: true });
  const harness = path.join(root, 'harness'), ptyRoot = path.join(harness, 'node_modules/node-pty');
  const record = { arm, root, harness, ptyRoot, status: 'preparing' };
  try {
    for (const name of Object.keys(frozen)) copyFile(path.join(shared.inputs, name), path.join(harness, name));
    for (const name of ['package.json', 'binding.gyp']) copyFile(path.join(shared.ptyRoot, name), path.join(ptyRoot, name));
    for (const name of ['lib', 'src']) copyTree(path.join(shared.ptyRoot, name), path.join(ptyRoot, name));
    copyTree(shared.addonRoot, path.join(ptyRoot, 'node_modules/node-addon-api'));
    copyTree(shared.headlessRoot, path.join(harness, 'node_modules/@xterm/headless'));
    copyTree(shared.prebuilt, path.join(ptyRoot, `prebuilds/darwin-${process.arch}`));
    const actualAddon = command(process.execPath, ['-p', 'JSON.stringify({path:require.resolve("node-addon-api/package.json"),version:require("node-addon-api/package.json").version})'], { cwd: ptyRoot });
    successful(actualAddon, 'Isolated addon resolution'); record.addon = JSON.parse(actualAddon.stdout);
    assert.equal(record.addon.path, path.join(ptyRoot, 'node_modules/node-addon-api/package.json'));
    assert.equal(record.addon.version, '7.1.1');
    if (arm === 'rebuilt-close') fs.writeFileSync(path.join(ptyRoot, 'src/unix/pty.cc'), shared.patched);
    record.sourceHash = hash(fs.readFileSync(path.join(ptyRoot, 'src/unix/pty.cc')));
    record.expectedNative = path.join(ptyRoot, arm === 'prebuilt' ? `prebuilds/darwin-${process.arch}/pty.node` : 'build/Release/pty.node');
    record.expectedHelper = path.join(path.dirname(record.expectedNative), 'spawn-helper');
    if (arm !== 'prebuilt') {
      record.build = command(process.execPath, [shared.gyp, 'rebuild', `--directory=${ptyRoot}`, `--nodedir=${shared.headerRoot}`, '--verbose'], { cwd: ptyRoot });
      save(root, 'build.json', record.build);
      save(root, 'generated-build-links.json', removeBuildLinks(path.join(ptyRoot, 'build')));
      successful(record.build, 'Native rebuild');
      assert(fs.existsSync(record.expectedNative), 'Missing rebuilt pty.node');
      copyFile(record.expectedHelper, path.join(root, 'unused-rebuilt-spawn-helper'));
      copyFile(path.join(shared.prebuilt, 'spawn-helper'), record.expectedHelper);
    }
    record.nativeHash = hash(fs.readFileSync(record.expectedNative)); record.helperHash = hash(fs.readFileSync(record.expectedHelper));
    assert.equal(record.helperHash, hash(fs.readFileSync(path.join(shared.prebuilt, 'spawn-helper'))));
    const resolution = command(process.execPath, ['-e', 'const path=require("path"),u=require("node-pty/lib/utils"),n=u.loadNativeModule("pty");console.log(JSON.stringify({path:path.resolve(path.dirname(require.resolve("node-pty/lib/index")),n.dir,"pty.node"),loaded:Object.keys(require.cache).filter(p=>p.endsWith("pty.node"))}));'], { cwd: harness });
    successful(resolution, 'Actual native loading'); record.resolution = JSON.parse(resolution.stdout);
    assert.equal(record.resolution.path, record.expectedNative); assert.deepEqual(record.resolution.loaded, [record.expectedNative]);
    record.status = 'running'; save(root, 'arm.json', record);
    record.run = command(process.execPath, [path.join(harness, 'diagnose-runtime-owned-lifecycle.mjs'), '--output', path.join(root, 'evidence')],
      { cwd: harness, timeout: 650000, env: { ...process.env, DSC_NODE_INCLUDE_DIR: path.join(shared.headerRoot, 'include/node') } });
    save(root, 'run.json', record.run);
    record.offline = command(process.execPath, [path.join(harness, 'diagnose-runtime-owned-lifecycle.mjs'), '--verify-saved', path.join(root, 'evidence')], { cwd: harness, timeout: 120000 });
    save(root, 'offline.json', record.offline); record.status = 'collected';
  } catch (error) { record.status = 'failed'; record.error = error.stack ?? String(error); }
  save(root, 'arm.json', record); return record;
}
async function run() {
  assert(values.output, 'Specify --output'); const dir = path.resolve(values.output);
  assert(!fs.existsSync(dir), 'Refusing to overwrite evidence'); fs.mkdirSync(dir, { recursive: true });
  save(dir, 'schedule.json', { arms, entries, settings });
  const records = [];
  try { const shared = prepare(dir); for (const arm of arms) { records.push(runArm(dir, arm, shared)); console.log(JSON.stringify({ arm, status: records.at(-1).status, error: records.at(-1).error })); } }
  catch (error) { save(dir, 'setup-error.json', { error: error.stack ?? String(error) }); }
  save(dir, 'collection.json', records); seal(dir);
  process.exitCode = (await verify(dir)).pass ? 0 : 1;
}

function rawOldReport(result) {
  assert(!result.error && !result.signal, 'Frozen verifier did not terminate normally');
  const lines = result.stdout.trim().split('\n').filter(Boolean);
  return JSON.parse(lines.at(-1));
}
function parseOldReport(result) {
  const report = rawOldReport(result);
  assert.equal(report.attempted, 4); assert.equal(report.verified, 4); assert.deepEqual(report.evidenceErrors, []);
  assert.equal(result.status, report.pass ? 0 : 1);
  return report;
}
function evaluateArm(arm, report, results, counts) {
  assert.deepEqual(results.map(result => result.id), entries, 'Incomplete frozen schedule');
  const expectedFailures = arm === 'rebuilt-close' ? [] : ['native-1', 'native-2'];
  assert.deepEqual(report.failures.map(failure => failure.id), expectedFailures);
  assert.equal(report.pass, expectedFailures.length === 0);
  const details = [];
  for (const result of results) {
    const native = result.id.startsWith('native-');
    assert(result.lifecycle && result.sameProcess, `${result.id}: lifecycle`);
    assert.equal(result.sessions.length, native ? 23 : 0); assert(result.sessions.every(session => session.pass));
    assert.equal(result.pass, arm === 'rebuilt-close' || !native); assert.equal(result.resources.pass, result.pass);
    const windows = counts[result.id]; assert.equal(windows.length, 21);
    const initial = windows[0].samples;
    assert.equal(initial.length, 5);
    const initialKqueues = initial.map(sample => sample.native.descriptors.filter(fd => fd.type === 'kqueue').length);
    assert(initialKqueues.every(n => n === initialKqueues[0]), 'Unstable baseline kqueue count');
    const baseline = Math.max(...initial.map(sample => sample.native.fds));
    for (const [index, window] of windows.entries()) {
      assert.equal(window.index, index + 2); assert.equal(window.samples.length, 5);
      const delta = native && arm !== 'rebuilt-close' ? index : 0;
      for (const sample of window.samples) {
        assert.equal(sample.native.descriptors.filter(fd => fd.type === 'kqueue').length, initialKqueues[0] + delta,
          `${result.id}/${index}: kqueue trajectory`);
        if (delta) assert.equal(sample.native.fds, baseline + delta, `${result.id}/${index}: fd trajectory`);
      }
    }
    details.push({ id: result.id, resourcePass: result.resources.pass, initialKqueues: initialKqueues[0], finalKqueues: windows.at(-1).samples[0].native.descriptors.filter(fd => fd.type === 'kqueue').length });
  }
  return details;
}
function validateArmInputs(dir, arm, record) {
  const root = path.join(dir, 'arms', arm), harness = path.join(root, 'harness'), pkg = path.join(harness, 'node_modules/node-pty');
  assert.equal(record.arm, arm); assert.equal(record.status, 'collected', record.error);
  assert.equal(record.addon.version, '7.1.1');
  for (const [name, expected] of Object.entries(frozen)) assert.equal(hash(fs.readFileSync(path.join(harness, name))), expected, name);
  const expectedSource = arm === 'rebuilt-close' ? patchSource(fs.readFileSync(path.join(dir, 'inputs/pty-before.cc'), 'utf8')) : fs.readFileSync(path.join(dir, 'inputs/pty-before.cc'), 'utf8');
  assert.equal(fs.readFileSync(path.join(pkg, 'src/unix/pty.cc'), 'utf8'), expectedSource);
  assert.equal(record.sourceHash, hash(expectedSource));
  const env = read(path.join(root, 'evidence/environment.json'));
  assert.equal(env.platform, 'darwin'); assert.deepEqual(env.settings, settings);
  const native = env.sources.find(item => item.snapshot.endsWith('-pty.node'));
  const helper = env.sources.find(item => item.snapshot.endsWith('-spawn-helper'));
  assert.equal(native.file, record.expectedNative); assert.equal(native.hash, record.nativeHash);
  assert.equal(helper.file, record.expectedHelper); assert.equal(helper.hash, record.helperHash);
  assert.equal(record.resolution.path, record.expectedNative); assert.deepEqual(record.resolution.loaded, [record.expectedNative]);
  assert.equal(record.nativeHash, hash(fs.readFileSync(path.join(pkg, arm === 'prebuilt' ? `prebuilds/darwin-${env.arch}/pty.node` : 'build/Release/pty.node'))));
  assert.equal(record.helperHash, hash(fs.readFileSync(path.join(pkg, `prebuilds/darwin-${env.arch}/spawn-helper`))));
  assert(!record.run.error && !record.run.signal); assert([0, 1].includes(record.run.status));
  assert.equal(record.run.status, record.offline.status, 'Collection and saved frozen verifier disagree');
  if (arm !== 'prebuilt') successful(record.build, 'Saved build');
  return { root, harness };
}
async function verify(dir, quiet = false, hooks = {}) {
  const report = { attempted: 0, verified: 0, results: [], failures: [], evidenceErrors: [], frozenVerifications: [] };
  let records = [];
  try {
    records = read(path.join(dir, 'manifest.json')); validateManifest(dir, records, '');
    assert.deepEqual(read(path.join(dir, 'schedule.json')), { arms, entries, settings });
    assert(!fs.existsSync(path.join(dir, 'setup-error.json')), 'Setup failed; inspect setup-error.json');
    if (!hooks.synthetic) {
      const environment = read(path.join(dir, 'environment.json'));
      assert.equal(environment.platform, 'darwin'); assert.equal(environment.headers.version, environment.versions.node);
      assert.equal(hash(fs.readFileSync(path.join(dir, 'inputs/pty-before.cc'))), sourceHash);
      assert.equal(fs.readFileSync(path.join(dir, 'inputs/pty-after.cc'), 'utf8'), patchSource(fs.readFileSync(path.join(dir, 'inputs/pty-before.cc'), 'utf8')));
      for (const [name, expected] of Object.entries(frozen)) assert.equal(hash(fs.readFileSync(path.join(dir, 'inputs', name))), expected, name);
    }
  } catch (error) { report.evidenceErrors.push({ scope: 'shared-inputs', error: String(error) }); }
  const helpers = [];
  for (const arm of arms) {
    report.attempted++;
    try {
      // Trust executable inputs first; corrupt sample data must still reach the frozen full-schedule verifier.
      validateManifest(dir, records, `arms/${arm}/`, file => file.startsWith(`arms/${arm}/evidence/`));
      const record = read(path.join(dir, 'arms', arm, 'arm.json'));
      const root = path.join(dir, 'arms', arm), harness = path.join(root, 'harness');
      const savedCommand = read(path.join(root, 'offline.json'));
      const currentCommand = hooks.synthetic ? (hooks.current?.(arm, savedCommand) ?? savedCommand) :
        command(process.execPath, [path.join(harness, 'diagnose-runtime-owned-lifecycle.mjs'), '--verify-saved', path.join(root, 'evidence')], { cwd: harness, timeout: 120000 });
      report.frozenVerifications.push({ arm, status: currentCommand.status, stdout: currentCommand.stdout, stderr: currentCommand.stderr, error: currentCommand.error });
      const current = parseOldReport(currentCommand), saved = parseOldReport(savedCommand);
      validateManifest(dir, records, `arms/${arm}/`);
      if (!hooks.synthetic) validateArmInputs(dir, arm, record);
      assert.deepEqual(current, saved, 'Offline frozen verdict changed');
      const results = read(path.join(root, 'evidence/results.json'));
      const counts = Object.fromEntries(entries.map(entry => [entry, read(path.join(root, 'evidence', entry, 'counts.json'))]));
      report.verified++; helpers.push(record.helperHash);
      try { report.results.push({ arm, pass: true, frozenFailures: saved.failures, trajectories: evaluateArm(arm, saved, results, counts) }); }
      catch (error) { report.failures.push({ arm, error: String(error) }); }
    } catch (error) { report.evidenceErrors.push({ arm, error: String(error) }); }
  }
  if (helpers.length === 3 && !helpers.every(value => value === helpers[0])) report.failures.push({ scope: 'comparison', error: 'Spawn-helper changed between arms' });
  report.pass = report.verified === 3 && !report.failures.length && !report.evidenceErrors.length;
  if (!quiet) console.log(JSON.stringify({ ...report, note: 'Attribution comparison only; baseline resource failures remain failures. Offline verification does not rerun native sessions.' }));
  return report;
}

function syntheticArm(arm) {
  const failures = arm === 'rebuilt-close' ? [] : ['native-1', 'native-2'].map(id => ({ id }));
  const results = entries.map(id => { const pass = arm === 'rebuilt-close' || id.startsWith('control-'); return { id, pass, lifecycle: true, sameProcess: true,
    sessions: Array.from({ length: id.startsWith('native-') ? 23 : 0 }, () => ({ pass: true })), resources: { pass } }; });
  const counts = Object.fromEntries(entries.map(id => [id, Array.from({ length: 21 }, (_, index) => ({ index: index + 2,
    samples: Array.from({ length: 5 }, () => { const n = 3 + (id.startsWith('native-') && arm !== 'rebuilt-close' ? index : 0);
      return { native: { fds: n + 9, descriptors: Array.from({ length: n }, (_, fd) => ({ fd, type: 'kqueue' })) } }; }) }))]));
  return { report: { attempted: 4, verified: 4, failures, evidenceErrors: [], pass: !failures.length }, results, counts };
}
async function selfTest() {
  const dir = process.env.DSC_ATTRIBUTION_SELFTEST_EVIDENCE ? path.resolve(process.env.DSC_ATTRIBUTION_SELFTEST_EVIDENCE) : fs.mkdtempSync(path.join(os.tmpdir(), 'dsc-kqueue-selftest-'));
  if (process.env.DSC_ATTRIBUTION_SELFTEST_EVIDENCE) { assert(!fs.existsSync(dir), 'Refusing to overwrite self-test evidence'); fs.mkdirSync(dir, { recursive: true }); }
  console.log(JSON.stringify({ selfTestEvidence: dir })); copyFile(script, path.join(dir, 'script.mjs'));
  const checks = [];
  try {
    const source = fs.readFileSync(path.join(path.dirname(require.resolve('node-pty/package.json')), 'src/unix/pty.cc'), 'utf8');
    assert.equal(patchSource(source).replace(replacement, anchor), source); checks.push('unique-close-transform');
    assert.throws(() => patchSource(source + '\n')); assert.throws(() => patchSource(source.replace(anchor, ''))); checks.push('bad-source-rejected');
    for (const arm of arms) {
      const fixture = syntheticArm(arm); evaluateArm(arm, fixture.report, fixture.results, fixture.counts);
      const bad = structuredClone(fixture); bad.results[1].sessions[0].pass = false;
      assert.throws(() => evaluateArm(arm, bad.report, bad.results, bad.counts));
    }
    checks.push('three-comparisons-and-session-negative');
    const bad = syntheticArm('rebuilt-close'); bad.counts['native-1'][1].samples[0].native.descriptors.push({ fd: 20, type: 'kqueue' });
    assert.throws(() => evaluateArm('rebuilt-close', bad.report, bad.results, bad.counts));
    const green = syntheticArm('prebuilt'); green.report.failures = []; green.report.pass = true;
    assert.throws(() => evaluateArm('prebuilt', green.report, green.results, green.counts)); checks.push('growth-and-fake-green-rejected');
    assert.throws(() => parseOldReport({ status: 1, stdout: JSON.stringify({ attempted: 4, verified: 3, evidenceErrors: ['bad'] }) }));
    const saved = path.join(dir, 'synthetic'); fs.mkdirSync(saved); save(saved, 'schedule.json', { arms, entries, settings });
    for (const arm of arms) {
      const root = path.join(saved, 'arms', arm); fs.mkdirSync(root, { recursive: true }); const fixture = syntheticArm(arm);
      save(root, 'arm.json', { helperHash: 'fixed' }); save(root, 'offline.json', { status: fixture.report.pass ? 0 : 1, stdout: JSON.stringify(fixture.report) });
      save(root, 'evidence/results.json', fixture.results);
      for (const entry of entries) save(root, `evidence/${entry}/counts.json`, fixture.counts[entry]);
    }
    seal(saved); const positive = await verify(saved, true, { synthetic: true }); assert(positive.pass); save(dir, 'positive.json', positive);
    const contrary = path.join(dir, 'synthetic-contrary'); copyTree(saved, contrary);
    for (const [arm, fixture] of [['prebuilt', syntheticArm('rebuilt-close')], ['rebuilt-close', syntheticArm('prebuilt')]]) {
      const root = path.join(contrary, 'arms', arm);
      save(root, 'offline.json', { status: fixture.report.pass ? 0 : 1, stdout: JSON.stringify(fixture.report) });
      save(root, 'evidence/results.json', fixture.results);
      for (const entry of entries) save(root, `evidence/${entry}/counts.json`, fixture.counts[entry]);
    }
    seal(contrary); const negative = await verify(contrary, true, { synthetic: true });
    assert.equal(negative.verified, 3); assert.equal(negative.failures.length, 2); assert.equal(negative.evidenceErrors.length, 0);
    save(dir, 'valid-contrary-results.json', negative); checks.push('valid-negative-outcomes-not-corruption');
    fs.appendFileSync(path.join(saved, 'arms/prebuilt/evidence/results.json'), 'broken');
    const corrupted = await verify(saved, true, { synthetic: true }); assert.equal(corrupted.attempted, 3); assert.equal(corrupted.verified, 2); assert.equal(corrupted.evidenceErrors.length, 1);
    assert.equal(corrupted.results.at(-1).arm, 'rebuilt-close'); save(dir, 'corrupted.json', corrupted); checks.push('corruption-does-not-skip-last-arm');
    assert.equal(corrupted.frozenVerifications.length, 3); assert.equal(rawOldReport(corrupted.frozenVerifications[0]).attempted, 4);
    const partial = await verify(saved, true, { synthetic: true, current: (arm, original) => arm !== 'prebuilt' ? original : {
      status: 1, stdout: JSON.stringify({ attempted: 4, verified: 3, evidenceErrors: [{ id: 'control-1', error: 'corrupt' }], failures: [{ id: 'native-2' }], pass: false }) } });
    assert.equal(partial.frozenVerifications.length, 3); assert.equal(rawOldReport(partial.frozenVerifications[0]).attempted, 4);
    assert.equal(rawOldReport(partial.frozenVerifications[0]).failures.at(-1).id, 'native-2'); save(dir, 'partial-frozen-verification.json', partial);
    checks.push('partial-driver-verification-retained');
    const build = path.join(dir, 'synthetic-build'); fs.mkdirSync(build); fs.symlinkSync(process.execPath, path.join(build, 'python3'));
    const removed = removeBuildLinks(build); assert.equal(removed.length, 1); assert.equal(removed[0].target, process.execPath);
    assert(fs.existsSync(process.execPath)); save(dir, 'generated-build-links.json', removed); checks.push('generated-build-link-target-preserved');
    save(dir, 'result.json', { pass: true, checks }); console.log(JSON.stringify({ pass: true, checks, dir }));
  } catch (error) { save(dir, 'result.json', { pass: false, checks, error: error.stack ?? String(error) }); throw error; }
}
function hash(value) { return createHash('sha256').update(value).digest('hex'); }
function read(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function save(dir, name, value) { const file = path.join(dir, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2)); }
