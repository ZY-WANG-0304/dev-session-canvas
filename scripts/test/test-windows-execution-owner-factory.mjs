import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import esbuild from 'esbuild';
import { WINDOWS_EXECUTION_EXPORTS } from '../build/windows-execution-provider-patch.mjs';

const require = createRequire(import.meta.url);
const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dsc-windows-factory-')));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceKeys = ['ownerSha256', 'patchSha256', 'nodePtySha256', 'patchedSha256', 'pathUtilSha256',
  'windowsHeadersSha256', 'headersSha256', 'nodeAddonApiSha256', 'nodeLibSha256', 'delayLoadHookSha256'];
const identity = { executionId: 'windows-factory-test', generation: 'one' };
const bundles = new Map();
let forbidden = 0;
let passed = 0;

async function loadFactory(targetProcess, compiledAdmission) {
  const key = JSON.stringify(compiledAdmission) ?? 'undefined';
  if (!bundles.has(key)) {
    const bundle = await esbuild.build({
      entryPoints: ['extensions/vscode/dev-session-canvas/src/panel/windowsExecutionOwnerFactory.ts'],
      bundle: true, write: false, platform: 'node', format: 'cjs',
      define: { __DEV_SESSION_CANVAS_EXECUTION_ADMISSION__: key }
    });
    bundles.set(key, bundle.outputFiles[0].text);
  }
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', 'process', bundles.get(key))(name => {
    if (name === 'node:child_process') return { spawn() { forbidden++; assert.fail('No startup during owner preparation.'); } };
    if (name.endsWith('.node')) { forbidden++; assert.fail('The authority must not load the Windows native binding.'); }
    return require(name);
  }, loaded, loaded.exports, targetProcess);
  return loaded.exports;
}

function peImage(arch, dll) {
  const bytes = Buffer.alloc(256);
  bytes.writeUInt16LE(0x5a4d, 0);
  bytes.writeUInt32LE(64, 0x3c);
  bytes.writeUInt32LE(0x4550, 64);
  bytes.writeUInt16LE(arch === 'arm64' ? 0xaa64 : 0x8664, 68);
  bytes.writeUInt16LE(112, 84);
  bytes.writeUInt16LE(0x0002 | (dll ? 0x2000 : 0), 86);
  bytes.writeUInt16LE(0x20b, 88);
  return bytes;
}

try {
  for (const arch of ['x64', 'arm64']) for (const runtimeName of ['node', 'electron']) {
    const versions = { ...process.versions, electron: runtimeName === 'electron' ? '39.8.7' : undefined };
    const targetProcess = { ...process, platform: 'win32', arch, versions,
      env: { FACTORY_TEST_ENV: 'retained' } };
    const { createWindowsExecutionOwnerOptions, resolveWindowsExecutionProviderAssets,
      WINDOWS_EXECUTION_NATIVE_EXPORTS } = await loadFactory(targetProcess);
    assert.deepEqual(WINDOWS_EXECUTION_NATIVE_EXPORTS, WINDOWS_EXECUTION_EXPORTS);
    const root = path.join(directory, `${arch}-${runtimeName}`);
    const dist = path.join(root, 'dist');
    const assetDirectory = path.join(dist, `native/windows-execution-candidate/win32-${arch}`);
    const conptyDirectory = path.join(assetDirectory, 'conpty');
    const manifestFile = path.join(assetDirectory, 'manifest.json');
    const entryPoint = path.join(dist, 'windows-execution-provider.js');
    const workerPath = path.join(dist, 'windows-execution-output-worker.js');
    const entry = Buffer.from('module.exports = {};\n');
    const worker = Buffer.from('module.exports = { worker: true };\n');
    const assetNames = ['conpty.node', 'conpty/conpty.dll', 'conpty/OpenConsole.exe'];
    const images = [peImage(arch, true), peImage(arch, true), peImage(arch, false)];
    const descriptors = assetNames.map((file, index) => ({ file, sha256: hash(images[index]) }));
    const runtime = { name: runtimeName, version: versions.electron ?? versions.node, node: versions.node,
      modules: versions.modules, napi: versions.napi };
    const base = { schemaVersion: 1, profile: 'windows-owner-v1-candidate', platform: 'win32', arch, runtime,
      binary: descriptors[0], dependencies: descriptors.slice(1), exports: WINDOWS_EXECUTION_EXPORTS,
      sources: Object.fromEntries(sourceKeys.map(key => [key, 'a'.repeat(64)])),
      verification: { compiled: true, nativeLoaded: false, nativeCalls: false, productValidated: false } };
    const writeManifest = manifest => fs.writeFileSync(manifestFile, JSON.stringify(manifest));
    assert.throws(() => createWindowsExecutionOwnerOptions({ extensionRoot: root, mode: 'snapshot-only' }));
    fs.mkdirSync(conptyDirectory, { recursive: true });
    images.forEach((bytes, index) => fs.writeFileSync(path.join(assetDirectory, assetNames[index]), bytes));
    fs.writeFileSync(entryPoint, entry);
    fs.writeFileSync(workerPath, worker);
    writeManifest(base);
    const assets = resolveWindowsExecutionProviderAssets(dist);
    assert.equal(assets.binaryPath, path.join(assetDirectory, 'conpty.node'));
    assert.equal(assets.workerPath, workerPath);
    assert.equal(assets.workerSha256, hash(worker));
    assert.ok(Object.isFrozen(assets));
    assert.throws(() => resolveWindowsExecutionProviderAssets('relative/dist'), /absolute/);
    assert.throws(() => createWindowsExecutionOwnerOptions({ extensionRoot: root, mode: 'legacy' }), /explicit/);
    for (const mode of ['live-runtime', 'snapshot-only']) {
      const options = createWindowsExecutionOwnerOptions({ extensionRoot: root, mode });
      assert.equal(options.kind, 'windows-provider');
      assert.equal(options.profile, base.profile);
      assert.equal(options.profileMode, mode);
      assert.ok(Object.isFrozen(options));
      assert.deepEqual(options.admissionLimits, { executions: 2, starting: 1 });
      assert.equal(options.capabilities.includes('terminal-read-settlement-v1'), mode === 'live-runtime');
      assert.equal(options.capabilities.includes('terminal-local-persistence-v1'), mode === 'snapshot-only');
      const transport = options.createTransport(identity);
      assert.equal(transport.options.executable, process.execPath);
      assert.equal(transport.options.entryPoint, entryPoint);
      assert.deepEqual(transport.options.args, [hash(images[0]), hash(fs.readFileSync(manifestFile)), hash(entry), hash(worker)]);
      assert.deepEqual(transport.options.env, { FACTORY_TEST_ENV: 'retained',
        ...(runtimeName === 'electron' ? { ELECTRON_RUN_AS_NODE: '1' } : {}) });
      assert.strictEqual(transport.parentControl.scheduler, options.scheduler);
      assert.deepEqual(transport.parentControl.expectedNativeResourceIds,
        ['conpty-owner', 'conpty-process', 'conpty-input', 'conpty-source']);
      assert.equal(forbidden, 0);
    }
    const mutations = [
      m => { m.schemaVersion = 2; }, m => { m.profile = 'linux-owner-v1-candidate'; },
      m => { m.platform = 'darwin'; }, m => { m.arch = arch === 'arm64' ? 'x64' : 'arm64'; },
      ...Object.keys(runtime).map(key => m => { m.runtime[key] = 'mismatch'; }),
      m => { m.binary.file = '../conpty.node'; }, m => { m.binary.sha256 = '0'.repeat(64); },
      m => { m.dependencies.pop(); }, m => { m.dependencies.reverse(); },
      m => { m.dependencies[0].file = '../conpty.dll'; }, m => { m.dependencies[1].sha256 = '0'.repeat(64); },
      m => { m.exports.pop(); }, ...sourceKeys.map(key => m => { delete m.sources[key]; }),
      m => { m.verification.compiled = false; }, m => { m.verification.nativeLoaded = true; },
      m => { m.verification.nativeCalls = true; }, m => { m.verification.productValidated = true; }
    ];
    for (const mutate of mutations) {
      const changed = structuredClone(base); mutate(changed); writeManifest(changed);
      assert.throws(() => resolveWindowsExecutionProviderAssets(dist));
    }
    writeManifest(base);
    for (const [index, original] of images.entries()) {
      for (const mutate of [
        bytes => bytes.writeUInt16LE(0, 0), bytes => bytes.writeUInt32LE(0xffffffff, 0x3c),
        bytes => bytes.writeUInt32LE(0, 64), bytes => bytes.writeUInt16LE(0x14c, 68),
        bytes => bytes.writeUInt16LE(0xffff, 84), bytes => bytes.writeUInt16LE(0, 84),
        bytes => bytes.writeUInt16LE(index === 2 ? 0x2002 : 0x0002, 86),
        bytes => bytes.writeUInt16LE(index === 2 ? 0 : 0x2000, 86), bytes => bytes.writeUInt16LE(0x10b, 88)
      ]) {
        const incompatible = Buffer.from(original); mutate(incompatible);
        fs.writeFileSync(path.join(assetDirectory, assetNames[index]), incompatible);
        const changed = structuredClone(base);
        (index === 0 ? changed.binary : changed.dependencies[index - 1]).sha256 = hash(incompatible);
        writeManifest(changed);
        assert.throws(() => resolveWindowsExecutionProviderAssets(dist), /DOS|PE/);
      }
      fs.writeFileSync(path.join(assetDirectory, assetNames[index]), original);
      writeManifest(base);
    }
    const prepared = createWindowsExecutionOwnerOptions({ extensionRoot: root, mode: 'snapshot-only' });
    for (const [file, original] of [[entryPoint, entry], [workerPath, worker]]) {
      fs.appendFileSync(file, '// changed');
      assert.throws(() => prepared.createTransport(identity), /changed after owner preparation/);
      fs.writeFileSync(file, original);
    }
    const changed = structuredClone(base); changed.sources.ownerSha256 = 'b'.repeat(64); writeManifest(changed);
    assert.throws(() => prepared.createTransport(identity), /changed after owner preparation/);
    writeManifest(base);
    for (const [index, original] of images.entries()) {
      const file = path.join(assetDirectory, assetNames[index]);
      fs.appendFileSync(file, 'changed');
      assert.throws(() => prepared.createTransport(identity), /content mismatch/);
      fs.writeFileSync(file, original);
    }
    fs.unlinkSync(workerPath);
    fs.mkdirSync(workerPath);
    assert.throws(() => resolveWindowsExecutionProviderAssets(dist), /Invalid Windows candidate asset/);
    fs.rmdirSync(workerPath);
    fs.writeFileSync(workerPath, worker);
    const relocated = path.join(assetDirectory, 'relocated-conpty');
    fs.renameSync(conptyDirectory, relocated);
    fs.symlinkSync(relocated, conptyDirectory, 'junction');
    assert.throws(() => resolveWindowsExecutionProviderAssets(dist), /must not be redirected/);
    fs.unlinkSync(conptyDirectory);
    fs.renameSync(relocated, conptyDirectory);
    const compiled = await loadFactory(targetProcess, { executions: 10, starting: 2 });
    const inherited = compiled.createWindowsExecutionOwnerOptions({ extensionRoot: root, mode: 'live-runtime' });
    assert.deepEqual(inherited.admissionLimits, { executions: 10, starting: 2 });
    const admissionLimits = { executions: 3, starting: 1 };
    const explicit = compiled.createWindowsExecutionOwnerOptions({ extensionRoot: root, mode: 'snapshot-only', admissionLimits });
    admissionLimits.executions = 99;
    assert.deepEqual(explicit.admissionLimits, { executions: 3, starting: 1 });
    assert.ok(Object.isFrozen(explicit.admissionLimits));
    for (const admissionLimits of [null, { executions: 0, starting: 1 }, { executions: 1, starting: 2 }]) {
      assert.throws(() => compiled.createWindowsExecutionOwnerOptions({ extensionRoot: root,
        mode: 'snapshot-only', admissionLimits }), /admission/);
    }
    for (const unsupported of [{ platform: 'linux', arch }, { platform: 'win32', arch: 'ia32' }]) {
      const rejected = await loadFactory({ ...targetProcess, ...unsupported });
      assert.throws(() => rejected.resolveWindowsExecutionProviderAssets(dist), /require Windows/);
    }
    assert.equal(forbidden, 0);
    passed++;
  }
  console.log(`Windows owner factory: ${passed} architecture/runtime contracts passed (mock platform, synthetic PE; no native loads or provider starts).`);
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
