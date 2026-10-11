// Node 22, repository root: xvfb-run -a node <this file> baseline|probe|control
// Copies the packaged host; only control changes the isolated exit message projection.
import assert from 'node:assert/strict';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { runVSCodeScenario } from '../../../scripts/smoke/vscode-smoke-runner.mjs';

const mode = process.argv[2];
assert.ok(['baseline', 'probe', 'control'].includes(mode));
const projectRoot = process.cwd();
const root = path.join(projectRoot, '.debug/runtime-resume-exit-summary', mode);
await mkdir(root, { recursive: true });
const host = path.join(root, 'host');
await cp(path.join(projectRoot, '.debug/vscode-vsix-smoke/smoke-host'), host, { recursive: true });
const tracePath = path.join(root, 'supervisor-trace.jsonl');
await writeFile(tracePath, '');
const hashes = {};
for (const file of ['extension.js', 'runtime-supervisor.js', 'webview.js']) {
  hashes[file] = createHash('sha256').update(await readFile(path.join(host, 'dist', file))).digest('hex');
}
if (mode !== 'baseline') {
  const file = path.join(host, 'dist/runtime-supervisor.js');
  let bundle = await readFile(file, 'utf8');
  const start = bundle.indexOf('finalizeOwnedExecution(e,t){');
  const end = bundle.indexOf('bindSessionProcess(e){', start);
  assert.ok(start > 0 && end > start);
  let method = bundle.slice(start, end);
  const anchor = 'this.broadcastToSessionSubscribers(e.sessionId,';
  assert.equal(method.split(anchor).length, 2);
  const observe = `require('node:fs').appendFileSync(${JSON.stringify(tracePath)}, JSON.stringify({
    sessionId:e.sessionId, kind:e.kind, authority:t, process:e.ownedProcessResult,
    source:e.ownedExecution?.snapshot()?.adapter?.seal?.source,
    launchMode:e.launchMode, resumePhaseActive:e.resumePhaseActive, stopRequested:e.stopRequested,
    live:e.live, lifecycle:e.lifecycle, lastExitCode:e.lastExitCode, lastExitSignal:e.lastExitSignal,
    lastExitMessage:e.lastExitMessage ?? null, lastExitMessageDescriptor:e.lastExitMessageDescriptor ?? null
  })+'\\n')`;
  const control = mode === 'control' ? `,
    e.kind==='agent' && e.lastExitCode===23 && e.resumePhaseActive===false &&
    e.ownedExecution?.snapshot()?.adapter?.seal?.source?.kind==='eof' && (
      e.lastExitMessageDescriptor={id:'agentExitedCode',params:{label:e.displayLabel,code:'23',suffix:''}},
      e.lastExitMessage=e.displayLabel+' exited with code 23.'
    )` : '';
  method = method.replace(anchor, `${observe}${control},${anchor}`);
  bundle = bundle.slice(0, start) + method + bundle.slice(end);
  await writeFile(file, bundle);
}
await writeFile(path.join(root, 'input-hashes.json'), JSON.stringify({mode,original:hashes,
  actualSupervisor:createHash('sha256').update(await readFile(path.join(host, 'dist/runtime-supervisor.js'))).digest('hex')}, null, 2));
const suitePath = path.join(host, 'tests/vscode-smoke/extension-tests.cjs');
let suite = await readFile(suitePath, 'utf8');
const assertion = '    assert.match(agentNode.summary, /exit(?:ed with code| code) 23/);';
assert.equal(suite.split(assertion).length, 2);
suite = suite.replace(assertion, String.raw`
    await fs.writeFile(path.join(artifactDir, 'before-summary-assertion.json'), JSON.stringify({
      runtimeEnabled: (await getDebugSnapshot()).sidebar.runtimePersistenceEnabled,
      node: agentNode, messages: await getHostMessages(), diagnostics: await getDiagnosticEvents()
    }, null, 2));
` + assertion);
const anchor = "  if (smokeScenario === 'local-execution-flow') {";
assert.equal(suite.split(anchor).length, 2);
suite = suite.replace(anchor, String.raw`
  if (process.env.DEV_SESSION_CANVAS_EXIT_SUMMARY_RCA) {
    let originalError;
    try {
      const { agentNode, terminalNode } = await prepareTrustedBaseNodesForAppliedRuntimePersistenceMode(true);
      await waitForSnapshot(snapshot => {
        const metadata = findNodeById(snapshot, agentNode.id).metadata.agent;
        return Boolean(metadata.liveSession && metadata.resumeSessionId && metadata.recentOutput?.includes('[fake-agent]'));
      }, 20000);
      await ensureTerminalStopped(terminalNode.id);
      try { await verifyLiveRuntimeResumeExitClassification(agentNode.id); }
      catch (error) { originalError = error; }
      if (process.env.DEV_SESSION_CANVAS_EXIT_SUMMARY_RCA === 'control') {
        assert.equal(originalError, undefined);
      } else {
        assert.equal(originalError?.code, 'ERR_ASSERTION');
        assert.match(originalError.message, /Session ended/);
      }
      await fs.writeFile(path.join(artifactDir, 'investigation-result.json'), JSON.stringify({
        mode: process.env.DEV_SESSION_CANVAS_EXIT_SUMMARY_RCA,
        originalAssertionPassed: !originalError, error: originalError?.message
      }, null, 2));
    } finally {
      for (const node of (await getDebugSnapshot()).state.nodes) {
        if (node.kind === 'agent') await ensureAgentStopped(node.id);
        else if (node.kind === 'terminal') await ensureTerminalStopped(node.id);
      }
    }
    console.log('Runtime resume exit summary investigation passed: ' + process.env.DEV_SESSION_CANVAS_EXIT_SUMMARY_RCA);
    return;
  }
` + anchor);
await writeFile(suitePath, suite);
await runVSCodeScenario({ projectRoot, debugRoot: path.join(root, 'native'),
  runtimeDirName: 'dsc-resume-exit-summary-' + mode, workspacePath: projectRoot,
  extensionDevelopmentPath: [host, path.join(host, 'notifier-extension')], extensionTestsPath: suitePath,
  disableWorkspaceTrust: true, extensionTestsEnv: {
    DEV_SESSION_CANVAS_SMOKE_TEST_MODE: '1', DEV_SESSION_CANVAS_SMOKE_SCENARIO: 'local-links-and-stop',
    DEV_SESSION_CANVAS_EXIT_SUMMARY_RCA: mode,
    DEV_SESSION_CANVAS_TEST_CODEX_COMMAND: path.join(projectRoot, 'tests/vscode-smoke/fixtures/fake-agent-provider'),
    DEV_SESSION_CANVAS_TEST_CLAUDE_COMMAND: path.join(projectRoot, 'tests/vscode-smoke/fixtures/missing-agent-provider')
  } });
