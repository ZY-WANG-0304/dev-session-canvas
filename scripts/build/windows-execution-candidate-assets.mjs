import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { WINDOWS_EXECUTION_EXPORTS, NODE_PTY_CONPTY_SHA256,
  patchWindowsExecutionProvider } from './windows-execution-provider-patch.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const ownerFile = path.join(root, 'extensions/vscode/dev-session-canvas/native/windows-execution-owner.h');
const patchFile = fileURLToPath(new URL('./windows-execution-provider-patch.mjs', import.meta.url));
const profile = 'windows-owner-v1-candidate';
const binaryFile = 'conpty.node';
const dependencyFiles = Object.freeze(['conpty/conpty.dll', 'conpty/OpenConsole.exe']);
const conptyVersion = '1.25.260303002';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const NODE_PTY_PATH_UTIL_SHA256 = '54a6041c38bf714893c1d18db3d2888f42089d0209c3d1dc8d444ac6dbf46a0b';
export const NODE_GYP_DELAY_LOAD_HOOK_SHA256 = 'ec2357ffdf512151c21a52326ad3396aaa650b83e5c4a31153d216a155f68ecc';
const windowsHeaders = Object.freeze([
  { file: 'conpty.h', sha256: '32b74fe493b4435bc2f8362cfa4bcb4f49a290438002cc4a369e9379c7728d3c' },
  { file: 'path_util.h', sha256: 'f877c15389b7794f1c25a0f3b05101a0fde92ccf8b0a351500ebd5b7922c3bff' }
]);
export const NODE_PTY_WINDOWS_HEADERS_SHA256 = hash(JSON.stringify(windowsHeaders));

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

export function candidateAssetRelativePath(arch) {
  assert(['x64', 'arm64'].includes(arch), 'Candidate assets require x64 or arm64');
  return `native/windows-execution-candidate/win32-${arch}`;
}

export function readCandidateBuildEnvironment() {
  assert.equal(process.platform, 'win32', 'Candidate assets require Windows');
  assert(['x64', 'arm64'].includes(process.arch), 'Candidate assets require x64 or arm64');
  return { runtime: { name: process.versions.electron ? 'electron' : 'node',
    version: process.versions.electron ?? process.versions.node,
    node: process.versions.node, modules: process.versions.modules, napi: process.versions.napi } };
}

function assertPE(bytes, arch, dll) {
  // This checks target declarations only; no PE image is loaded or executed.
  assert(bytes.length >= 64 && bytes.readUInt16LE(0) === 0x5a4d, 'Candidate binary must declare a DOS header');
  const pe = bytes.readUInt32LE(0x3c);
  assert(pe >= 64 && pe + 26 <= bytes.length && bytes.readUInt32LE(pe) === 0x4550,
    'Candidate binary must declare a PE header');
  assert.equal(bytes.readUInt16LE(pe + 4), arch === 'arm64' ? 0xaa64 : 0x8664,
    'Candidate binary must declare the matching PE architecture');
  const optionalSize = bytes.readUInt16LE(pe + 20);
  assert(optionalSize >= 112 && pe + 24 + optionalSize <= bytes.length
    && bytes.readUInt16LE(pe + 24) === 0x20b, 'Candidate binary must declare a PE32+ optional header');
  const characteristics = bytes.readUInt16LE(pe + 22);
  assert((characteristics & 0x0002) && Boolean(characteristics & 0x2000) === dll,
    'Candidate binary must declare the matching PE executable or DLL type');
}

export function validateCandidateManifest(manifest, binary, dependencies) {
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.profile, profile);
  assert.equal(manifest.platform, 'win32');
  assert(['x64', 'arm64'].includes(manifest.arch));
  assert(['node', 'electron'].includes(manifest.runtime?.name));
  for (const key of ['version', 'node']) assert.match(manifest.runtime[key] ?? '', /^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/);
  for (const key of ['modules', 'napi']) assert.match(manifest.runtime[key] ?? '', /^[1-9]\d*$/);
  if (manifest.runtime.name === 'node') assert.equal(manifest.runtime.version, manifest.runtime.node);
  assert.equal(manifest.binary?.file, binaryFile);
  assert.deepEqual(manifest.dependencies?.map(entry => entry.file), dependencyFiles);
  assert(Array.isArray(dependencies) && dependencies.length === dependencyFiles.length,
    'Candidate assets require both ConPTY dependencies');
  for (const [entry, bytes, dll] of [
    [manifest.binary, binary, true], [manifest.dependencies[0], dependencies[0], true],
    [manifest.dependencies[1], dependencies[1], false]
  ]) {
    assert.match(entry.sha256 ?? '', /^[a-f0-9]{64}$/);
    assert.equal(hash(bytes), entry.sha256, `Candidate ${entry.file} hash does not match`);
    assertPE(bytes, manifest.arch, dll);
  }
  assert.deepEqual(manifest.exports, WINDOWS_EXECUTION_EXPORTS);
  for (const key of ['ownerSha256', 'patchSha256', 'nodePtySha256', 'patchedSha256', 'pathUtilSha256',
    'windowsHeadersSha256', 'headersSha256', 'nodeAddonApiSha256', 'nodeLibSha256', 'delayLoadHookSha256']) {
    assert.match(manifest.sources?.[key] ?? '', /^[a-f0-9]{64}$/);
  }
  assert.equal(manifest.sources.nodePtySha256, NODE_PTY_CONPTY_SHA256);
  assert.equal(manifest.sources.pathUtilSha256, NODE_PTY_PATH_UTIL_SHA256);
  assert.equal(manifest.sources.windowsHeadersSha256, NODE_PTY_WINDOWS_HEADERS_SHA256);
  assert.equal(manifest.sources.delayLoadHookSha256, NODE_GYP_DELAY_LOAD_HOOK_SHA256);
  assert.equal(manifest.sources.ownerSha256, hash(readRegular(ownerFile)), 'Candidate owner source changed');
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

export function candidateCompilerArguments({ arch, headers, addonRoot, inputs, source, pathUtil, binary, nodeLib, delayLoadHook }) {
  assert(['x64', 'arm64'].includes(arch), 'Candidate compiler target must be x64 or arm64');
  assert(nodeLib, 'Specify an explicit node.lib for the build runtime');
  assert(delayLoadHook, 'Specify an explicit node-gyp delay-load hook');
  return ['/nologo', '/LD', '/MD', '/EHsc', '/std:c++17', '/guard:cf', '/sdl', '/W3', '/ZH:SHA_256',
    '/DWIN32_LEAN_AND_MEAN', '/DNAPI_CPP_EXCEPTIONS', '/DNODE_ADDON_API_CPP_EXCEPTIONS', '/D_HAS_EXCEPTIONS=1',
    '/DBUILDING_NODE_EXTENSION', '/DHOST_BINARY="node.exe"', '/DNODE_GYP_MODULE_NAME=conpty',
    `/I${headers}`, `/I${addonRoot}`, `/I${inputs}`, source, pathUtil, delayLoadHook,
    '/link', '/DLL', '/DYNAMICBASE', '/guard:cf', `/MACHINE:${arch === 'arm64' ? 'ARM64' : 'X64'}`,
    `/OUT:${binary}`, '/DELAYLOAD:node.exe', nodeLib, 'shlwapi.lib', 'delayimp.lib'];
}

function command(file, args, directory) {
  const result = spawnSync(file, args, { cwd: directory, encoding: 'utf8', timeout: 120000,
    maxBuffer: 4 * 1024 * 1024, shell: false });
  assert(!result.error && result.status === 0 && !result.signal,
    `Candidate build command failed: ${result.error?.message ?? `${result.stdout}\n${result.stderr}\nexit=${result.status}`}`);
}

export function buildCandidateAssets({ output, dependencyRoot, headers, nodeLib, delayLoadHook, compiler = 'cl.exe' }) {
  assert(output && dependencyRoot && headers && nodeLib && delayLoadHook,
    'Specify output, dependency-root, headers, node-lib and delay-load-hook');
  const environment = readCandidateBuildEnvironment();
  const includeRoot = fs.realpathSync(headers);
  validateCandidateHeaders(includeRoot, environment.runtime);
  const ptyRoot = path.join(fs.realpathSync(dependencyRoot), 'node-pty');
  const addonRoot = path.join(ptyRoot, 'node_modules/node-addon-api');
  assert.equal(JSON.parse(readRegular(path.join(ptyRoot, 'package.json'))).version, '1.2.0-beta.12');
  assert.equal(JSON.parse(readRegular(path.join(addonRoot, 'package.json'))).version, '7.1.1');
  const original = readRegular(path.join(ptyRoot, 'src/win/conpty.cc'));
  const patched = patchWindowsExecutionProvider(original.toString('utf8'));
  const pathUtil = readRegular(path.join(ptyRoot, 'src/win/path_util.cc'));
  assert.equal(hash(pathUtil), NODE_PTY_PATH_UTIL_SHA256, 'Unexpected node-pty path utility source');
  const inputHeaders = windowsHeaders.map(entry => {
    const bytes = readRegular(path.join(ptyRoot, 'src/win', entry.file));
    assert.equal(hash(bytes), entry.sha256, `Unexpected node-pty ${entry.file} source`);
    return { ...entry, bytes };
  });
  const dependencies = dependencyFiles.map((file, index) => {
    const bytes = readRegular(path.join(ptyRoot, 'third_party/conpty', conptyVersion,
      `win10-${process.arch}`, path.posix.basename(file)));
    assertPE(bytes, process.arch, index === 0);
    return bytes;
  });
  const owner = readRegular(ownerFile);
  const nodeLibrary = readRegular(fs.realpathSync(nodeLib));
  assert(nodeLibrary.length > 0, 'Expected a nonempty node.lib');
  const hook = readRegular(fs.realpathSync(delayLoadHook));
  assert.equal(hash(hook), NODE_GYP_DELAY_LOAD_HOOK_SHA256, 'Unexpected node-gyp delay-load hook source');
  const sources = { ownerSha256: hash(owner), patchSha256: hash(readRegular(patchFile)),
    nodePtySha256: hash(original), patchedSha256: hash(patched), pathUtilSha256: hash(pathUtil),
    windowsHeadersSha256: NODE_PTY_WINDOWS_HEADERS_SHA256, headersSha256: treeHash(includeRoot),
    nodeAddonApiSha256: treeHash(addonRoot), nodeLibSha256: hash(nodeLibrary), delayLoadHookSha256: hash(hook) };
  const directory = path.resolve(output);
  fs.mkdirSync(path.dirname(directory), { recursive: true });
  fs.mkdirSync(directory);
  const inputs = path.join(directory, 'inputs');
  fs.mkdirSync(inputs);
  for (const [file, bytes] of [['windows-execution-owner.h', owner], ['conpty-candidate.cc', patched],
    ['path_util.cc', pathUtil], ['node.lib', nodeLibrary], ['win_delay_load_hook.cc', hook],
    ...inputHeaders.map(entry => [entry.file, entry.bytes])]) {
    fs.writeFileSync(path.join(inputs, file), bytes, { flag: 'wx' });
  }
  const binaryPath = path.join(directory, binaryFile);
  const args = candidateCompilerArguments({ arch: process.arch, headers: includeRoot, addonRoot, inputs,
    source: path.join(inputs, 'conpty-candidate.cc'), pathUtil: path.join(inputs, 'path_util.cc'),
    binary: binaryPath, nodeLib: path.join(inputs, 'node.lib'), delayLoadHook: path.join(inputs, 'win_delay_load_hook.cc') });
  command(compiler, args, directory);
  const binary = readRegular(binaryPath);
  const manifest = { schemaVersion: 1, profile, platform: 'win32', arch: process.arch, ...environment,
    binary: { file: binaryFile, sha256: hash(binary) },
    dependencies: dependencyFiles.map((file, index) => ({ file, sha256: hash(dependencies[index]) })),
    exports: [...WINDOWS_EXECUTION_EXPORTS], sources, compiler: { command: compiler, args },
    verification: { compiled: true, nativeLoaded: false, nativeCalls: false, productValidated: false } };
  validateCandidateManifest(manifest, binary, dependencies);
  fs.mkdirSync(path.join(directory, 'conpty'));
  for (const [index, file] of dependencyFiles.entries()) {
    fs.writeFileSync(path.join(directory, file), dependencies[index], { flag: 'wx' });
  }
  fs.writeFileSync(path.join(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  return { directory, manifest };
}

export function readCandidateAssets(source) {
  assert(source, 'Specify candidate source');
  const directory = fs.realpathSync(source);
  const manifest = JSON.parse(readRegular(path.join(directory, 'manifest.json')));
  assert.equal(manifest.binary?.file, binaryFile);
  assert.deepEqual(manifest.dependencies?.map(entry => entry.file), dependencyFiles);
  const binary = readRegular(path.join(directory, binaryFile));
  const dependencies = dependencyFiles.map(file => readRegular(path.join(directory, file)));
  validateCandidateManifest(manifest, binary, dependencies);
  return { directory, manifest, binary, dependencies };
}

export function importCandidateAssets({ source, dist }) {
  assert(source && dist, 'Specify candidate source and extension dist');
  const { manifest, binary, dependencies } = readCandidateAssets(source);
  const distRoot = fs.realpathSync(dist);
  for (const entry of ['windows-execution-provider.js', 'windows-execution-output-worker.js']) {
    assert(readRegular(path.join(distRoot, entry)).length > 0,
      'Build the formal provider and output worker entries before importing candidate assets');
  }
  const target = path.join(distRoot, candidateAssetRelativePath(manifest.arch));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.mkdirSync(target);
  fs.mkdirSync(path.join(target, 'conpty'));
  fs.writeFileSync(path.join(target, binaryFile), binary, { flag: 'wx' });
  for (const [index, file] of dependencyFiles.entries()) {
    fs.writeFileSync(path.join(target, file), dependencies[index], { flag: 'wx' });
  }
  fs.writeFileSync(path.join(target, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  return { directory: target, manifest };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    const { values, positionals } = parseArgs({ allowPositionals: true, options: {
      output: { type: 'string' }, 'dependency-root': { type: 'string' }, headers: { type: 'string' },
      'node-lib': { type: 'string' }, 'delay-load-hook': { type: 'string' },
      compiler: { type: 'string' }, source: { type: 'string' }, dist: { type: 'string' }
    } });
    assert.equal(positionals.length, 1, 'Choose build or import');
    const result = positionals[0] === 'build'
      ? buildCandidateAssets({ output: values.output, dependencyRoot: values['dependency-root'],
          headers: values.headers, nodeLib: values['node-lib'], delayLoadHook: values['delay-load-hook'], compiler: values.compiler })
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
