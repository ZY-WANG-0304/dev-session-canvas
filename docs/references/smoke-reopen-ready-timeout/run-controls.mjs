import path from 'node:path';
import fs from 'node:fs/promises';
import {prepareRuntime,launchPreparedVSCodeScenario,prepareMainSmokeHostExtension,resolveStagedSmokeTestPath} from '/home/users/ziyang01.wang-al/projects/dev-session-canvas/scripts/smoke/vscode-smoke-runner.mjs';
const projectRoot=process.cwd();
const mode=process.argv[2];
if(!['cap4','no-ready'].includes(mode))throw new Error('Expected cap4 or no-ready');
const debugRoot=`/tmp/dwr-budget-${mode}`;
const runtime=await prepareRuntime({debugRoot,runtimeDirName:`ready-budget-${mode}`,userSettings:{'security.workspace.trust.enabled':false}});
const smokeHostRoot=await prepareMainSmokeHostExtension({projectRoot,targetRoot:path.join(debugRoot,'smoke-host')});
const fixturePath=resolveStagedSmokeTestPath(smokeHostRoot,'real-reopen-tests.cjs');
let fixture=await fs.readFile(fixturePath,'utf8');
fixture=fixture.replace("  await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'editor', CANVAS_READY_TIMEOUT_MS);",`  const start = Date.now();
  try {
    await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'editor', CANVAS_READY_TIMEOUT_MS);
    console.log('[budget-test]', JSON.stringify({phase, result:'ready', elapsedMs:Date.now()-start, snapshot:await getDebugSnapshot()}));
  } catch(error) {
    console.log('[budget-test]', JSON.stringify({phase, result:'timeout', elapsedMs:Date.now()-start, error:String(error)}));
    throw error;
  }`);
if(mode==='cap4')fixture=fixture.replace('  await activateExtension();\n  await openCanvasEditor();\n\n  const expected =',`  await activateExtension();
  for(let iteration=1;iteration<=3;iteration+=1){
    await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInEditor);
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    console.log('[budget-test]', JSON.stringify({phase,iteration,step:'repeat'}));
    await openCanvasEditor();
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  }
  await openCanvasEditor();

  const expected =`);
await fs.writeFile(fixturePath,fixture);
const controlFile=path.join(runtime.artifactsDir,'control.json');
const stateFile=path.join(runtime.artifactsDir,'state.json');
const fixtures=path.join(projectRoot,'tests/vscode-smoke/fixtures');
const env={DEV_SESSION_CANVAS_REAL_REOPEN_CONTROL_FILE:controlFile,DEV_SESSION_CANVAS_TEST_CODEX_COMMAND:path.join(fixtures,'fake-agent-provider'),DEV_SESSION_CANVAS_TEST_CLAUDE_COMMAND:path.join(fixtures,'missing-agent-provider'),PATH:fixtures+path.delimiter+process.env.PATH,DEV_SESSION_CANVAS_EXPECTED_RUNTIME_BACKEND:'legacy-detached',DEV_SESSION_CANVAS_EXPECTED_RUNTIME_GUARANTEE:'best-effort',DEV_SESSION_CANVAS_RUNTIME_HOST_BACKEND_OVERRIDE:'systemd-user',DEV_SESSION_CANVAS_TEST_SYSTEMCTL_SHIM:path.join(fixtures,'fake-systemd/systemctl.cjs'),DEV_SESSION_CANVAS_TEST_NODE_PATH:process.execPath,DEV_SESSION_CANVAS_FAKE_SYSTEMD_STATE_DIR:path.join(runtime.artifactsDir,'fake-systemd-state'),DEV_SESSION_CANVAS_FAKE_SYSTEMD_MODE:'success',DBUS_SESSION_BUS_ADDRESS:'',XDG_RUNTIME_DIR:''};
const options={projectRoot,runtime,workspacePath:projectRoot,vscodeExecutablePath:mode==='cap4'?'/tmp/dsc-ready-vscode/.vscode-test/vscode-linux-x64-1.141.0/code':'/tmp/dsc0261v/.vscode-test/vscode-linux-x64-1.141.0/code',extensionDevelopmentPath:smokeHostRoot,extensionTestsPath:fixturePath,disableExtensions:false,disableWorkspaceTrust:true,extraLaunchArgs:['--remote-debugging-port=38993','--remote-debugging-address=127.0.0.1'],extensionTestsEnv:env};
for(const phase of ['setup','verify']){
 if(mode==='no-ready' && phase==='verify'){
  const bundlePath=path.join(smokeHostRoot,'dist/webview.js');
  const bundle=await fs.readFile(bundlePath,'utf8');
  const needle='type: "webview/ready"';
  if(bundle.split(needle).length!==2)throw new Error('Expected one ready send');
  await fs.writeFile(bundlePath,bundle.replace(needle,'type: "webview/diagReadySuppressed"'));
 }
 await fs.writeFile(controlFile,JSON.stringify({phase,artifactDir:runtime.artifactsDir,stateFile}));
 await launchPreparedVSCodeScenario(options);
 if(phase==='setup')await new Promise(resolve=>setTimeout(resolve,3000));
}
try{await fs.access(path.join(runtime.artifactsDir,'fake-systemd-state/systemctl.log'));throw new Error('unexpected systemctl submission');}catch(error){if(error.code!=='ENOENT')throw error;}
console.log(`Ready budget ${mode} full fallback two-phase passed.`);
