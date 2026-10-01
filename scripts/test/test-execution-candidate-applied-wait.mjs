import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

const source = await fs.readFile('tests/vscode-smoke/execution-candidate-tests.cjs', 'utf8');
const originalLines = Array.from({ length: 90000 }, (_, index) =>
  `DSC_CANDIDATE_${String(index + 1).padStart(5, '0')}_${'0'.repeat(40)}`);
originalLines.push('DSC_CANDIDATE_UTF8_\u4e2d\u6587_\u00e9', 'DSC_CANDIDATE_ANSI');

function load(mode, options = {}) {
  let now = 1000, reads = 0;
  const calls = [];
  const event = {
    kind: mode === 'live-runtime' ? 'runtime/terminalReadSettled' : 'execution/localTerminalReaderSettled',
    detail: { nodeId: 'node-a', sessionId: 'execution-a', executionSessionId: 'execution-a',
      outcome: { kind: 'applied', finalRevision: 12, finalOutputSequence: 12 } }
  };
  const mocks = {
    'node:assert/strict': assert, 'node:fs/promises': {}, 'node:path': path, 'node:crypto': { createHash },
    './test-helpers.cjs': {}, './windows-execution-candidate.cjs': {}, './installed-execution-candidate.cjs': {},
    vscode: { commands: { async executeCommand(name, ...args) {
      calls.push({ name, args, at: now });
      if (name.endsWith('.getDiagnosticEvents')) {
        reads++;
        if (options.readError) throw options.readError;
        now += options.readDelay ?? 0;
        if (reads <= (options.emptyReads ?? 0)) return [];
        const candidate = structuredClone(event);
        options.changeEvent?.(candidate);
        return [candidate];
      }
      assert(name.endsWith('.performWebviewDomAction'));
      const [action, surface, budget] = args;
      assert.equal(surface, mode === 'live-runtime' ? 'editor' : 'panel');
      assert.equal(action.kind, 'assertExecutionTerminalBuffer');
      assert.equal(action.nodeId, 'node-a');
      assert.equal(action.linePrefix, 'DSC_CANDIDATE_');
      assert.equal(JSON.stringify(action.expectedLines), JSON.stringify(originalLines));
      assert.equal(action.expectedLines, context.module.exports.__test.expectedLines);
      assert.equal(budget, 31000 - now);
      assert(budget > 0 && budget <= 30000);
      now += options.bufferDelay === 'remaining' ? budget : options.bufferDelay ?? 0;
      if (options.bufferError) throw options.bufferError;
    } } }
  };
  const context = {
    module: { exports: {} }, process: { env: { DEV_SESSION_CANVAS_CANDIDATE_MODE: mode } },
    Date: { now: () => now }, setTimeout(callback, delay) { now += delay; callback(); },
    require(name) { assert(Object.hasOwn(mocks, name), `Unexpected require ${name}`); return mocks[name]; }
  };
  vm.runInNewContext(`${source}\nmodule.exports.__test = { assertAppliedBuffer, expectedLines };`, context);
  return { calls, run: sequence => context.module.exports.__test.assertAppliedBuffer('node-a', 'execution-a', sequence),
    fullAssertions: () => calls.filter(call => call.name.endsWith('.performWebviewDomAction')) };
}

for (const mode of ['live-runtime', 'snapshot-only']) {
  const success = load(mode, { emptyReads: 2, bufferDelay: 4 });
  await success.run(12);
  assert.equal(success.fullAssertions().length, 1);
  assert.deepEqual(success.calls.map(call => call.name.split('.').at(-1)),
    ['getDiagnosticEvents', 'getDiagnosticEvents', 'getDiagnosticEvents', 'performWebviewDomAction']);
  assert.equal(success.fullAssertions()[0].args[2], 29900);

  for (const changeEvent of [
    event => { event.detail.outcome.kind = 'cancelled'; },
    event => { event.detail.outcome.kind = 'lost'; },
    event => { event.detail.outcome.kind = 'unknown'; },
    event => { event.kind = 'unconfirmed'; },
    event => { event.detail.nodeId = 'other-node'; },
    event => { event.detail.sessionId = event.detail.executionSessionId = 'other-execution'; },
    ...(mode === 'snapshot-only' ? [event => { event.detail.outcome.finalOutputSequence = 11; }] : [])
  ]) {
    const rejected = load(mode, { changeEvent });
    await assert.rejects(rejected.run(12), /Timed out: actual xterm buffer fully applied/);
    assert.equal(rejected.fullAssertions().length, 0);
  }
  const lateRead = load(mode, { readDelay: 30000 });
  await assert.rejects(lateRead.run(12), /Timed out: actual xterm buffer fully applied/);
  assert.equal(lateRead.fullAssertions().length, 0);
  const lateBuffer = load(mode, { emptyReads: 1, bufferDelay: 'remaining' });
  await assert.rejects(lateBuffer.run(12), /Timed out: actual xterm buffer fully applied/);
  assert.equal(lateBuffer.fullAssertions().length, 1);

  for (const failurePoint of ['readError', 'bufferError']) {
    const originalError = new Error(failurePoint === 'bufferError'
      ? 'Execution terminal node-a differs at line 1' : 'Diagnostic read failed');
    const failed = load(mode, { [failurePoint]: originalError });
    await assert.rejects(failed.run(12), error => error === originalError);
    assert.equal(failed.fullAssertions().length, failurePoint === 'bufferError' ? 1 : 0);
  }
}
for (const sequence of [undefined, -1, NaN, 1.5]) {
  const missingFinal = load('snapshot-only');
  await assert.rejects(missingFinal.run(sequence), /Timed out: actual xterm buffer fully applied/);
  assert.equal(missingFinal.fullAssertions().length, 0);
}
assert(source.includes('await assertAppliedBuffer(id, executionId, nodeById(ended, id).metadata.terminal.outputSequence)'));
assert(source.includes("poll('same Runtime reader applied settlement'"));
assert(source.includes("poll('same owned local reader applied final revision'"));
assert(source.includes('event.detail.outcome.finalOutputSequence === savedNode.metadata.terminal.outputSequence'));
console.log('Both modes wait for original applied identity, send one unchanged full buffer, preserve the 30s deadline and reject late/error/cancelled outcomes (no native execution).');
