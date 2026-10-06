import * as fs from 'fs/promises';
import * as net from 'net';
import * as path from 'path';

const MAX_PROC_ENTRIES = 8192;
const MAX_PROC_FILE_BYTES = 64 * 1024;
const MAX_PROC_SCAN_BYTES = 8 * 1024 * 1024;
const SOCKET_TIMEOUT_MS = 1000;

export async function noLinuxRuntimeSupervisor(storageDir: string, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted || await fs.readlink('/proc/self') !== String(process.pid)) return false;
  const uid = process.getuid!();
  if (!Number.isSafeInteger(uid) || uid < 0) return false;
  const entries = await fs.readdir('/proc');
  if (entries.length > MAX_PROC_ENTRIES || signal?.aborted) return false;
  let bytesRead = 0;
  const read = async (file: string): Promise<Buffer> => {
    const bytes = await readProcFile(file, signal);
    bytesRead += bytes.length;
    if (bytesRead > MAX_PROC_SCAN_BYTES) throw new Error('Runtime history process observation exceeded its bound.');
    return bytes;
  };
  for (const entry of entries) {
    if (signal?.aborted) return false;
    if (!/^[1-9]\d*$/.test(entry)) continue;
    let status: string;
    let command: Buffer;
    try {
      status = (await read(`/proc/${entry}/status`)).toString('utf8');
      const uids = /^Uid:\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*$/m.exec(status);
      if (!uids) return false;
      const identities = uids.slice(1).map(Number);
      if (identities.some(value => !Number.isSafeInteger(value))) return false;
      if (!identities.includes(uid)) continue;
      command = await read(`/proc/${entry}/cmdline`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    if (signal?.aborted) return false;
    if (!command.length) {
      if (/^State:\s+Z(?:\s|$)/m.test(status)) continue;
      return false;
    }
    if (command[command.length - 1] !== 0 || command[0] === 0) return false;
    const argv = command.subarray(0, -1).toString('utf8').split('\0');
    if (argv.some(value => value.startsWith('--storage-dir='))) return false;
    const offsets = argv.flatMap((value, index) => value === '--storage-dir' ? [index] : []);
    if (!offsets.length) continue;
    if (offsets.length !== 1) return false;
    const original = argv[offsets[0] + 1];
    if (!original || !path.isAbsolute(original) || signal?.aborted) return false;
    // Both the old launcher and Supervisor carry this argument, independent of script names.
    if (await fs.realpath(original) === storageDir) return false;
  }
  return !signal?.aborted;
}

async function readProcFile(file: string, signal?: AbortSignal): Promise<Buffer> {
  if (signal?.aborted) throw new Error('Runtime history process observation was cancelled.');
  const handle = await fs.open(file, 'r');
  try {
    const bytes = Buffer.alloc(MAX_PROC_FILE_BYTES + 1);
    let offset = 0;
    while (offset < bytes.length && !signal?.aborted) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (signal?.aborted || offset > MAX_PROC_FILE_BYTES) throw new Error('Runtime history process observation is incomplete.');
    return bytes.subarray(0, offset);
  } finally { await handle.close(); }
}

export async function linuxRuntimeSocketAbsent(socketPath: string, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return false;
  return new Promise(resolve => {
    const socket = net.createConnection(socketPath);
    let absent = false;
    let finished = false;
    const finish = (value: boolean): void => {
      if (finished) return;
      finished = true;
      absent = value;
      socket.destroy();
    };
    const aborted = (): void => finish(false);
    const timer = setTimeout(aborted, SOCKET_TIMEOUT_MS);
    socket.once('connect', () => finish(false));
    socket.once('error', error => finish(['ENOENT', 'ECONNREFUSED'].includes((error as NodeJS.ErrnoException).code ?? '')));
    socket.once('close', () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', aborted);
      resolve(absent && !signal?.aborted);
    });
    signal?.addEventListener('abort', aborted, { once: true });
    if (signal?.aborted) aborted();
  });
}
