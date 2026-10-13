from pathlib import Path
import sys
source=Path(sys.argv[1]); helper=Path('/tmp/dscssh2-evidence/lab-helpers.cjs')
s=source.read_text()
s=s.replace("const vscode = require('vscode');", "const vscode = require('vscode');\nconst lab = require('./lab-helpers.cjs');\nconst { terminalMatchesContainer, waitForTerminalResize } = require('./terminal-resize.cjs');")
s=s.replace('`while kill -0 ${process.pid} 2>/dev/null; do sleep 0.1; done; `', '`while [ ! -f ${lab.shellQuote(path.join(artifactDir, "complete-terminal.flag"))} ]; do sleep 0.1; done; `')
n="      console.log('[real-reopen] phase=setup ready-for-exit');"
r="""      const labRuntime = await getRuntimeSupervisorState();
      const labSupervisor = labRuntime.observedRootSupervisorProcesses.find(p=>p.rootPath === vscode.workspace.workspaceFolders[0].uri.fsPath);
      assert.ok(labSupervisor?.pid,'No actual Supervisor PID');
      const setupState = JSON.parse(await fs.readFile(stateFile,'utf8'));
      setupState.setupHost = await lab.processIdentity(process.pid);
      setupState.supervisor = await lab.processIdentity(labSupervisor.pid);
      setupState.setupRuntime = labRuntime;
      await fs.writeFile(stateFile,JSON.stringify(setupState,null,2));
      await fs.writeFile(path.join(artifactDir,'lab-setup-ready.json'),JSON.stringify({host:setupState.setupHost,supervisor:setupState.supervisor}));
      console.log('[real-reopen] phase=setup ready-for-exit');"""
assert s.count(n)==1;s=s.replace(n,r)
n='  const expected = JSON.parse(await fs.readFile(stateFile, \'utf8\'));'
r=n+"""
  const labControl = JSON.parse(await fs.readFile(path.join(artifactDir,'lab-host-control.json'),'utf8'));
  const labEvidence = {scenario:labControl.scenario,setupHost:expected.setupHost,verifyHost:await lab.processIdentity(process.pid),supervisor:expected.supervisor,phases:[]};
  labEvidence.phases.push({stage:'verify-ready',host:await lab.hostCondition(expected.setupHost,labControl.scenario),supervisor:await lab.sameLiveProcess(expected.supervisor)});
  if(labControl.scenario==='exit') assert.notStrictEqual(process.pid,expected.setupHost.pid,'Exited Host was reused');
"""
assert s.count(n)==1;s=s.replace(n,r)
n="  await vscode.commands.executeCommand(COMMAND_IDS.testResetState);\n  await waitForRuntimeSupervisorSettled(0, 20000);\n  await setRuntimePersistenceEnabled(false);"
r="""  const labTargets = [
    {nodeId:agentDisplayNodeId,kind:'agent',sessionId:expected.agentSessionId,runtimeStoragePath:expected.agentRuntimeStoragePath,size:agentNode.size,visibleMarker:'AFTER_REOPEN_AGENT',markers:[AGENT_REOPEN_OUTPUT,AGENT_POST_REOPEN_OUTPUT]},
    {nodeId:terminalDisplayNodeId,kind:'terminal',sessionId:expected.terminalSessionId,runtimeStoragePath:expected.terminalRuntimeStoragePath,size:terminalNode.size,visibleMarker:TERMINAL_POST_REOPEN_OUTPUT,markers:[TERMINAL_REOPEN_OUTPUT,TERMINAL_POST_REOPEN_OUTPUT]}
  ];
  const labSamples=[];
  const geometry=(targets,before)=>waitForTerminalResize({expectedNodes:targets,before,timeoutMs:20000,getSnapshot:getDebugSnapshot,
    getProbe:remaining=>vscode.commands.executeCommand('devSessionCanvas.__test.captureWebviewProbe','editor',Math.min(5000,remaining),0),
    getSession:(sessionId,remaining)=>lab.request(expected.agentRuntimeStoragePath,'attachSession',{sessionId},remaining),
    onSample:sample=>labSamples.push(sample)});
  const labBefore=await geometry(labTargets);
  const labAfterTargets=labTargets.map((target,i)=>({...target,size:i===0?{width:680,height:520}:{width:700,height:540}}));
  for(const target of labAfterTargets){
    const node=findNodeById(snapshot,target.nodeId);
    await dispatchWebviewMessage({type:'webview/resizeNode',payload:{nodeId:target.nodeId,position:node.position,size:target.size}});
  }
  const labAfter=await geometry(labAfterTargets,labBefore);
  labEvidence.resize={baseline:labBefore.probe.nodes.filter(n=>labTargets.some(t=>t.nodeId===n.nodeId)),resized:labAfter.probe.nodes.filter(n=>labTargets.some(t=>t.nodeId===n.nodeId)),samples:labSamples};
  const stability={durationMs:3000,samples:[],pass:false};
  const stabilityStarted=Date.now();
  try {
    do {
      const currentSnapshot=await getDebugSnapshot();
      const currentProbe=await vscode.commands.executeCommand('devSessionCanvas.__test.captureWebviewProbe','editor',5000,0);
      const currentRuntime=await getRuntimeSupervisorState();
      const registry=currentRuntime.registries['legacy-detached'].registry.sessions;
      const observations=[];
      for(const target of labAfterTargets){
        const host=findNodeById(currentSnapshot,target.nodeId);
        const page=currentProbe.nodes.find(n=>n.nodeId===target.nodeId);
        const session=await lab.request(target.runtimeStoragePath,'attachSession',{sessionId:target.sessionId});
        const metadata=host?.metadata?.[target.kind];
        const finalPage=labAfter.probe.nodes.find(n=>n.nodeId===target.nodeId);
        const persisted=registry.find(n=>n.sessionId===target.sessionId);
        const matches=host?.kind===target.kind && metadata?.runtimeSessionId===target.sessionId &&
          metadata?.runtimeStoragePath===target.runtimeStoragePath && metadata?.liveSession===true &&
          metadata?.attachmentState==='attached-live' && host?.size?.width===target.size.width &&
          host?.size?.height===target.size.height && terminalMatchesContainer(page,target) &&
          page.terminalCols===finalPage.terminalCols && page.terminalRows===finalPage.terminalRows &&
          session.sessionId===target.sessionId && session.kind===target.kind && session.live===true &&
          session.cols===finalPage.terminalCols && session.rows===finalPage.terminalRows;
        observations.push({kind:target.kind,nodeId:target.nodeId,sessionId:session.sessionId,
          page:{cols:page?.terminalCols,rows:page?.terminalRows,fitCols:page?.terminalFitCols,fitRows:page?.terminalFitRows},
          session:{cols:session.cols,rows:session.rows,live:session.live},
          registry:persisted&&{cols:persisted.cols,rows:persisted.rows},matches:Boolean(matches)});
      }
      const sample={elapsedMs:Date.now()-stabilityStarted,observations,
        host:await lab.hostCondition(expected.setupHost,labControl.scenario),supervisor:await lab.sameLiveProcess(expected.supervisor)};
      stability.samples.push(sample);
      assert.ok(observations.every(o=>o.matches),'Resize reverted during strict observation: '+JSON.stringify(sample));
      if(sample.elapsedMs>=stability.durationMs)break;
      await new Promise(resolve=>setTimeout(resolve,250));
    } while(true);
    assert.ok(stability.samples.at(-1).observations.every(o=>o.registry?.cols===o.session.cols&&o.registry?.rows===o.session.rows),'Registry did not catch up during observation');
    stability.pass=true;
  } finally {
    await fs.writeFile(path.join(artifactDir,'lab-resize-stability.json'),JSON.stringify(stability,null,2));
  }
  labEvidence.runtimeBeforeReset=await getRuntimeSupervisorState();
  assertRuntimeSupervisorSessions(labEvidence.runtimeBeforeReset,[{sessionId:expected.agentSessionId,nodeId:agentDisplayNodeId,kind:'agent',runtimeStoragePath:expected.agentRuntimeStoragePath},{sessionId:expected.terminalSessionId,nodeId:terminalDisplayNodeId,kind:'terminal',runtimeStoragePath:expected.terminalRuntimeStoragePath}]);
  labEvidence.phases.push({stage:'business-assertions-complete',host:await lab.hostCondition(expected.setupHost,labControl.scenario),supervisor:await lab.sameLiveProcess(expected.supervisor)});
  labEvidence.pass=true;
  await fs.writeFile(path.join(artifactDir,'lab-business-evidence.json'),JSON.stringify(labEvidence,null,2));
  await vscode.commands.executeCommand(COMMAND_IDS.testResetState);
  await waitForRuntimeSupervisorSettled(0, 20000);
  await setRuntimePersistenceEnabled(false);"""
assert s.count(n)==1;s=s.replace(n,r)
source.write_text(s);(source.parent/'lab-helpers.cjs').write_bytes(helper.read_bytes())
