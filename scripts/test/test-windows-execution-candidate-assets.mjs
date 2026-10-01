import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCandidateAssets, candidateAssetRelativePath, candidateCompilerArguments,
  importCandidateAssets, readCandidateAssets, validateCandidateHeaders, validateCandidateManifest,
  NODE_PTY_PATH_UTIL_SHA256, NODE_PTY_WINDOWS_HEADERS_SHA256,
  NODE_GYP_DELAY_LOAD_HOOK_SHA256, NODE_GYP_DELAY_LOAD_HOOK_CRLF_SHA256,
  validateCandidateDelayLoadHook } from '../build/windows-execution-candidate-assets.mjs';
import { WINDOWS_EXECUTION_EXPORTS, NODE_PTY_CONPTY_SHA256 } from '../build/windows-execution-provider-patch.mjs';
import { resolveExecutionBuildSelection } from '../build/build.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dsc-windows-assets-test-')));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const fileDigest = relative => digest(fs.readFileSync(path.join(root, relative)));
const profile = 'windows-owner-v1-candidate';
const dependencyFiles = ['conpty/conpty.dll', 'conpty/OpenConsole.exe'];
// Synthetic headers prove validation behavior, never machine-code validity or platform support.
function pe(arch, dll) {
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
function fixture(arch = 'x64') {
  const binary = pe(arch, true);
  const dependencies = [pe(arch, true), pe(arch, false)];
  return { binary, dependencies, manifest: { schemaVersion: 1, profile, platform: 'win32', arch,
    runtime: { name: 'node', version: '22.23.2', node: '22.23.2', modules: '127', napi: '10' },
    binary: { file: 'conpty.node', sha256: digest(binary) },
    dependencies: dependencyFiles.map((file, index) => ({ file, sha256: digest(dependencies[index]) })),
    exports: [...WINDOWS_EXECUTION_EXPORTS], sources: {
      ownerSha256: fileDigest('extensions/vscode/dev-session-canvas/native/windows-execution-owner.h'),
      patchSha256: fileDigest('scripts/build/windows-execution-provider-patch.mjs'),
      nodePtySha256: NODE_PTY_CONPTY_SHA256, pathUtilSha256: NODE_PTY_PATH_UTIL_SHA256,
      windowsHeadersSha256: NODE_PTY_WINDOWS_HEADERS_SHA256, patchedSha256: '1'.repeat(64),
      headersSha256: '2'.repeat(64), nodeAddonApiSha256: '3'.repeat(64), nodeLibSha256: '4'.repeat(64),
      delayLoadHookSha256: NODE_GYP_DELAY_LOAD_HOOK_SHA256
    }, verification: { compiled: true, nativeLoaded: false, nativeCalls: false, productValidated: false } } };
}
function writeFixture(name, value = fixture()) {
  const directory = path.join(temporary, name);
  fs.mkdirSync(directory);
  fs.mkdirSync(path.join(directory, 'conpty'));
  fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(value.manifest));
  fs.writeFileSync(path.join(directory, 'conpty.node'), value.binary);
  dependencyFiles.forEach((file, index) => fs.writeFileSync(path.join(directory, file), value.dependencies[index]));
  return directory;
}
let passed = 0;
const test = async (name, run) => { await run(); passed++; console.log(`PASS ${name}`); };
const candidateArgs = source => [`--execution-profile=${profile}`, `--execution-assets=${source}`];

try {
  await test('only the two fixed LF and CRLF hook byte forms are accepted and recorded unchanged', () => {
    const suffix = 'node_modules/npm/node_modules/node-gyp/src/win_delay_load_hook.cc';
    const hookPath = [path.join(path.dirname(process.execPath), suffix),
      path.resolve(path.dirname(process.execPath), '../lib', suffix)].find(file => fs.existsSync(file));
    assert(hookPath, 'The fixed Node input must include its npm node-gyp hook');
    const lf = fs.readFileSync(hookPath, 'utf8').replaceAll('\r\n', '\n');
    const crlf = lf.replaceAll('\n', '\r\n');
    for (const [source, expected] of [[lf, NODE_GYP_DELAY_LOAD_HOOK_SHA256], [crlf, NODE_GYP_DELAY_LOAD_HOOK_CRLF_SHA256]]) {
      assert.equal(validateCandidateDelayLoadHook(Buffer.from(source)), expected);
      const { manifest, binary, dependencies } = fixture();
      manifest.sources.delayLoadHookSha256 = expected;
      validateCandidateManifest(manifest, binary, dependencies);
      assert.equal(manifest.sources.delayLoadHookSha256, expected);
    }
    for (const changed of [lf.replace('\n', '\r\n'), `${lf} `]) {
      assert.throws(() => validateCandidateDelayLoadHook(Buffer.from(changed)), /Unexpected node-gyp/);
      const { manifest, binary, dependencies } = fixture();
      manifest.sources.delayLoadHookSha256 = digest(changed);
      assert.throws(() => validateCandidateManifest(manifest, binary, dependencies), /Unexpected node-gyp/);
    }
  });
  await test('both PE architectures and Node/Electron manifests remain compile-only', () => {
    for (const arch of ['x64', 'arm64']) {
      const { manifest, binary, dependencies } = fixture(arch);
      assert.strictEqual(validateCandidateManifest(manifest, binary, dependencies), manifest);
      manifest.runtime = { ...manifest.runtime, name: 'electron', version: '39.8.7' };
      assert.strictEqual(validateCandidateManifest(manifest, binary, dependencies), manifest);
      assert.equal(candidateAssetRelativePath(arch), `native/windows-execution-candidate/win32-${arch}`);
    }
    assert.throws(() => candidateAssetRelativePath('ia32'));
  });
  await test('foreign targets stale sources incomplete ABI and runtime claims reject', () => {
    const { manifest, binary, dependencies } = fixture();
    for (const mutate of [
      m => { m.profile = 'linux-owner-v1-candidate'; }, m => { m.platform = 'linux'; },
      m => { m.arch = 'ia32'; }, m => { m.runtime.name = 'browser'; },
      m => { m.runtime.version = '20.0.0'; }, m => { m.runtime.node = ''; },
      m => { m.runtime.modules = ''; }, m => { m.runtime.napi = undefined; },
      m => { m.binary.file = '../external.node'; }, m => { m.dependencies.reverse(); },
      m => { m.dependencies.pop(); }, m => { m.dependencies.push(m.dependencies[0]); },
      m => { m.dependencies[0].file = '../conpty.dll'; }, m => { m.exports.shift(); },
      m => { m.sources.ownerSha256 = '0'.repeat(64); }, m => { m.sources.patchSha256 = '0'.repeat(64); },
      m => { m.sources.nodePtySha256 = '0'.repeat(64); }, m => { m.sources.pathUtilSha256 = '0'.repeat(64); },
      m => { m.sources.windowsHeadersSha256 = '0'.repeat(64); }, m => { m.sources.headersSha256 = ''; },
      m => { m.sources.delayLoadHookSha256 = '0'.repeat(64); },
      m => { delete m.sources.nodeLibSha256; }, m => { m.verification.nativeLoaded = true; },
      m => { m.verification.nativeCalls = true; }, m => { m.verification.productValidated = true; }
    ]) {
      const altered = structuredClone(manifest);
      mutate(altered);
      assert.throws(() => validateCandidateManifest(altered, binary, dependencies));
    }
    assert.throws(() => validateCandidateManifest(manifest, binary, dependencies.slice(0, 1)), /both/);
  });
  await test('addon DLL and executable hashes and PE declarations are independently checked', () => {
    const { manifest, binary, dependencies } = fixture();
    for (const index of [0, 1, 2]) {
      const originals = [binary, ...dependencies];
      const changed = originals.map(bytes => Buffer.from(bytes));
      const invoke = m => validateCandidateManifest(m, changed[0], changed.slice(1));
      changed[index][255] = 1;
      assert.throws(() => invoke(manifest), /hash/);
      for (const [offset, value, width] of [[0, 0, 2], [0x3c, 0xffffffff, 4], [64, 0, 4],
        [68, 0xaa64, 2], [84, 0, 2], [86, index === 2 ? 0x2002 : 2, 2], [88, 0x10b, 2]]) {
        changed[index] = Buffer.from(originals[index]);
        if (width === 4) changed[index].writeUInt32LE(value, offset);
        else changed[index].writeUInt16LE(value, offset);
        const altered = structuredClone(manifest);
        (index === 0 ? altered.binary : altered.dependencies[index - 1]).sha256 = digest(changed[index]);
        assert.throws(() => invoke(altered), /DOS|PE/);
      }
    }
  });
  await test('import requires both JS entries and stages only exact adjacent runtime assets', () => {
    for (const arch of ['x64', 'arm64']) {
      const value = fixture(arch);
      const source = writeFixture(`source-${arch}`, value);
      const dist = path.join(temporary, `dist-${arch}`);
      fs.mkdirSync(dist);
      fs.writeFileSync(path.join(source, 'ignored-input.cc'), 'build input only');
      assert.throws(() => importCandidateAssets({ source, dist }), /windows-execution-provider/);
      fs.writeFileSync(path.join(dist, 'windows-execution-provider.js'), '/* controlled provider boundary */');
      assert.throws(() => importCandidateAssets({ source, dist }), /windows-execution-output-worker/);
      fs.writeFileSync(path.join(dist, 'windows-execution-output-worker.js'), '/* controlled reader boundary */');
      const imported = importCandidateAssets({ source, dist });
      assert.equal(imported.directory, path.join(dist, candidateAssetRelativePath(arch)));
      assert.deepEqual(fs.readdirSync(imported.directory).sort(), ['conpty', 'conpty.node', 'manifest.json']);
      assert.deepEqual(fs.readdirSync(path.join(imported.directory, 'conpty')).sort(), ['OpenConsole.exe', 'conpty.dll']);
      assert.deepEqual(fs.readFileSync(path.join(imported.directory, 'conpty.node')), value.binary);
      dependencyFiles.forEach((file, index) => {
        assert.deepEqual(fs.readFileSync(path.join(imported.directory, file)), value.dependencies[index]);
      });
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(imported.directory, 'manifest.json'))), value.manifest);
      assert.throws(() => importCandidateAssets({ source, dist }), /EEXIST/);
    }
  });
  await test('missing or redirected dependencies reject before staging assets', () => {
    const source = writeFixture('dependency-validation');
    const dependency = path.join(source, dependencyFiles[0]);
    fs.renameSync(dependency, `${dependency}.original`);
    assert.throws(() => readCandidateAssets(source), /ENOENT/);
    if (process.platform !== 'win32') {
      fs.symlinkSync(`${dependency}.original`, dependency);
      assert.throws(() => readCandidateAssets(source), /regular/);
    }
  });
  await test('MSVC arguments preserve explicit library architecture exceptions and both source files', () => {
    for (const [arch, machine] of [['x64', 'X64'], ['arm64', 'ARM64']]) {
      const options = { arch, headers: '/headers', addonRoot: '/addon', inputs: '/inputs',
        source: '/inputs/conpty.cc', pathUtil: '/inputs/path_util.cc', binary: '/output/conpty.node', nodeLib: '/inputs/node.lib',
        delayLoadHook: '/inputs/win_delay_load_hook.cc' };
      assert.deepEqual(candidateCompilerArguments(options), [
        '/nologo', '/LD', '/MD', '/EHsc', '/std:c++17', '/guard:cf', '/sdl', '/W3', '/ZH:SHA_256',
        '/DWIN32_LEAN_AND_MEAN', '/DNAPI_CPP_EXCEPTIONS', '/DNODE_ADDON_API_CPP_EXCEPTIONS', '/D_HAS_EXCEPTIONS=1',
        '/DBUILDING_NODE_EXTENSION', '/DHOST_BINARY="node.exe"', '/DNODE_GYP_MODULE_NAME=conpty',
        '/I/headers', '/I/addon', '/I/inputs', '/inputs/conpty.cc', '/inputs/path_util.cc', '/inputs/win_delay_load_hook.cc',
        '/link', '/DLL', '/DYNAMICBASE', '/guard:cf', `/MACHINE:${machine}`, '/OUT:/output/conpty.node',
        '/DELAYLOAD:node.exe', '/inputs/node.lib', 'shlwapi.lib', 'delayimp.lib'
      ]);
      assert.throws(() => candidateCompilerArguments({ ...options, nodeLib: undefined }), /explicit node.lib/);
      assert.throws(() => candidateCompilerArguments({ ...options, delayLoadHook: undefined }), /delay-load hook/);
      assert.throws(() => candidateCompilerArguments({ ...options, arch: 'ia32' }), /target/);
    }
  });
  await test('headers require actual Node version and ABI including Electron builds', () => {
    const headers = path.join(temporary, 'headers');
    fs.mkdirSync(headers);
    const content = '#define NODE_MAJOR_VERSION 22\r\n#define NODE_MINOR_VERSION 23\r\n#define NODE_PATCH_VERSION 2\r\n#define NODE_MODULE_VERSION 127\r\n';
    fs.writeFileSync(path.join(headers, 'node_version.h'), content);
    const runtime = { name: 'electron', version: '39.8.7', node: '22.23.2', modules: '127' };
    assert.doesNotThrow(() => validateCandidateHeaders(headers, runtime));
    assert.throws(() => validateCandidateHeaders(headers, { ...runtime, node: '22.22.1' }), /Node version/);
    assert.throws(() => validateCandidateHeaders(headers, { ...runtime, modules: '140' }), /module ABI/);
    fs.writeFileSync(path.join(headers, 'node_version.h'), `${content}#define NODE_MODULE_VERSION 127\r\n`);
    assert.throws(() => validateCandidateHeaders(headers, runtime), /ambiguous/);
  });
  await test('foreign build host and absent explicit libraries reject before compiler or output', () => {
    const output = path.join(temporary, 'never-compiled');
    const options = { output, headers: '/not-read', dependencyRoot: '/not-read', compiler: '/not-run' };
    assert.throws(() => buildCandidateAssets(options), /node-lib/);
    assert.throws(() => buildCandidateAssets({ ...options, nodeLib: '/not-read' }), /delay-load-hook/);
    if (process.platform !== 'win32') {
      assert.throws(() => buildCandidateAssets({ ...options, nodeLib: '/not-read', delayLoadHook: '/not-read' }), /Windows/);
    }
    assert.equal(fs.existsSync(output), false);
  });
  await test('locked package source headers and vendored dependencies match build layout without loading them', () => {
    const ptyRoot = path.join(root, 'node_modules/node-pty');
    assert.equal(fileDigest('node_modules/node-pty/src/win/path_util.cc'), NODE_PTY_PATH_UTIL_SHA256);
    assert.equal(digest(JSON.stringify(['conpty.h', 'path_util.h'].map(file => ({
      file, sha256: digest(fs.readFileSync(path.join(ptyRoot, 'src/win', file)))
    })))), NODE_PTY_WINDOWS_HEADERS_SHA256);
    for (const arch of ['x64', 'arm64']) {
      const value = fixture(arch);
      value.dependencies = dependencyFiles.map(file => fs.readFileSync(path.join(ptyRoot,
        'third_party/conpty/1.25.260303002', `win10-${arch}`, path.posix.basename(file))));
      value.manifest.dependencies.forEach((entry, index) => { entry.sha256 = digest(value.dependencies[index]); });
      assert.doesNotThrow(() => validateCandidateManifest(value.manifest, value.binary, value.dependencies));
    }
  });
  await test('explicit Windows selection accepts offline Node and Electron assets with finite admission', async () => {
    for (const arch of ['x64', 'arm64']) {
      const value = fixture(arch);
      const source = writeFixture(`selection-${arch}`, value);
      const canonicalSource = await fs.promises.realpath(source);
      const selection = await resolveExecutionBuildSelection([...candidateArgs(source), '--execution-admission=10:1'], '/missing/dist');
      assert.deepEqual(selection, { profile, source: canonicalSource, admissionLimits: { executions: 10, starting: 1 } });
      assert(Object.isFrozen(selection) && Object.isFrozen(selection.admissionLimits));
      value.manifest.runtime = { ...value.manifest.runtime, name: 'electron', version: '39.8.7' };
      fs.writeFileSync(path.join(source, 'manifest.json'), JSON.stringify(value.manifest));
      assert.deepEqual(await resolveExecutionBuildSelection(candidateArgs(source), '/missing/dist'),
        { profile, source: canonicalSource, admissionLimits: { executions: 2, starting: 1 } });
    }
  });
  await test('Windows selection rejects unpaired watch foreign profiles and changed dependencies before clearing dist', async () => {
    const source = writeFixture('rejected-selection');
    const dist = path.join(temporary, 'preserved-dist');
    fs.mkdirSync(dist);
    fs.writeFileSync(path.join(dist, 'retained.txt'), 'unchanged');
    for (const args of [[`--execution-profile=${profile}`], [`--execution-assets=${source}`],
      [...candidateArgs(source), '--watch'], ['--execution-profile=linux-owner-v1-candidate', `--execution-assets=${source}`],
      ['--execution-profile=macos-owner-v1-candidate', `--execution-assets=${source}`],
      [...candidateArgs(source), '--execution-admission=0:1'], candidateArgs(dist)]) {
      await assert.rejects(resolveExecutionBuildSelection(args, dist));
    }
    const inside = path.join(dist, 'assets');
    fs.cpSync(source, inside, { recursive: true });
    await assert.rejects(resolveExecutionBuildSelection(candidateArgs(inside), dist), /outside/);
    const dependency = path.join(source, 'conpty/conpty.dll');
    const bytes = fs.readFileSync(dependency);
    bytes[255] ^= 1;
    fs.writeFileSync(dependency, bytes);
    await assert.rejects(resolveExecutionBuildSelection(candidateArgs(source), dist), /hash/);
    assert.equal(fs.readFileSync(path.join(dist, 'retained.txt'), 'utf8'), 'unchanged');
    assert.deepEqual(await resolveExecutionBuildSelection([], dist), {});
    assert.deepEqual(await resolveExecutionBuildSelection(['--production'], dist), {});
  });
  await test('formal Windows provider and output worker are bundled but native import remains profile-selected', () => {
    const build = fs.readFileSync(path.join(root, 'scripts/build/build.mjs'), 'utf8');
    for (const [source, output, config, context] of [
      ['windowsExecutionProviderMain.ts', 'windows-execution-provider.js', 'windowsExecutionProviderConfig', 'windowsExecutionProviderContext'],
      ['windowsExecutionOutputWorker.ts', 'windows-execution-output-worker.js', 'windowsExecutionOutputWorkerConfig', 'windowsExecutionOutputWorkerContext']
    ]) {
      assert(build.includes(`src/panel/${source}`));
      assert(build.includes(`fromMainExtensionDist('${output}')`));
      assert(build.includes(`esbuild.build(${config})`));
      assert(build.includes(`${context}.watch()`));
    }
    assert(build.includes("selection.profile === 'windows-owner-v1-candidate' ? importWindowsCandidateAssets"));
    assert.match(build, /const windowsExecutionProviderConfig = \{[\s\S]*?external: \['node-pty'\]/);
  });
  console.log(`Windows candidate assets: ${passed}/${passed} pure cases passed (no compiler, addon load or dependency execution).`);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
