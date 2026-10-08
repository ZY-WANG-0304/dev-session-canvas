import assert from 'node:assert/strict';
import { chmod, link, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import esbuild from 'esbuild';

const require = createRequire(import.meta.url);
const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dsc-root-owner-storage-')));
const environment = { environmentKey: 'a'.repeat(64), userIdentity: 'uid:controlled-user' };
const profile = ({ linux: 'linux-owner-v1-candidate', darwin: 'macos-owner-v1-candidate',
  win32: 'windows-owner-v1-candidate' })[process.platform];
assert.ok(profile);
let sequence = 0;
let probeError;
let failRename = false;
let foreignUidPath;
try {
  const { outputFiles } = await esbuild.build({
    stdin: { contents: `
      export * from './extensions/vscode/dev-session-canvas/src/supervisor/runtimeRootOwner';
      export * from './extensions/vscode/dev-session-canvas/src/common/runtimeRootOwnership';
    `, resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, platform: 'node', format: 'cjs', write: false,
    plugins: [{ name: 'controlled-environment', setup(build) {
      build.onResolve({ filter: /\/runtimeExecutionEnvironment$/ }, () => ({ path: 'test-environment', external: true }));
    } }]
  });
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', outputFiles[0].text)(name => {
    if (name === 'test-environment') return { async readRuntimeExecutionEnvironment() {
      if (probeError) throw probeError;
      return { ...environment };
    } };
    if (name === 'fs/promises') return { ...require(name), async rename(from, to) {
      if (failRename) throw new Error('Injected publication failure');
      return require(name).rename(from, to);
    }, async lstat(filename, ...args) {
      const state = await require(name).lstat(filename, ...args);
      return filename === foreignUidPath
        ? Object.assign(Object.create(Object.getPrototypeOf(state)), state, { uid: state.uid + 1 }) : state;
    } };
    return require(name);
  }, loaded, loaded.exports);
  const { createRuntimeOwnerDescriptor, createRuntimeUserStorageScopeKey, resolveRootRuntimeSupervisorGeneration,
    resolveRuntimeRootOwnerBaseStoragePath, prepareRuntimeRootOwnerDirectories, publishRuntimeRootOwner,
    readRuntimeRootOwner } = loaded.exports;

  async function fixture(changes = {}) {
    const globalStoragePath = path.join(directory, `global-${++sequence}`);
    await mkdir(globalStoragePath, { mode: 0o700 });
    const owner = createRuntimeOwnerDescriptor({ environmentKey: environment.environmentKey,
      userStorageScopeKey: createRuntimeUserStorageScopeKey(environment.userIdentity, globalStoragePath),
      rootPath: path.join(directory, 'project '), generation: resolveRootRuntimeSupervisorGeneration(profile), ...changes });
    const base = resolveRuntimeRootOwnerBaseStoragePath(globalStoragePath, owner);
    const storageDir = path.join(base, 'runtime-supervisor');
    const preparationDir = path.join(base, 'startup-preparation');
    let current = globalStoragePath;
    const createdDirectories = path.relative(globalStoragePath, base).split(path.sep).map(component => {
      current = path.join(current, component);
      return current;
    });
    return { owner, globalStoragePath, base, storageDir, preparationDir, ownerPath: path.join(base, 'owner.json'),
      createdDirectories: [...createdDirectories, storageDir, preparationDir] };
  }

  const f = await fixture();
  if (process.platform !== 'win32') await chmod(f.globalStoragePath, 0o755);
  assert.deepEqual(await prepareRuntimeRootOwnerDirectories(f.storageDir, f.owner), { preparationDir: f.preparationDir });
  for (const name of f.createdDirectories) {
    const state = await lstat(name);
    assert.equal(state.isDirectory(), true);
    if (process.platform !== 'win32') assert.equal(state.mode & 0o7777, 0o700);
  }
  await assert.rejects(readFile(f.ownerPath), { code: 'ENOENT' });
  const registry = path.join(f.storageDir, 'registry.json');
  const journal = path.join(f.storageDir, 'terminal-journals', 'retained');
  await mkdir(path.dirname(journal), { mode: 0o700 });
  await writeFile(registry, 'retained registry');
  await writeFile(journal, 'retained journal');
  await publishRuntimeRootOwner(f.storageDir, f.owner);
  assert.deepEqual(JSON.parse(await readFile(f.ownerPath, 'utf8')), f.owner);
  if (process.platform !== 'win32') assert.equal((await lstat(f.ownerPath)).mode & 0o7777, 0o600);
  const formatted = JSON.stringify({ generation: f.owner.generation, root: f.owner.root,
    userStorageScopeKey: f.owner.userStorageScopeKey, environmentKey: f.owner.environmentKey, schema: 1 }, null, 2);
  await writeFile(f.ownerPath, formatted);
  const before = await lstat(f.ownerPath);
  await publishRuntimeRootOwner(f.storageDir, f.owner);
  assert.equal(await readFile(f.ownerPath, 'utf8'), formatted);
  assert.equal((await lstat(f.ownerPath)).ino, before.ino);
  assert.deepEqual(await readRuntimeRootOwner(f.storageDir, profile), f.owner);
  assert.equal(await readFile(registry, 'utf8'), 'retained registry');
  assert.equal(await readFile(journal, 'utf8'), 'retained journal');
  assert.deepEqual((await readdir(f.base)).sort(), ['owner.json', 'runtime-supervisor', 'startup-preparation']);

  for (const changes of [{ environmentKey: 'b'.repeat(64) }, { userStorageScopeKey: 'b'.repeat(64) }]) {
    const wrong = await fixture(changes);
    await assert.rejects(prepareRuntimeRootOwnerDirectories(wrong.storageDir, wrong.owner), /environment and user/);
    assert.deepEqual(await readdir(wrong.globalStoragePath), []);
  }
  const unknown = await fixture();
  probeError = new Error('Unknown environment');
  await assert.rejects(prepareRuntimeRootOwnerDirectories(unknown.storageDir, unknown.owner), /Unknown environment/);
  probeError = undefined;
  assert.deepEqual(await readdir(unknown.globalStoragePath), []);
  await assert.rejects(prepareRuntimeRootOwnerDirectories(path.join(directory, 'wrong', 'runtime-supervisor'), f.owner), /does not match/);

  for (const contents of ['{invalid', 'x'.repeat(16 * 1024 + 1), JSON.stringify({ ...f.owner, schema: 2 }),
    JSON.stringify({ ...f.owner, root: { ...f.owner.root, normalizedPath: path.join(directory, 'other-root') } })]) {
    const bad = await fixture();
    await prepareRuntimeRootOwnerDirectories(bad.storageDir, bad.owner);
    await writeFile(bad.ownerPath, contents, { mode: 0o600 });
    await assert.rejects(publishRuntimeRootOwner(bad.storageDir, bad.owner));
    assert.equal(await readFile(bad.ownerPath, 'utf8'), contents);
  }
  const failed = await fixture();
  failRename = true;
  await assert.rejects(publishRuntimeRootOwner(failed.storageDir, failed.owner), /Injected publication failure/);
  failRename = false;
  await assert.rejects(readFile(failed.ownerPath), { code: 'ENOENT' });
  assert.deepEqual((await readdir(failed.base)).sort(), ['runtime-supervisor', 'startup-preparation']);

  for (let index = 0; index < f.createdDirectories.length; index++) {
    const redirected = await fixture();
    await prepareRuntimeRootOwnerDirectories(redirected.storageDir, redirected.owner);
    const target = redirected.createdDirectories[index];
    await rm(target, { recursive: true });
    const external = path.join(directory, `external-${index}`);
    await mkdir(external, { mode: 0o700 });
    await writeFile(path.join(external, 'retained'), 'unrelated');
    await symlink(external, target, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(prepareRuntimeRootOwnerDirectories(redirected.storageDir, redirected.owner), /symlink/);
    assert.deepEqual(await readdir(external), ['retained']);
    if (process.platform !== 'win32') {
      const unsafe = await fixture();
      await prepareRuntimeRootOwnerDirectories(unsafe.storageDir, unsafe.owner);
      await chmod(unsafe.createdDirectories[index], 0o755);
      await assert.rejects(prepareRuntimeRootOwnerDirectories(unsafe.storageDir, unsafe.owner), /private/);
      assert.equal((await lstat(unsafe.createdDirectories[index])).mode & 0o777, 0o755);
    }
  }
  const notDirectory = await fixture();
  await writeFile(notDirectory.createdDirectories[0], 'unrelated file');
  await assert.rejects(prepareRuntimeRootOwnerDirectories(notDirectory.storageDir, notDirectory.owner), /file type/);
  assert.equal(await readFile(notDirectory.createdDirectories[0], 'utf8'), 'unrelated file');
  const hardLinked = await fixture();
  await prepareRuntimeRootOwnerDirectories(hardLinked.storageDir, hardLinked.owner);
  const source = path.join(directory, 'hard-link-source');
  await writeFile(source, JSON.stringify(hardLinked.owner), { mode: 0o600 });
  await link(source, hardLinked.ownerPath);
  await assert.rejects(publishRuntimeRootOwner(hardLinked.storageDir, hardLinked.owner), /regular private/);
  assert.equal(await readFile(source, 'utf8'), JSON.stringify(hardLinked.owner));
  if (process.platform !== 'win32') {
    const unsafeOwner = await fixture();
    await publishRuntimeRootOwner(unsafeOwner.storageDir, unsafeOwner.owner);
    await chmod(unsafeOwner.ownerPath, 0o644);
    await assert.rejects(publishRuntimeRootOwner(unsafeOwner.storageDir, unsafeOwner.owner), /private/);
    assert.equal((await lstat(unsafeOwner.ownerPath)).mode & 0o777, 0o644);
    await rm(unsafeOwner.ownerPath);
    await symlink(source, unsafeOwner.ownerPath);
    await assert.rejects(publishRuntimeRootOwner(unsafeOwner.storageDir, unsafeOwner.owner), /regular private/);
    for (const target of [f.globalStoragePath, ...f.createdDirectories]) {
      foreignUidPath = target;
      await assert.rejects(prepareRuntimeRootOwnerDirectories(f.storageDir, f.owner), /current OS user/);
    }
    foreignUidPath = undefined;
    const sharedGlobal = await fixture();
    await chmod(sharedGlobal.globalStoragePath, 0o777);
    await assert.rejects(prepareRuntimeRootOwnerDirectories(sharedGlobal.storageDir, sharedGlobal.owner), /not writable/);
    assert.deepEqual(await readdir(sharedGlobal.globalStoragePath), []);
    await chmod(sharedGlobal.globalStoragePath, 0o700);
  }
  console.log('runtime root owner storage tests passed (real private files; controlled execution identity).');
} finally {
  await rm(directory, { recursive: true, force: true });
}
