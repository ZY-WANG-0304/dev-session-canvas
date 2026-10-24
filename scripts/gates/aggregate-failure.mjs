import fs from 'node:fs/promises';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {writeJSON} from './receipts.mjs';
const {values}=parseArgs({options:{output:{type:'string'}}});
if(!values.output)throw new Error('Aggregate evidence directory required');
const result=path.join(values.output,'gate-result.json');
try { await fs.access(result); }
catch(error) {
  if(error.code!=='ENOENT')throw error;
  await fs.rm(path.join(values.output,'acceptance-receipt.json'),{force:true});
  await writeJSON(result,{schemaVersion:1,status:'failed',inputSHA:process.env.GATE_INPUT??null,
    errors:[{key:'verify-result',reason:'Aggregate infrastructure failed before complete task verification',
      resolveResult:process.env.GATE_RESOLVE??'unknown'}],completedAt:new Date().toISOString()});
}
