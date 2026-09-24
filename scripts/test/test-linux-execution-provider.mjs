import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import esbuild from 'esbuild';

assert.equal(process.platform, 'linux', 'S3 is frozen for local Linux');
assert.equal(process.version, 'v22.23.2', 'authority, provider, and subject must use the frozen Node runtime');

const outputDir = path.resolve('.debug/s3-linux-provider-first');
const binaryPath = path.resolve('.debug/s3-linux-provider-build-first/pty.node');
const buildManifestPath = path.join(path.dirname(binaryPath), 'build.json');
const buildDir = path.join(outputDir, 'bundled');
const subjectSource = path.resolve('scripts/test/fixtures/linux-execution-subject.mjs');
const subjectPath = path.join(buildDir, 'subject.mjs');
const require = createRequire(import.meta.url);
const resources = ['pty-child', 'pty-master', 'pty-source'];
const normalWritten = '\u001b[2J\u001b[Hprefix:' + 'a'.repeat(2048) + '\n'
  + '\u001b[3J\u001b[2J\u001b[HROOT\n\u001b[3;5H\u001b[31m\u4e2d\u6587\u001b[0m\u001b[5;7H';
const expectedNormal = normalWritten.replace(/\n/g, '\r\n');
const expectedRows = Array.from({ length: 24 }, (_, row) => row === 0 ? 'ROOT' : row === 2 ? '    \u4e2d\u6587' : '');
const cases = [];
const providers = [];
let permitNext = true;

async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
}

async function until(predicate, deadline, label) {
  while (!predicate()) {
    if (performance.now() >= deadline) throw new Error(`Observation deadline: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function before(promise, deadline, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Observation deadline: ${label}`)), Math.max(0, deadline - performance.now()));
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function terminalState(tracker) {
  const buffer = tracker.terminal.buffer.active;
  return {
    cursorX: buffer.cursorX,
    cursorY: buffer.cursorY,
    baseY: buffer.baseY,
    viewportY: buffer.viewportY,
    rows: Array.from({ length: 24 }, (_, row) => buffer.getLine(buffer.baseY + row)?.translateToString(true) ?? ''),
    markedCells: [4, 6].map((column) => {
      const cell = buffer.getLine(buffer.baseY + 2)?.getCell(column);
      return { column, chars: cell?.getChars(), width: cell?.getWidth(), foreground: cell?.getFgColor() };
    })
  };
}

function subjectSettled(h) {
  const snapshot = h.session.snapshot();
  return ['exited', 'signaled', 'terminated'].includes(snapshot.process?.kind)
    && snapshot.resources['pty-child']?.current?.kind === 'released';
}

function nativeResourcesSettled(h) {
  const snapshot = h.session.snapshot();
  return subjectSettled(h) && !snapshot.resourceLedgerIncomplete
    && resources.every((name) => snapshot.resources[name]?.current?.kind === 'released');
}

await mkdir(outputDir);
await mkdir(buildDir);
const binaryHash = createHash('sha256').update(await readFile(binaryPath)).digest('hex');
const buildManifest = JSON.parse(await readFile(buildManifestPath, 'utf8'));
assert.equal(buildManifest.kind, 'linux-execution-provider-s3');
assert.equal(buildManifest.status, 'built-and-load-verified');
assert.equal(buildManifest.node, process.versions.node);
assert.equal(buildManifest.binary.path, binaryPath);
assert.equal(buildManifest.binary.sha256, binaryHash);
assert.equal(buildManifest.load.path, binaryPath);
await writeJson(path.join(outputDir, 'schedule.json'), {
  platform: process.platform, node: process.version, executable: process.execPath,
  binaryPath, binaryHash, cases: ['normal', 'flood'], caseBudgetMs: 30000,
  subjectSafetyMs: 20000, termMs: 2000, killMs: 2000, releaseObservationMs: 2000,
  providerCount: 2, subjectCount: 2, cols: 80, rows: 24, pollIntervalMs: 5,
  buildManifest
});
await writeJson(path.join(outputDir, 'expected.json'), {
  normal: { exitCode: 7, rows: expectedRows, cursorX: 6, cursorY: 4,
    markedCells: [{ column: 4, chars: '\u4e2d', width: 2, foreground: 1 }, { column: 6, chars: '\u6587', width: 2, foreground: 1 }],
    writtenBytes: Buffer.byteLength(normalWritten), ptyBytesWithOnlcr: Buffer.byteLength(expectedNormal) },
  flood: { subjectMaximumWrittenBytes: 256 * 4096, creditFrames: 16, processSignal: 'SIGTERM',
    source: 'real zero/eio', acquiredBytes: 'native readBytes equals delivered UTF-8 bytes' }
});
await writeFile(path.join(outputDir, 'normal-expected.txt'), expectedNormal, { flag: 'wx' });
await copyFile(subjectSource, subjectPath);
await esbuild.build({
  entryPoints: {
    adapter: path.resolve('extensions/vscode/dev-session-canvas/src/panel/executionSessionAdapter.ts'),
    transport: path.resolve('extensions/vscode/dev-session-canvas/src/panel/executionProviderTransport.ts'),
    tracker: path.resolve('extensions/vscode/dev-session-canvas/src/common/serializedTerminalState.ts'),
    fixture: path.resolve('scripts/test/fixtures/linux-execution-provider-fixture.ts')
  },
  bundle: true, format: 'cjs', platform: 'node', target: 'node22', outdir: buildDir,
  outExtension: { '.js': '.cjs' }
});
const sourceFiles = [
  'scripts/test/test-linux-execution-provider.mjs',
  'scripts/test/fixtures/linux-execution-provider-fixture.ts',
  'scripts/test/fixtures/linux-execution-subject.mjs',
  'extensions/vscode/dev-session-canvas/src/panel/linuxExecutionProvider.ts',
  'extensions/vscode/dev-session-canvas/src/panel/executionProviderChannel.ts',
  'extensions/vscode/dev-session-canvas/src/panel/executionProviderTransport.ts',
  'extensions/vscode/dev-session-canvas/src/panel/executionSessionAdapter.ts',
  'extensions/vscode/dev-session-canvas/src/common/executionLifecycle.ts',
  'extensions/vscode/dev-session-canvas/src/common/serializedTerminalState.ts'
];
const sourceHashes = {};
for (const file of sourceFiles) sourceHashes[file] = createHash('sha256').update(await readFile(file)).digest('hex');
await writeJson(path.join(outputDir, 'sources.json'), sourceHashes);

const { prepareExecution, createExecutionAuthority } = require(path.join(buildDir, 'adapter.cjs'));
const { createExecutionProviderTransport, createNodeExecutionScheduler } = require(path.join(buildDir, 'transport.cjs'));
const { SerializedTerminalStateTracker } = require(path.join(buildDir, 'tracker.cjs'));

function execution(mode, directory, deadline) {
  if (!Number.isFinite(deadline) || performance.now() >= deadline) throw new Error('Deadline passed before S3 acquisition');
  const identity = {
    executionId: mode === 'normal' ? '30000000-0000-4000-8000-000000000001' : '30000000-0000-4000-8000-000000000002',
    generation: `s3-linux-${mode}`
  };
  const authority = createExecutionAuthority();
  const providerResultPath = path.join(directory, 'provider-result.json');
  const transport = createExecutionProviderTransport({ identity, executable: process.execPath,
    entryPoint: path.join(buildDir, 'fixture.cjs'), args: [binaryPath, providerResultPath] });
  const tracker = new SerializedTerminalStateTracker(80, 24, { scrollback: 100, initialOutputSequence: 0 });
  const events = { data: [], processes: [], resources: [], seals: [], faults: [], consumed: [] };
  const stops = new Map();
  let paused = mode === 'flood';
  let releaseConsumption;
  const consumptionGate = new Promise((resolve) => { releaseConsumption = resolve; });
  const session = prepareExecution(identity, { file: process.execPath, args: [subjectPath, mode], cwd: path.dirname(subjectPath),
    env: { ...process.env, TERM: 'xterm-256color' } }, { authority, transport, scheduler: createNodeExecutionScheduler() });
  session.bind({
    data: (batch) => events.data.push(batch),
    processResult: (eventIdentity, result) => events.processes.push({ identity: eventIdentity, result, observedAt: performance.now() }),
    outputSeal: (seal) => events.seals.push({ seal, observedAt: performance.now() }),
    resourceResult: (eventIdentity, resourceId, result) => events.resources.push({ identity: eventIdentity, resourceId, result, observedAt: performance.now() }),
    fault: (eventIdentity, reason) => events.faults.push({ identity: eventIdentity, reason, observedAt: performance.now() })
  }, async (batch) => {
    if (paused) await consumptionGate;
    for (const data of batch) tracker.write(data.text, { outputSequence: data.sequence });
    const state = await tracker.flush();
    events.consumed.push({ throughFrameId: batch.at(-1).frameId, throughSequence: batch.at(-1).sequence,
      outputSequence: state.outputSequence, completedAt: performance.now() });
  });
  const h = { identity, mode, directory, providerResultPath, authority, transport, tracker, session, events,
    resume() { paused = false; releaseConsumption(); },
    stop(kind, stopDeadline) {
      if (!stops.has(kind)) stops.set(kind, session.requestStop(`stop-${kind}`, kind, stopDeadline));
      return stops.get(kind);
    },
    output() { return events.data.map((batch) => batch.text).join(''); }
  };
  providers.push(h);
  h.start = session.start('start', deadline);
  return h;
}

async function cleanup(h) {
  h.resume();
  const steps = [];
  if (!subjectSettled(h)) {
    const termDeadline = performance.now() + 2000;
    try {
      h.stop('graceful', termDeadline);
      await until(() => subjectSettled(h), termDeadline, 'cleanup TERM subject reaping');
      steps.push('subject-confirmed-after-TERM');
    } catch (error) { steps.push(error.message); }
  }
  if (!subjectSettled(h)) {
    const killDeadline = performance.now() + 2000;
    try {
      h.stop('force', killDeadline);
      await until(() => subjectSettled(h), killDeadline, 'cleanup KILL subject reaping');
      steps.push('subject-confirmed-after-KILL');
    } catch (error) { steps.push(error.message); }
  }
  if (!subjectSettled(h)) return { safe: false, steps, reason: 'Subject termination/reaping remains unconfirmed; provider not killed' };
  try {
    await until(() => nativeResourcesSettled(h), performance.now() + 2000, 'native owner cleanup');
  } catch (error) { return { safe: false, steps, reason: error.message }; }
  if (!h.transport.snapshot().closed) {
    try {
      await before(h.transport.closed, performance.now() + 2000, 'provider close after native cleanup');
    } catch {
      const now = performance.now();
      const result = await h.transport.terminate({ termDeadline: now + 2000, killDeadline: now + 4000 });
      if (result.kind !== 'closed') return { safe: false, steps, reason: 'Provider termination is unconfirmed' };
      steps.push('provider-terminated-after-proven-native-cleanup');
    }
  }
  return { safe: h.transport.snapshot().closed, steps };
}

async function verifyResult(h, deadline) {
  await before(h.transport.closed, deadline, 'provider close');
  await until(() => h.session.snapshot().state === 'settled', deadline, 'adapter resource and consumption settlement');
  const saved = JSON.parse(await readFile(h.providerResultPath, 'utf8'));
  assert.deepEqual(saved.identity, h.identity);
  assert.equal(saved.node, process.version);
  assert.equal(saved.binaryPath, binaryPath);
  const result = saved.result;
  assert.equal(result.kind, 'closed');
  assert.equal(result.resourcesSettled, true);
  assert.equal(result.source.kind, 'eof');
  assert.ok(['zero', 'eio'].includes(result.sourceEndEvidence));
  assert.equal(result.native.token, h.identity.executionId);
  assert.equal(result.native.pid, h.start.current.pid);
  assert.equal(result.native.masterAcquired, true);
  assert.equal(result.native.childAcquired, true);
  assert.equal(result.native.nonblockConfirmed, true);
  assert.equal(result.native.closeAttempted, true);
  assert.equal(result.native.closeResult, 0);
  assert.equal(result.native.lastReadKind, 'eof');
  assert.equal(result.native.eofReason, result.sourceEndEvidence);
  assert.equal(result.native.readBytes, Buffer.byteLength(h.output(), 'utf8'));
  assert.ok(result.native.readCalls > 0);
  assert.ok(result.native.pollCalls > 0);
  assert.equal(result.native.killCalls, 0);
  assert.equal(h.events.seals.length, 1);
  assert.equal(h.events.seals[0].seal.source.kind, 'eof');
  assert.equal(h.session.snapshot().pendingBytes, 0);
  assert.equal(h.authority.snapshot().active, 0);
  assert.equal(h.authority.snapshot().blockedReason, undefined);
  assert.equal(h.events.faults.length, 0);
  for (const resourceId of [...resources, 'provider-control']) {
    assert.equal(h.session.snapshot().resources[resourceId].current.kind, 'released', resourceId);
  }
  h.providerResult = saved;
  h.serialized = await h.tracker.flush();
  assert.equal(h.serialized.outputSequence, h.session.snapshot().acceptedThrough);
  h.finalTerminal = terminalState(h.tracker);
  if (h.mode === 'normal') {
    assert.equal(h.output(), expectedNormal);
    assert.equal(result.native.waitStatus.kind, 'exited');
    assert.equal(result.native.waitStatus.exitCode, 7);
    assert.equal(result.native.termCalls, 0);
    assert.deepEqual(h.finalTerminal.rows, expectedRows);
    assert.equal(h.finalTerminal.cursorX, 6);
    assert.equal(h.finalTerminal.cursorY, 4);
    assert.deepEqual(h.finalTerminal.markedCells, [
      { column: 4, chars: '\u4e2d', width: 2, foreground: 1 },
      { column: 6, chars: '\u6587', width: 2, foreground: 1 }
    ]);
  } else {
    assert.match(h.output(), /^x+$/);
    assert.ok(h.events.data.length > 16);
    assert.equal(result.native.waitStatus.kind, 'signaled');
    assert.equal(result.native.waitStatus.signalCode, 15);
    assert.equal(result.native.termCalls, 1);
    assert.equal(h.events.seals[0].seal.process.signal, 'SIGTERM');
  }
}

try {
  for (const mode of ['normal', 'flood']) {
    if (!permitNext) {
      cases.push({ mode, status: 'not-run', reason: 'Previous ownership could not be safely settled' });
      continue;
    }
    const directory = path.join(outputDir, mode);
    await mkdir(directory);
    const deadline = performance.now() + 30000;
    const report = { mode, status: 'running', deadline };
    let h;
    try {
      h = execution(mode, directory, deadline);
      const started = await before(h.start.first, deadline, 'native subject start');
      assert.equal(started.kind, 'started');
      assert.notEqual(started.pid, h.transport.snapshot().pid);
      if (mode === 'flood') {
        await until(() => h.session.snapshot().pendingFrames === 16, deadline, 'flood credit window');
        h.pausedSnapshot = h.session.snapshot();
        assert.equal(h.pausedSnapshot.consumedThrough, 0);
        const stop = h.stop('graceful', deadline);
        assert.equal((await before(stop.first, deadline, 'stop with paused consumption')).kind, 'accepted');
        await until(() => subjectSettled(h), deadline, 'wait/reaping while output credit is full');
        assert.equal(h.session.snapshot().consumedThrough, 0);
        h.stoppedBeforeConsumption = h.session.snapshot();
        h.resume();
      }
      await verifyResult(h, deadline);
      report.status = 'passed';
      report.firstSnapshot = h.session.snapshot();
      console.log(`PASS S3 ${mode}`);
    } catch (error) {
      report.status = 'failed';
      report.error = error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error);
      report.firstSnapshot = h?.session.snapshot();
      console.error(`FAIL S3 ${mode}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      if (h) {
        report.cleanup = await cleanup(h);
        permitNext = report.cleanup.safe;
        report.finalSnapshot = h.session.snapshot();
        report.transport = h.transport.snapshot();
        await writeFile(path.join(directory, 'received.txt'), h.output(), { flag: 'wx' });
        await writeJson(path.join(directory, 'facts.json'), {
          identity: h.identity, start: h.start.current, processes: h.events.processes, resources: h.events.resources,
          seals: h.events.seals, faults: h.events.faults, consumed: h.events.consumed,
          outputBytes: Buffer.byteLength(h.output()), frames: h.events.data.map(({ text, ...frame }) => frame),
          pausedSnapshot: h.pausedSnapshot, stoppedBeforeConsumption: h.stoppedBeforeConsumption,
          serialized: h.serialized, terminal: h.finalTerminal
        });
        h.tracker.dispose();
      }
      cases.push(report);
      await writeJson(path.join(directory, 'result.json'), report);
    }
  }
} finally {
  await writeJson(path.join(outputDir, 'summary.json'), {
    platform: process.platform, node: process.version, binaryPath, binaryHash, cases,
    actualProviders: providers.filter((h) => h.transport.snapshot().spawned).length,
    actualSubjectsConfirmed: providers.filter((h) => h.start.current?.kind === 'started').length,
    providerClosesConfirmed: providers.filter((h) => h.transport.snapshot().closed).length,
    allOwnershipSettled: permitNext
  });
}

if (!permitNext && providers.some((h) => !h.transport.snapshot().closed)) {
  process.exitCode = 1;
  console.error('STOP S3: ownership is unknown; retaining live providers for parent-session diagnosis.');
  await Promise.all(providers.map((h) => h.transport.closed));
}
assert.equal(permitNext, true, 'Ownership remains unconfirmed; the provider was deliberately not killed');
assert.equal(cases.filter((item) => item.status === 'passed').length, 2, 'The first fixed S3 matrix did not pass both cases');
console.log('Linux execution provider: 2/2 fixed PTY cases passed; evidence in .debug/s3-linux-provider-first');
