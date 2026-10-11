// 仓库根以 Node 22 运行：xvfb-run -a node <本文件> legacy|unsafe
// 前提：先用当前源码运行 test:vsix-smoke，复用生成的 smoke-host；不修改产品载荷。
import assert from 'node:assert/strict';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runVSCodeScenario } from '../../../scripts/smoke/vscode-smoke-runner.mjs';

const scenario = process.argv[2];
assert.ok(['legacy', 'unsafe'].includes(scenario));
process.umask(0o002);
const projectRoot = process.cwd();
const investigation = path.join(projectRoot, '.debug/runtime-root-fix');
await mkdir(investigation, { recursive: true });
const host = path.join(investigation, 'verification-host');
await cp(path.join(projectRoot, '.debug/vscode-vsix-smoke/smoke-host'), host, { recursive: true });
const suitePath = path.join(host, 'tests/vscode-smoke/extension-tests.cjs');
const suite = await readFile(suitePath, 'utf8');
const anchor = "  if (smokeScenario === 'local-execution-flow') {";
assert.equal(suite.split(anchor).length, 2);
const probe = String.raw`
  if (process.env.DEV_SESSION_CANVAS_STORAGE_VERIFICATION) {
    const scenario = process.env.DEV_SESSION_CANVAS_STORAGE_VERIFICATION;
    const artifacts = process.env.DEV_SESSION_CANVAS_SMOKE_ARTIFACT_DIR;
    const globalStorage = path.join(artifacts, '../user-data/User/globalStorage/devsessioncanvas.dev-session-canvas');
    assert.equal((await fs.lstat(globalStorage)).mode & 0o7777, 0o700, 'ordinary activation creates 0700');
    await fs.writeFile(path.join(globalStorage, 'retained-marker'), 'original content');
    const legacy = scenario === 'legacy';
    await fs.chmod(globalStorage, legacy ? 0o775 : 0o777);
    await setRuntimePersistenceEnabled(true);
    await simulateRuntimeReload();
    await ensureEditorCanvasReady();
    const nodes = [];
    try {
      // 本专项仅验证存储：串行确认 started，避免另一个已知准入阻塞遮蔽此处。
      for (const kind of ['agent', 'terminal']) {
        await vscode.commands.executeCommand(COMMAND_IDS.testCreateNode, kind);
        const node = findNodeByKind(await getDebugSnapshot(), kind);
        nodes.push({ kind, id: node.id });
        if (legacy) {
          await waitForDiagnosticEvents(events => events.some(event => event.kind === 'execution/started' && event.detail.nodeId === node.id), 20000);
          if (kind === 'agent') await waitForAgentLive(node.id);
          else await waitForTerminalLive(node.id);
        } else {
          await waitForSnapshot(snapshot => snapshot.state.nodes.find(n => n.id === node.id)?.status === 'error', 20000);
        }
      }
      const snapshot = await getDebugSnapshot();
      for (const { id, kind } of nodes) {
        const node = snapshot.state.nodes.find(n => n.id === id);
        assert.equal(node.metadata[kind].pendingLaunch, undefined);
        assert.equal(node.metadata[kind].liveSession, legacy);
        if (!legacy) assert.match(node.metadata[kind].lastRuntimeError, /Runtime storage is unsafe/);
      }
      assert.equal((await fs.lstat(globalStorage)).mode & 0o7777, legacy ? 0o755 : 0o777);
      assert.equal(await fs.readFile(path.join(globalStorage, 'retained-marker'), 'utf8'), 'original content');
      await fs.writeFile(path.join(artifacts, 'storage-verification.json'), JSON.stringify({
        scenario, umask: process.umask().toString(8), beforeMode: legacy ? '0775' : '0777',
        afterMode: ((await fs.lstat(globalStorage)).mode & 0o7777).toString(8),
        nodes: snapshot.state.nodes.filter(n => n.kind !== 'note').map(n => ({ kind: n.kind, status: n.status,
          liveSession: n.metadata[n.kind].liveSession, pendingLaunch: n.metadata[n.kind].pendingLaunch,
          lastRuntimeError: n.metadata[n.kind].lastRuntimeError })),
        failures: (await getDiagnosticEvents()).filter(e => e.kind === 'execution/candidateStartFailed')
      }, null, 2));
      console.log('Runtime storage verification passed: ' + scenario);
    } finally {
      const snapshot = await getDebugSnapshot();
      for (const { id, kind } of nodes) {
        if (snapshot.state.nodes.find(n => n.id === id)?.metadata[kind]?.liveSession) {
          if (kind === 'agent') await ensureAgentStopped(id);
          else await ensureTerminalStopped(id);
        }
      }
    }
    return;
  }
`;
await writeFile(suitePath, suite.replace(anchor, probe + anchor));
await runVSCodeScenario({ projectRoot,
  debugRoot: path.join(investigation, 'native-' + scenario), runtimeDirName: 'dsc-storage-fix-' + scenario,
  workspacePath: projectRoot,
  extensionDevelopmentPath: [host, path.join(host, 'notifier-extension')],
  extensionTestsPath: suitePath, disableWorkspaceTrust: true,
  extensionTestsEnv: {
    DEV_SESSION_CANVAS_SMOKE_TEST_MODE: '1', DEV_SESSION_CANVAS_SMOKE_SCENARIO: 'local-links-and-stop',
    DEV_SESSION_CANVAS_STORAGE_VERIFICATION: scenario,
    DEV_SESSION_CANVAS_TEST_CODEX_COMMAND: path.join(projectRoot, 'tests/vscode-smoke/fixtures/fake-agent-provider'),
    DEV_SESSION_CANVAS_TEST_CLAUDE_COMMAND: path.join(projectRoot, 'tests/vscode-smoke/fixtures/missing-agent-provider')
  }
});
