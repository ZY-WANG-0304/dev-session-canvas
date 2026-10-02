import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import esbuild from 'esbuild';

const require = createRequire(import.meta.url);
const filename = fileURLToPath(import.meta.url);
const profile = 'linux-owner-v1-candidate';

if (process.argv[2] === '--worker') {
  runWorker();
} else {
  await runTests();
}

function runWorker() {
  const [, , , bundlePath, storageDir, socketPath, behavior = 'normal', backendKind = 'legacy-detached'] = process.argv;
  const guardedRequire = (name) => {
    if (name === 'node-pty') {
      throw new Error(`Forbidden worker dependency: ${name}`);
    }
    if (['child_process', 'node:child_process'].includes(name)) {
      return Object.fromEntries(['spawn', 'spawnSync', 'fork', 'exec', 'execSync', 'execFile', 'execFileSync']
        .map((method) => [method, () => { throw new Error(`Forbidden worker process acquisition: ${method}`); }]));
    }
    if (behavior === 'cleanup-denied' && ['fs', 'node:fs'].includes(name)) {
      const actual = require(name);
      return { ...actual, promises: { ...actual.promises, async rm(target, options) {
        if (path.basename(target) === 'terminal-journals') {
          throw Object.assign(new Error('Injected stale journal cleanup failure'), { code: 'EACCES' });
        }
        return actual.promises.rm(target, options);
      } } };
    }
    if (behavior === 'unknown' && ['net', 'node:net'].includes(name)) {
      return { ...require(name), createConnection() {
        const socket = new net.Socket();
        queueMicrotask(() => socket.destroy(Object.assign(new Error('Injected endpoint uncertainty'), { code: 'EACCES' })));
        return socket;
      } };
    }
    return require(name);
  };
  const module = { exports: {} };
  const runtimeProcess = behavior === 'old-node' ? { ...process, versions: { ...process.versions, node: '18.20.0' } }
    : behavior === 'other-platform' ? { ...process, platform: 'darwin' } : process;
  new Function('module', 'exports', 'require', 'process', readFileSync(bundlePath, 'utf8'))(
    module, module.exports, guardedRequire, runtimeProcess
  );
  const server = new module.exports.RuntimeSupervisorServer({ storageDir, socketPath,
    registryPath: path.join(storageDir, 'registry.json') }, backendKind,
    backendKind === 'systemd-user' ? 'strong' : 'best-effort', undefined, behavior === 'legacy' ? undefined : profile);
  let loads = 0;
  const loadRegistry = server.loadRegistry.bind(server);
  server.loadRegistry = async () => { loads += 1; await loadRegistry(); };
  process.on('message', async ({ id, command }) => {
    if (command === 'exit') process.exit(0);
    try {
      if (command === 'start') await server.start();
      if (command === 'close-listener') {
        server.clearIdleShutdownTimer();
        await new Promise((resolve, reject) => server.server.close((error) => error ? reject(error) : resolve()));
      }
      if (command === 'stale-listener') {
        const stale = net.createServer((socket) => socket.destroy());
        await new Promise((resolve, reject) => { stale.once('error', reject); stale.listen(socketPath, resolve); });
      }
      process.send({ id, ok: true, loads, ...(command === 'inspect' ? {
        sessions: [...server.sessions.values()].map(session => ({ sessionId: session.sessionId, output: session.output }))
      } : {}) });
    } catch (error) {
      process.send({ id, ok: false, loads, message: error.message, code: error.code });
    }
  });
  process.send({ ready: true });
}

async function runTests() {
  assert.equal(process.platform, 'linux', 'This bounded namespace test requires actual Linux abstract sockets.');
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dsc-namespace-'));
  const bundlePath = path.join(directory, 'supervisor.cjs');
  const workers = [];
  const listeners = [];
  let caseId = 0;
  let passed = 0;
  await esbuild.build({
    entryPoints: [path.resolve('extensions/vscode/dev-session-canvas/src/supervisor/runtimeSupervisorMain.ts')],
    bundle: true, platform: 'node', format: 'cjs', outfile: bundlePath, external: ['node-pty']
  });
  const fixture = async () => {
    const base = path.join(directory, String(++caseId));
    await mkdir(base);
    const storageDir = path.join(base, 'runtime-supervisor-generations', 'terminal-exit-v1', 'runtime-supervisor');
    return { base, storageDir, socketPath: path.join(base, 's.sock') };
  };
  const worker = async (f, behavior) => {
    const child = fork(filename, ['--worker', bundlePath, f.storageDir, f.socketPath, behavior ?? 'normal',
      f.backendKind ?? 'legacy-detached'],
      { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const pending = new Map();
    let nextId = 0;
    const exited = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
    const ready = new Promise((resolve, reject) => {
      child.on('message', (message) => {
        if (message.ready) resolve();
        else pending.get(message.id)?.(message);
      });
      child.once('error', reject);
      child.once('exit', () => reject(new Error(`Worker exited before ready: ${stderr}`)));
    });
    const control = { child, exited, async send(command) {
      const id = ++nextId;
      const response = new Promise((resolve) => pending.set(id, resolve));
      child.send({ id, command });
      try { return await bounded(response, `${command}: ${stderr}`); }
      finally { pending.delete(id); }
    }, async stop() {
      if (child.exitCode === null && child.signalCode === null) child.send({ command: 'exit' });
      await bounded(exited, 'worker exit');
    } };
    workers.push(control);
    await bounded(ready, 'worker ready');
    return control;
  };
  const test = async (name, run) => {
    try { await run(); passed += 1; }
    catch (error) { throw new Error(name, { cause: error }); }
  };
  try {
    await test('concurrent namespace startup has one writer; claim outlives public listener and releases on exit', async () => {
      const f = await fixture();
      await mkdir(f.storageDir, { recursive: true });
      const registry = '{"version":1,"sessions":[]}';
      await writeFile(path.join(f.storageDir, 'registry.json'), registry);
      const first = await worker(f);
      const second = await worker({ ...f, socketPath: path.join(f.base, 'systemd.sock'), backendKind: 'systemd-user' });
      const results = await Promise.all([first.send('start'), second.send('start')]);
      assert.equal(results.filter(({ ok }) => ok).length, 1, 'Exactly one candidate may enter this namespace.');
      assert.deepEqual(results.map(({ loads }) => loads).sort(), [0, 0], 'Neither the fresh candidate nor its losing contender restores old history.');
      const winner = results[0].ok ? first : second;
      const loser = results[0].ok ? second : first;
      assert.equal((await winner.send('start')).ok, false, 'The same object cannot start twice.');
      await assert.rejects(lstat(path.join(f.storageDir, 'registry.json')), { code: 'ENOENT' });
      await writeFile(path.join(f.storageDir, 'registry.json'), registry);
      await mkdir(path.join(f.storageDir, 'terminal-journals'));
      await writeFile(path.join(f.storageDir, 'terminal-journals', 'live-owned'), 'original live source');
      assert.equal((await winner.send('close-listener')).ok, true);
      await loser.stop();
      const alias = path.join(f.base, 'alias');
      await symlink(f.storageDir, alias);
      const contender = await worker({ ...f, storageDir: alias });
      const blocked = await contender.send('start');
      assert.equal(blocked.ok, false, 'Closing the business listener must retain the canonical namespace claim.');
      assert.equal(blocked.loads, 0);
      assert.equal(await readFile(path.join(f.storageDir, 'registry.json'), 'utf8'), registry);
      assert.equal(await readFile(path.join(f.storageDir, 'terminal-journals', 'live-owned'), 'utf8'), 'original live source');
      await contender.stop();
      await winner.stop();
      const replacement = await worker(f);
      assert.deepEqual(await replacement.send('start'), { id: 1, ok: true, loads: 0 });
      await assert.rejects(lstat(path.join(f.storageDir, 'registry.json')), { code: 'ENOENT' });
      await assert.rejects(lstat(path.join(f.storageDir, 'terminal-journals')), { code: 'ENOENT' });
      await replacement.stop();
    });

    await test('candidate cold start discards only its stale runtime history without parsing or replaying it', async () => {
      const f = await fixture();
      const journalRoot = path.join(f.storageDir, 'terminal-journals');
      const otherGeneration = path.join(f.base, 'runtime-supervisor-generations', 'terminal-v1', 'runtime-supervisor');
      await mkdir(journalRoot, { recursive: true });
      await mkdir(otherGeneration, { recursive: true });
      await writeFile(path.join(f.storageDir, 'registry.json'), '{malformed stale registry');
      await writeFile(path.join(journalRoot, 'malformed-segment'), '{invalid stale journal');
      await writeFile(path.join(otherGeneration, 'registry.json'), 'other generation must remain');
      await writeFile(path.join(f.base, 'canvas.json'), 'user canvas must remain');
      const subject = await worker(f);
      assert.deepEqual(await subject.send('start'), { id: 1, ok: true, loads: 0 });
      assert.deepEqual((await subject.send('inspect')).sessions, []);
      await assert.rejects(lstat(path.join(f.storageDir, 'registry.json')), { code: 'ENOENT' });
      await assert.rejects(lstat(journalRoot), { code: 'ENOENT' });
      assert.equal(await readFile(path.join(otherGeneration, 'registry.json'), 'utf8'), 'other generation must remain');
      assert.equal(await readFile(path.join(f.base, 'canvas.json'), 'utf8'), 'user canvas must remain');
      await subject.stop();
    });

    await test('failed stale cleanup rejects candidate startup before exposing a listener', async () => {
      const f = await fixture();
      const journalRoot = path.join(f.storageDir, 'terminal-journals');
      await mkdir(journalRoot, { recursive: true });
      await writeFile(path.join(journalRoot, 'retained-on-failure'), 'unremoved source');
      const subject = await worker(f, 'cleanup-denied');
      const result = await subject.send('start');
      assert.equal(result.ok, false);
      assert.equal(result.code, 'EACCES');
      assert.equal(result.loads, 0);
      await assert.rejects(lstat(f.socketPath), { code: 'ENOENT' });
      assert.equal(await readFile(path.join(journalRoot, 'retained-on-failure'), 'utf8'), 'unremoved source');
      await subject.stop();
    });

    await test('candidate cleanup cannot follow its generation path into unrelated runtime storage', async () => {
      const f = await fixture();
      const unrelated = path.join(f.base, 'legacy-runtime');
      await mkdir(unrelated);
      await mkdir(path.dirname(f.storageDir), { recursive: true });
      await writeFile(path.join(unrelated, 'registry.json'), 'legacy registry must remain');
      await symlink(unrelated, f.storageDir);
      const subject = await worker(f);
      const result = await subject.send('start');
      assert.equal(result.ok, false);
      assert.match(result.message, /isolated.*generation/);
      assert.equal(result.loads, 0);
      assert.equal(await readFile(path.join(unrelated, 'registry.json'), 'utf8'), 'legacy registry must remain');
      await assert.rejects(lstat(f.socketPath), { code: 'ENOENT' });
      await subject.stop();
    });

    await test('legacy cold start keeps its existing history restoration behavior', async () => {
      const f = await fixture();
      await mkdir(f.storageDir, { recursive: true });
      const session = { sessionId: '40000000-0000-4000-8000-000000000001', kind: 'terminal', live: false,
        lifecycle: 'closed', output: 'legacy saved terminal\r\n', cols: 80, rows: 24, scrollback: 100, outputSequence: 1 };
      const registry = JSON.stringify({ version: 1, sessions: [session] });
      await writeFile(path.join(f.storageDir, 'registry.json'), registry);
      const subject = await worker(f, 'legacy');
      assert.deepEqual(await subject.send('start'), { id: 1, ok: true, loads: 1 });
      assert.deepEqual((await subject.send('inspect')).sessions, [{ sessionId: session.sessionId, output: session.output }]);
      assert.equal(await readFile(path.join(f.storageDir, 'registry.json'), 'utf8'), registry);
      await subject.stop();
    });

    for (const behavior of ['normal', 'unknown']) {
      await test(`${behavior} existing socket is not removed or restored`, async () => {
        const f = await fixture();
        await mkdir(path.join(f.storageDir, 'terminal-journals'), { recursive: true });
        await writeFile(path.join(f.storageDir, 'registry.json'), 'must not remove without safe endpoint');
        await writeFile(path.join(f.storageDir, 'terminal-journals', 'retained'), 'source must remain');
        const listener = net.createServer((socket) => socket.destroy());
        listeners.push(listener);
        await new Promise((resolve, reject) => { listener.once('error', reject); listener.listen(f.socketPath, resolve); });
        const before = await lstat(f.socketPath);
        const subject = await worker(f, behavior);
        const result = await subject.send('start');
        assert.equal(result.ok, false);
        assert.equal(result.loads, 0);
        assert.equal(await readFile(path.join(f.storageDir, 'registry.json'), 'utf8'), 'must not remove without safe endpoint');
        assert.equal(await readFile(path.join(f.storageDir, 'terminal-journals', 'retained'), 'utf8'), 'source must remain');
        const after = await lstat(f.socketPath);
        assert.equal(after.ino, before.ino);
        assert.equal(after.dev, before.dev);
        await new Promise((resolve, reject) => {
          const socket = net.createConnection(f.socketPath);
          socket.once('error', reject);
          socket.once('connect', () => { socket.destroy(); resolve(); });
        });
        await subject.stop();
        await new Promise((resolve) => listener.close(resolve));
      });
    }

    await test('a positively stale socket can be replaced after claim acquisition', async () => {
      const f = await fixture();
      const stale = await worker(f);
      assert.equal((await stale.send('stale-listener')).ok, true);
      await stale.stop();
      assert.equal((await lstat(f.socketPath)).isSocket(), true);
      const subject = await worker(f);
      assert.equal((await subject.send('start')).ok, true);
      await subject.stop();
    });

    await test('a non-socket endpoint is preserved and registry is never restored', async () => {
      const f = await fixture();
      await writeFile(f.socketPath, 'unrelated file');
      const subject = await worker(f);
      const result = await subject.send('start');
      assert.equal(result.ok, false);
      assert.equal(result.loads, 0);
      assert.equal(await readFile(f.socketPath, 'utf8'), 'unrelated file');
      await subject.stop();
    });

    for (const behavior of ['old-node', 'other-platform']) {
      await test(`${behavior} refuses before storage or startup resources`, async () => {
        const f = await fixture();
        const subject = await worker(f, behavior);
        const result = await subject.send('start');
        assert.equal(result.ok, false);
        assert.equal(result.loads, 0);
        await assert.rejects(lstat(f.storageDir), { code: 'ENOENT' });
        await subject.stop();
      });
    }
    console.log(`runtime supervisor namespace tests passed (${passed} bounded Linux cases; no PTY/Agent)`);
  } finally {
    for (const subject of workers) {
      try { await subject.stop(); }
      catch { subject.child.kill('SIGKILL'); await bounded(subject.exited, 'forced test worker exit'); }
    }
    for (const listener of listeners) {
      if (listener.listening) await new Promise((resolve) => listener.close(resolve));
    }
    await rm(directory, { recursive: true, force: true });
  }
}

async function bounded(promise, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), 5000);
    })]);
  } finally { clearTimeout(timer); }
}
