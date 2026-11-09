import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const source = fileURLToPath(new URL('../../extensions/vscode/dev-session-canvas/native/shared-canvas-lock.cc', import.meta.url));

export function sharedCanvasLockCompilerArguments({ platform = process.platform, arch = process.arch,
  headers, binary, nodeLib, delayLoadHook }) {
  assert(['x64', 'arm64'].includes(arch), 'Shared Canvas lock supports x64/arm64 build targets');
  if (platform === 'win32') {
    assert(nodeLib && delayLoadHook, 'Windows builds require explicit node.lib and node-gyp delay-load hook');
    return ['/nologo', '/LD', '/MT', '/EHsc', '/std:c++17', '/guard:cf', '/sdl', '/W4',
      '/DWIN32_LEAN_AND_MEAN', '/DBUILDING_NODE_EXTENSION', '/DNAPI_VERSION=8',
      '/DHOST_BINARY="node.exe"', '/DNODE_GYP_MODULE_NAME=shared_canvas_lock', `/I${headers}`, source, delayLoadHook,
      '/link', '/DLL', '/DYNAMICBASE', '/guard:cf', `/MACHINE:${arch === 'arm64' ? 'ARM64' : 'X64'}`,
      `/OUT:${binary}`, '/DELAYLOAD:node.exe', nodeLib, 'advapi32.lib', 'delayimp.lib'];
  }
  assert(['linux', 'darwin'].includes(platform), `Unsupported native lock platform: ${platform}`);
  return ['-std=c++17', ...(platform === 'darwin' ? ['-bundle', '-undefined', 'dynamic_lookup',
    '-arch', arch === 'arm64' ? 'arm64' : 'x86_64'] : ['-shared']),
    '-fPIC', '-pthread', '-fexceptions', '-Wall', '-Wextra', '-Werror', '-DNAPI_VERSION=8',
    '-DNODE_GYP_MODULE_NAME=shared_canvas_lock', '-I', headers, source, '-o', binary];
}

export function buildSharedCanvasLock({ output, headers, compiler, nodeLib, delayLoadHook }) {
  assert(output && headers, 'Specify an output directory and Node header directory');
  assert(Number(process.versions.napi) >= 8, 'The build runtime must support Node-API 8');
  const include = fs.realpathSync(headers);
  assert(fs.statSync(path.join(include, 'node_api.h')).isFile(), 'Node-API headers are required');
  const version = fs.readFileSync(path.join(include, 'node_version.h'), 'utf8');
  const headerVersion = ['MAJOR', 'MINOR', 'PATCH'].map(part => {
    const match = version.match(new RegExp(`^#define NODE_${part}_VERSION (\\d+)\\s*$`, 'm'));
    assert(match, `Missing Node ${part} version header`);
    return match[1];
  }).join('.');
  assert.equal(headerVersion, process.versions.node, 'Use headers matching the explicit build runtime');
  const directory = path.resolve(output);
  fs.mkdirSync(directory, { recursive: true });
  const binary = path.join(directory, 'shared-canvas-lock.node');
  assert(!fs.existsSync(binary), 'Refusing to overwrite an existing native lock binary');
  const args = sharedCanvasLockCompilerArguments({ headers: include, binary, nodeLib, delayLoadHook });
  const executable = compiler ?? (process.platform === 'win32' ? 'cl.exe' : process.platform === 'darwin' ? 'clang++' : 'g++');
  const result = spawnSync(executable, args, { cwd: directory, encoding: 'utf8', timeout: 120000,
    maxBuffer: 4 * 1024 * 1024, shell: false });
  assert(!result.error && result.status === 0 && !result.signal,
    `Native lock compilation failed: ${result.error?.message ?? `${result.stdout}\n${result.stderr}\nexit=${result.status}`}`);
  return { binary, platform: process.platform, arch: process.arch, napi: 8,
    verification: { compiled: true, productValidated: false } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: {
    output: { type: 'string' }, headers: { type: 'string' }, compiler: { type: 'string' },
    'node-lib': { type: 'string' }, 'delay-load-hook': { type: 'string' }
  } });
  console.log(JSON.stringify(buildSharedCanvasLock({ ...values, nodeLib: values['node-lib'],
    delayLoadHook: values['delay-load-hook'] }), null, 2));
}
