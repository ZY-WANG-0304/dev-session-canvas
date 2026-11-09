import assert from 'node:assert/strict';
import { fork, spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import { buildSharedCanvasLock } from '../build/build-shared-canvas-lock.mjs';
import { captureProcessIdentity, readLinuxProcess, signalOriginalProcess } from './runtime-release-processes.mjs';

const require = createRequire(import.meta.url);
const script = fileURLToPath(import.meta.url);
const { values } = parseArgs({ options: {
  binary: { type: 'string' }, headers: { type: 'string' }, compiler: { type: 'string' },
  'node-lib': { type: 'string' }, 'delay-load-hook': { type: 'string' },
  child: { type: 'string' }, directory: { type: 'string' }
} });

async function acquire(native, handle) {
  const deadline = Date.now() + 10000;
  while (await native.tryAcquire(handle) === 'busy') {
    assert(Date.now() < deadline, 'Native lock acquisition timed out');
    await delay(2);
  }
}

async function childMain(mode, binary, directory) {
  const native = require(binary);
  const filename = path.join(directory, 'commit.lock');
  if (mode === 'counter') {
    for (let iteration = 0; iteration < 30; iteration++) {
      const handle = await native.open(filename);
      try {
        await acquire(native, handle);
        const counter = path.join(directory, 'counter');
        const current = Number(fs.readFileSync(counter, 'utf8'));
        await delay(1);
        fs.writeFileSync(counter, String(current + 1));
      } finally { await native.close(handle); }
    }
    process.send({ done: true });
    process.disconnect();
    return;
  }
  if (mode === 'close-error') {
    const handle = await native.open(filename);
    await acquire(native, handle);
    const descriptors = fs.readdirSync('/proc/self/fd').filter(entry => {
      try { return fs.readlinkSync(`/proc/self/fd/${entry}`) === filename; } catch { return false; }
    });
    assert.equal(descriptors.length, 1);
    fs.closeSync(Number(descriptors[0]));
    const closing = native.close(handle);
    assert.equal(native.close(handle), closing);
    let firstError;
    await assert.rejects(closing, error => {
      firstError = error;
      assert.deepEqual(error.release, { unlock: 'failed', fileClose: 'failed', directoryClose: 'succeeded' });
      assert.equal(error.nativeCode, os.constants.errno.EBADF);
      return error.syscall === 'flock(LOCK_UN)' && error.cleanupErrors.some(item => item.syscall === 'close(file)');
    });
    const other = await native.open(path.join(directory, 'replacement.lock'));
    await assert.rejects(native.close(handle), error => error === firstError);
    await acquire(native, other);
    await native.close(other);
    process.send({ done: true });
    process.disconnect();
    return;
  }
  const handle = await native.open(filename);
  await acquire(native, handle);
  if (mode === 'inherit') {
    const descendant = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', detached: true });
    await once(descendant, 'spawn');
    descendant.unref();
    process.send({ held: true, descendant: descendant.pid });
  } else process.send({ held: true });
  if (mode === 'exit-held') {
    process.disconnect();
    return;
  }
  process.on('message', async message => {
    if (message === 'release') {
      await native.close(handle);
      process.send({ released: true });
      process.disconnect();
    }
  });
}

async function workerMain() {
  const native = require(workerData.binary);
  const filename = path.join(workerData.directory, 'commit.lock');
  if (workerData.mode === 'pending') {
    for (let index = 0; index < 64; index++) native.open(path.join(workerData.directory, `pending-${index}.lock`)).catch(() => {});
    parentPort.postMessage({ pending: true });
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
  } else {
    const handle = await native.open(filename);
    await acquire(native, handle);
    parentPort.postMessage({ held: true, clonedHandle: handle });
    parentPort.on('message', () => {});
  }
}

async function buildAndTest() {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'shared-canvas-native-build-')));
  let runner;
  let done;
  try {
    const runtimeHeaders = path.resolve(path.dirname(process.execPath), '..', 'include', 'node');
    const cachedHeaders = path.join(os.homedir(), '.cache', 'node-gyp', process.versions.node, 'include', 'node');
    const { binary } = buildSharedCanvasLock({
      output: directory, headers: values.headers ?? (fs.existsSync(path.join(cachedHeaders, 'node_api.h'))
        ? cachedHeaders : runtimeHeaders),
      compiler: values.compiler, nodeLib: values['node-lib'], delayLoadHook: values['delay-load-hook']
    });
    runner = spawn(process.execPath, [...process.execArgv, script, '--binary', binary], { stdio: 'inherit' });
    done = once(runner, 'exit');
    const [code, signal] = await done;
    assert.equal(code, 0, `Native lock test runner exited with code=${code} signal=${signal}`);
  } finally {
    if (runner && runner.exitCode === null && runner.signalCode === null) {
      runner.kill('SIGKILL');
      await done;
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

async function main() {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'shared-canvas-native-test-')));
  fs.chmodSync(directory, 0o700);
  const children = new Set();
  const workers = new Set();
  const descendants = new Set();
  const handles = new Set();
  let native;
  let completed = 0;
  let primaryFailure;
  let summary;
  const stopFixtures = async () => {
    const activeChildren = [...children];
    const settled = await Promise.allSettled([
      ...activeChildren.map(async child => { child.kill('SIGKILL'); }),
      ...[...descendants].map(identity => signalOriginalProcess(identity, 'SIGKILL')),
      ...activeChildren.map(child => child.done),
      ...[...workers].map(async worker => worker.terminate())
    ]);
    const failures = settled.filter(result => result.status === 'rejected').map(result => result.reason);
    if (failures.length) throw new AggregateError(failures, 'Isolated fixture cleanup failed; refusing unverified PID signals');
  };
  const watchdog = setTimeout(async () => {
    console.error('Native lock tests timed out; terminating isolated fixtures');
    try { await stopFixtures(); }
    finally { fs.rmSync(directory, { recursive: true, force: true }); process.exit(1); }
  }, 90000);
  const start = (mode, binary, location = directory) => {
    const child = fork(script, ['--child', mode, '--binary', binary, '--directory', location], {
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'], execArgv: []
    });
    children.add(child);
    child.done = once(child, 'exit');
    child.once('exit', () => children.delete(child));
    return child;
  };
  const exited = async child => {
    const [code, signal] = await child.done;
    assert.equal(code, 0, `Child exited with code=${code} signal=${signal}`);
  };
  const check = async (label, work) => {
    await work();
    console.log(`PASS ${label}`);
    completed++;
  };
  const open = async filename => {
    const handle = await native.open(filename);
    handles.add(handle);
    return handle;
  };
  const close = async handle => { await native.close(handle); handles.delete(handle); };
  try {
    const binary = fs.realpathSync(values.binary);
    native = require(binary);
    const filename = path.join(directory, 'commit.lock');
    await check('opaque handles, Promise errors, independent opens and idempotent close', async () => {
      for (const invalid of [undefined, 1, {}, null, 'handle']) {
        await assert.rejects(native.tryAcquire(invalid), { code: 'ERR_SHARED_CANVAS_LOCK_HANDLE' });
        await assert.rejects(native.close(invalid), { code: 'ERR_SHARED_CANVAS_LOCK_HANDLE' });
      }
      const owner = await open(filename);
      assert.deepEqual(Reflect.ownKeys(owner), []);
      assert(Object.isFrozen(owner));
      await assert.rejects(native.tryAcquire(structuredClone(owner)), { code: 'ERR_SHARED_CANVAS_LOCK_HANDLE' });
      const contender = await open(filename);
      const acquisition = native.tryAcquire(owner);
      await assert.rejects(native.tryAcquire(owner), { code: 'ERR_SHARED_CANVAS_LOCK_REQUEST_PENDING' });
      assert.equal(await acquisition, 'acquired');
      await assert.rejects(native.tryAcquire(owner), { code: 'ERR_SHARED_CANVAS_LOCK_ALREADY_ACQUIRED' });
      assert.equal(await native.tryAcquire(contender), 'busy');
      const identity = fs.statSync(filename);
      const closing = native.close(owner);
      assert.equal(native.close(owner), closing);
      await closing;
      handles.delete(owner);
      await assert.rejects(native.tryAcquire(owner), { code: 'ERR_SHARED_CANVAS_LOCK_CLOSED' });
      assert.equal(await native.tryAcquire(contender), 'acquired');
      await close(contender);
      assert.equal(fs.statSync(filename).ino, identity.ino);
    });
    await check('close waits for the earlier acquisition and preserves the stable file', async () => {
      const handle = await open(filename);
      const acquiring = native.tryAcquire(handle);
      const closing = native.close(handle);
      assert.equal(await acquiring, 'acquired');
      await closing;
      handles.delete(handle);
      const next = await open(filename);
      assert.equal(await native.tryAcquire(next), 'acquired');
      await close(next);
    });
    await check('bounded admission with reserved capacity for release', async () => {
      const owner = await open(filename);
      const opening = Array.from({ length: 256 }, (_, index) => native.open(path.join(directory, `bounded-${index}.lock`)));
      const overflow = native.open(path.join(directory, 'overflow.lock'));
      await assert.rejects(overflow, { code: 'ERR_SHARED_CANVAS_LOCK_QUEUE_FULL' });
      await close(owner);
      for (const handle of await Promise.all(opening)) await native.close(handle);
      const retained = [];
      for (let index = 0; index < 512; index++) retained.push(await open(filename));
      await assert.rejects(native.open(filename), { code: 'ERR_SHARED_CANVAS_LOCK_HANDLE_LIMIT' });
      await Promise.all(retained.map(close));
    });
    await check('invalid paths and unsafe file types fail closed', async () => {
      for (const invalid of ['', 'relative.lock', `${filename}\0suffix`, undefined, 7]) await assert.rejects(native.open(invalid));
      const nonempty = path.join(directory, 'nonempty.lock');
      fs.writeFileSync(nonempty, 'do not truncate', { mode: 0o600 });
      await assert.rejects(native.open(nonempty));
      assert.equal(fs.readFileSync(nonempty, 'utf8'), 'do not truncate');
      await assert.rejects(native.open(directory));
      if (process.platform !== 'win32') {
        const insecure = path.join(directory, 'insecure');
        fs.mkdirSync(insecure, { mode: 0o755 });
        await assert.rejects(native.open(path.join(insecure, 'lock')));
        const link = path.join(directory, 'symlink.lock');
        fs.symlinkSync(filename, link);
        await assert.rejects(native.open(link));
        const alias = path.join(directory, 'alias');
        fs.symlinkSync(directory, alias);
        await assert.rejects(native.open(path.join(alias, 'commit.lock')));
        const hardlink = path.join(directory, 'hardlink.lock');
        fs.linkSync(filename, hardlink);
        await assert.rejects(native.open(filename));
        fs.unlinkSync(hardlink);
        fs.chmodSync(filename, 0o644);
        await assert.rejects(native.open(filename));
        fs.chmodSync(filename, 0o600);
        const fifo = path.join(directory, 'fifo.lock');
        const created = spawnSync('mkfifo', ['-m', '600', fifo], { encoding: 'utf8' });
        assert.equal(created.status, 0, created.stderr);
        await assert.rejects(native.open(fifo));
        const changed = await open(filename);
        const previous = path.join(directory, 'previous.lock');
        fs.renameSync(filename, previous);
        fs.writeFileSync(filename, '', { mode: 0o600 });
        await assert.rejects(native.tryAcquire(changed), { code: 'ERR_SHARED_CANVAS_LOCK_PATH' });
        await close(changed);
      }
    });
    await check('real multiprocess contention and explicit release', async () => {
      const child = start('hold', binary);
      const [message] = await once(child, 'message');
      assert(message.held);
      const contender = await open(filename);
      assert.equal(await native.tryAcquire(contender), 'busy');
      child.send('release');
      await exited(child);
      assert.equal(await native.tryAcquire(contender), 'acquired');
      await close(contender);
    });
    if (process.platform !== 'win32') await check('already-retired handles do not enqueue unbounded close requests', async () => {
      const retired = [];
      const target = path.join(directory, 'retire.lock');
      for (let index = 0; index < 256; index++) {
        const handle = await open(target);
        fs.chmodSync(target, 0o644);
        await assert.rejects(native.tryAcquire(handle), { code: 'ERR_SHARED_CANVAS_LOCK_PATH' });
        fs.chmodSync(target, 0o600);
        retired.push(handle);
      }
      const closing = retired.map(close);
      const live = await open(filename);
      await Promise.all(closing);
      await acquire(native, live);
      await close(live);
    });
    await check('four independent processes serialize read/modify/write', async () => {
      fs.writeFileSync(path.join(directory, 'counter'), '0');
      await Promise.all(Array.from({ length: 4 }, () => exited(start('counter', binary))));
      assert.equal(fs.readFileSync(path.join(directory, 'counter'), 'utf8'), '120');
    });
    await check('natural environment exit releases an unclosed acquired handle', async () => {
      await exited(start('exit-held', binary));
      const handle = await open(filename);
      await acquire(native, handle);
      await close(handle);
    });
    await check('worker environment isolation and forced teardown release', async () => {
      const worker = new Worker(new URL(import.meta.url), { execArgv: [], workerData: { binary, directory, mode: 'hold' } });
      workers.add(worker);
      const [message] = await once(worker, 'message');
      assert(message.held);
      await assert.rejects(native.tryAcquire(message.clonedHandle), { code: 'ERR_SHARED_CANVAS_LOCK_HANDLE' });
      const contender = await open(filename);
      assert.equal(await native.tryAcquire(contender), 'busy');
      await worker.terminate();
      workers.delete(worker);
      assert.equal(await native.tryAcquire(contender), 'acquired');
      await close(contender);
    });
    await check('environment teardown settles queued and undelivered opens', async () => {
      for (let iteration = 0; iteration < 8; iteration++) {
        const worker = new Worker(new URL(import.meta.url), { execArgv: [], workerData: { binary, directory, mode: 'pending' } });
        workers.add(worker);
        await once(worker, 'message');
        await worker.terminate();
        workers.delete(worker);
      }
      if (process.platform === 'linux') {
        const leaked = fs.readdirSync('/proc/self/fd').some(entry => {
          try { return fs.readlinkSync(`/proc/self/fd/${entry}`).startsWith(path.join(directory, 'pending-')); } catch { return false; }
        });
        assert.equal(leaked, false, 'Terminated environments leaked open descriptors');
      }
    });
    if (process.platform === 'linux') {
      await check('SIGSTOP preserves exclusion; SIGKILL releases without unlink', async () => {
        const child = start('hold', binary);
        await once(child, 'message');
        const identity = await captureProcessIdentity(child.pid);
        assert(await signalOriginalProcess(identity, 'SIGSTOP'), 'Fixture exited before SIGSTOP');
        const deadline = performance.now() + 5000;
        for (;;) {
          const current = await readLinuxProcess(identity.pid);
          assert.equal(current?.startTicks, identity.startTicks, 'Fixture changed while observing SIGSTOP');
          if (['T', 't'].includes(current.state)) break;
          assert(!['Z', 'X'].includes(current.state), 'Fixture exited before entering the stopped state');
          assert(performance.now() < deadline, 'Timed out observing the fixture stopped state');
          await delay(5);
        }
        const contender = await open(filename);
        assert.equal(await native.tryAcquire(contender), 'busy');
        child.kill('SIGKILL');
        await child.done;
        await acquire(native, contender);
        await close(contender);
      });
    }
    if (process.platform === 'linux') {
      await check('exec child cannot retain a crashed parent lock', async () => {
        const child = start('inherit', binary);
        const [message] = await once(child, 'message');
        const parent = await captureProcessIdentity(child.pid);
        const before = await readLinuxProcess(message.descendant);
        assert(before && before.parentPid === parent.pid, 'Descendant does not belong to the fixture parent');
        const identity = await captureProcessIdentity(message.descendant);
        const after = await readLinuxProcess(identity.pid);
        assert.equal(identity.startTicks, before.startTicks, 'Descendant changed while capturing identity');
        assert.equal(after?.startTicks, identity.startTicks, 'Descendant changed after capturing identity');
        assert.equal(after.parentPid, parent.pid, 'Descendant parent changed while capturing identity');
        assert.equal((await readLinuxProcess(parent.pid))?.startTicks, parent.startTicks, 'Fixture parent changed during capture');
        descendants.add(identity);
        child.kill('SIGKILL');
        await child.done;
        const surviving = await readLinuxProcess(identity.pid);
        assert.equal(surviving?.startTicks, identity.startTicks, 'Original descendant did not survive its parent');
        assert(!['Z', 'X'].includes(surviving.state), 'Original descendant exited before the lock check');
        const contender = await open(filename);
        await acquire(native, contender);
        await close(contender);
        await signalOriginalProcess(identity, 'SIGKILL');
        descendants.delete(identity);
      });
    }
    if (process.platform === 'linux') await check('unlock and close failures are both preserved; no descriptor retry', async () => {
      await exited(start('close-error', binary));
    });
    if (global.gc) await check('GC fallback closes an unreachable handle asynchronously', async () => {
      await (async () => { const forgotten = await native.open(filename); await acquire(native, forgotten); })();
      const contender = await open(filename);
      let acquired = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        global.gc();
        await delay(5);
        if (await native.tryAcquire(contender) === 'acquired') { acquired = true; break; }
      }
      assert(acquired, 'GC did not release an unreachable handle');
      await close(contender);
    });
    summary = { passed: completed, platform: process.platform, arch: process.arch,
      runtime: process.version, productValidated: false,
      skipped: [...(global.gc ? [] : ['GC fallback (run with --expose-gc)']),
        ...(process.platform === 'linux' ? [] : ['exec-child inheritance (requires Linux process identity)',
          'SIGSTOP exclusion (requires observed Linux stopped state)'])],
      unverified: ['other platforms', 'VS Code/VSIX/Remote loading', 'fork without successful exec',
        'network filesystems', 'Darwin close(EINTR) descriptor state', 'injected EINTR',
        ...(process.platform === 'linux' ? [] : ['non-Linux exec-child inheritance', 'non-Linux SIGSTOP exclusion'])] };
  } catch (error) {
    primaryFailure = error;
  } finally {
    const cleanupFailures = [];
    try { await stopFixtures(); } catch (error) { cleanupFailures.push(error); }
    if (native) {
      const released = await Promise.allSettled([...handles].map(async handle => native.close(handle)));
      cleanupFailures.push(...released.filter(result => result.status === 'rejected').map(result => result.reason));
    }
    try { fs.rmSync(directory, { recursive: true, force: true }); } catch (error) { cleanupFailures.push(error); }
    clearTimeout(watchdog);
    if (primaryFailure !== undefined) {
      if (cleanupFailures.length) console.error(new AggregateError(cleanupFailures, 'Additional native lock test cleanup failures'));
      throw primaryFailure;
    }
    if (cleanupFailures.length) throw new AggregateError(cleanupFailures, 'Native lock test cleanup failed');
  }
  console.log(JSON.stringify(summary));
}

if (!isMainThread) await workerMain();
else if (values.child) await childMain(values.child, values.binary, values.directory);
else if (!values.binary) await buildAndTest();
else await main();
