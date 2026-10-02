import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { Terminal } = require('@xterm/headless');
const { SerializeAddon } = require('@xterm/addon-serialize');
const { collectSnapshotEvidence, acceptsEmptySnapshotStop, acceptsSnapshotStop } =
  require('../../tests/vscode-smoke/agent-candidate-snapshot-evidence.cjs');
const clone = value => structuredClone(value);
const write = (terminal, text) => new Promise(resolve => terminal.write(text, resolve));
const frame = { surface: 'panel', mode: 'active', generation: 1, frameId: 'f1' };
const replayComparisonFields = ['replaySavedGeometryMatched', 'replaySavedLinesMatched', 'replaySavedVisibleMatched',
  'replaySavedSerializedMatched', 'replaySerializedMatchesSavedData'];

async function fixture({ blank = false, resize = false, outputText = 'VISIBLE BEFORE RESET' } = {}) {
  const terminal = new Terminal({ cols: 40, rows: 5, scrollback: 10000, allowProposedApi: true });
  const addon = new SerializeAddon();
  terminal.loadAddon(addon);
  let sequence = 0;
  const state = () => ({ format: 'xterm-serialize-v1', data: addon.serialize({ scrollback: 10000,
    excludeAltBuffer: false, excludeModes: false }), viewportY: terminal.buffer.active.viewportY, outputSequence: sequence });
  const snapshot = liveSession => ({ type: 'host/executionSnapshot', lifecycle: frame,
    payload: { nodeId: 'n1', executionSessionId: 'e1', cols: terminal.cols, rows: terminal.rows,
      liveSession, output: '', outputSequence: sequence, serializedTerminalState: state() } });
  const messages = [snapshot(true)];
  const output = async text => {
    const start = sequence + 1;
    await write(terminal, text);
    sequence += 1;
    messages.push({ type: 'host/executionOutput', lifecycle: frame,
      payload: { nodeId: 'n1', executionSessionId: 'e1', outputStartSequence: start, outputSequence: sequence, chunk: text } });
  };
  try {
    await output(outputText);
    if (resize) {
      terminal.resize(32, 4);
      sequence += 1;
      messages.push(snapshot(true));
    }
    if (blank) await output('\x1bc');
    const savedNode = { id: 'n1', status: 'stopped', metadata: { agent: { liveSession: false,
      persistenceMode: 'snapshot-only', lastCols: terminal.cols, lastRows: terminal.rows,
      outputSequence: sequence, serializedTerminalState: state() } } };
    messages.push(snapshot(false));
    messages.push({ type: 'host/executionExit', lifecycle: frame, payload: { nodeId: 'n1', executionSessionId: 'e1',
      localCompletion: { executionSessionId: 'e1', finalOutputSequence: sequence } } });
    const buffer = terminal.buffer.active;
    const lines = Array.from({ length: buffer.length }, (_, index) => buffer.getLine(index)?.translateToString(true) ?? '');
    const finalProbe = { nodes: [{ nodeId: 'n1', terminalCols: terminal.cols, terminalRows: terminal.rows,
      terminalCursorX: buffer.cursorX, terminalCursorY: buffer.cursorY, terminalViewportY: buffer.viewportY,
      terminalBufferType: buffer.type,
      terminalVisibleLines: Array.from({ length: terminal.rows }, (_, index) => lines[buffer.viewportY + index] ?? '') }] };
    return { savedNode, nodeId: 'n1', executionId: 'e1', messages,
      events: [{ kind: 'execution/localTerminalReaderSettled', detail: { nodeId: 'n1', executionSessionId: 'e1',
        lifecycle: frame, outcome: { kind: 'applied', finalOutputSequence: sequence } } }],
      helpProbe: { nodes: [{ nodeId: 'n1', terminalVisibleLines: ['VISIBLE BEFORE RESET'] }] }, finalProbe,
      assertBuffer: async expected => JSON.stringify(expected) === JSON.stringify(lines.filter(line => line.length > 0)) };
  } finally { terminal.dispose(); }
}

const blank = await fixture({ blank: true });
const blankEvidence = await collectSnapshotEvidence(blank);
assert.equal(blankEvidence.savedDataBytes, 0);
assert.equal(blankEvidence.sequenceMatched, true);
assert.equal(blankEvidence.readerLifecycleMatched, true);
assert.equal(blankEvidence.replayComplete, true);
assert.equal(blankEvidence.replayMatchesSaved, true);
assert.equal(blankEvidence.replayMatchesPage, true);
assert.equal(blankEvidence.savedMatchesPage, true);
assert.equal(blankEvidence.pageProjectionIndependence, 'not-proven');
assert.equal(JSON.stringify(blankEvidence).includes('VISIBLE BEFORE RESET'), false);
for (const field of replayComparisonFields) assert.equal(blankEvidence[field], true, field);
assert.equal(blankEvidence.replayBufferLineCount, 5);
assert.equal(blankEvidence.savedBufferLineCount, 5);
assert.equal(blankEvidence.replaySerializedBytes, 0);
assert.equal(blankEvidence.hydratedSerializedBytes, 0);

const initialSchema = { ...blank, messages: clone(blank.messages) };
delete initialSchema.messages[0].payload.serializedTerminalState.outputSequence;
const inactivePrefix = clone(initialSchema.messages[0]);
delete inactivePrefix.payload.executionSessionId;
delete inactivePrefix.payload.outputSequence;
delete inactivePrefix.payload.serializedTerminalState;
inactivePrefix.payload.liveSession = false;
initialSchema.messages.splice(1, 0, clone(initialSchema.messages[0]));
initialSchema.messages.unshift(inactivePrefix);
const originalInitialMessages = clone(initialSchema.messages);
const initialEvidence = await collectSnapshotEvidence(initialSchema);
assert.equal(initialEvidence.replayComplete, true, 'The recorded production initial schema must replay without relaxing later boundaries.');
assert.equal(initialEvidence.replayInactivePrefixSnapshots, 1);
assert.equal(initialEvidence.replayEquivalentInitialSnapshots, 1);
assert.equal(initialEvidence.replayInitialZeroSequenceInferred, true);
assert.equal(initialEvidence.replayMatchesSaved, true);
assert.deepEqual(initialSchema.messages, originalInitialMessages, 'Evidence normalization must not rewrite original messages.');

const pageResized = { ...blank, finalProbe: clone(blank.finalProbe) };
pageResized.finalProbe.nodes[0].terminalCols = 48;
pageResized.finalProbe.nodes[0].terminalRows = 7;
pageResized.finalProbe.nodes[0].terminalVisibleLines = Array(7).fill('');
const resizedEvidence = await collectSnapshotEvidence(pageResized);
assert.equal(resizedEvidence.pageGeometryMatched, false);
assert.equal(resizedEvidence.pageVisibleMatched, false);
assert.equal(resizedEvidence.savedMatchesPage, false);
assert.deepEqual(resizedEvidence.savedGeometry, { cols: 40, rows: 5, cursorX: 0, cursorY: 0, viewportY: 0, bufferType: 'normal' });
assert.deepEqual(resizedEvidence.pageGeometry, { cols: 48, rows: 7, cursorX: 0, cursorY: 0, viewportY: 0, bufferType: 'normal' });
assert.deepEqual(resizedEvidence.publishedGeometry, { cols: 40, rows: 5 });
assert.deepEqual(resizedEvidence.pageGeometryMatches,
  { cols: false, rows: false, cursorX: true, cursorY: true, viewportY: true, bufferType: true });
assert.equal(resizedEvidence.resizedSavedPageGeometryMatched, true);
assert.equal(resizedEvidence.resizedSavedPageVisibleMatched, true);
assert.equal(resizedEvidence.resizedSavedPageBufferMatched, true);
assert.equal(resizedEvidence.resizedSavedMatchesPage, true);
assert.equal(resizedEvidence.replayMatchesSaved, true, 'The extra resize must not change direct replay comparison.');
const pageMovedCursor = { ...pageResized, finalProbe: clone(pageResized.finalProbe) };
pageMovedCursor.finalProbe.nodes[0].terminalCursorX = 3;
assert.equal((await collectSnapshotEvidence(pageMovedCursor)).resizedSavedMatchesPage, false,
  'The independent resize must not copy the page cursor.');
const pageMovedViewport = { ...pageResized, finalProbe: clone(pageResized.finalProbe) };
pageMovedViewport.finalProbe.nodes[0].terminalViewportY = 1;
assert.equal((await collectSnapshotEvidence(pageMovedViewport)).resizedSavedMatchesPage, false,
  'The independent resize must not copy the page viewport.');

for (const mutate of [
  value => { value.messages[0].payload.output = 'unexpected prelaunch output'; },
  value => { value.messages[0].payload.outputSequence = 0; },
  value => { value.messages[0].payload.serializedTerminalState = clone(blank.messages[0].payload.serializedTerminalState); },
  value => { value.messages[0].payload.terminalRead = {}; },
  value => { value.messages[0].payload.terminalStream = {}; },
  value => { value.messages[0].payload.liveSession = true; },
  value => { value.messages[0].lifecycle.frameId = 'other-reader'; },
  value => { value.messages[0].payload.executionSessionId = 'other-execution'; },
  value => { value.messages.splice(4, 0, value.messages.shift()); },
  value => { value.messages[1].payload.serializedTerminalState.data = 'not empty'; },
  value => { value.messages[1].payload.serializedTerminalState.viewportY = 1; },
  value => { value.messages[1].payload.outputSequence = 1; },
  value => { value.messages[1].payload.terminalRead = {}; },
  value => { value.messages[1].payload.terminalStream = {}; },
  value => { value.messages[2].payload.cols += 1; },
  value => { value.messages.at(-2).payload.serializedTerminalState.outputSequence = undefined; }
]) {
  const invalid = { ...initialSchema, messages: clone(initialSchema.messages) };
  mutate(invalid);
  const result = await collectSnapshotEvidence(invalid);
  assert.equal(result.replayComplete, false, 'Only the recorded strict initial schema is eligible.');
  assert.equal(result.replayMatchesSaved, null);
}

const nonempty = await fixture({ resize: true });
const nonemptyEvidence = await collectSnapshotEvidence(nonempty);
assert(nonemptyEvidence.savedDataBytes > 0);
assert.equal(nonemptyEvidence.replayResizeSnapshots, 1);
assert.equal(nonemptyEvidence.replayMatchesSaved, true);
assert.equal(nonemptyEvidence.savedMatchesPage, true);
for (const field of replayComparisonFields) assert.equal(nonemptyEvidence[field], true, field);
assert.equal(nonemptyEvidence.replayBufferLineCount, 4);
assert.equal(nonemptyEvidence.savedBufferLineCount, 4);
assert.equal(nonemptyEvidence.replaySerializedBytes, Buffer.byteLength(nonempty.savedNode.metadata.agent.serializedTerminalState.data));
assert.equal(nonemptyEvidence.hydratedSerializedBytes, nonemptyEvidence.replaySerializedBytes);
assert.equal(JSON.stringify(nonemptyEvidence).includes('VISIBLE BEFORE RESET'), false);
const repeatedResize = { ...nonempty, messages: clone(nonempty.messages) };
repeatedResize.messages.splice(3, 0, clone(repeatedResize.messages[2]));
assert.equal((await collectSnapshotEvidence(repeatedResize)).replayReason, 'projection-recovery-or-unknown-snapshot',
  'A repeated checkpoint after a resize remains an unsupported recovery, not an initial duplicate.');

const tampered = { ...nonempty, savedNode: clone(nonempty.savedNode) };
tampered.savedNode.metadata.agent.serializedTerminalState.data = '';
const tamperedEvidence = await collectSnapshotEvidence(tampered);
assert.equal(tamperedEvidence.replayComplete, true);
assert.equal(tamperedEvidence.replayMatchesSaved, false);
assert.equal(tamperedEvidence.savedMatchesPage, false);
assert.equal(tamperedEvidence.replayMatchesPage, true);
assert.equal(tamperedEvidence.publishedFinalMatchesSaved, false);
for (const field of replayComparisonFields) assert.equal(tamperedEvidence[field], false, field);
assert.equal(tamperedEvidence.hydratedSerializedBytes, 0);
assert(tamperedEvidence.replaySerializedBytes > 0);

const overwritten = { ...nonempty, savedNode: clone(tampered.savedNode), messages: clone(nonempty.messages),
  finalProbe: clone(nonempty.finalProbe), assertBuffer: async expected => expected.length === 0 };
overwritten.messages.at(-2).payload.serializedTerminalState.data = '';
overwritten.finalProbe.nodes[0].terminalCursorX = 0;
overwritten.finalProbe.nodes[0].terminalVisibleLines.fill('');
const overwrittenEvidence = await collectSnapshotEvidence(overwritten);
assert.equal(overwrittenEvidence.savedMatchesPage, true);
assert.equal(overwrittenEvidence.publishedFinalMatchesSaved, true);
assert.equal(overwrittenEvidence.replayMatchesSaved, false,
  'An empty final snapshot and page must not erase nonempty output from the independent replay.');
assert.equal(overwrittenEvidence.replayMatchesPage, false);

const wrongCursor = { ...nonempty, finalProbe: clone(nonempty.finalProbe) };
wrongCursor.finalProbe.nodes[0].terminalCursorX += 1;
assert.equal((await collectSnapshotEvidence(wrongCursor)).savedMatchesPage, false);
const wrongSequence = { ...nonempty, savedNode: clone(nonempty.savedNode) };
wrongSequence.savedNode.metadata.agent.outputSequence += 1;
assert.equal((await collectSnapshotEvidence(wrongSequence)).sequenceMatched, false);
const wrongReader = { ...blank, events: clone(blank.events) };
wrongReader.events[0].detail.lifecycle.frameId = 'other-reader';
assert.equal((await collectSnapshotEvidence(wrongReader)).readerLifecycleMatched, false);
const missingResize = { ...nonempty, messages: clone(nonempty.messages) };
missingResize.messages.splice(2, 1);
const missingResizeEvidence = await collectSnapshotEvidence(missingResize);
assert.equal(missingResizeEvidence.replayComplete, false);
assert.equal(missingResizeEvidence.replayMatchesSaved, null);
for (const field of [...replayComparisonFields, 'replayBufferLineCount', 'replaySerializedBytes']) {
  assert.equal(missingResizeEvidence[field], null, field);
}
assert.equal(missingResizeEvidence.savedBufferLineCount, 4, 'Observed saved-state facts remain available when replay is unknown.');
assert.equal(missingResizeEvidence.hydratedSerializedBytes, nonemptyEvidence.hydratedSerializedBytes);
const unknownPage = { ...blank, assertBuffer: async () => { throw new Error('probe transport unavailable'); } };
assert.equal((await collectSnapshotEvidence(unknownPage)).savedMatchesPage, null);

for (const [reason, mutate] of [
  ['initial-checkpoint-missing', value => value.messages.shift()],
  ['output-range-missing', value => { value.messages[1].payload.outputStartSequence += 1; }],
  ['output-range-missing', value => { value.messages.splice(1, 1); }],
  ['reader-changed', value => { value.messages[1].lifecycle = { ...value.messages[1].lifecycle, frameId: 'changed' }; }],
  // Initial duplicates now have a production meaning; preserve the original rejection after output begins.
  ['projection-recovery-or-unknown-snapshot', value => { value.messages.splice(2, 0, clone(value.messages[0])); }],
  ['message-window-full', value => { while (value.messages.length < 200) value.messages.push({ type: 'host/stateUpdated' }); }],
  ['snapshot-invalid', value => { value.messages.at(-2).payload.serializedTerminalState.outputSequence += 1; }],
  ['exit-boundary-missing', value => { value.messages.pop(); }]
]) {
  const value = { ...blank, messages: clone(blank.messages) };
  mutate(value);
  const result = await collectSnapshotEvidence(value);
  assert.equal(result.replayComplete, false, reason);
  assert.equal(result.replayReason, reason);
  assert.equal(result.replayMatchesSaved, null);
}
const eligible = evidence => acceptsEmptySnapshotStop({ mode: 'snapshot-only', lifecycle: 'stop',
  savedNode: blank.savedNode, evidence });
const nonemptyEligible = evidence => acceptsSnapshotStop({ mode: 'snapshot-only', lifecycle: 'stop',
  savedNode: nonempty.savedNode, evidence });
assert.equal(eligible(blankEvidence), true, 'Complete output followed by a legal reset can produce an empty final snapshot.');
assert.equal(eligible(resizedEvidence), true, 'Only dimensions may differ before the independent resize comparison.');
assert.equal(nonemptyEligible(nonemptyEvidence), true, 'A valid nonempty snapshot stop is eligible for a second Host.');
assert.equal(nonemptyEligible({ ...nonemptyEvidence, pageGeometryMatched: false, pageVisibleMatched: false,
  savedMatchesPage: false, replayMatchesPage: false }), false,
  'A second Host cannot excuse failed original-page checks.');
assert.equal(nonemptyEligible(await collectSnapshotEvidence(wrongCursor)), false);
const nonemptyReflow = await fixture({ outputText: 'abcdefghij\r\nTAIL\r\n' });
Object.assign(nonemptyReflow.finalProbe.nodes[0], { terminalCols: 4, terminalRows: 6,
  terminalCursorX: 0, terminalCursorY: 4, terminalViewportY: 0,
  terminalVisibleLines: ['abcd', 'efgh', 'ij', 'TAIL', '', ''] });
nonemptyReflow.assertBuffer = async expected => JSON.stringify(expected) === JSON.stringify(['abcd', 'efgh', 'ij', 'TAIL']);
const nonemptyReflowEvidence = await collectSnapshotEvidence(nonemptyReflow);
const reflowEligible = evidence => acceptsSnapshotStop({ mode: 'snapshot-only', lifecycle: 'stop',
  savedNode: nonemptyReflow.savedNode, evidence });
assert.equal(nonemptyReflowEvidence.pageGeometryMatches.cursorY, false,
  'Independent reflow may change the cursor without copying the observed cursor.');
assert.equal(nonemptyReflowEvidence.savedMatchesPage, false);
assert.equal(nonemptyReflowEvidence.replayMatchesSaved, true);
assert.equal(nonemptyReflowEvidence.resizedSavedMatchesPage, true);
assert.equal(reflowEligible(nonemptyReflowEvidence), true);
for (const field of ['pageGeometryMatched', 'pageVisibleMatched', 'pageBufferMatched', 'savedMatchesPage', 'replayMatchesPage']) {
  assert.equal(nonemptyEligible({ ...nonemptyEvidence, [field]: false }), false, field);
}
for (const field of ['resizedSavedPageGeometryMatched', 'resizedSavedPageVisibleMatched',
  'resizedSavedPageBufferMatched', 'resizedSavedMatchesPage']) {
  for (const invalid of [false, null, undefined]) {
    assert.equal(reflowEligible({ ...nonemptyReflowEvidence, [field]: invalid }), false, field);
  }
}
for (const [name, mutate] of [
  ['cursor', value => { value.finalProbe.nodes[0].terminalCursorY = 2; }],
  ['viewport', value => { value.finalProbe.nodes[0].terminalViewportY = 1; }],
  ['visible content', value => { value.finalProbe.nodes[0].terminalVisibleLines[0] = 'incorrect'; }],
  ['unknown buffer', value => { value.assertBuffer = async () => { throw new Error('buffer unavailable'); }; }]
]) {
  const invalid = { ...nonemptyReflow, finalProbe: clone(nonemptyReflow.finalProbe) };
  mutate(invalid);
  assert.equal(reflowEligible(await collectSnapshotEvidence(invalid)), false, name);
}
for (const field of ['savedNodeMatched', 'savedStatePresent', 'savedStateValid', 'readerApplied', 'readerLifecycleMatched',
  'sequenceMatched', 'helpProbePresent', 'finalProbePresent', 'pageBufferMatched', 'replayComplete',
  'replayMatchesSaved', 'publishedFinalMatchesSaved']) {
  for (const invalid of [false, null, undefined, 'true']) {
    assert.equal(eligible({ ...blankEvidence, [field]: invalid }), false, `${field} must be observed true.`);
  }
}
for (const patch of [
  { replayInitialSequence: 1 }, { savedOutputSequence: 0 }, { snapshotOutputSequence: 0 },
  { readerFinalOutputSequence: 0 }, { replayOutputMessages: 0 }, { helpNonEmptyLines: 0 },
  { messageCount: 200 }, { replayReason: 'unknown' }, { savedDataBytes: 1 },
  { savedDataSha256: '0'.repeat(64) }, { replayStateSha256: '0'.repeat(64) },
  { hydratedStateSha256: null }, { pageGeometryMatches: { ...blankEvidence.pageGeometryMatches, cursorX: null } },
  { savedMatchesPage: false, resizedSavedMatchesPage: false }
]) assert.equal(eligible({ ...blankEvidence, ...patch }), false, JSON.stringify(patch));
for (const field of ['cursorX', 'cursorY', 'viewportY', 'bufferType']) {
  assert.equal(eligible({ ...resizedEvidence,
    pageGeometryMatches: { ...resizedEvidence.pageGeometryMatches, [field]: false } }), false, field);
}
for (const field of ['resizedSavedPageGeometryMatched', 'resizedSavedPageVisibleMatched',
  'resizedSavedPageBufferMatched', 'resizedSavedMatchesPage']) {
  assert.equal(eligible({ ...resizedEvidence, [field]: null }), false, field);
}
assert.equal(eligible(overwrittenEvidence), false, 'An empty saved state cannot erase unmatched replay output.');
for (const patch of [{ mode: 'live-runtime' }, { lifecycle: 'natural' }, { savedNode: nonempty.savedNode },
  { savedNode: { ...blank.savedNode, status: 'running' } }, { savedNode: undefined }]) {
  assert.equal(acceptsEmptySnapshotStop({ mode: 'snapshot-only', lifecycle: 'stop',
    savedNode: blank.savedNode, evidence: blankEvidence, ...patch }), false);
}
console.log('Agent snapshot evidence: strict replay, independent reflow, and original-page empty/nonempty stop checks passed.');
