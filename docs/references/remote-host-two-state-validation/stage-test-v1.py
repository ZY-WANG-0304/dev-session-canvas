from pathlib import Path
import sys
source=Path(sys.argv[1]); helper=Path('/tmp/dscssh2-evidence/lab-helpers.cjs')
s=source.read_text()
s=s.replace("const vscode = require('vscode');", "const vscode = require('vscode');\nconst lab = require('./lab-helpers.cjs');\nconst { waitForTerminalResize } = require('./terminal-resize.cjs');")
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
