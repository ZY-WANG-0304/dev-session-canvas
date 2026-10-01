import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { assertLinuxDistributionBaseline, checksumFor, distributionTargets, runtimeFiles }
  from '../build/build-execution-distribution-assets.mjs';

const require = createRequire(import.meta.url);
const { checkNativeLoad } = require('../build/check-execution-native-load.cjs');
const workflow = yaml.load(fs.readFileSync('.github/workflows/runtime-execution-assets.yml', 'utf8'));
assert.deepEqual(workflow.on, { workflow_dispatch: null, push: {
  branches: ['runtime-persistence-session-state-refactor'],
  paths: ['.github/workflows/runtime-execution-assets.yml']
} });
assert.deepEqual(workflow.permissions, { contents: 'read' });
assert.equal(workflow.env, undefined);
assert.deepEqual(Object.keys(workflow.jobs), ['native-assets']);
const job = workflow.jobs['native-assets'];
assert.equal(job.environment, undefined);
assert.equal(job.strategy['fail-fast'], false);
assert.deepEqual(job.strategy.matrix.include, distributionTargets.map(({ name, runner, arch, compilerArch }) =>
  ({ target: name, runner, arch, ...(compilerArch ? { compilerArch } : {}) })));
assert.equal(job['runs-on'], '${{ matrix.runner }}');
assert.equal(job.steps.find(step => step.uses === 'actions/checkout@v4').with['persist-credentials'], false);
assert.deepEqual(job.steps.find(step => step.uses === 'actions/setup-node@v4').with,
  { 'node-version': '25.6.0', architecture: '${{ matrix.arch }}', cache: 'npm' });
assert.equal(job.steps.find(step => step.uses === 'actions/upload-artifact@v4').with.path, 'execution-asset-artifacts/');
const evidenceUpload = job.steps.find(step => step.name === 'Preserve available build and load evidence');
assert.equal(evidenceUpload.uses, 'actions/upload-artifact@v4');
assert.equal(evidenceUpload.if, 'always()');
assert.equal(evidenceUpload.with['if-no-files-found'], 'warn');
const assetPath = '${{ runner.temp }}/execution-assets/${{ matrix.target }}';
assert.deepEqual(evidenceUpload.with.path.trim().split('\n'), [
  `${assetPath}/manifest.json`, `${assetPath}/execution-owner.node`, `${assetPath}/spawn-helper`,
  `${assetPath}/conpty.node`, `${assetPath}/conpty/conpty.dll`, `${assetPath}/conpty/OpenConsole.exe`,
  `${assetPath}-inputs-*/minimum-load.json`, `${assetPath}-inputs-*/current-load.json`
]);
assert.doesNotMatch(JSON.stringify(workflow), /secrets\.|pull_request|run-vscode|build\.mjs|package:vsix|publish/);
const builderSource = fs.readFileSync('scripts/build/build-execution-distribution-assets.mjs', 'utf8');
assert.match(builderSource, /674750127bbf45f52660ada71ed1f1491d15e94c16583bff6df0df2489481049/);
assert.match(builderSource, /0c729a67256272265260411226179dd7ca26d933623758928f0914ffd452dbcf/);
assert.match(builderSource, /'--network', 'none'/);
assert.match(builderSource, /electron-v\$\{legacyElectron\}-win32-arm64\.zip/);
assert.match(builderSource, /minimumElectron = legacyElectron/);

const digest = 'a'.repeat(64);
assert.equal(checksumFor(`${digest}  win-arm64/node.lib\r\n`, 'win-arm64/node.lib'), digest);
assert.equal(checksumFor(`${digest.toUpperCase()} *node.tar.gz\n`, 'node.tar.gz'), digest);
assert.throws(() => checksumFor(`${digest}  another-file\n`, 'missing'));
assert.throws(() => checksumFor(`${digest}  file\n${digest}  file\n`, 'file'));
const baseline = { linux: { glibcMinimum: '2.28', glibcxxMinimum: '3.4.22', cxxabiMinimum: '1.3.9' } };
assert.doesNotThrow(() => assertLinuxDistributionBaseline(baseline));
assert.doesNotThrow(() => assertLinuxDistributionBaseline({ linux: { ...baseline.linux, glibcMinimum: '2.9' } }));
for (const [field, value] of Object.entries({ glibcMinimum: '2.34', glibcxxMinimum: '3.4.25', cxxabiMinimum: '1.3.10' })) {
  assert.throws(() => assertLinuxDistributionBaseline({ linux: { ...baseline.linux, [field]: value } }));
}

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'dsc-distribution-'));
try {
  const assets = path.join(temporary, 'darwin-arm64');
  fs.mkdirSync(assets);
  const bytes = Buffer.from('synthetic input; never loaded by require');
  const hash = createHash('sha256').update(bytes).digest('hex');
  const manifest = { schemaVersion: 2, platform: process.platform, arch: process.arch,
    requirements: { napi: 8 }, binary: { file: 'execution-owner.node', sha256: hash },
    helper: { file: 'spawn-helper', sha256: hash }, exports: ['executionClaimNamespace', 'executionConfigure'],
    verification: { compiled: true, nativeLoaded: false, nativeCalls: false, productValidated: false } };
  const saveManifest = value => fs.writeFileSync(path.join(assets, 'manifest.json'), JSON.stringify(value));
  saveManifest(manifest);
  fs.writeFileSync(path.join(assets, manifest.binary.file), bytes);
  fs.writeFileSync(path.join(assets, manifest.helper.file), bytes, { mode: 0o755 });
  fs.mkdirSync(path.join(assets, 'inputs'));
  fs.writeFileSync(path.join(assets, 'inputs', 'compile-only.cc'), 'not a runtime asset');
  assert.deepEqual(runtimeFiles(manifest), ['manifest.json', 'execution-owner.node', 'spawn-helper']);
  const windows = { binary: { file: 'conpty.node' }, dependencies: [{ file: 'conpty/conpty.dll' }, { file: 'conpty/OpenConsole.exe' }] };
  assert.deepEqual(runtimeFiles(windows), ['manifest.json', 'conpty.node', 'conpty/conpty.dll', 'conpty/OpenConsole.exe']);
  let loads = 0;
  const load = filename => {
    assert.equal(filename, path.join(assets, 'execution-owner.node'));
    loads += 1;
    return Object.fromEntries(manifest.exports.map(name => [name, () => assert.fail('No execution API may be called.')]));
  };
  const report = checkNativeLoad(assets, process.versions.node, null, load);
  assert.equal(loads, 1);
  assert.equal(report.executionApiCalled, false);
  assert.equal(report.productValidated, false);
  assert.equal(report.glibcVersionRuntime,
    process.platform === 'linux' ? process.report.getReport().header.glibcVersionRuntime ?? null : null);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(assets, 'manifest.json'))), manifest);
  assert.throws(() => checkNativeLoad(assets, '0.0.0', null, load));
  assert.equal(loads, 1, 'Wrong runtime rejects before native loading.');
  saveManifest({ ...manifest, arch: process.arch === 'x64' ? 'arm64' : 'x64' });
  assert.throws(() => checkNativeLoad(assets, process.versions.node, null, load));
  assert.equal(loads, 1, 'Wrong target rejects before native loading.');
  saveManifest(manifest);
  assert.throws(() => checkNativeLoad(assets, process.versions.node, null, () => ({})));
  fs.appendFileSync(path.join(assets, manifest.binary.file), 'changed');
  assert.throws(() => checkNativeLoad(assets, process.versions.node, null, load));
  assert.equal(loads, 1, 'Changed bytes reject before native loading.');
  fs.writeFileSync(path.join(assets, manifest.binary.file), bytes);
  const archive = path.join(temporary, 'darwin-arm64.tar.gz');
  const pack = spawnSync('tar', ['--create', '--gzip', '--file', archive, '--directory', temporary,
    ...runtimeFiles(manifest).map(file => `darwin-arm64/${file}`)], { encoding: 'utf8' });
  assert.equal(pack.status, 0, pack.stderr);
  const extracted = path.join(temporary, 'extracted');
  fs.mkdirSync(extracted);
  const unpack = spawnSync('tar', ['--extract', '--gzip', '--file', archive, '--directory', extracted], { encoding: 'utf8' });
  assert.equal(unpack.status, 0, unpack.stderr);
  assert.deepEqual(fs.readdirSync(path.join(extracted, 'darwin-arm64')).sort(), runtimeFiles(manifest).sort());
  if (process.platform !== 'win32') assert(fs.statSync(path.join(extracted, 'darwin-arm64/spawn-helper')).mode & 0o111);
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }
console.log('Execution distribution contract passed (six targets, manual/limited-bootstrap triggers, checksums, Linux limits, mock loading and runtime-only archive; no network or native execution).');
