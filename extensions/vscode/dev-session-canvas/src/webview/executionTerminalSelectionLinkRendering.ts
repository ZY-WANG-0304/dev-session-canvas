import type { ILink, ILinkDecorations, Terminal } from '@xterm/xterm';

interface SelectionRenderCore {
  _renderService?: {
    handleSelectionChanged(...args: unknown[]): void;
  };
  linkifier?: {
    currentLink?: {
      link: ILink;
      state?: { isHovered: boolean; decorations: ILinkDecorations };
    };
  };
}

// Install after open: xterm's DOM selection draw bypasses the viewport render
// event that normally revalidates links, and replaces their underlined spans.
export function preserveExecutionLinkOnSelectionRedraw(terminal: Terminal): () => void {
  const core = (terminal as unknown as { _core?: SelectionRenderCore })._core;
  const renderService = core?._renderService;
  if (!renderService) return () => {};

  const original = renderService.handleSelectionChanged;
  const handleSelectionChanged = function (this: typeof renderService, ...args: unknown[]): void {
    original.apply(this, args);
    const current = core.linkifier?.currentLink;
    if (!current?.state?.isHovered || !current.state.decorations.underline || !current.link.decorations) return;

    // Use the current link's existing decoration setter; this redraws the same
    // range without invoking hover, opening a link, or changing its priority.
    current.link.decorations.underline = false;
    current.link.decorations.underline = true;
  };
  renderService.handleSelectionChanged = handleSelectionChanged;
  return () => {
    if (renderService.handleSelectionChanged === handleSelectionChanged) {
      renderService.handleSelectionChanged = original;
    }
  };
}
