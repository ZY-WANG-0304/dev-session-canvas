import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { patchWindowsExecutionProvider, WINDOWS_EXECUTION_EXPORTS } from '../build/windows-execution-provider-patch.mjs';

const source = readFileSync('node_modules/node-pty/src/win/conpty.cc', 'utf8');
const header = readFileSync('extensions/vscode/dev-session-canvas/native/windows-execution-owner.h', 'utf8');
const patched = patchWindowsExecutionProvider(source);
const exports = [...patched.matchAll(/exports\.Set\("([^"]+)"/g)].map(match => match[1]);
assert.deepEqual(exports, WINDOWS_EXECUTION_EXPORTS);
assert.match(patched, /#include "windows-execution-owner\.h"/);
assert.throws(() => patchWindowsExecutionProvider(source + '\n'), /Unexpected node-pty ConPTY source/);
assert.doesNotMatch(header, /TerminateProcess|PtyKill|SetupExitCallback|BlockingCall|OpenProcess\(/);
assert.match(header, /decltype\(&ConptyReleasePseudoConsole\)/);
assert.match(header, /GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS/);
assert.doesNotMatch(header, /LoadConptyDll\(|GetModuleHandleA\(/);
const start = header.slice(header.indexOf('static Napi::Value executionStart('), header.indexOf('static Napi::Value executionConnect('));
assert.match(start, /catch \(const std::exception& error\) \{[\s\S]*?throw Napi::Error::New\(info.Env\(\), error.what\(\)\)/,
  'Synchronous standard exceptions must not cross node-addon-api 7 WrapCallback');
assert.match(header, /WaitForSingleObject\(owner->process\.value, 0\)/);
assert.match(header, /owner->idle\.wait\(lock, \[this\] \{ return !owner->busy; \}\)/);
assert.match(header, /owner->busy \|\| owner->closeRequested/);
assert.match(header, /if \(hpc\) owner->close\(hpc\);/);
assert.match(header, /owner->closeRequested\) throw Napi::Error/);
assert.doesNotMatch(header, /CloseHandle\((?:owner->)?hpc\)/);
assert.match(header, /FAILED\(released\)/);
assert.match(header, /OwnerReleased\(\*owner\) \? "closed" : "unknown"/);
console.log('Windows execution provider source contract passed; source checks only, not a native build.');
