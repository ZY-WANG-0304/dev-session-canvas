import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import esbuild from 'esbuild';

const require = createRequire(import.meta.url);
const { outputFiles } = await esbuild.build({
  entryPoints: [path.resolve('extensions/vscode/dev-session-canvas/src/supervisor/runtimeSupervisorMain.ts')],
  bundle: true, platform: 'node', format: 'cjs', external: ['node-pty'], write: false,
  plugins: [{ name: 'persistence-fixture', setup(build) {
    build.onResolve({ filter: /runtimePersistenceCapability$/ }, () => ({ path: 'controlled:persistence', external: true }));
  } }]
});
const forbidden = () => assert.fail('No real process, network or system changes allowed');
let observation = { status: 'blocked', reason: 'linger-disabled' };
let verified = false;
let inspected = 0;
const loaded = { exports: {} };
const fakeProcess = { ...process, platform: 'linux', env: { ...process.env,
  HOME: '/controlled-home', XDG_CONFIG_HOME: '/controlled-home/.config' } };
new Function('require', 'module', 'exports', '__dirname', 'globalThis', 'process', outputFiles[0].text)(name => {
  if (name === 'controlled:persistence') return {
    async inspectRuntimePersistenceCapability() { inspected++; return observation; },
    async verifyRuntimePersistenceUnit() { return verified; }
  };
  if (['child_process', 'node:child_process', 'node-pty'].includes(name)) {
    return { spawn: forbidden, spawnSync: forbidden, execFile: forbidden, fork: forbidden };
  }
  return require(name);
}, loaded, loaded.exports, process.cwd(), { process: fakeProcess }, fakeProcess);
const { RuntimeSupervisorServer } = loaded.exports;
const request = { sessionId: 'original-request', kind: 'terminal', displayLabel: 'terminal', launchMode: 'start',
  scrollback: 100, requireLoginIndependentPersistence: true,
  launchSpec: { file: '/never', args: [], cwd: '/', cols: 80, rows: 24, env: {} } };
let acquired = 0;
function fixture(backend = 'systemd-user') {
  const server = new RuntimeSupervisorServer({ storageDir: '/controlled-runtime' }, backend, 'strong');
  server.executionOwner = {
    admissionLimits: { executions: 1 },
    get() { return undefined; },
    reserve() { acquired++; throw new Error('controlled reservation boundary'); }
  };
  return server;
}
for (const status of ['blocked', 'unknown']) {
  observation = { status, reason: 'observation-failed' };
  const server = fixture();
  await assert.rejects(server.createSession({}, request), error => {
    assert.equal(error.code, 'DEV_SESSION_CANVAS_RUNTIME_PERSISTENCE_NOT_READY');
    assert.deepEqual(error.createSessionOutcome, { kind: 'not-acquired', sessionId: request.sessionId, sessionKind: 'terminal' });
    return true;
  });
  assert.equal(server.sessions.size, 0);
  assert.equal(acquired, 0);
}
observation = { status: 'eligible' };
await assert.rejects(fixture().createSession({}, request), /Background persistence is not ready/);
assert.equal(acquired, 0);
verified = true;
await assert.rejects(fixture().createSession({}, request), /controlled reservation boundary/);
assert.equal(acquired, 1);
const before = inspected;
await assert.rejects(fixture('legacy-detached').createSession({}, request), /Background persistence is not ready/);
assert.equal(inspected, before);
assert.equal(acquired, 1);
await assert.rejects(fixture().createSession({}, { ...request, requireLoginIndependentPersistence: false }), /Background persistence is not ready/);
assert.equal(acquired, 1);
const legacy = fixture('legacy-detached');
await assert.rejects(legacy.createSession({}, { ...request, requireLoginIndependentPersistence: undefined }), /controlled reservation boundary/);
assert.equal(acquired, 2);
console.log('Runtime persistence server: 7 admission checks passed; no real acquisition or system commands.');
