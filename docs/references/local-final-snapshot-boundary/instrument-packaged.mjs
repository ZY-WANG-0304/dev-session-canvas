import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
export async function instrumentPackaged(host) {
 const p=path.join(host,'dist/extension.js');let b=await readFile(p,'utf8');
 assert.equal(b.split('getDebugSnapshot(){').length,2);b=b.replace('getDebugSnapshot(){','getDebugSnapshot(){globalThis.__dscFinalManager=this;');await writeFile(p,b);
 const sp=path.join(host,'tests/vscode-smoke/extension-tests.cjs');let s=await readFile(sp,'utf8');
 const hook=String.raw`
const saveTraces=[];
function recordSaveTrace(phase,m,rs,extra={}) {
 const trace={phase,at:new Date().toISOString(),nodes:m.state.nodes.map(n=>({id:n.id,kind:n.kind,title:n.title})),records:rs.map(r=>({nodeId:r.nodeId,kind:r.kind,identity:r.execution.identity,owner:r.execution.snapshot(),persistence:r.persistence&&{submitted:r.persistence.submitted,result:r.persistence.result}})),...extra};
 saveTraces.push(trace);fsSync.writeFileSync(path.join(artifactDir,'final-save-trace.json'),JSON.stringify(saveTraces,null,2));
 console.log('[final-save-observation] '+JSON.stringify(trace));
}
async function observeOriginalReset(line) {
 await getDebugSnapshot();const m=globalThis.__dscFinalManager;assert.ok(m);const rs=[...m.nonNativeHostExecutions.values()];
 recordSaveTrace('reset-enter',m,rs,{line,stack:new Error().stack});
 for(const r of rs)if(r.persistence)void r.persistence.promise.then(()=>recordSaveTrace('save-settled',m,[r],{line}));
 const original=m.assertNonNativeHostPersistenceComplete.bind(m);
 m.assertNonNativeHostPersistenceComplete=records=>{recordSaveTrace('immediate-check',m,records,{line});return original(records);};
 try{
  if(process.env.DSC_FINAL_SAVE_CONTROL==='1' && line===1138) {
   await resetCanvasAfterFinalPersistence({reset:()=>vscode.commands.executeCommand(COMMAND_IDS.testResetState),getSnapshot:getDebugSnapshot,getDiagnosticEvents,expectedExecutions:rs.map(r=>({kind:r.kind,id:r.nodeId}))});
  } else await vscode.commands.executeCommand(COMMAND_IDS.testResetState);
  recordSaveTrace('reset-return',m,rs,{line});}
 catch(error){recordSaveTrace('reset-threw',m,rs,{line,error:error.message});
  await Promise.race([Promise.all(rs.flatMap(r=>r.persistence?[r.persistence.promise]:[])),new Promise((_,reject)=>setTimeout(()=>reject(new Error('Original save observation timed out')),10000))]);
  recordSaveTrace('after-rejected-reset-save',m,rs,{line});throw error;
 }finally{m.assertNonNativeHostPersistenceComplete=original;}
}
`;
 const lines=s.split('\n');
 for(let i=0;i<lines.length;i++)lines[i]=lines[i].replace('await vscode.commands.executeCommand(COMMAND_IDS.testResetState);',`await observeOriginalReset(${i+1});`);
 s=lines.join('\n').replace('let lastWebviewProbe;',hook+'\nlet lastWebviewProbe;');
 await writeFile(sp,s);
}
