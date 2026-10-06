import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { build } from 'esbuild';
import contract from '../../tests/vscode-smoke/runtime-reload-contract.cjs';
import installedReceipts from '../../tests/vscode-smoke/installed-execution-candidate.cjs';
import { installCandidateVsix, prepareInstalledVsixInput } from './installed-execution-candidate.mjs';
import { prepareRuntime, runInsideXvfb, shouldReRunInsideXvfb,
  snapshotVSCodeLogs, spawnPreparedVSCodeScenario } from './vscode-smoke-runner.mjs';

const { fixedVsixSha256, readIdentity, sameLiveIdentity, assertReloadReceipts, signalOwned, exitedIdentity } = contract;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const write = (file, value) => fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
const read = async file => JSON.parse(await fs.readFile(file, 'utf8'));

export function selectReloadInput(values) {
  const mode = values.mode ?? 'live-runtime';
  const currentState = values['current-state'] === true;
  assert(['live-runtime', 'snapshot-only'].includes(mode), 'Choose an explicit supported reload mode.');
  assert(!currentState || mode === 'live-runtime', 'Current-state reload requires live-runtime mode.');
  if (mode === 'snapshot-only') assert.match(values['expected-vsix-sha256'] ?? '', /^[a-f0-9]{64}$/,
    'Snapshot-only requires the explicitly frozen package SHA256.');
  else if (currentState) assert.match(values['expected-vsix-sha256'] ?? '', /^[a-f0-9]{64}$/,
    'Current-state reload requires the explicitly selected package SHA256.');
  else assert.equal(values['expected-vsix-sha256'], undefined, 'The original Runtime package remains fixed.');
  return { mode, currentState, expectedSha256: mode === 'snapshot-only' || currentState
    ? values['expected-vsix-sha256'] : fixedVsixSha256 };
}

export async function prepareReloadDriver({ projectRoot, targetRoot, input, runtime }) {
  await fs.mkdir(path.join(targetRoot, 'fixtures'), { recursive: true });
  await write(path.join(targetRoot, 'package.json'), {
    name: 'runtime-reload-activation-driver', publisher: 'devsessioncanvas-tests', version: '0.0.0',
    engines: { vscode: '^1.117.0' }, main: './runtime-reload-driver.cjs',
    activationEvents: ['onStartupFinished'], extensionKind: ['workspace']
  });
  const files = ['runtime-reload-driver.cjs', 'runtime-reload-contract.cjs', 'test-helpers.cjs',
    'installed-execution-candidate.cjs', 'fixtures/execution-capacity-subject.cjs',
    'fixtures/runtime-reload-completed-subject.cjs'];
  const sourceHashes = {};
  for (const file of files) {
    const bytes = await fs.readFile(path.join(projectRoot, 'tests/vscode-smoke', file));
    sourceHashes[`tests/vscode-smoke/${file}`] = createHash('sha256').update(bytes).digest('hex');
    await fs.writeFile(path.join(targetRoot, file), bytes, { flag: 'wx' });
  }
  const lifecyclePath = 'scripts/test/fixtures/linux-lifecycle-subject.mjs';
  const lifecycle = await fs.readFile(path.join(projectRoot, lifecyclePath));
  sourceHashes[lifecyclePath] = createHash('sha256').update(lifecycle).digest('hex');
  await fs.writeFile(path.join(targetRoot, 'fixtures/linux-lifecycle-subject.mjs'), lifecycle, { flag: 'wx' });
  const replay = await build({ entryPoints: [path.join(projectRoot, 'tests/vscode-smoke/runtime-reload-contract.cjs')],
    outfile: path.join(targetRoot, 'runtime-reload-contract.cjs'), bundle: true, platform: 'node', format: 'cjs',
    write: true, metafile: true, logLevel: 'silent' });
  for (const file of Object.keys(replay.metafile.inputs)) {
    sourceHashes[file] = createHash('sha256').update(await fs.readFile(path.resolve(file))).digest('hex');
  }
  sourceHashes['staged-runtime-reload-contract.cjs'] = createHash('sha256')
    .update(await fs.readFile(path.join(targetRoot, 'runtime-reload-contract.cjs'))).digest('hex');
  const helper = path.join(targetRoot, 'runtime-reload-paths.cjs');
  const bundled = await build({ entryPoints: [path.join(projectRoot,
    'extensions/vscode/dev-session-canvas/src/common/runtimeSupervisorPaths.ts')], outfile: helper,
    bundle: true, platform: 'node', format: 'cjs', write: true, metafile: true, logLevel: 'silent' });
  for (const file of Object.keys(bundled.metafile.inputs)) {
    sourceHashes[file] = createHash('sha256').update(await fs.readFile(path.resolve(file))).digest('hex');
  }
  sourceHashes['staged-runtime-reload-paths.cjs'] = createHash('sha256').update(await fs.readFile(helper)).digest('hex');
  const expectation = { ...input, extensionsDir: await fs.realpath(runtime.extensionsDir) };
  const expectationPath = path.join(runtime.artifactsDir, 'installed-vsix-expectation.json');
  await write(expectationPath, expectation);
  return { expectation, expectationPath, sourceHashes };
}

export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: { output: { type: 'string' }, 'installed-vsix': { type: 'string' },
    mode: { type: 'string' }, 'expected-vsix-sha256': { type: 'string' }, 'current-state': { type: 'boolean', default: false } } });
  const selection = selectReloadInput(values);
  assert.equal(process.platform, 'linux');
  assert.equal(process.arch, 'x64');
  if (selection.mode === 'snapshot-only') assert.equal(process.versions.node, '25.6.0',
    'The unchanged lifecycle subject requires the fixed Node 25.6.0 executable.');
  assert(values.output && values['installed-vsix'], 'Specify --output NEW_DIRECTORY --installed-vsix FROZEN_PACKAGE.');
  const projectRoot = process.cwd();
  if (shouldReRunInsideXvfb()) {
    process.exitCode = runInsideXvfb(fileURLToPath(import.meta.url), projectRoot);
    return;
  }
  const startedAt = Date.now();
  const deadlineAt = startedAt + 180000;
  const output = path.resolve(values.output);
  await fs.mkdir(output);
  const nonce = randomUUID();
  const input = await prepareInstalledVsixInput(values['installed-vsix'], output);
  assert.equal(input.vsixSha256, selection.expectedSha256, 'Use exactly the explicitly frozen Linux installed package.');
  const vscodeExecutablePath = await fs.realpath(process.env.DEV_SESSION_CANVAS_VSCODE_EXECUTABLE ??
    path.join(projectRoot, '.vscode-test/vscode-linux-x64-1.117.0', 'code'));
  const product = await read(path.join(path.dirname(vscodeExecutablePath), 'resources/app/product.json'));
  assert.equal(product.commit, '10c8e557c8b9f9ed0a87f61f1c9a44bde731c409');
  const runtime = await prepareRuntime({ projectRoot, debugRoot: path.join(output, 'runtime'),
    runtimeDirName: `dsc-reload-${nonce}`,
    userSettings: { 'security.workspace.trust.enabled': false,
      'devSessionCanvas.runtimePersistence.enabled': selection.mode === 'live-runtime',
      'devSessionCanvas.terminal.shell': 'default', 'devSessionCanvas.terminal.shellPath': '/bin/sh',
      'terminal.integrated.scrollback': 100000 } });
  const workspacePath = path.join(runtime.debugRoot, 'workspace');
  await fs.mkdir(workspacePath);
  const driverRoot = path.join(runtime.debugRoot, 'activation-driver');
  const driver = await prepareReloadDriver({ projectRoot, targetRoot: driverRoot, input, runtime });
  await installCandidateVsix({ vscodeExecutablePath, runtime, input });
  const controlPath = path.join(runtime.artifactsDir, 'control.json');
  await write(controlPath, { schemaVersion: 1, phase: 'setup', nonce, deadlineAt, mode: selection.mode });
  await write(path.join(output, 'input.json'), { schemaVersion: 1, nonce, startedAt, deadlineAt,
    scope: selection.mode === 'live-runtime'
      ? 'One Linux installed Runtime two-Terminal real Reload Window; no capacity, Agent, snapshot-only or other-platform claim.'
      : 'One Linux installed snapshot-only Terminal real Reload Window; no old-reader applied, source EOF, Agent or other-platform claim.',
    mode: selection.mode,
    vsixSha256: input.vsixSha256, vscodeExecutablePath, vscodeCommit: product.commit,
    subjectExecutable: process.execPath, spawnCount: 1, extensionTestsPath: null,
    sourceHashes: { ...driver.sourceHashes,
      'scripts/smoke/run-vscode-runtime-reload-candidate.mjs': createHash('sha256').update(await fs.readFile(fileURLToPath(import.meta.url))).digest('hex'),
      'scripts/smoke/vscode-smoke-runner.mjs': createHash('sha256').update(await fs.readFile(path.join(projectRoot, 'scripts/smoke/vscode-smoke-runner.mjs'))).digest('hex') },
    boundMs: 180000, cleanupReservationMs: 30000, automaticRetries: 0 });
  assert(Date.now() < deadlineAt - 60000, 'Preparation consumed the fixed run budget; do not launch a shortened workload.');
  const handle = await spawnPreparedVSCodeScenario({ projectRoot, runtime, workspacePath, vscodeExecutablePath,
    extensionDevelopmentPath: driverRoot, disableExtensions: false, disableWorkspaceTrust: true,
      extensionTestsEnv: { DEV_SESSION_CANVAS_SMOKE_TEST_MODE: '1', DEV_SESSION_CANVAS_RELOAD_CONTROL: controlPath,
        ...(selection.currentState ? { DEV_SESSION_CANVAS_EXPECT_CURRENT_STATE: '1' } : {}),
        DEV_SESSION_CANVAS_INSTALLED_VSIX_EXPECTATION: driver.expectationPath,
      DEV_SESSION_CANVAS_RELOAD_SUBJECT_NODE: process.execPath } });
  // Attach rejection handling immediately; early exit is evidence, never a relaunch trigger.
  const completion = handle.completed.then(() => ({ code: handle.child.exitCode, signal: handle.child.signalCode }),
    error => ({ code: handle.child.exitCode, signal: handle.child.signalCode, error: String(error) }));
  let ui;
  let failure;
  let exit;
  const fallback = [];
  const artifact = name => read(path.join(runtime.artifactsDir, `${name}.json`));
  try {
    ui = await readIdentity(handle.child.pid);
    assert(ui && ui.executable === vscodeExecutablePath, 'Require the exact native UI child, not a forwarding CLI.');
    await write(path.join(runtime.artifactsDir, 'launcher.json'), { nonce, ui, spawnCount: 1 });
    const timeout = Symbol('deadline');
    let timer;
    try {
      exit = await Promise.race([completion, new Promise(resolve => {
        timer = setTimeout(() => resolve(timeout), Math.max(0, deadlineAt - Date.now() - 10000));
      })]);
    } finally { clearTimeout(timer); }
    assert.notEqual(exit, timeout, 'Actual UI did not close within the bounded case; no retry or replacement Host.');
    const receipts = { control: await read(controlPath), launcher: await artifact('launcher'),
      setup: await artifact('setup'), verify: await artifact('verify'), cleanup: await artifact('cleanup'), exit, fallback };
    assertReloadReceipts(receipts);
    const finished = await artifact('driver-finished');
    assert.equal(finished.pass, true);
    assert.equal(finished.nonce, nonce);
    assert.equal(finished.phase, 'verify');
    for (const phase of ['setup', 'verify']) {
      const environment = await artifact(`${phase}-environment`);
      assert.equal(environment.nonce, nonce);
      assert.equal(environment.phase, phase);
      installedReceipts.assertInstalledExtensionReceipt(environment.installedVsix, driver.expectation);
    }
    await write(path.join(output, 'result.json'), { pass: true, nonce, receipts, elapsedMs: Date.now() - startedAt });
  } catch (error) {
    failure = error;
    await write(path.join(output, 'first-failure.json'), { error: String(error), stack: error.stack, nonce,
      elapsedMs: Date.now() - startedAt, exit: typeof exit === 'symbol' ? 'timeout' : exit ?? null });
    // Preserve the first failure boundary when the driver exits before its
    // phase receipt. The inventory is names-only so it cannot publish runtime
    // output or credentials, but it distinguishes driver setup failure from a
    // product assertion that happened after setup.
    const artifactNames = await fs.readdir(runtime.artifactsDir).catch(() => []);
    await write(path.join(output, 'artifact-inventory.json'), {
      nonce,
      phase: 'driver-artifact-inventory',
      names: artifactNames.filter(name => /^[a-zA-Z0-9._-]+$/.test(name)).sort()
    }).catch(() => {});
  } finally {
    if (failure) {
      // These identities were recorded by this run before reload. No PID search,
      // process-tree kill or replacement Host is allowed on the recovery path.
      let ownership;
      try { ownership = await artifact('ownership'); }
      catch (error) { fallback.push({ action: 'ownership-unavailable', error: String(error) }); }
      const entries = [...(ownership?.resources ?? []), ...(ownership?.supervisor ? [ownership.supervisor] : [])];
      if (ui) entries.push(ui);
      for (const expected of entries) {
        if (!exitedIdentity(expected, await readIdentity(expected.pid))) fallback.push(await signalOwned(expected, 'SIGTERM'));
      }
      const gracefulDeadline = Math.min(deadlineAt - 3000, Date.now() + 3000);
      while (Date.now() < gracefulDeadline && entries.some(entry => entry.pid === handle.child.pid) && handle.child.exitCode === null && handle.child.signalCode === null) {
        await sleep(50);
      }
      for (const expected of entries) {
        if (sameLiveIdentity(expected, await readIdentity(expected.pid))) fallback.push(await signalOwned(expected, 'SIGKILL'));
      }
      await write(path.join(output, 'fallback.json'), { productCleanupPass: false, records: fallback });
      await snapshotVSCodeLogs(runtime.userDataDir, runtime.artifactsDir);
    }
    let timer;
    try {
      const childExit = await Promise.race([completion, new Promise(resolve => {
        timer = setTimeout(() => resolve(null), Math.max(1, deadlineAt - Date.now()));
      })]);
      await write(path.join(output, 'ui-exit.json'), { exit: childExit, originalUi: ui ?? null, elapsedMs: Date.now() - startedAt });
      assert(childExit, 'Original UI exit remained unconfirmed at the overall deadline.');
    } finally { clearTimeout(timer); }
  }
  if (failure) throw failure;
  console.log(`Finite installed real Reload Window acceptance passed: ${output}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
