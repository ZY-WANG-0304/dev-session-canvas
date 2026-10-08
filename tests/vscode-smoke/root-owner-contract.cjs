const assert = require('node:assert/strict');
const path = require('node:path');

const bindingKeys = ['runtimeBackend', 'runtimeStoragePath', 'runtimeSessionId', 'runtimeOwner'];

function assertDriverProfileRegistration(inventory, targetRoot) {
  assert(Array.isArray(inventory), 'The default extension profile must have an inventory.');
  const entries = inventory.filter(entry => entry.identifier?.id === 'devsessioncanvas-tests.root-owner-driver');
  assert.equal(entries.length, 1, 'The default profile must register the independent root-owner driver exactly once.');
  const entry = entries[0];
  assert.equal(entry.version, '0.0.0');
  assert.equal(entry.location?.scheme, 'file');
  assert.equal(entry.location?.path, targetRoot);
  assert.equal(entry.relativeLocation, path.basename(targetRoot));
  return entry;
}

function assertIdentity(value) {
  assert(Number.isInteger(value.pid) && value.pid > 1);
  assert.match(value.startTicks, /^\d+$/);
  assert(path.isAbsolute(value.executable));
}

function assertSubject(subject, root) {
  for (const role of ['supervisor', 'provider', 'identity']) assertIdentity(subject[role]);
  const owner = subject.binding.runtimeOwner;
  assert.deepEqual(Object.keys(owner).sort(), ['environmentKey', 'generation', 'root', 'schema', 'userStorageScopeKey']);
  assert.equal(owner.schema, 1);
  assert.equal(owner.generation, 'terminal-root-owner-linux-v1');
  assert.match(owner.environmentKey, /^[a-f0-9]{64}$/);
  assert.match(owner.userStorageScopeKey, /^[a-f0-9]{64}$/);
  assert.deepEqual(owner.root, { kind: 'folder', pathPolicy: 'canvas-path-v1', normalizedPath: root });
  assert.deepEqual(subject.hello.runtimeOwner, owner);
  assert.equal(subject.hello.pid, subject.supervisor.pid);
  assert(path.isAbsolute(subject.socketPath));
  assert(path.isAbsolute(subject.binding.runtimeStoragePath));
  assert(subject.binding.runtimeSessionId);
  assert(['legacy-detached', 'systemd-user'].includes(subject.binding.runtimeBackend));
  assert.equal(subject.reader.sessionId, subject.binding.runtimeSessionId);
  assert(subject.reader.authorityId && subject.reader.readId);
}

function assertContained(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  assert(relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative),
    'The scenario must only address its isolated storage.');
}

function assertBinding(actual, expected) {
  for (const key of bindingKeys) assert.deepEqual(actual[key], expected[key], `Original ${key} changed.`);
}

function assertTopology(single, multi, roots) {
  assertIdentity(single.host); assertIdentity(multi.host);
  assert.notEqual(single.host.pid, multi.host.pid, 'Require two actual Extension Hosts.');
  assert.equal(single.globalStorage, multi.globalStorage, 'Both windows must use the same canonical product globalStorage.');
  assert.deepEqual(single.workspaceRoots, [roots.a]);
  assert.deepEqual(multi.workspaceRoots, [roots.a, roots.b, roots.c]);
  assert.equal(multi.subjects.length, 3);
  const [a, b, c] = multi.subjects;
  assertSubject(single.subject, roots.a);
  assert.deepEqual(a.binding.runtimeOwner, single.subject.binding.runtimeOwner);
  assert.equal(a.binding.runtimeStoragePath, single.subject.binding.runtimeStoragePath);
  assert.equal(a.binding.runtimeBackend, single.subject.binding.runtimeBackend);
  assert.equal(a.supervisor.pid, single.subject.supervisor.pid);
  assert.equal(a.supervisor.startTicks, single.subject.supervisor.startTicks);
  assert.equal(a.supervisor.executable, single.subject.supervisor.executable);
  assert.equal(a.socketPath, single.subject.socketPath);
  assert.notEqual(a.binding.runtimeSessionId, single.subject.binding.runtimeSessionId,
    'The second window must create its own session, not only attach the first.');
  assert.equal(new Set([single.subject, ...multi.subjects].map(subject => subject.binding.runtimeSessionId)).size, 4);
  assert.equal(new Set([single.subject, ...multi.subjects].map(subject => subject.identity.pid)).size, 4);
  for (const [subject, root] of [[a, roots.a], [b, roots.b], [c, roots.c]]) {
    assertSubject(subject, root);
  }
  for (const key of ['runtimeStoragePath', 'runtimeSessionId']) {
    assert.equal(new Set(multi.subjects.map(subject => subject.binding[key])).size, 3);
  }
  assert.equal(new Set(multi.subjects.map(subject => subject.supervisor.pid)).size, 3);
  assert.equal(new Set(multi.subjects.map(subject => subject.socketPath)).size, 3);
  assert.equal(new Set(multi.subjects.map(subject => subject.binding.runtimeOwner.environmentKey)).size, 1);
  assert.equal(new Set(multi.subjects.map(subject => subject.binding.runtimeOwner.userStorageScopeKey)).size, 1);
}

function assertRestored(original, restored) {
  assertSubject(restored, original.binding.runtimeOwner.root.normalizedPath);
  assertBinding(restored.binding, original.binding);
  for (const role of ['supervisor', 'provider', 'identity']) {
    assert.equal(restored[role].pid, original[role].pid);
    assert.equal(restored[role].startTicks, original[role].startTicks);
    assert.equal(restored[role].executable, original[role].executable);
  }
  assert.equal(restored.reader.authorityId, original.reader.authorityId);
  assert.notEqual(restored.reader.readId, original.reader.readId, 'A new Host must use its own reader.');
}

function assertCase(single, multi, reopened, closed) {
  assertTopology(single, multi, single.roots);
  assertIdentity(reopened.host);
  assert.notEqual(reopened.host.pid, single.host.pid);
  assert.notEqual(reopened.host.pid, multi.host.pid);
  assert.equal(reopened.globalStorage, single.globalStorage);
  assert.deepEqual(reopened.workspaceRoots, single.workspaceRoots);
  assert.equal(reopened.subjects.length, 2);
  assert.equal(closed.originalHostExited, true);
  assert.equal(closed.persistenceOrder, 'surviving-multi-saved-after-original-host-exit-before-reopen');
  assert.equal(closed.peerInteraction.applied, true);
  assertRestored(single.subject, reopened.subjects[0]);
  assertRestored(multi.subjects[0], reopened.subjects[1]);
  const subjects = [single.subject, ...multi.subjects, ...reopened.subjects];
  const interactions = [[closed.peerInteraction, single.subject.binding.runtimeSessionId],
    ...subjects.map(subject => [subject.interaction, subject.binding.runtimeSessionId]),
    ...closed.isolatedInteractions.map((receipt, index) => [receipt, multi.subjects[index + 1]?.binding.runtimeSessionId])];
  for (const [receipt, sessionId] of interactions) {
    assert.equal(receipt.applied, true);
    assert.match(receipt.marker, /^DSC_ROOT_REPLY_[a-f0-9-]+$/);
    assert.equal(receipt.sessionId, sessionId);
  }
  assert.equal(closed.isolatedInteractions.length, 2);
  assert.equal(closed.isolatedChecks.length, 2);
  for (const [index, check] of closed.isolatedChecks.entries()) {
    for (const role of ['supervisor', 'provider', 'identity']) {
      assertIdentity(check[role]);
      for (const key of ['pid', 'startTicks', 'executable']) assert.equal(check[role][key], multi.subjects[index + 1][role][key]);
    }
  }
  assert.equal(multi.resources.owners.length, 3);
  for (const [index, entry] of multi.resources.owners.entries()) {
    assert(Number.isFinite(entry.rssBytes) && entry.rssBytes > 0 && entry.sameIdentity === true);
    for (const key of ['pid', 'startTicks', 'executable']) assert.equal(entry.identity[key], multi.subjects[index].supervisor[key]);
  }
}

function assertBoundaryCase(single, multi, result) {
  assertTopology(single, multi, single.roots);
  assert.equal(result.order, 'multi-before-single');
  assertRestored(multi.subjects[0], single.restored);
  assert.equal(single.subject.windowMarker, 'single');
  assert.deepEqual(single.subject.configuration, { shellPath: '/bin/sh', scrollback: 10000 });
  for (const subject of multi.subjects) {
    assert.equal(subject.windowMarker, 'multi');
    assert.deepEqual(subject.configuration, { shellPath: '/bin/bash', scrollback: 2000 });
  }
  const [a, b, c] = multi.subjects;
  assert.equal(result.settings.page.executionSessionId, a.binding.runtimeSessionId);
  assert.equal(result.settings.page.authorityId, a.reader.authorityId);
  assert(result.settings.page.page.events.some(event => event.type === 'scrollback' && event.scrollback === 2500));
  assert.equal(result.resized.state.sessionId, b.binding.runtimeSessionId);
  assert.equal(result.resized.state.terminalAuthorityId, b.reader.authorityId);
  assert.equal(result.resized.state.scrollback, 2500);
  assert.equal(result.resizeBefore.sessionId, b.binding.runtimeSessionId);
  assert(result.resized.state.cols !== result.resizeBefore.cols || result.resized.state.rows !== result.resizeBefore.rows,
    'An unchanged viewport cannot demonstrate the requested resize.');
  assert(result.resized.state.cols >= 80 && result.resized.state.rows >= 5);
  assert.equal(result.resized.state.cols, result.resized.page.terminalCols);
  assert.equal(result.resized.state.rows, result.resized.page.terminalRows);
  assert.equal(result.kept.sessionId, c.binding.runtimeSessionId);
  assert.equal(result.kept.live, true);
  assertRestored(c, result.readded);
  assert.equal(result.clearSession, c.binding.runtimeSessionId);
  assert.equal(result.faultDisposition, 'injected-owner-loss-not-eof');
  assertSubject(result.bAfter, single.roots.b);
  assertBinding(result.bAfter.binding, b.binding);
  for (const role of ['supervisor', 'provider', 'identity']) {
    for (const key of ['pid', 'startTicks', 'executable']) assert.equal(result.bAfter[role][key], b[role][key]);
  }
  assert.equal(result.bAfter.reader.authorityId, b.reader.authorityId);
  assert.equal(result.afterClear.length, 2);
  for (const [receipt, sessionId] of [[result.settings.interaction, a.binding.runtimeSessionId],
    [result.keepInteraction, c.binding.runtimeSessionId], [result.afterClear[0], a.binding.runtimeSessionId],
    [result.afterClear[1], b.binding.runtimeSessionId], [result.faultInteraction, b.binding.runtimeSessionId]]) {
    assert.equal(receipt.applied, true);
    assert.equal(receipt.sessionId, sessionId);
    assert.match(receipt.marker, /^DSC_ROOT_REPLY_[a-f0-9-]+$/);
  }
}

module.exports = { bindingKeys, assertBinding, assertContained, assertTopology, assertRestored, assertCase,
  assertBoundaryCase, assertDriverProfileRegistration };
