import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import esbuild from 'esbuild';

const directory = await mkdtemp(path.join(os.tmpdir(), 'dsc-root-preparation-'));
const bundle = path.join(directory, 'preparation.cjs');
await esbuild.build({ stdin: { contents: `
  export * from './extensions/vscode/dev-session-canvas/src/panel/sharedCanvasRootPreparation';
  export { SharedRootCanvasStore } from './extensions/vscode/dev-session-canvas/src/panel/sharedRootCanvasStore';`,
  resolveDir: process.cwd(), sourcefile: 'root-preparation-test.ts' },
  bundle: true, platform: 'node', format: 'cjs', outfile: bundle });
const { SharedCanvasRootPreparations, SharedCanvasRootPreparationError, SharedCanvasRootReleaseError, SharedRootCanvasStore } = createRequire(import.meta.url)(bundle);
after(() => rm(directory, { recursive: true, force: true }));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((complete, fail) => { resolve = complete; reject = fail; });
  return { promise, resolve, reject };
}

const code = expected => error => error instanceof SharedCanvasRootPreparationError && error.code === expected;
const never = () => assert.fail('Work must remain blocked');
const resource = (release = async () => {}) => ({ value: 'prepared-store', release });

test('unknown, forged, foreign and unprepared tickets cannot run business', async () => {
  const roots = new SharedCanvasRootPreparations();
  const ticket = roots.register(directory);
  assert.equal(roots.phase(ticket), 'unprepared');
  assert.equal(roots.isReady(ticket), false);
  assert(Object.isFrozen(ticket));
  assert.equal(roots.register(directory), ticket);
  await assert.rejects(roots.withReady(ticket, never), code('unprepared'));
  for (const candidate of [{ root: directory }, { ...ticket }, new SharedCanvasRootPreparations().register(directory)]) {
    await assert.rejects(roots.withReady(candidate, never), code('unknown-ticket'));
    assert.equal(roots.isReady(candidate), false);
  }
  assert.throws(() => roots.register('relative-root'), code('invalid-root'));
  await roots.close();
});

test('prepare is single-flight and waits for the whole preparation before business', async () => {
  const roots = new SharedCanvasRootPreparations();
  const ticket = roots.register(directory);
  const stages = [];
  const registered = deferred();
  const firstSave = deferred();
  const entered = deferred();
  const preparing = roots.prepare(ticket, async context => {
    assert(context.isCurrent());
    stages.push('load');
    entered.resolve();
    await registered.promise;
    stages.push('registered-reread');
    await firstSave.promise;
    stages.push('first-save');
    return resource();
  });
  assert.equal(roots.prepare(ticket, never), preparing);
  const work = roots.withReady(ticket, async value => { stages.push('work'); return value; });
  await entered.promise;
  assert.equal(roots.phase(ticket), 'preparing');
  assert.deepEqual(stages, ['load']);
  registered.resolve();
  await Promise.resolve();
  assert.deepEqual(stages, ['load', 'registered-reread']);
  firstSave.resolve();
  assert.equal(await work, 'prepared-store');
  assert(roots.isReady(ticket));
  assert.deepEqual(stages, ['load', 'registered-reread', 'first-save', 'work']);
  await roots.close();
});

test('preparation failure is sticky and preserves its original cause', async () => {
  const roots = new SharedCanvasRootPreparations();
  const ticket = roots.register(directory);
  const failed = new Error('strict snapshot read failed');
  let context;
  const preparing = roots.prepare(ticket, async current => { context = current; throw failed; });
  await assert.rejects(preparing, error => error === failed);
  assert.equal(roots.phase(ticket), 'failed');
  assert.equal(context.isCurrent(), false);
  assert(context.signal.aborted);
  assert.equal(context.signal.reason, failed);
  assert.equal(roots.prepare(ticket, never), preparing);
  await assert.rejects(roots.withReady(ticket, never), error => error === failed);
  await roots.close();
});

test('retiring before preparation begins does not invoke the factory', async () => {
  const roots = new SharedCanvasRootPreparations();
  const ticket = roots.register(directory);
  const preparing = roots.prepare(ticket, never);
  const retiring = roots.retire(ticket);
  await assert.rejects(preparing, code('retired'));
  await retiring;
  assert.equal(roots.isReady(ticket), false);
  await roots.close();
});

test('late resource after retirement is released, never delivered, and prevents early re-registration', { timeout: 5000 }, async () => {
  const roots = new SharedCanvasRootPreparations();
  const ticket = roots.register(directory);
  const factory = deferred();
  const entered = deferred();
  const released = deferred();
  const finishRelease = deferred();
  let context;
  let releaseCount = 0;
  const preparing = roots.prepare(ticket, async current => { context = current; entered.resolve(); return factory.promise; });
  const waiting = assert.rejects(roots.withReady(ticket, never), code('retired'));
  await entered.promise;
  const retiring = roots.retire(ticket);
  assert.equal(roots.retire(ticket), retiring);
  assert.equal(context.isCurrent(), false);
  assert(context.signal.aborted);
  assert.throws(() => roots.register(directory), code('retired'));
  factory.resolve(resource(async () => { releaseCount++; released.resolve(); await finishRelease.promise; }));
  await assert.rejects(preparing, code('retired'));
  await waiting;
  await released.promise;
  assert.throws(() => roots.register(directory), code('retired'));
  finishRelease.resolve();
  await retiring;
  assert.equal(releaseCount, 1);
  const replacement = roots.register(directory);
  assert.notEqual(replacement.generation, ticket.generation);
  await roots.prepare(replacement, async () => resource());
  await assert.rejects(roots.withReady(ticket, never), code('retired'));
  assert.equal(context.isCurrent(), false);
  assert.equal(await roots.withReady(replacement, async value => value), 'prepared-store');
  await roots.close();
});

test('retirement drains all admitted business, even failures, before releasing', { timeout: 5000 }, async () => {
  const roots = new SharedCanvasRootPreparations();
  const ticket = roots.register(directory);
  const firstEntered = deferred();
  const secondEntered = deferred();
  const firstFinish = deferred();
  const secondFinish = deferred();
  let released = false;
  await roots.prepare(ticket, async () => resource(async () => { released = true; }));
  const failure = new Error('business failure');
  const first = roots.withReady(ticket, async (_value, context) => {
    firstEntered.resolve();
    await firstFinish.promise;
    assert.equal(context.isCurrent(), false);
    assert.equal(released, false);
    throw failure;
  });
  const firstRejected = assert.rejects(first, error => error === failure);
  const second = roots.withReady(ticket, async () => { secondEntered.resolve(); await secondFinish.promise; });
  await Promise.all([firstEntered.promise, secondEntered.promise]);
  const retiring = roots.retire(ticket);
  await assert.rejects(roots.withReady(ticket, never), code('retired'));
  firstFinish.resolve();
  await firstRejected;
  assert.equal(released, false);
  secondFinish.resolve();
  await second;
  await retiring;
  assert.equal(released, true);
  await roots.close();
});

test('ready waiter cannot enter after same-turn retirement', async () => {
  const roots = new SharedCanvasRootPreparations();
  const ticket = roots.register(directory);
  await roots.prepare(ticket, async () => resource());
  const waiting = roots.withReady(ticket, never);
  const retiring = roots.retire(ticket);
  await assert.rejects(waiting, code('retired'));
  await retiring;
  await roots.close();
});

test('cleanup failure is stable, never retries release, and prevents re-registration', async () => {
  const roots = new SharedCanvasRootPreparations();
  const ticket = roots.register(directory);
  const failure = new Error('dispose unconfirmed');
  let releases = 0;
  await roots.prepare(ticket, async () => resource(async () => { releases++; throw failure; }));
  const retiring = roots.retire(ticket);
  await assert.rejects(retiring, error => error === failure);
  assert.equal(roots.retire(ticket), retiring);
  assert.equal(releases, 1);
  assert.throws(() => roots.register(directory), code('retired'));
  await assert.rejects(roots.close(), error => error instanceof SharedCanvasRootReleaseError && error.errors[0] === failure);
});

test('close cancels every root synchronously and settles all cleanup failures', async () => {
  const roots = new SharedCanvasRootPreparations();
  const failures = [new Error('first release failed'), new Error('second release failed')];
  const contexts = [];
  const tickets = [];
  for (const [index, failure] of failures.entries()) {
    const ticket = roots.register(path.join(directory, String(index)));
    tickets.push(ticket);
    await roots.prepare(ticket, async context => { contexts.push(context); return resource(async () => { throw failure; }); });
  }
  const closing = roots.close();
  assert.equal(roots.close(), closing);
  assert(contexts.every(context => context.signal.aborted && !context.isCurrent()));
  assert(tickets.every(ticket => !roots.isReady(ticket)));
  assert.throws(() => roots.register(directory), code('closed'));
  await assert.rejects(closing, error => error instanceof SharedCanvasRootReleaseError &&
    error.errors.length === 2 && error.errors.every((failure, index) => failure === failures[index]));
});

test('unprepared close does not invoke resource cleanup and permanently closes admission', async () => {
  const roots = new SharedCanvasRootPreparations();
  const ticket = roots.register(directory);
  await roots.close();
  assert.equal(roots.phase(ticket), 'failed');
  assert.throws(() => roots.prepare(ticket, never), code('retired'));
  await assert.rejects(roots.withReady(ticket, never), code('retired'));
});

test('preparation and business cannot await their own drain', async () => {
  const roots = new SharedCanvasRootPreparations();
  const ticket = roots.register(directory);
  await roots.prepare(ticket, async () => {
    assert.throws(() => roots.retire(ticket), code('self-drain'));
    assert.throws(() => roots.close(), code('self-drain'));
    return resource();
  });
  await roots.withReady(ticket, async () => {
    assert.throws(() => roots.retire(ticket), code('self-drain'));
    assert.throws(() => roots.close(), code('self-drain'));
  });
  assert(roots.isReady(ticket));
  await roots.close();
});

test('independent roots progress while another preparation is blocked', async () => {
  const roots = new SharedCanvasRootPreparations();
  const waiting = roots.register(directory);
  const independent = roots.register(path.join(directory, 'independent'));
  const barrier = deferred();
  const pending = roots.prepare(waiting, async () => { await barrier.promise; return resource(); });
  await roots.prepare(independent, async () => resource());
  assert.equal(await roots.withReady(independent, async value => value), 'prepared-store');
  assert.equal(roots.phase(waiting), 'preparing');
  barrier.resolve();
  await pending;
  await roots.close();
});

test('late preparation rejection drains without inventing a resource to release', async () => {
  const roots = new SharedCanvasRootPreparations();
  const ticket = roots.register(directory);
  const entered = deferred();
  const factory = deferred();
  const failure = new Error('cancelled I/O failed');
  const preparing = roots.prepare(ticket, async () => { entered.resolve(); return factory.promise; });
  const rejected = assert.rejects(preparing, error => error === failure);
  await entered.promise;
  const retiring = roots.retire(ticket);
  factory.reject(failure);
  await rejected;
  await retiring;
  assert.notEqual(roots.register(directory), ticket);
  await roots.close();
});

test('late resource cleanup failure is reported separately from preparation cancellation', async () => {
  const roots = new SharedCanvasRootPreparations();
  const ticket = roots.register(directory);
  const entered = deferred();
  const factory = deferred();
  const failure = new Error('late resource release failed');
  const preparing = roots.prepare(ticket, async () => { entered.resolve(); return factory.promise; });
  const rejected = assert.rejects(preparing, code('retired'));
  await entered.promise;
  const retiring = roots.retire(ticket);
  const releaseRejected = assert.rejects(retiring, error => error === failure);
  factory.resolve(resource(async () => { throw failure; }));
  await Promise.all([rejected, releaseRejected]);
  assert.throws(() => roots.register(directory), code('retired'));
  await assert.rejects(roots.close(), error => error instanceof SharedCanvasRootReleaseError && error.errors[0] === failure);
});

test('abort callbacks can re-enter retirement without reopening admission', async () => {
  const roots = new SharedCanvasRootPreparations();
  const ticket = roots.register(directory);
  let nestedRetiring;
  await roots.prepare(ticket, async context => {
    context.signal.addEventListener('abort', () => {
      assert.equal(context.isCurrent(), false);
      assert.throws(() => roots.register(directory), code('retired'));
      nestedRetiring = roots.retire(ticket);
    });
    return resource();
  });
  const retiring = roots.retire(ticket);
  assert.equal(nestedRetiring, retiring);
  await retiring;
  await roots.close();
});

test('release cannot await its own retirement or global close', async () => {
  const roots = new SharedCanvasRootPreparations();
  const ticket = roots.register(directory);
  await roots.prepare(ticket, async () => resource(async () => {
    assert.throws(() => roots.retire(ticket), code('self-drain'));
    assert.throws(() => roots.close(), code('self-drain'));
  }));
  await roots.close();
});

test('factory cannot recursively prepare itself or wait for its own ready', async () => {
  const roots = new SharedCanvasRootPreparations();
  const ticket = roots.register(directory);
  await roots.prepare(ticket, async () => {
    assert.throws(() => roots.prepare(ticket, never), code('self-prepare'));
    await assert.rejects(roots.withReady(ticket, never), code('self-prepare'));
    return resource();
  });
  await roots.withReady(ticket, async () => {
    await roots.prepare(ticket, never);
    assert.equal(await roots.withReady(ticket, async value => value), 'prepared-store');
  });
  await roots.close();
});

test('uncaught self-prepare rejection fails closed and still permits external retirement', async () => {
  const roots = new SharedCanvasRootPreparations();
  const ticket = roots.register(directory);
  await assert.rejects(roots.prepare(ticket, async () => roots.withReady(ticket, never)), code('self-prepare'));
  assert.equal(roots.phase(ticket), 'failed');
  await roots.close();
});

test('two independent preparations wrap real legacy stores without changing admission or persistence', { timeout: 15000 }, async () => {
  const first = new SharedCanvasRootPreparations();
  const second = new SharedCanvasRootPreparations();
  const firstTicket = first.register(directory);
  const secondTicket = second.register(directory);
  const filename = path.join(directory, 'canvas-state.json');
  const initial = { version: 1, updatedAt: '', nodes: [], edges: [], groups: [], nextGroupSequence: 1 };
  const errors = [];
  let releaseCount = 0;
  const prepare = async () => {
    const store = new SharedRootCanvasStore(filename, initial, () => {}, error => errors.push(error));
    try {
      await store.ready;
      await store.publish(initial);
      return { value: store, release: async () => { releaseCount++; store.dispose(); } };
    } catch (error) {
      store.dispose();
      throw error;
    }
  };
  try {
    await first.prepare(firstTicket, prepare);
    await second.prepare(secondTicket, prepare);
    await Promise.all([
      first.withReady(firstTicket, store => store.mutate('node-fixture', async current => {
        await store.publish({ ...current, nextGroupSequence: current.nextGroupSequence + 1 });
      })),
      second.withReady(secondTicket, store => store.mutate('node-fixture', async current => {
        await store.publish({ ...current, nextGroupSequence: current.nextGroupSequence + 1 });
      }))
    ]);
    const persisted = JSON.parse(await readFile(filename, 'utf8'));
    assert.equal(persisted.version, 1);
    assert.equal(persisted.state.nextGroupSequence, 3);
    assert.deepEqual(errors, []);
  } finally {
    const settled = await Promise.allSettled([first.close(), second.close()]);
    for (const result of settled) if (result.status === 'rejected') throw result.reason;
  }
  assert.equal(releaseCount, 2);
});
