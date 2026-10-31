import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import JSZip from 'jszip';
import { releaseFixture } from './release-fixture.mjs';
import { readJSON, writeJSON, objectDigest, digest } from '../gates/receipts.mjs';
import { validateAcceptance } from '../gates/check-acceptance.mjs';
import { batchFiles, batchWorkflow, readReleaseBatch, resolveBuildInput, resolveBatchRelease,
  sealReleaseBatch, verifyBatchRelease } from '../release/release-batch.mjs';
import { prepareRelease, finalizeRelease, verifyRecoveredRelease } from '../release/release-delivery.mjs';
import { collectGitHubProvenance } from '../gates/github-provenance.mjs';
import { buildReleaseNotes } from '../release/write-github-release-notes.mjs';

const sharedFixture = releaseFixture();
async function fixture(t, { buildToolSHA } = {}) {
  const shared = buildToolSHA ? await releaseFixture({ run: { id: '12345', attempt: 2, headSHA: buildToolSHA } })
    : await sharedFixture;
  const f = { ...shared, context: structuredClone(shared.context) };
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsc-release-batch-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  f.context = { ...f.context, batchFormat: 1, selectedTargets: ['open-vsx'], deferredTargets: ['visual-studio'] };
  const input = path.join(root, 'batch'); await fs.mkdir(input);
  for (const [name, value] of Object.entries({ 'gate-plan.json': f.plan, 'gate-result.json': f.result,
    'gate-provenance.json': f.provenance, 'acceptance-receipt.json': f.acceptance,
    'package-receipt.json': f.packageReceipt, 'original-release-context.json': f.context,
    'release-identity.json': f.identity })) await writeJSON(path.join(input, name), value);
  for (const [name, bytes] of Object.entries(f.packageBytes)) await fs.writeFile(path.join(input, name), bytes);
  await fs.writeFile(path.join(input, 'release-changelog.md'), '## 1.2.3 - Original product\n\nOriginal product highlights.\n');
  const run = { id: Number(f.context.run.id), run_attempt: f.context.run.attempt, head_sha: f.context.run.headSHA,
    head_branch: 'main', event: 'workflow_dispatch', path: batchWorkflow, status: 'completed', conclusion: 'success',
    repository: { full_name: f.context.repository } };
  const artifact = { id: 42, name: `release-batch-${run.id}-${run.run_attempt}`, expired: false,
    workflow_run: { id: run.id, head_sha: run.head_sha } };
  const jobs = [{ id: 91, name: 'Release seal-batch', status: 'completed', conclusion: 'success' }];
  let bytes;
  const archive = async () => {
    const zip = new JSZip(); for (const name of batchFiles) zip.file(name, await fs.readFile(path.join(input, name)));
    bytes = await zip.generateAsync({ type: 'nodebuffer' }); artifact.digest = `sha256:${digest(bytes)}`;
  };
  await archive();
  const client = { repository: f.context.repository,
    json: async route => { assert(route.startsWith(`actions/runs/${run.id}`)); return run; },
    pages: async (_route, field) => field === 'jobs' ? jobs : [artifact],
    bytes: async route => route.endsWith('/logs') ? Buffer.from(`Artifact ID: ${artifact.id}`) : bytes };
  const source = { id: String(run.id), attempt: run.run_attempt };
  return { f, root, input, run, artifact, jobs, archive, client, source };
}
const readBatch = (f, suffix = 'read') => readReleaseBatch({ source: f.source, version: '1.2.3',
  output: path.join(f.root, suffix), client: f.client });

test('a sealed batch is bound to the actual build attempt, successful producer and artifact bytes', async t => {
  const f = await fixture(t); const batch = await readBatch(f);
  assert.equal(batch.source.artifactID, f.artifact.id);
  assert.equal(batch.source.archiveHash, f.artifact.digest.slice(7));
  assert.deepEqual(batch.identity, f.f.identity);
  for (const name of batchFiles) assert.deepEqual(await fs.readFile(path.join(batch.input, name)), await fs.readFile(path.join(f.input, name)));
});

for (const failure of ['failed-run', 'pr-run', 'wrong-workflow', 'other-repo', 'failed-seal', 'wrong-producer',
  'expired', 'archive-digest', 'wrong-version', 'wrong-attempt', 'wrong-package', 'wrong-input', 'pr-acceptance']) {
  test(`batch verification refuses ${failure}`, async t => {
    const f = await fixture(t);
    if (failure === 'failed-run') f.run.conclusion = 'failure';
    if (failure === 'pr-run') f.run.event = 'pull_request';
    if (failure === 'wrong-workflow') f.run.path = '.github/workflows/release-preflight.yml';
    if (failure === 'other-repo') f.run.repository.full_name = 'another/repo';
    if (failure === 'failed-seal') f.jobs[0].conclusion = 'failure';
    if (failure === 'wrong-producer') f.jobs[0].name = 'Unrelated';
    if (failure === 'expired') f.artifact.expired = true;
    if (failure === 'archive-digest') f.artifact.digest = `sha256:${'0'.repeat(64)}`;
    if (failure === 'wrong-attempt') f.source.attempt++;
    if (failure === 'wrong-version') {
      f.f.context.version = '1.2.4';
      await writeJSON(path.join(f.input, 'original-release-context.json'), f.f.context); await f.archive();
    }
    if (failure === 'wrong-package') { await fs.writeFile(path.join(f.input, 'main.vsix'), 'replacement'); await f.archive(); }
    if (failure === 'wrong-input' || failure === 'pr-acceptance') {
      const acceptance = await readJSON(path.join(f.input, 'acceptance-receipt.json'));
      if (failure === 'wrong-input') acceptance.inputSHA = 'f'.repeat(40); else acceptance.mode = 'release-pr';
      await writeJSON(path.join(f.input, 'acceptance-receipt.json'), acceptance); await f.archive();
    }
    await assert.rejects(() => readBatch(f));
  });
}

test('delivery accepts a producer-proven historical catalogue without substituting the current catalogue', async t => {
  const f = await fixture(t);
  // Simulate an older, independently accepted policy, with all its hashes bound
  // by the real archive/provenance path. Current-policy verification must fail.
  const plan = { ...f.f.plan, policyDigest: '9'.repeat(64) };
  const receipt = { ...f.f.packageReceipt, planDigest: objectDigest(plan) };
  const acceptance = { ...f.f.acceptance, planDigest: objectDigest(plan), policyDigest: plan.policyDigest,
    packageReceiptDigest: objectDigest(receipt) };
  const result = { ...f.f.result, planDigest: objectDigest(plan) };
  const identity = { ...f.f.identity, acceptanceDigest: objectDigest(acceptance), packageReceiptDigest: objectDigest(receipt) };
  for (const [name, value] of Object.entries({ 'gate-plan.json': plan, 'package-receipt.json': receipt,
    'acceptance-receipt.json': acceptance, 'gate-result.json': result, 'release-identity.json': identity }))
    await writeJSON(path.join(f.input, name), value);
  await f.archive();
  assert.throws(() => validateAcceptance({ plan, acceptance, result, provenance: f.f.provenance }));
  assert.deepEqual((await readBatch(f)).identity, identity);
});

async function delivery(t) {
  const f = await fixture(t); const batch = await readBatch(f);
  const context = { ...f.f.context, mode: 'artifact-release', existingReleaseID: null, batchSource: batch.source,
    run: { id: '99999', attempt: 1, headSHA: 'd'.repeat(40) } };
  const input = path.join(f.root, 'verified');
  await verifyBatchRelease({ context, output: input, readBatch: async () => batch, client: f.client });
  const assets = new Map(), calls = [], tags = new Map(); let release;
  const client = { repository: f.client.repository,
    readTag: async tag => tags.get(tag) ?? null,
    createTag: async (tag, sha) => { calls.push('tag'); tags.set(tag, sha); },
    lookupRelease: async () => ({ observation: release ? 'present' : 'absent', release }),
    createRelease: async (tag, sha, name, body) => { calls.push('release');
      release = { id: 21, tag_name: tag, target_commitish: sha, name, body, draft: false, prerelease: false }; },
    pages: async () => [...assets.values()].map(item => item.asset),
    uploadAsset: async (_release, name, bytes) => { calls.push(`upload:${name}`);
      const asset = { id: assets.size + 100, name, state: 'uploaded' }; assets.set(name, { asset, bytes }); return asset; },
    downloadAsset: async asset => assets.get(asset.name).bytes,
    replaceStateAsset: async (_id, name, bytes) => { calls.push('state'); assets.set(name,
      { asset: { id: 90, name, state: 'uploaded' }, bytes }); } };
  return { ...f, batch, context, input, client, assets, calls, tags };
}

test('first publication uses the accepted product and original text while tools run at another SHA', async t => {
  const f = await delivery(t);
  await prepareRelease({ context: f.context, input: f.input, output: path.join(f.root, 'prepared'), client: f.client });
  assert.notEqual(f.context.run.headSHA, f.context.releaseSHA);
  assert.equal(f.tags.get('v1.2.3'), f.context.releaseSHA);
  for (const name of batchFiles) assert.deepEqual(f.assets.get(name).bytes, await fs.readFile(path.join(f.batch.input, name)));
  const notes = buildReleaseNotes({ version: '1.2.3', changelog: path.join(f.root, 'prepared/release-changelog.md'),
    manifest: { context: f.context, releaseRef: f.context.releaseSHA } });
  assert.match(notes, /Original product highlights/);
  assert.match(notes, new RegExp(f.context.run.headSHA));
});

for (const interruption of ['main.vsix', 'gate-plan.json', 'original-release-context.json', 'release-changelog.md']) {
  test(`new tool run resumes the identical batch after upload interruption at ${interruption}`, async t => {
    const f = await delivery(t); const upload = f.client.uploadAsset;
    f.client.uploadAsset = async (release, name, bytes) => {
      if (name === interruption) throw new Error('transport interrupted'); return upload(release, name, bytes);
    };
    await assert.rejects(() => prepareRelease({ context: f.context, input: f.input,
      output: path.join(f.root, 'attempt-one'), client: f.client }), /transport interrupted/);
    const originalBytes = new Map([...f.assets].map(([name, item]) => [name, Buffer.from(item.bytes)]));
    const nextContext = { ...f.context, existingReleaseID: 21, run: { id: '100000', attempt: 1, headSHA: 'e'.repeat(40) } };
    const input = path.join(f.root, 'retry-input');
    await verifyBatchRelease({ context: nextContext, output: input, readBatch: async () => f.batch, client: f.client });
    f.client.uploadAsset = upload;
    await prepareRelease({ context: nextContext, input, output: path.join(f.root, 'attempt-two'), client: f.client });
    for (const [name, bytes] of originalBytes) assert.deepEqual(f.assets.get(name).bytes, bytes);
    for (const name of batchFiles) assert.deepEqual(f.assets.get(name).bytes, await fs.readFile(path.join(f.batch.input, name)));
    assert.equal(f.tags.get('v1.2.3'), f.context.releaseSHA);
    assert.equal(f.calls.filter(call => call === 'tag').length, 1);
    assert.equal(f.calls.filter(call => call === 'release').length, 1);
  });
}

test('a conflicting existing late asset is rejected before uploading any earlier missing asset', async t => {
  const f = await delivery(t);
  await f.client.createTag('v1.2.3', f.context.releaseSHA);
  await f.client.createRelease('v1.2.3', f.context.releaseSHA, 'Dev Session Canvas v1.2.3',
    `已验收的主扩展与 notifier 双包；渠道交付进行中。\n\nRelease ref: ${f.context.releaseSHA}`);
  f.assets.set('release-changelog.md', { asset: { id: 50, name: 'release-changelog.md', state: 'uploaded' }, bytes: Buffer.from('other batch') });
  f.calls.length = 0;
  await assert.rejects(() => prepareRelease({ context: { ...f.context, existingReleaseID: 21 }, input: f.input,
    output: path.join(f.root, 'conflict'), client: f.client }), /differs; refuse clobber/);
  assert.deepEqual(f.calls, []);
});

test('main tooling can select an older product commit and seal its original changelog', async t => {
  const f = await fixture(t); const root = path.join(f.root, 'repo'); await fs.mkdir(root);
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['pipe','pipe','pipe'] }).trim();
  git(['init', '-b', 'main']); git(['config', 'user.name', 'Test']); git(['config', 'user.email', 'test@example.invalid']);
  await fs.writeFile(path.join(root, 'base'), 'base'); git(['add', '.']); git(['commit', '-m', 'base']);
  for (const file of ['package.json', 'extensions/vscode/dev-session-canvas/package.json', 'extensions/vscode/dev-session-canvas-notifier/package.json'])
    await writeJSON(path.join(root, file), { version: '1.2.3' });
  await fs.writeFile(path.join(root, 'extensions/vscode/dev-session-canvas/CHANGELOG.md'), '## 1.2.3\nOriginal text\n');
  git(['add', '.']); git(['commit', '-m', 'product']); const productSHA = git(['rev-parse', 'HEAD']);
  await writeJSON(path.join(root, 'package.json'), { version: '9.9.9' });
  await fs.writeFile(path.join(root, 'extensions/vscode/dev-session-canvas/CHANGELOG.md'), '## 9.9.9\nNew product\n');
  git(['add', '.']); git(['commit', '-m', 'tools']); const headSHA = git(['rev-parse', 'HEAD']);
  git(['update-ref', 'refs/remotes/origin/main', headSHA]);
  const context = resolveBuildInput({ productSHA, version: '1.2.3', run: { ...f.f.context.run, headSHA },
    repository: f.client.repository, root, env: { GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main' } });
  assert.equal(context.releaseSHA, productSHA); assert.equal(context.run.headSHA, headSHA);
  assert.throws(() => resolveBuildInput({ productSHA, version: '9.9.9', run: context.run, repository: context.repository, root,
    env: { GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main' } }), /Requested version/);
  const product = await releaseFixture({ inputSHA: productSHA, baseSHA: context.baseSHA });
  // Controlled accepted input for the seal's provenance dependency; real Git text selection remains exercised.
  for (const [name, value] of Object.entries({ 'package-receipt.json': product.packageReceipt,
    'acceptance-receipt.json': product.acceptance })) await writeJSON(path.join(f.input, name), value);
  const sealed = await sealReleaseBatch({ context, root, output: path.join(f.root, 'sealed'), collectInput: async () => f.input });
  assert.equal(await fs.readFile(path.join(sealed, 'release-changelog.md'), 'utf8'), '## 1.2.3\nOriginal text\n');
  const batch = { input: f.input, original: context, source: { ...product.context.run, artifactID: 42, archiveHash: 'a'.repeat(64) } };
  const resolved = await resolveBatchRelease({ source: f.source, version: '1.2.3', run: context.run, root,
    env: { GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main' }, output: path.join(f.root, 'resolve'),
    readBatch: async () => batch, client: { repository: context.repository, readTag: async () => null,
      lookupRelease: async () => ({ observation: 'absent', release: null }) } });
  assert.equal(resolved.mode, 'artifact-release'); assert.equal(resolved.releaseSHA, productSHA);
});


test('a published batch survives full producer/state verification and another delivery run', async t => {
  const f = await delivery(t);
  const runs = new Map(), artifacts = new Map(), logs = new Map(), archives = new Map();
  const add = async (run, stem, jobName, files) => {
    if (!runs.has(run.id)) runs.set(run.id, { run, jobs: [] });
    const record = runs.get(run.id), id = archives.size + 1000, jobID = id + 1000;
    record.jobs.push({ id: jobID, name: jobName, status: 'completed', conclusion: 'success', steps: [] });
    const zip = new JSZip(); for (const [name, bytes] of Object.entries(files)) zip.file(name, bytes);
    const bytes = await zip.generateAsync({ type: 'nodebuffer' }); archives.set(id, bytes);
    const artifact = { id, name: `${stem}-${run.id}-${run.attempt}`, expired: false,
      workflow_run: { id: Number(run.id), head_sha: run.headSHA }, digest: `sha256:${digest(bytes)}` };
    artifacts.set(id, artifact); logs.set(jobID, `Artifact ID: ${id}`);
  };
  const readFiles = async (directory, names) => Object.fromEntries(await Promise.all(names.map(async name =>
    [name, await fs.readFile(path.join(directory, name))])));
  const originalRun = f.f.context.run;
  await add(originalRun, 'gate-acceptance', 'Gate verify-result (default)', await readFiles(f.batch.input,
    ['gate-plan.json','gate-result.json','gate-provenance.json','acceptance-receipt.json']));
  await add(originalRun, 'gate-transfer-candidate', 'Gate package-clean (default)', await readFiles(f.batch.input,
    ['main.vsix','notifier.vsix','package-receipt.json']));
  f.client.json = async route => {
    const id = route.split('/')[2], { run } = runs.get(id);
    return { id: Number(id), run_attempt: run.attempt, head_sha: run.headSHA };
  };
  const originalPages = f.client.pages;
  f.client.pages = async (route, field) => {
    if (route.startsWith('releases/')) return originalPages(route, field);
    const id = route.split('/')[2];
    if (field === 'jobs') return runs.get(id).jobs;
    return [...artifacts.values()].filter(artifact => artifact.workflow_run.id === Number(id));
  };
  f.client.bytes = async route => route.endsWith('/logs') ? Buffer.from(logs.get(Number(route.split('/')[2])))
    : archives.get(Number(route.split('/')[2]));
  f.client.updateNotes = async () => {};
  f.client.deleteTriggerTag = async () => ({ status: 'passed', trigger: 'already-absent' });
  f.client.replaceStateAsset = async (_id, name, bytes) => {
    for (const key of [name, `state-${digest(bytes)}-${name}`]) f.assets.set(key,
      { asset: { id: f.assets.size + 5000, name: key, state: 'uploaded' }, bytes });
  };
  const prepared = path.join(f.root, 'published');
  await prepareRelease({ context: f.context, input: f.input, output: prepared, client: f.client });
  await add(f.context.run, 'prepared-release', 'Release prepare-release', await readFiles(prepared, await fs.readdir(prepared)));
  const stateFiles = (await fs.readdir(prepared)).filter(name => name.startsWith('state-') || name.startsWith('release-manifest-'));
  await add(f.context.run, 'release-prepare-evidence', 'Release prepare-release', await readFiles(prepared, stateFiles));
  // Both artifacts come from the same actual prepare job.
  const records = runs.get(f.context.run.id).jobs;
  const duplicate = records.pop(); const prepareJob = records[0];
  logs.set(prepareJob.id, logs.get(prepareJob.id) + '\n' + logs.get(duplicate.id));
  const partial = f.f.partial('open-vsx');
  partial.producer = { ...partial.producer, runID: f.context.run.id, attempt: f.context.run.attempt };
  await add(f.context.run, 'marketplace-result-open-vsx', 'Release publish-open-vsx', {
    'channel-partial.json': JSON.stringify(partial) });
  const finalOutput = path.join(f.root, 'finalized');
  const final = await finalizeRelease({ context: f.context, prepared, output: finalOutput, client: f.client });
  assert.equal(final.completion.status, 'complete');
  await add(f.context.run, 'marketplace-release', 'Release finalize-release', await readFiles(finalOutput,
    (await fs.readdir(finalOutput)).filter(name => name.startsWith('state-') || name.startsWith('release-manifest-'))));
  const next = { ...f.context, mode: 'channel-retry', existingReleaseID: 21,
    run: { id: '100001', attempt: 1, headSHA: 'e'.repeat(40) } };
  const collector = (plan, options) => collectGitHubProvenance(plan, { ...options,
    api: async route => {
      const relative = route.replace(`repos/${f.context.repository}/`, '');
      if (relative.includes('/jobs?')) return { jobs: await f.client.pages(relative, 'jobs') };
      if (relative.includes('/artifacts?')) return { artifacts: await f.client.pages(relative, 'artifacts') };
      return f.client.json(relative);
    }, log: async id => logs.get(id), download: async id => archives.get(id) });
  const verified = path.join(f.root, 'verified-retry');
  await verifyBatchRelease({ context: next, output: verified, client: f.client, readBatch: async () => f.batch,
    recover: options => verifyRecoveredRelease({ ...options, collector }) });
  await prepareRelease({ context: next, input: verified, output: path.join(f.root, 'retry-prepared'), client: f.client });
  for (const name of batchFiles) assert.deepEqual(f.assets.get(name).bytes, await fs.readFile(path.join(f.batch.input, name)));
});


test('batch producer workflow SHA may differ from the product SHA without changing package identity', async t => {
  const f = await fixture(t, { buildToolSHA: 'f'.repeat(40) });
  const batch = await readBatch(f);
  assert.notEqual(batch.source.headSHA, batch.original.releaseSHA);
  assert.equal(batch.original.releaseSHA, 'a'.repeat(40));
  assert.equal(batch.source.headSHA, 'f'.repeat(40));
  assert.equal(batch.identity.releaseSHA, 'a'.repeat(40));
});
