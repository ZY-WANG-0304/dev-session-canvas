// Node 22; run from the repository root under xvfb-run -a.
// Requires a packaged VSIX smoke-host; stages current tests without altering product bundles.
import assert from 'node:assert/strict';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { runVSCodeScenario, stageSmokeTestSuite } from '../../../scripts/smoke/vscode-smoke-runner.mjs';

const projectRoot = process.cwd();
const root = path.join(projectRoot, '.debug/runtime-scrollback-snapshot-fix');
await mkdir(root, { recursive: true });
const host = path.join(root, 'host');
await cp(path.join(projectRoot, '.debug/vscode-vsix-smoke/smoke-host'), host, { recursive: true });
await stageSmokeTestSuite({ projectRoot, targetRoot: host });
const hashes = {};
for (const file of ['extension.js', 'runtime-supervisor.js', 'webview.js']) {
  hashes[file] = createHash('sha256').update(await readFile(path.join(host, 'dist', file))).digest('hex');
}
await writeFile(path.join(root, 'payload-hashes.json'), JSON.stringify(hashes, null, 2));
const suitePath = path.join(host, 'tests/vscode-smoke/extension-tests.cjs');
const suite = await readFile(suitePath, 'utf8');
const anchor = "  if (smokeScenario === 'local-execution-flow') {";
assert.equal(suite.split(anchor).length, 2);
const entry = String.raw`
  if (process.env.DEV_SESSION_CANVAS_SCROLLBACK_FIX) {
    try {
      const { terminalNode } = await prepareTrustedBaseNodesForAppliedRuntimePersistenceMode(true);
      await verifyLiveRuntimeReloadPreservesUpdatedTerminalScrollbackHistory(terminalNode.id);
      console.log('Runtime scrollback original scenario passed: 220 ordered unique lines restored.');
    } finally {
      for (const node of (await getDebugSnapshot()).state.nodes) {
        if (node.kind === 'agent') await ensureAgentStopped(node.id);
        else if (node.kind === 'terminal') await ensureTerminalStopped(node.id);
      }
    }
    return;
  }
`;
await writeFile(suitePath, suite.replace(anchor, entry + anchor));
await runVSCodeScenario({ projectRoot, debugRoot: path.join(root, 'native'),
  runtimeDirName: 'dsc-scrollback-snapshot-fix', workspacePath: projectRoot,
  extensionDevelopmentPath: [host, path.join(host, 'notifier-extension')], extensionTestsPath: suitePath,
  disableWorkspaceTrust: true, extensionTestsEnv: {
    DEV_SESSION_CANVAS_SMOKE_TEST_MODE: '1', DEV_SESSION_CANVAS_SMOKE_SCENARIO: 'local-links-and-stop',
    DEV_SESSION_CANVAS_SCROLLBACK_FIX: '1',
    DEV_SESSION_CANVAS_TEST_CODEX_COMMAND: path.join(projectRoot, 'tests/vscode-smoke/fixtures/fake-agent-provider'),
    DEV_SESSION_CANVAS_TEST_CLAUDE_COMMAND: path.join(projectRoot, 'tests/vscode-smoke/fixtures/missing-agent-provider')
  } });
