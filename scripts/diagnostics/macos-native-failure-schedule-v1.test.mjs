import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { runSchedule } from './diagnose-macos-native-failure-v1.mjs';
import { buildTools, fixedEntries, verifySaved } from './macos-native-failure-saved-v1.mjs';
import { createU16Fixture, refreshU16Snapshots, U16_TOKEN } from './macos-native-failure-fixture-v1.mjs';
import { patchMacosSource } from './macos-native-failure-patch-v1.mjs';

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const save = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
function tree(directory, prefix = '') {
  const files = fs.readdirSync(path.join(directory, prefix), { withFileTypes: true }).flatMap(entry => {
    const relative = path.posix.join(prefix, entry.name);
    return entry.isDirectory() ? tree(directory, relative).files :
      [{ file: relative, sha256: hash(fs.readFileSync(path.join(directory, relative))) }];
  }).sort((a, b) => a.file < b.file ? -1 : a.file > b.file ? 1 : 0);
  return { files, sha256: hash(JSON.stringify(files)) };
}
function seal(directory) {
  const record = tree(directory);
  const files = record.files.filter(member => member.file !== 'manifest.json');
  save(path.join(directory, 'manifest.json'), { files, sha256: hash(JSON.stringify(files)) });
}

function syntheticBuild(root) {
  const dependencies = process.env.DSC_NATIVE_DEPENDENCY_ROOT ?? path.resolve('node_modules');
  const headers = process.env.DSC_NATIVE_HEADERS_ROOT;
  assert(headers, 'Set DSC_NATIVE_HEADERS_ROOT to the frozen official Node 22.23.2 include/node tree');
  const pty = path.join(dependencies, 'node-pty');
  const directory = path.join(root, 'build'), inputs = path.join(directory, 'inputs');
  fs.mkdirSync(inputs, { recursive: true });
  for (const name of buildTools) fs.copyFileSync(path.join(sourceDirectory, name), path.join(inputs, name));
  const original = fs.readFileSync(path.join(pty, 'src/unix/pty.cc'), 'utf8');
  const helperSource = fs.readFileSync(path.join(pty, 'src/unix/spawn-helper.cc'));
  const patched = patchMacosSource(original);
  fs.writeFileSync(path.join(inputs, 'pty-before.cc'), original);
  fs.writeFileSync(path.join(inputs, 'pty-after.cc'), patched);
  fs.writeFileSync(path.join(inputs, 'spawn-helper.cc'), helperSource);
  for (const name of ['package.json', 'binding.gyp']) fs.copyFileSync(path.join(pty, name), path.join(inputs, `node-pty-${name}`));
  fs.cpSync(headers, path.join(inputs, 'node-headers'), { recursive: true });
  fs.cpSync(path.join(pty, 'node_modules/node-addon-api'), path.join(inputs, 'node-addon-api'), { recursive: true });
  const binary = path.join(directory, 'pty.node'), helper = path.join(directory, 'spawn-helper');
  // Deliberately not executable native content. These tests only read provenance bytes.
  fs.writeFileSync(binary, 'SYNTHETIC U1-6 binary: never loaded\n');
  fs.writeFileSync(helper, 'SYNTHETIC helper: never executed\n'); fs.chmodSync(helper, 0o755);
  const exported = ['fork', 'open', 'resize', 'process', 'failureConfigure', 'failureSnapshot', 'failureCloseMaster'];
  const build = { kind: 'macos-native-failure-v1-build', status: 'built-and-load-verified', nativeExecutions: 0,
    platform: 'darwin', arch: 'arm64', kernel: 'synthetic', versions: { node: '22.23.2' },
    executable: { path: process.execPath, sha256: hash(fs.readFileSync(process.execPath)) },
    binary: { path: binary, sha256: hash(fs.readFileSync(binary)) },
    helper: { path: helper, sha256: hash(fs.readFileSync(helper)), mode: 0o755 },
    sources: { originalSha256: hash(original), patchedSha256: hash(patched), helperSourceSha256: hash(helperSource),
      dependencyRoot: dependencies, nodePty: '1.2.0-beta.12', addon: '7.1.1',
      headers: { path: headers, version: '22.23.2', ...tree(path.join(inputs, 'node-headers')) },
      addonTree: tree(path.join(inputs, 'node-addon-api')),
      tools: buildTools.map(name => ({ name, sha256: hash(fs.readFileSync(path.join(inputs, name))) })) },
    load: { path: binary, loaded: [binary], exports: exported.sort(),
      types: Object.fromEntries(exported.map(name => [name, 'function'])), nativeCalls: 0 } };
  save(path.join(directory, 'inputs.json'), build.sources);
  for (const name of ['build-command.json', 'helper-build-command.json', 'load-command.json'])
    save(path.join(directory, name), { status: 0, signal: null, error: null,
      stdout: name === 'load-command.json' ? JSON.stringify(build.load) : '', synthetic: true });
  save(path.join(directory, 'build.json'), build); seal(directory);
  return { directory, binary, build };
}

function environment(t, mutate = () => {}, mutateEvidence = () => {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsc-u16-synthetic-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const built = syntheticBuild(root), output = path.join(root, 'evidence'), calls = [];
  let token = 0;
  const deps = { platform: 'darwin', version: 'v22.23.2', arch: 'arm64', kernel: 'synthetic',
    versions: { node: '22.23.2' }, execPath: process.execPath, cwd: sourceDirectory, env: {}, log() {},
    randomBytes: () => Buffer.alloc(16, ++token),
    observe: async config => {
      for (const entry of fixedEntries) assert(fs.existsSync(path.join(output, `U1-6-${entry.attempt}`, 'config.json')));
      calls.push(config.attempt);
      const input = createU16Fixture(); mutate(input, config.attempt); refreshU16Snapshots(input);
      const observation = JSON.parse(JSON.stringify(input.observation).replaceAll(U16_TOKEN, config.token));
      const report = observation.messages[0].value.result.report;
      Object.assign(report.loaded, { path: config.binary, hash: config.binaryHash,
        helper: config.helper, helperHash: config.helperHash, executablePath: config.executablePath });
      return observation;
    },
    persist: async (file, observation) => {
      const bytes = JSON.stringify(observation, null, 2) + '\n';
      fs.writeFileSync(file, bytes, { flag: 'wx' });
      const evidence = { error: null, receipt: { ms: 1, value: { hash: hash(bytes), bytes: Buffer.byteLength(bytes) } },
        close: { code: 0, signal: null, ms: 2 } };
      mutateEvidence(evidence); return evidence;
    } };
  return { root, output, ...built, calls, deps, values: { output, binary: built.binary } };
}

test('fixed U1-6 schedule writes all configs before execution and verifies saved synthetic evidence', async t => {
  const env = environment(t);
  const result = await runSchedule(env.values, env.deps);
  assert.equal(result.pass, true); assert.equal(result.executed, 3); assert.equal(result.passed, 3);
  assert.deepEqual(env.calls, [1, 2, 3]);
  assert.deepEqual(read(path.join(env.output, 'schedule.json')).entries.map(({ scenario, attempt }) => ({ scenario, attempt })), fixedEntries);
  await assert.rejects(runSchedule(env.values, env.deps), /must be new/);
  assert.deepEqual(env.calls, [1, 2, 3]);
  const movedBuild = path.join(env.root, 'downloaded-build'); fs.renameSync(env.directory, movedBuild);
  const movedEvidence = path.join(env.root, 'downloaded-evidence'); fs.renameSync(env.output, movedEvidence);
  assert.equal((await verifySaved(movedEvidence, { buildDirectory: movedBuild })).pass, true);
  const offline = spawnSync(process.execPath, [path.join(sourceDirectory, 'diagnose-macos-native-failure-v1.mjs'),
    '--verify-saved', movedEvidence, '--build-directory', movedBuild],
  { encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024 });
  assert.equal(offline.error, undefined); assert.equal(offline.status, 0, offline.stderr);
  assert.equal(JSON.parse(offline.stdout).pass, true);
});

test('scenario mismatch does not hide failure or falsely stop safe later samples', async t => {
  const env = environment(t, (input, attempt) => {
    if (attempt !== 1) return;
    Object.assign(input.native, { waitStatus: 1792, exitCode: 7 });
    input.native.events.find(e => e.name === 'wait-return').aux = 1792;
    input.report.callback.exitCode = 7;
    input.report.events.find(e => e.name === 'exit-callback').exitCode = 7;
  });
  const result = await runSchedule(env.values, env.deps);
  assert.equal(result.pass, false); assert.equal(result.executed, 3); assert.equal(result.passed, 2);
  assert.equal(result.results[0].scenarioMatches, false); assert.equal(result.results[0].safeToContinue, true);
  assert.deepEqual(env.calls, [1, 2, 3]);
});

test('unsettled resources stop admission and not-run cannot conceal actual execution or changed identity', async t => {
  const env = environment(t, input => { input.native.waitConfirmed = false; });
  const result = await runSchedule(env.values, env.deps);
  assert.equal(result.pass, false); assert.equal(result.executed, 1); assert.deepEqual(env.calls, [1]);
  assert.deepEqual(result.results.map(r => r.status), ['executed', 'not-run', 'not-run']);
  const skipped = path.join(env.output, 'U1-6-2'), file = path.join(skipped, 'config.json'), config = read(file);
  save(file, { ...config, token: 'f'.repeat(32) });
  await assert.rejects(verifySaved(env.output)); save(file, config);
  fs.copyFileSync(path.join(env.output, 'U1-6-1/raw.json'), path.join(skipped, 'raw.json'));
  await assert.rejects(verifySaved(env.output), /not-run|execution|unsafe/);
});

test('writer evidence failure freezes stop-admission and preserves the failed summary', async t => {
  const env = environment(t, () => {}, evidence => { evidence.receipt.value.hash = '0'.repeat(64); });
  await assert.rejects(runSchedule(env.values, env.deps));
  assert.deepEqual(env.calls, [1]);
  const summary = read(path.join(env.output, 'summary.json'));
  assert.equal(summary[0].evidenceSufficient, false);
  assert.deepEqual(summary.map(r => r.status), ['executed', 'not-run', 'not-run']);
});

test('saved verification recomputes raw facts and rejects source substitution instead of trusting pass', async t => {
  const env = environment(t); await runSchedule(env.values, env.deps);
  const base = path.join(env.output, 'U1-6-1'), rawFile = path.join(base, 'raw.json'), original = fs.readFileSync(rawFile);
  const raw = JSON.parse(original), report = raw.messages[0].value.result.report;
  report.native.events.find(e => e.name === 'wait-return').aux = 127;
  save(rawFile, raw);
  const receiptFile = path.join(base, 'evidence.json'), evidence = read(receiptFile), originalEvidence = structuredClone(evidence);
  evidence.receipt.value = { hash: hash(fs.readFileSync(rawFile)), bytes: fs.statSync(rawFile).size }; save(receiptFile, evidence);
  await assert.rejects(verifySaved(env.output), /unsafe continued admission/);
  fs.writeFileSync(rawFile, original); save(receiptFile, originalEvidence);
  const scheduleFile = path.join(env.output, 'schedule.json'), schedule = read(scheduleFile);
  const source = schedule.sources.find(s => s.snapshot === 'macos-native-failure-roles-v1.mjs');
  const bytes = 'throw new Error("archive code must never execute");\n';
  fs.writeFileSync(path.join(env.output, source.snapshot), bytes); source.hash = hash(bytes); save(scheduleFile, schedule);
  await assert.rejects(verifySaved(env.output), /source|identity|trusted/);
});

test('platform and wrong candidate provenance are rejected before any observation', async t => {
  const env = environment(t);
  await assert.rejects(runSchedule(env.values, { ...env.deps, platform: 'linux' }));
  assert.equal(fs.existsSync(env.output), false); assert.deepEqual(env.calls, []);
  const file = path.join(env.directory, 'build.json'), record = read(file);
  record.kind = 'macos-native-baseline-v1-build'; save(file, record); seal(env.directory);
  await assert.rejects(runSchedule(env.values, env.deps));
  assert.equal(fs.existsSync(env.output), false); assert.deepEqual(env.calls, []);
});
