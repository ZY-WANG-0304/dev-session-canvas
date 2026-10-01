import { appendFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

if (process.platform !== 'win32' || process.version !== 'v25.6.0' || !process.stdin.isTTY || !process.stdout.isTTY) {
  throw new Error('The Windows product subject requires fixed Node and a real ConPTY terminal');
}
const prefix = process.argv[2];
if (!prefix || !path.isAbsolute(prefix)) throw new Error('An absolute evidence prefix is required');
const safety = setTimeout(() => {
  writeFileSync(`${prefix}-safety.json`, JSON.stringify({ pid: process.pid, ppid: process.ppid,
    kind: 'safety-timeout', exitCode: 124 }), { flag: 'wx' });
  process.exit(124);
}, 25000);
process.stdin.setRawMode(true);
process.stdin.setEncoding('utf8');
let pending = '';
let chain = Promise.resolve();
let closing = false;
let writtenBytes = 0;
const digest = createHash('sha256');

async function output(text) {
  const bytes = Buffer.from(text);
  await new Promise((resolve, reject) => process.stdout.write(bytes, error => error ? reject(error) : resolve()));
  appendFileSync(`${prefix}-written.bin`, bytes);
  digest.update(bytes);
  writtenBytes += bytes.length;
}

function complete(exitCode) {
  writeFileSync(`${prefix}-complete.json`, JSON.stringify({ pid: process.pid, ppid: process.ppid,
    exitCode, writtenBytes, sha256: digest.digest('hex') }), { flag: 'wx' });
  clearTimeout(safety);
  process.stdin.pause();
  process.exitCode = exitCode;
}

async function command(line) {
  if (closing) return;
  if (/^observe:[a-f0-9]{32}$/.test(line)) {
    const nonce = line.slice(8);
    writeFileSync(`${prefix}-observed.json`, JSON.stringify({ pid: process.pid, ppid: process.ppid, nonce }), { flag: 'wx' });
    await output(`OBSERVED:${nonce}\r\n`);
  } else if (/^nonce:[a-f0-9]{32}$/.test(line)) {
    await output(`HASH:${createHash('sha256').update(line.slice(6)).digest('hex')}\r\n`);
  } else if (line === 'size') {
    const [cols, rows] = process.stdout.getWindowSize();
    await output(`SIZE:${cols}x${rows}\r\n`);
  } else if (line === 'finish') {
    closing = true;
    for (let first = 1; first <= 90000; first += 128) {
      let block = '';
      for (let index = first; index < Math.min(90001, first + 128); index++) {
        block += `DSC_LINE_${String(index).padStart(6, '0')}\r\n`;
      }
      await output(block);
    }
    await output('\u001b[31mDSC_TAIL_\u4e2d\u6587\u001b[0m\r\n\u001b[5;7H');
    complete(7);
  } else if (line === 'peer-exit') {
    closing = true;
    await output('PEER_COMPLETE\r\n');
    complete(0);
  } else if (line === 'flood') {
    for (let index = 0; index < 256; index++) await output('x'.repeat(4096));
  } else throw new Error('Unexpected fixed Windows subject command');
}

writeFileSync(`${prefix}-ready.json`, JSON.stringify({ pid: process.pid, ppid: process.ppid,
  stdinTTY: process.stdin.isTTY, stdoutTTY: process.stdout.isTTY }), { flag: 'wx' });
await output(`\u001b[3J\u001b[2J\u001b[HREADY:${process.stdout.columns}x${process.stdout.rows}\r\n`);
process.stdin.on('data', chunk => {
  pending += chunk;
  if (pending.length > 4096) throw new Error('Subject input exceeded its fixed protocol');
  for (let index; (index = pending.indexOf('\n')) !== -1;) {
    const line = pending.slice(0, index).replace(/\r$/, '');
    pending = pending.slice(index + 1);
    chain = chain.then(() => command(line)).catch(error => {
      writeFileSync(`${prefix}-error.txt`, `${error.stack ?? error}\n`, { flag: 'wx' });
      process.exit(126);
    });
  }
});
