import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export const UNIX_SOURCE_SHA256 = '19210adfdaba3cd09809b56bb3281b14e74a8e5efc1f35d467d3c423c30856db';

export function patchUnixSource(source) {
  assert.equal(typeof source, 'string');
  assert.equal(createHash('sha256').update(source).digest('hex'), UNIX_SOURCE_SHA256, 'Unexpected Unix node-pty source');
  const replace = (before, after) => {
    assert.equal(source.split(before).length - 1, 1, `Expected a unique native patch anchor: ${before}`);
    source = source.replace(before, after);
  };
  replace('#include <signal.h>\n', '#include <signal.h>\n#include "unix-native-failure-support-v4.h"\n');
  replace('  pid_t pid;\n  int master = -1;', '  dsc_failure::BeforeFork(napiEnv);\n  pid_t pid;\n  int master = -1;');
  replace('  pid = forkpty(&master, nullptr, static_cast<termios*>(term), static_cast<winsize*>(&winp));',
    '  dsc_failure::ForkEnter();\n' +
    '  pid = forkpty(&master, nullptr, static_cast<termios*>(term), static_cast<winsize*>(&winp));\n' +
    '  if (pid != 0) dsc_failure::ForkReturned(pid, master, pid < 0 ? errno : 0);');
  replace('    default:\n      if (pty_nonblock(master) == -1) {\n        throw Napi::Error::New(napiEnv, "Could not set master fd to nonblocking.");\n      }',
    '    default:\n' +
    '      dsc_failure::NonblockEnter();\n' +
    '      const int result = pty_nonblock(master);\n' +
    '      dsc_failure::NonblockReturned(result, result < 0 ? errno : 0);\n' +
    '      if (result == -1) {\n' +
    '        throw Napi::Error::New(napiEnv, "Could not set master fd to nonblocking.");\n' +
    '      }');
  replace('  SetupExitCallback(napiEnv, cb, pid);', '  dsc_failure::SetupExitCallback(napiEnv, cb, pid);');
  replace('Napi::Object init(Napi::Env env, Napi::Object exports) {',
    'Napi::Object init(Napi::Env env, Napi::Object exports) {\n' +
    '  exports.Set("failureConfigure", Napi::Function::New(env, dsc_failure::Configure));\n' +
    '  exports.Set("failureSnapshot", Napi::Function::New(env, dsc_failure::Snapshot));\n' +
    '  exports.Set("failureCloseMaster", Napi::Function::New(env, dsc_failure::CloseMaster));\n' +
    '  exports.Set("failurePollWait", Napi::Function::New(env, dsc_failure::PollWait));');
  return source;
}
