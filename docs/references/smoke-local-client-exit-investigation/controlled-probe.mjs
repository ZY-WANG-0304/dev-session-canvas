import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// Diagnostic only: execute the unchanged helper with isolated /proc and signal dependencies.
const directory = path.dirname(fileURLToPath(import.meta.url));
const helperPath = path.resolve(directory, '../../../tests/vscode-smoke/remote-host-control.cjs');
const source = await fs.readFile(helperPath, 'utf8');
const require = createRequire(helperPath);
const root = { pid: 41001, ppid: 1, startTicks: '100', state: 'S' };
const child = { pid: 41002, ppid: root.pid, startTicks: '200', state: 'S' };
const userDataDir = '/private/controlled-client';
const errorWithCode = code => Object.assign(new Error(`kill ${code}`), { code, syscall: 'kill' });
const statLine = value => `${value.pid} (controlled client) ${[
  value.state, value.ppid, ...Array(17).fill('0'), value.startTicks
].join(' ')}`;

async function probe(scenario) {
  const identities = new Map([[root.pid, { ...root }], [child.pid, { ...child }]]);
  const events = [];
  const handle = { child: { pid: root.pid, spawnfile: '/private/node',
    spawnargs: ['/private/node', `--user-data-dir=${userDataDir}`], signalCode: null } };
  let completedReject, rootKilled = false, clock = 0;
  handle.completed = new Promise((resolve, reject) => { completedReject = reject; });
  handle.completed.catch(() => {});
  const fakeFs = {
    readdir: async location => { assert.equal(location, '/proc'); return [...identities.keys()].map(String); },
    stat: async location => { assert.ok(identities.has(Number(location.split('/')[2]))); return { uid: 1000 }; },
    realpath: async location => location.startsWith('/proc/') ? '/private/node' : location,
    readFile: async location => {
      const pid = Number(location.split('/')[2]);
      const identity = identities.get(pid);
      if (!identity) throw Object.assign(new Error('missing proc entry'), { code: 'ENOENT' });
      if (location.endsWith('/cmdline')) return '/private/node\0';
      assert.ok(location.endsWith('/stat'));
      const snapshot = statLine(identity);
      events.push({ event: 'read', pid, startTicks: identity.startTicks, state: identity.state, rootKilled });
      if (pid === child.pid && rootKilled && scenario === 'gone-after-read') {
        identities.delete(pid);
        events.push({ event: 'reaped-between-read-and-signal', pid });
      }
      return snapshot;
    }
  };
  const fakeProcess = {
    getuid: () => 1000,
    kill: (pid, signal) => {
      assert.equal(signal, 'SIGKILL');
      events.push({ event: 'signal-attempt', pid, signal });
      if (pid === root.pid && scenario === 'root-esrch') throw errorWithCode('ESRCH');
      if (!identities.has(pid)) throw errorWithCode('ESRCH');
      if (pid === child.pid && scenario === 'permission-denied') throw errorWithCode('EPERM');
      if (pid === root.pid) {
        identities.delete(pid); rootKilled = true; handle.child.signalCode = 'SIGKILL';
        completedReject(new Error('SIGKILL'));
        if (scenario === 'gone-before-read') identities.delete(child.pid);
        if (scenario === 'zombie') identities.get(child.pid).state = 'Z';
        if (scenario === 'dead') identities.get(child.pid).state = 'X';
        if (scenario === 'pid-reused') identities.get(child.pid).startTicks = '201';
      } else if (scenario !== 'still-running') identities.delete(pid);
    }
  };
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports, process: fakeProcess,
    require: name => name === 'node:fs/promises' ? fakeFs : require(name),
    setTimeout, clearTimeout, Date: { now: () => { clock += 10000; return clock; } }
  }, { filename: helperPath });
  const report = { localSignals: [] };
  let error;
  try { await module.exports.abortLocalClient(handle, userDataDir, report, root); }
  catch (caught) { error = caught; }
  const leafAttempts = events.filter(event => event.event === 'signal-attempt' && event.pid === child.pid);
  if (scenario === 'gone-after-read') {
    assert.equal(error?.code, 'ESRCH');
    assert.match(error.stack, /remote-host-control\.cjs:114:/);
    assert.equal(leafAttempts.length, 1);
    assert.equal(report.localSignals.length, 1);
    assert.equal(identities.size, 0);
  } else if (scenario === 'permission-denied') {
    assert.equal(error?.code, 'EPERM'); assert.equal(leafAttempts.length, 1);
  } else if (scenario === 'root-esrch') {
    assert.equal(error?.code, 'ESRCH'); assert.equal(leafAttempts.length, 0);
    assert.equal(report.localSignals.length, 0);
  } else if (scenario === 'still-running') {
    assert.match(error?.message ?? '', /Local client descendants still running/);
    assert.equal(leafAttempts.length, 1);
  } else {
    assert.equal(error, undefined);
    assert.equal(leafAttempts.length, scenario === 'normal' ? 1 : 0);
  }
  return { scenario, outcome: error?.code ?? (error ? 'postcondition-failure' : 'completed'),
    error: error?.stack, localSignals: report.localSignals, events };
}

const scenarios = ['normal', 'gone-before-read', 'zombie', 'dead', 'pid-reused',
  'gone-after-read', 'permission-denied', 'root-esrch', 'still-running'];
const results = [];
for (const scenario of scenarios) {
  results.push(await probe(scenario));
  console.log(`PASS diagnostic ${scenario}: ${results.at(-1).outcome}`);
}
for (let repeat = 0; repeat < 100; repeat++) await probe('gone-after-read');
const receipt = { purpose: 'root-cause reproduction; production helper unchanged',
  helperPath, helperSha256: createHash('sha256').update(source).digest('hex'),
  createdAt: new Date().toISOString(), results, raceRepetitions: 100 };
await fs.writeFile(path.join(directory, 'controlled-result.json'), `${JSON.stringify(receipt, null, 2)}\n`);
console.log('PASS diagnostic read/signal race repeated 100/100; this reproduces the defect, not a fix.');
