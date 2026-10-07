import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import esbuild from 'esbuild';
import contract from '../../tests/vscode-smoke/runtime-reload-contract.cjs';
import { buildVSCodeArgs } from '../smoke/vscode-smoke-runner.mjs';
import { prepareReloadDriver, selectReloadInput } from '../smoke/run-vscode-runtime-reload-candidate.mjs';

const { assertControl, assertReloadReceipts, assertRuntimeDiscarded, sameIdentity, sameLiveIdentity,
  exitedIdentity, signalOwned, fixedVsixSha256, assertSnapshotNode, replaySnapshotTail, snapshotTail, readSnapshotHandshake } = contract;
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const identity = pid => ({ pid, ppid: 1, state: 'S', startTicks: String(pid * 100), executable: `/owned/${pid}` });
const closed = () => ({ status: 'closed', metadata: { terminal: {
  terminalHistoryDiscarded: true, liveSession: false, lastExitCode: 0
} } });
const receipts = () => {
  const nonce = 'c6737d22-8f8a-4a33-8a61-d9437ee529e3';
  const a = { id: 'a', supervisor: identity(20), provider: identity(21), identity: identity(22),
    binding: { runtimeBackend: 'legacy-detached', runtimeStoragePath: '/owned/storage', runtimeSessionId: 'session-a' },
    reader: { sessionId: 'session-a', authorityId: 'original-authority', readId: 'before' } };
  const setup = { nonce, pass: true, ui: identity(10), host: identity(11), a, b: { id: 'b', identity: identity(23) }, frameId: 'old-frame' };
  return { control: { schemaVersion: 1, nonce, deadlineAt: 180000, phase: 'verify', reloadRequests: 1, setup },
    launcher: { ui: identity(10), spawnCount: 1 }, setup,
    verify: { nonce, pass: true, reloadRequests: 1, ui: identity(10), host: identity(12), oldHostAtVerify: null,
      a: { ...a, reader: { ...a.reader, readId: 'after' } }, frameId: 'new-frame',
      interaction: { nonce, applied: true }, completedNodeId: 'b', completedNode: closed(), completedAttachEmpty: true,
      restartedExecutionEvents: [], aCompletedApplied: true, finishedNode: closed() },
    cleanup: { nonce, pass: true, runtime: { bindings: [], pendingRuntimeSupervisorOperationCount: 0 },
      nodesRemaining: 0, resourcesExited: true }, exit: { code: 0, signal: null }, fallback: [] };
};
const snapshotNode = () => ({ id: 'a', status: 'closed', metadata: { terminal: {
  persistenceMode: 'snapshot-only', lifecycle: 'closed', liveSession: false, lastExitCode: 7,
  outputSequence: 4, lastCols: 80, lastRows: 7, serializedTerminalState: { data: snapshotTail }
} } });
const snapshotReceipts = () => {
  const value = receipts();
  value.control.mode = 'snapshot-only';
  delete value.setup.b;
  value.setup.mode = 'snapshot-only';
  value.setup.diskPaths = ['/original/workspace.json', '/original/root.json'];
  value.verify = { nonce: value.control.nonce, pass: true, mode: 'snapshot-only', reloadRequests: 1,
    ui: identity(10), host: identity(12), oldHostAtVerify: null, frameId: 'snapshot-new-frame',
    node: snapshotNode(), diskReadBeforeDriverProductCalls: true,
    productActivationAtDiskRead: { before: true, after: true }, oldHostExclusiveDiskWriteClaim: false,
    disk: value.setup.diskPaths.map(path => ({ path, node: snapshotNode() })),
    subjectSignal: { signal: 'SIGHUP' }, subjectCompleted: { exitCode: 7, writtenComplete: true },
    writtenMatches: true, replayMatches: true, resourcesExited: true,
    resourceChecks: [value.setup.a.provider, value.setup.a.identity].map(expected => ({ expected, after: null })),
    page: { applied: true, cursorX: 6, cursorY: 4, visibleLines: ['ROOT', '', '    \u4e2d\u6587', '', '', '', ''] },
    restartedExecutionEvents: [], replacementProviders: [], oldReaderOutcome: 'not-observed', sourceEofClaim: false };
  return value;
};

test('snapshot-only requires an explicit frozen package while original Runtime package remains unchanged', () => {
  assert.deepEqual(selectReloadInput({}), { mode: 'live-runtime', currentState: false, expectedSha256: fixedVsixSha256 });
  assert.deepEqual(selectReloadInput({ mode: 'snapshot-only', 'expected-vsix-sha256': 'b'.repeat(64) }),
    { mode: 'snapshot-only', currentState: false, expectedSha256: 'b'.repeat(64) });
  assert.deepEqual(selectReloadInput({ mode: 'live-runtime', 'current-state': true, 'expected-vsix-sha256': 'c'.repeat(64) }),
    { mode: 'live-runtime', currentState: true, expectedSha256: 'c'.repeat(64) });
  for (const value of [{ mode: 'snapshot-only' }, { mode: 'snapshot-only', 'expected-vsix-sha256': 'unknown' },
    { mode: 'live-runtime', 'expected-vsix-sha256': 'b'.repeat(64) },
    { mode: 'live-runtime', 'current-state': true },
    { mode: 'live-runtime', 'current-state': true, 'expected-vsix-sha256': 'unknown' },
    { mode: 'snapshot-only', 'current-state': true, 'expected-vsix-sha256': 'b'.repeat(64) }, { mode: 'other' }]) {
    assert.throws(() => selectReloadInput(value));
  }
});

test('the actual compact reload fixture keeps new replies on separate lines across current-state restore', async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'dsc-reload-fixture-'));
  const { Terminal } = require('@xterm/headless');
  const original = new Terminal({ cols: 100, rows: 10, allowProposedApi: true });
  const restored = new Terminal({ cols: 80, rows: 5, allowProposedApi: true });
  const timers = [];
  const output = [];
  const exits = [];
  const stdin = new EventEmitter();
  let destroyed = false;
  Object.assign(stdin, { isTTY: true, setRawMode: () => {}, setEncoding: () => {},
    destroy: () => { destroyed = true; } });
  try {
    const codecPath = path.join(temporary, 'current-state.cjs');
    await esbuild.build({ entryPoints: [path.join(projectRoot,
      'extensions/vscode/dev-session-canvas/src/common/terminalCurrentState.ts')],
      outfile: codecPath, bundle: true, platform: 'node', format: 'cjs', target: 'node22' });
    const { captureTerminalCurrentState, restoreTerminalCurrentState, createTerminalCurrentColors,
      applyTerminalCurrentColorRequests } = require(codecPath);
    const colors = createTerminalCurrentColors();
    original._core._inputHandler.onColor(event => applyTerminalCurrentColorRequests(colors, event));
    const fixturePath = path.join(projectRoot, 'tests/vscode-smoke/fixtures/execution-capacity-subject.cjs');
    const receiptPath = path.join(temporary, 'subject.json');
    const fixtureModule = { exports: {} };
    const fixtureRequire = name => require(name);
    fixtureRequire.main = fixtureModule;
    // Execute the real command handler; only PTY I/O and process lifetime are replaced.
    vm.runInNewContext(await fs.readFile(fixturePath, 'utf8'), {
      module: fixtureModule, require: fixtureRequire, Buffer, console,
      process: { argv: [process.execPath, fixturePath, 'a', 'compact', receiptPath], pid: process.pid,
        stdin, stdout: { isTTY: true, write: (data, callback) => { output.push(data); callback(); return true; } },
        exit: code => exits.push(code) },
      setTimeout: (...args) => { const timer = setTimeout(...args); timers.push(timer); return timer; },
      clearTimeout, clearInterval
    }, { filename: fixturePath });
    const flush = async () => {
      await new Promise(resolve => setImmediate(resolve));
      assert.deepEqual(exits, [], 'The fixture must accept every reload command.');
      assert.notEqual(JSON.parse(await fs.readFile(receiptPath, 'utf8')).state, 'error');
      return output.splice(0).join('');
    };
    const write = (terminal, data) => new Promise(resolve => terminal.write(data, resolve));
    await write(original, await flush());
    assert.equal(stdin.listenerCount('data'), 1);
    stdin.emit('data', 'ping:before_reload\r');
    await write(original, await flush());
    stdin.emit('data', 'current-state-marker\r');
    await write(original, await flush());
    const currentState = JSON.parse(JSON.stringify(captureTerminalCurrentState(original, colors)));
    restoreTerminalCurrentState(restored, currentState);
    stdin.emit('data', 'ping:after_reload\r');
    await write(restored, await flush());
    const buffer = restored.buffer.active;
    const lines = Array.from({ length: buffer.length }, (_, index) => buffer.getLine(index).translateToString(true));
    assert(lines.includes('DSC_A1_REPLY_before_reload'));
    assert(lines.includes('DSC_RELOAD_CURRENT_STATE_MARKER'), 'The restored marker must occupy its own row.');
    assert(lines.includes('DSC_A1_REPLY_after_reload'), 'The actual interaction probe requires an exact new reply row.');
    assert.equal(buffer.cursorX, 0);
    stdin.emit('data', 'finish\r');
    await flush();
    assert.equal(destroyed, true);
    assert.equal(JSON.parse(await fs.readFile(receiptPath, 'utf8')).state, 'finished');
  } finally {
    for (const timer of timers) clearTimeout(timer);
    original.dispose(); restored.dispose();
    await fs.rm(temporary, { recursive: true, force: true });
  }
});

test('snapshot handshake permits real resize after READY but requires unique exact output and matching current page', () => {
  const nonce = '0123456789abcdef0123456789abcdef';
  const digest = createHash('sha256').update(nonce).digest('hex');
  const ready = 'READY:64x20\n';
  const written = `${ready}HASH:${digest}\nSIZE:112x28\n`;
  const page = { terminalCols: 112, terminalRows: 28 };
  assert.deepEqual(readSnapshotHandshake(written, ready, nonce, page), {
    initialCols: 64, initialRows: 20, cols: 112, rows: 28, expectedPrefix: written
  });
  for (const [input, currentPage, currentNonce, initial] of [
    [written, { terminalCols: 64, terminalRows: 20 }, nonce, ready],
    [written, { terminalCols: 112, terminalRows: 20 }, nonce, ready],
    [written, page, 'wrong-nonce', ready],
    [written, page, nonce, 'READY:112x28\n'],
    [`${written}SIZE:112x28\n`, page, nonce, ready],
    [`${written}\n`, page, nonce, ready],
    [`${written}extra\n`, page, nonce, ready],
    [`extra\n${written}`, page, nonce, ready],
    [written.slice(0, -1), page, nonce, ready]
  ]) assert.equal(readSnapshotHandshake(input, initial, currentNonce, currentPage), undefined);
});

test('snapshot actual Host departure requires original disk, tail, page and released process identities', () => {
  assertReloadReceipts(snapshotReceipts());
  for (const mutate of [
    value => { value.verify.diskReadBeforeDriverProductCalls = false; },
    value => { value.verify.oldHostExclusiveDiskWriteClaim = true; },
    value => { delete value.verify.productActivationAtDiskRead.after; },
    value => { value.verify.disk.pop(); }, value => { value.verify.disk[0].path = '/replacement'; },
    value => { value.verify.disk[0].node.metadata.terminal.liveSession = true; },
    value => { value.verify.disk[1].node.metadata.terminal.serializedTerminalState.data += 'changed'; },
    value => { value.verify.node.id = 'replacement'; },
    value => { value.verify.node.metadata.terminal.serializedTerminalState.data += 'changed'; },
    value => { value.verify.subjectSignal.signal = 'SIGTERM'; },
    value => { value.verify.subjectCompleted.writtenComplete = false; },
    value => { value.verify.writtenMatches = false; }, value => { value.verify.replayMatches = false; },
    value => { value.verify.page.applied = false; }, value => { value.verify.page.cursorY = 3; },
    value => { value.verify.page.visibleLines[2] = ''; },
    value => { value.verify.resourceChecks[0].after = value.setup.a.provider; },
    value => { value.verify.resourceChecks[1].expected = identity(100); },
    value => { value.verify.replacementProviders.push(identity(100)); },
    value => { value.verify.restartedExecutionEvents.push({ kind: 'execution/started' }); },
    value => { value.verify.oldReaderOutcome = 'applied'; }, value => { value.verify.sourceEofClaim = true; },
    value => { value.verify.oldHostAtVerify = value.setup.host; },
    value => { value.fallback.push({ action: 'owned-fallback-signal' }); }
  ]) {
    const value = snapshotReceipts(); mutate(value);
    assert.throws(() => assertReloadReceipts(value));
  }
});

test('snapshot closed state rejects new execution bindings and incomplete final metadata', () => {
  for (const [key, value] of Object.entries({ liveSession: true, lastExitCode: 0, lifecycle: 'live', outputSequence: 0,
    lastCols: 0, lastRows: 4, runtimeSessionId: 'new', pendingLaunch: {}, serializedTerminalState: { data: '' } })) {
    const node = snapshotNode(); node.metadata.terminal[key] = value;
    assert.throws(() => assertSnapshotNode(node));
  }
});

test('independent write replay checks full saved screen, ANSI colour and final cursor without native execution', async () => {
  const written = Buffer.from(`READY:80x7\nHASH:${'a'.repeat(64)}\nSIZE:80x7\n${snapshotTail}`);
  const metadata = snapshotNode().metadata.terminal;
  const rendered = await replaySnapshotTail(written, metadata);
  assert.deepEqual(rendered.lines.filter(Boolean), ['ROOT', '    \u4e2d\u6587']);
  assert.equal(rendered.cursorX, 6); assert.equal(rendered.cursorY, 4);
  for (const data of [snapshotTail.replace('\u4e2d\u6587', '\u4e2d'), snapshotTail.replace('[5;7H', '[4;7H'),
    snapshotTail.replace('[31m', '[32m'), `${snapshotTail}unexpected`]) {
    await assert.rejects(replaySnapshotTail(written, { ...metadata, serializedTerminalState: { data } }));
  }
  await assert.rejects(replaySnapshotTail(written.subarray(0, written.length - 1), metadata), /complete SIGHUP tail/);
});

test('launcher omission has no test RPC argument; original argument path remains exact on three platforms', () => {
  const options = { workspacePath: '/workspace', userDataDir: '/user', extensionsDir: '/extensions',
    extensionDevelopmentPath: '/driver', disableExtensions: false, extraLaunchArgs: [] };
  for (const platform of ['linux', 'darwin', 'win32']) {
    const activation = buildVSCodeArgs(options, platform);
    assert(!activation.some(arg => arg.startsWith('--extensionTestsPath')));
    assert(activation.includes('--extensionDevelopmentPath=/driver'));
    const original = buildVSCodeArgs({ ...options, extensionTestsPath: '/original/tests.cjs' }, platform);
    assert(original.includes('--extensionTestsPath=/original/tests.cjs'));
    assert.deepEqual(original.filter(arg => !arg.startsWith('--extensionTestsPath')), activation);
  }
});

test('control handoff selects exactly one setup and one verify; missing transfer cannot verify', () => {
  const valid = receipts().control;
  assertControl({ ...valid, phase: 'setup' });
  assertControl(valid);
  for (const change of [{ phase: 'reopen' }, { reloadRequests: 2 }, { setup: undefined },
    { nonce: 'missing-identity' }, { deadlineAt: NaN }]) {
    assert.throws(() => assertControl({ ...valid, ...change }));
  }
});

test('fixed independent receipts pass only for one UI, new Host and reader, retained execution, no history and cleanup', () => {
  assertReloadReceipts(receipts());
  const changedHandoff = receipts();
  changedHandoff.control = { ...changedHandoff.control, setup: { ...changedHandoff.setup, frameId: 'rewritten' } };
  assert.throws(() => assertReloadReceipts(changedHandoff));
  for (const key of ['setup', 'verify', 'cleanup']) {
    const missing = receipts(); delete missing[key];
    assert.throws(() => assertReloadReceipts(missing));
    const failed = receipts(); failed[key].pass = false;
    assert.throws(() => assertReloadReceipts(failed));
  }
});

test('UI relaunch, old Host, changed runtime identity, old frame/reader and nonce mismatch fail closed', () => {
  const changes = [
    value => { value.launcher.spawnCount = 2; },
    value => { value.verify.ui = identity(100); },
    value => { value.verify.host = value.setup.host; },
    value => { value.verify.oldHostAtVerify = value.setup.host; },
    value => { value.verify.frameId = value.setup.frameId; },
    value => { value.verify.a = { ...value.verify.a, reader: value.setup.a.reader }; },
    value => { value.verify.a = { ...value.verify.a, supervisor: identity(100) }; },
    value => { value.verify.a = { ...value.verify.a, provider: identity(100) }; },
    value => { value.verify.a = { ...value.verify.a, identity: identity(100) }; },
    value => { value.verify.a = { ...value.verify.a, binding: { ...value.setup.a.binding, runtimeSessionId: 'new' } }; },
    value => { value.verify.interaction.nonce = 'old-nonce'; },
    value => { value.verify.interaction.applied = false; }
  ];
  for (const change of changes) { const value = receipts(); change(value); assert.throws(() => assertReloadReceipts(value)); }
});

test('completed history, missing application, pending bindings and any fallback never become green', () => {
  for (const key of ['terminalStream', 'serializedTerminalState', 'recentOutput', 'runtimeSessionId', 'pendingLaunch']) {
    const node = closed(); node.metadata.terminal[key] = {};
    assert.throws(() => assertRuntimeDiscarded(node));
  }
  for (const change of [
    value => { value.verify.completedAttachEmpty = false; },
    value => { value.verify.restartedExecutionEvents.push({ kind: 'execution/started', detail: { nodeId: 'b' } }); },
    value => { value.verify.aCompletedApplied = false; },
    value => { value.cleanup.runtime.bindings.push({ nodeId: 'a' }); },
    value => { value.cleanup.runtime.pendingRuntimeSupervisorOperationCount = 1; },
    value => { value.cleanup.resourcesExited = false; },
    value => { value.exit.code = 1; },
    value => { value.exit.signal = 'SIGTERM'; },
    value => { value.fallback.push({ action: 'owned-fallback-signal' }); }
  ]) { const value = receipts(); change(value); assert.throws(() => assertReloadReceipts(value)); }
});

test('owned fallback requires fresh exact PID/start/executable and does not treat PID reuse or zombie as live', async () => {
  const expected = identity(10);
  assert(sameIdentity(expected, { ...expected }));
  assert(sameLiveIdentity(expected, { ...expected }));
  assert(!sameIdentity(expected, { ...expected, startTicks: 'win32:reused' }));
  assert(!sameIdentity(expected, { ...expected, executable: '/changed' }));
  assert(!sameLiveIdentity(expected, { ...expected, executable: '/changed' }));
  assert(!sameLiveIdentity(expected, undefined));
  assert(exitedIdentity(expected, { ...expected, state: 'Z' }));
  assert(exitedIdentity(expected, { ...expected, startTicks: 'reused' }));
  assert(!exitedIdentity(expected, { ...expected, executable: '/changed' }));
  // A retained Windows process object is not an exit by itself. Only its
  // confirmed exit fact, a changed lifetime token, or a missing identity is terminal.
  assert(!exitedIdentity(expected, { ...expected, state: 'object-retained' }));
  assert(exitedIdentity(expected, { ...expected, state: 'object-retained', hasExited: true, exitConfirmed: true,
    exitCode: 7 }));
  const signals = [];
  const kill = (...args) => signals.push(args);
  for (const actual of [undefined, { ...expected, state: 'Z' }, { ...expected, startTicks: 'reused' },
    { ...expected, executable: '/changed' }]) await signalOwned(expected, 'SIGTERM', { read: async () => actual, kill });
  assert.deepEqual(signals, []);
  const result = await signalOwned(expected, 'SIGTERM', { read: async () => expected, kill });
  assert.equal(result.action, 'owned-fallback-signal');
  assert.equal(result.productCleanupPass, false);
  assert.deepEqual(signals, [[10, 'SIGTERM']]);
});

test('staged activation driver is separate, has no business dist and keeps fixed fixtures/package receipt', async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'dsc-reload-pure-'));
  try {
    const runtime = { extensionsDir: path.join(temporary, 'extensions'), artifactsDir: path.join(temporary, 'artifacts') };
    await fs.mkdir(runtime.extensionsDir);
    await fs.mkdir(runtime.artifactsDir);
    const targetRoot = path.join(temporary, 'driver');
    const result = await prepareReloadDriver({ projectRoot, targetRoot, runtime, input: { vsixSha256: fixedVsixSha256 } });
    const manifest = JSON.parse(await fs.readFile(path.join(targetRoot, 'package.json'), 'utf8'));
    assert.equal(manifest.main, './runtime-reload-driver.cjs');
    assert.deepEqual(manifest.activationEvents, ['onStartupFinished']);
    assert.notEqual(`${manifest.publisher}.${manifest.name}`, 'devsessioncanvas.dev-session-canvas');
    assert(!('extensionDependencies' in manifest));
    await assert.rejects(fs.access(path.join(targetRoot, 'dist')), { code: 'ENOENT' });
    assert.equal(result.expectation.vsixSha256, fixedVsixSha256);
    assert.equal(result.expectation.extensionsDir, await fs.realpath(runtime.extensionsDir));
    assert(result.sourceHashes['tests/vscode-smoke/fixtures/execution-capacity-subject.cjs']);
    assert(result.sourceHashes['staged-runtime-reload-paths.cjs']);
    assert(result.sourceHashes['scripts/test/fixtures/linux-lifecycle-subject.mjs']);
    assert(result.sourceHashes['staged-runtime-reload-contract.cjs']);
    assert.equal(await fs.readFile(path.join(targetRoot, 'fixtures/linux-lifecycle-subject.mjs'), 'utf8'),
      await fs.readFile(path.join(projectRoot, 'scripts/test/fixtures/linux-lifecycle-subject.mjs'), 'utf8'));
    const driver = await fs.readFile(path.join(targetRoot, manifest.main), 'utf8');
    assert.match(driver, /workbench\.action\.reloadWindow/);
    assert.doesNotMatch(driver, /simulateRuntimeReload|prepareForDeactivation|produce:/);
    assert.match(driver, /role === 'a' \? ` a compact/);
    assert(driver.indexOf("archive('original-disk'") < driver.indexOf('await activateVisibleExtension'));
    assert.match(driver, /diskReadBeforeDriverProductCalls: true/);
    assert.match(driver, /oldHostExclusiveDiskWriteClaim: false/);
    assert.match(driver, /oldReaderOutcome: 'not-observed', sourceEofClaim: false/);
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
});
