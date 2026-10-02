import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import esbuild from 'esbuild';

const { outputFiles } = await esbuild.build({
  entryPoints: ['extensions/vscode/dev-session-canvas/src/supervisor/runtimeSupervisorNamespace.ts'],
  bundle: true, platform: 'node', format: 'cjs', write: false, target: 'node16'
});

function harness(nodeVersion, { getuid = () => 1234, canonical = '/private/canonical-storage', realpathError } = {}) {
  const calls = [];
  const server = new EventEmitter();
  server.listen = (address, callback) => { calls.push(['listen', address]); queueMicrotask(callback); };
  server.unref = () => calls.push(['unref']);
  server.close = () => assert.fail('Namespace ownership must survive business-listener shutdown.');
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'process', outputFiles[0].text)(name => {
    if (name === 'crypto') return { createHash };
    if (name === 'fs/promises') return { async realpath(directory) {
      calls.push(['realpath', directory]);
      if (realpathError) throw realpathError;
      return canonical;
    } };
    if (name === 'net') return { createServer() { calls.push(['createServer']); return server; } };
    assert.fail(`Unexpected dependency: ${name}`);
  }, module, module.exports, { platform: 'linux', versions: { node: nodeVersion }, getuid });
  return { api: module.exports, calls, server };
}

for (const version of ['16.17.1', '18.20.8', '20.7.0']) {
  const missing = harness(version);
  assert.throws(() => missing.api.assertRuntimeSupervisorNamespaceSupport(), /Node >=20\.8/);
  assert.deepEqual(missing.calls, []);
  const old = harness(version);
  const claim = directory => old.calls.push(['nativeClaim', directory]);
  assert.doesNotThrow(() => old.api.assertRuntimeSupervisorNamespaceSupport(claim),
    `Linux Node ${version} must accept its native claim without acquiring startup resources.`);
  assert.equal(await old.api.acquireRuntimeSupervisorNamespace('/storage-alias', claim), undefined);
  assert.deepEqual(old.calls, [
    ['realpath', '/storage-alias'], ['nativeClaim', '/private/canonical-storage']
  ]);
  const rejected = harness(version);
  await assert.rejects(rejected.api.acquireRuntimeSupervisorNamespace('/storage-alias', () => {
    throw new Error('EADDRINUSE');
  }), /EADDRINUSE/);
  assert.deepEqual(rejected.calls, [['realpath', '/storage-alias']]);
  const missingDirectory = harness(version, { realpathError: new Error('ENOENT') });
  await assert.rejects(missingDirectory.api.acquireRuntimeSupervisorNamespace('/missing',
    () => assert.fail('Canonicalization failure must not acquire a native claim.')), /ENOENT/);
}

const expectedAddress = '\0dsc-runtime-owner-' + createHash('sha256')
  .update(JSON.stringify({ uid: 1234, storageDir: '/private/canonical-storage' })).digest('hex');
for (const version of ['20.8.0', '22.22.1', '25.6.0']) {
  const modern = harness(version);
  assert.strictEqual(await modern.api.acquireRuntimeSupervisorNamespace('/storage-alias',
    () => assert.fail('Modern Linux must retain the existing net.Server claim.')), modern.server);
  assert.deepEqual(modern.calls, [
    ['realpath', '/storage-alias'], ['createServer'], ['listen', expectedAddress], ['unref']
  ]);
}
for (const version of ['invalid', '20', '20.invalid']) {
  assert.throws(() => harness(version).api.assertRuntimeSupervisorNamespaceSupport(() => {}),
    'An unknown host version must not silently select a namespace implementation.');
}
assert.throws(() => harness('16.17.1', { getuid: null }).api.assertRuntimeSupervisorNamespaceSupport(() => {}));
console.log('Linux native namespace routing passed (controlled old/current Node, no native acquisition).');
