import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {downloadFixedVSCode} from '/tmp/dsc335-deps/scripts/smoke/download-vscode.mjs';
for(const mode of ['recover','reset','semantic','unrecorded']) {
 process.env.DSC_PROBE_MODE=mode;process.env.DSC_PROBE_COUNT=`/tmp/dsc335-worker-reverify/${mode}.count`;
 await fs.rm(process.env.DSC_PROBE_COUNT,{force:true});
 const records=[];let error;
 try {
 const result=await downloadFixedVSCode({version:'1.142.0',cachePath:'/tmp/dsc335-worker-reverify/cache',deadline:Date.now()+30000,record:r=>records.push(structuredClone(r))});
 assert.equal(mode,'recover');assert.equal(result,'/fixture/code');
 }catch(e){error=e;}
 assert.equal(Boolean(error),mode!=='recover',error?.stack);
 const count=Number(await fs.readFile(process.env.DSC_PROBE_COUNT,'utf8'));
 assert.equal(count,mode==='recover'?2:mode==='reset'?3:1);
 for(const r of records.at(-1).attempts.filter(a=>a.process))assert.equal(r.process.cleanup.status,'passed');
 if(mode==='recover'||mode==='reset')assert.equal(records.at(-1).attempts[0].source,'unhandledRejection');
 console.log('PASS',mode,'attempts',count,'final',records.at(-1).status);
 await fs.writeFile(`/tmp/dsc335-worker-reverify/${mode}.json`,JSON.stringify(records,null,2));
}
