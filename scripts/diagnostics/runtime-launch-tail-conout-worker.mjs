import net from 'node:net';
import { parentPort, workerData } from 'node:worker_threads';

// This new candidate owns one pipe reader; historical reader probes remain frozen.
const socket = net.createConnection(workerData.pipe);
let ended = false;
let cancelled = false;
let pauseTimer;
let tail = '';
let paused = false;
let sequence = 0;
const send = (event, details = {}) => parentPort.postMessage({ event, ...details });

socket.on('connect', () => send('worker-ready'));
socket.on('data', bytes => {
  send('worker-data', { sequence: ++sequence, bytes });
  const boundary = tail + bytes.toString('utf8');
  tail = boundary.slice(-200);
  if (workerData.pauseMarker && !paused && boundary.includes(workerData.pauseMarker)) {
    paused = true;
    socket.pause();
    send('reader-paused', { durationMs: workerData.pauseMs });
    pauseTimer = setTimeout(() => {
      send('reader-resumed');
      socket.resume();
    }, workerData.pauseMs);
  }
});
socket.on('end', () => {
  ended = true;
  send('pipe-end', { cancelled, sequence });
});
socket.on('error', error => send('pipe-error', { code: error.code, message: error.message }));
socket.on('close', hadError => {
  clearTimeout(pauseTimer);
  send('pipe-close', { ended, cancelled, hadError, sequence });
  parentPort.close();
});
parentPort.on('message', message => {
  if (message !== 'cancel' || cancelled || socket.destroyed) return;
  cancelled = true;
  clearTimeout(pauseTimer);
  send('cancel-applied', { sequence });
  socket.destroy();
});
