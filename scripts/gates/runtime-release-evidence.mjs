import assert from 'node:assert/strict';
import { runtimeReleaseBaselineCommit, runtimeReleaseBundles } from '../test/runtime-release-baseline.mjs';

function assertHash(value) {
  assert.equal(typeof value, 'string');
  assert.match(value, /^[a-f0-9]{64}$/);
}

export function assertRuntimeReleaseBaseline(baseline) {
  assert.equal(baseline?.kind, 'pinned-pre-fix-source', 'Formal upgrade requires actual pre-fix source.');
  assert.equal(baseline.commit, runtimeReleaseBaselineCommit);
  assertHash(baseline.sourceArchiveSha256);
  assertHash(baseline.toolchain?.lockfileSha256);
  assert.match(baseline.toolchain.node, /^\d+\.\d+\.\d+$/);
  assert.match(baseline.toolchain.esbuild, /^\d+\.\d+\.\d+$/);
  assert.equal(baseline.native?.origin, 'same-run-current-assets');
  assertHash(baseline.native.sha256);
  for (const bundles of [baseline.bundles, baseline.currentBundles]) {
    assert.deepEqual(Object.keys(bundles).sort(), [...runtimeReleaseBundles].sort());
    for (const value of Object.values(bundles)) assertHash(value);
  }
  assert.notEqual(baseline.bundles['runtime-supervisor.js'], baseline.currentBundles['runtime-supervisor.js']);
}

function assertProcessObservations(evidence, phase) {
  assert.deepEqual(evidence.runtimes?.map(runtime => runtime.name), ['old-extension', 'current-extension', 'next-extension']);
  const identities = new Set();
  for (const [index, runtime] of evidence.runtimes.entries()) {
    const original = runtime.originalProcesses;
    const childCount = index === 0 ? 2 : 1;
    assert.equal(original?.length, 1 + childCount * 2, 'Missing original provider/PTY evidence.');
    for (const [role, count] of [['supervisor', 1], ['provider', childCount], ['pty', childCount]]) {
      assert.equal(original.filter(identity => identity.role === role).length, count);
    }
    for (const identity of original) {
      assert(Number.isSafeInteger(identity.pid) && identity.pid > 0);
      assert.equal(typeof identity.startTicks, 'string');
      assert.match(identity.startTicks, /^\d+$/);
      assert.equal(typeof identity.executable, 'string');
      assert(identity.executable.startsWith('/'));
      const key = `${identity.pid}:${identity.startTicks}`;
      assert(!identities.has(key), 'Duplicate original process identity.');
      identities.add(key);
    }
    assert.deepEqual(runtime[phase], original.map(identity => ({ ...identity, observed: 'absent' })), 'Original processes have not disappeared.');
    if (phase === 'retirement') assert(Number.isFinite(Date.parse(runtime.retiredAt))
      && Date.parse(runtime.retiredAt) <= Date.parse(evidence.actionCompletedAt), 'Retirement was not observed within the action.');
  }
}

export function assertRuntimeReleaseUpgradeEvidence(evidence, workDeadline) {
  assert.equal(evidence.schemaVersion, 2);
  assert.equal(evidence.platform, 'linux');
  assert.equal(evidence.realPty, true);
  assert.equal(evidence.realAgentCli, false);
  assert.equal(evidence.passed, true);
  assert.deepEqual(evidence.forcedCleanup, []);
  assert.deepEqual(evidence.cleanupErrors, []);
  assertRuntimeReleaseBaseline(evidence.baseline);
  assertProcessObservations(evidence, 'retirement');
  assert.deepEqual(evidence.cases, [
    'deleted-installation-rejects-historical-create',
    'release-isolation-and-live-reader-continuity',
    'historical-retirement-preserves-new-executions',
    'all-fixtures-retire-naturally'
  ]);
  assert(Number.isFinite(Date.parse(evidence.actionCompletedAt))
    && Date.parse(evidence.actionCompletedAt) <= workDeadline, 'Upgrade action borrowed cleanup time.');
  return evidence;
}

export function assertRuntimeReleaseUpgradeCleanup(evidence, cleanupDeadline) {
  assert.equal(evidence.schemaVersion, 2);
  assert.equal(evidence.cleanup, 'passed');
  assert.deepEqual(evidence.cleanupErrors, []);
  assertProcessObservations(evidence, 'cleanup');
  assert(Date.parse(evidence.cleanupCompletedAt) >= Date.parse(evidence.cleanupStartedAt)
    && Date.parse(evidence.cleanupCompletedAt) <= cleanupDeadline, 'Upgrade cleanup is unconfirmed.');
  if (evidence.actionCompletedAt) assert(Date.parse(evidence.actionCompletedAt) <= Date.parse(evidence.cleanupStartedAt));
  return { cleanup: evidence.cleanup, forcedCleanup: evidence.forcedCleanup };
}
