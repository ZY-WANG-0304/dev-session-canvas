import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { readJSON } from '../gates/receipts.mjs';
import { smokeCatalog } from './smoke-catalog.mjs';
import { readWindowsProcessIdentity } from './windows-process-identity.mjs';

const executeFile = promisify(execFile);

export async function processIdentity(pid, deadline = Date.now() + 5000) {
  assert(Number.isSafeInteger(pid) && pid > 0);
  assert(Number.isFinite(deadline) && deadline > Date.now(), 'Original process identity deadline exhausted');
  if (process.platform === 'linux') {
    try {
      const stat = await fs.readFile(`/proc/${pid}/stat`, { encoding: 'utf8',
        signal: AbortSignal.timeout(Math.max(1, Math.min(5000, deadline - Date.now()))) });
      assert(Date.now() <= deadline, 'Original process identity deadline exhausted');
      const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      return { pid, startTicks: fields[19], state: fields[0] };
    } catch (error) {
      if (['ENOENT', 'ESRCH'].includes(error.code) && Date.now() <= deadline) return null;
      throw error;
    }
  }
  if (process.platform === 'darwin') {
    try {
      const { stdout } = await executeFile('ps', ['-p', String(pid), '-o', 'lstart='], {
        encoding: 'utf8', timeout: Math.max(1, Math.min(5000, deadline - Date.now())), maxBuffer: 8192 });
      assert(Date.now() <= deadline, 'Original process identity deadline exhausted');
      const start = stdout.trim();
      return start ? { pid, startTime: start } : null;
    } catch(error) {
      if (error.code === 1 && !error.stdout?.trim() && !error.stderr?.trim() && Date.now() <= deadline) return null;
      throw error;
    }
  }
  assert.equal(process.platform, 'win32', 'Process identity observation is unsupported on this platform');
  return readWindowsProcessIdentity(pid, deadline);
}
export async function waitForHostAbsence(expected, deadline = Date.now() + 30000) {
  assert(expected?.startTicks || expected?.startTime, 'Original Host creation identity is required');
  do {
    assert(Date.now() < deadline, 'Original Host exit deadline exhausted');
    const actual = await processIdentity(expected.pid, deadline);
    assert(Date.now() <= deadline, 'Original Host exit deadline exhausted');
    if (!actual || (expected.startTicks && expected.startTicks !== actual.startTicks)
      || (expected.startTime && expected.startTime !== actual.startTime)) return { expected, actual, result: 'original-absent' };
    if (Date.now() >= deadline) throw new Error(`Original Host exit is unconfirmed: ${JSON.stringify({ expected, actual })}`);
    await new Promise(resolve => setTimeout(resolve, Math.min(100, Math.max(0, deadline - Date.now()))));
  } while (true);
}
export async function collectHostEvidence(directory, nonce, { contract, requireActions = true, observeExit=true,deadline=Date.now()+30000 } = {}) {
  assert(contract?.caseID && contract.subjects?.length, 'Expected Host subjects are required');
  const results = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.host.json')) results.push(await readJSON(path.join(directory, entry.name)));
  }
  assert(results.length > 0, 'Host never reported driver completion');
  const actualInvocations = [];
  for (const result of results) {
    assert.equal(result.schemaVersion, 1); assert.equal(result.nonce, nonce, 'Host evidence belongs to another run');
    assert.equal(result.caseID, contract.caseID, 'Host ran another case');
    const subject = contract.subjects.find(item => item.testFile === result.testFile);
    assert(subject && subject.roles.includes(result.role), 'Unplanned Host subject or invocation role');
    assert.equal(result.subjectHash, subject.sha256, 'Host used another test implementation');
    assert.equal(result.environment.vscode, contract.vscode, 'Host used another VS Code version');
    assert.equal(result.host.platform, result.environment.platform);
    assert(Number.isSafeInteger(result.host.pid) && result.host.pid > 0, 'Host identity is unavailable');
    assert(result.host.startTicks || result.host.startTime, 'Original Host start identity is unavailable');
    actualInvocations.push(`${result.testFile}/${result.role}`);
    if (requireActions) {
      assert.equal(result.action, 'passed'); assert.equal(result.assert, 'passed');
      assert.equal(result.failures.length, 0);
      assert(Number.isFinite(Date.parse(result.startedAt)) && Number.isFinite(Date.parse(result.completedAt)));
      assert(Number.isFinite(result.deadline) && Date.parse(result.completedAt) <= result.cleanupDeadline);
      const actionCompleted = Date.parse(result.actionCompletedAt);
      assert(Number.isFinite(actionCompleted) && actionCompleted >= Date.parse(result.startedAt)
        && actionCompleted <= result.deadline && actionCompleted <= Date.parse(result.completedAt),
        'Host business completion is missing or exceeded its original work deadline');
      const entry = smokeCatalog.find(item => item.id === contract.caseID);
      if (entry?.steps) {
        const expectedSteps = Array.isArray(entry.steps) ? entry.steps : entry.steps[result.role];
        assert.deepEqual(result.steps.map(step => step.id), expectedSteps, 'Actual smoke step set is incomplete or changed');
        for (const step of result.steps) {
          assert.equal(step.caseID, entry.id); assert.equal(step.status, 'passed');
          assert(Number.isFinite(Date.parse(step.startedAt)) && Number.isFinite(Date.parse(step.completedAt)),
            'Smoke step has no actual completion');
          assert(Date.parse(step.startedAt) >= Date.parse(result.startedAt)
            && Date.parse(step.completedAt) >= Date.parse(step.startedAt)
            && Date.parse(step.completedAt) <= result.deadline, 'Smoke step exceeded its original work deadline');
        }
      }
    }
  }
  assert.deepEqual(actualInvocations.sort(), contract.subjects.flatMap(subject => subject.roles
    .map(role => `${subject.testFile}/${role}`)).sort(), 'Host invocation set is missing, duplicated or changed');
  assert(results.some(result => result.cleanup === 'passed'), 'Final Host did not confirm fixture cleanup');
  assert(results.every(result => ['passed', 'transferred-to-verify'].includes(result.cleanup)), 'Fixture cleanup failed');
  for (const result of results.filter(result=>result.cleanup==='passed')) {
    assert(Number.isFinite(Date.parse(result.cleanupStartedAt)) && Number.isFinite(Date.parse(result.cleanupCompletedAt))
      && Date.parse(result.cleanupCompletedAt)>=Date.parse(result.cleanupStartedAt)
      && Date.parse(result.cleanupCompletedAt)<=result.cleanupDeadline,
    'Fixture cleanup completion is missing or exceeded its original deadline');
  }
  const exits = [];
  if(observeExit)for (const result of results) exits.push(await waitForHostAbsence(result.host,deadline));
  return { results, exits };
}

// Local reopen is causal: the original Host must be gone and the original
// independent PTY must have finished while offline before the new Host starts.
export async function observeLocalReopenBarrier(expected, deadline) {
  assert(expected?.setupHost && expected.rootRegistryPath && expected.rootSocketPath,
    'Original local reopen identity and registry scope are required');
  const originalHostExit = await waitForHostAbsence(expected.setupHost, deadline);
  let sessions;
  do {
    assert(Date.now() < deadline, 'Local offline completion original deadline exhausted');
    const registry = await readJSON(expected.rootRegistryPath);
    assert(Array.isArray(registry.sessions), 'Original root registry is unreadable');
    sessions = registry.sessions;
    const agent = sessions.find(session => session.sessionId === expected.agentSessionId);
    const terminal = sessions.find(session => session.sessionId === expected.terminalSessionId);
    const completed = sessions.find(session => session.sessionId === expected.completedTerminalSessionId);
    assert(agent && terminal && completed, 'Original local reopen sessions disappeared before the completion barrier');
    assert.equal(agent.kind, 'agent'); assert.equal(terminal.kind, 'terminal'); assert.equal(completed.kind, 'terminal');
    if (agent.live && terminal.live && completed.live === false
      && agent.output?.includes('[fake-agent] REAL_REOPEN_AGENT')
      && /[\r\n]REAL_REOPEN_TERMINAL(?:\r?\n|$)/u.test(terminal.output ?? '')) {
      return { setupHost: expected.setupHost, originalHostExit, registryPath: expected.rootRegistryPath,
        socketPath: expected.rootSocketPath, completedAt: new Date().toISOString(),
        sessions: sessions.map(session => ({ sessionId: session.sessionId, kind: session.kind,
          live: session.live, cols: session.cols, rows: session.rows })) };
    }
    await new Promise(resolve => setTimeout(resolve, Math.min(100, Math.max(0, deadline - Date.now()))));
  } while (true);
}
