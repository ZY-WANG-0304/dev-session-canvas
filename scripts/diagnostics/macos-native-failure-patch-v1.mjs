import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export const UNIX_SOURCE_SHA256 = '19210adfdaba3cd09809b56bb3281b14e74a8e5efc1f35d467d3c423c30856db';

export function patchMacosSource(source) {
  assert.equal(typeof source, 'string');
  assert.equal(createHash('sha256').update(source).digest('hex'), UNIX_SOURCE_SHA256, 'Unexpected Unix node-pty source');
  const replace = (before, after) => {
    assert.equal(source.split(before).length - 1, 1, `Expected a unique macOS patch anchor: ${before}`);
    source = source.replace(before, after);
  };
  replace('#include <signal.h>\n', '#include <signal.h>\n#include "macos-native-failure-support-v1.h"\n');
  replace('  pid_t pid;\n  int master = -1;',
    '  dsc_macos::BeforeSpawn(napiEnv, helper_path, file);\n  pid_t pid = -1;\n  int master = -1;');
  replace('  if (!err.empty()) {\n    if (master != -1) {\n      close(master);\n    }',
    '  if (!err.empty()) {\n    if (master != -1) {\n      dsc_macos::CloseMasterOwned();\n    }');
  replace('  if (pty_nonblock(master) == -1) {\n    throw Napi::Error::New(napiEnv, "Could not set master fd to nonblocking.");\n  }\n#else',
    '  dsc_macos::NonblockEnter();\n' +
    '  const int nonblock_result = pty_nonblock(master);\n' +
    '  dsc_macos::NonblockReturned(nonblock_result, nonblock_result < 0 ? errno : 0);\n' +
    '  if (nonblock_result == -1) {\n' +
    '    throw Napi::Error::New(napiEnv, "Could not set master fd to nonblocking.");\n  }\n#else');
  replace('  SetupExitCallback(napiEnv, cb, pid);', '  dsc_macos::SetupExitCallback(napiEnv, cb, pid);');
  replace('    low_fds[count] = posix_openpt(O_RDWR);', '    low_fds[count] = dsc_macos::OpenLowFd(count);');
  replace('  posix_spawn_file_actions_init(&acts);', '  dsc_macos::ActionsInit(&acts);');
  replace('  posix_spawnattr_init(&attrs);', '  dsc_macos::AttrsInit(&attrs);');
  replace('  *master = posix_openpt(O_RDWR);', '  *master = dsc_macos::OpenMaster();');
  replace('  slave = open(slave_pty_name, O_RDWR | O_NOCTTY);', '  slave = dsc_macos::OpenSlave(slave_pty_name, O_RDWR | O_NOCTTY);');
  replace('    spawn_err = posix_spawn(pid, argv[0], &acts, &attrs, argv, env);',
    '    spawn_err = dsc_macos::Spawn(pid, argv[0], &acts, &attrs, argv, env);');
  replace('  posix_spawn_file_actions_destroy(&acts);', '  dsc_macos::ActionsDestroy(&acts);');
  replace('  posix_spawnattr_destroy(&attrs);', '  dsc_macos::AttrsDestroy(&attrs);');
  replace('  if (slave != -1) {\n    close(slave);\n  }', '  if (slave != -1) {\n    dsc_macos::CloseResource("slave", slave);\n  }');
  replace('    close(low_fds[i]);', '    dsc_macos::CloseLowFd(i, low_fds[i]);');
  replace('Napi::Object init(Napi::Env env, Napi::Object exports) {',
    'Napi::Object init(Napi::Env env, Napi::Object exports) {\n' +
    '  exports.Set("failureConfigure", Napi::Function::New(env, dsc_macos::Configure));\n' +
    '  exports.Set("failureSnapshot", Napi::Function::New(env, dsc_macos::Snapshot));\n' +
    '  exports.Set("failureCloseMaster", Napi::Function::New(env, dsc_macos::CloseMaster));');
  return source;
}
