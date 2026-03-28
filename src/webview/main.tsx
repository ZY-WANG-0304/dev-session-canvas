import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  type Node,
  type NodeMouseHandler,
  type NodeProps,
  type Viewport
} from 'reactflow';

import 'reactflow/dist/style.css';
import './styles.css';

import type {
  CanvasNodeKind,
  CanvasNodeMetadata,
  CanvasNodeSummary,
  CanvasPrototypeState,
  HostToWebviewMessage,
  WebviewToHostMessage
} from '../common/protocol';

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
  metadata?: CanvasNodeMetadata;
}

type CanvasFlowNode = Node<CanvasNodeData>;

const vscode = acquireVsCodeApi<LocalUiState>();
const rootElement = document.querySelector<HTMLDivElement>('#app');

if (!rootElement) {
  throw new Error('Webview root element not found.');
}

const root = createRoot(rootElement);

function App(): JSX.Element {
  const [hostState, setHostState] = useState<CanvasPrototypeState | null>(null);
  const [localUiState, setLocalUiState] = useState<LocalUiState>(() => vscode.getState() ?? {});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const clearErrorTimer = useRef<number | null>(null);

  useEffect(() => {
    const listener = (event: MessageEvent<HostToWebviewMessage>) => {
      const message = event.data;

      switch (message.type) {
        case 'host/bootstrap':
        case 'host/stateUpdated':
          setHostState(message.payload.state);
          break;
        case 'host/error':
          setErrorMessage(message.payload.message);
          if (clearErrorTimer.current) {
            window.clearTimeout(clearErrorTimer.current);
          }
          clearErrorTimer.current = window.setTimeout(() => setErrorMessage(null), 2600);
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

  const nodes = useMemo(
    () => toFlowNodes(hostState?.nodes ?? [], localUiState.selectedNodeId),
    [hostState, localUiState.selectedNodeId]
  );

  const selectedNode = useMemo(
    () => hostState?.nodes.find((node) => node.id === localUiState.selectedNodeId),
    [hostState, localUiState.selectedNodeId]
  );

  const updateLocalUiState = (nextState: LocalUiState): void => {
    setLocalUiState(nextState);
    vscode.setState(nextState);
  };

  const handleNodeClick: NodeMouseHandler = (_event, node) => {
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

  const updatedAtLabel = hostState
    ? new Date(hostState.updatedAt).toLocaleString()
    : '等待宿主初始化';

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
        onNodeClick={handleNodeClick}
        onNodeDragStop={handleNodeDragStop}
        onPaneClick={handlePaneClick}
        onMoveEnd={handleMoveEnd}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1.2} />
        <MiniMap
          pannable
          zoomable
          nodeColor={(node) => colorForKind((node.data as CanvasNodeData).kind)}
          maskColor="rgba(7, 12, 24, 0.72)"
        />
        <Controls showInteractive={false} />

        <Panel position="top-left" className="hero-panel">
          <div className="eyebrow">OpenCove Prototype</div>
          <h1>React Flow canvas prototype</h1>
          <p>
            当前重点是验证“真正的空间化画布 + 宿主权威状态 + typed message bridge”这条主线。
          </p>
          <div className="meta-row">
            <div>
              <span className="meta-label">宿主状态更新时间</span>
              <strong>{updatedAtLabel}</strong>
            </div>
            <div>
              <span className="meta-label">对象数量</span>
              <strong>{hostState?.nodes.length ?? 0}</strong>
            </div>
          </div>
        </Panel>

        <Panel position="top-right" className="actions-panel">
          <section>
            <h2>创建示例对象</h2>
            <p>用最小动作验证宿主消息处理、节点创建和画布状态投影。</p>
            <div className="action-row">
              <ActionButton label="新增 Agent" onClick={() => createNode('agent')} />
              <ActionButton label="新增 Terminal" onClick={() => createNode('terminal')} />
              <ActionButton label="新增 Task" onClick={() => createNode('task')} />
              <ActionButton label="新增 Note" onClick={() => createNode('note')} />
            </div>
          </section>
          <section>
            <h2>恢复链路</h2>
            <p>宿主负责对象图与位置，Webview 只记录视口与选中态等局部 UI 状态。</p>
            <div className="action-row">
              <ActionButton
                label="重置宿主状态"
                tone="secondary"
                onClick={() => postMessage({ type: 'webview/resetDemoState' })}
              />
            </div>
          </section>
          <section>
            <h2>选中节点</h2>
            {selectedNode ? (
              <SelectedNodeDetails
                node={selectedNode}
                onEnsureTerminal={() =>
                  postMessage({
                    type: 'webview/ensureTerminalSession',
                    payload: { nodeId: selectedNode.id }
                  })
                }
                onRevealTerminal={() =>
                  postMessage({
                    type: 'webview/revealTerminal',
                    payload: { nodeId: selectedNode.id }
                  })
                }
                onReconnectTerminal={() =>
                  postMessage({
                    type: 'webview/reconnectTerminal',
                    payload: { nodeId: selectedNode.id }
                  })
                }
              />
            ) : (
              <p>选中一个节点后，这里会显示节点详情与可用动作。</p>
            )}
          </section>
        </Panel>

        <Panel position="bottom-left" className="footer-panel">
          <strong>当前验证范围</strong>
          <span>平移、缩放、节点呈现、拖拽回传、宿主状态恢复入口。</span>
        </Panel>
      </ReactFlow>

      {errorMessage ? <div className="toast-error">{errorMessage}</div> : null}
    </div>
  );

  function createNode(kind: CanvasNodeKind): void {
    postMessage({
      type: 'webview/createDemoNode',
      payload: { kind }
    });
  }
}

function CanvasCardNode({ data }: NodeProps<CanvasNodeData>): JSX.Element {
  return (
    <div className={`canvas-node kind-${data.kind} ${data.selected ? 'is-selected' : ''}`}>
      <div className="node-topline">
        <strong>{data.title}</strong>
        <span>{data.kind}</span>
      </div>
      <div className="node-status">状态：{data.status}</div>
      {data.kind === 'terminal' ? (
        <div className="node-hint">
          {data.metadata?.terminal?.liveSession ? '已连接宿主终端' : '终端尚未创建或已关闭'}
        </div>
      ) : null}
      <p>{data.summary}</p>
    </div>
  );
}

const nodeTypes = {
  canvas: CanvasCardNode
};

function ActionButton(props: {
  label: string;
  onClick: () => void;
  tone?: 'primary' | 'secondary';
}): JSX.Element {
  return (
    <button
      type="button"
      className={`action-button ${props.tone === 'secondary' ? 'secondary' : 'primary'}`}
      onClick={props.onClick}
    >
      {props.label}
    </button>
  );
}

function toFlowNodes(
  nodes: CanvasNodeSummary[],
  selectedNodeId: string | undefined
): CanvasFlowNode[] {
  return nodes.map((node) => ({
    id: node.id,
    type: 'canvas',
    position: node.position,
    draggable: true,
    data: {
      kind: node.kind,
      title: node.title,
      status: node.status,
      summary: node.summary,
      selected: node.id === selectedNodeId,
      metadata: node.metadata
    }
  }));
}

function SelectedNodeDetails(props: {
  node: CanvasNodeSummary;
  onEnsureTerminal: () => void;
  onRevealTerminal: () => void;
  onReconnectTerminal: () => void;
}): JSX.Element {
  const { node } = props;
  const terminalMetadata = node.metadata?.terminal;

  return (
    <div className="selected-node-panel">
      <div className="selected-node-header">
        <strong>{node.title}</strong>
        <span>{node.kind}</span>
      </div>
      <div className="selected-node-status">状态：{node.status}</div>
      <p>{node.summary}</p>
      {node.kind === 'terminal' && terminalMetadata ? (
        <div className="selected-node-terminal">
          <div className="selected-node-meta">
            <span className="meta-label">宿主终端名称</span>
            <code>{terminalMetadata.terminalName}</code>
          </div>
          <div className="selected-node-meta">
            <span className="meta-label">显示位置</span>
            <strong>{terminalMetadata.revealMode === 'editor' ? '编辑器区域' : '终端面板'}</strong>
          </div>
          <div className="selected-node-meta">
            <span className="meta-label">会话状态</span>
            <strong>{terminalMetadata.liveSession ? '已连接' : '未连接'}</strong>
          </div>
          <div className="action-row">
            <ActionButton
              label={terminalMetadata.liveSession ? '显示终端' : '创建并显示终端'}
              onClick={terminalMetadata.liveSession ? props.onRevealTerminal : props.onEnsureTerminal}
            />
            {!terminalMetadata.liveSession ? (
              <ActionButton
                label="尝试连接现有终端"
                tone="secondary"
                onClick={props.onReconnectTerminal}
              />
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
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

function postMessage(message: WebviewToHostMessage): void {
  vscode.postMessage(message);
}

root.render(<App />);
