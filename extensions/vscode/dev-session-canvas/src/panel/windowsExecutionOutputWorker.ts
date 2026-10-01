import { Socket } from 'node:net';
import { parentPort, workerData } from 'node:worker_threads';
import { attachWindowsOutputReader } from './windowsExecutionOutput';

if (process.platform !== 'win32' || !parentPort || typeof workerData?.pipe !== 'string'
  || !workerData.pipe.startsWith('\\\\.\\pipe\\dsc-execution-')) {
  throw new Error('Windows output worker requires its owned named pipe.');
}
const port = parentPort;
const socketOptions = { readable: true, readableHighWaterMark: 4096 };
const socket = new Socket(socketOptions);
if (socket.readableHighWaterMark !== 4096) throw new Error('ConPTY reader requires its fixed stream buffer budget.');
const reader = attachWindowsOutputReader(socket, message => {
  if (message.type === 'data') {
    const bytes = Uint8Array.from(message.bytes);
    port.postMessage({ ...message, bytes }, [bytes.buffer]);
  } else port.postMessage(message);
}, () => port.close());
port.on('message', message => {
  if (message?.type === 'ack' && Number.isSafeInteger(message.id)) reader.acknowledge(message.id);
  else if (message?.type === 'cancel' && typeof message.reason === 'string') reader.cancel(message.reason);
  else reader.cancel('Invalid ConPTY reader control.');
});
socket.connect(workerData.pipe);
