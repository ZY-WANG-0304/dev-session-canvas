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
    'RecordLocked("kqueue-owner-registered", kq, 0, pid);',
    'RecordLocked("kqueue-register-failure", -1, EIO, kq);',
    'waited = waitpid(pid, &status, 0);', 'ledger.waitPid = waited;',
    'RecordLocked("wait-unknown", waited, error, waited == pid ? status : 0);',
    'RecordLocked("kqueue-close-enter", kq);', 'ledger.kqueueCloseReturned = result == 0'])
    assert(support.includes(expected), expected);
  assert(!support.includes('kevent(kq, &change, 1, nullptr, 0, nullptr)'));
  assert(!support.includes('kevent(kq, nullptr, 0, &event, 1, nullptr)'));
  assert.equal(support.split('result = close(kq)').length - 1, 1);
  assert.equal(support.split('result = close(fd)').length - 1, 2);
  assert(!support.includes('kill('));
  assert(!support.includes('WNOHANG'));
  assert.equal(support.split('waitpid(pid, &status, 0)').length - 1, 1);
  assert(!support.includes('while (waited == -1 && error == EINTR)'));
  assert(support.indexOf('ledger.kqueueOwnerRegistered = true;') < support.indexOf('RecordLocked("kqueue-owner-registered"'));
  assert(support.indexOf('RecordLocked("kqueue-return"') < support.indexOf('RecordLocked("kqueue-owner-registered"'));
  assert(support.indexOf('RecordLocked("kqueue-owner-registered"') < support.indexOf('RecordLocked("kqueue-register-enter"'));
  assert(support.indexOf('waited = waitpid(') < support.indexOf('result = close(kq)'));
  assert(support.indexOf('result = close(kq)') < support.indexOf('napi_call_threadsafe_function(tsfn, payload.get()'));
  assert.match(support, /if \(decoded\) \{\s*\{ std::lock_guard<std::mutex> lock\(ledgerMutex\); \+\+ledger\.kqueueCloseCalls;/);
  assert.match(support, /if \(decoded\) \{\s*std::unique_ptr<ExitPayload, PayloadDeleter> payload/);
  assert(support.includes('out.Set("registrationErrorSource", state.registrationFailureInjected'));
  assert(support.includes('Napi::String::New(env, "native-substitute")'));
});

test('Darwin U1-6 records actual executing thread identities without allocating in the event recorder', () => {
  assert(support.includes('std::thread::id thread;'));
  assert(support.includes('std::thread::id waitThreadId;'));
  assert(support.includes('event.thread = std::this_thread::get_id();'));
  assert(support.includes('ledger.waitThreadId = std::this_thread::get_id();'));
  assert(support.includes('out.Set("waitThreadId", ThreadIdentity(state.waitThreadId));'));
  assert(support.includes('item.Set("thread", ThreadIdentity(event.thread));'));
  assert(!support.includes('"wait-thread-1"'));
  const recorder = support.slice(support.indexOf('static void RecordLocked('), support.indexOf('static void Record('));
  assert(!recorder.includes('ThreadIdentity('));
  assert(!recorder.includes('ostringstream'));
  assert(support.indexOf('ledger.waitThreadId = std::this_thread::get_id();') < support.indexOf('Record("kqueue-enter")'));
});
