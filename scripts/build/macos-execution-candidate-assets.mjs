import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { MACOS_EXECUTION_EXPORTS, NODE_PTY_UNIX_SHA256, NODE_PTY_SPAWN_HELPER_SHA256,
  patchMacosExecutionProvider } from './macos-execution-provider-patch.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const nativeRoot = path.join(root, 'extensions/vscode/dev-session-canvas/native');
const ownerFile = path.join(nativeRoot, 'macos-execution-owner.h');
const sharedOwnerFile = path.join(nativeRoot, 'unix-execution-owner.h');
const patchFile = fileURLToPath(new URL('./macos-execution-provider-patch.mjs', import.meta.url));
const profile = 'macos-owner-v1-candidate';
const binaryFile = 'execution-owner.node';
const helperFile = 'spawn-helper';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function readRegular(file, executable = false) {
  const stat = fs.lstatSync(file);
  assert(stat.isFile() && (!executable || (stat.mode & 0o111)), `Expected a regular${executable ? ' executable' : ''} file: ${file}`);
  return fs.readFileSync(file);
}

function treeHash(directory) {
  const entries = [];
  const visit = (directory, prefix = '') => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      assert(!entry.isSymbolicLink(), `Unexpected input symlink: ${entry.name}`);
      const name = path.posix.join(prefix, entry.name);
      if (entry.isDirectory()) visit(path.join(directory, entry.name), name);
      else entries.push({ file: name, sha256: hash(readRegular(path.join(directory, entry.name))) });
    }
  };
  visit(directory);
  return hash(JSON.stringify(entries));
}

export function candidateAssetRelativePath(arch) {
  assert(['arm64', 'x64'].includes(arch), 'Candidate assets require arm64 or x64');
  return `native/macos-execution-candidate/darwin-${arch}`;
}

export function readCandidateBuildEnvironment() {
  assert.equal(process.platform, 'darwin', 'Candidate assets require macOS');
  assert(['arm64', 'x64'].includes(process.arch), 'Candidate assets require arm64 or x64');
  return { runtime: { name: process.versions.electron ? 'electron' : 'node',
    version: process.versions.electron ?? process.versions.node,
    node: process.versions.node, modules: process.versions.modules, napi: process.versions.napi } };
}

function assertMachO(bytes, arch, filetype) {
  // Target declaration only: import never loads the addon or runs the helper.
  assert(bytes.length >= 32 && bytes.readUInt32LE(0) === 0xfeedfacf
    && bytes.readUInt32LE(4) === (arch === 'arm64' ? 0x0100000c : 0x01000007)
    && bytes.readUInt32LE(12) === filetype, 'Candidate binary must declare the matching Mach-O target and file type');
}

export function validateCandidateManifest(manifest, binary, helper) {
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.profile, profile);
  assert.equal(manifest.platform, 'darwin');
  assert(['arm64', 'x64'].includes(manifest.arch));
  assert(['node', 'electron'].includes(manifest.runtime?.name));
  for (const key of ['version', 'node']) assert.match(manifest.runtime[key] ?? '', /^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/);
  for (const key of ['modules', 'napi']) assert.match(manifest.runtime[key] ?? '', /^[1-9]\d*$/);
  if (manifest.runtime.name === 'node') assert.equal(manifest.runtime.version, manifest.runtime.node);
  for (const [entry, file, bytes, filetype] of [
    [manifest.binary, binaryFile, binary, 8], [manifest.helper, helperFile, helper, 2]
  ]) {
    assert.equal(entry?.file, file);
    assert.match(entry.sha256 ?? '', /^[a-f0-9]{64}$/);
    assert.equal(hash(bytes), entry.sha256, `Candidate ${file} hash does not match`);
    assertMachO(bytes, manifest.arch, filetype);
  }
  assert.deepEqual(manifest.exports, MACOS_EXECUTION_EXPORTS);
  for (const key of ['ownerSha256', 'sharedOwnerSha256', 'patchSha256', 'nodePtySha256', 'patchedSha256',
    'helperSourceSha256', 'headersSha256', 'nodeAddonApiSha256']) assert.match(manifest.sources?.[key] ?? '', /^[a-f0-9]{64}$/);
  assert.equal(manifest.sources.nodePtySha256, NODE_PTY_UNIX_SHA256);
  assert.equal(manifest.sources.helperSourceSha256, NODE_PTY_SPAWN_HELPER_SHA256);
  assert.equal(manifest.sources.ownerSha256, hash(readRegular(ownerFile)), 'Candidate owner source changed');
  assert.equal(manifest.sources.sharedOwnerSha256, hash(readRegular(sharedOwnerFile)), 'Candidate shared owner source changed');
  assert.equal(manifest.sources.patchSha256, hash(readRegular(patchFile)), 'Candidate patch source changed');
  assert.deepEqual(manifest.verification,
    { compiled: true, nativeLoaded: false, nativeCalls: false, productValidated: false });
  return manifest;
}

export function validateCandidateHeaders(headers, runtime) {
  const versionHeader = readRegular(path.join(headers, 'node_version.h')).toString('utf8');
  const macro = name => {
    const matches = [...versionHeader.matchAll(new RegExp(`^#define ${name} (\\d+)\\s*$`, 'gm'))];
    assert.equal(matches.length, 1, `Missing or ambiguous header macro: ${name}`);
    return matches[0][1];
  };
  assert.equal(['MAJOR', 'MINOR', 'PATCH'].map(part => macro(`NODE_${part}_VERSION`)).join('.'), runtime.node,
    'Headers must match the explicit build runtime Node version');
  assert.equal(macro('NODE_MODULE_VERSION'), runtime.modules, 'Headers must match the build runtime module ABI');
}

function targetArguments(arch, sdk) {
  assert(['arm64', 'x64'].includes(arch), 'Candidate compiler target must be arm64 or x64');
  assert(path.isAbsolute(sdk), 'Specify an absolute macOS SDK path');
  return ['-arch', arch === 'x64' ? 'x86_64' : 'arm64', '-isysroot', sdk];
}

export function candidateCompilerArguments({ arch, sdk, headers, addonRoot, inputs, source, binary }) {
  return ['-std=c++17', '-bundle', '-undefined', 'dynamic_lookup', '-fPIC', '-pthread', '-fexceptions',
    '-DNAPI_CPP_EXCEPTIONS', '-DNODE_GYP_MODULE_NAME=pty', ...targetArguments(arch, sdk),
    '-I', headers, '-I', addonRoot, '-I', inputs, source, '-o', binary];
}

export function helperCompilerArguments({ arch, sdk, source, binary }) {
  return ['-std=c++17', ...targetArguments(arch, sdk), source, '-o', binary];
}

function command(file, args, directory) {
  const result = spawnSync(file, args, { cwd: directory, encoding: 'utf8', timeout: 120000,
    maxBuffer: 4 * 1024 * 1024, shell: false });
  assert(!result.error && result.status === 0 && !result.signal,
    `Candidate build command failed: ${result.error?.message ?? result.stderr ?? result.status}`);
  return result.stdout.trim();
}

export function buildCandidateAssets({ output, dependencyRoot, headers, compiler = 'clang++', sdk }) {
  assert(output && dependencyRoot && headers, 'Specify output, dependency-root and headers');
  const environment = readCandidateBuildEnvironment();
  const includeRoot = fs.realpathSync(headers);
  validateCandidateHeaders(includeRoot, environment.runtime);
  const ptyRoot = path.join(fs.realpathSync(dependencyRoot), 'node-pty');
  const addonRoot = path.join(ptyRoot, 'node_modules/node-addon-api');
  assert.equal(JSON.parse(readRegular(path.join(ptyRoot, 'package.json'))).version, '1.2.0-beta.12');
  assert.equal(JSON.parse(readRegular(path.join(addonRoot, 'package.json'))).version, '7.1.1');
  const original = readRegular(path.join(ptyRoot, 'src/unix/pty.cc'));
  const helperSource = readRegular(path.join(ptyRoot, 'src/unix/spawn-helper.cc'));
  assert.equal(hash(helperSource), NODE_PTY_SPAWN_HELPER_SHA256, 'Unexpected node-pty spawn helper source');
  const patched = patchMacosExecutionProvider(original.toString('utf8'));
  const owner = readRegular(ownerFile);
  const sharedOwner = readRegular(sharedOwnerFile);
  const sdkPath = fs.realpathSync(sdk ?? command('xcrun', ['--sdk', 'macosx', '--show-sdk-path'], root));
  assert(fs.statSync(sdkPath).isDirectory(), 'Expected a macOS SDK directory');
  const sources = { ownerSha256: hash(owner), sharedOwnerSha256: hash(sharedOwner), patchSha256: hash(readRegular(patchFile)),
    nodePtySha256: hash(original), patchedSha256: hash(patched), helperSourceSha256: hash(helperSource),
    headersSha256: treeHash(includeRoot), nodeAddonApiSha256: treeHash(addonRoot) };
  const directory = path.resolve(output);
  fs.mkdirSync(path.dirname(directory), { recursive: true });
  fs.mkdirSync(directory);
  const inputs = path.join(directory, 'inputs');
  fs.mkdirSync(inputs);
  fs.writeFileSync(path.join(inputs, 'macos-execution-owner.h'), owner, { flag: 'wx' });
  fs.writeFileSync(path.join(inputs, 'unix-execution-owner.h'), sharedOwner, { flag: 'wx' });
  const source = path.join(inputs, 'pty-candidate.cc');
  const helperInput = path.join(inputs, 'spawn-helper.cc');
  fs.writeFileSync(source, patched, { flag: 'wx' });
  fs.writeFileSync(helperInput, helperSource, { flag: 'wx' });
  const binaryPath = path.join(directory, binaryFile);
  const helperPath = path.join(directory, helperFile);
  const common = { arch: process.arch, sdk: sdkPath };
  const args = candidateCompilerArguments({ ...common, headers: includeRoot, addonRoot, inputs, source, binary: binaryPath });
  const helperArgs = helperCompilerArguments({ ...common, source: helperInput, binary: helperPath });
  command(compiler, args, directory);
  command(compiler, helperArgs, directory);
  const binary = readRegular(binaryPath);
  const helper = readRegular(helperPath, true);
  const manifest = { schemaVersion: 1, profile, platform: 'darwin', arch: process.arch, ...environment,
    binary: { file: binaryFile, sha256: hash(binary) }, helper: { file: helperFile, sha256: hash(helper) },
    exports: [...MACOS_EXECUTION_EXPORTS], sources, compiler: { command: compiler, sdk: sdkPath, args, helperArgs },
    verification: { compiled: true, nativeLoaded: false, nativeCalls: false, productValidated: false } };
  validateCandidateManifest(manifest, binary, helper);
  fs.writeFileSync(path.join(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  return { directory, manifest };
}

export function readCandidateAssets(source) {
  assert(source, 'Specify candidate source');
  const directory = fs.realpathSync(source);
  const manifest = JSON.parse(readRegular(path.join(directory, 'manifest.json')));
  assert.equal(manifest.binary?.file, binaryFile);
  assert.equal(manifest.helper?.file, helperFile);
  const binary = readRegular(path.join(directory, binaryFile));
  const helper = readRegular(path.join(directory, helperFile), true);
  validateCandidateManifest(manifest, binary, helper);
  return { directory, manifest, binary, helper };
}

export function importCandidateAssets({ source, dist }) {
  assert(source && dist, 'Specify candidate source and extension dist');
  const { manifest, binary, helper } = readCandidateAssets(source);
  const distRoot = fs.realpathSync(dist);
  assert(readRegular(path.join(distRoot, 'macos-execution-provider.js')).length > 0,
    'Build the formal provider entry before importing candidate assets');
  const target = path.join(distRoot, candidateAssetRelativePath(manifest.arch));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, binaryFile), binary, { flag: 'wx' });
  fs.writeFileSync(path.join(target, helperFile), helper, { flag: 'wx', mode: 0o755 });
  fs.chmodSync(path.join(target, helperFile), 0o755);
  fs.writeFileSync(path.join(target, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  return { directory: target, manifest };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    const { values, positionals } = parseArgs({ allowPositionals: true, options: {
      output: { type: 'string' }, 'dependency-root': { type: 'string' }, headers: { type: 'string' },
      compiler: { type: 'string' }, sdk: { type: 'string' }, source: { type: 'string' }, dist: { type: 'string' }
    } });
    assert.equal(positionals.length, 1, 'Choose build or import');
    const result = positionals[0] === 'build'
      ? buildCandidateAssets({ output: values.output, dependencyRoot: values['dependency-root'],
          headers: values.headers, compiler: values.compiler, sdk: values.sdk })
      : positionals[0] === 'import'
        ? importCandidateAssets({ source: values.source,
            dist: values.dist ?? path.join(root, 'extensions/vscode/dev-session-canvas/dist') })
        : assert.fail('Choose build or import');
    console.log(JSON.stringify({ directory: result.directory, profile, verification: result.manifest.verification }));
  } catch (error) {
    console.error(error.stack ?? String(error));
    process.exitCode = 1;
  }
}
