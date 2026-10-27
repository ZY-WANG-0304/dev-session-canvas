import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, lstat, writeFile, readFile, chmod } from 'node:fs/promises';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import esbuild from 'esbuild';

if (process.platform === 'win32') {
  console.log('Unix socket pathname recovery is not applicable to Windows named pipes.');
} else {
  const require = createRequire(import.meta.url);
  const built = await esbuild.build({ entryPoints: ['extensions/vscode/dev-session-canvas/src/supervisor/runtimeSocketListener.ts'],
    bundle: true, platform: 'node', format: 'cjs', write: false });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', built.outputFiles[0].text)(require, module, module.exports);
  const { RuntimeSocketListener } = module.exports;
  let passed = 0;
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsc-listener-'));
  async function until(condition, label) {
    const deadline = Date.now() + 5000;
    while (!await condition()) {
      assert(Date.now() < deadline, label);
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }
  async function run(name, body) {
    const directory = path.join(root, String(++passed));
    const socketDirectory = path.join(directory, 'socket');
    const socketPath = path.join(socketDirectory, 'r.sock');
    await mkdir(socketDirectory, { recursive: true, mode: 0o700 });
    const accepted = new Set(), clients = new Set(), errors = [];
    let hook = async () => {};
    const prepare = async () => {
      await hook();
      await mkdir(socketDirectory, { recursive: true, mode: 0o700 });
      const st = await lstat(socketDirectory);
      if (!st.isDirectory() || st.uid !== process.getuid() || (st.mode & 0o777) !== 0o700) throw new Error('Unsafe socket directory');
    };
    const listener = new RuntimeSocketListener(socketPath, prepare, socket => {
      accepted.add(socket); socket.once('close', () => accepted.delete(socket)); socket.on('error', () => {});
      socket.on('data', data => socket.write(data));
    }, error => errors.push(error.message), 20);
    const connect = async () => {
      const socket = net.createConnection(socketPath); clients.add(socket);
      await once(socket, 'connect'); socket.on('error', () => {}); return socket;
    };
    const echo = async (socket, text) => {
      const data = once(socket, 'data'); socket.write(text); assert.equal(String((await data)[0]), text);
    };
    const close = () => new Promise((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
    try {
      await listener.start();
      await body({ listener, socketPath, socketDirectory, connect, echo, close, errors,
        setHook: value => { hook = value; }, accepted, clients });
      console.log(`PASS ${name}`);
    } finally {
      hook = async () => {};
      for (const socket of [...clients, ...accepted]) socket.destroy();
      await close();
    }
  }
  try {
    for (const removal of ['file', 'directory']) await run(`${removal} removal preserves old connection and repairs new connections`, async f => {
      const old = await f.connect(); await f.echo(old, 'before');
      const original = await lstat(f.socketPath);
      await rm(removal === 'file' ? f.socketPath : f.socketDirectory, { recursive: true });
      await f.echo(old, 'during');
      await until(async () => (await lstat(f.socketPath).catch(() => null))?.isSocket(), 'listener repaired');
      assert.equal((await lstat(f.socketDirectory)).mode & 0o777, 0o700);
      const fresh = await f.connect(); await f.echo(fresh, 'new'); await f.echo(old, 'old');
      assert.equal(f.errors.length, 0);
      assert.equal(f.accepted.size, 2);
    });
    await run('repeated removal releases retired listeners after their connections close', async f => {
      for (let i = 0; i < 5; i++) {
        const socket = await f.connect(); await f.echo(socket, `round-${i}`);
        await rm(f.socketPath);
        await until(async () => (await lstat(f.socketPath).catch(() => null))?.isSocket(), 'repaired');
        socket.destroy();
      }
      await until(() => f.listener.servers.size === 1, 'retired listeners released');
    });
    await run('replacement file is preserved and diagnosed, then repair resumes when removed', async f => {
      await rm(f.socketPath); await writeFile(f.socketPath, 'keep-me', { flag: 'wx' });
      await until(() => f.errors.length > 0, 'replacement diagnosed');
      assert.equal(await readFile(f.socketPath, 'utf8'), 'keep-me');
      await rm(f.socketPath);
      await until(async () => (await lstat(f.socketPath).catch(() => null))?.isSocket(), 'repaired after obstruction');
      await f.echo(await f.connect(), 'restored');
    });
    await run('unsafe recreated directory is not chmodded and can recover after external correction', async f => {
      await rm(f.socketDirectory, { recursive: true }); await mkdir(f.socketDirectory, { mode: 0o755 });
      await until(() => f.errors.includes('Unsafe socket directory'), 'permissions diagnosed');
      assert.equal((await lstat(f.socketDirectory)).mode & 0o777, 0o755);
      await chmod(f.socketDirectory, 0o700);
      await until(async () => (await lstat(f.socketPath).catch(() => null))?.isSocket(), 'repaired permissions');
    });
    await run('shutdown waits for accepted connections from both listener generations', async f => {
      const old = await f.connect(); await f.echo(old, 'a');
      await rm(f.socketPath);
      await until(async () => (await lstat(f.socketPath).catch(() => null))?.isSocket(), 'repaired');
      const fresh = await f.connect(); await f.echo(fresh, 'b');
      let closed = false; const closing = f.close().then(() => { closed = true; });
      await new Promise(resolve => setTimeout(resolve, 60)); assert.equal(closed, false);
      fresh.destroy(); await new Promise(resolve => setTimeout(resolve, 30)); assert.equal(closed, false);
      old.destroy(); await closing; assert.equal(f.listener.servers.size, 0);
      await new Promise(resolve => setTimeout(resolve, 60));
      assert.equal(await lstat(f.socketPath).catch(() => null), null);
    });
    await run('shutdown during directory preparation never opens another listener', async f => {
      let entered = false, release;
      const gate = new Promise(resolve => { release = resolve; });
      f.setHook(async () => { entered = true; await gate; });
      await rm(f.socketDirectory, { recursive: true });
      await until(() => entered, 'repair entered');
      const closing = f.close(); release(); await closing;
      assert.equal(await lstat(f.socketPath).catch(() => null), null);
      assert.equal(f.listener.servers.size, 0);
    });
    console.log(`Runtime socket listener tests passed (${passed}).`);
  } finally { await rm(root, { recursive: true, force: true }); }
}
