import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import esbuild from 'esbuild';
import { buildRuntimeReleaseBaseline, runtimeReleaseBaselineCommit } from './runtime-release-baseline.mjs';
import { captureProcessIdentity, observeOriginalProcesses, signalOriginalProcess, trackDescendants } from './runtime-release-processes.mjs';

assert.equal(process.platform, 'linux', 'This native upgrade test uses Linux PTY and /proc process identities.');
const { values } = parseArgs({ options: { 'baseline-extension': { type: 'string' }, 'baseline-commit': { type: 'string' }, output: { type: 'string' } } });
assert(!(values['baseline-extension'] && values['baseline-commit']), 'Choose one baseline source.');
const require = createRequire(import.meta.url);
const extension = path.resolve('extensions/vscode/dev-session-canvas');
const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dsc-release-upgrade-')));
const profile = 'linux-owner-v1-candidate';
const instances = [];
const clients = [];
const evidence = { schemaVersion: 2, platform: process.platform,
  realPty: true, realAgentCli: false, cases: [], runtimes: [], forcedCleanup: [], cleanupErrors: [] };
const workDeadline = Number(process.env.DEV_SESSION_CANVAS_GATE_DEADLINE ?? Date.now() + 180000);
const cleanupDeadline = Number(process.env.DEV_SESSION_CANVAS_GATE_CLEANUP_DEADLINE ?? workDeadline + 60000);
assert(Number.isFinite(workDeadline) && workDeadline > Date.now());
assert(Number.isFinite(cleanupDeadline) && cleanupDeadline > workDeadline);
let cancelled = false;
let cleaning = false;
const controller = new AbortController();
const cancel = () => { cancelled = true; controller.abort(); };
process.on('SIGTERM', cancel);
process.on('SIGINT', cancel);
let api;
let failure;

async function until(read, label, timeout = 15000) {
  const deadline = Math.min(Date.now() + timeout, cleaning ? cleanupDeadline : workDeadline);
  while (true) {
    assert(cleaning || !cancelled, 'Upgrade fixture cancelled.');
    assert(Date.now() < deadline, `Timed out: ${label}`);
    const result = await read();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

async function copyRuntime(source, name) {
  const target = path.join(directory, name);
  await mkdir(path.join(target, 'dist'), { recursive: true });
  for (const file of ['runtime-supervisor.js', 'runtime-supervisor-launcher.js', 'linux-execution-provider.js']) {
    await cp(path.join(source, 'dist', file), path.join(target, 'dist', file));
  }
  const native = `native/linux-execution-candidate/linux-${process.arch}-glibc`;
  await cp(path.join(source, 'dist', native), path.join(target, 'dist', native), { recursive: true });
  await symlink(path.resolve('node_modules'), path.join(target, 'node_modules'), 'dir');
  return target;
}

function connect(instance) {
  const client = new api.RuntimeSupervisorClient({ executionProfile: profile, expectedRuntimeOwner: instance.owner,
    supervisorScriptPath: '/forbidden-restart', supervisorLauncherScriptPath: '/forbidden-restart',
    backend: { kind: 'legacy-detached', guarantee: 'best-effort', paths: instance.paths,
      startSupervisor: () => assert.fail('Existing binding must not start a substitute Supervisor.') } });
  clients.push(client);
  return client;
}

async function start(runtime, release, globalStorage, rootPath) {
  const environment = await api.readRuntimeExecutionEnvironment();
  const owner = api.createRuntimeOwnerDescriptor({ environmentKey: environment.environmentKey,
    userStorageScopeKey: api.createRuntimeUserStorageScopeKey(environment.userIdentity, globalStorage), rootPath,
    generation: api.resolveRootRuntimeSupervisorGeneration(profile, release) });
  const storageDir = path.join(api.resolveRuntimeRootOwnerBaseStoragePath(globalStorage, owner), 'runtime-supervisor');
  await api.publishRuntimeRootOwner(storageDir, owner);
  const intent = api.createRuntimeRootStartupIntent(owner, 'legacy-detached', api.createRuntimeOwnerCompatibilityFingerprint(owner.generation, profile));
  await api.writeRuntimeRootStartupIntent(storageDir, intent);
  const paths = api.resolveLegacyRuntimeSupervisorPathsFromStorageDir(storageDir);
  const child = spawn(process.execPath, [path.join(runtime, 'dist/runtime-supervisor.js'), '--storage-dir', storageDir,
    '--runtime-backend', 'legacy-detached', '--runtime-guarantee', 'best-effort', '--execution-profile', profile,
    '--runtime-launch-token', intent.token], { stdio: ['ignore', 'ignore', 'pipe'] });
  const record = { name: path.basename(runtime), generation: owner.generation, originalProcesses: [] };
  const instance = { owner, paths, child, stderr: '', sessions: [], record };
  instances.push(instance);
  evidence.runtimes.push(record);
  child.stderr.on('data', chunk => { instance.stderr = (instance.stderr + chunk).slice(-12000); });
  instance.exit = once(child, 'exit');
  instance.exit.catch(() => {});
  instance.identity = { ...await captureProcessIdentity(child.pid), role: 'supervisor' };
  record.originalProcesses.push(instance.identity);
  instance.client = connect(instance);
  await until(async () => {
    assert(child.exitCode === null && child.signalCode === null, `Supervisor exited: ${instance.stderr}`);
    try { instance.hello = await instance.client.hello(); return true; }
    catch (error) { if (!['ENOENT', 'ECONNREFUSED'].includes(error.code)) throw error; return false; }
  }, 'Supervisor ready');
  assert.equal(instance.hello.pid, child.pid);
  return instance;
}

async function create(instance, kind, subject, rootPath) {
  const sessionId = randomUUID();
  await instance.client.createSession({ executionProfile: profile, sessionId, kind, displayLabel: kind,
    ...(kind === 'agent' ? { provider: 'codex' } : {}), launchMode: 'start', scrollback: 1000, deferSubscription: true,
    launchSpec: { file: process.execPath, args: [subject], cwd: rootPath, cols: 80, rows: 24,
      env: { ...process.env, TERM: 'xterm-256color' } } });
  instance.sessions.push(sessionId);
  const snapshot = await until(async () => {
    const snapshot = await instance.client.getSessionSnapshot({ sessionId });
    assert(snapshot.live, 'Original session must remain live.');
    return snapshot.output.includes('READY:') ? snapshot : undefined;
  }, 'PTY startup');
  await trackDescendants(instance.identity, instance.record.originalProcesses);
  assert.equal(instance.record.originalProcesses.length, 1 + instance.sessions.length * 2, 'Every provider and real PTY must be captured.');
  return snapshot;
}

async function interact(client, snapshot) {
  const nonce = randomUUID();
  await client.writeInput({ sessionId: snapshot.sessionId, data: nonce + '\n' });
  await until(async () => (await client.getSessionSnapshot({ sessionId: snapshot.sessionId })).output.includes(`ECHO:${nonce}`), 'PTY echo');
  await client.resizeSession({ sessionId: snapshot.sessionId, cols: 93, rows: 31 });
  const resized = await client.getSessionSnapshot({ sessionId: snapshot.sessionId });
  assert.equal(resized.cols, 93);
  assert.equal(resized.rows, 31);
  assert.equal(resized.terminalAuthorityId, snapshot.terminalAuthorityId);
  const reader = await client.openTerminalRead({ sessionId: snapshot.sessionId, authorityId: snapshot.terminalAuthorityId,
    consumerId: 'panel', currentState: 'xterm-current-state-v1', settlementMode: 'final-application-v1' });
  assert.equal(reader.authorityId, snapshot.terminalAuthorityId);
  const settled = await client.closeTerminalRead({ sessionId: snapshot.sessionId, authorityId: reader.authorityId,
    readId: reader.readId, outcome: { kind: 'cancelled', reason: 'live-upgrade-reader-verification' } });
  assert.equal(settled.settlement, 'recorded');
}

async function retire(instance) {
  for (const sessionId of instance.sessions) await instance.client.deleteSession({ sessionId });
  await until(async () => JSON.parse(await readFile(instance.paths.registryPath, 'utf8')).sessions.length === 0, 'strict session retirement');
  for (const client of clients) if (client.matchesRuntimeOwner(instance.owner)) client.dispose();
  await until(() => instance.child.exitCode !== null || instance.child.signalCode !== null, 'natural Supervisor idle exit', 45000);
  assert.deepEqual(await instance.exit, [0, null], instance.stderr);
  instance.record.retirement = await until(async () => {
    const observations = await observeOriginalProcesses(instance.record.originalProcesses);
    return observations.every(item => item.observed === 'absent') ? observations : undefined;
  }, 'original Supervisor/provider/PTY disappearance');
  instance.record.retiredAt = new Date().toISOString();
}

try {
  const support = path.join(directory, 'support.cjs');
  await esbuild.build({ stdin: { contents: `
    export * from './extensions/vscode/dev-session-canvas/src/common/runtimeRootOwnership';
    export * from './extensions/vscode/dev-session-canvas/src/panel/runtimeRelease';
    export * from './extensions/vscode/dev-session-canvas/src/common/runtimeSupervisorPaths';
    export * from './extensions/vscode/dev-session-canvas/src/supervisor/runtimeRootOwner';
    export * from './extensions/vscode/dev-session-canvas/src/supervisor/runtimeRootStartup';
    export { readRuntimeExecutionEnvironment } from './extensions/vscode/dev-session-canvas/src/panel/runtimeExecutionEnvironment';
    export { RuntimeSupervisorClient } from './extensions/vscode/dev-session-canvas/src/panel/runtimeSupervisorClient';
  `, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', outfile: support });
  api = require(support);
  const globalStorage = path.join(directory, 'global');
  const rootPath = path.join(directory, 'project');
  await mkdir(globalStorage, { mode: 0o700 });
  await mkdir(rootPath);
  const subject = path.join(directory, 'subject.cjs');
  await writeFile(subject, [
    "process.stdout.write('READY:' + process.pid + '\\n');",
    "require('node:readline').createInterface({ input: process.stdin }).on('line', value => process.stdout.write('ECHO:' + value + '\\n'));"
  ].join('\n'));
  const baseline = values['baseline-extension']
    ? { extension: path.resolve(values['baseline-extension']), evidence: { kind: 'external-baseline' } }
    : await buildRuntimeReleaseBaseline({ directory, currentExtension: extension, deadline: workDeadline,
      signal: controller.signal, commit: values['baseline-commit'] ?? runtimeReleaseBaselineCommit });
  evidence.baseline = baseline.evidence;
  const oldRuntime = await copyRuntime(baseline.extension, 'old-extension');
  const currentRuntime = await copyRuntime(extension, 'current-extension');
  const nextRuntime = await copyRuntime(extension, 'next-extension');
  const nextRelease = '999.0.1';
  assert.notEqual(nextRelease, api.RUNTIME_RELEASE_VERSION);
  await esbuild.build({ entryPoints: [path.join(extension, 'src/supervisor/runtimeSupervisorMain.ts')],
    bundle: true, platform: 'node', format: 'cjs', external: ['node-pty'], outfile: path.join(nextRuntime, 'dist/runtime-supervisor.js'),
    define: { __DEV_SESSION_CANVAS_EXECUTION_ADMISSION__: JSON.stringify({ executions: null, starting: 1, pending: 2 }) },
    plugins: [{ name: 'isolated-release-manifest', setup(build) {
      build.onLoad({ filter: /package\.json$/ }, args => args.path === path.join(extension, 'package.json')
        ? { contents: JSON.stringify({ version: nextRelease }), loader: 'json' } : undefined);
    } }] });
  const historical = await start(oldRuntime, undefined, globalStorage, rootPath);
  const originals = [await create(historical, 'terminal', subject, rootPath), await create(historical, 'agent', subject, rootPath)];
  const originalProcesses = structuredClone(historical.record.originalProcesses);
  assert.equal(originalProcesses.length, 5, 'Supervisor, two providers and two real PTY children must be present.');
  if (!values['baseline-extension']) await rm(path.join(directory, 'baseline-source'), { recursive: true });
  await rm(oldRuntime, { recursive: true });
  await assert.rejects(create(historical, 'terminal', subject, rootPath), /ENOENT.*old-extension/);
  evidence.cases.push('deleted-installation-rejects-historical-create');
  const current = await start(currentRuntime, api.RUNTIME_RELEASE_VERSION, globalStorage, rootPath);
  const created = await create(current, 'terminal', subject, rootPath);
  const next = await start(nextRuntime, nextRelease, globalStorage, rootPath);
  const newer = await create(next, 'agent', subject, rootPath);
  assert.equal(new Set(instances.map(instance => instance.child.pid)).size, 3);
  assert.equal(new Set(instances.map(instance => instance.paths.socketPath)).size, 3);
  const anotherWindow = connect(current);
  assert.equal((await anotherWindow.hello()).pid, current.child.pid);
  const restored = connect(historical);
  assert.equal((await restored.hello()).pid, historical.child.pid);
  for (const original of originals) {
    const attached = await restored.attachSession({ sessionId: original.sessionId, deferSubscription: true });
    assert.equal(attached.terminalAuthorityId, original.terminalAuthorityId);
    await interact(restored, original);
  }
  await interact(current.client, created);
  await interact(next.client, newer);
  for (const original of originalProcesses) {
    assert.deepEqual(await captureProcessIdentity(original.pid), { pid: original.pid, startTicks: original.startTicks, executable: original.executable });
  }
  const observedTree = [historical.identity];
  await trackDescendants(historical.identity, observedTree);
  assert.deepEqual(observedTree, originalProcesses);
  evidence.cases.push('release-isolation-and-live-reader-continuity');
  await retire(historical);
  await interact(current.client, created);
  await interact(next.client, newer);
  evidence.cases.push('historical-retirement-preserves-new-executions');
  await Promise.all([retire(current), retire(next)]);
  evidence.cases.push('all-fixtures-retire-naturally');
  evidence.actionCompletedAt = new Date().toISOString();
  assert(Date.parse(evidence.actionCompletedAt) <= workDeadline, 'Upgrade action borrowed cleanup time.');
} catch (error) {
  failure = error;
} finally {
  cleaning = true;
  evidence.cleanupStartedAt = new Date().toISOString();
  for (const client of clients) client.dispose();
  for (const instance of instances) {
    try {
      if (instance.identity) await trackDescendants(instance.identity, instance.record.originalProcesses);
    } catch (error) { evidence.cleanupErrors.push(error.message); }
  }
  const identities = instances.flatMap(instance => instance.record.originalProcesses);
  for (const signal of ['SIGTERM', 'SIGKILL']) {
    for (const identity of identities) {
      try {
        if (await signalOriginalProcess(identity, signal)) evidence.forcedCleanup.push({ ...identity, signal });
      } catch (error) { evidence.cleanupErrors.push(error.message); }
    }
    const gone = await until(async () => (await observeOriginalProcesses(identities)).every(item => item.observed === 'absent'),
      'original fixture process cleanup', 15000).catch(() => false);
    if (gone) break;
  }
  for (const instance of instances) {
    try { instance.record.cleanup = await observeOriginalProcesses(instance.record.originalProcesses); }
    catch (error) { evidence.cleanupErrors.push(error.message); }
  }
  await rm(directory, { recursive: true, force: true }).catch(error => { evidence.cleanupErrors.push(error.message); });
  evidence.cleanupCompletedAt = new Date().toISOString();
  evidence.cleanup = evidence.cleanupErrors.length === 0
    && instances.every(instance => (instance.child.exitCode !== null || instance.child.signalCode !== null)
      && instance.record.cleanup?.length > 0 && instance.record.cleanup.every(item => item.observed === 'absent'))
    && Date.parse(evidence.cleanupCompletedAt) <= cleanupDeadline ? 'passed' : 'failed';
  evidence.passed = !failure && !cancelled && evidence.forcedCleanup.length === 0 && evidence.cleanup === 'passed';
  if (values.output) await writeFile(path.resolve(values.output), JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence));
  process.off('SIGTERM', cancel);
  process.off('SIGINT', cancel);
}
if (failure) throw failure;
assert.equal(evidence.passed, true);
