import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

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


const createDemoNodeInGroupMessage = {
  type: 'webview/createDemoNode',
  payload: {
    requestId: 'create-in-group',
    kind: 'note',
    preferredPosition: { x: 180, y: 220 },
    targetGroupId: 'group-parent',
    agentProvider: undefined,
    agentLaunchPreset: undefined,
    agentCustomLaunchCommand: undefined,
    titleOverride: undefined,
    cwd: '/workspace/packages/api',
    cwdSelectionSource: undefined
  }
};
assert.deepEqual(parseWebviewMessage(createDemoNodeInGroupMessage), createDemoNodeInGroupMessage);

const createDemoNodeWithInvalidCwdMessage = {
  type: 'webview/createDemoNode',
  payload: {
    kind: 'terminal',
    cwd: 42
  }
};
assert.equal(parseWebviewMessage(createDemoNodeWithInvalidCwdMessage), null);

const createEmptyGroupMessage = {
  type: 'webview/createEmptyGroup',
  payload: {
    position: { x: 120, y: 160 },
    size: { width: 360, height: 240 },
    parentGroupId: 'group-parent'
  }
};
assert.deepEqual(parseWebviewMessage(createEmptyGroupMessage), createEmptyGroupMessage);

const createGroupFromSelectionMessage = {
  type: 'webview/createGroupFromSelection',
  payload: {
    nodeIds: ['note-1', 'agent-1'],
    groupIds: ['group-2'],
    parentGroupId: 'group-parent'
  }
};
assert.deepEqual(parseWebviewMessage(createGroupFromSelectionMessage), createGroupFromSelectionMessage);

const protocolSource = await readFile('src/common/protocol.ts', 'utf8');
assert.match(
  protocolSource,
  /type: 'host\/requestCreateGroupFromSelection'/u,
  'Expected the host-to-webview protocol to expose command-palette group creation from the current selection.'
);

const applyTemplateInGroupMessage = {
  type: 'webview/applyTemplate',
  payload: {
    templateId: 'template-1',
    visibleCenter: { x: 240, y: 260 },
    targetGroupId: 'group-parent'
  }
};
assert.deepEqual(parseWebviewMessage(applyTemplateInGroupMessage), applyTemplateInGroupMessage);

const moveGroupMessage = {
  type: 'webview/moveGroup',
  payload: {
    groupId: 'group-1',
    position: { x: 220, y: 260 },
    pointerPosition: { x: 240, y: 280 }
  }
};
assert.deepEqual(parseWebviewMessage(moveGroupMessage), moveGroupMessage);

const resizeGroupMessage = {
  type: 'webview/resizeGroup',
  payload: {
    groupId: 'group-1',
    position: { x: 220, y: 260 },
    size: { width: 480, height: 320 }
  }
};
assert.deepEqual(parseWebviewMessage(resizeGroupMessage), resizeGroupMessage);

assert.deepEqual(parseWebviewMessage({ type: 'webview/deleteGroup', payload: { groupId: 'group-1' } }), {
  type: 'webview/deleteGroup',
  payload: { groupId: 'group-1' }
});
assert.equal(parseWebviewMessage({ type: 'webview/resizeGroup', payload: { groupId: 'group-1', position: { x: 1, y: 2 }, size: { width: -1, height: 20 } } }), null);

const moveNodeMessage = {
  type: 'webview/moveNode',
  payload: {
    id: 'note-1',
    position: { x: 50, y: 60 },
    pointerPosition: { x: 70, y: 80 },
    selectedMoves: [
      { id: 'note-2', position: { x: 180, y: 60 }, pointerPosition: { x: 200, y: 80 } },
      { id: 'bad-move', position: { x: 0, y: 0 }, pointerPosition: { x: Number.NaN, y: 0 } }
    ]
  }
};
assert.deepEqual(parseWebviewMessage(moveNodeMessage), {
  type: 'webview/moveNode',
  payload: {
    id: 'note-1',
    position: { x: 50, y: 60 },
    pointerPosition: { x: 70, y: 80 },
    selectedMoves: [
      { id: 'note-2', position: { x: 180, y: 60 }, pointerPosition: { x: 200, y: 80 } },
      { id: 'bad-move', position: { x: 0, y: 0 }, pointerPosition: undefined }
    ]
  }
});

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
