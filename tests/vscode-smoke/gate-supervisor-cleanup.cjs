const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const { execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { runtimeIsRetired } = require('./gate-runtime-state.cjs');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function identity(pid) {
  assert(Number.isSafeInteger(pid) && pid > 0, 'Invalid original Supervisor PID');
  if (process.platform === 'linux') {
    try {
      const stat = await fs.readFile(`/proc/${pid}/stat`, 'utf8');
      const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      return { pid, start: fields[19], state: fields[0] };
    } catch (error) { if (['ENOENT', 'ESRCH'].includes(error.code)) return null; throw error; }
  }
  if (process.platform === 'darwin') {
    try {
      const start = execFileSync('ps', ['-p', String(pid), '-o', 'lstart='], { encoding: 'utf8', timeout: 5000 }).trim();
      return start ? { pid, start } : null;
    } catch (error) { if (error.status === 1) return null; throw error; }
  }
  const start = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    `$p=Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}"; if($p){$p.CreationDate.ToUniversalTime().ToString("o")}`],
  { encoding: 'utf8', timeout: 5000 }).trim();
  return start ? { pid, start } : null;
}

async function hello(socketPath, deadline) {
  assert(deadline > Date.now(), 'Original Supervisor observation deadline expired');
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath), id = randomUUID();
    let buffer = '', settled = false;
    const timer = setTimeout(() => finish(new Error('Private Supervisor identity query timed out')),
      Math.max(1, Math.min(5000, deadline - Date.now())));
    const finish = (error, value) => {
      if (settled) return;
      settled = true; clearTimeout(timer); socket.destroy();
      error ? reject(error) : resolve(value);
    };
    socket.once('error', finish);
    socket.once('connect', () => socket.write(JSON.stringify({ type: 'request', id, method: 'hello' }) + '\n'));
    socket.on('data', data => {
      buffer += data;
      if (buffer.length > 65536) { finish(new Error('Supervisor identity response exceeds its bound')); return; }
      const end = buffer.indexOf('\n'); if (end < 0) return;
      try {
        const response = JSON.parse(buffer.slice(0, end));
        assert.equal(response.id, id); assert.equal(response.type, 'response'); assert.equal(response.ok, true);
        assert(Number.isSafeInteger(response.result?.pid) && response.result.pid > 0);
        finish(null, response.result);
      } catch (error) { finish(error); }
    });
    socket.once('close', () => finish(new Error('Supervisor closed without a complete identity response')));
  });
}

async function processCommand(pid) {
  if (process.platform === 'linux') return (await fs.readFile(`/proc/${pid}/cmdline`, 'utf8')).split('\0').filter(Boolean);
  if (process.platform === 'darwin') return execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8', timeout: 5000 }).trim();
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    `(Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}").CommandLine`], { encoding: 'utf8', timeout: 5000 }).trim();
}

function storageArgument(command) {
  if (Array.isArray(command)) {
    const indexes = command.flatMap((arg, index) => arg === '--storage-dir' ? [index] : []);
    assert.equal(indexes.length, 1, 'Supervisor has no unique storage argument');
    assert(command[indexes[0] + 1]); return command[indexes[0] + 1];
  }
  const matches = [...command.matchAll(/(?:^|\s)--storage-dir(?:=|\s+)(?:"([^"]+)"|'([^']+)'|([^\s]+))/gu)];
  assert.equal(matches.length, 1, 'Supervisor has no unique storage argument');
  return matches[0][1] ?? matches[0][2] ?? matches[0][3];
}

async function capturePrivateSupervisors(state, privateStorageRoot, deadline) {
  assert(state && Array.isArray(state.observedRootSupervisorProcesses), 'Observed Supervisor process scope is missing');
  const privateRoots = Array.isArray(privateStorageRoot) ? privateStorageRoot : [privateStorageRoot];
  assert(privateRoots.length && privateRoots.every(root => typeof root === 'string' && root !== path.parse(root).root),
    'Explicit private storage roots are required');
  const canonicalRoots = await Promise.all(privateRoots.map(root => fs.realpath(root)));
  const canonicalStorage = canonicalRoots[0], captured = new Map(), absent = [];
  const add = async (pid, entry, greeting) => {
    const expected = await identity(pid);
    if (!expected) { absent.push({ pid, observed: 'absent-before-cleanup' }); return; }
    const command = await processCommand(pid);
    assert((Array.isArray(command) ? command.join(' ') : command).includes('runtime-supervisor'),
      'Observed process is not a Runtime Supervisor');
    const storage = await fs.realpath(storageArgument(command));
    assert(canonicalRoots.some(root => storage === root || storage.startsWith(root + path.sep)),
      'Supervisor lies outside this private fixture storage');
    if (entry) {
      assert.equal(storage, await fs.realpath(path.join(entry.runtimeStoragePath, 'runtime-supervisor')),
        'Supervisor command does not match the original registry storage');
      if (greeting.runtimeBackend) assert.equal(greeting.runtimeBackend, entry.backend);
    }
    assert.equal((await identity(pid))?.start, expected.start, 'Supervisor identity changed during ownership check');
    const previous = captured.get(pid);
    if (previous) assert.equal(previous.expected.start, expected.start);
    captured.set(pid, { expected, storage, socketPath: entry?.socketPath ?? previous?.socketPath ?? null,
      runtimeStoragePath: entry?.runtimeStoragePath ?? previous?.runtimeStoragePath ?? null });
  };
  for (const [backend, registry] of Object.entries(state.registries)) {
    for (const entry of registry.entries ?? [registry]) {
      assert(!entry.error, `Cannot capture an unreadable original registry: ${entry.error}`);
      if (!entry.socketPath) continue;
      let greeting;
      try { greeting = await hello(entry.socketPath, deadline); }
      catch (error) { if (['ENOENT', 'ECONNREFUSED'].includes(error.code)) continue; throw error; }
      await add(greeting.pid, { ...entry, backend }, greeting);
    }
  }
  // Reset/root removal can remove registry paths while an old Supervisor is
  // still alive. Its observed PID is a separate scope, never inferred absent
  // just because today's registry list is empty.
  for (const entry of state.observedRootSupervisorProcesses) if (!captured.has(entry.pid)) await add(entry.pid);
  return { canonicalStorage, canonicalRoots, processes: [...captured.values()], absent };
}

async function retirePrivateSupervisors(state, scope, deadline) {
  assert(runtimeIsRetired(state), 'Cannot terminate a Supervisor with pending product sessions/work');
  assert(scope?.processes && scope.canonicalStorage, 'Original Supervisor scope was not captured before reset');
  const owned = [...scope.absent];
  for (const original of scope.processes) {
    assert(Date.now() < deadline, 'Original Supervisor cleanup deadline expired');
    const current = await identity(original.expected.pid);
    if (!current || current.start !== original.expected.start) {
      owned.push({ ...original, observed: 'original-absent', signal: null }); continue;
    }
    const storage = await fs.realpath(storageArgument(await processCommand(current.pid)));
    assert.equal(storage, original.storage, 'Original Supervisor ownership changed before retirement');
    process.kill(current.pid, 'SIGTERM');
    while (Date.now() < deadline) {
      const next = await identity(current.pid);
      if (!next || next.start !== original.expected.start) break;
      await sleep(Math.min(50, Math.max(0, deadline - Date.now())));
    }
    const after = await identity(current.pid);
    assert(!after || after.start !== original.expected.start, 'Private Supervisor exit is unconfirmed');
    owned.push({ ...original, observed: 'original-absent', signal: 'SIGTERM' });
  }
  return owned;
}

module.exports = { capturePrivateSupervisors, retirePrivateSupervisors, hello, storageArgument, identity };
