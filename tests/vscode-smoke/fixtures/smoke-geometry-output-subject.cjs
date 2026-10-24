const fs = require('node:fs');
const tty = require('node:tty');
const readline = require('node:readline');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');

// This program observes its original OS TTY and writes independent output
// receipts. Neither the Host nor the test injects geometry or output into it.
const [target, nonce] = process.argv.slice(2);
assert(target && /^[a-f0-9]{32}$/.test(nonce));
const state = { nonce, pid: process.pid, startedAt: Date.now(), geometry: [], output: null, running: false };
function publish() {
  const pending = `${target}.${process.pid}.pending`;
  fs.writeFileSync(pending, JSON.stringify(state)); fs.renameSync(pending, target);
}
function geometry(request) {
  const handle = new tty.WriteStream(1); handle.unref();
  assert(handle.columns > 0 && handle.rows > 0);
  state.geometry.push({ request, cols: handle.columns, rows: handle.rows,
    observedAt: Date.now(), method: 'original-stdout-fresh-tty-handle' });
  publish();
}
let timer;
function output(count, phase) {
  assert(!state.running && Number.isSafeInteger(count) && count > 0 && count <= 2000);
  let index = 0; const lines = []; state.running = true; publish();
  const emit = () => {
    for (let burst = 0; burst < (phase === 'load' ? 5 : 40) && index < count; burst++) {
      const text = `DSC_${nonce}_${phase}_${String(++index).padStart(5, '0')}`;
      lines.push(text); process.stdout.write(text + '\r\n');
    }
    if (index < count) { timer = setTimeout(emit, 25); return; }
    state.running = false;
    state.output = { phase, count, sha256: crypto.createHash('sha256').update(lines.join('\n')).digest('hex'), completedAt: Date.now() };
    publish();
  };
  emit();
}
geometry('startup');
readline.createInterface({ input: process.stdin }).on('line', line => {
  if (/^geometry:[a-f0-9]{32}$/.test(line)) geometry(line.slice(9));
  else if (/^output:(?:[1-9][0-9]{0,3}):(?:load|full)$/.test(line)) {
    const [, count, phase] = line.split(':'); output(Number(count), phase);
  } else if (line === 'exit') { assert(!state.running); clearTimeout(timer); process.exit(0); }
  else throw new Error(`Unknown subject command: ${line}`);
});
