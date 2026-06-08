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

const branchAgentSessionMessage = {
  type: 'webview/branchAgentSession',
  payload: {
    nodeId: 'agent-branch-source'
  }
};

assert.deepEqual(parseWebviewMessage(branchAgentSessionMessage), branchAgentSessionMessage);
assert.equal(
  parseWebviewMessage({
    type: 'webview/branchAgentSession',
    payload: {
      nodeId: 42
    }
  }),
  null,
  'webview/branchAgentSession.nodeId 必须是字符串。'
);

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

const dropNoteMarkdownFilesInRootMessage = {
  type: 'webview/dropNoteMarkdownFiles',
  payload: {
    resources: [
      {
        source: 'files',
        valueKind: 'path',
        value: '/workspace/frontend/notes.md'
      }
    ],
    position: { x: 320, y: 360 },
    targetGroupId: 'workspace-root-frontend'
  }
};
assert.deepEqual(parseWebviewMessage(dropNoteMarkdownFilesInRootMessage), dropNoteMarkdownFilesInRootMessage);

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
assert.match(
  protocolSource,
  /type: 'host\/requestCreateNode'[\s\S]*targetGroupId\?: string/u,
  'Expected host/requestCreateNode to carry an optional target group for multi-root root selection.'
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
assert.match(
  panelManagerSource,
  /setPersistedStateForTest[\s\S]*const multiRootOverlay = this\.writeRootLocalCanvasSnapshotsForState\(this\.state\)[\s\S]*state: this\.state[\s\S]*multiRootOverlay[\s\S]*waitForPendingWorkspaceStateUpdates/u,
  'Expected seeded test state to update all persisted backends before later reloads choose root-local snapshots.'
);
assert.match(
  panelManagerSource,
  /const rootLocalSnapshotSummary = summarizeCanvasStateForDiagnostics\(rootLocalSnapshot\.state\)[\s\S]*const rootLocalLoadedStateSummary = summarizeCanvasStateForDiagnostics\((?:sanitizedRootState|runtimeSafeRootState)\)[\s\S]*source: 'rootLocalSnapshot'[\s\S]*snapshotWrittenAt: rootLocalSnapshot\.writtenAt[\s\S]*snapshotStateHash: rootLocalSnapshot\.stateHash \?\? rootLocalSnapshotSummary\.stateHash[\s\S]*loadedStateHash: rootLocalLoadedStateSummary\.stateHash[\s\S]*\.\.\.rootLocalSnapshotSummary/u,
  'Expected root-local snapshot loads to report the selected snapshot hash while keeping the loaded-state hash separately.'
);
assert.match(
  panelManagerSource,
  /currentLifecycle\.mode === lifecycle!\.mode[\s\S]*currentLifecycle\.generation === lifecycle!\.generation[\s\S]*areSurfaceLifecycleFrameIdsCompatible\(currentLifecycle\.frameId, lifecycle!\.frameId\)[\s\S]*this\.surfaceLifecycle\[sourceSurface\]/u,
  'Expected same-generation Webview ready messages with a new frameId to promote the active frame.'
);
assert.match(
  panelManagerSource,
  /matchesPendingWebviewRequestLifecycle[\s\S]*areSurfaceLifecycleFrameIdsCompatible\(pendingRequest\.lifecycle\.frameId, lifecycle\.frameId\)/u,
  'Expected pending Webview test requests to accept results from the promoted frameId-compatible lifecycle.'
);
assert.match(
  panelManagerSource,
  /PendingWebviewProbeRequest[\s\S]*webview\?: vscode\.Webview[\s\S]*matchesPendingWebviewRequestSource/u,
  'Expected pending Webview probe requests to bind the responding Webview instance.'
);
assert.match(
  panelManagerSource,
  /invalidateSurfaceLifecycle[\s\S]*rejectPendingWebviewProbeRequests[\s\S]*rejectPendingWebviewDomActionRequests[\s\S]*clearPendingBootstrapHostMessages/u,
  'Expected lifecycle invalidation to reject stale pending Webview requests and clear queued host messages.'
);
assert.match(
  panelManagerSource,
  /shouldQueueUntilBootstrapAck[\s\S]*isBootstrapAckGatedHostMessage[\s\S]*flushPendingBootstrapHostMessages/u,
  'Expected non-bootstrap host messages to wait until the active frame acknowledges bootstrap.'
);
assert.match(
  panelManagerSource,
  /runWebviewLifecycleRaceDiagnosticsForTest[\s\S]*beginSurfaceRender\(surface, 'active'\)[\s\S]*beginSurfaceRender\(surface, 'active'\)[\s\S]*webview\/ready[\s\S]*oldFrame\.webview/u,
  'Expected test diagnostics to simulate the panel double-render ready race against distinct Webview instances.'
);
assert.match(
  panelManagerSource,
  /runWebviewLifecycleRaceDiagnosticsForTest[\s\S]*gatedMessageQueuedBeforeAck[\s\S]*webview\/bootstrapAck[\s\S]*gatedMessageDeliveredAfterAck/u,
  'Expected test diagnostics to assert host-message queueing until bootstrap ack.'
);
assert.match(
  panelManagerSource,
  /runWebviewLifecycleRaceDiagnosticsForTest[\s\S]*staleProbeResultIgnored[\s\S]*pendingProbeResolvedFromCurrent[\s\S]*staleDomActionResultIgnored[\s\S]*pendingDomActionResolvedFromCurrent/u,
  'Expected test diagnostics to prove pending Webview requests ignore stale source instances but resolve from the bound frame.'
);
assert.match(
  panelManagerSource,
  /buildWebviewLifecycleDiagnosticsSummary[\s\S]*webview-lifecycle-summary\.json[\s\S]*webviewLifecyclePanelRestoreLikelyAffected/u,
  'Expected host diagnostics dump to write a focused Webview lifecycle summary and expose Panel restore health.'
);
assert.match(
  panelManagerSource,
  /summarizeWebviewLifecycleAttachRenderBurst[\s\S]*surface\/attached[\s\S]*surface\/rendered[\s\S]*250/u,
  'Expected lifecycle diagnostics to summarize consecutive attach/render bursts for real Panel restore dumps.'
);
assert.match(
  panelManagerSource,
  /classifyWebviewLifecycleSurfaceStatus[\s\S]*!args\.ready[\s\S]*!args\.bootstrapAck[\s\S]*args\.probeError/u,
  'Expected lifecycle diagnostics to flag missing ready, missing bootstrap ack, and failed probes.'
);
assert.match(
  await readFile('scripts/diagnostics/analyze-webview-lifecycle-dump.mjs', 'utf8'),
  /EXIT_CODE_FINDING[\s\S]*loadWebviewLifecycleSummary[\s\S]*webview-lifecycle-summary\.json[\s\S]*summary\.json[\s\S]*webviewLifecycle/u,
  'Expected the offline Webview lifecycle diagnostics CLI to read dump summaries and return a distinct finding exit code.'
);
assert.match(
  await readFile('scripts/test/test-webview-lifecycle-diagnostics.mjs', 'utf8'),
  /createLifecycleSummary[\s\S]*Panel restore 风险[\s\S]*summary\.json\.webviewLifecycle[\s\S]*defaultAnalysis/u,
  'Expected offline Webview lifecycle diagnostics tests to cover blocked, fallback, and latest-dump analysis.'
);
assert.match(
  panelManagerSource,
  /const editorWebview = panel\.webview;[\s\S]*panel\.onDidDispose\([\s\S]*surfaceMessageWebview\.editor === editorWebview[\s\S]*renderedWebviewLifecycle\.delete\(editorWebview\)/u,
  'Expected editor dispose cleanup to use the captured Webview instead of reading panel.webview after disposal.'
);
assert.doesNotMatch(
  panelManagerSource,
  /panel\.onDidDispose\([\s\S]*panel\.webview[\s\S]*panel\.onDidChangeViewState/u,
  'Editor dispose cleanup must not read panel.webview because VS Code throws after the panel is disposed.'
);
assert.match(
  panelManagerSource,
  /const panelWebview = webviewView\.webview;[\s\S]*webviewView\.onDidDispose\([\s\S]*surfaceMessageWebview\.panel === panelWebview[\s\S]*renderedWebviewLifecycle\.delete\(panelWebview\)/u,
  'Expected panel view dispose cleanup to use the captured Webview instead of reading webviewView.webview after disposal.'
);
assert.doesNotMatch(
  panelManagerSource,
  /webviewView\.onDidDispose\([\s\S]*webviewView\.webview[\s\S]*webviewView\.onDidChangeVisibility/u,
  'Panel view dispose cleanup must not read webviewView.webview because VS Code throws after the view is disposed.'
);

const webviewSource = await readFile('src/webview/main.tsx', 'utf8');
assert.match(
  webviewSource,
  /requiresHostMessageLifecycle\(message\.type\) && !messageLifecycle[\s\S]*ignore host message without lifecycle/u,
  'Expected the Webview to reject lifecycle-bound host messages that omit lifecycle identity.'
);
assert.match(
  webviewSource,
  /messageLifecycle && !isCurrentWebviewLifecycleIdentity\(messageLifecycle\)[\s\S]*ignore host message with mismatched lifecycle/u,
  'Expected the Webview to reject host messages for stale lifecycle identities.'
);

const extensionIdentitySource = await readFile('src/common/extensionIdentity.ts', 'utf8');
assert.match(
  extensionIdentitySource,
  /runWebviewLifecycleRaceDiagnostics: 'devSessionCanvas\.__test\.runWebviewLifecycleRaceDiagnostics'/u,
  'Expected the host lifecycle race diagnostic command id to be registered for smoke coverage.'
);

const extensionSource = await readFile('src/extension.ts', 'utf8');
assert.match(
  extensionSource,
  /TEST_COMMAND_IDS\.runWebviewLifecycleRaceDiagnostics[\s\S]*runWebviewLifecycleRaceDiagnosticsForTest/u,
  'Expected the host lifecycle race diagnostics to be exposed through a test-only command.'
);
assert.match(
  extensionSource,
  /COMMAND_IDS\.dumpHostDiagnostics[\s\S]*webviewLifecycleStatus[\s\S]*webviewLifecycleSummaryPath/u,
  'Expected the user-facing host diagnostics command to surface the Webview lifecycle summary path and status.'
);

const smokeSource = await readFile('tests/vscode-smoke/extension-tests.cjs', 'utf8');
assert.match(
  smokeSource,
  /verifyWebviewLifecycleRaceDiagnostics[\s\S]*testRunWebviewLifecycleRaceDiagnostics[\s\S]*readyWebviewPromoted/u,
  'Expected VS Code smoke tests to execute the host lifecycle race diagnostic command.'
);
assert.match(
  smokeSource,
  /dumpHostDiagnostics: 'devSessionCanvas\.dumpHostDiagnostics'/u,
  'Expected VS Code smoke command registration coverage to include the user-facing host diagnostics command.'
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
