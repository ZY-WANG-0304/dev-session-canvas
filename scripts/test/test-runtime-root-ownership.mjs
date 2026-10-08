import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import esbuild from 'esbuild';

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'dsc-runtime-root-ownership-'));
try {
  const outfile = path.join(tempDir, 'runtimeRootOwnership.cjs');
  await esbuild.build({
    entryPoints: [path.resolve('extensions/vscode/dev-session-canvas/src/common/runtimeRootOwnership.ts')],
    bundle: true, format: 'cjs', outfile, platform: 'node', target: 'node18'
  });
  const require = createRequire(import.meta.url);
  const {
    createRuntimeOwnerDescriptor,
    parseRuntimeOwnerDescriptor,
    assertRuntimeOwnerDescriptor,
    isRuntimeOwnerDescriptor,
    runtimeOwnerDescriptorsEqual,
    createRuntimeUserStorageScopeKey,
    resolveRootRuntimeSupervisorGeneration,
    resolveRuntimeRootOwnerBaseStoragePath,
    resolveRuntimeRootOwnerGlobalStoragePath,
    createRuntimeOwnerCompatibilityFingerprint
  } = require(outfile);
  const environmentKey = 'a'.repeat(64);
  const cases = [
    ['linux', 'linux-owner-v1-candidate', '/private/user/global', '/projects/alpha/../root ', '/projects/root '],
    ['darwin', 'macos-owner-v1-candidate', '/Users/test/global', '/Projects/Root', '/Projects/Root'],
    ['win32', 'windows-owner-v1-candidate', 'C:\\Users\\Test\\Global', 'D:/Projects/Alpha/../ROOT ', 'd:\\projects\\root '],
    ['win32', 'windows-owner-v1-candidate', '\\\\Server\\User\\Global', '\\\\Server\\Share\\Projects\\ROOT', '\\\\server\\share\\projects\\root']
  ];
  for (const [platform, profile, globalStorage, rootPath, normalizedPath] of cases) {
    const paths = platform === 'win32' ? path.win32 : path.posix;
    const generation = resolveRootRuntimeSupervisorGeneration(profile);
    const scope = createRuntimeUserStorageScopeKey('user:1000', globalStorage, platform);
    const input = { environmentKey, userStorageScopeKey: scope, rootPath, generation, platform };
    const descriptor = createRuntimeOwnerDescriptor(input);
    assert.equal(descriptor.root.normalizedPath, normalizedPath);
    assert.equal(isRuntimeOwnerDescriptor(descriptor), true);
    assert.deepEqual(parseRuntimeOwnerDescriptor(descriptor), descriptor);
    assert.notEqual(parseRuntimeOwnerDescriptor(descriptor).root, descriptor.root);
    assert.doesNotThrow(() => assertRuntimeOwnerDescriptor(descriptor));
    const reordered = {
      generation, root: { normalizedPath, pathPolicy: 'canvas-path-v1', kind: 'folder' },
      userStorageScopeKey: scope, environmentKey, schema: 1
    };
    assert.equal(runtimeOwnerDescriptorsEqual(reordered, descriptor), true);
    const base = resolveRuntimeRootOwnerBaseStoragePath(globalStorage, descriptor, platform);
    assert.equal(resolveRuntimeRootOwnerBaseStoragePath(globalStorage, reordered, platform), base);
    const rootKey = createHash('sha256')
      .update(JSON.stringify(['runtime-root-v1', 'folder', 'canvas-path-v1', normalizedPath])).digest('hex');
    const normalizedGlobal = platform === 'win32' ? paths.resolve(globalStorage).toLowerCase() : paths.resolve(globalStorage);
    assert.equal(base, paths.join(normalizedGlobal, 'runtime-roots-v1', environmentKey, rootKey,
      'runtime-supervisor-generations', generation));
    const storageDir = paths.join(base, 'runtime-supervisor');
    assert.equal(resolveRuntimeRootOwnerGlobalStoragePath(storageDir, descriptor, platform), normalizedGlobal);
    assert.throws(() => resolveRuntimeRootOwnerGlobalStoragePath(base, descriptor, platform), /does not match/);
    for (const otherRoot of [paths.join(rootPath, 'nested'), paths.join(rootPath, '..', 'worktree'),
      paths.join(rootPath, '..', 'same-name'), paths.join(rootPath, '..', 'symlink-alias')]) {
      const other = createRuntimeOwnerDescriptor({ ...input, rootPath: otherRoot });
      assert.equal(runtimeOwnerDescriptorsEqual(descriptor, other), false);
      assert.notEqual(resolveRuntimeRootOwnerBaseStoragePath(globalStorage, other, platform), base);
      assert.throws(() => resolveRuntimeRootOwnerGlobalStoragePath(storageDir, other, platform), /does not match/);
    }
    const otherEnvironment = createRuntimeOwnerDescriptor({ ...input, environmentKey: 'b'.repeat(64) });
    assert.notEqual(resolveRuntimeRootOwnerBaseStoragePath(globalStorage, otherEnvironment, platform), base);
    assert.notEqual(createRuntimeUserStorageScopeKey('user:1001', globalStorage, platform), scope);
    const otherGlobal = paths.join(globalStorage, '..', 'another-profile');
    assert.notEqual(createRuntimeUserStorageScopeKey('user:1000', otherGlobal, platform), scope);
    const otherUser = createRuntimeOwnerDescriptor({ ...input, userStorageScopeKey: 'c'.repeat(64) });
    assert.equal(runtimeOwnerDescriptorsEqual(descriptor, otherUser), false);
    assert.equal(createRuntimeUserStorageScopeKey('user:1000', paths.join(globalStorage, 'temporary', '..'), platform), scope);
    assert.equal(createRuntimeOwnerCompatibilityFingerprint(generation, profile),
      createRuntimeOwnerCompatibilityFingerprint(generation, profile, { pending: 2, starting: 1, executions: null }));
    assert.notEqual(createRuntimeOwnerCompatibilityFingerprint(generation, profile),
      createRuntimeOwnerCompatibilityFingerprint(generation, profile, { executions: 2, starting: 1 }));
    assert.throws(() => createRuntimeOwnerCompatibilityFingerprint(generation, profile, { executions: 0, starting: 1 }));
    if (platform === 'win32') {
      assert.equal(createRuntimeUserStorageScopeKey('user:1000', globalStorage.toUpperCase(), platform), scope);
      assert.deepEqual(createRuntimeOwnerDescriptor({ ...input, rootPath: rootPath.toLowerCase() }), descriptor);
    } else {
      assert.notEqual(createRuntimeUserStorageScopeKey('user:1000', globalStorage.toUpperCase(), platform), scope);
      assert.equal(runtimeOwnerDescriptorsEqual(descriptor,
        createRuntimeOwnerDescriptor({ ...input, rootPath: rootPath.toLowerCase() })), rootPath === rootPath.toLowerCase());
    }
  }
  const validInput = {
    environmentKey, userStorageScopeKey: 'b'.repeat(64), rootPath: '/projects/root ',
    generation: 'terminal-root-owner-linux-v1', platform: 'linux'
  };
  const valid = createRuntimeOwnerDescriptor(validInput);
  assert.notEqual(resolveRuntimeRootOwnerBaseStoragePath('/global', valid, 'linux'),
    resolveRuntimeRootOwnerBaseStoragePath('/global', createRuntimeOwnerDescriptor({ ...validInput, rootPath: '/projects/root' }), 'linux'));
  const invalidDescriptors = [null, [], {}, { ...valid, schema: 2 }, { ...valid, future: true },
    { ...valid, environmentKey: '' }, { ...valid, environmentKey: 'local' }, { ...valid, environmentKey: 'A'.repeat(64) },
    { ...valid, userStorageScopeKey: '../escape' }, { ...valid, generation: 'terminal-root-owner-linux-v2' },
    { ...valid, generation: 'terminal-current-state-linux-v1' }, { ...valid, root: { ...valid.root, kind: 'workspace-slot' } },
    { ...valid, root: { ...valid.root, pathPolicy: 'realpath-v1' } }, { ...valid, root: { ...valid.root, future: true } },
    { ...valid, root: { ...valid.root, normalizedPath: '/projects/../root' } },
    { ...valid, root: { ...valid.root, normalizedPath: 'relative/root' } },
    { ...valid, root: { ...valid.root, normalizedPath: '/projects/\0root' } },
    Object.assign(Object.create({ inherited: true }), valid), { ...valid, [Symbol('extra')]: true },
    Object.defineProperty({ ...valid }, 'environmentKey', { get() { throw new Error('Must not invoke getters.'); } })];
  for (const invalid of invalidDescriptors) {
    assert.equal(isRuntimeOwnerDescriptor(invalid), false);
    assert.equal(runtimeOwnerDescriptorsEqual(invalid, valid), false);
    assert.equal(runtimeOwnerDescriptorsEqual(valid, invalid), false);
    assert.throws(() => parseRuntimeOwnerDescriptor(invalid));
  }
  for (const rootPath of ['', 'relative/root', 'file:///projects/root', '/projects/\0root']) {
    assert.throws(() => createRuntimeOwnerDescriptor({ ...validInput, rootPath }), /absolute filesystem path/);
  }
  for (const rootPath of ['C:relative', '\\root', '//server']) {
    assert.throws(() => createRuntimeOwnerDescriptor({ ...validInput, platform: 'win32',
      generation: 'terminal-root-owner-windows-v1', rootPath }), /absolute filesystem path/);
  }
  for (const userIdentity of ['', ' ', '\0', undefined]) {
    assert.throws(() => createRuntimeUserStorageScopeKey(userIdentity, '/global', 'linux'), /known OS user/);
  }
  assert.throws(() => createRuntimeUserStorageScopeKey('user:1000', 'relative/global', 'linux'), /absolute/);
  assert.throws(() => createRuntimeUserStorageScopeKey('user:1000', '/global', 'freebsd'), /Unsupported/);
  assert.throws(() => createRuntimeOwnerDescriptor({ ...validInput, platform: 'darwin' }), /platform/);
  assert.throws(() => resolveRuntimeRootOwnerBaseStoragePath('/global', valid, 'darwin'), /platform/);
  assert.throws(() => createRuntimeOwnerCompatibilityFingerprint(valid.generation, 'macos-owner-v1-candidate'), /profile/);
  assert.throws(() => resolveRootRuntimeSupervisorGeneration('future-profile'), /Unsupported/);
  console.log('runtimeRootOwnership tests passed');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
