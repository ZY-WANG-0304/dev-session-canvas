import assert from 'node:assert/strict';
import { chmod, link, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import esbuild from 'esbuild';

const require = createRequire(import.meta.url);
const temp = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dsc-root-startup-')));
const profile = ({ linux: 'linux-owner-v1-candidate', darwin: 'macos-owner-v1-candidate',
  win32: 'windows-owner-v1-candidate' })[process.platform];
assert.ok(profile);
let fixtureId = 0;
let failRename = false;
try {
  const { outputFiles } = await esbuild.build({
    stdin: { contents: `
      export * from './extensions/vscode/dev-session-canvas/src/supervisor/runtimeRootStartup';
      export * from './extensions/vscode/dev-session-canvas/src/common/runtimeRootOwnership';
    `, resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, platform: 'node', format: 'cjs', write: false
  });
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', outputFiles[0].text)(name => {
    if (name === 'fs/promises') return { ...require(name), async rename(from, to) {
      if (failRename && path.basename(to) === 'startup-started.json') throw new Error('Injected rename failure');
      return require(name).rename(from, to);
    } };
    return require(name);
  }, loaded, loaded.exports);
  const { createRuntimeOwnerDescriptor, createRuntimeUserStorageScopeKey, resolveRootRuntimeSupervisorGeneration,
    resolveRuntimeRootOwnerBaseStoragePath, createRuntimeOwnerCompatibilityFingerprint,
    createRuntimeRootStartupIntent, readRuntimeRootStartupIntent, assertRuntimeRootStartupIntentMatches,
    writeRuntimeRootStartupIntent, writeRuntimeRootStartupStarted, inspectRuntimeRootStartup } = loaded.exports;

  async function fixture() {
    const globalStorage = path.join(temp, `global-${++fixtureId}`);
    const owner = createRuntimeOwnerDescriptor({ environmentKey: 'a'.repeat(64),
      userStorageScopeKey: createRuntimeUserStorageScopeKey('uid:fixture', globalStorage),
      rootPath: path.join(temp, 'project'), generation: resolveRootRuntimeSupervisorGeneration(profile) });
    const base = resolveRuntimeRootOwnerBaseStoragePath(globalStorage, owner);
    const storage = path.join(base, 'runtime-supervisor');
    await mkdir(storage, { recursive: true, mode: 0o700 });
    const intent = createRuntimeRootStartupIntent(owner, 'legacy-detached',
      createRuntimeOwnerCompatibilityFingerprint(owner.generation, profile));
    return { owner, base, storage, intent, intentPath: path.join(base, 'startup-intent.json'),
      startedPath: path.join(base, 'startup-started.json') };
  }
  async function put(filename, value) {
    await writeFile(filename, typeof value === 'string' ? value : JSON.stringify(value), { mode: 0o600 });
  }

  const f = await fixture();
  const ownerPath = path.join(f.base, 'owner.json');
  const registryPath = path.join(f.storage, 'registry.json');
  await put(ownerPath, 'retained owner');
  await put(registryPath, 'retained registry');
  assert.deepEqual(await inspectRuntimeRootStartup(f.storage, f.owner), { kind: 'fresh' });
  assert.equal(await readRuntimeRootStartupIntent(f.storage, f.owner), undefined);
  assert.match(f.intent.token, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.notEqual(createRuntimeRootStartupIntent(f.owner, f.intent.backend, f.intent.compatibilityFingerprint).token, f.intent.token);
  await writeRuntimeRootStartupIntent(f.storage, f.intent);
  assert.deepEqual(await readRuntimeRootStartupIntent(f.storage, f.owner), f.intent);
  assert.deepEqual(await inspectRuntimeRootStartup(f.storage, f.owner), { kind: 'unknown', reason: 'missing-started' });
  assert.doesNotThrow(() => assertRuntimeRootStartupIntentMatches(f.intent, f.intent));
  for (const changed of [
    { token: createRuntimeRootStartupIntent(f.owner, f.intent.backend, f.intent.compatibilityFingerprint).token },
    { backend: 'systemd-user' }, { compatibilityFingerprint: 'b'.repeat(64) },
    { owner: { ...f.owner, environmentKey: 'b'.repeat(64) } }
  ]) assert.throws(() => assertRuntimeRootStartupIntentMatches(f.intent, { ...f.intent, ...changed }), /does not match/);
  await assert.rejects(writeRuntimeRootStartupIntent(f.storage,
    createRuntimeRootStartupIntent(f.owner, f.intent.backend, f.intent.compatibilityFingerprint)), /unknown launch/);
  assert.equal(await readFile(f.intentPath, 'utf8'), JSON.stringify(f.intent));

  await writeRuntimeRootStartupStarted(f.storage, f.intent);
  assert.deepEqual(JSON.parse(await readFile(f.startedPath, 'utf8')), { ...f.intent, state: 'started' });
  assert.deepEqual(await inspectRuntimeRootStartup(f.storage, f.owner), { kind: 'previous-started', intent: f.intent });
  await assert.rejects(writeRuntimeRootStartupStarted(f.storage, f.intent), /already been consumed/);
  await assert.rejects(writeRuntimeRootStartupIntent(f.storage, f.intent), /reuse/);
  const next = createRuntimeRootStartupIntent(f.owner, f.intent.backend, f.intent.compatibilityFingerprint);
  // The file module does not claim a lock; production callers must separately prove the old authority exited.
  await writeRuntimeRootStartupIntent(f.storage, next);
  assert.deepEqual(await inspectRuntimeRootStartup(f.storage, f.owner), { kind: 'unknown', reason: 'mismatched-started' });
  await assert.rejects(writeRuntimeRootStartupStarted(f.storage, f.intent), /does not match/);
  const previousReceipt = await readFile(f.startedPath, 'utf8');
  failRename = true;
  await assert.rejects(writeRuntimeRootStartupStarted(f.storage, next), /Injected rename failure/);
  failRename = false;
  assert.equal(await readFile(f.startedPath, 'utf8'), previousReceipt);
  assert.equal((await readdir(f.base)).some(name => name.endsWith('.tmp')), false);
  await writeRuntimeRootStartupStarted(f.storage, next);
  assert.deepEqual(await inspectRuntimeRootStartup(f.storage, f.owner), { kind: 'previous-started', intent: next });
  assert.equal(await readFile(ownerPath, 'utf8'), 'retained owner');
  assert.equal(await readFile(registryPath, 'utf8'), 'retained registry');
  assert.deepEqual((await readdir(f.base)).sort(), ['owner.json', 'runtime-supervisor', 'startup-intent.json', 'startup-started.json']);
  if (process.platform !== 'win32') {
    assert.equal((await stat(f.intentPath)).mode & 0o7777, 0o600);
    assert.equal((await stat(f.startedPath)).mode & 0o7777, 0o600);
  }

  for (const change of [
    { schema: 2 }, { token: 'not-a-token' }, { token: '00000000-0000-0000-0000-000000000000' },
    { backend: 'future-backend' }, { compatibilityFingerprint: 'unknown' }, { extra: 'unsupported' },
    { owner: { ...f.owner, schema: 2 } }
  ]) {
    const bad = await fixture();
    await put(bad.intentPath, { ...bad.intent, ...change });
    await assert.rejects(readRuntimeRootStartupIntent(bad.storage, bad.owner));
    assert.deepEqual(await inspectRuntimeRootStartup(bad.storage, bad.owner), { kind: 'unknown', reason: 'invalid-record' });
    await assert.rejects(writeRuntimeRootStartupStarted(bad.storage, bad.intent));
  }
  for (const contents of ['{invalid', 'x'.repeat(16 * 1024 + 1)]) {
    const bad = await fixture();
    await put(bad.intentPath, contents);
    await assert.rejects(readRuntimeRootStartupIntent(bad.storage, bad.owner));
    await assert.rejects(writeRuntimeRootStartupIntent(bad.storage, bad.intent));
    assert.equal(await readFile(bad.intentPath, 'utf8'), contents);
  }
  const orphan = await fixture();
  await put(orphan.startedPath, { ...orphan.intent, state: 'started' });
  assert.deepEqual(await inspectRuntimeRootStartup(orphan.storage, orphan.owner), { kind: 'unknown', reason: 'orphan-started' });
  await assert.rejects(writeRuntimeRootStartupIntent(orphan.storage, orphan.intent), /unknown/);
  await assert.rejects(writeRuntimeRootStartupStarted(orphan.storage, orphan.intent), /Invalid/);
  const wrongReceipt = await fixture();
  await writeRuntimeRootStartupIntent(wrongReceipt.storage, wrongReceipt.intent);
  await put(wrongReceipt.startedPath, { ...wrongReceipt.intent, state: 'ready' });
  assert.deepEqual(await inspectRuntimeRootStartup(wrongReceipt.storage, wrongReceipt.owner), { kind: 'unknown', reason: 'invalid-record' });
  await assert.rejects(writeRuntimeRootStartupStarted(wrongReceipt.storage, wrongReceipt.intent), /Invalid/);
  assert.equal(JSON.parse(await readFile(wrongReceipt.startedPath, 'utf8')).state, 'ready');
  await put(wrongReceipt.startedPath, { ...wrongReceipt.intent, token: f.intent.token, state: 'started',
    owner: { ...wrongReceipt.owner, userStorageScopeKey: 'c'.repeat(64) } });
  await assert.rejects(writeRuntimeRootStartupStarted(wrongReceipt.storage, wrongReceipt.intent), /another owner/);

  const linked = await fixture();
  const source = path.join(temp, 'linked-record');
  await put(source, linked.intent);
  await link(source, linked.intentPath);
  await assert.rejects(readRuntimeRootStartupIntent(linked.storage, linked.owner), /regular private/);
  await assert.rejects(writeRuntimeRootStartupIntent(linked.storage, linked.intent));
  assert.equal(await readFile(source, 'utf8'), JSON.stringify(linked.intent));
  const wrongOwner = { ...f.owner, userStorageScopeKey: 'b'.repeat(64) };
  await assert.rejects(readRuntimeRootStartupIntent(f.storage, wrongOwner), /another owner/);
  await assert.rejects(readRuntimeRootStartupIntent(path.join(temp, 'other', 'runtime-supervisor'), f.owner), /does not match/);
  if (process.platform !== 'win32') {
    for (const target of ['base', 'intentPath', 'startedPath']) {
      const bad = await fixture();
      await writeRuntimeRootStartupIntent(bad.storage, bad.intent);
      await writeRuntimeRootStartupStarted(bad.storage, bad.intent);
      await chmod(bad[target], target === 'base' ? 0o755 : 0o644);
      assert.deepEqual(await inspectRuntimeRootStartup(bad.storage, bad.owner), { kind: 'unknown', reason: 'invalid-record' });
      await assert.rejects(writeRuntimeRootStartupIntent(bad.storage,
        createRuntimeRootStartupIntent(bad.owner, bad.intent.backend, bad.intent.compatibilityFingerprint)));
      await chmod(bad[target], target === 'base' ? 0o700 : 0o600);
    }
    const redirected = await fixture();
    await symlink(source, redirected.intentPath);
    await assert.rejects(readRuntimeRootStartupIntent(redirected.storage, redirected.owner), /regular private/);
    await assert.rejects(writeRuntimeRootStartupIntent(redirected.storage, redirected.intent));
    const originalBase = `${redirected.base}-original`;
    await require('node:fs/promises').rename(redirected.base, originalBase);
    await symlink(originalBase, redirected.base, 'dir');
    await assert.rejects(readRuntimeRootStartupIntent(redirected.storage, redirected.owner), /canonical/);
  }
  console.log('runtimeRootStartup tests passed (bounded private files; lock probing and startup are not simulated).');
} finally {
  await rm(temp, { recursive: true, force: true });
}
