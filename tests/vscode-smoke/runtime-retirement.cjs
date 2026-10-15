const assert = require('node:assert/strict');
const net = require('node:net');

function captureRuntimeExecution(snapshot, kind, nodeId) {
  const node = snapshot.state.nodes.find(node => node.id === nodeId && node.kind === kind);
  const metadata = node?.metadata?.[kind];
  assert.ok(metadata?.liveSession && metadata.persistenceMode === 'live-runtime' &&
    metadata.runtimeSessionId && metadata.runtimeStoragePath && metadata.runtimeBackend,
  `Expected the original live Runtime identity for ${kind}:${nodeId}`);
  return Object.freeze({ kind, nodeId, sessionId: metadata.runtimeSessionId,
    runtimeStoragePath: metadata.runtimeStoragePath, runtimeBackend: metadata.runtimeBackend,
    runtimeOwner: metadata.runtimeOwner === undefined ? undefined : JSON.parse(JSON.stringify(metadata.runtimeOwner)) });
}

async function openRuntimeRetirementObserver(execution, state, deadline, now = Date.now) {
  const entries = state.registries[execution.runtimeBackend]?.entries ?? [];
  const matches = entries.filter(entry => entry.runtimeStoragePath === execution.runtimeStoragePath);
  assert.strictEqual(matches.length, 1, 'The original runtime storage must select exactly one Supervisor socket.');
  assert.ok(matches[0].socketPath, 'The original Supervisor socket must be available.');
  const socket = net.createConnection(matches[0].socketPath);
  let pending, sequence = 0, buffer = '', failure;
  const fail = error => {
    failure ??= error;
    if (pending) { const request = pending; pending = undefined; clearTimeout(request.timer); request.reject(failure); }
  };
  socket.on('error', fail);
  socket.on('close', () => fail(new Error('The original Supervisor observation connection closed.')));
  socket.on('data', chunk => {
    buffer += chunk.toString();
    if (buffer.length > 65536) { fail(new Error('Supervisor retirement response exceeded its limit.')); socket.destroy(); return; }
    const end = buffer.indexOf('\n');
    if (end < 0) return;
    try {
      const response = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      assert.ok(pending && response.type === 'response' && response.id === pending.id,
        'Supervisor retirement response does not belong to the original request.');
      assert.strictEqual(response.ok, true, JSON.stringify(response.error));
      const request = pending; pending = undefined; clearTimeout(request.timer); request.resolve(response.result);
    } catch (error) { fail(error); socket.destroy(); }
  });
  const request = (method, params) => new Promise((resolve, reject) => {
    if (failure) { reject(failure); return; }
    if (now() >= deadline) { reject(new Error('Original Runtime retirement deadline expired.')); return; }
    assert.ok(!pending, 'Only one retirement observation may be in flight.');
    const id = `smoke-retirement-${++sequence}`;
    const timer = setTimeout(() => { fail(new Error('Original Runtime retirement request timed out.')); socket.destroy(); }, deadline - now());
    pending = { id, timer, resolve, reject };
    socket.write(`${JSON.stringify({ type: 'request', id, method, ...(params ? { params } : {}) })}\n`);
  });
  const observer = {
    async exists() {
      const result = await request('getSessionRetirementForTest', { sessionId: execution.sessionId, kind: execution.kind });
      assert.ok(result && result.sessionId === execution.sessionId && result.kind === execution.kind &&
        typeof result.exists === 'boolean', 'Supervisor retirement evidence has a different or invalid original identity.');
      return result.exists;
    },
    close() { socket.destroy(); }
  };
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { reject(new Error('Original Supervisor connection timed out.')); socket.destroy(); }, Math.max(0, deadline - now()));
      const finish = error => { clearTimeout(timer); socket.removeListener('connect', connected); socket.removeListener('error', errored); socket.removeListener('close', closed); error ? reject(error) : resolve(); };
      const connected = () => finish();
      const errored = error => finish(error);
      const closed = () => finish(new Error('The original Supervisor observation connection closed before connecting.'));
      socket.once('connect', connected); socket.once('error', errored); socket.once('close', closed);
    });
    const hello = await request('hello');
    assert.ok(Number.isInteger(hello?.pid) && hello.pid > 0, 'Expected the original Supervisor process identity.');
    assert.strictEqual(hello.runtimeBackend, execution.runtimeBackend);
    assert.deepStrictEqual(hello.runtimeOwner, execution.runtimeOwner, 'Supervisor owner must match the original runtime binding.');
    assert.strictEqual(await observer.exists(), true, 'The original Runtime session must be observed before stopping.');
    return observer;
  } catch (error) { observer.close(); throw error; }
}

async function stopRuntimeExecutionsAfterRetirement({ executions, stop, getSnapshot, getRuntimeSupervisorState,
  timeoutMs = 15000, now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  openObserver = openRuntimeRetirementObserver }) {
  const deadline = now() + timeoutMs;
  const observers = [];
  const assertBudget = () => assert.ok(now() < deadline, 'Timed out waiting for original Runtime storage retirement.');
  try {
    const state = await getRuntimeSupervisorState();
    for (const execution of executions) {
      assertBudget();
      observers.push(await openObserver(execution, state, deadline, now));
    }
    for (const execution of executions) { assertBudget(); await stop(execution); }
    while (true) {
      assertBudget();
      const snapshot = await getSnapshot();
      let nodesStopped = true;
      for (const execution of executions) {
        const node = snapshot.state.nodes.find(node => node.id === execution.nodeId && node.kind === execution.kind);
        assert.ok(node, 'Retirement must not replace an original execution node.');
        const metadata = node.metadata?.[execution.kind];
        assert.ok(!metadata?.runtimeSessionId || metadata.runtimeSessionId === execution.sessionId,
          'Retirement must not authorize a replacement Runtime binding.');
        if (metadata?.runtimeSessionId) {
          assert.strictEqual(metadata.runtimeStoragePath, execution.runtimeStoragePath);
          assert.strictEqual(metadata.runtimeBackend, execution.runtimeBackend);
          assert.deepStrictEqual(metadata.runtimeOwner, execution.runtimeOwner);
        }
        nodesStopped &&= metadata?.liveSession === false;
      }
      const retained = [];
      for (const observer of observers) { assertBudget(); retained.push(await observer.exists()); }
      assertBudget();
      if (nodesStopped && retained.every(exists => !exists)) return snapshot;
      await sleep(Math.min(100, deadline - now()));
    }
  } finally { for (const observer of observers) observer.close(); }
}

module.exports = { captureRuntimeExecution, openRuntimeRetirementObserver, stopRuntimeExecutionsAfterRetirement };
