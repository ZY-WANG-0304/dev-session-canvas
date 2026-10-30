import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { resolveIncompleteReleaseRecovery, prepareRelease } from '../release/release-delivery.mjs';
import { immutableReleaseFiles } from '../release/release-delivery.mjs';
import { readJSON, writeJSON } from '../gates/receipts.mjs';
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
  const client = { repository: 'test/repo',
    json: async route => { calls.push(`GET ${route}`); assert.equal(route, 'actions/runs/54321'); return sourceRun; },
    pages: async (route, field) => {
      calls.push(`GET ${route}`);
      if (route === 'actions/runs/54321/attempts/2/jobs') { assert.equal(field, 'jobs'); return jobs; }
      if (route === 'releases/42/assets') { assert.equal(field, null); return assets; }
      assert.fail(`Unexpected page request ${route}`);
    },
    readTag: async name => { calls.push(`GET tag ${name}`); return tags[name] ?? null; },
    lookupRelease: async name => { calls.push(`GET release ${name}`); return { observation: 'present', release }; }
  };
  const run = { id: '65432', attempt: 1, headSHA: sha };
  return { root, sha, sourceRun, jobs, release, tags, assets, calls, client, run };
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
    recoverySourceRun: { id: '54321', attempt: 1, headSHA: f.context.releaseSHA } };
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
