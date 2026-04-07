import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
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
  type ReactFlowInstance,
  type Node,
  type NodeMouseHandler,
  type NodeProps,
  type Viewport
} from 'reactflow';

import 'reactflow/dist/style.css';
import '@xterm/xterm/css/xterm.css';
import './styles.css';

import { EXECUTION_EVENT_NAME } from '../common/extensionIdentity';
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
import {
  estimatedCanvasNodeFootprint,
  isCanvasNodeKind,
  minimumCanvasNodeFootprint,
  normalizeCanvasNodeFootprint
} from '../common/protocol';

declare function acquireVsCodeApi<T>(): {
  getState(): T | undefined;
  setState(state: T): void;
  postMessage(message: unknown): void;
};

interface LocalUiState {
  selectedNodeId?: string;
  viewport?: Viewport;
  agentProviderDrafts?: Record<string, AgentProviderKind>;
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
  agentProvider?: AgentProviderKind;
  onSelectNode?: (nodeId: string) => void;
  onAgentProviderChange?: (nodeId: string, value: AgentProviderKind) => void;
  onStartExecution?: (
    nodeId: string,
    kind: ExecutionNodeKind,
    cols: number,
    rows: number,
    provider?: AgentProviderKind
  ) => void;
  onAttachExecution?: (nodeId: string, kind: ExecutionNodeKind) => void;
  onExecutionInput?: (nodeId: string, kind: ExecutionNodeKind, data: string) => void;
  onResizeExecution?: (nodeId: string, kind: ExecutionNodeKind, cols: number, rows: number) => void;
  onStopExecution?: (nodeId: string, kind: ExecutionNodeKind) => void;
  onUpdateNodeTitle?: (nodeId: string, title: string) => void;
  onUpdateNote?: (payload: {
    nodeId: string;
    content: string;
  }) => void;
  onResizeNode?: (nodeId: string, position: CanvasNodePosition, size: CanvasNodeFootprint) => void;
  onDeleteNode?: (nodeId: string) => void;
}

type CanvasFlowNode = Node<CanvasNodeData>;
interface CanvasNodeLayoutDraft {
  position?: CanvasNodePosition;
  size?: CanvasNodeFootprint;
}
type ExecutionHostEvent =
  | {
      type: 'snapshot';
      nodeId: string;
      kind: ExecutionNodeKind;
      output: string;
      cols: number;
      rows: number;
      liveSession: boolean;
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

const vscode = acquireVsCodeApi<LocalUiState>();
const initialPersistedState = vscode.getState() ?? {};
const rootElement = document.querySelector<HTMLDivElement>('#app');
const executionEventTarget = new EventTarget();
const CANVAS_FIT_VIEW_PADDING = 0.05;

if (!rootElement) {
  throw new Error('Webview root element not found.');
}

const root = createRoot(rootElement);

function App(): JSX.Element {
  const [hostState, setHostState] = useState<CanvasPrototypeState | null>(null);
  const [runtimeContext, setRuntimeContext] = useState<CanvasRuntimeContext>({
    workspaceTrusted: false
  });
  const [localUiState, setLocalUiState] = useState<LocalUiState>(() => ({
    selectedNodeId: initialPersistedState.selectedNodeId,
    viewport: initialPersistedState.viewport
  }));
  const [agentProviderDrafts, setAgentProviderDrafts] = useState<Record<string, AgentProviderKind>>(
    () => initialPersistedState.agentProviderDrafts ?? {}
  );
  const [nodeLayoutDrafts, setNodeLayoutDrafts] = useState<Record<string, CanvasNodeLayoutDraft>>({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const clearErrorTimer = useRef<number | null>(null);
  const reactFlowRef = useRef<ReactFlowInstance<CanvasNodeData> | null>(null);

  useEffect(() => {
    const listener = (event: MessageEvent<HostToWebviewMessage>) => {
      const message = event.data;

      switch (message.type) {
        case 'host/bootstrap':
        case 'host/stateUpdated':
          setHostState(message.payload.state);
          setRuntimeContext(message.payload.runtime);
          break;
        case 'host/executionSnapshot':
          emitExecutionHostEvent({
            type: 'snapshot',
            nodeId: message.payload.nodeId,
            kind: message.payload.kind,
            output: message.payload.output,
            cols: message.payload.cols,
            rows: message.payload.rows,
            liveSession: message.payload.liveSession
          });
          break;
        case 'host/executionOutput':
          emitExecutionHostEvent({
            type: 'output',
            nodeId: message.payload.nodeId,
            kind: message.payload.kind,
            chunk: message.payload.chunk
          });
          break;
        case 'host/executionExit':
          emitExecutionHostEvent({
            type: 'exit',
            nodeId: message.payload.nodeId,
            kind: message.payload.kind,
            message: message.payload.message
          });
          break;
        case 'host/error':
          setErrorMessage(message.payload.message);
          if (clearErrorTimer.current) {
            window.clearTimeout(clearErrorTimer.current);
          }
          clearErrorTimer.current = window.setTimeout(() => setErrorMessage(null), 2600);
          break;
        case 'host/requestCreateNode':
          createNode(message.payload.kind);
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
    };
  }, []);

  useEffect(() => {
    vscode.setState({
      ...localUiState,
      agentProviderDrafts
    });
  }, [localUiState, agentProviderDrafts]);

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
    setAgentProviderDrafts((current) => pruneAgentProviderDrafts(current, validNodeIds));
  }, [hostState]);

  const selectedNode = hostState?.nodes.find((node) => node.id === localUiState.selectedNodeId);
  const workspaceTrusted = runtimeContext.workspaceTrusted;

  const deleteNode = (nodeId: string): void => {
    setLocalUiState((current) =>
      current.selectedNodeId === nodeId
        ? {
            ...current,
            selectedNodeId: undefined
          }
        : current
    );
    setAgentProviderDrafts((current) => removeAgentProviderDraft(current, nodeId));
    postMessage({
      type: 'webview/deleteNode',
      payload: {
        nodeId
      }
    });
  };

  const baseNodes = toFlowNodes({
    nodes: hostState?.nodes ?? [],
    selectedNodeId: localUiState.selectedNodeId,
    workspaceTrusted,
    agentProviderDrafts,
    onSelectNode: (nodeId) => {
      if (localUiState.selectedNodeId === nodeId) {
        return;
      }

      setLocalUiState((current) => ({
        ...current,
        selectedNodeId: nodeId
      }));
    },
    onAgentProviderChange: (nodeId, value) => {
      setAgentProviderDrafts((current) => ({
        ...current,
        [nodeId]: value
      }));
    },
    onStartExecution: (nodeId, kind, cols, rows, provider) =>
      postMessage({
        type: 'webview/startExecutionSession',
        payload: {
          nodeId,
          kind,
          cols,
          rows,
          provider
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

    updateLocalUiState({
      ...localUiState,
      selectedNodeId: node.id
    });
  };

  const handlePaneClick = (): void => {
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

  useEffect(() => {
    const selectedNodeId = selectedNode?.id;
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
  }, [selectedNode?.id]);

  return (
    <div className="canvas-shell">
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
        onPaneClick={handlePaneClick}
        onMoveEnd={handleMoveEnd}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1.2} />
        <MiniMap
          className="canvas-minimap"
          position="bottom-right"
          style={{ width: 210, height: 138 }}
          pannable
          zoomable
          nodeColor={(node) => colorForKind((node.data as CanvasNodeData).kind)}
          nodeStrokeColor={(node) => colorForKind((node.data as CanvasNodeData).kind)}
          nodeBorderRadius={10}
          nodeStrokeWidth={1.5}
          maskColor="rgba(7, 10, 18, 0.62)"
          maskStrokeColor="rgba(241, 245, 249, 0.92)"
          maskStrokeWidth={2.5}
        />
        <Controls
          className="canvas-corner-panel canvas-controls"
          showInteractive={false}
          fitViewOptions={{ padding: CANVAS_FIT_VIEW_PADDING }}
        />
      </ReactFlow>

      {errorMessage ? (
        <div className="toast-error" data-toast-kind="error">
          {errorMessage}
        </div>
      ) : null}
    </div>
  );

  function createNode(kind: CanvasNodeKind): void {
    const preferredPosition = resolveCreateNodePreferredPosition(kind, reactFlowRef.current);
    postMessage({
      type: 'webview/createDemoNode',
      payload: {
        kind,
        preferredPosition
      }
    });
  }
}

function AgentSessionNode({ id, data }: NodeProps<CanvasNodeData>): JSX.Element {
  const agentMetadata = data.metadata?.agent;
  if (!agentMetadata) {
    return <CanvasCardNode id={id} data={data} />;
  }

  const provider = data.agentProvider ?? agentMetadata.provider ?? 'codex';
  const executionBlocked = !data.workspaceTrusted;
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const resizeFrameRef = useRef<number | undefined>(undefined);
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
    const container = viewportRef.current;
    if (!container) {
      return;
    }

    const terminal = new Terminal(createEmbeddedTerminalOptions());
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(container);

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

    xtermRef.current = terminal;
    fitAddonRef.current = fitAddon;
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

    data.onAttachExecution?.(id, 'agent');

    return () => {
      dataDisposable.dispose();
      selectionDisposable.dispose();
      resizeObserver.disconnect();
      if (resizeFrameRef.current) {
        window.cancelAnimationFrame(resizeFrameRef.current);
      }
      terminal.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
    };
  }, [id]);

  useEffect(() => {
    if (agentMetadata.liveSession) {
      data.onAttachExecution?.(id, 'agent');
    }
  }, [agentMetadata.liveSession, id]);

  useEffect(() => {
    const listener = (event: Event): void => {
      const detail = (event as CustomEvent<ExecutionHostEvent>).detail;
      if (detail.nodeId !== id || detail.kind !== 'agent') {
        return;
      }

      const terminal = xtermRef.current;
      if (!terminal) {
        return;
      }

      if (detail.type === 'snapshot') {
        terminal.reset();
        if (detail.output) {
          terminal.write(detail.output);
        }
        window.requestAnimationFrame(() => {
          fitAddonRef.current?.fit();
          if (terminal.cols > 0 && terminal.rows > 0) {
            terminalSizeRef.current = {
              cols: terminal.cols,
              rows: terminal.rows
            };
            data.onResizeExecution?.(id, 'agent', terminal.cols, terminal.rows);
          }
        });
        terminal.scrollToBottom();
        return;
      }

      if (detail.type === 'output') {
        terminal.write(detail.chunk);
        terminal.scrollToBottom();
        return;
      }

      terminal.writeln(`\r\n[Dev Session Canvas] ${detail.message}`);
      terminal.scrollToBottom();
    };

    executionEventTarget.addEventListener(EXECUTION_EVENT_NAME, listener as EventListener);
    return () => {
      executionEventTarget.removeEventListener(EXECUTION_EVENT_NAME, listener as EventListener);
    };
  }, [id]);

  const startAgent = (): void => {
    data.onSelectNode?.(id);
    data.onStartExecution?.(
      id,
      'agent',
      terminalSizeRef.current.cols,
      terminalSizeRef.current.rows,
      provider
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

  return (
    <div
      className={`canvas-node session-node agent-session-node kind-agent ${data.selected ? 'is-selected' : ''}`}
      data-node-id={id}
      data-node-kind={data.kind}
      data-node-selected={data.selected ? 'true' : 'false'}
    >
      <NodeResizeAffordance id={id} data={data} />
      <div className="window-chrome">
        <ChromeTitleEditor
          value={data.title}
          subtitle={agentMetadata.lastBackendLabel ?? `${providerLabel(provider)} CLI`}
          placeholder="Agent 标题"
          onSelectNode={() => data.onSelectNode?.(id)}
          onSubmit={(title) => data.onUpdateNodeTitle?.(id, title)}
        />
        <div className="window-chrome-actions">
          <select
            className="agent-provider-select nodrag nopan"
            data-node-interactive="true"
            data-probe-field="provider"
            value={provider}
            disabled={executionBlocked || agentMetadata.liveSession}
            onFocus={() => data.onSelectNode?.(id)}
            onMouseDown={stopCanvasEvent}
            onClick={stopCanvasEvent}
            onKeyDown={stopCanvasEvent}
            onChange={(event) =>
              data.onAgentProviderChange?.(id, event.target.value as AgentProviderKind)
            }
          >
            <option value="codex">Codex</option>
            <option value="claude">Claude Code</option>
          </select>
          <span className={`status-pill ${agentMetadata.liveSession ? 'tone-running' : statusToneClass(data.status)}`}>
            {agentMetadata.liveSession ? '运行中' : humanizeStatus(data.status)}
          </span>
          <ActionButton
            label={agentMetadata.liveSession ? '停止' : agentMetadata.lastExitMessage ? '重启' : '启动'}
            onClick={() => (agentMetadata.liveSession ? stopAgent() : startAgent())}
            disabled={executionBlocked}
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
                  : agentMetadata.lastExitMessage
                    ? 'Agent 当前未运行'
                    : 'Agent 尚未启动'}
              </strong>
              <span>
                {executionBlocked
                  ? '当前 workspace 未受信任，Agent 会话入口已禁用。'
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

  const executionBlocked = !data.workspaceTrusted;
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
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
    const container = viewportRef.current;
    if (!container) {
      return;
    }

    const terminal = new Terminal(createEmbeddedTerminalOptions());
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(container);

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

    xtermRef.current = terminal;
    fitAddonRef.current = fitAddon;
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

    data.onAttachExecution?.(id, 'terminal');

    return () => {
      dataDisposable.dispose();
      selectionDisposable.dispose();
      resizeObserver.disconnect();
      if (resizeFrameRef.current) {
        window.cancelAnimationFrame(resizeFrameRef.current);
      }
      terminal.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
    };
  }, [id]);

  useEffect(() => {
    if (terminalMetadata.liveSession) {
      data.onAttachExecution?.(id, 'terminal');
    }
  }, [id, terminalMetadata.liveSession]);

  useEffect(() => {
    const listener = (event: Event): void => {
      const detail = (event as CustomEvent<ExecutionHostEvent>).detail;
      if (detail.nodeId !== id || detail.kind !== 'terminal') {
        return;
      }

      const terminal = xtermRef.current;
      if (!terminal) {
        return;
      }

      if (detail.type === 'snapshot') {
        terminal.reset();
        if (detail.output) {
          terminal.write(detail.output);
        }
        window.requestAnimationFrame(() => {
          fitAddonRef.current?.fit();
          if (terminal.cols > 0 && terminal.rows > 0) {
            terminalSizeRef.current = {
              cols: terminal.cols,
              rows: terminal.rows
            };
            data.onResizeExecution?.(id, 'terminal', terminal.cols, terminal.rows);
          }
        });
        terminal.scrollToBottom();
        return;
      }

      if (detail.type === 'output') {
        terminal.write(detail.chunk);
        terminal.scrollToBottom();
        return;
      }

      terminal.writeln(`\r\n[Dev Session Canvas] ${detail.message}`);
      terminal.scrollToBottom();
    };

    executionEventTarget.addEventListener(EXECUTION_EVENT_NAME, listener as EventListener);
    return () => {
      executionEventTarget.removeEventListener(EXECUTION_EVENT_NAME, listener as EventListener);
    };
  }, [id]);

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

  return (
    <div
      className={`canvas-node session-node terminal-session-node kind-terminal ${data.selected ? 'is-selected' : ''}`}
      data-node-id={id}
      data-node-kind={data.kind}
      data-node-selected={data.selected ? 'true' : 'false'}
    >
      <NodeResizeAffordance id={id} data={data} />
      <div className="window-chrome">
        <ChromeTitleEditor
          value={data.title}
          subtitle={terminalMetadata.shellPath}
          placeholder="Terminal 标题"
          className="terminal-window-title"
          onSelectNode={() => data.onSelectNode?.(id)}
          onSubmit={(title) => data.onUpdateNodeTitle?.(id, title)}
        />
        <div className="window-chrome-actions">
          <span className={`status-pill ${terminalMetadata.liveSession ? 'tone-running' : 'tone-idle'}`}>
            {terminalMetadata.liveSession ? '运行中' : humanizeStatus(data.status)}
          </span>
          <ActionButton
            label={terminalMetadata.liveSession ? '停止' : terminalMetadata.lastExitMessage ? '重启' : '启动'}
            onClick={() => (terminalMetadata.liveSession ? stopTerminal() : startTerminal())}
            disabled={executionBlocked}
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
                  : terminalMetadata.lastExitMessage
                    ? '终端当前未运行'
                    : '终端尚未启动'}
              </strong>
              <span>
                {executionBlocked
                  ? '当前 workspace 未受信任，嵌入式终端入口已禁用。'
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
      <div className="window-chrome">
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
              handleEditableFieldKeyDown(event, () =>
                submitNote(event.currentTarget.value)
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
    props.tone === 'secondary'
      ? 'secondary'
      : props.tone === 'danger'
        ? 'danger'
        : 'primary';

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

function ChromeTitleEditor(props: {
  value: string;
  placeholder: string;
  subtitle?: string;
  className?: string;
  onSelectNode?: () => void;
  onSubmit: (title: string) => void;
}): JSX.Element {
  const [draft, setDraft] = useState(props.value);
  const [isEditing, setIsEditing] = useState(false);
  const committedTitleRef = useRef(props.value);

  useLayoutEffect(() => {
    committedTitleRef.current = props.value;
    if (!isEditing) {
      setDraft(props.value);
    }
  }, [isEditing, props.value]);

  const commitTitle = (rawValue: string): void => {
    const baselineTitle = committedTitleRef.current;
    const nextTitle = rawValue.trim() || baselineTitle;
    setDraft(nextTitle);
    if (nextTitle !== baselineTitle) {
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
        onChange={(event) => setDraft(event.target.value)}
        onBlur={(event) => {
          setIsEditing(false);
          commitTitle(event.currentTarget.value);
        }}
        onKeyDown={(event) =>
          handleEditableFieldKeyDown(event, () => commitTitle(event.currentTarget.value))
        }
        placeholder={props.placeholder}
      />
      {props.subtitle ? <span>{props.subtitle}</span> : null}
    </div>
  );
}

function toFlowNodes(params: {
  nodes: CanvasNodeSummary[];
  selectedNodeId: string | undefined;
  workspaceTrusted: boolean;
  agentProviderDrafts: Record<string, AgentProviderKind>;
  onSelectNode: (nodeId: string) => void;
  onAgentProviderChange: (nodeId: string, value: AgentProviderKind) => void;
  onUpdateNodeTitle: (nodeId: string, title: string) => void;
  onStartExecution: (
    nodeId: string,
    kind: ExecutionNodeKind,
    cols: number,
    rows: number,
    provider?: AgentProviderKind
  ) => void;
  onAttachExecution: (nodeId: string, kind: ExecutionNodeKind) => void;
  onExecutionInput: (nodeId: string, kind: ExecutionNodeKind, data: string) => void;
  onResizeExecution: (nodeId: string, kind: ExecutionNodeKind, cols: number, rows: number) => void;
  onStopExecution: (nodeId: string, kind: ExecutionNodeKind) => void;
  onUpdateNote: (payload: {
    nodeId: string;
    content: string;
  }) => void;
  onResizeNode: (nodeId: string, position: CanvasNodePosition, size: CanvasNodeFootprint) => void;
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
        agentProvider: params.agentProviderDrafts[node.id] ?? node.metadata?.agent?.provider ?? 'codex',
        onSelectNode: params.onSelectNode,
        onAgentProviderChange: params.onAgentProviderChange,
        onUpdateNodeTitle: params.onUpdateNodeTitle,
        onStartExecution: params.onStartExecution,
        onAttachExecution: params.onAttachExecution,
        onExecutionInput: params.onExecutionInput,
        onResizeExecution: params.onResizeExecution,
        onStopExecution: params.onStopExecution,
        onUpdateNote: params.onUpdateNote,
        onResizeNode: params.onResizeNode,
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
  const footprint = estimatedCanvasNodeFootprint(kind);

  return {
    x: Math.round(viewportCenter.x - footprint.width / 2),
    y: Math.round(viewportCenter.y - footprint.height / 2)
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

function providerLabel(provider: AgentProviderKind): string {
  return provider === 'claude' ? 'Claude Code' : 'Codex';
}

function humanizeStatus(status: string): string {
  switch (status) {
    case 'idle':
      return '空闲';
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
    default:
      return status;
  }
}

function statusToneClass(status: string): string {
  switch (status) {
    case 'cancelled':
    case 'interrupted':
      return 'tone-warning';
    case 'error':
      return 'tone-error';
    default:
      return 'tone-idle';
  }
}

function handleEditableFieldKeyDown(
  event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  submit: () => void
): void {
  stopCanvasEvent(event);

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

function removeAgentProviderDraft(
  drafts: Record<string, AgentProviderKind>,
  nodeId: string
): Record<string, AgentProviderKind> {
  if (!(nodeId in drafts)) {
    return drafts;
  }

  const nextDrafts = { ...drafts };
  delete nextDrafts[nodeId];
  return nextDrafts;
}

function pruneAgentProviderDrafts(
  drafts: Record<string, AgentProviderKind>,
  validNodeIds: Set<string>
): Record<string, AgentProviderKind> {
  let changed = false;
  const nextDrafts: Record<string, AgentProviderKind> = {};

  for (const [nodeId, provider] of Object.entries(drafts)) {
    if (validNodeIds.has(nodeId)) {
      nextDrafts[nodeId] = provider;
      continue;
    }

    changed = true;
  }

  return changed ? nextDrafts : drafts;
}

function stopCanvasEvent(event: { stopPropagation: () => void }): void {
  event.stopPropagation();
}

function emitExecutionHostEvent(detail: ExecutionHostEvent): void {
  executionEventTarget.dispatchEvent(new CustomEvent<ExecutionHostEvent>(EXECUTION_EVENT_NAME, { detail }));
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
    providerValue: readProbeFieldValue(element, 'provider'),
    titleInputValue: readProbeFieldValue(element, 'title'),
    bodyValue: readProbeFieldValue(element, 'body')
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
      case 'selectNodeOption': {
        const field = queryNodeSelectField(action.nodeId, action.field);
        field.focus();
        field.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
        setControlledFieldValue(field, action.value);
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

function queryNodeSelectField(
  nodeId: string,
  fieldName: 'provider'
): HTMLSelectElement {
  const field = queryNodeField(nodeId, fieldName);
  if (field instanceof HTMLSelectElement) {
    return field;
  }

  throw new Error(`节点 ${nodeId} 的 ${fieldName} 字段不是下拉选择控件。`);
}

function queryNodeActionButton(nodeId: string, label: '删除' | '启动' | '停止' | '重启'): HTMLButtonElement {
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

function createEmbeddedTerminalOptions(): ConstructorParameters<typeof Terminal>[0] {
  const styles = getComputedStyle(document.documentElement);
  const background = readCssVariable(styles, '--vscode-terminal-background', '#08101f');
  const foreground = readCssVariable(styles, '--vscode-terminal-foreground', '#e5e7eb');
  const cursor = readCssVariable(styles, '--vscode-terminalCursor-foreground', '#38bdf8');
  const selectionBackground = readCssVariable(styles, '--vscode-terminal-selectionBackground', 'rgba(56, 189, 248, 0.24)');
  const fontFamily = readCssVariable(
    styles,
    '--vscode-editor-font-family',
    `'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace`
  );

  return {
    allowTransparency: true,
    cursorBlink: true,
    convertEol: false,
    fontFamily,
    fontSize: 12.5,
    scrollback: 4000,
    theme: {
      background,
      foreground,
      cursor,
      selectionBackground
    }
  };
}

function readCssVariable(styles: CSSStyleDeclaration, variableName: string, fallback: string): string {
  const value = styles.getPropertyValue(variableName).trim();
  return value || fallback;
}

function postMessage(message: WebviewToHostMessage): void {
  vscode.postMessage(message);
}

root.render(<App />);
