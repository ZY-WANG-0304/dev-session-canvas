// Node 22 + xvfb, repository root; requires the packaged smoke-host at 051b5adf.
// baseline/serial keep all product bundles unchanged; probe adds a read-only authority observation.
// Exit 0 means the investigation completed; consult result.json for the original scenario outcome.
import assert from 'node:assert/strict';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { runVSCodeScenario } from '../../../scripts/smoke/vscode-smoke-runner.mjs';
const mode = process.argv[2] ?? 'baseline';
assert.ok(['baseline', 'probe', 'serial'].includes(mode));
const projectRoot = process.cwd();
const root = path.join(projectRoot, '.debug/file-activity-start', mode + '-' + Date.now());
const host = path.join(root, 'host');
await mkdir(root, { recursive: true });
await cp(path.join(projectRoot, '.debug/vscode-vsix-smoke/smoke-host'), host, { recursive: true });
const hashes = {};
for (const file of ['extension.js', 'runtime-supervisor.js', 'webview.js']) {
  hashes[file] = createHash('sha256').update(await readFile(path.join(host, 'dist', file))).digest('hex');
}
await writeFile(path.join(root, 'payload-hashes.json'), JSON.stringify(hashes, null, 2));
if (mode === 'probe') {
  const file = path.join(host, 'dist/extension.js');
  let product = await readFile(file, 'utf8');
  const anchor = 'beginStart(e){return this.executions.get(e.executionId)?.identity!==e';
  assert.equal(product.split(anchor).length, 2);
  product = product.replace(anchor, `beginStart(e){
    (globalThis.__dscFileActivityAdmissions??=[]).push({timestamp:new Date().toISOString(),
      identity:e,identityMatch:this.executions.get(e.executionId)?.identity===e,
      authority:this.snapshot(),limits:this.admissionLimits,startingIds:[...this.starting].map(i=>i.executionId)});
    return this.executions.get(e.executionId)?.identity!==e`);
  await writeFile(file, product);
}
const suitePath = path.join(host, 'tests/vscode-smoke/extension-tests.cjs');
let suite = await readFile(suitePath, 'utf8');
const start = suite.indexOf('async function verifyFileActivityViewsAndOpenFiles()');
const endAnchor = '    await waitForAgentLive(agentBId);';
const end = suite.indexOf(endAnchor, start) + endAnchor.length;
assert.ok(start > 0 && end > start);
let prefix = suite.slice(start, end).replace('verifyFileActivityViewsAndOpenFiles', 'verifyFileActivityStartupForInvestigation');
if (mode === 'serial') {
  const anchor = "    await vscode.commands.executeCommand(COMMAND_IDS.testCreateNode, 'agent');";
  prefix = prefix.replace(anchor, anchor + String.raw`
    const first = (await getDebugSnapshot()).state.nodes.find(node => node.kind === 'agent' && !baselineAgentIds.has(node.id));
    await waitForLocalExecutionStarted('agent', first.id);
`);
}
prefix += String.raw`
    return { passed: true, agentAId, agentBId };
  } catch (error) { return { passed: false, message: error.message, stack: error.stack }; }
}
`;
suite += '\n' + prefix;
const anchor = "  if (smokeScenario === 'local-execution-flow') {";
assert.equal(suite.split(anchor).length, 2);
suite = suite.replace(anchor, String.raw`
  if (process.env.DEV_SESSION_CANVAS_FILE_ACTIVITY_RCA) {
    const {agentNode, terminalNode} = await prepareTrustedBaseNodesForAppliedRuntimePersistenceMode(false);
    await verifyHostBoundaryFlushesRecentLocalState(agentNode.id, terminalNode.id);
    await clearDiagnosticEvents();
    await clearHostMessages();
    const before = await getDebugSnapshot();
    const outcome = await verifyFileActivityStartupForInvestigation();
    const result = { outcome, before, after: await getDebugSnapshot(),
      events: await getDiagnosticEvents(), messages: await getHostMessages(),
      admissions: globalThis.__dscFileActivityAdmissions ?? [] };
    await fs.writeFile(path.join(artifactDir, 'result.json'), JSON.stringify(result, null, 2));
    const rejected = result.events.find(event => event.kind === 'execution/startRejected');
    if (rejected) {
      await dispatchWebviewMessage({ type: 'webview/startExecutionSession', payload: {
        kind: 'agent', nodeId: rejected.detail.nodeId, cols: 66, rows: 21, provider: 'codex'
      } }, 'panel');
      const retry = await waitForLocalExecutionStarted('agent', rejected.detail.nodeId);
      result.explicitRetry = { execution: retry.execution, snapshot: await getDebugSnapshot(),
        events: await getDiagnosticEvents() };
      assert.notEqual(retry.execution.executionSessionId, rejected.detail.executionId);
    }
    for (const node of (await getDebugSnapshot()).state.nodes) {
      if (node.kind === 'agent') await ensureAgentStopped(node.id);
      else if (node.kind === 'terminal') await ensureTerminalStopped(node.id);
    }
    result.cleanup = await getDebugSnapshot();
    await fs.writeFile(path.join(artifactDir, 'result.json'), JSON.stringify(result, null, 2));
    console.log('File activity startup investigation outcome: ' + JSON.stringify({passed: outcome.passed,
      retry: Boolean(result.explicitRetry), error: outcome.passed ? undefined : outcome.message.slice(0, 130)}));
    return;
  }
` + anchor);
await writeFile(suitePath, suite);
console.log('Investigation directory: ' + root);
await runVSCodeScenario({ projectRoot, debugRoot: path.join(root, 'runtime'), runtimeDirName: 'dsc-file-activity-' + mode,
  workspacePath: projectRoot, extensionDevelopmentPath: [host, path.join(host, 'notifier-extension')],
  extensionTestsPath: suitePath, disableWorkspaceTrust: true, extensionTestsEnv: {
    DEV_SESSION_CANVAS_SMOKE_TEST_MODE: '1', DEV_SESSION_CANVAS_SMOKE_SCENARIO: 'local-links-and-stop',
    DEV_SESSION_CANVAS_FILE_ACTIVITY_RCA: '1',
    DEV_SESSION_CANVAS_TEST_CODEX_COMMAND: path.join(projectRoot, 'tests/vscode-smoke/fixtures/fake-agent-provider'),
    DEV_SESSION_CANVAS_TEST_CLAUDE_COMMAND: path.join(projectRoot, 'tests/vscode-smoke/fixtures/missing-agent-provider')
  } });
