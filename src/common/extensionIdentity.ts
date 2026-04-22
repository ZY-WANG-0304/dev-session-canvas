export const EXTENSION_DISPLAY_NAME = 'Dev Session Canvas';
export const EXECUTION_EVENT_NAME = 'dev-session-canvas-execution-event';

export const COMMAND_IDS = {
  openCanvas: 'devSessionCanvas.openCanvas',
  openCanvasInEditor: 'devSessionCanvas.openCanvasInEditor',
  openCanvasInPanel: 'devSessionCanvas.openCanvasInPanel',
  openSettings: 'devSessionCanvas.openSettings',
  createNode: 'devSessionCanvas.createNode',
  resetCanvasState: 'devSessionCanvas.resetCanvasState',
  editFileIncludeFilter: 'devSessionCanvas.editFileIncludeFilter',
  editFileExcludeFilter: 'devSessionCanvas.editFileExcludeFilter',
  clearFileIncludeFilter: 'devSessionCanvas.clearFileIncludeFilter',
  clearFileExcludeFilter: 'devSessionCanvas.clearFileExcludeFilter'
} as const;

export const TEST_COMMAND_IDS = {
  getDebugState: 'devSessionCanvas.__test.getDebugState',
  getSidebarSummaryItems: 'devSessionCanvas.__test.getSidebarSummaryItems',
  getRuntimeSupervisorState: 'devSessionCanvas.__test.getRuntimeSupervisorState',
  getHostMessages: 'devSessionCanvas.__test.getHostMessages',
  clearHostMessages: 'devSessionCanvas.__test.clearHostMessages',
  getDiagnosticEvents: 'devSessionCanvas.__test.getDiagnosticEvents',
  clearDiagnosticEvents: 'devSessionCanvas.__test.clearDiagnosticEvents',
  locateCodexSessionId: 'devSessionCanvas.__test.locateCodexSessionId',
  getAgentCliResolutionCacheKey: 'devSessionCanvas.__test.getAgentCliResolutionCacheKey',
  waitForCanvasReady: 'devSessionCanvas.__test.waitForCanvasReady',
  captureWebviewProbe: 'devSessionCanvas.__test.captureWebviewProbe',
  performWebviewDomAction: 'devSessionCanvas.__test.performWebviewDomAction',
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
  notificationBridgeTerminalAttentionSignals: 'devSessionCanvas.notifications.bridgeTerminalAttentionSignals',
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
