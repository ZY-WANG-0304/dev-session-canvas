import net from 'node:net';
import { parentPort, workerData } from 'node:worker_threads';

const socket = net.createConnection(workerData.pipe);
let observed = 0, delivered = 0, ended = false, cancelled = false, held, boundary = '';
const send = (event, details = {}) => parentPort.postMessage({ event, ns: process.hrtime.bigint().toString(), ...details });
const observe = (bytes, origin) => {
  const item = { id: ++observed, bytes: Buffer.from(bytes), origin };
  send('observed', item);
  return item;
};
const deliver = item => {
  if (item.id !== ++delivered) throw new Error('Non-contiguous owned delivery');
  send('delivery', item);
};
function onData(bytes) {
  const item = observe(bytes, 'data-callback');
  boundary = (boundary + bytes.toString('utf8')).slice(-8192);
  if (workerData.hold && boundary.includes('DSC_OWNED_BEGIN')) {
    socket.pause();
    held = item;
    send('held', { id: item.id, bytes: bytes.length, readableLength: socket.readableLength });
  } else deliver(item);
}
socket.on('connect', () => send('ready'));
socket.on('data', onData);
socket.on('end', () => { ended = true; send('pipe-end', { cancelled }); });
socket.on('error', error => send('pipe-error', { code: error.code, message: error.message }));
socket.on('close', hadError => {
  send('source', { reason: cancelled ? 'interrupted:diagnostic-cancel' : ended ? 'pipe-eof' : 'interrupted:close-without-end' });
  send('pipe-close', { ended, cancelled, hadError, observed, delivered, held: Boolean(held) });
  parentPort.close();
});
parentPort.on('message', message => {
  if (message !== 'cancel' || cancelled) return;
  cancelled = true;
  socket.pause();
  socket.removeListener('data', onData);
  const buffered = socket.readableLength;
  send('cancel-applied', { buffered, held: held?.id ?? null, ended, destroyed: socket.destroyed });
  if (held) { deliver(held); held = undefined; }
  // Only consume the already-owned JS buffer, not an unbounded post-cancel drain.
  if (buffered) {
    const bytes = socket.read(buffered);
    if (!bytes || bytes.length !== buffered) throw new Error('Readable snapshot changed during cancellation');
    deliver(observe(bytes, 'readable-at-cancel'));
  }
  send('owned-settled', { observed, delivered, bufferedRemaining: socket.readableLength });
  socket.destroy();
});
