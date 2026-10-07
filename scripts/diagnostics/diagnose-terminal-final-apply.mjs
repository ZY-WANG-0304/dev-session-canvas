import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { parseArgs } from 'node:util';
import esbuild from 'esbuild';

const { values } = parseArgs({ options: { output: { type: 'string' } } });
assert(values.output, '--output must name a new evidence directory');
const output = path.resolve(values.output);
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.mkdirSync(output);
const source = 'extensions/vscode/dev-session-canvas/src/common/serializedTerminalState.ts';
const scope = 'Actual tracker/headless parser with controlled callbacks; no native PTY, Webview UI, or production integration.';
const cases = [
  { name: 'final-crlf', first: 'MAIN', last: '\r\n', lines: ['MAIN', ''], cursor: [0, 1] },
  { name: 'split-csi-cursor', first: 'abc\x1b[', last: '2D!', lines: ['a!c'], cursor: [2, 0] },
  { name: 'split-osc-title', first: 'MAIN\x1b]0;FINAL', last: '\x07\r\nTAIL\r\n',
    lines: ['MAIN', 'TAIL', ''], cursor: [0, 2], title: 'FINAL' },
  { name: 'negative-control-dispose-before-flush' }
];
write('schedule.json', cases);
write('environment.json', { scope, versions: process.versions, platform: process.platform,
  arch: process.arch, sourceHashes: hashes([source, 'scripts/diagnostics/diagnose-terminal-final-apply.mjs']) });
const results = [];
let active;
try {
  await assert.rejects(waitForParserCallback(new Promise(() => {}), Promise.reject(new Error('injected-flush-error'))), /injected-flush-error/);
  await assert.rejects(waitForParserCallback(new Promise(() => {}), Promise.resolve()), /flush settled before parser callback/);
  await waitForParserCallback(Promise.resolve(), new Promise(() => {}));
  write('failure-capture-check.json', { earlyRejection: 'captured', earlyCompletion: 'rejected', callbackFirst: 'accepted' });
  const bundle = await esbuild.build({ entryPoints: [source], bundle: true, platform: 'node',
    format: 'cjs', target: 'node18', write: false, metafile: true });
  write('input-hashes.json', hashes(Object.keys(bundle.metafile.inputs)));
  const module = { exports: {} };
  new Function('module', 'exports', 'require', bundle.outputFiles[0].text)(
    module, module.exports, createRequire(import.meta.url));
  const { SerializedTerminalStateTracker } = module.exports;
  for (const scenario of cases) {
    active = { name: scenario.name, trace: [] };
    // This guard only makes a broken diagnostic fail with evidence; it is not a drain policy.
    const guard = setTimeout(() => {
      write('incomplete.json', { ...active, reason: 'diagnostic-hard-deadline', completed: results });
      process.exit(2);
    }, 10000);
    try {
      await sample(SerializedTerminalStateTracker, scenario, active.trace);
      results.push({ ...active, passed: true });
    } catch (error) {
      results.push({ ...active, passed: false, error: error.stack ?? String(error) });
    } finally {
      clearTimeout(guard);
    }
    write('results.json', results);
    console.log(`${results.at(-1).passed ? 'PASS' : 'FAIL'} ${scenario.name}`);
  }
  const failed = results.filter(result => !result.passed).length;
  write('summary.json', { scope, total: results.length, passed: results.length - failed, failed });
  console.log(JSON.stringify({ output, total: results.length, failed, scope }));
  if (failed) process.exitCode = 1;
} catch (error) {
  write('harness-error.json', { error: error.stack ?? String(error), active, results });
  process.exitCode = 1;
  console.error(error);
}

async function sample(Tracker, scenario, trace) {
  const tracker = new Tracker(40, 8);
  let release;
  let flushing;
  const titleEvents = [];
  const titleSubscription = tracker.terminal.onTitleChange(title => titleEvents.push(title));
  try {
    if (scenario.name.startsWith('negative-control')) {
      tracker.write('UNAPPLIED\r\n', { outputSequence: 1 });
      trace.push({ event: 'write-queued', pendingCharacters: tracker.pendingWriteData.length });
      assert(tracker.pendingWriteData.length > 0);
      tracker.dispose();
      const state = await tracker.flush();
      assert.equal(state.data, '');
      assert.equal(state.outputSequence, undefined);
      trace.push({ event: 'disposed-before-flush', state,
        meaning: 'Intentional negative control: disposal is not proof of application; not a natural-exit product reproduction.' });
      return;
    }

    tracker.write(scenario.first, { outputSequence: 1 });
    const firstState = await tracker.flush();
    assert.equal(firstState.outputSequence, 1);
    trace.push({ event: 'first-write-flushed', outputSequence: firstState.outputSequence });
    let callbackCaptured;
    const captured = new Promise(resolve => { callbackCaptured = resolve; });
    const terminal = tracker.terminal;
    const originalWrite = terminal.write.bind(terminal);
    let callbackCount = 0;
    terminal.write = (data, done) => {
      originalWrite(data, () => {
        callbackCount++;
        release = () => {
          trace.push({ event: 'parser-callback-released' });
          done();
          release = undefined;
        };
        trace.push({ event: 'parser-callback-held', cursor: cursor(terminal), data });
        callbackCaptured();
      });
    };
    tracker.write(scenario.last, { outputSequence: 2 });
    let flushSettled = false;
    flushing = tracker.flush().then(state => {
      flushSettled = true;
      trace.push({ event: 'final-flush-settled', outputSequence: state.outputSequence });
      return state;
    });
    await waitForParserCallback(captured, flushing);
    await Promise.resolve();
    assert.equal(callbackCount, 1);
    assert.equal(flushSettled, false, 'flush cannot settle before its parser callback');
    assert.equal(tracker.getSerializedState().outputSequence, 1, 'cached revision must not claim the unacknowledged write');
    trace.push({ event: 'pre-release-check', flushSettled, cachedSequence: tracker.getSerializedState().outputSequence });
    release();
    const state = await flushing;
    assert.equal(state.outputSequence, 2);
    assert.deepEqual(cursor(terminal), scenario.cursor);
    const lines = scenario.lines.map((_, index) => terminal.buffer.active.getLine(index)?.translateToString(true));
    assert.deepEqual(lines, scenario.lines);
    if (scenario.title) assert.deepEqual(titleEvents, [scenario.title]);
    else assert.deepEqual(titleEvents, []);
    trace.push({ event: 'final-state', cursor: cursor(terminal), lines, titleEvents, state });
    tracker.dispose();
    const afterDispose = await tracker.flush();
    assert.deepEqual(afterDispose, state, 'post-application disposal must preserve the proven final state');
    trace.push({ event: 'disposed-after-flush', outputSequence: afterDispose.outputSequence });
  } finally {
    if (release) release();
    if (flushing) await flushing.catch(() => {});
    titleSubscription.dispose();
    tracker.dispose();
  }
}

function cursor(terminal) { return [terminal.buffer.active.cursorX, terminal.buffer.active.cursorY]; }
function waitForParserCallback(captured, flushing) {
  return Promise.race([captured, flushing.then(() => { throw new Error('flush settled before parser callback'); })]);
}
function hashes(files) {
  return Object.fromEntries(files.map(file => [file, createHash('sha256').update(fs.readFileSync(file)).digest('hex')]));
}
function write(name, value) { fs.writeFileSync(path.join(output, name), `${JSON.stringify(value, null, 2)}\n`); }
