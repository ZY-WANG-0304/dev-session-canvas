import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { assertDigest, assertRecord, assertSHA, digest, objectDigest } from '../gates/receipts.mjs';

export const requiredTargets = Object.freeze(['github-release-assets', 'open-vsx']);
export const marketplaceTargets = Object.freeze(['open-vsx', 'visual-studio']);
export const extensionIDs = Object.freeze([
  'devsessioncanvas.dev-session-canvas', 'devsessioncanvas.dev-session-canvas-notifier'
]);
// No signing exception has been established. Different bytes may be reported
// as unknown, but cannot pass merely because extension ID/version exists.
export const contentPolicy = Object.freeze({ schemaVersion: 1, name: 'original-vsix-sha256',
  allowedMemberChanges: [], rawMatchRequired: true });
export const contentPolicyDigest = objectDigest(contentPolicy);
export const releaseJobName = job => `Release ${job}`;

export function validateReleaseContext(context) {
  assertRecord(context, 'release context'); assert.equal(context.schemaVersion, 1);
  assert(['release-tag', 'channel-retry', 'incomplete-release-recovery'].includes(context.mode));
  assertRecord(context.run, 'release run');
  assertSHA(context.releaseSHA); assertSHA(context.baseSHA); assertSHA(context.run.headSHA);
  assert.match(context.version ?? '', /^\d+\.\d+\.\d+$/u);
  assert.equal(context.triggerTag, `publish/v${context.version}`);
  assert.equal(context.finalTag, `v${context.version}`);
  assert.deepEqual(context.requiredTargets, requiredTargets);
  assert.equal(context.contentPolicyDigest, contentPolicyDigest);
  const deferredTargets = context.deferredTargets ?? [];
  assert(Array.isArray(deferredTargets));
  assert.equal(new Set(deferredTargets).size, deferredTargets.length, 'Duplicate deferred channel');
  assert(deferredTargets.every(target => target === 'visual-studio'), 'Only Visual Studio may be deferred by policy');
  if (context.selection !== 'all') assert(!deferredTargets.includes(context.selection), 'A selected channel cannot be deferred');
  assert.deepEqual(context.selectedTargets, (context.selection === 'all'
    ? marketplaceTargets : [context.selection]).filter(target => !deferredTargets.includes(target)));
  assert(context.selectedTargets.every(target => marketplaceTargets.includes(target)));
  assert.match(String(context.run.id), /^(?:local-[a-zA-Z0-9-]+|[1-9]\d*)$/u);
  assert(Number.isSafeInteger(context.run.attempt) && context.run.attempt > 0);
  assert.match(context.repository ?? '', /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u);
  if (context.mode === 'release-tag') {
    // workflow_dispatch executes the workflow at its selected ref. The tested
    // release SHA is bound separately by the plan and acceptance; the actual
    // run head must remain the API-reported workflow ref.
    assert.equal(context.selection, 'all');
    assert.equal(context.existingReleaseID, null);
  } else {
    assert(Number.isSafeInteger(context.existingReleaseID) && context.existingReleaseID > 0);
    if (context.mode === 'incomplete-release-recovery') {
      assert.equal(context.selection, 'all', 'Incomplete recovery must include the complete delivery scope');
      assertRecord(context.recoverySourceRun, 'recovery source run');
      assert.match(String(context.recoverySourceRun.id), /^[1-9]\d*$/u);
      assert(Number.isSafeInteger(context.recoverySourceRun.attempt) && context.recoverySourceRun.attempt > 0);
      assertSHA(context.recoverySourceRun.headSHA);
      assert.equal(context.recoverySourceRun.headSHA, context.releaseSHA);
      assert.notEqual(String(context.recoverySourceRun.id), String(context.run.id));
      assertRecord(context.recoveryArtifactRun, 'accepted recovery artifact run');
      assert.match(String(context.recoveryArtifactRun.id), /^[1-9]\d*$/u);
      assert(Number.isSafeInteger(context.recoveryArtifactRun.attempt) && context.recoveryArtifactRun.attempt > 0);
      assertSHA(context.recoveryArtifactRun.headSHA);
      assert.equal(context.recoveryArtifactRun.headSHA, context.run.headSHA);
      if (context.recoveryPreviousRun) {
        assertRecord(context.recoveryPreviousRun, 'previous recovery run');
        assert.match(String(context.recoveryPreviousRun.id), /^[1-9]\d*$/u);
        assert(Number.isSafeInteger(context.recoveryPreviousRun.attempt) && context.recoveryPreviousRun.attempt > 0);
        assertSHA(context.recoveryPreviousRun.headSHA);
        assert.equal(context.recoveryPreviousRun.headSHA, context.run.headSHA);
        assert.notEqual(String(context.recoveryPreviousRun.id), String(context.run.id));
        assert.equal(String(context.recoveryArtifactRun.id) === String(context.run.id), false,
          'A resumed run must retain the accepted artifact producer from its predecessor');
      } else {
        assert.deepEqual(context.recoveryArtifactRun, context.run,
          'The first recovery run is the accepted artifact producer');
      }
    } else assert.equal(context.recoverySourceRun, undefined);
  }
  return context;
}

export function releaseIdentity({ context, acceptance, packageReceipt }) {
  validateReleaseContext(context);
  assert.equal(acceptance.inputSHA, context.releaseSHA);
  assert.equal(acceptance.version, context.version);
  assert.equal(acceptance.mode, 'release-tag', 'PR packages cannot be published');
  assert.equal(acceptance.packageReceiptDigest, objectDigest(packageReceipt));
  assert.equal(packageReceipt.inputSHA, context.releaseSHA);
  assert.deepEqual(acceptance.packages, packageReceipt.packages);
  const identity = { schemaVersion: 1, releaseSHA: context.releaseSHA, version: context.version,
    acceptanceDigest: objectDigest(acceptance), packageReceiptDigest: objectDigest(packageReceipt),
    packages: packageReceipt.packages, contentPolicyDigest, requiredTargets: [...requiredTargets] };
  validateIdentity(identity); return identity;
}
export function validateIdentity(identity) {
  assertRecord(identity, 'release identity'); assert.equal(identity.schemaVersion, 1);
  assertSHA(identity.releaseSHA); assert.match(identity.version ?? '', /^\d+\.\d+\.\d+$/u);
  for (const key of ['acceptanceDigest', 'packageReceiptDigest']) assertDigest(identity[key], key);
  assert.equal(identity.contentPolicyDigest, contentPolicyDigest);
  assert.deepEqual(identity.requiredTargets, requiredTargets);
  assert.equal(identity.packages?.length, 2);
  assert.deepEqual(identity.packages.map(pkg => pkg.id).sort(), [...extensionIDs].sort());
  for (const pkg of identity.packages) {
    assert.equal(pkg.version, identity.version); assertDigest(pkg.sha256, 'original package');
    assertDigest(pkg.payloadDigest, 'payload digest');
    assert.equal(pkg.path, pkg.id.endsWith('-notifier') ? 'notifier.vsix' : 'main.vsix');
    assert(Number.isSafeInteger(pkg.size) && pkg.size > 0);
  }
  return identity;
}

export async function packageContent(bytes) {
  const zip = await JSZip.loadAsync(bytes); const members = [];
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    assert(!entry.unsafeOriginalName || entry.unsafeOriginalName === name, 'Sanitized remote VSIX member');
    assert(!name.startsWith('/') && !name.includes('\\') && !name.split('/').includes('..'), 'Unsafe remote VSIX member');
    assert(!entry.unixPermissions || ((entry.unixPermissions >> 12) & 15) !== 10, 'VSIX may not redirect a member');
    members.push({ path: name, sha256: digest(await entry.async('nodebuffer')) });
  }
  const manifestEntry = zip.file('extension/package.json'); assert(manifestEntry, 'Remote VSIX has no manifest');
  const manifest = JSON.parse(await manifestEntry.async('string'));
  return { id: `${manifest.publisher}.${manifest.name}`, version: manifest.version,
    rawHash: digest(bytes), payloadHash: objectDigest(members.sort((a, b) => a.path.localeCompare(b.path))) };
}
export async function compareRemotePackage(bytes, pkg) {
  const remote = await packageContent(bytes);
  if (remote.id !== pkg.id || remote.version !== pkg.version) return { content: 'mismatch', remote,
    reason: 'Remote package identity differs' };
  if (remote.rawHash === pkg.sha256) return { content: 'match', remote, reason: null };
  return { content: remote.payloadHash === pkg.payloadDigest ? 'unknown' : 'mismatch', remote,
    reason: remote.payloadHash === pkg.payloadDigest
      ? 'Raw bytes differ; an archive/signing exception has not been established'
      : 'Remote VSIX members differ from the accepted package' };
}

export function validateObservation(observation) {
  assertRecord(observation, 'channel observation');
  assert(['absent', 'present', 'unknown'].includes(observation.observation));
  assert(['match', 'mismatch', 'unknown'].includes(observation.content));
  assert(Number.isFinite(Date.parse(observation.observedAt)), 'Observation needs its actual time');
  if (observation.content === 'match') {
    assert.equal(observation.observation, 'present');
    assertDigest(observation.remote?.rawHash, 'remote raw bytes');
    assertDigest(observation.remote?.payloadHash, 'remote payload');
  }
  if (observation.observation === 'absent') assert.equal(observation.content, 'unknown');
  return observation;
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function observePackage(query, pkg, deadline, now) {
  try {
    const observation = validateObservation(await query(pkg, deadline));
    if (observation.content === 'match') {
      assert.equal(observation.remote.id, pkg.id); assert.equal(observation.remote.version, pkg.version);
      assert.equal(observation.remote.rawHash, pkg.sha256);
      assert.equal(observation.remote.payloadHash, pkg.payloadDigest);
    }
    return observation;
  } catch {
    return { observation: 'unknown', content: 'unknown', remote: null,
      observedAt: new Date(now()).toISOString(), reason: 'Channel query or response validation failed' };
  }
}
// One submission at most, and only after a confirmed absence. A timeout is an
// unknown submission: subsequent absence/unknown observations never resubmit.
export async function deliverPackage({ pkg, query, submit, deadline, attempts = 12, intervalMs = 30000,
  now = Date.now, sleep = delay, selected = true, previous }) {
  assert(Number.isFinite(deadline) && deadline > now());
  assert(Number.isSafeInteger(attempts) && attempts > 0); assert(intervalMs >= 0);
  const receipt = { extensionID: pkg.id, version: pkg.version, sourcePackageHash: pkg.sha256,
    contentPolicyHash: contentPolicyDigest, observation: 'unknown', content: 'unknown',
    submission: 'not-submitted', evidenceUse: 'fresh', observations: [], remote: null,
    verifiedAt: null, reusedFrom: null, reason: null };
  let maySubmit = selected, submissionAttempted = false;
  for (let attempt = 0; attempt < attempts && now() < deadline; attempt++) {
    const observation = await observePackage(query, pkg, deadline, now);
    receipt.observations.push(observation);
    Object.assign(receipt, { observation: observation.observation, content: observation.content,
      remote: observation.remote ?? null, reason: observation.reason ?? null });
    if (observation.content === 'mismatch') return receipt;
    if (observation.content === 'match') {
      assert.equal(observation.remote.rawHash, pkg.sha256, 'Content match must identify the original bytes');
      receipt.verifiedAt = observation.observedAt; return receipt;
    }
    if (!selected) break;
    if (observation.observation === 'absent' && maySubmit && !submissionAttempted) {
      submissionAttempted = true; maySubmit = false;
      let result;
      try { result = await submit(pkg, deadline); }
      catch { result = { submission: 'unknown', reason: 'Submission completion is unknown; query before any retry' }; }
      assert(['submitted', 'rejected', 'unknown', 'not-submitted'].includes(result.submission));
      receipt.submission = result.submission; receipt.submissionEvidence = result;
      if (['rejected', 'not-submitted'].includes(result.submission)) { receipt.reason = result.reason; return receipt; }
      // Verification after submitting is required even on the final query slot.
      if (attempt === attempts - 1 && now() < deadline) {
        const final = await observePackage(query, pkg, deadline, now); receipt.observations.push(final);
        Object.assign(receipt, { observation: final.observation, content: final.content, remote: final.remote ?? null,
          reason: final.reason ?? null, verifiedAt: final.content === 'match' ? final.observedAt : null });
      }
    }
    if (attempt + 1 < attempts && now() < deadline) await sleep(Math.min(intervalMs, Math.max(0, deadline - now())));
  }
  if (!selected && previous?.content === 'match' && receipt.content !== 'mismatch') {
    validatePackageDelivery(previous, pkg);
    // This is explicitly historical evidence, never a fresh match. The current
    // unknown/absent observation remains visible in the receipt.
    receipt.evidenceUse = 'reused'; receipt.reusedFrom = { ...previous };
  }
  return receipt;
}

export function validatePackageDelivery(receipt, pkg) {
  assertRecord(receipt, 'package delivery');
  assert.equal(receipt.extensionID, pkg.id); assert.equal(receipt.version, pkg.version);
  assert.equal(receipt.sourcePackageHash, pkg.sha256); assert.equal(receipt.contentPolicyHash, contentPolicyDigest);
  assert(['not-submitted', 'submitted', 'rejected', 'unknown'].includes(receipt.submission));
  assert(['fresh', 'reused'].includes(receipt.evidenceUse));
  assert(Array.isArray(receipt.observations) && receipt.observations.length > 0, 'Missing actual channel observations');
  for (const observation of receipt.observations) validateObservation(observation);
  const last = receipt.observations.at(-1);
  assert.equal(receipt.observation, last.observation); assert.equal(receipt.content, last.content);
  assert.deepEqual(receipt.remote, last.remote ?? null);
  for (const observation of receipt.observations.filter(item => item.content === 'match')) {
    assert.equal(observation.remote.id, pkg.id); assert.equal(observation.remote.version, pkg.version);
    assert.equal(observation.remote.rawHash, pkg.sha256); assert.equal(observation.remote.payloadHash, pkg.payloadDigest);
  }
  if (receipt.content === 'match') {
    assert.equal(receipt.remote?.rawHash, pkg.sha256); assert.equal(last.remote.rawHash, pkg.sha256);
    assert.equal(receipt.verifiedAt, last.observedAt);
  } else assert.equal(receipt.verifiedAt, null, 'Unknown content cannot have a fresh verification time');
  if (receipt.evidenceUse === 'reused') {
    assert(receipt.reusedFrom && receipt.content !== 'mismatch');
    assert.equal(receipt.reusedFrom.evidenceUse, 'fresh', 'Historical evidence cannot be a chain of unverified reuse');
    validatePackageDelivery(receipt.reusedFrom, pkg); assert.equal(receipt.reusedFrom.content, 'match');
  } else assert.equal(receipt.reusedFrom, null, 'Fresh observations cannot carry historical success');
  return receipt;
}
export const deliveryIsComplete = (entry, allowReuse = false) => entry.content === 'match'
  || allowReuse && entry.evidenceUse === 'reused' && entry.content !== 'mismatch' && entry.reusedFrom?.content === 'match';

export function validateChannelPartial(partial, identity, { context, actualJob, artifact } = {}) {
  validateIdentity(identity); assertRecord(partial, 'channel partial'); assert.equal(partial.schemaVersion, 1);
  assert(marketplaceTargets.includes(partial.target)); assert.equal(partial.releaseSHA, identity.releaseSHA);
  assert.equal(partial.version, identity.version); assert.equal(partial.identityDigest, objectDigest(identity));
  assert.equal(partial.contentPolicyDigest, contentPolicyDigest);
  assert(Number.isFinite(Date.parse(partial.completedAt)), 'Partial has no completion time');
  assert.equal(partial.packages?.length, 2);
  assert.deepEqual(partial.packages.map(entry => entry.extensionID).sort(), [...extensionIDs].sort());
  for (const entry of partial.packages) {
    validatePackageDelivery(entry, identity.packages.find(pkg => pkg.id === entry.extensionID));
    assert(entry.observations.every(observation => Date.parse(observation.observedAt) <= Date.parse(partial.completedAt)),
      'Partial completed before its observations');
  }
  if (context) {
    assert.equal(partial.producer.repository, context.repository);
    assert.equal(partial.producer.runID, String(context.run.id)); assert.equal(partial.producer.attempt, context.run.attempt);
    assert.equal(partial.producer.job, `publish-${partial.target}`);
    const allowReuse = context.mode === 'channel-retry' && !context.selectedTargets.includes(partial.target);
    if (!allowReuse) assert(partial.packages.every(entry => entry.evidenceUse === 'fresh'), 'Selected target needs fresh verification');
    if (actualJob) {
      assert.equal(actualJob.name, releaseJobName(partial.producer.job)); assert.equal(actualJob.status, 'completed');
      const reportedIncomplete = partial.target === 'open-vsx' && actualJob.conclusion === 'failure'
        && actualJob.steps?.some(step => step.name === 'Fail incomplete required channel' && step.conclusion === 'failure')
        && actualJob.steps.every(step => step.name === 'Fail incomplete required channel'
          || ['success', 'skipped'].includes(step.conclusion))
        && partial.packages.some(entry => !deliveryIsComplete(entry,
          context.mode === 'channel-retry' && !context.selectedTargets.includes(partial.target)));
      assert(actualJob.conclusion === 'success' || reportedIncomplete,
        'Actual channel producer did not complete its receipt contract');
      assert.equal(artifact?.jobID, actualJob.id); assert(artifact.receiptDigests.includes(objectDigest(partial)));
    }
  }
  return partial;
}

export function calculateReleaseCompletion({ context, identity, github, partials, facts, history = {} }) {
  validateReleaseContext(context); validateIdentity(identity);
  assert.equal(identity.releaseSHA, context.releaseSHA); assert.equal(identity.version, context.version);
  assert.equal(github?.schemaVersion, 1); assert.equal(github.identityDigest, objectDigest(identity));
  assert.equal(github.releaseSHA, context.releaseSHA); assert.equal(github.version, context.version);
  assert(Number.isSafeInteger(github.releaseID) && github.releaseID > 0);
  if (['channel-retry', 'incomplete-release-recovery'].includes(context.mode)) {
    assert.equal(github.releaseID, context.existingReleaseID);
  }
  assert(Number.isFinite(Date.parse(github.completedAt)));
  assert.equal(github.producer.runID, String(context.run.id)); assert.equal(github.producer.attempt, context.run.attempt);
  assert.equal(github.producer.job, 'prepare-release'); assert.equal(github.producer.repository, context.repository);
  assert.equal(github.packages?.length, 2);
  assert.deepEqual(github.packages.map(pkg => pkg.extensionID).sort(), [...extensionIDs].sort());
  for (const pkg of identity.packages) {
    const delivered = github.packages.find(entry => entry.extensionID === pkg.id);
    assert.equal(delivered.sourcePackageHash, pkg.sha256); assert.equal(delivered.remotePackageHash, pkg.sha256);
    assert.equal(delivered.content, 'match'); assert.equal(delivered.observation, 'present');
    assert(Number.isSafeInteger(delivered.assetID) && delivered.assetID > 0);
    assert(Number.isFinite(Date.parse(delivered.verifiedAt)) && Date.parse(delivered.verifiedAt) <= Date.parse(github.completedAt));
  }
  assert(facts && Array.isArray(facts.jobs) && Array.isArray(facts.artifacts), 'Independent job/artifact facts are required');
  assert.equal(facts.schemaVersion, 1); assert.equal(facts.repository, context.repository);
  assert.equal(facts.runID, String(context.run.id)); assert.equal(facts.attempt, context.run.attempt);
  assert.equal(facts.headSHA, context.run.headSHA);
  assert.equal(new Set(facts.jobs.map(job => job.id)).size, facts.jobs.length, 'Duplicate actual job');
  assert.equal(new Set(facts.artifacts.map(artifact => artifact.name)).size, facts.artifacts.length, 'Duplicate actual artifact');
  for (const artifact of facts.artifacts) {
    assert(Number.isSafeInteger(artifact.id) && artifact.id > 0); assertDigest(artifact.archiveHash, 'Actual artifact bytes');
    assert.equal(artifact.runID, String(context.run.id)); assert.equal(artifact.attempt, context.run.attempt);
    assert.equal(artifact.headSHA, context.run.headSHA);
  }
  const prepareJob = facts.jobs.find(job => job.name === releaseJobName('prepare-release'));
  assert.equal(prepareJob?.status, 'completed'); assert.equal(prepareJob.conclusion, 'success');
  const prepared = facts.artifacts.find(artifact => artifact.name === `prepared-release-${context.run.id}-${context.run.attempt}`);
  assert.equal(prepared?.jobID, prepareJob.id); assert(prepared.receiptDigests.includes(objectDigest(github)));
  assert(Array.isArray(partials)); const channels = {}, errors = [];
  for (const partial of partials) {
    assert(!channels[partial.target], 'Duplicate channel partial');
    const job = facts.jobs.find(item => item.name === releaseJobName(`publish-${partial.target}`));
    const artifact = facts.artifacts.find(item => item.name === `marketplace-result-${partial.target}-${context.run.id}-${context.run.attempt}`);
    assert(job && artifact, 'Channel partial has no independently verified producer');
    validateChannelPartial(partial, identity, { context, actualJob: job, artifact });
    channels[partial.target] = partial;
  }
  for (const target of marketplaceTargets) {
    const partial = channels[target];
    if (context.deferredTargets?.includes(target)) {
      assert.equal(partial, undefined, 'Paused channel cannot have a current result');
      const job = facts.jobs.find(item => item.name === releaseJobName(`publish-${target}`));
      assert.equal(job, undefined, 'Paused channel must not have a release job in this workflow');
      const artifactNames = facts.artifactNames ?? facts.artifacts.map(artifact => artifact.name);
      assert(!artifactNames.some(name => name.startsWith(`marketplace-result-${target}-`)),
        'Paused channel must not produce a result artifact');
      continue;
    }
    if (!partial) {
      const historical = context.mode === 'channel-retry' && !context.selectedTargets.includes(target)
        ? history[target]?.partial : null;
      if (historical) { channels[target] = historical; continue; }
      errors.push({ target, reason: 'Missing channel result or producer evidence' }); continue;
    }
    const allowReuse = context.mode === 'channel-retry' && !context.selectedTargets.includes(target);
    const complete = partial.packages.every(entry => deliveryIsComplete(entry, allowReuse));
    if (!complete && requiredTargets.includes(target)) errors.push({ target, reason: 'Required package content is not verified' });
  }
  return { schemaVersion: 1, status: errors.length ? 'failed' : 'complete', releaseSHA: context.releaseSHA,
    version: context.version, identityDigest: objectDigest(identity), requiredTargets: [...requiredTargets],
    github, channels, errors, deferredTargets: (context.deferredTargets ?? []).filter(target => !channels[target]),
    visualStudioBlocking: false,
    producer: { runID: String(context.run.id), attempt: context.run.attempt, repository: context.repository, job: 'finalize-release' },
    completedAt: errors.length ? null : new Date().toISOString() };
}
