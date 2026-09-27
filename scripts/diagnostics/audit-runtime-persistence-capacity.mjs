import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

import esbuild from 'esbuild';
import ts from 'typescript';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const sourceRoot = path.join(repoRoot, 'extensions/vscode/dev-session-canvas/src');
const supervisorFile = path.join(sourceRoot, 'supervisor/runtimeSupervisorMain.ts');
const supervisorSource = fs.readFileSync(supervisorFile, 'utf8');
const supervisorAst = ts.createSourceFile(supervisorFile, supervisorSource, ts.ScriptTarget.Latest, true);
const mainCalls = supervisorAst.statements.filter((node) =>
  (ts.isExpressionStatement(node) && node.getText(supervisorAst).startsWith('void main()')) ||
  (ts.isIfStatement(node) && node.expression.getText(supervisorAst) === 'require.main === module' &&
    ts.isBlock(node.thenStatement) && node.thenStatement.statements.length === 1 &&
    ts.isExpressionStatement(node.thenStatement.statements[0]) &&
    node.thenStatement.statements[0].getText(supervisorAst).startsWith('void main()'))
);
assert.equal(mainCalls.length, 1, 'The diagnostic must disable exactly one Supervisor entry point.');
const mainCall = mainCalls[0];

// Export the actual classes only in the in-memory bundle; never start a daemon or PTY.
const diagnosticSource = supervisorSource.slice(0, mainCall.pos) + supervisorSource.slice(mainCall.end) +
  '\nexport { TerminalSessionJournal, SerializedTerminalStateTracker };\n' +
  "export { normalizeCompletedRuntimeHistory } from '../common/completedRuntimeHistory';\n";
const bundle = await esbuild.build({
  stdin: {
    contents: diagnosticSource,
    resolveDir: path.dirname(supervisorFile),
    sourcefile: supervisorFile,
    loader: 'ts'
  },
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  external: ['node-pty']
});
const bundledModule = { exports: {} };
new Function('module', 'exports', 'require', bundle.outputFiles[0].text)(
  bundledModule,
  bundledModule.exports,
  createRequire(import.meta.url)
);
const { RuntimeSupervisorServer, TerminalSessionJournal, SerializedTerminalStateTracker,
  normalizeCompletedRuntimeHistory } = bundledModule.exports;

const hostFile = path.join(sourceRoot, 'panel/CanvasPanelManager.ts');
const hostSource = fs.readFileSync(hostFile, 'utf8');
const hostAst = ts.createSourceFile(hostFile, hostSource, ts.ScriptTarget.Latest, true);
const hostClass = hostAst.statements.find((node) =>
  ts.isClassDeclaration(node) && node.name?.text === 'CanvasPanelManager'
);
const writerMethod = hostClass?.members.find((node) =>
  ts.isMethodDeclaration(node) && node.name.getText(hostAst) === 'writePersistedCanvasSnapshotToDisk'
);
assert.ok(writerMethod, 'The diagnostic must use the current Host snapshot writer.');
const writerSource = ts.transpileModule(`class SnapshotWriter { ${writerMethod.getText(hostAst)} }`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 }
}).outputText;
const SnapshotWriter = new Function('fs', 'path', `${writerSource}\nreturn SnapshotWriter;`)(fs, path);

const pagedCapacity = process.argv.includes('--paged-capacity');
if (pagedCapacity) {
  await runPagedCapacity();
} else {
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsc-runtime-persistence-capacity-'));
const tracker = new SerializedTerminalStateTracker(80, 24, { scrollback: 1000, initialOutputSequence: 0 });
const oversizedTracker = new SerializedTerminalStateTracker(80, 24, { scrollback: 10000, initialOutputSequence: 0 });
let journal;

try {
  oversizedTracker.write(`${'x'.repeat(78)}\r\n`.repeat(5000), { outputSequence: 1 });
  const largeCheckpoint = await oversizedTracker.flushValidatedCheckpoint();
  assert.deepEqual(largeCheckpoint, { eligible: false, reason: 'serialized-state-too-large' });
  console.log(JSON.stringify({ scenario: 'large-checkpoint', ...largeCheckpoint }));

  journal = await TerminalSessionJournal.create({
    storageDir: tempDir,
    sessionId: 'capacity-audit',
    initialCols: 80,
    initialRows: 24,
    initialScrollback: 1000
  });
  const server = new RuntimeSupervisorServer({
    storageDir: tempDir,
    registryPath: path.join(tempDir, 'registry.json')
  }, 'legacy-detached', 'best-effort');
  const session = {
    sessionId: 'capacity-audit',
    kind: 'terminal',
    live: true,
    lifecycle: 'live',
    runtimeBackend: 'legacy-detached',
    runtimeGuarantee: 'best-effort',
    shellPath: '/bin/sh',
    cwd: tempDir,
    cols: 80,
    rows: 24,
    scrollback: 1000,
    output: '',
    outputSequence: 0,
    terminalAuthorityId: journal.getAuthorityId(),
    terminalJournal: journal,
    terminalStateTracker: tracker,
    terminalOperationChain: Promise.resolve(),
    terminalMutationAdmissionOpen: true,
    terminalCheckpoint: {
      version: 1,
      sessionId: 'capacity-audit',
      authorityId: journal.getAuthorityId(),
      revision: 0,
      cols: 80,
      rows: 24,
      scrollback: 1000,
      createdAtMs: Date.now(),
      serializedState: tracker.getSerializedState()
    }
  };
  server.sessions.set(session.sessionId, session);
  const readSocket = { destroyed: false };
  server.terminalReads.set(readSocket, new Map());
  const append = (data) => {
    const event = journal.appendOutput(data);
    tracker.write(data, { outputSequence: event.revision });
    session.outputSequence = event.revision;
  };
  append('\u001b]10;#ff0000\u0007');
  const block = `${'x'.repeat(78)}\r\n`.repeat(128);
  const metrics = [];

  for (let phase = 1; phase <= 3; phase += 1) {
    for (let index = 0; index < 640; index += 1) {
      append(block);
    }
    const snapshot = await server.toFreshSnapshot(session);
    assert.equal(snapshot.terminalStream.checkpoint.revision, 0);
    assert.deepEqual(await tracker.flushValidatedCheckpoint(), { eligible: false, reason: 'color-state' });
    const buildFullProjection = server.buildTerminalStreamAttachPayload;
    server.buildTerminalStreamAttachPayload = () => {
      throw new Error('Checkpoint-only refresh must never collect the full journal suffix.');
    };
    let checkpointResult;
    try {
      checkpointResult = await server.getSessionCheckpoint({
        sessionId: session.sessionId,
        authorityId: session.terminalAuthorityId,
        afterCheckpointRevision: 0
      });
    } finally {
      server.buildTerminalStreamAttachPayload = buildFullProjection;
    }
    assert.deepEqual(checkpointResult, {
      sessionId: session.sessionId,
      authorityId: session.terminalAuthorityId,
      revision: journal.getRevision()
    });
    const checkpointRefreshBytes = Buffer.byteLength(JSON.stringify(checkpointResult));
    assert.ok(checkpointRefreshBytes < 1024);
    const pagedSnapshot = await server.toAttachSnapshot(session, 'paged-until-exit');
    assert.equal(pagedSnapshot.terminalStream, undefined);
    let pagedCompletionSnapshotBytes;
    session.live = false;
    server.buildTerminalStreamAttachPayload = () => {
      throw new Error('Paged completion must never collect the full journal suffix.');
    };
    try {
      const finalSnapshot = await server.toAttachSnapshot(session, 'paged-until-exit');
      assert.equal(finalSnapshot.terminalStream, undefined);
      assert.equal(finalSnapshot.serializedTerminalState, undefined);
      assert.equal(finalSnapshot.terminalStreamPaged, true);
      assert.equal(finalSnapshot.terminalRevision, journal.getRevision());
      pagedCompletionSnapshotBytes = Buffer.byteLength(JSON.stringify(finalSnapshot));
    } finally {
      session.live = true;
      server.buildTerminalStreamAttachPayload = buildFullProjection;
    }
    const reader = await server.openTerminalRead(readSocket, {
      sessionId: session.sessionId, authorityId: session.terminalAuthorityId, consumerId: 'editor'
    });
    let pageRevision = reader.checkpoint.revision;
    let pageCount = 0;
    let pagedEventCount = 0;
    let maxPageBytes = 0;
    while (pageRevision < reader.headRevision) {
      const page = await server.readTerminalPage(readSocket, {
        sessionId: session.sessionId, authorityId: session.terminalAuthorityId,
        readId: reader.readId, afterRevision: pageRevision
      });
      assert.equal(page.events[0].revision, pageRevision + 1);
      pageCount += 1;
      pagedEventCount += page.events.length;
      maxPageBytes = Math.max(maxPageBytes, Buffer.byteLength(JSON.stringify(page.events)));
      pageRevision = page.revision;
    }
    assert.equal(pagedEventCount, snapshot.terminalStream.events.length);
    assert.ok(maxPageBytes <= 256 * 1024);
    await server.closeTerminalRead(readSocket, reader);
    const retained = await journal.getEventsAfter(0);
    const cache = journal.getCacheStats();
    assert.ok(cache.encodedBytes <= cache.maxBytes);
    assert.ok(cache.eventCount <= cache.maxEvents);
    const metric = {
      scenario: 'live-suffix',
      phase,
      screenStateBytes: Buffer.byteLength(tracker.getSerializedState().data),
      readableHistoryEvents: retained.length,
      cachedEvents: cache.eventCount,
      cachedEventBytes: cache.encodedBytes,
      retainedOutputBytes: retained.reduce((sum, event) =>
        sum + (event.type === 'output' ? Buffer.byteLength(event.data) : 0), 0),
      journalDiskBytes: directoryBytes(path.join(tempDir, 'terminal-journals')),
      snapshotBytes: Buffer.byteLength(JSON.stringify(snapshot)),
      checkpointRefreshBytes,
      pagedSnapshotBytes: Buffer.byteLength(JSON.stringify(pagedSnapshot)),
      pagedCompletionSnapshotBytes,
      readDescriptorBytes: Buffer.byteLength(JSON.stringify(reader)),
      maxPageBytes,
      pageCount,
      pagedEventCount,
      checkpointRevision: snapshot.terminalStream.checkpoint.revision,
      compactionDue: journal.shouldCommitCheckpoint(journal.getRevision())
    };
    metrics.push(metric);
    console.log(JSON.stringify(metric));
  }

  const last = metrics.at(-1);
  assert.ok(last.retainedOutputBytes > 16 * 1024 * 1024);
  assert.ok(last.screenStateBytes < 100000);
  assert.equal(last.compactionDue, true);
  assert.ok(metrics.every((metric) => Math.abs(metric.checkpointRefreshBytes - metrics[0].checkpointRefreshBytes) <= 3));
  assert.ok(metrics.every((metric) => Math.abs(metric.pagedCompletionSnapshotBytes - metrics[0].pagedCompletionSnapshotBytes) <= 3));
  const refreshed = await server.toFreshSnapshot(session);
  assert.equal(refreshed.terminalStream.events.length, last.readableHistoryEvents);

  session.live = false;
  session.lifecycle = 'closed';
  session.terminalMutationAdmissionOpen = false;
  const completed = await server.toFreshSnapshot(session, 'never');
  assert.equal(completed.terminalStream.revision, journal.getRevision());
  assert.equal(completed.terminalStream.events.length, last.readableHistoryEvents);

  // Keep the old minimal inline canvas as a baseline, not the current Host completion workflow.
  const node = {
    id: 'completed-terminal',
    kind: 'terminal',
    position: { x: 0, y: 0 },
    metadata: { terminal: { terminalStream: completed.terminalStream } }
  };
  const canvas = { version: 1, state: { version: 1, nodes: [node] } };
  const writer = new SnapshotWriter();
  const snapshotPath = path.join(tempDir, 'canvas-state.json');
  const firstWriteBytes = writer.writePersistedCanvasSnapshotToDisk(snapshotPath, canvas);
  node.position.x = 1;
  const moveWriteBytes = writer.writePersistedCanvasSnapshotToDisk(snapshotPath, canvas);
  assert.ok(firstWriteBytes > last.retainedOutputBytes);
  assert.equal(moveWriteBytes, firstWriteBytes);
  console.log(JSON.stringify({
    scenario: 'legacy-completed-inline-canvas-baseline',
    completedSnapshotBytes: Buffer.byteLength(JSON.stringify(completed)),
    inlineCanvasWriteBytes: firstWriteBytes,
    subsequentPositionOnlyWriteBytes: moveWriteBytes
  }));
  node.metadata.terminal = normalizeCompletedRuntimeHistory('terminal', {
    ...node.metadata.terminal, lifecycle: 'closed', persistenceMode: 'snapshot-only', liveSession: false
  });
  const lightweightBytes = writer.writePersistedCanvasSnapshotToDisk(snapshotPath, canvas);
  node.position.x = 2;
  const lightweightMoveBytes = writer.writePersistedCanvasSnapshotToDisk(snapshotPath, canvas);
  assert.ok(lightweightBytes < 1024);
  assert.equal(lightweightMoveBytes, lightweightBytes);
  assert.equal(node.metadata.terminal.terminalStream, undefined);
  console.log(JSON.stringify({
    scenario: 'migrated-completed-lightweight-canvas',
    canvasWriteBytes: lightweightBytes,
    subsequentPositionOnlyWriteBytes: lightweightMoveBytes
  }));
  console.log('Completed history no longer belongs in canvas storage. New paged completion snapshots do not aggregate the journal. This minimal migration/writer comparison is complemented by actual Host completion tests. Total replay, legacy full snapshots, queues and RSS remain outside these byte budgets. No production runtime was started or modified.');
} finally {
  tracker.dispose();
  oversizedTracker.dispose();
  try {
    await journal?.flush();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}
}

async function runPagedCapacity() {
  assert.equal(typeof globalThis.gc, 'function', 'Run --paged-capacity with node --expose-gc.');
  const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsc-runtime-paged-capacity-'));
  const producer = new SerializedTerminalStateTracker(80, 24, { scrollback: 1000, initialOutputSequence: 0 });
  const limits = {
    cacheBytes: 1024 * 1024, cacheEvents: 2048,
    pageBytes: 256 * 1024, pageEvents: 256,
    extraHeapBytes: 64 * 1024 * 1024, extraRssBytes: 128 * 1024 * 1024,
    readMs: 30000, productionBatchEvents: 16
  };
  const color = '\u001b]10;#ff0000\u0007';
  const rowFor = index => `${String(index).padStart(8, '0')}:${'x'.repeat(69)}`;
  const blockFor = index => `${rowFor(index)}\r\n`.repeat(128);
  assert.equal(Buffer.byteLength(blockFor(1)), 10 * 1024);
  let journal;
  let replay;
  let stopSampling;
  try {
    journal = await TerminalSessionJournal.create({
      storageDir, sessionId: 'paged-capacity', initialCols: 80, initialRows: 24, initialScrollback: 1000
    });
    const server = new RuntimeSupervisorServer({
      storageDir, registryPath: path.join(storageDir, 'registry.json')
    }, 'legacy-detached', 'best-effort');
    const session = {
      sessionId: 'paged-capacity', kind: 'terminal', live: true, lifecycle: 'live',
      runtimeBackend: 'legacy-detached', runtimeGuarantee: 'best-effort',
      shellPath: '/bin/sh', cwd: storageDir, cols: 80, rows: 24, scrollback: 1000,
      output: '', outputSequence: 0, terminalAuthorityId: journal.getAuthorityId(),
      terminalJournal: journal, terminalStateTracker: producer,
      terminalOperationChain: Promise.resolve(), terminalMutationAdmissionOpen: true,
      terminalCheckpoint: {
        version: 1, sessionId: 'paged-capacity', authorityId: journal.getAuthorityId(),
        revision: 0, cols: 80, rows: 24, scrollback: 1000, createdAtMs: Date.now(),
        serializedState: producer.getSerializedState()
      }
    };
    server.sessions.set(session.sessionId, session);
    const socket = { destroyed: false };
    server.terminalReads.set(socket, new Map());
    const forbidden = name => () => { throw new Error(`Paged capacity must not call ${name}.`); };
    server.buildTerminalStreamAttachPayload = forbidden('full projection');
    server.toFreshSnapshot = forbidden('full snapshot');
    journal.getEventsAfter = forbidden('getEventsAfter');
    journal.readAllEvents = forbidden('readAllEvents');
    const createFreshSnapshot = server.createFreshSnapshot.bind(server);
    server.createFreshSnapshot = (current, validation, includeProjection) => {
      assert.equal(includeProjection, false, 'Paged operations must explicitly omit full projection.');
      return createFreshSnapshot(current, validation, includeProjection);
    };

    // This is the sole forced GC; all reported peaks include ordinary allocation and collection.
    globalThis.gc();
    const baseline = process.memoryUsage();
    const observation = {
      peakHeapUsed: baseline.heapUsed, peakRss: baseline.rss, maxTimerLagMs: 0, memorySamples: 0
    };
    let phaseObservation;
    const sample = () => {
      const memory = process.memoryUsage();
      for (const target of [observation, phaseObservation].filter(Boolean)) {
        target.peakHeapUsed = Math.max(target.peakHeapUsed, memory.heapUsed);
        target.peakRss = Math.max(target.peakRss, memory.rss);
        target.memorySamples += 1;
      }
      return memory;
    };
    const intervalMs = 10;
    let expectedTimerAt = performance.now() + intervalMs;
    const timer = setInterval(() => {
      const now = performance.now();
      const lag = Math.max(0, now - expectedTimerAt);
      observation.maxTimerLagMs = Math.max(observation.maxTimerLagMs, lag);
      if (phaseObservation) phaseObservation.maxTimerLagMs = Math.max(phaseObservation.maxTimerLagMs, lag);
      expectedTimerAt = now + intervalMs;
      sample();
    }, intervalMs);
    stopSampling = () => clearInterval(timer);
    const append = data => {
      const event = journal.appendOutput(data);
      producer.write(data, { outputSequence: event.revision });
      session.outputSequence = event.revision;
    };
    console.log(JSON.stringify({
      scenario: 'paged-capacity-configuration', multipliers: [1, 2, 4], blocksPerUnit: 640,
      blockBytes: 10 * 1024, cols: 80, rows: 24, scrollback: 1000, limits,
      baseline: { heapUsed: baseline.heapUsed, rss: baseline.rss },
      baselineBoundary: 'after bundle and empty producer setup; one forced GC before production',
      measuredScope: 'journal, Supervisor paging, producer tracker and one replay tracker; no socket, Host, Webview or PTY'
    }));
    append(color);
    let producedBlocks = 0;
    const violations = [];
    for (const multiplier of [1, 2, 4]) {
      const memoryAtStart = sample();
      phaseObservation = {
        peakHeapUsed: memoryAtStart.heapUsed, peakRss: memoryAtStart.rss,
        maxTimerLagMs: 0, memorySamples: 0
      };
      const targetBlocks = 640 * multiplier;
      const productionStarted = performance.now();
      while (producedBlocks < targetBlocks) {
        const batchEnd = Math.min(targetBlocks, producedBlocks + limits.productionBatchEvents);
        while (producedBlocks < batchEnd) append(blockFor(++producedBlocks));
        sample();
        await journal.flush();
        await producer.flush();
        sample();
      }
      const productionMs = performance.now() - productionStarted;
      assert.deepEqual(await producer.flushValidatedCheckpoint(), { eligible: false, reason: 'color-state' });
      const cache = journal.getCacheStats();
      assert.equal(cache.maxBytes, limits.cacheBytes);
      assert.equal(cache.maxEvents, limits.cacheEvents);
      assert.ok(cache.encodedBytes <= limits.cacheBytes);
      assert.ok(cache.eventCount <= limits.cacheEvents);
      const snapshot = await server.toAttachSnapshot(session, 'paged-until-exit');
      assert.equal(snapshot.terminalStream, undefined);
      assert.equal(snapshot.terminalStreamPaged, true);
      const readStarted = performance.now();
      const reader = await server.openTerminalRead(socket, {
        sessionId: session.sessionId, authorityId: session.terminalAuthorityId, consumerId: 'editor'
      });
      assert.equal(reader.checkpoint.revision, 0);
      assert.equal(reader.headRevision, targetBlocks + 1);
      replay = new SerializedTerminalStateTracker(80, 24, {
        scrollback: 1000, initialState: reader.checkpoint.serializedState,
        initialOutputSequence: reader.checkpoint.revision
      });
      let revision = reader.checkpoint.revision;
      let pageCount = 0;
      let eventCount = 0;
      let outputBytes = 0;
      let maxPageBytes = 0;
      let maxPageEvents = 0;
      let maxPageReadMs = 0;
      let maxPageApplyMs = 0;
      let maxPageTotalMs = 0;
      try {
        while (revision < reader.headRevision) {
          const pageStarted = performance.now();
          const page = await server.readTerminalPage(socket, {
            sessionId: session.sessionId, authorityId: session.terminalAuthorityId,
            readId: reader.readId, afterRevision: revision
          });
          const pageReadMs = performance.now() - pageStarted;
          sample();
          assert.equal(page.afterRevision, revision);
          assert.equal(page.headRevision, reader.headRevision);
          assert.ok(page.events.length > 0);
          const pageBytes = Buffer.byteLength(JSON.stringify(page.events));
          assert.ok(pageBytes <= limits.pageBytes);
          assert.ok(page.events.length <= limits.pageEvents);
          const applyStarted = performance.now();
          for (const event of page.events) {
            assert.equal(event.revision, revision + 1);
            assert.equal(event.type, 'output');
            assert.equal(event.data, event.revision === 1 ? color : blockFor(event.revision - 1));
            replay.write(event.data, { outputSequence: event.revision });
            revision = event.revision;
            eventCount += 1;
            outputBytes += Buffer.byteLength(event.data);
          }
          assert.equal(page.revision, revision);
          await replay.flush();
          sample();
          pageCount += 1;
          maxPageBytes = Math.max(maxPageBytes, pageBytes);
          maxPageEvents = Math.max(maxPageEvents, page.events.length);
          maxPageReadMs = Math.max(maxPageReadMs, pageReadMs);
          maxPageApplyMs = Math.max(maxPageApplyMs, performance.now() - applyStarted);
          maxPageTotalMs = Math.max(maxPageTotalMs, performance.now() - pageStarted);
        }
        assert.equal(eventCount, targetBlocks + 1);
        assert.equal(outputBytes, targetBlocks * 10 * 1024 + Buffer.byteLength(color));
        assert.deepEqual(await replay.flush(), await producer.flush());
        const buffer = replay.terminal.buffer.active;
        assert.equal(buffer.cursorX, 0);
        assert.equal(buffer.cursorY, 23);
        assert.equal(buffer.baseY, 1000);
        assert.equal(buffer.getLine(buffer.baseY + 22).translateToString(true), rowFor(targetBlocks));
        assert.equal(buffer.getLine(buffer.baseY + 23).translateToString(true), '');
        const readMs = performance.now() - readStarted;
        const memoryAtEnd = sample();
        const extraHeapBytes = Math.max(0, phaseObservation.peakHeapUsed - baseline.heapUsed);
        const extraRssBytes = Math.max(0, phaseObservation.peakRss - baseline.rss);
        const phaseViolations = [];
        if (extraHeapBytes > limits.extraHeapBytes) phaseViolations.push('extra-heap-budget');
        if (extraRssBytes > limits.extraRssBytes) phaseViolations.push('extra-rss-budget');
        if (readMs > limits.readMs) phaseViolations.push('read-time-budget');
        violations.push(...phaseViolations.map(reason => ({ multiplier, reason })));
        console.log(JSON.stringify({
          scenario: 'paged-capacity', multiplier, producedBlocks, eventCount, outputBytes,
          cache, journalDiskBytes: directoryBytes(path.join(storageDir, 'terminal-journals')),
          checkpointRevision: reader.checkpoint.revision, finalRevision: revision,
          screenStateBytes: Buffer.byteLength(producer.getSerializedState().data),
          snapshotBytes: Buffer.byteLength(JSON.stringify(snapshot)),
          descriptorBytes: Buffer.byteLength(JSON.stringify(reader)),
          pageCount, maxPageBytes, maxPageEvents, productionMs, readMs,
          maxPageReadMs, maxPageApplyMs, maxPageTotalMs, ...phaseObservation,
          extraHeapBytes, extraRssBytes,
          endHeapUsed: memoryAtEnd.heapUsed, endRss: memoryAtEnd.rss,
          contentAndFinalStateVerified: true, budgetPassed: phaseViolations.length === 0,
          violations: phaseViolations
        }));
      } finally {
        replay.dispose();
        replay = undefined;
        await server.closeTerminalRead(socket, reader);
      }
    }
    stopSampling();
    console.log(JSON.stringify({
      scenario: 'paged-capacity-summary', ...observation,
      baselineHeapUsed: baseline.heapUsed, baselineRss: baseline.rss,
      extraHeapBytes: Math.max(0, observation.peakHeapUsed - baseline.heapUsed),
      extraRssBytes: Math.max(0, observation.peakRss - baseline.rss),
      budgetPassed: violations.length === 0, violations
    }));
    assert.deepEqual(violations, [], 'Paged capacity exceeded the fixed initial observation budgets.');
  } finally {
    stopSampling?.();
    replay?.dispose();
    producer.dispose();
    try {
      await journal?.flush();
    } finally {
      fs.rmSync(storageDir, { recursive: true, force: true });
    }
  }
}

function directoryBytes(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).reduce((sum, entry) => {
    const entryPath = path.join(directory, entry.name);
    return sum + (entry.isDirectory() ? directoryBytes(entryPath) : fs.statSync(entryPath).size);
  }, 0);
}
