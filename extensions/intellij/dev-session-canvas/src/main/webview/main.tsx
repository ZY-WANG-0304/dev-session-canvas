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

type HostNode = {
  id: string;
  title: string;
  body: string;
  x: number;
  y: number;
};

type HostMessage = {
  type: 'host/bootstrap' | 'host/stateUpdated';
  payload: {
    nodes: HostNode[];
  };
};

type WebviewMessage =
  | { type: 'webview/ready' }
  | { type: 'webview/createTestNote' };

declare global {
  interface Window {
    devSessionCanvasPostMessage?: (message: WebviewMessage) => void;
    devSessionCanvasReceiveHostMessage?: (message: HostMessage) => void;
  }
}

function postMessage(message: WebviewMessage): void {
  window.devSessionCanvasPostMessage?.(message);
}

function toFlowNode(node: HostNode): Node<HostNode> {
  return {
    id: node.id,
    type: 'note',
    position: { x: node.x, y: node.y },
    data: node
  };
}

function NoteNode({ data }: NodeProps<HostNode>): JSX.Element {
  return (
    <div className="dsc-note-node" data-dsc-note-id={data.id}>
      <strong>{data.title}</strong>
      <p>{data.body}</p>
    </div>
  );
}

function CanvasApp(): JSX.Element {
  const [nodes, setNodes, onNodesChange] = useNodesState<HostNode>([]);
  const [viewport, setViewport] = useState({ x: 0, y: 0, zoom: 1 });

  const nodeTypes = useMemo(() => ({ note: NoteNode }), []);

  useEffect(() => {
    window.devSessionCanvasReceiveHostMessage = (message: HostMessage): void => {
      if (message.type === 'host/bootstrap' || message.type === 'host/stateUpdated') {
        setNodes(message.payload.nodes.map(toFlowNode));
      }
    };
    postMessage({ type: 'webview/ready' });
    return () => {
      delete window.devSessionCanvasReceiveHostMessage;
    };
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
        <button type="button" onClick={() => postMessage({ type: 'webview/createTestNote' })}>
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
