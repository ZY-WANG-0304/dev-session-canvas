import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import esbuild from 'esbuild';
import ts from 'typescript';
const directory=await mkdtemp(path.join(os.tmpdir(),'dsc-legacy-binding-'));
const evidence=[];
let listener,server,client;
const sockets=new Set();
try {
  const outfile=path.join(directory,'runtime.cjs');
  await esbuild.build({stdin:{contents:`
    export {RuntimeSupervisorServer} from './extensions/vscode/dev-session-canvas/src/supervisor/runtimeSupervisorMain';
    export {RuntimeSupervisorClient} from './extensions/vscode/dev-session-canvas/src/panel/runtimeSupervisorClient';
    export {TerminalSessionJournal} from './extensions/vscode/dev-session-canvas/src/supervisor/terminalSessionJournal';
    export {SerializedTerminalStateTracker,SERIALIZED_TERMINAL_CHECKPOINT_PROFILES} from './extensions/vscode/dev-session-canvas/src/common/serializedTerminalState';`,resolveDir:process.cwd(),loader:'ts'},
    outfile,bundle:true,platform:'node',format:'cjs',target:'node18',external:['node-pty']});
  const require=createRequire(import.meta.url);
  const modules=require(outfile);
  const {Harness,ExecutionTerminalLineContextTracker}=await loadHost(directory);
  const paths={storageDir:directory,socketPath:path.join(directory,'runtime.sock'),registryPath:path.join(directory,'registry.json'),socketLocation:'storage'};
  server=new modules.RuntimeSupervisorServer(paths,'legacy-detached','best-effort');
  server.schedulePersist=()=>{};server.scheduleIdleShutdownIfNeeded=()=>{};
  listener=net.createServer(socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));server.acceptSocket(socket);});
  await new Promise((resolve,reject)=>{listener.once('error',reject);listener.listen(paths.socketPath,resolve);});
  const backend={kind:'legacy-detached',guarantee:'best-effort',label:'Controlled original runtime',paths,startSupervisor:async()=>assert.fail('No external process may start')};
  for(const rebind of [false,true]) {
    const sessionId=rebind?'same-binding-reinstalled':'binding-stable';
    const journal=await modules.TerminalSessionJournal.create({storageDir:directory,sessionId,initialCols:80,initialRows:24,initialScrollback:1000,eventCacheMaxBytes:0,checkpointProfiles:modules.SERIALIZED_TERMINAL_CHECKPOINT_PROFILES});
    const tracker=new modules.SerializedTerminalStateTracker(80,24,{scrollback:1000,initialOutputSequence:0});
    let onData,onExit;
    const runtime={sessionId,kind:'terminal',live:true,lifecycle:'live',launchMode:'start',displayLabel:sessionId,runtimeBackend:'legacy-detached',runtimeGuarantee:'best-effort',shellPath:'/controlled-shell',cwd:directory,cols:80,rows:24,scrollback:1000,output:'',outputSequence:0,startedAtMs:Date.now(),terminalAuthorityId:journal.getAuthorityId(),terminalJournal:journal,terminalStateTracker:tracker,terminalOperationChain:Promise.resolve(),terminalMutationAdmissionOpen:true,terminalCheckpoint:{version:1,sessionId,authorityId:journal.getAuthorityId(),revision:0,cols:80,rows:24,scrollback:1000,createdAtMs:Date.now(),serializedState:tracker.getSerializedState()},process:{write:()=>{},resize:()=>{},onData:fn=>{onData=fn;return {dispose(){}}},onExit:fn=>{onExit=fn;return {dispose(){}}},kill:()=>onExit({exitCode:0,signal:"SIGHUP"})}};
    server.sessions.set(sessionId,runtime);server.bindSessionProcess(runtime);
    const host=new Harness();const diagnostics=[];const outcomes=[];
    const line=new ExecutionTerminalLineContextTracker(80,24,{cwd:directory,pathStyle:'posix',scrollback:1000});
    const managed={owner:'supervisor',sessionId,runtimeSessionId:sessionId,runtimeBackend:'legacy-detached',runtimeStoragePath:directory,terminalStreamPaged:true,terminalStreamHealthy:true,terminalAuthorityId:journal.getAuthorityId(),outputSequence:0,terminalProjectionMode:'terminal-stream-v1',terminalStateTrusted:false,cols:80,rows:24,buffer:'',pendingOutput:'',lifecycleStatus:'live',lineContextTracker:line};
    const sessions=new Map([['node',managed]]);host.state={};host.runtimeSessionBindings=new Map();host.resolveRuntimeStoragePath=p=>p;host.buildRuntimeSessionBindingKey=(...parts)=>JSON.stringify(parts);host.getExecutionSessions=()=>sessions;
    host.bindRuntimeSession('node','terminal',sessionId,directory,'legacy-detached');
    const key=host.buildRuntimeSessionBindingKey('terminal',sessionId,directory,'legacy-detached');
    const originalBinding=host.runtimeSessionBindings.get(key);
    host.requireNode=()=>({status:'live',summary:''});
    for(const name of ['postState','postMessage','recordExecutionPerformanceDiagnostics','queueExecutionStateSync','clearExecutionTerminalProjectionRefreshTimers','flushExecutionOutputImmediately','reconnectPagedRuntimeSession'])host[name]=()=>{};
    host.recordDiagnosticEvent=(name,detail)=>diagnostics.push({name,detail});host.bridgeExecutionAttentionSignals=async()=>{};
    let projectedLive=true;
    host.applyRuntimeSupervisorSnapshot=async(_id,_kind,snapshot)=>{projectedLive=snapshot.live;managed.lifecycleStatus=snapshot.lifecycle;if(!snapshot.live){sessions.delete('node');host.runtimeSessionBindings.delete(key);}};
    host.postExecutionExitWithFinalSnapshot=async()=>{};
    client=new modules.RuntimeSupervisorClient({backend,supervisorScriptPath:'unused',onSessionTerminalBatch:async(batch,current)=>{const outcome=await host.handleRuntimeSupervisorTerminalBatch('legacy-detached',directory,batch,current);outcomes.push({batchId:batch.batchId,revision:batch.revision,live:batch.snapshot?.live,outcome});return outcome;}});
    await client.ensureConnected({allowRestart:false});
    await client.subscribeSession({sessionId,authorityId:journal.getAuthorityId(),afterRevision:0,terminalStreamMode:'paged-until-exit',hostOutputCredit:'journal-pages-v1'});
    await until(()=>outcomes.length===1&&!flow(server,sessionId)?.inFlight,'initial subscription consumed');
    let held;let reached;
    const ready=new Promise(resolve=>reached=resolve);
    const write=line.terminal.write.bind(line.terminal);
    line.terminal.write=(text,done)=>write(text,()=>{if(!held){held=done;reached();}else done?.();});
    onData('ORIGINAL-BINDING-OUTPUT\r\n');
    await runtime.terminalOperationChain;
    await ready;
    if(rebind)host.bindRuntimeSession('node','terminal',sessionId,directory,'legacy-detached');
    const replacementBinding=host.runtimeSessionBindings.get(key);
    const bindingReferenceChanged=replacementBinding!==originalBinding;
    const bindingIdentityUnchanged=JSON.stringify(replacementBinding)===JSON.stringify(originalBinding);
    assert.equal(bindingIdentityUnchanged,true);
    held();
    await until(()=>outcomes.length===2,'original batch settled');
    if(rebind) await until(()=>!flow(server,sessionId),'cancelled subscription removed');
    else await until(()=>!flow(server,sessionId)?.inFlight,'stable batch acknowledged');
    const subscriptionExistsBeforeStop=Boolean(flow(server,sessionId));
    managed.stopRequested=true;managed.lifecycleStatus='stopping';
    await client.stopSession({sessionId});
    await until(()=>runtime.live===false,'confirmed controlled process exit');
    await runtime.finalizationPromise;
    if(!rebind) {await until(()=>projectedLive===false,'stable Host received terminal state');await until(()=>!flow(server,sessionId),'final state acknowledged');}
    else {await new Promise(resolve=>setTimeout(resolve,100));assert.equal(projectedLive,true);assert.equal(managed.lifecycleStatus,'stopping');assert.equal(runtime.live,false);}
    assert.equal(bindingReferenceChanged,rebind);
    assert.equal(outcomes[1].outcome,rebind?'cancelled':'consumed');
    assert.equal(subscriptionExistsBeforeStop,!rebind);
    const record={rebind,bindingReferenceChanged,bindingIdentityUnchanged,subscriptionExistsBeforeStop,supervisorLive:runtime.live,hostLive:projectedLive,hostLifecycle:managed.lifecycleStatus,outcomes,errors:diagnostics.filter(e=>e.name==='runtime/hostOutputConsumptionFailed')};
    assert.equal(record.errors.length,0);
    if(rebind){
      await client.subscribeSession({sessionId,authorityId:journal.getAuthorityId(),afterRevision:managed.outputSequence,terminalStreamMode:'paged-until-exit',hostOutputCredit:'journal-pages-v1'});
      await until(()=>projectedLive===false,'explicit original cursor resubscription recovers completion');
      await until(()=>!flow(server,sessionId),'recovered final batch acknowledged');
      record.recovery={explicitResubscribe:true,hostLive:projectedLive,hostLifecycle:managed.lifecycleStatus};
    }
    evidence.push(record);
    client.dispose();client=undefined;line.dispose();tracker.dispose();
    console.log(JSON.stringify(record));
  }
  await writeFile('/dev/shm/dsc-lifecycle-fix-evidence/legacy-stop-binding-control-result.json',JSON.stringify({diagnosticOnly:true,controlledProcessExit:true,realSocket:true,realHostBatchAndBindingMethods:true,sourceInput:'55c619ad70dbec74a7f9ffab17bf3dc547bd6913',historicalFailureAttributed:false,cases:evidence},null,2)+'\n');
} finally {client?.dispose();for(const socket of sockets)socket.destroy();if(listener)await new Promise(resolve=>listener.close(resolve));await rm(directory,{recursive:true,force:true});}
function flow(server,id){for(const entries of server.hostOutputSubscriptions.values())if(entries.has(id))return entries.get(id);}
async function until(test,label){const deadline=Date.now()+5000;while(!test()){assert.ok(Date.now()<deadline,label);await new Promise(resolve=>setTimeout(resolve,5));}}
async function loadHost(directory) {
  const filename = path.resolve('extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts');
  const source = await readFile(filename, 'utf8');
  const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const manager = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'CanvasPanelManager');
  const methodNames = ['handleRuntimeSupervisorTerminalBatch', 'handleRuntimeSupervisorTerminalEvent',
    'applyRuntimeSupervisorOutputChunk', 'handleRuntimeSupervisorState', 'queueExecutionOutput',
    'postTerminalAvailable', 'isRuntimeSupervisorEventAdmitted', 'bindRuntimeSession'];
  const methods = methodNames.map(name => {
    const method = manager.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(ast) === name);
    assert.ok(method, `actual Host method ${name} must exist`);
    return method.getText(ast);
  });
  const functions = ['updateExecutionTerminalTitle', 'appendTerminalBuffer', 'trimStoredTerminalText'].map(name => {
    const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
    assert.ok(declaration, `actual Host function ${name} must exist`);
    return declaration.getText(ast);
  });
  const outfile = path.join(directory, 'actual-host-terminal-batch.cjs');
  await esbuild.build({ stdin: { contents: `
    import { cloneTerminalStreamEvent } from './common/terminalSessionStream';
    import { formatExecutionTerminalTitleReport, normalizeExecutionTerminalTitle,
      processExecutionTerminalTitleControls, stripExecutionTerminalTitleMarkers } from './common/executionTerminalTitle';
    import { ExecutionTerminalLineContextTracker } from './panel/executionTerminalLineContextTracker';
    const formatUnknownError = error => String(error);
    const EXECUTION_OUTPUT_STATE_SYNC_INTERVAL_MS = 1;
    const localizeRuntimeSupervisorSnapshotExitMessage = snapshot => snapshot.lastExitMessage;
    const normalizeRuntimeHostBackendKind = kind => kind;
    const vscode = { l10n: { t: value => value } };
    const updateExecutionNode = (state, nodeId, kind, patch) => ({ ...state, ...patch });
    const buildExecutionMetadataPatch = (state, nodeId, kind, patch) => patch;
    ${functions.join('\n')}
    class Harness {
      runtimeSupervisorEventAdmissionOpen = true;
      runtimeSupervisorClientEpochs = new Map();
      ${methods.join('\n')}
    }
    export { Harness, ExecutionTerminalLineContextTracker };
  `, resolveDir: path.dirname(path.dirname(filename)), loader: 'ts' }, outfile, bundle: true,
    platform: 'node', format: 'cjs', target: 'node18' });
  const require = createRequire(import.meta.url);
  const { Harness, ExecutionTerminalLineContextTracker } = require(outfile);
  return { Harness, ExecutionTerminalLineContextTracker };
}
