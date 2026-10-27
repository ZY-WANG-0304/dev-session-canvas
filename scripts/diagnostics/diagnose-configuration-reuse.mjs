import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { installEchoProbe } from './configuration-reuse/browser-probe.mjs';
import { buildReference } from './configuration-reuse/build-reference.mjs';
import { createRemoteSSHFixture } from '../smoke/vscode-remote-ssh-fixture.mjs';
import { randomUUID, createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { prepareRuntime, buildVSCodeArgs, buildVSCodeChildEnv } from '../smoke/vscode-smoke-runner.mjs';

const { values } = parseArgs({ options: { extension: { type: 'string' }, vscode: { type: 'string' },
  output: { type: 'string' }, 'canvas-display': {type:'boolean',default:false}, 'canvas-paired': {type:'boolean',default:false}, sidebar: {type:'boolean',default:false}, remote: {type:'boolean',default:false}, samples: { type: 'string', default: '40' } } });
assert(values.extension && values.vscode && values.output, 'Required: --extension frozen-directory --vscode executable --output NEW-directory');
const output = path.resolve(values.output), source = path.resolve(values.extension);
const canvasDisplay=values['canvas-display']||values['canvas-paired'];
const nodeCount=canvasDisplay?4:2;
const sampleCount = Number(values.samples); assert(Number.isInteger(sampleCount) && sampleCount > 0 && sampleCount <= 120);
await fs.mkdir(output,{mode:0o700}); // Refuse to overwrite prior evidence.
const write = (file, data) => fs.writeFile(path.join(output, file), JSON.stringify(data, null, 2));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function wait(label, read, ready, timeout = 30000) {
  const deadline = Date.now() + timeout; let value;
  do { value = await read(); if (ready(value)) return value; await pause(100); } while (Date.now() < deadline);
  throw Error(`${label} timed out: ${JSON.stringify(value)?.slice(0,500)}`);
}
const port = await new Promise(resolve => { const server = net.createServer(); server.listen(0, '127.0.0.1', () => {
  const port = server.address().port; server.close(() => resolve(port)); }); });
const workspace = path.join(output, 'workspace'); await fs.mkdir(workspace);
for (let i=0;i<nodeCount;i++) { await fs.mkdir(path.join(workspace, `node${i}`));
  await fs.writeFile(path.join(workspace, `node${i}`, 'load.json'), '{"enabled":false}'); }
const fixture = path.join(output, 'echo-cli');
await fs.copyFile(fileURLToPath(new URL('./configuration-reuse/echo-cli.py', import.meta.url)), fixture); await fs.chmod(fixture, 0o755);
const runtime = await prepareRuntime({ debugRoot: path.join(output, 'runtime'), runtimeDirName: `dsc-cfg-${randomUUID().slice(0,8)}`,
  userSettings: { 'security.workspace.trust.enabled': false, 'workbench.startupEditor': 'none',
    'window.restoreWindows': 'none', 'extensions.autoUpdate': false, 'extensions.autoCheckUpdates': false,
    'devSessionCanvas.runtimePersistence.enabled': true, ...(values.sidebar?{'devSessionCanvas.files.enabled':true}:{}), 'devSessionCanvas.agent.codexCommand': fixture,
    'devSessionCanvas.agent.codexDefaultArgs': '', 'devSessionCanvas.canvas.overviewMode': 'off',
    'terminal.integrated.scrollback': 5000, 'workbench.editor.enablePreview': false } });
const staged = path.join(output, 'extension'); await fs.cp(source, staged, { recursive: true });
if(values.remote) {
  const manifestFile=path.join(staged,'package.json');
  const manifest=JSON.parse(await fs.readFile(manifestFile));
  manifest.activationEvents=[...new Set([...(manifest.activationEvents??[]),'onStartupFinished'])];
  await fs.writeFile(manifestFile,JSON.stringify(manifest));
}
const hostFile = path.join(staged,'dist/extension.js'), webFile = path.join(staged,'dist/webview.js');
const host = await fs.readFile(hostFile,'utf8'), web = await fs.readFile(webFile,'utf8');
const hostAnchor = values.sidebar ? '  const sidebarNodeListView = new CanvasSidebarNodeListView(panelManager, context.extensionUri, context.workspaceState);' : '  activePanelManager = panelManager;';
const webAnchor = 'var executionTerminalRegistry = /* @__PURE__ */ new Map();';
assert.equal(host.split(hostAnchor).length,2); assert.equal(web.split(webAnchor).length,2);
await fs.writeFile(hostFile,host.replace(hostAnchor,hostAnchor+'\n  require("./configuration-reuse-driver.cjs").start(panelManager, vscode, context'+(values.sidebar?', {summary:sidebarSummaryView,actions:sidebarActionsView,nodes:sidebarNodeListView}':'')+');'));
await fs.writeFile(webFile,web.replace(webAnchor,webAnchor+'\n  window.__dscConfigurationProbeRegistry = executionTerminalRegistry;'));
await fs.copyFile(fileURLToPath(new URL('./configuration-reuse/host-driver.cjs',import.meta.url)),path.join(staged,'dist/configuration-reuse-driver.cjs'));
if(values.sidebar)await fs.copyFile(fileURLToPath(new URL('./configuration-reuse/sidebar-driver.cjs',import.meta.url)),path.join(staged,'dist/sidebar-driver.cjs'));
if(canvasDisplay)await fs.copyFile(fileURLToPath(new URL('./configuration-reuse/canvas-display-driver.cjs',import.meta.url)),path.join(staged,'dist/canvas-display-driver.cjs'));
const token=randomUUID(),receipt=path.join(output,'host.json');
await fs.writeFile(path.join(staged,'dist/configuration-reuse-driver.json'),JSON.stringify({token,receipt,workspace,fixture,canvasDisplay}),{mode:0o600});
const reference=await buildReference(path.join(staged,'dist/configuration-reuse-reference.cjs'));
await write('input.json',{reference,source,hostSha256:createHash('sha256').update(host).digest('hex'),webviewSha256:createHash('sha256').update(web).digest('hex'),
  vscode:path.resolve(values.vscode),sampleCount,intervalMs:250,load:{tickMs:50,linesPerTick:12},
  remoteRequested:values.remote,sidebarRequested:values.sidebar,canvasDisplayRequested:canvasDisplay,paired:values['canvas-paired'],inputIntervalsMs:values['canvas-paired']?[181,223,277,319]:[250],
  runnerSha256:createHash('sha256').update(await fs.readFile(fileURLToPath(import.meta.url))).digest('hex'),
  sidebarDriverSha256:values.sidebar?createHash('sha256').update(await fs.readFile(path.join(staged,'dist/sidebar-driver.cjs'))).digest('hex'):undefined,
  driverSha256:createHash('sha256').update(await fs.readFile(path.join(staged,'dist/configuration-reuse-driver.cjs'))).digest('hex'),
  cliSha256:createHash('sha256').update(await fs.readFile(fixture)).digest('hex'),
  observerSha256:createHash('sha256').update(installEchoProbe.toString()).digest('hex'),
  instrumentation:'Copied artifacts only: remote bootstrap adds onStartupFinished activation; expose manager via private authenticated loopback driver; expose existing xterm registry. No timing/frequency/path replacements.',
  scope:'Real VS Code, development extension, real PTY/detached Supervisor/journal/Webview; controlled Agent CLI, not model service or cross-machine SSH. Explicit supported legacy-detached backend override isolates test processes from systemd.'});
let child,browser,request,remote; let success=false;
const results=[];
const log = await fs.open(path.join(output,'vscode.log'),'w');
try {
  let remoteExtensions=[];
  if(values.remote) {
    remote=await createRemoteSSHFixture({debugRoot:output,hostAlias:`dsc-config-${randomUUID().slice(0,8)}`,
      observeCleanup:true,clientRoots:[runtime.userDataDir],cleanupReportPath:path.join(output,'remote-cleanup.json')});
    const cli=path.join(path.dirname(path.resolve(values.vscode)),'bin/code');
    const installed=await promisify(execFile)(cli,[`--user-data-dir=${runtime.userDataDir}`,`--extensions-dir=${runtime.extensionsDir}`,
      '--install-extension','ms-vscode-remote.remote-ssh','--force'],{env:buildVSCodeChildEnv(runtime.environment),timeout:120000,maxBuffer:4*1024**2});
    await write('remote-install.json',installed);
    const entries=await fs.readdir(runtime.extensionsDir);
    remoteExtensions=['ms-vscode-remote.remote-ssh','ms-vscode-remote.remote-ssh-edit','ms-vscode.remote-explorer'].map(id=>{
      const name=entries.find(name=>name.startsWith(id+'-'));assert(name,`Missing ${id}`);return path.join(runtime.extensionsDir,name);
    });
    const settingsFile=path.join(runtime.userDataDir,'User/settings.json');
    const settings=JSON.parse(await fs.readFile(settingsFile));
    await fs.mkdir(path.join(workspace,'.vscode'),{recursive:true});
    await fs.writeFile(path.join(workspace,'.vscode/settings.json'),JSON.stringify(settings));
    await fs.writeFile(settingsFile,JSON.stringify({...settings,'remote.SSH.configFile':remote.sshConfigPath,
      'remote.SSH.useLocalServer':false,'remote.SSH.localServerDownload':'always',
      'remote.SSH.remotePlatform':{[remote.hostAlias]:'linux'},'remote.SSH.serverInstallPath':{[remote.hostAlias]:remote.remoteAgentDir}}));
  }
  const remoteUri=file=>`vscode-remote://${remote.remoteAuthority}${encodeURI(file)}`;
  const args=buildVSCodeArgs({ workspacePath:remote?undefined:workspace,folderUri:remote?remoteUri(workspace):undefined,
    remoteAuthority:remote?.remoteAuthority,extensionHostEnv:remote?{...remote.extensionHostEnv,DEV_SESSION_CANVAS_RUNTIME_HOST_BACKEND_OVERRIDE:'legacy-detached'}:undefined,
    extensionDevelopmentPath:remote?[remoteUri(staged),...remoteExtensions]:staged,disableExtensions:!remote,userDataDir:runtime.userDataDir,
    extensionsDir:runtime.extensionsDir,disableWorkspaceTrust:true,extraLaunchArgs:[`--remote-debugging-port=${port}`,
      '--remote-debugging-address=127.0.0.1','--window-size=1600,1000','--force-disable-user-env','--locale=en'] });
  child=spawn(path.resolve(values.vscode),args,{env:buildVSCodeChildEnv({...runtime.environment,DEV_SESSION_CANVAS_RUNTIME_HOST_BACKEND_OVERRIDE:'legacy-detached'}),stdio:['ignore',log.fd,log.fd],detached:true});
  child.on('error',error=>{console.error(error);});
  await wait('CDP endpoint',async()=>fetch(`http://127.0.0.1:${port}/json/version`).then(r=>r.ok).catch(()=>false),Boolean);
  browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const page=await wait('Workbench',async()=>browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().includes('workbench')),Boolean);
  page.setDefaultTimeout(values.remote?90000:20000);
  await page.setViewportSize({width:1600,height:1000});
  if(!values.remote) {
  await page.locator('.monaco-workbench').waitFor();
  await pause(4000);
  await page.keyboard.press('F1');
  const commandInput = page.locator('.quick-input-widget input');
  await commandInput.waitFor({state:'visible'});
  await commandInput.fill('>Dev Session Canvas: Open Canvas in Editor');
  await page.locator('.quick-input-list .monaco-list-row').filter({hasText:'Dev Session Canvas: Open Canvas in Editor'}).first().waitFor();
  await page.keyboard.press('Enter');
  }
  const hostInfo=await wait('Host activation',async()=>JSON.parse(await fs.readFile(receipt,'utf8').catch(()=>'null')),Boolean,values.remote?120000:60000);
  request=async(action,args)=>{const response=await fetch(`http://127.0.0.1:${hostInfo.port}`,{method:'POST',headers:{authorization:token},
    body:JSON.stringify({action,args}),signal:AbortSignal.timeout(30000)});const value=await response.json();if(value.error)throw Error(value.error);return value.result;};
  await write('initialize.json',await request('initialize'));
  const environment=await request('status');
  if(remote)assert.equal(environment.remoteName,'ssh-remote');
  await write('environment.json',environment);
  await request('open');
  await request('reset');
  const frame=await wait('Canvas frame',async()=>{
    for(const f of page.frames()) { if(await f.evaluate(()=>Boolean(window.__dscConfigurationProbeRegistry)).catch(()=>false))return f; }
  },Boolean);
  await write('benchmark.json',await request('benchmark'));
  await write('configuration-check.json',await request('configuration-check'));
  let ids=[];
  async function create(index) {
    const id=await request('create',{index}); assert(id); ids.push(id);
    await wait('PTY ready',()=>frame.evaluate(id=>{
      const t=window.__dscConfigurationProbeRegistry.get(id)?.terminal;if(!t)return false;
      const b=t.buffer.active;for(let i=0;i<b.length;i++)if(b.getLine(i)?.translateToString(true).includes('DSC_PROBE_READY'))return true;
      return false;
    },id),Boolean,60000);
  }
  await create(0);
  // Observe normal keyboard events and actual xterm parse completion in one clock domain.
  await frame.evaluate(installEchoProbe,ids[0]);
  const scenes=values['canvas-paired'] ? [1,2].flatMap(count=>['skip','delta','delta','skip'].map((mode,index)=>({name:`paired-${count}-${index}-${mode}`,count,mode,loads:[true,false,false,false],stateLoad:true}))) : canvasDisplay ? [
    {name:'single',loads:[true,false,false,false],count:1,stateLoad:true},
    {name:'two-second-silent',loads:[true,false,false,false],count:2,stateLoad:true},
    {name:'two-second-output',loads:[false,true,false,false],count:2,stateLoad:true},
    {name:'two-both-output',loads:[true,true,false,false],count:2,stateLoad:true},
    {name:'four-output',loads:[true,true,true,true],count:4,stateLoad:true},
    {name:'four-natural-output',loads:[true,true,true,true],count:4}
  ] : values.sidebar ? [
    {name:'sidebar-never-open',loads:[true,true],stateLoad:true},
    {name:'sidebar-visible',loads:[true,true],stateLoad:true,sidebarVisible:true},
    {name:'sidebar-hidden',loads:[true,true],stateLoad:true,sidebarVisible:false},
    {name:'sidebar-reopened',loads:[true,true],stateLoad:true,sidebarVisible:true},
    {name:'sidebar-natural-output',loads:[true,true],sidebarVisible:true}
  ] : [{name:'single',loads:[true,false]},{name:'two-second-silent',loads:[true,false]},
    {name:'two-second-output',loads:[false,true]},{name:'two-both-output',loads:[true,true]},
    {name:'two-both-output-state-10hz',loads:[true,true],stateLoad:true}];
  for(const scene of scenes) {
    if(canvasDisplay) {while(ids.length<scene.count)await create(ids.length);}
    else if(scene.name!=='single'&&ids.length===1)await create(1);
    if(scene.mode)await request('display-mode',{mode:scene.mode});
    for(let i=0;i<nodeCount;i++)await fs.writeFile(path.join(workspace,`node${i}`,'load.json'),JSON.stringify({enabled:scene.loads[i]}));
    if(values.sidebar && scene.sidebarVisible!==undefined) {
      await request('sidebar-show',{visible:scene.sidebarVisible});
      await wait('sidebar visibility',()=>request('sidebar-metrics'),m=>Object.values(m.views).every(v=>v.created && v.visible===scene.sidebarVisible));
    }
    await request('state-load',{enabled:scene.stateLoad===true,hz:(values.sidebar||canvasDisplay)?20:10});
    await frame.getByRole('button',{name:'Fit view',exact:true}).click();
    await pause(1500);
    await frame.evaluate(id=>{const t=window.__dscConfigurationProbeRegistry.get(id).terminal;t.focus();},ids[0]);
    const node=frame.locator(`[data-node-id="${ids[0]}"]`);
    await node.locator('.xterm-helper-textarea').focus();
    if(values.sidebar)await request('sidebar-reset-metrics');
    if(canvasDisplay)await request('display-reset');
    let cdp, metricScope;
    if(canvasDisplay) {
      for(let target=frame;target;target=target.parentFrame()) {
        try { cdp=await page.context().newCDPSession(target);metricScope=target.url();break; } catch {}
      }
      if(!cdp) { cdp=await page.context().newCDPSession(page);metricScope='workbench shared renderer'; }
    }
    if(cdp)await cdp.send('Performance.enable');
    const beforeMetrics=cdp?await cdp.send('Performance.getMetrics'):undefined;
    if(canvasDisplay)await frame.evaluate(()=>{
      const p=window.__dscDisplayProbe={waits:[],longTasks:[],frames:[],last:performance.now(),seen:new Set(),active:true};
      for(const e of document.querySelectorAll('.window-title-input'))p.seen.add(e.value);
      p.scan=()=>{
        for(const e of document.querySelectorAll('.window-title-input'))for(const m of e.value.matchAll(/Display-(\d+)-(\d+)/g)) {
          if(p.seen.has(m[0]))continue;p.seen.add(m[0]);p.waits.push({key:m[0],ms:Date.now()-Number(m[2])});
        }
      };
      p.longObserver=new PerformanceObserver(list=>p.longTasks.push(...list.getEntries().map(e=>({duration:e.duration,start:e.startTime}))));p.longObserver.observe({entryTypes:['longtask']});
      const tick=now=>{if(!p.active)return;p.frames.push(now-p.last);p.last=now;p.scan();requestAnimationFrame(tick);};requestAnimationFrame(tick);
    });
    await request('start-trace');
    await frame.evaluate(()=>{window.__dscEchoProbe.active=true;window.__dscEchoProbe.samples=[];window.__dscEchoProbe.parsed=0;window.__dscEchoProbe.renders=0;});
    for(let i=0;i<sampleCount;i++){await page.keyboard.press(String.fromCharCode(97+i%26));await pause(values['canvas-paired']?[181,223,277,319][i%4]:250);}
    await wait('all replies or timeout',()=>frame.evaluate(()=>window.__dscEchoProbe.samples.every(s=>s.applied!==undefined)),Boolean,20000).catch(()=>{});
    const observation=await frame.evaluate(()=>{const p=window.__dscEchoProbe;p.active=false;return {samples:p.samples,parsed:p.parsed,renders:p.renders};});
    const sidebar=values.sidebar?await request('sidebar-metrics'):undefined;
    if(canvasDisplay) {
      await request('state-load',{enabled:false});
      const expected=(await request('display-metrics')).changes;
      const latest=[...new Map(expected.map(c=>[c.nodeId,c.title]))];
      await wait('latest background titles appear',()=>frame.evaluate(latest=>latest.every(([id,title])=>document.querySelector(`[data-node-id="${id}"] .window-title-input`)?.value===title),latest),Boolean);
      await pause(50);
    }
    const display=canvasDisplay?{metricScope,host:await request('display-metrics'),browser:await frame.evaluate(()=>{
      const p=window.__dscDisplayProbe;p.active=false;p.scan();p.longObserver.disconnect();return {waits:p.waits,longTasks:p.longTasks,frames:p.frames};
    }),before:beforeMetrics,after:await cdp.send('Performance.getMetrics')}:undefined;
    await cdp?.detach();
    const trace=await request('trace');
    await request('state-load',{enabled:false});
    const dimensions=await frame.evaluate(()=>[...window.__dscConfigurationProbeRegistry].map(([id,e])=>({id,cols:e.terminal.cols,rows:e.terminal.rows})));
    const result={scene:scene.name,controlledStateLoadHz:scene.stateLoad?((values.sidebar||canvasDisplay)?20:10):0,requested:sampleCount,observed:observation.samples.length,missing:sampleCount-observation.samples.filter(s=>s.applied!==undefined).length,
      ...observation,dimensions,sidebar,display};results.push(result);
    await write(`${scene.name}.json`,{...result,trace});
    await page.screenshot({path:path.join(output,`${scene.name}.png`)});
    if(values.sidebar && scene.sidebarVisible) {
      const check=await request('sidebar-check');
      assert(check.last.actions,'Actions view must actually receive its state');
      for(const [key,value] of Object.entries(check.expectedFilters))assert.deepEqual(check.last.actions.state[key],value);
      assert.deepEqual(check.last.nodes.items.map(i=>i.nodeId).sort(),[...ids].sort());
      const dom=await wait('sidebar DOM matches Host state',async()=>{
        const result={nodes:[],include:undefined};
        for(const f of page.frames()) {
          const observed=await f.evaluate(()=>({nodes:[...document.querySelectorAll('[data-sidebar-node-item-id]')].map(e=>({id:e.getAttribute('data-sidebar-node-item-id'),text:e.textContent})),include:document.querySelector('#include-input')?.value})).catch(()=>undefined);
          if(observed?.nodes.length)result.nodes=observed.nodes;
          if(observed?.include!==undefined)result.include=observed.include;
        }
        return result;
      },v=>v.include===check.expectedFilters.fileFilters.includeGlobs.join(', ') && check.expectedNodes.every(n=>v.nodes.some(row=>row.id===`node/${n.id}` && row.text.includes(n.title))));
      await write(`${scene.name}-sidebar-check.json`,{...check,dom});
    }
    if(values.sidebar && scene.name==='sidebar-hidden')await request('sidebar-mutate',{nodeId:ids[0]});
    console.log(JSON.stringify({scene:scene.name,missing:result.missing,maxMs:Math.max(...result.samples.map(s=>s.durationMs??0))}));
  }
  for(let i=0;i<nodeCount;i++)await fs.writeFile(path.join(workspace,`node${i}`,'load.json'),JSON.stringify({enabled:false}));
  await pause(200);
  const visibleReply = `REPLY_${String(sampleCount*scenes.length+1).padStart(6,'0')}_7a`;
  await page.keyboard.press('z');
  await wait('visible final PTY reply',()=>frame.evaluate(({id,reply})=>{
    const t=window.__dscConfigurationProbeRegistry.get(id).terminal,b=t.buffer.active;
    for(let i=b.viewportY;i<Math.min(b.length,b.viewportY+t.rows);i++)if(b.getLine(i)?.translateToString(true)===reply)return true;
    return false;
  },{id:ids[0],reply:visibleReply}),Boolean);
  await page.screenshot({path:path.join(output,'visible-final-reply.png')});
  await write('visibility.json',{reply:visibleReply,visibleBufferVerified:true,extraProbeExcludedFromLatencySamples:true});
  await write('final-state.json',await request('status'));
  success=results.every(r=>r.missing===0&&r.observed===r.requested);
  if(!success)throw Error('missing input/replies; retain failed samples in denominator');
} catch(error) { if(request)await write('failure-host.json',await request('status').catch(e=>String(e))); if(request)await write('diagnostic-events.json',await request('diagnostics').catch(e=>String(e))); await write('failure.json',{error:String(error),stack:error.stack}); throw error; }
finally {
  let cleanup;
  try {cleanup=await request?.('reset');}catch(error){cleanup=String(error);}
  await write('result.json',{success,cleanup,scenes:results.map(r=>({name:r.scene,requested:r.requested,observed:r.observed,missing:r.missing}))});
  const cliCleanup=[];
  for(let index=0;index<nodeCount;index++) {
    const pidFile=path.join(workspace,`node${index}`,'probe-pid.json');
    const pid=JSON.parse(await fs.readFile(pidFile,'utf8').catch(()=>'null'))?.pid;
    if(!pid)continue;
    const exited=()=>{try{process.kill(pid,0);return false;}catch(error){return error.code==='ESRCH';}};
    await wait('fixture CLI exit',async()=>exited(),Boolean,5000).catch(()=>{});
    cliCleanup.push({pid,exited:exited()});
  }
  await write('cli-cleanup.json',cliCleanup);
  if(cliCleanup.some(item=>!item.exited))process.exitCode=1;
  await browser?.close().catch(()=>{});
  if(child?.pid){try{process.kill(-child.pid,'SIGTERM');}catch{} await pause(1500);try{process.kill(-child.pid,'SIGKILL');}catch{}}
  if(remote)await remote.dispose();
  await log.close();
}
