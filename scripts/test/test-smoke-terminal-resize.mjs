import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { waitForTerminalResize } = createRequire(import.meta.url)('../../tests/vscode-smoke/terminal-resize.cjs');

const expectedNodes = ['agent', 'terminal'].map(kind => ({ nodeId: kind, kind, sessionId: `${kind}-original`,
  runtimeStoragePath: '/original-supervisor', size: { width: 680, height: 520 },
  visibleMarker: `${kind}-ready`, markers: [`${kind}-ready`, `${kind}-input`] }));
const before = { probe: { nodes: expectedNodes.map(expected => ({ nodeId: expected.nodeId, terminalCols: 67, terminalRows: 21 })) } };
function sample({ raw = [82, 27], fit = [82, 27], session = raw, pending = false } = {}) {
  return {
    snapshot: { state: { nodes: expectedNodes.map(e => ({ id: e.nodeId, kind: e.kind, size: e.size,
      metadata: { [e.kind]: { runtimeSessionId: e.sessionId, runtimeStoragePath: e.runtimeStoragePath,
        liveSession: true, attachmentState: 'attached-live' } } })) } },
    probe: { nodes: expectedNodes.map(e => ({ nodeId: e.nodeId, kind: e.kind,
      renderedWidth: e.size.width, renderedHeight: e.size.height, terminalCols: raw[0], terminalRows: raw[1],
      terminalFitCols: fit[0], terminalFitRows: fit[1], terminalProjectionPending: pending,
      terminalExecutionSessionId: e.sessionId, terminalVisibleLines: [e.visibleMarker] })) },
    sessions: expectedNodes.map(e => ({ sessionId: e.sessionId, kind: e.kind, live: true,
      cols: session[0], rows: session[1], output: e.markers.join('\n') }))
  };
}
function fixture(sequence, options = {}) {
  let clock = 0, index = 0;
  const observed = [], budgets = [];
  const current = () => sequence[Math.min(index, sequence.length - 1)];
  const deps = {
    expectedNodes, before, timeoutMs: 20000,
    getSnapshot: async () => current().snapshot,
    getProbe: async remaining => { budgets.push(remaining); clock += options.probeCost ?? 0; return current().probe; },
    getSession: async id => current().sessions.find(s => s.sessionId === id) ?? { ...current().sessions[0], sessionId: 'replacement' },
    onSample: s => { observed.push(s); options.onSample?.(s); },
    now: () => clock, sleep: async ms => { clock += ms; index++; },
    ...options.overrides
  };
  return { run: () => waitForTerminalResize(deps), observed, budgets, clock: () => clock };
}
const tests = [];
const test = (name, run) => tests.push({ name, run });
test('C8 transient sequence cannot become the target; final original session succeeds', async () => {
  const initial = sample({ raw: [92, 28], fit: [67, 21] });
  const transient = sample({ raw: [67, 21], fit: [82, 27] });
  // The previous first-change predicate accepts this while the card already needs 82×27.
  assert.notDeepEqual([transient.probe.nodes[0].terminalCols, transient.probe.nodes[0].terminalRows],
    [initial.probe.nodes[0].terminalCols, initial.probe.nodes[0].terminalRows]);
  const final = sample();
  assert.notEqual(final.sessions[0].cols, transient.probe.nodes[0].terminalCols);
  const f = fixture([initial, transient, final]);
  const result = await f.run();
  assert.equal(result.sessions[0].cols, 82);
  assert.deepEqual(f.observed.map(s => s.observations.every(o => o.matches)), [false, false, true]);
});
test('baseline waits for restore, fit and the original Supervisor before changing the card', async () => {
  const f = fixture([sample({ raw: [92, 28], fit: [67, 21], pending: true }),
    sample({ raw: [67, 21], fit: [67, 21], session: [92, 28] }),
    sample({ raw: [67, 21], fit: [67, 21] })], { overrides: { before: undefined } });
  assert.equal((await f.run()).sessions[0].cols, 67);
  assert.equal(f.observed.length, 3);
});
test('a genuinely missing Supervisor resize times out in the same 20 second budget', async () => {
  const f = fixture([sample({ session: [67, 21] })]);
  await assert.rejects(f.run(), /Timed out/);
  assert.equal(f.clock(), 20000);
  assert.equal(f.observed.length, 200);
  assert.equal(f.budgets.at(-1), 100);
});
test('old card, missing fit, pending projection, unchanged baseline, missing markers and dead session cannot pass', async () => {
  const mutations = [
    s => { s.snapshot.state.nodes[0].size = { width: 560, height: 430 }; },
    s => { s.probe.nodes[0].renderedWidth = 560; },
    s => { delete s.probe.nodes[0].terminalFitCols; },
    s => { s.probe.nodes[0].terminalProjectionPending = true; },
    s => { s.probe.nodes[0].terminalExecutionSessionId = 'replacement'; },
    s => { s.probe.nodes[0].terminalFitRows = 21; },
    s => { s.sessions[0].output = 'agent-ready'; },
    s => { s.probe.nodes[0].terminalVisibleLines = []; },
    s => { s.sessions[0].live = false; },
    s => { s.snapshot.state.nodes[0].metadata.agent.attachmentState = 'reattaching'; }
  ];
  for (const mutate of mutations) { const s = sample(); mutate(s); await assert.rejects(fixture([s]).run(), /Timed out/); }
  await assert.rejects(fixture([sample({ raw: [67, 21], fit: [67, 21] })]).run(), /Timed out/);
});
test('both original nodes must converge in one observation, not separate historical samples', async () => {
  const a = sample(), b = sample(); a.sessions[1].cols = 67; b.sessions[0].cols = 67;
  // Use alternating snapshots under a deterministic bounded clock.
  let time = 0, turn = 0;
  await assert.rejects(waitForTerminalResize({ expectedNodes, before, timeoutMs: 20000,
    getSnapshot: async () => [a, b][turn % 2].snapshot, getProbe: async () => [a, b][turn % 2].probe,
    getSession: async id => [a, b][turn % 2].sessions.find(s => s.sessionId === id),
    now: () => time, sleep: async ms => { time += ms; turn++; } }), /Timed out/);
  assert.equal(time, 20000);
});
test('replaced Host binding, Supervisor path, node or response identity fail immediately', async () => {
  const mutations = [
    s => { s.snapshot.state.nodes[0].metadata.agent.runtimeSessionId = 'replacement'; },
    s => { s.snapshot.state.nodes[0].metadata.agent.runtimeStoragePath = '/another'; },
    s => { s.snapshot.state.nodes[0].kind = 'terminal'; },
    s => { s.sessions[0].sessionId = 'replacement'; },
    s => { s.sessions[0].kind = 'terminal'; }
  ];
  for (const mutate of mutations) {
    const s = sample(); mutate(s); const f = fixture([s]);
    await assert.rejects(f.run(), /Original|Wrong/); assert.equal(f.clock(), 0);
  }
});
test('a late successful probe cannot reset the deadline or authorize success', async () => {
  const f = fixture([sample()], { probeCost: 20000 });
  await assert.rejects(f.run(), /Timed out/); assert.equal(f.observed.length, 0);
});
test('a hung read is bounded and its original I/O error is preserved', async () => {
  await assert.rejects(waitForTerminalResize({ expectedNodes, timeoutMs: 30,
    getSnapshot: () => new Promise(() => {}) }), /Timed out/);
  const error = new Error('original socket closed');
  await assert.rejects(fixture([sample()], { overrides: { getSession: async () => { throw error; } } }).run(), e => e === error);
});
test('failed diagnostic callback cannot mask success or a real resize timeout', async () => {
  const options = { onSample: () => { throw new Error('artifact unavailable'); } };
  assert.equal((await fixture([sample()], options).run()).sessions[0].cols, 82);
  await assert.rejects(fixture([sample({ session: [67, 21] })], options).run(), /Timed out/);
});
for (const { name, run } of tests) { await run(); console.log(`PASS ${name}`); }
console.log(`Smoke terminal resize: ${tests.length} checks passed.`);
