import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

// Run the exact original test. Only its fixed socket directory is mapped to a private fixture.
const require = createRequire(path.join(process.cwd(), 'package.json'));
const esbuild = require('esbuild');
const exec = promisify(execFile);
assert.equal(process.platform, 'linux');
const originalTest = path.resolve('scripts/test/test-smoke-remote-host.mjs');
const helper = path.resolve('tests/vscode-smoke/remote-host-control.cjs');
const realDirectory = `/tmp/dsc-root-${process.getuid()}`;
const temporary = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dsc-rca-socket-pollution-')));
const source = path.resolve('extensions/vscode/dev-session-canvas/src/supervisor/runtimeRootOwner.ts');
const built = await esbuild.build({ stdin: { contents: `
  export { ensureRuntimeRootSocketDirectory } from './extensions/vscode/dev-session-canvas/src/supervisor/runtimeRootOwner';
  export { resolveLegacyRuntimeSupervisorPathsFromStorageDir } from './extensions/vscode/dev-session-canvas/src/common/runtimeSupervisorPaths';
`, loader: 'ts', resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'cjs', write: false });
const results = [];
try {
  for (const initial of ['absent', 'private-0700']) {
    const directory = path.join(temporary, initial);
    if (initial === 'private-0700') await fs.mkdir(directory, { mode: 0o700 });
    const preload = path.join(temporary, `${initial}.cjs`);
    await fs.writeFile(preload, `
      const Module = require('module');
      const actualPath = require('node:path');
      const load = Module._load;
      Module._load = function(name, parent, main) {
        if (name === 'node:path' && parent?.filename === ${JSON.stringify(helper)}) {
          return {...actualPath, join(...parts) {
            const filename = actualPath.join(...parts);
            const original = ${JSON.stringify(realDirectory)};
            return filename === original || filename.startsWith(original + '/')
              ? ${JSON.stringify(directory)} + filename.slice(original.length) : filename;
          }};
        }
        return load.apply(this, arguments);
      };
      process.umask(0o022);
    `);
    const before = await fs.lstat(directory).catch(error => { if (error.code !== 'ENOENT') throw error; });
    const test = await exec(process.execPath, ['--require', preload, originalTest], { timeout: 15000, maxBuffer: 65536 });
    assert.match(test.stdout, /Remote Host control tests passed \(17\)/);
    const after = await fs.lstat(directory);
    const loaded = { exports: {} };
    new Function('require', 'module', 'exports', built.outputFiles[0].text)(name => {
      if (name === 'fs/promises') return { ...require(name),
        mkdir: (filename, ...args) => fs.mkdir(filename === realDirectory ? directory : filename, ...args),
        lstat: (filename, ...args) => fs.lstat(filename === realDirectory ? directory : filename, ...args) };
      return require(name);
    }, loaded, loaded.exports);
    const storage = path.join(temporary, 'global', 'runtime-roots-v1', 'a'.repeat(64), 'b'.repeat(64),
      'runtime-supervisor-generations', 'terminal-root-owner-linux-v1', 'runtime-supervisor');
    const paths = loaded.exports.resolveLegacyRuntimeSupervisorPathsFromStorageDir(storage);
    assert.equal(paths.runtimeDir, realDirectory);
    let rootCheck = 'accepted', error;
    try { await loaded.exports.ensureRuntimeRootSocketDirectory(paths, 'legacy-detached', true); }
    catch (e) { rootCheck = 'rejected'; error = e.message; }
    assert.equal(after.uid, process.getuid());
    assert.equal(after.mode & 0o777, initial === 'absent' ? 0o755 : 0o700);
    assert.equal(rootCheck, initial === 'absent' ? 'rejected' : 'accepted');
    if (error) assert.equal(error, 'Root runtime owner storage must be private to the current OS user.');
    const remaining = await fs.readdir(directory);
    assert.deepEqual(remaining, [], 'Original test leaves its parent directory, but closes and removes its socket.');
    results.push({initial, testExit:0, testCases:17, beforeMode:before ? (before.mode & 0o777).toString(8) : null,
      afterMode:(after.mode & 0o777).toString(8), ownerMatches:true, parentRetained:true, remaining, rootCheck, error,
      beforeInode:before?.ino, afterInode:after.ino});
  }
  console.log(JSON.stringify({input:process.cwd(), diagnostic_only:true, mapping:'Only the fixed socket directory is mapped; original test/assertions and production directory validation are unchanged.',
    originalTestSha256:createHash('sha256').update(await fs.readFile(originalTest)).digest('hex'),
    rootOwnerSourceSha256:createHash('sha256').update(await fs.readFile(source)).digest('hex'), results},null,2));
} finally {
  // All child tests completed and both fixture directories were confirmed empty before cleanup.
  await fs.rm(temporary, { recursive:true, force:true });
}
