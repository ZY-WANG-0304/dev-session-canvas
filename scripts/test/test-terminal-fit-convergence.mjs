import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';

import esbuild from 'esbuild';

const require = createRequire(import.meta.url);
const { outputFiles } = await esbuild.build({
  entryPoints: [path.resolve('extensions/vscode/dev-session-canvas/src/webview/terminalFitConvergence.ts')],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node22',
  write: false
});
const module = { exports: {} };
new Function('require', 'module', 'exports', outputFiles[0].text)(require, module, module.exports);
const { fitTerminalWithCorrection } = module.exports;

function controlledFit(proposals, appliedDimensions = [...proposals]) {
  const terminal = { cols: 80, rows: 24 };
  const fitCalls = [];
  const seenProposals = [];
  const fitAddon = {
    proposeDimensions() {
      const proposal = proposals.shift();
      if (proposal) seenProposals.push(proposal);
      return proposal;
    },
    fit() {
      const dimensions = appliedDimensions[fitCalls.length];
      fitCalls.push(dimensions);
      if (dimensions) Object.assign(terminal, dimensions);
    }
  };
  return { terminal, fitAddon, fitCalls, seenProposals };
}

{
  const fixture = controlledFit([{ cols: 84, rows: 28 }, { cols: 85, rows: 28 }]);
  const guards = [];
  assert.equal(fitTerminalWithCorrection(fixture.terminal, fixture.fitAddon, dimensions => {
    guards.push(dimensions);
    return false;
  }), true);
  assert.deepEqual(fixture.fitCalls, [{ cols: 84, rows: 28 }, { cols: 85, rows: 28 }]);
  assert.deepEqual(fixture.terminal, { cols: 85, rows: 28 });
  assert.equal(guards.length, 2, 'the restore/shrink guard checks both proposals');
}

{
  const fixture = controlledFit([{ cols: 85, rows: 29 }, { cols: 84, rows: 28 }]);
  const guards = [];
  fitTerminalWithCorrection(fixture.terminal, fixture.fitAddon, dimensions => {
    guards.push(dimensions);
    return dimensions.cols < fixture.terminal.cols || dimensions.rows < fixture.terminal.rows;
  });
  assert.equal(fixture.fitCalls.length, 1, 'a deferred shrink is not applied as a correction');
  assert.deepEqual(fixture.terminal, { cols: 85, rows: 29 });
  assert.deepEqual(guards, [{ cols: 85, rows: 29 }, { cols: 84, rows: 28 }]);
}

{
  const fixture = controlledFit([{ cols: 90, rows: 40 }, { cols: 91, rows: 41 }, { cols: 92, rows: 42 }]);
  fitTerminalWithCorrection(fixture.terminal, fixture.fitAddon, () => false);
  assert.equal(fixture.fitCalls.length, 2, 'a single invocation has a hard two-fit limit');
  assert.equal(fixture.seenProposals.length, 2, 'a single invocation does not chase unstable metrics');
  assert.deepEqual(fixture.terminal, { cols: 91, rows: 41 });
}

{
  const fixture = controlledFit([]);
  assert.equal(fitTerminalWithCorrection(fixture.terminal, fixture.fitAddon, () => false), false);
  assert.equal(fixture.fitCalls.length, 0);
}

{
  const fixture = controlledFit([{ cols: 79, rows: 23 }]);
  assert.equal(fitTerminalWithCorrection(fixture.terminal, fixture.fitAddon, () => true), true);
  assert.equal(fixture.fitCalls.length, 0, 'an initial deferred shrink is not applied');
  assert.equal(fixture.seenProposals.length, 1);
  assert.deepEqual(fixture.terminal, { cols: 80, rows: 24 });
}

{
  const fixture = controlledFit([{ cols: 80, rows: 24 }, { cols: 80, rows: 24 }]);
  assert.equal(fitTerminalWithCorrection(fixture.terminal, fixture.fitAddon, () => false), true);
  assert.equal(fixture.fitCalls.length, 0, 'stable dimensions do not resize the terminal');
}

{
  const fixture = controlledFit([{ cols: 84, rows: 28 }]);
  assert.equal(fitTerminalWithCorrection(fixture.terminal, fixture.fitAddon, () => false), true);
  assert.deepEqual(fixture.terminal, { cols: 84, rows: 28 });
  assert.equal(fixture.fitCalls.length, 1, 'a missing correction retains the applied dimensions');
}

console.log('Terminal fit convergence tests passed (7 controlled cases; maximum two fit calls).');
