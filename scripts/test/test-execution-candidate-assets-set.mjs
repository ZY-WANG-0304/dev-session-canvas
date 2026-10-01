import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveExecutionBuildSelection } from '../build/build.mjs';
import { importExecutionCandidateAssetSet, readExecutionCandidateAssetSet } from '../build/execution-candidate-assets-set.mjs';
import { writeExecutionAssetSet } from './fixtures/execution-candidate-assets-set.mjs';

const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dsc-execution-asset-set-')));
const dist = path.join(temporary, 'dist');
fs.mkdirSync(dist);
fs.writeFileSync(path.join(dist, 'retained.txt'), 'unchanged');
const setArgs = source => [`--execution-assets-set=${source}`];
const directoryLink = process.platform === 'win32' ? 'junction' : 'dir';
let fixtureId = 0;
function fixture() {
  const directory = path.join(temporary, `set-${++fixtureId}`);
  return { directory, targets: writeExecutionAssetSet(directory) };
}
let passed = 0;
const test = async (name, run) => {
  await run();
  assert.equal(fs.readFileSync(path.join(dist, 'retained.txt'), 'utf8'), 'unchanged');
  passed++;
  console.log(`PASS ${name}`);
};

try {
  await test('six named targets validate together before returning a frozen platform build selection', async () => {
    const { directory, targets } = fixture();
    const assets = readExecutionCandidateAssetSet(directory);
    assert.equal(assets.assets.length, 6);
    assert.ok(Object.isFrozen(assets));
    assert.ok(Object.isFrozen(assets.assets));
    for (const [index, asset] of assets.assets.entries()) {
      assert.ok(Object.isFrozen(asset));
      assert.equal(asset.name, targets[index].name);
      assert.equal(asset.profile, targets[index].manifest.profile);
      assert.equal(asset.arch, targets[index].manifest.arch);
    }
    for (const [args, admissionLimits] of [[[], { executions: 2, starting: 1 }],
      [['--production', '--execution-admission=10:2'], { executions: 10, starting: 2 }]]) {
      const selection = await resolveExecutionBuildSelection([...setArgs(directory), ...args], dist);
      assert.deepEqual(selection, { profile: 'platform', source: directory, admissionLimits });
      assert.ok(Object.isFrozen(selection));
      assert.ok(Object.isFrozen(selection.admissionLimits));
    }
  });
  await test('set input excludes single-target flags watch mode and malformed admission', async () => {
    const { directory } = fixture();
    for (const args of [['--execution-profile=linux-owner-v1-candidate'], [`--execution-assets=${directory}`],
      ['--execution-profile=platform'], ['--execution-profile='], ['--execution-assets='], ['--watch'],
      ['--execution-admission=0:1'], ['--execution-admission=1:2']]) {
      await assert.rejects(resolveExecutionBuildSelection([...setArgs(directory), ...args], dist));
    }
    await assert.rejects(resolveExecutionBuildSelection(setArgs(''), dist));
    await assert.rejects(resolveExecutionBuildSelection(setArgs(path.join(temporary, 'missing')), dist));
    await assert.rejects(resolveExecutionBuildSelection(['--execution-profile=platform', `--execution-assets=${directory}`], dist));
  });
  await test('missing extra renamed and nondirectory targets reject the whole set', async () => {
    for (const mutation of ['missing', 'extra', 'renamed', 'file']) {
      const { directory, targets } = fixture();
      if (mutation === 'extra') fs.writeFileSync(path.join(directory, 'manifest.json'), '{}');
      else {
        fs.renameSync(targets[5].directory, `${directory}-${mutation}`);
        if (mutation === 'renamed') fs.mkdirSync(path.join(directory, 'windows-arm64'));
        if (mutation === 'file') fs.writeFileSync(targets[5].directory, '{}');
      }
      await assert.rejects(resolveExecutionBuildSelection(setArgs(directory), dist), /six named|real directories/);
    }
  });
  await test('valid same-platform assets in the wrong architecture slot reject', async () => {
    for (const pair of [0, 2, 4]) {
      const { directory, targets } = fixture();
      fs.renameSync(targets[pair].directory, `${directory}-original`);
      fs.cpSync(targets[pair + 1].directory, targets[pair].directory, { recursive: true });
      await assert.rejects(resolveExecutionBuildSelection(setArgs(directory), dist), /architecture mismatch/);
    }
  });
  await test('every platform byte validator runs and a corrupt sixth target prevents all staging', async () => {
    for (let index = 0; index < 6; index++) {
      const { directory, targets } = fixture();
      fs.appendFileSync(path.join(targets[index].directory, targets[index].manifest.binary.file), 'corrupt');
      await assert.rejects(resolveExecutionBuildSelection(setArgs(directory), dist), /hash/);
      assert.throws(() => importExecutionCandidateAssetSet({ source: directory, dist }), /hash/);
      assert.equal(fs.existsSync(path.join(dist, 'native')), false);
    }
    const { directory, targets } = fixture();
    const altered = { ...targets[5].manifest, platform: 'linux' };
    fs.writeFileSync(path.join(targets[5].directory, 'manifest.json'), JSON.stringify(altered));
    await assert.rejects(resolveExecutionBuildSelection(setArgs(directory), dist));
  });
  await test('set sources inside dist and root target or payload-directory aliases reject', async () => {
    const inside = path.join(dist, 'assets');
    writeExecutionAssetSet(inside);
    await assert.rejects(resolveExecutionBuildSelection(setArgs(inside), dist), /outside/);
    const { directory, targets } = fixture();
    await assert.rejects(resolveExecutionBuildSelection(setArgs(directory), targets[5].directory), /outside/);
    const alias = path.join(temporary, 'set-alias');
    fs.symlinkSync(directory, alias, directoryLink);
    await assert.rejects(resolveExecutionBuildSelection(setArgs(alias), dist), /symlink aliases/);
    fs.renameSync(targets[5].directory, `${directory}-arm64`);
    fs.symlinkSync(`${directory}-arm64`, targets[5].directory, directoryLink);
    await assert.rejects(resolveExecutionBuildSelection(setArgs(directory), dist), /symlink aliases/);
    const payload = fixture();
    const conpty = path.join(payload.targets[5].directory, 'conpty');
    fs.renameSync(conpty, `${payload.directory}-conpty`);
    fs.symlinkSync(`${payload.directory}-conpty`, conpty, directoryLink);
    await assert.rejects(resolveExecutionBuildSelection(setArgs(payload.directory), dist), /symlink aliases/);
  });
  await test('aggregate import stages all six existing platform layouts and only runtime payloads', () => {
    const { directory, targets } = fixture();
    for (const entry of ['linux-execution-provider.js', 'macos-execution-provider.js',
      'windows-execution-provider.js', 'windows-execution-output-worker.js']) {
      fs.writeFileSync(path.join(dist, entry), '/* controlled provider boundary */');
    }
    for (const target of targets) fs.writeFileSync(path.join(target.directory, 'ignored-input.cc'), 'not a runtime asset');
    const imported = importExecutionCandidateAssetSet({ source: directory, dist });
    assert.equal(imported.length, 6);
    for (const [index, asset] of imported.entries()) {
      const expected = targets[index];
      const family = { linux: 'linux', darwin: 'macos', win32: 'windows' }[expected.manifest.platform];
      assert.equal(asset.directory, path.join(dist, 'native', `${family}-execution-candidate`, expected.name));
      assert.deepEqual(asset.manifest, expected.manifest);
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(asset.directory, 'manifest.json'))), expected.manifest);
      assert.equal(fs.existsSync(path.join(asset.directory, 'ignored-input.cc')), false);
      for (const [file, bytes] of expected.files) assert.deepEqual(fs.readFileSync(path.join(asset.directory, file)), bytes);
      if (expected.manifest.helper) assert.ok(fs.statSync(path.join(asset.directory, 'spawn-helper')).mode & 0o111);
    }
  });
  console.log(`Execution asset set: ${passed}/${passed} pure cases passed (synthetic manifests and image headers, no native loads or product build).`);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
