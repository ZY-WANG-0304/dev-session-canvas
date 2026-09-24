import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { budgets } from './diagnose-native-failure-v1.mjs';
import { patchMacosSource, UNIX_SOURCE_SHA256 } from './macos-native-failure-patch-v1.mjs';
import { assessCase } from './macos-native-failure-verifier-v1.mjs';

export const buildTools = Object.freeze(['build-macos-native-failure-v1.mjs',
  'macos-native-failure-patch-v1.mjs', 'macos-native-failure-support-v1.h']);
export const sourceNames = Object.freeze([
  'macos-native-failure-fixture-v1.mjs', 'macos-native-failure-verifier-v1.mjs',
  'macos-native-failure-v1.test.mjs', 'macos-native-failure-support-v1.h',
  'macos-native-failure-patch-v1.mjs', 'macos-native-failure-patch-v1.test.mjs',
  'macos-native-failure-roles-v1.mjs', 'macos-native-failure-fixture-process-v1.mjs',
  'macos-native-failure-roles-v1.test.mjs', 'build-macos-native-failure-v1.mjs',
  'diagnose-macos-native-failure-v1.mjs', 'macos-native-failure-saved-v1.mjs',
  'macos-native-failure-build-v1.test.mjs', 'macos-native-failure-schedule-v1.test.mjs',
  'diagnose-native-failure-v1.mjs', 'native-failure-verifier-v1.mjs'
]);
export const fixedEntries = Object.freeze([1, 2, 3].map(attempt => Object.freeze({ scenario: 'U1-6', attempt })));
export const expected = Object.freeze({ permissionSent: false, written: 0, readCalls: 0,
  parserAccepted: 0, parserCompleted: 0, state: null, rawBase64: '' });

const helperSourceHash = '22195de1710b574d5904fc89be5624c25e531de20d5e17e5998a2fd19d86e0e6';
const headerTreeHash = '85e104c89fdba601b92c2c03dfb50291561226716ab6555bf8be2a59a13e11a6';
const nativeExports = ['fork', 'open', 'resize', 'process', 'failureConfigure', 'failureSnapshot', 'failureCloseMaster'].sort();
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const trustedPath = name => fileURLToPath(new URL(name, import.meta.url));
const equal = (a, b) => { try { assert.deepEqual(a, b); return true; } catch { return false; } };
const digestPattern = /^[a-f0-9]{64}$/;
const absolute = (value, label) => assert(typeof value === 'string' && path.posix.isAbsolute(value), label);

function checkMembers(files, label) {
  assert(Array.isArray(files) && files.length > 0, `${label}: member list`);
  assert.equal(new Set(files.map(item => item.file)).size, files.length, `${label}: duplicate member`);
  for (const item of files) {
    assert(typeof item.file === 'string' && item.file.length > 0 && !path.posix.isAbsolute(item.file) &&
      !item.file.includes('\\') && !item.file.split('/').some(part => ['', '.', '..'].includes(part)), `${label}: member path`);
    assert(digestPattern.test(item.sha256), `${label}: member digest`);
  }
}

export function verifyBuild(buildDirectory) {
  const root = path.resolve(buildDirectory);
  const manifestBytes = fs.readFileSync(path.join(root, 'manifest.json'));
  const manifest = JSON.parse(manifestBytes);
  checkMembers(manifest.files, 'build manifest');
  assert.equal(hash(JSON.stringify(manifest.files)), manifest.sha256, 'build member list changed');
  const members = new Map(manifest.files.map(item => [item.file, item.sha256]));
  for (const member of manifest.files)
    assert.equal(hash(fs.readFileSync(path.join(root, member.file))), member.sha256, `build member: ${member.file}`);
  const member = (file, digest) => {
    assert(members.has(file), `required build member: ${file}`);
    if (digest !== undefined) assert.equal(members.get(file), digest, `build member identity: ${file}`);
  };
  member('build.json');
  const build = read(path.join(root, 'build.json'));
  assert.equal(build.kind, 'macos-native-failure-v1-build');
  assert.equal(build.status, 'built-and-load-verified');
  assert.equal(build.nativeExecutions, 0);
  assert.equal(build.platform, 'darwin');
  assert(['arm64', 'x64'].includes(build.arch));
  assert.equal(build.versions?.node, '22.23.2');
  assert(typeof build.kernel === 'string' && build.kernel.length > 0, 'Darwin kernel identity');
  absolute(build.executable?.path, 'build executable path');
  assert(digestPattern.test(build.executable?.sha256), 'build executable digest');
  absolute(build.binary?.path, 'built binary path'); absolute(build.helper?.path, 'built helper path');
  assert(digestPattern.test(build.binary?.sha256) && digestPattern.test(build.helper?.sha256), 'built artifact digests');
  assert.equal(path.posix.basename(build.binary.path), 'pty.node');
  assert.equal(build.helper.path, path.posix.join(path.posix.dirname(build.binary.path), 'spawn-helper'));
  member('pty.node', build.binary.sha256); member('spawn-helper', build.helper.sha256);
  assert(Number.isInteger(build.helper.mode) && (build.helper.mode & 0o111) !== 0, 'built helper executable mode');
  assert.equal(build.load?.nativeCalls, 0);
  assert.equal(build.load?.path, build.binary.path);
  assert.deepEqual(build.load?.loaded, [build.binary.path], 'only the explicit candidate was loaded');
  assert.deepEqual(build.load?.exports, nativeExports, 'fixed candidate exports');
  assert.deepEqual(Object.keys(build.load?.types ?? {}).sort(), nativeExports);
  for (const name of nativeExports) assert.equal(build.load.types[name], 'function', `native export type: ${name}`);
  for (const file of ['build-command.json', 'helper-build-command.json', 'load-command.json']) {
    member(file);
    const command = read(path.join(root, file));
    assert.equal(command.status, 0, `successful ${file}`);
    assert.equal(command.signal, null, `unsignaled ${file}`);
    assert.equal(command.error, null, `error-free ${file}`);
    if (file === 'load-command.json') assert.deepEqual(JSON.parse(command.stdout), build.load, 'saved load result');
  }
  member('inputs.json');
  assert.deepEqual(read(path.join(root, 'inputs.json')), build.sources, 'source record matches build');
  const sources = build.sources;
  assert.equal(sources?.nodePty, '1.2.0-beta.12'); assert.equal(sources?.addon, '7.1.1');
  member('inputs/node-pty-package.json'); member('inputs/node-addon-api/package.json');
  assert.equal(read(path.join(root, 'inputs/node-pty-package.json')).version, sources.nodePty);
  assert.equal(read(path.join(root, 'inputs/node-addon-api/package.json')).version, sources.addon);
  assert.equal(sources.originalSha256, UNIX_SOURCE_SHA256);
  assert.equal(sources.helperSourceSha256, helperSourceHash);
  member('inputs/pty-before.cc', UNIX_SOURCE_SHA256); member('inputs/spawn-helper.cc', helperSourceHash);
  const original = fs.readFileSync(path.join(root, 'inputs/pty-before.cc'), 'utf8');
  const patched = patchMacosSource(original);
  assert.equal(sources.patchedSha256, hash(patched), 'trusted transform matches generated input');
  member('inputs/pty-after.cc', sources.patchedSha256);
  assert.deepEqual(sources.tools.map(item => item.name).sort(), [...buildTools].sort());
  for (const name of buildTools) {
    const tool = sources.tools.find(item => item.name === name);
    assert.equal(hash(fs.readFileSync(trustedPath(name))), tool.sha256, `trusted build source: ${name}`);
    member(`inputs/${name}`, tool.sha256);
  }
  assert.equal(sources.headers?.version, '22.23.2');
  assert.equal(sources.headers?.sha256, headerTreeHash, 'fixed official headers');
  for (const [prefix, tree] of [['node-headers', sources.headers], ['node-addon-api', sources.addonTree]]) {
    checkMembers(tree?.files, `${prefix} tree`);
    assert.equal(hash(JSON.stringify(tree.files)), tree.sha256, `${prefix} member list`);
    assert.deepEqual(manifest.files.filter(item => item.file.startsWith(`inputs/${prefix}/`))
      .map(item => ({ file: item.file.slice(`inputs/${prefix}/`.length), sha256: item.sha256 })), tree.files,
    `${prefix} members match sealed inputs`);
  }
  return { build, manifest, buildManifestHash: hash(manifestBytes) };
}

export async function verifySaved(directory, { buildDirectory } = {}) {
  const root = path.resolve(directory), failures = [], results = [];
  const schedule = read(path.join(root, 'schedule.json'));
  assert.equal(schedule.schema, 'macos-native-failure-v1'); assert.equal(schedule.platform, 'darwin');
  assert(['arm64', 'x64'].includes(schedule.arch)); assert.equal(schedule.versions?.node, '22.23.2');
  assert.deepEqual(schedule.budgets, budgets);
  for (const name of ['buildDirectory', 'binary', 'helper', 'executablePath', 'cwd']) absolute(schedule[name], `scheduled ${name}`);
  assert.equal(schedule.binary, path.posix.join(schedule.buildDirectory, 'pty.node'));
  assert.equal(schedule.helper, path.posix.join(schedule.buildDirectory, 'spawn-helper'));
  const { build, buildManifestHash } = verifyBuild(buildDirectory ?? schedule.buildDirectory);
  assert.equal(buildManifestHash, schedule.buildManifestHash, 'scheduled build manifest identity');
  assert.equal(build.binary.path, schedule.binary); assert.equal(build.binary.sha256, schedule.binaryHash);
  assert.equal(build.helper.path, schedule.helper); assert.equal(build.helper.sha256, schedule.helperHash);
  assert.equal(build.executable.path, schedule.executablePath);
  for (const field of ['platform', 'arch', 'kernel', 'versions'])
    assert.deepEqual(schedule[field], build[field], `scheduled build environment: ${field}`);
  assert.equal(new Set(schedule.sources.map(source => source.source)).size, schedule.sources.length);
  assert.equal(new Set(schedule.sources.map(source => source.snapshot)).size, schedule.sources.length);
  assert.deepEqual(schedule.sources.map(source => source.snapshot).sort(), [...sourceNames].sort());
  for (const source of schedule.sources) {
    absolute(source.source, 'original source identity');
    assert.equal(path.posix.basename(source.source), source.snapshot, 'source basename binds snapshot');
    assert(digestPattern.test(source.hash), 'saved source digest');
    assert.equal(hash(fs.readFileSync(path.join(root, source.snapshot))), source.hash, `saved source: ${source.snapshot}`);
    assert.equal(hash(fs.readFileSync(trustedPath(source.snapshot))), source.hash, `trusted source: ${source.snapshot}`);
    if (buildTools.includes(source.snapshot))
      assert.equal(source.hash, build.sources.tools.find(item => item.name === source.snapshot).sha256,
        `scheduled source matches built input: ${source.snapshot}`);
  }
  assert.deepEqual(schedule.entries.map(({ scenario, attempt }) => ({ scenario, attempt })), fixedEntries);
  for (const entry of schedule.entries) {
    assert.match(entry.token, /^[a-f0-9]{32}$/);
    assert.deepEqual(Object.keys(entry).sort(), ['attempt', 'scenario', 'token']);
  }
  assert.equal(new Set(schedule.entries.map(entry => entry.token)).size, fixedEntries.length);
  const summary = read(path.join(root, 'summary.json'));
  assert.equal(summary.length, fixedEntries.length);
  let admitted = true, originalEvidenceDirectory;
  for (const [index, entry] of schedule.entries.entries()) {
    const caseName = `${entry.scenario}-${entry.attempt}`, base = path.join(root, caseName);
    const config = read(path.join(base, 'config.json'));
    for (const key of ['token', 'scenario', 'attempt']) assert.equal(config[key], entry[key], `case entry: ${key}`);
    for (const key of ['platform', 'executablePath', 'binary', 'binaryHash', 'helper',
      'helperHash', 'buildDirectory', 'buildManifestHash', 'cwd'])
      assert.deepEqual(config[key], schedule[key], `case identity: ${key}`);
    assert.equal(config.fixtureScenario, 'U1-6'); assert.deepEqual(config.expected, expected);
    absolute(config.configPath, 'original config path');
    originalEvidenceDirectory ??= path.posix.dirname(path.posix.dirname(config.configPath));
    assert.equal(config.configPath, path.posix.join(originalEvidenceDirectory, caseName, 'config.json'));
    if (!admitted) {
      const skipped = summary[index];
      assert.equal(skipped?.status, 'not-run', `unsafe continued admission: ${caseName}`);
      assert(typeof skipped.reason === 'string' && skipped.reason.length > 0, 'not-run reason');
      assert(!fs.existsSync(path.join(base, 'raw.json')) && !fs.existsSync(path.join(base, 'evidence.json')),
        `not-run case has execution evidence: ${caseName}`);
      const result = { ...entry, status: 'not-run', reason: skipped.reason };
      assert.deepEqual(skipped, result); results.push(result); continue;
    }
    const raw = fs.readFileSync(path.join(base, 'raw.json'));
    const evidence = read(path.join(base, 'evidence.json'));
    assert.equal(raw.length, evidence.receipt?.value.bytes, `raw bytes: ${caseName}`);
    assert.equal(hash(raw), evidence.receipt?.value.hash, `raw hash: ${caseName}`);
    const observation = JSON.parse(raw);
    const report = observation.messages?.find(item => item.value?.type === 'after-await')?.value?.result?.report;
    if (report) for (const [loaded, configured] of [['helper', 'helper'], ['helperHash', 'helperHash'],
      ['executablePath', 'executablePath']]) assert.equal(report.loaded?.[loaded], config[configured], `loaded ${loaded}`);
    const assessed = assessCase(config, observation, evidence);
    const result = { ...entry, status: 'executed', ...assessed };
    results.push(result);
    if (!equal(result, summary[index])) failures.push(`saved summary mismatch: ${caseName}`);
    if (!assessed.pass) failures.push(...assessed.failures.map(({ domain, reason }) => `${caseName} [${domain}]: ${reason}`));
    admitted = assessed.safeToContinue;
  }
  return { pass: failures.length === 0 && results.length === fixedEntries.length && results.every(result => result.pass),
    executed: results.filter(result => result.status === 'executed').length,
    passed: results.filter(result => result.pass).length, failures, results };
}
