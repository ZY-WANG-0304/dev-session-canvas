import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import esbuild from 'esbuild';

const STREAM_ARCHIVE_MEMORY_CHILD_FLAG = '--stream-archive-memory-child';

if (process.argv[2] === STREAM_ARCHIVE_MEMORY_CHILD_FLAG) {
  await runStreamingArchiveMemoryChild(process.argv[3], process.argv[4]);
} else {
const tempDir = await mkdtemp(path.join(os.tmpdir(), 'dsc-completed-terminal-history-archive-'));

try {
  const storeBundlePath = path.join(tempDir, 'CompletedTerminalHistoryArchiveStore.cjs');
  const descriptorBundlePath = path.join(tempDir, 'terminalHistoryArchive.cjs');
  await Promise.all([
    esbuild.build({
      entryPoints: [
        path.resolve(
          'extensions/vscode/dev-session-canvas/src/panel/CompletedTerminalHistoryArchiveStore.ts'
        )
      ],
      bundle: true,
      format: 'cjs',
      outfile: storeBundlePath,
      platform: 'node',
      target: 'node18'
    }),
    esbuild.build({
      entryPoints: [
        path.resolve('extensions/vscode/dev-session-canvas/src/common/terminalHistoryArchive.ts')
      ],
      bundle: true,
      format: 'cjs',
      outfile: descriptorBundlePath,
      platform: 'node',
      target: 'node18'
    })
  ]);

  const require = createRequire(import.meta.url);
  const {
    CompletedTerminalHistoryArchiveError,
    CompletedTerminalHistoryArchiveProjectionReader,
    CompletedTerminalHistoryArchiveStore,
    mergeCompletedTerminalHistoryArchiveDirectories
  } = require(storeBundlePath);
  const {
    COMPLETED_TERMINAL_HISTORY_ARCHIVE_CODEC,
    normalizeCompletedTerminalHistoryArchiveDescriptor
  } = require(descriptorBundlePath);

  const extensionStoragePath = path.join(tempDir, 'extension-storage');
  const store = new CompletedTerminalHistoryArchiveStore(extensionStoragePath);
  const payload = createPayload('completed-session-a', 'authority-a', 'alpha');

  assert.equal(
    existsSync(extensionStoragePath),
    false,
    'constructing the store must not touch extension storage.'
  );
  const described = store.describe(payload);
  const describedFilePath = store.resolveArchiveFilePath(described);
  assert.equal(
    existsSync(extensionStoragePath),
    false,
    'describing a payload and resolving its path must not read or create archive storage.'
  );
  assert.equal(described.version, 1);
  assert.equal(described.codec, COMPLETED_TERMINAL_HISTORY_ARCHIVE_CODEC);
  assert.equal(described.sessionId, payload.sessionId);
  assert.equal(described.authorityId, payload.authorityId);
  assert.equal(described.finalRevision, payload.revision);
  assert.match(described.archiveId, /^sha256-[a-f0-9]{64}$/u);
  assert.equal(described.archiveId, `sha256-${described.sha256}`);
  assert.deepEqual(
    normalizeCompletedTerminalHistoryArchiveDescriptor({ ...described, ignored: true }),
    described,
    'descriptor normalization must return only the bounded known fields.'
  );
  assert.equal(
    normalizeCompletedTerminalHistoryArchiveDescriptor({
      ...described,
      archiveId: `sha256-${'0'.repeat(64)}`
    }),
    undefined,
    'the content address and checksum must not diverge.'
  );
  assert.equal(
    normalizeCompletedTerminalHistoryArchiveDescriptor({
      ...described,
      projectionCodec: 'terminal-stream-projection-ndjson-v1'
    }),
    undefined,
    'projection descriptors must include byte length and checksum as one atomic group.'
  );
  assert.equal(
    normalizeCompletedTerminalHistoryArchiveDescriptor({
      ...described,
      projectionCodec: 'terminal-stream-projection-ndjson-v1',
      projectionByteLength: 0,
      projectionSha256: described.sha256
    }),
    undefined,
    'projection descriptor byte lengths must be positive safe integers.'
  );

  const written = await store.write(payload);
  assert.equal(written.archiveId, described.archiveId);
  assert.equal(written.sha256, described.sha256);
  assert.equal(written.byteLength, described.byteLength);
  assert.notEqual(written.projectionCodec, undefined);
  assert.equal(store.resolveArchiveFilePath(written), describedFilePath);
  assert.equal((await stat(describedFilePath)).size, described.byteLength);
  assert.equal(createHash('sha256').update(await readFile(describedFilePath)).digest('hex'), described.sha256);
  assert.deepEqual(await store.read(written), payload);
  assert.equal(written.projectionCodec, 'terminal-stream-projection-ndjson-v1');
  assert.equal(
    createHash('sha256').update(
      await readFile(store.resolveArchiveProjectionFilePath(written))
    ).digest('hex'),
    written.projectionSha256
  );
  assert.deepEqual(
    await store.ensureProjectionSidecar(written),
    written,
    'a descriptor with a valid sidecar must be reusable without canonical payload parsing.'
  );
  const escapingPayload = createPayload(
    'completed-session-escaping',
    'authority-escaping',
    'quote"slash\\escape'
  );
  escapingPayload.checkpoint.serializedState.data = 'line\n\tcontrol\u0001 lone\ud800 pair😀';
  escapingPayload.events[0].data = 'quote" slash\\ line\r\n pair😀';
  const escapingDescriptor = await store.write(escapingPayload);
  assert.deepEqual(
    {
      version: escapingDescriptor.version,
      archiveId: escapingDescriptor.archiveId,
      codec: escapingDescriptor.codec,
      sessionId: escapingDescriptor.sessionId,
      authorityId: escapingDescriptor.authorityId,
      finalRevision: escapingDescriptor.finalRevision,
      byteLength: escapingDescriptor.byteLength,
      sha256: escapingDescriptor.sha256
    },
    store.describe(escapingPayload),
    'streamed canonical JSON materialization must remain byte-identical to JSON.stringify.'
  );
  assert.deepEqual(await store.read(escapingDescriptor), escapingPayload);
  const projectionReader = await store.openProjection(written);
  const projectionOpen = await projectionReader.open();
  assert.equal(projectionOpen.sessionId, payload.sessionId);
  assert.equal(projectionOpen.targetRevision, payload.revision);
  assert.equal(projectionOpen.checkpoint.revision, payload.checkpoint.revision);
  const projectionChunks = [];
  while (true) {
    const projectionResult = await projectionReader.read(256);
    if (projectionResult.chunk) {
      projectionChunks.push(projectionResult.chunk);
    }
    if (projectionResult.done) {
      break;
    }
  }
  await projectionReader.close();
  assert.equal(projectionChunks[0].kind, 'checkpoint');
  assert.equal(projectionChunks.at(-1).kind, 'resize');
  assert.equal(
    projectionChunks.filter((chunk) => chunk.kind === 'output').map((chunk) => chunk.data).join(''),
    payload.events[0].data
  );

  const largePayload = structuredClone(payload);
  largePayload.sessionId = 'completed-session-large';
  largePayload.authorityId = 'authority-large';
  largePayload.checkpoint.sessionId = largePayload.sessionId;
  largePayload.checkpoint.authorityId = largePayload.authorityId;
  largePayload.checkpoint.serializedState.data = '😀'.repeat(20_000);
  largePayload.events[0].data = '历史'.repeat(20_000);
  const largeDescriptor = await store.write(largePayload);
  const largeReader = await store.openProjection(largeDescriptor);
  const largeOpen = await largeReader.open();
  const largeCheckpoint = [];
  const largeOutput = [];
  while (true) {
    const result = await largeReader.read(256);
    if (result.chunk?.kind === 'checkpoint') {
      largeCheckpoint.push(result.chunk.data);
    } else if (result.chunk?.kind === 'output') {
      largeOutput.push(result.chunk.data);
    }
    if (result.done) {
      break;
    }
  }
  await largeReader.close();
  assert.equal(largeOpen.checkpoint.revision, largePayload.checkpoint.revision);
  assert.equal(largeCheckpoint.join(''), largePayload.checkpoint.serializedState.data);
  assert.equal(largeOutput.join(''), largePayload.events[0].data);

  const streamedPayload = createStreamingParityPayload();
  const legacyStreamStore = new CompletedTerminalHistoryArchiveStore(
    path.join(tempDir, 'legacy-stream-parity-extension-storage')
  );
  const legacyStreamDescriptor = await legacyStreamStore.write(streamedPayload);
  const legacyCanonicalBytes = await readFile(
    legacyStreamStore.resolveArchiveFilePath(legacyStreamDescriptor)
  );
  const legacyProjectionBytes = await readFile(
    legacyStreamStore.resolveArchiveProjectionFilePath(legacyStreamDescriptor)
  );
  for (const creditBytes of [257, 32 * 1024, 64 * 1024]) {
    const streamedStore = new CompletedTerminalHistoryArchiveStore(
      path.join(tempDir, `stream-parity-${creditBytes}-extension-storage`)
    );
    const { source, state } = createFixedProjectionSource(streamedPayload, { creditBytes });
    const streamedDescriptor = await streamedStore.writeProjectionStream(source);
    assert.deepEqual(
      streamedDescriptor,
      legacyStreamDescriptor,
      `streaming with ${creditBytes} bytes of credit must preserve the complete descriptor.`
    );
    assert.equal(state.openCalls, 1);
    assert.equal(state.cancelCalls, 0);
    assert.deepEqual(
      await readFile(streamedStore.resolveArchiveFilePath(streamedDescriptor)),
      legacyCanonicalBytes,
      `streaming with ${creditBytes} bytes of credit must preserve canonical bytes.`
    );
    assert.deepEqual(
      await readFile(streamedStore.resolveArchiveProjectionFilePath(streamedDescriptor)),
      legacyProjectionBytes,
      `transport chunks must not affect the deterministic sidecar at ${creditBytes} bytes of credit.`
    );
    assert.deepEqual(await streamedStore.read(streamedDescriptor), streamedPayload);
    await assertNoArchiveStaging(streamedStore);
  }
  const emptyCheckpointPayload = createStreamFailurePayload('empty-checkpoint-success');
  const emptyCheckpointLegacyStore = new CompletedTerminalHistoryArchiveStore(
    path.join(tempDir, 'empty-checkpoint-legacy-storage')
  );
  const emptyCheckpointStreamStore = new CompletedTerminalHistoryArchiveStore(
    path.join(tempDir, 'empty-checkpoint-stream-storage')
  );
  const emptyCheckpointLegacyDescriptor = await emptyCheckpointLegacyStore.write(
    emptyCheckpointPayload
  );
  const emptyCheckpointStreamDescriptor = await emptyCheckpointStreamStore.writeProjectionStream(
    createFixedProjectionSource(emptyCheckpointPayload, { creditBytes: 257 }).source
  );
  assert.deepEqual(
    emptyCheckpointStreamDescriptor,
    emptyCheckpointLegacyDescriptor,
    'an empty checkpoint must retain byte-identical canonical and sidecar archives.'
  );
  assert.deepEqual(
    await emptyCheckpointStreamStore.read(emptyCheckpointStreamDescriptor),
    emptyCheckpointPayload
  );
  const legacyCanonicalStatsBeforeSidecarRepair = await stat(
    legacyStreamStore.resolveArchiveFilePath(legacyStreamDescriptor),
    { bigint: true }
  );
  await rm(legacyStreamStore.resolveArchiveProjectionFilePath(legacyStreamDescriptor));
  const repairedStreamDescriptor = await legacyStreamStore.writeProjectionStream(
    createFixedProjectionSource(streamedPayload, { creditBytes: 257 }).source
  );
  assert.deepEqual(repairedStreamDescriptor, legacyStreamDescriptor);
  assert.deepEqual(
    await readFile(legacyStreamStore.resolveArchiveProjectionFilePath(repairedStreamDescriptor)),
    legacyProjectionBytes,
    'streaming finalization must atomically restore a missing sidecar beside a valid canonical blob.'
  );
  assert.equal(
    (await stat(legacyStreamStore.resolveArchiveFilePath(repairedStreamDescriptor), { bigint: true })).ino,
    legacyCanonicalStatsBeforeSidecarRepair.ino,
    'installing a streamed sidecar must not replace the existing canonical blob.'
  );

  await assertRejectedProjectionStream({
    tempDir,
    StoreConstructor: CompletedTerminalHistoryArchiveStore,
    ErrorConstructor: CompletedTerminalHistoryArchiveError,
    label: 'bad-checksum',
    expectedCode: 'invalid-payload',
    sourceOptions: {
      transformResult(result, { readIndex }) {
        return readIndex === 0 ? { ...result, chunkChecksum: '0'.repeat(64) } : result;
      }
    }
  });
  let changedRevision = false;
  await assertRejectedProjectionStream({
    tempDir,
    StoreConstructor: CompletedTerminalHistoryArchiveStore,
    ErrorConstructor: CompletedTerminalHistoryArchiveError,
    label: 'revision-gap',
    expectedCode: 'invalid-payload',
    sourceOptions: {
      transformChunk(chunk) {
        if (!changedRevision && chunk.kind === 'output') {
          changedRevision = true;
          return { ...chunk, revision: chunk.revision + 1 };
        }
        return chunk;
      }
    }
  });
  await assertRejectedProjectionStream({
    tempDir,
    StoreConstructor: CompletedTerminalHistoryArchiveStore,
    ErrorConstructor: CompletedTerminalHistoryArchiveError,
    label: 'source-throw',
    expectedCode: 'archive-io',
    sourceOptions: { throwAfterReads: 1 }
  });
  await assertRejectedProjectionStream({
    tempDir,
    StoreConstructor: CompletedTerminalHistoryArchiveStore,
    ErrorConstructor: CompletedTerminalHistoryArchiveError,
    label: 'eof-before-done',
    expectedCode: 'invalid-payload',
    sourceOptions: { omitDone: true }
  });
  await assertRejectedProjectionStream({
    tempDir,
    StoreConstructor: CompletedTerminalHistoryArchiveStore,
    ErrorConstructor: CompletedTerminalHistoryArchiveError,
    label: 'done-incomplete',
    expectedCode: 'invalid-payload',
    sourceOptions: {
      transformChunk(chunk, { isFinal }) {
        return isFinal && chunk.kind === 'output'
          ? { ...chunk, complete: false }
          : chunk;
      }
    }
  });

  const commitFailureStore = new CompletedTerminalHistoryArchiveStore(
    path.join(tempDir, 'stream-commit-failure-storage')
  );
  const commitFailurePayload = createStreamFailurePayload('commit-failure');
  const commitFailureDescriptor = commitFailureStore.describe(commitFailurePayload);
  const commitFailureFilePath = commitFailureStore.resolveArchiveFilePath(commitFailureDescriptor);
  const blockedStreamShardPath = path.dirname(path.dirname(commitFailureFilePath));
  await mkdir(path.dirname(blockedStreamShardPath), { recursive: true });
  await writeFile(blockedStreamShardPath, 'block streamed archive shard', 'utf8');
  const commitFailureSource = createFixedProjectionSource(commitFailurePayload);
  await assert.rejects(
    commitFailureStore.writeProjectionStream(commitFailureSource.source),
    (error) => isArchiveError(error, CompletedTerminalHistoryArchiveError, 'archive-io'),
    'a streamed commit failure must be attributed to archive IO.'
  );
  assert.equal(commitFailureSource.state.cancelCalls, 1);
  assert.equal(existsSync(commitFailureFilePath), false);
  await assertNoArchiveStaging(commitFailureStore);
  await rm(blockedStreamShardPath);
  const recoveredCommitDescriptor = await commitFailureStore.writeProjectionStream(
    createFixedProjectionSource(commitFailurePayload).source
  );
  assert.deepEqual(await commitFailureStore.read(recoveredCommitDescriptor), commitFailurePayload);

  const concurrentStreamStoragePath = path.join(tempDir, 'concurrent-stream-extension-storage');
  const concurrentStreamStoreA = new CompletedTerminalHistoryArchiveStore(concurrentStreamStoragePath);
  const concurrentStreamStoreB = new CompletedTerminalHistoryArchiveStore(concurrentStreamStoragePath);
  const concurrentSourceA = createFixedProjectionSource(streamedPayload, { creditBytes: 257 });
  const concurrentSourceB = createFixedProjectionSource(streamedPayload, { creditBytes: 64 * 1024 });
  const [concurrentStreamDescriptorA, concurrentStreamDescriptorB] = await Promise.all([
    concurrentStreamStoreA.writeProjectionStream(concurrentSourceA.source),
    concurrentStreamStoreB.writeProjectionStream(concurrentSourceB.source)
  ]);
  assert.deepEqual(concurrentStreamDescriptorA, concurrentStreamDescriptorB);
  assert.deepEqual(concurrentStreamDescriptorA, legacyStreamDescriptor);
  assert.equal(
    await countNamedFiles(concurrentStreamStoreA.getArchiveRootPath(), 'payload.json'),
    1,
    'concurrent stores must converge on one immutable canonical archive.'
  );
  assert.equal(
    await countNamedFiles(concurrentStreamStoreA.getArchiveRootPath(), 'projection.ndjson'),
    1,
    'concurrent stores must converge on one immutable projection sidecar.'
  );
  await assertNoArchiveStaging(concurrentStreamStoreA);

  const admissionStore = new CompletedTerminalHistoryArchiveStore(
    path.join(tempDir, 'stream-admission-extension-storage')
  );
  const firstAdmissionPayload = createStreamFailurePayload('admission-first');
  const secondAdmissionPayload = createStreamFailurePayload('admission-second');
  const firstAdmissionSource = createFixedProjectionSource(firstAdmissionPayload);
  const secondAdmissionSource = createFixedProjectionSource(secondAdmissionPayload);
  let releaseFirstRead;
  const firstReadGate = new Promise((resolve) => {
    releaseFirstRead = resolve;
  });
  const firstRead = firstAdmissionSource.source.read.bind(firstAdmissionSource.source);
  firstAdmissionSource.source.read = async function* (opened) {
    await firstReadGate;
    yield* firstRead(opened);
  };
  const firstAdmissionWrite = admissionStore.writeProjectionStream(firstAdmissionSource.source);
  await waitFor(() => firstAdmissionSource.state.openCalls === 1);
  const secondAdmissionWrite = admissionStore.writeProjectionStream(secondAdmissionSource.source);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    secondAdmissionSource.state.openCalls,
    0,
    'projection open must wait for the single archive finalization admission.'
  );
  releaseFirstRead();
  await Promise.all([firstAdmissionWrite, secondAdmissionWrite]);
  assert.equal(secondAdmissionSource.state.openCalls, 1);

  const responsivePayload = structuredClone(payload);
  responsivePayload.sessionId = 'completed-session-responsive-write';
  responsivePayload.authorityId = 'authority-responsive-write';
  responsivePayload.checkpoint.sessionId = responsivePayload.sessionId;
  responsivePayload.checkpoint.authorityId = responsivePayload.authorityId;
  responsivePayload.checkpoint.serializedState.data = '😀'.repeat(200_000);
  responsivePayload.events[0].data = 'control-progress'.repeat(100_000);
  let materializationControlTurns = 0;
  let countMaterializationControlTurns = true;
  const countControlTurn = () => {
    materializationControlTurns += 1;
    if (countMaterializationControlTurns) {
      setImmediate(countControlTurn);
    }
  };
  setImmediate(countControlTurn);
  const responsiveDescriptor = await store.write(responsivePayload);
  countMaterializationControlTurns = false;
  assert.ok(
    materializationControlTurns >= 3,
    `archive materialization must yield to Host control work; observed ${materializationControlTurns} turns.`
  );
  assert.deepEqual(await store.read(responsiveDescriptor), responsivePayload);

  let asyncDescribeControlTurns = 0;
  let countAsyncDescribeTurns = true;
  const countAsyncDescribeTurn = () => {
    asyncDescribeControlTurns += 1;
    if (countAsyncDescribeTurns) {
      setImmediate(countAsyncDescribeTurn);
    }
  };
  setImmediate(countAsyncDescribeTurn);
  const asynchronouslyDescribed = await store.describeAsync(responsivePayload);
  countAsyncDescribeTurns = false;
  assert.deepEqual(
    asynchronouslyDescribed,
    store.describe(responsivePayload),
    'asynchronous canonical description must preserve the content address.'
  );
  assert.ok(
    asyncDescribeControlTurns >= 2,
    `async descriptor calculation must yield to Host control work; observed ${asyncDescribeControlTurns} turns.`
  );

  const smallEventCount = 90_000;
  const smallEventPayload = {
    version: 1,
    sessionId: 'completed-session-many-small-events',
    authorityId: 'authority-many-small-events',
    revision: smallEventCount,
    checkpoint: {
      version: 1,
      sessionId: 'completed-session-many-small-events',
      authorityId: 'authority-many-small-events',
      revision: 0,
      cols: 80,
      rows: 24,
      scrollback: 1000,
      createdAtMs: 0,
      serializedState: {
        format: 'xterm-serialize-v1',
        data: '',
        viewportY: 0,
        outputSequence: 0
      }
    },
    events: Array.from({ length: smallEventCount }, (_, index) => ({
      type: 'output',
      revision: index + 1,
      createdAtMs: index + 1,
      data: 'x'
    }))
  };
  const smallEventDescribe = await measureEventLoopResponsiveness(
    () => store.describeAsync(smallEventPayload)
  );
  const smallEventWrite = await measureEventLoopResponsiveness(
    () => store.write(smallEventPayload)
  );
  assert.equal(smallEventWrite.result.archiveId, smallEventDescribe.result.archiveId);
  for (const [operation, measurement] of [
    ['describeAsync', smallEventDescribe],
    ['write', smallEventWrite]
  ]) {
    assert.ok(
      measurement.maxTimerDriftMs < 75,
      `${operation} must keep a 90,000-event archive walk bounded; observed ${measurement.maxTimerDriftMs.toFixed(2)}ms timer drift.`
    );
    assert.ok(
      measurement.timerTicks >= 20,
      `${operation} must yield repeatedly while walking 90,000 small events; observed ${measurement.timerTicks} timer ticks.`
    );
  }
  console.log(JSON.stringify({
    benchmark: 'completed-terminal-history-archive-small-events',
    eventCount: smallEventCount,
    describeAsync: summarizeResponsivenessMeasurement(smallEventDescribe),
    write: summarizeResponsivenessMeasurement(smallEventWrite)
  }));

  const concurrentReader = await store.openProjection(largeDescriptor);
  const [concurrentOpenA, concurrentOpenB] = await Promise.all([
    concurrentReader.open(),
    concurrentReader.open()
  ]);
  assert.deepEqual(
    concurrentOpenA,
    concurrentOpenB,
    'concurrent open calls must share one header read and projection identity.'
  );
  const [concurrentReadA, concurrentReadB] = await Promise.all([
    concurrentReader.read(256),
    concurrentReader.read(256)
  ]);
  assert.equal(concurrentReadA.chunk.kind, 'checkpoint');
  assert.equal(concurrentReadB.chunk.kind, 'checkpoint');
  assert.equal(concurrentReadA.chunk.dataOffset, 0);
  assert.equal(
    concurrentReadB.chunk.dataOffset,
    concurrentReadA.chunk.data.length,
    'concurrent reads must advance the sidecar exactly once and remain contiguous.'
  );
  await concurrentReader.close();

  const delayedHandleState = { activeReads: 0, closeCalls: 0, closedDuringRead: false };
  const delayedHandle = createDelayedReadHandle(
    await readFile(store.resolveArchiveProjectionFilePath(largeDescriptor)),
    delayedHandleState
  );
  const cancelDuringOpenReader = new CompletedTerminalHistoryArchiveProjectionReader(
    delayedHandle,
    largeDescriptor
  );
  const pendingOpen = cancelDuringOpenReader.open();
  await waitFor(() => delayedHandleState.activeReads > 0);
  const pendingClose = cancelDuringOpenReader.close();
  assert.equal(
    cancelDuringOpenReader.close(),
    pendingClose,
    'repeated cancellation must share the same descriptor-close barrier.'
  );
  await Promise.all([pendingOpen, pendingClose]);
  assert.equal(delayedHandleState.closeCalls, 1);
  assert.equal(
    delayedHandleState.closedDuringRead,
    false,
    'cancellation must wait for an active file read before closing its descriptor.'
  );
  await assert.rejects(
    cancelDuringOpenReader.read(256),
    (error) => isArchiveError(error, CompletedTerminalHistoryArchiveError, 'archive-io'),
    'a cancelled reader must reject subsequent reads without reopening its descriptor.'
  );

  const queuedCancelHandleState = { activeReads: 0, closeCalls: 0, closedDuringRead: false };
  const queuedCancelReader = new CompletedTerminalHistoryArchiveProjectionReader(
    createDelayedReadHandle(
      await readFile(store.resolveArchiveProjectionFilePath(largeDescriptor)),
      queuedCancelHandleState
    ),
    largeDescriptor
  );
  const queuedOpen = queuedCancelReader.open();
  const queuedClose = queuedCancelReader.close();
  await assert.rejects(
    queuedOpen,
    (error) => isArchiveError(error, CompletedTerminalHistoryArchiveError, 'archive-io'),
    'cancellation before a queued open starts must prevent any file read.'
  );
  await queuedClose;
  assert.equal(queuedCancelHandleState.activeReads, 0);
  assert.equal(queuedCancelHandleState.closeCalls, 1);

  const firstArchiveStats = await stat(describedFilePath, { bigint: true });
  const firstProjectionStats = await stat(store.resolveArchiveProjectionFilePath(written), { bigint: true });
  assert.deepEqual(await store.ensureProjectionSidecar(written), written);
  assert.equal(
    (await stat(store.resolveArchiveProjectionFilePath(written), { bigint: true })).ino,
    firstProjectionStats.ino,
    'valid sidecars must be verified without rebuilding or replacing them.'
  );
  const intactProjectionBytes = await readFile(store.resolveArchiveProjectionFilePath(written));
  const corruptSidecarBytes = Buffer.from(intactProjectionBytes);
  corruptSidecarBytes[0] = corruptSidecarBytes[0] === 0x7b ? 0x5b : 0x7b;
  await writeFile(store.resolveArchiveProjectionFilePath(written), corruptSidecarBytes);
  await assert.rejects(
    store.ensureProjectionSidecar(written),
    (error) => isArchiveError(error, CompletedTerminalHistoryArchiveError, 'archive-corrupt'),
    'a descriptor with a corrupt sidecar must fail closed instead of silently rebuilding it.'
  );
  await writeFile(store.resolveArchiveProjectionFilePath(written), intactProjectionBytes);
  const duplicateWrites = await Promise.all([
    store.write(payload),
    store.write(structuredClone(payload)),
    store.write(payload)
  ]);
  assert.deepEqual(duplicateWrites, [written, written, written]);
  const duplicateArchiveStats = await stat(describedFilePath, { bigint: true });
  assert.equal(
    duplicateArchiveStats.ino,
    firstArchiveStats.ino,
    'idempotent writes of identical content must reuse the immutable archive.'
  );
  const projectionPath = store.resolveArchiveProjectionFilePath(written);
  await rm(projectionPath);
  const upgradedDescriptor = await store.ensureProjectionSidecar(written);
  assert.deepEqual(upgradedDescriptor, written, 'a canonical-only archive can be upgraded in place.');
  assert.equal((await stat(projectionPath)).isFile(), true);
  assert.deepEqual(
    await store.ensureProjectionSidecar(described),
    written,
    'a legacy descriptor without projection fields must be upgraded from its canonical blob.'
  );

  const concurrentStoragePath = path.join(tempDir, 'concurrent-extension-storage');
  const concurrentStoreA = new CompletedTerminalHistoryArchiveStore(concurrentStoragePath);
  const concurrentStoreB = new CompletedTerminalHistoryArchiveStore(concurrentStoragePath);
  const [concurrentDescriptorA, concurrentDescriptorB] = await Promise.all([
    concurrentStoreA.write(payload),
    concurrentStoreB.write(payload)
  ]);
  assert.deepEqual(
    concurrentDescriptorA,
    concurrentDescriptorB,
    'independent store instances must converge on the same content address.'
  );
  assert.deepEqual(await concurrentStoreA.read(concurrentDescriptorA), payload);
  const concurrentArchiveEntries = await readdir(
    path.dirname(path.dirname(concurrentStoreA.resolveArchiveFilePath(concurrentDescriptorA)))
  );
  assert.equal(
    concurrentArchiveEntries.some((entry) => entry.endsWith('.tmp')),
    false,
    'the losing atomic commit must clean up its private temporary directory.'
  );

  const mergeSourceStoragePath = path.join(tempDir, 'merge-source-extension-storage');
  const mergeTargetStoragePath = path.join(tempDir, 'merge-target-extension-storage');
  const mergeSourceStore = new CompletedTerminalHistoryArchiveStore(mergeSourceStoragePath);
  const mergeTargetStore = new CompletedTerminalHistoryArchiveStore(mergeTargetStoragePath);
  const sourceOnlyPayload = createPayload('merge-source-session', 'merge-source-authority', 'source-only');
  const targetOnlyPayload = createPayload('merge-target-session', 'merge-target-authority', 'target-only');
  const sourceOnlyDescriptor = await mergeSourceStore.write(sourceOnlyPayload);
  const targetOnlyDescriptor = await mergeTargetStore.write(targetOnlyPayload);
  mergeCompletedTerminalHistoryArchiveDirectories(
    path.join(mergeSourceStoragePath, 'completed-terminal-history'),
    path.join(mergeTargetStoragePath, 'completed-terminal-history')
  );
  assert.deepEqual(
    await mergeTargetStore.read(sourceOnlyDescriptor),
    sourceOnlyPayload,
    'slot migration must add source-only content-addressed blobs to the target archive.'
  );
  assert.deepEqual(
    await mergeTargetStore.read(targetOnlyDescriptor),
    targetOnlyPayload,
    'slot migration must retain target-only content-addressed blobs.'
  );

  const sharedPayload = createPayload('merge-shared-session', 'merge-shared-authority', 'shared');
  const sharedSourceDescriptor = await mergeSourceStore.write(sharedPayload);
  const sharedTargetDescriptor = await mergeTargetStore.write(sharedPayload);
  assert.deepEqual(sharedSourceDescriptor, sharedTargetDescriptor);
  const sharedTargetPath = mergeTargetStore.resolveArchiveFilePath(sharedTargetDescriptor);
  const sharedTargetStatsBeforeMerge = await stat(sharedTargetPath, { bigint: true });
  mergeCompletedTerminalHistoryArchiveDirectories(
    path.join(mergeSourceStoragePath, 'completed-terminal-history'),
    path.join(mergeTargetStoragePath, 'completed-terminal-history')
  );
  const sharedTargetStatsAfterMerge = await stat(sharedTargetPath, { bigint: true });
  assert.equal(
    sharedTargetStatsAfterMerge.ino,
    sharedTargetStatsBeforeMerge.ino,
    'an identical archive ID must be validated and retained instead of replaced.'
  );

  const conflictingSourceBytes = await readFile(mergeSourceStore.resolveArchiveFilePath(sharedSourceDescriptor));
  conflictingSourceBytes[0] = conflictingSourceBytes[0] === 0x7b ? 0x5b : 0x7b;
  await writeFile(mergeSourceStore.resolveArchiveFilePath(sharedSourceDescriptor), conflictingSourceBytes);
  const intactSharedTargetBytes = await readFile(sharedTargetPath);
  assert.throws(
    () => mergeCompletedTerminalHistoryArchiveDirectories(
      path.join(mergeSourceStoragePath, 'completed-terminal-history'),
      path.join(mergeTargetStoragePath, 'completed-terminal-history')
    ),
    (error) => isArchiveError(error, CompletedTerminalHistoryArchiveError, 'archive-corrupt'),
    'the same content-addressed ID with different bytes must fail closed.'
  );
  assert.deepEqual(
    await readFile(sharedTargetPath),
    intactSharedTargetBytes,
    'a merge conflict must not overwrite or delete the committed target blob.'
  );

  await assert.rejects(
    store.read({ ...written, sessionId: 'different-session' }),
    (error) => isArchiveError(error, CompletedTerminalHistoryArchiveError, 'archive-corrupt'),
    'a descriptor must not claim another payload session.'
  );
  await assert.rejects(
    store.read({ ...written, authorityId: 'different-authority' }),
    (error) => isArchiveError(error, CompletedTerminalHistoryArchiveError, 'archive-corrupt'),
    'a descriptor must not claim another payload authority.'
  );
  await assert.rejects(
    store.read({ ...written, finalRevision: written.finalRevision - 1 }),
    (error) => isArchiveError(error, CompletedTerminalHistoryArchiveError, 'archive-corrupt'),
    'a descriptor must not claim another final revision.'
  );
  await assert.rejects(
    store.read({ ...written, byteLength: written.byteLength + 1 }),
    (error) => isArchiveError(error, CompletedTerminalHistoryArchiveError, 'archive-corrupt'),
    'the stored byte length must match the bounded descriptor before parsing.'
  );

  const validationStore = new CompletedTerminalHistoryArchiveStore(
    path.join(tempDir, 'payload-validation-extension-storage')
  );
  const invalidPayloadBytes = Buffer.from(
    `${JSON.stringify({ ...payload, events: [] })}\n`,
    'utf8'
  );
  const invalidPayloadSha256 = createHash('sha256').update(invalidPayloadBytes).digest('hex');
  const invalidPayloadDescriptor = {
    version: 1,
    archiveId: `sha256-${invalidPayloadSha256}`,
    codec: COMPLETED_TERMINAL_HISTORY_ARCHIVE_CODEC,
    sessionId: payload.sessionId,
    authorityId: payload.authorityId,
    finalRevision: payload.revision,
    byteLength: invalidPayloadBytes.byteLength,
    sha256: invalidPayloadSha256
  };
  const invalidPayloadFilePath = validationStore.resolveArchiveFilePath(invalidPayloadDescriptor);
  await mkdir(path.dirname(invalidPayloadFilePath), { recursive: true });
  await writeFile(invalidPayloadFilePath, invalidPayloadBytes);
  await assert.rejects(
    validationStore.read(invalidPayloadDescriptor),
    (error) => isArchiveError(error, CompletedTerminalHistoryArchiveError, 'archive-corrupt'),
    'checksum-valid JSON must still normalize to one contiguous TerminalStreamAttachPayload.'
  );

  const projectionValidationStore = new CompletedTerminalHistoryArchiveStore(
    path.join(tempDir, 'projection-validation-extension-storage')
  );
  await assertCorruptProjectionRejected({
    label: 'invalid-header-range',
    store: projectionValidationStore,
    ErrorConstructor: CompletedTerminalHistoryArchiveError,
    mutate(records) {
      records[0].checkpoint.revision = -1;
    },
    failureStage: 'open'
  });
  await assertCorruptProjectionRejected({
    label: 'header-inline-data',
    store: projectionValidationStore,
    ErrorConstructor: CompletedTerminalHistoryArchiveError,
    mutate(records) {
      records[0].checkpoint.serializedState.data = 'must remain in bounded checkpoint records';
    },
    failureStage: 'open'
  });
  await assertCorruptProjectionRejected({
    label: 'header-extra-field',
    store: projectionValidationStore,
    ErrorConstructor: CompletedTerminalHistoryArchiveError,
    mutate(records) {
      records[0].unexpected = true;
    },
    failureStage: 'open'
  });
  await assertCorruptProjectionRejected({
    label: 'checkpoint-length-mismatch',
    store: projectionValidationStore,
    ErrorConstructor: CompletedTerminalHistoryArchiveError,
    mutate(records) {
      records[0].checkpoint.checkpointDataLength += 1;
    }
  });
  await assertCorruptProjectionRejected({
    label: 'revision-gap',
    store: projectionValidationStore,
    ErrorConstructor: CompletedTerminalHistoryArchiveError,
    mutate(records) {
      records.find((record) => record.kind === 'output').revision += 1;
    }
  });
  await assertCorruptProjectionRejected({
    label: 'interrupted-output',
    store: projectionValidationStore,
    ErrorConstructor: CompletedTerminalHistoryArchiveError,
    mutate(records) {
      records.find((record) => record.kind === 'output').complete = false;
    }
  });
  await assertCorruptProjectionRejected({
    label: 'malformed-metadata',
    store: projectionValidationStore,
    ErrorConstructor: CompletedTerminalHistoryArchiveError,
    mutate(records) {
      records.find((record) => record.kind === 'resize').complete = false;
    }
  });
  await assertCorruptProjectionRejected({
    label: 'record-extra-field',
    store: projectionValidationStore,
    ErrorConstructor: CompletedTerminalHistoryArchiveError,
    mutate(records) {
      records.find((record) => record.kind === 'resize').unexpected = true;
    }
  });
  await assertCorruptProjectionRejected({
    label: 'trailing-record-after-done',
    store: projectionValidationStore,
    ErrorConstructor: CompletedTerminalHistoryArchiveError,
    mutate(records) {
      records.push({ kind: 'done' });
    }
  });
  await assertCorruptProjectionRejected({
    label: 'appended-data-with-stale-descriptor',
    store: projectionValidationStore,
    ErrorConstructor: CompletedTerminalHistoryArchiveError,
    preserveDescriptorIntegrity: true,
    mutate(records) {
      records.push({ kind: 'done' });
    }
  });
  await assertCorruptProjectionRejected({
    label: 'descriptor-byte-length-mismatch',
    store: projectionValidationStore,
    ErrorConstructor: CompletedTerminalHistoryArchiveError,
    mutateDescriptor(descriptor) {
      return { ...descriptor, projectionByteLength: descriptor.projectionByteLength + 1 };
    }
  });
  await assertCorruptProjectionRejected({
    label: 'descriptor-checksum-mismatch',
    store: projectionValidationStore,
    ErrorConstructor: CompletedTerminalHistoryArchiveError,
    mutateDescriptor(descriptor) {
      return { ...descriptor, projectionSha256: '0'.repeat(64) };
    }
  });

  const intactBytes = await readFile(describedFilePath);
  const corruptBytes = Buffer.from(intactBytes);
  corruptBytes[corruptBytes.length - 1] = corruptBytes[corruptBytes.length - 1] === 0x0a ? 0x20 : 0x0a;
  await writeFile(describedFilePath, corruptBytes);
  await assert.rejects(
    store.read(written),
    (error) => isArchiveError(error, CompletedTerminalHistoryArchiveError, 'archive-corrupt'),
    'read must fail closed when archive bytes no longer match the checksum.'
  );
  await assert.rejects(
    store.write(payload),
    (error) => isArchiveError(error, CompletedTerminalHistoryArchiveError, 'archive-corrupt'),
    'an immutable content address must not be silently overwritten when its existing bytes are corrupt.'
  );
  assert.deepEqual(
    await readFile(describedFilePath),
    corruptBytes,
    'a failed idempotent write must preserve the pre-existing archive bytes.'
  );
  await writeFile(describedFilePath, intactBytes);
  assert.deepEqual(await store.read(written), payload);

  const blockedPayload = findPayloadInAnotherShard(payload, store, written.sha256.slice(0, 2));
  const blockedDescriptor = store.describe(blockedPayload);
  const blockedFilePath = store.resolveArchiveFilePath(blockedDescriptor);
  const blockedShardPath = path.dirname(path.dirname(blockedFilePath));
  await mkdir(path.dirname(blockedShardPath), { recursive: true });
  await writeFile(blockedShardPath, 'block this archive shard', 'utf8');
  await assert.rejects(
    store.write(blockedPayload),
    (error) => isArchiveError(error, CompletedTerminalHistoryArchiveError, 'archive-io'),
    'a storage failure must be reported instead of returning a descriptor without a committed blob.'
  );
  assert.deepEqual(
    await store.read(written),
    payload,
    'failure to commit another archive must not damage a previously committed archive.'
  );

  await assert.rejects(
    store.read({ ...written, archiveId: 'unsafe/path' }),
    (error) => isArchiveError(error, CompletedTerminalHistoryArchiveError, 'invalid-descriptor')
  );
  const missingPayload = createPayload('missing-session', 'missing-authority', 'missing');
  const missingDescriptor = store.describe(missingPayload);
  await assert.rejects(
    store.read(missingDescriptor),
    (error) => isArchiveError(error, CompletedTerminalHistoryArchiveError, 'archive-not-found')
  );

  const missingProjectionDescriptor = {
    ...missingDescriptor,
    projectionCodec: written.projectionCodec,
    projectionByteLength: written.projectionByteLength,
    projectionSha256: written.projectionSha256
  };
  const missingProjectionPath = store.resolveArchiveProjectionFilePath(missingProjectionDescriptor);
  assert.ok(missingProjectionPath);
  await assert.rejects(
    store.openProjection(missingProjectionDescriptor),
    (error) => isArchiveError(error, CompletedTerminalHistoryArchiveError, 'archive-not-found')
  );

  const memoryGate = await runStreamingArchiveMemoryGate(
    storeBundlePath,
    path.join(tempDir, 'stream-memory-extension-storage')
  );
  assert.equal(memoryGate.outputChars, memoryGate.expectedOutputChars);
  assert.ok(memoryGate.canonicalBytes > memoryGate.expectedOutputChars);
  console.log(JSON.stringify({
    benchmark: 'completed-terminal-history-archive-stream-memory',
    ...memoryGate
  }));

  console.log('completed terminal history archive tests passed');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
}

async function runStreamingArchiveMemoryGate(storeBundlePath, storagePath) {
  const scriptPath = path.resolve('scripts/test/test-completed-terminal-history-archive.mjs');
  const childResult = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        '--expose-gc',
        '--max-old-space-size=64',
        scriptPath,
        STREAM_ARCHIVE_MEMORY_CHILD_FLAG,
        storeBundlePath,
        storagePath
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code !== 0) {
        reject(new Error(
          `streaming archive memory child failed (${signal ?? code}): ${stderr || stdout}`
        ));
        return;
      }
      try {
        const lines = stdout.trim().split('\n');
        resolve(JSON.parse(lines.at(-1)));
      } catch (error) {
        reject(new Error(`streaming archive memory child returned invalid output: ${stdout}`, {
          cause: error
        }));
      }
    });
  });
  assert.equal(childResult.mode, 'stream-archive-memory');
  return childResult;
}

async function runStreamingArchiveMemoryChild(storeBundlePath, storagePath) {
  assert.equal(typeof storeBundlePath, 'string');
  assert.equal(typeof storagePath, 'string');
  assert.equal(typeof global.gc, 'function', 'memory gate must run with --expose-gc.');
  const require = createRequire(import.meta.url);
  const { CompletedTerminalHistoryArchiveStore } = require(storeBundlePath);
  const expectedOutputChars = 40 * 1024 * 1024;
  const store = new CompletedTerminalHistoryArchiveStore(storagePath);
  global.gc();
  const baseline = process.memoryUsage();
  const peak = {
    heapUsed: baseline.heapUsed,
    arrayBuffers: baseline.arrayBuffers
  };
  const sampleMemory = () => {
    const usage = process.memoryUsage();
    peak.heapUsed = Math.max(peak.heapUsed, usage.heapUsed);
    peak.arrayBuffers = Math.max(peak.arrayBuffers, usage.arrayBuffers);
  };
  const source = createLazyLargeProjectionSource(expectedOutputChars, sampleMemory);
  const memorySampler = setInterval(sampleMemory, 2);
  let canonicalStats;
  let projectionStats;
  let outputChars = 0;
  try {
    const descriptor = await store.writeProjectionStream(source);
    sampleMemory();

    canonicalStats = await stat(store.resolveArchiveFilePath(descriptor));
    projectionStats = await stat(store.resolveArchiveProjectionFilePath(descriptor));
    assert.equal(canonicalStats.size, descriptor.byteLength);
    assert.equal(projectionStats.size, descriptor.projectionByteLength);

    const reader = await store.openProjection(descriptor);
    const opened = await reader.open();
    assert.equal(opened.targetRevision, 1);
    let reads = 0;
    while (true) {
      const result = await reader.read(64 * 1024);
      if (result.chunk?.kind === 'output') {
        outputChars += result.chunk.data.length;
      }
      reads += 1;
      if (reads % 64 === 0) {
        sampleMemory();
      }
      if (result.done) {
        break;
      }
    }
    await reader.close();
  } finally {
    clearInterval(memorySampler);
  }
  sampleMemory();
  global.gc();
  const retained = process.memoryUsage();
  assert.equal(outputChars, expectedOutputChars);
  assert.ok(
    peak.heapUsed - baseline.heapUsed < 24 * 1024 * 1024,
    `streaming archive heap growth was not bounded: ${peak.heapUsed - baseline.heapUsed} bytes.`
  );
  assert.ok(
    peak.arrayBuffers - baseline.arrayBuffers < 64 * 1024 * 1024,
    `streaming archive Buffer growth was not bounded: ${peak.arrayBuffers - baseline.arrayBuffers} bytes.`
  );
  assert.ok(
    retained.heapUsed - baseline.heapUsed < 12 * 1024 * 1024,
    `streaming archive retained heap was not bounded: ${retained.heapUsed - baseline.heapUsed} bytes.`
  );
  assert.ok(
    retained.arrayBuffers - baseline.arrayBuffers < 12 * 1024 * 1024,
    `streaming archive retained Buffers were not bounded: ${retained.arrayBuffers - baseline.arrayBuffers} bytes.`
  );
  await assertNoArchiveStaging(store);
  process.stdout.write(`${JSON.stringify({
    mode: 'stream-archive-memory',
    expectedOutputChars,
    outputChars,
    canonicalBytes: canonicalStats.size,
    projectionBytes: projectionStats.size,
    heapGrowthBytes: peak.heapUsed - baseline.heapUsed,
    arrayBufferGrowthBytes: peak.arrayBuffers - baseline.arrayBuffers,
    retainedHeapGrowthBytes: retained.heapUsed - baseline.heapUsed,
    retainedArrayBufferGrowthBytes: retained.arrayBuffers - baseline.arrayBuffers
  })}\n`);
}

function createLazyLargeProjectionSource(outputChars, sampleMemory) {
  const opened = {
    supervisorInstanceId: 'memory-supervisor',
    projectionId: 'memory-projection',
    sessionId: 'memory-session',
    authorityId: 'memory-authority',
    targetRevision: 1,
    follow: false,
    checkpoint: {
      version: 1,
      sessionId: 'memory-session',
      authorityId: 'memory-authority',
      revision: 0,
      cols: 80,
      rows: 24,
      scrollback: 1000,
      createdAtMs: 1000,
      serializedState: {
        format: 'xterm-serialize-v1',
        viewportY: 0,
        outputSequence: 0
      }
    }
  };
  return {
    async open() {
      return opened;
    },
    async *read(openedValue) {
      assert.equal(openedValue, opened);
      yield {
        creditBytes: 64 * 1024,
        result: createProjectionReadResult(
          opened,
          { kind: 'checkpoint', dataOffset: 0, data: '', complete: true },
          false
        )
      };
      const chunkChars = 32 * 1024;
      let dataOffset = 0;
      let chunkIndex = 0;
      while (dataOffset < outputChars) {
        const length = Math.min(chunkChars, outputChars - dataOffset);
        const data = 'x'.repeat(length);
        const nextOffset = dataOffset + length;
        const done = nextOffset === outputChars;
        yield {
          creditBytes: 64 * 1024,
          result: createProjectionReadResult(
            opened,
            {
              kind: 'output',
              revision: 1,
              createdAtMs: 1001,
              dataOffset,
              data,
              complete: done
            },
            done
          )
        };
        dataOffset = nextOffset;
        chunkIndex += 1;
        if (chunkIndex % 64 === 0) {
          sampleMemory();
        }
      }
    },
    async cancel() {}
  };
}

function createStreamingParityPayload() {
  const sessionId = 'streaming-parity-session';
  const authorityId = 'streaming-parity-authority';
  const checkpointPrefix = `${'p'.repeat(32 * 1024 - 1)}😀 checkpoint " \\ \ud800`;
  const checkpointData = `${checkpointPrefix}${'q'.repeat(64 * 1024 - checkpointPrefix.length)}`;
  const firstPrefix = 'quote" slash\\ controls\n\t\u0001 lone\ud800 emoji😀';
  const firstOutput = `${firstPrefix}${'a'.repeat(32 * 1024 - firstPrefix.length)}`;
  const finalPrefix = `${'b'.repeat(32 * 1024 - 1)}😀 boundary " \\ \udc00`;
  const finalOutput = `${finalPrefix}${'c'.repeat(64 * 1024 - finalPrefix.length)}`;
  assert.equal(checkpointData.length, 64 * 1024);
  assert.equal(firstOutput.length, 32 * 1024);
  assert.equal(finalOutput.length, 64 * 1024);
  return {
    version: 1,
    sessionId,
    authorityId,
    revision: 5,
    checkpoint: {
      version: 1,
      sessionId,
      authorityId,
      revision: 1,
      cols: 80,
      rows: 24,
      scrollback: 1000,
      createdAtMs: 1000,
      serializedState: {
        format: 'xterm-serialize-v1',
        data: checkpointData,
        viewportY: 0,
        outputSequence: 1
      }
    },
    events: [
      {
        type: 'output',
        revision: 2,
        createdAtMs: 1001,
        data: firstOutput
      },
      {
        type: 'resize',
        revision: 3,
        createdAtMs: 1002,
        cols: 132,
        rows: 40
      },
      {
        type: 'scrollback',
        revision: 4,
        createdAtMs: 1003,
        scrollback: 2000
      },
      {
        type: 'output',
        revision: 5,
        createdAtMs: 1004,
        data: finalOutput
      }
    ]
  };
}

function createStreamFailurePayload(label) {
  const sessionId = `stream-failure-${label}`;
  const authorityId = `stream-failure-authority-${label}`;
  return {
    version: 1,
    sessionId,
    authorityId,
    revision: 2,
    checkpoint: {
      version: 1,
      sessionId,
      authorityId,
      revision: 1,
      cols: 80,
      rows: 24,
      scrollback: 1000,
      createdAtMs: 1000,
      serializedState: {
        format: 'xterm-serialize-v1',
        data: '',
        viewportY: 0,
        outputSequence: 1
      }
    },
    events: [
      {
        type: 'output',
        revision: 2,
        createdAtMs: 1001,
        data: `${label}-output`
      }
    ]
  };
}

function createFixedProjectionSource(payload, options = {}) {
  const creditBytes = options.creditBytes ?? 64 * 1024;
  const supervisorInstanceId = `supervisor-${payload.sessionId}`;
  const projectionId = `projection-${payload.sessionId}`;
  const { data: _checkpointData, ...serializedState } = payload.checkpoint.serializedState;
  const opened = {
    supervisorInstanceId,
    projectionId,
    sessionId: payload.sessionId,
    authorityId: payload.authorityId,
    targetRevision: payload.revision,
    follow: false,
    checkpoint: {
      ...payload.checkpoint,
      serializedState
    }
  };
  const state = {
    openCalls: 0,
    cancelCalls: 0,
    readsYielded: 0
  };
  const source = {
    async open() {
      state.openCalls += 1;
      return opened;
    },
    async *read(openedValue) {
      assert.equal(openedValue, opened);
      const iterator = createProjectionChunks(payload, creditBytes)[Symbol.iterator]();
      let current = iterator.next();
      let readIndex = 0;
      while (!current.done) {
        if (options.throwAfterReads === readIndex) {
          throw new Error('synthetic projection source failure');
        }
        const next = iterator.next();
        const isFinal = next.done;
        const context = { isFinal, readIndex };
        const chunk = options.transformChunk
          ? options.transformChunk(current.value, context)
          : current.value;
        let result = createProjectionReadResult(opened, chunk, isFinal && !options.omitDone);
        if (options.transformResult) {
          result = options.transformResult(result, context);
        }
        assert.ok(result.payloadBytes <= creditBytes);
        state.readsYielded += 1;
        yield { creditBytes, result };
        readIndex += 1;
        current = next;
      }
    },
    async cancel(openedValue) {
      assert.equal(openedValue, opened);
      state.cancelCalls += 1;
    }
  };
  return { source, state };
}

function* createProjectionChunks(payload, creditBytes) {
  yield* createProjectionDataChunks(
    'checkpoint',
    payload.checkpoint.serializedState.data,
    {},
    creditBytes
  );
  for (const event of payload.events) {
    if (event.type === 'output') {
      yield* createProjectionDataChunks(
        'output',
        event.data,
        { revision: event.revision, createdAtMs: event.createdAtMs },
        creditBytes
      );
    } else if (event.type === 'resize') {
      const chunk = {
        kind: 'resize',
        revision: event.revision,
        createdAtMs: event.createdAtMs,
        cols: event.cols,
        rows: event.rows,
        complete: true
      };
      assert.ok(Buffer.byteLength(JSON.stringify(chunk), 'utf8') <= creditBytes);
      yield chunk;
    } else {
      const chunk = {
        kind: 'scrollback',
        revision: event.revision,
        createdAtMs: event.createdAtMs,
        scrollback: event.scrollback,
        complete: true
      };
      assert.ok(Buffer.byteLength(JSON.stringify(chunk), 'utf8') <= creditBytes);
      yield chunk;
    }
  }
}

function* createProjectionDataChunks(kind, data, metadata, creditBytes) {
  if (data.length === 0) {
    yield { kind, ...metadata, dataOffset: 0, data: '', complete: true };
    return;
  }
  let offset = 0;
  while (offset < data.length) {
    let lower = 1;
    let upper = data.length - offset;
    let bestLength = 0;
    while (lower <= upper) {
      const candidate = Math.floor((lower + upper) / 2);
      let candidateLength = candidate;
      if (splitsTestUtf16Pair(data, offset + candidateLength)) {
        candidateLength -= 1;
      }
      if (candidateLength <= 0) {
        lower = candidate + 1;
        continue;
      }
      const end = offset + candidateLength;
      const chunk = {
        kind,
        ...metadata,
        dataOffset: offset,
        data: data.slice(offset, end),
        complete: end === data.length
      };
      if (Buffer.byteLength(JSON.stringify(chunk), 'utf8') <= creditBytes) {
        bestLength = candidateLength;
        lower = candidate + 1;
      } else {
        upper = candidate - 1;
      }
    }
    assert.ok(bestLength > 0, `credit ${creditBytes} must fit one ${kind} code point.`);
    const end = offset + bestLength;
    yield {
      kind,
      ...metadata,
      dataOffset: offset,
      data: data.slice(offset, end),
      complete: end === data.length
    };
    offset = end;
  }
}

function createProjectionReadResult(opened, chunk, done) {
  const serialized = JSON.stringify(chunk);
  return {
    supervisorInstanceId: opened.supervisorInstanceId,
    projectionId: opened.projectionId,
    sessionId: opened.sessionId,
    authorityId: opened.authorityId,
    targetRevision: opened.targetRevision,
    payloadBytes: Buffer.byteLength(serialized, 'utf8'),
    chunkChecksum: createHash('sha256').update(serialized, 'utf8').digest('hex'),
    chunk,
    done,
    live: false
  };
}

function splitsTestUtf16Pair(data, offset) {
  if (offset <= 0 || offset >= data.length) {
    return false;
  }
  const previous = data.charCodeAt(offset - 1);
  const next = data.charCodeAt(offset);
  return previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff;
}

async function assertRejectedProjectionStream({
  tempDir,
  StoreConstructor,
  ErrorConstructor,
  label,
  expectedCode,
  sourceOptions
}) {
  const store = new StoreConstructor(path.join(tempDir, `${label}-stream-rejection-storage`));
  const payload = createStreamFailurePayload(label);
  const expectedPath = store.resolveArchiveFilePath(store.describe(payload));
  const { source, state } = createFixedProjectionSource(payload, sourceOptions);
  await assert.rejects(
    store.writeProjectionStream(source),
    (error) => isArchiveError(error, ErrorConstructor, expectedCode),
    `${label}: invalid or interrupted input must fail without publishing an archive.`
  );
  assert.equal(state.openCalls, 1);
  assert.equal(state.cancelCalls, 1, `${label}: failed projection must be cancelled.`);
  assert.equal(existsSync(expectedPath), false, `${label}: canonical blob must not be published.`);
  assert.equal(existsSync(path.dirname(expectedPath)), false, `${label}: archive directory must not remain.`);
  await assertNoArchiveStaging(store);
}

async function assertNoArchiveStaging(store) {
  const archiveRootPath = store.getArchiveRootPath();
  if (!existsSync(archiveRootPath)) {
    return;
  }
  const entries = await readdir(archiveRootPath);
  assert.deepEqual(
    entries.filter((entry) => entry.startsWith('.') && entry.endsWith('.tmp')),
    [],
    'failed or completed streaming writes must remove staging directories.'
  );
}

async function countNamedFiles(rootPath, fileName) {
  if (!existsSync(rootPath)) {
    return 0;
  }
  let count = 0;
  const entries = await readdir(rootPath, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      count += await countNamedFiles(entryPath, fileName);
    } else if (entry.isFile() && entry.name === fileName) {
      count += 1;
    }
  }
  return count;
}

function createPayload(sessionId, authorityId, label) {
  return {
    version: 1,
    sessionId,
    authorityId,
    revision: 3,
    checkpoint: {
      version: 1,
      sessionId,
      authorityId,
      revision: 1,
      cols: 80,
      rows: 24,
      scrollback: 1000,
      createdAtMs: 1000,
      serializedState: {
        format: 'xterm-serialize-v1',
        data: `${label}-checkpoint\r\n`,
        viewportY: 0,
        outputSequence: 1
      }
    },
    events: [
      {
        type: 'output',
        revision: 2,
        createdAtMs: 1001,
        data: `${label}-output\r\n`
      },
      {
        type: 'resize',
        revision: 3,
        createdAtMs: 1002,
        cols: 100,
        rows: 32
      }
    ]
  };
}

function findPayloadInAnotherShard(payload, store, excludedShard) {
  for (let attempt = 1; attempt <= 1024; attempt += 1) {
    const candidate = createPayload(
      `${payload.sessionId}-blocked-${attempt}`,
      `${payload.authorityId}-blocked-${attempt}`,
      `blocked-${attempt}`
    );
    if (store.describe(candidate).sha256.slice(0, 2) !== excludedShard) {
      return candidate;
    }
  }
  throw new Error('Could not construct a payload in another content-address shard.');
}

async function assertCorruptProjectionRejected({
  label,
  store,
  ErrorConstructor,
  mutate,
  mutateDescriptor,
  preserveDescriptorIntegrity = false,
  failureStage = 'read'
}) {
  const payload = createPayload(
    `projection-validation-${label}`,
    `projection-validation-authority-${label}`,
    label
  );
  const descriptor = await store.write(payload);
  const projectionPath = store.resolveArchiveProjectionFilePath(descriptor);
  let nextDescriptor = descriptor;
  if (mutate) {
    const records = (await readFile(projectionPath, 'utf8'))
      .trimEnd()
      .split('\n')
      .map((line) => JSON.parse(line));
    mutate(records);
    const bytes = Buffer.from(`${records.map((record) => JSON.stringify(record)).join('\n')}\n`, 'utf8');
    await writeFile(projectionPath, bytes);
    if (!preserveDescriptorIntegrity) {
      nextDescriptor = {
        ...descriptor,
        projectionByteLength: bytes.byteLength,
        projectionSha256: createHash('sha256').update(bytes).digest('hex')
      };
    }
  }
  if (mutateDescriptor) {
    nextDescriptor = mutateDescriptor(nextDescriptor);
  }

  const reader = await store.openProjection(nextDescriptor);
  if (failureStage === 'open') {
    await assert.rejects(
      reader.open(),
      (error) => isArchiveError(error, ErrorConstructor, 'archive-corrupt'),
      `${label}: invalid header must fail closed while opening.`
    );
  } else {
    await reader.open();
    await assert.rejects(
      drainProjectionReader(reader),
      (error) => isArchiveError(error, ErrorConstructor, 'archive-corrupt'),
      `${label}: invalid stream must fail closed while reading.`
    );
  }
  await assert.rejects(
    reader.read(256),
    (error) => isArchiveError(error, ErrorConstructor, 'archive-io'),
    `${label}: a rejected projection must release and permanently close its reader.`
  );
  await reader.close();
}

async function drainProjectionReader(reader) {
  while (true) {
    const result = await reader.read(256);
    if (result.done) {
      return;
    }
  }
}

function createDelayedReadHandle(bytes, state) {
  return {
    async read(target, targetOffset, length, position) {
      state.activeReads += 1;
      try {
        await new Promise((resolve) => setImmediate(resolve));
        const bytesRead = Math.max(0, Math.min(length, bytes.byteLength - position));
        if (bytesRead > 0) {
          bytes.copy(target, targetOffset, position, position + bytesRead);
        }
        return { bytesRead, buffer: target };
      } finally {
        state.activeReads -= 1;
      }
    },
    async close() {
      state.closeCalls += 1;
      if (state.activeReads > 0) {
        state.closedDuringRead = true;
      }
    }
  };
}

async function measureEventLoopResponsiveness(operation) {
  let lastTimerAtMs = performance.now();
  let maxTimerDriftMs = 0;
  let timerTicks = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    maxTimerDriftMs = Math.max(maxTimerDriftMs, now - lastTimerAtMs - 1);
    lastTimerAtMs = now;
    timerTicks += 1;
  }, 1);
  const startedAtMs = performance.now();
  try {
    const result = await operation();
    await new Promise((resolve) => setImmediate(resolve));
    return {
      result,
      elapsedMs: performance.now() - startedAtMs,
      maxTimerDriftMs,
      timerTicks
    };
  } finally {
    clearInterval(timer);
  }
}

function summarizeResponsivenessMeasurement(measurement) {
  return {
    elapsedMs: Number(measurement.elapsedMs.toFixed(2)),
    maxTimerDriftMs: Number(measurement.maxTimerDriftMs.toFixed(2)),
    timerTicks: measurement.timerTicks
  };
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error('Timed out waiting for an asynchronous archive reader operation.');
}

function isArchiveError(error, ErrorConstructor, code) {
  assert.ok(error instanceof ErrorConstructor, `expected CompletedTerminalHistoryArchiveError, got ${error}`);
  assert.equal(error.code, code);
  return true;
}
