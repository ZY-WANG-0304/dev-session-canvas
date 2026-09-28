import assert from 'node:assert/strict';
import { write } from 'node:fs';
import { writeFile } from 'node:fs/promises';

assert.equal(process.platform, 'linux');
assert.equal(process.version, 'v25.6.0');
assert.ok(process.stdin.isTTY && process.stdout.isTTY, 'Capacity source requires the real PTY');
const statusPath = process.argv[2];
assert.ok(statusPath?.startsWith('/'));
const safety = setTimeout(() => process.exit(124), 300000);
process.stdin.setRawMode(true);
process.stdin.setEncoding('utf8');
let blocks = 0;
let pending = '';
let chain = Promise.resolve();
let closing = false;
const status = extra => writeFile(statusPath, JSON.stringify({ pid: process.pid, blocks, ...extra }));

async function output(text) {
  const bytes = Buffer.from(text);
  for (let offset = 0; offset < bytes.length;) {
    const count = await new Promise((resolve, reject) => write(1, bytes, offset,
      Math.min(4096, bytes.length - offset), null,
      (error, written) => error ? reject(error) : resolve(written)));
    assert.ok(count > 0, 'Capacity source write must advance');
    offset += count;
  }
}

async function command(line) {
  if (closing) return;
  if (/^produce:(640|1280|2560)$/.test(line)) {
    const target = Number(line.slice(8));
    assert.ok(target > blocks);
    if (blocks === 0) await output('\u001b]10;#ff0000\u0007');
    while (blocks < target) {
      const row = `${String(++blocks).padStart(8, '0')}:${'x'.repeat(69)}`;
      // The fixed PTY has ONLCR: these LF writes become the original 10 KiB CRLF block.
      await output(`${row}\n`.repeat(128));
    }
    await status({ produced: true });
  } else if (/^ping:[a-f0-9]{32}$/.test(line)) {
    await status({ ping: line.slice(5) });
  } else if (line === 'finish') {
    closing = true;
    await status({ finished: true });
    clearTimeout(safety);
    process.stdin.pause();
    process.exitCode = 0;
  } else throw new Error('Unexpected fixed capacity source command');
}

await status({ ready: true });
process.stdin.on('data', chunk => {
  pending += chunk;
  assert.ok(pending.length <= 4096, 'Capacity command input is bounded');
  for (let index; (index = pending.indexOf('\n')) >= 0;) {
    const line = pending.slice(0, index).replace(/\r$/, '');
    pending = pending.slice(index + 1);
    chain = chain.then(() => command(line)).catch(async error => {
      await status({ failed: String(error) });
      process.exit(126);
    });
  }
});
