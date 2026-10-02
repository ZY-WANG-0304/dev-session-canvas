const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

function pathModule(platform = process.platform) {
  return platform === 'win32' ? path.win32 : path.posix;
}

function strictChild(root, child, platform = process.platform) {
  const module = pathModule(platform);
  const relative = module.relative(module.resolve(root), module.resolve(child));
  return relative.length > 0 && relative !== '..' && !relative.startsWith(`..${module.sep}`) &&
    !module.isAbsolute(relative);
}

async function assertRuntimeStorageContained(runtimeStoragePath, permittedRoots, platform = process.platform,
  realpath = value => fs.realpath(value)) {
  assert(typeof runtimeStoragePath === 'string' && runtimeStoragePath.length > 0);
  assert(Array.isArray(permittedRoots) && permittedRoots.length > 0);
  const module = pathModule(platform);
  for (const root of permittedRoots) {
    if (!strictChild(root, runtimeStoragePath, platform)) continue;
    const [realRoot, realChild] = await Promise.all([realpath(root), realpath(runtimeStoragePath)]);
    if (strictChild(realRoot, realChild, platform)) return { root, realRoot, realChild };
  }
  throw new Error('Supervisor storage must belong to this isolated test.');
}

module.exports = { strictChild, assertRuntimeStorageContained };
