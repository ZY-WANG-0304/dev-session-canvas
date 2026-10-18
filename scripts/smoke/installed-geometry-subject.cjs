const assert = require('node:assert/strict');
const fs = require('node:fs');
const readline = require('node:readline');
const { WriteStream } = require('node:tty');

// getWindowSize() on process.stdout returns Node's cached columns/rows. A
// fresh public TTY handle queries this same process's original OS descriptor.
// Do not close it: on Unix that would also close stdout's shared descriptor.
function currentTTYGeometry() {
  const current = new WriteStream(1);
  current.unref();
  assert(Number.isSafeInteger(current.columns) && current.columns > 0
    && Number.isSafeInteger(current.rows) && current.rows > 0, 'Original stdout has no observable OS geometry');
  return { cols: current.columns, rows: current.rows };
}

function observeGeometry(nonce) {
  assert(nonce === 'startup' || /^[a-f0-9]{32}$/u.test(nonce), 'Unknown geometry observation request');
  return { pid: process.pid, ppid: process.ppid, nonce, observedAt: Date.now(),
    ...currentTTYGeometry(), cached: { cols: process.stdout.columns, rows: process.stdout.rows },
    method: 'original-stdout-fresh-tty-handle' };
}

function run(target) {
  assert(target, 'A private geometry output path is required');
  const publish = nonce => {
    const pending = `${target}.${process.pid}.pending`;
    fs.writeFileSync(pending, JSON.stringify(observeGeometry(nonce)));
    fs.renameSync(pending, target);
  };
  publish('startup');
  readline.createInterface({ input: process.stdin }).on('line', line => {
    assert(/^geometry:[a-f0-9]{32}$/u.test(line), 'Unknown installed geometry command');
    publish(line.slice('geometry:'.length));
  });
}

module.exports = { currentTTYGeometry, observeGeometry };
if (require.main === module) run(process.argv[2]);
