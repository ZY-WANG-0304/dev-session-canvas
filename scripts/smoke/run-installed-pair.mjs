import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { environmentPolicy, infrastructureBudgets } from '../gates/catalog.mjs';
import { retireProcessGroup } from '../gates/process.mjs';
import { withinDeadline } from '../gates/deadline.mjs';
import { prepareNotificationReceiver, readNotificationInvocation } from './notification-receiver.mjs';
import { NOTIFIER_ZH_CN_LANGUAGE_PACK_FIXTURE,stageLanguagePackFixture } from './notifier-smoke-utils.mjs';
import { readJSON, objectDigest, verifyPackageFiles, writeJSON, fileDigest } from '../gates/receipts.mjs';
import { validateFrozenPlan, assertFormalEnvironment } from '../gates/resolve-plan.mjs';
import { inspectVsix } from '../release/build-release-candidate.mjs';
import { buildVSCodeArgs, buildVSCodeChildEnv, ensureVSCodeExecutable, prepareRuntime,
  shouldReRunInsideXvfb, runInsideXvfb, snapshotVSCodeLogs } from './vscode-smoke-runner.mjs';
import { installCandidateVsix } from './installed-execution-candidate.mjs';
import { processIdentity, waitForHostAbsence } from './host-evidence.mjs';
import { openInstalledNotificationCallback } from './installed-notification-callback.mjs';
import { observeInstalledPublicExit } from './installed-public-exit.mjs';
import { resizeInstalledNode, observeInstalledCanvas, installedNodeIsCentered,
  installedGeometryMatchesResize, prepareInstalledLocalizedStop } from './installed-ui-observation.mjs';

const { values } = parseArgs({ options: { plan: { type: 'string' }, candidate: { type: 'string' }, output: { type: 'string' } } });
assert(values.plan && values.candidate && values.output);
assertFormalEnvironment();
const plan = validateFrozenPlan(await readJSON(values.plan));
const candidate = path.resolve(values.candidate), output = path.resolve(values.output);
const packageReceipt = await readJSON(path.join(candidate, 'package-receipt.json'));
await verifyPackageFiles(packageReceipt, plan, candidate);
assert.equal(process.arch, 'x64', 'Original-pair installation is explicitly limited to three x64 runners');
if (shouldReRunInsideXvfb()) process.exit(runInsideXvfb(fileURLToPath(import.meta.url), process.cwd()));
await fs.mkdir(output, { recursive: true });
const nonce = randomUUID();
const deadline=Number(process.env.DEV_SESSION_CANVAS_GATE_DEADLINE);
assert(Number.isFinite(deadline)&&deadline>Date.now(),'Installed pair must inherit its original work deadline');
const cleanupDeadline=Number(process.env.DEV_SESSION_CANVAS_GATE_CLEANUP_DEADLINE);
assert(Number.isFinite(cleanupDeadline)&&cleanupDeadline>=deadline,'Installed pair requires a frozen cleanup reserve');
let receiver, runtime, driverRoot, child, log, childExit, browser, originalHost;
let attachLog, driverCommand, wait, failure, facts = {}, hostExit = 'not-run', failureList = [];
const originalHosts = [], publicExits = [];
let actionCompletedAt, unsettled = false, abortRetirement;
let writes = Promise.resolve();
const settlementLimit = () => Math.min(cleanupDeadline, Date.now() + 10000);
const bounded = (label, limit, operation) => withinDeadline(label, limit, operation,
  { settlementDeadline: Math.max(limit, settlementLimit()) });
try {
await withinDeadline('Installed public actions', deadline, async signal => {
  const abort = () => {
    // Expiry fails the work independently of the subsequent forced retirement.
    // Closing CDP interrupts any in-flight browser operation before cleanup.
    abortRetirement ??= Promise.allSettled([
      browser?.close(), child?.pid ? retireProcessGroup(child.pid, {
        graceMs: Math.max(1, Math.min(5000, cleanupDeadline - Date.now())), killMs: 3000 }) : undefined
    ]);
  };
  signal.addEventListener('abort', abort, { once: true });
  try {
receiver=await prepareNotificationReceiver(path.join(output,'notification-receiver'),Math.min(deadline,Date.now()+60000));
runtime = await prepareRuntime({ debugRoot: path.join(output, 'runtime'), runtimeDirName: `dsc-pair-${nonce}`,
  userDataInRuntimeDir: true,
  userSettings: { 'security.workspace.trust.enabled': false, 'workbench.startupEditor': 'none',
    'extensions.autoCheckUpdates': false, 'extensions.autoUpdate': false,
    'devSessionCanvas.notifications.attentionSignalBridge':'system',
    'devSessionCanvas.notifications.enabledAttentionSignals':['osc9','osc777'],
    'devSessionCanvas.runtimePersistence.enabled': false, 'devSessionCanvas.terminal.shell': 'default',
    'devSessionCanvas.terminal.shellPath': process.platform === 'win32'
      ? path.join(process.env.SystemRoot, 'System32/cmd.exe') : '/bin/sh' } });
facts.runtime = { runtimeDir: runtime.runtimeDir, userDataDir: runtime.userDataDir, tmpDir: runtime.tmpDir };
process.env.DEV_SESSION_CANVAS_VSCODE_VERSION = environmentPolicy.vscode;
const executable = await ensureVSCodeExecutable(process.cwd(), { evidenceDir: runtime.artifactsDir });
const expected = [];
// Install the original companion first so activation never depends on a
// Marketplace download of another version while accepting this private pair.
for (const pkg of [...packageReceipt.packages].sort((a,b)=>Number(b.id.endsWith('-notifier'))-Number(a.id.endsWith('-notifier')))) {
  const inspected = await inspectVsix(path.join(candidate, pkg.path), pkg.id, pkg.version);
  expected.push({ ...pkg, manifest: inspected.manifest,files:inspected.extensionFiles.filter(file=>file.path!=='package.json') });
  await installCandidateVsix({ vscodeExecutablePath: executable, runtime,logName:`installed-${pkg.path}.json`,
    deadline, input: { vsixPath: path.join(candidate, pkg.path), vsixSha256: pkg.sha256 } });
}
const port = await new Promise((resolve, reject) => {
  const server = net.createServer();
  const timer=setTimeout(()=>{server.close();reject(new Error('Private CDP port allocation deadline exhausted'));},
    Math.max(1,Math.min(5000,deadline-Date.now())));
  server.once('error',error=>{clearTimeout(timer);reject(error);});
  server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(error => {
    clearTimeout(timer);error ? reject(error) : resolve(port);
  }); });
});
driverRoot = path.join(output, 'public-driver'); await fs.mkdir(driverRoot);
await writeJSON(path.join(driverRoot, 'package.json'), { publisher: 'devsessioncanvas-gates', name: 'installed-pair-driver',
  version: '0.0.0', engines: { vscode: '^1.80.0' }, main: './driver.cjs', activationEvents: ['onStartupFinished'],
  extensionKind: ['workspace'] });
const driverReceipt = path.join(output, 'public-driver.json');
const requestPath = path.join(output, 'driver-request.json'), responsePath = path.join(output, 'driver-response.json');
// This development driver never enables extensionTestsPath or product smoke
// mode. Only the driver is loaded as development; both subjects stay installed.
await fs.copyFile(fileURLToPath(new URL('./installed-pair-driver.cjs',import.meta.url)),path.join(driverRoot,'driver.cjs'));
await writeJSON(path.join(driverRoot,'config.json'),{expected,workspace:output,extensionsDir:runtime.extensionsDir,
  receipt:driverReceipt,request:requestPath,response:responsePath,notificationReceiver:receiver.executable,
  notificationCapture:receiver.capture,notificationActivate:receiver.release});

const env = buildVSCodeChildEnv({...runtime.environment,...receiver.env});
for (const key of Object.keys(env)) if (/^DEV_SESSION_CANVAS_(?:SMOKE|TEST|GATE)/.test(key)) delete env[key];
const args = buildVSCodeArgs({ workspacePath: output, extensionDevelopmentPath: driverRoot,
  userDataDir: runtime.userDataDir, extensionsDir: runtime.extensionsDir, disableWorkspaceTrust: true,
  disableExtensions: false, extraLaunchArgs: [`--remote-debugging-port=${port}`, '--locale=en', '--force-disable-user-env'] });
assert(!args.some(arg => arg.startsWith('--extensionTestsPath')));
log = await fs.open(path.join(output, 'host.log'), 'wx');
attachLog=process=>{process.stdout.on('data',chunk=>{writes=writes.then(()=>log.write(chunk));});
  process.stderr.on('data',chunk=>{writes=writes.then(()=>log.write(chunk));});};
child = spawn(executable, args, { env, stdio: ['ignore', 'pipe', 'pipe'],detached:process.platform!=='win32' });attachLog(child);
childExit=once(child,'close').then(([code,signal])=>({code,signal}));childExit.catch(()=>{});
wait = async (label, read, predicate, requestedDeadline = Date.now() + 20000) => {
  let value;
  const limit=Math.min(requestedDeadline,deadline);
  while (Date.now() < limit) {
    signal.throwIfAborted();
    try { value = await read(); signal.throwIfAborted();
      if (Date.now() <= limit && predicate(value)) return value; }
    catch (error) { if (!['ENOENT', 'ECONNREFUSED'].includes(error.code)
      && error.cause?.code !== 'ECONNREFUSED') throw error; }
    await new Promise(resolve => setTimeout(resolve, Math.max(1,Math.min(100,limit-Date.now()))));
  }
  throw new Error(`${label} timed out: ${JSON.stringify(value)}`);
};
driverCommand = async (command, args, requestedDeadline = Date.now() + 20000) => {
  const id = randomUUID(); await fs.rm(responsePath, { force: true });
  await writeJSON(requestPath, { id, command, args });
  const response = await wait('Public driver response', () => readJSON(responsePath), response => response.id === id, requestedDeadline);
  assert(!response.error, response.error); return response.status==='exit-requested'?response:response.result;
};
  const driver = await wait('Installed subject activation', () => readJSON(driverReceipt), value => value.subjects?.length === 2,
    Date.now() + 180000);
  facts.driver=driver;
  facts.productManifestsUnmodified=true;
  facts.desktopPresentation='observational';
  originalHost = await processIdentity(driver.hostPID, deadline); assert(originalHost); originalHosts.push(originalHost);
  await wait('CDP startup', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) });
    return response.ok;
  }, value => value === true, Date.now() + 180000);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`,{timeout:Math.max(1,Math.min(20000,deadline-Date.now()))});
  for (const context of browser.contexts()) { context.setDefaultTimeout(20000);context.setDefaultNavigationTimeout(20000); }
  await driverCommand('devSessionCanvas.openCanvasInEditor',[]);
  await driverCommand('devSessionCanvas.createTerminalFromExplorerResource',[]);
  const frame = await wait('Original package canvas', async () => {
    for (const context of browser.contexts()) for (const page of context.pages()) for (const frame of page.frames()) {
      if (await frame.locator('[data-node-kind="terminal"]').count()) return frame;
    }
    return null;
  }, value => value !== null);
  const nodeID = await frame.locator('[data-node-kind="terminal"]').last().getAttribute('data-node-id'); assert(nodeID);
  const node = frame.locator(`[data-node-kind="terminal"][data-node-id=${JSON.stringify(nodeID)}]`);
  const textarea = node.locator('textarea.xterm-helper-textarea'); await textarea.waitFor({ state: 'attached' });
  await wait('Original installed Terminal mounted first output',()=>node.locator('.xterm-rows').innerText(),text=>/\S/u.test(text));
  const marker = `INSTALLED_PAIR_${nonce.replaceAll('-', '')}`;
  const type=async text=>{await textarea.focus();await frame.page().keyboard.insertText(text);await textarea.press('Enter');};
  await type(`echo ${marker}`);
  await wait('Real installed Terminal output', () => node.locator('.xterm-rows').innerText(), value =>
    value.split('\n').filter(line => line.trim() === marker).length > 0);
  facts.terminal={nodeID,marker,outputObserved:true};
  const geometryFile = path.join(output, 'child-geometry.json');
  const subject = path.join(output, 'geometry-subject.cjs');
  await fs.copyFile(fileURLToPath(new URL('./installed-geometry-subject.cjs', import.meta.url)), subject);
  await type(`"${process.execPath}" "${subject}" "${geometryFile}"`);
  const before = await wait('PTY child geometry', () => readJSON(geometryFile), value =>
    value.nonce === 'startup' && value.cols > 0 && value.rows > 0);
  const subjectIdentity = await processIdentity(before.pid, deadline); assert(subjectIdentity);
  const shellIdentity=await processIdentity(before.ppid, deadline);assert(shellIdentity,'Original Terminal shell identity is unavailable');
  Object.assign(facts.terminal,{before,subjectIdentity,shellIdentity});
  await node.locator('.window-chrome').click();
  facts.terminal.nodeBefore = await node.boundingBox();
  const resizeDeadline = Math.min(deadline, Date.now() + 20000);
  facts.terminal.resizeDeadline = resizeDeadline;
  const gesture=await resizeInstalledNode(frame,node);
  facts.terminal.gesture=gesture;
  facts.terminal.nodeAfter = await wait('Original installed node dimensions change after public resize', () => node.boundingBox(), box =>
    box && (Math.abs(box.width - facts.terminal.nodeBefore.width) > 1 || Math.abs(box.height - facts.terminal.nodeBefore.height) > 1), resizeDeadline);
  const geometryNonce = randomUUID().replaceAll('-', '');
  const requestedAt = Date.now();
  facts.terminal.geometryRequest = { nonce: geometryNonce, requestedAt };
  await type(`geometry:${geometryNonce}`);
  const after = await wait('Installed product resize changes real child geometry', () => readJSON(geometryFile), value =>
    installedGeometryMatchesResize(before, value, facts.terminal.geometryRequest), resizeDeadline);
  facts.terminal.after=after;
  await node.getByRole('button', { name: 'Stop', exact: true }).click();
  const stopped=await waitForHostAbsence(subjectIdentity,Math.min(deadline,Date.now()+30000));
  const shellStopped=await waitForHostAbsence(shellIdentity,Math.min(deadline,Date.now()+30000));
  await node.locator('[data-node-action-id=restart]').waitFor();
  Object.assign(facts.terminal,{stopped,shellStopped,publicStopObserved:true});
  await driverCommand('devSessionCanvas.createTerminalFromExplorerResource',[]);
  const notificationNodeID=await wait('New notification Terminal reaches installed canvas',()=>frame.locator('[data-node-kind="terminal"]').last().getAttribute('data-node-id'),
    value=>Boolean(value)&&value!==nodeID);
  const notificationNode=frame.locator(`[data-node-kind="terminal"][data-node-id=${JSON.stringify(notificationNodeID)}]`);
  const notificationInput=notificationNode.locator('textarea.xterm-helper-textarea');
  await wait('Notification Terminal mounted first output',()=>notificationNode.locator('.xterm-rows').innerText(),text=>/\S/u.test(text));
  facts.notificationRoute={notificationNodeID};
  const notify=path.join(output,'emit-notification.cjs');
  const notificationPIDFile=path.join(output,'notification-subject.json');
  await fs.writeFile(notify,`require('node:fs').writeFileSync(${JSON.stringify(notificationPIDFile)},JSON.stringify({pid:process.pid,ppid:process.ppid}));
    const readline=require('node:readline');readline.createInterface({input:process.stdin}).on('line',line=>{
    if(line==='notify')process.stdout.write('\\x1b]9;${marker}\\x07');});\n`);
  await notificationInput.focus();await frame.page().keyboard.insertText(`"${process.execPath}" "${notify}"`);await notificationInput.press('Enter');
  const notificationProcess=await wait('Original notification subject startup',()=>readJSON(notificationPIDFile),value=>Number.isSafeInteger(value.pid));
  const notificationSubject=await processIdentity(notificationProcess.pid, deadline),notificationShell=await processIdentity(notificationProcess.ppid, deadline);
  assert(notificationSubject&&notificationShell,'Original notification Terminal processes are unobservable');
  Object.assign(facts.notificationRoute,{notificationSubject,notificationShell});
  await fs.rm(receiver.capture,{force:true});await fs.rm(receiver.release,{force:true});
  await notificationInput.focus();await frame.page().keyboard.insertText('notify');await notificationInput.press('Enter');
  const received=await wait('Original main to notifier OS route',()=>readJSON(receiver.capture),value=>Array.isArray(value.args));
  const invocation=readNotificationInvocation(received);
  assert(invocation.message.includes(marker),'Notifier receiver did not observe this real Terminal notification');
  assert(invocation.callback==='direct-action'||/^vscode[^:]*:\/\//.test(invocation.callback));
  Object.assign(facts.notificationRoute,{received,invocation});
  await wait('Main node attention',()=>notificationNode.locator('.window-chrome').getAttribute('data-execution-attention-pending'),value=>value==='true');
  // Select the already stopped original node and fit the entire scene. The
  // real target must be displaced before its callback can prove centering.
  await frame.locator('.react-flow__controls-fitview').click();
  await node.locator('.window-chrome').click();
  const selected=await wait('Different node selected before notification callback',()=>observeInstalledCanvas(frame,notificationNodeID),
    value=>value?.selected.length===1&&value.selected[0]===nodeID&&value.attention==='true');
  facts.notificationRoute.selectedBeforeCallback=selected;
  const beforeCallback=await wait('Notification target displaced before callback',()=>observeInstalledCanvas(frame,notificationNodeID),
    value=>value!==null&&!installedNodeIsCentered(value)
      && Math.hypot(value.centerDistance.x,value.centerDistance.y)>40);
  assert.deepEqual(beforeCallback.selected,selected.selected);
  facts.notificationRoute.beforeCallback=beforeCallback;
  const callbackDeadline = Math.min(deadline, Date.now() + 20000);
  facts.notificationRoute.callbackDeadline = callbackDeadline;
  await fs.writeFile(receiver.release,'activate\n');
  if(invocation.callback!=='direct-action') {
    facts.notificationRoute.callbackConfirmation = [];
    await openInstalledNotificationCallback({ page: frame.page(), callback: invocation.callback, deadline: callbackDeadline,
      describe: (callback, limit) => driverCommand('driver/describeUri', [callback], limit),
      open: (callback, limit) => driverCommand('vscode.open', [callback], limit),
      record: evidence => { facts.notificationRoute.callbackConfirmation.push({ ...evidence, observedAt: Date.now() }); } });
  }
  const afterCallback=await wait('Notifier callback centers original node',()=>observeInstalledCanvas(frame,notificationNodeID),installedNodeIsCentered,callbackDeadline);
  assert.deepEqual(afterCallback.selected,beforeCallback.selected,'Notification callback must preserve the user selection');
  assert.equal(afterCallback.attention,'true','Notification callback must keep attention until the user clicks the target');
  assert.notEqual(afterCallback.activeElement.nodeID,notificationNodeID,'Notification callback must not focus target input');
  facts.notificationRoute.afterCallback=afterCallback;
  await notificationNode.locator('.window-chrome').click();
  await wait('User click acknowledges notification target',()=>notificationNode.locator('.window-chrome').getAttribute('data-execution-attention-pending'),value=>value==='false');
  facts.notificationRoute.userAcknowledged=true;
  await notificationNode.locator('[data-node-action-id=stop]').click();
  const notificationRetirement={subject:await waitForHostAbsence(notificationSubject,Math.min(deadline,Date.now()+30000)),
    shell:await waitForHostAbsence(notificationShell,Math.min(deadline,Date.now()+30000))};
  await notificationNode.locator('[data-node-action-id=restart]').waitFor();
  facts.notificationRoute.notificationRetirement=notificationRetirement;
  const invalid = await driverCommand('devSessionCanvasNotifier.postSystemNotification', [{}]);
  assert.equal(invalid.status, 'error', 'Notifier public command must validate the request');
  facts.notificationRoute.invalidRequestRejected=true;
  // Locale is an independent installed UI check. Publicly close the scene
  // so restart cannot restore its inner frame before the observer attaches.
  await driverCommand('workbench.action.closeAllEditors',[]);
  await wait('Original canvas closed before independent locale restart',()=>frame.isDetached(),value=>value===true);
  let exited;childExit.then(value=>{exited=value;});
  facts.publicExitSteps=[];
  publicExits.push({ locale: 'en', ...await observeInstalledPublicExit({ platform: process.platform,
    command: driverCommand, readChildExit: () => exited, expectedHost: originalHost, observeHost: waitForHostAbsence,
    deadline: Math.min(deadline, Date.now() + infrastructureBudgets.hostExit),
    record: step => facts.publicExitSteps.push({ locale: 'en', ...step }) }) });
  await browser.close();browser=undefined;
  await stageLanguagePackFixture(runtime,NOTIFIER_ZH_CN_LANGUAGE_PACK_FIXTURE);
  await fs.rm(driverReceipt,{force:true});
  const localeArgs=args.map(arg=>arg==='--locale=en'?'--locale=zh-cn':arg);
  child=spawn(executable,localeArgs,{env,stdio:['ignore','pipe','pipe'],detached:process.platform!=='win32'});attachLog(child);
  childExit=once(child,'close').then(([code,signal])=>({code,signal}));childExit.catch(()=>{});
  const localized=await wait('Original subjects reactivate with zh-cn',()=>readJSON(driverReceipt),value=>value.subjects?.length===2,
    Math.min(deadline,Date.now()+infrastructureBudgets.hostStartup));
  assert.equal(localized.locale.toLowerCase(),'zh-cn');originalHost=await processIdentity(localized.hostPID, deadline);assert(originalHost);
  originalHosts.push(originalHost);
  await wait('Locale CDP startup',async()=>{try{return (await fetch(`http://127.0.0.1:${port}/json/version`,{signal:AbortSignal.timeout(1000)})).ok;}
    catch(error){if(error.cause?.code==='ECONNREFUSED')return false;throw error;}},value=>value===true);
  browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`,{timeout:Math.max(1,Math.min(20000,deadline-Date.now()))});
  for (const context of browser.contexts()) { context.setDefaultTimeout(20000);context.setDefaultNavigationTimeout(20000); }
  facts.locales={en:driver.locale,zh:localized.locale};
  for(const command of ['workbench.view.extension.devSessionCanvasNotifier','devSessionCanvasNotifier.status.focus',
    'devSessionCanvasNotifier.notes.focus','devSessionCanvasNotifier.codex.focus'])await driverCommand(command,[]);
  const localeText=await wait('Unmodified notifier sidebar localization',async()=>{
    const texts=[];for(const context of browser.contexts())for(const page of context.pages())for(const candidateFrame of page.frames())
      texts.push(await candidateFrame.locator('body').innerText().catch(()=>''));return texts.join('\n');
  },text=>text.includes('当前环境')&&text.includes('发送测试通知')&&text.includes('本机 UI 端'));
  facts.locales.notifierText=localeText;
  await driverCommand('devSessionCanvas.openCanvasInEditor',[]);
  const localizedFrame=await wait('Original zh-cn canvas',async()=>{
    for(const context of browser.contexts())for(const page of context.pages())for(const candidateFrame of page.frames())
      if(await candidateFrame.locator('.canvas-shell').count())return candidateFrame;
    return null;
  },value=>value!==null);
  facts.locales.terminalPreparation=[];
  const {nodeID:localizedNodeID,stop:localizedStop,deadline:localizedActionDeadline}=await prepareInstalledLocalizedStop({
    frame:localizedFrame,create:limit=>driverCommand('devSessionCanvas.createTerminalFromExplorerResource',[],limit),
    deadline:Math.min(deadline,Date.now()+20000),record:step=>facts.locales.terminalPreparation.push(step) });
  await localizedStop.click({timeout:Math.max(1,localizedActionDeadline-Date.now())});
  assert(Date.now()<=localizedActionDeadline,'Original localized Stop deadline exhausted');
  facts.locales.terminalNodeID=localizedNodeID;
  facts.locales.terminalStop='停止';
  exited=undefined;childExit.then(value=>{exited=value;});
  publicExits.push({ locale: 'zh-cn', ...await observeInstalledPublicExit({ platform: process.platform,
    command: driverCommand, readChildExit: () => exited, expectedHost: originalHost, observeHost: waitForHostAbsence,
    deadline: Math.min(deadline, Date.now() + infrastructureBudgets.hostExit),
    record: step => facts.publicExitSteps.push({ locale: 'zh-cn', ...step }) }) });
  hostExit='passed'; actionCompletedAt = new Date().toISOString();
  } finally { signal.removeEventListener('abort', abort); }
}, { settlementDeadline: Math.min(cleanupDeadline, deadline + 10000) });
} catch (error) { failure = error;unsettled = error.unsettled === true;
  failureList.push({stage:'action/assert',reason:error.message}); }
finally {
  if (abortRetirement) try {
    await withinDeadline('Installed abort retirement',cleanupDeadline,()=>abortRetirement);
  } catch(error) {unsettled=true;failure??=error;failureList.push({stage:'abort-retirement',reason:error.message});}
  const evidenceDeadline = Math.min(cleanupDeadline, Date.now() + infrastructureBudgets.evidence);
  try {
    await bounded('Installed failure evidence', evidenceDeadline, async () => {
      if (runtime) await snapshotVSCodeLogs(runtime.userDataDir, runtime.artifactsDir);
      if (failure && browser) for (const page of browser.contexts().flatMap(context => context.pages())) {
        await page.screenshot({ path: path.join(output, `failure-${randomUUID()}.png`),
          timeout: Math.max(1, evidenceDeadline - Date.now()) });
      }
    });
  } catch (error) { failure ??= error; failureList.push({ stage: 'evidence', reason: error.message }); }
  let cleanup = 'passed';
  let cleanupPhase = 'check-action-settlement';
  facts.cleanup = { steps: [], childPID: child?.pid ?? null };
  const cleanupStep = async (phase, operation) => {
    cleanupPhase = phase;
    const step = { phase, startedAt: Date.now(), status: 'running' };
    facts.cleanup.steps.push(step);
    try {
      const result = await operation();
      step.status = 'passed'; step.completedAt = Date.now();
      if (result !== undefined) step.result = result;
      return result;
    } catch (error) {
      step.status = 'failed'; step.completedAt = Date.now(); step.reason = error.message;
      throw error;
    }
  };
  try {
    assert(!unsettled, 'Installed actions did not settle; concurrent cleanup refused');
    await bounded('Installed private resource cleanup', cleanupDeadline, async () => {
      if (browser) await cleanupStep('disconnect-cdp', () => browser.close());
      if (child?.pid) {
        // This is cleanup after the business result. Killing a stuck subject
        // cannot satisfy the earlier public-close/original-Host assertion.
        await cleanupStep('retire-original-process-group', async () => {
          const retired = await retireProcessGroup(child.pid, {
            graceMs: Math.max(1, Math.min(5000, cleanupDeadline - Date.now())), killMs: 3000 });
          assert.equal(retired.status, 'passed');
          return retired;
        });
      }
      for (const host of originalHosts) await cleanupStep(`observe-original-host-${host.pid}`, () => waitForHostAbsence(host, cleanupDeadline));
      if (child) await cleanupStep('observe-child-close', () => childExit);
      await cleanupStep('verify-original-package-bytes', async () => { await verifyPackageFiles(packageReceipt, plan, candidate); });
      await cleanupStep('flush-original-host-log', async () => { await writes; await log?.close(); });
      if (runtime) {
        await cleanupStep('retire-private-runtime', () => fs.rm(runtime.runtimeDir, { recursive: true, force: true }));
        if (!runtime.userDataDir.startsWith(`${runtime.runtimeDir}${path.sep}`)
          && !runtime.userDataDir.startsWith(`${runtime.debugRoot}${path.sep}`))
          await cleanupStep('retire-private-user-data', () => fs.rm(runtime.userDataDir, { recursive: true, force: true }));
      }
    });
  } catch (error) {
    cleanup = 'failed'; failure ??= error;
    failureList.push({ stage: 'cleanup', phase: cleanupPhase, reason: error.message, code: error.code ?? null,
      syscall: error.syscall ?? null, processGroup: error.processGroup ?? null, stack: error.stack ?? null });
  }
  const driverHash = driverRoot ? await fileDigest(path.join(driverRoot, 'driver.cjs')).catch(() => null) : null;
  await writeJSON(path.join(output, 'installed-pair.json'), { schemaVersion: 1,
    inputSHA: plan.inputSHA, packageReceiptDigest: objectDigest(packageReceipt),
    status: failure ? 'failed' : 'passed', cleanup, hostExit, productTestMode: false, facts, failures: failureList,
    deadline, cleanupDeadline, actionCompletedAt: actionCompletedAt ?? null, originalHosts, publicExits,
    failure: failure?.message ?? null, driverHash });
}

if (failure) throw failure;
