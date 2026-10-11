// Run with Node 22 and xvfb from the repository root after test:vsix-smoke packaging.
// Only the isolated test entry changes; product bundles and scenario assertions stay intact.
import assert from 'node:assert/strict';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { runVSCodeScenario } from '../../../scripts/smoke/vscode-smoke-runner.mjs';

const mode = process.argv[2] ?? 'resume';
assert.ok(['resume', 'files', 'readexit'].includes(mode));
const projectRoot = process.cwd();
const root = path.join(projectRoot, '.debug/owned-file-activity-resume-fix', mode + '-' + Date.now());
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
  if (process.env.DEV_SESSION_CANVAS_OWNED_FILE_RESUME_FIX) {
    const { agentNode, terminalNode } = await prepareTrustedBaseNodesForAppliedRuntimePersistenceMode(false);
    await verifyHostBoundaryFlushesRecentLocalState(agentNode.id, terminalNode.id);
    await clearDiagnosticEvents();
    await clearHostMessages();
    const result = { mode: process.env.DEV_SESSION_CANVAS_OWNED_FILE_RESUME_FIX,
      before: await getDebugSnapshot() };
    try {
      if (result.mode === 'resume') await verifyRuntimeReloadRecovery(agentNode.id, terminalNode.id);
      else if (result.mode === 'files') await verifyFileActivityViewsAndOpenFiles();
      else await verifyReadExitFileActivityDrain();
      result.originalFunctionPassed = true;
      console.log('Owned file/resume verification passed: ' + result.mode);
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
      assert.equal(result.cleanup.localExecutions.length, 0, 'All local executions must retire.');
    }
    return;
  }
` + anchor);
await writeFile(suitePath, suite);
console.log('Verification directory: ' + root);
await runVSCodeScenario({ projectRoot, debugRoot: path.join(root, 'runtime'),
  runtimeDirName: 'dsc-owned-file-resume-' + mode,
  workspacePath: projectRoot, extensionDevelopmentPath: [host, path.join(host, 'notifier-extension')],
  extensionTestsPath: suitePath, disableWorkspaceTrust: true, extensionTestsEnv: {
    DEV_SESSION_CANVAS_SMOKE_TEST_MODE: '1', DEV_SESSION_CANVAS_SMOKE_SCENARIO: 'local-links-and-stop',
    DEV_SESSION_CANVAS_OWNED_FILE_RESUME_FIX: mode,
    DEV_SESSION_CANVAS_TEST_CODEX_COMMAND: path.join(projectRoot, 'tests/vscode-smoke/fixtures/fake-agent-provider'),
    DEV_SESSION_CANVAS_TEST_CLAUDE_COMMAND: path.join(projectRoot, 'tests/vscode-smoke/fixtures/missing-agent-provider')
  } });
