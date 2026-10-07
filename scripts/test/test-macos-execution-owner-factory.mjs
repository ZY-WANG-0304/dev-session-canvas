import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import esbuild from 'esbuild';
import { MACOS_EXECUTION_EXPORTS } from '../build/macos-execution-provider-patch.mjs';

const require = createRequire(import.meta.url);
const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dsc-macos-factory-')));
const bundle = await esbuild.build({ entryPoints: ['extensions/vscode/dev-session-canvas/src/panel/macosExecutionOwnerFactory.ts'],
  bundle: true, write: false, platform: 'node', format: 'cjs' });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
let passed = 0;
try {
  for (const arch of ['x64', 'arm64']) {
    const observed = { nativeLoads: 0, claims: [], spawned: 0 };
    const targetProcess = { ...process, platform: 'darwin', arch };
    let darwinRelease = '26.0.0';
    const loaded = { exports: {} };
    new Function('require', 'module', 'exports', 'process', bundle.outputFiles[0].text)(name => {
      if (name === 'node:child_process') return { spawn() { observed.spawned++; assert.fail('No startup in asset preparation.'); } };
      if (name === 'node:os') return { ...os, release: () => darwinRelease };
      if (name.endsWith('.node')) {
        observed.nativeLoads++;
        return { executionClaimNamespace: file => observed.claims.push(file) };
      }
      return require(name);
    }, loaded, loaded.exports, targetProcess);
    const { createMacosExecutionOwnerOptions, resolveMacosExecutionProviderAssets, MACOS_EXECUTION_NATIVE_EXPORTS } = loaded.exports;
    assert.deepEqual(MACOS_EXECUTION_NATIVE_EXPORTS, MACOS_EXECUTION_EXPORTS);
    const root = path.join(directory, arch);
    const dist = path.join(root, 'dist');
    const assetDirectory = path.join(dist, `native/macos-execution-candidate/darwin-${arch}`);
    fs.mkdirSync(assetDirectory, { recursive: true });
    const macho = filetype => {
      const bytes = Buffer.alloc(64);
      bytes.writeUInt32LE(0xfeedfacf, 0);
      bytes.writeUInt32LE(arch === 'arm64' ? 0x0100000c : 0x01000007, 4);
      bytes.writeUInt32LE(filetype, 12);
      return bytes;
    };
    const binary = macho(8);
    const helper = macho(2);
    const helperPath = path.join(assetDirectory, 'spawn-helper');
    const binaryPath = path.join(assetDirectory, 'execution-owner.node');
    const manifestFile = path.join(assetDirectory, 'manifest.json');
    const entryPoint = path.join(dist, 'macos-execution-provider.js');
    const runtime = { name: 'node', version: process.versions.node, node: process.versions.node,
      modules: process.versions.modules, napi: process.versions.napi };
    const base = { schemaVersion: 2, profile: 'macos-owner-v1-candidate', platform: 'darwin', arch, runtime,
      requirements: { napi: 8, macos: { deploymentTarget: arch === 'arm64' ? '11.0' : '10.13' } },
      binary: { file: 'execution-owner.node', sha256: hash(binary) },
      helper: { file: 'spawn-helper', sha256: hash(helper) }, exports: MACOS_EXECUTION_EXPORTS,
      sources: Object.fromEntries(['ownerSha256', 'sharedOwnerSha256', 'patchSha256', 'nodePtySha256', 'patchedSha256',
        'helperSourceSha256', 'helperPatchedSha256', 'headersSha256', 'nodeAddonApiSha256'].map(key => [key, 'a'.repeat(64)])),
      verification: { compiled: true, nativeLoaded: false, nativeCalls: false, productValidated: false } };
    const manifest = value => fs.writeFileSync(manifestFile, JSON.stringify(value));
    fs.writeFileSync(binaryPath, binary);
    fs.writeFileSync(helperPath, helper, { mode: 0o755 });
    fs.writeFileSync(entryPoint, 'module.exports = {};');
    manifest(base);
    const assets = resolveMacosExecutionProviderAssets(dist);
    assert.equal(assets.helperPath, helperPath);
    const snapshot = createMacosExecutionOwnerOptions({ extensionRoot: root, mode: 'snapshot-only' });
    assert.equal(snapshot.kind, 'macos-provider');
    assert.equal(snapshot.profile, base.profile);
    assert.equal(observed.nativeLoads, 0);
    assert.throws(() => snapshot.claimNamespace(root), /Only the Runtime authority/);
    const local = snapshot.createTransport({ executionId: 'factory-test', generation: 'one' });
    assert.deepEqual(local.parentControl.expectedNativeResourceIds, ['pty-master', 'pty-child', 'pty-source', 'pty-creation']);
    assert.equal(observed.spawned, 0);
    assert.equal(observed.nativeLoads, 0);
    const live = createMacosExecutionOwnerOptions({ extensionRoot: root, mode: 'live-runtime' });
    live.claimNamespace(root);
    assert.equal(observed.nativeLoads, 1);
    assert.deepEqual(observed.claims, [path.join(root, 'supervisor-owner.lock')]);
    for (const changed of [{ ...base, arch: 'other' }, { ...base, profile: 'linux-owner-v1-candidate' },
      { ...base, runtime: { ...runtime, modules: '' } }, { ...base, helper: { ...base.helper, file: '../helper' } },
      { ...base, schemaVersion: 1 }, { ...base, requirements: { ...base.requirements, napi: 10 } },
      { ...base, sources: { ...base.sources, sharedOwnerSha256: undefined } }]) {
      manifest(changed);
      assert.throws(() => resolveMacosExecutionProviderAssets(dist));
    }
    manifest(base);
    for (const versions of [
      { node: '16.17.1', modules: '93', napi: '8' },
      { electron: '39.8.7', node: '22.22.1', modules: '140', napi: '10' }
    ]) {
      targetProcess.versions = versions;
      assert.doesNotThrow(() => resolveMacosExecutionProviderAssets(dist));
    }
    targetProcess.versions = { ...process.versions, napi: '7' };
    assert.throws(() => resolveMacosExecutionProviderAssets(dist), /N-API/);
    targetProcess.versions = process.versions;
    darwinRelease = arch === 'arm64' ? '19.6.0' : '16.7.0';
    assert.throws(() => resolveMacosExecutionProviderAssets(dist), /minimum/);
    darwinRelease = arch === 'arm64' ? '20.0.0' : '17.0.0';
    assert.doesNotThrow(() => resolveMacosExecutionProviderAssets(dist));
    fs.chmodSync(helperPath, 0o644);
    assert.throws(() => resolveMacosExecutionProviderAssets(dist), /Invalid macOS candidate asset/);
    fs.chmodSync(helperPath, 0o755);
    const incompatible = macho(2);
    fs.writeFileSync(binaryPath, incompatible);
    manifest({ ...base, binary: { ...base.binary, sha256: hash(incompatible) } });
    assert.throws(() => resolveMacosExecutionProviderAssets(dist), /Mach-O/);
    fs.writeFileSync(binaryPath, binary);
    manifest(base);
    fs.appendFileSync(entryPoint, '\nchanged');
    assert.throws(() => snapshot.createTransport({ executionId: 'changed', generation: 'two' }), /changed after owner preparation/);
    assert.throws(() => live.claimNamespace(root), /changed after owner preparation/);
    assert.equal(observed.nativeLoads, 1);
    passed++;
  }
  console.log(`macOS owner factory: ${passed} architecture contracts passed (mock platform/native; no macOS execution).`);
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
