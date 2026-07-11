import type { FitAddon } from '@xterm/addon-fit';
import type { Terminal } from '@xterm/xterm';

import type { ExecutionNodeKind } from '../common/protocol';
import type { SerializedTerminalState } from '../common/serializedTerminalState';
import type { TerminalStreamAttachPayload, TerminalStreamEvent } from '../common/terminalSessionStream';
import type { ExecutionTerminalNativeInteractionsHandle } from './executionTerminalNativeInteractions';

export type ExecutionHostEvent =
  | {
      type: 'snapshot';
      nodeId: string;
      kind: ExecutionNodeKind;
      output: string;
      cols: number;
      rows: number;
      liveSession: boolean;
      requestId?: string;
      executionSessionId?: string;
      outputSequence?: number;
      serializedTerminalState?: SerializedTerminalState;
      terminalStream?: TerminalStreamAttachPayload;
    }
  | {
      type: 'output';
      nodeId: string;
      kind: ExecutionNodeKind;
      chunk: string;
      executionSessionId?: string;
      persisted?: boolean;
      outputSequence?: number;
      terminalAuthorityId?: string;
      terminalStartRevision?: number;
      terminalRevision?: number;
    }
  | {
      type: 'terminal-event';
      nodeId: string;
      kind: ExecutionNodeKind;
      executionSessionId: string;
      authorityId: string;
      event: TerminalStreamEvent;
    }
  | {
      type: 'exit';
      nodeId: string;
      kind: ExecutionNodeKind;
      message: string;
    };

export interface ExecutionTerminalController {
  nodeId: string;
  kind: ExecutionNodeKind;
  applySnapshot(detail: Extract<ExecutionHostEvent, { type: 'snapshot' }>): void;
  requestAttachSnapshot(): void;
  enqueueOutput(
    chunk: string,
    options?: {
      persisted?: boolean;
      outputSequence?: number;
      executionSessionId?: string;
      terminalAuthorityId?: string;
      terminalStartRevision?: number;
      terminalRevision?: number;
    }
  ): void;
  applyTerminalEvent(detail: Extract<ExecutionHostEvent, { type: 'terminal-event' }>): void;
  showExit(message: string): void;
  refreshVisibleRows(): void;
  flushPendingOutput(maxCharacters?: number): number;
  getPendingOutputLength(): number;
  getQueuedWriteCount(): number;
  isOutputDrainBlocked(): boolean;
  dispose(): void;
}

export type ExecutionTerminalContentChangeReason = 'snapshot' | 'output' | 'exit';

export interface ExecutionTerminalRegistryEntry {
  terminal: Terminal;
  fitAddon: FitAddon;
  controller: ExecutionTerminalController;
  nativeInteractions: ExecutionTerminalNativeInteractionsHandle;
}

export type ExecutionTerminalRegistry = Map<string, ExecutionTerminalRegistryEntry>;

export type MouseCoords = [number, number] | undefined;
export interface MouseReportCoords {
  col: number;
  row: number;
  x: number;
  y: number;
}
export interface XtermMouseService {
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
export interface XtermSelectionService {
  _screenElement?: HTMLElement;
  _getMouseEventScrollAmount?: (event: MouseEvent) => number;
}
export interface XtermCoreWithMouseInternals {
  _mouseService?: XtermMouseService;
  _selectionService?: XtermSelectionService;
}
