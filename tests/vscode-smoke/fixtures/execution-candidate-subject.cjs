const fs = require('node:fs');
const { createHash } = require('node:crypto');

const receiptPath = process.argv[2];
if (!receiptPath) throw new Error('Expected a new writer receipt path.');
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

write('\x1b[2J\x1b[H');
for (let index = 1; index <= 90000; index += 1) {
  write(`DSC_CANDIDATE_${String(index).padStart(5, '0')}_${'0'.repeat(40)}\r\n`);
}
const utf8Tail = Buffer.from('DSC_CANDIDATE_UTF8_\u4e2d\u6587_\u00e9\r\n');
for (const byte of utf8Tail) write(Buffer.from([byte]));
write('\x1b[31mDSC_CANDIDATE_ANSI\x1b[0m\r\n');
write('\x1b]2;DSC_CANDIDATE_FINAL_TITLE\x07');
write('\x1b[3;');
write('7H');
// This receipt records only bytes for which the real terminal write succeeded.
const pendingReceipt = `${receiptPath}.${process.pid}.pending`;
fs.writeFileSync(pendingReceipt, `${JSON.stringify({ schemaVersion: 1, pid: process.pid,
  executable: process.execPath, versions: process.versions, lineCount: 90000,
  bytesWritten, sha256: digest.digest('hex'), terminalWriteComplete: true })}\n`, { flag: 'wx' });
fs.linkSync(pendingReceipt, receiptPath);
fs.unlinkSync(pendingReceipt);
