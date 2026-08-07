import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import esbuild from 'esbuild';

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'dsc-runtime-supervisor-protocol-'));
let runtimeSupervisorRequestSequence = 0;
let linuxClockTicksPerSecond;

try {
  const protocolOutfile = path.join(tempDir, 'runtimeSupervisorProtocol.cjs');
  const clientOutfile = path.join(tempDir, 'runtimeSupervisorClient.cjs');
  const terminalSessionStreamOutfile = path.join(tempDir, 'terminalSessionStream.cjs');
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
      entryPoints: [path.resolve('extensions/vscode/dev-session-canvas/src/panel/runtimeSupervisorClient.ts')],
      bundle: true,
      format: 'cjs',
      outfile: clientOutfile,
      platform: 'node',
      target: 'node18'
    }),
    esbuild.build({
      entryPoints: [path.resolve('extensions/vscode/dev-session-canvas/src/common/terminalSessionStream.ts')],
      bundle: true,
      format: 'cjs',
      outfile: terminalSessionStreamOutfile,
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
    createRuntimeSupervisorProtocolError,
    formatRuntimeSupervisorMessageDescriptor,
    getRuntimeSupervisorErrorDetails,
    getRuntimeSupervisorErrorDescriptor,
    isRuntimeSupervisorExecutionSpawnError,
    serializeRuntimeSupervisorError
  } = require(protocolOutfile);
  const { RuntimeSupervisorClient } = require(clientOutfile);
  const { mergeTerminalStreamProjectionWithLiveTail } = require(terminalSessionStreamOutfile);
  await assertRuntimeSupervisorClientWaitsForHello(RuntimeSupervisorClient, tempDir);
  await assertRuntimeSupervisorClientClassifiesStartupFailures(RuntimeSupervisorClient, tempDir);
  assertTerminalProjectionMergePreservesConcurrentLiveTail(mergeTerminalStreamProjectionWithLiveTail);

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
  assert.deepEqual(getRuntimeSupervisorErrorDetails(restoredError), { origin: 'protocol' });

  const genericPayload = serializeRuntimeSupervisorError(new Error('generic failure'));
  assert.deepEqual(genericPayload, {
    message: 'generic failure'
  });
  assert.equal(createRuntimeSupervisorError(genericPayload).code, undefined);

  const sessionNotFoundDescriptor = {
    id: 'sessionNotFound',
    params: {
      sessionId: 'missing-session'
    }
  };
  const typedError = createRuntimeSupervisorProtocolError(
    sessionNotFoundDescriptor,
    'DEV_SESSION_CANVAS_RUNTIME_SESSION_NOT_FOUND'
  );
  const typedPayload = serializeRuntimeSupervisorError(typedError);
  assert.deepEqual(typedPayload, {
    message: 'Runtime session missing-session was not found.',
    code: 'DEV_SESSION_CANVAS_RUNTIME_SESSION_NOT_FOUND',
    descriptor: sessionNotFoundDescriptor,
    details: {
      origin: 'protocol'
    }
  });
  const restoredTypedError = createRuntimeSupervisorError(typedPayload);
  assert.equal(restoredTypedError.message, 'Runtime session missing-session was not found.');
  assert.equal(restoredTypedError.code, 'DEV_SESSION_CANVAS_RUNTIME_SESSION_NOT_FOUND');
  assert.deepEqual(getRuntimeSupervisorErrorDescriptor(restoredTypedError), sessionNotFoundDescriptor);
  assert.deepEqual(getRuntimeSupervisorErrorDetails(restoredTypedError), { origin: 'protocol' });
  const executionSpawnError = createRuntimeSupervisorProtocolError(
    {
      id: 'executionSpawnFailed',
      params: {
        file: '/missing/codex',
        cwd: '/workspace',
        detail: 'spawn /missing/codex ENOENT'
      }
    },
    'DEV_SESSION_CANVAS_RUNTIME_EXECUTION_SPAWN_FAILED',
    {
      origin: 'execution-spawn',
      errno: 'ENOENT',
      file: '/missing/codex',
      cwd: '/workspace'
    }
  );
  const executionSpawnPayload = serializeRuntimeSupervisorError(executionSpawnError);
  assert.deepEqual(executionSpawnPayload.details, {
    origin: 'execution-spawn',
    errno: 'ENOENT',
    file: '/missing/codex',
    cwd: '/workspace'
  });
  const restoredExecutionSpawnError = createRuntimeSupervisorError(executionSpawnPayload);
  assert.equal(isRuntimeSupervisorExecutionSpawnError(restoredExecutionSpawnError), true);
  assert.equal(getRuntimeSupervisorErrorDetails(restoredExecutionSpawnError)?.errno, 'ENOENT');
  assert.equal(
    formatRuntimeSupervisorMessageDescriptor({
      id: 'agentSessionStopped',
      params: {
        label: 'Codex'
      }
    }),
    'Stopped Codex session.'
  );

  const supervisorSource = await readFile(path.resolve('extensions/vscode/dev-session-canvas/src/supervisor/runtimeSupervisorMain.ts'), 'utf8');
  const terminalJournalSource = await readFile(
    path.resolve('extensions/vscode/dev-session-canvas/src/supervisor/terminalSessionJournal.ts'),
    'utf8'
  );
  assert.match(
    supervisorSource,
    /private async deleteSession\([\s\S]*?terminalMutationAdmissionOpen = false;[\s\S]*?await this\.enqueueTerminalOperation\(session, async \(\) => \{[\s\S]*?payload:[\s\S]*?await this\.createFreshSnapshot\(session, 'never'\)[\s\S]*?this\.sessions\.delete\(params\.sessionId\);/u,
    'deleteSession 必须先关闭 mutation admission，并在串行链路收敛 fresh 非 live 终态后再删除共享 backend session。'
  );
  assert.match(
    supervisorSource,
    /private broadcastToSessionSubscribers\([\s\S]*for \(const \[socket, subscriptions\] of this\.subscriptions\.entries\(\)\)/u,
    'runtime supervisor output/state 应向同一 session 的所有订阅 socket 多播。'
  );
  assert.match(
    supervisorSource,
    /private async createSession\([\s\S]*await this\.toFreshSnapshot\(session\)[\s\S]*private async attachSession\([\s\S]*return this\.toFreshSnapshot\(session\);/u,
    'runtime supervisor create/attach snapshot 必须先 flush headless terminal，不能发布 stale serializedTerminalState。'
  );
  assert.match(
    supervisorSource,
    /const checkpointCols = session\.cols;[\s\S]*const checkpointRows = session\.rows;[\s\S]*const checkpointScrollback = session\.scrollback;[\s\S]*await session\.terminalStateTracker\.flushValidatedCheckpoint\(\)/u,
    'checkpoint 必须在固定 cols、rows 与 scrollback 后通过无损 eligibility 验证，不能把 parser carry 当作可压缩状态。'
  );
  assert.match(
    supervisorSource,
    /journal\.commitCheckpoint\(checkpoint, \{[\s\S]*?retainAfterRevision: this\.getTerminalJournalRetentionRevision\(session\)[\s\S]*?\}\)/u,
    'validated checkpoint 持久化必须携带 retention floor，deferred attach 与 applied ACK 只能收紧删除边界。'
  );
  assert.match(
    supervisorSource,
    /deferSocketSubscription\([\s\S]*deferredSubscriptionRevisions[\s\S]*releaseTerminalJournalMemoryThroughCheckpoint/u,
    'deferred attach 必须 pin 静态 revision，避免 checkpoint 刷新提前释放 attach gap 事件。'
  );
  assert.match(
    supervisorSource,
    /private async finalizeSession\([\s\S]*this\.enqueueTerminalOperation\(session, async \(\) => \{[\s\S]*payload: await this\.createFreshSnapshot\(session, 'never'\)/u,
    'runtime supervisor final sessionState 必须在串行边界内发布 checkpoint+journal suffix，且 exit 后不再启动昂贵 compact。'
  );
  assert.match(
    supervisorSource,
    /private async persistRegistry\([\s\S]*await Promise\.all\([\s\S]*this\.toFreshSnapshot\([\s\S]*session\.terminalAuthorityId \? 'if-compaction-due' : 'always',[\s\S]*!session\.terminalAuthorityId[\s\S]*sessions: snapshots\.filter/u,
    'authority registry 只持久化 journal metadata，不应每 120ms 内联克隆完整 terminal suffix。'
  );
  assert.match(
    supervisorSource,
    /terminalEvent = session\.terminalJournal\?\.appendOutput\(chunk\);[\s\S]*session\.outputSequence = terminalEvent\?\.revision[\s\S]*session\.terminalStateTracker\.write\(chunk, \{[\s\S]*outputSequence: session\.outputSequence[\s\S]*this\.emitSessionOutput\(session, chunk, terminalEvent\)/u,
    'runtime supervisor 必须先由 journal 分配 revision，再按同一 revision 更新 tracker 和广播 output。'
  );
  assert.match(
    supervisorSource,
    /private getFreshSerializedTerminalState\([\s\S]*serializedTerminalState\?\.outputSequence[\s\S]*stateOutputSequence === session\.outputSequence[\s\S]*serializedTerminalState[\s\S]*undefined/u,
    'runtime supervisor snapshot 只能携带 outputSequence 对齐的 serializedTerminalState。'
  );
  assert.match(
    supervisorSource,
    /const recoveredOutputSequence = normalizeRuntimeSupervisorOutputSequence\(snapshot\.outputSequence\);[\s\S]*await readTerminalSessionJournalMetadata\([\s\S]*recoveredFromDeadPty: true/u,
    '重启后的 Supervisor 必须只读取有界 Journal metadata，保留已保存的显示序列并标记原 PTY 已死亡。'
  );
  assert.doesNotMatch(
    supervisorSource,
    /recoveredOutputSequence = Math\.max\([\s\S]*metadata\.lastRevision/u,
    'Journal manifest revision 不能被当作死亡 PTY 的显示序列。'
  );
  assert.doesNotMatch(
    supervisorSource,
    /TerminalSessionJournal\.open\(|getRecoveryCandidates\(|restoreTerminalJournalCandidate/u,
    '死亡 PTY 的 registry 恢复不得打开、解析或回放完整 Journal。'
  );
  assert.match(
    terminalJournalSource,
    /\{ source: 'current', reference:[\s\S]*\{ source: 'previous', reference:[\s\S]*candidates\.push\(\{[\s\S]*source: 'genesis'/u,
    'journal recovery candidates 必须按 current、previous、genesis 的保守顺序提供。'
  );
  assert.match(
    supervisorSource,
    /initialState: snapshot\.serializedTerminalState,[\s\S]*initialOutput: snapshot\.serializedTerminalState \? undefined : snapshot\.output/u,
    '死亡 PTY 恢复只能初始化有界保存快照或最近输出，不能按 authority 回放 Journal。'
  );
  assert.match(
    supervisorSource,
    /includeRecoveredTerminalProjection = includeTerminalProjection && !session\.recoveredFromDeadPty/u,
    '死亡 PTY 的 Supervisor snapshot 不得覆盖 Host 已保存的完整 terminal projection。'
  );
  assert.match(
    supervisorSource,
    /session\.kind === 'agent' && session\.provider === 'claude' && containsTerminalSuspendInput\(params\.data\)[\s\S]*claudeAgentCtrlZUnsupported/u,
    'runtime supervisor 必须拒绝 Claude Agent Ctrl-Z 输入，避免进入不可恢复的伪挂起态。'
  );
  assert.doesNotMatch(
    supervisorSource,
    /reactivateSession|maybeMarkClaudeAgentSuspended|agentSuspendSignals/u,
    'runtime supervisor 不应再保留 Claude 挂起恢复或 suspend 文案识别链路。'
  );

  const runtimeEvidence = await assertRuntimeSupervisorFinalStateUsesFreshSerializedSnapshot(supervisorOutfile, tempDir);
  await assertRuntimeSupervisorRestartUsesSavedSnapshot(supervisorOutfile, tempDir, runtimeEvidence.marker);
  const capacityMetrics = await assertTenAgentRuntimeCapacity(supervisorOutfile, tempDir);

  console.log(`[10-agent-supervisor-capacity] ${JSON.stringify(capacityMetrics)}`);
  console.log('runtimeSupervisorProtocol tests passed');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

async function assertRuntimeSupervisorClientWaitsForHello(RuntimeSupervisorClient, tempDir) {
  const socketPath =
    process.platform === 'win32'
      ? `\\\\.\\pipe\\dsc-runtime-client-${process.pid}-${Date.now()}`
      : path.join(tempDir, 'runtime-client.sock');
  const sockets = new Set();
  let connectionCount = 0;
  let helloRequestCount = 0;
  let releaseHello;
  let markHelloRequestReceived;
  const helloGate = new Promise((resolve) => {
    releaseHello = resolve;
  });
  const helloRequestReceived = new Promise((resolve) => {
    markHelloRequestReceived = resolve;
  });
  const server = net.createServer((socket) => {
    connectionCount += 1;
    sockets.add(socket);
    socket.setEncoding('utf8');
    socket.on('close', () => sockets.delete(socket));
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk;
      while (true) {
        const newlineIndex = buffer.indexOf('\n');
        if (newlineIndex < 0) {
          return;
        }
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!line) {
          continue;
        }
        const message = JSON.parse(line);
        if (message.type !== 'request' || message.method !== 'hello') {
          continue;
        }
        helloRequestCount += 1;
        markHelloRequestReceived();
        void helloGate.then(() => {
          if (socket.destroyed) {
            return;
          }
          socket.write(`${JSON.stringify({
            type: 'response',
            id: message.id,
            ok: true,
            result: {
              serverVersion: 1,
              pid: process.pid,
              runtimeBackend: 'legacy-detached',
              runtimeGuarantee: 'best-effort',
              capabilities: {
                terminalSessionStreamV1: true,
                terminalProjectionSnapshotV1: true,
                terminalAppliedRevisionAckV1: true,
                agentSubmissionIntentV1: true,
                agentProviderLifecycleV1: true
              }
            }
          })}\n`);
        });
      }
    });
  });

  await new Promise((resolve, reject) => {
    const handleError = (error) => {
      server.removeListener('listening', handleListening);
      reject(error);
    };
    const handleListening = () => {
      server.removeListener('error', handleError);
      resolve();
    };
    server.once('error', handleError);
    server.once('listening', handleListening);
    server.listen(socketPath);
  });

  const client = new RuntimeSupervisorClient({
    backend: {
      kind: 'legacy-detached',
      guarantee: 'best-effort',
      label: 'Test Supervisor',
      paths: {
        storageDir: tempDir,
        socketPath,
        registryPath: path.join(tempDir, 'runtime-client-registry.json'),
        socketLocation: process.platform === 'win32' ? 'named-pipe' : 'storage'
      },
      startSupervisor: async () => assert.fail('The connected test client must not restart the Supervisor.')
    },
    supervisorScriptPath: '/unused/runtimeSupervisorMain.js',
    supervisorLauncherScriptPath: '/unused/runtimeSupervisorLauncher.js'
  });
  let firstEnsure;
  let secondEnsure;
  try {
    firstEnsure = client.ensureConnected({ allowRestart: false });
    await waitForPromise(helloRequestReceived, 2000, 'RuntimeSupervisorClient hello request');

    let secondResolved = false;
    secondEnsure = client.ensureConnected({ allowRestart: false }).then(() => {
      secondResolved = true;
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(
      secondResolved,
      false,
      'Concurrent ensureConnected() must wait until the existing hello handshake publishes capabilities.'
    );

    releaseHello();
    await waitForPromise(
      Promise.all([firstEnsure, secondEnsure]),
      2000,
      'concurrent RuntimeSupervisorClient readiness'
    );
    assert.equal(client.supportsTerminalSessionStream(), true);
    assert.equal(client.supportsTerminalProjectionSnapshot(), true);
    assert.equal(client.supportsTerminalAppliedRevisionAck(), true);
    assert.equal(client.supportsAgentSubmissionIntent(), true);
    assert.equal(client.supportsAgentProviderLifecycle(), true);
    assert.equal(connectionCount, 1, 'Concurrent readiness callers must share one socket connection.');
    assert.equal(helloRequestCount, 1, 'Concurrent readiness callers must share one hello handshake.');
  } finally {
    releaseHello();
    await waitForPromise(
      Promise.allSettled([firstEnsure, secondEnsure].filter(Boolean)),
      2000,
      'RuntimeSupervisorClient readiness cleanup'
    );
    client.dispose();
    for (const socket of sockets) {
      socket.destroy();
    }
    await new Promise((resolve) => server.close(resolve));
  }
}

async function assertRuntimeSupervisorClientClassifiesStartupFailures(RuntimeSupervisorClient, tempDir) {
  const socketPath =
    process.platform === 'win32'
      ? `\\\\.\\pipe\\dsc-runtime-client-missing-${process.pid}-${Date.now()}`
      : path.join(tempDir, `runtime-client-missing-${Date.now()}.sock`);
  const client = new RuntimeSupervisorClient({
    backend: {
      kind: 'legacy-detached',
      guarantee: 'best-effort',
      label: 'Missing Test Supervisor',
      paths: {
        storageDir: tempDir,
        socketPath,
        registryPath: path.join(tempDir, 'runtime-client-missing-registry.json'),
        socketLocation: process.platform === 'win32' ? 'named-pipe' : 'storage'
      },
      startSupervisor: async () => undefined
    },
    supervisorScriptPath: '/unused/runtimeSupervisorMain.js',
    supervisorLauncherScriptPath: '/unused/runtimeSupervisorLauncher.js',
    startupTimeoutMs: 120
  });

  try {
    await assert.rejects(
      client.ensureConnected({ allowRestart: false }),
      (error) => {
        assert.equal(error.code, 'DEV_SESSION_CANVAS_RUNTIME_SUPERVISOR_SOCKET_UNAVAILABLE');
        assert.deepEqual(error.details, {
          origin: 'transport',
          errno: 'ENOENT'
        });
        return true;
      }
    );
    await assert.rejects(
      client.ensureConnected(),
      (error) => {
        assert.equal(error.code, 'DEV_SESSION_CANVAS_RUNTIME_SUPERVISOR_READY_TIMEOUT');
        assert.equal(error.details?.origin, 'readiness');
        assert.equal(error.details?.errno, 'ENOENT');
        return true;
      }
    );
  } finally {
    client.dispose();
  }
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

    const hello = await sendRuntimeSupervisorRequest(socket, messages, 'hello');
    assert.equal(hello.capabilities?.terminalSessionStreamV1, true);
    assert.equal(hello.capabilities?.terminalProjectionSnapshotV1, true);
    assert.equal(hello.capabilities?.terminalProjectionCheckpointV1, true);
    assert.equal(hello.capabilities?.terminalAppliedRevisionAckV1, true);
    assert.equal(hello.capabilities?.agentSubmissionIntentV1, true);
    assert.equal(
      hello.capabilities?.agentProviderLifecycleV1,
      undefined,
      'New Supervisors must not advertise a callback lifecycle transport.'
    );

    const missingSignalAgentScriptPath = path.join(tempDir, 'runtime-agent-missing-provider-signal.js');
    await writeFile(
      missingSignalAgentScriptPath,
      `let turnScheduled = false;\nprocess.stdin.setEncoding('utf8');\nprocess.stdin.on('data', (data) => {\n  if (turnScheduled || !/[\\r\\n]/u.test(data)) return;\n  turnScheduled = true;\n  process.stdout.write('working\\r\\n');\n  setTimeout(() => process.stdout.write('> '), 2300);\n  setTimeout(() => {\n    process.stdout.write('\\u001b]0;⠂ Claude Code\\u0007');\n    setTimeout(() => process.stdout.write('\\u001b]0;⠐ Claude Code\\u0007'), 120);\n  }, 8000);\n});\nsetInterval(() => undefined, 1000);\n`,
      'utf8'
    );
    const missingSignalAgentSnapshot = await sendRuntimeSupervisorRequest(socket, messages, 'createSession', {
      kind: 'agent',
      sessionId: 'provider-signal-missing-agent',
      displayLabel: 'Claude Code',
      launchMode: 'start',
      scrollback: 1000,
      provider: 'claude',
      launchSpec: {
        file: process.execPath,
        args: [missingSignalAgentScriptPath],
        cwd: tempDir,
        cols: 80,
        rows: 24,
        env: process.env,
        terminalName: 'xterm-256color'
      }
    });
    assert.equal(
      missingSignalAgentSnapshot.terminalTitle,
      null,
      'A live Supervisor snapshot must explicitly represent a known empty terminal title.'
    );
    await sendRuntimeSupervisorRequest(socket, messages, 'writeInput', {
      sessionId: 'provider-signal-missing-agent',
      data: 'silent prompt',
      intent: 'text'
    });
    await sendRuntimeSupervisorRequest(socket, messages, 'writeInput', {
      sessionId: 'provider-signal-missing-agent',
      data: '\r',
      intent: 'submit'
    });
    await delay(1900);
    const missingSignalRunningSnapshot = await sendRuntimeSupervisorRequest(
      socket,
      messages,
      'getSessionSnapshot',
      { sessionId: 'provider-signal-missing-agent' }
    );
    assert.equal(
      missingSignalRunningSnapshot.lifecycle,
      'running',
      'The non-invasive submit path must not enter waiting-input before the quiet fallback.'
    );
    assert.equal(missingSignalRunningSnapshot.agentActivitySource, 'submission-intent');
    await delay(800);
    const promptGlyphSnapshot = await sendRuntimeSupervisorRequest(
      socket,
      messages,
      'getSessionSnapshot',
      { sessionId: 'provider-signal-missing-agent' }
    );
    assert.equal(
      promptGlyphSnapshot.lifecycle,
      'running',
      'A prompt glyph must be treated as ordinary PTY output, not completion evidence.'
    );
    const heuristicCompletionSnapshot = await waitForRuntimeSupervisorMessage(
      messages,
      (message) =>
        message.type === 'event' &&
        message.event === 'sessionState' &&
        message.payload?.sessionId === 'provider-signal-missing-agent' &&
        message.payload.lifecycle === 'waiting-input' &&
        message.payload.agentActivitySource === 'heuristic',
      'provider-signal-missing heuristic completion',
      6000
    );
    assert.equal(heuristicCompletionSnapshot.payload.agentActivityAuthority, 'best-effort');
    const heuristicRecoverySnapshot = await waitForRuntimeSupervisorMessage(
      messages,
      (message) =>
        message.type === 'event' &&
        message.event === 'sessionState' &&
        message.payload?.sessionId === 'provider-signal-missing-agent' &&
        message.payload.lifecycle === 'running' &&
        message.payload.agentActivitySource === 'terminal-title',
      'terminal-title waiting recovery',
      4000
    );
    assert.equal(heuristicRecoverySnapshot.payload.agentActivityAuthority, 'best-effort');
    assert.equal(
      heuristicRecoverySnapshot.payload.terminalTitle,
      '⠐ Claude Code',
      'A live Supervisor snapshot must retain the current OSC 0/2 title for reattach.'
    );
    await sendRuntimeSupervisorRequest(socket, messages, 'deleteSession', {
      sessionId: 'provider-signal-missing-agent'
    });

    const echoScriptPath = path.join(tempDir, 'runtime-attach-gap.js');
    const gapMarker = `attach-gap-marker-${Date.now()}`;
    await writeFile(
      echoScriptPath,
      `process.stdin.setEncoding('utf8');\nlet inputCount = 0;\nprocess.stdin.on('data', (data) => {\n  inputCount += 1;\n  process.stdout.write(inputCount === 1 ? ${JSON.stringify(`${gapMarker}\r\n`)} : data);\n});\nsetInterval(() => undefined, 1000);\n`,
      'utf8'
    );
    const attachGapSnapshot = await sendRuntimeSupervisorRequest(socket, messages, 'createSession', {
      kind: 'terminal',
      sessionId: 'attach-gap-terminal',
      displayLabel: 'Node',
      launchMode: 'start',
      scrollback: 1000,
      deferSubscription: true,
      launchSpec: {
        file: process.execPath,
        args: [echoScriptPath],
        cwd: tempDir,
        cols: 80,
        rows: 24,
        env: process.env,
        terminalName: 'xterm-256color'
      }
    });
    assertTerminalStreamSnapshot(attachGapSnapshot, 'attach-gap create snapshot');
    await sendRuntimeSupervisorRequest(socket, messages, 'writeInput', {
      sessionId: 'attach-gap-terminal',
      data: 'trigger\n'
    });
    await waitForRuntimeSupervisorRegistrySession(
      registryPath,
      'attach-gap-terminal',
      (session) => session.terminalRevision > attachGapSnapshot.terminalRevision
    );
    const subscribeResult = await sendRuntimeSupervisorRequest(socket, messages, 'subscribeSession', {
      sessionId: 'attach-gap-terminal',
      authorityId: attachGapSnapshot.terminalAuthorityId,
      afterRevision: attachGapSnapshot.terminalRevision
    });
    const replayedGapEvent = await waitForRuntimeSupervisorMessage(
      messages,
      (message) =>
        message.type === 'event' &&
        message.event === 'sessionTerminalEvent' &&
        message.payload?.sessionId === 'attach-gap-terminal' &&
        message.payload.event?.type === 'output' &&
        message.payload.event.data.includes(gapMarker),
      'attach-gap replay event'
    );
    assert.equal(replayedGapEvent.payload.authorityId, attachGapSnapshot.terminalAuthorityId);
    assert.ok(subscribeResult.revision >= replayedGapEvent.payload.event.revision);
    await delay(50);
    const replayedTerminalEvents = [
      replayedGapEvent,
      ...messages.filter(
        (message) =>
          message.type === 'event' &&
          message.event === 'sessionTerminalEvent' &&
          message.payload?.sessionId === 'attach-gap-terminal' &&
          message.payload.event.revision <= subscribeResult.revision
      )
    ].sort((left, right) => left.payload.event.revision - right.payload.event.revision);
    assert.deepEqual(
      replayedTerminalEvents.map((message) => message.payload.event.revision),
      Array.from(
        { length: subscribeResult.revision - attachGapSnapshot.terminalRevision },
        (_value, index) => attachGapSnapshot.terminalRevision + index + 1
      ),
      'subscribe must replay every revision in the attach gap exactly once and in order.'
    );
    assert.equal(
      replayedTerminalEvents.filter(
        (message) =>
          message.payload.event.type === 'output' &&
          message.payload.event.data.includes(gapMarker)
      ).length,
      1,
      'output produced between attach and subscribe must be replayed exactly once.'
    );

    const refreshLiveMarker = `projection-refresh-live-marker-${Date.now()}`;
    const projectionSnapshotPromise = sendRuntimeSupervisorRequest(
      socket,
      messages,
      'getSessionSnapshot',
      { sessionId: 'attach-gap-terminal' }
    );
    await sendRuntimeSupervisorRequest(socket, messages, 'writeInput', {
      sessionId: 'attach-gap-terminal',
      data: `${refreshLiveMarker}\n`
    });
    const projectionSnapshot = await projectionSnapshotPromise;
    assertTerminalStreamSnapshot(projectionSnapshot, 'projection refresh snapshot');
    const refreshLiveEvent = await waitForRuntimeSupervisorMessage(
      messages,
      (message) =>
        message.type === 'event' &&
        message.event === 'sessionTerminalEvent' &&
        message.payload?.sessionId === 'attach-gap-terminal' &&
        message.payload.event?.type === 'output' &&
        message.payload.event.data.includes(refreshLiveMarker),
      'projection refresh live event'
    );
    assert.equal(refreshLiveEvent.payload.authorityId, attachGapSnapshot.terminalAuthorityId);

    await sendRuntimeSupervisorRequest(socket, messages, 'resizeSession', {
      sessionId: 'attach-gap-terminal',
      cols: 101,
      rows: 33
    });
    const resizeEvent = await waitForRuntimeSupervisorMessage(
      messages,
      (message) =>
        message.type === 'event' &&
        message.event === 'sessionTerminalEvent' &&
        message.payload?.sessionId === 'attach-gap-terminal' &&
        message.payload.event?.type === 'resize',
      'terminal resize event'
    );
    const eventsBeforeResize = messages
      .filter(
        (message) =>
          message.type === 'event' &&
          message.event === 'sessionTerminalEvent' &&
          message.payload?.sessionId === 'attach-gap-terminal' &&
          message.payload.event.revision > refreshLiveEvent.payload.event.revision &&
          message.payload.event.revision < resizeEvent.payload.event.revision
      )
      .sort((left, right) => left.payload.event.revision - right.payload.event.revision);
    assert.ok(
      eventsBeforeResize.every((message) => message.payload.event.type === 'output'),
      'PTY command echo may use a separate revision, but only output may precede the requested resize.'
    );
    assert.deepEqual(
      [refreshLiveEvent, ...eventsBeforeResize, resizeEvent].map((message) => message.payload.event.revision),
      Array.from(
        { length: resizeEvent.payload.event.revision - refreshLiveEvent.payload.event.revision + 1 },
        (_value, index) => refreshLiveEvent.payload.event.revision + index
      ),
      'projection refresh output and the following resize must remain revision-contiguous.'
    );
    await sendRuntimeSupervisorRequest(socket, messages, 'updateSessionScrollback', {
      sessionId: 'attach-gap-terminal',
      scrollback: 2000
    });
    const scrollbackEvent = await waitForRuntimeSupervisorMessage(
      messages,
      (message) =>
        message.type === 'event' &&
        message.event === 'sessionTerminalEvent' &&
        message.payload?.sessionId === 'attach-gap-terminal' &&
        message.payload.event?.type === 'scrollback',
      'terminal scrollback event'
    );
    assert.equal(scrollbackEvent.payload.event.revision, resizeEvent.payload.event.revision + 1);

    const appliedAck = await sendRuntimeSupervisorRequest(socket, messages, 'ackSessionRevision', {
      sessionId: 'attach-gap-terminal',
      authorityId: attachGapSnapshot.terminalAuthorityId,
      consumerId: 'panel',
      revision: scrollbackEvent.payload.event.revision
    });
    assert.deepEqual(appliedAck, {
      sessionId: 'attach-gap-terminal',
      authorityId: attachGapSnapshot.terminalAuthorityId,
      consumerId: 'panel',
      appliedRevision: scrollbackEvent.payload.event.revision
    });
    assert.equal(
      (await sendRuntimeSupervisorRequest(socket, messages, 'ackSessionRevision', {
        sessionId: 'attach-gap-terminal',
        authorityId: attachGapSnapshot.terminalAuthorityId,
        consumerId: 'panel',
        revision: scrollbackEvent.payload.event.revision
      })).appliedRevision,
      scrollbackEvent.payload.event.revision,
      'duplicate applied ACK should be idempotent.'
    );
    assert.equal(
      (await sendRuntimeSupervisorErrorRequest(socket, messages, 'ackSessionRevision', {
        sessionId: 'attach-gap-terminal',
        authorityId: attachGapSnapshot.terminalAuthorityId,
        consumerId: 'panel',
        revision: resizeEvent.payload.event.revision
      })).error.code,
      'DEV_SESSION_CANVAS_RUNTIME_TERMINAL_REVISION_INVALID',
      'applied ACK must reject revision regression.'
    );
    assert.equal(
      (await sendRuntimeSupervisorRequest(socket, messages, 'ackSessionRevision', {
        sessionId: 'attach-gap-terminal',
        authorityId: attachGapSnapshot.terminalAuthorityId,
        consumerId: 'editor',
        revision: resizeEvent.payload.event.revision
      })).appliedRevision,
      resizeEvent.payload.event.revision,
      'each Host surface must keep an independent monotonic applied watermark on the shared socket.'
    );
    assert.equal(
      (await sendRuntimeSupervisorErrorRequest(socket, messages, 'ackSessionRevision', {
        sessionId: 'attach-gap-terminal',
        authorityId: attachGapSnapshot.terminalAuthorityId,
        consumerId: 'panel',
        revision: scrollbackEvent.payload.event.revision + 1000
      })).error.code,
      'DEV_SESSION_CANVAS_RUNTIME_TERMINAL_REVISION_INVALID',
      'applied ACK must reject a revision the authority has not produced.'
    );
    assert.equal(
      (await sendRuntimeSupervisorErrorRequest(socket, messages, 'ackSessionRevision', {
        sessionId: 'attach-gap-terminal',
        authorityId: 'wrong-authority',
        consumerId: 'panel',
        revision: scrollbackEvent.payload.event.revision
      })).error.code,
      'DEV_SESSION_CANVAS_RUNTIME_TERMINAL_AUTHORITY_MISMATCH',
      'applied ACK must reject another authority.'
    );

    const revisionOrderScriptPath = path.join(tempDir, 'runtime-terminal-revision-order.js');
    const revisionOrderPrimeMarker = 'REVISION-ORDER-PRIME-END';
    const revisionOrderAfterMarker = 'REVISION-ORDER-AFTER-SCROLLBACK';
    await writeFile(
      revisionOrderScriptPath,
      `process.stdin.setEncoding('utf8');
process.stdin.on('data', (data) => {
  if (data.includes('prime')) {
    process.stdout.write('p'.repeat(2 * 1024 * 1024));
    process.stdout.write(${JSON.stringify(`${revisionOrderPrimeMarker}\r\n`)});
    return;
  }
  if (data.includes('after')) {
    process.stdout.write(${JSON.stringify(`${revisionOrderAfterMarker}\r\n`)});
  }
});
setInterval(() => undefined, 1000);
`,
      'utf8'
    );
    const revisionOrderSessionId = 'terminal-revision-publication-order';
    const revisionOrderSnapshot = await sendRuntimeSupervisorRequest(socket, messages, 'createSession', {
      kind: 'terminal',
      sessionId: revisionOrderSessionId,
      displayLabel: 'Revision publication order fixture',
      launchMode: 'start',
      scrollback: 1000,
      deferSubscription: true,
      launchSpec: {
        file: process.execPath,
        args: [revisionOrderScriptPath],
        cwd: tempDir,
        cols: 80,
        rows: 24,
        env: process.env,
        terminalName: 'xterm-256color'
      }
    });
    await sendRuntimeSupervisorRequest(socket, messages, 'subscribeSession', {
      sessionId: revisionOrderSessionId,
      authorityId: revisionOrderSnapshot.terminalAuthorityId,
      afterRevision: revisionOrderSnapshot.terminalRevision
    });
    await sendRuntimeSupervisorRequest(socket, messages, 'writeInput', {
      sessionId: revisionOrderSessionId,
      data: 'prime\n'
    });
    await waitForRuntimeSupervisorOutput(
      messages,
      revisionOrderSessionId,
      revisionOrderPrimeMarker,
      'revision order tracker backlog',
      10000
    );

    const updateScrollbackPromise = sendRuntimeSupervisorRequest(socket, messages, 'updateSessionScrollback', {
      sessionId: revisionOrderSessionId,
      scrollback: 2400
    });
    await sendRuntimeSupervisorRequest(socket, messages, 'writeInput', {
      sessionId: revisionOrderSessionId,
      data: 'after\n'
    });
    await waitForRuntimeSupervisorOutput(
      messages,
      revisionOrderSessionId,
      revisionOrderAfterMarker,
      'output emitted while scrollback tracker update is pending',
      10000
    );
    await updateScrollbackPromise;
    await delay(50);
    const revisionOrderEvents = messages.filter(
      (message) =>
        message.type === 'event' &&
        message.event === 'sessionTerminalEvent' &&
        message.payload?.sessionId === revisionOrderSessionId
    );
    const orderedScrollbackIndex = revisionOrderEvents.findIndex(
      (message) => message.payload.event.type === 'scrollback' && message.payload.event.scrollback === 2400
    );
    const orderedOutputIndex = revisionOrderEvents.findIndex(
      (message) =>
        message.payload.event.type === 'output' &&
        message.payload.event.data.includes(revisionOrderAfterMarker)
    );
    assert.ok(orderedScrollbackIndex >= 0, 'Expected the requested scrollback revision to be published.');
    assert.ok(orderedOutputIndex >= 0, 'Expected output produced during the scrollback update to be published.');
    assert.ok(
      revisionOrderEvents[orderedScrollbackIndex].payload.event.revision <
        revisionOrderEvents[orderedOutputIndex].payload.event.revision,
      'The journal must assign the scrollback revision before later output.'
    );
    const publishedScrollbackBeforeLaterOutput = orderedScrollbackIndex < orderedOutputIndex;
    await sendRuntimeSupervisorRequest(socket, messages, 'deleteSession', {
      sessionId: revisionOrderSessionId
    });

    const finalizationRaceScriptPath = path.join(tempDir, 'runtime-terminal-finalization-race.js');
    const finalizationRaceMarker = 'FINALIZATION-RACE-END';
    await writeFile(
      finalizationRaceScriptPath,
      `process.stdin.setEncoding('utf8');
process.stdin.once('data', () => {
  process.stdout.write('f'.repeat(2 * 1024 * 1024));
  process.stdout.write(${JSON.stringify(`${finalizationRaceMarker}\r\n`)});
  setTimeout(() => process.exit(0), 5);
});
setInterval(() => undefined, 1000);
`,
      'utf8'
    );
    const finalizationRaceSessionId = 'terminal-finalization-resize-race';
    const finalizationRaceSnapshot = await sendRuntimeSupervisorRequest(socket, messages, 'createSession', {
      kind: 'terminal',
      sessionId: finalizationRaceSessionId,
      displayLabel: 'Finalization resize race fixture',
      launchMode: 'start',
      scrollback: 100000,
      deferSubscription: true,
      launchSpec: {
        file: process.execPath,
        args: [finalizationRaceScriptPath],
        cwd: tempDir,
        cols: 96,
        rows: 24,
        env: process.env,
        terminalName: 'xterm-256color'
      }
    });
    await sendRuntimeSupervisorRequest(socket, messages, 'subscribeSession', {
      sessionId: finalizationRaceSessionId,
      authorityId: finalizationRaceSnapshot.terminalAuthorityId,
      afterRevision: finalizationRaceSnapshot.terminalRevision
    });
    await sendRuntimeSupervisorRequest(socket, messages, 'writeInput', {
      sessionId: finalizationRaceSessionId,
      data: 'exit\n'
    });
    await waitForRuntimeSupervisorOutput(
      messages,
      finalizationRaceSessionId,
      finalizationRaceMarker,
      'finalization race output',
      10000
    );
    await delay(25);
    const finalizingResizeResponse = await sendRuntimeSupervisorRawRequest(
      socket,
      messages,
      'resizeSession',
      {
        sessionId: finalizationRaceSessionId,
        cols: 77,
        rows: 19
      }
    );
    const finalizationRaceState = await waitForRuntimeSupervisorMessage(
      messages,
      (message) =>
        message.type === 'event' &&
        message.event === 'sessionState' &&
        message.payload?.sessionId === finalizationRaceSessionId &&
        message.payload.live === false &&
        message.payload.terminalStream?.revision === message.payload.terminalRevision &&
        message.payload.terminalStream.events
          .filter((event) => event.type === 'output')
          .map((event) => event.data)
          .join('')
          .includes(finalizationRaceMarker),
      'finalization race state',
      15000
    );
    assert.deepEqual(
      {
        publishedScrollbackBeforeLaterOutput,
        finalizingResizeRejected:
          finalizingResizeResponse.ok === false &&
          finalizingResizeResponse.error?.code === 'DEV_SESSION_CANVAS_RUNTIME_SESSION_NOT_LIVE'
      },
      {
        publishedScrollbackBeforeLaterOutput: true,
        finalizingResizeRejected: true
      },
      'Supervisor must publish terminal revisions in journal order and reject mutations before one complete final state.'
    );
    assertTerminalStreamSnapshot(finalizationRaceState.payload, 'finalization resize race final snapshot');
    assert.equal(
      finalizationRaceState.payload.terminalStream.revision,
      finalizationRaceState.payload.terminalRevision
    );
    assert.equal(
      finalizationRaceState.payload.serializedTerminalState,
      undefined,
      'finalization should not block on a multi-megabyte semantic checkpoint validation.'
    );
    assert.match(
      finalizationRaceState.payload.terminalStream.events
        .filter((event) => event.type === 'output')
        .map((event) => event.data)
        .join(''),
      new RegExp(finalizationRaceMarker, 'u')
    );
    await sendRuntimeSupervisorRequest(socket, messages, 'deleteSession', {
      sessionId: finalizationRaceSessionId
    });

    const unicodeScriptPath = path.join(tempDir, 'runtime-split-utf8-output.js');
    await writeFile(
      unicodeScriptPath,
      `const chunks = [
  Buffer.concat([Buffer.from('PTY-BYTES:'), Buffer.from([0xe4, 0xb8])]),
  Buffer.from([0xad, 0xe6]),
  Buffer.from([0x96, 0x87, 0xf0, 0x9f]),
  Buffer.concat([Buffer.from([0x9a, 0x80]), Buffer.from(':END\\r\\n')])
];
process.stdin.once('data', async () => {
  for (const chunk of chunks) {
    process.stdout.write(chunk);
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
});
setInterval(() => undefined, 1000);
`,
      'utf8'
    );
    const unicodeSessionId = 'split-utf8-terminal';
    const unicodeSnapshot = await sendRuntimeSupervisorRequest(socket, messages, 'createSession', {
      kind: 'terminal',
      sessionId: unicodeSessionId,
      displayLabel: 'Unicode boundary fixture',
      launchMode: 'start',
      scrollback: 1000,
      deferSubscription: true,
      launchSpec: {
        file: process.execPath,
        args: [unicodeScriptPath],
        cwd: tempDir,
        cols: 80,
        rows: 24,
        env: process.env,
        terminalName: 'xterm-256color'
      }
    });
    await sendRuntimeSupervisorRequest(socket, messages, 'subscribeSession', {
      sessionId: unicodeSessionId,
      authorityId: unicodeSnapshot.terminalAuthorityId,
      afterRevision: unicodeSnapshot.terminalRevision
    });
    await sendRuntimeSupervisorRequest(socket, messages, 'writeInput', {
      sessionId: unicodeSessionId,
      data: 'emit\n'
    });
    const unicodeOutput = await waitForRuntimeSupervisorOutput(
      messages,
      unicodeSessionId,
      'PTY-BYTES:中文🚀:END',
      'split UTF-8 PTY output',
      5000
    );
    assert.match(unicodeOutput, /PTY-BYTES:中文🚀:END/u);
    assert.doesNotMatch(unicodeOutput, /\ufffd/u, 'split UTF-8 PTY bytes must not become replacement characters.');
    const unicodeOutputEvents = messages.filter(
      (message) =>
        message.type === 'event' &&
        message.event === 'sessionTerminalEvent' &&
        message.payload?.sessionId === unicodeSessionId &&
        message.payload.event?.type === 'output' &&
        message.payload.event.data.includes('emit') === false
    );
    assert.ok(unicodeOutputEvents.length >= 3, 'PTY byte fixture must cross multiple Supervisor output revisions.');
    assert.equal(
      unicodeOutputEvents.some((message) => message.payload.event.data.includes('PTY-BYTES:中文🚀:END')),
      false,
      'The exact Unicode marker should be reconstructed across journal events, not arrive as one chunk.'
    );
    const unicodeProjection = await sendRuntimeSupervisorRequest(socket, messages, 'getSessionSnapshot', {
      sessionId: unicodeSessionId
    });
    assertTerminalStreamSnapshot(unicodeProjection, 'split UTF-8 projection snapshot');
    assert.match(unicodeProjection.output, /PTY-BYTES:中文🚀:END/u);
    assert.match(unicodeProjection.serializedTerminalState?.data ?? '', /PTY-BYTES:中文🚀:END/u);
    assert.doesNotMatch(unicodeProjection.serializedTerminalState?.data ?? '', /\ufffd/u);
    await sendRuntimeSupervisorRequest(socket, messages, 'deleteSession', {
      sessionId: unicodeSessionId
    });

    const unsafeCheckpointScriptPath = path.join(tempDir, 'runtime-unsafe-checkpoint.js');
    const safeCheckpointMarker = `SAFE-CHECKPOINT-${Date.now()}`;
    const unsafeSplitPrefix = `UNSAFE-SPLIT-${Date.now()}:`;
    await writeFile(
      unsafeCheckpointScriptPath,
      `const readline = require('node:readline');
const reader = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
reader.on('line', (line) => {
  if (line === 'safe') {
    process.stdout.write(${JSON.stringify(`${safeCheckpointMarker}\r\n`)});
    return;
  }
  if (line === 'split') {
    process.stdout.write(${JSON.stringify(`${unsafeSplitPrefix}\u001b[31`)});
  }
});
setInterval(() => undefined, 1000);
`,
      'utf8'
    );
    const unsafeCheckpointSessionId = 'unsafe-split-csi-checkpoint';
    const unsafeCheckpointInitial = await sendRuntimeSupervisorRequest(socket, messages, 'createSession', {
      kind: 'terminal',
      sessionId: unsafeCheckpointSessionId,
      displayLabel: 'Unsafe split CSI checkpoint fixture',
      launchMode: 'start',
      scrollback: 1000,
      deferSubscription: true,
      launchSpec: {
        file: process.execPath,
        args: [unsafeCheckpointScriptPath],
        cwd: tempDir,
        cols: 80,
        rows: 24,
        env: process.env,
        terminalName: 'xterm-256color'
      }
    });
    await sendRuntimeSupervisorRequest(socket, messages, 'subscribeSession', {
      sessionId: unsafeCheckpointSessionId,
      authorityId: unsafeCheckpointInitial.terminalAuthorityId,
      afterRevision: unsafeCheckpointInitial.terminalRevision
    });
    await sendRuntimeSupervisorRequest(socket, messages, 'writeInput', {
      sessionId: unsafeCheckpointSessionId,
      data: 'safe\n'
    });
    await waitForRuntimeSupervisorOutput(
      messages,
      unsafeCheckpointSessionId,
      safeCheckpointMarker,
      'safe checkpoint fixture output',
      5000
    );
    const safeCheckpointSnapshot = await sendRuntimeSupervisorRequest(
      socket,
      messages,
      'getSessionSnapshot',
      { sessionId: unsafeCheckpointSessionId }
    );
    assertTerminalStreamSnapshot(safeCheckpointSnapshot, 'safe checkpoint fixture snapshot');
    assert.equal(
      safeCheckpointSnapshot.serializedTerminalState?.outputSequence,
      safeCheckpointSnapshot.terminalRevision
    );
    assert.match(
      safeCheckpointSnapshot.serializedTerminalState?.data ?? '',
      new RegExp(safeCheckpointMarker, 'u')
    );

    await sendRuntimeSupervisorRequest(socket, messages, 'writeInput', {
      sessionId: unsafeCheckpointSessionId,
      data: 'split\n'
    });
    await waitForRuntimeSupervisorOutput(
      messages,
      unsafeCheckpointSessionId,
      `${unsafeSplitPrefix}\u001b[31`,
      'unsafe split CSI output',
      5000
    );
    const unsafeCheckpointSnapshot = await sendRuntimeSupervisorRequest(
      socket,
      messages,
      'getSessionSnapshot',
      { sessionId: unsafeCheckpointSessionId }
    );
    assertTerminalStreamSnapshot(unsafeCheckpointSnapshot, 'unsafe split CSI snapshot');
    assert.equal(
      unsafeCheckpointSnapshot.serializedTerminalState,
      undefined,
      'an unsafe parser head must not be published as serializedTerminalState.'
    );
    assert.equal(
      unsafeCheckpointSnapshot.terminalStream.checkpoint.revision,
      safeCheckpointSnapshot.terminalStream.checkpoint.revision,
      'an unsafe parser head must retain the last trusted checkpoint.'
    );
    assert.ok(
      unsafeCheckpointSnapshot.terminalStream.revision >
        unsafeCheckpointSnapshot.terminalStream.checkpoint.revision
    );
    assert.ok(
      unsafeCheckpointSnapshot.terminalStream.events
        .filter((event) => event.type === 'output')
        .map((event) => event.data)
        .join('')
        .includes(`${unsafeSplitPrefix}\u001b[31`),
      'the split CSI must remain losslessly available in the journal suffix.'
    );
    assert.equal(
      unsafeCheckpointSnapshot.terminalCheckpointDiagnostics?.lastRejectionReason,
      'parser-not-ground',
      'a rejected checkpoint must expose the fail-closed reason without terminal content.'
    );
    assert.ok(
      unsafeCheckpointSnapshot.terminalCheckpointDiagnostics?.consecutiveRejectionCount >= 1,
      'a rejected checkpoint must expose its rejection streak.'
    );
    assert.equal(
      unsafeCheckpointSnapshot.terminalCheckpointDiagnostics?.snapshotEventCount,
      unsafeCheckpointSnapshot.terminalStream.events.length,
      'snapshot diagnostics must report replay scale without copying event content into diagnostics.'
    );
    assert.ok(unsafeCheckpointSnapshot.terminalCheckpointDiagnostics?.snapshotEventBytes > 0);
    const unsafeBoundedCheckpoint = await sendRuntimeSupervisorRequest(
      socket,
      messages,
      'getTerminalProjectionCheckpoint',
      { sessionId: unsafeCheckpointSessionId }
    );
    assert.equal(
      unsafeBoundedCheckpoint.terminalStream,
      undefined,
      'a rejected checkpoint refresh must remain bounded and omit the journal suffix.'
    );
    assert.equal(unsafeBoundedCheckpoint.terminalCheckpointDiagnostics?.lastRejectionReason, 'parser-not-ground');
    await sendRuntimeSupervisorRequest(socket, messages, 'deleteSession', {
      sessionId: unsafeCheckpointSessionId
    });

    const codexColorQueryMarker = `CODEX-COLOR-QUERY-${Date.now()}`;
    const codexColorQueryFollowUpMarker = `CODEX-COLOR-FOLLOW-UP-${Date.now()}`;
    const codexColorQueryScriptPath = path.join(tempDir, 'codex-color-query-checkpoint.js');
    await writeFile(
      codexColorQueryScriptPath,
      `const readline = require('node:readline');
const reader = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
reader.on('line', (line) => {
  if (line === 'emit-query') {
    process.stdout.write(${JSON.stringify(`\u001b]10;?\u001b\\\u001b]11;?\u001b\\${codexColorQueryMarker}\\r\\n`)});
    return;
  }
  if (line === 'follow-up') {
    process.stdout.write(${JSON.stringify(`${codexColorQueryFollowUpMarker}\\r\\n`)});
  }
});
setInterval(() => undefined, 1000);
`,
      'utf8'
    );
    const codexColorQuerySessionId = 'codex-color-query-checkpoint';
    const codexColorQueryInitial = await sendRuntimeSupervisorRequest(socket, messages, 'createSession', {
      kind: 'agent',
      sessionId: codexColorQuerySessionId,
      displayLabel: 'Codex color query checkpoint fixture',
      launchMode: 'start',
      scrollback: 1000,
      deferSubscription: true,
      launchSpec: {
        file: process.execPath,
        args: [codexColorQueryScriptPath],
        cwd: tempDir,
        cols: 80,
        rows: 24,
        env: process.env,
        terminalName: 'xterm-256color'
      }
    });
    await sendRuntimeSupervisorRequest(socket, messages, 'subscribeSession', {
      sessionId: codexColorQuerySessionId,
      authorityId: codexColorQueryInitial.terminalAuthorityId,
      afterRevision: codexColorQueryInitial.terminalRevision
    });
    await sendRuntimeSupervisorRequest(socket, messages, 'writeInput', {
      sessionId: codexColorQuerySessionId,
      data: 'emit-query\n'
    });
    await waitForRuntimeSupervisorOutput(
      messages,
      codexColorQuerySessionId,
      codexColorQueryMarker,
      'Codex color-query output',
      5000
    );
    const codexColorQuerySnapshot = await sendRuntimeSupervisorRequest(
      socket,
      messages,
      'getSessionSnapshot',
      { sessionId: codexColorQuerySessionId }
    );
    assertTerminalStreamSnapshot(codexColorQuerySnapshot, 'Codex color-query checkpoint snapshot');
    assert.ok(codexColorQuerySnapshot.serializedTerminalState, 'Codex OSC 10/11 REPORT queries must publish a fresh checkpoint.');
    assert.ok(
      codexColorQuerySnapshot.terminalStream.checkpoint.revision > 0,
      'Codex OSC 10/11 REPORT queries must advance the initial checkpoint.'
    );
    assert.ok(
      codexColorQuerySnapshot.terminalStream.events.length < codexColorQuerySnapshot.terminalStream.revision,
      'a fresh checkpoint must prevent a complete journal suffix from being replayed.'
    );
    assert.equal(codexColorQuerySnapshot.terminalCheckpointDiagnostics?.consecutiveRejectionCount, 0);
    const boundedCheckpoint = await sendRuntimeSupervisorRequest(
      socket,
      messages,
      'getTerminalProjectionCheckpoint',
      { sessionId: codexColorQuerySessionId }
    );
    assert.equal(boundedCheckpoint.terminalStream, undefined, 'bounded refresh must not return the journal suffix.');
    assert.equal(boundedCheckpoint.checkpoint.revision, codexColorQuerySnapshot.terminalStream.checkpoint.revision);
    assert.equal(boundedCheckpoint.terminalCheckpointDiagnostics?.consecutiveRejectionCount, 0);

    await sendRuntimeSupervisorRequest(socket, messages, 'writeInput', {
      sessionId: codexColorQuerySessionId,
      data: 'follow-up\n'
    });
    await waitForRuntimeSupervisorOutput(
      messages,
      codexColorQuerySessionId,
      codexColorQueryFollowUpMarker,
      'Codex color-query follow-up output',
      5000
    );
    const codexColorQueryFollowUpSnapshot = await sendRuntimeSupervisorRequest(
      socket,
      messages,
      'getSessionSnapshot',
      { sessionId: codexColorQuerySessionId }
    );
    assert.ok(
      codexColorQueryFollowUpSnapshot.terminalStream.checkpoint.revision >=
        codexColorQuerySnapshot.terminalStream.checkpoint.revision,
      'later normal output must retain or advance the trusted checkpoint.'
    );
    await sendRuntimeSupervisorRequest(socket, messages, 'deleteSession', {
      sessionId: codexColorQuerySessionId
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
    assertTerminalStreamSnapshot(finalState.payload, 'final sessionState');
    assert.equal(finalState.payload.terminalRevision, finalState.payload.outputSequence);
    assert.equal(
      finalState.payload.terminalTitle,
      undefined,
      'A completed Supervisor snapshot must not retain the previous terminal title.'
    );
    assert.equal(
      finalState.payload.serializedTerminalState,
      undefined,
      'finalization should publish the journal suffix instead of starting a new checkpoint validation after exit.'
    );
    assert.match(
      finalState.payload.terminalStream.events
        .filter((event) => event.type === 'output')
        .map((event) => event.data)
        .join(''),
      new RegExp(marker, 'u'),
      'final sessionState journal suffix should include output written immediately before exit.'
    );
    assert.equal(
      finalState.payload.lastExitMessage,
      'Terminal session ended.',
      'final sessionState should keep an English fallback exit message.'
    );
    assert.deepEqual(
      finalState.payload.lastExitMessageDescriptor,
      {
        id: 'terminalSessionEnded'
      },
      'final sessionState should carry a stable exit message descriptor for Host localization.'
    );

    const storedSession = await waitForRuntimeSupervisorRegistrySession(
      registryPath,
      'immediate-exit-terminal',
      (session) => session.live === false && session.terminalRevision === session.outputSequence
    );
    assert.equal(storedSession.terminalStream, undefined);
    assert.equal(storedSession.serializedTerminalState, undefined);
    assert.ok(storedSession.terminalAuthorityId, 'registry should retain the journal authority lookup key.');
    assert.deepEqual(
      storedSession.lastExitMessageDescriptor,
      {
        id: 'terminalSessionEnded'
      },
      'registry snapshot should persist the stable exit message descriptor.'
    );
    return { marker };
  } finally {
    socket?.destroy();
    supervisor.kill();
    await new Promise((resolve) => {
      supervisor.once('close', resolve);
      setTimeout(resolve, 1000);
    });
  }
}

function assertTerminalStreamSnapshot(snapshot, label) {
  assert.equal(snapshot.terminalStream?.version, 1, `${label} should carry terminal stream v1.`);
  assert.equal(snapshot.terminalStream?.sessionId, snapshot.sessionId);
  assert.equal(snapshot.terminalStream?.authorityId, snapshot.terminalAuthorityId);
  assert.equal(snapshot.terminalStream?.revision, snapshot.terminalRevision);
  assert.equal(snapshot.terminalStream?.checkpoint?.sessionId, snapshot.sessionId);
  assert.equal(snapshot.terminalStream?.checkpoint?.authorityId, snapshot.terminalAuthorityId);
  assert.ok(snapshot.terminalStream.checkpoint.revision <= snapshot.terminalStream.revision);
  assert.equal(
    snapshot.terminalStream.checkpoint.serializedState.outputSequence,
    snapshot.terminalStream.checkpoint.revision
  );
  let expectedRevision = snapshot.terminalStream.checkpoint.revision + 1;
  for (const event of snapshot.terminalStream.events) {
    assert.equal(event.revision, expectedRevision, `${label} terminal journal must be contiguous.`);
    expectedRevision += 1;
  }
  assert.equal(expectedRevision, snapshot.terminalStream.revision + 1);
}

function assertTerminalProjectionMergePreservesConcurrentLiveTail(mergeProjection) {
  const createCheckpoint = (revision) => ({
    version: 1,
    sessionId: 'projection-merge-session',
    authorityId: 'projection-merge-authority',
    revision,
    cols: 80,
    rows: 24,
    scrollback: 1000,
    createdAtMs: revision,
    serializedState: {
      format: 'xterm-serialize-v1',
      data: `checkpoint-${revision}`,
      outputSequence: revision
    }
  });
  const createEvents = (startRevision, endRevision, source) =>
    Array.from({ length: endRevision - startRevision + 1 }, (_value, index) => {
      const revision = startRevision + index;
      return {
        type: 'output',
        revision,
        createdAtMs: revision,
        data: `${source}-${revision}`
      };
    });
  const fresh = {
    version: 1,
    sessionId: 'projection-merge-session',
    authorityId: 'projection-merge-authority',
    revision: 6,
    checkpoint: createCheckpoint(5),
    events: createEvents(6, 6, 'fresh')
  };
  const current = {
    version: 1,
    sessionId: 'projection-merge-session',
    authorityId: 'projection-merge-authority',
    revision: 8,
    checkpoint: createCheckpoint(1),
    events: createEvents(2, 8, 'current')
  };

  const merged = mergeProjection(fresh, current);
  assert.equal(merged?.preservedLiveTailEventCount, 2);
  assert.equal(merged?.payload.checkpoint.revision, 5);
  assert.equal(merged?.payload.revision, 8);
  assert.deepEqual(merged?.payload.events.map((event) => event.revision), [6, 7, 8]);
  assert.deepEqual(merged?.payload.events.map((event) => event.data), ['fresh-6', 'current-7', 'current-8']);

  const gappedCurrent = structuredClone(current);
  gappedCurrent.events.splice(5, 1);
  assert.equal(mergeProjection(fresh, gappedCurrent), undefined);
}

async function assertTenAgentRuntimeCapacity(supervisorOutfile, tempDir) {
  const agentCount = 10;
  const backgroundLineCount = 4000;
  const storageDir = path.join(tempDir, 'runtime-capacity-storage');
  const socketPath =
    process.platform === 'win32'
      ? `\\\\.\\pipe\\dsc-runtime-supervisor-capacity-${process.pid}-${Date.now()}`
      : path.join(storageDir, 'supervisor.sock');
  const registryPath = path.join(storageDir, 'registry.json');
  const providerPath = path.join(tempDir, 'runtime-capacity-provider.js');
  await writeFile(
    providerPath,
    `const readline = require('node:readline');
const prefix = process.argv[2];
const reader = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
reader.on('line', (line) => {
  const floodMatch = /^flood (\\d+)$/.exec(line.trim());
  if (floodMatch) {
    const count = Number(floodMatch[1]);
    for (let index = 0; index < count; index += 1) {
      process.stdout.write(prefix + '-' + String(index).padStart(4, '0') + '-xxxxxxxxxxxx\\n');
    }
    return;
  }
  if (line.startsWith('ping ')) {
    process.stdout.write(line.slice(5) + '\\n');
  }
});
setInterval(() => undefined, 1000);
`,
    'utf8'
  );

  const runtime = await launchRuntimeSupervisorForTest(supervisorOutfile, storageDir, socketPath);
  const sessionRecords = [];
  try {
    const hello = await sendRuntimeSupervisorRequest(runtime.socket, runtime.messages, 'hello');
    assert.equal(hello.capabilities?.terminalSessionStreamV1, true);

    for (let index = 0; index < agentCount; index += 1) {
      const number = String(index + 1).padStart(2, '0');
      const sessionId = `capacity-agent-${number}`;
      const linePrefix = `AG${number}`;
      const snapshot = await sendRuntimeSupervisorRequest(runtime.socket, runtime.messages, 'createSession', {
        kind: 'agent',
        sessionId,
        displayLabel: `Capacity Agent ${number}`,
        launchMode: 'start',
        scrollback: backgroundLineCount + 500,
        deferSubscription: true,
        launchSpec: {
          file: process.execPath,
          args: [providerPath, linePrefix],
          cwd: tempDir,
          cols: 96,
          rows: 28,
          env: process.env,
          terminalName: 'xterm-256color'
        }
      });
      assertTerminalStreamSnapshot(snapshot, `${sessionId} create snapshot`);
      await sendRuntimeSupervisorRequest(runtime.socket, runtime.messages, 'subscribeSession', {
        sessionId,
        authorityId: snapshot.terminalAuthorityId,
        afterRevision: snapshot.terminalRevision
      });
      sessionRecords.push({ sessionId, linePrefix });
    }

    runtime.messages.length = 0;
    const backgroundSessions = sessionRecords.slice(0, -1);
    const inputSession = sessionRecords.at(-1);
    const floodStartedAt = performance.now();
    const supervisorCpuStartedAt = await readProcessCpuTimeMs(runtime.supervisor.pid);
    await Promise.all(
      backgroundSessions.map((session) =>
        sendRuntimeSupervisorRequest(runtime.socket, runtime.messages, 'writeInput', {
          sessionId: session.sessionId,
          data: `flood ${backgroundLineCount}\n`
        })
      )
    );

    const priorityMarker = `${inputSession.linePrefix}-PRIORITY-ECHO`;
    const inputStartedAt = performance.now();
    await sendRuntimeSupervisorRequest(runtime.socket, runtime.messages, 'writeInput', {
      sessionId: inputSession.sessionId,
      data: `ping ${priorityMarker}\n`
    });
    const inputWriteResponseMs = performance.now() - inputStartedAt;
    const priorityOutput = await waitForRuntimeSupervisorOutput(
      runtime.messages,
      inputSession.sessionId,
      priorityMarker,
      '10-agent priority echo event',
      10_000
    );
    const inputEchoMs = performance.now() - inputStartedAt;

    await Promise.all(
      backgroundSessions.map(async (session) => {
        const finalMarker = `${session.linePrefix}-${String(backgroundLineCount - 1).padStart(4, '0')}-xxxxxxxxxxxx`;
        await waitForRuntimeSupervisorOutput(
          runtime.messages,
          session.sessionId,
          finalMarker,
          `${session.sessionId} final capacity event`,
          20_000
        );
      })
    );
    const allOutputCompleteMs = performance.now() - floodStartedAt;
    await delay(50);

    for (const session of backgroundSessions) {
      const events = runtime.messages
        .filter(
          (message) =>
            message.type === 'event' &&
            message.event === 'sessionTerminalEvent' &&
            message.payload?.sessionId === session.sessionId &&
            message.payload.event?.type === 'output'
        )
        .sort((left, right) => left.payload.event.revision - right.payload.event.revision);
      const actualLines = events
        .map((message) => message.payload.event.data)
        .join('')
        .replaceAll('\r', '')
        .split('\n')
        .filter((line) => line.startsWith(`${session.linePrefix}-`));
      const expectedLines = Array.from(
        { length: backgroundLineCount },
        (_value, lineIndex) => `${session.linePrefix}-${String(lineIndex).padStart(4, '0')}-xxxxxxxxxxxx`
      );
      assert.deepEqual(actualLines, expectedLines, `${session.sessionId} output must remain lossless and ordered.`);
    }
    assert.match(priorityOutput, new RegExp(priorityMarker, 'u'));

    const snapshots = [];
    for (const session of sessionRecords) {
      const snapshot = await sendRuntimeSupervisorRequest(runtime.socket, runtime.messages, 'getSessionSnapshot', {
        sessionId: session.sessionId
      });
      assertTerminalStreamSnapshot(snapshot, `${session.sessionId} capacity snapshot`);
      if (session !== inputSession) {
        assert.match(snapshot.serializedTerminalState?.data ?? '', new RegExp(`${session.linePrefix}-0000-`, 'u'));
        assert.match(
          snapshot.serializedTerminalState?.data ?? '',
          new RegExp(`${session.linePrefix}-${String(backgroundLineCount - 1).padStart(4, '0')}-`, 'u')
        );
      } else {
        assert.match(snapshot.serializedTerminalState?.data ?? '', new RegExp(priorityMarker, 'u'));
      }
      snapshots.push(snapshot);
    }

    await Promise.all(
      snapshots.map((snapshot) =>
        waitForRuntimeSupervisorRegistrySession(
          registryPath,
          snapshot.sessionId,
          (stored) => stored.terminalRevision >= snapshot.terminalRevision
        )
      )
    );
    const journalBytes = await directoryByteSize(path.join(storageDir, 'terminal-journals'));
    const registryBytes = (await stat(registryPath)).size;
    const checkpointCharacters = snapshots.reduce(
      (total, snapshot) => total + (snapshot.serializedTerminalState?.data.length ?? 0),
      0
    );
    const benchmarkElapsedMs = performance.now() - floodStartedAt;
    const supervisorCpuEndedAt = await readProcessCpuTimeMs(runtime.supervisor.pid);
    const supervisorCpuMs =
      supervisorCpuStartedAt !== undefined && supervisorCpuEndedAt !== undefined
        ? Math.max(0, supervisorCpuEndedAt - supervisorCpuStartedAt)
        : undefined;
    const totalCharacters = backgroundSessions.length * backgroundLineCount * 23 + priorityMarker.length + 1;
    const metrics = {
      agentCount,
      backgroundLineCount,
      totalCharacters,
      inputWriteResponseMs: Math.round(inputWriteResponseMs * 100) / 100,
      inputEchoMs: Math.round(inputEchoMs * 100) / 100,
      allOutputCompleteMs: Math.round(allOutputCompleteMs * 100) / 100,
      journalBytes,
      registryBytes,
      checkpointCharacters,
      totalRevisions: snapshots.reduce((total, snapshot) => total + (snapshot.terminalRevision ?? 0), 0),
      benchmarkElapsedMs: Math.round(benchmarkElapsedMs * 100) / 100,
      ...(supervisorCpuMs !== undefined
        ? {
            supervisorCpuMs: Math.round(supervisorCpuMs * 100) / 100,
            supervisorCpuUtilizationPercent:
              Math.round((supervisorCpuMs / Math.max(1, benchmarkElapsedMs)) * 10_000) / 100
          }
        : {})
    };

    assert.ok(metrics.inputWriteResponseMs < 500, `10-agent input RPC took ${metrics.inputWriteResponseMs}ms.`);
    assert.ok(metrics.inputEchoMs < 1000, `10-agent input echo took ${metrics.inputEchoMs}ms.`);
    assert.ok(metrics.allOutputCompleteMs < 20_000, `10-agent output took ${metrics.allOutputCompleteMs}ms.`);
    assert.ok(metrics.journalBytes > 0);
    assert.ok(metrics.registryBytes > 0);
    return metrics;
  } finally {
    await Promise.allSettled(
      sessionRecords.map((session) =>
        sendRuntimeSupervisorRequest(runtime.socket, runtime.messages, 'stopSession', {
          sessionId: session.sessionId
        })
      )
    );
    await closeRuntimeSupervisorForTest(runtime);
  }
}

async function directoryByteSize(directoryPath) {
  let entries;
  try {
    entries = await readdir(directoryPath, { withFileTypes: true });
  } catch {
    return 0;
  }

  let total = 0;
  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name);
    total += entry.isDirectory() ? await directoryByteSize(entryPath) : (await stat(entryPath)).size;
  }
  return total;
}

async function readProcessCpuTimeMs(processId) {
  if (process.platform !== 'linux' || !Number.isInteger(processId) || processId <= 0) {
    return undefined;
  }

  if (linuxClockTicksPerSecond === undefined) {
    const result = spawnSync('getconf', ['CLK_TCK'], { encoding: 'utf8' });
    const parsed = Number.parseInt(result.stdout?.trim() ?? '', 10);
    linuxClockTicksPerSecond = Number.isFinite(parsed) && parsed > 0 ? parsed : 100;
  }
  const processStat = await readFile(`/proc/${processId}/stat`, 'utf8');
  const fields = processStat.slice(processStat.lastIndexOf(') ') + 2).trim().split(/\s+/u);
  const userTicks = Number.parseInt(fields[11] ?? '', 10);
  const systemTicks = Number.parseInt(fields[12] ?? '', 10);
  if (!Number.isFinite(userTicks) || !Number.isFinite(systemTicks)) {
    return undefined;
  }
  return ((userTicks + systemTicks) * 1000) / linuxClockTicksPerSecond;
}

async function assertRuntimeSupervisorRestartUsesSavedSnapshot(supervisorOutfile, tempDir, marker) {
  const storageDir = path.join(tempDir, 'runtime-storage');
  const socketPath =
    process.platform === 'win32'
      ? `\\\\.\\pipe\\dsc-runtime-supervisor-restart-${process.pid}-${Date.now()}`
      : path.join(storageDir, 'supervisor.sock');
  const registryPath = path.join(storageDir, 'registry.json');
  const registry = JSON.parse(await readFile(registryPath, 'utf8'));
  const storedSession = registry.sessions.find((candidate) => candidate.sessionId === 'immediate-exit-terminal');
  assert.ok(storedSession?.terminalAuthorityId, 'restart fixture should retain its terminal authority for metadata lookup.');
  delete storedSession.terminalStream;
  delete storedSession.serializedTerminalState;
  await writeFile(registryPath, JSON.stringify(registry, null, 2), 'utf8');

  const attachAndAssertSavedSnapshot = async (label) => {
    const runtime = await launchRuntimeSupervisorForTest(supervisorOutfile, storageDir, socketPath);
    try {
      const hello = await sendRuntimeSupervisorRequest(runtime.socket, runtime.messages, 'hello');
      const snapshot = await attachRecoveredRuntimeSupervisorSession(
        runtime.socket,
        runtime.messages,
        'immediate-exit-terminal'
      );
      assert.equal(hello.recovery?.failureCount ?? 0, 0, `${label} must not fail Journal recovery.`);
      assert.equal(snapshot.live, false, `${label} must not pretend that a dead PTY is live.`);
      assert.equal(snapshot.terminalStream, undefined, `${label} must not replay a terminal stream.`);
      assert.equal(snapshot.serializedTerminalState, undefined, `${label} must preserve the Host-saved projection.`);
      assert.match(snapshot.output, new RegExp(marker, 'u'), `${label} must retain the bounded registry tail.`);
      return snapshot;
    } finally {
      await closeRuntimeSupervisorForTest(runtime);
    }
  };

  await attachAndAssertSavedSnapshot('metadata-only restart snapshot');

  const journalRoot = path.join(storageDir, 'terminal-journals');
  const journalDirectories = await readdir(journalRoot);
  let journalManifestPath;
  let journalSegmentPath;
  for (const directory of journalDirectories) {
    const sessionDirectory = path.join(journalRoot, directory);
    try {
      const manifest = JSON.parse(await readFile(path.join(sessionDirectory, 'manifest.json'), 'utf8'));
      if (manifest.sessionId === 'immediate-exit-terminal') {
        journalManifestPath = path.join(sessionDirectory, 'manifest.json');
        journalSegmentPath = path.join(sessionDirectory, manifest.segments[0].file);
        break;
      }
    } catch {
      // Ignore unrelated or incomplete test directories.
    }
  }
  assert.ok(journalManifestPath && journalSegmentPath, 'restart fixture Journal should exist on disk.');
  const originalManifest = await readFile(journalManifestPath, 'utf8');
  const originalSegment = await readFile(journalSegmentPath, 'utf8');
  assert.match(originalSegment, new RegExp(marker, 'u'));
  await writeFile(journalSegmentPath, originalSegment.replace(marker, 'x'.repeat(marker.length)), 'utf8');
  await attachAndAssertSavedSnapshot('corrupt-segment metadata-only restart snapshot');

  await writeFile(journalManifestPath, '{"invalid":true}\n', 'utf8');
  await attachAndAssertSavedSnapshot('invalid-manifest metadata-only restart snapshot');
  await writeFile(journalManifestPath, originalManifest, 'utf8');
}

async function launchRuntimeSupervisorForTest(supervisorOutfile, storageDir, socketPath) {
  const supervisor = spawn(
    process.execPath,
    [supervisorOutfile, '--storage-dir', storageDir, '--socket-path', socketPath],
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
  const socket = await connectRuntimeSupervisorSocket(socketPath, supervisor, stderrChunks);
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
  return { supervisor, socket, messages };
}

async function closeRuntimeSupervisorForTest(runtime) {
  runtime.socket.destroy();
  runtime.supervisor.kill();
  await new Promise((resolve) => {
    runtime.supervisor.once('close', resolve);
    setTimeout(resolve, 1000);
  });
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
  const response = await sendRuntimeSupervisorRawRequest(socket, messages, method, params);
  assert.equal(response.ok, true, response.error?.message);
  return response.result;
}

async function attachRecoveredRuntimeSupervisorSession(socket, messages, sessionId) {
  const deadline = Date.now() + 5000;
  let lastResponse;
  while (Date.now() < deadline) {
    lastResponse = await sendRuntimeSupervisorRawRequest(socket, messages, 'attachSession', {
      sessionId,
      deferSubscription: true
    });
    if (lastResponse.ok) {
      return lastResponse.result;
    }
    if (lastResponse.error?.descriptor?.id !== 'sessionNotFound') {
      assert.fail(lastResponse.error?.message ?? 'Recovered session attach failed.');
    }
    await delay(20);
  }

  assert.fail(`Timed out waiting for recovered runtime session ${sessionId}: ${JSON.stringify(lastResponse)}`);
}

async function sendRuntimeSupervisorRawRequest(socket, messages, method, params) {
  const id = `runtime-supervisor-test-${++runtimeSupervisorRequestSequence}`;
  socket.write(`${JSON.stringify({
    type: 'request',
    id,
    method,
    ...(params === undefined ? {} : { params })
  })}\n`);
  const response = await waitForRuntimeSupervisorMessage(
    messages,
    (message) => message.type === 'response' && message.id === id,
    `${method} response`
  );
  return response;
}

async function sendRuntimeSupervisorErrorRequest(socket, messages, method, params) {
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
    `${method} error response`
  );
  assert.equal(response.ok, false, `${method} should reject invalid params.`);
  return response;
}

async function waitForRuntimeSupervisorMessage(messages, predicate, label, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
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

async function waitForRuntimeSupervisorOutput(messages, sessionId, marker, label, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const output = messages
      .filter(
        (message) =>
          message.type === 'event' &&
          message.event === 'sessionTerminalEvent' &&
          message.payload?.sessionId === sessionId &&
          message.payload.event?.type === 'output'
      )
      .sort((left, right) => left.payload.event.revision - right.payload.event.revision)
      .map((message) => message.payload.event.data)
      .join('');
    if (output.includes(marker)) {
      return output;
    }
    await delay(10);
  }

  throw new Error(`Timed out waiting for ${label}.`);
}

async function waitForRuntimeSupervisorRegistrySession(registryPath, sessionId, predicate = () => true) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const registry = JSON.parse(await readFile(registryPath, 'utf8'));
      const session = registry.sessions?.find((candidate) => candidate.sessionId === sessionId);
      if (session && predicate(session)) {
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

function waitForPromise(promise, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for ${label}.`));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}
