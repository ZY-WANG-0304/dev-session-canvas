import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const [pythonScript, scenario] = process.argv.slice(2);
assert.ok(['normal', 'race'].includes(scenario));
const directory = path.dirname(fileURLToPath(import.meta.url));
const helperPath = path.resolve(directory, '../../../tests/vscode-smoke/remote-host-control.cjs');
const source = await fs.readFile(helperPath, 'utf8');
const require = createRequire(helperPath);
const realControl = require(helperPath);
const userDataDir = '/private/real-client-probe';
const child = spawn('/usr/bin/python3', [pythonScript, 'root', `--user-data-dir=${userDataDir}`],
  { stdio: ['ignore', 'pipe', 'pipe', 'pipe'] });
const exited = once(child, 'exit');
const completed = exited.then(([code, signal]) => {
  if (code !== 0) throw new Error(signal ?? `exit ${code}`);
});
completed.catch(() => {});
const readyLines = createInterface({ input: child.stdout });
const replies = createInterface({ input: process.stdin });
const events = [];
let root, leaf, rootSignaled = false, injected = false;
const emit = value => process.stdout.write(JSON.stringify(value) + '\n');
const report = { localSignals: [] };
try {
  const [ready] = await once(readyLines, 'line');
  leaf = await realControl.readProcessIdentity(JSON.parse(ready).leafPid);
  root = await realControl.readProcessIdentity(child.pid);
  assert.ok(root && leaf);
  assert.equal(leaf.ppid, root.pid);
  const observedFs = { ...fs, readFile: async (location, ...args) => {
    const snapshot = await fs.readFile(location, ...args);
    if (scenario === 'race' && rootSignaled && !injected && location === `/proc/${leaf.pid}/stat`) {
      injected = true;
      const fields = snapshot.slice(snapshot.lastIndexOf(')') + 2).trim().split(/\s+/);
      assert.equal(fields[19], leaf.startTicks);
      assert.ok(!['Z', 'X'].includes(fields[0]));
      events.push({ event: 'real-live-stat-read', pid: leaf.pid, startTicks: fields[19], state: fields[0] });
      await exited;
      const reaped = once(replies, 'line');
      child.stdio[3].write('x');
      emit({ request: 'reap', pid: leaf.pid });
      const response = JSON.parse((await reaped)[0]);
      assert.equal(response.response, 'reaped');
      assert.equal(response.pid, leaf.pid); assert.equal(response.exitCode, 0);
      assert.equal(await realControl.readProcessIdentity(leaf.pid), undefined);
      events.push({ event: 'real-leaf-reaped-before-returning-snapshot', ...response });
      // The original helper receives the live snapshot it just read, after the kernel has reaped the PID.
    }
    return snapshot;
  } };
  const observedProcess = { getuid: () => process.getuid(), kill: (pid, signal) => {
    assert.ok([root.pid, leaf.pid].includes(pid), 'Only this experiment owns its signal targets');
    try {
      process.kill(pid, signal);
      if (pid === root.pid) rootSignaled = true;
      events.push({ event: 'real-kill', pid, signal, result: 'success' });
    } catch (error) {
      events.push({ event: 'real-kill', pid, signal, result: error.code });
      throw error;
    }
  } };
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports,
    require: name => name === 'node:fs/promises' ? observedFs : require(name),
    process: observedProcess, setTimeout, clearTimeout, Date
  }, { filename: helperPath });
  let error;
  try { await module.exports.abortLocalClient({ child, completed }, userDataDir, report, root); }
  catch (caught) { error = caught; }
  if (scenario === 'race') {
    assert.ok(injected); assert.equal(error?.code, 'ESRCH');
    assert.match(error.stack, /remote-host-control\.cjs:114:/);
    assert.equal(report.localSignals.length, 1);
  } else { assert.equal(error, undefined); assert.equal(report.localSignals.length, 2); }
  await completed.catch(() => {});
  assert.equal(child.signalCode, 'SIGKILL');
  const receipt = { purpose: 'controlled real-kernel reproduction; production helper unchanged', scenario,
    helperSha256: createHash('sha256').update(source).digest('hex'), createdAt: new Date().toISOString(),
    root, leaf, error: error?.stack, errorCode: error?.code, localSignals: report.localSignals, events };
  await fs.writeFile(path.join(directory, `real-${scenario}-result.json`), `${JSON.stringify(receipt, null, 2)}\n`);
  emit({ diagnostic: 'PASS', scenario, outcome: error?.code ?? 'completed', root, leaf, events });
} finally {
  for (const identity of [leaf, root]) {
    if (!identity) continue;
    const actual = await realControl.readProcessIdentity(identity.pid);
    if (actual?.startTicks === identity.startTicks && !['Z', 'X'].includes(actual.state)) {
      process.kill(identity.pid, 'SIGKILL');
    }
  }
  await completed.catch(() => {});
  readyLines.close(); replies.close(); child.stdio[3].destroy();
}
