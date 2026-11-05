import { useEffect, useRef } from 'react';
import { useReactFlow, useStore, type ReactFlowState, type Viewport } from 'reactflow';

const selectFlowElement = (state: ReactFlowState): HTMLDivElement | null => state.domNode;

export function CanvasFocusNavigation(props: { onViewportCommit: (viewport: Viewport) => void }): null {
  const flowElement = useStore(selectFlowElement);
  const { getViewport, setViewport } = useReactFlow();
  const onViewportCommitRef = useRef(props.onViewportCommit);

  useEffect(() => {
    onViewportCommitRef.current = props.onViewportCommit;
  }, [props.onViewportCommit]);

  useEffect(() => {
    if (!flowElement) {
      return;
    }

    let pendingFrame: number | undefined;
    const handleFocus = (event: FocusEvent): void => {
      window.cancelAnimationFrame(pendingFrame ?? 0);
      const target = event.target;
      if (!(target instanceof Element) || target.closest('.react-flow') !== flowElement ||
        !target.closest('.react-flow__viewport, .canvas-group-layer') ||
        target.closest('[aria-hidden="true"], [inert]')) {
        return;
      }

      pendingFrame = window.requestAnimationFrame(() => {
        pendingFrame = undefined;
        if (!target.isConnected || document.activeElement !== target) {
          return;
        }

        const bounds = target.getBoundingClientRect();
        const visible = flowElement.getBoundingClientRect();
        if (bounds.width <= 0 || bounds.height <= 0 || visible.width <= 0 || visible.height <= 0) {
          return;
        }

        const deltaX = revealDelta(bounds.left, bounds.right, visible.left, visible.right);
        const deltaY = revealDelta(bounds.top, bounds.bottom, visible.top, visible.bottom);
        if (deltaX === 0 && deltaY === 0) {
          return;
        }

        const viewport = getViewport();
        const nextViewport = { ...viewport, x: viewport.x + deltaX, y: viewport.y + deltaY };
        setViewport(nextViewport);
        onViewportCommitRef.current(nextViewport);
      });
    };

    flowElement.addEventListener('focusin', handleFocus);
    return () => {
      window.cancelAnimationFrame(pendingFrame ?? 0);
      flowElement.removeEventListener('focusin', handleFocus);
    };
  }, [flowElement, getViewport, setViewport]);

  return null;
}

function revealDelta(start: number, end: number, visibleStart: number, visibleEnd: number): number {
  if ((start >= visibleStart && end <= visibleEnd) || (start <= visibleStart && end >= visibleEnd)) {
    return 0;
  }

  const margin = Math.min(12, (visibleEnd - visibleStart) / 4);
  const alignStart = visibleStart + margin - start;
  const alignEnd = visibleEnd - margin - end;
  return Math.abs(alignStart) < Math.abs(alignEnd) ? alignStart : alignEnd;
}
