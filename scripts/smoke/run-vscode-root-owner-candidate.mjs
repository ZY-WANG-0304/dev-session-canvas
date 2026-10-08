import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { build } from 'esbuild';
import contract from '../../tests/vscode-smoke/root-owner-contract.cjs';
import identity from '../../tests/vscode-smoke/runtime-reload-contract.cjs';
import installed from '../../tests/vscode-smoke/installed-execution-candidate.cjs';
import { prepareInstalledVsixInput, prepareInstalledCandidateDriver, installCandidateVsix } from './installed-execution-candidate.mjs';
import { prepareRuntime, spawnPreparedVSCodeScenario, ensureVSCodeExecutable,
  shouldReRunInsideXvfb, runInsideXvfb, snapshotVSCodeLogs } from './vscode-smoke-runner.mjs';

const { assertCase, assertBoundaryCase, assertContained, assertDriverProfileRegistration } = contract;
const { readIdentity, sameLiveIdentity, exitedIdentity, signalOwned } = identity;
async function write(file, value) {
  const pending = `${file}.pending-${process.pid}`;
  await fs.writeFile(pending, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
  await fs.link(pending, file);
  await fs.unlink(pending);
}
const read = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const labels = ['single-a', 'multi-a', 'multi-b', 'multi-c'];
const roles = ['single', 'multi', 'single-reopened'];

export function parseRootOwnerSelection(args, platform = process.platform, arch = process.arch) {
  assert.equal(platform, 'linux');
  assert.equal(arch, 'x64');
  const { values } = parseArgs({ args, options: { output: { type: 'string' }, 'installed-vsix': { type: 'string' },
    boundaries: { type: 'boolean', default: false } } });
  assert(values.output?.trim() && values['installed-vsix']?.trim(),
    'Specify --output NEW_DIRECTORY --installed-vsix ROOT_OWNER_PACKAGE.');
  return values;
}

async function maybeRead(file) {
  try { return await read(file); } catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
}

async function bounded(promise, deadlineAt) {
  let timer;
  try {
    return await Promise.race([promise, new Promise(resolve => {
      timer = setTimeout(() => resolve(undefined), Math.max(1, deadlineAt - Date.now()));
    })]);
  } finally { clearTimeout(timer); }
}

export async function prepareRootOwnerDriver({ projectRoot, runtime, input }) {
  assert(!await maybeRead(path.join(runtime.extensionsDir, 'extensions.json')),
    'Stage the root-owner driver before the first extension install initializes the default profile.');
  const targetRoot = path.join(runtime.extensionsDir, 'devsessioncanvas-tests.root-owner-driver-0.0.0');
  const driver = await prepareInstalledCandidateDriver({ projectRoot, targetRoot, input,
    extensionsDir: runtime.extensionsDir, artifactsDir: runtime.artifactsDir });
  await fs.writeFile(path.join(targetRoot, 'package.json'), `${JSON.stringify({
    name: 'root-owner-driver', publisher: 'devsessioncanvas-tests', version: '0.0.0',
    engines: { vscode: '^1.80.0' }, main: './tests/vscode-smoke/root-owner-driver.cjs',
    activationEvents: ['onStartupFinished'], extensionKind: ['workspace']
  }, null, 2)}\n`);
  const helper = path.join(targetRoot, 'tests/vscode-smoke/root-owner-runtime-paths.cjs');
  const common = './extensions/vscode/dev-session-canvas/src/common';
  const bundled = await build({ stdin: { contents:
    `export { resolveLegacyRuntimeSupervisorPaths, resolveSystemdUserRuntimeSupervisorPaths } from '${common}/runtimeSupervisorPaths';\n`
    + `export { resolveRuntimeRootOwnerGlobalStoragePath, assertRuntimeOwnerDescriptor } from '${common}/runtimeRootOwnership';\n`,
    resolveDir: projectRoot, sourcefile: 'root-owner-runtime-paths-entry.js' }, absWorkingDir: projectRoot,
    outfile: helper, bundle: true, platform: 'node', format: 'cjs', metafile: true, logLevel: 'silent' });
  const sourceHashes = {};
  for (const file of [...Object.keys(bundled.metafile.inputs).filter(file => file !== 'root-owner-runtime-paths-entry.js'),
    'scripts/smoke/run-vscode-root-owner-candidate.mjs', 'scripts/smoke/installed-execution-candidate.mjs',
    'scripts/smoke/vscode-smoke-runner.mjs', 'tests/vscode-smoke/root-owner-driver.cjs',
    'tests/vscode-smoke/root-owner-contract.cjs', 'tests/vscode-smoke/root-owner-contract-tests.cjs',
    'tests/vscode-smoke/root-owner-subject.cjs',
    'tests/vscode-smoke/runtime-reload-contract.cjs', 'tests/vscode-smoke/test-helpers.cjs',
    'tests/vscode-smoke/installed-execution-candidate.cjs']) {
    sourceHashes[file] = hash(await fs.readFile(path.resolve(projectRoot, file)));
  }
  for (const [name, file] of [['staged-root-owner-runtime-paths.cjs', helper],
    ['staged-driver-package.json', path.join(targetRoot, 'package.json')]]) sourceHashes[name] = hash(await fs.readFile(file));
  return { ...driver, sourceHashes, targetRoot };
}

async function collectOwned(runtime, roots, ui) {
  const entries = new Map(), unconfirmed = [];
  const add = expected => {
    assert(expected && Number.isInteger(expected.pid) && expected.pid > 1 && expected.startTicks && expected.executable);
    entries.set(`${expected.pid}:${expected.startTicks}:${expected.executable}`, expected);
  };
  if (ui) add(ui);
  for (const role of roles) {
    const receipt = await maybeRead(path.join(runtime.artifactsDir, `activated-${role}.json`));
    if (receipt) {
      assert.equal(receipt.host.executable, ui?.executable);
      add(receipt.host);
    }
  }
  for (const label of labels) {
    const owned = await maybeRead(path.join(runtime.artifactsDir, `owned-${label}.json`));
    if (!owned) { unconfirmed.push({ label, reason: 'No early ownership receipt; unknown resources are not signaled.' }); continue; }
    assertContained(runtime.userDataDir, owned.binding.runtimeStoragePath);
    assert(Object.values(roots).includes(owned.binding.runtimeOwner.root.normalizedPath));
    assert.equal(owned.binding.runtimeOwner.generation, 'terminal-root-owner-linux-v1');
    add(owned.supervisor);
    const resources = await maybeRead(path.join(runtime.artifactsDir, `resources-${label}.json`));
    if (!resources) { unconfirmed.push({ label, reason: 'Subject/provider ownership was not confirmed.' }); continue; }
    assert.deepEqual(resources.binding, owned.binding);
    assert(sameLiveIdentity(owned.supervisor, resources.supervisor));
    add(resources.identity); add(resources.provider);
  }
  return { entries: [...entries.values()], unconfirmed };
}

async function execute(output, values, projectRoot) {
  const startedAt = Date.now(), deadlineAt = startedAt + 360000, nonce = randomUUID();
  const input = await prepareInstalledVsixInput(values['installed-vsix'], output);
  const executable = await fs.realpath(await ensureVSCodeExecutable(projectRoot));
  const application = path.join(path.dirname(executable), 'resources/app');
  const product = await read(path.join(application, 'product.json'));
  const vscodePackage = await read(path.join(application, 'package.json'));
  const runtime = await prepareRuntime({ projectRoot, debugRoot: path.join(output, 'runtime'),
    runtimeDirName: `dsc-root-owner-${nonce}`, userSettings: {
      'security.workspace.trust.enabled': false, 'devSessionCanvas.runtimePersistence.enabled': true,
      'devSessionCanvas.terminal.shell': 'default', 'devSessionCanvas.terminal.shellPath': '/bin/sh',
      'terminal.integrated.scrollback': 10000 } });
  const roots = { a: path.join(runtime.debugRoot, 'root-a'), b: path.join(runtime.debugRoot, 'root-b'),
    c: path.join(runtime.debugRoot, 'root-c') };
  for (const root of Object.values(roots)) await fs.mkdir(root);
  const multiWorkspace = path.join(runtime.debugRoot, 'root-owner.code-workspace');
  await write(multiWorkspace, { folders: Object.entries(roots).map(([name, folder]) => ({ name, path: folder })),
    ...(values.boundaries ? { settings: { 'devSessionCanvas.terminal.shellPath': '/bin/bash',
      'devSessionCanvas.terminal.shellArgs': ['--noprofile', '--norc'], 'terminal.integrated.scrollback': 2000 } } : {}) });
  // The first CLI install inventories existing unpacked extensions for the default profile.
  const driver = await prepareRootOwnerDriver({ projectRoot, runtime, input });
  await installCandidateVsix({ vscodeExecutablePath: executable, runtime, input });
  const driverProfileRegistration = assertDriverProfileRegistration(
    await read(path.join(runtime.extensionsDir, 'extensions.json')), driver.targetRoot);
  const control = { schema: 1, roots, multiWorkspace, artifacts: runtime.artifactsDir,
    userDataDir: runtime.userDataDir, subjectExecutable: await fs.realpath(process.execPath),
    installedExpectation: driver.expectationPath, deadlineAt, boundaries: values.boundaries };
  const controlPath = path.join(runtime.artifactsDir, 'control.json');
  await write(controlPath, control);
  await write(path.join(output, 'input.json'), { schema: 1, nonce, startedAt, deadlineAt, roots,
    scope: values.boundaries
      ? 'Linux installed VSIX; multi first then single; independent Terminal settings; C keep/readd/clear; owned A fault while original B handles real I/O.'
      : 'Linux installed VSIX; one profile; actual single-A and multi-[A,B,C] Hosts; independent A sessions; surviving multi saves after peer exit and interaction, before single reopens; three-owner final idle exit.',
    excluded: ['concurrent canvas-write arbitration', 'Agent credentials or continuity', 'legacy slot', 'capacity scaling',
      ...(values.boundaries ? ['graceful completion of faulted A'] : ['injected owner fault', 'setting divergence', 'root remove/readd'])],
    boundaries: values.boundaries,
    vsixSha256: input.vsixSha256, vscodeExecutablePath: executable,
    vscodeVersion: vscodePackage.version, vscodeCommit: product.commit, sourceHashes: driver.sourceHashes,
    driverProfileRegistration,
    subjectExecutable: control.subjectExecutable, subjectVersions: process.versions,
    boundMs: 360000, cleanupReservationMs: 60000, automaticBuild: false, automaticRetry: false,
    productEntryUnmodified: true, metadataInjection: false, uiSpawnCount: 1 });
  assert(Date.now() < deadlineAt - 150000, 'Preparation exhausted the fixed budget; do not launch.');
  const handle = await spawnPreparedVSCodeScenario({ projectRoot, runtime,
    workspacePath: values.boundaries ? multiWorkspace : roots.a,
    vscodeExecutablePath: executable, extensionDevelopmentPath: [], disableExtensions: false,
    disableWorkspaceTrust: true, extensionTestsEnv: { DEV_SESSION_CANVAS_SMOKE_TEST_MODE: '1',
      DEV_SESSION_CANVAS_ROOT_OWNER_CONTROL: controlPath } });
  let exit;
  const completion = handle.completed.then(() => (exit = { code: handle.child.exitCode, signal: handle.child.signalCode }),
    error => (exit = { code: handle.child.exitCode, signal: handle.child.signalCode, error: String(error) }));
  let outputBytes = 0;
  const outputChunks = [], capture = bytes => {
    if (outputBytes < 4 * 1024 ** 2) { outputChunks.push(bytes); outputBytes += bytes.length; }
  };
  handle.child.stdout.on('data', capture); handle.child.stderr.on('data', capture);
  const artifact = name => read(path.join(runtime.artifactsDir, `${name}.json`));
  let ui, failure;
  try {
    ui = await readIdentity(handle.child.pid);
    assert(ui && ui.executable === executable, 'Require the original native UI child.');
    await write(path.join(runtime.artifactsDir, 'launcher.json'), { ui, nonce, spawnCount: 1 });
    let finished;
    while (Date.now() < deadlineAt - 60000) {
      const failures = (await fs.readdir(runtime.artifactsDir)).filter(file => file.startsWith('failure-') && file.endsWith('.json'));
      assert.equal(failures.length, 0, `Driver failure receipts: ${failures.join(', ')}`);
      finished = await maybeRead(path.join(runtime.artifactsDir, 'multi-finished.json'));
      if (finished) break;
      assert(!exit, `Native UI exited before the required scenario receipts: ${JSON.stringify(exit)}`);
      await sleep(100);
    }
    assert.equal(finished?.pass, true, 'The bounded scenario must produce its final receipt.');
    const single = await artifact('single-ready'), multi = await artifact('multi-ready');
    let receipts;
    if (values.boundaries) {
      assertBoundaryCase(single, multi, await artifact('boundary-result'));
      receipts = [single, multi];
    } else {
      const reopened = await artifact('single-reopened-ready'), closed = await artifact('after-close');
      assertCase(single, multi, reopened, closed);
      receipts = [single, multi, reopened];
    }
    for (const receipt of receipts) {
      installed.assertInstalledExtensionReceipt(receipt.installedVsix, driver.expectation);
      assert.equal(receipt.vscode, vscodePackage.version);
    }
    assert.equal((await artifact('single-finished')).pass, true);
    if (!values.boundaries) assert.equal(finished.runtime.bindings.length, 0);
    assert.equal(finished.runtime.pendingRuntimeSupervisorOperationCount, 0);
    assert(await bounded(completion, Math.min(deadlineAt - 45000, Date.now() + 15000)), 'Native UI did not close.');
    assert.equal(exit.code, 0); assert.equal(exit.signal, null); assert(!exit.error);
    const idleStartedAt = Date.now(), owners = multi.subjects.map(subject => subject.supervisor);
    const owned = await collectOwned(runtime, roots, ui);
    assert.deepEqual(owned.unconfirmed, []);
    // Do not open RPC connections during the normal no-client idle timeout.
    while (Date.now() < Math.min(deadlineAt - 5000, idleStartedAt + 45000)) {
      const samples = await Promise.all(owners.map(owner => readIdentity(owner.pid)));
      if (owners.every((owner, index) => exitedIdentity(owner, samples[index]))) break;
      await sleep(200);
    }
    const observations = [];
    for (const expected of owned.entries) {
      const after = await readIdentity(expected.pid);
      observations.push({ expected, after: after ?? null, exited: exitedIdentity(expected, after) });
    }
    await write(path.join(output, 'idle-cleanup.json'), { observations, idleElapsedMs: Date.now() - idleStartedAt,
      owners: owners.length, naturalIdleOwners: values.boundaries ? owners.slice(1) : owners,
      faultedOwner: values.boundaries ? owners[0] : undefined,
      faultFixtureCleanup: values.boundaries ? (await artifact('boundary-result')).faultFixtureCleanup : undefined,
      forcedSignals: [], allExited: observations.every(entry => entry.exited) });
    assert(observations.every(entry => entry.exited), 'All known original processes must exit without fallback.');
    await write(path.join(output, 'result.json'), { pass: true, nonce, exit, elapsedMs: Date.now() - startedAt,
      ownerCount: 3, independentlyCreatedSessions: 4, realHostCount: values.boundaries ? 2 : 3,
      scenario: values.boundaries ? 'root-boundaries' : 'root-window-pair',
      fault: values.boundaries ? await artifact('boundary-fault') : undefined, forcedSignals: [] });
  } catch (error) {
    failure = error;
    await write(path.join(output, 'first-failure.json'), { error: String(error), stack: error.stack,
      exit: exit ?? null, elapsedMs: Date.now() - startedAt });
  } finally {
    if (failure) {
      const records = [];
      let owned;
      try { owned = await collectOwned(runtime, roots, ui); }
      catch (error) { owned = { entries: ui ? [ui] : [], unconfirmed: [{ reason: String(error) }] }; }
      for (const expected of owned.entries) records.push(await signalOwned(expected, 'SIGTERM'));
      await sleep(1000);
      for (const expected of owned.entries) {
        if (sameLiveIdentity(expected, await readIdentity(expected.pid))) records.push(await signalOwned(expected, 'SIGKILL'));
      }
      const observations = [];
      for (const expected of owned.entries) observations.push({ expected, after: await readIdentity(expected.pid) ?? null });
      await write(path.join(output, 'fallback.json'), { productCleanupPass: false, records,
        unconfirmed: owned.unconfirmed, observations });
    }
    await bounded(completion, Math.min(deadlineAt, Date.now() + 5000));
    await write(path.join(output, 'ui-exit.json'), { originalUi: ui ?? null, exit: exit ?? null });
    await fs.writeFile(path.join(runtime.artifactsDir, 'native-output.log'), Buffer.concat(outputChunks));
    await snapshotVSCodeLogs(runtime.userDataDir, runtime.artifactsDir);
  }
  if (failure) throw failure;
  console.log(`Installed double-window root-owner scenario passed: ${output}`);
}

export async function main(args = process.argv.slice(2)) {
  const values = parseRootOwnerSelection(args), projectRoot = fileURLToPath(new URL('../../', import.meta.url));
  if (shouldReRunInsideXvfb()) {
    process.exitCode = runInsideXvfb(fileURLToPath(import.meta.url), projectRoot);
    return;
  }
  const requestedOutput = path.resolve(values.output);
  await fs.mkdir(requestedOutput);
  const output = await fs.realpath(requestedOutput);
  try { await execute(output, values, projectRoot); }
  catch (error) {
    if (!await maybeRead(path.join(output, 'first-failure.json'))) {
      await write(path.join(output, 'first-failure.json'), { error: String(error), stack: error.stack, phase: 'preparation' });
    }
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
