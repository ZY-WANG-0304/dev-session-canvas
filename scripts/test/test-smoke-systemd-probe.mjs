import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import vm from 'node:vm';
import esbuild from 'esbuild';

if (process.platform !== 'linux') {
  console.log('fake systemd probe requires Linux; skipped on this platform.');
} else {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dsc-systemd-probe-'));
  const shim = path.resolve('tests/vscode-smoke/fixtures/fake-systemd/systemd-run.cjs');
  const launcher = path.join(directory, 'original launcher.cjs');
  const support = path.join(directory, 'support.cjs');
  const envNames = ['DEV_SESSION_CANVAS_TEST_SYSTEMD_RUN_SHIM', 'DEV_SESSION_CANVAS_TEST_NODE_PATH'];
  const original = envNames.map(name => process.env[name]);
  let passed = 0;
  try {
    await esbuild.build({ entryPoints: ['extensions/vscode/dev-session-canvas/src/supervisor/runtimeSupervisorLauncher.ts'],
      bundle: true, platform: 'node', format: 'cjs', outfile: launcher });
    await esbuild.build({ stdin: { contents: `
      export * from './extensions/vscode/dev-session-canvas/src/panel/runtimeSystemdEnvironment';
      export * from './extensions/vscode/dev-session-canvas/src/panel/runtimeExecutionEnvironment';
    `, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', outfile: support });
    const api = createRequire(import.meta.url)(support);
    const environment = await api.readRuntimeExecutionEnvironment();
    const input = { supervisorLauncherScriptPath: launcher, environmentKey: environment.environmentKey,
      userIdentityKey: createHash('sha256').update(environment.userIdentity).digest('hex') };
    process.env.DEV_SESSION_CANVAS_TEST_SYSTEMD_RUN_SHIM = shim;
    process.env.DEV_SESSION_CANVAS_TEST_NODE_PATH = process.execPath;
    const check = async (changes, expected) => {
      assert.deepEqual(await api.inspectRuntimeSystemdEnvironment({ ...input, ...changes }), expected);
      passed++;
    };
    await check({}, { kind: 'available' }); // Real source launcher and OS identities, no fake JSON.
    await check({ environmentKey: '0'.repeat(64) }, { kind: 'unavailable', reason: 'execution-scope-mismatch' });
    await check({ userIdentityKey: '0'.repeat(64) }, { kind: 'unavailable', reason: 'execution-scope-mismatch' });
    for (const [contents, expected] of [
      ["process.stdout.write('invalid-json');", { kind: 'unknown', reason: 'invalid-probe-response' }],
      ["process.stdout.write(JSON.stringify({schema:1,nonce:'wrong',environmentKey:'a'.repeat(64),userIdentityKey:'b'.repeat(64)}));",
        { kind: 'unknown', reason: 'invalid-probe-response' }],
      ["process.exitCode = 7;", { kind: 'unknown', reason: 'environment-probe-failed' }],
      ["process.kill(process.pid, 'SIGTERM');", { kind: 'unknown', reason: 'environment-probe-failed' }]
    ]) {
      const childPath = path.join(directory, 'controlled launcher.cjs');
      await writeFile(childPath, contents);
      await check({ supervisorLauncherScriptPath: childPath }, expected);
    }
    // The shim rejects non-probe commands instead of spawning arbitrary service work.
    await assert.rejects(promisify(execFile)(process.execPath, [shim, '--user', 'arbitrary-service'], { timeout: 5000 }));
    passed++;

    // Terminating the caller must also terminate its owned probe child.
    const pidFile = path.join(directory, 'owned-child.pid');
    const holdPath = path.join(directory, 'held launcher.cjs');
    await writeFile(holdPath, `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000);`);
    await check({ supervisorLauncherScriptPath: holdPath }, { kind: 'unknown', reason: 'environment-probe-failed' });
    const timedOutPid = Number(await readFile(pidFile, 'utf8'));
    assert.throws(() => process.kill(timedOutPid, 0), { code: 'ESRCH' }, 'Timed out probe must leave no child');
    await rm(pidFile); // The next barrier must observe its new child, never the timeout's old PID.
    const nonce = randomUUID();
    const args = ['--user', '--wait', '--pipe', '--collect', '--quiet', '--no-ask-password',
      `--unit=dsc-root-scope-${nonce}`, '--property=TimeoutStartSec=10s', '--property=RuntimeMaxSec=10s',
      '--property=TimeoutStopSec=2s', '--property=KillMode=control-group',
      '--setenv=ELECTRON_RUN_AS_NODE=1', '--setenv=ELECTRON_NO_ATTACH_CONSOLE=1',
      process.execPath, holdPath, '--probe-root-environment', nonce];
    const child = spawn(process.execPath, [shim, ...args], { stdio: 'ignore' });
    const completed = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
    try {
      const deadline = Date.now() + 5000;
      let pid;
      while (!pid && Date.now() < deadline) {
        try { pid = Number(await readFile(pidFile, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (!pid) await new Promise(resolve => setTimeout(resolve, 20));
      }
      assert.ok(pid, 'Probe child must start before testing caller termination');
      child.kill('SIGTERM');
      await completed;
      assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
      passed++;
    } finally {
      child.kill('SIGTERM');
      await completed;
    }
    const source = await readFile('scripts/smoke/run-vscode-smoke.mjs', 'utf8');
    const sceneSource = source.slice(source.indexOf('async function runSystemdUserRealWindowReopenScenario()'),
      source.indexOf('async function runLocalRealWindowReopenScenario(options)'));
    const scenes = [];
    const sandbox = { fakeSystemdShimPath: '/fake/systemctl.cjs', fakeSystemdProbeShimPath: shim,
      runLocalRealWindowReopenScenario: async options => { scenes.push(options); },
      path, smokeDebugRoot: directory, fs: { access: async () => { throw Object.assign(new Error('no submission'), { code: 'ENOENT' }); } },
      console: { log() {} } };
    vm.createContext(sandbox);
    await vm.runInContext(`${sceneSource}\nrunSystemdUserRealWindowReopenScenario().then(runSystemdFallbackRealWindowReopenScenario)`, sandbox);
    assert.equal(scenes.length, 2);
    assert.equal(scenes[0].extraEnv.DEV_SESSION_CANVAS_TEST_SYSTEMD_RUN_SHIM, shim);
    assert.equal(scenes[0].expectedRuntimeBackend, 'systemd-user');
    assert.equal(scenes[0].expectedRuntimeGuarantee, 'strong');
    assert.equal(scenes[1].extraEnv.DEV_SESSION_CANVAS_TEST_SYSTEMD_RUN_SHIM, '');
    assert.equal(scenes[1].extraEnv.DBUS_SESSION_BUS_ADDRESS, '');
    assert.equal(scenes[1].extraEnv.XDG_RUNTIME_DIR, '');
    assert.equal(scenes[1].expectedRuntimeBackend, 'legacy-detached');
    passed += 2;
    console.log(`fake systemd probe passed (${passed} actual child/launcher cases; no native manager claim).`);
  } finally {
    envNames.forEach((name, i) => { if (original[i] === undefined) delete process.env[name]; else process.env[name] = original[i]; });
    await rm(directory, { recursive: true, force: true });
  }
}
