import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import esbuild from 'esbuild';

const sourceRef = 'e07fd17601b2639456dfd4807c1b83905067c8b1';
const sourceDirectory = 'extensions/vscode/dev-session-canvas/src';
const temporary = await mkdtemp(path.join(os.tmpdir(), 'dsc-legacy-lock-fence-'));
const stores = [];
const leases = new Set();
const results = [];
const invalidSnapshot = /Invalid shared Canvas snapshot; refusing to overwrite it/;
const watchdog = setTimeout(() => { throw new Error('Legacy fence probe exceeded 30 seconds'); }, 30000);
const empty = () => ({ version: 1, updatedAt: '', nodes: [], groups: [], edges: [], nextGroupSequence: 1 });
const changed = () => ({ ...empty(), nextGroupSequence: 2 });
const deferred = () => {
  let resolve;
  const promise = new Promise(complete => { resolve = complete; });
  return { promise, resolve };
};

async function release(lease) {
  if (!leases.delete(lease)) return;
  await new Promise((resolve, reject) => lease.close(error => error ? reject(error) : resolve()));
}

try {
  const archive = execFileSync('git', ['archive', sourceRef, sourceDirectory], { maxBuffer: 64 * 1024 * 1024 });
  execFileSync('tar', ['-x', '-C', temporary], { input: archive });
  const entry = path.join(temporary, sourceDirectory, 'panel/sharedRootCanvasStore.ts');
  const bundled = await esbuild.build({
    entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', write: false,
  });
  const modulePath = path.join(temporary, 'legacy-store.cjs');
  await writeFile(modulePath, bundled.outputFiles[0].text);
  const { SharedRootCanvasStore } = createRequire(import.meta.url)(modulePath);

  async function fixture(initial = empty()) {
    const directory = path.join(temporary, randomUUID());
    await mkdir(directory, { mode: 0o700 });
    const filename = path.join(directory, 'canvas-state.json');
    const errors = [];
    const store = new SharedRootCanvasStore(filename, initial, () => {}, error => errors.push(error.message));
    stores.push(store);
    await store.ready;
    await store.publish(initial);
    return { filename, store, errors };
  }

  async function convert(filename, version = 2) {
    const before = JSON.parse(await readFile(filename, 'utf8'));
    const after = { ...before, version, lockProtocol: 'os-file-v1' };
    const staged = `${filename}.${randomUUID()}.tmp`;
    const bytes = JSON.stringify(after);
    await writeFile(staged, bytes, { mode: 0o600, flag: 'wx' });
    await rename(staged, filename);
    return bytes;
  }

  async function underLegacyLocks(store, work) {
    const admission = await store.participants.acquireAdmission();
    leases.add(admission);
    try {
      const commit = await store.acquireLease();
      leases.add(commit);
      try { return await work(); }
      finally { await release(commit); }
    } finally { await release(admission); }
  }

  async function check(name, work) {
    await work();
    results.push(name);
    console.log(`PASS ${name}`);
  }

  await check('unknown field alone does not fence legacy publish', async () => {
    const { store, filename } = await fixture();
    await underLegacyLocks(store, () => convert(filename, 1));
    await store.publish(changed());
    const stored = JSON.parse(await readFile(filename, 'utf8'));
    assert.equal(stored.version, 1);
    assert.equal(stored.state.nextGroupSequence, 2);
    assert.equal(stored.lockProtocol, 'os-file-v1');
  });

  await check('envelope conversion preserves graph and runtime binding values', async () => {
    const initial = { ...empty(), nodes: [{
      id: 'terminal-fixture', kind: 'terminal', title: 'fixture', status: 'running', summary: '',
      position: { x: 0, y: 0 }, size: { width: 400, height: 300 },
      metadata: { terminal: { runtimeSessionId: 'fixture-session', runtimeBackend: 'systemd-user',
        runtimeStoragePath: '/fixture/never-contacted', liveSession: true } },
    }] };
    const { store, filename } = await fixture(initial);
    const before = JSON.parse(await readFile(filename, 'utf8'));
    const after = JSON.parse(await underLegacyLocks(store, () => convert(filename)));
    assert.deepEqual(after.state, before.state);
    assert.equal(after.sharedRevision, before.sharedRevision);
    assert.equal(after.state.nodes[0].metadata.terminal.runtimeSessionId, 'fixture-session');
  });

  await check('version 2 rejects a newly constructed legacy store', async () => {
    const { store, filename } = await fixture();
    const bytes = await underLegacyLocks(store, () => convert(filename));
    assert.throws(() => new SharedRootCanvasStore(filename, empty(), () => {}, () => {}), invalidSnapshot);
    assert.equal(await readFile(filename, 'utf8'), bytes);
  });

  for (const operation of ['publish', 'mutate', 'depart']) {
    await check(`version 2 rejects existing legacy ${operation} without work or overwrite`, async () => {
      const { store, filename } = await fixture();
      const bytes = await underLegacyLocks(store, () => convert(filename));
      let called = false;
      const work = async () => { called = true; };
      const pending = operation === 'publish' ? store.publish(changed())
        : operation === 'mutate' ? store.mutate('node-one', work) : store.depart(work);
      await assert.rejects(pending, invalidSnapshot);
      assert.equal(called, false);
      assert.equal(await readFile(filename, 'utf8'), bytes);
    });
  }

  await check('queued legacy publish re-reads version after acquiring commit lock', async () => {
    const { store, filename } = await fixture();
    const admission = await store.participants.acquireAdmission();
    leases.add(admission);
    const acquire = store.acquireLease.bind(store);
    const commit = await acquire();
    leases.add(commit);
    const attempted = deferred();
    store.acquireLease = async (...args) => { attempted.resolve(); return acquire(...args); };
    const rejected = assert.rejects(store.publish(changed()), invalidSnapshot);
    try {
      await attempted.promise;
      const bytes = await convert(filename);
      await release(commit);
      await rejected;
      assert.equal(await readFile(filename, 'utf8'), bytes);
    } finally {
      store.acquireLease = acquire;
      await release(commit);
      await release(admission);
    }
  });

  await check('admitted legacy mutation finishes before conversion takes admission', async () => {
    const { store, filename } = await fixture();
    const entered = deferred();
    const finish = deferred();
    const events = [];
    const mutation = store.mutate('node-one', async () => {
      events.push('old-work-start');
      entered.resolve();
      await finish.promise;
      await store.publish(changed());
      events.push('old-work-finished');
    });
    await entered.promise;
    const migration = underLegacyLocks(store, async () => {
      events.push('conversion');
      assert.equal(JSON.parse(await readFile(filename, 'utf8')).state.nextGroupSequence, 2);
      return convert(filename);
    });
    finish.resolve();
    await mutation;
    const bytes = await migration;
    assert.deepEqual(events, ['old-work-start', 'old-work-finished', 'conversion']);
    assert.equal(await readFile(filename, 'utf8'), bytes);
  });

  console.log(JSON.stringify({
    sourceRef,
    storeSha256: createHash('sha256').update(await readFile(entry)).digest('hex'),
    platform: process.platform,
    node: process.version,
    passed: results.length,
    scope: 'legacy store only; conversion is a fixture, not a production migration or native lock backend',
  }, null, 2));
} finally {
  clearTimeout(watchdog);
  for (const lease of [...leases]) await release(lease);
  for (const store of stores) store.dispose();
  await rm(temporary, { recursive: true, force: true });
}
