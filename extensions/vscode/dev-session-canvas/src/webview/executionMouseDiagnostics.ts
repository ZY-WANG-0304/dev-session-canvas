import type { Terminal } from '@xterm/xterm';
import type { MouseReportCoords } from './executionTerminalTypes';

let nextTraceId = 1;

// Opt-in from the webview DevTools; never collect keyboard input or element text.
export function createExecutionMouseDiagnostics(
  terminal: Terminal,
  report: (detail: Record<string, unknown>) => void
) {
  const traceId = `${Date.now()}-${nextTraceId++}`;
  let sequence = 0;
  let active: { eventId: number; inputCount: number } | undefined;
  let remaining = 512;
  let disposed = false;
  const enabled = (): boolean => {
    try { return !disposed && localStorage.getItem('devSessionCanvas.mouseDiagnostics') === '1'; }
    catch { return false; }
  };
  const emit = (detail: Record<string, unknown>): void => {
    if (!enabled() || remaining <= 0) return;
    remaining--;
    try { report({ traceId, webviewEpochMs: Date.now(), ...detail }); }
    catch { /* Diagnostic delivery must not affect input. */ }
  };
  return {
    observe(event: MouseEvent, element: HTMLElement, adjusted: Pick<MouseEvent, 'clientX' | 'clientY'>,
      coords: MouseReportCoords | undefined, zoom: number): void {
      if (!enabled()) return;
      const rect = element.getBoundingClientRect();
      const target = event.target instanceof Element ? event.target : undefined;
      const observation = { eventId: ++sequence, inputCount: 0 };
      active = observation;
      emit({ phase: 'mouse-coordinates', eventId: observation.eventId,
        eventType: event.type, eventTimestamp: event.timeStamp, isTrusted: event.isTrusted,
        buttons: event.buttons, button: event.button,
        targetTag: target?.tagName, targetClasses: target?.className.toString().slice(0, 160),
        targetInsideTerminal: Boolean(target && terminal.element?.contains(target)),
        clientX: event.clientX, clientY: event.clientY,
        adjustedX: adjusted.clientX, adjustedY: adjusted.clientY, zoom,
        rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
        insideScreen: event.clientX >= rect.left && event.clientX < rect.right &&
          event.clientY >= rect.top && event.clientY < rect.bottom,
        cols: terminal.cols, rows: terminal.rows, coords, mouseTrackingMode: terminal.modes.mouseTrackingMode });
      // xterm generates its report synchronously after coordinate conversion.
      // Do not associate a later task with the last mouse event.
      queueMicrotask(() => { if (active === observation) active = undefined; });
    },
    input(input: string, sequence?: number): void {
      if (!enabled() || !/^\x1b\[<\d+;\d+;\d+[Mm]$/.test(input)) return;
      emit({ phase: 'terminal-onData', sequence, eventId: active?.eventId ?? null,
        correlation: active ? 'same-task-coordinate-conversion' : 'unmatched',
        inputIndex: active ? ++active.inputCount : undefined, protocol: input });
    },
    dispose(): void { disposed = true; active = undefined; }
  };
}
