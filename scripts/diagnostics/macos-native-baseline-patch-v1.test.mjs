import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { patchMacosSource } from './macos-native-baseline-patch-v1.mjs';

const dependencies = process.env.DSC_NATIVE_DEPENDENCY_ROOT ?? path.resolve('node_modules');
const original = fs.readFileSync(path.join(dependencies, 'node-pty/src/unix/pty.cc'), 'utf8');
const support = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'macos-native-baseline-support-v1.h'), 'utf8');

test('Darwin transform preserves posix_spawn helper setup and instruments its actual ownership', () => {
  const patched = patchMacosSource(original);
  for (const expected of ['argv[0] = strdup(helper_path.c_str());', 'argv[2] = strdup(file.c_str());',
    'pty_posix_spawn(argv, env, term, &winp, &master, &pid, &err);',
    'dsc_macos::BeforeSpawn(napiEnv, helper_path, file);', 'dsc_macos::OpenMaster()',
    'dsc_macos::OpenLowFd(count)', 'dsc_macos::ActionsInit(&acts)', 'dsc_macos::AttrsInit(&attrs)',
    'dsc_macos::OpenSlave(slave_pty_name, O_RDWR | O_NOCTTY)',
    'dsc_macos::Spawn(pid, argv[0], &acts, &attrs, argv, env)',
    'dsc_macos::ActionsDestroy(&acts)', 'dsc_macos::AttrsDestroy(&attrs)',
    'dsc_macos::CloseResource("slave", slave)', 'dsc_macos::CloseLowFd(i, low_fds[i])',
    'dsc_macos::SetupExitCallback(napiEnv, cb, pid);']) assert(patched.includes(expected), expected);
  assert(!patched.includes('unix-native-failure-support-v4.h'));
  assert.throws(() => patchMacosSource(`${original}\n`), /Unexpected Unix node-pty source/);
  assert.throws(() => patchMacosSource(patched), /Unexpected Unix node-pty source/);
});

test('Darwin worker retains registered kqueue wait, own-pid decode and single-close structure', () => {
  assert(support.includes('#if !defined(__APPLE__)'));
  assert(support.includes('scenario != "U1-0"'));
  for (const expected of ['EV_SET(&change, pid, EVFILT_PROC, EV_ADD, NOTE_EXIT, 0, nullptr);',
    'kevent(kq, &change, 1, nullptr, 0, nullptr)', 'kevent(kq, nullptr, 0, &event, 1, nullptr)',
    'event.filter == EVFILT_PROC', '!(event.flags & EV_ERROR)',
    'waited == pid && (WIFEXITED(status) || WIFSIGNALED(status))',
    'out.Set("nonblockMask", O_NONBLOCK)', 'ledger.kqueueRegistered = registered']) assert(support.includes(expected), expected);
  assert.equal(support.split('result = close(kq)').length - 1, 1);
  assert.equal(support.split('result = close(fd)').length - 1, 2);
  assert(!support.includes('kill('));
  assert(!support.includes('WNOHANG'));
  assert(support.indexOf('if (eventConfirmed)') < support.indexOf('waited = waitpid('));
  assert(support.indexOf('result = close(kq)') < support.indexOf('napi_call_threadsafe_function(tsfn, payload.get()'));
});
