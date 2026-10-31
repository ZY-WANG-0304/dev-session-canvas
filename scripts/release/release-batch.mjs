import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { assertSHA, objectDigest, readJSON, writeJSON, verifyPackageFiles } from '../gates/receipts.mjs';
import { validateRecordedAcceptance, findUniqueFile } from '../gates/check-acceptance.mjs';
import { assertFormalEnvironment } from '../gates/resolve-plan.mjs';
import { githubClient, collectReleaseFacts } from './release-github.mjs';
import { collectNewReleaseInput, immutableReleaseFiles, verifyRecoveredRelease } from './release-delivery.mjs';
import { contentPolicyDigest, requiredTargets, releaseIdentity, releaseJobName, validateReleaseContext } from './release-completion.mjs';

export const batchWorkflow = '.github/workflows/build-release-batch.yml';
export const batchFiles = [...immutableReleaseFiles, 'release-changelog.md'];
const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const batchName = run => `release-batch-${run.id}-${run.attempt}`;

export function resolveBuildInput({ productSHA, version, run, repository, root = process.cwd(), env = process.env }) {
  assertFormalEnvironment(env);
  assert.equal(env.GITHUB_EVENT_NAME, 'workflow_dispatch');
  assert.equal(env.GITHUB_REF, 'refs/heads/main', 'Build tools must be dispatched from main');
  assertSHA(productSHA); assert.equal(git(root, ['rev-parse', 'HEAD']), run.headSHA);
  assert.equal(git(root, ['rev-parse', `${productSHA}^{commit}`]), productSHA);
  execFileSync('git', ['merge-base', '--is-ancestor', productSHA, 'origin/main'], { cwd: root });
  for (const file of ['package.json', 'extensions/vscode/dev-session-canvas/package.json',
    'extensions/vscode/dev-session-canvas-notifier/package.json']) {
    assert.equal(JSON.parse(git(root, ['show', `${productSHA}:${file}`])).version, version,
      'Requested version differs from the product input');
  }
  return validateReleaseContext({ schemaVersion: 1, mode: 'release-tag', batchFormat: 1,
    releaseSHA: productSHA, baseSHA: git(root, ['rev-parse', `${productSHA}^1`]), version,
    triggerTag: `publish/v${version}`, finalTag: `v${version}`, repository, run,
    selection: 'all', selectedTargets: ['open-vsx'], deferredTargets: ['visual-studio'],
    requiredTargets: [...requiredTargets], contentPolicyDigest, existingReleaseID: null });
}

export async function sealReleaseBatch({ context, output, root = process.cwd(), collectInput = collectNewReleaseInput }) {
  validateReleaseContext(context); assert.equal(context.batchFormat, 1);
  const input = await collectInput({ context, output: path.join(output, 'source'), recordedPolicy: true });
  const batch = path.join(output, 'batch'); await fs.mkdir(batch, { recursive: true });
  for (const name of immutableReleaseFiles.filter(name => !['release-identity.json', 'original-release-context.json'].includes(name))) {
    await fs.copyFile(path.join(input, name), path.join(batch, name));
  }
  const identity = releaseIdentity({ context, acceptance: await readJSON(path.join(input, 'acceptance-receipt.json')),
    packageReceipt: await readJSON(path.join(input, 'package-receipt.json')) });
  await writeJSON(path.join(batch, 'release-identity.json'), identity);
  await writeJSON(path.join(batch, 'original-release-context.json'), context);
  // User-visible release text belongs to the product, not the current tooling checkout.
  await fs.writeFile(path.join(batch, 'release-changelog.md'),
    execFileSync('git', ['show', `${context.releaseSHA}:extensions/vscode/dev-session-canvas/CHANGELOG.md`], { cwd: root }));
  return batch;
}

export async function readReleaseBatch({ source, version, output, client = githubClient(),
  collector = collectReleaseFacts, deadline = Date.now() + 600000 }) {
  assert.match(String(source.id), /^[1-9]\d*$/u);
  assert(Number.isSafeInteger(source.attempt) && source.attempt > 0);
  const run = await client.json(`actions/runs/${source.id}/attempts/${source.attempt}`, { deadline });
  assert.equal(run.id, Number(source.id)); assert.equal(run.run_attempt, source.attempt);
  assert.equal(run.path, batchWorkflow); assert.equal(run.event, 'workflow_dispatch');
  assert.equal(run.head_branch, 'main'); assert.equal(run.repository?.full_name, client.repository);
  assert.equal(run.status, 'completed'); assert.equal(run.conclusion, 'success', 'Batch build must be fully successful');
  assertSHA(run.head_sha);
  const sourceRun = { id: String(run.id), attempt: run.run_attempt, headSHA: run.head_sha };
  if (source.headSHA) assert.equal(source.headSHA, sourceRun.headSHA);
  const name = batchName(sourceRun);
  const facts = await collector({ repository: client.repository, run: sourceRun }, {
    client, output, deadline, allowHistoricalRun: true, allowedNames: [name],
    namesForJobs: () => releaseJobName('seal-batch') });
  assert.equal(facts.artifacts.length, 1);
  const artifact = facts.artifacts[0]; const job = facts.jobs.find(item => item.id === artifact.jobID);
  assert.equal(job?.name, releaseJobName('seal-batch')); assert.equal(job.status, 'completed');
  assert.equal(job.conclusion, 'success');
  if (source.artifactID !== undefined) assert.equal(artifact.id, source.artifactID);
  if (source.archiveHash !== undefined) assert.equal(artifact.archiveHash, source.archiveHash);
  const input = path.dirname(await findUniqueFile(path.join(output, name), 'original-release-context.json'));
  assert.deepEqual((await fs.readdir(input)).sort(), [...batchFiles].sort(), 'Batch has missing or unexpected files');
  const original = validateReleaseContext(await readJSON(path.join(input, 'original-release-context.json')));
  assert.equal(original.mode, 'release-tag'); assert.equal(original.batchFormat, 1);
  assert.equal(original.repository, client.repository); assert.equal(original.version, version);
  assert.deepEqual(original.run, sourceRun);
  assert(artifact.receiptDigests.includes(objectDigest(original)), 'Batch context lacks producer evidence');
  const plan = await readJSON(path.join(input, 'gate-plan.json'));
  assert.deepEqual(plan.run, sourceRun);
  const acceptance = await readJSON(path.join(input, 'acceptance-receipt.json'));
  validateRecordedAcceptance({ plan, acceptance, result: await readJSON(path.join(input, 'gate-result.json')),
    provenance: await readJSON(path.join(input, 'gate-provenance.json')), inputSHA: original.releaseSHA,
    baseSHA: original.baseSHA, headSHA: original.releaseSHA });
  assert(artifact.receiptDigests.includes(objectDigest(acceptance)));
  const packageReceipt = await readJSON(path.join(input, 'package-receipt.json'));
  await verifyPackageFiles(packageReceipt, plan, input);
  const identity = releaseIdentity({ context: original, acceptance, packageReceipt });
  assert.deepEqual(await readJSON(path.join(input, 'release-identity.json')), identity);
  return { input, original, identity, source: { ...sourceRun, artifactID: artifact.id, archiveHash: artifact.archiveHash } };
}

export async function resolveBatchRelease({ source, version, run, output, client = githubClient(),
  readBatch = readReleaseBatch, root = process.cwd(), env = process.env, deadline = Date.now() + 600000 }) {
  assertFormalEnvironment(env);
  assert.equal(env.GITHUB_EVENT_NAME, 'workflow_dispatch');
  assert.equal(env.GITHUB_REF, 'refs/heads/main', 'Publishing must use tools dispatched from main');
  assert.equal(git(root, ['rev-parse', 'HEAD']), run.headSHA);
  const batch = await readBatch({ source, version, output, client, deadline });
  const original = batch.original;
  const finalSHA = await client.readTag(original.finalTag, deadline);
  if (finalSHA) assert.equal(finalSHA, original.releaseSHA, 'Final tag differs from accepted product');
  const lookup = await client.lookupRelease(original.finalTag, deadline);
  assert(['present', 'absent'].includes(lookup.observation));
  let hasState = false;
  if (lookup.observation === 'present') {
    assert.equal(finalSHA, original.releaseSHA);
    const release = lookup.release;
    assert.equal(release.tag_name, original.finalTag); assert.equal(release.target_commitish, original.releaseSHA);
    assert.equal(release.draft, false); assert.equal(release.prerelease, false);
    const assets = await client.pages(`releases/${release.id}/assets`, null, deadline);
    hasState = assets.some(asset => asset.name === `release-manifest-${version}.json`
      || /^state-[a-f0-9]{64}-release-manifest-/u.test(asset.name));
  }
  return validateReleaseContext({ ...original, mode: hasState ? 'channel-retry' : 'artifact-release',
    run, batchSource: batch.source, existingReleaseID: lookup.release?.id ?? null,
    selection: 'all', selectedTargets: ['open-vsx'], deferredTargets: ['visual-studio'] });
}

export async function verifyBatchRelease({ context, output, client = githubClient(), readBatch = readReleaseBatch,
  recover = verifyRecoveredRelease }) {
  await fs.mkdir(output, { recursive: true });
  const batch = await readBatch({ source: context.batchSource, version: context.version,
    output: path.join(output, 'batch-source'), client });
  assert.equal(batch.original.releaseSHA, context.releaseSHA); assert.equal(batch.original.baseSHA, context.baseSHA);
  if (context.mode === 'channel-retry') {
    await recover({ context, output, client });
    // A caller cannot substitute another accepted build of the same source/version.
    for (const name of batchFiles) assert.deepEqual(await fs.readFile(path.join(output, name)),
      await fs.readFile(path.join(batch.input, name)), `Original release differs from selected batch: ${name}`);
  } else {
    assert.equal(context.mode, 'artifact-release');
    for (const name of batchFiles) await fs.copyFile(path.join(batch.input, name), path.join(output, name));
  }
  const receipt = { schemaVersion: 1, status: 'passed', identityDigest: objectDigest(batch.identity),
    batchSource: context.batchSource, producer: { runID: context.run.id, attempt: context.run.attempt,
      repository: context.repository, job: 'verify-recovery' } };
  await writeJSON(path.join(output, 'batch-verification.json'), receipt);
  return receipt;
}

export async function runBatchCLI(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: { phase: { type: 'string' }, 'product-sha': { type: 'string' },
    version: { type: 'string' }, context: { type: 'string' }, output: { type: 'string' } } });
  assert(values.output); const output = path.resolve(values.output);
  const run = { id: process.env.GITHUB_RUN_ID, attempt: Number(process.env.GITHUB_RUN_ATTEMPT), headSHA: process.env.GITHUB_SHA };
  if (values.phase === 'resolve') {
    const context = resolveBuildInput({ productSHA: values['product-sha'], version: values.version,
      run, repository: process.env.GITHUB_REPOSITORY });
    await writeJSON(path.join(output, 'release-context.json'), context);
    await fs.appendFile(process.env.GITHUB_OUTPUT,
      `input_sha=${context.releaseSHA}\nbase_sha=${context.baseSHA}\nversion=${context.version}\ntrigger_tag=${context.triggerTag}\n`);
  } else {
    assert.equal(values.phase, 'seal');
    const context = validateReleaseContext(await readJSON(values.context));
    assert.deepEqual(context.run, run); assert.equal(context.repository, process.env.GITHUB_REPOSITORY);
    await sealReleaseBatch({ context, output });
    if (process.env.GITHUB_STEP_SUMMARY) await fs.appendFile(process.env.GITHUB_STEP_SUMMARY,
      `Accepted release batch: **${batchName(run)}**\n\nProduct: \`${context.releaseSHA}\` / ${context.version}\n\nPublish with version=${context.version}, batch_run_id=${run.id}, batch_attempt=${run.attempt}.\n`);
  }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await runBatchCLI().catch(error => { console.error(error.message); process.exitCode = 1; });
}
