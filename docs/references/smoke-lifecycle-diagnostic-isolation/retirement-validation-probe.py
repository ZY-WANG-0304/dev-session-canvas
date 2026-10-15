from pathlib import Path
import hashlib,json,subprocess
root=Path.cwd()
supervisor=root/'extensions/vscode/dev-session-canvas/src/supervisor/runtimeSupervisorMain.ts'
smoke=root/'tests/vscode-smoke/extension-tests.cjs'
inputs={str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in [supervisor,smoke,root/'tests/vscode-smoke/runtime-retirement.cjs']}
s=supervisor.read_text()
def replace_once(s,old,new):
    assert s.count(old)==1,(old,s.count(old))
    return s.replace(old,new,1)
helper=r"""
function dscRetirementProbe(stage: string, detail: unknown): void {
  const target = process.env.DSC_RETIREMENT_TRACE;
  if (target) fs.appendFileSync(target, JSON.stringify({ at: new Date().toISOString(), stage, detail }) + '\n');
}
"""
s=replace_once(s,"import * as path from 'path';", "import * as path from 'path';"+helper)
s=replace_once(s,"      this.assertOwnedAdmissionOpen();\n      if (owner?.admissionLimits.executions === null)","      dscRetirementProbe('create-admission', {sessionId,kind:params.kind,sessions:[...this.sessions.values()].map(v=>({id:v.sessionId,retiring:v.retiring,live:v.live}))});\n      this.assertOwnedAdmissionOpen();\n      if (owner?.admissionLimits.executions === null)")
s=replace_once(s,"          const session = this.sessions.get(sessionId);\n          if (session && session.kind !== kind)","          const session = this.sessions.get(sessionId);\n          dscRetirementProbe('retirement-query',{sessionId,kind,exists:session !== undefined,retiring:session?.retiring});\n          if (session && session.kind !== kind)")
s=replace_once(s,"    const ownedSession = this.sessions.get(params.sessionId);","    dscRetirementProbe('stop-request',{sessionId:params.sessionId});\n    const ownedSession = this.sessions.get(params.sessionId);")
s=replace_once(s,"    const deferDisposal = this.ownerBoundaryEnabled() && Boolean(session.ownedExecution);",r"""    dscRetirementProbe('remove-begin',{sessionId:session.sessionId,kind:session.kind});
    const dscControlPath=process.env.DSC_RETIREMENT_TRACE!+'.control';
    const dscControl=fs.existsSync(dscControlPath)?JSON.parse(fs.readFileSync(dscControlPath,'utf8')):undefined;
    if(dscControl?.ids.includes(session.sessionId)) {
      dscRetirementProbe('bounded-delete-delay',{sessionId:session.sessionId,delayMs:500});
      await new Promise(resolve=>setTimeout(resolve,500));
    }
    const deferDisposal = this.ownerBoundaryEnabled() && Boolean(session.ownedExecution);""")
s=replace_once(s,"    this.sessions.delete(session.sessionId);\n    this.schedulePersist();","    this.sessions.delete(session.sessionId);\n    dscRetirementProbe('remove-finished',{sessionId:session.sessionId,kind:session.kind});\n    this.schedulePersist();")
supervisor.write_text(s)
s=smoke.read_text();start=s.index('async function verifyLiveRuntimePersistence(');end=s.index('\nasync function ',start+1);part=s[start:end]
part=replace_once(part,"    const original = await getDebugSnapshot();",r"""    const original = await getDebugSnapshot();
    const dscOriginal=['agent','terminal'].map(kind=>original.state.nodes.find(n=>n.id===(kind==='agent'?agentNodeId:terminalNodeId)).metadata[kind].runtimeSessionId);
    await fs.writeFile(process.env.DSC_RETIREMENT_TRACE+'.control',JSON.stringify({ids:dscOriginal}));
    const dscBefore=Date.now();
    console.log('[retirement-validation] '+JSON.stringify({stage:'before-stop',ids:dscOriginal,at:new Date().toISOString()}));""")
part=replace_once(part,"      getRuntimeSupervisorState\n    });","      getRuntimeSupervisorState\n    });\n    console.log('[retirement-validation] '+JSON.stringify({stage:'original-helper-returned',ids:dscOriginal,elapsedMs:Date.now()-dscBefore,at:new Date().toISOString()}));")
s=s[:start]+part+s[end:];smoke.write_text(s)
Path('retirement-probe-input.json').write_text(json.dumps({'input':subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),'before_sha256':inputs,'after_sha256':{str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in [supervisor,smoke,root/'tests/vscode-smoke/runtime-retirement.cjs']},'delayMs':500,'scope':'only two captured original sessions; formal helper unmodified'},indent=2)+'\n')
