import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { runSnapshotReopen, runEmptySnapshotReopen, reopenReportPassed, completeEmptySnapshotReopen, REOPEN_CHECKS } =
  require('../../tests/vscode-smoke/agent-candidate-reopen.cjs');

function fixture({ nonEmpty = false } = {}) {
  const node = { id: 'n1', kind: 'agent', status: 'stopped', metadata: { agent: {
    persistenceMode: 'snapshot-only', liveSession: false, outputSequence: 2,
    serializedTerminalState: { format: 'xterm-serialize-v1', data: nonEmpty ? 'hello\r\nworld' : '', outputSequence: 2, viewportY: 0 }
  } } };
  const handoff = { schemaVersion: 1, hostPid: 101, nodeId: 'n1', workspacePath: '/workspace',
    runtimeDir: '/runtime', userDataDir: '/user-data', snapshotPath: '/user-data/state.json',
    readerFrameId: 'first-page', savedState: structuredClone(node.metadata.agent.serializedTerminalState),
    outputSequence: 2, savedCols: 60, savedRows: 20, originalChecksPassed: true };
  const state = { state: { nodes: [node] }, surfaceLifecycle: { panel: { frameId: 'fresh-page' } } };
  const persisted = { state: { nodes: [structuredClone(node)] } };
  const runtime = { bindings: [], pendingRuntimeSupervisorOperationCount: 0 };
  const diagnostics = { host: { pid: 202 }, workspace: { folders: ['/workspace'] },
    storage: { persistedCanvasSnapshotPath: '/user-data/state.json' },
    runtime: { executionSessions: { agent: [], terminal: [] }, runtimeSessionBindingCount: 0,
      pendingRuntimeSupervisorOperationCount: 0 } };
  const events = [{ kind: 'state/loadSelected', detail: { source: 'rootLocalSnapshot',
    snapshotAvailable: true, snapshotPath: '/user-data/root.json', rootPath: '/workspace' } }];
  const messages = [];
  const page = { nodes: [{ nodeId: 'n1', terminalCols: 60, terminalRows: 20,
    terminalCursorX: nonEmpty ? 5 : 0, terminalCursorY: nonEmpty ? 1 : 0, terminalViewportY: 0,
    terminalBufferType: 'normal', terminalVisibleLines: nonEmpty
      ? ['hello', 'world', ...Array(18).fill('')] : Array(20).fill('') }] };
  const calls = [];
  const reports = {};
  let reset = false;
  const value = { handoff, state, persisted, runtime, diagnostics, events, messages, page, calls, reports,
    bufferEmpty: !nonEmpty, expectedLines: nonEmpty ? ['hello', 'world'] : [],
    cleanupError: undefined, activationError: undefined };
  value.options = { config: { mode: 'snapshot-only', lifecycle: 'stop', surface: 'panel',
    workspacePath: '/workspace', runtimeDir: '/runtime', userDataDir: '/user-data', reopenHandoffPath: '/handoff.json' },
    hostPid: 202, workspaceFolders: ['/workspace'],
    realpath: async value => value,
    activate: async () => { calls.push('activate'); if (value.activationError) throw value.activationError; },
    openCanvas: async () => { calls.push('openCanvas'); },
    probe: async () => { calls.push('probe'); return page; },
    assertBuffer: async (nodeId, expectedLines) => {
      calls.push('assertBuffer'); assert.equal(nodeId, 'n1');
      assert.deepEqual(expectedLines, value.expectedLines);
      if (!value.bufferEmpty && expectedLines.length === 0) throw new Error('nonempty full buffer');
      return true;
    },
    readJson: async file => {
      calls.push(`read:${file}`);
      if (file === '/handoff.json') return handoff;
      if (file === '/user-data/root.json') return persisted;
      if (file === '/diagnostics.json') return diagnostics;
      throw new Error('unexpected file');
    },
    writeJson: async (file, report) => { calls.push(`write:${file}`); reports[file] = structuredClone(report); },
    command: async name => {
      calls.push(name);
      if (name === 'getDebugState') return reset ? { state: { nodes: [] } } : state;
      if (name === 'getDiagnosticEvents') return events;
      if (name === 'getHostMessages') return messages;
      if (name === 'getRuntimeSupervisorState') return runtime;
      if (name === 'dumpHostDiagnostics') return { summaryPath: '/diagnostics.json' };
      if (name === 'waitForCanvasReady') return;
      if (name === 'resetState') {
        if (value.cleanupError) throw value.cleanupError;
        reset = true;
        runtime.bindings.length = 0;
        diagnostics.runtime.executionSessions.agent.length = 0;
        diagnostics.runtime.executionSessions.terminal.length = 0;
        diagnostics.runtime.runtimeSessionBindingCount = 0;
        diagnostics.runtime.pendingRuntimeSupervisorOperationCount = 0;
        runtime.pendingRuntimeSupervisorOperationCount = 0;
        return;
      }
      if (name === 'flushPersistedState') {
        assert(reset, 'Never flush/reset/create over original persisted state before actual load verification.');
        return { exists: true, snapshot: { state: { nodes: [] } } };
      }
      throw new Error(`Unexpected command: ${name}`);
    }
  };
  return value;
}

const success = fixture();
await runEmptySnapshotReopen(success.options);
assert.equal(reopenReportPassed(success.reports['reopen-result.json']), true);

const nonEmpty = fixture({ nonEmpty: true });
await runSnapshotReopen(nonEmpty.options);
assert.equal(reopenReportPassed(nonEmpty.reports['reopen-result.json']), true);
assert.equal(nonEmpty.reports['reopen-result.json'].stateRetained, true);
assert.equal(nonEmpty.reports['reopen-result.json'].pageBufferMatched, true);
assert.equal(nonEmpty.reports['reopen-result.json'].pageGeometryMatched, true);
assert(success.calls.indexOf('getDebugState') < success.calls.indexOf('resetState'));
assert(success.calls.indexOf('assertBuffer') < success.calls.indexOf('resetState'));
assert(success.calls.indexOf('read:/user-data/root.json') < success.calls.indexOf('dumpHostDiagnostics'));
assert.equal(success.calls.filter(name => name === 'resetState').length, 1);
for (const name of REOPEN_CHECKS) {
  for (const invalid of [false, null, undefined, 'true']) {
    assert.equal(reopenReportPassed({ ...success.reports['reopen-result.json'], [name]: invalid }), false, name);
  }
}
assert.equal(reopenReportPassed(undefined), false);
assert.equal(reopenReportPassed({ ...success.reports['reopen-result.json'], schemaVersion: 2 }), false);

for (const [name, mutate] of [
  ['same host', value => { value.options.hostPid = 101; }],
  ['runtime changed', value => { value.options.config.runtimeDir = '/other-runtime'; }],
  ['workspace changed', value => { value.options.workspaceFolders = ['/other']; }],
  ['user data changed', value => { value.handoff.userDataDir = '/other'; }],
  ['original checks missing', value => { delete value.handoff.originalChecksPassed; }],
  ['no persisted load event', value => { value.events.length = 0; }],
  ['default load', value => { value.events[0].detail.source = 'default'; }],
  ['persisted node missing', value => { value.persisted.state.nodes.length = 0; }],
  ['loaded node missing', value => { value.state.state.nodes.length = 0; }],
  ['loaded node live', value => { value.state.state.nodes[0].metadata.agent.liveSession = true; }],
  ['empty state missing', value => { delete value.state.state.nodes[0].metadata.agent.serializedTerminalState; }],
  ['saved empty state changed', value => { value.persisted.state.nodes[0].metadata.agent.serializedTerminalState.data = 'x'; }],
  ['sequence changed', value => { value.state.state.nodes[0].metadata.agent.outputSequence += 1; }],
  ['same page frame', value => { value.state.surfaceLifecycle.panel.frameId = 'first-page'; }],
  ['page missing', value => { value.page.nodes.length = 0; }],
  ['hidden buffer output', value => { value.bufferEmpty = false; }],
  ['cursor changed', value => { value.page.nodes[0].terminalCursorX = 1; }],
  ['viewport changed', value => { value.page.nodes[0].terminalViewportY = 1; }],
  ['alternate buffer', value => { value.page.nodes[0].terminalBufferType = 'alternate'; }],
  ['agent session', value => { value.diagnostics.runtime.executionSessions.agent.push({}); }],
  ['runtime binding', value => { value.runtime.bindings.push({}); }],
  ['transient execution', value => { value.events.push({ kind: 'execution/started' }); }],
  ['new output', value => { value.messages.push({ type: 'host/executionOutput', payload: { nodeId: 'n1' } }); }],
  ['unknown event window', value => { while (value.events.length < 2000) value.events.push({ kind: 'ignored' }); }],
  ['cleanup failure', value => { value.cleanupError = new Error('cleanup failed'); }]
]) {
  const value = fixture();
  mutate(value);
  await assert.rejects(runEmptySnapshotReopen(value.options), undefined, name);
  assert.equal(reopenReportPassed(value.reports['reopen-result.json']), false, name);
  assert(value.calls.includes('resetState'), `${name}: both success and failure must attempt product cleanup.`);
}
const twoFailures = fixture();
twoFailures.bufferEmpty = false;
twoFailures.cleanupError = new Error('cleanup failed');
await assert.rejects(runEmptySnapshotReopen(twoFailures.options), /nonempty full buffer/);
assert.equal(twoFailures.reports['reopen-result.json'].cleanupComplete, false);
const launched = [];
const finish = firstResult => completeEmptySnapshotReopen({ firstResult,
  launch: async () => { launched.push('launch'); }, readReport: async () => success.reports['reopen-result.json'] });
assert.equal(await finish({ pass: true, reopenRequired: false, reopenHandoffReady: false }), false);
assert.equal(launched.length, 0, 'Nonempty/natural scenarios must not launch another Host.');
assert.equal(await finish({ pass: true, reopenRequired: true, reopenHandoffReady: true }), true);
assert.equal(launched.length, 1);
for (const firstResult of [undefined, { pass: false, reopenRequired: true, reopenHandoffReady: true },
  { pass: true, reopenRequired: true, reopenHandoffReady: false },
  { pass: true, reopenRequired: 'true', reopenHandoffReady: true }]) await assert.rejects(finish(firstResult));
assert.equal(launched.length, 1, 'A failed or incomplete first stage cannot launch the verification stage.');
await assert.rejects(completeEmptySnapshotReopen({ firstResult: { pass: true, reopenRequired: true, reopenHandoffReady: true },
  launch: async () => {}, readReport: async () => undefined }), /reopen report/i);
await assert.rejects(completeEmptySnapshotReopen({ firstResult: { pass: true, reopenRequired: true, reopenHandoffReady: true },
  launch: async () => { throw new Error('Host launch failed'); }, readReport: async () => {
    assert.fail('Do not read a stale report after a failed Host launch.');
  } }), /Host launch failed/);
console.log('Agent empty-snapshot reopen: fresh Host load, empty full buffer, no execution, strict report and cleanup checks passed.');
