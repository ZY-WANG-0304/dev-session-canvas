import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export const NODE_PTY_CONPTY_SHA256 = 'd502cce570552c7a1bea373c7672975eeb330c3025dd151cf9c180ca2a1becc2';
export const WINDOWS_EXECUTION_EXPORTS = Object.freeze([
  'executionClose', 'executionConnect', 'executionPollWait', 'executionResize',
  'executionSnapshot', 'executionStart'
]);

export function patchWindowsExecutionProvider(source) {
  assert.equal(createHash('sha256').update(source).digest('hex'), NODE_PTY_CONPTY_SHA256,
    'Unexpected node-pty ConPTY source');
  const before = 'Napi::Object init(Napi::Env env, Napi::Object exports) {\n' +
    '  exports.Set("startProcess", Napi::Function::New(env, PtyStartProcess));\n' +
    '  exports.Set("connect", Napi::Function::New(env, PtyConnect));\n' +
    '  exports.Set("resize", Napi::Function::New(env, PtyResize));\n' +
    '  exports.Set("clear", Napi::Function::New(env, PtyClear));\n' +
    '  exports.Set("kill", Napi::Function::New(env, PtyKill));\n' +
    '  return exports;\n};';
  assert.equal(source.split(before).length - 1, 1, 'Expected one ConPTY export patch anchor');
  const after = '#include "windows-execution-owner.h"\n\n' +
    'Napi::Object init(Napi::Env env, Napi::Object exports) {\n' +
    WINDOWS_EXECUTION_EXPORTS.map(name => `  exports.Set("${name}", Napi::Function::New(env, dsc_windows::${name}));`).join('\n') +
    '\n  return exports;\n};';
  return source.replace(before, after);
}
