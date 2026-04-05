export const EXTENSION_DISPLAY_NAME = 'Dev Session Canvas';
export const EXECUTION_EVENT_NAME = 'dev-session-canvas-execution-event';

export const COMMAND_IDS = {
  openCanvas: 'devSessionCanvas.openCanvas',
  openCanvasInEditor: 'devSessionCanvas.openCanvasInEditor',
  openCanvasInPanel: 'devSessionCanvas.openCanvasInPanel',
  createNode: 'devSessionCanvas.createNode',
  resetCanvasState: 'devSessionCanvas.resetCanvasState'
} as const;

export const LEGACY_COMMAND_IDS = {
  openCanvas: 'opencove.openCanvas',
  openCanvasInEditor: 'opencove.openCanvasInEditor',
  openCanvasInPanel: 'opencove.openCanvasInPanel',
  createNode: 'opencove.createNode',
  resetCanvasState: 'opencove.resetCanvasState'
} as const;

export const COMMAND_ID_ALIASES: Readonly<Record<keyof typeof COMMAND_IDS, readonly string[]>> = {
  openCanvas: [COMMAND_IDS.openCanvas, LEGACY_COMMAND_IDS.openCanvas],
  openCanvasInEditor: [COMMAND_IDS.openCanvasInEditor, LEGACY_COMMAND_IDS.openCanvasInEditor],
  openCanvasInPanel: [COMMAND_IDS.openCanvasInPanel, LEGACY_COMMAND_IDS.openCanvasInPanel],
  createNode: [COMMAND_IDS.createNode, LEGACY_COMMAND_IDS.createNode],
  resetCanvasState: [COMMAND_IDS.resetCanvasState, LEGACY_COMMAND_IDS.resetCanvasState]
};

export const VIEW_IDS = {
  activityBarContainer: 'opencove',
  sidebarTree: 'opencove.sidebar',
  editorWebviewPanel: 'opencove.canvas',
  panelWebviewView: 'opencove.canvasPanel',
  panelContainer: 'opencoveCanvasPanel'
} as const;

export const CONFIG_KEYS = {
  canvasDefaultSurface: 'devSessionCanvas.canvas.defaultSurface',
  agentDefaultProvider: 'devSessionCanvas.agent.defaultProvider',
  agentCodexCommand: 'devSessionCanvas.agent.codexCommand',
  agentClaudeCommand: 'devSessionCanvas.agent.claudeCommand',
  terminalShellPath: 'devSessionCanvas.terminal.shellPath'
} as const;

export const LEGACY_CONFIG_KEYS = {
  canvasDefaultSurface: 'opencove.canvas.defaultSurface',
  agentDefaultProvider: 'opencove.agent.defaultProvider',
  agentCodexCommand: 'opencove.agent.codexCommand',
  agentClaudeCommand: 'opencove.agent.claudeCommand',
  terminalShellPath: 'opencove.terminal.shellPath'
} as const;

export const STORAGE_KEYS = {
  canvasState: 'devSessionCanvas.canvas.state',
  canvasLastSurface: 'devSessionCanvas.canvas.lastSurface'
} as const;

export const LEGACY_STORAGE_KEYS = {
  canvasState: 'opencove.canvas.prototypeState',
  canvasLastSurface: 'opencove.canvas.lastSurface'
} as const;
