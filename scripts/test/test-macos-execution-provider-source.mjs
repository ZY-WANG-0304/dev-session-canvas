import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { MACOS_EXECUTION_EXPORTS, NODE_PTY_SPAWN_HELPER_SHA256,
  patchMacosExecutionProvider } from '../build/macos-execution-provider-patch.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const source = read('node_modules/node-pty/src/unix/pty.cc');
const nativeRoot = 'extensions/vscode/dev-session-canvas/native/';
const mac = read(`${nativeRoot}macos-execution-owner.h`);
const common = read(`${nativeRoot}unix-execution-owner.h`);
const linux = read(`${nativeRoot}linux-execution-owner.h`);
const patched = patchMacosExecutionProvider(source);
const fork = patched.slice(patched.indexOf('Napi::Value PtyFork(const Napi::CallbackInfo& info) {'),
  patched.indexOf('Napi::Value PtyOpen(const Napi::CallbackInfo& info) {'));
const spawn = mac.slice(mac.indexOf('static void Spawn('), mac.indexOf('static bool SameFile('));
const claim = mac.slice(mac.indexOf('static Napi::Value ClaimNamespace('));
const exports = [...patched.matchAll(/exports\.Set\("([^"]+)"/g)].map(match => match[1]).sort();

assert.deepEqual(exports, MACOS_EXECUTION_EXPORTS);
assert.equal(createHash('sha256').update(read('node_modules/node-pty/src/unix/spawn-helper.cc')).digest('hex'),
  NODE_PTY_SPAWN_HELPER_SHA256);
assert.throws(() => patchMacosExecutionProvider(`${source}\n`), /Unexpected node-pty/);
assert.throws(() => patchMacosExecutionProvider(patched), /Unexpected node-pty/);
assert.equal((fork.match(/dsc_execution::BeforeSpawn\(napiEnv, helper_path\)/g) ?? []).length, 1);
assert(fork.indexOf('dsc_execution::BeforeSpawn(') < fork.indexOf('pty_posix_spawn('));
assert(fork.includes('argv[0] = strdup(helper_path.c_str());'));
assert(fork.includes('pid_t pid = -1;'));
assert(!fork.includes('SetupExitCallback('));
assert(!fork.slice(fork.indexOf('pty_posix_spawn('), fork.indexOf('#else', fork.indexOf('pty_posix_spawn(')))
  .includes('close(master)'));
assert(fork.includes('dsc_execution::NonblockReturned(nonblock_result, nonblock_result < 0 ? errno : 0)'));
assert(patched.includes('dsc_execution::Spawn(argv, env, termp, winp, master, pid, err);'));
assert(!patched.includes('low_fds[count] = posix_openpt(O_RDWR)'));
assert(mac.includes('#if !defined(__APPLE__)'));
assert(linux.includes('#if !defined(__linux__)'));
for (const header of [mac, linux]) assert(header.includes('#include "unix-execution-owner.h"'));
assert(!mac.includes('#define __linux__'));

for (const header of [mac, common]) {
  assert(!header.includes('std::thread'));
  assert(!header.includes('threadsafe_function'));
  assert(!header.includes('kqueue('));
}
assert.equal((common.match(/waitpid\(owner\.pid, &status, WNOHANG\)/g) ?? []).length, 1);
assert(!mac.includes('waitpid('));
assert(common.includes('result == owner.pid && (WIFEXITED(status) || WIFSIGNALED(status))'));
assert(common.indexOf('if (!pending) return Result') < common.indexOf('const int result = kill('));
assert.match(common, /if \(count == 0\s*#if defined\(__linux__\)\s*\|\| error == EIO\s*#endif/);
assert(common.includes('buffer.Length() != 4096'));
assert(common.includes('result.Set("creationResources"') || common.includes('AppendCreationResources(env, result)'));
assert.equal((common.match(/close\(owner\.master\)/g) ?? []).length, 1);
assert(common.indexOf('owner.closeAttempted = true;') < common.indexOf('close(owner.master)'));

assert.deepEqual([...mac.matchAll(/\{"(pty-[a-z0-9-]+)"\}/g)].map(match => match[1]),
  ['pty-low-fd-0', 'pty-low-fd-1', 'pty-low-fd-2', 'pty-spawn-actions', 'pty-spawn-attrs', 'pty-slave']);
assert(mac.includes('if (!resource.acquired) continue;'));
assert(mac.includes('if (!resource.acquired || resource.releaseAttempted) return;'));
for (const property of ['resourceId', 'acquired', 'releaseAttempted', 'releaseResult', 'releaseErrno']) {
  assert(mac.includes(`item.Set("${property}"`));
}
assert(spawn.indexOf('owner.masterAcquired = true;') < spawn.indexOf('grantpt(*master)'));
assert(spawn.indexOf('owner.childAcquired = true;') > spawn.indexOf('result = posix_spawn('));
assert(!spawn.includes('close(*master)'));
assert(!spawn.includes('do\n'));
assert(spawn.includes('if (creationResources[3].acquired)'));
assert(spawn.includes('if (creationResources[4].acquired)'));
assert(spawn.includes('resource.releaseResult != 0'));
for (const operation of ['posix_spawn_file_actions_init', 'posix_spawnattr_init',
  'posix_spawn_file_actions_adddup2', 'posix_spawn_file_actions_addclose',
  'posix_spawnattr_setflags', 'posix_spawnattr_setsigdefault', 'posix_spawnattr_setsigmask', 'posix_spawn']) {
  const escaped = operation.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  assert.match(spawn, new RegExp(`(?:int )?result = ${escaped}\\([^;]+;\\s*if \\(result != 0\\) return result;`));
}

assert(claim.includes('owner.configured || NamespaceClaimed()'));
assert(common.includes('if (NamespaceClaimed()) throw'));
assert(claim.includes('O_RDWR | O_CREAT | O_NOFOLLOW | O_CLOEXEC, 0600'));
assert(claim.includes('parent != canonical'));
assert(claim.includes('(directory.st_mode & 07777) != 0700'));
assert(mac.includes('state.st_uid == geteuid() && state.st_nlink == 1'));
assert(mac.includes('(state.st_mode & 07777) == 0600 && state.st_size == 0'));
assert.equal((claim.match(/SameFile\(opened, current\)/g) ?? []).length, 2);
assert(claim.includes('flock(fd, LOCK_EX | LOCK_NB) == 0'));
assert(claim.indexOf('flock(fd, LOCK_EX | LOCK_NB)') < claim.indexOf('namespaceFd = fd;'));
assert(!claim.includes('unlink('));
assert(!claim.includes('LOCK_UN'));
assert.equal((claim.match(/close\(fd\)/g) ?? []).length, 1);
assert(claim.indexOf('close(fd)') < claim.indexOf('namespaceFd = fd;'));

console.log('macOS provider source assertions passed (zero native loads, claims or PTYs).');
