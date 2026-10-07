import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import path from 'node:path';

import esbuild from 'esbuild';

const { outputFiles } = await esbuild.build({
  entryPoints: {
    transport: path.resolve('extensions/vscode/dev-session-canvas/src/panel/executionProviderTransport.ts'),
    owner: path.resolve('extensions/vscode/dev-session-canvas/src/panel/executionOwnerLifecycle.ts'),
    protocol: path.resolve('extensions/vscode/dev-session-canvas/src/common/executionLifecycle.ts')
  },
  outdir: '/controlled-parent-cleanup-build',
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  write: false
});
const require = createRequire(import.meta.url);
const transportSource = outputFiles.find(file => path.basename(file.path) === 'transport.js').text;
const ownerSource = outputFiles.find(file => path.basename(file.path) === 'owner.js').text;
const ownerModule = { exports: {} };
new Function('require', 'module', 'exports', ownerSource)(require, ownerModule, ownerModule.exports);
const { ExecutionOwnerLifecycle } = ownerModule.exports;
const protocolModule = { exports: {} };
new Function('require', 'module', 'exports', outputFiles.find(file => path.basename(file.path) === 'protocol.js').text)(
  require, protocolModule, protocolModule.exports);
const { EXECUTION_CANDIDATE_BUDGETS } = protocolModule.exports;

function scheduler() {
  let now = 0;
  const tasks = [];
  const deadlines = new Set();
  return {
    now: () => now,
    scheduleTask: callback => { tasks.push(callback); },
    scheduleDeadline(deadline, callback) {
      const entry = { deadline, callback };
      deadlines.add(entry);
      return () => deadlines.delete(entry);
    },
    advanceTo(time, { runDeadlines = true } = {}) {
      assert.ok(time >= now);
      now = time;
      if (!runDeadlines) return;
      for (const entry of [...deadlines].sort((a, b) => a.deadline - b.deadline)) {
        if (entry.deadline <= now && deadlines.delete(entry)) entry.callback();
      }
    },
    runTask: () => tasks.shift()?.(),
    get taskCount() { return tasks.length; },
    get deadlineCount() { return deadlines.size; }
  };
}

async function flush(clock) {
  let idle = 0;
  for (let turn = 0; turn < 100; turn++) {
    const hadTask = clock.taskCount > 0;
    clock.runTask();
    await Promise.resolve();
    await Promise.resolve();
    idle = !hadTask && clock.taskCount === 0 ? idle + 1 : 0;
    if (idle === 8) return;
  }
  assert.fail('controlled parent cleanup continuations did not settle');
}

function harness(options = {}) {
  const clock = options.clock ?? scheduler();
  const identity = options.identity ?? { executionId: 'parent-cleanup', generation: 'binding-1' };
  const expectedNativeResourceIds = options.expectedNativeResourceIds ?? ['pty-master', 'pty-child', 'pty-source'];
  const child = new EventEmitter();
  const output = new EventEmitter();
  const stderr = new EventEmitter();
  const input = new EventEmitter();
  for (const stream of [output, stderr, input]) stream.destroy = () => stream.emit('close');
  input.end = () => {};
  child.connected = true;
  child.pid = 1234;
  child.stdio = [input, null, stderr, null, output];
  child.stdin = input;
  child.stderr = stderr;
  const signals = [];
  const messages = [];
  const events = [];
  let spawns = 0;
  const spawnOptions = [];
  child.kill = signal => {
    signals.push({ child, signal, at: clock.now() });
    options.onKill?.(signal);
    return true;
  };
  child.send = (message, callback) => { messages.push(message); callback(null); };
  const module = { exports: {} };
  // Only Node process/stream/time boundaries are substituted; cleanup runs in the real module.
  new Function('require', 'module', 'exports', 'process', 'setTimeout', 'clearTimeout', 'setImmediate', transportSource)(
    specifier => {
      if (specifier === 'node:child_process') return { spawn(_file, _args, config) { spawns++; spawnOptions.push(config); return child; } };
      if (specifier === 'node:perf_hooks') return { performance: { now: clock.now } };
      assert.equal(specifier, 'node:path');
      return require(specifier);
    }, module, module.exports, { platform: options.platform ?? 'linux', env: {} },
    (callback, milliseconds) => clock.scheduleDeadline(clock.now() + milliseconds, callback),
    cancel => cancel(), callback => clock.scheduleTask(callback)
  );
  const transport = module.exports.createExecutionProviderTransport({
    identity, executable: '/controlled/node', entryPoint: '/controlled/provider.js',
    ...(options.legacy ? {} : { parentCleanup: { scheduler: clock, expectedNativeResourceIds } })
  });
  const sink = {
    message: value => events.push(['message', value]),
    data: value => events.push(['data', value]),
    disconnected: reason => events.push(['disconnect', reason]),
    exited: () => events.push(['exit']),
    dataEnded: () => events.push(['data-end']),
    dataClosed: reason => events.push(['data-close', reason]),
    controlResourceResult: result => { events.push(['resource', result]); options.onResource?.(result); },
    startupFailed: reason => events.push(['startup-failed', reason]),
    transportFault: reason => { events.push(['fault', reason]); options.onFault?.(reason); },
    resourceAcquired: resource => events.push(['acquired', resource])
  };
  return {
    transport, clock, child, output, stderr, input, signals, messages, events, spawnOptions,
    get spawns() { return spawns; },
    connect() { transport.connect(sink); child.emit('spawn'); },
    release() {
      child.emit('exit', 0, null);
      child.connected = false;
      child.emit('disconnect');
      output.emit('end');
      output.emit('close');
      stderr.emit('close');
      input.emit('close');
      child.emit('close', 0, null);
    },
    resourceKinds: () => events.filter(([kind]) => kind === 'resource').map(([, result]) => result.kind)
  };
}

const tests = [];
const test = (name, run) => tests.push({ name, run });
const budget = canSignal => ({ termDeadline: 100, killDeadline: 200, canSignal });

test('the real scheduler rearms early timers and cancellation follows the current timer', () => {
  let now = 100.25;
  let nextId = 0;
  const timers = new Map();
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'setTimeout', 'clearTimeout', transportSource)(
    specifier => specifier === 'node:perf_hooks' ? { performance: { now: () => now } } : require(specifier),
    module, module.exports,
    (callback, delay) => {
      const id = ++nextId;
      timers.set(id, { callback, delay });
      return id;
    }, id => timers.delete(id)
  );
  const actual = module.exports.createNodeExecutionScheduler();
  const fire = time => {
    now = time;
    const [id, timer] = timers.entries().next().value;
    timers.delete(id);
    timer.callback();
  };
  let calls = 0;
  const cancel = actual.scheduleDeadline(113.9, () => { calls++; assert.ok(now >= 113.9); });
  fire(113.25);
  assert.equal(calls, 0, 'an early timer cannot consume the only deadline notification');
  assert.equal(timers.size, 1);
  fire(114.25);
  assert.equal(calls, 1);
  assert.equal(timers.size, 0);
  cancel();
  assert.equal(calls, 1);

  const cancelled = actual.scheduleDeadline(130.9, () => { calls++; });
  fire(130.25);
  assert.equal(timers.size, 1);
  cancelled();
  cancelled();
  assert.equal(timers.size, 0);
  assert.equal(calls, 1);
  actual.scheduleDeadline(120, () => { calls++; });
  fire(131.25);
  assert.equal(calls, 2, 'expired deadlines still run asynchronously once');
  assert.throws(() => actual.scheduleDeadline(NaN, () => {}), /Invalid observation deadline/);
});

test('a partial startup retains unknown facts but publishes the original owner deadline after an early timer', async () => {
  let now = 100.25;
  let nextId = 0;
  const timers = new Map();
  const tasks = [];
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'setTimeout', 'clearTimeout', 'setImmediate', transportSource)(
    specifier => specifier === 'node:perf_hooks' ? { performance: { now: () => now } } : require(specifier),
    module, module.exports,
    (callback, delay) => {
      const id = ++nextId;
      timers.set(id, { callback, at: now + delay });
      return id;
    }, id => timers.delete(id), callback => tasks.push(callback)
  );
  const actual = module.exports.createNodeExecutionScheduler();
  const continuations = { get taskCount() { return tasks.length; }, runTask: () => tasks.shift()?.() };
  const fireNext = time => {
    const [id, timer] = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    assert.ok(time >= now);
    now = time;
    timers.delete(id);
    timer.callback();
  };
  let sink;
  let identity;
  let finalFlushes = 0;
  const owner = new ExecutionOwnerLifecycle({
    kind: 'non-native',
    capabilities: ['execution-lifecycle-v1', 'execution-close-observation-v1', 'execution-parent-cleanup-v1'],
    scheduler: actual, budgets: EXECUTION_CANDIDATE_BUDGETS,
    createTransport(binding) {
      identity = binding;
      return {
        parentControl: Object.freeze({
          identity, scheduler: actual,
          expectedNativeResourceIds: Object.freeze(['pty-master', 'pty-child', 'pty-source', 'pty-creation']),
          closed: Promise.resolve({ kind: 'closed', exitCode: 0, signal: null }),
          terminate: () => assert.fail('partial startup cannot transfer unknown subject ownership')
        }),
        connect(value) {
          sink = value;
          sink.message({ type: 'ready', identity, capabilities: ['execution-lifecycle-v1'] });
        },
        send(message) {
          if (message.type === 'start') {
            for (const resourceId of ['pty-master', 'pty-creation']) {
              sink.message({ type: 'resourceAcquired', identity, resourceId });
            }
            sink.message({ type: 'operationObservation', identity, operationId: message.operationId,
              result: { kind: 'failed', stage: 'pty-create', reason: 'controlled partial startup' } });
          } else if (message.type === 'requestStop' || message.type === 'cancelOutput') {
            sink.message({ type: 'operationObservation', identity, operationId: message.operationId,
              result: { kind: 'accepted' } });
          }
          return Promise.resolve();
        }
      };
    }
  });
  const record = owner.reserve('partial-start-early-deadline');
  const start = record.start({ file: '/controlled/subject', args: [] }, {
    consume: async () => {}, flushFinal: async () => { finalFlushes++; return 0; }
  });
  assert.equal((await start.first).kind, 'failed');
  sink.message({ type: 'processResult', identity, result: { kind: 'unconfirmed', reason: 'no child acquired' } });
  sink.message({ type: 'sourceEnd', identity, finalFrameId: 0,
    disposition: { kind: 'unknown', reason: 'no source acquired' } });
  for (const resourceId of ['pty-master', 'pty-creation']) {
    sink.message({ type: 'resourceResult', identity, resourceId, operationId: `${resourceId}-release`,
      result: { kind: 'released' } });
  }
  sink.controlResourceResult({ kind: 'released' });
  await flush(continuations);
  const observation = record.snapshot().closeObservation;
  assert.equal(observation.trigger, 'failure');
  assert.equal(observation.startedAt, 100.25);
  assert.equal(observation.finishAt, 13100.25, 'the candidate failure budget remains 13 seconds');
  const first = record.requestStop('join-partial-start-observation');
  for (const at of [observation.forceAt, observation.cancelAt, observation.parentCleanup.at]) {
    fireNext(at);
    await flush(continuations);
  }
  assert.equal(timers.size, 1, 'only the original final deadline remains');
  fireNext(observation.finishAt - 0.25);
  await flush(continuations);
  assert.equal(record.snapshot().closeObservation.first, undefined);
  assert.equal(timers.size, 1, 'the early notification must be rearmed for this same owner');
  fireNext(observation.finishAt);
  await flush(continuations);
  assert.equal((await first).kind, 'unconfirmed');
  const snapshot = record.snapshot();
  assert.equal(snapshot.closeObservation.first.kind, 'unconfirmed');
  assert.equal(snapshot.closeObservation.finishAt, observation.finishAt);
  assert.equal(snapshot.adapter.process.kind, 'unconfirmed');
  assert.equal(snapshot.adapter.source.kind, 'unknown');
  assert.equal(snapshot.adapter.resources['pty-child'], undefined);
  assert.equal(snapshot.adapter.resources['pty-source'], undefined);
  for (const id of ['pty-master', 'pty-creation', 'provider-control']) {
    assert.equal(snapshot.adapter.resources[id].current.kind, 'released');
  }
  assert.equal(snapshot.terminal.kind, 'applied');
  assert.equal(finalFlushes, 1);
  assert.equal(snapshot.settled, false);
  record.settleReaders('lost');
  assert.equal(record.snapshot().retired, false);
  assert.ok(owner.snapshot().blockedReason);
  assert.equal(timers.size, 0);
});

test('Windows provider stdio explicitly uses overlapped pipes without changing IPC or direct-child ownership', () => {
  for (const platform of ['linux', 'darwin', 'win32']) {
    const h = harness({ platform });
    h.connect();
    assert.deepEqual(h.spawnOptions[0].stdio, platform === 'win32'
      ? ['overlapped', 'ignore', 'overlapped', 'ipc', 'overlapped'] : ['pipe', 'ignore', 'pipe', 'ipc', 'pipe']);
    assert.equal(h.spawnOptions[0].detached, false);
    assert.equal(h.spawnOptions[0].shell, false);
    h.release();
  }
});

test('the opt-in capability retains the original immutable binding without acquiring a child', () => {
  const identity = { executionId: 'original-control', generation: 'binding-1' };
  const ids = ['pty-master', 'pty-child', 'pty-source'];
  const h = harness({ identity, expectedNativeResourceIds: ids });
  const control = h.transport.parentControl;
  assert.ok(control);
  assert.equal(h.spawns, 0);
  assert.strictEqual(control.scheduler, h.clock);
  assert.strictEqual(control.closed, h.transport.closed);
  assert.deepEqual(control.identity, identity);
  assert.ok(Object.isFrozen(control));
  assert.ok(Object.isFrozen(control.identity));
  assert.ok(Object.isFrozen(control.expectedNativeResourceIds));
  identity.generation = 'mutated';
  ids[0] = 'mutated';
  assert.equal(control.identity.generation, 'binding-1');
  assert.equal(control.expectedNativeResourceIds[0], 'pty-master');
  assert.throws(() => control.terminate(budget(() => true)), /connected/);
  assert.equal(harness({ legacy: true }).transport.parentControl, undefined);
  for (const invalid of [[], Array(1), ['provider-control'], ['pty-master', 'pty-master'], ['INVALID']]) {
    assert.throws(() => harness({ expectedNativeResourceIds: invalid }));
  }
});

test('fixed budgets and the original guard make cleanup idempotent across synchronous reentry', async () => {
  let h;
  let first;
  const canSignal = () => true;
  const original = budget(canSignal);
  h = harness({ onKill() {
    assert.strictEqual(h.transport.parentControl.terminate(budget(canSignal)), first);
  } });
  h.connect();
  first = h.transport.parentControl.terminate(original);
  original.termDeadline = 1;
  original.killDeadline = 2;
  original.canSignal = () => false;
  assert.strictEqual(h.transport.parentControl.terminate(budget(canSignal)), first);
  assert.throws(() => h.transport.parentControl.terminate({ ...budget(canSignal), killDeadline: 201 }));
  assert.throws(() => h.transport.parentControl.terminate(budget(() => true)));
  assert.throws(() => h.transport.terminate({ termDeadline: 100, killDeadline: 200 }));
  await flush(h.clock);
  assert.deepEqual(h.signals.map(({ signal, at }) => [signal, at]), [['SIGTERM', 0]]);
  h.clock.advanceTo(100);
  await flush(h.clock);
  assert.deepEqual(h.signals.map(({ signal, at }) => [signal, at]), [['SIGTERM', 0], ['SIGKILL', 100]]);
  h.clock.advanceTo(200);
  assert.equal((await first).kind, 'unknown');
  assert.strictEqual(h.transport.parentControl.terminate(budget(canSignal)), first);
  assert.ok(h.signals.every(entry => entry.child === h.child));
  h.release();
  assert.equal((await h.transport.closed).kind, 'closed');
  assert.deepEqual(h.resourceKinds(), ['unknown', 'released']);
});

test('late entry and delayed callbacks skip expired signal stages without extending deadlines', async () => {
  for (const mode of ['late-term-entry', 'late-start-microtask', 'expired-entry', 'expired-microtask', 'expired-term-timer']) {
    const h = harness();
    h.connect();
    if (mode === 'late-term-entry') h.clock.advanceTo(100);
    if (mode === 'expired-entry') h.clock.advanceTo(200);
    const result = h.transport.parentControl.terminate(budget(() => true));
    if (mode === 'late-start-microtask') h.clock.advanceTo(150, { runDeadlines: false });
    if (mode === 'expired-microtask') h.clock.advanceTo(200, { runDeadlines: false });
    await flush(h.clock);
    h.clock.advanceTo(200);
    await flush(h.clock);
    assert.equal((await result).kind, 'unknown', mode);
    const expected = mode === 'expired-term-timer' ? ['SIGTERM']
      : mode.startsWith('late-') ? ['SIGKILL'] : [];
    assert.deepEqual(h.signals.map(entry => entry.signal), expected, mode);
    assert.equal(h.clock.deadlineCount, 0);
  }
});

test('revoked guards block upgrades and thrown guards freeze unknown before callbacks reenter', async () => {
  const h = harness();
  h.connect();
  let allowed = true;
  const first = h.transport.parentControl.terminate(budget(() => allowed));
  await flush(h.clock);
  allowed = false;
  h.clock.advanceTo(100);
  await flush(h.clock);
  assert.deepEqual(h.signals.map(entry => entry.signal), ['SIGTERM']);
  h.clock.advanceTo(200);
  assert.equal((await first).kind, 'unknown');

  let throwing;
  let failure;
  const throwingGuard = () => { throw new Error('guard-failed'); };
  throwing = harness({ onResource(result) {
    if (result.kind !== 'unknown') return;
    assert.strictEqual(throwing.transport.parentControl.terminate(budget(throwingGuard)), failure);
    throwing.release();
  } });
  throwing.connect();
  failure = throwing.transport.parentControl.terminate(budget(throwingGuard));
  await flush(throwing.clock);
  assert.equal((await failure).kind, 'unknown');
  assert.deepEqual(throwing.signals, []);
  assert.ok(throwing.events.some(([kind]) => kind === 'fault'));
  assert.deepEqual(throwing.resourceKinds(), ['unknown', 'released']);
  assert.equal((await throwing.transport.closed).kind, 'closed');
});

test('the observed release time controls first even when close notifications beat a late timer', async () => {
  for (const releasedAt of [199, 200, 201]) {
    const h = harness();
    h.connect();
    const first = h.transport.parentControl.terminate(budget(() => true));
    await flush(h.clock);
    h.clock.advanceTo(releasedAt, { runDeadlines: false });
    h.release();
    h.clock.advanceTo(201);
    assert.equal((await first).kind, releasedAt < 200 ? 'closed' : 'unknown', String(releasedAt));
    assert.equal((await h.transport.closed).kind, 'closed');
    assert.deepEqual(h.resourceKinds(), releasedAt < 200 ? ['released'] : ['unknown', 'released']);
    assert.deepEqual(h.signals.map(entry => entry.signal), ['SIGTERM']);
  }
});

test('cleanup called after a recorded release classifies its time without conflicting resource facts', async () => {
  for (const releasedAt of [199, 200]) {
    const h = harness();
    h.connect();
    h.clock.advanceTo(releasedAt);
    h.release();
    h.clock.advanceTo(201);
    const first = h.transport.parentControl.terminate(budget(() => true));
    assert.equal((await first).kind, releasedAt < 200 ? 'closed' : 'unknown');
    assert.deepEqual(h.resourceKinds(), ['released']);
    assert.deepEqual(h.signals, []);
  }
});

test('process exit and individual stream closures never substitute for the whole parent resource', async () => {
  const h = harness();
  h.connect();
  h.child.emit('exit', 0, null);
  h.child.connected = false;
  h.child.emit('disconnect');
  h.output.emit('end');
  h.output.emit('close');
  h.stderr.emit('close');
  h.child.emit('close', 0, null);
  const first = h.transport.parentControl.terminate(budget(() => true));
  await flush(h.clock);
  assert.equal(h.transport.snapshot().exited, true);
  assert.equal(h.transport.snapshot().closed, false);
  assert.deepEqual(h.resourceKinds(), []);
  h.clock.advanceTo(200);
  assert.equal((await first).kind, 'unknown');
  assert.deepEqual(h.signals, []);
  h.input.emit('close');
  assert.equal((await h.transport.closed).kind, 'closed');
  assert.deepEqual(h.resourceKinds(), ['unknown', 'released']);
});

test('ungated cleanup preserves the existing future-deadline and promise contract', async () => {
  for (const legacy of [true, false]) {
    const h = harness({ legacy });
    h.connect();
    assert.throws(() => h.transport.terminate({ termDeadline: 0, killDeadline: 200 }));
    const first = h.transport.terminate({ termDeadline: 100, killDeadline: 200 });
    assert.strictEqual(h.transport.terminate({ termDeadline: 100, killDeadline: 200 }), first);
    await flush(h.clock);
    assert.deepEqual(h.signals.map(entry => entry.signal), ['SIGTERM']);
    h.release();
    assert.equal((await first).kind, 'closed');
    assert.deepEqual(h.resourceKinds(), ['released']);
  }
});

test('the actual owner and adapter use the original parent control for an unstarted execution', async () => {
  const clock = scheduler();
  let h;
  let finalFlushes = 0;
  const owner = new ExecutionOwnerLifecycle({
    kind: 'non-native',
    capabilities: ['execution-lifecycle-v1', 'execution-close-observation-v1', 'execution-parent-cleanup-v1'],
    scheduler: clock,
    budgets: { startMs: 100, gracefulMs: 10, forceMs: 10, cancelMs: 10, settleMs: 30,
      naturalDrainMs: 10, parentTermMs: 10, parentKillMs: 10 },
    createTransport(identity) {
      h = harness({ identity, clock });
      return h.transport;
    }
  });
  const record = owner.reserve('original-execution');
  record.start({ file: '/controlled/subject', args: [] }, {
    consume: async () => {},
    flushFinal: async () => { finalFlushes++; return 1; }
  });
  const first = record.requestStop('controlled-close');
  record.settleReaders('cancelled');
  clock.advanceTo(40);
  await flush(clock);
  assert.equal(h.spawns, 1);
  assert.deepEqual(h.signals.map(entry => entry.signal), ['SIGTERM']);
  assert.strictEqual(h.signals[0].child, h.child);
  assert.deepEqual(h.messages, [], 'the unstarted claim must close queued startup and stop dispatch');
  h.release();
  await flush(clock);
  assert.equal((await first).kind, 'settled');
  assert.equal(record.snapshot().adapter.resources['provider-control'].current.kind, 'released');
  assert.equal(record.snapshot().adapter.process, undefined);
  assert.equal(record.snapshot().adapter.seal, undefined);
  assert.equal(finalFlushes, 0);
  assert.equal(owner.snapshot().pending, 0);
});

const failures = [];
for (const { name, run } of tests) {
  try { await run(); console.log(`PASS ${name}`); }
  catch (error) { failures.push(name); console.error(`FAIL ${name}`); console.error(error); }
}
assert.deepEqual(failures, [], `Failed parent control cases: ${failures.join('; ')}`);
console.log(`executionProvider parent control tests passed (${tests.length} cases; controlled Node boundaries, no real provider or PTY)`);
