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
function machO(arch, filetype, command = 0x32) {
  const bytes = Buffer.alloc(64);
  bytes.writeUInt32LE(0xfeedfacf, 0);
  bytes.writeUInt32LE(arch === 'arm64' ? 0x0100000c : 0x01000007, 4);
  bytes.writeUInt32LE(filetype, 12);
  bytes.writeUInt32LE(1, 16);
  bytes.writeUInt32LE(command === 0x32 ? 24 : 16, 20);
  bytes.writeUInt32LE(command, 32);
  bytes.writeUInt32LE(command === 0x32 ? 24 : 16, 36);
  if (command === 0x32) bytes.writeUInt32LE(1, 40);
  bytes.writeUInt32LE(arch === 'arm64' ? 0x000b0000 : 0x000a0d00, command === 0x32 ? 44 : 40);
  bytes.writeUInt32LE(0x001a0500, command === 0x32 ? 48 : 44);
  return bytes;
}
function withCommands(bytes, commands) {
  const header = Buffer.from(bytes.subarray(0, 32));
  header.writeUInt32LE(commands.length, 16);
  header.writeUInt32LE(commands.reduce((size, command) => size + command.length, 0), 20);
  return Buffer.concat([header, ...commands]);
}
function replaceAsset(value, asset, bytes) {
  value[asset] = bytes;
  value.manifest[asset].sha256 = digest(bytes);
  return value;
}
function fixture(arch = 'arm64', command = 0x32) {
  const binary = machO(arch, 8, command);
  const helper = machO(arch, 2, command);
  return { binary, helper, manifest: { schemaVersion: 2, profile, platform: 'darwin', arch,
    requirements: { napi: 8, macos: { deploymentTarget: arch === 'arm64' ? '11.0' : '10.13' } },
    runtime: { name: 'node', version: '22.23.2', node: '22.23.2', modules: '127', napi: '10' },
    binary: { file: 'execution-owner.node', sha256: digest(binary) },
    helper: { file: 'spawn-helper', sha256: digest(helper) }, exports: [...MACOS_EXECUTION_EXPORTS],
    sources: {
      ownerSha256: fileDigest('extensions/vscode/dev-session-canvas/native/macos-execution-owner.h'),
      sharedOwnerSha256: fileDigest('extensions/vscode/dev-session-canvas/native/unix-execution-owner.h'),
      patchSha256: fileDigest('scripts/build/macos-execution-provider-patch.mjs'),
      nodePtySha256: NODE_PTY_UNIX_SHA256, helperSourceSha256: NODE_PTY_SPAWN_HELPER_SHA256,
      helperPatchedSha256: '4'.repeat(64),
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
  await test('both assets require their fixed minimum macOS target rather than the build SDK', () => {
    for (const arch of ['arm64', 'x64']) {
      for (const command of [0x32, 0x24]) {
        const value = fixture(arch, command);
        assert.strictEqual(validateCandidateManifest(value.manifest, value.binary, value.helper), value.manifest);
        for (const asset of ['binary', 'helper']) {
          const expectedVersion = arch === 'arm64' ? 0x000b0000 : 0x000a0d00;
          for (const version of [0x001a0000, expectedVersion - 0x100, expectedVersion + 1]) {
            const invalid = fixture(arch, command);
            const bytes = Buffer.from(invalid[asset]);
            bytes.writeUInt32LE(version, command === 0x32 ? 44 : 40);
            replaceAsset(invalid, asset, bytes);
            assert.throws(() => validateCandidateManifest(invalid.manifest, invalid.binary, invalid.helper), /Mach-O.*deployment target/);
          }
        }
      }
    }
  });
  await test('Mach-O target scanning accepts bounded tool records and unrelated load commands', () => {
    const unrelated = Buffer.alloc(24);
    unrelated.writeUInt32LE(0x1b, 0);
    unrelated.writeUInt32LE(24, 4);
    for (const arch of ['arm64', 'x64']) {
      for (const command of [0x32, 0x24]) {
        for (const before of [false, true]) {
          const value = fixture(arch, command);
          for (const asset of ['binary', 'helper']) {
            let target = value[asset].subarray(32, command === 0x32 ? 56 : 48);
            if (command === 0x32) {
              target = Buffer.concat([target, Buffer.alloc(8)]);
              target.writeUInt32LE(32, 4);
              target.writeUInt32LE(1, 20);
              target.writeUInt32LE(3, 24);
              target.writeUInt32LE(0x001a0000, 28);
            }
            replaceAsset(value, asset, withCommands(value[asset], before ? [unrelated, target] : [target, unrelated]));
          }
          assert.strictEqual(validateCandidateManifest(value.manifest, value.binary, value.helper), value.manifest);
        }
      }
    }
  });
  await test('both assets reject wrong platforms missing targets duplicates and malformed load-command bounds', () => {
    const mutations = [
      ['wrong platform', bytes => { bytes.writeUInt32LE(2, 40); }],
      ['missing target', bytes => { bytes.writeUInt32LE(0x1b, 32); }],
      ['empty commands', bytes => { bytes.writeUInt32LE(0, 16); bytes.writeUInt32LE(0, 20); }],
      ['command count exceeds table', bytes => { bytes.writeUInt32LE(4, 16); }],
      ['table exceeds file', bytes => { bytes.writeUInt32LE(40, 20); }],
      ['unconsumed command bytes', bytes => { bytes.writeUInt32LE(32, 20); }],
      ['truncated command header', bytes => { bytes.writeUInt32LE(2, 16); bytes.writeUInt32LE(28, 20); }],
      ['zero command size', bytes => { bytes.writeUInt32LE(0, 36); }],
      ['short command header', bytes => { bytes.writeUInt32LE(4, 36); }],
      ['unaligned command size', bytes => { bytes.writeUInt32LE(23, 36); }],
      ['command exceeds table', bytes => { bytes.writeUInt32LE(32, 36); }],
      ['short build version', bytes => { bytes.writeUInt32LE(16, 36); }],
      ['truncated tools', bytes => { bytes.writeUInt32LE(1, 52); }],
      ['wrong legacy command size', bytes => { bytes.writeUInt32LE(0x24, 32); }]
    ];
    for (const asset of ['binary', 'helper']) {
      for (const [name, mutate] of mutations) {
        const value = fixture();
        const bytes = Buffer.from(value[asset]);
        mutate(bytes);
        replaceAsset(value, asset, bytes);
        assert.throws(() => validateCandidateManifest(value.manifest, value.binary, value.helper), /Mach-O/, `${asset}: ${name}`);
      }
      for (const duplicate of ['identical', 'conflicting', 'legacy']) {
        const value = fixture();
        const first = value[asset].subarray(32, 56);
        const second = duplicate === 'legacy' ? machO('arm64', asset === 'binary' ? 8 : 2, 0x24).subarray(32, 48)
          : Buffer.from(first);
        if (duplicate === 'conflicting') second.writeUInt32LE(0x001a0000, 12);
        replaceAsset(value, asset, withCommands(value[asset], [first, second]));
        assert.throws(() => validateCandidateManifest(value.manifest, value.binary, value.helper), /Mach-O/, `${asset}: ${duplicate}`);
      }
    }
  });
  await test('a valid macOS target cannot coexist with an iPhoneOS tvOS or watchOS minimum version', () => {
    for (const asset of ['binary', 'helper']) {
      for (const command of [0x25, 0x2f, 0x30]) {
        const value = fixture();
        const macos = value[asset].subarray(32, 56);
        const foreign = Buffer.from(machO('arm64', asset === 'binary' ? 8 : 2, 0x24).subarray(32, 48));
        foreign.writeUInt32LE(command, 0);
        replaceAsset(value, asset, withCommands(value[asset], [macos, foreign]));
        assert.throws(() => validateCandidateManifest(value.manifest, value.binary, value.helper), /Mach-O.*platform/);
      }
    }
  });
  await test('foreign targets stale sources incomplete ABI and unproved runtime claims reject', () => {
    const { manifest, binary, helper } = fixture();
    for (const mutate of [
      m => { m.profile = 'linux-owner-v1-candidate'; }, m => { m.platform = 'linux'; },
      m => { m.schemaVersion = 1; }, m => { m.requirements.napi = 10; },
      m => { m.requirements.macos.deploymentTarget = '26.0'; },
      m => { m.arch = 'ia32'; }, m => { m.runtime.name = 'browser'; },
      m => { m.runtime.version = '20.0.0'; }, m => { m.runtime.node = ''; },
      m => { m.runtime.modules = ''; }, m => { m.runtime.napi = undefined; },
      m => { m.binary.file = '../external.node'; }, m => { m.helper.file = '../helper'; },
      m => { m.exports.shift(); }, m => { m.sources.ownerSha256 = '0'.repeat(64); },
      m => { m.sources.sharedOwnerSha256 = '0'.repeat(64); }, m => { delete m.sources.sharedOwnerSha256; },
      m => { m.sources.patchSha256 = '0'.repeat(64); }, m => { m.sources.nodePtySha256 = '0'.repeat(64); },
      m => { m.sources.helperSourceSha256 = '0'.repeat(64); }, m => { delete m.sources.helperPatchedSha256; },
      m => { m.sources.helperPatchedSha256 = 'not-a-hash'; }, m => { m.sources.headersSha256 = ''; },
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
  await test('old macOS 26 targets reject before read or import can stage either asset', () => {
    for (const asset of ['binary', 'helper']) {
      const value = fixture();
      const bytes = Buffer.from(value[asset]);
      bytes.writeUInt32LE(0x001a0000, 44);
      replaceAsset(value, asset, bytes);
      const source = writeFixture(`old-target-${asset}`, value);
      const dist = path.join(temporary, `old-target-dist-${asset}`);
      fs.mkdirSync(dist);
      fs.writeFileSync(path.join(dist, 'macos-execution-provider.js'), '/* controlled worker boundary */');
      assert.throws(() => readCandidateAssets(source), /Mach-O.*deployment target/);
      assert.throws(() => importCandidateAssets({ source, dist }), /Mach-O.*deployment target/);
      assert.equal(fs.existsSync(path.join(dist, candidateAssetRelativePath('arm64'))), false);
      assert.deepEqual(fs.readFileSync(path.join(source, value.manifest[asset].file)), bytes);
    }
  });
  await test('addon and helper compiler commands use selected SDK and matching architecture', () => {
    for (const [arch, compilerArch] of [['arm64', 'arm64'], ['x64', 'x86_64']]) {
      const args = candidateCompilerArguments({ arch, sdk: '/sdk', headers: '/headers', addonRoot: '/addon',
        inputs: '/inputs', source: '/inputs/pty.cc', binary: '/output/execution-owner.node' });
      assert.deepEqual(args, ['-std=c++17', '-bundle', '-undefined', 'dynamic_lookup', '-fPIC', '-pthread', '-fexceptions',
        '-DNAPI_VERSION=8', '-DNAPI_CPP_EXCEPTIONS', '-DNODE_GYP_MODULE_NAME=pty', '-arch', compilerArch, '-isysroot', '/sdk',
        `-mmacosx-version-min=${arch === 'arm64' ? '11.0' : '10.13'}`,
        '-I', '/headers', '-I', '/addon', '-I', '/inputs', '/inputs/pty.cc', '-o', '/output/execution-owner.node']);
      assert.deepEqual(helperCompilerArguments({ arch, sdk: '/sdk', source: '/inputs/helper.cc', binary: '/output/spawn-helper' }),
        ['-std=c++17', '-arch', compilerArch, '-isysroot', '/sdk',
          `-mmacosx-version-min=${arch === 'arm64' ? '11.0' : '10.13'}`, '/inputs/helper.cc', '-o', '/output/spawn-helper']);
    }
    assert.throws(() => helperCompilerArguments({ arch: 'ia32', sdk: '/sdk' }), /target/);
    assert.throws(() => helperCompilerArguments({ arch: 'arm64', sdk: 'relative' }), /absolute/);
  });
  await test('build-host deployment target cannot replace the fixed addon or helper flags', () => {
    const previous = process.env.MACOSX_DEPLOYMENT_TARGET;
    process.env.MACOSX_DEPLOYMENT_TARGET = '26.0';
    try {
      for (const arch of ['arm64', 'x64']) {
        const target = `-mmacosx-version-min=${arch === 'arm64' ? '11.0' : '10.13'}`;
        const options = { arch, sdk: '/sdk', headers: '/headers', addonRoot: '/addon', inputs: '/inputs',
          source: '/source.cc', binary: '/output' };
        for (const args of [candidateCompilerArguments(options), helperCompilerArguments(options)]) {
          assert.deepEqual(args.filter(arg => arg.startsWith('-mmacosx-version-min=')), [target]);
        }
      }
    } finally {
      if (previous === undefined) delete process.env.MACOSX_DEPLOYMENT_TARGET;
      else process.env.MACOSX_DEPLOYMENT_TARGET = previous;
    }
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
