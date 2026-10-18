import JSZip from 'jszip';
import { buildPlan } from '../gates/resolve-plan.mjs';
import { aggregateResults } from '../gates/verify-result.mjs';
import { newTaskReceipt, objectDigest, digest } from '../gates/receipts.mjs';
import { contentPolicyDigest, requiredTargets, marketplaceTargets, releaseIdentity } from '../release/release-completion.mjs';

export async function releaseFixture() {
  const sha = 'a'.repeat(40), hash = 'c'.repeat(64);
  const plan = buildPlan({ mode: 'release-tag', inputSHA: sha, baseSHA: 'b'.repeat(40), headSHA: sha,
    version: '1.2.3', changedPaths: ['package.json'], run: { id: '12345', attempt: 2, headSHA: sha } });
  const packageReceipt = { schemaVersion: 1, inputSHA: sha, version: plan.version, planDigest: objectDigest(plan),
    profile: 'platform', production: true, admission: { executions: null, starting: 1, pending: 2 },
    readmeRef: sha, sourceDigest: hash, lockDigest: hash, nativeSetDigest: hash, environmentDigest: plan.environmentDigest,
    buildCount: { main: 1, notifier: 1 }, npmHooksStripped: true,
    producer: { runID: plan.run.id, attempt: plan.run.attempt, repository: 'test/repo',
      job: 'package-clean', variant: 'default', jobName: 'Gate package-clean (default)' }, packages: [] };
  const packageBytes = {};
  for (const name of ['dev-session-canvas', 'dev-session-canvas-notifier']) {
    const zip = new JSZip();
    zip.file('extension/package.json', JSON.stringify({ publisher: 'devsessioncanvas', name, version: plan.version }));
    zip.file('extension/dist/extension.js', `exports.activate = () => ${JSON.stringify(name)};`);
    const payload = Object.entries(zip.files).filter(([,entry]) => !entry.dir).map(async ([name,entry]) => ({
      path: name, sha256: digest(await entry.async('nodebuffer')) }));
    const payloadDigest = objectDigest((await Promise.all(payload)).sort((a,b) => a.path.localeCompare(b.path)));
    const bytes = await zip.generateAsync({ type: 'nodebuffer' });
    const filename = name.endsWith('-notifier') ? 'notifier.vsix' : 'main.vsix'; packageBytes[filename] = bytes;
    packageReceipt.packages.push({ id: `devsessioncanvas.${name}`, version: plan.version, path: filename,
      size: bytes.length, sha256: digest(bytes), payloadDigest });
  }
  const receipts = plan.tasks.map(task => {
    const r = newTaskReceipt(plan, task, { GITHUB_REPOSITORY: 'test/repo' });
    const start = Date.now() - 100; r.status = 'passed';
    r.startedAt = new Date(start).toISOString(); r.completedAt = new Date(start + 10).toISOString(); r.deadline = start + task.timeoutMs;
    r.stages = Object.fromEntries(task.stages.map(stage => [stage, { status: 'passed', startedAt: r.startedAt, completedAt: r.completedAt }]));
    if (['packaged-host', 'installed-pair'].includes(task.job)) r.consumed.push({ kind: 'package-receipt', sha256: objectDigest(packageReceipt) });
    return r;
  });
  const jobs = [...new Set(receipts.map(r => r.producer.jobName))].map((name,i) => ({ id: i+1, name, status: 'completed', conclusion: 'success', steps: [] }));
  const artifacts = jobs.map(job => { const group = receipts.filter(r => r.producer.jobName === job.name); const r = group[0];
    return { id: job.id+100, name: `gate-${r.job}-${r.variant}-${plan.run.id}-${plan.run.attempt}`, jobID: job.id,
      expired: false, runID: plan.run.id, attempt: plan.run.attempt, headSHA: sha, archiveHash: hash, receiptDigests: group.map(objectDigest) }; });
  artifacts.push({ id: 999, name: `gate-transfer-candidate-${plan.run.id}-${plan.run.attempt}`, expired: false,
    runID: plan.run.id, attempt: plan.run.attempt, headSHA: sha, archiveHash: hash,
    jobID: jobs.find(job => job.name === 'Gate package-clean (default)').id, receiptDigests: [objectDigest(packageReceipt)] });
  const provenance = { schemaVersion: 1, repository: 'test/repo', runID: plan.run.id,
    attempt: plan.run.attempt, headSHA: sha, jobs, artifacts };
  const { result, acceptance } = aggregateResults({ plan, receipts, provenance, packageReceipt });
  const context = { schemaVersion: 1, releaseSHA: sha, version: plan.version, baseSHA: plan.baseSHA, run: plan.run,
    mode: 'release-tag', triggerTag: 'publish/v1.2.3', finalTag: 'v1.2.3', repository: 'test/repo',
    selection: 'all', selectedTargets: [...marketplaceTargets], requiredTargets: [...requiredTargets],
    contentPolicyDigest, existingReleaseID: null };
  const identity = releaseIdentity({ context, acceptance, packageReceipt });
  const observation = pkg => ({ observation: 'present', content: 'match', reason: null,
    remote: { id: pkg.id, version: pkg.version, rawHash: pkg.sha256, payloadHash: pkg.payloadDigest },
    observedAt: new Date().toISOString() });
  const delivery = pkg => { const observed = observation(pkg); return { extensionID: pkg.id, version: pkg.version,
    sourcePackageHash: pkg.sha256, contentPolicyHash: contentPolicyDigest, submission: 'not-submitted', evidenceUse: 'fresh',
    observation: 'present', content: 'match', remote: observed.remote, verifiedAt: observed.observedAt,
    observations: [observed], reusedFrom: null, reason: null }; };
  const partial = target => ({ schemaVersion: 1, releaseSHA: sha, version: plan.version, target,
    identityDigest: objectDigest(identity), contentPolicyDigest, packages: identity.packages.map(delivery),
    producer: { runID: plan.run.id, attempt: plan.run.attempt, repository: 'test/repo', job: `publish-${target}` },
    completedAt: new Date().toISOString() });
  return { plan, receipts, provenance, result, acceptance, packageReceipt, packageBytes, context, identity, observation, delivery, partial };
}
