const assert = require('assert');
const fs = require('fs/promises');
const fsSync = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const vscode = require('vscode');
const { activateVisibleExtension, waitForCommand } = require('./test-helpers.cjs');

const FAKE_CLAUDE_PROVIDER_COMMAND = 'claude';
const INVALID_PROVIDER_LAUNCH_COMMAND = 'node -e "process.stdout.write(\'provider-bypass\')"';
const EXPLICIT_CLAUDE_SESSION_ID = 'session-explicit-123456789';
const RESTRICTED_SESSION_HISTORY_RESTORE_MESSAGE =
  'The current workspace is not trusted. You can browse session history, but cannot resume or fork sessions into new Agent nodes.';

const EXTENSION_ID = 'devsessioncanvas.dev-session-canvas';
const COMMAND_IDS = {
  openCanvas: 'devSessionCanvas.openCanvas',
  openCanvasInEditor: 'devSessionCanvas.openCanvasInEditor',
  openCanvasInPanel: 'devSessionCanvas.openCanvasInPanel',
  applyTemplate: 'devSessionCanvas.applyTemplate',
  applyDefaultTemplate: 'devSessionCanvas.applyDefaultTemplate',
  resetToDefaultTemplate: 'devSessionCanvas.resetToDefaultTemplate',
  saveCanvasAsTemplate: 'devSessionCanvas.saveCanvasAsTemplate',
  importTemplate: 'devSessionCanvas.importTemplate',
  exportTemplate: 'devSessionCanvas.exportTemplate',
  setDefaultTemplate: 'devSessionCanvas.setDefaultTemplate',
  refreshTemplates: 'devSessionCanvas.refreshTemplates',
  selectTerminalShell: 'devSessionCanvas.selectTerminalShell',
  selectCodexCli: 'devSessionCanvas.selectCodexCli',
  selectClaudeCli: 'devSessionCanvas.selectClaudeCli',
  openCodexConfigFile: 'devSessionCanvas.openCodexConfigFile',
  openCodexAuthFile: 'devSessionCanvas.openCodexAuthFile',
  openClaudeSettingsFile: 'devSessionCanvas.openClaudeSettingsFile',
  createNode: 'devSessionCanvas.createNode',
  createTerminalFromExplorerResource: 'devSessionCanvas.createTerminalFromExplorerResource',
  createAgentFromExplorerResource: 'devSessionCanvas.createAgentFromExplorerResource',
  createNoteFromExplorerMarkdown: 'devSessionCanvas.createNoteFromExplorerMarkdown',
  showNodeList: 'devSessionCanvas.showNodeList',
  setSidebarNodeListFlatView: 'devSessionCanvas.setSidebarNodeListFlatView',
  setSidebarNodeListGroupedView: 'devSessionCanvas.setSidebarNodeListGroupedView',
  showSessionHistory: 'devSessionCanvas.showSessionHistory',
  focusNode: 'devSessionCanvas.__internal.focusNode',
  refreshSessionHistory: 'devSessionCanvas.refreshSessionHistory',
  dumpHostDiagnostics: 'devSessionCanvas.dumpHostDiagnostics',
  focusSidebarNode: 'devSessionCanvas.__internal.focusSidebarNode',
  restoreSidebarSessionHistoryEntry: 'devSessionCanvas.__internal.restoreSidebarSessionHistoryEntry',
  editFileIncludeFilter: 'devSessionCanvas.editFileIncludeFilter',
  editFileExcludeFilter: 'devSessionCanvas.editFileExcludeFilter',
  testGetDebugState: 'devSessionCanvas.__test.getDebugState',
  testGetSidebarSummaryItems: 'devSessionCanvas.__test.getSidebarSummaryItems',
  testGetSidebarTemplateItems: 'devSessionCanvas.__test.getSidebarTemplateItems',
  testGetSidebarNodeListItems: 'devSessionCanvas.__test.getSidebarNodeListItems',
  testGetSidebarSessionHistoryItems: 'devSessionCanvas.__test.getSidebarSessionHistoryItems',
  testGetRuntimeSupervisorState: 'devSessionCanvas.__test.getRuntimeSupervisorState',
  testGetHostMessages: 'devSessionCanvas.__test.getHostMessages',
  testClearHostMessages: 'devSessionCanvas.__test.clearHostMessages',
  testGetDiagnosticEvents: 'devSessionCanvas.__test.getDiagnosticEvents',
  testClearDiagnosticEvents: 'devSessionCanvas.__test.clearDiagnosticEvents',
  testDumpHostDiagnostics: 'devSessionCanvas.__test.dumpHostDiagnostics',
  testLocateCodexSessionId: 'devSessionCanvas.__test.locateCodexSessionId',
  testLocateClaudeSessionId: 'devSessionCanvas.__test.locateClaudeSessionId',
  testExtractCodexResumeSessionId: 'devSessionCanvas.__test.extractCodexResumeSessionId',
  testExtractClaudeResumeSessionId: 'devSessionCanvas.__test.extractClaudeResumeSessionId',
  testGetAgentCliResolutionCacheKey: 'devSessionCanvas.__test.getAgentCliResolutionCacheKey',
  testWaitForCanvasReady: 'devSessionCanvas.__test.waitForCanvasReady',
  testCaptureWebviewProbe: 'devSessionCanvas.__test.captureWebviewProbe',
  testPerformWebviewDomAction: 'devSessionCanvas.__test.performWebviewDomAction',
  testRunWebviewLifecycleRaceDiagnostics: 'devSessionCanvas.__test.runWebviewLifecycleRaceDiagnostics',
  testPerformSidebarNodeListAction: 'devSessionCanvas.__test.performSidebarNodeListAction',
  testPerformSidebarSessionHistoryAction: 'devSessionCanvas.__test.performSidebarSessionHistoryAction',
  testGetCanvasTemplateItems: 'devSessionCanvas.__test.getCanvasTemplateItems',
  testApplyCanvasTemplate: 'devSessionCanvas.__test.applyCanvasTemplate',
  testSaveCanvasAsTemplate: 'devSessionCanvas.__test.saveCanvasAsTemplate',
  testSetDefaultTemplate: 'devSessionCanvas.__test.setDefaultTemplate',
  testDeleteCanvasTemplate: 'devSessionCanvas.__test.deleteCanvasTemplate',
  testExportCanvasTemplateToPath: 'devSessionCanvas.__test.exportCanvasTemplateToPath',
  testImportCanvasTemplateFromPath: 'devSessionCanvas.__test.importCanvasTemplateFromPath',
  testSetPersistedState: 'devSessionCanvas.__test.setPersistedState',
  testFlushPersistedState: 'devSessionCanvas.__test.flushPersistedState',
  testReloadPersistedState: 'devSessionCanvas.__test.reloadPersistedState',
  testSimulateRuntimeReload: 'devSessionCanvas.__test.simulateRuntimeReload',
  testDispatchWebviewMessage: 'devSessionCanvas.__test.dispatchWebviewMessage',
  testStartExecutionSession: 'devSessionCanvas.__test.startExecutionSession',
  testSetQuickPickSelections: 'devSessionCanvas.__test.setQuickPickSelections',
  testCreateNode: 'devSessionCanvas.__test.createNode',
  testResetState: 'devSessionCanvas.__test.resetState'
};
const artifactDir = process.env.DEV_SESSION_CANVAS_SMOKE_ARTIFACT_DIR;
const smokeScenario = process.env.DEV_SESSION_CANVAS_SMOKE_SCENARIO || 'trusted';
const REAL_DOM_AGENT_TITLE = 'Agent Title Through DOM';
const REAL_DOM_TERMINAL_TITLE = 'Terminal Title Through DOM';
const REAL_DOM_NOTE_TITLE = 'Host Smoke Note Through DOM';
const REAL_DOM_NOTE_BODY = 'Drive the note edit through the real VS Code webview DOM.';
const REAL_DOM_NOTE_CHECKLIST_BODY = ['- [ ] 补齐 smoke', '- [x] 保持预览态'].join('\n');
const REAL_DOM_NOTE_CHECKLIST_BODY_TOGGLED = ['- [x] 补齐 smoke', '- [x] 保持预览态'].join('\n');
const REAL_DOM_NOTE_FILE_LINK_RELATIVE_PATH = 'note-link-open-target.txt';
const REAL_DOM_NOTE_FILE_LINK_BODY =
  '[打开 Note 链接目标](.debug/vscode-smoke/note-link-open-target.txt#L2C3)';
const REAL_DOM_NOTE_MARKDOWN_LARGE_TAIL = '0123456789abcdef'.repeat(520);
const REAL_DOM_NOTE_MARKDOWN_ASSOCIATION_BODY =
  `# Associated Note\n\n- from workspace file\n\n${REAL_DOM_NOTE_MARKDOWN_LARGE_TAIL}`;
const REAL_DOM_NOTE_MARKDOWN_ASSOCIATION_UPDATED_BODY =
  `# Associated Note\n\n- updated from canvas\n\n${REAL_DOM_NOTE_MARKDOWN_LARGE_TAIL}\nupdated tail`;
const DISPOSED_EDITOR_NOTE_BODY = 'This note update should never commit after the editor closes.';
const EXECUTION_ATTENTION_FOCUS_ACTION_LABEL = 'View Node';
const DEFAULT_ATTENTION_SIGNALS = [
  'bel',
  'osc9',
  'osc777',
  'agentAbnormalExit',
  'codexAbnormalOutputText'
];
const UNKNOWN_WEBVIEW_MESSAGE_ERROR = 'Received an unrecognized message and ignored it.';
const WEBVIEW_FAULT_INJECTION_DELAY_MS = 1500;
const AGENT_STOP_RACE_SLEEP_SECONDS = 5;
const HOST_BOUNDARY_FLUSH_AGENT_MARKER = 'HOST_BOUNDARY_AGENT_FLUSH';
const HOST_BOUNDARY_FLUSH_TERMINAL_MARKER = 'HOST_BOUNDARY_TERMINAL_FLUSH';
const EDITOR_TAB_SWITCH_TERMINAL_MARKER = 'DEV_SESSION_CANVAS_EDITOR_TAB_SWITCH';
const PANEL_TAB_SWITCH_TERMINAL_MARKER = 'DEV_SESSION_CANVAS_PANEL_TAB_SWITCH';
const TERMINAL_SCROLLBACK_PERSIST_MARKER = 'DEV_SESSION_CANVAS_SCROLLBACK_PERSIST';
const TERMINAL_FLOOD_OUTPUT_MARKER = 'DEV_SESSION_CANVAS_TERMINAL_FLOOD';
const TERMINAL_FLOOD_SECONDARY_OUTPUT_MARKER = 'DEV_SESSION_CANVAS_TERMINAL_FLOOD_SECONDARY';
const TERMINAL_FLOOD_AGENT_MARKER = '[fake-agent] terminal flood parallel';
const TERMINAL_FLOOD_NEW_AGENT_MARKER = '[fake-agent] terminal flood created agent';
const TERMINAL_FLOOD_AFTER_CTRL_C_MARKER = 'DEV_SESSION_CANVAS_AFTER_CTRL_C';
const TERMINAL_FLOOD_SECONDARY_AFTER_CTRL_C_MARKER = 'DEV_SESSION_CANVAS_SECONDARY_AFTER_CTRL_C';
const TERMINAL_NATIVE_DROP_MARKER = 'DEV_SESSION_CANVAS_NATIVE_DROP';
const RESTRICTED_AGENT_SERIALIZED_MARKER = 'DEV_SESSION_CANVAS_RESTRICTED_AGENT_HISTORY';
const RESTRICTED_TERMINAL_SERIALIZED_MARKER = 'DEV_SESSION_CANVAS_RESTRICTED_TERMINAL_HISTORY';
const RESIZED_NODE_SIZES = {
  agent: { width: 640, height: 500 },
  terminal: { width: 620, height: 460 },
  note: { width: 500, height: 500 }
};
const BUILTIN_WORKBENCH_TERMINAL_THEME_EXPECTATIONS = {
  panel: {
    'Dark Modern': {
      background: '#181818',
      foreground: '#CCCCCC',
      ansiBlue: '#2472c8'
    },
    'Light Modern': {
      background: '#F8F8F8',
      foreground: '#3B3B3B',
      ansiBlue: '#0451a5'
    }
  },
  editor: {
    'Dark Modern': {
      background: '#1F1F1F',
      foreground: '#CCCCCC',
      ansiBlue: '#2472c8'
    },
    'Light Modern': {
      background: '#FFFFFF',
      foreground: '#3B3B3B',
      ansiBlue: '#0451a5'
    }
  }
};
let lastWebviewProbe;

module.exports = {
  run
};

async function run() {
  try {
    await runSmoke();
  } catch (error) {
    await writeFailureArtifacts(error);
    throw error;
  }
}

async function runSmoke() {
  await activateVisibleExtension(vscode, EXTENSION_ID);
  await waitForCommand(vscode, COMMAND_IDS.openCanvasInEditor);
  await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInEditor);
  await waitForCommand(vscode, COMMAND_IDS.testResetState);

  const commands = await vscode.commands.getCommands(true);
  for (const command of Object.values(COMMAND_IDS)) {
    assert.ok(commands.includes(command), `Missing command ${command}.`);
  }

  await verifyFirstOpenDefaultTemplate();
  await vscode.commands.executeCommand(COMMAND_IDS.testResetState);
  await clearHostMessages();
  await clearDiagnosticEvents();
  await verifyWebviewLifecycleRaceDiagnostics();

  if (smokeScenario === 'restricted') {
    await runRestrictedSmoke();
    return;
  }

  await runTrustedSmoke();
}

async function createBaseNodes() {
  await dispatchWebviewMessage({
    type: 'webview/createDemoNode',
    payload: {
      kind: 'agent',
      preferredPosition: { x: 40, y: 40 }
    }
  });
  await dispatchWebviewMessage({
    type: 'webview/createDemoNode',
    payload: {
      kind: 'terminal',
      preferredPosition: { x: 420, y: 40 }
    }
  });
  await dispatchWebviewMessage({
    type: 'webview/createDemoNode',
    payload: {
      kind: 'note',
      preferredPosition: { x: 420, y: 320 }
    }
  });
}

async function verifyFirstOpenDefaultTemplate() {
  const snapshot = await waitForSnapshot((currentSnapshot) => {
    const noteTitles = currentSnapshot.state.nodes
      .filter((node) => node.kind === 'note')
      .map((node) => node.title)
      .sort();
    return (
      currentSnapshot.state.nodes.length === 1 &&
      noteTitles.includes('Dev Session Canvas 使用指南')
    );
  }, 20000);

  assert.deepStrictEqual(
    snapshot.state.nodes.map((node) => node.kind).sort(),
    ['note']
  );

  const templateCatalog = await getCanvasTemplateCatalog();
  const builtinTemplateIds = templateCatalog.templates
    .filter((entry) => entry.template.category === 'builtin')
    .map((entry) => entry.template.id)
    .sort();
  assert.deepStrictEqual(builtinTemplateIds, ['builtin-basic-workflow', 'builtin-getting-started']);
  assert.strictEqual(templateCatalog.defaultTemplateId, 'builtin-getting-started');
}

async function verifyWebviewLifecycleRaceDiagnostics() {
  const result = await vscode.commands.executeCommand(COMMAND_IDS.testRunWebviewLifecycleRaceDiagnostics);

  assert.strictEqual(result.surface, 'panel');
  assert.strictEqual(result.promoted, true, 'Expected older rendered panel frame to be promoted before stale checks.');
  assert.strictEqual(result.ready, true, 'Expected promoted frame to mark the panel surface ready.');
  assert.strictEqual(result.bootstrapAck, true, 'Expected bootstrap ack to belong to the promoted frame.');
  assert.strictEqual(
    result.bootstrapDeliveredToPromotedWebview,
    true,
    'Expected host/bootstrap to be delivered to the frame that sent ready.'
  );
  assert.strictEqual(
    result.secondReadyPromotionIgnored,
    true,
    'Expected a competing frame ready after bootstrap ack not to trigger a second promotion.'
  );
  assert.strictEqual(
    result.secondReadyBootstrapSuppressed,
    true,
    'Expected a competing frame ready after bootstrap ack not to trigger a second bootstrap.'
  );
  assert.strictEqual(
    result.messageTargetStayedOnPromotedWebview,
    true,
    'Expected the promoted frame to keep the message target after a competing frame ready.'
  );
  assert.strictEqual(
    result.sameWebviewFrameReadyPromoted,
    true,
    'Expected the current Webview object to accept a same-generation ready with a refreshed frame id.'
  );
  assert.strictEqual(
    result.sameWebviewFrameBootstrapDelivered,
    true,
    'Expected a same-Webview refreshed frame to receive a replacement bootstrap.'
  );
  assert.strictEqual(
    result.sameWebviewFrameLifecycleRebound,
    true,
    'Expected the current lifecycle frame id to rebind to the same-Webview refreshed frame.'
  );
  assert.strictEqual(
    result.gatedMessageQueuedBeforeAck,
    true,
    'Expected non-bootstrap host messages to queue until bootstrap ack.'
  );
  assert.strictEqual(
    result.gatedMessageDeliveredBeforeAck,
    false,
    'Expected queued host messages not to reach the frame before bootstrap ack.'
  );
  assert.strictEqual(
    result.gatedMessageDeliveredAfterAck,
    true,
    'Expected queued host messages to flush after bootstrap ack.'
  );
  assert.strictEqual(
    result.focusMessageRetriedAfterFrameRefresh,
    true,
    'Expected workspace-root focus to retry after a same-Webview frame refresh.'
  );
  assert.strictEqual(
    result.focusMessageReachedRefreshedFrame,
    true,
    'Expected the retried workspace-root focus message to use the refreshed frame id.'
  );
  assert.strictEqual(result.staleMutationIgnored, true);
  assert.strictEqual(result.staleProbeResultIgnored, true);
  assert.strictEqual(result.pendingProbeResolvedFromCurrent, true);
  assert.strictEqual(result.staleDomActionResultIgnored, true);
  assert.strictEqual(result.pendingDomActionResolvedFromCurrent, true);
  assert.strictEqual(
    result.templateCatalogPostSettled,
    true,
    'Expected async template catalog posting after bootstrap ack to settle inside diagnostics.'
  );
  assert.deepStrictEqual(
    result.oldWebviewPostedTypes.slice(0, 2),
    ['host/bootstrap', 'host/visibilityRestored']
  );
  assert.ok(
    result.oldWebviewPostedTypes.includes('host/templateCatalogUpdated') ||
      result.diagnosticKinds.includes('template/catalogPostFailed'),
    'Expected bootstrap ack follow-up to either post template catalog or record a catalog failure.'
  );
  assert.deepStrictEqual(result.competingWebviewPostedTypes, []);
  assert.ok(result.diagnosticKinds.includes('surface/readyWebviewPromoted'));
  assert.ok(result.diagnosticKinds.includes('surface/hostMessageQueuedUntilBootstrapAck'));
  assert.ok(result.diagnosticKinds.includes('webview/staleMessageIgnored'));
  assert.ok(result.diagnosticKinds.includes('webview/staleProbeResultIgnored'));
  assert.ok(result.diagnosticKinds.includes('webview/staleDomActionResultIgnored'));
}

async function getCanvasTemplateCatalog() {
  return vscode.commands.executeCommand(COMMAND_IDS.testGetCanvasTemplateItems);
}

async function verifyEmptyGroupDeletionSkipsConfirmation() {
  await setPersistedState({
    version: 1,
    updatedAt: '2026-05-23T04:30:00.000Z',
    nodes: [],
    edges: [],
    groups: [
      {
        id: 'group-empty-smoke',
        title: 'Empty Group Smoke',
        position: { x: 120, y: 120 },
        size: { width: 360, height: 240 }
      }
    ],
    fileReferences: [],
    suppressedFileActivityEdgeIds: [],
    suppressedAutomaticFileArtifactNodeIds: [],
    nextGroupSequence: 2
  });

  await withInterceptedWarningMessages(async (warningCalls) => {
    await dispatchWebviewMessage({
      type: 'webview/deleteGroup',
      payload: { groupId: 'group-empty-smoke' }
    });
    const snapshot = await waitForSnapshot(
      (currentSnapshot) => !currentSnapshot.state.groups.some((group) => group.id === 'group-empty-smoke'),
      10000
    );
    assert.strictEqual(snapshot.state.groups.length, 0);
    assert.strictEqual(warningCalls.length, 0, 'Expected deleting an empty group to skip confirmation.');
  });
}

async function verifyNestedGroupDeletionConfirmationDisclosesRecursiveScope() {
  await setPersistedState({
    version: 1,
    updatedAt: '2026-05-27T00:00:00.000Z',
    nodes: [
      {
        id: 'delete-parent-agent',
        kind: 'agent',
        title: 'Delete Parent Agent',
        status: 'idle',
        summary: '',
        position: { x: 140, y: 160 },
        size: { width: 320, height: 240 },
        groupId: 'group-delete-parent',
        metadata: { agent: { provider: 'codex' } }
      },
      {
        id: 'delete-child-note',
        kind: 'note',
        title: 'Delete Child Note',
        status: 'ready',
        summary: '',
        position: { x: 180, y: 460 },
        size: { width: 320, height: 200 },
        groupId: 'group-delete-child',
        metadata: { note: { content: 'nested delete smoke' } }
      }
    ],
    edges: [],
    groups: [
      {
        id: 'group-delete-parent',
        title: 'Delete Parent',
        position: { x: 100, y: 100 },
        size: { width: 760, height: 680 }
      },
      {
        id: 'group-delete-child',
        title: 'Delete Child',
        position: { x: 140, y: 420 },
        size: { width: 400, height: 260 },
        parentGroupId: 'group-delete-parent'
      }
    ],
    fileReferences: [],
    suppressedFileActivityEdgeIds: [],
    suppressedAutomaticFileArtifactNodeIds: [],
    nextGroupSequence: 3
  });

  await withInterceptedWarningMessages(
    async (warningCalls) => {
      await dispatchWebviewMessage({
        type: 'webview/deleteGroup',
        payload: { groupId: 'group-delete-parent' }
      });

      const snapshot = await waitForSnapshot(
        (currentSnapshot) =>
          currentSnapshot.state.nodes.length === 0 &&
          currentSnapshot.state.groups.length === 0,
        10000
      );
      assert.strictEqual(snapshot.state.edges.length, 0);

      assert.strictEqual(warningCalls.length, 1, 'Expected deleting a non-empty group to show one confirmation.');
      const [warningCall] = warningCalls;
      assert.match(warningCall.message, /Delete Parent/u);
      assert.ok(
        warningCall.items.some((item) => /Delete all contained nodes and subgroups/.test(item.title) && /2 nodes/.test(item.title) && /1 subgroups/.test(item.title)),
        `Expected destructive action title to disclose recursive counts. Items: ${JSON.stringify(warningCall.items)}`
      );
      assert.ok(
        warningCall.items.some((item) => item.title === 'Delete Group Frame Only and Keep Contents'),
        `Expected keep-members action title to disclose preservation. Items: ${JSON.stringify(warningCall.items)}`
      );
      assert.match(warningCall.options?.detail ?? '', /recursively deletes 2 nodes and 1 subgroups/u);
      assert.match(warningCall.options?.detail ?? '', /1 execution nodes will be stopped and their runtime sessions cleaned up first/u);
    },
    ({ items }) => items.find((item) => /Delete all contained nodes and subgroups/.test(item.title))
  );
}

async function verifyCanvasLayoutArrangementPersists() {
  const seededState = {
    version: 1,
    updatedAt: '2026-06-17T00:00:00.000Z',
    nodes: [
      {
        id: 'arrange-root-a-note-a',
        kind: 'note',
        title: 'Arrange Root A Note A',
        status: 'ready',
        summary: '',
        position: { x: 90, y: 90 },
        size: { width: 160, height: 96 },
        groupId: 'arrange-root-a',
        metadata: { note: { content: 'root a note a' } }
      },
      {
        id: 'arrange-root-a-note-b',
        kind: 'note',
        title: 'Arrange Root A Note B',
        status: 'ready',
        summary: '',
        position: { x: 104, y: 104 },
        size: { width: 160, height: 96 },
        groupId: 'arrange-root-a',
        metadata: { note: { content: 'root a note b' } }
      },
      {
        id: 'arrange-inner-note-a',
        kind: 'note',
        title: 'Arrange Inner Note A',
        status: 'ready',
        summary: '',
        position: { x: 120, y: 320 },
        size: { width: 140, height: 80 },
        groupId: 'arrange-inner-group',
        metadata: { note: { content: 'inner a' } }
      },
      {
        id: 'arrange-inner-note-b',
        kind: 'note',
        title: 'Arrange Inner Note B',
        status: 'ready',
        summary: '',
        position: { x: 132, y: 328 },
        size: { width: 140, height: 80 },
        groupId: 'arrange-inner-group',
        metadata: { note: { content: 'inner b' } }
      },
      {
        id: 'arrange-root-b-note',
        kind: 'note',
        title: 'Arrange Root B Note',
        status: 'ready',
        summary: '',
        position: { x: 120, y: 120 },
        size: { width: 160, height: 96 },
        groupId: 'arrange-root-b',
        metadata: { note: { content: 'root b note' } }
      }
    ],
    edges: [
      {
        id: 'arrange-edge-a',
        sourceNodeId: 'arrange-root-a-note-a',
        targetNodeId: 'arrange-root-a-note-b',
        sourceAnchor: 'right',
        targetAnchor: 'left',
        arrowMode: 'forward',
        owner: 'user'
      }
    ],
    groups: [
      {
        id: 'arrange-root-a',
        title: 'Arrange Root A',
        position: { x: 0, y: 0 },
        size: { width: 720, height: 520 },
        role: 'workspace-root',
        workspaceRootPath: '/tmp/dev-session-canvas-arrange-a'
      },
      {
        id: 'arrange-root-b',
        title: 'Arrange Root B',
        position: { x: 60, y: 60 },
        size: { width: 720, height: 520 },
        role: 'workspace-root',
        workspaceRootPath: '/tmp/dev-session-canvas-arrange-b'
      },
      {
        id: 'arrange-inner-group',
        title: 'Arrange Inner Group',
        position: { x: 96, y: 296 },
        size: { width: 260, height: 180 },
        parentGroupId: 'arrange-root-a'
      }
    ],
    fileReferences: [],
    suppressedFileActivityEdgeIds: [],
    suppressedAutomaticFileArtifactNodeIds: [],
    nextGroupSequence: 2
  };

  await setPersistedState(seededState);
  const beforeSnapshot = await getDebugSnapshot();
  const beforeRootB = findGroupById(beforeSnapshot, 'arrange-root-b');

  const arrangedSnapshot = await dispatchWebviewMessage({ type: 'webview/arrangeCanvasLayout' });
  const arrangedRootA = findGroupById(arrangedSnapshot, 'arrange-root-a');
  const arrangedRootB = findGroupById(arrangedSnapshot, 'arrange-root-b');
  const arrangedInnerGroup = findGroupById(arrangedSnapshot, 'arrange-inner-group');
  const arrangedRootNoteA = findNodeById(arrangedSnapshot, 'arrange-root-a-note-a');
  const arrangedRootNoteB = findNodeById(arrangedSnapshot, 'arrange-root-a-note-b');
  const arrangedInnerNoteA = findNodeById(arrangedSnapshot, 'arrange-inner-note-a');
  const arrangedInnerNoteB = findNodeById(arrangedSnapshot, 'arrange-inner-note-b');
  const arrangedRootBNote = findNodeById(arrangedSnapshot, 'arrange-root-b-note');

  assert.notDeepStrictEqual(
    arrangedRootB.position,
    beforeRootB.position,
    'Expected arranging the canvas to move an overlapping workspace root section.'
  );
  assert.strictEqual(arrangedRootNoteA.groupId, 'arrange-root-a');
  assert.strictEqual(arrangedRootNoteB.groupId, 'arrange-root-a');
  assert.strictEqual(arrangedInnerNoteA.groupId, 'arrange-inner-group');
  assert.strictEqual(arrangedInnerNoteB.groupId, 'arrange-inner-group');
  assert.strictEqual(arrangedRootBNote.groupId, 'arrange-root-b');
  assert.strictEqual(arrangedInnerGroup.parentGroupId, 'arrange-root-a');
  assert.strictEqual(arrangedSnapshot.state.edges[0].sourceNodeId, 'arrange-root-a-note-a');
  assert.strictEqual(arrangedSnapshot.state.edges[0].targetNodeId, 'arrange-root-a-note-b');
  assert.strictEqual(
    paddedRectanglesOverlap(arrangedRootA, arrangedRootB, 40),
    false,
    'Expected arranging the canvas to prevent workspace root sections from overlapping.'
  );
  assert.strictEqual(
    paddedRectanglesOverlap(arrangedRootNoteA, arrangedRootNoteB, 40),
    false,
    'Expected arranging the canvas to separate overlapping direct root members.'
  );
  assert.strictEqual(
    paddedRectanglesOverlap(arrangedInnerNoteA, arrangedInnerNoteB, 40),
    false,
    'Expected arranging the canvas to separately organize nodes inside a normal group.'
  );

  const persistedSnapshot = await flushPersistedStateSnapshot();
  assert.deepStrictEqual(
    findNodeById(persistedSnapshot, 'arrange-root-a-note-a').position,
    arrangedRootNoteA.position,
    'Expected the arranged node position to be written to the persisted snapshot.'
  );
  assert.deepStrictEqual(
    findGroupById(persistedSnapshot, 'arrange-root-b').position,
    arrangedRootB.position,
    'Expected the arranged root position to be written to the persisted snapshot.'
  );

  const reloadedSnapshot = await reloadPersistedState();
  assert.deepStrictEqual(
    findNodeById(reloadedSnapshot, 'arrange-inner-note-b').position,
    arrangedInnerNoteB.position,
    'Expected reloading persisted state to keep the arranged normal-group node position.'
  );
  assert.deepStrictEqual(
    findGroupById(reloadedSnapshot, 'arrange-root-b').position,
    arrangedRootB.position,
    'Expected reloading persisted state to keep the arranged root section position.'
  );

  await vscode.commands.executeCommand(COMMAND_IDS.testResetState);
  const resetSnapshot = await ensureEditorCanvasReady();
  assert.strictEqual(resetSnapshot.state.nodes.length, 0, 'Expected layout arrangement smoke seed nodes to be cleaned up.');
  assert.strictEqual(resetSnapshot.state.groups.length, 0, 'Expected layout arrangement smoke seed groups to be cleaned up.');
}

async function applyCanvasTemplateForTest(templateId, reset = false) {
  return vscode.commands.executeCommand(COMMAND_IDS.testApplyCanvasTemplate, templateId, reset);
}

async function saveCanvasTemplateForTest(name, agentProviderMode = 'default', overwriteTemplateId) {
  return vscode.commands.executeCommand(
    COMMAND_IDS.testSaveCanvasAsTemplate,
    name,
    agentProviderMode,
    overwriteTemplateId
  );
}

async function setDefaultCanvasTemplateForTest(templateId) {
  return vscode.commands.executeCommand(COMMAND_IDS.testSetDefaultTemplate, templateId);
}

async function deleteCanvasTemplateForTest(templateId) {
  return vscode.commands.executeCommand(COMMAND_IDS.testDeleteCanvasTemplate, templateId);
}

async function exportCanvasTemplateToPathForTest(templateId, targetPath) {
  return vscode.commands.executeCommand(COMMAND_IDS.testExportCanvasTemplateToPath, templateId, targetPath);
}

async function importCanvasTemplateFromPathForTest(sourcePath, overwriteTemplateId, nameOverride) {
  return vscode.commands.executeCommand(
    COMMAND_IDS.testImportCanvasTemplateFromPath,
    sourcePath,
    overwriteTemplateId,
    nameOverride
  );
}

async function prepareTrustedBaseNodesForAppliedRuntimePersistenceMode(enabled) {
  await setRuntimePersistenceEnabled(enabled);

  let snapshot = await simulateRuntimeReload();
  assert.strictEqual(snapshot.state.nodes.length, 0);
  snapshot = await ensureEditorCanvasReady();
  assert.strictEqual(snapshot.activeSurface, 'editor');

  await vscode.commands.executeCommand(COMMAND_IDS.testCreateNode, 'agent');
  await vscode.commands.executeCommand(COMMAND_IDS.testCreateNode, 'terminal');
  await vscode.commands.executeCommand(COMMAND_IDS.testCreateNode, 'note');

  snapshot = await waitForSnapshot(
    (currentSnapshot) =>
      currentSnapshot.state.nodes.filter((node) => node.kind === 'agent').length === 1 &&
      currentSnapshot.state.nodes.filter((node) => node.kind === 'terminal').length === 1 &&
      currentSnapshot.state.nodes.filter((node) => node.kind === 'note').length === 1,
    20000
  );

  return {
    agentNode: findNodeByKind(snapshot, 'agent'),
    terminalNode: findNodeByKind(snapshot, 'terminal'),
    noteNode: findNodeByKind(snapshot, 'note')
  };
}

async function prepareRestrictedBaseNodesForAppliedRuntimePersistenceMode(enabled) {
  await setRuntimePersistenceEnabled(enabled);

  let snapshot = await simulateRuntimeReload();
  assert.strictEqual(snapshot.state.nodes.length, 0);
  snapshot = await ensureEditorCanvasReady();
  assert.strictEqual(snapshot.activeSurface, 'editor');

  await vscode.commands.executeCommand(COMMAND_IDS.testCreateNode, 'agent');
  await vscode.commands.executeCommand(COMMAND_IDS.testCreateNode, 'terminal');
  await vscode.commands.executeCommand(COMMAND_IDS.testCreateNode, 'note');

  snapshot = await waitForSnapshot(
    (currentSnapshot) =>
      currentSnapshot.state.nodes.filter((node) => node.kind === 'agent').length === 1 &&
      currentSnapshot.state.nodes.filter((node) => node.kind === 'terminal').length === 1 &&
      currentSnapshot.state.nodes.filter((node) => node.kind === 'note').length === 1,
    20000
  );

  return {
    agentNode: findNodeByKind(snapshot, 'agent'),
    terminalNode: findNodeByKind(snapshot, 'terminal'),
    noteNode: findNodeByKind(snapshot, 'note')
  };
}

async function verifyCanvasTemplatesTrusted() {
  let templateCatalog = await getCanvasTemplateCatalog();
  assert.strictEqual(templateCatalog.defaultTemplateId, 'builtin-getting-started');
  assert.strictEqual(
    templateCatalog.templates.filter((entry) => entry.template.category === 'builtin').length,
    2
  );
  assert.deepStrictEqual(templateCatalog.issues, []);

  await vscode.commands.executeCommand(COMMAND_IDS.testResetState);
  await ensureEditorCanvasReady();

  await dispatchWebviewMessage({
    type: 'webview/createDemoNode',
    payload: {
      kind: 'note',
      preferredPosition: { x: 0, y: 0 }
    }
  });

  let snapshot = await waitForSnapshot(
    (currentSnapshot) => currentSnapshot.state.nodes.length === 1,
    20000
  );
  const baselineNote = findNodeByKind(snapshot, 'note');

  await dispatchWebviewMessage({
    type: 'webview/applyTemplate',
    payload: {
      templateId: 'builtin-basic-workflow',
      visibleCenter: { x: 0, y: 0 }
    }
  });
  snapshot = await waitForSnapshot(
    (currentSnapshot) =>
      currentSnapshot.state.nodes.length === 4 &&
      currentSnapshot.state.nodes.filter((node) => node.kind === 'agent').length === 1 &&
      currentSnapshot.state.nodes.filter((node) => node.kind === 'terminal').length === 1 &&
      currentSnapshot.state.nodes.filter((node) => node.kind === 'note').length === 2,
    20000
  );

  for (const newNode of snapshot.state.nodes.filter((node) => node.id !== baselineNote.id)) {
    assert.ok(
      !rectanglesOverlap(baselineNote, newNode),
      `Expected template apply to avoid overlapping baseline note ${baselineNote.id} with ${newNode.id}.`
    );
  }

  await vscode.commands.executeCommand(COMMAND_IDS.testResetState);
  await ensureEditorCanvasReady();

  await vscode.commands.executeCommand(COMMAND_IDS.testCreateNode, 'agent');
  await vscode.commands.executeCommand(COMMAND_IDS.testCreateNode, 'terminal');
  await vscode.commands.executeCommand(COMMAND_IDS.testCreateNode, 'note');

  snapshot = await waitForSnapshot(
    (currentSnapshot) =>
      currentSnapshot.state.nodes.filter((node) => node.kind === 'agent').length === 1 &&
      currentSnapshot.state.nodes.filter((node) => node.kind === 'terminal').length === 1 &&
      currentSnapshot.state.nodes.filter((node) => node.kind === 'note').length === 1,
    20000
  );

  const agentNode = findNodeByKind(snapshot, 'agent');
  const terminalNode = findNodeByKind(snapshot, 'terminal');
  const noteNode = findNodeByKind(snapshot, 'note');

  await dispatchWebviewMessage({
    type: 'webview/updateNodeTitle',
    payload: {
      nodeId: agentNode.id,
      title: 'Template Save Agent'
    }
  });
  await dispatchWebviewMessage({
    type: 'webview/updateNodeTitle',
    payload: {
      nodeId: terminalNode.id,
      title: 'Template Save Terminal'
    }
  });
  await dispatchWebviewMessage({
    type: 'webview/updateNodeTitle',
    payload: {
      nodeId: noteNode.id,
      title: 'Template Save Note'
    }
  });
  await dispatchWebviewMessage({
    type: 'webview/updateNoteNode',
    payload: {
      nodeId: noteNode.id,
      content: 'Template note body'
    }
  });
  await dispatchWebviewMessage({
    type: 'webview/createEdge',
    payload: {
      sourceNodeId: agentNode.id,
      targetNodeId: terminalNode.id,
      sourceAnchor: 'right',
      targetAnchor: 'left'
    }
  });

  snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentNote = currentSnapshot.state.nodes.find((node) => node.id === noteNode.id);
    return (
      currentSnapshot.state.edges.length === 1 &&
      currentSnapshot.state.nodes.some((node) => node.title === 'Template Save Agent') &&
      currentSnapshot.state.nodes.some((node) => node.title === 'Template Save Terminal') &&
      currentSnapshot.state.nodes.some((node) => node.title === 'Template Save Note') &&
      currentNote?.metadata?.note?.content === 'Template note body'
    );
  }, 20000);

  const savedTemplateName = `Smoke Saved Template ${Date.now()}`;
  const savedTemplate = await saveCanvasTemplateForTest(savedTemplateName, 'default');
  assert.strictEqual(savedTemplate.template.name, savedTemplateName);
  assert.strictEqual(savedTemplate.template.category, 'user');

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(workspaceFolder, 'Expected an open workspace folder for canvas template smoke.');
  const scratchDir = path.join(workspaceFolder.uri.fsPath, '.debug', 'vscode-smoke', 'canvas-templates');
  await fs.mkdir(scratchDir, { recursive: true });
  const exportPath = path.join(scratchDir, 'saved-template.json');
  await exportCanvasTemplateToPathForTest(savedTemplate.template.id, exportPath);
  assert.ok(fsSync.existsSync(exportPath), 'Expected exported canvas template JSON to exist.');

  await vscode.commands.executeCommand(COMMAND_IDS.testResetState);
  await ensureEditorCanvasReady();
  await applyCanvasTemplateForTest(savedTemplate.template.id);

  snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentAgent = currentSnapshot.state.nodes.find((node) => node.title === 'Template Save Agent');
    const currentTerminal = currentSnapshot.state.nodes.find((node) => node.title === 'Template Save Terminal');
    const currentNote = currentSnapshot.state.nodes.find((node) => node.title === 'Template Save Note');
    return Boolean(
      currentSnapshot.state.nodes.length === 3 &&
      currentSnapshot.state.edges.length === 1 &&
      currentAgent &&
      currentAgent.status === 'idle' &&
      currentAgent.metadata?.agent?.liveSession === false &&
      currentAgent.metadata?.agent?.pendingLaunch === undefined &&
      currentTerminal &&
      currentTerminal.status === 'idle' &&
      currentTerminal.metadata?.terminal?.liveSession === false &&
      currentTerminal.metadata?.terminal?.pendingLaunch === undefined &&
      currentNote?.metadata?.note?.content === 'Template note body'
    );
  }, 20000);

  await setDefaultCanvasTemplateForTest(savedTemplate.template.id);
  await waitForHostMessages((messages) =>
    messages.some(
      (message) =>
        message.type === 'host/templateCatalogUpdated' &&
        message.payload.templates.some(
          (templateEntry) => templateEntry.templateId === savedTemplate.template.id && templateEntry.isDefault
        )
    )
  );
  templateCatalog = await getCanvasTemplateCatalog();
  assert.strictEqual(templateCatalog.defaultTemplateId, savedTemplate.template.id);

  await vscode.commands.executeCommand(COMMAND_IDS.testResetState);
  await ensureEditorCanvasReady();
  await dispatchWebviewMessage({
    type: 'webview/createDemoNode',
    payload: {
      kind: 'note',
      preferredPosition: { x: 0, y: 0 }
    }
  });
  await waitForSnapshot((currentSnapshot) => currentSnapshot.state.nodes.length === 1, 20000);

  await vscode.commands.executeCommand(COMMAND_IDS.applyDefaultTemplate);
  snapshot = await waitForSnapshot(
    (currentSnapshot) =>
      currentSnapshot.state.nodes.length === 4 &&
      currentSnapshot.state.nodes.some((node) => node.title === 'Template Save Agent') &&
      currentSnapshot.state.nodes.some((node) => node.title === 'Template Save Terminal') &&
      currentSnapshot.state.nodes.some((node) => node.title === 'Template Save Note'),
    20000
  );
  assert.strictEqual(snapshot.state.nodes.filter((node) => node.kind === 'note').length, 2);

  await withInterceptedWarningMessages(
    async (warningCalls) => {
      await dispatchWebviewMessage({
        type: 'webview/resetToTemplate',
        payload: {
          templateId: savedTemplate.template.id,
          visibleCenter: { x: 0, y: 0 }
        }
      });
      snapshot = await waitForSnapshot(
        (currentSnapshot) =>
          currentSnapshot.state.nodes.length === 3 &&
          currentSnapshot.state.edges.length === 1 &&
          currentSnapshot.state.nodes.some((node) => node.title === 'Template Save Agent') &&
          currentSnapshot.state.nodes.some((node) => node.title === 'Template Save Terminal') &&
          currentSnapshot.state.nodes.some((node) => node.title === 'Template Save Note'),
        20000
      );
      assert.strictEqual(warningCalls.length, 1);
      assert.match(String(warningCalls[0].message), /Resetting will clear the current Canvas objects/);
    },
    ({ items }) => items.find((item) => item === 'Continue Reset')
  );
  assert.strictEqual(snapshot.state.nodes.filter((node) => node.kind === 'note').length, 1);

  await deleteCanvasTemplateForTest(savedTemplate.template.id);
  templateCatalog = await getCanvasTemplateCatalog();
  assert.strictEqual(templateCatalog.defaultTemplateId, 'builtin-getting-started');
  assert.ok(!templateCatalog.templates.some((entry) => entry.template.id === savedTemplate.template.id));

  const importedTemplateName = `Imported Smoke Template ${Date.now()}`;
  const importedTemplate = await importCanvasTemplateFromPathForTest(exportPath, undefined, importedTemplateName);
  assert.strictEqual(importedTemplate.template.name, importedTemplateName);

  templateCatalog = await getCanvasTemplateCatalog();
  assert.ok(templateCatalog.templates.some((entry) => entry.template.id === importedTemplate.template.id));

  await deleteCanvasTemplateForTest(importedTemplate.template.id);
  templateCatalog = await getCanvasTemplateCatalog();
  assert.strictEqual(templateCatalog.defaultTemplateId, 'builtin-getting-started');

  await vscode.commands.executeCommand(COMMAND_IDS.testResetState);
}

async function verifyCanvasTemplatesRestricted() {
  const templateCatalog = await getCanvasTemplateCatalog();
  assert.strictEqual(templateCatalog.defaultTemplateId, 'builtin-getting-started');
  assert.strictEqual(
    templateCatalog.templates.filter((entry) => entry.template.category === 'builtin').length,
    2
  );

  await applyCanvasTemplateForTest('builtin-getting-started');
  let snapshot = await waitForSnapshot(
    (currentSnapshot) =>
      currentSnapshot.state.nodes.length === 1 &&
      currentSnapshot.state.nodes.every((node) => node.kind === 'note'),
    20000
  );
  assert.ok(snapshot.state.nodes.every((node) => node.kind === 'note'));

  await assert.rejects(
    () => applyCanvasTemplateForTest('builtin-basic-workflow'),
    /Only Note-only templates can be applied/
  );

  await vscode.commands.executeCommand(COMMAND_IDS.testResetState);
  snapshot = await getDebugSnapshot();
  assert.strictEqual(snapshot.state.nodes.length, 0);
}

async function runTrustedSmoke() {
  await vscode.commands.executeCommand(COMMAND_IDS.openCanvas);
  await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'panel', 20000);
  await clearHostMessages();

  let snapshot = await getDebugSnapshot();
  assert.strictEqual(snapshot.activeSurface, 'panel');
  assert.strictEqual(snapshot.sidebar.configuredSurface, 'panel');
  assert.strictEqual(snapshot.sidebar.surfaceLocation, 'panel');
  assert.strictEqual(snapshot.surfaceReady.panel, true);
  assert.strictEqual(snapshot.state.nodes.length, 0);

  await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInEditor);
  await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'editor', 20000);
  await clearHostMessages();

  snapshot = await getDebugSnapshot();
  assert.strictEqual(snapshot.activeSurface, 'editor');
  assert.strictEqual(snapshot.sidebar.configuredSurface, 'panel');
  assert.strictEqual(snapshot.sidebar.canvasSurface, 'visible');
  assert.strictEqual(snapshot.sidebar.surfaceLocation, 'editor');
  assert.strictEqual(snapshot.sidebar.workspaceTrusted, true);
  assert.strictEqual(snapshot.surfaceReady.editor, true);
  assert.strictEqual(snapshot.state.nodes.length, 0);

  const sidebarSummaryItems = await getSidebarSummaryItems();
  assert.deepStrictEqual(
    sidebarSummaryItems.map((item) => item.id),
    [
      'summary/workspace-trust',
      'summary/canvas-surface',
      'summary/runtime-persistence',
      'summary/notification-mode',
      'summary/files-feature',
      'summary/node-count',
      'summary/running-executions',
      'summary/terminal-shell',
      'summary/codex-cli',
      'summary/claude-cli'
    ]
  );
  assert.strictEqual(findSidebarSummaryItem(sidebarSummaryItems, 'summary/terminal-shell').command?.command, COMMAND_IDS.selectTerminalShell);
  assert.strictEqual(findSidebarSummaryItem(sidebarSummaryItems, 'summary/codex-cli').command?.command, COMMAND_IDS.selectCodexCli);
  assert.strictEqual(findSidebarSummaryItem(sidebarSummaryItems, 'summary/claude-cli').command?.command, COMMAND_IDS.selectClaudeCli);
  assert.strictEqual(findSidebarSummaryItem(sidebarSummaryItems, 'summary/codex-cli').contextValue, 'codexCliConfig');
  assert.strictEqual(findSidebarSummaryItem(sidebarSummaryItems, 'summary/claude-cli').contextValue, 'claudeCliConfig');
  const canvasSurfaceSummaryItem = findSidebarSummaryItem(sidebarSummaryItems, 'summary/canvas-surface');
  assert.strictEqual(canvasSurfaceSummaryItem.description, 'Open · Editor');
  assert.match(canvasSurfaceSummaryItem.tooltip, /Current instance surface: Editor\./);
  assert.match(canvasSurfaceSummaryItem.tooltip, /Default surface: Panel\./);
  const notificationModeSummaryItem = findSidebarSummaryItem(sidebarSummaryItems, 'summary/notification-mode');
  assert.strictEqual(
    notificationModeSummaryItem.description,
    'System notifications · all attention · Title Bar + Minimap boost · Text abnormal alerts off'
  );
  assert.match(
    notificationModeSummaryItem.tooltip,
    /Enabled attention signals: BEL, OSC 9, OSC 777, Agent abnormal exit, Codex abnormal text\./
  );

  await verifyCanvasTemplatesTrusted();
  await ensureEditorCanvasReady();
  await clearHostMessages();
  await clearDiagnosticEvents();

  await verifyCodexSessionIdLocator();
  await verifyClaudeSessionIdLocator();
  await verifyCodexResumeCommandHintParser();
  await verifyClaudeResumeCommandHintParser();
  await verifyAgentCliCacheIsolation();

  await dispatchWebviewMessage({ type: 'webview/not-a-real-message' });
  let hostMessages = await getHostMessages();
  assert.ok(
    hostMessages.some(
      (message) =>
        message.type === 'host/error' &&
        message.payload.message === UNKNOWN_WEBVIEW_MESSAGE_ERROR
    )
  );
  let probe = await waitForWebviewProbeOnSurface(
    'editor',
    (currentProbe) => currentProbe.toastMessage === UNKNOWN_WEBVIEW_MESSAGE_ERROR,
    10000
  );
  assert.strictEqual(probe.toastMessage, UNKNOWN_WEBVIEW_MESSAGE_ERROR);
  probe = await waitForWebviewProbeOnSurface('editor', (currentProbe) => currentProbe.toastMessage === null, 10000);
  assert.strictEqual(probe.toastMessage, null);
  snapshot = await getDebugSnapshot();
  assert.strictEqual(snapshot.state.nodes.length, 0);

  await verifyRuntimeContextRefreshesDefaultAgentProvider();
  await verifyRuntimeContextRefreshesTerminalScrollback();
  await verifyTerminalShellPathRefreshesStoppedTerminalNode();
  await verifySelectTerminalShellCommandPersistsExactDetectedPath();
  await verifySelectTerminalShellCommandUpdatesWorkspaceOverride();
  await verifyDefaultSurfaceRequiresReload();
  await verifyCreateNodeCommandQuickPick();
  await verifyDefaultExecutionNodeMetadataUsesWorkspaceRoot();
  await verifyWorkspaceRelativeTerminalShellPathUsesWorkspaceRoot();
  await verifyExplorerResourceExecutionNodeCreation();
  await verifyCreateNodeCommandUsesOpenCanvasSurface();
  await verifyCreateNodeCommandQuickPickKeepsSelectedModeUntilUserEdits();
  await verifyCreateNodeCommandQuickPickPreservesExplicitPresetIntent();
  await verifyPersistedStateFiltersLegacyTaskNodes();
  await clearHostMessages();
  await clearDiagnosticEvents();
  snapshot = await getDebugSnapshot();
  assert.strictEqual(snapshot.state.nodes.length, 0);

  await verifyEmptyGroupDeletionSkipsConfirmation();
  await verifyNestedGroupDeletionConfirmationDisclosesRecursiveScope();
  await verifyCanvasLayoutArrangementPersists();
  await clearHostMessages();
  await createBaseNodes();
  snapshot = await getDebugSnapshot();
  assert.deepStrictEqual(
    snapshot.state.nodes.map((node) => node.kind).sort(),
    ['agent', 'note', 'terminal']
  );

  const noteNode = findNodeByKind(snapshot, 'note');
  const terminalNode = findNodeByKind(snapshot, 'terminal');
  const agentNode = findNodeByKind(snapshot, 'agent');
  await dispatchWebviewMessage({
    type: 'webview/updateNodeTitle',
    payload: {
      nodeId: noteNode.id,
      title: 'Host Smoke Note'
    }
  });
  await dispatchWebviewMessage({
    type: 'webview/updateNoteNode',
    payload: {
      nodeId: noteNode.id,
      content: 'Exercise the real webview-to-host update path.'
    }
  });
  await dispatchWebviewMessage({
    type: 'webview/moveNode',
    payload: {
      id: noteNode.id,
      position: {
        x: 680,
        y: 260
      }
    }
  });

  snapshot = await getDebugSnapshot();
  assert.strictEqual(findNodeById(snapshot, noteNode.id).title, 'Host Smoke Note');
  assert.strictEqual(
    findNodeById(snapshot, noteNode.id).metadata.note.content,
    'Exercise the real webview-to-host update path.'
  );
  assert.deepStrictEqual(findNodeById(snapshot, noteNode.id).position, { x: 680, y: 260 });
  await verifySidebarNodeList(agentNode.id, terminalNode.id, noteNode.id);
  await verifySidebarNodeListQuickPick(agentNode.id, terminalNode.id, noteNode.id, {
    expectAgentSessionId: false
  });
  await verifySidebarNodeListWebviewUi(agentNode.id);

  await verifyRealWebviewProbe(agentNode.id, terminalNode.id, noteNode.id);
  await verifyRealWebviewDomInteractions(agentNode.id, terminalNode.id, noteNode.id);
  await verifyInteractiveNoteChecklist(noteNode.id);
  await verifyNoteWorkspaceFileLinks(noteNode.id);
  await verifyNoteMarkdownFileAssociation();
  await verifyNodeResizePersistence(agentNode.id, terminalNode.id, noteNode.id);
  await verifyAutoStartOnCreate(agentNode.id, terminalNode.id);
  await verifyAgentExecutionFlow(agentNode.id);
  await verifySidebarNodeListQuickPick(agentNode.id, terminalNode.id, noteNode.id, {
    expectAgentSessionId: true
  });
  await verifyTerminalExecutionFlow(terminalNode.id);
  await verifyLegacyAttentionNotificationBridgeMigration();
  await verifyExecutionAttentionNotificationBridge(agentNode.id, noteNode.id);
  await verifyAgentAbnormalInterruptionNotifications();
  await verifyExecutionTerminalNativeInteractions(terminalNode.id);
  await verifyRuntimeReloadPreservesConfiguredTerminalScrollbackHistory(terminalNode.id);
  await verifyEditorTerminalTabSwitchPreservesViewport(terminalNode.id);
  await verifyPanelTerminalTabSwitchPreservesViewport(terminalNode.id);
  await verifyEmbeddedTerminalThemeFollowWorkbench(agentNode.id, terminalNode.id);
  await verifyRuntimeReloadRecovery(agentNode.id, terminalNode.id);
  await verifyLiveSessionCutoverAndReload(terminalNode.id);
  await verifyPtyRobustness(agentNode.id, terminalNode.id);
  await verifyTerminalFloodKeepsCanvasResponsive(agentNode.id, terminalNode.id, noteNode.id);
  await verifyFailurePaths(agentNode.id, terminalNode.id, noteNode.id);
  await verifyPersistenceAndRecovery(noteNode.id, agentNode.id, terminalNode.id);
  await verifyStandbySurfaceIgnoresMessages(noteNode.id);
  await verifyPendingWebviewRequestFaultInjection(noteNode.id);
  await verifyStopVsQueuedExitRace(agentNode.id);
  await verifyClaudeStopRestoresPreviousSignal();
  await verifyClaudeExplicitSessionIdPreservesResumeContext();
  let runtimePersistenceNodes = await prepareTrustedBaseNodesForAppliedRuntimePersistenceMode(true);
  await verifyLiveRuntimePersistence(runtimePersistenceNodes.agentNode.id, runtimePersistenceNodes.terminalNode.id);
  await verifyLiveRuntimeReloadPreservesUpdatedTerminalScrollbackHistory(runtimePersistenceNodes.terminalNode.id);
  await verifyLiveRuntimeReconnectFallbackToResume(
    runtimePersistenceNodes.agentNode.id,
    runtimePersistenceNodes.terminalNode.id
  );
  await verifyHistoryRestoredResumeReadyIgnoresStaleResumeSupported(
    runtimePersistenceNodes.agentNode.id,
    runtimePersistenceNodes.terminalNode.id
  );
  await verifyLiveRuntimeResumeExitClassification(runtimePersistenceNodes.agentNode.id);
  await verifyImmediateReloadAfterLiveRuntimeLaunch(
    runtimePersistenceNodes.agentNode.id,
    runtimePersistenceNodes.terminalNode.id
  );

  runtimePersistenceNodes = await prepareTrustedBaseNodesForAppliedRuntimePersistenceMode(false);
  await verifyHostBoundaryFlushesRecentLocalState(
    runtimePersistenceNodes.agentNode.id,
    runtimePersistenceNodes.terminalNode.id
  );
  await verifyTrustedDiagnostics(runtimePersistenceNodes.agentNode.id, runtimePersistenceNodes.terminalNode.id);
  await verifyRealDeleteButton(runtimePersistenceNodes.noteNode.id);

  snapshot = await getDebugSnapshot();
  assert.strictEqual(snapshot.state.nodes.some((node) => node.id === runtimePersistenceNodes.noteNode.id), false);
  assert.strictEqual(snapshot.state.nodes.length, 2);

  await verifyManualEdgeLifecycle(runtimePersistenceNodes.agentNode.id, runtimePersistenceNodes.terminalNode.id);
  await verifyFileActivityViewsAndOpenFiles();
  await verifyReadExitFileActivityDrain();
  await verifyRuntimePersistenceRequiresReloadAndClearsState();
  await verifySidebarSessionHistoryRestore();
  await verifySidebarSessionHistoryForkActionUi();
  await verifyCodexAgentBranchFromCurrentNode();
  await verifyClaudeAgentBranchFromCurrentNode();
  await verifyAgentBranchRejectsUnsupportedSources();
  await verifySidebarSessionHistorySearchByTitleUi();
  await verifySidebarSessionHistoryDoubleClickUi();

  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
}
async function verifySidebarNodeList(agentNodeId, terminalNodeId, noteNodeId) {
  const baselineSnapshot = await waitForSnapshot((currentSnapshot) => {
    const currentAgent = currentSnapshot.state.nodes.find((node) => node.id === agentNodeId);
    return Boolean(currentAgent?.metadata?.agent?.liveSession && currentAgent.status === 'waiting-input');
  }, 20000);
  const baselineAgentNode = baselineSnapshot.state.nodes.find((node) => node.id === agentNodeId);
  assert.ok(baselineAgentNode?.kind === 'agent', 'Expected the trusted smoke agent node to be present.');
  const nodeItems = await getSidebarNodeListItems();
  assert.deepStrictEqual(
    nodeItems.map((item) => item.nodeId).sort(),
    [agentNodeId, noteNodeId, terminalNodeId].sort()
  );
  assert.ok(
    nodeItems.every((item) => !/file/i.test(item.id)),
    'Expected sidebar node list to exclude file and file-list projections.'
  );
  assert.strictEqual(
    nodeItems.find((item) => item.nodeId === agentNodeId)?.markerColor,
    '#22c55e',
    'Expected agent sidebar nodes to expose the shared green marker color.'
  );
  assert.ok(
    nodeItems.every((item) => item.description === item.status),
    'Expected sidebar node descriptions to stay aligned with the rendered second-line text.'
  );
  assert.match(
    nodeItems.find((item) => item.nodeId === agentNodeId)?.status ?? '',
    / · (Codex|Claude Code) · /,
    'Expected Agent sidebar rows to include cwd, provider and status in the second line.'
  );

  await clearHostMessages();
  await vscode.commands.executeCommand(COMMAND_IDS.focusSidebarNode, noteNodeId);
  const hostMessages = await getHostMessages();
  assert.ok(
    hostMessages.some(
      (message) => message.type === 'host/focusNode' && message.payload?.nodeId === noteNodeId
    ),
    'Expected focusing a sidebar node item to forward a host/focusNode request to the active canvas surface.'
  );

  const sanitizedAgentNodeId = `${agentNodeId}-sidebar-sanitized`;
  const sanitizedSummarySnapshot = await setPersistedState({
    ...baselineSnapshot.state,
    nodes: [
      ...baselineSnapshot.state.nodes,
      {
        ...baselineAgentNode,
        id: sanitizedAgentNodeId,
        status: 'waiting-input',
        summary: '\u009b?2026| [?2026| Ready for input',
        metadata: baselineAgentNode.metadata?.agent
          ? {
              ...baselineAgentNode.metadata,
              agent: {
                ...baselineAgentNode.metadata.agent,
                lifecycle: 'waiting-input',
                persistenceMode: 'snapshot-only',
                attachmentState: 'history-restored',
                liveSession: false,
                runtimeSessionId: undefined,
                pendingLaunch: undefined,
                attentionPending: true
              }
            }
          : baselineAgentNode.metadata
      }
    ]
  });
  const sanitizedNodeItems = await getSidebarNodeListItems();
  const sanitizedAgentItem = sanitizedNodeItems.find((item) => item.nodeId === sanitizedAgentNodeId);
  assert.ok(sanitizedAgentItem, 'Expected the seeded agent node to remain visible in the sidebar node list.');
  assert.strictEqual(sanitizedAgentItem.summary, 'Ready for input');
  assert.strictEqual(
    sanitizedAgentItem.description,
    sanitizedAgentItem.status,
    'Expected sidebar node descriptions to remain aligned with the rendered second-line text after summary sanitization.'
  );
  assert.match(
    sanitizedAgentItem.status,
    / · (Codex|Claude Code) · Waiting for input$/,
    'Expected sanitized Agent sidebar rows to keep cwd, provider and status in the second line.'
  );
  assert.ok(
    !sanitizedAgentItem.tooltip.includes('[?2026|'),
    'Expected sidebar node tooltips to hide leaked terminal control fragments.'
  );
  assert.strictEqual(sanitizedAgentItem.attentionPending, true);

  await setPersistedState(baselineSnapshot.state);
  assert.ok(
    sanitizedSummarySnapshot.state.nodes.some((node) => node.id === sanitizedAgentNodeId),
    'Expected seeded persisted state update to keep the target agent node present.'
  );
}

async function verifySidebarNodeListQuickPick(
  agentNodeId,
  terminalNodeId,
  noteNodeId,
  { expectAgentSessionId }
) {
  const snapshot = await getDebugSnapshot();
  const agentNode = findNodeById(snapshot, agentNodeId);
  const terminalNode = findNodeById(snapshot, terminalNodeId);
  const noteNode = findNodeById(snapshot, noteNodeId);
  const sidebarItems = await getSidebarNodeListItems();
  const sidebarItemsByNodeId = new Map(sidebarItems.map((item) => [item.nodeId, item]));

  await withInterceptedQuickPicks(async (quickPickCalls) => {
    await vscode.commands.executeCommand(COMMAND_IDS.showNodeList);
    assert.strictEqual(quickPickCalls.length, 1, 'Expected showNodeList to open one QuickPick.');

    const [quickPickCall] = quickPickCalls;
    const agentPickItem = quickPickCall.items.find((item) => item.nodeId === agentNodeId);
    const terminalPickItem = quickPickCall.items.find((item) => item.nodeId === terminalNodeId);
    const notePickItem = quickPickCall.items.find((item) => item.nodeId === noteNodeId);

    assert.ok(agentPickItem, 'Expected the Agent node to appear in the node QuickPick.');
    assert.ok(terminalPickItem, 'Expected the Terminal node to appear in the node QuickPick.');
    assert.ok(notePickItem, 'Expected the Note node to appear in the node QuickPick.');

    assert.strictEqual(agentPickItem.label, sidebarItemsByNodeId.get(agentNodeId)?.label);
    assert.strictEqual(terminalPickItem.label, sidebarItemsByNodeId.get(terminalNodeId)?.label);
    assert.strictEqual(notePickItem.label, sidebarItemsByNodeId.get(noteNodeId)?.label);

    assert.strictEqual(
      agentPickItem.description,
      formatExpectedSidebarNodeQuickPickDescription(sidebarItemsByNodeId.get(agentNodeId))
    );
    assert.strictEqual(
      terminalPickItem.description,
      formatExpectedSidebarNodeQuickPickDescription(sidebarItemsByNodeId.get(terminalNodeId))
    );
    assert.strictEqual(
      notePickItem.description,
      formatExpectedSidebarNodeQuickPickDescription(sidebarItemsByNodeId.get(noteNodeId))
    );

    assert.strictEqual(
      agentPickItem.detail,
      buildExpectedSidebarNodeQuickPickDetail(agentNode, { expectSessionId: expectAgentSessionId })
    );
    assert.strictEqual(terminalPickItem.detail, buildExpectedSidebarNodeQuickPickDetail(terminalNode));
    assert.strictEqual(notePickItem.detail, buildExpectedSidebarNodeQuickPickDetail(noteNode));
  });
}

async function verifySidebarNodeListWebviewUi(agentNodeId) {
  const baselineSnapshot = await getDebugSnapshot();
  const seededSnapshot = await setPersistedState({
    ...baselineSnapshot.state,
    nodes: baselineSnapshot.state.nodes.map((node) =>
      node.id === agentNodeId
        ? {
            ...node,
            summary: '等待处理通知',
            metadata: node.metadata?.agent
              ? {
                  ...node.metadata,
                  agent: {
                    ...node.metadata.agent,
                    attentionPending: true
                  }
                }
              : node.metadata
          }
        : node
    )
  });

  try {
    await clearHostMessages();
    const actionSnapshot = await performSidebarNodeListAction(
      {
        kind: 'clickItem',
        itemId: `node/${agentNodeId}`
      },
      10000
    );
    assert.ok(
      actionSnapshot.visibleItemIds.includes(`node/${agentNodeId}`),
      'Expected the sidebar node list UI action to target a visible node row.'
    );
    assert.strictEqual(
      actionSnapshot.selectedId,
      `node/${agentNodeId}`,
      'Expected clicking a sidebar node row to keep that node selected in the webview list.'
    );
    assert.ok(
      actionSnapshot.attentionItemIds.includes(`node/${agentNodeId}`),
      'Expected the sidebar node list UI snapshot to report the node with a visible attention indicator.'
    );

    const hostMessages = await waitForHostMessages(
      (messages) => messages.some((message) => message.type === 'host/focusNode' && message.payload?.nodeId === agentNodeId),
      5000
    );
    assert.ok(
      hostMessages.some(
        (message) => message.type === 'host/focusNode' && message.payload?.nodeId === agentNodeId
      ),
      'Expected clicking a sidebar node row in the webview list to forward a host/focusNode request.'
    );
  } finally {
    await setPersistedState(baselineSnapshot.state);
  }

  assert.ok(
    seededSnapshot.state.nodes.some((node) => node.id === agentNodeId),
    'Expected the seeded sidebar node UI state to keep the target agent node present.'
  );

  await verifySidebarNodeGroupedTreeUi(agentNodeId);
}

async function verifySidebarNodeGroupedTreeUi(agentNodeId) {
  const baselineSnapshot = await getDebugSnapshot();
  const agentNode = findNodeById(baselineSnapshot, agentNodeId);
  const terminalNode = findNodeByKind(baselineSnapshot, 'terminal');
  const noteNode = findNodeByKind(baselineSnapshot, 'note');
  const groupedState = {
    ...baselineSnapshot.state,
    nodes: baselineSnapshot.state.nodes.map((node) => {
      if (node.id === agentNode.id) {
        return {
          ...node,
          position: { x: 40, y: 80 },
          groupId: 'group-frontend-smoke'
        };
      }
      if (node.id === terminalNode.id) {
        return {
          ...node,
          position: { x: 420, y: 80 },
          groupId: 'group-frontend-smoke'
        };
      }
      if (node.id === noteNode.id) {
        return {
          ...node,
          position: { x: 1000, y: 80 },
          groupId: undefined
        };
      }
      return node;
    }),
    groups: [
      ...(baselineSnapshot.state.groups ?? []),
      {
        id: 'group-feature-smoke',
        title: 'Feature Work',
        position: { x: -40, y: -56 },
        size: { width: 980, height: 520 }
      },
      {
        id: 'group-frontend-smoke',
        title: 'Frontend',
        parentGroupId: 'group-feature-smoke',
        position: { x: 0, y: 0 },
        size: { width: 900, height: 400 }
      }
    ],
    nextGroupSequence: Math.max(baselineSnapshot.state.nextGroupSequence ?? 1, 3)
  };

  try {
    await setPersistedState(groupedState);
    const sidebarItems = await getSidebarNodeListItems();
    const agentItem = sidebarItems.find((item) => item.nodeId === agentNode.id);
    assert.ok(agentItem, 'Expected grouped sidebar items to include the agent node.');
    assert.deepStrictEqual(agentItem.groupPath, ['Feature Work', 'Frontend']);
    assert.deepStrictEqual(agentItem.groupPathIds, ['group-feature-smoke', 'group-frontend-smoke']);

    await vscode.commands.executeCommand(COMMAND_IDS.setSidebarNodeListGroupedView);
    await sleep(100);
    const groupedSnapshot = await performSidebarNodeListAction({
      kind: 'clickItem',
      itemId: `node/${agentNode.id}`
    }, 10000);
    assert.strictEqual(groupedSnapshot.viewMode, 'grouped');
    assert.ok(
      groupedSnapshot.groupRows.some((row) => row.key === 'group-feature-smoke' && row.label === 'Feature Work' && row.expanded),
      'Expected grouped sidebar mode to render the parent group as an expanded tree row.'
    );
    assert.ok(
      groupedSnapshot.groupRows.some((row) => row.key === 'group-frontend-smoke' && row.label === 'Frontend' && row.expanded),
      'Expected grouped sidebar mode to render the nested group as an expanded tree row.'
    );
    assert.ok(
      groupedSnapshot.groupRows.some((row) => row.key === '__ungrouped__' && row.label === 'Ungrouped'),
      'Expected grouped sidebar mode to keep ungrouped nodes in a collapsible section.'
    );
    assert.ok(
      groupedSnapshot.visibleItemIds.includes(`node/${agentNode.id}`),
      'Expected grouped sidebar mode to show nodes inside expanded groups.'
    );
    assert.ok(
      groupedSnapshot.visibleItemIds.includes(`node/${noteNode.id}`),
      'Expected grouped sidebar mode to show ungrouped nodes while the ungrouped section is expanded.'
    );

    const collapsedFrontend = await performSidebarNodeListAction({
      kind: 'toggleGroup',
      groupKey: 'group-frontend-smoke'
    }, 10000);
    assert.ok(
      collapsedFrontend.groupRows.some((row) => row.key === 'group-frontend-smoke' && !row.expanded),
      'Expected clicking a group row to collapse that sidebar group section.'
    );
    assert.ok(
      !collapsedFrontend.visibleItemIds.includes(`node/${agentNode.id}`),
      'Expected collapsing a group row to hide its direct member nodes in the sidebar.'
    );
    assert.ok(
      collapsedFrontend.visibleItemIds.includes(`node/${noteNode.id}`),
      'Expected collapsing a nested group to leave unrelated ungrouped rows visible.'
    );

    const collapsedUngrouped = await performSidebarNodeListAction({
      kind: 'toggleGroup',
      groupKey: '__ungrouped__'
    }, 10000);
    assert.ok(
      collapsedUngrouped.groupRows.some((row) => row.key === '__ungrouped__' && !row.expanded),
      'Expected the ungrouped sidebar section to be collapsible as well.'
    );
    assert.ok(
      !collapsedUngrouped.visibleItemIds.includes(`node/${noteNode.id}`),
      'Expected collapsing the ungrouped section to hide ungrouped node rows.'
    );

    await vscode.commands.executeCommand(COMMAND_IDS.setSidebarNodeListFlatView);
    await sleep(100);
    const flatSnapshot = await performSidebarNodeListAction({
      kind: 'clickItem',
      itemId: `node/${agentNode.id}`
    }, 10000);
    assert.strictEqual(flatSnapshot.viewMode, 'flat');
    assert.strictEqual(flatSnapshot.groupRows.length, 0, 'Expected flat mode to remove sidebar group rows.');
  } finally {
    await vscode.commands.executeCommand(COMMAND_IDS.setSidebarNodeListFlatView);
    await setPersistedState(baselineSnapshot.state);
  }
}

async function verifySidebarSessionHistoryRestore() {
  const workspaceCwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
  const fakeHomeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dev-session-canvas-sidebar-history-'));
  const codexSessionId = 'sidebar-codex-session-123';
  const firstUserInstruction = '请只用这个标题恢复侧栏历史会话';

  try {
    await writeCodexSessionFile({
      homeDir: fakeHomeDir,
      sessionId: codexSessionId,
      cwd: workspaceCwd,
      timestampMs: Date.parse('2026-04-27T11:00:00.000Z'),
      fileSuffix: 'sidebar',
      userMessages: [
        '# AGENTS.md instructions for /tmp/sidebar-history\n\n<INSTRUCTIONS>\n...</INSTRUCTIONS>',
        firstUserInstruction
      ]
    });

    const historyItems = await getSidebarSessionHistoryItems(fakeHomeDir);
    const codexItem = historyItems.find(
      (item) => item.provider === 'codex' && item.sessionId === codexSessionId
    );
    assert.ok(codexItem, 'Expected the sidebar session history test command to list the seeded Codex session.');
    assert.ok(
      typeof codexItem.timestampLabel === 'string' && codexItem.timestampLabel.length > 0,
      'Expected sidebar session history items to expose the secondary metadata line.'
    );
    assert.strictEqual(codexItem.title, firstUserInstruction);
    assert.match(codexItem.timestampLabel, new RegExp(`^Codex · .+ · ${codexSessionId}$`));
    const relativeTimeLabel = codexItem.timestampLabel.split(' · ')[1] ?? '';
    assert.ok(
      /^(?:just now|\d+ min ago|\d+ hr ago|\d+ days ago|刚刚|\d+ 分钟前|\d+ 小时前|\d+ 天前)$/.test(relativeTimeLabel),
      'Expected sidebar session history items to use the localized relative time label in the secondary line.'
    );
    assert.ok(!/(?:Node subtitle|节点副标题)/u.test(codexItem.tooltip));
    assert.ok(
      codexItem.searchText.includes(firstUserInstruction.toLowerCase()),
      'Expected sidebar session history search text to include the displayed session title.'
    );

    const baselineSnapshot = await getDebugSnapshot();
    await vscode.commands.executeCommand(
      COMMAND_IDS.restoreSidebarSessionHistoryEntry,
      codexItem.provider,
      codexItem.sessionId,
      codexItem.title
    );

    const restoredSnapshot = await waitForSnapshot((currentSnapshot) => {
      return currentSnapshot.state.nodes.some(
        (node) =>
          node.kind === 'agent' &&
          node.title === codexItem.title &&
          node.metadata?.agent?.provider === 'codex' &&
          typeof node.metadata?.agent?.customLaunchCommand === 'string' &&
          node.metadata.agent.customLaunchCommand.includes(`resume ${codexSessionId}`)
      );
    }, 20000);

    assert.strictEqual(
      restoredSnapshot.state.nodes.length,
      baselineSnapshot.state.nodes.length + 1,
      'Expected restoring a sidebar history entry to create one additional Agent node.'
    );

    const restoredAgentNode = restoredSnapshot.state.nodes.find(
      (node) =>
        node.kind === 'agent' &&
        node.title === codexItem.title &&
        node.metadata?.agent?.provider === 'codex' &&
        typeof node.metadata?.agent?.customLaunchCommand === 'string' &&
        node.metadata.agent.customLaunchCommand.includes(`resume ${codexSessionId}`)
    );
    assert.ok(restoredAgentNode, 'Expected the restored sidebar history entry to materialize as a new Codex agent node.');
  } finally {
    await fs.rm(fakeHomeDir, { recursive: true, force: true });
  }
}

async function verifyCodexAgentBranchFromCurrentNode() {
  const baselineSnapshot = await getDebugSnapshot();
  const sourceTitle = 'Codex 分叉 Source';
  const sourceSessionId = '019dbfb8-cffa-70b0-9c97-000000001234';
  const sourceNodeId = 'codex-branch-source-node';
  const previousCodexCommandEnv = process.env.DEV_SESSION_CANVAS_TEST_CODEX_COMMAND;
  let branchNodeId;

  try {
    process.env.DEV_SESSION_CANVAS_TEST_CODEX_COMMAND = path.join(
      __dirname,
      'fixtures',
      'fake-codex-provider'
    );

    const withSourceSnapshot = await setPersistedState({
      ...baselineSnapshot.state,
      nodes: [
        ...baselineSnapshot.state.nodes,
        {
          id: sourceNodeId,
          kind: 'agent',
          title: sourceTitle,
          status: 'stopped',
          summary: '检测到可分叉的 Codex 会话。',
          position: { x: 120, y: 120 },
          size: { width: 560, height: 420 },
          metadata: {
            agent: {
              provider: 'codex',
              lifecycle: 'stopped',
              launchPreset: 'custom',
              customLaunchCommand: `codex resume ${sourceSessionId}`,
              lastLaunchCommandLine: `codex resume ${sourceSessionId}`,
              resumeSupported: true,
              resumeStrategy: 'codex-session-id',
              resumeSessionId: sourceSessionId,
              persistenceMode: 'snapshot-only',
              attachmentState: 'history-restored',
              liveSession: false,
              pendingLaunch: undefined,
              lastBackendLabel: 'Codex'
            }
          }
        }
      ]
    });
    const sourceNode = findNodeById(withSourceSnapshot, sourceNodeId);
    await ensureEditorCanvasReady();

    const beforeBranchSnapshot = await getDebugSnapshot();
    await clearDiagnosticEvents();
    const diagnosticStartIndex = (await getDiagnosticEvents()).length;
    await dispatchWebviewMessage({
      type: 'webview/branchAgentSession',
      payload: {
        nodeId: sourceNode.id
      }
    });

    const branchedSnapshot = await waitForSnapshot((currentSnapshot) => {
      const branchNodes = currentSnapshot.state.nodes.filter(
        (node) =>
          node.kind === 'agent' &&
          node.id !== sourceNode.id &&
          node.title.includes('Fork') &&
          node.metadata?.agent?.provider === 'codex' &&
          node.metadata.agent.launchPreset === 'custom' &&
          typeof node.metadata.agent.customLaunchCommand === 'string' &&
          node.metadata.agent.customLaunchCommand.includes(`fork ${sourceSessionId}`)
      );
      return branchNodes.length === 1;
    }, 10000);

    assert.strictEqual(
      branchedSnapshot.state.nodes.length,
      beforeBranchSnapshot.state.nodes.length + 1,
      'Expected Codex Fork to create exactly one additional Agent node.'
    );

    const originalAfterBranch = branchedSnapshot.state.nodes.find((node) => node.id === sourceNode.id);
    assert.strictEqual(
      originalAfterBranch.metadata.agent.resumeSessionId,
      sourceSessionId,
      'Expected Codex Fork to leave the source node resume session id unchanged.'
    );

    const branchNode = branchedSnapshot.state.nodes.find(
      (node) =>
        node.kind === 'agent' &&
        node.id !== sourceNode.id &&
        node.metadata?.agent?.customLaunchCommand?.includes(`fork ${sourceSessionId}`)
    );
    assert.ok(branchNode, 'Expected Fork to create a Codex Agent node with codex fork command.');
    branchNodeId = branchNode.id;

    const branchEdgeSnapshot = await waitForSnapshot((currentSnapshot) => {
      return currentSnapshot.state.edges.some(
        (edge) =>
          edge.owner === 'user' &&
          edge.sourceNodeId === sourceNode.id &&
          edge.targetNodeId === branchNode.id &&
          edge.arrowMode === 'forward' &&
          edge.label === 'fork'
      );
    }, 10000);

    const branchEdge = branchEdgeSnapshot.state.edges.find(
      (edge) =>
        edge.owner === 'user' &&
        edge.sourceNodeId === sourceNode.id &&
        edge.targetNodeId === branchNode.id
    );
    assert.ok(branchEdge, 'Expected Fork to create a user edge from source Codex Agent to Forked Agent.');
    assert.strictEqual(branchEdge.arrowMode, 'forward');
    assert.strictEqual(branchEdge.sourceAnchor, 'right');
    assert.strictEqual(branchEdge.targetAnchor, 'left');
    assert.strictEqual(branchEdge.label, 'fork');

    const branchEdgeProbe = await waitForWebviewProbeOnSurface(
      'editor',
      (currentProbe) =>
        currentProbe.edges.some(
          (edge) =>
            edge.edgeId === branchEdge.id &&
            edge.sourceNodeId === sourceNode.id &&
            edge.targetNodeId === branchNode.id &&
            edge.label === 'fork'
        ),
      10000
    );
    assert.ok(
      branchEdgeProbe.edges.some((edge) => edge.edgeId === branchEdge.id && edge.label === 'fork'),
      'Expected the Codex Fork edge label to render as fork in the editor Webview.'
    );

    const startedEvents = await waitForDiagnosticEvents((events) => {
      const branchStartEvents = events.slice(diagnosticStartIndex).filter(
        (event) =>
          event.kind === 'execution/started' &&
          event.detail?.kind === 'agent' &&
          event.detail?.nodeId === branchNode.id &&
          event.detail?.provider === 'codex'
      );
      return branchStartEvents.length === 1;
    }, 20000);

    const branchStartEvents = startedEvents.slice(diagnosticStartIndex).filter(
      (event) =>
        event.kind === 'execution/started' &&
        event.detail?.kind === 'agent' &&
        event.detail?.nodeId === branchNode.id &&
        event.detail?.provider === 'codex'
    );
    assert.strictEqual(branchStartEvents.length, 1, 'Expected Codex Fork node to enter the Agent start path once.');
    const branchLaunchArgs = branchStartEvents[0].detail?.launchArgs ?? [];
    assert.ok(Array.isArray(branchLaunchArgs), 'Expected Fork start diagnostic to expose launch args.');
    assert.ok(branchLaunchArgs.includes('fork'), 'Expected Codex Fork launch args to include the fork subcommand.');
    assert.ok(branchLaunchArgs.includes(sourceSessionId), 'Expected Codex Fork launch args to include the source session id.');

    const startedSnapshot = await waitForSnapshot((currentSnapshot) => {
      const startedBranchNode = currentSnapshot.state.nodes.find((node) => node.id === branchNode.id);
      return Boolean(
        startedBranchNode?.metadata?.agent?.liveSession &&
          startedBranchNode.metadata.agent.pendingLaunch === undefined
      );
    }, 20000);
    const startedBranchNode = findNodeById(startedSnapshot, branchNode.id);
    assert.strictEqual(startedBranchNode.metadata.agent.provider, 'codex');
  } finally {
    if (previousCodexCommandEnv === undefined) {
      delete process.env.DEV_SESSION_CANVAS_TEST_CODEX_COMMAND;
    } else {
      process.env.DEV_SESSION_CANVAS_TEST_CODEX_COMMAND = previousCodexCommandEnv;
    }

    if (branchNodeId) {
      await maybeEnsureAgentStopped(branchNodeId).catch(() => {});
    }
    await maybeEnsureAgentStopped(sourceNodeId).catch(() => {});
    await setPersistedState(baselineSnapshot.state);
  }
}

async function verifyClaudeAgentBranchFromCurrentNode() {
  const baselineSnapshot = await getDebugSnapshot();
  const sourceTitle = 'Claude 分叉 Source';
  const sourceSessionId = 'claude-branch-source-session-123';
  const sourceNodeId = 'claude-branch-source-node';
  const previousClaudeCommandEnv = process.env.DEV_SESSION_CANVAS_TEST_CLAUDE_COMMAND;
  let branchNodeId;

  try {
    process.env.DEV_SESSION_CANVAS_TEST_CLAUDE_COMMAND = path.join(
      __dirname,
      'fixtures',
      'fake-claude-provider'
    );

    const withSourceSnapshot = await setPersistedState({
      ...baselineSnapshot.state,
      nodes: [
        ...baselineSnapshot.state.nodes,
        {
          id: sourceNodeId,
          kind: 'agent',
          title: sourceTitle,
          status: 'stopped',
          summary: '检测到可分叉的 Claude Code 会话。',
          position: { x: 120, y: 120 },
          size: { width: 560, height: 420 },
          metadata: {
            agent: {
              provider: 'claude',
              lifecycle: 'stopped',
              launchPreset: 'custom',
              customLaunchCommand: `claude --resume ${sourceSessionId}`,
              lastLaunchCommandLine: `claude --resume ${sourceSessionId}`,
              resumeSupported: true,
              resumeStrategy: 'claude-session-id',
              resumeSessionId: sourceSessionId,
              persistenceMode: 'snapshot-only',
              attachmentState: 'history-restored',
              liveSession: false,
              pendingLaunch: undefined,
              lastBackendLabel: 'Claude Code'
            }
          }
        }
      ]
    });
    const sourceNode = findNodeById(withSourceSnapshot, sourceNodeId);
    await ensureEditorCanvasReady();

    const beforeBranchSnapshot = await getDebugSnapshot();
    await clearDiagnosticEvents();
    const diagnosticStartIndex = (await getDiagnosticEvents()).length;
    await dispatchWebviewMessage({
      type: 'webview/branchAgentSession',
      payload: {
        nodeId: sourceNode.id
      }
    });

    const branchedSnapshot = await waitForSnapshot((currentSnapshot) => {
      const branchNodes = currentSnapshot.state.nodes.filter(
        (node) =>
          node.kind === 'agent' &&
          node.id !== sourceNode.id &&
          node.title.includes('Fork') &&
          node.metadata?.agent?.provider === 'claude' &&
          node.metadata.agent.launchPreset === 'custom' &&
          typeof node.metadata.agent.customLaunchCommand === 'string' &&
          node.metadata.agent.customLaunchCommand.includes(`--resume ${sourceSessionId}`) &&
          node.metadata.agent.customLaunchCommand.includes('--fork-session')
      );
      return branchNodes.length === 1;
    }, 10000);

    assert.strictEqual(
      branchedSnapshot.state.nodes.length,
      beforeBranchSnapshot.state.nodes.length + 1,
      'Expected Fork to create exactly one additional Agent node.'
    );

    const originalAfterBranch = branchedSnapshot.state.nodes.find((node) => node.id === sourceNode.id);
    assert.strictEqual(
      originalAfterBranch.metadata.agent.resumeSessionId,
      sourceSessionId,
      'Expected Fork to leave the source node resume session id unchanged.'
    );

    const branchNode = branchedSnapshot.state.nodes.find(
      (node) =>
        node.kind === 'agent' &&
        node.id !== sourceNode.id &&
        node.metadata?.agent?.customLaunchCommand?.includes('--fork-session')
    );
    assert.ok(branchNode, 'Expected Fork to create a Claude Agent node with fork-session command.');
    branchNodeId = branchNode.id;

    const branchEdgeSnapshot = await waitForSnapshot((currentSnapshot) => {
      return currentSnapshot.state.edges.some(
        (edge) =>
          edge.owner === 'user' &&
          edge.sourceNodeId === sourceNode.id &&
          edge.targetNodeId === branchNode.id &&
          edge.arrowMode === 'forward' &&
          edge.label === 'fork'
      );
    }, 10000);

    const branchEdge = branchEdgeSnapshot.state.edges.find(
      (edge) =>
        edge.owner === 'user' &&
        edge.sourceNodeId === sourceNode.id &&
        edge.targetNodeId === branchNode.id
    );
    assert.ok(branchEdge, 'Expected Fork to create a user edge from source Agent to Forked Agent.');
    assert.strictEqual(branchEdge.arrowMode, 'forward');
    assert.strictEqual(branchEdge.sourceAnchor, 'right');
    assert.strictEqual(branchEdge.targetAnchor, 'left');
    assert.strictEqual(branchEdge.label, 'fork');

    const branchEdgeProbe = await waitForWebviewProbeOnSurface(
      'editor',
      (currentProbe) =>
        currentProbe.edges.some(
          (edge) =>
            edge.edgeId === branchEdge.id &&
            edge.sourceNodeId === sourceNode.id &&
            edge.targetNodeId === branchNode.id &&
            edge.label === 'fork'
        ),
      10000
    );
    assert.ok(
      branchEdgeProbe.edges.some((edge) => edge.edgeId === branchEdge.id && edge.label === 'fork'),
      'Expected the Claude Fork edge label to render as fork in the editor Webview.'
    );

    const startedEvents = await waitForDiagnosticEvents((events) => {
      const branchStartEvents = events.slice(diagnosticStartIndex).filter(
        (event) =>
          event.kind === 'execution/started' &&
          event.detail?.kind === 'agent' &&
          event.detail?.nodeId === branchNode.id &&
          event.detail?.provider === 'claude'
      );
      return branchStartEvents.length === 1;
    }, 20000);

    const branchStartEvents = startedEvents.slice(diagnosticStartIndex).filter(
      (event) =>
        event.kind === 'execution/started' &&
        event.detail?.kind === 'agent' &&
        event.detail?.nodeId === branchNode.id &&
        event.detail?.provider === 'claude'
    );
    assert.strictEqual(branchStartEvents.length, 1, 'Expected Fork node to enter the Agent start path once.');
    const branchLaunchArgs = branchStartEvents[0].detail?.launchArgs ?? [];
    assert.ok(Array.isArray(branchLaunchArgs), 'Expected Fork start diagnostic to expose launch args.');
    assert.ok(branchLaunchArgs.includes('--resume'), 'Expected Fork launch args to include the source resume flag.');
    assert.ok(branchLaunchArgs.includes(sourceSessionId), 'Expected Fork launch args to include the source session id.');
    assert.ok(branchLaunchArgs.includes('--fork-session'), 'Expected Fork launch args to include --fork-session.');

    const sessionIdFlagIndex = branchLaunchArgs.indexOf('--session-id');
    assert.notStrictEqual(sessionIdFlagIndex, -1, 'Expected Fork launch args to include a new session id candidate.');
    const branchSessionId = branchLaunchArgs[sessionIdFlagIndex + 1];
    assert.ok(branchSessionId, 'Expected Fork session id candidate to have a value.');
    assert.notStrictEqual(
      branchSessionId,
      sourceSessionId,
      'Expected Fork session id candidate to differ from the source session id.'
    );

    const startedSnapshot = await waitForSnapshot((currentSnapshot) => {
      const startedBranchNode = currentSnapshot.state.nodes.find((node) => node.id === branchNode.id);
      return Boolean(
        startedBranchNode?.metadata?.agent?.liveSession &&
          startedBranchNode.metadata.agent.resumeSessionId === branchSessionId &&
          startedBranchNode.metadata.agent.pendingLaunch === undefined
      );
    }, 20000);
    const startedBranchNode = findNodeById(startedSnapshot, branchNode.id);
    assert.strictEqual(startedBranchNode.metadata.agent.resumeSessionId, branchSessionId);
    const duplicateBranchStartRejections = (await getDiagnosticEvents()).slice(diagnosticStartIndex).filter(
      (event) =>
        event.kind === 'execution/startRejected' &&
        event.detail?.kind === 'agent' &&
        event.detail?.nodeId === branchNode.id &&
        event.detail?.reason === 'already-running'
    );
    assert.strictEqual(
      duplicateBranchStartRejections.length,
      0,
      'Expected Fork auto-start to avoid racing a second start request.'
    );
  } finally {
    if (previousClaudeCommandEnv === undefined) {
      delete process.env.DEV_SESSION_CANVAS_TEST_CLAUDE_COMMAND;
    } else {
      process.env.DEV_SESSION_CANVAS_TEST_CLAUDE_COMMAND = previousClaudeCommandEnv;
    }

    if (branchNodeId) {
      await maybeEnsureAgentStopped(branchNodeId).catch(() => {});
    }
    await maybeEnsureAgentStopped(sourceNodeId).catch(() => {});
    await setPersistedState(baselineSnapshot.state);
  }
}

async function verifyAgentBranchRejectsUnsupportedSources() {
  const baselineSnapshot = await getDebugSnapshot();

  try {
    await vscode.commands.executeCommand(COMMAND_IDS.testCreateNode, 'agent', 'codex', {
      titleOverride: 'Agent 分叉 Rejection Source'
    });
    const codexSnapshot = await waitForSnapshot((currentSnapshot) => {
      return currentSnapshot.state.nodes.some(
        (node) => node.kind === 'agent' && node.title === 'Agent 分叉 Rejection Source'
      );
    }, 10000);
    const codexNode = codexSnapshot.state.nodes.find(
      (node) => node.kind === 'agent' && node.title === 'Agent 分叉 Rejection Source'
    );
    assert.ok(codexNode, 'Expected rejection source node to exist.');

    await dispatchWebviewMessage({
      type: 'webview/branchAgentSession',
      payload: { nodeId: codexNode.id }
    });
    await sleep(200);

    const afterRejectedBranch = await getDebugSnapshot();
    assert.strictEqual(
      afterRejectedBranch.state.nodes.length,
      codexSnapshot.state.nodes.length,
      'Expected Fork request without a trusted session id to be rejected without creating a node.'
    );
  } finally {
    await setPersistedState(baselineSnapshot.state);
  }
}

async function verifySidebarSessionHistorySearchByTitleUi() {
  const workspaceCwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
  const homeDir = os.homedir();
  const codexSessionId = 'sidebar-codex-ui-search-123';
  const firstUserInstruction = '海象打油诗搜索回归';
  let sessionFilePath;

  try {
    await performSidebarSessionHistoryAction(
      {
        kind: 'filterItems',
        query: ''
      },
      10000
    );

    sessionFilePath = await writeCodexSessionFile({
      homeDir,
      sessionId: codexSessionId,
      cwd: workspaceCwd,
      timestampMs: Date.parse('2026-04-27T11:20:00.000Z'),
      fileSuffix: 'sidebar-ui-search',
      userMessages: [
        '# AGENTS.md instructions for /tmp/sidebar-history-search\n\n<INSTRUCTIONS>\n...</INSTRUCTIONS>',
        firstUserInstruction
      ]
    });

    await vscode.commands.executeCommand(COMMAND_IDS.refreshSessionHistory);
    const historyItems = await getSidebarSessionHistoryItems();
    const codexItem = historyItems.find(
      (item) => item.provider === 'codex' && item.sessionId === codexSessionId
    );
    assert.ok(codexItem, 'Expected the sidebar history UI search test session to appear in the session list.');

    const actionSnapshot = await performSidebarSessionHistoryAction(
      {
        kind: 'filterItems',
        query: '打油诗搜索'
      },
      10000
    );
    assert.ok(
      actionSnapshot.visibleItemIds.includes(codexItem.id),
      'Expected searching by a title fragment to keep the matching session visible.'
    );
  } finally {
    try {
      await performSidebarSessionHistoryAction(
        {
          kind: 'filterItems',
          query: ''
        },
        10000
      );
    } catch {}

    if (sessionFilePath) {
      await fs.rm(sessionFilePath, { force: true });
    }
    await vscode.commands.executeCommand(COMMAND_IDS.refreshSessionHistory);
  }
}

async function verifySidebarSessionHistoryDoubleClickUi() {
  const workspaceCwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
  const homeDir = os.homedir();
  const codexSessionId = 'sidebar-codex-ui-dblclick-123';
  const firstUserInstruction = '请通过双击在画布中恢复这个会话';
  let sessionFilePath;

  try {
    await performSidebarSessionHistoryAction(
      {
        kind: 'filterItems',
        query: ''
      },
      10000
    );

    sessionFilePath = await writeCodexSessionFile({
      homeDir,
      sessionId: codexSessionId,
      cwd: workspaceCwd,
      timestampMs: Date.parse('2026-04-27T11:30:00.000Z'),
      fileSuffix: 'sidebar-ui-dblclick',
      userMessages: [
        '# AGENTS.md instructions for /tmp/sidebar-history-ui\n\n<INSTRUCTIONS>\n...</INSTRUCTIONS>',
        firstUserInstruction
      ]
    });

    const historyItems = await getSidebarSessionHistoryItems();
    const codexItem = historyItems.find(
      (item) => item.provider === 'codex' && item.sessionId === codexSessionId
    );
    assert.ok(codexItem, 'Expected the sidebar history UI test session to appear in the session list.');

    const baselineSnapshot = await getDebugSnapshot();
    const actionSnapshot = await performSidebarSessionHistoryAction(
      {
        kind: 'doubleClickItem',
        itemId: codexItem.id
      },
      10000
    );
    assert.ok(
      actionSnapshot.visibleItemIds.includes(codexItem.id),
      'Expected the UI double-click action to target a currently visible sidebar session row.'
    );
    assert.strictEqual(
      actionSnapshot.selectedId,
      codexItem.id,
      'Expected the first click of the UI double-click action to keep the target session selected.'
    );

    const restoredSnapshot = await waitForSnapshot((currentSnapshot) => {
      return currentSnapshot.state.nodes.some(
        (node) =>
          node.kind === 'agent' &&
          node.title === codexItem.title &&
          node.metadata?.agent?.provider === 'codex' &&
          typeof node.metadata?.agent?.customLaunchCommand === 'string' &&
          node.metadata.agent.customLaunchCommand.includes(`resume ${codexSessionId}`)
      );
    }, 20000);

    assert.strictEqual(
      restoredSnapshot.state.nodes.length,
      baselineSnapshot.state.nodes.length + 1,
      'Expected double-clicking a sidebar session row to create one additional Agent node.'
    );
  } finally {
    if (sessionFilePath) {
      await fs.rm(sessionFilePath, { force: true });
    }
    await vscode.commands.executeCommand(COMMAND_IDS.refreshSessionHistory);
  }
}


async function verifySidebarSessionHistoryForkActionUi() {
  const workspaceCwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
  const homeDir = os.homedir();
  const codexSessionId = 'sidebar-codex-ui-fork-123';
  const firstUserInstruction = '请通过按钮分叉这个历史会话';
  let sessionFilePath;

  try {
    await performSidebarSessionHistoryAction(
      {
        kind: 'filterItems',
        query: ''
      },
      10000
    );

    sessionFilePath = await writeCodexSessionFile({
      homeDir,
      sessionId: codexSessionId,
      cwd: workspaceCwd,
      timestampMs: Date.parse('2026-04-27T11:35:00.000Z'),
      fileSuffix: 'sidebar-ui-fork',
      userMessages: [firstUserInstruction]
    });

    await vscode.commands.executeCommand(COMMAND_IDS.refreshSessionHistory);
    const historyItems = await getSidebarSessionHistoryItems();
    const codexItem = historyItems.find(
      (item) => item.provider === 'codex' && item.sessionId === codexSessionId
    );
    assert.ok(codexItem, 'Expected the sidebar history UI fork test session to appear in the session list.');

    const baselineSnapshot = await getDebugSnapshot();
    const actionSnapshot = await performSidebarSessionHistoryAction(
      {
        kind: 'clickActionButton',
        itemId: codexItem.id,
        action: 'fork'
      },
      10000
    );
    assert.strictEqual(
      actionSnapshot.selectedId,
      codexItem.id,
      'Expected clicking the Fork action button to select the target session row.'
    );

    const forkedSnapshot = await waitForSnapshot((currentSnapshot) => {
      return currentSnapshot.state.nodes.some(
        (node) =>
          node.kind === 'agent' &&
          node.title === `${codexItem.title} Fork` &&
          node.metadata?.agent?.provider === 'codex' &&
          typeof node.metadata?.agent?.customLaunchCommand === 'string' &&
          node.metadata.agent.customLaunchCommand.includes(`fork ${codexSessionId}`)
      );
    }, 20000);

    assert.strictEqual(
      forkedSnapshot.state.nodes.length,
      baselineSnapshot.state.nodes.length + 1,
      'Expected clicking a sidebar session Fork action to create one additional Agent node.'
    );
  } finally {
    if (sessionFilePath) {
      await fs.rm(sessionFilePath, { force: true });
    }
    await vscode.commands.executeCommand(COMMAND_IDS.refreshSessionHistory);
  }
}

async function verifyRestrictedSessionHistoryRestoreIsDisabled() {
  const workspaceCwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
  const homeDir = os.homedir();
  const codexSessionId = 'restricted-sidebar-history-123';
  const firstUserInstruction = '受限工作区历史恢复禁用回归';
  let sessionFilePath;

  try {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');

    sessionFilePath = await writeCodexSessionFile({
      homeDir,
      sessionId: codexSessionId,
      cwd: workspaceCwd,
      timestampMs: Date.parse('2026-04-27T11:40:00.000Z'),
      fileSuffix: 'restricted-history',
      userMessages: [firstUserInstruction]
    });

    await vscode.commands.executeCommand(COMMAND_IDS.refreshSessionHistory);
    const historyItems = await getSidebarSessionHistoryItems();
    const codexItem = historyItems.find(
      (item) => item.provider === 'codex' && item.sessionId === codexSessionId
    );
    assert.ok(codexItem, 'Expected the restricted-workspace session history entry to be listed.');

    const filteredSnapshot = await performSidebarSessionHistoryAction(
      {
        kind: 'filterItems',
        query: '历史恢复禁用'
      },
      10000
    );
    assert.ok(
      filteredSnapshot.visibleItemIds.includes(codexItem.id),
      'Expected the restricted-workspace session history entry to remain visible after filtering by title.'
    );
    assert.ok(
      filteredSnapshot.disabledItemIds.includes(codexItem.id),
      'Expected restricted-workspace session history rows to be disabled instead of remaining restorable.'
    );
    assert.strictEqual(filteredSnapshot.statusNoteText, RESTRICTED_SESSION_HISTORY_RESTORE_MESSAGE);

    const baselineSnapshot = await getDebugSnapshot();
    const doubleClickSnapshot = await performSidebarSessionHistoryAction(
      {
        kind: 'doubleClickItem',
        itemId: codexItem.id
      },
      10000
    );
    assert.ok(doubleClickSnapshot.disabledItemIds.includes(codexItem.id));

    const postActionSnapshot = await getDebugSnapshot();
    assert.strictEqual(
      postActionSnapshot.state.nodes.length,
      baselineSnapshot.state.nodes.length,
      'Expected double-clicking a restricted-workspace history row not to create any Agent node.'
    );
    assert.ok(
      !postActionSnapshot.state.nodes.some(
        (node) => node.kind === 'agent' && node.title === codexItem.title
      ),
      'Expected restricted-workspace history restore attempts not to materialize a new Agent node.'
    );

    await withInterceptedWarningMessages(async (warningCalls) => {
      await withInterceptedQuickPicks(
        async (quickPickCalls) => {
          await vscode.commands.executeCommand(COMMAND_IDS.showSessionHistory);

          assert.strictEqual(quickPickCalls.length, 1, 'Expected restricted session history command to open one QuickPick.');
          const [quickPickCall] = quickPickCalls;
          const quickPickItem = quickPickCall.items.find((item) => item.sessionId === codexSessionId);

          assert.ok(quickPickItem, 'Expected restricted session history QuickPick to include the matching history item.');
          assert.strictEqual(quickPickCall.options?.title, RESTRICTED_SESSION_HISTORY_RESTORE_MESSAGE);
          assert.match(
            quickPickCall.options?.placeHolder ?? '',
            /Read-only mode/i,
            'Expected restricted session history QuickPick to explain the read-only mode.'
          );
          assert.strictEqual(quickPickItem.description, 'Resume');
          assert.match(quickPickItem.detail ?? '', /^Codex · .+ · restricted-sidebar-history-123$/);
          assert.deepStrictEqual(
            warningCalls.map((call) => call.message),
            [RESTRICTED_SESSION_HISTORY_RESTORE_MESSAGE]
          );
        },
        async ({ items }) => items.find((item) => item.sessionId === codexSessionId)
      );
    });
  } finally {
    if (sessionFilePath) {
      await fs.rm(sessionFilePath, { force: true });
    }
    await vscode.commands.executeCommand(COMMAND_IDS.refreshSessionHistory);
  }
}

async function verifyCreateNodeCommandQuickPick() {
  await clearHostMessages();
  await clearDiagnosticEvents();

  let snapshot = await getDebugSnapshot();
  const baselineNodeCount = snapshot.state.nodes.length;

  await setQuickPickSelections(['create-agent-claude', 'agent-launch-apply-default']);
  await vscode.commands.executeCommand(COMMAND_IDS.createNode);
  await sleep(200);

  snapshot = await getDebugSnapshot();
  assert.strictEqual(
    snapshot.state.nodes.length,
    baselineNodeCount,
    'Selecting a launch preset in the second-step Quick Input should only rewrite the command, not create an Agent.'
  );

  await setQuickPickSelections(['create-agent-claude', 'agent-launch-apply-yolo', 'agent-launch-accept-current']);
  await vscode.commands.executeCommand(COMMAND_IDS.createNode);

  snapshot = await waitForSnapshot((currentSnapshot) => {
    return currentSnapshot.state.nodes.some(
      (node) =>
        node.kind === 'agent' &&
        node.metadata?.agent?.provider === 'claude' &&
        node.metadata?.agent?.launchPreset === 'yolo'
    );
  }, 20000);

  const claudeAgentNode = snapshot.state.nodes.find(
    (node) =>
      node.kind === 'agent' &&
      node.metadata?.agent?.provider === 'claude' &&
      node.metadata?.agent?.launchPreset === 'yolo'
  );
  assert.ok(claudeAgentNode, 'Expected createNode command to create a Claude agent with YOLO launch preset.');
  await waitForDiagnosticEvents(
    (events) =>
      events.some(
        (event) =>
          event.kind === 'execution/startRequested' &&
          event.detail?.nodeId === claudeAgentNode.id &&
          event.detail?.provider === 'claude' &&
          event.detail?.launchPreset === 'yolo'
      ),
    20000
  );

  await clearDiagnosticEvents();
  await setQuickPickSelections(['create-agent-default', 'agent-launch-accept-current']);
  await vscode.commands.executeCommand(COMMAND_IDS.createNode);

  snapshot = await waitForSnapshot((currentSnapshot) => {
    return currentSnapshot.state.nodes.filter((node) => node.kind === 'agent').length >= 2;
  }, 20000);

  const codexAgentNode = snapshot.state.nodes.find(
    (node) =>
      node.kind === 'agent' &&
      node.id !== claudeAgentNode.id &&
      node.metadata?.agent?.provider === 'codex' &&
      node.metadata?.agent?.launchPreset === 'default'
  );
  assert.ok(codexAgentNode, 'Expected default Agent quick pick item to create a Codex agent.');
  await waitForDiagnosticEvents(
    (events) =>
      events.some(
        (event) =>
          event.kind === 'execution/startRequested' &&
          event.detail?.nodeId === codexAgentNode.id &&
          event.detail?.provider === 'codex' &&
          event.detail?.launchPreset === 'default'
      ),
    20000
  );

  await clearDiagnosticEvents();
  await setQuickPickSelections(['create-note']);
  await vscode.commands.executeCommand(COMMAND_IDS.createNode);

  snapshot = await waitForSnapshot((currentSnapshot) => {
    return currentSnapshot.state.nodes.some((node) => node.kind === 'note');
  }, 20000);
  assert.ok(snapshot.state.nodes.some((node) => node.kind === 'note'));

  await dispatchWebviewMessage({ type: 'webview/resetDemoState' });
  snapshot = await waitForSnapshot((currentSnapshot) => currentSnapshot.state.nodes.length === 0, 20000);
  assert.strictEqual(snapshot.state.nodes.length, 0);

  await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInEditor);
  await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'editor', 20000);
}

async function verifyDefaultExecutionNodeMetadataUsesWorkspaceRoot() {
  await clearHostMessages();
  await clearDiagnosticEvents();

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  assert.ok(workspaceRoot, 'Expected trusted smoke to run inside a workspace.');

  await vscode.commands.executeCommand(COMMAND_IDS.testResetState);
  await vscode.commands.executeCommand(COMMAND_IDS.testCreateNode, 'agent');
  await vscode.commands.executeCommand(COMMAND_IDS.testCreateNode, 'terminal');

  const snapshot = await waitForSnapshot(
    (currentSnapshot) =>
      currentSnapshot.state.nodes.some(
        (node) => node.kind === 'agent' && node.metadata?.agent?.cwd === workspaceRoot
      ) &&
      currentSnapshot.state.nodes.some(
        (node) => node.kind === 'terminal' && node.metadata?.terminal?.cwd === workspaceRoot
      ),
    20000
  );
  const agentNode = findNodeByKind(snapshot, 'agent');
  const terminalNode = findNodeByKind(snapshot, 'terminal');
  assert.strictEqual(agentNode.metadata.agent.cwd, workspaceRoot);
  assert.strictEqual(terminalNode.metadata.terminal.cwd, workspaceRoot);
  await ensureAgentStopped(agentNode.id).catch(() => {});
  await ensureTerminalStopped(terminalNode.id).catch(() => {});
  await vscode.commands.executeCommand(COMMAND_IDS.testResetState);
}

async function verifyWorkspaceRelativeTerminalShellPathUsesWorkspaceRoot() {
  await clearHostMessages();
  await clearDiagnosticEvents();

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  assert.ok(workspaceRoot, 'Expected trusted smoke to run inside a workspace.');

  const configuration = vscode.workspace.getConfiguration();
  const originalShellSetting = configuration.inspect('devSessionCanvas.terminal.shell');
  const originalShellPathSetting = configuration.inspect('devSessionCanvas.terminal.shellPath');
  const configurationTarget = resolvePreferredTerminalShellSettingsTarget();
  const originalRuntimePersistenceEnabled = configuration.get('devSessionCanvas.runtimePersistence.enabled', false);
  const shellRelativePath = './.debug/vscode-smoke/relative-shell/dev-shell';
  const expectedShellPath = path.join(workspaceRoot, '.debug', 'vscode-smoke', 'relative-shell', 'dev-shell');
  const targetDirectory = path.join(workspaceRoot, '.debug', 'vscode-smoke', 'relative-shell', 'packages', 'app');
  let terminalNodeId;

  try {
    await fs.mkdir(path.dirname(expectedShellPath), { recursive: true });
    await fs.mkdir(targetDirectory, { recursive: true });
    await fs.writeFile(
      expectedShellPath,
      process.platform === 'win32'
        ? '@echo off\r\necho relative-shell:%CD%\r\nping -n 3 127.0.0.1 > nul\r\n'
        : '#!/bin/sh\nprintf "relative-shell:%s\\n" "$PWD"\nsleep 2\n',
      'utf8'
    );
    if (process.platform !== 'win32') {
      await fs.chmod(expectedShellPath, 0o755);
    }

    await setTerminalShell('default', configurationTarget);
    await setTerminalShellPath(shellRelativePath, configurationTarget);
    await setRuntimePersistenceEnabled(false);
    await simulateRuntimeReload();
    await vscode.commands.executeCommand(COMMAND_IDS.testResetState);
    await vscode.commands.executeCommand(COMMAND_IDS.testCreateNode, 'terminal', undefined, {
      cwdOverride: targetDirectory
    });

    let snapshot = await waitForSnapshot(
      (currentSnapshot) =>
        currentSnapshot.state.nodes.some(
          (node) =>
            node.kind === 'terminal' &&
            node.metadata?.terminal?.cwd === targetDirectory &&
            normalizeShellPath(node.metadata?.terminal?.shellPath) === normalizeShellPath(expectedShellPath)
        ),
      20000
    );
    const terminalNode = snapshot.state.nodes.find(
      (node) =>
        node.kind === 'terminal' &&
        node.metadata?.terminal?.cwd === targetDirectory &&
        normalizeShellPath(node.metadata?.terminal?.shellPath) === normalizeShellPath(expectedShellPath)
    );
    assert.ok(terminalNode, 'Expected cwd-scoped Terminal to store workspace-resolved relative shell path.');
    terminalNodeId = terminalNode.id;

    await waitForDiagnosticEvents(
      (events) =>
        events.some(
          (event) =>
            event.kind === 'execution/started' &&
            event.detail?.kind === 'terminal' &&
            event.detail?.nodeId === terminalNode.id &&
            event.detail?.cwd === targetDirectory &&
            normalizeShellPath(event.detail?.shellPath) === normalizeShellPath(expectedShellPath)
        ),
      20000
    );
    snapshot = await waitForTerminalLive(terminalNode.id);
    assert.strictEqual(findNodeById(snapshot, terminalNode.id).metadata.terminal.cwd, targetDirectory);
  } finally {
    if (terminalNodeId) {
      await ensureTerminalStopped(terminalNodeId).catch(() => {});
    }
    await vscode.commands.executeCommand(COMMAND_IDS.testResetState);
    await restoreTerminalShellSetting('devSessionCanvas.terminal.shell', originalShellSetting);
    await restoreTerminalShellSetting('devSessionCanvas.terminal.shellPath', originalShellPathSetting);
    await setRuntimePersistenceEnabled(originalRuntimePersistenceEnabled);
    await simulateRuntimeReload();
  }
}

async function verifyExplorerResourceExecutionNodeCreation() {
  await clearHostMessages();
  await clearDiagnosticEvents();

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  assert.ok(workspaceRoot, 'Expected trusted smoke to run inside a workspace.');
  const targetDirectory = path.join(workspaceRoot, '.debug', 'vscode-smoke', 'explorer-cwd');
  const targetFile = path.join(targetDirectory, 'entry.ts');
  const defaultProvider =
    vscode.workspace
      .getConfiguration()
      .get('devSessionCanvas.agent.defaultProvider', 'codex') === 'claude'
      ? 'claude'
      : 'codex';
  const expectedProviderLabel = defaultProvider === 'claude' ? 'Claude Code' : 'Codex';
  await fs.mkdir(targetDirectory, { recursive: true });
  await fs.writeFile(targetFile, 'export const explorerCwdSmoke = true;\n', 'utf8');

  await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInPanel);
  await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'panel', 20000);
  let snapshot = await getDebugSnapshot();
  assert.strictEqual(snapshot.activeSurface, 'panel');
  const baselineNodeIds = new Set(snapshot.state.nodes.map((node) => node.id));

  await vscode.commands.executeCommand(
    COMMAND_IDS.createTerminalFromExplorerResource,
    vscode.Uri.file(targetDirectory)
  );
  snapshot = await waitForSnapshot(
    (currentSnapshot) =>
      currentSnapshot.state.nodes.some(
        (node) =>
          !baselineNodeIds.has(node.id) &&
          node.kind === 'terminal' &&
          node.metadata?.terminal?.cwd === targetDirectory
      ),
    20000
  );
  const terminalNode = snapshot.state.nodes.find(
    (node) =>
      !baselineNodeIds.has(node.id) &&
      node.kind === 'terminal' &&
      node.metadata?.terminal?.cwd === targetDirectory
  );
  assert.strictEqual(
    snapshot.activeSurface,
    'panel',
    'Expected Explorer Terminal creation to use the already-open Canvas surface instead of the default surface.'
  );
  assert.ok(terminalNode, 'Expected Explorer directory command to create a cwd-scoped Terminal.');
  await waitForDiagnosticEvents(
    (events) =>
      events.some(
        (event) =>
          event.kind === 'execution/startRequested' &&
          event.detail?.kind === 'terminal' &&
          event.detail?.nodeId === terminalNode.id &&
          event.detail?.cwd === targetDirectory
      ),
    20000
  );
  await waitForTerminalLive(terminalNode.id);
  await waitForDiagnosticEvents(
    (events) =>
      events.some(
        (event) =>
          event.kind === 'execution/started' &&
          event.detail?.kind === 'terminal' &&
          event.detail?.nodeId === terminalNode.id &&
          event.detail?.cwd === targetDirectory
      ),
    20000
  );
  await ensureTerminalStopped(terminalNode.id);

  baselineNodeIds.add(terminalNode.id);
  await clearDiagnosticEvents();
  await setQuickPickSelections(['create-agent-default', 'agent-launch-accept-current']);
  await vscode.commands.executeCommand(
    COMMAND_IDS.createAgentFromExplorerResource,
    vscode.Uri.file(targetFile)
  );
  snapshot = await waitForSnapshot(
    (currentSnapshot) =>
      currentSnapshot.state.nodes.some(
        (node) =>
          !baselineNodeIds.has(node.id) &&
          node.kind === 'agent' &&
          node.metadata?.agent?.cwd === targetDirectory
      ),
    20000
  );
  const agentNode = snapshot.state.nodes.find(
    (node) =>
      !baselineNodeIds.has(node.id) &&
      node.kind === 'agent' &&
      node.metadata?.agent?.cwd === targetDirectory
  );
  assert.strictEqual(
    snapshot.activeSurface,
    'panel',
    'Expected Explorer Agent creation to stay on the already-open Canvas surface.'
  );
  assert.ok(agentNode, 'Expected Explorer file command to create an Agent bound to the file parent directory.');
  await waitForDiagnosticEvents(
    (events) =>
      events.some(
        (event) =>
          event.kind === 'execution/startRequested' &&
          event.detail?.kind === 'agent' &&
          event.detail?.nodeId === agentNode.id &&
          event.detail?.cwd === targetDirectory
      ),
    20000
  );

  const sidebarItems = await getSidebarNodeListItems();
  const agentItem = sidebarItems.find((item) => item.nodeId === agentNode.id);
  assert.ok(agentItem, 'Expected cwd-scoped Agent to appear in the sidebar node list.');
  assert.strictEqual(
    agentItem.status.startsWith(`.debug/vscode-smoke/explorer-cwd/ · ${expectedProviderLabel} · `),
    true,
    'Expected Agent sidebar row to include cwd label before provider and status.'
  );

  const explorerSnapshot = await getDebugSnapshot();
  const activeSurface = explorerSnapshot.activeSurface ?? 'editor';
  await waitForWebviewProbeOnSurface(
    activeSurface,
    (probe) => {
      const probedAgent = probe.nodes.find((node) => node.nodeId === agentNode.id);
      return Boolean(probedAgent?.chromeContext?.includes('.debug/vscode-smoke/explorer-cwd/'));
    },
    20000
  );

  await waitForAgentLive(agentNode.id);
  await waitForDiagnosticEvents(
    (events) =>
      events.some(
        (event) =>
          event.kind === 'execution/started' &&
          event.detail?.kind === 'agent' &&
          event.detail?.nodeId === agentNode.id &&
          event.detail?.cwd === targetDirectory
      ),
    20000
  );
  await ensureAgentStopped(agentNode.id);
  await clearDiagnosticEvents();
  await startExecutionSessionForTest({
    kind: 'terminal',
    nodeId: terminalNode.id,
    cols: 90,
    rows: 26
  });
  await waitForDiagnosticEvents(
    (events) =>
      events.some(
        (event) =>
          event.kind === 'execution/startRequested' &&
          event.detail?.kind === 'terminal' &&
          event.detail?.nodeId === terminalNode.id &&
          event.detail?.cwd === targetDirectory
      ),
    20000
  );
  await waitForTerminalLive(terminalNode.id);
  await waitForDiagnosticEvents(
    (events) =>
      events.some(
        (event) =>
          event.kind === 'execution/started' &&
          event.detail?.kind === 'terminal' &&
          event.detail?.nodeId === terminalNode.id &&
          event.detail?.cwd === targetDirectory
      ),
    20000
  );
  await ensureTerminalStopped(terminalNode.id);

  await dispatchWebviewMessage({ type: 'webview/resetDemoState' });
  snapshot = await waitForSnapshot((currentSnapshot) => currentSnapshot.state.nodes.length === 0, 20000);
  assert.strictEqual(snapshot.state.nodes.length, 0);
  await ensureEditorCanvasReady();
}

async function verifyCreateNodeCommandUsesOpenCanvasSurface() {
  await clearHostMessages();
  await clearDiagnosticEvents();
  await vscode.commands.executeCommand(COMMAND_IDS.testResetState);

  await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInPanel);
  await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'panel', 20000);
  let snapshot = await getDebugSnapshot();
  assert.strictEqual(snapshot.activeSurface, 'panel');

  await setQuickPickSelections(['create-note']);
  await vscode.commands.executeCommand(COMMAND_IDS.createNode);
  snapshot = await waitForSnapshot(
    (currentSnapshot) =>
      currentSnapshot.activeSurface === 'panel' &&
      currentSnapshot.state.nodes.some((node) => node.kind === 'note'),
    20000
  );
  assert.strictEqual(
    snapshot.activeSurface,
    'panel',
    'Expected generic node creation to reuse the already-open Canvas surface.'
  );

  await dispatchWebviewMessage({ type: 'webview/resetDemoState' }, 'panel');
  snapshot = await waitForSnapshot((currentSnapshot) => currentSnapshot.state.nodes.length === 0, 20000);
  assert.strictEqual(snapshot.state.nodes.length, 0);
  await ensureEditorCanvasReady();
}

async function verifyCreateNodeCommandQuickPickKeepsSelectedModeUntilUserEdits() {
  await clearHostMessages();
  await clearDiagnosticEvents();
  await dispatchWebviewMessage({ type: 'webview/resetDemoState' });
  await waitForSnapshot((currentSnapshot) => currentSnapshot.state.nodes.length === 0, 20000);

  const customMarker = `--quick-input-enter-regression-${Date.now()}`;

  await setQuickPickSelections(['create-agent-default']);
  await withInterceptedCreateQuickPicks(
    async () => {
      await vscode.commands.executeCommand(COMMAND_IDS.createNode);
    },
    async ({ quickPick, emitChangeValue, emitAccept }) => {
      const customCreateItem = quickPick.items.find((item) => item?.selectionId === 'agent-launch-accept-current');
      assert.ok(customCreateItem, 'Expected the Agent launch QuickPick to include a custom command creation item.');
      assert.strictEqual(
        customCreateItem.label,
        'Create with custom command',
        'Expected the first Agent launch QuickPick item to create from a custom command.'
      );

      const presetItems = quickPick.items.filter((item) => item && item.launchPreset);
      assert.deepStrictEqual(
        presetItems.map((item) => item.launchPreset),
        ['default', 'resume', 'yolo', 'sandbox'],
        'Expected the Agent launch QuickPick to expose preset replacement items below custom command creation.'
      );

      const defaultItem = presetItems.find((item) => item.launchPreset === 'default');
      assert.ok(defaultItem, 'Expected the Agent launch QuickPick to include a default preset item.');
      quickPick.activeItems = [customCreateItem];
      emitChangeValue(quickPick.value);
      assert.deepStrictEqual(
        quickPick.activeItems,
        [defaultItem],
        'Expected the Agent launch QuickPick to keep the default preset selected during the initial value sync.'
      );

      const yoloItem = presetItems.find((item) => item.launchPreset === 'yolo');
      assert.ok(yoloItem, 'Expected the Agent launch QuickPick to include a YOLO preset item.');
      quickPick.activeItems = [yoloItem];
      emitAccept();
      assert.ok(quickPick.value.includes('--yolo'), 'Expected the YOLO preset item to replace the command input.');
      assert.strictEqual(quickPick.disposed, false, 'Preset items should not create or close the Agent launch QuickPick.');
      assert.deepStrictEqual(
        quickPick.activeItems,
        [yoloItem],
        'Expected applying a preset to keep focus on that preset until the user edits.'
      );

      quickPick.value = `${quickPick.value} ${customMarker}`;
      emitChangeValue(quickPick.value);
      assert.deepStrictEqual(
        quickPick.activeItems,
        [customCreateItem],
        'Expected manually editing the command to switch focus to custom command creation.'
      );
      emitAccept();
    }
  );

  const snapshot = await waitForSnapshot(
    (currentSnapshot) =>
      currentSnapshot.state.nodes.some(
        (node) =>
          node.kind === 'agent' &&
          node.metadata?.agent?.provider === 'codex' &&
          node.metadata?.agent?.launchPreset === 'custom' &&
          typeof node.metadata?.agent?.customLaunchCommand === 'string' &&
          node.metadata.agent.customLaunchCommand.includes(customMarker)
      ),
    20000
  );
  const customAgentNode = snapshot.state.nodes.find(
    (node) =>
      node.kind === 'agent' &&
      node.metadata?.agent?.provider === 'codex' &&
      node.metadata?.agent?.launchPreset === 'custom' &&
      typeof node.metadata?.agent?.customLaunchCommand === 'string' &&
      node.metadata.agent.customLaunchCommand.includes(customMarker)
  );
  assert.ok(customAgentNode, 'Expected Enter on the custom command item to create an Agent from the typed command.');

  await waitForDiagnosticEvents(
    (events) =>
      events.some(
        (event) =>
          event.kind === 'execution/startRequested' &&
          event.detail?.nodeId === customAgentNode.id &&
          event.detail?.provider === 'codex' &&
          event.detail?.launchPreset === 'custom'
      ),
    20000
  );
}

async function verifyCreateNodeCommandQuickPickPreservesExplicitPresetIntent() {
  const configuration = vscode.workspace.getConfiguration();
  const originalCodexDefaultArgs = configuration.get('devSessionCanvas.agent.codexDefaultArgs', '');
  const conflictingCodexDefaultArgs = '--model gpt-5.2 --yolo';

  await clearHostMessages();
  await clearDiagnosticEvents();
  await setAgentDefaultArgs('codex', conflictingCodexDefaultArgs);

  try {
    await waitForHostMessages(
      (messages) =>
        messages.some(
          (message) =>
            message.type === 'host/stateUpdated' &&
            message.payload.runtime?.agentLaunchDefaults?.codex?.defaultArgs === conflictingCodexDefaultArgs
        ),
      20000
    );

    await dispatchWebviewMessage({ type: 'webview/resetDemoState' });
    let snapshot = await waitForSnapshot((currentSnapshot) => currentSnapshot.state.nodes.length === 0, 20000);
    assert.strictEqual(snapshot.state.nodes.length, 0);

    await setQuickPickSelections(['create-agent-default', 'agent-launch-apply-yolo', 'agent-launch-accept-current']);
    await vscode.commands.executeCommand(COMMAND_IDS.createNode);

    snapshot = await waitForSnapshot((currentSnapshot) => {
      return currentSnapshot.state.nodes.some(
        (node) =>
          node.kind === 'agent' &&
          node.metadata?.agent?.provider === 'codex' &&
          node.metadata?.agent?.launchPreset === 'yolo'
      );
    }, 20000);

    const codexAgentNode = snapshot.state.nodes.find(
      (node) =>
        node.kind === 'agent' &&
        node.metadata?.agent?.provider === 'codex' &&
        node.metadata?.agent?.launchPreset === 'yolo'
    );
    assert.ok(
      codexAgentNode,
      'Expected explicit YOLO preset selection to stay persisted even when the default Codex command line already contains --yolo.'
    );
    await waitForDiagnosticEvents(
      (events) =>
        events.some(
          (event) =>
            event.kind === 'execution/startRequested' &&
            event.detail?.nodeId === codexAgentNode.id &&
            event.detail?.provider === 'codex' &&
            event.detail?.launchPreset === 'yolo'
        ),
      20000
    );
  } finally {
    await clearHostMessages();
    await setAgentDefaultArgs('codex', originalCodexDefaultArgs);
    await waitForHostMessages(
      (messages) =>
        messages.some(
          (message) =>
            message.type === 'host/stateUpdated' &&
            message.payload.runtime?.agentLaunchDefaults?.codex?.defaultArgs === originalCodexDefaultArgs
        ),
      20000
    );
    await clearDiagnosticEvents();
    await dispatchWebviewMessage({ type: 'webview/resetDemoState' });
    const snapshot = await waitForSnapshot((currentSnapshot) => currentSnapshot.state.nodes.length === 0, 20000);
    assert.strictEqual(snapshot.state.nodes.length, 0);
  }
}

async function verifyRuntimeContextRefreshesDefaultAgentProvider() {
  const configuration = vscode.workspace.getConfiguration();
  const originalProvider =
    configuration.get('devSessionCanvas.agent.defaultProvider', 'codex') === 'claude' ? 'claude' : 'codex';
  const updatedProvider = originalProvider === 'claude' ? 'codex' : 'claude';

  await clearHostMessages();
  await setDefaultAgentProvider(updatedProvider);

  try {
    const hostMessages = await waitForHostMessages(
      (messages) =>
        messages.some(
          (message) =>
            message.type === 'host/stateUpdated' &&
            message.payload.runtime?.defaultAgentProvider === updatedProvider
        ),
      20000
    );
    assert.ok(
      hostMessages.some(
        (message) =>
          message.type === 'host/stateUpdated' &&
          message.payload.runtime?.defaultAgentProvider === updatedProvider
      ),
      'Expected host to push an updated runtime context after changing the default Agent provider.'
    );
  } finally {
    await clearHostMessages();
    await setDefaultAgentProvider(originalProvider);
    await waitForHostMessages(
      (messages) =>
        messages.some(
          (message) =>
            message.type === 'host/stateUpdated' &&
            message.payload.runtime?.defaultAgentProvider === originalProvider
        ),
      20000
    );
  }
}

async function verifyRuntimeContextRefreshesTerminalScrollback() {
  const terminalConfiguration = vscode.workspace.getConfiguration('terminal.integrated');
  const originalScrollback = terminalConfiguration.get('scrollback', 1000);
  const updatedScrollback = originalScrollback === 240 ? 320 : 240;

  await clearHostMessages();
  await setTerminalIntegratedScrollback(updatedScrollback);

  try {
    const hostMessages = await waitForHostMessages(
      (messages) =>
        messages.some(
          (message) =>
            message.type === 'host/stateUpdated' &&
            message.payload.runtime?.terminalScrollback === updatedScrollback
        ),
      20000
    );
    assert.ok(
      hostMessages.some(
        (message) =>
          message.type === 'host/stateUpdated' &&
          message.payload.runtime?.terminalScrollback === updatedScrollback
      ),
      'Expected host to push an updated runtime context after changing terminal.integrated.scrollback.'
    );
  } finally {
    await clearHostMessages();
    await setTerminalIntegratedScrollback(originalScrollback);
    await waitForHostMessages(
      (messages) =>
        messages.some(
          (message) =>
            message.type === 'host/stateUpdated' &&
            message.payload.runtime?.terminalScrollback === originalScrollback
        ),
      20000
    );
  }
}

async function verifyTerminalShellPathRefreshesStoppedTerminalNode() {
  const configuration = vscode.workspace.getConfiguration();
  const originalShellSetting = configuration.inspect('devSessionCanvas.terminal.shell');
  const originalShellPathSetting = configuration.inspect('devSessionCanvas.terminal.shellPath');
  const configurationTarget = resolvePreferredTerminalShellSettingsTarget();
  let terminalNodeId;

  await vscode.commands.executeCommand(COMMAND_IDS.testResetState);
  await vscode.commands.executeCommand(COMMAND_IDS.testCreateNode, 'terminal');

  try {
    let snapshot = await waitForSnapshot((currentSnapshot) => {
      return currentSnapshot.state.nodes.filter((node) => node.kind === 'terminal').length === 1;
    }, 20000);
    let terminalNode = findNodeByKind(snapshot, 'terminal');
    terminalNodeId = terminalNode.id;

    snapshot = await waitForTerminalLive(terminalNodeId);
    terminalNode = findNodeById(snapshot, terminalNodeId);

    const expectedShellPath = await resolveAlternateTerminalShellPath(
      terminalNode.metadata?.terminal?.shellPath ?? ''
    );

    snapshot = await ensureTerminalStopped(terminalNodeId);
    assert.strictEqual(findNodeById(snapshot, terminalNodeId).metadata.terminal.liveSession, false);

    await setTerminalShell('default', configurationTarget);
    await setTerminalShellPath(expectedShellPath, configurationTarget);

    snapshot = await waitForSnapshot((currentSnapshot) => {
      const currentNode = currentSnapshot.state.nodes.find((node) => node.id === terminalNodeId);
      return currentNode?.metadata?.terminal?.shellPath === expectedShellPath && !currentNode?.metadata?.terminal?.liveSession;
    }, 20000);
    assert.strictEqual(findNodeById(snapshot, terminalNodeId).metadata.terminal.shellPath, expectedShellPath);

    await startExecutionSessionForTest({
      kind: 'terminal',
      nodeId: terminalNodeId,
      cols: 92,
      rows: 28
    });

    snapshot = await waitForTerminalLive(terminalNodeId);
    assert.strictEqual(findNodeById(snapshot, terminalNodeId).metadata.terminal.shellPath, expectedShellPath);
  } finally {
    if (terminalNodeId) {
      await ensureTerminalStopped(terminalNodeId).catch(() => {});
    }
    await vscode.commands.executeCommand(COMMAND_IDS.testResetState);
    await restoreTerminalShellSetting('devSessionCanvas.terminal.shell', originalShellSetting);
    await restoreTerminalShellSetting('devSessionCanvas.terminal.shellPath', originalShellPathSetting);
  }
}

async function verifySelectTerminalShellCommandPersistsExactDetectedPath() {
  const configuration = vscode.workspace.getConfiguration();
  const originalShellSetting = configuration.inspect('devSessionCanvas.terminal.shell');
  const originalShellPathSetting = configuration.inspect('devSessionCanvas.terminal.shellPath');
  const configurationTarget = resolvePreferredTerminalShellSettingsTarget();
  const originalPathEnv = process.env.PATH || '';
  const fakeShellRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dsc-select-terminal-shell-'));
  const shellBinaryName = process.platform === 'win32' ? 'bash.exe' : 'bash';
  const firstDir = path.join(fakeShellRoot, 'first');
  const secondDir = path.join(fakeShellRoot, 'second');
  const firstShellPath = path.join(firstDir, shellBinaryName);
  const secondShellPath = path.join(secondDir, shellBinaryName);

  await fs.mkdir(firstDir, { recursive: true });
  await fs.mkdir(secondDir, { recursive: true });
  await createFakeExecutableShell(firstShellPath);
  await createFakeExecutableShell(secondShellPath);

  try {
    process.env.PATH = [firstDir, secondDir, originalPathEnv].filter(Boolean).join(path.delimiter);
    await setTerminalShell('default', configurationTarget);
    await setTerminalShellPath(secondShellPath, configurationTarget);

    await withInterceptedQuickPicks(
      async (quickPickCalls) => {
        await withInterceptedInformationMessages(async () => {
          await vscode.commands.executeCommand(COMMAND_IDS.selectTerminalShell);
        });
        assert.strictEqual(quickPickCalls.length, 1, 'Expected terminal shell selection command to open one Quick Pick.');
      },
      async ({ items }) => {
        const picked = items.find(
          (item) => normalizeShellPath(item.resolvedPath || '') === normalizeShellPath(secondShellPath)
        );
        assert.ok(picked, `Expected Quick Pick to include the explicitly chosen shell path: ${secondShellPath}`);
        return picked;
      }
    );

    const refreshedConfiguration = vscode.workspace.getConfiguration();
    const configuredShell = normalizeTerminalShellSelection(
      refreshedConfiguration.get('devSessionCanvas.terminal.shell', 'default')
    );
    assert.ok(
      configuredShell === 'default' || configuredShell === 'bash',
      `Expected terminal shell selection command to preserve a compatible shell type, got: ${configuredShell}`
    );
    assert.strictEqual(
      normalizeShellPath(refreshedConfiguration.get('devSessionCanvas.terminal.shellPath', '')),
      normalizeShellPath(secondShellPath)
    );
  } finally {
    process.env.PATH = originalPathEnv;
    await restoreTerminalShellSetting('devSessionCanvas.terminal.shell', originalShellSetting);
    await restoreTerminalShellSetting('devSessionCanvas.terminal.shellPath', originalShellPathSetting);
    await fs.rm(fakeShellRoot, { recursive: true, force: true });
  }
}

async function verifySelectTerminalShellCommandUpdatesWorkspaceOverride() {
  const configuration = vscode.workspace.getConfiguration();
  const originalShellSetting = configuration.inspect('devSessionCanvas.terminal.shell');
  const originalShellPathSetting = configuration.inspect('devSessionCanvas.terminal.shellPath');
  const originalPathEnv = process.env.PATH || '';
  const fakeShellRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dsc-workspace-terminal-shell-'));
  const shellBinaryName = process.platform === 'win32' ? 'bash.exe' : 'bash';
  const firstDir = path.join(fakeShellRoot, 'first');
  const secondDir = path.join(fakeShellRoot, 'second');
  const firstShellPath = path.join(firstDir, shellBinaryName);
  const secondShellPath = path.join(secondDir, shellBinaryName);

  assert.ok(hasWorkspaceSettingsTarget(), 'Expected workspace-scoped terminal shell smoke to run inside an open workspace.');

  await fs.mkdir(firstDir, { recursive: true });
  await fs.mkdir(secondDir, { recursive: true });
  await createFakeExecutableShell(firstShellPath);
  await createFakeExecutableShell(secondShellPath);

  try {
    process.env.PATH = [firstDir, secondDir, originalPathEnv].filter(Boolean).join(path.delimiter);
    await setTerminalShell('default', vscode.ConfigurationTarget.Global);
    await setTerminalShellPath(secondShellPath, vscode.ConfigurationTarget.Global);
    await setTerminalShell('bash', vscode.ConfigurationTarget.Workspace);
    await setTerminalShellPath(undefined, vscode.ConfigurationTarget.Workspace);

    await withInterceptedQuickPicks(
      async () => {
        await withInterceptedInformationMessages(async () => {
          await vscode.commands.executeCommand(COMMAND_IDS.selectTerminalShell);
        });
      },
      async ({ items }) => {
        const picked = items.find(
          (item) => normalizeShellPath(item.resolvedPath || '') === normalizeShellPath(firstShellPath)
        );
        assert.ok(picked, `Expected Quick Pick to include the detected workspace override shell path: ${firstShellPath}`);
        return picked;
      }
    );

    const refreshedConfiguration = vscode.workspace.getConfiguration();
    const refreshedShellSetting = refreshedConfiguration.inspect('devSessionCanvas.terminal.shell');
    const refreshedShellPathSetting = refreshedConfiguration.inspect('devSessionCanvas.terminal.shellPath');
    assert.strictEqual(
      normalizeTerminalShellSelection(refreshedConfiguration.get('devSessionCanvas.terminal.shell', 'default')),
      'bash',
      'Expected shell selection command to keep the logical shell type effective when a workspace override is active.'
    );
    assert.strictEqual(
      normalizeShellPath(refreshedConfiguration.get('devSessionCanvas.terminal.shellPath', '')),
      normalizeShellPath(firstShellPath),
      'Expected shell selection command to make the workspace override path take effect when a workspace override is active.'
    );
    assert.strictEqual(
      normalizeShellPath(refreshedShellPathSetting?.globalValue || ''),
      normalizeShellPath(secondShellPath),
      'Expected shell selection command to leave the device-level shell path unchanged when updating a workspace override.'
    );
  } finally {
    process.env.PATH = originalPathEnv;
    await restoreTerminalShellSetting('devSessionCanvas.terminal.shell', originalShellSetting);
    await restoreTerminalShellSetting('devSessionCanvas.terminal.shellPath', originalShellPathSetting);
    await fs.rm(fakeShellRoot, { recursive: true, force: true });
  }
}

async function verifyDefaultSurfaceRequiresReload() {
  const configuration = vscode.workspace.getConfiguration();
  const originalSurface =
    configuration.get('devSessionCanvas.canvas.defaultSurface', 'panel') === 'editor' ? 'editor' : 'panel';
  const updatedSurface = originalSurface === 'panel' ? 'editor' : 'panel';
  const openSurface = async (surface) => {
    await vscode.commands.executeCommand(
      surface === 'editor' ? COMMAND_IDS.openCanvasInEditor : COMMAND_IDS.openCanvasInPanel
    );
    await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, surface, 20000);
  };

  await openSurface(originalSurface);
  await setDefaultSurface(updatedSurface);

  try {
    let snapshot = await getDebugSnapshot();
    assert.strictEqual(snapshot.activeSurface, originalSurface);
    assert.strictEqual(snapshot.sidebar.configuredSurface, originalSurface);
    assert.strictEqual(snapshot.sidebar.surfaceLocation, originalSurface);

    await vscode.commands.executeCommand(COMMAND_IDS.openCanvas);
    await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, originalSurface, 20000);

    snapshot = await getDebugSnapshot();
    assert.strictEqual(snapshot.activeSurface, originalSurface);
    assert.strictEqual(snapshot.sidebar.configuredSurface, originalSurface);
    assert.strictEqual(snapshot.sidebar.surfaceLocation, originalSurface);

    snapshot = await simulateRuntimeReload();
    assert.strictEqual(snapshot.activeSurface, updatedSurface);
    assert.strictEqual(snapshot.sidebar.configuredSurface, updatedSurface);
    assert.strictEqual(snapshot.sidebar.surfaceLocation, updatedSurface);
    assert.notStrictEqual(snapshot.activeSurface, originalSurface);
    assert.notStrictEqual(snapshot.sidebar.surfaceLocation, originalSurface);

    await vscode.commands.executeCommand(COMMAND_IDS.openCanvas);
    await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, updatedSurface, 20000);

    snapshot = await getDebugSnapshot();
    assert.strictEqual(snapshot.activeSurface, updatedSurface);
    assert.strictEqual(snapshot.sidebar.configuredSurface, updatedSurface);
    assert.strictEqual(snapshot.sidebar.surfaceLocation, updatedSurface);
  } finally {
    await setDefaultSurface(originalSurface);
    await simulateRuntimeReload();
    await openSurface(originalSurface);
  }
}

async function verifyManualEdgeLifecycle(agentNodeId, terminalNodeId) {
  await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInPanel);
  await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'panel', 20000);

  await dispatchWebviewMessage(
    {
      type: 'webview/createEdge',
      payload: {
        sourceNodeId: agentNodeId,
        targetNodeId: terminalNodeId,
        sourceAnchor: 'right',
        targetAnchor: 'left'
      }
    },
    'panel'
  );

  let snapshot = await waitForSnapshot((currentSnapshot) => {
    return currentSnapshot.state.edges.some(
      (edge) =>
        edge.owner === 'user' &&
        edge.sourceNodeId === agentNodeId &&
        edge.targetNodeId === terminalNodeId
    );
  }, 20000);
  let edge = snapshot.state.edges.find(
    (currentEdge) =>
      currentEdge.owner === 'user' &&
      currentEdge.sourceNodeId === agentNodeId &&
      currentEdge.targetNodeId === terminalNodeId
  );
  assert.ok(edge, 'Expected manual edge to be created.');
  assert.strictEqual(edge.arrowMode, 'forward');
  assert.strictEqual(edge.label, undefined);

  let panelProbe = await waitForWebviewProbeOnSurface(
    'panel',
    (currentProbe) => currentProbe.edges.some((currentEdge) => currentEdge.edgeId === edge.id),
    10000
  );
  assert.ok(panelProbe.edges.some((currentEdge) => currentEdge.edgeId === edge.id && !currentEdge.selected));

  await performWebviewDomAction(
    {
      kind: 'selectEdge',
      nodeId: agentNodeId,
      edgeId: edge.id
    },
    'panel',
    10000
  );
  panelProbe = await waitForWebviewProbeOnSurface(
    'panel',
    (currentProbe) => currentProbe.edges.some((currentEdge) => currentEdge.edgeId === edge.id && currentEdge.selected),
    10000
  );
  assert.ok(panelProbe.edges.some((currentEdge) => currentEdge.edgeId === edge.id && currentEdge.selected));

  snapshot = await dispatchWebviewMessage(
    {
      type: 'webview/updateEdge',
      payload: {
        edgeId: edge.id,
        arrowMode: 'both',
        label: '宿主链路'
      }
    },
    'panel'
  );
  edge = findEdgeById(snapshot, edge.id);
  assert.strictEqual(edge.arrowMode, 'both');
  assert.strictEqual(edge.label, '宿主链路');

  snapshot = await reloadPersistedState();
  edge = findEdgeById(snapshot, edge.id);
  assert.strictEqual(edge.arrowMode, 'both');
  assert.strictEqual(edge.label, '宿主链路');

  snapshot = await dispatchWebviewMessage(
    {
      type: 'webview/deleteEdge',
      payload: {
        edgeId: edge.id
      }
    },
    'panel'
  );
  assert.strictEqual(snapshot.state.edges.some((currentEdge) => currentEdge.id === edge.id), false);

  snapshot = await reloadPersistedState();
  assert.strictEqual(snapshot.state.edges.some((currentEdge) => currentEdge.id === edge.id), false);
}

async function verifyFileActivityViewsAndOpenFiles() {
  const configuration = vscode.workspace.getConfiguration();
  const originalFilesEnabled = configuration.get('devSessionCanvas.files.enabled', false) === true;
  const originalPresentationMode =
    configuration.get('devSessionCanvas.files.presentationMode', 'lists') === 'nodes' ? 'nodes' : 'lists';
  const originalFileNodeDisplayStyle =
    configuration.get('devSessionCanvas.fileNode.displayStyle', 'minimal') === 'card' ? 'card' : 'minimal';
  const originalFileNodeDisplayMode =
    configuration.get('devSessionCanvas.files.nodeDisplayMode', 'icon-path') === 'path-only'
      ? 'path-only'
      : configuration.get('devSessionCanvas.files.nodeDisplayMode', 'icon-path') === 'icon-only'
        ? 'icon-only'
        : 'icon-path';
  const originalPathDisplayMode =
    configuration.get('devSessionCanvas.files.pathDisplayMode', 'basename') === 'relative-path'
      ? 'relative-path'
      : 'basename';
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(workspaceFolder, 'Smoke workspace is missing a workspace folder.');

  const scratchDir = path.join(workspaceFolder.uri.fsPath, '.debug', 'vscode-smoke', 'file-activity');
  const agentOnlyPath = path.join(scratchDir, 'agent-a-only.md');
  const agentOnlySecondaryPath = path.join(
    scratchDir,
    'path-only-width-regression',
    'alpha-beta-gamma-delta',
    'epsilon-zeta-eta-theta',
    'iota-kappa-lambda-mu',
    'agent-a-second-width-regression-check.txt'
  );
  const sharedPath = path.join(scratchDir, 'shared.ts');
  const agentBOnlyPath = path.join(scratchDir, 'agent-b-only.json');

  await fs.mkdir(scratchDir, { recursive: true });
  await fs.mkdir(path.dirname(agentOnlySecondaryPath), { recursive: true });
  await fs.writeFile(agentOnlyPath, '# agent a only\n', 'utf8');
  await fs.writeFile(agentOnlySecondaryPath, 'agent a second\n', 'utf8');
  await fs.writeFile(sharedPath, 'export const shared = true;\n', 'utf8');
  await fs.writeFile(agentBOnlyPath, '{\"owner\":\"agent-b\"}\n', 'utf8');

  let snapshot = await ensureFilesFeatureEnabledForSmoke('panel');
  const baselineSnapshot = snapshot;
  const baselineNodeIds = baselineSnapshot.state.nodes.map((node) => node.id).sort();
  const baselineFileFilters = {
    includeGlobs: [...baselineSnapshot.sidebar.fileFilters.includeGlobs],
    excludeGlobs: [...baselineSnapshot.sidebar.fileFilters.excludeGlobs]
  };
  const baselineAgentIds = new Set(
    baselineSnapshot.state.nodes.filter((node) => node.kind === 'agent').map((node) => node.id)
  );

  await setFilesPresentationMode('nodes');
  await setFileNodeDisplayStyle('minimal');
  await setFilesNodeDisplayMode('icon-path');
  await setFilesPathDisplayMode('basename');

  try {
    await vscode.commands.executeCommand(COMMAND_IDS.testCreateNode, 'agent');
    await vscode.commands.executeCommand(COMMAND_IDS.testCreateNode, 'agent');

    snapshot = await waitForSnapshot((currentSnapshot) => {
      const currentAgents = currentSnapshot.state.nodes.filter((node) => node.kind === 'agent');
      return currentAgents.length === baselineAgentIds.size + 2;
    }, 20000);

    const fileActivityAgentIds = snapshot.state.nodes
      .filter((node) => node.kind === 'agent' && !baselineAgentIds.has(node.id))
      .map((node) => node.id)
      .sort();
    assert.strictEqual(fileActivityAgentIds.length, 2, 'Expected two dedicated file-activity agents.');

    const [agentAId, agentBId] = fileActivityAgentIds;
    await waitForAgentLive(agentAId);
    await waitForAgentLive(agentBId);

    await dispatchWebviewMessage(
      {
        type: 'webview/executionInput',
        payload: {
          nodeId: agentAId,
          kind: 'agent',
          data: `read ${agentOnlyPath}\r`
        }
      },
      'panel'
    );
    snapshot = await waitForSnapshot((currentSnapshot) => {
      const reference = currentSnapshot.state.fileReferences.find((currentReference) => currentReference.filePath === agentOnlyPath);
      return Boolean(reference && reference.owners.some((owner) => owner.nodeId === agentAId && owner.accessMode === 'read'));
    }, 20000);

    await dispatchWebviewMessage(
      {
        type: 'webview/executionInput',
        payload: {
          nodeId: agentAId,
          kind: 'agent',
          data: `write ${agentOnlySecondaryPath}\r`
        }
      },
      'panel'
    );
    snapshot = await waitForSnapshot((currentSnapshot) => {
      const reference = currentSnapshot.state.fileReferences.find(
        (currentReference) => currentReference.filePath === agentOnlySecondaryPath
      );
      return Boolean(reference && reference.owners.some((owner) => owner.nodeId === agentAId && owner.accessMode === 'write'));
    }, 20000);

    await dispatchWebviewMessage(
      {
        type: 'webview/executionInput',
        payload: {
          nodeId: agentAId,
          kind: 'agent',
          data: `readwrite ${sharedPath}\r`
        }
      },
      'panel'
    );
    snapshot = await waitForSnapshot((currentSnapshot) => {
      const reference = currentSnapshot.state.fileReferences.find((currentReference) => currentReference.filePath === sharedPath);
      return Boolean(
        reference && reference.owners.some((owner) => owner.nodeId === agentAId && owner.accessMode === 'read-write')
      );
    }, 20000);

    await dispatchWebviewMessage(
      {
        type: 'webview/executionInput',
        payload: {
          nodeId: agentBId,
          kind: 'agent',
          data: `write ${agentBOnlyPath}\r`
        }
      },
      'panel'
    );
    snapshot = await waitForSnapshot((currentSnapshot) => {
      const reference = currentSnapshot.state.fileReferences.find((currentReference) => currentReference.filePath === agentBOnlyPath);
      return Boolean(reference && reference.owners.some((owner) => owner.nodeId === agentBId && owner.accessMode === 'write'));
    }, 20000);

    await dispatchWebviewMessage(
      {
        type: 'webview/executionInput',
        payload: {
          nodeId: agentBId,
          kind: 'agent',
          data: `write ${sharedPath}\r`
        }
      },
      'panel'
    );
    snapshot = await waitForSnapshot((currentSnapshot) => {
      const reference = currentSnapshot.state.fileReferences.find((currentReference) => currentReference.filePath === sharedPath);
      return Boolean(
        reference &&
          reference.owners.some((owner) => owner.nodeId === agentAId && owner.accessMode === 'read-write') &&
          reference.owners.some((owner) => owner.nodeId === agentBId && owner.accessMode === 'write')
      );
    }, 20000);

    assert.strictEqual(snapshot.state.fileReferences.length, 4);
    assert.strictEqual(snapshot.state.nodes.filter((node) => node.kind === 'file').length, 4);
    assert.strictEqual(snapshot.state.nodes.filter((node) => node.kind === 'file-list').length, 0);

    const agentOnlyFileNode = snapshot.state.nodes.find(
      (node) => node.kind === 'file' && node.metadata?.file?.filePath === agentOnlyPath
    );
    const agentOnlySecondaryFileNode = snapshot.state.nodes.find(
      (node) => node.kind === 'file' && node.metadata?.file?.filePath === agentOnlySecondaryPath
    );
    const agentBOnlyFileNode = snapshot.state.nodes.find(
      (node) => node.kind === 'file' && node.metadata?.file?.filePath === agentBOnlyPath
    );
    const sharedFileNode = snapshot.state.nodes.find(
      (node) => node.kind === 'file' && node.metadata?.file?.filePath === sharedPath
    );
    const agentANode = snapshot.state.nodes.find((node) => node.id === agentAId);
    const agentBNode = snapshot.state.nodes.find((node) => node.id === agentBId);
    assert.ok(agentOnlyFileNode, 'Expected agent-only file node to exist.');
    assert.ok(agentOnlySecondaryFileNode, 'Expected second agent-only file node to exist.');
    assert.ok(agentBOnlyFileNode, 'Expected agent B file node to exist.');
    assert.ok(sharedFileNode, 'Expected shared file node to exist.');
    assert.ok(agentANode, 'Expected agent A node to exist.');
    assert.ok(agentBNode, 'Expected agent B node to exist.');
    assert.deepStrictEqual(agentOnlyFileNode.metadata.file.ownerNodeIds, [agentAId]);
    assert.deepStrictEqual(agentOnlySecondaryFileNode.metadata.file.ownerNodeIds, [agentAId]);
    assert.deepStrictEqual(agentBOnlyFileNode.metadata.file.ownerNodeIds, [agentBId]);
    assert.deepStrictEqual(sharedFileNode.metadata.file.ownerNodeIds.slice().sort(), [agentAId, agentBId].sort());
    assert.notDeepStrictEqual(
      agentOnlyFileNode.position,
      agentOnlySecondaryFileNode.position,
      'Expected same-agent single-file nodes to receive distinct automatic positions.'
    );
    assert.ok(
      !rectanglesOverlap(agentOnlyFileNode, agentOnlySecondaryFileNode),
      'Expected same-agent single-file nodes to avoid overlapping when auto-placed.'
    );

    const agentACenterX = agentANode.position.x + agentANode.size.width / 2;
    const agentBCenterX = agentBNode.position.x + agentBNode.size.width / 2;
    const agentAAnchorY = agentANode.position.y + agentANode.size.height / 3;
    const agentBAnchorY = agentBNode.position.y + agentBNode.size.height / 3;
    const agentOnlyCenterX = agentOnlyFileNode.position.x + agentOnlyFileNode.size.width / 2;
    const agentOnlyCenterY = agentOnlyFileNode.position.y + agentOnlyFileNode.size.height / 2;
    const agentOnlySecondaryCenterX = agentOnlySecondaryFileNode.position.x + agentOnlySecondaryFileNode.size.width / 2;
    const agentOnlySecondaryCenterY = agentOnlySecondaryFileNode.position.y + agentOnlySecondaryFileNode.size.height / 2;
    const agentBOnlyCenterX = agentBOnlyFileNode.position.x + agentBOnlyFileNode.size.width / 2;
    const agentBOnlyCenterY = agentBOnlyFileNode.position.y + agentBOnlyFileNode.size.height / 2;

    assert.ok(
      agentOnlyCenterX < agentACenterX,
      'Expected read-only file nodes to auto-place to the left of the owning agent.'
    );
    assert.ok(
      agentOnlyCenterY <= agentAAnchorY,
      'Expected read-only file nodes to auto-place at or above the owning agent anchor.'
    );
    assert.ok(
      agentOnlySecondaryCenterX > agentACenterX,
      'Expected write-only file nodes to auto-place to the right of the owning agent.'
    );
    assert.ok(
      agentOnlySecondaryCenterY >= agentAAnchorY,
      'Expected write-only file nodes to auto-place at or below the owning agent anchor.'
    );
    assert.ok(
      agentBOnlyCenterX > agentBCenterX,
      'Expected agent B write-only file nodes to auto-place to the right of the owning agent.'
    );
    assert.ok(
      agentBOnlyCenterY >= agentBAnchorY,
      'Expected agent B write-only file nodes to auto-place at or below the owning agent anchor.'
    );

    const readOnlyAutoEdge = snapshot.state.edges.find(
      (edge) => edge.owner === 'file-activity' && edge.sourceNodeId === agentOnlyFileNode.id && edge.targetNodeId === agentAId
    );
    const writeOnlyAutoEdge = snapshot.state.edges.find(
      (edge) =>
        edge.owner === 'file-activity' && edge.sourceNodeId === agentAId && edge.targetNodeId === agentOnlySecondaryFileNode.id
    );
    assert.ok(readOnlyAutoEdge, 'Expected read-only automatic file-activity edge to exist.');
    assert.strictEqual(readOnlyAutoEdge.sourceAnchor, 'right');
    assert.strictEqual(readOnlyAutoEdge.targetAnchor, 'left');
    assert.ok(writeOnlyAutoEdge, 'Expected write-only automatic file-activity edge to exist.');
    assert.strictEqual(writeOnlyAutoEdge.sourceAnchor, 'right');
    assert.strictEqual(writeOnlyAutoEdge.targetAnchor, 'left');

    const fileNodeLayoutSnapshot = collectNodeLayoutSnapshot(snapshot, 'file');
    const fileNodePositionSnapshot = collectNodePositionSnapshot(snapshot, 'file');
    const automaticFileEdgeIds = collectAutomaticFileEdgeIds(snapshot);

    await setFileNodeDisplayStyle('card');
    snapshot = await waitForSnapshot((currentSnapshot) => {
      return (
        currentSnapshot.state.nodes.filter((node) => node.kind === 'file').length === 4 &&
        JSON.stringify(collectNodeLayoutSnapshot(currentSnapshot, 'file')) !==
          JSON.stringify(fileNodeLayoutSnapshot) &&
        JSON.stringify(collectAutomaticFileEdgeIds(currentSnapshot)) === JSON.stringify(automaticFileEdgeIds)
      );
    }, 20000);
    assert.deepStrictEqual(collectNodePositionSnapshot(snapshot, 'file'), fileNodePositionSnapshot);
    assert.deepStrictEqual(collectAutomaticFileEdgeIds(snapshot), automaticFileEdgeIds);
    assert.notDeepStrictEqual(collectNodeLayoutSnapshot(snapshot, 'file'), fileNodeLayoutSnapshot);

    await setFileNodeDisplayStyle('minimal');
    snapshot = await waitForSnapshot((currentSnapshot) => {
      return (
        currentSnapshot.state.nodes.filter((node) => node.kind === 'file').length === 4 &&
        JSON.stringify(collectNodeLayoutSnapshot(currentSnapshot, 'file')) ===
          JSON.stringify(fileNodeLayoutSnapshot) &&
        JSON.stringify(collectAutomaticFileEdgeIds(currentSnapshot)) === JSON.stringify(automaticFileEdgeIds)
      );
    }, 20000);
    assert.deepStrictEqual(collectNodePositionSnapshot(snapshot, 'file'), fileNodePositionSnapshot);
    assert.deepStrictEqual(collectAutomaticFileEdgeIds(snapshot), automaticFileEdgeIds);

    const agentOnlyMinimalSizeBeforeReload = findNodeById(snapshot, agentOnlyFileNode.id).size;
    snapshot = await reloadPersistedState();
    assert.deepStrictEqual(collectNodeLayoutSnapshot(snapshot, 'file'), fileNodeLayoutSnapshot);
    assert.deepStrictEqual(
      findNodeById(snapshot, agentOnlyFileNode.id).size,
      agentOnlyMinimalSizeBeforeReload,
      'Expected minimal single-file node size to remain stable across reload.'
    );
    assert.deepStrictEqual(collectAutomaticFileEdgeIds(snapshot), automaticFileEdgeIds);

    await setFilesNodeDisplayMode('path-only');
    await setFilesPathDisplayMode('relative-path');
    snapshot = await waitForSnapshot((currentSnapshot) => {
      const longPathNode = currentSnapshot.state.nodes.find(
        (node) => node.kind === 'file' && node.metadata?.file?.filePath === agentOnlySecondaryPath
      );
      return Boolean(longPathNode && longPathNode.size.width > 320);
    }, 20000);

    const pathOnlyLongFileNode = snapshot.state.nodes.find(
      (node) => node.kind === 'file' && node.metadata?.file?.filePath === agentOnlySecondaryPath
    );
    assert.ok(pathOnlyLongFileNode, 'Expected long-path file node to exist after switching to path-only.');
    assert.strictEqual(
      pathOnlyLongFileNode.title,
      agentOnlySecondaryFileNode.metadata.file.relativePath,
      'Expected path-only file node title to switch to the workspace-relative path.'
    );
    assert.ok(
      pathOnlyLongFileNode.size.width > 320,
      'Expected path-only minimal file node width to grow past the previous capped default.'
    );
    assert.deepStrictEqual(
      pathOnlyLongFileNode.position,
      agentOnlySecondaryFileNode.position,
      'Expected path-only width expansion to preserve the existing automatic node position.'
    );

    const pathOnlyWidthBeforeReload = pathOnlyLongFileNode.size.width;
    snapshot = await reloadPersistedState();
    const reloadedPathOnlyLongFileNode = snapshot.state.nodes.find(
      (node) => node.kind === 'file' && node.metadata?.file?.filePath === agentOnlySecondaryPath
    );
    assert.ok(reloadedPathOnlyLongFileNode, 'Expected long-path file node to survive reload in path-only mode.');
    assert.strictEqual(
      reloadedPathOnlyLongFileNode.size.width,
      pathOnlyWidthBeforeReload,
      'Expected widened path-only file node width to persist across reload.'
    );
    assert.deepStrictEqual(collectAutomaticFileEdgeIds(snapshot), automaticFileEdgeIds);

    await setFilesNodeDisplayMode('icon-path');
    await setFilesPathDisplayMode('basename');
    snapshot = await waitForSnapshot((currentSnapshot) => {
      return (
        currentSnapshot.state.nodes.filter((node) => node.kind === 'file').length === 4 &&
        JSON.stringify(collectNodeLayoutSnapshot(currentSnapshot, 'file')) ===
          JSON.stringify(fileNodeLayoutSnapshot) &&
        JSON.stringify(collectAutomaticFileEdgeIds(currentSnapshot)) === JSON.stringify(automaticFileEdgeIds)
      );
    }, 20000);
    assert.deepStrictEqual(
      collectNodeLayoutSnapshot(snapshot, 'file'),
      fileNodeLayoutSnapshot,
      'Expected icon-path basename file node layout to recover after returning from relative-path mode.'
    );
    assert.deepStrictEqual(collectAutomaticFileEdgeIds(snapshot), automaticFileEdgeIds);

    snapshot = await dispatchWebviewMessage(
      {
        type: 'webview/moveNode',
        payload: {
          id: agentOnlySecondaryFileNode.id,
          position: {
            x: agentANode.position.x - agentOnlySecondaryFileNode.size.width - 260,
            y: agentOnlySecondaryFileNode.position.y + 220
          }
        }
      },
      'panel'
    );
    const movedWriteOnlyFileNode = findNodeById(snapshot, agentOnlySecondaryFileNode.id);
    const movedWriteOnlyAutoEdge = findEdgeById(snapshot, writeOnlyAutoEdge.id);
    assert.ok(
      movedWriteOnlyFileNode.position.x + movedWriteOnlyFileNode.size.width / 2 < agentACenterX,
      'Expected moved write-only file node to end up on the left side of the owning agent.'
    );
    assert.strictEqual(
      movedWriteOnlyAutoEdge.sourceAnchor,
      'left',
      'Expected automatic write edge to switch to the left source anchor when the file node moves to the left of the agent.'
    );
    assert.strictEqual(
      movedWriteOnlyAutoEdge.targetAnchor,
      'right',
      'Expected automatic write edge to switch to the right target anchor when the file node moves to the left of the agent.'
    );

    snapshot = await dispatchWebviewMessage(
      {
        type: 'webview/moveNode',
        payload: {
          id: agentOnlyFileNode.id,
          position: {
            x: agentANode.position.x + agentANode.size.width + 260,
            y: Math.max(0, agentOnlyFileNode.position.y - 180)
          }
        }
      },
      'panel'
    );
    const movedReadOnlyFileNode = findNodeById(snapshot, agentOnlyFileNode.id);
    const movedReadOnlyAutoEdge = findEdgeById(snapshot, readOnlyAutoEdge.id);
    assert.ok(
      movedReadOnlyFileNode.position.x + movedReadOnlyFileNode.size.width / 2 > agentACenterX,
      'Expected moved read-only file node to end up on the right side of the owning agent.'
    );
    assert.strictEqual(
      movedReadOnlyAutoEdge.sourceAnchor,
      'left',
      'Expected automatic read edge to switch to the left source anchor when the file node moves to the right of the agent.'
    );
    assert.strictEqual(
      movedReadOnlyAutoEdge.targetAnchor,
      'right',
      'Expected automatic read edge to switch to the right target anchor when the file node moves to the right of the agent.'
    );

    await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInEditor);
    await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'editor', 20000);
    await waitForWebviewProbeOnSurface('editor', (probe) => probe.hasDocumentFocus === true, 10000);

    await performWebviewDomAction(
      {
        kind: 'clickFileEntry',
        nodeId: agentOnlySecondaryFileNode.id,
        filePath: agentOnlySecondaryPath
      },
      'editor',
      10000
    );
    let editorSurfaceFileEditor = await waitForVisibleEditor(
      (editor) => editor.document.uri.fsPath === agentOnlySecondaryPath,
      10000
    );
    assert.strictEqual(
      editorSurfaceFileEditor.viewColumn,
      vscode.ViewColumn.Two,
      'Expected editor-surface file opens to create a split editor group when none exists.'
    );
    let editorSurfaceProbe = await captureWebviewProbe('editor', 2000);
    assert.ok(
      editorSurfaceProbe.hasCanvasShell && editorSurfaceProbe.hasReactFlow,
      'Expected editor-surface canvas to remain mounted after opening a file beside it.'
    );
    await closeVisibleEditor(agentOnlySecondaryPath);

    const editorSurfaceSentinel = await prepareBackgroundOpenFocusSentinel(
      vscode.ViewColumn.Two,
      'file-open-editor-surface-sentinel.txt'
    );
    await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInEditor);
    await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'editor', 20000);
    await waitForWebviewProbeOnSurface('editor', (probe) => probe.hasDocumentFocus === true, 10000);

    await performWebviewDomAction(
      {
        kind: 'clickFileEntry',
        nodeId: sharedFileNode.id,
        filePath: sharedPath
      },
      'editor',
      10000
    );
    editorSurfaceFileEditor = await waitForVisibleEditor((editor) => editor.document.uri.fsPath === sharedPath, 10000);
    assert.strictEqual(
      editorSurfaceFileEditor.viewColumn,
      vscode.ViewColumn.Two,
      'Expected editor-surface file opens to reuse the existing split editor group.'
    );
    editorSurfaceProbe = await captureWebviewProbe('editor', 2000);
    assert.ok(
      editorSurfaceProbe.hasCanvasShell && editorSurfaceProbe.hasReactFlow,
      'Expected editor-surface canvas to remain mounted after reusing the split editor group.'
    );
    await closeVisibleEditor(sharedPath);
    await closeVisibleEditor(editorSurfaceSentinel.document.uri.fsPath);

    await setFileIncludeFilterGlobs(['**/*.ts', '**/*.json']);
    await setFileExcludeFilterGlobs(['**/agent-b-only.json']);
    snapshot = await waitForSnapshot((currentSnapshot) => {
      const projectedFileNodes = currentSnapshot.state.nodes.filter((node) => node.kind === 'file');
      return (
        currentSnapshot.state.fileReferences.length === 4 &&
        currentSnapshot.sidebar.fileFilters.includeGlobs.length === 2 &&
        currentSnapshot.sidebar.fileFilters.excludeGlobs.length === 1 &&
        projectedFileNodes.length === 1 &&
        projectedFileNodes[0]?.metadata?.file?.filePath === sharedPath
      );
    }, 20000);
    assert.ok(
      snapshot.state.fileReferences.some((reference) => reference.filePath === agentBOnlyPath),
      'Expected fileReferences to keep excluded files as authoritative state.'
    );
    assert.deepStrictEqual(snapshot.sidebar.fileFilters.includeGlobs, ['**/*.ts', '**/*.json']);
    assert.deepStrictEqual(snapshot.sidebar.fileFilters.excludeGlobs, ['**/agent-b-only.json']);

    snapshot = await reloadPersistedState();
    assert.strictEqual(snapshot.state.fileReferences.length, 4);
    assert.strictEqual(snapshot.state.nodes.filter((node) => node.kind === 'file').length, 1);
    assert.ok(
      snapshot.state.nodes.some((node) => node.kind === 'file' && node.metadata?.file?.filePath === sharedPath),
      'Expected file projection filters to survive reload without mutating fileReferences.'
    );
    assert.deepStrictEqual(snapshot.sidebar.fileFilters.includeGlobs, ['**/*.ts', '**/*.json']);
    assert.deepStrictEqual(snapshot.sidebar.fileFilters.excludeGlobs, ['**/agent-b-only.json']);

    await setFileIncludeFilterGlobs([]);
    await setFileExcludeFilterGlobs([]);
    snapshot = await waitForSnapshot((currentSnapshot) => {
      return (
        currentSnapshot.state.fileReferences.length === 4 &&
        currentSnapshot.sidebar.fileFilters.includeGlobs.length === 0 &&
        currentSnapshot.sidebar.fileFilters.excludeGlobs.length === 0 &&
        currentSnapshot.state.nodes.filter((node) => node.kind === 'file').length === 4
      );
    }, 20000);

    await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInPanel);
    await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'panel', 20000);

    await dispatchWebviewMessage(
      {
        type: 'webview/deleteNode',
        payload: {
          nodeId: agentOnlyFileNode.id
        }
      },
      'panel'
    );
    snapshot = await waitForSnapshot((currentSnapshot) => {
      return (
        currentSnapshot.state.nodes.filter((node) => node.kind === 'file').length === 3 &&
        !currentSnapshot.state.nodes.some((node) => node.id === agentOnlyFileNode.id) &&
        currentSnapshot.state.fileReferences.some((currentReference) => currentReference.filePath === agentOnlyPath)
      );
    }, 20000);
    assert.strictEqual(
      snapshot.state.nodes.some((node) => node.id === agentOnlyFileNode.id),
      false,
      'Expected manually deleted single-file nodes to stay hidden while file references remain.'
    );

    assert.ok(
      snapshot.state.edges.some(
        (edge) => edge.owner === 'file-activity' && edge.targetNodeId === sharedFileNode.id && edge.sourceNodeId === agentAId
      ),
      'Expected automatic file-activity edge from agent A to the shared file node.'
    );
    assert.ok(
      snapshot.state.edges.some(
        (edge) => edge.owner === 'file-activity' && edge.targetNodeId === sharedFileNode.id && edge.sourceNodeId === agentBId
      ),
      'Expected automatic file-activity edge from agent B to the shared file node.'
    );

    let sharedAutoEdge = snapshot.state.edges.find(
      (edge) => edge.owner === 'file-activity' && edge.targetNodeId === sharedFileNode.id && edge.sourceNodeId === agentAId
    );
    assert.ok(sharedAutoEdge, 'Expected agent A shared file edge to exist before customization.');

    snapshot = await dispatchWebviewMessage(
      {
        type: 'webview/updateEdge',
        payload: {
          edgeId: sharedAutoEdge.id,
          label: '共享写入',
          color: '5'
        }
      },
      'panel'
    );
    sharedAutoEdge = findEdgeById(snapshot, sharedAutoEdge.id);
    assert.strictEqual(sharedAutoEdge.owner, 'user');
    assert.strictEqual(sharedAutoEdge.label, '共享写入');
    assert.strictEqual(sharedAutoEdge.color, '5');
    assert.ok(snapshot.state.suppressedFileActivityEdgeIds.includes(sharedAutoEdge.id));

    snapshot = await reloadPersistedState();
    sharedAutoEdge = findEdgeById(snapshot, sharedAutoEdge.id);
    assert.strictEqual(sharedAutoEdge.owner, 'user');
    assert.strictEqual(sharedAutoEdge.label, '共享写入');
    assert.strictEqual(sharedAutoEdge.color, '5');
    assert.ok(snapshot.state.suppressedFileActivityEdgeIds.includes(sharedAutoEdge.id));

    snapshot = await dispatchWebviewMessage(
      {
        type: 'webview/deleteEdge',
        payload: {
          edgeId: sharedAutoEdge.id
        }
      },
      'panel'
    );
    assert.strictEqual(snapshot.state.edges.some((edge) => edge.id === sharedAutoEdge.id), false);
    assert.ok(snapshot.state.suppressedFileActivityEdgeIds.includes(sharedAutoEdge.id));

    snapshot = await reloadPersistedState();
    assert.strictEqual(snapshot.state.edges.some((edge) => edge.id === sharedAutoEdge.id), false);
    assert.ok(snapshot.state.suppressedFileActivityEdgeIds.includes(sharedAutoEdge.id));

    const sentinelEditor = await prepareBackgroundOpenFocusSentinel();
    await performWebviewDomAction(
      {
        kind: 'clickFileEntry',
        nodeId: agentOnlySecondaryFileNode.id,
        filePath: agentOnlySecondaryPath
      },
      'panel',
      10000
    );
    await waitForVisibleEditor(
      (editor) => editor.document.uri.fsPath === agentOnlySecondaryPath,
      10000
    );
    const panelSurfaceProbe = await captureWebviewProbe('panel', 2000);
    assert.ok(
      panelSurfaceProbe.hasCanvasShell && panelSurfaceProbe.hasReactFlow,
      'Expected panel-surface canvas to remain mounted after opening a file in the editor area.'
    );
    // Panel route only requires the file to open in the editor area without forcing extra root-element focus semantics.
    await closeVisibleEditor(agentOnlySecondaryPath);

    await vscode.window.showTextDocument(sentinelEditor.document, {
      preview: false,
      preserveFocus: false,
      viewColumn: vscode.ViewColumn.One
    });
    await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInPanel);
    await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'panel', 20000);

    await setFilesPresentationMode('lists');
    await setFilesPathDisplayMode('relative-path');

    snapshot = await waitForSnapshot((currentSnapshot) => {
      return (
        currentSnapshot.state.nodes.filter((node) => node.kind === 'file').length === 0 &&
        currentSnapshot.state.nodes.filter((node) => node.kind === 'file-list').length === 3
      );
    }, 20000);

    const agentAListNode = snapshot.state.nodes.find(
      (node) => node.kind === 'file-list' && node.metadata?.fileList?.scope === 'agent' && node.metadata.fileList.ownerNodeId === agentAId
    );
    const agentBListNode = snapshot.state.nodes.find(
      (node) => node.kind === 'file-list' && node.metadata?.fileList?.scope === 'agent' && node.metadata.fileList.ownerNodeId === agentBId
    );
    const sharedListNode = snapshot.state.nodes.find(
      (node) => node.kind === 'file-list' && node.metadata?.fileList?.scope === 'shared'
    );
    assert.ok(agentAListNode, 'Expected agent A file list node to exist.');
    assert.ok(agentBListNode, 'Expected agent B file list node to exist.');
    assert.ok(sharedListNode, 'Expected shared file list node to exist.');
    assert.strictEqual(agentAListNode.metadata.fileList.entries.length, 2);
    assert.strictEqual(agentBListNode.metadata.fileList.entries.length, 1);
    assert.strictEqual(sharedListNode.metadata.fileList.entries.length, 1);
    assert.strictEqual(sharedListNode.metadata.fileList.entries[0].filePath, sharedPath);
    assert.strictEqual(sharedListNode.metadata.fileList.entries[0].accessMode, 'read-write');

    await performWebviewDomAction(
      {
        kind: 'clickFileEntry',
        nodeId: sharedListNode.id,
        filePath: sharedPath
      },
      'panel',
      10000
    );
    await waitForVisibleEditor(
      (editor) => editor.document.uri.fsPath === sharedPath,
      10000
    );
    const panelListProbe = await captureWebviewProbe('panel', 2000);
    assert.ok(
      panelListProbe.hasCanvasShell && panelListProbe.hasReactFlow,
      'Expected panel-surface canvas to remain mounted after opening a file list entry in the editor area.'
    );
    await closeVisibleEditor(sharedPath);

    await performWebviewDomAction(
      {
        kind: 'clickNodeActionButton',
        nodeId: sharedListNode.id,
        action: 'delete'
      },
      'panel',
      10000
    );
    snapshot = await waitForSnapshot((currentSnapshot) => {
      return (
        currentSnapshot.state.nodes.filter((node) => node.kind === 'file-list').length === 2 &&
        !currentSnapshot.state.nodes.some((node) => node.id === sharedListNode.id) &&
        currentSnapshot.state.fileReferences.some((currentReference) => currentReference.filePath === sharedPath)
      );
    }, 20000);
    assert.strictEqual(
      snapshot.state.nodes.some((node) => node.id === sharedListNode.id),
      false,
      'Expected manually deleted file-list nodes to stay hidden while file references remain.'
    );

    await dispatchWebviewMessage(
      {
        type: 'webview/deleteNode',
        payload: {
          nodeId: agentBId
        }
      },
      'panel'
    );
    snapshot = await waitForSnapshot((currentSnapshot) => {
      const sharedReference = currentSnapshot.state.fileReferences.find((currentReference) => currentReference.filePath === sharedPath);
      return (
        !currentSnapshot.state.nodes.some((node) => node.id === agentBId) &&
        !currentSnapshot.state.fileReferences.some((currentReference) => currentReference.filePath === agentBOnlyPath) &&
        Boolean(sharedReference && sharedReference.owners.length === 1 && sharedReference.owners[0].nodeId === agentAId) &&
        currentSnapshot.state.nodes.filter((node) => node.kind === 'file-list').length === 1
      );
    }, 20000);

    const survivingListNode = snapshot.state.nodes.find(
      (node) => node.kind === 'file-list' && node.metadata?.fileList?.scope === 'agent' && node.metadata.fileList.ownerNodeId === agentAId
    );
    assert.ok(survivingListNode, 'Expected agent A file list node to absorb the remaining files.');
    assert.deepStrictEqual(
      survivingListNode.metadata.fileList.entries.map((entry) => entry.filePath).sort(),
      [agentOnlyPath, agentOnlySecondaryPath, sharedPath].sort()
    );

    await dispatchWebviewMessage(
      {
        type: 'webview/deleteNode',
        payload: {
          nodeId: agentAId
        }
      },
      'panel'
    );
    snapshot = await waitForSnapshot((currentSnapshot) => {
      return (
        !currentSnapshot.state.nodes.some((node) => node.id === agentAId) &&
        currentSnapshot.state.fileReferences.length === 0 &&
        currentSnapshot.state.nodes.every((node) => node.kind !== 'file' && node.kind !== 'file-list')
      );
    }, 20000);

    assert.deepStrictEqual(
      snapshot.state.nodes.map((node) => node.id).sort(),
      baselineNodeIds
    );

    snapshot = await setPersistedState({
      version: 1,
      updatedAt: '2026-04-21T12:30:00.000Z',
      nodes: [...baselineSnapshot.state.nodes, agentANode, agentOnlyFileNode],
      edges: [...baselineSnapshot.state.edges, readOnlyAutoEdge],
      fileReferences: [
        {
          id: agentOnlyFileNode.metadata.file.fileId,
          filePath: agentOnlyPath,
          relativePath: agentOnlyFileNode.metadata.file.relativePath,
          updatedAt: '2026-04-21T12:30:00.000Z',
          owners: [
            {
              nodeId: agentAId,
              accessMode: 'read',
              updatedAt: '2026-04-21T12:30:00.000Z'
            }
          ]
        }
      ],
      suppressedFileActivityEdgeIds: [],
      suppressedAutomaticFileArtifactNodeIds: []
    });
    assert.ok(
      snapshot.state.fileReferences.some((reference) => reference.filePath === agentOnlyPath),
      'Expected seeded persisted state to preserve the authoritative file reference before toggling the files feature.'
    );
    assert.deepStrictEqual(
      snapshot.state.nodes
        .filter((node) => !baselineNodeIds.includes(node.id))
        .map((node) => node.kind)
        .sort(),
      ['agent', 'file-list'],
      'Expected seeded persisted state in list mode to reconcile into only the injected agent plus one projected file-list node.'
    );
    assert.strictEqual(
      snapshot.state.nodes.some((node) => node.id === agentOnlyFileNode.id),
      false,
      'Expected list mode reconciliation to replace the seeded single-file node with a projected file-list node.'
    );

    await setFileIncludeFilterGlobs(['**/*.md']);
    await setFileExcludeFilterGlobs(['**/agent-a-only.md']);
    snapshot = await waitForSnapshot((currentSnapshot) => {
      return (
        currentSnapshot.state.fileReferences.some((reference) => reference.filePath === agentOnlyPath) &&
        currentSnapshot.sidebar.fileFilters.includeGlobs.length === 1 &&
        currentSnapshot.sidebar.fileFilters.excludeGlobs.length === 1
      );
    }, 20000);
    assert.deepStrictEqual(snapshot.sidebar.fileFilters.includeGlobs, ['**/*.md']);
    assert.deepStrictEqual(snapshot.sidebar.fileFilters.excludeGlobs, ['**/agent-a-only.md']);

    await setFilesFeatureEnabled(false);
    snapshot = await getDebugSnapshot();
    assert.strictEqual(
      snapshot.sidebar.filesFeatureEnabled,
      true,
      'Expected files feature config changes to stay pending until runtime reload.'
    );
    assert.ok(
      snapshot.state.fileReferences.some((reference) => reference.filePath === agentOnlyPath),
      'Expected pending config changes to leave file activity state untouched before runtime reload.'
    );
    assert.deepStrictEqual(snapshot.sidebar.fileFilters.includeGlobs, ['**/*.md']);
    assert.deepStrictEqual(snapshot.sidebar.fileFilters.excludeGlobs, ['**/agent-a-only.md']);

    snapshot = await simulateRuntimeReload();
    assert.strictEqual(snapshot.sidebar.filesFeatureEnabled, false);
    assert.strictEqual(snapshot.state.fileReferences.length, 0);
    assert.ok(snapshot.state.nodes.every((node) => node.kind !== 'file' && node.kind !== 'file-list'));
    assert.ok(snapshot.state.edges.every((edge) => edge.owner !== 'file-activity'));
    assert.deepStrictEqual(snapshot.sidebar.fileFilters.includeGlobs, []);
    assert.deepStrictEqual(snapshot.sidebar.fileFilters.excludeGlobs, []);

    await setFilesFeatureEnabled(true);
    snapshot = await getDebugSnapshot();
    assert.strictEqual(
      snapshot.sidebar.filesFeatureEnabled,
      false,
      'Expected re-enabling the files feature to remain pending until the next runtime reload.'
    );
    assert.deepStrictEqual(snapshot.sidebar.fileFilters.includeGlobs, []);
    assert.deepStrictEqual(snapshot.sidebar.fileFilters.excludeGlobs, []);

    snapshot = await simulateRuntimeReload();
    assert.strictEqual(snapshot.sidebar.filesFeatureEnabled, true);
    assert.strictEqual(
      snapshot.state.fileReferences.length,
      0,
      'Expected re-enabling the files feature not to restore previously cleared fileReferences.'
    );
    assert.ok(snapshot.state.nodes.every((node) => node.kind !== 'file' && node.kind !== 'file-list'));
    assert.ok(snapshot.state.edges.every((edge) => edge.owner !== 'file-activity'));
    assert.deepStrictEqual(snapshot.sidebar.fileFilters.includeGlobs, []);
    assert.deepStrictEqual(snapshot.sidebar.fileFilters.excludeGlobs, []);

    snapshot = await setPersistedState(baselineSnapshot.state);
    await setFileIncludeFilterGlobs(baselineFileFilters.includeGlobs);
    await setFileExcludeFilterGlobs(baselineFileFilters.excludeGlobs);
    snapshot = await waitForSnapshot((currentSnapshot) => {
      return (
        JSON.stringify(currentSnapshot.sidebar.fileFilters.includeGlobs) ===
          JSON.stringify(baselineFileFilters.includeGlobs) &&
        JSON.stringify(currentSnapshot.sidebar.fileFilters.excludeGlobs) ===
          JSON.stringify(baselineFileFilters.excludeGlobs)
      );
    }, 20000);
    assert.deepStrictEqual(snapshot.state.fileReferences, baselineSnapshot.state.fileReferences);
    assert.deepStrictEqual(snapshot.state.suppressedFileActivityEdgeIds, baselineSnapshot.state.suppressedFileActivityEdgeIds);
    assert.deepStrictEqual(
      snapshot.state.suppressedAutomaticFileArtifactNodeIds,
      baselineSnapshot.state.suppressedAutomaticFileArtifactNodeIds
    );
    assert.ok(
      baselineNodeIds.every((nodeId) => snapshot.state.nodes.some((node) => node.id === nodeId)),
      'Expected restoring the baseline persisted state to keep all baseline nodes present.'
    );
    assert.deepStrictEqual(
      snapshot.state.nodes
        .filter((node) => !baselineNodeIds.includes(node.id))
        .map((node) => node.id)
        .sort(),
      [],
      'Expected restoring the baseline persisted state to clear any reconciled file-activity projection nodes.'
    );
  } finally {
    await setFilesFeatureEnabled(originalFilesEnabled);
    await setFilesPresentationMode(originalPresentationMode);
    await setFileNodeDisplayStyle(originalFileNodeDisplayStyle);
    await setFilesNodeDisplayMode(originalFileNodeDisplayMode);
    await setFilesPathDisplayMode(originalPathDisplayMode);
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInPanel);
    await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'panel', 20000);
  }
}

async function verifyReadExitFileActivityDrain() {
  const configuration = vscode.workspace.getConfiguration();
  const originalPresentationMode =
    configuration.get('devSessionCanvas.files.presentationMode', 'lists') === 'nodes' ? 'nodes' : 'lists';
  const originalFileNodeDisplayStyle =
    configuration.get('devSessionCanvas.fileNode.displayStyle', 'minimal') === 'card' ? 'card' : 'minimal';
  const originalPathDisplayMode =
    configuration.get('devSessionCanvas.files.pathDisplayMode', 'basename') === 'relative-path'
      ? 'relative-path'
      : 'basename';
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(workspaceFolder, 'Smoke workspace is missing a workspace folder.');

  const scratchDir = path.join(workspaceFolder.uri.fsPath, '.debug', 'vscode-smoke', 'file-activity-read-exit');
  const readExitPath = path.join(scratchDir, 'read-then-exit.ts');

  await fs.mkdir(scratchDir, { recursive: true });
  await fs.writeFile(readExitPath, 'export const readThenExit = true;\n', 'utf8');

  let snapshot = await ensureFilesFeatureEnabledForSmoke('panel');
  const baselineSnapshot = snapshot;
  const baselineNodeIds = baselineSnapshot.state.nodes.map((node) => node.id).sort();
  const baselineAgentIds = new Set(
    baselineSnapshot.state.nodes.filter((node) => node.kind === 'agent').map((node) => node.id)
  );

  await setFilesPresentationMode('nodes');
  await setFileNodeDisplayStyle('minimal');
  await setFilesPathDisplayMode('basename');

  try {
    await vscode.commands.executeCommand(COMMAND_IDS.testCreateNode, 'agent');

    snapshot = await waitForSnapshot((currentSnapshot) => {
      const currentAgents = currentSnapshot.state.nodes.filter((node) => node.kind === 'agent');
      return currentAgents.length === baselineAgentIds.size + 1;
    }, 20000);

    const [agentId] = snapshot.state.nodes
      .filter((node) => node.kind === 'agent' && !baselineAgentIds.has(node.id))
      .map((node) => node.id);
    assert.ok(agentId, 'Expected a dedicated read-exit file-activity agent.');

    await waitForAgentLive(agentId);

    await dispatchWebviewMessage(
      {
        type: 'webview/executionInput',
        payload: {
          nodeId: agentId,
          kind: 'agent',
          data: `readexit ${readExitPath}\r`
        }
      },
      'panel'
    );

    snapshot = await waitForSnapshot((currentSnapshot) => {
      const currentAgent = currentSnapshot.state.nodes.find((node) => node.id === agentId);
      const fileReference = currentSnapshot.state.fileReferences.find(
        (currentReference) => currentReference.filePath === readExitPath
      );
      const fileNode = currentSnapshot.state.nodes.find(
        (node) => node.kind === 'file' && node.metadata?.file?.filePath === readExitPath
      );
      return Boolean(
        currentAgent?.status === 'stopped' &&
          !currentAgent.metadata?.agent?.liveSession &&
          fileReference?.owners.some((owner) => owner.nodeId === agentId && owner.accessMode === 'read') &&
          fileNode
      );
    }, 20000);

    const readExitFileNode = snapshot.state.nodes.find(
      (node) => node.kind === 'file' && node.metadata?.file?.filePath === readExitPath
    );
    assert.ok(readExitFileNode, 'Expected read-then-exit file node to persist after the agent stops.');
    assert.ok(
      snapshot.state.edges.some(
        (edge) =>
          edge.owner === 'file-activity' &&
          edge.sourceNodeId === readExitFileNode.id &&
          edge.targetNodeId === agentId
      ),
      'Expected read-only file activity edge to survive a rapid agent exit.'
    );

    snapshot = await reloadPersistedState();
    assert.ok(
      snapshot.state.fileReferences.some(
        (reference) =>
          reference.filePath === readExitPath &&
          reference.owners.some((owner) => owner.nodeId === agentId && owner.accessMode === 'read')
      ),
      'Expected read-then-exit file reference to persist across reload.'
    );
    assert.ok(
      snapshot.state.nodes.some(
        (node) => node.kind === 'file' && node.metadata?.file?.filePath === readExitPath
      ),
      'Expected read-then-exit file node to persist across reload.'
    );

    await dispatchWebviewMessage(
      {
        type: 'webview/deleteNode',
        payload: {
          nodeId: agentId
        }
      },
      'panel'
    );
    snapshot = await waitForSnapshot((currentSnapshot) => {
      return (
        !currentSnapshot.state.nodes.some((node) => node.id === agentId) &&
        !currentSnapshot.state.fileReferences.some((reference) => reference.filePath === readExitPath) &&
        !currentSnapshot.state.nodes.some(
          (node) => node.kind === 'file' && node.metadata?.file?.filePath === readExitPath
        )
      );
    }, 20000);

    assert.deepStrictEqual(
      snapshot.state.nodes.map((node) => node.id).sort(),
      baselineNodeIds
    );
  } finally {
    await setFilesPresentationMode(originalPresentationMode);
    await setFileNodeDisplayStyle(originalFileNodeDisplayStyle);
    await setFilesPathDisplayMode(originalPathDisplayMode);
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInPanel);
    await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'panel', 20000);
  }
}

async function runRestrictedSmoke() {
  await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInEditor);
  await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'editor', 20000);
  await clearHostMessages();

  let snapshot = await getDebugSnapshot();
  assert.strictEqual(snapshot.activeSurface, 'editor');
  assert.strictEqual(snapshot.sidebar.canvasSurface, 'visible');
  assert.strictEqual(snapshot.sidebar.workspaceTrusted, false);
  assert.deepStrictEqual(snapshot.sidebar.creatableKinds, ['agent', 'terminal', 'note']);
  assert.strictEqual(snapshot.surfaceReady.editor, true);
  assert.strictEqual(snapshot.state.nodes.length, 0);

  await verifyCanvasTemplatesRestricted();
  await ensureEditorCanvasReady();
  await clearHostMessages();

  await dispatchWebviewMessage({
    type: 'webview/createDemoNode',
    payload: {
      kind: 'agent',
      preferredPosition: { x: 40, y: 40 }
    }
  });
  await dispatchWebviewMessage({
    type: 'webview/createDemoNode',
    payload: {
      kind: 'terminal',
      preferredPosition: { x: 420, y: 40 }
    }
  });
  await dispatchWebviewMessage({
    type: 'webview/createDemoNode',
    payload: {
      kind: 'note',
      preferredPosition: { x: 420, y: 320 }
    }
  });

  snapshot = await getDebugSnapshot();
  assert.deepStrictEqual(
    snapshot.state.nodes.map((node) => node.kind).sort(),
    ['note']
  );

  let hostMessages = await getHostMessages();
  assert.ok(
    hostMessages.some(
      (message) =>
        message.type === 'host/error' &&
        message.payload.message === 'The current workspace is not trusted. Agent / Terminal node creation is disabled.'
    )
  );

  await withInterceptedWarningMessages(async (warningCalls) => {
    await setQuickPickSelections(['create-terminal']);
    await vscode.commands.executeCommand(COMMAND_IDS.createNode);

    assert.strictEqual(warningCalls.length, 1, 'Expected restricted Quick Input terminal create to show one modal.');
    assert.strictEqual(
      warningCalls[0].message,
      'The current workspace is not trusted, so Terminal nodes cannot be created right now. Trust the current workspace before creating execution nodes.'
    );
    assert.strictEqual(warningCalls[0].options?.modal, true);
  });

  snapshot = await getDebugSnapshot();
  assert.deepStrictEqual(
    snapshot.state.nodes.map((node) => node.kind).sort(),
    ['note']
  );

  await withInterceptedWarningMessages(async (warningCalls) => {
    await setQuickPickSelections(['create-agent-default', 'agent-launch-accept-current']);
    await vscode.commands.executeCommand(COMMAND_IDS.createNode);

    assert.strictEqual(warningCalls.length, 1, 'Expected restricted Quick Input agent create to show one modal.');
    assert.strictEqual(
      warningCalls[0].message,
      'The current workspace is not trusted, so Agent nodes cannot be created right now. Trust the current workspace before creating execution nodes.'
    );
    assert.strictEqual(warningCalls[0].options?.modal, true);
  });

  snapshot = await getDebugSnapshot();
  assert.deepStrictEqual(
    snapshot.state.nodes.map((node) => node.kind).sort(),
    ['note']
  );

  await vscode.commands.executeCommand(COMMAND_IDS.testCreateNode, 'agent');
  await vscode.commands.executeCommand(COMMAND_IDS.testCreateNode, 'terminal');
  snapshot = await getDebugSnapshot();

  const agentNode = findNodeByKind(snapshot, 'agent');
  const terminalNode = findNodeByKind(snapshot, 'terminal');

  await clearHostMessages();
  await dispatchWebviewMessage({
    type: 'webview/startExecutionSession',
    payload: {
      nodeId: agentNode.id,
      kind: 'agent',
      cols: 84,
      rows: 26,
      provider: 'codex'
    }
  });
  await dispatchWebviewMessage({
    type: 'webview/startExecutionSession',
    payload: {
      nodeId: terminalNode.id,
      kind: 'terminal',
      cols: 84,
      rows: 26
    }
  });
  await dispatchWebviewMessage({
    type: 'webview/executionInput',
    payload: {
      nodeId: agentNode.id,
      kind: 'agent',
      data: 'hello restricted\r'
    }
  });
  await dispatchWebviewMessage({
    type: 'webview/executionInput',
    payload: {
      nodeId: terminalNode.id,
      kind: 'terminal',
      data: 'echo restricted\r'
    }
  });

  hostMessages = await getHostMessages();
  assert.ok(
    hostMessages.some(
      (message) =>
        message.type === 'host/error' &&
        message.payload.message === 'The current workspace is not trusted. Agent runs are disabled.'
    )
  );
  assert.ok(
    hostMessages.some(
      (message) =>
        message.type === 'host/error' &&
        message.payload.message === 'The current workspace is not trusted. Terminal operations are disabled.'
    )
  );
  assert.ok(
    hostMessages.some(
      (message) =>
        message.type === 'host/error' &&
        message.payload.message === 'The current workspace is not trusted. Agent input is disabled.'
    )
  );
  assert.ok(
    hostMessages.some(
      (message) =>
        message.type === 'host/error' &&
        message.payload.message === 'The current workspace is not trusted. Terminal input is disabled.'
    )
  );

  snapshot = await getDebugSnapshot();
  assert.strictEqual(findNodeById(snapshot, agentNode.id).metadata.agent.liveSession, false);
  assert.strictEqual(findNodeById(snapshot, terminalNode.id).metadata.terminal.liveSession, false);

  const probe = await waitForWebviewProbe((currentProbe) => {
    const currentAgent = currentProbe.nodes.find((node) => node.nodeId === agentNode.id);
    const currentTerminal = currentProbe.nodes.find((node) => node.nodeId === terminalNode.id);

    return Boolean(
      currentProbe.hasCanvasShell &&
        currentProbe.hasReactFlow &&
        currentAgent &&
        currentAgent.overlayTitle === 'Restricted Mode' &&
        currentAgent.overlayMessage === 'The current workspace is untrusted, so Agent session actions are disabled.' &&
        currentTerminal &&
        currentTerminal.overlayTitle === 'Restricted Mode' &&
        currentTerminal.overlayMessage === 'The current workspace is untrusted, so embedded Terminal actions are disabled.'
    );
  });

  const probeAgent = probe.nodes.find((node) => node.nodeId === agentNode.id);
  const probeTerminal = probe.nodes.find((node) => node.nodeId === terminalNode.id);
  assert.strictEqual(probeAgent?.overlayTitle, 'Restricted Mode');
  assert.strictEqual(probeTerminal?.overlayTitle, 'Restricted Mode');
  await verifyRestrictedDiagnostics(agentNode.id, terminalNode.id);
  await verifyRestrictedLiveRuntimeReconnectBlocked();
  const restrictedRuntimeNodes = await prepareRestrictedBaseNodesForAppliedRuntimePersistenceMode(true);
  await verifyRestrictedDeleteCleansHistoryOnlyLiveRuntime(
    restrictedRuntimeNodes.agentNode.id,
    restrictedRuntimeNodes.terminalNode.id
  );
  await verifyRestrictedRuntimePersistenceRequiresReloadAndClearsState();
  await verifyRestrictedSessionHistoryRestoreIsDisabled();

  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
}

async function waitForAgentLive(agentNodeId) {
  return waitForSnapshot((currentSnapshot) => {
    const currentAgent = currentSnapshot.state.nodes.find((node) => node.id === agentNodeId);
    return Boolean(
      currentAgent?.metadata?.agent?.liveSession &&
        (currentAgent.status === 'starting' ||
          currentAgent.status === 'running' ||
          currentAgent.status === 'waiting-input' ||
          currentAgent.status === 'resuming')
    );
  });
}

async function waitForTerminalLive(terminalNodeId) {
  return waitForSnapshot((currentSnapshot) => {
    const currentNode = currentSnapshot.state.nodes.find((node) => node.id === terminalNodeId);
    return Boolean(
      currentNode?.metadata?.terminal?.liveSession &&
        (currentNode.status === 'launching' || currentNode.status === 'live')
    );
  });
}

async function ensureAgentStopped(agentNodeId) {
  const snapshot = await getDebugSnapshot();
  const agentNode = findNodeById(snapshot, agentNodeId);
  if (!agentNode.metadata?.agent?.liveSession) {
    return snapshot;
  }

  await dispatchWebviewMessage({
    type: 'webview/stopExecutionSession',
    payload: {
      nodeId: agentNodeId,
      kind: 'agent'
    }
  });

  return waitForSnapshot((currentSnapshot) => {
    const currentNode = currentSnapshot.state.nodes.find((node) => node.id === agentNodeId);
    return Boolean(currentNode && !currentNode.metadata?.agent?.liveSession);
  });
}

async function maybeEnsureAgentStopped(agentNodeId) {
  const snapshot = await getDebugSnapshot();
  if (!snapshot.state.nodes.some((node) => node.id === agentNodeId && node.kind === 'agent')) {
    return snapshot;
  }

  return ensureAgentStopped(agentNodeId);
}

async function ensureTerminalStopped(terminalNodeId) {
  const snapshot = await getDebugSnapshot();
  const terminalNode = findNodeById(snapshot, terminalNodeId);
  if (!terminalNode.metadata?.terminal?.liveSession) {
    return snapshot;
  }

  await dispatchWebviewMessage({
    type: 'webview/stopExecutionSession',
    payload: {
      nodeId: terminalNodeId,
      kind: 'terminal'
    }
  });

  return waitForSnapshot((currentSnapshot) => {
    const currentNode = currentSnapshot.state.nodes.find((node) => node.id === terminalNodeId);
    return Boolean(currentNode && !currentNode.metadata?.terminal?.liveSession);
  });
}

async function verifyAutoStartOnCreate(agentNodeId, terminalNodeId) {
  const snapshot = await waitForAgentLive(agentNodeId);
  const agentNode = findNodeById(snapshot, agentNodeId);
  assert.strictEqual(agentNode.metadata.agent.liveSession, true);
  assert.ok(
    agentNode.status === 'starting' ||
      agentNode.status === 'running' ||
      agentNode.status === 'waiting-input'
  );

  const terminalSnapshot = await waitForTerminalLive(terminalNodeId);
  const terminalNode = findNodeById(terminalSnapshot, terminalNodeId);
  assert.strictEqual(terminalNode.metadata.terminal.liveSession, true);
  assert.ok(terminalNode.status === 'launching' || terminalNode.status === 'live');
}

async function verifyAgentExecutionFlow(agentNodeId) {
  await clearHostMessages();

  let snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentNode = currentSnapshot.state.nodes.find((node) => node.id === agentNodeId);
    return Boolean(
      currentNode?.metadata?.agent?.liveSession &&
        (currentNode.status === 'starting' ||
          currentNode.status === 'running' ||
          currentNode.status === 'waiting-input')
    );
  });
  let agentNode = findNodeById(snapshot, agentNodeId);
  assert.strictEqual(agentNode.metadata.agent.liveSession, true);
  assert.ok(agentNode.metadata.agent.lastCols > 0);
  assert.ok(agentNode.metadata.agent.lastRows > 0);
  assert.ok(
    agentNode.status === 'starting' ||
      agentNode.status === 'running' ||
      agentNode.status === 'waiting-input'
  );

  await dispatchWebviewMessage({
    type: 'webview/executionInput',
    payload: {
      nodeId: agentNodeId,
      kind: 'agent',
      data: 'burst 1\r'
    }
  });

  snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentNode = currentSnapshot.state.nodes.find((node) => node.id === agentNodeId);
    return Boolean(currentNode?.metadata?.agent?.liveSession && currentNode.status === 'running');
  });
  agentNode = findNodeById(snapshot, agentNodeId);
  assert.strictEqual(agentNode.status, 'running');

  snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentNode = currentSnapshot.state.nodes.find((node) => node.id === agentNodeId);
    return Boolean(
      currentNode?.metadata?.agent?.recentOutput?.includes('[fake-agent] burst 001') &&
        currentNode.status === 'waiting-input'
    );
  });
  agentNode = findNodeById(snapshot, agentNodeId);
  assert.ok(agentNode.metadata.agent.recentOutput.includes('[fake-agent] burst 001'));
  assert.strictEqual(agentNode.status, 'waiting-input');

  await requestExecutionSnapshot('agent', agentNodeId);
  let hostMessages = await waitForHostMessages((messages) =>
    messages.some(
      (message) =>
        message.type === 'host/executionSnapshot' &&
        message.payload.kind === 'agent' &&
        message.payload.nodeId === agentNodeId
    )
  );
  assert.ok(
    hostMessages.some(
      (message) =>
        message.type === 'host/executionSnapshot' &&
        message.payload.kind === 'agent' &&
        message.payload.nodeId === agentNodeId
    )
  );

  await dispatchWebviewMessage({
    type: 'webview/executionInput',
    payload: {
      nodeId: agentNodeId,
      kind: 'agent',
      data: 'h'
    }
  });

  await sleep(300);
  snapshot = await getDebugSnapshot();
  agentNode = findNodeById(snapshot, agentNodeId);
  assert.strictEqual(agentNode.status, 'waiting-input');

  await dispatchWebviewMessage({
    type: 'webview/executionInput',
    payload: {
      nodeId: agentNodeId,
      kind: 'agent',
      data: 'ello smoke\r'
    }
  });

  snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentNode = currentSnapshot.state.nodes.find((node) => node.id === agentNodeId);
    return Boolean(
      currentNode?.metadata?.agent?.recentOutput?.includes('[fake-agent] hello smoke') &&
        currentNode.status === 'waiting-input'
    );
  });
  agentNode = findNodeById(snapshot, agentNodeId);
  assert.ok(agentNode.metadata.agent.recentOutput.includes('[fake-agent] hello smoke'));
  assert.strictEqual(agentNode.status, 'waiting-input');

  await dispatchWebviewMessage({
    type: 'webview/executionInput',
    payload: {
      nodeId: agentNodeId,
      kind: 'agent',
      data: 'sleep 1\r'
    }
  });

  snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentNode = currentSnapshot.state.nodes.find((node) => node.id === agentNodeId);
    return Boolean(currentNode?.metadata?.agent?.liveSession && currentNode.status === 'running');
  });
  agentNode = findNodeById(snapshot, agentNodeId);
  assert.strictEqual(agentNode.status, 'running');

  await sleep(500);
  snapshot = await getDebugSnapshot();
  agentNode = findNodeById(snapshot, agentNodeId);
  assert.strictEqual(agentNode.status, 'running');

  snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentNode = currentSnapshot.state.nodes.find((node) => node.id === agentNodeId);
    return Boolean(
      currentNode?.metadata?.agent?.recentOutput?.includes('[fake-agent] woke after 1s') &&
        currentNode.status === 'waiting-input'
    );
  });
  agentNode = findNodeById(snapshot, agentNodeId);
  assert.ok(agentNode.metadata.agent.recentOutput.includes('[fake-agent] woke after 1s'));
  assert.strictEqual(agentNode.status, 'waiting-input');

  await dispatchWebviewMessage({
    type: 'webview/executionInput',
    payload: {
      nodeId: agentNodeId,
      kind: 'agent',
      data: 'slowspin 3\r'
    }
  });

  snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentNode = currentSnapshot.state.nodes.find((node) => node.id === agentNodeId);
    return Boolean(currentNode?.metadata?.agent?.liveSession && currentNode.status === 'running');
  });
  agentNode = findNodeById(snapshot, agentNodeId);
  assert.strictEqual(agentNode.status, 'running');

  await sleep(430);
  snapshot = await getDebugSnapshot();
  agentNode = findNodeById(snapshot, agentNodeId);
  assert.strictEqual(agentNode.status, 'running');

  snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentNode = currentSnapshot.state.nodes.find((node) => node.id === agentNodeId);
    return Boolean(
      currentNode?.metadata?.agent?.recentOutput?.includes('[fake-agent] slowspin done 003') &&
        currentNode.status === 'waiting-input'
    );
  });
  agentNode = findNodeById(snapshot, agentNodeId);
  assert.ok(agentNode.metadata.agent.recentOutput.includes('[fake-agent] slowspin done 003'));
  assert.strictEqual(agentNode.status, 'waiting-input');

  await dispatchWebviewMessage({
    type: 'webview/executionInput',
    payload: {
      nodeId: agentNodeId,
      kind: 'agent',
      data: 'exit 0\r'
    }
  });

  snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentNode = currentSnapshot.state.nodes.find((node) => node.id === agentNodeId);
    return Boolean(currentNode && currentNode.status === 'stopped' && !currentNode.metadata?.agent?.liveSession);
  });
  agentNode = findNodeById(snapshot, agentNodeId);
  assert.strictEqual(agentNode.status, 'stopped');
  assert.strictEqual(agentNode.metadata.agent.liveSession, false);
  assert.strictEqual(agentNode.metadata.agent.lastExitCode, 0);
  assert.match(agentNode.summary, /Codex session ended/);

  await clearHostMessages();
  await dispatchWebviewMessage({
    type: 'webview/startExecutionSession',
    payload: {
      nodeId: agentNodeId,
      kind: 'agent',
      cols: 90,
      rows: 28,
      provider: 'codex'
    }
  });

  await waitForAgentLive(agentNodeId);

  await dispatchWebviewMessage({
    type: 'webview/startExecutionSession',
    payload: {
      nodeId: agentNodeId,
      kind: 'agent',
      cols: 90,
      rows: 28,
      provider: 'codex'
    }
  });
  hostMessages = await getHostMessages();
  assert.ok(
    hostMessages.some(
      (message) =>
        message.type === 'host/error' &&
        message.payload.message === 'This Agent is already running.'
    )
  );

  await dispatchWebviewMessage({
    type: 'webview/stopExecutionSession',
    payload: {
      nodeId: agentNodeId,
      kind: 'agent'
    }
  });

  snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentNode = currentSnapshot.state.nodes.find((node) => node.id === agentNodeId);
    return Boolean(currentNode && currentNode.status === 'stopped' && !currentNode.metadata?.agent?.liveSession);
  });
  agentNode = findNodeById(snapshot, agentNodeId);
  assert.strictEqual(agentNode.metadata.agent.liveSession, false);
  assert.strictEqual(agentNode.status, 'stopped');
  assert.match(agentNode.summary, /Stopped Codex session/);
}

async function verifyPersistedStateFiltersLegacyTaskNodes() {
  const beforeSnapshot = await getDebugSnapshot();
  const beforeState = beforeSnapshot.state;
  const mixedBaselineState =
    beforeState.nodes.length > 0
      ? beforeState
      : {
          version: 1,
          updatedAt: '2026-04-07T14:05:00.000Z',
          nodes: [
            {
              id: 'baseline-agent-1',
              kind: 'agent',
              title: 'Baseline Agent',
              status: 'idle',
              summary: 'A retained agent node.',
              position: { x: 40, y: 40 },
              size: { width: 560, height: 420 },
              metadata: {
                agent: {
                  provider: 'codex',
                  lifecycle: 'idle',
                  liveSession: false,
                  pendingLaunch: undefined
                }
              }
            },
            {
              id: 'baseline-terminal-1',
              kind: 'terminal',
              title: 'Baseline Terminal',
              status: 'idle',
              summary: 'A retained terminal node.',
              position: { x: 640, y: 40 },
              size: { width: 560, height: 420 },
              metadata: {
                terminal: {
                  lifecycle: 'idle',
                  liveSession: false,
                  pendingLaunch: undefined
                }
              }
            },
            {
              id: 'baseline-note-1',
              kind: 'note',
              title: 'Baseline Note',
              status: 'ready',
              summary: 'A retained note node.',
              position: { x: 360, y: 520 },
              size: { width: 420, height: 320 },
              metadata: {
                note: {
                  content: 'Baseline note content.'
                }
              }
            }
          ]
        };

  let snapshot = await setPersistedState({
    version: 1,
    updatedAt: '2026-04-07T14:00:00.000Z',
    nodes: [
      {
        id: 'legacy-task-1',
        kind: 'task',
        title: 'Legacy Task',
        status: 'running',
        summary: 'Should be filtered when the canvas state reloads.',
        position: { x: 120, y: 80 },
        size: { width: 420, height: 320 },
        metadata: {
          task: {
            description: 'Outdated task node payload.',
            assignee: 'Codex'
          }
        }
      }
    ]
  });
  assert.strictEqual(
    snapshot.state.nodes.length,
    0,
    'Expected runtime reconciliation to drop unsupported legacy task nodes from a seeded persisted state.'
  );

  snapshot = await setPersistedState({
    ...mixedBaselineState,
    nodes: [
      ...mixedBaselineState.nodes,
      {
        id: 'legacy-task-2',
        kind: 'task',
        title: 'Legacy Task Kept Out',
        status: 'done',
        summary: 'Should not survive beside current nodes.',
        position: { x: 960, y: 120 },
        size: { width: 420, height: 320 },
        metadata: {
          task: {
            description: 'Mixed legacy state.',
            assignee: 'Codex'
          }
        }
      }
    ]
  });
  assert.deepStrictEqual(
    snapshot.state.nodes.map((node) => node.kind).sort(),
    mixedBaselineState.nodes.map((node) => node.kind).sort(),
    'Expected runtime reconciliation to project only supported node kinds from a mixed persisted state.'
  );
  assert.strictEqual(
    snapshot.state.nodes.some((node) => node.id === 'legacy-task-2'),
    false,
    'Expected runtime reconciliation to omit legacy task nodes even when the seeded persisted state also contains supported nodes.'
  );

  if (beforeState !== mixedBaselineState) {
    snapshot = await setPersistedState(beforeState);
    assert.strictEqual(
      snapshot.state.nodes.length,
      beforeState.nodes.length,
      'Expected restoring the pre-test persisted state to recover its original projected node count.'
    );
  }
}

async function verifyRealWebviewProbe(agentNodeId, terminalNodeId, noteNodeId) {
  const editorReadySnapshot = await ensureEditorCanvasReady();
  assert.strictEqual(
    editorReadySnapshot.activeSurface,
    'editor',
    'Expected the real webview probe check to run against the editor surface.'
  );
  assert.strictEqual(
    editorReadySnapshot.surfaceMode?.editor,
    'active',
    'Expected the editor surface to stay in active mode before capturing a real webview probe.'
  );
  assert.strictEqual(
    editorReadySnapshot.surfaceReady?.editor,
    true,
    'Expected the editor surface to report ready before capturing a real webview probe.'
  );

  const expectedAgentNode = findNodeById(editorReadySnapshot, agentNodeId);
  const expectedTerminalNode = findNodeById(editorReadySnapshot, terminalNodeId);
  const expectedNoteNode = findNodeById(editorReadySnapshot, noteNodeId);
  const expectedAgentLaunchCommand = expectedAgentNode.metadata?.agent?.lastLaunchCommandLine ?? null;
  const expectedNodeCount = editorReadySnapshot.state.nodes.length;

  const probe = await waitForWebviewProbeOnSurface(
    'editor',
    (currentProbe) => {
      const agentNode = currentProbe.nodes.find((node) => node.nodeId === agentNodeId);
      const terminalNode = currentProbe.nodes.find((node) => node.nodeId === terminalNodeId);
      const noteNode = currentProbe.nodes.find((node) => node.nodeId === noteNodeId);

      return Boolean(
        currentProbe.hasCanvasShell &&
          currentProbe.hasReactFlow &&
          currentProbe.nodeCount === expectedNodeCount &&
          agentNode &&
          agentNode.kind === 'agent' &&
          agentNode.titleInputValue === expectedAgentNode.title &&
          (expectedAgentLaunchCommand === null || agentNode.chromeSubtitle === expectedAgentLaunchCommand) &&
          agentNode.minimapVisible === true &&
          terminalNode &&
          terminalNode.kind === 'terminal' &&
          terminalNode.titleInputValue === expectedTerminalNode.title &&
          terminalNode.minimapVisible === true &&
          noteNode &&
          noteNode.kind === 'note' &&
          noteNode.chromeTitle === expectedNoteNode.title &&
          noteNode.chromeSubtitle === null &&
          noteNode.statusText === null &&
          noteNode.titleInputValue === expectedNoteNode.title &&
          noteNode.bodyValue === expectedNoteNode.metadata.note.content &&
          noteNode.minimapVisible === true
      );
    },
    10000
  );

  const agentProbeNode = probe.nodes.find((node) => node.nodeId === agentNodeId);
  const noteProbeNode = probe.nodes.find((node) => node.nodeId === noteNodeId);
  assert.ok(agentProbeNode, 'Expected the real webview probe snapshot to include the agent node.');
  assert.ok(noteProbeNode, 'Expected the real webview probe snapshot to include the note node.');
  assert.strictEqual(probe.hasCanvasShell, true);
  assert.strictEqual(probe.hasReactFlow, true);
  assert.strictEqual(probe.nodeCount, expectedNodeCount);
  assert.strictEqual(probe.toastMessage, null);
  if (expectedAgentLaunchCommand !== null) {
    assert.strictEqual(
      agentProbeNode.chromeSubtitle,
      expectedAgentLaunchCommand,
      'Expected Agent subtitle to keep only the launch command.'
    );
  }
  assert.strictEqual(noteProbeNode.bodyValue, expectedNoteNode.metadata.note.content);
}

async function verifyRealWebviewDomInteractions(agentNodeId, terminalNodeId, noteNodeId) {
  await performWebviewDomAction({
    kind: 'setNodeTextField',
    nodeId: agentNodeId,
    field: 'title',
    value: REAL_DOM_AGENT_TITLE
  });

  let snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentAgent = currentSnapshot.state.nodes.find((node) => node.id === agentNodeId);
    return Boolean(currentAgent?.title === REAL_DOM_AGENT_TITLE);
  });
  assert.strictEqual(findNodeById(snapshot, agentNodeId).title, REAL_DOM_AGENT_TITLE);

  await performWebviewDomAction({
    kind: 'setNodeTextField',
    nodeId: terminalNodeId,
    field: 'title',
    value: REAL_DOM_TERMINAL_TITLE
  });

  snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentTerminal = currentSnapshot.state.nodes.find((node) => node.id === terminalNodeId);
    return Boolean(currentTerminal?.title === REAL_DOM_TERMINAL_TITLE);
  });
  assert.strictEqual(findNodeById(snapshot, terminalNodeId).title, REAL_DOM_TERMINAL_TITLE);

  await performWebviewDomAction({
    kind: 'setNodeTextField',
    nodeId: noteNodeId,
    field: 'title',
    value: REAL_DOM_NOTE_TITLE
  });

  snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentNote = currentSnapshot.state.nodes.find((node) => node.id === noteNodeId);
    return Boolean(currentNote?.title === REAL_DOM_NOTE_TITLE);
  });
  assert.strictEqual(findNodeById(snapshot, noteNodeId).title, REAL_DOM_NOTE_TITLE);

  let probe = await waitForWebviewProbe((currentProbe) => {
    const currentAgent = currentProbe.nodes.find((node) => node.nodeId === agentNodeId);
    const currentTerminal = currentProbe.nodes.find((node) => node.nodeId === terminalNodeId);
    const currentNote = currentProbe.nodes.find((node) => node.nodeId === noteNodeId);
    return Boolean(
      currentAgent &&
        currentAgent.titleInputValue === REAL_DOM_AGENT_TITLE &&
        currentTerminal &&
        currentTerminal.titleInputValue === REAL_DOM_TERMINAL_TITLE &&
      currentNote &&
        currentNote.chromeTitle === REAL_DOM_NOTE_TITLE &&
        currentNote.titleInputValue === REAL_DOM_NOTE_TITLE
    );
  });
  assert.strictEqual(
    probe.nodes.find((node) => node.nodeId === agentNodeId)?.titleInputValue,
    REAL_DOM_AGENT_TITLE
  );
  assert.strictEqual(
    probe.nodes.find((node) => node.nodeId === terminalNodeId)?.titleInputValue,
    REAL_DOM_TERMINAL_TITLE
  );
  assert.strictEqual(
    probe.nodes.find((node) => node.nodeId === noteNodeId)?.titleInputValue,
    REAL_DOM_NOTE_TITLE
  );

  await performWebviewDomAction({
    kind: 'setNodeTextField',
    nodeId: noteNodeId,
    field: 'body',
    value: REAL_DOM_NOTE_BODY
  });

  snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentNote = currentSnapshot.state.nodes.find((node) => node.id === noteNodeId);
    return Boolean(currentNote?.metadata?.note?.content === REAL_DOM_NOTE_BODY);
  });
  assert.strictEqual(findNodeById(snapshot, noteNodeId).metadata.note.content, REAL_DOM_NOTE_BODY);

  probe = await waitForWebviewProbe((currentProbe) => {
    const currentNote = currentProbe.nodes.find((node) => node.nodeId === noteNodeId);
    return Boolean(
      currentNote &&
        currentNote.titleInputValue === REAL_DOM_NOTE_TITLE &&
        currentNote.bodyValue === REAL_DOM_NOTE_BODY
    );
  });
  assert.strictEqual(
    probe.nodes.find((node) => node.nodeId === noteNodeId)?.bodyValue,
    REAL_DOM_NOTE_BODY
  );
}

async function verifyInteractiveNoteChecklist(noteNodeId) {
  await dispatchWebviewMessage({
    type: 'webview/updateNoteNode',
    payload: {
      nodeId: noteNodeId,
      content: REAL_DOM_NOTE_CHECKLIST_BODY
    }
  });

  let snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentNote = currentSnapshot.state.nodes.find((node) => node.id === noteNodeId);
    return Boolean(currentNote?.metadata?.note?.content === REAL_DOM_NOTE_CHECKLIST_BODY);
  });
  assert.strictEqual(findNodeById(snapshot, noteNodeId).metadata.note.content, REAL_DOM_NOTE_CHECKLIST_BODY);

  await performWebviewDomAction({
    kind: 'toggleNoteChecklistItem',
    nodeId: noteNodeId,
    lineNumber: 1
  });

  snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentNote = currentSnapshot.state.nodes.find((node) => node.id === noteNodeId);
    return Boolean(currentNote?.metadata?.note?.content === REAL_DOM_NOTE_CHECKLIST_BODY_TOGGLED);
  });
  assert.strictEqual(
    findNodeById(snapshot, noteNodeId).metadata.note.content,
    REAL_DOM_NOTE_CHECKLIST_BODY_TOGGLED
  );

  let probe = await waitForWebviewProbe((currentProbe) => {
    const currentNote = currentProbe.nodes.find((node) => node.nodeId === noteNodeId);
    return Boolean(currentNote?.bodyValue === REAL_DOM_NOTE_CHECKLIST_BODY_TOGGLED);
  });
  assert.strictEqual(
    probe.nodes.find((node) => node.nodeId === noteNodeId)?.bodyValue,
    REAL_DOM_NOTE_CHECKLIST_BODY_TOGGLED
  );

  await performWebviewDomAction({
    kind: 'toggleNoteChecklistItem',
    nodeId: noteNodeId,
    lineNumber: 1
  });

  snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentNote = currentSnapshot.state.nodes.find((node) => node.id === noteNodeId);
    return Boolean(currentNote?.metadata?.note?.content === REAL_DOM_NOTE_CHECKLIST_BODY);
  });
  assert.strictEqual(findNodeById(snapshot, noteNodeId).metadata.note.content, REAL_DOM_NOTE_CHECKLIST_BODY);

  probe = await waitForWebviewProbe((currentProbe) => {
    const currentNote = currentProbe.nodes.find((node) => node.nodeId === noteNodeId);
    return Boolean(currentNote?.bodyValue === REAL_DOM_NOTE_CHECKLIST_BODY);
  });
  assert.strictEqual(
    probe.nodes.find((node) => node.nodeId === noteNodeId)?.bodyValue,
    REAL_DOM_NOTE_CHECKLIST_BODY
  );

  await dispatchWebviewMessage({
    type: 'webview/updateNoteNode',
    payload: {
      nodeId: noteNodeId,
      content: REAL_DOM_NOTE_BODY
    }
  });
  snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentNote = currentSnapshot.state.nodes.find((node) => node.id === noteNodeId);
    return Boolean(currentNote?.metadata?.note?.content === REAL_DOM_NOTE_BODY);
  });
  assert.strictEqual(findNodeById(snapshot, noteNodeId).metadata.note.content, REAL_DOM_NOTE_BODY);
}

async function verifyNoteWorkspaceFileLinks(noteNodeId) {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(workspaceFolder, 'Smoke workspace is missing a workspace folder.');

  const linkTargetUri = vscode.Uri.joinPath(
    workspaceFolder.uri,
    '.debug',
    'vscode-smoke',
    REAL_DOM_NOTE_FILE_LINK_RELATIVE_PATH
  );
  await fs.mkdir(path.dirname(linkTargetUri.fsPath), { recursive: true });
  await fs.writeFile(linkTargetUri.fsPath, 'line 1\nline 2 target\nline 3\n', 'utf8');

  await dispatchWebviewMessage({
    type: 'webview/updateNoteNode',
    payload: {
      nodeId: noteNodeId,
      content: REAL_DOM_NOTE_FILE_LINK_BODY
    }
  });
  let snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentNote = currentSnapshot.state.nodes.find((node) => node.id === noteNodeId);
    return Boolean(currentNote?.metadata?.note?.content === REAL_DOM_NOTE_FILE_LINK_BODY);
  });
  assert.strictEqual(findNodeById(snapshot, noteNodeId).metadata.note.content, REAL_DOM_NOTE_FILE_LINK_BODY);

  await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInEditor);
  await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'editor', 20000);

  await dispatchWebviewMessage(
    {
      type: 'webview/openNoteLink',
      payload: {
        nodeId: noteNodeId,
        href: '.debug/vscode-smoke/note-link-open-target.txt#L2C3'
      }
    },
    'editor'
  );

  const openedEditor = await waitForVisibleEditor(
    (editor) =>
      editor.document.uri.fsPath === linkTargetUri.fsPath &&
      editor.selection.active.line === 1 &&
      editor.selection.active.character === 2,
    10000
  );
  assert.strictEqual(
    openedEditor.viewColumn,
    vscode.ViewColumn.Two,
    'Expected editor-surface Note file links to open the target beside the canvas and honor #L..C.. selection.'
  );

  const probe = await captureWebviewProbe('editor', 2000);
  assert.ok(
    probe.hasCanvasShell && probe.hasReactFlow,
    'Expected the editor-surface canvas to remain mounted after opening a Note workspace file link.'
  );
  await closeVisibleEditor(linkTargetUri.fsPath);

  await dispatchWebviewMessage({
    type: 'webview/updateNoteNode',
    payload: {
      nodeId: noteNodeId,
      content: REAL_DOM_NOTE_BODY
    }
  });
  snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentNote = currentSnapshot.state.nodes.find((node) => node.id === noteNodeId);
    return Boolean(currentNote?.metadata?.note?.content === REAL_DOM_NOTE_BODY);
  });
  assert.strictEqual(findNodeById(snapshot, noteNodeId).metadata.note.content, REAL_DOM_NOTE_BODY);
}

async function verifyNoteMarkdownFileAssociation() {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(workspaceFolder, 'Smoke workspace is missing a workspace folder.');
  assert.ok(
    REAL_DOM_NOTE_MARKDOWN_ASSOCIATION_BODY.length > 8000 &&
      REAL_DOM_NOTE_MARKDOWN_ASSOCIATION_UPDATED_BODY.length > 8000,
    'Expected associated Markdown smoke bodies to exceed the ordinary Note storage limit.'
  );

  const associationDir = path.join(workspaceFolder.uri.fsPath, '.debug', 'vscode-smoke');
  await fs.mkdir(associationDir, { recursive: true });

  const associatedFilePath = path.join(associationDir, 'associated-note.md');
  await fs.writeFile(associatedFilePath, REAL_DOM_NOTE_MARKDOWN_ASSOCIATION_BODY, 'utf8');
  const associatedFileUri = vscode.Uri.file(associatedFilePath);

  const associatedFileDropMessage = {
    type: 'webview/dropNoteMarkdownFiles',
    payload: {
      resources: [
        {
          source: 'resourceUrls',
          valueKind: 'uri',
          value: associatedFileUri.toString()
        },
        {
          source: 'codeFiles',
          valueKind: 'path',
          value: associatedFilePath
        }
      ],
      position: { x: 820, y: 320 }
    }
  };
  await Promise.all([
    dispatchWebviewMessage(associatedFileDropMessage),
    dispatchWebviewMessage(associatedFileDropMessage)
  ]);

  let snapshot = await waitForSnapshot((currentSnapshot) =>
    currentSnapshot.state.nodes.some(
      (node) =>
        node.kind === 'note' &&
        node.metadata?.note?.contentSource?.kind === 'markdown-file' &&
        node.metadata.note.contentSource.resourceUri === associatedFileUri.toString() &&
        node.metadata.note.content === REAL_DOM_NOTE_MARKDOWN_ASSOCIATION_BODY
    )
  );
  const associatedNote = snapshot.state.nodes.find(
    (node) =>
      node.kind === 'note' &&
      node.metadata?.note?.contentSource?.resourceUri === associatedFileUri.toString()
  );
  assert.ok(associatedNote, 'Expected dropping a Markdown file onto the canvas to create an associated Note.');
  assert.strictEqual(associatedNote.title, 'associated-note.md');
  assert.strictEqual(associatedNote.metadata.note.contentSource.displayPath, '.debug/vscode-smoke/associated-note.md');
  assert.strictEqual(
    associatedNote.metadata.note.contentSource.fullDisplayPath,
    '.debug/vscode-smoke/associated-note.md'
  );
  assert.ok(
    associatedNote.metadata.note.contentSource.contentRevision,
    'Expected associated Markdown Note to carry a content revision.'
  );
  assert.match(
    associatedNote.metadata.note.contentSource.contentRevision,
    /^stat:/,
    'Expected associated Markdown Note revision to be based on file stat metadata.'
  );
  const initialAssociatedContentRevision = associatedNote.metadata.note.contentSource.contentRevision;
  assert.strictEqual(associatedNote.metadata.note.contentSource.status, 'ok');
  assert.strictEqual(
    snapshot.state.nodes.filter(
      (node) =>
        node.kind === 'note' &&
        node.metadata?.note?.contentSource?.resourceUri === associatedFileUri.toString()
    ).length,
    1,
    'Expected duplicate drag resources/messages for the same Markdown file to create only one associated Note.'
  );

  const associatedDocument = await vscode.workspace.openTextDocument(associatedFileUri);
  const associatedEditor = await vscode.window.showTextDocument(associatedDocument, {
    preview: false,
    preserveFocus: false
  });
  const openedAssociatedEditor = await waitForActiveEditor(
    (editor) => editor.document.uri.fsPath === associatedFilePath,
    10000
  );
  assert.strictEqual(openedAssociatedEditor.document.isDirty, false);

  const dirtyEditorContent = `${REAL_DOM_NOTE_MARKDOWN_ASSOCIATION_UPDATED_BODY}\neditor draft tail`;
  const dirtyEditApplied = await associatedEditor.edit((editBuilder) => {
    const fullRange = new vscode.Range(
      associatedEditor.document.positionAt(0),
      associatedEditor.document.positionAt(associatedEditor.document.getText().length)
    );
    editBuilder.replace(fullRange, dirtyEditorContent);
  });
  assert.ok(dirtyEditApplied, 'Expected the associated Markdown editor to accept a dirty draft edit.');
  assert.strictEqual(associatedEditor.document.isDirty, true);

  await sleep(900);
  snapshot = await getDebugSnapshot();
  assert.strictEqual(
    findNodeById(snapshot, associatedNote.id).metadata.note.content,
    REAL_DOM_NOTE_MARKDOWN_ASSOCIATION_BODY,
    'Expected an unsaved VS Code editor draft not to change the associated Note content.'
  );

  await associatedEditor.document.save();
  snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentNote = currentSnapshot.state.nodes.find((node) => node.id === associatedNote.id);
    return Boolean(currentNote?.metadata?.note?.content === dirtyEditorContent);
  });
  assert.strictEqual(
    findNodeById(snapshot, associatedNote.id).metadata.note.content,
    dirtyEditorContent,
    'Expected the associated Note to refresh after the Markdown editor saves.'
  );
  const savedAssociatedContentRevision =
    findNodeById(snapshot, associatedNote.id).metadata.note.contentSource.contentRevision;
  assert.notStrictEqual(
    savedAssociatedContentRevision,
    initialAssociatedContentRevision,
    'Expected saving the Markdown file to update the stat-based associated Note revision.'
  );

  await fs.writeFile(associatedFilePath, REAL_DOM_NOTE_MARKDOWN_ASSOCIATION_BODY, 'utf8');
  snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentNote = currentSnapshot.state.nodes.find((node) => node.id === associatedNote.id);
    return Boolean(currentNote?.metadata?.note?.content === REAL_DOM_NOTE_MARKDOWN_ASSOCIATION_BODY);
  });
  assert.strictEqual(
    findNodeById(snapshot, associatedNote.id).metadata.note.content,
    REAL_DOM_NOTE_MARKDOWN_ASSOCIATION_BODY,
    'Expected restoring the Markdown file on disk to bring the Note back to the disk content.'
  );
  const activeEditRevision = findNodeById(snapshot, associatedNote.id).metadata.note.contentSource.contentRevision;
  assert.ok(activeEditRevision, 'Expected restored associated Markdown Note to have a revision before editing.');
  await dispatchWebviewMessage({
    type: 'webview/beginAssociatedNoteMarkdownEdit',
    payload: {
      nodeId: associatedNote.id,
      content: REAL_DOM_NOTE_MARKDOWN_ASSOCIATION_BODY,
      baseContentRevision: activeEditRevision
    }
  });
  const activeEditDraftContent = `${REAL_DOM_NOTE_MARKDOWN_ASSOCIATION_BODY}\n\nin-progress note draft`;
  await dispatchWebviewMessage({
    type: 'webview/updateAssociatedNoteMarkdownDraft',
    payload: {
      nodeId: associatedNote.id,
      content: activeEditDraftContent,
      baseContentRevision: activeEditRevision
    }
  });
  snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentNote = currentSnapshot.state.nodes.find((node) => node.id === associatedNote.id);
    return Boolean(currentNote?.metadata?.note?.contentSource?.recoverableDraft?.draftId);
  });
  const activeEditRemoteContent = `${REAL_DOM_NOTE_MARKDOWN_ASSOCIATION_BODY}\n\nexternal edit while note is open`;
  await fs.writeFile(associatedFilePath, activeEditRemoteContent, 'utf8');
  snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentNote = currentSnapshot.state.nodes.find((node) => node.id === associatedNote.id);
    return currentNote?.metadata?.note?.contentSource?.status === 'dirty-conflict';
  });
  const activeEditConflictNote = findNodeById(snapshot, associatedNote.id);
  assert.strictEqual(
    activeEditConflictNote.metadata.note.content,
    activeEditRemoteContent,
    'Expected editing an associated Markdown Note to surface external disk changes before submit.'
  );
  const activeEditRecoverableDraft = activeEditConflictNote.metadata.note.contentSource.recoverableDraft;
  assert.match(
    String(activeEditRecoverableDraft?.draftId),
    /^[0-9a-f-]{36}$/i,
    'Expected active edit conflict to persist the in-progress note draft.'
  );
  assert.strictEqual(
    await readInternalNoteMarkdownDraftContent(activeEditRecoverableDraft.draftId),
    activeEditDraftContent,
    'Expected active edit conflict to keep the edit-session content as the recoverable draft.'
  );
  await vscode.commands.executeCommand(COMMAND_IDS.focusNode, associatedNote.id);
  await waitForWebviewProbe(
    (currentProbe) => currentProbe.nodes.some((node) => node.nodeId === associatedNote.id),
    10000
  );
  await performWebviewDomAction(
    {
      kind: 'clickNodeActionButton',
      nodeId: associatedNote.id,
      action: 'reload'
    },
    'editor',
    10000
  );
  snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentNote = currentSnapshot.state.nodes.find((node) => node.id === associatedNote.id);
    return (
      currentNote?.metadata?.note?.contentSource?.status === 'ok' &&
      currentNote.metadata.note.content === activeEditRemoteContent
    );
  });
  await fs.writeFile(associatedFilePath, REAL_DOM_NOTE_MARKDOWN_ASSOCIATION_BODY, 'utf8');
  snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentNote = currentSnapshot.state.nodes.find((node) => node.id === associatedNote.id);
    return (
      currentNote?.metadata?.note?.contentSource?.status === 'ok' &&
      currentNote.metadata.note.content === REAL_DOM_NOTE_MARKDOWN_ASSOCIATION_BODY
    );
  });

  const revertedDraftBaseRevision =
    findNodeById(snapshot, associatedNote.id).metadata.note.contentSource.contentRevision;
  assert.ok(
    revertedDraftBaseRevision,
    'Expected associated Markdown Note to have a revision before testing reverted edit drafts.'
  );
  await dispatchWebviewMessage({
    type: 'webview/beginAssociatedNoteMarkdownEdit',
    payload: {
      nodeId: associatedNote.id,
      content: REAL_DOM_NOTE_MARKDOWN_ASSOCIATION_BODY,
      baseContentRevision: revertedDraftBaseRevision
    }
  });
  const abandonedDraftContent = `${REAL_DOM_NOTE_MARKDOWN_ASSOCIATION_BODY}\n\nabandoned local draft`;
  await dispatchWebviewMessage({
    type: 'webview/updateAssociatedNoteMarkdownDraft',
    payload: {
      nodeId: associatedNote.id,
      content: abandonedDraftContent,
      baseContentRevision: revertedDraftBaseRevision
    }
  });
  snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentNote = currentSnapshot.state.nodes.find((node) => node.id === associatedNote.id);
    return Boolean(
      currentNote?.metadata?.note?.contentSource?.status === 'ok' &&
        currentNote.metadata.note.contentSource.recoverableDraft?.draftId
    );
  });
  assert.strictEqual(
    findNodeById(snapshot, associatedNote.id).metadata.note.content,
    REAL_DOM_NOTE_MARKDOWN_ASSOCIATION_BODY,
    'Expected syncing an edit draft not to replace the associated Markdown file content.'
  );
  await dispatchWebviewMessage({
    type: 'webview/clearAssociatedNoteMarkdownDraft',
    payload: {
      nodeId: associatedNote.id
    }
  });
  snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentNote = currentSnapshot.state.nodes.find((node) => node.id === associatedNote.id);
    return Boolean(
      currentNote?.metadata?.note?.contentSource?.status === 'ok' &&
        !currentNote.metadata.note.contentSource.recoverableDraft
    );
  });
  const externalContentAfterRevertedDraft =
    `${REAL_DOM_NOTE_MARKDOWN_ASSOCIATION_BODY}\n\nexternal edit after reverted draft`;
  await fs.writeFile(associatedFilePath, externalContentAfterRevertedDraft, 'utf8');
  snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentNote = currentSnapshot.state.nodes.find((node) => node.id === associatedNote.id);
    return (
      currentNote?.metadata?.note?.contentSource?.status === 'ok' &&
      currentNote.metadata.note.content === externalContentAfterRevertedDraft
    );
  });
  const revertedDraftRefreshNote = findNodeById(snapshot, associatedNote.id);
  assert.strictEqual(
    revertedDraftRefreshNote.metadata.note.contentSource.recoverableDraft,
    undefined,
    'Expected clearing a reverted edit draft to prevent stale active edit conflicts.'
  );
  await fs.writeFile(associatedFilePath, REAL_DOM_NOTE_MARKDOWN_ASSOCIATION_BODY, 'utf8');
  snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentNote = currentSnapshot.state.nodes.find((node) => node.id === associatedNote.id);
    return (
      currentNote?.metadata?.note?.contentSource?.status === 'ok' &&
      currentNote.metadata.note.content === REAL_DOM_NOTE_MARKDOWN_ASSOCIATION_BODY
    );
  });

  const existingAssociatedFileDropMessage = {
    type: 'webview/dropNoteMarkdownFiles',
    payload: {
      resources: [
        {
          source: 'resourceUrls',
          valueKind: 'uri',
          value: associatedFileUri.toString()
        }
      ],
      position: { x: 840, y: 340 }
    }
  };

  await clearHostMessages();
  await withInterceptedWarningMessages(
    async (warningCalls) => {
      await dispatchWebviewMessage(existingAssociatedFileDropMessage);
      await waitForHostMessages(
        (messages) =>
          messages.some(
            (message) =>
              message.type === 'host/focusNodes' &&
              Array.isArray(message.payload?.nodeIds) &&
              message.payload.nodeIds.includes(associatedNote.id)
          ),
        10000
      );
      assert.strictEqual(warningCalls.length, 1, 'Expected dropping an already associated Markdown file to confirm.');
      assert.match(String(warningCalls[0].message), /associated with one Note/);
      assert.ok(
        String(warningCalls[0].message).includes(associatedNote.metadata.note.contentSource.displayPath),
        'Expected the existing-file drop confirmation to use the same display path as the Note subtitle.'
      );
      assert.ok(
        !String(warningCalls[0].message).includes(associatedFilePath),
        'Expected the existing-file drop confirmation not to show the absolute file path.'
      );
      assert.ok(
        warningCalls[0].items.includes('Locate Existing Note'),
        'Expected the existing-file drop confirmation to offer locating the associated Note.'
      );
      assert.ok(
        !warningCalls[0].items.includes('Cancel'),
        'Expected the existing-file drop confirmation to rely on the modal default cancel button.'
      );
    },
    ({ items }) => items.find((item) => item === 'Locate Existing Note')
  );
  snapshot = await getDebugSnapshot();
  assert.strictEqual(
    snapshot.state.nodes.filter(
      (node) =>
        node.kind === 'note' &&
        node.metadata?.note?.contentSource?.resourceUri === associatedFileUri.toString()
    ).length,
    1,
    'Expected choosing locate for an already associated Markdown file not to create another Note.'
  );

  await withInterceptedWarningMessages(
    async (warningCalls) => {
      await dispatchWebviewMessage(existingAssociatedFileDropMessage);
      snapshot = await waitForSnapshot(
        (currentSnapshot) =>
          currentSnapshot.state.nodes.filter(
            (node) =>
              node.kind === 'note' &&
              node.metadata?.note?.contentSource?.resourceUri === associatedFileUri.toString()
          ).length === 2,
        10000
      );
      assert.strictEqual(warningCalls.length, 1, 'Expected adding another associated Note to confirm.');
      assert.ok(
        warningCalls[0].items.includes('Add New Note'),
        'Expected the existing-file drop confirmation to offer creating another associated Note.'
      );
      assert.ok(
        !warningCalls[0].items.includes('Cancel'),
        'Expected the existing-file drop confirmation not to duplicate the modal cancel button.'
      );
    },
    ({ items }) => items.find((item) => item === 'Add New Note')
  );
  const duplicateAssociatedNote = snapshot.state.nodes.find(
    (node) =>
      node.kind === 'note' &&
      node.id !== associatedNote.id &&
      node.metadata?.note?.contentSource?.resourceUri === associatedFileUri.toString()
  );
  assert.ok(duplicateAssociatedNote, 'Expected choosing continue to create a second associated Note.');
  await dispatchWebviewMessage({
    type: 'webview/deleteNode',
    payload: {
      nodeId: duplicateAssociatedNote.id
    }
  });
  snapshot = await waitForSnapshot(
    (currentSnapshot) =>
      currentSnapshot.state.nodes.filter(
        (node) =>
          node.kind === 'note' &&
          node.metadata?.note?.contentSource?.resourceUri === associatedFileUri.toString()
      ).length === 1,
    10000
  );

  await clearHostMessages();
  await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInPanel);
  await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'panel', 20000);
  await withInterceptedWarningMessages(
    async (warningCalls) => {
      await vscode.commands.executeCommand(COMMAND_IDS.createNoteFromExplorerMarkdown, associatedFileUri);
      await waitForHostMessages(
        (messages) =>
          messages.some(
            (message) =>
              message.type === 'host/focusNodes' &&
              Array.isArray(message.payload?.nodeIds) &&
              message.payload.nodeIds.includes(associatedNote.id)
          ),
        10000
      );
      assert.strictEqual(
        warningCalls.length,
        1,
        'Expected Explorer Markdown command to confirm before locating an existing associated Note.'
      );
      assert.ok(
        warningCalls[0].items.includes('Locate Existing Note'),
        'Expected Explorer Markdown command to offer locating the associated Note.'
      );
    },
    ({ items }) => items.find((item) => item === 'Locate Existing Note')
  );
  snapshot = await getDebugSnapshot();
  assert.strictEqual(
    snapshot.activeSurface,
    'panel',
    'Expected Explorer Markdown Note creation to locate existing Notes on the already-open Canvas surface.'
  );
  assert.strictEqual(
    snapshot.state.nodes.filter(
      (node) =>
        node.kind === 'note' &&
        node.metadata?.note?.contentSource?.resourceUri === associatedFileUri.toString()
    ).length,
    1,
    'Expected Explorer Markdown command locate flow not to create another Note for an existing association.'
  );

  await withInterceptedWarningMessages(
    async (warningCalls) => {
      await vscode.commands.executeCommand(COMMAND_IDS.createNoteFromExplorerMarkdown, associatedFileUri);
      snapshot = await waitForSnapshot(
        (currentSnapshot) =>
          currentSnapshot.state.nodes.filter(
            (node) =>
              node.kind === 'note' &&
              node.metadata?.note?.contentSource?.resourceUri === associatedFileUri.toString()
          ).length === 2,
        10000
      );
      assert.strictEqual(
        warningCalls.length,
        1,
        'Expected Explorer Markdown command to confirm before adding a duplicate associated Note.'
      );
      assert.ok(
        warningCalls[0].items.includes('Add New Note'),
        'Expected Explorer Markdown command to offer adding another associated Note.'
      );
    },
    ({ items }) => items.find((item) => item === 'Add New Note')
  );
  assert.strictEqual(
    snapshot.activeSurface,
    'panel',
    'Expected Explorer Markdown Note creation to add duplicate Notes on the already-open Canvas surface.'
  );
  const explorerDuplicateAssociatedNote = snapshot.state.nodes.find(
    (node) =>
      node.kind === 'note' &&
      node.id !== associatedNote.id &&
      node.metadata?.note?.contentSource?.resourceUri === associatedFileUri.toString()
  );
  assert.ok(
    explorerDuplicateAssociatedNote,
    'Expected Explorer Markdown command add flow to create a second associated Note when confirmed.'
  );
  assert.strictEqual(
    explorerDuplicateAssociatedNote.title,
    'associated-note.md',
    'Expected Explorer Markdown command to reuse the Markdown association title rule.'
  );
  assert.strictEqual(
    explorerDuplicateAssociatedNote.metadata.note.content,
    REAL_DOM_NOTE_MARKDOWN_ASSOCIATION_BODY,
    'Expected Explorer Markdown command to read the associated file content into the Note buffer.'
  );
  await dispatchWebviewMessage({
    type: 'webview/deleteNode',
    payload: {
      nodeId: explorerDuplicateAssociatedNote.id
    }
  });
  snapshot = await waitForSnapshot(
    (currentSnapshot) =>
      currentSnapshot.state.nodes.filter(
        (node) =>
          node.kind === 'note' &&
          node.metadata?.note?.contentSource?.resourceUri === associatedFileUri.toString()
      ).length === 1,
    10000
  );

  await dispatchWebviewMessage({
    type: 'webview/updateNoteNode',
    payload: {
      nodeId: associatedNote.id,
      content: '# Associated Note\n\n- stale local draft',
      baseContentRevision: 'stale-revision'
    }
  });
  snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentNote = currentSnapshot.state.nodes.find((node) => node.id === associatedNote.id);
    return currentNote?.metadata?.note?.contentSource?.status === 'dirty-conflict';
  });
  const conflictNote = findNodeById(snapshot, associatedNote.id);
  assert.strictEqual(
    conflictNote.metadata.note.content,
    REAL_DOM_NOTE_MARKDOWN_ASSOCIATION_BODY,
    'Expected stale associated Markdown draft submission not to replace the node buffer.'
  );
  assert.match(
    String(conflictNote.metadata.note.contentSource.lastError),
    /modified externally while editing/,
    'Expected stale associated Markdown draft submission to explain the edit conflict.'
  );
  assert.strictEqual(
    await fs.readFile(associatedFilePath, 'utf8'),
    REAL_DOM_NOTE_MARKDOWN_ASSOCIATION_BODY,
    'Expected stale associated Markdown draft submission not to overwrite the file.'
  );
  const recoverableDraft = conflictNote.metadata.note.contentSource.recoverableDraft;
  assert.match(
    String(recoverableDraft?.draftId),
    /^[0-9a-f-]{36}$/i,
    'Expected dirty-conflict associated Markdown Note to persist a storage-backed draft id.'
  );
  assert.strictEqual(
    recoverableDraft?.content,
    undefined,
    'Expected debug state not to inline the rejected local draft content.'
  );
  assert.strictEqual(
    await readInternalNoteMarkdownDraftContent(recoverableDraft.draftId),
    '# Associated Note\n\n- stale local draft',
    'Expected dirty-conflict associated Markdown Note to persist the rejected local draft in storage.'
  );
  assert.strictEqual(
    recoverableDraft?.baseContentRevision,
    'stale-revision',
    'Expected persisted conflict draft to keep the stale base revision for explicit overwrite.'
  );

  snapshot = await reloadPersistedState();
  const reloadedConflictNote = findNodeById(snapshot, associatedNote.id);
  assert.strictEqual(
    reloadedConflictNote.metadata.note.contentSource.status,
    'dirty-conflict',
    'Expected reloading persisted state not to auto-resolve an associated Markdown conflict.'
  );
  assert.strictEqual(
    reloadedConflictNote.metadata.note.contentSource.recoverableDraft?.draftId,
    recoverableDraft.draftId,
    'Expected reloading persisted state to keep the unresolved conflict draft reference.'
  );
  assert.strictEqual(
    reloadedConflictNote.metadata.note.contentSource.recoverableDraft?.content,
    undefined,
    'Expected reloading persisted state not to inline the unresolved conflict draft.'
  );
  assert.strictEqual(
    await readInternalNoteMarkdownDraftContent(recoverableDraft.draftId),
    '# Associated Note\n\n- stale local draft',
    'Expected reloading persisted state to keep the unresolved conflict draft file.'
  );

  const legacyDraftId = '55555555-5555-4555-8555-555555555555';
  const legacyRecoverableDraftContent = '# Associated Note\n\n- stale local draft from legacy field';
  const legacyConflictDraftState = {
    ...snapshot.state,
    nodes: snapshot.state.nodes.map((node) => {
      if (node.id !== associatedNote.id) {
        return node;
      }

      const { recoverableDraft: _recoverableDraft, ...legacyContentSource } =
        node.metadata.note.contentSource;
      return {
        ...node,
        metadata: {
          ...node.metadata,
          note: {
            ...node.metadata.note,
            contentSource: {
              ...legacyContentSource,
              conflictDraft: {
                draftId: legacyDraftId,
                content: legacyRecoverableDraftContent,
                baseContentRevision: 'legacy-base-revision',
                remoteContentRevision: node.metadata.note.contentSource.contentRevision,
                updatedAt: '2026-05-24T00:00:00.000Z'
              }
            }
          }
        }
      };
    })
  };
  snapshot = await setPersistedState(legacyConflictDraftState);
  const migratedLegacyDraftNote = findNodeById(snapshot, associatedNote.id);
  assert.strictEqual(
    migratedLegacyDraftNote.metadata.note.contentSource.recoverableDraft?.draftId,
    legacyDraftId,
    'Expected legacy conflictDraft state to migrate into recoverableDraft.'
  );
  assert.strictEqual(
    migratedLegacyDraftNote.metadata.note.contentSource.conflictDraft,
    undefined,
    'Expected debug state not to re-emit legacy conflictDraft after migration.'
  );
  assert.strictEqual(
    migratedLegacyDraftNote.metadata.note.contentSource.recoverableDraft?.content,
    undefined,
    'Expected migrated recoverableDraft not to inline draft content in debug state.'
  );
  assert.strictEqual(
    await readInternalNoteMarkdownDraftContent(legacyDraftId),
    legacyRecoverableDraftContent,
    'Expected migrating legacy conflictDraft content to keep the recoverable draft file.'
  );
  const persistedLegacyDraftSnapshot = await flushPersistedStateSnapshot();
  const persistedLegacyDraftNote = persistedLegacyDraftSnapshot.state.nodes.find((node) => node.id === associatedNote.id);
  assert.ok(persistedLegacyDraftNote, 'Expected persisted legacy migration snapshot to keep the associated Note.');
  assert.strictEqual(
    persistedLegacyDraftNote.metadata.note.contentSource.recoverableDraft?.draftId,
    legacyDraftId,
    'Expected persisted state to write the migrated recoverableDraft field.'
  );
  assert.strictEqual(
    persistedLegacyDraftNote.metadata.note.contentSource.conflictDraft,
    undefined,
    'Expected persisted state not to write the legacy conflictDraft field.'
  );
  assert.strictEqual(
    persistedLegacyDraftNote.metadata.note.contentSource.recoverableDraft?.content,
    undefined,
    'Expected persisted migrated recoverableDraft not to inline draft content.'
  );

  snapshot = await reloadPersistedState();
  const reloadedMigratedLegacyDraftNote = findNodeById(snapshot, associatedNote.id);
  assert.strictEqual(
    reloadedMigratedLegacyDraftNote.metadata.note.contentSource.recoverableDraft?.draftId,
    legacyDraftId,
    'Expected reloading a stripped legacy conflictDraft snapshot to recover recoverableDraft.'
  );
  assert.strictEqual(
    reloadedMigratedLegacyDraftNote.metadata.note.contentSource.conflictDraft,
    undefined,
    'Expected reloading a stripped legacy conflictDraft snapshot not to expose the old field.'
  );

  const currentContentRevision = reloadedMigratedLegacyDraftNote.metadata.note.contentSource.contentRevision;
  assert.ok(currentContentRevision, 'Expected dirty-conflict associated Markdown Note to keep a content revision.');
  await dispatchWebviewMessage({
    type: 'webview/updateNoteNode',
    payload: {
      nodeId: associatedNote.id,
      content: REAL_DOM_NOTE_MARKDOWN_ASSOCIATION_UPDATED_BODY,
      baseContentRevision: currentContentRevision
    }
  });
  await waitForSnapshot((currentSnapshot) => {
    const currentNote = currentSnapshot.state.nodes.find((node) => node.id === associatedNote.id);
    return Boolean(currentNote?.metadata?.note?.content === REAL_DOM_NOTE_MARKDOWN_ASSOCIATION_UPDATED_BODY);
  });
  assert.strictEqual(
    await fs.readFile(associatedFilePath, 'utf8'),
    REAL_DOM_NOTE_MARKDOWN_ASSOCIATION_UPDATED_BODY
  );

  await dispatchWebviewMessage({
    type: 'webview/deleteNode',
    payload: {
      nodeId: associatedNote.id
    }
  });
  snapshot = await waitForSnapshot((currentSnapshot) =>
    currentSnapshot.state.nodes.every((node) => node.id !== associatedNote.id)
  );
  assert.ok(
    snapshot.state.nodes.every((node) => node.id !== associatedNote.id),
    'Expected deleting an associated Note to remove only the node.'
  );
  assert.strictEqual(
    await fs.readFile(associatedFilePath, 'utf8'),
    REAL_DOM_NOTE_MARKDOWN_ASSOCIATION_UPDATED_BODY,
    'Expected deleting an associated Note to leave the Markdown file untouched.'
  );

  const missingFilePath = path.join(associationDir, 'missing-associated-note.md');
  await fs.writeFile(missingFilePath, REAL_DOM_NOTE_MARKDOWN_ASSOCIATION_BODY, 'utf8');
  const missingFileUri = vscode.Uri.file(missingFilePath);
  await dispatchWebviewMessage({
    type: 'webview/dropNoteMarkdownFiles',
    payload: {
      resources: [
        {
          source: 'resourceUrls',
          valueKind: 'uri',
          value: missingFileUri.toString()
        }
      ],
      position: { x: 860, y: 360 }
    }
  });
  snapshot = await waitForSnapshot((currentSnapshot) =>
    currentSnapshot.state.nodes.some(
      (node) =>
        node.kind === 'note' &&
        node.metadata?.note?.contentSource?.resourceUri === missingFileUri.toString()
    )
  );
  const missingNote = snapshot.state.nodes.find(
    (node) =>
      node.kind === 'note' &&
      node.metadata?.note?.contentSource?.resourceUri === missingFileUri.toString()
  );
  assert.ok(missingNote, 'Expected the second dropped Markdown file to create an associated Note.');

  await fs.unlink(missingFilePath);
  snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentNote = currentSnapshot.state.nodes.find((node) => node.id === missingNote.id);
    return currentNote?.metadata?.note?.contentSource?.status === 'missing';
  }, 10000);
  assert.strictEqual(
    findNodeById(snapshot, missingNote.id).metadata.note.contentSource.status,
    'missing',
    'Expected deleting an associated Markdown file to mark the Note as missing.'
  );

  await dispatchWebviewMessage({
    type: 'webview/deleteNode',
    payload: {
      nodeId: missingNote.id
    }
  });
  await waitForSnapshot((currentSnapshot) =>
    currentSnapshot.state.nodes.every((node) => node.id !== missingNote.id)
  );
  await ensureEditorCanvasReady();
  await assertInteractiveEditorSurface('verifyNoteMarkdownFileAssociation');
}

async function verifyNodeResizePersistence(agentNodeId, terminalNodeId, noteNodeId) {
  let snapshot = await waitForSnapshot((currentSnapshot) => {
    return (
      currentSnapshot.state.nodes.some((node) => node.id === agentNodeId) &&
      currentSnapshot.state.nodes.some((node) => node.id === terminalNodeId) &&
      currentSnapshot.state.nodes.some((node) => node.id === noteNodeId)
    );
  });
  const agentNode = findNodeById(snapshot, agentNodeId);
  const terminalNode = findNodeById(snapshot, terminalNodeId);
  const noteNode = findNodeById(snapshot, noteNodeId);

  await dispatchWebviewMessage({
    type: 'webview/resizeNode',
    payload: {
      nodeId: agentNodeId,
      position: agentNode.position,
      size: RESIZED_NODE_SIZES.agent
    }
  });
  await dispatchWebviewMessage({
    type: 'webview/resizeNode',
    payload: {
      nodeId: terminalNodeId,
      position: terminalNode.position,
      size: RESIZED_NODE_SIZES.terminal
    }
  });
  await dispatchWebviewMessage({
    type: 'webview/resizeNode',
    payload: {
      nodeId: noteNodeId,
      position: noteNode.position,
      size: RESIZED_NODE_SIZES.note
    }
  });

  snapshot = await waitForSnapshot((currentSnapshot) => {
    return (
      hasNodeSize(currentSnapshot, agentNodeId, RESIZED_NODE_SIZES.agent) &&
      hasNodeSize(currentSnapshot, terminalNodeId, RESIZED_NODE_SIZES.terminal) &&
      hasNodeSize(currentSnapshot, noteNodeId, RESIZED_NODE_SIZES.note)
    );
  });

  assert.deepStrictEqual(findNodeById(snapshot, agentNodeId).size, RESIZED_NODE_SIZES.agent);
  assert.deepStrictEqual(findNodeById(snapshot, terminalNodeId).size, RESIZED_NODE_SIZES.terminal);
  assert.deepStrictEqual(findNodeById(snapshot, noteNodeId).size, RESIZED_NODE_SIZES.note);

  const probe = await waitForWebviewProbe((currentProbe) => {
    return (
      hasRenderedNodeSize(currentProbe, agentNodeId, RESIZED_NODE_SIZES.agent) &&
      hasRenderedNodeSize(currentProbe, terminalNodeId, RESIZED_NODE_SIZES.terminal) &&
      hasRenderedNodeSize(currentProbe, noteNodeId, RESIZED_NODE_SIZES.note)
    );
  });

  assert.ok(hasRenderedNodeSize(probe, agentNodeId, RESIZED_NODE_SIZES.agent));
  assert.ok(hasRenderedNodeSize(probe, terminalNodeId, RESIZED_NODE_SIZES.terminal));
  assert.ok(hasRenderedNodeSize(probe, noteNodeId, RESIZED_NODE_SIZES.note));

  snapshot = await reloadPersistedState();
  assert.deepStrictEqual(findNodeById(snapshot, agentNodeId).size, RESIZED_NODE_SIZES.agent);
  assert.deepStrictEqual(findNodeById(snapshot, terminalNodeId).size, RESIZED_NODE_SIZES.terminal);
  assert.deepStrictEqual(findNodeById(snapshot, noteNodeId).size, RESIZED_NODE_SIZES.note);
}

async function verifyTerminalExecutionFlow(terminalNodeId) {
  await clearHostMessages();

  let snapshot = await waitForTerminalLive(terminalNodeId);
  let terminalNode = findNodeById(snapshot, terminalNodeId);
  assert.strictEqual(terminalNode.metadata.terminal.liveSession, true);
  assert.ok(terminalNode.metadata.terminal.lastCols > 0);
  assert.ok(terminalNode.metadata.terminal.lastRows > 0);

  await dispatchWebviewMessage({
    type: 'webview/startExecutionSession',
    payload: {
      nodeId: terminalNodeId,
      kind: 'terminal',
      cols: 84,
      rows: 26
    }
  });

  let hostMessages = await getHostMessages();
  assert.ok(
    hostMessages.some(
      (message) =>
        message.type === 'host/error' &&
        message.payload.message === 'This Terminal is already running.'
    )
  );

  const outputMarker = 'DEV_SESSION_CANVAS_TERMINAL_SMOKE';
  await dispatchWebviewMessage({
    type: 'webview/executionInput',
    payload: {
      nodeId: terminalNodeId,
      kind: 'terminal',
      data: `echo ${outputMarker}\r`
    }
  });

  snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentNode = currentSnapshot.state.nodes.find((node) => node.id === terminalNodeId);
    return Boolean(currentNode?.metadata?.terminal?.recentOutput?.includes(outputMarker));
  });
  terminalNode = findNodeById(snapshot, terminalNodeId);
  assert.ok(terminalNode.metadata.terminal.recentOutput.includes(outputMarker));
  assert.strictEqual(terminalNode.status, 'live');

  await dispatchWebviewMessage({
    type: 'webview/stopExecutionSession',
    payload: {
      nodeId: terminalNodeId,
      kind: 'terminal'
    }
  });

  snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentNode = currentSnapshot.state.nodes.find((node) => node.id === terminalNodeId);
    return Boolean(currentNode && currentNode.status === 'closed' && !currentNode.metadata?.terminal?.liveSession);
  });
  terminalNode = findNodeById(snapshot, terminalNodeId);
  assert.strictEqual(terminalNode.status, 'closed');
  assert.strictEqual(terminalNode.metadata.terminal.liveSession, false);
  assert.match(terminalNode.summary, /Terminal/);

  snapshot = await dispatchWebviewMessage({
    type: 'webview/resizeExecutionSession',
    payload: {
      nodeId: terminalNodeId,
      kind: 'terminal',
      cols: 100,
      rows: 30
    }
  });
  terminalNode = findNodeById(snapshot, terminalNodeId);
  assert.strictEqual(terminalNode.metadata.terminal.lastCols, 100);
  assert.strictEqual(terminalNode.metadata.terminal.lastRows, 30);
}

async function verifyExecutionAttentionNotificationBridge(agentNodeId, noteNodeId) {
  const configuration = vscode.workspace.getConfiguration();
  const originalBridgeMode = normalizeAttentionNotificationBridgeMode(
    configuration.get('devSessionCanvas.notifications.attentionSignalBridge', 'system')
  );
  const originalEnabledAttentionSignals = normalizeEnabledAttentionSignals(
    configuration.get('devSessionCanvas.notifications.enabledAttentionSignals', DEFAULT_ATTENTION_SIGNALS)
  );
  const originalStrongReminderMode = normalizeStrongTerminalAttentionReminderMode(
    configuration.get('devSessionCanvas.notifications.strongTerminalAttentionReminder', 'both')
  );
  const bridgeDisabledBothMessage = 'bridge-disabled-both-smoke';
  const strongReminderNoneMessage = 'strong-reminder-none-smoke';
  const strongReminderTitleBarMessage = 'strong-reminder-titlebar-smoke';
  const strongReminderMinimapMessage = 'strong-reminder-minimap-smoke';
  const disabledSignalMessage = 'terminal-signal-disabled-smoke';
  const allowedSignalMessage = 'terminal-signal-enabled-smoke';
  const bridgeEnabledMessage = 'bridge-enabled-smoke';
  const bridgeViewMessage = 'bridge-focus-smoke';
  const bridgeDuplicateMessage = 'bridge-duplicate-smoke';
  let autoSelectNotificationMessage;

  await clearHostMessages();
  await clearDiagnosticEvents();
  await ensureAgentStopped(agentNodeId);
  await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInEditor);
  await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'editor', 20000);

  try {
    await ensureEnabledAttentionSignals(DEFAULT_ATTENTION_SIGNALS);
    await ensureStrongTerminalAttentionReminderMode('both');
    await ensureAttentionNotificationBridgeMode('none');

    await startExecutionSessionForTest({
      kind: 'agent',
      nodeId: agentNodeId,
      cols: 90,
      rows: 28,
      provider: 'codex'
    });
    let snapshot = await waitForAgentLive(agentNodeId);
    const agentNode = findNodeById(snapshot, agentNodeId);
    const agentLabel =
      typeof agentNode.title === 'string' && agentNode.title.trim().length > 0
        ? agentNode.title.trim()
        : 'Agent';

    await withInterceptedInformationMessages(
      async (calls) => {
        const clearAttentionByClick = async () => {
          await performWebviewDomAction({
            kind: 'selectNode',
            nodeId: agentNodeId
          });
          const clearedProbe = await waitForWebviewProbeOnSurface(
            'editor',
            (currentProbe) => {
              const currentNode = currentProbe.nodes.find((node) => node.nodeId === agentNodeId);
              return Boolean(
                currentNode &&
                  currentNode.attentionIndicatorVisible === false &&
                  currentNode.attentionIndicatorFlashing === false &&
                  currentNode.minimapAttentionFlashing === false &&
                  currentNode.minimapAttentionSizePulsing === false
              );
            },
            20000
          );
          assert.strictEqual(
            clearedProbe.nodes.find((node) => node.nodeId === agentNodeId)?.attentionIndicatorVisible,
            false,
            'Selecting the node should clear the attention icon.'
          );
          assert.strictEqual(
            clearedProbe.nodes.find((node) => node.nodeId === agentNodeId)?.minimapAttentionFlashing,
            false,
            'Selecting the node should also clear the minimap attention flash.'
          );
          assert.strictEqual(
            clearedProbe.nodes.find((node) => node.nodeId === agentNodeId)?.minimapAttentionSizePulsing,
            false,
            'Selecting the node should also clear the minimap size pulse.'
          );
        };

        const assertAttentionSurfaceForMode = async ({
          mode,
          message,
          expectedTitleBarFlashing,
          expectedMinimapSizePulsing,
          expectedNoNotificationMessage
        }) => {
          await ensureStrongTerminalAttentionReminderMode(mode);
          calls.length = 0;
          await clearDiagnosticEvents();
          await dispatchWebviewMessage({
            type: 'webview/executionInput',
            payload: {
              nodeId: agentNodeId,
              kind: 'agent',
              data: `notify ${message}\r`
            }
          });

          await waitForSnapshot((currentSnapshot) => {
            const currentNode = currentSnapshot.state.nodes.find((node) => node.id === agentNodeId);
            return Boolean(
              currentNode?.metadata?.agent?.recentOutput?.includes(`[fake-agent] notified ${message}`) &&
                currentNode.status === 'waiting-input' &&
                currentNode?.metadata?.agent?.attentionPending === true
            );
          }, 20000);

          const probe = await waitForWebviewProbeOnSurface(
            'editor',
            (currentProbe) => {
              const currentNode = currentProbe.nodes.find((node) => node.nodeId === agentNodeId);
              return Boolean(
                currentNode &&
                  currentNode.attentionIndicatorVisible === true &&
                  currentNode.attentionIndicatorFlashing === expectedTitleBarFlashing &&
                  currentNode.minimapAttentionFlashing === true &&
                  currentNode.minimapAttentionSizePulsing === expectedMinimapSizePulsing
              );
            },
            20000
          );

          assert.deepStrictEqual(
            calls.map((call) => call.message),
            [],
            expectedNoNotificationMessage
          );
          assert.strictEqual(
            probe.nodes.find((node) => node.nodeId === agentNodeId)?.attentionIndicatorVisible,
            true,
            `${mode} mode should still show the node attention icon.`
          );
          assert.strictEqual(
            probe.nodes.find((node) => node.nodeId === agentNodeId)?.attentionIndicatorFlashing,
            expectedTitleBarFlashing,
            `${mode} mode should ${expectedTitleBarFlashing ? 'enable' : 'disable'} title bar flashing.`
          );
          assert.strictEqual(
            probe.nodes.find((node) => node.nodeId === agentNodeId)?.minimapAttentionFlashing,
            true,
            `${mode} mode should keep the minimap attention flash active.`
          );
          assert.strictEqual(
            probe.nodes.find((node) => node.nodeId === agentNodeId)?.minimapAttentionSizePulsing,
            expectedMinimapSizePulsing,
            `${mode} mode should ${expectedMinimapSizePulsing ? 'enable' : 'disable'} the minimap size pulse.`
          );
          return probe;
        };

        const bothProbe = await assertAttentionSurfaceForMode({
          mode: 'both',
          message: bridgeDisabledBothMessage,
          expectedTitleBarFlashing: true,
          expectedMinimapSizePulsing: true,
          expectedNoNotificationMessage:
            'Bridge-disabled Agent attention signal should not raise a VS Code notification.'
        });
        assert.strictEqual(
          (await getDiagnosticEvents()).some(
            (event) =>
              event.kind === 'execution/attentionNotificationPosted' ||
              event.kind === 'execution/attentionNotificationSuppressed'
          ),
          false,
          'Bridge-disabled Agent attention signal should not emit attention-notification diagnostics.'
        );
        assert.strictEqual(
          bothProbe.nodes.find((node) => node.nodeId === agentNodeId)?.minimapAttentionSizePulsing,
          true,
          'both mode should add minimap size pulsing when bridge is disabled.'
        );
        await clearAttentionByClick();

        const expectedBelMessage = `Agent "${agentLabel}" sent a terminal alert.`;
        await ensureAttentionNotificationBridgeMode('workbench');
        await ensureEnabledAttentionSignals(['osc9', 'osc777']);
        calls.length = 0;
        await clearDiagnosticEvents();
        await dispatchWebviewMessage({
          type: 'webview/executionInput',
          payload: {
            nodeId: agentNodeId,
            kind: 'agent',
            data: `bell ${disabledSignalMessage}\r`
          }
        });
        await waitForSnapshot((currentSnapshot) => {
          const currentNode = currentSnapshot.state.nodes.find((node) => node.id === agentNodeId);
          return Boolean(
            currentNode?.metadata?.agent?.recentOutput?.includes(`[fake-agent] belled ${disabledSignalMessage}`) &&
              currentNode.status === 'waiting-input' &&
              currentNode?.metadata?.agent?.attentionPending !== true
          );
        }, 20000);
        const disabledProbe = await waitForWebviewProbeOnSurface(
          'editor',
          (currentProbe) => {
            const currentNode = currentProbe.nodes.find((node) => node.nodeId === agentNodeId);
            return Boolean(
              currentNode &&
                currentNode.attentionIndicatorVisible === false &&
                currentNode.attentionIndicatorFlashing === false &&
                currentNode.minimapAttentionFlashing === false &&
                currentNode.minimapAttentionSizePulsing === false
            );
          },
          20000
        );
        const disabledDiagnostics = await waitForDiagnosticEvents(
          (events) =>
            events.some(
              (event) =>
                event.kind === 'execution/attentionNotificationSuppressed' &&
                event.detail?.nodeId === agentNodeId &&
                event.detail?.reason === 'signal-disabled' &&
                Array.isArray(event.detail?.signals) &&
                event.detail.signals.includes('bel')
            ),
          20000
        );
        assert.deepStrictEqual(calls.map((call) => call.message), []);
        assert.strictEqual(
          disabledProbe.nodes.find((node) => node.nodeId === agentNodeId)?.attentionIndicatorVisible,
          false,
          'A disabled terminal BEL signal should not create node attention.'
        );
        assert.ok(
          disabledDiagnostics.some(
            (event) =>
              event.kind === 'execution/attentionNotificationSuppressed' &&
              event.detail?.nodeId === agentNodeId &&
              event.detail?.reason === 'signal-disabled'
          ),
          'Expected disabled terminal signal to emit a diagnostic suppression event.'
        );

        await ensureEnabledAttentionSignals(['bel', 'osc9', 'osc777']);
        calls.length = 0;
        await clearDiagnosticEvents();
        await dispatchWebviewMessage({
          type: 'webview/executionInput',
          payload: {
            nodeId: agentNodeId,
            kind: 'agent',
            data: `bell ${allowedSignalMessage}\r`
          }
        });
        await waitForDiagnosticEvents(
          (events) =>
            events.some(
              (event) =>
                event.kind === 'execution/attentionNotificationPosted' &&
                event.detail?.nodeId === agentNodeId &&
                event.detail?.signal === 'bel' &&
                event.detail?.message === expectedBelMessage
            ),
          20000
        );
        const allowedProbe = await waitForWebviewProbeOnSurface(
          'editor',
          (currentProbe) => {
            const currentNode = currentProbe.nodes.find((node) => node.nodeId === agentNodeId);
            return Boolean(
              currentNode &&
                currentNode.attentionIndicatorVisible === true &&
                currentNode.attentionIndicatorFlashing === true &&
                currentNode.minimapAttentionFlashing === true &&
                currentNode.minimapAttentionSizePulsing === true
            );
          },
          20000
        );
        assert.deepStrictEqual(calls.map((call) => call.message), [expectedBelMessage]);
        assert.strictEqual(
          allowedProbe.nodes.find((node) => node.nodeId === agentNodeId)?.attentionIndicatorVisible,
          true,
          'Re-enabling BEL should allow the terminal signal to create node attention again.'
        );
        await clearAttentionByClick();
        await ensureAttentionNotificationBridgeMode('none');

        await assertAttentionSurfaceForMode({
          mode: 'none',
          message: strongReminderNoneMessage,
          expectedTitleBarFlashing: false,
          expectedMinimapSizePulsing: false,
          expectedNoNotificationMessage:
            'none mode should still avoid VS Code notifications when bridge is disabled.'
        });
        await clearAttentionByClick();

        await assertAttentionSurfaceForMode({
          mode: 'titleBar',
          message: strongReminderTitleBarMessage,
          expectedTitleBarFlashing: true,
          expectedMinimapSizePulsing: false,
          expectedNoNotificationMessage:
            'titleBar mode should still avoid VS Code notifications when bridge is disabled.'
        });
        await clearAttentionByClick();

        await assertAttentionSurfaceForMode({
          mode: 'minimap',
          message: strongReminderMinimapMessage,
          expectedTitleBarFlashing: false,
          expectedMinimapSizePulsing: true,
          expectedNoNotificationMessage:
            'minimap mode should still avoid VS Code notifications when bridge is disabled.'
        });
        await clearAttentionByClick();

        await ensureStrongTerminalAttentionReminderMode('both');
        await ensureAttentionNotificationBridgeMode('workbench');

        calls.length = 0;
        await clearDiagnosticEvents();
        const expectedAgentMessage = `Agent「${agentLabel}」: ${bridgeEnabledMessage}`;
        await dispatchWebviewMessage({
          type: 'webview/executionInput',
          payload: {
            nodeId: agentNodeId,
            kind: 'agent',
            data: `notify ${bridgeEnabledMessage}\r`
          }
        });

        const enabledDiagnostics = await waitForDiagnosticEvents(
          (events) =>
            events.some(
              (event) =>
                event.kind === 'execution/attentionNotificationPosted' &&
                event.detail?.nodeId === agentNodeId &&
                event.detail?.signal === 'osc9' &&
                event.detail?.message === expectedAgentMessage
            ),
          20000
        );
        const enabledProbe = await waitForWebviewProbeOnSurface(
          'editor',
          (currentProbe) => {
            const currentNode = currentProbe.nodes.find((node) => node.nodeId === agentNodeId);
            return Boolean(
              currentNode &&
                currentNode.attentionIndicatorVisible === true &&
                currentNode.attentionIndicatorFlashing === true &&
                currentNode.minimapAttentionFlashing === true &&
                currentNode.minimapAttentionSizePulsing === true
            );
          },
          20000
        );
        assert.deepStrictEqual(calls.map((call) => call.message), [expectedAgentMessage]);
        assert.strictEqual(
          enabledProbe.nodes.find((node) => node.nodeId === agentNodeId)?.attentionIndicatorVisible,
          true,
          'Bridge-enabled Agent attention signal should still show the node attention icon.'
        );
        assert.strictEqual(
          enabledProbe.nodes.find((node) => node.nodeId === agentNodeId)?.attentionIndicatorFlashing,
          true,
          'Bridge-enabled Agent attention signal should flash the node title bar in both mode.'
        );
        assert.strictEqual(
          enabledProbe.nodes.find((node) => node.nodeId === agentNodeId)?.minimapAttentionFlashing,
          true,
          'Bridge-enabled Agent attention signal should also flash the minimap node.'
        );
        assert.strictEqual(
          enabledProbe.nodes.find((node) => node.nodeId === agentNodeId)?.minimapAttentionSizePulsing,
          true,
          'Bridge-enabled Agent attention signal should add minimap size pulsing in both mode.'
        );
        assert.ok(
          enabledDiagnostics.some(
            (event) =>
              event.kind === 'execution/attentionNotificationPosted' &&
              event.detail?.nodeId === agentNodeId &&
              event.detail?.signal === 'osc9' &&
              event.detail?.message === expectedAgentMessage
          ),
          'Expected enabled Agent attention bridge to emit an OSC 9 notification diagnostic.'
        );

        await clearAttentionByClick();

        calls.length = 0;
        await performWebviewDomAction({
          kind: 'selectNode',
          nodeId: noteNodeId
        });
        await waitForWebviewProbeOnSurface(
          'editor',
          (currentProbe) => currentProbe.nodes.some((node) => node.nodeId === noteNodeId && node.selected === true),
          20000
        );

        autoSelectNotificationMessage = `Agent「${agentLabel}」: ${bridgeViewMessage}`;
        await clearHostMessages();
        await clearDiagnosticEvents();
        await dispatchWebviewMessage({
          type: 'webview/executionInput',
          payload: {
            nodeId: agentNodeId,
            kind: 'agent',
            data: `notify ${bridgeViewMessage}\r`
          }
        });

        const centerHostMessages = await waitForHostMessages(
          (messages) =>
            messages.some(
              (message) => message.type === 'host/centerNode' && message.payload.nodeId === agentNodeId
            ),
          20000
        );
        assert.deepStrictEqual(calls.map((call) => call.message), [autoSelectNotificationMessage]);
        assert.ok(
          calls[0]?.items.includes(EXECUTION_ATTENTION_FOCUS_ACTION_LABEL),
          'Expected attention notification to expose a view action.'
        );
        assert.ok(
          centerHostMessages.some(
            (message) => message.type === 'host/centerNode' && message.payload.nodeId === agentNodeId
          ),
          'Expected selecting the attention notification to send a center-node host message.'
        );
        assert.ok(
          centerHostMessages.some(
            (message) => message.type === 'host/visibilityRestored' && message.payload?.restoreFocus === false
          ),
          'Expected selecting the attention notification to return to the canvas without restoring Webview focus.'
        );
        assert.strictEqual(
          centerHostMessages.some(
            (message) => message.type === 'host/focusNode' && message.payload?.nodeId === agentNodeId
          ),
          false,
          'Selecting the attention notification should not send a focus-node host message.'
        );

        const centerProbe = await waitForWebviewProbeOnSurface(
          'editor',
          (currentProbe) => {
            const currentNode = currentProbe.nodes.find((node) => node.nodeId === agentNodeId);
            const noteNode = currentProbe.nodes.find((node) => node.nodeId === noteNodeId);
            return Boolean(
              currentNode &&
                noteNode &&
                currentNode.selected === false &&
                noteNode.selected === true &&
                currentNode.attentionIndicatorVisible === true &&
                currentNode.attentionIndicatorFlashing === true &&
                currentNode.minimapAttentionFlashing === true &&
                currentNode.minimapAttentionSizePulsing === true
            );
          },
          20000
        );
        assert.ok(centerProbe.nodes.some((node) => node.nodeId === noteNodeId && node.selected === true));
        assert.strictEqual(
          centerProbe.nodes.find((node) => node.nodeId === agentNodeId)?.attentionIndicatorVisible,
          true,
          'Viewing the node from the VS Code notification should keep the attention icon until the user clicks the node.'
        );
        assert.strictEqual(
          centerProbe.nodes.find((node) => node.nodeId === agentNodeId)?.minimapAttentionFlashing,
          true,
          'Viewing the node from the VS Code notification should keep the minimap attention flash.'
        );
        assert.strictEqual(
          centerProbe.nodes.find((node) => node.nodeId === agentNodeId)?.minimapAttentionSizePulsing,
          true,
          'Viewing the node from the VS Code notification should keep the minimap size pulse.'
        );

        calls.length = 0;
        autoSelectNotificationMessage = undefined;
        await clearDiagnosticEvents();
        const expectedDuplicateMessage = `Agent「${agentLabel}」: ${bridgeDuplicateMessage}`;
        await dispatchWebviewMessage({
          type: 'webview/executionInput',
          payload: {
            nodeId: agentNodeId,
            kind: 'agent',
            data: `notify ${bridgeDuplicateMessage}\r`
          }
        });
        await waitForDiagnosticEvents(
          (events) =>
            events.some(
              (event) =>
                event.kind === 'execution/attentionNotificationPosted' &&
                event.detail?.nodeId === agentNodeId &&
                event.detail?.message === expectedDuplicateMessage
            ),
          20000
        );
        await dispatchWebviewMessage({
          type: 'webview/executionInput',
          payload: {
            nodeId: agentNodeId,
            kind: 'agent',
            data: `notify ${bridgeDuplicateMessage}\r`
          }
        });

        const duplicateDiagnostics = await waitForDiagnosticEvents(
          (events) =>
            events.filter(
              (event) =>
                event.kind === 'execution/attentionNotificationPosted' &&
                event.detail?.nodeId === agentNodeId &&
                event.detail?.message === expectedDuplicateMessage
            ).length === 1 &&
            events.some(
              (event) =>
                event.kind === 'execution/attentionNotificationSuppressed' &&
                event.detail?.nodeId === agentNodeId &&
                event.detail?.reason === 'cooldown' &&
                event.detail?.signal === 'osc9'
            ),
          20000
        );
        assert.deepStrictEqual(calls.map((call) => call.message), [expectedDuplicateMessage]);
        assert.ok(
          duplicateDiagnostics.some(
            (event) =>
              event.kind === 'execution/attentionNotificationSuppressed' &&
              event.detail?.nodeId === agentNodeId &&
              event.detail?.reason === 'cooldown' &&
              event.detail?.signal === 'osc9'
          ),
          'Expected repeated Agent attention signal to be suppressed during the cooldown window.'
        );
      },
      ({ message }) =>
        message === autoSelectNotificationMessage ? EXECUTION_ATTENTION_FOCUS_ACTION_LABEL : undefined
    );
  } finally {
    await ensureAgentStopped(agentNodeId);
    await ensureAttentionNotificationBridgeMode(originalBridgeMode);
    await ensureEnabledAttentionSignals(originalEnabledAttentionSignals);
    await ensureStrongTerminalAttentionReminderMode(originalStrongReminderMode);
    await clearHostMessages();
    await clearDiagnosticEvents();
  }
}

async function verifyAgentAbnormalInterruptionNotifications() {
  const configuration = vscode.workspace.getConfiguration();
  const originalBridgeMode = normalizeAttentionNotificationBridgeMode(
    configuration.get('devSessionCanvas.notifications.attentionSignalBridge', 'system')
  );
  const originalTextNotificationMode = normalizeAgentAbnormalOutputTextNotificationMode(
    configuration.get('devSessionCanvas.notifications.agentAbnormalOutputTextNotifications', 'off')
  );
  const originalEnabledAttentionSignals = normalizeEnabledAttentionSignals(
    configuration.get('devSessionCanvas.notifications.enabledAttentionSignals', DEFAULT_ATTENTION_SIGNALS)
  );
  const originalRuntimePersistenceEnabled = configuration.get('devSessionCanvas.runtimePersistence.enabled', false);

  await clearHostMessages();
  await clearDiagnosticEvents();

  try {
    await setRuntimePersistenceEnabled(false);
    await ensureAttentionNotificationBridgeMode('workbench');
    await ensureAgentAbnormalOutputTextNotificationMode('off');
    await ensureEnabledAttentionSignals(DEFAULT_ATTENTION_SIGNALS);

    await withInterceptedInformationMessages(async (calls) => {
      let snapshot = await getDebugSnapshot();
      const baselineAgentIds = new Set(snapshot.state.nodes.filter((node) => node.kind === 'agent').map((node) => node.id));

      await vscode.commands.executeCommand(COMMAND_IDS.testCreateNode, 'agent', 'codex', {
        agentProvider: 'codex',
        titleOverride: 'Codex Crash Smoke'
      });
      snapshot = await waitForSnapshot(
        (currentSnapshot) => currentSnapshot.state.nodes.some((node) => node.kind === 'agent' && !baselineAgentIds.has(node.id)),
        20000
      );
      const codexAgent = snapshot.state.nodes.find((node) => node.kind === 'agent' && !baselineAgentIds.has(node.id));
      assert.ok(codexAgent, 'Expected a dedicated Codex abnormal-exit smoke agent.');

      await waitForAgentLive(codexAgent.id);
      await dispatchWebviewMessage({
        type: 'webview/executionInput',
        payload: {
          nodeId: codexAgent.id,
          kind: 'agent',
          data: 'exit 27\r'
        }
      });

      const codexDiagnostics = await waitForDiagnosticEvents(
        (events) =>
          events.some(
            (event) =>
              event.kind === 'execution/attentionNotificationPosted' &&
              event.detail?.trigger === 'agent-abnormal-interruption' &&
              event.detail?.nodeId === codexAgent.id &&
              event.detail?.provider === 'codex' &&
              event.detail?.lifecycleStatus === 'error'
          ),
        20000
      );
      snapshot = await waitForSnapshot((currentSnapshot) => {
        const currentAgent = currentSnapshot.state.nodes.find((node) => node.id === codexAgent.id);
        return Boolean(
          currentAgent?.status === 'error' &&
            currentAgent?.metadata?.agent?.attentionPending === true &&
            currentAgent?.metadata?.agent?.lastExitCode === 27
        );
      }, 20000);
      const codexErrorNode = findNodeById(snapshot, codexAgent.id);
      assert.strictEqual(codexErrorNode.metadata.agent.attentionPending, true);
      assert.ok(
        codexDiagnostics.some(
          (event) =>
            event.kind === 'execution/attentionNotificationPosted' &&
            event.detail?.trigger === 'agent-abnormal-interruption' &&
            event.detail?.exitCode === 27
        ),
        'Expected a Codex abnormal exit to post an attention notification diagnostic.'
      );
      await waitForInterceptedInformationMessage(
        calls,
        (call) =>
          /Codex Agent \"Codex Crash Smoke\" was interrupted unexpectedly/.test(call.message) &&
          call.items.includes(EXECUTION_ATTENTION_FOCUS_ACTION_LABEL),
        'Expected a Codex abnormal exit to surface a workbench attention notification.'
      );

      await performWebviewDomAction({
        kind: 'selectNode',
        nodeId: codexAgent.id
      });
      await waitForSnapshot((currentSnapshot) => {
        const currentAgent = currentSnapshot.state.nodes.find((node) => node.id === codexAgent.id);
        return currentAgent?.metadata?.agent?.attentionPending === false;
      }, 20000);

      await clearDiagnosticEvents();
      calls.length = 0;
      await ensureEnabledAttentionSignals(['bel', 'osc9', 'osc777', 'codexAbnormalOutputText']);
      await startExecutionSessionForTest({
        kind: 'agent',
        nodeId: codexAgent.id,
        cols: 90,
        rows: 28,
        provider: 'codex'
      });
      await waitForAgentLive(codexAgent.id);
      await dispatchWebviewMessage({
        type: 'webview/executionInput',
        payload: {
          nodeId: codexAgent.id,
          kind: 'agent',
          data: 'exit 29\r'
        }
      });
      const disabledAbnormalExitDiagnostics = await waitForDiagnosticEvents(
        (events) =>
          events.some(
            (event) =>
              event.kind === 'execution/attentionNotificationSuppressed' &&
              event.detail?.trigger === 'agent-abnormal-interruption' &&
              event.detail?.reason === 'signal-disabled' &&
              event.detail?.signal === 'agentAbnormalExit' &&
              event.detail?.nodeId === codexAgent.id
          ),
        20000
      );
      await waitForSnapshot((currentSnapshot) => {
        const currentAgent = currentSnapshot.state.nodes.find((node) => node.id === codexAgent.id);
        return Boolean(
          currentAgent?.status === 'error' &&
            currentAgent?.metadata?.agent?.lastExitCode === 29 &&
            currentAgent?.metadata?.agent?.attentionPending !== true
        );
      }, 20000);
      assert.ok(
        disabledAbnormalExitDiagnostics.some(
          (event) =>
            event.kind === 'execution/attentionNotificationSuppressed' &&
            event.detail?.signal === 'agentAbnormalExit'
        ),
        'Expected disabling agentAbnormalExit to suppress Agent abnormal-exit attention.'
      );
      assert.ok(
        !calls.some((call) => /was interrupted unexpectedly/.test(call.message)),
        'Expected disabled agentAbnormalExit not to surface a workbench notification.'
      );

      await ensureEnabledAttentionSignals(DEFAULT_ATTENTION_SIGNALS);

      await clearDiagnosticEvents();
      calls.length = 0;
      await startExecutionSessionForTest({
        kind: 'agent',
        nodeId: codexAgent.id,
        cols: 90,
        rows: 28,
        provider: 'codex',
        injectAgentOutputChunk: '\n■ {"error":{"message":"Internal server error"}}\n› Write tests for @filename\n'
      });
      await sleep(300);
      let textDiagnostics = await getDiagnosticEvents();
      assert.ok(
        !textDiagnostics.some(
          (event) =>
            event.kind === 'execution/attentionNotificationPosted' &&
            event.detail?.trigger === 'agent-abnormal-stream-interruption' &&
            event.detail?.nodeId === codexAgent.id
        ),
        'Expected Codex stream text not to notify while abnormal text matching is off by default.'
      );
      assert.ok(
        !calls.some((call) => /output stream was interrupted/.test(call.message)),
        'Expected default-off Codex stream text not to surface a workbench notification.'
      );

      await ensureAgentAbnormalOutputTextNotificationMode('codex');

      await clearDiagnosticEvents();
      calls.length = 0;
      await ensureEnabledAttentionSignals(['bel', 'osc9', 'osc777', 'agentAbnormalExit']);
      await startExecutionSessionForTest({
        kind: 'agent',
        nodeId: codexAgent.id,
        cols: 90,
        rows: 28,
        provider: 'codex',
        injectAgentOutputChunk: '\n■ {"error":{"message":"Internal server error"}}\n› Write tests for @filename\n'
      });
      const disabledStreamDiagnostics = await waitForDiagnosticEvents(
        (events) =>
          events.some(
            (event) =>
              event.kind === 'execution/attentionNotificationSuppressed' &&
              event.detail?.trigger === 'agent-abnormal-stream-interruption' &&
              event.detail?.reason === 'signal-disabled' &&
              event.detail?.signal === 'codexAbnormalOutputText' &&
              event.detail?.nodeId === codexAgent.id
          ),
        20000
      );
      await sleep(300);
      snapshot = await getDebugSnapshot();
      assert.notStrictEqual(
        findNodeById(snapshot, codexAgent.id).metadata.agent.attentionPending,
        true,
        'Disabling codexAbnormalOutputText should avoid setting node attention for Codex final-failure text.'
      );
      assert.ok(
        disabledStreamDiagnostics.some(
          (event) =>
            event.kind === 'execution/attentionNotificationSuppressed' &&
            event.detail?.signal === 'codexAbnormalOutputText'
        ),
        'Expected disabling codexAbnormalOutputText to suppress Codex abnormal text attention.'
      );
      assert.ok(
        !calls.some((call) => /output stream was interrupted/.test(call.message)),
        'Expected disabled codexAbnormalOutputText not to surface a workbench notification for Codex final-failure text.'
      );

      await ensureEnabledAttentionSignals(DEFAULT_ATTENTION_SIGNALS);
      await clearDiagnosticEvents();
      calls.length = 0;
      await startExecutionSessionForTest({
        kind: 'agent',
        nodeId: codexAgent.id,
        cols: 90,
        rows: 28,
        provider: 'codex',
        injectAgentOutputChunk:
          '\n■ stream disconnected before completion: stream closed before response.completed\n› Write tests for @filename\n'
      });
      const finalStreamDiagnostics = await waitForDiagnosticEvents(
        (events) =>
          events.some(
            (event) =>
              event.kind === 'execution/attentionNotificationPosted' &&
              event.detail?.trigger === 'agent-abnormal-stream-interruption' &&
              event.detail?.nodeId === codexAgent.id &&
              event.detail?.provider === 'codex' &&
              event.detail?.reason === 'output-pattern'
          ),
        20000
      );
      snapshot = await waitForSnapshot((currentSnapshot) => {
        const currentAgent = currentSnapshot.state.nodes.find((node) => node.id === codexAgent.id);
        return currentAgent?.metadata?.agent?.attentionPending === true;
      }, 20000);
      assert.strictEqual(findNodeById(snapshot, codexAgent.id).metadata.agent.attentionPending, true);
      assert.ok(
        finalStreamDiagnostics.some(
          (event) =>
            event.kind === 'execution/attentionNotificationPosted' &&
            event.detail?.trigger === 'agent-abnormal-stream-interruption'
        ),
        'Expected tail Codex square-marker stream-disconnected output to post a supplemental diagnostic.'
      );
      await waitForInterceptedInformationMessage(
        calls,
        (call) =>
          /Codex Agent \"Codex Crash Smoke\" output stream was interrupted/.test(call.message) &&
          /stream disconnected before completion/.test(call.message) &&
          call.items.includes(EXECUTION_ATTENTION_FOCUS_ACTION_LABEL),
        'Expected tail Codex square-marker stream-disconnected output to surface a supplemental workbench notification.'
      );
      await performWebviewDomAction({
        kind: 'selectNode',
        nodeId: codexAgent.id
      });
      await waitForSnapshot((currentSnapshot) => {
        const currentAgent = currentSnapshot.state.nodes.find((node) => node.id === codexAgent.id);
        return currentAgent?.metadata?.agent?.attentionPending === false;
      }, 20000);

      await clearDiagnosticEvents();
      calls.length = 0;
      await startExecutionSessionForTest({
        kind: 'agent',
        nodeId: codexAgent.id,
        cols: 90,
        rows: 28,
        provider: 'codex',
        injectAgentOutputChunks: [
          '\nReconnecting... 1/5 (23m 57s · esc to interrupt)\n',
          '└ Stream disconnected before completion: stream closed before response.completed\n',
          'Reconnecting... 2/5 (23m 58s · esc to interrupt)\n',
          '└ Stream disconnected before completion: stream closed before response.completed\n'
        ]
      });
      await sleep(300);
      textDiagnostics = await getDiagnosticEvents();
      snapshot = await getDebugSnapshot();
      assert.notStrictEqual(
        findNodeById(snapshot, codexAgent.id).metadata.agent.attentionPending,
        true,
        'Codex reconnecting tree output should not set node attention while the agent is still retrying.'
      );
      assert.ok(
        !textDiagnostics.some(
          (event) =>
            event.kind === 'execution/attentionNotificationPosted' &&
            event.detail?.trigger === 'agent-abnormal-stream-interruption'
        ),
        'Expected Codex reconnecting tree output not to post a supplemental diagnostic.'
      );
      assert.ok(
        !calls.some(
          (call) => /output stream was interrupted/.test(call.message) && /stream disconnected before completion/.test(call.message)
        ),
        'Expected Codex reconnecting tree output not to surface a workbench notification.'
      );

      await clearDiagnosticEvents();
      calls.length = 0;
      await startExecutionSessionForTest({
        kind: 'agent',
        nodeId: codexAgent.id,
        cols: 90,
        rows: 28,
        provider: 'codex',
        injectAgentOutputChunk: '\n■ {"error":{"message":"Internal server error"}}\n› Write tests for @filename\n'
      });
      const internalServerDiagnostics = await waitForDiagnosticEvents(
        (events) =>
          events.some(
            (event) =>
              event.kind === 'execution/attentionNotificationPosted' &&
              event.detail?.trigger === 'agent-abnormal-stream-interruption' &&
              event.detail?.nodeId === codexAgent.id &&
              event.detail?.provider === 'codex' &&
              event.detail?.reason === 'output-pattern'
          ),
        20000
      );
      snapshot = await waitForSnapshot((currentSnapshot) => {
        const currentAgent = currentSnapshot.state.nodes.find((node) => node.id === codexAgent.id);
        return currentAgent?.metadata?.agent?.attentionPending === true;
      }, 20000);
      assert.strictEqual(findNodeById(snapshot, codexAgent.id).metadata.agent.attentionPending, true);
      assert.ok(
        internalServerDiagnostics.some(
          (event) =>
            event.kind === 'execution/attentionNotificationPosted' &&
            event.detail?.trigger === 'agent-abnormal-stream-interruption'
        ),
        'Expected Codex internal-server-error output to post a supplemental attention notification diagnostic when enabled.'
      );
      await waitForInterceptedInformationMessage(
        calls,
        (call) =>
          /Codex Agent \"Codex Crash Smoke\" output stream was interrupted/.test(call.message) &&
          /Internal server error/.test(call.message) &&
          call.items.includes(EXECUTION_ATTENTION_FOCUS_ACTION_LABEL),
        'Expected Codex internal-server-error output to surface a supplemental workbench attention notification.'
      );
      await performWebviewDomAction({
        kind: 'selectNode',
        nodeId: codexAgent.id
      });
      await waitForSnapshot((currentSnapshot) => {
        const currentAgent = currentSnapshot.state.nodes.find((node) => node.id === codexAgent.id);
        return currentAgent?.metadata?.agent?.attentionPending === false;
      }, 20000);

      await clearDiagnosticEvents();
      calls.length = 0;
      const beforeClaudeTextSnapshot = await getDebugSnapshot();
      await startExecutionSessionForTest({
        kind: 'agent',
        nodeId: codexAgent.id,
        cols: 90,
        rows: 28,
        provider: 'claude',
        injectAgentOutputChunk:
          '\n■ stream disconnected before completion: stream closed before response.completed\n'
      });
      await waitForSnapshot((currentSnapshot) => currentSnapshot !== beforeClaudeTextSnapshot, 20000);
      await sleep(300);
      textDiagnostics = await getDiagnosticEvents();
      assert.ok(
        !textDiagnostics.some(
          (event) =>
            event.kind === 'execution/attentionNotificationPosted' &&
            event.detail?.trigger === 'agent-abnormal-stream-interruption'
        ),
        'Expected Claude stream-disconnected-like text not to notify even when Codex text matching is enabled.'
      );
      assert.ok(
        !calls.some((call) => /output stream was interrupted/.test(call.message)),
        'Expected Claude stream-disconnected-like text not to surface a workbench notification.'
      );

      await clearDiagnosticEvents();
      calls.length = 0;
      const beforeStaleTextSnapshot = await getDebugSnapshot();
      await startExecutionSessionForTest({
        kind: 'agent',
        nodeId: codexAgent.id,
        cols: 90,
        rows: 28,
        provider: 'codex',
        injectAgentExistingOutput:
          'Read README.md\n■ stream disconnected before completion: stream closed before response.completed\n',
        injectAgentOutputChunk: '> next prompt\n'
      });
      await waitForSnapshot((currentSnapshot) => currentSnapshot !== beforeStaleTextSnapshot, 20000);
      await sleep(300);
      textDiagnostics = await getDiagnosticEvents();
      assert.ok(
        !textDiagnostics.some(
          (event) =>
            event.kind === 'execution/attentionNotificationPosted' &&
            event.detail?.trigger === 'agent-abnormal-stream-interruption'
        ),
        'Expected a stale stream-disconnected line already present in the buffer not to notify on the next turn.'
      );
      assert.ok(
        !calls.some((call) => /output stream was interrupted/.test(call.message)),
        'Expected stale buffered stream text not to surface a workbench notification.'
      );

      await ensureAgentAbnormalOutputTextNotificationMode('off');
      snapshot = await getDebugSnapshot();
      await setPersistedState({
        ...snapshot.state,
        nodes: snapshot.state.nodes.filter((node) => node.id !== codexAgent.id)
      });

      await clearDiagnosticEvents();
      calls.length = 0;
      snapshot = await getDebugSnapshot();
      const baselineBeforeClaudeIds = new Set(snapshot.state.nodes.filter((node) => node.kind === 'agent').map((node) => node.id));

      await vscode.commands.executeCommand(COMMAND_IDS.testCreateNode, 'agent', 'claude', {
        agentLaunchPreset: 'custom',
        agentCustomLaunchCommand: 'claude',
        titleOverride: 'Claude Crash Smoke'
      });
      snapshot = await waitForSnapshot(
        (currentSnapshot) =>
          currentSnapshot.state.nodes.some((node) => node.kind === 'agent' && !baselineBeforeClaudeIds.has(node.id)),
        20000
      );
      const claudeAgent = snapshot.state.nodes.find(
        (node) => node.kind === 'agent' && !baselineBeforeClaudeIds.has(node.id)
      );
      assert.ok(claudeAgent, 'Expected a dedicated Claude abnormal-exit smoke agent.');

      await waitForAgentLive(claudeAgent.id);
      await dispatchWebviewMessage({
        type: 'webview/executionInput',
        payload: {
          nodeId: claudeAgent.id,
          kind: 'agent',
          data: 'exit 33\r'
        }
      });

      const claudeCrashDiagnostics = await waitForDiagnosticEvents(
        (events) =>
          events.some(
            (event) =>
              event.kind === 'execution/attentionNotificationPosted' &&
              event.detail?.trigger === 'agent-abnormal-interruption' &&
              event.detail?.nodeId === claudeAgent.id &&
              event.detail?.provider === 'claude' &&
              event.detail?.lifecycleStatus === 'error'
          ),
        20000
      );
      snapshot = await waitForSnapshot((currentSnapshot) => {
        const currentAgent = currentSnapshot.state.nodes.find((node) => node.id === claudeAgent.id);
        return Boolean(
          currentAgent?.status === 'error' &&
            currentAgent?.metadata?.agent?.attentionPending === true &&
            currentAgent?.metadata?.agent?.lastExitCode === 33
        );
      }, 20000);
      const claudeErrorNode = findNodeById(snapshot, claudeAgent.id);
      assert.strictEqual(claudeErrorNode.metadata.agent.attentionPending, true);
      assert.ok(
        claudeCrashDiagnostics.some(
          (event) =>
            event.kind === 'execution/attentionNotificationPosted' &&
            event.detail?.trigger === 'agent-abnormal-interruption' &&
            event.detail?.exitCode === 33
        ),
        'Expected a Claude abnormal exit to post an attention notification diagnostic.'
      );
      await waitForInterceptedInformationMessage(
        calls,
        (call) =>
          /Claude Code Agent \"Claude Crash Smoke\" was interrupted unexpectedly/.test(call.message) &&
          call.items.includes(EXECUTION_ATTENTION_FOCUS_ACTION_LABEL),
        'Expected a Claude abnormal exit to surface a workbench attention notification.'
      );

      await performWebviewDomAction({
        kind: 'selectNode',
        nodeId: claudeAgent.id
      });
      await waitForSnapshot((currentSnapshot) => {
        const currentAgent = currentSnapshot.state.nodes.find((node) => node.id === claudeAgent.id);
        return currentAgent?.metadata?.agent?.attentionPending === false;
      }, 20000);

      await clearDiagnosticEvents();
      calls.length = 0;
      const failingClaudeCommandDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsc-claude-resume-fail-'));
      const failingClaudeCommandPath = path.join(
        failingClaudeCommandDir,
        process.platform === 'win32' ? 'claude.cmd' : 'claude'
      );
      const previousClaudeCommandEnv = process.env.DEV_SESSION_CANVAS_TEST_CLAUDE_COMMAND;

      try {
        if (process.platform === 'win32') {
          await fs.writeFile(
            failingClaudeCommandPath,
            '@echo off\r\necho [fake-claude] resume crash\r\nexit /b 33\r\n',
            'utf8'
          );
        } else {
          await fs.writeFile(
            failingClaudeCommandPath,
            '#!/usr/bin/env bash\necho "[fake-claude] resume crash"\nexit 33\n',
            'utf8'
          );
          await fs.chmod(failingClaudeCommandPath, 0o755);
        }
        process.env.DEV_SESSION_CANVAS_TEST_CLAUDE_COMMAND = failingClaudeCommandPath;

        const resumeSessionId = `claude-resume-failure-smoke-${Date.now()}`;
        snapshot = await getDebugSnapshot();
        await setPersistedState({
          ...snapshot.state,
          nodes: snapshot.state.nodes.map((node) =>
            node.id === claudeAgent.id
              ? {
                  ...node,
                  title: 'Claude Resume Failure Smoke',
                  status: 'resume-ready',
                  summary: '准备恢复 Claude Code 会话。',
                  metadata: {
                    ...node.metadata,
                    agent: {
                      ...node.metadata.agent,
                      provider: 'claude',
                      lifecycle: 'resume-ready',
                      launchPreset: 'default',
                      customLaunchCommand: undefined,
                      resumeSupported: true,
                      resumeStrategy: 'claude-session-id',
                      resumeSessionId,
                      resumeStoragePath: undefined,
                      liveSession: false,
                      pendingLaunch: undefined,
                      attentionPending: false,
                      lastExitCode: undefined,
                      lastExitSignal: undefined,
                      lastExitMessage: undefined,
                      lastResumeError: undefined,
                      recentOutput: undefined
                    }
                  }
                }
              : node
          )
        });

        await startExecutionSessionForTest({
          kind: 'agent',
          nodeId: claudeAgent.id,
          cols: 90,
          rows: 28,
          provider: 'claude',
          resumeRequested: true
        });

        snapshot = await waitForSnapshot((currentSnapshot) => {
          const currentAgent = currentSnapshot.state.nodes.find((node) => node.id === claudeAgent.id);
          return Boolean(
            currentAgent?.status === 'resume-failed' &&
              currentAgent?.metadata?.agent?.attentionPending !== true &&
              currentAgent?.metadata?.agent?.lastExitCode === 33
          );
        }, 20000);
        await sleep(300);
        const claudeResumeFailedNode = findNodeById(await getDebugSnapshot(), claudeAgent.id);
        assert.strictEqual(claudeResumeFailedNode.metadata.agent.attentionPending, false);
        const claudeResumeDiagnostics = await getDiagnosticEvents();
        assert.ok(
          !claudeResumeDiagnostics.some(
            (event) =>
              event.kind === 'execution/attentionNotificationPosted' &&
              event.detail?.trigger === 'agent-abnormal-interruption' &&
              event.detail?.nodeId === claudeAgent.id
          ),
          'Expected a Claude resume startup failure not to post a supplemental attention notification diagnostic.'
        );
        assert.ok(
          !calls.some((call) => /Claude Code Agent "Claude Resume Failure Smoke"/.test(call.message)),
          'Expected a Claude resume startup failure not to surface a supplemental workbench notification.'
        );

        await dispatchWebviewMessage({
          type: 'webview/deleteNode',
          payload: {
            nodeId: claudeAgent.id
          }
        });
        await waitForSnapshot(
          (currentSnapshot) => !currentSnapshot.state.nodes.some((node) => node.id === claudeAgent.id),
          20000
        );
      } finally {
        if (previousClaudeCommandEnv === undefined) {
          delete process.env.DEV_SESSION_CANVAS_TEST_CLAUDE_COMMAND;
        } else {
          process.env.DEV_SESSION_CANVAS_TEST_CLAUDE_COMMAND = previousClaudeCommandEnv;
        }
        await fs.rm(failingClaudeCommandDir, { recursive: true, force: true });
      }
    });
  } finally {
    await setRuntimePersistenceEnabled(originalRuntimePersistenceEnabled);
    await ensureAgentAbnormalOutputTextNotificationMode(originalTextNotificationMode);
    await ensureEnabledAttentionSignals(originalEnabledAttentionSignals);
    await ensureAttentionNotificationBridgeMode(originalBridgeMode);
    await clearHostMessages();
    await clearDiagnosticEvents();
  }
}

async function verifyLegacyAttentionNotificationBridgeMigration() {
  const configuration = vscode.workspace.getConfiguration();
  const bridgeSetting = configuration.inspect('devSessionCanvas.notifications.attentionSignalBridge');
  const legacyBridgeSetting = configuration.inspect(
    'devSessionCanvas.notifications.bridgeTerminalAttentionSignals'
  );
  const legacyPreferNotifierSetting = configuration.inspect(
    'devSessionCanvas.notifications.preferNotifierCompanion'
  );

  try {
    await ensureAttentionNotificationBridgeMode('workbench');

    await clearDiagnosticEvents();
    await writeSmokeUserSettings({
      'devSessionCanvas.notifications.attentionSignalBridge': undefined,
      'devSessionCanvas.notifications.bridgeTerminalAttentionSignals': false
    });
    await waitForDiagnosticEvents(
      (events) =>
        events.some(
          (event) =>
            event.kind === 'execution/attentionNotificationBridgeConfigChanged' &&
            event.detail?.mode === 'none'
        ),
      20000
    );

    await clearDiagnosticEvents();
    await writeSmokeUserSettings({
      'devSessionCanvas.notifications.bridgeTerminalAttentionSignals': undefined,
      'devSessionCanvas.notifications.preferNotifierCompanion': false
    });
    await waitForDiagnosticEvents(
      (events) =>
        events.some(
          (event) =>
            event.kind === 'execution/attentionNotificationBridgeConfigChanged' &&
            event.detail?.mode === 'workbench'
        ),
      20000
    );

    await clearDiagnosticEvents();
    await writeSmokeUserSettings({
      'devSessionCanvas.notifications.preferNotifierCompanion': undefined
    });
    await waitForDiagnosticEvents(
      (events) =>
        events.some(
          (event) =>
            event.kind === 'execution/attentionNotificationBridgeConfigChanged' &&
            event.detail?.mode === 'system'
        ),
      20000
    );

    await clearDiagnosticEvents();
    await writeSmokeUserSettings({
      'devSessionCanvas.notifications.bridgeTerminalAttentionSignals': true
    });
    await waitForDiagnosticEvents(
      (events) =>
        events.some(
          (event) =>
            event.kind === 'execution/attentionNotificationBridgeConfigChanged' &&
            event.detail?.mode === 'workbench'
        ),
      20000
    );

    await clearDiagnosticEvents();
    await writeSmokeUserSettings({
      'devSessionCanvas.notifications.bridgeTerminalAttentionSignals': undefined,
      'devSessionCanvas.notifications.preferNotifierCompanion': true
    });
    await waitForDiagnosticEvents(
      (events) =>
        events.some(
          (event) =>
            event.kind === 'execution/attentionNotificationBridgeConfigChanged' &&
            event.detail?.mode === 'system'
        ),
      20000
    );
  } finally {
    await writeSmokeUserSettings({
      'devSessionCanvas.notifications.attentionSignalBridge': bridgeSetting?.globalValue,
      'devSessionCanvas.notifications.bridgeTerminalAttentionSignals': legacyBridgeSetting?.globalValue,
      'devSessionCanvas.notifications.preferNotifierCompanion': legacyPreferNotifierSetting?.globalValue
    });
    await clearDiagnosticEvents();
  }
}

async function verifyExecutionTerminalNativeInteractions(terminalNodeId) {
  await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInEditor);
  await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'editor', 20000);
  await ensureTerminalStopped(terminalNodeId);
  await clearHostMessages();
  await clearDiagnosticEvents();

  const originalOpenLocalhostLinks = vscode.workspace
    .getConfiguration('workbench')
    .get('browser.openLocalhostLinks', false);

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(workspaceFolder, 'Smoke workspace is missing a workspace folder.');

  const scratchDir = path.join(
    workspaceFolder.uri.fsPath,
    '.debug',
    'vscode-smoke',
    'execution-native-interactions'
  );
  const droppedFilePath = path.join(scratchDir, 'drop target file.txt');
  const ignoredFilePath = path.join(scratchDir, 'ignored-second.txt');
  const linkTargetPath = path.join(scratchDir, 'link-target.ts');

  await fs.mkdir(scratchDir, { recursive: true });
  await fs.writeFile(droppedFilePath, 'drop target\n', 'utf8');
  await fs.writeFile(ignoredFilePath, 'ignored second file\n', 'utf8');
  await fs.writeFile(
    linkTargetPath,
    ['export const one = 1;', 'export const two = 2;', 'export const three = 3;'].join('\n') + '\n',
    'utf8'
  );

  let browserSmokeServer;
  try {
    await dispatchWebviewMessage(
      {
        type: 'webview/startExecutionSession',
        payload: {
          nodeId: terminalNodeId,
          kind: 'terminal',
          cols: 92,
          rows: 28
        }
      },
      'editor'
    );
    await waitForTerminalLive(terminalNodeId);
    await clearHostMessages();
    await clearDiagnosticEvents();

    await performWebviewDomAction(
      {
        kind: 'sendExecutionInput',
        nodeId: terminalNodeId,
        data: `printf '${TERMINAL_NATIVE_DROP_MARKER}:%s\\n' `
      },
      'editor',
      10000
    );
    await performWebviewDomAction(
      {
        kind: 'dropExecutionResources',
        nodeId: terminalNodeId,
        source: 'resourceUrls',
        values: [vscode.Uri.file(droppedFilePath).toString(), vscode.Uri.file(ignoredFilePath).toString()]
      },
      'editor',
      10000
    );
    await performWebviewDomAction(
      {
        kind: 'sendExecutionInput',
        nodeId: terminalNodeId,
        data: '\r'
      },
      'editor',
      10000
    );

    let snapshot = await waitForSnapshot((currentSnapshot) => {
      const currentTerminal = currentSnapshot.state.nodes.find((node) => node.id === terminalNodeId);
      return Boolean(
        currentTerminal?.metadata?.terminal?.recentOutput?.includes(
          `${TERMINAL_NATIVE_DROP_MARKER}:${droppedFilePath}`
        )
      );
    }, 20000);
    let terminalNode = findNodeById(snapshot, terminalNodeId);
    assert.ok(
      terminalNode.metadata.terminal.recentOutput.includes(`${TERMINAL_NATIVE_DROP_MARKER}:${droppedFilePath}`),
      'Dropped resource should be inserted into the live terminal session as shell input.'
    );
    assert.strictEqual(
      terminalNode.metadata.terminal.recentOutput.includes(ignoredFilePath),
      false,
      'Only the first dropped resource should be consumed.'
    );

    await waitForDiagnosticEvents(
      (events) =>
        events.some(
          (event) =>
            event.kind === 'execution/dropResourcePrepared' &&
            event.detail?.kind === 'terminal' &&
            event.detail?.nodeId === terminalNodeId &&
            event.detail?.source === 'resourceUrls'
        ),
      10000
    );

    const relativeLinkPath = path.relative(workspaceFolder.uri.fsPath, linkTargetPath).split(path.sep).join('/');
    const fileLinkText = `${relativeLinkPath}:2:8`;

    await performWebviewDomAction(
      {
        kind: 'sendExecutionInput',
        nodeId: terminalNodeId,
        data: `printf '%s\\n' '${fileLinkText}'\r`
      },
      'editor',
      10000
    );
    snapshot = await waitForSnapshot((currentSnapshot) => {
      const currentTerminal = currentSnapshot.state.nodes.find((node) => node.id === terminalNodeId);
      return Boolean(currentTerminal?.metadata?.terminal?.recentOutput?.includes(fileLinkText));
    }, 20000);
    terminalNode = findNodeById(snapshot, terminalNodeId);
    assert.ok(terminalNode.metadata.terminal.recentOutput.includes(fileLinkText));

    await clearDiagnosticEvents();
    await performWebviewDomAction(
      {
        kind: 'activateExecutionLink',
        nodeId: terminalNodeId,
        text: fileLinkText
      },
      'editor',
      10000
    );

    await waitForDiagnosticEvents(
      (events) =>
        events.some(
          (event) =>
            event.kind === 'execution/linkOpened' &&
            event.detail?.kind === 'terminal' &&
            event.detail?.nodeId === terminalNodeId &&
            event.detail?.text === fileLinkText
        ),
      10000
    );

    const activeEditor = await waitForActiveEditor(
      () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.uri.fsPath !== linkTargetPath) {
          return false;
        }

        return editor.selection.active.line === 1 && editor.selection.active.character === 7;
      },
      10000
    );
    assert.strictEqual(activeEditor.document.uri.fsPath, linkTargetPath);
    assert.strictEqual(activeEditor.selection.active.line, 1);
    assert.strictEqual(activeEditor.selection.active.character, 7);

    await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInEditor);
    await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'editor', 20000);

    const cwdScopedFileLinkText = 'link-target.ts:3:1';
    await performWebviewDomAction(
      {
        kind: 'sendExecutionInput',
        nodeId: terminalNodeId,
        data: `cd ${JSON.stringify(scratchDir)}\r`
      },
      'editor',
      10000
    );
    await performWebviewDomAction(
      {
        kind: 'sendExecutionInput',
        nodeId: terminalNodeId,
        data: `printf '%s\\n' '${cwdScopedFileLinkText}'\r`
      },
      'editor',
      10000
    );
    snapshot = await waitForSnapshot((currentSnapshot) => {
      const currentTerminal = currentSnapshot.state.nodes.find((node) => node.id === terminalNodeId);
      return Boolean(currentTerminal?.metadata?.terminal?.recentOutput?.includes(cwdScopedFileLinkText));
    }, 20000);
    terminalNode = findNodeById(snapshot, terminalNodeId);
    assert.ok(terminalNode.metadata.terminal.recentOutput.includes(cwdScopedFileLinkText));

    await clearDiagnosticEvents();
    await performWebviewDomAction(
      {
        kind: 'activateExecutionLink',
        nodeId: terminalNodeId,
        text: cwdScopedFileLinkText
      },
      'editor',
      10000
    );
    await waitForDiagnosticEvents(
      (events) =>
        events.some(
          (event) =>
            event.kind === 'execution/linkOpened' &&
            event.detail?.kind === 'terminal' &&
            event.detail?.nodeId === terminalNodeId &&
            event.detail?.text === cwdScopedFileLinkText
        ),
      10000
    );
    const cwdScopedEditor = await waitForActiveEditor(
      () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.uri.fsPath !== linkTargetPath) {
          return false;
        }

        return editor.selection.active.line === 2 && editor.selection.active.character === 0;
      },
      10000
    );
    assert.strictEqual(cwdScopedEditor.document.uri.fsPath, linkTargetPath);
    assert.strictEqual(cwdScopedEditor.selection.active.line, 2);
    assert.strictEqual(cwdScopedEditor.selection.active.character, 0);

    await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInEditor);
    await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'editor', 20000);

    const multilinePathLineText = 'link-target.ts';
    const multilineLinkText = '2:8';
    const multilineResultLine = `  ${multilineLinkText}  export const two = 2;`;
    await performWebviewDomAction(
      {
        kind: 'sendExecutionInput',
        nodeId: terminalNodeId,
        data: `printf '%s\\n%s\\n' '${multilinePathLineText}' '${multilineResultLine}'\r`
      },
      'editor',
      10000
    );
    snapshot = await waitForSnapshot((currentSnapshot) => {
      const currentTerminal = currentSnapshot.state.nodes.find((node) => node.id === terminalNodeId);
      return Boolean(currentTerminal?.metadata?.terminal?.recentOutput?.includes(multilineResultLine));
    }, 20000);
    terminalNode = findNodeById(snapshot, terminalNodeId);
    assert.ok(terminalNode.metadata.terminal.recentOutput.includes(multilineResultLine));

    await clearDiagnosticEvents();
    await performWebviewDomAction(
      {
        kind: 'activateExecutionLink',
        nodeId: terminalNodeId,
        text: multilineLinkText
      },
      'editor',
      10000
    );
    await waitForDiagnosticEvents(
      (events) =>
        events.some(
          (event) =>
            event.kind === 'execution/linkOpened' &&
            event.detail?.kind === 'terminal' &&
            event.detail?.nodeId === terminalNodeId &&
            event.detail?.text === multilineLinkText &&
            event.detail?.linkKind === 'file'
        ),
      10000
    );
    const multilineEditor = await waitForActiveEditor(
      () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.uri.fsPath !== linkTargetPath) {
          return false;
        }

        return editor.selection.active.line === 1 && editor.selection.active.character === 7;
      },
      10000
    );
    assert.strictEqual(multilineEditor.document.uri.fsPath, linkTargetPath);
    assert.strictEqual(multilineEditor.selection.active.line, 1);
    assert.strictEqual(multilineEditor.selection.active.character, 7);

    await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInEditor);
    await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'editor', 20000);

    const missingSearchLinkText = 'missing-target.ts:9:3';
    await performWebviewDomAction(
      {
        kind: 'sendExecutionInput',
        nodeId: terminalNodeId,
        data: `printf '%s\\n' '${missingSearchLinkText}'\r`
      },
      'editor',
      10000
    );
    snapshot = await waitForSnapshot((currentSnapshot) => {
      const currentTerminal = currentSnapshot.state.nodes.find((node) => node.id === terminalNodeId);
      return Boolean(currentTerminal?.metadata?.terminal?.recentOutput?.includes(missingSearchLinkText));
    }, 20000);
    terminalNode = findNodeById(snapshot, terminalNodeId);
    assert.ok(terminalNode.metadata.terminal.recentOutput.includes(missingSearchLinkText));

    await clearDiagnosticEvents();
    await performWebviewDomAction(
      {
        kind: 'activateExecutionLink',
        nodeId: terminalNodeId,
        text: missingSearchLinkText
      },
      'editor',
      10000
    );
    await waitForDiagnosticEvents(
      (events) =>
        events.some(
          (event) =>
            event.kind === 'execution/linkOpened' &&
            event.detail?.kind === 'terminal' &&
            event.detail?.nodeId === terminalNodeId &&
            event.detail?.text === missingSearchLinkText &&
            event.detail?.linkKind === 'search' &&
            event.detail?.openerKind === 'workbench.action.quickOpen'
        ),
      10000
    );
    await vscode.commands.executeCommand('workbench.action.closeQuickOpen');
    await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInEditor);
    await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'editor', 20000);

    browserSmokeServer = await createLocalBrowserSmokeServer(`Dev Session Canvas URL Smoke ${Date.now()}`);
    await setWorkbenchBrowserOpenLocalhostLinks(true);

    const urlLinkText = browserSmokeServer.url;
    const expectedUrlTooltip = `Follow link (${describeExpectedExecutionLinkModifier()})`;

    await performWebviewDomAction(
      {
        kind: 'sendExecutionInput',
        nodeId: terminalNodeId,
        data: `printf '%s\\n' '${urlLinkText}'\r`
      },
      'editor',
      10000
    );
    snapshot = await waitForSnapshot((currentSnapshot) => {
      const currentTerminal = currentSnapshot.state.nodes.find((node) => node.id === terminalNodeId);
      return Boolean(currentTerminal?.metadata?.terminal?.recentOutput?.includes(urlLinkText));
    }, 20000);
    terminalNode = findNodeById(snapshot, terminalNodeId);
    assert.ok(terminalNode.metadata.terminal.recentOutput.includes(urlLinkText));

    await performWebviewDomAction(
      {
        kind: 'hoverExecutionLink',
        nodeId: terminalNodeId,
        text: urlLinkText
      },
      'editor',
      10000
    );
    const hoverProbe = await waitForWebviewProbe(
      (probe) => probe.executionLinkTooltipText === expectedUrlTooltip,
      10000
    );
    assert.strictEqual(hoverProbe.executionLinkTooltipText, expectedUrlTooltip);

    await performWebviewDomAction(
      {
        kind: 'clearExecutionLinkHover',
        nodeId: terminalNodeId
      },
      'editor',
      10000
    );
    const clearedHoverProbe = await waitForWebviewProbe((probe) => probe.executionLinkTooltipText === null, 10000);
    assert.strictEqual(clearedHoverProbe.executionLinkTooltipText, null);

    await clearDiagnosticEvents();
    await performWebviewDomAction(
      {
        kind: 'activateExecutionLink',
        nodeId: terminalNodeId,
        text: urlLinkText
      },
      'editor',
      10000
    );

    await waitForDiagnosticEvents(
      (events) =>
        events.some(
          (event) =>
            event.kind === 'execution/linkOpened' &&
            event.detail?.kind === 'terminal' &&
            event.detail?.nodeId === terminalNodeId &&
            event.detail?.text === urlLinkText &&
            event.detail?.linkKind === 'url' &&
            event.detail?.openerKind === 'simpleBrowser.api.open' &&
            isExpectedPreviewTargetUri(event.detail?.targetUri, urlLinkText)
        ),
      10000
    );

    await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInEditor);
    await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'editor', 20000);

    const explicitUrlLinkText = browserSmokeServer.url.replace('/hit', '/explicit');
    await performWebviewDomAction(
      {
        kind: 'sendExecutionInput',
        nodeId: terminalNodeId,
        data: `printf '\\033]8;;%s\\a%s\\033]8;;\\a\\n' '${explicitUrlLinkText}' 'explicit-url'\r`
      },
      'editor',
      10000
    );
    snapshot = await waitForSnapshot((currentSnapshot) => {
      const currentTerminal = currentSnapshot.state.nodes.find((node) => node.id === terminalNodeId);
      return Boolean(currentTerminal?.metadata?.terminal?.recentOutput?.includes('explicit-url'));
    }, 20000);
    terminalNode = findNodeById(snapshot, terminalNodeId);
    assert.ok(terminalNode.metadata.terminal.recentOutput.includes('explicit-url'));

    await clearDiagnosticEvents();
    await performWebviewDomAction(
      {
        kind: 'activateExecutionLink',
        nodeId: terminalNodeId,
        text: explicitUrlLinkText
      },
      'editor',
      10000
    );
    await waitForDiagnosticEvents(
      (events) =>
        events.some(
          (event) =>
            event.kind === 'execution/linkOpened' &&
            event.detail?.kind === 'terminal' &&
            event.detail?.nodeId === terminalNodeId &&
            event.detail?.text === explicitUrlLinkText &&
            event.detail?.linkKind === 'url' &&
            event.detail?.openerKind === 'simpleBrowser.api.open' &&
            isExpectedPreviewTargetUri(event.detail?.targetUri, explicitUrlLinkText)
        ),
      10000
    );
  } finally {
    await Promise.resolve()
      .then(() =>
        performWebviewDomAction(
          {
            kind: 'clearExecutionLinkHover',
            nodeId: terminalNodeId
          },
          'editor',
          3000
        )
      )
      .catch(() => {});
    if (browserSmokeServer) {
      await browserSmokeServer.close();
    }
    await setWorkbenchBrowserOpenLocalhostLinks(originalOpenLocalhostLinks);
    await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInEditor);
    await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'editor', 20000);
  }
}

async function verifyRuntimeReloadPreservesConfiguredTerminalScrollbackHistory(terminalNodeId) {
  const terminalConfiguration = vscode.workspace.getConfiguration('terminal.integrated');
  const originalScrollback = terminalConfiguration.get('scrollback', 1000);
  const initialScrollback = originalScrollback === 80 ? 60 : 80;
  const configuredScrollback = originalScrollback === 240 ? 320 : 240;

  await clearHostMessages();
  await setTerminalIntegratedScrollback(initialScrollback);

  try {
    await waitForHostMessages(
      (messages) =>
        messages.some(
          (message) =>
            message.type === 'host/stateUpdated' &&
            message.payload.runtime?.terminalScrollback === initialScrollback
        ),
      20000
    );

    await ensureTerminalStopped(terminalNodeId);
    await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInEditor);
    await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'editor', 20000);

    await dispatchWebviewMessage(
      {
        type: 'webview/startExecutionSession',
        payload: {
          nodeId: terminalNodeId,
          kind: 'terminal',
          cols: 92,
          rows: 28
        }
      },
      'editor'
    );
    await waitForTerminalLive(terminalNodeId);

    await clearHostMessages();
    await setTerminalIntegratedScrollback(configuredScrollback);
    await waitForHostMessages(
      (messages) =>
        messages.some(
          (message) =>
            message.type === 'host/stateUpdated' &&
            message.payload.runtime?.terminalScrollback === configuredScrollback
        ),
      20000
    );

    await dispatchWebviewMessage(
      {
        type: 'webview/executionInput',
        payload: {
          nodeId: terminalNodeId,
          kind: 'terminal',
          // Keep each line shorter than the embedded terminal width used by
          // the smoke harness so scrollback assertions do not become wrap-dependent.
          data:
            'i=1; while [ $i -le 220 ]; do printf \'' +
            `${TERMINAL_SCROLLBACK_PERSIST_MARKER}-%03d\\r\\n` +
            '\' "$i"; i=$((i+1)); done\r'
        }
      },
      'editor'
    );

    await waitForSnapshot((currentSnapshot) => {
      const currentNode = currentSnapshot.state.nodes.find((node) => node.id === terminalNodeId);
      return Boolean(
        currentNode?.metadata?.terminal?.recentOutput?.includes(`${TERMINAL_SCROLLBACK_PERSIST_MARKER}-220`)
      );
    }, 20000);

    const reloadedSnapshot = await simulateRuntimeReload();
    const reloadedTerminal = findNodeById(reloadedSnapshot, terminalNodeId);
    const serializedData = reloadedTerminal.metadata.terminal.serializedTerminalState?.data ?? '';
    assert.ok(
      serializedData.includes(`${TERMINAL_SCROLLBACK_PERSIST_MARKER}-001`),
      'Persisted serialized terminal state should keep the earliest configured scrollback line.'
    );
    assert.ok(
      serializedData.includes(`${TERMINAL_SCROLLBACK_PERSIST_MARKER}-220`),
      'Persisted serialized terminal state should keep the latest configured scrollback line.'
    );

    await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'editor', 20000);
    await clearHostMessages();
    await requestExecutionSnapshot('terminal', terminalNodeId, 'editor');

    const hostMessages = await waitForHostMessages(
      (messages) =>
        messages.some(
          (message) =>
            message.type === 'host/executionSnapshot' &&
            message.payload.kind === 'terminal' &&
            message.payload.nodeId === terminalNodeId &&
            typeof message.payload.serializedTerminalState?.data === 'string' &&
            message.payload.serializedTerminalState.data.includes(`${TERMINAL_SCROLLBACK_PERSIST_MARKER}-001`) &&
            message.payload.serializedTerminalState.data.includes(`${TERMINAL_SCROLLBACK_PERSIST_MARKER}-220`)
        ),
      10000
    );
    assert.ok(
      hostMessages.some(
        (message) =>
          message.type === 'host/executionSnapshot' &&
          message.payload.kind === 'terminal' &&
          message.payload.nodeId === terminalNodeId &&
          typeof message.payload.serializedTerminalState?.data === 'string' &&
          message.payload.serializedTerminalState.data.includes(`${TERMINAL_SCROLLBACK_PERSIST_MARKER}-001`) &&
          message.payload.serializedTerminalState.data.includes(`${TERMINAL_SCROLLBACK_PERSIST_MARKER}-220`)
      ),
      'Expected reload-time execution snapshot to retain the configured terminal scrollback history.'
    );
  } finally {
    await clearHostMessages();
    await setTerminalIntegratedScrollback(originalScrollback);
    await waitForHostMessages(
      (messages) =>
        messages.some(
          (message) =>
            message.type === 'host/stateUpdated' &&
            message.payload.runtime?.terminalScrollback === originalScrollback
        ),
      20000
    );
  }
}

async function verifyPanelTerminalTabSwitchPreservesViewport(terminalNodeId) {
  await clearHostMessages();
  await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInPanel);
  await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'panel', 20000);

  await dispatchWebviewMessage(
    {
      type: 'webview/startExecutionSession',
      payload: {
        nodeId: terminalNodeId,
        kind: 'terminal',
        cols: 92,
        rows: 28
      }
    },
    'panel'
  );
  let snapshot = await waitForTerminalLive(terminalNodeId);
  assert.strictEqual(findNodeById(snapshot, terminalNodeId).metadata.terminal.liveSession, true);

  await dispatchWebviewMessage(
    {
      type: 'webview/executionInput',
      payload: {
        nodeId: terminalNodeId,
        kind: 'terminal',
        data:
          "printf '\\033[?1049h\\033[2J\\033[H'; " +
          "i=1; while [ $i -le 18 ]; do printf '" +
          `${PANEL_TAB_SWITCH_TERMINAL_MARKER}-%02d viewport restore verification\\r\\n` +
          "' \"$i\"; i=$((i+1)); done\r"
      }
    },
    'panel'
  );

  const baselineProbe = await waitForWebviewProbeOnSurface('panel', (currentProbe) => {
    const visibleLines = readProbeTerminalVisibleLines(currentProbe, terminalNodeId);
    return visibleLines.some((line) => line.includes(`${PANEL_TAB_SWITCH_TERMINAL_MARKER}-01`));
  }, 10000);
  const baselineVisibleLines = readProbeTerminalVisibleLines(baselineProbe, terminalNodeId);
  assert.ok(baselineVisibleLines.some((line) => line.includes(`${PANEL_TAB_SWITCH_TERMINAL_MARKER}-01`)));
  assert.ok(baselineVisibleLines.some((line) => line.includes(`${PANEL_TAB_SWITCH_TERMINAL_MARKER}-18`)));

  await clearHostMessages();
  const diagnosticStartIndex = (await getDiagnosticEvents()).length;
  await vscode.commands.executeCommand('workbench.action.terminal.new');
  await waitForDiagnosticEvents(
    (events) =>
      events.slice(diagnosticStartIndex).some(
        (event) =>
          event.kind === 'surface/visibilityChanged' &&
          event.detail?.surface === 'panel' &&
          event.detail?.visible === false
      ),
    10000
  );

  await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInPanel);
  await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'panel', 20000);
  await waitForDiagnosticEvents(
    (events) =>
      events.slice(diagnosticStartIndex).some(
        (event) =>
          event.kind === 'surface/visibilityChanged' &&
          event.detail?.surface === 'panel' &&
          event.detail?.visible === true
      ),
    10000
  );

  const hostMessages = await waitForHostMessages(
    (messages) => messages.some((message) => message.type === 'host/visibilityRestored'),
    5000
  );
  assert.ok(hostMessages.some((message) => message.type === 'host/visibilityRestored'));

  const restoredProbe = await waitForWebviewProbeOnSurface('panel', (currentProbe) => {
    const visibleLines = readProbeTerminalVisibleLines(currentProbe, terminalNodeId);
    return visibleLines.some((line) => line.includes(`${PANEL_TAB_SWITCH_TERMINAL_MARKER}-01`));
  }, 10000);
  const restoredVisibleLines = readProbeTerminalVisibleLines(restoredProbe, terminalNodeId);
  assert.deepStrictEqual(restoredVisibleLines, baselineVisibleLines);

  snapshot = await waitForSnapshot((currentSnapshot) => {
    const terminalNode = currentSnapshot.state.nodes.find((node) => node.id === terminalNodeId);
    return Boolean(terminalNode?.metadata?.terminal?.liveSession && terminalNode.status === 'live');
  }, 5000);
  assert.strictEqual(findNodeById(snapshot, terminalNodeId).metadata.terminal.liveSession, true);
}

async function verifyEditorTerminalTabSwitchPreservesViewport(terminalNodeId) {
  await clearHostMessages();
  await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInEditor);
  await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'editor', 20000);

  await dispatchWebviewMessage(
    {
      type: 'webview/startExecutionSession',
      payload: {
        nodeId: terminalNodeId,
        kind: 'terminal',
        cols: 92,
        rows: 28
      }
    },
    'editor'
  );
  let snapshot = await waitForTerminalLive(terminalNodeId);
  assert.strictEqual(findNodeById(snapshot, terminalNodeId).metadata.terminal.liveSession, true);

  await dispatchWebviewMessage(
    {
      type: 'webview/executionInput',
      payload: {
        nodeId: terminalNodeId,
        kind: 'terminal',
        data:
          "printf '\\033[?1049h\\033[2J\\033[H'; " +
          "i=1; while [ $i -le 18 ]; do printf '" +
          `${EDITOR_TAB_SWITCH_TERMINAL_MARKER}-%02d viewport restore verification\\r\\n` +
          "' \"$i\"; i=$((i+1)); done\r"
      }
    },
    'editor'
  );

  const baselineProbe = await waitForWebviewProbeOnSurface('editor', (currentProbe) => {
    const visibleLines = readProbeTerminalVisibleLines(currentProbe, terminalNodeId);
    return visibleLines.some((line) => line.includes(`${EDITOR_TAB_SWITCH_TERMINAL_MARKER}-01`));
  }, 10000);
  const baselineVisibleLines = readProbeTerminalVisibleLines(baselineProbe, terminalNodeId);
  assert.ok(baselineVisibleLines.some((line) => line.includes(`${EDITOR_TAB_SWITCH_TERMINAL_MARKER}-01`)));
  assert.ok(baselineVisibleLines.some((line) => line.includes(`${EDITOR_TAB_SWITCH_TERMINAL_MARKER}-18`)));

  await clearHostMessages();
  const diagnosticStartIndex = (await getDiagnosticEvents()).length;
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(workspaceFolder, 'Smoke workspace is missing a workspace folder.');
  const packageJsonUri = vscode.Uri.joinPath(workspaceFolder.uri, 'package.json');
  const packageJsonDocument = await vscode.workspace.openTextDocument(packageJsonUri);
  await vscode.window.showTextDocument(packageJsonDocument, {
    preview: false,
    viewColumn: vscode.ViewColumn.One
  });
  assert.strictEqual(vscode.window.activeTextEditor?.document.uri.toString(), packageJsonUri.toString());
  await waitForDiagnosticEvents(
    (events) =>
      events.slice(diagnosticStartIndex).some(
        (event) =>
          event.kind === 'surface/visibilityChanged' &&
          event.detail?.surface === 'editor' &&
          event.detail?.visible === false
      ),
    10000
  );

  await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInEditor);
  await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'editor', 20000);
  await waitForDiagnosticEvents(
    (events) =>
      events.slice(diagnosticStartIndex).some(
        (event) =>
          event.kind === 'surface/visibilityChanged' &&
          event.detail?.surface === 'editor' &&
          event.detail?.visible === true
      ),
    10000
  );

  const hostMessages = await waitForHostMessages(
    (messages) => messages.some((message) => message.type === 'host/visibilityRestored'),
    5000
  );
  assert.ok(hostMessages.some((message) => message.type === 'host/visibilityRestored'));

  const restoredProbe = await waitForWebviewProbeOnSurface('editor', (currentProbe) => {
    const visibleLines = readProbeTerminalVisibleLines(currentProbe, terminalNodeId);
    return visibleLines.some((line) => line.includes(`${EDITOR_TAB_SWITCH_TERMINAL_MARKER}-01`));
  }, 10000);
  const restoredVisibleLines = readProbeTerminalVisibleLines(restoredProbe, terminalNodeId);
  assert.deepStrictEqual(restoredVisibleLines, baselineVisibleLines);

  snapshot = await waitForSnapshot((currentSnapshot) => {
    const terminalNode = currentSnapshot.state.nodes.find((node) => node.id === terminalNodeId);
    return Boolean(terminalNode?.metadata?.terminal?.liveSession && terminalNode.status === 'live');
  }, 5000);
  assert.strictEqual(findNodeById(snapshot, terminalNodeId).metadata.terminal.liveSession, true);
}

async function verifyRuntimeReloadRecovery(agentNodeId, terminalNodeId) {
  await clearHostMessages();

  await ensureAgentStopped(agentNodeId);
  await ensureTerminalStopped(terminalNodeId);

  await dispatchWebviewMessage({
    type: 'webview/startExecutionSession',
    payload: {
      nodeId: agentNodeId,
      kind: 'agent',
      cols: 90,
      rows: 28,
      provider: 'codex'
    }
  });
  await dispatchWebviewMessage({
    type: 'webview/startExecutionSession',
    payload: {
      nodeId: terminalNodeId,
      kind: 'terminal',
      cols: 90,
      rows: 28
    }
  });

  await waitForAgentLive(agentNodeId);
  await waitForTerminalLive(terminalNodeId);

  let snapshot = await simulateRuntimeReload();
  let agentNode = findNodeById(snapshot, agentNodeId);
  let terminalNode = findNodeById(snapshot, terminalNodeId);

  assert.strictEqual(agentNode.status, 'resume-ready');
  assert.strictEqual(agentNode.metadata.agent.pendingLaunch, 'resume');
  assert.strictEqual(terminalNode.status, 'interrupted');
  assert.strictEqual(terminalNode.metadata.terminal.liveSession, false);

  snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentAgent = currentSnapshot.state.nodes.find((node) => node.id === agentNodeId);
    return Boolean(
      currentAgent?.metadata?.agent?.liveSession && currentAgent.status === 'resuming'
    );
  }, 20000);

  await dispatchWebviewMessage({
    type: 'webview/executionInput',
    payload: {
      nodeId: agentNodeId,
      kind: 'agent',
      data: 'burst 1\r'
    }
  });

  snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentAgent = currentSnapshot.state.nodes.find((node) => node.id === agentNodeId);
    return Boolean(currentAgent?.metadata?.agent?.liveSession && currentAgent.status === 'running');
  }, 20000);

  agentNode = findNodeById(snapshot, agentNodeId);
  assert.strictEqual(agentNode.status, 'running');

  snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentAgent = currentSnapshot.state.nodes.find((node) => node.id === agentNodeId);
    return Boolean(
      currentAgent?.metadata?.agent?.liveSession &&
        currentAgent.status === 'waiting-input' &&
        currentAgent.metadata?.agent?.recentOutput?.includes('[fake-agent] resumed session') &&
        currentAgent.metadata?.agent?.recentOutput?.includes('[fake-agent] burst 001')
    );
  }, 20000);

  agentNode = findNodeById(snapshot, agentNodeId);
  assert.strictEqual(agentNode.status, 'waiting-input');
  assert.ok(agentNode.metadata.agent.recentOutput.includes('[fake-agent] resumed session'));
  assert.ok(agentNode.metadata.agent.recentOutput.includes('[fake-agent] burst 001'));

  await dispatchWebviewMessage({
    type: 'webview/executionInput',
    payload: {
      nodeId: agentNodeId,
      kind: 'agent',
      data: 'exit 19\r'
    }
  });

  snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentAgent = currentSnapshot.state.nodes.find((node) => node.id === agentNodeId);
    return Boolean(
      currentAgent &&
        !currentAgent.metadata?.agent?.liveSession &&
        (currentAgent.status === 'error' || currentAgent.status === 'resume-failed')
    );
  });

  agentNode = findNodeById(snapshot, agentNodeId);
  assert.strictEqual(agentNode.status, 'error');
  assert.strictEqual(agentNode.metadata.agent.lastExitCode, 19);
  assert.match(agentNode.summary, /exit(?:ed with code| code) 19/);

  await dispatchWebviewMessage({
    type: 'webview/startExecutionSession',
    payload: {
      nodeId: terminalNodeId,
      kind: 'terminal',
      cols: 90,
      rows: 28
    }
  });
  await waitForTerminalLive(terminalNodeId);
}

async function verifyLiveSessionCutoverAndReload(terminalNodeId) {
  const editorMarker = 'LIVE_CUTOVER_EDITOR';
  const panelMarker = 'LIVE_CUTOVER_PANEL';
  const reloadMarker = 'LIVE_CUTOVER_RELOAD';
  const returnMarker = 'LIVE_CUTOVER_RETURN';

  await clearHostMessages();
  await dispatchWebviewMessage({
    type: 'webview/startExecutionSession',
    payload: {
      nodeId: terminalNodeId,
      kind: 'terminal',
      cols: 96,
      rows: 28
    }
  });

  await waitForSnapshot((currentSnapshot) => {
    const currentNode = currentSnapshot.state.nodes.find((node) => node.id === terminalNodeId);
    return Boolean(currentNode?.metadata?.terminal?.liveSession && currentNode.status === 'live');
  });

  await dispatchWebviewMessage({
    type: 'webview/executionInput',
    payload: {
      nodeId: terminalNodeId,
      kind: 'terminal',
      data: `echo ${editorMarker}\r`
    }
  });
  await waitForSnapshot((currentSnapshot) => {
    const currentNode = currentSnapshot.state.nodes.find((node) => node.id === terminalNodeId);
    return Boolean(currentNode?.metadata?.terminal?.recentOutput?.includes(editorMarker));
  });

  await clearHostMessages();
  await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInPanel);
  await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'panel', 20000);

  let snapshot = await getDebugSnapshot();
  assert.strictEqual(snapshot.activeSurface, 'panel');
  assert.strictEqual(snapshot.surfaceReady.panel, true);

  await waitForHostMessages((messages) =>
    messages.some(
      (message) =>
        message.type === 'host/executionSnapshot' &&
        message.payload.kind === 'terminal' &&
        message.payload.nodeId === terminalNodeId &&
        message.payload.liveSession === true
    )
  );

  await dispatchWebviewMessage(
    {
      type: 'webview/executionInput',
      payload: {
        nodeId: terminalNodeId,
        kind: 'terminal',
        data: `echo ${panelMarker}\r`
      }
    },
    'panel'
  );
  await waitForSnapshot((currentSnapshot) => {
    const currentNode = currentSnapshot.state.nodes.find((node) => node.id === terminalNodeId);
    return Boolean(currentNode?.metadata?.terminal?.recentOutput?.includes(panelMarker));
  });

  snapshot = await reloadPersistedState();
  assert.strictEqual(snapshot.activeSurface, 'panel');
  assert.strictEqual(findNodeById(snapshot, terminalNodeId).metadata.terminal.liveSession, true);
  assert.strictEqual(findNodeById(snapshot, terminalNodeId).status, 'live');

  await dispatchWebviewMessage(
    {
      type: 'webview/executionInput',
      payload: {
        nodeId: terminalNodeId,
        kind: 'terminal',
        data: `echo ${reloadMarker}\r`
      }
    },
    'panel'
  );
  await waitForSnapshot((currentSnapshot) => {
    const currentNode = currentSnapshot.state.nodes.find((node) => node.id === terminalNodeId);
    return Boolean(currentNode?.metadata?.terminal?.recentOutput?.includes(reloadMarker));
  });

  await clearHostMessages();
  await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInEditor);
  await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'editor', 20000);

  await waitForHostMessages((messages) =>
    messages.some(
      (message) =>
        message.type === 'host/executionSnapshot' &&
        message.payload.kind === 'terminal' &&
        message.payload.nodeId === terminalNodeId &&
        message.payload.liveSession === true
    )
  );

  await dispatchWebviewMessage(
    {
      type: 'webview/executionInput',
      payload: {
        nodeId: terminalNodeId,
        kind: 'terminal',
        data: `echo ${returnMarker}\r`
      }
    },
    'editor'
  );
  snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentNode = currentSnapshot.state.nodes.find((node) => node.id === terminalNodeId);
    return Boolean(currentNode?.metadata?.terminal?.recentOutput?.includes(returnMarker));
  });
  assert.strictEqual(findNodeById(snapshot, terminalNodeId).metadata.terminal.liveSession, true);

  await dispatchWebviewMessage({
    type: 'webview/stopExecutionSession',
    payload: {
      nodeId: terminalNodeId,
      kind: 'terminal'
    }
  });
  snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentNode = currentSnapshot.state.nodes.find((node) => node.id === terminalNodeId);
    return Boolean(currentNode && currentNode.status === 'closed' && !currentNode.metadata?.terminal?.liveSession);
  });
  assert.ok(findNodeById(snapshot, terminalNodeId).metadata.terminal.recentOutput.includes(returnMarker));
}

async function verifyPtyRobustness(agentNodeId, terminalNodeId) {
  await clearHostMessages();
  await ensureAgentStopped(agentNodeId);
  await ensureTerminalStopped(terminalNodeId);
  await clearHostMessages();

  await dispatchWebviewMessage({
    type: 'webview/startExecutionSession',
    payload: {
      nodeId: agentNodeId,
      kind: 'agent',
      cols: 90,
      rows: 28,
      provider: 'codex'
    }
  });
  await waitForSnapshot((currentSnapshot) => {
    const currentAgent = currentSnapshot.state.nodes.find((node) => node.id === agentNodeId);
    return Boolean(currentAgent?.metadata?.agent?.liveSession);
  });

  await dispatchWebviewMessage({
    type: 'webview/executionInput',
    payload: {
      nodeId: agentNodeId,
      kind: 'agent',
      data: 'burst 80\r'
    }
  });
  let snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentAgent = currentSnapshot.state.nodes.find((node) => node.id === agentNodeId);
    return Boolean(currentAgent?.metadata?.agent?.recentOutput?.includes('[fake-agent] burst 080'));
  });
  assert.ok(findNodeById(snapshot, agentNodeId).metadata.agent.recentOutput.includes('[fake-agent] burst 080'));

  await dispatchWebviewMessage({
    type: 'webview/executionInput',
    payload: {
      nodeId: agentNodeId,
      kind: 'agent',
      data: 'exit 17\r'
    }
  });
  snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentAgent = currentSnapshot.state.nodes.find((node) => node.id === agentNodeId);
    return Boolean(currentAgent?.status === 'error' && currentAgent.metadata?.agent?.lastExitCode === 17);
  });
  let agentNode = findNodeById(snapshot, agentNodeId);
  assert.strictEqual(agentNode.metadata.agent.lastExitCode, 17);
  assert.match(agentNode.summary, /exit(?:ed with code| code) 17/);

  await dispatchWebviewMessage({
    type: 'webview/startExecutionSession',
    payload: {
      nodeId: agentNodeId,
      kind: 'agent',
      cols: 88,
      rows: 28,
      provider: 'codex'
    }
  });
  await waitForSnapshot((currentSnapshot) => {
    const currentAgent = currentSnapshot.state.nodes.find((node) => node.id === agentNodeId);
    return Boolean(currentAgent?.metadata?.agent?.liveSession);
  });
  await dispatchWebviewMessage({
    type: 'webview/stopExecutionSession',
    payload: {
      nodeId: agentNodeId,
      kind: 'agent'
    }
  });
  await waitForSnapshot((currentSnapshot) => {
    const currentAgent = currentSnapshot.state.nodes.find((node) => node.id === agentNodeId);
    return Boolean(currentAgent?.status === 'stopped' && !currentAgent.metadata?.agent?.liveSession);
  });

  await clearHostMessages();
  await dispatchWebviewMessage({
    type: 'webview/startExecutionSession',
    payload: {
      nodeId: agentNodeId,
      kind: 'agent',
      cols: 92,
      rows: 28,
      provider: 'codex'
    }
  });
  await dispatchWebviewMessage({
    type: 'webview/startExecutionSession',
    payload: {
      nodeId: terminalNodeId,
      kind: 'terminal',
      cols: 92,
      rows: 28
    }
  });
  snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentAgent = currentSnapshot.state.nodes.find((node) => node.id === agentNodeId);
    const currentTerminal = currentSnapshot.state.nodes.find((node) => node.id === terminalNodeId);
    return Boolean(
      currentAgent?.metadata?.agent?.liveSession &&
        currentTerminal?.metadata?.terminal?.liveSession
    );
  });
  agentNode = findNodeById(snapshot, agentNodeId);
  const terminalNode = findNodeById(snapshot, terminalNodeId);
  assert.strictEqual(agentNode.metadata.agent.liveSession, true);
  assert.strictEqual(terminalNode.metadata.terminal.liveSession, true);

  await requestExecutionSnapshot('agent', agentNodeId);
  await requestExecutionSnapshot('terminal', terminalNodeId);
  await dispatchWebviewMessage({
    type: 'webview/executionInput',
    payload: {
      nodeId: agentNodeId,
      kind: 'agent',
      data: 'hello concurrency\r'
    }
  });
  await dispatchWebviewMessage({
    type: 'webview/executionInput',
    payload: {
      nodeId: terminalNodeId,
      kind: 'terminal',
      data: 'echo TERMINAL_CONCURRENCY\r'
    }
  });
  snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentAgent = currentSnapshot.state.nodes.find((node) => node.id === agentNodeId);
    const currentTerminal = currentSnapshot.state.nodes.find((node) => node.id === terminalNodeId);
    return Boolean(
      currentAgent?.metadata?.agent?.recentOutput?.includes('[fake-agent] hello concurrency') &&
        currentTerminal?.metadata?.terminal?.recentOutput?.includes('TERMINAL_CONCURRENCY')
    );
  });
  assert.ok(findNodeById(snapshot, agentNodeId).metadata.agent.recentOutput.includes('[fake-agent] hello concurrency'));
  assert.ok(findNodeById(snapshot, terminalNodeId).metadata.terminal.recentOutput.includes('TERMINAL_CONCURRENCY'));

  await clearHostMessages();
  await requestExecutionSnapshot('agent', agentNodeId);
  await requestExecutionSnapshot('terminal', terminalNodeId);
  const hostMessages = await waitForHostMessages((messages) => {
    const hasAgentSnapshot = messages.some(
      (message) =>
        message.type === 'host/executionSnapshot' &&
        message.payload.nodeId === agentNodeId &&
        message.payload.kind === 'agent' &&
        message.payload.serializedTerminalState?.format === 'xterm-serialize-v1'
    );
    const hasTerminalSnapshot = messages.some(
      (message) =>
        message.type === 'host/executionSnapshot' &&
        message.payload.nodeId === terminalNodeId &&
        message.payload.kind === 'terminal' &&
        message.payload.serializedTerminalState?.format === 'xterm-serialize-v1'
    );
    return hasAgentSnapshot && hasTerminalSnapshot;
  });
  const agentSnapshotMessage = hostMessages.find(
    (message) =>
      message.type === 'host/executionSnapshot' &&
      message.payload.nodeId === agentNodeId &&
      message.payload.kind === 'agent' &&
      message.payload.serializedTerminalState?.format === 'xterm-serialize-v1'
  );
  const terminalSnapshotMessage = hostMessages.find(
    (message) =>
      message.type === 'host/executionSnapshot' &&
      message.payload.nodeId === terminalNodeId &&
      message.payload.kind === 'terminal' &&
      message.payload.serializedTerminalState?.format === 'xterm-serialize-v1'
  );
  assert.ok(agentSnapshotMessage);
  assert.ok(terminalSnapshotMessage);
  assert.strictEqual(agentSnapshotMessage.payload.serializedTerminalState?.format, 'xterm-serialize-v1');
  assert.strictEqual(terminalSnapshotMessage.payload.serializedTerminalState?.format, 'xterm-serialize-v1');

  await dispatchWebviewMessage({
    type: 'webview/stopExecutionSession',
    payload: {
      nodeId: agentNodeId,
      kind: 'agent'
    }
  });
  await dispatchWebviewMessage({
    type: 'webview/stopExecutionSession',
    payload: {
      nodeId: terminalNodeId,
      kind: 'terminal'
    }
  });
  snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentAgent = currentSnapshot.state.nodes.find((node) => node.id === agentNodeId);
    const currentTerminal = currentSnapshot.state.nodes.find((node) => node.id === terminalNodeId);
    return Boolean(
      currentAgent?.status === 'stopped' &&
        !currentAgent.metadata?.agent?.liveSession &&
        currentTerminal?.status === 'closed' &&
        !currentTerminal.metadata?.terminal?.liveSession
    );
  });
  assert.strictEqual(findNodeById(snapshot, agentNodeId).status, 'stopped');
  assert.strictEqual(findNodeById(snapshot, terminalNodeId).status, 'closed');
}

async function verifyTerminalFloodKeepsCanvasResponsive(agentNodeId, terminalNodeId, noteNodeId) {
  await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInEditor);
  await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'editor', 20000);
  await clearHostMessages();
  await ensureAgentStopped(agentNodeId);
  await ensureTerminalStopped(terminalNodeId);
  await clearHostMessages();

  const baselineSnapshot = await getDebugSnapshot();
  const baselineAgentIds = new Set(
    baselineSnapshot.state.nodes.filter((node) => node.kind === 'agent').map((node) => node.id)
  );
  const baselineTerminalIds = new Set(
    baselineSnapshot.state.nodes.filter((node) => node.kind === 'terminal').map((node) => node.id)
  );

  await dispatchWebviewMessage({
    type: 'webview/startExecutionSession',
    payload: {
      nodeId: agentNodeId,
      kind: 'agent',
      cols: 92,
      rows: 28,
      provider: 'codex'
    }
  });
  await dispatchWebviewMessage({
    type: 'webview/startExecutionSession',
    payload: {
      nodeId: terminalNodeId,
      kind: 'terminal',
      cols: 92,
      rows: 28
    }
  });
  await waitForAgentLive(agentNodeId);
  await waitForTerminalLive(terminalNodeId);
  await clearHostMessages();

  await performWebviewDomAction({
    kind: 'sendExecutionInput',
    nodeId: terminalNodeId,
    data: `i=0; while :; do printf '${TERMINAL_FLOOD_OUTPUT_MARKER} %06d\\n' "$i"; i=$((i+1)); done\r`
  });

  await waitForHostMessages(
    (messages) =>
      messages.some(
        (message) =>
          message.type === 'host/executionOutput' &&
          message.payload.kind === 'terminal' &&
          message.payload.nodeId === terminalNodeId &&
          message.payload.chunk.includes(TERMINAL_FLOOD_OUTPUT_MARKER)
      ),
    8000
  );

  await performWebviewDomAction({
    kind: 'selectNode',
    nodeId: noteNodeId
  });
  const noteProbe = await waitForWebviewProbe(
    (currentProbe) =>
      currentProbe.nodes.some((node) => node.nodeId === noteNodeId && node.selected === true),
    8000
  );
  assert.ok(noteProbe.nodes.some((node) => node.nodeId === noteNodeId && node.selected === true));

  await performWebviewDomAction({
    kind: 'sendExecutionInput',
    nodeId: agentNodeId,
    data: 'terminal flood parallel\r'
  });

  let snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentAgent = currentSnapshot.state.nodes.find((node) => node.id === agentNodeId);
    return Boolean(
      currentAgent?.metadata?.agent?.liveSession &&
        currentAgent.metadata?.agent?.recentOutput?.includes(TERMINAL_FLOOD_AGENT_MARKER)
    );
  }, 15000);
  assert.ok(findNodeById(snapshot, agentNodeId).metadata.agent.recentOutput.includes(TERMINAL_FLOOD_AGENT_MARKER));

  await dispatchWebviewMessage({
    type: 'webview/createDemoNode',
    payload: {
      kind: 'terminal',
      preferredPosition: { x: 760, y: 40 }
    }
  });
  snapshot = await waitForSnapshot((currentSnapshot) => {
    const createdTerminal = currentSnapshot.state.nodes.find(
      (node) => node.kind === 'terminal' && !baselineTerminalIds.has(node.id)
    );
    return Boolean(createdTerminal?.metadata?.terminal?.liveSession);
  }, 15000);
  const secondaryTerminalNode = snapshot.state.nodes.find(
    (node) => node.kind === 'terminal' && !baselineTerminalIds.has(node.id)
  );
  assert.ok(secondaryTerminalNode, 'Expected flood scenario to create a second terminal node.');
  const secondaryTerminalNodeId = secondaryTerminalNode.id;

  await performWebviewDomAction({
    kind: 'sendExecutionInput',
    nodeId: secondaryTerminalNodeId,
    data: `i=0; while :; do printf '${TERMINAL_FLOOD_SECONDARY_OUTPUT_MARKER} %06d\\n' "$i"; i=$((i+1)); done\r`
  });
  await waitForHostMessages(
    (messages) =>
      messages.some(
        (message) =>
          message.type === 'host/executionOutput' &&
          message.payload.kind === 'terminal' &&
          message.payload.nodeId === secondaryTerminalNodeId &&
          message.payload.chunk.includes(TERMINAL_FLOOD_SECONDARY_OUTPUT_MARKER)
      ),
    8000
  );

  await dispatchWebviewMessage({
    type: 'webview/createDemoNode',
    payload: {
      kind: 'agent',
      agentProvider: 'codex',
      preferredPosition: { x: 760, y: 320 }
    }
  });
  snapshot = await waitForSnapshot((currentSnapshot) => {
    const createdAgent = currentSnapshot.state.nodes.find(
      (node) => node.kind === 'agent' && !baselineAgentIds.has(node.id)
    );
    return Boolean(createdAgent?.metadata?.agent?.liveSession);
  }, 15000);
  const secondaryAgentNode = snapshot.state.nodes.find(
    (node) => node.kind === 'agent' && !baselineAgentIds.has(node.id)
  );
  assert.ok(secondaryAgentNode, 'Expected flood scenario to create a second agent node.');
  const secondaryAgentNodeId = secondaryAgentNode.id;

  await performWebviewDomAction({
    kind: 'sendExecutionInput',
    nodeId: secondaryAgentNodeId,
    data: 'terminal flood created agent\r'
  });
  snapshot = await waitForSnapshot((currentSnapshot) => {
    const createdAgent = currentSnapshot.state.nodes.find((node) => node.id === secondaryAgentNodeId);
    return Boolean(
      createdAgent?.metadata?.agent?.liveSession &&
        createdAgent.metadata?.agent?.recentOutput?.includes(TERMINAL_FLOOD_NEW_AGENT_MARKER)
    );
  }, 15000);
  assert.ok(
    findNodeById(snapshot, secondaryAgentNodeId).metadata.agent.recentOutput.includes(TERMINAL_FLOOD_NEW_AGENT_MARKER)
  );

  await performWebviewDomAction({
    kind: 'sendExecutionInput',
    nodeId: terminalNodeId,
    data: '\u0003'
  });
  await performWebviewDomAction({
    kind: 'sendExecutionInput',
    nodeId: secondaryTerminalNodeId,
    data: '\u0003'
  });
  await sleep(150);
  await performWebviewDomAction({
    kind: 'sendExecutionInput',
    nodeId: terminalNodeId,
    data: `echo ${TERMINAL_FLOOD_AFTER_CTRL_C_MARKER}\r`
  });
  await performWebviewDomAction({
    kind: 'sendExecutionInput',
    nodeId: secondaryTerminalNodeId,
    data: `echo ${TERMINAL_FLOOD_SECONDARY_AFTER_CTRL_C_MARKER}\r`
  });

  snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentTerminal = currentSnapshot.state.nodes.find((node) => node.id === terminalNodeId);
    const secondaryTerminal = currentSnapshot.state.nodes.find((node) => node.id === secondaryTerminalNodeId);
    return Boolean(
      currentTerminal?.metadata?.terminal?.liveSession &&
        currentTerminal.metadata?.terminal?.recentOutput?.includes(TERMINAL_FLOOD_AFTER_CTRL_C_MARKER) &&
        secondaryTerminal?.metadata?.terminal?.liveSession &&
        secondaryTerminal.metadata?.terminal?.recentOutput?.includes(TERMINAL_FLOOD_SECONDARY_AFTER_CTRL_C_MARKER)
    );
  }, 15000);
  assert.strictEqual(findNodeById(snapshot, terminalNodeId).metadata.terminal.liveSession, true);
  assert.ok(
    findNodeById(snapshot, terminalNodeId).metadata.terminal.recentOutput.includes(
      TERMINAL_FLOOD_AFTER_CTRL_C_MARKER
    )
  );
  assert.strictEqual(findNodeById(snapshot, secondaryTerminalNodeId).metadata.terminal.liveSession, true);
  assert.ok(
    findNodeById(snapshot, secondaryTerminalNodeId).metadata.terminal.recentOutput.includes(
      TERMINAL_FLOOD_SECONDARY_AFTER_CTRL_C_MARKER
    )
  );

  await ensureAgentStopped(agentNodeId);
  await ensureAgentStopped(secondaryAgentNodeId);
  await ensureTerminalStopped(terminalNodeId);
  await ensureTerminalStopped(secondaryTerminalNodeId);

  await dispatchWebviewMessage({
    type: 'webview/deleteNode',
    payload: {
      nodeId: secondaryAgentNodeId
    }
  });
  await dispatchWebviewMessage({
    type: 'webview/deleteNode',
    payload: {
      nodeId: secondaryTerminalNodeId
    }
  });
  await waitForSnapshot(
    (currentSnapshot) =>
      !currentSnapshot.state.nodes.some(
        (node) => node.id === secondaryAgentNodeId || node.id === secondaryTerminalNodeId
      ),
    20000
  );
}

async function verifyFailurePaths(agentNodeId, terminalNodeId, noteNodeId) {
  await clearHostMessages();
  const diagnosticStartIndex = (await getDiagnosticEvents()).length;

  let snapshot = await getDebugSnapshot();
  const baselineAgentIds = new Set(snapshot.state.nodes.filter((node) => node.kind === 'agent').map((node) => node.id));

  await dispatchWebviewMessage({
    type: 'webview/createDemoNode',
    payload: {
      kind: 'agent',
      agentProvider: 'claude'
    }
  });

  snapshot = await waitForSnapshot((currentSnapshot) => {
    return currentSnapshot.state.nodes.some(
      (node) =>
        !baselineAgentIds.has(node.id) &&
        node.kind === 'agent' &&
        node.metadata?.agent?.provider === 'claude' &&
        node.status === 'error'
    );
  });
  const claudeAgentNode = snapshot.state.nodes.find(
    (node) =>
      !baselineAgentIds.has(node.id) &&
      node.kind === 'agent' &&
      node.metadata?.agent?.provider === 'claude' &&
      node.status === 'error'
  );
  assert.ok(claudeAgentNode, 'Expected failure-path setup to create a Claude agent node.');
  let agentNode = findNodeById(snapshot, claudeAgentNode.id);
  assert.ok(
    /Could not find Claude Code command/.test(agentNode.summary) ||
      /Claude Code command was not found/.test(agentNode.summary) ||
      /Claude Code .*No such file or directory/.test(agentNode.summary)
  );
  assert.strictEqual(agentNode.metadata.agent.liveSession, false);

  const failureDiagnostics = (await getDiagnosticEvents()).slice(diagnosticStartIndex);
  assert.ok(
    failureDiagnostics.some(
      (event) =>
        event.kind === 'execution/startRequested' &&
        event.detail?.kind === 'agent' &&
        event.detail?.nodeId === claudeAgentNode.id &&
        event.detail?.provider === 'claude'
    )
  );

  let hostMessages = await getHostMessages();
  assert.ok(
    hostMessages.some(
      (message) =>
        message.type === 'host/error' &&
        (/Could not find Claude Code command/.test(message.payload.message) ||
          /Claude Code command was not found/.test(message.payload.message) ||
          /Claude Code .*No such file or directory/.test(message.payload.message))
    )
  );

  await dispatchWebviewMessage({
    type: 'webview/deleteNode',
    payload: {
      nodeId: claudeAgentNode.id
    }
  });
  snapshot = await waitForSnapshot(
    (currentSnapshot) => !currentSnapshot.state.nodes.some((node) => node.id === claudeAgentNode.id),
    20000
  );
  assert.strictEqual(snapshot.state.nodes.some((node) => node.id === claudeAgentNode.id), false);

  await clearHostMessages();
  const nodeCountBeforeInvalidCreate = snapshot.state.nodes.length;
  await dispatchWebviewMessage({
    type: 'webview/createDemoNode',
    payload: {
      kind: 'agent',
      agentProvider: 'claude',
      agentLaunchPreset: 'custom',
      agentCustomLaunchCommand: INVALID_PROVIDER_LAUNCH_COMMAND
    }
  });

  hostMessages = await getHostMessages();
  assert.ok(
    hostMessages.some(
      (message) =>
        message.type === 'host/error' &&
        message.payload.message === 'Command must start with the current Claude Code command or claude.'
    ),
    'Expected host-side create validation to reject cross-provider custom launch commands.'
  );

  snapshot = await getDebugSnapshot();
  assert.strictEqual(
    snapshot.state.nodes.length,
    nodeCountBeforeInvalidCreate,
    'Rejected create requests must not add an agent node.'
  );

  const stateBeforeInvalidLaunch = snapshot.state;
  const invalidLaunchNodeId = 'agent-invalid-custom-launch';
  const invalidLaunchBaselineNode = findNodeById(snapshot, agentNodeId);
  const invalidLaunchNode = {
    ...invalidLaunchBaselineNode,
    id: invalidLaunchNodeId,
    title: 'Agent Invalid Custom Launch',
    status: 'idle',
    summary: 'No Agent session has been started yet.',
    position: {
      x: invalidLaunchBaselineNode.position.x + 340,
      y: invalidLaunchBaselineNode.position.y + 260
    },
    metadata: {
      agent: {
        ...invalidLaunchBaselineNode.metadata.agent,
        lifecycle: 'idle',
        provider: 'claude',
        launchPreset: 'custom',
        customLaunchCommand: INVALID_PROVIDER_LAUNCH_COMMAND,
        lastLaunchCommandLine: undefined,
        resumeSupported: false,
        resumeStrategy: 'none',
        resumeSessionId: undefined,
        resumeStoragePath: undefined,
        liveSession: false,
        runtimeSessionId: undefined,
        pendingLaunch: undefined,
        recentOutput: undefined,
        lastExitCode: undefined,
        lastExitSignal: undefined,
        lastExitMessage: undefined,
        lastRuntimeError: undefined,
        serializedTerminalState: undefined,
        lastBackendLabel: 'Claude Code'
      }
    }
  };

  snapshot = await setPersistedState({
    ...stateBeforeInvalidLaunch,
    nodes: [...stateBeforeInvalidLaunch.nodes, invalidLaunchNode]
  });
  assert.ok(
    snapshot.state.nodes.some((node) => node.id === invalidLaunchNodeId),
    'Expected seeded persisted state to surface the injected custom Claude node before runtime start validation runs.'
  );

  await clearHostMessages();
  await dispatchWebviewMessage({
    type: 'webview/startExecutionSession',
    payload: {
      nodeId: invalidLaunchNodeId,
      kind: 'agent',
      cols: 84,
      rows: 26,
      provider: 'claude'
    }
  });

  snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentNode = currentSnapshot.state.nodes.find((node) => node.id === invalidLaunchNodeId);
    return Boolean(currentNode?.status === 'error');
  }, 20000);
  let invalidLaunchNodeAfterStart = findNodeById(snapshot, invalidLaunchNodeId);
  assert.strictEqual(invalidLaunchNodeAfterStart.status, 'error');
  assert.strictEqual(
    invalidLaunchNodeAfterStart.summary,
    'Command must start with the current Claude Code command or claude.'
  );
  assert.strictEqual(invalidLaunchNodeAfterStart.metadata.agent.liveSession, false);
  assert.strictEqual(invalidLaunchNodeAfterStart.metadata.agent.pendingLaunch, undefined);

  hostMessages = await getHostMessages();
  assert.ok(
    hostMessages.some(
      (message) =>
        message.type === 'host/error' &&
        message.payload.message === 'Command must start with the current Claude Code command or claude.'
    ),
    'Expected host-side runtime validation to reject the invalid custom launch command restored from seeded persisted state.'
  );

  const invalidLaunchDiagnostics = (await getDiagnosticEvents())
    .slice(diagnosticStartIndex)
    .filter((event) => event.detail?.kind === 'agent' && event.detail?.nodeId === invalidLaunchNodeId);
  assert.ok(
    invalidLaunchDiagnostics.some(
      (event) =>
        event.kind === 'execution/startRejected' &&
        event.detail?.reason === 'invalid-launch-command' &&
        event.detail?.message === 'Command must start with the current Claude Code command or claude.'
    ),
    'Expected invalid custom commands to be rejected before the host resolves or executes them.'
  );

  snapshot = await setPersistedState(stateBeforeInvalidLaunch);
  assert.ok(
    !snapshot.state.nodes.some((node) => node.id === invalidLaunchNodeId),
    'Expected restoring the baseline persisted state to remove the seeded invalid-launch node from runtime projection.'
  );

  await clearHostMessages();
  await dispatchWebviewMessage({
    type: 'webview/startExecutionSession',
    payload: {
      nodeId: 'agent-missing',
      kind: 'agent',
      cols: 80,
      rows: 24,
      provider: 'codex'
    }
  });
  await dispatchWebviewMessage({
    type: 'webview/startExecutionSession',
    payload: {
      nodeId: 'terminal-missing',
      kind: 'terminal',
      cols: 80,
      rows: 24
    }
  });
  await dispatchWebviewMessage({
    type: 'webview/deleteNode',
    payload: {
      nodeId: 'note-missing'
    }
  });

  hostMessages = await getHostMessages();
  assert.ok(
    hostMessages.some(
      (message) =>
        message.type === 'host/error' &&
        message.payload.message === 'No launchable Agent node was found.'
    )
  );
  assert.ok(
    hostMessages.some(
      (message) =>
        message.type === 'host/error' &&
        message.payload.message === 'No launchable Terminal node was found.'
    )
  );
  assert.ok(
    hostMessages.some(
      (message) =>
        message.type === 'host/error' &&
        message.payload.message === 'No deletable node was found.'
    )
  );

  snapshot = await getDebugSnapshot();
  assert.strictEqual(findNodeById(snapshot, agentNodeId).title, REAL_DOM_AGENT_TITLE);
  assert.strictEqual(findNodeById(snapshot, terminalNodeId).title, REAL_DOM_TERMINAL_TITLE);
  assert.strictEqual(findNodeById(snapshot, noteNodeId).title, REAL_DOM_NOTE_TITLE);
  assert.strictEqual(findNodeById(snapshot, noteNodeId).metadata.note.content, REAL_DOM_NOTE_BODY);
  assert.strictEqual(findNodeById(snapshot, terminalNodeId).status, 'closed');
}

async function verifyEmbeddedTerminalThemeFollowWorkbench(agentNodeId, terminalNodeId) {
  const workbenchConfiguration = vscode.workspace.getConfiguration('workbench');
  const originalColorTheme = workbenchConfiguration.inspect('colorTheme')?.globalValue;

  try {
    await verifyEmbeddedTerminalThemeOnSurface('panel', agentNodeId, terminalNodeId);
    await verifyEmbeddedTerminalThemeOnSurface('editor', agentNodeId, terminalNodeId);
  } finally {
    await setWorkbenchColorTheme(originalColorTheme);
    await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInEditor);
    await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'editor', 20000);
  }
}

async function verifyEmbeddedTerminalThemeOnSurface(surface, agentNodeId, terminalNodeId) {
  if (surface === 'panel') {
    await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInPanel);
  } else {
    await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInEditor);
  }
  await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, surface, 20000);

  const expectationsByTheme = BUILTIN_WORKBENCH_TERMINAL_THEME_EXPECTATIONS[surface];
  for (const [themeName, expectedTheme] of Object.entries(expectationsByTheme)) {
    await setWorkbenchColorTheme(themeName);

    const probe = await waitForWebviewProbeOnSurface(surface, (currentProbe) => {
      const agentNode = currentProbe.nodes.find((node) => node.nodeId === agentNodeId);
      const terminalNode = currentProbe.nodes.find((node) => node.nodeId === terminalNodeId);

      return (
        terminalThemeMatches(agentNode?.terminalTheme, expectedTheme) &&
        terminalThemeMatches(terminalNode?.terminalTheme, expectedTheme)
      );
    }, 15000);

    const agentTheme = probe.nodes.find((node) => node.nodeId === agentNodeId)?.terminalTheme;
    const terminalTheme = probe.nodes.find((node) => node.nodeId === terminalNodeId)?.terminalTheme;
    assertTerminalThemeMatches(agentTheme, expectedTheme, `${surface}/${themeName}/agent`);
    assertTerminalThemeMatches(terminalTheme, expectedTheme, `${surface}/${themeName}/terminal`);
  }
}

async function verifyPersistenceAndRecovery(noteNodeId, agentNodeId, terminalNodeId) {
  await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInPanel);
  await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'panel', 20000);

  let snapshot = await reloadPersistedState();
  assert.strictEqual(snapshot.activeSurface, 'panel');
  assert.strictEqual(snapshot.sidebar.surfaceLocation, 'panel');
  assert.strictEqual(snapshot.surfaceReady.panel, true);
  assert.strictEqual(snapshot.state.nodes.length, 3);
  assert.strictEqual(findNodeById(snapshot, agentNodeId).title, REAL_DOM_AGENT_TITLE);
  assert.strictEqual(findNodeById(snapshot, terminalNodeId).title, REAL_DOM_TERMINAL_TITLE);
  assert.strictEqual(findNodeById(snapshot, noteNodeId).title, REAL_DOM_NOTE_TITLE);
  assert.strictEqual(findNodeById(snapshot, noteNodeId).metadata.note.content, REAL_DOM_NOTE_BODY);
  assert.strictEqual(findNodeById(snapshot, agentNodeId).status, 'stopped');
  assert.strictEqual(findNodeById(snapshot, terminalNodeId).status, 'closed');
}

async function verifyStandbySurfaceIgnoresMessages(noteNodeId) {
  await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInEditor);
  await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'editor', 20000);
  await clearHostMessages();

  const beforeSnapshot = await getDebugSnapshot();
  const beforeNote = findNodeById(beforeSnapshot, noteNodeId);

  await dispatchWebviewMessage(
    {
      type: 'webview/updateNodeTitle',
      payload: {
        nodeId: noteNodeId,
        title: 'Standby Should Not Win'
      }
    },
    'panel'
  );
  await dispatchWebviewMessage(
    {
      type: 'webview/updateNoteNode',
      payload: {
        nodeId: noteNodeId,
        content: 'This payload comes from a standby surface.'
      }
    },
    'panel'
  );
  await dispatchWebviewMessage({ type: 'webview/not-a-real-message' }, 'panel');

  const afterSnapshot = await getDebugSnapshot();
  const afterNote = findNodeById(afterSnapshot, noteNodeId);
  assert.strictEqual(afterNote.title, beforeNote.title);
  assert.strictEqual(afterNote.status, beforeNote.status);
  assert.strictEqual(afterNote.metadata.note.content, beforeNote.metadata.note.content);

  const hostMessages = await getHostMessages();
  assert.strictEqual(hostMessages.length, 0);
}

async function verifyPendingWebviewRequestFaultInjection(noteNodeId) {
  await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInEditor);
  await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'editor', 20000);

  let snapshot = await getDebugSnapshot();
  assert.strictEqual(findNodeById(snapshot, noteNodeId).metadata.note.content, REAL_DOM_NOTE_BODY);

  const domActionDiagnosticStartIndex = (await getDiagnosticEvents()).length;
  const pendingDomAction = performWebviewDomAction(
    {
      kind: 'setNodeTextField',
      nodeId: noteNodeId,
      field: 'body',
      value: DISPOSED_EDITOR_NOTE_BODY,
      delayMs: WEBVIEW_FAULT_INJECTION_DELAY_MS
    },
    'editor',
    WEBVIEW_FAULT_INJECTION_DELAY_MS + 2000
  );
  await sleep(150);
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  await assert.rejects(pendingDomAction, /Editor Webview was closed/);

  snapshot = await waitForSnapshot((currentSnapshot) => currentSnapshot.surfaceReady.editor === false);
  assert.strictEqual(findNodeById(snapshot, noteNodeId).metadata.note.content, REAL_DOM_NOTE_BODY);
  let raceDiagnostics = (await getDiagnosticEvents()).slice(domActionDiagnosticStartIndex);
  assert.ok(
    raceDiagnostics.some(
      (event) => event.kind === 'surface/disposed' && event.detail?.surface === 'editor'
    )
  );

  await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInEditor);
  await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'editor', 20000);
  let probe = await waitForWebviewProbe((currentProbe) => {
    const currentNote = currentProbe.nodes.find((node) => node.nodeId === noteNodeId);
    return Boolean(currentNote && currentNote.bodyValue === REAL_DOM_NOTE_BODY);
  });
  assert.strictEqual(
    probe.nodes.find((node) => node.nodeId === noteNodeId)?.bodyValue,
    REAL_DOM_NOTE_BODY
  );

  const probeDiagnosticStartIndex = (await getDiagnosticEvents()).length;
  const pendingProbe = captureWebviewProbe(
    'editor',
    WEBVIEW_FAULT_INJECTION_DELAY_MS + 2000,
    WEBVIEW_FAULT_INJECTION_DELAY_MS
  );
  await sleep(150);
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  await assert.rejects(pendingProbe, /Editor Webview was closed/);

  snapshot = await waitForSnapshot((currentSnapshot) => currentSnapshot.surfaceReady.editor === false);
  assert.strictEqual(findNodeById(snapshot, noteNodeId).metadata.note.content, REAL_DOM_NOTE_BODY);
  raceDiagnostics = (await getDiagnosticEvents()).slice(probeDiagnosticStartIndex);
  assert.ok(
    raceDiagnostics.some(
      (event) => event.kind === 'surface/disposed' && event.detail?.surface === 'editor'
    )
  );

  await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInEditor);
  await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'editor', 20000);
  probe = await waitForWebviewProbe((currentProbe) => {
    const currentNote = currentProbe.nodes.find((node) => node.nodeId === noteNodeId);
    return Boolean(currentNote && currentNote.bodyValue === REAL_DOM_NOTE_BODY);
  });
  assert.strictEqual(
    probe.nodes.find((node) => node.nodeId === noteNodeId)?.bodyValue,
    REAL_DOM_NOTE_BODY
  );
}

async function verifyStopVsQueuedExitRace(agentNodeId) {
  await clearHostMessages();
  const diagnosticStartIndex = (await getDiagnosticEvents()).length;

  await dispatchWebviewMessage({
    type: 'webview/startExecutionSession',
    payload: {
      nodeId: agentNodeId,
      kind: 'agent',
      cols: 88,
      rows: 28,
      provider: 'codex'
    }
  });
  await waitForSnapshot((currentSnapshot) => {
    const currentAgent = currentSnapshot.state.nodes.find((node) => node.id === agentNodeId);
    return Boolean(currentAgent?.metadata?.agent?.liveSession);
  });

  await dispatchWebviewMessage({
    type: 'webview/executionInput',
    payload: {
      nodeId: agentNodeId,
      kind: 'agent',
      data: `sleep ${AGENT_STOP_RACE_SLEEP_SECONDS}\rexit 9\r`
    }
  });
  await waitForSnapshot((currentSnapshot) => {
    const currentAgent = currentSnapshot.state.nodes.find((node) => node.id === agentNodeId);
    return Boolean(currentAgent?.metadata?.agent?.recentOutput?.includes(`[fake-agent] sleeping ${AGENT_STOP_RACE_SLEEP_SECONDS}s`));
  });

  await sleep(150);
  await dispatchWebviewMessage({
    type: 'webview/stopExecutionSession',
    payload: {
      nodeId: agentNodeId,
      kind: 'agent'
    }
  });

  const snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentAgent = currentSnapshot.state.nodes.find((node) => node.id === agentNodeId);
    return Boolean(currentAgent && currentAgent.status === 'stopped' && !currentAgent.metadata?.agent?.liveSession);
  });
  const agentNode = findNodeById(snapshot, agentNodeId);
  assert.strictEqual(agentNode.status, 'stopped');
  assert.strictEqual(agentNode.metadata.agent.liveSession, false);
  assert.match(agentNode.summary, /Stopped Codex session/);
  assert.match(agentNode.metadata.agent.recentOutput ?? '', /Token usage:/);
  assert.match(agentNode.metadata.agent.recentOutput ?? '', /codex resume/);

  const raceDiagnostics = (await getDiagnosticEvents()).slice(diagnosticStartIndex);
  const scopedDiagnostics = raceDiagnostics.filter(
    (event) => event.detail?.kind === 'agent' && event.detail?.nodeId === agentNodeId
  );
  assert.strictEqual(
    scopedDiagnostics.filter((event) => event.kind === 'execution/stopRequested').length,
    1
  );
  const exitEvents = scopedDiagnostics.filter((event) => event.kind === 'execution/exited');
  assert.strictEqual(exitEvents.length, 1);
  assert.strictEqual(exitEvents[0].detail?.stopRequested, true);
  assert.strictEqual(exitEvents[0].detail?.status, 'stopped');

  const hostMessages = await getHostMessages();
  assert.strictEqual(
    hostMessages.filter(
      (message) =>
        message.type === 'host/executionExit' &&
        message.payload.kind === 'agent' &&
        message.payload.nodeId === agentNodeId
    ).length,
    1
  );
}

async function verifyClaudeStopRestoresPreviousSignal() {
  await clearHostMessages();
  const diagnosticStartIndex = (await getDiagnosticEvents()).length;

  await dispatchWebviewMessage({
    type: 'webview/createDemoNode',
    payload: {
      kind: 'agent',
      agentProvider: 'claude',
      agentLaunchPreset: 'custom',
      agentCustomLaunchCommand: FAKE_CLAUDE_PROVIDER_COMMAND
    }
  });

  let snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentNode = currentSnapshot.state.nodes.find(
      (node) =>
        node.kind === 'agent' &&
        node.metadata?.agent?.provider === 'claude' &&
        node.metadata?.agent?.customLaunchCommand === FAKE_CLAUDE_PROVIDER_COMMAND
    );
    return Boolean(currentNode);
  });
  const claudeAgentNode = snapshot.state.nodes.find(
    (node) =>
      node.kind === 'agent' &&
      node.metadata?.agent?.provider === 'claude' &&
      node.metadata?.agent?.customLaunchCommand === FAKE_CLAUDE_PROVIDER_COMMAND
  );
  assert.ok(claudeAgentNode, 'Expected a Claude agent node configured with the fake provider.');

  await waitForSnapshot((currentSnapshot) => {
    const currentAgent = currentSnapshot.state.nodes.find((node) => node.id === claudeAgentNode.id);
    return Boolean(currentAgent?.metadata?.agent?.liveSession);
  });

  await dispatchWebviewMessage({
    type: 'webview/executionInput',
    payload: {
      nodeId: claudeAgentNode.id,
      kind: 'agent',
      data: 'hello claude\r'
    }
  });

  await waitForSnapshot((currentSnapshot) => {
    const currentAgent = currentSnapshot.state.nodes.find((node) => node.id === claudeAgentNode.id);
    return Boolean(currentAgent?.metadata?.agent?.recentOutput?.includes('[fake-claude] hello claude'));
  });

  await dispatchWebviewMessage({
    type: 'webview/stopExecutionSession',
    payload: {
      nodeId: claudeAgentNode.id,
      kind: 'agent'
    }
  });

  snapshot = await waitForSnapshot((currentSnapshot) => {
    const currentAgent = currentSnapshot.state.nodes.find((node) => node.id === claudeAgentNode.id);
    return Boolean(currentAgent && currentAgent.status === 'stopped' && !currentAgent.metadata?.agent?.liveSession);
  });

  const stoppedAgentNode = findNodeById(snapshot, claudeAgentNode.id);
  assert.strictEqual(stoppedAgentNode.status, 'stopped');
  assert.strictEqual(stoppedAgentNode.metadata.agent.liveSession, false);
  assert.doesNotMatch(stoppedAgentNode.metadata.agent.recentOutput ?? '', /Press Ctrl-C again to exit/);
  assert.doesNotMatch(stoppedAgentNode.metadata.agent.recentOutput ?? '', /claude --resume/);
  assert.strictEqual(stoppedAgentNode.metadata.agent.resumeStrategy, 'none');
  assert.strictEqual(stoppedAgentNode.metadata.agent.resumeSessionId, undefined);
  assert.strictEqual(stoppedAgentNode.metadata.agent.resumeStoragePath, undefined);

  const scopedDiagnostics = (await getDiagnosticEvents())
    .slice(diagnosticStartIndex)
    .filter((event) => event.detail?.kind === 'agent' && event.detail?.nodeId === claudeAgentNode.id);
  assert.ok(
    scopedDiagnostics.every((event) => event.kind !== 'execution/stopSecondaryInterruptSent'),
    'Claude stop path should no longer emit a second Ctrl-C diagnostic.'
  );
  assert.ok(
    scopedDiagnostics.every((event) => event.kind !== 'execution/stopForceKilled'),
    'Claude stop path should exit gracefully instead of falling back to force-kill.'
  );

  await ensureAgentStopped(claudeAgentNode.id);
  await dispatchWebviewMessage({
    type: 'webview/deleteNode',
    payload: {
      nodeId: claudeAgentNode.id
    }
  });
  await waitForSnapshot(
    (currentSnapshot) => !currentSnapshot.state.nodes.some((node) => node.id === claudeAgentNode.id),
    20000
  );
}

async function verifyClaudeExplicitSessionIdPreservesResumeContext() {
  await clearHostMessages();
  const transcriptFilePath = await seedClaudeSessionTranscriptFile(EXPLICIT_CLAUDE_SESSION_ID);

  try {
    await dispatchWebviewMessage({
      type: 'webview/createDemoNode',
      payload: {
        kind: 'agent',
        agentProvider: 'claude',
        agentLaunchPreset: 'custom',
        agentCustomLaunchCommand: `${FAKE_CLAUDE_PROVIDER_COMMAND} --session-id=${EXPLICIT_CLAUDE_SESSION_ID}`
      }
    });

    let snapshot = await waitForSnapshot((currentSnapshot) => {
      const currentNode = currentSnapshot.state.nodes.find(
        (node) =>
          node.kind === 'agent' &&
          node.metadata?.agent?.provider === 'claude' &&
          node.metadata?.agent?.customLaunchCommand ===
            `${FAKE_CLAUDE_PROVIDER_COMMAND} --session-id=${EXPLICIT_CLAUDE_SESSION_ID}`
      );
      return Boolean(currentNode?.metadata?.agent?.liveSession);
    });
    const claudeAgentNode = snapshot.state.nodes.find(
      (node) =>
        node.kind === 'agent' &&
        node.metadata?.agent?.provider === 'claude' &&
        node.metadata?.agent?.customLaunchCommand ===
          `${FAKE_CLAUDE_PROVIDER_COMMAND} --session-id=${EXPLICIT_CLAUDE_SESSION_ID}`
    );
    assert.ok(claudeAgentNode, 'Expected a Claude agent node configured with an explicit session id.');

    snapshot = await waitForSnapshot((currentSnapshot) => {
      const currentAgent = currentSnapshot.state.nodes.find((node) => node.id === claudeAgentNode.id);
      return Boolean(
        currentAgent?.metadata?.agent?.resumeStrategy === 'claude-session-id' &&
          currentAgent.metadata.agent.resumeSessionId === EXPLICIT_CLAUDE_SESSION_ID
      );
    }, 20000);
    let explicitSessionNode = findNodeById(snapshot, claudeAgentNode.id);
    assert.strictEqual(explicitSessionNode.metadata.agent.resumeStrategy, 'claude-session-id');
    assert.strictEqual(explicitSessionNode.metadata.agent.resumeSessionId, EXPLICIT_CLAUDE_SESSION_ID);

    await dispatchWebviewMessage({
      type: 'webview/stopExecutionSession',
      payload: {
        nodeId: claudeAgentNode.id,
        kind: 'agent'
      }
    });

    snapshot = await waitForSnapshot((currentSnapshot) => {
      const currentAgent = currentSnapshot.state.nodes.find((node) => node.id === claudeAgentNode.id);
      return Boolean(currentAgent && currentAgent.status === 'stopped' && !currentAgent.metadata?.agent?.liveSession);
    }, 20000);
    explicitSessionNode = findNodeById(snapshot, claudeAgentNode.id);
    assert.strictEqual(explicitSessionNode.metadata.agent.resumeStrategy, 'claude-session-id');
    assert.strictEqual(explicitSessionNode.metadata.agent.resumeSessionId, EXPLICIT_CLAUDE_SESSION_ID);

    await ensureAgentStopped(claudeAgentNode.id);
    await dispatchWebviewMessage({
      type: 'webview/deleteNode',
      payload: {
        nodeId: claudeAgentNode.id
      }
    });
    await waitForSnapshot(
      (currentSnapshot) => !currentSnapshot.state.nodes.some((node) => node.id === claudeAgentNode.id),
      20000
    );
  } finally {
    await fs.rm(transcriptFilePath, { force: true }).catch(() => undefined);
    await fs.rmdir(path.dirname(transcriptFilePath)).catch(() => undefined);
  }
}

async function verifyLiveRuntimePersistence(agentNodeId, terminalNodeId) {
  await setRuntimePersistenceEnabled(true);

  try {
    await clearHostMessages();
    await ensureAgentStopped(agentNodeId);
    await ensureTerminalStopped(terminalNodeId);

    await dispatchWebviewMessage({
      type: 'webview/startExecutionSession',
      payload: {
        nodeId: agentNodeId,
        kind: 'agent',
        cols: 92,
        rows: 28,
        provider: 'codex'
      }
    });
    await dispatchWebviewMessage({
      type: 'webview/startExecutionSession',
      payload: {
        nodeId: terminalNodeId,
        kind: 'terminal',
        cols: 92,
        rows: 28
      }
    });

    await waitForSnapshot((currentSnapshot) => {
      const currentAgent = currentSnapshot.state.nodes.find((node) => node.id === agentNodeId);
      return Boolean(
        currentAgent?.metadata?.agent?.liveSession &&
          currentAgent.metadata.agent.attachmentState === 'attached-live' &&
          currentAgent.metadata.agent.runtimeSessionId &&
          currentAgent.status === 'starting'
      );
    }, 20000);
    await waitForTerminalLive(terminalNodeId);

    await dispatchWebviewMessage({
      type: 'webview/executionInput',
      payload: {
        nodeId: agentNodeId,
        kind: 'agent',
        data: 'sleep 1\rburst 3\r'
      }
    });

    let snapshot = await waitForSnapshot((currentSnapshot) => {
      const currentAgent = currentSnapshot.state.nodes.find((node) => node.id === agentNodeId);
      return Boolean(currentAgent?.metadata?.agent?.liveSession && currentAgent.status === 'running');
    }, 20000);
    let agentNode = findNodeById(snapshot, agentNodeId);
    assert.strictEqual(agentNode.status, 'running');

    await sleep(500);
    snapshot = await getDebugSnapshot();
    agentNode = findNodeById(snapshot, agentNodeId);
    assert.strictEqual(agentNode.status, 'running');

    await dispatchWebviewMessage({
      type: 'webview/executionInput',
      payload: {
        nodeId: terminalNodeId,
        kind: 'terminal',
        data: 'sleep 1; echo LIVE_RUNTIME_TERMINAL\r'
      }
    });

    snapshot = await simulateRuntimeReload();
    agentNode = findNodeById(snapshot, agentNodeId);
    let terminalNode = findNodeById(snapshot, terminalNodeId);

    assert.strictEqual(agentNode.status, 'reattaching');
    assert.strictEqual(agentNode.metadata.agent.attachmentState, 'reattaching');
    assert.strictEqual(agentNode.metadata.agent.persistenceMode, 'live-runtime');
    assert.strictEqual(terminalNode.status, 'reattaching');
    assert.strictEqual(terminalNode.metadata.terminal.attachmentState, 'reattaching');
    assert.strictEqual(terminalNode.metadata.terminal.persistenceMode, 'live-runtime');

    snapshot = await waitForSnapshot((currentSnapshot) => {
      const currentAgent = currentSnapshot.state.nodes.find((node) => node.id === agentNodeId);
      const currentTerminal = currentSnapshot.state.nodes.find((node) => node.id === terminalNodeId);
      return Boolean(
        currentAgent?.metadata?.agent?.liveSession &&
          currentAgent.metadata?.agent?.attachmentState === 'attached-live' &&
          currentAgent.metadata?.agent?.recentOutput?.includes('[fake-agent] burst 003') &&
          currentTerminal?.metadata?.terminal?.liveSession &&
          currentTerminal.metadata?.terminal?.attachmentState === 'attached-live' &&
          currentTerminal.metadata?.terminal?.recentOutput?.includes('LIVE_RUNTIME_TERMINAL')
      );
    }, 20000);

    agentNode = findNodeById(snapshot, agentNodeId);
    terminalNode = findNodeById(snapshot, terminalNodeId);

    assert.strictEqual(agentNode.metadata.agent.liveSession, true);
    assert.strictEqual(agentNode.metadata.agent.attachmentState, 'attached-live');
    assert.ok(agentNode.metadata.agent.recentOutput.includes('[fake-agent] burst 003'));
    assert.strictEqual(terminalNode.metadata.terminal.liveSession, true);
    assert.strictEqual(terminalNode.metadata.terminal.attachmentState, 'attached-live');
    assert.ok(terminalNode.metadata.terminal.recentOutput.includes('LIVE_RUNTIME_TERMINAL'));

    await ensureAgentStopped(agentNodeId);
    await ensureTerminalStopped(terminalNodeId);

    snapshot = await waitForSnapshot((currentSnapshot) => {
      const currentAgent = currentSnapshot.state.nodes.find((node) => node.id === agentNodeId);
      const currentTerminal = currentSnapshot.state.nodes.find((node) => node.id === terminalNodeId);
      return Boolean(
        currentAgent &&
          !currentAgent.metadata?.agent?.liveSession &&
          currentAgent.status === 'stopped' &&
          currentTerminal &&
          !currentTerminal.metadata?.terminal?.liveSession &&
          currentTerminal.status === 'closed'
      );
    });

    agentNode = findNodeById(snapshot, agentNodeId);
    terminalNode = findNodeById(snapshot, terminalNodeId);
    assert.strictEqual(agentNode.status, 'stopped');
    assert.strictEqual(terminalNode.status, 'closed');

    snapshot = await simulateRuntimeReload();
    agentNode = findNodeById(snapshot, agentNodeId);
    terminalNode = findNodeById(snapshot, terminalNodeId);
    assert.strictEqual(agentNode.status, 'stopped');
    assert.strictEqual(agentNode.metadata.agent.persistenceMode, 'snapshot-only');
    assert.strictEqual(agentNode.metadata.agent.liveSession, false);
    assert.strictEqual(terminalNode.status, 'closed');
    assert.strictEqual(terminalNode.metadata.terminal.persistenceMode, 'snapshot-only');
    assert.strictEqual(terminalNode.metadata.terminal.liveSession, false);
  } finally {
    await setRuntimePersistenceEnabled(false);
  }
}

async function verifyLiveRuntimeReloadPreservesUpdatedTerminalScrollbackHistory(terminalNodeId) {
  const terminalConfiguration = vscode.workspace.getConfiguration('terminal.integrated');
  const originalScrollback = terminalConfiguration.get('scrollback', 1000);
  const initialScrollback = originalScrollback === 80 ? 60 : 80;
  const configuredScrollback = originalScrollback === 240 ? 320 : 240;
  const terminalRows = 28;
  // Use a compact marker so the full burst stays under the runtime supervisor
  // output tail while still exceeding the pre-reconfiguration scrollback window.
  const scrollbackReconfigurationMarker = 'DSC_LRSP';
  const markerLineCount = 220;
  const earliestMarker = `${scrollbackReconfigurationMarker}-001`;
  const latestMarker = `${scrollbackReconfigurationMarker}-${String(markerLineCount).padStart(3, '0')}`;
  assert.ok(
    markerLineCount > initialScrollback + terminalRows,
    'Scrollback reconfiguration smoke must emit more lines than the initial terminal window can retain.'
  );

  await setRuntimePersistenceEnabled(true);
  await clearHostMessages();
  await setTerminalIntegratedScrollback(initialScrollback);

  try {
    await waitForHostMessages(
      (messages) =>
        messages.some(
          (message) =>
            message.type === 'host/stateUpdated' &&
            message.payload.runtime?.terminalScrollback === initialScrollback
        ),
      20000
    );

    await ensureTerminalStopped(terminalNodeId);
    await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInEditor);
    await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'editor', 20000);

    await dispatchWebviewMessage(
      {
        type: 'webview/startExecutionSession',
        payload: {
          nodeId: terminalNodeId,
          kind: 'terminal',
          cols: 92,
          rows: terminalRows
        }
      },
      'editor'
    );

    let snapshot = await waitForSnapshot((currentSnapshot) => {
      const currentNode = currentSnapshot.state.nodes.find((node) => node.id === terminalNodeId);
      return Boolean(
        currentNode?.metadata?.terminal?.liveSession &&
          currentNode.metadata.terminal.attachmentState === 'attached-live' &&
          currentNode.metadata.terminal.persistenceMode === 'live-runtime' &&
          currentNode.metadata.terminal.runtimeSessionId &&
          currentNode.status === 'live'
      );
    }, 20000);
    let terminalNode = findNodeById(snapshot, terminalNodeId);
    const runtimeSessionId = terminalNode.metadata.terminal.runtimeSessionId;
    assert.ok(runtimeSessionId, 'Live-runtime terminal should expose a runtimeSessionId.');

    await clearHostMessages();
    await setTerminalIntegratedScrollback(configuredScrollback);
    await waitForHostMessages(
      (messages) =>
        messages.some(
          (message) =>
            message.type === 'host/stateUpdated' &&
            message.payload.runtime?.terminalScrollback === configuredScrollback
        ),
      20000
    );

    await waitForRuntimeSupervisorState((runtimeState) => {
      return listRuntimeSupervisorSessions(runtimeState).some(
        (session) => session.sessionId === runtimeSessionId && session.scrollback === configuredScrollback
      );
    }, 20000);

    await dispatchWebviewMessage(
      {
        type: 'webview/executionInput',
        payload: {
          nodeId: terminalNodeId,
          kind: 'terminal',
          // Keep each line shorter than the embedded terminal width used by
          // the smoke harness so scrollback assertions do not become wrap-dependent.
          data:
            `i=1; while [ $i -le ${markerLineCount} ]; do printf '` +
            `${scrollbackReconfigurationMarker}-%03d\\r\\n` +
            '\' "$i"; i=$((i+1)); done\r'
        }
      },
      'editor'
    );

    snapshot = await waitForSnapshot((currentSnapshot) => {
      const currentNode = currentSnapshot.state.nodes.find((node) => node.id === terminalNodeId);
      return Boolean(
        currentNode?.metadata?.terminal?.recentOutput?.includes(
          latestMarker
        )
      );
    }, 20000);
    terminalNode = findNodeById(snapshot, terminalNodeId);
    assert.ok(
      terminalNode.metadata.terminal.recentOutput.includes(
        latestMarker
      )
    );

    await sleep(500);
    const runtimeState = await waitForRuntimeSupervisorState((currentRuntimeState) => {
      return listRuntimeSupervisorSessions(currentRuntimeState).some(
        (session) =>
          session.sessionId === runtimeSessionId &&
          session.scrollback === configuredScrollback &&
          typeof session.output === 'string' &&
          session.output.includes(latestMarker) &&
          session.serializedTerminalState?.outputSequence === session.outputSequence &&
          typeof session.serializedTerminalState?.data === 'string' &&
          session.serializedTerminalState.data.includes(earliestMarker) &&
          session.serializedTerminalState.data.includes(latestMarker)
      );
    }, 20000);
    assert.ok(
      listRuntimeSupervisorSessions(runtimeState).some(
        (session) =>
          session.sessionId === runtimeSessionId &&
          session.scrollback === configuredScrollback &&
          typeof session.output === 'string' &&
          session.output.includes(latestMarker) &&
          session.serializedTerminalState?.outputSequence === session.outputSequence &&
          typeof session.serializedTerminalState?.data === 'string' &&
          session.serializedTerminalState.data.includes(earliestMarker) &&
          session.serializedTerminalState.data.includes(latestMarker)
      ),
      'Expected runtime supervisor snapshots to retain the updated terminal scrollback history.'
    );

    snapshot = await simulateRuntimeReload();
    terminalNode = findNodeById(snapshot, terminalNodeId);
    assert.strictEqual(terminalNode.metadata.terminal.attachmentState, 'reattaching');

    snapshot = await waitForSnapshot((currentSnapshot) => {
      const currentNode = currentSnapshot.state.nodes.find((node) => node.id === terminalNodeId);
      return Boolean(
        currentNode?.metadata?.terminal?.liveSession &&
          currentNode.metadata.terminal.attachmentState === 'attached-live' &&
          currentNode.metadata.terminal.runtimeSessionId === runtimeSessionId &&
          typeof currentNode.metadata.terminal.serializedTerminalState?.data === 'string' &&
          currentNode.metadata.terminal.serializedTerminalState.data.includes(earliestMarker) &&
          currentNode.metadata.terminal.serializedTerminalState.data.includes(latestMarker)
      );
    }, 20000);

    terminalNode = findNodeById(snapshot, terminalNodeId);
    const serializedData = terminalNode.metadata.terminal.serializedTerminalState?.data ?? '';
    assert.ok(
      serializedData.includes(earliestMarker),
      'Reloaded live-runtime terminal should keep the earliest line allowed by the updated scrollback.'
    );
    assert.ok(
      serializedData.includes(latestMarker),
      'Reloaded live-runtime terminal should keep the latest line after scrollback reconfiguration.'
    );

    await ensureTerminalStopped(terminalNodeId);
  } finally {
    await clearHostMessages();
    await setRuntimePersistenceEnabled(false);
    await setTerminalIntegratedScrollback(originalScrollback);
    await waitForHostMessages(
      (messages) =>
        messages.some(
          (message) =>
            message.type === 'host/stateUpdated' &&
            message.payload.runtime?.terminalScrollback === originalScrollback
        ),
      20000
    );
  }
}

async function verifyLiveRuntimeResumeExitClassification(agentNodeId) {
  await setRuntimePersistenceEnabled(true);

  try {
    await clearHostMessages();
    await ensureAgentStopped(agentNodeId);

    await dispatchWebviewMessage({
      type: 'webview/startExecutionSession',
      payload: {
        nodeId: agentNodeId,
        kind: 'agent',
        cols: 92,
        rows: 28,
        provider: 'codex',
        resume: true
      }
    });

    let snapshot = await waitForSnapshot((currentSnapshot) => {
      const currentAgent = currentSnapshot.state.nodes.find((node) => node.id === agentNodeId);
      return Boolean(
        currentAgent?.metadata?.agent?.liveSession && currentAgent.status === 'resuming'
      );
    }, 20000);

    await dispatchWebviewMessage({
      type: 'webview/executionInput',
      payload: {
        nodeId: agentNodeId,
        kind: 'agent',
        data: 'burst 1\r'
      }
    });

    snapshot = await waitForSnapshot((currentSnapshot) => {
      const currentAgent = currentSnapshot.state.nodes.find((node) => node.id === agentNodeId);
      return Boolean(currentAgent?.metadata?.agent?.liveSession && currentAgent.status === 'running');
    }, 20000);

    let agentNode = findNodeById(snapshot, agentNodeId);
    assert.strictEqual(agentNode.status, 'running');

    snapshot = await waitForSnapshot((currentSnapshot) => {
      const currentAgent = currentSnapshot.state.nodes.find((node) => node.id === agentNodeId);
      return Boolean(
        currentAgent?.metadata?.agent?.liveSession &&
          currentAgent.status === 'waiting-input' &&
          currentAgent.metadata?.agent?.recentOutput?.includes('[fake-agent] resumed session') &&
          currentAgent.metadata?.agent?.recentOutput?.includes('[fake-agent] burst 001')
      );
    }, 20000);

    agentNode = findNodeById(snapshot, agentNodeId);
    assert.strictEqual(agentNode.status, 'waiting-input');
    assert.ok(agentNode.metadata.agent.recentOutput.includes('[fake-agent] resumed session'));
    assert.ok(agentNode.metadata.agent.recentOutput.includes('[fake-agent] burst 001'));

    await dispatchWebviewMessage({
      type: 'webview/executionInput',
      payload: {
        nodeId: agentNodeId,
        kind: 'agent',
        data: 'exit 23\r'
      }
    });

    snapshot = await waitForSnapshot((currentSnapshot) => {
      const currentAgent = currentSnapshot.state.nodes.find((node) => node.id === agentNodeId);
      return Boolean(
        currentAgent &&
          !currentAgent.metadata?.agent?.liveSession &&
          (currentAgent.status === 'error' || currentAgent.status === 'resume-failed')
      );
    }, 20000);

    agentNode = findNodeById(snapshot, agentNodeId);
    assert.strictEqual(agentNode.status, 'error');
    assert.strictEqual(agentNode.metadata.agent.lastExitCode, 23);
    assert.match(agentNode.summary, /exit(?:ed with code| code) 23/);
  } finally {
    await setRuntimePersistenceEnabled(false);
  }
}

async function verifyLiveRuntimeReconnectFallbackToResume(agentNodeId, terminalNodeId) {
  await setRuntimePersistenceEnabled(true);
  const diagnosticStartIndex = (await getDiagnosticEvents()).length;
  const baselineSnapshot = await getDebugSnapshot();
  const baselineAgent = findNodeById(baselineSnapshot, agentNodeId);
  const baselineTerminal = findNodeById(baselineSnapshot, terminalNodeId);
  let shouldRestoreBaseline = false;

  const fakeStorageDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dev-session-canvas-runtime-fallback-'));
  const fallbackSessionId = '44444444-4444-4444-8444-444444444444';

  try {
    await fs.writeFile(path.join(fakeStorageDir, 'last-session'), `${fallbackSessionId}\n`, 'utf8');

    const currentSnapshot = await getDebugSnapshot();
    const noteNode = findNodeByKind(currentSnapshot, 'note');
    const agentNode = findNodeById(currentSnapshot, agentNodeId);
    const terminalNode = findNodeById(currentSnapshot, terminalNodeId);

    let snapshot = await setPersistedState({
      version: 1,
      updatedAt: '2026-04-12T09:30:00.000Z',
      nodes: [
        {
          ...agentNode,
          status: 'reattaching',
          summary: 'Reconnecting to the original Agent live runtime.',
          metadata: {
            ...agentNode.metadata,
            agent: {
              ...agentNode.metadata.agent,
              provider: 'codex',
              lifecycle: 'waiting-input',
              persistenceMode: 'live-runtime',
              attachmentState: 'reattaching',
              liveSession: false,
              runtimeBackend: 'legacy-detached',
              runtimeGuarantee: 'best-effort',
              runtimeSessionId: 'missing-agent-runtime-session',
              resumeSupported: false,
              resumeStrategy: 'fake-provider',
              resumeSessionId: fallbackSessionId,
              resumeStoragePath: fakeStorageDir,
              pendingLaunch: undefined,
              lastRuntimeError: undefined,
              lastResumeError: undefined
            }
          }
        },
        {
          ...terminalNode,
          status: 'reattaching',
          summary: 'Reconnecting to the original Terminal live runtime.',
          metadata: {
            ...terminalNode.metadata,
            terminal: {
              ...terminalNode.metadata.terminal,
              lifecycle: 'live',
              persistenceMode: 'live-runtime',
              attachmentState: 'reattaching',
              liveSession: false,
              runtimeBackend: 'legacy-detached',
              runtimeGuarantee: 'best-effort',
              runtimeSessionId: 'missing-terminal-runtime-session',
              pendingLaunch: undefined,
              lastRuntimeError: undefined
            }
          }
        },
        noteNode
      ]
    });

    snapshot = await waitForSnapshot((currentState) => {
      const currentAgent = currentState.state.nodes.find((node) => node.id === agentNodeId);
      const currentTerminal = currentState.state.nodes.find((node) => node.id === terminalNodeId);
      return Boolean(
        currentAgent?.metadata?.agent?.liveSession &&
          currentAgent.status === 'waiting-input' &&
          currentAgent.metadata?.agent?.attachmentState === 'attached-live' &&
          currentAgent.metadata?.agent?.recentOutput?.includes('[fake-agent] resumed session') &&
          currentTerminal?.status === 'history-restored' &&
          currentTerminal.metadata?.terminal?.attachmentState === 'history-restored' &&
          currentTerminal.metadata?.terminal?.liveSession === false
      );
    }, 20000);

    const restoredAgent = findNodeById(snapshot, agentNodeId);
    const restoredTerminal = findNodeById(snapshot, terminalNodeId);
    assert.strictEqual(
      restoredAgent.metadata.agent.persistenceMode,
      'live-runtime',
      'Expected runtime projection to retain the live-runtime persistence mode from the seeded persisted agent state.'
    );
    assert.ok(
      restoredAgent.metadata.agent.runtimeSessionId,
      'Expected runtime reconciliation to replace the missing live runtime with a resumed runtime session id.'
    );
    assert.strictEqual(
      restoredAgent.metadata.agent.resumeSupported,
      true,
      'Expected runtime reconciliation to upgrade the seeded fallback agent into a resume-supported state.'
    );
    assert.ok(
      restoredAgent.metadata.agent.recentOutput.includes('[fake-agent] resumed session'),
      'Expected runtime projection to append resumed-session output after reconciling the seeded fallback agent state.'
    );
    assert.strictEqual(
      restoredTerminal.metadata.terminal.liveSession,
      false,
      'Expected runtime projection to keep the seeded fallback terminal in history-only mode.'
    );
    assert.match(
      restoredTerminal.summary,
      /runtime session/i,
      'Expected runtime projection to explain that the seeded terminal live runtime could not be reattached.'
    );
    assert.match(
      restoredTerminal.metadata.terminal.lastRuntimeError ?? '',
      /runtime session/i,
      'Expected runtime projection to preserve the terminal runtime-reattach failure reason derived from seeded state.'
    );

    const reconnectDiagnostics = (await getDiagnosticEvents()).slice(diagnosticStartIndex);
    assert.ok(
      reconnectDiagnostics.some(
        (event) =>
          event.kind === 'agent/liveRuntimeReconnectFallbackToResume' &&
          event.detail?.nodeId === agentNodeId &&
          event.detail?.resumeSessionId === fallbackSessionId
      )
    );

    await ensureAgentStopped(agentNodeId);
    shouldRestoreBaseline = true;
  } finally {
    await setRuntimePersistenceEnabled(false);
    if (shouldRestoreBaseline) {
      await setPersistedState(baselineSnapshot.state);
      const restoredBaselineSnapshot = await waitForSnapshot((currentState) => {
        const currentAgent = currentState.state.nodes.find((node) => node.id === agentNodeId);
        const currentTerminal = currentState.state.nodes.find((node) => node.id === terminalNodeId);
        return Boolean(
          !currentAgent?.metadata?.agent?.liveSession &&
            currentAgent.metadata?.agent?.resumeSessionId === baselineAgent.metadata?.agent?.resumeSessionId &&
            currentAgent.metadata?.agent?.resumeStoragePath === baselineAgent.metadata?.agent?.resumeStoragePath &&
            !currentTerminal?.metadata?.terminal?.liveSession &&
            currentTerminal.metadata?.terminal?.recentOutput ===
              baselineTerminal.metadata?.terminal?.recentOutput
        );
      }, 20000);
      const restoredBaselineAgent = findNodeById(restoredBaselineSnapshot, agentNodeId);
      const restoredBaselineTerminal = findNodeById(restoredBaselineSnapshot, terminalNodeId);
      assert.strictEqual(
        restoredBaselineAgent.metadata.agent.resumeSessionId,
        baselineAgent.metadata?.agent?.resumeSessionId,
        'Expected restoring the baseline persisted state to recover the baseline agent resume metadata after fallback runtime projection.'
      );
      assert.strictEqual(
        restoredBaselineTerminal.metadata.terminal.recentOutput,
        baselineTerminal.metadata?.terminal?.recentOutput,
        'Expected restoring the baseline persisted state to recover the baseline terminal history projection after fallback runtime projection.'
      );
    }
    await fs.rm(fakeStorageDir, { recursive: true, force: true });
  }
}

async function verifyHistoryRestoredResumeReadyIgnoresStaleResumeSupported(agentNodeId, terminalNodeId) {
  await setRuntimePersistenceEnabled(true);

  const baselineSnapshot = await getDebugSnapshot();
  const baselineAgent = findNodeById(baselineSnapshot, agentNodeId);
  const baselineTerminal = findNodeById(baselineSnapshot, terminalNodeId);
  let shouldRestoreBaseline = false;

  const fakeStorageDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dev-session-canvas-history-resume-'));
  const fallbackSessionId = '55555555-5555-4555-8555-555555555555';

  try {
    await fs.writeFile(path.join(fakeStorageDir, 'last-session'), `${fallbackSessionId}\n`, 'utf8');

    const currentSnapshot = await getDebugSnapshot();
    const noteNode = findNodeByKind(currentSnapshot, 'note');
    const agentNode = findNodeById(currentSnapshot, agentNodeId);
    const terminalNode = findNodeById(currentSnapshot, terminalNodeId);

    let snapshot = await setPersistedState({
      version: 1,
      updatedAt: '2026-04-12T09:40:00.000Z',
      nodes: [
        {
          ...agentNode,
          status: 'history-restored',
          summary: 'The original Agent live runtime disconnected. A resumable session will be used instead.',
          metadata: {
            ...agentNode.metadata,
            agent: {
              ...agentNode.metadata.agent,
              provider: 'codex',
              lifecycle: 'resume-ready',
              persistenceMode: 'live-runtime',
              attachmentState: 'history-restored',
              liveSession: false,
              runtimeBackend: 'legacy-detached',
              runtimeGuarantee: 'best-effort',
              runtimeSessionId: undefined,
              resumeSupported: false,
              resumeStrategy: 'fake-provider',
              resumeSessionId: fallbackSessionId,
              resumeStoragePath: fakeStorageDir,
              pendingLaunch: 'resume',
              lastRuntimeError: 'Runtime session old-runtime-session was not found.',
              lastResumeError: undefined
            }
          }
        },
        terminalNode,
        noteNode
      ]
    });

    let restoredAgent = findNodeById(snapshot, agentNodeId);
    assert.ok(
      restoredAgent.status === 'resume-ready' || restoredAgent.status === 'history-restored',
      `Expected runtime reconciliation to keep the seeded history-restored agent resumable, got ${restoredAgent.status}.`
    );
    assert.strictEqual(
      restoredAgent.metadata.agent.resumeSupported,
      true,
      'Expected runtime projection to ignore stale persisted resumeSupported=false metadata when resume context is still valid.'
    );

    snapshot = await waitForSnapshot((currentState) => {
      const currentAgent = currentState.state.nodes.find((node) => node.id === agentNodeId);
      return Boolean(
        currentAgent?.metadata?.agent?.liveSession &&
          currentAgent.status === 'waiting-input' &&
          currentAgent.metadata?.agent?.recentOutput?.includes('[fake-agent] resumed session')
      );
    }, 20000);

    restoredAgent = findNodeById(snapshot, agentNodeId);
    assert.strictEqual(
      restoredAgent.metadata.agent.resumeSupported,
      true,
      'Expected resumed runtime projection to keep resume support enabled after consuming the seeded resume context.'
    );
    assert.ok(
      restoredAgent.metadata.agent.recentOutput.includes('[fake-agent] resumed session'),
      'Expected runtime projection to resume the seeded history-restored agent through the available fallback resume context.'
    );

    await ensureAgentStopped(agentNodeId);
    shouldRestoreBaseline = true;
  } finally {
    await setRuntimePersistenceEnabled(false);
    if (shouldRestoreBaseline) {
      await setPersistedState(baselineSnapshot.state);
      const restoredBaselineSnapshot = await waitForSnapshot((currentState) => {
        const currentAgent = currentState.state.nodes.find((node) => node.id === agentNodeId);
        const currentTerminal = currentState.state.nodes.find((node) => node.id === terminalNodeId);
        return Boolean(
          !currentAgent?.metadata?.agent?.liveSession &&
            currentAgent.metadata?.agent?.resumeSessionId === baselineAgent.metadata?.agent?.resumeSessionId &&
            currentAgent.metadata?.agent?.resumeStoragePath === baselineAgent.metadata?.agent?.resumeStoragePath &&
            !currentTerminal?.metadata?.terminal?.liveSession &&
            currentTerminal.metadata?.terminal?.recentOutput ===
              baselineTerminal.metadata?.terminal?.recentOutput
        );
      }, 20000);
      const restoredBaselineAgent = findNodeById(restoredBaselineSnapshot, agentNodeId);
      const restoredBaselineTerminal = findNodeById(restoredBaselineSnapshot, terminalNodeId);
      assert.strictEqual(
        restoredBaselineAgent.metadata.agent.resumeSessionId,
        baselineAgent.metadata?.agent?.resumeSessionId,
        'Expected restoring the baseline persisted state to recover baseline agent resume metadata after consuming the seeded resume projection.'
      );
      assert.strictEqual(
        restoredBaselineTerminal.metadata.terminal.recentOutput,
        baselineTerminal.metadata?.terminal?.recentOutput,
        'Expected restoring the baseline persisted state to recover the baseline terminal history projection after consuming the seeded resume projection.'
      );
    }
    await fs.rm(fakeStorageDir, { recursive: true, force: true });
  }
}

async function verifyImmediateReloadAfterLiveRuntimeLaunch(agentNodeId, terminalNodeId) {
  await setRuntimePersistenceEnabled(true);

  try {
    await clearHostMessages();
    await ensureAgentStopped(agentNodeId);
    await ensureTerminalStopped(terminalNodeId);

    await dispatchWebviewMessage({
      type: 'webview/startExecutionSession',
      payload: {
        nodeId: agentNodeId,
        kind: 'agent',
        cols: 92,
        rows: 28,
        provider: 'codex'
      }
    });
    await dispatchWebviewMessage({
      type: 'webview/startExecutionSession',
      payload: {
        nodeId: terminalNodeId,
        kind: 'terminal',
        cols: 92,
        rows: 28
      }
    });

    let snapshot = await simulateRuntimeReload();
    let agentNode = findNodeById(snapshot, agentNodeId);
    let terminalNode = findNodeById(snapshot, terminalNodeId);

    assert.notStrictEqual(agentNode.status, 'history-restored');
    assert.notStrictEqual(terminalNode.status, 'history-restored');
    assert.strictEqual(agentNode.metadata.agent.persistenceMode, 'live-runtime');
    assert.strictEqual(terminalNode.metadata.terminal.persistenceMode, 'live-runtime');

    snapshot = await waitForSnapshot((currentSnapshot) => {
      const currentAgent = currentSnapshot.state.nodes.find((node) => node.id === agentNodeId);
      const currentTerminal = currentSnapshot.state.nodes.find((node) => node.id === terminalNodeId);
      return Boolean(
        currentAgent?.metadata?.agent?.liveSession &&
          currentAgent.metadata?.agent?.attachmentState === 'attached-live' &&
          currentAgent.metadata?.agent?.runtimeSessionId &&
          currentTerminal?.metadata?.terminal?.liveSession &&
          currentTerminal.metadata?.terminal?.attachmentState === 'attached-live' &&
          currentTerminal.metadata?.terminal?.runtimeSessionId
      );
    }, 20000);

    agentNode = findNodeById(snapshot, agentNodeId);
    terminalNode = findNodeById(snapshot, terminalNodeId);

    assert.strictEqual(agentNode.metadata.agent.liveSession, true);
    assert.strictEqual(agentNode.metadata.agent.attachmentState, 'attached-live');
    assert.ok(agentNode.metadata.agent.runtimeSessionId);
    assert.strictEqual(terminalNode.metadata.terminal.liveSession, true);
    assert.strictEqual(terminalNode.metadata.terminal.attachmentState, 'attached-live');
    assert.ok(terminalNode.metadata.terminal.runtimeSessionId);

    await ensureAgentStopped(agentNodeId);
    await ensureTerminalStopped(terminalNodeId);
  } finally {
    await setRuntimePersistenceEnabled(false);
  }
}

async function verifyRuntimePersistenceRequiresReloadAndClearsState() {
  const configuration = vscode.workspace.getConfiguration();
  const originalDefaultSurface =
    configuration.get('devSessionCanvas.canvas.defaultSurface', 'panel') === 'editor' ? 'editor' : 'panel';
  const runtimeResetSurface = 'panel';

  if (originalDefaultSurface !== runtimeResetSurface) {
    await setDefaultSurface(runtimeResetSurface);
  }
  await setRuntimePersistenceEnabled(true);

  try {
    let snapshot = await simulateRuntimeReload();
    assert.strictEqual(snapshot.state.nodes.length, 0);
    assert.strictEqual(snapshot.sidebar.configuredSurface, runtimeResetSurface);

    await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInEditor);
    await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'editor', 20000);
    snapshot = await getDebugSnapshot();
    assert.strictEqual(snapshot.activeSurface, 'editor');
    assert.strictEqual(snapshot.sidebar.configuredSurface, runtimeResetSurface);

    await vscode.commands.executeCommand(COMMAND_IDS.testCreateNode, 'agent');
    await vscode.commands.executeCommand(COMMAND_IDS.testCreateNode, 'terminal');
    snapshot = await waitForSnapshot(
      (currentSnapshot) =>
        currentSnapshot.state.nodes.filter((node) => node.kind === 'agent').length === 1 &&
        currentSnapshot.state.nodes.filter((node) => node.kind === 'terminal').length === 1,
      20000
    );

    const agentNode = findNodeByKind(snapshot, 'agent');
    const terminalNode = findNodeByKind(snapshot, 'terminal');

    await startExecutionSessionForTest({
      kind: 'agent',
      nodeId: agentNode.id,
      cols: 92,
      rows: 28,
      provider: 'codex'
    });
    await startExecutionSessionForTest({
      kind: 'terminal',
      nodeId: terminalNode.id,
      cols: 92,
      rows: 28
    });

    await waitForAgentLive(agentNode.id);
    await waitForTerminalLive(terminalNode.id);
    await waitForRuntimeSupervisorState(
      (runtimeSupervisorState) => listLiveRuntimeSupervisorSessions(runtimeSupervisorState).length === 2,
      20000
    );

    await setRuntimePersistenceEnabled(false);

    await vscode.commands.executeCommand(COMMAND_IDS.testCreateNode, 'terminal');
    snapshot = await waitForSnapshot(
      (currentSnapshot) => currentSnapshot.state.nodes.filter((node) => node.kind === 'terminal').length === 2,
      20000
    );
    const extraTerminalNode = snapshot.state.nodes.find(
      (node) => node.kind === 'terminal' && node.id !== terminalNode.id
    );
    assert.ok(extraTerminalNode, 'Expected a second terminal node before reload.');

    await startExecutionSessionForTest({
      kind: 'terminal',
      nodeId: extraTerminalNode.id,
      cols: 92,
      rows: 28
    });

    snapshot = await waitForSnapshot((currentSnapshot) => {
      const currentTerminalNode = currentSnapshot.state.nodes.find((node) => node.id === extraTerminalNode.id);
      return Boolean(
        currentTerminalNode?.metadata?.terminal?.liveSession &&
        currentTerminalNode?.metadata?.terminal?.persistenceMode === 'live-runtime'
      );
    }, 20000);
    const currentAgentNode = findNodeById(snapshot, agentNode.id);
    const currentTerminalNode = findNodeById(snapshot, terminalNode.id);
    const currentExtraTerminalNode = findNodeById(snapshot, extraTerminalNode.id);
    assert.strictEqual(currentExtraTerminalNode.metadata.terminal.persistenceMode, 'live-runtime');

    const expectedRuntimeSessionIds = [
      currentAgentNode.metadata.agent.runtimeSessionId,
      currentTerminalNode.metadata.terminal.runtimeSessionId,
      currentExtraTerminalNode.metadata.terminal.runtimeSessionId
    ];
    assert.ok(expectedRuntimeSessionIds.every(Boolean), 'Expected all live-runtime nodes to have runtimeSessionId.');

    await waitForRuntimeSupervisorState(
      (runtimeSupervisorState) => {
        const liveSessionIds = listLiveRuntimeSupervisorSessions(runtimeSupervisorState).map((session) => session.sessionId);
        return expectedRuntimeSessionIds.every((sessionId) => liveSessionIds.includes(sessionId));
      },
      20000
    );

    await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInEditor);
    await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'editor', 20000);
    snapshot = await getDebugSnapshot();
    assert.strictEqual(snapshot.activeSurface, 'editor');
    assert.strictEqual(snapshot.sidebar.configuredSurface, runtimeResetSurface);

    snapshot = await simulateRuntimeReload();
    assert.strictEqual(snapshot.state.nodes.length, 0);
    assert.strictEqual(snapshot.activeSurface, runtimeResetSurface);
    assert.strictEqual(snapshot.sidebar.configuredSurface, runtimeResetSurface);
    assert.strictEqual(snapshot.sidebar.surfaceLocation, runtimeResetSurface);

    const runtimeSupervisorState = await waitForRuntimeSupervisorState(
      (currentState) => {
        const sessionIds = listRuntimeSupervisorSessions(currentState).map((session) => session.sessionId);
        return (
          currentState.bindings.length === 0 &&
          expectedRuntimeSessionIds.every((sessionId) => !sessionIds.includes(sessionId))
        );
      },
      20000
    );
    const remainingSessionIds = listRuntimeSupervisorSessions(runtimeSupervisorState).map((session) => session.sessionId);
    assert.ok(expectedRuntimeSessionIds.every((sessionId) => !remainingSessionIds.includes(sessionId)));
  } finally {
    await setRuntimePersistenceEnabled(false);
    if (originalDefaultSurface !== runtimeResetSurface) {
      await setDefaultSurface(originalDefaultSurface);
      await simulateRuntimeReload();
    }
  }
}

async function verifyHostBoundaryFlushesRecentLocalState(agentNodeId, terminalNodeId) {
  await setRuntimePersistenceEnabled(false);
  await clearHostMessages();
  await ensureAgentStopped(agentNodeId);
  await ensureTerminalStopped(terminalNodeId);

  await dispatchWebviewMessage({
    type: 'webview/startExecutionSession',
    payload: {
      nodeId: agentNodeId,
      kind: 'agent',
      cols: 92,
      rows: 28,
      provider: 'codex'
    }
  });
  await dispatchWebviewMessage({
    type: 'webview/startExecutionSession',
    payload: {
      nodeId: terminalNodeId,
      kind: 'terminal',
      cols: 92,
      rows: 28
    }
  });

  await waitForAgentLive(agentNodeId);
  await waitForTerminalLive(terminalNodeId);
  await clearHostMessages();

  await dispatchWebviewMessage({
    type: 'webview/executionInput',
    payload: {
      nodeId: agentNodeId,
      kind: 'agent',
      data: `echo ${HOST_BOUNDARY_FLUSH_AGENT_MARKER}\r`
    }
  });
  await dispatchWebviewMessage({
    type: 'webview/executionInput',
    payload: {
      nodeId: terminalNodeId,
      kind: 'terminal',
      data: `echo ${HOST_BOUNDARY_FLUSH_TERMINAL_MARKER}\r`
    }
  });

  await waitForHostMessages((messages) => {
    const sawAgentMarker = messages.some(
      (message) =>
        message.type === 'host/executionOutput' &&
        message.payload.kind === 'agent' &&
        message.payload.nodeId === agentNodeId &&
        message.payload.chunk.includes(HOST_BOUNDARY_FLUSH_AGENT_MARKER)
    );
    const sawTerminalMarker = messages.some(
      (message) =>
        message.type === 'host/executionOutput' &&
        message.payload.kind === 'terminal' &&
        message.payload.nodeId === terminalNodeId &&
        message.payload.chunk.includes(HOST_BOUNDARY_FLUSH_TERMINAL_MARKER)
    );
    return sawAgentMarker && sawTerminalMarker;
  }, 8000);

  const snapshot = await simulateRuntimeReload();
  const agentNode = findNodeById(snapshot, agentNodeId);
  const terminalNode = findNodeById(snapshot, terminalNodeId);

  assert.match(agentNode.metadata.agent.recentOutput || '', new RegExp(HOST_BOUNDARY_FLUSH_AGENT_MARKER));
  assert.match(terminalNode.metadata.terminal.recentOutput || '', new RegExp(HOST_BOUNDARY_FLUSH_TERMINAL_MARKER));
}

async function verifyRestrictedLiveRuntimeReconnectBlocked() {
  await setRuntimePersistenceEnabled(true);
  let baselineSnapshot;

  try {
    baselineSnapshot = await simulateRuntimeReload();
    assert.strictEqual(baselineSnapshot.state.nodes.length, 0);
    baselineSnapshot = await ensureEditorCanvasReady();
    assert.strictEqual(baselineSnapshot.activeSurface, 'editor');
    let snapshot = baselineSnapshot;

    const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
    const agentNodeId = 'restricted-history-agent';
    const terminalNodeId = 'restricted-history-terminal';

    await clearHostMessages();
    snapshot = await setPersistedState({
      version: 1,
      updatedAt: '2026-04-10T09:00:00.000Z',
      nodes: [
        {
          id: agentNodeId,
          kind: 'agent',
          title: 'Agent 1',
          status: 'reattaching',
          summary: 'Reconnecting to the original Agent live runtime.',
          position: { x: 0, y: 0 },
          size: { width: 560, height: 430 },
          metadata: {
            agent: {
              backend: 'node-pty',
              lifecycle: 'waiting-input',
              provider: 'codex',
              runtimeKind: 'pty-cli',
              resumeSupported: false,
              resumeStrategy: 'none',
              shellPath: 'codex',
              cwd: workspacePath,
              persistenceMode: 'live-runtime',
              attachmentState: 'reattaching',
              runtimeBackend: 'legacy-detached',
              runtimeGuarantee: 'best-effort',
              liveSession: false,
              runtimeSessionId: 'restricted-agent-live-session',
              outputSequence: 1,
              lastCols: 67,
              lastRows: 22,
              serializedTerminalState: createSerializedTerminalStateFixture(
                RESTRICTED_AGENT_SERIALIZED_MARKER,
                1
              ),
              lastBackendLabel: 'Codex'
            }
          }
        },
        {
          id: terminalNodeId,
          kind: 'terminal',
          title: 'Terminal 2',
          status: 'reattaching',
          summary: 'Reconnecting to the original Terminal live runtime.',
          position: { x: 680, y: 0 },
          size: { width: 540, height: 420 },
          metadata: {
            terminal: {
              backend: 'node-pty',
              lifecycle: 'live',
              shellPath: '/bin/bash',
              cwd: workspacePath,
              persistenceMode: 'live-runtime',
              attachmentState: 'reattaching',
              runtimeBackend: 'legacy-detached',
              runtimeGuarantee: 'best-effort',
              liveSession: false,
              runtimeSessionId: 'restricted-terminal-live-session',
              outputSequence: 1,
              lastCols: 68,
              lastRows: 23,
              serializedTerminalState: createSerializedTerminalStateFixture(
                RESTRICTED_TERMINAL_SERIALIZED_MARKER,
                1
              )
            }
          }
        },
        {
          id: 'restricted-history-note',
          kind: 'note',
          title: 'Note 3',
          status: 'ready',
          summary: '等待记录笔记内容。',
          position: { x: 640, y: 480 },
          size: { width: 380, height: 400 },
          metadata: {
            note: {
              content: ''
            }
          }
        }
      ]
    });

    assert.strictEqual(
      findNodeById(snapshot, agentNodeId).status,
      'history-restored',
      'Expected runtime projection to downgrade the seeded reattaching agent into history-restored mode in an untrusted workspace.'
    );
    assert.strictEqual(
      findNodeById(snapshot, agentNodeId).summary,
      'The current workspace is not trusted. The original Agent live runtime will not reconnect, and only history results are shown.',
      'Expected runtime projection to explain why the seeded reattaching agent stays history-only in an untrusted workspace.'
    );
    assert.strictEqual(
      findNodeById(snapshot, terminalNodeId).status,
      'history-restored',
      'Expected runtime projection to downgrade the seeded reattaching terminal into history-restored mode in an untrusted workspace.'
    );
    assert.strictEqual(
      findNodeById(snapshot, terminalNodeId).summary,
      'The current workspace is not trusted. The original Terminal live runtime will not reconnect, and only history results are shown.',
      'Expected runtime projection to explain why the seeded reattaching terminal stays history-only in an untrusted workspace.'
    );
    assert.strictEqual(
      findNodeById(snapshot, agentNodeId).metadata.agent.attachmentState,
      'reattaching',
      'Expected untrusted runtime projection to preserve the seeded agent attachment marker while blocking live reconnect.'
    );
    assert.strictEqual(
      findNodeById(snapshot, agentNodeId).metadata.agent.liveSession,
      false,
      'Expected untrusted runtime projection not to create a live agent session from seeded persisted state.'
    );
    assert.strictEqual(
      findNodeById(snapshot, terminalNodeId).metadata.terminal.attachmentState,
      'reattaching',
      'Expected untrusted runtime projection to preserve the seeded terminal attachment marker while blocking live reconnect.'
    );
    assert.strictEqual(
      findNodeById(snapshot, terminalNodeId).metadata.terminal.liveSession,
      false,
      'Expected untrusted runtime projection not to create a live terminal session from seeded persisted state.'
    );

    await dispatchWebviewMessage({
      type: 'webview/resizeExecutionSession',
      payload: {
        nodeId: agentNodeId,
        kind: 'agent',
        cols: 41,
        rows: 9
      }
    });
    await dispatchWebviewMessage({
      type: 'webview/resizeExecutionSession',
      payload: {
        nodeId: terminalNodeId,
        kind: 'terminal',
        cols: 43,
        rows: 10
      }
    });

    snapshot = await getDebugSnapshot();
    assert.strictEqual(
      findNodeById(snapshot, agentNodeId).status,
      'history-restored',
      'Expected blocked runtime projection to keep the seeded agent in history-restored mode after ignored resize requests.'
    );
    assert.strictEqual(
      findNodeById(snapshot, terminalNodeId).status,
      'history-restored',
      'Expected blocked runtime projection to keep the seeded terminal in history-restored mode after ignored resize requests.'
    );
    assert.strictEqual(
      findNodeById(snapshot, agentNodeId).metadata.agent.lastCols,
      67,
      'Expected ignored resize requests not to mutate the seeded agent dimensions while only history projection is available.'
    );
    assert.strictEqual(
      findNodeById(snapshot, agentNodeId).metadata.agent.lastRows,
      22,
      'Expected ignored resize requests not to mutate the seeded agent dimensions while only history projection is available.'
    );
    assert.strictEqual(
      findNodeById(snapshot, terminalNodeId).metadata.terminal.lastCols,
      68,
      'Expected ignored resize requests not to mutate the seeded terminal dimensions while only history projection is available.'
    );
    assert.strictEqual(
      findNodeById(snapshot, terminalNodeId).metadata.terminal.lastRows,
      23,
      'Expected ignored resize requests not to mutate the seeded terminal dimensions while only history projection is available.'
    );
  } finally {
    if (baselineSnapshot) {
      const restoredBaselineSnapshot = await setPersistedState(baselineSnapshot.state);
      assert.strictEqual(
        restoredBaselineSnapshot.state.nodes.length,
        baselineSnapshot.state.nodes.length,
        'Expected restoring the baseline persisted state to recover the original runtime projection after the untrusted reconnect scenario.'
      );
    }
    await setRuntimePersistenceEnabled(false);
  }
}

async function verifyRestrictedRuntimePersistenceRequiresReloadAndClearsState() {
  const configuration = vscode.workspace.getConfiguration();
  const originalDefaultSurface =
    configuration.get('devSessionCanvas.canvas.defaultSurface', 'panel') === 'editor' ? 'editor' : 'panel';
  const runtimeResetSurface = 'panel';

  if (originalDefaultSurface !== runtimeResetSurface) {
    await setDefaultSurface(runtimeResetSurface);
  }
  await setRuntimePersistenceEnabled(true);

  try {
    await vscode.commands.executeCommand(COMMAND_IDS.testResetState);
    let snapshot = await simulateRuntimeReload();
    assert.strictEqual(snapshot.state.nodes.length, 0);
    assert.strictEqual(snapshot.sidebar.configuredSurface, runtimeResetSurface);

    await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInEditor);
    await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'editor', 20000);
    snapshot = await getDebugSnapshot();
    assert.strictEqual(snapshot.activeSurface, 'editor');
    assert.strictEqual(snapshot.sidebar.configuredSurface, runtimeResetSurface);

    await vscode.commands.executeCommand(COMMAND_IDS.testCreateNode, 'agent');
    await vscode.commands.executeCommand(COMMAND_IDS.testCreateNode, 'terminal');
    snapshot = await waitForSnapshot(
      (currentSnapshot) =>
        currentSnapshot.state.nodes.filter((node) => node.kind === 'agent').length === 1 &&
        currentSnapshot.state.nodes.filter((node) => node.kind === 'terminal').length === 1,
      20000
    );

    const agentNode = findNodeByKind(snapshot, 'agent');
    const terminalNode = findNodeByKind(snapshot, 'terminal');

    await startExecutionSessionForTest({
      kind: 'agent',
      nodeId: agentNode.id,
      cols: 88,
      rows: 26,
      provider: 'codex'
    });
    await startExecutionSessionForTest({
      kind: 'terminal',
      nodeId: terminalNode.id,
      cols: 88,
      rows: 26
    });

    await waitForRuntimeSupervisorState(
      (runtimeSupervisorState) => listLiveRuntimeSupervisorSessions(runtimeSupervisorState).length === 2,
      20000
    );

    await setRuntimePersistenceEnabled(false);

    await vscode.commands.executeCommand(COMMAND_IDS.testCreateNode, 'terminal');
    snapshot = await waitForSnapshot(
      (currentSnapshot) => currentSnapshot.state.nodes.filter((node) => node.kind === 'terminal').length === 2,
      20000
    );
    const extraTerminalNode = snapshot.state.nodes.find(
      (node) => node.kind === 'terminal' && node.id !== terminalNode.id
    );
    assert.ok(extraTerminalNode, 'Expected a second restricted terminal node before reload.');

    await startExecutionSessionForTest({
      kind: 'terminal',
      nodeId: extraTerminalNode.id,
      cols: 88,
      rows: 26
    });

    snapshot = await waitForSnapshot((currentSnapshot) => {
      const currentTerminalNode = currentSnapshot.state.nodes.find((node) => node.id === extraTerminalNode.id);
      return Boolean(
        currentTerminalNode?.metadata?.terminal?.liveSession &&
        currentTerminalNode?.metadata?.terminal?.persistenceMode === 'live-runtime'
      );
    }, 20000);

    const currentAgentNode = findNodeById(snapshot, agentNode.id);
    const currentTerminalNode = findNodeById(snapshot, terminalNode.id);
    const currentExtraTerminalNode = findNodeById(snapshot, extraTerminalNode.id);
    const expectedRuntimeSessionIds = [
      currentAgentNode.metadata.agent.runtimeSessionId,
      currentTerminalNode.metadata.terminal.runtimeSessionId,
      currentExtraTerminalNode.metadata.terminal.runtimeSessionId
    ];
    assert.ok(expectedRuntimeSessionIds.every(Boolean), 'Expected restricted live-runtime nodes to have runtimeSessionId.');

    await waitForRuntimeSupervisorState(
      (runtimeSupervisorState) => {
        const liveSessionIds = listLiveRuntimeSupervisorSessions(runtimeSupervisorState).map((session) => session.sessionId);
        return expectedRuntimeSessionIds.every((sessionId) => liveSessionIds.includes(sessionId));
      },
      20000
    );

    await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInEditor);
    await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'editor', 20000);
    snapshot = await getDebugSnapshot();
    assert.strictEqual(snapshot.activeSurface, 'editor');
    assert.strictEqual(snapshot.sidebar.configuredSurface, runtimeResetSurface);

    snapshot = await simulateRuntimeReload();
    assert.strictEqual(snapshot.state.nodes.length, 0);
    assert.strictEqual(snapshot.activeSurface, runtimeResetSurface);
    assert.strictEqual(snapshot.sidebar.configuredSurface, runtimeResetSurface);
    assert.strictEqual(snapshot.sidebar.surfaceLocation, runtimeResetSurface);

    const runtimeSupervisorState = await waitForRuntimeSupervisorState(
      (currentState) => {
        const sessionIds = listRuntimeSupervisorSessions(currentState).map((session) => session.sessionId);
        return (
          currentState.bindings.length === 0 &&
          expectedRuntimeSessionIds.every((sessionId) => !sessionIds.includes(sessionId))
        );
      },
      20000
    );
    const remainingSessionIds = listRuntimeSupervisorSessions(runtimeSupervisorState).map((session) => session.sessionId);
    assert.ok(expectedRuntimeSessionIds.every((sessionId) => !remainingSessionIds.includes(sessionId)));
  } finally {
    await setRuntimePersistenceEnabled(false);
    if (originalDefaultSurface !== runtimeResetSurface) {
      await setDefaultSurface(originalDefaultSurface);
      await simulateRuntimeReload();
    }
  }
}

async function verifyRestrictedDeleteCleansHistoryOnlyLiveRuntime(agentNodeId, terminalNodeId) {
  await setRuntimePersistenceEnabled(true);

  try {
    await startExecutionSessionForTest({
      kind: 'agent',
      nodeId: agentNodeId,
      cols: 88,
      rows: 26,
      provider: 'codex'
    });
    await startExecutionSessionForTest({
      kind: 'terminal',
      nodeId: terminalNodeId,
      cols: 88,
      rows: 26
    });

    await waitForRuntimeSupervisorState(
      (runtimeSupervisorState) => listLiveRuntimeSupervisorSessions(runtimeSupervisorState).length === 2,
      20000
    );

    let snapshot = await simulateRuntimeReload();
    let agentNode = findNodeById(snapshot, agentNodeId);
    let terminalNode = findNodeById(snapshot, terminalNodeId);
    assert.strictEqual(agentNode.status, 'history-restored');
    assert.strictEqual(agentNode.metadata.agent.attachmentState, 'reattaching');
    assert.strictEqual(terminalNode.status, 'history-restored');
    assert.strictEqual(terminalNode.metadata.terminal.attachmentState, 'reattaching');

    const agentRuntimeSessionId = agentNode.metadata.agent.runtimeSessionId;
    const terminalRuntimeSessionId = terminalNode.metadata.terminal.runtimeSessionId;
    assert.ok(agentRuntimeSessionId);
    assert.ok(terminalRuntimeSessionId);

    await performWebviewDomAction({
      kind: 'clickNodeActionButton',
      nodeId: agentNodeId,
      action: 'delete'
    });

    snapshot = await waitForSnapshot(
      (currentSnapshot) => !currentSnapshot.state.nodes.some((node) => node.id === agentNodeId),
      20000
    );
    assert.ok(snapshot.state.nodes.some((node) => node.id === terminalNodeId));

    let runtimeSupervisorState = await waitForRuntimeSupervisorState((currentState) => {
      const sessionIds = listRuntimeSupervisorSessions(currentState).map((session) => session.sessionId);
      const liveSessionIds = listLiveRuntimeSupervisorSessions(currentState).map((session) => session.sessionId);
      return (
        liveSessionIds.length === 1 &&
        !sessionIds.includes(agentRuntimeSessionId) &&
        liveSessionIds.includes(terminalRuntimeSessionId) &&
        currentState.bindings.length === 0
      );
    }, 20000);
    assert.strictEqual(listLiveRuntimeSupervisorSessions(runtimeSupervisorState).length, 1);

    await performWebviewDomAction({
      kind: 'clickNodeActionButton',
      nodeId: terminalNodeId,
      action: 'delete'
    });

    snapshot = await waitForSnapshot(
      (currentSnapshot) => !currentSnapshot.state.nodes.some((node) => node.id === terminalNodeId),
      20000
    );
    assert.strictEqual(snapshot.state.nodes.some((node) => node.id === terminalNodeId), false);

    runtimeSupervisorState = await waitForRuntimeSupervisorState(
      (currentState) => {
        const sessionIds = listRuntimeSupervisorSessions(currentState).map((session) => session.sessionId);
        return (
          listLiveRuntimeSupervisorSessions(currentState).length === 0 &&
          currentState.bindings.length === 0 &&
          !sessionIds.includes(agentRuntimeSessionId) &&
          !sessionIds.includes(terminalRuntimeSessionId)
        );
      },
      20000
    );
    const remainingSessionIds = listRuntimeSupervisorSessions(runtimeSupervisorState).map((session) => session.sessionId);
    assert.strictEqual(remainingSessionIds.includes(agentRuntimeSessionId), false);
    assert.strictEqual(remainingSessionIds.includes(terminalRuntimeSessionId), false);
  } finally {
    await setRuntimePersistenceEnabled(false);
  }
}

async function verifyRealDeleteButton(noteNodeId) {
  await performWebviewDomAction({
    kind: 'clickNodeActionButton',
    nodeId: noteNodeId,
    action: 'delete'
  });

  const snapshot = await waitForSnapshot(
    (currentSnapshot) => currentSnapshot.state.nodes.some((node) => node.id === noteNodeId) === false
  );
  assert.strictEqual(snapshot.state.nodes.some((node) => node.id === noteNodeId), false);
}

async function verifyCodexSessionIdLocator() {
  const matchingHomeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dev-session-canvas-codex-locator-'));
  try {
    const matchingStartedAtMs = Date.now();
    const expectedSessionId = '11111111-1111-4111-8111-111111111111';
    const matchingCwd = '/tmp/dev-session-canvas-codex-match';

    await writeCodexRolloutSessionMeta({
      homeDir: matchingHomeDir,
      sessionId: expectedSessionId,
      cwd: matchingCwd,
      timestampMs: matchingStartedAtMs
    });

    const detectedSessionId = await locateCodexSessionIdForTest({
      cwd: matchingCwd,
      startedAtMs: matchingStartedAtMs,
      homeDir: matchingHomeDir,
      timeoutMs: 800
    });
    assert.strictEqual(detectedSessionId, expectedSessionId);

    const missedSessionId = await locateCodexSessionIdForTest({
      cwd: '/tmp/dev-session-canvas-codex-miss',
      startedAtMs: matchingStartedAtMs,
      homeDir: matchingHomeDir,
      timeoutMs: 450
    });
    assert.strictEqual(missedSessionId, null);
  } finally {
    await fs.rm(matchingHomeDir, { recursive: true, force: true });
  }

  const ambiguousHomeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dev-session-canvas-codex-locator-'));
  try {
    const ambiguousStartedAtMs = Date.now();
    const ambiguousCwd = '/tmp/dev-session-canvas-codex-ambiguous';

    await writeCodexRolloutSessionMeta({
      homeDir: ambiguousHomeDir,
      sessionId: '22222222-2222-4222-8222-222222222222',
      cwd: ambiguousCwd,
      timestampMs: ambiguousStartedAtMs
    });
    await writeCodexRolloutSessionMeta({
      homeDir: ambiguousHomeDir,
      sessionId: '33333333-3333-4333-8333-333333333333',
      cwd: ambiguousCwd,
      timestampMs: ambiguousStartedAtMs + 5,
      fileSuffix: 'second'
    });

    const ambiguousSessionId = await locateCodexSessionIdForTest({
      cwd: ambiguousCwd,
      startedAtMs: ambiguousStartedAtMs,
      homeDir: ambiguousHomeDir,
      timeoutMs: 450
    });
    assert.strictEqual(ambiguousSessionId, null);
  } finally {
    await fs.rm(ambiguousHomeDir, { recursive: true, force: true });
  }
}

async function verifyClaudeSessionIdLocator() {
  const matchingHomeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dev-session-canvas-claude-locator-'));
  try {
    const matchingCwd = '/tmp/dev-session-canvas-claude-match';
    const expectedSessionId = '44444444-4444-4444-8444-444444444444';
    const delayedWrite = sleep(180).then(() =>
      writeClaudeProjectSessionFile({
        homeDir: matchingHomeDir,
        sessionId: expectedSessionId,
        cwd: matchingCwd
      })
    );

    const detectedSessionId = await locateClaudeSessionIdForTest({
      cwd: matchingCwd,
      sessionId: expectedSessionId,
      homeDir: matchingHomeDir,
      timeoutMs: 800
    });
    await delayedWrite;
    assert.strictEqual(detectedSessionId, expectedSessionId);

    const missedSessionId = await locateClaudeSessionIdForTest({
      cwd: '/tmp/dev-session-canvas-claude-miss',
      sessionId: '55555555-5555-4555-8555-555555555555',
      homeDir: matchingHomeDir,
      timeoutMs: 450
    });
    assert.strictEqual(missedSessionId, null);
  } finally {
    await fs.rm(matchingHomeDir, { recursive: true, force: true });
  }
}

async function verifyCodexResumeCommandHintParser() {
  const output = [
    '>_ OpenAI Codex (v0.122.0)',
    '',
    'Tip: New Build faster with Codex.',
    'To continue this session, run codex resume 019dbfb8-cffa-70b0-9c97-cfd69d2f4b16',
    'ziyang01.wang-al@hobot:~/projects/dev-session-canvas$'
  ].join('\n');

  const detectedSessionId = await extractCodexResumeSessionIdForTest(output);
  assert.strictEqual(detectedSessionId, '019dbfb8-cffa-70b0-9c97-cfd69d2f4b16');

  const missedSessionId = await extractCodexResumeSessionIdForTest('Codex ended without a resume hint.');
  assert.strictEqual(missedSessionId, null);
}

async function verifyClaudeResumeCommandHintParser() {
  const output = [
    'Claude Code',
    '',
    'Resume this session with:',
    '  claude --resume b654f7db-1ae3-4f6d-b84d-9b4b110f3e5a',
    ''
  ].join('\n');

  const detectedSessionId = await extractClaudeResumeSessionIdForTest(output);
  assert.strictEqual(detectedSessionId, 'b654f7db-1ae3-4f6d-b84d-9b4b110f3e5a');

  const missedSessionId = await extractClaudeResumeSessionIdForTest('Claude ended without a resume hint.');
  assert.strictEqual(missedSessionId, null);
}

async function verifyAgentCliCacheIsolation() {
  const workspaceA = await fs.mkdtemp(path.join(os.tmpdir(), 'dev-session-canvas-cli-cache-a-'));
  const workspaceB = await fs.mkdtemp(path.join(os.tmpdir(), 'dev-session-canvas-cli-cache-b-'));

  try {
    const relativeKeyA = await getAgentCliResolutionCacheKeyForTest({
      provider: 'codex',
      requestedCommand: './tools/codex-wrapper',
      workspaceCwd: workspaceA
    });
    const relativeKeyB = await getAgentCliResolutionCacheKeyForTest({
      provider: 'codex',
      requestedCommand: './tools/codex-wrapper',
      workspaceCwd: workspaceB
    });
    const absoluteKeyA = await getAgentCliResolutionCacheKeyForTest({
      provider: 'codex',
      requestedCommand: 'codex',
      workspaceCwd: workspaceA
    });
    const absoluteKeyB = await getAgentCliResolutionCacheKeyForTest({
      provider: 'codex',
      requestedCommand: 'codex',
      workspaceCwd: workspaceB
    });
    const shellAuthorityKeyA = await getAgentCliResolutionCacheKeyForTest({
      provider: 'codex',
      requestedCommand: 'codex',
      workspaceCwd: workspaceA,
      shellAuthority: '/bin/zsh'
    });
    const shellAuthorityKeyB = await getAgentCliResolutionCacheKeyForTest({
      provider: 'codex',
      requestedCommand: 'codex',
      workspaceCwd: workspaceA,
      shellAuthority: '/bin/bash'
    });
    const relativeShellAuthorityKeyA = await getAgentCliResolutionCacheKeyForTest({
      provider: 'codex',
      requestedCommand: 'codex',
      workspaceCwd: workspaceA,
      shellAuthority: './shell-wrapper'
    });
    const relativeShellAuthorityKeyB = await getAgentCliResolutionCacheKeyForTest({
      provider: 'codex',
      requestedCommand: 'codex',
      workspaceCwd: workspaceB,
      shellAuthority: './shell-wrapper'
    });

    assert.notStrictEqual(relativeKeyA, relativeKeyB);
    assert.notStrictEqual(absoluteKeyA, absoluteKeyB);
    assert.notStrictEqual(shellAuthorityKeyA, shellAuthorityKeyB);
    assert.notStrictEqual(relativeShellAuthorityKeyA, relativeShellAuthorityKeyB);
  } finally {
    await fs.rm(workspaceA, { recursive: true, force: true });
    await fs.rm(workspaceB, { recursive: true, force: true });
  }
}

async function getDebugSnapshot() {
  return vscode.commands.executeCommand(COMMAND_IDS.testGetDebugState);
}

async function getSidebarSummaryItems() {
  return vscode.commands.executeCommand(COMMAND_IDS.testGetSidebarSummaryItems);
}

async function getSidebarNodeListItems() {
  return vscode.commands.executeCommand(COMMAND_IDS.testGetSidebarNodeListItems);
}

async function getSidebarSessionHistoryItems(homeDir) {
  return vscode.commands.executeCommand(COMMAND_IDS.testGetSidebarSessionHistoryItems, homeDir);
}

async function getRuntimeSupervisorState() {
  return vscode.commands.executeCommand(COMMAND_IDS.testGetRuntimeSupervisorState);
}

async function getHostMessages() {
  return vscode.commands.executeCommand(COMMAND_IDS.testGetHostMessages);
}

async function getDiagnosticEvents() {
  return vscode.commands.executeCommand(COMMAND_IDS.testGetDiagnosticEvents);
}

async function readInternalNoteMarkdownDraftContent(draftId) {
  return fs.readFile(
    path.join(await readInternalExtensionStorageWritePath(), 'note-markdown-drafts', `${draftId}.md`),
    'utf8'
  );
}

async function flushPersistedStateSnapshot() {
  const flushResult = await vscode.commands.executeCommand(COMMAND_IDS.testFlushPersistedState);
  assert.ok(flushResult?.exists, 'Expected flushPersistedState to write a persisted canvas snapshot.');
  assert.ok(flushResult.snapshot?.state, 'Expected flushPersistedState to return a canvas snapshot.');
  return flushResult.snapshot;
}

async function readInternalExtensionStorageWritePath() {
  const diagnosticEvents = await getDiagnosticEvents();
  const latestStorageEvent = [...diagnosticEvents]
    .reverse()
    .find((event) => typeof event.detail?.writePath === 'string');
  assert.ok(latestStorageEvent, 'Expected diagnostics to expose the extension storage write path.');
  return latestStorageEvent.detail.writePath;
}

async function locateCodexSessionIdForTest({ cwd, startedAtMs, homeDir, timeoutMs }) {
  return vscode.commands.executeCommand(
    COMMAND_IDS.testLocateCodexSessionId,
    cwd,
    startedAtMs,
    homeDir,
    timeoutMs
  );
}

async function locateClaudeSessionIdForTest({ cwd, sessionId, homeDir, timeoutMs }) {
  return vscode.commands.executeCommand(
    COMMAND_IDS.testLocateClaudeSessionId,
    cwd,
    sessionId,
    homeDir,
    timeoutMs
  );
}

async function extractCodexResumeSessionIdForTest(output) {
  return vscode.commands.executeCommand(COMMAND_IDS.testExtractCodexResumeSessionId, output);
}

async function extractClaudeResumeSessionIdForTest(output) {
  return vscode.commands.executeCommand(COMMAND_IDS.testExtractClaudeResumeSessionId, output);
}

async function getAgentCliResolutionCacheKeyForTest({ provider, requestedCommand, workspaceCwd, shellAuthority }) {
  return vscode.commands.executeCommand(
    COMMAND_IDS.testGetAgentCliResolutionCacheKey,
    provider,
    requestedCommand,
    workspaceCwd,
    shellAuthority
  );
}

async function clearHostMessages() {
  await vscode.commands.executeCommand(COMMAND_IDS.testClearHostMessages);
}

async function clearDiagnosticEvents() {
  await vscode.commands.executeCommand(COMMAND_IDS.testClearDiagnosticEvents);
}

function findSidebarSummaryItem(items, id) {
  const item = Array.isArray(items) ? items.find((entry) => entry && entry.id === id) : undefined;
  assert.ok(item, `sidebar summary item not found: ${id}`);
  return item;
}

async function setQuickPickSelections(selectionIds) {
  return vscode.commands.executeCommand(COMMAND_IDS.testSetQuickPickSelections, selectionIds);
}

async function reloadPersistedState() {
  return vscode.commands.executeCommand(COMMAND_IDS.testReloadPersistedState);
}

async function setPersistedState(rawState) {
  return vscode.commands.executeCommand(COMMAND_IDS.testSetPersistedState, rawState);
}

async function writeCodexSessionFile({ homeDir, sessionId, cwd, timestampMs, fileSuffix, userMessages = [] }) {
  const [year, month, day] = toDateDirectoryParts(timestampMs);
  const sessionsDir = path.join(homeDir, '.codex', 'sessions', year, month, day);
  await fs.mkdir(sessionsDir, { recursive: true });

  const timestamp = new Date(timestampMs).toISOString();
  const payload = {
    timestamp,
    type: 'session_meta',
    payload: {
      id: sessionId,
      timestamp,
      cwd,
      originator: 'sidebar-session-history-smoke'
    }
  };

  const lines = [JSON.stringify(payload)];
  for (const message of userMessages) {
    lines.push(
      JSON.stringify({
        timestamp,
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: message
            }
          ]
        }
      })
    );
  }

  const filePath = path.join(sessionsDir, `rollout-${sessionId}-${fileSuffix}.jsonl`);
  await fs.writeFile(filePath, `${lines.join('\n')}\n`, 'utf8');
  return filePath;
}

async function seedClaudeSessionTranscriptFile(sessionId) {
  const workspaceCwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
  const projectDirectoryName = workspaceCwd.replace(/[^a-zA-Z0-9]+/g, '-');
  const transcriptDirectory = path.join(os.homedir(), '.claude', 'projects', projectDirectoryName);
  const transcriptFilePath = path.join(transcriptDirectory, `${sessionId}.jsonl`);

  await fs.mkdir(transcriptDirectory, { recursive: true });
  await fs.writeFile(transcriptFilePath, '{}\n', 'utf8');
  return transcriptFilePath;
}

function toDateDirectoryParts(timestampMs) {
  const date = new Date(timestampMs);
  return [
    String(date.getFullYear()),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ];
}

async function simulateRuntimeReload() {
  return vscode.commands.executeCommand(COMMAND_IDS.testSimulateRuntimeReload);
}

async function captureWebviewProbe(surface, timeoutMs, delayMs = 0) {
  const probe = await vscode.commands.executeCommand(
    COMMAND_IDS.testCaptureWebviewProbe,
    surface,
    timeoutMs,
    delayMs
  );
  lastWebviewProbe = probe;
  await persistLastWebviewProbe();
  return probe;
}

async function ensureEditorCanvasReady() {
  await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInEditor);
  await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'editor', 20000);
  return getDebugSnapshot();
}

async function ensureFilesFeatureEnabledForSmoke(surface = 'panel') {
  const configuredFilesEnabled =
    vscode.workspace.getConfiguration().get('devSessionCanvas.files.enabled', false) === true;
  if (!configuredFilesEnabled) {
    await setFilesFeatureEnabled(true);
  }

  let snapshot = await getDebugSnapshot();
  if (!snapshot.sidebar.filesFeatureEnabled) {
    snapshot = await simulateRuntimeReload();
  }

  if (surface === 'editor') {
    await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInEditor);
  } else {
    await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInPanel);
  }
  await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, surface, 20000);

  snapshot = await getDebugSnapshot();
  assert.strictEqual(
    snapshot.sidebar.filesFeatureEnabled,
    true,
    'Expected files feature to be enabled before exercising file-activity smoke coverage.'
  );
  return snapshot;
}

async function performWebviewDomAction(action, surface = 'editor', timeoutMs = 5000) {
  return vscode.commands.executeCommand(
    COMMAND_IDS.testPerformWebviewDomAction,
    action,
    surface,
    timeoutMs
  );
}

async function performSidebarNodeListAction(action, timeoutMs = 5000) {
  return vscode.commands.executeCommand(
    COMMAND_IDS.testPerformSidebarNodeListAction,
    action,
    timeoutMs
  );
}

async function performSidebarSessionHistoryAction(action, timeoutMs = 5000) {
  return vscode.commands.executeCommand(
    COMMAND_IDS.testPerformSidebarSessionHistoryAction,
    action,
    timeoutMs
  );
}

async function dispatchWebviewMessage(message, surface) {
  return vscode.commands.executeCommand(COMMAND_IDS.testDispatchWebviewMessage, message, surface);
}

async function startExecutionSessionForTest({
  kind,
  nodeId,
  cols,
  rows,
  provider,
  resumeRequested = false,
  injectAgentOutputChunk,
  injectAgentOutputChunks,
  injectAgentExistingOutput,
  cwdOverride
}) {
  return vscode.commands.executeCommand(
    COMMAND_IDS.testStartExecutionSession,
    kind,
    nodeId,
    cols,
    rows,
    provider,
    resumeRequested,
    injectAgentOutputChunk || injectAgentOutputChunks || injectAgentExistingOutput
      ? { injectAgentOutputChunk, injectAgentOutputChunks, injectAgentExistingOutput, cwdOverride }
      : cwdOverride
        ? { cwdOverride }
      : undefined
  );
}

async function setRuntimePersistenceEnabled(enabled) {
  await vscode.workspace
    .getConfiguration()
    .update('devSessionCanvas.runtimePersistence.enabled', enabled, vscode.ConfigurationTarget.Global);
}

async function setDefaultSurface(surface) {
  await vscode.workspace
    .getConfiguration()
    .update('devSessionCanvas.canvas.defaultSurface', surface, vscode.ConfigurationTarget.Global);
}

async function setDefaultAgentProvider(provider) {
  await vscode.workspace
    .getConfiguration()
    .update('devSessionCanvas.agent.defaultProvider', provider, vscode.ConfigurationTarget.Global);
}

function normalizeTerminalShellSelection(value) {
  switch (value) {
    case 'bash':
    case 'zsh':
    case 'fish':
    case 'sh':
    case 'pwsh':
    case 'powershell':
    case 'cmd':
      return value;
    default:
      return 'default';
  }
}

async function resolveAlternateTerminalShellPath(currentShellPath) {
  const normalizedCurrentShellPath = normalizeShellPath(currentShellPath);
  const availableShellPaths = await listAvailableTerminalShellPaths();
  const alternateShellPath = availableShellPaths.find((candidatePath) => {
    return normalizeShellPath(candidatePath) !== normalizedCurrentShellPath;
  });

  if (!alternateShellPath) {
    throw new Error(`未找到与当前 shell 不同的可用候选：${currentShellPath || '<empty>'}`);
  }

  return alternateShellPath;
}

async function listAvailableTerminalShellPaths() {
  const candidates = process.platform === 'win32'
    ? [
        vscode.env.shell,
        process.env.ComSpec,
        process.env.COMSPEC,
        'pwsh.exe',
        'powershell.exe',
        'cmd.exe',
        'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
        'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
        'C:\\Windows\\System32\\cmd.exe'
      ]
    : [
        vscode.env.shell,
        process.env.SHELL,
        '/bin/sh',
        '/bin/bash',
        '/usr/bin/bash',
        '/bin/zsh',
        '/usr/bin/zsh',
        '/bin/fish',
        '/usr/bin/fish'
      ];

  const resolvedCandidates = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const resolvedCandidate = await resolveAvailableShellPath(candidate);
    if (!resolvedCandidate) {
      continue;
    }

    const normalizedCandidate = normalizeShellPath(resolvedCandidate);
    if (seen.has(normalizedCandidate)) {
      continue;
    }

    seen.add(normalizedCandidate);
    resolvedCandidates.push(resolvedCandidate);
  }

  return resolvedCandidates;
}

function normalizeShellPath(shellPath) {
  return process.platform === 'win32'
    ? String(shellPath || '').trim().toLowerCase()
    : String(shellPath || '').trim();
}

async function resolveAvailableShellPath(candidate) {
  const trimmedCandidate = String(candidate || '').trim();
  if (!trimmedCandidate) {
    return undefined;
  }

  if (path.isAbsolute(trimmedCandidate) || trimmedCandidate.includes(path.sep)) {
    return (await hasExecutableShellPath(trimmedCandidate)) ? trimmedCandidate : undefined;
  }

  const pathEntries = String(process.env.PATH || '')
    .split(path.delimiter)
    .filter(Boolean);
  const commandCandidates =
    process.platform === 'win32' && !path.extname(trimmedCandidate)
      ? [trimmedCandidate, `${trimmedCandidate}.exe`, `${trimmedCandidate}.cmd`, `${trimmedCandidate}.bat`]
      : [trimmedCandidate];

  for (const directory of pathEntries) {
    for (const commandCandidate of commandCandidates) {
      const candidatePath = path.join(directory, commandCandidate);
      if (await hasExecutableShellPath(candidatePath)) {
        return candidatePath;
      }
    }
  }

  return undefined;
}

async function hasExecutableShellPath(candidatePath) {
  try {
    await fs.access(candidatePath, process.platform === 'win32' ? fsSync.constants.F_OK : fsSync.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function createFakeExecutableShell(candidatePath) {
  await fs.writeFile(candidatePath, process.platform === 'win32' ? '@echo off\r\n' : '#!/bin/sh\nexit 0\n', 'utf8');
  if (process.platform !== 'win32') {
    await fs.chmod(candidatePath, 0o755);
  }
}

function hasWorkspaceSettingsTarget() {
  return Boolean(vscode.workspace.workspaceFile || (vscode.workspace.workspaceFolders?.length ?? 0) > 0);
}

function resolvePreferredTerminalShellSettingsTarget() {
  return hasWorkspaceSettingsTarget()
    ? vscode.ConfigurationTarget.Workspace
    : vscode.ConfigurationTarget.Global;
}

function getWorkspaceScopedConfigurationValue(inspection) {
  return typeof inspection?.workspaceFolderValue !== 'undefined'
    ? inspection.workspaceFolderValue
    : inspection?.workspaceValue;
}

async function restoreTerminalShellSetting(settingKey, inspection) {
  const configuration = vscode.workspace.getConfiguration();
  await configuration.update(settingKey, inspection?.globalValue, vscode.ConfigurationTarget.Global);
  if (hasWorkspaceSettingsTarget()) {
    await configuration.update(
      settingKey,
      getWorkspaceScopedConfigurationValue(inspection),
      vscode.ConfigurationTarget.Workspace
    );
  }
}

async function setTerminalShell(selection, target = vscode.ConfigurationTarget.Global) {
  await vscode.workspace
    .getConfiguration()
    .update('devSessionCanvas.terminal.shell', selection, target);
}

async function setTerminalShellPath(shellPath, target = vscode.ConfigurationTarget.Global) {
  await vscode.workspace
    .getConfiguration()
    .update('devSessionCanvas.terminal.shellPath', shellPath, target);
}

async function setAgentDefaultArgs(provider, defaultArgs) {
  await vscode.workspace
    .getConfiguration()
    .update(
      provider === 'claude' ? 'devSessionCanvas.agent.claudeDefaultArgs' : 'devSessionCanvas.agent.codexDefaultArgs',
      defaultArgs,
      vscode.ConfigurationTarget.Global
    );
}

async function ensureAttentionNotificationBridgeMode(mode) {
  const configuration = vscode.workspace.getConfiguration();
  const currentMode = normalizeAttentionNotificationBridgeMode(
    configuration.get('devSessionCanvas.notifications.attentionSignalBridge', 'system')
  );

  if (currentMode === mode) {
    return;
  }

  await clearDiagnosticEvents();
  await configuration.update(
    'devSessionCanvas.notifications.attentionSignalBridge',
    mode,
    vscode.ConfigurationTarget.Global
  );
  await waitForDiagnosticEvents(
    (events) =>
      events.some(
        (event) =>
          event.kind === 'execution/attentionNotificationBridgeConfigChanged' &&
          event.detail?.mode === mode
      ),
    20000
  );
}

function resolveSmokeUserSettingsPath() {
  if (!artifactDir) {
    throw new Error('缺少 DEV_SESSION_CANVAS_SMOKE_ARTIFACT_DIR，无法直接写入 smoke settings.json。');
  }

  return path.join(path.dirname(artifactDir), 'user-data', 'User', 'settings.json');
}

async function writeSmokeUserSettings(updates) {
  const settingsPath = resolveSmokeUserSettingsPath();
  const raw = await fs.readFile(settingsPath, 'utf8').catch(() => '{}');
  const settings = JSON.parse(raw);

  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) {
      delete settings[key];
      continue;
    }

    settings[key] = value;
  }

  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  await fs.writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
  await forceSmokeSettingsConfigurationRefresh(updates);
}

async function forceSmokeSettingsConfigurationRefresh(updates) {
  const bridgeSettingKey = 'devSessionCanvas.notifications.attentionSignalBridge';
  const configuration = vscode.workspace.getConfiguration();
  const desiredBridgeSetting = Object.prototype.hasOwnProperty.call(updates, bridgeSettingKey)
    ? updates[bridgeSettingKey]
    : undefined;

  // Legacy notification keys are intentionally absent from package.json, so
  // vscode.workspace.update rejects them. Toggle the registered v2 key after
  // writing settings.json to drive the same configuration-change path without
  // depending on file watchers in inotify-constrained smoke hosts.
  await configuration.update(bridgeSettingKey, 'none', vscode.ConfigurationTarget.Global);
  await configuration.update(bridgeSettingKey, desiredBridgeSetting, vscode.ConfigurationTarget.Global);
}

function normalizeAttentionNotificationBridgeMode(value) {
  if (value === 'none' || value === 'workbench' || value === 'system') {
    return value;
  }

  if (value === false) {
    return 'none';
  }

  if (value === true) {
    return 'workbench';
  }

  return 'system';
}

function normalizeEnabledAttentionSignals(value) {
  if (!Array.isArray(value)) {
    return [...DEFAULT_ATTENTION_SIGNALS];
  }

  const configuredSignals = new Set();
  for (const item of value) {
    if (DEFAULT_ATTENTION_SIGNALS.includes(item)) {
      configuredSignals.add(item);
    }
  }

  return DEFAULT_ATTENTION_SIGNALS.filter((signal) => configuredSignals.has(signal));
}

async function ensureEnabledAttentionSignals(signals) {
  const configuration = vscode.workspace.getConfiguration();
  const normalizedSignals = normalizeEnabledAttentionSignals(signals);
  const currentSignals = normalizeEnabledAttentionSignals(
    configuration.get('devSessionCanvas.notifications.enabledAttentionSignals', DEFAULT_ATTENTION_SIGNALS)
  );

  if (JSON.stringify(currentSignals) === JSON.stringify(normalizedSignals)) {
    return;
  }

  await clearDiagnosticEvents();
  await configuration.update(
    'devSessionCanvas.notifications.enabledAttentionSignals',
    normalizedSignals,
    vscode.ConfigurationTarget.Global
  );
  await waitForDiagnosticEvents(
    (events) =>
      events.some(
        (event) =>
          event.kind === 'execution/enabledAttentionSignalsConfigChanged' &&
          JSON.stringify(event.detail?.enabledSignals) === JSON.stringify(normalizedSignals)
      ),
    20000
  );
}

function normalizeAgentAbnormalOutputTextNotificationMode(value) {
  return value === 'codex' ? 'codex' : 'off';
}

async function ensureAgentAbnormalOutputTextNotificationMode(mode) {
  const configuration = vscode.workspace.getConfiguration();
  const normalizedMode = normalizeAgentAbnormalOutputTextNotificationMode(mode);
  const currentMode = normalizeAgentAbnormalOutputTextNotificationMode(
    configuration.get('devSessionCanvas.notifications.agentAbnormalOutputTextNotifications', 'off')
  );

  if (currentMode === normalizedMode) {
    return;
  }

  await clearDiagnosticEvents();
  await configuration.update(
    'devSessionCanvas.notifications.agentAbnormalOutputTextNotifications',
    normalizedMode,
    vscode.ConfigurationTarget.Global
  );
  await waitForDiagnosticEvents(
    (events) =>
      events.some(
        (event) =>
          event.kind === 'execution/agentAbnormalOutputTextNotificationsConfigChanged' &&
          event.detail?.mode === normalizedMode &&
          event.detail?.enabled === (normalizedMode !== 'off')
      ),
    20000
  );
}

function normalizeStrongTerminalAttentionReminderMode(value) {
  if (value === 'none' || value === 'titleBar' || value === 'minimap' || value === 'both') {
    return value;
  }

  if (value === false) {
    return 'none';
  }

  if (value === true) {
    return 'both';
  }

  return 'both';
}

function strongTerminalAttentionReminderModeEnablesTitleBar(mode) {
  return mode === 'titleBar' || mode === 'both';
}

function strongTerminalAttentionReminderModeEnablesMinimap(mode) {
  return mode === 'minimap' || mode === 'both';
}

async function ensureStrongTerminalAttentionReminderMode(mode) {
  const configuration = vscode.workspace.getConfiguration();
  const normalizedMode = normalizeStrongTerminalAttentionReminderMode(mode);
  const currentMode = normalizeStrongTerminalAttentionReminderMode(
    configuration.get('devSessionCanvas.notifications.strongTerminalAttentionReminder', 'both')
  );

  if (currentMode === normalizedMode) {
    return;
  }

  await clearDiagnosticEvents();
  await configuration.update(
    'devSessionCanvas.notifications.strongTerminalAttentionReminder',
    normalizedMode,
    vscode.ConfigurationTarget.Global
  );
  await waitForDiagnosticEvents(
    (events) =>
      events.some(
        (event) =>
          event.kind === 'execution/attentionStrongReminderConfigChanged' &&
          event.detail?.mode === normalizedMode &&
          event.detail?.titleBarEnabled === strongTerminalAttentionReminderModeEnablesTitleBar(normalizedMode) &&
          event.detail?.minimapEnabled === strongTerminalAttentionReminderModeEnablesMinimap(normalizedMode)
      ),
    20000
  );
}

async function setFilesPresentationMode(mode) {
  await vscode.workspace
    .getConfiguration()
    .update('devSessionCanvas.files.presentationMode', mode, vscode.ConfigurationTarget.Global);
}

async function setFilesFeatureEnabled(enabled) {
  await vscode.workspace
    .getConfiguration()
    .update('devSessionCanvas.files.enabled', enabled, vscode.ConfigurationTarget.Global);
}

async function setFileNodeDisplayStyle(style) {
  await vscode.workspace
    .getConfiguration()
    .update('devSessionCanvas.fileNode.displayStyle', style, vscode.ConfigurationTarget.Global);
}

async function setFilesNodeDisplayMode(mode) {
  await vscode.workspace
    .getConfiguration()
    .update('devSessionCanvas.files.nodeDisplayMode', mode, vscode.ConfigurationTarget.Global);
}

async function setFilesPathDisplayMode(mode) {
  await vscode.workspace
    .getConfiguration()
    .update('devSessionCanvas.files.pathDisplayMode', mode, vscode.ConfigurationTarget.Global);
}

async function setFileIncludeFilterGlobs(globs) {
  await vscode.commands.executeCommand(COMMAND_IDS.editFileIncludeFilter, globs);
}

async function setFileExcludeFilterGlobs(globs) {
  await vscode.commands.executeCommand(COMMAND_IDS.editFileExcludeFilter, globs);
}

async function setTerminalIntegratedScrollback(scrollback) {
  await vscode.workspace
    .getConfiguration('terminal.integrated')
    .update('scrollback', scrollback, vscode.ConfigurationTarget.Global);
}

async function setWorkbenchColorTheme(themeName) {
  await vscode.workspace
    .getConfiguration('workbench')
    .update('colorTheme', themeName, vscode.ConfigurationTarget.Global);
}

async function setWorkbenchBrowserOpenLocalhostLinks(enabled) {
  await vscode.workspace
    .getConfiguration('workbench')
    .update('browser.openLocalhostLinks', enabled, vscode.ConfigurationTarget.Global);
}

async function requestExecutionSnapshot(kind, nodeId, surface) {
  return dispatchWebviewMessage(
    {
      type: 'webview/attachExecutionSession',
      payload: {
        kind,
        nodeId
      }
    },
    surface
  );
}

function createSerializedTerminalStateFixture(marker, outputSequence) {
  return {
    format: 'xterm-serialize-v1',
    data: `${marker}\r\n${marker} restored snapshot\r\n`,
    outputSequence
  };
}

async function waitForWebviewProbe(predicate, timeoutMs = 8000) {
  await assertInteractiveEditorSurface('waitForWebviewProbe');
  return waitForWebviewProbeOnSurface('editor', predicate, timeoutMs);
}

async function assertInteractiveEditorSurface(caller) {
  const snapshot = await getDebugSnapshot();
  assert.strictEqual(
    snapshot.activeSurface,
    'editor',
    `${caller} requires the editor surface to stay interactive; restore it with ensureEditorCanvasReady() after commands that reveal another surface.`
  );
  assert.strictEqual(
    snapshot.surfaceReady.editor,
    true,
    `${caller} requires the editor surface to be ready before probing the real Webview.`
  );
}

async function waitForWebviewProbeOnSurface(surface, predicate, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  let lastProbe;
  let lastProbeError;

  while (Date.now() < deadline) {
    try {
      const probeTimeoutMs = Math.min(5000, Math.max(500, deadline - Date.now()));
      lastProbe = await captureWebviewProbe(surface, probeTimeoutMs);
      lastProbeError = undefined;
      if (predicate(lastProbe)) {
        return lastProbe;
      }
    } catch (error) {
      if (!isWebviewProbeCaptureTimeout(error)) {
        throw error;
      }
      lastProbeError = error;
    }

    await sleep(100);
  }

  assert.fail(
    `Timed out while waiting for ${surface} webview probe. Last probe: ${JSON.stringify(lastProbe ?? null)}. Last probe error: ${lastProbeError ? formatError(lastProbeError) : '<none>'}`
  );
}

function isWebviewProbeCaptureTimeout(error) {
  return /Webview probe 返回超时/.test(formatError(error));
}

async function waitForSnapshot(predicate, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let lastSnapshot = await getDebugSnapshot();

  while (Date.now() < deadline) {
    if (predicate(lastSnapshot)) {
      return lastSnapshot;
    }

    await sleep(100);
    lastSnapshot = await getDebugSnapshot();
  }

  assert.fail(`Timed out while waiting for smoke test state. Last snapshot: ${JSON.stringify(lastSnapshot)}`);
}

async function waitForDiagnosticEvents(predicate, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  let lastEvents = await getDiagnosticEvents();

  while (Date.now() < deadline) {
    if (predicate(lastEvents)) {
      return lastEvents;
    }

    await sleep(100);
    lastEvents = await getDiagnosticEvents();
  }

  assert.fail(`Timed out while waiting for diagnostic events. Last events: ${JSON.stringify(lastEvents)}`);
}

function cloneJsonValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function terminalThemeMatches(actualTheme, expectedTheme) {
  return (
    normalizeColorValue(actualTheme?.background) === normalizeColorValue(expectedTheme.background) &&
    normalizeColorValue(actualTheme?.foreground) === normalizeColorValue(expectedTheme.foreground) &&
    normalizeColorValue(actualTheme?.ansiBlue) === normalizeColorValue(expectedTheme.ansiBlue)
  );
}

function assertTerminalThemeMatches(actualTheme, expectedTheme, label) {
  assert.ok(actualTheme, `Missing terminal theme snapshot for ${label}.`);
  assert.strictEqual(
    normalizeColorValue(actualTheme.background),
    normalizeColorValue(expectedTheme.background),
    `${label} background did not match.`
  );
  assert.strictEqual(
    normalizeColorValue(actualTheme.foreground),
    normalizeColorValue(expectedTheme.foreground),
    `${label} foreground did not match.`
  );
  assert.strictEqual(
    normalizeColorValue(actualTheme.ansiBlue),
    normalizeColorValue(expectedTheme.ansiBlue),
    `${label} ansiBlue did not match.`
  );
}

function normalizeColorValue(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : null;
}

function listRuntimeSupervisorSessions(runtimeSupervisorState) {
  const dedupedSessions = new Map();

  for (const registryState of Object.values(runtimeSupervisorState?.registries || {})) {
    const sessions = registryState?.registry?.sessions;
    if (!Array.isArray(sessions)) {
      continue;
    }

    for (const session of sessions) {
      if (session?.sessionId) {
        dedupedSessions.set(session.sessionId, session);
      }
    }
  }

  return Array.from(dedupedSessions.values());
}

function listLiveRuntimeSupervisorSessions(runtimeSupervisorState) {
  return listRuntimeSupervisorSessions(runtimeSupervisorState).filter((session) => session?.live === true);
}

async function waitForRuntimeSupervisorState(predicate, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let lastState = await getRuntimeSupervisorState();

  while (Date.now() < deadline) {
    if (predicate(lastState)) {
      return lastState;
    }

    await sleep(100);
    lastState = await getRuntimeSupervisorState();
  }

  assert.fail(`Timed out while waiting for runtime supervisor state. Last state: ${JSON.stringify(lastState)}`);
}

async function waitForHostMessages(predicate, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  let messages = await getHostMessages();

  while (Date.now() < deadline) {
    if (predicate(messages)) {
      return messages;
    }

    await sleep(100);
    messages = await getHostMessages();
  }

  assert.fail(`Timed out while waiting for host messages. Last messages: ${JSON.stringify(messages)}`);
}

async function waitForInterceptedInformationMessage(calls, predicate, assertionMessage, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const match = calls.find(predicate);
    if (match) {
      return match;
    }

    await sleep(100);
  }

  const messages = calls.map((call) => call.message);
  assert.fail(`${assertionMessage} Intercepted messages: ${JSON.stringify(messages)}`);
}

async function withInterceptedInformationMessages(runIntercepted, resolveSelection) {
  const originalShowInformationMessage = vscode.window.showInformationMessage;
  const calls = [];
  vscode.window.showInformationMessage = async (message, ...items) => {
    const call = { message, items, result: undefined };
    calls.push(call);
    const result = typeof resolveSelection === 'function'
      ? await resolveSelection({ message, items, calls })
      : undefined;
    call.result = result;
    return result;
  };

  assert.notStrictEqual(
    vscode.window.showInformationMessage,
    originalShowInformationMessage,
    'Failed to intercept vscode.window.showInformationMessage.'
  );

  try {
    return await runIntercepted(calls);
  } finally {
    vscode.window.showInformationMessage = originalShowInformationMessage;
  }
}

async function withInterceptedWarningMessages(runIntercepted, resolveSelection) {
  const originalShowWarningMessage = vscode.window.showWarningMessage;
  const calls = [];

  vscode.window.showWarningMessage = async (message, ...args) => {
    const options = args.length > 0 && isMessageOptions(args[0]) ? args[0] : undefined;
    const items = options ? args.slice(1) : args;
    calls.push({ message, options, items });
    return typeof resolveSelection === 'function'
      ? await resolveSelection({ message, options, items, calls })
      : undefined;
  };

  assert.notStrictEqual(
    vscode.window.showWarningMessage,
    originalShowWarningMessage,
    'Failed to intercept vscode.window.showWarningMessage.'
  );

  try {
    return await runIntercepted(calls);
  } finally {
    vscode.window.showWarningMessage = originalShowWarningMessage;
  }
}

function isMessageOptions(value) {
  return Boolean(
    value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      ('modal' in value || 'detail' in value) &&
      !('title' in value)
  );
}

async function withInterceptedQuickPicks(runIntercepted, resolveSelection) {
  const originalShowQuickPick = vscode.window.showQuickPick;
  const calls = [];

  vscode.window.showQuickPick = async (items, options) => {
    const resolvedItems = Array.isArray(items) ? items : await items;
    calls.push({ items: resolvedItems, options });
    return typeof resolveSelection === 'function'
      ? await resolveSelection({ items: resolvedItems, options, calls })
      : undefined;
  };

  assert.notStrictEqual(vscode.window.showQuickPick, originalShowQuickPick, 'Failed to intercept vscode.window.showQuickPick.');

  try {
    return await runIntercepted(calls);
  } finally {
    vscode.window.showQuickPick = originalShowQuickPick;
  }
}

async function withInterceptedCreateQuickPicks(runIntercepted, resolveSimulation) {
  const originalCreateQuickPick = vscode.window.createQuickPick;
  const calls = [];

  vscode.window.createQuickPick = () => {
    const listeners = {
      changeValue: [],
      accept: [],
      triggerButton: [],
      changeActive: [],
      changeSelection: [],
      hide: []
    };
    const quickPick = {
      title: undefined,
      placeholder: undefined,
      matchOnDescription: false,
      matchOnDetail: false,
      value: '',
      items: [],
      buttons: [],
      ignoreFocusOut: false,
      activeItems: [],
      selectedItems: [],
      canSelectMany: false,
      disposed: false,
      visible: false,
      onDidChangeValue(listener) {
        listeners.changeValue.push(listener);
        return { dispose() {} };
      },
      onDidAccept(listener) {
        listeners.accept.push(listener);
        return { dispose() {} };
      },
      onDidTriggerButton(listener) {
        listeners.triggerButton.push(listener);
        return { dispose() {} };
      },
      onDidChangeActive(listener) {
        listeners.changeActive.push(listener);
        return { dispose() {} };
      },
      onDidChangeSelection(listener) {
        listeners.changeSelection.push(listener);
        return { dispose() {} };
      },
      onDidHide(listener) {
        listeners.hide.push(listener);
        return { dispose() {} };
      },
      show() {
        this.visible = true;
        setTimeout(() => {
          if (typeof resolveSimulation === 'function') {
            resolveSimulation({
              quickPick,
              listeners,
              emitChangeValue: (value) => {
                quickPick.value = value;
                for (const listener of listeners.changeValue) {
                  listener(value);
                }
              },
              emitAccept: () => {
                for (const listener of listeners.accept) {
                  listener();
                }
              },
              emitTriggerButton: (button) => {
                for (const listener of listeners.triggerButton) {
                  listener(button);
                }
              },
              emitChangeActive: (items) => {
                quickPick.activeItems = items;
                for (const listener of listeners.changeActive) {
                  listener(items);
                }
              },
              emitChangeSelection: (items) => {
                quickPick.selectedItems = items;
                for (const listener of listeners.changeSelection) {
                  listener(items);
                }
              }
            });
          }
        }, 0);
      },
      hide() {
        if (!this.visible) {
          return;
        }
        this.visible = false;
        for (const listener of listeners.hide) {
          listener();
        }
      },
      dispose() {
        this.disposed = true;
      }
    };
    calls.push({ quickPick, listeners });
    return quickPick;
  };

  assert.notStrictEqual(
    vscode.window.createQuickPick,
    originalCreateQuickPick,
    'Failed to intercept vscode.window.createQuickPick.'
  );

  try {
    return await runIntercepted(calls);
  } finally {
    vscode.window.createQuickPick = originalCreateQuickPick;
  }
}

function formatExpectedSidebarNodeQuickPickDescription(sidebarItem) {
  if (!sidebarItem) {
    return undefined;
  }

  return sidebarItem.attentionPending ? `${sidebarItem.description} · Attention` : sidebarItem.description;
}

function buildExpectedSidebarNodeQuickPickDetail(node, options = {}) {
  if (node.kind === 'agent') {
    const provider = node.metadata?.agent?.provider === 'claude' ? 'Claude Code' : 'Codex';
    const sessionId = node.metadata?.agent?.resumeSessionId;
    if (options.expectSessionId) {
      assert.ok(sessionId, 'Expected the Agent node QuickPick detail to include a provider session id.');
    }
    return [ 'Agent', provider, sessionId ].filter(Boolean).join(' · ');
  }

  if (node.kind === 'terminal') {
    return 'Terminal';
  }

  if (node.kind === 'note') {
    return 'Note';
  }

  return undefined;
}

async function waitForActiveEditor(predicate, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  let editor = vscode.window.activeTextEditor;

  while (Date.now() < deadline) {
    if (editor && predicate(editor)) {
      return editor;
    }

    await sleep(100);
    editor = vscode.window.activeTextEditor;
  }

  assert.fail(
    `Timed out while waiting for active editor. Last editor: ${JSON.stringify(
      editor
        ? {
            uri: editor.document.uri.toString(),
            selection: {
              line: editor.selection.active.line,
              character: editor.selection.active.character
            }
          }
        : null
    )}`
  );
}

async function waitForVisibleEditor(predicate, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  let editors = vscode.window.visibleTextEditors;

  while (Date.now() < deadline) {
    const matched = editors.find((editor) => predicate(editor));
    if (matched) {
      return matched;
    }

    await sleep(100);
    editors = vscode.window.visibleTextEditors;
  }

  assert.fail(
    `Timed out while waiting for visible editor. Last editors: ${JSON.stringify(
      editors.map((editor) => ({
        uri: editor.document.uri.toString(),
        selection: {
          line: editor.selection.active.line,
          character: editor.selection.active.character
        }
      }))
    )}`
  );
}

async function prepareBackgroundOpenFocusSentinel(
  viewColumn = vscode.ViewColumn.One,
  relativePath = 'file-open-focus-sentinel.txt'
) {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(workspaceFolder, 'Smoke workspace is missing a workspace folder.');
  const sentinelUri = vscode.Uri.joinPath(
    workspaceFolder.uri,
    '.debug',
    'vscode-smoke',
    relativePath
  );
  await fs.mkdir(path.dirname(sentinelUri.fsPath), { recursive: true });
  await fs.writeFile(sentinelUri.fsPath, 'focus sentinel\n', 'utf8');
  const document = await vscode.workspace.openTextDocument(sentinelUri);
  const editor = await vscode.window.showTextDocument(document, {
    preview: false,
    preserveFocus: false,
    viewColumn
  });
  return editor;
}

async function closeVisibleEditor(targetPath) {
  const visibleEditor = vscode.window.visibleTextEditors.find((editor) => editor.document.uri.fsPath === targetPath);
  if (!visibleEditor) {
    return;
  }

  await vscode.window.showTextDocument(visibleEditor.document, {
    preview: false,
    preserveFocus: false,
    viewColumn: visibleEditor.viewColumn
  });
  await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
}

function describeExpectedExecutionLinkModifier() {
  const configuredModifier = vscode.workspace
    .getConfiguration('editor')
    .get('multiCursorModifier', 'alt');
  if (configuredModifier === 'ctrlCmd') {
    return process.platform === 'darwin' ? 'option + click' : 'alt + click';
  }

  return process.platform === 'darwin' ? 'cmd + click' : 'ctrl + click';
}

function isExpectedPreviewTargetUri(actualTarget, originalTarget) {
  if (typeof actualTarget !== 'string') {
    return false;
  }

  if (actualTarget === originalTarget) {
    return true;
  }

  const actual = safeParseUrl(actualTarget);
  const original = safeParseUrl(originalTarget);
  if (!actual || !original) {
    return false;
  }

  return (
    isLoopbackPreviewHost(original.hostname) &&
    isExpectedPreviewProtocol(actual.protocol, original.protocol) &&
    actual.pathname === original.pathname &&
    actual.search === original.search &&
    actual.hash === original.hash &&
    Boolean(actual.hostname)
  );
}

function safeParseUrl(value) {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

function isLoopbackPreviewHost(hostname) {
  const normalizedHostname = hostname.toLowerCase().replace(/\.$/, '');
  return (
    normalizedHostname === 'localhost' ||
    normalizedHostname === '127.0.0.1' ||
    normalizedHostname === '[::1]'
  );
}

function isExpectedPreviewProtocol(actualProtocol, originalProtocol) {
  return actualProtocol === originalProtocol || (originalProtocol === 'http:' && actualProtocol === 'https:');
}

async function createLocalBrowserSmokeServer(title) {
  const server = http.createServer((request, response) => {
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store'
    });
    response.end(
      `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body>${title}:${request.url}</body></html>`
    );
  });

  await new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(0, '127.0.0.1');
  });

  const address = server.address();
  assert.ok(address && typeof address === 'object' && typeof address.port === 'number');
  const hostLabel = `127.0.0.1:${address.port}`;
  const pathname = '/dev-session-canvas-url-smoke';

  return {
    title,
    hostLabel,
    pathname,
    url: `http://${hostLabel}${pathname}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      })
  };
}

function findNodeByKind(snapshot, kind) {
  const node = snapshot.state.nodes.find((currentNode) => currentNode.kind === kind);
  assert.ok(node, `Missing ${kind} node in smoke snapshot.`);
  return node;
}

function findNodeById(snapshot, nodeId) {
  const node = snapshot.state.nodes.find((currentNode) => currentNode.id === nodeId);
  assert.ok(node, `Missing node ${nodeId} in smoke snapshot.`);
  return node;
}

function findGroupById(snapshot, groupId) {
  const group = snapshot.state.groups.find((currentGroup) => currentGroup.id === groupId);
  assert.ok(group, `Missing group ${groupId} in smoke snapshot.`);
  return group;
}

function findEdgeById(snapshot, edgeId) {
  const edge = snapshot.state.edges.find((currentEdge) => currentEdge.id === edgeId);
  assert.ok(edge, `Missing edge ${edgeId} in smoke snapshot.`);
  return edge;
}

function hasNodeSize(snapshot, nodeId, targetSize) {
  const node = snapshot.state.nodes.find((currentNode) => currentNode.id === nodeId);
  return Boolean(
    node &&
      node.size?.width === targetSize.width &&
      node.size?.height === targetSize.height
  );
}

function hasRenderedNodeSize(probe, nodeId, targetSize, tolerance = 8) {
  const node = probe.nodes.find((currentNode) => currentNode.nodeId === nodeId);
  return Boolean(
    node &&
      Math.abs(node.renderedWidth - targetSize.width) <= tolerance &&
      Math.abs(node.renderedHeight - targetSize.height) <= tolerance
  );
}

function readProbeTerminalVisibleLines(probe, nodeId) {
  const node = probe.nodes.find((currentNode) => currentNode.nodeId === nodeId);
  return Array.isArray(node?.terminalVisibleLines) ? node.terminalVisibleLines : [];
}

function sleep(timeoutMs) {
  return new Promise((resolve) => setTimeout(resolve, timeoutMs));
}

async function writeCodexRolloutSessionMeta({
  homeDir,
  sessionId,
  cwd,
  timestampMs,
  fileSuffix = 'match'
}) {
  const [year, month, day] = toDateDirectoryParts(timestampMs);
  const sessionsDir = path.join(homeDir, '.codex', 'sessions', year, month, day);
  await fs.mkdir(sessionsDir, { recursive: true });
  const timestamp = new Date(timestampMs).toISOString();
  const payload = {
    timestamp,
    type: 'session_meta',
    payload: {
      id: sessionId,
      timestamp,
      cwd,
      originator: 'smoke-test'
    }
  };

  await fs.writeFile(
    path.join(sessionsDir, `rollout-${sessionId}-${fileSuffix}.jsonl`),
    `${JSON.stringify(payload)}\n`,
    'utf8'
  );
}

async function writeClaudeProjectSessionFile({
  homeDir,
  sessionId,
  cwd
}) {
  const projectDir = path.join(
    homeDir,
    '.claude',
    'projects',
    path.resolve(cwd).replace(/[^a-zA-Z0-9]+/g, '-')
  );
  await fs.mkdir(projectDir, { recursive: true });
  const payload = {
    cwd,
    sessionId,
    type: 'progress'
  };
  await fs.writeFile(path.join(projectDir, `${sessionId}.jsonl`), `${JSON.stringify(payload)}\n`, 'utf8');
}

function toDateDirectoryParts(timestampMs) {
  const date = new Date(timestampMs);
  return [
    String(date.getFullYear()),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ];
}

async function persistLastWebviewProbe() {
  if (!artifactDir || lastWebviewProbe === undefined) {
    return;
  }

  await fs.mkdir(artifactDir, { recursive: true });
  await fs.writeFile(
    path.join(artifactDir, 'last-webview-probe.json'),
    `${JSON.stringify(lastWebviewProbe, null, 2)}\n`,
    'utf8'
  );
}

async function verifyTrustedDiagnostics(agentNodeId, terminalNodeId) {
  const diagnosticEvents = await getDiagnosticEvents();

  assert.ok(
    diagnosticEvents.some(
      (event) =>
        event.kind === 'storage/slotSelected' &&
        typeof event.detail?.writePath === 'string' &&
        typeof event.detail?.sourceStateHash === 'string'
    )
  );
  assert.ok(
    diagnosticEvents.some((event) => {
      const source = event.detail?.source;
      return (
        event.kind === 'state/loadSelected' &&
        (source === 'snapshot' || source === 'rootLocalSnapshot') &&
        typeof event.detail?.storagePath === 'string' &&
        typeof event.detail?.stateHash === 'string' &&
        event.detail?.snapshotStateHash === event.detail?.stateHash
      );
    }),
    'Expected state/loadSelected diagnostics to report the selected snapshot/root-local snapshot hash.'
  );
  assert.ok(
    diagnosticEvents.some(
      (event) =>
        event.kind === 'execution/started' &&
        event.detail?.kind === 'agent' &&
        typeof event.detail?.nodeId === 'string'
    )
  );
  assert.ok(
    diagnosticEvents.some(
      (event) =>
        event.kind === 'execution/exited' &&
        event.detail?.kind === 'agent' &&
        typeof event.detail?.nodeId === 'string'
    )
  );
  assert.ok(
    diagnosticEvents.some(
      (event) =>
        event.kind === 'execution/started' &&
        event.detail?.kind === 'terminal' &&
        typeof event.detail?.nodeId === 'string'
    )
  );
  assert.ok(
    diagnosticEvents.some(
      (event) =>
        event.kind === 'execution/snapshotPosted' &&
        event.detail?.kind === 'terminal' &&
        typeof event.detail?.nodeId === 'string' &&
        event.detail?.liveSession === true
    )
  );
  assert.ok(
    diagnosticEvents.some(
      (event) =>
        ((event.kind === 'execution/spawnError' &&
          event.detail?.kind === 'agent') ||
          (event.kind === 'execution/exited' &&
            event.detail?.kind === 'agent' &&
            event.detail?.status === 'error'))
    )
  );
  assert.ok(
    diagnosticEvents.some(
      (event) =>
        event.kind === 'state/persistWritten' &&
        typeof event.detail?.snapshotPath === 'string' &&
        typeof event.detail?.stateHash === 'string'
    )
  );
}

async function verifyRestrictedDiagnostics(agentNodeId, terminalNodeId) {
  const diagnosticEvents = await getDiagnosticEvents();

  assert.ok(
    diagnosticEvents.some(
      (event) => event.kind === 'surface/ready' && event.detail?.surface === 'editor'
    )
  );
  assert.ok(
    diagnosticEvents.some(
      (event) =>
        event.kind === 'execution/startRejected' &&
        event.detail?.kind === 'agent' &&
        event.detail?.nodeId === agentNodeId &&
        event.detail?.reason === 'workspace-untrusted'
    )
  );
  assert.ok(
    diagnosticEvents.some(
      (event) =>
        event.kind === 'execution/startRejected' &&
        event.detail?.kind === 'terminal' &&
        event.detail?.nodeId === terminalNodeId &&
        event.detail?.reason === 'workspace-untrusted'
    )
  );
  assert.ok(
    diagnosticEvents.some(
      (event) =>
        event.kind === 'execution/inputRejected' &&
        event.detail?.kind === 'agent' &&
        event.detail?.nodeId === agentNodeId &&
        event.detail?.reason === 'workspace-untrusted'
    )
  );
  assert.ok(
    diagnosticEvents.some(
      (event) =>
        event.kind === 'execution/inputRejected' &&
        event.detail?.kind === 'terminal' &&
        event.detail?.nodeId === terminalNodeId &&
        event.detail?.reason === 'workspace-untrusted'
    )
  );
}

async function writeFailureArtifacts(error) {
  if (!artifactDir) {
    return;
  }

  await fs.mkdir(artifactDir, { recursive: true });
  await fs.writeFile(path.join(artifactDir, 'failure-error.txt'), formatError(error), 'utf8');

  const snapshot = await safeGet(() => getDebugSnapshot());
  if (snapshot !== undefined) {
    await fs.writeFile(
      path.join(artifactDir, 'failure-snapshot.json'),
      `${JSON.stringify(snapshot, null, 2)}\n`,
      'utf8'
    );
  }

  const hostMessages = await safeGet(() => getHostMessages());
  if (hostMessages !== undefined) {
    await fs.writeFile(
      path.join(artifactDir, 'failure-host-messages.json'),
      `${JSON.stringify(hostMessages, null, 2)}\n`,
      'utf8'
    );
  }

  const diagnosticEvents = await safeGet(() => getDiagnosticEvents());
  if (diagnosticEvents !== undefined) {
    await fs.writeFile(
      path.join(artifactDir, 'failure-diagnostic-events.json'),
      `${JSON.stringify(diagnosticEvents, null, 2)}\n`,
      'utf8'
    );
  }

  if (lastWebviewProbe !== undefined) {
    await fs.writeFile(
      path.join(artifactDir, 'failure-webview-probe.json'),
      `${JSON.stringify(lastWebviewProbe, null, 2)}\n`,
      'utf8'
    );
  }

  const hostDiagnosticsDump = await safeGet(() =>
    vscode.commands.executeCommand(COMMAND_IDS.testDumpHostDiagnostics)
  );
  if (hostDiagnosticsDump !== undefined) {
    await fs.writeFile(
      path.join(artifactDir, 'failure-host-diagnostics-dump.json'),
      `${JSON.stringify(hostDiagnosticsDump, null, 2)}\n`,
      'utf8'
    );
  }
}

async function safeGet(loader) {
  try {
    return await loader();
  } catch {
    return undefined;
  }
}

function rectanglesOverlap(left, right) {
  return (
    left.position.x < right.position.x + right.size.width &&
    left.position.x + left.size.width > right.position.x &&
    left.position.y < right.position.y + right.size.height &&
    left.position.y + left.size.height > right.position.y
  );
}

function paddedRectanglesOverlap(left, right, padding = 0) {
  return (
    left.position.x < right.position.x + right.size.width + padding &&
    left.position.x + left.size.width > right.position.x - padding &&
    left.position.y < right.position.y + right.size.height + padding &&
    left.position.y + left.size.height > right.position.y - padding
  );
}

function collectNodePositionSnapshot(snapshot, kind) {
  return snapshot.state.nodes
    .filter((node) => node.kind === kind)
    .map((node) => ({
      id: node.id,
      position: {
        x: node.position.x,
        y: node.position.y
      }
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function collectNodeLayoutSnapshot(snapshot, kind) {
  return snapshot.state.nodes
    .filter((node) => node.kind === kind)
    .map((node) => ({
      id: node.id,
      position: {
        x: node.position.x,
        y: node.position.y
      },
      size: {
        width: node.size.width,
        height: node.size.height
      }
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function collectAutomaticFileEdgeIds(snapshot) {
  return snapshot.state.edges
    .filter((edge) => edge.owner === 'file-activity')
    .map((edge) => edge.id)
    .sort();
}

function formatError(error) {
  if (error instanceof Error) {
    return error.stack || error.message;
  }

  return String(error);
}
