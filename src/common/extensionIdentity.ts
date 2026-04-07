export const EXTENSION_DISPLAY_NAME = 'Dev Session Canvas';
export const EXECUTION_EVENT_NAME = 'dev-session-canvas-execution-event';

export const COMMAND_IDS = {
  openCanvas: 'devSessionCanvas.openCanvas',
  openCanvasInEditor: 'devSessionCanvas.openCanvasInEditor',
  openCanvasInPanel: 'devSessionCanvas.openCanvasInPanel',
  createNode: 'devSessionCanvas.createNode',
  resetCanvasState: 'devSessionCanvas.resetCanvasState'
} as const;

export const TEST_COMMAND_IDS = {
  getDebugState: 'devSessionCanvas.__test.getDebugState',
  getHostMessages: 'devSessionCanvas.__test.getHostMessages',
  clearHostMessages: 'devSessionCanvas.__test.clearHostMessages',
  getDiagnosticEvents: 'devSessionCanvas.__test.getDiagnosticEvents',
  clearDiagnosticEvents: 'devSessionCanvas.__test.clearDiagnosticEvents',
  waitForCanvasReady: 'devSessionCanvas.__test.waitForCanvasReady',
  captureWebviewProbe: 'devSessionCanvas.__test.captureWebviewProbe',
  performWebviewDomAction: 'devSessionCanvas.__test.performWebviewDomAction',
  setPersistedState: 'devSessionCanvas.__test.setPersistedState',
  reloadPersistedState: 'devSessionCanvas.__test.reloadPersistedState',
  simulateRuntimeReload: 'devSessionCanvas.__test.simulateRuntimeReload',
  dispatchWebviewMessage: 'devSessionCanvas.__test.dispatchWebviewMessage',
  createNode: 'devSessionCanvas.__test.createNode',
  resetState: 'devSessionCanvas.__test.resetState'
} as const;

export const VIEW_IDS = {
  activityBarContainer: 'devSessionCanvas',
  sidebarTree: 'devSessionCanvas.sidebar',
  editorWebviewPanel: 'devSessionCanvas.canvas',
  panelWebviewView: 'devSessionCanvas.canvasPanel',
  panelContainer: 'devSessionCanvasPanel'
} as const;

export const CONFIG_KEYS = {
  canvasDefaultSurface: 'devSessionCanvas.canvas.defaultSurface',
  agentDefaultProvider: 'devSessionCanvas.agent.defaultProvider',
  agentCodexCommand: 'devSessionCanvas.agent.codexCommand',
  agentClaudeCommand: 'devSessionCanvas.agent.claudeCommand',
  terminalShellPath: 'devSessionCanvas.terminal.shellPath'
} as const;

export const STORAGE_KEYS = {
  canvasState: 'devSessionCanvas.canvas.state',
  canvasLastSurface: 'devSessionCanvas.canvas.lastSurface'
} as const;
