import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import esbuild from 'esbuild';

const require = createRequire(import.meta.url);
const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dsc-root-preparation-')));
const sourceRoot = 'extensions/vscode/dev-session-canvas/src';
const profile = ({ linux: 'linux-owner-v1-candidate', darwin: 'macos-owner-v1-candidate',
  win32: 'windows-owner-v1-candidate' })[process.platform];
const discoveryKinds = process.platform === 'linux' ? ['systemd-user', 'legacy-detached'] : ['legacy-detached'];
const environment = { environmentKey: 'a'.repeat(64), userIdentity: 'uid:controlled' };
let sequence = 0;
let passed = 0;
const forbidden = () => assert.fail('Unexpected real process or native acquisition.');

async function bundle(contents, dependencies = []) {
  const { outputFiles } = await esbuild.build({ stdin: { contents, resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, platform: 'node', format: 'cjs', write: false,
    plugins: [{ name: 'controlled-boundaries', setup(build) {
      build.onResolve({ filter: /.*/ }, args => {
        if (args.path.startsWith('controlled:')) return { path: args.path, external: true };
        const name = path.posix.basename(args.path);
        if (name === 'runtimeRootPreparation' && dependencies.includes(name)) {
          return { path: name, namespace: 'launcher-preparation-fixture' };
        }
        return dependencies.includes(name) ? { path: `controlled:${name}`, external: true } : undefined;
      });
      build.onLoad({ filter: /.*/, namespace: 'launcher-preparation-fixture' }, () => ({ contents: `
        const fixture = require('controlled:runtimeRootPreparation');
        export const prepareRuntimeRootSupervisor = fixture.prepareRuntimeRootSupervisor;
        export const claimRootRuntimeForProbe = fixture.claimRootRuntimeForProbe;
      `, loader: 'js' }));
    } }] });
  return outputFiles[0].text;
}
const evaluate = (code, dependencies, extras = {}) => {
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', ...Object.keys(extras), code)(
    name => name in dependencies ? dependencies[name] : require(name), loaded, loaded.exports, ...Object.values(extras));
  return loaded.exports;
};

try {
  const ioCode = await bundle(`
    export * from './${sourceRoot}/common/runtimeRootOwnership';
    export * from './${sourceRoot}/supervisor/runtimeRootOwner';
    export * from './${sourceRoot}/supervisor/runtimeRootStartup';
    export { EXECUTION_PRODUCTION_ADMISSION } from './${sourceRoot}/common/executionLifecycle';
  `, ['runtimeExecutionEnvironment']);
  const io = evaluate(ioCode, { 'controlled:runtimeExecutionEnvironment': {
    readRuntimeExecutionEnvironment: async () => ({ ...environment }) } });
  const preparationCode = await bundle(`export * from './${sourceRoot}/supervisor/runtimeRootPreparation';`, [
    'executionOwnerFactory', 'runtimeSupervisorClient', 'runtimeSystemdEnvironment', 'runtimeRootOwner',
    'runtimeRootStartup', 'runtimeSupervisorNamespace', 'runtimeSupervisorStart', 'runtimeExecutionEnvironment'
  ]);
  const launcherCode = await bundle(`import './${sourceRoot}/supervisor/runtimeSupervisorLauncher';`, ['runtimeRootPreparation']);

  async function fixture(options = {}) {
    const globalStorage = path.join(directory, String(++sequence));
    await mkdir(globalStorage, { mode: 0o700 });
    const owner = io.createRuntimeOwnerDescriptor({ environmentKey: environment.environmentKey,
      userStorageScopeKey: io.createRuntimeUserStorageScopeKey(environment.userIdentity, globalStorage),
      rootPath: path.join(directory, 'project'), generation: io.resolveRootRuntimeSupervisorGeneration(profile) });
    const base = io.resolveRuntimeRootOwnerBaseStoragePath(globalStorage, owner);
    const request = { type: 'prepare-root-runtime', storageDir: path.join(base, 'runtime-supervisor'), owner,
      executionProfile: profile, preferredBackends: discoveryKinds,
      supervisorScriptPath: path.join(directory, 'extension', 'dist', 'runtime-supervisor.js'),
      supervisorLauncherScriptPath: path.join(directory, 'extension', 'dist', 'runtime-supervisor-launcher.js') };
    const effects = [];
    let cancelled = options.cancelled ?? false;
    let now = 0;
    let submissions = 0;
    class HandshakeError extends Error {}
    const execFile = () => forbidden();
    execFile[promisify.custom] = async (_file, args, settings) => {
      effects.push('probe');
      assert.equal(args[1], '--probe-root-runtime');
      assert.equal(settings.timeout, 15000);
      return { stdout: options.probeBlocked ? '' : 'root-runtime-unowned\n', stderr: '' };
    };
    const modules = {
      child_process: { execFile },
      'controlled:runtimeExecutionEnvironment': { readRuntimeExecutionEnvironment: async () => ({ ...environment }) },
      'controlled:executionOwnerFactory': { createNativeExecutionOwnerOptions: () => ({
        kind: ({ linux: 'linux-provider', darwin: 'macos-provider', win32: 'windows-provider' })[process.platform],
        admissionLimits: io.EXECUTION_PRODUCTION_ADMISSION, claimNamespace: forbidden }) },
      'controlled:runtimeSupervisorNamespace': { async acquireRuntimeSupervisorNamespace() {
        effects.push('claim');
        if (options.lockBlocked) throw new Error('Occupied preparation claim');
      } },
      'controlled:runtimeRootOwner': { ...io,
        async ensureRuntimeRootSocketDirectory(_paths, kind, create) {
          effects.push('socket-directory');
          assert.equal(kind, 'legacy-detached');
          assert.equal(create, true);
          if (options.unsafeSocketDirectory) throw new Error('Unsafe root socket directory.');
        },
        async prepareRuntimeRootOwnerDirectories(...args) {
          effects.push('prepare');
          const value = await io.prepareRuntimeRootOwnerDirectories(...args);
          if (options.cancelAfterPrepare) cancelled = true;
          return value;
        },
        async publishRuntimeRootOwner(...args) { effects.push('publish'); return io.publishRuntimeRootOwner(...args); }
      },
      'controlled:runtimeRootStartup': { ...io, async writeRuntimeRootStartupIntent(...args) {
        effects.push('intent');
        await io.writeRuntimeRootStartupIntent(...args);
        if (options.cancelAfterIntent) cancelled = true;
      } },
      'controlled:runtimeSystemdEnvironment': { async inspectRuntimeSystemdEnvironment(scope) {
        effects.push('systemd-scope');
        assert.deepEqual(scope, { supervisorLauncherScriptPath: request.supervisorLauncherScriptPath,
          environmentKey: environment.environmentKey, userIdentityKey: createHash('sha256').update(environment.userIdentity).digest('hex') });
        if (options.cancelAtScope) cancelled = true;
        return { kind: options.systemd ?? 'available', reason: 'controlled' };
      } },
      'controlled:runtimeSupervisorClient': { ExecutionCandidateHandshakeError: HandshakeError,
        RuntimeSupervisorClient: class {
          constructor(clientOptions) { this.kind = clientOptions.backend.kind;
            assert.deepEqual(clientOptions.expectedRuntimeOwner, owner); }
          async ensureConnected(settings) {
            assert.equal(settings.allowRestart, false);
            effects.push(`discover:${this.kind}`);
            const outcome = submissions ? options.readyTimeout ? 'absent' : options.submittedBackend ?? discoveryKinds[0]
              : options.existing ?? 'absent';
            if (outcome === 'conflict') throw new HandshakeError('Wrong owner');
            if (outcome === 'unknown') throw Object.assign(new Error('Inaccessible endpoint'), { code: 'EACCES' });
            if (outcome !== this.kind && outcome !== 'both') throw Object.assign(new Error('No endpoint'), { code: 'ENOENT' });
          }
          dispose() {}
        }
      },
      'controlled:runtimeSupervisorStart': { async startRuntimeSupervisor(backend, args) {
        effects.push(`submit:${backend.kind}`);
        submissions++;
        const intent = await io.readRuntimeRootStartupIntent(request.storageDir, owner);
        assert.equal(args.runtimeLaunchToken, intent.token);
        assert.equal(backend.kind, intent.backend);
        if (options.submitError) throw Object.assign(new Error('Submission timed out'), { code: 'ETIMEDOUT' });
      } }
    };
    const timers = { setTimeout(callback, delay) {
      return setImmediate(() => { now += delay; callback(); });
    }, clearTimeout: clearImmediate };
    const worker = evaluate(preparationCode, modules, { Date: class extends Date { static now() { return now; } }, ...timers });
    async function seed(kind) {
      await io.prepareRuntimeRootOwnerDirectories(request.storageDir, owner);
      const intent = io.createRuntimeRootStartupIntent(owner, 'legacy-detached',
        io.createRuntimeOwnerCompatibilityFingerprint(owner.generation, profile));
      if (kind === 'malformed') await writeFile(path.join(base, 'startup-intent.json'), '{invalid', { mode: 0o600 });
      else {
        await io.writeRuntimeRootStartupIntent(request.storageDir, intent);
        if (kind === 'started' || kind === 'orphan') await io.writeRuntimeRootStartupStarted(request.storageDir, intent);
        if (kind === 'orphan') await rm(path.join(base, 'startup-intent.json'));
        if (kind === 'wrong-receipt') await writeFile(path.join(base, 'startup-started.json'),
          JSON.stringify({ ...intent, token: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', state: 'started' }), { mode: 0o600 });
      }
      return intent;
    }
    return { request, effects, base, seed, worker, run: () => worker.prepareRuntimeRootSupervisor(request, () => cancelled) };
  }
  async function test(name, run) {
    try { await run(); passed++; }
    catch (error) { throw new Error(name, { cause: error }); }
  }
  const assertNoSubmission = f => assert.equal(f.effects.some(effect => effect.startsWith('submit:')), false);

  await test('invalid request is rejected before directory preparation', async () => {
    const f = await fixture();
    assert.equal((await f.worker.prepareRuntimeRootSupervisor({ ...f.request, preferredBackends: [] }, () => false)).kind, 'rejected');
    assert.deepEqual(f.effects, []);
  });
  await test('unsafe endpoint directory blocks discovery, claims, and launch submission', async () => {
    const f = await fixture({ unsafeSocketDirectory: true });
    assert.equal((await f.run()).kind, 'unconfirmed');
    assert.deepEqual(f.effects, ['prepare', 'socket-directory']);
    assertNoSubmission(f);
  });
  await test('unsafe storage reports the preparation phase without forwarding raw exception details', async () => {
    if (process.platform === 'win32') return;
    const f = await fixture();
    await chmod(path.resolve(f.base, '..', '..', '..', '..', '..'), 0o775);
    const result = await f.run();
    assert.deepEqual(result, { kind: 'rejected',
      reason: 'Root runtime storage preparation failed. Check directory ownership, permissions, and runtime owner identity.' });
    assert.deepEqual(f.effects, ['prepare']);
    assertNoSubmission(f);
    assert.equal(result.reason.includes(directory), false);
  });
  await test('preparation loser discovers but never publishes or starts', async () => {
    const f = await fixture({ lockBlocked: true });
    assert.equal((await f.run()).kind, 'unconfirmed');
    assert.equal(f.effects.includes('publish'), false);
    assert.equal(f.effects.includes('probe'), false);
    assertNoSubmission(f);
  });
  for (const existing of discoveryKinds) await test(`existing ${existing} is reused before publication`, async () => {
    const f = await fixture({ existing });
    assert.deepEqual(await f.run(), { kind: 'ready', backend: existing });
    assert.deepEqual(f.effects.filter(effect => effect.startsWith('discover:')), discoveryKinds.map(kind => `discover:${kind}`));
    assert.equal(f.effects.includes('publish'), false);
    assert.equal(f.effects.includes('probe'), false);
    assertNoSubmission(f);
  });
  for (const existing of ['conflict', 'unknown', ...(process.platform === 'linux' ? ['both'] : [])]) {
    await test(`discovery ${existing} cannot start`, async () => {
      const f = await fixture({ existing });
      assert.equal((await f.run()).kind, existing === 'unknown' ? 'unconfirmed' : 'rejected');
      assertNoSubmission(f);
    });
  }
  for (const kind of ['pending', 'malformed', 'wrong-receipt', 'orphan']) await test(`${kind} remains unknown without probing`, async () => {
    const f = await fixture();
    await f.seed(kind);
    const record = path.join(f.base, kind === 'orphan' ? 'startup-started.json' : 'startup-intent.json');
    const before = await readFile(record, 'utf8');
    assert.equal((await f.run()).kind, 'unconfirmed');
    assert.equal(f.effects.includes('probe'), false);
    assertNoSubmission(f);
    assert.equal(await readFile(record, 'utf8'), before);
  });
  await test('started receipt cannot substitute for an available runtime claim', async () => {
    const f = await fixture({ probeBlocked: true });
    await f.seed('started');
    assert.equal((await f.run()).kind, 'unconfirmed');
    assert.equal(f.effects.includes('intent'), false);
    assertNoSubmission(f);
  });
  for (const previous of ['fresh', 'started']) await test(`${previous} submits exactly once after runtime claim proof`, async () => {
    const f = await fixture();
    const old = previous === 'started' ? await f.seed(previous) : undefined;
    assert.deepEqual(await f.run(), { kind: 'ready', backend: discoveryKinds[0] });
    assert.deepEqual(f.effects.filter(effect => effect.startsWith('submit:')), [`submit:${discoveryKinds[0]}`]);
    assert.ok(f.effects.indexOf('probe') < f.effects.indexOf('intent'));
    assert.ok(f.effects.indexOf('intent') < f.effects.indexOf(`submit:${discoveryKinds[0]}`));
    const current = await io.readRuntimeRootStartupIntent(f.request.storageDir, f.request.owner);
    assert.notEqual(current.token, old?.token);
  });
  if (process.platform === 'linux') for (const systemd of ['unavailable', 'unknown']) {
    await test(`systemd ${systemd} has explicit fallback semantics`, async () => {
      const f = await fixture({ systemd, submittedBackend: 'legacy-detached' });
      const result = await f.run();
      if (systemd === 'unavailable') {
        assert.deepEqual(result, { kind: 'ready', backend: 'legacy-detached' });
        assert.deepEqual(f.effects.filter(effect => effect.startsWith('submit:')), ['submit:legacy-detached']);
      } else { assert.equal(result.kind, 'unconfirmed'); assertNoSubmission(f); }
    });
  }
  for (const options of [{ submitError: true }, { readyTimeout: true }]) await test('submitted timeout never retries or falls back', async () => {
    const f = await fixture(options);
    assert.equal((await f.run()).kind, 'unconfirmed');
    assert.equal(f.effects.filter(effect => effect.startsWith('submit:')).length, 1);
    assert.equal((await io.inspectRuntimeRootStartup(f.request.storageDir, f.request.owner)).kind, 'unknown');
  });
  for (const options of [{ cancelled: true }, { cancelAfterPrepare: true }, { cancelAfterIntent: true },
    ...(process.platform === 'linux' ? [{ cancelAtScope: true }] : [])]) {
    await test('Host cancellation never submits a new launch', async () => {
      const f = await fixture(options);
      assert.equal((await f.run()).kind, 'unconfirmed');
      assertNoSubmission(f);
      if (options.cancelAfterIntent) {
        assert.equal((await io.inspectRuntimeRootStartup(f.request.storageDir, f.request.owner)).kind, 'unknown');
      } else assert.equal(f.effects.includes('intent'), false);
    });
  }

  async function launcher(mode, connected = true, failProbe = false) {
    const events = [];
    const fakeProcess = Object.assign(new EventEmitter(), { argv: ['node', 'launcher', mode,
      '--storage-dir', '/controlled/runtime-supervisor', '--execution-profile', profile], connected, exitCode: undefined,
      stdout: { write(value, callback) { events.push(value); callback(); } },
      send(value, callback) { events.push(value); callback(); }, exit(code) { events.push({ exit: code }); } });
    const dependencies = { child_process: { spawn: forbidden }, 'controlled:runtimeRootPreparation': {
      async prepareRuntimeRootSupervisor(request, isCancelled) {
        events.push({ request, cancelled: isCancelled() });
        return { kind: 'unconfirmed', reason: 'controlled' };
      }, async claimRootRuntimeForProbe() { if (failProbe) throw new Error('Claim rejected'); events.push('claimed'); }
    } };
    evaluate(launcherCode, dependencies, { process: fakeProcess, __dirname: directory,
      console: { error() { events.push('error'); } }, setTimeout: () => ({ unref() {} }) });
    await new Promise(setImmediate);
    return { fakeProcess, events };
  }
  await test('launcher preparation requires IPC and accepts a single request', async () => {
    const disconnected = await launcher('--prepare-root-runtime', false);
    assert.equal(disconnected.fakeProcess.exitCode, 1);
    const f = await launcher('--prepare-root-runtime');
    f.fakeProcess.emit('message', { type: 'prepare-root-runtime' });
    f.fakeProcess.emit('message', { type: 'prepare-root-runtime' });
    await new Promise(setImmediate);
    assert.equal(f.events.filter(value => value?.request).length, 1);
    assert.deepEqual(f.events.at(-1), { exit: 0 });
    const abandoned = await launcher('--prepare-root-runtime');
    abandoned.fakeProcess.connected = false;
    abandoned.fakeProcess.emit('disconnect');
    assert.deepEqual(abandoned.events, [{ exit: 0 }]);
  });
  await test('probe launcher emits proof only after successful claim', async () => {
    const success = await launcher('--probe-root-runtime');
    assert.deepEqual(success.events, ['claimed', 'root-runtime-unowned\n', { exit: 0 }]);
    const failure = await launcher('--probe-root-runtime', true, true);
    assert.deepEqual(failure.events, ['error']);
    assert.equal(failure.fakeProcess.exitCode, 1);
  });
  console.log(`runtime root preparation tests passed (${passed} controlled cases; real private startup records, no native claims).`);
} finally {
  await rm(directory, { recursive: true, force: true });
}
