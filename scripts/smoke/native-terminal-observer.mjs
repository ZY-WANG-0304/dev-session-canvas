import assert from 'node:assert/strict';
import xterm from '@xterm/headless';

// Native smoke observes terminal cells. OSC titles, cursor controls and
// wrapped command echoes cannot stand in for a separate visible output line.
export class NativeTerminalObserver {
  constructor(cols = 80, rows = 24) {
    this.terminal = new xterm.Terminal({ cols, rows, scrollback: 1000, allowProposedApi: true });
    this.lastSequence = 0;
  }
  async consume(batches) {
    for (const batch of batches) {
      assert(Number.isSafeInteger(batch.sequence) && batch.sequence === this.lastSequence + 1,
        'Native observer requires the original ordered output batches');
      await new Promise(resolve => this.terminal.write(batch.text, resolve));
      this.lastSequence = batch.sequence;
    }
  }
  flushFinal(seal) {
    assert.equal(this.lastSequence, seal.lastDataSequence, 'Final native parser must include all sealed output');
    return this.lastSequence;
  }
  resize(cols, rows) { this.terminal.resize(cols, rows); }
  lines() {
    const buffer = this.terminal.buffer.active, lines = [];
    for (let index = 0; index < buffer.length; index++) {
      const line = buffer.getLine(index);
      const text = line.translateToString(!buffer.getLine(index + 1)?.isWrapped);
      if (line.isWrapped && lines.length) lines[lines.length - 1] += text;
      else lines.push(text);
    }
    return lines;
  }
  hasExactLine(text) { return this.lines().some(line => line.trim() === text); }
  snapshot() {
    const buffer = this.terminal.buffer.active;
    return { cols: this.terminal.cols, rows: this.terminal.rows, sequence: this.lastSequence,
      cursorX: buffer.cursorX, cursorY: buffer.cursorY, lines: this.lines() };
  }
  dispose() { this.terminal.dispose(); }
}
