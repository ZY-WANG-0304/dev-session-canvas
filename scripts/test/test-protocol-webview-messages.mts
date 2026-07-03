import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  EXECUTION_PERFORMANCE_DIAGNOSTICS_SCHEMA_VERSION,
  extractWebviewMessageLifecycle,
  isWebviewDomAction,
  normalizeCanvasMultiRootPresentationMode,
  parseWebviewMessage
} from '../../extensions/vscode/dev-session-canvas/src/common/protocol.ts';

assert.equal(
  EXECUTION_PERFORMANCE_DIAGNOSTICS_SCHEMA_VERSION,
  10,
  'Execution performance diagnostics schema should mark host output scheduling, input ack post timing, bounded Webview snapshot reset and snapshot restore queue diagnostics.'
);

assert.equal(normalizeCanvasMultiRootPresentationMode('rootGroups'), 'rootGroups');
assert.equal(normalizeCanvasMultiRootPresentationMode('paneGallery'), 'paneGallery');
assert.equal(
  normalizeCanvasMultiRootPresentationMode('unknownMode'),
  'rootGroups',
  'Unknown multi-root presentation modes should fall back to the existing root groups view.'
);

const hardwrapLinkText = 'src/webview/executionTerminalNativeInteractions.ts:1600:12';
const hardwrapPath = 'src/webview/executionTerminalNativeInteractions.ts';

const hardwrapResolveMessage = {
  type: 'webview/resolveExecutionFileLinks',
  payload: {
    requestId: 'execution-file-links-test',
    nodeId: 'terminal-test',
    kind: 'terminal',
    priority: 'background',
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

const invalidPriorityResolveMessage = JSON.parse(JSON.stringify(hardwrapResolveMessage));
invalidPriorityResolveMessage.payload.priority = 'eager';
assert.equal(parseWebviewMessage(invalidPriorityResolveMessage), null);

const styledResolveMessage = JSON.parse(JSON.stringify(hardwrapResolveMessage));
styledResolveMessage.payload.candidates[0].candidateId = 'styled:1:2:1:8:foo.ts';
styledResolveMessage.payload.candidates[0].text = 'foo.ts';
styledResolveMessage.payload.candidates[0].path = 'foo.ts';
styledResolveMessage.payload.candidates[0].endIndexExclusive = 'foo.ts'.length;
styledResolveMessage.payload.candidates[0].source = 'styled';
assert.deepEqual(parseWebviewMessage(styledResolveMessage), styledResolveMessage);

assert.deepEqual(
  parseWebviewMessage({
    type: 'webview/executionInput',
    payload: {
      nodeId: 'agent-1',
      kind: 'agent',
      data: 'hello\r',
      sequence: 7,
      webviewEpochMs: 1781111111111,
      webviewPerformanceNowMs: 123.45
    }
  }),
  {
    type: 'webview/executionInput',
    payload: {
      nodeId: 'agent-1',
      kind: 'agent',
      data: 'hello\r',
      sequence: 7,
      webviewEpochMs: 1781111111111,
      webviewPerformanceNowMs: 123.45
    }
  },
  'execution input diagnostic metadata 应随输入消息保留。'
);
assert.equal(
  parseWebviewMessage({
    type: 'webview/executionInput',
    payload: {
      nodeId: 'agent-1',
      kind: 'agent',
      data: 'hello\r',
      sequence: 1.5
    }
  })?.payload.sequence,
  undefined,
  'execution input sequence 必须是非负整数。'
);
assert.deepEqual(
  parseWebviewMessage({
    type: 'webview/attachExecutionSession',
    payload: {
      nodeId: 'agent-1',
      kind: 'agent',
      requestId: 'snapshot-reset-1',
      executionSessionId: 'agent-session-1',
      minOutputSequence: 42
    }
  }),
  {
    type: 'webview/attachExecutionSession',
    payload: {
      nodeId: 'agent-1',
      kind: 'agent',
      requestId: 'snapshot-reset-1',
      executionSessionId: 'agent-session-1',
      minOutputSequence: 42
    }
  },
  'execution snapshot reset 复用 attachExecutionSession 请求刷新 Host 侧权威快照，并保留 requestId、session 与最小 outputSequence 供 Host 对齐。'
);

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
assert.deepEqual(
  parseWebviewMessage({
    type: 'webview/arrangeCanvasLayout'
  }),
  {
    type: 'webview/arrangeCanvasLayout'
  },
  '未指定范围时画布布局整理消息按当前权威状态整理整个画布并持久化。'
);
assert.deepEqual(
  parseWebviewMessage({
    type: 'webview/arrangeCanvasLayout',
    payload: {
      targetGroupId: 'workspace-root-frontend'
    }
  }),
  {
    type: 'webview/arrangeCanvasLayout',
    payload: {
      targetGroupId: 'workspace-root-frontend'
    }
  },
  '画布布局整理消息可携带 targetGroupId，由 Host 限定到目标 workspace root。'
);
assert.equal(
  parseWebviewMessage({
    type: 'webview/arrangeCanvasLayout',
    payload: {
      targetGroupId: 42
    }
  }),
  null,
  'webview/arrangeCanvasLayout.targetGroupId 必须是字符串。'
);
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

const styledOpenMessage = JSON.parse(JSON.stringify(hardwrapOpenMessage));
styledOpenMessage.payload.link.text = 'foo.ts';
styledOpenMessage.payload.link.path = 'foo.ts';
styledOpenMessage.payload.link.source = 'styled';
assert.deepEqual(parseWebviewMessage(styledOpenMessage), styledOpenMessage);

const imagePasteMessage = {
  type: 'webview/pasteExecutionImage',
  payload: {
    requestId: 'execution-image-paste-test',
    nodeId: 'agent-test',
    kind: 'agent',
    mimeType: 'image/jpeg',
    dataBase64: '/9j/',
    sizeBytes: 3,
    name: 'clipboard.jpg'
  }
};

assert.deepEqual(parseWebviewMessage(imagePasteMessage), imagePasteMessage);

const invalidImagePasteMessage = JSON.parse(JSON.stringify(imagePasteMessage));
invalidImagePasteMessage.payload.dataBase64 = 'not base64!';
assert.equal(
  parseWebviewMessage(invalidImagePasteMessage),
  null,
  '图片粘贴 payload 必须是有界 base64。'
);

const branchAgentSessionMessage = {
  type: 'webview/branchAgentSession',
  payload: {
    nodeId: 'agent-branch-source'
  }
};

assert.deepEqual(parseWebviewMessage(branchAgentSessionMessage), branchAgentSessionMessage);
assert.equal(
  parseWebviewMessage({
    type: 'webview/reactivateSuspendedExecutionSession',
    payload: {
      nodeId: 'agent-suspended',
      kind: 'agent'
    }
  }),
  null,
  'webview/reactivateSuspendedExecutionSession 已移除，旧恢复挂起消息必须被拒绝。'
);
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

const protocolSource = await readFile('extensions/vscode/dev-session-canvas/src/common/protocol.ts', 'utf8');
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
assert.match(
  protocolSource,
  /type: 'host\/focusGroup'[\s\S]*groupId: string/u,
  'Expected host/focusGroup to carry a workspace root group target for Add Folder viewport focus.'
);

const panelManagerSource = await readFile('extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts', 'utf8');
const webviewSource = await readFile('extensions/vscode/dev-session-canvas/src/webview/main.tsx', 'utf8');
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
  /CANVAS_STATE_DEFERRED_PERSIST_DEBOUNCE_MS[\s\S]*scheduleDeferredCanvasStatePersist[\s\S]*state\/persistDeferred[\s\S]*flushDeferredCanvasStatePersist/u,
  'Expected live execution state persistence to be debounced and coalesced instead of writing every output tick.'
);
assert.match(
  panelManagerSource,
  /const EXECUTION_OUTPUT_STATE_SYNC_INTERVAL_MS = 2500/u,
  'Expected live output state sync to avoid posting React state for every short output burst.'
);
assert.match(
  panelManagerSource,
  /flushLiveExecutionState\([\s\S]*persistMode\?: CanvasStatePersistMode[\s\S]*mode: options\.persistMode \?\? 'deferred'/u,
  'Expected live execution state flushes to default to deferred persistence.'
);
assert.match(
  panelManagerSource,
  /queueExecutionStateSync\([\s\S]*options: \{ postState\?: boolean \} = \{\}[\s\S]*postState: options\.postState === true/u,
  'Expected routine live execution state syncs to persist without forcing Webview state renders.'
);
assert.match(
  panelManagerSource,
  /options\.postState !== false[\s\S]*options\.postState === true \|\| options\.persistMode === 'immediate'/u,
  'Expected Webview state updates during active execution to be reserved for explicit or lifecycle-boundary changes.'
);
assert.match(
  panelManagerSource,
  /getCanvasStatePersistBarrierBeforeExecutionOutput[\s\S]*first-output-post[\s\S]*const persisted = persistBarrier === undefined/u,
  'Expected first output after deferred state changes to be gated until the state snapshot is safely flushed.'
);
assert.match(
  panelManagerSource,
  /source: 'host-input-received'[\s\S]*type: 'host\/executionInputAck'[\s\S]*hostAckPostEpochMs/u,
  'Expected Host to ack execution input before the asynchronous input write path and include ack post timing.'
);
assert.match(
  panelManagerSource,
  /source: 'host-event-loop-lag'[\s\S]*reason: 'timer-lag'/u,
  'Expected Host event-loop lag to be sampled alongside Webview main-thread lag.'
);
assert.match(
  webviewSource,
  /case 'host\/executionInputAck':[\s\S]*handleExecutionInputAck/u,
  'Expected Webview to measure input ack round-trip latency without local echoing input.'
);
assert.match(
  panelManagerSource,
  /executionPerformance: EXECUTION_PERFORMANCE_DIAGNOSTICS_SCHEMA_VERSION/u,
  'Expected host diagnostics schema to mark the input ack and host event-loop lag generation.'
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
  /canPromoteReadyWebviewMessage[\s\S]*!this\.surfaceReady\[sourceSurface\] && !currentLifecycle\.ready[\s\S]*this\.getSurfaceMessageWebview\(sourceSurface\) === sourceWebview[\s\S]*!areSurfaceLifecycleFrameIdsCompatible\(currentLifecycle\.frameId, lifecycle\.frameId\)/u,
  'Expected ready promotion to reject competing ready after ready while allowing same-Webview frame refresh.'
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
  /runWebviewLifecycleRaceDiagnosticsForTest[\s\S]*secondReadyPromotionIgnored[\s\S]*secondReadyBootstrapSuppressed[\s\S]*messageTargetStayedOnPromotedWebview/u,
  'Expected test diagnostics to prove a competing ready after bootstrap ack cannot promote or steal the message target.'
);
assert.match(
  panelManagerSource,
  /runWebviewLifecycleRaceDiagnosticsForTest[\s\S]*sameWebviewFrameReadyPromoted[\s\S]*sameWebviewFrameBootstrapDelivered[\s\S]*sameWebviewFrameLifecycleRebound/u,
  'Expected test diagnostics to prove a same-Webview refreshed frame can rebind lifecycle and receive bootstrap.'
);
assert.match(
  panelManagerSource,
  /postWorkspaceRootFocusGroupMessage[\s\S]*pendingWorkspaceRootFocusReplay[\s\S]*WORKSPACE_ROOT_FOCUS_REPLAY_WINDOW_MS[\s\S]*postWorkspaceRootFocusGroupMessageForCurrentLifecycle/u,
  'Expected Add Folder workspace-root focus to replay across same-generation frame refreshes.'
);
assert.match(
  panelManagerSource,
  /runWebviewLifecycleRaceDiagnosticsForTest[\s\S]*focusMessageRetriedAfterFrameRefresh[\s\S]*focusMessageReachedRefreshedFrame/u,
  'Expected lifecycle diagnostics to cover retried workspace-root focus after a frame refresh.'
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
assert.match(
  webviewSource,
  /persisted: message\.payload\.persisted[\s\S]*let pendingPersistBarrier = false[\s\S]*outputOptions\?\.persisted === false[\s\S]*pendingPersistBarrier = true[\s\S]*outputOptions\?\.persisted === true[\s\S]*pendingPersistBarrier = false[\s\S]*disposed \|\| pendingPersistBarrier \|\| pendingOutput\.length === 0/u,
  'Expected the Webview to buffer first unpersisted output until the Host confirms the latest execution state was persisted.'
);
assert.match(
  webviewSource,
  /EXECUTION_TERMINAL_DRAIN_MAX_CHARS_PER_FRAME[\s\S]*EXECUTION_TERMINAL_MAX_QUEUED_WRITES_PER_CONTROLLER/u,
  'Expected Webview output draining to use a global frame budget and queued-write backpressure.'
);
assert.match(
  webviewSource,
  /document\.hidden[\s\S]*reason: 'hidden-paused'[\s\S]*pendingOutputLength/u,
  'Expected hidden Webviews to pause output drain and report backlog instead of replaying output bursts immediately.'
);
assert.match(
  webviewSource,
  /shouldThrottleForLagRecovery[\s\S]*'lag-recovery'/u,
  'Expected Webview drain to enter a small-budget recovery mode after main-thread lag or visibility restore.'
);
assert.match(
  webviewSource,
  /getQueuedWriteCount\(\)[\s\S]*queuedWriteCount/u,
  'Expected each terminal controller to expose queued xterm writes so drain can avoid parser queue buildup.'
);

const serializedTerminalStateSource = await readFile('extensions/vscode/dev-session-canvas/src/common/serializedTerminalState.ts', 'utf8');
assert.match(
  serializedTerminalStateSource,
  /SERIALIZED_TERMINAL_STATE_WRITE_BATCH_DELAY_MS[\s\S]*schedulePendingWriteDrain[\s\S]*SERIALIZED_TERMINAL_STATE_CACHE_REFRESH_INTERVAL_MS/u,
  'Expected Host terminal-state snapshots to batch headless xterm writes and avoid serializing on every output chunk.'
);
assert.match(
  serializedTerminalStateSource,
  /outputSequence\?: number;[\s\S]*initialOutputSequence\?: number;[\s\S]*canTrustInitialState[\s\S]*normalizedInitialState\.outputSequence[\s\S]*initialOutputSequence/u,
  'Expected serialized terminal snapshots to carry outputSequence freshness metadata and reject stale initial states.'
);
assert.match(
  webviewSource,
  /serializedTerminalStateOutputSequence === snapshotOutputSequence[\s\S]*terminal\.write\(serializedTerminalState\.data/u,
  'Expected Webview snapshot restore to trust serialized terminal state only when its outputSequence matches the snapshot boundary.'
);

const lineContextTrackerSource = await readFile('extensions/vscode/dev-session-canvas/src/panel/executionTerminalLineContextTracker.ts', 'utf8');
assert.match(
  lineContextTrackerSource,
  /LINE_CONTEXT_WRITE_BATCH_DELAY_MS[\s\S]*takePendingWriteData[\s\S]*drainWriteData/u,
  'Expected Host line-context tracking to batch headless xterm writes while preserving ordering before input and link lookup.'
);

const extensionIdentitySource = await readFile('extensions/vscode/dev-session-canvas/src/common/extensionIdentity.ts', 'utf8');
assert.match(
  extensionIdentitySource,
  /runWebviewLifecycleRaceDiagnostics: 'devSessionCanvas\.__test\.runWebviewLifecycleRaceDiagnostics'/u,
  'Expected the host lifecycle race diagnostic command id to be registered for smoke coverage.'
);

const extensionSource = await readFile('extensions/vscode/dev-session-canvas/src/extension.ts', 'utf8');
assert.match(
  extensionSource,
  /TEST_COMMAND_IDS\.runWebviewLifecycleRaceDiagnostics[\s\S]*runWebviewLifecycleRaceDiagnosticsForTest/u,
  'Expected the host lifecycle race diagnostics to be exposed through a test-only command.'
);
assert.match(
  extensionSource,
  /COMMAND_IDS\.dumpHostDiagnostics[\s\S]*webviewLifecycleStatus[\s\S]*webviewLifecycleSummaryPath[\s\S]*executionPerformanceDiagnosticsPath/u,
  'Expected the user-facing host diagnostics command to surface lifecycle and execution performance diagnostics paths.'
);
assert.match(
  extensionSource,
  /promptWorkspaceRootRemovalChoice[\s\S]*isCloseAffordance: true[\s\S]*showWarningMessage<WorkspaceRootRemovalModalItem>[\s\S]*modal: true[\s\S]*buildWorkspaceRootRemovalModalDetail/u,
  'Expected workspace root removal to use VS Code native modal confirmation with a cancel close affordance.'
);
assert.match(
  extensionSource,
  /removeFolderFromWorkspaceFromCommand[\s\S]*getWorkspaceRootCanvasRemovalImpact[\s\S]*Clear Canvas and remove[\s\S]*Keep Canvas and remove[\s\S]*defaultChoice: 'keep-canvas'[\s\S]*clearWorkspaceRootCanvasIfRequested[\s\S]*removeWorkspaceFolderByFsPath/u,
  'Expected folder removal to offer native-modal keep/clear canvas choices and default to keeping the canvas.'
);
const worktreeRemovalCommandSource = extensionSource.slice(
  extensionSource.indexOf('async function removeWorktreeFromWorkspaceFromCommand'),
  extensionSource.indexOf('async function createWorktreeAndAddToWorkspaceFromCommand')
);
assert.match(
  worktreeRemovalCommandSource,
  /getWorkspaceRootCanvasRemovalImpact[\s\S]*Remove Worktree and clear Canvas[\s\S]*Remove Worktree but keep Canvas[\s\S]*defaultChoice: 'clear-canvas'[\s\S]*execFileAsync\('git', \['-C', workspaceFolder\.uri\.fsPath, 'worktree', 'remove'[\s\S]*if \(removalChoice\.clearCanvas\)[\s\S]*clearWorkspaceRootCanvasIfRequested/u,
  'Expected worktree removal to offer native-modal clear/keep canvas choices, default to clearing the canvas, and clear only after git worktree remove succeeds.'
);
assert.doesNotMatch(
  worktreeRemovalCommandSource,
  /if \(removalChoice\.clearCanvas\)[\s\S]*clearWorkspaceRootCanvasIfRequested[\s\S]*execFileAsync\('git', \['-C', workspaceFolder\.uri\.fsPath, 'worktree', 'remove'/u,
  'Expected worktree canvas clearing not to happen before git worktree remove succeeds.'
);
const workspaceRootRemovalPromptSource = extensionSource.slice(
  extensionSource.indexOf('async function promptWorkspaceRootRemovalChoice'),
  extensionSource.indexOf('function buildWorkspaceRootRemovalModalDetail')
);
assert.doesNotMatch(
  workspaceRootRemovalPromptSource,
  /showQuickPick/u,
  'Expected workspace root removal confirmation not to use QuickPick.'
);
assert.doesNotMatch(
  workspaceRootRemovalPromptSource,
  /sidebarPrompt|workspaceRootRemovalPrompt|Webview/u,
  'Expected workspace root removal confirmation not to use a sidebar Webview prompt.'
);

const sidebarNodeListSource = await readFile('extensions/vscode/dev-session-canvas/src/sidebar/CanvasSidebarNodeListView.ts', 'utf8');
assert.doesNotMatch(
  sidebarNodeListSource,
  /workspaceRootRemovalPrompt|removal-modal|data-sidebar-removal-modal/u,
  'Expected sidebar node list not to self-render workspace root removal confirmation modals.'
);

const smokeSource = await readFile('tests/vscode-smoke/extension-tests.cjs', 'utf8');
assert.match(
  smokeSource,
  /verifyWebviewLifecycleRaceDiagnostics[\s\S]*testRunWebviewLifecycleRaceDiagnostics[\s\S]*readyWebviewPromoted/u,
  'Expected VS Code smoke tests to execute the host lifecycle race diagnostic command.'
);
assert.match(
  smokeSource,
  /verifyWebviewLifecycleRaceDiagnostics[\s\S]*secondReadyPromotionIgnored[\s\S]*secondReadyBootstrapSuppressed[\s\S]*messageTargetStayedOnPromotedWebview/u,
  'Expected VS Code smoke tests to assert the competing ready after ack regression.'
);
assert.match(
  smokeSource,
  /verifyWebviewLifecycleRaceDiagnostics[\s\S]*sameWebviewFrameReadyPromoted[\s\S]*sameWebviewFrameBootstrapDelivered[\s\S]*sameWebviewFrameLifecycleRebound/u,
  'Expected VS Code smoke tests to assert same-Webview refreshed frame lifecycle rebinding.'
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

const executionPerformanceDiagnosticMessage = {
  type: 'webview/executionPerformanceDiagnostic',
  payload: {
    source: 'webview-terminal-write',
    nodeId: 'agent-1',
    kind: 'agent',
    reason: 'output',
    sequence: 3,
    durationMs: 42.5,
    webviewEpochMs: 1781111111000,
    hostReceivedEpochMs: 1781111111042,
    hostAckEpochMs: 1781111111043,
    hostAckPostEpochMs: 1781111111044,
    queueDelayMs: 42,
    characters: 4096,
    bytes: 4096,
    queuedWriteCount: 2,
    bufferLength: 1000,
    owner: 'supervisor',
    lifecycleStatus: 'running',
    workspaceStateMode: 'full',
    success: true
  }
};
assert.deepEqual(parseWebviewMessage(executionPerformanceDiagnosticMessage), {
  type: 'webview/executionPerformanceDiagnostic',
  payload: {
    ...executionPerformanceDiagnosticMessage.payload,
    requestId: undefined,
    executionSessionId: undefined,
    controllerCount: undefined,
    flushedControllerCount: undefined,
    pendingControllerCount: undefined,
    queuedSnapshotCount: undefined,
    pendingOutputLength: undefined
  }
});
assert.deepEqual(
  parseWebviewMessage({
    type: 'webview/executionPerformanceDiagnostic',
    payload: {
      source: 'webview-output-enqueue',
      nodeId: 'agent-1',
      kind: 'agent',
      durationMs: 3,
      characters: 4096,
      pendingOutputLength: 8192,
      success: true
    }
  }),
  {
    type: 'webview/executionPerformanceDiagnostic',
    payload: {
      source: 'webview-output-enqueue',
      nodeId: 'agent-1',
      kind: 'agent',
      reason: undefined,
      sequence: undefined,
      durationMs: 3,
      webviewEpochMs: undefined,
      hostReceivedEpochMs: undefined,
      hostAckEpochMs: undefined,
      hostAckPostEpochMs: undefined,
      queueDelayMs: undefined,
      requestId: undefined,
      executionSessionId: undefined,
      characters: 4096,
      bytes: undefined,
      controllerCount: undefined,
      flushedControllerCount: undefined,
      pendingControllerCount: undefined,
      queuedSnapshotCount: undefined,
      queuedWriteCount: undefined,
      bufferLength: undefined,
      pendingOutputLength: 8192,
      owner: undefined,
      lifecycleStatus: undefined,
      workspaceStateMode: undefined,
      success: true
    }
  }
);
assert.deepEqual(
  parseWebviewMessage({
    type: 'webview/executionPerformanceDiagnostic',
    payload: {
      source: 'webview-output-snapshot-reset',
      nodeId: 'agent-1',
      kind: 'agent',
      reason: 'lag-backlog-snapshot-reset',
      requestId: 'snapshot-reset-1',
      executionSessionId: 'session-1',
      sequence: 12,
      characters: 6142227,
      pendingOutputLength: 6142227,
      success: true
    }
  }),
  {
    type: 'webview/executionPerformanceDiagnostic',
    payload: {
      source: 'webview-output-snapshot-reset',
      nodeId: 'agent-1',
      kind: 'agent',
      reason: 'lag-backlog-snapshot-reset',
      sequence: 12,
      durationMs: undefined,
      webviewEpochMs: undefined,
      hostReceivedEpochMs: undefined,
      hostAckEpochMs: undefined,
      hostAckPostEpochMs: undefined,
      queueDelayMs: undefined,
      requestId: 'snapshot-reset-1',
      executionSessionId: 'session-1',
      characters: 6142227,
      bytes: undefined,
      controllerCount: undefined,
      flushedControllerCount: undefined,
      pendingControllerCount: undefined,
      queuedSnapshotCount: undefined,
      queuedWriteCount: undefined,
      bufferLength: undefined,
      pendingOutputLength: 6142227,
      owner: undefined,
      lifecycleStatus: undefined,
      workspaceStateMode: undefined,
      success: true
    }
  }
);
assert.deepEqual(
  parseWebviewMessage({
    type: 'webview/executionPerformanceDiagnostic',
    payload: {
      source: 'host-input-received',
      nodeId: 'agent-1',
      kind: 'agent',
      sequence: 9,
      durationMs: 180,
      webviewEpochMs: 1781111111000,
      hostReceivedEpochMs: 1781111111180,
      hostAckEpochMs: undefined,
      hostAckPostEpochMs: undefined,
      queueDelayMs: 180,
      requestId: undefined,
      executionSessionId: undefined,
      characters: 1,
      bytes: 1,
      success: true
    }
  }),
  {
    type: 'webview/executionPerformanceDiagnostic',
    payload: {
      source: 'host-input-received',
      nodeId: 'agent-1',
      kind: 'agent',
      reason: undefined,
      sequence: 9,
      durationMs: 180,
      webviewEpochMs: 1781111111000,
      hostReceivedEpochMs: 1781111111180,
      hostAckEpochMs: undefined,
      hostAckPostEpochMs: undefined,
      queueDelayMs: 180,
      requestId: undefined,
      executionSessionId: undefined,
      characters: 1,
      bytes: 1,
      controllerCount: undefined,
      flushedControllerCount: undefined,
      pendingControllerCount: undefined,
      queuedSnapshotCount: undefined,
      queuedWriteCount: undefined,
      bufferLength: undefined,
      pendingOutputLength: undefined,
      owner: undefined,
      lifecycleStatus: undefined,
      workspaceStateMode: undefined,
      success: true
    }
  }
);

assert.deepEqual(
  parseWebviewMessage({
    type: 'webview/executionPerformanceDiagnostic',
    payload: {
      source: 'webview-input-ack',
      nodeId: 'agent-1',
      kind: 'agent',
      sequence: 11,
      durationMs: 318,
      webviewEpochMs: 1781111111000,
      hostReceivedEpochMs: 1781111111280,
      hostAckEpochMs: 1781111111281,
      hostAckPostEpochMs: 1781111111282,
      queueDelayMs: 280,
      requestId: undefined,
      executionSessionId: undefined,
      characters: 1,
      bytes: 1,
      success: true
    }
  }),
  {
    type: 'webview/executionPerformanceDiagnostic',
    payload: {
      source: 'webview-input-ack',
      nodeId: 'agent-1',
      kind: 'agent',
      reason: undefined,
      sequence: 11,
      durationMs: 318,
      webviewEpochMs: 1781111111000,
      hostReceivedEpochMs: 1781111111280,
      hostAckEpochMs: 1781111111281,
      hostAckPostEpochMs: 1781111111282,
      queueDelayMs: 280,
      requestId: undefined,
      executionSessionId: undefined,
      characters: 1,
      bytes: 1,
      controllerCount: undefined,
      flushedControllerCount: undefined,
      pendingControllerCount: undefined,
      queuedSnapshotCount: undefined,
      queuedWriteCount: undefined,
      bufferLength: undefined,
      pendingOutputLength: undefined,
      owner: undefined,
      lifecycleStatus: undefined,
      workspaceStateMode: undefined,
      success: true
    }
  }
);
assert.deepEqual(
  parseWebviewMessage({
    type: 'webview/executionPerformanceDiagnostic',
    payload: {
      source: 'host-event-loop-lag',
      reason: 'timer-lag',
      durationMs: 180,
      controllerCount: 4,
      success: true
    }
  }),
  {
    type: 'webview/executionPerformanceDiagnostic',
    payload: {
      source: 'host-event-loop-lag',
      nodeId: undefined,
      kind: undefined,
      reason: 'timer-lag',
      sequence: undefined,
      durationMs: 180,
      webviewEpochMs: undefined,
      hostReceivedEpochMs: undefined,
      hostAckEpochMs: undefined,
      hostAckPostEpochMs: undefined,
      queueDelayMs: undefined,
      requestId: undefined,
      executionSessionId: undefined,
      characters: undefined,
      bytes: undefined,
      controllerCount: 4,
      flushedControllerCount: undefined,
      pendingControllerCount: undefined,
      queuedSnapshotCount: undefined,
      queuedWriteCount: undefined,
      bufferLength: undefined,
      pendingOutputLength: undefined,
      owner: undefined,
      lifecycleStatus: undefined,
      workspaceStateMode: undefined,
      success: true
    }
  }
);

assert.deepEqual(
  parseWebviewMessage({
    type: 'webview/executionPerformanceDiagnostic',
    payload: {
      source: 'host-state-persist',
      reason: 'persist-snapshot-write',
      durationMs: 21,
      bytes: 4096,
      controllerCount: 4,
      workspaceStateMode: 'skip'
    }
  }),
  {
    type: 'webview/executionPerformanceDiagnostic',
    payload: {
      source: 'host-state-persist',
      nodeId: undefined,
      kind: undefined,
      reason: 'persist-snapshot-write',
      sequence: undefined,
      durationMs: 21,
      webviewEpochMs: undefined,
      hostReceivedEpochMs: undefined,
      hostAckEpochMs: undefined,
      hostAckPostEpochMs: undefined,
      queueDelayMs: undefined,
      requestId: undefined,
      executionSessionId: undefined,
      characters: undefined,
      bytes: 4096,
      controllerCount: 4,
      flushedControllerCount: undefined,
      pendingControllerCount: undefined,
      queuedSnapshotCount: undefined,
      queuedWriteCount: undefined,
      bufferLength: undefined,
      pendingOutputLength: undefined,
      owner: undefined,
      lifecycleStatus: undefined,
      workspaceStateMode: 'skip',
      success: undefined
    }
  }
);
assert.deepEqual(
  parseWebviewMessage({
    type: 'webview/executionPerformanceDiagnostic',
    payload: {
      source: 'webview-main-thread-lag',
      reason: 'timer-lag',
      durationMs: 180,
      success: true
    }
  }),
  {
    type: 'webview/executionPerformanceDiagnostic',
    payload: {
      source: 'webview-main-thread-lag',
      nodeId: undefined,
      kind: undefined,
      reason: 'timer-lag',
      sequence: undefined,
      durationMs: 180,
      webviewEpochMs: undefined,
      hostReceivedEpochMs: undefined,
      hostAckEpochMs: undefined,
      hostAckPostEpochMs: undefined,
      queueDelayMs: undefined,
      requestId: undefined,
      executionSessionId: undefined,
      characters: undefined,
      bytes: undefined,
      controllerCount: undefined,
      flushedControllerCount: undefined,
      pendingControllerCount: undefined,
      queuedSnapshotCount: undefined,
      queuedWriteCount: undefined,
      bufferLength: undefined,
      pendingOutputLength: undefined,
      owner: undefined,
      lifecycleStatus: undefined,
      workspaceStateMode: undefined,
      success: true
    }
  }
);
assert.deepEqual(
  parseWebviewMessage({
    type: 'webview/executionPerformanceDiagnostic',
    payload: {
      source: 'host-output-post',
      nodeId: 'terminal-1',
      kind: 'terminal',
      durationMs: 19,
      characters: 32768,
      bytes: 32768,
      success: true
    }
  }),
  {
    type: 'webview/executionPerformanceDiagnostic',
    payload: {
      source: 'host-output-post',
      nodeId: 'terminal-1',
      kind: 'terminal',
      reason: undefined,
      sequence: undefined,
      durationMs: 19,
      webviewEpochMs: undefined,
      hostReceivedEpochMs: undefined,
      hostAckEpochMs: undefined,
      hostAckPostEpochMs: undefined,
      queueDelayMs: undefined,
      requestId: undefined,
      executionSessionId: undefined,
      characters: 32768,
      bytes: 32768,
      controllerCount: undefined,
      flushedControllerCount: undefined,
      pendingControllerCount: undefined,
      queuedSnapshotCount: undefined,
      queuedWriteCount: undefined,
      bufferLength: undefined,
      pendingOutputLength: undefined,
      owner: undefined,
      lifecycleStatus: undefined,
      workspaceStateMode: undefined,
      success: true
    }
  }
);
assert.deepEqual(
  parseWebviewMessage({
    type: 'webview/executionPerformanceDiagnostic',
    payload: {
      source: 'host-output-scheduler',
      nodeId: 'agent-1',
      kind: 'agent',
      reason: 'input-priority',
      durationMs: 4,
      characters: 8192,
      bytes: 8192,
      controllerCount: 4,
      flushedControllerCount: 1,
      pendingControllerCount: 3,
      queuedWriteCount: 3,
      pendingOutputLength: 65536,
      success: true
    }
  }),
  {
    type: 'webview/executionPerformanceDiagnostic',
    payload: {
      source: 'host-output-scheduler',
      nodeId: 'agent-1',
      kind: 'agent',
      reason: 'input-priority',
      sequence: undefined,
      durationMs: 4,
      webviewEpochMs: undefined,
      hostReceivedEpochMs: undefined,
      hostAckEpochMs: undefined,
      hostAckPostEpochMs: undefined,
      queueDelayMs: undefined,
      requestId: undefined,
      executionSessionId: undefined,
      characters: 8192,
      bytes: 8192,
      controllerCount: 4,
      flushedControllerCount: 1,
      pendingControllerCount: 3,
      queuedSnapshotCount: undefined,
      queuedWriteCount: 3,
      bufferLength: undefined,
      pendingOutputLength: 65536,
      owner: undefined,
      lifecycleStatus: undefined,
      workspaceStateMode: undefined,
      success: true
    }
  }
);
assert.deepEqual(
  parseWebviewMessage({
    type: 'webview/executionPerformanceDiagnostic',
    payload: {
      source: 'webview-terminal-drain',
      durationMs: 18,
      controllerCount: 3,
      flushedControllerCount: 2,
      pendingControllerCount: 1
    }
  }),
  {
    type: 'webview/executionPerformanceDiagnostic',
    payload: {
      source: 'webview-terminal-drain',
      nodeId: undefined,
      kind: undefined,
      reason: undefined,
      sequence: undefined,
      durationMs: 18,
      webviewEpochMs: undefined,
      hostReceivedEpochMs: undefined,
      hostAckEpochMs: undefined,
      hostAckPostEpochMs: undefined,
      queueDelayMs: undefined,
      requestId: undefined,
      executionSessionId: undefined,
      characters: undefined,
      bytes: undefined,
      controllerCount: 3,
      flushedControllerCount: 2,
      pendingControllerCount: 1,
      queuedSnapshotCount: undefined,
      queuedWriteCount: undefined,
      bufferLength: undefined,
      pendingOutputLength: undefined,
      owner: undefined,
      lifecycleStatus: undefined,
      workspaceStateMode: undefined,
      success: undefined
    }
  }
);
assert.deepEqual(
  parseWebviewMessage({
    type: 'webview/executionPerformanceDiagnostic',
    payload: {
      source: 'webview-snapshot-restore-queue',
      nodeId: 'agent-1',
      kind: 'agent',
      reason: 'started',
      durationMs: 64,
      queuedSnapshotCount: 2,
      success: true
    }
  }),
  {
    type: 'webview/executionPerformanceDiagnostic',
    payload: {
      source: 'webview-snapshot-restore-queue',
      nodeId: 'agent-1',
      kind: 'agent',
      reason: 'started',
      sequence: undefined,
      durationMs: 64,
      webviewEpochMs: undefined,
      hostReceivedEpochMs: undefined,
      hostAckEpochMs: undefined,
      hostAckPostEpochMs: undefined,
      queueDelayMs: undefined,
      requestId: undefined,
      executionSessionId: undefined,
      characters: undefined,
      bytes: undefined,
      controllerCount: undefined,
      flushedControllerCount: undefined,
      pendingControllerCount: undefined,
      queuedSnapshotCount: 2,
      queuedWriteCount: undefined,
      bufferLength: undefined,
      pendingOutputLength: undefined,
      owner: undefined,
      lifecycleStatus: undefined,
      workspaceStateMode: undefined,
      success: true
    }
  }
);

assert.equal(
  parseWebviewMessage({
    type: 'webview/executionPerformanceDiagnostic',
    payload: {
      source: 'unknown',
      durationMs: 1
    }
  }),
  null,
  'execution performance diagnostic source 必须限定为已知来源。'
);
assert.equal(
  parseWebviewMessage({
    type: 'webview/executionPerformanceDiagnostic',
    payload: {
      source: 'host-input-write',
      kind: 'note',
      durationMs: 1
    }
  }),
  null,
  'execution performance diagnostic kind 必须是执行节点类型。'
);

assert.equal(
  isWebviewDomAction({
    kind: 'clickNodeActionButton',
    nodeId: 'note-1',
    action: 'reload'
  }),
  true,
  'test DOM action 应允许使用稳定 action id 点击节点按钮，避免依赖本地化后的可见文案。'
);

assert.equal(
  isWebviewDomAction({
    kind: 'clickNodeActionButton',
    nodeId: 'note-1',
    action: 'not-a-real-action',
    label: 'Delete'
  }),
  false,
  'test DOM action 出现 action 字段时必须是稳定 action id，避免无效 action 回退到本地化 label。'
);

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
