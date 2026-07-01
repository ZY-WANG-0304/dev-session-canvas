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
      entryPoints: [path.resolve('extensions/vscode/dev-session-canvas/src/common/runtimeSupervisorProtocol.ts')],
      bundle: true,
      format: 'cjs',
      outfile: protocolOutfile,
      platform: 'node',
      target: 'node18'
    }),
    esbuild.build({
      entryPoints: [path.resolve('extensions/vscode/dev-session-canvas/src/supervisor/runtimeSupervisorMain.ts')],
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

  const supervisorSource = await readFile(path.resolve('extensions/vscode/dev-session-canvas/src/supervisor/runtimeSupervisorMain.ts'), 'utf8');
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
  assert.match(
    supervisorSource,
    /private async createSession\([\s\S]*return this\.toFreshSnapshot\(session\);[\s\S]*private async attachSession\([\s\S]*return this\.toFreshSnapshot\(session\);/u,
    'runtime supervisor create/attach snapshot 必须先 flush headless terminal，不能发布 stale serializedTerminalState。'
  );
  assert.match(
    supervisorSource,
    /session\.outputSequence \+= 1;[\s\S]*session\.terminalStateTracker\.write\(chunk, \{[\s\S]*outputSequence: session\.outputSequence/u,
    'runtime supervisor 写入 terminal state 前必须先递增并标记 outputSequence。'
  );
  assert.match(
    supervisorSource,
    /private getFreshSerializedTerminalState\([\s\S]*serializedTerminalState\?\.outputSequence[\s\S]*stateOutputSequence === session\.outputSequence[\s\S]*serializedTerminalState[\s\S]*undefined/u,
    'runtime supervisor snapshot 只能携带 outputSequence 对齐的 serializedTerminalState。'
  );
  assert.match(
    supervisorSource,
    /initialState: snapshot\.serializedTerminalState,[\s\S]*initialOutput: snapshot\.output,[\s\S]*initialOutputSequence: normalizeRuntimeSupervisorOutputSequence\(snapshot\.outputSequence\)/u,
    'runtime supervisor registry 恢复必须把 raw output sequence 传入 terminal state tracker，用于拒绝 stale serialized state。'
  );
  assert.match(
    supervisorSource,
    /session\.kind === 'agent' && session\.provider === 'claude' && containsTerminalSuspendInput\(params\.data\)[\s\S]*Claude Agent 节点不支持 Ctrl-Z\/fg/u,
    'runtime supervisor 必须拒绝 Claude Agent Ctrl-Z 输入，避免进入不可恢复的伪挂起态。'
  );
  assert.doesNotMatch(
    supervisorSource,
    /reactivateSession|maybeMarkClaudeAgentSuspended|agentSuspendSignals/u,
    'runtime supervisor 不应再保留 Claude 挂起恢复或 suspend 文案识别链路。'
  );

  console.log('runtimeSupervisorProtocol tests passed');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
