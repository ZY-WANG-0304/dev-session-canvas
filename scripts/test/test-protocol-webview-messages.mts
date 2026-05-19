import assert from 'node:assert/strict';

import { parseWebviewMessage } from '../../src/common/protocol.ts';

const hardwrapLinkText = 'src/webview/executionTerminalNativeInteractions.ts:1600:12';
const hardwrapPath = 'src/webview/executionTerminalNativeInteractions.ts';

const hardwrapResolveMessage = {
  type: 'webview/resolveExecutionFileLinks',
  payload: {
    requestId: 'execution-file-links-test',
    nodeId: 'terminal-test',
    kind: 'terminal',
    candidates: [
      {
        candidateId: 'hardwrap-styled:1:2',
        text: hardwrapLinkText,
        path: hardwrapPath,
        startIndex: 0,
        endIndexExclusive: hardwrapLinkText.length,
        bufferStartLine: 12,
        line: 1600,
        column: 12,
        source: 'hardwrap'
      }
    ]
  }
};

assert.deepEqual(parseWebviewMessage(hardwrapResolveMessage), hardwrapResolveMessage);

const hardwrapOpenMessage = {
  type: 'webview/openExecutionLink',
  payload: {
    nodeId: 'terminal-test',
    kind: 'terminal',
    link: {
      linkKind: 'file',
      text: hardwrapLinkText,
      path: hardwrapPath,
      line: 1600,
      column: 12,
      bufferStartLine: 12,
      source: 'hardwrap',
      targetKind: 'file'
    }
  }
};

assert.deepEqual(parseWebviewMessage(hardwrapOpenMessage), hardwrapOpenMessage);

const unsupportedSourceMessage = JSON.parse(JSON.stringify(hardwrapResolveMessage));
unsupportedSourceMessage.payload.candidates[0].source = 'future-source';
assert.equal(parseWebviewMessage(unsupportedSourceMessage), null);

console.log('protocol webview message tests passed');
