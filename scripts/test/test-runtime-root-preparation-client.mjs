import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import path from 'node:path';

import esbuild from 'esbuild';

const require = createRequire(import.meta.url);
const { outputFiles } = await esbuild.build({
  stdin: { contents: `
    export { prepareRootRuntimeSupervisor } from './extensions/vscode/dev-session-canvas/src/panel/runtimeRootSupervisorPreparation';
    export { createRuntimeOwnerDescriptor, resolveRuntimeRootOwnerBaseStoragePath, resolveRootRuntimeSupervisorGeneration }
      from './extensions/vscode/dev-session-canvas/src/common/runtimeRootOwnership';
  `, resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, platform: 'node', format: 'cjs', write: false, target: 'node18'
});

class ControlledChild extends EventEmitter {
  connected = true;
  stderr = new EventEmitter();
  sent = [];
  disconnectCount = 0;
  unrefCount = 0;
  sendReturn = true;
  sendError;
  sendThrow;
  sendCallbacks = [];
  constructor() {
    super();
    this.stderr.destroyed = false;
    this.stderr.destroy = () => { this.stderr.destroyed = true; };
  }
  send(value, callback) {
    this.sent.push(value);
    if (this.sendThrow) throw this.sendThrow;
    if (this.sendError) callback(this.sendError);
    else this.sendCallbacks.push(callback);
    return this.sendReturn;
  }
  disconnect() {
    this.disconnectCount++;
    this.connected = false;
    this.emit('disconnect');
  }
  unref() { this.unrefCount++; }
  kill() { assert.fail('Preparation must not signal a helper or a submitted Supervisor.'); }
}

function harness() {
  let now = 0;
  let timerId = 0;
  const timers = new Map();
  const child = new ControlledChild();
  const spawns = [];
  let spawnError;
  const module = { exports: {} };
  const fakeProcess = { ...process, execPath: '/controlled/node', env: {
    PATH: '/controlled/bin', PRIVATE_TEST_VALUE: 'private environment value',
    ELECTRON_RUN_AS_NODE: '0', ELECTRON_NO_ATTACH_CONSOLE: '0'
  } };
  new Function('require', 'module', 'exports', 'process', 'setTimeout', 'clearTimeout', outputFiles[0].text)(name => {
    if (name === 'node:child_process') return { spawn(file, args, options) {
      spawns.push({ file, args, options });
      if (spawnError) throw spawnError;
      return child;
    } };
    if (name === 'node:perf_hooks') return { performance: { now: () => now } };
    return require(name);
  }, module, module.exports, fakeProcess, (callback, delay) => {
    const id = ++timerId;
    timers.set(id, { callback, due: now + delay });
    return id;
  }, id => timers.delete(id));
  const profile = ({ linux: 'linux-owner-v1-candidate', darwin: 'macos-owner-v1-candidate',
    win32: 'windows-owner-v1-candidate' })[process.platform];
  const owner = module.exports.createRuntimeOwnerDescriptor({ environmentKey: 'a'.repeat(64),
    userStorageScopeKey: 'b'.repeat(64), rootPath: path.resolve('controlled/project'),
    generation: module.exports.resolveRootRuntimeSupervisorGeneration(profile) });
  const options = {
    storageDir: path.join(module.exports.resolveRuntimeRootOwnerBaseStoragePath(path.resolve('controlled/global'), owner),
      'runtime-supervisor'), owner, executionProfile: profile, preferredBackends: ['systemd-user', 'legacy-detached'],
    supervisorScriptPath: path.resolve('controlled/supervisor.js'),
    supervisorLauncherScriptPath: path.resolve('controlled/launcher.js')
  };
  return { child, spawns, timers, options,
    prepare: (input = options) => module.exports.prepareRootRuntimeSupervisor(input),
    failSpawn(error) { spawnError = error; },
    elapseWithoutTimers(milliseconds) { now += milliseconds; },
    advance(milliseconds) {
      const target = now + milliseconds;
      while (true) {
        const entry = [...timers.entries()].filter(([, timer]) => timer.due <= target)
          .sort((left, right) => left[1].due - right[1].due)[0];
        if (!entry) break;
        const [id, timer] = entry;
        timers.delete(id);
        now = timer.due;
        timer.callback();
      }
      now = target;
    },
    assertClean() {
      assert.equal(timers.size, 0, 'The call must not retain deadline timers.');
      assert.deepEqual(child.eventNames(), [], 'The call must remove its child listeners.');
      assert.deepEqual(child.stderr.eventNames(), [], 'The call must remove its stderr listeners.');
      assert.equal(child.stderr.destroyed, true);
      assert.equal(child.unrefCount, 1);
      assert.ok(child.disconnectCount <= 1, 'IPC is disconnected at most once.');
    }
  };
}

let passed = 0;
async function test(name, run) {
  try { await run(); passed++; }
  catch (error) { throw new Error(name, { cause: error }); }
}

await test('one spawn submits one private IPC request after spawn and waits for helper close', async () => {
  const h = harness();
  let completed = false;
  const operation = h.prepare().then(result => { completed = true; return result; });
  assert.equal(h.spawns.length, 1);
  assert.deepEqual(h.spawns[0], { file: '/controlled/node', args: [h.options.supervisorLauncherScriptPath,
    '--prepare-root-runtime'], options: { stdio: ['ignore', 'ignore', 'pipe', 'ipc'], shell: false, detached: false,
    windowsHide: true, serialization: 'json', env: { PATH: '/controlled/bin', PRIVATE_TEST_VALUE: 'private environment value',
      ELECTRON_RUN_AS_NODE: '1', ELECTRON_NO_ATTACH_CONSOLE: '1' } } });
  assert.deepEqual(h.child.sent, []);
  h.child.emit('spawn');
  h.child.emit('spawn');
  assert.deepEqual(h.child.sent, [{ type: 'prepare-root-runtime', ...h.options }]);
  assert.equal(JSON.stringify(h.child.sent).includes('private environment value'), false);
  h.child.sendCallbacks[0](null);
  h.child.emit('message', { kind: 'ready', backend: 'systemd-user' });
  await Promise.resolve();
  assert.equal(completed, false, 'A response does not prove that preparation ownership has been released.');
  assert.equal(h.child.disconnectCount, 1);
  h.child.emit('close', 0, null);
  assert.deepEqual(await operation, { kind: 'ready', backend: 'systemd-user' });
  h.assertClean();
});

for (const response of [{ kind: 'ready', backend: 'legacy-detached' },
  { kind: 'rejected', reason: 'Owner identity conflict.' }, { kind: 'unconfirmed', reason: 'Prior startup is unknown.' }]) {
  await test(`valid ${response.kind} outcome is retained without retry or backend fallback`, async () => {
    const h = harness();
    h.child.sendReturn = false;
    const operation = h.prepare();
    h.child.emit('spawn');
    h.child.emit('message', response);
    h.child.emit('message', { kind: 'ready', backend: 'systemd-user' });
    h.child.emit('close', 0, null);
    assert.deepEqual(await operation, response);
    assert.equal(h.child.sent.length, 1);
    assert.equal(h.spawns.length, 1);
    h.assertClean();
  });
}

await test('invalid input rejects before acquiring a child', async () => {
  const h = harness();
  for (const options of [
    { ...h.options, supervisorScriptPath: 'relative/supervisor.js' },
    { ...h.options, executionProfile: 'unknown' },
    { ...h.options, owner: { ...h.options.owner, schema: 2 } },
    { ...h.options, preferredBackends: [] },
    { ...h.options, preferredBackends: ['legacy-detached', 'legacy-detached'] }
  ]) assert.equal((await h.prepare(options)).kind, 'rejected');
  assert.deepEqual(h.spawns, []);
  assert.equal(h.timers.size, 0);
});

await test('synchronous spawn error is unconfirmed without exposing its error text', async () => {
  const h = harness();
  h.failSpawn(new Error('private spawn payload'));
  const result = await h.prepare();
  assert.equal(result.kind, 'unconfirmed');
  assert.equal(result.reason.includes('private spawn payload'), false);
  assert.equal(h.spawns.length, 1);
  assert.equal(h.timers.size, 0);
});

for (const failure of ['spawn-error', 'send-error', 'send-throw', 'disconnect', 'exit', 'close', 'stderr-error']) {
  await test(`${failure} is unconfirmed with a single attempt and clean listeners`, async () => {
    const h = harness();
    if (failure === 'send-error') h.child.sendError = new Error('private send payload');
    if (failure === 'send-throw') h.child.sendThrow = new Error('private send payload');
    const operation = h.prepare();
    if (failure !== 'spawn-error') h.child.emit('spawn');
    if (failure === 'spawn-error') h.child.emit('error', new Error('private spawn payload'));
    if (failure === 'disconnect') h.child.disconnect();
    if (failure === 'exit') h.child.emit('exit', 0, null);
    if (failure === 'stderr-error') h.child.stderr.emit('error', new Error('private stderr payload'));
    h.child.emit('close', 1, null);
    const result = await operation;
    assert.equal(result.kind, 'unconfirmed');
    assert.equal(result.reason.includes('private'), false);
    assert.equal(h.child.sent.length, failure === 'spawn-error' ? 0 : 1);
    assert.equal(h.spawns.length, 1);
    h.assertClean();
  });
}

await test('invalid responses cannot become ready or rejected startup evidence', async () => {
  for (const value of [undefined, null, 'ready', {}, { kind: 'ready' }, { kind: 'ready', backend: 'other' },
    { kind: 'ready', backend: 'legacy-detached', extra: true }, { kind: 'unconfirmed', reason: '' },
    { kind: 'rejected', reason: 'x'.repeat(1025) }, Object.defineProperty({}, 'kind', { get() { throw new Error('not data'); } })]) {
    const h = harness();
    const operation = h.prepare();
    h.child.emit('spawn');
    h.child.emit('message', value);
    h.child.emit('close', 0, null);
    assert.equal((await operation).kind, 'unconfirmed');
    assert.equal(h.child.sent.length, 1);
    h.assertClean();
  }
});

await test('a result before submission is unconfirmed and prevents request delivery', async () => {
  const h = harness();
  const operation = h.prepare();
  h.child.emit('message', { kind: 'ready', backend: 'legacy-detached' });
  h.child.emit('spawn');
  h.child.emit('close', 0, null);
  assert.equal((await operation).kind, 'unconfirmed');
  assert.deepEqual(h.child.sent, []);
  h.assertClean();
});

await test('the thirty-second budget closes IPC without killing or resubmitting startup', async () => {
  const h = harness();
  const operation = h.prepare();
  h.child.emit('spawn');
  h.advance(29_999);
  assert.equal(h.child.disconnectCount, 0);
  h.advance(1);
  const result = await operation;
  assert.equal(result.kind, 'unconfirmed');
  assert.match(result.reason, /deadline/);
  assert.equal(h.child.disconnectCount, 1);
  assert.equal(h.child.sent.length, 1);
  assert.equal(h.spawns.length, 1);
  h.child.emit('message', { kind: 'ready', backend: 'legacy-detached' });
  h.child.emit('close', 0, null);
  assert.equal((await operation).kind, 'unconfirmed');
  h.assertClean();
});

await test('helper exit after a result remains bounded and within the total budget', async () => {
  for (const elapsed of [0, 29_900]) {
    const h = harness();
    const operation = h.prepare();
    h.child.emit('spawn');
    h.advance(elapsed);
    h.child.emit('message', { kind: 'ready', backend: 'legacy-detached' });
    h.advance(Math.min(1_000, 30_000 - elapsed));
    assert.equal((await operation).kind, 'unconfirmed');
    assert.equal(h.child.sent.length, 1);
    h.assertClean();
  }
});

await test('delayed event delivery cannot submit or accept a result after the total deadline', async () => {
  for (const delayedEvent of ['spawn', 'message', 'close']) {
    const h = harness();
    const operation = h.prepare();
    if (delayedEvent !== 'spawn') h.child.emit('spawn');
    if (delayedEvent === 'close') h.child.emit('message', { kind: 'ready', backend: 'legacy-detached' });
    h.elapseWithoutTimers(30_001);
    if (delayedEvent === 'spawn') h.child.emit('spawn');
    if (delayedEvent === 'message') h.child.emit('message', { kind: 'ready', backend: 'legacy-detached' });
    if (delayedEvent === 'close') h.child.emit('close', 0, null);
    const result = await operation;
    assert.equal(result.kind, 'unconfirmed');
    assert.match(result.reason, /deadline/);
    assert.equal(h.child.sent.length, delayedEvent === 'spawn' ? 0 : 1);
    h.assertClean();
  }
});

await test('stderr is bounded and its contents never enter the result', async () => {
  const h = harness();
  const operation = h.prepare();
  h.child.emit('spawn');
  h.child.stderr.emit('data', Buffer.from('private diagnostic payload'.repeat(3000)));
  h.child.emit('close', 0, null);
  const result = await operation;
  assert.equal(result.kind, 'unconfirmed');
  assert.match(result.reason, /diagnostic output limit/);
  assert.equal(result.reason.includes('private diagnostic payload'), false);
  assert.equal(h.child.sent.length, 1);
  h.assertClean();
});

console.log(`runtime root preparation client tests passed (${passed} cases; controlled child and clock)`);
