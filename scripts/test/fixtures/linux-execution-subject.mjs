import { write } from 'node:fs';

if (process.version !== 'v22.23.2' || process.platform !== 'linux') {
  throw new Error('S3 subject requires the frozen Linux Node v22.23.2 runtime');
}
const mode = process.argv[2];
if (mode !== 'normal' && mode !== 'flood') throw new Error('Unknown fixed S3 subject');

const safety = setTimeout(() => process.exit(124), 20000);

async function writeAll(buffer) {
  let offset = 0;
  while (offset < buffer.byteLength) {
    const written = await new Promise((resolve, reject) => {
      write(1, buffer, offset, Math.min(4096, buffer.byteLength - offset), null,
        (error, bytesWritten) => error ? reject(error) : resolve(bytesWritten));
    });
    if (written <= 0) throw new Error('Subject output made no progress');
    offset += written;
  }
}

try {
  if (mode === 'normal') {
    const text = '\u001b[2J\u001b[Hprefix:' + 'a'.repeat(2048) + '\n'
      + '\u001b[3J\u001b[2J\u001b[HROOT\n\u001b[3;5H\u001b[31m\u4e2d\u6587\u001b[0m\u001b[5;7H';
    const bytes = Buffer.from(text, 'utf8');
    const split = bytes.indexOf(Buffer.from('\u4e2d', 'utf8')) + 1;
    await writeAll(bytes.subarray(0, split));
    await writeAll(bytes.subarray(split, split + 1));
    await writeAll(bytes.subarray(split + 1));
    clearTimeout(safety);
    process.exitCode = 7;
  } else {
    const bytes = Buffer.alloc(4096, 'x');
    for (let chunk = 0; chunk < 256; chunk += 1) await writeAll(bytes);
    // A complete flood without the scheduled stop is not this scenario's success.
    process.exitCode = 125;
    clearTimeout(safety);
  }
} catch (error) {
  clearTimeout(safety);
  process.exitCode = 126;
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
}
