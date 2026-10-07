const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const { createHash } = require('node:crypto');
const path = require('node:path');

const fixedVsixSha256 = '604494fdebc917d3e12b54fceec75a764ed064e486dd0e76ff20513ddca61656';
const completedMarker = 'DSC_A6_COMPLETED';
const snapshotTail = 'SIGNAL:SIGHUP\n\x1b[3J\x1b[2J\x1b[HROOT\n\x1b[3;5H\x1b[31m\u4e2d\u6587\x1b[0m\x1b[5;7H';
const processIsExited = value => !value || (value.observationUnknown !== true &&
  ((value.hasExited === true && value.exitConfirmed === true && Number.isInteger(value.exitCode)) ||
    ['Z', 'X'].includes(value.state)));
const sameIdentity = (expected, actual) => Boolean(expected && actual && Number.isInteger(expected.pid) &&
  expected.pid > 1 && typeof expected.startTicks === 'string' && expected.startTicks.length > 0 &&
  typeof expected.executable === 'string' && expected.executable.length > 0 &&
  expected.pid === actual.pid && expected.startTicks === actual.startTicks && expected.executable === actual.executable);
const sameLiveIdentity = (expected, actual) => sameIdentity(expected, actual) && actual.observationUnknown !== true &&
  actual.hasExited !== true && actual.exitConfirmed !== true && !processIsExited(actual);
const exitedIdentity = (expected, actual) => !actual || (actual.observationUnknown !== true &&
  (expected.startTicks !== actual.startTicks || processIsExited(actual)));

function readSnapshotHandshake(written, ready, nonce, page) {
  const match = /^(READY:(\d+)x(\d+)\n)HASH:([a-f0-9]{64})\nSIZE:(\d+)x(\d+)\n$/.exec(written);
  if (!match || match[0] !== written || match[1] !== ready ||
      match[4] !== createHash('sha256').update(nonce).digest('hex')) return undefined;
  const initialCols = Number(match[2]), initialRows = Number(match[3]);
  const cols = Number(match[5]), rows = Number(match[6]);
  if (![initialCols, initialRows, cols, rows].every(Number.isSafeInteger) ||
      initialCols < 64 || initialRows < 5 || cols < 64 || rows < 5 ||
      page?.terminalCols !== cols || page.terminalRows !== rows) return undefined;
  return { initialCols, initialRows, cols, rows, expectedPrefix: written };
}

async function readIdentity(pid) {
  assert(Number.isInteger(pid) && pid > 1);
  if (process.platform === 'darwin') return readDarwinIdentity(pid);
  if (process.platform === 'win32') return readWindowsIdentity(pid);
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

async function readDarwinIdentity(pid) {
  const python = process.env.DEV_SESSION_CANVAS_AGENT_OBSERVER_PYTHON;
  assert(python && path.isAbsolute(python), 'Darwin identity reads require the pinned observer Python.');
  const observer = path.join(__dirname, 'agent-candidate-process-observer.py');
  const request = JSON.stringify({ version: 1, operation: 'sample', targets: [{ pid }], descend: false });
  try {
    const stdout = await runDarwinObserver(python, observer, request);
    const response = JSON.parse(stdout);
    if (response.error) throw new Error('Darwin identity observer returned an error.');
    const record = response.records?.find(value => value.pid === pid);
    if (!record || record.status === 'absent') return undefined;
    if (record.status !== 'present' || !record.identity) throw new Error('Darwin identity is unknown.');
    const { argv: _argv, ...identity } = record.identity;
    return identity;
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ESRCH') return undefined;
    throw error;
  }
}

function runDarwinObserver(python, observer, request) {
  return new Promise((resolve, reject) => {
    const child = spawn(python, [observer], {
      env: { PATH: process.env.PATH ?? '', PYTHONDONTWRITEBYTECODE: '1' },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(Object.assign(new Error('Darwin identity observer timed out.'), { code: 'ETIMEDOUT' }));
    }, 10000);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      if (code !== 0 || signal) reject(new Error(`Darwin identity observer failed: ${stderr.slice(0, 256)}`));
      else resolve(stdout);
    });
    child.stdin.end(request);
  });
}

async function readWindowsIdentity(pid) {
  const systemRoot = process.env.SystemRoot ?? process.env.WINDIR;
  assert(systemRoot && path.isAbsolute(systemRoot), 'Windows identity reads require SystemRoot.');
  const powershell = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const observer = path.join(__dirname, 'agent-candidate-process-observer.ps1');
  const response = await windowsIdentityClient(powershell, observer).request({
    version: 1, operation: 'identity', targets: [{ pid }]
  });
  if (response.error) throw new Error('Windows identity observer returned an error.');
  assert(Array.isArray(response.records) && response.records.length === 1,
    'Windows identity must have an explicit observation, including absence.');
  const observation = response.records[0];
  assert.equal(observation.pid, pid);
  if (observation.status === 'absent') return undefined;
  assert.equal(observation.status, 'present', 'Windows identity observation is unknown.');
  const record = observation.identity;
  assert.equal(record?.pid, pid);
  assert(/^win32:\d+$/.test(record.startTicks));
  assert(typeof record.executable === 'string' && path.isAbsolute(record.executable));
  assert(['R', 'replaced'].includes(record.state));
  return record;
}

let identityClient;
function windowsIdentityClient(powershell, observer) {
  if (!identityClient) identityClient = new WindowsIdentityClient(powershell, observer);
  return identityClient;
}

class WindowsIdentityClient {
  constructor(powershell, observer) {
    this.nextId = 0;
    this.pending = new Map();
    this.buffer = '';
    this.stderr = '';
    this.child = spawn(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', observer], { shell: false, env: { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR,
        TEMP: process.env.TEMP, TMP: process.env.TMP }, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stdout.setEncoding('utf8');
    this.child.stderr.setEncoding('utf8');
    this.child.stdout.on('data', chunk => this.receive(chunk));
    this.child.stderr.on('data', chunk => { this.stderr += chunk; });
    this.child.stdin.on('error', error => this.fail(error));
    this.child.once('error', error => this.fail(error));
    this.child.once('close', (code, signal) => {
      if (!this.closed) this.fail(new Error(`Windows identity observer exited: ${code ?? 'null'}/${signal ?? 'none'}${this.stderr ? ` (${this.stderr.slice(0, 256)})` : ''}`));
    });
  }

  request(request) {
    if (this.closed) return Promise.reject(new Error('Windows identity observer is closed.'));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.fail(Object.assign(new Error('Windows identity observer timed out.'), { code: 'ETIMEDOUT' }));
        reject(Object.assign(new Error('Windows identity observer timed out.'), { code: 'ETIMEDOUT' }));
      }, 10000);
      this.pending.set(id, { resolve, reject, timer });
      try { this.child.stdin.write(`${JSON.stringify({ ...request, id })}\n`); }
      catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        this.fail(error);
        reject(error);
      }
    });
  }

  receive(chunk) {
    this.buffer += chunk;
    if (this.buffer.length > 2 * 1024 * 1024) return this.fail(new Error('Windows identity observer exceeded its response budget.'));
    for (let index; (index = this.buffer.indexOf('\n')) !== -1;) {
      const line = this.buffer.slice(0, index); this.buffer = this.buffer.slice(index + 1);
      let response;
      try { response = JSON.parse(line); } catch { return this.fail(new Error('Windows identity observer returned invalid JSON.')); }
      if (response.version !== 1) return this.fail(new Error('Windows identity observer returned an incompatible response.'));
      const pending = this.pending.get(response.id);
      if (!pending) return this.fail(new Error('Windows identity observer returned an unknown request.'));
      clearTimeout(pending.timer); this.pending.delete(response.id);
      if (response.error) pending.reject(new Error('Windows identity observer returned an error.'));
      else pending.resolve(response);
    }
  }

  fail(error) {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
    this.child.kill();
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('Windows identity observer closed.')); }
    this.pending.clear();
    this.child.stdin.end();
    await new Promise(resolve => {
      const timer = setTimeout(() => { this.child.kill(); resolve(); }, 3000);
      this.child.once('close', () => { clearTimeout(timer); resolve(); });
    });
  }
}

async function closeWindowsIdentityObserver() {
  const client = identityClient;
  identityClient = undefined;
  await client?.close();
}

function assertControl(value) {
  assert.equal(value?.schemaVersion, 1);
  assert(['setup', 'verify'].includes(value.phase));
  assert.match(value.nonce, /^[a-f0-9-]{36}$/);
  assert(Number.isSafeInteger(value.deadlineAt));
  assert(['live-runtime', 'snapshot-only'].includes(value.mode ?? 'live-runtime'));
  if (value.phase === 'verify') {
    assert.equal(value.reloadRequests, 1);
    assert(value.setup?.host && value.setup?.a?.identity);
    if (value.mode !== 'snapshot-only') assert(value.setup?.b?.identity);
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

function assertSnapshotNode(node) {
  assert.equal(node?.status, 'closed');
  const metadata = node.metadata?.terminal;
  assert.equal(metadata?.persistenceMode, 'snapshot-only');
  assert.equal(metadata.liveSession, false);
  assert.equal(metadata.lastExitCode, 7);
  assert.equal(metadata.lifecycle, 'closed');
  assert(Number.isSafeInteger(metadata.outputSequence) && metadata.outputSequence > 0);
  assert(typeof metadata.serializedTerminalState?.data === 'string' && metadata.serializedTerminalState.data.length > 0);
  assert(Number.isInteger(metadata.lastCols) && metadata.lastCols >= 8);
  assert(Number.isInteger(metadata.lastRows) && metadata.lastRows >= 5);
  for (const key of ['runtimeBackend', 'runtimeStoragePath', 'runtimeSessionId', 'pendingLaunch']) {
    assert.equal(metadata[key], undefined, `Snapshot-only must not retain ${key}.`);
  }
  return metadata;
}

async function replaySnapshotTail(written, metadata) {
  const { Terminal } = require('@xterm/headless');
  const render = async data => {
    const terminal = new Terminal({ cols: metadata.lastCols, rows: metadata.lastRows,
      scrollback: 100000, allowProposedApi: true });
    try {
      await new Promise(resolve => terminal.write(data, resolve));
      const buffer = terminal.buffer.active;
      const lines = Array.from({ length: buffer.length }, (_, index) => buffer.getLine(index)?.translateToString(true) ?? '');
      return { cols: terminal.cols, rows: terminal.rows, lines, visibleLines: lines.slice(buffer.viewportY, buffer.viewportY + terminal.rows),
        cursorX: buffer.cursorX, cursorY: buffer.cursorY, viewportY: buffer.viewportY, bufferType: buffer.type,
        chineseForeground: buffer.getLine(2)?.getCell(4)?.getFgColor() };
    } finally { terminal.dispose(); }
  };
  assert(Buffer.isBuffer(written) && written.subarray(-Buffer.byteLength(snapshotTail)).equals(Buffer.from(snapshotTail)),
    'Require the independently written complete SIGHUP tail.');
  const original = await render(written);
  const saved = await render(metadata.serializedTerminalState.data);
  assert.deepEqual(saved, original, 'Persisted snapshot must match independent successful-write replay.');
  assert.equal(original.lines[0], 'ROOT');
  assert.equal(original.lines[2], '    \u4e2d\u6587');
  assert.equal(original.chineseForeground, 1);
  assert.equal(original.cursorX, 6);
  assert.equal(original.cursorY, 4);
  return original;
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
  if (control.mode === 'snapshot-only') {
    assert.equal(verify.mode, 'snapshot-only');
    assert.equal(verify.node.id, setup.a.id);
    assert.equal(verify.diskReadBeforeDriverProductCalls, true);
    assert.equal(typeof verify.productActivationAtDiskRead.before, 'boolean');
    assert.equal(typeof verify.productActivationAtDiskRead.after, 'boolean');
    assert.equal(verify.oldHostExclusiveDiskWriteClaim, false);
    assert.deepEqual(verify.disk.map(entry => entry.path), setup.diskPaths);
    for (const entry of verify.disk) {
      assert.equal(entry.node.id, setup.a.id);
      assertSnapshotNode(entry.node);
      assert.deepEqual(entry.node.metadata.terminal, verify.disk[0].node.metadata.terminal);
    }
    assert.equal(verify.disk.length, 2);
    assertSnapshotNode(verify.node);
    assert.deepEqual(verify.node.metadata.terminal.serializedTerminalState,
      verify.disk[0].node.metadata.terminal.serializedTerminalState);
    assert.deepEqual(verify.subjectSignal, { signal: 'SIGHUP' });
    assert.deepEqual(verify.subjectCompleted, { exitCode: 7, writtenComplete: true });
    assert.equal(verify.writtenMatches, true);
    assert.equal(verify.replayMatches, true);
    assert.equal(verify.page.applied, true);
    assert.equal(verify.page.cursorX, 6);
    assert.equal(verify.page.cursorY, 4);
    assert.equal(verify.page.visibleLines[0], 'ROOT');
    assert.equal(verify.page.visibleLines[2], '    \u4e2d\u6587');
    assert.equal(verify.oldReaderOutcome, 'not-observed');
    assert.equal(verify.sourceEofClaim, false);
    assert.equal(verify.resourcesExited, true);
    assert.deepEqual(verify.resourceChecks.map(entry => entry.expected), [setup.a.provider, setup.a.identity]);
    for (const entry of verify.resourceChecks) assert(exitedIdentity(entry.expected, entry.after));
    assert.deepEqual(verify.restartedExecutionEvents, []);
    assert.deepEqual(verify.replacementProviders, []);
    assert(verify.frameId && setup.frameId && verify.frameId !== setup.frameId);
  } else {
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
  }
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
  readIdentity, readSnapshotHandshake, assertControl, assertRuntimeDiscarded, assertSnapshotNode, replaySnapshotTail, snapshotTail,
  assertReloadReceipts, signalOwned, closeWindowsIdentityObserver };
