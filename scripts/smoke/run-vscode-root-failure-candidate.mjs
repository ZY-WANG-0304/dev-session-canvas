import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { build } from 'esbuild';
import contract from '../../tests/vscode-smoke/root-failure-contract.cjs';
import identity from '../../tests/vscode-smoke/runtime-reload-contract.cjs';
import installed from '../../tests/vscode-smoke/installed-execution-candidate.cjs';
import { prepareInstalledVsixInput, prepareInstalledCandidateDriver, installCandidateVsix } from './installed-execution-candidate.mjs';
import { prepareRuntime, resolveStagedSmokeTestPath, spawnPreparedVSCodeScenario,
  shouldReRunInsideXvfb, runInsideXvfb, snapshotVSCodeLogs } from './vscode-smoke-runner.mjs';

const { fixedVsixSha256, hash, rootSnapshotPath, removeObstacle, assertCaseReport, assertCleanupReport } = contract;
const { readIdentity, sameLiveIdentity, exitedIdentity, signalOwned } = identity;
const write = (file, value) => fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
const read = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function parseRootFailureSelection(args, platform = process.platform, arch = process.arch) {
  assert.equal(platform, 'linux');
  assert.equal(arch, 'x64');
  const { values } = parseArgs({ args, options: { output: { type: 'string' }, 'installed-vsix': { type: 'string' } } });
  assert(values.output?.trim() && values['installed-vsix']?.trim(), 'Specify --output NEW_DIRECTORY --installed-vsix FROZEN_ELECTRON_PACKAGE.');
  return values;
}

export async function main(args = process.argv.slice(2)) {
  const values = parseRootFailureSelection(args);
  const projectRoot = process.cwd();
  if (shouldReRunInsideXvfb()) {
    process.exitCode = runInsideXvfb(fileURLToPath(import.meta.url), projectRoot);
    return;
  }
  const output = path.resolve(values.output);
  await fs.mkdir(output);
  const startedAt = Date.now(), deadlineAt = startedAt + 180000;
  const nonce = randomUUID();
  const input = await prepareInstalledVsixInput(values['installed-vsix'], output);
  assert.equal(input.vsixSha256, fixedVsixSha256, 'Only the existing frozen Electron package is selected; never rebuild.');
  const vscodeRoot = path.join(projectRoot, '.vscode-test/vscode-linux-x64-1.117.0');
  const executable = await fs.realpath(path.join(vscodeRoot, 'code'));
  const product = await read(path.join(vscodeRoot, 'resources/app/product.json'));
  assert.equal(product.commit, '10c8e557c8b9f9ed0a87f61f1c9a44bde731c409');
  const runtime = await prepareRuntime({ projectRoot, debugRoot: path.join(output, 'runtime'),
    runtimeDirName: `dsc-root-failure-${nonce}`, userSettings: {
      'security.workspace.trust.enabled': false, 'devSessionCanvas.runtimePersistence.enabled': true,
      'devSessionCanvas.terminal.shell': 'default', 'devSessionCanvas.terminal.shellPath': '/bin/sh',
      'terminal.integrated.scrollback': 100000 } });
  const roots = { a: path.join(runtime.debugRoot, 'root-a'), b: path.join(runtime.debugRoot, 'root-b') };
  for (const root of Object.values(roots)) await fs.mkdir(root);
  const workspacePath = path.join(runtime.debugRoot, 'root-failure.code-workspace');
  await write(workspacePath, { folders: Object.entries(roots).map(([name, folder]) => ({ name, path: folder })) });
  const driverRoot = path.join(runtime.debugRoot, 'test-driver');
  const driver = await prepareInstalledCandidateDriver({ projectRoot, targetRoot: driverRoot, input,
    extensionsDir: runtime.extensionsDir, artifactsDir: runtime.artifactsDir });
  const helper = path.join(driverRoot, 'tests/vscode-smoke/root-failure-runtime-paths.cjs');
  const bundled = await build({ entryPoints: [path.join(projectRoot, 'extensions/vscode/dev-session-canvas/src/common/runtimeSupervisorPaths.ts')],
    outfile: helper, bundle: true, platform: 'node', format: 'cjs', write: true, metafile: true, logLevel: 'silent' });
  const sourceHashes = {};
  for (const file of [...Object.keys(bundled.metafile.inputs),
    'scripts/smoke/run-vscode-root-failure-candidate.mjs', 'scripts/smoke/installed-execution-candidate.mjs',
    'scripts/smoke/vscode-smoke-runner.mjs', 'tests/vscode-smoke/root-failure-candidate-tests.cjs',
    'tests/vscode-smoke/root-failure-contract.cjs', 'tests/vscode-smoke/runtime-reload-contract.cjs',
    'tests/vscode-smoke/test-helpers.cjs', 'tests/vscode-smoke/installed-execution-candidate.cjs',
    'tests/vscode-smoke/fixtures/execution-capacity-subject.cjs', 'tests/vscode-smoke/fixtures/runtime-reload-completed-subject.cjs']) {
    sourceHashes[file] = hash(await fs.readFile(path.resolve(file)));
  }
  sourceHashes['staged-root-failure-runtime-paths.cjs'] = hash(await fs.readFile(helper));
  await installCandidateVsix({ vscodeExecutablePath: executable, runtime, input });
  const control = { schemaVersion: 1, nonce, roots, userDataDir: runtime.userDataDir,
    subjectExecutable: await fs.realpath(process.execPath), deadlineAt };
  const controlPath = path.join(runtime.artifactsDir, 'control.json');
  await write(controlPath, control);
  await write(path.join(output, 'input.json'), { schemaVersion: 1, nonce, startedAt, deadlineAt, roots,
    scope: 'One installed Linux Runtime multi-root A real EISDIR completion save failure and B original Terminal Webview interaction.',
    vsixSha256: input.vsixSha256, vscodeExecutablePath: executable, vscodeCommit: product.commit,
    sourceHashes, subjectExecutable: control.subjectExecutable, subjectVersions: process.versions,
    boundMs: 180000, cleanupReservationMs: 30000, interactionBoundMs: 1500,
    automaticBuild: false, automaticRetry: false, privateBusinessStateInjection: false,
    rootOwnershipMigration: false, firstFailureCapture: 'read-only before B output or cleanup' });
  assert(Date.now() < deadlineAt - 60000, 'Preparation exhausted the fixed run budget; do not launch.');
  const handle = await spawnPreparedVSCodeScenario({ projectRoot, runtime, workspacePath, vscodeExecutablePath: executable,
    extensionDevelopmentPath: driverRoot,
    extensionTestsPath: resolveStagedSmokeTestPath(driverRoot, 'root-failure-candidate-tests.cjs'),
    disableExtensions: false, disableWorkspaceTrust: true,
    extensionTestsEnv: { DEV_SESSION_CANVAS_SMOKE_TEST_MODE: '1', DEV_SESSION_CANVAS_ROOT_FAILURE_CONTROL: controlPath,
      DEV_SESSION_CANVAS_INSTALLED_VSIX_EXPECTATION: driver.expectationPath } });
  const completion = handle.completed.then(() => ({ code: handle.child.exitCode, signal: handle.child.signalCode }),
    error => ({ code: handle.child.exitCode, signal: handle.child.signalCode, error: String(error) }));
  const artifact = name => read(path.join(runtime.artifactsDir, `${name}.json`));
  let failure, ui, exit;
  const fallback = [];
  try {
    ui = await readIdentity(handle.child.pid);
    assert(ui && ui.executable === executable, 'Require the original native UI child.');
    await write(path.join(runtime.artifactsDir, 'launcher.json'), { nonce, ui, spawnCount: 1 });
    let timer;
    try {
      exit = await Promise.race([completion, new Promise(resolve => {
        timer = setTimeout(() => resolve(null), Math.max(0, deadlineAt - Date.now() - 10000));
      })]);
    } finally { clearTimeout(timer); }
    assert(exit && exit.code === 0 && exit.signal === null && !exit.error, 'The original UI/test run must exit successfully.');
    const report = await artifact('case'), cleanup = await artifact('cleanup'), owned = await artifact('ownership');
    assert.equal(report.nonce, nonce);
    assert.equal((await artifact('driver-finished')).pass, true);
    assertCaseReport(report, control);
    assertCleanupReport(cleanup, owned);
    const environment = await artifact('environment');
    installed.assertInstalledExtensionReceipt(environment.installedVsix, driver.expectation);
    await write(path.join(output, 'result.json'), { pass: true, nonce, expectedFaultObserved: true,
      caseReport: path.join(runtime.artifactsDir, 'case.json'), cleanup, exit, fallback, elapsedMs: Date.now() - startedAt });
  } catch (error) {
    failure = error;
    await write(path.join(output, 'first-failure.json'), { error: String(error), stack: error.stack,
      nonce, exit: exit ?? null, elapsedMs: Date.now() - startedAt });
  } finally {
    if (failure) {
      let owned;
      try { owned = await artifact('ownership'); }
      catch (error) { fallback.push({ action: 'ownership-unavailable', error: String(error) }); }
      try {
        const obstacle = await artifact('obstacle');
        assert.equal(obstacle.path, `${rootSnapshotPath(runtime.userDataDir, roots.a)}.tmp`);
        try { fallback.push({ action: 'owned-obstacle-removal', ...await removeObstacle(obstacle) }); }
        catch (error) {
          if (error.code === 'ENOENT') fallback.push({ action: 'obstacle-already-absent' });
          else throw error;
        }
      } catch (error) {
        if (error.code !== 'ENOENT') fallback.push({ action: 'obstacle-cleanup-unconfirmed', error: String(error) });
      }
      const entries = [...(owned?.resources ?? []), ...(owned?.supervisor ? [owned.supervisor] : []), ...(ui ? [ui] : [])];
      for (const expected of entries) if (!exitedIdentity(expected, await readIdentity(expected.pid))) fallback.push(await signalOwned(expected, 'SIGTERM'));
      const grace = Math.min(Date.now() + 3000, deadlineAt - 3000);
      while (Date.now() < grace && handle.child.exitCode === null && handle.child.signalCode === null) await sleep(50);
      for (const expected of entries) if (sameLiveIdentity(expected, await readIdentity(expected.pid))) fallback.push(await signalOwned(expected, 'SIGKILL'));
      await write(path.join(output, 'fallback.json'), { productCleanupPass: false, records: fallback });
      await snapshotVSCodeLogs(runtime.userDataDir, runtime.artifactsDir);
    }
    let timer;
    try {
      const observed = await Promise.race([completion, new Promise(resolve => {
        timer = setTimeout(() => resolve(null), Math.max(1, deadlineAt - Date.now()));
      })]);
      await write(path.join(output, 'ui-exit.json'), { exit: observed, originalUi: ui ?? null, elapsedMs: Date.now() - startedAt });
      assert(observed, 'Original UI exit is unconfirmed.');
    } finally { clearTimeout(timer); }
  }
  if (failure) throw failure;
  console.log(`Finite installed root failure and peer interaction passed: ${output}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
