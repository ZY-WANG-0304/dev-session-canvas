from pathlib import Path
import hashlib,json
root=Path.cwd()
supervisor=root/'extensions/vscode/dev-session-canvas/src/supervisor/runtimeSupervisorMain.ts'
smoke=root/'tests/vscode-smoke/extension-tests.cjs'
inputs={str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in [supervisor,smoke]}
s=supervisor.read_text()
helper=r"""
function dscAdmissionProbe(stage: string, detail: unknown): void {
  const target = process.env.DSC_PACKAGED_ADMISSION_TRACE;
  if (target) fs.appendFileSync(target, JSON.stringify({ at: new Date().toISOString(), stage, detail }) + '\n');
}
"""
s=s.replace("import * as path from 'path';", "import * as path from 'path';"+helper)
s=s.replace("      this.assertOwnedAdmissionOpen();\n      if (owner?.admissionLimits.executions === null)", """      dscAdmissionProbe('create-admission', {sessionId,kind:params.kind,owner:owner?.snapshot(),authority:owner?.authority.snapshot(),sessions:[...this.sessions.values()].map(v=>({id:v.sessionId,kind:v.kind,live:v.live,retiring:v.retiring,owned:v.ownedExecution?.snapshot().retired,pending:v.ownedExecution?.snapshot().admissionPending}))});
      this.assertOwnedAdmissionOpen();
      if (owner?.admissionLimits.executions === null)""")
s=s.replace("        })) throw new Error('Execution start was rejected-before-acquire.');", """        })) {dscAdmissionProbe('capacity-rejected',{sessionId,kind:params.kind,limits:owner.admissionLimits,owned,retainedRetirements}); throw new Error('Execution start was rejected-before-acquire.');}""")
s=s.replace("        const started = await starting.first;", "        const started = await starting.first;\n        dscAdmissionProbe('start-result', {sessionId,kind:params.kind,started,authority:owner?.authority.snapshot()});")
s=s.replace("    const ownedSession = this.sessions.get(params.sessionId);", "    dscAdmissionProbe('stop-request', {sessionId:params.sessionId});\n    const ownedSession = this.sessions.get(params.sessionId);")
s=s.replace("    const session = this.requireSession(params.sessionId, true);\n    this.assertOwnedAdmissionOpen(session);", "    dscAdmissionProbe('delete-request', {sessionId:params.sessionId,preserveTerminalReads:params.preserveTerminalReads});\n    const session = this.requireSession(params.sessionId, true);\n    this.assertOwnedAdmissionOpen(session);")
s=s.replace("    const deferDisposal = this.ownerBoundaryEnabled() && Boolean(session.ownedExecution);", """    dscAdmissionProbe('remove-begin',{sessionId:session.sessionId,kind:session.kind});
    const dscControlPath=process.env.DSC_PACKAGED_ADMISSION_TRACE!+'.control';
    const dscControl=fs.existsSync(dscControlPath)?JSON.parse(fs.readFileSync(dscControlPath,'utf8')):undefined;
    if (dscControl?.ids.includes(session.sessionId) && dscControl.mode === 'hold-deletion') {
      const deadline = Date.now()+8000;
      while (!fs.existsSync(process.env.DSC_PACKAGED_ADMISSION_TRACE!+'.release') && Date.now()<deadline) await new Promise(resolve=>setTimeout(resolve,10));
    }
    if (dscControl?.ids.includes(session.sessionId) && dscControl.mode === 'wait-retirement') await new Promise(resolve=>setTimeout(resolve,500));
    const deferDisposal = this.ownerBoundaryEnabled() && Boolean(session.ownedExecution);""")
s=s.replace("    this.sessions.delete(session.sessionId);\n    this.schedulePersist();", "    this.sessions.delete(session.sessionId);\n    dscAdmissionProbe('remove-finished',{sessionId:session.sessionId,kind:session.kind});\n    this.schedulePersist();")
supervisor.write_text(s)
s=smoke.read_text()
start=s.index('async function verifyLiveRuntimePersistence('); end=s.index('\nasync function ',start+1)
part=s[start:end]
part=part.replace("    await ensureAgentStopped(agentNodeId);", """    const dscBefore = await getDebugSnapshot();
    const dscOriginal = ['agent','terminal'].map(kind=>dscBefore.state.nodes.find(n=>n.id===(kind==='agent'?agentNodeId:terminalNodeId)).metadata[kind].runtimeSessionId);
    if(process.env.DSC_PACKAGED_CONTROL!=='natural') await fs.writeFile(process.env.DSC_PACKAGED_ADMISSION_TRACE+'.control',JSON.stringify({mode:process.env.DSC_PACKAGED_CONTROL,ids:dscOriginal}));
    console.log('[packaged-admission] '+JSON.stringify({stage:'before-stop',ids:dscOriginal}));
    await ensureAgentStopped(agentNodeId);""",1)
part=part.replace("    await ensureTerminalStopped(terminalNodeId);", r"""    await ensureTerminalStopped(terminalNodeId);
    console.log('[packaged-admission] '+JSON.stringify({stage:'stop-helper-returned',ids:dscOriginal,snapshot:await getDebugSnapshot()}));
    if (process.env.DSC_PACKAGED_CONTROL === 'wait-retirement') {
      const deadline=Date.now()+10000;
      let retired=false;
      while(Date.now()<deadline){
        const events=(await fs.readFile(process.env.DSC_PACKAGED_ADMISSION_TRACE,'utf8')).trim().split('\n').map(line=>JSON.parse(line));
        retired=dscOriginal.every(id=>events.some(e=>e.stage==='remove-finished'&&e.detail.sessionId===id));
        if(retired)break; await sleep(10);
      }
      assert.ok(retired,'Both original Supervisor sessions must be actually removed');
      console.log('[packaged-admission] '+JSON.stringify({stage:'both-retired',ids:dscOriginal}));
    }""",1)
part=part.replace("    await waitForRuntimeExecutionStarted('agent', agentNodeId);", r"""    if(process.env.DSC_PACKAGED_CONTROL==='hold-deletion') {
      const deadline=Date.now()+5000;let rejected=false;
      while(Date.now()<deadline){
        const events=(await fs.readFile(process.env.DSC_PACKAGED_ADMISSION_TRACE,'utf8')).trim().split('\n').map(line=>JSON.parse(line));
        rejected=events.some(e=>e.stage==='capacity-rejected');if(rejected)break;await sleep(10);
      }
      await fs.writeFile(process.env.DSC_PACKAGED_ADMISSION_TRACE+'.release','released');
      assert.ok(rejected,'Original create must be observed before releasing retained deletion');
    }
    await waitForRuntimeExecutionStarted('agent', agentNodeId);""",1)
s=s[:start]+part+s[end:];smoke.write_text(s)
Path('packaged-admission-probe-input.json').write_text(json.dumps({'base':'f8d9ad5341f8a20a7cbd97fda6beb01e71937ddc','before_sha256':inputs,'after_sha256':{str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in [supervisor,smoke]}},indent=2)+'\n')
