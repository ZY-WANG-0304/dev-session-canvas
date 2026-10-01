const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

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
}

function assertInstalledCandidateRuntime(runtime, manifest, runtimeName = 'electron') {
  assert(['electron', 'node'].includes(runtimeName), 'Installed acceptance requires an explicit supported runtime.');
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
  assertInstalledCandidateRuntime(runtime, expected.manifest, expected.runtimeName ?? 'electron');
  const receipt = { schemaVersion: 1, vsixSha256: expected.vsixSha256, extensionsDir, extensionPath,
    id: extension.id, isActive: extension.isActive, version: installedManifest.version, main: installedManifest.main,
    installedPackageSha256: hash(packageBytes), productManifest: productManifest(installedManifest), payloadHashes };
  assertInstalledExtensionReceipt(receipt, expected);
  return receipt;
}

module.exports = { captureInstalledExtensionReceipt, assertInstalledExtensionReceipt, assertInstalledCandidateRuntime };
