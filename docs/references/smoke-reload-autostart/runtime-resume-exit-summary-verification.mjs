// Node 22, repository root: xvfb-run -a node <this file>
// Requires the current packaged smoke-host. Product bundles and original assertions are unchanged.
import assert from 'node:assert/strict';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { runVSCodeScenario } from '../../../scripts/smoke/vscode-smoke-runner.mjs';

const projectRoot = process.cwd();
const root = path.join(projectRoot, '.debug/runtime-resume-exit-summary-fix');
await mkdir(root, { recursive: true });
const host = path.join(root, 'host');
await cp(path.join(projectRoot, '.debug/vscode-vsix-smoke/smoke-host'), host, { recursive: true });
const hashes = {};
for (const file of ['extension.js', 'runtime-supervisor.js', 'webview.js']) {
  hashes[file] = createHash('sha256').update(await readFile(path.join(host, 'dist', file))).digest('hex');
}
await writeFile(path.join(root, 'payload-hashes.json'), JSON.stringify(hashes, null, 2));
const suitePath = path.join(host, 'tests/vscode-smoke/extension-tests.cjs');
let suite = await readFile(suitePath, 'utf8');
const assertion = '    assert.match(agentNode.summary, /exit(?:ed with code| code) 23/);';
assert.equal(suite.split(assertion).length, 2);
suite = suite.replace(assertion, assertion + String.raw`
    await fs.writeFile(path.join(artifactDir, 'resume-exit-summary.json'), JSON.stringify({
      runtimeEnabled: (await getDebugSnapshot()).sidebar.runtimePersistenceEnabled,
      node: agentNode, messages: await getHostMessages()
    }, null, 2));
`);
const anchor = "  if (smokeScenario === 'local-execution-flow') {";
assert.equal(suite.split(anchor).length, 2);
suite = suite.replace(anchor, String.raw`
  if (process.env.DEV_SESSION_CANVAS_EXIT_SUMMARY_FIX) {
    try {
      const { agentNode, terminalNode } = await prepareTrustedBaseNodesForAppliedRuntimePersistenceMode(true);
      await waitForSnapshot(snapshot => {
        const metadata = findNodeById(snapshot, agentNode.id).metadata.agent;
        return Boolean(metadata.liveSession && metadata.resumeSessionId && metadata.recentOutput?.includes('[fake-agent]'));
      }, 20000);
      await ensureTerminalStopped(terminalNode.id);
      await verifyLiveRuntimeResumeExitClassification(agentNode.id);
      console.log('Runtime resume exit summary: original function and assertions passed.');
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
await runVSCodeScenario({ projectRoot, debugRoot: path.join(root, 'native'),
  runtimeDirName: 'dsc-resume-exit-summary-fix', workspacePath: projectRoot,
  extensionDevelopmentPath: [host, path.join(host, 'notifier-extension')], extensionTestsPath: suitePath,
  disableWorkspaceTrust: true, extensionTestsEnv: {
    DEV_SESSION_CANVAS_SMOKE_TEST_MODE: '1', DEV_SESSION_CANVAS_SMOKE_SCENARIO: 'local-links-and-stop',
    DEV_SESSION_CANVAS_EXIT_SUMMARY_FIX: '1',
    DEV_SESSION_CANVAS_TEST_CODEX_COMMAND: path.join(projectRoot, 'tests/vscode-smoke/fixtures/fake-agent-provider'),
    DEV_SESSION_CANVAS_TEST_CLAUDE_COMMAND: path.join(projectRoot, 'tests/vscode-smoke/fixtures/missing-agent-provider')
  } });
