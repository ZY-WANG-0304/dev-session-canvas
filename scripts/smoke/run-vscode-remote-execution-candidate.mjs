import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { build } from 'esbuild';
import { createRemoteSSHFixture } from './vscode-remote-ssh-fixture.mjs';
import { prepareInstalledCandidateDriver, prepareInstalledVsixInput } from './installed-execution-candidate.mjs';
import { buildVSCodeChildEnv, ensureVSCodeExecutable, prepareRuntime, resolveStagedSmokeTestPath,
  runInsideXvfb, shouldReRunInsideXvfb, spawnPreparedVSCodeScenario, stageSmokeTestSuite,
  writeUserSettings } from './vscode-smoke-runner.mjs';
import receipts from '../../tests/vscode-smoke/installed-execution-candidate.cjs';
import remote from '../../tests/vscode-smoke/remote-execution-candidate.cjs';

const exec = promisify(execFile);
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
const writeJson = (file, value) => fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
const readJson = async file => JSON.parse(await fs.readFile(file, 'utf8'));

export function parseRemoteSelection(args) {
  const { values } = parseArgs({ args, options: { output: { type: 'string' }, probe: { type: 'boolean' },
    'installed-vsix': { type: 'string' }, 'root-owner': { type: 'boolean', default: false } } });
  assert(values.output?.trim(), 'Specify a new --output directory.');
  assert(Boolean(values.probe) !== Boolean(values['installed-vsix']), 'Select --probe or one fixed --installed-vsix.');
  if (values['installed-vsix'] !== undefined) assert(values['installed-vsix'].trim(), 'Specify a fixed VSIX file.');
  assert(!values['root-owner'] || values['installed-vsix'], 'Root-owner Remote acceptance requires an installed VSIX.');
  return values;
}

export function remoteCandidateModes(values) {
  return values['root-owner'] ? ['live-runtime'] : ['live-runtime', 'snapshot-only'];
}

export async function prepareRemoteRootOwnerHelper(projectRoot, targetRoot) {
  const file = resolveStagedSmokeTestPath(targetRoot, 'candidate-root-ownership.cjs');
  const source = './extensions/vscode/dev-session-canvas/src';
  const bundled = await build({ stdin: { contents:
    `export * from '${source}/common/runtimeRootOwnership';\n`
    + `export { readRuntimeExecutionEnvironment } from '${source}/panel/runtimeExecutionEnvironment';\n`,
    sourcefile: 'remote-root-owner-entry.js', resolveDir: projectRoot }, absWorkingDir: projectRoot,
    bundle: true, platform: 'node', format: 'cjs', target: 'node22', outfile: file, metafile: true, logLevel: 'silent' });
  const sourceHashes = {};
  for (const source of Object.keys(bundled.metafile.inputs).filter(name => name !== 'remote-root-owner-entry.js')) {
    sourceHashes[source] = createHash('sha256').update(await fs.readFile(path.resolve(projectRoot, source))).digest('hex');
  }
  return { sha256: createHash('sha256').update(await fs.readFile(file)).digest('hex'), sourceHashes };
}

export function remoteInstallCommand(fixture, serverNode, input, extensionsDir) {
  remote.assertInside(fixture.remoteAgentDir, serverNode);
  const serverCli = path.join(path.dirname(serverNode), 'bin/code-server');
  return { file: fixture.sshPath, args: ['-F', fixture.sshConfigPath, fixture.hostAlias,
    [serverCli, '--extensions-dir', extensionsDir, '--install-extension', input.vsixPath,
      '--force', '--do-not-include-pack-dependencies'].map(quote).join(' ')] };
}

async function runCommand(file, args, environment, logPath) {
  try {
    const { stdout, stderr } = await exec(file, args, { env: buildVSCodeChildEnv(environment), shell: false,
      timeout: 120000, maxBuffer: 4 * 1024 ** 2 });
    await writeJson(logPath, { file, args, code: 0, stdout, stderr });
  } catch (error) {
    await writeJson(logPath, { file, args, code: error.code, signal: error.signal,
      error: String(error), stdout: error.stdout, stderr: error.stderr });
    throw error;
  }
}

async function launch(options, observed) {
  const handle = await spawnPreparedVSCodeScenario(options);
  let timeout;
  try {
    await Promise.race([handle.completed, new Promise((resolve, reject) => {
      timeout = setTimeout(() => {
        observed.push({ role: 'original-code', pid: handle.child.pid, signal: 'SIGTERM', reason: 'phase-timeout' });
        handle.kill('SIGTERM');
        reject(new Error('Remote phase exceeded its fixed 300 second bound.'));
      }, 300000);
    })]);
  } finally { clearTimeout(timeout); }
}

async function prepareProbeDriver(projectRoot, targetRoot) {
  await fs.mkdir(targetRoot);
  await writeJson(path.join(targetRoot, 'package.json'), { name: 'execution-remote-probe-driver',
    publisher: 'devsessioncanvas-tests', version: '0.0.0', engines: { vscode: '^1.80.0' },
    main: './driver.cjs', activationEvents: [], extensionKind: ['workspace'] });
  await fs.writeFile(path.join(targetRoot, 'driver.cjs'), 'exports.activate = function activate() {};\n', { flag: 'wx' });
  await stageSmokeTestSuite({ projectRoot, targetRoot });
}

export async function runRemoteCandidate(values) {
  assert.equal(process.platform, 'linux'); assert.equal(process.arch, 'x64');
  const projectRoot = process.cwd();
  const output = path.resolve(values.output);
  await fs.mkdir(output);
  const runId = randomUUID();
  const clientRoots = [], forcedClientSignals = [];
  let fixture, productAttempted = false, productPassed = false, cleanup, failure;
  const firstFailure = async error => {
    if (failure) return;
    failure = error;
    await writeJson(path.join(output, 'first-failure.json'), { error: String(error), stack: error.stack });
  };
  const runtime = await prepareRuntime({ debugRoot: path.join(output, 'bootstrap'),
    runtimeDirName: `dsc-remote-candidate-${runId}-bootstrap` });
  clientRoots.push(runtime.userDataDir);
  const controlFile = path.join(output, 'control.json');
  try {
    const vscodeExecutablePath = await ensureVSCodeExecutable(projectRoot);
    const app = path.join(path.dirname(vscodeExecutablePath), 'resources/app');
    const desktopPackage = await readJson(path.join(app, 'package.json'));
    const product = await readJson(path.join(app, 'product.json'));
    assert.equal(desktopPackage.version, '1.117.0', 'Use the existing fixed VS Code input, not latest.');
    assert.match(product.commit, /^[a-f0-9]{40}$/);
    const installedInput = values.probe ? undefined
      : await prepareInstalledVsixInput(values['installed-vsix'], output, { runtimeName: 'node' });
    const sourceHashes = {};
    for (const file of ['scripts/smoke/run-vscode-remote-execution-candidate.mjs',
      'scripts/smoke/vscode-remote-ssh-fixture.mjs', 'scripts/smoke/installed-execution-candidate.mjs',
      'scripts/smoke/vscode-smoke-runner.mjs', 'tests/vscode-smoke/remote-execution-candidate-tests.cjs',
      'tests/vscode-smoke/remote-execution-candidate.cjs', 'tests/vscode-smoke/installed-execution-candidate.cjs',
      'tests/vscode-smoke/execution-candidate-tests.cjs']) {
      sourceHashes[file] = createHash('sha256').update(await fs.readFile(path.join(projectRoot, file))).digest('hex');
    }
    const workspacePath = path.join(output, 'probe-workspace');
    await fs.mkdir(workspacePath);
    const probeDriver = path.join(output, 'probe-driver');
    await prepareProbeDriver(projectRoot, probeDriver);
    const rootHelper = values['root-owner'] ? await prepareRemoteRootOwnerHelper(projectRoot, probeDriver) : undefined;
    await writeJson(path.join(output, 'input.json'), { schemaVersion: 1, runId,
      scope: values.probe ? 'Actual loopback Remote SSH Server Node probe; no product execution.'
        : values['root-owner'] ? 'Linux x64 actual loopback Remote SSH root-owner Terminal live-runtime complete/reopen; environment sampled in a product-absent Host without a canvas, then compared before product tests in two subsequent actual Hosts.'
          : 'Linux x64 loopback Remote SSH installed Terminal two modes complete/reopen; no Agent or all-A5 claim.',
      excluded: ['cross-machine network recovery', 'OS sleep or time adjustment', 'Windows Fast Startup'],
      rootOwner: values['root-owner'], modes: values.probe ? [] : remoteCandidateModes(values), rootHelper,
      vscodeVersion: desktopPackage.version, vscodeCommit: product.commit, vscodeExecutablePath,
      sourceHashes, vsixSha256: installedInput?.vsixSha256, automaticBuild: false, automaticRetry: false });
    fixture = await createRemoteSSHFixture({ debugRoot: output,
      hostAlias: `dsc-candidate-${runId}`, remoteRuntimeDirName: `dsc-remote-candidate-${runId}-server`,
      candidateControlFile: controlFile, observeCleanup: true, clientRoots,
      cleanupReportPath: path.join(output, 'fixture-cleanup.json') });
    const cli = path.join(path.dirname(vscodeExecutablePath), 'bin/code');
    await runCommand(cli, [`--user-data-dir=${runtime.userDataDir}`, `--extensions-dir=${runtime.extensionsDir}`,
      '--install-extension', 'ms-vscode-remote.remote-ssh', '--force'], runtime.environment,
    path.join(output, 'remote-extension-install.json'));
    const entries = await fs.readdir(runtime.extensionsDir, { withFileTypes: true });
    const remoteExtensions = ['ms-vscode-remote.remote-ssh', 'ms-vscode-remote.remote-ssh-edit', 'ms-vscode.remote-explorer'].map(id => {
      const entry = entries.find(item => item.isDirectory() && item.name.startsWith(`${id}-`));
      assert(entry, `Missing Remote extension ${id}.`);
      return path.join(runtime.extensionsDir, entry.name);
    });
    const remoteSettings = { 'security.workspace.trust.enabled': false,
      'remote.SSH.configFile': fixture.sshConfigPath, 'remote.SSH.useLocalServer': false,
      'remote.SSH.showLoginTerminal': false, 'remote.SSH.localServerDownload': 'always',
      'remote.SSH.remotePlatform': { [fixture.hostAlias]: 'linux' },
      'remote.SSH.serverInstallPath': { [fixture.hostAlias]: fixture.remoteAgentDir } };
    await writeUserSettings(runtime.userDataDir, remoteSettings);
    const toRemoteUri = file => `vscode-remote://${fixture.remoteAuthority}${encodeURI(file)}`;
    const baseControl = { schemaVersion: 1, vscodeVersion: desktopPackage.version, vscodeCommit: product.commit,
      serverRoot: await fs.realpath(fixture.remoteAgentDir), remoteAuthority: fixture.remoteAuthority, rootOwner: values['root-owner'] };
    const runPhase = async (activeRuntime, driver, control) => {
      await fs.writeFile(controlFile, `${JSON.stringify(control, null, 2)}\n`, { mode: 0o600 });
      await launch({ projectRoot, runtime: activeRuntime, vscodeExecutablePath,
        remoteAuthority: fixture.remoteAuthority, folderUri: toRemoteUri(control.workspacePath),
        extensionDevelopmentPath: [toRemoteUri(driver), ...remoteExtensions],
        extensionTestsPath: toRemoteUri(resolveStagedSmokeTestPath(driver, 'remote-execution-candidate-tests.cjs')),
        disableExtensions: false, disableWorkspaceTrust: true }, forcedClientSignals);
      const receipt = await readJson(path.join(control.artifactsDir, `${control.phase}-remote-host.json`));
      remote.assertRemoteHost(receipt, control);
      return receipt;
    };
    await writeJson(path.join(probeDriver, 'remote-control.json'), { schemaVersion: 1, controlFile });
    const probe = await runPhase(runtime, probeDriver, { ...baseControl, phase: 'probe',
      workspacePath: await fs.realpath(workspacePath), artifactsDir: runtime.artifactsDir });
    assert.equal(probe.productPresent, false);
    await writeJson(path.join(output, 'server-runtime.json'), probe);
    if (installedInput) {
      await remote.assertRemoteInstalledRuntime({ platform: probe.platform, arch: probe.arch,
        versions: probe.versions, report: { getReport: () => ({ header: { glibcVersionRuntime: probe.glibc } }) } },
      installedInput);
      const extensionsDir = path.join(probe.serverDataRoot, 'extensions');
      await fs.mkdir(extensionsDir, { recursive: true });
      const install = remoteInstallCommand(fixture, probe.executable, installedInput, extensionsDir);
      await runCommand(install.file, install.args, runtime.environment, path.join(output, 'remote-vsix-install.json'));
      for (const [index, mode] of remoteCandidateModes(values).entries()) {
        const activeRuntime = await prepareRuntime({ debugRoot: path.join(output, mode),
          runtimeDirName: `dsc-remote-candidate-${runId}-${index}`, userSettings: remoteSettings });
        clientRoots.push(activeRuntime.userDataDir);
        const workspace = path.join(activeRuntime.debugRoot, 'workspace');
        await fs.mkdir(path.join(workspace, '.vscode'), { recursive: true });
        await writeJson(path.join(workspace, '.vscode/settings.json'), {
          'devSessionCanvas.runtimePersistence.enabled': mode === 'live-runtime',
          'devSessionCanvas.terminal.shell': 'default', 'devSessionCanvas.terminal.shellPath': '/bin/sh',
          'terminal.integrated.scrollback': 100000 });
        const driverRoot = path.join(activeRuntime.debugRoot, 'test-driver');
        const driver = await prepareInstalledCandidateDriver({ projectRoot, targetRoot: driverRoot,
          input: installedInput, extensionsDir, artifactsDir: activeRuntime.artifactsDir });
        if (rootHelper) assert.deepEqual(await prepareRemoteRootOwnerHelper(projectRoot, driverRoot), rootHelper,
          'Each Remote Host must use the same frozen root environment helper.');
        await writeJson(path.join(driverRoot, 'remote-control.json'), { schemaVersion: 1, controlFile });
        let completed, completeHost;
        for (const phase of ['complete', 'reopen']) {
          productAttempted = true;
          const host = await runPhase(activeRuntime, driverRoot, { ...baseControl, phase, mode,
            workspacePath: await fs.realpath(workspace), artifactsDir: activeRuntime.artifactsDir,
            expectationPath: driver.expectationPath });
          assert.equal(host.executableSha256, probe.executableSha256, 'The actual Server Node input must remain fixed.');
          if (values['root-owner']) remote.assertRemoteEnvironmentStable(probe, host);
          const environment = await readJson(path.join(activeRuntime.artifactsDir, `${phase}-environment.json`));
          assert.equal(environment.mode, mode); assert.equal(environment.phase, phase);
          assert.equal(environment.pid, host.pid);
          receipts.assertInstalledExtensionReceipt(environment.installedVsix, driver.expectation);
          if (phase === 'complete') {
            if (values['root-owner']) {
              const binding = await readJson(path.join(activeRuntime.artifactsDir, 'root-owner-binding.json'));
              assert.equal(binding.owner.environmentKey, host.environmentKey,
                'The installed product binding must use the pre-Webview Remote execution environment.');
            }
            completeHost = host;
            completed = await readJson(path.join(activeRuntime.artifactsDir, 'completed.json'));
            await writeJson(path.join(activeRuntime.artifactsDir, 'source-applied-crosscheck.json'),
              remote.assertRemoteCompletion(completed, mode));
          } else {
            assert.notEqual(host.pid, completeHost.pid, 'Reopen must start a new actual Remote Extension Host.');
            const reopened = await readJson(path.join(activeRuntime.artifactsDir, 'reopened.json'));
            assert.equal(reopened.pass, true); assert.equal(reopened.mode, mode); assert.equal(reopened.id, completed.id);
            const result = await readJson(path.join(activeRuntime.artifactsDir, 'cleanup.json'));
            assert.equal(result.pass, true); assert.deepEqual(result.runtime.bindings, []);
          }
        }
      }
      productPassed = true;
    }
  } catch (error) {
    await firstFailure(error);
  } finally {
    try { cleanup = fixture ? await fixture.dispose() : await readJson(path.join(output, 'fixture-cleanup.json')).catch(() => undefined); }
    catch (error) { await firstFailure(error); }
    if (cleanup?.pass !== true) await firstFailure(new Error('Fixture cleanup was not confirmed.'));
    if (forcedClientSignals.length) await firstFailure(new Error('The original Code process required timeout cancellation.'));
    await writeJson(path.join(output, 'result.json'), { schemaVersion: 1,
      probeOnly: Boolean(values.probe), productAttempted,
      productPassed, forcedClientSignals, fixtureCleanup: cleanup,
      pass: !failure && cleanup?.pass === true && forcedClientSignals.length === 0 });
  }
  if (failure) throw failure;
  assert.equal(cleanup?.pass, true, 'Fixture cleanup must be observed separately from product success.');
  assert.equal(forcedClientSignals.length, 0, 'A timed-out Remote phase is not accepted.');
  console.log(`Remote ${values.probe ? 'Server Node probe' : values['root-owner']
    ? 'installed root-owner live-runtime Terminal' : 'installed two-mode Terminal matrix'} passed: ${output}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const values = parseRemoteSelection(process.argv.slice(2));
  if (shouldReRunInsideXvfb()) process.exit(runInsideXvfb(fileURLToPath(import.meta.url), process.cwd()));
  try { await runRemoteCandidate(values); }
  catch (error) { console.error(error.stack ?? String(error)); process.exitCode = 1; }
}
