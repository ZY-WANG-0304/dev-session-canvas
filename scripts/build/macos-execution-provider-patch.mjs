import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { LINUX_EXECUTION_EXPORTS, NODE_PTY_UNIX_SHA256 } from './linux-execution-provider-patch.mjs';

export { NODE_PTY_UNIX_SHA256 };
export const NODE_PTY_SPAWN_HELPER_SHA256 = '22195de1710b574d5904fc89be5624c25e531de20d5e17e5998a2fd19d86e0e6';
export const MACOS_EXECUTION_EXPORTS = Object.freeze([...LINUX_EXECUTION_EXPORTS, 'executionClaimNamespace'].sort());

export function patchMacosSpawnHelper(source) {
  assert.equal(createHash('sha256').update(source).digest('hex'), NODE_PTY_SPAWN_HELPER_SHA256,
    'Unexpected node-pty spawn helper source');
  return source.replace('int main (int argc, char** argv) {',
    'int main (int argc, char** argv) {\n' +
    '  if (argc < 3 || setsid() == -1) _exit(1);')
    .replace('  char *slave_path = ttyname(STDIN_FILENO);',
      '  char *slave_path = ttyname(STDIN_FILENO);\n' +
      '  if (slave_path == nullptr) _exit(1);')
    .replace('  close(open(slave_path, O_RDWR));',
      '  const int slave = open(slave_path, O_RDWR);\n' +
      '  if (slave == -1) _exit(1);\n' +
      '  if (close(slave) == -1) _exit(1);');
}

export function patchMacosExecutionProvider(source) {
  assert.equal(createHash('sha256').update(source).digest('hex'), NODE_PTY_UNIX_SHA256,
    'Unexpected node-pty Unix source');
  const replace = (before, after) => {
    assert.equal(source.split(before).length - 1, 1, `Expected one macOS native patch anchor: ${before}`);
    source = source.replace(before, after);
  };
  replace('#include <signal.h>\n', '#include <signal.h>\n#include "macos-execution-owner.h"\n');
  replace('  pid_t pid;\n  int master = -1;',
    '  dsc_execution::BeforeSpawn(napiEnv, helper_path);\n  pid_t pid = -1;\n  int master = -1;');
  replace('  if (!err.empty()) {\n    if (master != -1) {\n      close(master);\n    }\n    throw Napi::Error::New(napiEnv, err);\n  }',
    '  if (!err.empty()) {\n    throw Napi::Error::New(napiEnv, err);\n  }');
  replace('  if (pty_nonblock(master) == -1) {\n    throw Napi::Error::New(napiEnv, "Could not set master fd to nonblocking.");\n  }\n#else',
    '  const int nonblock_result = pty_nonblock(master);\n' +
    '  dsc_execution::NonblockReturned(nonblock_result, nonblock_result < 0 ? errno : 0);\n' +
    '  if (nonblock_result == -1) {\n' +
    '    throw Napi::Error::New(napiEnv, "Could not set master fd to nonblocking.");\n  }\n#else');
  replace('  // Set up process exit callback.\n  Napi::Function cb = info[10].As<Napi::Function>();\n' +
    '  SetupExitCallback(napiEnv, cb, pid);',
    '  // The provider polls its sole child; no exit thread, kqueue or TSFN is created.');
  const start = source.indexOf('static void\npty_posix_spawn(char** argv, char** env,\n');
  const body = source.indexOf('std::string* err) {', start);
  const end = source.indexOf('\n}\n#endif\n\n/**\n * Init', body);
  assert(start >= 0 && body > start && end > body, 'Expected the Darwin spawn definition');
  source = source.slice(0, body) + 'std::string* err) {\n' +
    '  dsc_execution::Spawn(argv, env, termp, winp, master, pid, err);' + source.slice(end);
  replace('  exports.Set("open",    Napi::Function::New(env, PtyOpen));\n' +
    '  exports.Set("resize",  Napi::Function::New(env, PtyResize));\n' +
    '  exports.Set("process", Napi::Function::New(env, PtyGetProc));',
    Object.entries({ executionConfigure: 'Configure', executionSnapshot: 'Snapshot', executionRead: 'Read',
      executionWrite: 'Write', executionResize: 'Resize', executionPollWait: 'PollWait',
      executionSignal: 'Signal', executionClose: 'Close', executionClaimNamespace: 'ClaimNamespace' })
      .map(([name, method]) => `  exports.Set("${name}", Napi::Function::New(env, dsc_execution::${method}));`).join('\n'));
  return source;
}
