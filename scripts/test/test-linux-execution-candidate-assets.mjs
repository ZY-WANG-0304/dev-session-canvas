import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCandidateAssets, candidateCompilerArguments, CANDIDATE_ASSET_RELATIVE_PATH,
  importCandidateAssets, validateCandidateManifest } from '../build/linux-execution-candidate-assets.mjs';
import { LINUX_EXECUTION_EXPORTS, NODE_PTY_UNIX_SHA256 } from '../build/linux-execution-provider-patch.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'dsc-candidate-assets-test-'));
const digest = value => createHash('sha256').update(value).digest('hex');
const owner = fs.readFileSync(path.join(root, 'extensions/vscode/dev-session-canvas/native/linux-execution-owner.h'));
const sharedOwner = fs.readFileSync(path.join(root, 'extensions/vscode/dev-session-canvas/native/unix-execution-owner.h'));
const patch = fs.readFileSync(path.join(root, 'scripts/build/linux-execution-provider-patch.mjs'));
// Synthetic header bytes only exercise import validation, never addon loading or machine code.
const binary = Buffer.alloc(64);
binary.set([0x7f, 0x45, 0x4c, 0x46, 2, 1]);
binary.writeUInt16LE(3, 16);
binary.writeUInt16LE(62, 18);
const manifest = { schemaVersion: 1, profile: 'linux-owner-v1-candidate', platform: 'linux', arch: 'x64',
  libc: { name: 'glibc', version: '2.35' },
  runtime: { name: 'node', version: '22.23.2', node: '22.23.2', modules: '127', napi: '10' },
  binary: { file: 'execution-owner.node', sha256: digest(binary) }, exports: [...LINUX_EXECUTION_EXPORTS],
  sources: { ownerSha256: digest(owner), sharedOwnerSha256: digest(sharedOwner), patchSha256: digest(patch), nodePtySha256: NODE_PTY_UNIX_SHA256,
    patchedSha256: '1'.repeat(64), headersSha256: '2'.repeat(64), nodeAddonApiSha256: '3'.repeat(64) },
  verification: { compiled: true, nativeLoaded: false, nativeCalls: false, productValidated: false } };
let passed = 0;
const test = (name, run) => { run(); passed++; console.log(`PASS ${name}`); };

try {
  test('candidate manifest states one explicit build environment and no native or product validation', () => {
    assert.strictEqual(validateCandidateManifest(manifest, binary), manifest);
    const electron = structuredClone(manifest);
    electron.runtime = { ...electron.runtime, name: 'electron', version: '37.0.0' };
    assert.doesNotThrow(() => validateCandidateManifest(electron, binary));
    assert.equal(CANDIDATE_ASSET_RELATIVE_PATH, 'native/linux-execution-candidate/linux-x64-glibc');
  });

  test('foreign targets stale source incomplete exports and unsupported proof claims are rejected', () => {
    for (const mutate of [
      value => { value.profile = 'other'; }, value => { value.platform = 'darwin'; },
      value => { value.arch = 'arm64'; }, value => { value.libc.name = 'musl'; },
      value => { value.runtime.name = 'unknown'; }, value => { value.runtime.node = '20.0.0'; },
      value => { value.runtime.modules = ''; }, value => { value.runtime.napi = undefined; },
      value => { value.binary.file = '../external.node'; }, value => { value.exports.pop(); },
      value => { value.sources.ownerSha256 = '0'.repeat(64); },
      value => { value.sources.sharedOwnerSha256 = '0'.repeat(64); },
      value => { delete value.sources.sharedOwnerSha256; },
      value => { value.sources.patchSha256 = '0'.repeat(64); },
      value => { value.sources.headersSha256 = ''; },
      value => { value.verification.productValidated = true; },
      value => { value.verification.nativeLoaded = true; }
    ]) {
      const altered = structuredClone(manifest);
      mutate(altered);
      assert.throws(() => validateCandidateManifest(altered, binary));
    }
  });

  test('binary content hash and basic target format are checked without loading code', () => {
    const altered = Buffer.from(binary);
    altered[63] = 1;
    assert.throws(() => validateCandidateManifest(manifest, altered), /hash/);
    const invalid = Buffer.from('not a native candidate');
    assert.throws(() => validateCandidateManifest({ ...manifest,
      binary: { file: 'execution-owner.node', sha256: digest(invalid) } }, invalid), /ELF64/);
  });

  test('explicit import stages exactly hashed runtime assets after the formal worker build', () => {
    const source = path.join(temporary, 'source');
    const dist = path.join(temporary, 'dist');
    fs.mkdirSync(source);
    fs.mkdirSync(dist);
    fs.writeFileSync(path.join(source, 'manifest.json'), JSON.stringify(manifest));
    fs.writeFileSync(path.join(source, 'execution-owner.node'), binary);
    fs.writeFileSync(path.join(source, 'ignored-build-input.cc'), 'not a runtime asset');
    assert.throws(() => importCandidateAssets({ source, dist }), /linux-execution-provider/);
    fs.writeFileSync(path.join(dist, 'linux-execution-provider.js'), '/* controlled worker placeholder */');
    const result = importCandidateAssets({ source, dist });
    assert.deepEqual(fs.readdirSync(result.directory).sort(), ['execution-owner.node', 'manifest.json']);
    assert.deepEqual(fs.readFileSync(path.join(result.directory, 'execution-owner.node')), binary);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(result.directory, 'manifest.json'))), manifest);
    assert.throws(() => importCandidateAssets({ source, dist }), /EEXIST/);
  });

  test('compiler command contains only the controlled addon compilation inputs', () => {
    const args = candidateCompilerArguments({ headers: '/headers', addonRoot: '/addon', inputs: '/inputs',
      source: '/inputs/source.cc', binary: '/output/execution-owner.node' });
    assert.deepEqual(args, ['-std=c++17', '-shared', '-fPIC', '-pthread', '-fexceptions', '-DNAPI_CPP_EXCEPTIONS',
      '-DNODE_GYP_MODULE_NAME=pty', '-I', '/headers', '-I', '/addon', '-I', '/inputs',
      '/inputs/source.cc', '-o', '/output/execution-owner.node', '-lutil']);
  });

  test('mismatched runtime headers refuse before invoking a compiler or creating output', () => {
    if (process.platform !== 'linux' || process.arch !== 'x64') return;
    const headers = path.join(temporary, 'wrong-headers');
    fs.mkdirSync(headers);
    fs.writeFileSync(path.join(headers, 'node_version.h'),
      '#define NODE_MAJOR_VERSION 0\n#define NODE_MINOR_VERSION 0\n#define NODE_PATCH_VERSION 0\n#define NODE_MODULE_VERSION 1\n');
    const output = path.join(temporary, 'never-compiled');
    assert.throws(() => buildCandidateAssets({ output, headers, dependencyRoot: '/not-used', compiler: '/not-executable' }),
      /Headers must match/);
    assert.equal(fs.existsSync(output), false);
  });

  test('native mutations are bounded token calls and all uses participate in one-shot close', () => {
    const source = sharedOwner.toString('utf8');
    assert(owner.toString('utf8').includes('#include "unix-execution-owner.h"'));
    const write = source.slice(source.indexOf('static Napi::Value Write('), source.indexOf('static Napi::Value Resize('));
    const resize = source.slice(source.indexOf('static Napi::Value Resize('), source.indexOf('static Napi::Value Close('));
    const close = source.slice(source.indexOf('static Napi::Value Close('));
    assert(write.includes('RequireToken(info, 2)') && write.includes('buffer.Length() > 4096'));
    assert.equal((write.match(/write\(owner\.master/g) ?? []).length, 1);
    assert(write.includes('owner.writeInFlight = true;') && write.includes('owner.writeInFlight = false;'));
    assert(write.includes('error == EAGAIN || error == EWOULDBLOCK || error == EINTR'));
    assert(write.includes('"zero-progress"'));
    assert(resize.includes('RequireToken(info, 3)') && resize.includes('std::floor(cols) != cols'));
    assert.equal((resize.match(/ioctl\(owner\.master, TIOCSWINSZ/g) ?? []).length, 1);
    assert(resize.includes('owner.resizeInFlight = true;') && resize.includes('owner.resizeInFlight = false;'));
    assert(close.includes('owner.readInFlight || owner.writeInFlight || owner.resizeInFlight'));
    assert.equal((close.match(/close\(owner\.master\)/g) ?? []).length, 1);
    assert(close.indexOf('owner.closeAttempted = true') < close.indexOf('close(owner.master)'));
    assert(source.includes('signal == "SIGHUP" ? owner.hupCalls'));
    assert(source.includes('if (calls != 0) return Result'));
  });

  test('normal build includes the formal worker and existing VSIX staging includes dist assets', () => {
    const build = fs.readFileSync(path.join(root, 'scripts/build/build.mjs'), 'utf8');
    const packaging = fs.readFileSync(path.join(root, 'scripts/release/package-vsix.mjs'), 'utf8');
    assert(build.includes("src/panel/linuxExecutionProviderMain.ts"));
    assert(build.includes("fromMainExtensionDist('linux-execution-provider.js')"));
    assert(build.includes('esbuild.build(linuxExecutionProviderConfig)'));
    assert(build.includes('linuxExecutionProviderContext.watch()'));
    assert(packaging.includes("cpSync(path.join(mainExtensionRoot, 'dist'), path.join(stagePackageRoot, 'dist'), { recursive: true })"));
  });

  console.log(`Linux execution candidate assets: ${passed}/${passed} pure cases passed (synthetic binary only, no compiler or native load).`);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
