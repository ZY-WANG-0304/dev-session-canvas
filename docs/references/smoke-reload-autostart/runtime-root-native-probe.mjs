// 只用于根因定位。复制既有 VSIX smoke host，原生产源码和工件保持不变。
// 仓库根执行（Node 22）：xvfb-run -a node <本文件> 0002|0022
// 前提：.debug/vscode-vsix-smoke/smoke-host 来自所调查 head 的 VSIX。
import assert from 'node:assert/strict';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runVSCodeScenario } from '../../../scripts/smoke/vscode-smoke-runner.mjs';

const mask = process.argv[2];
assert.ok(['0002', '0022'].includes(mask));
process.umask(Number.parseInt(mask, 8));
const projectRoot = process.cwd();
const investigation = path.join(projectRoot, '.debug/runtime-root-investigation');
await mkdir(investigation, { recursive: true });
const host = path.join(investigation, 'probe-host');
if (mask === '0002') {
  await cp(path.join(projectRoot, '.debug/vscode-vsix-smoke/smoke-host'), host, { recursive: true });
  const launcherPath = path.join(host, 'dist/runtime-supervisor-launcher.js');
  const launcher = await readFile(launcherPath, 'utf8');
  const pattern = /catch\{return (\w+)\("Root runtime preparation or submission did not complete\."\)\}/g;
  assert.equal([...launcher.matchAll(pattern)].length, 1);
  await writeFile(launcherPath, launcher.replace(pattern,
    'catch(error){return $1("Root runtime preparation or submission did not complete. RCA: "+String(error.message))}'));
  const originalEntry = await readFile(path.join(host, 'extension.js'), 'utf8');
  const observer = String.raw`
const rcaFs = require('fs');
const rcaPath = require('path');
let rcaGlobal;
const rcaState = () => {
  try { const s = rcaFs.lstatSync(rcaGlobal); return { mode: (s.mode & 4095).toString(8), uid: s.uid }; }
  catch (error) { return { code: error.code }; }
};
const rcaWrite = event => {
  rcaFs.appendFileSync(rcaPath.join(process.env.DEV_SESSION_CANVAS_SMOKE_ARTIFACT_DIR, 'directory-creation.jsonl'),
    JSON.stringify({ ...event, umask: process.umask().toString(8) }) + '\n');
};
const rcaCapture = (name, target, options) => rcaGlobal && String(target).startsWith(rcaGlobal)
  ? { name, target: rcaPath.relative(rcaGlobal, String(target)), options,
      before: rcaState(), stack: new Error().stack.split('\n').slice(2, 9) } : undefined;
const rcaMkdirSync = rcaFs.mkdirSync;
rcaFs.mkdirSync = function(target, options) {
  const event = rcaCapture('mkdirSync', target, options);
  const result = rcaMkdirSync.apply(this, arguments);
  if (event) rcaWrite({ ...event, after: rcaState() });
  return result;
};
const rcaMkdir = rcaFs.promises.mkdir;
rcaFs.promises.mkdir = async function(target, options) {
  const event = rcaCapture('promises.mkdir', target, options);
  const result = await rcaMkdir.apply(this, arguments);
  if (event) rcaWrite({ ...event, after: rcaState() });
  return result;
};
`;
  await writeFile(path.join(host, 'extension.js'), observer + originalEntry.replace(
    'await Promise.resolve(mainExtension.activate?.(context));',
    'rcaGlobal = context.globalStorageUri.fsPath; rcaWrite({ name: "activate", before: rcaState() });\n  await Promise.resolve(mainExtension.activate?.(context));'));
  const suitePath = path.join(host, 'tests/vscode-smoke/extension-tests.cjs');
  const suite = await readFile(suitePath, 'utf8');
  const anchor = "  if (smokeScenario === 'local-execution-flow') {";
  assert.equal(suite.split(anchor).length, 2);
  const probe = String.raw`
  if (process.env.DEV_SESSION_CANVAS_ROOT_DIRECTORY_PROBE === '1') {
    let created;
    try {
      created = await prepareTrustedBaseNodesForAppliedRuntimePersistenceMode(true);
      await waitForAgentLive(created.agentNode.id);
      await waitForTerminalLive(created.terminalNode.id);
    } finally {
      const current = await getDebugSnapshot();
      const events = await getDiagnosticEvents();
      const directory = path.join(process.env.DEV_SESSION_CANVAS_SMOKE_ARTIFACT_DIR,
        '../user-data/User/globalStorage/devsessioncanvas.dev-session-canvas');
      await fs.writeFile(path.join(process.env.DEV_SESSION_CANVAS_SMOKE_ARTIFACT_DIR, 'root-preparation-probe.json'),
        JSON.stringify({ enabled: vscode.workspace.getConfiguration().get('devSessionCanvas.runtimePersistence.enabled'),
          umask: process.umask().toString(8), globalMode: ((await fs.lstat(directory)).mode & 4095).toString(8),
          nodes: current.state.nodes.filter(n => n.kind !== 'note').map(n => ({ id: n.id, kind: n.kind,
            status: n.status, summary: n.summary, metadata: n.metadata[n.kind] })),
          failures: events.filter(e => e.kind === 'execution/candidateStartFailed') }, null, 2));
      // 先固定失败现场，再清理本次隔离运行已经成功的会话。
      for (const node of current.state.nodes) {
        if (node.kind === 'agent' && node.metadata.agent.liveSession) await ensureAgentStopped(node.id);
        if (node.kind === 'terminal' && node.metadata.terminal.liveSession) await ensureTerminalStopped(node.id);
      }
    }
    console.log('Root preparation probe: original Runtime auto-start Agent and Terminal live.');
    return;
  }
`;
  assert.ok(suite.includes('async function getDiagnosticEvents('));
  await writeFile(suitePath, suite.replace(anchor, probe + anchor));
}
await runVSCodeScenario({ projectRoot,
  debugRoot: path.join(investigation, 'native-' + mask), runtimeDirName: 'dsc-root-rca-' + mask,
  workspacePath: projectRoot,
  extensionDevelopmentPath: [host, path.join(host, 'notifier-extension')],
  extensionTestsPath: path.join(host, 'tests/vscode-smoke/extension-tests.cjs'),
  disableWorkspaceTrust: true,
  extensionTestsEnv: {
    DEV_SESSION_CANVAS_SMOKE_TEST_MODE: '1', DEV_SESSION_CANVAS_SMOKE_SCENARIO: 'local-links-and-stop',
    DEV_SESSION_CANVAS_ROOT_DIRECTORY_PROBE: '1',
    DEV_SESSION_CANVAS_TEST_CODEX_COMMAND: path.join(projectRoot, 'tests/vscode-smoke/fixtures/fake-agent-provider'),
    DEV_SESSION_CANVAS_TEST_CLAUDE_COMMAND: path.join(projectRoot, 'tests/vscode-smoke/fixtures/missing-agent-provider')
  }
});
