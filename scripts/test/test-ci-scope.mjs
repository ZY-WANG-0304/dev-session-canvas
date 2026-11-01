import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import yaml from 'js-yaml';
import { buildPlan, planJobs, validateFrozenPlan } from '../gates/resolve-plan.mjs';
import { selectAffectedTasks, ordinaryDocumentation, classifyImpact, documentationConsumers } from '../gates/scope-policy.mjs';
import { jobDependencies, taskKey } from '../gates/catalog.mjs';
import { observationPolicy, validateObservationPolicy } from '../gates/observation-policy.mjs';
import { summarizeObservations, readObservationHistory } from '../gates/report-observations.mjs';
import { validateReuseCandidate, effectiveTree, prepareMerge, verifyMerge, policyUnchanged } from '../gates/merge-control.mjs';
import { checkDocumentation } from '../gates/check-documentation.mjs';
import { writeJSON } from '../gates/receipts.mjs';
const root = process.cwd();
const baseArgs = { mode: 'pr', inputSHA: 'a'.repeat(40), headSHA: 'a'.repeat(40), baseSHA: 'b'.repeat(40), version: '0.27.0', selection: 'affected' };
const planFor = (paths, extra = {}) => buildPlan({ ...baseArgs, changedPaths: paths, ...extra });
const jobs = plan => new Set(plan.tasks.map(task => task.job));
const full = planFor(['package-lock.json']);

test('ordinary prose has no product jobs; executable or evidence inputs are conservative', () => {
  const plan = planFor(['docs/workflows/COMMIT.md']);
  assert.deepEqual([...jobs(plan)], ['input-contract']);
  for (const file of ['docs/references/fixture.json', 'docs/exec-plans/tool.mjs', '.github/workflows/ci-validation.yml', 'scripts/gates/scope-policy.mjs', 'unknown/file']) {
    assert(classifyImpact([file]).domains.includes('full'));
    assert.equal(planFor([file]).tasks.length, full.tasks.length);
  }
  assert.throws(() => classifyImpact(['../src/x']));
});
test('documents consumed by contracts are never excluded from effective inputs', () => {
  for (const [file, consumers] of Object.entries(documentationConsumers)) {
    assert(!ordinaryDocumentation(file));
    const plan = planFor([file]);
    for (const id of consumers) assert(plan.tasks.some(task => task.id === id), `${file}: ${id}`);
  }
});
test('module selection unions consumers and closes all production dependencies', () => {
  const cases = [
    ['apps/template-marketplace/src/worker/app.ts', ['marketplace-host', 'marketplace-browser'], ['source-host', 'packaged-host', 'installed-pair']],
    ['packages/marketplace-shared/src/schema.ts', ['marketplace-browser', 'source-host', 'installed-pair'], []],
    ['extensions/vscode/dev-session-canvas-notifier/src/extension.ts', ['source-host', 'installed-pair', 'webview-function'], ['marketplace-browser']],
    ['extensions/vscode/dev-session-canvas/src/webview/styles.css', ['webview-visual', 'source-host', 'installed-pair'], ['marketplace-browser']],
    ['extensions/vscode/dev-session-canvas/README.marketplace.md', ['package-clean', 'installed-pair'], ['source-host', 'packaged-host', 'webview-function']],
    ['extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts', ['source-host', 'packaged-host', 'webview-function'], ['marketplace-browser']]
  ];
  for (const [file, included, excluded] of cases) {
    const plan = planFor([file]), selected = jobs(plan);
    included.forEach(job => assert(selected.has(job), `${file} must include ${job}`));
    excluded.forEach(job => assert(!selected.has(job), `${file} must omit ${job}`));
    for (const job of selected) for (const dependency of jobDependencies[job] ?? []) assert(selected.has(dependency), `${job} needs ${dependency}`);
    if (selected.has('native-assets')) assert.equal(planJobs(plan)['native-assets'].include.length, 6);
  }
  const union = planFor([cases[0][0], cases[3][0]]);
  assert(jobs(union).has('marketplace-browser') && jobs(union).has('webview-visual'));
});
test('release modes retain every task, observation failure cannot reduce release requirements', () => {
  for (const mode of ['release-pr', 'release-tag']) {
    const selected = planFor(['docs/workflows/COMMIT.md'], { mode });
    const original = planFor(['docs/workflows/COMMIT.md'], { mode, selection: undefined });
    assert.deepEqual(selected.tasks, original.tasks);
    assert.equal(selected.tasks.length, 362); assert(selected.tasks.every(task => task.required));
    assert.equal(selected.selectionResult, undefined);
  }
});
test('known observations are isolated cases and never remove their producers or sibling tasks', () => {
  const legacy = planFor(['package-lock.json'], { selection: undefined });
  const keys = validateObservationPolicy(observationPolicy, legacy.tasks);
  assert.equal(keys.size, 3);
  for (const key of keys) assert(!full.tasks.some(task => taskKey(task) === key));
  const observation = planFor(['package-lock.json'], { mode: 'observational' });
  assert.equal(observation.tasks.filter(task => ['source-host', 'packaged-host'].includes(task.job)).length, 3);
  assert(jobs(observation).has('native-assets') && jobs(observation).has('package-clean'));
  assert.throws(() => validateObservationPolicy({ version: 1, entries: [{ ...observationPolicy.entries[0], suite: '*' }] }, legacy.tasks));
  const tampered = structuredClone(full); tampered.tasks.pop();
  assert.throws(() => validateFrozenPlan(tampered));
});
test('first failure remains after retry success; unknown signatures and missing cases remain visible', () => {
  const plan = planFor(['package-lock.json'], { mode: 'observational', run: { id: '7', attempt: 2, headSHA: 'a'.repeat(40) } });
  const entry = plan.selectionResult.observations[0];
  const receipt = { job: entry.job, variant: entry.variant, taskID: `smoke/${entry.suite}`, status: 'passed', failures: [] };
  const history = [{ runID: '7', attempt: 1, observations: [{ key: entry.key, status: 'failed' }] }];
  let report = summarizeObservations({ plan, result: { errors: [] }, receipts: [receipt], history });
  assert.equal(report[0].status, 'passed'); assert.deepEqual(report[0].firstAttempts, { failures: 1, samples: 1 });
  assert.equal(report[1].status, 'not-run');
  report = summarizeObservations({ plan, receipts: [{ ...receipt, status: 'failed', failures: [{ reason: 'different error' }] }] });
  assert.equal(report[0].classification, 'needs-triage');
});

async function fixture(t, { policyChange = false } = {}) {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'dsc-ci-scope-'));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: folder, encoding: 'utf8', stdio: ['pipe','pipe','pipe'] }).trim();
  git('init', '-q'); git('config','user.name','Fixture'); git('config','user.email','fixture@example.invalid');
  const write = async (file, text) => { await fs.mkdir(path.dirname(path.join(folder,file)), { recursive:true }); await fs.writeFile(path.join(folder,file),text); };
  await write('src/code.js','export const value = 1;\n');
  await write('docs/workflows/note.md','# Note\n');
  await write('package.json','{"version":"0.27.0"}');
  for (const name of ['dev-session-canvas', 'dev-session-canvas-notifier']) await write(`extensions/vscode/${name}/package.json`, '{"version":"0.27.0"}');
  for (const file of ['scripts/gates/catalog.mjs','scripts/smoke/smoke-catalog.mjs','scripts/gates/browser-catalog.json','scripts/smoke/smoke-implementation-map.json','scripts/smoke/remote-ssh-extension-inputs.json']) {
    await write(file, await fs.readFile(path.join(root,file),'utf8'));
  }
  git('add','.');git('commit','-qm','base');const base=git('rev-parse','HEAD');
  git('update-ref','refs/remotes/origin/main',base);
  await write('src/code.js','export const value = 2;\n');
  if(policyChange) await write('scripts/gates/new-policy.mjs','export const policy = 2;\n');
  git('add','.');git('commit','-qm','code');const old=git('rev-parse','HEAD');
  const oldInput=git('commit-tree',git('rev-parse','HEAD^{tree}'),'-p',base,'-p',old,'-m','old merge');
  await write('docs/workflows/note.md','# Updated note\n');git('add','.');git('commit','-qm','docs');const head=git('rev-parse','HEAD');
  const input=git('commit-tree',git('rev-parse','HEAD^{tree}'),'-p',base,'-p',head,'-m','new merge');git('checkout','-q','--detach',input);
  const previous=planFor(['src/code.js'],{selection:policyChange?undefined:'affected',inputSHA:oldInput,headSHA:old,baseSHA:base,run:{id:'10',attempt:1,headSHA:old}});
  const current=planFor(['src/code.js','docs/workflows/note.md'],{selection:policyChange?undefined:'affected',inputSHA:input,headSHA:head,baseSHA:base,run:{id:'11',attempt:1,headSHA:head}});
  const run={id:10,run_attempt:1,head_sha:old,event:'pull_request',path:'.github/workflows/release-preflight.yml',status:'completed',conclusion:'success',
    repository:{full_name:'owner/repo'},head_repository:{full_name:'owner/repo'},pull_requests:[{number:1}],updated_at:new Date().toISOString()};
  return {root:folder,git,write,base,old,oldInput,head,input,previous,current,run,repository:'owner/repo',pr:1};
}
test('a real Git code then docs update proves equivalent inputs without changing old identity', async t => {
  const f=await fixture(t); const proof=validateReuseCandidate(f);
  assert.equal(proof.previousInput,f.oldInput);assert.deepEqual(proof.documentationDelta,['docs/workflows/note.md']);
  assert.deepEqual(effectiveTree(f.root,f.oldInput),effectiveTree(f.root,f.input));
});
test('reuse rejects failed, cancelled, stale, unrelated PR/attempt/environment/base and task changes', async t => {
  const f=await fixture(t);
  for(const patch of [{conclusion:'failure'},{status:'in_progress'},{conclusion:'cancelled'},{run_attempt:2},
    {pull_requests:[{number:2}]},{event:'push'},{updated_at:'2000-01-01T00:00:00Z'},{path:'.github/workflows/other.yml'}]) {
    assert.throws(()=>validateReuseCandidate({...f,run:{...f.run,...patch}}),JSON.stringify(patch));
  }
  for(const patch of [{baseSHA:'c'.repeat(40)},{environmentDigest:'d'.repeat(64)},{tasks:f.current.tasks.slice(1)}]) {
    assert.throws(()=>validateReuseCandidate({...f,current:{...f.current,...patch}}));
  }
});
test('changed code or executable documentation cannot hide in an equivalent tree', async t => {
  const f=await fixture(t);
  await f.write('src/code.js','export const value = 3;\n');f.git('add','.');f.git('commit','-qm','real code');
  assert.notDeepEqual(effectiveTree(f.root,f.input),effectiveTree(f.root,f.git('rev-parse','HEAD')));
  await fs.chmod(path.join(f.root,'docs/workflows/note.md'),0o755);f.git('add','.');f.git('commit','-qm','executable mode');
  assert.notDeepEqual(effectiveTree(f.root,f.input),effectiveTree(f.root,f.git('rev-parse','HEAD')));
});
test('documentation checker catches broken links and archived document references', async t => {
  const f=await fixture(t);
  await f.write('docs/workflows/note.md','[missing](missing.md)\n');
  assert.throws(()=>checkDocumentation({root:f.root,paths:['docs/workflows/note.md']}),/Broken/);
  await f.write('docs/workflows/note.md','[old](old.md)\n');await f.write('docs/workflows/old.md','# Old');
  f.git('add','.');f.git('commit','-qm','links');await fs.unlink(path.join(f.root,'docs/workflows/old.md'));
  assert.throws(()=>checkDocumentation({root:f.root,paths:['docs/workflows/old.md']}),/still linked/);
});
test('changing selection policy cannot classify its own PR as lightweight', async t => {
  const f=await fixture(t);await f.write('scripts/gates/scope-policy.mjs','changed');f.git('add','.');f.git('commit','-qm','policy');
  assert.equal(policyUnchanged(f.root,f.base,f.git('rev-parse','HEAD')),false);
});
test('pure documentation control verifies a current head without acceptance or workspace dependencies', async t => {
  const f=await fixture(t);f.git('checkout','-q','--detach',f.base);
  await f.write('docs/workflows/note.md','# Documentation only\n');f.git('add','.');f.git('commit','-qm','only docs');const head=f.git('rev-parse','HEAD');
  const input=f.git('commit-tree',f.git('rev-parse','HEAD^{tree}'),'-p',f.base,'-p',head,'-m','docs merge');f.git('checkout','-q','--detach',input);
  const api=async route=>{assert.equal(route,'pulls/1');return {state:'open',head:{sha:head},base:{sha:f.base}};};
  const run={id:'12',attempt:1,headSHA:head},output=path.join(f.root,'output');
  const control=await prepareMerge({...f,input,head,run,output,api});assert.equal(control.route,'documentation');
  const result=await verifyMerge({root:f.root,control,output,api,checkAcceptance:()=>{throw new Error('No acceptance needed');}});
  assert.equal(result.status,'passed');assert.equal(result.evidence.execution,'not-applicable');
  await assert.rejects(()=>verifyMerge({root:f.root,control,output,api:async()=>({state:'open',head:{sha:head},base:{sha:'e'.repeat(40)}})}),/advanced/);
});
test('workflow only invokes business graph on execute and never waits for observations', async () => {
  const outer=yaml.load(await fs.readFile('.github/workflows/release-preflight.yml','utf8'));
  assert.match(outer.jobs.validation.if,/route == 'execute'/);
  assert.deepEqual(outer.jobs['verify-release-contract'].needs,['resolve-input','validation']);
  assert(outer.jobs['verify-release-contract'].steps.some(step=>step.if?.includes("route != 'documentation'")));
  const reusable=yaml.load(await fs.readFile('.github/workflows/ci-validation.yml','utf8'));
  for(const [name,job]of Object.entries(reusable.jobs)) if(!['resolve','verify-result'].includes(name)) assert(job.if.includes(`outputs.${name.replaceAll('-','_')} != ''`));
  const observation=yaml.load(await fs.readFile('.github/workflows/ci-observations.yml','utf8'));
  assert.equal(observation.jobs.observation.with.mode,'observational');assert(observation.on.schedule);
  assert(!Object.values(outer.jobs).some(job=>JSON.stringify(job.needs ?? []).includes('observation')));
});

test('prepare and final verifier independently bind the same successful prior acceptance', async t => {
  const f=await fixture(t);const output=path.join(f.root,'control');let checks=0;
  const api=async route=>{
    if(route==='pulls/1')return {state:'open',head:{sha:f.head,ref:'feature'},base:{sha:f.base}};
    if(route.startsWith('actions/workflows/'))return {workflow_runs:[f.run]};
    assert.equal(route,'actions/runs/10');return f.run;
  };
  const checker=async args=>{
    checks++;assert.equal(args.run.id,'10');
    await writeJSON(path.join(args.output,'checked-acceptance.json'),{artifactID:50,verifierJobID:60,acceptanceDigest:'f'.repeat(64)});
    return {plan:f.previous};
  };
  const control=await prepareMerge({...f,run:f.current.run,output,api,checkAcceptance:checker});
  assert.equal(control.route,'reuse',JSON.stringify(control.reuseMisses));
  const verified=await verifyMerge({root:f.root,control,output:path.join(f.root,'verified'),api,checkAcceptance:checker});
  assert.equal(checks,2);assert.equal(verified.evidence.execution,'reused');assert.equal(verified.head,f.head);
  const corrupt=structuredClone(control);corrupt.reuse.artifactID=999;
  await assert.rejects(()=>verifyMerge({root:f.root,control:corrupt,output:path.join(f.root,'corrupt'),api,checkAcceptance:checker}));
});
test('unavailable acceptance falls back to execution, never to an inferred green result', async t => {
  const f=await fixture(t);
  const api=async route=>route==='pulls/1'?{state:'open',head:{sha:f.head,ref:'feature'},base:{sha:f.base}}
    :route.startsWith('actions/workflows/')?{workflow_runs:[f.run]}:f.run;
  const control=await prepareMerge({...f,run:f.current.run,output:path.join(f.root,'control'),api,
    checkAcceptance:async()=>{throw new Error('Original artifact expired');}});
  assert.equal(control.route,'execute');assert.match(control.reuseMisses[0].reason,/expired/);
});

test('literal documentation consumers in contract tests cannot silently enter the prose whitelist', async () => {
  for(const file of (await fs.readdir('scripts/test')).filter(file=>file.endsWith('.mjs'))) {
    const source=await fs.readFile(path.join('scripts/test',file),'utf8');
    for(const match of source.matchAll(/\b(?:readFile|readFileSync|readText)\(\s*['"](docs\/[^'"]+)['"]/g)) {
      assert(!ordinaryDocumentation(match[1]),`Register the contract consumer before excluding ${match[1]} (${file})`);
    }
  }
});

test('a gate-changing PR may reuse its prior full execution only after unchanged-code documentation follow-up', async t => {
  const f=await fixture(t,{policyChange:true});
  assert.equal(policyUnchanged(f.root,f.base,f.input),false);
  assert.equal(f.previous.tasks.length,362);
  assert.doesNotThrow(()=>validateReuseCandidate(f));
  assert.throws(()=>validateReuseCandidate({...f,previous:{...f.previous,selection:'affected'}}),/full execution/);
});

test('a running retry downloads its own first-attempt observation report instead of losing the first failure', async t => {
  const {default:JSZip}=await import('jszip');
  const {digest}=await import('../gates/receipts.mjs');
  const report={repository:'owner/repo',runID:'7',attempt:1,headSHA:'a'.repeat(40),observations:[{key:'case',status:'failed'}]};
  const zip=new JSZip();zip.file('observation-report.json',JSON.stringify(report));const bytes=await zip.generateAsync({type:'nodebuffer'});
  const originalFetch=globalThis.fetch;t.after(()=>{globalThis.fetch=originalFetch;});
  globalThis.fetch=async url=>{assert(String(url).endsWith('/actions/artifacts/70/zip'));return {ok:true,arrayBuffer:async()=>bytes};};
  const api=async route=>route.startsWith('actions/workflows/')?{workflow_runs:[{id:7,status:'in_progress',run_attempt:2,head_sha:'a'.repeat(40)}]}
    :{artifacts:[{id:70,name:'ci-observation-report-7-1',expired:false,digest:`sha256:${digest(bytes)}`}]};
  const history=await readObservationHistory({repository:'owner/repo',currentRun:'7',api});
  assert.equal(history.length,1);assert.equal(history[0].observations[0].status,'failed');
});
