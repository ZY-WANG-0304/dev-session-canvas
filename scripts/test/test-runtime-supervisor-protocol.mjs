import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import esbuild from 'esbuild';

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'dsc-runtime-supervisor-protocol-'));

try {
  const outfile = path.join(tempDir, 'runtimeSupervisorProtocol.cjs');
  await esbuild.build({
    entryPoints: [path.resolve('src/common/runtimeSupervisorProtocol.ts')],
    bundle: true,
    format: 'cjs',
    outfile,
    platform: 'node',
    target: 'node18'
  });

  const require = createRequire(import.meta.url);
  const {
    createRuntimeSupervisorError,
    serializeRuntimeSupervisorError
  } = require(outfile);

  const spawnError = new Error('spawn /missing/codex ENOENT');
  spawnError.code = 'ENOENT';
  const payload = serializeRuntimeSupervisorError(spawnError);
  assert.deepEqual(payload, {
    message: 'spawn /missing/codex ENOENT',
    code: 'ENOENT'
  });

  const restoredError = createRuntimeSupervisorError(payload);
  assert.equal(restoredError.message, 'spawn /missing/codex ENOENT');
  assert.equal(restoredError.code, 'ENOENT');

  const genericPayload = serializeRuntimeSupervisorError(new Error('generic failure'));
  assert.deepEqual(genericPayload, {
    message: 'generic failure'
  });
  assert.equal(createRuntimeSupervisorError(genericPayload).code, undefined);

  console.log('runtimeSupervisorProtocol tests passed');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
