import assert from 'node:assert/strict';
import { test } from 'node:test';
import JSZip from 'jszip';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { resolveIncompleteReleaseRecovery, collectIncompleteRecoveryInput, prepareRelease } from '../release/release-delivery.mjs';
import { immutableReleaseFiles } from '../release/release-delivery.mjs';
import { digest, readJSON, writeJSON } from '../gates/receipts.mjs';
import { releaseFixture } from './release-fixture.mjs';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsc-incomplete-release-recovery-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git('init', '-b', 'main');
  git('config', 'user.name', 'Release Recovery Test');
  git('config', 'user.email', 'release-recovery@example.invalid');
  await fs.mkdir(path.join(root, 'scripts/gates'), { recursive: true });
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ version: '1.2.3' }));
  await fs.writeFile(path.join(root, 'scripts/gates/catalog.mjs'), 'export {};\n');
  git('add', '.'); git('commit', '-m', 'release base');
  await fs.writeFile(path.join(root, 'README.md'), 'release commit\n');
  git('add', '.'); git('commit', '-m', 'release input');
  const sha = git('rev-parse', 'HEAD');
  git('update-ref', 'refs/remotes/origin/main', sha);
  git('tag', 'publish/v1.2.3', sha); git('tag', 'v1.2.3', sha);

  const sourceRun = { id: 54321, path: '.github/workflows/publish-marketplace-release.yml',
    name: 'Publish Marketplace Release', event: 'push', head_branch: 'publish/v1.2.3',
    head_sha: sha, conclusion: 'failure', run_attempt: 2, repository: { full_name: 'test/repo' } };
  const jobs = ['resolve-release', 'prepare-release', 'publish-open-vsx', 'publish-visual-studio', 'finalize-release']
    .map((name, index) => ({ id: index + 1, name: `Release ${name}`, status: 'completed',
      conclusion: ['success', 'failure', 'skipped', 'skipped', 'skipped'][index] }));
  const release = { id: 42, tag_name: 'v1.2.3', target_commitish: sha, name: 'Dev Session Canvas v1.2.3',
    draft: false, prerelease: false,
    body: `已验收的主扩展与 notifier 双包；渠道交付进行中。\n\nRelease ref: ${sha}` };
  const tags = { 'publish/v1.2.3': sha, 'v1.2.3': sha };
  const assets = [];
  const calls = [];
  const runs = new Map([[String(sourceRun.id), sourceRun]]);
  const jobsByAttempt = new Map([[`${sourceRun.id}/${sourceRun.run_attempt}`, jobs]]);
  const artifactsByRun = new Map();
  const archives = new Map();
  const client = { repository: 'test/repo',
    json: async route => {
      calls.push(`GET ${route}`);
      const match = /^actions\/runs\/(\d+)$/u.exec(route); assert(match, `Unexpected JSON request ${route}`);
      const result = runs.get(match[1]); assert(result, `Unknown run ${match[1]}`); return result;
    },
    pages: async (route, field) => {
      calls.push(`GET ${route}`);
      const jobsMatch = /^actions\/runs\/(\d+)\/attempts\/(\d+)\/jobs$/u.exec(route);
      if (jobsMatch) { assert.equal(field, 'jobs'); return jobsByAttempt.get(`${jobsMatch[1]}/${jobsMatch[2]}`) ?? []; }
      const artifactsMatch = /^actions\/runs\/(\d+)\/artifacts$/u.exec(route);
      if (artifactsMatch) { assert.equal(field, 'artifacts'); return artifactsByRun.get(artifactsMatch[1]) ?? []; }
      if (route === 'releases/42/assets') { assert.equal(field, null); return assets; }
      assert.fail(`Unexpected page request ${route}`);
    },
    bytes: async route => {
      calls.push(`GET ${route}`);
      const log = /^actions\/jobs\/(\d+)\/logs$/u.exec(route);
      if (log) return Buffer.from(`Artifact ID: ${[...artifactsByRun.values()].flat()
        .find(artifact => artifact.jobID === Number(log[1]))?.id}`);
      const archive = /^actions\/artifacts\/(\d+)\/zip$/u.exec(route);
      if (archive) return archives.get(Number(archive[1]));
      assert.fail(`Unexpected byte request ${route}`);
    },
    readTag: async name => { calls.push(`GET tag ${name}`); return tags[name] ?? null; },
    lookupRelease: async name => { calls.push(`GET release ${name}`); return { observation: 'present', release }; }
  };
  const run = { id: '65432', attempt: 1, headSHA: sha };
  return { root, sha, sourceRun, jobs, release, tags, assets, calls, client, run,
    runs, jobsByAttempt, artifactsByRun, archives };
}

test('incomplete recovery accepts only an unchanged release with prepare failure before channels', async t => {
  const f = await fixture(t);
  f.assets.push({ id: 90, name: 'main.vsix', state: 'uploaded' });
  const context = await resolveIncompleteReleaseRecovery({ triggerTag: 'publish/v1.2.3',
    recoverySourceRunID: '54321', root: f.root, client: f.client, run: f.run });
  assert.equal(context.mode, 'incomplete-release-recovery');
  assert.equal(context.releaseSHA, f.sha);
  assert.equal(context.existingReleaseID, 42);
  assert.deepEqual(context.recoverySourceRun, { id: '54321', attempt: 2, headSHA: f.sha });
  assert.equal(context.selection, 'all');
  assert(f.calls.every(call => call.startsWith('GET ')), 'Resolving recovery must be read-only');
});

test('a different recovery run resumes the accepted batch after gate-plan upload without replacing assets', async t => {
  const f = await fixture(t);
  const firstContext = await resolveIncompleteReleaseRecovery({ triggerTag: 'publish/v1.2.3',
    recoverySourceRunID: '54321', root: f.root, client: f.client, run: f.run });
  const accepted = await releaseFixture({ inputSHA: f.sha, baseSHA: 'b'.repeat(40), run: f.run });
  const input = path.join(f.root, 'accepted-input'); await fs.mkdir(input);
  for (const [name, value] of Object.entries({ 'package-receipt.json': accepted.packageReceipt,
    'gate-plan.json': accepted.plan, 'gate-result.json': accepted.result,
    'gate-provenance.json': accepted.provenance, 'acceptance-receipt.json': accepted.acceptance })) {
    await writeJSON(path.join(input, name), value);
  }
  for (const [name, bytes] of Object.entries(accepted.packageBytes)) await fs.writeFile(path.join(input, name), bytes);
  const remoteBytes = new Map();
  f.client.readTag = async name => { f.calls.push(`GET tag ${name}`); return f.tags[name] ?? null; };
  f.client.uploadAsset = async (_release, name, bytes) => {
    f.calls.push(`POST asset ${name}`);
    if (name === 'gate-result.json') throw new Error('controlled interruption after gate-plan upload');
    const asset = { id: remoteBytes.size + 100, name, state: 'uploaded' };
    remoteBytes.set(name, Buffer.from(bytes)); f.assets.push(asset); return asset;
  };
  f.client.downloadAsset = async asset => remoteBytes.get(asset.name);
  f.client.replaceStateAsset = async (_releaseID, name, bytes) => {
    const asset = { id: remoteBytes.size + 100, name, state: 'uploaded' };
    remoteBytes.set(name, Buffer.from(bytes)); f.assets.push(asset); return asset;
  };
  await assert.rejects(() => prepareRelease({ context: firstContext, input,
    output: path.join(f.root, 'first-prepare'), client: f.client }), /controlled interruption/u);
  assert.equal(f.assets.some(asset => asset.name === 'gate-plan.json'), true);
  assert.equal(f.assets.some(asset => asset.name.startsWith('release-manifest-') || asset.name.startsWith('state-')), false);
  const originalPlanBytes = Buffer.from(remoteBytes.get('gate-plan.json'));

  const previousRun = { id: Number(firstContext.run.id), path: '.github/workflows/publish-marketplace-release.yml',
    name: 'Publish Marketplace Release', event: 'workflow_dispatch', head_branch: 'main', head_sha: f.sha,
    conclusion: 'failure', run_attempt: firstContext.run.attempt, repository: { full_name: f.client.repository } };
  const previousJobs = ['resolve-release', 'prepare-release', 'publish-open-vsx', 'publish-visual-studio', 'finalize-release']
    .map((name, index) => ({ id: 10 + index, name: `Release ${name}`, status: 'completed',
      conclusion: ['success', 'failure', 'skipped', 'skipped', 'skipped'][index] }));
  f.runs.set(String(previousRun.id), previousRun);
  f.jobsByAttempt.set(`${previousRun.id}/${previousRun.run_attempt}`, previousJobs);
  const artifactName = `release-context-${previousRun.id}-${previousRun.run_attempt}`;
  const zip = new JSZip(); zip.file('release-context.json', JSON.stringify(firstContext));
  const archive = await zip.generateAsync({ type: 'nodebuffer' }); const artifactID = 800;
  f.archives.set(artifactID, archive);
  f.artifactsByRun.set(String(previousRun.id), [{ id: artifactID, name: artifactName, expired: false,
    workflow_run: { id: previousRun.id, head_sha: previousRun.head_sha }, digest: `sha256:${digest(archive)}`,
    jobID: previousJobs[0].id }]);
  const secondRun = { id: '65433', attempt: 1, headSHA: f.sha };
  previousJobs[1].conclusion = 'success';
  const beforeInvalidResume = f.calls.length;
  await assert.rejects(() => resolveIncompleteReleaseRecovery({ triggerTag: 'publish/v1.2.3',
    recoverySourceRunID: '54321', recoveryPreviousRunID: String(previousRun.id), root: f.root,
    output: path.join(f.root, 'invalid-second-resolution'), client: f.client, run: secondRun }), /must be failure/u);
  assert(f.calls.slice(beforeInvalidResume).every(call => call.startsWith('GET ')),
    'A predecessor that did not fail in prepare must be rejected before external writes');
  previousJobs[1].conclusion = 'failure';
  const mismatchedContext = structuredClone(firstContext);
  mismatchedContext.recoverySourceRun.id = '99998';
  const mismatchedZip = new JSZip(); mismatchedZip.file('release-context.json', JSON.stringify(mismatchedContext));
  const mismatchedArchive = await mismatchedZip.generateAsync({ type: 'nodebuffer' });
  f.archives.set(artifactID, mismatchedArchive);
  f.artifactsByRun.get(String(previousRun.id))[0].digest = `sha256:${digest(mismatchedArchive)}`;
  const beforeWrongSource = f.calls.length;
  await assert.rejects(() => resolveIncompleteReleaseRecovery({ triggerTag: 'publish/v1.2.3',
    recoverySourceRunID: '54321', recoveryPreviousRunID: String(previousRun.id), root: f.root,
    output: path.join(f.root, 'wrong-source-resolution'), client: f.client, run: secondRun }), /same original failed/u);
  assert(f.calls.slice(beforeWrongSource).every(call => call.startsWith('GET ')),
    'A predecessor bound to another original failure must be rejected before writes');
  f.archives.set(artifactID, archive);
  f.artifactsByRun.get(String(previousRun.id))[0].digest = `sha256:${digest(archive)}`;
  const resumed = await resolveIncompleteReleaseRecovery({ triggerTag: 'publish/v1.2.3',
    recoverySourceRunID: '54321', recoveryPreviousRunID: String(previousRun.id), root: f.root,
    output: path.join(f.root, 'second-resolution'), client: f.client, run: secondRun });
  assert.notEqual(resumed.run.id, firstContext.run.id, 'The retry must use a distinct Actions run ID');
  assert.deepEqual(resumed.recoveryPreviousRun, firstContext.run);
  assert.deepEqual(resumed.recoveryArtifactRun, firstContext.run);
  const auditedRuns = [];
  await collectIncompleteRecoveryInput({ context: { ...resumed, run: { id: '65434', attempt: 1, headSHA: f.sha },
    recoveryPreviousRun: { id: '65433', attempt: 1, headSHA: f.sha } }, output: path.join(f.root, 'audit-runs'),
  client: f.client, collectInput: async ({ context }) => { auditedRuns.push(context.run.id); return 'checked'; } });
  assert.deepEqual(auditedRuns, ['65433', firstContext.run.id],
    'Repeated continuation verifies the latest recovery acceptance and reuses the first asset-producing batch');

  f.client.uploadAsset = async (_release, name, bytes) => {
    f.calls.push(`POST asset ${name}`);
    const asset = { id: remoteBytes.size + 100, name, state: 'uploaded' };
    remoteBytes.set(name, Buffer.from(bytes)); f.assets.push(asset); return asset;
  };
  await prepareRelease({ context: resumed, input, output: path.join(f.root, 'resumed-prepare'), client: f.client });
  assert.deepEqual(remoteBytes.get('gate-plan.json'), originalPlanBytes,
    'Run-bound gate-plan bytes must remain unchanged');
  assert.deepEqual(remoteBytes.get('main.vsix'), accepted.packageBytes['main.vsix']);
  assert.deepEqual(remoteBytes.get('notifier.vsix'), accepted.packageBytes['notifier.vsix']);
  assert.equal(remoteBytes.has('release-manifest-1.2.3.json'), true);
  const persistedContext = await readJSON(path.join(f.root, 'resumed-prepare/original-release-context.json'));
  assert.deepEqual(persistedContext, firstContext,
    'The public original context must remain bound to the first recovery acceptance run');
});

for (const [name, mutate] of [
  ['wrong source workflow', f => { f.sourceRun.path = '.github/workflows/other.yml'; }],
  ['non-push source', f => { f.sourceRun.event = 'workflow_dispatch'; }],
  ['mismatched source SHA', f => { f.sourceRun.head_sha = 'd'.repeat(40); }],
  ['prepare did not fail', f => { f.jobs[1].conclusion = 'success'; }],
  ['Open VSX job ran', f => { f.jobs[2].conclusion = 'success'; }],
  ['Visual Studio job is unknown', f => { f.jobs[3].conclusion = 'failure'; }],
  ['finalize did not skip', f => { f.jobs[4].conclusion = 'failure'; }],
  ['final tag moved', f => { f.tags['v1.2.3'] = 'd'.repeat(40); }],
  ['Release notes changed', f => { f.release.body += '\nchanged'; }],
  ['Release state exists', f => { f.assets.push({ id: 91, name: 'release-manifest-1.2.3.json', state: 'uploaded' }); }],
  ['unrelated asset exists', f => { f.assets.push({ id: 92, name: 'notes.txt', state: 'uploaded' }); }],
  ['asset state is unknown', f => { f.assets.push({ id: 93, name: 'main.vsix', state: 'starter' }); }]
]) {
  test(`incomplete recovery rejects ${name} before any write`, async t => {
    const f = await fixture(t); mutate(f);
    await assert.rejects(() => resolveIncompleteReleaseRecovery({ triggerTag: 'publish/v1.2.3',
      recoverySourceRunID: '54321', root: f.root, client: f.client, run: f.run }));
    assert(f.calls.every(call => call.startsWith('GET ')), 'Resolver has no external write operation');
  });
}

test('recovery prepare fills the existing Release and refuses conflicting bytes', async t => {
  const f = await releaseFixture();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsc-incomplete-release-prepare-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const input = path.join(root, 'input'); await fs.mkdir(input);
  for (const [name, value] of Object.entries({ 'package-receipt.json': f.packageReceipt, 'gate-plan.json': f.plan,
    'gate-result.json': f.result, 'gate-provenance.json': f.provenance, 'acceptance-receipt.json': f.acceptance })) {
    await writeJSON(path.join(input, name), value);
  }
  for (const [name, bytes] of Object.entries(f.packageBytes)) await fs.writeFile(path.join(input, name), bytes);
  const context = { ...f.context, mode: 'incomplete-release-recovery', existingReleaseID: 42,
    recoverySourceRun: { id: '54321', attempt: 1, headSHA: f.context.releaseSHA },
    recoveryArtifactRun: f.context.run };
  const release = { id: 42, tag_name: context.finalTag, target_commitish: context.releaseSHA,
    name: `Dev Session Canvas v${context.version}`, draft: false, prerelease: false,
    body: `已验收的主扩展与 notifier 双包；渠道交付进行中。\n\nRelease ref: ${context.releaseSHA}` };
  const remote = new Map(), calls = [];
  const client = { repository: context.repository,
    readTag: async () => context.releaseSHA,
    lookupRelease: async () => ({ observation: 'present', release }),
    pages: async () => [...remote.values()].map(value => value.asset),
    uploadAsset: async (_release, name, bytes) => {
      calls.push(`upload:${name}`); const asset = { id: remote.size + 1, name, state: 'uploaded' };
      remote.set(name, { asset, bytes: Buffer.from(bytes) }); return asset;
    },
    downloadAsset: async asset => remote.get(asset.name).bytes,
    replaceStateAsset: async (_id, name, bytes) => {
      const asset = { id: remote.size + 1, name, state: 'uploaded' };
      remote.set(name, { asset, bytes: Buffer.from(bytes) });
    }
  };
  const prepared = await prepareRelease({ context, input, output: path.join(root, 'prepared'), client });
  assert.equal(prepared.github.releaseID, 42);
  assert.deepEqual([...remote.keys()].filter(name => immutableReleaseFiles.includes(name)).sort(),
    [...immutableReleaseFiles].sort());
  assert.equal((await readJSON(path.join(root, 'prepared/original-release-context.json'))).mode,
    'incomplete-release-recovery');

  const conflictClient = { ...client,
    pages: async () => [{ id: 999, name: 'main.vsix', state: 'uploaded' }],
    downloadAsset: async () => Buffer.from('conflicting bytes') };
  await assert.rejects(() => prepareRelease({ context, input, output: path.join(root, 'conflict'), client: conflictClient }), /differs/);
});

console.log('incomplete-release-recovery contracts passed');
