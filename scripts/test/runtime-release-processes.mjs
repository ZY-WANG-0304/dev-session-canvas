import assert from 'node:assert/strict';
import { readFile, realpath } from 'node:fs/promises';

export async function readLinuxProcess(pid, read = readFile) {
  assert(Number.isSafeInteger(pid) && pid > 0, 'Invalid fixture PID.');
  let stat;
  try { stat = await read(`/proc/${pid}/stat`, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  const fields = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/);
  assert(stat.startsWith(`${pid} (`) && /^[A-Z]$/.test(fields[0]) && /^\d+$/.test(fields[19]), 'Unreadable process identity.');
  assert(Number.isSafeInteger(Number(fields[1])) && Number(fields[1]) >= 0, 'Unreadable parent PID.');
  return { pid, startTicks: fields[19], state: fields[0], parentPid: Number(fields[1]) };
}

export async function captureProcessIdentity(pid) {
  const before = await readLinuxProcess(pid);
  assert(before && !['Z', 'X'].includes(before.state), 'Cannot capture an exited fixture process.');
  const executable = await realpath(`/proc/${pid}/exe`);
  const after = await readLinuxProcess(pid);
  assert.equal(after?.startTicks, before.startTicks, 'Process changed while capturing identity.');
  return { pid, startTicks: before.startTicks, executable };
}

export async function observeOriginalProcess(identity, read = readLinuxProcess) {
  assert(Number.isSafeInteger(identity.pid) && identity.pid > 0 && /^\d+$/.test(identity.startTicks), 'Missing original identity.');
  const current = await read(identity.pid);
  if (!current) return { ...identity, observed: 'absent' };
  assert.equal(current.startTicks, identity.startTicks, `Fixture PID ${identity.pid} was reused; do not signal it.`);
  return { ...identity, observed: 'present', state: current.state };
}

export async function observeOriginalProcesses(identities, read = readLinuxProcess) {
  return Promise.all(identities.map(identity => observeOriginalProcess(identity, read)));
}

export async function signalOriginalProcess(identity, signal, { read = readLinuxProcess, kill = process.kill } = {}) {
  const observed = await observeOriginalProcess(identity, read);
  if (observed.observed === 'absent' || ['Z', 'X'].includes(observed.state)) return false;
  try { kill(identity.pid, signal); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}

export async function trackDescendants(parent, tracked, depth = 0) {
  if ((await observeOriginalProcess(parent)).observed === 'absent') return;
  const childPids = (await readFile(`/proc/${parent.pid}/task/${parent.pid}/children`, 'utf8')).trim().split(/\s+/).filter(Boolean).map(Number);
  for (const childPid of childPids) {
    const current = await readLinuxProcess(childPid);
    if (!current) continue;
    assert.equal(current.parentPid, parent.pid, 'Fixture child no longer belongs to the captured parent.');
    if (['Z', 'X'].includes(current.state)) continue;
    const child = { ...await captureProcessIdentity(childPid), role: depth === 0 ? 'provider' : 'pty' };
    assert.equal(child.startTicks, current.startTicks, 'Fixture child changed while discovering descendants.');
    assert.equal((await observeOriginalProcess(parent)).observed, 'present', 'Parent disappeared during child discovery.');
    const previous = tracked.find(identity => identity.pid === child.pid);
    if (previous) assert.deepEqual(child, previous, 'Tracked child changed identity.');
    else tracked.push(child);
    await trackDescendants(child, tracked, depth + 1);
  }
}
