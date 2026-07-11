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
    getRuntimeSupervisorErrorDescriptor,
    serializeRuntimeSupervisorError
  } = require(protocolOutfile);
  const { mergeTerminalStreamProjectionWithLiveTail } = require(terminalSessionStreamOutfile);

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
    descriptor: sessionNotFoundDescriptor
  });
  const restoredTypedError = createRuntimeSupervisorError(typedPayload);
  assert.equal(restoredTypedError.message, 'Runtime session missing-session was not found.');
  assert.equal(restoredTypedError.code, 'DEV_SESSION_CANVAS_RUNTIME_SESSION_NOT_FOUND');
  assert.deepEqual(getRuntimeSupervisorErrorDescriptor(restoredTypedError), sessionNotFoundDescriptor);
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
    /private async createSession\([\s\S]*await this\.toFreshSnapshot\(session\)[\s\S]*private async attachSession\([\s\S]*return this\.toFreshSnapshot\(session\);/u,
    'runtime supervisor create/attach snapshot 必须先 flush headless terminal，不能发布 stale serializedTerminalState。'
  );
  assert.match(
    supervisorSource,
    /const checkpointCols = session\.cols;[\s\S]*const checkpointRows = session\.rows;[\s\S]*const checkpointScrollback = session\.scrollback;[\s\S]*await session\.terminalStateTracker\.flush\(\)/u,
    'checkpoint 必须在 tracker flush 前固定 cols、rows 与 scrollback，避免把较早 revision 的 state 与较新几何混合。'
  );
  assert.match(
    supervisorSource,
    /deferSocketSubscription\([\s\S]*deferredSubscriptionRevisions[\s\S]*releaseTerminalJournalMemoryThroughCheckpoint/u,
    'deferred attach 必须 pin 静态 revision，避免 checkpoint 刷新提前释放 attach gap 事件。'
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
    /TerminalSessionJournal\.open\([\s\S]*const allEvents = await terminalJournal\.readAllEvents\(\);[\s\S]*for \(const event of allEvents\)[\s\S]*terminalCheckpoint = normalizeTerminalStreamCheckpoint\(\{/u,
    '带 authority 的 registry 恢复必须从完整 journal 校验并重放，不能从 raw tail 猜测终端状态。'
  );
  assert.match(
    supervisorSource,
    /initialState: recoveredAuthorityId \? undefined : snapshot\.serializedTerminalState,[\s\S]*initialOutput: recoveredAuthorityId \? undefined : snapshot\.output/u,
    'authority journal 恢复失败时必须拒绝 serialized/raw tail fallback。'
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
  await assertRuntimeSupervisorRestartUsesJournal(supervisorOutfile, tempDir, runtimeEvidence.marker);
  const capacityMetrics = await assertTenAgentRuntimeCapacity(supervisorOutfile, tempDir);

  console.log(`[10-agent-supervisor-capacity] ${JSON.stringify(capacityMetrics)}`);
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

    const hello = await sendRuntimeSupervisorRequest(socket, messages, 'hello');
    assert.equal(hello.capabilities?.terminalSessionStreamV1, true);
    assert.equal(hello.capabilities?.terminalProjectionSnapshotV1, true);
    assert.equal(hello.capabilities?.terminalAppliedRevisionAckV1, true);

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
      (session) => session.terminalStream?.checkpoint?.revision > attachGapSnapshot.terminalRevision
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
      finalState.payload.serializedTerminalState?.outputSequence,
      finalState.payload.outputSequence,
      'final sessionState should carry a serialized terminal state fresh to the final output sequence.'
    );
    assert.match(
      finalState.payload.serializedTerminalState?.data ?? '',
      new RegExp(marker, 'u'),
      'final sessionState serialized terminal state should include output written immediately before exit.'
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
      (session) =>
        session.live === false &&
        session.serializedTerminalState?.data?.includes(marker) === true
    );
    assertTerminalStreamSnapshot(storedSession, 'registry snapshot');
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

async function assertRuntimeSupervisorRestartUsesJournal(supervisorOutfile, tempDir, marker) {
  const storageDir = path.join(tempDir, 'runtime-storage');
  const socketPath =
    process.platform === 'win32'
      ? `\\\\.\\pipe\\dsc-runtime-supervisor-restart-${process.pid}-${Date.now()}`
      : path.join(storageDir, 'supervisor.sock');
  const registryPath = path.join(storageDir, 'registry.json');
  const registry = JSON.parse(await readFile(registryPath, 'utf8'));
  const storedSession = registry.sessions.find((candidate) => candidate.sessionId === 'immediate-exit-terminal');
  assert.ok(storedSession?.terminalAuthorityId, 'restart fixture should retain its terminal authority.');
  delete storedSession.terminalStream;
  delete storedSession.serializedTerminalState;
  await writeFile(registryPath, JSON.stringify(registry, null, 2), 'utf8');

  const firstRestart = await launchRuntimeSupervisorForTest(supervisorOutfile, storageDir, socketPath);
  try {
    const rebuiltSnapshot = await sendRuntimeSupervisorRequest(
      firstRestart.socket,
      firstRestart.messages,
      'attachSession',
      {
        sessionId: 'immediate-exit-terminal',
        deferSubscription: true
      }
    );
    assertTerminalStreamSnapshot(rebuiltSnapshot, 'journal-only restart snapshot');
    assert.match(
      rebuiltSnapshot.terminalStream.checkpoint.serializedState.data,
      new RegExp(marker, 'u'),
      'a missing checkpoint cache must rebuild from the complete journal.'
    );
  } finally {
    await closeRuntimeSupervisorForTest(firstRestart);
  }

  const journalRoot = path.join(storageDir, 'terminal-journals');
  const journalDirectories = await readdir(journalRoot);
  let journalSegmentPath;
  for (const directory of journalDirectories) {
    const sessionDirectory = path.join(journalRoot, directory);
    try {
      const manifest = JSON.parse(await readFile(path.join(sessionDirectory, 'manifest.json'), 'utf8'));
      if (manifest.sessionId === 'immediate-exit-terminal') {
        journalSegmentPath = path.join(sessionDirectory, manifest.segments[0].file);
        break;
      }
    } catch {
      // Ignore unrelated or incomplete test directories.
    }
  }
  assert.ok(journalSegmentPath, 'restart fixture journal segment should exist.');
  const journalData = await readFile(journalSegmentPath, 'utf8');
  assert.match(journalData, new RegExp(marker, 'u'));
  await writeFile(journalSegmentPath, journalData.replace(marker, 'x'.repeat(marker.length)), 'utf8');

  const corruptedRestart = await launchRuntimeSupervisorForTest(supervisorOutfile, storageDir, socketPath);
  try {
    const failedClosedSnapshot = await sendRuntimeSupervisorRequest(
      corruptedRestart.socket,
      corruptedRestart.messages,
      'attachSession',
      {
        sessionId: 'immediate-exit-terminal',
        deferSubscription: true
      }
    );
    assert.equal(failedClosedSnapshot.terminalStream, undefined);
    assert.equal(failedClosedSnapshot.terminalAuthorityId, undefined);
    assert.equal(failedClosedSnapshot.output, '');
    assert.doesNotMatch(failedClosedSnapshot.serializedTerminalState?.data ?? '', new RegExp(marker, 'u'));
    assert.equal(failedClosedSnapshot.lastExitMessageDescriptor?.id, 'terminalJournalPersistenceFailed');
  } finally {
    await closeRuntimeSupervisorForTest(corruptedRestart);
  }
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
  assert.equal(response.ok, true, response.error?.message);
  return response.result;
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
