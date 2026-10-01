import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import esbuild from 'esbuild';

const require = createRequire(import.meta.url);
const { outputFiles } = await esbuild.build({
  entryPoints: ['extensions/vscode/dev-session-canvas/src/supervisor/runtimeSupervisorNamespace.ts'],
  bundle: true, platform: 'node', format: 'cjs', write: false
});

function harness({ canonical = 'C:\\Users\\Owner\\storage', listenError, endpointError = 'ENOENT', active = false } = {}) {
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
  }, module, module.exports, { platform: 'win32', versions: { node: '25.6.0' } });
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
console.log('Windows namespace controlled contract passed (no actual Windows claim or PTY).');
