import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { acquireRuntimeSupervisorNamespace } from '../../../extensions/vscode/dev-session-canvas/src/supervisor/runtimeSupervisorNamespace';

const safety = setTimeout(() => process.exit(124), 25000);

async function main(): Promise<void> {
  if (process.platform !== 'win32' || process.version !== 'v25.6.0' || !process.send) {
    throw new Error('The namespace fixture requires fixed Windows Node and original IPC');
  }
  const [storageDir] = process.argv.slice(2);
  if (!path.isAbsolute(storageDir)) throw new Error('An explicit storage path is required');
  await fs.mkdir(storageDir, { recursive: true });
  const server = await acquireRuntimeSupervisorNamespace(storageDir);
  if (!server) throw new Error('The Windows namespace server was not established');
  process.on('message', value => {
    if (value !== 'release-by-exit') return;
    clearTimeout(safety);
    process.disconnect();
  });
  process.send({ kind: 'claimed', pid: process.pid, address: server.address() });
}

void main().catch(error => {
  clearTimeout(safety);
  process.exitCode = 2;
  const message = { kind: 'rejected', error: error instanceof Error ? error.message : String(error),
    code: error && typeof error === 'object' && 'code' in error ? String(error.code) : null };
  if (process.send) process.send(message, () => { if (process.connected) process.disconnect(); });
  else process.stderr.write(`${JSON.stringify(message)}\n`);
});
