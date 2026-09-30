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
    backendKind === 'systemd-user' ? 'strong' : 'best-effort', undefined, profile);
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
      process.send({ id, ok: true, loads });
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
      assert.deepEqual(results.map(({ loads }) => loads).sort(), [0, 1], 'The loser must not restore registry or journal.');
      const winner = results[0].ok ? first : second;
      const loser = results[0].ok ? second : first;
      assert.equal((await winner.send('start')).ok, false, 'The same object cannot start twice.');
      assert.equal(await readFile(path.join(f.storageDir, 'registry.json'), 'utf8'), registry);
      assert.equal((await winner.send('close-listener')).ok, true);
      await loser.stop();
      const alias = path.join(f.base, 'alias');
      await symlink(f.storageDir, alias);
      const contender = await worker({ ...f, storageDir: alias });
      const blocked = await contender.send('start');
      assert.equal(blocked.ok, false, 'Closing the business listener must retain the canonical namespace claim.');
      assert.equal(blocked.loads, 0);
      await contender.stop();
      await winner.stop();
      const replacement = await worker(f);
      assert.deepEqual(await replacement.send('start'), { id: 1, ok: true, loads: 1 });
      await replacement.stop();
    });

    for (const behavior of ['normal', 'unknown']) {
      await test(`${behavior} existing socket is not removed or restored`, async () => {
        const f = await fixture();
        const listener = net.createServer((socket) => socket.destroy());
        listeners.push(listener);
        await new Promise((resolve, reject) => { listener.once('error', reject); listener.listen(f.socketPath, resolve); });
        const before = await lstat(f.socketPath);
        const subject = await worker(f, behavior);
        const result = await subject.send('start');
        assert.equal(result.ok, false);
        assert.equal(result.loads, 0);
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
