import React, { useEffect, useRef, useState } from 'react';
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
  AgentProviderKind,
  AgentTranscriptEntry,
  CanvasNodeKind,
  CanvasNodeMetadata,
  CanvasRuntimeContext,
  CanvasNodeSummary,
  CanvasPrototypeState,
  HostToWebviewMessage,
  TaskNodeStatus,
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
  agentDraftSnapshots?: Record<string, string>;
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
  initialAgentDraft?: string;
  agentProvider?: AgentProviderKind;
  onSelectNode?: (nodeId: string) => void;
  onPersistAgentDraft?: (nodeId: string, value: string) => void;
  onAgentProviderChange?: (nodeId: string, value: AgentProviderKind) => void;
  onStartAgent?: (nodeId: string, prompt: string, provider: AgentProviderKind) => void;
  onStopAgent?: (nodeId: string) => void;
  onEnsureTerminal?: (nodeId: string) => void;
  onRevealTerminal?: (nodeId: string) => void;
  onReconnectTerminal?: (nodeId: string) => void;
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
}

type CanvasFlowNode = Node<CanvasNodeData>;

const vscode = acquireVsCodeApi<LocalUiState>();
const initialPersistedState = vscode.getState() ?? {};
const rootElement = document.querySelector<HTMLDivElement>('#app');

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
  const [agentDraftSnapshots, setAgentDraftSnapshots] = useState<Record<string, string>>(
    () => initialPersistedState.agentDraftSnapshots ?? {}
  );
  const [agentProviderDrafts, setAgentProviderDrafts] = useState<Record<string, AgentProviderKind>>(
    () => initialPersistedState.agentProviderDrafts ?? {}
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const clearErrorTimer = useRef<number | null>(null);

  useEffect(() => {
    const listener = (event: MessageEvent<HostToWebviewMessage>) => {
      const message = event.data;

      switch (message.type) {
        case 'host/bootstrap':
        case 'host/stateUpdated':
          setHostState(message.payload.state);
          setRuntimeContext(message.payload.runtime);
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

  useEffect(() => {
    vscode.setState({
      ...localUiState,
      agentDraftSnapshots,
      agentProviderDrafts
    });
  }, [localUiState, agentDraftSnapshots, agentProviderDrafts]);

  const selectedNode = hostState?.nodes.find((node) => node.id === localUiState.selectedNodeId);
  const workspaceTrusted = runtimeContext.workspaceTrusted;
  const updatedAtLabel = hostState
    ? new Date(hostState.updatedAt).toLocaleString()
    : '等待宿主初始化';

  const nodes = toFlowNodes({
    nodes: hostState?.nodes ?? [],
    selectedNodeId: localUiState.selectedNodeId,
    workspaceTrusted,
    agentDraftSnapshots,
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
    onPersistAgentDraft: (nodeId, value) => {
      setAgentDraftSnapshots((current) => ({
        ...current,
        [nodeId]: value
      }));
    },
    onAgentProviderChange: (nodeId, value) => {
      setAgentProviderDrafts((current) => ({
        ...current,
        [nodeId]: value
      }));
    },
    onStartAgent: (nodeId, prompt, provider) => {
      const trimmedPrompt = prompt.trim();
      if (!trimmedPrompt) {
        return;
      }

      postMessage({
        type: 'webview/startAgentRun',
        payload: {
          nodeId,
          prompt: trimmedPrompt,
          provider
        }
      });

      setAgentDraftSnapshots((current) => ({
        ...current,
        [nodeId]: ''
      }));
    },
    onStopAgent: (nodeId) =>
      postMessage({
        type: 'webview/stopAgentRun',
        payload: { nodeId }
      }),
    onEnsureTerminal: (nodeId) =>
      postMessage({
        type: 'webview/ensureTerminalSession',
        payload: { nodeId }
      }),
    onRevealTerminal: (nodeId) =>
      postMessage({
        type: 'webview/revealTerminal',
        payload: { nodeId }
      }),
    onReconnectTerminal: (nodeId) =>
      postMessage({
        type: 'webview/reconnectTerminal',
        payload: { nodeId }
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
      })
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
          <h1>Canvas runtime windows</h1>
          <p>当前重点是把 Agent 和 Terminal 收敛成真正放在画布上的会话窗口，而不是侧栏驱动的配置卡片。</p>
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
            <p>直接创建四类对象，验证会话窗口、宿主消息处理与节点状态投影。</p>
            <div className="action-row">
              {workspaceTrusted ? (
                <>
                  <ActionButton label="新增 Agent" onClick={() => createNode('agent')} />
                  <ActionButton label="新增 Terminal" onClick={() => createNode('terminal')} />
                </>
              ) : null}
              <ActionButton label="新增 Task" onClick={() => createNode('task')} />
              <ActionButton label="新增 Note" onClick={() => createNode('note')} />
            </div>
            {!workspaceTrusted ? (
              <p className="restricted-note">
                当前 workspace 未受信任，已隐藏 Agent / Terminal 执行型对象入口。
              </p>
            ) : null}
          </section>
          <section>
            <h2>恢复链路</h2>
            <p>宿主仍是对象图权威来源；Webview 只保存视口、选中态和节点内草稿。</p>
            <div className="action-row">
              <ActionButton
                label="重置宿主状态"
                tone="secondary"
                onClick={() => postMessage({ type: 'webview/resetDemoState' })}
              />
            </div>
          </section>
          <section>
            <h2>选中节点概况</h2>
            {selectedNode ? (
              <SelectedNodeDetails node={selectedNode} workspaceTrusted={workspaceTrusted} />
            ) : (
              <p>选中一个节点后，这里会显示当前概况。</p>
            )}
          </section>
        </Panel>

        <Panel position="bottom-left" className="footer-panel">
          <strong>当前验证范围</strong>
          <span>节点内会话交互、宿主状态回流、拖拽定位和 Webview 局部状态恢复。</span>
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

function AgentSessionNode({ id, data }: NodeProps<CanvasNodeData>): JSX.Element {
  const agentMetadata = data.metadata?.agent;
  if (!agentMetadata) {
    return <CanvasCardNode data={data} />;
  }

  const provider = data.agentProvider ?? agentMetadata.provider ?? 'codex';
  const transcript = agentMetadata.transcript ?? [];
  const initialDraft = data.initialAgentDraft ?? agentMetadata.lastPrompt ?? '';
  const executionBlocked = !data.workspaceTrusted;
  const [draft, setDraft] = useState(initialDraft);
  const [isFocused, setIsFocused] = useState(false);
  const [isComposing, setIsComposing] = useState(false);
  const actionLabel = agentMetadata.liveRun ? '停止' : '发送';

  useEffect(() => {
    if (!isFocused && !isComposing) {
      setDraft(initialDraft);
    }
  }, [id, initialDraft, isFocused, isComposing]);

  const submitDraft = (): void => {
    const trimmedDraft = draft.trim();
    if (!trimmedDraft || agentMetadata.liveRun) {
      return;
    }

    data.onStartAgent?.(id, trimmedDraft, provider);
    setDraft('');
  };

  return (
    <div className={`canvas-node session-node agent-session-node kind-agent ${data.selected ? 'is-selected' : ''}`}>
      <div className="window-chrome">
        <div className="window-title">
          <strong>{providerLabel(provider)}</strong>
          <span>{data.title}</span>
        </div>
        <span className={`status-pill ${statusToneClass(data.status)}`}>
          {agentMetadata.liveRun ? '运行中' : humanizeStatus(data.status)}
        </span>
      </div>

      <div className="session-body">
        <div className="session-banner">
          <strong>{agentMetadata.lastBackendLabel ?? `${providerLabel(provider)} CLI`}</strong>
          <span>{data.summary}</span>
        </div>

        <div
          className="agent-transcript nowheel nopan nodrag"
          data-node-interactive="true"
          onMouseDown={stopCanvasEvent}
          onClick={stopCanvasEvent}
          onDoubleClick={stopCanvasEvent}
          onWheel={stopCanvasEvent}
        >
          {transcript.length > 0 ? (
            transcript.map((entry) => (
              <AgentTranscriptBubble key={entry.id} entry={entry} provider={provider} />
            ))
          ) : (
            <div className="agent-empty-state">
              在节点内输入第一条消息后，这里会保留用户输入、流式输出和运行状态。
            </div>
          )}
        </div>

        {executionBlocked ? (
          <RestrictedBanner
            title="Restricted Mode"
            description="当前 workspace 未受信任，Agent 运行入口已禁用。信任 workspace 后可继续发送消息。"
          />
        ) : (
          <div
            className="agent-composer nodrag nopan"
            data-node-interactive="true"
            onMouseDown={stopCanvasEvent}
            onClick={stopCanvasEvent}
            onDoubleClick={stopCanvasEvent}
          >
            <div className="agent-composer-toolbar">
              <select
                className="agent-provider-select nodrag nopan"
                data-node-interactive="true"
                value={provider}
                disabled={agentMetadata.liveRun}
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
              <ActionButton
                label={actionLabel}
                onClick={() =>
                  agentMetadata.liveRun
                    ? data.onStopAgent?.(id)
                    : submitDraft()
                }
                disabled={!agentMetadata.liveRun && !draft.trim()}
                className="nodrag nopan"
                interactive
                onFocus={() => data.onSelectNode?.(id)}
              />
            </div>
            <textarea
              className="agent-prompt-input nowheel nodrag nopan"
              data-node-interactive="true"
              value={draft}
              onFocus={() => {
                setIsFocused(true);
                data.onSelectNode?.(id);
              }}
              onMouseDown={stopCanvasEvent}
              onClick={stopCanvasEvent}
              onCompositionStart={() => setIsComposing(true)}
              onCompositionEnd={(event) => {
                setIsComposing(false);
                const nextValue = event.currentTarget.value;
                setDraft(nextValue);
              }}
              onChange={(event) => {
                const nextValue = event.target.value;
                setDraft(nextValue);
              }}
              onBlur={(event) => {
                setIsFocused(false);
                data.onPersistAgentDraft?.(id, event.target.value);
              }}
              onKeyDown={(event) => {
                stopCanvasEvent(event);
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                  event.preventDefault();
                  submitDraft();
                  return;
                }

                if (event.key === 'Escape') {
                  event.currentTarget.blur();
                }
              }}
              placeholder="向这个 Agent 发送下一条指令"
            />
          </div>
        )}
      </div>
    </div>
  );
}

function AgentTranscriptBubble(props: {
  entry: AgentTranscriptEntry;
  provider: AgentProviderKind;
}): JSX.Element {
  const { entry, provider } = props;
  const label =
    entry.role === 'user'
      ? '你'
      : entry.role === 'assistant'
        ? providerLabel(provider)
        : '系统';
  const content =
    entry.role === 'assistant' && entry.state === 'streaming' && !entry.text
      ? '正在运行...'
      : entry.text;

  return (
    <div className={`agent-bubble role-${entry.role} state-${entry.state ?? 'done'}`}>
      <div className="agent-bubble-header">
        <strong>{label}</strong>
        {entry.state === 'streaming' ? <span>流式输出</span> : null}
      </div>
      <div className="agent-bubble-content">{content}</div>
    </div>
  );
}

function TerminalSessionNode({ id, data }: NodeProps<CanvasNodeData>): JSX.Element {
  const terminalMetadata = data.metadata?.terminal;
  if (!terminalMetadata) {
    return <CanvasCardNode data={data} />;
  }

  const executionBlocked = !data.workspaceTrusted;

  return (
    <div
      className={`canvas-node session-node terminal-session-node kind-terminal ${data.selected ? 'is-selected' : ''}`}
    >
      <div className="window-chrome">
        <div className="window-title">
          <strong>{data.title}</strong>
          <span>{terminalMetadata.terminalName}</span>
        </div>
        <span className={`status-pill ${terminalMetadata.liveSession ? 'tone-running' : 'tone-idle'}`}>
          {terminalMetadata.liveSession ? '已连接' : '未连接'}
        </span>
      </div>

      <div className="session-body">
        <div className="terminal-surface">
          <div className="terminal-surface-line">
            <span className="terminal-surface-prefix">$</span>
            <span>{data.summary}</span>
          </div>
          <div className="terminal-surface-meta">
            <span>显示位置</span>
            <strong>{terminalMetadata.revealMode === 'editor' ? '编辑器区域' : '终端面板'}</strong>
          </div>
        </div>

        {executionBlocked ? (
          <RestrictedBanner
            title="Restricted Mode"
            description="当前 workspace 未受信任，终端入口已禁用。信任 workspace 后可创建、显示或重连终端。"
          />
        ) : (
          <div className="action-row">
            <ActionButton
              label={terminalMetadata.liveSession ? '显示终端' : '创建并显示终端'}
              onClick={() =>
                terminalMetadata.liveSession ? data.onRevealTerminal?.(id) : data.onEnsureTerminal?.(id)
              }
              className="nodrag nopan"
              interactive
              onFocus={() => data.onSelectNode?.(id)}
            />
            {!terminalMetadata.liveSession ? (
              <ActionButton
                label="尝试连接现有终端"
                tone="secondary"
                onClick={() => data.onReconnectTerminal?.(id)}
                className="nodrag nopan"
                interactive
                onFocus={() => data.onSelectNode?.(id)}
              />
            ) : null}
          </div>
        )}
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
    return <CanvasCardNode data={data} />;
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

  return (
    <div className={`canvas-node object-editor-node kind-task ${data.selected ? 'is-selected' : ''}`}>
      <div className="window-chrome">
        <div className="window-title">
          <strong>Task</strong>
          <span>{title.trim() || '未命名任务'}</span>
        </div>
        <span className={`status-pill ${statusToneClass(status)}`}>{humanizeStatus(status)}</span>
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
    return <CanvasCardNode data={data} />;
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

  return (
    <div className={`canvas-node object-editor-node kind-note ${data.selected ? 'is-selected' : ''}`}>
      <div className="window-chrome">
        <div className="window-title">
          <strong>Note</strong>
          <span>{title.trim() || '未命名笔记'}</span>
        </div>
        <span className={`status-pill ${statusToneClass(data.status)}`}>{humanizeStatus(data.status)}</span>
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

function CanvasCardNode({ data }: Pick<NodeProps<CanvasNodeData>, 'data'>): JSX.Element {
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
          {agentMetadata.liveRun
            ? `${providerLabel(agentMetadata.provider)} 正在运行`
            : agentMetadata.transcript?.length
              ? '已保留最近会话转录'
              : '等待首次运行'}
        </div>
      ) : null}
      {data.kind === 'terminal' && terminalMetadata ? (
        <div className="node-hint">
          {terminalMetadata.liveSession ? '已连接宿主终端' : '终端尚未创建或已关闭'}
        </div>
      ) : null}
      <p>{data.summary}</p>
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
  tone?: 'primary' | 'secondary';
  disabled?: boolean;
  className?: string;
  interactive?: boolean;
  onFocus?: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      data-node-interactive={props.interactive ? 'true' : undefined}
      className={`action-button ${props.tone === 'secondary' ? 'secondary' : 'primary'} ${props.className ?? ''}`.trim()}
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
  agentDraftSnapshots: Record<string, string>;
  agentProviderDrafts: Record<string, AgentProviderKind>;
  onSelectNode: (nodeId: string) => void;
  onPersistAgentDraft: (nodeId: string, value: string) => void;
  onAgentProviderChange: (nodeId: string, value: AgentProviderKind) => void;
  onStartAgent: (nodeId: string, prompt: string, provider: AgentProviderKind) => void;
  onStopAgent: (nodeId: string) => void;
  onEnsureTerminal: (nodeId: string) => void;
  onRevealTerminal: (nodeId: string) => void;
  onReconnectTerminal: (nodeId: string) => void;
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
      initialAgentDraft:
        params.agentDraftSnapshots[node.id] ?? node.metadata?.agent?.lastPrompt ?? '',
      agentProvider: params.agentProviderDrafts[node.id] ?? node.metadata?.agent?.provider ?? 'codex',
      onSelectNode: params.onSelectNode,
      onPersistAgentDraft: params.onPersistAgentDraft,
      onAgentProviderChange: params.onAgentProviderChange,
      onStartAgent: params.onStartAgent,
      onStopAgent: params.onStopAgent,
      onEnsureTerminal: params.onEnsureTerminal,
      onRevealTerminal: params.onRevealTerminal,
      onReconnectTerminal: params.onReconnectTerminal,
      onUpdateTask: params.onUpdateTask,
      onUpdateNote: params.onUpdateNote
    }
  }));
}

function SelectedNodeDetails(props: { node: CanvasNodeSummary; workspaceTrusted: boolean }): JSX.Element {
  const { node } = props;
  const agentMetadata = node.metadata?.agent;
  const terminalMetadata = node.metadata?.terminal;
  const taskMetadata = node.metadata?.task;
  const noteMetadata = node.metadata?.note;

  return (
    <div className="selected-node-panel">
      <div className="selected-node-header">
        <strong>{node.title}</strong>
        <span>{node.kind}</span>
      </div>
      <div className="selected-node-status">状态：{humanizeStatus(node.status)}</div>
      <p>{node.summary}</p>
      {node.kind === 'agent' && agentMetadata ? (
        <div className="selected-node-meta-group">
          <div className="selected-node-meta">
            <span className="meta-label">当前 provider</span>
            <strong>{providerLabel(agentMetadata.provider)}</strong>
          </div>
          <div className="selected-node-meta">
            <span className="meta-label">最近后端</span>
            <strong>{agentMetadata.lastBackendLabel ?? '尚未运行'}</strong>
          </div>
          <div className="selected-node-meta">
            <span className="meta-label">转录条目数</span>
            <strong>{agentMetadata.transcript?.length ?? 0}</strong>
          </div>
          {agentMetadata.lastResponse ? (
            <div className="selected-node-meta">
              <span className="meta-label">最近输出</span>
              <pre className="selected-node-output">{agentMetadata.lastResponse}</pre>
            </div>
          ) : null}
          {!props.workspaceTrusted ? (
            <p className="selected-node-note">当前 workspace 未受信任，Agent 运行入口已退化为只读展示。</p>
          ) : null}
          <p className="selected-node-note">主交互已收敛到节点内部：在画布上直接发送消息并查看转录。</p>
        </div>
      ) : null}
      {node.kind === 'terminal' && terminalMetadata ? (
        <div className="selected-node-meta-group">
          <div className="selected-node-meta">
            <span className="meta-label">宿主终端名称</span>
            <code>{terminalMetadata.terminalName}</code>
          </div>
          <div className="selected-node-meta">
            <span className="meta-label">显示位置</span>
            <strong>{terminalMetadata.revealMode === 'editor' ? '编辑器区域' : '终端面板'}</strong>
          </div>
          {!props.workspaceTrusted ? (
            <p className="selected-node-note">当前 workspace 未受信任，终端相关入口已退化为只读展示。</p>
          ) : null}
        </div>
      ) : null}
      {node.kind === 'task' && taskMetadata ? (
        <div className="selected-node-meta-group">
          <div className="selected-node-meta">
            <span className="meta-label">任务状态</span>
            <strong>{humanizeStatus(node.status)}</strong>
          </div>
          <div className="selected-node-meta">
            <span className="meta-label">负责人</span>
            <strong>{taskMetadata.assignee || '未填写'}</strong>
          </div>
          <div className="selected-node-meta">
            <span className="meta-label">任务描述</span>
            <pre className="selected-node-output">{taskMetadata.description || '暂无描述'}</pre>
          </div>
        </div>
      ) : null}
      {node.kind === 'note' && noteMetadata ? (
        <div className="selected-node-meta-group">
          <div className="selected-node-meta">
            <span className="meta-label">笔记内容</span>
            <pre className="selected-node-output">{noteMetadata.content || '暂无内容'}</pre>
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

function stopCanvasEvent(event: { stopPropagation: () => void }): void {
  event.stopPropagation();
}

function postMessage(message: WebviewToHostMessage): void {
  vscode.postMessage(message);
}

root.render(<App />);
