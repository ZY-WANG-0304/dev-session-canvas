const assert = require('node:assert/strict');
const path = require('node:path');

const bindingKeys = ['runtimeBackend', 'runtimeStoragePath', 'runtimeSessionId', 'runtimeOwner'];

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

module.exports = { bindingKeys, assertBinding, assertContained, assertTopology, assertRestored, assertCase };
