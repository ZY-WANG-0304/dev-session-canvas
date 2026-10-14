// Temporary investigation: production bundles plus observation hooks; no formal tests or source edited.
import assert from 'node:assert/strict';
import { cp, mkdir, readFile, writeFile, symlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { runVSCodeScenario, stageSmokeTestSuite } from '../../../scripts/smoke/vscode-smoke-runner.mjs';
const mode = process.argv[2];
assert.ok(['probe','control'].includes(mode));
const projectRoot = process.cwd();
const root = path.join(projectRoot, '.debug', 'final-save-' + mode);
const host = path.join(root, 'host');
await mkdir(host, { recursive: true });
const source = path.join(projectRoot,'extensions/vscode/dev-session-canvas');
for(const entry of ['dist','images','resources','scripts','l10n','package.nls.json','package.nls.zh-cn.json'])
  await cp(path.join(source,entry),path.join(host,entry),{recursive:true});
const manifest=JSON.parse(await readFile('/tmp/dsc261fresh/extensions/vscode/dev-session-canvas/package.json','utf8'));
delete manifest.extensionDependencies; delete manifest.extensionPack;
await writeFile(path.join(host,'package.json'),JSON.stringify(manifest));
await symlink(path.join(projectRoot,'node_modules'),path.join(host,'node_modules'));
await stageSmokeTestSuite({projectRoot,targetRoot:host});
const notifier=path.join(host,'notifier-extension'); await mkdir(notifier,{recursive:true});
for(const entry of ['package.json','dist','images']) await cp(path.join(projectRoot,'extensions/vscode/dev-session-canvas-notifier',entry),path.join(notifier,entry),{recursive:true});
const hashes={};
for(const name of ['extension.js','runtime-supervisor.js','webview.js']) hashes[name]=createHash('sha256').update(await readFile(path.join(host,'dist',name))).digest('hex');
const bundlePath=path.join(host,'dist/extension.js');
let bundle=await readFile(bundlePath,'utf8');
assert.equal(bundle.split('getDebugSnapshot(){').length,2);
bundle=bundle.replace('getDebugSnapshot(){','getDebugSnapshot(){globalThis.__dscFinalManager=this;');
await writeFile(bundlePath,bundle);
await writeFile(path.join(root,'input.json'),JSON.stringify({mode,main:'eee25291109e7e3bad27e6841520f3f4a5d14dcc',releaseHead:'20d237c5176a6cd05486d5b58c5ecf4f55f7bcd9',hashes,observerBundle:createHash('sha256').update(bundle).digest('hex'),vscode:'1.141.0',scope:'Rebuilt production bundles, release manifest, original suite with observer; not original CI VSIX'},null,2));
const suitePath=path.join(host,'tests/vscode-smoke/extension-tests.cjs');
let suite=await readFile(suitePath,'utf8');
const helper=String.raw`
const finalTraces=[];
const saveTrace=()=>fsSync.writeFileSync(path.join(artifactDir,'final-save-trace.json'),JSON.stringify(finalTraces,null,2));
function traceFinal(phase, manager, records, extra={}) {
 finalTraces.push({phase,at:new Date().toISOString(),nodes:manager.state.nodes.map(n=>({id:n.id,kind:n.kind,title:n.title})),records:records.map(r=>({nodeId:r.nodeId,kind:r.kind,identity:r.execution.identity,owner:r.execution.snapshot(),persistence:r.persistence&&{submitted:r.persistence.submitted,result:r.persistence.result}})),...extra}); saveTrace();
}
async function observedReset(line) {
 await getDebugSnapshot(); const m=globalThis.__dscFinalManager; assert.ok(m);
 const records=[...m.nonNativeHostExecutions.values()];
 traceFinal('reset-enter',m,records,{line,stack:new Error().stack});
 for(const r of records) if(r.persistence) void r.persistence.promise.then(()=>traceFinal('save-settled',m,[r],{line}));
 const original=m.assertNonNativeHostPersistenceComplete.bind(m);
 m.assertNonNativeHostPersistenceComplete=rs=>{traceFinal('immediate-check',m,rs,{line});return original(rs);};
 try {
  if(process.env.DSC_FINAL_SAVE_MODE==='control') {
   const expectedExecutions=records.map(r=>({kind:r.kind,id:r.nodeId}));
   await resetCanvasAfterFinalPersistence({reset:()=>vscode.commands.executeCommand(COMMAND_IDS.testResetState),getSnapshot:getDebugSnapshot,getDiagnosticEvents,expectedExecutions});
  } else await vscode.commands.executeCommand(COMMAND_IDS.testResetState);
  traceFinal('reset-return',m,records,{line});
 } catch(error) {
  traceFinal('reset-threw',m,records,{line,error:error.message});
  // Observe original saves after the operation already failed, without authorizing another reset.
  await Promise.race([Promise.all(records.flatMap(r=>r.persistence?[r.persistence.promise]:[])),new Promise((_,reject)=>setTimeout(()=>reject(new Error('Observation of original save timed out')),10000))]);
  traceFinal('after-rejected-reset-save',m,records,{line});
  throw error;
 } finally {m.assertNonNativeHostPersistenceComplete=original;}
}
`;
suite=suite.replace('let lastWebviewProbe;',helper+'\nlet lastWebviewProbe;');
const start=suite.indexOf('async function verifyCanvasTemplatesTrusted()');
const end=suite.indexOf('async function verifyCanvasTemplatesRestricted()',start);
let portion=suite.slice(start,end);
let line=1017;
portion=portion.replaceAll('await vscode.commands.executeCommand(COMMAND_IDS.testResetState);',()=>`await observedReset(${line++});`);
// Only the original template function is scoped for the control; all assertions are preserved.
suite=suite.slice(0,start)+portion+suite.slice(end);
await writeFile(suitePath,suite);
console.log('Investigation '+mode+' at '+root);
await runVSCodeScenario({projectRoot,debugRoot:path.join(root,'runtime'),runtimeDirName:'dsc-final-save-'+mode,
 vscodeExecutablePath:'/tmp/dsc-ready-vscode/.vscode-test/vscode-linux-x64-1.141.0/code',
 workspacePath:projectRoot,extensionDevelopmentPath:[host,notifier],extensionTestsPath:suitePath,disableWorkspaceTrust:true,
 extensionTestsEnv:{DEV_SESSION_CANVAS_SMOKE_TEST_MODE:'1',DEV_SESSION_CANVAS_SMOKE_SCENARIO:'trusted',DSC_FINAL_SAVE_MODE:mode,
 DEV_SESSION_CANVAS_TEST_CODEX_COMMAND:path.join(projectRoot,'tests/vscode-smoke/fixtures/fake-agent-provider'),
 DEV_SESSION_CANVAS_TEST_CLAUDE_COMMAND:path.join(projectRoot,'tests/vscode-smoke/fixtures/missing-agent-provider')}});
