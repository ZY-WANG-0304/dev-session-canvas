const assert = require('node:assert/strict');
const fs = require('node:fs');
const readline = require('node:readline');

const [receiptPath, nonce] = process.argv.slice(2);
assert(receiptPath && /^[a-f0-9-]+$/.test(nonce));
const pending = `${receiptPath}.pending-${process.pid}`;
fs.writeFileSync(pending, `${JSON.stringify({ schema: 1, nonce, pid: process.pid, state: 'ready' })}\n`, { flag: 'wx' });
fs.linkSync(pending, receiptPath);
fs.unlinkSync(pending);
process.stdout.write(`DSC_ROOT_READY_${nonce}\r\n`);
const lines = readline.createInterface({ input: process.stdin, terminal: false });
lines.on('line', line => {
  if (line === 'exit') {
    lines.close();
    process.stdin.destroy();
    return;
  }
  const match = /^ping ([a-f0-9-]+)$/.exec(line);
  if (match) process.stdout.write(`DSC_ROOT_REPLY_${match[1]}\r\n`);
});
