const fs = require('node:fs');
const { createHash, randomUUID } = require('node:crypto');

const receiptPath = process.argv[2];
if (!receiptPath) throw new Error('Expected a new writer receipt path.');
const readerIsolationGate = process.argv[3] === '--reader-isolation-gate';
const intensityTail = process.argv[3] === '--intensity-tail';
if (process.argv.length > (readerIsolationGate || intensityTail ? 4 : 3)) throw new Error('Unexpected writer arguments.');
const digest = createHash('sha256');
let bytesWritten = 0;
const write = value => {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  let offset = 0;
  while (offset < bytes.length) {
    const count = fs.writeSync(1, bytes, offset, bytes.length - offset);
    if (count <= 0) throw new Error('Terminal write did not advance.');
    digest.update(bytes.subarray(offset, offset + count));
    offset += count;
    bytesWritten += count;
  }
};

function pauseForReaderSwitch() {
  const gateId = randomUUID();
  const fields = fs.readFileSync('/proc/self/stat', 'utf8').split(') ').at(-1).split(' ');
  const identity = { pid: process.pid, startTicks: fields[19] };
  const startedAt = performance.now();
  const timeoutMs = 60000;
  publish(`${receiptPath}.gate-ready.json`, { schemaVersion: 1, gateId, identity,
    lineCount: 45000, bytesWritten, sha256: digest.copy().digest('hex'), timeoutMs });
  const releasePath = `${receiptPath}.gate-release.json`;
  const wait = new Int32Array(new SharedArrayBuffer(4));
  while (performance.now() - startedAt < timeoutMs) {
    if (fs.existsSync(releasePath)) {
      const release = JSON.parse(fs.readFileSync(releasePath, 'utf8'));
      if (release.gateId !== gateId) throw new Error('Reader gate release identity mismatch.');
      return;
    }
    Atomics.wait(wait, 0, 0, 25);
  }
  publish(`${receiptPath}.gate-timeout.json`, { schemaVersion: 1, gateId, identity,
    timeoutMs, elapsedMs: Math.round(performance.now() - startedAt), exitCode: 124 });
  process.exit(124);
}

function publish(file, value) {
  const pending = `${file}.${process.pid}.pending`;
  fs.writeFileSync(pending, `${JSON.stringify(value)}\n`, { flag: 'wx' });
  fs.linkSync(pending, file);
  fs.unlinkSync(pending);
}

write('\x1b[2J\x1b[H');
for (let index = 1; index <= 90000; index += 1) {
  write(`DSC_CANDIDATE_${String(index).padStart(5, '0')}_${'0'.repeat(40)}\r\n`);
  if (readerIsolationGate && index === 45000) pauseForReaderSwitch();
}
const utf8Tail = Buffer.from('DSC_CANDIDATE_UTF8_\u4e2d\u6587_\u00e9\r\n');
for (const byte of utf8Tail) write(Buffer.from([byte]));
write(intensityTail
  ? '\x1b[31mDSC_CANDIDATE_\x1b[2mA\x1b[22;1mN\x1b[1;2mS\x1b[22;2mI\x1b[0m\r\n'
  : '\x1b[31mDSC_CANDIDATE_ANSI\x1b[0m\r\n');
write('\x1b]2;DSC_CANDIDATE_FINAL_TITLE\x07');
write('\x1b[3;');
write('7H');
// This receipt records only bytes for which the real terminal write succeeded.
publish(receiptPath, { schemaVersion: 1, pid: process.pid,
  executable: process.execPath, versions: process.versions, lineCount: 90000,
  bytesWritten, sha256: digest.digest('hex'), terminalWriteComplete: true,
  ...(intensityTail ? { intensityTail: true } : {}) });
