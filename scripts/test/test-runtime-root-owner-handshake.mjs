import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import esbuild from 'esbuild';

const require = createRequire(import.meta.url);
const environment = { environmentKey: 'a'.repeat(64), userIdentity: 'uid:controlled-user' };
let probeError;
let probeReads = 0;
let controlledConnect;
const effects = [];
const forbidden = () => assert.fail('Unexpected native provider or process acquisition.');
const { outputFiles } = await esbuild.build({
  stdin: { contents: `
    export { RuntimeSupervisorClient } from './extensions/vscode/dev-session-canvas/src/panel/runtimeSupervisorClient';
    export { RuntimeSupervisorServer } from './extensions/vscode/dev-session-canvas/src/supervisor/runtimeSupervisorMain';
    export * from './extensions/vscode/dev-session-canvas/src/common/runtimeRootOwnership';
    export { EXECUTION_CANDIDATE_BUDGETS, EXECUTION_PRODUCTION_ADMISSION } from './extensions/vscode/dev-session-canvas/src/common/executionLifecycle';
  `, resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, platform: 'node', format: 'cjs', write: false, external: ['node-pty'],
  plugins: [{ name: 'controlled-environment', setup(build) {
    build.onResolve({ filter: /\/runtimeExecutionEnvironment$/ }, () => ({
      path: 'runtime-owner-test-environment', external: true
    }));
  } }]
});
const loaded = { exports: {} };
new Function('require', 'module', 'exports', outputFiles[0].text)(name => {
  if (name === 'runtime-owner-test-environment') return { async readRuntimeExecutionEnvironment() {
    probeReads++;
    if (probeError) throw probeError;
    return { ...environment };
  } };
  if (name === 'net') return { ...require(name), createConnection() {
    effects.push('connect');
    if (controlledConnect) return controlledConnect();
    const socket = new ControlledSocket();
    queueMicrotask(() => socket.emit('error', Object.assign(new Error('No endpoint'), { code: 'ENOENT' })));
    return socket;
  }, createServer() {
    effects.push('claim');
    const server = new EventEmitter();
    server.listen = (_address, callback) => queueMicrotask(callback);
    server.unref = () => {};
    return server;
  } };
  if (name === 'fs') {
    const actual = require(name);
    return { ...actual, mkdirSync(...args) { effects.push('mkdir'); return actual.mkdirSync(...args); },
      promises: { ...actual.promises, async rm(...args) { effects.push('cleanup'); return actual.promises.rm(...args); } } };
  }
  if (name === 'node-pty') return { spawn: forbidden };
  if (name === 'child_process') return { ...require(name), spawn: forbidden, fork: forbidden, execFile: forbidden };
  return require(name);
}, loaded, loaded.exports);
const { RuntimeSupervisorClient, RuntimeSupervisorServer, createRuntimeOwnerDescriptor,
  createRuntimeUserStorageScopeKey, resolveRuntimeRootOwnerBaseStoragePath, resolveRootRuntimeSupervisorGeneration,
  createRuntimeOwnerCompatibilityFingerprint, EXECUTION_CANDIDATE_BUDGETS, EXECUTION_PRODUCTION_ADMISSION } = loaded.exports;
const profile = ({ linux: 'linux-owner-v1-candidate', darwin: 'macos-owner-v1-candidate',
  win32: 'windows-owner-v1-candidate' })[process.platform];
assert.ok(profile, 'Root owner tests require a supported execution platform.');
const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dsc-root-handshake-')));
const clients = [];
let fixtureSequence = 0;
let passed = 0;

class ControlledSocket extends EventEmitter {
  destroyed = false;
  messages = [];
  result;
  setEncoding() {}
  write(line) {
    const message = JSON.parse(line);
    this.messages.push(message);
    if (message.type === 'request') queueMicrotask(() => this.emit('data', `${JSON.stringify({
      type: 'response', id: message.id, ok: true,
      result: message.method === 'hello' ? this.result : { sessionId: 'new-session', live: true }
    })}\n`));
    return true;
  }
  destroy() { this.destroyed = true; this.emit('close'); }
}

try {
  const root = await fixture();
  const hello = rootHello(root.descriptor);
  await test('legacy hello remains valid and cannot adopt a root owner descriptor', async () => {
    const options = clientOptions(root);
    options.backend.paths.storageDir = path.join(directory, 'legacy', 'runtime-supervisor');
    delete options.executionProfile;
    delete options.expectedRuntimeOwner;
    const client = track(new RuntimeSupervisorClient(options));
    const socket = await connect(client, { serverVersion: 1, pid: 100,
      runtimeBackend: 'legacy-detached', runtimeGuarantee: 'best-effort' });
    assert.equal((await client.hello()).runtimeOwner, undefined);
    assert.deepEqual(socket.messages.map(message => message.method), ['hello']);
    assert.throws(() => new RuntimeSupervisorClient({ ...options, expectedRuntimeOwner: root.descriptor }), /legacy storage/);
  });

  await test('root generation requires descriptor, matching profile, and complete storage layout', () => {
    for (const changed of [
      { expectedRuntimeOwner: undefined }, { executionProfile: undefined },
      { expectedRuntimeOwner: { ...root.descriptor, environmentKey: 'b'.repeat(64) } },
      { expectedRuntimeOwner: { ...root.descriptor, root: { ...root.descriptor.root, normalizedPath: path.join(directory, 'other') } } }
    ]) assert.throws(() => new RuntimeSupervisorClient({ ...clientOptions(root), ...changed }), /owner|profile/);
    assert.deepEqual(effects, []);
  });

  await test('matching owner handshake accepts create on the original connection', async () => {
    const client = track(new RuntimeSupervisorClient(clientOptions(root)));
    const socket = await connect(client, hello);
    assert.deepEqual((await client.hello()).runtimeOwner, root.descriptor);
    await client.createSession({ sessionId: 'new-session', executionProfile: profile });
    assert.deepEqual(socket.messages.map(message => message.method), ['hello', 'createSession']);
    assert.equal(effects.filter(effect => effect === 'start').length, 0);
  });

  await test('owner or capability conflicts destroy the connection without business RPC or restart', async () => {
    const invalid = [
      { ...hello, runtimeOwner: undefined },
      { ...hello, runtimeOwner: { ...root.descriptor, userStorageScopeKey: 'b'.repeat(64) } },
      { ...hello, runtimeOwner: { ...root.descriptor, generation: 'terminal-stream-v1' } },
      { ...hello, runtimeOwner: { ...root.descriptor, schema: 2 } },
      { ...hello, runtimeBackend: 'systemd-user' },
      { ...hello, runtimeGuarantee: 'strong' },
      { ...hello, executionProfile: undefined },
      { ...hello, ownerCompatibilityFingerprint: undefined },
      { ...hello, ownerCompatibilityFingerprint: createRuntimeOwnerCompatibilityFingerprint(
        root.descriptor.generation, profile, { executions: 2, starting: 1 }) },
      { ...hello, serverVersion: 2 },
      ...['terminalCurrentStateV1', 'terminalHostOutputCreditV1', 'terminalReadSettlementV1']
        .map(missing => ({ ...hello, capabilities: { ...hello.capabilities, [missing]: false } }))
    ];
    for (const result of invalid) {
      const client = track(new RuntimeSupervisorClient(clientOptions(root)));
      const socket = provideEndpoint(result);
      await assert.rejects(client.ensureConnected(), /owner descriptor|candidate profile/);
      assert.equal(socket.destroyed, true);
      assert.equal(client.helloResult, undefined);
      assert.deepEqual(socket.messages.map(message => message.method), ['hello']);
      client.dispose();
    }
    assert.equal(effects.includes('start'), false);
  });

  await test('root clients never enter uncoordinated cold startup', async () => {
    const client = track(new RuntimeSupervisorClient(clientOptions(root)));
    await assert.rejects(client.ensureConnected({ allowRestart: true }), /coordinated preparation/);
    assert.deepEqual(effects, []);
    controlledConnect = undefined;
    await assert.rejects(client.ensureConnected(), { code: 'ENOENT' });
    assert.deepEqual(effects, ['connect']);
  });

  for (const mismatch of ['missing', 'malformed', 'root-path', 'environment', 'scope', 'probe-unknown']) {
    await test(`startup rejects ${mismatch} before claim, cleanup, or socket exposure`, async () => {
      const f = await fixture(mismatch === 'environment' ? { environmentKey: 'b'.repeat(64) }
        : mismatch === 'scope' ? { userStorageScopeKey: 'b'.repeat(64) } : {});
      if (mismatch === 'missing') await rm(f.ownerPath);
      if (mismatch === 'malformed') await writeFile(f.ownerPath, '{invalid');
      if (mismatch === 'root-path') await writeFile(f.ownerPath, JSON.stringify({ ...f.descriptor,
        root: { ...f.descriptor.root, normalizedPath: path.join(directory, 'changed-root') } }));
      if (mismatch === 'probe-unknown') probeError = new Error('Execution environment is unknown.');
      const server = supervisor(f);
      await assert.rejects(server.start(), /ENOENT|JSON|owner|unknown/i);
      assert.deepEqual(effects, []);
      await assertRetained(f);
    });
  }

  await test('root startup requires an explicit profile and provider before touching state', async () => {
    const f = await fixture();
    for (const executionProfile of [undefined, profile]) {
      const server = new RuntimeSupervisorServer({ storageDir: f.storageDir, registryPath: f.registryPath,
        socketPath: f.socketPath, socketLocation: 'storage' }, 'legacy-detached', 'best-effort', undefined, executionProfile);
      await assert.rejects(server.start(), /matching execution profile|execution provider/);
      assert.deepEqual(effects, []);
      await assertRetained(f);
    }
  });

  await test('startup rejects redirected session storage before taking namespace ownership', async () => {
    const f = await fixture();
    const unrelated = path.join(f.globalStoragePath, 'unrelated');
    await mkdir(unrelated, { mode: 0o700 });
    await writeFile(path.join(unrelated, 'registry.json'), 'unrelated registry');
    await rm(f.storageDir, { recursive: true });
    await symlink(unrelated, f.storageDir, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(supervisor(f).start(), /redirect/);
    assert.deepEqual(effects, []);
    assert.equal(await readFile(path.join(unrelated, 'registry.json'), 'utf8'), 'unrelated registry');
  });

  await test('legacy aliases cannot bypass root validation before namespace ownership', async () => {
    const f = await fixture();
    const storageDir = path.join(f.globalStoragePath, 'legacy-alias');
    await symlink(f.storageDir, storageDir, process.platform === 'win32' ? 'junction' : 'dir');
    for (const executionProfile of [undefined, profile]) {
      const server = new RuntimeSupervisorServer({ storageDir, registryPath: path.join(storageDir, 'registry.json'),
        socketPath: f.socketPath, socketLocation: 'storage' }, 'legacy-detached', 'best-effort', undefined, executionProfile);
      await assert.rejects(server.start(), /legacy storage alias/);
      assert.deepEqual(effects, []);
      await assertRetained(f);
    }
  });

  for (const generation of [root.descriptor.generation.replace(/v1$/, 'v2'), 'terminal-stream-v1',
    root.descriptor.generation.replace('terminal-root-owner-', 'terminal-current-state-')]) {
    for (const alias of [false, true]) {
      await test(`reserved root storage rejects ${generation}${alias ? ' through a legacy alias' : ''} without side effects`, async () => {
        const f = await fixture();
        const reservedStorageDir = path.join(path.dirname(f.baseStoragePath), generation, 'runtime-supervisor');
        const registryPath = path.join(reservedStorageDir, 'registry.json');
        const journalPath = path.join(reservedStorageDir, 'terminal-journals', 'retained');
        await mkdir(path.dirname(journalPath), { recursive: true, mode: 0o700 });
        await writeFile(registryPath, 'reserved registry');
        await writeFile(journalPath, 'reserved journal');
        const storageDir = alias ? path.join(f.globalStoragePath, 'reserved-alias') : reservedStorageDir;
        if (alias) await symlink(reservedStorageDir, storageDir, process.platform === 'win32' ? 'junction' : 'dir');
        const options = clientOptions({ ...f, storageDir });
        delete options.expectedRuntimeOwner;
        delete options.executionProfile;
        assert.throws(() => new RuntimeSupervisorClient(options), /Reserved root runtime storage/);
        const server = new RuntimeSupervisorServer({ storageDir, registryPath: path.join(storageDir, 'registry.json'),
          socketPath: f.socketPath, socketLocation: 'storage' }, 'legacy-detached', 'best-effort');
        server.listen = async () => effects.push('listen');
        await assert.rejects(server.start(), /Reserved root runtime storage|legacy storage alias/);
        assert.deepEqual(effects, []);
        assert.equal(probeReads, 0);
        assert.equal(await readFile(registryPath, 'utf8'), 'reserved registry');
        assert.equal(await readFile(journalPath, 'utf8'), 'reserved journal');
        await assertRetained(f);
      });
    }
  }

  if (process.platform !== 'win32') {
    for (const target of ['ownerPath', 'baseStoragePath', 'storageDir']) {
      await test(`startup rejects nonprivate ${target} without touching runtime state`, async () => {
        const f = await fixture();
        await chmod(f[target], target === 'ownerPath' ? 0o644 : 0o755);
        await assert.rejects(supervisor(f).start(), /private/);
        assert.deepEqual(effects, []);
        await assertRetained(f);
      });
    }
  }

  await test('validated owner is independently probed before claim and returned in hello', async () => {
    const f = await fixture();
    const server = supervisor(f);
    await server.start();
    server.clearIdleShutdownTimer();
    assert.equal(probeReads, 1);
    assert.ok(effects.includes('claim'));
    assert.ok(effects.indexOf('claim') < effects.indexOf('cleanup'));
    assert.equal(effects.at(-1), 'listen');
    const socket = new ControlledSocket();
    await server.handleRequest(socket, { type: 'request', id: 'hello', method: 'hello' });
    assert.deepEqual(socket.messages[0].result.runtimeOwner, f.descriptor);
    assert.equal(socket.messages[0].result.executionProfile, profile);
    assert.equal(socket.messages[0].result.ownerCompatibilityFingerprint,
      createRuntimeOwnerCompatibilityFingerprint(f.descriptor.generation, profile));
    assert.equal(await readFile(f.ownerPath, 'utf8'), JSON.stringify(f.descriptor));
    assert.equal(await readFile(f.legacyRegistry, 'utf8'), 'legacy registry');
  });

  await test('owner.json on legacy generation does not enable owner semantics or run probes', async () => {
    const f = await fixture();
    const storageDir = path.dirname(f.legacyRegistry);
    const ownerPath = path.join(path.dirname(storageDir), 'owner.json');
    await writeFile(ownerPath, 'invalid legacy file must stay untouched');
    const registry = JSON.stringify({ version: 1, sessions: [] });
    await writeFile(f.legacyRegistry, registry);
    const server = new RuntimeSupervisorServer({ storageDir, registryPath: f.legacyRegistry,
      socketPath: path.join(f.globalStoragePath, 'legacy.sock'), socketLocation: 'storage' },
    'legacy-detached', 'best-effort');
    server.listen = async () => effects.push('listen');
    await server.start();
    server.clearIdleShutdownTimer();
    assert.equal(probeReads, 0);
    assert.equal(effects.includes('claim'), false);
    assert.equal(effects.includes('cleanup'), false);
    assert.equal(await readFile(ownerPath, 'utf8'), 'invalid legacy file must stay untouched');
    assert.equal(await readFile(f.legacyRegistry, 'utf8'), registry);
    const socket = new ControlledSocket();
    await server.handleRequest(socket, { type: 'request', id: 'hello', method: 'hello' });
    assert.equal(socket.messages[0].result.runtimeOwner, undefined);
    assert.equal(socket.messages[0].result.ownerCompatibilityFingerprint, undefined);
  });
  console.log(`runtime root owner handshake tests passed (${passed} cases; controlled environment and namespace)`);
} finally {
  for (const client of clients) client.dispose();
  await rm(directory, { recursive: true, force: true });
}

async function test(name, run) {
  effects.length = 0;
  probeReads = 0;
  probeError = undefined;
  controlledConnect = undefined;
  try { await run(); passed++; }
  catch (error) { throw new Error(name, { cause: error }); }
}

async function fixture(overrides = {}) {
  const globalStoragePath = path.join(directory, `global-${++fixtureSequence}`);
  await mkdir(globalStoragePath, { mode: 0o700 });
  const descriptor = createRuntimeOwnerDescriptor({
    environmentKey: environment.environmentKey,
    userStorageScopeKey: createRuntimeUserStorageScopeKey(environment.userIdentity, globalStoragePath),
    rootPath: path.join(directory, 'project'), generation: resolveRootRuntimeSupervisorGeneration(profile), ...overrides
  });
  const baseStoragePath = resolveRuntimeRootOwnerBaseStoragePath(globalStoragePath, descriptor);
  const storageDir = path.join(baseStoragePath, 'runtime-supervisor');
  const ownerPath = path.join(baseStoragePath, 'owner.json');
  const registryPath = path.join(storageDir, 'registry.json');
  const journalPath = path.join(storageDir, 'terminal-journals', 'retained');
  const legacyRegistry = path.join(globalStoragePath, 'legacy', 'runtime-supervisor', 'registry.json');
  await mkdir(path.dirname(journalPath), { recursive: true, mode: 0o700 });
  await mkdir(path.dirname(legacyRegistry), { recursive: true, mode: 0o700 });
  await writeFile(ownerPath, JSON.stringify(descriptor), { mode: 0o600 });
  await writeFile(registryPath, 'root registry');
  await writeFile(journalPath, 'root journal');
  await writeFile(legacyRegistry, 'legacy registry');
  return { globalStoragePath, descriptor, baseStoragePath, storageDir, ownerPath, registryPath, journalPath,
    legacyRegistry, socketPath: path.join(globalStoragePath, 'supervisor.sock') };
}

function clientOptions(f) {
  return { backend: { kind: 'legacy-detached', guarantee: 'best-effort', paths: { storageDir: f.storageDir,
    socketPath: f.socketPath }, async startSupervisor() { effects.push('start'); forbidden(); } },
  executionProfile: profile, expectedRuntimeOwner: f.descriptor,
  supervisorScriptPath: '/not-used', supervisorLauncherScriptPath: '/not-used' };
}

function rootHello(descriptor) {
  return { serverVersion: 1, pid: 100, runtimeBackend: 'legacy-detached', runtimeGuarantee: 'best-effort',
    runtimeOwner: descriptor, executionProfile: profile,
    ownerCompatibilityFingerprint: createRuntimeOwnerCompatibilityFingerprint(descriptor.generation, profile),
    capabilities: { terminalPagedReadV1: true, terminalPagedCompletionV1: true, terminalReadSettlementV1: true,
      terminalCurrentStateV1: true, terminalHostOutputCreditV1: true, executionCandidateProfiles: [profile] } };
}

function provideEndpoint(result) {
  const socket = new ControlledSocket();
  socket.result = result;
  controlledConnect = () => { queueMicrotask(() => socket.emit('connect')); return socket; };
  return socket;
}

async function connect(client, result) {
  const socket = provideEndpoint(result);
  await client.ensureConnected();
  return socket;
}

function track(client) { clients.push(client); return client; }

function supervisor(f) {
  const options = { kind: ({ linux: 'linux-provider', darwin: 'macos-provider', win32: 'windows-provider' })[process.platform],
    profile, profileMode: 'live-runtime', capabilities: ['execution-lifecycle-v1', 'execution-close-observation-v1',
      'execution-parent-cleanup-v1', 'execution-owner-boundary-v1', 'terminal-interaction-v1', 'terminal-read-settlement-v1'],
    budgets: EXECUTION_CANDIDATE_BUDGETS, admissionLimits: EXECUTION_PRODUCTION_ADMISSION,
    claimNamespace: () => effects.push('claim'),
    scheduler: { now: () => 0, after: forbidden }, createTransport: forbidden };
  const server = new RuntimeSupervisorServer({ storageDir: f.storageDir, registryPath: f.registryPath,
    socketPath: f.socketPath, socketLocation: 'storage' }, 'legacy-detached', 'best-effort', options, profile);
  server.listen = async () => effects.push('listen');
  return server;
}

async function assertRetained(f) {
  assert.equal(await readFile(f.registryPath, 'utf8'), 'root registry');
  assert.equal(await readFile(f.journalPath, 'utf8'), 'root journal');
  assert.equal(await readFile(f.legacyRegistry, 'utf8'), 'legacy registry');
}
