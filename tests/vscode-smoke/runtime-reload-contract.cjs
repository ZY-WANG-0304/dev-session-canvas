const assert = require('node:assert/strict');
const fs = require('node:fs/promises');

const fixedVsixSha256 = '604494fdebc917d3e12b54fceec75a764ed064e486dd0e76ff20513ddca61656';
const completedMarker = 'DSC_A6_COMPLETED';
const sameIdentity = (expected, actual) => Boolean(expected && actual && Number.isInteger(expected.pid) &&
  expected.pid > 1 && typeof expected.startTicks === 'string' && expected.startTicks.length > 0 &&
  typeof expected.executable === 'string' && expected.executable.startsWith('/') &&
  expected.pid === actual.pid && expected.startTicks === actual.startTicks && expected.executable === actual.executable);
const sameLiveIdentity = (expected, actual) => sameIdentity(expected, actual) && !['Z', 'X'].includes(actual.state);
const exitedIdentity = (expected, actual) => !actual || expected.startTicks !== actual.startTicks || ['Z', 'X'].includes(actual.state);

async function readIdentity(pid) {
  assert(Number.isInteger(pid) && pid > 1);
  try {
    const stat = await fs.readFile(`/proc/${pid}/stat`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    return { pid, ppid: Number(fields[1]), state: fields[0], startTicks: fields[19],
      executable: await fs.readlink(`/proc/${pid}/exe`).catch(error => {
        if (['ENOENT', 'ESRCH'].includes(error.code)) return null;
        throw error;
      }) };
  } catch (error) { if (['ENOENT', 'ESRCH'].includes(error.code)) return undefined; throw error; }
}

function assertControl(value) {
  assert.equal(value?.schemaVersion, 1);
  assert(['setup', 'verify'].includes(value.phase));
  assert.match(value.nonce, /^[a-f0-9-]{36}$/);
  assert(Number.isSafeInteger(value.deadlineAt));
  if (value.phase === 'verify') {
    assert.equal(value.reloadRequests, 1);
    assert(value.setup?.host && value.setup?.a?.identity && value.setup?.b?.identity);
  }
  return value;
}

function assertRuntimeDiscarded(node) {
  assert.equal(node?.status, 'closed');
  const metadata = node.metadata?.terminal;
  assert.equal(metadata?.terminalHistoryDiscarded, true);
  assert.equal(metadata.liveSession, false);
  assert.equal(metadata.lastExitCode, 0);
  for (const key of ['terminalStream', 'serializedTerminalState', 'recentOutput', 'runtimeSessionId', 'pendingLaunch']) {
    assert.equal(metadata[key], undefined, `Completed Runtime must not retain ${key}.`);
  }
}

function assertReloadReceipts({ control, launcher, setup, verify, cleanup, exit, fallback }) {
  assertControl(control);
  assert.equal(control.phase, 'verify');
  assert.deepEqual(control.setup, setup, 'Verify must use the original durable setup handoff.');
  for (const receipt of [setup, verify, cleanup]) {
    assert(receipt, 'Missing explicit reload receipt.');
    assert.equal(receipt.nonce, control.nonce);
    assert.equal(receipt.pass, true);
  }
  assert.equal(launcher.spawnCount, 1);
  assert.equal(verify.reloadRequests, 1);
  assert(sameLiveIdentity(launcher.ui, setup.ui));
  assert(sameLiveIdentity(launcher.ui, verify.ui), 'Reload must retain the original UI process.');
  assert(!sameIdentity(setup.host, verify.host), 'Reload must start a different Extension Host.');
  assert(exitedIdentity(setup.host, verify.oldHostAtVerify), 'Original Host must exit.');
  for (const role of ['supervisor', 'provider', 'identity']) {
    assert(sameLiveIdentity(setup.a[role], verify.a[role]), `Reload replaced the original ${role}.`);
  }
  assert.deepEqual(verify.a.binding, setup.a.binding);
  assert.equal(verify.a.reader.sessionId, setup.a.binding.runtimeSessionId);
  assert.equal(verify.a.reader.authorityId, setup.a.reader.authorityId);
  assert.notEqual(verify.a.reader.readId, setup.a.reader.readId);
  assert(verify.frameId && setup.frameId && verify.frameId !== setup.frameId);
  assert.equal(verify.interaction.nonce, control.nonce);
  assert.equal(verify.interaction.applied, true);
  assert.equal(verify.completedNodeId, setup.b.id);
  assertRuntimeDiscarded(verify.completedNode);
  assert.equal(verify.completedAttachEmpty, true);
  assert.deepEqual(verify.restartedExecutionEvents, []);
  assert.equal(verify.aCompletedApplied, true);
  assertRuntimeDiscarded(verify.finishedNode);
  assert.equal(cleanup.runtime.bindings.length, 0);
  assert.equal(cleanup.runtime.pendingRuntimeSupervisorOperationCount, 0);
  assert.equal(cleanup.nodesRemaining, 0);
  assert.equal(cleanup.resourcesExited, true);
  assert.equal(exit.code, 0);
  assert.equal(exit.signal, null);
  assert.deepEqual(fallback, [], 'Fallback cannot count as successful product cleanup.');
}

async function signalOwned(expected, signal, { read = readIdentity, kill = process.kill.bind(process) } = {}) {
  const actual = await read(expected.pid);
  if (exitedIdentity(expected, actual)) return { action: 'already-exited', expected, actual: actual ?? null };
  if (!sameLiveIdentity(expected, actual)) return { action: 'identity-mismatch-no-signal', expected, actual };
  try {
    kill(expected.pid, signal);
    return { action: 'owned-fallback-signal', signal, expected, actual, productCleanupPass: false };
  } catch (error) {
    if (error.code === 'ESRCH') return { action: 'exited-before-signal', expected, actual };
    return { action: 'signal-failed', expected, actual, error: String(error) };
  }
}

module.exports = { fixedVsixSha256, completedMarker, sameIdentity, sameLiveIdentity, exitedIdentity,
  readIdentity, assertControl, assertRuntimeDiscarded, assertReloadReceipts, signalOwned };
