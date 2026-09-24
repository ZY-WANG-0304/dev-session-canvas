import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export const NODE_PTY_UNIX_SHA256 = '19210adfdaba3cd09809b56bb3281b14e74a8e5efc1f35d467d3c423c30856db';
export const LINUX_EXECUTION_EXPORTS = Object.freeze([
  'executionClose', 'executionConfigure', 'executionPollWait', 'executionRead',
  'executionSignal', 'executionSnapshot', 'fork'
]);

export function patchLinuxExecutionProvider(source) {
  assert.equal(createHash('sha256').update(source).digest('hex'), NODE_PTY_UNIX_SHA256,
    'Unexpected node-pty Unix source');
  const replace = (before, after) => {
    assert.equal(source.split(before).length - 1, 1, `Expected one native patch anchor: ${before}`);
    source = source.replace(before, after);
  };
  replace('#include <signal.h>\n', '#include <signal.h>\n#include "linux-execution-owner.h"\n');
  replace('  pid_t pid;\n  int master = -1;',
    '  dsc_execution::BeforeFork(napiEnv);\n  pid_t pid;\n  int master = -1;');
  replace('  pid = forkpty(&master, nullptr, static_cast<termios*>(term), static_cast<winsize*>(&winp));',
    '  pid = forkpty(&master, nullptr, static_cast<termios*>(term), static_cast<winsize*>(&winp));\n' +
    '  if (pid != 0) dsc_execution::ForkReturned(pid, master, pid < 0 ? errno : 0);');
  replace('    default:\n      if (pty_nonblock(master) == -1) {\n' +
    '        throw Napi::Error::New(napiEnv, "Could not set master fd to nonblocking.");\n      }',
  '    default:\n      const int result = pty_nonblock(master);\n' +
    '      dsc_execution::NonblockReturned(result, result < 0 ? errno : 0);\n' +
    '      if (result == -1) {\n' +
    '        throw Napi::Error::New(napiEnv, "Could not set master fd to nonblocking.");\n      }');
  replace('  // Set up process exit callback.\n  Napi::Function cb = info[10].As<Napi::Function>();\n' +
    '  SetupExitCallback(napiEnv, cb, pid);',
  '  // The provider polls its sole owned child; no exit thread or TSFN is created.');
  replace('  exports.Set("open",    Napi::Function::New(env, PtyOpen));\n' +
    '  exports.Set("resize",  Napi::Function::New(env, PtyResize));\n' +
    '  exports.Set("process", Napi::Function::New(env, PtyGetProc));',
  '  exports.Set("executionConfigure", Napi::Function::New(env, dsc_execution::Configure));\n' +
    '  exports.Set("executionSnapshot", Napi::Function::New(env, dsc_execution::Snapshot));\n' +
    '  exports.Set("executionRead", Napi::Function::New(env, dsc_execution::Read));\n' +
    '  exports.Set("executionPollWait", Napi::Function::New(env, dsc_execution::PollWait));\n' +
    '  exports.Set("executionSignal", Napi::Function::New(env, dsc_execution::Signal));\n' +
    '  exports.Set("executionClose", Napi::Function::New(env, dsc_execution::Close));');
  return source;
}
