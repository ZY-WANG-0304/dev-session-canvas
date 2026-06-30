import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import ReactFlow, {
  Background,
  Controls,
  Node,
  NodeProps,
  OnMove,
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
    data: node
  };
}

function NoteNode({ data }: NodeProps<CanvasNode>): JSX.Element {
  return (
    <div className="dsc-note-node" data-dsc-note-id={data.id}>
      <strong>{data.title}</strong>
      <p>{data.body}</p>
    </div>
  );
}

function CanvasApp(): JSX.Element {
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>([]);
  const [viewport, setViewport] = useState({ x: 0, y: 0, zoom: 1 });

  const nodeTypes = useMemo(() => ({ note: NoteNode }), []);

  useEffect(() => {
    const dispose = host.onMessage((message): void => {
      if (message.type === 'host/bootstrap' || message.type === 'host/stateUpdated') {
        setNodes(message.payload.nodes.map(toFlowNode));
      }
    });
    host.postMessage({ type: 'webview/ready' });
    return dispose;
  }, [setNodes]);

  useEffect(() => {
    document.documentElement.dataset.dscViewport = `${viewport.x.toFixed(1)},${viewport.y.toFixed(1)},${viewport.zoom.toFixed(3)}`;
    document.documentElement.dataset.dscNodeCount = String(nodes.length);
  }, [nodes.length, viewport]);

  const onMove = useCallback<OnMove>((_, nextViewport) => {
    setViewport(nextViewport);
  }, []);

  return (
    <div className="dsc-root" data-dsc-root="intellij-react-flow-poc">
      <div className="dsc-toolbar">
        <strong>Dev Session Canvas - IntelliJ PoC</strong>
        <button type="button" onClick={() => host.postMessage({ type: 'webview/createNote' })}>
          Create Test Note
        </button>
        <span className="dsc-viewport-readout">
          x {viewport.x.toFixed(1)} | y {viewport.y.toFixed(1)} | z {viewport.zoom.toFixed(2)}
        </span>
      </div>
      <ReactFlow
        nodes={nodes}
        edges={[]}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onMove={onMove}
        fitView
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
