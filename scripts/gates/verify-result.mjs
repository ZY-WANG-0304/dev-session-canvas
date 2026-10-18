import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { taskKey } from './catalog.mjs';
import { assertDigest, objectDigest, readJSON, validateTaskReceipt, validatePackageReceipt, writeJSON } from './receipts.mjs';
import { validateFrozenPlan } from './resolve-plan.mjs';

export function bindProducer({ plan, receipt, provenance, artifactName, digest: receiptDigest }) {
  assert.equal(receipt.producer.repository, provenance.repository);
  const jobs=provenance.jobs.filter(job=>job.name===receipt.producer.jobName);
  assert.equal(jobs.length,1,'Missing/ambiguous actual producer job');
  const [job]=jobs; assert.equal(job.status,'completed','Producer job did not complete');
  const artifacts=provenance.artifacts.filter(artifact=>artifact.name===artifactName);
  assert.equal(artifacts.length,1,'Missing/ambiguous artifact');
  const [artifact]=artifacts;assert.equal(artifact.expired,false);assert.equal(artifact.runID,String(plan.run.id));
  assert.equal(artifact.attempt,plan.run.attempt);assert.equal(artifact.headSHA,plan.run.headSHA);
  assert.equal(artifact.jobID,job.id,'Artifact source was not independently bound to the producer job');
  assertDigest(artifact.archiveHash,'Downloaded artifact hash');
  assert(artifact.receiptDigests.includes(receiptDigest),'Receipt was not found in the independently downloaded artifact');
  return job;
}
export function aggregateResults({plan,receipts,provenance,packageReceipt}) {
  validateFrozenPlan(plan);assert(Array.isArray(receipts));
  assert(provenance?.schemaVersion===1&&Array.isArray(provenance.jobs)&&Array.isArray(provenance.artifacts),
    'Independent execution/artifact provenance is required');
  assert.equal(provenance.runID,String(plan.run.id));assert.equal(provenance.attempt,plan.run.attempt);
  assert.equal(provenance.headSHA,plan.run.headSHA);assert.equal(typeof provenance.repository,'string');
  const expected=new Map(plan.tasks.map(task=>[taskKey(task),task]));const actual=new Map();const errors=[];
  for(const receipt of receipts) {
    const key=`${receipt.job}/${receipt.variant}/${receipt.taskID}`;
    if(actual.has(key)){errors.push({key,reason:'Duplicate actual task receipt'});continue;}
    actual.set(key,receipt);
    try{assert(expected.has(key),'Unplanned task/variant result');validateTaskReceipt(receipt,plan,expected.get(key));}
    catch(error){errors.push({key,reason:error.message});}
  }
  const passed=[],failed=[],notRun=[],calibration=[];
  for(const [key,task]of expected) {
    const receipt=actual.get(key);let structuralError,actionError;
    try {
      assert(receipt,'Missing execution receipt');validateTaskReceipt(receipt,plan,task);
      const job=bindProducer({plan,receipt,provenance,artifactName:`gate-${task.job}-${task.variant}-${plan.run.id}-${plan.run.attempt}`,
        digest:objectDigest(receipt)});
      if(job.conclusion!=='success') {
        // A native failure may be explained only by the operation step after a
        // successful load and successful uploads. Cancellation/infra remain fatal.
        const operation=actual.get(`native-assets/${task.variant}/native-operation`);
        const load=actual.get(`native-assets/${task.variant}/native-load`);
        const operationFailure=task.job==='native-assets'&&job.conclusion==='failure'
          &&job.steps?.filter(step=>step.name!=='Operate original native provider').every(step=>['success','skipped'].includes(step.conclusion))
          &&job.steps?.some(step=>step.name==='Operate original native provider'&&step.conclusion==='failure')
          &&load?.status==='passed'&&operation?.status==='failed';
        assert(operationFailure,`Actual producer job is ${job.conclusion}`);
      }
      if(receipt.status!=='passed')actionError=`Task result is ${receipt.status}`;
    }catch(error){structuralError=error.message;}
    if(structuralError) {
      if(!receipt||receipt.status==='not-run')notRun.push({key,reason:structuralError});
      else failed.push({key,reason:structuralError,failures:receipt.failures});
    } else if(actionError) {
      const canCalibrate=task.calibration===true&&!task.required&&receipt.status==='failed'
        &&receipt.stages.prepare.status==='passed'&&receipt.stages.cleanup.status==='passed';
      if(canCalibrate)calibration.push({key,status:receipt.status,reason:actionError,failures:receipt.failures});
      else failed.push({key,reason:actionError,failures:receipt.failures});
    } else passed.push(key);
  }
  if(plan.scope.artifact) {
    try {
      validatePackageReceipt(packageReceipt,plan);
      const job=bindProducer({plan,receipt:packageReceipt,provenance,
        artifactName:`gate-transfer-candidate-${plan.run.id}-${plan.run.attempt}`,digest:objectDigest(packageReceipt)});
      assert.equal(job.conclusion,'success','Candidate producer did not succeed');
    } catch(error){errors.push({key:'package-clean',reason:error.message});}
    if(packageReceipt)for(const task of plan.tasks.filter(item=>['packaged-host','installed-pair'].includes(item.job))) {
      const receipt=actual.get(taskKey(task));
      if(!receipt?.consumed.some(item=>item.kind==='package-receipt'&&item.sha256===objectDigest(packageReceipt)))
        errors.push({key:taskKey(task),reason:'Consumer did not validate the same candidate pair'});
    }
  }
  const complete=!errors.length&&!failed.length&&!notRun.length;
  const result={schemaVersion:1,mode:plan.mode,inputSHA:plan.inputSHA,planDigest:objectDigest(plan),status:complete?'passed':'failed',
    required:plan.tasks.filter(task=>task.required).map(taskKey),actual:[...actual.keys()],passed,failed,notRun,calibration,errors,
    provenanceDigest:objectDigest(provenance),firstFailure:errors[0]??failed[0]??notRun[0]??null};
  const acceptance=complete&&['pr','release-pr','release-tag'].includes(plan.mode)?{
    schemaVersion:1,mode:plan.mode,inputSHA:plan.inputSHA,version:plan.version,planDigest:objectDigest(plan),
    catalogDigest:plan.catalogDigest,policyDigest:plan.policyDigest,environmentDigest:plan.environmentDigest,
    tasks:plan.tasks.filter(task=>task.required).map(taskKey),packageReceiptDigest:packageReceipt?objectDigest(packageReceipt):null,
    packages:packageReceipt?.packages??[],receipts:receipts.map(receipt=>({key:`${receipt.job}/${receipt.variant}/${receipt.taskID}`,
      sha256:objectDigest(receipt)})),provenanceDigest:objectDigest(provenance),producer:{runID:String(plan.run.id),attempt:plan.run.attempt,
      job:'verify-result',repository:provenance.repository},completedAt:new Date().toISOString()}:null;
  return {result,acceptance};
}
export async function loadReceipts(directory) {
  const receipts=[];
  async function visit(root){for(const entry of await fs.readdir(root,{withFileTypes:true})){const file=path.join(root,entry.name);
    if(entry.isDirectory()) {
      // Input transfers contain the same load receipt as the final result;
      // only the actual producer result artifact supplies the execution set.
      if(!entry.name.startsWith('gate-native-load-')&&!entry.name.startsWith('gate-transfer-'))await visit(file);
    }else if(entry.name.endsWith('.task.json'))receipts.push(await readJSON(file));}}
  await visit(directory);return receipts;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1])) {
  const {values}=parseArgs({options:{plan:{type:'string'},results:{type:'string'},provenance:{type:'string'},
    'package-receipt':{type:'string'},output:{type:'string'}}});
  assert(values.plan&&values.results&&values.provenance&&values.output);
  await fs.rm(path.join(values.output,'acceptance-receipt.json'),{force:true});
  const {result,acceptance}=aggregateResults({plan:await readJSON(values.plan),receipts:await loadReceipts(values.results),
    provenance:await readJSON(values.provenance),packageReceipt:values['package-receipt']?await readJSON(values['package-receipt']):undefined});
  await writeJSON(path.join(values.output,'gate-result.json'),result);
  if(acceptance)await writeJSON(path.join(values.output,'acceptance-receipt.json'),acceptance);
  console.log(JSON.stringify({status:result.status,passed:result.passed.length,failed:result.failed,notRun:result.notRun,
    errors:result.errors,calibration:result.calibration}));if(!acceptance)process.exitCode=1;
}
