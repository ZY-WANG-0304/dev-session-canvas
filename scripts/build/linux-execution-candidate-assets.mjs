import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { LINUX_EXECUTION_EXPORTS, NODE_PTY_UNIX_SHA256, patchLinuxExecutionProvider } from './linux-execution-provider-patch.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const ownerFile = path.join(root, 'extensions/vscode/dev-session-canvas/native/linux-execution-owner.h');
const patchFile = fileURLToPath(new URL('./linux-execution-provider-patch.mjs', import.meta.url));
const profile = 'linux-owner-v1-candidate';
export const CANDIDATE_ASSET_RELATIVE_PATH = 'native/linux-execution-candidate/linux-x64-glibc';
const binaryFile = 'execution-owner.node';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function readRegular(file) {
  assert(fs.lstatSync(file).isFile(), `Expected a regular file: ${file}`);
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

export function readCandidateBuildEnvironment() {
  assert.equal(process.platform, 'linux', 'Candidate assets require Linux');
  assert.equal(process.arch, 'x64', 'Candidate assets require x64');
  const version = process.report.getReport().header.glibcVersionRuntime;
  assert(typeof version === 'string' && /^\d+\.\d+(?:\.\d+)?$/.test(version), 'An explicit glibc runtime is required');
  return {
    libc: { name: 'glibc', version },
    runtime: { name: process.versions.electron ? 'electron' : 'node',
      version: process.versions.electron ?? process.versions.node,
      node: process.versions.node, modules: process.versions.modules, napi: process.versions.napi }
  };
}

export function validateCandidateManifest(manifest, binary) {
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.profile, profile);
  assert.equal(manifest.platform, 'linux');
  assert.equal(manifest.arch, 'x64');
  assert.equal(manifest.libc?.name, 'glibc');
  assert.match(manifest.libc?.version ?? '', /^\d+\.\d+(?:\.\d+)?$/);
  assert(['node', 'electron'].includes(manifest.runtime?.name));
  for (const key of ['version', 'node']) assert.match(manifest.runtime[key] ?? '', /^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/);
  for (const key of ['modules', 'napi']) assert.match(manifest.runtime[key] ?? '', /^[1-9]\d*$/);
  if (manifest.runtime.name === 'node') assert.equal(manifest.runtime.version, manifest.runtime.node);
  assert.equal(manifest.binary?.file, binaryFile);
  assert.match(manifest.binary.sha256 ?? '', /^[a-f0-9]{64}$/);
  assert.equal(hash(binary), manifest.binary.sha256, 'Candidate binary hash does not match');
  // This only checks the declared target format; it does not load or execute the addon.
  assert(binary.length >= 64 && binary.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))
    && binary[4] === 2 && binary[5] === 1 && binary.readUInt16LE(16) === 3 && binary.readUInt16LE(18) === 62,
  'Candidate binary must declare ELF64 little-endian x86-64 shared-object format');
  assert.deepEqual(manifest.exports, LINUX_EXECUTION_EXPORTS);
  for (const key of ['ownerSha256', 'patchSha256', 'nodePtySha256', 'patchedSha256', 'headersSha256', 'nodeAddonApiSha256'])
    assert.match(manifest.sources?.[key] ?? '', /^[a-f0-9]{64}$/);
  assert.equal(manifest.sources.nodePtySha256, NODE_PTY_UNIX_SHA256);
  assert.equal(manifest.sources.ownerSha256, hash(readRegular(ownerFile)), 'Candidate owner source changed');
  assert.equal(manifest.sources.patchSha256, hash(readRegular(patchFile)), 'Candidate patch source changed');
  assert.deepEqual(manifest.verification,
    { compiled: true, nativeLoaded: false, nativeCalls: false, productValidated: false });
  return manifest;
}

export function candidateCompilerArguments({ headers, addonRoot, inputs, source, binary }) {
  return ['-std=c++17', '-shared', '-fPIC', '-pthread', '-fexceptions', '-DNAPI_CPP_EXCEPTIONS',
    '-DNODE_GYP_MODULE_NAME=pty', '-I', headers, '-I', addonRoot, '-I', inputs, source, '-o', binary, '-lutil'];
}

function runCompiler(compiler, args, directory) {
  const result = spawnSync(compiler, args, { cwd: directory, encoding: 'utf8', timeout: 120000,
    maxBuffer: 4 * 1024 * 1024, shell: false });
  assert(!result.error && result.status === 0 && !result.signal,
    `Candidate compilation failed: ${result.error?.message ?? result.stderr ?? result.status}`);
}

export function buildCandidateAssets({ output, dependencyRoot, headers, compiler = 'g++' }) {
  assert(output && dependencyRoot && headers, 'Specify output, dependency-root and headers');
  const environment = readCandidateBuildEnvironment();
  const includeRoot = fs.realpathSync(headers);
  const versionHeader = readRegular(path.join(includeRoot, 'node_version.h')).toString('utf8');
  const macro = name => {
    const matches = [...versionHeader.matchAll(new RegExp(`^#define ${name} (\\d+)\\s*$`, 'gm'))];
    assert.equal(matches.length, 1, `Missing or ambiguous header macro: ${name}`);
    return matches[0][1];
  };
  assert.equal(['MAJOR', 'MINOR', 'PATCH'].map(part => macro(`NODE_${part}_VERSION`)).join('.'), environment.runtime.node,
    'Headers must match the explicit build runtime Node version');
  assert.equal(macro('NODE_MODULE_VERSION'), environment.runtime.modules, 'Headers must match the build runtime module ABI');
  const ptyRoot = path.join(fs.realpathSync(dependencyRoot), 'node-pty');
  const addonRoot = path.join(ptyRoot, 'node_modules/node-addon-api');
  assert.equal(JSON.parse(readRegular(path.join(ptyRoot, 'package.json'))).version, '1.2.0-beta.12');
  assert.equal(JSON.parse(readRegular(path.join(addonRoot, 'package.json'))).version, '7.1.1');
  const original = readRegular(path.join(ptyRoot, 'src/unix/pty.cc'));
  const patched = patchLinuxExecutionProvider(original.toString('utf8'));
  const owner = readRegular(ownerFile);
  const sources = { ownerSha256: hash(owner), patchSha256: hash(readRegular(patchFile)),
    nodePtySha256: hash(original), patchedSha256: hash(patched), headersSha256: treeHash(includeRoot),
    nodeAddonApiSha256: treeHash(addonRoot) };
  const directory = path.resolve(output);
  fs.mkdirSync(path.dirname(directory), { recursive: true });
  fs.mkdirSync(directory);
  const inputs = path.join(directory, 'inputs');
  fs.mkdirSync(inputs);
  fs.writeFileSync(path.join(inputs, 'linux-execution-owner.h'), owner, { flag: 'wx' });
  const source = path.join(inputs, 'pty-candidate.cc');
  fs.writeFileSync(source, patched, { flag: 'wx' });
  const binaryPath = path.join(directory, binaryFile);
  const args = candidateCompilerArguments({ headers: includeRoot, addonRoot, inputs, source, binary: binaryPath });
  runCompiler(compiler, args, directory);
  const binary = readRegular(binaryPath);
  const manifest = { schemaVersion: 1, profile, platform: 'linux', arch: 'x64', ...environment,
    binary: { file: binaryFile, sha256: hash(binary) }, exports: [...LINUX_EXECUTION_EXPORTS], sources,
    verification: { compiled: true, nativeLoaded: false, nativeCalls: false, productValidated: false } };
  validateCandidateManifest(manifest, binary);
  fs.writeFileSync(path.join(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  return { directory, manifest };
}

export function importCandidateAssets({ source, dist }) {
  assert(source && dist, 'Specify candidate source and extension dist');
  const directory = fs.realpathSync(source);
  const manifest = JSON.parse(readRegular(path.join(directory, 'manifest.json')));
  assert.equal(manifest.binary?.file, binaryFile);
  const binary = readRegular(path.join(directory, binaryFile));
  validateCandidateManifest(manifest, binary);
  const distRoot = fs.realpathSync(dist);
  assert(readRegular(path.join(distRoot, 'linux-execution-provider.js')).length > 0,
    'Build the formal provider entry before importing candidate assets');
  const target = path.join(distRoot, CANDIDATE_ASSET_RELATIVE_PATH);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.mkdirSync(target);
  // Copy exactly the already hashed bytes, not paths that could change after validation.
  fs.writeFileSync(path.join(target, binaryFile), binary, { flag: 'wx' });
  fs.writeFileSync(path.join(target, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  return { directory: target, manifest };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    const { values, positionals } = parseArgs({ allowPositionals: true, options: {
      output: { type: 'string' }, 'dependency-root': { type: 'string' }, headers: { type: 'string' },
      compiler: { type: 'string' }, source: { type: 'string' }, dist: { type: 'string' }
    } });
    assert.equal(positionals.length, 1, 'Choose build or import');
    const result = positionals[0] === 'build'
      ? buildCandidateAssets({ output: values.output, dependencyRoot: values['dependency-root'],
          headers: values.headers, compiler: values.compiler })
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
