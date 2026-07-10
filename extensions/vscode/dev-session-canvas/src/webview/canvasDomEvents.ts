import type * as React from 'react';

export function stopCanvasEvent(event: { stopPropagation: () => void }): void {
  event.stopPropagation();
}

export function isImeComposingKeyboardEvent(event: React.KeyboardEvent<HTMLElement>): boolean {
  const nativeEvent = event.nativeEvent as KeyboardEvent & {
    isComposing?: boolean;
    keyCode?: number;
  };

  return nativeEvent.isComposing === true || nativeEvent.keyCode === 229;
}
