// Investigation only: Node 22 + xvfb + packaged smoke-host; modes original, probed, probed2, serial, serial2, serial-clean.
// Each run gets a fresh directory; exit 0 can mean an expected failure was captured, not a smoke pass.
import assert from 'node:assert/strict';
import {cp,mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {runVSCodeScenario} from '../../../scripts/smoke/vscode-smoke-runner.mjs';
const mode=process.argv[2]??'original';
assert.ok(['original','probed','probed2','serial','serial2','serial-clean'].includes(mode));
const root=path.resolve('.debug/runtime-immediate-reload',mode+'-'+Date.now()),host=path.join(root,'host');
await mkdir(root,{recursive:true});
await cp('.debug/vscode-vsix-smoke/smoke-host',host,{recursive:true});
const hashes={};
for(const f of ['extension.js','runtime-supervisor.js','webview.js']) hashes[f]=createHash('sha256').update(await readFile(path.join(host,'dist',f))).digest('hex');
await writeFile(path.join(root,'hashes.json'),JSON.stringify(hashes,null,2));
if(mode!=='original' && mode!=='serial-clean') {
 let s=await readFile(path.join(host,'dist/extension.js'),'utf8');
 function replace(a,b){assert.equal(s.split(a).length,2,a);s=s.replace(a,b)}
 replace('async prepareForHostBoundaryCore(e){','async prepareForHostBoundaryCore(e){this.recordDiagnosticEvent("rca/boundaryBegin",{options:e,pending:this.pendingRuntimeSupervisorStateCallbacks?.size??0,operations:this.pendingRuntimeSupervisorOperations.size});');
 replace('trackRuntimeSupervisorStateCallback(e){let n=', 'trackRuntimeSupervisorStateCallback(e){const rid=this.__rcaId=(this.__rcaId??0)+1;this.recordDiagnosticEvent("rca/callbackBegin",{id:rid,stack:new Error().stack});e.then(()=>this.recordDiagnosticEvent("rca/callbackEnd",{id:rid}),()=>this.recordDiagnosticEvent("rca/callbackEnd",{id:rid}));let n=');
 replace('async waitForPendingRuntimeSupervisorStateCallbacks(){','async waitForPendingRuntimeSupervisorStateCallbacks(){this.recordDiagnosticEvent("rca/waitCallbacks",{pending:this.pendingRuntimeSupervisorStateCallbacks?.size??0});');
 replace('assertRuntimeSupervisorStateCallbacksSettled(){','assertRuntimeSupervisorStateCallbacksSettled(){this.recordDiagnosticEvent("rca/assertCallbacks",{pending:this.pendingRuntimeSupervisorStateCallbacks?.size??0,stack:new Error().stack});');
 replace('async handleRuntimeSupervisorTerminalBatch(e,n,i,r){','async handleRuntimeSupervisorTerminalBatch(e,n,i,r){this.recordDiagnosticEvent("rca/batch",{kind:i.kind,sessionId:i.sessionId,batchId:i.batchId,revision:i.revision});');
 replace('async handleRuntimeSupervisorState(e,n,i){','async handleRuntimeSupervisorState(e,n,i){this.recordDiagnosticEvent("rca/state",{kind:i.kind,sessionId:i.sessionId,live:i.live,lifecycle:i.lifecycle});');
 await writeFile(path.join(host,'dist/extension.js'),s);
}
const suitePath=path.join(host,'tests/vscode-smoke/extension-tests.cjs');
let suite=await readFile(suitePath,'utf8');
const anchor="  if (smokeScenario === 'local-execution-flow') {";
suite=suite.replace(anchor,`  if (process.env.DSC_IMMEDIATE_RCA) {
 const {agentNode,terminalNode}=await prepareTrustedBaseNodesForAppliedRuntimePersistenceMode(true);
 try { await verifyImmediateReloadAfterLiveRuntimeLaunch(agentNode.id,terminalNode.id); console.log('Immediate reload original assertions PASSED'); }
 catch(error) { await fs.writeFile(path.join(artifactDir,'rca-error.json'),JSON.stringify({message:error.message,stack:error.stack,snapshot:await getDebugSnapshot()},null,2)); console.log('Immediate reload result: '+error.message); }
 await fs.writeFile(path.join(artifactDir,'rca-events.json'),JSON.stringify(await getDiagnosticEvents(),null,2));
 for (const node of (await getDebugSnapshot()).state.nodes) {if(node.kind==='agent') await ensureAgentStopped(node.id);else if(node.kind==='terminal') await ensureTerminalStopped(node.id);}
 return;
 }
`+anchor);
let start=suite.indexOf('async function verifyImmediateReloadAfterLiveRuntimeLaunch('),end=suite.indexOf('\nasync function ',start+10),fn=suite.slice(start,end);
if(mode.startsWith('serial')) {
 fn=fn.replace("    await dispatchWebviewMessage({\n      type: 'webview/startExecutionSession',\n      payload: {\n        nodeId: terminalNodeId,", "    await waitForRuntimeExecutionStarted('agent', agentNodeId);\n    await dispatchWebviewMessage({\n      type: 'webview/startExecutionSession',\n      payload: {\n        nodeId: terminalNodeId,");
 if(mode==='serial-clean'||mode==='serial-both') fn=fn.replace('    let snapshot = await simulateRuntimeReload();',"    await waitForRuntimeExecutionStarted('terminal', terminalNodeId);\n    let snapshot = await simulateRuntimeReload();");
}
fn=fn.replace('  } finally {\n    await setRuntimePersistenceEnabled(false);',`  } finally {
    await fs.writeFile(path.join(artifactDir,'rca-before-finally.json'),JSON.stringify({snapshot:await getDebugSnapshot(),events:await getDiagnosticEvents()},null,2));
    await setRuntimePersistenceEnabled(false);`);
suite=suite.slice(0,start)+fn+suite.slice(end);
await writeFile(suitePath,suite);
await runVSCodeScenario({projectRoot:process.cwd(),debugRoot:path.join(root,'native'),runtimeDirName:'dsc-immediate-'+mode,workspacePath:process.cwd(),extensionDevelopmentPath:[host,path.join(host,'notifier-extension')],extensionTestsPath:suitePath,disableWorkspaceTrust:true,extensionTestsEnv:{DEV_SESSION_CANVAS_SMOKE_TEST_MODE:'1',DEV_SESSION_CANVAS_SMOKE_SCENARIO:'local-links-and-stop',DSC_IMMEDIATE_RCA:'1',DEV_SESSION_CANVAS_TEST_CODEX_COMMAND:path.resolve('tests/vscode-smoke/fixtures/fake-agent-provider'),DEV_SESSION_CANVAS_TEST_CLAUDE_COMMAND:path.resolve('tests/vscode-smoke/fixtures/missing-agent-provider')}});
