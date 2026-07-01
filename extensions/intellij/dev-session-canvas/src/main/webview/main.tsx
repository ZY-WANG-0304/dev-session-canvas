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

type DisposableLike = {
  dispose(): void;
};

type TerminalDiagnosticsStatus = {
  enabled: boolean;
  path: string;
  message: string;
};

type TerminalDiagnosticRecord = Record<string, string | number | boolean | null | undefined>;

const MAX_RECENT_OUTPUT_CHARS = 12000;
const terminalBindings = new Map<string, TerminalBinding>();
const pendingTerminalOutput = new Map<string, string>();
let terminalDiagnosticsEnabled = false;

function retainRecentOutput(value: string): string {
  return value.length <= MAX_RECENT_OUTPUT_CHARS ? value : value.slice(-MAX_RECENT_OUTPUT_CHARS);
}

function describeText(value: string): string {
  return Array.from(value)
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`;
    })
    .join(' ');
}

function sanitizeDiagnosticValue(value: string | number | boolean | null | undefined): string | number | boolean | null {
  if (value === undefined) {
    return null;
  }
  if (typeof value !== 'string' || value.length <= 160) {
    return value;
  }
  return `${value.slice(0, 160)}...`;
}

function postTerminalDiagnostic(id: string | undefined, record: TerminalDiagnosticRecord): void {
  if (!terminalDiagnosticsEnabled) {
    return;
  }
  const normalizedRecord: TerminalDiagnosticRecord = {};
  for (const [key, value] of Object.entries(record)) {
    normalizedRecord[key] = sanitizeDiagnosticValue(value);
  }
  const entry = JSON.stringify({
    time: new Date().toISOString(),
    ...normalizedRecord
  });
  host.postMessage({ type: 'webview/terminalDiagnostic', id, entry });
}

function normalizeTerminalInput(value: string): string {
  // JCEF can surface stray C1 controls or Unicode noncharacters; xterm special keys use C0/ESC.
  return Array.from(value)
    .filter((character) => !isStrayTerminalInputCodePoint(character.codePointAt(0) ?? 0))
    .join('');
}

function isStrayTerminalInputCodePoint(codePoint: number): boolean {
  return (codePoint >= 0x80 && codePoint <= 0x9f)
    || (codePoint >= 0xd800 && codePoint <= 0xdfff)
    || (codePoint >= 0xfdd0 && codePoint <= 0xfdef)
    || (codePoint & 0xfffe) === 0xfffe;
}

function isPlainKeyboardTextEvent(event: KeyboardEvent): boolean {
  return event.key.length === 1
    && !event.altKey
    && !event.ctrlKey
    && !event.metaKey
    && !event.isComposing;
}

function shouldLetKeypressHandlePlainText(event: KeyboardEvent): boolean {
  const charCode = event.key.length === 1 ? event.key.charCodeAt(0) : 0;
  return event.keyCode < 48 || (charCode >= 65 && charCode <= 90);
}

function recordTerminalKeyboardEvent(id: string, event: KeyboardEvent): void {
  postTerminalDiagnostic(id, {
    event: event.type,
    key: event.key,
    code: event.code,
    keyCode: event.keyCode,
    which: event.which,
    altKey: event.altKey,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    shiftKey: event.shiftKey,
    repeat: event.repeat,
    isComposing: event.isComposing,
    defaultPrevented: event.defaultPrevented
  });
}

function recordTerminalInputEvent(id: string, event: Event): void {
  if (event instanceof InputEvent) {
    postTerminalDiagnostic(id, {
      event: event.type,
      inputType: event.inputType,
      data: event.data,
      dataCodes: event.data ? describeText(event.data) : '',
      isComposing: event.isComposing,
      defaultPrevented: event.defaultPrevented
    });
    return;
  }
  postTerminalDiagnostic(id, { event: event.type });
}

function installTerminalDiagnosticsProbe(terminal: Terminal, id: string, isJcefHost: boolean): DisposableLike {
  const textarea = terminal.textarea;
  if (!textarea || !isJcefHost) {
    return { dispose: () => undefined };
  }

  const listeners: Array<{ target: EventTarget; type: string; listener: EventListener }> = [];
  const addListener = (target: EventTarget | null | undefined, type: string, listener: EventListener): void => {
    if (!target) {
      return;
    }
    target.addEventListener(type, listener, true);
    listeners.push({ target, type, listener });
  };

  addListener(textarea, 'keydown', (event) => recordTerminalKeyboardEvent(id, event as KeyboardEvent));
  addListener(textarea, 'keypress', (event) => recordTerminalKeyboardEvent(id, event as KeyboardEvent));
  addListener(textarea, 'keyup', (event) => recordTerminalKeyboardEvent(id, event as KeyboardEvent));
  addListener(textarea, 'beforeinput', (event) => recordTerminalInputEvent(id, event));
  addListener(textarea, 'input', (event) => recordTerminalInputEvent(id, event));
  addListener(textarea, 'compositionstart', (event) => recordTerminalInputEvent(id, event));
  addListener(textarea, 'compositionupdate', (event) => recordTerminalInputEvent(id, event));
  addListener(textarea, 'compositionend', (event) => recordTerminalInputEvent(id, event));

  return {
    dispose: (): void => {
      for (const listener of listeners) {
        listener.target.removeEventListener(listener.type, listener.listener, true);
      }
    }
  };
}

function installJcefTerminalInputGuard(terminal: Terminal, isJcefHost: boolean, id: string): DisposableLike {
  // JetBrains JCEF can deliver both xterm keydown/keypress data and textarea input for one key.
  const textarea = terminal.textarea;
  if (!textarea || !isJcefHost) {
    return { dispose: () => undefined };
  }

  const inputEventTarget = terminal.element ?? textarea.parentElement;
  let compositionActive = false;
  let compositionKeyPending = false;
  let suppressNextInsertText = false;
  let suppressNextKeypress = false;
  let trackNextKeypressInput = false;
  let resetTimer: number | undefined;

  const clearResetTimer = (): void => {
    if (resetTimer !== undefined) {
      window.clearTimeout(resetTimer);
      resetTimer = undefined;
    }
  };

  const scheduleSuppressionReset = (): void => {
    clearResetTimer();
    resetTimer = window.setTimeout(() => {
      compositionKeyPending = false;
      suppressNextInsertText = false;
      suppressNextKeypress = false;
      trackNextKeypressInput = false;
      resetTimer = undefined;
    }, 0);
  };

  const handleKeydown = (event: KeyboardEvent): void => {
    if (compositionActive) {
      postTerminalDiagnostic(id, { event: 'guard.keydown', action: 'composition-active', key: event.key, code: event.code });
      compositionKeyPending = false;
      suppressNextInsertText = false;
      suppressNextKeypress = false;
      trackNextKeypressInput = false;
      return;
    }
    if (event.keyCode === 229) {
      postTerminalDiagnostic(id, { event: 'guard.keydown', action: 'composition-key-pending', key: event.key, code: event.code });
      compositionKeyPending = true;
      suppressNextInsertText = false;
      suppressNextKeypress = false;
      trackNextKeypressInput = false;
      scheduleSuppressionReset();
      return;
    }
    if (!isPlainKeyboardTextEvent(event)) {
      postTerminalDiagnostic(id, { event: 'guard.keydown', action: 'non-plain-key', key: event.key, code: event.code });
      compositionKeyPending = false;
      suppressNextInsertText = false;
      suppressNextKeypress = false;
      trackNextKeypressInput = false;
      return;
    }
    compositionKeyPending = false;
    if (shouldLetKeypressHandlePlainText(event)) {
      postTerminalDiagnostic(id, { event: 'guard.keydown', action: 'track-keypress', key: event.key, code: event.code });
      suppressNextInsertText = false;
      suppressNextKeypress = false;
      trackNextKeypressInput = true;
      scheduleSuppressionReset();
      return;
    }
    postTerminalDiagnostic(id, { event: 'guard.keydown', action: 'suppress-keypress-and-input', key: event.key, code: event.code });
    suppressNextInsertText = true;
    suppressNextKeypress = true;
    trackNextKeypressInput = false;
    scheduleSuppressionReset();
  };

  const suppressKeypressBeforeXterm = (event: KeyboardEvent): void => {
    if (!suppressNextKeypress) {
      return;
    }
    postTerminalDiagnostic(id, { event: 'guard.keypress', action: 'suppressed-before-xterm', key: event.key, code: event.code });
    event.preventDefault();
    event.stopPropagation();
    suppressNextKeypress = false;
  };

  const trackKeypressAfterXterm = (): void => {
    if (!trackNextKeypressInput) {
      return;
    }
    postTerminalDiagnostic(id, { event: 'guard.keypress', action: 'tracked-after-xterm' });
    trackNextKeypressInput = false;
    suppressNextInsertText = true;
    scheduleSuppressionReset();
  };

  const handleBeforeInput = (event: InputEvent): void => {
    if (event.inputType !== 'insertText' || event.isComposing) {
      return;
    }
    if (compositionKeyPending) {
      return;
    }
    if (!suppressNextInsertText) {
      return;
    }
    postTerminalDiagnostic(id, {
      event: 'guard.beforeinput',
      action: 'suppressed',
      inputType: event.inputType,
      data: event.data,
      dataCodes: event.data ? describeText(event.data) : ''
    });
    event.preventDefault();
    event.stopPropagation();
    suppressNextInsertText = false;
    if (suppressNextKeypress) {
      scheduleSuppressionReset();
    } else {
      clearResetTimer();
    }
  };

  const handleInput = (event: Event): void => {
    if (!(event instanceof InputEvent) || event.inputType !== 'insertText' || event.isComposing) {
      return;
    }
    if (!compositionKeyPending && !suppressNextInsertText) {
      return;
    }
    postTerminalDiagnostic(id, {
      event: 'guard.input',
      action: 'suppressed',
      inputType: event.inputType,
      data: event.data,
      dataCodes: event.data ? describeText(event.data) : ''
    });
    event.preventDefault();
    event.stopPropagation();
    if (suppressNextInsertText && !compositionKeyPending) {
      textarea.value = '';
    }
    compositionKeyPending = false;
    suppressNextInsertText = false;
    suppressNextKeypress = false;
    trackNextKeypressInput = false;
    clearResetTimer();
  };

  const handleCompositionStart = (): void => {
    postTerminalDiagnostic(id, { event: 'guard.compositionstart', action: 'composition-active' });
    compositionActive = true;
    compositionKeyPending = false;
    suppressNextInsertText = false;
    suppressNextKeypress = false;
    trackNextKeypressInput = false;
    clearResetTimer();
  };

  const handleCompositionEnd = (): void => {
    postTerminalDiagnostic(id, { event: 'guard.compositionend', action: 'composition-finished' });
    window.setTimeout(() => {
      compositionActive = false;
    }, 0);
  };

  textarea.addEventListener('keydown', handleKeydown, true);
  textarea.addEventListener('keypress', trackKeypressAfterXterm, true);
  textarea.addEventListener('beforeinput', handleBeforeInput, true);
  textarea.addEventListener('compositionstart', handleCompositionStart, true);
  textarea.addEventListener('compositionend', handleCompositionEnd, true);
  inputEventTarget?.addEventListener('keypress', suppressKeypressBeforeXterm, true);
  inputEventTarget?.addEventListener('input', handleInput, true);

  return {
    dispose: (): void => {
      clearResetTimer();
      textarea.removeEventListener('keydown', handleKeydown, true);
      textarea.removeEventListener('keypress', trackKeypressAfterXterm, true);
      textarea.removeEventListener('beforeinput', handleBeforeInput, true);
      textarea.removeEventListener('compositionstart', handleCompositionStart, true);
      textarea.removeEventListener('compositionend', handleCompositionEnd, true);
      inputEventTarget?.removeEventListener('keypress', suppressKeypressBeforeXterm, true);
      inputEventTarget?.removeEventListener('input', handleInput, true);
    }
  };
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
  const isJcefHost = Boolean(window.devSessionCanvasPostMessage);

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
    const diagnosticsProbeDisposable = installTerminalDiagnosticsProbe(terminal, data.id, isJcefHost);
    const inputGuardDisposable = installJcefTerminalInputGuard(terminal, isJcefHost, data.id);
    const dataDisposable = terminal.onData((text) => {
      postTerminalDiagnostic(data.id, {
        event: 'xterm.onData',
        length: text.length,
        codes: describeText(text),
        text
      });
      const normalizedText = normalizeTerminalInput(text);
      if (normalizedText !== text) {
        postTerminalDiagnostic(data.id, {
          event: 'xterm.onData.normalized',
          beforeCodes: describeText(text),
          afterCodes: describeText(normalizedText),
          text: normalizedText
        });
      }
      if (normalizedText.length > 0) {
        host.postMessage({ type: 'webview/terminalInput', id: data.id, text: normalizedText });
      }
    });
    const resizeObserver = new ResizeObserver(() => fitAndReport());
    resizeObserver.observe(container);
    window.requestAnimationFrame(fitAndReport);

    return () => {
      resizeObserver.disconnect();
      dataDisposable.dispose();
      inputGuardDisposable.dispose();
      diagnosticsProbeDisposable.dispose();
      terminalBindings.delete(data.id);
      terminal.dispose();
    };
  }, [data.id, fitAndReport, isJcefHost]);

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
  const [terminalDiagnostics, setTerminalDiagnostics] = useState<TerminalDiagnosticsStatus>({
    enabled: false,
    path: '',
    message: ''
  });

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
      if (message.type === 'host/terminalDiagnosticsStatus') {
        terminalDiagnosticsEnabled = message.payload.enabled;
        setTerminalDiagnostics(message.payload);
      }
    });
    host.postMessage({ type: 'webview/ready' });
    return dispose;
  }, [reactFlow, setNodes]);

  useEffect(() => {
    document.documentElement.dataset.dscViewport = `${viewport.x.toFixed(1)},${viewport.y.toFixed(1)},${viewport.zoom.toFixed(3)}`;
    document.documentElement.dataset.dscNodeCount = String(nodes.length);
    document.documentElement.dataset.dscTerminalCount = String(nodes.filter((node) => node.data.type === 'terminal').length);
    document.documentElement.dataset.dscTerminalDiagnostics = terminalDiagnostics.enabled ? terminalDiagnostics.path : 'disabled';
  }, [nodes, terminalDiagnostics, viewport]);

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

  const toggleTerminalDiagnostics = useCallback((): void => {
    host.postMessage({ type: 'webview/setTerminalDiagnostics', enabled: !terminalDiagnostics.enabled });
  }, [terminalDiagnostics.enabled]);

  const terminalDiagnosticsReadout = terminalDiagnostics.path
    ? `${terminalDiagnostics.enabled ? 'diagnostics' : 'last diagnostics'}: ${terminalDiagnostics.path}`
    : terminalDiagnostics.message;

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
        <button type="button" onClick={toggleTerminalDiagnostics}>
          {terminalDiagnostics.enabled ? 'Stop Terminal Diagnostics' : 'Record Terminal Diagnostics'}
        </button>
        <span className="dsc-viewport-readout">
          x {viewport.x.toFixed(1)} | y {viewport.y.toFixed(1)} | z {viewport.zoom.toFixed(2)}
        </span>
        <span className="dsc-diagnostics-readout" title={terminalDiagnostics.path || terminalDiagnostics.message}>
          {terminalDiagnosticsReadout}
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
