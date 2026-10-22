import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { dependencyInstallArgs, dependencyProfileForTasks, pluginWorkspaces } from '../gates/dependency-install.mjs';
import { taskCatalog } from '../gates/catalog.mjs';
import { planJobs } from '../gates/resolve-plan.mjs';
import { collectEvidence, verifyEvidenceManifest } from '../gates/evidence.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const json = async file => JSON.parse(await fs.readFile(path.join(root, file), 'utf8'));

test('service dependency ownership permits an independent plugin install without omitting platform packages', async () => {
  const manifest = await json('package.json');
  const lock = await json('package-lock.json');
  const marketplace = await json('apps/template-marketplace/package.json');
  for (const name of ['wrangler', '@cloudflare/workers-types']) {
    assert(!manifest.devDependencies[name]);
    assert(!lock.packages[''].devDependencies[name]);
    assert.equal(lock.packages['apps/template-marketplace'].devDependencies[name], marketplace.devDependencies[name]);
    assert(marketplace.devDependencies[name]);
  }
  for (const workspace of pluginWorkspaces) assert(manifest.workspaces.includes(workspace));
  for (const profile of ['plugin', 'marketplace']) {
    const args = dependencyInstallArgs(profile);
    assert(args.includes('--include-workspace-root'));
    assert(!args.some(arg => /omit|ignore-scripts|no-optional/.test(arg)));
    assert.equal(args.includes('--workspace=apps/template-marketplace'), profile === 'marketplace');
  }
  assert.throws(() => dependencyInstallArgs(undefined));
  assert.throws(() => dependencyInstallArgs('plugins'));
});

test('every formal job uses the dependency scope required by the retained release tasks', async () => {
  const tasks = taskCatalog({ release: true });
  const matrices = planJobs({ tasks: tasks.map(task => ({ ...task, timeoutMs: 1000 })) });
  const workflow = yaml.load(await fs.readFile(path.join(root, '.github/workflows/ci-validation.yml'), 'utf8'));
  for (const job of new Set(tasks.map(task => task.job))) {
    const selected = tasks.filter(task => task.job === job);
    const install = workflow.jobs[job].steps.find(step => step.name === 'Install locked dependencies');
    assert(install.run.includes('--profile ${{ matrix.dependencyProfile }} '), `${job} ignores its task dependency scope`);
    for (const variant of new Set(selected.map(task => task.variant))) {
      const shard = selected.filter(task => task.variant === variant);
      const expected = shard.some(task => ['typecheck:marketplace', 'test:marketplace-api', 'test:marketplace-web'].includes(task.id))
        ? 'marketplace' : 'plugin';
      assert.equal(matrices[job].include.find(item => item.variant === variant).dependencyProfile, expected);
      assert.equal(dependencyProfileForTasks(shard), expected);
    }
  }
  assert.equal(dependencyProfileForTasks(tasks), 'marketplace');
  assert.equal(dependencyProfileForTasks(tasks.filter(task => task.job === 'source-host')), 'plugin');
  for (const name of ['publish-marketplace-release.yml', 'release-preflight.yml', 'release-validation.yml']) {
    const workflow = yaml.load(await fs.readFile(path.join(root, '.github/workflows', name), 'utf8'));
    for (const job of Object.values(workflow.jobs)) for (const step of job.steps ?? []) {
      if (/npm ci/.test(step.run ?? '')) assert.match(step.run, /--profile plugin /);
    }
  }
});

test('failed scoped npm install retains its debug log and failure through evidence collection', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsc-install-contract-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const driver = path.join(dir, 'npm-cli.js');
  await fs.writeFile(driver, `const fs = require('node:fs'); const path = require('node:path');
    fs.mkdirSync(process.env.npm_config_logs_dir, {recursive:true});
    fs.writeFileSync(path.join(process.env.npm_config_logs_dir,'request-debug.log'), 'ECONNRESET fixture request');
    fs.writeFileSync(${JSON.stringify(path.join(dir, 'actual-args.json'))}, JSON.stringify(process.argv.slice(2)));
    process.exitCode = 1;`);
  const output = path.join(dir, 'results');
  const run = spawnSync(process.execPath, ['scripts/gates/run-infrastructure.mjs', '--kind', 'install',
    '--profile', 'plugin', '--output', output, '--', 'npm', 'ci', '--no-audit', '--no-fund'], {
    cwd: root, env: { ...process.env, npm_execpath: driver }, encoding: 'utf8', timeout: 30000
  });
  assert.equal(run.status, 1, run.stderr);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir, 'actual-args.json'))), dependencyInstallArgs('plugin'));
  const receipt = JSON.parse(await fs.readFile(path.join(output, 'infrastructure/install.json')));
  assert.equal(receipt.status, 'failed'); assert.equal(receipt.profile, 'plugin');
  assert.equal(receipt.timedOut, false); assert.equal(receipt.cleanup.status, 'passed');
  const evidence = path.join(dir, 'evidence');
  await collectEvidence({ roots: [{ directory: path.join(output, 'infrastructure'), prefix: 'infrastructure' }],
    output: evidence, identity: { inputSHA: 'a'.repeat(40) } });
  await verifyEvidenceManifest(evidence);
  assert.equal(await fs.readFile(path.join(evidence, 'infrastructure/npm-debug/request-debug.log'), 'utf8'),
    'ECONNRESET fixture request');
});
