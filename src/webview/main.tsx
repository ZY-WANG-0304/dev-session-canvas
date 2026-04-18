import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import ReactFlow, {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  NodeResizer,
  useViewport,
  type ReactFlowInstance,
  type Node,
  type NodeMouseHandler,
  type NodeProps,
  type Viewport
} from 'reactflow';

import 'reactflow/dist/style.css';
import '@xterm/xterm/css/xterm.css';
import '@vscode/codicons/dist/codicon.css';
import './styles.css';

import type {
  AgentProviderKind,
  CanvasNodeKind,
  CanvasNodeFootprint,
  CanvasNodeMetadata,
  CanvasNodePosition,
  CanvasRuntimeContext,
  CanvasNodeSummary,
  CanvasPrototypeState,
  ExecutionNodeKind,
  HostToWebviewMessage,
  WebviewDomAction,
  WebviewProbeNodeSnapshot,
  WebviewProbeSnapshot,
  WebviewToHostMessage
} from '../common/protocol';
import type { SerializedTerminalState } from '../common/serializedTerminalState';
import type {
  ExecutionTerminalFileLinkCandidate,
  ExecutionTerminalDroppedResource,
  ExecutionTerminalOpenLink,
  ExecutionTerminalResolvedFileLink
} from '../common/executionTerminalLinks';
import { normalizeExecutionTerminalWordSeparators } from '../common/executionTerminalLinks';
import { DEFAULT_TERMINAL_SCROLLBACK, normalizeTerminalScrollback } from '../common/terminalScrollback';
import {
  estimatedCanvasNodeFootprint,
  isCanvasNodeKind,
  minimumCanvasNodeFootprint,
  normalizeCanvasNodeFootprint
} from '../common/protocol';
import {
  setupExecutionTerminalNativeInteractions,
  type ExecutionTerminalNativeInteractionsHandle
} from './executionTerminalNativeInteractions';

declare function acquireVsCodeApi<T>(): {
  getState(): T | undefined;
  setState(state: T): void;
  postMessage(message: unknown): void;
};

interface LocalUiState {
  selectedNodeId?: string;
  viewport?: Viewport;
}

interface CanvasNodeData {
  kind: CanvasNodeKind;
  title: string;
  status: string;
  summary: string;
  selected: boolean;
  workspaceTrusted: boolean;
  size: CanvasNodeFootprint;
  metadata?: CanvasNodeMetadata;
  onSelectNode?: (nodeId: string) => void;
  onStartExecution?: (
    nodeId: string,
    kind: ExecutionNodeKind,
    cols: number,
    rows: number,
    provider?: AgentProviderKind,
    resume?: boolean
  ) => void;
  onAttachExecution?: (nodeId: string, kind: ExecutionNodeKind) => void;
  onExecutionInput?: (nodeId: string, kind: ExecutionNodeKind, data: string) => void;
  onDropExecutionResource?: (
    nodeId: string,
    kind: ExecutionNodeKind,
    resource: ExecutionTerminalDroppedResource
  ) => void;
  onOpenExecutionLink?: (
    nodeId: string,
    kind: ExecutionNodeKind,
    link: ExecutionTerminalOpenLink
  ) => void;
  onResizeExecution?: (nodeId: string, kind: ExecutionNodeKind, cols: number, rows: number) => void;
  onStopExecution?: (nodeId: string, kind: ExecutionNodeKind) => void;
  onUpdateNodeTitle?: (nodeId: string, title: string) => void;
  onUpdateNote?: (payload: {
    nodeId: string;
    content: string;
  }) => void;
  onResizeNode?: (nodeId: string, position: CanvasNodePosition, size: CanvasNodeFootprint) => void;
  onFocusNodeInViewport?: (nodeId: string) => void;
  onDeleteNode?: (nodeId: string) => void;
}

type CanvasFlowNode = Node<CanvasNodeData>;
type EmbeddedTerminalOptions = NonNullable<ConstructorParameters<typeof Terminal>[0]>;
type EmbeddedTerminalTheme = NonNullable<EmbeddedTerminalOptions['theme']>;
type WorkbenchThemeKind = 'light' | 'dark' | 'hcDark' | 'hcLight';
interface CanvasNodeLayoutDraft {
  position?: CanvasNodePosition;
  size?: CanvasNodeFootprint;
}
interface CanvasContextMenuState {
  screenX: number;
  screenY: number;
  flowAnchor: CanvasNodePosition;
  view: 'root' | 'agent-provider';
}
interface ExecutionNodeHelpContent {
  title: string;
  items: readonly string[];
}
interface FloatingTooltipPosition {
  left: number;
  top: number;
}
type ExecutionHelpTriggerVariant = 'canvas' | 'inline';

const EXECUTION_NODE_HELP_TIPS: ExecutionNodeHelpContent = {
  title: '执行节点使用提示',
  items: ['拖拽文件到 Canvas 后按 Shift，再拖到终端或节点即可插入路径']
};
const EXECUTION_TERMINAL_HELP_TOOLTIP = formatExecutionNodeHelpTooltip(EXECUTION_NODE_HELP_TIPS);
let nextExecutionNodeHelpTooltipId = 0;
type ExecutionHostEvent =
  | {
      type: 'snapshot';
      nodeId: string;
      kind: ExecutionNodeKind;
      output: string;
      cols: number;
      rows: number;
      liveSession: boolean;
      serializedTerminalState?: SerializedTerminalState;
    }
  | {
      type: 'output';
      nodeId: string;
      kind: ExecutionNodeKind;
      chunk: string;
    }
  | {
      type: 'exit';
      nodeId: string;
      kind: ExecutionNodeKind;
      message: string;
    };

interface ExecutionTerminalController {
  applySnapshot(detail: Extract<ExecutionHostEvent, { type: 'snapshot' }>): void;
  enqueueOutput(chunk: string): void;
  showExit(message: string): void;
  refreshVisibleRows(): void;
  flushPendingOutput(): void;
  dispose(): void;
}

type MouseCoords = [number, number] | undefined;
interface MouseReportCoords {
  col: number;
  row: number;
  x: number;
  y: number;
}
interface XtermMouseService {
  getCoords: (
    event: Pick<MouseEvent, 'clientX' | 'clientY'>,
    element: HTMLElement,
    colCount: number,
    rowCount: number,
    isSelection?: boolean
  ) => MouseCoords;
  getMouseReportCoords: (
    event: MouseEvent,
    element: HTMLElement
  ) => MouseReportCoords | undefined;
}
interface XtermSelectionService {
  _screenElement?: HTMLElement;
  _getMouseEventScrollAmount?: (event: MouseEvent) => number;
}
interface XtermCoreWithMouseInternals {
  _mouseService?: XtermMouseService;
  _selectionService?: XtermSelectionService;
}

const vscode = acquireVsCodeApi<LocalUiState>();
const initialPersistedState = vscode.getState() ?? {};
const rootElement = document.querySelector<HTMLDivElement>('#app');
const executionTerminalRegistry = new Map<
  string,
  {
    terminal: Terminal;
    fitAddon: FitAddon;
    controller: ExecutionTerminalController;
    nativeInteractions: ExecutionTerminalNativeInteractionsHandle;
  }
>();
const pendingExecutionFileLinkResolutionRequests = new Map<
  string,
  {
    resolve: (resolvedLinks: ExecutionTerminalResolvedFileLink[]) => void;
    reject: (error: Error) => void;
    timeout: number;
  }
>();
const pendingExecutionTerminalDrains = new Set<ExecutionTerminalController>();
let executionTerminalDrainFrame: number | undefined;
const CANVAS_FIT_VIEW_PADDING = 0.05;
const NODE_FOCUS_VIEW_PADDING = 0.22;
const NODE_FOCUS_MAX_ZOOM = 1.15;
const NODE_FOCUS_MIN_ZOOM = 0.55;
const EMBEDDED_TERMINAL_BACKGROUND_CSS_VAR = '--canvas-embedded-terminal-background';
const EMBEDDED_TERMINAL_FOREGROUND_CSS_VAR = '--canvas-embedded-terminal-foreground';
const TERMINAL_BACKGROUND_FALLBACKS: Record<'editor' | 'panel', string[]> = {
  editor: ['--vscode-editor-background', '--vscode-panel-background'],
  panel: ['--vscode-panel-background', '--vscode-editor-background']
};
const EMBEDDED_TERMINAL_DEFAULTS: Record<
  WorkbenchThemeKind,
  {
    editorBackground: string;
    panelBackground: string;
    foreground: string;
    selectionBackground: string;
    ansi: Record<
      | 'black'
      | 'red'
      | 'green'
      | 'yellow'
      | 'blue'
      | 'magenta'
      | 'cyan'
      | 'white'
      | 'brightBlack'
      | 'brightRed'
      | 'brightGreen'
      | 'brightYellow'
      | 'brightBlue'
      | 'brightMagenta'
      | 'brightCyan'
      | 'brightWhite',
      string
    >;
  }
> = {
  dark: {
    editorBackground: '#1E1E1E',
    panelBackground: '#1E1E1E',
    foreground: '#CCCCCC',
    selectionBackground: '#264F78',
    ansi: {
      black: '#000000',
      red: '#cd3131',
      green: '#0DBC79',
      yellow: '#e5e510',
      blue: '#2472c8',
      magenta: '#bc3fbc',
      cyan: '#11a8cd',
      white: '#e5e5e5',
      brightBlack: '#666666',
      brightRed: '#f14c4c',
      brightGreen: '#23d18b',
      brightYellow: '#f5f543',
      brightBlue: '#3b8eea',
      brightMagenta: '#d670d6',
      brightCyan: '#29b8db',
      brightWhite: '#e5e5e5'
    }
  },
  light: {
    editorBackground: '#FFFFFF',
    panelBackground: '#F3F3F3',
    foreground: '#333333',
    selectionBackground: '#ADD6FF',
    ansi: {
      black: '#000000',
      red: '#cd3131',
      green: '#107C10',
      yellow: '#949800',
      blue: '#0451a5',
      magenta: '#bc05bc',
      cyan: '#0598bc',
      white: '#555555',
      brightBlack: '#666666',
      brightRed: '#cd3131',
      brightGreen: '#14CE14',
      brightYellow: '#b5ba00',
      brightBlue: '#0451a5',
      brightMagenta: '#bc05bc',
      brightCyan: '#0598bc',
      brightWhite: '#a5a5a5'
    }
  },
  hcDark: {
    editorBackground: '#000000',
    panelBackground: '#000000',
    foreground: '#FFFFFF',
    selectionBackground: '#f3f518',
    ansi: {
      black: '#000000',
      red: '#cd0000',
      green: '#00cd00',
      yellow: '#cdcd00',
      blue: '#0000ee',
      magenta: '#cd00cd',
      cyan: '#00cdcd',
      white: '#e5e5e5',
      brightBlack: '#7f7f7f',
      brightRed: '#ff0000',
      brightGreen: '#00ff00',
      brightYellow: '#ffff00',
      brightBlue: '#5c5cff',
      brightMagenta: '#ff00ff',
      brightCyan: '#00ffff',
      brightWhite: '#ffffff'
    }
  },
  hcLight: {
    editorBackground: '#FFFFFF',
    panelBackground: '#FFFFFF',
    foreground: '#292929',
    selectionBackground: '#0F4A85',
    ansi: {
      black: '#292929',
      red: '#cd3131',
      green: '#136C13',
      yellow: '#949800',
      blue: '#0451a5',
      magenta: '#bc05bc',
      cyan: '#0598bc',
      white: '#555555',
      brightBlack: '#666666',
      brightRed: '#cd3131',
      brightGreen: '#00bc00',
      brightYellow: '#b5ba00',
      brightBlue: '#0451a5',
      brightMagenta: '#bc05bc',
      brightCyan: '#0598bc',
      brightWhite: '#a5a5a5'
    }
  }
};
let latestRuntimeContext: CanvasRuntimeContext = {
  workspaceTrusted: false,
  surfaceLocation: 'editor',
  defaultAgentProvider: 'codex',
  terminalScrollback: DEFAULT_TERMINAL_SCROLLBACK,
  editorMultiCursorModifier: 'alt',
  terminalWordSeparators: normalizeExecutionTerminalWordSeparators(undefined)
};
let embeddedTerminalThemeObserverDispose: (() => void) | undefined;
let embeddedTerminalAppearanceRefreshScheduled = false;

if (!rootElement) {
  throw new Error('Webview root element not found.');
}

const root = createRoot(rootElement);

function App(): JSX.Element {
  const [hostState, setHostState] = useState<CanvasPrototypeState | null>(null);
  const [runtimeContext, setRuntimeContext] = useState<CanvasRuntimeContext>({
    workspaceTrusted: false,
    surfaceLocation: latestRuntimeContext.surfaceLocation,
    defaultAgentProvider: latestRuntimeContext.defaultAgentProvider,
    terminalScrollback: latestRuntimeContext.terminalScrollback,
    editorMultiCursorModifier: latestRuntimeContext.editorMultiCursorModifier,
    terminalWordSeparators: latestRuntimeContext.terminalWordSeparators
  });
  const [localUiState, setLocalUiState] = useState<LocalUiState>(() => ({
    selectedNodeId: initialPersistedState.selectedNodeId,
    viewport: initialPersistedState.viewport
  }));
  const [nodeLayoutDrafts, setNodeLayoutDrafts] = useState<Record<string, CanvasNodeLayoutDraft>>({});
  const [contextMenu, setContextMenu] = useState<CanvasContextMenuState | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const clearErrorTimer = useRef<number | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const reactFlowRef = useRef<ReactFlowInstance<CanvasNodeData> | null>(null);

  useEffect(() => {
    const listener = (event: MessageEvent<HostToWebviewMessage>) => {
      const message = event.data;

      switch (message.type) {
        case 'host/bootstrap':
        case 'host/stateUpdated':
          latestRuntimeContext = message.payload.runtime;
          setHostState(message.payload.state);
          setRuntimeContext(message.payload.runtime);
          applyEmbeddedTerminalRuntimeContext(message.payload.runtime);
          scheduleEmbeddedTerminalAppearanceRefresh();
          break;
        case 'host/themeChanged':
          scheduleEmbeddedTerminalAppearanceRefresh();
          break;
        case 'host/visibilityRestored':
          scheduleExecutionTerminalVisibilityRestore();
          break;
        case 'host/executionSnapshot':
          routeExecutionTerminalSnapshot({
            type: 'snapshot',
            nodeId: message.payload.nodeId,
            kind: message.payload.kind,
            output: message.payload.output,
            cols: message.payload.cols,
            rows: message.payload.rows,
            liveSession: message.payload.liveSession,
            serializedTerminalState: message.payload.serializedTerminalState
          });
          break;
        case 'host/executionOutput':
          queueExecutionTerminalOutput({
            type: 'output',
            nodeId: message.payload.nodeId,
            kind: message.payload.kind,
            chunk: message.payload.chunk
          });
          break;
        case 'host/executionExit':
          routeExecutionTerminalExit({
            type: 'exit',
            nodeId: message.payload.nodeId,
            kind: message.payload.kind,
            message: message.payload.message
          });
          break;
        case 'host/executionFileLinksResolved':
          resolvePendingExecutionFileLinkResolutionRequest(
            message.payload.requestId,
            message.payload.resolvedLinks
          );
          break;
        case 'host/error':
          setErrorMessage(message.payload.message);
          if (clearErrorTimer.current) {
            window.clearTimeout(clearErrorTimer.current);
          }
          clearErrorTimer.current = window.setTimeout(() => setErrorMessage(null), 2600);
          break;
        case 'host/requestCreateNode':
          createNode(message.payload.kind, undefined, message.payload.agentProvider);
          break;
        case 'host/testProbeRequest':
          void respondWithWebviewProbeSnapshot(message.payload.requestId, message.payload.delayMs);
          break;
        case 'host/testDomAction':
          void performWebviewDomAction(message.payload.requestId, message.payload.action);
          break;
      }
    };

    window.addEventListener('message', listener);
    postMessage({ type: 'webview/ready' });

    return () => {
      window.removeEventListener('message', listener);
      if (clearErrorTimer.current) {
        window.clearTimeout(clearErrorTimer.current);
      }
      rejectPendingExecutionFileLinkResolutionRequests('Webview disposed before execution file links were resolved.');
    };
  }, []);

  useEffect(() => {
    latestRuntimeContext = runtimeContext;
  }, [runtimeContext]);

  useEffect(() => {
    ensureEmbeddedTerminalThemeObservers();
    scheduleEmbeddedTerminalAppearanceRefresh();

    return () => {
      embeddedTerminalThemeObserverDispose?.();
      embeddedTerminalThemeObserverDispose = undefined;
    };
  }, []);

  useEffect(() => {
    vscode.setState(localUiState);
  }, [localUiState]);

  useEffect(() => {
    if (!hostState) {
      return;
    }

    const validNodeIds = new Set(hostState.nodes.map((node) => node.id));
    setLocalUiState((current) =>
      current.selectedNodeId && !validNodeIds.has(current.selectedNodeId)
        ? {
            ...current,
            selectedNodeId: undefined
          }
        : current
    );
  }, [hostState]);

  const workspaceTrusted = runtimeContext.workspaceTrusted;
  const creatableKinds: CanvasNodeKind[] = workspaceTrusted ? ['agent', 'terminal', 'note'] : ['note'];

  const deleteNode = (nodeId: string): void => {
    setLocalUiState((current) =>
      current.selectedNodeId === nodeId
        ? {
            ...current,
            selectedNodeId: undefined
          }
        : current
    );
    postMessage({
      type: 'webview/deleteNode',
      payload: {
        nodeId
      }
    });
  };

  const closeContextMenu = (): void => {
    setContextMenu(null);
  };

  const focusNodeInViewport = (nodeId: string): void => {
    const reactFlowInstance = reactFlowRef.current;
    if (!reactFlowInstance?.viewportInitialized) {
      return;
    }

    const didFit = reactFlowInstance.fitView({
      nodes: [{ id: nodeId }],
      padding: NODE_FOCUS_VIEW_PADDING,
      maxZoom: NODE_FOCUS_MAX_ZOOM,
      minZoom: NODE_FOCUS_MIN_ZOOM
    });

    if (!didFit) {
      return;
    }

    const viewport = reactFlowInstance.getViewport();
    closeContextMenu();
    setLocalUiState((current) => ({
      ...current,
      selectedNodeId: nodeId,
      viewport
    }));
  };

  const baseNodes = toFlowNodes({
    nodes: hostState?.nodes ?? [],
    selectedNodeId: localUiState.selectedNodeId,
    workspaceTrusted,
    onSelectNode: (nodeId) => {
      if (localUiState.selectedNodeId === nodeId) {
        return;
      }

      setLocalUiState((current) => ({
        ...current,
        selectedNodeId: nodeId
      }));
    },
    onStartExecution: (nodeId, kind, cols, rows, provider, resume) =>
      postMessage({
        type: 'webview/startExecutionSession',
        payload: {
          nodeId,
          kind,
          cols,
          rows,
          provider,
          resume: resume === true
        }
      }),
    onAttachExecution: (nodeId, kind) =>
      postMessage({
        type: 'webview/attachExecutionSession',
        payload: { nodeId, kind }
      }),
    onExecutionInput: (nodeId, kind, data) =>
      postMessage({
        type: 'webview/executionInput',
        payload: { nodeId, kind, data }
      }),
    onDropExecutionResource: (nodeId, kind, resource) =>
      postMessage({
        type: 'webview/dropExecutionResource',
        payload: {
          nodeId,
          kind,
          resource
        }
      }),
    onOpenExecutionLink: (nodeId, kind, link) =>
      postMessage({
        type: 'webview/openExecutionLink',
        payload: {
          nodeId,
          kind,
          link
        }
      }),
    onResizeExecution: (nodeId, kind, cols, rows) =>
      postMessage({
        type: 'webview/resizeExecutionSession',
        payload: { nodeId, kind, cols, rows }
      }),
    onStopExecution: (nodeId, kind) =>
      postMessage({
        type: 'webview/stopExecutionSession',
        payload: { nodeId, kind }
      }),
    onUpdateNodeTitle: (nodeId, title) =>
      postMessage({
        type: 'webview/updateNodeTitle',
        payload: {
          nodeId,
          title
        }
      }),
    onUpdateNote: (payload) =>
      postMessage({
        type: 'webview/updateNoteNode',
        payload
      }),
    onResizeNode: (nodeId, position, size) =>
      postMessage({
        type: 'webview/resizeNode',
        payload: {
          nodeId,
          position,
          size
        }
      }),
    onFocusNodeInViewport: focusNodeInViewport,
    onDeleteNode: deleteNode
  });
  const nodes = applyCanvasNodeLayoutDrafts(baseNodes, nodeLayoutDrafts);

  useEffect(() => {
    setNodeLayoutDrafts((current) => pruneCanvasNodeLayoutDrafts(baseNodes, current));
  }, [hostState]);

  const updateLocalUiState = (nextState: LocalUiState): void => {
    setLocalUiState(nextState);
  };

  const handleNodeClick: NodeMouseHandler = (_event, node) => {
    if (isInteractiveTarget(_event.target)) {
      return;
    }

    closeContextMenu();
    updateLocalUiState({
      ...localUiState,
      selectedNodeId: node.id
    });
  };

  const handlePaneClick = (): void => {
    closeContextMenu();
    if (!localUiState.selectedNodeId) {
      return;
    }

    updateLocalUiState({
      ...localUiState,
      selectedNodeId: undefined
    });
  };

  const handleNodeDragStop: NodeMouseHandler = (_event, node) => {
    postMessage({
      type: 'webview/moveNode',
      payload: {
        id: node.id,
        position: node.position
      }
    });
  };

  const handleNodesChange = (changes: any[]): void => {
    setNodeLayoutDrafts((current) => {
      const currentNodes = applyCanvasNodeLayoutDrafts(baseNodes, current);
      const nextNodes = applyNodeChanges(changes, currentNodes);
      return collectCanvasNodeLayoutDrafts(baseNodes, nextNodes);
    });
  };

  const handleMoveEnd = (_event: MouseEvent | TouchEvent | null, viewport: Viewport): void => {
    updateLocalUiState({
      ...localUiState,
      viewport
    });
  };

  const handleMoveStart = (): void => {
    closeContextMenu();
  };

  const handlePaneContextMenu = (event: React.MouseEvent): void => {
    event.preventDefault();
    stopCanvasEvent(event);

    const reactFlowInstance = reactFlowRef.current;
    if (!reactFlowInstance?.viewportInitialized) {
      return;
    }

    const flowAnchor = reactFlowInstance.screenToFlowPosition({
      x: event.clientX,
      y: event.clientY
    });

    setLocalUiState((current) => ({
      ...current,
      selectedNodeId: undefined
    }));
    setContextMenu({
      screenX: event.clientX,
      screenY: event.clientY,
      flowAnchor: {
        x: Math.round(flowAnchor.x),
        y: Math.round(flowAnchor.y)
      },
      view: 'root'
    });
  };

  useEffect(() => {
    const selectedNodeId = localUiState.selectedNodeId;
    if (!selectedNodeId) {
      return;
    }

    const handleWindowKeyDown = (event: KeyboardEvent): void => {
      if (!shouldDeleteSelectedNodeFromKeyboard(event)) {
        return;
      }

      event.preventDefault();
      deleteNode(selectedNodeId);
    };

    window.addEventListener('keydown', handleWindowKeyDown);
    return () => {
      window.removeEventListener('keydown', handleWindowKeyDown);
    };
  }, [localUiState.selectedNodeId]);

  useEffect(() => {
    if (!contextMenu) {
      return;
    }

    const handlePointerDown = (event: PointerEvent): void => {
      if (event.target instanceof globalThis.Node && contextMenuRef.current?.contains(event.target)) {
        return;
      }

      closeContextMenu();
    };

    const handleWindowKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') {
        return;
      }

      event.preventDefault();
      closeContextMenu();
    };

    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('keydown', handleWindowKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('keydown', handleWindowKeyDown);
    };
  }, [contextMenu]);

  return (
    <div className="canvas-shell">
      <CanvasExecutionHelpPanel help={EXECUTION_NODE_HELP_TIPS} />
      <ReactFlow
        nodes={nodes}
        edges={[]}
        nodeTypes={nodeTypes}
        fitView={!localUiState.viewport}
        fitViewOptions={{ padding: CANVAS_FIT_VIEW_PADDING }}
        defaultViewport={localUiState.viewport}
        minZoom={0.4}
        maxZoom={1.8}
        onInit={(instance) => {
          reactFlowRef.current = instance;
        }}
        onNodesChange={handleNodesChange}
        onNodeClick={handleNodeClick}
        onNodeDragStop={handleNodeDragStop}
        onMoveStart={handleMoveStart}
        onPaneClick={handlePaneClick}
        onPaneContextMenu={handlePaneContextMenu}
        onMoveEnd={handleMoveEnd}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1.2} />
        <MiniMap
          className="canvas-corner-panel canvas-minimap"
          position="bottom-right"
          style={{ width: 194, height: 126 }}
          pannable
          zoomable
          nodeColor={(node) => minimapFillColorForKind((node.data as CanvasNodeData).kind)}
          nodeStrokeColor={(node) => minimapStrokeColorForKind((node.data as CanvasNodeData).kind)}
          nodeBorderRadius={4}
          nodeStrokeWidth={1.2}
          maskColor="color-mix(in srgb, var(--vscode-editor-background) 74%, transparent)"
          maskStrokeColor="var(--vscode-focusBorder)"
          maskStrokeWidth={1.5}
        />
        <Controls
          className="canvas-corner-panel canvas-controls"
          showInteractive={false}
          fitViewOptions={{ padding: CANVAS_FIT_VIEW_PADDING }}
        />
      </ReactFlow>

      {contextMenu ? (
        <CanvasContextMenu
          ref={contextMenuRef}
          screenX={contextMenu.screenX}
          screenY={contextMenu.screenY}
          view={contextMenu.view}
          kinds={creatableKinds}
          defaultAgentProvider={runtimeContext.defaultAgentProvider}
          onCreate={(kind, agentProvider) => {
            createNode(
              kind,
              resolveCreateNodePreferredPositionFromFlowAnchor(kind, contextMenu.flowAnchor),
              agentProvider
            );
            closeContextMenu();
          }}
          onShowAgentProviders={() =>
            setContextMenu((current) => (current ? { ...current, view: 'agent-provider' } : current))
          }
          onBack={() =>
            setContextMenu((current) => (current ? { ...current, view: 'root' } : current))
          }
          onClose={closeContextMenu}
        />
      ) : null}

      {errorMessage ? (
        <div className="toast-error" data-toast-kind="error">
          {errorMessage}
        </div>
      ) : null}
    </div>
  );

  function createNode(
    kind: CanvasNodeKind,
    preferredPosition?: CanvasNodePosition,
    agentProvider?: AgentProviderKind
  ): void {
    postMessage({
      type: 'webview/createDemoNode',
      payload: {
        kind,
        preferredPosition:
          preferredPosition ?? resolveCreateNodePreferredPosition(kind, reactFlowRef.current),
        agentProvider
      }
    });
  }
}

function AgentSessionNode({ id, data }: NodeProps<CanvasNodeData>): JSX.Element {
  const agentMetadata = data.metadata?.agent;
  if (!agentMetadata) {
    return <CanvasCardNode id={id} data={data} />;
  }

  const { zoom } = useViewport();
  const provider = agentMetadata.provider ?? 'codex';
  const executionBlocked = !data.workspaceTrusted;
  const lifecycle = agentMetadata.lifecycle;
  const displayStatus = data.status;
  const resumeRequested =
    (lifecycle === 'resume-ready' ||
      lifecycle === 'resume-failed' ||
      agentMetadata.pendingLaunch === 'resume');
  const reattaching = displayStatus === 'reattaching';
  const frameRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const resizeFrameRef = useRef<number | undefined>(undefined);
  const autoLaunchRef = useRef<string | null>(null);
  const zoomRef = useRef(zoom);
  const terminalSizeRef = useRef({
    cols: agentMetadata.lastCols ?? 96,
    rows: agentMetadata.lastRows ?? 28
  });
  const terminalFlagsRef = useRef({
    liveSession: agentMetadata.liveSession
  });

  useEffect(() => {
    terminalSizeRef.current = {
      cols: agentMetadata.lastCols ?? terminalSizeRef.current.cols,
      rows: agentMetadata.lastRows ?? terminalSizeRef.current.rows
    };
  }, [agentMetadata.lastCols, agentMetadata.lastRows]);

  useEffect(() => {
    terminalFlagsRef.current = {
      liveSession: agentMetadata.liveSession
    };
  }, [agentMetadata.liveSession]);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  useEffect(() => {
    const frame = frameRef.current;
    const container = viewportRef.current;
    if (!frame || !container) {
      return;
    }

    const terminal = new Terminal(createEmbeddedTerminalOptions());
    const fitAddon = new FitAddon();
    const controller = createExecutionTerminalController(terminal);
    const nativeInteractions = setupExecutionTerminalNativeInteractions({
      nodeId: id,
      kind: 'agent',
      terminal,
      dropTarget: frame,
      getRuntimeContext: () => latestRuntimeContext,
      onDropResource: (nodeId, kind, resource) => data.onDropExecutionResource?.(nodeId, kind, resource),
      onOpenLink: (nodeId, kind, link) => data.onOpenExecutionLink?.(nodeId, kind, link),
      resolveFileLinks: resolveExecutionTerminalFileLinks
    });
    terminal.loadAddon(fitAddon);
    terminal.open(container);
    executionTerminalRegistry.set(id, {
      terminal,
      fitAddon,
      controller,
      nativeInteractions
    });

    const internalCore = (terminal as unknown as { _core?: XtermCoreWithMouseInternals })._core;
    const mouseService = internalCore?._mouseService;
    const selectionService = internalCore?._selectionService;
    const originalGetCoords = mouseService?.getCoords?.bind(mouseService);
    const originalGetMouseReportCoords = mouseService?.getMouseReportCoords?.bind(mouseService);
    const originalGetMouseEventScrollAmount = selectionService?._getMouseEventScrollAmount?.bind(selectionService);
    const terminalElement = terminal.element;

    if (mouseService && originalGetCoords) {
      mouseService.getCoords = (event, element, colCount, rowCount, isSelection) =>
        originalGetCoords(
          createZoomAdjustedMouseEvent(event, element, zoomRef.current),
          element,
          colCount,
          rowCount,
          isSelection
        );
    }

    if (mouseService && originalGetMouseReportCoords) {
      mouseService.getMouseReportCoords = (event, element) =>
        originalGetMouseReportCoords(
          createZoomAdjustedMouseEvent(event, element, zoomRef.current) as MouseEvent,
          element
        );
    }

    if (selectionService && originalGetMouseEventScrollAmount) {
      selectionService._getMouseEventScrollAmount = (event: MouseEvent): number => {
        const screenElement = selectionService._screenElement ?? readXtermScreenElement(terminal);
        if (!screenElement) {
          return originalGetMouseEventScrollAmount(event);
        }

        return originalGetMouseEventScrollAmount(
          createZoomAdjustedMouseEvent(event, screenElement, zoomRef.current) as MouseEvent
        );
      };
    }

    const syncTextareaToScaledMouse = (event: MouseEvent): void => {
      window.requestAnimationFrame(() => {
        positionTextareaUnderScaledMouse(event, terminal, zoomRef.current);
      });
    };
    const handleContextMenu = (event: MouseEvent): void => {
      syncTextareaToScaledMouse(event);
    };
    const handleAuxClick = (event: MouseEvent): void => {
      if (event.button === 1) {
        syncTextareaToScaledMouse(event);
      }
    };

    terminalElement?.addEventListener('contextmenu', handleContextMenu);
    terminalElement?.addEventListener('auxclick', handleAuxClick);

    const fitTerminal = (): void => {
      fitAddon.fit();
      terminalSizeRef.current = {
        cols: terminal.cols,
        rows: terminal.rows
      };

      if (terminal.cols <= 0 || terminal.rows <= 0) {
        return;
      }

      data.onResizeExecution?.(id, 'agent', terminal.cols, terminal.rows);
    };

    window.requestAnimationFrame(fitTerminal);

    const resizeObserver = new ResizeObserver(() => {
      if (resizeFrameRef.current) {
        window.cancelAnimationFrame(resizeFrameRef.current);
      }

      resizeFrameRef.current = window.requestAnimationFrame(fitTerminal);
    });
    resizeObserver.observe(container);

    const dataDisposable = terminal.onData((input) => data.onExecutionInput?.(id, 'agent', input));
    const selectionDisposable = terminal.onSelectionChange(() => data.onSelectNode?.(id));
    const resizeDisposable = terminal.onResize(({ cols, rows }) => {
      terminalSizeRef.current = {
        cols,
        rows
      };
    });

    data.onAttachExecution?.(id, 'agent');

    return () => {
      dataDisposable.dispose();
      selectionDisposable.dispose();
      resizeDisposable.dispose();
      resizeObserver.disconnect();
      terminalElement?.removeEventListener('contextmenu', handleContextMenu);
      terminalElement?.removeEventListener('auxclick', handleAuxClick);
      if (mouseService && originalGetCoords) {
        mouseService.getCoords = originalGetCoords;
      }
      if (mouseService && originalGetMouseReportCoords) {
        mouseService.getMouseReportCoords = originalGetMouseReportCoords;
      }
      if (selectionService && originalGetMouseEventScrollAmount) {
        selectionService._getMouseEventScrollAmount = originalGetMouseEventScrollAmount;
      }
      if (resizeFrameRef.current) {
        window.cancelAnimationFrame(resizeFrameRef.current);
      }
      controller.dispose();
      nativeInteractions.dispose();
      executionTerminalRegistry.delete(id);
      terminal.dispose();
    };
  }, [id]);

  useEffect(() => {
    if (agentMetadata.liveSession) {
      data.onAttachExecution?.(id, 'agent');
    }
  }, [agentMetadata.liveSession, id]);

  const startAgent = (resume = resumeRequested): void => {
    data.onSelectNode?.(id);
    data.onStartExecution?.(
      id,
      'agent',
      terminalSizeRef.current.cols,
      terminalSizeRef.current.rows,
      provider,
      resume
    );
  };

  const stopAgent = (): void => {
    data.onSelectNode?.(id);
    data.onStopExecution?.(id, 'agent');
  };

  const deleteAgent = (): void => {
    data.onSelectNode?.(id);
    data.onDeleteNode?.(id);
  };

  useEffect(() => {
    if (!agentMetadata.pendingLaunch) {
      autoLaunchRef.current = null;
      return;
    }

    if (executionBlocked || agentMetadata.liveSession || autoLaunchRef.current === agentMetadata.pendingLaunch) {
      return;
    }

    autoLaunchRef.current = agentMetadata.pendingLaunch;
    const frame = window.requestAnimationFrame(() => startAgent(agentMetadata.pendingLaunch === 'resume'));
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [agentMetadata.liveSession, agentMetadata.pendingLaunch, executionBlocked, id, provider]);

  return (
    <div
      className={`canvas-node session-node agent-session-node kind-agent ${data.selected ? 'is-selected' : ''}`}
      data-node-id={id}
      data-node-kind={data.kind}
      data-node-selected={data.selected ? 'true' : 'false'}
    >
      <NodeResizeAffordance id={id} data={data} />
      <div className="window-chrome" onDoubleClick={(event) => handleNodeChromeDoubleClick(event, id, data)}>
        <ChromeTitleEditor
          value={data.title}
          subtitle={agentMetadata.lastBackendLabel ?? `${providerLabel(provider)} CLI`}
          subtitleAccessory={<ExecutionHelpTrigger help={EXECUTION_NODE_HELP_TIPS} variant="inline" />}
          placeholder="Agent 标题"
          onSelectNode={() => data.onSelectNode?.(id)}
          onSubmit={(title) => data.onUpdateNodeTitle?.(id, title)}
        />
        <div className="window-chrome-actions">
          <span className={`status-pill ${statusToneClass(displayStatus)}`}>
            {humanizeStatus(displayStatus)}
          </span>
          <ActionButton
            label={
              agentMetadata.liveSession
                ? '停止'
                : resumeRequested
                  ? '恢复'
                  : agentMetadata.lastExitMessage
                    ? '重启'
                    : '启动'
            }
            onClick={() => (agentMetadata.liveSession ? stopAgent() : startAgent())}
            tone="primary"
            disabled={executionBlocked || reattaching}
            className="nodrag nopan compact"
            interactive
            onFocus={() => data.onSelectNode?.(id)}
          />
          <ActionButton
            label="删除"
            tone="danger"
            onClick={deleteAgent}
            className="nodrag nopan compact"
            interactive
            onFocus={() => data.onSelectNode?.(id)}
          />
        </div>
      </div>

      <div className="session-body">
        <div
          ref={frameRef}
          className={`terminal-frame nowheel nodrag nopan ${agentMetadata.liveSession ? 'is-live' : 'is-idle'}`}
          data-node-interactive="true"
          onMouseDown={(event) => {
            stopCanvasEvent(event);
            data.onSelectNode?.(id);
          }}
          onClick={(event) => {
            stopCanvasEvent(event);
            data.onSelectNode?.(id);
          }}
          onDoubleClick={stopCanvasEvent}
          onWheel={stopCanvasEvent}
        >
          <div ref={viewportRef} className="terminal-viewport" />
          {!agentMetadata.liveSession ? (
            <div className="terminal-overlay">
              <strong>
                {executionBlocked
                  ? 'Restricted Mode'
                  : reattaching
                    ? 'Agent 重连中'
                    : displayStatus === 'history-restored'
                      ? '历史恢复'
                  : lifecycle === 'resume-ready'
                    ? 'Agent 可恢复'
                    : lifecycle === 'resume-failed'
                      ? 'Agent 恢复失败'
                  : agentMetadata.lastExitMessage
                    ? 'Agent 当前未运行'
                    : 'Agent 尚未启动'}
              </strong>
              <span>
                {executionBlocked
                  ? '当前 workspace 未受信任，Agent 会话入口已禁用。'
                  : reattaching
                    ? data.summary
                    : displayStatus === 'history-restored'
                      ? data.summary
                  : lifecycle === 'resume-ready'
                    ? data.summary
                    : lifecycle === 'resume-failed'
                      ? agentMetadata.lastResumeError ?? data.summary
                  : agentMetadata.lastExitMessage
                    ? agentMetadata.lastExitMessage
                    : data.summary}
              </span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function TerminalSessionNode({ id, data }: NodeProps<CanvasNodeData>): JSX.Element {
  const terminalMetadata = data.metadata?.terminal;
  if (!terminalMetadata) {
    return <CanvasCardNode id={id} data={data} />;
  }

  const { zoom } = useViewport();
  const executionBlocked = !data.workspaceTrusted;
  const lifecycle = terminalMetadata.lifecycle;
  const displayStatus = data.status;
  const reattaching = displayStatus === 'reattaching';
  const frameRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const autoLaunchRef = useRef<string | null>(null);
  const zoomRef = useRef(zoom);
  const terminalSizeRef = useRef({
    cols: terminalMetadata.lastCols ?? 96,
    rows: terminalMetadata.lastRows ?? 28
  });
  const resizeFrameRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    terminalSizeRef.current = {
      cols: terminalMetadata.lastCols ?? terminalSizeRef.current.cols,
      rows: terminalMetadata.lastRows ?? terminalSizeRef.current.rows
    };
  }, [terminalMetadata.lastCols, terminalMetadata.lastRows]);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  useEffect(() => {
    const frame = frameRef.current;
    const container = viewportRef.current;
    if (!frame || !container) {
      return;
    }

    const terminal = new Terminal(createEmbeddedTerminalOptions());
    const fitAddon = new FitAddon();
    const controller = createExecutionTerminalController(terminal);
    const nativeInteractions = setupExecutionTerminalNativeInteractions({
      nodeId: id,
      kind: 'terminal',
      terminal,
      dropTarget: frame,
      getRuntimeContext: () => latestRuntimeContext,
      onDropResource: (nodeId, kind, resource) => data.onDropExecutionResource?.(nodeId, kind, resource),
      onOpenLink: (nodeId, kind, link) => data.onOpenExecutionLink?.(nodeId, kind, link),
      resolveFileLinks: resolveExecutionTerminalFileLinks
    });
    terminal.loadAddon(fitAddon);
    terminal.open(container);
    executionTerminalRegistry.set(id, {
      terminal,
      fitAddon,
      controller,
      nativeInteractions
    });

    const internalCore = (terminal as unknown as { _core?: XtermCoreWithMouseInternals })._core;
    const mouseService = internalCore?._mouseService;
    const selectionService = internalCore?._selectionService;
    const originalGetCoords = mouseService?.getCoords?.bind(mouseService);
    const originalGetMouseReportCoords = mouseService?.getMouseReportCoords?.bind(mouseService);
    const originalGetMouseEventScrollAmount = selectionService?._getMouseEventScrollAmount?.bind(selectionService);
    const terminalElement = terminal.element;

    if (mouseService && originalGetCoords) {
      mouseService.getCoords = (event, element, colCount, rowCount, isSelection) =>
        originalGetCoords(
          createZoomAdjustedMouseEvent(event, element, zoomRef.current),
          element,
          colCount,
          rowCount,
          isSelection
        );
    }

    if (mouseService && originalGetMouseReportCoords) {
      mouseService.getMouseReportCoords = (event, element) =>
        originalGetMouseReportCoords(
          createZoomAdjustedMouseEvent(event, element, zoomRef.current) as MouseEvent,
          element
        );
    }

    if (selectionService && originalGetMouseEventScrollAmount) {
      selectionService._getMouseEventScrollAmount = (event: MouseEvent): number => {
        const screenElement = selectionService._screenElement ?? readXtermScreenElement(terminal);
        if (!screenElement) {
          return originalGetMouseEventScrollAmount(event);
        }

        return originalGetMouseEventScrollAmount(
          createZoomAdjustedMouseEvent(event, screenElement, zoomRef.current) as MouseEvent
        );
      };
    }

    const syncTextareaToScaledMouse = (event: MouseEvent): void => {
      window.requestAnimationFrame(() => {
        positionTextareaUnderScaledMouse(event, terminal, zoomRef.current);
      });
    };
    const handleContextMenu = (event: MouseEvent): void => {
      syncTextareaToScaledMouse(event);
    };
    const handleAuxClick = (event: MouseEvent): void => {
      if (event.button === 1) {
        syncTextareaToScaledMouse(event);
      }
    };

    terminalElement?.addEventListener('contextmenu', handleContextMenu);
    terminalElement?.addEventListener('auxclick', handleAuxClick);

    const fitTerminal = (): void => {
      fitAddon.fit();
      terminalSizeRef.current = {
        cols: terminal.cols,
        rows: terminal.rows
      };

      if (terminal.cols <= 0 || terminal.rows <= 0) {
        return;
      }

      data.onResizeExecution?.(id, 'terminal', terminal.cols, terminal.rows);
    };

    window.requestAnimationFrame(fitTerminal);

    const resizeObserver = new ResizeObserver(() => {
      if (resizeFrameRef.current) {
        window.cancelAnimationFrame(resizeFrameRef.current);
      }

      resizeFrameRef.current = window.requestAnimationFrame(fitTerminal);
    });
    resizeObserver.observe(container);

    const dataDisposable = terminal.onData((input) => data.onExecutionInput?.(id, 'terminal', input));
    const selectionDisposable = terminal.onSelectionChange(() => data.onSelectNode?.(id));
    const resizeDisposable = terminal.onResize(({ cols, rows }) => {
      terminalSizeRef.current = {
        cols,
        rows
      };
    });

    data.onAttachExecution?.(id, 'terminal');

    return () => {
      dataDisposable.dispose();
      selectionDisposable.dispose();
      resizeDisposable.dispose();
      resizeObserver.disconnect();
      terminalElement?.removeEventListener('contextmenu', handleContextMenu);
      terminalElement?.removeEventListener('auxclick', handleAuxClick);
      if (mouseService && originalGetCoords) {
        mouseService.getCoords = originalGetCoords;
      }
      if (mouseService && originalGetMouseReportCoords) {
        mouseService.getMouseReportCoords = originalGetMouseReportCoords;
      }
      if (selectionService && originalGetMouseEventScrollAmount) {
        selectionService._getMouseEventScrollAmount = originalGetMouseEventScrollAmount;
      }
      if (resizeFrameRef.current) {
        window.cancelAnimationFrame(resizeFrameRef.current);
      }
      controller.dispose();
      nativeInteractions.dispose();
      executionTerminalRegistry.delete(id);
      terminal.dispose();
    };
  }, [id]);

  useEffect(() => {
    if (terminalMetadata.liveSession) {
      data.onAttachExecution?.(id, 'terminal');
    }
  }, [id, terminalMetadata.liveSession]);

  const startTerminal = (): void => {
    data.onSelectNode?.(id);
    data.onStartExecution?.(id, 'terminal', terminalSizeRef.current.cols, terminalSizeRef.current.rows);
  };

  const stopTerminal = (): void => {
    data.onSelectNode?.(id);
    data.onStopExecution?.(id, 'terminal');
  };

  const deleteTerminal = (): void => {
    data.onSelectNode?.(id);
    data.onDeleteNode?.(id);
  };

  useEffect(() => {
    if (!terminalMetadata.pendingLaunch) {
      autoLaunchRef.current = null;
      return;
    }

    if (executionBlocked || terminalMetadata.liveSession || autoLaunchRef.current === terminalMetadata.pendingLaunch) {
      return;
    }

    autoLaunchRef.current = terminalMetadata.pendingLaunch;
    const frame = window.requestAnimationFrame(startTerminal);
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [executionBlocked, id, terminalMetadata.liveSession, terminalMetadata.pendingLaunch]);

  return (
    <div
      className={`canvas-node session-node terminal-session-node kind-terminal ${data.selected ? 'is-selected' : ''}`}
      data-node-id={id}
      data-node-kind={data.kind}
      data-node-selected={data.selected ? 'true' : 'false'}
    >
      <NodeResizeAffordance id={id} data={data} />
      <div className="window-chrome" onDoubleClick={(event) => handleNodeChromeDoubleClick(event, id, data)}>
        <ChromeTitleEditor
          value={data.title}
          subtitle={terminalMetadata.shellPath}
          subtitleAccessory={<ExecutionHelpTrigger help={EXECUTION_NODE_HELP_TIPS} variant="inline" />}
          placeholder="Terminal 标题"
          className="terminal-window-title"
          onSelectNode={() => data.onSelectNode?.(id)}
          onSubmit={(title) => data.onUpdateNodeTitle?.(id, title)}
        />
        <div className="window-chrome-actions">
          <span className={`status-pill ${statusToneClass(displayStatus)}`}>
            {humanizeStatus(displayStatus)}
          </span>
          <ActionButton
            label={terminalMetadata.liveSession ? '停止' : terminalMetadata.lastExitMessage ? '重启' : '启动'}
            onClick={() => (terminalMetadata.liveSession ? stopTerminal() : startTerminal())}
            tone="primary"
            disabled={executionBlocked || reattaching}
            className="nodrag nopan compact"
            interactive
            onFocus={() => data.onSelectNode?.(id)}
          />
          <ActionButton
            label="删除"
            tone="danger"
            onClick={deleteTerminal}
            className="nodrag nopan compact"
            interactive
            onFocus={() => data.onSelectNode?.(id)}
          />
        </div>
      </div>

      <div className="session-body terminal-session-body">
        <div
          ref={frameRef}
          className={`terminal-frame nowheel nodrag nopan ${terminalMetadata.liveSession ? 'is-live' : 'is-idle'}`}
          data-node-interactive="true"
          onMouseDown={(event) => {
            stopCanvasEvent(event);
            data.onSelectNode?.(id);
          }}
          onClick={(event) => {
            stopCanvasEvent(event);
            data.onSelectNode?.(id);
          }}
          onDoubleClick={stopCanvasEvent}
          onWheel={stopCanvasEvent}
        >
          <div ref={viewportRef} className="terminal-viewport" />
          {!terminalMetadata.liveSession ? (
            <div className="terminal-overlay">
              <strong>
                {executionBlocked
                  ? 'Restricted Mode'
                  : reattaching
                    ? '终端重连中'
                    : displayStatus === 'history-restored'
                      ? '历史恢复'
                  : lifecycle === 'interrupted'
                    ? '终端已中断'
                  : terminalMetadata.lastExitMessage
                    ? '终端当前未运行'
                    : '终端尚未启动'}
              </strong>
              <span>
                {executionBlocked
                  ? '当前 workspace 未受信任，嵌入式终端入口已禁用。'
                  : reattaching
                    ? data.summary
                    : displayStatus === 'history-restored'
                      ? data.summary
                  : lifecycle === 'interrupted'
                    ? data.summary
                  : terminalMetadata.lastExitMessage
                    ? terminalMetadata.lastExitMessage
                    : data.summary}
              </span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function RestrictedBanner(props: { title: string; description: string }): JSX.Element {
  return (
    <div className="restricted-banner">
      <strong>{props.title}</strong>
      <span>{props.description}</span>
    </div>
  );
}

function NodeResizeAffordance({ id, data }: Pick<NodeProps<CanvasNodeData>, 'id' | 'data'>): JSX.Element {
  const minimum = minimumCanvasNodeFootprint(data.kind);

  return (
    <NodeResizer
      nodeId={id}
      isVisible={data.selected}
      minWidth={minimum.width}
      minHeight={minimum.height}
      handleClassName="canvas-node-resize-handle"
      lineClassName="canvas-node-resize-line"
      color={colorForKind(data.kind)}
      onResizeStart={() => {
        data.onSelectNode?.(id);
      }}
      onResizeEnd={(_event, params) => {
        const nextSize = normalizeCanvasNodeFootprint(data.kind, {
          width: params.width,
          height: params.height
        });

        if (
          nextSize.width === data.size.width &&
          nextSize.height === data.size.height
        ) {
          return;
        }

        data.onResizeNode?.(
          id,
          {
            x: Math.round(params.x),
            y: Math.round(params.y)
          },
          nextSize
        );
      }}
    />
  );
}

function NoteEditableNode({ id, data }: NodeProps<CanvasNodeData>): JSX.Element {
  const noteMetadata = data.metadata?.note;
  if (!noteMetadata) {
    return <CanvasCardNode id={id} data={data} />;
  }

  const [content, setContent] = useState(noteMetadata.content);
  const [isEditingBody, setIsEditingBody] = useState(false);
  const [isComposing, setIsComposing] = useState(false);
  const committedContentRef = useRef(noteMetadata.content);

  useLayoutEffect(() => {
    committedContentRef.current = noteMetadata.content;
    if (!isEditingBody && !isComposing) {
      setContent(noteMetadata.content);
    }
  }, [id, isComposing, isEditingBody, noteMetadata.content]);

  const submitNote = (nextContent: string): void => {
    if (nextContent === committedContentRef.current) {
      return;
    }

    committedContentRef.current = nextContent;
    data.onUpdateNote?.({
      nodeId: id,
      content: nextContent
    });
  };

  const deleteNote = (): void => {
    data.onSelectNode?.(id);
    data.onDeleteNode?.(id);
  };

  return (
    <div
      className={`canvas-node object-editor-node kind-note ${data.selected ? 'is-selected' : ''}`}
      data-node-id={id}
      data-node-kind={data.kind}
      data-node-selected={data.selected ? 'true' : 'false'}
    >
      <NodeResizeAffordance id={id} data={data} />
      <div className="window-chrome" onDoubleClick={(event) => handleNodeChromeDoubleClick(event, id, data)}>
        <ChromeTitleEditor
          value={data.title}
          placeholder="Note 标题"
          className="note-window-title"
          onSelectNode={() => data.onSelectNode?.(id)}
          onSubmit={(title) => data.onUpdateNodeTitle?.(id, title)}
        />
        <div className="window-chrome-actions">
          <ActionButton
            label="删除"
            tone="danger"
            onClick={deleteNote}
            className="nodrag nopan compact"
            interactive
            onFocus={() => data.onSelectNode?.(id)}
          />
        </div>
      </div>

      <div className="object-body object-surface note-surface">
        <div className="note-editor-surface">
          <textarea
            className="node-document-input note-document-input nowheel nodrag nopan"
            data-node-interactive="true"
            data-probe-field="body"
            value={content}
            onFocus={() => {
              setIsEditingBody(true);
              data.onSelectNode?.(id);
            }}
            onMouseDown={stopCanvasEvent}
            onClick={stopCanvasEvent}
            onWheel={stopCanvasEvent}
            onCompositionStart={() => setIsComposing(true)}
            onCompositionEnd={(event) => {
              setIsComposing(false);
              setContent(event.currentTarget.value);
            }}
            onChange={(event) => setContent(event.target.value)}
            onBlur={(event) => {
              const nextContent = event.currentTarget.value;
              setContent(nextContent);
              setIsEditingBody(false);
              submitNote(nextContent);
            }}
            onKeyDown={(event) =>
              handleEditableFieldKeyDown(
                event,
                () => submitNote(event.currentTarget.value),
                { isComposing }
              )
            }
            placeholder="直接在画布上记录思路、上下文、待确认点或下一轮要回来的线索。"
          />
        </div>
      </div>
    </div>
  );
}

function CanvasCardNode({ id, data }: Pick<NodeProps<CanvasNodeData>, 'id' | 'data'>): JSX.Element {
  const agentMetadata = data.metadata?.agent;
  const terminalMetadata = data.metadata?.terminal;

  return (
    <div
      className={`canvas-node compact-node kind-${data.kind} ${data.selected ? 'is-selected' : ''}`}
      data-node-id={id}
      data-node-kind={data.kind}
      data-node-selected={data.selected ? 'true' : 'false'}
    >
      <NodeResizeAffordance id={id} data={data} />
      <div className="node-topline">
        <strong>{data.title}</strong>
        <span>{data.kind}</span>
      </div>
      <div className="node-status">状态：{humanizeStatus(data.status)}</div>
      {data.kind === 'agent' && agentMetadata ? (
        <div className="node-hint">
          {agentMetadata.liveSession
            ? `${providerLabel(agentMetadata.provider)} 会话正在运行`
            : agentMetadata.recentOutput
              ? '已保留最近输出摘要'
              : 'Agent 未运行，可在节点内启动'}
        </div>
      ) : null}
      {data.kind === 'terminal' && terminalMetadata ? (
        <div className="node-hint">
          {terminalMetadata.liveSession ? '节点内终端正在运行' : '终端未运行，可在节点内启动'}
        </div>
      ) : null}
      <p>{data.summary}</p>
      <div className="action-row compact-node-actions">
        <ActionButton
          label="删除"
          tone="danger"
          onClick={() => data.onDeleteNode?.(id)}
          className="compact nodrag nopan"
          interactive
          onFocus={() => data.onSelectNode?.(id)}
        />
      </div>
    </div>
  );
}

const nodeTypes = {
  agent: AgentSessionNode,
  terminal: TerminalSessionNode,
  note: NoteEditableNode,
  card: CanvasCardNode
};

function CanvasExecutionHelpPanel(props: { help: ExecutionNodeHelpContent }): JSX.Element {
  return (
    <div className="canvas-corner-panel canvas-help-panel">
      <ExecutionHelpTrigger help={props.help} variant="canvas" />
    </div>
  );
}

function ExecutionHelpTrigger(props: {
  help: ExecutionNodeHelpContent;
  variant: ExecutionHelpTriggerVariant;
}): JSX.Element {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const tooltipIdRef = useRef<string>('');
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [position, setPosition] = useState<FloatingTooltipPosition | null>(null);
  const visible = hovered || focused;
  const label = props.variant === 'canvas' ? '使用提示' : undefined;
  const showGlyph = props.variant === 'inline';

  if (!tooltipIdRef.current) {
    tooltipIdRef.current = `execution-node-help-tooltip-${nextExecutionNodeHelpTooltipId++}`;
  }

  useLayoutEffect(() => {
    if (!visible) {
      setPosition(null);
      return;
    }

    const updatePosition = (): void => {
      const button = buttonRef.current;
      const tooltip = tooltipRef.current;
      if (!button || !tooltip) {
        return;
      }

      const margin = 12;
      const gap = 8;
      const buttonRect = button.getBoundingClientRect();
      const tooltipRect = tooltip.getBoundingClientRect();
      const maxLeft = Math.max(margin, window.innerWidth - margin - tooltipRect.width);
      const maxTop = Math.max(margin, window.innerHeight - margin - tooltipRect.height);
      let left = buttonRect.right - tooltipRect.width;
      let top = buttonRect.bottom + gap;

      if (top + tooltipRect.height > window.innerHeight - margin) {
        top = buttonRect.top - tooltipRect.height - gap;
      }

      left = Math.min(Math.max(margin, left), maxLeft);
      top = Math.min(Math.max(margin, top), maxTop);
      setPosition({ left, top });
    };

    const frame = window.requestAnimationFrame(updatePosition);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [visible]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`execution-help-trigger execution-help-trigger-${props.variant}`}
        data-node-interactive="true"
        aria-label={EXECUTION_TERMINAL_HELP_TOOLTIP}
        aria-describedby={visible ? tooltipIdRef.current : undefined}
        onMouseDown={stopCanvasEvent}
        onClick={stopCanvasEvent}
        onKeyDown={(event) => {
          stopCanvasEvent(event);
          if (event.key === 'Escape') {
            setHovered(false);
            setFocused(false);
            event.currentTarget.blur();
          }
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      >
        {showGlyph ? (
          <span
            className="execution-help-trigger-icon codicon codicon-info"
            aria-hidden="true"
          />
        ) : null}
        {label ? <span className="execution-help-trigger-label">{label}</span> : null}
      </button>
      {visible
        ? createPortal(
            <div
              ref={tooltipRef}
              id={tooltipIdRef.current}
              role="tooltip"
              className={`execution-node-help-tooltip${position ? ' is-visible' : ''}`}
              style={
                position
                  ? {
                      left: position.left,
                      top: position.top
                    }
                  : undefined
              }
            >
              <strong className="execution-node-help-tooltip-title">{props.help.title}</strong>
              <div className="execution-node-help-tooltip-items">
                {props.help.items.map((item, index) => (
                  <div key={`${index}-${item}`} className="execution-node-help-tooltip-item">
                    <span className="execution-node-help-tooltip-index">{`${index + 1}. `}</span>
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
}

function ActionButton(props: {
  label: string;
  onClick: () => void;
  tone?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  className?: string;
  interactive?: boolean;
  onFocus?: () => void;
}): JSX.Element {
  const toneClass =
    props.tone === 'primary'
      ? 'primary'
      : props.tone === 'danger'
        ? 'danger'
        : 'secondary';

  return (
    <button
      type="button"
      data-node-interactive={props.interactive ? 'true' : undefined}
      className={`action-button ${toneClass} ${props.className ?? ''}`.trim()}
      disabled={props.disabled}
      onFocus={props.onFocus}
      onMouseDown={props.interactive ? stopCanvasEvent : undefined}
      onClick={(event) => {
        if (props.interactive) {
          stopCanvasEvent(event);
        }
        props.onClick();
      }}
      onKeyDown={props.interactive ? stopCanvasEvent : undefined}
    >
      {props.label}
    </button>
  );
}

const CanvasContextMenu = React.forwardRef<
  HTMLDivElement,
  {
    screenX: number;
    screenY: number;
    view: 'root' | 'agent-provider';
    kinds: CanvasNodeKind[];
    defaultAgentProvider: AgentProviderKind;
    onCreate: (kind: CanvasNodeKind, agentProvider?: AgentProviderKind) => void;
    onShowAgentProviders: () => void;
    onBack: () => void;
    onClose: () => void;
  }
>(function CanvasContextMenu(props, ref): JSX.Element {
  const position = resolveContextMenuScreenPosition(props.screenX, props.screenY);
  const providerItems = ['codex', 'claude'] as const;
  const isProviderView = props.view === 'agent-provider';

  return (
    <div
      ref={ref}
      className="canvas-context-menu"
      data-context-menu="true"
      style={{
        left: position.x,
        top: position.y
      }}
      onMouseDown={stopCanvasEvent}
      onClick={stopCanvasEvent}
      onContextMenu={(event) => {
        event.preventDefault();
        stopCanvasEvent(event);
      }}
    >
      <div className={`canvas-context-menu-header${isProviderView ? ' with-back' : ''}`}>
        {isProviderView ? (
          <button
            type="button"
            className="canvas-context-menu-header-back"
            data-context-menu-back="true"
            onClick={props.onBack}
            aria-label="返回上一级"
            title="返回上一级"
          >
            <span
              className="canvas-context-menu-icon codicon codicon-chevron-left"
              aria-hidden="true"
            />
          </button>
        ) : null}
        <div className="canvas-context-menu-header-copy">
          <strong>{props.view === 'root' ? '新建节点' : '选择 Agent 类型'}</strong>
          <span>{props.view === 'root' ? '在当前空白区域快速放置对象' : '选择创建时要绑定的 provider'}</span>
        </div>
      </div>
      <div className="canvas-context-menu-items">
        {props.view === 'root'
          ? props.kinds.map((kind) =>
              kind === 'agent' ? (
                <div
                  key={kind}
                  className="canvas-context-menu-split-item"
                  data-context-menu-kind="agent"
                >
                  <button
                    type="button"
                    className="canvas-context-menu-item"
                    data-context-menu-agent-action="create-default"
                    onClick={() => props.onCreate('agent')}
                  >
                    <span
                      className="canvas-context-menu-swatch"
                      style={{ backgroundColor: colorForKind(kind) }}
                      aria-hidden="true"
                    />
                    <span className="canvas-context-menu-copy">
                      <strong>{humanizeNodeKind(kind)}</strong>
                      <span>{describeAgentContextMenuDefault(props.defaultAgentProvider)}</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="canvas-context-menu-item-secondary"
                    data-context-menu-agent-action="show-providers"
                    onClick={props.onShowAgentProviders}
                    aria-label="选择 Agent 类型"
                    title="选择 Agent 类型"
                  >
                    <span
                      className="canvas-context-menu-icon codicon codicon-chevron-right"
                      aria-hidden="true"
                    />
                  </button>
                </div>
              ) : (
                <button
                  key={kind}
                  type="button"
                  className="canvas-context-menu-item"
                  data-context-menu-kind={kind}
                  onClick={() => props.onCreate(kind)}
                >
                  <span
                    className="canvas-context-menu-swatch"
                    style={{ backgroundColor: colorForKind(kind) }}
                    aria-hidden="true"
                  />
                  <span className="canvas-context-menu-copy">
                    <strong>{humanizeNodeKind(kind)}</strong>
                    <span>{describeContextMenuKind(kind)}</span>
                  </span>
                </button>
              )
            )
          : providerItems.map((provider) => (
              <button
                key={provider}
                type="button"
                className="canvas-context-menu-item"
                data-context-menu-provider={provider}
                onClick={() => props.onCreate('agent', provider)}
              >
                <span
                  className="canvas-context-menu-swatch"
                  style={{ backgroundColor: colorForKind('agent') }}
                  aria-hidden="true"
                />
                <span className="canvas-context-menu-copy">
                  <strong>
                    {provider === props.defaultAgentProvider ? `${providerLabel(provider)}（默认）` : providerLabel(provider)}
                  </strong>
                  <span>{describeAgentProviderContextMenu(provider, provider === props.defaultAgentProvider)}</span>
                </span>
              </button>
            ))}
      </div>
      <button
        type="button"
        className="canvas-context-menu-dismiss"
        onClick={props.onClose}
      >
        取消
      </button>
    </div>
  );
});

function ChromeTitleEditor(props: {
  value: string;
  placeholder: string;
  subtitle?: string;
  subtitleAccessory?: React.ReactNode;
  className?: string;
  onSelectNode?: () => void;
  onSubmit: (title: string) => void;
}): JSX.Element {
  const [draft, setDraft] = useState(props.value);
  const [isEditing, setIsEditing] = useState(false);
  const [isComposing, setIsComposing] = useState(false);
  const committedTitleRef = useRef(props.value);
  const pendingTitleRef = useRef<string | null>(null);
  const lastPropValueRef = useRef(props.value);

  useLayoutEffect(() => {
    const previousPropValue = lastPropValueRef.current;
    lastPropValueRef.current = props.value;

    if (pendingTitleRef.current === props.value) {
      pendingTitleRef.current = null;
    } else if (pendingTitleRef.current && props.value !== previousPropValue) {
      pendingTitleRef.current = null;
    }

    committedTitleRef.current = pendingTitleRef.current ?? props.value;
    if (!isEditing) {
      setDraft(pendingTitleRef.current ?? props.value);
    }
  }, [isEditing, props.value]);

  const commitTitle = (rawValue: string): void => {
    const baselineTitle = committedTitleRef.current;
    const nextTitle = rawValue.trim() || baselineTitle;
    setDraft(nextTitle);
    if (nextTitle !== baselineTitle) {
      pendingTitleRef.current = nextTitle;
      committedTitleRef.current = nextTitle;
      props.onSubmit(nextTitle);
    }
  };

  return (
    <div className={`window-title ${props.className ?? ''}`.trim()}>
      <input
        className="window-title-input nodrag nopan"
        data-node-interactive="true"
        data-probe-field="title"
        value={draft}
        onFocus={() => {
          setIsEditing(true);
          props.onSelectNode?.();
        }}
        onMouseDown={stopCanvasEvent}
        onClick={stopCanvasEvent}
        onCompositionStart={() => setIsComposing(true)}
        onCompositionEnd={(event) => {
          setIsComposing(false);
          setDraft(event.currentTarget.value);
        }}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={(event) => {
          setIsComposing(false);
          setIsEditing(false);
          commitTitle(event.currentTarget.value);
        }}
        onKeyDown={(event) =>
          handleEditableFieldKeyDown(event, () => commitTitle(event.currentTarget.value), {
            isComposing
          })
        }
        placeholder={props.placeholder}
      />
      {props.subtitle ? (
        <div className="window-title-subtitle-row">
          <span className="window-title-subtitle">{props.subtitle}</span>
          {props.subtitleAccessory}
        </div>
      ) : null}
    </div>
  );
}

function toFlowNodes(params: {
  nodes: CanvasNodeSummary[];
  selectedNodeId: string | undefined;
  workspaceTrusted: boolean;
  onSelectNode: (nodeId: string) => void;
  onUpdateNodeTitle: (nodeId: string, title: string) => void;
  onStartExecution: (
    nodeId: string,
    kind: ExecutionNodeKind,
    cols: number,
    rows: number,
    provider?: AgentProviderKind,
    resume?: boolean
  ) => void;
  onAttachExecution: (nodeId: string, kind: ExecutionNodeKind) => void;
  onExecutionInput: (nodeId: string, kind: ExecutionNodeKind, data: string) => void;
  onDropExecutionResource: (
    nodeId: string,
    kind: ExecutionNodeKind,
    resource: ExecutionTerminalDroppedResource
  ) => void;
  onOpenExecutionLink: (
    nodeId: string,
    kind: ExecutionNodeKind,
    link: ExecutionTerminalOpenLink
  ) => void;
  onResizeExecution: (nodeId: string, kind: ExecutionNodeKind, cols: number, rows: number) => void;
  onStopExecution: (nodeId: string, kind: ExecutionNodeKind) => void;
  onUpdateNote: (payload: {
    nodeId: string;
    content: string;
  }) => void;
  onResizeNode: (nodeId: string, position: CanvasNodePosition, size: CanvasNodeFootprint) => void;
  onFocusNodeInViewport: (nodeId: string) => void;
  onDeleteNode: (nodeId: string) => void;
}): CanvasFlowNode[] {
  return params.nodes.map((node) => {
    const size = normalizeCanvasNodeFootprint(node.kind, node.size);

    return {
      id: node.id,
      type:
        node.kind === 'agent'
          ? 'agent'
          : node.kind === 'terminal'
            ? 'terminal'
            : node.kind === 'note'
              ? 'note'
              : 'card',
      position: node.position,
      draggable: true,
      selected: node.id === params.selectedNodeId,
      width: size.width,
      height: size.height,
      style: {
        width: size.width,
        height: size.height
      },
      data: {
        kind: node.kind,
        title: node.title,
        status: node.status,
        summary: node.summary,
        selected: node.id === params.selectedNodeId,
        workspaceTrusted: params.workspaceTrusted,
        size,
        metadata: node.metadata,
        onSelectNode: params.onSelectNode,
        onUpdateNodeTitle: params.onUpdateNodeTitle,
        onStartExecution: params.onStartExecution,
        onAttachExecution: params.onAttachExecution,
        onExecutionInput: params.onExecutionInput,
        onDropExecutionResource: params.onDropExecutionResource,
        onOpenExecutionLink: params.onOpenExecutionLink,
        onResizeExecution: params.onResizeExecution,
        onStopExecution: params.onStopExecution,
        onUpdateNote: params.onUpdateNote,
        onResizeNode: params.onResizeNode,
        onFocusNodeInViewport: params.onFocusNodeInViewport,
        onDeleteNode: params.onDeleteNode
      }
    };
  });
}

function applyCanvasNodeLayoutDrafts(
  nodes: CanvasFlowNode[],
  drafts: Record<string, CanvasNodeLayoutDraft>
): CanvasFlowNode[] {
  return nodes.map((node) => {
    const draft = drafts[node.id];
    if (!draft) {
      return node;
    }

    const nextSize = draft.size ?? node.data.size;

    return {
      ...node,
      position: draft.position ?? node.position,
      width: nextSize.width,
      height: nextSize.height,
      style: {
        ...node.style,
        width: nextSize.width,
        height: nextSize.height
      },
      data: {
        ...node.data,
        size: nextSize
      }
    };
  });
}

function pruneCanvasNodeLayoutDrafts(
  nodes: CanvasFlowNode[],
  drafts: Record<string, CanvasNodeLayoutDraft>
): Record<string, CanvasNodeLayoutDraft> {
  const nextDrafts = collectCanvasNodeLayoutDrafts(nodes, applyCanvasNodeLayoutDrafts(nodes, drafts));
  return shallowEqualCanvasNodeLayoutDrafts(drafts, nextDrafts) ? drafts : nextDrafts;
}

function collectCanvasNodeLayoutDrafts(
  baseNodes: CanvasFlowNode[],
  nextNodes: CanvasFlowNode[]
): Record<string, CanvasNodeLayoutDraft> {
  const baseNodesById = new Map(baseNodes.map((node) => [node.id, node]));
  const drafts: Record<string, CanvasNodeLayoutDraft> = {};

  for (const node of nextNodes) {
    const baseNode = baseNodesById.get(node.id);
    if (!baseNode) {
      continue;
    }

    const draft: CanvasNodeLayoutDraft = {};
    if (!positionsEqual(node.position, baseNode.position)) {
      draft.position = {
        x: Math.round(node.position.x),
        y: Math.round(node.position.y)
      };
    }

    const nextSize = normalizeCanvasNodeFootprint(node.data.kind, {
      width: Number(node.style?.width ?? node.data.size.width),
      height: Number(node.style?.height ?? node.data.size.height)
    });

    if (!footprintsEqual(nextSize, baseNode.data.size)) {
      draft.size = nextSize;
    }

    if (draft.position || draft.size) {
      drafts[node.id] = draft;
    }
  }

  return drafts;
}

function shallowEqualCanvasNodeLayoutDrafts(
  left: Record<string, CanvasNodeLayoutDraft>,
  right: Record<string, CanvasNodeLayoutDraft>
): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }

  return leftKeys.every((key) => {
    const leftDraft = left[key];
    const rightDraft = right[key];
    if (!rightDraft) {
      return false;
    }

    return (
      positionsEqual(leftDraft.position, rightDraft.position) &&
      footprintsEqual(leftDraft.size, rightDraft.size)
    );
  });
}

function positionsEqual(
  left: CanvasNodePosition | undefined,
  right: CanvasNodePosition | undefined
): boolean {
  return left?.x === right?.x && left?.y === right?.y;
}

function footprintsEqual(
  left: CanvasNodeFootprint | undefined,
  right: CanvasNodeFootprint | undefined
): boolean {
  return left?.width === right?.width && left?.height === right?.height;
}

function resolveCreateNodePreferredPosition(
  kind: CanvasNodeKind,
  reactFlowInstance: ReactFlowInstance<CanvasNodeData> | null
): CanvasNodePosition | undefined {
  if (!reactFlowInstance || !reactFlowInstance.viewportInitialized) {
    return undefined;
  }

  const viewportCenter = reactFlowInstance.screenToFlowPosition({
    x: Math.round(window.innerWidth * 0.5),
    y: Math.round(window.innerHeight * 0.55)
  });

  return resolveCreateNodePreferredPositionFromFlowAnchor(kind, viewportCenter);
}

function resolveCreateNodePreferredPositionFromFlowAnchor(
  kind: CanvasNodeKind,
  flowAnchor: CanvasNodePosition
): CanvasNodePosition {
  const footprint = estimatedCanvasNodeFootprint(kind);

  return {
    x: Math.round(flowAnchor.x - footprint.width / 2),
    y: Math.round(flowAnchor.y - footprint.height / 2)
  };
}

function colorForKind(kind: CanvasNodeKind): string {
  switch (kind) {
    case 'agent':
      return '#22c55e';
    case 'terminal':
      return '#38bdf8';
    case 'note':
      return '#a78bfa';
  }
}

function minimapFillColorForKind(kind: CanvasNodeKind): string {
  return `color-mix(in srgb, ${colorForKind(kind)} 70%, var(--vscode-editor-background) 30%)`;
}

function minimapStrokeColorForKind(kind: CanvasNodeKind): string {
  return `color-mix(in srgb, ${colorForKind(kind)} 82%, var(--vscode-editor-background) 18%)`;
}

function humanizeNodeKind(kind: CanvasNodeKind): string {
  switch (kind) {
    case 'agent':
      return 'Agent';
    case 'terminal':
      return 'Terminal';
    case 'note':
      return 'Note';
  }
}

function describeContextMenuKind(kind: CanvasNodeKind): string {
  switch (kind) {
    case 'agent':
      return '新建一个可运行的 Agent 会话窗口';
    case 'terminal':
      return '新建一个嵌入式终端窗口';
    case 'note':
      return '新建一个可编辑的笔记节点';
  }
}

function describeAgentContextMenuDefault(provider: AgentProviderKind): string {
  return `默认：${providerLabel(provider)}，直接新建一个可运行的 Agent 会话窗口`;
}

function describeAgentProviderContextMenu(provider: AgentProviderKind, isDefault: boolean): string {
  if (isDefault) {
    return `按默认类型创建 ${providerLabel(provider)} Agent`;
  }

  return `创建一个 ${providerLabel(provider)} Agent 会话窗口`;
}

function providerLabel(provider: AgentProviderKind): string {
  return provider === 'claude' ? 'Claude Code' : 'Codex';
}

function humanizeStatus(status: string): string {
  switch (status) {
    case 'idle':
      return '空闲';
    case 'launching':
      return '启动中';
    case 'starting':
      return '启动中';
    case 'waiting-input':
      return '等待输入';
    case 'resuming':
      return '恢复中';
    case 'resume-ready':
      return '可恢复';
    case 'reattaching':
      return '重连中';
    case 'resume-failed':
      return '恢复失败';
    case 'stopping':
      return '停止中';
    case 'stopped':
      return '已停止';
    case 'running':
      return '运行中';
    case 'draft':
      return '草稿';
    case 'ready':
      return '就绪';
    case 'live':
      return '活动';
    case 'closed':
      return '已关闭';
    case 'error':
      return '失败';
    case 'cancelled':
      return '已停止';
    case 'interrupted':
      return '已中断';
    case 'history-restored':
      return '历史恢复';
    default:
      return status;
  }
}

function statusToneClass(status: string): string {
  switch (status) {
    case 'launching':
    case 'starting':
    case 'resuming':
    case 'running':
    case 'live':
    case 'reattaching':
      return 'tone-running';
    case 'waiting-input':
      return 'tone-success';
    case 'resume-ready':
    case 'stopping':
    case 'stopped':
    case 'closed':
    case 'cancelled':
    case 'interrupted':
    case 'history-restored':
      return 'tone-warning';
    case 'resume-failed':
    case 'error':
      return 'tone-error';
    default:
      return 'tone-idle';
  }
}

function handleEditableFieldKeyDown(
  event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  submit: () => void,
  options?: {
    isComposing?: boolean;
  }
): void {
  stopCanvasEvent(event);

  if (options?.isComposing || isImeComposingKeyboardEvent(event)) {
    return;
  }

  if (event.currentTarget instanceof HTMLInputElement && event.key === 'Enter') {
    event.preventDefault();
    submit();
    event.currentTarget.blur();
    return;
  }

  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    event.preventDefault();
    submit();
    event.currentTarget.blur();
    return;
  }

  if (event.key === 'Escape') {
    event.preventDefault();
    event.currentTarget.blur();
  }
}

function isImeComposingKeyboardEvent(
  event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>
): boolean {
  const nativeEvent = event.nativeEvent as KeyboardEvent & {
    isComposing?: boolean;
    keyCode?: number;
  };

  return event.isComposing || nativeEvent.isComposing === true || nativeEvent.keyCode === 229;
}

function handleEditableSelectKeyDown(event: React.KeyboardEvent<HTMLSelectElement>): void {
  stopCanvasEvent(event);

  if (event.key === 'Escape') {
    event.preventDefault();
    event.currentTarget.blur();
  }
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    Boolean(target.closest('[data-node-interactive="true"], .react-flow__resize-control'))
  );
}

function shouldDeleteSelectedNodeFromKeyboard(event: KeyboardEvent): boolean {
  if (
    event.defaultPrevented ||
    event.isComposing ||
    event.repeat ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey ||
    (event.key !== 'Delete' && event.key !== 'Backspace')
  ) {
    return false;
  }

  return !isDeleteShortcutBlockedTarget(event.target);
}

function isDeleteShortcutBlockedTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  return Boolean(
    target.closest('input, textarea, select, button, a, [contenteditable="true"], [data-node-interactive="true"]')
  );
}

function handleNodeChromeDoubleClick(
  event: React.MouseEvent<HTMLElement>,
  nodeId: string,
  data: CanvasNodeData
): void {
  if (isNodeChromeFocusBlockedTarget(event.target)) {
    return;
  }

  stopCanvasEvent(event);
  data.onSelectNode?.(nodeId);
  data.onFocusNodeInViewport?.(nodeId);
}

function isNodeChromeFocusBlockedTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && isDeleteShortcutBlockedTarget(target);
}

function resolveContextMenuScreenPosition(screenX: number, screenY: number): { x: number; y: number } {
  const maxX = Math.max(12, window.innerWidth - 236);
  const maxY = Math.max(12, window.innerHeight - 230);

  return {
    x: Math.min(Math.max(12, screenX), maxX),
    y: Math.min(Math.max(12, screenY), maxY)
  };
}

function stopCanvasEvent(event: { stopPropagation: () => void }): void {
  event.stopPropagation();
}

function routeExecutionTerminalSnapshot(detail: Extract<ExecutionHostEvent, { type: 'snapshot' }>): void {
  executionTerminalRegistry.get(detail.nodeId)?.controller.applySnapshot(detail);
}

function queueExecutionTerminalOutput(detail: Extract<ExecutionHostEvent, { type: 'output' }>): void {
  executionTerminalRegistry.get(detail.nodeId)?.controller.enqueueOutput(detail.chunk);
}

function routeExecutionTerminalExit(detail: Extract<ExecutionHostEvent, { type: 'exit' }>): void {
  executionTerminalRegistry.get(detail.nodeId)?.controller.showExit(detail.message);
}

function scheduleExecutionTerminalDrain(controller: ExecutionTerminalController): void {
  pendingExecutionTerminalDrains.add(controller);
  if (executionTerminalDrainFrame !== undefined) {
    return;
  }

  executionTerminalDrainFrame = window.requestAnimationFrame(() => {
    executionTerminalDrainFrame = undefined;
    const controllers = Array.from(pendingExecutionTerminalDrains);
    pendingExecutionTerminalDrains.clear();
    for (const currentController of controllers) {
      currentController.flushPendingOutput();
    }
    if (pendingExecutionTerminalDrains.size > 0) {
      const remainingControllers = Array.from(pendingExecutionTerminalDrains);
      pendingExecutionTerminalDrains.clear();
      for (const currentController of remainingControllers) {
        scheduleExecutionTerminalDrain(currentController);
      }
    }
  });
}

function createExecutionTerminalController(terminal: Terminal): ExecutionTerminalController {
  let pendingOutput = '';
  let disposed = false;

  const controller: ExecutionTerminalController = {
    applySnapshot(detail) {
      if (disposed) {
        return;
      }

      pendingOutput = '';
      pendingExecutionTerminalDrains.delete(controller);
      restoreExecutionTerminalSnapshot(terminal, detail);
    },
    enqueueOutput(chunk) {
      if (disposed || !chunk) {
        return;
      }

      pendingOutput += chunk;
      scheduleExecutionTerminalDrain(controller);
    },
    showExit(message) {
      if (disposed) {
        return;
      }

      controller.flushPendingOutput();
      terminal.writeln(`\r\n[Dev Session Canvas] ${message}`);
    },
    refreshVisibleRows() {
      if (disposed) {
        return;
      }

      controller.flushPendingOutput();
      if (terminal.rows > 0) {
        terminal.refresh(0, terminal.rows - 1);
      }
    },
    flushPendingOutput() {
      if (disposed || pendingOutput.length === 0) {
        return;
      }

      const chunk = pendingOutput;
      pendingOutput = '';
      // Keep the host message callback lightweight by deferring real terminal writes
      // to a batched drain step. xterm will continue to apply its own async parser queue.
      terminal.write(chunk);
    },
    dispose() {
      disposed = true;
      pendingOutput = '';
      pendingExecutionTerminalDrains.delete(controller);
    }
  };

  return controller;
}

function restoreExecutionTerminalSnapshot(
  terminal: Terminal,
  detail: Extract<ExecutionHostEvent, { type: 'snapshot' }>
): void {
  const restoreCols = detail.cols > 1 ? detail.cols : terminal.cols;
  const restoreRows = detail.rows > 0 ? detail.rows : terminal.rows;

  if (restoreCols > 1 && restoreRows > 0 && (terminal.cols !== restoreCols || terminal.rows !== restoreRows)) {
    terminal.resize(restoreCols, restoreRows);
  }

  terminal.reset();
  const finishRestore = (): void => {
    window.requestAnimationFrame(() => {
      if (terminal.rows > 0) {
        terminal.refresh(0, terminal.rows - 1);
      }
    });
  };

  if (detail.serializedTerminalState) {
    terminal.write(detail.serializedTerminalState.data, finishRestore);
    return;
  }

  if (detail.output) {
    terminal.write(detail.output, () => {
      finishRestore();
    });
    return;
  }

  finishRestore();
}

function scheduleExecutionTerminalVisibilityRestore(): void {
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      for (const { controller } of executionTerminalRegistry.values()) {
        controller.refreshVisibleRows();
      }
    });
  });
}

function scheduleEmbeddedTerminalAppearanceRefresh(): void {
  if (embeddedTerminalAppearanceRefreshScheduled) {
    return;
  }

  embeddedTerminalAppearanceRefreshScheduled = true;
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      embeddedTerminalAppearanceRefreshScheduled = false;
      refreshAllEmbeddedTerminalAppearances();
    });
  });
}

function refreshAllEmbeddedTerminalAppearances(): void {
  const appearance = readEmbeddedTerminalAppearance();
  syncEmbeddedTerminalCssVariables(appearance);
  for (const { terminal } of executionTerminalRegistry.values()) {
    applyEmbeddedTerminalAppearance(terminal, appearance);
  }
}

function ensureEmbeddedTerminalThemeObservers(): void {
  if (embeddedTerminalThemeObserverDispose) {
    return;
  }

  const scheduleRefresh = (): void => {
    scheduleEmbeddedTerminalAppearanceRefresh();
  };
  const headObserver = new MutationObserver(() => {
    scheduleRefresh();
  });
  const bodyObserver = new MutationObserver(() => {
    scheduleRefresh();
  });
  const rootObserver = new MutationObserver(() => {
    scheduleRefresh();
  });

  if (document.head) {
    headObserver.observe(document.head, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  if (document.body) {
    bodyObserver.observe(document.body, {
      attributes: true,
      attributeFilter: ['class', 'style', 'data-vscode-theme-id', 'data-vscode-theme-kind']
    });
  }

  rootObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class', 'style']
  });

  embeddedTerminalThemeObserverDispose = () => {
    headObserver.disconnect();
    bodyObserver.disconnect();
    rootObserver.disconnect();
  };
}

function collectWebviewProbeSnapshot(): WebviewProbeSnapshot {
  const nodeElements = Array.from(
    document.querySelectorAll<HTMLElement>('[data-node-id][data-node-kind]')
  );
  const nodes = nodeElements
    .map((element) => readWebviewProbeNodeSnapshot(element))
    .filter((node): node is WebviewProbeNodeSnapshot => node !== null);

  return {
    documentTitle: document.title,
    hasCanvasShell: Boolean(document.querySelector('.canvas-shell')),
    hasReactFlow: Boolean(document.querySelector('.react-flow')),
    toastMessage: readProbeText(document.querySelector('[data-toast-kind="error"]')),
    executionLinkTooltipText: readProbeText(document.querySelector('.execution-link-tooltip.is-visible')),
    nodeCount: nodes.length,
    nodes
  };
}

function readWebviewProbeNodeSnapshot(element: HTMLElement): WebviewProbeNodeSnapshot | null {
  const nodeId = element.dataset.nodeId;
  const nodeKind = element.dataset.nodeKind;

  if (!nodeId || !isCanvasNodeKind(nodeKind)) {
    return null;
  }

  const footprint = readProbeNodeFootprint(element);

  return {
    nodeId,
    kind: nodeKind,
    chromeTitle:
      readProbeText(element.querySelector('.window-title strong, .node-topline strong')) ??
      readProbeFieldValue(element, 'title') ??
      null,
    chromeSubtitle: readProbeText(element.querySelector('.window-title span, .node-topline span')),
    statusText: readProbeText(element.querySelector('.status-pill, .node-status')),
    selected: element.dataset.nodeSelected === 'true',
    renderedWidth: footprint.width,
    renderedHeight: footprint.height,
    overlayTitle: readProbeTextOrUndefined(element.querySelector('.terminal-overlay strong')),
    overlayMessage: readProbeTextOrUndefined(element.querySelector('.terminal-overlay span')),
    titleInputValue: readProbeFieldValue(element, 'title'),
    bodyValue: readProbeFieldValue(element, 'body'),
    ...readProbeExecutionTerminalState(nodeId)
  };
}

function readProbeNodeFootprint(element: HTMLElement): CanvasNodeFootprint {
  const wrapper = element.closest<HTMLElement>('.react-flow__node');
  const probeTarget = wrapper ?? element;
  const width = Math.round(probeTarget.offsetWidth || element.getBoundingClientRect().width);
  const height = Math.round(probeTarget.offsetHeight || element.getBoundingClientRect().height);

  return {
    width,
    height
  };
}

function readProbeFieldValue(element: HTMLElement, fieldName: string): string | undefined {
  const field = element.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
    `[data-probe-field="${fieldName}"]`
  );

  return field?.value;
}

function readProbeText(element: Element | null): string | null {
  const text = element?.textContent?.trim();
  return text ? text : null;
}

function readProbeTextOrUndefined(element: Element | null): string | undefined {
  return readProbeText(element) ?? undefined;
}

function readProbeExecutionTerminalState(
  nodeId: string
): Pick<
  WebviewProbeNodeSnapshot,
  | 'terminalSelectionText'
  | 'terminalCols'
  | 'terminalRows'
  | 'terminalViewportY'
  | 'terminalVisibleLines'
  | 'terminalTextareaLeft'
  | 'terminalTextareaTop'
  | 'terminalTheme'
> {
  const terminal = executionTerminalRegistry.get(nodeId);
  if (!terminal) {
    return {};
  }

  return {
    terminalSelectionText: terminal.terminal.getSelection(),
    terminalCols: terminal.terminal.cols > 0 ? terminal.terminal.cols : undefined,
    terminalRows: terminal.terminal.rows > 0 ? terminal.terminal.rows : undefined,
    terminalViewportY:
      terminal.terminal.buffer.active.viewportY >= 0 ? terminal.terminal.buffer.active.viewportY : undefined,
    terminalVisibleLines: readProbeTerminalVisibleLines(terminal.terminal),
    terminalTextareaLeft: readProbeNumericStyleValue(terminal.terminal.textarea?.style.left),
    terminalTextareaTop: readProbeNumericStyleValue(terminal.terminal.textarea?.style.top),
    terminalTheme: readProbeTerminalTheme(terminal.terminal.options.theme)
  };
}

function readProbeTerminalVisibleLines(terminal: Terminal): string[] | undefined {
  if (terminal.rows <= 0) {
    return undefined;
  }

  const startLine = Math.max(0, terminal.buffer.active.viewportY);
  const visibleLines: string[] = [];
  for (let offset = 0; offset < terminal.rows; offset += 1) {
    const line = terminal.buffer.active.getLine(startLine + offset);
    visibleLines.push(line ? line.translateToString(true) : '');
  }

  return visibleLines;
}

function readProbeTerminalTheme(
  theme: EmbeddedTerminalOptions['theme']
): WebviewProbeNodeSnapshot['terminalTheme'] | undefined {
  if (!theme) {
    return undefined;
  }

  return {
    background: theme.background,
    foreground: theme.foreground,
    cursor: theme.cursor,
    selectionBackground: theme.selectionBackground,
    ansiBlue: theme.blue,
    ansiBrightWhite: theme.brightWhite
  };
}

function readProbeNumericStyleValue(value: string | undefined): number | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return undefined;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function performWebviewDomAction(requestId: string, action: WebviewDomAction): Promise<void> {
  try {
    await delayTestAction(action.delayMs);

    switch (action.kind) {
      case 'selectNode': {
        const target = queryNodeSelectionTarget(action.nodeId);
        dispatchSyntheticMouseClick(target);
        await waitForDomActionFlush();
        break;
      }
      case 'setNodeTextField': {
        const field = queryNodeTextField(action.nodeId, action.field);
        field.focus();
        field.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
        setControlledFieldValue(field, action.value);
        field.dispatchEvent(new Event('input', { bubbles: true }));
        field.dispatchEvent(new Event('change', { bubbles: true }));
        await waitForDomActionFlush();
        field.blur();
        field.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
        await waitForDomActionFlush();
        break;
      }
      case 'clickNodeActionButton': {
        const button = queryNodeActionButton(action.nodeId, action.label);
        button.focus();
        button.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
        dispatchSyntheticMouseClick(button);
        await waitForDomActionFlush();
        button.blur();
        button.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
        break;
      }
      case 'scrollTerminalViewport': {
        const entry = executionTerminalRegistry.get(action.nodeId);
        if (!entry) {
          throw new Error(`Execution terminal ${action.nodeId} is not mounted.`);
        }

        entry.terminal.scrollLines(action.lines);
        await waitForDomActionFlush();
        break;
      }
      case 'sendExecutionInput': {
        const entry = executionTerminalRegistry.get(action.nodeId);
        if (!entry) {
          throw new Error(`Execution terminal ${action.nodeId} is not mounted.`);
        }

        entry.terminal.input(action.data);
        await waitForDomActionFlush();
        break;
      }
      case 'dropExecutionResources': {
        const nodeRoot = queryNodeRoot(action.nodeId);
        const dropTarget = nodeRoot.querySelector<HTMLElement>('.terminal-frame');
        if (!dropTarget) {
          throw new Error(`Execution terminal ${action.nodeId} has no drop target.`);
        }

        const dataTransfer = new DataTransfer();
        if (action.source === 'resourceUrls') {
          dataTransfer.setData('ResourceURLs', JSON.stringify(action.values));
        } else if (action.source === 'codeFiles') {
          dataTransfer.setData('CodeFiles', JSON.stringify(action.values));
        } else {
          dataTransfer.setData('text/uri-list', action.values.join('\n'));
        }

        dropTarget.dispatchEvent(
          new DragEvent('dragenter', {
            bubbles: true,
            cancelable: true,
            dataTransfer
          })
        );
        dropTarget.dispatchEvent(
          new DragEvent('dragover', {
            bubbles: true,
            cancelable: true,
            dataTransfer
          })
        );
        dropTarget.dispatchEvent(
          new DragEvent('drop', {
            bubbles: true,
            cancelable: true,
            dataTransfer
          })
        );
        await waitForDomActionFlush();
        break;
      }
      case 'activateExecutionLink': {
        const entry = executionTerminalRegistry.get(action.nodeId);
        if (!entry) {
          throw new Error(`Execution terminal ${action.nodeId} is not mounted.`);
        }

        await entry.nativeInteractions.activateLinkForTest(action.text);
        postMessage({
          type: 'webview/testDomActionResult',
          payload: {
            requestId,
            ok: true
          }
        });
        return;
      }
      case 'hoverExecutionLink': {
        const entry = executionTerminalRegistry.get(action.nodeId);
        if (!entry) {
          throw new Error(`Execution terminal ${action.nodeId} is not mounted.`);
        }

        await entry.nativeInteractions.hoverLinkForTest(action.text);
        await waitForDomActionFlush();
        break;
      }
      case 'clearExecutionLinkHover': {
        const entry = executionTerminalRegistry.get(action.nodeId);
        if (!entry) {
          throw new Error(`Execution terminal ${action.nodeId} is not mounted.`);
        }

        entry.nativeInteractions.clearHoverForTest();
        await waitForDomActionFlush();
        break;
      }
    }

    await waitForDomActionFlush();
    postMessage({
      type: 'webview/testDomActionResult',
      payload: {
        requestId,
        ok: true
      }
    });
  } catch (error) {
    postMessage({
      type: 'webview/testDomActionResult',
      payload: {
        requestId,
        ok: false,
        errorMessage: formatTestDomActionError(error)
      }
    });
  }
}

async function respondWithWebviewProbeSnapshot(requestId: string, delayMs?: number): Promise<void> {
  await delayTestAction(delayMs);
  postMessage({
    type: 'webview/testProbeResult',
    payload: {
      requestId,
      snapshot: collectWebviewProbeSnapshot()
    }
  });
}

function queryNodeTextField(
  nodeId: string,
  fieldName: 'title' | 'body'
): HTMLInputElement | HTMLTextAreaElement {
  const field = queryNodeField(nodeId, fieldName);
  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
    return field;
  }

  throw new Error(`节点 ${nodeId} 的 ${fieldName} 字段不是文本输入控件。`);
}

function queryNodeActionButton(
  nodeId: string,
  label: '删除' | '启动' | '停止' | '重启' | '恢复'
): HTMLButtonElement {
  const nodeRoot = queryNodeRoot(nodeId);
  const button = Array.from(nodeRoot.querySelectorAll('button')).find(
    (candidate) => candidate.textContent?.trim() === label
  );
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`未找到节点 ${nodeId} 上标签为 ${label} 的按钮。`);
  }

  return button;
}

function queryNodeSelectionTarget(nodeId: string): HTMLElement {
  const nodeRoot = queryNodeRoot(nodeId);
  return (
    nodeRoot.querySelector<HTMLElement>('.window-chrome, .node-topline, .session-body, .object-body') ??
    nodeRoot
  );
}

function queryNodeField(nodeId: string, fieldName: string): Element {
  const field = queryNodeRoot(nodeId).querySelector(`[data-probe-field="${fieldName}"]`);
  if (!field) {
    throw new Error(`未找到节点 ${nodeId} 的 ${fieldName} 字段。`);
  }

  return field;
}

function queryNodeRoot(nodeId: string): HTMLElement {
  const nodeRoot = document.querySelector<HTMLElement>(`[data-node-id="${nodeId}"]`);
  if (!nodeRoot) {
    throw new Error(`未找到节点 ${nodeId}。`);
  }

  return nodeRoot;
}

function setControlledFieldValue(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string
): void {
  const prototype =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : element instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');

  descriptor?.set?.call(element, value);
}

function dispatchSyntheticMouseClick(target: HTMLElement): void {
  const eventInit = {
    bubbles: true,
    cancelable: true,
    composed: true,
    button: 0
  };

  target.dispatchEvent(new MouseEvent('mousedown', eventInit));
  target.dispatchEvent(new MouseEvent('mouseup', eventInit));
  target.dispatchEvent(new MouseEvent('click', eventInit));
}

function waitForDomActionFlush(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => resolve());
    });
  });
}

function delayTestAction(delayMs?: number): Promise<void> {
  if (!delayMs || delayMs <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    window.setTimeout(resolve, delayMs);
  });
}

function formatTestDomActionError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function createEmbeddedTerminalOptions(): EmbeddedTerminalOptions {
  const appearance = readEmbeddedTerminalAppearance();

  return {
    allowTransparency: true,
    cursorBlink: true,
    convertEol: false,
    fontFamily: appearance.fontFamily,
    fontSize: 12.5,
    scrollback: resolveEmbeddedTerminalScrollback(),
    theme: appearance.theme
  };
}

function resolveEmbeddedTerminalScrollback(runtimeContext: CanvasRuntimeContext = latestRuntimeContext): number {
  return normalizeTerminalScrollback(runtimeContext.terminalScrollback, DEFAULT_TERMINAL_SCROLLBACK);
}

function applyEmbeddedTerminalRuntimeContext(runtimeContext: CanvasRuntimeContext = latestRuntimeContext): void {
  const scrollback = resolveEmbeddedTerminalScrollback(runtimeContext);
  for (const { terminal } of executionTerminalRegistry.values()) {
    terminal.options.scrollback = scrollback;
  }
}

function readEmbeddedTerminalAppearance(): {
  fontFamily: string;
  theme: EmbeddedTerminalTheme;
} {
  const styles = readWorkbenchThemeStyles();
  const themeKind = readWorkbenchThemeKind();
  const defaults = EMBEDDED_TERMINAL_DEFAULTS[themeKind];
  const surfaceLocation = latestRuntimeContext.surfaceLocation;
  const background =
    readCssVariableValue(styles, '--vscode-terminal-background') ??
    readCssVariableChain(styles, TERMINAL_BACKGROUND_FALLBACKS[surfaceLocation]) ??
    (surfaceLocation === 'panel' ? defaults.panelBackground : defaults.editorBackground);
  const foreground =
    readCssVariableValue(styles, '--vscode-terminal-foreground') ?? defaults.foreground;
  const cursor = readCssVariableValue(styles, '--vscode-terminalCursor-foreground') ?? foreground;
  const selectionBackground =
    readCssVariableValue(styles, '--vscode-terminal-selectionBackground') ??
    readCssVariableValue(styles, '--vscode-editor-selectionBackground') ??
    defaults.selectionBackground;
  const selectionForeground =
    readCssVariableValue(styles, '--vscode-terminal-selectionForeground') ?? foreground;
  const selectionInactiveBackground =
    readCssVariableValue(styles, '--vscode-terminal-inactiveSelectionBackground') ??
    selectionBackground;
  const cursorAccent = readCssVariableValue(styles, '--vscode-terminalCursor-background') ?? background;
  const fontFamily = readCssVariable(
    styles,
    '--vscode-editor-font-family',
    `'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace`
  );
  const theme: EmbeddedTerminalTheme = {
    background,
    foreground,
    cursor,
    cursorAccent,
    selectionBackground,
    selectionForeground,
    selectionInactiveBackground,
    black: readCssVariable(styles, '--vscode-terminal-ansiBlack', defaults.ansi.black),
    red: readCssVariable(styles, '--vscode-terminal-ansiRed', defaults.ansi.red),
    green: readCssVariable(styles, '--vscode-terminal-ansiGreen', defaults.ansi.green),
    yellow: readCssVariable(styles, '--vscode-terminal-ansiYellow', defaults.ansi.yellow),
    blue: readCssVariable(styles, '--vscode-terminal-ansiBlue', defaults.ansi.blue),
    magenta: readCssVariable(styles, '--vscode-terminal-ansiMagenta', defaults.ansi.magenta),
    cyan: readCssVariable(styles, '--vscode-terminal-ansiCyan', defaults.ansi.cyan),
    white: readCssVariable(styles, '--vscode-terminal-ansiWhite', defaults.ansi.white),
    brightBlack: readCssVariable(
      styles,
      '--vscode-terminal-ansiBrightBlack',
      defaults.ansi.brightBlack
    ),
    brightRed: readCssVariable(styles, '--vscode-terminal-ansiBrightRed', defaults.ansi.brightRed),
    brightGreen: readCssVariable(
      styles,
      '--vscode-terminal-ansiBrightGreen',
      defaults.ansi.brightGreen
    ),
    brightYellow: readCssVariable(
      styles,
      '--vscode-terminal-ansiBrightYellow',
      defaults.ansi.brightYellow
    ),
    brightBlue: readCssVariable(styles, '--vscode-terminal-ansiBrightBlue', defaults.ansi.brightBlue),
    brightMagenta: readCssVariable(
      styles,
      '--vscode-terminal-ansiBrightMagenta',
      defaults.ansi.brightMagenta
    ),
    brightCyan: readCssVariable(styles, '--vscode-terminal-ansiBrightCyan', defaults.ansi.brightCyan),
    brightWhite: readCssVariable(
      styles,
      '--vscode-terminal-ansiBrightWhite',
      defaults.ansi.brightWhite
    )
  };

  syncEmbeddedTerminalCssVariables({
    fontFamily,
    theme
  });

  return {
    fontFamily,
    theme
  };
}

function applyEmbeddedTerminalAppearance(
  terminal: Terminal,
  appearance: { fontFamily: string; theme: EmbeddedTerminalTheme } = readEmbeddedTerminalAppearance()
): void {
  terminal.options.fontFamily = appearance.fontFamily;
  terminal.options.theme = {
    ...appearance.theme
  };

  if (terminal.rows > 0) {
    terminal.refresh(0, terminal.rows - 1);
  }
}

function readWorkbenchThemeKind(): WorkbenchThemeKind {
  const body = document.body;
  const themeKind = body?.dataset.vscodeThemeKind;
  if (themeKind === 'vscode-high-contrast-light' || body?.classList.contains('vscode-high-contrast-light')) {
    return 'hcLight';
  }

  if (themeKind === 'vscode-high-contrast' || body?.classList.contains('vscode-high-contrast')) {
    return 'hcDark';
  }

  if (themeKind === 'vscode-light' || body?.classList.contains('vscode-light')) {
    return 'light';
  }

  if (themeKind === 'vscode-dark' || body?.classList.contains('vscode-dark')) {
    return 'dark';
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function readWorkbenchThemeStyles(): CSSStyleDeclaration {
  return getComputedStyle(document.body ?? document.documentElement);
}

function syncEmbeddedTerminalCssVariables(appearance: {
  fontFamily: string;
  theme: EmbeddedTerminalTheme;
}): void {
  document.documentElement.style.setProperty(
    EMBEDDED_TERMINAL_BACKGROUND_CSS_VAR,
    appearance.theme.background ?? ''
  );
  document.documentElement.style.setProperty(
    EMBEDDED_TERMINAL_FOREGROUND_CSS_VAR,
    appearance.theme.foreground ?? ''
  );
}

function createZoomAdjustedMouseEvent(
  event: Pick<MouseEvent, 'clientX' | 'clientY'>,
  element: HTMLElement,
  zoom: number
): Pick<MouseEvent, 'clientX' | 'clientY'> {
  const normalizedZoom = normalizeTerminalViewportZoom(zoom);
  if (Math.abs(normalizedZoom - 1) < 0.001) {
    return event;
  }

  const rect = element.getBoundingClientRect();
  return {
    clientX: rect.left + (event.clientX - rect.left) / normalizedZoom,
    clientY: rect.top + (event.clientY - rect.top) / normalizedZoom
  };
}

function normalizeTerminalViewportZoom(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function positionTextareaUnderScaledMouse(
  event: MouseEvent,
  terminal: Terminal,
  zoom: number
): void {
  const textarea = terminal.textarea;
  const screenElement = readXtermScreenElement(terminal);
  if (!textarea || !screenElement) {
    return;
  }

  const adjustedEvent = createZoomAdjustedMouseEvent(event, screenElement, zoom);
  const rect = screenElement.getBoundingClientRect();
  textarea.style.width = '20px';
  textarea.style.height = '20px';
  textarea.style.left = `${adjustedEvent.clientX - rect.left - 10}px`;
  textarea.style.top = `${adjustedEvent.clientY - rect.top - 10}px`;
  textarea.style.zIndex = '1000';
}

function readXtermScreenElement(terminal: Terminal): HTMLElement | null {
  return terminal.element?.querySelector<HTMLElement>('.xterm-screen') ?? null;
}

function readCssVariableValue(
  styles: CSSStyleDeclaration,
  variableName: string
): string | undefined {
  const value = styles.getPropertyValue(variableName).trim();
  return value.length > 0 ? value : undefined;
}

function readCssVariableChain(
  styles: CSSStyleDeclaration,
  variableNames: readonly string[]
): string | undefined {
  for (const variableName of variableNames) {
    const value = readCssVariableValue(styles, variableName);
    if (value) {
      return value;
    }
  }

  return undefined;
}

function readCssVariable(styles: CSSStyleDeclaration, variableName: string, fallback: string): string {
  return readCssVariableValue(styles, variableName) ?? fallback;
}

function formatExecutionNodeHelpTooltip(help: {
  title: string;
  items: readonly string[];
}): string {
  if (help.items.length === 0) {
    return help.title;
  }

  return `${help.title}：${help.items.map((item, index) => `${index + 1}. ${item}`).join('；')}`;
}

function resolveExecutionTerminalFileLinks(
  nodeId: string,
  kind: ExecutionNodeKind,
  candidates: ExecutionTerminalFileLinkCandidate[]
): Promise<ExecutionTerminalResolvedFileLink[]> {
  const requestId = `execution-file-links-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      pendingExecutionFileLinkResolutionRequests.delete(requestId);
      reject(new Error('Execution file link resolution timed out.'));
    }, 2500);

    pendingExecutionFileLinkResolutionRequests.set(requestId, {
      resolve,
      reject,
      timeout
    });

    postMessage({
      type: 'webview/resolveExecutionFileLinks',
      payload: {
        requestId,
        nodeId,
        kind,
        candidates
      }
    });
  });
}

function resolvePendingExecutionFileLinkResolutionRequest(
  requestId: string,
  resolvedLinks: ExecutionTerminalResolvedFileLink[]
): void {
  const pendingRequest = pendingExecutionFileLinkResolutionRequests.get(requestId);
  if (!pendingRequest) {
    return;
  }

  window.clearTimeout(pendingRequest.timeout);
  pendingExecutionFileLinkResolutionRequests.delete(requestId);
  pendingRequest.resolve(resolvedLinks);
}

function rejectPendingExecutionFileLinkResolutionRequests(message: string): void {
  for (const [requestId, pendingRequest] of pendingExecutionFileLinkResolutionRequests.entries()) {
    window.clearTimeout(pendingRequest.timeout);
    pendingExecutionFileLinkResolutionRequests.delete(requestId);
    pendingRequest.reject(new Error(message));
  }
}

function postMessage(message: WebviewToHostMessage): void {
  vscode.postMessage(message);
}

root.render(<App />);
