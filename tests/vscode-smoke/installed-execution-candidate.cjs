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
  assert.equal(runtime.platform, expected.manifest.platform);
  assert.equal(runtime.arch, expected.manifest.arch);
  for (const [key, value] of Object.entries({ electron: expected.manifest.runtime.version,
    node: expected.manifest.runtime.node, modules: expected.manifest.runtime.modules })) {
    assert.equal(runtime.versions[key], value, `Installed native asset requires matching ${key}.`);
  }
  const receipt = { schemaVersion: 1, vsixSha256: expected.vsixSha256, extensionsDir, extensionPath,
    id: extension.id, isActive: extension.isActive, version: installedManifest.version, main: installedManifest.main,
    installedPackageSha256: hash(packageBytes), productManifest: productManifest(installedManifest), payloadHashes };
  assertInstalledExtensionReceipt(receipt, expected);
  return receipt;
}

module.exports = { captureInstalledExtensionReceipt, assertInstalledExtensionReceipt };
