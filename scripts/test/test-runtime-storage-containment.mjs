import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import containment from '../../tests/vscode-smoke/runtime-storage-containment.cjs';

const { strictChild, assertRuntimeStorageContained } = containment;

test('strict child uses platform relative paths and accepts Windows drive case aliases', () => {
  const root = 'D:\\agent\\user-data';
  const child = 'd:\\agent\\user-data\\User\\storage';
  // This is the exact regression: the former case-sensitive prefix rejects a
  // valid VS Code fsPath whose drive letter was normalized to lowercase.
  assert.equal(child.startsWith(`${root}${path.win32.sep}`), false);
  assert.equal(strictChild(root, child, 'win32'), true);
  assert.equal(strictChild('D:\\agent\\user-data', 'D:\\agent\\user-data\\User\\storage', 'win32'), true);
  assert.equal(strictChild('/agent/user-data', '/agent/user-data/User/storage', 'linux'), true);
  assert.equal(strictChild('/agent/user-data', '/agent/user-data-2', 'linux'), false);
  assert.equal(strictChild('D:\\agent\\user-data', 'D:\\agent\\user-data-2', 'win32'), false);
});

test('strict child rejects root itself, parent, cross-drive, UNC sibling and traversal', () => {
  for (const [root, child, platform] of [
    ['/root/data', '/root/data', 'linux'], ['/root/data', '/root', 'linux'],
    ['D:\\root\\data', 'C:\\root\\data\\child', 'win32'],
    ['\\\\server\\share\\data', '\\\\server\\other\\data\\child', 'win32'],
    ['/root/data', '/root/data/../secret', 'linux'],
    ['D:\\root\\data', 'D:\\root\\data\\..\\secret', 'win32']
  ]) assert.equal(strictChild(root, child, platform), false, `${root} -> ${child}`);
});

test('realpath containment rejects symlink escape and accepts a real child', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsc-storage-root-'));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'dsc-storage-outside-'));
  try {
    await fs.mkdir(path.join(root, 'runtime'));
    await fs.mkdir(path.join(outside, 'runtime'));
    await fs.symlink(outside, path.join(root, 'escape'), 'dir');
    await assert.rejects(assertRuntimeStorageContained(path.join(root, 'escape', 'runtime'), [root], 'linux'),
      /must belong/);
    const result = await assertRuntimeStorageContained(path.join(root, 'runtime'), [root], 'linux');
    assert.equal(result.realRoot, await fs.realpath(root));
    assert.equal(result.realChild, await fs.realpath(path.join(root, 'runtime')));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  }
});

test('realpath errors do not silently pass containment', async () => {
  await assert.rejects(assertRuntimeStorageContained('/missing/root/storage', ['/missing/root'], 'linux', async value => {
    throw Object.assign(new Error(`missing ${value}`), { code: 'ENOENT' });
  }), /missing/);
});
