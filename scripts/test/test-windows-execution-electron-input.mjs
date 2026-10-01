import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import yaml from 'js-yaml';

const require = createRequire(import.meta.url);
const helper = require('../../tests/vscode-smoke/windows-execution-candidate.cjs');
const base = 'tests/vscode-smoke/fixtures/';
const nonce = 'a'.repeat(32);
const started = { kind: 'observing', pid: 7, nonce, startTime: 'fixed-original-instance' };
const observed = { subject: { pid: 7, ppid: 6 }, nonce, events: [started], result: { code: 0, signal: null } };
helper.bindObserver(observed, { pid: 7, ppid: 6, nonce });
assert.equal(helper.exitFact(observed), undefined);
observed.events.push({ ...started, kind: 'exited', hasExited: true, exitCode: 0 });
assert.equal(helper.assertCompleted(observed).exitCode, 0);
assert.throws(() => helper.assertCompleted(observed, { kind: 'safety-timeout' }), /safety timer/);
for (const mutate of [value => { value.bound = false; }, value => { value.events[1].startTime = 'replacement'; },
  value => { value.events[1].hasExited = false; }, value => { value.events.push({ kind: 'unknown' }); }]) {
  const copy = structuredClone(observed); mutate(copy); assert.equal(helper.exitFact(copy), undefined);
}
const timedOut = structuredClone(observed); timedOut.events[1].exitCode = 124;
assert.throws(() => helper.assertCompleted(timedOut), /complete normally/);
assert.equal(helper.terminalCommand('C:\\test space\\run.cmd', 'C:\\node.exe', 'C:\\subject.cjs', 'C:\\receipt.json'),
  '"C:\\test space\\run.cmd" "C:\\node.exe" "C:\\subject.cjs" "C:\\receipt.json"\r');
assert.throws(() => helper.terminalCommand('C:\\%TEMP%\\run.cmd', 'node', 'subject', 'receipt'), /Unsupported/);

async function fixture(file, windows) {
  const files = new Map(), terminal = [], source = [];
  const stdin = new EventEmitter(); stdin.isTTY = true; stdin.setRawMode = () => {}; stdin.setEncoding = () => {}; stdin.pause = () => {};
  const processView = { platform: 'win32', version: 'v25.6.0', versions: { node: '25.6.0' }, pid: 7, ppid: 6,
    argv: ['node', file, 'receipt'], execPath: 'C:\\node.exe', stdin,
    stdout: { isTTY: true, write(bytes, callback) { terminal.push(Buffer.from(bytes)); queueMicrotask(() => callback()); } },
    exit(code) { throw new Error(`Unexpected fixture exit ${code}`); } };
  const controlledFs = {
    openSync() { return 9; }, closeSync() {},
    writeSync(fd, bytes, offset, length) {
      (fd === 1 ? terminal : source).push(Buffer.from(bytes.subarray(offset, offset + length))); return length;
    },
    writeFileSync(file, value, options) { assert.equal(options.flag, 'wx'); assert(!files.has(file)); files.set(file, value); },
    linkSync(from, to) { assert(!files.has(to)); files.set(to, files.get(from)); }, unlinkSync(file) { files.delete(file); }
  };
  vm.runInNewContext(await fs.readFile(file, 'utf8'), { require(name) { return name === 'node:fs' ? controlledFs : require(name); },
    Buffer, process: processView, setTimeout() { return 1; }, clearTimeout() {} }, { filename: file });
  if (windows) {
    stdin.emit('data', `observe:${nonce}\r`);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(JSON.parse(files.get('receipt.observed.json')), { pid: 7, ppid: 6, nonce });
    stdin.emit('data', `run:${nonce}\r`);
    for (let turn = 0; turn < 20 && !files.has('receipt'); turn++) await new Promise(resolve => setImmediate(resolve));
  }
  assert(files.has('receipt'), 'Fixed writer must finish under the controlled successful callbacks');
  return { receipt: JSON.parse(files.get('receipt')), terminal: Buffer.concat(terminal), source: Buffer.concat(source) };
}
const unix = await fixture(`${base}execution-candidate-subject.cjs`, false);
const windows = await fixture(`${base}execution-candidate-windows.cjs`, true);
assert.equal(windows.receipt.bytesWritten, unix.receipt.bytesWritten);
assert.equal(windows.receipt.sha256, unix.receipt.sha256);
assert.equal(windows.receipt.lineCount, 90000);
assert.deepEqual(windows.source, unix.terminal);
assert.deepEqual(windows.terminal.subarray(Buffer.byteLength(`OBSERVED:${nonce}\r\n`)), unix.terminal);
const script = await fs.readFile(`${base}execution-candidate-windows-observer.ps1`, 'utf8');
assert.equal((script.match(/GetProcessById\(/g) ?? []).length, 1);
assert.match(script, /\$ownedHandle = \$subject.SafeHandle/);
assert.match(script, /\$subject.WaitForExit\(100\)/);
assert.doesNotMatch(script, /Stop-Process|taskkill|\.Kill\(/);
const cmd = await fs.readFile(`${base}execution-candidate-windows.cmd`, 'utf8');
assert.match(cmd, /"%~1" "%~2" "%~3"\r?\nexit %errorlevel%/);
assert.doesNotMatch(cmd, /exit \/b/);
const workflow = yaml.load(await fs.readFile('.github/workflows/runtime-execution-windows.yml', 'utf8'));
const steps = workflow.jobs['product-provider'].steps;
assert(steps.findIndex(step => step.name === 'Run fixed real product provider cases') <
  steps.findIndex(step => step.name === 'Compile matching Electron product build'));
const compile = steps.find(step => step.name === 'Compile matching Electron product build').run;
assert.match(compile, /win-x64\/node.lib/);
assert.match(compile, /ee92beea67d0f12ef058adc52d0f5344e1005153c9487d0f4d63cab91111421a/);
assert.match(compile, /process.versions.modules, "140"/);
assert.match(compile, /finally \{ Remove-Item Env:ELECTRON_RUN_AS_NODE \}/);
console.log('Windows Electron fixed input: identity/exit, original writer byte identity, shell and workflow contracts passed; no native or VS Code calls.');
