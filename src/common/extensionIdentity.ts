export const EXTENSION_DISPLAY_NAME = 'Dev Session Canvas';
export const EXECUTION_EVENT_NAME = 'dev-session-canvas-execution-event';

export const COMMAND_IDS = {
  openCanvas: 'devSessionCanvas.openCanvas',
  openCanvasInEditor: 'devSessionCanvas.openCanvasInEditor',
  openCanvasInPanel: 'devSessionCanvas.openCanvasInPanel',
  openSettings: 'devSessionCanvas.openSettings',
  createNode: 'devSessionCanvas.createNode',
  showNodeList: 'devSessionCanvas.showNodeList',
  showSessionHistory: 'devSessionCanvas.showSessionHistory',
  refreshSessionHistory: 'devSessionCanvas.refreshSessionHistory',
  resetCanvasState: 'devSessionCanvas.resetCanvasState',
  dumpHostDiagnostics: 'devSessionCanvas.dumpHostDiagnostics',
  editFileIncludeFilter: 'devSessionCanvas.editFileIncludeFilter',
  editFileExcludeFilter: 'devSessionCanvas.editFileExcludeFilter',
  focusNode: 'devSessionCanvas.__internal.focusNode',
  focusAttentionNode: 'devSessionCanvas.__internal.focusAttentionNode',
  focusSidebarNode: 'devSessionCanvas.__internal.focusSidebarNode',
  restoreSidebarSessionHistoryEntry: 'devSessionCanvas.__internal.restoreSidebarSessionHistoryEntry',
  clearFileIncludeFilter: 'devSessionCanvas.clearFileIncludeFilter',
  clearFileExcludeFilter: 'devSessionCanvas.clearFileExcludeFilter'
} as const;

export const TEST_COMMAND_IDS = {
  getDebugState: 'devSessionCanvas.__test.getDebugState',
  getSidebarSummaryItems: 'devSessionCanvas.__test.getSidebarSummaryItems',
  getSidebarNodeListItems: 'devSessionCanvas.__test.getSidebarNodeListItems',
  getSidebarSessionHistoryItems: 'devSessionCanvas.__test.getSidebarSessionHistoryItems',
  getRuntimeSupervisorState: 'devSessionCanvas.__test.getRuntimeSupervisorState',
  getHostMessages: 'devSessionCanvas.__test.getHostMessages',
  clearHostMessages: 'devSessionCanvas.__test.clearHostMessages',
  getDiagnosticEvents: 'devSessionCanvas.__test.getDiagnosticEvents',
  clearDiagnosticEvents: 'devSessionCanvas.__test.clearDiagnosticEvents',
  locateCodexSessionId: 'devSessionCanvas.__test.locateCodexSessionId',
  locateClaudeSessionId: 'devSessionCanvas.__test.locateClaudeSessionId',
  extractCodexResumeSessionId: 'devSessionCanvas.__test.extractCodexResumeSessionId',
  extractClaudeResumeSessionId: 'devSessionCanvas.__test.extractClaudeResumeSessionId',
  getAgentCliResolutionCacheKey: 'devSessionCanvas.__test.getAgentCliResolutionCacheKey',
  waitForCanvasReady: 'devSessionCanvas.__test.waitForCanvasReady',
  captureWebviewProbe: 'devSessionCanvas.__test.captureWebviewProbe',
  performWebviewDomAction: 'devSessionCanvas.__test.performWebviewDomAction',
  performSidebarNodeListAction: 'devSessionCanvas.__test.performSidebarNodeListAction',
  performSidebarSessionHistoryAction: 'devSessionCanvas.__test.performSidebarSessionHistoryAction',
  setPersistedState: 'devSessionCanvas.__test.setPersistedState',
  reloadPersistedState: 'devSessionCanvas.__test.reloadPersistedState',
  flushPersistedState: 'devSessionCanvas.__test.flushPersistedState',
  simulateRuntimeReload: 'devSessionCanvas.__test.simulateRuntimeReload',
  dispatchWebviewMessage: 'devSessionCanvas.__test.dispatchWebviewMessage',
  startExecutionSession: 'devSessionCanvas.__test.startExecutionSession',
  setQuickPickSelections: 'devSessionCanvas.__test.setQuickPickSelections',
  createNode: 'devSessionCanvas.__test.createNode',
  resetState: 'devSessionCanvas.__test.resetState'
} as const;

export const VIEW_IDS = {
  activityBarContainer: 'devSessionCanvas',
  sidebarTree: 'devSessionCanvas.sidebar',
  sidebarFilters: 'devSessionCanvas.sidebarFilters',
  sidebarNodes: 'devSessionCanvas.sidebarNodes',
  sidebarSessions: 'devSessionCanvas.sidebarSessions',
  editorWebviewPanel: 'devSessionCanvas.canvas',
  panelWebviewView: 'devSessionCanvas.canvasPanel',
  panelContainer: 'devSessionCanvasPanel'
} as const;

export const CONFIG_KEYS = {
  canvasDefaultSurface: 'devSessionCanvas.canvas.defaultSurface',
  runtimePersistenceEnabled: 'devSessionCanvas.runtimePersistence.enabled',
  agentDefaultProvider: 'devSessionCanvas.agent.defaultProvider',
  agentCodexCommand: 'devSessionCanvas.agent.codexCommand',
  agentClaudeCommand: 'devSessionCanvas.agent.claudeCommand',
  agentCodexDefaultArgs: 'devSessionCanvas.agent.codexDefaultArgs',
  agentClaudeDefaultArgs: 'devSessionCanvas.agent.claudeDefaultArgs',
  notificationAttentionSignalBridge: 'devSessionCanvas.notifications.attentionSignalBridge',
  legacyNotificationBridgeTerminalAttentionSignals: 'devSessionCanvas.notifications.bridgeTerminalAttentionSignals',
  legacyNotificationPreferNotifierCompanion: 'devSessionCanvas.notifications.preferNotifierCompanion',
  notificationStrongTerminalAttentionReminder: 'devSessionCanvas.notifications.strongTerminalAttentionReminder',
  terminalShellPath: 'devSessionCanvas.terminal.shellPath',
  filesFeatureEnabled: 'devSessionCanvas.files.enabled',
  filesPresentationMode: 'devSessionCanvas.files.presentationMode',
  fileNodeDisplayStyle: 'devSessionCanvas.fileNode.displayStyle',
  filesNodeDisplayMode: 'devSessionCanvas.files.nodeDisplayMode',
  filesPathDisplayMode: 'devSessionCanvas.files.pathDisplayMode'
} as const;

export const CONTEXT_KEYS = {
  panelViewVisible: 'devSessionCanvas.canvas.panelViewVisible'
} as const;

export const STORAGE_KEYS = {
  canvasState: 'devSessionCanvas.canvas.state',
  canvasLastSurface: 'devSessionCanvas.canvas.lastSurface',
  canvasDefaultSurface: 'devSessionCanvas.canvas.defaultSurface',
  canvasRuntimePersistenceEnabled: 'devSessionCanvas.canvas.runtimePersistenceEnabled',
  canvasFilesFeatureEnabled: 'devSessionCanvas.canvas.filesFeatureEnabled',
  canvasFileFilterState: 'devSessionCanvas.canvas.fileFilterState'
} as const;
