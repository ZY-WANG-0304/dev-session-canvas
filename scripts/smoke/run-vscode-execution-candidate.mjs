import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { build } from 'esbuild';
import capacityFormat from '../../tests/vscode-smoke/fixtures/execution-capacity-subject.cjs';
import { ensureVSCodeExecutable, launchPreparedVSCodeScenario, prepareMainSmokeHostExtension,
  prepareRuntime, resolveStagedSmokeTestPath, runInsideXvfb, shouldReRunInsideXvfb } from './vscode-smoke-runner.mjs';

const projectRoot = process.cwd();
const { values } = parseArgs({ options: { output: { type: 'string' }, mode: { type: 'string' },
  'capacity-sessions': { type: 'string' },
  'capacity-reconnect': { type: 'boolean', default: false },
  'capacity-calibration': { type: 'boolean', default: false } } });
const capacitySelected = values['capacity-calibration'] || values['capacity-reconnect'];
assert(['linux', 'darwin'].includes(process.platform), 'This finite product acceptance requires Linux or macOS.');
assert(!capacitySelected || process.platform === 'linux', 'The fixed capacity workload requires Linux process identity observation.');
assert(values.output, 'Specify a new --output evidence directory.');
assert(values.mode === undefined || ['live-runtime', 'snapshot-only'].includes(values.mode), 'Unknown mode.');
assert(!capacitySelected || values.mode === undefined,
  'Capacity calibration is a separate fixed live-runtime selection.');
assert(!(values['capacity-calibration'] && values['capacity-reconnect']), 'Select one fixed capacity workload.');
assert(!values['capacity-reconnect'] || values['capacity-sessions'] === undefined,
  'Host reconnect uses its fixed two-session workload.');
assert(values['capacity-sessions'] === undefined || (values['capacity-calibration'] &&
  ['2', '10'].includes(values['capacity-sessions'])), 'Select --capacity-calibration with --capacity-sessions=2 or 10.');
const modes = values.mode ? [values.mode] : ['live-runtime', 'snapshot-only'];
if (shouldReRunInsideXvfb()) process.exit(runInsideXvfb(fileURLToPath(import.meta.url), projectRoot));
const output = path.resolve(values.output);
await fs.mkdir(output);
const runId = randomUUID();
const vscodeExecutablePath = await ensureVSCodeExecutable(projectRoot);
const dist = path.join(projectRoot, 'extensions/vscode/dev-session-canvas/dist');
const platformName = process.platform === 'darwin' ? 'macos' : 'linux';
const assetTarget = process.platform === 'darwin' ? `darwin-${process.arch}` : 'linux-x64-glibc';
const manifest = JSON.parse(await fs.readFile(path.join(dist,
  `native/${platformName}-execution-candidate/${assetTarget}/manifest.json`), 'utf8'));
assert.equal(manifest.runtime.name, 'electron', 'Use the matching Electron candidate build, not a Node addon.');
assert.equal(manifest.profile, `${platformName}-owner-v1-candidate`);
assert.equal(manifest.platform, process.platform);
assert.equal(manifest.arch, process.arch);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceHashes = {};
for (const file of ['extension.js', 'runtime-supervisor.js', `${platformName}-execution-provider.js`, 'webview.js']) {
  sourceHashes[file] = hash(await fs.readFile(path.join(dist, file)));
}
for (const file of ['scripts/smoke/run-vscode-execution-candidate.mjs',
  'tests/vscode-smoke/execution-candidate-tests.cjs',
  'tests/vscode-smoke/fixtures/execution-candidate-subject.cjs']) {
  sourceHashes[file] = hash(await fs.readFile(path.join(projectRoot, file)));
}
if (capacitySelected) {
  await runCapacityCalibration();
  process.exit(0);
}
await fs.writeFile(path.join(output, 'input.json'), `${JSON.stringify({
  schemaVersion: 1, scope: `A2/A3 finite ${process.platform} two-mode real Terminal and actual Electron Webview; not A4/A5 closure`,
  vscodeExecutablePath, subjectExecutable: process.execPath, subjectVersions: process.versions,
  assetManifest: manifest, sourceHashes, lineCount: 90000, scrollback: 100000,
  partialSelection: values.mode !== undefined,
  scenarios: modes.map(mode => ({ mode, surface: mode === 'live-runtime' ? 'editor' : 'panel' }))
}, null, 2)}\n`);

for (const [index, mode] of modes.entries()) {
  const debugRoot = path.join(output, mode);
  const runtime = await prepareRuntime({ projectRoot, debugRoot,
    runtimeDirName: `dsc-candidate-${runId}-${index}`,
    userSettings: { 'security.workspace.trust.enabled': false,
      'devSessionCanvas.runtimePersistence.enabled': mode === 'live-runtime',
      'devSessionCanvas.terminal.shell': 'default', 'devSessionCanvas.terminal.shellPath': '/bin/sh',
      'terminal.integrated.scrollback': 100000 } });
  const workspacePath = path.join(debugRoot, 'workspace');
  await fs.mkdir(workspacePath);
  const smokeHostRoot = await prepareMainSmokeHostExtension({ projectRoot, targetRoot: path.join(debugRoot, 'smoke-host') });
  try {
    for (const phase of ['complete', 'reopen']) {
      await launchPreparedVSCodeScenario({ projectRoot, runtime, vscodeExecutablePath, workspacePath,
        extensionDevelopmentPath: smokeHostRoot,
        extensionTestsPath: resolveStagedSmokeTestPath(smokeHostRoot, 'execution-candidate-tests.cjs'),
        disableExtensions: false, disableWorkspaceTrust: true,
        extensionTestsEnv: { DEV_SESSION_CANVAS_CANDIDATE_MODE: mode,
          DEV_SESSION_CANVAS_CANDIDATE_PHASE: phase,
          DEV_SESSION_CANVAS_CANDIDATE_SUBJECT_NODE: process.execPath } });
    }
  } catch (error) {
    await fs.writeFile(path.join(output, 'first-failure.json'), `${JSON.stringify({ mode, error: String(error) }, null, 2)}\n`);
    throw error;
  }
}
console.log(`Finite real Electron candidate acceptance passed: ${output}`);

async function runCapacityCalibration() {
  const reconnect = values['capacity-reconnect'];
  const scenarios = reconnect ? ['color'] : ['color', 'size'];
  const workload = capacityFormat.capacityWorkload(Number(values['capacity-sessions'] ?? 2));
  const selectionBytes = await fs.readFile(path.join(dist, 'execution-candidate-selection.json'));
  const selection = JSON.parse(selectionBytes);
  assert.equal(selection.schemaVersion, 1);
  assert.equal(selection.profile, manifest.profile);
  assert.deepEqual(selection.admissionLimits, { executions: workload.sessionCount, starting: 1 },
    'Build the matching explicit admission selection before running this workload.');
  sourceHashes['execution-candidate-selection.json'] = hash(selectionBytes);
  const helperSources = ['src/common/runtimeSupervisorPaths.ts', 'src/common/serializedTerminalState.ts',
    'src/supervisor/terminalSessionJournal.ts'];
  for (const file of ['tests/vscode-smoke/execution-capacity-tests.cjs',
    'tests/vscode-smoke/fixtures/execution-capacity-subject.cjs',
    ...helperSources.map(file => `extensions/vscode/dev-session-canvas/${file}`)]) {
    sourceHashes[file] = hash(await fs.readFile(path.join(projectRoot, file)));
  }
  const helper = await build({ stdin: { contents: helperSources.map(file => `export * from './${file}';`).join('\n'),
    resolveDir: path.join(projectRoot, 'extensions/vscode/dev-session-canvas'), loader: 'ts' },
    bundle: true, platform: 'node', format: 'cjs', target: 'node22', write: false });
  const helperBytes = helper.outputFiles[0].contents;
  await fs.writeFile(path.join(output, 'input.json'), `${JSON.stringify({ schemaVersion: 1,
    scope: 'A1 finite Linux real Electron fixed Terminal workload; not complete A1 or a general product memory budget',
    runId, vscodeExecutablePath, subjectExecutable: process.execPath, subjectVersions: process.versions,
    assetManifest: manifest, selection, sourceHashes, helperSha256: hash(helperBytes), scenarios,
    cumulativeBlocks: [640, 1280, 2560], terminalEncodedBlockBytes: 10240, scrollback: 100000,
    sampleMs: 250, idleBaselineMs: 5000, hideMs: 5000, interactionObservationMs: 1500,
    catchupMs: 30000, caseSafetyMs: 600000, ...workload,
    ...(reconnect ? { phases: ['detach', 'reconnect'], offlineBlocks: 2560,
      overlapAcceptance: 'v2: one actual B response applied within 1500ms with 0 < loadLastBlockBefore <= loadLastBlockAfter < 2560 in the same Webview action; catchup deadline is not reset',
      absoluteRssSafetyBytes: 5 * 1024 ** 3,
      triggerRule: 'Only after the original Extension Host identity is gone; retain original runtime and bindings.' } : {}),
    limitsScope: 'Workload-specific observation and experiment safety only; not a product session limit or general SLA.',
    oldAcceptance: reconnect ? 'Only A1/A2 live Host reconnect selected; not completed reopen or A3 closure.'
      : 'A2/A3 not selected and not combined into this result.' }, null, 2)}\n`);
  for (const [index, scenario] of scenarios.entries()) {
    const debugRoot = path.join(output, scenario);
    const runtime = await prepareRuntime({ projectRoot, debugRoot,
      runtimeDirName: `dsc-capacity-${runId}-${index}`, userSettings: {
        'security.workspace.trust.enabled': false, 'devSessionCanvas.runtimePersistence.enabled': true,
        'devSessionCanvas.terminal.shell': 'default', 'devSessionCanvas.terminal.shellPath': '/bin/sh',
        'terminal.integrated.scrollback': 100000 } });
    const workspacePath = path.join(debugRoot, 'workspace');
    await fs.mkdir(workspacePath);
    const smokeHostRoot = await prepareMainSmokeHostExtension({ projectRoot,
      targetRoot: path.join(debugRoot, 'smoke-host') });
    await fs.writeFile(resolveStagedSmokeTestPath(smokeHostRoot, 'execution-capacity-runtime.cjs'), helperBytes);
    try {
      const launch = phase => launchPreparedVSCodeScenario({ projectRoot, runtime, vscodeExecutablePath, workspacePath,
        extensionDevelopmentPath: smokeHostRoot,
        extensionTestsPath: resolveStagedSmokeTestPath(smokeHostRoot, 'execution-capacity-tests.cjs'),
        disableExtensions: false, disableWorkspaceTrust: true,
        extensionTestsEnv: { DEV_SESSION_CANVAS_CAPACITY_SCENARIO: scenario,
          ...(phase ? { DEV_SESSION_CANVAS_CAPACITY_PHASE: phase } : {}),
          DEV_SESSION_CANVAS_CAPACITY_SESSIONS: String(workload.sessionCount),
          DEV_SESSION_CANVAS_CAPACITY_SUBJECT_NODE: process.execPath } });
      if (reconnect) await runCapacityReconnect(runtime, launch);
      else await launch();
    } catch (error) {
      await fs.writeFile(path.join(output, 'first-failure.json'), `${JSON.stringify({ scenario,
        error: String(error), automaticRetries: 0 }, null, 2)}\n`);
      throw error;
    }
  }
  console.log(`Finite A1 calibration completed (A1 remains open): ${output}`);
}

async function readIdentity(pid) {
  assert(Number.isSafeInteger(pid) && pid > 1, 'Only a recorded process identity is eligible.');
  try {
    const stat = await fs.readFile(`/proc/${pid}/stat`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    return { pid, ppid: Number(fields[1]), state: fields[0], startTicks: fields[19],
      executable: await fs.readlink(`/proc/${pid}/exe`).catch(error => {
        if (error.code === 'ENOENT') return null; throw error;
      }) };
  } catch (error) { if (['ENOENT', 'ESRCH'].includes(error.code)) return undefined; throw error; }
}

function sameLiveIdentity(current, original) {
  return current?.startTicks === original.startTicks && !['Z', 'X'].includes(current.state);
}

async function waitForRecordedExit(original, timeoutMs = 10000) {
  const deadline = performance.now() + timeoutMs;
  do {
    if (!sameLiveIdentity(await readIdentity(original.pid), original)) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  } while (performance.now() < deadline);
  throw new Error(`Recorded process ${original.pid} did not exit within ${timeoutMs}ms.`);
}

async function runCapacityReconnect(runtime, launch) {
  const write = (name, data) => fs.writeFile(path.join(runtime.artifactsDir, `${name}.json`), `${JSON.stringify(data, null, 2)}\n`);
  const read = name => fs.readFile(path.join(runtime.artifactsDir, `${name}.json`), 'utf8').then(JSON.parse);
  let detached;
  const owned = [];
  let failure;
  const recoverCleanupResponsibility = async () => {
    if (detached) return;
    detached = await read('detach-ready');
    for (const subject of detached.subjects) {
      const storage = await fs.realpath(subject.metadata.runtimeStoragePath);
      const isolatedRoot = await fs.realpath(runtime.userDataDir);
      assert(storage.startsWith(`${isolatedRoot}${path.sep}`), 'Reconnect may only reuse this run-owned storage.');
    }
    owned.push(detached.supervisor);
    const providers = detached.processes.filter(entry => entry.role === 'provider');
    const confirmedProviders = [];
    const ownershipFailures = [];
    for (const provider of providers) {
      if (provider.ppid === detached.supervisor.pid) {
        owned.unshift(provider);
        confirmedProviders.push(provider);
      } else ownershipFailures.push(`Unconfirmed provider ${provider.pid}.`);
    }
    for (const subject of detached.subjects) {
      if (confirmedProviders.some(provider => provider.pid === subject.identity.ppid)) owned.unshift(subject.identity);
      else ownershipFailures.push(`Unconfirmed subject ${subject.identity.pid}.`);
    }
    assert.equal(providers.length, 2);
    assert.equal(detached.subjects.length, 2);
    assert.deepEqual(ownershipFailures, []);
  };
  try {
    await launch('detach');
    await recoverCleanupResponsibility();
    await waitForRecordedExit(detached.hostIdentity);
    for (const original of owned) {
      const current = await readIdentity(original.pid);
      assert(sameLiveIdentity(current, original) && current.executable === original.executable,
        'The original Supervisor, providers and subjects must survive Host departure.');
    }
    const before = await read('subject-a');
    assert.equal(before.blocks, 0, 'Offline output must not precede Host exit confirmation.');
    const hostExitConfirmedAt = new Date().toISOString();
    const trigger = path.join(runtime.artifactsDir, 'offline-trigger.json');
    await fs.writeFile(`${trigger}.tmp`, JSON.stringify({ blocks: 2560 }), { flag: 'wx' });
    await fs.rename(`${trigger}.tmp`, trigger);
    const deadline = performance.now() + 30000;
    let receipt;
    do {
      receipt = await read('subject-a');
      if (receipt.state === 'stage-complete' && receipt.blocks === 2560) break;
      assert(!['error', 'safety-timeout'].includes(receipt.state), JSON.stringify(receipt));
      await new Promise(resolve => setTimeout(resolve, 50));
    } while (performance.now() < deadline);
    assert.equal(receipt.blocks, 2560, 'The original subject must finish the fixed offline writes.');
    assert.equal(receipt.state, 'stage-complete');
    await write('offline-output', { hostExitConfirmedAt, completedAt: new Date().toISOString(),
      oldHost: detached.hostIdentity, receipt, pass: true });
    await launch('reconnect');
    assert.equal((await read('reconnect-cleanup')).pass, true);
  } catch (error) {
    failure = error;
    await write('outer-first-failure', { error: String(error), stack: error.stack, automaticRetries: 0 });
  } finally {
    const cleanup = { pass: true, scope: 'Outer transferred-identity cleanup only; phase cleanup reports remain independent.',
      productCleanupAttempted: false, forcedSignals: [], failures: [] };
    if (!detached && failure) {
      try { await recoverCleanupResponsibility(); }
      catch (error) { if (error.code !== 'ENOENT') cleanup.failures.push(String(error)); }
    }
    // A failed second launch cannot delegate cleanup to an Extension Host that never started.
    if (detached && failure) {
      if (sameLiveIdentity(await readIdentity(detached.hostIdentity.pid), detached.hostIdentity)) {
        cleanup.failures.push('Original Host remains live; do not start another Host on the same user-data directory.');
      } else {
        cleanup.productCleanupAttempted = true;
        try { await launch('cleanup'); assert.equal((await read('cleanup-cleanup')).pass, true); }
        catch (error) { cleanup.failures.push(String(error)); }
      }
    }
    for (const original of owned) {
      const current = await readIdentity(original.pid);
      if (!sameLiveIdentity(current, original)) continue;
      if (current.executable !== original.executable) {
        cleanup.failures.push(`Changed executable for ${original.pid}; not signalled.`);
        continue;
      }
      try {
        process.kill(original.pid, 'SIGKILL');
        cleanup.forcedSignals.push({ pid: original.pid, startTicks: original.startTicks, signal: 'SIGKILL' });
        await waitForRecordedExit(original, 5000);
      } catch (error) { if (error.code !== 'ESRCH') cleanup.failures.push(String(error)); }
    }
    cleanup.pass = cleanup.forcedSignals.length === 0 && cleanup.failures.length === 0;
    await write('outer-cleanup', cleanup);
    if (!cleanup.pass && !failure) failure = new Error('Reconnect required non-product cleanup; original evidence retained.');
  }
  if (failure) throw failure;
}
