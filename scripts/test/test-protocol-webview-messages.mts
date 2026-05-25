import assert from 'node:assert/strict';

import { isWebviewDomAction, parseWebviewMessage } from '../../src/common/protocol.ts';

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


assert.equal(
  isWebviewDomAction({
    kind: 'doubleClickNotePreviewText',
    nodeId: 'note-1',
    text: 'second line',
    offset: 5
  }),
  true,
  'test DOM action 应允许用真实坐标双击 Note 预览文本。'
);

assert.equal(
  isWebviewDomAction({
    kind: 'doubleClickNotePreviewSelector',
    nodeId: 'note-1',
    selector: 'img.note-markdown-image'
  }),
  true,
  'test DOM action 应允许用 selector 双击 Note 预览复杂块。'
);

assert.equal(
  isWebviewDomAction({
    kind: 'doubleClickNotePreviewText',
    nodeId: 'note-1',
    text: 'second line',
    offset: 0.5
  }),
  false,
  '文本双击 offset 必须是安全整数，避免测试协议传入非确定性坐标。'
);

console.log('protocol webview message tests passed');
