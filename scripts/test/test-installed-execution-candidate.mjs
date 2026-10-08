import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import JSZip from 'jszip';
import { assertInstalledCandidateSelection, installedCandidateFiles, installedCandidateInstallCommand,
  prepareInstalledCandidateDriver, prepareInstalledVsixInput } from '../smoke/installed-execution-candidate.mjs';
import receipts from '../../tests/vscode-smoke/installed-execution-candidate.cjs';
import { writeExecutionAssetSet } from './fixtures/execution-candidate-assets-set.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const require = createRequire(import.meta.url);
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsc-installed-candidate-'));
let checks = 0;
try {
  const selected = { 'installed-vsix': '/fixed/candidate.vsix' };
  for (const platform of ['linux', 'darwin', 'win32']) {
    for (const arch of ['x64', 'arm64']) {
      for (const mode of [undefined, 'live-runtime']) {
        assertInstalledCandidateSelection({ ...selected, mode }, platform, arch);
        for (const addition of [{ 'capacity-calibration': true }, { 'capacity-reconnect': true },
          { 'capacity-attach-compact': true }, { 'capacity-sessions': '2' }]) {
          assert.throws(() => assertInstalledCandidateSelection({ ...selected, mode, ...addition }, platform, arch));
        }
      }
    }
  }
  for (const mode of ['snapshot-only', 'all', '', 'unknown']) {
    assert.throws(() => assertInstalledCandidateSelection({ ...selected, mode }, 'linux', 'x64'));
  }
  assert.throws(() => assertInstalledCandidateSelection(selected, 'freebsd', 'x64'));
  assert.throws(() => assertInstalledCandidateSelection(selected, 'linux', 'ia32'));
  assert.throws(() => assertInstalledCandidateSelection({ 'installed-vsix': ' ' }, 'linux', 'x64'));
  checks += 1;

  const candidateTests = await fs.readFile('tests/vscode-smoke/execution-candidate-tests.cjs', 'utf8');
  const canonicalOwnerAssertion = candidateTests.split('\n').find(line =>
    line.includes('assert.equal(path.relative(await fs.realpath(globalStorage), globalStorage)'));
  assert(canonicalOwnerAssertion, 'Exercise the installed root-owner path assertion.');
  for (const [paths, actual, expected, matches] of [
    [path.win32, 'D:\\User\\globalStorage\\dsc', 'd:\\user\\globalstorage\\dsc', true],
    [path.win32, 'D:\\User\\globalStorage\\other', 'd:\\user\\globalstorage\\dsc', false],
    [path.posix, '/User/globalStorage/dsc', '/User/globalStorage/dsc', true],
    [path.posix, '/User/globalStorage/dsc', '/user/globalstorage/dsc', false]
  ]) {
    const verify = () => vm.runInNewContext(`(async () => { ${canonicalOwnerAssertion} })()`, {
      assert, path: paths, globalStorage: expected, fs: { realpath: async () => actual }
    });
    if (matches) await verify();
    else await assert.rejects(verify());
  }
  checks += 1;

  const packageManifest = { publisher: 'devsessioncanvas', name: 'dev-session-canvas', version: '0.25.0',
    main: './dist/extension.js', displayName: '%extension.displayName%',
    extensionPack: ['devsessioncanvas.dev-session-canvas-notifier'] };
  const binary = Buffer.from('controlled native payload, not an executable');
  const manifest = { schemaVersion: 1, profile: 'linux-owner-v1-candidate', platform: 'linux', arch: 'x64',
    runtime: { name: 'electron', version: '39.8.7', node: '22.22.1', modules: '140' },
    binary: { file: 'execution-owner.node', sha256: hash(binary) } };
  const payload = Object.fromEntries(installedCandidateFiles('linux', 'x64').map(file => [file, Buffer.from(`fixed:${file}`)]));
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
  assert.equal(Object.hasOwn(input, 'runtimeValidation'), false);
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
  assert.equal(Object.hasOwn(receipt, 'nativeAssetValidation'), false);
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

  const nativeManifestPath = 'dist/native/linux-execution-candidate/linux-x64-glibc/manifest.json';
  const nodeManifest = { ...manifest, libc: { name: 'glibc', version: '2.36' },
    runtime: { name: 'node', version: '22.22.1', node: '22.22.1', modules: '127', napi: '10' } };
  const nodePayload = { ...payload, [nativeManifestPath]: Buffer.from(JSON.stringify(nodeManifest)) };
  const nodeZip = new JSZip();
  nodeZip.file('extension/package.json', JSON.stringify(packageManifest));
  for (const [file, bytes] of Object.entries(nodePayload)) nodeZip.file(`extension/${file}`, bytes);
  const nodeSourcePath = path.join(root, 'node.vsix');
  await fs.writeFile(nodeSourcePath, await nodeZip.generateAsync({ type: 'nodebuffer' }));
  const nodeOutput = path.join(root, 'node-evidence');
  await fs.mkdir(nodeOutput);
  await assert.rejects(prepareInstalledVsixInput(nodeSourcePath, nodeOutput), /matching electron asset/);
  await assert.rejects(prepareInstalledVsixInput(input.vsixPath, nodeOutput, { runtimeName: 'node' }), /matching node asset/);
  await assert.rejects(prepareInstalledVsixInput(nodeSourcePath, nodeOutput, { runtimeName: 'other' }), /supported runtime/);
  const invalidNodePath = path.join(root, 'invalid-node.vsix');
  for (const change of [
    { runtime: { ...nodeManifest.runtime, version: '22.0.0' } },
    { runtime: { ...nodeManifest.runtime, node: undefined } },
    { runtime: { ...nodeManifest.runtime, modules: undefined } },
    { runtime: { ...nodeManifest.runtime, napi: undefined } },
    { libc: undefined }, { libc: { name: 'musl', version: '2.36' } }
  ]) {
    nodeZip.file(`extension/${nativeManifestPath}`, JSON.stringify({ ...nodeManifest, ...change }));
    await fs.writeFile(invalidNodePath, await nodeZip.generateAsync({ type: 'nodebuffer' }));
    await assert.rejects(prepareInstalledVsixInput(invalidNodePath, nodeOutput, { runtimeName: 'node' }));
  }
  const nodeInput = await prepareInstalledVsixInput(nodeSourcePath, nodeOutput, { runtimeName: 'node' });
  assert.equal(input.runtimeName, 'electron');
  assert.equal(nodeInput.runtimeName, 'node');
  assert.deepEqual(nodeInput.manifest, nodeManifest);
  assert.equal(nodeInput.vsixSha256, hash(await fs.readFile(nodeSourcePath)));
  checks += 1;

  const nodeExtensionsDir = path.join(root, 'node-extensions');
  const nodeInstalledPath = path.join(nodeExtensionsDir, 'devsessioncanvas.dev-session-canvas-0.25.0');
  await fs.mkdir(nodeInstalledPath, { recursive: true });
  await fs.writeFile(path.join(nodeInstalledPath, 'package.json'), JSON.stringify(installedManifest));
  for (const [file, bytes] of Object.entries(nodePayload)) {
    await fs.mkdir(path.dirname(path.join(nodeInstalledPath, file)), { recursive: true });
    await fs.writeFile(path.join(nodeInstalledPath, file), bytes);
  }
  const nodeExpectationPath = path.join(nodeOutput, 'installed-vsix-expectation.json');
  const nodeExpected = { ...nodeInput, extensionsDir: await fs.realpath(nodeExtensionsDir) };
  await fs.writeFile(nodeExpectationPath, JSON.stringify(nodeExpected));
  const nodeExtension = { ...extension, extensionPath: nodeInstalledPath };
  const nodeRuntime = { platform: 'linux', arch: 'x64', versions: { node: '22.22.1', modules: '127', napi: '10' },
    report: { getReport: () => ({ header: { glibcVersionRuntime: '2.36' } }) } };
  const nodeReceipt = await receipts.captureInstalledExtensionReceipt(nodeExtension, nodeExpectationPath, nodeRuntime);
  receipts.assertInstalledExtensionReceipt(nodeReceipt, nodeExpected);
  assert.deepEqual(nodeReceipt.payloadHashes, nodeInput.payloadHashes);
  assert.equal(nodeReceipt.extensionPath, await fs.realpath(nodeInstalledPath));
  for (const key of ['node', 'modules', 'napi']) {
    await assert.rejects(receipts.captureInstalledExtensionReceipt(nodeExtension, nodeExpectationPath,
      { ...nodeRuntime, versions: { ...nodeRuntime.versions, [key]: '999' } }), new RegExp(`matching ${key}`));
  }
  await assert.rejects(receipts.captureInstalledExtensionReceipt(nodeExtension, nodeExpectationPath,
    { ...nodeRuntime, versions: { ...nodeRuntime.versions, electron: '39.8.7' } }), /non-Electron runtime/);
  await assert.rejects(receipts.captureInstalledExtensionReceipt(nodeExtension, nodeExpectationPath,
    { ...nodeRuntime, report: { getReport: () => ({ header: { glibcVersionRuntime: '2.35' } }) } }), /matching glibc/);
  await assert.rejects(receipts.captureInstalledExtensionReceipt(nodeExtension, nodeExpectationPath,
    { ...nodeRuntime, report: undefined }), /matching glibc/);
  assert.throws(() => receipts.assertInstalledCandidateRuntime(nodeRuntime, nodeManifest), /selected runtime/);
  assert.throws(() => receipts.assertInstalledCandidateRuntime(runtime,
    { ...manifest, runtime: { ...manifest.runtime, napi: '10' } }), /matching napi/);
  assert.throws(() => receipts.assertInstalledCandidateRuntime(runtime,
    { ...manifest, libc: nodeManifest.libc }), /matching glibc/);
  checks += 1;

  const schema2AssetSet = writeExecutionAssetSet(path.join(root, 'schema2-assets'));
  const schema2Assets = schema2AssetSet[0];
  const schema2Manifest = { ...schema2Assets.manifest,
    runtime: { name: 'node', version: '16.17.1', node: '16.17.1', modules: '93', napi: '8' } };
  const schema2Binary = schema2Assets.files.get('execution-owner.node');
  const schema2Payload = { ...payload, [nativeManifestPath]: Buffer.from(JSON.stringify(schema2Manifest)),
    [`${path.posix.dirname(nativeManifestPath)}/execution-owner.node`]: schema2Binary,
    'dist/execution-candidate-selection.json': Buffer.from(JSON.stringify({ schemaVersion: 1, profile: 'platform' })) };
  const schema2Zip = new JSZip();
  schema2Zip.file('extension/package.json', JSON.stringify(packageManifest));
  for (const [file, bytes] of Object.entries(schema2Payload)) schema2Zip.file(`extension/${file}`, bytes);
  const schema2Source = path.join(root, 'schema2.vsix');
  await fs.writeFile(schema2Source, await schema2Zip.generateAsync({ type: 'nodebuffer' }));
  const schema2Output = path.join(root, 'schema2-evidence');
  await fs.mkdir(schema2Output);
  const schema2Input = await prepareInstalledVsixInput(schema2Source, schema2Output);
  assert.equal(schema2Input.runtimeName, 'electron');
  assert.deepEqual(schema2Input.manifest, schema2Manifest);
  assert.equal(schema2Input.selection.profile, 'platform');
  const validatorBytes = await fs.readFile(schema2Input.runtimeValidation.file);
  assert.equal(hash(validatorBytes), schema2Input.runtimeValidation.sha256);
  assert(schema2Input.runtimeValidation.sources.some(source => source.file.endsWith('/linuxExecutionOwnerFactory.ts')));
  assert(schema2Input.runtimeValidation.sources.some(source => source.file.endsWith('/executionAssetCompatibility.ts')));
  for (const source of schema2Input.runtimeValidation.sources) assert.equal(hash(await fs.readFile(source.file)), source.sha256);
  checks += 1;

  const invalidSchema2 = path.join(root, 'invalid-schema2.vsix');
  const invalidSchema2Output = path.join(root, 'rejected-schema2-evidence');
  await fs.mkdir(invalidSchema2Output);
  for (const change of [
    { schemaVersion: 3 }, { arch: 'arm64' }, { requirements: undefined },
    { requirements: { ...schema2Manifest.requirements, napi: 7 } },
    { requirements: { ...schema2Manifest.requirements,
      linux: { ...schema2Manifest.requirements.linux, glibcMinimum: '2.17' } } },
    { requirements: { ...schema2Manifest.requirements,
      linux: { ...schema2Manifest.requirements.linux, glibcxxMinimum: '3.4.1' } } },
    { sources: { ...schema2Manifest.sources, ownerSha256: '0'.repeat(64) } }
  ]) {
    schema2Zip.file(`extension/${nativeManifestPath}`, JSON.stringify({ ...schema2Manifest, ...change }));
    await fs.writeFile(invalidSchema2, await schema2Zip.generateAsync({ type: 'nodebuffer' }));
    await assert.rejects(prepareInstalledVsixInput(invalidSchema2, invalidSchema2Output));
  }
  assert.deepEqual(await fs.readdir(invalidSchema2Output), []);
  schema2Zip.file(`extension/${nativeManifestPath}`, JSON.stringify(schema2Manifest));
  schema2Zip.file('extension/dist/execution-candidate-selection.json', JSON.stringify({ schemaVersion: 1, profile: 'windows-owner-v1-candidate' }));
  await fs.writeFile(invalidSchema2, await schema2Zip.generateAsync({ type: 'nodebuffer' }));
  await assert.rejects(prepareInstalledVsixInput(invalidSchema2, invalidSchema2Output), /verified platform profile/);
  checks += 1;

  const schema2Extensions = path.join(root, 'schema2-extensions');
  const schema2Installed = path.join(schema2Extensions, 'devsessioncanvas.dev-session-canvas-0.25.0');
  await fs.mkdir(schema2Installed, { recursive: true });
  await fs.writeFile(path.join(schema2Installed, 'package.json'), JSON.stringify(installedManifest));
  for (const [file, bytes] of Object.entries(schema2Payload)) {
    await fs.mkdir(path.dirname(path.join(schema2Installed, file)), { recursive: true });
    await fs.writeFile(path.join(schema2Installed, file), bytes);
  }
  const schema2Driver = await prepareInstalledCandidateDriver({ projectRoot,
    targetRoot: path.join(root, 'schema2-driver'), input: schema2Input, extensionsDir: schema2Extensions, artifactsDir: schema2Output });
  const schema2Extension = { ...extension, extensionPath: schema2Installed };
  const schema2Runtime = { ...runtime, versions: { ...runtime.versions, napi: '10' },
    report: { getReport: () => ({ header: { glibcVersionRuntime: '2.28' } }) } };
  const captureSchema2 = actual => receipts.captureInstalledExtensionReceipt(schema2Extension, schema2Driver.expectationPath, actual);
  const schema2Receipt = await captureSchema2(schema2Runtime);
  receipts.assertInstalledExtensionReceipt(schema2Receipt, schema2Driver.expectation);
  assert.deepEqual(schema2Receipt.payloadHashes, schema2Input.payloadHashes);
  assert.equal(schema2Receipt.nativeAssetValidation.validatorSha256, schema2Input.runtimeValidation.sha256);
  assert.throws(() => receipts.assertInstalledExtensionReceipt({ ...schema2Receipt, nativeAssetValidation: undefined }, schema2Driver.expectation));
  for (const napi of [undefined, '7', '8broken']) {
    await assert.rejects(captureSchema2({ ...schema2Runtime, versions: { ...schema2Runtime.versions, napi } }), /N-API/);
  }
  for (const glibcVersionRuntime of [undefined, '2.27', 'unknown']) {
    await assert.rejects(captureSchema2({ ...schema2Runtime, report: { getReport: () => ({ header: { glibcVersionRuntime } }) } }),
      /library/);
  }
  for (const actual of [{ ...schema2Runtime, platform: 'darwin' }, { ...schema2Runtime, arch: 'arm64' },
    { ...schema2Runtime, versions: { node: '16.17.1', modules: '93', napi: '8' } }]) {
    await assert.rejects(captureSchema2(actual));
  }
  checks += 1;

  await fs.writeFile(schema2Driver.expectationPath, JSON.stringify({ ...schema2Driver.expectation, runtimeName: 'node' }));
  const schema2NodeRuntime = { ...schema2Runtime, versions: { node: '25.6.0', modules: '141', napi: '10' } };
  await captureSchema2(schema2NodeRuntime);
  await assert.rejects(captureSchema2(schema2Runtime), /non-Electron/);
  await fs.writeFile(schema2Driver.expectationPath, JSON.stringify(schema2Driver.expectation));
  await fs.writeFile(schema2Input.runtimeValidation.file, 'module.exports = () => { throw new Error("must not run changed bytes"); };');
  await assert.rejects(captureSchema2(schema2Runtime), /validator hash changed/);
  await fs.writeFile(schema2Input.runtimeValidation.file, validatorBytes);
  const schema2InstalledBinary = path.join(schema2Installed, path.posix.dirname(nativeManifestPath), 'execution-owner.node');
  await fs.appendFile(schema2InstalledBinary, 'changed');
  await assert.rejects(captureSchema2(schema2Runtime), /binary content mismatch/);
  await fs.writeFile(schema2InstalledBinary, schema2Binary);
  await captureSchema2(schema2Runtime);
  checks += 1;

  const receiptSource = await fs.readFile('tests/vscode-smoke/installed-execution-candidate.cjs', 'utf8');
  for (const target of schema2AssetSet.slice(1)) {
    const { platform, arch } = target.manifest;
    const layout = receipts.installedCandidateLayout(platform, arch);
    const targetPayload = Object.fromEntries(installedCandidateFiles(platform, arch)
      .map(file => [file, Buffer.from(`fixed:${file}`)]));
    targetPayload[`${layout.assetRoot}/manifest.json`] = Buffer.from(JSON.stringify(target.manifest));
    targetPayload['dist/execution-candidate-selection.json'] = Buffer.from(JSON.stringify({ schemaVersion: 1, profile: 'platform' }));
    for (const [file, bytes] of target.files) targetPayload[`${layout.assetRoot}/${file}`] = bytes;
    const targetZip = new JSZip();
    targetZip.file('extension/package.json', JSON.stringify(packageManifest));
    for (const [file, bytes] of Object.entries(targetPayload)) targetZip.file(`extension/${file}`, bytes);
    const targetSource = path.join(root, `${target.name}.vsix`);
    await fs.writeFile(targetSource, await targetZip.generateAsync({ type: 'nodebuffer' }));
    const targetOutput = path.join(root, `${target.name}-evidence`);
    await fs.mkdir(targetOutput);
    const targetInput = await prepareInstalledVsixInput(targetSource, targetOutput, { platform, arch });
    assert.deepEqual(Object.keys(targetInput.payloadHashes), layout.files);
    for (const [file, bytes] of Object.entries(targetPayload)) assert.equal(targetInput.payloadHashes[file], hash(bytes));

    const targetExtensions = path.join(root, `${target.name}-extensions`);
    const targetInstalled = path.join(targetExtensions, 'devsessioncanvas.dev-session-canvas-0.25.0');
    await fs.mkdir(targetInstalled, { recursive: true });
    await fs.writeFile(path.join(targetInstalled, 'package.json'), JSON.stringify(installedManifest));
    for (const [file, bytes] of Object.entries(targetPayload)) {
      await fs.mkdir(path.dirname(path.join(targetInstalled, file)), { recursive: true });
      await fs.writeFile(path.join(targetInstalled, file), bytes);
      if (file === layout.helper) await fs.chmod(path.join(targetInstalled, file), 0o755);
    }
    const targetExpected = { ...targetInput, extensionsDir: await fs.realpath(targetExtensions) };
    const targetExpectation = path.join(targetOutput, 'expectation.json');
    await fs.writeFile(targetExpectation, JSON.stringify(targetExpected));
    const validatorModule = { exports: {} };
    // Only OS version observation is synthetic; invoke each frozen product factory on exact fixture bytes.
    vm.runInNewContext(await fs.readFile(targetInput.runtimeValidation.file, 'utf8'), {
      module: validatorModule, Buffer, TextEncoder, TextDecoder,
      require: id => id === 'node:os' ? { release: () => platform === 'darwin' ? '25.0.0' : '10.0.26100' } : require(id)
    });
    const receiptModule = { exports: {} };
    vm.runInNewContext(receiptSource, { module: receiptModule, process,
      require: id => id === targetInput.runtimeValidation.file ? validatorModule.exports : require(id) });
    const targetRuntime = { ...schema2Runtime, platform, arch };
    const capture = () => receiptModule.exports.captureInstalledExtensionReceipt(
      { ...extension, extensionPath: targetInstalled }, targetExpectation, targetRuntime);
    const targetReceipt = await capture();
    receipts.assertInstalledExtensionReceipt(JSON.parse(JSON.stringify(targetReceipt)), targetExpected);
    if (layout.helper) assert.equal(targetReceipt.nativeAssetValidation.helperSha256, targetInput.payloadHashes[layout.helper]);
    if (layout.worker) assert.equal(targetReceipt.nativeAssetValidation.workerSha256, targetInput.payloadHashes[layout.worker]);
    for (const file of [layout.helper, layout.worker, ...layout.dependencies].filter(Boolean)) {
      await fs.appendFile(path.join(targetInstalled, file), 'changed');
      await assert.rejects(capture(), `${target.name} must reject changed installed ${file}`);
      await fs.writeFile(path.join(targetInstalled, file), targetPayload[file]);
    }
    for (const file of [layout.helper, ...layout.dependencies].filter(Boolean)) {
      targetZip.file(`extension/${file}`, Buffer.concat([targetPayload[file], Buffer.from('changed')]));
      const rejectedSource = path.join(root, `${target.name}-invalid.vsix`);
      await fs.writeFile(rejectedSource, await targetZip.generateAsync({ type: 'nodebuffer' }));
      await assert.rejects(prepareInstalledVsixInput(rejectedSource, targetOutput, { platform, arch }), /hash/);
      targetZip.file(`extension/${file}`, targetPayload[file]);
    }
    checks += 1;
  }

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

  const installRuntime = { userDataDir: '/isolated/user-data', extensionsDir, environment: { HOME: '/isolated/home' } };
  const install = installedCandidateInstallCommand({ vscodeExecutablePath: '/fixed/VSCode/code', input,
    runtime: installRuntime }, 'linux');
  assert.equal(install.file, '/fixed/VSCode/bin/code');
  assert.deepEqual(install.args, ['--user-data-dir=/isolated/user-data', `--extensions-dir=${extensionsDir}`,
    '--install-extension', input.vsixPath, '--force', '--do-not-include-pack-dependencies']);
  assert.equal(install.options.shell, false);
  assert.equal(install.options.env.HOME, '/isolated/home');
  assert(!install.args.some(argument => argument.includes('extensionDevelopmentPath')));
  const macInstall = installedCandidateInstallCommand({ vscodeExecutablePath: '/fixed/Code.app/Contents/MacOS/Electron',
    input, runtime: installRuntime }, 'darwin');
  assert.equal(macInstall.file, '/fixed/Code.app/Contents/Resources/app/bin/code');
  assert.deepEqual(macInstall.args, install.args);
  assert.equal(macInstall.options.shell, false);
  const windowsExecutable = 'C:\\fixed\\Code.exe';
  const windowsLauncher = prefix => `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"%~dp0..\\Code.exe" "%~dp0..\\${prefix}resources\\app\\out\\cli.js" %*\r\n`;
  for (const prefix of ['', '10c8e557c8\\']) {
    const windowsInstall = installedCandidateInstallCommand({ vscodeExecutablePath: windowsExecutable,
      input, runtime: installRuntime, windowsLauncher: windowsLauncher(prefix) }, 'win32');
    assert.equal(windowsInstall.file, windowsExecutable);
    assert.deepEqual(windowsInstall.args, [`C:\\fixed\\${prefix}resources\\app\\out\\cli.js`, ...install.args]);
    assert.equal(windowsInstall.options.shell, false);
    assert.equal(windowsInstall.options.env.ELECTRON_RUN_AS_NODE, '1');
    assert.equal(windowsInstall.options.env.HOME, '/isolated/home');
  }
  for (const launcher of [undefined, '', windowsLauncher('').replace('set ELECTRON_RUN_AS_NODE=1', ''),
    windowsLauncher('..\\'), windowsLauncher('unexpected\\'), windowsLauncher('10c8e557c8\\').replace('cli.js', 'other.js'),
    windowsLauncher('').replace('Code.exe', 'Other.exe'), windowsLauncher('') + windowsLauncher('10c8e557c8\\'),
    windowsLauncher('').replace('%*', '%* & echo extra')]) {
    assert.throws(() => installedCandidateInstallCommand({ vscodeExecutablePath: windowsExecutable,
      input, runtime: installRuntime, windowsLauncher: launcher }, 'win32'));
  }
  const installerSource = await fs.readFile('scripts/smoke/installed-execution-candidate.mjs', 'utf8');
  assert.match(installerSource, /fs\.readFile\(path\.join\(path\.dirname\(options\.vscodeExecutablePath\), 'bin', 'code\.cmd'\), 'utf8'\)/);
  assert.match(installerSource, /await fs\.lstat\(command\.args\[0\]\)\)\.isFile\(\)/);
  assert.match(installerSource, /await execFileAsync\(command\.file, command\.args, command\.options\)/);
  checks += 1;

  const source = await fs.readFile('scripts/smoke/run-vscode-execution-candidate.mjs', 'utf8');
  const loop = source.slice(source.indexOf('for (const [index, mode] of modes.entries()) {'),
    source.indexOf('async function runCapacityCalibration() {'));
  for (const invalidReceipt of [undefined, 'missing', 'hash-mismatch']) {
    const reports = new Map(), launches = [], installs = [];
    const execute = () => vm.runInNewContext(`(async () => { ${loop} })()`, {
      assert, path, JSON, installedReceipts: receipts, installedInput: input, values: {},
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
