from pathlib import Path
import hashlib,json

root=Path('extensions/vscode/dev-session-canvas/src')
changes=[]
def edit(p,old,new):
    text=p.read_text();assert text.count(old)==1,(str(p),old,text.count(old))
    p.write_text(text.replace(old,new));changes.append({'path':str(p),'before':hashlib.sha256(text.encode()).hexdigest(),'after':hashlib.sha256(p.read_bytes()).hexdigest()})

p=root/'supervisor/runtimeSupervisorMain.ts'
trace=r'''
// Temporary read-only trace; only used by this fixed-input diagnostic workflow.
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
  for (const name of ['handleRuntimeSupervisorTerminalBatch','applyRuntimeSupervisorSnapshot']) {
    const original=proto[name];
    proto[name]=function(...args: any[]) {
      const snapshot=args[2];
      const nodeId=name==='applyRuntimeSupervisorSnapshot' ? args[0] : this.runtimeSessionBindings.get(this.buildRuntimeSessionBindingKey(snapshot.kind,snapshot.sessionId,args[1],args[0]))?.nodeId;
      if (nodeId !== 'previous-generation-stream-terminal') return original.apply(this,args);
      const state=() => { const session=nodeId && this.getExecutionSessions(snapshot.kind).get(nodeId); return {present:Boolean(session),paged:session?.terminalStreamPaged,healthy:session?.terminalStreamHealthy,sequence:session?.outputSequence}; };
      traceLegacyStopHost(name+'-enter',{sessionId:snapshot.sessionId,nodeId,live:snapshot.live,batchId:snapshot.batchId,revision:snapshot.revision,state:state()});
      return original.apply(this,args).then((result: any) => {traceLegacyStopHost(name+'-returned',{sessionId:snapshot.sessionId,nodeId,result,state:state()});return result;},(error: any) => {traceLegacyStopHost(name+'-failed',{sessionId:snapshot.sessionId,nodeId,error:error?.message,state:state()});throw error;});
    };
  }
}
'''
p.write_text(p.read_text()+helper)
edit(p,"      await client.stopSession({\n        sessionId: session.runtimeSessionId\n      });", "      traceLegacyStopHost('stop-rpc-enter', { sessionId: session.runtimeSessionId, storage: session.runtimeStoragePath });\n      await client.stopSession({\n        sessionId: session.runtimeSessionId\n      });\n      traceLegacyStopHost('stop-rpc-returned', { sessionId: session.runtimeSessionId });")
edit(p,'    const binding = this.runtimeSessionBindings.get(\n      this.buildRuntimeSessionBindingKey(snapshot.kind, snapshot.sessionId, runtimeStoragePath, runtimeBackend)\n    );',"    traceLegacyStopHost('state-received', { sessionId: snapshot.sessionId, live: snapshot.live, lifecycle: snapshot.lifecycle, sequence: snapshot.outputSequence, storage: runtimeStoragePath });\n    const binding = this.runtimeSessionBindings.get(\n      this.buildRuntimeSessionBindingKey(snapshot.kind, snapshot.sessionId, runtimeStoragePath, runtimeBackend)\n    );")

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
