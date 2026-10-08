import assert from 'node:assert/strict';
import { execFile, fork } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, rmdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import esbuild from 'esbuild';

const require = createRequire(import.meta.url);
const execFileAsync = promisify(execFile);
const filename = fileURLToPath(import.meta.url);
const extensionRoot = path.resolve('extensions/vscode/dev-session-canvas');
const launcher = path.join(extensionRoot, 'dist', 'runtime-supervisor-launcher.js');
const supervisor = path.join(extensionRoot, 'dist', 'runtime-supervisor.js');
const profile = ({ linux: 'linux-owner-v1-candidate', darwin: 'macos-owner-v1-candidate',
  win32: 'windows-owner-v1-candidate' })[process.platform];
const childEnvironment = { ...process.env, ELECTRON_RUN_AS_NODE: '1', ELECTRON_NO_ATTACH_CONSOLE: '1' };

if (process.argv[1] && path.resolve(process.argv[1]) === filename) {
  if (process.argv[2] === '--hold-claim') await holdClaim();
  else await runTests();
}

// Only temporary test launchers import this entry; production scripts remain unchanged.
export async function runInterruptionLauncher(config) {
  const args = process.argv.slice(2);
  const phase = args.includes('--probe-root-runtime') ? 'before-intent'
    : args.includes('--supervisor-script') ? 'after-submit' : undefined;
  assert.equal(args[args.indexOf('--storage-dir') + 1], config.storageDir);
  if (phase === config.phase) {
    const entered = { phase, pid: process.pid, token: args[args.indexOf('--runtime-launch-token') + 1] };
    if (phase === 'before-intent') delete entered.token;
    await writeFile(path.join(config.directory, `${randomUUID()}.invocation`), JSON.stringify(entered), { flag: 'wx', mode: 0o600 });
    const api = require(config.supportPath);
    assert.ok(await api.readRuntimeRootOwner(config.gateStorageDir, profile));
    const native = api.createNativeExecutionOwnerOptions({ extensionRoot, profile, mode: 'live-runtime' });
    await api.acquireRuntimeSupervisorNamespace(config.gateStorageDir,
      native.kind === 'windows-provider' ? undefined : native.claimNamespace);
    await writeFile(path.join(config.directory, 'entered.tmp'), JSON.stringify(entered), { flag: 'wx', mode: 0o600 });
    await rename(path.join(config.directory, 'entered.tmp'), path.join(config.directory, 'entered.json'));
    const deadline = Date.now() + 60000;
    while (true) {
      if (await exists(path.join(config.directory, 'abort'))) return;
      if (Date.now() >= deadline) throw new Error('The test launcher barrier expired without permission to submit.');
      if (await exists(path.join(config.directory, 'release'))) break;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }
  // The real probe runs in a separate process because native claims are one-shot.
  const result = await runLauncher(args);
  if (phase === config.phase) {
    await writeFile(path.join(config.directory, 'forwarded'), 'closed', { flag: 'wx', mode: 0o600 });
  }
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
}

async function holdClaim() {
  const [, , , supportPath, storageDir] = process.argv;
  try {
    assert.ok(process.send && process.connected);
    const api = require(supportPath);
    assert.ok(await api.readRuntimeRootOwner(storageDir, profile));
    const native = api.createNativeExecutionOwnerOptions({ extensionRoot, profile, mode: 'live-runtime' });
    await api.acquireRuntimeSupervisorNamespace(storageDir,
      native.kind === 'windows-provider' ? undefined : native.claimNamespace);
    process.once('message', message => { if (message === 'release') process.disconnect(); });
    process.send({ kind: 'claimed' });
  } catch (error) {
    process.exitCode = 1;
    if (process.send && process.connected) process.send({ kind: 'failed', reason: error.message }, () => process.disconnect());
    else process.stderr.write('Controlled claim child failed.\n');
  }
}

async function runTests() {
  assert.ok(profile, 'A supported native execution platform is required.');
  await access(launcher);
  await access(supervisor);
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dsc-native-root-preparation-')));
  const supportPath = path.join(directory, 'support.cjs');
  const clients = [];
  const roots = [];
  const holders = [];
  const helpers = [];
  const barriers = [];
  let api;
  let failed;
  try {
    await esbuild.build({ stdin: { contents: `
      export * from './extensions/vscode/dev-session-canvas/src/common/runtimeRootOwnership';
      export * from './extensions/vscode/dev-session-canvas/src/common/runtimeSupervisorPaths';
      export * from './extensions/vscode/dev-session-canvas/src/panel/runtimeExecutionEnvironment';
      export * from './extensions/vscode/dev-session-canvas/src/panel/runtimeSystemdEnvironment';
      export * from './extensions/vscode/dev-session-canvas/src/panel/executionOwnerFactory';
      export { RuntimeSupervisorClient } from './extensions/vscode/dev-session-canvas/src/panel/runtimeSupervisorClient';
      export * from './extensions/vscode/dev-session-canvas/src/supervisor/runtimeRootOwner';
      export * from './extensions/vscode/dev-session-canvas/src/supervisor/runtimeRootStartup';
      export * from './extensions/vscode/dev-session-canvas/src/supervisor/runtimeSupervisorNamespace';
    `, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', outfile: supportPath });
    api = require(supportPath);
    const environment = await api.readRuntimeExecutionEnvironment();
    const nonce = randomUUID();
    const preflight = await runLauncher(['--probe-root-environment', nonce]);
    assert.notEqual(preflight.stdout, '', 'Native launcher produced no output; child process execution may be restricted.');
    const observedEnvironment = JSON.parse(preflight.stdout);
    assert.equal(observedEnvironment.nonce, nonce);
    assert.equal(observedEnvironment.environmentKey, environment.environmentKey);
    assert.equal(preflight.stderr, '');
    const globalStorage = path.join(directory, 'global');
    await mkdir(globalStorage, { mode: 0o700 });

    function root(name) {
      const owner = api.createRuntimeOwnerDescriptor({ environmentKey: environment.environmentKey,
        userStorageScopeKey: api.createRuntimeUserStorageScopeKey(environment.userIdentity, globalStorage),
        rootPath: path.join(directory, name), generation: api.resolveRootRuntimeSupervisorGeneration(profile) });
      const base = api.resolveRuntimeRootOwnerBaseStoragePath(globalStorage, owner);
      const value = { owner, base, storageDir: path.join(base, 'runtime-supervisor'), attempted: false, pendingFixture: false };
      roots.push(value);
      return value;
    }
    function launchPreparation(value, preferredBackends = ['legacy-detached'], launcherScript = launcher) {
      value.attempted = true;
      const child = fork(launcher, ['--prepare-root-runtime'], {
        env: childEnvironment, stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true
      });
      child.stderr.resume();
      const messages = [];
      let childError;
      const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
      const stderrClosed = new Promise(resolve => child.stderr.once('close', resolve));
      const disconnected = new Promise(resolve => child.once('disconnect', resolve));
      // Parent-initiated disconnect can suppress Node's aggregate close event.
      // Require the actual exit and closure of both piped resources in that case.
      const closed = Promise.race([
        new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal }))),
        Promise.all([exited, stderrClosed, disconnected]).then(([result]) => result)
      ]);
      const helper = { child, closed, messages, get error() { return childError; } };
      helpers.push(helper);
      child.on('error', error => { childError = error; });
      child.on('message', message => messages.push(message));
      child.once('spawn', () => child.send({ type: 'prepare-root-runtime', storageDir: value.storageDir,
        owner: value.owner, executionProfile: profile, preferredBackends, supervisorScriptPath: supervisor,
        supervisorLauncherScriptPath: launcherScript }, error => { if (error) childError = error; }));
      return helper;
    }
    async function prepare(value, preferredBackends = ['legacy-detached'], launcherScript = launcher) {
      const helper = launchPreparation(value, preferredBackends, launcherScript);
      const result = await bounded(helper.closed, 40000, 'Native preparation helper did not close within its watchdog budget.');
      assert.equal(helper.error, undefined, 'Native preparation helper must start and send its request successfully.');
      assert.equal(result.code, 0, 'Native preparation helper must exit normally.');
      assert.equal(helper.messages.length, 1, 'Native preparation helper must send exactly one result before closing.');
      assert.ok(['ready', 'unconfirmed', 'rejected'].includes(helper.messages[0]?.kind));
      return helper.messages[0];
    }
    async function createBarrier(value, phase) {
      const gate = root(`wrapper-${phase}`);
      await api.prepareRuntimeRootOwnerDirectories(gate.storageDir, gate.owner);
      await api.publishRuntimeRootOwner(gate.storageDir, gate.owner);
      const control = path.join(directory, phase);
      await mkdir(control, { mode: 0o700 });
      const config = { phase, directory: control, storageDir: value.storageDir, gateStorageDir: gate.storageDir, supportPath };
      const launcherScript = path.join(control, 'launcher.mjs');
      await writeFile(launcherScript, `import { runInterruptionLauncher } from ${JSON.stringify(pathToFileURL(filename).href)};\nawait runInterruptionLauncher(${JSON.stringify(config)});\n`, { flag: 'wx', mode: 0o600 });
      const barrier = { gate, directory: control, launcherScript, entered: false };
      barriers.push(barrier);
      return barrier;
    }
    async function connect(value, kind = 'legacy-detached') {
      const client = new api.RuntimeSupervisorClient({ backend: { kind, guarantee: kind === 'systemd-user' ? 'strong' : 'best-effort',
        label: 'native test', paths: kind === 'systemd-user' ? api.resolveSystemdUserRuntimeSupervisorPathsFromStorageDir(value.storageDir)
          : api.resolveRuntimeSupervisorPathsFromStorageDir(value.storageDir),
        startSupervisor: () => assert.fail('The native test client cannot start a Supervisor.') },
      executionProfile: profile, expectedRuntimeOwner: value.owner, supervisorScriptPath: supervisor,
      supervisorLauncherScriptPath: launcher });
      clients.push(client);
      await client.ensureConnected({ allowRestart: false });
      const hello = await client.hello();
      assert.deepEqual(hello.runtimeOwner, value.owner);
      assert.equal(hello.runtimeBackend, kind);
      assert.ok(Number.isSafeInteger(hello.pid) && hello.pid > 0);
      return { client, hello };
    }
    const first = root('first');
    const concurrent = await Promise.all([prepare(first), prepare(first)]);
    assert.ok(concurrent.every(result => ['ready', 'unconfirmed'].includes(result.kind)), JSON.stringify(concurrent));
    assert.deepEqual(await prepare(first), { kind: 'ready', backend: 'legacy-detached' });
    const a = await connect(first);
    const firstIntent = await api.readRuntimeRootStartupIntent(first.storageDir, first.owner);
    assert.equal((await api.inspectRuntimeRootStartup(first.storageDir, first.owner)).kind, 'previous-started');
    const ownerBytes = await readFile(path.join(first.base, 'owner.json'), 'utf8');
    const intentBytes = await readFile(path.join(first.base, 'startup-intent.json'), 'utf8');
    const receiptBytes = await readFile(path.join(first.base, 'startup-started.json'), 'utf8');
    assert.deepEqual(await prepare(first), { kind: 'ready', backend: 'legacy-detached' });
    const reused = await connect(first);
    assert.equal(reused.hello.pid, a.hello.pid);
    assert.equal(await readFile(path.join(first.base, 'owner.json'), 'utf8'), ownerBytes);
    assert.equal(await readFile(path.join(first.base, 'startup-intent.json'), 'utf8'), intentBytes);
    assert.equal(await readFile(path.join(first.base, 'startup-started.json'), 'utf8'), receiptBytes);
    assert.deepEqual(await api.prepareRootRuntimeSupervisor({ storageDir: first.storageDir, owner: first.owner,
      executionProfile: profile, preferredBackends: ['legacy-detached'], supervisorScriptPath: supervisor,
      supervisorLauncherScriptPath: launcher }), { kind: 'ready', backend: 'legacy-detached' });
    reused.client.dispose();
    console.log('Same-owner concurrent helpers converge and ready reuse preserves authority and token.');

    const second = root('second');
    assert.deepEqual(await prepare(second), { kind: 'ready', backend: 'legacy-detached' });
    const b = await connect(second);
    assert.notEqual(b.hello.pid, a.hello.pid);
    assert.notEqual(second.storageDir, first.storageDir);

    const cancelled = root('cancelled-before-intent');
    const beforeIntent = await createBarrier(cancelled, 'before-intent');
    const cancelledHelper = launchPreparation(cancelled, ['legacy-detached'], beforeIntent.launcherScript);
    assert.equal((await waitBarrier(beforeIntent)).phase, 'before-intent');
    assert.equal(await api.readRuntimeRootStartupIntent(cancelled.storageDir, cancelled.owner), undefined);
    assert.equal(cancelledHelper.child.connected, true);
    cancelledHelper.child.disconnect();
    await writeFile(path.join(beforeIntent.directory, 'release'), 'release', { flag: 'wx', mode: 0o600 });
    assert.equal((await bounded(cancelledHelper.closed, 15000, 'The cancelled preparation helper did not close.')).code, 0);
    assert.equal(cancelledHelper.error, undefined);
    assert.equal(cancelledHelper.messages.length, 0);
    await waitUnowned(beforeIntent.gate);
    await access(path.join(beforeIntent.directory, 'forwarded'));
    assert.equal(await api.readRuntimeRootStartupIntent(cancelled.storageDir, cancelled.owner), undefined);
    assert.deepEqual(await prepare(cancelled), { kind: 'ready', backend: 'legacy-detached' });
    (await connect(cancelled)).client.dispose();
    assert.equal((await readdir(beforeIntent.directory)).filter(name => name.endsWith('.invocation')).length, 1);
    console.log('A real pre-intent IPC disconnect closes the helper without an intent; fresh preparation succeeds.');

    const interrupted = root('interrupted-after-submit');
    const afterSubmit = await createBarrier(interrupted, 'after-submit');
    const interruptedHelper = launchPreparation(interrupted, ['legacy-detached'], afterSubmit.launcherScript);
    const submitted = await waitBarrier(afterSubmit);
    assert.equal(interruptedHelper.child.exitCode, null);
    assert.equal(interruptedHelper.child.signalCode, null);
    assert.equal(interruptedHelper.child.kill('SIGKILL'), true);
    const crashed = await bounded(interruptedHelper.closed, 10000, 'The test-owned preparation helper did not close after termination.');
    assert.ok(crashed.signal === 'SIGKILL' || (crashed.code !== null && crashed.code !== 0));
    assert.equal(interruptedHelper.error, undefined);
    assert.equal(interruptedHelper.messages.length, 0);
    const submittedIntent = await api.readRuntimeRootStartupIntent(interrupted.storageDir, interrupted.owner);
    assert.equal(submitted.phase, 'after-submit');
    assert.equal(submitted.token, submittedIntent.token);
    const submittedBytes = await readFile(path.join(interrupted.base, 'startup-intent.json'), 'utf8');
    await assert.rejects(readFile(path.join(interrupted.base, 'startup-started.json')), { code: 'ENOENT' });
    assert.equal(await isUnowned(interrupted), true);
    assert.equal((await prepare(interrupted, ['legacy-detached'], afterSubmit.launcherScript)).kind, 'unconfirmed');
    assert.equal(await readFile(path.join(interrupted.base, 'startup-intent.json'), 'utf8'), submittedBytes);
    await assert.rejects(readFile(path.join(interrupted.base, 'startup-started.json')), { code: 'ENOENT' });
    assert.equal((await readdir(afterSubmit.directory)).filter(name => name.endsWith('.invocation')).length, 1);
    await writeFile(path.join(afterSubmit.directory, 'release'), 'release', { flag: 'wx', mode: 0o600 });
    await waitUnowned(afterSubmit.gate);
    await access(path.join(afterSubmit.directory, 'forwarded'));
    let lateReady;
    const lateDeadline = Date.now() + 15000;
    do {
      lateReady = await prepare(interrupted, ['legacy-detached'], afterSubmit.launcherScript);
      if (lateReady.kind !== 'unconfirmed') break;
      await new Promise(resolve => setTimeout(resolve, 100));
    } while (Date.now() < lateDeadline);
    assert.deepEqual(lateReady, { kind: 'ready', backend: 'legacy-detached' });
    const late = await connect(interrupted);
    assert.deepEqual(await prepare(interrupted), { kind: 'ready', backend: 'legacy-detached' });
    const lateReused = await connect(interrupted);
    assert.equal(lateReused.hello.pid, late.hello.pid);
    assert.equal(await readFile(path.join(interrupted.base, 'startup-intent.json'), 'utf8'), submittedBytes);
    assert.equal((await api.inspectRuntimeRootStartup(interrupted.storageDir, interrupted.owner)).kind, 'previous-started');
    assert.equal((await readdir(afterSubmit.directory)).filter(name => name.endsWith('.invocation')).length, 1);
    lateReused.client.dispose();
    late.client.dispose();
    console.log('A real preparation crash after detached submission does not resubmit pending intent; late ready is freshly discovered and reused.');

    if (process.platform === 'linux') {
      const scope = await api.inspectRuntimeSystemdEnvironment({ supervisorLauncherScriptPath: launcher,
        environmentKey: environment.environmentKey, userIdentityKey: createHash('sha256').update(environment.userIdentity).digest('hex') });
      assert.notEqual(scope.kind, 'unknown', `Native systemd environment is unknown: ${scope.reason}`);
      if (scope.kind === 'unavailable') console.log(`systemd not-verified:${scope.reason}`);
      else {
        assert.equal(scope.kind, 'available');
        const service = root('systemd');
        service.systemdPaths = api.resolveSystemdUserRuntimeSupervisorPathsFromStorageDir(service.storageDir);
        await assert.rejects(access(service.systemdPaths.unitFilePath), { code: 'ENOENT' });
        const result = await prepare(service, ['systemd-user', 'legacy-detached']);
        service.unitBytes = await readFile(service.systemdPaths.unitFilePath, 'utf8');
        assert.deepEqual(result, { kind: 'ready', backend: 'systemd-user' });
        const live = await connect(service, 'systemd-user');
        const intent = await readFile(path.join(service.base, 'startup-intent.json'), 'utf8');
        assert.deepEqual(await prepare(service, ['legacy-detached']), { kind: 'ready', backend: 'systemd-user' });
        const reusedService = await connect(service, 'systemd-user');
        assert.equal(reusedService.hello.pid, live.hello.pid);
        assert.equal(await readFile(path.join(service.base, 'startup-intent.json'), 'utf8'), intent);
        assert.equal(await readFile(service.systemdPaths.unitFilePath, 'utf8'), service.unitBytes);
        reusedService.client.dispose();
        live.client.dispose();
        console.log('Native systemd startup passed and detached preference reused the existing systemd owner.');
      }
    }

    const pending = root('pending-record-fixture');
    pending.pendingFixture = true;
    await api.prepareRuntimeRootOwnerDirectories(pending.storageDir, pending.owner);
    await api.publishRuntimeRootOwner(pending.storageDir, pending.owner);
    const pendingIntent = api.createRuntimeRootStartupIntent(pending.owner, 'legacy-detached',
      api.createRuntimeOwnerCompatibilityFingerprint(pending.owner.generation, profile));
    await api.writeRuntimeRootStartupIntent(pending.storageDir, pendingIntent);
    for (let attempt = 0; attempt < 2; attempt++) assert.equal((await prepare(pending)).kind, 'unconfirmed');
    assert.deepEqual(await api.readRuntimeRootStartupIntent(pending.storageDir, pending.owner), pendingIntent);
    await assert.rejects(readFile(path.join(pending.base, 'startup-started.json')), { code: 'ENOENT' });
    assert.equal(await isUnowned(pending), true);

    const occupied = root('claim-without-endpoint');
    await api.prepareRuntimeRootOwnerDirectories(occupied.storageDir, occupied.owner);
    await api.publishRuntimeRootOwner(occupied.storageDir, occupied.owner);
    const holder = await startHolder(supportPath, occupied.storageDir);
    holders.push(holder);
    assert.equal((await prepare(occupied)).kind, 'unconfirmed');
    assert.equal(await api.readRuntimeRootStartupIntent(occupied.storageDir, occupied.owner), undefined);
    await holder.release();
    assert.equal(await isUnowned(occupied), true);
    console.log('Pending fixture is not resubmitted; a real runtime claim without a business endpoint blocks startup.');

    a.client.dispose();
    console.log('Waiting for the first empty Supervisor to exit through its normal 30-second idle policy.');
    await waitUnowned(first);
    assert.equal((await b.client.hello()).pid, b.hello.pid);
    assert.deepEqual(await prepare(first), { kind: 'ready', backend: 'legacy-detached' });
    const replacement = await connect(first);
    assert.notEqual((await api.readRuntimeRootStartupIntent(first.storageDir, first.owner)).token, firstIntent.token);
    assert.equal((await api.inspectRuntimeRootStartup(first.storageDir, first.owner)).kind, 'previous-started');
    replacement.client.dispose();
    b.client.dispose();
    console.log('A started owner can be replaced after positive runtime-claim release; the other root stays live.');
  } catch (error) {
    failed = error;
  } finally {
    for (const client of clients) client.dispose();
    const cleanupErrors = [];
    for (const barrier of barriers) {
      try { await writeFile(path.join(barrier.directory, 'abort'), 'abort', { mode: 0o600 }); }
      catch (error) { cleanupErrors.push(error); }
    }
    for (const helper of helpers) {
      try {
        if (helper.child.connected) helper.child.disconnect();
        await bounded(helper.closed, 35000, 'A tracked preparation helper has not closed; its state must be retained.');
      } catch (error) { cleanupErrors.push(error); }
    }
    for (const holder of holders) {
      try { await holder.release(); } catch (error) { cleanupErrors.push(error); }
    }
    for (const barrier of barriers) {
      try {
        assert.equal(barrier.entered, true, 'A wrapper without an observed claim barrier remains unconfirmed.');
        await waitUnowned(barrier.gate);
      } catch (error) { cleanupErrors.push(error); }
    }
    if (roots.some(value => value.attempted)) console.log('Waiting for tracked empty Supervisors to exit before private-directory cleanup.');
    await Promise.all(roots.map(async value => {
      if (!value.attempted) return;
      try {
        const state = await api.inspectRuntimeRootStartup(value.storageDir, value.owner);
        if (state.kind === 'unknown' && !value.pendingFixture) {
          throw new Error('A submitted root launch remains unknown; its private directory is retained.');
        }
        await waitUnowned(value);
        if (value.systemdPaths) {
          const service = await execFileAsync('systemctl', ['--user', 'show', '--no-pager',
            '--property=ActiveState,SubState,MainPID,ControlPID,Job', value.systemdPaths.unitName],
          { encoding: 'utf8', timeout: 4000, maxBuffer: 4096 });
          const state = Object.fromEntries(service.stdout.trim().split('\n').map(line => {
            const separator = line.indexOf('=');
            return [line.slice(0, separator), line.slice(separator + 1)];
          }));
          assert.ok(state.Job === '' || state.Job === '0', 'The test-owned systemd unit must have no pending job.');
          assert.deepEqual({ ...state, Job: '' }, { ActiveState: 'inactive', SubState: 'dead', MainPID: '0', ControlPID: '0', Job: '' });
          assert.equal(await readFile(value.systemdPaths.unitFilePath, 'utf8'), value.unitBytes);
        }
      } catch (error) { cleanupErrors.push(error); }
    }));
    if (!cleanupErrors.length) {
      try {
        for (const value of roots.filter(root => root.systemdPaths)) {
          await rm(value.systemdPaths.unitFilePath);
          const digest = value.systemdPaths.unitName.match(/-([a-f0-9]{24})\.service$/)?.[1];
          if (path.basename(value.systemdPaths.controlDir) === digest) {
            await rmdir(value.systemdPaths.controlDir).catch(error => { if (error.code !== 'ENOENT') throw error; });
          }
        }
        if (roots.some(root => root.systemdPaths)) {
          await execFileAsync('systemctl', ['--user', 'daemon-reload'], { timeout: 4000, maxBuffer: 4096 });
        }
        await rm(directory, { recursive: true, force: true });
      } catch (error) { cleanupErrors.push(error); }
    }
    if (cleanupErrors.length) {
      console.error(`Native test state retained at ${directory}; no unknown Supervisor was terminated.`);
      if (!failed) failed = new AggregateError(cleanupErrors, 'Native root cleanup was not confirmed.');
    }
  }
  if (failed) throw failed;
  console.log(`Native root preparation passed on ${process.platform}/${process.arch}: real helpers and native namespace, no PTY.`);
  console.log('The pending-record case remains a disk fixture; real interruption cases separately cover pre-intent IPC loss and post-submit/pre-Main helper termination, not a complete EH crash. Systemd coverage is reported separately.');
}

async function exists(filename) {
  try { await access(filename); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

async function waitBarrier(barrier) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await exists(path.join(barrier.directory, 'entered.json'))) {
      const entered = JSON.parse(await readFile(path.join(barrier.directory, 'entered.json'), 'utf8'));
      barrier.entered = true;
      assert.equal(await isUnowned(barrier.gate), false, 'The paused wrapper must still hold its native lifetime claim.');
      return entered;
    }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error('The test launcher did not reach its explicit native-claim barrier.');
}

async function runLauncher(args) {
  return execFileAsync(process.execPath, [launcher, ...args], {
    env: childEnvironment, encoding: 'utf8', timeout: 15000, maxBuffer: 16384, windowsHide: true
  });
}

async function isUnowned(root) {
  try {
    const result = await runLauncher(['--probe-root-runtime', '--storage-dir', root.storageDir, '--execution-profile', profile]);
    return result.stdout === 'root-runtime-unowned\n' && result.stderr === '';
  } catch { return false; }
}

async function waitUnowned(root) {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    if (await isUnowned(root)) return;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error('Native runtime namespace did not become unowned within the idle-exit budget.');
}

async function startHolder(supportPath, storageDir) {
  const child = fork(filename, ['--hold-claim', supportPath, storageDir], {
    env: childEnvironment, stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true
  });
  child.stderr.resume();
  const closed = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
  let finished = false;
  child.once('close', () => { finished = true; });
  const release = async () => {
    if (!finished && child.connected) child.send('release');
    const result = await bounded(closed, 10000, 'Controlled runtime claim child did not close.');
    assert.equal(result.code, 0, 'Controlled runtime claim child must exit normally.');
  };
  try {
    await bounded(new Promise((resolve, reject) => {
      child.once('message', value => value?.kind === 'claimed' ? resolve() : reject(new Error('Controlled runtime claim child failed.')));
      child.once('error', reject);
      child.once('close', () => reject(new Error('Controlled runtime claim child closed before reporting ownership.')));
    }), 15000, 'Controlled runtime claim child did not report ownership.');
    return { release };
  } catch (error) {
    if (child.connected) child.disconnect();
    await bounded(closed, 10000, 'Controlled runtime claim child did not exit.');
    throw error;
  }
}

async function bounded(promise, duration, message) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), duration); })]); }
  finally { clearTimeout(timer); }
}
