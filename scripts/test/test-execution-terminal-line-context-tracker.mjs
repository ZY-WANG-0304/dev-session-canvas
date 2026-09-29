import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import esbuild from 'esbuild';

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'dsc-execution-terminal-line-context-'));

try {
  const outfile = path.join(tempDir, 'executionTerminalLineContextTracker.cjs');
  await esbuild.build({
    entryPoints: [path.resolve('extensions/vscode/dev-session-canvas/src/panel/executionTerminalLineContextTracker.ts')],
    bundle: true,
    format: 'cjs',
    outfile,
    platform: 'node',
    target: 'node18'
  });

  const require = createRequire(import.meta.url);
  const { ExecutionTerminalLineContextTracker } = require(outfile);

  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => {
    warnings.push(args.map((arg) => (arg instanceof Error ? arg.stack ?? arg.message : String(arg))).join(' '));
  };

  try {
    for (let index = 0; index < 100; index += 1) {
      const tracker = new ExecutionTerminalLineContextTracker(80, 24, {
        cwd: '/tmp/dev-session-canvas',
        pathStyle: 'posix',
        initialOutput: 'boot\r\n'
      });

      tracker.write(`line-${index}\r\n`);
      tracker.recordInput('cd /tmp\r');
      tracker.dispose();

      await Promise.race([
        Promise.all([tracker.getCwdForBufferLine(0), tracker.setScrollback(5000)]),
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error('disposed tracker operations did not settle in time')), 200);
        })
      ]);
    }
  } finally {
    console.warn = originalWarn;
  }

  assert.deepEqual(warnings, []);

  const multilineTracker = new ExecutionTerminalLineContextTracker(20, 10, {
    cwd: '/repo',
    pathStyle: 'posix'
  });
  multilineTracker.write('ziyang@host:/repo$ ');
  multilineTracker.recordInput('cd /repo/subdir\r');
  multilineTracker.write('cd /repo/subdir\r\n');
  multilineTracker.write('ziyang@host:/repo/subdir$ ');
  multilineTracker.write("printf '%s\\n%s\\n' 'link-target.ts' '  2:8  export const two = 2;'\r\n");
  multilineTracker.write('link-target.ts\r\n  2:8  export const two = 2;\r\n');
  multilineTracker.write('ziyang@host:/repo/subdir$ ');

  await multilineTracker.getCwdForBufferLine(0);
  const bufferLines = readTrackerBufferLines(multilineTracker);
  const pathLineIndex = findLastBufferLineIndex(bufferLines, 'link-target.ts');
  const resultLineIndex = findLastBufferLineIndex(bufferLines, (line) => line.startsWith('  2:8'));
  assert.ok(pathLineIndex >= 0, 'expected multiline path line to be present in the buffer');
  assert.ok(resultLineIndex >= 0, 'expected multiline result line to be present in the buffer');
  assert.equal(await multilineTracker.getCwdForBufferLine(pathLineIndex), '/repo/subdir');
  assert.equal(await multilineTracker.getCwdForBufferLine(resultLineIndex), '/repo/subdir');
  multilineTracker.dispose();

  const smokeTracker = new ExecutionTerminalLineContextTracker(74, 24, {
    cwd: '/repo',
    pathStyle: 'posix'
  });
  smokeTracker.write('initialmoon@host dev-session-canvas % ');
  smokeTracker.recordInput('cd "/repo/.debug/vscode-smoke/execution-native-interactions"\r');
  smokeTracker.recordInput("printf '%s\\n%s\\n' 'link-target.ts' '  2:8  export const two = 2;'\r");
  smokeTracker.write(
    'c\bcd "/repo/.debug/vscode-smoke/execution-native-interactions"[?2004l\r\r\n' +
      '[1m[7m%[27m[1m[0m                                                                         \r \r\r' +
      '[0m[27m[24m[Jinitialmoon@host execution-native-interactions % [K[?2004h'
  );
  smokeTracker.write(
    "p\bprint \r[Kf\rf '%s\\n%s\\n' 'link-target.ts' '  2:8  export const two = 2;'[?2004l\r\r\n" +
      'link-target.ts\r\n  2:8  export const two = 2;\r\n' +
      '[1m[7m%[27m[1m[0m                                                                         \r \r\r' +
      '[0m[27m[24m[Jinitialmoon@host execution-native-interactions % [K[?2004h'
  );

  await smokeTracker.getCwdForBufferLine(0);
  const smokeBufferLines = readTrackerBufferLines(smokeTracker);
  const smokeResultLineIndex = findLastBufferLineIndex(smokeBufferLines, (line) => line.startsWith('  2:8'));
  assert.ok(smokeResultLineIndex >= 0, 'expected smoke multiline result line to be present in the buffer');
  assert.equal(
    await smokeTracker.getCwdForBufferLine(smokeResultLineIndex),
    '/repo/.debug/vscode-smoke/execution-native-interactions'
  );
  assert.equal(
    await smokeTracker.getCwdForBufferLine(smokeResultLineIndex + 2),
    '/repo/.debug/vscode-smoke/execution-native-interactions'
  );
  smokeTracker.dispose();

  const flushTracker = new ExecutionTerminalLineContextTracker(80, 24, {
    cwd: '/repo', pathStyle: 'posix'
  });
  const idleWaiters = observeDisposalWaiters(flushTracker);
  assert.equal(idleWaiters.size(), 0);
  await flushTracker.flush();
  assert.equal(idleWaiters.size(), 0, 'completed line-context consumption must not retain cancellation waiters.');
  for (let revision = 1; revision <= 32; revision++) {
    flushTracker.write(`consumed-${revision}\r\n`);
    await flushTracker.flush();
    assert.equal(idleWaiters.size(), 0, 'each completed parser/flush pair must release its own cancellation registrations.');
  }
  assert.ok(readTrackerBufferLines(flushTracker).includes('consumed-32'));
  const callbackReached = deferred();
  const releaseCallback = deferred();
  const originalWrite = flushTracker.terminal.write.bind(flushTracker.terminal);
  flushTracker.terminal.write = (data, callback) => originalWrite(data, () => {
    callbackReached.resolve();
    void releaseCallback.promise.then(() => callback?.());
  });
  flushTracker.write('before-resize\r\n');
  flushTracker.resize(40, 8);
  const scrollbackChanged = flushTracker.setScrollback(60);
  flushTracker.write('after-resize\r\n');
  let flushSettled = false;
  const flushed = flushTracker.flush().then(() => { flushSettled = true; });
  await callbackReached.promise;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(flushSettled, false, 'credit must wait for the real write callback, not queued input');
  assert.equal(idleWaiters.size(), 3, 'the active parser, scrollback wait and flush must retain independent cancellation waiters.');
  releaseCallback.resolve();
  await Promise.all([flushed, scrollbackChanged]);
  assert.equal(idleWaiters.size(), 0, 'completed parser work must release its cancellation waiter.');
  assert.equal(flushTracker.terminal.cols, 40);
  assert.equal(flushTracker.terminal.rows, 8);
  assert.equal(flushTracker.terminal.options.scrollback, 60);
  assert.ok(readTrackerBufferLines(flushTracker).includes('after-resize'));
  flushTracker.dispose();
  await assert.rejects(flushTracker.flush(), /disposed before output consumption completed/);
  assert.equal(idleWaiters.size(), 0);

  await verifyConcurrentWaiterCleanup(ExecutionTerminalLineContextTracker);

  const disposedFlushTracker = new ExecutionTerminalLineContextTracker(80, 24, {
    cwd: '/repo', pathStyle: 'posix'
  });
  const disposedWaiters = observeDisposalWaiters(disposedFlushTracker);
  const disposeCallbackReached = deferred();
  const disposedOriginalWrite = disposedFlushTracker.terminal.write.bind(disposedFlushTracker.terminal);
  let delayedDisposedCallback;
  disposedFlushTracker.terminal.write = (data, callback) => disposedOriginalWrite(data, () => {
    delayedDisposedCallback = callback;
    disposeCallbackReached.resolve();
  });
  disposedFlushTracker.write('parsed-but-not-credited\r\n');
  const cancelledFlush = assert.rejects(
    disposedFlushTracker.flush(), /disposed before output consumption completed/
  );
  const disposedLookup = disposedFlushTracker.getCwdForBufferLine(0);
  const disposedScrollback = disposedFlushTracker.setScrollback(1000);
  await disposeCallbackReached.promise;
  assert.equal(disposedWaiters.size(), 4, 'disposal must be able to wake the active parser, strict flush and both best-effort callers.');
  disposedFlushTracker.dispose();
  await Promise.all([cancelledFlush, disposedLookup, disposedScrollback]);
  assert.equal(disposedWaiters.size(), 0, 'dispose must wake and remove every cancellation waiter.');
  const frozenCwds = [...disposedFlushTracker.lineCwds];
  delayedDisposedCallback?.();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(disposedFlushTracker.lineCwds, frozenCwds, 'a late callback cannot apply line metadata after disposal.');
  assert.equal(disposedWaiters.size(), 0);
  await assert.rejects(disposedFlushTracker.flush(), /disposed before output consumption completed/);

  const failedTracker = new ExecutionTerminalLineContextTracker(80, 24, {
    cwd: '/repo', pathStyle: 'posix'
  });
  const expectedWriteError = new Error('controlled line context write failure');
  const failedWaiters = observeDisposalWaiters(failedTracker);
  failedTracker.terminal.write = () => { throw expectedWriteError; };
  failedTracker.write('failed-output\r\n');
  // The existing best-effort method still settles, but must not erase the failed consumption.
  await failedTracker.setScrollback(1000);
  await assert.rejects(failedTracker.flush(), error => error === expectedWriteError);
  await assert.rejects(failedTracker.flush(), error => error === expectedWriteError);
  assert.equal(failedWaiters.size(), 0, 'sticky operation failure must not retain completed cancellation waits.');
  failedTracker.dispose();

  const failedResizeTracker = new ExecutionTerminalLineContextTracker(80, 24, {
    cwd: '/repo', pathStyle: 'posix'
  });
  const expectedResizeError = new Error('controlled line context rebuild failure');
  const failedResizeWaiters = observeDisposalWaiters(failedResizeTracker);
  failedResizeTracker.createTerminal = () => { throw expectedResizeError; };
  failedResizeTracker.resize(40, 8);
  await assert.rejects(failedResizeTracker.flush(), error => error === expectedResizeError);
  assert.equal(failedResizeWaiters.size(), 0, 'rebuild failure must release its cancellation wait.');
  failedResizeTracker.dispose();

  const disposeDuringWriteTracker = new ExecutionTerminalLineContextTracker(80, 24, {
    cwd: '/repo', pathStyle: 'posix'
  });
  const disposeDuringWriteWaiters = observeDisposalWaiters(disposeDuringWriteTracker);
  disposeDuringWriteTracker.terminal.write = () => {
    disposeDuringWriteTracker.dispose();
    throw new Error('controlled synchronous write failure during disposal');
  };
  disposeDuringWriteTracker.write('dispose-during-write');
  await assert.rejects(disposeDuringWriteTracker.flush(), /disposed before output consumption completed/);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(disposeDuringWriteWaiters.size(), 0,
    'a synchronous write failure racing disposal must not leave a waiter or an unhandled rejection.');

  console.log('executionTerminalLineContextTracker tests passed');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

function readTrackerBufferLines(tracker) {
  const terminal = tracker.terminal ?? tracker['terminal'];
  const lines = [];
  for (let index = 0; index < terminal.buffer.active.length; index += 1) {
    const line = terminal.buffer.active.getLine(index);
    lines.push(line ? line.translateToString(true) : '');
  }
  return lines;
}

function deferred() {
  let resolve;
  const promise = new Promise(resolvePromise => { resolve = resolvePromise; });
  return { promise, resolve };
}

function findLastBufferLineIndex(lines, matcher) {
  const matches =
    typeof matcher === 'function' ? matcher : (line) => line === matcher;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (matches(lines[index])) {
      return index;
    }
  }

  return -1;
}

function observeDisposalWaiters(tracker) {
  const direct = tracker.disposalWaiters;
  if (direct instanceof Set) {
    return { size: () => direct.size };
  }

  // Baseline compatibility: count unresolved reactions attached to the old shared promise.
  const signal = tracker.disposedSignal;
  assert.ok(signal?.promise, 'tracker must expose a disposal signal in the baseline implementation.');
  const originalThen = signal.promise.then.bind(signal.promise);
  let pending = 0;
  signal.promise.then = (onFulfilled, onRejected) => {
    pending += 1;
    return originalThen(
      value => { pending -= 1; return onFulfilled ? onFulfilled(value) : value; },
      error => { pending -= 1; if (onRejected) return onRejected(error); throw error; }
    );
  };
  return { size: () => pending };
}

async function verifyConcurrentWaiterCleanup(Tracker) {
  const tracker = new Tracker(80, 24, { cwd: '/repo', pathStyle: 'posix' });
  const waiters = observeDisposalWaiters(tracker);
  const callbacks = [];
  const write = tracker.terminal.write.bind(tracker.terminal);
  tracker.terminal.write = (data, callback) => write(data, () => { callbacks.push(callback); });
  let firstSettled = false;
  let secondSettled = false;
  let lookupSettled = false;
  try {
    tracker.write('first-independent-wait\r\n');
    const first = tracker.flush().then(() => { firstSettled = true; });
    tracker.write('second-independent-wait\r\n');
    const second = tracker.flush().then(() => { secondSettled = true; });
    const lookup = tracker.getCwdForBufferLine(0).then(cwd => { lookupSettled = true; return cwd; });
    await waitFor(() => callbacks.length === 1, 'first real parser callback');
    assert.equal(waiters.size(), 4, 'three independent callers and the active parser must each remain cancellable.');
    assert.equal(firstSettled || secondSettled || lookupSettled, false);
    callbacks[0]();
    await first;
    await waitFor(() => callbacks.length === 2, 'second real parser callback');
    assert.equal(waiters.size(), 3, 'the first completion must remove only its own waits.');
    assert.equal(secondSettled || lookupSettled, false, 'one completed caller cannot acknowledge later parser work.');
    callbacks[1]();
    await second;
    assert.equal(await lookup, '/repo');
    assert.equal(waiters.size(), 0);
    assert.ok(readTrackerBufferLines(tracker).includes('second-independent-wait'));
  } finally { tracker.dispose(); for (const callback of callbacks) callback?.(); }
}

async function waitFor(condition, label) {
  for (let turn = 0; turn < 100 && !condition(); turn++) {
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  assert.ok(condition(), `Timed out waiting for ${label}.`);
}
