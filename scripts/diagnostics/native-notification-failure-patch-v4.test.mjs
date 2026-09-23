import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { patchUnixSource, UNIX_SOURCE_SHA256 } from './unix-native-failure-patch-v4.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const support = fs.readFileSync(path.join(directory, 'unix-native-failure-support-v4.h'), 'utf8');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const ordered = (source, ...needles) => {
  let cursor = -1;
  for (const needle of needles) {
    const next = source.indexOf(needle, cursor + 1);
    assert(next > cursor, `Missing or unordered source anchor: ${needle}`);
    cursor = next;
  }
};

test('v4 patches only the fixed original and registers ownership before post-fork work', () => {
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
  assert(patched.includes('#include "unix-native-failure-support-v4.h"'));
  assert.throws(() => patchUnixSource(original + '\n'), /Unexpected Unix/);
});

test('notification substitution follows a genuine decoded wait and payload acquisition', () => {
  const wait = support.slice(support.indexOf('static void Wait('), support.indexOf('static void SetupExitCallback('));
  ordered(wait, 'result = waitpid(pid, &status, 0);',
    '} while (result == -1 && error == EINTR);',
    'const bool decoded = result == pid && (WIFEXITED(status) || WIFSIGNALED(status));',
    'ledger.waitError = error; ledger.waitConfirmed = decoded;',
    'ledger.exitCode = code; ledger.signalCode = signal;',
    'napi_status notification = napi_ok;', 'bool notificationInjected = false;',
    'if (decoded)', 'std::unique_ptr<ExitPayload, PayloadDeleter> payload(',
    'if (payload)', 'ledger.payloadAllocated = true;',
    'notificationInjected = std::strcmp(ledger.scenario, "U1-4") == 0;',
    'if (notificationInjected)', 'notification = napi_closing;',
    'ledger.notificationFailureInjected = true;', 'ledger.notificationStatus = notification;',
    'RecordLocked("notification-call-skipped", notification);');
  const injection = wait.slice(wait.indexOf('        if (notificationInjected) {'), wait.indexOf('        } else {'));
  for (const absent of ['napi_call_threadsafe_function(', 'payload.release()', 'notification-enter',
    'notification-return', 'Release(', 'waitConfirmed =', 'exitCode =', 'signalCode =']) {
    assert(!injection.includes(absent), `Skipped notification must not use ${absent}`);
  }
  assert.equal(support.split('RecordLocked("notification-call-skipped"').length - 1, 1);
  assert.equal(support.split('ledger.notificationFailureInjected = true;').length - 1, 1);
});

test('unqueued payload is freed before real Release while genuine closing keeps its no-Release path', () => {
  const wait = support.slice(support.indexOf('static void Wait('), support.indexOf('static void SetupExitCallback('));
  ordered(wait, 'ledger.notificationCallInvoked = true;', 'RecordLocked("notification-enter");',
    'if (!notificationInjected)', 'notification = napi_call_threadsafe_function(tsfn, payload.get(), napi_tsfn_blocking);',
    'if (notification == napi_ok) payload.release();', 'RecordLocked("notification-return", notification);',
    '} else Record("payload-allocation-failed", -1, ENOMEM);',
    '  }\n  // A skipped call cannot consume the producer reference as a genuine closing call can.',
    'if (notificationInjected || notification != napi_closing) Release(tsfn);',
    'else Record("tsfn-release-not-attempted", notification);', 'ledger.threadFinished = true;');
  assert.equal(wait.split('napi_call_threadsafe_function(').length - 1, 1);
  assert.equal(wait.split('payload.release()').length - 1, 1);
  assert.equal(wait.split('Release(tsfn)').length - 1, 1);
  const deleter = support.slice(support.indexOf('struct PayloadDeleter'), support.indexOf('static void Notify('));
  ordered(deleter, 'delete payload;', 'ledger.payloadFreed = true; RecordLocked("payload-freed");');
  const release = support.slice(support.indexOf('static void Release('), support.indexOf('static void Wait('));
  ordered(release, 'Record("tsfn-release-enter");',
    'napi_release_threadsafe_function(tsfn, napi_tsfn_release);', 'ledger.tsfnReleaseStatus = status;');
  assert(!release.includes('U1-4'));
  assert.equal(support.split('napi_release_threadsafe_function(').length - 1, 1);
});

test('actual-call flags are exported and accepted scenarios exclude all prior injected paths', () => {
  assert(support.includes('bool notificationCallInvoked = false, notificationFailureInjected = false;'));
  assert(support.includes('DSC_BOOL(notificationCallInvoked); DSC_BOOL(notificationFailureInjected);'));
  const configure = support.slice(support.indexOf('static Napi::Value Configure('), support.indexOf('static Napi::Value Snapshot('));
  assert(configure.includes('(scenario != "U1-0" && scenario != "U1-4")'));
  assert(!configure.includes('U1-2'));
  assert(!configure.includes('U1-3'));
  const wait = support.slice(support.indexOf('static void Wait('), support.indexOf('static void SetupExitCallback('));
  ordered(wait, 'std::strcmp(ledger.scenario, "U1-3") == 0', 'ledger.firstAttemptRecorded = true;');
  const poll = support.slice(support.indexOf('static Napi::Value PollWait('), support.indexOf('struct ExitPayload'));
  ordered(poll, 'std::strcmp(ledger.scenario, "U1-2") != 0',
    'throw Napi::Error::New(env, "Child polling is not owned or already settled");', 'waitpid(');
  assert.equal(support.split('waiter = std::thread(').length - 1, 1);
  assert(!support.includes('condition_variable'));
});

test('new builder retains isolated load-only checks and frozen v1/v2/v3 bytes', () => {
  for (const [name, expected] of [
    ['unix-native-failure-support-v1.h', '772f25630b5e68019b5b9da3563973e21c15f56668c603e3dd70269124207da6'],
    ['unix-native-failure-patch-v1.mjs', 'dc8333d041caade50e4405f82d68a40f0201317f1909fadde9af8c94fc2714c5'],
    ['build-native-failure-v1.mjs', '72c901f9ec56fa0471ed356ed2b01c2629e431d29dd2d46fbfff7c9bd632768b'],
    ['unix-native-failure-support-v2.h', '321fe046234bbc54ca535a39db59fc43cdc0fd15fef17b354ea27a59f59cfd5a'],
    ['unix-native-failure-patch-v2.mjs', 'd0b15c4bbe054901cdf5a09d4f00cb4296299fb894507fe19542c7ac264044de'],
    ['build-native-failure-v2.mjs', 'd42aeac94ddfac1d424b893a70c1024ccc79e10e440026e97be24675df6a811c'],
    ['unix-native-failure-support-v3.h', '759af0ac4752cc69821453154b3af3e6a334ea0caa02ad5f621ccecc48d4677d'],
    ['unix-native-failure-patch-v3.mjs', 'c59188060232d164a4e706101828b243e000b298a346ee6701300b3233d748a5'],
    ['build-native-failure-v3.mjs', '13ab767d9e94a34d23de9def5d512b8953a4af1a97dd42c9be85921d7bf8a1c7'],
    ['native-wait-failure-patch-v3.test.mjs', 'cfdb047d782165c5fb847bfe909c47ee27aa6436b01b897daf2dfcb671370721'],
  ]) assert.equal(sha256(fs.readFileSync(path.join(directory, name))), expected, name);
  const builder = fs.readFileSync(path.join(directory, 'build-native-failure-v4.mjs'), 'utf8');
  assert(!builder.includes('download-headers'));
  assert(!builder.includes("command('curl'"));
  assert(builder.includes("const names = ['build-native-failure-v4.mjs', 'unix-native-failure-patch-v4.mjs', 'unix-native-failure-support-v4.h'];"));
  assert(builder.includes("kind: 'linux-native-failure-v4-build'"));
  assert(builder.includes("assert.equal(record.load.nativeCalls, 0);"));
});
