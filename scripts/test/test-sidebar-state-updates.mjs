import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import esbuild from 'esbuild';
import { execFileSync } from 'node:child_process';

class EventEmitter {
  listeners = new Set();
  event = fn => { this.listeners.add(fn); return { dispose: () => this.listeners.delete(fn) }; };
  fire(value) { for (const fn of this.listeners) fn(value); }
  dispose() { this.listeners.clear(); }
}
const uri = p => ({ scheme:'file', fsPath:p, path:p, query:'', with(change) { return {...this,...change}; } });
const vscode = { EventEmitter, TreeItem: class { constructor(label) { this.label=label; } }, TreeItemCollapsibleState:{None:0},
  Uri:{joinPath:(base,...parts)=>uri(path.join(base.fsPath,...parts))}, env:{language:'en'},
  commands:{executeCommand:async()=>{}},l10n:{t:(s,...args)=>s.replace(/\{([^}]+)\}/g,(_,k)=>String(args[0]?.[k]??args[Number(k)]??k))} };
globalThis.__sidebarTest = vscode;
const dir=await mkdtemp(path.join(os.tmpdir(),'dsc-sidebar-updates-'));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function view() {
  const visibility=new EventEmitter(), disposed=new EventEmitter(), received=new EventEmitter();
  const messages=[];
  return {visible:true, messages, visibility, disposed, received,
    onDidChangeVisibility:visibility.event,onDidDispose:disposed.event,
    webview:{cspSource:'fixture:',asWebviewUri:u=>'fixture:'+u.fsPath,onDidReceiveMessage:received.event,
      postMessage:async m=>{messages.push(structuredClone(m));return true;}},
    show(visible) {this.visible=visible;visibility.fire();} };
}
const state = {canvasSurface:'visible',surfaceLocation:'panel',configuredSurface:'panel',workspaceTrusted:true,
  runtimePersistenceEnabled:true,notificationBridgeMode:'system',enabledAttentionSignals:['osc9'],notificationStrongReminderMode:'both',
  agentAbnormalOutputTextNotificationMode:'off',filesFeatureEnabled:true,filePresentationMode:'lists',fileNodeDisplayStyle:'minimal',
  fileNodeDisplayMode:'icon-path',filePathDisplayMode:'basename',nodeCount:1,runningExecutionCount:1,
  terminalShellPath:'/bin/bash',terminalShellConfiguredValue:'bash',agentCodexCommand:'codex',agentClaudeCommand:'claude',
  creatableKinds:['agent','terminal','note'],fileFilters:{includeGlobs:['**/*.ts'],excludeGlobs:[]}};
const events=new EventEmitter();let current=structuredClone(state),reads=0;
let snapshot={nodes:[{id:'n1',kind:'agent',title:'Agent',status:'running',summary:'Hello',position:{x:0,y:0},size:{width:400,height:300},
  metadata:{agent:{provider:'codex',cwd:'/workspace',outputSequence:1}}}],groups:[]};
const manager={onDidChangeSidebarState:events.event,getSidebarState:()=>{reads++;return structuredClone(current);},
  getCanvasSidebarNodeListSnapshot:()=>structuredClone(snapshot),getWorkspaceFoldersForDisplay:()=>[{name:'workspace',path:'/workspace'}]};
const emit=patch=>{current={...current,...patch};events.fire(structuredClone(current));};
try {
  const outfile=path.join(dir,'classes.cjs');
  await esbuild.build({stdin:{contents:[ 'CanvasSidebarView','CanvasSidebarActionsView','CanvasSidebarNodeListView'].map(n=>`export * from './extensions/vscode/dev-session-canvas/src/sidebar/${n}';`).join('\n'),resolveDir:process.cwd(),loader:'ts'},
    outfile,bundle:true,platform:'node',format:'cjs',plugins:[{name:'vscode',setup(b){if(process.argv.includes('--baseline'))b.onLoad({filter:/src\/sidebar\/CanvasSidebar(?:View|ActionsView|NodeListView)\.ts$/},args=>({contents:execFileSync('git',['show','d4edaa71305d04c6e3565d83ac0ec4c9b2c00475:'+path.relative(process.cwd(),args.path)],{encoding:'utf8'}),loader:'ts',resolveDir:path.dirname(args.path)}));b.onResolve({filter:/^vscode$/},()=>({path:'vscode',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'module.exports = globalThis.__sidebarTest;'}));}}]});
  const {CanvasSidebarView,CanvasSidebarActionsView,CanvasSidebarNodeListView,getCanvasSidebarSummaryItems,getCanvasSidebarNodeListItems}=createRequire(import.meta.url)(outfile);
  const summary=new CanvasSidebarView(manager);let changes=0;summary.onDidChangeTreeData(()=>changes++);
  assert.equal(summary.getChildren().length,getCanvasSidebarSummaryItems(current).length);assert.equal(reads,1);
  for(let i=0;i<50;i++){emit({creatableKinds:['agent']});summary.getChildren();}
  assert.equal(reads,1);assert.equal(changes,0,'unconsumed fields must not refresh the summary');
  for(const patch of [{nodeCount:2},{runningExecutionCount:0},{workspaceTrusted:false},{agentCodexCommand:'/new/codex'},
    {terminalShellPath:'/bin/zsh'},{configuredSurface:'editor'},{filesFeatureEnabled:false}]) {
    const before=changes;emit(patch);assert.equal(changes,before+1);assert.deepEqual(summary.getChildren().map(({id,label,description,tooltip,command,contextValue})=>({id,label,description,tooltip,...(command?{command}:{}),...(contextValue?{contextValue}:{})})),getCanvasSidebarSummaryItems(current));
  }
  summary.dispose();
  const actions=new CanvasSidebarActionsView(manager);const filters=view();actions.resolveWebviewView(filters);
  filters.received.fire({type:'sidebarActions/ready'});await tick();filters.messages.length=0;const beforeReads=reads;
  emit({});await tick();assert.equal(filters.messages.length,0);assert.equal(reads,beforeReads);
  emit({nodeCount:3,agentCodexCommand:'/irrelevant'});await tick();assert.equal(filters.messages.length,0);
  emit({fileFilters:{includeGlobs:['src/**'],excludeGlobs:['vendor/**']}});await tick();assert.equal(filters.messages.length,1);
  assert.equal(reads,beforeReads);const old=filters.messages[0];emit({fileFilters:{includeGlobs:[],excludeGlobs:[]}});await tick();assert.deepEqual(old.payload.state.fileFilters.includeGlobs,['src/**']);
  filters.show(false);emit({filesFeatureEnabled:true});await tick();const hiddenCount=filters.messages.length;
  filters.show(true);await tick();assert.equal(filters.messages.length,hiddenCount+1);assert.equal(filters.messages.at(-1).payload.state.filesFeatureEnabled,true);
  const normalPost=filters.webview.postMessage;let failed=true;
  filters.webview.postMessage=async m=>{if(failed){failed=false;return false;}return normalPost(m);};
  emit({canvasSurface:'closed'});await tick();const failedCount=filters.messages.length;emit({});await tick();assert.equal(filters.messages.length,failedCount+1);
  filters.webview.postMessage=async()=>{throw Error('closed view');};emit({canvasSurface:'visible'});await tick();filters.webview.postMessage=normalPost;emit({});await tick();assert.equal(filters.messages.at(-1).payload.state.canvasSurface,'visible');
  filters.disposed.fire();const reopened=view();actions.resolveWebviewView(reopened);reopened.received.fire({type:'sidebarActions/ready'});await tick();assert.equal(reopened.messages.length,1);actions.dispose();
  const list=new CanvasSidebarNodeListView(manager,uri(process.cwd()));const nodes=view();list.resolveWebviewView(nodes);nodes.received.fire({type:'sidebarNodeList/ready'});await list.refresh();nodes.messages.length=0;
  snapshot.nodes[0].metadata.agent.outputSequence++;emit({});await pause(110);assert.equal(nodes.messages.length,0,'output revision is not displayed');
  snapshot.nodes[0].summary='Changed tooltip';emit({});await pause(110);assert.equal(nodes.messages.at(-1).payload.items[0].summary,'Changed tooltip');
  for(const mutate of [()=>snapshot.nodes[0].title='Renamed',()=>snapshot.nodes[0].status='completed',()=>snapshot.nodes[0].metadata.agent.cwd='/new/cwd',
    ()=>{snapshot.groups=[{id:'g',title:'Group',position:{x:0,y:0},size:{width:400,height:400}}];snapshot.nodes[0].groupId='g';}]) {
    mutate();emit({});await pause(110);assert.deepEqual(nodes.messages.at(-1).payload.items,getCanvasSidebarNodeListItems(snapshot,manager.getWorkspaceFoldersForDisplay()));
  }
  const afterGroup=nodes.messages.length;snapshot.groups[0].position.x++;emit({});await pause(110);assert.equal(nodes.messages.length,afterGroup,'geometry is not displayed');
  const successfulNodePost=nodes.webview.postMessage;
  nodes.webview.postMessage=async()=>false;snapshot.nodes[0].title='Retry node delivery';emit({});await pause(110);
  const beforeRetry=nodes.messages.length;nodes.webview.postMessage=successfulNodePost;emit({});await pause(110);
  assert.equal(nodes.messages.length,beforeRetry+1,'failed node delivery must not become a deduplication hit');
  // Continuous notifications must not reset the pending 75 ms publication.
  snapshot.nodes[0].title='During output';let publishedDuringLoad=false;
  for(let i=0;i<12;i++){emit({});await pause(20);publishedDuringLoad ||= nodes.messages.at(-1).payload.items[0].label==='During output';}
  assert(publishedDuringLoad,'continuous output must not starve visible updates');await pause(110);
  nodes.show(false);snapshot.nodes=[];emit({});await pause(110);const beforeShow=nodes.messages.length;nodes.show(true);await list.refreshOperation;assert.equal(nodes.messages.length,beforeShow+1);assert.deepEqual(nodes.messages.at(-1).payload.items,[]);
  const post=nodes.webview.postMessage;let release;nodes.webview.postMessage=async m=>{await new Promise(r=>release=r);return post(m);};
  snapshot.nodes=[{id:'n2',kind:'note',title:'Older',status:'idle',summary:'',metadata:{}}];const older=list.refresh();await tick();snapshot.nodes[0].title='Newest';const newer=list.refresh();
  nodes.webview.postMessage=post;release();await Promise.all([older,newer]);assert.equal(nodes.messages.at(-1).payload.items[0].label,'Newest','async refreshes publish in order');
  nodes.disposed.fire();const reopenedNodes=view();list.resolveWebviewView(reopenedNodes);reopenedNodes.received.fire({type:'sidebarNodeList/ready'});await list.refresh();assert.equal(reopenedNodes.messages.at(-1).payload.items[0].label,'Newest');list.dispose();
  console.log('PASS actual sidebar consumers: event reuse, view-specific equality, fresh bootstrap/reopen, hidden state, delivery retry, bounded refresh and async order');
} finally {delete globalThis.__sidebarTest;await rm(dir,{recursive:true,force:true});}
