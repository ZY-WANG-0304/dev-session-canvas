import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import JSZip from 'jszip';
import { assertInstalledCandidateSelection, installedCandidateFiles, installedCandidateInstallCommand,
  prepareInstalledCandidateDriver, prepareInstalledVsixInput } from '../smoke/installed-execution-candidate.mjs';
import receipts from '../../tests/vscode-smoke/installed-execution-candidate.cjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsc-installed-candidate-'));
let checks = 0;
try {
  const selected = { 'installed-vsix': '/fixed/candidate.vsix' };
  assertInstalledCandidateSelection(selected, 'linux', 'x64');
  for (const addition of [{ 'capacity-calibration': true }, { 'capacity-reconnect': true },
    { 'capacity-sessions': '2' }, { mode: 'live-runtime' }]) {
    assert.throws(() => assertInstalledCandidateSelection({ ...selected, ...addition }, 'linux', 'x64'));
  }
  assert.throws(() => assertInstalledCandidateSelection(selected, 'win32', 'x64'));
  assert.throws(() => assertInstalledCandidateSelection(selected, 'linux', 'arm64'));
  assert.throws(() => assertInstalledCandidateSelection({ 'installed-vsix': ' ' }, 'linux', 'x64'));
  checks += 1;

  const packageManifest = { publisher: 'devsessioncanvas', name: 'dev-session-canvas', version: '0.25.0',
    main: './dist/extension.js', displayName: '%extension.displayName%',
    extensionPack: ['devsessioncanvas.dev-session-canvas-notifier'] };
  const binary = Buffer.from('controlled native payload, not an executable');
  const manifest = { profile: 'linux-owner-v1-candidate', platform: 'linux', arch: 'x64',
    runtime: { name: 'electron', version: '39.8.7', node: '22.22.1', modules: '140' },
    binary: { file: 'execution-owner.node', sha256: hash(binary) } };
  const payload = Object.fromEntries(installedCandidateFiles.map(file => [file, Buffer.from(`fixed:${file}`)]));
  payload['dist/native/linux-execution-candidate/linux-x64-glibc/manifest.json'] = Buffer.from(JSON.stringify(manifest));
  payload['dist/native/linux-execution-candidate/linux-x64-glibc/execution-owner.node'] = binary;
  payload['dist/execution-candidate-selection.json'] = Buffer.from(JSON.stringify({ schemaVersion: 1, profile: manifest.profile }));
  const zip = new JSZip();
  zip.file('extension/package.json', JSON.stringify(packageManifest));
  for (const [file, bytes] of Object.entries(payload)) zip.file(`extension/${file}`, bytes);
  const vsixBytes = await zip.generateAsync({ type: 'nodebuffer' });
  const sourcePath = path.join(root, 'specified.vsix');
  await fs.writeFile(sourcePath, vsixBytes);
  const output = path.join(root, 'evidence');
  await fs.mkdir(output);
  const input = await prepareInstalledVsixInput(sourcePath, output);
  assert.equal(input.vsixSha256, hash(vsixBytes));
  assert.deepEqual(input.packageManifest, packageManifest);
  assert.deepEqual(input.manifest, manifest);
  assert.deepEqual(input.payloadHashes, Object.fromEntries(Object.entries(payload).map(([file, bytes]) => [file, hash(bytes)])));
  await fs.writeFile(sourcePath, 'later source replacement');
  assert.deepEqual(await fs.readFile(input.vsixPath), vsixBytes, 'Installation uses the inspected frozen bytes.');
  checks += 1;

  const extensionsDir = path.join(root, 'extensions');
  const installedPath = path.join(extensionsDir, 'devsessioncanvas.dev-session-canvas-0.25.0');
  await fs.mkdir(installedPath, { recursive: true });
  const installedManifest = { ...packageManifest, __metadata: { installedTimestamp: 1234 } };
  const packagePath = path.join(installedPath, 'package.json');
  await fs.writeFile(packagePath, JSON.stringify(installedManifest));
  for (const [file, bytes] of Object.entries(payload)) {
    await fs.mkdir(path.dirname(path.join(installedPath, file)), { recursive: true });
    await fs.writeFile(path.join(installedPath, file), bytes);
  }
  const projectRoot = path.join(root, 'project');
  await fs.mkdir(path.join(projectRoot, 'tests/vscode-smoke'), { recursive: true });
  await fs.writeFile(path.join(projectRoot, 'tests/vscode-smoke/controlled.cjs'), 'exports.run = async () => {};\n');
  const driverRoot = path.join(root, 'test-driver');
  const driver = await prepareInstalledCandidateDriver({ projectRoot, targetRoot: driverRoot, input,
    extensionsDir, artifactsDir: output });
  const driverManifest = JSON.parse(await fs.readFile(path.join(driverRoot, 'package.json'), 'utf8'));
  assert.notEqual(`${driverManifest.publisher}.${driverManifest.name}`, 'devsessioncanvas.dev-session-canvas');
  assert.deepEqual((await fs.readdir(driverRoot)).sort(), ['driver.cjs', 'package.json', 'tests']);
  assert.doesNotMatch(await fs.readFile(path.join(driverRoot, 'driver.cjs'), 'utf8'), /require|context|dist/);
  checks += 1;

  const extension = { id: 'devsessioncanvas.dev-session-canvas', isActive: true,
    extensionPath: installedPath, packageJSON: { ...installedManifest, displayName: 'Localized product name' } };
  const runtime = { platform: 'linux', arch: 'x64',
    versions: { electron: '39.8.7', node: '22.22.1', modules: '140' } };
  const receipt = await receipts.captureInstalledExtensionReceipt(extension, driver.expectationPath, runtime);
  receipts.assertInstalledExtensionReceipt(receipt, driver.expectation);
  assert.equal(receipt.extensionPath, await fs.realpath(installedPath));
  assert.equal(receipt.main, './dist/extension.js');
  assert.deepEqual(receipt.productManifest.extensionPack, packageManifest.extensionPack);
  assert.throws(() => receipts.assertInstalledExtensionReceipt(undefined, driver.expectation));
  assert.throws(() => receipts.assertInstalledExtensionReceipt({ ...receipt, vsixSha256: 'wrong' }, driver.expectation));
  assert.throws(() => receipts.assertInstalledExtensionReceipt({ ...receipt, payloadHashes: {} }, driver.expectation));
  await assert.rejects(receipts.captureInstalledExtensionReceipt({ ...extension, extensionPath: driverRoot },
    driver.expectationPath, runtime), /must be inside/);
  await assert.rejects(receipts.captureInstalledExtensionReceipt(extension, driver.expectationPath,
    { ...runtime, versions: { ...runtime.versions, modules: '999' } }), /matching modules/);
  checks += 1;

  await fs.writeFile(path.join(installedPath, 'dist/extension.js'), 'wrong installed bytes');
  await assert.rejects(receipts.captureInstalledExtensionReceipt(extension, driver.expectationPath, runtime));
  await fs.writeFile(path.join(installedPath, 'dist/extension.js'), payload['dist/extension.js']);
  const changedManifest = { ...installedManifest, main: './wrapper.cjs' };
  await fs.writeFile(packagePath, JSON.stringify(changedManifest));
  await assert.rejects(receipts.captureInstalledExtensionReceipt({ ...extension, packageJSON: changedManifest },
    driver.expectationPath, runtime));
  await fs.writeFile(packagePath, JSON.stringify(installedManifest));
  const outside = path.join(root, 'outside-webview.js');
  await fs.writeFile(outside, payload['dist/webview.js']);
  await fs.unlink(path.join(installedPath, 'dist/webview.js'));
  await fs.symlink(outside, path.join(installedPath, 'dist/webview.js'));
  await assert.rejects(receipts.captureInstalledExtensionReceipt(extension, driver.expectationPath, runtime), /must be inside/);
  checks += 1;

  const install = installedCandidateInstallCommand({ vscodeExecutablePath: '/fixed/VSCode/code', input,
    runtime: { userDataDir: '/isolated/user-data', extensionsDir, environment: { HOME: '/isolated/home' } } });
  assert.equal(install.file, '/fixed/VSCode/bin/code');
  assert.deepEqual(install.args, ['--user-data-dir=/isolated/user-data', `--extensions-dir=${extensionsDir}`,
    '--install-extension', input.vsixPath, '--force', '--do-not-include-pack-dependencies']);
  assert.equal(install.options.shell, false);
  assert.equal(install.options.env.HOME, '/isolated/home');
  assert(!install.args.some(argument => argument.includes('extensionDevelopmentPath')));
  checks += 1;

  const source = await fs.readFile('scripts/smoke/run-vscode-execution-candidate.mjs', 'utf8');
  const loop = source.slice(source.indexOf('for (const [index, mode] of modes.entries()) {'),
    source.indexOf('async function runCapacityCalibration() {'));
  for (const invalidReceipt of [undefined, 'missing', 'hash-mismatch']) {
    const reports = new Map(), launches = [], installs = [];
    const execute = () => vm.runInNewContext(`(async () => { ${loop} })()`, {
      assert, path, JSON, installedReceipts: receipts, installedInput: input,
      modes: ['live-runtime', 'snapshot-only'], output: '/fixed-output', projectRoot: '/fixed-project', runId: 'fixed',
      vscodeExecutablePath: '/fixed/Code', process: { platform: 'linux', execPath: '/fixed-node', env: {} },
      fs: { async mkdir() {}, async writeFile(file, contents) { reports.set(file, contents); },
        async readFile(file) { assert(reports.has(file), `Missing report ${file}`); return reports.get(file); } },
      async prepareRuntime({ debugRoot }) { return { artifactsDir: `${debugRoot}/artifacts`, extensionsDir }; },
      async prepareMainSmokeHostExtension() { assert.fail('Installed validation must not stage the business development extension.'); },
      async installCandidateVsix(options) { assert.equal(options.input, input); installs.push(options.runtime); },
      async prepareInstalledCandidateDriver({ targetRoot }) {
        assert(targetRoot.endsWith('/test-driver'));
        return driver;
      },
      resolveStagedSmokeTestPath: (targetRoot, file) => path.join(targetRoot, file),
      async launchPreparedVSCodeScenario(options) {
        const env = options.extensionTestsEnv;
        const mode = env.DEV_SESSION_CANVAS_CANDIDATE_MODE, phase = env.DEV_SESSION_CANVAS_CANDIDATE_PHASE;
        launches.push(`${mode}/${phase}`);
        assert(options.extensionDevelopmentPath.endsWith('/test-driver'));
        assert.equal(options.disableExtensions, false);
        assert.equal(env.DEV_SESSION_CANVAS_SMOKE_TEST_MODE, '1');
        assert.equal(env.DEV_SESSION_CANVAS_INSTALLED_VSIX_EXPECTATION, driver.expectationPath);
        const actualReceipt = invalidReceipt === 'missing' ? undefined
          : { ...receipt, ...(invalidReceipt === 'hash-mismatch' ? { payloadHashes: {} } : {}) };
        const write = (file, value) => reports.set(path.join(options.runtime.artifactsDir, file), JSON.stringify(value));
        write(`${phase}-environment.json`, { mode, phase, installedVsix: actualReceipt });
        write(phase === 'complete' ? 'completed.json' : 'reopened.json', { mode, id: `${mode}-node`, pass: true });
        if (phase === 'reopen') write('cleanup.json', { runtime: { bindings: [] }, pass: true });
      },
      console: { log() {} }
    });
    if (invalidReceipt) {
      await assert.rejects(execute());
      assert.deepEqual(launches, ['live-runtime/complete'], 'Invalid installed evidence must stop before reopening.');
      assert.equal(installs.length, 1);
      assert(reports.has('/fixed-output/first-failure.json'));
    } else {
      await execute();
      assert.deepEqual(launches, ['live-runtime/complete', 'live-runtime/reopen', 'snapshot-only/complete', 'snapshot-only/reopen']);
      assert.equal(installs.length, 2, 'Each mode installs the fixed VSIX into its own runtime.');
    }
  }
  checks += 1;

  console.log(`Installed candidate package, driver, path/hash receipts and CLI selection: ${checks} checks passed (no native execution).`);
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
