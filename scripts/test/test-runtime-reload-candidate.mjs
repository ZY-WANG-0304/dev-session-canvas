import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import contract from '../../tests/vscode-smoke/runtime-reload-contract.cjs';
import { buildVSCodeArgs } from '../smoke/vscode-smoke-runner.mjs';
import { prepareReloadDriver } from '../smoke/run-vscode-runtime-reload-candidate.mjs';

const { assertControl, assertReloadReceipts, assertRuntimeDiscarded, sameLiveIdentity,
  exitedIdentity, signalOwned, fixedVsixSha256 } = contract;
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
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
  assert(sameLiveIdentity(expected, { ...expected }));
  assert(!sameLiveIdentity(expected, { ...expected, executable: '/changed' }));
  assert(exitedIdentity(expected, { ...expected, state: 'Z' }));
  assert(exitedIdentity(expected, { ...expected, startTicks: 'reused' }));
  assert(!exitedIdentity(expected, { ...expected, executable: '/changed' }));
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
    const driver = await fs.readFile(path.join(targetRoot, manifest.main), 'utf8');
    assert.match(driver, /workbench\.action\.reloadWindow/);
    assert.doesNotMatch(driver, /simulateRuntimeReload|prepareForDeactivation|produce:/);
    assert.match(driver, /role === 'a' \? ` b color/);
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
});
