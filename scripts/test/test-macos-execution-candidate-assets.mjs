import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCandidateAssets, candidateAssetRelativePath, candidateCompilerArguments, helperCompilerArguments,
  importCandidateAssets, readCandidateAssets, validateCandidateHeaders,
  validateCandidateManifest } from '../build/macos-execution-candidate-assets.mjs';
import { resolveExecutionBuildSelection } from '../build/build.mjs';
import { MACOS_EXECUTION_EXPORTS, NODE_PTY_UNIX_SHA256,
  NODE_PTY_SPAWN_HELPER_SHA256 } from '../build/macos-execution-provider-patch.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dsc-macos-assets-test-')));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const fileDigest = relative => digest(fs.readFileSync(path.join(root, relative)));
const profile = 'macos-owner-v1-candidate';
// Synthetic headers establish only validation behavior, never machine-code validity.
function machO(arch, filetype) {
  const bytes = Buffer.alloc(64);
  bytes.writeUInt32LE(0xfeedfacf, 0);
  bytes.writeUInt32LE(arch === 'arm64' ? 0x0100000c : 0x01000007, 4);
  bytes.writeUInt32LE(filetype, 12);
  return bytes;
}
function fixture(arch = 'arm64') {
  const binary = machO(arch, 8);
  const helper = machO(arch, 2);
  return { binary, helper, manifest: { schemaVersion: 1, profile, platform: 'darwin', arch,
    runtime: { name: 'node', version: '22.23.2', node: '22.23.2', modules: '127', napi: '10' },
    binary: { file: 'execution-owner.node', sha256: digest(binary) },
    helper: { file: 'spawn-helper', sha256: digest(helper) }, exports: [...MACOS_EXECUTION_EXPORTS],
    sources: {
      ownerSha256: fileDigest('extensions/vscode/dev-session-canvas/native/macos-execution-owner.h'),
      sharedOwnerSha256: fileDigest('extensions/vscode/dev-session-canvas/native/unix-execution-owner.h'),
      patchSha256: fileDigest('scripts/build/macos-execution-provider-patch.mjs'),
      nodePtySha256: NODE_PTY_UNIX_SHA256, helperSourceSha256: NODE_PTY_SPAWN_HELPER_SHA256,
      patchedSha256: '1'.repeat(64), headersSha256: '2'.repeat(64), nodeAddonApiSha256: '3'.repeat(64)
    }, verification: { compiled: true, nativeLoaded: false, nativeCalls: false, productValidated: false } } };
}
function writeFixture(name, value = fixture()) {
  const directory = path.join(temporary, name);
  fs.mkdirSync(directory);
  fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(value.manifest));
  fs.writeFileSync(path.join(directory, 'execution-owner.node'), value.binary);
  fs.writeFileSync(path.join(directory, 'spawn-helper'), value.helper, { mode: 0o755 });
  fs.chmodSync(path.join(directory, 'spawn-helper'), 0o755);
  return directory;
}
const candidateArgs = source => [`--execution-profile=${profile}`, `--execution-assets=${source}`];
let passed = 0;
const test = async (name, run) => { await run(); passed++; console.log(`PASS ${name}`); };

try {
  await test('both Mach-O architectures and Node/Electron manifests remain compile-only', () => {
    for (const arch of ['arm64', 'x64']) {
      const { manifest, binary, helper } = fixture(arch);
      assert.strictEqual(validateCandidateManifest(manifest, binary, helper), manifest);
      manifest.runtime = { ...manifest.runtime, name: 'electron', version: '39.8.7' };
      assert.strictEqual(validateCandidateManifest(manifest, binary, helper), manifest);
      assert.equal(candidateAssetRelativePath(arch), `native/macos-execution-candidate/darwin-${arch}`);
    }
    assert.throws(() => candidateAssetRelativePath('ia32'));
  });
  await test('foreign targets stale sources incomplete ABI and unproved runtime claims reject', () => {
    const { manifest, binary, helper } = fixture();
    for (const mutate of [
      m => { m.profile = 'linux-owner-v1-candidate'; }, m => { m.platform = 'linux'; },
      m => { m.arch = 'ia32'; }, m => { m.runtime.name = 'browser'; },
      m => { m.runtime.version = '20.0.0'; }, m => { m.runtime.node = ''; },
      m => { m.runtime.modules = ''; }, m => { m.runtime.napi = undefined; },
      m => { m.binary.file = '../external.node'; }, m => { m.helper.file = '../helper'; },
      m => { m.exports.shift(); }, m => { m.sources.ownerSha256 = '0'.repeat(64); },
      m => { m.sources.sharedOwnerSha256 = '0'.repeat(64); }, m => { delete m.sources.sharedOwnerSha256; },
      m => { m.sources.patchSha256 = '0'.repeat(64); }, m => { m.sources.nodePtySha256 = '0'.repeat(64); },
      m => { m.sources.helperSourceSha256 = '0'.repeat(64); }, m => { m.sources.headersSha256 = ''; },
      m => { m.verification.nativeLoaded = true; }, m => { m.verification.nativeCalls = true; },
      m => { m.verification.productValidated = true; }
    ]) {
      const altered = structuredClone(manifest);
      mutate(altered);
      assert.throws(() => validateCandidateManifest(altered, binary, helper));
    }
  });
  await test('both asset hashes architectures and Mach-O file types are independently checked', () => {
    const { manifest, binary, helper } = fixture();
    for (const asset of ['binary', 'helper']) {
      const bytes = Buffer.from(asset === 'binary' ? binary : helper);
      bytes[63] = 1;
      const invoke = m => validateCandidateManifest(m, asset === 'binary' ? bytes : binary, asset === 'helper' ? bytes : helper);
      assert.throws(() => invoke(manifest), /hash/);
      for (const [offset, value] of [[0, 0], [4, 0x01000007], [12, asset === 'binary' ? 2 : 8]]) {
        const original = bytes.readUInt32LE(offset);
        bytes.writeUInt32LE(value, offset);
        const altered = structuredClone(manifest);
        altered[asset].sha256 = digest(bytes);
        assert.throws(() => invoke(altered), /Mach-O/);
        bytes.writeUInt32LE(original, offset);
      }
    }
  });
  await test('import stages only exact assets and preserves executable helper without native loading', () => {
    for (const arch of ['arm64', 'x64']) {
      const value = fixture(arch);
      const source = writeFixture(`source-${arch}`, value);
      const dist = path.join(temporary, `dist-${arch}`);
      fs.mkdirSync(dist);
      fs.writeFileSync(path.join(source, 'ignored-input.cc'), 'build input only');
      assert.throws(() => importCandidateAssets({ source, dist }), /macos-execution-provider/);
      fs.writeFileSync(path.join(dist, 'macos-execution-provider.js'), '/* controlled worker boundary */');
      const imported = importCandidateAssets({ source, dist });
      assert.equal(imported.directory, path.join(dist, candidateAssetRelativePath(arch)));
      assert.deepEqual(fs.readdirSync(imported.directory).sort(), ['execution-owner.node', 'manifest.json', 'spawn-helper']);
      assert.deepEqual(fs.readFileSync(path.join(imported.directory, 'execution-owner.node')), value.binary);
      assert.deepEqual(fs.readFileSync(path.join(imported.directory, 'spawn-helper')), value.helper);
      assert(fs.statSync(path.join(imported.directory, 'spawn-helper')).mode & 0o111);
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(imported.directory, 'manifest.json'))), value.manifest);
      assert.throws(() => importCandidateAssets({ source, dist }), /EEXIST/);
    }
  });
  await test('temporary directory aliases retain canonical import and build-selection paths', async () => {
    const source = writeFixture('source-through-alias');
    const dist = path.join(temporary, 'dist-through-alias');
    fs.mkdirSync(dist);
    fs.writeFileSync(path.join(dist, 'macos-execution-provider.js'), '/* controlled worker boundary */');
    const alias = path.join(temporary, 'temporary-alias');
    fs.symlinkSync(temporary, alias, 'dir');
    const sourceAlias = path.join(alias, path.basename(source));
    const distAlias = path.join(alias, path.basename(dist));
    assert.notEqual(sourceAlias, fs.realpathSync(sourceAlias));
    assert.equal(readCandidateAssets(sourceAlias).directory, source);
    assert.equal(importCandidateAssets({ source: sourceAlias, dist: distAlias }).directory,
      path.join(dist, candidateAssetRelativePath('arm64')));
    assert.deepEqual(await resolveExecutionBuildSelection(candidateArgs(sourceAlias), '/missing/dist'),
      { profile, source, admissionLimits: { executions: 2, starting: 1 } });
  });
  await test('nonexecutable or redirected helper is rejected before import', () => {
    const source = writeFixture('helper-validation');
    const helper = path.join(source, 'spawn-helper');
    fs.chmodSync(helper, 0o644);
    assert.throws(() => readCandidateAssets(source), /executable/);
    fs.renameSync(helper, `${helper}.original`);
    fs.symlinkSync(`${helper}.original`, helper);
    assert.throws(() => readCandidateAssets(source), /regular/);
  });
  await test('addon and helper compiler commands use selected SDK and matching architecture', () => {
    for (const [arch, compilerArch] of [['arm64', 'arm64'], ['x64', 'x86_64']]) {
      const args = candidateCompilerArguments({ arch, sdk: '/sdk', headers: '/headers', addonRoot: '/addon',
        inputs: '/inputs', source: '/inputs/pty.cc', binary: '/output/execution-owner.node' });
      assert.deepEqual(args, ['-std=c++17', '-bundle', '-undefined', 'dynamic_lookup', '-fPIC', '-pthread', '-fexceptions',
        '-DNAPI_CPP_EXCEPTIONS', '-DNODE_GYP_MODULE_NAME=pty', '-arch', compilerArch, '-isysroot', '/sdk',
        '-I', '/headers', '-I', '/addon', '-I', '/inputs', '/inputs/pty.cc', '-o', '/output/execution-owner.node']);
      assert.deepEqual(helperCompilerArguments({ arch, sdk: '/sdk', source: '/inputs/helper.cc', binary: '/output/spawn-helper' }),
        ['-std=c++17', '-arch', compilerArch, '-isysroot', '/sdk', '/inputs/helper.cc', '-o', '/output/spawn-helper']);
    }
    assert.throws(() => helperCompilerArguments({ arch: 'ia32', sdk: '/sdk' }), /target/);
    assert.throws(() => helperCompilerArguments({ arch: 'arm64', sdk: 'relative' }), /absolute/);
  });
  await test('headers require actual Node version and module ABI including Electron builds', () => {
    const headers = path.join(temporary, 'headers');
    fs.mkdirSync(headers);
    const content = '#define NODE_MAJOR_VERSION 22\n#define NODE_MINOR_VERSION 23\n#define NODE_PATCH_VERSION 2\n#define NODE_MODULE_VERSION 127\n';
    fs.writeFileSync(path.join(headers, 'node_version.h'), content);
    const runtime = { name: 'electron', version: '39.8.7', node: '22.23.2', modules: '127' };
    assert.doesNotThrow(() => validateCandidateHeaders(headers, runtime));
    assert.throws(() => validateCandidateHeaders(headers, { ...runtime, node: '22.22.1' }), /Node version/);
    assert.throws(() => validateCandidateHeaders(headers, { ...runtime, modules: '140' }), /module ABI/);
    fs.writeFileSync(path.join(headers, 'node_version.h'), `${content}#define NODE_MODULE_VERSION 127\n`);
    assert.throws(() => validateCandidateHeaders(headers, runtime), /ambiguous/);
  });
  await test('foreign build host rejects before output or invoking a compiler', () => {
    if (process.platform === 'darwin') return;
    const output = path.join(temporary, 'never-compiled');
    assert.throws(() => buildCandidateAssets({ output, headers: '/not-read', dependencyRoot: '/not-read', compiler: '/not-run' }), /macOS/);
    assert.equal(fs.existsSync(output), false);
  });
  await test('explicit mac build selection accepts offline assets and immutable admission', async () => {
    for (const arch of ['arm64', 'x64']) {
      const source = writeFixture(`selection-${arch}`, fixture(arch));
      const selection = await resolveExecutionBuildSelection([...candidateArgs(source), '--execution-admission=10:1'], '/missing/dist');
      assert.deepEqual(selection, { profile, source, admissionLimits: { executions: 10, starting: 1 } });
      assert(Object.isFrozen(selection) && Object.isFrozen(selection.admissionLimits));
      const value = fixture(arch);
      value.manifest.runtime = { ...value.manifest.runtime, name: 'electron', version: '39.8.7' };
      fs.writeFileSync(path.join(source, 'manifest.json'), JSON.stringify(value.manifest));
      assert.deepEqual(await resolveExecutionBuildSelection(candidateArgs(source), '/missing/dist'),
        { profile, source, admissionLimits: { executions: 2, starting: 1 } });
    }
  });
  await test('unpaired watch wrong profile and cleared-dist inputs reject without clearing dist', async () => {
    const source = writeFixture('rejected-selection');
    const dist = path.join(temporary, 'preserved-dist');
    fs.mkdirSync(dist);
    fs.writeFileSync(path.join(dist, 'retained.txt'), 'unchanged');
    for (const args of [[`--execution-profile=${profile}`], [`--execution-assets=${source}`],
      [...candidateArgs(source), '--watch'], ['--execution-profile=linux-owner-v1-candidate', `--execution-assets=${source}`],
      [...candidateArgs(source), '--execution-admission=0:1'], candidateArgs(dist)]) {
      await assert.rejects(resolveExecutionBuildSelection(args, dist));
    }
    const inside = path.join(dist, 'assets');
    fs.cpSync(source, inside, { recursive: true });
    await assert.rejects(resolveExecutionBuildSelection(candidateArgs(inside), dist), /outside/);
    fs.chmodSync(path.join(source, 'spawn-helper'), 0o644);
    await assert.rejects(resolveExecutionBuildSelection(candidateArgs(source), dist), /executable/);
    assert.equal(fs.readFileSync(path.join(dist, 'retained.txt'), 'utf8'), 'unchanged');
    assert.deepEqual(await resolveExecutionBuildSelection([], dist), {});
    assert.deepEqual(await resolveExecutionBuildSelection(['--production'], dist), {});
  });
  await test('formal macOS entry is bundled but asset import stays profile-selected', () => {
    const build = fs.readFileSync(path.join(root, 'scripts/build/build.mjs'), 'utf8');
    assert(build.includes('src/panel/macosExecutionProviderMain.ts'));
    assert(build.includes("fromMainExtensionDist('macos-execution-provider.js')"));
    assert(build.includes('esbuild.build(macosExecutionProviderConfig)'));
    assert(build.includes('macosExecutionProviderContext.watch()'));
    assert(build.includes("selection.profile === 'macos-owner-v1-candidate' ? importMacosCandidateAssets : importLinuxCandidateAssets"));
  });
  console.log(`macOS candidate assets: ${passed}/${passed} pure cases passed (synthetic binaries, no compiler, addon load or helper execution).`);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
