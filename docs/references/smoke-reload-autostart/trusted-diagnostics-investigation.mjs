// Node 22 + xvfb, repository root; requires freshly packaged smoke-host.
// Product bundles and original assertions stay unchanged; expected diagnostic failure is captured.
import assert from 'node:assert/strict';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { runVSCodeScenario } from '../../../scripts/smoke/vscode-smoke-runner.mjs';
const projectRoot = process.cwd();
const root = path.join(projectRoot, '.debug/trusted-diagnostics-investigation/native-' + Date.now());
const host = path.join(root, 'host');
await mkdir(root, { recursive: true });
await cp(path.join(projectRoot, '.debug/vscode-vsix-smoke/smoke-host'), host, { recursive: true });
const hashes = {};
for (const file of ['extension.js', 'runtime-supervisor.js', 'webview.js']) {
  hashes[file] = createHash('sha256').update(await readFile(path.join(host, 'dist', file))).digest('hex');
}
await writeFile(path.join(root, 'payload-hashes.json'), JSON.stringify(hashes, null, 2));
const suitePath = path.join(host, 'tests/vscode-smoke/extension-tests.cjs');
let suite = await readFile(suitePath, 'utf8');
const anchor = "  if (smokeScenario === 'local-execution-flow') {";
assert.equal(suite.split(anchor).length, 2);
suite = suite.replace(anchor, String.raw`
  if (process.env.DEV_SESSION_CANVAS_DIAGNOSTICS_INVESTIGATION) {
    const { agentNode, terminalNode } = await prepareTrustedBaseNodesForAppliedRuntimePersistenceMode(false);
    try {
      const original = captureLocalExecutionIdentity(await getDebugSnapshot(), 'agent', agentNode.id);
      await dispatchWebviewMessage({ type: 'webview/executionInput', payload: {
        kind: 'agent', nodeId: agentNode.id, data: 'exit 27\r'
      } });
      await waitForSnapshot(snapshot => {
        const node = findNodeById(snapshot, agentNode.id);
        return node.status === 'error' && node.metadata.agent.lastExitCode === 27 && !node.metadata.agent.liveSession;
      }, 20000);
      await waitForDiagnosticEvents(events => events.some(event =>
        event.kind === 'execution/localFinalPersistence' && event.detail?.executionId === original.executionSessionId &&
        event.detail?.result?.kind === 'saved') && events.some(event =>
        event.kind === 'execution/localTerminalResult' && event.detail?.executionSessionId === original.executionSessionId &&
        event.detail?.outcome?.kind === 'applied'), 20000);
      const naturalExit = { original, snapshot: await getDebugSnapshot(), events: await getDiagnosticEvents(), messages: await getHostMessages() };
      assert.ok(naturalExit.events.length < 2000);
      assert.ok(naturalExit.messages.some(message => message.type === 'host/executionExit' &&
        message.payload.executionSessionId === original.executionSessionId));
      await verifyHostBoundaryFlushesRecentLocalState(agentNode.id, terminalNode.id);
      let diagnosticFailure;
      try { await verifyTrustedDiagnostics(agentNode.id, terminalNode.id); }
      catch (error) { diagnosticFailure = { message: error.message, stack: error.stack }; }
      const events = await getDiagnosticEvents();
      assert.ok(events.length < 2000);
      assert.ok(diagnosticFailure, 'Expected the unchanged diagnostic assertion to reproduce.');
      await fs.writeFile(path.join(artifactDir, 'diagnostics-result.json'), JSON.stringify({
        naturalExit, diagnosticFailure, snapshot: await getDebugSnapshot(), events, messages: await getHostMessages()
      }, null, 2));
      console.log('Investigation captured natural exit and unchanged diagnostic assertion failure; not a smoke gate pass.');
    } finally {
      for (const node of (await getDebugSnapshot()).state.nodes) {
        if (node.kind === 'agent') await ensureAgentStopped(node.id);
        else if (node.kind === 'terminal') await ensureTerminalStopped(node.id);
      }
    }
    return;
  }
` + anchor);
await writeFile(suitePath, suite);
console.log('Verification directory: ' + root);
await runVSCodeScenario({ projectRoot, debugRoot: path.join(root, 'runtime'), runtimeDirName: 'dsc-diagnostics-rca',
  workspacePath: projectRoot, extensionDevelopmentPath: [host, path.join(host, 'notifier-extension')],
  extensionTestsPath: suitePath, disableWorkspaceTrust: true, extensionTestsEnv: {
    DEV_SESSION_CANVAS_SMOKE_TEST_MODE: '1', DEV_SESSION_CANVAS_SMOKE_SCENARIO: 'local-links-and-stop',
    DEV_SESSION_CANVAS_DIAGNOSTICS_INVESTIGATION: '1',
    DEV_SESSION_CANVAS_TEST_CODEX_COMMAND: path.join(projectRoot, 'tests/vscode-smoke/fixtures/fake-agent-provider'),
    DEV_SESSION_CANVAS_TEST_CLAUDE_COMMAND: path.join(projectRoot, 'tests/vscode-smoke/fixtures/missing-agent-provider')
  } });
