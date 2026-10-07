import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import esbuild from 'esbuild';

assert.equal(process.platform, 'linux', 'S2 is currently frozen for local Linux only');
const tempDir = await mkdtemp(path.join(os.tmpdir(), 'dsc-provider-transport-'));
let nextIdentity = 0;
const created = [];
const subjectPids = new Set();
const expectedTail = 'head\n' + 'a'.repeat(10000) + '\u001b[2;7H\u4e2d-final\n';

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function until(predicate, deadline, label) {
  while (!predicate()) {
    if (performance.now() >= deadline) throw new Error(`Scenario deadline: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function before(promise, deadline, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Scenario deadline: ${label}`)), Math.max(0, deadline - performance.now()));
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

try {
  await esbuild.build({
    entryPoints: {
      adapter: path.resolve('extensions/vscode/dev-session-canvas/src/panel/executionSessionAdapter.ts'),
      transport: path.resolve('extensions/vscode/dev-session-canvas/src/panel/executionProviderTransport.ts'),
      fixture: path.resolve('scripts/test/fixtures/execution-provider-fixture.ts')
    },
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node18',
    outdir: tempDir,
    outExtension: { '.js': '.cjs' }
  });
  const require = createRequire(import.meta.url);
  const { createExecutionAuthority, prepareExecution } = require(path.join(tempDir, 'adapter.cjs'));
  const { createExecutionProviderTransport, createNodeExecutionScheduler } = require(path.join(tempDir, 'transport.cjs'));

  function execution(mode, deadline, options = {}) {
    if (!Number.isFinite(deadline) || performance.now() >= deadline) {
      throw new Error('Scenario deadline reached before execution creation');
    }
    nextIdentity += 1;
    const identity = {
      executionId: `10000000-0000-4000-8000-${String(nextIdentity).padStart(12, '0')}`,
      generation: `pipe-binding-${nextIdentity}`
    };
    const authority = options.authority ?? createExecutionAuthority();
    const transport = createExecutionProviderTransport({
      identity,
      executable: options.executable ?? process.execPath,
      entryPoint: path.join(tempDir, 'fixture.cjs'),
      args: [mode]
    });
    const events = { data: [], process: [], seals: [], faults: [], resources: [] };
    const sent = [];
    const consumers = [];
    let consumptionPaused = options.pauseConsumption === true;
    const session = prepareExecution(identity, { file: process.execPath, args: [] }, {
      authority,
      transport: {
        connect: (sink) => transport.connect(sink),
        send(message) { sent.push(message); return transport.send(message); }
      },
      scheduler: createNodeExecutionScheduler()
    });
    session.bind({
      data: (batch) => events.data.push(batch),
      processResult: (eventIdentity, result) => events.process.push({ identity: eventIdentity, result }),
      outputSeal: (seal) => events.seals.push(seal),
      resourceResult: (eventIdentity, resourceId, result) => events.resources.push({ identity: eventIdentity, resourceId, result }),
      fault: (eventIdentity, reason) => events.faults.push({ identity: eventIdentity, reason })
    }, () => {
      if (!consumptionPaused) return Promise.resolve();
      const pending = deferred();
      consumers.push(pending);
      return pending.promise;
    });
    const state = {
      mode, transport, session, authority, events, sent, termination: undefined,
      resumeConsumption() {
        consumptionPaused = false;
        for (const consumer of consumers) consumer.resolve();
      },
      output() { return events.data.map((batch) => batch.text).join(''); },
      async started() {
        const result = await before(this.start.first, deadline, `${mode} subject start`);
        assert.equal(result.kind, 'started', `${mode}: ${JSON.stringify(result)}`);
        assert.notEqual(result.pid, transport.snapshot().pid, 'provider PID must not stand in for the subject');
        subjectPids.add(result.pid);
        return result;
      },
      async terminate() {
        if (transport.snapshot().closed) return transport.closed;
        if (!this.termination) {
          const now = performance.now();
          this.termination = transport.terminate({ termDeadline: now + 2000, killDeadline: now + 4000 });
        }
        return this.termination;
      }
    };
    created.push(state);
    state.start = session.start('start', deadline);
    return state;
  }

  const cases = [
    ['S2-01 normal tail, nonzero exit, and source seal before consumer completion', async (deadline) => {
      const h = execution('normal', deadline, { pauseConsumption: true });
      await h.started();
      await until(() => h.events.seals.length === 1, deadline, 'normal output seal');
      assert.equal(h.output(), expectedTail);
      assert.equal(h.events.seals[0].process.kind, 'exited');
      assert.equal(h.events.seals[0].process.exitCode, 7);
      assert.equal(h.events.seals[0].source.kind, 'eof');
      assert.equal(h.session.snapshot().consumedThrough, 0);
      assert.ok(h.session.snapshot().pendingBytes > 0);
      const closed = await before(h.transport.closed, deadline, 'normal provider close');
      assert.equal(closed.exitCode, 0);
      assert.equal(h.session.snapshot().resources['provider-control'].current.kind, 'released');
      h.resumeConsumption();
      await until(() => h.session.snapshot().state === 'settled', deadline, 'normal authority consumption');
      assert.equal(h.authority.snapshot().active, 0);
      assert.equal(h.authority.snapshot().blockedReason, undefined);
      assert.equal(h.transport.snapshot().firstFault, undefined);
    }],
    ['S2-02 full credit still allows stop and an independent second execution', async (deadline) => {
      const authority = createExecutionAuthority();
      const a = execution('flood', deadline, { authority, pauseConsumption: true });
      await a.started();
      await until(() => a.session.snapshot().pendingFrames === 16, deadline, 'A credit window full');
      const b = execution('normal', deadline, { authority });
      await b.started();
      await before(b.transport.closed, deadline, 'B provider close while A paused');
      await until(() => b.session.snapshot().state === 'settled', deadline, 'B settled while A paused');
      assert.equal(b.output(), expectedTail);
      assert.equal(a.session.snapshot().consumedThrough, 0);
      assert.equal(a.session.snapshot().pendingFrames, 16);
      const stop = a.session.requestStop('stop', 'graceful', deadline);
      const accepted = await before(stop.first, deadline, 'stop response without output credit');
      assert.equal(accepted.kind, 'accepted');
      assert.equal(a.session.snapshot().consumedThrough, 0);
      a.resumeConsumption();
      await before(a.transport.closed, deadline, 'A stopped provider close');
      await until(() => a.session.snapshot().state === 'settled', deadline, 'A accepted output consumed');
      assert.ok(a.events.data.length >= 17, 'the already owned next write must survive the stop');
      assert.equal(a.events.seals[0].source.kind, 'eof');
      assert.equal(a.events.seals[0].process.kind, 'signaled');
      assert.equal(a.events.seals[0].process.signal, 'SIGTERM');
      assert.equal(authority.snapshot().active, 0);
      assert.equal(authority.snapshot().blockedReason, undefined);
    }],
    ['S2-03 provider spawn failure has no invented subject exit or EOF', async (deadline) => {
      const h = execution('normal', deadline, { executable: path.join(tempDir, 'missing-node-executable') });
      const result = await before(h.start.first, deadline, 'failed provider start');
      assert.equal(result.kind, 'failed');
      await before(h.transport.closed, deadline, 'failed provider handles close');
      assert.equal(h.transport.snapshot().spawned, false);
      assert.equal(h.transport.snapshot().pid, undefined);
      assert.equal(h.session.snapshot().process, undefined);
      assert.equal(h.events.seals.length, 0);
      assert.equal(h.session.snapshot().resources['provider-control'].current.kind, 'released');
      assert.equal(h.authority.snapshot().active, 0);
    }],
    ['S2-04 a partial output frame after subject exit cannot become EOF', async (deadline) => {
      const h = execution('partial', deadline);
      await h.started();
      await before(h.transport.closed, deadline, 'partial fixture close');
      await until(() => h.events.seals.length === 1, deadline, 'partial output settlement');
      assert.equal(h.output(), expectedTail);
      assert.equal(h.events.seals[0].process.kind, 'exited');
      assert.equal(h.events.seals[0].process.exitCode, 7);
      assert.equal(h.events.seals[0].source.kind, 'error');
      assert.equal(h.session.snapshot().rawBytes, 2);
      assert.equal(h.session.snapshot().resources['provider-control'].current.kind, 'released');
      assert.ok(h.authority.snapshot().blockedReason);
    }],
    ['S2-05 wrong identity is rejected before becoming a process fact', async (deadline) => {
      const h = execution('wrong-identity', deadline);
      await until(() => Boolean(h.transport.snapshot().firstFault), deadline, 'wrong identity rejection');
      assert.equal(h.events.process.length, 0);
      assert.equal(h.session.snapshot().process, undefined);
      assert.equal(h.events.seals.length, 0);
      assert.equal((await h.terminate()).kind, 'closed');
      assert.equal(h.transport.snapshot().killRequested, false);
    }],
    ['S2-06 provider cannot forge release of the parent control resource', async (deadline) => {
      const h = execution('forged-control', deadline);
      await until(() => Boolean(h.transport.snapshot().firstFault), deadline, 'forged release rejection');
      assert.equal(h.session.snapshot().resources['provider-control'].current, undefined);
      assert.equal(h.transport.snapshot().closed, false);
      assert.equal((await h.terminate()).kind, 'closed');
      assert.equal(h.session.snapshot().resources['provider-control'].current.kind, 'released');
      assert.equal(h.transport.snapshot().killRequested, false);
    }],
    ['S2-07 TERM then KILL observes a provider that never created a subject', async (deadline) => {
      const h = execution('ignore-term', deadline);
      await until(() => h.transport.snapshot().spawned && h.session.snapshot().state === 'starting', deadline, 'idle provider spawn');
      // Ready/start delivery establishes that the fixture installed its SIGTERM handler.
      await until(() => h.sent.some((message) => message.type === 'start'), deadline, 'idle provider start sent');
      const result = await before(h.terminate(), deadline, 'controlled forced provider close');
      assert.equal(result.kind, 'closed');
      assert.equal(result.signal, 'SIGKILL');
      assert.equal(h.transport.snapshot().termRequested, true);
      assert.equal(h.transport.snapshot().killRequested, true);
      assert.equal(h.events.data.length, 0);
      assert.equal(h.session.snapshot().resources['provider-control'].current.kind, 'released');
      assert.notEqual(h.events.seals[0]?.source.kind, 'eof');
    }]
  ];

  const failures = [];
  let unsafe = false;
  for (const [name, run] of cases) {
    if (unsafe) { console.error(`NOT RUN ${name}: an earlier owner could not be confirmed closed`); continue; }
    const offset = created.length;
    const deadline = performance.now() + 10000;
    try {
      await before(run(deadline), deadline, name);
      console.log(`PASS ${name}`);
    } catch (error) {
      failures.push(name);
      console.error(`FAIL ${name}`);
      console.error(error);
      for (const h of created.slice(offset)) console.error(JSON.stringify({ mode: h.mode, transport: h.transport.snapshot(), execution: h.session.snapshot() }));
    } finally {
      for (const h of created.slice(offset)) {
        h.resumeConsumption();
        const result = await h.terminate();
        if (result.kind !== 'closed' || !h.transport.snapshot().closed) {
          unsafe = true;
          failures.push(`${name}: unconfirmed provider cleanup`);
        }
      }
    }
  }
  console.log(JSON.stringify({ platform: process.platform, node: process.version, groups: cases.length,
    providerAttempts: created.length, providersSpawned: created.filter((h) => h.transport.snapshot().spawned).length,
    subjectsObserved: subjectPids.size, providersClosed: created.filter((h) => h.transport.snapshot().closed).length,
    failures }));
  assert.equal(unsafe, false, 'a provider remains unconfirmed');
  assert.equal(failures.length, 0, `Failed S2 groups: ${failures.join('; ')}`);
  assert.equal(created.filter((h) => h.transport.snapshot().spawned).length, 7);
  assert.equal(subjectPids.size, 4);
  console.log('executionProviderTransport tests passed (7 groups; ordinary pipes, zero PTYs)');
} finally {
  for (const h of created) {
    h.resumeConsumption();
    if (!h.transport.snapshot().closed) await h.terminate();
  }
  if (created.every((h) => h.transport.snapshot().closed)) await rm(tempDir, { recursive: true, force: true });
}
