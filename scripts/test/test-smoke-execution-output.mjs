import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { findExecutionOutput } = createRequire(import.meta.url)('../../tests/vscode-smoke/execution-output.cjs');
const execution = { kind: 'agent', nodeId: 'agent-1', executionSessionId: 'original-execution' };
const marker = '[fake-agent] burst 001';
const chunk = (text, start, end = start, overrides = {}) => ({ type: 'host/executionOutput',
  payload: { ...execution, chunk: text, outputStartSequence: start, outputSequence: end, ...overrides } });
const snapshot = (text, overrides = {}) => ({ type: 'host/executionSnapshot',
  payload: { ...execution, serializedTerminalState: { data: text }, ...overrides } });
const tests = [];
const test = (name, run) => tests.push({ name, run });
test('matches the original execution snapshot even when historical state lacks its output', () => {
  assert.ok(findExecutionOutput([{ type: 'host/stateUpdated', payload: { state: { metadata: { recentOutput: 'old' } } } }, snapshot(marker)], execution, marker));
});
test('matches contiguous output across chunk boundaries and multi-sequence batches', () => {
  assert.ok(findExecutionOutput([chunk('[fake-agent] ', 3, 5), chunk('burst 001', 6)], execution, marker));
});
test('matches plain snapshot output as well as serialized snapshots', () => {
  assert.ok(findExecutionOutput([{ type: 'host/executionSnapshot', payload: { ...execution, output: marker } }], execution, marker));
});
for (const overrides of [{ executionSessionId: 'old-execution' }, { executionSessionId: undefined },
  { nodeId: 'agent-2' }, { kind: 'terminal' }]) {
  test(`rejects unrelated identity ${JSON.stringify(overrides)}`, () => {
    assert.equal(findExecutionOutput([snapshot(marker, overrides), chunk(marker, 1, 1, overrides)], execution, marker), undefined);
  });
}
test('historical metadata never supplies live output evidence', () => {
  assert.equal(findExecutionOutput([{ type: 'host/stateUpdated', payload: { ...execution, output: marker,
    state: { metadata: { recentOutput: marker } } } }], execution, marker), undefined);
});
for (const second of [chunk('burst 001', 3), chunk('burst 001', 1), snapshot('burst 001')]) {
  test('does not join a gap, repeated sequence or snapshot onto an output fragment', () => {
    assert.equal(findExecutionOutput([chunk('[fake-agent] ', 1), second], execution, marker), undefined);
  });
}
test('does not join output across a snapshot boundary', () => {
  assert.equal(findExecutionOutput([chunk('[fake-agent] ', 1), snapshot('new screen'), chunk('burst 001', 2)], execution, marker), undefined);
});
test('does not join output across missing sequence evidence', () => {
  assert.equal(findExecutionOutput([chunk('[fake-agent] ', 1), chunk('', undefined), chunk('burst 001', 2)], execution, marker), undefined);
});
test('requires a nonempty execution identity', () => {
  assert.throws(() => findExecutionOutput([], { kind: 'agent', nodeId: 'agent-1' }, marker), /explicit execution identity/);
});
for (const { name, run } of tests) { run(); console.log(`ok - ${name}`); }
console.log(`Smoke execution output: ${tests.length}/${tests.length} passed.`);
