import { appendFileSync, write, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

if (process.platform !== 'darwin' || process.version !== 'v25.6.0' || !process.stdin.isTTY || !process.stdout.isTTY) {
  throw new Error('The macOS product subject requires Node 25.6.0 and a real Darwin PTY');
}
const prefix = process.argv[2];
if (!prefix?.startsWith('/')) throw new Error('An absolute fresh evidence prefix is required');
const safety = setTimeout(() => process.exit(124), 25000);
process.stdin.setRawMode(true);
process.stdin.setEncoding('utf8');
let pending = '';
let chain = Promise.resolve();
let closing = false;
let writtenBytes = 0;

async function output(text) {
  const bytes = Buffer.from(text);
  let offset = 0;
  while (offset < bytes.length) {
    const count = await new Promise((resolve, reject) => write(1, bytes, offset, Math.min(4096, bytes.length - offset), null,
      (error, length) => error ? reject(error) : resolve(length)));
    if (count <= 0) throw new Error('Subject write made no progress');
    appendFileSync(`${prefix}-written.bin`, bytes.subarray(offset, offset + count));
    writtenBytes += count;
    offset += count;
  }
}

async function command(line) {
  if (closing) return;
  if (/^nonce:[a-f0-9]{32}$/.test(line)) {
    await output(`HASH:${createHash('sha256').update(line.slice(6)).digest('hex')}\n`);
  } else if (line === 'size') {
    const [cols, rows] = process.stdout.getWindowSize();
    await output(`SIZE:${cols}x${rows}\n`);
  } else if (line === 'finish') {
    closing = true;
    await output('\u001b[3J\u001b[2J\u001b[HROOT\n\u001b[3;5H\u001b[31m');
    await output('\u4e2d\u6587');
    await output('\u001b[0m\u001b[5;7H');
    writeFileSync(`${prefix}-complete.json`, JSON.stringify({ pid: process.pid, exitCode: 7, writtenBytes }), { flag: 'wx' });
    clearTimeout(safety);
    process.stdin.pause();
    process.exitCode = 7;
  } else if (line === 'flood') {
    for (let index = 0; index < 256; index++) await output('x'.repeat(4096));
  } else throw new Error('Unexpected fixed macOS subject command');
}

await output(`READY:${process.stdout.columns}x${process.stdout.rows}\n`);
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
