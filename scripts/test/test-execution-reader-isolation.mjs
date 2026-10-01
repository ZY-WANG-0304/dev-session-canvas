import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { assertReaderIsolationReports, assertReaderIsolationSelection, copyReaderIsolationExtensionStorage } from '../smoke/execution-reader-isolation.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsc-reader-isolation-test-'));
const sourcePath = path.resolve('tests/vscode-smoke/fixtures/execution-candidate-subject.cjs');
const source = await fs.readFile(sourcePath, 'utf8');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let checks = 0;
const running = new Set();

try {
  assertReaderIsolationSelection({}, 'win32');
  assertReaderIsolationSelection({ 'reader-isolation': true }, 'linux');
  assert.throws(() => assertReaderIsolationSelection({ 'reader-isolation': true }, 'darwin'));
  for (const addition of [{ mode: 'live-runtime' }, { 'installed-vsix': '/fixed.vsix' },
    { 'capacity-calibration': true }, { 'capacity-reconnect': true }, { 'capacity-sessions': '2' }]) {
    assert.throws(() => assertReaderIsolationSelection({ 'reader-isolation': true, ...addition }, 'linux'));
  }
  const rejectedOutput = path.join(root, 'must-not-exist');
  const rejected = spawnSync(process.execPath, ['scripts/smoke/run-vscode-execution-candidate.mjs',
    '--reader-isolation', '--mode=live-runtime', '--output', rejectedOutput], { encoding: 'utf8', timeout: 10000 });
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /Reader isolation runs its two fixed cases/);
  await assert.rejects(fs.stat(rejectedOutput), { code: 'ENOENT' });
  checks += 1;

  const baseline = await launchWriter(false);
  const baseResult = await baseline.finished;
  assert.equal(baseResult.code, 0);
  assert.equal(baseResult.signal, null);
  const baseReceipt = JSON.parse(await fs.readFile(baseline.receipt, 'utf8'));
  assert.equal(baseResult.bytes, 5580102);
  assert.equal(baseResult.hash, 'e03d6d758493454da0946cc62e7c17fb2444e39afaa7639c8a88ad271eaff48f');
  assert.equal(baseReceipt.sha256, baseResult.hash);
  assert.equal(baseReceipt.bytesWritten, baseResult.bytes);
  await assert.rejects(fs.stat(`${baseline.receipt}.gate-ready.json`), { code: 'ENOENT' });
  checks += 1;

  const gated = await launchWriter(true);
  let gate;
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline && !gate) {
    try { gate = JSON.parse(await fs.readFile(`${gated.receipt}.gate-ready.json`, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!gate) await sleep(10);
  }
  assert(gate, 'The controlled writer must reach its one fixed gate.');
  assert.equal(gate.lineCount, 45000);
  assert.equal(gate.timeoutMs, 60000);
  assert.equal(gate.identity.pid, gated.child.pid);
  assert.equal(typeof gate.identity.startTicks, 'string');
  assert.equal(gated.child.exitCode, null);
  await assert.rejects(fs.stat(gated.receipt), { code: 'ENOENT' });
  const release = `${gated.receipt}.gate-release.json`;
  await fs.writeFile(`${release}.pending`, JSON.stringify({ gateId: gate.gateId }), { flag: 'wx' });
  await fs.rename(`${release}.pending`, release);
  const gatedResult = await gated.finished;
  assert.equal(gatedResult.code, 0);
  assert.equal(gatedResult.signal, null);
  assert.equal(gatedResult.bytes, baseResult.bytes);
  assert.equal(gatedResult.hash, baseResult.hash, 'The optional gate cannot change a single output byte.');
  const gatedReceipt = JSON.parse(await fs.readFile(gated.receipt, 'utf8'));
  assert.equal(gatedReceipt.sha256, baseReceipt.sha256);
  assert.equal(gatedReceipt.terminalWriteComplete, true);
  checks += 1;

  const storageOwner = path.join(root, 'storage-owner');
  const storageAttacher = path.join(root, 'storage-attacher');
  await fs.mkdir(storageAttacher, { recursive: true });
  const storagePath = path.join(storageOwner, 'User', 'workspaceStorage', 'root-hash', 'devsessioncanvas');
  await fs.mkdir(path.join(storagePath, 'runtime-supervisor'), { recursive: true });
  await fs.writeFile(path.join(storagePath, 'canvas-state.json'), '{"state":{"nodes":[]}}\n');
  await fs.writeFile(path.join(storagePath, 'runtime-supervisor', 'registry.json'), '{"sessions":[]}\n');
  await fs.writeFile(path.join(storagePath, 'state.vscdb'), 'must not be copied');
  await fs.writeFile(path.join(storagePath, 'SingletonLock'), 'must not be copied');
  const copiedStorage = await copyReaderIsolationExtensionStorage({
    sourceStoragePath: storagePath,
    sourceUserDataDir: storageOwner,
    targetUserDataDir: storageAttacher
  });
  assert.equal(copiedStorage.relativePath, path.join('User', 'workspaceStorage', 'root-hash', 'devsessioncanvas'));
  assert.equal(copiedStorage.sourceHash, copiedStorage.targetHash);
  assert.equal(await fs.readFile(path.join(copiedStorage.targetPath, 'canvas-state.json'), 'utf8'), '{"state":{"nodes":[]}}\n');
  assert.equal(await fs.readFile(path.join(copiedStorage.targetPath, 'runtime-supervisor', 'registry.json'), 'utf8'), '{"sessions":[]}\n');
  await assert.rejects(fs.stat(path.join(copiedStorage.targetPath, 'state.vscdb')), { code: 'ENOENT' });
  await assert.rejects(fs.stat(path.join(copiedStorage.targetPath, 'SingletonLock')), { code: 'ENOENT' });
  await assert.rejects(copyReaderIsolationExtensionStorage({ sourceStoragePath: path.join(storageOwner, '..'),
    sourceUserDataDir: storageOwner, targetUserDataDir: storageAttacher }));
  await fs.symlink(path.join(storageOwner, 'outside'), path.join(storagePath, 'escape-link'));
  await fs.mkdir(path.join(root, 'storage-attacher-2'), { recursive: true });
  await assert.rejects(copyReaderIsolationExtensionStorage({ sourceStoragePath: storagePath,
    sourceUserDataDir: storageOwner, targetUserDataDir: path.join(root, 'storage-attacher-2') }), /symlinks/);
  checks += 1;

  const files = new Map();
  let time = 0, written = 0;
  const exit = { code: undefined };
  const stat = await fs.readFile('/proc/self/stat', 'utf8');
  const timeoutContext = {
    require(name) {
      if (name === 'node:crypto') return { createHash, randomUUID };
      assert.equal(name, 'node:fs');
      return {
        writeSync(_fd, bytes, _offset, length) { written += length; return length; },
        readFileSync(file) { assert.equal(file, '/proc/self/stat'); return stat; },
        existsSync() { return false; },
        writeFileSync(file, value) { assert(!files.has(file)); files.set(file, value); },
        linkSync(from, to) { assert(!files.has(to)); files.set(to, files.get(from)); },
        unlinkSync(file) { files.delete(file); }
      };
    },
    process: { argv: ['node', sourcePath, '/controlled/receipt.json', '--reader-isolation-gate'], pid: 123,
      execPath: '/controlled/node', versions: {}, exit(code) { exit.code = code; throw exit; } },
    Buffer, Int32Array, SharedArrayBuffer, performance: { now: () => time },
    Atomics: { wait(_array, _index, _expected, timeout) { assert.equal(timeout, 25); time += timeout; } }
  };
  assert.throws(() => vm.runInNewContext(source, timeoutContext), error => error === exit);
  assert.equal(exit.code, 124);
  assert.equal(time, 60000);
  const timedOut = JSON.parse(files.get('/controlled/receipt.json.gate-timeout.json'));
  const timedGate = JSON.parse(files.get('/controlled/receipt.json.gate-ready.json'));
  assert.equal(timedOut.gateId, timedGate.gateId);
  assert.equal(timedOut.elapsedMs, 60000);
  assert.equal(timedOut.exitCode, 124);
  assert.equal(timedGate.bytesWritten, gate.bytesWritten);
  assert.equal(timedGate.sha256, gate.sha256);
  assert.equal(written, gate.bytesWritten);
  assert.equal(files.has('/controlled/receipt.json'), false, 'Gate timeout cannot produce a completion receipt.');
  checks += 1;

  const identity = (surface, generation, readId) => ({ surface, lifecycle: { surface, generation, frameId: `frame-${readId}` },
    executionId: 'original-execution', readId, authorityId: 'original-authority' });
  const first = identity('editor', 1, 'a1'), middle = identity('panel', 2, 'a2'), last = identity('editor', 3, 'a3');
  const survivor = identity('panel', 1, 'b1');
  const common = { mode: 'live-runtime', executionId: 'original-execution', nodeId: 'original-node',
    sourceDisposition: { kind: 'eof' }, gate, receipt: gatedReceipt, completeBufferVerified: true,
    finalTerminal: { terminalCursorX: 6, terminalCursorY: 2 }, finalRevision: 19, noHistory: true, pass: true };
  const owner = { ...common, role: 'owner', hostPid: 101, initialReader: first, finalReader: last,
    transitions: [{ before: first, after: middle }, { before: middle, after: last }],
    settlement: { readId: 'a3', outcome: { kind: 'applied', finalRevision: 19 } } };
  const attacher = { ...common, role: 'attacher', hostPid: 102, initialReader: survivor, finalReader: survivor,
    transitions: [], settlement: { readId: 'b1', outcome: { kind: 'applied', finalRevision: 19 } } };
  assertReaderIsolationReports('live-runtime', [owner, attacher]);
  for (const mutate of [value => { value[1].settlement.readId = 'replacement'; },
    value => { value[1].finalReader.readId = 'replacement'; },
    value => { value[1].finalReader.authorityId = 'different'; },
    value => { value[1].finalRevision = 20; }, value => { value[1].sourceDisposition.kind = 'interrupted'; },
    value => { value[0].receipt.sha256 = 'wrong'; }, value => { value[0].pass = false; },
    value => { value[0].transitions = []; }, value => { value[1].hostPid = 101; }]) {
    const value = structuredClone([owner, attacher]);
    mutate(value);
    assert.throws(() => assertReaderIsolationReports('live-runtime', value));
  }
  assert.throws(() => assertReaderIsolationReports('live-runtime', [owner]));
  const local = { ...owner, mode: 'snapshot-only', initialReader: middle, finalReader: last,
    transitions: [{ before: middle, after: last }], savedSnapshotBytes: 5580068,
    settlement: { outcome: { kind: 'applied', finalOutputSequence: 19 } } };
  assertReaderIsolationReports('snapshot-only', [local]);
  assert.throws(() => assertReaderIsolationReports('snapshot-only', [{ ...local, savedSnapshotBytes: 0 }]));
  checks += 1;

  const runnerSource = await fs.readFile('scripts/smoke/execution-reader-isolation.mjs', 'utf8');
  const settlementSource = runnerSource.slice(runnerSource.indexOf('async function settleHost(running) {'));
  assert(settlementSource.startsWith('async function settleHost'));
  for (const scenario of ['already-complete', 'forced-unconfirmed', 'exited-archive-pending', 'forced-settled']) {
    let elapsed = 0, kills = 0;
    const runningHost = { result: scenario === 'already-complete' ? { ok: true } : undefined,
      handle: { child: { pid: 123, exitCode: ['already-complete', 'exited-archive-pending'].includes(scenario) ? 0 : null,
        signalCode: null, kill(signal) { assert.equal(signal, 'SIGKILL'); kills++; this.signalCode = signal; return true; } } } };
    const result = await vm.runInNewContext(`${settlementSource}\nsettleHost(running);`, {
      running: runningHost, Date: { now: () => elapsed },
      async sleep(ms) {
        elapsed += ms;
        if (scenario === 'forced-settled' && kills) runningHost.result = { ok: false, error: 'controlled force' };
      }
    });
    assert.equal(result.processExitObserved, true);
    assert.equal(result.subjectExitClaim, false);
    assert.equal(kills, scenario.startsWith('forced-') ? 1 : 0);
    if (scenario === 'already-complete') {
      assert.equal(elapsed, 0); assert.equal(result.launcherResult.ok, true);
    } else if (scenario === 'forced-settled') {
      assert.equal(elapsed, 30050); assert.equal(result.launcherResult.ok, false);
    } else {
      assert.equal(elapsed, 40000); assert.equal(result.launcherResult, null);
    }
  }
  checks += 1;
  console.log(`Reader isolation bounded selection, writer and report tests passed (${checks} groups; no VS Code/native acceptance).`);
} finally {
  for (const child of running) child.kill('SIGKILL');
  await Promise.all([...running].map(child => new Promise(resolve => child.once('close', resolve))));
  await fs.rm(root, { recursive: true, force: true });
}

async function launchWriter(gated) {
  const receipt = path.join(root, gated ? 'gated.json' : 'default.json');
  const child = spawn(process.execPath, [sourcePath, receipt, ...(gated ? ['--reader-isolation-gate'] : [])],
    { stdio: ['ignore', 'pipe', 'pipe'] });
  running.add(child);
  let bytes = 0, stderr = '';
  const hash = createHash('sha256');
  child.stdout.on('data', chunk => { bytes += chunk.length; hash.update(chunk); });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const timer = setTimeout(() => child.kill('SIGKILL'), 15000);
  const finished = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      running.delete(child);
      resolve({ code, signal, bytes, hash: hash.digest('hex'), stderr });
    });
  });
  return { child, receipt, finished };
}
