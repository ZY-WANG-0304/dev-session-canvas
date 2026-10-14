// Node22, repository root. Real Host and persistence; gated workspaceState dependency.
import assert from 'node:assert/strict';
import { readFile,writeFile,unlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const original=await readFile('scripts/test/test-host-execution-owner-wiring.mjs','utf8');
const anchor='const testNameFilter = process.env.DEV_SESSION_CANVAS_HOST_TEST_FILTER;';
assert.equal(original.split(anchor).length,2);
const cases=String.raw`
for(const kind of ['agent','terminal']) for(const mode of ['probe','control']) for(const outcome of ['saved','failed']) {
 test('reset persistence RCA '+kind+' '+mode+' '+outcome,async()=>{
  const f=await persistenceFixture({candidate:true});
  const gate=deferred(),messages=[];
  const update=f.host.context.workspaceState.update;
  f.host.context.workspaceState.update=async(...args)=>{await gate.promise;if(outcome==='failed')throw new Error('controlled original save failure');return update(...args);};
  f.host.postMessage=m=>messages.push(m);
  f.host.reconcileCanvasFileArtifacts=state=>state;
  const {record,provider}=await f.started(kind);
  const keys=()=>f.host.state.nodes.map(n=>n.kind+':'+n.id).sort();
  const before=keys();
  if(mode==='control') {
   const close=f.host.closeNonNativeHostExecutions.bind(f.host);
   f.host.closeNonNativeHostExecutions=(reason,permanent,readerOutcome,wait,recovery)=>close(reason,permanent,readerOutcome,true,recovery);
  }
  let returned=false,error;
  const reset=f.host.resetState().then(()=>{returned=true;},e=>{error=e;returned=true;});
  try {
   await until(f.clock,()=>provider.messages.some(m=>m.type==='requestStop'),'reset stop');
   provider.process();provider.message({type:'resourceResult',resourceId:'subject',operationId:'subject-release',result:{kind:'released'}});
   provider.seal(0);provider.release();
   await until(f.clock,()=>record.execution.snapshot().retired&&record.persistence.submitted,'settled owner with write held');
   assert.equal(record.persistence.result,undefined);assert.deepEqual(keys(),before);
   if(mode==='probe') {await completed(f.clock,reset,'pending refusal');assert.match(error.message,/persistence is pending/);}
   else assert.equal(returned,false);
   const held={ownerSettled:record.execution.snapshot().settled,ownerRetired:record.execution.snapshot().retired,submitted:record.persistence.submitted,saveResult:record.persistence.result??null,nodeKeys:keys()};
   gate.resolve();await until(f.clock,()=>record.persistence.result!==undefined,'actual persistence result');
   assert.equal(record.persistence.result.kind,outcome);await completed(f.clock,reset,'reset completion');
   const afterFirst=keys();
   assert.equal(afterFirst.length===0,mode==='control'&&outcome==='saved');
   if(mode==='probe'&&outcome==='saved'){await completed(f.clock,f.host.resetState(),'second explicit reset');assert.equal(keys().length,0);}
   if(mode==='control'&&outcome==='failed')assert.match(error.message,/persistence is failed/);
   console.log('RCA '+JSON.stringify({kind,mode,outcome,identity:record.execution.identity,held,error:error?.message,afterFirst,afterSecond:keys()}));
  } finally{gate.resolve();record.tracker.dispose();await f.cleanup();}
 });
}
`;
const file='scripts/test/.reset-persistence-rca-'+process.pid+'.mjs';
try {await writeFile(file,original.replace(anchor,cases+'\n'+anchor));
 const r=spawnSync(process.execPath,[file],{stdio:'inherit',env:{...process.env,DEV_SESSION_CANVAS_HOST_TEST_FILTER:'^reset persistence RCA '}});
 assert.equal(r.status,0,'Controlled investigation cases must capture expected behavior.');
}finally{await unlink(file);}
