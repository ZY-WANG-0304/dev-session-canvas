const assert = require('node:assert/strict');
const fs = require('node:fs');
const { completedMarker } = require('../runtime-reload-contract.cjs');

assert(process.stdin.isTTY && process.stdout.isTTY);
const receiptPath = process.argv[2];
assert(receiptPath);
process.stdin.setRawMode(true);
process.stdin.setEncoding('utf8');
const save = state => {
  fs.writeFileSync(`${receiptPath}.tmp`, `${JSON.stringify({ pid: process.pid, state, marker: completedMarker })}\n`);
  fs.renameSync(`${receiptPath}.tmp`, receiptPath);
};
const safety = setTimeout(() => { save('safety-timeout'); process.exit(2); }, 120000);
let pending = '';
save('ready');
process.stdin.on('data', data => {
  pending += data;
  assert(pending.length <= 32);
  if (!/[\r\n]/.test(pending)) return;
  assert.equal(pending.trim(), 'finish');
  process.stdin.removeAllListeners('data');
  process.stdout.write(`${completedMarker}\r\n`, error => {
    if (error) throw error;
    save('finished');
    clearTimeout(safety);
    process.stdin.destroy();
  });
});
