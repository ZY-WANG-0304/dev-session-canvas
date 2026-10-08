import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';

import esbuild from 'esbuild';

const require = createRequire(import.meta.url);
const { outputFiles } = await esbuild.build({
  entryPoints: [path.resolve('extensions/vscode/dev-session-canvas/src/panel/runtimeSystemdEnvironment.ts')],
  bundle: true, platform: 'node', format: 'cjs', target: 'node18', write: false
});
const options = {
  supervisorLauncherScriptPath: '/test scripts/launcher.js',
  environmentKey: 'a'.repeat(64),
  userIdentityKey: 'b'.repeat(64)
};
let passed = 0;

function fixture(changes = {}) {
  const calls = [];
  const fakeProcess = {
    platform: changes.platform ?? 'linux',
    execPath: '/test node',
    env: { PATH: '/untrusted-bin', LANG: 'example-locale' }
  };
  const module = { exports: {} };
  const fakeRequire = name => {
    if (name === 'node:child_process') return {
      execFile(file, args, execOptions, callback) {
        calls.push({ file, args, options: execOptions });
        const nonce = args.at(-1);
        callback(changes.execError ?? null, changes.stdout ?? JSON.stringify({
          schema: 1, nonce, environmentKey: options.environmentKey,
          userIdentityKey: options.userIdentityKey, ...changes.response
        }) + '\n', changes.stderr ?? '');
      }
    };
    if (name === 'node:path') return path.posix;
    return require(name);
  };
  new Function('require', 'module', 'exports', 'process', outputFiles[0].text)(
    fakeRequire, module, module.exports, fakeProcess
  );
  return { inspect: module.exports.inspectRuntimeSystemdEnvironment, calls };
}

async function check(changes, expected, input = options) {
  const harness = fixture(changes);
  assert.deepEqual(await harness.inspect(input), expected);
  passed += 1;
  return harness;
}

const available = await check({}, { kind: 'available' });
assert.equal(available.calls.length, 1);
const call = available.calls[0];
const nonce = call.args.at(-1);
assert.match(nonce, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
assert.equal(call.file, '/usr/bin/systemd-run');
assert.deepEqual(call.args, [
  '--user', '--wait', '--pipe', '--collect', '--quiet', '--no-ask-password',
  `--unit=dsc-root-scope-${nonce}`,
  '--property=RuntimeMaxSec=10s', '--property=TimeoutStopSec=2s', '--property=KillMode=control-group',
  '--property=JobTimeoutSec=10s', '--property=JobRunningTimeoutSec=10s',
  '--setenv=ELECTRON_RUN_AS_NODE=1', '--setenv=ELECTRON_NO_ATTACH_CONSOLE=1',
  '/test node', options.supervisorLauncherScriptPath, '--probe-root-environment', nonce
]);
assert.equal(call.options.timeout, 15_000);
assert.equal(call.options.maxBuffer, 16 * 1024);
assert.equal(call.options.shell, undefined);
assert.equal(call.options.env.LC_ALL, 'C');
assert.equal(call.options.env.LANG, 'C');
const second = await check({}, { kind: 'available' });
assert.notEqual(second.calls[0].args.at(-1), nonce);

const unsupported = await check({ platform: 'darwin' }, { kind: 'unavailable', reason: 'unsupported-platform' });
assert.deepEqual(unsupported.calls, []);
for (const input of [{ ...options, supervisorLauncherScriptPath: 'relative.js' },
  { ...options, supervisorLauncherScriptPath: '/invalid\0path' },
  { ...options, environmentKey: '' }, { ...options, userIdentityKey: 'raw-user-identity' }]) {
  const invalid = await check({}, { kind: 'unknown', reason: 'invalid-probe-input' }, input);
  assert.deepEqual(invalid.calls, []);
}
await check({ execError: Object.assign(new Error('private executable failure'), { code: 'ENOENT' }) },
  { kind: 'unavailable', reason: 'systemd-run-unavailable' });
for (const cause of ['No medium found', 'No such file or directory', 'Connection refused']) {
  for (const suffix of ['', ' (consider using --machine=<user>@.host --user to connect to bus of other user)']) {
    await check({ execError: Object.assign(new Error('private bus failure'), { code: 1 }),
      stderr: `Failed to connect to bus: ${cause}${suffix}\n` },
    { kind: 'unavailable', reason: 'user-bus-unavailable' });
  }
}
for (const response of [{ environmentKey: 'c'.repeat(64) }, { userIdentityKey: 'c'.repeat(64) }]) {
  await check({ response }, { kind: 'unavailable', reason: 'execution-scope-mismatch' });
}
for (const changes of [
  { execError: Object.assign(new Error('raw-secret-identity'), { code: 'EACCES' }) },
  { execError: Object.assign(new Error('timeout'), { code: 'ETIMEDOUT', killed: true }),
    stderr: 'Failed to connect to bus: No medium found' },
  { execError: Object.assign(new Error('signal'), { code: 1, signal: 'SIGTERM' }),
    stderr: 'Failed to connect to bus: Connection refused' },
  { execError: Object.assign(new Error('output overflow'), { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' }) },
  { execError: Object.assign(new Error('failure'), { code: 1 }), stderr: 'Failed to connect to bus: Permission denied' },
  { execError: Object.assign(new Error('failed unit'), { code: 1 }), stderr: 'Failed to start transient service unit' }
]) {
  await check(changes, { kind: 'unknown', reason: 'environment-probe-failed' });
}
for (const changes of [
  { stderr: 'unexpected diagnostics' }, { stdout: '' }, { stdout: 'noise' }, { stdout: 'null' }, { stdout: '[]' },
  { response: { schema: 2 } }, { response: { nonce: 'another-probe' } }, { response: { extra: 'unsupported' } },
  { response: { environmentKey: '' } }, { response: { userIdentityKey: 'raw-user-identity' } },
  { response: { userIdentityKey: undefined } }
]) {
  await check(changes, { kind: 'unknown', reason: 'invalid-probe-response' });
}

console.log(`runtime systemd environment tests passed (${passed} controlled source cases; no native manager execution claim).`);
