import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { taskKey } from './catalog.mjs';
import { collectGitHubProvenance } from './github-provenance.mjs';
import { objectDigest, readJSON, writeJSON, validatePlan } from './receipts.mjs';
import { validateFrozenPlan } from './resolve-plan.mjs';

export function validateAcceptance({ plan, acceptance, result, provenance, inputSHA, baseSHA, headSHA }) {
  validateFrozenPlan(plan);
  return validateRecordedAcceptance({ plan, acceptance, result, provenance, inputSHA, baseSHA, headSHA });
}

// Delivery validates a producer-proven historical contract, never today's catalogue.
export function validateRecordedAcceptance({ plan, acceptance, result, provenance, inputSHA, baseSHA, headSHA }) {
  validatePlan(plan);
  assert(['pr','release-pr','release-tag'].includes(plan.mode),'Diagnostic results cannot accept a formal gate');
  for (const [key,value] of Object.entries({ inputSHA,baseSHA,headSHA })) if(value) assert.equal(plan[key],value);
  assert.equal(acceptance?.schemaVersion,1); assert.equal(result?.schemaVersion,1);
  assert.equal(acceptance.mode,plan.mode); assert.equal(acceptance.inputSHA,plan.inputSHA);
  assert.equal(acceptance.version,plan.version);
  for(const key of ['catalogDigest','policyDigest','environmentDigest']) assert.equal(acceptance[key],plan[key]);
  assert.equal(acceptance.planDigest,objectDigest(plan)); assert.equal(result.planDigest,objectDigest(plan));
  assert.equal(result.inputSHA,plan.inputSHA); assert.equal(result.mode,plan.mode); assert.equal(result.status,'passed');
  for(const key of ['errors','failed','notRun']) assert.deepEqual(result[key],[],'Incomplete gate cannot be accepted');
  const required=plan.tasks.filter(task=>task.required).map(taskKey);
  assert.deepEqual(acceptance.tasks,required); assert.deepEqual(result.required,required);
  assert.deepEqual([...result.actual].sort(),plan.tasks.map(taskKey).sort());
  assert.deepEqual(acceptance.receipts.map(receipt=>receipt.key).sort(),plan.tasks.map(taskKey).sort());
  assert.equal(new Set(acceptance.receipts.map(receipt=>receipt.key)).size,plan.tasks.length);
  assert.equal(acceptance.provenanceDigest,objectDigest(provenance));
  assert.equal(result.provenanceDigest,objectDigest(provenance));
  assert.equal(provenance.runID,String(plan.run.id)); assert.equal(provenance.attempt,plan.run.attempt);
  assert.equal(provenance.headSHA,plan.run.headSHA);
  assert.equal(acceptance.producer.runID,String(plan.run.id)); assert.equal(acceptance.producer.attempt,plan.run.attempt);
  assert.equal(acceptance.producer.repository,provenance.repository); assert.equal(acceptance.producer.job,'verify-result');
  return acceptance;
}

export async function findUniqueFile(directory,name) {
  const files=[];
  const visit=async root=>{for(const entry of await fs.readdir(root,{withFileTypes:true})) {
    const file=path.join(root,entry.name);
    if(entry.isDirectory())await visit(file); else if(entry.isFile()&&entry.name===name)files.push(file);
  }};
  await visit(directory); assert.equal(files.length,1,`Expected exactly one ${name}`); return files[0];
}

export async function checkGitHubAcceptance({ inputSHA,baseSHA,headSHA,output,run,repository,collector=collectGitHubProvenance, recordedPolicy=false }) {
  const independent=await collector({run,tasks:[]},{scope:'acceptance',repository,output});
  assert.equal(independent.artifacts.length,1,'Missing/ambiguous final acceptance artifact');
  const artifact=independent.artifacts[0]; const producer=independent.jobs.find(job=>job.id===artifact.jobID);
  assert.equal(producer?.name,'Gate verify-result (default)'); assert.equal(producer.status,'completed');
  assert.equal(producer.conclusion,'success','Verifier failure cannot be hidden by an uploaded file');
  const root=path.join(output,artifact.name);
  const plan=await readJSON(await findUniqueFile(root,'gate-plan.json'));
  assert.deepEqual(plan.run,run,'Acceptance belongs to a different run/input');
  const acceptance=await readJSON(await findUniqueFile(root,'acceptance-receipt.json'));
  assert(artifact.receiptDigests.includes(objectDigest(acceptance)),'Acceptance was not independently downloaded');
  (recordedPolicy ? validateRecordedAcceptance : validateAcceptance)({plan,acceptance,inputSHA,baseSHA,headSHA,
    result:await readJSON(await findUniqueFile(root,'gate-result.json')),
    provenance:await readJSON(await findUniqueFile(root,'gate-provenance.json'))});
  await writeJSON(path.join(output,'checked-acceptance.json'),{schemaVersion:1,status:'passed',inputSHA:plan.inputSHA,
    planDigest:objectDigest(plan),acceptanceDigest:objectDigest(acceptance),artifactID:artifact.id,
    verifierJobID:producer.id,run});
  return {plan,acceptance,root};
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1])) {
  const {values}=parseArgs({options:{sha:{type:'string'},base:{type:'string'},head:{type:'string'},
    'run-head':{type:'string'},output:{type:'string'}}});
  assert(values.sha&&values.base&&values.head&&values['run-head']&&values.output);
  await checkGitHubAcceptance({inputSHA:values.sha,baseSHA:values.base,headSHA:values.head,output:values.output,
    repository:process.env.GITHUB_REPOSITORY,run:{id:process.env.GITHUB_RUN_ID,
      attempt:Number(process.env.GITHUB_RUN_ATTEMPT),headSHA:values['run-head']}});
  console.log('Complete acceptance independently bound to the actual verifier and immutable input');
}
