import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import esbuild from 'esbuild';
import path from 'node:path';
const output = path.resolve('.debug/canvas-display-updates');
await mkdir(output, {recursive:true});
await esbuild.build({entryPoints:['extensions/vscode/dev-session-canvas/src/common/canvasDisplayUpdates.ts'],
  outfile:path.join(output,'display.cjs'),bundle:true,platform:'node',format:'cjs'});
const { CanvasDisplayPublisher, projectCanvasDisplayState, applyCanvasDisplayDelta } = createRequire(import.meta.url)(path.join(output,'display.cjs'));
const node = id => ({id, kind:'agent', title:id, status:'running', summary:'Running', position:{x:10,y:20},size:{width:400,height:300},
  metadata:{agent:{outputSequence:0, lifecycle:'running',cwd:'/workspace',liveSession:true,terminalTitle:'bash',recentOutput:'hello'}}});
const initial = () => ({state:{version:1,updatedAt:'initial',nodes:[node('a'),node('b')],edges:[],groups:[],nextGroupSequence:1,
  fileReferences:[],suppressedFileActivityEdgeIds:[],suppressedAutomaticFileArtifactNodeIds:[]},runtime:{terminalScrollback:1000,workspaceTrusted:true,
  workspaceFolders:[],noteMarkdownImageWorkspaceRoots:[{name:'workspace',webviewResourceBaseUri:'base'}]}});
const canonical = s => { const v=structuredClone(projectCanvasDisplayState(s));delete v.updatedAt;return JSON.parse(JSON.stringify(v)); };
const wire = s => JSON.parse(JSON.stringify(s));
const publisher = new CanvasDisplayPublisher();let value = initial();
let message = publisher.publish(value,'frame-1',false);assert.equal(message.type,'host/stateUpdated');
let displayed = wire(message.payload);const revision=displayed.revision;
value.state.updatedAt='tick';value.state.nodes[0].metadata.agent.outputSequence=10;
assert.equal(publisher.publish(value,'frame-1',false),undefined,'output progress alone is not a canvas change');
assert.equal(value.state.nodes[0].metadata.agent.outputSequence,10,'transport projection must not mutate authoritative runtime state');
for (const change of [
  s=>{s.state.nodes[0].title='one';s.state.nodes[1].title='two';},
  s=>{s.state.nodes[0].metadata.agent.cwd='/new';s.state.nodes[0].metadata.agent.recentOutput='fresh';},
  s=>{s.state.nodes[0].status='stopped';s.state.nodes[0].metadata.agent.lastCols=80;},
  s=>{s.state.nodes.push(node('c'));s.state.edges.push({id:'ac',sourceNodeId:'a',targetNodeId:'c'});},
  s=>{s.state.nodes.reverse();},
  s=>{s.state.groups=[{id:'g',position:{x:1,y:1},size:{width:800,height:800}}];s.state.nodes[0].groupId='g';},
  s=>{s.state.nodes=s.state.nodes.filter(n=>n.id!=='a');s.state.edges=[];s.state.groups=[];delete s.state.nodes[0].groupId;},
  s=>{s.runtime.workspaceTrusted=false;delete s.runtime.noteMarkdownImageWorkspaceRoots;},
  s=>{s.state.fileReferences=[{id:'file',filePath:'/a',owners:[]}];}
]) {
  const previous=displayed;change(value);message=wire(publisher.publish(value,'frame-1',false));assert.equal(message.type,'host/stateDelta');
  displayed=applyCanvasDisplayDelta(displayed,message.payload);assert(displayed);assert.deepEqual(canonical(displayed.state),canonical(value.state));
  assert.deepEqual(wire(displayed.runtime),wire(value.runtime));
  if(!message.payload.runtime)assert.equal(displayed.runtime,previous.runtime);
  for(const n of previous.state.nodes)if(!message.payload.nodes?.upsert.some(u=>u.id===n.id)&&displayed.state.nodes.some(u=>u.id===n.id))assert.equal(displayed.state.nodes.find(u=>u.id===n.id),n);
}
assert.equal(revision,1);
assert.equal(applyCanvasDisplayDelta(displayed,message.payload),undefined,'duplicate/base mismatch rejected');
const ack = publisher.publish(value,'frame-1',false,{nodes:['b']});assert.equal(ack.type,'host/stateDelta');assert(!ack.payload.nodes);assert.deepEqual(ack.payload.layoutAck,{nodes:['b']});
message=publisher.publish(value,'frame-2',false);assert.equal(message.type,'host/stateUpdated');
publisher.invalidate('frame-1');assert.equal(publisher.publish(value,'frame-2',false),undefined,'old frame failure cannot invalidate new frame');
publisher.invalidate('frame-2');assert.equal(publisher.publish(value,'frame-2',false).type,'host/stateUpdated');
assert.equal(publisher.publish(value,'frame-2',true).type,'host/stateUpdated');
// Long deterministic mutation sequence, including in-place edits and replacement/deletion.
const randomPublisher=new CanvasDisplayPublisher();value=initial();displayed=wire(randomPublisher.publish(value,'random',true).payload);
for(let i=0;i<1000;i++) {
  const id='n'+i%17;const found=value.state.nodes.find(n=>n.id===id);
  if(i%11===0)value.state.nodes=value.state.nodes.filter(n=>n.id!==id);
  else if(found){found.title='title-'+i;found.metadata.agent.outputSequence=i;}
  else value.state.nodes.push(node(id));
  const m=randomPublisher.publish(value,'random',false);if(m)displayed=applyCanvasDisplayDelta(displayed,wire(m.payload));
  assert.deepEqual(canonical(displayed.state),canonical(value.state));
}
console.log('PASS canvas display: atomic operations, omission, optional removal, ordering, identities, lifecycle failure, 1000-update equivalence');
// Same 2,000 observation windows per mode. This measures transport preparation, serialization and reducer only.
const results=[];
for(const count of [1,2,8])for(const mode of ['full','skip','delta']) {
  const p=new CanvasDisplayPublisher();const payload=initial();payload.state.nodes=Array.from({length:count},(_,i)=>node('n'+i));
  let receiver;let messages=0,bytes=0,prepareMs=0,serializeMs=0,applyMs=0;
  for(let i=0;i<2000;i++) {
    payload.state.updatedAt=String(i);for(const n of payload.state.nodes)n.metadata.agent.outputSequence=i;
    if(i%5===0)payload.state.nodes[i/5%count|0].title='update-'+i;
    let start=performance.now();let m;
    if(mode==='full')m={type:'host/stateUpdated',payload:{...payload,state:{...payload.state,nodes:payload.state.nodes.map(n=>({...n,metadata:{...n.metadata,agent:{...n.metadata.agent,serializedTerminalState:undefined,terminalStream:undefined}}}))},revision:i+1}};
    else {m=p.publish(payload,'bench',false);if(mode==='skip'&&m?.type==='host/stateDelta')m={type:'host/stateUpdated',payload:{...payload,state:projectCanvasDisplayState(payload.state),revision:m.payload.revision}};}
    prepareMs+=performance.now()-start;if(!m)continue;
    start=performance.now();const json=JSON.stringify(m);bytes+=Buffer.byteLength(json);serializeMs+=performance.now()-start;
    start=performance.now();const received=JSON.parse(json);receiver=received.type==='host/stateUpdated'?received.payload:applyCanvasDisplayDelta(receiver,received.payload);applyMs+=performance.now()-start;
    assert(receiver);messages++;
  }
  results.push({count,mode,windows:2000,messages,bytes,prepareMs,serializeMs,applyMs});
}
await writeFile(path.join(output,'transport-benchmark.json'),JSON.stringify({scope:'Node transport microbenchmark; excludes actual Host construction, React rendering and echo. Not end-to-end evidence.',results},null,2));
console.table(results);
