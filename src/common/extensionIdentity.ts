export const EXTENSION_DISPLAY_NAME = 'Dev Session Canvas';
export const EXECUTION_EVENT_NAME = 'dev-session-canvas-execution-event';

export const COMMAND_IDS = {
  openCanvas: 'devSessionCanvas.openCanvas',
  openCanvasInEditor: 'devSessionCanvas.openCanvasInEditor',
  openCanvasInPanel: 'devSessionCanvas.openCanvasInPanel',
  createNode: 'devSessionCanvas.createNode',
  resetCanvasState: 'devSessionCanvas.resetCanvasState'
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
