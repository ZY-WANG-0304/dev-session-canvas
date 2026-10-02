import { writeFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';

import { runLinuxExecutionProvider } from '../../../extensions/vscode/dev-session-canvas/src/panel/linuxExecutionProvider';

if (process.version !== 'v22.23.2' || process.platform !== 'linux') {
  throw new Error('S3 provider requires the frozen Linux Node v22.23.2 runtime');
}
const identity = { executionId: process.argv[2], generation: process.argv[3] };
const binaryPath = process.argv[4];
const resultPath = process.argv[5];
if (!isAbsolute(binaryPath) || !isAbsolute(resultPath)) throw new Error('S3 fixture paths must be explicit and absolute');

async function main(): Promise<void> {
  const binding = require(binaryPath);
  const result = await runLinuxExecutionProvider({ identity, binding, cols: 80, rows: 24, pollIntervalMs: 5 });
  await writeFile(resultPath, `${JSON.stringify({ identity, binaryPath, node: process.version, result }, null, 2)}\n`, { flag: 'wx' });
  if (result.kind !== 'closed') process.exitCode = 1;
}

void main().catch(async (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  await writeFile(resultPath, `${JSON.stringify({ identity, binaryPath, node: process.version, exception: message }, null, 2)}\n`, { flag: 'wx' }).catch(() => {});
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
