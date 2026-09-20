import net from 'node:net';
import { parentPort, workerData } from 'node:worker_threads';

// The native pipe has exactly one reader. No forwarding server or idle-close timer.
const socket = net.createConnection(workerData.pipe);
let ended = false;
let cancelled = false;
let pauseTimer;
let tail = '';
let paused = false;
socket.on('connect', () => parentPort.postMessage({ event: 'ready' }));
socket.on('data', bytes => {
  parentPort.postMessage({ event: 'data', bytes });
  const boundary = tail + bytes.toString('utf8');
  tail = boundary.slice(-200);
  if (workerData.pauseMarker && !paused && boundary.includes(workerData.pauseMarker)) {
    paused = true;
    socket.pause();
    parentPort.postMessage({ event: 'reader-pause', durationMs: workerData.pauseMs });
    pauseTimer = setTimeout(() => {
      parentPort.postMessage({ event: 'reader-resume' });
      socket.resume();
    }, workerData.pauseMs);
  }
});
socket.on('end', () => {
  ended = true;
  parentPort.postMessage({ event: 'pipe-end', cancelled });
});
socket.on('error', error => parentPort.postMessage({ event: 'pipe-error', code: error.code, message: error.message }));
socket.on('close', hadError => {
  clearTimeout(pauseTimer);
  parentPort.postMessage({ event: 'pipe-close', ended, cancelled, hadError });
  parentPort.close();
});
parentPort.on('message', message => {
  if (message === 'cancel') {
    cancelled = true;
    clearTimeout(pauseTimer);
    socket.destroy();
  }
});
