import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import esbuild from 'esbuild';

// Exercise the actual Host methods with only the editor/terminal boundaries replaced.
const file='extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts';
const source=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
const declaration=source.statements.find(n=>ts.isClassDeclaration(n) && n.name.text==='CanvasPanelManager');
const names=['nativeAttentionEvents','nativeGenerationCache','nativeWorkspaceId','nativeGeneration',
  'isNativeAttentionCurrent','activeNativeAttention','focusNativeAttention','centerNodeInCanvas',
  'buildExecutionAttentionNotificationRequest','setExecutionAttentionPending',
  'publishExecutionAttentionNotification','postExecutionAttentionNotificationToCompanion'];
const members=names.map(name=>{const member=declaration.members.find(m=>m.name?.getText(source)===name);assert.ok(member,name);return member.getText(source);});
const result=await esbuild.build({stdin:{contents:`
import * as vscode from 'vscode';
import {createHash,randomUUID} from 'node:crypto';
import {isNativeEvent,isNativeTarget} from './packages/attention-protocol/src/native.ts';
import {ATTENTION_NOTIFICATION_PROTOCOL_VERSION,NOTIFIER_COMMAND_IDS,isAttentionNotificationDeliveryResult} from './packages/attention-protocol/src/index.ts';
import {COMMAND_IDS} from './extensions/vscode/dev-session-canvas/src/common/extensionIdentity';
const isExecutionNodeKind=k=>k==='terminal'||k==='agent';
const ensureAgentMetadata=n=>n.metadata.agent, ensureTerminalMetadata=n=>n.metadata.terminal;
const updateExecutionNode=(state,id,kind,patch)=>({...state,nodes:state.nodes.map(n=>n.id===id?{...n,...patch}:n)});
const buildExecutionMetadataPatch=(state,id,kind,patch)=>({...state.nodes.find(n=>n.id===id).metadata,[kind]:{...state.nodes.find(n=>n.id===id).metadata[kind],...patch}});
const EXECUTION_ATTENTION_FOCUS_TIMEOUT_MS=1000;
const formatUnknownError=String;
export class Host {${members.join('\n')}}`,loader:'ts',resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',external:['vscode'],write:false});
const require=createRequire(import.meta.url);const commands=[];
let commandResult;
const vscode={workspace:{workspaceFolders:[],workspaceFile:undefined},commands:{executeCommand:async(command)=>{commands.push(command);if(commandResult instanceof Error)throw commandResult;return commandResult;}}};
const module={exports:{}};new Function('require','module','exports',result.outputFiles[0].text)(name=>name==='vscode'?vscode:require(name),module,module.exports);
const host=new module.exports.Host();const uri={toString:()=> 'file:///isolated/source'};
Object.assign(host,{context:{storageUri:uri},state:{nodes:[{id:'n',kind:'terminal',status:'live',metadata:{terminal:{attentionPending:true}}}],selectedNodeIds:['other']},
 executionSessionOperationTokens:new Map(),nonNativeHostExecutions:new Map(),sessions:new Map([['n',{sessionId:'run-1'}]]),
 getExecutionSessionOperationKey:(kind,id)=>`${kind}:${id}`,getExecutionSessions(){return this.sessions;},
 getConfiguredSurface:()=> 'editor',revealSurface:async()=>{},waitForCanvasReady:async()=>{},messages:[],
 postMessageToSurface(surface,message){this.messages.push(message);},recordDiagnosticEvent:()=>{},persistState:async()=>{},postState:()=>{},
 buildExecutionAttentionNotificationTitle:()=> 'title',resolveExecutionAttentionNotificationCwd:()=> '/fixture',
 attentionNotificationBridgeMode:'system',fallbacks:0,showExecutionAttentionNotification:async()=>{host.fallbacks++;}});
const request=()=>host.buildExecutionAttentionNotificationRequest('terminal','n','body','same-key');
const target=event=>Object.fromEntries(['eventId','workspaceId','canvasId','nodeId','executionGeneration'].map(k=>[k,event[k]]));
const first=request().nativeEvent;assert.ok(first);const original=target(first);
assert.equal(await host.focusNativeAttention({...original,eventId:'never-issued'}),false);
assert.equal(await host.focusNativeAttention({...original,workspaceId:'other'}),false);
assert.equal(await host.focusNativeAttention(original),true);assert.equal(host.messages.at(-1).type,'host/centerNode');
assert.deepEqual(host.state.selectedNodeIds,['other']);assert.equal(host.state.nodes[0].metadata.terminal.attentionPending,true);
assert.equal(commands.at(-1),'workbench.action.focusWindow');
host.setExecutionAttentionPending('terminal','n',false,{postState:false,persistState:false});
host.setExecutionAttentionPending('terminal','n',true,{postState:false,persistState:false});
const next=target(request().nativeEvent);assert.notEqual(next.eventId,original.eventId);
assert.equal(await host.focusNativeAttention(original),false,'acknowledged event cannot revive on the same execution');
assert.equal(await host.focusNativeAttention(next),true);
const count=host.messages.length;host.waitForCanvasReady=async()=>{host.sessions.set('n',{sessionId:'run-2'});};
assert.equal(await host.focusNativeAttention(next),false,'generation changes during readiness must prevent centering');assert.equal(host.messages.length,count);
commandResult={status:'unknown',backend:'native-client',activationMode:'direct-action'};
await host.publishExecutionAttentionNotification('terminal','n','body','k');assert.equal(host.fallbacks,0);
commandResult=new Error('connection lost after send');
await host.publishExecutionAttentionNotification('terminal','n','body','k');assert.equal(host.fallbacks,0);
commandResult={status:'error',backend:'native-client',activationMode:'none',detail:'app-unavailable'};
await host.publishExecutionAttentionNotification('terminal','n','body','k');assert.equal(host.fallbacks,1);
console.log('Native Host routing: issued identity, same-run re-attention, asynchronous generation change, center-only and unknown-safe fallback passed');
