const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { sameLiveIdentity, exitedIdentity, completedMarker } = require('./runtime-reload-contract.cjs');

const fixedVsixSha256 = 'c4df29f55088f279a35a584441ae5eff15491f996ed3275f534e7cb7121bee6e';
const hash = value => createHash('sha256').update(value).digest('hex');
const bindingKeys = ['runtimeBackend', 'runtimeStoragePath', 'runtimeSessionId'];

function rootSnapshotPath(userDataDir, rootPath) {
  assert(path.isAbsolute(userDataDir) && path.isAbsolute(rootPath));
  return path.join(userDataDir, 'User/globalStorage/devsessioncanvas.dev-session-canvas/root-local-canvas',
    hash(path.resolve(rootPath)).slice(0, 24), 'canvas-state.json');
}

async function createObstacle(snapshotPath) {
  const file = `${snapshotPath}.tmp`;
  await fs.mkdir(file);
  const stat = await fs.lstat(file);
  assert(stat.isDirectory() && !stat.isSymbolicLink());
  return { path: file, dev: stat.dev, ino: stat.ino };
}

async function checkObstacle(obstacle) {
  const stat = await fs.lstat(obstacle.path);
  assert(stat.isDirectory() && !stat.isSymbolicLink(), 'The original obstacle must remain a directory.');
  assert.equal(stat.dev, obstacle.dev);
  assert.equal(stat.ino, obstacle.ino, 'Do not remove a replacement obstacle.');
  assert.deepEqual(await fs.readdir(obstacle.path), [], 'Never recursively remove an unexpected obstacle entry.');
  return { ...obstacle, empty: true, unchanged: true };
}

async function removeObstacle(obstacle) {
  const checked = await checkObstacle(obstacle);
  await fs.rmdir(obstacle.path);
  return { ...checked, removed: true };
}

function assertBinding(subject, state, runtime) {
  const node = state.state.nodes.find(entry => entry.id === subject.id);
  assert(node && node.groupId === subject.groupId);
  const binding = runtime.bindings.find(entry => entry.nodeId === subject.id);
  assert(binding, 'Original execution responsibility must remain bound.');
  for (const key of bindingKeys) {
    assert.equal(node.metadata.terminal[key], subject.binding[key]);
    assert.equal(binding[key], subject.binding[key]);
  }
  return node;
}

function assertCaseReport(report, control) {
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.mode, 'live-runtime');
  assert.equal(report.nonce, control.nonce);
  assert.deepEqual({ a: report.a.rootPath, b: report.b.rootPath }, control.roots);
  for (const role of ['a', 'b']) {
    assert.equal(report.baseline.files[role].path, rootSnapshotPath(control.userDataDir, control.roots[role]));
    const saved = report.baseline.files[role].snapshot.state.nodes.find(node =>
      node.metadata?.terminal?.runtimeSessionId === report[role].binding.runtimeSessionId);
    assert(saved, 'The baseline root must contain its original live binding.');
    for (const key of bindingKeys) assert.equal(saved.metadata.terminal[key], report[role].binding[key]);
  }
  assert.notEqual(report.a.rootPath, report.b.rootPath);
  assert.notEqual(report.a.groupId, report.b.groupId);
  assert.notEqual(report.a.id, report.b.id);
  assert.notEqual(report.a.binding.runtimeSessionId, report.b.binding.runtimeSessionId);
  assert(sameLiveIdentity(report.a.supervisor, report.b.supervisor));
  assert.equal(report.obstacle.path, `${report.baseline.files.a.path}.tmp`);
  for (const key of ['a', 'b', 'workspace']) {
    assert.equal(report.failed.files[key].path, report.baseline.files[key].path);
    assert.equal(report.failed.files[key].sha256, report.baseline.files[key].sha256,
      `The first failure must precede any later B persistence (${key}).`);
  }
  const rootFailure = report.failed.events.find(event => event.kind === 'state/rootLocalPersistFailed' &&
    event.detail?.rootPath === report.a.rootPath && /EISDIR|illegal operation on a directory/i.test(event.detail.message));
  assert(rootFailure, 'Require the real root A filesystem failure.');
  const handlingFailure = report.failed.events.find(event =>
    ['runtime/hostOutputConsumptionFailed', 'runtime/sessionStateHandlerFailed'].includes(event.kind) &&
    event.detail?.sessionId === report.a.binding.runtimeSessionId &&
    /EISDIR|illegal operation on a directory/i.test(event.detail.message));
  assert(handlingFailure, 'Root A failure must reach the original completion callback.');
  for (const observation of [report.failed, report.afterInteraction]) {
    assertBinding(report.a, observation.state, observation.runtime);
    const bNode = assertBinding(report.b, observation.state, observation.runtime);
    assert.equal(bNode.metadata.terminal.liveSession, true);
    assert.equal(observation.runtime.bindings.length, 2);
  }
  assert.equal(report.failed.aSession.sessionId, report.a.binding.runtimeSessionId);
  assert.equal(report.failed.aSession.live, false, 'The failed save must not be confused with a running subject.');
  assert.equal(report.failed.aSession.lastExitCode, 0);
  assert.equal(report.failed.aSession.terminalSourceDisposition.kind, 'eof');
  assert.equal(report.aFinal.receipt.state, 'finished');
  assert.equal(report.aFinal.receipt.pid, report.a.identity.pid);
  assert.equal(report.aFinal.receipt.marker, completedMarker);
  assert.equal(report.aFinal.fullMarkerVerified, true);
  assert.equal(report.aFinal.settlement.readId, report.a.reader.readId);
  assert.equal(report.aFinal.settlement.sessionId, report.a.binding.runtimeSessionId);
  assert.equal(report.aFinal.settlement.outcome.kind, 'applied');
  assert.equal(report.aFinal.settlement.outcome.finalRevision, report.failed.aSession.terminalFinalRevision);
  assert(exitedIdentity(report.a.identity, report.aFinal.subjectAfter));
  const after = report.afterInteraction;
  assert.equal(after.obstacle.unchanged, true);
  assert.equal(after.obstacle.ino, report.obstacle.ino);
  assert.equal(after.obstacle.dev, report.obstacle.dev);
  assert.equal(after.obstacle.path, report.obstacle.path);
  assert.equal(after.interaction.nonce, report.nonce);
  assert.equal(after.interaction.applied, true);
  assert(after.interaction.elapsedMs >= 0 && after.interaction.elapsedMs < 1500);
  assert(sameLiveIdentity(report.b.identity, after.subject));
  assert(sameLiveIdentity(report.b.provider, after.provider));
  assert(sameLiveIdentity(report.b.supervisor, after.supervisor));
  assert.equal(after.bSession.sessionId, report.b.binding.runtimeSessionId);
  assert.equal(after.bSession.live, true);
  const output = after.messages.filter(message => message.type === 'host/executionTerminalPage' &&
    message.payload.nodeId === report.b.id && message.payload.executionSessionId === report.b.binding.runtimeSessionId &&
    message.payload.readId === report.b.reader.readId && message.payload.authorityId === report.b.reader.authorityId)
    .flatMap(message => message.payload.page?.events ?? []).filter(event => event.type === 'output')
    .map(event => event.data).join('');
  assert(output.includes(`DSC_A1_REPLY_${report.nonce}`), 'The new reply must traverse B original reader.');
  assert.deepEqual(after.newStartEvents, [], 'Failure cannot restart either original execution.');
}

function assertCleanupReport(report, owned) {
  assert.equal(report.pass, true);
  assert.equal(report.productResetReturned, true);
  assert.equal(report.runtime.bindings.length, 0);
  assert.equal(report.runtime.pendingRuntimeSupervisorOperationCount, 0);
  assert.equal(report.nodesRemaining, 0);
  assert.deepEqual(owned.readySubjects, owned.expectedSubjects);
  assert.equal(owned.readySubjects.length, 2);
  assert.equal(report.resources.length, owned.resources.length);
  for (const [index, entry] of report.resources.entries()) {
    assert.deepEqual(entry.expected, owned.resources[index]);
    assert(exitedIdentity(entry.expected, entry.after));
  }
  assert.equal(report.obstacle.removed, true);
  assert.equal(report.supervisor.action, 'owned-isolated-idle-supervisor-SIGTERM');
  assert(exitedIdentity(owned.supervisor, report.supervisor.after));
  assert.deepEqual(report.supervisor.registry.sessions, []);
}

module.exports = { fixedVsixSha256, hash, bindingKeys, rootSnapshotPath, createObstacle,
  checkObstacle, removeObstacle, assertCaseReport, assertCleanupReport };
