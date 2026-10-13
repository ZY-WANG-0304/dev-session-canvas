import os,re,json,time,subprocess,sys,datetime,pathlib
root=pathlib.Path(sys.argv[1]);out=pathlib.Path(sys.argv[2]);command=sys.argv[3:]
started=datetime.datetime.now(datetime.timezone.utc).isoformat()
with (out.with_suffix('.log')).open('w') as log, out.open('w') as f:
 p=subprocess.Popen(command,stdout=log,stderr=subprocess.STDOUT)
 known={}; last={}; ended=None; seen=set(); offsets={}
 def emit(d):
  d['utc']=datetime.datetime.now(datetime.timezone.utc).isoformat();f.write(json.dumps(d)+'\n');f.flush()
 emit({'type':'run-start','command':command,'runnerPid':p.pid})
 while True:
  for logfile in root.glob('remote-ssh-real-reopen/remote-ssh-fixture/remote-agent/.vscode-server/data/logs/*/exthost*/remoteexthost.log'):
   try:
    with logfile.open(errors='replace') as logread:
     logread.seek(offsets.get(str(logfile),0)); s=logread.read(); offsets[str(logfile)]=logread.tell()
    m=re.search(r'Extension host with pid (\d+) started',s)
    if m:known[int(m[1])]=str(logfile)
    for l in s.splitlines():
     if len(l)<600 and any(x in l for x in ['ready-for-exit','terminating:','exiting with code']):
      key=(str(logfile),l)
      if key not in seen:seen.add(key);emit({'type':'remote-log','path':str(logfile),'line':l})
   except OSError:pass
  for pid,path in known.items():
   try:
    s=pathlib.Path(f'/proc/{pid}/stat').read_text();fields=s[s.rindex(')')+2:].split()
    state={'pid':pid,'state':fields[0],'ppid':int(fields[1]),'startTicks':int(fields[19]),'log':path}
   except OSError:state={'pid':pid,'state':'absent','log':path}
   if last.get(pid)!=state or (int(time.monotonic()*5)%10==0):emit({'type':'process',**state});last[pid]=state
  code=p.poll()
  if code is not None:
   if ended is None:ended=time.monotonic();emit({'type':'run-exit','code':code})
   if time.monotonic()-ended>2:break
  time.sleep(.2)
 emit({'type':'run-end'})
sys.exit(code)
