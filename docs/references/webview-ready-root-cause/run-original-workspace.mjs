import path from 'node:path';
import fs from 'node:fs/promises';
import {prepareRuntime,launchPreparedVSCodeScenario,prepareMainSmokeHostExtension,resolveStagedSmokeTestPath} from '/home/users/ziyang01.wang-al/projects/dev-session-canvas/scripts/smoke/vscode-smoke-runner.mjs';
const projectRoot='/home/users/ziyang01.wang-al/projects/dev-session-canvas';
const workspacePath='/tmp/dscgate1012';
const debugRoot='/tmp/dwr-original-workspace';
const runtime=await prepareRuntime({debugRoot,runtimeDirName:'ready-original-workspace',userSettings:{'security.workspace.trust.enabled':false}});
const smokeHostRoot=await prepareMainSmokeHostExtension({projectRoot,targetRoot:path.join(debugRoot,'smoke-host')});
const controlFile=path.join(runtime.artifactsDir,'control.json');
const stateFile=path.join(runtime.artifactsDir,'state.json');
const fixtures=path.join(projectRoot,'tests/vscode-smoke/fixtures');
const env={DEV_SESSION_CANVAS_REAL_REOPEN_CONTROL_FILE:controlFile,DEV_SESSION_CANVAS_TEST_CODEX_COMMAND:path.join(fixtures,'fake-agent-provider'),DEV_SESSION_CANVAS_TEST_CLAUDE_COMMAND:path.join(fixtures,'missing-agent-provider'),PATH:fixtures+path.delimiter+process.env.PATH,DEV_SESSION_CANVAS_EXPECTED_RUNTIME_BACKEND:'legacy-detached',DEV_SESSION_CANVAS_EXPECTED_RUNTIME_GUARANTEE:'best-effort',DEV_SESSION_CANVAS_RUNTIME_HOST_BACKEND_OVERRIDE:'systemd-user',DEV_SESSION_CANVAS_TEST_SYSTEMCTL_SHIM:path.join(fixtures,'fake-systemd/systemctl.cjs'),DEV_SESSION_CANVAS_TEST_NODE_PATH:process.execPath,DEV_SESSION_CANVAS_FAKE_SYSTEMD_STATE_DIR:path.join(runtime.artifactsDir,'fake-systemd-state'),DEV_SESSION_CANVAS_FAKE_SYSTEMD_MODE:'success',DBUS_SESSION_BUS_ADDRESS:'',XDG_RUNTIME_DIR:''};
const options={projectRoot,runtime,workspacePath,vscodeExecutablePath:'/tmp/dsc0261v/.vscode-test/vscode-linux-x64-1.141.0/code',extensionDevelopmentPath:smokeHostRoot,extensionTestsPath:resolveStagedSmokeTestPath(smokeHostRoot,'real-reopen-tests.cjs'),disableExtensions:false,disableWorkspaceTrust:true,extensionTestsEnv:env};
for(const phase of ['setup','verify']){
 await fs.writeFile(controlFile,JSON.stringify({phase,artifactDir:runtime.artifactsDir,stateFile}));
 await launchPreparedVSCodeScenario(options);
 if(phase==='setup')await new Promise(resolve=>setTimeout(resolve,3000));
}
try{await fs.access(path.join(runtime.artifactsDir,'fake-systemd-state/systemctl.log'));throw new Error('unexpected systemctl submission');}catch(error){if(error.code!=='ENOENT')throw error;}
console.log('Restored sources: original workspace fallback two-phase passed.');
