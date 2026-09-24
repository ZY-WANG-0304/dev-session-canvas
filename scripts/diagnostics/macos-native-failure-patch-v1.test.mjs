import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { patchMacosSource } from './macos-native-failure-patch-v1.mjs';

const dependencies = process.env.DSC_NATIVE_DEPENDENCY_ROOT ?? path.resolve('node_modules');
const original = fs.readFileSync(path.join(dependencies, 'node-pty/src/unix/pty.cc'), 'utf8');
const support = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'macos-native-failure-support-v1.h'), 'utf8');

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
  assert(patched.includes('#include "macos-native-failure-support-v1.h"'));
  assert(!patched.includes('#include "macos-native-baseline-support-v1.h"'));
  assert(!patched.includes('unix-native-failure-support-v4.h'));
  assert.throws(() => patchMacosSource(`${original}\n`), /Unexpected Unix node-pty source/);
  assert.throws(() => patchMacosSource(patched), /Unexpected Unix node-pty source/);
});

test('Darwin U1-6 worker substitutes registration failure and reaps before closing kqueue', () => {
  assert(support.includes('#if !defined(__APPLE__)'));
  assert(support.includes('scenario != "U1-6"'));
  for (const expected of ['ledger.registerApiEntered = true;',
    'ledger.registrationFailureInjected = true;', 'ledger.registrationCallInvoked = false;',
    'RecordLocked("kqueue-register-failure", -1, EIO, kq);',
    'waited = waitpid(pid, &status, 0);', 'ledger.waitPid = waited;',
    'RecordLocked("kqueue-close-enter", kq);', 'ledger.kqueueCloseReturned = result == 0'])
    assert(support.includes(expected), expected);
  assert(!support.includes('kevent(kq, &change, 1, nullptr, 0, nullptr)'));
  assert(!support.includes('kevent(kq, nullptr, 0, &event, 1, nullptr)'));
  assert.equal(support.split('result = close(kq)').length - 1, 1);
  assert.equal(support.split('result = close(fd)').length - 1, 2);
  assert(!support.includes('kill('));
  assert(!support.includes('WNOHANG'));
  assert(support.indexOf('waited = waitpid(') < support.indexOf('result = close(kq)'));
  assert(support.indexOf('result = close(kq)') < support.indexOf('napi_call_threadsafe_function(tsfn, payload.get()'));
});
