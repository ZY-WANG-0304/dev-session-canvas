import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import net from 'node:net';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
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
  await assertRuntimeSupervisorClientRejectsNativeIdentityViolations(RuntimeSupervisorClient, tempDir);
  await assertRuntimeSupervisorClientPinsExistingSessionRequests(RuntimeSupervisorClient, tempDir);
  await assertRuntimeSupervisorProjectionClientUsesIndependentSocket(RuntimeSupervisorClient, tempDir);
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
    /private async deleteSession\([\s\S]*?terminalMutationAdmissionOpen = false;[\s\S]*?await this\.enqueueTerminalOperation\(session, async \(\) => \{[\s\S]*?payload:[\s\S]*?await this\.createFreshSnapshot\(session, 'never', false\)[\s\S]*?this\.sessions\.delete\(params\.sessionId\);/u,
    'deleteSession 必须先关闭 mutation admission，并在串行链路收敛 fresh 非 live 终态后再删除共享 backend session。'
  );
  assert.match(
    supervisorSource,
    /private broadcastToSessionSubscribers\([\s\S]*for \(const \[socket, subscriptions\] of this\.subscriptions\.entries\(\)\)/u,
    'runtime supervisor output/state 应向同一 session 的所有订阅 socket 多播。'
  );
  assert.match(
    supervisorSource,
    /type SupervisorSubscriptionMode =[\s\S]*'terminal-stream-v1'[\s\S]*'terminal-stream-with-state-v1'[\s\S]*private subscribeSessionAtSettledRevision\([\s\S]*subscribeSocket\(socket, params\.sessionId, 'terminal-stream-with-state-v1'\)/u,
    '兼容 subscribeSession 必须显式保留 lifecycle，而 bulk live-tail subscription 只能承载 terminal event。'
  );
  assert.match(
    supervisorSource,
    /private broadcastToSessionSubscribers\([\s\S]*message\.event === 'sessionState' && mode === 'terminal-stream-v1'/u,
    'bulk terminal-stream socket 不得重复接收 control socket 已消费的 compact sessionState。'
  );
  assert.match(
    supervisorSource,
    /private async createSession\([\s\S]*await this\.toFreshSnapshot\(session\)[\s\S]*private async attachSession\([\s\S]*return this\.toFreshSnapshot\(session\);/u,
    'runtime supervisor create/attach snapshot 必须先 flush headless terminal，不能发布 stale serializedTerminalState。'
  );
  assert.match(
    supervisorSource,
    /const lifecycle: AgentNodeStatus \| TerminalNodeStatus =[\s\S]*?params\.kind === 'agent'[\s\S]*?: 'live';/u,
    'Terminal PTY spawn 成功后，fresh create 的 compact response 必须直接发布 live，不能依赖可能早于 response 的 output/timer event。'
  );
  assert.match(
    supervisorSource,
    /process = createExecutionSessionProcess\(launchSpec\);[\s\S]*?catch \(error\) \{[\s\S]*?throw createExecutionSpawnProtocolError[\s\S]*?this\.sessions\.set\(sessionId, session\);/u,
    'Supervisor 必须在 PTY spawn 成功返回后才注册 live session；同步 spawn rejection 不得留下可 attach 的 session。'
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
    /private async finalizeSession\([\s\S]*this\.enqueueTerminalOperation\(session, async \(\) => \{[\s\S]*payload: await this\.createFreshSnapshot\(session, 'never', false\)/u,
    'runtime supervisor final sessionState 必须在串行边界内收敛，但不能把完整 projection 回灌 control socket。'
  );
  assert.match(
    supervisorSource,
    /private async persistRegistry\([\s\S]*await Promise\.all\([\s\S]*this\.enqueueTerminalOperation\(session[\s\S]*this\.toSnapshot\(session, undefined, false\)[\s\S]*sessions: snapshots\.filter/u,
    'authority registry 应通过串行轻量 descriptor 持久化，不应每 120ms 内联克隆完整 terminal suffix。'
  );
  const persistRegistryBody = supervisorSource.match(
    /private async persistRegistry[\s\S]*?(?=\n  private |\n  public |\n\}\s*$)/u
  )?.[0] ?? '';
  assert.doesNotMatch(
    persistRegistryBody,
    /toFreshSnapshot\(/u,
    'persistRegistry 不应触发完整 terminal snapshot flush/序列化。'
  );
  assert.match(
    supervisorSource,
    /const titleUpdate = updateSupervisorTerminalTitle\(session, chunk\);[\s\S]*const terminalOutput = titleUpdate\.terminalOutput;[\s\S]*terminalEvent = session\.terminalJournal\?\.appendOutput\(terminalOutput\);[\s\S]*session\.outputSequence = terminalEvent\?\.revision[\s\S]*session\.terminalStateTracker\.write\(terminalOutput, \{[\s\S]*outputSequence: session\.outputSequence[\s\S]*this\.emitSessionOutput\([\s\S]*terminalOutput,[\s\S]*terminalEvent/u,
    'runtime supervisor 必须在 journal 前移除 title payload，并由 journal 为安全输出分配同一 revision。'
  );
  assert.match(
    supervisorSource,
    /private getFreshSerializedTerminalState\([\s\S]*serializedTerminalState\?\.outputSequence[\s\S]*stateOutputSequence === session\.outputSequence[\s\S]*serializedTerminalState[\s\S]*undefined/u,
    'runtime supervisor snapshot 只能携带 outputSequence 对齐的 serializedTerminalState。'
  );
  assert.doesNotMatch(
    supervisorSource,
    /readRegistrySnapshots|recoverRegistryInBackground|normalizeRecoveredSession|readTerminalSessionJournalMetadata/u,
    '新 Supervisor 启动不得读取 registry 或扫描旧 Journal 来恢复已经失去 authority 的 PTY。'
  );
  assert.doesNotMatch(
    supervisorSource,
    /event: 'recoveryState'|recovery: this\.recoveryState/u,
    '新 Supervisor 不得发布 namespace recovery barrier 或 recoveryState 进度。'
  );
  assert.match(
    supervisorSource,
    /private readonly supervisorInstanceId = randomUUID\(\);[\s\S]*supervisorInstanceId: this\.supervisorInstanceId[\s\S]*supervisorInstanceIdentityV1: true/u,
    '每个 Supervisor 进程必须生成稳定于该进程的 instance identity，并通过 hello capability 发布。'
  );
  const projectionOpenStart = supervisorSource.indexOf('  private openTerminalProjection(');
  const projectionReadStart = supervisorSource.indexOf('  private async readTerminalProjection(', projectionOpenStart);
  const projectionSubscribeStart = supervisorSource.indexOf('  private subscribeSession(', projectionOpenStart);
  assert.ok(
    projectionOpenStart >= 0 &&
      projectionReadStart > projectionOpenStart &&
      projectionSubscribeStart > projectionReadStart
  );
  assert.doesNotMatch(
    supervisorSource.slice(projectionOpenStart, projectionReadStart),
    /getEventsAfter|buildTerminalStreamAttachPayload/u,
    'bulk open must pull one pinned event at a time without materializing the journal suffix.'
  );
  const projectionAttachStart = supervisorSource.indexOf('  private async attachSession(');
  const projectionAttachEnd = supervisorSource.indexOf(
    '  private async activateControlSubscriptionWithCatchUp(',
    projectionAttachStart
  );
  const projectionAttachSource = supervisorSource.slice(projectionAttachStart, projectionAttachEnd);
  const metadataProjectionAttachSource = projectionAttachSource.slice(
    0,
    projectionAttachSource.indexOf(
      '    if (params.deferSubscription === true && session.terminalJournal'
    )
  );
  assert.doesNotMatch(
    projectionAttachSource,
    /pinProjection/u,
    'metadata attach must remain lazy and must not pin queued background-node history.'
  );
  assert.match(
    projectionAttachSource,
    /terminalProjectionMode === 'stream-v1'[\s\S]*terminalProjectionTargetRevision/u,
    'metadata attach must return compact control state while omitting projection data.'
  );
  assert.doesNotMatch(
    metadataProjectionAttachSource,
    /subscribeSocket/u,
    'metadata attach must not activate control delivery before its response is written.'
  );
  assert.match(
    supervisorSource,
    /case 'createSession':[\s\S]*?this\.writeMessage\(socket,[\s\S]*?await this\.activateControlSubscriptionWithCatchUp\(socket, snapshot\.sessionId\);[\s\S]*?case 'attachSession':[\s\S]*?this\.writeMessage\(socket,[\s\S]*?await this\.activateControlSubscriptionWithCatchUp\(socket, snapshot\.sessionId\);/u,
    'metadata create/attach must publish the RPC response before activating control delivery.'
  );
  assert.match(
    supervisorSource,
    /private async activateControlSubscriptionWithCatchUp\([\s\S]*enqueueTerminalOperation\(session[\s\S]*subscribeSocket\(socket, sessionId, 'control-only'\)[\s\S]*event: 'sessionState'[\s\S]*toSnapshot\(session, undefined, false\)/u,
    'post-response control activation must immediately send one serialized compact state catch-up.'
  );
  assert.match(
    supervisorSource,
    /stateRevision: 0[\s\S]*advanceSessionStateRevision\(session\)[\s\S]*stateRevision: session\.stateRevision/u,
    'Supervisor compact snapshots must expose a monotonic mutation revision so unchanged catch-up can be discarded.'
  );
  assert.match(
    supervisorSource.slice(projectionOpenStart, projectionSubscribeStart),
    /createFreshSnapshot\(session, 'always', false\)[\s\S]*journal\.pinProjection\(checkpoint, targetRevision\)/u,
    'bulk open must choose and pin its fresh checkpoint/target atomically when scheduled.'
  );
  assert.match(
    supervisorSource,
    /private async readTerminalProjection\([\s\S]*enqueueTerminalOperation\(session[\s\S]*this\.writeMessage\(socket, \{[\s\S]*requestId/u,
    'follow projection reads must be serialized with terminal operations and write the caught-up response inside that boundary.'
  );
  assert.match(
    supervisorSource,
    /if \(stream\.follow\)[\s\S]*const headRevision = journal\.getRevision\(\)[\s\S]*stream\.pin\.extendTargetRevision\(headRevision\)[\s\S]*stream\.targetRevision = headRevision[\s\S]*barrier\.targetRevision = headRevision[\s\S]*subscribeSocket\(socket, stream\.sessionId, 'terminal-stream-v1'\)[\s\S]*releaseTerminalProjectionStream/u,
    'live follow projections must extend their credit-bounded target to the settled journal head before subscribing to live events.'
  );
  assert.match(
    supervisorSource,
    /targetRevision: headRevision[\s\S]*payloadBytes: 0[\s\S]*done: true[\s\S]*live/u,
    'a follow projection may report ready only after the dynamically extended target reaches a settled journal head.'
  );
  assert.doesNotMatch(
    supervisorSource,
    /handoffFollowProjectionToLiveTail|yieldRuntimeSupervisorTurn|TERMINAL_PROJECTION_TAIL_REPLAY/u,
    'follow backlog must not bypass read credit through a separate unacknowledged replay loop.'
  );
  assert.match(
    supervisorSource,
    /terminalProjectionStreamV1: true[\s\S]*terminalProjectionFollowV1: true[\s\S]*private cleanupSocket\([\s\S]*releaseTerminalProjectionStream[\s\S]*terminalProjectionTailBarriers/u,
    'Supervisor must advertise projection streaming and release active streams/tail barriers on socket close.'
  );
  assert.match(
    terminalJournalSource,
    /pinProjection\([\s\S]*projectionPins\.set[\s\S]*readEvent:[\s\S]*this\.events\[revision - firstRevision\][\s\S]*getPinnedProjectionRetentionRevision/u,
    'projection pins must provide O(1) revision reads without cloning a complete suffix.'
  );
  assert.match(
    terminalJournalSource,
    /extendTargetRevision\([\s\S]*pinnedTargetRevision[\s\S]*this\.lastRevision/u,
    'projection pins must support monotonic target extension while retaining the original checkpoint.'
  );
  assert.match(
    terminalJournalSource,
    /releaseMemoryThrough\([\s\S]*getPinnedProjectionRetentionRevision[\s\S]*Math\.min\(revision, pinnedRevision\)[\s\S]*commitCheckpointOnWriteChain\([\s\S]*getPinnedProjectionRetentionRevision/u,
    'active projection pins must constrain both memory release and journal compaction.'
  );
  assert.match(
    terminalJournalSource,
    /\{ source: 'current', reference:[\s\S]*\{ source: 'previous', reference:[\s\S]*candidates\.push\(\{[\s\S]*source: 'genesis'/u,
    'journal recovery candidates 必须按 current、previous、genesis 的保守顺序提供。'
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
  await assertRuntimeSupervisorRestartStartsEmpty(supervisorOutfile, tempDir, runtimeEvidence);
  await assertRuntimeSupervisorRejectedSpawnIsNotRegistered(supervisorOutfile, tempDir);
  await assertRuntimeSupervisorFollowProjection(supervisorOutfile, tempDir);
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
  const legacySessionEvents = [];
  const responseConsumerReadySessionIds = new Set();
  const responseHandoffObservations = [];
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
        if (message.type !== 'request') {
          continue;
        }
        if (message.method === 'createSession' || message.method === 'attachSession') {
          const sessionId = message.params.sessionId;
          socket.write(`${JSON.stringify({
            type: 'response',
            id: message.id,
            ok: true,
            result: {
              sessionId
            }
          })}\n${JSON.stringify({
            type: 'event',
            event: 'sessionState',
            payload: {
              sessionId
            }
          })}\n`);
          continue;
        }
        if (message.method === 'getSessionSnapshot') {
          socket.write(`${JSON.stringify({
            type: 'response',
            id: message.id,
            ok: true,
            result: {
              sessionId: message.params.sessionId
            }
          })}\n${JSON.stringify({
            type: 'event',
            event: 'sessionState',
            payload: {
              sessionId: message.params.sessionId
            }
          })}\n`);
          continue;
        }
        if (message.method === 'writeInput') {
          const sessionId = message.params.sessionId;
          socket.write(`${JSON.stringify({
            type: 'response',
            id: message.id,
            ok: true,
            result: {
              ok: true
            }
          })}\n${JSON.stringify({
            type: 'event',
            event: 'sessionState',
            payload: {
              sessionId
            }
          })}\n`);
          continue;
        }
        if (message.method !== 'hello') {
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
    supervisorLauncherScriptPath: '/unused/runtimeSupervisorLauncher.js',
    onSessionState: (snapshot) => {
      legacySessionEvents.push(snapshot);
      if (snapshot.sessionId.startsWith('response-handoff-')) {
        responseHandoffObservations.push({
          sessionId: snapshot.sessionId,
          consumerReady: responseConsumerReadySessionIds.has(snapshot.sessionId)
        });
      }
    }
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
    await delay(10);
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
    assert.equal(client.supportsSupervisorInstanceIdentity(), false);
    assert.equal(client.supportsTerminalProjectionStream(), false);
    assert.equal(client.getSupervisorInstanceId(), `legacy-pid:${process.pid}`);
    assert.equal((await client.hello()).supervisorInstanceId, `legacy-pid:${process.pid}`);
    const legacySnapshot = await client.getSessionSnapshot({ sessionId: 'legacy-session' });
    assert.equal(legacySnapshot.supervisorInstanceId, `legacy-pid:${process.pid}`);
    assert.equal(legacySessionEvents.length, 1);
    assert.equal(legacySessionEvents[0].supervisorInstanceId, `legacy-pid:${process.pid}`);

    for (const method of ['createSession', 'attachSession']) {
      const sessionId = `response-handoff-${method}`;
      const snapshot = method === 'createSession'
        ? await client.createSession({
            kind: 'terminal',
            sessionId,
            displayLabel: 'Response handoff fixture',
            launchMode: 'start',
            scrollback: 1000,
            deferSubscription: true,
            terminalProjectionMode: 'stream-v1',
            launchSpec: {
              file: process.execPath,
              args: [],
              cwd: tempDir,
              cols: 80,
              rows: 24,
              env: {},
              terminalName: 'xterm-256color'
            }
          })
        : await client.attachSession({
            sessionId,
            deferSubscription: true,
            terminalProjectionMode: 'stream-v1'
          });
      responseConsumerReadySessionIds.add(snapshot.sessionId);
      assert.equal(
        responseHandoffObservations.some((observation) => observation.sessionId === sessionId),
        false,
        `${method} catch-up must not run inside the parser turn that resolves its response.`
      );
      await delay(10);
      assert.deepEqual(
        responseHandoffObservations.find((observation) => observation.sessionId === sessionId),
        { sessionId, consumerReady: true },
        `${method} catch-up must run only after the response consumer can install its binding.`
      );
    }
    const inputSessionId = 'response-handoff-writeInput';
    await client.writeInput({
      sessionId: inputSessionId,
      data: '\r',
      intent: 'submit'
    });
    responseConsumerReadySessionIds.add(inputSessionId);
    assert.equal(
      responseHandoffObservations.some((observation) => observation.sessionId === inputSessionId),
      false,
      'writeInput lifecycle must not run inside the parser turn that resolves its response.'
    );
    await delay(10);
    assert.deepEqual(
      responseHandoffObservations.find((observation) => observation.sessionId === inputSessionId),
      { sessionId: inputSessionId, consumerReady: true },
      'writeInput lifecycle must run only after the response consumer can release its input operation.'
    );
    assert.equal(connectionCount, 1, 'Concurrent readiness callers must share one socket connection.');
    assert.equal(helloRequestCount, 1, 'Concurrent readiness callers must share one hello handshake.');
    await assert.rejects(
      client.createTerminalProjectionClient(),
      /does not support terminal projection streams/u
    );
    assert.equal(connectionCount, 1, 'A legacy Supervisor must not receive a speculative bulk connection.');
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

async function assertRuntimeSupervisorClientRejectsNativeIdentityViolations(
  RuntimeSupervisorClient,
  tempDir
) {
  const socketPath =
    process.platform === 'win32'
      ? `\\\\.\\pipe\\dsc-runtime-client-identity-${process.pid}-${Date.now()}`
      : path.join(tempDir, `runtime-client-identity-${Date.now()}.sock`);
  const nativeInstanceId = `native-instance-${process.pid}`;
  const sockets = new Set();
  let activeSocket;
  let scenario = 'hello-missing';

  const server = net.createServer((socket) => {
    activeSocket = socket;
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
        if (message.type !== 'request') {
          continue;
        }

        if (message.method === 'hello') {
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
                supervisorInstanceIdentityV1: true
              },
              ...(scenario === 'hello-missing' ? {} : { supervisorInstanceId: nativeInstanceId })
            }
          })}\n`);
          continue;
        }

        if (message.method === 'resizeSession') {
          socket.write(`${JSON.stringify({
            type: 'response',
            id: message.id,
            ok: true,
            result: {
              ok: true,
              ...(scenario === 'result-missing' ? {} : { supervisorInstanceId: nativeInstanceId })
            }
          })}\n`);
          continue;
        }

        if (message.method === 'getSessionSnapshot') {
          socket.write(`${JSON.stringify({
            type: 'response',
            id: message.id,
            ok: true,
            result: {
              sessionId: message.params.sessionId,
              supervisorInstanceId:
                scenario === 'result-mismatch' ? `${nativeInstanceId}-other` : nativeInstanceId
            }
          })}\n`);
        }
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

  const assertIdentityProtocolError = (error) => {
    assert.equal(error?.code, 'DEV_SESSION_CANVAS_RUNTIME_SUPERVISOR_PARSE_ERROR');
    assert.equal(error?.descriptor?.id, 'parseError');
    assert.equal(error?.details?.origin, 'protocol');
    assert.match(error?.message ?? '', /supervisor instance identity/u);
    return true;
  };

  const runViolationScenario = async (name, action, handlers = {}) => {
    scenario = name;
    activeSocket = undefined;
    let resolveDisconnected;
    const disconnected = new Promise((resolve) => {
      resolveDisconnected = resolve;
    });
    const client = new RuntimeSupervisorClient({
      backend: {
        kind: 'legacy-detached',
        guarantee: 'best-effort',
        label: 'Identity Test Supervisor',
        paths: {
          storageDir: tempDir,
          socketPath,
          registryPath: path.join(tempDir, 'runtime-client-identity-registry.json'),
          socketLocation: process.platform === 'win32' ? 'named-pipe' : 'storage'
        },
        startSupervisor: async () => assert.fail('Identity protocol violations must not restart the Supervisor.')
      },
      supervisorScriptPath: '/unused/runtimeSupervisorMain.js',
      supervisorLauncherScriptPath: '/unused/runtimeSupervisorLauncher.js',
      ...handlers,
      onDisconnected: (error) => resolveDisconnected(error)
    });

    try {
      await action(client, () => activeSocket);
      const disconnectedError = await waitForPromise(
        disconnected,
        2000,
        `${name} protocol disconnect`
      );
      assertIdentityProtocolError(disconnectedError);
    } finally {
      client.dispose();
    }
  };

  try {
    await runViolationScenario('hello-missing', async (client) => {
      await assert.rejects(
        client.ensureConnected({ allowRestart: false }),
        assertIdentityProtocolError
      );
    });

    await runViolationScenario('result-missing', async (client) => {
      await client.ensureConnected({ allowRestart: false });
      assert.equal(client.getSupervisorInstanceId(), nativeInstanceId);
      await assert.rejects(
        client.resizeSession({ sessionId: 'native-session', cols: 80, rows: 24 }),
        assertIdentityProtocolError
      );
    });

    await runViolationScenario('result-mismatch', async (client) => {
      await client.ensureConnected({ allowRestart: false });
      await assert.rejects(
        client.getSessionSnapshot({ sessionId: 'native-session' }),
        assertIdentityProtocolError
      );
    });

    let outputEventCount = 0;
    await runViolationScenario(
      'event-missing',
      async (client, getSocket) => {
        await client.ensureConnected({ allowRestart: false });
        getSocket().write(`${JSON.stringify({
          type: 'event',
          event: 'sessionOutput',
          payload: {
            sessionId: 'native-session',
            kind: 'terminal',
            chunk: 'must-not-be-delivered'
          }
        })}\n`);
      },
      {
        onSessionOutput: () => {
          outputEventCount += 1;
        }
      }
    );
    assert.equal(outputEventCount, 0, 'Missing native event identity must not reach Host handlers.');

    let stateEventCount = 0;
    await runViolationScenario(
      'event-mismatch',
      async (client, getSocket) => {
        await client.ensureConnected({ allowRestart: false });
        getSocket().write(`${JSON.stringify({
          type: 'event',
          event: 'sessionState',
          payload: {
            sessionId: 'native-session',
            supervisorInstanceId: `${nativeInstanceId}-other`
          }
        })}\n`);
      },
      {
        onSessionState: () => {
          stateEventCount += 1;
        }
      }
    );
    assert.equal(stateEventCount, 0, 'Mismatched native event identity must not reach Host handlers.');
  } finally {
    for (const socket of sockets) {
      socket.destroy();
    }
    await new Promise((resolve) => server.close(resolve));
  }
}

async function assertRuntimeSupervisorClientPinsExistingSessionRequests(
  RuntimeSupervisorClient,
  tempDir
) {
  const socketPath =
    process.platform === 'win32'
      ? `\\\\.\\pipe\\dsc-runtime-client-admission-${process.pid}-${Date.now()}`
      : path.join(tempDir, `runtime-client-admission-${Date.now()}.sock`);
  const originalInstanceId = `request-admission-original-${process.pid}`;
  const replacementInstanceId = `request-admission-replacement-${process.pid}`;
  const sockets = new Set();
  const receivedSessionMethods = [];
  const connectionOrder = [];
  let connectionCount = 0;
  let advertisedInstanceId = originalInstanceId;
  let supervisorStartCount = 0;
  let serverClosed = false;

  const server = net.createServer((socket) => {
    connectionCount += 1;
    if (connectionCount > 1) {
      connectionOrder.push('replacement-connected');
    }
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
        if (message.type !== 'request') {
          continue;
        }
        if (message.method === 'hello') {
          socket.write(`${JSON.stringify({
            type: 'response',
            id: message.id,
            ok: true,
            result: {
              serverVersion: 1,
              pid: process.pid,
              supervisorInstanceId: advertisedInstanceId,
              runtimeBackend: 'legacy-detached',
              runtimeGuarantee: 'best-effort',
              capabilities: {
                supervisorInstanceIdentityV1: true
              }
            }
          })}\n`);
          continue;
        }

        receivedSessionMethods.push(message.method);
        socket.write(`${JSON.stringify({
          type: 'response',
          id: message.id,
          ok: true,
          result: {
            ok: true,
            supervisorInstanceId: advertisedInstanceId
          }
        })}\n`);
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

  let resolveInitialDisconnect;
  const initialDisconnect = new Promise((resolve) => {
    resolveInitialDisconnect = resolve;
  });
  const client = new RuntimeSupervisorClient({
    backend: {
      kind: 'legacy-detached',
      guarantee: 'best-effort',
      label: 'Request Admission Test Supervisor',
      paths: {
        storageDir: tempDir,
        socketPath,
        registryPath: path.join(tempDir, 'runtime-client-admission-registry.json'),
        socketLocation: process.platform === 'win32' ? 'named-pipe' : 'storage'
      },
      startSupervisor: async () => {
        supervisorStartCount += 1;
      }
    },
    supervisorScriptPath: '/unused/runtimeSupervisorMain.js',
    supervisorLauncherScriptPath: '/unused/runtimeSupervisorLauncher.js',
    startupTimeoutMs: 120,
    onDisconnected: (error, supervisorInstanceId) => {
      connectionOrder.push(`disconnected:${supervisorInstanceId ?? '<missing>'}`);
      resolveInitialDisconnect({ error, supervisorInstanceId });
    }
  });

  try {
    await client.ensureConnected({ allowRestart: false });
    assert.equal(client.getSupervisorInstanceId(), originalInstanceId);
    const staleAdmission = client.captureExistingSessionRequestAdmission({
      allowRestart: false,
      expectedSupervisorInstanceId: originalInstanceId
    });

    advertisedInstanceId = replacementInstanceId;
    await assert.rejects(
      client.stopSession({ sessionId: 'force-old-generation-close' }),
      (error) => {
        assert.equal(error?.code, 'DEV_SESSION_CANVAS_RUNTIME_SUPERVISOR_PARSE_ERROR');
        return true;
      }
    );
    receivedSessionMethods.length = 0;
    await client.ensureConnected({ allowRestart: false });
    const disconnected = await waitForPromise(
      initialDisconnect,
      2000,
      'original request-admission socket disconnect'
    );
    assert.equal(disconnected.supervisorInstanceId, originalInstanceId);
    assert.equal(disconnected.error?.details?.origin, 'protocol');
    assert.deepEqual(
      connectionOrder,
      [`disconnected:${originalInstanceId}`, 'replacement-connected'],
      'A replacement socket must attach only after the old generation publishes its disconnect.'
    );
    assert.equal(client.getSupervisorInstanceId(), replacementInstanceId);

    await assert.rejects(
      client.stopSession({ sessionId: 'stale-session' }, staleAdmission),
      (error) => {
        assert.equal(error?.code, 'DEV_SESSION_CANVAS_RUNTIME_SUPERVISOR_CLIENT_DISCONNECTED');
        assert.equal(error?.details?.origin, 'protocol');
        return true;
      }
    );
    assert.equal(client.getSupervisorInstanceId(), replacementInstanceId);
    assert.deepEqual(
      receivedSessionMethods,
      [],
      'A request admitted for the old instance must not be written to a replacement socket generation.'
    );
    assert.equal(supervisorStartCount, 0, 'Existing-session admission must not launch a Supervisor.');

    const disconnectedAdmission = client.captureExistingSessionRequestAdmission({
      allowRestart: false,
      expectedSupervisorInstanceId: replacementInstanceId
    });
    const serverClose = new Promise((resolve) => server.close(resolve));
    for (const socket of sockets) {
      socket.destroy();
    }
    await serverClose;
    serverClosed = true;
    const disconnectDeadline = Date.now() + 2000;
    while (client.getSupervisorInstanceId() !== undefined && Date.now() < disconnectDeadline) {
      await delay(5);
    }
    assert.equal(client.getSupervisorInstanceId(), undefined);
    await assert.rejects(
      client.stopSession({ sessionId: 'disconnected-session' }, disconnectedAdmission),
      (error) => {
        assert.equal(error?.code, 'DEV_SESSION_CANVAS_RUNTIME_SUPERVISOR_CLIENT_NOT_CONNECTED');
        return true;
      }
    );
    assert.equal(
      supervisorStartCount,
      0,
      'A token admitted before disconnect must fail without starting a replacement Supervisor.'
    );
  } finally {
    client.dispose();
    for (const socket of sockets) {
      socket.destroy();
    }
    if (!serverClosed) {
      await new Promise((resolve) => server.close(resolve));
    }
  }
}

async function assertRuntimeSupervisorProjectionClientUsesIndependentSocket(
  RuntimeSupervisorClient,
  tempDir
) {
  const socketPath =
    process.platform === 'win32'
      ? `\\\\.\\pipe\\dsc-runtime-client-projection-${process.pid}-${Date.now()}`
      : path.join(tempDir, `runtime-client-projection-${Date.now()}.sock`);
  const supervisorInstanceId = `projection-instance-${process.pid}`;
  const sockets = new Set();
  const requestConnections = [];
  let connectionCount = 0;
  let supervisorStartCount = 0;
  let controlDisconnectCount = 0;
  let bulkDisconnectCount = 0;
  const bulkTerminalEvents = [];

  const server = net.createServer((socket) => {
    const connectionId = ++connectionCount;
    sockets.add(socket);
    socket.setEncoding('utf8');
    socket.on('close', () => sockets.delete(socket));
    let buffer = '';
    socket.on('data', (data) => {
      buffer += data;
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
        if (message.type !== 'request') {
          continue;
        }
        requestConnections.push({ method: message.method, connectionId });
        let result;
        if (message.method === 'hello') {
          result = {
            serverVersion: 1,
            pid: process.pid,
            supervisorInstanceId,
            runtimeBackend: 'legacy-detached',
            runtimeGuarantee: 'best-effort',
            capabilities: {
              supervisorInstanceIdentityV1: true,
              terminalProjectionStreamV1: true,
              terminalProjectionFollowV1: true
            }
          };
        } else if (message.method === 'openTerminalProjection') {
          result = {
            supervisorInstanceId,
            projectionId: 'projection-client-test',
            sessionId: message.params.sessionId,
            authorityId: message.params.authorityId,
            targetRevision: message.params.targetRevision,
            follow: message.params.follow === true,
            checkpoint: {}
          };
        } else if (message.method === 'readTerminalProjection') {
          const chunk = {
            kind: 'checkpoint',
            dataOffset: 0,
            data: '',
            complete: true
          };
          result = {
            supervisorInstanceId,
            projectionId: message.params.projectionId,
            sessionId: 'projection-session',
            authorityId: 'projection-authority',
            targetRevision: 0,
            payloadBytes: Buffer.byteLength(JSON.stringify(chunk), 'utf8'),
            chunkChecksum: createHash('sha256').update(JSON.stringify(chunk), 'utf8').digest('hex'),
            chunk,
            done: true
          };
        } else {
          result = {
            supervisorInstanceId,
            projectionId: message.params.projectionId,
            cancelled: true
          };
        }
        let response = `${JSON.stringify({
          type: 'response',
          id: message.id,
          ok: true,
          result
        })}\n`;
        if (message.method === 'readTerminalProjection') {
          response += `${JSON.stringify({
            type: 'event',
            event: 'sessionTerminalEvent',
            payload: {
              supervisorInstanceId,
              sessionId: 'projection-session',
              kind: 'terminal',
              authorityId: 'projection-authority',
              event: {
                type: 'output',
                revision: 1,
                createdAtMs: Date.now(),
                data: 'bulk-live-event'
              }
            }
          })}\n`;
        }
        socket.write(response);
      }
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, resolve);
  });

  const client = new RuntimeSupervisorClient({
    backend: {
      kind: 'legacy-detached',
      guarantee: 'best-effort',
      label: 'Projection Client Test Supervisor',
      paths: {
        storageDir: tempDir,
        socketPath,
        registryPath: path.join(tempDir, 'runtime-client-projection-registry.json'),
        socketLocation: process.platform === 'win32' ? 'named-pipe' : 'storage'
      },
      startSupervisor: async () => {
        supervisorStartCount += 1;
      }
    },
    supervisorScriptPath: '/unused/runtimeSupervisorMain.js',
    supervisorLauncherScriptPath: '/unused/runtimeSupervisorLauncher.js',
    onDisconnected: () => {
      controlDisconnectCount += 1;
    }
  });

  let bulkClient;
  try {
    await client.ensureConnected({ allowRestart: false });
    bulkClient = await client.createTerminalProjectionClient({
      onSessionTerminalEvent: (event) => bulkTerminalEvents.push(event),
      onBulkDisconnected: () => {
        bulkDisconnectCount += 1;
      }
    });
    assert.equal(connectionCount, 2, 'Projection transfer must use a second socket.');
    assert.equal(bulkClient.getSupervisorInstanceId(), supervisorInstanceId);
    const opened = await bulkClient.open({
      sessionId: 'projection-session',
      authorityId: 'projection-authority',
      targetRevision: 0
    });
    assert.equal(opened.supervisorInstanceId, supervisorInstanceId);
    assert.equal((await bulkClient.read({
      projectionId: opened.projectionId,
      creditBytes: 256
    })).supervisorInstanceId, supervisorInstanceId);
    assert.equal(
      bulkTerminalEvents.length,
      0,
      'Bulk event callbacks must run after the caught-up read() continuation.'
    );
    await delay(10);
    assert.equal(bulkTerminalEvents.length, 1);
    assert.equal((await bulkClient.cancel({
      projectionId: opened.projectionId
    })).supervisorInstanceId, supervisorInstanceId);
    assert.deepEqual(
      requestConnections
        .filter(({ method }) => method !== 'hello')
        .map(({ connectionId }) => connectionId),
      [2, 2, 2],
      'Projection RPCs must stay on the bulk socket.'
    );

    const bulkSocket = [...sockets][1];
    bulkSocket?.destroy();
    const bulkDisconnectDeadline = Date.now() + 2000;
    while (bulkDisconnectCount === 0 && Date.now() < bulkDisconnectDeadline) {
      await delay(5);
    }
    assert.equal(bulkDisconnectCount, 1, 'Bulk disconnect callback must be scoped to the projection transport.');
    bulkClient.dispose();
    bulkClient = undefined;
    const bulkCloseDeadline = Date.now() + 2000;
    while (sockets.size !== 1 && Date.now() < bulkCloseDeadline) {
      await delay(5);
    }
    assert.equal(sockets.size, 1, 'Closing bulk transport must leave the control socket connected.');
    assert.equal(controlDisconnectCount, 0, 'Bulk disconnect must not notify the control client.');
    assert.equal((await client.hello()).supervisorInstanceId, supervisorInstanceId);
    assert.equal(supervisorStartCount, 0);
  } finally {
    bulkClient?.dispose();
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
    assert.equal(typeof hello.supervisorInstanceId, 'string');
    assert.ok(hello.supervisorInstanceId.length > 0);
    assert.equal(hello.capabilities?.supervisorInstanceIdentityV1, true);
    const repeatedHello = await sendRuntimeSupervisorRequest(socket, messages, 'hello');
    assert.equal(
      repeatedHello.supervisorInstanceId,
      hello.supervisorInstanceId,
      '同一 Supervisor 进程的 instance identity 必须稳定。'
    );
    assert.equal(hello.recovery, undefined, '新 Supervisor 不再发布 namespace recovery barrier。');
    assert.equal(hello.capabilities?.terminalProjectionStreamV1, true);
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
    assert.equal(missingSignalAgentSnapshot.supervisorInstanceId, hello.supervisorInstanceId);
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

    const titleQueryMarker = `TITLE-QUERY-REPLY-${Date.now()}`;
    const titleQueryScriptPath = path.join(tempDir, 'runtime-title-query.js');
    await writeFile(
      titleQueryScriptPath,
      `process.stdin.setEncoding('utf8');
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.resume();
let received = '';
let receivedFirstTitle = false;
process.stdin.on('data', (chunk) => {
  received += chunk;
  if (!receivedFirstTitle && received.includes(${JSON.stringify('\u001b]lFirst title\u001b\\')})) {
    receivedFirstTitle = true;
    process.stdout.write(${JSON.stringify('\u001b]2;\u0007\u001b[21t')});
    return;
  }
  if (receivedFirstTitle && received.includes(${JSON.stringify('\u001b]l\u001b\\')})) {
    process.stdout.write(${JSON.stringify(`${titleQueryMarker}\\r\\n`)});
  }
});
const titleQueryChunks = ${JSON.stringify(['\u001b', ']', '2', ';', 'First title', '\u0007', '\u001b', '[', '2', '1', 't'])};
titleQueryChunks.forEach((chunk, index) => {
  setTimeout(() => process.stdout.write(chunk), index * 20);
});
setInterval(() => undefined, 1000);
`,
      'utf8'
    );
    const titleQuerySessionId = 'terminal-title-query';
    const titleQueryInitial = await sendRuntimeSupervisorRequest(socket, messages, 'createSession', {
      kind: 'terminal',
      sessionId: titleQuerySessionId,
      displayLabel: 'Terminal title query fixture',
      launchMode: 'start',
      scrollback: 1000,
      deferSubscription: true,
      launchSpec: {
        file: process.execPath,
        args: [titleQueryScriptPath],
        cwd: tempDir,
        cols: 80,
        rows: 24,
        env: process.env,
        terminalName: 'xterm-256color'
      }
    });
    await sendRuntimeSupervisorRequest(socket, messages, 'subscribeSession', {
      sessionId: titleQuerySessionId,
      authorityId: titleQueryInitial.terminalAuthorityId,
      afterRevision: titleQueryInitial.terminalRevision
    });
    await waitForRuntimeSupervisorOutput(
      messages,
      titleQuerySessionId,
      titleQueryMarker,
      'CSI 21 t title-query reply',
      5000
    );
    const titleQuerySnapshot = await sendRuntimeSupervisorRequest(
      socket,
      messages,
      'getSessionSnapshot',
      { sessionId: titleQuerySessionId }
    );
    assert.equal(
      titleQuerySnapshot.terminalTitle,
      null,
      'An OSC clear before CSI 21 t must produce an empty report and clear the live title.'
    );
    assert.notEqual(
      titleQuerySnapshot.lifecycle,
      'error',
      'An OSC title introducer split across PTY chunks must not fail the live session journal.'
    );
    assert.equal(
      titleQuerySnapshot.output.includes('First title'),
      false,
      'The Supervisor recent-output tail must not retain an OSC 0/2 title payload.'
    );
    assert.match(
      titleQuerySnapshot.output,
      new RegExp(titleQueryMarker, 'u'),
      'Redacting OSC 0/2 must retain normal terminal output.'
    );
    assert.equal(
      titleQuerySnapshot.terminalStream?.events
        .filter((event) => event.type === 'output')
        .some((event) => event.data.includes('First title')),
      false,
      'The live terminal-stream journal suffix must not retain an OSC 0/2 title payload.'
    );
    await delay(50);
    const titleQueryJournalContent = await readTerminalJournalContent(storageDir, titleQuerySessionId);
    assert.equal(
      titleQueryJournalContent.includes('First title'),
      false,
      'The flushed terminal Journal must not persist an OSC 0/2 title payload.'
    );
    assert.match(
      titleQueryJournalContent,
      new RegExp(titleQueryMarker, 'u'),
      'The flushed terminal Journal must retain regular terminal output around title controls.'
    );
    await sendRuntimeSupervisorRequest(socket, messages, 'deleteSession', {
      sessionId: titleQuerySessionId
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
    assert.equal(attachGapSnapshot.supervisorInstanceId, hello.supervisorInstanceId);
    await sendRuntimeSupervisorRequest(socket, messages, 'writeInput', {
      sessionId: 'attach-gap-terminal',
      data: 'trigger\n'
    });
    await waitForRuntimeSupervisorRegistrySession(
      registryPath,
      'attach-gap-terminal',
      (session) =>
        session.terminalRevision > attachGapSnapshot.terminalRevision &&
        typeof session.output === 'string' &&
        session.output.includes(gapMarker)
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
    assert.equal(replayedGapEvent.payload.supervisorInstanceId, hello.supervisorInstanceId);
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
    const subscribeCatchUpState = await waitForRuntimeSupervisorMessage(
      messages,
      (message) =>
        message.type === 'event' &&
        message.event === 'sessionState' &&
        message.payload?.sessionId === 'attach-gap-terminal' &&
        message.payload.terminalRevision === subscribeResult.revision,
      'attach-gap compact state catch-up'
    );
    assert.equal(subscribeCatchUpState.payload.terminalProjectionIncluded, false);
    assert.equal(subscribeCatchUpState.payload.terminalStream, undefined);
    assert.equal(subscribeCatchUpState.payload.serializedTerminalState, undefined);
    assert.equal(subscribeCatchUpState.payload.terminalRevision, subscribeResult.revision);
    assert.equal(subscribeCatchUpState.payload.supervisorInstanceId, hello.supervisorInstanceId);
    assert.equal(subscribeResult.supervisorInstanceId, hello.supervisorInstanceId);

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
      supervisorInstanceId: hello.supervisorInstanceId,
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
        message.payload.terminalProjectionIncluded === false,
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
    assert.equal(finalizationRaceState.payload.terminalStream, undefined);
    assert.equal(
      finalizationRaceState.payload.serializedTerminalState,
      undefined,
      'finalization control state must remain projection-free.'
    );
    const finalizationRaceProjection = await sendRuntimeSupervisorRequest(
      socket,
      messages,
      'getSessionSnapshot',
      { sessionId: finalizationRaceSessionId }
    );
    assertTerminalStreamSnapshot(finalizationRaceProjection, 'explicit finalization race projection');
    assert.match(
      `${finalizationRaceProjection.terminalStream.checkpoint.serializedState.data}${finalizationRaceProjection.terminalStream.events
        .filter((event) => event.type === 'output')
        .map((event) => event.data)
        .join('')}`,
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
    const safeCheckpointPayload = `${Array.from(
      { length: 220 },
      (_value, index) => `SAFE-BULK-${String(index).padStart(4, '0')}-中文-🧭\r\n`
    ).join('')}${safeCheckpointMarker}\r\n`;
    const unsafeSuffixPayload = `${Array.from(
      { length: 240 },
      (_value, index) => `SUFFIX-BULK-${String(index).padStart(4, '0')}-恢复-🚀\r\n`
    ).join('')}${unsafeSplitPrefix}\u001b[31`;
    const projectionLiveMarker = `PROJECTION-LIVE-${Date.now()}`;
    await writeFile(
      unsafeCheckpointScriptPath,
      `const readline = require('node:readline');
const reader = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
reader.on('line', (line) => {
  if (line === 'safe') {
    process.stdout.write(${JSON.stringify(safeCheckpointPayload)});
    return;
  }
  if (line === 'split') {
    process.stdout.write(${JSON.stringify(unsafeSuffixPayload)});
    return;
  }
  if (line === 'live') {
    process.stdout.write(${JSON.stringify(`m${projectionLiveMarker}\r\n`)});
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

    const projectionAttach = await sendRuntimeSupervisorRequest(socket, messages, 'attachSession', {
      sessionId: unsafeCheckpointSessionId,
      deferSubscription: true,
      terminalProjectionMode: 'stream-v1'
    });
    assert.equal(projectionAttach.supervisorInstanceId, hello.supervisorInstanceId);
    assert.equal(projectionAttach.terminalProjectionIncluded, false);
    assert.equal(projectionAttach.terminalStream, undefined);
    assert.equal(projectionAttach.serializedTerminalState, undefined);
    assert.equal(projectionAttach.terminalAuthorityId, unsafeCheckpointSnapshot.terminalAuthorityId);
    assert.equal(
      projectionAttach.terminalProjectionTargetRevision,
      unsafeCheckpointSnapshot.terminalStream.revision,
      'metadata attach may report its compact revision observation without serializing history.'
    );

    await sendRuntimeSupervisorRequest(socket, messages, 'resizeSession', {
      sessionId: unsafeCheckpointSessionId,
      cols: 86,
      rows: 30
    });

    const bulkRuntime = await connectRuntimeSupervisorMessageSocket(
      socketPath,
      supervisor,
      stderrChunks
    );
    let replacementBulkRuntime;
    try {
      const bulkHello = await sendRuntimeSupervisorRequest(
        bulkRuntime.socket,
        bulkRuntime.messages,
        'hello'
      );
      assert.equal(bulkHello.supervisorInstanceId, hello.supervisorInstanceId);
      assert.equal(bulkHello.capabilities?.terminalProjectionStreamV1, true);
      const openedProjection = await sendRuntimeSupervisorRequest(
        bulkRuntime.socket,
        bulkRuntime.messages,
        'openTerminalProjection',
        {
          sessionId: unsafeCheckpointSessionId
        }
      );
      assert.equal(openedProjection.supervisorInstanceId, hello.supervisorInstanceId);
      assert.equal(
        openedProjection.targetRevision,
        projectionAttach.terminalProjectionTargetRevision + 1,
        'bulk open must choose a fresh target after admission instead of reusing the metadata observation.'
      );
      assert.equal(
        openedProjection.checkpoint.revision,
        unsafeCheckpointSnapshot.terminalStream.checkpoint.revision
      );
      assert.equal('data' in openedProjection.checkpoint.serializedState, false);
      const siblingProjection = await sendRuntimeSupervisorRequest(
        bulkRuntime.socket,
        bulkRuntime.messages,
        'openTerminalProjection',
        {
          sessionId: unsafeCheckpointSessionId,
          authorityId: openedProjection.authorityId
        }
      );
      assert.notEqual(siblingProjection.projectionId, openedProjection.projectionId);
      assert.equal(siblingProjection.targetRevision, openedProjection.targetRevision);
      assert.equal((await sendRuntimeSupervisorRequest(
        bulkRuntime.socket,
        bulkRuntime.messages,
        'readTerminalProjection',
        { projectionId: siblingProjection.projectionId, creditBytes: 256 }
      )).done, false);

      const resizeControlStartedAt = performance.now();
      await sendRuntimeSupervisorRequest(socket, messages, 'resizeSession', {
        sessionId: unsafeCheckpointSessionId,
        cols: 87,
        rows: 31
      });
      assert.ok(performance.now() - resizeControlStartedAt < 500);
      const restoringControlState = await waitForRuntimeSupervisorMessage(
        messages,
        (message) =>
          message.type === 'event' &&
          message.event === 'sessionState' &&
          message.payload?.sessionId === unsafeCheckpointSessionId &&
          message.payload.cols === 87 &&
          message.payload.rows === 31,
        'control-only lifecycle/state during bulk projection'
      );
      assert.equal(restoringControlState.payload.terminalProjectionIncluded, false);
      assert.equal(restoringControlState.payload.terminalStream, undefined);
      assert.equal(restoringControlState.payload.serializedTerminalState, undefined);

      await sendRuntimeSupervisorRequest(socket, messages, 'writeInput', {
        sessionId: unsafeCheckpointSessionId,
        data: 'live\n'
      });
      const streamedProjection = await readTerminalProjectionInChunks(
        bulkRuntime.socket,
        bulkRuntime.messages,
        openedProjection,
        hello.supervisorInstanceId,
        256
      );
      assert.ok(streamedProjection.readCount > 20, 'large projection must require many credit pulls.');
      assert.equal(
        streamedProjection.checkpointData,
        unsafeCheckpointSnapshot.terminalStream.checkpoint.serializedState.data
      );
      assert.deepEqual(
        streamedProjection.events.slice(0, -1),
        unsafeCheckpointSnapshot.terminalStream.events
      );
      assert.deepEqual(
        {
          ...streamedProjection.events.at(-1),
          createdAtMs: '<normalized>'
        },
        {
          type: 'resize',
          revision: openedProjection.targetRevision,
          createdAtMs: '<normalized>',
          cols: 86,
          rows: 30
        },
        'the projection must include the revision created after metadata attach and before bulk open.'
      );
      assert.match(streamedProjection.checkpointData, /SAFE-BULK-0000-中文-🧭/u);
      assert.match(streamedProjection.checkpointData, /SAFE-BULK-0110-中文-🧭/u);
      assert.match(streamedProjection.checkpointData, /SAFE-BULK-0219-中文-🧭/u);
      const streamedSuffix = streamedProjection.events
        .filter((event) => event.type === 'output')
        .map((event) => event.data)
        .join('');
      assert.match(streamedSuffix, /SUFFIX-BULK-0000-恢复-🚀/u);
      assert.match(streamedSuffix, /SUFFIX-BULK-0120-恢复-🚀/u);
      assert.match(streamedSuffix, /SUFFIX-BULK-0239-恢复-🚀/u);
      assert.doesNotMatch(`${streamedProjection.checkpointData}${streamedSuffix}`, /\ufffd/u);
      assert.doesNotMatch(
        `${streamedProjection.checkpointData}${streamedSuffix}`,
        new RegExp(projectionLiveMarker, 'u'),
        'output after the bulk-open target must not leak into the fixed projection.'
      );
      await sendRuntimeSupervisorErrorRequest(
        bulkRuntime.socket,
        bulkRuntime.messages,
        'readTerminalProjection',
        { projectionId: openedProjection.projectionId, creditBytes: 256 }
      );
      assert.equal((await sendRuntimeSupervisorRequest(
        bulkRuntime.socket,
        bulkRuntime.messages,
        'cancelTerminalProjection',
        { projectionId: siblingProjection.projectionId }
      )).cancelled, true, 'cancelling one multiplexed projection must leave its sibling intact.');

      const liveTailMessageStart = messages.length;
      const subscribeAfterProjection = await sendRuntimeSupervisorRequest(
        socket,
        messages,
        'subscribeSession',
        {
          sessionId: unsafeCheckpointSessionId,
          authorityId: openedProjection.authorityId,
          afterRevision: openedProjection.targetRevision
        }
      );
      assert.ok(subscribeAfterProjection.revision > openedProjection.targetRevision);
      await waitForRuntimeSupervisorOutput(
        messages,
        unsafeCheckpointSessionId,
        projectionLiveMarker,
        'projection live tail after fixed target',
        5000
      );
      const liveTailEvents = messages.slice(liveTailMessageStart).filter(
        (message) =>
          message.type === 'event' &&
          message.event === 'sessionTerminalEvent' &&
          message.payload?.sessionId === unsafeCheckpointSessionId &&
          message.payload.event?.revision > openedProjection.targetRevision
      );
      assert.ok(liveTailEvents.length > 0);
      assert.deepEqual(
        liveTailEvents.map((message) => message.payload.event.revision),
        Array.from(
          { length: liveTailEvents.at(-1).payload.event.revision - openedProjection.targetRevision },
          (_value, index) => openedProjection.targetRevision + index + 1
        ),
        'the deferred live tail must remain revision-contiguous after bulk completion.'
      );
      await sendRuntimeSupervisorRequest(socket, messages, 'resizeSession', {
        sessionId: unsafeCheckpointSessionId,
        cols: 88,
        rows: 32
      });
      await waitForRuntimeSupervisorMessage(
        messages,
        (message) =>
          message.type === 'event' &&
          message.event === 'sessionTerminalEvent' &&
          message.payload?.sessionId === unsafeCheckpointSessionId &&
          message.payload.event?.type === 'resize' &&
          message.payload.event.cols === 88 &&
          message.payload.event.rows === 32,
        'compatibility terminal stream resize event'
      );
      await waitForRuntimeSupervisorMessage(
        messages,
        (message) =>
          message.type === 'event' &&
          message.event === 'sessionState' &&
          message.payload?.sessionId === unsafeCheckpointSessionId &&
          message.payload.cols === 88 &&
          message.payload.rows === 32,
        'compatibility terminal stream lifecycle state'
      );
      const cancelAttach = await sendRuntimeSupervisorRequest(socket, messages, 'attachSession', {
        sessionId: unsafeCheckpointSessionId,
        deferSubscription: true,
        terminalProjectionMode: 'stream-v1'
      });
      const cancelProjection = await sendRuntimeSupervisorRequest(
        bulkRuntime.socket,
        bulkRuntime.messages,
        'openTerminalProjection',
        {
          sessionId: unsafeCheckpointSessionId,
          authorityId: cancelAttach.terminalAuthorityId
        }
      );
      await sendRuntimeSupervisorRequest(
        bulkRuntime.socket,
        bulkRuntime.messages,
        'readTerminalProjection',
        { projectionId: cancelProjection.projectionId, creditBytes: 256 }
      );
      const cancelled = await sendRuntimeSupervisorRequest(
        bulkRuntime.socket,
        bulkRuntime.messages,
        'cancelTerminalProjection',
        { projectionId: cancelProjection.projectionId }
      );
      assert.deepEqual(cancelled, {
        supervisorInstanceId: hello.supervisorInstanceId,
        projectionId: cancelProjection.projectionId,
        cancelled: true
      });
      await sendRuntimeSupervisorErrorRequest(
        bulkRuntime.socket,
        bulkRuntime.messages,
        'readTerminalProjection',
        { projectionId: cancelProjection.projectionId, creditBytes: 256 }
      );

      const closeAttach = await sendRuntimeSupervisorRequest(socket, messages, 'attachSession', {
        sessionId: unsafeCheckpointSessionId,
        deferSubscription: true,
        terminalProjectionMode: 'stream-v1'
      });
      await sendRuntimeSupervisorRequest(
        bulkRuntime.socket,
        bulkRuntime.messages,
        'openTerminalProjection',
        {
          sessionId: unsafeCheckpointSessionId,
          authorityId: closeAttach.terminalAuthorityId
        }
      );
      bulkRuntime.socket.destroy();
      await delay(50);

      replacementBulkRuntime = await connectRuntimeSupervisorMessageSocket(
        socketPath,
        supervisor,
        stderrChunks
      );
      const replacementBulkHello = await sendRuntimeSupervisorRequest(
        replacementBulkRuntime.socket,
        replacementBulkRuntime.messages,
        'hello'
      );
      assert.equal(replacementBulkHello.supervisorInstanceId, hello.supervisorInstanceId);
      const replacementAttach = await sendRuntimeSupervisorRequest(socket, messages, 'attachSession', {
        sessionId: unsafeCheckpointSessionId,
        deferSubscription: true,
        terminalProjectionMode: 'stream-v1'
      });
      const replacementProjection = await sendRuntimeSupervisorRequest(
        replacementBulkRuntime.socket,
        replacementBulkRuntime.messages,
        'openTerminalProjection',
        {
          sessionId: unsafeCheckpointSessionId,
          authorityId: replacementAttach.terminalAuthorityId
        }
      );
      assert.equal((await sendRuntimeSupervisorRequest(
        replacementBulkRuntime.socket,
        replacementBulkRuntime.messages,
        'cancelTerminalProjection',
        { projectionId: replacementProjection.projectionId }
      )).cancelled, true, 'bulk socket close must release the prior projection pin.');

      const monolithicAttach = await sendRuntimeSupervisorRequest(socket, messages, 'attachSession', {
        sessionId: unsafeCheckpointSessionId
      });
      assertTerminalStreamSnapshot(monolithicAttach, 'legacy monolithic attach after bulk projection');
    } finally {
      bulkRuntime.socket.destroy();
      replacementBulkRuntime?.socket.destroy();
    }

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
      deferSubscription: true,
      terminalProjectionMode: 'stream-v1',
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
    assert.equal(finalState.payload.supervisorInstanceId, hello.supervisorInstanceId);
    assert.equal(finalState.payload.terminalProjectionIncluded, false);
    assert.equal(finalState.payload.terminalStream, undefined);
    assert.equal(finalState.payload.terminalRevision, finalState.payload.outputSequence);
    assert.equal(
      finalState.payload.terminalTitle,
      undefined,
      'A completed Supervisor snapshot must not retain the previous terminal title.'
    );
    assert.equal(
      finalState.payload.serializedTerminalState,
      undefined,
      'finalization control state must not carry terminal projection data.'
    );
    const explicitFinalProjection = await sendRuntimeSupervisorRequest(
      socket,
      messages,
      'getSessionSnapshot',
      { sessionId: 'immediate-exit-terminal' }
    );
    assertTerminalStreamSnapshot(explicitFinalProjection, 'explicit final projection');
    assert.match(
      `${explicitFinalProjection.terminalStream.checkpoint.serializedState.data}${explicitFinalProjection.terminalStream.events
        .filter((event) => event.type === 'output')
        .map((event) => event.data)
        .join('')}`,
      new RegExp(marker, 'u'),
      'an explicit projection should include output written immediately before exit.'
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
    return { marker, supervisorInstanceId: hello.supervisorInstanceId };
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

async function assertRuntimeSupervisorRestartStartsEmpty(supervisorOutfile, tempDir, evidence) {
  const storageDir = path.join(tempDir, 'runtime-storage');
  const socketPath =
    process.platform === 'win32'
      ? `\\\\.\\pipe\\dsc-runtime-supervisor-restart-${process.pid}-${Date.now()}`
      : path.join(storageDir, 'supervisor.sock');
  const registryPath = path.join(storageDir, 'registry.json');
  const registry = JSON.parse(await readFile(registryPath, 'utf8'));
  const storedSession = registry.sessions.find((candidate) => candidate.sessionId === 'immediate-exit-terminal');
  assert.ok(storedSession?.terminalAuthorityId, 'restart fixture should retain the old authority descriptor.');
  assert.match(storedSession.output, new RegExp(evidence.marker, 'u'));
  assert.ok((await readdir(path.join(storageDir, 'terminal-journals'))).length > 0);

  const runtime = await launchRuntimeSupervisorForTest(supervisorOutfile, storageDir, socketPath);
  try {
    const hello = await sendRuntimeSupervisorRequest(runtime.socket, runtime.messages, 'hello');
    assert.equal(hello.capabilities?.supervisorInstanceIdentityV1, true);
    assert.notEqual(
      hello.supervisorInstanceId,
      evidence.supervisorInstanceId,
      'Supervisor restart 必须生成新的 instance identity。'
    );
    assert.equal(hello.recovery, undefined);

    const attachResponse = await sendRuntimeSupervisorRawRequest(
      runtime.socket,
      runtime.messages,
      'attachSession',
      { sessionId: 'immediate-exit-terminal', deferSubscription: true }
    );
    assert.equal(attachResponse.ok, false, '新 Supervisor 不得恢复旧 registry session。');
    assert.equal(attachResponse.error?.descriptor?.id, 'sessionNotFound');
    assert.equal(
      runtime.messages.some((message) => message.type === 'event' && message.event === 'recoveryState'),
      false,
      '新 Supervisor 启动不得发布 recoveryState。'
    );

    const controlScriptPath = path.join(tempDir, 'runtime-post-restart-control.js');
    await writeFile(controlScriptPath, 'process.stdin.resume();\nsetInterval(() => undefined, 1000);\n', 'utf8');
    const snapshot = await sendRuntimeSupervisorRequest(runtime.socket, runtime.messages, 'createSession', {
      kind: 'terminal',
      sessionId: 'post-restart-control-terminal',
      displayLabel: 'Node',
      launchMode: 'start',
      scrollback: 1000,
      launchSpec: {
        file: process.execPath,
        args: [controlScriptPath],
        cwd: tempDir,
        cols: 80,
        rows: 24,
        env: process.env,
        terminalName: 'xterm-256color'
      }
    });
    assert.equal(snapshot.supervisorInstanceId, hello.supervisorInstanceId);
    const resizeResult = await sendRuntimeSupervisorRequest(runtime.socket, runtime.messages, 'resizeSession', {
      sessionId: snapshot.sessionId,
      cols: 81,
      rows: 25
    });
    assert.equal(resizeResult.supervisorInstanceId, hello.supervisorInstanceId);
    const stopResult = await sendRuntimeSupervisorRequest(runtime.socket, runtime.messages, 'stopSession', {
      sessionId: snapshot.sessionId
    });
    assert.equal(stopResult.supervisorInstanceId, hello.supervisorInstanceId);
  } finally {
    await closeRuntimeSupervisorForTest(runtime);
  }
}

async function assertRuntimeSupervisorRejectedSpawnIsNotRegistered(supervisorOutfile, tempDir) {
  const fakeNodeModulesRoot = path.join(tempDir, 'rejecting-node-pty-modules');
  const fakeNodePtyDirectory = path.join(fakeNodeModulesRoot, 'node-pty');
  await mkdir(fakeNodePtyDirectory, { recursive: true });
  await writeFile(
    path.join(fakeNodePtyDirectory, 'index.js'),
    `module.exports = {
  spawn() {
    const error = new Error('deterministic node-pty spawn rejection');
    error.code = 'ENOENT';
    throw error;
  }
};
`,
    'utf8'
  );

  const storageDir = path.join(tempDir, 'runtime-rejected-spawn-storage');
  const socketPath =
    process.platform === 'win32'
      ? `\\\\.\\pipe\\dsc-runtime-rejected-spawn-${process.pid}-${Date.now()}`
      : path.join(storageDir, 'supervisor.sock');
  const runtime = await launchRuntimeSupervisorForTest(
    supervisorOutfile,
    storageDir,
    socketPath,
    fakeNodeModulesRoot
  );
  try {
    await sendRuntimeSupervisorRequest(runtime.socket, runtime.messages, 'hello');
    const sessionId = 'rejected-spawn-terminal';
    const failedCreate = await sendRuntimeSupervisorErrorRequest(
      runtime.socket,
      runtime.messages,
      'createSession',
      {
        kind: 'terminal',
        sessionId,
        displayLabel: 'Rejected spawn fixture',
        launchMode: 'start',
        scrollback: 1000,
        deferSubscription: true,
        terminalProjectionMode: 'stream-v1',
        launchSpec: {
          file: process.execPath,
          args: [],
          cwd: tempDir,
          cols: 80,
          rows: 24,
          env: process.env,
          terminalName: 'xterm-256color'
        }
      }
    );
    assert.equal(failedCreate.error?.descriptor?.id, 'executionSpawnFailed');
    assert.equal(failedCreate.error?.details?.origin, 'execution-spawn');
    assert.equal(failedCreate.error?.details?.errno, 'ENOENT');
    const missingSession = await sendRuntimeSupervisorErrorRequest(
      runtime.socket,
      runtime.messages,
      'getSessionSnapshot',
      { sessionId }
    );
    assert.equal(
      missingSession.error?.descriptor?.id,
      'sessionNotFound',
      'A synchronously rejected PTY spawn must not register a live Supervisor session.'
    );
  } finally {
    await closeRuntimeSupervisorForTest(runtime);
  }
}

async function assertRuntimeSupervisorFollowProjection(supervisorOutfile, tempDir) {
  const storageDir = path.join(tempDir, 'runtime-follow-storage');
  const socketPath =
    process.platform === 'win32'
      ? `\\\\.\\pipe\\dsc-runtime-follow-${process.pid}-${Date.now()}`
      : path.join(storageDir, 'supervisor.sock');
  const scriptPath = path.join(tempDir, 'runtime-follow-fixture.js');
  const initialMarker = `FOLLOW-INITIAL-${Date.now()}`;
  const tailMarker = `FOLLOW-TAIL-${Date.now()}`;
  const afterLiveMarker = `FOLLOW-AFTER-LIVE-${Date.now()}`;
  const secondTailMarker = `FOLLOW-SECOND-${Date.now()}`;
  const inputOrderAgentSessionId = 'input-response-order-agent';
  const initialPayload = `${Array.from(
    { length: 100 },
    (_value, index) => `INITIAL-${String(index).padStart(4, '0')}-中文-🧭\\r\\n`
  ).join('')}${initialMarker}\\r\\n`;
  const tailPayload = `${Array.from(
    { length: 420 },
    (_value, index) => `TAIL-${String(index).padStart(4, '0')}-恢复-🚀-${'x'.repeat(72)}\\r\\n`
  ).join('')}${tailMarker}\\r\\n`;
  const secondTailPayload = `${Array.from(
    { length: 180 },
    (_value, index) => `SECOND-${String(index).padStart(4, '0')}-多面-🌊\\r\\n`
  ).join('')}${secondTailMarker}\\r\\n`;
  await writeFile(
    scriptPath,
    `const readline = require('node:readline');
const reader = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
reader.on('line', (line) => {
  if (line === 'initial') process.stdout.write(${JSON.stringify(initialPayload)});
  if (line === 'tail') process.stdout.write(${JSON.stringify(tailPayload)});
  if (line === 'after') process.stdout.write(${JSON.stringify(`m${afterLiveMarker}\\r\\n`)});
  if (line === 'second') process.stdout.write(${JSON.stringify(secondTailPayload)});
});
setInterval(() => undefined, 1000);
`,
    'utf8'
  );

  const controlRuntime = await launchRuntimeSupervisorForTest(supervisorOutfile, storageDir, socketPath);
  const stderrChunks = [];
  let bulkRuntime;
  let replacementBulkRuntime;
  try {
    const hello = await sendRuntimeSupervisorRequest(controlRuntime.socket, controlRuntime.messages, 'hello');
    await sendRuntimeSupervisorRequest(controlRuntime.socket, controlRuntime.messages, 'createSession', {
      kind: 'agent',
      sessionId: inputOrderAgentSessionId,
      displayLabel: 'Input response order fixture',
      launchMode: 'start',
      scrollback: 1000,
      provider: 'codex',
      deferSubscription: true,
      terminalProjectionMode: 'stream-v1',
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
    await waitForRuntimeSupervisorMessage(
      controlRuntime.messages,
      (message) =>
        message.type === 'event' &&
        message.event === 'sessionState' &&
        message.payload?.sessionId === inputOrderAgentSessionId,
      'input response order control catch-up'
    );
    const inputOrderStart = controlRuntime.receivedMessages.length;
    await sendRuntimeSupervisorRequest(controlRuntime.socket, controlRuntime.messages, 'writeInput', {
      sessionId: inputOrderAgentSessionId,
      data: 'ignored\r',
      intent: 'submit'
    });
    const inputLifecycleState = await waitForRuntimeSupervisorMessage(
      controlRuntime.messages,
      (message) =>
        message.type === 'event' &&
        message.event === 'sessionState' &&
        message.payload?.sessionId === inputOrderAgentSessionId &&
        message.payload.lifecycle === 'running',
      'post-input compact lifecycle state'
    );
    const inputOrderMessages = controlRuntime.receivedMessages.slice(inputOrderStart);
    const inputResponseIndex = inputOrderMessages.findIndex(
      (message) => message.type === 'response' && message.ok === true && message.result?.ok === true
    );
    const inputLifecycleIndex = inputOrderMessages.indexOf(inputLifecycleState);
    assert.ok(
      inputResponseIndex >= 0 && inputResponseIndex < inputLifecycleIndex,
      'writeInput must put its compact response on the wire before the lifecycle event it triggers.'
    );
    assert.equal(inputLifecycleState.payload.terminalProjectionIncluded, false);
    assert.equal(inputLifecycleState.payload.terminalStream, undefined);
    assert.equal(inputLifecycleState.payload.serializedTerminalState, undefined);
    assert.ok(inputLifecycleState.payload.stateRevision > 0);
    await sendRuntimeSupervisorRequest(controlRuntime.socket, controlRuntime.messages, 'deleteSession', {
      sessionId: inputOrderAgentSessionId
    });

    const session = await sendRuntimeSupervisorRequest(controlRuntime.socket, controlRuntime.messages, 'createSession', {
      kind: 'terminal',
      sessionId: 'follow-credit-terminal',
      displayLabel: 'Follow credit fixture',
      launchMode: 'start',
      scrollback: 1000,
      deferSubscription: true,
      terminalProjectionMode: 'stream-v1',
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
    assert.equal(
      session.lifecycle,
      'live',
      'A successfully spawned fresh Terminal must be live in its compact create response.'
    );
    assert.equal(session.terminalProjectionIncluded, false);
    assert.equal(session.terminalStream, undefined);
    assert.equal(session.supervisorInstanceId, hello.supervisorInstanceId);
    const createCatchUpState = await waitForRuntimeSupervisorMessage(
      controlRuntime.messages,
      (message) =>
        message.type === 'event' &&
        message.event === 'sessionState' &&
        message.payload?.sessionId === session.sessionId,
      'metadata create compact state catch-up'
    );
    assert.equal(createCatchUpState.payload.terminalProjectionIncluded, false);
    assert.equal(createCatchUpState.payload.terminalStream, undefined);
    assert.equal(createCatchUpState.payload.serializedTerminalState, undefined);
    assert.equal(
      createCatchUpState.payload.stateRevision,
      session.stateRevision,
      'an unchanged response/catch-up pair must carry the same compact state revision.'
    );
    const createResponseIndex = controlRuntime.receivedMessages.findIndex(
      (message) =>
        message.type === 'response' &&
        message.ok === true &&
        message.result?.sessionId === session.sessionId
    );
    const createCatchUpIndex = controlRuntime.receivedMessages.indexOf(createCatchUpState);
    assert.ok(
      createResponseIndex >= 0 && createResponseIndex < createCatchUpIndex,
      'metadata create must write its response before activating compact control state delivery.'
    );

    await sendRuntimeSupervisorRequest(controlRuntime.socket, controlRuntime.messages, 'writeInput', {
      sessionId: session.sessionId,
      data: 'initial\n'
    });
    let metadataSnapshot;
    const metadataDeadline = Date.now() + 5000;
    while (Date.now() < metadataDeadline) {
      metadataSnapshot = await sendRuntimeSupervisorRequest(
        controlRuntime.socket,
        controlRuntime.messages,
        'attachSession',
        {
          sessionId: session.sessionId,
          deferSubscription: true,
          terminalProjectionMode: 'stream-v1'
        }
      );
      if (metadataSnapshot.output.includes(initialMarker)) {
        break;
      }
      await delay(20);
    }
    assert.match(metadataSnapshot?.output ?? '', new RegExp(initialMarker, 'u'));
    const controlEventStart = controlRuntime.receivedMessages?.length ?? controlRuntime.messages.length;

    bulkRuntime = await connectRuntimeSupervisorMessageSocket(
      socketPath,
      controlRuntime.supervisor,
      stderrChunks
    );
    const bulkHello = await sendRuntimeSupervisorRequest(bulkRuntime.socket, bulkRuntime.messages, 'hello');
    assert.equal(bulkHello.supervisorInstanceId, hello.supervisorInstanceId);
    const opened = await sendRuntimeSupervisorRequest(
      bulkRuntime.socket,
      bulkRuntime.messages,
      'openTerminalProjection',
      {
        sessionId: session.sessionId,
        authorityId: metadataSnapshot.terminalAuthorityId,
        follow: true
      }
    );
    assert.equal(opened.follow, true);

    await sendRuntimeSupervisorRequest(controlRuntime.socket, controlRuntime.messages, 'writeInput', {
      sessionId: session.sessionId,
      data: 'tail\n'
    });
    await waitForRuntimeSupervisorSnapshotOutput(
      controlRuntime,
      session.sessionId,
      tailMarker,
      'tail output before follow projection drain'
    );
    const tailProjection = await readFollowTerminalProjectionInChunks(
      bulkRuntime.socket,
      bulkRuntime.messages,
      opened,
      hello.supervisorInstanceId,
      256
    );
    assert.ok(tailProjection.readCount > 20, 'follow projection must remain credit bounded.');
    assert.ok(
      tailProjection.liveResult.targetRevision > opened.targetRevision,
      'a follow projection must extend its target when output arrives after open but before catch-up.'
    );
    assert.match(tailProjection.output, new RegExp(initialMarker, 'u'));
    assert.match(
      tailProjection.output,
      new RegExp(tailMarker, 'u'),
      'post-open backlog must remain inside the credit-bounded projection before ready.'
    );
    assert.equal(
      (controlRuntime.receivedMessages ?? controlRuntime.messages)
        .slice(controlEventStart)
        .some((message) =>
          message.type === 'event' &&
          message.event === 'sessionTerminalEvent' &&
          message.payload?.sessionId === session.sessionId
        ),
      false,
      'control-only socket must not receive the long R+1..T tail during restore.'
    );
    const caughtUpResponseIndex = bulkRuntime.receivedMessages.findIndex(
      (message) =>
        message.type === 'response' &&
        message.ok === true &&
        message.result?.projectionId === opened.projectionId &&
        message.result?.done === true &&
        message.result?.live === true
    );
    assert.ok(caughtUpResponseIndex >= 0);
    assert.equal(
      bulkRuntime.receivedMessages.slice(0, caughtUpResponseIndex + 1).some(
        (message) =>
          message.type === 'event' &&
          message.event === 'sessionTerminalEvent' &&
          message.payload?.sessionId === session.sessionId &&
          message.payload.event?.type === 'output' &&
          message.payload.event.data.includes(tailMarker)
      ),
      false,
      'post-open backlog must not be replayed as an uncredited live terminal event.'
    );

    await sendRuntimeSupervisorRequest(controlRuntime.socket, controlRuntime.messages, 'writeInput', {
      sessionId: session.sessionId,
      data: 'after\n'
    });
    const afterLiveEvent = await waitForReceivedTerminalMarker(
      bulkRuntime.receivedMessages,
      session.sessionId,
      afterLiveMarker
    );
    assert.ok(
      caughtUpResponseIndex < afterLiveEvent.index,
      'caught-up response must be written before the first live terminal event.'
    );

    const lifecycleIsolationStart = bulkRuntime.receivedMessages.length;
    await sendRuntimeSupervisorRequest(controlRuntime.socket, controlRuntime.messages, 'resizeSession', {
      sessionId: session.sessionId,
      cols: 91,
      rows: 33
    });
    await waitForRuntimeSupervisorMessage(
      controlRuntime.messages,
      (message) =>
        message.type === 'event' &&
        message.event === 'sessionState' &&
        message.payload?.sessionId === session.sessionId &&
        message.payload.cols === 91 &&
        message.payload.rows === 33,
      'control lifecycle after bulk follow handoff'
    );
    await waitForRuntimeSupervisorMessage(
      bulkRuntime.messages,
      (message) =>
        message.type === 'event' &&
        message.event === 'sessionTerminalEvent' &&
        message.payload?.sessionId === session.sessionId &&
        message.payload.event?.type === 'resize' &&
        message.payload.event.cols === 91 &&
        message.payload.event.rows === 33,
      'bulk terminal event after follow handoff'
    );
    assert.equal(
      bulkRuntime.receivedMessages.slice(lifecycleIsolationStart).some(
        (message) =>
          message.type === 'event' &&
          message.event === 'sessionState' &&
          message.payload?.sessionId === session.sessionId
      ),
      false,
      'a caught-up bulk socket must not parse duplicate compact lifecycle snapshots.'
    );

    const secondOpened = await sendRuntimeSupervisorRequest(
      bulkRuntime.socket,
      bulkRuntime.messages,
      'openTerminalProjection',
      {
        sessionId: session.sessionId,
        authorityId: opened.authorityId,
        follow: true
      }
    );
    await sendRuntimeSupervisorRequest(controlRuntime.socket, controlRuntime.messages, 'writeInput', {
      sessionId: session.sessionId,
      data: 'second\n'
    });
    await waitForRuntimeSupervisorSnapshotOutput(
      controlRuntime,
      session.sessionId,
      secondTailMarker,
      'second tail output before follow projection drain'
    );
    const secondProjection = await readFollowTerminalProjectionInChunks(
      bulkRuntime.socket,
      bulkRuntime.messages,
      secondOpened,
      hello.supervisorInstanceId,
      256
    );
    assert.equal(secondProjection.liveResult.live, true);
    assert.ok(
      secondProjection.liveResult.targetRevision > secondOpened.targetRevision,
      'each follow projection must extend independently to output written after its open boundary.'
    );
    assert.match(
      secondProjection.output,
      new RegExp(secondTailMarker, 'u'),
      'the second post-open tail must be delivered by credit-bounded projection chunks.'
    );

    const fixedOpened = await sendRuntimeSupervisorRequest(
      bulkRuntime.socket,
      bulkRuntime.messages,
      'openTerminalProjection',
      {
        sessionId: session.sessionId,
        authorityId: opened.authorityId,
        follow: false
      }
    );
    assert.equal(fixedOpened.follow, false);
    const fixedProjection = await readTerminalProjectionInChunks(
      bulkRuntime.socket,
      bulkRuntime.messages,
      fixedOpened,
      hello.supervisorInstanceId,
      256
    );
    assert.ok(fixedProjection.readCount > 0);

    const disconnectOpened = await sendRuntimeSupervisorRequest(
      bulkRuntime.socket,
      bulkRuntime.messages,
      'openTerminalProjection',
      {
        sessionId: session.sessionId,
        authorityId: opened.authorityId,
        follow: true
      }
    );
    await sendRuntimeSupervisorRequest(
      bulkRuntime.socket,
      bulkRuntime.messages,
      'readTerminalProjection',
      { projectionId: disconnectOpened.projectionId, creditBytes: 256 }
    );
    bulkRuntime.socket.destroy();
    await delay(80);
    const controlAfterBulkClose = await sendRuntimeSupervisorRequest(
      controlRuntime.socket,
      controlRuntime.messages,
      'getSessionSnapshot',
      { sessionId: session.sessionId }
    );
    assert.equal(controlAfterBulkClose.supervisorInstanceId, hello.supervisorInstanceId);

    replacementBulkRuntime = await connectRuntimeSupervisorMessageSocket(
      socketPath,
      controlRuntime.supervisor,
      stderrChunks
    );
    const replacementHello = await sendRuntimeSupervisorRequest(
      replacementBulkRuntime.socket,
      replacementBulkRuntime.messages,
      'hello'
    );
    assert.equal(replacementHello.supervisorInstanceId, hello.supervisorInstanceId);
    const replacementProjection = await sendRuntimeSupervisorRequest(
      replacementBulkRuntime.socket,
      replacementBulkRuntime.messages,
      'openTerminalProjection',
      {
        sessionId: session.sessionId,
        authorityId: opened.authorityId,
        follow: false
      }
    );
    assert.equal(replacementProjection.authorityId, opened.authorityId);
    await sendRuntimeSupervisorRequest(
      replacementBulkRuntime.socket,
      replacementBulkRuntime.messages,
      'cancelTerminalProjection',
      { projectionId: replacementProjection.projectionId }
    );
    await sendRuntimeSupervisorRequest(controlRuntime.socket, controlRuntime.messages, 'deleteSession', {
      sessionId: session.sessionId
    });
  } finally {
    bulkRuntime?.socket.destroy();
    replacementBulkRuntime?.socket.destroy();
    await closeRuntimeSupervisorForTest(controlRuntime);
  }
}

async function readFollowTerminalProjectionInChunks(
  socket,
  messages,
  openedProjection,
  supervisorInstanceId,
  creditBytes
) {
  let checkpointData = '';
  let checkpointComplete = false;
  let currentOutputData = '';
  let currentOutputRevision;
  let expectedRevision = openedProjection.checkpoint.revision + 1;
  let targetRevision = openedProjection.targetRevision;
  let output = '';
  let readCount = 0;
  while (readCount < 100000) {
    const result = await sendRuntimeSupervisorRequest(socket, messages, 'readTerminalProjection', {
      projectionId: openedProjection.projectionId,
      creditBytes
    });
    readCount += 1;
    assert.equal(result.supervisorInstanceId, supervisorInstanceId);
    assert.equal(result.projectionId, openedProjection.projectionId);
    assert.equal(result.sessionId, openedProjection.sessionId);
    assert.equal(result.authorityId, openedProjection.authorityId);
    assert.ok(result.targetRevision >= targetRevision);
    targetRevision = result.targetRevision;
    if (result.live === true) {
      assert.equal(result.done, true);
      assert.equal(result.chunk, undefined);
      assert.equal(result.payloadBytes, 0);
      assert.equal(expectedRevision, result.targetRevision + 1);
      return { readCount, output, liveResult: result, checkpointData };
    }

    assert.equal(result.done, false);
    assert.ok(result.chunk);
    assert.equal(result.payloadBytes, Buffer.byteLength(JSON.stringify(result.chunk), 'utf8'));
    assert.equal(
      result.chunkChecksum,
      createHash('sha256').update(JSON.stringify(result.chunk), 'utf8').digest('hex')
    );
    assert.ok(result.payloadBytes <= creditBytes);
    const chunk = result.chunk;
    if (chunk.kind === 'checkpoint') {
      assert.equal(checkpointComplete, false);
      assert.equal(chunk.dataOffset, checkpointData.length);
      checkpointData += chunk.data;
      checkpointComplete = chunk.complete;
      output += chunk.data;
    } else if (chunk.kind === 'output') {
      assert.equal(checkpointComplete, true);
      if (currentOutputRevision === undefined) {
        assert.equal(chunk.revision, expectedRevision);
        assert.equal(chunk.dataOffset, 0);
        currentOutputRevision = chunk.revision;
      }
      assert.equal(chunk.revision, currentOutputRevision);
      assert.equal(chunk.dataOffset, currentOutputData.length);
      currentOutputData += chunk.data;
      output += chunk.data;
      if (chunk.complete) {
        currentOutputRevision = undefined;
        currentOutputData = '';
        expectedRevision += 1;
      }
    } else {
      assert.equal(checkpointComplete, true);
      assert.equal(currentOutputRevision, undefined);
      assert.equal(chunk.revision, expectedRevision);
      expectedRevision += 1;
    }
  }
  assert.fail('Follow terminal projection did not catch up within 100,000 credit pulls.');
}

async function waitForRuntimeSupervisorSnapshotOutput(
  runtime,
  sessionId,
  marker,
  label,
  timeoutMs = 5000
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snapshot = await sendRuntimeSupervisorRequest(
      runtime.socket,
      runtime.messages,
      'attachSession',
      {
        sessionId,
        deferSubscription: true,
        terminalProjectionMode: 'stream-v1'
      }
    );
    if (snapshot.output.includes(marker)) {
      return snapshot;
    }
    await delay(20);
  }
  assert.fail(`Timed out waiting for ${label}.`);
}

async function waitForReceivedTerminalMarker(receivedMessages, sessionId, marker, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const index = receivedMessages.findIndex(
      (message) =>
        message.type === 'event' &&
        message.event === 'sessionTerminalEvent' &&
        message.payload?.sessionId === sessionId &&
        message.payload.event?.type === 'output' &&
        message.payload.event.data.includes(marker)
    );
    if (index >= 0) {
      return { index, message: receivedMessages[index] };
    }
    await delay(10);
  }
  throw new Error(`Timed out waiting for bulk live marker ${marker}.`);
}

async function readTerminalJournalContent(storageDir, sessionId) {
  const journalRoot = path.join(storageDir, 'terminal-journals');
  const journalDirectories = await readdir(journalRoot);
  for (const directory of journalDirectories) {
    const sessionDirectory = path.join(journalRoot, directory);
    try {
      const manifest = JSON.parse(await readFile(path.join(sessionDirectory, 'manifest.json'), 'utf8'));
      if (manifest.sessionId !== sessionId || !Array.isArray(manifest.segments)) {
        continue;
      }
      const segments = await Promise.all(
        manifest.segments.map((segment) => readFile(path.join(sessionDirectory, segment.file), 'utf8'))
      );
      return segments.join('');
    } catch {
      // Ignore unrelated Journal directories while the test process is still writing.
    }
  }
  assert.fail(`Expected terminal Journal for ${sessionId}.`);
}

async function launchRuntimeSupervisorForTest(
  supervisorOutfile,
  storageDir,
  socketPath,
  nodePath = path.resolve('node_modules')
) {
  const supervisor = spawn(
    process.execPath,
    [supervisorOutfile, '--storage-dir', storageDir, '--socket-path', socketPath],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_PATH: nodePath
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
  const receivedMessages = [];
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
        const message = JSON.parse(line);
        messages.push(message);
        receivedMessages.push(message);
      }
    }
  });
  return { supervisor, socket, messages, receivedMessages };
}

async function connectRuntimeSupervisorMessageSocket(socketPath, supervisor, stderrChunks) {
  const socket = await connectRuntimeSupervisorSocket(socketPath, supervisor, stderrChunks);
  socket.setEncoding('utf8');
  const messages = [];
  const receivedMessages = [];
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
      if (line) {
        const message = JSON.parse(line);
        messages.push(message);
        receivedMessages.push(message);
      }
    }
  });
  return { socket, messages, receivedMessages };
}

async function readTerminalProjectionInChunks(
  socket,
  messages,
  openedProjection,
  supervisorInstanceId,
  creditBytes
) {
  let checkpointData = '';
  let checkpointComplete = false;
  let currentOutputEvent;
  let expectedRevision = openedProjection.checkpoint.revision + 1;
  const events = [];
  let readCount = 0;
  while (readCount < 10000) {
    const result = await sendRuntimeSupervisorRequest(socket, messages, 'readTerminalProjection', {
      projectionId: openedProjection.projectionId,
      creditBytes
    });
    readCount += 1;
    assert.equal(result.supervisorInstanceId, supervisorInstanceId);
    assert.equal(result.projectionId, openedProjection.projectionId);
    assert.equal(result.sessionId, openedProjection.sessionId);
    assert.equal(result.authorityId, openedProjection.authorityId);
    assert.equal(result.targetRevision, openedProjection.targetRevision);
    assert.ok(result.chunk, 'each projection pull must make progress with one chunk.');
    assert.equal(result.payloadBytes, Buffer.byteLength(JSON.stringify(result.chunk), 'utf8'));
    assert.equal(
      result.chunkChecksum,
      createHash('sha256').update(JSON.stringify(result.chunk), 'utf8').digest('hex')
    );
    assert.ok(result.payloadBytes <= creditBytes);

    const chunk = result.chunk;
    if (chunk.kind === 'checkpoint') {
      assert.equal(checkpointComplete, false, 'checkpoint chunks must precede journal events.');
      assert.equal(chunk.dataOffset, checkpointData.length);
      assert.equal(
        chunk.dataOffset === 0 || !splitsUtf16PairForTest(checkpointData + chunk.data, chunk.dataOffset),
        true
      );
      checkpointData += chunk.data;
      checkpointComplete = chunk.complete;
    } else if (chunk.kind === 'output') {
      assert.equal(checkpointComplete, true, 'journal output must follow the complete checkpoint.');
      if (!currentOutputEvent) {
        assert.equal(chunk.revision, expectedRevision);
        assert.equal(chunk.dataOffset, 0);
        currentOutputEvent = {
          type: 'output',
          revision: chunk.revision,
          createdAtMs: chunk.createdAtMs,
          data: ''
        };
      }
      assert.equal(chunk.revision, currentOutputEvent.revision);
      assert.equal(chunk.createdAtMs, currentOutputEvent.createdAtMs);
      assert.equal(chunk.dataOffset, currentOutputEvent.data.length);
      currentOutputEvent.data += chunk.data;
      if (chunk.complete) {
        events.push(currentOutputEvent);
        currentOutputEvent = undefined;
        expectedRevision += 1;
      }
    } else {
      assert.equal(checkpointComplete, true, 'journal metadata must follow the complete checkpoint.');
      assert.equal(currentOutputEvent, undefined, 'an output event cannot be interleaved with metadata.');
      assert.equal(chunk.revision, expectedRevision);
      events.push(chunk.kind === 'resize'
        ? {
            type: 'resize',
            revision: chunk.revision,
            createdAtMs: chunk.createdAtMs,
            cols: chunk.cols,
            rows: chunk.rows
          }
        : {
            type: 'scrollback',
            revision: chunk.revision,
            createdAtMs: chunk.createdAtMs,
            scrollback: chunk.scrollback
          });
      expectedRevision += 1;
    }

    if (result.done) {
      assert.equal(checkpointComplete, true);
      assert.equal(currentOutputEvent, undefined);
      assert.equal(expectedRevision, openedProjection.targetRevision + 1);
      return { checkpointData, events, readCount };
    }
  }
  assert.fail('Terminal projection did not complete within 10,000 credit pulls.');
}

function splitsUtf16PairForTest(data, offset) {
  if (offset <= 0 || offset >= data.length) {
    return false;
  }
  const previous = data.charCodeAt(offset - 1);
  const next = data.charCodeAt(offset);
  return previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff;
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
