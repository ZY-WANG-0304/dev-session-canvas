import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { parseRootFailureSelection } from '../smoke/run-vscode-root-failure-candidate.mjs';
import contract from '../../tests/vscode-smoke/root-failure-contract.cjs';
import identities from '../../tests/vscode-smoke/runtime-reload-contract.cjs';

const { rootSnapshotPath, createObstacle, checkObstacle, removeObstacle, assertCaseReport, assertCleanupReport } = contract;
assert.equal(parseRootFailureSelection(['--output', '/new', '--installed-vsix', '/fixed'], 'linux', 'x64').output, '/new');
for (const args of [[], ['--output', '/new'], ['--output', ' ', '--installed-vsix', '/fixed'],
  ['--output', '/new', '--installed-vsix', '/fixed', '--retry'], ['--probe']]) {
  assert.throws(() => parseRootFailureSelection(args, 'linux', 'x64'));
}
assert.throws(() => parseRootFailureSelection(['--output', '/new', '--installed-vsix', '/fixed'], 'darwin', 'arm64'));

const control = { nonce: 'fixed-fresh-nonce', roots: { a: '/private/root-a', b: '/private/root-b' }, userDataDir: '/private/user-data' };
const identity = (pid, ppid = 10) => ({ pid, ppid, executable: '/fixed/node', startTicks: String(pid * 100), state: 'S' });
const supervisor = identity(20);
const subject = (role, pid) => ({ role, id: `node-${role}`, groupId: `group-${role}`, rootPath: control.roots[role],
  identity: identity(pid), provider: identity(pid + 1, 20), supervisor,
  binding: { runtimeBackend: 'legacy-detached', runtimeStoragePath: '/private/runtime', runtimeSessionId: `session-${role}` },
  reader: { readId: `reader-${role}`, authorityId: `authority-${role}`, sessionId: `session-${role}` } });
const a = subject('a', 30), b = subject('b', 40);
const nodes = [a, b].map(subject => ({ id: subject.id, groupId: subject.groupId,
  metadata: { terminal: { ...subject.binding, liveSession: true } } }));
const runtime = { bindings: [a, b].map(subject => ({ nodeId: subject.id, ...subject.binding })) };
const files = Object.fromEntries(['a', 'b', 'workspace'].map(role => [role, {
  path: role === 'workspace' ? '/private/user-data/workspace/canvas-state.json' : rootSnapshotPath(control.userDataDir, control.roots[role]),
  sha256: `${role}-original-bytes`, snapshot: { state: { nodes } }
}]));
const events = [
  { kind: 'state/rootLocalPersistFailed', detail: { rootPath: a.rootPath, message: 'EISDIR: illegal operation on a directory' } },
  { kind: 'runtime/hostOutputConsumptionFailed', detail: { sessionId: a.binding.runtimeSessionId, message: 'EISDIR' } }
];
const observation = { state: { state: { nodes } }, runtime, files, events, messages: [] };
const obstacle = { path: `${files.a.path}.tmp`, dev: 1, ino: 2 };
const report = {
  schemaVersion: 1, mode: 'live-runtime', nonce: control.nonce, a, b, obstacle, baseline: observation,
  failed: { ...observation, aSession: { sessionId: a.binding.runtimeSessionId, live: false, lastExitCode: 0,
    terminalSourceDisposition: { kind: 'eof' }, terminalFinalRevision: 12 } },
  aFinal: { receipt: { pid: a.identity.pid, state: 'finished', marker: identities.completedMarker },
    fullMarkerVerified: true, subjectAfter: null,
    settlement: { readId: a.reader.readId, sessionId: a.binding.runtimeSessionId, outcome: { kind: 'applied', finalRevision: 12 } } },
  afterInteraction: { ...observation, obstacle: { ...obstacle, unchanged: true },
    interaction: { nonce: control.nonce, applied: true, elapsedMs: 18 }, subject: b.identity, provider: b.provider, supervisor,
    bSession: { sessionId: b.binding.runtimeSessionId, live: true }, newStartEvents: [],
    messages: [{ type: 'host/executionTerminalPage', payload: { nodeId: b.id, executionSessionId: b.binding.runtimeSessionId,
      authorityId: b.reader.authorityId, readId: b.reader.readId,
      page: { events: [{ type: 'output', data: `DSC_A1_REPLY_${control.nonce}\r\n` }] } } }] }
};
assertCaseReport(report, control);
for (const change of [
  value => { value.nonce = 'old'; }, value => { value.a.rootPath = b.rootPath; },
  value => { value.failed.events = []; }, value => { value.failed.files = structuredClone(files); value.failed.files.a.sha256 = 'rewritten'; },
  value => { value.failed.runtime = { bindings: [] }; }, value => { value.failed.aSession.terminalSourceDisposition.kind = 'cancelled'; },
  value => { value.aFinal.fullMarkerVerified = false; }, value => { value.aFinal.settlement.outcome.finalRevision++; },
  value => { value.aFinal.subjectAfter = a.identity; }, value => { value.afterInteraction.obstacle.ino++; },
  value => { value.afterInteraction.interaction.nonce = 'old'; }, value => { value.afterInteraction.interaction.applied = false; },
  value => { value.afterInteraction.interaction.elapsedMs = 1500; },
  value => { value.afterInteraction.subject = identity(999); }, value => { value.afterInteraction.messages[0].payload.readId = 'replacement'; },
  value => { value.afterInteraction.newStartEvents = [{ kind: 'execution/started' }]; }
]) {
  const copy = structuredClone(report); change(copy); assert.throws(() => assertCaseReport(copy, control));
}
const legitimateBWrite = structuredClone(report);
legitimateBWrite.afterInteraction.files = structuredClone(files);
legitimateBWrite.afterInteraction.files.b.sha256 = 'new-B-output';
legitimateBWrite.afterInteraction.files.workspace.sha256 = 'new-workspace-state';
assertCaseReport(legitimateBWrite, control);

const owned = { supervisor, resources: [a.identity, a.provider, b.identity, b.provider],
  expectedSubjects: ['a', 'b'], readySubjects: ['a', 'b'] };
const cleanup = { pass: true, productResetReturned: true, obstacle: { removed: true }, nodesRemaining: 0,
  runtime: { bindings: [], pendingRuntimeSupervisorOperationCount: 0 },
  resources: owned.resources.map(expected => ({ expected, after: null })),
  supervisor: { action: 'owned-isolated-idle-supervisor-SIGTERM', after: null, registry: { sessions: [] } } };
assertCleanupReport(cleanup, owned);
for (const change of [value => { value.runtime.bindings = [{}]; }, value => { value.nodesRemaining = 1; },
  value => { value.runtime.pendingRuntimeSupervisorOperationCount = 1; }, value => { value.obstacle.removed = false; },
  value => { value.resources[0].after = a.identity; }, value => { value.supervisor.registry.sessions = [{}]; }]) {
  const copy = structuredClone(cleanup); change(copy); assert.throws(() => assertCleanupReport(copy, owned));
}
assert.throws(() => assertCleanupReport(cleanup, { ...owned, readySubjects: ['a'] }));

const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'dsc-root-failure-contract-'));
try {
  const rootFile = path.join(temporary, 'canvas-state.json');
  await fs.writeFile(rootFile, 'original-root-bytes');
  const ownedObstacle = await createObstacle(rootFile);
  await assert.rejects(fs.writeFile(`${rootFile}.tmp`, 'replacement'), error => error.code === 'EISDIR');
  assert.equal(await fs.readFile(rootFile, 'utf8'), 'original-root-bytes');
  await assert.rejects(createObstacle(rootFile), error => error.code === 'EEXIST');
  await assert.rejects(removeObstacle({ ...ownedObstacle, ino: ownedObstacle.ino + 1 }));
  await fs.writeFile(path.join(ownedObstacle.path, 'unexpected'), 'do-not-delete');
  await assert.rejects(removeObstacle(ownedObstacle));
  assert.equal(await fs.readFile(path.join(ownedObstacle.path, 'unexpected'), 'utf8'), 'do-not-delete');
  await fs.unlink(path.join(ownedObstacle.path, 'unexpected'));
  assert.equal((await checkObstacle(ownedObstacle)).unchanged, true);
  assert.equal((await removeObstacle(ownedObstacle)).removed, true);
  await fs.symlink(temporary, ownedObstacle.path);
  await assert.rejects(removeObstacle(ownedObstacle));
  await fs.unlink(ownedObstacle.path);
} finally { await fs.rm(temporary, { recursive: true, force: true }); }

const source = await fs.readFile('tests/vscode-smoke/root-failure-candidate-tests.cjs', 'utf8');
const driverRequire = createRequire(path.resolve('tests/vscode-smoke/root-failure-candidate-tests.cjs'));
const calls = [];
const readCommands = new Set(['getDebugState', 'getDiagnosticEvents', 'getHostMessages', 'getRuntimeSupervisorState']);
const context = { module: { exports: {} }, exports: {}, process: { env: {} },
  require(name) {
    if (name === 'vscode') return { commands: { async executeCommand(name) {
      const short = name.split('.').at(-1); assert(readCommands.has(short)); calls.push(short); return {};
    } } };
    if (name === 'node:fs/promises') return { async readFile(file) { calls.push(file); return Buffer.from('{"state":{"nodes":[]}}'); } };
    if (name === './root-failure-runtime-paths.cjs') return {};
    return driverRequire(name);
  } };
vm.runInNewContext(`${source}\nmodule.exports.readOnlyState = readOnlyState; files = { a: '/a', b: '/b', workspace: '/w' };`, context);
await context.module.exports.readOnlyState();
assert.deepEqual(calls, ['getDebugState', 'getDiagnosticEvents', 'getHostMessages', 'getRuntimeSupervisorState', '/a', '/b', '/w']);
assert(source.indexOf("archive('expected-first-failure'") < source.indexOf("failed.aSession = await rpc"));
console.log('Fixed root failure selection, real EISDIR, original bindings/tail, new peer nonce, first read-only observation and identity-safe cleanup checks passed; no PTY, VS Code or native execution.');
