import { createHash } from 'crypto';
import * as fs from 'fs/promises';
import * as net from 'net';

const ENDPOINT_PROBE_TIMEOUT_MS = 1000;

export function assertRuntimeSupervisorNamespaceSupport(nativeClaim?: (storageDir: string) => void): void {
  if (process.platform === 'darwin' && typeof nativeClaim === 'function' && typeof process.getuid === 'function') return;
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (!['linux', 'win32'].includes(process.platform) || !Number.isInteger(major) || !Number.isInteger(minor)
    || major < 20 || (major === 20 && minor < 8)
    || (process.platform === 'linux' && typeof process.getuid !== 'function')) {
    throw new Error('Runtime Supervisor namespace ownership requires a supported platform and Node >=20.8.');
  }
}

export async function acquireRuntimeSupervisorNamespace(storageDir: string,
  nativeClaim?: (storageDir: string) => void): Promise<net.Server | undefined> {
  assertRuntimeSupervisorNamespaceSupport(nativeClaim);
  if (process.platform === 'darwin') {
    nativeClaim!(await fs.realpath(storageDir));
    return undefined;
  }
  const canonicalStorageDir = await fs.realpath(storageDir);
  const identity = process.platform === 'win32' ? { storageDir: canonicalStorageDir.toLowerCase() }
    : { uid: process.getuid!(), storageDir: canonicalStorageDir };
  const digest = createHash('sha256').update(JSON.stringify(identity)).digest('hex');
  const owner = net.createServer((socket) => socket.destroy());
  await new Promise<void>((resolve, reject) => {
    owner.once('error', reject);
    owner.listen(process.platform === 'win32' ? `\\\\.\\pipe\\dsc-runtime-owner-${digest}` : `\0dsc-runtime-owner-${digest}`, () => {
      owner.removeListener('error', reject);
      resolve();
    });
  });
  // This claim survives business-listener shutdown but must not keep the process alive by itself.
  owner.unref();
  return owner;
}

export async function prepareRuntimeSupervisorSocketPath(socketPath: string): Promise<void> {
  if (process.platform === 'win32') {
    await probeEndpoint(socketPath);
    return;
  }
  const before = await socketStat(socketPath);
  if (!before) return;
  if (!before.isSocket()) throw new Error('Runtime Supervisor endpoint is not a socket.');

  const outcome = await probeEndpoint(socketPath);
  const after = await socketStat(socketPath);
  if (!after) return;
  if (outcome !== 'refused' || !after.isSocket() || after.dev !== before.dev || after.ino !== before.ino) {
    throw new Error('Runtime Supervisor endpoint changed during startup.');
  }
  await fs.unlink(socketPath);
}

async function socketStat(socketPath: string) {
  try { return await fs.lstat(socketPath); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

async function probeEndpoint(socketPath: string): Promise<'refused' | 'gone'> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let outcome: 'refused' | 'gone' | Error | undefined;
    const finish = (result: typeof outcome) => {
      if (outcome !== undefined) return;
      outcome = result;
      socket.destroy();
    };
    const timer = setTimeout(() => finish(new Error('Runtime Supervisor endpoint state is unknown.')), ENDPOINT_PROBE_TIMEOUT_MS);
    socket.once('connect', () => finish(new Error('Runtime Supervisor endpoint is already active.')));
    socket.once('error', (error: NodeJS.ErrnoException) => {
      finish(error.code === 'ECONNREFUSED' ? 'refused' : error.code === 'ENOENT' ? 'gone' : error);
    });
    socket.once('close', () => {
      clearTimeout(timer);
      if (outcome === 'refused' || outcome === 'gone') resolve(outcome);
      else reject(outcome ?? new Error('Runtime Supervisor endpoint state is unknown.'));
    });
  });
}
