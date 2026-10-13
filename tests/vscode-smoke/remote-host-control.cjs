const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const { createHash, randomUUID } = require('node:crypto');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function readProcessIdentity(pid) {
  assert.ok(Number.isSafeInteger(pid) && pid > 0, 'Invalid process PID');
  try {
    const stat = await fs.readFile(`/proc/${pid}/stat`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/);
    assert.ok(fields.length >= 20 && /^\d+$/.test(fields[19]), 'Invalid Linux process identity');
    return { pid, startTicks: fields[19], state: fields[0], ppid: Number(fields[1]) };
  } catch (error) {
    if (['ENOENT', 'ESRCH'].includes(error.code)) return undefined;
    throw error;
  }
}

function sameIdentity(expected, actual) {
  return Boolean(actual && actual.pid === expected.pid && actual.startTicks === expected.startTicks);
}

async function assertProcessLive(expected, read = readProcessIdentity) {
  const actual = await read(expected.pid);
  assert.ok(sameIdentity(expected, actual) && !['Z', 'X'].includes(actual.state),
    `Original process is no longer live: ${JSON.stringify({ expected, actual })}`);
  return actual;
}

async function assertHostCondition(expected, scenario, read = readProcessIdentity) {
  assert.ok(['exit', 'retain'].includes(scenario), 'Explicit Host scenario required');
  if (scenario === 'retain') return assertProcessLive(expected, read);
  const actual = await read(expected.pid);
  assert.ok(!sameIdentity(expected, actual), `Original Host still exists: ${JSON.stringify(actual)}`);
  return { pid: expected.pid, startTicks: expected.startTicks, state: 'original-absent' };
}

async function waitForOriginalProcessExit(expected, {
  timeoutMs = 10000, read = readProcessIdentity, now = Date.now, pause = sleep
} = {}) {
  const deadline = now() + timeoutMs;
  do {
    const actual = await read(expected.pid);
    if (!sameIdentity(expected, actual)) return;
    if (now() >= deadline) throw new Error(`Original process exit is unconfirmed: ${JSON.stringify(actual)}`);
    await pause(Math.min(100, deadline - now()));
  } while (true);
}

async function readProcessScope(pid) {
  return {
    uid: (await fs.stat(`/proc/${pid}`)).uid,
    args: (await fs.readFile(`/proc/${pid}/cmdline`, 'utf8')).split('\0').filter(Boolean)
  };
}

async function terminatePrivateHost(expected, serverRoot, {
  uid = process.getuid(), read = readProcessIdentity, readScope = readProcessScope,
  signal = (pid, name) => process.kill(pid, name), wait = waitForOriginalProcessExit
} = {}) {
  await assertProcessLive(expected, read);
  const scope = await readScope(expected.pid);
  const root = path.resolve(serverRoot);
  assert.equal(scope.uid, uid, 'Old Host UID differs from fixture owner');
  assert.ok(scope.args.some(arg => arg.startsWith(`${root}${path.sep}`)), 'Old Host is outside private server root');
  assert.ok(scope.args.includes('--type=extensionHost'), 'Old process is not an Extension Host');
  // Recheck after scope reads; stale scope must not authorize a reused PID.
  await assertProcessLive(expected, read);
  signal(expected.pid, 'SIGKILL');
  await wait(expected, { read });
  return { ...expected, signal: 'SIGKILL' };
}

async function abortLocalClient(handle, userDataDir, report, root) {
  assert.equal(root?.pid, handle.child.pid, 'Local spawn identity is missing');
  assert.ok(root, 'Original local VS Code process is missing');
  await assertProcessLive(root);
  const scope = await readProcessScope(root.pid);
  assert.equal(scope.uid, process.getuid(), 'Local client UID differs from fixture owner');
  // Electron rewrites its process title/argv after startup. Validate our actual spawn
  // arguments and executable, using the identity captured before waiting for setup.
  assert.ok(handle.child.spawnargs.includes(`--user-data-dir=${userDataDir}`), 'Local spawn is outside private user-data root');
  assert.equal(await fs.realpath(`/proc/${root.pid}/exe`), await fs.realpath(handle.child.spawnfile),
    'Local client executable differs from this spawn');
  const processes = [root];
  const all = [];
  for (const name of await fs.readdir('/proc')) {
    if (!/^\d+$/.test(name)) continue;
    const identity = await readProcessIdentity(Number(name));
    if (identity) all.push(identity);
  }
  const descendants = new Set([root.pid]);
  for (let changed = true; changed;) {
    changed = false;
    for (const candidate of all) {
      if (!descendants.has(candidate.pid) && descendants.has(candidate.ppid)) {
        try {
          assert.equal((await readProcessScope(candidate.pid)).uid, process.getuid(), 'Local child UID differs');
        } catch (error) { if (['ENOENT', 'ESRCH'].includes(error.code)) continue; throw error; }
        descendants.add(candidate.pid); processes.push(candidate); changed = true;
      }
    }
  }
  // Kill Electron first so its normal shutdown cannot send remote Terminate.
  await assertProcessLive(root);
  process.kill(root.pid, 'SIGKILL');
  report.localSignals.push({ ...root, signal: 'SIGKILL' });
  for (const expected of processes.slice(1).reverse()) {
    const actual = await readProcessIdentity(expected.pid);
    if (!sameIdentity(expected, actual) || ['Z', 'X'].includes(actual.state)) continue;
    process.kill(expected.pid, 'SIGKILL');
    report.localSignals.push({ ...expected, signal: 'SIGKILL' });
  }
  let exitTimer;
  const result = await Promise.race([
    handle.completed.then(() => ({ passed: true }), error => ({ error })),
    new Promise((_, reject) => { exitTimer = setTimeout(() => reject(new Error('Local client exit is unconfirmed')), 10000); })
  ]).finally(() => clearTimeout(exitTimer));
  assert.equal(handle.child.signalCode, 'SIGKILL', `Unexpected setup client exit: ${result.error?.message}`);
  // The child is reaped by spawn; children reparented to init may transiently be zombies.
  await waitForOriginalProcessExit(root);
  const deadline = Date.now() + 10000;
  do {
    const stillRunning = [];
    for (const expected of processes.slice(1)) {
      const actual = await readProcessIdentity(expected.pid);
      if (sameIdentity(expected, actual) && !['Z', 'X'].includes(actual.state)) stillRunning.push(actual);
    }
    if (!stillRunning.length) break;
    if (Date.now() >= deadline) throw new Error(`Local client descendants still running: ${JSON.stringify(stillRunning)}`);
    await sleep(100);
  } while (true);
  return root;
}

function runtimePaths(storageDir) {
  const resolved = path.resolve(storageDir, 'runtime-supervisor');
  const digest = createHash('sha1').update(resolved).digest('hex').slice(0, 24);
  return { socketPath: path.join('/tmp', `dsc-root-${process.getuid()}`, `d-${digest}.sock`),
    registryPath: path.join(resolved, 'registry.json') };
}

async function requestSession(storageDir, sessionId, timeoutMs = 5000) {
  const socket = net.createConnection(runtimePaths(storageDir).socketPath);
  const id = randomUUID();
  return new Promise((resolve, reject) => {
    let buffer = '', done = false;
    const finish = (error, value) => {
      if (done) return;
      done = true; clearTimeout(timer); socket.destroy(); error ? reject(error) : resolve(value);
    };
    const timer = setTimeout(() => finish(new Error('Supervisor attachSession timeout')), timeoutMs);
    socket.on('error', error => finish(error));
    socket.on('connect', () => socket.write(JSON.stringify({ type: 'request', id, method: 'attachSession',
      params: { sessionId } }) + '\n'));
    socket.on('data', chunk => {
      buffer += chunk.toString();
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0 && !done) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        try {
          const message = JSON.parse(line);
          if (message.type === 'response' && message.id === id) {
            finish(message.ok ? undefined : new Error(message.error?.message || 'Supervisor rejected attachSession'), message.result);
          }
        } catch (error) { finish(error); }
      }
    });
    socket.on('close', () => finish(new Error('Supervisor closed before attachSession response')));
  });
}

function offlineSessionsComplete(sessions, expected) {
  const agent = sessions.find(s => s.sessionId === expected.agentSessionId);
  const terminal = sessions.find(s => s.sessionId === expected.terminalSessionId);
  const completed = sessions.find(s => s.sessionId === expected.completedTerminalSessionId);
  return Boolean(agent?.live && terminal?.live && agent.output?.includes('[fake-agent] REAL_REOPEN_AGENT') &&
    /[\r\n]REAL_REOPEN_TERMINAL(?:\r?\n|$)/.test(terminal.output ?? '') && (!completed || completed.live === false));
}

async function releaseAndWaitForCompletion(expected, signalPath, timeoutMs = 30000) {
  await fs.writeFile(signalPath, 'complete\n', { flag: 'wx', mode: 0o600 });
  const deadline = Date.now() + timeoutMs;
  let sessions;
  do {
    sessions = JSON.parse(await fs.readFile(runtimePaths(expected.agentRuntimeStoragePath).registryPath, 'utf8')).sessions;
    if (offlineSessionsComplete(sessions, expected)) return sessions.map(s => ({ sessionId: s.sessionId,
      kind: s.kind, live: s.live, cols: s.cols, rows: s.rows }));
    if (Date.now() >= deadline) throw new Error('Offline output or independent terminal completion is unconfirmed');
    await sleep(100);
  } while (true);
}

const shellQuote = value => "'" + String(value).replaceAll("'", "'\\''") + "'";
module.exports = { readProcessIdentity, assertProcessLive, assertHostCondition, waitForOriginalProcessExit,
  terminatePrivateHost, abortLocalClient, runtimePaths, requestSession, offlineSessionsComplete,
  releaseAndWaitForCompletion, shellQuote };
