// Node 22 + xvfb, repository root; requires freshly packaged smoke-host.
// Product bundles and the original function/assertions are unchanged in this isolated run.
import assert from 'node:assert/strict';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { runVSCodeScenario } from '../../../scripts/smoke/vscode-smoke-runner.mjs';
const mode = process.argv[2] ?? 'rejection';
assert.ok(['rejection', 'file-activity'].includes(mode));
const projectRoot = process.cwd();
const root = path.join(projectRoot, '.debug/file-activity-start-fix/' + mode + '-' + Date.now());
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
  if (process.env.DEV_SESSION_CANVAS_FILE_ACTIVITY_FIX) {
    const { agentNode, terminalNode } = await prepareTrustedBaseNodesForAppliedRuntimePersistenceMode(false);
    await verifyHostBoundaryFlushesRecentLocalState(agentNode.id, terminalNode.id);
    await clearDiagnosticEvents();
    await clearHostMessages();
    const result = { mode: process.env.DEV_SESSION_CANVAS_FILE_ACTIVITY_FIX, before: await getDebugSnapshot() };
    try {
      if (result.mode === 'file-activity') {
        await verifyFileActivityViewsAndOpenFiles();
        result.originalFunctionPassed = true;
      } else {
        const priorIds = new Set(result.before.state.nodes.map(node => node.id));
        await vscode.commands.executeCommand(COMMAND_IDS.testCreateNode, 'agent');
        await vscode.commands.executeCommand(COMMAND_IDS.testCreateNode, 'agent');
        const events = await waitForDiagnosticEvents(current => current.some(event =>
          event.kind === 'execution/startRejected' && !priorIds.has(event.detail?.nodeId)));
        const rejected = events.find(event => event.kind === 'execution/startRejected' && !priorIds.has(event.detail?.nodeId));
        assert.equal(rejected.detail.outcome, 'rejected-before-acquire');
        const snapshot = await waitForSnapshot(current => findNodeById(current, rejected.detail.nodeId).status === 'error');
        const node = findNodeById(snapshot, rejected.detail.nodeId);
        assert.equal(node.metadata.agent.lifecycle, 'error');
        assert.equal(node.metadata.agent.pendingLaunch, undefined);
        assert.equal(node.metadata.agent.liveSession, false);
        assert.equal(node.metadata.agent.lastExitCode, undefined);
        assert.equal(node.metadata.agent.lastExitSignal, undefined);
        assert.equal(node.metadata.agent.lastExitMessage, undefined);
        assert.match(node.summary, /Wait for pending operations/);
        assert.ok(events.some(event => event.kind === 'execution/localFinalPersistence' &&
          event.detail.executionId === rejected.detail.executionId && event.detail.result.kind === 'not-required'));
        const first = snapshot.state.nodes.find(node => node.kind === 'agent' &&
          !priorIds.has(node.id) && node.id !== rejected.detail.nodeId);
        const firstStarted = await waitForLocalExecutionStarted('agent', first.id);
        result.rejection = { event: rejected, snapshot, firstExecution: firstStarted.execution,
          events: await getDiagnosticEvents(), messages: await getHostMessages() };
        await performWebviewDomAction({ kind: 'clickNodeActionButton', nodeId: node.id, action: 'start' },
          (await getDebugSnapshot()).activeSurface);
        const retry = await waitForLocalExecutionStarted('agent', node.id);
        assert.notEqual(retry.execution.executionSessionId, rejected.detail.executionId);
        assert.deepStrictEqual(captureLocalExecutionIdentity(await getDebugSnapshot(), 'agent', first.id), firstStarted.execution);
        const requests = (await getDiagnosticEvents()).filter(event => event.kind === 'execution/startRequested' && event.detail.nodeId === node.id);
        assert.equal(requests.length, 2, 'Only the original request and the explicit Start click may start the node.');
        result.retry = { execution: retry.execution, snapshot: await getDebugSnapshot() };
      }
      result.passed = true;
      console.log('File activity verification passed: ' + result.mode);
    } catch (error) {
      result.failure = { message: error.message, stack: error.stack };
      throw error;
    } finally {
      result.after = await getDebugSnapshot();
      result.events = await getDiagnosticEvents();
      result.messages = await getHostMessages();
      await fs.writeFile(path.join(artifactDir, 'result.json'), JSON.stringify(result, null, 2));
      for (const node of result.after.state.nodes) {
        if (node.kind === 'agent') await ensureAgentStopped(node.id);
        else if (node.kind === 'terminal') await ensureTerminalStopped(node.id);
      }
      result.cleanup = await getDebugSnapshot();
      await fs.writeFile(path.join(artifactDir, 'result.json'), JSON.stringify(result, null, 2));
    }
    return;
  }
` + anchor);
await writeFile(suitePath, suite);
console.log('Verification directory: ' + root);
await runVSCodeScenario({ projectRoot, debugRoot: path.join(root, 'runtime'), runtimeDirName: 'dsc-file-activity-fix-' + mode,
  workspacePath: projectRoot, extensionDevelopmentPath: [host, path.join(host, 'notifier-extension')],
  extensionTestsPath: suitePath, disableWorkspaceTrust: true, extensionTestsEnv: {
    DEV_SESSION_CANVAS_SMOKE_TEST_MODE: '1', DEV_SESSION_CANVAS_SMOKE_SCENARIO: 'local-links-and-stop',
    DEV_SESSION_CANVAS_FILE_ACTIVITY_FIX: mode,
    DEV_SESSION_CANVAS_TEST_CODEX_COMMAND: path.join(projectRoot, 'tests/vscode-smoke/fixtures/fake-agent-provider'),
    DEV_SESSION_CANVAS_TEST_CLAUDE_COMMAND: path.join(projectRoot, 'tests/vscode-smoke/fixtures/missing-agent-provider')
  } });
