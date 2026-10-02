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
import { assembleExecutionDistributionAssets } from '../build/assemble-execution-distribution-assets.mjs';
import { writeExecutionAssetSet } from './fixtures/execution-candidate-assets-set.mjs';

const require = createRequire(import.meta.url);
const { checkNativeLoad } = require('../build/check-execution-native-load.cjs');
const workflow = yaml.load(fs.readFileSync('.github/workflows/runtime-execution-assets.yml', 'utf8'));
assert.deepEqual(workflow.on, { workflow_call: { inputs: { input_ref: {
  description: 'Immutable source commit for all six native assets', required: true, type: 'string'
} } }, workflow_dispatch: { inputs: { windows_only: {
  description: 'Build only Windows x64 and ARM64 assets', type: 'boolean', required: false, default: false
} } } });
assert.deepEqual(workflow.permissions, { contents: 'read' });
assert.equal(workflow.env, undefined);
assert.deepEqual(Object.keys(workflow.jobs), ['native-assets']);
const job = workflow.jobs['native-assets'];
assert.equal(job.environment, undefined);
assert.equal(job.strategy['fail-fast'], false);
assert.deepEqual(Object.keys(job.strategy.matrix).sort(), ['asset', 'exclude']);
assert.deepEqual(job.strategy.matrix.asset, distributionTargets.map(({ name, runner, arch, compilerArch }) =>
  ({ target: name, runner, arch, ...(compilerArch ? { compilerArch } : {}) })));
const exclusion = /^\$\{\{ inputs\.windows_only && fromJSON\('([^']+)'\) \|\| fromJSON\('\[\]'\) \}\}$/.exec(job.strategy.matrix.exclude);
assert(exclusion, 'The only matrix selection is the fixed windows_only boolean.');
const excluded = JSON.parse(exclusion[1]);
assert.deepEqual(excluded, job.strategy.matrix.asset.filter(asset => !asset.target.startsWith('win32-')).map(asset => ({ asset })));
for (const windowsOnly of [false, true]) {
  const omitted = windowsOnly ? excluded.map(entry => entry.asset.target) : [];
  assert.deepEqual(job.strategy.matrix.asset.filter(asset => !omitted.includes(asset.target)).map(asset => asset.target),
    windowsOnly ? ['win32-x64', 'win32-arm64'] : distributionTargets.map(target => target.name));
}
assert.equal(job['runs-on'], '${{ matrix.asset.runner }}');
const checkoutIndex = job.steps.findIndex(step => step.uses === 'actions/checkout@v4');
assert(checkoutIndex > 0);
assert.deepEqual(job.steps[checkoutIndex - 1], { name: 'Preserve source bytes on Windows checkout',
  if: "runner.os == 'Windows'", shell: 'pwsh', run: 'git config --global core.autocrlf false' });
assert.equal(job.steps.find(step => step.uses === 'actions/checkout@v4').with['persist-credentials'], false);
assert.equal(job.steps.find(step => step.uses === 'actions/checkout@v4').with.ref, '${{ inputs.input_ref || github.sha }}');
assert.equal(job.env.DEV_SESSION_CANVAS_EXECUTION_INPUT_SHA, '${{ inputs.input_ref || github.sha }}');
assert.deepEqual(job.steps.find(step => step.uses === 'actions/setup-node@v4').with,
  { 'node-version': '25.6.0', architecture: '${{ matrix.asset.arch }}', cache: 'npm' });
assert.deepEqual(job.steps.find(step => step.uses === 'ilammy/msvc-dev-cmd@v1').with,
  { arch: '${{ matrix.asset.compilerArch }}' });
assert.doesNotMatch(JSON.stringify(workflow), /matrix\.(?:target|runner|arch|compilerArch)\b/);
assert.equal(job.steps.find(step => step.uses === 'actions/upload-artifact@v4').with.path, 'execution-asset-artifacts/');
assert.equal(job.steps.find(step => step.uses === 'actions/upload-artifact@v4').with.name,
  'execution-native-${{ matrix.asset.target }}-${{ github.run_id }}');
assert.equal(job.steps.find(step => step.uses === 'actions/upload-artifact@v4').with.overwrite, true);
const evidenceUpload = job.steps.find(step => step.name === 'Preserve available build and load evidence');
assert.equal(evidenceUpload.uses, 'actions/upload-artifact@v4');
assert.equal(evidenceUpload.if, 'always()');
assert.equal(evidenceUpload.with['if-no-files-found'], 'warn');
const assetPath = '${{ runner.temp }}/execution-assets/${{ matrix.asset.target }}';
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

const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dsc-distribution-')));
try {
  const sourceSet = path.join(temporary, 'source-set');
  const targets = writeExecutionAssetSet(sourceSet);
  const archives = path.join(temporary, 'archives');
  fs.mkdirSync(archives);
  const inputCommit = 'a'.repeat(40);
  for (const target of targets) {
    const files = runtimeFiles(target.manifest);
    const archive = path.join(archives, `${target.name}.tar.gz`);
    const packed = spawnSync('tar', ['--create', '--gzip', '--file', archive, '--directory', sourceSet,
      ...files.map(file => `${target.name}/${file}`)], { encoding: 'utf8' });
    assert.equal(packed.status, 0, packed.stderr);
    fs.writeFileSync(path.join(archives, `${target.name}-summary.json`), JSON.stringify({
      schemaVersion: 1, inputCommit, target: target.name, files,
      archiveSha256: createHash('sha256').update(fs.readFileSync(archive)).digest('hex'),
      nativeLoaded: true, executionApiCalled: false, productValidated: false
    }));
  }
  const output = path.join(temporary, 'assembled');
  assert.equal(assembleExecutionDistributionAssets({ source: archives, output, inputCommit }).assets.length, 6);
  assert.throws(() => assembleExecutionDistributionAssets({ source: archives, output, inputCommit }), /overwrite/);
  const rejected = path.join(temporary, 'rejected');
  assert.throws(() => assembleExecutionDistributionAssets({ source: archives, output: rejected,
    inputCommit: 'b'.repeat(40) }), /provenance/);
  assert.equal(fs.existsSync(rejected), false);
  fs.appendFileSync(path.join(archives, `${targets[5].name}.tar.gz`), 'changed');
  assert.throws(() => assembleExecutionDistributionAssets({ source: archives, output: rejected, inputCommit }), /hash/);
  assert.equal(fs.existsSync(rejected), false, 'Incomplete native sets never become build inputs');
  const first = targets[0];
  fs.writeFileSync(path.join(first.directory, 'unexpected.cc'), 'not a runtime file');
  const firstArchive = path.join(archives, `${first.name}.tar.gz`);
  const repacked = spawnSync('tar', ['--create', '--gzip', '--file', firstArchive, '--directory', sourceSet,
    ...runtimeFiles(first.manifest).map(file => `${first.name}/${file}`), `${first.name}/unexpected.cc`], { encoding: 'utf8' });
  assert.equal(repacked.status, 0, repacked.stderr);
  const firstSummaryPath = path.join(archives, `${first.name}-summary.json`);
  const firstSummary = JSON.parse(fs.readFileSync(firstSummaryPath));
  fs.writeFileSync(firstSummaryPath, JSON.stringify({ ...firstSummary,
    archiveSha256: createHash('sha256').update(fs.readFileSync(firstArchive)).digest('hex') }));
  assert.throws(() => assembleExecutionDistributionAssets({ source: archives, output: rejected, inputCommit }), /Unexpected archive member/);
  assert.equal(fs.existsSync(rejected), false);
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
console.log('Execution distribution contract passed (manual six-target or Windows-only matrix, checkout source bytes, checksums, Linux limits, mock loading and runtime-only archive; no network or native execution).');
