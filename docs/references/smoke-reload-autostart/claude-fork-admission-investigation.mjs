// Node 22 + xvfb, repository root, packaged smoke-host from be574e48.
// Probe is timing-sensitive. Replay holds only the two captured history preparations
// until the Claude request reaches admission; the outer resize assertion remains active.
// Investigation success is not formal gate success.
import assert from 'node:assert/strict';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { runVSCodeScenario } from '../../../scripts/smoke/vscode-smoke-runner.mjs';
const mode = process.argv[2];
assert.ok(['probe', 'control', 'clean', 'replay'].includes(mode));
const projectRoot = process.cwd();
const root = path.join(projectRoot, '.debug/claude-fork-admission-investigation', mode + '-' + Date.now());
const host = path.join(root, 'host');
await mkdir(root, { recursive: true });
await cp(path.join(projectRoot, '.debug/vscode-vsix-smoke/smoke-host'), host, { recursive: true });
await cp(new URL('./claude-fork-admission-baseline.json', import.meta.url), path.join(host, 'tests/vscode-smoke/fork-baseline.json'));
const hashes = {};
for (const file of ['extension.js', 'runtime-supervisor.js', 'webview.js']) {
  hashes[file] = createHash('sha256').update(await readFile(path.join(host, 'dist', file))).digest('hex');
}
const productPath = path.join(host, 'dist/extension.js');
let product = await readFile(productPath, 'utf8');
assert.equal(product.split('getDebugSnapshot(){').length, 2);
product = product.replace('getDebugSnapshot(){', 'getDebugSnapshot(){globalThis.__dscForkManager=this;');
await writeFile(productPath, product);
await writeFile(path.join(root, 'payload-hashes.json'), JSON.stringify({ original: hashes,
  instrumentedExtension: createHash('sha256').update(product).digest('hex') }, null, 2));
const suitePath = path.join(host, 'tests/vscode-smoke/extension-tests.cjs');
let suite = await readFile(suitePath, 'utf8');
const anchor = "  if (smokeScenario === 'local-execution-flow') {";
assert.equal(suite.split(anchor).length, 2);
suite = suite.replace(anchor, String.raw`
  if (process.env.DEV_SESSION_CANVAS_FORK_RCA) {
    const mode = process.env.DEV_SESSION_CANVAS_FORK_RCA;
    await getDebugSnapshot();
    const manager = globalThis.__dscForkManager;
    assert.ok(manager);
    const copy = value => JSON.parse(JSON.stringify(value ?? null));
    const traces = [];
    let phase = 'setup';
    const records = () => [...manager.nonNativeHostExecutions.values()].map(record => ({
      nodeId: record.nodeId, identity: copy(record.execution.identity),
      execution: copy(record.execution.snapshot()),
      persistence: record.persistence ? { submitted: record.persistence.submitted,
        result: copy(record.persistence.result) } : null
    }));
    const nodes = () => copy(manager.state.nodes.map(node => ({ id: node.id, title: node.title,
      status: node.status, agent: node.metadata?.agent })));
    const trace = (event, extra = {}) => traces.push({ event, phase, at: new Date().toISOString(),
      nodes: nodes(), records: records(), ...extra });
    const originalStart = manager.startNonNativeHostExecution.bind(manager);
    let releasePreparation;
    const preparationGate = mode === 'replay' ? new Promise(resolve => { releasePreparation = resolve; }) : undefined;
    const historyId = nodeId => /^agent-[12]-/.test(nodeId);
    manager.startNonNativeHostExecution = async (...args) => {
      trace('start-enter', { kind: args[0], nodeId: args[1],
        sameKey: manager.nonNativeHostExecutions.has(args[0] + ':' + args[1]),
        limits: copy(manager.nonNativeExecutionOwner.admissionLimits) });
      if (preparationGate && historyId(args[1])) {
        const prepare = args[4];
        args[4] = async () => { await preparationGate; return prepare(); };
      }
      try { const value = await originalStart(...args); trace('start-return', { nodeId: args[1] }); return value; }
      catch (error) {
        trace('start-threw', { nodeId: args[1], error: error.message });
        if (!historyId(args[1])) releasePreparation?.();
        throw error;
      }
    };
    const originalSeed = manager.setPersistedStateForTest.bind(manager);
    manager.setPersistedStateForTest = async state => {
      trace('seed-enter', { input: copy(state.nodes) });
      const value = await originalSeed(state);
      trace('seed-return');
      return value;
    };
    const result = { mode, traces, checkpoints: [] };
    const checkpoint = async name => result.checkpoints.push({ name, snapshot: await getDebugSnapshot() });
    const settleHistory = async baseline => {
      const current = await getDebugSnapshot();
      for (const node of current.state.nodes.filter(node => node.kind === 'agent'
        && !baseline.state.nodes.some(original => original.id === node.id))) {
        // Wait for the original intent to settle, including immediate fake resume exit.
        await waitForSnapshot(snapshot => {
          const value = findNodeById(snapshot, node.id);
          return !value.metadata?.agent?.pendingLaunch;
        }, 20000);
        await ensureAgentStopped(node.id);
        await waitForSnapshot(snapshot => !snapshot.localExecutions.some(record => record.nodeId === node.id), 20000);
      }
      await checkpoint('history-settled');
    };
    try {
      if (mode === 'replay') {
        phase = 'replay-baseline';
        await ensureEditorCanvasReady();
        const raw = JSON.parse(await fs.readFile(path.join(__dirname, 'fork-baseline.json'), 'utf8'));
        for (const node of raw.nodes) {
          node.metadata.agent.cwd = vscode.workspace.workspaceFolders[0].uri.fsPath;
          node.metadata.agent.customLaunchCommand = node.metadata.agent.customLaunchCommand.replace('/tmp/dscr', node.metadata.agent.cwd);
        }
        await setPersistedState(raw);
        await waitForSnapshot(snapshot => snapshot.localExecutions.length === 2, 20000);
        trace('two-original-intents-reserved');
      } else if (mode !== 'clean') {
        phase = 'runtime-reset';
        await verifyRuntimePersistenceRequiresReloadAndClearsState();
        await checkpoint(phase);
        phase = 'history-restore';
        let baseline = mode === 'control' ? await getDebugSnapshot() : undefined;
        await verifySidebarSessionHistoryRestore();
        trace('function-return');
        if (mode === 'control') await settleHistory(baseline);
        phase = 'history-fork';
        baseline = mode === 'control' ? await getDebugSnapshot() : undefined;
        await verifySidebarSessionHistoryForkActionUi();
        trace('function-return');
        if (mode === 'control') await settleHistory(baseline);
        phase = 'codex-branch';
        await verifyCodexAgentBranchFromCurrentNode();
        await checkpoint(phase);
      }
      phase = 'claude-branch';
      await verifyClaudeAgentBranchFromCurrentNode();
      result.originalFunctionPassed = true;
      await checkpoint(phase);
    } catch (error) {
      result.failure = { phase, message: error.message.split(' Last snapshot:')[0], stack: error.stack.split('\n').slice(1) };
    } finally {
      releasePreparation?.();
      phase = 'cleanup';
      result.after = await getDebugSnapshot();
      result.events = await getDiagnosticEvents();
      await fs.writeFile(path.join(artifactDir, 'result.json'), JSON.stringify(result, null, 2));
      // Close the test Host boundary so even a still-starting original intent is settled.
      await simulateRuntimeReload();
      result.cleanup = await getDebugSnapshot();
      await fs.writeFile(path.join(artifactDir, 'result.json'), JSON.stringify(result, null, 2));
      assert.equal(result.cleanup.localExecutions.length, 0);
    }
    if (mode === 'replay') {
      assert.ok(result.failure, 'Original sequence must reproduce a failure.');
      assert.ok(traces.some(t => t.event === 'start-threw' && t.error.includes('Host capacity')));
      const admission = traces.find(t => t.event === 'start-enter' && t.phase === 'claude-branch' && !historyId(t.nodeId));
      assert.equal(admission.sameKey, false);
      assert.equal(admission.records.filter(r => r.execution.admissionPending).length, 2);
    } else if (mode === 'probe') {
      assert.ok(result.originalFunctionPassed || traces.some(t => t.event === 'start-threw' && t.error.includes('Host capacity')),
        JSON.stringify(result.failure));
    } else {
      assert.ok(result.originalFunctionPassed, JSON.stringify(result.failure));
    }
    console.log('Fork admission investigation captured: ' + mode + ', original passed=' + Boolean(result.originalFunctionPassed));
    return;
  }
` + anchor);
await writeFile(suitePath, suite);
console.log('Investigation directory: ' + root);
await runVSCodeScenario({ projectRoot, debugRoot: path.join(root, 'runtime'), runtimeDirName: 'dsc-fork-rca-' + mode,
  workspacePath: projectRoot, extensionDevelopmentPath: [host, path.join(host, 'notifier-extension')],
  extensionTestsPath: suitePath, disableWorkspaceTrust: true, extensionTestsEnv: {
    DEV_SESSION_CANVAS_SMOKE_TEST_MODE: '1', DEV_SESSION_CANVAS_SMOKE_SCENARIO: 'local-links-and-stop',
    DEV_SESSION_CANVAS_FORK_RCA: mode,
    DEV_SESSION_CANVAS_TEST_CODEX_COMMAND: path.join(projectRoot, 'tests/vscode-smoke/fixtures/fake-agent-provider'),
    DEV_SESSION_CANVAS_TEST_CLAUDE_COMMAND: path.join(projectRoot, 'tests/vscode-smoke/fixtures/missing-agent-provider')
  } });
