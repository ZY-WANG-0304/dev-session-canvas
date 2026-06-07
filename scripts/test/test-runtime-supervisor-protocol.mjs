import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import esbuild from 'esbuild';

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'dsc-runtime-supervisor-protocol-'));

try {
  const protocolOutfile = path.join(tempDir, 'runtimeSupervisorProtocol.cjs');
  const supervisorOutfile = path.join(tempDir, 'runtimeSupervisorMain.cjs');
  await Promise.all([
    esbuild.build({
      entryPoints: [path.resolve('src/common/runtimeSupervisorProtocol.ts')],
      bundle: true,
      format: 'cjs',
      outfile: protocolOutfile,
      platform: 'node',
      target: 'node18'
    }),
    esbuild.build({
      entryPoints: [path.resolve('src/supervisor/runtimeSupervisorMain.ts')],
      bundle: true,
      format: 'cjs',
      outfile: supervisorOutfile,
      platform: 'node',
      target: 'node18',
      external: ['node-pty']
    })
  ]);

  const require = createRequire(import.meta.url);
  const {
    createRuntimeSupervisorError,
    serializeRuntimeSupervisorError
  } = require(protocolOutfile);

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

  const supervisorSource = await readFile(path.resolve('src/supervisor/runtimeSupervisorMain.ts'), 'utf8');
  assert.match(
    supervisorSource,
    /private deleteSession\([\s\S]*?session\.live = false;[\s\S]*?this\.emitSessionState\(session\);[\s\S]*?this\.sessions\.delete\(params\.sessionId\);/u,
    'deleteSession 必须先向所有订阅窗口广播非 live 终态，再删除共享 backend session。'
  );
  assert.match(
    supervisorSource,
    /private broadcastToSessionSubscribers\([\s\S]*for \(const \[socket, subscriptions\] of this\.subscriptions\.entries\(\)\)/u,
    'runtime supervisor output/state 应向同一 session 的所有订阅 socket 多播。'
  );

  console.log('runtimeSupervisorProtocol tests passed');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
