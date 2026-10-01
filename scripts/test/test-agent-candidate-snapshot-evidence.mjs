import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { Terminal } = require('@xterm/headless');
const { SerializeAddon } = require('@xterm/addon-serialize');
const { collectSnapshotEvidence } = require('../../tests/vscode-smoke/agent-candidate-snapshot-evidence.cjs');
const clone = value => structuredClone(value);
const write = (terminal, text) => new Promise(resolve => terminal.write(text, resolve));
const frame = { surface: 'panel', mode: 'active', generation: 1, frameId: 'f1' };

async function fixture({ blank = false, resize = false } = {}) {
  const terminal = new Terminal({ cols: 40, rows: 5, scrollback: 10000, allowProposedApi: true });
  const addon = new SerializeAddon();
  terminal.loadAddon(addon);
  let sequence = 0;
  const state = () => ({ format: 'xterm-serialize-v1', data: addon.serialize({ scrollback: 10000,
    excludeAltBuffer: false, excludeModes: false }), viewportY: terminal.buffer.active.viewportY, outputSequence: sequence });
  const snapshot = liveSession => ({ type: 'host/executionSnapshot', lifecycle: frame,
    payload: { nodeId: 'n1', executionSessionId: 'e1', cols: terminal.cols, rows: terminal.rows,
      liveSession, outputSequence: sequence, serializedTerminalState: state() } });
  const messages = [snapshot(true)];
  const output = async text => {
    const start = sequence + 1;
    await write(terminal, text);
    sequence += 1;
    messages.push({ type: 'host/executionOutput', lifecycle: frame,
      payload: { nodeId: 'n1', executionSessionId: 'e1', outputStartSequence: start, outputSequence: sequence, chunk: text } });
  };
  try {
    await output('VISIBLE BEFORE RESET');
    if (resize) {
      terminal.resize(32, 4);
      sequence += 1;
      messages.push(snapshot(true));
    }
    if (blank) await output('\x1bc');
    const savedNode = { id: 'n1', metadata: { agent: { lastCols: terminal.cols, lastRows: terminal.rows,
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

const nonempty = await fixture({ resize: true });
const nonemptyEvidence = await collectSnapshotEvidence(nonempty);
assert(nonemptyEvidence.savedDataBytes > 0);
assert.equal(nonemptyEvidence.replayResizeSnapshots, 1);
assert.equal(nonemptyEvidence.replayMatchesSaved, true);
assert.equal(nonemptyEvidence.savedMatchesPage, true);

const tampered = { ...nonempty, savedNode: clone(nonempty.savedNode) };
tampered.savedNode.metadata.agent.serializedTerminalState.data = '';
const tamperedEvidence = await collectSnapshotEvidence(tampered);
assert.equal(tamperedEvidence.replayComplete, true);
assert.equal(tamperedEvidence.replayMatchesSaved, false);
assert.equal(tamperedEvidence.savedMatchesPage, false);
assert.equal(tamperedEvidence.replayMatchesPage, true);
assert.equal(tamperedEvidence.publishedFinalMatchesSaved, false);

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
const unknownPage = { ...blank, assertBuffer: async () => { throw new Error('probe transport unavailable'); } };
assert.equal((await collectSnapshotEvidence(unknownPage)).savedMatchesPage, null);

for (const [reason, mutate] of [
  ['initial-checkpoint-missing', value => value.messages.shift()],
  ['output-range-missing', value => { value.messages[1].payload.outputStartSequence += 1; }],
  ['output-range-missing', value => { value.messages.splice(1, 1); }],
  ['reader-changed', value => { value.messages[1].lifecycle = { ...value.messages[1].lifecycle, frameId: 'changed' }; }],
  ['projection-recovery-or-unknown-snapshot', value => { value.messages.splice(1, 0, clone(value.messages[0])); }],
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
console.log('Agent snapshot evidence: legal blank, nonempty resize, tampering, cursor, sequence, and missing evidence passed.');
