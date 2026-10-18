import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import yaml from 'js-yaml';
import { localStageGraph } from '../gates/run-local.mjs';
import { buildPlan } from '../gates/resolve-plan.mjs';

const workflow=yaml.load(await fs.readFile('.github/workflows/publish-marketplace-release.yml','utf8'));
const jobs=workflow.jobs;
assert.deepEqual(Object.keys(jobs),['resolve-release','verify-release','prepare-release','publish-open-vsx','publish-visual-studio','finalize-release']);
assert.equal(workflow.concurrency['cancel-in-progress'],false,'An in-flight release cannot be automatically cancelled');
assert.equal(jobs['verify-release'].uses,'./.github/workflows/release-validation.yml');
assert.deepEqual(jobs['prepare-release'].needs,['resolve-release','verify-release']);
assert.match(jobs['prepare-release'].if,/outputs.accepted == 'true'/);
for(const name of ['publish-open-vsx','publish-visual-studio'])assert.deepEqual(jobs[name].needs,['resolve-release','prepare-release']);
assert(jobs['finalize-release'].if.includes('always()'));assert(jobs['finalize-release'].if.includes("needs.prepare-release.result == 'success'"));
for(const [name,job]of Object.entries(jobs)){
  if(job.uses)continue;
  const checkout=job.steps.find(step=>step.uses==='actions/checkout@v4');
  if(name!=='resolve-release')assert.equal(checkout.with.ref,'${{ needs.resolve-release.outputs.input_sha }}');
  assert.equal(job.steps.find(step=>step.uses==='actions/setup-node@v4').with['node-version'],'22.23.3');
  const uploads=job.steps.filter(step=>step.uses==='actions/upload-artifact@v4');assert(uploads.length);
  for(const upload of uploads)assert(upload.with.name.includes('github.run_attempt'),'Do not mix previous failed-run attempt artifacts');
  for(const step of job.steps.filter(step=>step.run))assert(!/package-only|package:vsix|release:verify|--skip-package|--clobber|mtime/.test(step.run),
    'Release consumers cannot rebuild, guess or clobber original packages');
}
assert(jobs['publish-open-vsx'].steps.some(step=>step.name==='Fail incomplete required channel'));
assert(jobs['publish-visual-studio'].steps.some(step=>step.name==='Report deferred optional channel'));
const validation=yaml.load(await fs.readFile('.github/workflows/release-validation.yml','utf8'));
assert.equal(validation.jobs.full.uses,'./.github/workflows/ci-validation.yml');
assert.equal(validation.jobs.full.with.mode,'release-tag');
assert.equal(validation.jobs.recovery.if,"${{ inputs.mode == 'channel-retry' }}");
assert(!validation.jobs.recovery.steps.some(step=>/build|package-only/.test(step.run??'')),'Recovery cannot repackage');
const plan=buildPlan({mode:'release-pr',inputSHA:'a'.repeat(40),baseSHA:'b'.repeat(40),version:'1.2.3',changedPaths:['package.json']});
assert.equal(localStageGraph(plan).flatMap(stage=>stage.tasks).length,plan.tasks.length,'Local entry must use the complete CI catalogue');
console.log('Publish six-job DAG, immutable checkout, accepted-package consumers, independent channels and local graph passed');
