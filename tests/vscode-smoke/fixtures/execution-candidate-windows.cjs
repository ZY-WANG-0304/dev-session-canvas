const fs = require('node:fs');
const { createHash } = require('node:crypto');

if (process.platform !== 'win32' || process.version !== 'v25.6.0' || !process.stdin.isTTY || !process.stdout.isTTY) {
  throw new Error('The fixed Windows writer requires Node25.6.0 and a real terminal');
}
const receiptPath = process.argv[2];
if (!receiptPath) throw new Error('Expected a new writer receipt path');
const save = (suffix, value) => {
  const file = `${receiptPath}${suffix}`, pending = `${file}.${process.pid}.pending`;
  fs.writeFileSync(pending, JSON.stringify(value), { flag: 'wx' });
  fs.linkSync(pending, file); fs.unlinkSync(pending);
};
const safety = setTimeout(() => {
  save('.safety.json', { pid: process.pid, kind: 'safety-timeout', exitCode: 124 });
  process.exit(124);
}, 180000);
const digest = createHash('sha256');
let bytesWritten = 0, nonce, pendingInput = '', running = false;
let chain = Promise.resolve();
const source = fs.openSync(`${receiptPath}.source.bin`, 'wx');
const write = async (value, record = true) => {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  await new Promise((resolve, reject) => process.stdout.write(bytes, error => error ? reject(error) : resolve()));
  if (record) {
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.writeSync(source, bytes, offset, bytes.length - offset);
      if (count <= 0) throw new Error('Source evidence write did not advance');
      offset += count;
    }
    digest.update(bytes); bytesWritten += bytes.length;
  }
};
async function workload(intensityTail = false) {
  await write('\x1b[2J\x1b[H');
  for (let first = 1; first <= 90000; first += 128) {
    let block = '';
    for (let index = first; index < Math.min(first + 128, 90001); index++) {
      block += `DSC_CANDIDATE_${String(index).padStart(5, '0')}_${'0'.repeat(40)}\r\n`;
    }
    await write(block);
  }
  for (const byte of Buffer.from('DSC_CANDIDATE_UTF8_\u4e2d\u6587_\u00e9\r\n')) await write(Buffer.from([byte]));
  await write(intensityTail
    ? '\x1b[31mDSC_CANDIDATE_\x1b[2mA\x1b[22;1mN\x1b[1;2mS\x1b[22;2mI\x1b[0m\r\n'
    : '\x1b[31mDSC_CANDIDATE_ANSI\x1b[0m\r\n');
  await write('\x1b]2;DSC_CANDIDATE_FINAL_TITLE\x07');
  await write('\x1b[3;'); await write('7H');
  fs.closeSync(source);
  save('', { schemaVersion: 1, pid: process.pid, ppid: process.ppid, executable: process.execPath,
    versions: process.versions, lineCount: 90000, bytesWritten, sha256: digest.digest('hex'), terminalWriteComplete: true,
    ...(intensityTail ? { intensityTail: true } : {}) });
  clearTimeout(safety); process.stdin.pause(); process.exitCode = 0;
}
process.stdin.setRawMode(true);
process.stdin.setEncoding('utf8');
save('.ready.json', { pid: process.pid, ppid: process.ppid, executable: process.execPath, stdinTTY: true, stdoutTTY: true });
process.stdin.on('data', chunk => {
  pendingInput += chunk;
  if (pendingInput.length > 4096) throw new Error('Fixed writer input exceeded its protocol');
  for (let index; (index = pendingInput.search(/[\r\n]/)) !== -1;) {
    const line = pendingInput.slice(0, index); pendingInput = pendingInput.slice(index + 1);
    if (!line) continue;
    chain = chain.then(async () => {
      if (running) throw new Error('Writer input is already sealed');
      if (!nonce && /^observe:[a-f0-9]{32}$/.test(line)) {
        nonce = line.slice(8);
        await write(`OBSERVED:${nonce}\r\n`, false);
        save('.observed.json', { pid: process.pid, ppid: process.ppid, nonce });
      } else if (nonce && (line === `run:${nonce}` || line === `run-intensity:${nonce}`)) {
        running = true; await workload(line === `run-intensity:${nonce}`);
      }
      else throw new Error('Unexpected fixed writer input');
    }).catch(error => {
      save('.error.json', { error: String(error), stack: error.stack }); process.exit(126);
    });
  }
});
