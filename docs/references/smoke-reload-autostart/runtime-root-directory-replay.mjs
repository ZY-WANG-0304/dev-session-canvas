// 定位程序：不启动 Supervisor；只在目录准备完成后立即取消。
// 仓库根执行：node docs/references/smoke-reload-autostart/runtime-root-directory-replay.mjs [原失败 globalStorage]
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { chmod, lstat, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import esbuild from 'esbuild';

const require = createRequire(import.meta.url);
const { outputFiles } = await esbuild.build({
  stdin: { contents: `
    export * from './extensions/vscode/dev-session-canvas/src/common/runtimeRootOwnership';
    export * from './extensions/vscode/dev-session-canvas/src/panel/runtimeExecutionEnvironment';
    export * from './extensions/vscode/dev-session-canvas/src/supervisor/runtimeRootOwner';
    export * from './extensions/vscode/dev-session-canvas/src/supervisor/runtimeRootPreparation';
  `, resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, platform: 'node', format: 'cjs', write: false, external: ['node-pty', 'vscode']
});
const loaded = { exports: {} };
new Function('require', 'module', 'exports', outputFiles[0].text)(require, loaded, loaded.exports);
const api = loaded.exports;
const environment = await api.readRuntimeExecutionEnvironment();
const profile = 'linux-owner-v1-candidate';
assert.equal(process.platform, 'linux');
const temporary = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dsc-root-dir-rca-')));
const results = [];
const modeOf = async filename => (await lstat(filename)).mode & 0o7777;
const octal = mode => mode.toString(8).padStart(4, '0');
async function replay(globalStorage, label) {
  const mode = await modeOf(globalStorage);
  const owner = api.createRuntimeOwnerDescriptor({ ...environment,
    userStorageScopeKey: api.createRuntimeUserStorageScopeKey(environment.userIdentity, globalStorage),
    rootPath: process.cwd(), generation: api.resolveRootRuntimeSupervisorGeneration(profile) });
  const storageDir = path.join(api.resolveRuntimeRootOwnerBaseStoragePath(globalStorage, owner), 'runtime-supervisor');
  let directoryError = null;
  try { await api.prepareRuntimeRootOwnerDirectories(storageDir, owner); }
  catch (error) { directoryError = error.message; }
  const result = await api.prepareRuntimeRootSupervisor({ type: 'prepare-root-runtime', storageDir, owner,
    executionProfile: profile, preferredBackends: ['legacy-detached'],
    supervisorScriptPath: path.join(process.cwd(), 'extensions/vscode/dev-session-canvas/dist/runtime-supervisor.js'),
    supervisorLauncherScriptPath: path.join(process.cwd(), 'extensions/vscode/dev-session-canvas/dist/runtime-supervisor-launcher.js')
  }, () => true);
  assert.equal(await modeOf(globalStorage), mode);
  const unsafe = Boolean(mode & 0o022);
  assert.equal(directoryError, unsafe
    ? 'Root runtime global storage must be owned by the current OS user and not writable by others.' : null);
  assert.deepEqual(result, { kind: 'unconfirmed', reason: unsafe
    ? 'Root runtime preparation or submission did not complete.' : 'Root runtime preparation was cancelled.' });
  results.push({ label, mode: octal(mode), directoryError, preparationResult: result,
    reachedAfterDirectoryPreparation: !unsafe, submitted: false });
}
try {
  if (process.argv[2]) {
    const original = await realpath(process.argv[2]);
    // 只读重放原失败目录：先确认必定在任何 mkdir 前被拒绝。
    assert.ok((await modeOf(original)) & 0o022);
    await replay(original, 'original-failure-directory');
  }
  const simulated = path.join(temporary, 'global');
  const previousUmask = process.umask(0o002);
  try { await mkdir(path.join(simulated, 'root-local-canvas', 'fixture'), { recursive: true }); }
  finally { process.umask(previousUmask); }
  assert.equal(await modeOf(simulated), 0o775);
  await mkdir(simulated, { recursive: true, mode: 0o700 });
  assert.equal(await modeOf(simulated), 0o775, 'mkdir(mode:0700) does not change an existing directory');
  await replay(simulated, 'existing-0775-after-host-mkdir-0700');
  await chmod(simulated, 0o755);
  await replay(simulated, 'same-directory-0755');
  await chmod(simulated, 0o700);
  await replay(simulated, 'same-directory-0700');
  console.log(JSON.stringify({ node: process.version, cases: results }, null, 2));
} finally { await rm(temporary, { recursive: true, force: true }); }
