import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import yaml from 'js-yaml';
import {taskCatalog,regressionScripts,nativeTargets,installedTargets} from '../gates/catalog.mjs';
import {buildPlan,planJobs} from '../gates/resolve-plan.mjs';
const outer=yaml.load(await readFile('.github/workflows/release-preflight.yml','utf8'));
const reusable=yaml.load(await readFile('.github/workflows/ci-validation.yml','utf8'));
assert(outer.on.pull_request&&outer.on.push.branches.includes('main'));
assert(!outer.on.pull_request.paths,'No ordinary PR can omit foundation validation');
assert.equal(outer.jobs.validation.uses,'./.github/workflows/ci-validation.yml');
assert.equal(outer.jobs.validation.with.mode,'pr');
assert.equal(outer.jobs['verify-release-contract'].name,'Verify release contract');
assert.match(outer.jobs['verify-release-contract'].if,/always\(\)/);
assert.deepEqual(outer.jobs['verify-release-contract'].needs,['resolve-input','validation']);
const acceptanceStep=outer.jobs['verify-release-contract'].steps.find(step=>step.run?.includes('check-acceptance.mjs'));
assert(acceptanceStep);assert.match(acceptanceStep.run,/test "\$RESOLVE_RESULT" = success/);
assert(!acceptanceStep.run.includes('VALIDATION_RESULT'),'Calibration uses independently verified acceptance');
assert(!reusable.jobs.resolve.env?.GITHUB_REF_NAME,'Reserved GitHub identity must not be overridden');
const tasks=taskCatalog({functional:true,artifact:true,release:true});
for(const name of new Set(tasks.map(task=>task.job)))assert(reusable.jobs[name],`No executable workflow stage for ${name}`);
assert.equal(Object.keys(reusable.jobs).length,15);
assert.equal(reusable.permissions.actions,'read');
for(const [name,job]of Object.entries(reusable.jobs)) {
  const setup=job.steps.find(step=>step.uses==='actions/setup-node@v4');assert(setup);
  assert.equal(setup.with['node-version'],name==='native-assets'?'25.6.0':'22.23.3');
  assert(job.steps.some(step=>step.uses==='actions/upload-artifact@v4'),'All jobs preserve evidence');
  if(!['resolve','verify-result'].includes(name)) {
    assert(job.steps.some(step=>step.name==='Collect bounded stage evidence'&&step.if==='${{ always() }}'));
    const upload=job.steps.find(step=>step.name==='Preserve stage evidence');
    assert.equal(upload?.if,'${{ always() }}');
    assert.equal(upload.with.path,`gate-artifacts/${name}/${'${{ matrix.variant }}'}`);
  }
}
const native=reusable.jobs['native-assets'];
assert.equal(native.strategy['fail-fast'],false);
const steps=native.steps.map(step=>step.name);
assert(steps.indexOf('Upload load input before operations')<steps.indexOf('Operate original native provider'));
assert(!native['continue-on-error']);
for(const name of ['source-build','package-clean']) {
  const job=reusable.jobs[name];assert.match(job.if,/always\(\)/);assert.match(job.if,/needs.native-assets.result == 'failure'/);
  assert(job.steps.some(step=>step.name==='Require all six accepted load inputs'));
}
const aggregate=reusable.jobs['verify-result'];assert.equal(aggregate.if,'${{ always() }}');
assert(aggregate.steps.some(step=>step.run?.includes('github-provenance.mjs')));
assert(aggregate.steps.some(step=>step.run?.includes('verify-result.mjs')));
const release=buildPlan({mode:'release-pr',inputSHA:'a'.repeat(40),baseSHA:'b'.repeat(40),version:'0.26.1',changedPaths:[]});
assert.equal(planJobs(release)['native-assets'].include.length,6);assert.equal(planJobs(release)['installed-pair'].include.length,3);
assert.equal(planJobs(release)['source-host'].include.length,new Set(release.tasks.filter(task=>task.job==='source-host').map(task=>task.variant)).size);
assert(planJobs(release)['source-host'].include.every(item=>item.timeout<=360));
const pkg=JSON.parse(await readFile('package.json','utf8'));for(const script of regressionScripts)assert(pkg.scripts[script],`Unknown regression ${script}`);
console.log('Release preflight and reusable task graph contracts passed');
