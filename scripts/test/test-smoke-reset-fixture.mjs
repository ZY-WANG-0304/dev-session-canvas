import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { resetCanvasAfterFinalPersistence } = createRequire(import.meta.url)('../../tests/vscode-smoke/reset-canvas.cjs');

const agent = { kind: 'agent', id: 'fresh-agent' };
const terminal = { kind: 'terminal', id: 'fresh-terminal' };
function event(node = agent, kind = 'saved', overrides = {}) {
  return { kind: 'execution/localFinalPersistence', detail: {
    kind: node.kind, nodeId: node.id, executionId: `execution-${node.id}`, generation: 'generation',
    submitted: kind === 'saved', result: { kind }, ...overrides
  } };
}
function fixture(options = {}) {
  let clock = 0, calls = 0, reads = 0;
  let nodes = [agent, terminal, { kind: 'note', id: 'note' }];
  const pending = new Error('Local final snapshot persistence is pending: agent:fresh-agent');
  const f = {
    reset: async () => {
      calls++;
      clock += options.resetCost ?? 0;
      if (calls === 1 && !options.immediate) throw options.error ?? pending;
      if (options.secondError) throw options.secondError;
      if (!options.keepNodes) nodes = [];
    },
    getSnapshot: async () => ({ state: { nodes } }),
    getDiagnosticEvents: async () => {
      reads++;
      if (reads === 1) return options.baseline ?? [];
      return options.events?.(reads - 1) ?? (reads === 2 ? [event()] : [event(), event(terminal, 'not-required')]);
    },
    expectedExecutions: [agent, terminal], timeoutMs: 20000,
    now: () => clock, sleep: async ms => { clock += ms; options.onSleep?.(() => { nodes = []; }); }
  };
  return { run: () => resetCanvasAfterFinalPersistence(f), calls: () => calls, reads: () => reads, pending };
}
const tests = [];
const test = (name, run) => tests.push({ name, run });
test('successful reset never retries or waits for persistence', async () => {
  const f = fixture({ immediate: true });
  assert.equal((await f.run()).state.nodes.length, 0);
  assert.equal(f.calls(), 1); assert.equal(f.reads(), 1);
});
test('pending waits for every original execution then performs exactly one new reset', async () => {
  const f = fixture();
  await f.run(); assert.equal(f.calls(), 2); assert.equal(f.reads(), 3);
});
for (const kind of ['failed', 'unconfirmed', 'pending']) {
  test(`${kind} final persistence cannot authorize another reset`, async () => {
    const f = fixture({ events: () => [event(agent, kind), event(terminal)] });
    await assert.rejects(f.run(), /Final persistence did not succeed/); assert.equal(f.calls(), 1);
  });
}
for (const message of ['Local final snapshot persistence is failed: agent:fresh-agent',
  'Local final snapshot persistence is pending: agent:another-agent', 'Non-native Host execution cleanup is unconfirmed']) {
  test(`unexpected rejection propagates: ${message}`, async () => {
    const error = new Error(message), f = fixture({ error });
    await assert.rejects(f.run(), candidate => candidate === error); assert.equal(f.calls(), 1); assert.equal(f.reads(), 1);
  });
}
test('an old saved identity cannot authorize a restarted node reset', async () => {
  const old = event(agent, 'saved', { executionId: 'old-execution' });
  const f = fixture({ baseline: [old], events: () => [old, event(terminal)] });
  await assert.rejects(f.run(), /Timed out/); assert.equal(f.calls(), 1);
});
test('a new final identity can settle a restarted node despite its older saved event', async () => {
  const old = event(agent, 'saved', { executionId: 'old-execution' });
  const f = fixture({ baseline: [old], events: () => [old, event(), event(terminal)] });
  await f.run(); assert.equal(f.calls(), 2);
});
test('a repeated pending rejection is not retried', async () => {
  const error = new Error('Local final snapshot persistence is pending: agent:fresh-agent');
  const f = fixture({ secondError: error });
  await assert.rejects(f.run(), candidate => candidate === error); assert.equal(f.calls(), 2);
});
for (const events of [
  [event(), event(agent, 'saved', { executionId: 'replacement' }), event(terminal)],
  [event(agent, 'saved', { executionId: undefined }), event(terminal)],
  [event(agent, 'saved', { submitted: false }), event(terminal)]
]) {
  test('ambiguous or invalid persistence evidence cannot authorize another reset', async () => {
    const f = fixture({ events: () => events });
    await assert.rejects(f.run(), /identit|submission/); assert.equal(f.calls(), 1);
  });
}
test('unrelated saved events cannot satisfy a missing original final save', async () => {
  const f = fixture({ events: () => [event({ kind: 'agent', id: 'unrelated' })] });
  await assert.rejects(f.run(), /Timed out/); assert.equal(f.calls(), 1);
});
test('time consumed by the first reset is included in the original total budget', async () => {
  const f = fixture({ resetCost: 19950 });
  await assert.rejects(f.run(), /Timed out/); assert.equal(f.calls(), 1);
});
test('a second reset finishing beyond the original deadline still fails', async () => {
  const f = fixture({ resetCost: 10000, events: () => [event(), event(terminal)] });
  await assert.rejects(f.run(), /Timed out/); assert.equal(f.calls(), 2);
});
test('node replacement while waiting prevents another reset', async () => {
  const f = fixture({ onSleep: replace => replace() });
  await assert.rejects(f.run(), /must not replace/); assert.equal(f.calls(), 1);
});
test('a successful command cannot hide a nonempty canvas', async () => {
  const f = fixture({ immediate: true, keepNodes: true });
  await assert.rejects(f.run(), /empty canvas/); assert.equal(f.calls(), 1);
});
for (const { name, run } of tests) { await run(); console.log(`ok - ${name}`); }
console.log(`Smoke reset fixture: ${tests.length}/${tests.length} passed.`);
