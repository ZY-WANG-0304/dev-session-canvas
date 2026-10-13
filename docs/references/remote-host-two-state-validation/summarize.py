from pathlib import Path
import json,hashlib,sys
run=sys.argv[1];base=Path('/tmp/dscssh2-'+run+'/remote-ssh-real-reopen');out=Path('/tmp/dscssh2-evidence');data={'run':run,'root':str(base)}
for name,key in [('lab-host-control.json','control'),('lab-business-evidence.json','business'),('lab-cleanup.json','cleanup'),('lab-setup-ready.json','setup')]:
 p=base/'artifacts'/name
 if p.exists():
  d=json.loads(p.read_text())
  if key=='business':
   d['resize']['baseline']=[{k:n.get(k)for k in ['nodeId','kind','terminalExecutionSessionId','renderedWidth','renderedHeight','terminalCols','terminalRows','terminalFitCols','terminalFitRows','terminalProjectionPending']}for n in d['resize']['baseline']]
   d['resize']['resized']=[{k:n.get(k)for k in ['nodeId','kind','terminalExecutionSessionId','renderedWidth','renderedHeight','terminalCols','terminalRows','terminalFitCols','terminalFitRows','terminalProjectionPending']}for n in d['resize']['resized']]
   state=d['runtimeBeforeReset'];d['runtimeBeforeReset']={'observedRootSupervisorProcesses':state['observedRootSupervisorProcesses'],'bindings':state['bindings'],'pendingRuntimeSupervisorOperationCount':state['pendingRuntimeSupervisorOperationCount'],'sessions':[{'sessionId':s['sessionId'],'kind':s['kind'],'live':s['live'],'cols':s['cols'],'rows':s['rows']}for s in state['registries']['legacy-detached']['registry']['sessions']]}
  data[key]=d;data[key+'ArtifactSha256']=hashlib.sha256(p.read_bytes()).hexdigest()
for p in (base/'artifacts').glob('*failure-error.txt'):data['failure']=p.read_text().splitlines()[0];data['failureSha256']=hashlib.sha256(p.read_bytes()).hexdigest()
events=[]
for p in list((base/'user-data/logs').glob('*/window1/renderer.log'))+list((base/'remote-ssh-fixture/remote-agent/.vscode-server/data/logs').glob('*/exthost*/remoteexthost.log')):
 for l in p.read_text().splitlines():
  if len(l)<700 and any(x in l for x in ['[SSH-TWO-STATE]','Extension host terminating:','exiting with code','Extension host with pid']):events.append({'path':str(p),'line':l,'logSha256':hashlib.sha256(p.read_bytes()).hexdigest()})
data['lifecycleEvents']=events
p=out/(run+'.ndjson');rs=[json.loads(l)for l in p.read_text().splitlines()];data['runEvents']=[r for r in rs if r['type']!='process'];data['processes']=[]
for pid in dict.fromkeys(r['pid']for r in rs if 'pid'in r):
 xs=[r for r in rs if r.get('pid')==pid];alive=[r for r in xs if r['state']!='absent'];data['processes'].append({'pid':pid,'first':xs[0],'lastAlive':alive[-1]if alive else None,'firstAbsent':next((r for r in xs if r['state']=='absent'),None),'states':sorted(set(r['state']for r in xs))})
p=out/(run+'.log');data['commandLog']={'path':str(p),'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size}
(out/(run+'-summary.json')).write_text(json.dumps(data,ensure_ascii=False,indent=2))
print(run,'runExit',[r['code']for r in data['runEvents']if r['type']=='run-exit'],'businessPass',data.get('business',{}).get('pass'),'cleanupPass',data.get('cleanup',{}).get('pass'))
