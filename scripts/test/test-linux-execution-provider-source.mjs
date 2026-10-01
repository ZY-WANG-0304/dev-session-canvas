import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LINUX_EXECUTION_EXPORTS, patchLinuxExecutionProvider } from '../build/linux-execution-provider-patch.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const source = fs.readFileSync(path.join(root, 'node_modules/node-pty/src/unix/pty.cc'), 'utf8');
const linux = fs.readFileSync(path.join(root, 'extensions/vscode/dev-session-canvas/native/linux-execution-owner.h'), 'utf8');
const header = fs.readFileSync(path.join(root, 'extensions/vscode/dev-session-canvas/native/unix-execution-owner.h'), 'utf8');
assert(linux.includes('#if !defined(__linux__)'));
assert(linux.includes('#include "unix-execution-owner.h"'));
const patched = patchLinuxExecutionProvider(source);
const fork = patched.slice(patched.indexOf('Napi::Value PtyFork(const Napi::CallbackInfo& info) {'),
  patched.indexOf('Napi::Value PtyOpen(const Napi::CallbackInfo& info) {'));
const exports = [...patched.matchAll(/exports\.Set\("([^"]+)"/g)].map(match => match[1]).sort();

assert.deepEqual(exports, LINUX_EXECUTION_EXPORTS);
assert.throws(() => patchLinuxExecutionProvider(`${source}\n`), /Unexpected node-pty/);
assert.throws(() => patchLinuxExecutionProvider(patched), /Unexpected node-pty/);
assert.equal((fork.match(/forkpty\(&master/g) ?? []).length, 1);
assert(fork.indexOf('dsc_execution::BeforeFork(napiEnv)') < fork.indexOf('pid = forkpty'));
assert(fork.indexOf('dsc_execution::ForkReturned') < fork.indexOf('pty_nonblock(master)', fork.indexOf('#else')));
assert(!fork.includes('SetupExitCallback('));
assert(!header.includes('std::thread'));
assert(!header.includes('threadsafe_function'));
assert.equal((header.match(/waitpid\(owner\.pid, &status, WNOHANG\)/g) ?? []).length, 1);
assert(header.includes('buffer.Length() != 4096'));
assert(header.includes('!owner.nonblockConfirmed || owner.closeAttempted'));
assert(header.includes('const bool pending = PollOnce();'));
assert(header.indexOf('if (!pending) return Result') < header.indexOf('const int result = kill('));
assert.equal((header.match(/close\(owner\.master\)/g) ?? []).length, 1);
assert(header.indexOf('owner.closeAttempted = true;') < header.indexOf('close(owner.master)'));
assert(header.includes('result == owner.pid && (WIFEXITED(status) || WIFSIGNALED(status))'));
console.log('Linux execution provider source assertions passed (zero native loads or PTYs).');
