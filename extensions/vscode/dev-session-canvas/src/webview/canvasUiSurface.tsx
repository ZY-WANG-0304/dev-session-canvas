import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

import type { CanvasNodeData, CanvasNodeResizeDirection } from './canvasTypes';
import { isImeComposingKeyboardEvent, stopCanvasEvent } from './canvasDomEvents';

export const CanvasOverviewInteractionContext = React.createContext(false);
const overviewInertAttributes = { inert: '' } as unknown as React.HTMLAttributes<HTMLElement>;

export function useCanvasOverviewInteractionsDisabled(): boolean {
  return React.useContext(CanvasOverviewInteractionContext);
}

export function canvasOverviewInertProps(disabled: boolean): React.HTMLAttributes<HTMLElement> {
  return disabled ? overviewInertAttributes : {};
}

export function CanvasNodeInteractionBoundary(props: {
  nodeId: string;
  disabled: boolean;
  onModifierSelectNode: (nodeId: string) => void;
  children: JSX.Element;
}): JSX.Element {
  const handlePointerDownCapture = (event: React.PointerEvent): void => {
    if (event.button !== 0 || isModifierSelectionInteractiveTarget(event.target)) {
      return;
    }
    if (!event.ctrlKey && !event.metaKey) {
      return;
    }

    event.preventDefault();
    stopCanvasEvent(event);
    props.onModifierSelectNode(props.nodeId);
  };

  return (
    <CanvasOverviewInteractionContext.Provider value={props.disabled}>
      {React.cloneElement(props.children, {
        onPointerDownCapture: composeReactEventHandlers(
          props.children.props.onPointerDownCapture,
          handlePointerDownCapture
        )
      })}
    </CanvasOverviewInteractionContext.Provider>
  );
}

function composeReactEventHandlers<E extends React.SyntheticEvent>(
  first: ((event: E) => void) | undefined,
  second: (event: E) => void
): (event: E) => void {
  return (event) => {
    first?.(event);
    if (!event.isPropagationStopped()) {
      second(event);
    }
  };
}

export function canvasNodeResizeCursorForDirection(direction: CanvasNodeResizeDirection): string {
  switch (direction) {
    case 'top':
    case 'bottom':
      return 'ns-resize';
    case 'left':
    case 'right':
      return 'ew-resize';
    case 'top-left':
    case 'bottom-right':
      return 'nwse-resize';
    case 'top-right':
    case 'bottom-left':
      return 'nesw-resize';
    default:
      return 'default';
  }
}

export function ChromeTitleEditor(props: {
  value: string;
  placeholder: string;
  contextLabel?: string;
  contextTooltip?: string;
  subtitle?: string;
  subtitleTooltip?: string;
  subtitleAccessory?: React.ReactNode;
  className?: string;
  tooltip?: string;
  readOnly?: boolean;
  onSelectNode?: () => void;
  onSubmit?: (title: string) => void;
}): JSX.Element {
  const overviewInteractionsDisabled = useCanvasOverviewInteractionsDisabled();
  const [draft, setDraft] = useState(props.value);
  const [isEditing, setIsEditing] = useState(false);
  const [isComposing, setIsComposing] = useState(false);
  const committedTitleRef = useRef(props.value);
  const pendingTitleRef = useRef<string | null>(null);
  const lastPropValueRef = useRef(props.value);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useLayoutEffect(() => {
    const previousPropValue = lastPropValueRef.current;
    lastPropValueRef.current = props.value;

    if (pendingTitleRef.current === props.value) {
      pendingTitleRef.current = null;
    } else if (pendingTitleRef.current && props.value !== previousPropValue) {
      pendingTitleRef.current = null;
    }

    committedTitleRef.current = pendingTitleRef.current ?? props.value;
    if (!isEditing) {
      setDraft(pendingTitleRef.current ?? props.value);
    }
  }, [isEditing, props.value]);

  useEffect(() => {
    if (!overviewInteractionsDisabled) {
      return;
    }

    setIsEditing(false);
    if (document.activeElement === inputRef.current) {
      inputRef.current?.blur();
    }
  }, [overviewInteractionsDisabled]);

  const overflowTitle = useOverflowAwareElementTitle(inputRef, draft, props.tooltip);
  const titleReadOnly = props.readOnly === true;
  const editingDisabled = overviewInteractionsDisabled || titleReadOnly;

  const commitTitle = (rawValue: string): void => {
    const baselineTitle = committedTitleRef.current;
    if (titleReadOnly) {
      setDraft(baselineTitle);
      return;
    }

    const nextTitle = rawValue.trim() || baselineTitle;
    setDraft(nextTitle);
    if (props.onSubmit && nextTitle !== baselineTitle) {
      pendingTitleRef.current = nextTitle;
      committedTitleRef.current = nextTitle;
      props.onSubmit(nextTitle);
    }
  };

  return (
    <div className={`window-title ${props.className ?? ''}`.trim()}>
      <div className="window-title-copy">
        {props.contextLabel ? (
          <div className="window-title-context-row">
            <OverflowAwareText
              className="window-title-context"
              text={props.contextLabel}
              tooltipText={props.contextTooltip}
            />
          </div>
        ) : null}
        <input
          ref={inputRef}
          className="window-title-input nodrag nopan"
          data-node-interactive="true"
          data-probe-field="title"
          value={draft}
          title={overflowTitle ?? props.tooltip}
          readOnly={editingDisabled}
          tabIndex={overviewInteractionsDisabled ? -1 : undefined}
          onFocus={() => {
            if (overviewInteractionsDisabled) {
              setIsEditing(false);
              inputRef.current?.blur();
              return;
            }
            props.onSelectNode?.();
            if (titleReadOnly) {
              setIsEditing(false);
              return;
            }
            setIsEditing(true);
          }}
          onMouseDown={stopCanvasEvent}
          onClick={stopCanvasEvent}
          onCompositionStart={() => {
            if (!editingDisabled) {
              setIsComposing(true);
            }
          }}
          onCompositionEnd={(event) => {
            setIsComposing(false);
            if (!editingDisabled) {
              setDraft(event.currentTarget.value);
            }
          }}
          onChange={(event) => {
            if (!editingDisabled) {
              setDraft(event.target.value);
            }
          }}
          onBlur={(event) => {
            setIsComposing(false);
            setIsEditing(false);
            commitTitle(event.currentTarget.value);
          }}
          onKeyDown={(event) => {
            if (titleReadOnly) {
              if (shouldHandleReadonlySelectAllShortcut(event)) {
                event.preventDefault();
                stopCanvasEvent(event);
                event.currentTarget.select();
                return;
              }
              if (shouldAllowReadonlyTextShortcutToBubble(event)) {
                return;
              }
              stopCanvasEvent(event);
              if (event.key === 'Escape') {
                event.preventDefault();
                event.currentTarget.blur();
              }
              return;
            }
            handleEditableFieldKeyDown(event, () => commitTitle(event.currentTarget.value), {
              isComposing
            });
          }}
          placeholder={props.placeholder}
        />
        {props.subtitle || props.subtitleAccessory ? (
          <div className="window-title-subtitle-row">
            {props.subtitle ? (
              <OverflowAwareText
                className="window-title-subtitle"
                text={props.subtitle}
                tooltipText={props.subtitleTooltip}
              />
            ) : null}
            {props.subtitleAccessory}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function OverflowAwareText(props: { className: string; text: string; tooltipText?: string }): JSX.Element {
  const textRef = useRef<HTMLSpanElement | null>(null);
  const title = useOverflowAwareElementTitle(textRef, props.text, props.tooltipText);

  return (
    <span ref={textRef} className={props.className} title={title}>
      {props.text}
    </span>
  );
}

export function useOverflowAwareElementTitle<TElement extends HTMLElement>(
  elementRef: React.RefObject<TElement>,
  text: string,
  tooltipText?: string
): string | undefined {
  const [title, setTitle] = useState<string | undefined>(undefined);

  useLayoutEffect(() => {
    const element = elementRef.current;
    if (!element) {
      setTitle(undefined);
      return;
    }

    let frameId: number | undefined;
    const updateTitle = (): void => {
      const nextTitle = isElementVisuallyOverflowing(element) ? tooltipText ?? text : undefined;
      setTitle((currentTitle) => (currentTitle === nextTitle ? currentTitle : nextTitle));
    };
    const scheduleUpdate = (): void => {
      if (frameId !== undefined) {
        cancelAnimationFrame(frameId);
      }
      frameId = window.requestAnimationFrame(() => {
        frameId = undefined;
        updateTitle();
      });
    };

    updateTitle();
    const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(scheduleUpdate) : undefined;
    resizeObserver?.observe(element);
    if (element.parentElement) {
      resizeObserver?.observe(element.parentElement);
    }
    window.addEventListener('resize', scheduleUpdate);

    return () => {
      if (frameId !== undefined) {
        cancelAnimationFrame(frameId);
      }
      resizeObserver?.disconnect();
      window.removeEventListener('resize', scheduleUpdate);
    };
  }, [elementRef, text, tooltipText]);

  return title;
}

function isElementVisuallyOverflowing(element: HTMLElement): boolean {
  return element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1;
}

export function positionsEqual(
  left: { x: number; y: number } | undefined,
  right: { x: number; y: number } | undefined
): boolean {
  return left?.x === right?.x && left?.y === right?.y;
}

export function footprintsEqual(
  left: { width: number; height: number } | undefined,
  right: { width: number; height: number } | undefined
): boolean {
  return left?.width === right?.width && left?.height === right?.height;
}

export function handleEditableFieldKeyDown(
  event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  submit: () => void,
  options?: {
    isComposing?: boolean;
  }
): void {
  if (shouldHandleEditableSelectAllShortcut(event)) {
    event.preventDefault();
    stopCanvasEvent(event);
    event.currentTarget.select();
    return;
  }

  if (shouldAllowTextEditingShortcutToBubble(event)) {
    return;
  }

  stopCanvasEvent(event);

  if (options?.isComposing || isImeComposingKeyboardEvent(event)) {
    return;
  }

  if (event.currentTarget instanceof HTMLInputElement && event.key === 'Enter') {
    event.preventDefault();
    submit();
    event.currentTarget.blur();
    return;
  }

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

export function shouldAllowTextEditingShortcutToBubble(
  event: Pick<React.KeyboardEvent<HTMLElement>, 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'key'>
): boolean {
  if (event.altKey || (!event.metaKey && !event.ctrlKey)) {
    return false;
  }

  const normalizedKey = event.key.toLowerCase();
  if (normalizedKey === 'c' || normalizedKey === 'x' || normalizedKey === 'v') {
    return true;
  }

  if (normalizedKey === 'z') {
    return true;
  }

  return normalizedKey === 'y' && !event.shiftKey;
}

export function shouldAllowReadonlyTextShortcutToBubble(
  event: Pick<React.KeyboardEvent<HTMLElement>, 'altKey' | 'ctrlKey' | 'metaKey' | 'key'>
): boolean {
  if (event.altKey || (!event.metaKey && !event.ctrlKey)) {
    return false;
  }

  const normalizedKey = event.key.toLowerCase();
  return normalizedKey === 'c';
}

export function shouldHandleEditableSelectAllShortcut(
  event: Pick<React.KeyboardEvent<HTMLElement>, 'altKey' | 'ctrlKey' | 'metaKey' | 'key'>
): boolean {
  if (event.altKey || (!event.metaKey && !event.ctrlKey)) {
    return false;
  }

  return event.key.toLowerCase() === 'a';
}

export function shouldHandleReadonlySelectAllShortcut(
  event: Pick<React.KeyboardEvent<HTMLElement>, 'altKey' | 'ctrlKey' | 'metaKey' | 'key'>
): boolean {
  if (event.altKey || (!event.metaKey && !event.ctrlKey)) {
    return false;
  }

  return event.key.toLowerCase() === 'a';
}

export function selectReadonlyTextContents(container: HTMLElement): void {
  const selection = window.getSelection();
  if (!selection) {
    return;
  }

  const selectionTarget =
    container.querySelector<HTMLElement>('.note-markdown-preview-copy, .note-markdown-preview-placeholder') ??
    container;
  const range = document.createRange();
  range.selectNodeContents(selectionTarget);
  selection.removeAllRanges();
  selection.addRange(range);
}

export function isInteractiveTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    Boolean(target.closest('[data-node-interactive="true"], .react-flow__resize-control, [data-node-resize-direction]'))
  );
}

function isModifierSelectionInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return Boolean(
    target.closest(
      'input, textarea, select, button, a, [contenteditable="true"], .react-flow__resize-control, [data-node-resize-direction]'
    )
  ) || Boolean(
    target.closest('[data-node-interactive="true"]') && !target.closest('.note-markdown-preview')
  );
}

export function isGroupModifierSelectionBlockedTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(
    target.closest('button, a, [contenteditable="true"], .canvas-group-resize-control, .canvas-group-toolbar')
  );
}

export function shouldDeleteSelectedNodeFromKeyboard(event: KeyboardEvent): boolean {
  if (
    event.defaultPrevented ||
    event.isComposing ||
    event.repeat ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey ||
    (event.key !== 'Delete' && event.key !== 'Backspace')
  ) {
    return false;
  }

  return !isDeleteShortcutBlockedTarget(event.target);
}

export function isDeleteShortcutBlockedTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const selectedFileNodeAction = target.closest<HTMLElement>('.file-node-action');
  if (
    selectedFileNodeAction &&
    selectedFileNodeAction.closest('[data-node-kind="file"][data-node-selected="true"]')
  ) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  return Boolean(
    target.closest('input, textarea, select, button, a, [contenteditable="true"], [data-node-interactive="true"]')
  );
}

export function handleNodeChromeDoubleClick(
  event: React.MouseEvent<HTMLElement>,
  nodeId: string,
  data: CanvasNodeData
): void {
  if (isNodeChromeFocusBlockedTarget(event.target)) {
    return;
  }

  stopCanvasEvent(event);
  data.onSelectNode?.(nodeId);
  data.onFocusNodeInViewport?.(nodeId);
}

function isNodeChromeFocusBlockedTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && isDeleteShortcutBlockedTarget(target);
}

export function handleGroupChromeDoubleClick(
  event: React.MouseEvent<HTMLElement>,
  groupId: string,
  onFocusGroupInViewport: (groupId: string) => void
): void {
  if (isGroupChromeFocusBlockedTarget(event.target)) {
    return;
  }

  event.preventDefault();
  stopCanvasEvent(event);
  onFocusGroupInViewport(groupId);
}

export function isGroupChromeFocusBlockedTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return Boolean(
    target.closest(
      [
        'input',
        'textarea',
        'select',
        'button',
        'a',
        '[contenteditable="true"]',
        '[data-node-interactive="true"]',
        '.canvas-group-resize-control',
        '.canvas-group-toolbar'
      ].join(', ')
    )
  );
}
