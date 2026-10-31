import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { assertSHA, digest, fileDigest, objectDigest, readJSON, verifyPackageFiles, writeJSON } from '../gates/receipts.mjs';
import { checkGitHubAcceptance, findUniqueFile, validateAcceptance } from '../gates/check-acceptance.mjs';
import { collectGitHubProvenance } from '../gates/github-provenance.mjs';
import { githubClient, collectReleaseFacts, releaseArtifactJob } from './release-github.mjs';
import { contentPolicyDigest, marketplaceTargets, requiredTargets, releaseIdentity, releaseJobName,
  validateReleaseContext, validateChannelPartial, calculateReleaseCompletion, deliveryIsComplete } from './release-completion.mjs';
import { assertFormalEnvironment } from '../gates/resolve-plan.mjs';
import { buildReleaseNotes } from './write-github-release-notes.mjs';
import { appendReleaseState, recoverReleaseState, saveReleaseState } from './release-state.mjs';

export const immutableReleaseFiles = Object.freeze(['main.vsix', 'notifier.vsix', 'package-receipt.json',
  'gate-plan.json', 'gate-result.json', 'gate-provenance.json', 'acceptance-receipt.json',
  'release-identity.json', 'original-release-context.json']);
const deferredMarketplaceTargets = env => env.VISUAL_STUDIO_MARKETPLACE_ENABLED === 'true' ? [] : ['visual-studio'];
const gitRevision = (root, revision, optional = false) => {
  try { return execFileSync('git', ['rev-parse', '--verify', '--quiet', `${revision}^{commit}`], { cwd: root, encoding: 'utf8' }).trim(); }
  catch (error) { if (optional && error.status === 1) return null; throw error; }
};

export async function resolveRelease({ triggerTag, selection = 'all', root = process.cwd(), client = githubClient(),
  deadline = Date.now() + 300000, run, env = process.env }) {
  assertFormalEnvironment(env);
  const deferredTargets = deferredMarketplaceTargets(env);
  const version = /^publish\/v(\d+\.\d+\.\d+)$/u.exec(triggerTag ?? '')?.[1]; assert(version, 'Expected publish/vX.Y.Z');
  assert(['all', ...marketplaceTargets.filter(target => !deferredTargets.includes(target))].includes(selection),
    'Visual Studio Marketplace is disabled until VISUAL_STUDIO_MARKETPLACE_ENABLED is true');
  const finalTag = `v${version}`;
  const lookup = await client.lookupRelease(finalTag, deadline);
  assert(['present', 'absent'].includes(lookup.observation), 'Cannot resolve unknown Release state');
  const triggerSHA = await client.readTag(triggerTag, deadline);
  const finalSHA = await client.readTag(finalTag, deadline);
  const mode = lookup.observation === 'present' ? 'channel-retry' : 'release-tag';
  const releaseSHA = triggerSHA ?? (mode === 'channel-retry' ? finalSHA : null);
  assertSHA(releaseSHA); assert(triggerSHA || mode === 'channel-retry', 'A new release requires its trigger tag');
  if (finalSHA) assert.equal(finalSHA, releaseSHA, 'Final tag differs from release input');
  if (mode === 'channel-retry') {
    assert.equal(finalSHA, releaseSHA); assert.equal(lookup.release.tag_name, finalTag);
    assert.equal(lookup.release.draft, false, 'Draft Release cannot be used as completed original batch');
  } else {
    assert.equal(selection, 'all', 'A new release must select the complete delivery scope');
  }
  // Fetch is performed by the entry job; only immutable revisions are read here.
  assert.equal(gitRevision(root, releaseSHA), releaseSHA);
  execFileSync('git', ['merge-base', '--is-ancestor', releaseSHA, 'origin/main'], { cwd: root });
  const baseSHA = gitRevision(root, `${releaseSHA}^1`);
  const context = validateReleaseContext({ schemaVersion: 1, mode, triggerTag, finalTag, version, releaseSHA, baseSHA,
    repository: client.repository, selection, deferredTargets,
    selectedTargets: (selection === 'all' ? [...marketplaceTargets] : [selection])
      .filter(target => !deferredTargets.includes(target)),
    requiredTargets: [...requiredTargets], contentPolicyDigest,
    existingReleaseID: lookup.release?.id ?? null, run });
  const manifest = JSON.parse(execFileSync('git', ['show', `${releaseSHA}:package.json`], { cwd: root, encoding: 'utf8' }));
  assert.equal(manifest.version, version, 'Tag version differs from source version');
  try { execFileSync('git', ['cat-file', '-e', `${releaseSHA}:scripts/gates/catalog.mjs`], { cwd: root, stdio: 'pipe' }); }
  catch { throw new Error('Historical release has no new acceptance schema; rerun its original workflow at that historical ref'); }
  return context;
}

export async function resolveIncompleteReleaseRecovery({ triggerTag, recoverySourceRunID, recoveryPreviousRunID,
  root = process.cwd(), client = githubClient(), deadline = Date.now() + 300000, run, env = process.env,
  factsCollector = collectReleaseFacts }) {
  assertFormalEnvironment(env);
  assert.equal(run.headSHA, gitRevision(root, 'HEAD'), 'Recovery logic must run from its actual workflow checkout');
  const version = /^publish\/v(\d+\.\d+\.\d+)$/u.exec(triggerTag ?? '')?.[1];
  assert(version, 'Expected publish/vX.Y.Z');
  assert.match(String(recoverySourceRunID ?? ''), /^[1-9]\d*$/u, 'Specify the original failed release run ID');
  const finalTag = `v${version}`;
  const sourceRun = await client.json(`actions/runs/${recoverySourceRunID}`, { deadline });
  assert.equal(sourceRun.id, Number(recoverySourceRunID));
  assert.equal(sourceRun.path, '.github/workflows/publish-marketplace-release.yml');
  assert.equal(sourceRun.name, 'Publish Marketplace Release');
  assert.equal(sourceRun.event, 'push');
  assert.equal(sourceRun.head_branch, triggerTag);
  assert.equal(sourceRun.conclusion, 'failure');
  assert(Number.isSafeInteger(sourceRun.run_attempt) && sourceRun.run_attempt >= 1);
  assert.equal(sourceRun.repository?.full_name, client.repository);

  const jobs = await client.pages(`actions/runs/${sourceRun.id}/attempts/${sourceRun.run_attempt}/jobs`, 'jobs', deadline);
  const requireJob = (suffix, conclusion) => {
    const matches = jobs.filter(job => job.name === `Release ${suffix}`
      || job.name.split(' / ').at(-1) === `Release ${suffix}`);
    assert.equal(matches.length, 1, `Source run must contain exactly one Release ${suffix} job`);
    assert.equal(matches[0].status, 'completed');
    assert.equal(matches[0].conclusion, conclusion, `Source Release ${suffix} must be ${conclusion}`);
    return matches[0];
  };
  requireJob('resolve-release', 'success');
  requireJob('prepare-release', 'failure');
  requireJob('publish-open-vsx', 'skipped');
  requireJob('publish-visual-studio', 'skipped');
  requireJob('finalize-release', 'skipped');

  const lookup = await client.lookupRelease(finalTag, deadline);
  assert.equal(lookup.observation, 'present', 'Incomplete recovery requires the original GitHub Release');
  const triggerSHA = await client.readTag(triggerTag, deadline);
  const finalSHA = await client.readTag(finalTag, deadline);
  assertSHA(triggerSHA); assert.equal(finalSHA, triggerSHA, 'Final tag differs from release input');
  assert.equal(sourceRun.head_sha, triggerSHA, 'Failed source run differs from the current release SHA');
  assert.equal(lookup.release.tag_name, finalTag);
  assert.equal(lookup.release.id > 0, true);
  assert.equal(lookup.release.name, `Dev Session Canvas v${version}`);
  assert.equal(lookup.release.target_commitish, triggerSHA);
  assert.equal(lookup.release.draft, false);
  assert.equal(lookup.release.prerelease, false);
  assert.equal(lookup.release.body,
    `已验收的主扩展与 notifier 双包；渠道交付进行中。\n\nRelease ref: ${triggerSHA}`,
    'Release notes no longer match the untouched initial delivery state');
  const assets = await client.pages(`releases/${lookup.release.id}/assets`, null, deadline);
  assert(assets.every(asset => immutableReleaseFiles.includes(asset.name)),
    'Incomplete recovery refuses manifest, state, or unrelated Release assets');
  assert.equal(new Set(assets.map(asset => asset.name)).size, assets.length, 'Duplicate Release assets are ambiguous');
  assert(assets.every(asset => asset.state === 'uploaded'), 'Incomplete recovery refuses assets in an unknown state');

  assert.equal(gitRevision(root, triggerSHA), triggerSHA);
  execFileSync('git', ['merge-base', '--is-ancestor', triggerSHA, 'origin/main'], { cwd: root });
  const baseSHA = gitRevision(root, `${triggerSHA}^1`);
  const manifest = JSON.parse(execFileSync('git', ['show', `${triggerSHA}:package.json`], { cwd: root, encoding: 'utf8' }));
  assert.equal(manifest.version, version, 'Tag version differs from source version');
  try { execFileSync('git', ['cat-file', '-e', `${triggerSHA}:scripts/gates/catalog.mjs`], { cwd: root, stdio: 'pipe' }); }
  catch { throw new Error('Release input has no supported acceptance schema'); }
  const previousRecovery = recoveryPreviousRunID ? await validatePreviousRecoveryRun({ recoveryPreviousRunID,
    triggerTag, sourceRun, releaseSHA: triggerSHA, releaseID: lookup.release.id, run, client, factsCollector, deadline }) : null;
  const recoveryArtifactRun = previousRecovery?.recoveryArtifactRun ?? run;
  const deferredTargets = deferredMarketplaceTargets(env);
  const context = validateReleaseContext({ schemaVersion: 1, mode: 'incomplete-release-recovery', triggerTag,
    finalTag, version, releaseSHA: triggerSHA, baseSHA, repository: client.repository, selection: 'all',
    deferredTargets, selectedTargets: marketplaceTargets.filter(target => !deferredTargets.includes(target)),
    requiredTargets: [...requiredTargets], contentPolicyDigest,
    existingReleaseID: lookup.release.id, recoverySourceRun: { id: String(sourceRun.id),
      attempt: sourceRun.run_attempt, headSHA: sourceRun.head_sha }, run,
    ...(previousRecovery ? { recoveryPreviousRun: previousRecovery.previousRun } : {}), recoveryArtifactRun });
  return context;
}

async function validatePreviousRecoveryRun({ recoveryPreviousRunID, triggerTag, sourceRun, releaseSHA, releaseID,
  run, client, factsCollector, deadline }) {
  assert.match(String(recoveryPreviousRunID ?? ''), /^[1-9]\d*$/u, 'Specify the previous recovery run ID');
  assert.notEqual(String(recoveryPreviousRunID), String(run.id), 'A recovery run cannot resume itself');
  const previous = await client.json(`actions/runs/${recoveryPreviousRunID}`, { deadline });
  assert.equal(previous.id, Number(recoveryPreviousRunID));
  assert.equal(previous.path, '.github/workflows/publish-marketplace-release.yml');
  assert.equal(previous.name, 'Publish Marketplace Release');
  assert.equal(previous.event, 'workflow_dispatch');
  assert.equal(previous.head_branch, 'main');
  assert.equal(previous.conclusion, 'failure');
  assert(Number.isSafeInteger(previous.run_attempt) && previous.run_attempt >= 1);
  assert.equal(previous.head_sha, run.headSHA, 'Previous recovery used a different main workflow head');
  assert.equal(previous.repository?.full_name, client.repository);

  const jobs = await client.pages(`actions/runs/${previous.id}/attempts/${previous.run_attempt}/jobs`, 'jobs', deadline);
  const requireJob = (suffix, conclusion) => {
    const matches = jobs.filter(job => job.name === `Release ${suffix}`
      || job.name.split(' / ').at(-1) === `Release ${suffix}`);
    assert.equal(matches.length, 1, `Previous recovery must contain exactly one Release ${suffix} job`);
    assert.equal(matches[0].status, 'completed');
    assert.equal(matches[0].conclusion, conclusion, `Previous recovery Release ${suffix} must be ${conclusion}`);
    return matches[0];
  };
  requireJob('resolve-release', 'success');
  // prepare runs only when the reusable complete verifier reports accepted=true.
  requireJob('prepare-release', 'failure');
  requireJob('publish-open-vsx', 'skipped');
  requireJob('publish-visual-studio', 'skipped');
  requireJob('finalize-release', 'skipped');

  const previousRun = { id: String(previous.id), attempt: previous.run_attempt, headSHA: previous.head_sha };
  const artifactOutput = await fs.mkdtemp(path.join(os.tmpdir(), 'dsc-release-recovery-context-'));
  try {
    const facts = await factsCollector({ repository: client.repository, run: previousRun }, { client, output: artifactOutput, deadline,
      allowedNames: [`release-context-${previous.id}-${previous.run_attempt}`],
      namesForJobs: () => releaseJobName('resolve-release') });
    assert.equal(facts.artifacts.length, 1, 'Previous recovery context must have one verified resolve artifact');
    const artifact = facts.artifacts[0];
    const producer = facts.jobs.find(job => job.id === artifact.jobID);
    assert.equal(producer?.conclusion, 'success');
    const previousContext = validateReleaseContext(await readJSON(await findUniqueFile(
      path.join(artifactOutput, artifact.name), 'release-context.json')));
    assert(artifact.receiptDigests.includes(objectDigest(previousContext)),
      'Previous recovery context differs from its verified resolve artifact');
    assert.equal(previousContext.mode, 'incomplete-release-recovery');
    assert.equal(previousContext.triggerTag, triggerTag);
    assert.equal(previousContext.releaseSHA, releaseSHA);
    assert.equal(previousContext.existingReleaseID, releaseID);
    assert.deepEqual(previousContext.recoverySourceRun, { id: String(sourceRun.id),
      attempt: sourceRun.run_attempt, headSHA: sourceRun.head_sha },
    'Previous recovery must bind the same original failed release run');
    assert.deepEqual(previousContext.run, previousRun, 'Previous context must match the actual workflow run');
    return { previousRun, recoveryArtifactRun: previousContext.recoveryArtifactRun };
  } finally { await fs.rm(artifactOutput, { recursive: true, force: true }); }
}

export async function verifyRecoveredRelease({ context, output, client = githubClient({ repository: context.repository }),
  deadline = Date.now() + 600000, collector = collectGitHubProvenance, stateCollector = collectReleaseFacts }) {
  validateReleaseContext(context); assert.equal(context.mode, 'channel-retry');
  const lookup = await client.lookupRelease(context.finalTag, deadline); assert.equal(lookup.observation, 'present');
  assert.equal(lookup.release.id, context.existingReleaseID); assert.equal(await client.readTag(context.finalTag, deadline), context.releaseSHA);
  const assets = await client.pages(`releases/${lookup.release.id}/assets`, null, deadline);
  const names = [...immutableReleaseFiles];
  const downloaded = [];
  for (const name of names) {
    const matches = assets.filter(asset => asset.name === name); assert.equal(matches.length, 1,
      `Original release is incomplete or ambiguous: ${name}; refuse repackage/clobber`);
    const asset = matches[0]; assert.equal(asset.state, 'uploaded');
    const bytes = await client.downloadAsset(asset, deadline); await fs.mkdir(output, { recursive: true });
    await fs.writeFile(path.join(output, name), bytes, { flag: 'wx' });
    downloaded.push({ name, assetID: asset.id, size: bytes.length, sha256: digest(bytes) });
  }
  const plan = await readJSON(path.join(output, 'gate-plan.json'));
  const acceptance = await readJSON(path.join(output, 'acceptance-receipt.json'));
  const result = await readJSON(path.join(output, 'gate-result.json'));
  const provenance = await readJSON(path.join(output, 'gate-provenance.json'));
  const originalContext = validateReleaseContext(await readJSON(path.join(output, 'original-release-context.json')));
  assert(['release-tag', 'incomplete-release-recovery'].includes(originalContext.mode));
  assert.equal(originalContext.releaseSHA, context.releaseSHA);
  assert.equal(originalContext.repository, context.repository);
  validateAcceptance({ plan, acceptance, result, provenance, inputSHA: context.releaseSHA });
  assert.equal(plan.mode, 'release-tag'); assert.deepEqual(plan.run, originalContext.run);
  // Independently bind the original acceptance to its actual successful
  // verifier and downloaded artifact, rather than trusting Release JSON alone.
  const originalAcceptanceFacts = await collector({ run: plan.run, tasks: [] }, { repository: context.repository,
    output: path.join(output, 'original-acceptance-provenance'), scope: 'acceptance', allowHistoricalRun: true });
  assert.equal(originalAcceptanceFacts.artifacts.length, 1);
  const acceptanceArtifact = originalAcceptanceFacts.artifacts[0];
  const verifier = originalAcceptanceFacts.jobs.find(job => job.id === acceptanceArtifact.jobID);
  assert.equal(verifier?.name, 'Gate verify-result (default)'); assert.equal(verifier.conclusion, 'success');
  assert(acceptanceArtifact.receiptDigests.includes(objectDigest(acceptance)));
  const originalRoot = path.join(output, 'original-acceptance-provenance', acceptanceArtifact.name);
  for (const [name, expected] of [['gate-plan.json', plan], ['gate-result.json', result], ['gate-provenance.json', provenance]]) {
    assert.deepEqual(await readJSON(await findUniqueFile(originalRoot, name)), expected, 'Release evidence differs from its original verifier');
  }
  const packageReceipt = await readJSON(path.join(output, 'package-receipt.json'));
  await verifyPackageFiles(packageReceipt, plan, output);
  const candidateFacts = await collector(plan, { repository: context.repository,
    output: path.join(output, 'original-candidate-provenance'), scope: 'candidate', allowHistoricalRun: true });
  assert.equal(candidateFacts.artifacts.length, 1); const candidateArtifact = candidateFacts.artifacts[0];
  const candidateJob = candidateFacts.jobs.find(job => job.id === candidateArtifact.jobID);
  assert.equal(candidateJob?.name, 'Gate package-clean (default)'); assert.equal(candidateJob.conclusion, 'success');
  assert(candidateArtifact.receiptDigests.includes(objectDigest(packageReceipt)));
  const identity = releaseIdentity({ context, acceptance, packageReceipt });
  assert.deepEqual(await readJSON(path.join(output, 'release-identity.json')), identity);
  const state = await recoverReleaseState({ context, identity, assets, client,
    output: path.join(output, 'release-state'), deadline, collector: stateCollector });
  const previous = state.manifest;
  await fs.writeFile(path.join(output, `release-manifest-${context.version}.json`), state.bytes, { flag: 'wx' });
  const history = {};
  for (const target of marketplaceTargets.filter(target => !context.selectedTargets.includes(target))) {
    const source = previous.channelHistory?.[target]; if (!source) continue;
    validateReleaseContext(source.context);
    assert.equal(source.context.repository, context.repository); assert.equal(source.context.releaseSHA, context.releaseSHA);
    const facts = await collectReleaseFacts(source.context, { client, deadline, allowHistoricalRun: true,
      output: path.join(output, `history-provenance-${target}`),
      allowedNames: [`marketplace-result-${target}-${source.context.run.id}-${source.context.run.attempt}`], namesForJobs: releaseArtifactJob });
    const artifact = facts.artifacts[0]; const job = facts.jobs.find(item => item.id === artifact.jobID);
    validateChannelPartial(source.partial, identity, { context: source.context, actualJob: job, artifact });
    assert(source.partial.packages.every(entry => entry.content === 'match' && entry.evidenceUse === 'fresh'));
    history[target] = source;
  }
  await writeJSON(path.join(output, 'validated-channel-history.json'), history);
  const receipt = { schemaVersion: 1, status: 'passed', releaseSHA: context.releaseSHA, version: context.version,
    identityDigest: objectDigest(identity), originalAcceptanceArtifactID: acceptanceArtifact.id,
    originalCandidateArtifactID: candidateArtifact.id, downloaded,
    releaseState: { digest: state.stateDigest, chain: state.chain, downloaded: state.downloaded },
    producer: { runID: String(context.run.id), attempt: context.run.attempt, repository: context.repository, job: 'verify-recovery' },
    completedAt: new Date().toISOString() };
  await writeJSON(path.join(output, 'recovery-verification.json'), receipt); return receipt;
}

export async function prepareRelease({ context, input, output, client = githubClient({ repository: context.repository }),
  deadline = Date.now() + 1200000 }) {
  validateReleaseContext(context); await fs.mkdir(output, { recursive: true });
  const packageReceipt = await readJSON(path.join(input, 'package-receipt.json'));
  const plan = await readJSON(path.join(input, 'gate-plan.json'));
  const acceptance = await readJSON(path.join(input, 'acceptance-receipt.json'));
  await verifyPackageFiles(packageReceipt, plan, input);
  validateAcceptance({ plan, acceptance, result: await readJSON(path.join(input, 'gate-result.json')),
    provenance: await readJSON(path.join(input, 'gate-provenance.json')), inputSHA: context.releaseSHA });
  if (context.mode === 'incomplete-release-recovery') {
    assert.deepEqual(plan.run, context.recoveryArtifactRun,
      'Incomplete recovery must use the acceptance run that produced the existing asset bytes');
  }
  const identity = releaseIdentity({ context, acceptance, packageReceipt });
  if (context.mode === 'channel-retry') {
    const recovery = await readJSON(path.join(input, 'recovery-verification.json'));
    assert.equal(recovery.status, 'passed'); assert.equal(recovery.identityDigest, objectDigest(identity));
    assert.equal(recovery.producer.runID, String(context.run.id)); assert.equal(recovery.producer.attempt, context.run.attempt);
  }
  for (const name of immutableReleaseFiles.filter(name => !['release-identity.json', 'original-release-context.json'].includes(name))) {
    await fs.copyFile(path.join(input, name), path.join(output, name));
  }
  await writeJSON(path.join(output, 'release-context.json'), context);
  await writeJSON(path.join(output, 'release-identity.json'), identity);
  if (['release-tag', 'incomplete-release-recovery'].includes(context.mode)) {
    const originalContext = context.mode === 'incomplete-release-recovery'
      ? { ...context, run: context.recoveryArtifactRun } : context;
    delete originalContext.recoveryPreviousRun;
    await writeJSON(path.join(output, 'original-release-context.json'), originalContext);
  } else await fs.copyFile(path.join(input, 'original-release-context.json'),
    path.join(output, 'original-release-context.json'));
  await writeJSON(path.join(output, 'validated-channel-history.json'), context.mode === 'channel-retry'
    ? await readJSON(path.join(input, 'validated-channel-history.json')) : {});
  let finalSHA = await client.readTag(context.finalTag, deadline);
  if (!finalSHA) {
    assert.equal(context.mode, 'release-tag'); await client.createTag(context.finalTag, context.releaseSHA, deadline);
    finalSHA = await client.readTag(context.finalTag, deadline);
  }
  assert.equal(finalSHA, context.releaseSHA);
  if (context.mode === 'incomplete-release-recovery') {
    assert.equal(await client.readTag(context.triggerTag, deadline), context.releaseSHA);
  }
  let lookup = await client.lookupRelease(context.finalTag, deadline);
  if (lookup.observation === 'absent') {
    assert.equal(context.mode, 'release-tag');
    // Initial Release notes honestly describe pending delivery; finalize writes
    // the actual channel facts. No external action occurs before acceptance.
    await client.createRelease(context.finalTag, context.releaseSHA, `Dev Session Canvas v${context.version}`,
      `已验收的主扩展与 notifier 双包；渠道交付进行中。\n\nRelease ref: ${context.releaseSHA}`, deadline);
    lookup = await client.lookupRelease(context.finalTag, deadline);
  }
  assert.equal(lookup.observation, 'present'); const release = lookup.release;
  if (['channel-retry', 'incomplete-release-recovery'].includes(context.mode)) {
    assert.equal(release.id, context.existingReleaseID);
  }
  const assets = await client.pages(`releases/${release.id}/assets`, null, deadline);
  if (context.mode === 'incomplete-release-recovery') {
    assert.equal(release.tag_name, context.finalTag);
    assert.equal(release.target_commitish, context.releaseSHA);
    assert.equal(release.name, `Dev Session Canvas v${context.version}`);
    assert.equal(release.draft, false); assert.equal(release.prerelease, false);
    assert.equal(release.body,
      `已验收的主扩展与 notifier 双包；渠道交付进行中。\n\nRelease ref: ${context.releaseSHA}`);
    assert(assets.every(asset => immutableReleaseFiles.includes(asset.name)),
      'Incomplete recovery refuses manifest, state, or unrelated Release assets');
    assert.equal(new Set(assets.map(asset => asset.name)).size, assets.length, 'Duplicate Release assets are ambiguous');
    assert(assets.every(asset => asset.state === 'uploaded'), 'Incomplete recovery refuses assets in an unknown state');
  }
  const deliveries = [];
  for (const name of immutableReleaseFiles) {
    const bytes = await fs.readFile(path.join(output, name)); const matches = assets.filter(asset => asset.name === name);
    assert(matches.length <= 1, 'Ambiguous GitHub asset'); let asset = matches[0];
    if (!asset) {
      assert(['release-tag', 'incomplete-release-recovery'].includes(context.mode),
        'Original release assets are incomplete; refuse replacement');
      asset = await client.uploadAsset(release, name, bytes, deadline);
    }
    assert.equal(asset.state, 'uploaded');
    const remote = await client.downloadAsset(asset, deadline);
    assert.equal(digest(remote), digest(bytes), `GitHub asset ${name} differs; refuse clobber`);
    const pkg = identity.packages.find(pkg => pkg.path === name);
    if (pkg) deliveries.push({ extensionID: pkg.id, sourcePackageHash: pkg.sha256, remotePackageHash: digest(remote),
      observation: 'present', content: 'match', assetID: asset.id, verifiedAt: new Date().toISOString() });
  }
  const producer = { runID: String(context.run.id), attempt: context.run.attempt, repository: context.repository, job: 'prepare-release' };
  const github = { schemaVersion: 1, identityDigest: objectDigest(identity), releaseID: release.id,
    releaseSHA: context.releaseSHA, version: context.version, packages: deliveries, producer, completedAt: new Date().toISOString() };
  await writeJSON(path.join(output, 'github-delivery.json'), github);
  await writeJSON(path.join(output, 'prepared-receipt.json'), { schemaVersion: 1, status: 'passed', identityDigest: objectDigest(identity),
    githubDigest: objectDigest(github), producer });
  const manifestName = `release-manifest-${context.version}.json`;
  const manifests = assets.filter(asset => asset.name === manifestName);
  assert(manifests.length <= 1, 'Ambiguous release state');
  if (context.mode === 'channel-retry') {
    const previous = await readJSON(path.join(input, manifestName));
    const recovery = await readJSON(path.join(input, 'recovery-verification.json'));
    assert.equal(objectDigest(previous), recovery.releaseState?.digest, 'Prepared retry state differs from verified recovery');
    await writeJSON(path.join(output, manifestName), previous);
  } else if (manifests.length) {
    throw new Error('Existing release state requires verified channel-retry recovery; refuse a second prepare root');
  } else {
    assert(['release-tag', 'incomplete-release-recovery'].includes(context.mode),
      'Original Release has no recoverable manifest');
    const pending = { schemaVersion: 1, status: 'pending', releaseSHA: context.releaseSHA, version: context.version,
      identityDigest: objectDigest(identity), requiredTargets: [...requiredTargets], github, channels: {},
      errors: marketplaceTargets.map(target => ({ target, reason: 'Channel job has not reported its result' })),
      visualStudioBlocking: false, completedAt: null };
    const manifest = appendReleaseState(releaseManifest(context, identity, github, pending, {}, {}), { phase: 'prepare' });
    const bytes = await saveReleaseState(output, manifestName, manifest);
    await client.replaceStateAsset(release.id, manifestName, bytes, deadline);
  }
  return { identity, github };
}

function releaseManifest(context, identity, github, completion, channels, history) {
  const marketplaces = {};
  for (const target of marketplaceTargets) {
    const partial = channels[target] ?? history[target]?.partial;
    const deferred = !partial && context.deferredTargets?.includes(target);
    const entries = partial?.packages ?? identity.packages.map(pkg => ({ extensionID: pkg.id, version: pkg.version,
      sourcePackageHash: pkg.sha256, observation: 'unknown', submission: 'not-submitted', content: 'unknown',
      evidenceUse: 'fresh', reason: deferred
        ? 'Visual Studio Marketplace publishing is disabled; no query or submission was run.'
        : 'Missing or invalid channel result' }));
    marketplaces[target === 'open-vsx' ? 'openVsx' : 'visualStudio'] = Object.fromEntries(entries.map(entry => [
      entry.extensionID.endsWith('-notifier') ? 'notifier' : 'main', { ...entry,
        status: deferred ? 'deferred' : deliveryIsComplete(entry,
          context.mode === 'channel-retry' && !context.selectedTargets.includes(target))
          ? entry.evidenceUse === 'reused' ? 'reused-verified' : 'verified'
          : entry.content === 'mismatch' ? 'content-mismatch' : 'pending-verification' }]));
  }
  return { schemaVersion: 2, version: context.version, releaseRef: context.releaseSHA,
    triggerTag: context.triggerTag, finalTag: context.finalTag, identityDigest: objectDigest(identity), status: completion.status,
    artifacts: identity.packages.map(pkg => ({ extension: pkg.id.endsWith('-notifier') ? 'notifier' : 'main',
      fullId: pkg.id, path: pkg.path, sha256: pkg.sha256, version: pkg.version })),
    githubRelease: { status: 'content-verified', receipt: github }, marketplaces, releaseCompletion: completion,
    channelHistory: history, context, tags: { finalTagStatus: 'present', triggerTagStatus: 'kept' } };
}

export async function collectNewReleaseInput({ context, output, client = githubClient({ repository: context.repository }) }) {
  const { plan, acceptance, root } = await checkGitHubAcceptance({ inputSHA: context.releaseSHA,
    baseSHA: context.baseSHA, headSHA: context.releaseSHA, run: context.run,
    output: path.join(output, 'acceptance-source'), repository: context.repository });
  assert.equal(acceptance.mode, 'release-tag');
  const provenance = await collectGitHubProvenance(plan, { output: path.join(output, 'candidate-source'),
    repository: context.repository, scope: 'candidate' });
  assert.equal(provenance.artifacts.length, 1); const artifact = provenance.artifacts[0];
  const job = provenance.jobs.find(job => job.id === artifact.jobID); assert.equal(job?.conclusion, 'success');
  const candidateRoot = path.join(output, 'candidate-source', artifact.name);
  const packageFile = await findUniqueFile(candidateRoot, 'package-receipt.json');
  const packageReceipt = await readJSON(packageFile); assert.equal(objectDigest(packageReceipt), acceptance.packageReceiptDigest);
  const input = path.join(output, 'verified-input'); await fs.mkdir(input, { recursive: true });
  for (const name of ['gate-plan.json', 'gate-result.json', 'gate-provenance.json', 'acceptance-receipt.json']) {
    await fs.copyFile(await findUniqueFile(root, name), path.join(input, name));
  }
  for (const name of ['main.vsix', 'notifier.vsix', 'package-receipt.json']) {
    await fs.copyFile(path.join(path.dirname(packageFile), name), path.join(input, name));
  }
  await verifyPackageFiles(packageReceipt, plan, input); return input;
}

export async function collectIncompleteRecoveryInput({ context, output, client = githubClient({ repository: context.repository }),
  collectInput = collectNewReleaseInput }) {
  validateReleaseContext(context); assert.equal(context.mode, 'incomplete-release-recovery');
  if (context.recoveryPreviousRun
    && String(context.recoveryPreviousRun.id) !== String(context.recoveryArtifactRun.id)) {
    await collectInput({ context: { ...context, run: context.recoveryPreviousRun },
      output: path.join(output, 'previous-recovery-acceptance'), client });
  }
  return collectInput({ context: { ...context, run: context.recoveryArtifactRun },
    output: path.join(output, 'accepted-recovery-batch'), client });
}

export async function finalizeRelease({ context, prepared, output, client = githubClient({ repository: context.repository }),
  deadline = Date.now() + 1200000, collector = collectReleaseFacts,
  renderNotes = manifest => buildReleaseNotes({ version: context.version,
    changelog: 'extensions/vscode/dev-session-canvas/CHANGELOG.md', manifest }) }) {
  validateReleaseContext(context);
  const allowedNames = [`prepared-release-${context.run.id}-${context.run.attempt}`,
    ...marketplaceTargets.map(target => `marketplace-result-${target}-${context.run.id}-${context.run.attempt}`)];
  // Incomplete collection can only produce a failed completion. It still
  // preserves verified sibling results and identifies each missing producer.
  const facts = await collector(context, { client, output: path.join(output, 'actual-results'), deadline,
    allowedNames, namesForJobs: releaseArtifactJob, allowIncomplete: true });
  const preparedRoot = path.join(output, 'actual-results', allowedNames[0]);
  const actualPrepared = path.dirname(await findUniqueFile(preparedRoot, 'prepared-receipt.json'));
  const identity = await readJSON(path.join(actualPrepared, 'release-identity.json'));
  const github = await readJSON(path.join(actualPrepared, 'github-delivery.json'));
  const preparedArtifact = facts.artifacts.find(artifact => artifact.name === allowedNames[0]);
  const prepareJob = facts.jobs.find(job => job.id === preparedArtifact?.jobID);
  assert.equal(prepareJob?.name, releaseJobName('prepare-release')); assert.equal(prepareJob.conclusion, 'success');
  assert(preparedArtifact.receiptDigests.includes(objectDigest(github)));
  assert.equal(objectDigest(await readJSON(path.join(prepared, 'release-identity.json'))), objectDigest(identity));
  const partials = [];
  const deferredTargets = new Set(context.deferredTargets ?? []);
  const deferredArtifact = `marketplace-result-visual-studio-${context.run.id}-${context.run.attempt}`;
  const evidenceErrors = (facts.errors ?? []).filter(error =>
    !(deferredTargets.has('visual-studio') && error.artifact === deferredArtifact));
  for (const target of marketplaceTargets) {
    const artifactName = `marketplace-result-${target}-${context.run.id}-${context.run.attempt}`;
    if (deferredTargets.has(target)) {
      const job = facts.jobs.find(item => item.name === releaseJobName(`publish-${target}`));
      assert.equal(job?.status, 'completed', 'Deferred channel job must appear in Actions evidence');
      assert.equal(job?.conclusion, 'skipped', 'Deferred channel job must not execute');
      assert(!facts.artifacts.some(artifact => artifact.name === artifactName),
        'Deferred channel must not produce a result artifact');
      continue;
    }
    try {
      const partial = await readJSON(await findUniqueFile(path.join(output, 'actual-results',
        artifactName), 'channel-partial.json'));
      assert.equal(partial.target, target, 'Partial has the wrong target');
      assert(facts.jobs.some(job => job.name === releaseJobName(`publish-${target}`)), 'Partial has no actual producer job');
      validateChannelPartial(partial, identity, { context,
        actualJob: facts.jobs.find(job => job.name === releaseJobName(`publish-${target}`)),
        artifact: facts.artifacts.find(artifact => artifact.name === allowedNames[marketplaceTargets.indexOf(target) + 1]) });
      assert(facts.artifacts.some(artifact => artifact.name === allowedNames[marketplaceTargets.indexOf(target) + 1]),
        'Partial has no actual artifact');
      partials.push(partial);
    } catch (error) { evidenceErrors.push({ target, reason: error.message }); }
  }
  const history = await readJSON(path.join(actualPrepared, 'validated-channel-history.json'));
  const completion = calculateReleaseCompletion({ context, identity, github, partials, facts, history });
  if (evidenceErrors.length) { completion.status = 'failed'; completion.completedAt = null; completion.errors.push(...evidenceErrors); }
  for (const partial of partials) if (partial.packages.every(entry => entry.content === 'match' && entry.evidenceUse === 'fresh')) {
    history[partial.target] = { context, partial };
  }
  const parent = await readJSON(path.join(actualPrepared, `release-manifest-${context.version}.json`));
  assert.equal(parent.identityDigest, objectDigest(identity));
  let manifest = appendReleaseState(releaseManifest(context, identity, github, completion, completion.channels, history),
    { phase: 'finalize', parent });
  await writeJSON(path.join(output, 'release-completion.json'), completion);
  const manifestName = `release-manifest-${context.version}.json`;
  await client.replaceStateAsset(github.releaseID, manifestName, await saveReleaseState(output, manifestName, manifest), deadline);
  const notes = renderNotes(manifest);
  await fs.writeFile(path.join(output, 'release-notes.md'), notes, { flag: 'wx' });
  await client.updateNotes(github.releaseID, notes, deadline);
  // Keep the completion receipt separate from deletion of the temporary tag.
  if (completion.status !== 'complete') return { completion, manifest, cleanup: { status: 'not-run', reason: 'Required delivery incomplete' } };
  let cleanup;
  try { cleanup = await client.deleteTriggerTag(context, completion, deadline); }
  catch { cleanup = { status: 'failed', reason: 'Temporary tag deletion or identity recheck failed' }; }
  manifest = appendReleaseState({ ...manifest, tags: { ...manifest.tags,
    triggerTagStatus: cleanup.status === 'passed' ? 'deleted' : 'cleanup-failed' }, cleanup },
  { phase: 'cleanup', parent: manifest });
  await writeJSON(path.join(output, 'tag-cleanup.json'), cleanup);
  await client.replaceStateAsset(github.releaseID, manifestName, await saveReleaseState(output, manifestName, manifest), deadline);
  return { completion, manifest, cleanup };
}
