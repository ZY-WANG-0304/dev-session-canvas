const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function checkNativeLoad(directory, expectedNode, expectedElectron, load = require) {
  assert(path.isAbsolute(directory), 'Specify the absolute, previously validated asset directory');
  const manifestBytes = fs.readFileSync(path.join(directory, 'manifest.json'));
  const manifest = JSON.parse(manifestBytes);
  assert.equal(manifest.schemaVersion, 2);
  assert.equal(process.platform, manifest.platform);
  assert.equal(process.arch, manifest.arch);
  assert.equal(process.versions.node, expectedNode);
  assert.equal(process.versions.electron ?? null, expectedElectron);
  assert.equal(manifest.requirements.napi, 8);
  assert(Number(process.versions.napi) >= manifest.requirements.napi);
  assert.equal(manifest.verification.productValidated, false);
  const digest = bytes => createHash('sha256').update(bytes).digest('hex');
  for (const asset of [manifest.binary, manifest.helper, ...(manifest.dependencies ?? [])].filter(Boolean)) {
    assert.equal(digest(fs.readFileSync(path.join(directory, asset.file))), asset.sha256);
  }
  const addon = load(path.join(directory, manifest.binary.file));
  assert.deepEqual(Object.keys(addon).sort(), manifest.exports);
  for (const name of manifest.exports) assert.equal(typeof addon[name], 'function');
  return { platform: process.platform, arch: process.arch, osRelease: os.release(),
    glibcVersionRuntime: process.platform === 'linux' ? process.report.getReport().header.glibcVersionRuntime ?? null : null,
    runtime: { name: process.versions.electron ? 'electron' : 'node', node: process.versions.node,
      electron: process.versions.electron ?? null, modules: process.versions.modules, napi: process.versions.napi },
    manifestSha256: digest(manifestBytes), binarySha256: manifest.binary.sha256,
    nativeLoaded: true, executionApiCalled: false, productValidated: false };
}

module.exports = { checkNativeLoad };
if (require.main === module) {
  const [directory, expectedNode, expectedElectron, reportFile] = process.argv.slice(2);
  assert(directory && expectedNode && expectedElectron && reportFile, 'Specify assets, Node, Electron-or-none, and report');
  const result = checkNativeLoad(directory, expectedNode, expectedElectron === 'none' ? null : expectedElectron);
  fs.writeFileSync(reportFile, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify(result));
}
