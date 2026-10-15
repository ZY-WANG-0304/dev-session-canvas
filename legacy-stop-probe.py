from pathlib import Path
import hashlib,json

root=Path('extensions/vscode/dev-session-canvas/src')
changes=[]
def edit(p,old,new):
    text=p.read_text();assert text.count(old)==1,(str(p),old,text.count(old))
    p.write_text(text.replace(old,new));changes.append({'path':str(p),'before':hashlib.sha256(text.encode()).hexdigest(),'after':hashlib.sha256(p.read_bytes()).hexdigest()})

p=root/'supervisor/runtimeSupervisorMain.ts'
trace=r'''
// Temporary finite trace; only used by this fixed-input diagnostic workflow.
if (process.env.DSC_LEGACY_STOP_TRACE) {
  const proto = RuntimeSupervisorServer.prototype as any;
  let count = 0;
  const originals = new Map<string, any>();
  const record = (stage: string, session: any, extra: any = {}) => {
    if (++count > 600) return;
    const executionProcess = session?.process ?? originals.get(session?.sessionId);
    const pid = executionProcess?.pid;
    let proc: any;
    if (pid) {
      try { proc = { stat: fs.readFileSync(`/proc/${pid}/stat`, 'utf8'),
        status: fs.readFileSync(`/proc/${pid}/status`, 'utf8').split('\n').filter(line => /^(Name|State|Pid|PPid|SigPnd|ShdPnd|SigBlk|SigIgn|SigCgt):/.test(line)),
        fd0: fs.readlinkSync(`/proc/${pid}/fd/0`) }; }
      catch (error) { proc = { error: (error as any).code }; }
    }
    const socket = executionProcess?.pty?._socket;
    const event = { at: Date.now(), role: 'supervisor', supervisorPid: process.pid, stage,
      sessionId: session?.sessionId, live: session?.live, lifecycle: session?.lifecycle,
      stopRequested: session?.stopRequested, sequence: session?.outputSequence,
      processPid: pid, proc, processPresent: Boolean(session?.process),
      owned: Boolean(session?.ownedExecution), finalization: Boolean(session?.finalizationPromise),
      pty: socket ? { destroyed: socket.destroyed, readable: socket.readable, fd: socket._handle?.fd } : undefined,
      ...extra };
    try { fs.appendFileSync(process.env.DSC_LEGACY_STOP_TRACE!, JSON.stringify(event)+'\n'); } catch {}
  };
  const bind = proto.bindSessionProcess;
  proto.bindSessionProcess = function(session: any) {
    originals.set(session.sessionId, session.process);
    record('bind-compat-process', session);
    const executionProcess = session.process;
    const kill = executionProcess.kill.bind(executionProcess);
    executionProcess.kill = () => { record('pty-kill-enter', session); const value = kill(); record('pty-kill-returned', session); return value; };
    const onExit = executionProcess.onExit.bind(executionProcess);
    executionProcess.onExit = (listener: any) => onExit((event: any) => { record('pty-onExit', session, event); return listener(event); });
    return bind.call(this, session);
  };
  for (const name of ['stopSession','finalizeSession','createFreshSnapshot','broadcastToSessionSubscribers','pumpHostOutput','ackTerminalBatch','cancelHostOutput','attachSession','subscribeSession']) {
    const method = proto[name];
    proto[name] = function(...args: any[]) {
      const id = typeof args[0] === 'string' ? args[0] : args[0]?.sessionId ?? args[0]?.session?.sessionId ?? args[1]?.sessionId;
      const session = this.sessions.get(id);
      if (!session || session.ownedExecution) return method.apply(this,args);
      const extra = {
        event: args[1]?.event, payloadLive: args[1]?.payload?.live,
        subscribers: [...this.subscriptions.values()].map((map: any) => map.get(id)).filter(Boolean),
        credit: [...this.hostOutputSubscriptions.values()].map((map: any) => {
          const sub=map.get(id);return sub ? { appliedRevision:sub.appliedRevision,stateVersion:sub.stateVersion,appliedStateVersion:sub.appliedStateVersion,inFlight:sub.inFlight } : null;
        }).filter(Boolean), params: name === 'ackTerminalBatch' ? args[1] : undefined };
      record(name+'-enter',session,extra);
      if (name === 'stopSession') {
        let samples = 0;
        const timer = setInterval(() => { record('stop-observation',session);if (++samples===16)clearInterval(timer); },2000);
        timer.unref();
      }
      try {
        const result=method.apply(this,args);
        if (result?.then) return result.then((value: any) => { record(name+'-returned',session,{resultLive:value?.live});return value; },(error: any) => {record(name+'-failed',session,{error:error?.message});throw error;});
        record(name+'-returned',session);return result;
      } catch(error) { record(name+'-threw',session,{error:(error as any)?.message});throw error; }
    };
  }
}
'''
edit(p,'if (require.main === module) {',trace+'\nif (require.main === module) {')

p=root/'panel/CanvasPanelManager.ts'
helper='''
function traceLegacyStopHost(stage: string, detail: Record<string, unknown>): void {
  const file=process.env.DSC_LEGACY_STOP_TRACE;
  if (file) { try { require('fs').appendFileSync(file, JSON.stringify({at:Date.now(),role:'host',pid:process.pid,stage,...detail})+'\\n'); } catch {} }
}
if (process.env.DSC_LEGACY_STOP_TRACE) {
  const proto=CanvasPanelManager.prototype as any;
  for (const name of ['handleRuntimeSupervisorTerminalBatch','applyRuntimeSupervisorSnapshot','handleRuntimeSupervisorState','stopExecutionSession']) {
    const original=proto[name];
    proto[name]=function(...args: any[]) {
      const stopping=name==='stopExecutionSession';
      const snapshot=stopping ? {kind:args[0],sessionId:this.getExecutionSessions(args[0]).get(args[1])?.runtimeSessionId} : args[2];
      const nodeId=stopping ? args[1] : name==='applyRuntimeSupervisorSnapshot' ? args[0] : this.runtimeSessionBindings.get(this.buildRuntimeSessionBindingKey(snapshot.kind,snapshot.sessionId,args[1],args[0]))?.nodeId;
      if (nodeId !== 'previous-generation-stream-terminal') return original.apply(this,args);
      const state=() => { const session=nodeId && this.getExecutionSessions(snapshot.kind).get(nodeId); return {present:Boolean(session),paged:session?.terminalStreamPaged,healthy:session?.terminalStreamHealthy,sequence:session?.outputSequence}; };
      traceLegacyStopHost(name+'-enter',{sessionId:snapshot.sessionId,nodeId,live:snapshot.live,batchId:snapshot.batchId,revision:snapshot.revision,state:state()});
      return original.apply(this,args).then((result: any) => {traceLegacyStopHost(name+'-returned',{sessionId:snapshot.sessionId,nodeId,result,state:state()});return result;},(error: any) => {traceLegacyStopHost(name+'-failed',{sessionId:snapshot.sessionId,nodeId,error:error?.message,state:state()});throw error;});
    };
  }
}
'''
helper+=r"""
if (process.env.DSC_LEGACY_STOP_TRACE) {
  const proto=CanvasPanelManager.prototype as any;
  const ignored=proto.recordIgnoredExecutionSessionOperation;
  proto.recordIgnoredExecutionSessionOperation=function(...args: any[]) {
    if (args[1]==='previous-generation-stream-terminal') traceLegacyStopHost('execution-operation-ignored',{kind:args[0],nodeId:args[1],operation:args[2],sessionId:args[3]});
    return ignored.apply(this,args);
  };
}
"""
helper+="\nif (process.env.DSC_LEGACY_RESTORE_CONTROL === 'late') {\n  const proto=CanvasPanelManager.prototype as any;\n  const restoring=proto.restoreLiveRuntimeSessions;\n  const getClient=proto.getRuntimeSupervisorClientForKind;\n  let active: Promise<void> | undefined;\n  let activated=false;\n  let awaitingSecond=false;\n  let resolveSecond!: () => void;\n  let releaseSecond!: () => void;\n  const secondEntered=new Promise<void>(resolve => {resolveSecond=resolve;});\n  const firstDone=new Promise<void>(resolve => {releaseSecond=resolve;});\n  proto.restoreLiveRuntimeSessions=function(...args: any[]) {\n    const operation=restoring.apply(this,args);\n    if (!active) active=operation;\n    return operation.finally(() => { if(active===operation) active=undefined; });\n  };\n  proto.getRuntimeSupervisorClientForKind=async function(...args: any[]) {\n    const storage=args[2];\n    if (typeof storage!=='string' || !storage.endsWith('/previous-generation-stream')) return getClient.apply(this,args);\n    const node=this.state.nodes.find((node: any) => node.id==='previous-generation-stream-terminal');\n    const identity=node?.metadata?.terminal;\n    if (awaitingSecond) {\n      awaitingSecond=false;\n      traceLegacyStopHost('control-second-restore-enter',{sessionId:identity?.runtimeSessionId});\n      resolveSecond();\n      await firstDone;\n      traceLegacyStopHost('control-second-restore-released',{sessionId:identity?.runtimeSessionId,attachmentState:node?.metadata?.terminal?.attachmentState});\n      return getClient.apply(this,args);\n    }\n    if (!activated && identity?.attachmentState==='reattaching' && active) {\n      activated=true;\n      const original=active;\n      awaitingSecond=true;\n      const second=restoring.call(this);\n      original.then(() => {\n        traceLegacyStopHost('control-first-restore-finished',{sessionId:identity.runtimeSessionId,attachmentState:this.state.nodes.find((node: any)=>node.id==='previous-generation-stream-terminal')?.metadata?.terminal?.attachmentState});\n        releaseSecond();\n      },releaseSecond);\n      void second.then(() => traceLegacyStopHost('control-second-restore-finished',{sessionId:identity.runtimeSessionId}), (error: any)=>traceLegacyStopHost('control-second-restore-failed',{error:error?.message}));\n      this.trackRuntimeSupervisorOperation(second);\n      await secondEntered;\n    }\n    return getClient.apply(this,args);\n  };\n}\n"
edit(p,p.read_text(),p.read_text()+helper)

p=Path('tests/vscode-smoke/legacy-supervisor-upgrade-tests.cjs')
edit(p,'    await writeFailureArtifacts(error, resizeEvidence);','    await writeStopSupervisorEvidence(previousGenerationStreamSupervisorPaths, previousGenerationStreamTerminalSessionId, previousGenerationStreamSupervisorProcess, "failure");\n    await writeFailureArtifacts(error, resizeEvidence);')
p.write_text(p.read_text()+'''
async function writeStopSupervisorEvidence(paths, sessionId, child, phase) {
  if (!paths || !sessionId || !process.env.DEV_SESSION_CANVAS_SMOKE_ARTIFACT_DIR) return;
  const evidence = { phase, at: Date.now(), sessionId, paths, child: { pid: child?.pid, exitCode: child?.exitCode, signalCode: child?.signalCode } };
  try { evidence.hello = await sendRuntimeSupervisorRequest(paths, 'hello', undefined, 2000); } catch(error) { evidence.helloError=error.message; }
  try { evidence.registry = await readRegistry(paths.registryPath); } catch(error) { evidence.registryError=error.message; }
  try { evidence.snapshot = await sendRuntimeSupervisorRequest(paths, 'getSessionSnapshot', {sessionId, terminalStreamMode:'paged-until-exit'}, 2000); } catch(error) { evidence.snapshotError=error.message; }
  const dir=process.env.DEV_SESSION_CANVAS_SMOKE_ARTIFACT_DIR;
  await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(dir, 'legacy-stop-supervisor-'+phase+'.json'),JSON.stringify(evidence,null,2)+'\\n');
}
''')
Path('legacy-stop-probe-input.json').write_text(json.dumps({'baseline':'55c619ad70dbec74a7f9ffab17bf3dc547bd6913','diagnosticOnly':True,'changes':changes},indent=2)+'\n')
