import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { prepareMainSmokeHostExtension, prepareRuntime, resolveStagedSmokeTestPath,
  spawnPreparedVSCodeScenario } from './vscode-smoke-runner.mjs';

export function assertReaderIsolationSelection(values, platform = process.platform) {
  if (!values['reader-isolation']) return;
  assert.equal(platform, 'linux', 'Reader isolation selects the fixed Linux candidate only.');
  assert(values.mode === undefined && values['installed-vsix'] === undefined &&
    !values['capacity-calibration'] && !values['capacity-reconnect'] && values['capacity-sessions'] === undefined,
  'Reader isolation runs its two fixed cases without mode, installed or capacity selections.');
}

export function assertReaderIsolationReports(mode, reports) {
  assert(['live-runtime', 'snapshot-only'].includes(mode));
  assert.equal(reports.length, mode === 'live-runtime' ? 2 : 1);
  for (const report of reports) {
    assert.equal(report.pass, true);
    assert.equal(report.mode, mode);
    assert.equal(report.sourceDisposition.kind, 'eof');
    assert.equal(report.receipt.terminalWriteComplete, true);
    assert.equal(report.receipt.lineCount, 90000);
    assert.equal(report.receipt.bytesWritten, 5580102);
    assert.equal(report.receipt.sha256, 'e03d6d758493454da0946cc62e7c17fb2444e39afaa7639c8a88ad271eaff48f');
    assert.equal(report.receipt.executable, process.execPath);
    assert.deepEqual(report.receipt.versions, process.versions);
    assert.equal(report.receipt.pid, report.gate.identity.pid);
    assert.equal(report.completeBufferVerified, true);
    assert.equal(report.finalTerminal.terminalCursorX, 6);
    assert.equal(report.finalTerminal.terminalCursorY, 2);
    assert.equal(report.initialReader.executionId, report.executionId);
    assert.equal(report.finalReader.executionId, report.executionId);
    assert.equal(typeof report.executionId, 'string');
    assert(report.executionId.length > 0);
    assert.equal(report.settlement.outcome.kind, 'applied');
    assert(Number.isSafeInteger(report.finalRevision) && report.finalRevision >= 0);
    assert.equal(mode === 'live-runtime' ? report.settlement.outcome.finalRevision
      : report.settlement.outcome.finalOutputSequence, report.finalRevision);
  }
  const owner = reports.find(report => report.role === 'owner');
  assert(owner);
  assert.deepEqual(owner.transitions.map(transition => transition.after.surface),
    mode === 'live-runtime' ? ['panel', 'editor'] : ['editor']);
  assert.deepEqual(owner.transitions[0].before, owner.initialReader);
  assert.deepEqual(owner.transitions.at(-1).after, owner.finalReader);
  for (const [index, transition] of owner.transitions.entries()) {
    if (index) assert.deepEqual(transition.before, owner.transitions[index - 1].after);
    assert.notDeepEqual(transition.before.lifecycle, transition.after.lifecycle);
    assert.equal(transition.after.executionId, owner.executionId);
    if (mode === 'live-runtime') assert.notEqual(transition.before.readId, transition.after.readId);
  }
  if (mode === 'live-runtime') {
    const attacher = reports.find(report => report.role === 'attacher');
    assert(attacher);
    assert.notEqual(owner.hostPid, attacher.hostPid);
    assert.equal(owner.nodeId, attacher.nodeId);
    assert.equal(owner.executionId, attacher.executionId);
    assert.equal(owner.finalReader.authorityId, attacher.finalReader.authorityId);
    for (const report of reports) {
      assert.equal(report.initialReader.authorityId, report.finalReader.authorityId);
      assert.equal(typeof report.finalReader.authorityId, 'string');
      assert.equal(typeof report.finalReader.readId, 'string');
    }
    assert.notEqual(owner.initialReader.readId, attacher.initialReader.readId);
    assert.equal(attacher.initialReader.readId, attacher.finalReader.readId);
    assert.equal(attacher.settlement.readId, attacher.initialReader.readId);
    assert.equal(owner.settlement.readId, owner.finalReader.readId);
    assert.equal(owner.finalRevision, attacher.finalRevision);
    assert.equal(owner.gate.gateId, attacher.gate.gateId);
    assert.equal(owner.noHistory, true);
    assert.equal(attacher.noHistory, true);
    assert.deepEqual(attacher.transitions, []);
  } else {
    assert(owner.savedSnapshotBytes > 5 * 1024 ** 2);
  }
}

const READER_STORAGE_LOCK_NAMES = new Set([
  'SingletonCookie', 'SingletonLock', 'SingletonSocket', 'lockfile'
]);

function isContainedPath(root, child) {
  const relative = path.relative(root, child);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function shouldSkipReaderStorageEntry(name) {
  return READER_STORAGE_LOCK_NAMES.has(name) || name === 'state.vscdb' || name.startsWith('state.vscdb-') ||
    name.endsWith('.lock');
}

async function hashReaderStorageSnapshot(directory) {
  const entries = [];
  async function visit(current, relative = '') {
    const children = (await fs.readdir(current, { withFileTypes: true }))
      .sort((left, right) => left.name.localeCompare(right.name, 'en'));
    for (const entry of children) {
      const entryRelative = path.join(relative, entry.name);
      if (shouldSkipReaderStorageEntry(entry.name)) continue;
      const entryPath = path.join(current, entry.name);
      const stat = await fs.lstat(entryPath);
      if (stat.isSymbolicLink()) throw new Error(`Reader storage cannot contain symlinks: ${entryRelative}`);
      if (stat.isDirectory()) await visit(entryPath, entryRelative);
      else if (stat.isFile()) entries.push({ path: entryRelative, sha256: createHash('sha256').update(await fs.readFile(entryPath)).digest('hex') });
      else if (stat.isSocket()) continue;
      else throw new Error(`Reader storage contains an unsupported entry: ${entryRelative}`);
    }
  }
  await visit(directory);
  return createHash('sha256').update(JSON.stringify(entries)).digest('hex');
}

/** Copy only the extension's durable snapshot into the second Host's storage slot. */
export async function copyReaderIsolationExtensionStorage({ sourceStoragePath, sourceUserDataDir, targetUserDataDir }) {
  const sourceUserData = await fs.realpath(sourceUserDataDir);
  const source = await fs.realpath(sourceStoragePath);
  if (!isContainedPath(sourceUserData, source)) throw new Error('Reader storage source escaped the owner user-data directory.');
  const relative = path.relative(sourceUserData, source);
  const parts = relative.split(path.sep);
  if (parts.length < 4 || parts[0] !== 'User' || parts[1] !== 'workspaceStorage') {
    throw new Error('Reader storage source is not an extension workspace-storage slot.');
  }
  const targetUserData = await fs.realpath(targetUserDataDir);
  const target = path.resolve(targetUserData, relative);
  if (!isContainedPath(targetUserData, target)) throw new Error('Reader storage target escaped the attacher user-data directory.');
  try {
    await fs.lstat(target);
    throw new Error('Reader storage target already exists.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const snapshotPath = path.join(source, 'canvas-state.json');
  const snapshotStat = await fs.lstat(snapshotPath);
  if (!snapshotStat.isFile()) throw new Error('Reader storage snapshot is missing or not a regular file.');
  const sourceHash = await hashReaderStorageSnapshot(source);
  const temporary = `${target}.reader-isolation-${process.pid}-${randomUUID()}`;
  await fs.mkdir(path.dirname(temporary), { recursive: true });
  try {
    async function copy(current, destination) {
      const children = await fs.readdir(current, { withFileTypes: true });
      for (const entry of children) {
        if (shouldSkipReaderStorageEntry(entry.name)) continue;
        const sourceEntry = path.join(current, entry.name);
        const targetEntry = path.join(destination, entry.name);
        const stat = await fs.lstat(sourceEntry);
        if (stat.isSymbolicLink()) throw new Error(`Reader storage cannot contain symlinks: ${entry.name}`);
        if (stat.isDirectory()) {
          await fs.mkdir(targetEntry, { recursive: true });
          await copy(sourceEntry, targetEntry);
        } else if (stat.isFile()) {
          await fs.copyFile(sourceEntry, targetEntry, fs.constants.COPYFILE_EXCL);
        } else if (stat.isSocket()) continue;
        else throw new Error(`Reader storage contains an unsupported entry: ${entry.name}`);
      }
    }
    await fs.mkdir(temporary, { recursive: true });
    await copy(source, temporary);
    await fs.rename(temporary, target);
  } catch (error) {
    await fs.rm(temporary, { recursive: true, force: true });
    throw error;
  }
  const targetHash = await hashReaderStorageSnapshot(target);
  if (targetHash !== sourceHash) throw new Error('Reader storage copy hash does not match its source.');
  return { mode: 'frozen-owner-flush-before-attacher-start', sourcePath: source, targetPath: target,
    relativePath: relative, sourceHash, targetHash, concurrentWorkspacePersistenceClaim: false };
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function readJson(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
}
async function publish(file, value) {
  const pending = `${file}.${process.pid}.pending`;
  await fs.writeFile(pending, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
  await fs.link(pending, file);
  await fs.unlink(pending);
}

export async function runReaderIsolation({ projectRoot, output, runId, vscodeExecutablePath, manifest, sourceHashes }) {
  assert.equal(manifest.profile, 'linux-owner-v1-candidate');
  assert.equal(manifest.platform, 'linux');
  for (const file of ['scripts/smoke/execution-reader-isolation.mjs', 'scripts/smoke/vscode-smoke-runner.mjs',
    'tests/vscode-smoke/execution-reader-isolation-tests.cjs']) {
    sourceHashes[file] = createHash('sha256').update(await fs.readFile(path.join(projectRoot, file))).digest('hex');
  }
  const selectionBytes = await fs.readFile(path.join(projectRoot,
    'extensions/vscode/dev-session-canvas/dist/execution-candidate-selection.json'));
  const selection = JSON.parse(selectionBytes);
  assert.equal(selection.profile, manifest.profile);
  sourceHashes['execution-candidate-selection.json'] = createHash('sha256').update(selectionBytes).digest('hex');
  await publish(path.join(output, 'input.json'), { schemaVersion: 1,
    scope: 'A3 fixed Linux real surface switch and cross-Host reader isolation; not slow-consumer or full A3 acceptance',
    vscodeExecutablePath, subjectExecutable: process.execPath, subjectVersions: process.versions,
    assetManifest: manifest, selection, sourceHashes,
    lineCount: 90000, scrollback: 100000, gateAfterLine: 45000, gateTimeoutMs: 60000,
    observationBudgetsMs: { verified: 180000, cleanupReport: 60000, cleanupCoordinator: 250000,
      cleanupOperations: 50000, hostExitGrace: 30000, hostForcedExit: 10000 },
    scenarios: [{ mode: 'live-runtime', roles: ['owner', 'attacher'],
      surfaces: { owner: ['editor', 'panel', 'editor'], attacher: ['panel'] },
      storageHandoff: { kind: 'owner-extension-storage-snapshot', source: 'owner-ready.storage.extensionStoragePath',
        target: 'attacher.userDataDir/<same User/workspaceStorage slot>/devsessioncanvas', hash: 'sha256',
        concurrentWorkspacePersistenceClaim: false } },
    { mode: 'snapshot-only', roles: ['owner'], surfaces: { owner: ['panel', 'editor'] } }],
    automaticRetries: 0, businessPrivateStateInjection: false, remoteCancellationAckClaim: false });

  for (const [index, mode] of ['live-runtime', 'snapshot-only'].entries()) {
    const caseRoot = path.join(output, mode);
    const shared = path.join(caseRoot, 'shared');
    const workspacePath = path.join(caseRoot, 'workspace');
    await fs.mkdir(shared, { recursive: true });
    await fs.mkdir(workspacePath);
    const roles = mode === 'live-runtime' ? ['owner', 'attacher'] : ['owner'];
    const runtimes = new Map();
    // Prepare both before launch: prepareRuntime recreates the shared runtime directory.
    for (const role of roles) {
      runtimes.set(role, await prepareRuntime({ projectRoot, debugRoot: path.join(caseRoot, role),
        runtimeDirName: `dsc-readers-${runId}-${index}`, userSettings: {
          'security.workspace.trust.enabled': false,
          'devSessionCanvas.runtimePersistence.enabled': mode === 'live-runtime',
          'devSessionCanvas.terminal.shell': 'default', 'devSessionCanvas.terminal.shellPath': '/bin/sh',
          'terminal.integrated.scrollback': 100000 } }));
    }
    const smokeHostRoot = await prepareMainSmokeHostExtension({ projectRoot,
      targetRoot: path.join(caseRoot, 'smoke-host') });
    const handles = new Map();
    let failure;
    async function waitForFile(name, timeoutMs = 120000, checkFailures = true) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const value = await readJson(path.join(shared, name));
        if (value) return value;
        if (checkFailures) {
          for (const [role, running] of handles) {
            const failed = await readJson(path.join(shared, `${role}-failure.json`));
            if (failed) throw new Error(`${mode}/${role} failed: ${failed.error}`);
            if (running.result) throw new Error(`${mode}/${role} exited before ${name}.`);
          }
        }
        await sleep(50);
      }
      throw new Error(`Timed out waiting for ${mode}/${name}.`);
    }
    try {
      for (const role of roles) {
        let storageCopy;
        if (role === 'attacher') {
          const ownerReady = await waitForFile('owner-ready.json');
          storageCopy = await copyReaderIsolationExtensionStorage({
            sourceStoragePath: ownerReady.storage.extensionStoragePath,
            sourceUserDataDir: runtimes.get('owner').userDataDir,
            targetUserDataDir: runtimes.get('attacher').userDataDir
          });
          await publish(path.join(shared, 'attacher-storage-ready.json'), storageCopy);
          await publish(path.join(caseRoot, 'reader-storage-copy.json'), storageCopy);
        }
        const handle = await spawnPreparedVSCodeScenario({ projectRoot, runtime: runtimes.get(role),
          vscodeExecutablePath, workspacePath, extensionDevelopmentPath: smokeHostRoot,
          extensionTestsPath: resolveStagedSmokeTestPath(smokeHostRoot, 'execution-reader-isolation-tests.cjs'),
          disableExtensions: false, disableWorkspaceTrust: true, extraLaunchArgs: ['--new-window'],
          extensionTestsEnv: { DEV_SESSION_CANVAS_READER_MODE: mode, DEV_SESSION_CANVAS_READER_ROLE: role,
            DEV_SESSION_CANVAS_READER_SHARED: shared, DEV_SESSION_CANVAS_CANDIDATE_SUBJECT_NODE: process.execPath,
            ...(storageCopy ? { DEV_SESSION_CANVAS_READER_STORAGE_COPY: JSON.stringify(storageCopy) } : {}) } });
        const running = { handle, result: undefined };
        running.finished = handle.completed.then(() => { running.result = { ok: true }; },
          error => { running.result = { ok: false, error: String(error) }; });
        handles.set(role, running);
      }
      const reports = [];
      for (const role of roles) reports.push(await waitForFile(`${role}-verified.json`, 180000));
      assertReaderIsolationReports(mode, reports);
      await publish(path.join(caseRoot, 'verified.json'), { mode, reports, pass: true });
    } catch (error) {
      failure = error;
      await publish(path.join(shared, 'abort.json'), { error: String(error) });
      await publish(path.join(caseRoot, 'first-failure.json'), { error: String(error), automaticRetries: 0 });
    } finally {
      const cleanup = [];
      // A shared root is written by one reset at a time, including on failure.
      for (const role of [...handles.keys()].reverse()) {
        try {
          await publish(path.join(shared, `cleanup-${role}.json`), { requested: true });
          const report = await waitForFile(`${role}-cleanup.json`, 60000, false);
          cleanup.push({ role, ...report });
          assert.equal(report.pass, true, `${mode}/${role} cleanup must be confirmed.`);
        } catch (error) {
          cleanup.push({ role, pass: false, error: String(error) });
          failure ??= error;
        }
      }
      for (const [role, running] of handles) {
        const host = await settleHost(running);
        cleanup.push({ role, host });
        if (!host.launcherResult?.ok || !host.processExitObserved || host.forcedSignal) {
          failure ??= new Error(`${mode}/${role} Host completion was not confirmed without force.`);
        }
      }
      await publish(path.join(caseRoot, 'cleanup.json'), { pass: !failure, cleanup });
    }
    if (failure) throw failure;
  }
  console.log(`Finite real reader isolation passed: ${output}`);
}

async function settleHost(running) {
  const waitForResult = async timeoutMs => {
    const deadline = Date.now() + timeoutMs;
    while (!running.result && Date.now() < deadline) await sleep(Math.min(50, deadline - Date.now()));
  };
  const child = running.handle.child;
  const exited = () => Number.isInteger(child.exitCode) || typeof child.signalCode === 'string';
  await waitForResult(30000);
  let forcedSignal, killAccepted, killError;
  if (!running.result) {
    if (!exited() && Number.isInteger(child.pid)) {
      forcedSignal = 'SIGKILL';
      try { killAccepted = child.kill(forcedSignal); }
      catch (error) { killError = String(error); }
    }
    // The launcher also archives logs on failure; its promise is not a process-exit observation.
    await waitForResult(10000);
  }
  return { processExitObserved: exited(), exitCode: child.exitCode, signal: child.signalCode,
    launcherResult: running.result ?? null, forcedSignal, killAccepted, killError,
    subjectExitClaim: false };
}
