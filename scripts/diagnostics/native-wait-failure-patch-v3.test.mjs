import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { patchUnixSource, UNIX_SOURCE_SHA256 } from './unix-native-failure-patch-v3.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const support = fs.readFileSync(path.join(directory, 'unix-native-failure-support-v3.h'), 'utf8');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const ordered = (source, ...needles) => {
  let cursor = -1;
  for (const needle of needles) {
    const next = source.indexOf(needle, cursor + 1);
    assert(next > cursor, `Missing or unordered source anchor: ${needle}`);
    cursor = next;
  }
};

test('v3 patches only the fixed original and registers ownership before post-fork work', () => {
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
  assert(patched.includes('#include "unix-native-failure-support-v3.h"'));
  assert.throws(() => patchUnixSource(original + '\n'), /Unexpected Unix/);
});

test('the sole worker freezes one synthetic first attempt before the first actual wait', () => {
  const wait = support.slice(support.indexOf('static void Wait('), support.indexOf('static void SetupExitCallback('));
  const beforeActualWait = wait.slice(0, wait.indexOf('  int status = 0, error = 0;'));
  ordered(beforeActualWait, 'std::lock_guard<std::mutex> lock(ledgerMutex);',
    'ledger.threadStarted = true; RecordLocked("thread-started", pid);',
    'std::strcmp(ledger.scenario, "U1-3") == 0',
    'RecordLocked("first-wait-unconfirmed", -1, ECHILD);',
    'if (!ledger.overflow)', 'ledger.firstAttempt = ledger.events[ledger.eventCount - 1];',
    'ledger.firstAttemptRecorded = true;');
  assert.equal(support.split('ledger.firstAttempt =').length - 1, 1);
  assert.equal(support.split('ledger.firstAttemptRecorded =').length - 1, 1);
  assert.equal(support.split('RecordLocked("first-wait-unconfirmed"').length - 1, 1);
  for (const absent of ['waitpid(', 'WIFEXITED(', 'WIFSIGNALED(', 'ExitPayload',
    'napi_call_threadsafe_function(', 'Release(', 'wait-return', 'wait-enter']) {
    assert(!beforeActualWait.includes(absent), `Synthetic first attempt must not use ${absent}`);
  }
  assert(!support.includes('condition_variable'));
  assert(!support.includes('failureAcknowledge'));
});

test('firstAttempt is nullable and independent of the genuine terminal state', () => {
  const snapshot = support.slice(support.indexOf('static Napi::Object MakeSnapshot('), support.indexOf('static Napi::Value Configure('));
  ordered(snapshot, 'if (state.firstAttemptRecorded)', 'first.Set("synthetic", true);',
    'first.Set("syscallCalled", false);', 'first.Set("result", -1);', 'first.Set("error", ECHILD);',
    'first.Set("statusValid", false);', 'first.Set("rawStatus", env.Null());',
    'first.Set("disposition", "unconfirmed");', 'first.Set("nativeOrdinal", state.firstAttempt.ord);',
    'first.Set("monoNs", std::to_string(state.firstAttempt.monoNs));',
    'out.Set("firstAttempt", first);', 'else out.Set("firstAttempt", env.Null());',
    'out.Set("exitCode", state.waitConfirmed ?', 'out.Set("signalCode", state.waitConfirmed ?');
  const wait = support.slice(support.indexOf('static void Wait('), support.indexOf('static void SetupExitCallback('));
  ordered(wait, 'Record("wait-enter", pid);',
    'result = waitpid(pid, &status, 0); error = result < 0 ? errno : 0;',
    'Record("wait-return", result, error, result == pid ? status : 0);',
    '} while (result == -1 && error == EINTR);',
    'const bool decoded = result == pid && (WIFEXITED(status) || WIFSIGNALED(status));',
    'ledger.waitError = error; ledger.waitConfirmed = decoded;',
    'if (decoded)', 'if (WIFEXITED(status)) code = WEXITSTATUS(status);',
    'if (decoded)', 'ExitPayload{code, signal}', 'napi_call_threadsafe_function(', 'Release(tsfn);');
  assert.equal(wait.split('waitpid(').length - 1, 1);
  assert(!wait.slice(wait.indexOf('  int status = 0, error = 0;')).includes('ECHILD'));
});

test('accepted scenarios cannot enter the retained thread-injection or polling paths', () => {
  const configure = support.slice(support.indexOf('static Napi::Value Configure('), support.indexOf('static Napi::Value Snapshot('));
  assert(configure.includes('(scenario != "U1-0" && scenario != "U1-3")'));
  assert(!configure.includes('U1-2'));
  const poll = support.slice(support.indexOf('static Napi::Value PollWait('), support.indexOf('struct ExitPayload'));
  ordered(poll, 'std::strcmp(ledger.scenario, "U1-2") != 0',
    'throw Napi::Error::New(env, "Child polling is not owned or already settled");',
    'const pid_t result = waitpid(pid, &status, WNOHANG);');
  const setup = support.slice(support.indexOf('static void SetupExitCallback('));
  ordered(setup, 'napi_create_threadsafe_function(', 'std::strcmp(ledger.scenario, "U1-2") == 0',
    'if (inject)', 'ledger.threadConstructCalled = true;',
    'waiter = std::thread(Wait, tsfn, pid);', 'ledger.threadConstructReturned = true;');
  assert.equal(support.split('waiter = std::thread(').length - 1, 1);
});

test('new builder preserves isolated load-only verification and frozen v1/v2 source bytes', () => {
  for (const [name, expected] of [
    ['unix-native-failure-support-v1.h', '772f25630b5e68019b5b9da3563973e21c15f56668c603e3dd70269124207da6'],
    ['unix-native-failure-patch-v1.mjs', 'dc8333d041caade50e4405f82d68a40f0201317f1909fadde9af8c94fc2714c5'],
    ['build-native-failure-v1.mjs', '72c901f9ec56fa0471ed356ed2b01c2629e431d29dd2d46fbfff7c9bd632768b'],
    ['unix-native-failure-support-v2.h', '321fe046234bbc54ca535a39db59fc43cdc0fd15fef17b354ea27a59f59cfd5a'],
    ['unix-native-failure-patch-v2.mjs', 'd0b15c4bbe054901cdf5a09d4f00cb4296299fb894507fe19542c7ac264044de'],
    ['build-native-failure-v2.mjs', 'd42aeac94ddfac1d424b893a70c1024ccc79e10e440026e97be24675df6a811c'],
    ['native-thread-failure-patch-v2.test.mjs', '9013c220ff41605fc2e5513cfae0dc8fcf948b0d64b6f35deae61f81f728e5ce'],
  ]) assert.equal(sha256(fs.readFileSync(path.join(directory, name))), expected, name);
  const builder = fs.readFileSync(path.join(directory, 'build-native-failure-v3.mjs'), 'utf8');
  assert(!builder.includes('download-headers'));
  assert(!builder.includes("command('curl'"));
  assert(builder.includes("const names = ['build-native-failure-v3.mjs', 'unix-native-failure-patch-v3.mjs', 'unix-native-failure-support-v3.h'];"));
  assert(builder.includes("kind: 'linux-native-failure-v3-build'"));
  assert(builder.includes("assert.equal(record.load.nativeCalls, 0);"));
  assert(builder.includes("'failureCloseMaster', 'failurePollWait'"));
});
