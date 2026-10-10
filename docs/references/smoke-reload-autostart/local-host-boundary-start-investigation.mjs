// Node 22 + xvfb, repository root; requires the packaged smoke-host at 675f2a55.
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
const root = path.join(projectRoot, '.debug/local-host-boundary-start', mode + '-' + Date.now());
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
    (globalThis.__dscHostBoundaryAdmissions??=[]).push({timestamp:new Date().toISOString(),
      identity:e,identityMatch:this.executions.get(e.executionId)?.identity===e,
      authority:this.snapshot(),limits:this.admissionLimits,startingIds:[...this.starting].map(i=>i.executionId)});
    return this.executions.get(e.executionId)?.identity!==e`);
  await writeFile(file, product);
}
const suitePath = path.join(host, 'tests/vscode-smoke/extension-tests.cjs');
let suite = await readFile(suitePath, 'utf8');
if (mode === 'serial') {
  const start = suite.indexOf('async function verifyHostBoundaryFlushesRecentLocalState(');
  const end = suite.indexOf('\nasync function ', start + 10);
  let fn = suite.slice(start, end);
  const anchor = "  await dispatchWebviewMessage({\n    type: 'webview/startExecutionSession',\n    payload: {\n      nodeId: terminalNodeId,";
  assert.equal(fn.split(anchor).length, 2);
  fn = fn.replace(anchor, "  await waitForLocalExecutionStarted('agent', agentNodeId);\n" + anchor);
  suite = suite.slice(0, start) + fn + suite.slice(end);
}
const anchor = "  if (smokeScenario === 'local-execution-flow') {";
assert.equal(suite.split(anchor).length, 2);
suite = suite.replace(anchor, String.raw`
  if (process.env.DEV_SESSION_CANVAS_HOST_BOUNDARY_RCA) {
    const {agentNode, terminalNode} = await prepareTrustedBaseNodesForAppliedRuntimePersistenceMode(false);
    const before = await getDebugSnapshot();
    let outcome;
    try {
      await verifyHostBoundaryFlushesRecentLocalState(agentNode.id, terminalNode.id);
      outcome = {passed: true};
    } catch (error) { outcome = {passed: false, message: error.message, stack: error.stack}; }
    await fs.writeFile(path.join(artifactDir, 'result.json'), JSON.stringify({outcome, before,
      after: await getDebugSnapshot(), events: await getDiagnosticEvents(), messages: await getHostMessages(),
      admissions: globalThis.__dscHostBoundaryAdmissions ?? []}, null, 2));
    console.log('Host boundary investigation outcome: ' + JSON.stringify({passed: outcome.passed,
      error: outcome.passed ? undefined : outcome.message.slice(0, 130)}));
    for (const node of (await getDebugSnapshot()).state.nodes) {
      if (node.kind === 'agent') await ensureAgentStopped(node.id);
      else if (node.kind === 'terminal') await ensureTerminalStopped(node.id);
    }
    return;
  }
` + anchor);
await writeFile(suitePath, suite);
console.log('Investigation directory: ' + root);
await runVSCodeScenario({ projectRoot, debugRoot: path.join(root, 'runtime'), runtimeDirName: 'dsc-local-boundary-' + mode,
  workspacePath: projectRoot, extensionDevelopmentPath: [host, path.join(host, 'notifier-extension')],
  extensionTestsPath: suitePath, disableWorkspaceTrust: true, extensionTestsEnv: {
    DEV_SESSION_CANVAS_SMOKE_TEST_MODE: '1', DEV_SESSION_CANVAS_SMOKE_SCENARIO: 'local-links-and-stop',
    DEV_SESSION_CANVAS_HOST_BOUNDARY_RCA: '1',
    DEV_SESSION_CANVAS_TEST_CODEX_COMMAND: path.join(projectRoot, 'tests/vscode-smoke/fixtures/fake-agent-provider'),
    DEV_SESSION_CANVAS_TEST_CLAUDE_COMMAND: path.join(projectRoot, 'tests/vscode-smoke/fixtures/missing-agent-provider')
  } });
