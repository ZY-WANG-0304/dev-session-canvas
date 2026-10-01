import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { readCandidateAssets as readLinux, importCandidateAssets as importLinux } from './linux-execution-candidate-assets.mjs';
import { readCandidateAssets as readMacos, importCandidateAssets as importMacos } from './macos-execution-candidate-assets.mjs';
import { readCandidateAssets as readWindows, importCandidateAssets as importWindows } from './windows-execution-candidate-assets.mjs';

const platforms = [
  { platform: 'linux', profile: 'linux-owner-v1-candidate', suffix: '-glibc', read: readLinux, import: importLinux },
  { platform: 'darwin', profile: 'macos-owner-v1-candidate', suffix: '', read: readMacos, import: importMacos },
  { platform: 'win32', profile: 'windows-owner-v1-candidate', suffix: '', read: readWindows, import: importWindows }
];
const targets = platforms.flatMap(platform => ['x64', 'arm64'].map(arch => ({ ...platform, arch,
  name: `${platform.platform}-${arch}${platform.suffix}` })));

export function readExecutionCandidateAssetSet(source) {
  assert(source, 'Specify the execution asset set directory');
  const directory = path.resolve(source);
  assert.equal(fs.realpathSync(directory), directory, 'Execution asset set sources must not use symlink aliases');
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  assert.deepEqual(entries.map(entry => entry.name).sort(), targets.map(target => target.name).sort(),
    'Execution asset set must contain exactly the six named target directories');
  assert(entries.every(entry => entry.isDirectory()), 'Execution asset set targets must be real directories, not symlink aliases');
  const assets = targets.map(target => {
    const candidateDirectory = path.join(directory, target.name);
    const { manifest } = target.read(candidateDirectory);
    assert.equal(manifest.platform, target.platform, `Execution asset target platform mismatch: ${target.name}`);
    assert.equal(manifest.arch, target.arch, `Execution asset target architecture mismatch: ${target.name}`);
    assert.equal(manifest.profile, target.profile, `Execution asset target profile mismatch: ${target.name}`);
    // Leaf checks in platform readers do not detect redirected parent directories such as conpty/.
    for (const asset of [manifest.binary, manifest.helper, ...(manifest.dependencies ?? [])].filter(Boolean)) {
      const file = path.join(candidateDirectory, asset.file);
      assert.equal(fs.realpathSync(file), file, 'Execution asset files must not use symlink aliases');
    }
    return Object.freeze({ name: target.name, directory: candidateDirectory,
      profile: target.profile, platform: target.platform, arch: target.arch });
  });
  return Object.freeze({ directory, assets: Object.freeze(assets) });
}

export function importExecutionCandidateAssetSet({ source, dist }) {
  // Validate the entire set before any target is imported.
  const { assets } = readExecutionCandidateAssetSet(source);
  return assets.map((asset, index) => targets[index].import({ source: asset.directory, dist }));
}
