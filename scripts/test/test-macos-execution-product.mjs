import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync } from 'node:fs';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';
import esbuild from 'esbuild';
import yaml from 'js-yaml';

const CASES = ['namespace', 'normal', 'paused-stop', 'partial-create'];
const CASE_MS = 45000;
const CLEANUP_MS = 35000;
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

function normalizeNewlines(text) {
  return text.replace(/\r+\n/g, '\n');
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

async function load(file) {
  const filename = path.resolve(file);
  const built = await esbuild.build({ entryPoints: [filename], bundle: true, write: false, metafile: true,
    format: 'cjs', platform: 'node', target: 'node25', external: ['vscode', 'node-pty'] });
  for (const input of Object.keys(built.metafile.inputs)) inputs.set(input, hash(await fs.readFile(input)));
  const module = { exports: {} };
  new Function('require', 'module', 'exports', '__filename', '__dirname', built.outputFiles[0].text)(name => {
    assert.ok(name !== 'node-pty' && !name.endsWith('.node'), 'The test authority cannot load a PTY addon');
    return require(name);
  }, module, module.exports, filename, path.dirname(filename));
  return module.exports;
}

async function selfTest() {
  assert.equal(normalizeNewlines('A\r\nB\r\r\n\u4e2d'), 'A\nB\n\u4e2d');
  assert.notEqual(normalizeNewlines('A\nTAIL-MISSING'), 'A\nTAIL');
  const payload = Buffer.from(JSON.stringify({ frameId: 1, text: '\u4e2d' }));
  const size = Buffer.alloc(4); size.writeUInt32BE(payload.length);
  assert.deepEqual(frames([size, payload]).frames, [{ frameId: 1, text: '\u4e2d' }]);
  assert.equal(frames([size, payload.subarray(0, -1)]).incompleteBytes, size.length + payload.length - 1);
  const workflow = yaml.load(await fs.readFile('.github/workflows/runtime-execution-macos.yml', 'utf8'));
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch'],
    'The historical provider matrix remains manual; final production acceptance owns the affected package run.');
  assert.equal(Object.keys(workflow.jobs).length, 1);
  const job = workflow.jobs['product-provider'];
  assert.equal(job['runs-on'], 'macos-latest');
  assert.equal(job.strategy, undefined);
  assert.equal(job.steps.find(step => step.uses === 'actions/setup-node@v4').with['node-version'], '25.6.0');
  const commands = job.steps.map(step => step.run ?? '').join('\n');
  assert.match(commands, /node scripts\/test\/test-vscode-smoke-runner-env\.mjs/);
  assert.match(commands, /--execution-profile=macos-owner-v1-candidate/);
  assert.doesNotMatch(commands, /scripts\/diagnostics|DEEPSEEK|continue-on-error/);
  const cancel = [{ message: { type: 'cancelOutput', operationId: 'original-cancel' } }];
  const accepted = [{ message: { type: 'operationObservation', operationId: 'original-cancel', result: { kind: 'accepted' } } }];
  assert.equal(pausedOutputBoundary({ source: { kind: 'eof' } }, [], []), 'eof');
  assert.equal(pausedOutputBoundary({}, cancel, accepted), 'cancel-accepted');
  assert.equal(pausedOutputBoundary({ source: { kind: 'eof' } }, cancel, accepted), 'eof');
  for (const source of [undefined, { kind: 'unknown' }, { kind: 'interrupted' }]) {
    assert.equal(pausedOutputBoundary({ source }, [], []), undefined);
    assert.equal(pausedOutputBoundary({ source }, cancel,
      [{ message: { ...accepted[0].message, operationId: 'another-cancel' } }]), undefined);
  }
  const { SerializedTerminalStateTracker } = await load('extensions/vscode/dev-session-canvas/src/common/serializedTerminalState.ts');
  const tracker = new SerializedTerminalStateTracker(119, 41, { scrollback: 100 });
  const emptyTracker = new SerializedTerminalStateTracker(119, 41, { scrollback: 100 });
  const unconsumedTracker = new SerializedTerminalStateTracker(119, 41, { scrollback: 100 });
  const cleanupTracker = new SerializedTerminalStateTracker(119, 41, { scrollback: 100 });
  try {
    const identity = { executionId: 'self-test', generation: 'terminal-hooks' };
    const batch = (sequence, text) => ({ identity, sequence, frameId: sequence, text, byteLength: Buffer.byteLength(text) });
    const seal = lastDataSequence => ({ ...identity, lastDataSequence,
      source: { kind: 'eof', lastDataSequence }, process: { kind: 'exited', exitCode: 7 } });
    const state = { tracker, probe: { consumed: '' } };
    let resume;
    const gate = new Promise(resolve => { resume = resolve; });
    let paused = true;
    const hooks = createTerminalHooks(state, () => paused ? gate : undefined);
    const first = batch(1, '\u001b[3J\u001b[2J\u001b[HROOT\r\n');
    const pending = hooks.consume([first]);
    assert.equal(state.probe.consumed, '', 'Paused consumption must not enter the tracker.');
    paused = false; resume();
    await pending;
    assert.equal((await tracker.flush()).outputSequence, 1);
    const rest = [batch(2, '\u001b[3;5H\u001b[31m\u4e2d\u6587'), batch(3, '\u001b[0m\u001b[5;7H')];
    await hooks.consume(rest);
    assert.equal(state.probe.consumed, [first, ...rest].map(value => value.text).join(''));
    assert.equal(await hooks.flushFinal(seal(3)), 3);
    assertScreen(tracker);
    await assert.rejects(hooks.flushFinal(seal(4)), /match the final seal/);
    await assert.rejects(createTerminalHooks({ tracker: unconsumedTracker, probe: { consumed: '' } })
      .flushFinal(seal(1)), /match the final seal/);
    const emptyHooks = createTerminalHooks({ tracker: emptyTracker, probe: { consumed: '' } });
    await emptyHooks.consume([]);
    assert.equal(await emptyHooks.flushFinal(seal(0)), 0);
    assert.equal((await emptyTracker.flush()).outputSequence, 0);
    assert.equal(emptyTracker.terminal.buffer.active.cursorX, 0);
    assert.equal(emptyTracker.terminal.buffer.active.cursorY, 0);
    const cleanupSnapshot = { adapter: { pendingBytes: 16, pendingFrames: 16, seal: seal(17), resources: {} } };
    const cleanupState = { tracker: cleanupTracker, probe: { consumed: '' }, taskSettled: true, children: [],
      execution: { snapshot: () => cleanupSnapshot }, transport: { snapshot: () => ({ closed: true }) } };
    const cleanupHooks = createTerminalHooks(cleanupState);
    await cleanupHooks.consume([batch(1, 'READY\r\n')]);
    let draining;
    cleanupState.resume = () => {
      draining = (async () => {
        for (let sequence = 2; sequence <= 17; sequence++) await cleanupHooks.consume([batch(sequence, 'x')]);
        cleanupSnapshot.adapter.pendingBytes = 0;
        cleanupSnapshot.adapter.pendingFrames = 0;
        cleanupSnapshot.terminal = { kind: 'applied', finalRevision: await cleanupHooks.flushFinal(seal(17)) };
      })();
    };
    const cleanupResult = await cleanup({}, cleanupState);
    await draining;
    assert.equal(cleanupResult.safe, true);
    assert.equal(cleanupResult.consumptionSettled, true);
    assert.equal(cleanupSnapshot.terminal.finalRevision, 17, 'Scenario rejection must not dispose an in-flight terminal consumer.');
  } finally { tracker.dispose(); emptyTracker.dispose(); unconsumedTracker.dispose(); cleanupTracker.dispose(); }
  console.log('macOS product input self-test passed (no native loading, process claims or PTYs).');
}

function pausedOutputBoundary(adapter, commands, controls) {
  if (adapter.source?.kind === 'eof') return 'eof';
  const command = commands.find(event => event.message.type === 'cancelOutput')?.message;
  if (command && controls.some(event => event.message.type === 'operationObservation' &&
      event.message.operationId === command.operationId && event.message.result.kind === 'accepted')) {
    return 'cancel-accepted';
  }
  return undefined;
}

function createTerminalHooks(state, consumptionGate = () => undefined) {
  return {
    async consume(batches) {
      const gate = consumptionGate();
      if (gate) await gate;
      for (const batch of batches) {
        state.probe.consumed += batch.text;
        state.tracker.write(batch.text, { outputSequence: batch.sequence });
      }
      await state.tracker.flush();
    },
    async flushFinal(seal) {
      let final = await state.tracker.flush();
      if (seal.lastDataSequence === 0 && final.outputSequence === undefined) {
        state.tracker.markOutputSequence(0);
        final = await state.tracker.flush();
      }
      assert.equal(final.outputSequence, seal.lastDataSequence, 'The flushed terminal sequence must match the final seal.');
      return final.outputSequence;
    }
  };
}

function assertScreen(tracker) {
  const terminal = tracker.terminal;
  const buffer = terminal.buffer.active;
  assert.equal(terminal.cols, 119); assert.equal(terminal.rows, 41);
  assert.equal(buffer.cursorX, 6); assert.equal(buffer.cursorY, 4);
  assert.equal(buffer.getLine(buffer.baseY).translateToString(true), 'ROOT');
  assert.equal(buffer.getLine(buffer.baseY + 2).translateToString(true), '    \u4e2d\u6587');
  assert.equal(buffer.getLine(buffer.baseY + 2).getCell(4).getFgColor(), 1);
  assert.equal(buffer.getLine(buffer.baseY + 2).getCell(4).getWidth(), 2);
  return { cols: terminal.cols, rows: terminal.rows, cursorX: buffer.cursorX, cursorY: buffer.cursorY,
    rowsText: Array.from({ length: terminal.rows }, (_, row) => buffer.getLine(buffer.baseY + row)?.translateToString(true) ?? '') };
}

async function namespaceCase(context, state) {
  const storageDir = path.join(context.directory, 'storage');
  const launch = () => {
    context.assertActive();
    const child = spawn(process.execPath, [context.namespaceEntry, context.extensionRoot, storageDir],
      { stdio: ['ignore', 'ignore', 'pipe', 'ipc'], shell: false });
    const record = { child, events: [], stderr: '', result: undefined };
    state.children.push(record);
    child.on('message', event => record.events.push(event));
    child.on('error', error => { record.error = String(error); });
    child.stderr.on('data', bytes => { record.stderr += bytes.toString('utf8'); });
    child.on('close', (code, signal) => { record.result = { code, signal }; });
    return record;
  };
  const initial = launch();
  await until(() => initial.events.length || initial.result, context.deadline, 'initial namespace claim');
  assert.equal(initial.events[0]?.kind, 'claimed', JSON.stringify(initial.events));
  const competitor = launch();
  await until(() => competitor.result, context.deadline, 'namespace competitor rejected');
  assert.equal(competitor.events[0]?.kind, 'rejected');
  assert.match(competitor.events[0].error, /exclusive claim failed/);
  assert.deepEqual(competitor.result, { code: 2, signal: null });
  initial.child.send('release-by-exit');
  await until(() => initial.result, context.deadline, 'original namespace owner natural exit');
  assert.deepEqual(initial.result, { code: 0, signal: null });
  const next = launch();
  await until(() => next.events.length || next.result, context.deadline, 'namespace reacquired after exit');
  assert.equal(next.events[0]?.kind, 'claimed', JSON.stringify(next.events));
  assert.equal(next.events[0].dev, initial.events[0].dev);
  assert.equal(next.events[0].ino, initial.events[0].ino, 'The lock file must never be unlinked or replaced');
  next.child.send('release-by-exit');
  await until(() => next.result, context.deadline, 'successor namespace owner natural exit');
  assert.deepEqual(next.result, { code: 0, signal: null });
  return { sameLockInode: true, authorityProcesses: 3, ptySessions: 0 };
}

async function providerCase(context, state, scenario) {
  context.assertActive();
  const { factory, Owner, Tracker } = context;
  const options = factory.createMacosExecutionOwnerOptions({ extensionRoot: context.extensionRoot, mode: 'snapshot-only' });
  const raw = [];
  const controls = [];
  const commands = [];
  let rawBytes = 0;
  let incomplete = false;
  let paused = false;
  let releaseGate;
  const gate = new Promise(resolve => { releaseGate = resolve; });
  state.resume = () => { paused = false; releaseGate(); };
  state.tracker = new Tracker(107, 33, { scrollback: 100 });
  state.probe = { raw, controls, commands, output: () => frames(raw).frames.map(frame => frame.text).join(''),
    incomplete: () => incomplete, consumed: '' };
  const owner = state.owner = new Owner({ ...options, createTransport(identity) {
    context.assertActive();
    assert.equal(state.transport, undefined, 'At most one provider per fixed case');
    const transport = state.transport = options.createTransport(identity);
    const connect = transport.connect.bind(transport);
    const send = transport.send.bind(transport);
    transport.connect = sink => connect({ ...sink,
      message(message) {
        if (controls.length < 20000) controls.push({ at: performance.now(), message }); else incomplete = true;
        if (scenario === 'partial-create' && message.type === 'ready' && !context.sealed) {
          assert.equal(state.helperChanged, undefined, 'The helper failpoint is one-shot');
          chmodSync(context.assets.helperPath, 0o600);
          state.helperChanged = true;
        }
        sink.message(message);
      },
      data(bytes) {
        if (rawBytes + bytes.length <= 8 * 1024 * 1024) { raw.push(Buffer.from(bytes)); rawBytes += bytes.length; }
        else incomplete = true;
        sink.data(bytes);
      }
    });
    transport.send = message => {
      if (commands.length < 20000) commands.push({ at: performance.now(), message }); else incomplete = true;
      return send(message);
    };
    return transport;
  } });
  const execution = state.execution = owner.reserve(`macos-${scenario}`);
  const prefix = path.join(context.directory, 'subject');
  const start = execution.start({ file: process.execPath, args: [context.subjectPath, prefix], cwd: context.directory,
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: context.directory, TERM: 'xterm-256color', LANG: 'en_US.UTF-8' },
    cols: 107, rows: 33, stopStrategy: 'hangup' }, createTerminalHooks(state, () => paused ? gate : undefined));
  const started = await before(start.first, context.deadline, 'product start result');
  if (scenario === 'partial-create') {
    assert.equal(state.helperChanged, true);
    assert.equal(started.kind, 'failed');
    assert.equal(started.stage, 'pty-create');
    await before(state.transport.closed, context.deadline, 'failed creation provider closure');
    await until(() => execution.snapshot().closeObservation?.first, context.deadline, 'failed creation owner conclusion');
    const snapshot = execution.snapshot();
    assert.equal(snapshot.adapter.process.kind, 'unconfirmed');
    assert.equal(snapshot.adapter.source.kind, 'unknown');
    assert.equal(snapshot.adapter.resources['pty-child'], undefined);
    assert.equal(snapshot.adapter.resources['pty-source'], undefined);
    for (const id of ['pty-master', 'pty-creation', 'provider-control']) {
      assert.equal(snapshot.adapter.resources[id]?.current?.kind, 'released', id);
    }
    assert.equal(snapshot.closeObservation.first.kind, 'unconfirmed');
    assert.ok(owner.snapshot().blockedReason);
    assert.equal(state.probe.output(), '');
    return { expectedCreationFailure: true, acquiredSubject: false, authorityQuarantined: true, snapshot };
  }
  assert.equal(started.kind, 'started');
  await until(() => state.probe.output().includes('READY:107x33'), context.deadline, 'subject TTY READY');
  await until(() => execution.snapshot().adapter.consumedThrough === execution.snapshot().adapter.acceptedThrough,
    context.deadline, 'initial data consumed');
  const write = async data => {
    context.assertActive();
    const result = await before(execution.write(data, Math.min(context.deadline, performance.now() + 8000)).first,
      context.deadline, 'terminal input');
    assert.equal(result.kind, 'written');
    assert.equal(result.writtenBytes, Buffer.byteLength(data));
  };
  if (scenario === 'normal') {
    const nonce = randomBytes(16).toString('hex');
    await write(`nonce:${nonce}\n`);
    await until(() => state.probe.output().includes(`HASH:${hash(nonce)}`), context.deadline, 'actual nonce response');
    const resized = await before(execution.resize(119, 41, Math.min(context.deadline, performance.now() + 8000)).first,
      context.deadline, 'terminal resize');
    assert.equal(resized.kind, 'resized');
    state.tracker.resize(119, 41);
    await write('size\n');
    await until(() => state.probe.output().includes('SIZE:119x41'), context.deadline, 'actual PTY dimensions');
    await write('finish\n');
  } else {
    const consumed = execution.snapshot().adapter.consumedThrough;
    paused = true;
    await write('flood\n');
    await until(() => execution.snapshot().adapter.acceptedThrough - consumed >= 16, context.deadline, 'output credit exhausted');
    assert.equal(execution.snapshot().adapter.consumedThrough, consumed);
    void execution.requestStop('fixed paused macOS stop');
    await until(() => execution.snapshot().adapter.process?.kind === 'signaled' &&
      execution.snapshot().adapter.resources['pty-child']?.current?.kind === 'released',
    context.deadline, 'subject reaped while paused');
    assert.equal(execution.snapshot().adapter.consumedThrough, consumed);
    await until(() => pausedOutputBoundary(execution.snapshot().adapter, commands, controls),
      context.deadline, 'actual source EOF or original owner output cancellation accepted');
    state.resume();
  }
  await until(() => execution.snapshot().settled, context.deadline, 'product resources and terminal settlement');
  const snapshot = execution.snapshot();
  assert.equal(snapshot.adapter.firstFault, undefined);
  assert.equal(snapshot.adapter.resourceLedgerIncomplete, false);
  assert.equal(snapshot.terminal.kind, 'applied');
  assert.equal(snapshot.adapter.consumedThrough, snapshot.adapter.seal.lastDataSequence);
  assert.equal(snapshot.adapter.pendingBytes, 0);
  for (const id of ['provider-control', 'pty-master', 'pty-child', 'pty-source', 'pty-creation']) {
    assert.equal(snapshot.adapter.resources[id]?.current?.kind, 'released', id);
  }
  assert.equal(frames(raw).incompleteBytes, 0);
  assert.equal(state.probe.consumed, state.probe.output(), 'All received frames must reach actual parser consumption');
  execution.settleReaders('settled');
  if (scenario === 'normal') {
    assert.deepEqual(snapshot.adapter.process, { kind: 'exited', exitCode: 7 });
    assert.equal(snapshot.adapter.source.kind, 'eof');
    const written = await fs.readFile(`${prefix}-written.bin`);
    const receipt = JSON.parse(await fs.readFile(`${prefix}-complete.json`, 'utf8'));
    assert.equal(receipt.pid, started.pid);
    assert.equal(receipt.exitCode, 7); assert.equal(receipt.writtenBytes, written.length);
    const output = state.probe.output();
    assert.equal(normalizeNewlines(output), written.toString('utf8'), 'Complete source writes must survive Darwin newline translation');
    return { snapshot, receipt, sourceSha256: hash(written), observedSha256: hash(output),
      newlineAddedBytes: Buffer.byteLength(output) - written.length, screen: assertScreen(state.tracker) };
  }
  assert.deepEqual(snapshot.adapter.process, { kind: 'signaled', signal: 'SIGHUP' });
  if (snapshot.adapter.source.kind !== 'eof') {
    assert.equal(snapshot.adapter.source.kind, 'interrupted');
    assert.equal(pausedOutputBoundary(snapshot.adapter, commands, controls), 'cancel-accepted');
  }
  const cancelled = normalizeNewlines(state.probe.output());
  assert.match(cancelled, /^READY:107x33\nx+$/);
  assert.ok(cancelled.length <= 'READY:107x33\n'.length + 256 * 4096);
  const written = await fs.readFile(`${prefix}-written.bin`);
  return { snapshot, sourceEofClaim: snapshot.adapter.source.kind === 'eof', naturalTaskCompletionClaim: false,
    observedBytes: Buffer.byteLength(state.probe.output()),
    writerRecordedBytes: written.length, writerRecordedSha256: hash(written),
    allReceivedFramesConsumed: true, fullWriterDrainClaim: false,
    writerReceiptBoundary: 'A signal may interrupt a successful write before its audit append; no complete-write receipt is claimed.' };
}

async function cleanup(context, state) {
  context.sealed = true;
  const deadline = performance.now() + CLEANUP_MS;
  const errors = [];
  const forcedSignals = [];
  state.resume?.();
  if (state.helperChanged) {
    try { await fs.chmod(context.assets.helperPath, 0o755); }
    catch (error) { errors.push(`restore-helper: ${error}`); }
  }
  for (const record of state.children) {
    if (record.result) continue;
    if (record.child.connected) record.child.send('release-by-exit', () => {});
    try { await until(() => record.result, Math.min(deadline, performance.now() + 2000), 'namespace cleanup exit'); }
    catch {
      record.child.kill('SIGTERM'); forcedSignals.push({ pid: record.child.pid, signal: 'SIGTERM' });
      try { await until(() => record.result, Math.min(deadline, performance.now() + 2000), 'namespace cleanup TERM'); }
      catch { errors.push('Namespace child remains unconfirmed'); }
    }
  }
  if (state.execution && !state.transport?.snapshot().closed) {
    state.owner.closeAdmission(true);
    void state.execution.requestStop('macOS evidence cleanup').catch(error => errors.push(String(error)));
    try { await before(state.transport.closed, deadline, 'original provider cleanup'); }
    catch (error) { errors.push(String(error)); }
  }
  try { await until(() => state.taskSettled, deadline, 'fixed scenario task settled'); }
  catch (error) { errors.push(String(error)); }
  let consumptionSettled = !state.execution;
  if (state.execution) {
    try {
      await until(() => {
        const snapshot = state.execution.snapshot();
        return snapshot.adapter?.pendingBytes === 0 && snapshot.adapter.pendingFrames === 0 &&
          (!snapshot.adapter.seal || snapshot.terminal);
      }, deadline, 'accepted consumption and final terminal outcome before tracker disposal');
      consumptionSettled = true;
    } catch (error) { errors.push(String(error)); }
  }
  const resources = state.execution?.snapshot().adapter?.resources;
  const safe = errors.length === 0 && forcedSignals.length === 0 && state.children.every(record => record.result)
    && (!state.transport || state.transport.snapshot().closed)
    && (!resources || Object.values(resources).every(resource => resource.current?.kind === 'released'));
  if (consumptionSettled) state.tracker?.dispose();
  return { safe, taskSettled: state.taskSettled, consumptionSettled, errors, forcedSignals, resources,
    transport: state.transport?.snapshot() };
}

async function main() {
  const { values } = parseArgs({ options: { output: { type: 'string' }, 'self-test': { type: 'boolean' } } });
  if (values['self-test']) return selfTest();
  assert.equal(process.platform, 'darwin');
  assert.equal(process.version, 'v25.6.0');
  assert.ok(['arm64', 'x64'].includes(process.arch));
  assert.notEqual(process.getuid(), 0, 'The helper permission control requires an unprivileged runner');
  assert.ok(!process.env.NODE_OPTIONS && !process.env.NODE_PATH, 'Remove Node injection variables');
  assert.ok(values.output, 'Specify a fresh evidence directory');
  const output = path.resolve(values.output);
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.mkdir(output, { mode: 0o700 });
  const factory = await load('extensions/vscode/dev-session-canvas/src/panel/macosExecutionOwnerFactory.ts');
  const { ExecutionOwnerLifecycle: Owner } = await load('extensions/vscode/dev-session-canvas/src/panel/executionOwnerLifecycle.ts');
  const { SerializedTerminalStateTracker: Tracker } = await load('extensions/vscode/dev-session-canvas/src/common/serializedTerminalState.ts');
  const original = factory.resolveMacosExecutionProviderAssets(path.resolve('extensions/vscode/dev-session-canvas/dist'));
  const extensionRoot = path.join(output, 'extension');
  const dist = path.join(extensionRoot, 'dist');
  const native = path.join(dist, `native/macos-execution-candidate/darwin-${process.arch}`);
  await fs.mkdir(native, { recursive: true });
  for (const [source, target] of [[original.entryPoint, path.join(dist, 'macos-execution-provider.js')],
    [original.binaryPath, path.join(native, 'execution-owner.node')], [original.helperPath, path.join(native, 'spawn-helper')],
    [path.join(path.dirname(original.binaryPath), 'manifest.json'), path.join(native, 'manifest.json')]]) {
    await fs.copyFile(source, target);
  }
  await fs.chmod(path.join(native, 'spawn-helper'), 0o755);
  const assets = factory.resolveMacosExecutionProviderAssets(dist);
  const subjectPath = path.join(output, 'subject.mjs');
  await fs.copyFile('scripts/test/fixtures/macos-execution-subject.mjs', subjectPath);
  const namespaceEntry = path.join(output, 'namespace.cjs');
  const namespaceBuild = await esbuild.build({ entryPoints: ['scripts/test/fixtures/macos-execution-namespace.ts'],
    bundle: true, format: 'cjs', platform: 'node', target: 'node25', outfile: namespaceEntry, metafile: true });
  for (const input of Object.keys(namespaceBuild.metafile.inputs)) inputs.set(input, hash(await fs.readFile(input)));
  for (const file of ['scripts/test/test-macos-execution-product.mjs', 'scripts/test/fixtures/macos-execution-subject.mjs',
    '.github/workflows/runtime-execution-macos.yml']) inputs.set(file, hash(await fs.readFile(file)));
  await json(path.join(output, 'schedule.json'), { cases: CASES, caseBudgetMs: CASE_MS, cleanupBudgetMs: CLEANUP_MS,
    subjectSafetyMs: 25000, maximumProviders: 3, maximumSubjects: 2, namespaceProcesses: 3,
    platform: process.platform, arch: process.arch, release: os.release(), versions: process.versions,
    sourceCommit: process.env.GITHUB_SHA ?? null, executable: process.execPath, assets,
    manifest: JSON.parse(await fs.readFile(path.join(native, 'manifest.json'), 'utf8')),
    scope: 'Node product factory/Main/channel/owner/native PTY and headless parser; no Host/Webview/Electron/Agent/packaged' });
  await json(path.join(output, 'sources.json'), Object.fromEntries(inputs));
  const results = [];
  for (const scenario of CASES) {
    const directory = path.join(output, scenario);
    await fs.mkdir(directory, { mode: 0o700 });
    const context = { directory, deadline: performance.now() + CASE_MS, factory, Owner, Tracker,
      extensionRoot, assets, subjectPath, namespaceEntry, sealed: false,
      assertActive() { assert.ok(!this.sealed && performance.now() < this.deadline, 'Fixed case acquisition is closed'); } };
    const state = { children: [], taskSettled: false };
    let first;
    try {
      const task = scenario === 'namespace' ? namespaceCase(context, state) : providerCase(context, state, scenario);
      void task.then(() => { state.taskSettled = true; }, () => { state.taskSettled = true; });
      const value = await before(task, context.deadline, `whole ${scenario}`);
      assert.ok(!state.probe?.incomplete(), 'Fixed evidence capacity exceeded');
      first = { scenario, pass: true, value };
    } catch (error) { first = { scenario, pass: false, error: error.stack ?? String(error) }; }
    first = structuredClone(first);
    const cleaned = await cleanup(context, state);
    await json(path.join(directory, 'first.json'), first);
    await json(path.join(directory, 'cleanup.json'), cleaned);
    await json(path.join(directory, 'evidence.json'), { controls: state.probe?.controls, commands: state.probe?.commands,
      execution: state.execution?.snapshot(), namespace: state.children.map(record => ({ pid: record.child.pid,
        events: record.events, result: record.result, error: record.error, stderr: record.stderr })) });
    if (state.probe) {
      await fs.writeFile(path.join(directory, 'frames.bin'), Buffer.concat(state.probe.raw), { flag: 'wx' });
      await fs.writeFile(path.join(directory, 'output.txt'), state.probe.output(), { flag: 'wx' });
    }
    results.push({ scenario, pass: first.pass, cleanupSafe: cleaned.safe });
    console.log(JSON.stringify(results.at(-1)));
    if (!first.pass || !cleaned.safe) break;
  }
  const pass = results.length === CASES.length && results.every(result => result.pass && result.cleanupSafe);
  await json(path.join(output, 'report.json'), { pass, cases: CASES, results, unattempted: CASES.slice(results.length),
    nativeProviderCasesPassed: results.filter(result => result.scenario !== 'namespace' && result.pass).length,
    namespacePassed: results.some(result => result.scenario === 'namespace' && result.pass),
    hostWebviewElectronAgentEvidence: false });
  if (!pass) process.exitCode = 1;
}

await main();
