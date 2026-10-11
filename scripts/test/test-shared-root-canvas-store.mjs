import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fork } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import esbuild from 'esbuild';

const temporary = await mkdtemp(path.join(os.tmpdir(), 'dsc-shared-canvas-'));
const bundle = await esbuild.build({ entryPoints: ['extensions/vscode/dev-session-canvas/src/panel/sharedRootCanvasStore.ts'],
  bundle: true, platform: 'node', format: 'cjs', write: false });
const modulePath = path.join(temporary, 'store.cjs');
await writeFile(modulePath, bundle.outputFiles[0].text);
const { SharedRootCanvasStore, mergeSharedCanvasState, sharedCanvasState } = createRequire(import.meta.url)(modulePath);
const empty = () => ({ version: 1, updatedAt: '', nodes: [], groups: [], edges: [], nextGroupSequence: 1,
  fileReferences: [], suppressedFileActivityEdgeIds: [], suppressedAutomaticFileArtifactNodeIds: [] });
const note = id => ({ id, kind: 'note', title: id, status: 'idle', summary: '', position: { x: 0, y: 0 },
  size: { width: 300, height: 200 }, metadata: { note: { content: id } } });
let passed = 0;
async function check(name, run) { await run(); passed++; console.log(`PASS ${name}`); }
async function until(predicate) {
  for (let count = 0; count < 200; count++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
  assert.fail('Shared Canvas change was not observed');
}
const stores = [];
const children = [];
try {
  await check('different fields merge without resurrecting deleted objects or dangling edges', () => {
    const base = { ...empty(), nodes: [note('one'), note('two')] };
    const next = structuredClone(base); next.nodes[0].title = 'renamed';
    const latest = structuredClone(base); latest.nodes[0].position.x = 42;
    const merged = mergeSharedCanvasState(base, next, latest);
    assert.equal(merged.nodes[0].title, 'renamed'); assert.equal(merged.nodes[0].position.x, 42);
    latest.nodes = [latest.nodes[1]];
    latest.edges = [{ id: 'edge', sourceNodeId: 'one', targetNodeId: 'two' }];
    const deleted = mergeSharedCanvasState(base, next, latest);
    assert.deepEqual(deleted.nodes.map(node => node.id), ['two']); assert.deepEqual(deleted.edges, []);
    assert.deepEqual(mergeSharedCanvasState(base, next, merged), merged);
  });
  await check('Host output payloads and automatic launch intent are not shared', () => {
    const state = { ...empty(), nodes: [{ ...note('agent'), kind: 'agent', summary: 'private output', metadata: {
      agent: { runtimeSessionId: 'original', pendingLaunch: 'start', recentOutput: 'private',
        serializedTerminalState: { data: 'private' }, outputSequence: 12 } } }] };
    const shared = sharedCanvasState(state);
    assert.equal(shared.nodes[0].metadata.agent.runtimeSessionId, 'original');
    assert.equal(shared.nodes[0].metadata.agent.pendingLaunch, undefined);
    assert.equal(shared.nodes[0].metadata.agent.recentOutput, undefined);
    assert.equal(shared.nodes[0].summary, '');
    assert.equal(state.nodes[0].metadata.agent.recentOutput, 'private');
  });
  await check('geometry stays atomic while owner and file timestamps merge', () => {
    const base = { ...empty(), nodes: [note('one')], owners: [{ nodeId: 'one', updatedAt: 'old' }],
      fileReferences: [{ id: 'file', updatedAt: 'old' }] };
    const next = structuredClone(base), latest = structuredClone(base);
    next.nodes[0].position.x = 42;
    latest.nodes[0].position.y = 90;
    next.owners[0].updatedAt = 'new'; next.fileReferences[0].updatedAt = 'new';
    const merged = mergeSharedCanvasState(base, next, latest);
    assert.deepEqual(merged.nodes[0].position, { x: 42, y: 0 });
    assert.equal(merged.owners[0].updatedAt, 'new');
    assert.equal(merged.fileReferences[0].updatedAt, 'new');
  });
  await check('failed execution work commits its queued state before releasing the mutation lease', async () => {
    const filename = path.join(temporary, 'failed-mutation', 'canvas-state.json');
    const initial = { ...empty(), nodes: [note('one')] };
    const store = new SharedRootCanvasStore(filename, initial, () => {}, () => {}); stores.push(store);
    await store.publish(initial);
    await assert.rejects(store.mutate('one', async current => {
      const next = structuredClone(current); next.nodes[0].title = 'failed after update';
      void store.publish(next);
      throw new Error('controlled work failure');
    }), /controlled work failure/);
    assert.equal(JSON.parse(await readFile(filename, 'utf8')).state.nodes[0].title, 'failed after update');
  });
  await check('independent processes preserve simultaneous node creation and watcher receives both', async () => {
    const filename = path.join(temporary, 'root', 'canvas-state.json');
    let observed;
    const observer = new SharedRootCanvasStore(filename, empty(), state => { observed = state; }, error => { throw error; });
    stores.push(observer);
    const workerPath = path.join(temporary, 'worker.cjs');
    await writeFile(workerPath, `
      const { SharedRootCanvasStore } = require(${JSON.stringify(modulePath)});
      const [filename, initial, next] = process.argv.slice(2);
      const store = new SharedRootCanvasStore(filename, JSON.parse(initial), () => {}, () => {});
      process.send('ready');
      process.once('message', async () => {
        try { await store.publish(JSON.parse(next)); await store.flush(); process.send('done'); }
        catch (error) { console.error(error); process.exitCode = 1; }
        finally { store.dispose(); process.disconnect(); }
      });
    `);
    const workers = ['a', 'b'].map(id => fork(workerPath, [filename, JSON.stringify(empty()),
      JSON.stringify({ ...empty(), nodes: [note(id)] })], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] }));
    children.push(...workers);
    await Promise.all(workers.map(child => new Promise((resolve, reject) => {
      child.once('message', message => message === 'ready' ? resolve() : reject(new Error('Worker failed to start')));
      child.once('error', reject);
    })));
    const completed = workers.map(child => new Promise((resolve, reject) => {
      child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Worker exit ${code}`)));
    }));
    for (const child of workers) child.send('go');
    await Promise.all(completed);
    await until(() => observed?.nodes.length === 2);
    assert.deepEqual(observed.nodes.map(node => node.id).sort(), ['a', 'b']);
    const persisted = JSON.parse(await readFile(filename, 'utf8'));
    assert.deepEqual(persisted.state.nodes.map(node => node.id).sort(), ['a', 'b']);
    assert.equal(persisted.runtimePersistenceEnabled, true);
  });
  await check('closed subscription stops observation and corrupt storage fails without overwriting', async () => {
    const filename = path.join(temporary, 'corrupt', 'canvas-state.json');
    const store = new SharedRootCanvasStore(filename, empty(), () => {}, () => {}); stores.push(store);
    await writeFile(filename, 'not-json');
    await assert.rejects(store.publish({ ...empty(), nodes: [note('uncommitted')] }));
    assert.equal(await readFile(filename, 'utf8'), 'not-json');
    store.dispose();
    await assert.rejects(store.publish(empty()), /closed/);
  });
  await check('subscription catches a peer commit between page load and store construction', async () => {
    const filename = path.join(temporary, 'startup-race', 'canvas-state.json');
    const stale = { ...empty(), nodes: [note('one')] };
    const writer = new SharedRootCanvasStore(filename, stale, () => {}, () => {}); stores.push(writer);
    await writer.publish(stale);
    const latest = structuredClone(stale); latest.nodes[0].title = 'peer edit';
    await writer.publish(latest);
    let projected = stale;
    const reader = new SharedRootCanvasStore(filename, stale, state => { projected = state; }, () => {}); stores.push(reader);
    await reader.publish(stale);
    assert.equal(projected.nodes[0].title, 'peer edit');
    const edited = structuredClone(projected); edited.nodes[0].position.x = 77;
    await reader.publish(edited);
    const persisted = JSON.parse(await readFile(filename, 'utf8')).state;
    assert.equal(persisted.nodes[0].title, 'peer edit'); assert.equal(persisted.nodes[0].position.x, 77);
  });
  await check('two independent execution mutations serialize and observe the winning runtime identity', async () => {
    const filename = path.join(temporary, 'mutation', 'canvas-state.json');
    const initial = { ...empty(), nodes: [{ ...note('shared-node'), metadata: {} }] };
    const store = new SharedRootCanvasStore(filename, initial, () => {}, () => {}); stores.push(store);
    await store.publish(initial);
    const workerPath = path.join(temporary, 'mutation-worker.cjs');
    await writeFile(workerPath, `
      const { SharedRootCanvasStore } = require(${JSON.stringify(modulePath)});
      const [filename, initial, sessionId] = process.argv.slice(2);
      const store = new SharedRootCanvasStore(filename, JSON.parse(initial), () => {}, () => {});
      process.send('ready');
      process.once('message', async () => {
        try {
          const won = await store.mutate('shared-node', async current => {
            if (current.nodes[0].metadata.runtimeSessionId !== undefined) return false;
            const next = structuredClone(current); next.nodes[0].metadata.runtimeSessionId = sessionId;
            await store.publish(next); return true;
          });
          process.send({ won });
        } catch (error) { console.error(error); process.exitCode = 1; }
        finally { store.dispose(); process.disconnect(); }
      });
    `);
    const workers = ['runtime-a', 'runtime-b'].map(id => fork(workerPath,
      [filename, JSON.stringify(initial), id], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] }));
    children.push(...workers);
    await Promise.all(workers.map(child => new Promise((resolve, reject) => {
      child.once('message', message => message === 'ready' ? resolve() : reject(new Error('Worker did not initialize')));
      child.once('error', reject);
    })));
    const results = workers.map(child => new Promise((resolve, reject) => {
      child.once('message', message => resolve(message.won));
      child.once('error', reject);
    }));
    const exits = workers.map(child => new Promise((resolve, reject) => child.once('exit', code =>
      code === 0 ? resolve() : reject(new Error(`Worker exit ${code}`)))));
    for (const child of workers) child.send('go');
    assert.deepEqual((await Promise.all(results)).sort(), [false, true]);
    await Promise.all(exits);
    const persisted = JSON.parse(await readFile(filename, 'utf8'));
    assert.match(persisted.state.nodes[0].metadata.runtimeSessionId, /^runtime-[ab]$/);
  });
  const participantWorkerPath = path.join(temporary, 'participant-worker.cjs');
  await writeFile(participantWorkerPath, `
    const { SharedRootCanvasStore } = require(${JSON.stringify(modulePath)});
    const [filename, initial] = process.argv.slice(2);
    const store = new SharedRootCanvasStore(filename, JSON.parse(initial), () => {}, () => {});
    let release;
    process.on('message', async command => {
      if (command === 'release') { release?.(); return; }
      try {
        if (command === 'dispose') { store.dispose(); process.send({ type: 'disposed' }); process.disconnect(); return; }
        await store.depart(async last => {
          process.send({ type: 'decision', last });
          if (command === 'leave-gated') await new Promise(resolve => { release = resolve; });
          if (last) await store.publish({ ...JSON.parse(initial), nodes: [] });
          await store.flush();
        });
        process.send({ type: 'done' }); store.dispose(); process.disconnect();
      } catch (error) { console.error(error); store.dispose(); process.exit(1); }
    });
    store.flush().then(() => process.send({ type: 'ready' }), error => { console.error(error); process.exit(1); });
  `);
  function participantWorker(filename, initial) {
    const child = fork(participantWorkerPath, [filename, JSON.stringify(initial)],
      { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    children.push(child);
    const inbox = [];
    child.on('message', message => inbox.push(message));
    return { child, inbox, async take(type) {
      await until(() => inbox.some(message => message.type === type));
      return inbox.splice(inbox.findIndex(message => message.type === type), 1)[0];
    }, exited: new Promise((resolve, reject) => child.once('exit', code => code === 0 ? resolve() : reject(new Error('worker exit ' + code)))) };
  }
  async function seedParticipantRoot(name) {
    const filename = path.join(temporary, name, 'canvas-state.json');
    const initial = { ...empty(), nodes: [note('shared')] };
    const seed = new SharedRootCanvasStore(filename, initial, () => {}, () => {}); stores.push(seed);
    await seed.publish(initial); seed.dispose();
    return { filename, initial };
  }
  await check('independent concurrent departures preserve the non-last root and clear exactly once', async () => {
    const { filename, initial } = await seedParticipantRoot('concurrent-departures');
    const workers = [participantWorker(filename, initial), participantWorker(filename, initial)];
    await Promise.all(workers.map(worker => worker.take('ready')));
    for (const worker of workers) worker.child.send('leave');
    const decisions = await Promise.all(workers.map(worker => worker.take('decision')));
    assert.deepEqual(decisions.map(value => value.last).sort(), [false, true]);
    await Promise.all(workers.map(worker => worker.exited));
    assert.equal(JSON.parse(await readFile(filename, 'utf8')).state.nodes.length, 0);
  });
  await check('new independent participant waits for last cleanup and sees the cleared root', async () => {
    const { filename, initial } = await seedParticipantRoot('join-during-departure');
    const leaving = participantWorker(filename, initial); await leaving.take('ready');
    leaving.child.send('leave-gated'); assert.equal((await leaving.take('decision')).last, true);
    const joining = participantWorker(filename, initial);
    await new Promise(resolve => setTimeout(resolve, 100));
    assert(!joining.inbox.some(message => message.type === 'ready'), 'admission is blocked until final cleanup');
    leaving.child.send('release'); await leaving.exited; await joining.take('ready');
    assert.equal(JSON.parse(await readFile(filename, 'utf8')).state.nodes.length, 0);
    joining.child.send('leave'); assert.equal((await joining.take('decision')).last, true); await joining.exited;
  });
  await check('ordinary independent disposal preserves the root and leaves the peer last', async () => {
    const { filename, initial } = await seedParticipantRoot('ordinary-departure');
    const first = participantWorker(filename, initial), peer = participantWorker(filename, initial);
    await Promise.all([first.take('ready'), peer.take('ready')]);
    first.child.send('dispose'); await first.exited;
    assert.equal(JSON.parse(await readFile(filename, 'utf8')).state.nodes[0].id, 'shared');
    peer.child.send('leave'); assert.equal((await peer.take('decision')).last, true); await peer.exited;
  });
  await check('failed last cleanup keeps membership and can be retried under admission', async () => {
    const { filename, initial } = await seedParticipantRoot('failed-departure');
    const store = new SharedRootCanvasStore(filename, initial, () => {}, () => {}); stores.push(store);
    await assert.rejects(store.depart(async last => { assert.equal(last, true); throw new Error('controlled failure'); }), /controlled failure/);
    const peer = new SharedRootCanvasStore(filename, initial, () => {}, () => {}); stores.push(peer); await peer.flush();
    await peer.depart(async last => { assert.equal(last, false); });
    await store.depart(async last => { assert.equal(last, true); await store.publish(empty()); });
    assert.equal(JSON.parse(await readFile(filename, 'utf8')).state.nodes.length, 0);
    await assert.rejects(store.mutate('shared', async () => {}), /left/);
  });
  await check('crashed independent participant is pruned only after connection refusal', async () => {
    const { filename, initial } = await seedParticipantRoot('crashed-participant');
    const crashed = participantWorker(filename, initial); await crashed.take('ready');
    // Deliberately terminate only this test's child to exercise the OS-released proof listener.
    const dead = new Promise(resolve => crashed.child.once('exit', resolve));
    crashed.exited.catch(() => {});
    crashed.child.kill('SIGKILL'); await dead;
    const store = new SharedRootCanvasStore(filename, initial, () => {}, () => {}); stores.push(store);
    await store.depart(async last => { assert.equal(last, true); });
  });
  await check('unconfirmed participant identity refuses cleanup without altering the root', async () => {
    const { filename, initial } = await seedParticipantRoot('invalid-participant');
    const store = new SharedRootCanvasStore(filename, initial, () => {}, () => {}); stores.push(store); await store.flush();
    const directory = filename + '.participants';
    const token = '00000000-0000-0000-0000-000000000000';
    await writeFile(path.join(directory, token + '.json'), JSON.stringify({ token, port: 123 }));
    await assert.rejects(store.depart(async () => assert.fail('unconfirmed participation cannot clear')), /Invalid/);
    assert.equal(JSON.parse(await readFile(filename, 'utf8')).state.nodes.length, 1);
    await rm(path.join(directory, token + '.json'));
    await store.depart(async last => { assert.equal(last, true); });
  });

  await check('colliding multi-root admission ports reuse the held lease without deadlocking', async () => {
    const hashes = new Map();
    let filenames;
    for (let index = 0; index <= 10000; index++) {
      const filename = path.join(temporary, 'collision-' + index, 'canvas-state.json');
      const identity = process.platform === 'win32' ? filename.toLowerCase() : filename;
      const port = 10000 + createHash('sha256').update(identity).digest().readUInt32BE(0) % 10000;
      if (hashes.has(port)) { filenames = [hashes.get(port), filename]; break; }
      hashes.set(port, filename);
    }
    assert(filenames);
    const pair = filenames.map(filename => {
      const store = new SharedRootCanvasStore(filename, empty(), () => {}, () => {}); stores.push(store); return store;
    });
    await Promise.all(pair.map(store => store.publish(empty())));
    assert.equal(pair[0].admissionPort, pair[1].admissionPort);
    const held = new Set();
    await pair[0].depart(async last => {
      assert.equal(last, true);
      await pair[1].depart(async alsoLast => { assert.equal(alsoLast, true); assert.equal(held.size, 1); }, held);
    }, held);
    assert.equal(held.size, 0);
  });

  console.log(`Shared root Canvas store: ${passed}/${passed} passed`);
} finally {
  for (const store of stores) store.dispose();
  for (const child of children) if (child.exitCode === null && child.connected) child.kill();
  await rm(temporary, { recursive: true, force: true });
}
