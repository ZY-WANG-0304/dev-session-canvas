import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';
import esbuild from 'esbuild';
import { createLifecycleHost } from '../test/fixtures/linux-lifecycle-host.mjs';

const { values } = parseArgs({ options: {
  output: { type: 'string' }, preflight: { type: 'boolean' }, 'baseline-ref': { type: 'string' }
} });
assert.ok(values.output, 'Specify a new evidence directory with --output');
assert.equal(process.platform, 'linux');
assert.equal(process.arch, 'x64');
assert.equal(process.version, 'v25.6.0');
assert.ok(!process.env.NODE_OPTIONS && !process.env.NODE_PATH, 'Remove runtime injection variables');
if (!values.preflight) assert.equal(typeof globalThis.gc, 'function', 'Use node --expose-gc');
const root = process.cwd();
const directory = path.resolve(values.output);
const extensionRoot = path.join(root, 'extensions/vscode/dev-session-canvas');
const sourceRoot = path.join(extensionRoot, 'src');
const subjectPath = path.join(root, 'scripts/test/fixtures/owned-runtime-capacity-subject.mjs');
const statusPath = path.join(directory, 'subject-status.json');
const require = createRequire(import.meta.url);
const limits = Object.freeze({ cacheBytes: 1024 * 1024, cacheEvents: 2048,
  pageBytes: 256 * 1024, pageEvents: 256, extraHeapBytes: 64 * 1024 * 1024,
  extraRssBytes: 128 * 1024 * 1024, readMs: 30000 });
const color = '\u001b]10;#ff0000\u0007';
const rowFor = index => `${String(index).padStart(8, '0')}:${'x'.repeat(69)}`;
const blockFor = index => `${rowFor(index)}\r\n`.repeat(128);
const sha = value => createHash('sha256').update(value).digest('hex');
const json = (file, value) => fs.writeFile(path.join(directory, file), `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const inputs = new Map();
const baselineRef = values['baseline-ref']
  ? execFileSync('git', ['rev-parse', '--verify', values['baseline-ref']], { encoding: 'utf8' }).trim() : undefined;

async function load(file, { mocks = {} } = {}) {
  const filename = path.resolve(file);
  const bundle = await esbuild.build({ entryPoints: [filename], bundle: true, write: false,
    format: 'cjs', platform: 'node', target: 'node25', metafile: true,
    external: ['vscode', 'node-pty', ...Object.keys(mocks)],
    plugins: baselineRef ? [{ name: 'frozen-product-baseline', setup(build) {
      build.onLoad({ filter: /\.tsx?$/ }, args => {
        if (!args.path.startsWith(`${sourceRoot}${path.sep}`)) return;
        const contents = execFileSync('git', ['show', `${baselineRef}:${path.relative(root, args.path)}`],
          { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
        inputs.set(path.relative(root, args.path), sha(contents));
        return { contents, loader: args.path.endsWith('.tsx') ? 'tsx' : 'ts' };
      });
    } }] : []
  });
  for (const input of Object.keys(bundle.metafile.inputs)) {
    if (!inputs.has(input)) inputs.set(input, sha(await fs.readFile(input)));
  }
  const module = { exports: {} };
  new Function('require', 'module', 'exports', '__filename', '__dirname', bundle.outputFiles[0].text)(
    name => {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      assert.ok(name !== 'node-pty' && !name.endsWith('.node'), 'Authority must not load native code');
      return require(name);
    }, module, module.exports, filename, path.dirname(filename));
  return module.exports;
}

const factory = await load('extensions/vscode/dev-session-canvas/src/panel/linuxExecutionOwnerFactory.ts');
const assets = factory.resolveLinuxExecutionProviderAssets(path.join(extensionRoot, 'dist'));
const manifest = JSON.parse(await fs.readFile(path.join(path.dirname(assets.binaryPath), 'manifest.json'), 'utf8'));
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
await fs.mkdir(directory);
await fs.copyFile(subjectPath, path.join(directory, 'subject-input.mjs'));
await fs.copyFile(path.join(root, 'scripts/diagnostics/audit-owned-runtime-capacity.mjs'), path.join(directory, 'diagnostic-input.mjs'));
const schedule = {
  sourceCommit, baselineRef, platform: process.platform, node: process.version, executable: process.execPath,
  assets, manifest, multipliers: [1, 2, 4], blocksPerUnit: 640, blockBytes: 10240,
  cols: 80, rows: 24, scrollback: 1000, limits, authoritySampleMs: 10, childSampleMs: 100,
  productionPhaseSafetyMs: 90000, sourceSafetyMs: 300000, observationSafetyMs: 300000, cleanupSafetyMs: 35000,
  boundary: 'real owned Linux provider/PTY, in-process Supervisor and Host, Unix socket client, headless paged reader; no Webview, Electron or real Agent',
  memoryBoundary: 'authority process baseline after source ready and empty Supervisor/Host; provider and subject RSS are separate, not included in the 64/128 MiB authority budgets',
  subjectSha256: sha(await fs.readFile(subjectPath)),
  fixtureSha256: sha(await fs.readFile('scripts/test/fixtures/linux-lifecycle-host.mjs')),
  preflight: values.preflight === true
};
await json('schedule.json', schedule);
if (values.preflight) {
  await load('extensions/vscode/dev-session-canvas/src/supervisor/runtimeSupervisorMain.ts');
  await load('extensions/vscode/dev-session-canvas/src/panel/runtimeSupervisorClient.ts');
  const cleanups = [];
  await createLifecycleHost({ directory, subjectPath, load,
    launchSpec: () => ({ file: process.execPath, args: [subjectPath, statusPath], cwd: directory,
      env: {}, cols: 80, rows: 24 }),
    ownerOptions: mode => ({ ...factory.createLinuxExecutionOwnerOptions({ extensionRoot, mode }),
      createTransport() { assert.fail('Preflight must not acquire an execution transport'); } }),
    trackOwner() {}, addCleanup: action => cleanups.push(action)
  }, { label: 'capacity-preflight', runtimePersistenceEnabled: true });
  for (const cleanup of cleanups.reverse()) await cleanup();
  await json('loaded-sources.json', Object.fromEntries(inputs));
  console.log(JSON.stringify({ preflight: true, assetsValidated: true, actualAuthorityEntriesLoaded: true,
    nativeLoaded: false, providerStarted: false, directory }));
} else {
  await run();
}

async function run() {
  const began = performance.now();
  const transports = [];
  const owners = [];
  const cleanupActions = [];
  const counts = { posts: 0, diagnostics: 0, hostBatches: 0, hostInFlight: 0, maxHostInFlight: 0,
    hostBytes: 0, journalBytes: 0, journalEvents: 0, serializations: 0, serializationMs: 0 };
  const hostHash = createHash('sha256');
  const journalHash = createHash('sha256');
  const failures = [];
  const phases = [];
  const violations = [];
  let fixture;
  let server;
  let session;
  let execution;
  let readerClient;
  let retainedReader;
  let socketDirectory;
  let timer;
  let childTimer;
  let memoryBaseline;
  let observation;
  let phaseObservation;
  let subjectPid;
  let hostRevision = 0;
  let releaseHost;
  let hostHeld = false;
  let holdNextHost = true;
  let cleanupSafe = false;
  let productionDeadline = Infinity;
  const hold = new Promise(resolve => { releaseHost = resolve; });
  const assertActive = () => assert.ok(performance.now() < began + 300000, 'Capacity observation safety deadline');
  async function until(condition, label, ms = 30000) {
    const end = Math.min(began + 300000, productionDeadline, performance.now() + ms);
    while (!await condition()) {
      assertActive();
      assert.ok(performance.now() < end, `Observation deadline: ${label}`);
      await delay(5);
    }
  }
  async function before(promise, label, ms = 30000) {
    let timeout;
    try {
      return await Promise.race([promise, new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`Observation deadline: ${label}`)),
          Math.max(0, Math.min(began + 300000, productionDeadline, performance.now() + ms) - performance.now()));
      })]);
    } finally { clearTimeout(timeout); }
  }
  async function status() {
    try { return JSON.parse(await fs.readFile(statusPath, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return undefined; throw error; }
  }
  function sample() {
    const current = process.memoryUsage();
    for (const target of [observation, phaseObservation].filter(Boolean)) {
      target.peakHeapUsed = Math.max(target.peakHeapUsed, current.heapUsed);
      target.peakRss = Math.max(target.peakRss, current.rss);
      target.samples++;
    }
    return current;
  }
  function childRss(pid) {
    if (!pid) return undefined;
    try { return Number(/^VmRSS:\s+(\d+)\s+kB$/m.exec(readFileSync(`/proc/${pid}/status`, 'utf8'))?.[1]) * 1024; }
    catch (error) { if (error.code === 'ENOENT' || error.code === 'ESRCH') return undefined; throw error; }
  }
  function sampleChildren() {
    const providerRss = childRss(transports[0]?.snapshot().pid);
    const subjectRss = childRss(subjectPid);
    for (const target of [observation, phaseObservation].filter(Boolean)) {
      target.providerPeakRss = Math.max(target.providerPeakRss, providerRss || 0);
      target.subjectPeakRss = Math.max(target.subjectPeakRss, subjectRss || 0);
    }
  }
  function freshObservation() {
    const current = process.memoryUsage();
    return { peakHeapUsed: current.heapUsed, peakRss: current.rss, maxTimerLagMs: 0, samples: 0,
      providerPeakRss: 0, subjectPeakRss: 0 };
  }
  const context = {
    directory, subjectPath, load, before, until, assertActive,
    trackOwner: owner => owners.push(owner), addCleanup: fn => cleanupActions.push(fn),
    launchSpec: () => ({ file: process.execPath, args: [subjectPath, statusPath], cwd: directory,
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: directory, TERM: 'xterm-256color', LANG: 'C.UTF-8' },
      cols: 80, rows: 24 }),
    ownerOptions(mode) {
      const options = factory.createLinuxExecutionOwnerOptions({ extensionRoot, mode });
      return { ...options, createTransport(identity) {
        assertActive();
        assert.equal(transports.length, 0, 'Fixed capacity input owns exactly one subject');
        const transport = options.createTransport(identity);
        transports.push(transport);
        return transport;
      } };
    }
  };
  try {
    const { RuntimeSupervisorServer } = await load('extensions/vscode/dev-session-canvas/src/supervisor/runtimeSupervisorMain.ts');
    const { RuntimeSupervisorClient } = await load('extensions/vscode/dev-session-canvas/src/panel/runtimeSupervisorClient.ts');
    const { TerminalAvailableNotifications } = await load('extensions/vscode/dev-session-canvas/src/panel/terminalAvailableNotifications.ts');
    socketDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'dsc-owned-capacity-'));
    const storage = path.join(directory, 'runtime-storage');
    const paths = { storageDir: path.join(storage, 'supervisor'), registryPath: path.join(storage, 'supervisor/registry.json'),
      socketPath: path.join(socketDirectory, 'runtime.sock'), socketLocation: 'runtime-private', runtimeDir: socketDirectory };
    const backend = { kind: 'legacy-detached', guarantee: 'best-effort', label: 'Owned capacity local endpoint', paths,
      async startSupervisor() { assert.fail('The capacity run must not launch or restart a detached Supervisor'); } };
    server = new RuntimeSupervisorServer(paths, backend.kind, backend.guarantee, context.ownerOptions('live-runtime'));
    owners.push(server.executionOwner);
    server.scheduleIdleShutdownIfNeeded = () => {};
    await before(server.start(), 'original Supervisor listener');
    fixture = await createLifecycleHost(context, { label: 'capacity', runtimePersistenceEnabled: true });
    fixture.forbidAcquisitions();
    const host = fixture.host;
    Object.assign(host, {
      terminalAvailableNotifications: new TerminalAvailableNotifications(),
      surfaceLifecycle: { editor: { generation: 0, ready: false, bootstrapAck: false },
        panel: { generation: 0, ready: false, bootstrapAck: false } },
      preferredRuntimeHostBackendKind: backend.kind,
      getRuntimeHostBaseStoragePath: () => storage,
      getRuntimeHostBackend(kind, storagePath) {
        assert.equal(kind, backend.kind);
        if (storagePath !== undefined) assert.equal(path.resolve(storagePath), storage);
        return backend;
      },
      getRuntimeSupervisorScriptPath: () => '/capacity-forbidden-supervisor',
      getRuntimeSupervisorLauncherScriptPath: () => '/capacity-forbidden-launcher',
      getTerminalScrollback: () => 1000,
      postMessage(message) {
        counts.posts++;
        if (message.type === 'host/error' && failures.length < 16) failures.push(message.payload);
      },
      recordDiagnosticEvent(name, detail) {
        counts.diagnostics++;
        if (/Failed|Error/.test(name) && failures.length < 16) failures.push({ name, detail });
      }
    });
    const applyBatch = host.handleRuntimeSupervisorTerminalBatch.bind(host);
    host.handleRuntimeSupervisorTerminalBatch = async (...args) => {
      const batch = args[2];
      counts.hostBatches++;
      counts.hostInFlight++;
      counts.maxHostInFlight = Math.max(counts.maxHostInFlight, counts.hostInFlight);
      try {
        assert.equal(counts.hostInFlight, 1, 'Only one actual Host batch may be in flight');
        if (holdNextHost && batch.events.length > 0) {
          holdNextHost = false;
          hostHeld = true;
          await hold;
        }
        const result = await applyBatch(...args);
        assert.equal(result, 'consumed', 'Actual Host batch must finish its parser barrier');
        for (const event of batch.events) {
          assert.equal(event.revision, hostRevision + 1);
          assert.equal(event.type, 'output');
          hostHash.update(event.data);
          counts.hostBytes += Buffer.byteLength(event.data);
          hostRevision = event.revision;
        }
        sample();
        return result;
      } finally { counts.hostInFlight--; }
    };
    await before(host.persistState({ workspaceStateMode: 'full', requireRootLocalDurability: true }), 'initial Host state');
    await before(host.startTerminalSession(fixture.nodeId, 80, 24), 'actual Host owned Terminal start');
    const managed = host.terminalSessions.get(fixture.nodeId);
    assert.equal(managed.owner, 'supervisor');
    session = server.sessions.get(managed.runtimeSessionId);
    assert.ok(session.ownedExecution);
    assert.equal(session.process, undefined);
    execution = session.ownedExecution;
    await until(async () => (await status())?.ready === true, 'actual source ready');
    subjectPid = (await status()).pid;
    assert.notEqual(subjectPid, transports[0].snapshot().pid);
    const append = session.terminalJournal.appendOutput.bind(session.terminalJournal);
    session.terminalJournal.appendOutput = data => {
      const event = append(data);
      journalHash.update(data);
      counts.journalBytes += Buffer.byteLength(data);
      counts.journalEvents++;
      return event;
    };
    const serialize = session.terminalStateTracker.serializeState.bind(session.terminalStateTracker);
    session.terminalStateTracker.serializeState = () => {
      const start = performance.now();
      const value = serialize();
      counts.serializations++;
      counts.serializationMs += performance.now() - start;
      sample();
      return value;
    };
    readerClient = new RuntimeSupervisorClient({ backend, supervisorScriptPath: '/capacity-forbidden-supervisor',
      supervisorLauncherScriptPath: '/capacity-forbidden-launcher' });
    await readerClient.ensureConnected({ allowRestart: false });
    const { Terminal } = require('@xterm/headless');
    const { SerializeAddon } = require('@xterm/addon-serialize');
    globalThis.gc();
    memoryBaseline = process.memoryUsage();
    observation = freshObservation();
    let expectedAt = performance.now() + 10;
    timer = setInterval(() => {
      const now = performance.now();
      const lag = Math.max(0, now - expectedAt);
      for (const target of [observation, phaseObservation].filter(Boolean)) target.maxTimerLagMs = Math.max(target.maxTimerLagMs, lag);
      expectedAt = now + 10;
      sample();
    }, 10);
    childTimer = setInterval(sampleChildren, 100);
    await json('baseline.json', { heapUsed: memoryBaseline.heapUsed, rss: memoryBaseline.rss,
      sourcePid: subjectPid, providerPid: transports[0].snapshot().pid });
    const expectedHash = createHash('sha256').update(color);
    let expectedBlocks = 0;
    for (const multiplier of [1, 2, 4]) {
      phaseObservation = freshObservation();
      const target = 640 * multiplier;
      const startCounts = { ...counts };
      while (expectedBlocks < target) expectedHash.update(blockFor(++expectedBlocks));
      const expectedBytes = target * 10240 + Buffer.byteLength(color);
      const expectedDigest = expectedHash.copy().digest('hex');
      const productionStarted = performance.now();
      productionDeadline = productionStarted + 90000;
      assert.equal(await before(host.writeExecutionInput('terminal', fixture.nodeId, `produce:${target}\n`), 'produce command'), true);
      await until(async () => (await status())?.blocks === target, `source produced ${target} blocks`, 90000);
      await until(() => counts.journalBytes === expectedBytes &&
        execution.snapshot().adapter.acceptedThrough === execution.snapshot().adapter.consumedThrough,
      'owned parser and journal consumption', 90000);
      if (multiplier === 1) {
        assert.equal(hostHeld, true);
        assert.equal(counts.hostInFlight, 1);
        assert.equal(counts.hostBytes, 0, 'Held Host cannot claim application');
        const nonce = randomBytes(16).toString('hex');
        assert.equal(await before(host.writeExecutionInput('terminal', fixture.nodeId, `ping:${nonce}\n`),
          'input while actual Host is held', 1500), true);
        await until(async () => (await status())?.ping === nonce, 'source input response while Host is held', 1500);
        releaseHost();
      }
      await until(() => counts.hostBytes === expectedBytes && counts.hostInFlight === 0, 'actual Host caught up');
      const productionMs = performance.now() - productionStarted;
      productionDeadline = Infinity;
      assert.equal(journalHash.copy().digest('hex'), expectedDigest);
      assert.equal(hostHash.copy().digest('hex'), expectedDigest);
      assert.equal(hostRevision, session.terminalJournal.getRevision());
      assert.deepEqual(await before(session.terminalStateTracker.flushValidatedCheckpoint(), 'checkpoint rejection'),
        { eligible: false, reason: 'color-state' });
      const cache = session.terminalJournal.getCacheStats();
      assert.ok(cache.encodedBytes <= limits.cacheBytes && cache.eventCount <= limits.cacheEvents);
      const readStarted = performance.now();
      const reader = await before(readerClient.openTerminalRead({ sessionId: session.sessionId,
        authorityId: session.terminalAuthorityId, consumerId: 'editor', settlementMode: 'final-application-v1' }), 'open real reader');
      retainedReader = reader;
      assert.equal(reader.checkpoint.revision, 0);
      const terminal = new Terminal({ cols: 80, rows: 24, scrollback: 1000, allowProposedApi: true });
      const addon = new SerializeAddon();
      terminal.loadAddon(addon);
      const replayHash = createHash('sha256');
      let revision = reader.checkpoint.revision;
      let pageCount = 0;
      let replayBytes = 0;
      let maxPageBytes = 0;
      let maxPageEvents = 0;
      try {
        if (reader.checkpoint.serializedState.data) await before(
          new Promise(resolve => terminal.write(reader.checkpoint.serializedState.data, resolve)), 'apply reader checkpoint');
        while (revision < reader.headRevision) {
          const page = await before(readerClient.readTerminalPage({ sessionId: session.sessionId, authorityId: reader.authorityId,
            readId: reader.readId, afterRevision: revision }), 'read real page');
          assert.equal(page.afterRevision, revision);
          assert.equal(page.headRevision, reader.headRevision);
          assert.ok(page.events.length > 0 && page.events.length <= limits.pageEvents);
          const pageBytes = Buffer.byteLength(JSON.stringify(page.events));
          assert.ok(pageBytes <= limits.pageBytes);
          maxPageBytes = Math.max(maxPageBytes, pageBytes);
          maxPageEvents = Math.max(maxPageEvents, page.events.length);
          for (const event of page.events) {
            assert.equal(event.revision, revision + 1);
            assert.equal(event.type, 'output');
            replayHash.update(event.data);
            replayBytes += Buffer.byteLength(event.data);
            revision = event.revision;
          }
          assert.equal(page.revision, revision);
          await before(new Promise(resolve => terminal.write(page.events.map(event => event.data).join(''), resolve)),
            'apply real reader page');
          pageCount++;
          sample();
        }
        const readMs = performance.now() - readStarted;
        assert.equal(replayBytes, expectedBytes);
        assert.equal(replayHash.digest('hex'), expectedDigest);
        const buffer = terminal.buffer.active;
        assert.equal(buffer.cursorX, 0);
        assert.equal(buffer.cursorY, 23);
        assert.equal(buffer.baseY, 1000);
        assert.equal(buffer.getLine(buffer.baseY + 22).translateToString(true), rowFor(target));
        assert.equal(buffer.getLine(buffer.baseY + 23).translateToString(true), '');
        const producerState = await before(session.terminalStateTracker.flush(), 'final sampled serialization');
        assert.equal(addon.serialize({ scrollback: 1000, excludeAltBuffer: false, excludeModes: false }), producerState.data);
        assert.equal(producerState.outputSequence, revision);
        sample();
        sampleChildren();
        const extraHeapBytes = Math.max(0, phaseObservation.peakHeapUsed - memoryBaseline.heapUsed);
        const extraRssBytes = Math.max(0, phaseObservation.peakRss - memoryBaseline.rss);
        const phaseViolations = [];
        if (extraHeapBytes > limits.extraHeapBytes) phaseViolations.push('extra-heap-budget');
        if (extraRssBytes > limits.extraRssBytes) phaseViolations.push('extra-rss-budget');
        if (readMs > limits.readMs) phaseViolations.push('read-time-budget');
        violations.push(...phaseViolations.map(reason => ({ multiplier, reason })));
        const result = { multiplier, blocks: target, outputBytes: expectedBytes, sha256: expectedDigest,
          journalRevision: revision, hostRevision, pageCount, maxPageBytes, maxPageEvents, cache,
          productionMs, readMs, extraHeapBytes, extraRssBytes, ...phaseObservation,
          serializations: counts.serializations - startCounts.serializations,
          serializationMs: counts.serializationMs - startCounts.serializationMs,
          hostBatches: counts.hostBatches - startCounts.hostBatches, maxHostInFlight: counts.maxHostInFlight,
          contentAndFinalStateVerified: true, budgetPassed: phaseViolations.length === 0, violations: phaseViolations };
        phases.push(result);
        await json(`phase-${multiplier}x.json`, result);
        console.log(JSON.stringify(result));
      } finally { addon.dispose(); terminal.dispose(); }
      if (multiplier !== 4) {
        await before(readerClient.closeTerminalRead({ sessionId: session.sessionId, authorityId: reader.authorityId,
          readId: reader.readId, outcome: { kind: 'cancelled', reason: 'live-capacity-sample-complete' } }), 'close sampled live reader');
        retainedReader = undefined;
      }
    }
    assert.equal(await before(host.writeExecutionInput('terminal', fixture.nodeId, 'finish\n'), 'natural finish command'), true);
    await until(() => execution.snapshot().terminal?.kind === 'applied', 'owned natural final terminal', 16000);
    const finalRevision = execution.snapshot().terminal.finalRevision;
    assert.equal(finalRevision, hostRevision);
    await before(readerClient.closeTerminalRead({ sessionId: session.sessionId, authorityId: retainedReader.authorityId,
      readId: retainedReader.readId, outcome: { kind: 'applied', finalRevision } }), 'record final reader application');
    retainedReader = undefined;
    await until(() => execution.snapshot().retired && !server.sessions.has(session.sessionId) &&
      !host.terminalSessions.has(fixture.nodeId), 'natural completion and retirement', 16000);
    const final = execution.snapshot();
    assert.equal(final.adapter.process.kind, 'exited');
    assert.equal(final.adapter.process.exitCode, 0);
    assert.equal(final.adapter.source.kind, 'eof');
    assert.equal(final.adapter.pendingBytes, 0);
    assert.equal(final.adapter.acceptedThrough, final.adapter.consumedThrough);
    assert.equal(final.adapter.firstFault, undefined);
    assert.ok(Object.values(final.adapter.resources).every(resource => resource.current?.kind === 'released'));
    await json('final-execution.json', final);
    assert.deepEqual(failures, []);
  } catch (error) {
    failures.push({ message: error.message, stack: error.stack });
  } finally {
    releaseHost();
    clearInterval(timer);
    clearInterval(childTimer);
    const cleanupErrors = [];
    const cleanupReports = {};
    const cleanupDeadline = performance.now() + 35000;
    async function cleanupBefore(promise, label) {
      let timeout;
      try {
        return await Promise.race([promise, new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error(`Cleanup deadline: ${label}`)),
            Math.max(0, cleanupDeadline - performance.now()));
        })]);
      } finally { clearTimeout(timeout); }
    }
    async function cleanupStep(action, label) {
      try { return await cleanupBefore(Promise.resolve().then(action), label); }
      catch (error) { cleanupErrors.push({ label, message: error.message, stack: error.stack }); }
    }
    if (retainedReader && readerClient) cleanupReports.reader = await cleanupStep(() => readerClient.closeTerminalRead({ sessionId: retainedReader.sessionId,
        authorityId: retainedReader.authorityId, readId: retainedReader.readId,
        outcome: { kind: 'cancelled', reason: 'capacity-cleanup' } }), 'original reader');
    readerClient?.dispose();
    if (fixture) cleanupReports.host = await cleanupStep(() => fixture.host.prepareForDeactivation(), 'original Host');
    if (server) cleanupReports.supervisor = await cleanupStep(() => server.prepareForShutdown('Owned capacity cleanup.'), 'original Supervisor');
    for (const cleanup of cleanupActions.reverse()) await cleanupStep(cleanup, 'original fixture');
    try {
      while (!transports.every(transport => transport.snapshot().closed)) {
        assert.ok(performance.now() < cleanupDeadline, 'Cleanup deadline: original provider close');
        await delay(5);
      }
      const originals = new Set([...owners.flatMap(owner => owner.list()), ...(execution ? [execution] : [])]);
      const reportsSettled = (!retainedReader || cleanupReports.reader?.settlement === 'recorded') &&
        (!fixture || (cleanupReports.host?.kind === 'settled' &&
          ['local', 'canvasSnapshot', 'remoteDetach'].every(domain => cleanupReports.host[domain]?.kind === 'settled'))) &&
        (!server || (cleanupReports.supervisor?.kind === 'settled' && cleanupReports.supervisor.pending.length === 0 &&
          ['execution', 'readers', 'registry', 'server', 'sockets'].every(domain => cleanupReports.supervisor.domains[domain] === 'settled') &&
          Object.keys(cleanupReports.supervisor.errors).length === 0));
      cleanupSafe = reportsSettled && cleanupErrors.length === 0 &&
        transports.every(transport => transport.snapshot().closed) && [...originals].every(record => {
        const snapshot = record.snapshot();
        return snapshot.settled && snapshot.adapter && !snapshot.adapter.resourceLedgerIncomplete &&
          ['provider-control', 'pty-master', 'pty-child', 'pty-source'].every(
            resource => snapshot.adapter.resources[resource]?.current?.kind === 'released');
      });
      await json('cleanup-executions.json', [...originals].map(record => record.snapshot()));
      if (server?.shutdownBoundary?.keepAlive && cleanupSafe) clearInterval(server.shutdownBoundary.keepAlive);
      if (socketDirectory) await fs.rmdir(socketDirectory);
    } catch (error) { cleanupErrors.push({ message: error.message, stack: error.stack }); }
    await json('loaded-sources.json', Object.fromEntries(inputs));
    const result = { sourceCommit, baselineRef, phases: phases.length, counts, observation,
      memoryBaseline: memoryBaseline && { heapUsed: memoryBaseline.heapUsed, rss: memoryBaseline.rss },
      failures, violations, cleanupSafe, cleanupReports, cleanupErrors,
      providers: transports.map(transport => transport.snapshot()),
      passed: phases.length === 3 && failures.length === 0 && violations.length === 0 && cleanupSafe && cleanupErrors.length === 0 };
    await json('result.json', result);
    console.log(JSON.stringify(result));
    if (!result.passed) process.exitCode = 1;
  }
}
