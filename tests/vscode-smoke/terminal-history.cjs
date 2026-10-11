const assert = require('node:assert/strict');
const { isDeepStrictEqual } = require('node:util');
const { Terminal } = require('@xterm/headless');
const { restoreTerminalCurrentState } = require('../../extensions/vscode/dev-session-canvas/src/common/terminalCurrentState.ts');
const { normalizeTerminalStreamRead, normalizeTerminalStreamPage } = require('../../extensions/vscode/dev-session-canvas/src/common/terminalStreamPaging.ts');

// Staging bundles the production codec and xterm into this test-only module.
function collectTerminalHistory(snapshot, messages, expected) {
  assert.equal(snapshot.type, 'host/executionSnapshot');
  for (const key of ['nodeId', 'kind', 'executionSessionId']) {
    assert.equal(snapshot.payload[key], expected[key], `Snapshot ${key} mismatch`);
  }
  assert.deepEqual(snapshot.lifecycle, expected.lifecycle);
  const read = normalizeTerminalStreamRead(snapshot.payload.terminalRead);
  assert.ok(read?.currentState, 'Expected a paged current-state descriptor');
  assert.equal(read.sessionId, expected.executionSessionId);
  assert.equal(snapshot.payload.outputSequence, read.checkpoint.revision);
  const chunks = [];
  const events = [];
  const requests = new Map();
  let offset = 0;
  let revision = read.checkpoint.revision;
  let headRevision = read.headRevision;
  let confirmed = false;
  for (const message of messages) {
    const payload = message.payload;
    if (message.type !== 'host/executionTerminalPage' ||
        !isDeepStrictEqual(message.lifecycle, expected.lifecycle) ||
        payload.kind !== expected.kind || payload.nodeId !== expected.nodeId ||
        payload.executionSessionId !== read.sessionId || payload.authorityId !== read.authorityId ||
        payload.readId !== read.readId) continue;
    assert.equal(payload.error, undefined, 'Terminal reader returned an error');
    assert.notEqual(payload.readClosed, true, 'Terminal reader closed before history verification');
    assert.equal(typeof payload.requestId, 'string');
    assert.ok(payload.requestId.length > 0);
    if (requests.has(payload.requestId)) {
      assert.deepEqual(payload, requests.get(payload.requestId), 'Conflicting duplicate page');
      continue;
    }
    requests.set(payload.requestId, payload);
    const page = normalizeTerminalStreamPage(payload.page);
    assert.ok(page, 'Invalid terminal history page');
    for (const key of ['sessionId', 'authorityId', 'readId']) {
      assert.equal(page[key], read[key], `Page ${key} mismatch`);
    }
    assert.equal(page.afterRevision, revision, 'Non-contiguous terminal history revision');
    headRevision = Math.max(headRevision, page.headRevision);
    if (page.stateChunk) {
      assert.equal(confirmed, false, 'Current-state chunk after journal suffix');
      assert.equal(page.revision, read.checkpoint.revision);
      assert.equal(page.stateChunk.offset, offset, 'Non-contiguous current-state chunk');
      offset += page.stateChunk.data.length;
      assert.ok(offset <= read.currentState.length, 'Current-state chunk exceeds descriptor length');
      chunks.push(page.stateChunk.data);
    } else {
      assert.equal(offset, read.currentState.length, 'Journal suffix before complete current state');
      confirmed = true;
      events.push(...page.events);
      revision = page.revision;
    }
  }
  if (offset < read.currentState.length || !confirmed || revision < headRevision) return undefined;
  const state = JSON.parse(chunks.join(''));
  for (const key of ['cols', 'rows', 'scrollback']) {
    assert.equal(state[key], read.checkpoint[key], `Current-state ${key} mismatch`);
  }
  return { state, events, revision, checkpointRevision: read.checkpoint.revision,
    headRevision, readId: read.readId, chunkCount: chunks.length, stateLength: offset };
}

async function restoreTerminalHistory(history) {
  const { state } = history;
  const terminal = new Terminal({ cols: state.cols, rows: state.rows,
    scrollback: state.scrollback, allowProposedApi: true });
  try {
    restoreTerminalCurrentState(terminal, state);
    for (const event of history.events) {
      if (event.type === 'output') await new Promise(resolve => terminal.write(event.data, resolve));
      else if (event.type === 'resize') terminal.resize(event.cols, event.rows);
      else if (event.type === 'scrollback') terminal.options.scrollback = event.scrollback;
      else assert.fail(`Unsupported terminal history event: ${event.type}`);
    }
    const lines = [];
    for (let index = 0; index < terminal.buffer.active.length; index += 1) {
      lines.push(terminal.buffer.active.getLine(index).translateToString(true));
    }
    return { lines, scrollback: terminal.options.scrollback, cols: terminal.cols, rows: terminal.rows };
  } finally {
    terminal.dispose();
  }
}

module.exports = { collectTerminalHistory, restoreTerminalHistory };
