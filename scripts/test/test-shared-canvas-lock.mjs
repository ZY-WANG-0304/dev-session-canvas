import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, rm, symlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { after, test } from 'node:test';
import { parseArgs } from 'node:util';
import esbuild from 'esbuild';

const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dsc-file-lock-')));
const bundle = path.join(directory, 'coordinator.cjs');
await esbuild.build({ entryPoints: ['extensions/vscode/dev-session-canvas/src/panel/sharedCanvasLock.ts'],
  bundle: true, platform: 'node', format: 'cjs', outfile: bundle });
const { SharedCanvasLocks, SharedCanvasLockError, SharedCanvasLockCleanupError } = createRequire(import.meta.url)(bundle);
const { values } = parseArgs({ options: { binary: { type: 'string' } } });
after(() => rm(directory, { recursive: true, force: true }));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
  return { promise, resolve, reject };
}

function backend(hooks = {}) {
  const handles = new Set();
  const owned = new Map();
  const calls = [];
  return { handles, calls,
    async open(filename) {
      calls.push(['open', filename]);
      await hooks.open?.(filename);
      const handle = { filename, closed: false };
      handles.add(handle);
      return handle;
    },
    async tryAcquire(handle) {
      assert(handles.has(handle) && !handle.closed);
      calls.push(['acquire', handle.filename]);
      const result = await hooks.acquire?.(handle);
      if (result !== undefined) return result;
      if (owned.has(handle.filename)) return 'busy';
      owned.set(handle.filename, handle);
      return 'acquired';
    },
    async close(handle) {
      calls.push(['close', handle.filename]);
      assert(!handle.closed);
      await hooks.close?.(handle);
      if (owned.get(handle.filename) === handle) owned.delete(handle.filename);
      handle.closed = true;
      handles.delete(handle);
    }
  };
}

async function fixture(name, hooks) {
  const root = path.join(directory, name);
  await mkdir(root);
  const native = backend(hooks);
  return { root, native, locks: new SharedCanvasLocks(native),
    resource: { canonicalSnapshotPath: path.join(root, 'canvas-state.json'), scope: 'admission' } };
}

const options = signal => ({ deadlineMs: performance.now() + 5000, signal });
const code = expected => error => error instanceof SharedCanvasLockError && error.code === expected;

test('same resource queues FIFO while different resources progress', { timeout: 10000 }, async () => {
  const { locks, resource, native } = await fixture('fifo');
  const entered = deferred();
  const finish = deferred();
  const order = [];
  const first = locks.withLock(resource, options(), async lease => {
    assert(Object.isFrozen(lease));
    order.push('first'); entered.resolve(); await finish.promise;
  });
  await entered.promise;
  const second = locks.withLock(resource, options(), async () => { order.push('second'); });
  const third = locks.withLock(resource, options(), async () => { order.push('third'); });
  await locks.withLock({ ...resource, scope: 'commit' }, options(), async () => { order.push('independent'); });
  assert.deepEqual(order, ['first', 'independent']);
  finish.resolve();
  await Promise.all([first, second, third]);
  assert.deepEqual(order, ['first', 'independent', 'second', 'third']);
  assert.equal(native.handles.size, 0);
});

test('queued cancellation and deadline do not open native handles or block successors', { timeout: 10000 }, async () => {
  const { locks, resource, native } = await fixture('queued');
  const entered = deferred();
  const finish = deferred();
  const first = locks.withLock(resource, options(), async () => { entered.resolve(); await finish.promise; });
  await entered.promise;
  const controller = new AbortController();
  const cancelled = locks.withLock(resource, options(controller.signal), async () => assert.fail('cancelled work'));
  const cancellation = assert.rejects(cancelled, code('cancelled'));
  controller.abort('queued cancellation');
  await cancellation;
  await assert.rejects(locks.withLock(resource, { deadlineMs: performance.now() + 20 }, async () => assert.fail('expired work')), code('timeout'));
  assert.equal(native.calls.filter(([operation]) => operation === 'open').length, 1);
  const successor = locks.withLock(resource, options(), async () => 'successor');
  finish.resolve();
  assert.equal(await successor, 'successor');
  await first;
});

test('cancelled in-flight open closes its late handle before rejection', { timeout: 10000 }, async () => {
  const opening = deferred();
  const allowOpen = deferred();
  const closing = deferred();
  const allowClose = deferred();
  const { locks, resource, native } = await fixture('late-open', {
    open: async () => { opening.resolve(); await allowOpen.promise; },
    close: async () => { closing.resolve(); await allowClose.promise; }
  });
  const controller = new AbortController();
  let settled = false;
  const operation = locks.withLock(resource, options(controller.signal), async () => assert.fail('late work'));
  const rejection = assert.rejects(operation, code('cancelled')).then(() => { settled = true; });
  await opening.promise;
  controller.abort(); allowOpen.resolve();
  await closing.promise;
  assert.equal(settled, false);
  assert.equal(native.calls.filter(([name]) => name === 'acquire').length, 0);
  allowClose.resolve();
  await rejection;
  assert.equal(native.handles.size, 0);
});

test('cancelled in-flight acquire does not deliver ownership and drains before the next owner', { timeout: 10000 }, async () => {
  const acquiring = deferred();
  const allowAcquire = deferred();
  let attempts = 0;
  const { locks, resource, native } = await fixture('late-acquire', {
    acquire: async () => { if (++attempts === 1) { acquiring.resolve(); await allowAcquire.promise; } }
  });
  const controller = new AbortController();
  const operation = locks.withLock(resource, options(controller.signal), async () => assert.fail('cancelled owner'));
  const rejection = assert.rejects(operation, code('cancelled'));
  await acquiring.promise;
  controller.abort();
  const successor = locks.withLock(resource, options(), async () => 'next');
  allowAcquire.resolve();
  await rejection;
  assert.equal(await successor, 'next');
  assert.deepEqual(native.calls.map(([name]) => name), ['open', 'acquire', 'close', 'open', 'acquire', 'close']);
});

test('deadline is checked after native success and its handle is closed', { timeout: 10000 }, async () => {
  let deadlineMs = performance.now() + 30;
  const { locks, resource, native } = await fixture('late-deadline', {
    acquire: async () => { await new Promise(resolve => setTimeout(resolve, Math.max(1, deadlineMs - performance.now() + 1))); }
  });
  deadlineMs = performance.now() + 30;
  await assert.rejects(locks.withLock(resource, { deadlineMs }, async () => assert.fail('expired delivery')), code('timeout'));
  assert.equal(native.handles.size, 0);
});

test('cancellation after work starts retains lock through business finally and native close', { timeout: 10000 }, async () => {
  const entered = deferred();
  const finish = deferred();
  const flushing = deferred();
  const flush = deferred();
  const closing = deferred();
  const close = deferred();
  let closes = 0;
  const { locks, resource, native } = await fixture('owned-cancel', {
    close: async () => { if (++closes === 1) { closing.resolve(); await close.promise; } }
  });
  const controller = new AbortController();
  let nextEntered = false;
  const operation = locks.withLock(resource, options(controller.signal), async () => {
    try { entered.resolve(); await finish.promise; }
    finally { flushing.resolve(); await flush.promise; }
    return 'finished';
  });
  await entered.promise;
  controller.abort();
  const successor = locks.withLock(resource, options(), async () => { nextEntered = true; });
  finish.resolve(); await flushing.promise;
  assert.equal(native.calls.filter(([name]) => name === 'close').length, 0);
  flush.resolve(); await closing.promise;
  assert.equal(nextEntered, false);
  close.resolve();
  assert.equal(await operation, 'finished');
  await successor;
});

test('busy retry retains one open handle and cancellation stops retrying', { timeout: 10000 }, async () => {
  const controller = new AbortController();
  let attempts = 0;
  const { locks, resource, native } = await fixture('busy', {
    acquire: async () => { if (++attempts === 3) controller.abort(); return 'busy'; }
  });
  await assert.rejects(locks.withLock(resource, options(controller.signal), async () => assert.fail('busy owner')), code('cancelled'));
  assert.equal(attempts, 3);
  assert.equal(native.calls.filter(([name]) => name === 'open').length, 1);
  assert.equal(native.handles.size, 0);
});

test('native failure does not masquerade as contention; cleanup preserves original work error', { timeout: 10000 }, async () => {
  const denied = new Error('permission denied');
  const first = await fixture('native-error', { acquire: async () => { throw denied; } });
  await assert.rejects(first.locks.withLock(first.resource, options(), async () => assert.fail('denied')),
    error => code('native-failure')(error) && error.cause === denied);
  assert.equal(first.native.handles.size, 0);
  const workError = new Error('work failed');
  const closeError = new Error('close failed');
  const second = await fixture('double-error', { close: async () => { throw closeError; } });
  await assert.rejects(second.locks.withLock(second.resource, options(), async () => { throw workError; }),
    error => error instanceof SharedCanvasLockCleanupError && error.cause === workError &&
      error.releaseError.code === 'release-failure' && error.releaseError.cause === closeError);
});

test('same-resource recursion and inverted order fail immediately without opening another handle', { timeout: 10000 }, async () => {
  const { locks, resource } = await fixture('order');
  await locks.withLock(resource, options(), async () => {
    await assert.rejects(locks.withLock(resource, options(), async () => {}), code('reentrant-use'));
    await locks.withLock({ ...resource, scope: 'node', nodeId: 'node' }, options(), async () => {
      await locks.withLock({ ...resource, scope: 'commit' }, options(), async () => {
        await assert.rejects(locks.withLock({ ...resource, scope: 'node', nodeId: 'another' }, options(), async () => {}), code('lock-order'));
      });
    });
  });
});

test('parallel siblings under one admission do not share node ownership', { timeout: 10000 }, async () => {
  const { locks, resource } = await fixture('siblings');
  await locks.withLock(resource, options(), async () => {
    const node = { ...resource, scope: 'node', nodeId: 'same-node' };
    let active = 0;
    await Promise.all(Array.from({ length: 10 }, () => locks.withLock(node, options(), async () => {
      assert.equal(++active, 1);
      await Promise.resolve();
      active--;
    })));
  });
});

test('opposite multi-root input order deduplicates and never deadlocks', { timeout: 10000 }, async () => {
  const first = await fixture('multi-a');
  const second = await fixture('multi-z');
  const paths = [first.resource.canonicalSnapshotPath, second.resource.canonicalSnapshotPath];
  const leaseOrders = [];
  await Promise.all([
    first.locks.withAdmissions([...paths, paths[0]], options(), async leases => { leaseOrders.push([...leases.keys()]); }),
    first.locks.withAdmissions([...paths].reverse(), options(), async leases => { leaseOrders.push([...leases.keys()]); })
  ]);
  assert.equal(leaseOrders[0].length, 2);
  assert.deepEqual(leaseOrders[0], leaseOrders[1]);
  assert.deepEqual(leaseOrders[0], [...leaseOrders[0]].sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right))));
});

test('empty admission batch runs once without opening a native handle', async () => {
  const native = backend();
  const locks = new SharedCanvasLocks(native);
  let calls = 0;
  assert.equal(await locks.withAdmissions([], options(), async leases => {
    calls++;
    assert.equal(leases.size, 0);
    return 'empty';
  }), 'empty');
  assert.equal(calls, 1);
  assert.deepEqual(native.calls, []);
});

test('cancelled empty admission batch never calls work', async () => {
  const controller = new AbortController();
  controller.abort('cancelled empty batch');
  const locks = new SharedCanvasLocks(backend());
  await assert.rejects(locks.withAdmissions([], options(controller.signal), async () => assert.fail('cancelled batch')), code('cancelled'));
});

test('expired or invalid empty admission batch never calls work', async () => {
  const locks = new SharedCanvasLocks(backend());
  await assert.rejects(locks.withAdmissions([], { deadlineMs: performance.now() - 1 }, async () => assert.fail('expired batch')), code('timeout'));
  await assert.rejects(locks.withAdmissions([], { deadlineMs: NaN }, async () => assert.fail('invalid batch')), code('invalid-resource'));
});

test('partial multi-root failure releases already-owned roots', { timeout: 10000 }, async () => {
  const first = await fixture('partial-a', {
    open: async filename => { if (filename.includes('partial-z')) throw new Error('second root unavailable'); }
  });
  const second = await fixture('partial-z');
  await assert.rejects(first.locks.withAdmissions([second.resource.canonicalSnapshotPath, first.resource.canonicalSnapshotPath],
    options(), async () => assert.fail('partial delivery')), code('native-failure'));
  assert.equal(first.native.handles.size, 0);
  await first.locks.withLock(first.resource, options(), async () => {});
});

test('bounded queue rejects excess requests and cancellation clears capacity', { timeout: 10000 }, async () => {
  const { locks, resource } = await fixture('bound');
  const entered = deferred();
  const finish = deferred();
  const holder = locks.withLock(resource, options(), async () => { entered.resolve(); await finish.promise; });
  await entered.promise;
  const controllers = Array.from({ length: 255 }, () => new AbortController());
  const rejected = controllers.map(controller => assert.rejects(locks.withLock(resource, options(controller.signal), async () => {}), code('cancelled')));
  await assert.rejects(locks.withLock(resource, options(), async () => {}), code('queue-full'));
  controllers.forEach(controller => controller.abort());
  await Promise.all(rejected);
  finish.resolve(); await holder;
  await locks.withLock(resource, options(), async () => {});
});

test('invalid path, expired request and symlink lock directory fail before native open', { timeout: 10000 }, async () => {
  const { locks, resource, native, root } = await fixture('invalid');
  await assert.rejects(locks.withLock({ ...resource, canonicalSnapshotPath: 'relative.json' }, options(), async () => {}), code('invalid-resource'));
  await assert.rejects(locks.withLock(resource, { deadlineMs: performance.now() - 1 }, async () => {}), code('timeout'));
  await assert.rejects(locks.withLock({ ...resource, scope: 'node' }, options(), async () => {}), code('invalid-resource'));
  const target = path.join(directory, 'symlink-target');
  await mkdir(target);
  await symlink(target, path.join(root, '.canvas-locks-v1'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(locks.withLock(resource, options(), async () => {}), code('invalid-resource'));
  assert.deepEqual(native.calls, []);
});

if (values.binary) {
  const native = createRequire(import.meta.url)(path.resolve(values.binary));
  test('real native backend serializes independent coordinators on one stable lock', { timeout: 10000 }, async () => {
    const { resource } = await fixture('native-coordinators');
    const entered = deferred();
    const finish = deferred();
    const busy = deferred();
    const first = new SharedCanvasLocks(native);
    const second = new SharedCanvasLocks({
      open: filename => native.open(filename),
      close: handle => native.close(handle),
      tryAcquire: async handle => {
        const result = await native.tryAcquire(handle);
        if (result === 'busy') busy.resolve();
        return result;
      }
    });
    let active = 0;
    const owner = first.withLock(resource, options(), async () => {
      assert.equal(++active, 1); entered.resolve();
      await finish.promise; active--;
    });
    await entered.promise;
    const contender = second.withLock(resource, options(), async () => {
      assert.equal(++active, 1); active--; return 'second';
    });
    try { await busy.promise; }
    finally { finish.resolve(); }
    await owner;
    assert.equal(await contender, 'second');
  });

  test('cancelled real native open is closed before coordinator rejects', { timeout: 10000 }, async () => {
    const { resource } = await fixture('native-cancellation');
    const opened = deferred();
    const deliver = deferred();
    let lateHandle;
    const locks = new SharedCanvasLocks({
      open: async filename => {
        lateHandle = await native.open(filename); opened.resolve();
        await deliver.promise; return lateHandle;
      },
      tryAcquire: handle => native.tryAcquire(handle),
      close: handle => native.close(handle)
    });
    const controller = new AbortController();
    const rejected = assert.rejects(locks.withLock(resource, options(controller.signal), async () => assert.fail('cancelled work')), code('cancelled'));
    await opened.promise;
    controller.abort(); deliver.resolve();
    await rejected;
    await assert.rejects(native.tryAcquire(lateHandle), { code: 'ERR_SHARED_CANVAS_LOCK_CLOSED' });
  });
}
