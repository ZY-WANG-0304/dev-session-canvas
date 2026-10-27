import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile, lstat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';
import { deleteDisconnectedRuntimeNode } from './fixtures/disconnected-runtime-host.mjs';

const require = createRequire(import.meta.url);
const self = fileURLToPath(import.meta.url);
const profile = 'linux-owner-v1-candidate';
const arg = name => process.argv[process.argv.indexOf(name) + 1];
function load(bundle, socketDirectory) {
  const realPath = require('path');
  // Only the stable socket directory is mapped to an owned fixture. Identity, permissions,
  // namespace claiming, listener, RPC, provider, PTY and journals use production code.
  const mapped = { ...realPath, posix: { ...realPath.posix, join(...parts) {
    const result = realPath.posix.join(...parts);
    return result === `/tmp/dsc-root-${process.getuid()}` ? socketDirectory : result;
  } } };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', '__dirname', '__filename', readFileSync(bundle, 'utf8'))(
    name => name === 'path' ? mapped : require(name), module, module.exports, path.dirname(bundle), bundle);
  return module.exports;
}
async function bounded(promise, label, ms = 20000) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} exceeded ${ms}ms`)), ms);
  })]); } finally { clearTimeout(timer); }
}
async function until(read, label) {
  const deadline = Date.now() + 15000;
  while (true) {
    const value = await read(); if (value) return value;
    assert(Date.now() < deadline, label); await new Promise(resolve => setTimeout(resolve, 50));
  }
}
async function children(pid) {
  return (await readFile(`/proc/${pid}/task/${pid}/children`, 'utf8')).trim().split(/\s+/).filter(Boolean).map(Number);
}

if (process.argv.includes('--worker')) {
  const directory = arg('--directory'), bundle = arg('--bundle');
  const api = load(bundle, path.join(directory, 'socket'));
  const environment = await api.readRuntimeExecutionEnvironment();
  const globalStorage = path.join(directory, 'global'); await mkdir(globalStorage, { mode: 0o700 });
  const owner = api.createRuntimeOwnerDescriptor({ ...environment,
    userStorageScopeKey: api.createRuntimeUserStorageScopeKey(environment.userIdentity, globalStorage),
    rootPath: path.join(directory, 'workspace'), generation: api.resolveRootRuntimeSupervisorGeneration(profile) });
  const base = api.resolveRuntimeRootOwnerBaseStoragePath(globalStorage, owner);
  const storageDir = path.join(base, 'runtime-supervisor');
  await api.prepareRuntimeRootOwnerDirectories(storageDir, owner);
  await api.publishRuntimeRootOwner(storageDir, owner);
  const options = api.createNativeExecutionOwnerOptions({ extensionRoot: path.join(directory, 'extension'),
    mode: 'live-runtime', profile });
  const intent = api.createRuntimeRootStartupIntent(owner, 'legacy-detached',
    api.createRuntimeOwnerCompatibilityFingerprint(owner.generation, profile, options.admissionLimits));
  await api.writeRuntimeRootStartupIntent(storageDir, intent);
  const paths = api.resolveLegacyRuntimeSupervisorPathsFromStorageDir(storageDir);
  const server = new api.RuntimeSupervisorServer(paths, 'legacy-detached', 'best-effort', options, profile, intent.token);
  await server.start();
  process.on('message', async message => {
    try {
      if (message.command === 'inspect') {
        const providers = await children(process.pid);
        process.send({ id: message.id, providers, subjects: await Promise.all(providers.map(async pid => [pid, await children(pid)])),
          sessions: [...server.sessions.values()].map(session => ({ id: session.sessionId, live: session.live,
            authorityId: session.terminalAuthorityId, revision: session.terminalRevision })) });
      }
      if (message.command === 'disable-repair') {
        clearInterval(server.server.timer);
        process.send({ id: message.id, repairDisabled: true });
      }
      if (message.command === 'shutdown') {
        const report = await server.prepareForShutdown('socket recovery acceptance complete');
        assert.equal(report.kind, 'settled', JSON.stringify(report));
        process.send({ id: message.id, shutdown: report.kind }, () => process.disconnect());
      }
    } catch (error) { process.send({ id: message.id, error: error.stack }); }
  });
  process.send({ ready: true, paths, owner, pid: process.pid });
} else {
  assert.equal(process.platform, 'linux', 'Native recovery acceptance currently uses Linux /proc and native PTY.');
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dsc-recovery-')));
  const assets = process.argv.includes('--assets') ? path.resolve(arg('--assets')) : path.resolve('extensions/vscode/dev-session-canvas');
  const agentCommand = process.argv.includes('--agent-command') ? arg('--agent-command') : undefined;
  const clients = [], pending = new Map();
  let worker, exit, id = 0, stderr = '', shutdownDone = false;
  const report = { platform: process.platform, node: process.version, agent: agentCommand ? 'real-cli' : 'controlled-node-PTY', cases: [] };
  try {
    const bundle = path.join(directory, 'api.cjs');
    await esbuild.build({ stdin: { contents: `
      export * from './extensions/vscode/dev-session-canvas/src/supervisor/runtimeSupervisorMain';
      export * from './extensions/vscode/dev-session-canvas/src/supervisor/runtimeRootOwner';
      export * from './extensions/vscode/dev-session-canvas/src/supervisor/runtimeRootStartup';
      export * from './extensions/vscode/dev-session-canvas/src/common/runtimeRootOwnership';
      export * from './extensions/vscode/dev-session-canvas/src/common/runtimeSupervisorPaths';
      export * from './extensions/vscode/dev-session-canvas/src/panel/runtimeExecutionEnvironment';
      export * from './extensions/vscode/dev-session-canvas/src/panel/executionOwnerFactory';
      export * from './extensions/vscode/dev-session-canvas/src/panel/runtimeSupervisorClient';
    `, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', outfile: bundle,
      external: ['node-pty'], define: { __DEV_SESSION_CANVAS_EXECUTION_ADMISSION__: JSON.stringify({executions:null,starting:1,pending:2}) } });
    const dist = path.join(directory, 'extension', 'dist');
    await mkdir(dist, { recursive: true });
    await cp(path.join(assets, 'dist/native/linux-execution-candidate'), path.join(dist, 'native/linux-execution-candidate'), { recursive: true });
    await esbuild.build({ entryPoints: ['extensions/vscode/dev-session-canvas/src/panel/linuxExecutionProviderMain.ts'],
      bundle: true, platform: 'node', format: 'cjs', outfile: path.join(dist, 'linux-execution-provider.js') });
    await mkdir(path.join(directory, 'workspace'));
    const subject = path.join(directory, 'subject.cjs');
    await writeFile(subject, `process.stdout.write('READY\\n'); process.stdin.setEncoding('utf8'); process.stdin.on('data', data => process.stdout.write('ECHO:'+data));`);
    worker = fork(self, ['--worker', '--directory', directory, '--bundle', bundle], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    exit = once(worker, 'exit');
    worker.stderr.on('data', chunk => { stderr += chunk; });
    const ready = await bounded(new Promise((resolve, reject) => {
      worker.on('message', message => message.ready ? resolve(message) : pending.get(message.id)?.(message));
      worker.once('error', reject); worker.once('exit', () => reject(new Error(`Worker exited: ${stderr}`)));
    }), 'worker startup');
    const api = load(bundle, path.join(directory, 'socket'));
    async function control(command) {
      const requestId = ++id;
      const response = new Promise(resolve => pending.set(requestId, resolve)); worker.send({ id: requestId, command });
      try { const result = await bounded(response, command); if (result.error) throw new Error(result.error); return result; }
      finally { pending.delete(requestId); }
    }
    function client() {
      const value = new api.RuntimeSupervisorClient({ backend: { kind: 'legacy-detached', guarantee: 'best-effort', paths: ready.paths,
        startSupervisor: () => assert.fail('Recovery cannot start a replacement Supervisor') }, allowRestart: false,
        expectedRuntimeOwner: ready.owner, executionProfile: profile, supervisorScriptPath: '/forbidden', supervisorLauncherScriptPath: '/forbidden' });
      clients.push(value); return value;
    }
    const original = client(); assert.equal((await original.hello()).pid, ready.pid);
    for (const kind of ['terminal', 'agent']) {
      await original.createSession({ executionProfile: profile, kind, sessionId: `recovery-${kind}`, displayLabel: kind,
        launchMode: 'start', scrollback: 1000, ...(kind === 'agent' ? { provider: 'codex' } : {}), deferSubscription: true,
        launchSpec: { file: kind === 'agent' && agentCommand ? agentCommand : process.execPath,
          args: kind === 'agent' && agentCommand ? ['--no-alt-screen'] : [subject], cwd: path.join(directory, 'workspace'),
          cols: 100, rows: 30, env: { ...process.env, TERM: 'xterm-256color' } } });
      await until(async () => {
        const snapshot = await original.getSessionSnapshot({ sessionId: `recovery-${kind}` });
        assert(snapshot.live, `${kind} must remain live`); return snapshot.output.length > 0;
      }, `${kind} initial output`);
    }
    const before = await control('inspect');
    assert.equal(before.providers.length, 2); assert(before.subjects.every(([, pids]) => pids.length > 0));
    for (const removal of ['file', 'directory']) {
      await rm(removal === 'file' ? ready.paths.socketPath : path.dirname(ready.paths.socketPath), { recursive: true });
      // Existing control connection still works while its pathname is absent.
      assert.equal((await original.getSessionSnapshot({ sessionId: 'recovery-terminal' })).live, true);
      await until(async () => (await lstat(ready.paths.socketPath).catch(() => null))?.isSocket(), 'automatic socket repair');
      const restored = client(); assert.equal((await restored.hello()).pid, ready.pid);
      const snapshot = await restored.attachSession({ sessionId: 'recovery-agent', deferSubscription: true });
      assert.equal(snapshot.sessionId, 'recovery-agent'); assert.equal(snapshot.live, true);
      const nonce = `RECOVERED_${removal}_${Date.now()}`;
      await restored.writeInput({ sessionId: 'recovery-terminal', data: nonce + '\n' });
      await until(async () => (await restored.getSessionSnapshot({ sessionId: 'recovery-terminal' })).output.includes('ECHO:' + nonce), 'original PTY input/output after repair');
      const after = await control('inspect');
      assert.deepEqual(after.providers, before.providers); assert.deepEqual(after.subjects, before.subjects);
      assert.deepEqual(after.sessions.map(s => [s.id, s.authorityId]), before.sessions.map(s => [s.id, s.authorityId]));
      report.cases.push({ removal, sameSupervisor: true, sameProvidersAndSubjects: true, sameSessionsAndAuthorities: true,
        existingConnectionWorks: true, reattachedAgent: true, terminalInputOutput: true });
      restored.dispose();
    }
    // Simulate the old Supervisor's missing repair capability while its real CLI stays alive.
    await control('disable-repair');
    await rm(path.dirname(ready.paths.socketPath), { recursive: true });
    report.disconnectedDeletion = await deleteDisconnectedRuntimeNode({ directory,
      backend: { kind: 'legacy-detached', guarantee: 'best-effort', paths: ready.paths },
      owner: ready.owner, sessionId: 'recovery-agent', kind: 'agent', client: client() });
    assert.equal((await original.getSessionSnapshot({ sessionId: 'recovery-agent' })).live, true,
      'Node deletion must not invent a background exit');
    report.disconnectedDeletion.backgroundStillLive = true;
    // Explicit fixture cleanup over the original pre-existing connection, not a deletion success claim.
    await original.deleteSession({ sessionId: 'recovery-agent' });
    await original.deleteSession({ sessionId: 'recovery-terminal' });
    const afterDelete = await control('inspect'); assert.equal(afterDelete.sessions.length, 0);
    for (const value of clients) value.dispose();
    const shutdown = await control('shutdown'); assert.equal(shutdown.shutdown, 'settled'); shutdownDone = true;
    const [code, signal] = await bounded(exit, 'Supervisor exit'); assert.equal(code, 0); assert.equal(signal, null);
    for (const pid of before.providers) assert.equal(await lstat(`/proc/${pid}`).catch(() => null), null);
    assert.equal(stderr, '', 'Supervisor must not emit repair or cleanup errors');
    report.deletedAndExited = true;
    console.log(JSON.stringify(report, null, 2));
  } finally {
    for (const value of clients) value.dispose();
    if (worker && worker.exitCode === null && worker.signalCode === null) {
      // Ask only our directly created Supervisor to settle its owned executions.
      if (!shutdownDone && worker.connected) worker.send({ id: ++id, command: 'shutdown' });
      await bounded(exit, `fixture cleanup: ${stderr}`, 30000);
    }
    await rm(directory, { recursive: true, force: true });
  }
}
