import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import yaml from 'js-yaml';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { localStageGraph } from '../gates/run-local.mjs';
import { buildPlan } from '../gates/resolve-plan.mjs';
const load = async name => yaml.load(await fs.readFile(`.github/workflows/${name}.yml`, 'utf8'));
const workflow = await load('publish-marketplace-release');
const jobs = workflow.jobs;
assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch'], 'Product tag pushes must not execute old publishing tools');
assert.deepEqual(Object.keys(jobs), ['resolve-release','verify-release','prepare-release','publish-open-vsx','finalize-release']);
assert.equal(workflow.concurrency['cancel-in-progress'], false);
assert.equal(workflow.concurrency.group, 'marketplace-release-${{ inputs.version }}');
assert.equal(jobs['resolve-release'].if, "${{ github.ref == 'refs/heads/main' }}");
assert(workflow.on.workflow_dispatch.inputs.version.required);
assert(workflow.on.workflow_dispatch.inputs.batch_run_id);
assert(workflow.on.workflow_dispatch.inputs.batch_attempt);
assert.equal(jobs['verify-release'].uses, './.github/workflows/release-validation.yml');
assert(!jobs['verify-release'].secrets, 'Delivery must not receive product test credentials');
assert.deepEqual(jobs['prepare-release'].needs, ['resolve-release','verify-release']);
assert.match(jobs['prepare-release'].if, /outputs.accepted == 'true'/);
assert.deepEqual(jobs['publish-open-vsx'].needs, ['resolve-release','prepare-release']);
assert.deepEqual(jobs['finalize-release'].needs, ['resolve-release','prepare-release','publish-open-vsx']);
assert(jobs['finalize-release'].if.includes('always()'));
for (const job of Object.values(jobs)) {
  if (job.uses) continue;
  assert.equal(job.steps.find(step => step.uses === 'actions/checkout@v4').with.ref, '${{ github.sha }}');
  for (const upload of job.steps.filter(step => step.uses === 'actions/upload-artifact@v4')) {
    assert(upload.with.name.includes('github.run_attempt'));
    assert.equal(upload.with['retention-days'], 90);
  }
  for (const step of job.steps.filter(step => step.run)) assert(!/package-only|package:vsix|release:verify|--skip-package|--clobber|mtime/.test(step.run));
}
assert(!JSON.stringify(workflow).includes('VSCE_PAT'));
assert(!JSON.stringify(workflow).includes('publish-visual-studio'));
const validation = await load('release-validation');
assert.deepEqual(Object.keys(validation.jobs), ['recovery'], 'Delivery must not invoke the build task graph');
assert.match(validation.jobs.recovery.if, /artifact-release/);
assert.equal(validation.jobs.recovery.steps.find(step => step.uses === 'actions/checkout@v4').with.ref, '${{ github.sha }}');
const build = await load('build-release-batch');
assert.deepEqual(Object.keys(build.on), ['workflow_dispatch']);
assert.equal(build.permissions.contents, 'read', 'Build must not write tags, Releases or channels');
assert.equal(build.jobs.resolve.if, "${{ github.ref == 'refs/heads/main' }}");
assert.equal(build.jobs.verify.uses, './.github/workflows/ci-validation.yml');
assert.equal(build.jobs.verify.with.mode, 'release-tag');
assert.equal(build.jobs.verify.with.input_sha, '${{ needs.resolve.outputs.input_sha }}');
assert.deepEqual(build.jobs.seal.needs, ['resolve','verify']);
assert.match(build.jobs.seal.if, /outputs.accepted == 'true'/);
assert.equal(build.jobs.seal.name, 'Release seal-batch');
for (const job of [build.jobs.resolve, build.jobs.seal]) {
  assert.equal(job.steps.find(step => step.uses === 'actions/checkout@v4').with.ref, '${{ github.sha }}');
}
const upload = build.jobs.seal.steps.find(step => step.with?.name?.startsWith('release-batch-'));
assert.equal(upload.with['retention-days'], 90);
assert.equal(upload.with['if-no-files-found'], 'error');
const plan = buildPlan({mode:'release-pr',inputSHA:'a'.repeat(40),baseSHA:'b'.repeat(40),version:'1.2.3',changedPaths:['package.json']});
assert.equal(localStageGraph(plan).flatMap(stage => stage.tasks).length, plan.tasks.length);
console.log('Independent build and delivery workflows, fixed tool checkout, accepted batch and VSM exclusion passed');

// Execute the actual workflow's local-ref binding against a real isolated Git
// repository. It must work with old product code and never replace a conflict.
const ci = await load('ci-validation');
const bind = ci.jobs.resolve.steps.find(step => step.name === 'Bind local product validation ref');
assert(bind); assert.match(bind.if, /workflow_dispatch/); assert.match(bind.if, /refs\/heads\/main/);
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'release-local-ref-'));
try {
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['pipe','pipe','pipe'] }).trim();
  git(['init', '-b', 'main']); git(['config', 'user.name', 'Test']); git(['config', 'user.email', 'test@example.invalid']);
  await fs.writeFile(path.join(root, 'product'), 'one'); git(['add', '.']); git(['commit', '-m', 'product']);
  const sha = git(['rev-parse', 'HEAD']); git(['update-ref', 'refs/remotes/origin/main', sha]);
  const execute = () => execFileSync('bash', ['-c', bind.run], { cwd: root,
    env: { ...process.env, PRODUCT_SHA: sha, PRODUCT_TAG: 'publish/v1.2.3' }, stdio: 'pipe' });
  execute(); execute();
  assert.equal(git(['rev-parse', 'publish/v1.2.3']), sha);
  await fs.writeFile(path.join(root, 'product'), 'two'); git(['add', '.']); git(['commit', '-m', 'other']);
  const other = git(['rev-parse', 'HEAD']); git(['update-ref', 'refs/tags/publish/v1.2.3', other]);
  assert.throws(execute); assert.equal(git(['rev-parse', 'publish/v1.2.3']), other);
  assert.equal(git(['remote']), '');
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('Actual build workflow local-ref binding and conflict refusal passed');
