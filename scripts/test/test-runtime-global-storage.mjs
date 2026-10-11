import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import esbuild from 'esbuild';

const require = createRequire(import.meta.url);
const { outputFiles } = await esbuild.build({ stdin: { contents:
  "export * from './extensions/vscode/dev-session-canvas/src/panel/runtimeGlobalStorage';",
  resolveDir: process.cwd(), loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false });
const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'runtime-global-storage-')));
let sequence = 0;
let passed = 0;
function load(overrides = {}, platform = process.platform) {
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'process', outputFiles[0].text)(name =>
    name === 'node:fs/promises' ? { ...fs, ...overrides } : require(name), module, module.exports,
    { ...process, platform });
  return module.exports.prepareRuntimeGlobalStorage;
}
const prepare = load();
const modeOf = async filename => (await fs.lstat(filename)).mode & 0o7777;
async function fixture(mode = 0o775) {
  const target = path.join(directory, String(++sequence));
  await fs.mkdir(target, { mode: 0o700 });
  await fs.writeFile(path.join(target, 'retained'), 'existing canvas');
  if (process.platform !== 'win32') await fs.chmod(target, mode);
  return target;
}
async function test(name, run) {
  try { await run(); passed++; console.log(`PASS ${name}`); }
  catch (error) { throw new Error(name, { cause: error }); }
}
try {
  await test('new storage is canonical and private despite umask 0002', async () => {
    const target = path.join(directory, String(++sequence), 'global');
    const previous = process.umask(0o002);
    try { assert.equal(await prepare(target), await fs.realpath(target)); }
    finally { process.umask(previous); }
    if (process.platform !== 'win32') assert.equal(await modeOf(target), 0o700);
  });
  if (process.platform !== 'win32') {
    for (const mode of [0o775, 0o770, 0o755, 0o750, 0o700]) {
      await test(`owned ${mode.toString(8)} retains inode and contents, removes only group write`, async () => {
        const target = await fixture(mode);
        const before = await fs.stat(target);
        let changes = 0;
        const run = load({ async open(...args) {
          const handle = await fs.open(...args);
          const chmod = handle.chmod.bind(handle);
          handle.chmod = async mode => { changes++; return chmod(mode); };
          return handle;
        } });
        assert.equal(await run(target), target);
        assert.equal(await modeOf(target), mode & ~0o020);
        assert.equal((await fs.stat(target)).ino, before.ino);
        assert.equal(await fs.readFile(path.join(target, 'retained'), 'utf8'), 'existing canvas');
        await run(target);
        assert.equal(changes, mode & 0o020 ? 1 : 0);
      });
    }
    for (const mode of [0o777, 0o707, 0o2775, 0o1775, 0o500]) {
      await test(`unsafe ${mode.toString(8)} is refused without chmod`, async () => {
        const target = await fixture(mode);
        await assert.rejects(prepare(target), { reason: 'unsafe' });
        assert.equal(await modeOf(target), mode);
      });
    }
    await test('foreign owner is not modified', async () => {
      const target = await fixture();
      const run = load({ async lstat(...args) {
        const stat = await fs.lstat(...args);
        stat.uid++;
        return stat;
      } });
      await assert.rejects(run(target), { reason: 'unsafe' });
      assert.equal(await modeOf(target), 0o775);
    });
    await test('symbolic link is refused without changing its target', async () => {
      const target = await fixture();
      const alias = path.join(directory, `alias-${++sequence}`);
      await fs.symlink(target, alias);
      await assert.rejects(prepare(alias), { reason: 'unsafe' });
      assert.equal(await modeOf(target), 0o775);
    });
    for (const boundary of ['open', 'before-chmod', 'after-chmod']) {
      await test(`directory replacement at ${boundary} never chmods the replacement`, async () => {
        const target = await fixture();
        const previous = `${target}-original`;
        let stats = 0;
        const replace = async () => {
          await fs.rename(target, previous);
          await fs.mkdir(target, { mode: 0o775 });
          await fs.chmod(target, 0o775);
        };
        const run = load({ async open(...args) {
          if (boundary === 'open') await replace();
          return fs.open(...args);
        }, async lstat(...args) {
          stats++;
          if ((boundary === 'before-chmod' && stats === 2) || (boundary === 'after-chmod' && stats === 3)) await replace();
          return fs.lstat(...args);
        } });
        await assert.rejects(run(target), { reason: 'changed' });
        assert.equal(await modeOf(target), 0o775);
        assert.equal(await modeOf(previous), boundary === 'after-chmod' ? 0o755 : 0o775);
      });
    }
    await test('concurrent preparations accept another caller removing group write', async () => {
      const target = await fixture();
      assert.deepEqual(await Promise.all(Array.from({ length: 16 }, () => prepare(target))), Array(16).fill(target));
      assert.equal(await modeOf(target), 0o755);
    });
    await test('chmod failure is safe, bounded and does not leak OS error detail', async () => {
      const target = await fixture();
      const run = load({ async open(...args) {
        const handle = await fs.open(...args);
        handle.chmod = async () => { throw new Error('sensitive OS detail'); };
        return handle;
      } });
      await assert.rejects(run(target), error => error.reason === 'unavailable' && !error.message.includes('sensitive'));
      assert.equal(await modeOf(target), 0o775);
    });
  }
  await test('regular file is refused and retained', async () => {
    const target = path.join(directory, `file-${++sequence}`);
    await fs.writeFile(target, 'keep');
    await assert.rejects(prepare(target));
    assert.equal(await fs.readFile(target, 'utf8'), 'keep');
  });
  await test('relative storage is rejected before filesystem preparation', async () => {
    const run = load({ mkdir() { assert.fail('unconfirmed storage path'); } });
    await assert.rejects(run('relative-storage'), { reason: 'unsafe' });
  });
  await test('Windows branch does not derive ACLs from POSIX mode or open directories for chmod', async () => {
    const target = await fixture();
    const run = load({ open() { assert.fail('POSIX directory open on Windows'); } }, 'win32');
    assert.equal(await run(target), target);
  });
  console.log(`Runtime global storage: ${passed} passed.`);
} finally {
  for (const entry of await fs.readdir(directory)) {
    const target = path.join(directory, entry);
    if ((await fs.lstat(target)).isDirectory()) await fs.chmod(target, 0o700);
  }
  await fs.rm(directory, { recursive: true, force: true });
}
