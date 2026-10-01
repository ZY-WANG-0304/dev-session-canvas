import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import yaml from 'js-yaml';
import { transform } from 'esbuild';

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
assert.match(compile, /spawnSync\(/, 'The GUI Electron executable must finish before extension assets are imported');
assert.doesNotMatch(compile, /& \$env:DEV_SESSION_CANVAS_VSCODE_EXECUTABLE/);
const inline = compile.match(/^@'\n([\s\S]*?)^'@ \| node --input-type=module\nif \(\$LASTEXITCODE -ne 0\) \{ exit \$LASTEXITCODE \}/m);
assert(inline, 'The awaited build must propagate its failure before importing assets');
const executableBuild = (await transform(inline[1], { format: 'cjs', platform: 'node' })).code;
for (const failure of [undefined, 'spawn', 'signal', 'probe-exit', 'build-exit']) {
  const invocations = [];
  const environment = { DEV_SESSION_CANVAS_VSCODE_EXECUTABLE: 'C:\\VS Code\\Code.exe',
    GITHUB_WORKSPACE: 'C:\\test workspace', RUNNER_TEMP: 'C:\\runner temp' };
  const execute = () => vm.runInNewContext(executableBuild, {
    require(name) {
      if (name === 'node:path') return require(name).win32;
      if (name === 'node:child_process') return { spawnSync(file, args, options) {
        invocations.push({ file, args, options });
        if (failure === 'spawn') return { error: new Error('controlled original process spawn failure') };
        if (failure === 'signal') return { status: null, signal: 'SIGTERM' };
        return { status: failure === 'probe-exit' || (failure === 'build-exit' && invocations.length === 2) ? 9 : 0, signal: null };
      } };
      return require(name);
    },
    process: { execPath: 'C:\\fixed Node\\node.exe', env: environment }
  });
  if (failure) assert.throws(execute, /original.*process/);
  else execute();
  assert.equal(invocations.length, failure && failure !== 'build-exit' ? 1 : 2);
  for (const call of invocations) {
    assert.equal(call.file, environment.DEV_SESSION_CANVAS_VSCODE_EXECUTABLE);
    assert.equal(call.options.stdio, 'inherit');
    assert.equal(call.options.env.ELECTRON_RUN_AS_NODE, '1');
  }
  assert.equal(environment.ELECTRON_RUN_AS_NODE, undefined, 'Electron mode stays child-local');
  if (invocations.length === 2) {
    assert.equal(invocations[0].args[0], '-e');
    assert.deepEqual(Array.from(invocations[1].args), ['scripts/build/windows-execution-candidate-assets.mjs',
      'build', '--output', 'windows-electron-build', '--dependency-root', 'C:\\test workspace\\node_modules',
      '--headers', 'C:\\runner temp\\windows-electron-headers\\include\\node',
      '--node-lib', 'C:\\runner temp\\windows-electron-node.lib',
      '--delay-load-hook', 'C:\\fixed Node\\node_modules\\npm\\node_modules\\node-gyp\\src\\win_delay_load_hook.cc']);
  }
}
const candidateSource = await fs.readFile('scripts/smoke/run-vscode-execution-candidate.mjs', 'utf8');
const phaseLoopStart = candidateSource.indexOf('for (const [index, mode] of modes.entries()) {');
const phaseLoopEnd = candidateSource.indexOf('async function runCapacityCalibration() {', phaseLoopStart);
assert(phaseLoopStart >= 0 && phaseLoopEnd > phaseLoopStart);
const phaseLoop = candidateSource.slice(phaseLoopStart, phaseLoopEnd);
async function controlledPhases(changeReports) {
  const reports = new Map(), launches = [], messages = [];
  const output = '/fixed-output';
  const execute = () => vm.runInNewContext(`(async () => { ${phaseLoop} })()`, {
    assert, path, modes: ['live-runtime', 'snapshot-only'], output, projectRoot: '/fixed-project', runId: 'fixed',
    installedInput: undefined,
    vscodeExecutablePath: '/fixed-Code.exe', process: { platform: 'win32', env: { SystemRoot: 'C:\\Windows' }, execPath: '/fixed-node' },
    fs: {
      async mkdir() {},
      async writeFile(file, data) { reports.set(file, data); },
      async readFile(file) {
        if (!reports.has(file)) throw Object.assign(new Error(`Missing phase report: ${file}`), { code: 'ENOENT' });
        return reports.get(file);
      }
    },
    async prepareRuntime({ debugRoot }) { return { artifactsDir: path.join(debugRoot, 'artifacts') }; },
    async prepareMainSmokeHostExtension({ targetRoot }) { return targetRoot; },
    resolveStagedSmokeTestPath: (root, file) => path.join(root, file),
    async launchPreparedVSCodeScenario({ runtime, extensionTestsEnv: env }) {
      const mode = env.DEV_SESSION_CANVAS_CANDIDATE_MODE, phase = env.DEV_SESSION_CANVAS_CANDIDATE_PHASE;
      const id = `${mode}-node`;
      launches.push(`${mode}/${phase}`);
      const write = (file, data) => reports.set(path.join(runtime.artifactsDir, file), JSON.stringify(data));
      write(`${phase}-environment.json`, { mode, phase });
      if (phase === 'complete') write('completed.json', { mode, id, pass: true });
      else {
        write('reopened.json', { mode, id, pass: true });
        write('cleanup.json', { runtime: { bindings: [] }, pass: true });
      }
      changeReports?.({ reports, root: runtime.artifactsDir, mode, phase, write });
    },
    console: { log(message) { messages.push(message); } }
  });
  let error;
  try { await execute(); } catch (failure) { error = failure; }
  return { error, reports, launches, messages, output };
}
const missingCompleted = await controlledPhases(({ reports, root, phase }) => {
  if (phase === 'complete') reports.delete(path.join(root, 'completed.json'));
});
assert(missingCompleted.error, 'A zero-exit launcher without completed.json must fail before reopen or the next mode');
assert.deepEqual(missingCompleted.launches, ['live-runtime/complete']);
assert.equal(missingCompleted.messages.length, 0);
const accepted = await controlledPhases();
assert.equal(accepted.error, undefined);
assert.deepEqual(accepted.launches, ['live-runtime/complete', 'live-runtime/reopen',
  'snapshot-only/complete', 'snapshot-only/reopen']);
assert.equal(accepted.messages.length, 1);
assert.match(accepted.messages[0], /acceptance passed/);
assert(!accepted.reports.has(path.join(accepted.output, 'first-failure.json')));
for (const [phase, filename, replacement] of [
  ['complete', 'complete-environment.json', undefined],
  ['reopen', 'reopen-environment.json', undefined],
  ['reopen', 'reopened.json', undefined],
  ['reopen', 'cleanup.json', undefined],
  ['complete', 'completed.json', { mode: 'live-runtime', id: 'live-runtime-node', pass: false }],
  ['reopen', 'reopened.json', { mode: 'live-runtime', id: 'live-runtime-node', pass: false }],
  ['reopen', 'cleanup.json', { runtime: { bindings: [] }, pass: false }],
  ['complete', 'complete-environment.json', { mode: 'snapshot-only', phase: 'complete' }],
  ['reopen', 'reopen-environment.json', { mode: 'live-runtime', phase: 'complete' }],
  ['complete', 'completed.json', { mode: 'snapshot-only', id: 'live-runtime-node', pass: true }],
  ['complete', 'completed.json', { mode: 'live-runtime', pass: true }],
  ['reopen', 'reopened.json', { mode: 'snapshot-only', id: 'live-runtime-node', pass: true }],
  ['reopen', 'reopened.json', { mode: 'live-runtime', id: 'different-node', pass: true }],
  ['reopen', 'cleanup.json', { runtime: { bindings: [{ nodeId: 'remaining-node' }] }, pass: true }]
]) {
  const result = await controlledPhases(({ reports, root, phase: actualPhase, write }) => {
    if (actualPhase !== phase) return;
    if (replacement === undefined) reports.delete(path.join(root, filename));
    else write(filename, replacement);
  });
  assert(result.error, `${filename} must be present, successful and tied to this phase`);
  assert.deepEqual(result.launches, phase === 'complete' ? ['live-runtime/complete']
    : ['live-runtime/complete', 'live-runtime/reopen']);
  assert.equal(result.messages.length, 0, 'A failed phase must not print whole-run success');
  const failure = JSON.parse(result.reports.get(path.join(result.output, 'first-failure.json')));
  assert.equal(failure.mode, 'live-runtime');
  assert.equal(failure.error, String(result.error));
}
const terminalTests = await fs.readFile('tests/vscode-smoke/execution-candidate-tests.cjs', 'utf8');
const pollStart = terminalTests.indexOf('async function poll(');
const pollEnd = terminalTests.indexOf('async function openSurface()', pollStart);
const mountedStart = terminalTests.indexOf("await dispatch('webview/resizeNode'");
const mountedEnd = terminalTests.indexOf("await writeJson('started.json'", mountedStart);
assert(pollStart >= 0 && pollEnd > pollStart && mountedStart >= 0 && mountedEnd > mountedStart);
async function mountedIdentity(identityAt, mountedAt = 0, receivedIdentity = 'original-execution') {
  let now = 0, reads = 0;
  let executionId, error;
  try {
    executionId = await vm.runInNewContext(`(async () => {
      ${terminalTests.slice(pollStart, pollEnd)}
      ${terminalTests.slice(mountedStart, mountedEnd)}
      return executionId;
    })()`, {
      assert, id: 'original-node', node: { position: { x: 0, y: 0 } }, mode: 'live-runtime',
      metadata: { runtimeSessionId: 'original-execution' }, Date: { now: () => now },
      async sleep(ms) { now += ms; }, async dispatch() {},
      async probe() { return { nodes: now >= mountedAt
        ? [{ nodeId: 'original-node', terminalCols: 80, terminalRows: 24 }] : [] }; },
      async command(name) {
        assert.equal(name, 'getHostMessages'); reads++;
        return now >= identityAt ? [{ type: 'host/executionSnapshot',
          payload: { nodeId: 'original-node', executionSessionId: receivedIdentity } }] : [];
      }
    });
  } catch (failure) { error = failure; }
  return { now, reads, executionId, error };
}
const delayedIdentity = await mountedIdentity(50);
assert.equal(delayedIdentity.error, undefined,
  'Mounted xterm dimensions must not end the existing wait before the original reader identity arrives');
assert.equal(delayedIdentity.executionId, 'original-execution');
assert.equal(delayedIdentity.now, 50);
assert(delayedIdentity.reads >= 2);
const delayedMount = await mountedIdentity(0, 50);
assert.equal(delayedMount.error, undefined);
assert.equal(delayedMount.now, 50, 'Reader identity cannot replace the actual mounted dimensions');
for (const [identityAt, mountedAt] of [[Infinity, 0], [30000, 29950]]) {
  const missingIdentity = await mountedIdentity(identityAt, mountedAt);
  assert.match(missingIdentity.error?.message ?? '', /Timed out: terminal mounted in actual Webview/);
  assert.equal(missingIdentity.now, 30000, 'Mount and identity must share the original 30-second deadline');
  assert.equal(missingIdentity.executionId, undefined);
}
const wrongIdentity = await mountedIdentity(0, 0, 'different-execution');
assert.equal(wrongIdentity.error?.code, 'ERR_ASSERTION');
assert.equal(wrongIdentity.now, 0, 'The original Runtime execution identity equality must still reject a mismatch');
console.log('Windows Electron fixed input: identity/exit, original writer byte identity, shell, workflow, required phase reports and mounted reader identity passed; no native or VS Code calls.');
