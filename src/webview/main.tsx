import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  type ReactFlowInstance,
  type Node,
  type NodeMouseHandler,
  type NodeProps,
  type Viewport
} from 'reactflow';

import 'reactflow/dist/style.css';
import '@xterm/xterm/css/xterm.css';
import './styles.css';

import type {
  AgentProviderKind,
  CanvasNodeKind,
  CanvasNodeMetadata,
  CanvasNodePosition,
  CanvasRuntimeContext,
  CanvasNodeSummary,
  CanvasPrototypeState,
  ExecutionNodeKind,
  HostToWebviewMessage,
  TaskNodeStatus,
  WebviewToHostMessage
} from '../common/protocol';
import { estimatedCanvasNodeFootprint } from '../common/protocol';

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
  onUpdateTask?: (payload: {
    nodeId: string;
    title: string;
    status: TaskNodeStatus;
    description: string;
    assignee: string;
  }) => void;
  onUpdateNote?: (payload: {
    nodeId: string;
    title: string;
    content: string;
  }) => void;
  onDeleteNode?: (nodeId: string) => void;
}

const EMBEDDED_TERMINAL_VIEWPORT_HEIGHT = 340;

type CanvasFlowNode = Node<CanvasNodeData>;
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
const EXECUTION_EVENT_NAME = 'opencove-execution-event';
const executionEventTarget = new EventTarget();

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

  const nodes = toFlowNodes({
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
    onUpdateTask: (payload) =>
      postMessage({
        type: 'webview/updateTaskNode',
        payload
      }),
    onUpdateNote: (payload) =>
      postMessage({
        type: 'webview/updateNoteNode',
        payload
      }),
    onDeleteNode: deleteNode
  });

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
        defaultViewport={localUiState.viewport}
        minZoom={0.4}
        maxZoom={1.8}
        onInit={(instance) => {
          reactFlowRef.current = instance;
        }}
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
        <Controls className="canvas-corner-panel canvas-controls" showInteractive={false} />
      </ReactFlow>

      {errorMessage ? <div className="toast-error">{errorMessage}</div> : null}
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
      const snappedHeight = snapEmbeddedTerminalViewportHeight(terminal, EMBEDDED_TERMINAL_VIEWPORT_HEIGHT);
      if (snappedHeight && container.clientHeight !== snappedHeight) {
        container.style.setProperty('--embedded-terminal-viewport-height', `${snappedHeight}px`);
        fitAddon.fit();
      }

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
    <div className={`canvas-node session-node agent-session-node kind-agent ${data.selected ? 'is-selected' : ''}`}>
      <div className="window-chrome">
        <div className="window-title">
          <strong>{data.title}</strong>
          <span>{agentMetadata.lastBackendLabel ?? `${providerLabel(provider)} CLI`}</span>
        </div>
        <div className="window-chrome-actions">
          <select
            className="agent-provider-select nodrag nopan"
            data-node-interactive="true"
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
      const snappedHeight = snapEmbeddedTerminalViewportHeight(terminal, EMBEDDED_TERMINAL_VIEWPORT_HEIGHT);
      if (snappedHeight && container.clientHeight !== snappedHeight) {
        container.style.setProperty('--embedded-terminal-viewport-height', `${snappedHeight}px`);
        fitAddon.fit();
      }
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
    >
      <div className="window-chrome">
        <div className="window-title terminal-window-title">
          <strong>{data.title}</strong>
          <span>{terminalMetadata.shellPath}</span>
        </div>
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

function TaskEditableNode({ id, data }: NodeProps<CanvasNodeData>): JSX.Element {
  const taskMetadata = data.metadata?.task;
  if (!taskMetadata) {
    return <CanvasCardNode id={id} data={data} />;
  }

  const [title, setTitle] = useState(data.title);
  const [status, setStatus] = useState<TaskNodeStatus>(normalizeTaskStatus(data.status));
  const [description, setDescription] = useState(taskMetadata.description);
  const [assignee, setAssignee] = useState(taskMetadata.assignee);
  const [activeFieldCount, setActiveFieldCount] = useState(0);
  const [isComposing, setIsComposing] = useState(false);

  useEffect(() => {
    if (activeFieldCount === 0 && !isComposing) {
      setTitle(data.title);
      setStatus(normalizeTaskStatus(data.status));
      setDescription(taskMetadata.description);
      setAssignee(taskMetadata.assignee);
    }
  }, [
    id,
    data.status,
    data.title,
    isComposing,
    taskMetadata.assignee,
    taskMetadata.description
  ]);

  const submitTask = (patch?: Partial<{
    title: string;
    status: TaskNodeStatus;
    description: string;
    assignee: string;
  }>): void => {
    data.onUpdateTask?.({
      nodeId: id,
      title: patch?.title ?? title,
      status: patch?.status ?? status,
      description: patch?.description ?? description,
      assignee: patch?.assignee ?? assignee
    });
  };

  const beginEditing = (): void => {
    setActiveFieldCount((current) => current + 1);
    data.onSelectNode?.(id);
  };

  const finishEditing = (): void => {
    setActiveFieldCount((current) => Math.max(0, current - 1));
  };

  const deleteTask = (): void => {
    data.onSelectNode?.(id);
    data.onDeleteNode?.(id);
  };

  return (
    <div className={`canvas-node object-editor-node kind-task ${data.selected ? 'is-selected' : ''}`}>
      <div className="window-chrome">
        <div className="window-title">
          <strong>Task</strong>
          <span>{title.trim() || '未命名任务'}</span>
        </div>
        <div className="window-chrome-actions">
          <span className={`status-pill ${statusToneClass(status)}`}>{humanizeStatus(status)}</span>
          <ActionButton
            label="删除"
            tone="danger"
            onClick={deleteTask}
            className="nodrag nopan compact"
            interactive
            onFocus={() => data.onSelectNode?.(id)}
          />
        </div>
      </div>

      <div className="object-body">
        <label className="node-field">
          <span className="node-field-label">标题</span>
          <input
            className="node-text-input nodrag nopan"
            data-node-interactive="true"
            value={title}
            onFocus={beginEditing}
            onMouseDown={stopCanvasEvent}
            onClick={stopCanvasEvent}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={(event) => {
              const nextTitle = event.currentTarget.value;
              setTitle(nextTitle);
              finishEditing();
              submitTask({ title: nextTitle });
            }}
            onKeyDown={(event) => handleEditableFieldKeyDown(event, submitTask)}
            placeholder="给这个任务起一个标题"
          />
        </label>

        <div className="object-grid">
          <label className="node-field">
            <span className="node-field-label">状态</span>
            <select
              className="node-select nodrag nopan"
              data-node-interactive="true"
              value={status}
              onFocus={beginEditing}
              onMouseDown={stopCanvasEvent}
              onClick={stopCanvasEvent}
              onChange={(event) => {
                const nextStatus = normalizeTaskStatus(event.target.value);
                setStatus(nextStatus);
                submitTask({ status: nextStatus });
              }}
              onBlur={finishEditing}
              onKeyDown={handleEditableSelectKeyDown}
            >
              <option value="todo">待开始</option>
              <option value="running">进行中</option>
              <option value="blocked">阻塞</option>
              <option value="done">已完成</option>
            </select>
          </label>

          <label className="node-field">
            <span className="node-field-label">负责人</span>
            <input
              className="node-text-input nodrag nopan"
              data-node-interactive="true"
              value={assignee}
              onFocus={beginEditing}
              onMouseDown={stopCanvasEvent}
              onClick={stopCanvasEvent}
              onChange={(event) => setAssignee(event.target.value)}
              onBlur={(event) => {
                const nextAssignee = event.currentTarget.value;
                setAssignee(nextAssignee);
                finishEditing();
                submitTask({ assignee: nextAssignee });
              }}
              onKeyDown={(event) => handleEditableFieldKeyDown(event, submitTask)}
              placeholder="例如：Codex 或你自己"
            />
          </label>
        </div>

        <label className="node-field">
          <span className="node-field-label">任务描述</span>
          <textarea
            className="node-textarea task-textarea nowheel nodrag nopan"
            data-node-interactive="true"
            value={description}
            onFocus={beginEditing}
            onMouseDown={stopCanvasEvent}
            onClick={stopCanvasEvent}
            onWheel={stopCanvasEvent}
            onCompositionStart={() => setIsComposing(true)}
            onCompositionEnd={(event) => {
              setIsComposing(false);
              setDescription(event.currentTarget.value);
            }}
            onChange={(event) => setDescription(event.target.value)}
            onBlur={(event) => {
              const nextDescription = event.currentTarget.value;
              setDescription(nextDescription);
              finishEditing();
              submitTask({ description: nextDescription });
            }}
            onKeyDown={(event) => handleEditableFieldKeyDown(event, submitTask)}
            placeholder="补充这个任务的目标、范围或下一步。"
          />
        </label>
      </div>
    </div>
  );
}

function NoteEditableNode({ id, data }: NodeProps<CanvasNodeData>): JSX.Element {
  const noteMetadata = data.metadata?.note;
  if (!noteMetadata) {
    return <CanvasCardNode id={id} data={data} />;
  }

  const [title, setTitle] = useState(data.title);
  const [content, setContent] = useState(noteMetadata.content);
  const [activeFieldCount, setActiveFieldCount] = useState(0);
  const [isComposing, setIsComposing] = useState(false);

  useEffect(() => {
    if (activeFieldCount === 0 && !isComposing) {
      setTitle(data.title);
      setContent(noteMetadata.content);
    }
  }, [id, data.title, isComposing, noteMetadata.content]);

  const submitNote = (patch?: Partial<{ title: string; content: string }>): void => {
    data.onUpdateNote?.({
      nodeId: id,
      title: patch?.title ?? title,
      content: patch?.content ?? content
    });
  };

  const beginEditing = (): void => {
    setActiveFieldCount((current) => current + 1);
    data.onSelectNode?.(id);
  };

  const finishEditing = (): void => {
    setActiveFieldCount((current) => Math.max(0, current - 1));
  };

  const deleteNote = (): void => {
    data.onSelectNode?.(id);
    data.onDeleteNode?.(id);
  };

  return (
    <div className={`canvas-node object-editor-node kind-note ${data.selected ? 'is-selected' : ''}`}>
      <div className="window-chrome">
        <div className="window-title">
          <strong>Note</strong>
          <span>{title.trim() || '未命名笔记'}</span>
        </div>
        <div className="window-chrome-actions">
          <span className={`status-pill ${statusToneClass(data.status)}`}>{humanizeStatus(data.status)}</span>
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

      <div className="object-body">
        <label className="node-field">
          <span className="node-field-label">标题</span>
          <input
            className="node-text-input nodrag nopan"
            data-node-interactive="true"
            value={title}
            onFocus={beginEditing}
            onMouseDown={stopCanvasEvent}
            onClick={stopCanvasEvent}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={(event) => {
              const nextTitle = event.currentTarget.value;
              setTitle(nextTitle);
              finishEditing();
              submitNote({ title: nextTitle });
            }}
            onKeyDown={(event) => handleEditableFieldKeyDown(event, submitNote)}
            placeholder="给这条笔记起一个标题"
          />
        </label>

        <label className="node-field">
          <span className="node-field-label">内容</span>
          <textarea
            className="node-textarea note-textarea nowheel nodrag nopan"
            data-node-interactive="true"
            value={content}
            onFocus={beginEditing}
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
              finishEditing();
              submitNote({ content: nextContent });
            }}
            onKeyDown={(event) => handleEditableFieldKeyDown(event, submitNote)}
            placeholder="直接在画布上记录思路、上下文或待确认信息。"
          />
        </label>
      </div>
    </div>
  );
}

function CanvasCardNode({ id, data }: Pick<NodeProps<CanvasNodeData>, 'id' | 'data'>): JSX.Element {
  const agentMetadata = data.metadata?.agent;
  const terminalMetadata = data.metadata?.terminal;

  return (
    <div className={`canvas-node compact-node kind-${data.kind} ${data.selected ? 'is-selected' : ''}`}>
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
  task: TaskEditableNode,
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

function toFlowNodes(params: {
  nodes: CanvasNodeSummary[];
  selectedNodeId: string | undefined;
  workspaceTrusted: boolean;
  agentProviderDrafts: Record<string, AgentProviderKind>;
  onSelectNode: (nodeId: string) => void;
  onAgentProviderChange: (nodeId: string, value: AgentProviderKind) => void;
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
  onUpdateTask: (payload: {
    nodeId: string;
    title: string;
    status: TaskNodeStatus;
    description: string;
    assignee: string;
  }) => void;
  onUpdateNote: (payload: {
    nodeId: string;
    title: string;
    content: string;
  }) => void;
  onDeleteNode: (nodeId: string) => void;
}): CanvasFlowNode[] {
  return params.nodes.map((node) => ({
    id: node.id,
    type:
      node.kind === 'agent'
        ? 'agent'
        : node.kind === 'terminal'
          ? 'terminal'
          : node.kind === 'task'
            ? 'task'
            : node.kind === 'note'
              ? 'note'
              : 'card',
    position: node.position,
    draggable: true,
    data: {
      kind: node.kind,
      title: node.title,
      status: node.status,
      summary: node.summary,
      selected: node.id === params.selectedNodeId,
      workspaceTrusted: params.workspaceTrusted,
      metadata: node.metadata,
      agentProvider: params.agentProviderDrafts[node.id] ?? node.metadata?.agent?.provider ?? 'codex',
      onSelectNode: params.onSelectNode,
      onAgentProviderChange: params.onAgentProviderChange,
      onStartExecution: params.onStartExecution,
      onAttachExecution: params.onAttachExecution,
      onExecutionInput: params.onExecutionInput,
      onResizeExecution: params.onResizeExecution,
      onStopExecution: params.onStopExecution,
      onUpdateTask: params.onUpdateTask,
      onUpdateNote: params.onUpdateNote,
      onDeleteNode: params.onDeleteNode
    }
  }));
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
    case 'task':
      return '#f59e0b';
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
    case 'todo':
      return '待开始';
    case 'running':
      return '运行中';
    case 'blocked':
      return '阻塞';
    case 'done':
      return '已完成';
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
    case 'running':
      return 'tone-running';
    case 'done':
      return 'tone-success';
    case 'blocked':
    case 'cancelled':
    case 'interrupted':
      return 'tone-warning';
    case 'error':
      return 'tone-error';
    default:
      return 'tone-idle';
  }
}

function normalizeTaskStatus(status: string): TaskNodeStatus {
  if (status === 'running' || status === 'blocked' || status === 'done') {
    return status;
  }

  return 'todo';
}

function handleEditableFieldKeyDown(
  event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  submit: () => void
): void {
  stopCanvasEvent(event);

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
  return target instanceof HTMLElement && Boolean(target.closest('[data-node-interactive="true"]'));
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

function snapEmbeddedTerminalViewportHeight(terminal: Terminal, preferredHeight: number): number | null {
  const cellHeight = readEmbeddedTerminalCellHeight(terminal);
  if (!cellHeight || preferredHeight <= 0) {
    return null;
  }

  const rows = Math.max(1, Math.floor(preferredHeight / cellHeight));
  return Math.ceil(rows * cellHeight);
}

function readEmbeddedTerminalCellHeight(terminal: Terminal): number | null {
  const core = (
    terminal as Terminal & {
      _core?: {
        _renderService?: {
          dimensions?: {
            css?: {
              cell?: {
                height?: number;
              };
            };
          };
        };
      };
    }
  )._core;
  const cellHeight = core?._renderService?.dimensions?.css?.cell?.height;
  return typeof cellHeight === 'number' && Number.isFinite(cellHeight) && cellHeight > 0 ? cellHeight : null;
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
