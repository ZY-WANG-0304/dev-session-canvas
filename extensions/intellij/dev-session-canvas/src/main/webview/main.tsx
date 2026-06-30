import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import 'reactflow/dist/style.css';
import './styles.css';
import { createCanvasHostAdapter } from './hostAdapter';
import type { CanvasNode } from './hostAdapter';

const host = createCanvasHostAdapter();

function toFlowNode(node: CanvasNode): Node<CanvasNode> {
  return {
    id: node.id,
    type: 'note',
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

function CanvasApp(): JSX.Element {
  const reactFlow = useReactFlow<CanvasNode>();
  const [nodes, setNodes] = useNodesState<CanvasNode>([]);
  const [viewport, setViewport] = useState({ x: 0, y: 0, zoom: 1 });

  const nodeTypes = useMemo(() => ({ note: NoteNode }), []);

  useEffect(() => {
    const dispose = host.onMessage((message): void => {
      if (message.type === 'host/bootstrap' || message.type === 'host/stateUpdated') {
        setNodes(message.payload.nodes.map(toFlowNode));
        setViewport(message.payload.viewport);
        window.requestAnimationFrame(() => {
          void reactFlow.setViewport(message.payload.viewport);
        });
      }
    });
    host.postMessage({ type: 'webview/ready' });
    return dispose;
  }, [reactFlow, setNodes]);

  useEffect(() => {
    document.documentElement.dataset.dscViewport = `${viewport.x.toFixed(1)},${viewport.y.toFixed(1)},${viewport.zoom.toFixed(3)}`;
    document.documentElement.dataset.dscNodeCount = String(nodes.length);
  }, [nodes.length, viewport]);

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
