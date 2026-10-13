import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
const control = createRequire(import.meta.url)('../../tests/vscode-smoke/remote-host-control.cjs');

const expected = { pid: 12345, startTicks: '100', state: 'S' };
const tests = [];
const test = (name, run) => tests.push({ name, run });
const live = async () => ({ ...expected });

for (const [field, scope] of [
  ['UID', { uid: 2000, args: ['/private/server/node', '--type=extensionHost'] }],
  ['root', { uid: 1000, args: ['/another/server/node', '--type=extensionHost'] }],
  ['role', { uid: 1000, args: ['/private/server/node', '--type=ptyHost'] }],
  ['root prefix', { uid: 1000, args: ['/private/server-other/node', '--type=extensionHost'] }]
]) {
  test(`wrong ${field} never authorizes a Host signal`, async () => {
    let signals = 0;
    await assert.rejects(control.terminatePrivateHost(expected, '/private/server', {
      uid: 1000, read: live, readScope: async () => scope, signal: () => signals++
    }));
    assert.equal(signals, 0);
  });
}
test('PID reused during scope reads cannot authorize a signal', async () => {
  let reads = 0, signals = 0;
  await assert.rejects(control.terminatePrivateHost(expected, '/private/server', {
    uid: 1000, read: async () => ({ ...expected, startTicks: ++reads === 1 ? '100' : '101' }),
    readScope: async () => ({ uid: 1000, args: ['/private/server/node', '--type=extensionHost'] }),
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
  await control.terminatePrivateHost(expected, '/private/server', {
    uid: 1000, read: async () => actual,
    readScope: async () => ({ uid: 1000, args: ['/private/server/node', '--type=extensionHost'] }),
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

for (const { name, run } of tests) { await run(); console.log(`PASS ${name}`); }
console.log(`Remote Host control tests passed (${tests.length}).`);
