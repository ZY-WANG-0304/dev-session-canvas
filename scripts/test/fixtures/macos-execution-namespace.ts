import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { createMacosExecutionOwnerOptions } from '../../../extensions/vscode/dev-session-canvas/src/panel/macosExecutionOwnerFactory';
import { acquireRuntimeSupervisorNamespace } from '../../../extensions/vscode/dev-session-canvas/src/supervisor/runtimeSupervisorNamespace';

const safety = setTimeout(() => process.exit(124), 25000);

async function main(): Promise<void> {
  if (process.platform !== 'darwin' || process.version !== 'v25.6.0' || !process.send) {
    throw new Error('The namespace fixture requires fixed Darwin Node and original IPC');
  }
  const [extensionRoot, storageDir] = process.argv.slice(2);
  if (!path.isAbsolute(extensionRoot) || !path.isAbsolute(storageDir)) throw new Error('Explicit fixture paths are required');
  await fs.mkdir(storageDir, { recursive: true, mode: 0o700 });
  const options = createMacosExecutionOwnerOptions({ extensionRoot, mode: 'live-runtime' });
  await acquireRuntimeSupervisorNamespace(storageDir, options.claimNamespace);
  const state = await fs.stat(path.join(storageDir, 'supervisor-owner.lock'));
  process.on('message', value => {
    if (value !== 'release-by-exit') return;
    clearTimeout(safety);
    process.disconnect();
  });
  process.send({ kind: 'claimed', pid: process.pid, dev: state.dev, ino: state.ino });
}

void main().catch(error => {
  clearTimeout(safety);
  process.exitCode = 2;
  const message = { kind: 'rejected', error: error instanceof Error ? error.message : String(error) };
  if (process.send) process.send(message, () => { if (process.connected) process.disconnect(); });
  else process.stderr.write(`${JSON.stringify(message)}\n`);
});
