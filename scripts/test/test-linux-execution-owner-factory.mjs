import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import esbuild from 'esbuild';
import { LINUX_EXECUTION_EXPORTS } from '../build/linux-execution-provider-patch.mjs';

const require = createRequire(import.meta.url);
const bundle = await esbuild.build({
  entryPoints: [path.resolve('extensions/vscode/dev-session-canvas/src/panel/linuxExecutionOwnerFactory.ts')],
  bundle: true, format: 'cjs', platform: 'node', write: false
});
let forbidden = 0;
const loaded = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(specifier => {
  if (specifier === 'node:child_process') return { spawn() { forbidden++; assert.fail('factory must not spawn before connect'); } };
  if (specifier.endsWith('.node')) { forbidden++; assert.fail('authority must never load native'); }
  return require(specifier);
}, loaded, loaded.exports);
const { createLinuxExecutionOwnerOptions, resolveLinuxExecutionProviderAssets,
  LINUX_EXECUTION_NATIVE_EXPORTS, LINUX_EXECUTION_ASSET_DIRECTORY } = loaded.exports;
assert.deepEqual(LINUX_EXECUTION_NATIVE_EXPORTS, LINUX_EXECUTION_EXPORTS);
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dsc-linux-owner-factory-'));
const dist = path.join(directory, 'dist');
const assets = path.join(dist, LINUX_EXECUTION_ASSET_DIRECTORY);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const binary = Buffer.alloc(64);
binary.set([0x7f, 0x45, 0x4c, 0x46, 2, 1]);
binary.writeUInt16LE(3, 16);
binary.writeUInt16LE(62, 18);
const worker = Buffer.from('module.exports = {};\n');
const binaryFile = path.join(assets, 'execution-owner.node');
const manifestFile = path.join(assets, 'manifest.json');
const entryPoint = path.join(dist, 'linux-execution-provider.js');
const base = {
  schemaVersion: 1, profile: 'linux-owner-v1-candidate', platform: 'linux', arch: 'x64',
  libc: { name: 'glibc', version: process.report.getReport().header.glibcVersionRuntime },
  runtime: { name: process.versions.electron ? 'electron' : 'node', version: process.versions.electron ?? process.versions.node,
    node: process.versions.node, modules: process.versions.modules, napi: process.versions.napi },
  binary: { file: 'execution-owner.node', sha256: hash(binary) }, exports: LINUX_EXECUTION_EXPORTS,
  sources: Object.fromEntries(['ownerSha256', 'patchSha256', 'nodePtySha256', 'patchedSha256', 'headersSha256', 'nodeAddonApiSha256']
    .map(key => [key, 'a'.repeat(64)])),
  verification: { compiled: true, nativeLoaded: false, nativeCalls: false, productValidated: false }
};
const writeManifest = manifest => fs.writeFileSync(manifestFile, JSON.stringify(manifest));
let count = 0;
try {
  assert.throws(() => createLinuxExecutionOwnerOptions({ extensionRoot: directory, mode: 'live-runtime' }));
  assert.equal(forbidden, 0);
  count++;
  fs.mkdirSync(assets, { recursive: true });
  fs.writeFileSync(binaryFile, binary);
  fs.writeFileSync(entryPoint, worker);
  writeManifest(base);
  for (const mode of ['live-runtime', 'snapshot-only']) {
    const options = createLinuxExecutionOwnerOptions({ extensionRoot: directory, mode });
    assert.equal(options.kind, 'linux-provider');
    assert.equal(options.profileMode, mode);
    assert.equal(options.capabilities.includes('terminal-read-settlement-v1'), mode === 'live-runtime');
    assert.equal(options.capabilities.includes('terminal-local-persistence-v1'), mode === 'snapshot-only');
    const transport = options.createTransport({ executionId: 'factory-execution', generation: 'generation-1' });
    assert.equal(transport.options.executable, process.execPath);
    assert.equal(transport.options.entryPoint, entryPoint);
    assert.deepEqual(transport.options.args, [hash(binary), hash(fs.readFileSync(manifestFile)), hash(worker)]);
    assert.strictEqual(transport.parentControl.scheduler, options.scheduler);
    assert.deepEqual(transport.parentControl.expectedNativeResourceIds, ['pty-master', 'pty-child', 'pty-source']);
    assert.equal(forbidden, 0);
    count++;
  }
  const mutations = [
    m => { m.profile = 'other'; }, m => { m.runtime.modules = '1'; },
    m => { m.runtime.name = m.runtime.name === 'node' ? 'electron' : 'node'; },
    m => { m.libc.version = '0.0'; }, m => { m.binary.file = '../execution-owner.node'; },
    m => { m.binary.sha256 = '0'.repeat(64); }, m => { m.exports.pop(); },
    m => { m.sources.headersSha256 = ''; }, m => { m.verification.productValidated = true; }
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(base); mutate(changed); writeManifest(changed);
    assert.throws(() => resolveLinuxExecutionProviderAssets(dist));
    assert.equal(forbidden, 0); count++;
  }
  writeManifest(base);
  const prepared = createLinuxExecutionOwnerOptions({ extensionRoot: directory, mode: 'live-runtime' });
  fs.appendFileSync(entryPoint, '// changed');
  assert.throws(() => prepared.createTransport({ executionId: 'factory-execution', generation: 'generation-1' }), /changed/);
  fs.writeFileSync(entryPoint, worker); count++;
  fs.unlinkSync(binaryFile);
  const other = path.join(directory, 'redirected.node');
  fs.writeFileSync(other, binary);
  fs.symlinkSync(other, binaryFile);
  assert.throws(() => resolveLinuxExecutionProviderAssets(dist), /Invalid Linux candidate asset/);
  assert.equal(forbidden, 0); count++;
  console.log(`Linux execution owner factory: ${count}/${count} passed (synthetic asset bytes, no native loads or provider starts)`);
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
