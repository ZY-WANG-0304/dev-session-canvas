import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { promisify } from 'node:util';

// Fresh disposable CI runner only. No product or test source is mutated.
assert.equal(process.env.GITHUB_ACTIONS, 'true');
assert.equal(process.platform, 'linux');
const require = createRequire(path.join(process.cwd(), 'package.json'));
const esbuild = require('esbuild');
const exec = promisify(execFile);
const directory = `/tmp/dsc-root-${process.getuid()}`;
const summary = { diagnostic_only:true, input:'7e659ce6af2f713a64031eeb4daacf705977e851', directory,
  note:'Original 17 tests are unmodified. Changing only the freshly created empty directory mode is a causal control, not a product fix or release gate.' };
const state = async () => {
  try {
    const value = await fs.lstat(directory);
    return {uid:value.uid, mode:(value.mode & 0o7777).toString(8), inode:value.ino, device:value.dev,
      isDirectory:value.isDirectory(), entries:await fs.readdir(directory)};
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
};
summary.before = await state();
assert.equal(summary.before, null, 'This control requires a genuinely absent directory, never an existing runtime namespace.');
let failure;
try {
  const filename = path.resolve('scripts/test/test-smoke-remote-host.mjs');
  summary.testSha256 = createHash('sha256').update(await fs.readFile(filename)).digest('hex');
  const result = await exec(process.execPath, [filename], {timeout:15000,maxBuffer:65536});
  assert.match(result.stdout, /Remote Host control tests passed \(17\)/);
  summary.testExit = 0;
  summary.afterOriginalTest = await state();
  assert.equal(summary.afterOriginalTest.uid, process.getuid());
  assert.equal(summary.afterOriginalTest.mode, '755');
  assert.deepEqual(summary.afterOriginalTest.entries, []);
  const bundle = await esbuild.build({ stdin:{contents:`
    export { ensureRuntimeRootSocketDirectory } from './extensions/vscode/dev-session-canvas/src/supervisor/runtimeRootOwner';
    export { resolveLegacyRuntimeSupervisorPathsFromStorageDir } from './extensions/vscode/dev-session-canvas/src/common/runtimeSupervisorPaths';
  `,loader:'ts',resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',write:false});
  const loaded = {exports:{}};
  new Function('require','module','exports',bundle.outputFiles[0].text)(require,loaded,loaded.exports);
  const storage = path.join(process.env.RUNNER_TEMP, 'uncreated-rca-root', 'runtime-roots-v1', 'a'.repeat(64), 'b'.repeat(64),
    'runtime-supervisor-generations','terminal-root-owner-linux-v1','runtime-supervisor');
  const paths = loaded.exports.resolveLegacyRuntimeSupervisorPathsFromStorageDir(storage);
  assert.equal(paths.runtimeDir,directory);
  let error;
  try {await loaded.exports.ensureRuntimeRootSocketDirectory(paths,'legacy-detached',true);}
  catch (e) {error=e.message;}
  assert.equal(error,'Root runtime owner storage must be private to the current OS user.');
  summary.originalDirectoryCheck = {outcome:'rejected',error};
  const same = await state();
  assert.deepEqual(same,summary.afterOriginalTest);
  // This empty directory did not exist before the original test, and its identity was rechecked.
  await fs.chmod(directory,0o700);
  await loaded.exports.ensureRuntimeRootSocketDirectory(paths,'legacy-detached',true);
  summary.permissionOnlyControl = {outcome:'accepted',state:await state()};
  assert.equal(summary.permissionOnlyControl.state.inode,same.inode);
} catch (error) {
  failure=error;
  summary.error=error.message;
} finally {
  if (!failure) {
    const final = await state();
    assert.equal(final.inode,summary.afterOriginalTest.inode);
    assert.equal(final.uid,process.getuid());
    assert.deepEqual(final.entries,[]);
    await fs.rmdir(directory);
    summary.cleaned=true;
  }
  await fs.writeFile(path.join(process.env.RUNNER_TEMP,'socket-directory-evidence.json'),JSON.stringify(summary,null,2)+'\n');
  console.log(JSON.stringify(summary,null,2));
}
if (failure) throw failure;
