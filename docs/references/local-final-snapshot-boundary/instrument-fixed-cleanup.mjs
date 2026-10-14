import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
export async function instrumentFixedCleanup(host) {
 const product=path.join(host,'dist/extension.js');let b=await readFile(product,'utf8');
 assert.equal(b.split('getDebugSnapshot(){').length,2);
 await writeFile(product,b.replace('getDebugSnapshot(){','getDebugSnapshot(){globalThis.__dscFinalManager=this;'));
 const p=path.join(host,'tests/vscode-smoke/extension-tests.cjs');let s=await readFile(p,'utf8');
 const start=s.indexOf('async function verifyCanvasTemplatesTrusted()');const end=s.indexOf('async function verifyCanvasTemplatesRestricted()',start);
 let body=s.slice(start,end);
 const cleanup=`  await resetCanvasAfterFinalPersistence({
    reset: () => vscode.commands.executeCommand(COMMAND_IDS.testResetState),
    getSnapshot: getDebugSnapshot,
    getDiagnosticEvents,
    expectedExecutions: [agentNode, terminalNode]
  });`;
 assert.equal(body.split(cleanup).length,2);
 const before=String.raw`
  await waitForLocalExecutionStarted('agent',agentNode.id);
  await getDebugSnapshot();
  const manager=globalThis.__dscFinalManager;
  const records=[...manager.nonNativeHostExecutions.values()];
  let releaseSave;
  const gate=new Promise(resolve=>{releaseSave=resolve;});
  const persist=manager.persistState.bind(manager);
  const check=manager.assertNonNativeHostPersistenceComplete.bind(manager);
  const traces=[];
  const trace=(phase,rs)=>{
   traces.push({phase,at:new Date().toISOString(),nodes:manager.state.nodes.map(n=>({kind:n.kind,id:n.id})),records:rs.map(r=>({kind:r.kind,nodeId:r.nodeId,identity:r.execution.identity,persistence:r.persistence&&{submitted:r.persistence.submitted,result:r.persistence.result}}))});
   fsSync.writeFileSync(path.join(artifactDir,'fixed-cleanup-trace.json'),JSON.stringify(traces,null,2));
  };
  for(const r of records)if(r.persistence)void r.persistence.promise.then(()=>trace('saved',[r]));
  manager.persistState=options=>{
   const saved=persist(options);
   return options?.reason==='local-final-snapshot'?Promise.resolve(saved).then(async value=>{await gate;return value;}):saved;
  };
  manager.assertNonNativeHostPersistenceComplete=rs=>{
   trace('check',rs);try{return check(rs);}finally{setTimeout(releaseSave,0);}
  };
  try {
`;
 const after=String.raw`
    trace('reset-complete',records);
    assert.ok(traces.some(t=>t.phase==='check'&&t.records.some(r=>r.persistence?.submitted&&!r.persistence.result)), 'The actual fixed cleanup must touch a pending save.');
    assert.equal(traces.at(-1).nodes.length,0);
    console.log('Actual fixed template cleanup: pending, original save and second reset passed.');
  } finally {releaseSave();manager.persistState=persist;manager.assertNonNativeHostPersistenceComplete=check;}
`;
 body=body.replace(cleanup,before+cleanup+after);
 s=s.slice(0,start)+body+s.slice(end);await writeFile(p,s);
}
