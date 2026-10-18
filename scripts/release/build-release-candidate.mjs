import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import JSZip from 'jszip';
import { assembleExecutionDistributionAssets } from '../build/assemble-execution-distribution-assets.mjs';
import { assertFormalEnvironment, validateFrozenPlan } from '../gates/resolve-plan.mjs';
import { digest, fileDigest, objectDigest, producerFor, readJSON, verifyPackageFiles, writeJSON } from '../gates/receipts.mjs';
import { npmCommand, runProcess } from '../gates/process.mjs';
import { assertCheckout } from '../gates/run-task.mjs';
import { withinDeadline } from '../gates/deadline.mjs';
import { assertRuntimeFileList, assertSafeVsixEntry } from './vsix-file-list.mjs';

export async function retireCandidateCheckout(work, original, deadline) {
  assert(!original?.unsettled, 'Candidate action has not settled; concurrent checkout cleanup refused');
  const cleanupStartedAt = new Date().toISOString();
  await withinDeadline('Clean candidate checkout retirement', deadline,
    () => fs.rm(work, { recursive: true, force: true }));
  const cleanupCompletedAt = new Date().toISOString();
  return { cleanupStartedAt, cleanupCompletedAt, cleanupDeadline: deadline };
}

export async function treeHashes(directory) {
  const files = [];
  const visit = async root => {
    for (const entry of await fs.readdir(root, { withFileTypes: true })) {
      const file = path.join(root, entry.name);
      assert(!entry.isSymbolicLink(), 'Build payload must not contain redirected files');
      if (entry.isDirectory()) await visit(file);
      else files.push({ path: path.relative(directory, file).split(path.sep).join('/'), sha256: await fileDigest(file) });
    }
  };
  await visit(directory);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

export async function inspectVsix(file, expectedID, version, { production = true } = {}) {
  const bytes = await fs.readFile(file); const zip = await JSZip.loadAsync(bytes);
  const manifestFile = zip.file('extension/package.json'); assert(manifestFile, 'VSIX has no extension manifest');
  const manifest = JSON.parse(await manifestFile.async('string'));
  assert.equal(`${manifest.publisher}.${manifest.name}`, expectedID); assert.equal(manifest.version, version);
  assert.equal(manifest.main, './dist/extension.js', 'Production package main must remain the real entry point');
  assert(!manifest.scripts, 'Package staging must strip build lifecycle hooks');
  const required = expectedID.endsWith('-notifier')
    ? ['dist/extension.js', 'images/icon.png', 'images/activitybar.svg', 'package.nls.json', 'package.nls.zh-cn.json',
      'l10n/bundle.l10n.zh-cn.json', 'readme.md', 'changelog.md']
    : ['dist/extension.js', 'dist/webview.js', 'dist/webview.css', 'dist/sidebar-codicon.css',
      'dist/runtime-supervisor.js', 'dist/runtime-supervisor-launcher.js', 'dist/execution-candidate-selection.json',
      'node_modules/node-pty/package.json', 'scripts/runtime/claude-file-event-hook.cjs', 'readme.md',
      'package.nls.json', 'package.nls.zh-cn.json', 'l10n/bundle.l10n.zh-cn.json'];
  for (const relative of required) assert(zip.file(`extension/${relative}`), `Production VSIX is missing ${relative}`);
  const payload = [];
  const extensionFiles=[];
  for (const [name, entry] of Object.entries(zip.files)) {
    assertSafeVsixEntry(entry);
    if (entry.dir) continue;
    if (production) assert(!/\.(?:map|pdb)$/.test(name), `Production VSIX contains debug payload: ${name}`);
    const sha256=digest(await entry.async('nodebuffer'));
    payload.push({ path: name, sha256 });
    if(name.startsWith('extension/'))extensionFiles.push({path:name.slice('extension/'.length),sha256});
  }
  assertRuntimeFileList(extensionFiles.map(entry => entry.path), { production });
  if (!expectedID.endsWith('-notifier')) {
    const selection = JSON.parse(await zip.file('extension/dist/execution-candidate-selection.json').async('string'));
    assert.equal(selection.profile, 'platform');
    assert.deepEqual(selection.admissionLimits, { executions: null, starting: 1, pending: 2 });
    for (const [platform, owner, suffix] of [['linux', 'linux', '-glibc'], ['darwin', 'macos', ''], ['win32', 'windows', '']]) {
      for (const arch of ['x64', 'arm64']) {
        const prefix = `extension/dist/native/${owner}-execution-candidate/${platform}-${arch}${suffix}/`;
        const manifestEntry = zip.file(`${prefix}manifest.json`); assert(manifestEntry, 'Production package requires all six native targets');
        const native = JSON.parse(await manifestEntry.async('string'));
        for (const asset of [native.binary, native.helper, ...(native.dependencies ?? [])].filter(Boolean)) {
          const entry = zip.file(`${prefix}${asset.file}`); assert(entry, `Missing native asset ${prefix}${asset.file}`);
          assert.equal(digest(await entry.async('nodebuffer')), asset.sha256, 'Native payload differs from build receipt');
        }
        if (native.helper) assert.equal(zip.file(`${prefix}${native.helper.file}`).unixPermissions, 0o100755);
      }
    }
  }
  return { manifest,extensionFiles, payloadDigest: objectDigest(payload.sort((a, b) => a.path.localeCompare(b.path))) };
}

export async function buildReleaseCandidate({ plan, output, archives, root = process.cwd(), env = process.env,
  deadline = Date.now() + 1410000, cleanupDeadline = deadline + 60000, signal }) {
  assert(Number.isFinite(deadline) && Number.isFinite(cleanupDeadline) && cleanupDeadline >= deadline);
  validateFrozenPlan(plan); assertFormalEnvironment(env); assertCheckout(plan, root);
  assert(plan.scope.artifact, 'The frozen plan must require package acceptance');
  const destination = path.resolve(output); await fs.mkdir(destination, { recursive: true });
  assert.equal((await fs.readdir(destination)).length, 0, 'Do not reuse or overwrite a candidate output');
  const work = await fs.mkdtemp(path.join(destination, '.candidate-clean-'));
  const checkout = path.join(work, 'repo'); await fs.mkdir(checkout);
  const sourceTar = path.join(work, 'source.tar');
  const timeline = [];
  let actionCompletedAt;
  const run = async (command, args, cwd = checkout) => {
    const startedAt = new Date().toISOString();
    const label = `${String(timeline.length + 1).padStart(2, '0')}-${path.basename(command)}`;
    const result = await runProcess(command, args, { cwd, env: isolated,
      deadline: Math.min(deadline, Date.now() + (args[0] === 'ci' ? 600000 : 600000)), signal,
      logPath: path.join(destination, `${label}.log`) });
    timeline.push({ command: path.basename(command), args, startedAt, completedAt: new Date().toISOString(), result });
    await writeJSON(path.join(destination, 'build-timeline.json'), timeline);
    if (result.status !== 'passed') {
      const error = new Error(`Clean candidate step failed: ${label}`);
      error.unsettled = !result.exited || result.cleanup.status !== 'passed';
      throw error;
    }
  };
  const home = path.join(work, 'home'); const config = path.join(work, 'config'); const cache = path.join(work, 'npm-cache');
  for (const dir of [home, config, cache]) await fs.mkdir(dir);
  const npmrc = path.join(work, 'user.npmrc'); await fs.writeFile(npmrc, '');
  const globalNpmrc = path.join(work, 'global.npmrc'); await fs.writeFile(globalNpmrc, '');
  const isolated = { ...env, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: config, XDG_CACHE_HOME: path.join(work, 'cache'),
    NPM_CONFIG_USERCONFIG: npmrc, npm_config_userconfig: npmrc, NPM_CONFIG_GLOBALCONFIG: globalNpmrc,
    npm_config_globalconfig: globalNpmrc, NPM_CONFIG_CACHE: cache, npm_config_cache: cache,
    DEV_SESSION_CANVAS_VSCE_DOC_BRANCH: plan.inputSHA, DEV_SESSION_CANVAS_VSCE_VALIDATE_GIT_ROOT: root };
  delete isolated.DEV_SESSION_CANVAS_EXECUTION_ASSETS_SET;
  try {
    execFileSync('git', ['archive', '--format=tar', '--output', sourceTar, plan.inputSHA], { cwd: root });
    execFileSync('tar', ['-xf', sourceTar, '-C', checkout], { cwd: root });
    const sourceDigest = await fileDigest(sourceTar);
    const assets = path.join(work, 'native-set');
    assembleExecutionDistributionAssets({ source: archives, output: assets, inputCommit: plan.inputSHA });
    const nativeHashes = await treeHashes(assets); const nativeSetDigest = objectDigest(nativeHashes);
    for (const asset of nativeHashes) await fs.chmod(path.join(assets, asset.path), asset.path.endsWith('spawn-helper') ? 0o555 : 0o444);
    const npm = npmCommand(['ci', '--no-audit', '--no-fund']); await run(npm.file, npm.args);
    for (const workspace of ['extensions/vscode/dev-session-canvas', 'extensions/vscode/dev-session-canvas-notifier']) {
      const command = npmCommand(['run', '-w', workspace, 'typecheck']); await run(command.file, command.args);
    }
    await run(process.execPath, ['scripts/build/build.mjs', '--production', '--execution-assets-set', assets]);
    await run(process.execPath, ['extensions/vscode/dev-session-canvas-notifier/scripts/build.mjs', '--production']);
    const mainDist = path.join(checkout, 'extensions/vscode/dev-session-canvas/dist');
    const notifierDist = path.join(checkout, 'extensions/vscode/dev-session-canvas-notifier/dist');
    const buildHashes = { main: await treeHashes(mainDist), notifier: await treeHashes(notifierDist) };
    await run(process.execPath, ['scripts/release/package-vsix.mjs', '--output', path.join(destination, 'main.vsix')]);
    await run(process.execPath, ['extensions/vscode/dev-session-canvas-notifier/scripts/package-vsix.mjs',
      '--output', path.join(destination, 'notifier.vsix')]);
    assert.deepEqual(await treeHashes(mainDist), buildHashes.main, 'VSCE hook unexpectedly rebuilt the main payload');
    assert.deepEqual(await treeHashes(notifierDist), buildHashes.notifier, 'VSCE hook unexpectedly rebuilt notifier');
    const packages = [];
    for (const [id, filename] of [['devsessioncanvas.dev-session-canvas', 'main.vsix'],
      ['devsessioncanvas.dev-session-canvas-notifier', 'notifier.vsix']]) {
      const file = path.join(destination, filename);
      const inspected = await inspectVsix(file, id, plan.version);
      packages.push({ id, version: plan.version, path: filename, size: (await fs.stat(file)).size,
        sha256: await fileDigest(file), payloadDigest: inspected.payloadDigest });
    }
    assert.deepEqual(await treeHashes(assets), nativeHashes, 'Read-only native inputs changed while packaging');
    const receipt = { schemaVersion: 1, planDigest: objectDigest(plan), inputSHA: plan.inputSHA, version: plan.version,
      sourceDigest, lockDigest: await fileDigest(path.join(checkout, 'package-lock.json')), nativeSetDigest,
      production: true, profile: 'platform', admission: { executions: null, starting: 1, pending: 2 },
      readmeRef: plan.inputSHA, environmentDigest: plan.environmentDigest,
      producer: producerFor(plan, 'package-clean', 'default'), packages, buildHashes,
      buildCount: { main: 1, notifier: 1 }, npmHooksStripped: true };
    await verifyPackageFiles(receipt, plan, destination);
    await writeJSON(path.join(destination, 'package-receipt.json'), receipt);
    actionCompletedAt = new Date().toISOString();
    assert(Date.parse(actionCompletedAt) <= deadline, 'Candidate business completion exceeded its original work deadline');
    const cleanup = await retireCandidateCheckout(work, undefined, cleanupDeadline);
    await writeJSON(path.join(destination, 'clean-checkout-result.json'), { schemaVersion: 1,
      cleanup: 'passed', ...cleanup, actionCompletedAt, deadline,
      isolatedDependencies: true, sourceMode: 'git-archive', inputSHA: plan.inputSHA });
    return receipt;
  } catch (error) {
    if (error.unsettled) {
      await writeJSON(path.join(destination, 'clean-checkout-result.json'), { schemaVersion: 1,
        cleanup: 'failed', cleanupError: 'Original action has not settled; concurrent evidence copy and checkout cleanup refused',
        actionCompletedAt: actionCompletedAt ?? null, deadline, cleanupDeadline,
        failure: error.message, preservedDirectory: work });
      throw error;
    }
    // Preserve build inputs and partial payloads, then retire the private
    // checkout. A business failure must not imply a cleanup failure.
    const scene = path.join(destination, 'failure-scene');
    let evidenceError = null;
    try {
      await withinDeadline('Clean candidate failure evidence', Math.min(cleanupDeadline, Date.now() + 30000), async () => {
        await fs.mkdir(scene, { recursive: true });
        for (const relative of ['package.json', 'package-lock.json', 'extensions/vscode/dev-session-canvas/dist',
          'extensions/vscode/dev-session-canvas-notifier/dist']) {
          const source = path.join(checkout, relative);
          if (await fs.stat(source).catch(() => null)) await fs.cp(source, path.join(scene, relative), { recursive: true });
        }
      });
    } catch (failure) {
      evidenceError = failure.message;
      if (failure.unsettled) error.unsettled = true;
    }
    let cleanup = 'passed', cleanupError = null, cleanupTiming = {};
    try { cleanupTiming = await retireCandidateCheckout(work, error, cleanupDeadline); }
    catch (failure) { cleanup = 'failed'; cleanupError = failure.message; }
    await writeJSON(path.join(destination, 'clean-checkout-result.json'), { schemaVersion: 1,
      cleanup, cleanupError, evidenceError, ...cleanupTiming, cleanupDeadline,
      actionCompletedAt: actionCompletedAt ?? null, deadline,
      failure: error.message, preservedDirectory: cleanup === 'failed' ? work : null });
    throw error;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { values } = parseArgs({ options: { plan: { type: 'string' }, output: { type: 'string' }, archives: { type: 'string' } } });
  assert(values.plan && values.output && values.archives);
  await buildReleaseCandidate({ plan: await readJSON(values.plan), output: values.output, archives: values.archives });
}
