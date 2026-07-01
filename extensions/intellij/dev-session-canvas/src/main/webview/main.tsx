import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import ReactFlow, {
  applyNodeChanges,
  Background,
  Controls,
  Node,
  NodeDragHandler,
  NodeChange,
  NodeProps,
  NodeResizer,
  OnMove,
  useReactFlow,
  ReactFlowProvider,
  useNodesState
} from 'reactflow';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import 'reactflow/dist/style.css';
import '@xterm/xterm/css/xterm.css';
import './styles.css';
import { createCanvasHostAdapter } from './hostAdapter';
import type { CanvasNode } from './hostAdapter';

const host = createCanvasHostAdapter();

type TerminalBinding = {
  terminal: Terminal;
  fitAddon: FitAddon;
  lastRecentOutput: string;
};

const MAX_RECENT_OUTPUT_CHARS = 12000;
const terminalBindings = new Map<string, TerminalBinding>();
const pendingTerminalOutput = new Map<string, string>();

function retainRecentOutput(value: string): string {
  return value.length <= MAX_RECENT_OUTPUT_CHARS ? value : value.slice(-MAX_RECENT_OUTPUT_CHARS);
}

function appendTerminalOutput(binding: TerminalBinding, text: string): void {
  binding.terminal.write(text);
  binding.lastRecentOutput = retainRecentOutput(binding.lastRecentOutput + text);
}

function appendPendingTerminalOutput(id: string, text: string): void {
  pendingTerminalOutput.set(id, retainRecentOutput((pendingTerminalOutput.get(id) ?? '') + text));
}

function toFlowNode(node: CanvasNode): Node<CanvasNode> {
  return {
    id: node.id,
    type: node.type,
    position: { x: node.x, y: node.y },
    data: node,
    style: {
      width: node.width,
      height: node.height
    }
  };
}

function NoteNode({ data, selected }: NodeProps<CanvasNode>): JSX.Element {
  const [title, setTitle] = useState(data.title);
  const [body, setBody] = useState(data.body);

  useEffect(() => {
    setTitle(data.title);
    setBody(data.body);
  }, [data.body, data.title]);

  const updateTitle = useCallback((event: React.ChangeEvent<HTMLInputElement>): void => {
    const nextTitle = event.target.value;
    setTitle(nextTitle);
    host.postMessage({ type: 'webview/updateNote', id: data.id, title: nextTitle });
  }, [data.id]);

  const updateBody = useCallback((event: React.ChangeEvent<HTMLTextAreaElement>): void => {
    const nextBody = event.target.value;
    setBody(nextBody);
    host.postMessage({ type: 'webview/updateNote', id: data.id, body: nextBody });
  }, [data.id]);

  const deleteNode = useCallback((): void => {
    host.postMessage({ type: 'webview/deleteNode', id: data.id });
  }, [data.id]);

  return (
    <div className="dsc-note-node" data-dsc-note-id={data.id} data-selected={String(selected)}>
      <NodeResizer
        isVisible={selected}
        minWidth={220}
        minHeight={140}
        onResizeEnd={(_, params) => {
          host.postMessage({
            type: 'webview/updateNote',
            id: data.id,
            width: params.width,
            height: params.height
          });
        }}
      />
      <input
        className="dsc-note-title nodrag"
        aria-label="Note title"
        value={title}
        onChange={updateTitle}
      />
      <button className="dsc-note-delete nodrag" type="button" onClick={deleteNode} aria-label="Delete note">
        Delete
      </button>
      <textarea
        className="dsc-note-body nodrag"
        aria-label="Note body"
        value={body}
        onChange={updateBody}
      />
    </div>
  );
}

function TerminalNode({ data, selected }: NodeProps<CanvasNode>): JSX.Element {
  const terminalElement = useRef<HTMLDivElement | null>(null);

  const fitAndReport = useCallback((): void => {
    const binding = terminalBindings.get(data.id);
    if (!binding) {
      return;
    }
    try {
      binding.fitAddon.fit();
      host.postMessage({
        type: 'webview/terminalResize',
        id: data.id,
        cols: binding.terminal.cols,
        rows: binding.terminal.rows
      });
    } catch {
      // xterm fit can throw before layout settles; the next ResizeObserver tick retries.
    }
  }, [data.id]);

  useEffect(() => {
    const container = terminalElement.current;
    if (!container) {
      return undefined;
    }

    const terminal = new Terminal({
      convertEol: true,
      cursorBlink: true,
      fontFamily: 'JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: 12,
      scrollback: 4000,
      theme: {
        background: '#020617',
        foreground: '#dbeafe',
        cursor: '#93c5fd',
        selectionBackground: '#1d4ed8'
      }
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(container);
    const binding: TerminalBinding = { terminal, fitAddon, lastRecentOutput: '' };
    terminalBindings.set(data.id, binding);

    if (data.recentOutput) {
      terminal.write(data.recentOutput);
      binding.lastRecentOutput = retainRecentOutput(data.recentOutput);
    }
    const pendingOutput = pendingTerminalOutput.get(data.id);
    if (pendingOutput) {
      if (!binding.lastRecentOutput.endsWith(pendingOutput)) {
        appendTerminalOutput(binding, pendingOutput);
      }
      pendingTerminalOutput.delete(data.id);
    }
    const dataDisposable = terminal.onData((text) => {
      host.postMessage({ type: 'webview/terminalInput', id: data.id, text });
    });
    const resizeObserver = new ResizeObserver(() => fitAndReport());
    resizeObserver.observe(container);
    window.requestAnimationFrame(fitAndReport);

    return () => {
      resizeObserver.disconnect();
      dataDisposable.dispose();
      terminalBindings.delete(data.id);
      terminal.dispose();
    };
  }, [data.id, fitAndReport]);

  useEffect(() => {
    const binding = terminalBindings.get(data.id);
    const recentOutput = retainRecentOutput(data.recentOutput);
    if (!binding || binding.lastRecentOutput === recentOutput) {
      return;
    }
    if (recentOutput.startsWith(binding.lastRecentOutput)) {
      binding.terminal.write(recentOutput.slice(binding.lastRecentOutput.length));
    } else {
      binding.terminal.reset();
      binding.terminal.write(recentOutput);
    }
    binding.lastRecentOutput = recentOutput;
  }, [data.id, data.recentOutput]);

  const stopTerminal = useCallback((): void => {
    host.postMessage({ type: 'webview/stopTerminal', id: data.id });
  }, [data.id]);

  const deleteNode = useCallback((): void => {
    host.postMessage({ type: 'webview/deleteNode', id: data.id });
  }, [data.id]);

  return (
    <div className="dsc-terminal-node" data-dsc-terminal-id={data.id} data-terminal-status={data.status} data-selected={String(selected)}>
      <NodeResizer
        isVisible={selected}
        minWidth={320}
        minHeight={220}
        onResizeEnd={(_, params) => {
          host.postMessage({ type: 'webview/updateTerminalSize', id: data.id, width: params.width, height: params.height });
          window.requestAnimationFrame(fitAndReport);
        }}
      />
      <div className="dsc-terminal-header">
        <div>
          <strong>{data.title}</strong>
          <span>{data.status}</span>
        </div>
        <div className="dsc-terminal-actions">
          <button className="nodrag" type="button" onClick={stopTerminal}>Stop</button>
          <button className="nodrag" type="button" onClick={deleteNode}>Delete</button>
        </div>
      </div>
      <div className="dsc-terminal-meta" title={`${data.shellPath} in ${data.cwd}`}>
        {data.shellPath || 'shell'} - {data.cwd || 'project'} - {data.lastCols}x{data.lastRows}
      </div>
      <div className="dsc-terminal-viewport nodrag" ref={terminalElement} />
    </div>
  );
}

function CanvasApp(): JSX.Element {
  const reactFlow = useReactFlow<CanvasNode>();
  const [nodes, setNodes] = useNodesState<CanvasNode>([]);
  const [viewport, setViewport] = useState({ x: 0, y: 0, zoom: 1 });

  const nodeTypes = useMemo(() => ({ note: NoteNode, terminal: TerminalNode }), []);

  useEffect(() => {
    const dispose = host.onMessage((message): void => {
      if (message.type === 'host/bootstrap' || message.type === 'host/stateUpdated') {
        setNodes(message.payload.nodes.map(toFlowNode));
        setViewport(message.payload.viewport);
        window.requestAnimationFrame(() => {
          void reactFlow.setViewport(message.payload.viewport);
        });
      }
      if (message.type === 'host/terminalOutput') {
        const binding = terminalBindings.get(message.payload.id);
        if (binding) {
          appendTerminalOutput(binding, message.payload.text);
        } else {
          appendPendingTerminalOutput(message.payload.id, message.payload.text);
        }
      }
      if (message.type === 'host/terminalExit') {
        document.documentElement.dataset.dscLastTerminalExit = `${message.payload.id}:${message.payload.status}:${message.payload.exitCode ?? ''}`;
      }
    });
    host.postMessage({ type: 'webview/ready' });
    return dispose;
  }, [reactFlow, setNodes]);

  useEffect(() => {
    document.documentElement.dataset.dscViewport = `${viewport.x.toFixed(1)},${viewport.y.toFixed(1)},${viewport.zoom.toFixed(3)}`;
    document.documentElement.dataset.dscNodeCount = String(nodes.length);
    document.documentElement.dataset.dscTerminalCount = String(nodes.filter((node) => node.data.type === 'terminal').length);
  }, [nodes, viewport]);

  const onMove = useCallback<OnMove>((_, nextViewport) => {
    setViewport(nextViewport);
  }, []);

  const onMoveEnd = useCallback<OnMove>((_, nextViewport) => {
    setViewport(nextViewport);
    host.postMessage({ type: 'webview/updateViewport', ...nextViewport });
  }, []);

  const handleNodesChange = useCallback((changes: NodeChange[]): void => {
    setNodes((currentNodes) => applyNodeChanges(changes, currentNodes));
  }, [setNodes]);

  const handleNodeDragStop = useCallback<NodeDragHandler>((_, node): void => {
    host.postMessage({
      type: 'webview/updateNodePosition',
      id: node.id,
      x: node.position.x,
      y: node.position.y
    });
  }, []);

  return (
    <div className="dsc-root" data-dsc-root="intellij-react-flow-poc">
      <div className="dsc-toolbar">
        <strong>Dev Session Canvas - IntelliJ</strong>
        <button type="button" onClick={() => host.postMessage({ type: 'webview/createNote' })}>
          Create Note
        </button>
        <button type="button" onClick={() => host.postMessage({ type: 'webview/createTerminal' })}>
          Create Terminal
        </button>
        <span className="dsc-viewport-readout">
          x {viewport.x.toFixed(1)} | y {viewport.y.toFixed(1)} | z {viewport.zoom.toFixed(2)}
        </span>
      </div>
      <ReactFlow
        nodes={nodes}
        edges={[]}
        nodeTypes={nodeTypes}
        onNodesChange={handleNodesChange}
        onNodeDragStop={handleNodeDragStop}
        onMove={onMove}
        onMoveEnd={onMoveEnd}
        minZoom={0.1}
        maxZoom={4}
        deleteKeyCode={null}
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}

const root = document.getElementById('root');
if (!root) {
  throw new Error('Missing #root for Dev Session Canvas IntelliJ webview');
}

createRoot(root).render(
  <React.StrictMode>
    <ReactFlowProvider>
      <CanvasApp />
    </ReactFlowProvider>
  </React.StrictMode>
);
