// 定位脚本；仅修改复制载荷，不改变正式 smoke 或产品源码。
// 以 563e45c9 的 test:vsix-smoke 生成的 smoke-host 为输入；Node 22：
// xvfb-run -a node docs/references/smoke-reload-autostart/runtime-admission-investigation.mjs burst|serial|raw
import assert from 'node:assert/strict';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { runVSCodeScenario } from '../../../scripts/smoke/vscode-smoke-runner.mjs';

const scenario = process.argv[2];
assert.ok(['burst', 'serial', 'raw'].includes(scenario));
const projectRoot = process.cwd();
const root = path.join(projectRoot, '.debug/runtime-admission-rca');
await mkdir(root, { recursive: true });
const host = path.join(root, 'host-' + scenario);
await cp(path.join(projectRoot, '.debug/vscode-vsix-smoke/smoke-host'), host, { recursive: true });
const bundlePath = path.join(host, 'dist/runtime-supervisor.js');
const baseline = await readFile(bundlePath, 'utf8');
let bundle = baseline;
const probePath = path.join(root, scenario + '-supervisor.ndjson');
await writeFile(probePath, '');
const replacements = [];
function replaceOnce(before, after) {
  assert.equal(bundle.split(before).length, 2, 'Exact baseline anchor: ' + before);
  replacements.push({ before, after });
  bundle = bundle.replace(before, after);
}
if (scenario !== 'raw') {
  const log = (event, detail) => `__dscAdmissionProbe(${JSON.stringify(event)},${detail});`;
  replaceOnce('beginStart(e){return ', 'beginStart(e){' + log('beginStart', `{
    identity:e, identityMatch:this.executions.get(e.executionId)?.identity===e,
    limits:this.admissionLimits, authority:this.snapshot(),
    holders:[...this.starting].map(i=>({identity:i,state:this.executions.get(i.executionId)?.execution.snapshot().state})),
    executions:[...this.executions.values()].map(v=>({identity:v.identity,state:v.execution.snapshot().state,
      resources:Object.keys(v.execution.snapshot().resources)}))
  }`) + 'return ');
  replaceOnce('finishStart(e){this.starting.delete(e)}',
    'finishStart(e){' + log('finishStart', '{identity:e,authority:this.snapshot()}') + 'this.starting.delete(e)}');
  replaceOnce('S=this.executionOwner,d;try{', 'S=this.executionOwner,d;' + log('createEntry', `{
    sessionId:n,kind:t.kind,owner:S?.snapshot(),authority:S?.authority.snapshot(),limits:S?.admissionLimits,
    sessions:[...this.sessions.values()].map(v=>({sessionId:v.sessionId,kind:v.kind,live:v.live,lifecycle:v.lifecycle}))
  }`) + 'try{');
  replaceOnce('if(!Rt(S.admissionLimits,{executions:p.pending+y,pending:p.admissionPending+y}))',
    log('preparationCapacity', '{sessionId:n,kind:t.kind,owner:p,retainedRetirements:y,limits:S.admissionLimits}') +
    'if(!Rt(S.admissionLimits,{executions:p.pending+y,pending:p.admissionPending+y}))');
  replaceOnce('if(y.kind!=="started")throw new Error(`Execution start was ${y.kind}.`);',
    log('startResult', '{sessionId:n,kind:t.kind,result:y.kind,resources:Object.keys(d.snapshot().adapter?.resources??{}),owner:S.snapshot(),authority:S.authority.snapshot()}') +
    'if(y.kind!=="started")throw new Error(`Execution start was ${y.kind}.`);');
  // 独立进程不一定继承测试环境，使用隔离文件的固定绝对路径；不打印 launchSpec/env。
  bundle = `"use strict";function __dscAdmissionProbe(event,detail){require('node:fs').appendFileSync(${JSON.stringify(probePath)},JSON.stringify({at:Date.now(),pid:process.pid,event,...detail})+String.fromCharCode(10));}\n` + bundle;
  await writeFile(bundlePath, bundle);
  execFileSync(process.execPath, ['--check', bundlePath]);
}
const sha = text => createHash('sha256').update(text).digest('hex');
await writeFile(path.join(root, scenario + '-probe.json'), JSON.stringify({ scenario,
  baselineSha256: sha(baseline), instrumentedSha256: sha(bundle), replacements }, null, 2));

const suitePath = path.join(host, 'tests/vscode-smoke/extension-tests.cjs');
const suite = await readFile(suitePath, 'utf8');
const anchor = "  if (smokeScenario === 'local-execution-flow') {";
assert.equal(suite.split(anchor).length, 2);
const experiment = String.raw`
  if (process.env.DEV_SESSION_CANVAS_ADMISSION_INVESTIGATION) {
    const scenario = process.env.DEV_SESSION_CANVAS_ADMISSION_INVESTIGATION;
    const artifacts = process.env.DEV_SESSION_CANVAS_SMOKE_ARTIFACT_DIR;
    const nodes = [];
    const report = {scenario};
    const summarize = snapshot => snapshot.state.nodes.filter(n=>n.kind!=='note').map(n=>({
      id:n.id,kind:n.kind,status:n.status,liveSession:n.metadata[n.kind].liveSession,
      persistenceMode:n.metadata[n.kind].persistenceMode,pendingLaunch:n.metadata[n.kind].pendingLaunch,
      runtimeSessionId:n.metadata[n.kind].runtimeSessionId,lastRuntimeError:n.metadata[n.kind].lastRuntimeError
    }));
    const waitStarted = node => waitForDiagnosticEvents(events=>events.some(e=>
      e.kind==='execution/started' && e.detail.nodeId===node.id),20000);
    const waitLive = node => node.kind==='agent'?waitForAgentLive(node.id):waitForTerminalLive(node.id);
    try {
      if (scenario==='serial') {
        await setRuntimePersistenceEnabled(true);
        await simulateRuntimeReload();
        await ensureEditorCanvasReady();
        for(const kind of ['agent','terminal']) {
          await vscode.commands.executeCommand(COMMAND_IDS.testCreateNode,kind);
          const node=findNodeByKind(await getDebugSnapshot(),kind);
          nodes.push(node);
          await waitStarted(node);
          await waitLive(node);
        }
      } else {
        // 原连续创建 helper 保持不变，等到两个节点各自已有明确结果。
        const prepared=await prepareTrustedBaseNodesForAppliedRuntimePersistenceMode(true);
        nodes.push(prepared.agentNode,prepared.terminalNode);
        await waitForSnapshot(snapshot=>nodes.every(node=>{
          const current=snapshot.state.nodes.find(n=>n.id===node.id);
          return current.status==='error'||current.metadata[node.kind].liveSession;
        }),20000);
      }
      report.initial=summarize(await getDebugSnapshot());
      const failed=report.initial.filter(n=>n.status==='error');
      for(const node of nodes.filter(n=>!failed.some(f=>f.id===n.id))) {
        await waitStarted(node); await waitLive(node);
      }
      report.retry=[];
      for(const node of failed) {
        report.retry.push({id:node.id,kind:node.kind,at:Date.now()});
        await dispatchWebviewMessage({type:'webview/startExecutionSession',payload:{nodeId:node.id,kind:node.kind,cols:80,rows:24}});
        await waitStarted(node); await waitLive(node);
      }
      report.final=summarize(await getDebugSnapshot());
      assert.ok(report.final.every(n=>n.liveSession && n.persistenceMode==='live-runtime'));
      report.events=(await getDiagnosticEvents()).filter(e=>['execution/startRequested','execution/started','execution/candidateStartFailed'].includes(e.kind))
        .map(e=>({timestamp:e.timestamp,kind:e.kind,detail:{kind:e.detail.kind,nodeId:e.detail.nodeId,sessionId:e.detail.sessionId,message:e.detail.message}}));
    } finally {
      await fs.writeFile(path.join(artifacts,'admission-investigation.json'),JSON.stringify(report,null,2));
      for(const node of nodes) {
        if(node.kind==='agent') await ensureAgentStopped(node.id);
        else await ensureTerminalStopped(node.id);
      }
      console.log('Runtime admission investigation completed: '+scenario);
    }
    return;
  }
`;
await writeFile(suitePath, suite.replace(anchor, experiment + anchor));
await runVSCodeScenario({ projectRoot, debugRoot:path.join(root,'native-'+scenario),
  runtimeDirName:'dsc-admission-'+scenario, workspacePath:projectRoot,
  extensionDevelopmentPath:[host,path.join(host,'notifier-extension')], extensionTestsPath:suitePath,
  disableWorkspaceTrust:true,
  extensionTestsEnv:{
    DEV_SESSION_CANVAS_SMOKE_TEST_MODE:'1',DEV_SESSION_CANVAS_SMOKE_SCENARIO:'local-links-and-stop',
    DEV_SESSION_CANVAS_ADMISSION_INVESTIGATION:scenario,
    DEV_SESSION_CANVAS_TEST_CODEX_COMMAND:path.join(projectRoot,'tests/vscode-smoke/fixtures/fake-agent-provider'),
    DEV_SESSION_CANVAS_TEST_CLAUDE_COMMAND:path.join(projectRoot,'tests/vscode-smoke/fixtures/missing-agent-provider')
  }
});
