import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';
import esbuild from 'esbuild';
import yaml from 'js-yaml';

const CASES = ['namespace', 'normal', 'paused-stop', 'paused-cancel'];
const CASE_MS = 45000;
const CLEANUP_MS = 35000;
const RESOURCE_IDS = ['conpty-owner', 'conpty-process', 'conpty-input', 'conpty-source', 'provider-control'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = (file, value) => fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const require = createRequire(import.meta.url);
const inputs = new Map();

async function until(test, deadline, label) {
  while (true) {
    if (performance.now() >= deadline) throw new Error(`Observation deadline: ${label}`);
    if (test()) return;
    await delay(5);
  }
}
async function before(promise, deadline, label) {
  if (performance.now() >= deadline) throw new Error(`Observation deadline: ${label}`);
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Observation deadline: ${label}`)), Math.max(0, deadline - performance.now()));
    })]);
  } finally { clearTimeout(timer); }
}
function frames(raw) {
  const bytes = Buffer.concat(raw);
  const result = [];
  let offset = 0;
  while (offset + 4 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    if (offset + 4 + length > bytes.length) break;
    result.push(JSON.parse(bytes.subarray(offset + 4, offset + 4 + length).toString('utf8')));
    offset += 4 + length;
  }
  return { frames: result, incompleteBytes: bytes.length - offset };
}
function terminalState(tracker) {
  const terminal = tracker.terminal;
  const buffer = terminal.buffer.active;
  return { cols: terminal.cols, rows: terminal.rows, cursorX: buffer.cursorX, cursorY: buffer.cursorY,
    baseY: buffer.baseY, text: Array.from({ length: buffer.length }, (_, index) => buffer.getLine(index)?.translateToString(true) ?? '') };
}
function visibleText(tracker) {
  const terminal = tracker.terminal;
  const buffer = terminal.buffer.active;
  return Array.from({ length: terminal.rows }, (_, index) => buffer.getLine(buffer.baseY + index)?.translateToString(true) ?? '').join('\n');
}
function terminalHooks(record) {
  return {
    async consume(batches) {
      if (record.paused) await record.gate;
      for (const batch of batches) {
        record.consumed += batch.text;
        record.tracker.write(batch.text, { outputSequence: batch.sequence });
      }
      await record.tracker.drain();
    },
    async flushFinal(seal) {
      const final = await record.tracker.flush();
      assert.equal(final.outputSequence, seal.lastDataSequence, 'Final parser state must include the sealed output sequence');
      return final.outputSequence;
    }
  };
}
function subjectExit(record) {
  const observer = record.observer;
  const observed = observer?.events.find(event => event.kind === 'observing');
  const exited = observer?.events.find(event => event.kind === 'exited');
  if (!observer?.bound || observer.error || observer.result?.code !== 0 || observer.result?.signal !== null
    || observer.events.some(event => event.kind === 'unknown') || !observed || !exited
    || observed.pid !== record.subject?.pid || observed.nonce !== observer.nonce
    || exited.pid !== observed.pid || exited.nonce !== observed.nonce || exited.startTime !== observed.startTime
    || exited.hasExited !== true || !Number.isInteger(exited.exitCode)) return undefined;
  return exited;
}
function assertProductSubjectExit(record) {
  const exited = subjectExit(record);
  assert(exited, 'The identity-bound original subject must be observed exited');
  assert.notEqual(exited.exitCode, 124, 'The fixture safety timer cannot satisfy product stop');
  assert.equal(record.safety, undefined, 'A recorded safety timeout cannot satisfy product completion');
  return exited;
}
function cleanupResourcesSafe(resources) {
  return resources.every(record => (!record.transport || record.transport.closed)
    && (!record.transport || record.subjectExit)
    && (!record.resources || Object.values(record.resources).every(resource => resource.current?.kind === 'released')));
}
async function readSafety(record) {
  try { record.safety = JSON.parse(await fs.readFile(`${record.prefix}-safety.json`, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
async function observeSubject(context, record) {
  context.assertActive();
  const nonce = randomBytes(16).toString('hex');
  const executable = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const child = spawn(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', context.observerPath, '-SubjectPid', String(record.subject.pid),
    '-ExpectedExecutable', process.execPath, '-ObservationNonce', nonce], { stdio: ['ignore', 'pipe', 'pipe'], shell: false });
  const observer = record.observer = { child, nonce, events: [], stdout: '', stderr: '', pending: '', bound: false };
  child.on('error', error => { observer.error ??= String(error); });
  child.on('close', (code, signal) => { observer.result = { code, signal }; });
  child.stderr.on('data', bytes => {
    if (observer.stderr.length + bytes.length > 8192) observer.error ??= 'Subject observer stderr exceeded fixed evidence budget';
    else observer.stderr += bytes.toString('utf8');
  });
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', text => {
    if (observer.stdout.length + text.length > 8192) { observer.error ??= 'Subject observer stdout exceeded fixed evidence budget'; return; }
    observer.stdout += text;
    observer.pending += text;
    for (let index; (index = observer.pending.indexOf('\n')) !== -1;) {
      const line = observer.pending.slice(0, index).trim(); observer.pending = observer.pending.slice(index + 1);
      try { observer.events.push(JSON.parse(line)); } catch { observer.error ??= 'Invalid subject observer evidence'; }
    }
  });
  await until(() => observer.events.length || observer.result || observer.error, context.deadline, 'original subject handle acquired');
  assert.equal(observer.error, undefined);
  const observed = observer.events[0];
  assert.equal(observed?.kind, 'observing'); assert.equal(observed.pid, record.subject.pid); assert.equal(observed.nonce, nonce);
  assert.equal(typeof observed.startTime, 'string'); assert(observed.startTime.length > 0);
  await input(context, record, `observe:${nonce}\n`);
  await until(() => visibleText(record.tracker).includes(`OBSERVED:${nonce}`), context.deadline, 'original subject identity challenge applied');
  const receipt = JSON.parse(await fs.readFile(`${record.prefix}-observed.json`, 'utf8'));
  assert.deepEqual(receipt, { pid: record.subject.pid, ppid: record.started.pid, nonce });
  observer.bound = true;
}
function assertTail(tracker) {
  const state = terminalState(tracker);
  assert.equal(state.cols, 119); assert.equal(state.rows, 41);
  assert.equal(state.cursorX, 6); assert.equal(state.cursorY, 4);
  const numbered = state.text.filter(line => line.startsWith('DSC_LINE_'));
  assert.equal(numbered.length, 90000);
  for (let index = 0; index < numbered.length; index++) assert.equal(numbered[index], `DSC_LINE_${String(index + 1).padStart(6, '0')}`);
  const tail = state.text.indexOf('DSC_TAIL_\u4e2d\u6587');
  assert(tail >= 0);
  const line = tracker.terminal.buffer.active.getLine(tail);
  assert.equal(line.getCell(0).getFgColor(), 1);
  assert.equal(line.getCell(9).getWidth(), 2);
  return state;
}
async function load(file) {
  const filename = path.resolve(file);
  const built = await esbuild.build({ entryPoints: [filename], bundle: true, write: false, metafile: true,
    format: 'cjs', platform: 'node', target: 'node25', external: ['vscode', 'node-pty'] });
  for (const input of Object.keys(built.metafile.inputs)) inputs.set(input, hash(await fs.readFile(input)));
  const module = { exports: {} };
  new Function('require', 'module', 'exports', '__filename', '__dirname', built.outputFiles[0].text)(name => {
    assert(name !== 'node-pty' && !name.endsWith('.node'), 'The observing authority cannot load a PTY addon');
    return require(name);
  }, module, module.exports, filename, path.dirname(filename));
  return module.exports;
}

async function selfTest() {
  const payload = Buffer.from(JSON.stringify({ frameId: 1, text: '\u4e2d' }));
  const size = Buffer.alloc(4); size.writeUInt32BE(payload.length);
  assert.deepEqual(frames([size, payload]).frames, [{ frameId: 1, text: '\u4e2d' }]);
  assert.equal(frames([size, payload.subarray(0, -1)]).incompleteBytes, size.length + payload.length - 1);
  const workflow = yaml.load(await fs.readFile('.github/workflows/runtime-execution-windows.yml', 'utf8'));
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch'],
    'The historical provider matrix remains manual; final production acceptance owns the affected package run.');
  assert.equal(Object.keys(workflow.jobs).length, 1);
  const job = workflow.jobs['product-provider'];
  assert.equal(job['runs-on'], 'windows-latest');
  assert.equal(job.steps.find(step => step.uses === 'actions/setup-node@v4').with['node-version'], '25.6.0');
  const commands = job.steps.map(step => step.run ?? '').join('\n');
  assert.match(commands, /node scripts\/test\/test-execution-session-bridge\.mjs/);
  assert.match(commands, /--execution-profile=windows-owner-v1-candidate/);
  assert.doesNotMatch(commands, /scripts\/diagnostics|DEEPSEEK|continue-on-error/);
  const observerSource = await fs.readFile('scripts/test/fixtures/windows-execution-observer.ps1', 'utf8');
  assert.equal((observerSource.match(/GetProcessById\(/g) ?? []).length, 1);
  assert.match(observerSource, /\$ownedHandle = \$subject.SafeHandle/);
  assert.match(observerSource, /\$subject.WaitForExit\(100\)/);
  assert.match(observerSource, /hasExited = \$subject.HasExited; exitCode = \$subject.ExitCode/);
  assert.doesNotMatch(observerSource, /Stop-Process|taskkill|\.Kill\(|CloseHandle/);
  const identity = { pid: 123, nonce: 'a'.repeat(32), startTime: 'fixed-instance' };
  const observedSubject = { subject: { pid: identity.pid }, observer: { nonce: identity.nonce, bound: true,
    events: [{ kind: 'observing', ...identity }, { kind: 'exited', ...identity, hasExited: true, exitCode: 1 }],
    result: { code: 0, signal: null } } };
  assert.equal(assertProductSubjectExit(observedSubject).exitCode, 1);
  const missing = structuredClone(observedSubject); missing.observer.events.pop();
  assert.equal(subjectExit(missing), undefined, 'Released provider resources do not prove the subject exited');
  const wrongInstance = structuredClone(observedSubject); wrongInstance.observer.events[1].startTime = 'replacement-instance';
  assert.equal(subjectExit(wrongInstance), undefined);
  const unbound = structuredClone(observedSubject); unbound.observer.bound = false;
  assert.equal(subjectExit(unbound), undefined);
  const timeout = structuredClone(observedSubject); timeout.observer.events[1].exitCode = 124;
  assert.throws(() => assertProductSubjectExit(timeout), /safety timer/);
  const safetyBeforeOtherExit = structuredClone(observedSubject); safetyBeforeOtherExit.safety = { kind: 'safety-timeout' };
  assert.throws(() => assertProductSubjectExit(safetyBeforeOtherExit), /recorded safety timeout/);
  const allReleased = { transport: { closed: true },
    resources: Object.fromEntries(RESOURCE_IDS.map(id => [id, { current: { kind: 'released' } }])) };
  assert.equal(cleanupResourcesSafe([allReleased]), false, 'Safe cleanup also requires the actual subject exit');
  assert.equal(cleanupResourcesSafe([{ ...allReleased, subjectExit: subjectExit(observedSubject) }]), true);
  const startupDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'dsc-windows-subject-startup-'));
  try {
    const prefix = path.join(startupDirectory, 'A');
    const result = spawnSync(process.execPath, [path.resolve('scripts/test/fixtures/windows-execution-subject.mjs'), prefix],
      { stdio: 'pipe', encoding: 'utf8', timeout: 5000 });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1, 'Non-TTY startup must retain the original failing exit status');
    const receipt = JSON.parse(await fs.readFile(`${prefix}-startup.json`, 'utf8'));
    assert.equal(receipt.pid, result.pid); assert.equal(receipt.ppid, process.pid);
    assert.equal(receipt.version, process.version); assert.equal(receipt.executable, process.execPath);
    assert.equal(receipt.stdinTTY, false); assert.equal(receipt.stdoutTTY, false);
    assert.match(await fs.readFile(`${prefix}-uncaught-error.txt`, 'utf8'), /requires fixed Node and a real ConPTY terminal/);
    await assert.rejects(fs.access(`${prefix}-ready.json`), { code: 'ENOENT' });
  } finally { await fs.rm(startupDirectory, { recursive: true, force: true }); }
  const { SerializedTerminalStateTracker: Tracker } = await load('extensions/vscode/dev-session-canvas/src/common/serializedTerminalState.ts');
  const tracker = new Tracker(119, 41, { scrollback: 100000 });
  const record = { tracker, consumed: '', paused: false };
  const hooks = terminalHooks(record);
  await hooks.consume([
    { sequence: 1, text: Array.from({ length: 90000 }, (_, index) => `DSC_LINE_${String(index + 1).padStart(6, '0')}\r\n`).join('') },
    { sequence: 2, text: '\u001b[31mDSC_TAIL_\u4e2d\u6587\u001b[0m\r\n\u001b[5;7H' }
  ]);
  assert.equal(await hooks.flushFinal({ lastDataSequence: 2 }), 2);
  await assert.rejects(hooks.flushFinal({ lastDataSequence: 3 }), /sealed output sequence/);
  assertTail(tracker);
  tracker.dispose();
  console.log('Windows product input self-test passed; parser/workflow and rejected non-TTY startup only, no native calls.');
}

async function namespaceCase(context, state) {
  const storage = path.join(context.directory, 'storage');
  const launch = () => {
    context.assertActive();
    const child = spawn(process.execPath, [context.namespaceEntry, storage], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'], shell: false });
    const record = { child, events: [], stderr: '', result: undefined };
    state.children.push(record);
    child.on('message', value => record.events.push(value));
    child.on('error', error => { record.error = String(error); });
    child.stderr.on('data', bytes => { record.stderr += bytes.toString('utf8'); });
    child.on('close', (code, signal) => { record.result = { code, signal }; });
    return record;
  };
  const first = launch();
  await until(() => first.events.length || first.result, context.deadline, 'original namespace claim');
  assert.equal(first.events[0]?.kind, 'claimed');
  assert.match(first.events[0].address, /^\\\\\.\\pipe\\dsc-runtime-owner-[a-f0-9]{64}$/);
  const competitor = launch();
  await until(() => competitor.result, context.deadline, 'namespace competitor rejected');
  assert.equal(competitor.events[0]?.kind, 'rejected');
  assert.equal(competitor.events[0]?.code, 'EADDRINUSE');
  assert.deepEqual(competitor.result, { code: 2, signal: null });
  first.child.send('release-by-exit');
  await until(() => first.result, context.deadline, 'namespace owner natural exit');
  assert.deepEqual(first.result, { code: 0, signal: null });
  const next = launch();
  await until(() => next.events.length || next.result, context.deadline, 'namespace reacquired after owner exit');
  assert.equal(next.events[0]?.kind, 'claimed');
  assert.equal(next.events[0].address, first.events[0].address);
  next.child.send('release-by-exit');
  await until(() => next.result, context.deadline, 'namespace successor natural exit');
  assert.deepEqual(next.result, { code: 0, signal: null });
  return { sameNamespace: true, authorityProcesses: 3, ptySessions: 0, foreignProcessObjectDisappearanceRequired: false };
}

async function startSubject(context, state, key, scrollback = 100) {
  context.assertActive();
  const record = { key, raw: [], controls: [], commands: [], rawBytes: 0, incomplete: false, paused: false, consumed: '' };
  record.tracker = new context.Tracker(107, 33, { scrollback });
  record.gate = new Promise(resolve => { record.resume = () => { record.paused = false; resolve(); }; });
  record.execution = state.owner.reserve(`windows-${key}`);
  record.prefix = path.join(context.directory, key);
  state.records.push(record);
  state.starting = record;
  const env = {};
  for (const key of ['SystemRoot', 'WINDIR', 'ComSpec', 'COMSPEC', 'PATH', 'Path', 'TEMP', 'TMP', 'PATHEXT']) {
    if (typeof process.env[key] === 'string') env[key] = process.env[key];
  }
  Object.assign(env, { TERM: 'xterm-256color', DSC_EXECUTION_NODE: process.execPath,
    DSC_EXECUTION_SUBJECT: context.subjectPath, DSC_EXECUTION_PREFIX: record.prefix });
  const start = record.execution.start({ file: context.launcherPath, args: [], cwd: context.directory, env,
    cols: 107, rows: 33, stopStrategy: 'hangup' }, terminalHooks(record));
  const started = await before(start.first, context.deadline, `${key} startup`);
  assert.equal(started.kind, 'started');
  record.started = started;
  await until(() => visibleText(record.tracker).includes('READY:107x33') || record.execution.snapshot().settled,
    context.deadline, `${key} real TTY ready`);
  assert(visibleText(record.tracker).includes('READY:107x33'),
    `The original launcher settled before real TTY readiness: ${JSON.stringify(record.execution.snapshot().adapter.process)}`);
  const ready = JSON.parse(await fs.readFile(`${record.prefix}-ready.json`, 'utf8'));
  assert.equal(ready.ppid, started.pid, 'The cmd launcher must be the real subject parent');
  assert.notEqual(ready.pid, started.pid);
  assert(ready.stdinTTY && ready.stdoutTTY);
  record.subject = ready;
  await observeSubject(context, record);
  await until(() => record.execution.snapshot().adapter.consumedThrough === record.execution.snapshot().adapter.acceptedThrough,
    context.deadline, `${key} initial consumption`);
  return record;
}
async function input(context, record, text, deadline = context.deadline) {
  context.assertActive();
  const result = await before(record.execution.write(text, Math.min(deadline, performance.now() + 8000)).first, deadline, 'terminal input');
  assert.equal(result.kind, 'written');
  assert.equal(result.writtenBytes, Buffer.byteLength(text));
}
async function settled(context, record) {
  await until(() => record.execution.snapshot().settled, context.deadline, `${record.key} original owner settlement`);
  await until(() => record.observer?.result, context.deadline, `${record.key} original subject exit observation`);
  await readSafety(record);
  record.subjectExit = assertProductSubjectExit(record);
  const snapshot = record.execution.snapshot();
  assert.equal(snapshot.adapter.firstFault, undefined);
  assert.equal(snapshot.adapter.resourceLedgerIncomplete, false);
  assert.equal(snapshot.terminal.kind, 'applied');
  assert.equal(snapshot.adapter.consumedThrough, snapshot.adapter.seal.lastDataSequence);
  assert.equal(snapshot.adapter.pendingBytes, 0);
  for (const id of RESOURCE_IDS) assert.equal(snapshot.adapter.resources[id]?.current?.kind, 'released', id);
  const parsed = frames(record.raw);
  assert.equal(parsed.incompleteBytes, 0);
  assert.equal(record.consumed, parsed.frames.map(frame => frame.text).join(''), 'All received output frames must reach the parser');
  assert(!record.incomplete, 'Fixed evidence budget exceeded');
  record.execution.settleReaders('settled');
  return snapshot;
}

async function providerCase(context, state, scenario) {
  const options = context.factory.createWindowsExecutionOwnerOptions({ extensionRoot: context.extensionRoot, mode: 'snapshot-only' });
  state.owner = new context.Owner({ ...options, createTransport(identity) {
    context.assertActive();
    const record = state.starting;
    assert(record && !record.transport);
    const transport = record.transport = options.createTransport(identity);
    const connect = transport.connect.bind(transport);
    const send = transport.send.bind(transport);
    transport.connect = sink => connect({ ...sink,
      message(message) {
        if (record.controls.length < 20000) record.controls.push({ at: performance.now(), message }); else record.incomplete = true;
        sink.message(message);
      },
      data(bytes) {
        if (record.rawBytes + bytes.length <= 16 * 1024 * 1024) { record.raw.push(Buffer.from(bytes)); record.rawBytes += bytes.length; }
        else record.incomplete = true;
        sink.data(bytes);
      }
    });
    transport.send = message => {
      if (record.commands.length < 20000) record.commands.push({ at: performance.now(), message }); else record.incomplete = true;
      return send(message);
    };
    return transport;
  } });
  const a = await startSubject(context, state, 'A', scenario === 'normal' ? 100000 : 100);
  if (scenario === 'normal') {
    const nonce = randomBytes(16).toString('hex');
    await input(context, a, `nonce:${nonce}\n`);
    await until(() => visibleText(a.tracker).includes(`HASH:${hash(nonce)}`), context.deadline, 'nonce actually applied');
    const resized = await before(a.execution.resize(119, 41, Math.min(context.deadline, performance.now() + 8000)).first,
      context.deadline, 'real terminal resize');
    assert.equal(resized.kind, 'resized');
    a.tracker.resize(119, 41);
    await input(context, a, 'size\n');
    await until(() => visibleText(a.tracker).includes('SIZE:119x41'), context.deadline, 'real resized PTY dimensions');
    await input(context, a, 'finish\n');
    const snapshot = await settled(context, a);
    assert.deepEqual(snapshot.adapter.process, { kind: 'exited', exitCode: 7 });
    assert.equal(a.subjectExit.exitCode, 7);
    assert.equal(snapshot.adapter.source.kind, 'eof');
    const written = await fs.readFile(`${a.prefix}-written.bin`);
    const receipt = JSON.parse(await fs.readFile(`${a.prefix}-complete.json`, 'utf8'));
    assert.equal(receipt.pid, a.subject.pid); assert.equal(receipt.ppid, a.started.pid);
    assert.equal(receipt.exitCode, 7); assert.equal(receipt.writtenBytes, written.length); assert.equal(receipt.sha256, hash(written));
    const expected = new context.Tracker(119, 41, { scrollback: 100000 });
    try {
      expected.write(written.toString('utf8'));
      await expected.flush();
      const actualState = assertTail(a.tracker);
      const expectedState = assertTail(expected);
      assert.deepEqual(actualState, expectedState, 'ConPTY projection must preserve full text and final terminal state');
      await json(path.join(context.directory, 'terminal-state.json'), actualState);
    } finally { expected.dispose(); }
    return { snapshot, receipt, sourceSha256: hash(written), observedFrameTextSha256: hash(a.consumed),
      byteIdentityClaim: false, completeNumberedLines: 90000, finalStateMatched: true };
  }
  const b = await startSubject(context, state, 'B');
  const consumed = a.execution.snapshot().adapter.consumedThrough;
  a.paused = true;
  await input(context, a, 'flood\n');
  await until(() => a.execution.snapshot().adapter.acceptedThrough - consumed >= 16, context.deadline, 'A output credit exhausted');
  assert.equal(a.execution.snapshot().adapter.consumedThrough, consumed);
  void a.execution.requestStop(`fixed Windows ${scenario}`);
  await until(() => a.controls.some(entry => entry.message.type === 'operationObservation' &&
    entry.message.operationId === 'owner-graceful' && entry.message.result.kind === 'accepted'), context.deadline, 'original stop accepted');
  const nonce = randomBytes(16).toString('hex');
  const interactionStart = performance.now();
  const interactionDeadline = Math.min(context.deadline, interactionStart + 1500);
  assert(!a.execution.snapshot().settled);
  await input(context, b, `nonce:${nonce}\n`, interactionDeadline);
  await until(() => visibleText(b.tracker).includes(`HASH:${hash(nonce)}`), interactionDeadline, 'B response applied during A cleanup');
  const interactionMs = performance.now() - interactionStart;
  assert(!a.execution.snapshot().settled);
  assert.equal(a.execution.snapshot().adapter.consumedThrough, consumed);
  if (scenario === 'paused-cancel') {
    await until(() => {
      const command = a.commands.find(entry => entry.message.type === 'cancelOutput')?.message;
      return command && a.controls.some(entry => entry.message.type === 'operationObservation'
        && entry.message.operationId === command.operationId && entry.message.result.kind === 'accepted');
    }, context.deadline, 'original owner output cancel accepted');
  }
  a.resume();
  const snapshot = await settled(context, a);
  assert.equal(snapshot.adapter.process.kind, 'exited');
  assert(['eof', 'interrupted'].includes(snapshot.adapter.source.kind));
  if (scenario === 'paused-cancel') assert.equal(snapshot.adapter.source.kind, 'interrupted');
  await input(context, b, 'peer-exit\n');
  const peer = await settled(context, b);
  assert.deepEqual(peer.adapter.process, { kind: 'exited', exitCode: 0 });
  assert.equal(b.subjectExit.exitCode, 0);
  assert.equal(peer.adapter.source.kind, 'eof');
  const peerReceipt = JSON.parse(await fs.readFile(`${b.prefix}-complete.json`, 'utf8'));
  assert.equal(peerReceipt.pid, b.subject.pid); assert.equal(peerReceipt.ppid, b.started.pid);
  return { snapshot, peer, interactionMs, cleanupInteractionOverlapObserved: true,
    deliberateStop: true, naturalCompletionClaim: false, fullWriterDrainClaim: false, allReceivedFramesConsumed: true };
}

async function cleanup(context, state) {
  context.sealed = true;
  const deadline = performance.now() + CLEANUP_MS;
  const errors = [], forcedSignals = [];
  for (const record of state.records) record.resume();
  for (const record of state.children) {
    if (record.result) continue;
    if (record.child.connected) record.child.send('release-by-exit', () => {});
    try { await until(() => record.result, Math.min(deadline, performance.now() + 2000), 'namespace fixture cleanup'); }
    catch { errors.push('Original namespace child exit is unconfirmed'); }
  }
  state.owner?.closeAdmission(true);
  for (const record of state.records) {
    if (!record.transport || record.transport.snapshot().closed) continue;
    void record.execution.requestStop('Windows evidence cleanup').catch(error => errors.push(String(error)));
  }
  for (const record of state.records) {
    if (!record.transport) continue;
    try { await before(record.transport.closed, deadline, 'original provider cleanup'); }
    catch (error) { errors.push(String(error)); }
  }
  for (const record of state.records) {
    if (!record.transport) continue;
    if (!record.observer) { errors.push('Original subject identity was never observed'); continue; }
    try {
      await until(() => record.observer?.result, deadline, 'original subject observer cleanup');
      await readSafety(record);
      if (!subjectExit(record)) errors.push('Original subject exit identity or result is unconfirmed');
    } catch (error) { errors.push(String(error)); }
  }
  try { await until(() => state.taskSettled, deadline, 'fixed scenario task settled'); }
  catch (error) { errors.push(String(error)); }
  const resources = state.records.map(record => ({ key: record.key, transport: record.transport?.snapshot(),
    resources: record.execution?.snapshot().adapter?.resources, subjectExit: subjectExit(record), safety: record.safety }));
  const safe = !errors.length && state.children.every(record => record.result)
    && cleanupResourcesSafe(resources);
  for (const record of state.records) record.tracker.dispose();
  return { safe, taskSettled: state.taskSettled, errors, forcedSignals, resources,
    foreignProcessObjectsClosed: false, processTreeKillUsed: false };
}

async function main() {
  const { values } = parseArgs({ options: { output: { type: 'string' }, 'self-test': { type: 'boolean' } } });
  if (values['self-test']) return selfTest();
  assert.equal(process.platform, 'win32'); assert.equal(process.version, 'v25.6.0'); assert.equal(process.arch, 'x64');
  assert(!process.env.NODE_OPTIONS && !process.env.NODE_PATH, 'Remove Node injection variables');
  assert(values.output, 'Specify a fresh evidence directory');
  const output = path.resolve(values.output);
  await fs.mkdir(path.dirname(output), { recursive: true }); await fs.mkdir(output);
  const factory = await load('extensions/vscode/dev-session-canvas/src/panel/windowsExecutionOwnerFactory.ts');
  const { ExecutionOwnerLifecycle: Owner } = await load('extensions/vscode/dev-session-canvas/src/panel/executionOwnerLifecycle.ts');
  const { SerializedTerminalStateTracker: Tracker } = await load('extensions/vscode/dev-session-canvas/src/common/serializedTerminalState.ts');
  const original = factory.resolveWindowsExecutionProviderAssets(path.resolve('extensions/vscode/dev-session-canvas/dist'));
  const extensionRoot = path.join(output, 'extension');
  const dist = path.join(extensionRoot, 'dist');
  const native = path.join(dist, `native/windows-execution-candidate/win32-${process.arch}`);
  await fs.mkdir(path.join(native, 'conpty'), { recursive: true });
  for (const [source, target] of [[original.entryPoint, path.join(dist, 'windows-execution-provider.js')],
    [original.workerPath, path.join(dist, 'windows-execution-output-worker.js')],
    ...['conpty.node', 'manifest.json', 'conpty/conpty.dll', 'conpty/OpenConsole.exe'].map(file =>
      [path.join(path.dirname(original.binaryPath), file), path.join(native, file)])]) await fs.copyFile(source, target);
  const assets = factory.resolveWindowsExecutionProviderAssets(dist);
  const subjectPath = path.join(output, 'subject.mjs');
  const launcherPath = path.join(output, 'subject launcher.cmd');
  const observerPath = path.join(output, 'subject-observer.ps1');
  await fs.copyFile('scripts/test/fixtures/windows-execution-subject.mjs', subjectPath);
  await fs.copyFile('scripts/test/fixtures/windows-execution-launcher.cmd', launcherPath);
  await fs.copyFile('scripts/test/fixtures/windows-execution-observer.ps1', observerPath);
  const namespaceEntry = path.join(output, 'namespace.cjs');
  const built = await esbuild.build({ entryPoints: ['scripts/test/fixtures/windows-execution-namespace.ts'],
    bundle: true, format: 'cjs', platform: 'node', target: 'node25', outfile: namespaceEntry, metafile: true });
  for (const input of Object.keys(built.metafile.inputs)) inputs.set(input, hash(await fs.readFile(input)));
  for (const file of ['scripts/test/test-windows-execution-product.mjs', 'scripts/test/fixtures/windows-execution-subject.mjs',
    'scripts/test/fixtures/windows-execution-launcher.cmd', 'scripts/test/fixtures/windows-execution-observer.ps1',
    '.github/workflows/runtime-execution-windows.yml']) inputs.set(file, hash(await fs.readFile(file)));
  await json(path.join(output, 'schedule.json'), { cases: CASES, caseBudgetMs: CASE_MS, cleanupBudgetMs: CLEANUP_MS,
    subjectSafetyMs: 25000, subjectObserverMaximumMs: CASE_MS + CLEANUP_MS,
    interactionBudgetMs: 1500, maximumConcurrentExecutions: 2, numberedLines: 90000,
    platform: process.platform, arch: process.arch, release: os.release(), versions: process.versions,
    sourceCommit: process.env.GITHUB_SHA ?? null, executable: process.execPath, assets,
    manifest: JSON.parse(await fs.readFile(path.join(native, 'manifest.json'), 'utf8')),
    scope: 'Node product ConPTY provider and controlled cmd launcher/headless consumer; no real Agent/Host/Webview/Electron/packaged' });
  await json(path.join(output, 'sources.json'), Object.fromEntries(inputs));
  const results = [];
  for (const scenario of CASES) {
    const directory = path.join(output, scenario); await fs.mkdir(directory);
    const context = { directory, deadline: performance.now() + CASE_MS, factory, Owner, Tracker,
      extensionRoot, assets, subjectPath, launcherPath, observerPath, namespaceEntry, sealed: false,
      assertActive() { assert(!this.sealed && performance.now() < this.deadline, 'Fixed case acquisition is closed'); } };
    const state = { children: [], records: [], taskSettled: false };
    let first;
    try {
      const task = scenario === 'namespace' ? namespaceCase(context, state) : providerCase(context, state, scenario);
      void task.then(() => { state.taskSettled = true; }, () => { state.taskSettled = true; });
      first = { scenario, pass: true, value: await before(task, context.deadline, scenario) };
    } catch (error) { first = { scenario, pass: false, error: error.stack ?? String(error) }; }
    first = structuredClone(first);
    const cleaned = await cleanup(context, state);
    await json(path.join(directory, 'first.json'), first);
    await json(path.join(directory, 'cleanup.json'), cleaned);
    await json(path.join(directory, 'namespace.json'), state.children.map(record => ({ pid: record.child.pid,
      events: record.events, result: record.result, error: record.error, stderr: record.stderr })));
    for (const record of state.records) {
      await json(path.join(directory, `${record.key}-evidence.json`), { controls: record.controls, commands: record.commands,
        execution: record.execution.snapshot(), subject: record.subject, subjectExit: subjectExit(record),
        safety: record.safety, observer: record.observer ? { nonce: record.observer.nonce, bound: record.observer.bound,
          events: record.observer.events, result: record.observer.result, error: record.observer.error,
          stdout: record.observer.stdout, stderr: record.observer.stderr } : undefined, incomplete: record.incomplete });
      await fs.writeFile(path.join(directory, `${record.key}-frames.bin`), Buffer.concat(record.raw), { flag: 'wx' });
      await fs.writeFile(path.join(directory, `${record.key}-output.txt`), frames(record.raw).frames.map(frame => frame.text).join(''), { flag: 'wx' });
    }
    results.push({ scenario, pass: first.pass, cleanupSafe: cleaned.safe });
    console.log(JSON.stringify(results.at(-1)));
    if (!first.pass || !cleaned.safe) break;
  }
  const pass = results.length === CASES.length && results.every(result => result.pass && result.cleanupSafe);
  await json(path.join(output, 'report.json'), { pass, cases: CASES, results, unattempted: CASES.slice(results.length),
    hostWebviewElectronAgentEvidence: false });
  if (!pass) process.exitCode = 1;
}

await main();
