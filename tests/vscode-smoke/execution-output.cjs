const assert = require('node:assert/strict');

function findExecutionOutput(messages, execution, expectedText) {
  assert.ok(execution.kind && execution.nodeId && execution.executionSessionId,
    'Output assertions require an explicit execution identity.');
  assert.ok(typeof expectedText === 'string' && expectedText.length > 0);
  let output = '';
  let through;
  for (const message of messages) {
    const payload = message.payload;
    if (payload?.kind !== execution.kind || payload.nodeId !== execution.nodeId ||
        payload.executionSessionId !== execution.executionSessionId) continue;
    if (message.type === 'host/executionSnapshot') {
      // A restored screen is a separate observation, never the next chunk of a stream.
      for (const text of [payload.serializedTerminalState?.data, payload.output]) {
        if (typeof text === 'string' && text.includes(expectedText)) return text;
      }
      output = '';
      through = undefined;
    } else if (message.type === 'host/executionOutput' && typeof payload.chunk === 'string') {
      const start = payload.outputStartSequence;
      const end = payload.outputSequence;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start) {
        output = '';
        through = undefined;
        continue;
      }
      output = through !== undefined && start === through + 1 ? output + payload.chunk : payload.chunk;
      through = end;
      if (output.includes(expectedText)) return output;
    }
  }
  return undefined;
}

module.exports = { findExecutionOutput };
