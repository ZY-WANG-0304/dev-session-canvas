import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import esbuild from 'esbuild';

const require = createRequire(import.meta.url);
const { outputFiles } = await esbuild.build({
  entryPoints: ['extensions/vscode/dev-session-canvas/src/supervisor/runtimeSupervisorNamespace.ts'],
  bundle: true, platform: 'node', format: 'cjs', write: false
});

function harness({ canonical = 'C:\\Users\\Owner\\storage', listenError, endpointError = 'ENOENT', active = false,
  nodeVersion = '25.6.0', platform = 'win32', getuid } = {}) {
  const calls = [];
  const server = new EventEmitter();
  server.listen = (name, callback) => {
    calls.push(['listen', name]);
    queueMicrotask(() => listenError ? server.emit('error', new Error(listenError)) : callback());
  };
  server.unref = () => calls.push(['unref']);
  server.close = () => assert.fail('The claim must survive business shutdown.');
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'process', outputFiles[0].text)(name => {
    if (name === 'crypto') return require('node:crypto');
    if (name === 'fs/promises') return {
      realpath: async dir => { calls.push(['realpath', dir]); return canonical; },
      lstat: () => assert.fail('Windows named pipes are not filesystem sockets.'),
      unlink: () => assert.fail('Never unlink a Windows named pipe.')
    };
    if (name === 'net') return {
      createServer: callback => { calls.push(['createServer']); assert.equal(typeof callback, 'function'); return server; },
      createConnection: pipe => {
        calls.push(['probe', pipe]);
        const socket = new EventEmitter();
        socket.destroy = () => queueMicrotask(() => socket.emit('close'));
        queueMicrotask(() => active ? socket.emit('connect')
          : socket.emit('error', Object.assign(new Error(endpointError), { code: endpointError })));
        return socket;
      }
    };
    assert.fail(`Unexpected dependency: ${name}`);
  }, module, module.exports, { platform, versions: { node: nodeVersion }, getuid });
  return { api: module.exports, calls, server };
}

const original = harness();
assert.doesNotThrow(() => original.api.assertRuntimeSupervisorNamespaceSupport());
assert.strictEqual(await original.api.acquireRuntimeSupervisorNamespace('alias'), original.server);
const name = original.calls.find(([kind]) => kind === 'listen')[1];
assert.match(name, /^\\\\\.\\pipe\\dsc-runtime-owner-[a-f0-9]{64}$/);
assert.deepEqual(original.calls.map(([kind]) => kind), ['realpath', 'createServer', 'listen', 'unref']);
const alias = harness({ canonical: 'c:\\users\\owner\\STORAGE' });
await alias.api.acquireRuntimeSupervisorNamespace('another-alias');
assert.equal(alias.calls.find(([kind]) => kind === 'listen')[1], name);
const competitor = harness({ listenError: 'EADDRINUSE' });
await assert.rejects(competitor.api.acquireRuntimeSupervisorNamespace('same-storage'), /EADDRINUSE/);
assert.equal(competitor.calls.some(([kind]) => kind === 'unref'), false);
await original.api.prepareRuntimeSupervisorSocketPath('\\\\.\\pipe\\business');
await assert.rejects(harness({ active: true }).api.prepareRuntimeSupervisorSocketPath('\\\\.\\pipe\\business'), /already active/);
await assert.rejects(harness({ endpointError: 'EACCES' }).api.prepareRuntimeSupervisorSocketPath('\\\\.\\pipe\\business'), /EACCES/);
for (const nodeVersion of ['16.17.1', '18.20.8', '20.7.0']) {
  const legacy = harness({ nodeVersion });
  assert.doesNotThrow(() => legacy.api.assertRuntimeSupervisorNamespaceSupport(),
    `Windows Node ${nodeVersion} must not inherit the Linux abstract-socket version requirement.`);
  assert.strictEqual(await legacy.api.acquireRuntimeSupervisorNamespace('legacy-alias',
    () => assert.fail('Windows must retain the named-pipe claim.')), legacy.server);
  assert.equal(legacy.calls.find(([kind]) => kind === 'listen')[1], name);
  assert.deepEqual(legacy.calls.map(([kind]) => kind), ['realpath', 'createServer', 'listen', 'unref']);
  await assert.rejects(harness({ nodeVersion, listenError: 'EADDRINUSE' })
    .api.acquireRuntimeSupervisorNamespace('same-storage'), /EADDRINUSE/);
  await assert.rejects(harness({ nodeVersion, active: true })
    .api.prepareRuntimeSupervisorSocketPath('\\\\.\\pipe\\business'), /already active/);
  await assert.rejects(harness({ nodeVersion, endpointError: 'EACCES' })
    .api.prepareRuntimeSupervisorSocketPath('\\\\.\\pipe\\business'), /EACCES/);
  const linux = harness({ platform: 'linux', nodeVersion, getuid: () => 1234 });
  assert.throws(() => linux.api.assertRuntimeSupervisorNamespaceSupport(), /Node >=20\.8/);
  assert.deepEqual(linux.calls, [], 'Unsupported Linux hosts must fail before namespace resources.');
}
const darwin = harness({ platform: 'darwin', nodeVersion: '16.17.1', getuid: () => 1234 });
assert.throws(() => darwin.api.assertRuntimeSupervisorNamespaceSupport());
assert.doesNotThrow(() => darwin.api.assertRuntimeSupervisorNamespaceSupport(() => {}));
assert.throws(() => harness({ platform: 'darwin', nodeVersion: '16.17.1' })
  .api.assertRuntimeSupervisorNamespaceSupport(() => {}));
console.log('Windows namespace controlled contract passed (no actual Windows claim or PTY).');
