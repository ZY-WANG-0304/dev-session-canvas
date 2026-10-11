// Node 22 + xvfb, repository root, packaged smoke-host at e640f6f1.
// Probe observes the original behavior; control waits for the original save after
// host-delete stop settlement. Exit 0 means the expected investigation was captured.
import assert from 'node:assert/strict';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { runVSCodeScenario } from '../../../scripts/smoke/vscode-smoke-runner.mjs';
const mode = process.argv[2];
assert.ok(['probe', 'control'].includes(mode));
const projectRoot = process.cwd();
const root = path.join(projectRoot, '.debug/owned-delete-persistence-investigation', mode + '-' + Date.now());
const host = path.join(root, 'host');
await mkdir(root, { recursive: true });
await cp(path.join(projectRoot, '.debug/vscode-vsix-smoke/smoke-host'), host, { recursive: true });
const hashes = {};
for (const file of ['extension.js', 'runtime-supervisor.js', 'webview.js']) {
  hashes[file] = createHash('sha256').update(await readFile(path.join(host, 'dist', file))).digest('hex');
}
const productPath = path.join(host, 'dist/extension.js');
let product = await readFile(productPath, 'utf8');
assert.equal(product.split('getDebugSnapshot(){').length, 2);
product = product.replace('getDebugSnapshot(){', 'getDebugSnapshot(){globalThis.__dscDeleteManager=this;');
await writeFile(productPath, product);
await writeFile(path.join(root, 'payload-hashes.json'), JSON.stringify({ original: hashes,
  instrumentedExtension: createHash('sha256').update(product).digest('hex') }, null, 2));
const suitePath = path.join(host, 'tests/vscode-smoke/extension-tests.cjs');
let suite = await readFile(suitePath, 'utf8');
const deletionCheckpoint = '    const survivingListNode = snapshot.state.nodes.find(';
assert.equal(suite.split(deletionCheckpoint).length, 2);
suite = suite.replace(deletionCheckpoint,
  '    globalThis.__dscDeletePassed = { agentAId, agentBId, snapshot };\n' + deletionCheckpoint);
const anchor = "  if (smokeScenario === 'local-execution-flow') {";
assert.equal(suite.split(anchor).length, 2);
suite = suite.replace(anchor, String.raw`
  if (process.env.DEV_SESSION_CANVAS_DELETE_RCA) {
    const mode = process.env.DEV_SESSION_CANVAS_DELETE_RCA;
    const { agentNode, terminalNode } = await prepareTrustedBaseNodesForAppliedRuntimePersistenceMode(false);
    await verifyHostBoundaryFlushesRecentLocalState(agentNode.id, terminalNode.id);
    await clearDiagnosticEvents();
    await clearHostMessages();
    await getDebugSnapshot();
    const manager = globalThis.__dscDeleteManager;
    assert.ok(manager);
    const traces = [];
    const copy = value => JSON.parse(JSON.stringify(value ?? null));
    const trace = (phase, record, extra = {}) => traces.push({ phase, at: new Date().toISOString(),
      nodeId: record?.nodeId, identity: copy(record?.execution.identity),
      persistence: record?.persistence ? { submitted: record.persistence.submitted,
        result: copy(record.persistence.result) } : null,
      collectorDisposed: record?.fileActivity?.disposed,
      owner: record ? { settled: record.execution.snapshot().settled, retired: record.execution.snapshot().retired } : null,
      nodePresent: record ? manager.state.nodes.some(node => node.id === record.nodeId) : undefined, ...extra });
    const originalAssert = manager.assertNonNativeHostPersistenceComplete.bind(manager);
    manager.assertNonNativeHostPersistenceComplete = records => {
      for (const record of records) trace('assert-save', record);
      try { return originalAssert(records); }
      catch (error) { for (const record of records) trace('assert-save-threw', record, { error: error.message }); throw error; }
    };
    const originalTerminate = manager.terminateExecutionNodeForDeletion.bind(manager);
    const wrapped = new Set();
    manager.terminateExecutionNodeForDeletion = async node => {
      const record = manager.nonNativeHostExecutions.get(node.kind + ':' + node.id);
      if (record && !wrapped.has(record)) {
        wrapped.add(record);
        const stop = record.execution.requestStop.bind(record.execution);
        record.execution.requestStop = reason => {
          const stopping = stop(reason);
          if (reason !== 'host-delete') return stopping;
          const observed = stopping.then(async result => {
            trace('stop-returned', record, { stopResult: copy(result) });
            if (mode === 'control' && result.kind === 'settled') {
              await manager.waitForNonNativeHostPersistence([record]);
              trace('control-save-waited', record);
            }
            return result;
          });
          if (mode === 'control') return observed;
          void observed;
          return stopping;
        };
        void record.persistence.promise.then(result => trace('save-finished', record, { saved: copy(result) }));
      }
      trace('delete-entered', record);
      try { await originalTerminate(node); trace('delete-cleanup-returned', record); }
      catch (error) { trace('delete-cleanup-threw', record, { error: error.message }); throw error; }
    };
    const result = { mode, traces, before: await getDebugSnapshot() };
    try {
      try { await verifyFileActivityViewsAndOpenFiles(); result.originalFunctionPassed = true; }
      catch (error) { result.failure = { message: error.message.split(' Last snapshot:')[0], stack: error.stack.split('\n').slice(1) }; }
      result.deletionCheckpoint = globalThis.__dscDeletePassed;
      if (mode === 'probe') {
        assert.ok(result.failure, 'Probe must reproduce the original failure.');
        assert.ok(traces.some(t => t.phase === 'assert-save-threw' && t.error.includes('persistence is pending')));
        assert.ok(traces.some(t => t.phase === 'save-finished' && t.saved.kind === 'saved' && t.nodePresent));
      } else {
        assert.ok(traces.some(t => t.phase === 'control-save-waited' && t.persistence.result.kind === 'saved'));
        assert.ok(!traces.some(t => t.phase === 'assert-save-threw'));
        assert.ok(result.deletionCheckpoint, 'The original Agent B deletion must advance in the control.');
      }
      console.log('Delete persistence investigation captured: ' + mode + ', original passed=' + Boolean(result.originalFunctionPassed));
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
      assert.equal(result.cleanup.localExecutions.length, 0);
    }
    return;
  }
` + anchor);
await writeFile(suitePath, suite);
console.log('Investigation directory: ' + root);
await runVSCodeScenario({ projectRoot, debugRoot: path.join(root, 'runtime'), runtimeDirName: 'dsc-delete-rca-' + mode,
  workspacePath: projectRoot, extensionDevelopmentPath: [host, path.join(host, 'notifier-extension')],
  extensionTestsPath: suitePath, disableWorkspaceTrust: true, extensionTestsEnv: {
    DEV_SESSION_CANVAS_SMOKE_TEST_MODE: '1', DEV_SESSION_CANVAS_SMOKE_SCENARIO: 'local-links-and-stop',
    DEV_SESSION_CANVAS_DELETE_RCA: mode,
    DEV_SESSION_CANVAS_TEST_CODEX_COMMAND: path.join(projectRoot, 'tests/vscode-smoke/fixtures/fake-agent-provider'),
    DEV_SESSION_CANVAS_TEST_CLAUDE_COMMAND: path.join(projectRoot, 'tests/vscode-smoke/fixtures/missing-agent-provider')
  } });
