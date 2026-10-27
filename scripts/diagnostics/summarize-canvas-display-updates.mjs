import fs from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(process.argv[2]??'.debug/canvas-display-updates');
const quantile=(samples,q)=>samples.length?[...samples].sort((a,b)=>a-b)[Math.min(samples.length-1,Math.ceil(q*samples.length)-1)]:null;
const results=[];
for(const run of ['remote-a','remote-b2','remote-c','remote-a2']) {
  const dir=path.join(root,run);
  let result;try{result=JSON.parse(await fs.readFile(path.join(dir,'result.json'),'utf8'));}catch{continue;}
  for(const scene of result.scenes) {
    const d=JSON.parse(await fs.readFile(path.join(dir,scene.name+'.json'),'utf8'));
    const host=d.trace.host, surface=d.trace.surfaces.find(s=>s.status==='collected')?.snapshot;
    const groups=host.groups??[];
    if(host.droppedNodeGroups)throw Error('Host group truncation: '+run+'/'+scene.name);
    if(surface?.droppedNodeGroups)throw Error('Webview group truncation: '+run+'/'+scene.name);
    const messages=groups.filter(g=>g.stage==='message-post'&&['host/stateUpdated','host/stateDelta'].includes(g.messageType));
    const sum=(xs,key)=>xs.reduce((total,x)=>total+(x[key]??0),0);
    const stage=name=>sum(host.seconds.filter(x=>x.stage===name),'totalDurationMs');
    const latencies=d.samples.filter(s=>s.durationMs!==undefined).map(s=>s.durationMs);
    const before=new Map(d.display.before.metrics.map(m=>[m.name,m.value]));
    const after=new Map(d.display.after.metrics.map(m=>[m.name,m.value]));
    const metric=key=>1000*(after.get(key)-before.get(key));
    const waits=d.display.browser.waits.map(w=>w.ms);
    results.push({run,scene:scene.name,success:result.success,observed:d.observed,missing:d.missing,
      stateMessages:sum(messages,'count'),stateBytes:sum(messages,'bytes'),statePostMs:sum(messages,'totalDurationMs'),
      webviewStateApplyMs:sum((surface?.groups??[]).filter(g=>g.stage==='message-handle'&&['host/stateUpdated','host/stateDelta'].includes(g.messageType)),'totalDurationMs'),postStateCalls:d.display.host.calls,
      postStateMs:d.display.host.totalMs,stateBuildMs:stage('state-build'),stateDiffMs:stage('state-diff'),sidebarMs:stage('state-sidebar-notify'),
      hostElapsedMs:d.display.host.elapsedMs,hostCpuMs:(d.display.host.cpu.user+d.display.host.cpu.system)/1000,
      rendererTaskMs:metric('TaskDuration'),rendererScriptMs:metric('ScriptDuration'),rendererLayoutMs:metric('LayoutDuration'),rendererStyleMs:metric('RecalcStyleDuration'),
      echoP95:quantile(latencies,.95),echoP99:quantile(latencies,.99),echoMax:quantile(latencies,1),
      frameGapMax:quantile(d.display.browser.frames,1),longTaskMax:quantile(d.display.browser.longTasks.map(t=>t.duration),1),
      backgroundObserved:waits.length,backgroundGenerated:d.display.host.changes.length,backgroundP95:quantile(waits,.95),backgroundMax:quantile(waits,1),
      dimensions:d.dimensions,metricScope:d.display.metricScope,webviewCollected:!!surface});
  }
}
let paired;
try {
  const directory=path.join(root,'remote-paired');
  const receipt=JSON.parse(await fs.readFile(path.join(directory,'result.json'),'utf8'));
  const samples=new Map(),phases=[];
  for(const scene of receipt.scenes) {
    const data=JSON.parse(await fs.readFile(path.join(directory,scene.name+'.json'),'utf8'));
    const [,nodes,,mode]=scene.name.split('-'), key=nodes+':'+mode;
    const latency=data.samples.filter(sample=>sample.durationMs!==undefined).map(sample=>sample.durationMs);
    samples.set(key,[...(samples.get(key)??[]),...latency]);
    phases.push({scene:scene.name,observed:data.observed,missing:data.missing,p95:quantile(latency,.95),p99:quantile(latency,.99)});
  }
  paired={success:receipt.success,phases,combined:[...samples].map(([key,latency])=>{
    const [nodes,mode]=key.split(':');return {nodes:Number(nodes),mode,samples:latency.length,p95:quantile(latency,.95),p99:quantile(latency,.99),max:quantile(latency,1)};
  })};
} catch(error) {if(error.code!=='ENOENT')throw error;}
await fs.writeFile(path.join(root,'summary.json'),JSON.stringify({scope:'VS Code 1.140 loopback Remote SSH, virtual display, controlled PTY CLI. 20Hz postState pressure with 4Hz title changes; final scene natural output. 40 echo samples per scene: P99 is the sample maximum. Renderer target can include the Webview parent; active flow diagnostics add measurement overhead.',results,paired},null,2));
console.table(results.map(({run,scene,stateMessages,stateBytes,postStateMs,rendererTaskMs,echoP95,echoP99,backgroundP95})=>({run,scene,stateMessages,stateBytes,postStateMs:+postStateMs.toFixed(1),rendererTaskMs:+rendererTaskMs.toFixed(1),echoP95:+echoP95.toFixed(1),echoP99:+echoP99.toFixed(1),backgroundP95})));

if(paired)console.table(paired.combined);
