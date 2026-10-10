// Node 22 + xvfb, repository root, packaged smoke-host at 5f0d360e.
// All modes expose a manager reference in an isolated bundle for observation.
// *-control adds an experimental runtime wrapper; this is not a production fix.
// Exit 0 means the expected investigation outcome was captured, not a gate pass.
import assert from 'node:assert/strict';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { runVSCodeScenario } from '../../../scripts/smoke/vscode-smoke-runner.mjs';
const mode = process.argv[2];
assert.ok(['file-probe', 'file-control', 'resume-probe', 'resume-control'].includes(mode));
const projectRoot = process.cwd();
const root = path.join(projectRoot, '.debug/file-activity-resume-investigation', mode + '-' + Date.now());
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
product = product.replace('getDebugSnapshot(){', 'getDebugSnapshot(){globalThis.__dscFileResumeManager=this;');
await writeFile(productPath, product);
await writeFile(path.join(root, 'payload-hashes.json'), JSON.stringify({ original: hashes,
  instrumentedExtension: createHash('sha256').update(product).digest('hex') }, null, 2));
const suitePath = path.join(host, 'tests/vscode-smoke/extension-tests.cjs');
let suite = await readFile(suitePath, 'utf8');
// Retain the original first read assertion, then end the investigation prefix.
const readEnd = `      return Boolean(reference && reference.owners.some((owner) => owner.nodeId === agentAId && owner.accessMode === 'read'));
    }, 20000);`;
assert.equal(suite.split(readEnd).length, 2);
suite = suite.replace(readEnd, readEnd + '\n    return { snapshot, agentAId, agentBId };');
// Make the fake shell install its signal trap before reload in both resume runs.
const fnStart = suite.indexOf('async function verifyRuntimeReloadRecovery(');
const fnEnd = suite.indexOf('\nasync function ', fnStart + 1);
let fn = suite.slice(fnStart, fnEnd);
const barrier = "event.detail?.nodeId === agentNodeId && event.detail.sessionId === initialAgent.executionSessionId));";
assert.equal(fn.split(barrier).length, 2);
fn = fn.replace(barrier, barrier + String.raw`
  await dispatchWebviewMessage({ type: 'webview/executionInput', payload: {
    kind: 'agent', nodeId: agentNodeId, data: 'burst 1\r'
  } });
  await waitForLocalExecutionOutput(initialAgent, '[fake-agent] burst 001');
`);
suite = suite.slice(0, fnStart) + fn + suite.slice(fnEnd);
const anchor = "  if (smokeScenario === 'local-execution-flow') {";
assert.equal(suite.split(anchor).length, 2);
suite = suite.replace(anchor, String.raw`
  if (process.env.DEV_SESSION_CANVAS_FILE_RESUME_RCA) {
    const mode = process.env.DEV_SESSION_CANVAS_FILE_RESUME_RCA;
    const { agentNode, terminalNode } = await prepareTrustedBaseNodesForAppliedRuntimePersistenceMode(false);
    await ensureAgentStopped(agentNode.id);
    await ensureTerminalStopped(terminalNode.id);
    await getDebugSnapshot();
    const manager = globalThis.__dscFileResumeManager;
    assert.ok(manager);
    const traces = [];
    const copy = value => JSON.parse(JSON.stringify(value ?? null));
    const metadata = value => value && Object.fromEntries(['provider','lifecycle','pendingLaunch','liveSession',
      'resumeStrategy','resumeSupported','resumeSessionId','resumeStoragePath','lastResumeError'].map(key => [key, value[key]]));
    let startNodeId;
    const originals = {};
    const wrap = (name, action) => { originals[name] = manager[name]; manager[name] = action(originals[name].bind(manager)); };
    wrap('startAgentSession', original => async (...args) => {
      startNodeId = args[0];
      return original(...args);
    });
    wrap('createConfiguredAgentFileActivitySession', original => (...args) => {
      const result = original(...args);
      traces.push({ method: 'createFileActivity', nodeId: startNodeId, provider: args[0], command: args[1],
        extraArgs: result.extraArgs, extraEnv: result.extraEnv });
      return result;
    });
    wrap('bindAgentFileActivitySession', original => (...args) => {
      traces.push({ method: 'bindFileActivity', nodeId: args[0] });
      return original(...args);
    });
    wrap('buildAgentLaunchSpec', original => (...args) => {
      if (mode === 'file-control') {
        const session = manager.createConfiguredAgentFileActivitySession(args[0].provider, args[0].command);
        args[8] = session;
        manager.bindAgentFileActivitySession(startNodeId, session);
      }
      try {
        const result = original(...args);
        traces.push({ method: 'buildLaunch', nodeId: startNodeId, file: result.file, args: result.args,
          resume: copy(args[7]), fileActivityArgument: Boolean(args[8]),
          fakeEventPath: result.env.DEV_SESSION_CANVAS_FAKE_AGENT_FILE_EVENT_STREAM_PATH ?? null,
          claudeEventPath: result.env.DEV_SESSION_CANVAS_AGENT_FILE_EVENT_STREAM_PATH ?? null,
          boundFileSessions: [...manager.agentFileActivitySessions.keys()] });
        return result;
      } catch (error) {
        traces.push({ method: 'buildLaunchFailed', nodeId: startNodeId, resume: copy(args[7]), reason: error.message });
        throw error;
      }
    });
    wrap('readAgentResumeContextFromOutput', original => business => {
      const result = original(business);
      if (result) traces.push({ method: 'parseResumeHint', previous: copy(business.agentResume), parsed: copy(result),
        hasCodexStopHint: business.buffer.includes('To continue this session, run codex resume ') });
      if (mode === 'resume-control' && business.agentResume?.strategy === 'fake-provider') return null;
      return result;
    });
    wrap('resolveAgentResumeContext', original => (...args) => {
      const result = original(...args);
      traces.push({ method: 'resolveResume', nodeId: args[0], provider: args[1], launchMode: args[2], command: args[3],
        metadata: copy(metadata(args[4])), result: copy(result) });
      return result;
    });
    await clearDiagnosticEvents(); await clearHostMessages();
    const result = { mode, before: await getDebugSnapshot() };
    try {
      if (mode.startsWith('file')) result.prefix = await verifyFileActivityViewsAndOpenFiles();
      else await verifyRuntimeReloadRecovery(agentNode.id, terminalNode.id);
      result.scenarioPassed = true;
    } catch (error) {
      result.scenarioPassed = false;
      result.failure = { message: error.message, stack: error.stack };
    } finally {
      result.after = await getDebugSnapshot();
      result.events = await getDiagnosticEvents(); result.messages = await getHostMessages();
      result.traces = copy(traces);
      if (mode === 'resume-probe') {
        const node = findNodeById(result.after, agentNode.id);
        const context = originals.resolveAgentResumeContext.call(manager, node.id, 'codex', 'resume', '/installed/codex', node.metadata.agent);
        result.realCommandContextControl = { metadata: metadata(node.metadata.agent), context,
          args: originals.buildAgentLaunchSpec.call(manager, { provider: 'codex', command: '/installed/codex' }, [],
            '/tmp/dscr', 80, 24, {}, 'resume', context).args };
      }
      for (const [name, original] of Object.entries(originals)) manager[name] = original;
      await fs.writeFile(path.join(artifactDir, 'result.json'), JSON.stringify(result, null, 2));
      for (const node of result.after.state.nodes) {
        if (node.kind === 'agent') await ensureAgentStopped(node.id);
        else if (node.kind === 'terminal') await ensureTerminalStopped(node.id);
      }
      for (const nodeId of [...manager.agentFileActivitySessions.keys()]) await manager.disposeAgentFileActivitySession(nodeId);
      result.cleanup = await getDebugSnapshot();
      await fs.writeFile(path.join(artifactDir, 'result.json'), JSON.stringify(result, null, 2));
    }
    assert.equal(result.scenarioPassed, mode.endsWith('control'), 'Unexpected investigation outcome.');
    if (mode === 'file-probe') {
      assert.ok(result.messages.some(message => message.type === 'host/executionOutput' &&
        message.payload.chunk.includes('[fake-agent] read ')));
      assert.equal(result.traces.filter(trace => trace.method === 'createFileActivity').length, 0);
      assert.ok(result.traces.filter(trace => trace.method === 'buildLaunch').every(trace =>
        !trace.fileActivityArgument && !trace.fakeEventPath && trace.boundFileSessions.length === 0));
    }
    if (mode === 'resume-probe') {
      assert.match(result.failure.message, /Missing resumable Codex session ID/);
      assert.ok(result.traces.some(trace => trace.method === 'parseResumeHint' &&
        trace.previous?.strategy === 'fake-provider' && trace.previous.storagePath && trace.parsed.strategy === 'codex-session-id'));
    }
    console.log('Investigation captured expected outcome: ' + mode + ', original scenario passed=' + result.scenarioPassed);
    return;
  }
` + anchor);
await writeFile(suitePath, suite);
console.log('Investigation directory: ' + root);
await runVSCodeScenario({ projectRoot, debugRoot: path.join(root, 'runtime'), runtimeDirName: 'dsc-file-resume-' + mode,
  workspacePath: projectRoot, extensionDevelopmentPath: [host, path.join(host, 'notifier-extension')],
  extensionTestsPath: suitePath, disableWorkspaceTrust: true, extensionTestsEnv: {
    DEV_SESSION_CANVAS_SMOKE_TEST_MODE: '1', DEV_SESSION_CANVAS_SMOKE_SCENARIO: 'local-links-and-stop',
    DEV_SESSION_CANVAS_FILE_RESUME_RCA: mode,
    DEV_SESSION_CANVAS_TEST_CODEX_COMMAND: path.join(projectRoot, 'tests/vscode-smoke/fixtures/fake-agent-provider'),
    DEV_SESSION_CANVAS_TEST_CLAUDE_COMMAND: path.join(projectRoot, 'tests/vscode-smoke/fixtures/missing-agent-provider')
  } });
