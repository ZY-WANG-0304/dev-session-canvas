import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  extractWebviewMessageLifecycle,
  isWebviewDomAction,
  parseWebviewMessage
} from '../../src/common/protocol.ts';

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

const lifecycleMessage = {
  type: 'webview/bootstrapAck',
  lifecycle: {
    surface: 'panel',
    mode: 'active',
    generation: 42,
    frameId: 'frame-panel-42'
  }
};
assert.deepEqual(parseWebviewMessage(lifecycleMessage), {
  type: 'webview/bootstrapAck'
});
assert.deepEqual(extractWebviewMessageLifecycle(lifecycleMessage), lifecycleMessage.lifecycle);
assert.equal(extractWebviewMessageLifecycle({ type: 'webview/ready' }), undefined);
assert.equal(
  extractWebviewMessageLifecycle({
    type: 'webview/ready',
    lifecycle: {
      surface: 'sidebar',
      mode: 'active',
      generation: 1,
      frameId: 'frame-valid-shape'
    }
  }),
  undefined,
  'lifecycle.surface 必须限定为 editor 或 panel。'
);
assert.equal(
  extractWebviewMessageLifecycle({
    type: 'webview/ready',
    lifecycle: {
      surface: 'panel',
      mode: 'active',
      generation: Number.NaN,
      frameId: 'frame-valid-shape'
    }
  }),
  undefined,
  'lifecycle.generation 必须是安全的非负整数。'
);
assert.equal(
  extractWebviewMessageLifecycle({
    type: 'webview/ready',
    lifecycle: {
      surface: 'panel',
      mode: 'active',
      generation: 1,
      frameId: 'frame with spaces'
    }
  }),
  undefined,
  'lifecycle.frameId 必须使用稳定可记录的短字符串。'
);

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
    kind: 'agent',
    preferredPosition: { x: 180, y: 220 },
    cwd: '/workspace/src',
    targetGroupId: 'group-parent',
    agentProvider: 'codex',
    agentLaunchPreset: 'default',
    agentCustomLaunchCommand: undefined
  }
};
assert.deepEqual(parseWebviewMessage(createDemoNodeInGroupMessage), createDemoNodeInGroupMessage);
assert.equal(
  parseWebviewMessage({
    type: 'webview/createDemoNode',
    payload: {
      requestId: 'invalid-cwd',
      kind: 'terminal',
      cwd: 42
    }
  }),
  null,
  'webview/createDemoNode.cwd 必须是字符串。'
);

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
assert.match(
  protocolSource,
  /type: 'host\/requestCreateNode'[\s\S]*cwd\?: string/u,
  'Expected host/requestCreateNode to carry an optional cwd for Explorer-created execution nodes.'
);
assert.match(
  protocolSource,
  /export interface WebviewLifecycleIdentity/u,
  'Expected shared protocol to expose Webview lifecycle identity.'
);
assert.match(
  protocolSource,
  /export function extractWebviewMessageLifecycle/u,
  'Expected shared protocol parser to safely extract optional lifecycle identity.'
);

const panelManagerSource = await readFile('src/panel/CanvasPanelManager.ts', 'utf8');
assert.match(
  panelManagerSource,
  /isCurrentWebviewMessage\(sourceSurface, sourceWebview, lifecycle, parsedMessage\.type/u,
  'Expected host Webview message handling to validate lifecycle before active mutations.'
);
assert.match(
  panelManagerSource,
  /webview\/staleMessageIgnored/u,
  'Expected host Webview message handling to record stale lifecycle messages.'
);
assert.match(
  panelManagerSource,
  /private readonly surfaceMessageWebview/u,
  'Expected host to track the Webview frame that should receive lifecycle-bound messages.'
);
assert.match(
  panelManagerSource,
  /promoteReadyWebviewMessageIfNeeded\(sourceSurface, sourceWebview, lifecycle\);[\s\S]*isCurrentWebviewMessage\(sourceSurface, sourceWebview, lifecycle, parsedMessage\.type/u,
  'Expected host to allow a rendered ready frame to become the current message target before stale checks.'
);
assert.match(
  panelManagerSource,
  /parsedMessage\.type === 'webview\/bootstrapAck'/u,
  'Expected host to track bootstrap acknowledgements from the active Webview frame.'
);
assert.match(
  panelManagerSource,
  /this\.postState\('host\/bootstrap', \{/u,
  'Expected host bootstrap messages to be bound to the ready frame lifecycle.'
);
assert.match(
  panelManagerSource,
  /withSurfaceLifecycle/u,
  'Expected host-to-webview messages to carry the current surface lifecycle.'
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
