import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { nativeTargets } from './catalog.mjs';
import { readJSON, objectDigest, validateTaskReceipt, fileDigest } from './receipts.mjs';
import { validateFrozenPlan } from './resolve-plan.mjs';
import { bindProducer } from './verify-result.mjs';
const {values}=parseArgs({options:{plan:{type:'string'},inputs:{type:'string'},provenance:{type:'string'},output:{type:'string'}}});
assert(values.plan&&values.inputs&&values.provenance&&values.output);
const plan=validateFrozenPlan(await readJSON(values.plan)), provenance=await readJSON(values.provenance);
await fs.mkdir(values.output,{recursive:true});
for(const target of nativeTargets) {
  const artifactName=`gate-native-load-${target.variant}-${plan.run.id}-${plan.run.attempt}`;
  const root=path.join(values.inputs,artifactName);
  const receipt=await readJSON(path.join(root,'native-load.task.json'));
  const task=plan.tasks.find(task=>task.id==='native-load'&&task.variant===target.variant);
  assert(task); validateTaskReceipt(receipt,plan,task);assert.equal(receipt.status,'passed');
  const job=bindProducer({plan,receipt,provenance,artifactName,digest:objectDigest(receipt)});
  assert(['success','failure'].includes(job.conclusion),'Cancelled native producer cannot supply accepted inputs');
  const summary=await readJSON(path.join(root,`${target.variant}-summary.json`));
  assert.equal(summary.inputCommit,plan.inputSHA);assert.equal(summary.nativeLoaded,true);
  assert.equal(summary.archiveSha256,await fileDigest(path.join(root,`${target.variant}.tar.gz`)));
  for(const file of [`${target.variant}-summary.json`,`${target.variant}.tar.gz`])
    await fs.copyFile(path.join(root,file),path.join(values.output,file),fs.constants.COPYFILE_EXCL);
}
console.log('All six same-run load receipts and original archive hashes validated');
