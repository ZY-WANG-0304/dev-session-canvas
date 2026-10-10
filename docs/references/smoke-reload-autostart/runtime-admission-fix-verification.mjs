// Node 22，仓库根运行；前提：当前 test:vsix-smoke 已生成 smoke-host。
// xvfb-run -a node docs/references/smoke-reload-autostart/runtime-admission-fix-verification.mjs on|off
// 只修改复制后的测试入口，调用正式 helper，不修改产品载荷或注入自动重试。
import assert from 'node:assert/strict';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runVSCodeScenario } from '../../../scripts/smoke/vscode-smoke-runner.mjs';

const mode = process.argv[2];
assert.ok(['on', 'off'].includes(mode));
const projectRoot = process.cwd();
const root = path.join(projectRoot, '.debug/runtime-admission-fix');
await mkdir(root, { recursive: true });
const host = path.join(root, 'host-' + mode);
await cp(path.join(projectRoot, '.debug/vscode-vsix-smoke/smoke-host'), host, { recursive: true });
const suitePath = path.join(host, 'tests/vscode-smoke/extension-tests.cjs');
const suite = await readFile(suitePath, 'utf8');
const anchor = "  if (smokeScenario === 'local-execution-flow') {";
assert.equal(suite.split(anchor).length, 2);
const verification = String.raw`
  if (process.env.DEV_SESSION_CANVAS_ADMISSION_FIX_MODE) {
    const enabled = process.env.DEV_SESSION_CANVAS_ADMISSION_FIX_MODE === 'on';
    const nodes = [];
    try {
      const prepared = await prepareTrustedBaseNodesForAppliedRuntimePersistenceMode(enabled);
      nodes.push(prepared.agentNode, prepared.terminalNode);
      assert.equal(prepared.noteNode.kind, 'note');
      const snapshot = await getDebugSnapshot();
      assert.equal(snapshot.state.nodes.length, 3);
      const events = (await getDiagnosticEvents()).filter(e =>
        ['execution/startRequested', 'execution/started', 'execution/candidateStartFailed'].includes(e.kind));
      assert.equal(events.filter(e => e.kind === 'execution/candidateStartFailed').length, 0);
      const starts = events.filter(e => e.kind === 'execution/started');
      assert.equal(starts.length, 2);
      const sessions = [];
      for (const node of nodes) {
        const metadata = snapshot.state.nodes.find(n => n.id === node.id).metadata[node.kind];
        assert.equal(metadata.liveSession, true);
        assert.equal(metadata.persistenceMode, enabled ? 'live-runtime' : 'snapshot-only');
        const sessionId = enabled ? metadata.runtimeSessionId :
          captureLocalExecutionIdentity(snapshot, node.kind, node.id).executionSessionId;
        assert.ok(sessionId);
        assert.equal(events.filter(e => e.kind === 'execution/startRequested' && e.detail.nodeId === node.id).length, 1);
        assert.equal(starts.filter(e => e.detail.nodeId === node.id && e.detail.kind === node.kind && e.detail.sessionId === sessionId).length, 1);
        sessions.push({ nodeId: node.id, kind: node.kind, sessionId, persistenceMode: metadata.persistenceMode });
      }
      const agentStarted = events.findIndex(e => e.kind === 'execution/started' && e.detail.nodeId === prepared.agentNode.id);
      const terminalRequested = events.findIndex(e => e.kind === 'execution/startRequested' && e.detail.nodeId === prepared.terminalNode.id);
      assert.ok(agentStarted >= 0 && terminalRequested > agentStarted, 'Agent started must precede Terminal admission.');
      await fs.writeFile(path.join(artifactDir, 'admission-fix-verification.json'), JSON.stringify({
        enabled, sessions, events: events.map(e => ({ timestamp:e.timestamp, kind:e.kind,
          detail:{kind:e.detail.kind, nodeId:e.detail.nodeId, sessionId:e.detail.sessionId} }))
      }, null, 2));
    } finally {
      const remaining = (await getDebugSnapshot()).state.nodes.filter(n => n.kind === 'agent' || n.kind === 'terminal');
      for (const node of remaining) {
        if (node.kind === 'agent') await ensureAgentStopped(node.id);
        else await ensureTerminalStopped(node.id);
      }
    }
    console.log('Runtime fixture started barriers passed: ' + (enabled ? 'on' : 'off'));
    return;
  }
`;
await writeFile(suitePath, suite.replace(anchor, verification + anchor));
await runVSCodeScenario({ projectRoot, debugRoot:path.join(root,'native-'+mode),
  runtimeDirName:'dsc-admission-fix-'+mode, workspacePath:projectRoot,
  extensionDevelopmentPath:[host,path.join(host,'notifier-extension')], extensionTestsPath:suitePath,
  disableWorkspaceTrust:true, extensionTestsEnv:{
    DEV_SESSION_CANVAS_SMOKE_TEST_MODE:'1', DEV_SESSION_CANVAS_SMOKE_SCENARIO:'local-links-and-stop',
    DEV_SESSION_CANVAS_ADMISSION_FIX_MODE:mode,
    DEV_SESSION_CANVAS_TEST_CODEX_COMMAND:path.join(projectRoot,'tests/vscode-smoke/fixtures/fake-agent-provider'),
    DEV_SESSION_CANVAS_TEST_CLAUDE_COMMAND:path.join(projectRoot,'tests/vscode-smoke/fixtures/missing-agent-provider')
  }
});
