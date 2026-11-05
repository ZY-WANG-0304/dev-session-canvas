export interface TerminalFitDimensions {
  cols: number;
  rows: number;
}

export interface TerminalFitTarget extends TerminalFitDimensions {}

export interface TerminalFitAddon {
  proposeDimensions(): TerminalFitDimensions | undefined;
  fit(): void;
}

export function fitTerminalWithCorrection(
  terminal: TerminalFitTarget,
  fitAddon: TerminalFitAddon,
  shouldDefer: (dimensions: TerminalFitDimensions) => boolean
): boolean {
  const initialProposal = fitAddon.proposeDimensions();
  if (!initialProposal) return false;
  if (shouldDefer(initialProposal)) return true;
  if (terminal.cols !== initialProposal.cols || terminal.rows !== initialProposal.rows) fitAddon.fit();

  const correctedProposal = fitAddon.proposeDimensions();
  if (!correctedProposal || shouldDefer(correctedProposal)) return true;
  if (terminal.cols !== correctedProposal.cols || terminal.rows !== correctedProposal.rows) fitAddon.fit();
  return true;
}
