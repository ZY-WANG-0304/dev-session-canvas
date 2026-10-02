import { write } from 'node:fs';
import { appendFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

if (process.platform !== 'linux' || process.version !== 'v25.6.0' || !process.stdin.isTTY || !process.stdout.isTTY) {
  throw new Error('S11 requires the frozen Linux Node runtime and a real PTY');
}
const auditPrefix = process.argv[2];
if (!auditPrefix?.startsWith('/')) throw new Error('An absolute per-subject evidence prefix is required');
const safety = setTimeout(() => process.exit(124), 25000);
process.stdin.setRawMode(true);
process.stdin.setEncoding('utf8');
let pending = '';
let chain = Promise.resolve();
let closing = false;

async function output(text) {
  const bytes = Buffer.from(text);
  let offset = 0;
  while (offset < bytes.length) {
    const length = Math.min(4096, bytes.length - offset);
    const count = await new Promise((resolve, reject) => write(1, bytes, offset, length, null,
      (error, written) => error ? reject(error) : resolve(written)));
    if (count <= 0) throw new Error('Subject write made no progress');
    await appendFile(`${auditPrefix}-written.bin`, bytes.subarray(offset, offset + count));
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
    const prefix = '\u001b[3J\u001b[2J\u001b[HROOT\n\u001b[3;5H\u001b[31m';
    await output(prefix);
    await output('\u4e2d\u6587');
    await output('\u001b[0m\u001b[5;7H');
    await appendFile(`${auditPrefix}-complete.json`, JSON.stringify({ exitCode: 7, writtenComplete: true }));
    clearTimeout(safety);
    process.stdin.pause();
    process.exitCode = 7;
  } else if (line === 'flood') {
    for (let i = 0; i < 256; i++) await output('x'.repeat(4096));
    // Staying alive here is intentional: only the owner stop may end this scenario successfully.
  } else throw new Error('Unexpected S11 subject command');
}

await output(`READY:${process.stdout.columns}x${process.stdout.rows}\n`);
process.stdin.on('data', chunk => {
  pending += chunk;
  if (pending.length > 4096) throw new Error('S11 input exceeded its fixed protocol');
  for (let index; (index = pending.indexOf('\n')) !== -1;) {
    const line = pending.slice(0, index).replace(/\r$/, '');
    pending = pending.slice(index + 1);
    chain = chain.then(() => command(line)).catch(async error => {
      await appendFile(`${auditPrefix}-error.txt`, `${error.stack ?? error}\n`).catch(() => {});
      process.exit(126);
    });
  }
});
