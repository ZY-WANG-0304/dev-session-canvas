import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import net from 'node:net';
import fs from 'node:fs/promises';
import os from 'node:os';
import vm from 'node:vm';
const serverRoot = path.resolve('private-fixture-server');
const serverNode = path.join(serverRoot, 'node');
const control = createRequire(import.meta.url)('../../tests/vscode-smoke/remote-host-control.cjs');
const helperPath = path.resolve('tests/vscode-smoke/remote-host-control.cjs');
const helperSource = await fs.readFile(helperPath, 'utf8');
const helperRequire = createRequire(helperPath);

const expected = { pid: 12345, startTicks: '100', state: 'S' };
const tests = [];
const test = (name, run) => tests.push({ name, run });
const live = async () => ({ ...expected });

for (const [field, scope] of [
  ['UID', { uid: 2000, args: [serverNode, '--type=extensionHost'] }],
  ['root', { uid: 1000, args: [path.join(path.resolve('another-server'), 'node'), '--type=extensionHost'] }],
  ['role', { uid: 1000, args: [serverNode, '--type=ptyHost'] }],
  ['root prefix', { uid: 1000, args: [path.join(`${serverRoot}-other`, 'node'), '--type=extensionHost'] }]
]) {
  test(`wrong ${field} never authorizes a Host signal`, async () => {
    let signals = 0;
    await assert.rejects(control.terminatePrivateHost(expected, serverRoot, {
      uid: 1000, read: live, readScope: async () => scope, signal: () => signals++
    }));
    assert.equal(signals, 0);
  });
}
test('PID reused during scope reads cannot authorize a signal', async () => {
  let reads = 0, signals = 0;
  await assert.rejects(control.terminatePrivateHost(expected, serverRoot, {
    uid: 1000, read: async () => ({ ...expected, startTicks: ++reads === 1 ? '100' : '101' }),
    readScope: async () => ({ uid: 1000, args: [serverNode, '--type=extensionHost'] }),
    signal: () => signals++
  }), /no longer live/);
  assert.equal(signals, 0);
});
for (const state of ['Z', 'X']) {
  test(`${state} process is not a retained live Host`, async () => {
    await assert.rejects(control.assertHostCondition(expected, 'retain', async () => ({ ...expected, state })), /no longer live/);
    await assert.rejects(control.assertHostCondition(expected, 'exit', async () => ({ ...expected, state })), /still exists/);
  });
}
test('original live Host rejects exited condition', async () => {
  await assert.rejects(control.assertHostCondition(expected, 'exit', live), /still exists/);
});
test('replacement PID accepts original exit but rejects retention', async () => {
  const read = async () => ({ ...expected, startTicks: '101' });
  assert.equal((await control.assertHostCondition(expected, 'exit', read)).state, 'original-absent');
  await assert.rejects(control.assertHostCondition(expected, 'retain', read));
});
test('unconfirmed exit fails within its original budget', async () => {
  let clock = 0;
  await assert.rejects(control.waitForOriginalProcessExit(expected, {
    timeoutMs: 150, read: live, now: () => clock, pause: async ms => { clock += ms; }
  }), /unconfirmed/);
  assert.equal(clock, 150);
});
test('Host control confirms disappearance after exactly one scoped signal', async () => {
  let actual = { ...expected }, signals = 0;
  await control.terminatePrivateHost(expected, serverRoot, {
    uid: 1000, read: async () => actual,
    readScope: async () => ({ uid: 1000, args: [serverNode, '--type=extensionHost'] }),
    signal: (pid, name) => { assert.equal(pid, expected.pid); assert.equal(name, 'SIGKILL'); actual = undefined; signals++; }
  });
  assert.equal(signals, 1);
});
const sessionExpected = { agentSessionId: 'agent', terminalSessionId: 'terminal', completedTerminalSessionId: 'completed' };
const goodSessions = () => [
  { sessionId: 'agent', live: true, output: '[fake-agent] REAL_REOPEN_AGENT' },
  { sessionId: 'terminal', live: true, output: '\r\nREAL_REOPEN_TERMINAL\r\n' },
  { sessionId: 'completed', live: false }
];
test('setup marker substring is not independent offline output', () => {
  const sessions = goodSessions(); sessions[1].output = '\r\nREAL_REOPEN_TERMINAL_SLEEPING\r\n';
  assert.equal(control.offlineSessionsComplete(sessions, sessionExpected), false);
});
test('still live completed terminal cannot satisfy offline completion', () => {
  const sessions = goodSessions(); sessions[2].live = true;
  assert.equal(control.offlineSessionsComplete(sessions, sessionExpected), false);
});
test('original live sessions and independent completion satisfy offline conditions', () => {
  assert.equal(control.offlineSessionsComplete(goodSessions(), sessionExpected), true);
});
if (process.platform === 'linux') test('owned real child identity is retained then absent after actual exit', async () => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  const exited = once(child, 'exit');
  try {
    const identity = await control.readProcessIdentity(child.pid);
    assert.ok(identity);
    await control.assertHostCondition(identity, 'retain');
    await assert.rejects(control.assertHostCondition(identity, 'exit'));
    child.kill('SIGKILL'); await exited;
    await control.waitForOriginalProcessExit(identity);
    await control.assertHostCondition(identity, 'exit');
    await assert.rejects(control.assertHostCondition(identity, 'retain'));
  } finally { if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exited; } }
});

if (process.platform === 'linux') test('local client with rewritten argv is killed only through its verified spawn identity', async () => {
  const child = spawn(process.execPath, ['-e', "process.title = 'rewritten-client'; setInterval(() => {}, 1000)", '--', '--user-data-dir=/private/client'], { stdio: 'ignore' });
  const completed = new Promise((resolve, reject) => child.on('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(signal))));
  completed.catch(() => {});
  const identity = await control.readProcessIdentity(child.pid);
  try {
    await new Promise(resolve => setTimeout(resolve, 100));
    const report = { localSignals: [] };
    await control.abortLocalClient({ child, completed }, '/private/client', report, identity);
    assert.equal(report.localSignals[0].pid, child.pid);
    assert.equal(child.signalCode, 'SIGKILL');
  } finally { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); await completed.catch(() => {}); }
});

// Execute the actual helper in an isolated Linux process table. No simulated PID is signalled on the OS.
async function localClientProbe(scenario) {
  const root = { pid: 41001, ppid: 1, startTicks: '100', state: 'S' };
  const leaf = { pid: 41002, ppid: root.pid, startTicks: '200', state: 'S' };
  const sibling = { pid: 41003, ppid: root.pid, startTicks: '300', state: 'S' };
  const table = new Map([[root.pid, { ...root }], [leaf.pid, { ...leaf }]]);
  if (scenario === 'esrch-with-running-sibling') table.set(sibling.pid, { ...sibling });
  const userData = '/private/local-control-test';
  const events = [], report = { localSignals: [] };
  let rootSignalled = false, clock = 0, rejectCompleted;
  const handle = { child: { pid: root.pid, spawnfile: '/private/node',
    spawnargs: ['/private/node', `--user-data-dir=${userData}`], signalCode: null },
    completed: new Promise((resolve, reject) => { rejectCompleted = reject; }) };
  handle.completed.catch(() => {});
  if (scenario === 'wrong-user-data') handle.child.spawnargs = ['/private/node'];
  const codedError = code => Object.assign(new Error(`kill ${code}`), { code });
  const fakeFs = {
    readdir: async () => [...table.keys()].map(String),
    stat: async location => ({ uid: (scenario === 'wrong-root-uid' && location === `/proc/${root.pid}`)
      || (scenario === 'wrong-leaf-uid' && location === `/proc/${leaf.pid}`) ? 2000 : 1000 }),
    realpath: async location => scenario === 'wrong-executable' && location.startsWith('/proc/')
      ? '/another/node' : '/private/node',
    readFile: async location => {
      const pid = Number(location.split('/')[2]);
      const actual = table.get(pid);
      if (!actual) throw Object.assign(new Error('missing proc'), { code: 'ENOENT' });
      if (location.endsWith('/cmdline')) {
        if (scenario === 'root-reused') table.get(root.pid).startTicks = '101';
        return '/private/node\0';
      }
      const snapshot = `${pid} (local control test) ${[
        actual.state, actual.ppid, ...Array(17).fill('0'), actual.startTicks
      ].join(' ')}`;
      if (pid === leaf.pid && rootSignalled && scenario === 'gone-after-read') {
        table.delete(pid); events.push({ kind: 'reaped-after-live-read', pid });
      }
      events.push({ kind: 'read', pid, startTicks: actual.startTicks, state: actual.state, rootSignalled });
      return snapshot;
    }
  };
  const fakeProcess = { getuid: () => 1000, kill: (pid, signal) => {
    assert.equal(signal, 'SIGKILL');
    events.push({ kind: 'signal', pid });
    if (pid === root.pid && scenario.startsWith('root-error-')) throw codedError(scenario.slice(11));
    if (!table.has(pid)) throw codedError('ESRCH');
    if (pid === root.pid) {
      table.delete(pid); rootSignalled = true; handle.child.signalCode = 'SIGKILL';
      rejectCompleted(new Error('SIGKILL'));
      if (scenario === 'gone-before-read') table.delete(leaf.pid);
      if (scenario === 'zombie-before-read') table.get(leaf.pid).state = 'Z';
      if (scenario === 'dead-before-read') table.get(leaf.pid).state = 'X';
      if (scenario === 'reused-before-read') table.get(leaf.pid).startTicks = '201';
      return;
    }
    if (scenario === 'permission-denied') throw codedError('EPERM');
    if (pid === leaf.pid && ['esrch-gone', 'esrch-zombie', 'esrch-dead', 'esrch-reused',
      'esrch-live', 'esrch-with-running-sibling'].includes(scenario)) {
      if (['esrch-gone', 'esrch-with-running-sibling'].includes(scenario)) table.delete(pid);
      if (scenario === 'esrch-zombie') table.get(pid).state = 'Z';
      if (scenario === 'esrch-dead') table.get(pid).state = 'X';
      if (scenario === 'esrch-reused') table.get(pid).startTicks = '201';
      throw codedError('ESRCH');
    }
    if (scenario !== 'still-running' && scenario !== 'esrch-with-running-sibling') table.delete(pid);
  } };
  const module = { exports: {} };
  vm.runInNewContext(helperSource, { module, exports: module.exports,
    require: name => name === 'node:fs/promises' ? fakeFs : helperRequire(name),
    process: fakeProcess, setTimeout, clearTimeout, Date: { now: () => { clock += 10000; return clock; } }
  }, { filename: helperPath });
  let error;
  try { await module.exports.abortLocalClient(handle, userData, report, root); }
  catch (caught) { error = caught; }
  return { error, report, events, root, leaf, table };
}

for (const scenario of ['normal', 'gone-before-read', 'zombie-before-read', 'dead-before-read',
  'reused-before-read', 'gone-after-read', 'esrch-gone', 'esrch-zombie', 'esrch-dead', 'esrch-reused']) {
  test(`local descendant ${scenario} completes with verified root exit`, async () => {
    const result = await localClientProbe(scenario);
    assert.equal(result.error, undefined);
    assert.equal(result.report.localSignals[0].pid, result.root.pid);
    assert.equal(result.table.has(result.root.pid), false);
    const signalErrors = result.report.localSignalErrors ?? [];
    if (scenario === 'gone-after-read' || scenario.startsWith('esrch-')) {
      assert.equal(signalErrors.length, 1);
      assert.equal(signalErrors[0].pid, result.leaf.pid);
      assert.equal(signalErrors[0].startTicks, result.leaf.startTicks);
      assert.equal(signalErrors[0].code, 'ESRCH');
      assert.equal(result.report.localSignals.length, 1, 'ESRCH must not count as a successful signal');
      if (scenario === 'esrch-reused') assert.equal(signalErrors[0].actual.startTicks, '201');
    } else {
      assert.equal(signalErrors.length, 0);
      assert.equal(result.report.localSignals.length, scenario === 'normal' ? 2 : 1);
    }
  });
}
for (const [scenario, code] of [['permission-denied', 'EPERM'], ['esrch-live', 'ESRCH'],
  ['root-error-ESRCH', 'ESRCH'], ['root-error-EPERM', 'EPERM']]) {
  test(`local client ${scenario} remains an error`, async () => {
    const result = await localClientProbe(scenario);
    assert.equal(result.error?.code, code);
    if (scenario.startsWith('root-error-')) {
      assert.equal(result.report.localSignals.length, 0);
      assert.equal(result.events.filter(event => event.kind === 'signal').length, 1);
    } else {
      assert.equal(result.report.localSignalErrors[0].code, code);
      if (scenario === 'esrch-live') assert.equal(result.report.localSignalErrors[0].actual.startTicks, result.leaf.startTicks);
    }
  });
}
for (const scenario of ['wrong-root-uid', 'wrong-leaf-uid', 'wrong-user-data', 'wrong-executable', 'root-reused']) {
  test(`local client ${scenario} never authorizes a signal`, async () => {
    const result = await localClientProbe(scenario);
    assert.ok(result.error);
    assert.equal(result.events.filter(event => event.kind === 'signal').length, 0);
  });
}
for (const scenario of ['still-running', 'esrch-with-running-sibling']) {
  test(`local descendants ${scenario} still fail the final exit confirmation`, async () => {
    const result = await localClientProbe(scenario);
    assert.match(result.error?.message ?? '', /Local client descendants still running/);
  });
}

if (process.platform === 'linux') test('Supervisor request has a total deadline even when socket stays silent', async () => {
  const storage = await fs.mkdtemp(path.join(os.tmpdir(), 'dsc-host-request-'));
  const socketPath = path.join(storage, 'control.sock');
  const sockets = new Set();
  const server = net.createServer(socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve); });
    const started = Date.now();
    await assert.rejects(control.requestSession(storage, 'original', 80, { socketPath }), /timeout/);
    assert.ok(Date.now() - started < 2000, 'Request did not respect total deadline');
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve)); await fs.rm(storage, { recursive: true, force: true });
  }
});

if (process.platform === 'linux') test('Supervisor request uses the runtime socket by default and preserves attachSession RPC', async () => {
  const storage = await fs.mkdtemp(path.join(os.tmpdir(), 'dsc-host-rpc-'));
  const socketPath = path.join(storage, 'control.sock');
  const sockets = new Set();
  let request, requestedPath;
  const server = net.createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket));
    let buffer = '';
    socket.on('data', chunk => {
      buffer += chunk.toString();
      if (!buffer.includes('\n')) return;
      request = JSON.parse(buffer.slice(0, buffer.indexOf('\n')));
      socket.end(JSON.stringify({ type: 'response', id: request.id, ok: true, result: { sessionId: 'original' } }) + '\n');
    });
  });
  const createConnection = net.createConnection;
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve); });
    // Observe the default address without connecting to the real shared runtime directory.
    net.createConnection = address => { requestedPath = address; return createConnection(socketPath); };
    assert.deepEqual(await control.requestSession(storage, 'original', 2500), { sessionId: 'original' });
    assert.equal(requestedPath, control.runtimePaths(storage).socketPath);
    assert.equal(request.type, 'request');
    assert.equal(request.method, 'attachSession');
    assert.deepEqual(request.params, { sessionId: 'original' });
    assert.match(request.id, /^[0-9a-f-]{36}$/);
  } finally {
    net.createConnection = createConnection;
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve)); await fs.rm(storage, { recursive: true, force: true });
  }
});

for (const { name, run } of tests) { await run(); console.log(`PASS ${name}`); }
console.log(`Remote Host control tests passed (${tests.length}).`);
