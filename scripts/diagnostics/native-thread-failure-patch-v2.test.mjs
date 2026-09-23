import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { patchUnixSource, UNIX_SOURCE_SHA256 } from './unix-native-failure-patch-v2.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const support = fs.readFileSync(path.join(directory, 'unix-native-failure-support-v2.h'), 'utf8');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const ordered = (source, ...needles) => {
  let cursor = -1;
  for (const needle of needles) {
    const next = source.indexOf(needle, cursor + 1);
    assert(next > cursor, `Missing or unordered source anchor: ${needle}`);
    cursor = next;
  }
};

test('v2 patches only the fixed original and registers ownership before post-fork work', () => {
  assert(process.env.DSC_DEPENDENCY_ROOT, 'Set the locked read-only DSC_DEPENDENCY_ROOT');
  const original = fs.readFileSync(path.join(process.env.DSC_DEPENDENCY_ROOT, 'node-pty/src/unix/pty.cc'), 'utf8');
  assert.equal(sha256(original), UNIX_SOURCE_SHA256);
  const patched = patchUnixSource(original);
  ordered(patched, 'dsc_failure::BeforeFork(napiEnv);', 'dsc_failure::ForkEnter();',
    'pid = forkpty(', 'if (pid != 0) dsc_failure::ForkReturned', '  if (!pid)');
  ordered(patched, 'dsc_failure::NonblockEnter();', 'const int result = pty_nonblock(master);',
    'dsc_failure::NonblockReturned(', 'dsc_failure::SetupExitCallback(napiEnv, cb, pid);');
  assert.equal(patched.split('  dsc_failure::SetupExitCallback(napiEnv, cb, pid);').length - 1, 1);
  assert.equal(patched.split('  SetupExitCallback(napiEnv, cb, pid);').length - 1, 0);
  assert(patched.includes('#include "unix-native-failure-support-v2.h"'));
  assert(patched.includes('exports.Set("failurePollWait", Napi::Function::New(env, dsc_failure::PollWait));'));
  assert(!patched.includes('InjectNonblockFailure'));
  assert.throws(() => patchUnixSource(original + '\n'), /Unexpected Unix/);
});

test('thread failure is injected after real TSFN acquisition and takes the shared cleanup catch', () => {
  const setup = support.slice(support.indexOf('static void SetupExitCallback('));
  ordered(setup, 'napi_create_threadsafe_function(env, cb, nullptr, name, 0, 1,',
    'if (status != napi_ok) throw', 'if (inject)',
    'ledger.threadFailureInjected = true;', 'RecordLocked("thread-construction-skipped", -1, EAGAIN);',
    'throw std::system_error(EAGAIN,', 'ledger.threadConstructCalled = true;',
    'waiter = std::thread(Wait, tsfn, pid);', 'ledger.threadConstructReturned = true;',
    'catch (const std::system_error& error)', 'ledger.threadStartFailed = true;',
    'CloseMasterOwned();', 'TerminateBeforeWaiter();', 'Release(tsfn);',
    'failure.Set("code", "DSC_THREAD_START_FAILED");', 'throw failure;');
  assert.equal(setup.split('waiter = std::thread(').length - 1, 1);
  assert(!setup.includes('payload-allocated'));
  assert(!setup.includes('waitpid('));
  assert(!support.includes('scenario != "U1-1"'));
});

test('polling is token-bound, one WNOHANG call, terminal-aware and cannot restart a settled reaper', () => {
  const poll = support.slice(support.indexOf('static Napi::Value PollWait('), support.indexOf('struct ExitPayload'));
  ordered(poll, 'token != ledger.token', 'ledger.threadStartFailed', 'ledger.threadConstructReturned',
    'ledger.waitConfirmed', 'ledger.pollWaitStopped', 'ledger.pollWaitInFlight', 'ledger.pollWaitCalls >= 60',
    'pid = ledger.pid;', 'RecordLocked("wait-poll-enter", pid, 0, WNOHANG);',
    'const pid_t result = waitpid(pid, &status, WNOHANG);',
    'RecordLocked("wait-poll-return", result, error, result == pid ? status : 0);',
    'result == pid && (WIFEXITED(status) || WIFSIGNALED(status))',
    'ledger.waitConfirmed = true; ledger.pollWaitStopped = true; ledger.pollWaitDisposition = 2;',
    'result == 0 || (result == -1 && error == EINTR)',
    'ledger.pollWaitCalls == 60', 'RecordLocked("wait-poll-limit", ledger.pollWaitCalls);');
  assert.equal(poll.split('waitpid(').length - 1, 1);
  assert(!poll.includes('std::thread('));
  assert(!poll.includes('kill('));
  const terminate = support.slice(support.indexOf('static void TerminateBeforeWaiter('), support.indexOf('static Napi::Value PollWait('));
  ordered(terminate, 'ledger.waitConfirmed', 'ledger.threadConstructReturned', 'ledger.pollWaitCalls',
    'pid = ledger.pid;', 'kill(pid, SIGTERM)');
});

test('unstarted thread finalization remains not-joinable and frozen v1 source files stay unchanged', () => {
  const finalizer = support.slice(support.indexOf('static void Finalize('), support.indexOf('static void Release('));
  ordered(finalizer, 'if (waiter.joinable())', 'waiter.join();', 'ledger.threadJoined = true;',
    'else Record("thread-not-joinable");', 'ledger.tsfnFinalized = true;');
  for (const [name, expected] of [
    ['unix-native-failure-support-v1.h', '772f25630b5e68019b5b9da3563973e21c15f56668c603e3dd70269124207da6'],
    ['unix-native-failure-patch-v1.mjs', 'dc8333d041caade50e4405f82d68a40f0201317f1909fadde9af8c94fc2714c5'],
    ['build-native-failure-v1.mjs', '72c901f9ec56fa0471ed356ed2b01c2629e431d29dd2d46fbfff7c9bd632768b'],
  ]) assert.equal(sha256(fs.readFileSync(path.join(directory, name))), expected, name);
  const builder = fs.readFileSync(path.join(directory, 'build-native-failure-v2.mjs'), 'utf8');
  assert(!builder.includes('download-headers'));
  assert(!builder.includes("command('curl'"));
  assert(builder.includes("'failureCloseMaster', 'failurePollWait'"));
});
