// Node 22 + xvfb, repository root; requires the freshly packaged smoke-host.
// Only the isolated test entry and evidence capture change; product bundles stay untouched.
import assert from 'node:assert/strict';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { runVSCodeScenario } from '../../../scripts/smoke/vscode-smoke-runner.mjs';

const projectRoot = process.cwd();
const root = path.join(projectRoot, '.debug/runtime-immediate-reload-fix/native-' + Date.now());
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
const start = suite.indexOf('async function verifyImmediateReloadAfterLiveRuntimeLaunch(');
const end = suite.indexOf('\nasync function ', start + 10);
assert.ok(start > 0 && end > start);
let fn = suite.slice(start, end);
const anchor = '    await ensureAgentStopped(agentNodeId);\n    await ensureTerminalStopped(terminalNodeId);';
assert.equal(fn.split(anchor).length, 3);
const last = fn.lastIndexOf(anchor);
fn = fn.slice(0, last) + String.raw`
    await fs.writeFile(path.join(artifactDir, 'immediate-reload-' + agentNode.metadata.agent.runtimeSessionId + '.json'),
      JSON.stringify({ snapshot, starts, runtimeEnabled: (await getDebugSnapshot()).sidebar.runtimePersistenceEnabled }, null, 2));
` + fn.slice(last);
suite = suite.slice(0, start) + fn + suite.slice(end);
const entry = "  if (smokeScenario === 'local-execution-flow') {";
assert.equal(suite.split(entry).length, 2);
suite = suite.replace(entry, String.raw`
  if (process.env.DEV_SESSION_CANVAS_IMMEDIATE_RELOAD_FIX) {
    const { agentNode, terminalNode } = await prepareTrustedBaseNodesForAppliedRuntimePersistenceMode(true);
    try {
      for (let iteration = 0; iteration < 3; iteration++) {
        await verifyImmediateReloadAfterLiveRuntimeLaunch(agentNode.id, terminalNode.id);
        console.log('Immediate Runtime reload passed: ' + (iteration + 1));
      }
    } finally {
      for (const node of (await getDebugSnapshot()).state.nodes) {
        if (node.kind === 'agent') await ensureAgentStopped(node.id);
        else if (node.kind === 'terminal') await ensureTerminalStopped(node.id);
      }
    }
    return;
  }
` + entry);
await writeFile(suitePath, suite);
console.log('Isolated verification directory: ' + root);
await runVSCodeScenario({ projectRoot, debugRoot: path.join(root, 'runtime'),
  runtimeDirName: 'dsc-immediate-reload-fix', workspacePath: projectRoot,
  extensionDevelopmentPath: [host, path.join(host, 'notifier-extension')], extensionTestsPath: suitePath,
  disableWorkspaceTrust: true, extensionTestsEnv: {
    DEV_SESSION_CANVAS_SMOKE_TEST_MODE: '1', DEV_SESSION_CANVAS_SMOKE_SCENARIO: 'local-links-and-stop',
    DEV_SESSION_CANVAS_IMMEDIATE_RELOAD_FIX: '1',
    DEV_SESSION_CANVAS_TEST_CODEX_COMMAND: path.join(projectRoot, 'tests/vscode-smoke/fixtures/fake-agent-provider'),
    DEV_SESSION_CANVAS_TEST_CLAUDE_COMMAND: path.join(projectRoot, 'tests/vscode-smoke/fixtures/missing-agent-provider')
  } });
