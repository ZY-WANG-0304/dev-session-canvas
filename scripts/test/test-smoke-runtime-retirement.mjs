import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
const { captureRuntimeExecution, openRuntimeRetirementObserver, stopRuntimeExecutionsAfterRetirement } =
  createRequire(import.meta.url)('../../tests/vscode-smoke/runtime-retirement.cjs');

const source = await readFile('tests/vscode-smoke/extension-tests.cjs', 'utf8');
const before = source.indexOf('async function verifyLiveRuntimePersistence(');
const after = source.indexOf('\nasync function ', before + 1);
const scenario = source.slice(before, after);
const executions = ['agent', 'terminal'].map(kind => ({ kind, nodeId: kind, sessionId: `original-${kind}`,
  runtimeStoragePath: '/test/runtime', runtimeBackend: 'legacy-detached' }));
function fixture(options = {}) {
  let clock = 0, sleeps = 0;
  const stopped = [], closed = [], starts = [], deadlines = [];
  const nodes = executions.map(e => ({ id: e.nodeId, kind: e.kind, metadata: { [e.kind]: {
    liveSession: true, persistenceMode: 'live-runtime', runtimeSessionId: e.sessionId,
    runtimeStoragePath: e.runtimeStoragePath, runtimeBackend: e.runtimeBackend } } }));
  const snapshot = () => ({ state: { nodes }, localExecutions: [] });
  const deps = {
    now: () => clock, sleep: async ms => { clock += ms; sleeps++; options.onSleep?.(nodes); },
    getRuntimeSupervisorState: async () => { clock += options.captureCost ?? 0; return {}; },
    openObserver: async (e, _state, deadline) => {
      deadlines.push(deadline);
      if (options.openFailure === e.kind) throw new Error('original observation unavailable');
      return { exists: async () => {
        if (options.readFailure) throw options.readFailure;
        return stopped.length < 2 || sleeps < (options.retainSleeps ?? 2);
      }, close: () => closed.push(e.kind) };
    },
    stop: async e => {
      stopped.push(e.kind); clock += options.stopCost ?? 0;
      const n = nodes.find(n => n.id === e.nodeId);
      n.metadata[e.kind].liveSession = false;
      delete n.metadata[e.kind].runtimeSessionId;
    },
    getSnapshot: async () => snapshot()
  };
  const marker = new Error('after original restart verified');
  const context = vm.createContext({ assert, captureRuntimeExecution,
    stopRuntimeExecutionsAfterRetirement: args => stopRuntimeExecutionsAfterRetirement({ ...args, ...deps, stop: args.stop }),
    setRuntimePersistenceEnabled: async () => {}, clearHostMessages: async () => {},
    waitForAgentLive: async () => {}, waitForTerminalLive: async () => {},
    getDebugSnapshot: async () => snapshot(), getRuntimeSupervisorState: deps.getRuntimeSupervisorState,
    ensureAgentStopped: async nodeId => deps.stop(executions.find(e => e.nodeId === nodeId)),
    ensureTerminalStopped: async nodeId => deps.stop(executions.find(e => e.nodeId === nodeId)),
    dispatchWebviewMessage: async message => {
      if (message.type === 'webview/stopExecutionSession') {
        await deps.stop(executions.find(e => e.nodeId === message.payload.nodeId)); return;
      }
      assert.ok(sleeps >= (options.retainSleeps ?? 2), 'Old storage must retire before any original start');
      starts.push(message.payload.kind);
    },
    waitForRuntimeExecutionStarted: async kind => { if (kind === 'terminal') throw marker; }
  });
  const run = vm.runInContext(`${scenario}\nverifyLiveRuntimePersistence`, context);
  return { run: () => run('agent', 'terminal'), marker, stopped, closed, starts, deadlines, deps, nodes,
    time: () => clock, snapshot };
}
const tests = [];
const test = (name, run) => tests.push({ name, run });
test('original persistence scenario waits both retired identities before its single Agent and Terminal starts', async () => {
  const f = fixture(); await assert.rejects(f.run(), error => error === f.marker);
  assert.deepEqual(f.starts, ['agent', 'terminal']); assert.deepEqual(f.stopped, ['agent', 'terminal']);
  assert.deepEqual(f.closed, ['agent', 'terminal']); assert.deepEqual(f.deadlines, [15000, 15000]);
});
test('localExecutions empty and live false cannot bypass retained Supervisor storage', async () => {
  const f = fixture({ retainSleeps: 200 }); await assert.rejects(f.run(), /Timed out.*storage retirement/);
  assert.equal(f.time(), 15000); assert.equal(f.starts.length, 0); assert.equal(f.closed.length, 2);
});
for (const onSleep of [nodes => { nodes.pop(); }, nodes => { nodes[0].metadata.agent.runtimeSessionId = 'replacement'; }]) {
  test('node removal or replacement never authorizes original restart', async () => {
    const f = fixture({ onSleep }); await assert.rejects(f.run(), /must not/); assert.equal(f.starts.length, 0);
    assert.equal(f.closed.length, 2);
  });
}
test('all original observers are closed when second capture fails before stopping', async () => {
  const f = fixture({ openFailure: 'terminal' }); await assert.rejects(f.run(), /unavailable/);
  assert.deepEqual(f.closed, ['agent']); assert.equal(f.stopped.length, 0); assert.equal(f.starts.length, 0);
});
test('failed observation propagates and never resubmits a start', async () => {
  const failure = new Error('old delete failed'); const f = fixture({ readFailure: failure });
  await assert.rejects(f.run(), error => error === failure); assert.equal(f.starts.length, 0); assert.equal(f.closed.length, 2);
});
test('capture and stop costs consume the same original budget', async () => {
  const f = fixture({ captureCost: 14900, stopCost: 100 }); await assert.rejects(f.run(), /Timed out/);
  assert.equal(f.stopped.length, 1); assert.equal(f.starts.length, 0); assert.equal(f.closed.length, 2);
});
test('capture requires a complete original live-runtime identity', () => {
  const f = fixture(); f.nodes[0].metadata.agent.runtimeStoragePath = undefined;
  assert.throws(() => captureRuntimeExecution(f.snapshot(), 'agent', 'agent'), /original live Runtime identity/);
});
test('stopping nodes remain pending until both live facts and storage settle', async () => {
  const f = fixture({ retainSleeps: 0 });
  let reads = 0;
  await stopRuntimeExecutionsAfterRetirement({ ...f.deps, executions,
    stop: async () => {}, getSnapshot: async () => {
      reads++;
      if (reads === 3) for (const node of f.nodes) node.metadata[node.kind].liveSession = false;
      return f.snapshot();
    }, openObserver: async () => ({ exists: async () => false, close() {} }) });
  assert.equal(reads, 3); assert.equal(f.time(), 200);
});
test('an unchanged session ID cannot hide a changed runtime owner', async () => {
  const f = fixture();
  f.nodes[0].metadata.agent.runtimeOwner = { generation: 'replacement' };
  await assert.rejects(stopRuntimeExecutionsAfterRetirement({ ...f.deps, executions, stop: async () => {} }), /deep.*equal/i);
  assert.equal(f.closed.length, 2);
});

test('the actual source smoke entry explicitly enables observation in preparation and launch', async () => {
  const runner = await readFile('scripts/smoke/run-vscode-smoke.mjs', 'utf8');
  const start = runner.indexOf('async function main()');
  const main = runner.slice(start, runner.indexOf('\nasync function ', start + 1));
  const calls = [];
  const context = vm.createContext({ path, process: { execPath: '/test/node22' }, projectRoot: '/test/project', smokeDebugRoot: '/test/debug',
    scenarios: [{ name: 'execution-start/auto-start', variant: 'execution-start--auto-start', disableWorkspaceTrust: true }], fakeAgentProviderPath: '/test/agent',
    missingAgentProviderPath: '/test/missing', smokeFixturesPath: '/test/bin', console: { log() {} },
    shouldReRunInsideXvfb: () => false, shouldRunScenario: name => name === 'execution-start/auto-start',
    prepareRuntime: async options => { calls.push(options); return { debugRoot: options.debugRoot }; },
    prepareMainSmokeHostExtension: async options => options.targetRoot,
    resolveStagedSmokeTestPath: (...parts) => path.join(...parts),
    launchPreparedVSCodeScenario: async options => { calls.push(options); }
  });
  await vm.runInContext(`${main}\nmain()`, context);
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.extensionTestsEnv.DEV_SESSION_CANVAS_SMOKE_TEST_MODE, '1',
      'Source Host ExtensionMode.Test does not itself enable observation in the separate Supervisor');
    assert.equal(call.extensionTestsEnv.DEV_SESSION_CANVAS_TEST_NODE_PATH, '/test/node22',
      'TTY subject uses the outer Node executable rather than the Electron Host executable');
  }
});

for (const mode of ['retained-then-absent', 'wrong-owner', 'wrong-session', 'wrong-kind', 'invalid-absence', 'missing-before-stop', 'disconnect']) {
  test(`fixed real socket observation: ${mode}`, async () => {
    const socketPath = path.join(os.tmpdir(), `dsc-retire-${process.pid}-${tests.length}.sock`);
    const sockets = new Set(); let queries = 0;
    const server = net.createServer(socket => {
      sockets.add(socket); socket.on('close', () => sockets.delete(socket)); let data = '';
      socket.on('data', chunk => {
        data += chunk.toString(); const end = data.indexOf('\n'); if (end < 0) return;
        const request = JSON.parse(data.slice(0, end)); data = data.slice(end + 1);
        if (mode === 'disconnect' && request.method !== 'hello') { socket.destroy(); return; }
        const result = request.method === 'hello'
          ? { pid: process.pid, runtimeBackend: 'legacy-detached', ...(mode === 'wrong-owner' ? { runtimeOwner: {} } : {}) }
          : { sessionId: mode === 'wrong-session' ? 'replacement' : request.params.sessionId,
            kind: mode === 'wrong-kind' ? 'terminal' : request.params.kind,
            exists: mode === 'invalid-absence' ? undefined : mode === 'missing-before-stop' ? false : ++queries === 1 };
        socket.write(`${JSON.stringify({ type: 'response', id: request.id, ok: true, result })}\n`);
      });
    });
    await new Promise(resolve => server.listen(socketPath, resolve));
    let observer;
    try {
      const operation = openRuntimeRetirementObserver(executions[0], { registries: { 'legacy-detached': {
        entries: [{ runtimeStoragePath: '/test/runtime', socketPath }] } } }, Date.now() + 1000);
      if (mode === 'retained-then-absent') { observer = await operation; assert.equal(await observer.exists(), false); }
      else await assert.rejects(operation);
    } finally {
      observer?.close(); for (const socket of sockets) socket.destroy();
      await new Promise(resolve => server.close(resolve));
    }
  });
}
for (const { name, run } of tests) { await run(); console.log(`PASS ${name}`); }
console.log(`Smoke Runtime retirement: ${tests.length}/${tests.length} passed.`);
