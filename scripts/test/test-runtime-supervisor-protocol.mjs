import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import esbuild from 'esbuild';

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'dsc-runtime-supervisor-protocol-'));
let runtimeSupervisorRequestSequence = 0;

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
    /private async deleteSession\([\s\S]*?session\.live = false;[\s\S]*?await this\.emitFreshSessionState\(session\);[\s\S]*?this\.sessions\.delete\(params\.sessionId\);/u,
    'deleteSession 必须先向所有订阅窗口广播 fresh 非 live 终态，再删除共享 backend session。'
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
    /private async finalizeSession\([\s\S]*await this\.emitFreshSessionState\(session\);[\s\S]*private async emitFreshSessionState\([\s\S]*payload: await this\.toFreshSnapshot\(session\)/u,
    'runtime supervisor final sessionState 必须先 flush headless terminal，避免输出后立即退出时丢失 serializedTerminalState。'
  );
  assert.match(
    supervisorSource,
    /private async persistRegistry\([\s\S]*await Promise\.all\([\s\S]*this\.toFreshSnapshot\(session\)[\s\S]*sessions: snapshots\.filter/u,
    'runtime supervisor registry 持久化必须使用 fresh snapshot，避免把 stale cached serializedTerminalState 写入 registry。'
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

  await assertRuntimeSupervisorFinalStateUsesFreshSerializedSnapshot(supervisorOutfile, tempDir);

  console.log('runtimeSupervisorProtocol tests passed');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

async function assertRuntimeSupervisorFinalStateUsesFreshSerializedSnapshot(supervisorOutfile, tempDir) {
  const storageDir = path.join(tempDir, 'runtime-storage');
  const socketPath =
    process.platform === 'win32'
      ? `\\\\.\\pipe\\dsc-runtime-supervisor-${process.pid}-${Date.now()}`
      : path.join(storageDir, 'supervisor.sock');
  const registryPath = path.join(storageDir, 'registry.json');
  const supervisor = spawn(
    process.execPath,
    [
      supervisorOutfile,
      '--storage-dir',
      storageDir,
      '--socket-path',
      socketPath
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_PATH: path.resolve('node_modules')
      },
      stdio: ['ignore', 'ignore', 'pipe']
    }
  );
  const stderrChunks = [];
  supervisor.stderr.on('data', (chunk) => {
    stderrChunks.push(Buffer.from(chunk).toString('utf8'));
  });

  let socket;
  try {
    socket = await connectRuntimeSupervisorSocket(socketPath, supervisor, stderrChunks);
    socket.setEncoding('utf8');
    const messages = [];
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk;
      while (true) {
        const newlineIndex = buffer.indexOf('\n');
        if (newlineIndex < 0) {
          break;
        }

        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (line) {
          messages.push(JSON.parse(line));
        }
      }
    });

    const marker = `runtime-final-marker-${Date.now()}`;
    const scriptPath = path.join(tempDir, 'runtime-final-output.js');
    await writeFile(scriptPath, `process.stdout.write(${JSON.stringify(`${marker}\r\n`)});\n`, 'utf8');
    await sendRuntimeSupervisorRequest(socket, messages, 'createSession', {
      kind: 'terminal',
      sessionId: 'immediate-exit-terminal',
      displayLabel: 'Node',
      launchMode: 'start',
      scrollback: 1000,
      launchSpec: {
        file: process.execPath,
        args: [scriptPath],
        cwd: tempDir,
        cols: 80,
        rows: 24,
        env: process.env,
        terminalName: 'xterm-256color'
      }
    });

    const finalState = await waitForRuntimeSupervisorMessage(
      messages,
      (message) =>
        message.type === 'event' &&
        message.event === 'sessionState' &&
        message.payload?.sessionId === 'immediate-exit-terminal' &&
        message.payload.live === false,
      'final sessionState'
    );
    assert.equal(
      finalState.payload.serializedTerminalState?.outputSequence,
      finalState.payload.outputSequence,
      'final sessionState should carry a serialized terminal state fresh to the final output sequence.'
    );
    assert.match(
      finalState.payload.serializedTerminalState?.data ?? '',
      new RegExp(marker, 'u'),
      'final sessionState serialized terminal state should include output written immediately before exit.'
    );

    const storedSession = await waitForRuntimeSupervisorRegistrySession(
      registryPath,
      'immediate-exit-terminal'
    );
    assert.equal(
      storedSession.serializedTerminalState?.outputSequence,
      storedSession.outputSequence,
      'registry snapshot should carry a serialized terminal state fresh to the final output sequence.'
    );
    assert.match(
      storedSession.serializedTerminalState?.data ?? '',
      new RegExp(marker, 'u'),
      'registry serialized terminal state should include output written immediately before exit.'
    );
  } finally {
    socket?.destroy();
    supervisor.kill();
    await new Promise((resolve) => {
      supervisor.once('close', resolve);
      setTimeout(resolve, 1000);
    });
  }
}

async function connectRuntimeSupervisorSocket(socketPath, supervisor, stderrChunks) {
  const deadline = Date.now() + 5000;
  let lastError;
  while (Date.now() < deadline) {
    if (supervisor.exitCode !== null) {
      throw new Error(`runtime supervisor exited early: ${stderrChunks.join('')}`);
    }

    try {
      return await new Promise((resolve, reject) => {
        const socket = net.createConnection(socketPath, () => {
          socket.removeListener('error', reject);
          resolve(socket);
        });
        socket.once('error', reject);
      });
    } catch (error) {
      lastError = error;
      await delay(25);
    }
  }

  throw lastError ?? new Error('runtime supervisor socket connect timed out.');
}

async function sendRuntimeSupervisorRequest(socket, messages, method, params) {
  const id = `runtime-supervisor-test-${++runtimeSupervisorRequestSequence}`;
  socket.write(`${JSON.stringify({
    type: 'request',
    id,
    method,
    params
  })}\n`);
  const response = await waitForRuntimeSupervisorMessage(
    messages,
    (message) => message.type === 'response' && message.id === id,
    `${method} response`
  );
  assert.equal(response.ok, true, response.error?.message);
  return response.result;
}

async function waitForRuntimeSupervisorMessage(messages, predicate, label) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const index = messages.findIndex(predicate);
    if (index >= 0) {
      const [message] = messages.splice(index, 1);
      return message;
    }

    await delay(10);
  }

  throw new Error(`Timed out waiting for ${label}.`);
}

async function waitForRuntimeSupervisorRegistrySession(registryPath, sessionId) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const registry = JSON.parse(await readFile(registryPath, 'utf8'));
      const session = registry.sessions?.find((candidate) => candidate.sessionId === sessionId);
      if (session) {
        return session;
      }
    } catch {
      // Registry writes are debounced; keep polling until the supervisor flushes it.
    }

    await delay(25);
  }

  throw new Error(`Timed out waiting for registry session ${sessionId}.`);
}

function delay(timeoutMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, timeoutMs);
  });
}
