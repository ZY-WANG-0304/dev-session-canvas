import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { LINUX_EXECUTION_EXPORTS, NODE_PTY_UNIX_SHA256, patchLinuxExecutionProvider } from './linux-execution-provider-patch.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const nodeVersion = '22.23.2';
const headersHash = '85e104c89fdba601b92c2c03dfb50291561226716ab6555bf8be2a59a13e11a6';
const { values } = parseArgs({ options: {
  output: { type: 'string' },
  'dependency-root': { type: 'string' },
  headers: { type: 'string' }
} });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const digest = file => hash(fs.readFileSync(file));

function treeHash(directory) {
  const files = (directory, prefix = '') => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    assert(!entry.isSymbolicLink(), `Unexpected input symlink: ${path.join(directory, entry.name)}`);
    const relative = path.posix.join(prefix, entry.name);
    return entry.isDirectory() ? files(path.join(directory, entry.name), relative) : [relative];
  }).sort();
  return hash(JSON.stringify(files(directory).map(file => ({ file, sha256: digest(path.join(directory, file)) }))));
}

function save(directory, name, value) {
  fs.writeFileSync(path.join(directory, name), `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
}

function command(file, args, cwd, timeout = 120000) {
  const result = spawnSync(file, args, { cwd, encoding: 'utf8', timeout, maxBuffer: 8 * 1024 * 1024 });
  return { file, args, cwd, status: result.status, signal: result.signal,
    error: result.error?.message ?? null, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function successful(result, message) {
  assert(result.status === 0 && !result.signal && !result.error,
    `${message}: ${result.error ?? result.stderr ?? result.status}`);
}

function build(directory) {
  const record = { kind: 'linux-execution-provider-s3', status: 'preparing', nativeCalls: 0,
    platform: process.platform, arch: process.arch, node: process.versions.node,
    executable: { path: fs.realpathSync(process.execPath), sha256: digest(process.execPath) } };
  try {
    const dependencies = fs.realpathSync(values['dependency-root']);
    const headers = fs.realpathSync(values.headers);
    const ptyRoot = path.join(dependencies, 'node-pty');
    const addonRoot = path.join(ptyRoot, 'node_modules/node-addon-api');
    assert.equal(JSON.parse(fs.readFileSync(path.join(ptyRoot, 'package.json'))).version, '1.2.0-beta.12');
    assert.equal(JSON.parse(fs.readFileSync(path.join(addonRoot, 'package.json'))).version, '7.1.1');
    assert.equal(treeHash(headers), headersHash, 'Use the frozen official Node 22.23.2 headers');
    const original = fs.readFileSync(path.join(ptyRoot, 'src/unix/pty.cc'), 'utf8');
    assert.equal(hash(original), NODE_PTY_UNIX_SHA256);
    const patched = patchLinuxExecutionProvider(original);
    const inputs = path.join(directory, 'inputs');
    fs.mkdirSync(inputs);
    const sources = [
      'extensions/vscode/dev-session-canvas/native/linux-execution-owner.h',
      'extensions/vscode/dev-session-canvas/native/unix-execution-owner.h',
      'scripts/build/linux-execution-provider-patch.mjs',
      'scripts/build/build-linux-execution-provider.mjs'
    ];
    for (const source of sources)
      fs.copyFileSync(path.join(root, source), path.join(inputs, path.basename(source)), fs.constants.COPYFILE_EXCL);
    fs.writeFileSync(path.join(inputs, 'pty-original.cc'), original, { flag: 'wx' });
    const source = path.join(inputs, 'pty-patched.cc');
    fs.writeFileSync(source, patched, { flag: 'wx' });
    record.sources = { nodePty: '1.2.0-beta.12', nodeAddonApi: '7.1.1',
      originalSha256: hash(original), patchedSha256: hash(patched),
      headers: { path: headers, sha256: headersHash },
      addon: { path: addonRoot, sha256: treeHash(addonRoot) },
      implementation: sources.map(file => ({ file, sha256: digest(path.join(inputs, path.basename(file))) })) };

    const locate = command('which', ['g++'], directory, 10000);
    successful(locate, 'Locate compiler');
    const compiler = fs.realpathSync(locate.stdout.trim());
    const version = command(compiler, ['--version'], directory, 10000);
    successful(version, 'Read compiler version');
    record.compiler = { path: compiler, sha256: digest(compiler), version: version.stdout,
      environment: Object.fromEntries(['CPATH', 'CPLUS_INCLUDE_PATH', 'LIBRARY_PATH', 'LD_LIBRARY_PATH',
        'GCC_EXEC_PREFIX', 'COMPILER_PATH'].map(name => [name, process.env[name] ?? null])) };
    const binary = path.join(directory, 'pty.node');
    const args = ['-std=c++17', '-shared', '-fPIC', '-pthread', '-fexceptions', '-DNAPI_CPP_EXCEPTIONS',
      '-DNODE_GYP_MODULE_NAME=pty', '-I', headers, '-I', addonRoot, '-I', inputs,
      '-MD', '-MF', path.join(directory, 'compiler-dependencies.d'), source, '-o', binary, '-lutil'];
    const compiled = command(compiler, args, directory);
    save(directory, 'build-command.json', compiled);
    successful(compiled, 'Compile isolated execution provider');
    record.binary = { path: binary, sha256: digest(binary) };

    const program = 'const fs=require("node:fs");const file=fs.realpathSync(process.argv[1]);'
      + 'const addon=require(file);console.log(JSON.stringify({path:file,'
      + 'loaded:Object.keys(require.cache).filter(key=>key.endsWith(".node")),'
      + 'exports:Object.keys(addon).sort(),types:Object.fromEntries(Object.entries(addon).map(([key,value])=>[key,typeof value])),nativeCalls:0}));';
    const loaded = command(process.execPath, ['-e', program, binary], directory, 10000);
    save(directory, 'load-command.json', loaded);
    successful(loaded, 'Load exact binary without calling exports');
    record.load = JSON.parse(loaded.stdout);
    assert.equal(record.load.path, binary);
    assert.deepEqual(record.load.loaded, [binary]);
    assert.deepEqual(record.load.exports, LINUX_EXECUTION_EXPORTS);
    for (const name of LINUX_EXECUTION_EXPORTS) assert.equal(record.load.types[name], 'function');
    assert.equal(record.load.nativeCalls, 0);
    record.status = 'built-and-load-verified';
  } catch (error) {
    record.status = 'failed';
    record.error = error.stack ?? String(error);
  }
  save(directory, 'build.json', record);
  console.log(JSON.stringify({ status: record.status, directory, binary: record.binary, nativeCalls: 0 }));
  assert.equal(record.status, 'built-and-load-verified', record.error);
}

try {
  assert.equal(process.platform, 'linux', 'The S3 candidate is Linux-only');
  assert.equal(process.versions.node, nodeVersion, 'Use the frozen Node 22.23.2 runtime');
  assert(values.output && values.headers && values['dependency-root'],
    'Specify --output, --dependency-root and --headers');
  const directory = path.resolve(values.output);
  fs.mkdirSync(path.dirname(directory), { recursive: true });
  fs.mkdirSync(directory);
  build(directory);
} catch (error) {
  console.error(error.stack ?? String(error));
  process.exitCode = 1;
}
