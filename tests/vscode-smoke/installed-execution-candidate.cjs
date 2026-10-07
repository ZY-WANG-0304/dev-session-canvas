const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

function installedCandidateLayout(platform = process.platform, arch = process.arch) {
  assert(['linux', 'darwin', 'win32'].includes(platform), 'Installed acceptance requires a supported native platform.');
  assert(['x64', 'arm64'].includes(arch), 'Installed acceptance requires a supported native architecture.');
  const owner = { linux: 'linux', darwin: 'macos', win32: 'windows' }[platform];
  const assetRoot = `dist/native/${owner}-execution-candidate/${platform}-${arch}${platform === 'linux' ? '-glibc' : ''}`;
  const binary = `${assetRoot}/${platform === 'win32' ? 'conpty.node' : 'execution-owner.node'}`;
  const entry = `dist/${owner}-execution-provider.js`;
  const helper = platform === 'darwin' ? `${assetRoot}/spawn-helper` : undefined;
  const worker = platform === 'win32' ? 'dist/windows-execution-output-worker.js' : undefined;
  const dependencies = platform === 'win32' ? [`${assetRoot}/conpty/conpty.dll`, `${assetRoot}/conpty/OpenConsole.exe`] : [];
  return { platform, arch, profile: `${owner}-owner-v1-candidate`, assetRoot, binary, entry, helper, worker, dependencies,
    resolver: `resolve${{ linux: 'Linux', darwin: 'Macos', win32: 'Windows' }[platform]}ExecutionProviderAssets`,
    files: ['dist/extension.js', 'dist/runtime-supervisor.js', entry, 'dist/webview.js', 'dist/webview.css',
      'dist/execution-candidate-selection.json', `${assetRoot}/manifest.json`, binary,
      ...(helper ? [helper] : []), ...(worker ? [worker] : []), ...dependencies] };
}

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const productManifest = manifest => {
  const { __metadata, ...product } = manifest;
  return product;
};

function assertChild(root, child) {
  const relative = path.relative(root, child);
  assert(relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative),
    `Installed payload must be inside ${root}: ${child}`);
}

function assertInstalledExtensionReceipt(receipt, expected) {
  assert(receipt, 'Each installed VSIX phase must emit an installed-path receipt.');
  assert.equal(receipt.schemaVersion, 1);
  assert.equal(receipt.vsixSha256, expected.vsixSha256);
  assert.equal(receipt.extensionsDir, expected.extensionsDir);
  assertChild(expected.extensionsDir, receipt.extensionPath);
  assert.equal(receipt.id, 'devsessioncanvas.dev-session-canvas');
  assert.equal(receipt.isActive, true);
  assert.equal(receipt.version, expected.packageManifest.version);
  assert.equal(receipt.main, expected.packageManifest.main);
  // VS Code may add its own installation metadata; every product manifest field stays unchanged.
  assert.deepEqual(receipt.productManifest, productManifest(expected.packageManifest));
  assert.deepEqual(receipt.payloadHashes, expected.payloadHashes);
  if (expected.manifest.schemaVersion === 2) {
    const layout = installedCandidateLayout(expected.manifest.platform, expected.manifest.arch);
    assert.deepEqual(receipt.nativeAssetValidation, {
      validatorSha256: expected.runtimeValidation.sha256,
      binarySha256: expected.payloadHashes[layout.binary],
      manifestSha256: expected.payloadHashes[`${layout.assetRoot}/manifest.json`],
      entrySha256: expected.payloadHashes[layout.entry],
      ...(layout.helper ? { helperSha256: expected.payloadHashes[layout.helper] } : {}),
      ...(layout.worker ? { workerSha256: expected.payloadHashes[layout.worker] } : {})
    });
  }
}

function assertInstalledCandidateRuntime(runtime, manifest, runtimeName = 'electron', compatibility) {
  assert(['electron', 'node'].includes(runtimeName), 'Installed acceptance requires an explicit supported runtime.');
  if (manifest.schemaVersion === 2) {
    const layout = installedCandidateLayout(runtime.platform, runtime.arch);
    assert.equal(manifest.platform, runtime.platform);
    assert.equal(manifest.arch, runtime.arch);
    assert.equal(manifest.profile, layout.profile);
    if (runtimeName === 'electron') assert.match(runtime.versions.electron ?? '', /^\d+\.\d+\.\d+$/);
    else assert(!Object.hasOwn(runtime.versions, 'electron'), 'Installed Node acceptance requires a non-Electron runtime.');
    assert(compatibility, 'Installed schema2 acceptance requires the frozen product validator.');
    compatibility.assertExecutionAssetRuntime(manifest.runtime, manifest.requirements?.napi);
    if (runtime.platform === 'linux') {
      assert.equal(manifest.requirements.linux.libc, 'glibc');
      compatibility.assertMinimumExecutionLibraryVersion(runtime.report?.getReport().header?.glibcVersionRuntime,
        manifest.requirements.linux.glibcMinimum);
    }
    return;
  }
  assert.equal(manifest.runtime.name, runtimeName, 'Installed native asset requires the selected runtime.');
  assert.equal(runtime.platform, manifest.platform);
  assert.equal(runtime.arch, manifest.arch);
  const expectedVersions = { node: manifest.runtime.node, modules: manifest.runtime.modules };
  if (runtimeName === 'node') {
    assert(!Object.hasOwn(runtime.versions, 'electron'), 'Installed Node asset requires a non-Electron runtime.');
    assert.equal(manifest.runtime.version, manifest.runtime.node, 'Node asset version must match its Node version.');
  } else {
    expectedVersions.electron = manifest.runtime.version;
  }
  if (runtimeName === 'node' || manifest.runtime.napi !== undefined) expectedVersions.napi = manifest.runtime.napi;
  for (const [key, value] of Object.entries(expectedVersions)) {
    assert.equal(typeof value, 'string', `Installed native asset must declare ${key}.`);
    assert(value.length > 0, `Installed native asset must declare ${key}.`);
    assert.equal(runtime.versions[key], value, `Installed native asset requires matching ${key}.`);
  }
  if (runtimeName === 'node' || manifest.libc !== undefined) {
    assert.equal(manifest.libc?.name, 'glibc', 'Installed native asset must declare glibc.');
    assert.match(manifest.libc?.version ?? '', /^\d+\.\d+(?:\.\d+)?$/);
    assert.equal(runtime.report?.getReport().header?.glibcVersionRuntime, manifest.libc.version,
      'Installed native asset requires matching glibc.');
  }
}

async function captureInstalledExtensionReceipt(extension, expectationPath, runtime = process) {
  const expected = JSON.parse(await fs.readFile(expectationPath, 'utf8'));
  const extensionsDir = await fs.realpath(expected.extensionsDir);
  const extensionPath = await fs.realpath(extension.extensionPath);
  assertChild(extensionsDir, extensionPath);
  const packagePath = await fs.realpath(path.join(extensionPath, 'package.json'));
  assertChild(extensionPath, packagePath);
  const packageBytes = await fs.readFile(packagePath);
  const installedManifest = JSON.parse(packageBytes.toString('utf8'));
  // The API localizes display text; compare loading identity here and raw product fields below.
  for (const key of ['publisher', 'name', 'version', 'main']) {
    assert.equal(extension.packageJSON[key], installedManifest[key]);
  }
  const payloadHashes = {};
  for (const relative of Object.keys(expected.payloadHashes)) {
    const actualPath = await fs.realpath(path.join(extensionPath, relative));
    assertChild(extensionPath, actualPath);
    payloadHashes[relative] = hash(await fs.readFile(actualPath));
  }
  let nativeAssetValidation;
  if (expected.manifest.schemaVersion === 2) {
    const validator = expected.runtimeValidation;
    assert(validator && path.isAbsolute(validator.file), 'Installed schema2 acceptance requires the frozen product validator.');
    assert.equal(hash(await fs.readFile(validator.file)), validator.sha256, 'Installed runtime validator hash changed.');
    const compatibility = require(validator.file)(runtime);
    assertInstalledCandidateRuntime(runtime, expected.manifest, expected.runtimeName ?? 'electron', compatibility);
    const layout = installedCandidateLayout(runtime.platform, runtime.arch);
    const assets = compatibility[layout.resolver](path.join(extensionPath, 'dist'));
    assert.equal(assets.binaryPath, path.join(extensionPath, layout.binary));
    assert.equal(assets.entryPoint, path.join(extensionPath, layout.entry));
    if (layout.helper) assert.equal(assets.helperPath, path.join(extensionPath, layout.helper));
    if (layout.worker) assert.equal(assets.workerPath, path.join(extensionPath, layout.worker));
    nativeAssetValidation = { validatorSha256: validator.sha256, binarySha256: assets.binarySha256,
      manifestSha256: assets.manifestSha256, entrySha256: assets.entrySha256,
      ...(layout.helper ? { helperSha256: assets.helperSha256 } : {}),
      ...(layout.worker ? { workerSha256: assets.workerSha256 } : {}) };
  } else assertInstalledCandidateRuntime(runtime, expected.manifest, expected.runtimeName ?? 'electron');
  const receipt = { schemaVersion: 1, vsixSha256: expected.vsixSha256, extensionsDir, extensionPath,
    id: extension.id, isActive: extension.isActive, version: installedManifest.version, main: installedManifest.main,
    installedPackageSha256: hash(packageBytes), productManifest: productManifest(installedManifest), payloadHashes,
    ...(nativeAssetValidation ? { nativeAssetValidation } : {}) };
  assertInstalledExtensionReceipt(receipt, expected);
  return receipt;
}

module.exports = { installedCandidateLayout, captureInstalledExtensionReceipt, assertInstalledExtensionReceipt,
  assertInstalledCandidateRuntime };
