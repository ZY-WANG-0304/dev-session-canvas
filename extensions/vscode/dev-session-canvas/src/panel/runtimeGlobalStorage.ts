import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export class RuntimeGlobalStorageError extends Error {
  constructor(readonly reason: 'unsafe' | 'changed' | 'unavailable') {
    super(`Runtime global storage preparation failed: ${reason}.`);
  }
}

// Only ExtensionContext.globalStorageUri may be passed here. This never repairs
// runtime namespaces or their contents; their independent strict checks remain.
export async function prepareRuntimeGlobalStorage(directory: string): Promise<string> {
  let handle: fs.FileHandle | undefined;
  try {
    if (!path.isAbsolute(directory) || directory.includes('\0')) throw new RuntimeGlobalStorageError('unsafe');
    directory = path.resolve(directory);
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const before = await fs.lstat(directory);
    if (!before.isDirectory() || before.isSymbolicLink()) throw new RuntimeGlobalStorageError('unsafe');
    const canonical = await fs.realpath(directory);
    if (process.platform === 'win32') return canonical;
    const uid = process.getuid?.();
    const mode = before.mode & 0o7777;
    if (uid === undefined || before.uid !== uid || (mode & 0o7000) !== 0 || (mode & 0o700) !== 0o700 ||
        ((mode & 0o022) !== 0 && mode !== 0o770 && mode !== 0o775)) {
      throw new RuntimeGlobalStorageError('unsafe');
    }
    handle = await fs.open(canonical, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    const sameDirectory = (stat: Awaited<ReturnType<typeof fs.lstat>>): boolean =>
      stat.isDirectory() && stat.dev === before.dev && stat.ino === before.ino && stat.uid === uid;
    const opened = await handle.stat();
    const expectedMode = mode & ~0o020;
    if (!sameDirectory(opened) || ![mode, expectedMode].includes(opened.mode & 0o7777) ||
        !sameDirectory(await fs.lstat(directory)) || await fs.realpath(directory) !== canonical) {
      throw new RuntimeGlobalStorageError('changed');
    }
    // Historical ordinary mkdir under umask 0002/0007 produced 0775/0770.
    // Remove only group write, on the validated original directory descriptor.
    if ((opened.mode & 0o7777) !== expectedMode) await handle.chmod(expectedMode);
    const after = await fs.lstat(directory);
    if (!sameDirectory(after) || (after.mode & 0o7777) !== expectedMode ||
        !sameDirectory(await fs.lstat(canonical)) || await fs.realpath(directory) !== canonical) {
      throw new RuntimeGlobalStorageError('changed');
    }
    return path.resolve(canonical);
  } catch (error) {
    if (error instanceof RuntimeGlobalStorageError) throw error;
    throw new RuntimeGlobalStorageError('unavailable');
  } finally {
    try { await handle?.close(); }
    catch { throw new RuntimeGlobalStorageError('unavailable'); }
  }
}
