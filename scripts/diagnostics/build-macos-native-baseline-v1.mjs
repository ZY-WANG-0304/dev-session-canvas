import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const script = fileURLToPath(import.meta.url);
const sourceDirectory = path.dirname(script);
const nodeVersion = '22.23.2';
const ptyVersion = '1.2.0-beta.12';
const addonVersion = '7.1.1';
const originalSourceHash = '19210adfdaba3cd09809b56bb3281b14e74a8e5efc1f35d467d3c423c30856db';
const helperSourceHash = '22195de1710b574d5904fc89be5624c25e531de20d5e17e5998a2fd19d86e0e6';
const officialHeaderTreeHash = '85e104c89fdba601b92c2c03dfb50291561226716ab6555bf8be2a59a13e11a6';
const { values } = parseArgs({ options: {
  output: { type: 'string' }, 'dependency-root': { type: 'string' }, headers: { type: 'string' },
} });

try {
  assert.equal(process.platform, 'darwin', 'This candidate build is macOS-only');
  assert.equal(process.versions.node, nodeVersion, 'Use the frozen Node runtime');
  assert(['arm64', 'x64'].includes(process.arch), 'Unsupported macOS architecture');
  assert(values.output && values.headers && values['dependency-root'], 'Specify --output, --dependency-root and --headers');
  await build(freshDirectory(values.output));
} catch (error) {
  console.error(error.stack ?? String(error)); process.exitCode = 1;
}

function hash(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function digest(file) { return hash(fs.readFileSync(file)); }
function save(directory, name, value) {
  fs.writeFileSync(path.join(directory, name), `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
}
function freshDirectory(value) {
  const directory = path.resolve(value);
  fs.mkdirSync(path.dirname(directory), { recursive: true }); fs.mkdirSync(directory); return directory;
}
function command(file, args, cwd, timeout = 120000) {
  const started = new Date().toISOString();
  const result = spawnSync(file, args, { cwd, encoding: 'utf8', timeout, maxBuffer: 32 * 1024 * 1024 });
  return { file, args, cwd, started, ended: new Date().toISOString(), status: result.status,
    signal: result.signal, error: result.error?.message ?? null, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}
function successful(result, message) {
  assert(result.status === 0 && !result.signal && !result.error, `${message}: ${result.error ?? result.stderr ?? result.status}`);
}
function entries(directory, prefix = '') {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    assert(!entry.isSymbolicLink(), `Unexpected input symlink: ${path.join(directory, entry.name)}`);
    const relative = path.posix.join(prefix, entry.name);
    return entry.isDirectory() ? entries(path.join(directory, entry.name), relative) : [relative];
  }).sort();
}
function tree(directory) {
  const files = entries(directory).map(file => ({ file, sha256: digest(path.join(directory, file)) }));
  return { sha256: hash(JSON.stringify(files)), files };
}
function copyTree(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const relative of entries(source)) {
    const output = path.join(destination, relative); fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.copyFileSync(path.join(source, relative), output, fs.constants.COPYFILE_EXCL);
  }
}
function versionFromHeaders(headers) {
  const source = fs.readFileSync(path.join(headers, 'node_version.h'), 'utf8');
  return ['MAJOR', 'MINOR', 'PATCH'].map(part => {
    const match = source.match(new RegExp(`^#define NODE_${part}_VERSION\\s+(\\d+)$`, 'm'));
    assert(match, `Missing Node ${part} version`); return match[1];
  }).join('.');
}
function seal(directory) { save(directory, 'manifest.json', tree(directory)); }

async function build(directory) {
  const record = { kind: 'macos-native-baseline-v1-build', status: 'preparing', nativeExecutions: 0,
    platform: process.platform, arch: process.arch, kernel: os.release(), versions: process.versions,
    executable: { path: fs.realpathSync(process.execPath), sha256: digest(process.execPath) },
    github: { sha: process.env.GITHUB_SHA ?? null, run: process.env.GITHUB_RUN_ID ?? null,
      attempt: process.env.GITHUB_RUN_ATTEMPT ?? null, image: process.env.ImageVersion ?? null } };
  try {
    const dependencies = path.resolve(values['dependency-root']), headers = path.resolve(values.headers);
    const ptyRoot = path.join(dependencies, 'node-pty'), addonRoot = path.join(ptyRoot, 'node_modules/node-addon-api');
    assert.equal(JSON.parse(fs.readFileSync(path.join(ptyRoot, 'package.json'))).version, ptyVersion);
    assert.equal(JSON.parse(fs.readFileSync(path.join(addonRoot, 'package.json'))).version, addonVersion);
    assert.equal(versionFromHeaders(headers), nodeVersion, 'Header/runtime mismatch');
    const original = fs.readFileSync(path.join(ptyRoot, 'src/unix/pty.cc'), 'utf8');
    const helperSource = fs.readFileSync(path.join(ptyRoot, 'src/unix/spawn-helper.cc'));
    assert.equal(hash(original), originalSourceHash, 'Fixed node-pty input changed');
    assert.equal(hash(helperSource), helperSourceHash, 'Fixed spawn-helper input changed');
    const inputs = path.join(directory, 'inputs'); fs.mkdirSync(inputs);
    const names = ['build-macos-native-baseline-v1.mjs', 'macos-native-baseline-patch-v1.mjs', 'macos-native-baseline-support-v1.h'];
    for (const name of names) fs.copyFileSync(path.join(sourceDirectory, name), path.join(inputs, name), fs.constants.COPYFILE_EXCL);
    for (const name of ['package.json', 'binding.gyp']) fs.copyFileSync(path.join(ptyRoot, name), path.join(inputs, `node-pty-${name}`), fs.constants.COPYFILE_EXCL);
    fs.writeFileSync(path.join(inputs, 'pty-before.cc'), original, { flag: 'wx' });
    fs.writeFileSync(path.join(inputs, 'spawn-helper.cc'), helperSource, { flag: 'wx' });
    copyTree(headers, path.join(inputs, 'node-headers')); copyTree(addonRoot, path.join(inputs, 'node-addon-api'));
    assert.equal(tree(path.join(inputs, 'node-headers')).sha256, officialHeaderTreeHash, 'Use the frozen official headers');
    const patch = await import(pathToFileURL(path.join(inputs, 'macos-native-baseline-patch-v1.mjs')).href);
    assert.equal(patch.UNIX_SOURCE_SHA256, originalSourceHash);
    const patched = patch.patchMacosSource(original);
    fs.writeFileSync(path.join(inputs, 'pty-after.cc'), patched, { flag: 'wx' });
    record.sources = { originalSha256: hash(original), patchedSha256: hash(patched), helperSourceSha256: hash(helperSource),
      dependencyRoot: dependencies, nodePty: ptyVersion, addon: addonVersion,
      headers: { path: headers, version: nodeVersion, ...tree(path.join(inputs, 'node-headers')) },
      addonTree: tree(path.join(inputs, 'node-addon-api')),
      tools: names.map(name => ({ name, sha256: digest(path.join(inputs, name)) })) };
    save(directory, 'inputs.json', record.sources);
    const located = command('xcrun', ['--find', 'clang++'], directory);
    save(directory, 'compiler-location.json', located); successful(located, 'Locate SDK compiler');
    const compiler = located.stdout.trim();
    const resolvedCompiler = fs.realpathSync(compiler);
    const compilerVersion = command(compiler, ['--version'], directory);
    save(directory, 'compiler-version.json', compilerVersion); successful(compilerVersion, 'Compiler version');
    record.compiler = { path: compiler, resolvedPath: resolvedCompiler, sha256: digest(resolvedCompiler), version: compilerVersion.stdout,
      environment: Object.fromEntries(['CPATH', 'CPLUS_INCLUDE_PATH', 'LIBRARY_PATH', 'DYLD_LIBRARY_PATH', 'SDKROOT',
        'MACOSX_DEPLOYMENT_TARGET', 'DEVELOPER_DIR', 'CC', 'CXX', 'CFLAGS', 'CXXFLAGS', 'LDFLAGS']
        .map(name => [name, process.env[name] ?? null])) };
    const sdkPath = command('xcrun', ['--show-sdk-path'], directory);
    save(directory, 'sdk-location.json', sdkPath); successful(sdkPath, 'Locate SDK');
    const sdkVersion = command('xcrun', ['--show-sdk-version'], directory);
    save(directory, 'sdk-version.json', sdkVersion); successful(sdkVersion, 'SDK version');
    const sdk = fs.realpathSync(sdkPath.stdout.trim());
    record.sdk = { path: sdk, version: sdkVersion.stdout.trim(), settings: [] };
    for (const name of ['SDKSettings.json', 'SDKSettings.plist']) {
      const file = path.join(sdk, name);
      if (!fs.existsSync(file)) continue;
      fs.copyFileSync(file, path.join(inputs, name), fs.constants.COPYFILE_EXCL);
      record.sdk.settings.push({ name, sha256: digest(file) });
    }
    assert(record.sdk.settings.length > 0, 'Missing SDK identity');
    const osVersion = command('sw_vers', [], directory);
    save(directory, 'os-version.json', osVersion); successful(osVersion, 'macOS version'); record.osVersion = osVersion.stdout;
    const arch = process.arch === 'arm64' ? 'arm64' : 'x86_64';
    const binary = path.join(directory, 'pty.node');
    const args = ['-std=c++17', '-bundle', '-undefined', 'dynamic_lookup', '-fPIC', '-pthread', '-fexceptions',
      '-stdlib=libc++', '-isysroot', sdk, '-arch', arch, '-DNAPI_CPP_EXCEPTIONS', '-DNODE_GYP_MODULE_NAME=pty',
      '-I', path.join(inputs, 'node-headers'), '-I', path.join(inputs, 'node-addon-api'), '-I', inputs,
      '-MD', '-MF', path.join(directory, 'compiler-dependencies.d'), path.join(inputs, 'pty-after.cc'), '-o', binary, '-v'];
    const result = command(compiler, args, directory);
    save(directory, 'build-command.json', result); successful(result, 'Isolated macOS N-API build');
    record.binary = { path: binary, sha256: digest(binary) };
    const helper = path.join(directory, 'spawn-helper');
    const helperArgs = ['-std=c++17', '-stdlib=libc++', '-isysroot', sdk, '-arch', arch,
      '-MD', '-MF', path.join(directory, 'helper-compiler-dependencies.d'), path.join(inputs, 'spawn-helper.cc'), '-o', helper, '-v'];
    const helperResult = command(compiler, helperArgs, directory);
    save(directory, 'helper-build-command.json', helperResult); successful(helperResult, 'Same-source spawn-helper build');
    record.helper = { path: helper, sha256: digest(helper), mode: fs.statSync(helper).mode & 0o777 };
    assert(record.helper.mode & 0o111, 'Spawn helper is not executable');
    const loadProgram = 'const fs=require("node:fs");const p=fs.realpathSync(process.argv[1]);const addon=require(p);'
      + 'console.log(JSON.stringify({path:p,loaded:Object.keys(require.cache).filter(k=>k.endsWith(".node")),exports:Object.keys(addon).sort(),types:Object.fromEntries(Object.entries(addon).map(([k,v])=>[k,typeof v])),nativeCalls:0}));';
    const loaded = command(process.execPath, ['-e', loadProgram, binary], directory, 10000);
    save(directory, 'load-command.json', loaded); successful(loaded, 'Load explicit macOS candidate');
    record.load = JSON.parse(loaded.stdout);
    assert.equal(record.load.path, binary); assert.deepEqual(record.load.loaded, [binary], 'No fallback native binary may load');
    for (const name of ['fork', 'open', 'resize', 'process', 'failureConfigure', 'failureSnapshot', 'failureCloseMaster'])
      assert.equal(record.load.types[name], 'function', `Missing candidate export: ${name}`);
    assert.equal(record.load.nativeCalls, 0); record.status = 'built-and-load-verified';
  } catch (error) { record.status = 'failed'; record.error = error.stack ?? String(error); }
  save(directory, 'build.json', record); seal(directory);
  console.log(JSON.stringify({ status: record.status, directory, binary: record.binary, helper: record.helper, nativeExecutions: 0 }));
  assert.equal(record.status, 'built-and-load-verified', record.error);
}
